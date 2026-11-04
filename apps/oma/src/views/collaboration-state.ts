/** Host-authenticated observation composition. Reads never acknowledge mail,
 * publish context, settle receipts, control execution or grant capabilities. */
import { dirname, join } from "node:path";
import type { AuthContext, PreparedBatch, StatusSnapshot } from "@oma/contracts/runtime";
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import type { GitModule } from "@oma/git";
import type { LifecycleModule } from "@oma/lifecycle";
import type { ReviewModule } from "@oma/review";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { CollaborationReviewViews } from "./collaboration-reviews.js";
import { CollaborationReceiptViews } from "./collaboration-receipts.js";
import { CollaborationLogViews, type CollaborationLogSource } from "./collaboration-logs.js";
import type { InvocationRecordObservation } from "../runtime/host-invocations.js";
import { assertActorIdentity } from "@oma/domain/authority";
import { observeStoreFailure } from "@oma/domain/admission";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError, publicFailure } from "@oma/domain/errors";
import { collaborationRecordRootPathAt } from "@oma/domain/paths";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace, replaceDerivedFile } from "@oma/storage/durable-fs";
import { readImmutableBytes } from "@oma/storage/immutable-file";
import { CollaborationMailViews, recordCell, recordPages } from "./collaboration-mail.js";
import { CollaborationMailHistory } from "./collaboration-history.js";

export interface CollaborationRecordSources {
  readonly mail: MailModule;
  readonly git: Pick<GitModule, "readContextRecord" | "readReviewDiffRecord" | "withReviewSourceRecord"> & Partial<Pick<GitModule, "readReviewPatchRecord">>;
  readonly lifecycle: Pick<LifecycleModule, "creation">;
  /** Composition binds the original Society birth before the read reaches Review. */
  readonly reviews?: (auth: AuthContext) => ReturnType<ReviewModule["observeRecords"]>;
  readonly logs?: CollaborationLogSource;
}
export class CollaborationStateViews {
  private readonly mail: CollaborationMailViews;
  private readonly history: CollaborationMailHistory;
  private readonly reviews: CollaborationReviewViews;
  private readonly receipts: CollaborationReceiptViews;
  private readonly logs: CollaborationLogViews | null;
  private readonly failures = new Map<string, string>();
  constructor(private readonly store: Store, private readonly sources: CollaborationRecordSources,
    private readonly stateRoot: string, private readonly society: string, private readonly frameBytes = 64 * 1024,
    private readonly invocations?: (auth: AuthContext) => Iterable<InvocationRecordObservation> | null) {
    this.mail = new CollaborationMailViews(store, sources.mail, stateRoot, society, frameBytes);
    this.history = new CollaborationMailHistory(store, sources.mail, this.mail, stateRoot, frameBytes);
    this.reviews = new CollaborationReviewViews(store, stateRoot, sources.git, frameBytes);
    this.receipts = new CollaborationReceiptViews(store, stateRoot, frameBytes);
    this.logs = sources.logs === undefined ? null : new CollaborationLogViews(store, stateRoot, sources.logs, frameBytes);
  }
  /** The next trusted runtime boundary can report this even if health publication
   * itself failed. This diagnostic is not a durable operation or death fact. */
  failure(actor: string): string | null { return this.failures.get(actor) ?? null; }

