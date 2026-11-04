/** Incremental role-filtered mail discovery. Accepted facts remain with Mail /
 * Store; this cache contains indexing metadata, never message bodies or ACKs. */
import { dirname, join } from "node:path";
import type { Actor, MessageId, OperationId } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import { ownedMessages } from "@oma/domain/durable";
import { isValidTopicName } from "@oma/domain/identifiers";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace, replaceDerivedFile } from "@oma/storage/durable-fs";
import { observeImmutableFile, readImmutableBytes } from "@oma/storage/immutable-file";
import { CollaborationMailViews, recordCell, type IndexedMail } from "./collaboration-mail.js";

type HistoryStore = Pick<Store, "inTransaction" | "acceptedOperationPage" | "getAgent" | "getOperationById" | "getDelivery" | "deliveriesForOperation"> & Partial<Pick<Store, "observationStamp">>;
interface HistoryItem { readonly mail: IndexedMail; readonly row: string }
interface Row { readonly id: string; readonly sequence: number; readonly text: string }
interface Page { readonly path: string; readonly hash: string; readonly bytes: number; readonly count: number }
interface Bucket { readonly rows: Map<string, Row>; readonly pages: readonly Page[] }
interface HistoryIndex {
  readonly path: string; readonly title: string; readonly catalogSequence: number; readonly count: number;
  readonly buckets: ReadonlyMap<number, Bucket>; readonly nodes: ReadonlySet<string>;
}
interface HistoryState {
  readonly through: number; readonly records: ReadonlyMap<MessageId, HistoryItem>;
  readonly pending: ReadonlySet<MessageId>; readonly unresolved: ReadonlySet<MessageId>;
  readonly indexes: Map<string, HistoryIndex>;
  /** In-memory invalidator only; never persisted or compared across reopen. */
  readonly deliveryStamp: string | null;
}
interface Draft { readonly previous: HistoryIndex; readonly buckets: Map<number, Bucket>; readonly changed: Set<number>; count: number }
export interface MailHistoryRefresh {
  readonly root: string; readonly messages: number; readonly pending: number;
  readonly through: number; readonly refresh: "complete" | "partial";
}
const bases = [
  { path: "mail/index.md", title: "Permitted mail history" },
  { path: "mail/sent.md", title: "Your accepted, published messages" },
  { path: "mail/commons.md", title: "Commons history" },
  { path: "mail/topics/index.md", title: "Mail topics" },
  { path: "mail/threads/index.md", title: "Mail threads" },
];
// Layout partition, NOT a history/retention limit. Only a changed acceptance
// bucket is repacked. Immutable navigation uses a compressed binary range tree:
// appends do not rewrite older pages just to change their next-page link.
const ACCEPTANCES_PER_BUCKET = 32;

export class CollaborationMailHistory {
  private readonly state = new Map<Actor, HistoryState>();
  hasPublishedRecord(actor: Actor, message: MessageId): boolean { return this.state.get(actor)?.records.has(message) ?? false; }
  private readonly pageBytes: number;
  constructor(private readonly store: HistoryStore, _mail: Pick<MailModule, "readRecord">,
    private readonly records: CollaborationMailViews, private readonly stateRoot: string, frameBytes = 64 * 1024) {
    if (!Number.isSafeInteger(frameBytes) || frameBytes < 1) throw new RangeError("invalid history page budget");
    this.pageBytes = Math.min(64 * 1024, frameBytes);
  }

