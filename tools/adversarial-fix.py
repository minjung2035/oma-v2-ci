from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f"{path}: expected >= {minimum} occurrences, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new))


# ---------------------------------------------------------------------------
# Mail: logical MessagePlan addresses, body immutability, immutable object
# publication, and approval metadata cross-validation.
# ---------------------------------------------------------------------------
replace_once(
    "src/mail.ts",
    '''  const text = raw
    .toString("utf8")
    .replace(/X-Oma-Kind:/g, "X-OMA-Kind:")
    .replace(/X-Oma-Context:/g, "X-OMA-Context:");''',
    '''  const text = raw.toString("utf8");''',
)

replace_once(
    "src/mail.ts",
    '''export function topicAddress(topic: string, society: string): string {
  return `topic-${topic}@${society}.oma.invalid`;
}
''',
    '''export function topicAddress(topic: string, society: string): string {
  return `topic-${topic}@${society}.oma.invalid`;
}

export function displayAddress(address: Address, society: string): string {
  if (address === "principal" || address === "commons" || address === "residents")
    return listAddress(address, society);
  if (address.startsWith("topic/")) return topicAddress(address.slice(6), society);
  return actorAddress(address, society);
}
''',
)

replace_once(
    "src/mail.ts",
    '''/** MAIL-005: list replies stay on lists; direct replies return to the sender. */
export function defaultReplyTo(from: string, to: readonly string[]): string[] {
  const lists = to.filter(address => /^(commons|residents|topic-[a-z][a-z0-9-]*)@/.test(address));
  return [...new Set(lists.length ? lists : [from])];
}
''',
    '''/** MAIL-005: list replies stay on lists; direct replies return to the sender. */
export function defaultReplyTo(from: string, to: readonly string[]): string[] {
  const lists = to.filter(address => /^(commons|residents|topic-[a-z][a-z0-9-]*)@/.test(address));
  return [...new Set(lists.length ? lists : [from])];
}

/** Logical form stored in MessagePlan; RFC mailbox encoding is a presentation detail. */
export function defaultLogicalReplyTo(from: Address, to: readonly Address[]): Address[] {
  const lists = to.filter(
    (address) => address === "commons" || address === "residents" || address.startsWith("topic/"),
  );
  return [...new Set(lists.length ? lists : [from])];
}
''',
)

replace_once(
    "src/mail.ts",
    '''    const route = expandAddresses(this.store, targetAddresses, society);
    const opId = generateOperationId();''',
    '''    const logicalTo = [...new Set(targetAddresses)].sort() as Address[];
    const route = expandAddresses(this.store, logicalTo, society);
    const opId = generateOperationId();''',
)
replace_once(
    "src/mail.ts",
    '''    let replyHeaders: {
      replyTo: string[];
      inReplyTo: MessageId | null;
      references: MessageId[];
    } = {
      replyTo: defaultReplyTo(actorAddress(auth.actor, society), route.displayTo),''',
    '''    let replyHeaders: {
      replyTo: Address[];
      inReplyTo: MessageId | null;
      references: MessageId[];
    } = {
      replyTo: defaultLogicalReplyTo(auth.actor, logicalTo),''',
)
replace_once(
    "src/mail.ts",
    '''      replyTo: replyHeaders.replyTo,
      subject: input.subject,''',
    '''      replyTo: replyHeaders.replyTo.map((address) => displayAddress(address, society)),
      subject: input.subject,''',
)
replace_once(
    "src/mail.ts",
    '''        to: [...route.displayTo].sort(),''',
    '''        to: [...logicalTo],''',
)
replace_once(
    "src/mail.ts",
    '''      route.recipients = expandAddresses(this.store, targetAddresses, society).recipients;''',
    '''      route.recipients = expandAddresses(this.store, logicalTo, society).recipients;''',
)
replace_once(
    "src/mail.ts",
    '''    writeFsynced(staging, eml.text);
    return {
      id: messageId,''',
    '''    writeFsynced(staging, eml.text);
    fsyncDir(dirname(staging));
    return {
      id: messageId,''',
)
replace_once(
    "src/mail.ts",
    '''  freezeObject(messageId: MessageId, eml: { text: string }): void {
    const object = this.objectPath(messageId);
    mkdirSync(dirname(object), { recursive: true });
    writeFsynced(object, eml.text);
  }
''',
    '''  freezeObject(messageId: MessageId, eml: { text: string; sha256?: string }): void {
    const object = this.objectPath(messageId);
    const stagingDir = join(this.paths.stateRoot, "staging", "mail-objects");
    mkdirSync(stagingDir, { recursive: true });
    const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);
    const fd = openSync(staged, "wx", 0o600);
    try {
      writeFileSync(fd, eml.text, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      publishImmutableFile(staged, object, eml.sha256 ?? sha256Hex(eml.text));
    } finally {
      rmSync(staged, { force: true });
      fsyncDir(stagingDir);
    }
  }
''',
)

