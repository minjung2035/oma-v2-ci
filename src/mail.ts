// MUST [MAIL-001..010]: eml encoding, recipient expansion, materialization,
// batch handoff. Headers are encoded through a pinned, widely-deployed email
// library (nodemailer 10.0.1) per MAIL-003; CR/LF injection is still rejected
// at this boundary before the library sees the values.
import {
  mkdirSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  linkSync,
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { createTransport } from "nodemailer";
import { join, dirname } from "node:path";
import type {
  Actor,
  Address,
  Json,
  MailInput,
  MessageId,
  Oid,
  RequestKey,
  AuthContext,
  PreparedBatch,
  BoundaryEvidence,
  Receipt,
} from "../implementation/contracts.js";
import { Store, StoreError, type OperationRow } from "./store.js";
import {
  generateMessageId,
  generateOperationId,
  generateBatchId,
} from "./ids.js";
import { isValidTopicName } from "./ids.js";
import { sha256Hex, requestHash, canonicalRequestParams } from "./hash.js";

// ---------------------------------------------------------------------------
// eml encoding (MAIL-003/004)
// ---------------------------------------------------------------------------

export interface EmlParams {
  from: string;
  to: string[];
  replyTo: string[];
  subject: string;
  kind: MailInput["kind"];
  contextRevision: Oid | null;
  inReplyTo: MessageId | null;
  references: MessageId[];
  messageId: string; // `<m-id@society.oma.invalid>` contents without angle brackets
  body: string; // LF-normalized (IPC-005)
}

/** MUST [MAIL-003]: reject CR/LF injection in any header value (incl. subject). */
function assertNoCrlf(value: string, what: string): void {
  if (/[\r\n]/.test(value))
    throw new StoreError("INVALID_REQUEST", `${what} contains CR/LF`);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function rfc5322Date(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]!} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

/** MUST [MAIL-003]: broker headers encoded through a pinned, widely-deployed
 * email library (nodemailer 10.0.1, streamTransport), never a hand-rolled
 * serializer. CR/LF injection is rejected at OUR boundary first; the library
 * additionally RFC-encodes header values (e.g. UTF-8 subjects).
 */
export async function buildEml(p: EmlParams): Promise<{
  text: string;
  bytes: number;
  sha256: string;
}> {
  assertNoCrlf(p.subject, "subject");
  for (const h of ["from", ...p.to, ...p.replyTo]) assertNoCrlf(h, "address");
  if (p.body.includes("\r"))
    throw new StoreError("INVALID_REQUEST", "body contains CR");
  const transporter = createTransport({
    streamTransport: true,
    buffer: true,
    newline: "\r\n",
  });
  const info = await transporter.sendMail({
    from: p.from,
    to: p.to.join(", "),
    replyTo: p.replyTo.length > 0 ? p.replyTo.join(", ") : undefined,
    subject: p.subject,
    text: p.body,
    messageId: `<${p.messageId}>`,
    ...(p.inReplyTo ? { inReplyTo: `<${p.inReplyTo}>` } : {}),
    ...(p.references.length > 0
      ? { references: p.references.map((r) => `<${r}>`) }
      : {}),
    date: new Date(),
    headers: {
      "X-OMA-Kind": p.kind,
      ...(p.contextRevision ? { "X-OMA-Context": p.contextRevision } : {}),
    },
  });
  // SAFETY: streamTransport+buffer returns the full serialized message in
  // info.message (nodemailer 10 dropped getMessage(); types are lossy).
  const raw = (info as unknown as { message: Buffer }).message;
  // MUST [MAIL-003]: keep the exact X-OMA-Kind / X-OMA-Context header tokens;
  // nodemailer normalizes custom-header casing, so canonicalize the name only.
  const text = raw
    .toString("utf8")
    .replace(/X-Oma-Kind:/g, "X-OMA-Kind:")
    .replace(/X-Oma-Context:/g, "X-OMA-Context:");
  const bytes = Buffer.byteLength(text, "utf8");
  return { text, bytes, sha256: sha256Hex(text) };
}

// ---------------------------------------------------------------------------
// address forms (MAIL-004)
// ---------------------------------------------------------------------------

export function actorAddress(actor: Actor, society: string): string {
  return `${actor}@${society}.oma.invalid`;
}

export function listAddress(
  logical: "commons" | "residents" | "principal",
  society: string,
): string {
  return `${logical}@${society}.oma.invalid`;
}

export function topicAddress(topic: string, society: string): string {
  return `topic-${topic}@${society}.oma.invalid`;
}

// ---------------------------------------------------------------------------
// recipient expansion (MAIL-001)
// ---------------------------------------------------------------------------

export interface RouteResult {
  /** deduped recipient list, snapshot at call time */
  recipients: Actor[];
  /** per-address display form for the To header */
  displayTo: string[];
}

export function expandAddresses(
  store: Store,
  to: readonly Address[],
  society: string,
): RouteResult {
  const agents = new Map(store.listAgents().map((a) => [a.name, a]));
  const recipients = new Set<string>();
  const display = new Set<string>();
  for (const addr of to) {
    if (addr === "principal") {
      if (!agents.has("principal"))
        throw new StoreError(
          "ADDRESS_NOT_FOUND",
          "principal identity not created",
        );
      recipients.add("principal");
      display.add("principal");
      continue;
    }
    if (addr === "commons" || addr === "residents") {
      for (const [name, a] of agents) {
        if (
          a.role === "resident" &&
          a.desired !== "provisioning" &&
          a.desired !== "retired"
        ) {
          recipients.add(name);
        }
      }
      display.add(addr);
      continue;
    }
    if (addr.startsWith("topic/")) {
      const topic = addr.slice(6);
      for (const sub of store.subscribers(topic)) {
        const a = agents.get(sub);
        if (
          a &&
          a.role === "resident" &&
          a.desired !== "provisioning" &&
          a.desired !== "retired"
        ) {
          recipients.add(sub);
        }
      }
      display.add(topicAddress(topic, society));
      continue;
    }
    const a = agents.get(addr);
    if (!a)
      throw new StoreError("ADDRESS_NOT_FOUND", `unknown address "${addr}"`);
    if (a.desired === "provisioning")
      throw new StoreError("AGENT_NOT_READY", `${addr} is provisioning`);
    if (a.desired === "retired")
      throw new StoreError("AGENT_RETIRED", `${addr} is retired`);
    recipients.add(addr);
    display.add(actorAddress(addr, society));
  }
  return { recipients: [...recipients].sort(), displayTo: [...display] };
}

// ---------------------------------------------------------------------------
// durable maildir writes (FS-002/MAIL-007)
// ---------------------------------------------------------------------------

function writeFsynced(path: string, data: string): void {
  const fd = openSync(path, "w", 0o600);
  try {
    writeFileSync(fd, data, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * MUST [MAIL-007]: publish an immutable object to a canonical target. Same
 * filesystem -> hardlink; cross-filesystem -> copy + fsync. An existing target
 * is accepted only when its content hash matches (repeat-safe reconciliation).
 */
export function publishImmutableFile(
  src: string,
  dst: string,
  verifyHash?: string,
): void {
  if (existsSync(dst)) {
    const existing = sha256Hex(readFileSync(dst, "utf8"));
    if (verifyHash !== undefined && existing !== verifyHash) {
      throw new StoreError("STORE_CORRUPT", `existing ${dst} hash mismatch`);
    }
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  try {
    linkSync(src, dst);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      copyFileSync(src, dst);
      const fd = openSync(dst, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } else {
      throw e;
    }
  }
  fsyncDir(dirname(dst));
}

// ---------------------------------------------------------------------------
// reply ancestry (MAIL-005): broker re-reads the accepted original
// ---------------------------------------------------------------------------

export interface ParsedEmlHeaders {
  from: string | null;
  messageId: MessageId | null;
  inReplyTo: MessageId | null;
  references: MessageId[];
  replyTo: string[] | null; // header values verbatim (address forms)
}

export function parseEmlHeaders(text: string): ParsedEmlHeaders {
  const headers: Record<string, string> = {};
  const lines = text.split("\n");
  let cur: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line === "") break; // end of headers
    if (/^[ \t]/.test(line) && cur) {
      headers[cur] = `${headers[cur]}\n${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) break;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!name) break;
    headers[name] = line.slice(idx + 1).trim();
    cur = name;
  }
  const mid = (h: string | undefined): MessageId | null => {
    if (!h) return null;
    const m = /<([^>]+)>/.exec(h);
    return m ? (m[1] as MessageId) : null;
  };
  const refs = (h: string | undefined): MessageId[] => {
    if (!h) return [];
    const out: MessageId[] = [];
    for (const m of h.matchAll(/<([^>]+)>/g)) out.push(m[1] as MessageId);
    return out;
  };
  return {
    from: headers.from ?? null,
    messageId: mid(headers["message-id"]),
    inReplyTo: mid(headers["in-reply-to"]),
    references: refs(headers["references"]),
    replyTo: headers["reply-to"]
      ? headers["reply-to"].split(",").map((s) => s.trim())
      : null,
  };
}

function logicalReplyAddress(
  store: Store,
  value: string,
  society: string,
 ): Address | null {
  const raw = value.trim().replace(/^<|>$/g, "");
  if (raw === "commons" || raw === "residents" || raw === "principal")
    return raw;
  if (raw.startsWith("topic/") && isValidTopicName(raw.slice(6)))
    return raw;
  if (store.getAgent(raw)) return raw;
  const suffix = `@${society}.oma.invalid`;
  if (!raw.endsWith(suffix)) return null;
  const local = raw.slice(0, -suffix.length);
  if (local === "commons" || local === "residents" || local === "principal")
    return local;
  if (local.startsWith("topic-") && isValidTopicName(local.slice(6)))
    return `topic/${local.slice(6)}`;
  return store.getAgent(local) ? local : null;
}

// ---------------------------------------------------------------------------
// mail module
// ---------------------------------------------------------------------------

export interface MailSociety {
  stateRoot: string;
  society: string;
}

export type MailStopPoint =
  | "stage"
  | "object"
  | "accepted"
  | "archive"
  | `inbox-${number}`;

export class StopSignal extends Error {
  constructor(readonly point: MailStopPoint) {
    super(`stop at ${point}`);
    this.name = "StopSignal";
  }
}

export class MailModule {
  private stopAfter: MailStopPoint | null = null;

  constructor(
    private readonly paths: MailSociety,
    private readonly store: Store,
    private readonly maxReplyReferences: number,
  ) {}

  private mailRoot(): string {
    return join(this.paths.stateRoot, "mail");
  }

  objectPath(id: MessageId): string {
    return join(this.mailRoot(), "objects", `${id}.eml`);
  }

  archivePath(id: MessageId): string {
    return join(this.mailRoot(), "archive", "cur", `${id}:2,`);
  }

  inboxNewPath(actor: Actor, id: MessageId): string {
    return join(this.mailRoot(), "inboxes", actor, "new", id);
  }

  inboxCurPath(actor: Actor, id: MessageId): string {
    return join(this.mailRoot(), "inboxes", actor, "cur", `${id}:2,`);
  }

  /**
   * TEST-002 boundary hook: the external kill harness passes a stop point so a
   * child process can be SIGKILLed between MAIL-006 steps. Production callers
   * never pass stopAfter.
   */
  async send(
    auth: AuthContext,
    key: RequestKey,
    input: MailInput,
    stopAfter?: MailStopPoint,
    requestContext?: {
      kind: "mail.send" | "agent.continue";
      params: Json;
    },
  ): Promise<Receipt> {
    this.stopAfter = stopAfter ?? null;
    const operationKind = requestContext?.kind ?? "mail.send";
    const requestParams = requestContext?.params ?? (input as unknown as Json);
    const society = this.paths.society;
    // MUST [IPC-005]: canonical request hash; fast-path claim before any effect work.
    // SAFETY: MailInput fields are JSON values; the cast widens the validated
    // domain input so the canonicalizer can read it for hashing only.
    const newHash = requestHash(
      operationKind,
      canonicalRequestParams(operationKind, requestParams),
    );
    const claim = this.store.claimKey(auth.actor, key, newHash);
    if (claim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused")
      throw new StoreError(
        "REQUEST_KEY_REUSED",
        `request key ${key} already used with a different payload`,
      );

    let parent: ParsedEmlHeaders | null = null;
    if (input.replyToMessage) {
      const obj = this.objectPath(input.replyToMessage);
      if (!existsSync(obj))
        throw new StoreError(
          "INVALID_REQUEST",
          `reply target ${input.replyToMessage} unknown`,
        );
      parent = parseEmlHeaders(readFileSync(obj, "utf8"));
      const parentId = parent.messageId?.split("@", 1)[0];
      if (parentId !== input.replyToMessage) {
        throw new StoreError(
          "STORE_CORRUPT",
          `object ${input.replyToMessage} header mismatch`,
        );
      }
    }
    const targetAddresses: Address[] = [...input.to];
    if (targetAddresses.length === 0) {
      const inherited = parent
        ? parent.replyTo ?? (parent.from ? [parent.from] : [])
        : ["commons" as Address];
      const logical = inherited.map((v) =>
        logicalReplyAddress(this.store, v, society),
      );
      if (logical.some((v) => v === null))
        throw new StoreError(
          "INVALID_REQUEST",
          "reply target has no valid logical recipient",
        );
      targetAddresses.push(...(logical as Address[]));
    }
    const route = expandAddresses(this.store, targetAddresses, society);
    const opId = generateOperationId();
    const messageId = generateMessageId(opId, 0);
    const dateMs = Date.now();
    let replyHeaders: {
      replyTo: string[];
      inReplyTo: MessageId | null;
      references: MessageId[];
    } = {
      replyTo: route.displayTo,
      inReplyTo: null,
      references: [],
    };
    if (parent) {
      const ancestry = [...(parent.references ?? [])];
      if (parent.inReplyTo && !ancestry.includes(parent.inReplyTo))
        ancestry.push(parent.inReplyTo);
      if (!ancestry.includes(parent.messageId!)) ancestry.push(parent.messageId!);
      const inheritedReplyTo = parent.replyTo ?? (parent.from ? [parent.from] : []);
      replyHeaders = {
        replyTo: input.to.length > 0 ? route.displayTo : inheritedReplyTo,
        inReplyTo: parent.messageId,
        references: ancestry.slice(-this.maxReplyReferences),
      };
    }

    const eml = await buildEml({
      from: actorAddress(auth.actor, society),
      to: route.displayTo,
      replyTo: replyHeaders.replyTo,
      subject: input.subject,
      kind: input.kind,
      contextRevision:
        input.refs?.find((r) => r.repo === "context")?.oid ?? null,
      inReplyTo: replyHeaders.inReplyTo,
      references: replyHeaders.references,
      messageId: `${messageId}@${society}.oma.invalid`,
      body: input.body,
    });

    // ② stage + fsync, ③ object publish + dir fsync (MAIL-006)
    const staging = join(this.paths.stateRoot, "staging", `send-${key}`);
    mkdirSync(staging, { recursive: true });
    const staged = join(staging, `${messageId}.eml`);
    writeFsynced(staged, eml.text);
    if (stopAfter === "stage") throw new StopSignal("stage");
    publishImmutableFile(staged, this.objectPath(messageId));
    if (stopAfter === "object") throw new StopSignal("object");

    // ④ T-send: recheck key, snapshot recipients, insert op + deliveries
    const plan = {
      kind: operationKind,
      message: {
        id: messageId,
        objectPath: `mail/objects/${messageId}.eml`,
        sha256: eml.sha256,
        bytes: eml.bytes,
        dateMs,
        to: [...route.displayTo].sort(),
        recipients: route.recipients,
        kind: input.kind,
        contextRevision:
          input.refs?.find((r) => r.repo === "context")?.oid ?? null,
        replyHeaders,
      },
    };
    // T-send: authoritative in-tx claim, then insert op + deliveries.
    // SAFETY: the object property is captured so the transaction callback's
    // assignment escapes TS control-flow narrowing of the outer variable.
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
    try {
      this.store.transaction((_tx) => {
        claimOut.txClaim = this.store.claimOperation({
          id: opId,
          actor: auth.actor,
          requestKey: key,
          requestHash: newHash,
          kind: operationKind,
          payloadJson: JSON.stringify(requestParams),
          planJson: JSON.stringify(plan),
        });
        if (claimOut.txClaim === "retry") return; // concurrent same-key winner; no effects
        this.store.insertDeliveries(
          route.recipients.map((r) => ({
            messageId,
            recipient: r,
            operationId: opId,
          })),
        );
      });
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      throw e;
    }
    if (claimOut.txClaim === "retry")
      return receiptOf(this.store.getOperation(auth.actor, key)!);
    if (stopAfter === "accepted") throw new StopSignal("accepted");
    const result = {
      kind: operationKind,
      message: messageId,
      recipientCount: route.recipients.length,
      archivePath: this.archivePath(messageId),
    };
    let materializedAll = true;
    try {
      await this.materialize(opId);
    } catch (e) {
      // TEST harness deliberately stops inside materialize for crash tests.
      if (e instanceof StopSignal) throw e;
      materializedAll = false; // pending; reconcile/requeue finishes it
    }
    if (materializedAll) {
      this.store.transaction((_tx) =>
        this.store.setOperationSucceeded(opId, JSON.stringify(result)),
      );
    }
    const finalOp = this.store.getOperation(auth.actor, key);
    return finalOp
      ? receiptOf(finalOp)
      : { operation: opId, state: "pending", result };
  }

  /**
   * MUST [DB-009]: freeze the result object (broker-only, unpublished) before
   * any Git/context effect; its id/hash/bytes are never recomputed later.
   */
  freezeObject(messageId: MessageId, eml: { text: string }): void {
    const object = this.objectPath(messageId);
    mkdirSync(dirname(object), { recursive: true });
    writeFsynced(object, eml.text);
  }

  /**
   * MUST [MAIL-010]: gated publication of a submit/context/create result mail.
   * The caller (GitModule) has already proven the effect condition; this only
   * shows the frozen object in archive + recipient inboxes and marks
   * materialized. Never re-renders message metadata from templates.
   */
  async publishGated(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op)
      throw new StoreError("REQUEST_NOT_FOUND", `no operation ${operationId}`);
    let plan: { message: { id: MessageId } };
    try {
      plan = JSON.parse(op.planJson) as { message: { id: MessageId } };
    } catch {
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${operationId} has corrupt plan`,
      );
    }
    const messageId = plan.message.id;
    const object = this.objectPath(messageId);
    if (!existsSync(object))
      throw new StoreError("STORE_CORRUPT", `object missing for ${messageId}`);
    publishImmutableFile(object, this.archivePath(messageId));
    for (const d of this.store.deliveriesForOperation(operationId)) {
      if (existsSync(this.inboxCurPath(d.recipient, d.messageId))) {
        this.store.transaction((_tx) =>
          this.store.markMaterialized(d.messageId, d.recipient),
        );
        continue;
      }
      if (!existsSync(this.inboxNewPath(d.recipient, d.messageId))) {
        publishImmutableFile(
          object,
          this.inboxNewPath(d.recipient, d.messageId),
        );
      }
      this.store.transaction((_tx) =>
        this.store.markMaterialized(d.messageId, d.recipient),
      );
    }
  }

  /** MUST [MAIL-010]: publish archive + inbox links for one operation. */
  async materialize(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op)
      throw new StoreError("REQUEST_NOT_FOUND", `no operation ${operationId}`);
    let plan: { kind: string };
    try {
      plan = JSON.parse(op.planJson) as { kind: string };
    } catch {
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${operationId} has corrupt plan`,
      );
    }
    if (plan.kind !== "mail.send" && plan.kind !== "agent.continue") {
      throw new StoreError(
        "INVALID_REQUEST",
        `operation ${op.kind} uses gated publication`,
      );
    }
    const deliveries = this.store.deliveriesForOperation(operationId);
    // message id comes from the plan, not the (possibly empty) delivery list:
    // a zero-recipient mail must still be archived.
    const messageId =
      (plan as { message?: { id: string } }).message?.id ??
      deliveries[0]?.messageId;
    if (!messageId)
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${operationId} has no message plan`,
      );
    const object = this.objectPath(messageId);
    if (!existsSync(object))
      throw new StoreError("STORE_CORRUPT", `object missing for ${messageId}`);
    publishImmutableFile(object, this.archivePath(messageId));
    if (this.stopAfter === "archive") throw new StopSignal("archive");
    let published = 0;
    for (const d of deliveries) {
      if (existsSync(this.inboxCurPath(d.recipient, d.messageId))) {
        this.store.transaction((_tx) =>
          this.store.markMaterialized(d.messageId, d.recipient),
        );
        continue;
      }
      if (!existsSync(this.inboxNewPath(d.recipient, d.messageId))) {
        publishImmutableFile(
          object,
          this.inboxNewPath(d.recipient, d.messageId),
        );
      }
      published++;
      if (this.stopAfter?.startsWith("inbox-")) {
        const want = Number(this.stopAfter.slice("inbox-".length));
        if (published === want) throw new StopSignal(this.stopAfter);
      }
      this.store.transaction((_tx) =>
        this.store.markMaterialized(d.messageId, d.recipient),
      );
    }
  }

  async prepare(auth: AuthContext): Promise<PreparedBatch | null> {
    const existing = this.store.preparedBatches(auth.actor);
    if (existing.length > 0) return batchFromRow(existing[0]!, auth.actor);
    const pending = this.store.pendingDeliveries(auth.actor);
    if (pending.length === 0) return null;
    const batch = {
      id: generateBatchId(),
      agent: auth.actor,
      incarnation: auth.incarnation,
      messageIds: pending.map((d) => d.messageId),
      sessionPath: null,
    };
    try {
      this.store.transaction((_tx) => {
        this.store.insertPreparedBatch(batch);
        this.store.linkDeliveriesToBatch(batch.id, batch.messageIds);
      });
    } catch (e) {
      if (e instanceof StoreError && e.code === "BATCH_CONFLICT") return null; // raced; next prepare
      throw e;
    }
    return batchOf(batch, auth.actor);
  }

  async complete(auth: AuthContext, evidence: BoundaryEvidence): Promise<void> {
    const batch = this.store.getBatch(evidence.batchId);
    if (!batch)
      throw new StoreError(
        "BATCH_CONFLICT",
        `unknown batch ${evidence.batchId}`,
      );
    if (
      batch.agent !== auth.actor ||
      batch.incarnation !== evidence.incarnation
    ) {
      throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch");
    }
    if (batch.state === "completed") return;
    const ids = parseJsonList(batch.messageIdsJson, `batch ${batch.id}`);
    this.store.transaction((_tx) => {
      this.store.completeBatch(batch.id, ids, auth.actor);
    });
  }

  /**
   * MUST [REC-001]/T18-T22: recover pending mail operations from durable
   * effects: re-materialize archive/inbox links and complete what is provably
   * finished. Never rewinds cur to new.
   */
  async reconcilePending(): Promise<{
    examined: number;
    repaired: number;
    remaining: number;
  }> {
    const ids = this.store.recoverableOperations();
    let repaired = 0;
    let remaining = 0;
    for (const id of ids) {
      const op = this.store.getOperationById(id);
      if (!op) continue;
      let kind: string;
      try {
        kind = (JSON.parse(op.planJson) as { kind: string }).kind;
      } catch {
        throw new StoreError(
          "STORE_CORRUPT",
          `operation ${id} has corrupt plan`,
        );
      }
      if (kind !== "mail.send" && kind !== "agent.continue") {
        remaining++;
        continue;
      }
      const operationKind = kind;
      let plan: { message: { id: MessageId } };
      try {
        plan = JSON.parse(op.planJson) as { message: { id: MessageId } };
      } catch {
        throw new StoreError(
          "STORE_CORRUPT",
          `operation ${id} has corrupt plan`,
        );
      }
      // MUST [REC-001]: a pending op whose frozen immutable object is missing
      // is permanent corruption, not a transient failure — reconcile must
      // refuse to serve on it instead of counting it as merely 'remaining'.
      if (!existsSync(this.objectPath(plan.message.id))) {
        throw new StoreError(
          "STORE_CORRUPT",
          `object missing for ${plan.message.id}`,
        );
      }
      try {
        await this.materialize(id);
        // effects are re-read AFTER materialize committed them
        const fresh = this.store.deliveriesForOperation(id);
        const archiveDone = existsSync(this.archivePath(plan.message.id));
        const allDone =
          fresh.length === 0
            ? archiveDone
            : fresh.every((d) => d.materialized === 1) && archiveDone;
        if (allDone) {
          const result = {
            kind: operationKind,
            message: plan.message.id,
            recipientCount: fresh.length,
            archivePath: this.archivePath(plan.message.id),
          };
          this.store.transaction((_tx) =>
            this.store.setOperationSucceeded(id, JSON.stringify(result)),
          );
          repaired++;
        } else {
          remaining++;
        }
      } catch {
        remaining++;
      }
    }
    return { examined: ids.length, repaired, remaining };
  }

  /** move prepared batch contents from inbox new to cur (repeat-safe). */
  moveToCur(agent: Actor, messageIds: readonly MessageId[]): number {
    let n = 0;
    for (const id of messageIds) {
      const from = this.inboxNewPath(agent, id);
      const to = this.inboxCurPath(agent, id);
      if (existsSync(from) && !existsSync(to)) {
        try {
          publishImmutableFile(from, to);
          unlinkSync(from);
          fsyncDir(dirname(to));
          n++;
        } catch {
          // left in new; canonical-path checks keep delivery idempotent
        }
      }
    }
    return n;
  }
}

function parseJsonList(json: string, what: string): string[] {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
      throw new Error("not a string list");
    return v as string[];
  } catch (e) {
    throw new StoreError(
      "STORE_CORRUPT",
      `${what} has corrupt JSON: ${(e as Error).message}`,
    );
  }
}