  /** Query new acceptances/pending archives/explicit dirty sources. Source bodies
   * live only during publication; the projection owner reads each source once. */
  refresh(actor: Actor, dirty: readonly OperationId[] = [], observedAtMs = Date.now()): MailHistoryRefresh {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "mail history cannot publish in T");
    if (this.store.getAgent(actor) === null) throw new StoreError("ADDRESS_NOT_FOUND", "mail history reader does not exist");
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0 || !Number.isFinite(new Date(observedAtMs).getTime()))
      throw new RangeError("invalid history observation time");
    const root = this.records.rootFor(actor), observedAt = new Date(observedAtMs).toISOString(), previous = this.state.get(actor);
    const displayRoot = this.records.displayRootFor(actor);
    try {
      const deliveryStamp = this.store.observationStamp?.() ?? null;
      const selected = new Map(previous?.records), pending = new Set(previous?.pending), unresolved = new Set(previous?.unresolved);
      const inspect = new Set<MessageId>([...pending, ...unresolved]), touched = new Set<MessageId>();
      let cursor = previous?.through ?? 0, through: number | undefined;
      for (;;) {
        const page = this.store.acceptedOperationPage(cursor, through); through = page.through;
        for (const item of page.items) for (const message of ownedMessages(item.operation.plan)) inspect.add(message.id);
        if (page.next === null) break;
        cursor = page.next;
      }
      for (const id of dirty) {
        const operation = this.store.getOperationById(id);
        if (operation === null) throw new StoreError("BROKER_UNAVAILABLE", "dirty history source cannot be observed");
        for (const message of ownedMessages(operation.plan)) inspect.add(message.id);
      }
      for (const item of this.records.publishRecords(actor, [...inspect], (id, state) => {
        if (state === "archive-absent") pending.add(id);
        else { selected.delete(id); pending.delete(id); unresolved.delete(id); touched.add(id); }
      })) {
        const id = item.record.message;
        pending.delete(id); touched.add(id);
        if (item.thread.pendingParent !== undefined) unresolved.add(id); else unresolved.delete(id);
        selected.set(id, { mail: item, row: this.deliveryRow(actor, item, displayRoot) });
      }
      // Receipt/delivery mutations need not append an operation. Refresh only the
      // indexed metadata, not EML/body bytes, when the connection-local hint changes.
      // A missing hint is never taken as proof that mutable delivery facts are stable.
      if (deliveryStamp === null || previous?.deliveryStamp !== deliveryStamp) {
        for (const [id, item] of selected) {
          if (touched.has(id)) continue;
          const row = this.deliveryRow(actor, item.mail, displayRoot);
          if (row !== item.row) { selected.set(id, { mail: item.mail, row }); touched.add(id); }
        }
      }
      const state: HistoryState = { through: through!, deliveryStamp, records: selected, pending, unresolved, indexes: new Map(previous?.indexes) };
      const refresh = pending.size ? "partial" as const : "complete" as const;
      this.publishIndexes(root, actor, state, previous, touched, observedAt);
      replaceDerivedFile(join(root, "mail/health.md"), this.health(observedAt, refresh, state), 0o444);
      // No cursor, index layout or source-observation cache advances on failure.
      this.state.set(actor, state);
      return Object.freeze({ root, messages: selected.size, pending: pending.size, through: state.through, refresh });
    } catch (error) {
      try { ensureOwnedDirectory(join(root, "mail"), this.stateRoot); replaceDerivedFile(join(root, "mail/health.md"), this.health(observedAt, "unavailable", previous), 0o444); }
      catch (healthError) { throw new AggregateError([error, healthError], "history refresh and health publication failed"); }
      throw error;
    }
  }

  private deliveryRow(actor: Actor, item: IndexedMail, displayRoot: string): string {
    const id = item.record.message; let delivery: string;
    if (item.record.sender === actor) {
      const rows = this.store.deliveriesForOperation(item.record.operation).filter(row => row.messageId === id);
      delivery = `accepted; mailbox materialized ${rows.filter(row => row.materialized === 1).length}/${rows.length}; not a read receipt`;
    } else {
      const row = this.store.getDelivery(id, actor);
      if (row !== null && row.operationId !== item.record.operation)
        throw new StoreError("STORE_CORRUPT", "history delivery belongs to another accepted operation");
      delivery = row === null ? "published archive; no delivery to this reader" : row.materialized === 0 ? "accepted; mailbox pending"
        : row.presented === 1 ? "presented; not a read receipt" : "mailbox materialized; not a read receipt";
    }
    return `${item.sequence} | ${recordCell(item.record.sender)} | ${recordCell(item.record.subject)} | ` +
      `${recordCell(item.record.to.join(", "))} | ${recordCell(delivery)} | ` +
      `${recordCell(join(displayRoot, "mail/messages", `${id}.md`))} | ${recordCell(join(displayRoot, "mail/metadata", `${id}.json`))}`;
  }

  private groups(actor: Actor, item: HistoryItem) {
    const groups = [bases[0]!];
    if (item.mail.record.sender === actor) groups.push(bases[1]!);
    if (item.mail.record.to.includes("commons")) groups.push(bases[2]!);
    for (const address of item.mail.record.to) if (address.startsWith("topic/")) {
      const topic = address.slice(6);
      if (!isValidTopicName(topic)) throw new StoreError("STORE_CORRUPT", "mail history contains an invalid logical topic");
      groups.push({ path: `mail/topics/${topic}/index.md`, title: `Topic ${recordCell(topic)}` });
    }
    groups.push({ path: `mail/threads/${item.mail.thread.thread}/index.md`, title: `Thread ${item.mail.thread.thread}` });
    return new Map(groups.map(group => [group.path, group]));
  }

  private publishIndexes(root: string, actor: Actor, state: HistoryState, previous: HistoryState | undefined,
    touched: ReadonlySet<MessageId>, observedAt: string): void {
    const displayRoot = this.records.displayRootFor(actor);
    const drafts = new Map<string, Draft>();
    const draft = (path: string, title: string, sequence: number): Draft => {
      let value = drafts.get(path);
      if (!value) {
        const before = previous?.indexes.get(path) ?? { path, title, catalogSequence: sequence, count: 0, buckets: new Map(), nodes: new Set<string>() };
        value = { previous: before, buckets: new Map(before.buckets), changed: new Set(), count: before.count }; drafts.set(path, value);
      }
      return value;
    };
    const patch = (path: string, title: string, row: Row, remove: boolean) => {
      const key = Math.floor(row.sequence / ACCEPTANCES_PER_BUCKET), old = drafts.get(path)?.buckets.get(key) ?? previous?.indexes.get(path)?.buckets.get(key);
      const exists = old?.rows.get(row.id);
      if (remove ? !exists : exists?.text === row.text && exists.sequence === row.sequence) return;
      const value = draft(path, title, row.sequence);
      if (!value.changed.has(key)) {
        value.buckets.set(key, { rows: new Map(old?.rows), pages: [] }); value.changed.add(key);
      }
      const rows = value.buckets.get(key)!.rows;
      if (remove) { rows.delete(row.id); value.count--; }
      else { if (!rows.has(row.id)) value.count++; rows.set(row.id, row); }
    };
    if (!previous) for (const index of bases) draft(index.path, index.title, 0);
    for (const id of touched) {
      const before = previous?.records.get(id), after = state.records.get(id);
      const oldGroups = before ? this.groups(actor, before) : new Map<string, { path: string; title: string }>();
      const newGroups = after ? this.groups(actor, after) : new Map<string, { path: string; title: string }>();
      for (const [path, group] of oldGroups) if (!newGroups.has(path)) patch(path, group.title, { id, sequence: before!.mail.sequence, text: before!.row }, true);
      if (after) for (const [path, group] of newGroups) patch(path, group.title, { id, sequence: after.mail.sequence, text: after.row }, false);
    }
    // Topic/thread directory entries change only on group creation/removal, not
    // when any unrelated message or an existing group's observation changes.
    for (const [path, value] of [...drafts]) {
      const match = /^mail\/(topics|threads)\/([^/]+)\/index\.md$/.exec(path);
      if (!match || Boolean(value.previous.count) === Boolean(value.count)) continue;
      const directory = `mail/${match[1]}/index.md`, title = match[1] === "topics" ? "Mail topics" : "Mail threads";
      patch(directory, title, { id: path, sequence: value.previous.catalogSequence, text: `- ${recordCell(match[2]!)}: ${join(displayRoot, path)}` }, !value.count);
    }
    const writes: { path: string; text: string }[] = [], entries: { path: string; text: string }[] = [];
    for (const [path, value] of drafts) {
      const nodes = new Set<string>(), texts = new Map<string, string>();
      const header = (generation: string, count: number) => [`# ${value.previous.title}`, `Generation: ${generation}`,
        "Coverage: immutable index partition. Current observation/range: mail/health.md; no cross-file snapshot is claimed.",
        `Rows: ${count}; More: none`, ""].join("\n");
      const leaf = (generation: string, rows: readonly Row[]) => header(generation, rows.length) +
        ["Order | Sender | Subject | Destination | Observation | Body | Metadata", ...rows.map(row => row.text), ""].join("\n");
      const page = (rows: readonly Row[] | null, children: readonly Page[] = []): Page => {
        const generation = sha256Hex(JSON.stringify({ path, title: value.previous.title, rows: rows?.map(row => row.text), children: children.map(child => child.path) }));
        const location = join(root, "mail/pages", `${generation}.md`), count = rows?.length ?? children.reduce((sum, child) => sum + child.count, 0);
        const text = rows === null ? header(generation, 0) +
          ["Read each Child link to traverse the disjoint partitions of this snapshot.", ...children.map(child => `Child: ${join(displayRoot, "mail/pages", child.path.slice(child.path.lastIndexOf("/") + 1))}`), ""].join("\n") : leaf(generation, rows);
        if (Buffer.byteLength(text) > this.pageBytes - 256) throw new StoreError("LIMIT_EXCEEDED", "history partition exceeds the presentation budget");
        const result = { path: location, hash: sha256Hex(text), bytes: Buffer.byteLength(text), count };
        nodes.add(location); texts.set(location, text);
        if (!value.previous.nodes.has(location)) writes.push({ path: location, text });
        return result;
      };
      const combine = (pages: readonly Page[]): Page => {
        if (pages.length === 1) return pages[0]!;
        const middle = Math.floor(pages.length / 2);
        return page(null, [combine(pages.slice(0, middle)), combine(pages.slice(middle))]);
      };
      for (const key of value.changed) {
        const bucket = value.buckets.get(key)!;
        if (!bucket.rows.size) { value.buckets.delete(key); continue; }
        const sorted = [...bucket.rows.values()].sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const pages: Page[] = []; let rows: Row[] = [];
        for (const row of sorted) {
          // The same renderer reserves the complete digest; only this changed
          // acceptance bucket is repacked, never all historical message rows.
          if (Buffer.byteLength(leaf("0".repeat(64), [...rows, row])) > this.pageBytes - 256) {
            if (!rows.length) throw new StoreError("LIMIT_EXCEEDED", "one history row exceeds the presentation budget");
            pages.push(page(rows)); rows = [];
          }
          rows.push(row);
        }
        if (rows.length) pages.push(page(rows));
        value.buckets.set(key, { rows: bucket.rows, pages });
      }
      const buckets = [...value.buckets].sort(([a], [b]) => a - b);
      for (const [, bucket] of buckets) for (const leaf of bucket.pages) nodes.add(leaf.path);
      const tree = (items: readonly [number, Bucket][]): Page => {
        if (!items.length) return page([]);
        if (items.length === 1) return combine(items[0]![1].pages);
        const first = items[0]![0], last = items.at(-1)![0]; let width = 1;
        while (Math.floor(first / width) !== Math.floor(last / width)) width *= 2;
        const boundary = Math.floor(first / width) * width + width / 2;
        const split = items.findIndex(([key]) => key >= boundary);
        return page(null, [tree(items.slice(0, split)), tree(items.slice(split))]);
      };
      const top = tree(buckets);
      const text = texts.get(top.path) ?? readImmutableBytes(top.path, top.hash, top.bytes).toString("utf8");
      const current = text + `\nIndex content changed at: ${observedAt}\nLedger through at this content change: ${state.through}\nRefresh status and newer unchanged observations: mail/health.md\n`;
      if (Buffer.byteLength(current) > this.pageBytes) throw new StoreError("LIMIT_EXCEEDED", "history entry point exceeds the presentation budget");
      entries.push({ path: join(root, path), text: current });
      state.indexes.set(path, { ...value.previous, count: value.count, buckets: value.buckets, nodes });
    }
    // Every newly referenced immutable node precedes every mutable entry point.
    for (const write of writes) this.immutable(write.path, write.text);
    for (const entry of entries) replaceDerivedFile(entry.path, entry.text, 0o444);
  }

  private immutable(path: string, text: string): void {
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    const hash = sha256Hex(text), bytes = Buffer.byteLength(text), observed = observeImmutableFile(path, hash, bytes);
    if (observed.kind === "present") return;
    if (observed.kind !== "absent") throw new StoreError("BROKER_UNAVAILABLE", "mail history page conflicts with its source", { cause: observed.error });
    if (publishNoReplace(path, text, 0o444) === "existing") {
      try { readImmutableBytes(path, hash, bytes); }
      catch (cause) { throw new StoreError("BROKER_UNAVAILABLE", "mail history page conflicts with its source", { cause }); }
    }
  }
  private health(observedAt: string, refresh: "complete" | "partial" | "unavailable", state?: HistoryState): string {
    return ["# Mail history health", `Observed at: ${observedAt}`, `Refresh: ${refresh}`, `Last successful ledger range: ${state?.through ?? "none"}`,
      `Published messages: ${state?.records.size ?? "unknown"}; archives absent: ${state?.pending.size ?? "unknown"}`,
      "Scope: mail history only. Archive absence does not explain publication state; unavailable is not empty.",
      "Mutable delivery counts/presentation are read from delivery rows after connection-local invalidation; acceptance order is not mutation freshness.",
      "More links and disjoint Child links point at immutable snapshot partitions; unchanged partitions are reused.",
      "Other record families and current-inbox refresh have separate owners. Reads create no ACK or delivery facts.", ""].join("\n");
  }
}