replace_once(
    "src/mail.ts",
    '''export interface ParsedEmlHeaders {
  from: string | null;
  subject: string | null;
  messageId: MessageId | null;
  inReplyTo: MessageId | null;
  references: MessageId[];
  replyTo: string[] | null;
}

export function parseEmlHeaders(text: string): ParsedEmlHeaders {''',
    '''export interface ParsedEmlHeaders {
  from: string | null;
  subject: string | null;
  messageId: MessageId | null;
  inReplyTo: MessageId | null;
  references: MessageId[];
  replyTo: string[] | null;
  omaKind: string | null;
  approvalFor: {
    repo: string | null;
    targetRef: string | null;
    expectedBase: string | null;
    candidate: string | null;
    policyRevision: string | null;
  } | null;
}

function decodeUtf8Base64Words(value: string): string {
  const unfolded = value.replace(/\\n/g, " ");
  const pattern = /=\\?UTF-8\\?B\\?([A-Za-z0-9+/=]+)\\?=/gi;
  let output = "";
  let last = 0;
  let previousEncoded = false;
  for (const match of unfolded.matchAll(pattern)) {
    const index = match.index ?? 0;
    const gap = unfolded.slice(last, index);
    if (!(previousEncoded && /^\\s*$/.test(gap))) output += gap;
    output += Buffer.from(match[1]!, "base64").toString("utf8");
    last = index + match[0].length;
    previousEncoded = true;
  }
  return output + unfolded.slice(last);
}

export function parseEmlHeaders(text: string): ParsedEmlHeaders {''',
)
replace_once(
    "src/mail.ts",
    '''  return {
    from: headers.from ?? null,
    subject: headers.subject ?? null,
    messageId: mid(headers["message-id"]),
    inReplyTo: mid(headers["in-reply-to"]),
    references: refs(headers["references"]),
    replyTo: headers["reply-to"]
      ? headers["reply-to"].split(",").map((s) => s.trim())
      : null,
  };''',
    '''  const approval = {
    repo: headers["x-oma-approval-repo"] ?? null,
    targetRef: headers["x-oma-approval-target"] ?? null,
    expectedBase: headers["x-oma-approval-base"] ?? null,
    candidate: headers["x-oma-approval-candidate"] ?? null,
    policyRevision: headers["x-oma-approval-policy"]
      ? decodeUtf8Base64Words(headers["x-oma-approval-policy"])
      : null,
  };
  const hasApproval = Object.values(approval).some((value) => value !== null);
  return {
    from: headers.from ?? null,
    subject: headers.subject ?? null,
    messageId: mid(headers["message-id"]),
    inReplyTo: mid(headers["in-reply-to"]),
    references: refs(headers["references"]),
    replyTo: headers["reply-to"]
      ? headers["reply-to"].split(",").map((s) => s.trim())
      : null,
    omaKind: headers["x-oma-kind"] ?? null,
    approvalFor: hasApproval ? approval : null,
  };''',
)
replace_once(
    "src/mail.ts",
    '''    if (headers.messageId?.split("@", 1)[0] !== message.id)
      throw new StoreError("STORE_CORRUPT", `mail header mismatch: ${message.id}`);
    return headers;''',
    '''    if (headers.messageId?.split("@", 1)[0] !== message.id || headers.omaKind !== message.kind)
      throw new StoreError("STORE_CORRUPT", `mail header mismatch: ${message.id}`);
    const expectedApproval = message.approvalFor ?? null;
    const actualApproval = headers.approvalFor;
    if (expectedApproval) {
      if (!actualApproval ||
        actualApproval.repo !== expectedApproval.repo ||
        actualApproval.targetRef !== expectedApproval.targetRef ||
        actualApproval.expectedBase !== expectedApproval.expectedBase ||
        actualApproval.candidate !== expectedApproval.candidate ||
        actualApproval.policyRevision !== expectedApproval.policyRevision)
        throw new StoreError("STORE_CORRUPT", `mail approval metadata mismatch: ${message.id}`);
    } else if (actualApproval) {
      throw new StoreError("STORE_CORRUPT", `unexpected mail approval metadata: ${message.id}`);
    }
    return headers;''',
)
replace_once(
    "src/mail.ts",
    '''    const suffix = `@${this.paths.society}.oma.invalid`;
    return message.to.every(
      (to) =>
        to === `commons${suffix}` ||
        to === `residents${suffix}` ||
        (to.startsWith("topic-") && to.endsWith(suffix)),
    );''',
    '''    return message.to.every(
      (to) => to === "commons" || to === "residents" || to.startsWith("topic/"),
    );''',
)

# ---------------------------------------------------------------------------
# Persisted DTO validation: MessagePlan addresses are logical, not RFC display
# mailboxes, and reply ancestry IDs use the actual message-id grammar.
# ---------------------------------------------------------------------------
replace_once(
    "src/validate.ts",
    '''export function checkAddress(actorNames: ReadonlySet<string>): Check {
  return (v) => {
    if (typeof v !== "string")
      return `expected address string, got ${typeName(v)}`;
    if (v.startsWith("topic/"))
      return isValidTopicName(v.slice(6)) ? null : `invalid topic address`;
    if (v === "principal" || v === "commons" || v === "residents") return null;
    return actorNames.has(v) ? null : `unknown address "${v}"`;
  };
}
''',
    '''export const checkLogicalAddress: Check = (v) => {
  if (typeof v !== "string")
    return `expected address string, got ${typeName(v)}`;
  if (v.startsWith("topic/"))
    return isValidTopicName(v.slice(6)) ? null : `invalid topic address`;
  if (v === "principal" || v === "commons" || v === "residents") return null;
  return isValidActorName(v) ? null : `invalid logical address`;
};

export function checkAddress(actorNames: ReadonlySet<string>): Check {
  return (v) => {
    const structural = checkLogicalAddress(v);
    if (structural) return structural;
    if (v === "principal" || v === "commons" || v === "residents" ||
      (typeof v === "string" && v.startsWith("topic/"))) return null;
    return actorNames.has(v as string) ? null : `unknown address "${String(v)}"`;
  };
}
''',
)
replace_once(
    "src/validate.ts",
    '''  to: checkArray(checkString({ min: 1 })),''',
    '''  to: checkArray(checkLogicalAddress),''',
)
replace_once(
    "src/validate.ts",
    '''    replyTo: checkArray(checkString({ min: 1 })),
    inReplyTo: v => v === null ? null : checkString({ min: 1 })(v),
    references: checkArray(checkString({ min: 1 })),''',
    '''    replyTo: checkArray(checkLogicalAddress),
    inReplyTo: v => v === null ? null : checkString({ re: /^m-[0-9a-f-]{36}-\\d+$/ })(v),
    references: checkArray(checkString({ re: /^m-[0-9a-f-]{36}-\\d+$/ })),''',
)

