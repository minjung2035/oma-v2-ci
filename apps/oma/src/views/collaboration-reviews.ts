/** Role-scoped observations of the existing review owner, never review authority. */
import { dirname, join } from "node:path";
import type { AuthContext } from "@oma/contracts/runtime";
import type { ReviewDiffArtifact } from "@oma/contracts/files";
import type { Store } from "@oma/storage";
import type { GitModule } from "@oma/git";
import type { ReviewRecordObservation } from "@oma/review";
import { assertActorIdentity } from "@oma/domain/authority";
import { observeStoreFailure } from "@oma/domain/admission";
import { canonicalCollaborationJson, encodeCollaborationTarget } from "@oma/domain/collaboration-targets";
import { collaborationReviewTargets, collaborationReviewManifest, collaborationProposalMetadata } from "@oma/domain/collaboration-review";
import { sha256Hex } from "@oma/domain/canonical-json";
import { collaborationRecordRootPathAt } from "@oma/domain/paths";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { StoreError, publicFailure } from "@oma/domain/errors";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace, replaceDerivedFile } from "@oma/storage/durable-fs";
import { observeImmutableFile } from "@oma/storage/immutable-file";
import { recordCell } from "./collaboration-mail.js";
import { CollaborationReviewMaterials } from "./collaboration-review-materials.js";
import { decodeUtf8 } from "@oma/domain/utf8";

function reviewAttempts(record: Extract<ReviewRecordObservation, { role: "resident" }>) {
  return record.attempts ?? (record.input.integration ? [{ attemptNumber: record.state.attemptNumber,
    revision: record.state.revision, integration: record.input.integration }] : []);
}
function storedAppliedDiff(integration: { readonly identity?: { readonly expectedBase: string; readonly candidate: string }; readonly diff?: ReviewDiffArtifact }) {
  const diff = integration.diff;
  if (diff !== undefined && (integration.identity === undefined || diff.base !== integration.identity.expectedBase || diff.candidate !== integration.identity.candidate))
    throw new StoreError("STORE_CORRUPT", "applied review diff differs from its exact integration identity");
  return diff;
}