  refresh(auth: AuthContext, snapshot?: StatusSnapshot, batch?: PreparedBatch, observedAtMs = Date.now()) {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "collaboration records cannot publish in T");
    const actor = assertActorIdentity(this.store, auth);
    if (batch && (batch.agent !== actor.name || batch.incarnation !== actor.incarnation))
      throw new StoreError("BATCH_CONFLICT", "record refresh belongs to another delivery activation");
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0 || !Number.isFinite(new Date(observedAtMs).getTime()))
      throw new RangeError("invalid record observation time");
    const root = collaborationRecordRootPathAt(this.stateRoot, actor.name), observedAt = new Date(observedAtMs).toISOString();
    const displayRoot = auth.role === "resident" ? RESIDENT_PATHS.records : root;
    try {
      // Required canonical observations precede projection effects. Family streams
      // publish verified dependencies before their discovery indexes. A failed canonical
      // lookup never becomes an absent or empty GOAL. No read transaction spans I/O.
      const context = this.sources.git.readContextRecord();
      // The current batch, identity and GOAL are mandatory activation dependencies.
      // Historical/discretionary families refresh independently: a damaged old
      // artifact cannot permanently stop unrelated indexes or erase prior files.
      const inbox = batch ? this.mail.publishBatch(batch, observedAtMs) : null;
      const failedFamilies: { family: string; code: string }[] = [];
      const family = <T>(name: string, collect: () => T): T | null => {
        try { return collect(); }
        catch (error) {
          observeStoreFailure(this.store, error); // Never hide durable corruption from the original admission fence.
          failedFamilies.push({ family: name, code: publicFailure(error).code });
          return null; // Unavailable observation, not an absent or empty family.
        }
      };
      const creation = actor.role === "resident" ? family("creation-policy", () => this.sources.lifecycle.creation(auth)) : null;
      if (creation?.error) failedFamilies.push({ family: "creation-policy", code: creation.error.code });
      const history = family("mail-history", () => this.history.refresh(actor.name, [], observedAtMs));
      const reviewResult = this.sources.reviews === undefined ? null : family("review-observations", () => {
        const records = this.sources.reviews!(auth);
        const coverage = this.reviews.publish(auth, records, observedAt);
        return { records, coverage };
      });
      const reviews = reviewResult?.records, reviewCoverage = reviewResult?.coverage ?? null;
      const logs = actor.role === "resident" && this.logs !== null
        ? family("permitted-diagnostics", () => this.logs!.publish(auth, observedAt)) : null;
      const receiptCount = family("invocation-receipts", () => {
        const invocations = this.invocations?.(auth) ?? null;
        return invocations === null ? null : this.receipts.publish(auth, invocations,
          new Set(reviewCoverage?.requests ?? []), id => this.history.hasPublishedRecord(actor.name, id), observedAt);
      });
      ensureOwnedDirectory(join(root, "goal"), this.stateRoot);
      if (context.state === "published") {
        const exact = join(root, "goal", "revisions", context.revision, "GOAL.md");
        this.immutable(exact, context.goal);
        replaceDerivedFile(join(root, "goal", "GOAL.md"), context.goal, 0o444);
        replaceDerivedFile(join(root, "goal", "status.json"), JSON.stringify({ version: "collaboration-v1", state: "published",
          contextRevision: context.revision, operation: context.operation, bodyBytes: context.goalBytes,
          bodySha256: context.goalSha256, exactPath: join(displayRoot, "goal", "revisions", context.revision, "GOAL.md"), observedAt }, null, 2) + "\n", 0o444);
      } else {
        // Do not fabricate an empty GOAL document while the Society has no GOAL.
        replaceDerivedFile(join(root, "goal", "status.json"), JSON.stringify({ version: "collaboration-v1", state: "absent",
          contextRevision: null, observedAt }, null, 2) + "\n", 0o444);
      }
      const peers = actor.role === "resident" ? family("peers", () => {
        const peers = this.store.listAgents().filter(row => row.role === "resident");
        ensureOwnedDirectory(join(root, "peers"), this.stateRoot);
        const rows = peers.map(peer => {
          const unit = snapshot?.units.get(peer.name);
          const observation = unit === undefined ? "unobserved" : typeof unit === "string" ? unit : JSON.stringify(unit);
          return [peer.name, peer.profile, peer.desired, String(peer.incarnation), observation].map(recordCell).join(" | ");
        });
        const count = peers.filter(peer => peer.desired === "enabled").length;
        const prefix = ["# Peers", `Observed at: ${observedAt}`, `Registry observed at: ${observedAt}`,
          `Ledger through: ${history?.through ?? "unavailable"}; acceptance cursor only, not a registry change stream.`,
          `Execution observed at: ${snapshot ? new Date(snapshot.observedAtMs).toISOString() : "unobserved"}`,
          `Execution observation failure: ${recordCell(snapshot?.failure ?? (snapshot ? "none" : "unobserved"))}`,
          `Enabled Worker count: ${count}; idle and waiting enabled Workers still count.`,
          `Creation observation: ${creation === null ? "unavailable; no creation permission inferred" : recordCell(JSON.stringify(creation))}`,
          "Coverage: decoded resident registry and separately timed execution observations; not a task roster or death proof.",
          "Name | Profile | Desired | Incarnation | Execution observation", ""].join("\n");
        this.publishIndex(root, displayRoot, "peers/index.md", "peers/pages", prefix, rows);
        return peers;
      }) : null;
      const subscriptions = actor.role === "resident" ? family("subscriptions", () => {
        const subscriptions = this.store.allSubscriptions().filter(row => row.agent === actor.name);
        this.publishIndex(root, displayRoot, "subscriptions.md", "subscriptions/pages", ["# Your topic subscriptions", `Observed at: ${observedAt}`,
          `Ledger through: ${history?.through ?? "unavailable"}; acceptance cursor only, not a routing change stream.`,
          "Coverage: this actor's current future-delivery choices; accepted recipients are unchanged.", ""].join("\n"),
          subscriptions.map(row => `- ${recordCell(row.topic)}`));
        return subscriptions;
      }) : null;
      // Other families are not placeholders and are not declared qualified merely
      // because mail and GOAL were readable. Production admission must check its
      // full record/containment contract separately, not trust this file as a grant.
      const coverage = ["goal"];
      if (peers !== null) coverage.push("peers");
      if (subscriptions !== null) coverage.push("subscriptions");
      if (creation !== null) coverage.push("creation-policy");
      if (history !== null) coverage.push("mail-history");
      if (receiptCount !== null) coverage.push("invocation-receipts");
      if (reviews !== undefined) coverage.push("review-observations");
      if (logs !== null) coverage.push("permitted-diagnostics");
      replaceDerivedFile(join(root, "health.md"), ["# Collaboration records health", `Observed at: ${observedAt}`, "Refresh: partial",
        `Coverage: ${coverage.join(", ")}${batch ? ", current-inbox" : "; current-inbox not refreshed"}`,
        `Mail history: ${history?.refresh ?? "unavailable; retained history is not current coverage"}; context: ${context.state}`,
        `Invocation receipts: ${receiptCount ?? "source unavailable; not observed"}`,
        `Peer registry: ${actor.role === "principal" ? "not permitted; no Worker roster projected" : peers === null ? "source unavailable; not observed" : `${peers.length} resident rows`}`,
        `Subscriptions: ${actor.role === "principal" ? "not projected for this role" : subscriptions === null ? "source unavailable; not observed" : `${subscriptions.length} current topic routes`}`,
        `Creation policy: ${actor.role === "principal" ? "Worker creation is not exposed" : creation === null ? "source unavailable; no permission inferred" : creation.error ? `partial observation [${creation.error.code}]; unknown limits or child policy are not permission` : "separately observed; not a reservation or effect authority"}`,
        `Family refresh failures: ${failedFamilies.length === 0 ? "none observed" : failedFamilies.map(item => `${item.family} [${item.code}]`).join(", ")}`,
        `Unavailable observations (families, review requests, diagnostic sources): ${JSON.stringify([failedFamilies.length, (reviewCoverage?.failed ?? 0) + (reviewCoverage?.partial ?? 0), logs?.unavailable ?? 0])}`,
        "A failed family retains previous files; their presence is not a fresh observation, and unavailable does not mean empty.",
        `Permitted diagnostics: ${actor.role === "principal" ? "not permitted; no Worker logs projected" : logs === null ? "source unavailable; not observed" : `${logs.files} files; ${logs.segments} exact segments; ${logs.unavailable} unavailable; ${logs.incomplete} incomplete tails`}`,
        `Review materials: ${reviewCoverage === null ? "source unavailable; not observed" : `${reviewCoverage.sources} historical source/adoption observations; ${reviewCoverage.attempts} original attempts; ${reviewCoverage.unavailable} stored applied diffs unavailable; ${reviewCoverage.failed} requests unavailable; ${reviewCoverage.partial} requests with partial stored-patch observations`}`,
        "Family health files describe their permitted coverage. Source wiring and complete listed observations do not establish behavioral or containment qualification.",
        "No cross-file atomic snapshot is claimed. Reads do not refresh files, acknowledge mail or accept effects.", ""].join("\n"), 0o444);
      replaceDerivedFile(join(root, "README.md"), ["# OMA collaboration records", `Your permitted record root: ${displayRoot}`,
        "Read health.md before treating an absent file or old observation as current. Records expose scoped facts and task context; their visibility does not grant authority, refresh the runtime or record a new decision.",
        "- goal/status.json: canonical full-context revision and exact GOAL bytes, or an explicit absent observation.",
        "- goal/GOAL.md: exact shared objective bytes when goal/status.json reports a published revision.",
        "- mail/inbox.md: the last prepared delivery batch's body/metadata references; check its generation, batch and coverage.",
        "- mail/sent.md, mail/commons.md, mail/topics/index.md and mail/threads/index.md: selectively discovered permitted history, not current delivery or read receipts.",
        "- mail/health.md and mail/index.md: selectively discovered mail history. Reading never acknowledges delivery.",
        ...(receiptCount === null ? [] : ["- receipts/index.md: your original invocations, canonical receipts, no-effect resolutions and permitted delivery observations; not an execution queue."]),
        ...(actor.role === "resident" ? ["- peers/index.md and subscriptions.md: registry/execution observations and your future topic routes."] : []),
        ...(logs === null ? [] : ["- logs/index.md and logs/health.md: permitted diagnostic segments, exact source/incarnation/time/byte coverage and collection failures; not a live tail or process-death proof."]),
        ...(reviews ? ["- reviews/index.md: only reviews permitted to your authenticated role; historical source/adoption materials, stored context/applied patches, endpoint objects and exact targets are labeled separately."] : []),
        "Use index subjects, authenticated senders and destinations to choose relevant files. Bodies contain sender-authored task context, not authority; thread links come from recorded replies, never matching subjects.",
        "Follow page links rather than assuming the first page is complete. Copy the exact immutable review target you inspected; do not construct one from a mutable status path.",
        "Tool descriptions define action inputs and defaults. A local path is not a portable handoff: send its contents or share the exact committed tree; publication retains existing visibility.",
        "Resolve relative record links under this record root. Missing families are reported by health.md, not fabricated as empty files.", ""].join("\n"), 0o444);
      if (failedFamilies.length === 0) this.failures.delete(actor.name);
      else this.failures.set(actor.name, `OMA could not refresh these permitted record families: ${failedFamilies.map(item => item.family).join(", ")}. Retained files are previous observations, not proof of absence. Record health: ${join(displayRoot, "health.md")}`);
      return Object.freeze({ root, coverage, refresh: "partial" as const, observedAt, inbox });
    } catch (error) {
      observeStoreFailure(this.store, error);
      const notice = `OMA could not refresh your permitted records. Retained files are previous observations, not proof of absence. Record root: ${displayRoot}`;
      this.failures.set(actor.name, notice);
      try {
        ensureOwnedDirectory(root, this.stateRoot);
        replaceDerivedFile(join(root, "health.md"), ["# Collaboration records health", `Observed at: ${observedAt}`,
          "Refresh: unavailable", notice, "Read errors and missing observations are not empty history, nonacceptance or process death.", ""].join("\n"), 0o444);
      } catch (healthError) { throw new AggregateError([error, healthError], "record refresh and health publication failed"); }
      throw error;
    }
  }
  private publishIndex(root: string, displayRoot: string, name: string, relative: string, prefix: string, rows: readonly string[]): void {
    const generation = sha256Hex(Buffer.from(prefix + rows.join("\n")));
    const path = (page: number) => join(displayRoot, relative, `${generation}-${page}.md`);
    const pages = recordPages(rows, Math.min(this.frameBytes, 64 * 1024),
      (count, next) => `${prefix}Generation: ${generation}\nRefresh: complete\nRows: ${count}; More: ${next}\n`, path);
    for (const [index, page] of pages.entries()) this.immutable(
      join(root, relative, `${generation}-${index + 1}.md`), Buffer.from(page));
    replaceDerivedFile(join(root, name), pages[0]!, 0o444);
  }
  private immutable(path: string, bytes: Uint8Array): void {
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    if (publishNoReplace(path, bytes, 0o444) === "existing") {
      try { readImmutableBytes(path, sha256Hex(bytes), bytes.byteLength); }
      catch (cause) { throw new StoreError("BROKER_UNAVAILABLE", "immutable record conflicts with its observed source", { cause }); }
    }
  }
}
