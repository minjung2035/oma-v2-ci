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
  MessagePlan,
  Oid,
  RequestKey,
  AuthContext,
  PreparedBatch,
  BoundaryEvidence,
  Receipt,
} from "../implementation/contracts.js";
import {
  Store,
  StoreError,
  type DeliveryRow,
  type OperationRow,
} from "./store.js";
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
  messageId: string;
  body: string;
}

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
  const raw = (info as unknown as { message: Buffer }).message;
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
  recipients: Actor[];
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
  subject: string | null;
  messageId: MessageId | null;
  inReplyTo: MessageId | null;
  references: MessageId[];
  replyTo: string[] | null;
}

export function parseEmlHeaders(text: string): ParsedEmlHeaders {
  const headers: Record<string, string> = {};
  const lines = text.split("\n");
  let cur: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line === "") break;
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
    subject: headers.subject ?? null,
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
    private readonly batchMaxMessages = 24,
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

    const staging = join(this.paths.stateRoot, "staging", `send-${key}`);
    mkdirSync(staging, { recursive: true });
    const staged = join(staging, `${messageId}.eml`);
    writeFsynced(staged, eml.text);
    if (stopAfter === "stage") throw new StopSignal("stage");
    publishImmutableFile(staged, this.objectPath(messageId));
    if (stopAfter === "object") throw new StopSignal("object");

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
    const claimOut = { txClaim: "inserted" as "inserted" | "retry" };
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
      if (claimOut.txClaim === "retry") return;
      this.store.insertDeliveries(
        route.recipients.map((r) => ({
          messageId,
          recipient: r,
          operationId: opId,
        })),
      );
    });
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
      if (e instanceof StopSignal) throw e;
      materializedAll = false;
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

  async freezeCreateInitial(
    auth: AuthContext,
    operationId: string,
    recipient: Actor,
    brief: string,
  ): Promise<MessagePlan> {
    const messageId = generateMessageId(operationId, 0);
    const dateMs = Date.now();
    const eml = await buildEml({
      from: actorAddress(auth.actor, this.paths.society),
      to: [actorAddress(recipient, this.paths.society)],
      replyTo: [actorAddress(auth.actor, this.paths.society)],
      subject: "initial brief",
      kind: "message",
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: `${messageId}@${this.paths.society}.oma.invalid`,
      body: brief,
    });
    this.freezeObject(messageId, eml);
    return {
      id: messageId,
      objectPath: `mail/objects/${messageId}.eml`,
      sha256: eml.sha256,
      bytes: eml.bytes,
      dateMs,
      to: [recipient],
      recipients: [recipient],
      kind: "message",
      contextRevision: null,
      replyHeaders: {
        replyTo: [auth.actor],
        inReplyTo: null,
        references: [],
      },
    };
  }

  freezeObject(messageId: MessageId, eml: { text: string }): void {
    const object = this.objectPath(messageId);
    mkdirSync(dirname(object), { recursive: true });
    writeFsynced(object, eml.text);
  }

  async publishGated(operationId: string): Promise<void> {
    const op = this.store.getOperationById(operationId);
    if (!op)
      throw new StoreError("REQUEST_NOT_FOUND", `no operation ${operationId}`);
    let decoded: {
      message?: MessagePlan;
      initialMessage?: MessagePlan | null;
    };
    try {
      decoded = JSON.parse(op.planJson) as {
        message?: MessagePlan;
        initialMessage?: MessagePlan | null;
      };
    } catch {
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${operationId} has corrupt plan`,
      );
    }
    const message = decoded.message ?? decoded.initialMessage;
    if (!message)
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${operationId} has no frozen gated message`,
      );
    const object = this.objectPath(message.id);
    if (!existsSync(object) || sha256Hex(readFileSync(object, "utf8")) !== message.sha256)
      throw new StoreError("STORE_CORRUPT", `object mismatch for ${message.id}`);
    publishImmutableFile(object, this.archivePath(message.id), message.sha256);
    for (const d of this.store.deliveriesForOperation(operationId)) {
      if (d.messageId !== message.id)
        throw new StoreError("STORE_CORRUPT", `delivery message mismatch for ${operationId}`);
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
          message.sha256,
        );
      }
      this.store.transaction((_tx) =>
        this.store.markMaterialized(d.messageId, d.recipient),
      );
    }
  }

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

  /** MUST [BATCH-003]: two-class oldest-first capped selection without semantic policy. */
  private selectBatch(pending: DeliveryRow[]): DeliveryRow[] {
    if (pending.length === 0) return [];
    const direct: DeliveryRow[] = [];
    const publicList: DeliveryRow[] = [];
    for (const d of pending) {
      (this.isPublicList(d) ? publicList : direct).push(d);
    }
    if (direct.length === 0 || publicList.length === 0)
      return pending.slice(0, this.batchMaxMessages);
    if (this.batchMaxMessages < 2)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "batchMaxMessages must be at least 2 when both batch classes are pending",
      );
    const out: DeliveryRow[] = [direct[0]!, publicList[0]!];
    let di = 1;
    let pi = 1;
    let takeDirect = true;
    while (out.length < this.batchMaxMessages && (di < direct.length || pi < publicList.length)) {
      if (takeDirect && di < direct.length) out.push(direct[di++]!);
      else if (!takeDirect && pi < publicList.length) out.push(publicList[pi++]!);
      else if (di < direct.length) out.push(direct[di++]!);
      else if (pi < publicList.length) out.push(publicList[pi++]!);
      takeDirect = !takeDirect;
    }
    return out;
  }

  private isPublicList(delivery: DeliveryRow): boolean {
    const message = this.messagePlan(delivery);
    if (message.kind !== "message" || message.to.length === 0) return false;
    const suffix = `@${this.paths.society}.oma.invalid`;
    return message.to.every(
      (to) =>
        to === "commons" ||
        to === "residents" ||
        (to.startsWith("topic-") && to.endsWith(suffix)),
    );
  }

  private messagePlan(delivery: DeliveryRow): MessagePlan {
    const op = this.store.getOperationById(delivery.operationId);
    if (!op)
      throw new StoreError("STORE_CORRUPT", `missing operation ${delivery.operationId}`);
    let decoded: { message?: MessagePlan; initialMessage?: MessagePlan | null };
    try {
      decoded = JSON.parse(op.planJson) as typeof decoded;
    } catch {
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt plan`);
    }
    const message = decoded.message ?? decoded.initialMessage;
    if (!message || message.id !== delivery.messageId)
      throw new StoreError("STORE_CORRUPT", `message plan mismatch for ${delivery.messageId}`);
    return message;
  }

  /** MUST [BATCH-002]: at most six deterministic metadata items; never body summary. */
  private noticeFor(agent: Actor, ids: readonly MessageId[]): string {
    const lines: string[] = [];
    for (const [i, id] of ids.slice(0, 6).entries()) {
      const delivery = this.store.getDelivery(id, agent);
      if (!delivery)
        throw new StoreError("STORE_CORRUPT", `missing delivery ${id}/${agent}`);
      const message = this.messagePlan(delivery);
      const object = this.objectPath(id);
      if (!existsSync(object))
        throw new StoreError("STORE_CORRUPT", `missing mail object ${id}`);
      const headers = parseEmlHeaders(readFileSync(object, "utf8"));
      if (headers.messageId?.split("@", 1)[0] !== id)
        throw new StoreError("STORE_CORRUPT", `mail header mismatch for ${id}`);
      const reply = headers.inReplyTo ?? headers.references.at(-1) ?? null;
      const context = message.contextRevision
        ? ` context=/world/context/revisions/${message.contextRevision}${message.kind === "context" ? "/GOAL.md" : ""}`
        : "";
      lines.push(
        `${i + 1}. sender=${oneLine(headers.from)} subject=${oneLine(headers.subject)} kind=${message.kind} path=/mail/archive/cur/${id}:2,${reply ? ` reply=${reply}` : ""}${context}`,
      );
    }
    if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
    lines.push("전체 목록: /inbox.md");
    return lines.join("\n");
  }

  async prepare(auth: AuthContext): Promise<PreparedBatch | null> {
    const existing = this.store.preparedBatches(auth.actor);
    if (existing.length > 0) {
      const row = existing[0]!;
      const messageIds = parseJsonList(row.messageIdsJson, `batch ${row.id}`) as MessageId[];
      return batchOf(
        {
          id: row.id,
          incarnation: row.incarnation,
          messageIds,
          sessionPath: row.sessionPath,
        },
        auth.actor,
        this.noticeFor(auth.actor, messageIds),
      );
    }
    const pending = this.selectBatch(this.store.pendingDeliveries(auth.actor));
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
      if (e instanceof StoreError && e.code === "BATCH_CONFLICT") return null;
      throw e;
    }
    return batchOf(batch, auth.actor, this.noticeFor(auth.actor, batch.messageIds));
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
    throw new StoreError(
      "SESSION_BOUNDARY_UNCONFIRMED",
      "S-03 trusted Pi session-boundary evidence is not implemented",
    );
  }

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
      if (!existsSync(this.objectPath(plan.message.id))) {
        throw new StoreError(
          "STORE_CORRUPT",
          `object missing for ${plan.message.id}`,
        );
      }
      try {
        await this.materialize(id);
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

function oneLine(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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
  notice = batchNotice(b.messageIds),
): PreparedBatch {
  return {
    id: b.id as unknown as PreparedBatch["id"],
    agent,
    incarnation: b.incarnation,
    messageIds: b.messageIds as PreparedBatch["messageIds"],
    sessionPath: b.sessionPath,
    deliveryMode: "followUp",
    notice,
    indexPath: "/inbox.md",
  };
}

export function batchNotice(ids: readonly string[]): string {
  const shown = ids.slice(0, 6);
  const lines = shown.map((id, i) => `${i + 1}. mail ${id}`);
  if (ids.length > 6) lines.push(`… +${ids.length - 6} more`);
  lines.push("전체 목록: /inbox.md");
  return lines.join("\n");
}