export function receiptOf(op: OperationRow): Receipt {
  let result: unknown;
  if (op.resultJson) {
    try {
      result = JSON.parse(op.resultJson);
    } catch {
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${op.id} has corrupt result`,
      );
    }
  }
  const rec: Receipt = { operation: op.id, state: op.state };
  // SAFETY: result_json is written by the broker as JSON.stringify(OperationResult)
  // and validated by the DDL CHECK(json_valid); the cast is the boundary decode.
  if (result !== undefined)
    rec.result = result as Exclude<Receipt["result"], undefined>;
  if (op.errorCode) {
    rec.error = {
      code: op.errorCode,
      message: op.errorCode,
      retry: op.state === "failed" ? "never" : "same-key",
    };
  }
  return rec;
}

export function batchOf(
  b: {
    id: string;
    incarnation: number;
    messageIds: string[];
    sessionPath: string | null;
  },
  agent: Actor,
): PreparedBatch {
  return {
    // SAFETY: batch ids are broker-generated `b-<uuid>` strings; the tagged type
    // exists to prevent treating arbitrary strings as batch ids at the boundary.
    id: b.id as unknown as PreparedBatch["id"],
    agent,
    incarnation: b.incarnation,
    messageIds: b.messageIds as PreparedBatch["messageIds"],
    sessionPath: b.sessionPath,
    deliveryMode: "followUp",
    notice: batchNotice(b.messageIds),
    indexPath: "/inbox.md",
  };
}
function batchFromRow(
  row: {
    id: string;
    incarnation: number;
    messageIdsJson: string;
    sessionPath: string | null;
  },
  agent: Actor,
): PreparedBatch {
  return batchOf(
    {
      id: row.id,
      incarnation: row.incarnation,
      messageIds: parseJsonList(row.messageIdsJson, `batch ${row.id}`),
      sessionPath: row.sessionPath,
    },
    agent,
  );
}
/** MUST [BATCH-002]: ≤6 metadata items + /inbox.md path; no body summarization here. */
export function batchNotice(ids: readonly string[]): string {
  const shown = ids.slice(0, 6);
  const lines = shown.map((id, i) => `${i + 1}. mail ${id}`);
  if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
  lines.push("전체 목록: /inbox.md");
  return lines.join("\n");
}