# ---------------------------------------------------------------------------
# Git/context mail plans: persist logical addresses. Bound every subprocess in
# this module; explicit per-call limits continue to override the defaults.
# ---------------------------------------------------------------------------
replace_once(
    "src/git.ts",
    '''import { MailModule, buildEml, expandAddresses, fsyncDir, defaultReplyTo, actorAddress, listAddress } from "./mail.js";''',
    '''import { MailModule, buildEml, expandAddresses, fsyncDir, defaultReplyTo, defaultLogicalReplyTo, actorAddress, listAddress } from "./mail.js";''',
)
replace_once(
    "src/git.ts",
    '''        to: [...route.displayTo],
        recipients: route.recipients,
        kind: "result" as const,
        contextRevision: null,
        replyHeaders: { replyTo: defaultReplyTo(actorAddress(auth.actor, this.paths.society), route.displayTo), inReplyTo: null, references: [] },''',
    '''        to: [...new Set(targetAddresses)].sort(),
        recipients: route.recipients,
        kind: "result" as const,
        contextRevision: null,
        replyHeaders: { replyTo: defaultLogicalReplyTo(auth.actor, targetAddresses), inReplyTo: null, references: [] },''',
)
replace_once(
    "src/git.ts",
    '''        to: [listAddress("residents", this.paths.society)],
        recipients: [] as Actor[],
        kind: "context" as const,
        contextRevision: null,
        replyHeaders: { replyTo: [listAddress("residents", this.paths.society)], inReplyTo: null, references: [] },''',
    '''        to: ["residents"],
        recipients: [] as Actor[],
        kind: "context" as const,
        contextRevision: null,
        replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] },''',
)
text = read("src/git.ts")
if "const boundedSpawnSync: typeof spawnSync" not in text:
    text = text.replace("spawnSync(", "boundedSpawnSync(")
    marker = '''const GIT_BIN = "/usr/bin/git";'''
    helper = '''const boundedSpawnSync: typeof spawnSync = ((
  command: string,
  args?: readonly string[],
  options?: object,
) => spawnSync(command, args ? [...args] : [], {
  timeout: 120_000,
  killSignal: "SIGKILL",
  maxBuffer: 4 * 1024 * 1024,
  ...(options ?? {}),
})) as typeof spawnSync;

'''
    if marker not in text:
        raise SystemExit("src/git.ts: GIT_BIN marker not found")
    text = text.replace(marker, helper + marker, 1)
    write("src/git.ts", text)

# ---------------------------------------------------------------------------
# Filesystem/config invariants.
# ---------------------------------------------------------------------------
replace_once(
    "src/config.ts",
    '''  if (principalReservedUnits > societyUnits)
    err("quota.principalReservedUnits exceeds quota.societyUnits");

  const integration = needRecord(cfg["integration"], "integration");''',
    '''  if (principalReservedUnits > societyUnits)
    err("quota.principalReservedUnits exceeds quota.societyUnits");
  const societyAgents = needInt(quota["societyAgents"], "quota.societyAgents", 0);
  const lineageAgents = needInt(quota["lineageAgents"], "quota.lineageAgents", 0);
  const inferenceSlots = needInt(quota["inferenceSlots"], "quota.inferenceSlots", 1);
  const principalReservedSlots = needInt(
    quota["principalReservedSlots"],
    "quota.principalReservedSlots",
    0,
  );
  needInt(quota["storageBytes"], "quota.storageBytes", 1);
  if (lineageAgents > societyAgents)
    err("quota.lineageAgents exceeds quota.societyAgents");
  if (initialResidents.length > societyAgents)
    err("initialResidents exceed quota.societyAgents");
  if (principalReservedSlots > inferenceSlots)
    err("quota.principalReservedSlots exceeds quota.inferenceSlots");

  const integration = needRecord(cfg["integration"], "integration");''',
)
replace_once(
    "src/config.ts",
    '''        typeof x !== "string" ||
        !isValidWirePath(x.endsWith("/") ? x.slice(0, -1) : x) ||
        /[*?[\\]{}!]/.test(x),''',
    '''        typeof x !== "string" ||
        (x !== "/" && !isValidWirePath(x.endsWith("/") ? x.slice(0, -1) : x)) ||
        /[*?[\\]{}!]/.test(x),''',
)

