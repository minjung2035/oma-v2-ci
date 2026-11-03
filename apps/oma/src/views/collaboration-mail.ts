/** MCS-R01..004/R08: the first collaboration-v1 projection slice.
 * Explicit host API only: legacy sessions keep their existing batch views.
 * This publishes one verified prepared batch, not a complete history or a new
 * delivery/ACK fact. Mount/containment and activation are separate cutover work. */
import { dirname, join } from "node:path";
import type { Actor, MessageId, PreparedBatch } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { MailModule, MailRecordFacts } from "@oma/mail";
import { collaborationRecordRootPathAt } from "@oma/domain/paths";
import { parseMessageId } from "@oma/domain/identifiers";
import { sha256Hex } from "@oma/domain/canonical-json";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { StoreError } from "@oma/domain/errors";
import { rfcMessageIdFor } from "@oma/mail/addresses";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace, replaceDerivedFile } from "@oma/storage/durable-fs";
import { observeImmutableFile, readImmutableBytes } from "@oma/storage/immutable-file";

type RecordStore = Pick<Store, "inTransaction" | "getAgent" | "getBatch" | "getDelivery" | "operationSequence">;
export interface IndexedMail {
  readonly record: Pick<MailRecordFacts, "message" | "operation" | "sender" | "subject" | "to" | "bodyBytes" | "bodySha256">;
  readonly sequence: number;
  readonly thread: Thread;
}
interface CollectedMail { readonly record: MailRecordFacts; readonly sequence: number; readonly metadata: string; readonly thread: Thread }
interface Thread { readonly replyTo: MessageId | null; readonly thread: MessageId; readonly parentUnavailable: boolean; readonly pendingParent?: MessageId }
const DEFAULT_PAGE_BYTES = 64 * 1024;