export class CollaborationReviewViews {
  private readonly pageBytes: number;
  /** Digests only: complete patch buffers are transient, never retained here. */
  private readonly artifacts = new Map<string, { identitySha256: string; manifestBytes: number; manifestSha256: string;
    dependencies: readonly { path: string; bytes: number; sha256: string }[] }>();
  private readonly materials: CollaborationReviewMaterials;
  constructor(private readonly store: Store, private readonly stateRoot: string,
    private readonly git: Pick<GitModule, "readReviewDiffRecord"> & Partial<Pick<GitModule, "withReviewSourceRecord" | "readReviewPatchRecord">>, frameBytes = 64 * 1024) {
    if (!Number.isSafeInteger(frameBytes) || frameBytes < 1) throw new RangeError("invalid review presentation budget");
    this.pageBytes = Math.min(frameBytes, 64 * 1024);
    this.materials = new CollaborationReviewMaterials(store, git, stateRoot,
      (path, bytes) => this.immutable(path, bytes), (path, hash, bytes) => this.exact(path, hash, bytes));
  }
  publish(auth: AuthContext, observations: readonly ReviewRecordObservation[], observedAt: string): Readonly<{ unavailable: number; sources: number; attempts: number; failed: number; partial: number; requests: readonly string[] }> {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "review records cannot publish in T");
    if (!Number.isFinite(Date.parse(observedAt))) throw new RangeError("invalid review observation time");
    const actor = assertActorIdentity(this.store, auth);
    if (observations.some(record => record.role !== actor.role))
      throw new StoreError("CAPABILITY_DENIED", "review observations belong to another role");
    const root = collaborationRecordRootPathAt(this.stateRoot, actor.name);
    const displayRoot = actor.role === "resident" ? RESIDENT_PATHS.records : root;
    const rows: string[] = [];
    // Discover current status only after its dependencies publish. An unavailable
    // status may link independently verified stored patches, never fresh targets.
    const published: string[] = [];
    let failed = 0, partial = 0;
    let unavailable = 0, historicalSources = 0, historicalAttempts = 0;
    for (const record of observations) {
      const result = this.publishRequest(actor, record, observations, root, displayRoot);
      if (!result.ok) {
        failed++;
        rows.push(`${recordCell(record.name)} | unavailable [${result.code}] | prior files retained; not a current status link${result.storedIndex === null ? "" : ` | independently observed original patches: ${result.storedIndex}`}`);
        continue;
      }
      unavailable += result.unavailable; historicalSources += result.sources; historicalAttempts += result.attempts;
      if (result.storedUnavailable > 0) partial++;
      rows.push(result.row); published.push(record.request);
    }
    const entry = this.index(root, displayRoot, rows);
    this.mutable(join(root, "reviews", "index.md"), entry);
    const mainObservationTimes = [...new Set(observations.flatMap(record => record.status.observedAtMs === undefined
      ? [] : [new Date(record.status.observedAtMs).toISOString()]))];
    this.mutable(join(root, "reviews", "health.md"), ["# Review records health", `Observed at: ${observedAt}`,
      `Permitted requests: ${observations.length}`, `Refresh: ${unavailable || failed || partial ? "partial" : "complete-for-permitted-observations"}`,
      `Main observation times (status owner): ${mainObservationTimes.length ? mainObservationTimes.join(", ") : "not supplied by the permitted projection"}. These do not make the files an atomic snapshot.`,
      `Historical source/adoption observations: ${historicalSources}; original integration attempts: ${historicalAttempts}; unavailable stored applied diffs: ${unavailable}`,
      `Requests refreshed: ${published.length}; unavailable requests: ${failed}. The index labels failures without inventing empty status or current links.`,
      `Requests with partial stored-patch observations: ${partial}. Those stored indexes report exact available bytes and unavailable entries separately.`,
      "Previous files for unavailable requests are retained observations, not evidence of absence or current authority.",
      "An unavailable request may still link independently observed originally stored patches; those links are not a fresh status, complete endpoint coverage or decision authority.",
      "Coverage: existing role-scoped status and targets; Workers additionally receive accepted facts, historical source/adoption patches, exact changed-path endpoint blobs and stored context/applied deltas.",
      "OID-derived patches are new observations, never substitutes for originally stored complete diffs. Principal roots contain no Worker materials.",
      "No cross-file snapshot, approval, acceptance, ACK or effect authority is created by these files.", ""].join("\n"));
    return Object.freeze({ unavailable, sources: historicalSources, attempts: historicalAttempts, failed, partial, requests: Object.freeze(published) });
  }
  /** The original complete stored bytes do not depend on a new OID export.
   * This companion never replaces the historical decision manifest/target hash. */
  private storedPatch(directory: string, diff: ReviewDiffArtifact, identity: object): void {
    const manifestPath = join(directory, "manifest.json");
    const identitySha256 = sha256Hex(canonicalCollaborationJson({ renderer: "stored-review-patch-v1", diff, identity }));
    const cached = this.artifacts.get(manifestPath);
    if (cached && cached.identitySha256 !== identitySha256)
      throw new StoreError("BROKER_UNAVAILABLE", "stored patch changed identity under an immutable companion path");
    if (cached && this.exact(manifestPath, cached.manifestSha256, cached.manifestBytes) &&
        cached.dependencies.every(file => this.exact(file.path, file.sha256, file.bytes))) return;
    if (!this.git.readReviewPatchRecord) throw new StoreError("BROKER_UNAVAILABLE", "independent stored patch observations are unavailable");
    const patch = this.git.readReviewPatchRecord(diff);
    if (patch.byteLength !== diff.bytes || sha256Hex(patch) !== diff.sha256)
      throw new StoreError("BROKER_UNAVAILABLE", "stored patch bytes differ from their accepted descriptor");
    const dependencies: { path: string; bytes: number; sha256: string }[] = [];
    const publish = (name: string, value: string | Uint8Array): void => {
      const path = join(directory, name); this.immutable(path, value);
      dependencies.push({ path, bytes: typeof value === "string" ? Buffer.byteLength(value) : value.byteLength, sha256: sha256Hex(value) });
    };
    let utf8 = true;
    try { decodeUtf8(patch); } catch { utf8 = false; }
    publish("patch.bin", patch);
    publish("patch.txt", utf8 ? patch : ["# Original complete patch requires binary-safe reading",
      "Exact bytes: patch.bin", `Bytes: ${diff.bytes}; SHA-256: ${diff.sha256}`,
      "This is an authored pointer, not a lossy text transcription or the complete text diff.", ""].join("\n"));
    const manifest = canonicalCollaborationJson({ version: "collaboration-v1", kind: "stored-review-patch",
      renderer: "stored-review-patch-v1", identity, repository: "project", objectFormat: diff.base.length === 40 ? "sha1" : "sha256", descriptor: diff,
      patch: { reference: "patch.bin", textReference: "patch.txt", bytes: diff.bytes, sha256: diff.sha256,
        origin: "originally stored complete diff", textEncoding: utf8 ? "exact-utf8" : "authored-pointer-only" },
      coverage: "exact originally stored patch bytes only; changed paths and endpoint blob observations are separate and may be unavailable",
      authority: "observation only; does not replace the historical decision manifest or exact target, establish current availability, or grant approval or effect authority" });
    this.immutable(manifestPath, manifest);
    this.artifacts.set(manifestPath, { identitySha256, manifestBytes: Buffer.byteLength(manifest), manifestSha256: sha256Hex(manifest), dependencies });
  }
  private storedPatches(record: Extract<ReviewRecordObservation, { role: "resident" }>, directory: string, display: string) {
    const rows: string[] = [];
    let unavailable = 0;
    const publish = (relative: string, diff: ReviewDiffArtifact, identity: object): void => {
      try {
        this.storedPatch(join(directory, relative, "stored-v1"), diff, identity);
        rows.push(`Stored complete patch: ${join(display, relative, "stored-v1", "manifest.json")}`);
      } catch (error) {
        observeStoreFailure(this.store, error); unavailable++;
        rows.push(`${recordCell(relative)}: stored complete patch unavailable [${publicFailure(error).code}]; retained bytes are not a fresh observation`);
      }
    };
    for (const entry of [record.input.open, ...record.input.entries]) {
      if (entry.fact.kind !== "review.integration") continue;
      const fact = entry.fact;
      publish(join("contexts", entry.operation), fact.diff, { request: record.request, revision: fact.revision,
        scope: entry.operation, kind: "integration-context", identity: fact.identity, source: fact.source });
    }
    for (const attempt of reviewAttempts(record)) {
      const integration = attempt.integration;
      if (integration.state !== "succeeded") continue;
      const diff = storedAppliedDiff(integration);
      if (diff === undefined) {
        unavailable++;
        rows.push(`Applied ${integration.operation}: originally stored complete diff unavailable; no reconstruction is labeled original.`);
      } else publish(join("applied", integration.operation), diff, { request: record.request,
        revision: attempt.revision, kind: "applied", integration: integration.operation, identity: integration.identity });
    }
    const index = this.list(join(directory, "stored"), join(display, "stored"),
      "# Originally stored review patches\nCoverage: exact complete stored bytes, independently of new endpoint observations. A patch is not a current review status or approval.\n", rows);
    this.mutable(join(directory, "stored", "index.md"), index);
    return { index: join(display, "stored", "index.md"), unavailable };
  }
  /** Publish one permitted request's dependencies before exposing its status.
   * A failed request keeps its prior files and cannot stop independent reviews. */
  private publishRequest(actor: { readonly name: string; readonly role: "resident" | "principal" },
    record: ReviewRecordObservation, observations: readonly ReviewRecordObservation[], root: string, displayRoot: string) {
    const statuses: { path: string; text: string }[] = [];
    let unavailable = 0, historicalSources = 0, historicalAttempts = 0;
    let storedIndex: string | null = null, storedUnavailable = 0;
    try {
      // Exact per-request dependencies precede mutable navigation.
      const directory = join(root, "reviews", record.request);
      const display = join(displayRoot, "reviews", record.request);
      const revision = record.role === "resident" ? record.state.revision : record.revision;
      const references: string[] = [];
      const targetPaths: string[] = [];
      const targets = [...(record.targets ?? [])];
      if (record.role === "resident") {
        const { input } = record;
        const stored = this.storedPatches(record, directory, display);
        storedIndex = stored.index; storedUnavailable = stored.unavailable;
        references.push(`Originally stored complete patches: ${storedIndex}`);
        this.immutable(join(directory, "details.json"), canonicalCollaborationJson(collaborationProposalMetadata(input)));
        references.push(`Proposal details: ${join(display, "details.json")}`);
        for (const entry of [input.open, ...input.entries]) {
          const factPath = join(display, "facts", `${entry.operation}.json`);
          this.immutable(join(directory, "facts", `${entry.operation}.json`), canonicalCollaborationJson({
            version: "collaboration-v1", request: record.request, operation: entry.operation,
            sequence: entry.sequence, actor: entry.actor, fact: entry.fact,
          }));
          references.push(`Accepted fact ${entry.sequence}: ${factPath}`);
          const fact = entry.fact;
          if (fact.kind === "review.integration") {
            const location = join(directory, "contexts", entry.operation);
            this.artifact(location, fact.diff, { request: record.request, revision: fact.revision,
              scope: entry.operation, kind: "integration-context", identity: fact.identity, source: fact.source });
            references.push(`Context ${entry.operation}: ${join(display, "contexts", entry.operation, "materials.json")}`);
          }
          // A challenge opening is also a related fact in its applied merge's
          // history. Its source is revision zero of the challenge, not a second
          // revision zero of that merge. Keep the related fact above, but only
          // the request's own opening owns its immutable source directory.
          if (((fact.kind === "merge.open" || fact.kind === "challenge.open") && entry.operation === record.request) ||
              fact.kind === "review.revise" || (fact.kind === "review.adopt" && fact.version === 3)) {
            const sourceRevision = fact.kind === "merge.open" || fact.kind === "challenge.open" ? 0 : fact.revision;
            const parts = ["revisions", String(sourceRevision), ...(fact.kind === "review.adopt" ? ["adoptions", entry.operation] : [])];
            const location = join(directory, ...parts), displayed = join(display, ...parts);
            this.materials.publish(location, fact.identity.expectedBase, fact.identity.candidate, {
              request: record.request, revision: sourceRevision, scope: null, sourceOperation: entry.operation,
              kind: fact.kind === "review.adopt" ? "policy-adoption-source-observation" : "proposal-source-observation", identity: fact.identity,
            });
            this.immutable(join(location, "summary.md"), ["# Frozen proposal revision", `Request: ${recordCell(record.name)}`,
              `Revision: ${sourceRevision}`, `Source operation: ${entry.operation}`,
              `Identity: ${recordCell(JSON.stringify(fact.identity))}`, `Accepted fact: ${factPath}`,
              "This source identity is not an integration result. Read current status separately.", ""].join("\n"));
            references.push(`Source ${sourceRevision}${fact.kind === "review.adopt" ? ` adoption ${entry.operation}` : ""}: ${join(displayed, "summary.md")} ; ${join(displayed, "manifest.json")}`);
            historicalSources++;
          }
        }
        const attempts = reviewAttempts(record);
        for (const attempt of attempts) {
          const integration = attempt.integration;
          historicalAttempts++;
          const observation = canonicalCollaborationJson({ version: "collaboration-v1", request: record.request,
            attemptNumber: attempt.attemptNumber, revision: attempt.revision, integration,
            authority: "separately observed original integration; no execution or new attempt" });
          const observationName = `${sha256Hex(observation)}.json`;
          this.immutable(join(directory, "attempts", integration.operation, observationName), observation);
          references.push(`Attempt ${attempt.attemptNumber} ${integration.state}: ${join(display, "attempts", integration.operation, observationName)}`);
          if (integration.state !== "succeeded") continue;
          const diff = storedAppliedDiff(integration);
          if (diff === undefined) {
            unavailable++;
            references.push(`Applied ${integration.operation}: originally stored complete diff unavailable; no reconstruction is labeled original.`);
            continue;
          }
          const appliedManifestSha256 = this.artifact(join(directory, "applied", integration.operation), diff, {
            request: record.request, revision: attempt.revision, kind: "applied", integration: integration.operation,
            identity: integration.identity,
          });
          references.push(`Applied ${integration.operation}: ${join(display, "applied", integration.operation, "materials.json")}`);
          if (record.societyBirth !== undefined && input.integration?.operation === integration.operation)
            targets.push(...collaborationReviewTargets(input, { actor: actor.name, role: actor.role,
              societyBirth: record.societyBirth, approvalPublished: false, appliedManifestSha256 }));
        }
        const open = input.open.fact;
        if (open.kind === "challenge.open") {
          const original = observations.find(candidate => candidate.role === "resident" && candidate.request === open.target.request);
          const attempt = original?.role === "resident" ? reviewAttempts(original).find(candidate => candidate.integration.operation === open.target.integration) : undefined;
          const integration = attempt?.integration;
          if (!attempt || !integration || integration.state !== "succeeded" || !integration.identity ||
              canonicalCollaborationJson(integration.identity) !== canonicalCollaborationJson(open.target.identity))
            throw new StoreError("STORE_CORRUPT", "challenge original differs from its exact succeeded applied delta");
          // Another historical source in the original request may be unavailable.
          // Publish these exact linked dependencies independently before exposing
          // the challenge pointer; never rely on another request's loop order.
          const diff = storedAppliedDiff(integration);
          if (diff !== undefined) {
            this.artifact(join(root, "reviews", open.target.request, "applied", open.target.integration), diff, {
              request: open.target.request, revision: attempt.revision, kind: "applied", integration: integration.operation, identity: integration.identity,
            });
          }
          const originalDirectory = join(displayRoot, "reviews", open.target.request, "applied", open.target.integration);
          this.immutable(join(directory, "original.json"), canonicalCollaborationJson({ version: "collaboration-v1",
            request: open.target.request, integration: open.target.integration, identity: open.target.identity,
            state: integration.diff === undefined ? "original-diff-unavailable" : "recorded-applied-delta",
            manifest: integration.diff === undefined ? null : join(originalDirectory, "manifest.json"),
            materials: integration.diff === undefined ? null : join(originalDirectory, "materials.json") }));
          references.push(`Original applied delta: ${join(display, "original.json")}`);
        }
      }
      for (const target of targets) {
        if (target.request !== record.request || target.requestName !== record.name || target.societyBirth !== record.societyBirth ||
            ((target.kind === "review" || target.kind === "vote") && target.actor !== actor.name) ||
            ((target.kind === "proposal" || target.kind === "submission") && target.requester !== actor.name) ||
            (actor.role === "principal" && target.kind !== "review" && target.kind !== "vote"))
          throw new StoreError("CAPABILITY_DENIED", "exact target does not belong to this permitted review observation");
        const encoded = encodeCollaborationTarget(target);
        this.immutable(join(directory, "targets", encoded.name), encoded.bytes);
        const reference = `${target.kind} target: ${join(display, "targets", encoded.name)}`;
        references.push(reference); targetPaths.push(reference);
      }
      // Reuse the owner's exact role projection, including current policy blockers,
      // quorum, reviewer exclusions and separately observed integration outcomes.
      if ("requests" in record.status) throw new StoreError("STORE_CORRUPT", "review record contains a list instead of status");
      const status = { ...record.status, ...("main" in record.status ? { main: { oid: record.status.main.oid } } : {}) };
      Reflect.deleteProperty(status, "observedAtMs");
      const full = JSON.stringify({ version: "collaboration-v1", role: record.role, request: record.request,
        status, ...(record.role === "principal" ? { ownVote: record.ownVote } : {}) }, null, 2) + "\n";
      const digest = sha256Hex(full), exact = `status-${digest}.json`;
      this.immutable(join(directory, "observations", exact), full);
      const permitted = [
        `Kind: ${record.status.kind}; tier: ${record.status.tier}`,
        `Title: ${recordCell(record.status.title)}`,
        `Source base: ${record.status.proposal.expectedBase}`,
        `Source candidate: ${record.status.proposal.candidate}`,
        `Source policy revision: ${recordCell(record.status.proposal.policyRevision)}`,
        `Decision base: ${record.status.identity.expectedBase}`,
        `Decision candidate: ${record.status.identity.candidate}`,
        `Decision policy revision: ${recordCell(record.status.identity.policyRevision)}`,
        `Integration phase: ${recordCell(record.status.integrationPhase)}; attempt: ${record.status.attemptNumber}`,
        `Integration notice (status owner): ${record.status.notice}; retryable: ${record.status.retryable}`,
        `Next action (status owner): ${recordCell(record.status.nextAction)}`,
        ...(record.role === "resident" ? [
          `Requester: ${recordCell(record.status.requester)}`,
          `Peer approvals required: ${record.status.required}; normal requirement: ${record.status.normalRequired}; remaining: ${record.status.remainingApprovals}`,
          `Capacity fallback: ${record.status.capacityFallback}; Principal required: ${record.status.principalRequired}`,
          `Recorded integration: ${recordCell(JSON.stringify(record.status.integration))}`,
          `Main observation: ${record.status.main.oid ?? "unavailable; not absence"}; refresh timing is separately recorded in ../../health.md`,
          ...(record.status.missing.length ? ["Missing conditions (status owner):", ...record.status.missing.map(value => `- ${recordCell(value)}`)]
            : ["Missing conditions (status owner): none reported by this observation"]),
        ] : [
          `Approval identity: ${record.status.approval ?? "none in this permitted observation"}`,
          `Own vote: ${record.ownVote === null ? "none in this permitted observation" : recordCell(JSON.stringify(record.ownVote))}`,
          "Worker quorum, requester and reviewer details are not exposed by this role projection.",
        ]),
        "Approval readiness or zero remaining approvals is not an integration-completion fact. Observe the original operation separately.",
        ...(targetPaths.length ? ["Available exact targets:", ...targetPaths] : ["Available exact targets: none in this permitted observation"]),
      ];
      const text = ["# Review status", `Request: ${recordCell(record.name)}`, `Revision: ${revision}`,
        `Display: ${recordCell(record.status.display)}`, `Scope: ${recordCell(record.status.scope ?? "source")}`,
        ...permitted,
        `Current permitted status: ${join(display, "observations", exact)}`,
        `Permitted materials and exact targets: ${join(display, "materials", "index.md")}`,
        "Latest refresh time/coverage: ../../health.md. Status files are observations, not effect authority.",
        ...(record.role === "resident" ? ["Recorded patches, OID-derived observations, policy adoptions and applied deltas are labeled separately."] : []), ""].join("\n");
      if (Buffer.byteLength(text) > this.pageBytes) throw new StoreError("LIMIT_EXCEEDED", "review status exceeds the presentation budget");
      const materialIndex = this.list(join(directory, "materials"), join(display, "materials"), "# Permitted review materials\nCoverage: exact immutable dependencies; observations grant no decision authority.\n", references);
      statuses.push({ path: join(directory, "materials", "index.md"), text: materialIndex });
      statuses.push({ path: join(directory, "status.md"), text });
      const row = `${recordCell(record.name)} | ${revision} | ${recordCell(record.status.display)} | ${join(display, "status.md")}`;
      for (const status of statuses) this.mutable(status.path, status.text);
      return { ok: true as const, row, unavailable, sources: historicalSources, attempts: historicalAttempts, storedUnavailable };
    } catch (error) {
      observeStoreFailure(this.store, error);
      return { ok: false as const, code: publicFailure(error).code, storedIndex };
    }
  }
  private artifact(directory: string, diff: ReviewDiffArtifact, identity: object): string {
    // The original decision manifest and patch keep their historical bytes and
    // target digest. Complete endpoint objects are a separately versioned companion.
    const materialSha256 = this.materials.publish(join(directory, "source-v1"), diff.base, diff.candidate,
      { ...identity, storedDiff: diff, kind: "stored-diff-endpoint-observation" });
    const manifestPath = join(directory, "manifest.json"), patchPath = join(directory, "proposal.patch");
    const cached = this.artifacts.get(manifestPath);
    const identitySha256 = sha256Hex(canonicalCollaborationJson({ ...identity, diff }));
    if (cached && cached.identitySha256 !== identitySha256)
      throw new StoreError("BROKER_UNAVAILABLE", "recorded review identity changed under an immutable artifact path");
    if (cached && this.exact(manifestPath, cached.manifestSha256, cached.manifestBytes) && this.exact(patchPath, diff.sha256, diff.bytes) &&
        cached.dependencies.every(file => this.exact(file.path, file.sha256, file.bytes))) return cached.manifestSha256;
    const artifact = this.git.readReviewDiffRecord(diff);
    if (artifact.patch.byteLength !== diff.bytes || sha256Hex(artifact.patch) !== diff.sha256)
      throw new StoreError("BROKER_UNAVAILABLE", "frozen review patch does not match its descriptor");
    const manifest = collaborationReviewManifest(identity, diff, artifact.paths);
    this.immutable(patchPath, artifact.patch);
    this.immutable(manifestPath, manifest);
    let utf8 = true;
    try { decodeUtf8(artifact.patch); } catch { utf8 = false; }
    const dependencies: { path: string; bytes: number; sha256: string }[] = [];
    const companion = (relative: string, bytes: string | Uint8Array): void => {
      const path = join(directory, relative); this.immutable(path, bytes);
      dependencies.push({ path, bytes: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength, sha256: sha256Hex(bytes) });
    };
    if (!utf8) companion("proposal.patch.bin", artifact.patch);
    companion("proposal.patch.txt", utf8 ? artifact.patch : ["# Original frozen patch requires binary-safe reading",
      "Exact bytes: proposal.patch.bin", `Bytes: ${diff.bytes}; SHA-256: ${diff.sha256}`,
      "Coverage: this is a pointer, not a text transcription or complete text diff. No replacement decoding was performed.", ""].join("\n"));
    companion("materials.json", canonicalCollaborationJson({ version: "collaboration-v1", kind: "stored-review-materials", identity,
      storedPatch: { ...diff, origin: "originally stored complete diff", reference: "proposal.patch", textReference: "proposal.patch.txt",
        binaryReference: utf8 ? null : "proposal.patch.bin", textEncoding: utf8 ? "exact-utf8" : "authored-pointer-only" },
      decisionManifest: { reference: "manifest.json", bytes: Buffer.byteLength(manifest), sha256: sha256Hex(manifest),
        coverage: "original decision manifest only; its historical not-projected binary field is not the companion's coverage" },
      endpointMaterials: { reference: "source-v1/manifest.json", sha256: materialSha256,
        origin: "separate observation from the exact stored base and candidate; not a replacement for the stored patch" } }));
    this.artifacts.set(manifestPath, { identitySha256, manifestBytes: Buffer.byteLength(manifest), manifestSha256: sha256Hex(manifest), dependencies });
    return sha256Hex(manifest);
  }
  private exact(path: string, sha256: string, bytes: number): boolean {
    const observed = observeImmutableFile(path, sha256, bytes);
    if (observed.kind === "absent") return false;
    if (observed.kind !== "present") throw new StoreError("BROKER_UNAVAILABLE", "review projection cannot be verified", { cause: observed });
    if (observed.bytes.byteLength !== bytes || sha256Hex(observed.bytes) !== sha256)
      throw new StoreError("BROKER_UNAVAILABLE", "immutable review projection conflicts with recorded bytes");
    return true;
  }
  private immutable(path: string, bytes: string | Uint8Array): void {
    const content = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    if (this.exact(path, sha256Hex(content), content.byteLength)) return;
    if (publishNoReplace(path, content, 0o444) === "existing") this.exact(path, sha256Hex(content), content.byteLength);
  }
  private mutable(path: string, text: string): void {
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    const observed = observeImmutableFile(path, sha256Hex(text), Buffer.byteLength(text));
    if (observed.kind === "present") return;
    if (observed.kind === "unavailable") throw observed.error;
    replaceDerivedFile(path, text, 0o444);
  }
  private index(root: string, displayRoot: string, rows: readonly string[]): string {
    return this.list(join(root, "reviews"), join(displayRoot, "reviews"),
      "# Permitted reviews\nCoverage: role-scoped observations; read reviews/health.md for freshness.\n", rows);
  }
  private list(directory: string, display: string, title: string, rows: readonly string[]): string {
    let nodes: string[] = [], chunk: string[] = [];
    const page = (lines: readonly string[]): string => {
      const text = title + lines.join("\n") + "\n", digest = sha256Hex(text);
      if (Buffer.byteLength(text) > this.pageBytes) throw new StoreError("LIMIT_EXCEEDED", "review index page exceeds the presentation budget");
      this.immutable(join(directory, "pages", `${digest}.md`), text);
      return join(display, "pages", `${digest}.md`);
    };
    for (const row of rows) {
      if (chunk.length && (chunk.length === 32 || Buffer.byteLength(title + [...chunk, row].join("\n") + "\n") > this.pageBytes)) {
        nodes.push(page(chunk)); chunk = [];
      }
      chunk.push(row);
    }
    if (chunk.length) nodes.push(page(chunk));
    while (nodes.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < nodes.length; i += 2) next.push(page(nodes.slice(i, i + 2).map(path => `Child: ${path}`)));
      nodes = next;
    }
    const entry = title + `Rows: ${rows.length}; More: none\n` + (nodes.length ? `Child: ${nodes[0]}\n` : "");
    if (Buffer.byteLength(entry) > this.pageBytes) throw new StoreError("LIMIT_EXCEEDED", "review index entry exceeds the presentation budget");
    return entry;
  }
}