# ---------------------------------------------------------------------------
# Store: distinguish BUSY from damage and make operation terminal states
# immutable while retaining idempotent same-terminal writes.
# ---------------------------------------------------------------------------
replace_once(
    "src/store.ts",
    '''      } catch (e) {
        if (isBusyError(e) && i < this.busyRetries) continue;
        throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");
      }''',
    '''      } catch (e) {
        if (isBusyError(e)) {
          if (i < this.busyRetries) continue;
          throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");
        }
        throw new StoreError(
          "STORE_CORRUPT",
          `BEGIN IMMEDIATE failed: ${(e as Error).message}`,
        );
      }''',
)
replace_once(
    "src/store.ts",
    '''  setOperationSucceeded(id: OperationId, resultJson: string): void {
    this.requireTx();
    this.db
      .prepare(
        "UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=?",
      )
      .run(resultJson, Date.now(), id);
  }

  setOperationFailed(id: OperationId, code: ErrorCode): void {
    this.requireTx();
    this.db
      .prepare(
        "UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=?",
      )
      .run(code, Date.now(), id);
  }

  setOperationUnknown(id: OperationId): void {
    this.requireTx();
    this.db
      .prepare(
        "UPDATE operations SET state='unknown', updated_at_ms=? WHERE id=?",
      )
      .run(Date.now(), id);
  }''',
    '''  setOperationSucceeded(id: OperationId, resultJson: string): void {
    this.requireTx();
    const updated = this.db
      .prepare(
        "UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')",
      )
      .run(resultJson, Date.now(), id);
    if (Number(updated.changes) !== 0) return;
    const current = this.getOperationById(id);
    if (current?.state === "succeeded" && current.resultJson === resultJson && current.errorCode === null) return;
    throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
  }

  setOperationFailed(id: OperationId, code: ErrorCode): void {
    this.requireTx();
    const updated = this.db
      .prepare(
        "UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=? AND state IN ('pending','unknown')",
      )
      .run(code, Date.now(), id);
    if (Number(updated.changes) !== 0) return;
    const current = this.getOperationById(id);
    if (current?.state === "failed" && current.resultJson === null && current.errorCode === code) return;
    throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
  }

  setOperationUnknown(id: OperationId): void {
    this.requireTx();
    const current = this.getOperationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    if (current.state === "unknown") return;
    if (current.state !== "pending")
      throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    this.db
      .prepare(
        "UPDATE operations SET state='unknown', updated_at_ms=? WHERE id=? AND state='pending'",
      )
      .run(Date.now(), id);
  }''',
)

# ---------------------------------------------------------------------------
# Lifecycle: enforce lifetime society/lineage agent caps in the accepting tx.
# Also put bounded subprocess defaults around all Git physical effects.
# ---------------------------------------------------------------------------
replace_once(
    "src/lifecycle.ts",
    '''type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;
type ActionPlan = Extract<
  OperationPlan,
  { kind: "agent.start" | "agent.stop" }
>;
''',
    '''type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;
type ActionPlan = Extract<
  OperationPlan,
  { kind: "agent.start" | "agent.stop" }
>;
type AgentQuota = Pick<HostConfigV1["quota"], "societyAgents" | "lineageAgents">;
''',
)
replace_once(
    "src/lifecycle.ts",
    '''    private readonly resolveSpec: SpecResolver,
    private readonly mail: MailModule | null = null,
  ) {}''',
    '''    private readonly resolveSpec: SpecResolver,
    private readonly mail: MailModule | null = null,
    private readonly agentQuota: AgentQuota | null = null,
  ) {}''',
)
replace_once(
    "src/lifecycle.ts",
    '''  private resolveCreate(
    auth: AuthContext,
    input: AgentCreateInput,
  ): { spec: ResolvedAgentSpec; specHash: string } {''',
    '''  private enforceCreateQuota(parentName: Actor): void {
    if (!this.agentQuota) return;
    const agents = this.store.listAgents();
    const byName = new Map(agents.map((agent) => [agent.name, agent]));
    const residents = agents.filter((agent) => agent.role === "resident");
    if (residents.length >= this.agentQuota.societyAgents)
      throw new StoreError("QUOTA_EXCEEDED", "society agent quota exhausted");

    const descendsFrom = (rowName: Actor, ancestorName: Actor): boolean => {
      let current = byName.get(rowName);
      const seen = new Set<string>();
      while (current?.createdBy) {
        if (current.createdBy === ancestorName) return true;
        if (!seen.add(current.name))
          throw new StoreError("STORE_CORRUPT", "agent ancestry cycle detected");
        const parent = byName.get(current.createdBy);
        if (!parent)
          throw new StoreError("STORE_CORRUPT", `missing ancestor ${current.createdBy}`);
        current = parent;
      }
      return false;
    };

    let ancestor = byName.get(parentName);
    const ancestry = new Set<string>();
    while (ancestor && ancestor.role === "resident") {
      if (!ancestry.add(ancestor.name))
        throw new StoreError("STORE_CORRUPT", "agent ancestry cycle detected");
      const descendants = residents.filter((row) => descendsFrom(row.name, ancestor!.name)).length;
      if (descendants >= this.agentQuota.lineageAgents)
        throw new StoreError("QUOTA_EXCEEDED", `lineage agent quota exhausted at ${ancestor.name}`);
      if (!ancestor.createdBy) break;
      ancestor = byName.get(ancestor.createdBy);
      if (!ancestor)
        throw new StoreError("STORE_CORRUPT", "agent ancestry references a missing parent");
    }
  }

  private resolveCreate(
    auth: AuthContext,
    input: AgentCreateInput,
  ): { spec: ResolvedAgentSpec; specHash: string } {''',
)
replace_once(
    "src/lifecycle.ts",
    '''    this.assertCanonicalBase(input.from);
    if (!this.mail)''',
    '''    this.enforceCreateQuota(auth.actor);
    this.assertCanonicalBase(input.from);
    if (!this.mail)''',
)
replace_once(
    "src/lifecycle.ts",
    '''      if (outcome.claim === "retry") return;
      this.store.insertAgent({
        name: input.name,''',
    '''      if (outcome.claim === "retry") return;
      this.enforceCreateQuota(auth.actor);
      this.store.insertAgent({
        name: input.name,''',
)
text = read("src/lifecycle.ts")
if "const boundedSpawnSync: typeof spawnSync" not in text:
    text = text.replace("spawnSync(", "boundedSpawnSync(")
    marker = '''const cloneEnv: NodeJS.ProcessEnv = {'''
    helper = '''const boundedSpawnSync: typeof spawnSync = ((
  command: string,
  args?: readonly string[],
  options?: object,
) => spawnSync(command, args ? [...args] : [], {
  timeout: 120_000,
  killSignal: "SIGKILL",
  maxBuffer: 4 * 1024 * 1024,
  ...(options ?? {}),
})) as typeof spawnSync;

'''
    if marker not in text:
        raise SystemExit("src/lifecycle.ts: cloneEnv marker not found")
    text = text.replace(marker, helper + marker, 1)
    write("src/lifecycle.ts", text)