/** Escape presentation, not source bytes. No body is promoted to metadata. */
function cell(value: string): string {
  return value.replace(/[\\|`<>\[\]*\u0000-\u001f\u007f-\u009f]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export { cell as recordCell };
/** One byte-budget partitioner for ordinary record indexes. The caller publishes
 * every immutable page before replacing its mutable discovery entry. */
export function recordPages(rows: readonly string[], budget: number,
  header: (count: number, next: string) => string, path: (page: number) => string): string[] {
  // Reserve a worst-case next-page number while partitioning. This is a byte
  // budget for presentation, never a message/history retention quota.
  const reserve = path(Number.MAX_SAFE_INTEGER);
  const groups: string[][] = [];
  let current: string[] = [];
  for (const row of rows) {
    const candidate = [...current, row];
    if (Buffer.byteLength(header(candidate.length, reserve) + candidate.join("\n") + "\n") > budget) {
      if (current.length === 0) throw new StoreError("LIMIT_EXCEEDED", "one record index row exceeds the presentation budget");
      groups.push(current); current = [row];
      if (Buffer.byteLength(header(1, reserve) + row + "\n") > budget)
        throw new StoreError("LIMIT_EXCEEDED", "one record index row exceeds the presentation budget");
    } else current = candidate;
  }
  groups.push(current);
  return groups.map((group, index) => {
    const page = header(group.length, index + 1 < groups.length ? path(index + 2) : "none") + group.join("\n") + "\n";
    if (Buffer.byteLength(page) > budget) throw new StoreError("LIMIT_EXCEEDED", "record index header exceeds the presentation budget");
    return page;
  });
}
function sameManifest(actual: unknown, expected: readonly MessageId[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

export class CollaborationMailViews {
  private readonly pageBytes: number;
  // Only complete, verified immutable relations, partitioned by actor AND role.
  // Never retain a MailRecordFacts/body or cache permission/availability failures.
  private readonly threads = new Map<string, Map<MessageId, Thread>>();
  constructor(private readonly store: RecordStore, private readonly mail: Pick<MailModule, "readRecord">,
    private readonly stateRoot: string, private readonly society: string, frameBytes = DEFAULT_PAGE_BYTES) {
    if (!Number.isSafeInteger(frameBytes) || frameBytes < 1) throw new RangeError("invalid mail record frame budget");
    this.pageBytes = Math.min(DEFAULT_PAGE_BYTES, frameBytes);
  }
  rootFor(actor: Actor): string { return collaborationRecordRootPathAt(this.stateRoot, actor); }
  displayRootFor(actor: Actor): string {
    const row = this.store.getAgent(actor);
    if (row === null) throw new StoreError("AUTH_FAILED", "mail record actor is unknown");
    return row.role === "resident" ? RESIDENT_PATHS.records : this.rootFor(actor);
  }

  /** Explicit host projection over already role-filtered source observations.
   * No delivery is required for existing public history; this creates no row. */
  publishRecords(actor: Actor, ids: readonly MessageId[], unavailable?: (id: MessageId, state: "archive-absent" | "denied") => void): readonly IndexedMail[] {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "mail records cannot publish in T");
    if (this.store.getAgent(actor) === null) throw new StoreError("ADDRESS_NOT_FOUND", "mail record reader does not exist");
    if (new Set(ids).size !== ids.length) throw new StoreError("INVALID_REQUEST", "duplicate projection message identity");
    const root = this.rootFor(actor), result: IndexedMail[] = [];
    for (const id of ids) {
      let observed: ReturnType<MailModule["readRecord"]>;
      try { observed = this.mail.readRecord(actor, id); }
      catch (error) {
        if (!unavailable || !(error instanceof StoreError) || error.code !== "CAPABILITY_DENIED") throw error;
        unavailable(id, "denied"); continue;
      }
      if (observed.state !== "published") {
        if (!unavailable) throw new StoreError("BROKER_UNAVAILABLE", "mail record archive is not published");
        unavailable(id, "archive-absent"); continue;
      }
      const item = this.collect(actor, null, id, root, observed.record);
      this.immutable(root, `mail/messages/${id}.md`, item.record.body);
      this.metadata(root, id, item.metadata);
      // Deliberate field selection: no body, serialized metadata, reply-header
      // ancestry arrays or closure over the original observation survives here.
      const { message, operation, sender, subject, to, bodyBytes, bodySha256 } = item.record;
      result.push({ record: { message, operation, sender, subject, to, bodyBytes, bodySha256 }, sequence: item.sequence, thread: item.thread });
    }
    return result;
  }

  /** No await and no transaction: the single broker writer cannot interleave a
   * mutation during collection. Filesystem observations are explicitly separate;
   * this does not advertise a cross-file or global ledger snapshot. */
  publishBatch(batch: PreparedBatch, observedAtMs = Date.now()): { readonly root: string; readonly pages: number; readonly messages: number; readonly batch: string; readonly incarnation: number; readonly generation: string; readonly indexPath: string } {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "mail batch records cannot publish in T");
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0 || !Number.isFinite(new Date(observedAtMs).getTime()))
      throw new RangeError("invalid mail record observation time");
    // Verify scope before writing even health. A forged actor/manifest must not
    // create another actor's directory or erase its last good index.
    const row = this.store.getBatch(batch.id);
    const agent = this.store.getAgent(batch.agent);
    let manifest: unknown;
    try { manifest = row === null ? null : JSON.parse(row.messageIdsJson); }
    catch (cause) { throw new StoreError("STORE_CORRUPT", "mail record batch manifest is not JSON", { cause }); }
    if (!Number.isSafeInteger(batch.incarnation) || batch.incarnation < 0)
      throw new StoreError("BATCH_CONFLICT", "mail record batch attempt is invalid");
    if (row === null || agent === null || row.state !== "prepared" || row.agent !== batch.agent ||
        row.incarnation > batch.incarnation || batch.incarnation > agent.incarnation ||
        !sameManifest(manifest, batch.messageIds))
      throw new StoreError("BATCH_CONFLICT", "mail record scope differs from the prepared batch");
    const root = this.rootFor(batch.agent);
    const observedAt = new Date(observedAtMs).toISOString();
    try {
      const records = batch.messageIds.map(id => this.collect(batch.agent, batch.id, id, root));
      const ledgerThrough = records.reduce((through, item) => Math.max(through, item.sequence), 0);
      const generation = sha256Hex(JSON.stringify({ batch: batch.id, incarnation: batch.incarnation, observedAt, records: records.map(item => item.metadata) }));
      const pages = this.pages(this.displayRootFor(batch.agent), batch, records, generation, ledgerThrough, observedAt);
      // Publish immutable dependencies before any mutable index references them.
      for (const item of records) {
        this.immutable(root, `mail/messages/${item.record.message}.md`, item.record.body);
        this.metadata(root, item.record.message, item.metadata);
      }
      for (const [index, page] of pages.entries()) this.immutable(root, `mail/inbox/pages/${generation}-${index + 1}.md`, page);
      // `inbox.md` is only this batch. It makes no claim that omitted historical
      // or pending deliveries are absent; discovery of full history comes later.
      replaceDerivedFile(join(root, "mail", "inbox.md"), pages[0]!, 0o444);
      replaceDerivedFile(join(root, "health.md"), this.health(observedAt, "complete", batch.id), 0o444);
      return Object.freeze({ root, pages: pages.length, messages: records.length, batch: batch.id, incarnation: batch.incarnation, generation,
        indexPath: join(this.displayRootFor(batch.agent), "mail", "inbox", "pages", `${generation}-1.md`) });
    } catch (error) {
      try { replaceDerivedFile(join(root, "health.md"), this.health(observedAt, "unavailable", batch.id), 0o444); }
      catch (healthError) { throw new AggregateError([error, healthError], "mail record refresh and health publication failed"); }
      throw error;
    }
  }

  private collect(actor: Actor, batch: string | null, id: MessageId, _root: string, source?: MailRecordFacts): CollectedMail {
    const delivery = this.store.getDelivery(id, actor);
    if (batch !== null && (delivery === null || delivery.batchId !== batch || delivery.materialized !== 1))
      throw new StoreError("BATCH_CONFLICT", "mail record has no materialized delivery in this batch");
    let record = source;
    if (record === undefined) {
      const observed = this.mail.readRecord(actor, id);
      if (observed.state !== "published") throw new StoreError("BROKER_UNAVAILABLE", "mail record archive is not published");
      record = observed.record;
    }
    if (delivery !== null && record.operation !== delivery.operationId) throw new StoreError("STORE_CORRUPT", "mail record operation differs from delivery");
    const sequence = this.store.operationSequence(record.operation);
    if (sequence === null) throw new StoreError("STORE_CORRUPT", "mail record acceptance sequence is missing");
    const thread = this.thread(actor, record);
    const metadata = JSON.stringify({ version: "collaboration-v1", message: id, sender: record.sender,
      subject: record.subject, to: record.to, ...(record.recipients === undefined ? {} : { recipients: record.recipients }),
      audience: record.audience, replyTo: thread.replyTo, thread: thread.thread, parentUnavailable: thread.parentUnavailable, acceptedSequence: sequence,
      bodyPath: join(this.displayRootFor(actor), "mail", "messages", `${id}.md`), bodyBytes: record.bodyBytes, bodySha256: record.bodySha256,
      attachments: record.attachments, source: record.source,
      ...(record.review === undefined ? {} : { review: record.review }),
      ...(record.approvalFor === undefined ? {} : { approvalFor: record.approvalFor }),
      // Explicit verified display/storage mapping, not a raw RFC basename.
      rfcMessageId: record.rfcMessageId, contextRevision: record.contextRevision,
    }, null, 2) + "\n";
    return { record, sequence, metadata, thread };
  }

  private thread(actor: Actor, record: MailRecordFacts): Thread {
    const reader = this.store.getAgent(actor);
    if (reader === null) throw new StoreError("ADDRESS_NOT_FOUND", "mail record reader does not exist");
    const scope = `${actor}\0${reader.role}`, cache = this.threads.get(scope) ?? new Map<MessageId, Thread>();
    const parentOf = (mail: MailRecordFacts): MessageId | null => {
      const rfc = mail.replyHeaders.inReplyTo;
      if (rfc === null) return null;
      const id = rfc.split("@", 1)[0]!;
      if (parseMessageId(id) === null || rfcMessageIdFor(id, this.society) !== rfc)
        throw new StoreError("STORE_CORRUPT", "mail thread parent is not a Society storage identity");
      return id;
    };
    const replyTo = parentOf(record), own = cache.get(record.message);
    if (own) {
      if (own.replyTo !== replyTo) throw new StoreError("STORE_CORRUPT", "verified immutable mail parent changed");
      return own;
    }
    const trail: { message: MessageId; replyTo: MessageId | null }[] = [], seen = new Set<MessageId>();
    let current = record;
    for (;;) {
      if (seen.has(current.message)) throw new StoreError("STORE_CORRUPT", "mail thread ancestry is cyclic");
      seen.add(current.message);
      const parent = parentOf(current);
      trail.push({ message: current.message, replyTo: parent });
      const known = parent === null ? undefined : cache.get(parent);
      if (parent === null || known !== undefined) {
        const root = known?.thread ?? current.message;
        if (parent !== null && seen.has(root)) throw new StoreError("STORE_CORRUPT", "mail thread ancestry is cyclic");
        for (const link of trail) cache.set(link.message, Object.freeze({ replyTo: link.replyTo, thread: root, parentUnavailable: false }));
        this.threads.set(scope, cache);
        return cache.get(record.message)!;
      }
      if (seen.has(parent)) throw new StoreError("STORE_CORRUPT", "mail thread ancestry is cyclic");
      let observed: ReturnType<MailModule["readRecord"]>;
      try { observed = this.mail.readRecord(actor, parent); }
      catch (error) {
        if (error instanceof StoreError && error.code === "CAPABILITY_DENIED")
          return { replyTo, thread: current.message, parentUnavailable: true };
        throw error;
      }
      if (observed.state !== "published") return { replyTo, thread: current.message, parentUnavailable: true, pendingParent: parent };
      current = observed.record;
    }
  }

  private pages(root: string, batch: PreparedBatch, records: readonly CollectedMail[], generation: string,
    through: number, observedAt: string): string[] {
    const path = (page: number) => join(root, "mail", "inbox", "pages", `${generation}-${page}.md`);
    const rows = records.map(({ record, sequence }) =>
      `${sequence} | ${cell(record.sender)} | ${cell(record.subject)} | ${cell(record.to.join(", "))} | materialized; not a read receipt | ` +
      `${cell(join(root, "mail", "messages", `${record.message}.md`))} | ${cell(join(root, "mail", "metadata", `${record.message}.json`))}`);
    const header = (count: number, next: string) => ["# Inbox", `Generation: ${generation}`, `Ledger through: ${through}`,
      `Observed at: ${observedAt}`, "Refresh: complete", `Coverage: batch ${batch.id} only; ${records.length} messages; not complete history`,
      `Rows: ${count}; More: ${next}`, "", "Order | Sender | Subject | Destination | State | Body | Metadata", ""].join("\n");
    try { return recordPages(rows, this.pageBytes, header, path); }
    catch (error) { if (!(error instanceof StoreError) || error.code !== "LIMIT_EXCEEDED") throw error; }
    // The delivery manifest remains complete even at a small frame. Relative
    // references avoid repeating the host root; only display cells may elide,
    // with the exact subject/destinations retained in authenticated metadata.
    const relativePath = (page: number) => `mail/inbox/pages/${generation}-${page}.md`;
    const compactHeader = (count: number, next: string) => ["# Inbox", `Generation: ${generation}`, `Ledger through: ${through}`,
      `Observed at: ${observedAt}`, "Refresh: complete", `Coverage: batch ${batch.id} only; ${records.length} messages; not complete history`,
      `Rows: ${count}; More: ${next}`, "Paths relative to record root; full fields in metadata. Not a read receipt.",
      "Order | Sender | Subject | Destination | State | Body | Metadata", ""].join("\n");
    const room = this.pageBytes - Buffer.byteLength(compactHeader(1,relativePath(Number.MAX_SAFE_INTEGER))) - 1;
    const summary = (value: string, budget: number): string => {
      const full = cell(value); if (Buffer.byteLength(full) <= budget) return full;
      const marker = "… [metadata]"; let result = "", used = Buffer.byteLength(marker);
      if (used > budget) throw new StoreError("LIMIT_EXCEEDED", "record index cannot carry its metadata reference");
      for (const point of value) { const encoded = cell(point), bytes = Buffer.byteLength(encoded);
        if (used + bytes > budget) break; result += encoded; used += bytes; }
      return result + marker;
    };
    const compactRows = records.map(({record,sequence}) => {
      const row = (subject: string, to: string) => `${sequence} | ${cell(record.sender)} | ${subject} | ${to} | materialized | ` +
        `mail/messages/${record.message}.md | mail/metadata/${record.message}.json`;
      const cells = room - Buffer.byteLength(row("",""));
      return row(summary(record.subject,Math.floor(cells/2)),summary(record.to.join(", "),Math.ceil(cells/2)));
    });
    return recordPages(compactRows,this.pageBytes,compactHeader,relativePath);
  }

  private metadata(root: string, id: MessageId, text: string): void {
    const path = join(root, "mail", "metadata", `${id}.json`);
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    const observed = observeImmutableFile(path, sha256Hex(text), Buffer.byteLength(text));
    if (observed.kind === "present") return;
    if (observed.kind === "unavailable") throw observed.error;
    // Derived metadata may legitimately change (e.g. a formerly absent parent).
    replaceDerivedFile(path, text, 0o444);
  }
  private immutable(root: string, relative: string, text: string): void {
    const path = join(root, relative);
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    const observed = observeImmutableFile(path, sha256Hex(text), Buffer.byteLength(text));
    if (observed.kind === "present") return;
    if (observed.kind !== "absent") throw new StoreError("BROKER_UNAVAILABLE", "mail projection conflicts with its verified source", { cause: observed.error });
    if (publishNoReplace(path, text, 0o444) === "existing") {
      try { readImmutableBytes(path, sha256Hex(text), Buffer.byteLength(text)); }
      catch (cause) {
        // Rebuildable projection corruption is not corruption of accepted facts.
        throw new StoreError("BROKER_UNAVAILABLE", "mail projection conflicts with its verified source", { cause });
      }
    }
  }
  private health(observedAt: string, refresh: "complete" | "unavailable", batch: string): string {
    return ["# Record health", `Observed at: ${observedAt}`, `Mail batch refresh: ${refresh}`, `Batch: ${batch}`,
      "Coverage: prepared inbox batch only; full mail history and other record families are not implemented.",
      "Overall refresh: partial. A missing record is not proof of absence.",
      "Reads do not acknowledge mail or complete a batch.", ""].join("\n");
  }
}