replace_once(
    "src/entry/broker.ts",
    '''  },
  mail,
);
const git = new GitModule(''',
    '''  },
  mail,
  cfg.quota,
);
const git = new GitModule(''',
)

# ---------------------------------------------------------------------------
# Broker: preflight streaming mutations before consuming bodies, continue
# parsing after a malformed frame, fail closed on journalctl and corrupt
# operation results.
# ---------------------------------------------------------------------------
replace_once(
    "src/broker.ts",
    '''    this.serveFrames(sock, (raw, stream) =>
      this.dispatch(auth, raw as Request, stream ?? null),
    );''',
    '''    this.serveFrames(
      sock,
      (raw, stream) => this.dispatch(auth, raw as Request, stream ?? null),
      (raw) => this.preflightPublicStream(auth, raw),
    );''',
)
replace_once(
    "src/broker.ts",
    '''    handle: (
      raw: Record<string, unknown>,
      stream: AsyncIterable<Uint8Array> | null,
    ) => Promise<unknown> | unknown,
  ): void {''',
    '''    handle: (
      raw: Record<string, unknown>,
      stream: AsyncIterable<Uint8Array> | null,
    ) => Promise<unknown> | unknown,
    preflightStream?: (raw: Record<string, unknown>) => object | null,
  ): void {''',
)
replace_once(
    "src/broker.ts",
    '''    const processEvents = (
      events: import("./frame.js").DecoderEvent[],
    ): void => {
      for (const ev of events) {''',
    '''    const processEvents = (
      events: import("./frame.js").DecoderEvent[],
    ): void => {
      const pendingEvents = [...events];
      while (pendingEvents.length > 0) {
        const ev = pendingEvents.shift()!;''',
)
replace_once(
    "src/broker.ts",
    '''          );
          continue;
        }
        if (ev.kind === "stream") {''',
    '''          );
          pendingEvents.push(...dec.resumeParsing());
          continue;
        }
        if (ev.kind === "stream") {''',
)
replace_once(
    "src/broker.ts",
    '''          if (desc.bytes > 0) {
            streamFrame = { raw, id };
            const more = dec.beginStream(desc.bytes);
            if (more.length > 0) processEvents(more);
            continue;
          }''',
    '''          if (desc.bytes > 0) {
            const preflightError = preflightStream?.(raw) ?? null;
            if (preflightError) {
              write(preflightError);
              sock.destroy();
              return;
            }
            streamFrame = { raw, id };
            const more = dec.beginStream(desc.bytes);
            if (more.length > 0) pendingEvents.push(...more);
            continue;
          }''',
)

replace_once(
    "src/broker.ts",
    '''  async dispatch(
    auth: AuthContext,
    req: Request,
    stream: AsyncIterable<Uint8Array> | null,
  ): Promise<object> {''',
    '''  private preflightPublicStream(
    auth: AuthContext,
    envelope: Record<string, unknown>,
  ): object | null {
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    const reject = (code: string, message: string) =>
      Broker.errorAnswer(id, { code, message, retry: "never" });
    if (typeof envelope.id !== "string" || typeof envelope.method !== "string" ||
      !Object.keys(envelope).every((key) => ["v", "id", "method", "params", "request"].includes(key)))
      return reject("INVALID_REQUEST", "invalid request envelope");
    if (envelope.v !== 1) return reject("UNSUPPORTED_VERSION", "unsupported protocol version");
    if (method !== "git.submit" && method !== "context.publish")
      return reject("INVALID_REQUEST", "method does not accept a stream body");
    if (!isValidRequestKey(envelope.request))
      return reject("INVALID_REQUEST", "mutation requires a valid request key");
    const actor = this.store.getAgent(auth.actor);
    if (auth.channel === "actor" &&
      (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled"))
      return reject("STALE_RUN", "actor incarnation is stale");
    const need = METHOD_CAPABILITY[method as PublicMethod];
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need)))
      return reject("CAPABILITY_DENIED", `missing capability ${need}`);
    if (!this.checkParams(method, envelope.params))
      return reject("INVALID_REQUEST", `invalid params for ${method}`);
    if (!this.git) return reject("SPIKE_UNRESOLVED", "git module unavailable");
    return null;
  }

  async dispatch(
    auth: AuthContext,
    req: Request,
    stream: AsyncIterable<Uint8Array> | null,
  ): Promise<object> {''',
)
replace_once(
    "src/broker.ts",
    '''          const r = spawnSync(
            "journalctl",
            [
              "--user",
              "--unit",
              svc,
              "--since",
              `${p.sinceSeconds}s ago`,
              "--no-pager",
              "--output=cat",
            ],
            { encoding: "utf8", maxBuffer: this.limits.logBytes },
          );
          const text = (r.stdout ?? "").slice(0, this.limits.logBytes);
          return Broker.okAnswer(id, {
            text,
            truncated: (r.stdout ?? "").length > text.length,
            observedAtMs: Date.now(),
          });''',
    '''          const r = spawnSync(
            "journalctl",
            [
              "--user",
              "--unit",
              svc,
              "--since",
              `${p.sinceSeconds}s ago`,
              "--no-pager",
              "--output=cat",
            ],
            {
              encoding: "utf8",
              maxBuffer: this.limits.logBytes,
              timeout: 30_000,
              killSignal: "SIGKILL",
            },
          );
          if (r.error) {
            const overflow = (r.error as NodeJS.ErrnoException).code === "ENOBUFS" || /maxBuffer/i.test(r.error.message);
            throw new StoreError(
              overflow ? "LIMIT_EXCEEDED" : "INTERNAL_ERROR",
              overflow ? "journal output exceeds configured logBytes" : `journalctl failed: ${r.error.message}`,
            );
          }
          if (r.status !== 0 || r.signal)
            throw new StoreError("INTERNAL_ERROR", `journalctl failed with status ${String(r.status)}`);
          return Broker.okAnswer(id, {
            text: r.stdout ?? "",
            truncated: false,
            observedAtMs: Date.now(),
          });''',
)
replace_once(
    "src/broker.ts",
    '''  if (op.resultJson) {
    try {
      rec.result = JSON.parse(op.resultJson);
    } catch {
      /* corrupt result; receipt stays minimal */
    }
  }''',
    '''  if (op.resultJson) {
    try {
      rec.result = JSON.parse(op.resultJson);
    } catch {
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt result`);
    }
  }''',
)

# ---------------------------------------------------------------------------
# Units: all systemd helper subprocesses get bounded output/time defaults.
# ---------------------------------------------------------------------------
text = read("src/units.ts")
if "const boundedSpawnSync: typeof spawnSync" not in text:
    text = text.replace("spawnSync(", "boundedSpawnSync(")
    marker = '''const REFERENCE_RESOURCES = {'''
    helper = '''const boundedSpawnSync: typeof spawnSync = ((
  command: string,
  args?: readonly string[],
  options?: object,
) => spawnSync(command, args ? [...args] : [], {
  timeout: 30_000,
  killSignal: "SIGKILL",
  maxBuffer: 1024 * 1024,
  ...(options ?? {}),
})) as typeof spawnSync;

'''
    if marker not in text:
        raise SystemExit("src/units.ts: resource marker not found")
    text = text.replace(marker, helper + marker, 1)
    write("src/units.ts", text)

# ---------------------------------------------------------------------------
# Pi trust boundaries: validate parsed objects rather than using casts as the
# validation operation. Batch view is a closed DTO.
# ---------------------------------------------------------------------------
replace_once(
    "src/pi-extension.ts",
    '''    const raw = readFileSync(`/run/oma-view/batch-${batchId}.json`, "utf8");
    const v = JSON.parse(raw) as BatchView;
    if (
      typeof v.id !== "string" ||
      typeof v.notice !== "string" ||
      !Array.isArray(v.messageIds)
    )
      return null;
    return v;''',
    '''    const raw = readFileSync(`/run/oma-view/batch-${batchId}.json`, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const v = parsed as Record<string, unknown>;
    const allowed = ["id", "agent", "incarnation", "deliveryMode", "notice", "messageIds"];
    if (!Object.keys(v).every((key) => allowed.includes(key)) ||
      v.id !== batchId || typeof v.agent !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(v.agent) ||
      !Number.isSafeInteger(v.incarnation) || (v.incarnation as number) < 0 ||
      (v.deliveryMode !== "steer" && v.deliveryMode !== "followUp") ||
      typeof v.notice !== "string" || !Array.isArray(v.messageIds) ||
      v.messageIds.some((id) => typeof id !== "string" || !/^m-[0-9a-f-]{36}-\\d+$/.test(id)))
      return null;
    return {
      id: v.id as string,
      agent: v.agent,
      incarnation: v.incarnation as number,
      deliveryMode: v.deliveryMode,
      notice: v.notice,
      messageIds: [...v.messageIds] as string[],
    };''',
)
replace_once(
    "src/rpc-client.ts",
    '''        const evt = JSON.parse(line) as PiEvent;
        if (typeof evt.type === "string") {
          for (const fn of this.observers) fn(evt);
        }''',
    '''        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const evt = parsed as Record<string, unknown>;
          if (typeof evt.type === "string" && (evt.id === undefined || typeof evt.id === "string")) {
            for (const fn of this.observers) fn(evt as PiEvent);
          }
        }''',
)

# ---------------------------------------------------------------------------
# Spec hygiene only: make the tiered gates canonical without implementing any
# S-08/S-10/S-11 runtime API or persistence.
# ---------------------------------------------------------------------------
replace_once(
    "implementation/spikes.md",
    '''## S-08 — OPTIONAL formal approval policy

**SPIKE [S-08]** Human이 신뢰 주체/quorum/보호 경로/Principal 위임을 선택한 뒤 최소 append-only attestation DDL, revoke relation, tuple evaluation을 확정한다. 이 계약은 quorum 수나 'agent 2명=독립 2표'를 결정하지 않는다.''',
    '''## S-08 — approval / authenticated attestation (base OPTIONAL; tiered REQUIRED gate)

**SPIKE [S-08]** base profile의 formal approval은 OPTIONAL이다. 목표 `tiered` profile에서는 [integration-policy.md](integration-policy.md)의 authenticated attestation authority를 production으로 사용하기 전에 S-08이 필수 gate다. Human이 신뢰 주체/quorum/보호 경로/Principal 위임을 선택한 뒤 최소 append-only attestation DDL, revoke relation, exact tuple evaluation을 확정한다. 이 계약은 quorum 수나 'agent 2명=독립 2표'를 결정하지 않는다.''',
)
replace_once(
    "implementation/spikes.md",
    '''**MUST [SP-09-T]** strong 단독/cheap 단독/hybrid에 같은 repository snapshot과 tools를 제공하고 반복한다. quality/defect/omission, Principal 및 전체 tokens/cost, latency, commons의 Principal 유입 건수, 경로/ID lookup 실패, 첫 유용한 행동까지 tool 수, Principal 재검증 비용을 기록한다.''',
    '''**MUST [SP-09-T]** strong 단독/cheap 단독/hybrid에 같은 repository snapshot과 tools를 제공하고 반복한다. quality/defect/omission, Principal 및 전체 tokens/cost, latency, commons의 Principal 유입 건수, 경로/ID lookup 실패, 첫 유용한 행동까지 tool 수, Principal 재검증 비용을 기록한다.

## S-10 — tiered challenge + persistent re-entry floor

**SPIKE [S-10]** [integration-policy.md](integration-policy.md)의 challenge 판정권, floor scope/mapping, 보존/해제, CAS 경합과 최소 authenticated persistence schema를 확정한다. 이 gate가 OPEN인 동안 challenge/floor table, sidecar DB, public mutation API를 추측 구현하지 않으며 LOW optimistic path를 tiered production 지원으로 표시하지 않는다.

**MUST [SP-10-A]** restart/revert/rebase/cherry-pick 또는 새 OID가 유효한 re-entry floor를 조용히 초기화하지 않아야 한다. 단, 의미 lineage를 Git ancestry만으로 추측하지 않는다. exact schema와 mapping 근거가 없으면 `SPIKE_UNRESOLVED`로 fail closed한다.

## S-11 — OPTIONAL fresh-context verifier

**SPIKE [S-11]** [integration-policy.md](integration-policy.md)의 fresh/clean-room verifier는 OPTIONAL 독립 gate다. 사용할 경우 verifier identity/context isolation/evidence binding과 비용 상한을 executable harness로 확정한다. 결과가 없으면 verifier 경로를 비활성으로 유지하고 기존 Principal/Resident session을 fresh verifier라고 재명명하지 않는다.

**MUST [SP-11-A]** 선택 기능을 활성화했을 때만 해당 verifier evidence를 authority 입력으로 인정하며, Human private context·host credential·기존 session memory가 clean-room 경계로 누출되면 profile을 차단한다.''',
)

# ---------------------------------------------------------------------------
# Regression tests for the highest-value integrity bugs. Existing suite covers
# the broader lifecycle, IPC, Git, and recovery surface.
# ---------------------------------------------------------------------------
Path("test/adversarial-fixes.test.ts").write_text(r'''import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEml, MailModule } from "../src/mail.js";
import { generateMessageId, generateOperationId } from "../src/ids.js";
import { sha256Hex } from "../src/hash.js";
import { Store, StoreError } from "../src/store.js";
import { messagePlanCheck } from "../src/validate.js";
import { loadConfig } from "../src/config.js";

const oidA = "a".repeat(40);
const oidB = "b".repeat(40);
const approval = {
  repo: "project" as const,
  targetRef: "refs/heads/main" as const,
  expectedBase: oidA,
  candidate: oidB,
  policyRevision: "policy-1",
};

function basePlan(to: string[]) {
  const op = generateOperationId();
  const id = generateMessageId(op, 0);
  return {
    id,
    objectPath: `mail/objects/${id}.eml`,
    sha256: "0".repeat(64),
    bytes: 0,
    dateMs: 0,
    to,
    recipients: ["alice"],
    kind: "message",
    contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
  };
}

test("DB-009: persisted MessagePlan requires logical addresses", () => {
  assert.equal(messagePlanCheck(basePlan(["alice", "principal", "topic/review"])), null);
  assert.notEqual(messagePlanCheck(basePlan(["alice@demo.oma.invalid"])), null);
  assert.notEqual(messagePlanCheck(basePlan(["garbage-not-an-address!"])), null);
  assert.notEqual(messagePlanCheck({ ...basePlan(["alice"]), replyHeaders: { replyTo: ["alice@demo.oma.invalid"], inReplyTo: null, references: [] } }), null);
});

test("IPC-005: buildEml never rewrites body while normalizing header spelling", async () => {
  const body = "collision X-Oma-Kind: stays\nX-Oma-Context: stays too";
  const eml = await buildEml({
    from: "alice@demo.oma.invalid",
    to: ["principal@demo.oma.invalid"],
    replyTo: ["alice@demo.oma.invalid"],
    subject: "collision",
    kind: "message",
    contextRevision: null,
    inReplyTo: null,
    references: [],
    messageId: "test@demo.oma.invalid",
    body,
  });
  assert.match(eml.text, /collision X-Oma-Kind: stays/);
  assert.match(eml.text, /X-Oma-Context: stays too/);
  assert.doesNotMatch(eml.text, /collision X-OMA-Kind: stays/);
});

test("FS-002: freezeObject is create-once and collision-checking", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-freeze-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
    const id = generateMessageId(generateOperationId(), 0);
    mail.freezeObject(id, { text: "one", sha256: sha256Hex("one") });
    mail.freezeObject(id, { text: "one", sha256: sha256Hex("one") });
    assert.equal(readFileSync(mail.objectPath(id), "utf8"), "one");
    assert.throws(
      () => mail.freezeObject(id, { text: "two", sha256: sha256Hex("two") }),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.equal(readFileSync(mail.objectPath(id), "utf8"), "one");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MAIL-003: plan approval identity must equal immutable EML metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-approval-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
    const op = generateOperationId();
    const id = generateMessageId(op, 0);
    const eml = await buildEml({
      from: "alice@demo.oma.invalid",
      to: ["principal@demo.oma.invalid"],
      replyTo: ["alice@demo.oma.invalid"],
      subject: "review",
      kind: "approval_required",
      approvalFor: approval,
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: `${id}@demo.oma.invalid`,
      body: "review",
    });
    mail.freezeObject(id, eml);
    const mismatched = { ...approval, candidate: "c".repeat(40) };
    store.transaction(() => {
      store.insertOperation({
        id,
        actor: "alice",
        requestKey: "approval-cross-check",
        requestHash: "h",
        kind: "mail.send",
        payloadJson: "{}",
        planJson: JSON.stringify({
          kind: "mail.send",
          message: {
            id,
            objectPath: `mail/objects/${id}.eml`,
            sha256: eml.sha256,
            bytes: eml.bytes,
            dateMs: 0,
            to: ["principal"],
            recipients: ["principal"],
            kind: "approval_required",
            approvalFor: mismatched,
            contextRevision: null,
            replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
          },
        }),
      });
    });
    await assert.rejects(
      mail.publishGated(op),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-003: terminal operation state cannot be rewritten", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-terminal-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    const op = generateOperationId();
    const result = JSON.stringify({ kind: "mail.ack", message: generateMessageId(op, 0), acknowledged: true });
    store.transaction(() => {
      store.insertOperation({ id: op, actor: "alice", requestKey: "terminal", requestHash: "h", kind: "mail.ack", payloadJson: "{}", planJson: JSON.stringify({ kind: "mail.ack", recipient: "alice", message: generateMessageId(op, 0) }) });
      store.setOperationSucceeded(op, result);
      store.setOperationSucceeded(op, result);
    });
    assert.throws(
      () => store.transaction(() => store.setOperationUnknown(op)),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.throws(
      () => store.transaction(() => store.setOperationFailed(op, "INTERNAL_ERROR")),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function validConfig() {
  const resources = { memoryBytes: 1, tasks: 1, cpuQuotaPercent: 1, tmpBytes: 1, workspaceBytes: 1, stagingBytes: 1, checkTimeoutSeconds: 1 };
  return {
    schemaVersion: 1,
    society: "demo",
    installation: { node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/", deploymentDigest: "d" },
    modelProfiles: { m: { provider: "p", model: "m", credentialRef: "c", codecRevision: "c1", pricingRevision: "p1", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 } },
    agentProfiles: { a: { modelProfile: "m", capabilities: [], delegable: [], childProfile: null, resources } },
    principalProfile: "a",
    initialResidents: [],
    quota: { societyAgents: 1, lineageAgents: 1, societyUnits: 1, lineageUnits: 1, principalReservedUnits: 0, inferenceSlots: 1, principalReservedSlots: 1, storageBytes: 1 },
    integration: { policyRevision: "p1", protectedPaths: ["/"], checks: [] },
    limits: { frameBytes: 1, mailBodyBytes: 1, subjectBytes: 1, addresses: 1, replyReferences: 1, contextFiles: 1, contextBytes: 1, bundleBytes: 1, logBytes: 1, batchMaxMessages: 1, idleStreamSeconds: 1, receiptWaitSeconds: 1 },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}

test("CFG-005: root protected path is legal and Principal slot reserve cannot exceed total", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-config-"));
  const path = join(root, "config.json");
  try {
    writeFileSync(path, JSON.stringify(validConfig()));
    assert.deepEqual(loadConfig(path).integration.protectedPaths, ["/"]);
    const invalid = validConfig();
    invalid.quota.principalReservedSlots = 2;
    writeFileSync(path, JSON.stringify(invalid));
    assert.throws(() => loadConfig(path), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
''', encoding="utf-8")

print("adversarial fixes staged")
