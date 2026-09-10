from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def text(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, value: str) -> None:
    (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
    (ROOT / path).write_text(value)


def replace_once(path: str, old: str, new: str) -> None:
    value = text(path)
    count = value.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    write(path, value.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    value = text(path)
    count = value.count(old)
    if count < minimum:
        raise SystemExit(f"{path}: expected >= {minimum} matches, found {count}: {old[:120]!r}")
    write(path, value.replace(old, new))


# ---------------------------------------------------------------------------
# mail: logical MessagePlan addresses, body immutability, immutable object
# publication, and approval header/plan cross-validation.
# ---------------------------------------------------------------------------
replace_once(
    "src/mail.ts",
    'import { encodeWord } from "nodemailer/lib/mime-funcs";',
    'import { decodeWords, encodeWord } from "nodemailer/lib/mime-funcs";',
)
replace_once(
    "src/mail.ts",
    '''  const raw = (info as unknown as { message: Buffer }).message;\n  const text = raw\n    .toString("utf8")\n    .replace(/X-Oma-Kind:/g, "X-OMA-Kind:")\n    .replace(/X-Oma-Context:/g, "X-OMA-Context:");''',
    '''  const raw = (info as unknown as { message: Buffer }).message;\n  // Header field names are case-insensitive. Never rewrite the serialized EML:\n  // doing so would also rewrite matching text in the immutable user body.\n  const text = raw.toString("utf8");''',
)
replace_once(
    "src/mail.ts",
    '''export function topicAddress(topic: string, society: string): string {\n  return `topic-${topic}@${society}.oma.invalid`;\n}\n''',
    '''export function topicAddress(topic: string, society: string): string {\n  return `topic-${topic}@${society}.oma.invalid`;\n}\n\nexport function addressToEmail(address: Address, society: string): string {\n  if (address === "principal" || address === "commons" || address === "residents")\n    return listAddress(address, society);\n  if (address.startsWith("topic/")) return topicAddress(address.slice(6), society);\n  return actorAddress(address, society);\n}\n\n/** MAIL-005/DB-009: persisted reply targets remain logical addresses. */\nexport function defaultLogicalReplyTo(\n  from: Address,\n  to: readonly Address[],\n): Address[] {\n  const lists = to.filter(\n    (address) =>\n      address === "commons" ||\n      address === "residents" ||\n      address.startsWith("topic/"),\n  );\n  return [...new Set(lists.length > 0 ? lists : [from])];\n}\n''',
)
replace_once(
    "src/mail.ts",
    '''export interface ParsedEmlHeaders {\n  from: string | null;\n  subject: string | null;\n  messageId: MessageId | null;\n  inReplyTo: MessageId | null;\n  references: MessageId[];\n  replyTo: string[] | null;\n}\n''',
    '''export interface ParsedEmlHeaders {\n  from: string | null;\n  subject: string | null;\n  messageId: MessageId | null;\n  inReplyTo: MessageId | null;\n  references: MessageId[];\n  replyTo: string[] | null;\n  approvalFor: {\n    repo: string | null;\n    targetRef: string | null;\n    expectedBase: string | null;\n    candidate: string | null;\n    policyRevision: string | null;\n  } | null;\n}\n''',
)
replace_once(
    "src/mail.ts",
    '''  const refs = (h: string | undefined): MessageId[] => {\n    if (!h) return [];\n    const out: MessageId[] = [];\n    for (const m of h.matchAll(/<([^>]+)>/g)) out.push(m[1] as MessageId);\n    return out;\n  };\n  return {''',
    '''  const refs = (h: string | undefined): MessageId[] => {\n    if (!h) return [];\n    const out: MessageId[] = [];\n    for (const m of h.matchAll(/<([^>]+)>/g)) out.push(m[1] as MessageId);\n    return out;\n  };\n  const approvalKeys = [\n    "x-oma-approval-repo",\n    "x-oma-approval-target",\n    "x-oma-approval-base",\n    "x-oma-approval-candidate",\n    "x-oma-approval-policy",\n  ] as const;\n  const approvalFor = approvalKeys.some((key) => headers[key] !== undefined)\n    ? {\n        repo: headers["x-oma-approval-repo"] ?? null,\n        targetRef: headers["x-oma-approval-target"] ?? null,\n        expectedBase: headers["x-oma-approval-base"] ?? null,\n        candidate: headers["x-oma-approval-candidate"] ?? null,\n        policyRevision: headers["x-oma-approval-policy"]\n          ? decodeWords(headers["x-oma-approval-policy"])\n          : null,\n      }\n    : null;\n  return {''',
)
replace_once(
    "src/mail.ts",
    '''    replyTo: headers["reply-to"]\n      ? headers["reply-to"].split(",").map((s) => s.trim())\n      : null,\n  };''',
    '''    replyTo: headers["reply-to"]\n      ? headers["reply-to"].split(",").map((s) => s.trim())\n      : null,\n    approvalFor,\n  };''',
)
replace_once(
    "src/mail.ts",
    '''    let replyHeaders: {\n      replyTo: string[];\n      inReplyTo: MessageId | null;\n      references: MessageId[];\n    } = {\n      replyTo: defaultReplyTo(actorAddress(auth.actor, society), route.displayTo),\n      inReplyTo: null,\n      references: [],\n    };''',
    '''    let replyHeaders: {\n      replyTo: Address[];\n      inReplyTo: MessageId | null;\n      references: MessageId[];\n    } = {\n      replyTo: defaultLogicalReplyTo(auth.actor, targetAddresses),\n      inReplyTo: null,\n      references: [],\n    };''',
)
replace_once(
    "src/mail.ts",
    '''      replyTo: replyHeaders.replyTo,\n      subject: input.subject,''',
    '''      replyTo: replyHeaders.replyTo.map((address) => addressToEmail(address, society)),\n      subject: input.subject,''',
)
replace_once(
    "src/mail.ts",
    '        to: [...route.displayTo].sort(),',
    '        to: [...new Set(targetAddresses)].sort(),',
)
replace_once(
    "src/mail.ts",
    '''  freezeObject(messageId: MessageId, eml: { text: string }): void {\n    const object = this.objectPath(messageId);\n    mkdirSync(dirname(object), { recursive: true });\n    writeFsynced(object, eml.text);\n  }''',
    '''  freezeObject(messageId: MessageId, eml: { text: string }): void {\n    const object = this.objectPath(messageId);\n    const stagingDir = join(this.paths.stateRoot, "staging", "mail-objects");\n    mkdirSync(stagingDir, { recursive: true });\n    const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);\n    try {\n      writeFsynced(staged, eml.text);\n      fsyncDir(stagingDir);\n      publishImmutableFile(staged, object, sha256Hex(eml.text));\n    } finally {\n      rmSync(staged, { force: true });\n      fsyncDir(stagingDir);\n    }\n  }''',
)
replace_once(
    "src/mail.ts",
    '''      new Set(message.recipients).size !== message.recipients.length ||\n      (message.kind === "approval_required") !== (message.approvalFor !== undefined) ||\n      (message.kind === "approval_required" && !message.to.some(address => logicalReplyAddress(this.store, address, this.paths.society) === "principal")))''',
    '''      new Set(message.recipients).size !== message.recipients.length ||\n      message.to.some((address) => logicalReplyAddress(this.store, address, this.paths.society) === null) ||\n      message.replyHeaders.replyTo.some((address) => logicalReplyAddress(this.store, address, this.paths.society) === null) ||\n      (message.kind === "approval_required") !== (message.approvalFor !== undefined) ||\n      (message.kind === "approval_required" && !message.to.includes("principal")))''',
)
replace_once(
    "src/mail.ts",
    '''    if (headers.messageId?.split("@", 1)[0] !== message.id)\n      throw new StoreError("STORE_CORRUPT", `mail header mismatch: ${message.id}`);\n    return headers;''',
    '''    if (headers.messageId?.split("@", 1)[0] !== message.id)\n      throw new StoreError("STORE_CORRUPT", `mail header mismatch: ${message.id}`);\n    const expectedApproval = message.approvalFor ?? null;\n    const actualApproval = headers.approvalFor;\n    if (\n      (expectedApproval === null) !== (actualApproval === null) ||\n      (expectedApproval !== null && actualApproval !== null &&\n        (actualApproval.repo !== expectedApproval.repo ||\n          actualApproval.targetRef !== expectedApproval.targetRef ||\n          actualApproval.expectedBase !== expectedApproval.expectedBase ||\n          actualApproval.candidate !== expectedApproval.candidate ||\n          actualApproval.policyRevision !== expectedApproval.policyRevision))\n    )\n      throw new StoreError("STORE_CORRUPT", `mail approval metadata mismatch: ${message.id}`);\n    return headers;''',
)
replace_once(
    "src/mail.ts",
    '''    const suffix = `@${this.paths.society}.oma.invalid`;\n    return message.to.every(\n      (to) =>\n        to === `commons${suffix}` ||\n        to === `residents${suffix}` ||\n        (to.startsWith("topic-") && to.endsWith(suffix)),\n    );''',
    '''    return message.to.every(\n      (to) =>\n        to === "commons" ||\n        to === "residents" ||\n        to.startsWith("topic/"),\n    );''',
)

# ---------------------------------------------------------------------------
# validate: persisted MessagePlan addresses are closed logical addresses and
# durable operation results are validated before operation.get returns them.
# ---------------------------------------------------------------------------
replace_once(
    "src/validate.ts",
    '''export function checkAddress(actorNames: ReadonlySet<string>): Check {\n  return (v) => {\n    if (typeof v !== "string")\n      return `expected address string, got ${typeName(v)}`;\n    if (v.startsWith("topic/"))\n      return isValidTopicName(v.slice(6)) ? null : `invalid topic address`;\n    if (v === "principal" || v === "commons" || v === "residents") return null;\n    return actorNames.has(v) ? null : `unknown address "${v}"`;\n  };\n}\n''',
    '''export function checkAddress(actorNames: ReadonlySet<string>): Check {\n  return (v) => {\n    if (typeof v !== "string")\n      return `expected address string, got ${typeName(v)}`;\n    if (v.startsWith("topic/"))\n      return isValidTopicName(v.slice(6)) ? null : `invalid topic address`;\n    if (v === "principal" || v === "commons" || v === "residents") return null;\n    return actorNames.has(v) ? null : `unknown address "${v}"`;\n  };\n}\n\n/** DB-009: persisted plans carry logical syntax, never rendered RFC addresses. */\nexport const checkPersistedAddress: Check = (v) => {\n  if (typeof v !== "string") return `expected address string, got ${typeName(v)}`;\n  if (v.startsWith("topic/"))\n    return isValidTopicName(v.slice(6)) ? null : "invalid topic address";\n  if (v === "principal" || v === "commons" || v === "residents") return null;\n  return isValidActorName(v) ? null : `invalid logical address "${v}"`;\n};\n''',
)
replace_once(
    "src/validate.ts",
    '''  to: checkArray(checkString({ min: 1 })),\n  recipients: checkArray(v => v === "principal" ? null : checkActor(v)),''',
    '''  to: checkArray(checkPersistedAddress),\n  recipients: checkArray(v => v === "principal" ? null : checkActor(v)),''',
)
replace_once(
    "src/validate.ts",
    '''  replyHeaders: checkObject({\n    replyTo: checkArray(checkString({ min: 1 })),''',
    '''  replyHeaders: checkObject({\n    replyTo: checkArray(checkPersistedAddress),''',
)
insert_marker = 'export const agentCreateParamsCheck: Check = checkObject({'
value = text("src/validate.ts")
if value.count(insert_marker) != 1:
    raise SystemExit("src/validate.ts: operation result insertion marker mismatch")
operation_validation = r'''const messageIdCheck = checkString({ re: /^m-[0-9a-f-]{36}-\d+$/ });
const operationIdCheck = checkString({ re: /^op-[0-9a-f-]{36}$/ });

/** DB-009/M-003: result_json is a closed result variant keyed by operation kind. */
export function operationResultCheck(kind: string): Check {
  switch (kind) {
    case "mail.send":
    case "agent.continue":
      return checkObject({
        kind: checkEnum([kind]), message: messageIdCheck,
        recipientCount: checkInt({ min: 0 }), archivePath: checkString({ min: 1 }),
      });
    case "mail.ack":
      return checkObject({ kind: checkEnum(["mail.ack"]), message: messageIdCheck, acknowledged: (v) => v === true ? null : "expected true" });
    case "route.follow":
    case "route.unfollow":
      return checkObject({ kind: checkEnum([kind]), topic: checkTopic, subscribed: checkBool() });
    case "agent.create":
    case "agent.start":
    case "agent.stop":
      return checkObject({
        kind: checkEnum([kind]), agent: checkActor,
        desired: checkEnum(["provisioning", "enabled", "stopped", "retired"] as const),
        remainingOperations: checkArray(operationIdCheck),
      });
    case "git.submit":
      return checkObject({
        kind: checkEnum(["git.submit"]), candidate: checkOid,
        publishedRef: checkString({ re: /^refs\/oma\/published\/[a-z][a-z0-9-]{0,31}\/op-[0-9a-f-]{36}$/ }),
        message: messageIdCheck, recipientCount: checkInt({ min: 0 }),
      });
    case "git.integrate":
      return checkObject({
        kind: checkEnum(["git.integrate"]), base: checkOid, candidate: checkOid,
        target: checkEnum(["refs/heads/main"]), policyRevision: checkString({ min: 1 }), changed: checkBool(),
      });
    case "context.publish":
      return checkObject({
        kind: checkEnum(["context.publish"]), previous: (v) => v === null ? null : checkOid(v),
        revision: checkOid, message: messageIdCheck, recipientCount: checkInt({ min: 0 }),
      });
    default:
      return () => `unknown operation kind ${kind}`;
  }
}

'''
write("src/validate.ts", value.replace(insert_marker, operation_validation + insert_marker, 1))

# ---------------------------------------------------------------------------
# store: distinguish BUSY from damaged DB and make terminal operations immutable.
# ---------------------------------------------------------------------------
replace_once(
    "src/store.ts",
    '''      } catch (e) {\n        if (isBusyError(e) && i < this.busyRetries) continue;\n        throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");\n      }''',
    '''      } catch (e) {\n        if (isBusyError(e)) {\n          if (i < this.busyRetries) continue;\n          throw new StoreError("DB_BUSY", "BEGIN IMMEDIATE blocked");\n        }\n        throw new StoreError(\n          "STORE_CORRUPT",\n          `BEGIN IMMEDIATE failed: ${(e as Error).message}`,\n        );\n      }''',
)
replace_once(
    "src/store.ts",
    '''  setOperationSucceeded(id: OperationId, resultJson: string): void {\n    this.requireTx();\n    this.db\n      .prepare(\n        "UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=?",\n      )\n      .run(resultJson, Date.now(), id);\n  }\n\n  setOperationFailed(id: OperationId, code: ErrorCode): void {\n    this.requireTx();\n    this.db\n      .prepare(\n        "UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=?",\n      )\n      .run(code, Date.now(), id);\n  }\n\n  setOperationUnknown(id: OperationId): void {\n    this.requireTx();\n    this.db\n      .prepare(\n        "UPDATE operations SET state='unknown', updated_at_ms=? WHERE id=?",\n      )\n      .run(Date.now(), id);\n  }''',
    '''  private mutableOperation(id: OperationId): OperationRow {\n    const op = this.getOperationById(id);\n    if (!op) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);\n    return op;\n  }\n\n  setOperationSucceeded(id: OperationId, resultJson: string): void {\n    this.requireTx();\n    const op = this.mutableOperation(id);\n    if (op.state === "succeeded") {\n      if (op.resultJson === resultJson && op.errorCode === null) return;\n      throw new StoreError("STORE_CORRUPT", `terminal operation ${id} changed success result`);\n    }\n    if (op.state === "failed")\n      throw new StoreError("STORE_CORRUPT", `terminal operation ${id} cannot become succeeded`);\n    this.db.prepare(\n      "UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=? WHERE id=?",\n    ).run(resultJson, Date.now(), id);\n  }\n\n  setOperationFailed(id: OperationId, code: ErrorCode): void {\n    this.requireTx();\n    const op = this.mutableOperation(id);\n    if (op.state === "failed") {\n      if (op.errorCode === code && op.resultJson === null) return;\n      throw new StoreError("STORE_CORRUPT", `terminal operation ${id} changed failure result`);\n    }\n    if (op.state === "succeeded")\n      throw new StoreError("STORE_CORRUPT", `terminal operation ${id} cannot become failed`);\n    this.db.prepare(\n      "UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=? WHERE id=?",\n    ).run(code, Date.now(), id);\n  }\n\n  setOperationUnknown(id: OperationId): void {\n    this.requireTx();\n    const op = this.mutableOperation(id);\n    if (op.state === "succeeded" || op.state === "failed")\n      throw new StoreError("STORE_CORRUPT", `terminal operation ${id} cannot become unknown`);\n    if (op.state === "unknown") return;\n    this.db.prepare(\n      "UPDATE operations SET state='unknown', updated_at_ms=? WHERE id=?",\n    ).run(Date.now(), id);\n  }''',
)

# ---------------------------------------------------------------------------
# config: enforce positive slot/storage bounds, reserve relation, root protected
# path semantics, and bootstrap agent quotas.
# ---------------------------------------------------------------------------
replace_once(
    "src/config.ts",
    '''  const societyUnits = needInt(quota["societyUnits"], "quota.societyUnits", 0);''',
    '''  const societyAgents = needInt(quota["societyAgents"], "quota.societyAgents", 0);\n  const lineageAgents = needInt(quota["lineageAgents"], "quota.lineageAgents", 0);\n  if (societyAgents < initialResidents.length + 1)\n    err("quota.societyAgents cannot hold principal plus initialResidents");\n  if (lineageAgents < initialResidents.length)\n    err("quota.lineageAgents cannot hold the initial Principal lineage");\n  const societyUnits = needInt(quota["societyUnits"], "quota.societyUnits", 0);''',
)
replace_once(
    "src/config.ts",
    '''  if (principalReservedUnits > societyUnits)\n    err("quota.principalReservedUnits exceeds quota.societyUnits");\n''',
    '''  if (principalReservedUnits > societyUnits)\n    err("quota.principalReservedUnits exceeds quota.societyUnits");\n  const inferenceSlots = needInt(quota["inferenceSlots"], "quota.inferenceSlots", 1);\n  const principalReservedSlots = needInt(\n    quota["principalReservedSlots"],\n    "quota.principalReservedSlots",\n    0,\n  );\n  if (principalReservedSlots > inferenceSlots)\n    err("quota.principalReservedSlots exceeds quota.inferenceSlots");\n  needInt(quota["storageBytes"], "quota.storageBytes", 1);\n''',
)
replace_once(
    "src/config.ts",
    '''        typeof x !== "string" ||\n        !isValidWirePath(x.endsWith("/") ? x.slice(0, -1) : x) ||\n        /[*?[\\]{}!]/.test(x),''',
    '''        typeof x !== "string" ||\n        x.length === 0 ||\n        (x !== "/" && !isValidWirePath(x.endsWith("/") ? x.slice(0, -1) : x)) ||\n        /[*?[\\]{}!]/.test(x),''',
)

# ---------------------------------------------------------------------------
# lifecycle: enforce society + every ancestor lineage agent cap in the accepting
# transaction. All lifecycle Git subprocesses also get wall/output bounds.
# ---------------------------------------------------------------------------
replace_once(
    "src/lifecycle.ts",
    'import { spawnSync } from "node:child_process";',
    '''import {\n  spawnSync as nodeSpawnSync,\n  type SpawnSyncOptions,\n  type SpawnSyncOptionsWithStringEncoding,\n  type SpawnSyncReturns,\n} from "node:child_process";''',
)
clone_marker = '''const cloneEnv: NodeJS.ProcessEnv = {'''
value = text("src/lifecycle.ts")
idx = value.index(clone_marker)
end = value.index('};\n\nfunction specDigest', idx) + 3
spawn_wrapper = r'''

function checkedSpawn<T extends string | Buffer>(
  result: SpawnSyncReturns<T>,
  operation: string,
): SpawnSyncReturns<T> {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT")
      throw new StoreError("DEADLINE_EXCEEDED", `${operation} timed out`);
    if (code === "ENOBUFS")
      throw new StoreError("LIMIT_EXCEEDED", `${operation} output exceeded the bound`);
    throw new StoreError("INTERNAL_ERROR", `${operation} spawn failed: ${result.error.message}`);
  }
  return result;
}

function spawnSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
function spawnSync(
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
): SpawnSyncReturns<Buffer>;
function spawnSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
  const bounded: SpawnSyncOptions = {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    killSignal: "SIGKILL",
    ...options,
  };
  if (typeof bounded.encoding === "string" && bounded.encoding !== "buffer")
    return checkedSpawn(
      nodeSpawnSync(command, [...args], bounded as SpawnSyncOptionsWithStringEncoding),
      command,
    );
  return checkedSpawn(nodeSpawnSync(command, [...args], bounded), command);
}
'''
value = value[:end] + spawn_wrapper + value[end:]
write("src/lifecycle.ts", value)
replace_once(
    "src/lifecycle.ts",
    '''    private readonly resolveSpec: SpecResolver,\n    private readonly mail: MailModule | null = null,\n  ) {}''',
    '''    private readonly resolveSpec: SpecResolver,\n    private readonly mail: MailModule | null = null,\n    private readonly agentQuota: Pick<HostConfigV1["quota"], "societyAgents" | "lineageAgents"> | null = null,\n  ) {}''',
)
quota_marker = '''  private resolveCreate(\n    auth: AuthContext,'''
value = text("src/lifecycle.ts")
if value.count(quota_marker) != 1:
    raise SystemExit("src/lifecycle.ts: quota insertion marker mismatch")
quota_helper = r'''  private assertCreateQuota(parent: Actor): void {
    const quota = this.agentQuota;
    if (!quota) return;
    const agents = this.store.listAgents();
    if (agents.length >= quota.societyAgents)
      throw new StoreError("QUOTA_EXCEEDED", "society agent quota exhausted");
    const byName = new Map(agents.map((agent) => [agent.name, agent]));
    const ancestors: Actor[] = [];
    const seen = new Set<string>();
    let cursor: string | null = parent;
    while (cursor !== null) {
      if (!seen.add(cursor)) throw new StoreError("STORE_CORRUPT", "agent ancestry cycle");
      const row = byName.get(cursor);
      if (!row) throw new StoreError("STORE_CORRUPT", `missing ancestor ${cursor}`);
      ancestors.push(row.name);
      cursor = row.createdBy;
    }
    const counts = new Map(ancestors.map((ancestor) => [ancestor, 0]));
    for (const agent of agents) {
      let current = agent.createdBy;
      const walk = new Set<string>();
      while (current !== null) {
        if (!walk.add(current)) throw new StoreError("STORE_CORRUPT", "agent ancestry cycle");
        if (counts.has(current as Actor))
          counts.set(current as Actor, (counts.get(current as Actor) ?? 0) + 1);
        const row = byName.get(current);
        if (!row) throw new StoreError("STORE_CORRUPT", `missing ancestor ${current}`);
        current = row.createdBy;
      }
    }
    for (const ancestor of ancestors) {
      if ((counts.get(ancestor) ?? 0) >= quota.lineageAgents)
        throw new StoreError("QUOTA_EXCEEDED", `lineage agent quota exhausted at ${ancestor}`);
    }
  }

'''
write("src/lifecycle.ts", value.replace(quota_marker, quota_helper + quota_marker, 1))
replace_once(
    "src/lifecycle.ts",
    '''      outcome.claim = this.store.claimOperation({\n        id: opId,\n        actor: auth.actor,\n        requestKey: key,\n        requestHash: hash,\n        kind: "agent.create",\n        payloadJson: JSON.stringify(input),\n        planJson: JSON.stringify(physicalPlan),\n      });\n      if (outcome.claim === "retry") return;\n      this.store.insertAgent({''',
    '''      outcome.claim = this.store.claimOperation({\n        id: opId,\n        actor: auth.actor,\n        requestKey: key,\n        requestHash: hash,\n        kind: "agent.create",\n        payloadJson: JSON.stringify(input),\n        planJson: JSON.stringify(physicalPlan),\n      });\n      if (outcome.claim === "retry") return;\n      this.assertCreateQuota(auth.actor);\n      this.store.insertAgent({''',
)
replace_once(
    "src/lifecycle.ts",
    '''    const plans = await Promise.all(config.initialResidents.map(async (seed) => {''',
    '''    if (this.agentQuota) {\n      if (config.initialResidents.length + 1 > this.agentQuota.societyAgents)\n        throw new StoreError("QUOTA_EXCEEDED", "bootstrap exceeds society agent quota");\n      if (config.initialResidents.length > this.agentQuota.lineageAgents)\n        throw new StoreError("QUOTA_EXCEEDED", "bootstrap exceeds Principal lineage quota");\n    }\n    const plans = await Promise.all(config.initialResidents.map(async (seed) => {''',
)
replace_once(
    "src/entry/broker.ts",
    '''  },\n  mail,\n);\nconst git = new GitModule(''',
    '''  },\n  mail,\n  cfg.quota,\n);\nconst git = new GitModule(''',
)

# ---------------------------------------------------------------------------
# git: all subprocesses bounded; persisted mail plan uses logical addresses;
# root protected path protects the entire repository.
# ---------------------------------------------------------------------------
replace_once(
    "src/git.ts",
    'import { spawnSync, type SpawnSyncReturns } from "node:child_process";',
    '''import {\n  spawnSync as nodeSpawnSync,\n  type SpawnSyncOptions,\n  type SpawnSyncOptionsWithStringEncoding,\n  type SpawnSyncReturns,\n} from "node:child_process";''',
)
replace_once(
    "src/git.ts",
    'import { MailModule, buildEml, expandAddresses, fsyncDir, defaultReplyTo, actorAddress, listAddress } from "./mail.js";',
    'import { MailModule, buildEml, expandAddresses, fsyncDir, defaultReplyTo, defaultLogicalReplyTo, actorAddress, listAddress } from "./mail.js";',
)
git_marker = '''function git(dir: string, args: string[]): SpawnSyncReturns<string> {'''
value = text("src/git.ts")
if value.count(git_marker) != 1:
    raise SystemExit("src/git.ts: spawn wrapper insertion marker mismatch")
git_wrapper = r'''function checkedSpawn<T extends string | Buffer>(
  result: SpawnSyncReturns<T>,
  operation: string,
): SpawnSyncReturns<T> {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT")
      throw new StoreError("DEADLINE_EXCEEDED", `${operation} timed out`);
    if (code === "ENOBUFS")
      throw new StoreError("LIMIT_EXCEEDED", `${operation} output exceeded the bound`);
    throw new StoreError("INTERNAL_ERROR", `${operation} spawn failed: ${result.error.message}`);
  }
  return result;
}

function spawnSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
function spawnSync(
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
): SpawnSyncReturns<Buffer>;
function spawnSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
  const bounded: SpawnSyncOptions = {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    killSignal: "SIGKILL",
    ...options,
  };
  if (typeof bounded.encoding === "string" && bounded.encoding !== "buffer")
    return checkedSpawn(
      nodeSpawnSync(command, [...args], bounded as SpawnSyncOptionsWithStringEncoding),
      command,
    );
  return checkedSpawn(nodeSpawnSync(command, [...args], bounded), command);
}

'''
write("src/git.ts", value.replace(git_marker, git_wrapper + git_marker, 1))
replace_once(
    "src/git.ts",
    '''        to: [...route.displayTo],\n        recipients: route.recipients,''',
    '''        to: [...new Set(targetAddresses)].sort(),\n        recipients: route.recipients,''',
)
replace_once(
    "src/git.ts",
    '''        replyHeaders: { replyTo: defaultReplyTo(actorAddress(auth.actor, this.paths.society), route.displayTo), inReplyTo: null, references: [] },''',
    '''        replyHeaders: { replyTo: defaultLogicalReplyTo(auth.actor, targetAddresses), inReplyTo: null, references: [] },''',
)
replace_once(
    "src/git.ts",
    '''        to: [listAddress("residents", this.paths.society)],\n        recipients: [] as Actor[],''',
    '''        to: ["residents" as Address],\n        recipients: [] as Actor[],''',
)
replace_once(
    "src/git.ts",
    '''        replyHeaders: { replyTo: [listAddress("residents", this.paths.society)], inReplyTo: null, references: [] },''',
    '''        replyHeaders: { replyTo: ["residents" as Address], inReplyTo: null, references: [] },''',
)
replace_all(
    "src/git.ts",
    'protectedPaths.some((pp) => pp.endsWith("/") ? name.startsWith(pp) : name === pp)',
    'protectedPaths.some((pp) => pp === "/" || (pp.endsWith("/") ? name.startsWith(pp) : name === pp))',
    minimum=1,
)
replace_all(
    "src/git.ts",
    'this.integration.protectedPaths.some((pp) => pp.endsWith("/") ? name.startsWith(pp) : name === pp)',
    'this.integration.protectedPaths.some((pp) => pp === "/" || (pp.endsWith("/") ? name.startsWith(pp) : name === pp))',
    minimum=1,
)
replace_once(
    "src/git.ts",
    '''    } catch {\n      /* keep minimal */\n    }''',
    '''    } catch {\n      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt result`);\n    }''',
)

# ---------------------------------------------------------------------------
# broker: stream descriptor preflight happens before raw allocation; invalid
# frames resume parsing; logs fail closed; operation.get validates result_json.
# ---------------------------------------------------------------------------
replace_once(
    "src/broker.ts",
    '''  checkObject,\n  checkOid,\n} from "./validate.js";''',
    '''  checkObject,\n  checkOid,\n  operationResultCheck,\n} from "./validate.js";''',
)
replace_once(
    "src/broker.ts",
    '''    this.serveFrames(sock, (raw, stream) =>\n      this.dispatch(auth, raw as Request, stream ?? null),\n    );''',
    '''    this.serveFrames(\n      sock,\n      (raw, stream) => this.dispatch(auth, raw as Request, stream ?? null),\n      (raw) => this.preflightPublicStream(auth, raw),\n    );''',
)
replace_once(
    "src/broker.ts",
    '''    handle: (\n      raw: Record<string, unknown>,\n      stream: AsyncIterable<Uint8Array> | null,\n    ) => Promise<unknown> | unknown,\n  ): void {''',
    '''    handle: (\n      raw: Record<string, unknown>,\n      stream: AsyncIterable<Uint8Array> | null,\n    ) => Promise<unknown> | unknown,\n    preflightStream?: (raw: Record<string, unknown>) => object | null,\n  ): void {''',
)
replace_once(
    "src/broker.ts",
    '''          );\n          continue;\n        }\n        if (ev.kind === "stream") {''',
    '''          );\n          // The decoder intentionally drains one frame at a time. An invalid\n          // frame has no handler completion to resume us, so explicitly parse\n          // the already-buffered next frame instead of stalling the connection.\n          events.push(...dec.resumeParsing());\n          continue;\n        }\n        if (ev.kind === "stream") {''',
)
replace_once(
    "src/broker.ts",
    '''        if (wantsStream && desc && typeof desc.bytes === "number") {\n          if (''',
    '''        if (wantsStream && desc && typeof desc.bytes === "number") {\n          const rejected = preflightStream?.(raw) ?? null;\n          if (rejected) {\n            write(rejected);\n            events.push(...dec.resumeParsing());\n            continue;\n          }\n          if (''',
)
preflight_marker = '''  async dispatch(\n    auth: AuthContext,'''
value = text("src/broker.ts")
if value.count(preflight_marker) != 1:
    raise SystemExit("src/broker.ts: preflight insertion marker mismatch")
preflight = r'''  private preflightPublicStream(
    auth: AuthContext,
    envelope: Record<string, unknown>,
  ): object | null {
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    if (method !== "git.submit" && method !== "context.publish") return null;
    if (
      envelope.v !== 1 ||
      typeof envelope.id !== "string" ||
      typeof envelope.method !== "string" ||
      !Object.keys(envelope).every((key) => ["v", "id", "method", "params", "request"].includes(key)) ||
      !isValidRequestKey(envelope.request)
    )
      return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: "invalid streamed request envelope", retry: "never" });
    const actor = this.store.getAgent(auth.actor);
    if (auth.channel === "actor" && (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled"))
      return Broker.errorAnswer(id, { code: "STALE_RUN", message: "actor incarnation is stale", retry: "never" });
    const need = METHOD_CAPABILITY[method as PublicMethod];
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need)))
      return Broker.errorAnswer(id, { code: "CAPABILITY_DENIED", message: `missing capability ${need}`, retry: "never" });
    if (!this.checkParams(method, envelope.params))
      return Broker.errorAnswer(id, { code: "INVALID_REQUEST", message: `invalid params for ${method}`, retry: "never" });
    return null;
  }

'''
write("src/broker.ts", value.replace(preflight_marker, preflight + preflight_marker, 1))
replace_once(
    "src/broker.ts",
    '''            { encoding: "utf8", maxBuffer: this.limits.logBytes },\n          );\n          const text = (r.stdout ?? "").slice(0, this.limits.logBytes);\n          return Broker.okAnswer(id, {\n            text,\n            truncated: (r.stdout ?? "").length > text.length,\n            observedAtMs: Date.now(),\n          });''',
    '''            {\n              encoding: "utf8",\n              maxBuffer: this.limits.logBytes,\n              timeout: 30_000,\n              killSignal: "SIGKILL",\n            },\n          );\n          if (r.error) {\n            const code = (r.error as NodeJS.ErrnoException).code;\n            throw new StoreError(\n              code === "ENOBUFS" ? "LIMIT_EXCEEDED" : code === "ETIMEDOUT" ? "DEADLINE_EXCEEDED" : "INTERNAL_ERROR",\n              `journalctl failed: ${r.error.message}`,\n            );\n          }\n          if (r.signal || r.status !== 0)\n            throw new StoreError("INTERNAL_ERROR", `journalctl exited unsuccessfully: ${String(r.stderr ?? "").slice(0, 300)}`);\n          return Broker.okAnswer(id, {\n            text: r.stdout ?? "",\n            truncated: false,\n            observedAtMs: Date.now(),\n          });''',
)
replace_once(
    "src/broker.ts",
    '''function receiptOfRow(op: {\n  id: string;\n  state: string;\n  resultJson: string | null;\n  errorCode: string | null;\n}): Receipt {''',
    '''function receiptOfRow(op: {\n  id: string;\n  kind: string;\n  state: string;\n  resultJson: string | null;\n  errorCode: string | null;\n}): Receipt {''',
)
replace_once(
    "src/broker.ts",
    '''  if (op.resultJson) {\n    try {\n      rec.result = JSON.parse(op.resultJson);\n    } catch {\n      /* corrupt result; receipt stays minimal */\n    }\n  }\n  if (op.errorCode) {''',
    '''  if (op.state === "succeeded") {\n    if (!op.resultJson)\n      throw new StoreError("STORE_CORRUPT", `succeeded operation ${op.id} has no result`);\n    let result: unknown;\n    try { result = JSON.parse(op.resultJson); } catch {\n      throw new StoreError("STORE_CORRUPT", `operation ${op.id} has corrupt result JSON`);\n    }\n    const invalid = operationResultCheck(op.kind)(result);\n    if (invalid)\n      throw new StoreError("STORE_CORRUPT", `operation ${op.id} result: ${invalid}`);\n    rec.result = result as Exclude<Receipt["result"], undefined>;\n  } else if (op.resultJson !== null) {\n    throw new StoreError("STORE_CORRUPT", `non-success operation ${op.id} has a result`);\n  }\n  if (op.state === "failed" && !op.errorCode)\n    throw new StoreError("STORE_CORRUPT", `failed operation ${op.id} has no error code`);\n  if (op.errorCode && op.state !== "failed")\n    throw new StoreError("STORE_CORRUPT", `non-failed operation ${op.id} has an error code`);\n  if (op.errorCode) {''',
)

# ---------------------------------------------------------------------------
# pi extension: broker-owned batch view is a closed runtime-validated DTO.
# S-03 Pi event schemas remain gated; do not guess them here.
# ---------------------------------------------------------------------------
replace_once(
    "src/pi-extension.ts",
    '''function readBatchView(batchId: string): BatchView | null {\n  try {\n    // /run/oma-view is the runner's RO-mounted public view dir (FS-002).\n    const raw = readFileSync(`/run/oma-view/batch-${batchId}.json`, "utf8");\n    const v = JSON.parse(raw) as BatchView;\n    if (\n      typeof v.id !== "string" ||\n      typeof v.notice !== "string" ||\n      !Array.isArray(v.messageIds)\n    )\n      return null;\n    return v;\n  } catch {\n    return null;\n  }\n}''',
    '''export function readBatchView(batchId: string, viewDir = "/run/oma-view"): BatchView | null {\n  try {\n    const raw = readFileSync(`${viewDir}/batch-${batchId}.json`, "utf8");\n    const parsed: unknown = JSON.parse(raw);\n    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;\n    const v = parsed as Record<string, unknown>;\n    const allowed = ["id", "agent", "incarnation", "deliveryMode", "notice", "messageIds"];\n    if (\n      !Object.keys(v).every((key) => allowed.includes(key)) ||\n      Object.keys(v).length !== allowed.length ||\n      v.id !== batchId ||\n      typeof v.agent !== "string" ||\n      !/^[a-z][a-z0-9-]{0,31}$/.test(v.agent) ||\n      !Number.isSafeInteger(v.incarnation) ||\n      (v.incarnation as number) < 0 ||\n      (v.deliveryMode !== "steer" && v.deliveryMode !== "followUp") ||\n      typeof v.notice !== "string" ||\n      !Array.isArray(v.messageIds) ||\n      v.messageIds.some((id) => typeof id !== "string" || !/^m-[0-9a-f-]{36}-\\d+$/.test(id)) ||\n      new Set(v.messageIds).size !== v.messageIds.length\n    )\n      return null;\n    return v as unknown as BatchView;\n  } catch {\n    return null;\n  }\n}''',
)

# ---------------------------------------------------------------------------
# spikes hygiene: make tiered S-08/S-10/S-11 discoverable without opening gates.
# Only SPIKE prose is added so compliance evidence is not falsely promoted.
# ---------------------------------------------------------------------------
replace_once(
    "implementation/spikes.md",
    '## S-08 — OPTIONAL formal approval policy',
    '## S-08 — base optional / tiered required attestation gate',
)
replace_once(
    "implementation/spikes.md",
    '''**MUST [SP-08-A]** 동일 actor 중복/자식 생성/다른 base/candidate/policy 재사용/자연어 위조/Human channel 위조를 거절해야 한다. 필요한 추가 entity는 architecture에 이미 허용된 attestation 범위만 사용한다. 결과가 없으면 기본 profile의 protected path 거절을 유지하고 approve/object/revoke를 노출하지 않는다.\n\n## S-09 — 성능 목표와 모델 사용성 수용 기준''',
    '''**MUST [SP-08-A]** 동일 actor 중복/자식 생성/다른 base/candidate/policy 재사용/자연어 위조/Human channel 위조를 거절해야 한다. 필요한 추가 entity는 architecture에 이미 허용된 attestation 범위만 사용한다. 결과가 없으면 기본 profile의 protected path 거절을 유지하고 approve/object/revoke를 노출하지 않는다.\n\nTiered profile에서 S-08은 `integration-policy.md`의 authenticated exact-candidate attestation 계약을 충족하기 전까지 OPEN이다. base에서 optional이라는 이유로 tiered에서 생략할 수 없다.\n\n## S-10 — tiered challenge + persistent floor\n\n**SPIKE [S-10]** canonical 범위와 성공 기준은 `integration-policy.md`의 challenge/floor 계약이다. authenticated challenge와 persistent floor의 DDL/migration/복구 의미가 검증되기 전에는 관련 mutation API나 durable state를 추측해 추가하지 않는다. 현재 상태는 OPEN이다.\n\n## S-11 — OPTIONAL fresh clean-room verifier\n\n**SPIKE [S-11]** canonical 범위와 성공 기준은 `integration-policy.md`의 fresh-context verifier 계약이다. 선택 기능이며, 활성화하려면 exact verifier input/output 및 격리 증거를 별도로 pin해야 한다. 현재 상태는 OPEN이다.\n\n## S-09 — 성능 목표와 모델 사용성 수용 기준''',
)

# ---------------------------------------------------------------------------
# Regression tests for the deterministic fixes above.
# ---------------------------------------------------------------------------
write(
    "test/adversarial-fixes.test.ts",
    r'''import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEml, MailModule } from "../src/mail.js";
import { messagePlanCheck } from "../src/validate.js";
import { Store, StoreError } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { readBatchView } from "../src/pi-extension.js";
import { generateMessageId, generateOperationId } from "../src/ids.js";
import type { AuthContext, HostConfigV1, MessagePlan } from "../implementation/contracts.js";

const oid = (c: string) => c.repeat(40);

function minimalConfig(): HostConfigV1 {
  const resources = {
    memoryBytes: 1, tasks: 1, cpuQuotaPercent: 1, tmpBytes: 1,
    workspaceBytes: 1, stagingBytes: 1, checkTimeoutSeconds: 1,
  };
  return {
    schemaVersion: 1,
    society: "demo",
    installation: { node: "/usr/bin/node", libdir: "/tmp/lib", rootfs: "/tmp/root", deploymentDigest: "d" },
    modelProfiles: {
      m: { provider: "p", model: "m", credentialRef: "c", codecRevision: "v1", pricingRevision: "p1", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 },
    },
    agentProfiles: {
      principal: { modelProfile: "m", capabilities: [], delegable: [], childProfile: null, resources },
    },
    principalProfile: "principal",
    initialResidents: [],
    quota: { societyAgents: 1, lineageAgents: 0, societyUnits: 0, lineageUnits: 0, principalReservedUnits: 0, inferenceSlots: 1, principalReservedSlots: 1, storageBytes: 1 },
    integration: { policyRevision: "p1", protectedPaths: ["/"], checks: [] },
    limits: { frameBytes: 1, mailBodyBytes: 1, subjectBytes: 1, addresses: 1, replyReferences: 1, contextFiles: 1, contextBytes: 1, bundleBytes: 1, logBytes: 1, batchMaxMessages: 1, idleStreamSeconds: 1, receiptWaitSeconds: 1 },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}

test("adversarial: serialized EML never rewrites collision strings in the body", async () => {
  const body = "first X-Oma-Kind: marker\nX-Oma-Context: marker";
  const eml = await buildEml({
    from: "alice@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [],
    subject: "collision", kind: "message", contextRevision: null, inReplyTo: null,
    references: [], messageId: "m-00000000-0000-4000-8000-000000000000-0@demo.oma.invalid", body,
  });
  const serializedBody = eml.text.split(/\r?\n\r?\n/, 2)[1] ?? "";
  assert.match(serializedBody, /X-Oma-Kind: marker/);
  assert.match(serializedBody, /X-Oma-Context: marker/);
});

test("adversarial: MessagePlan validator accepts only logical addresses", () => {
  const plan: MessagePlan = {
    id: "m-00000000-0000-4000-8000-000000000000-0", objectPath: "mail/objects/x.eml",
    sha256: "0".repeat(64), bytes: 1, dateMs: 1, to: ["commons"], recipients: ["alice"],
    kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["topic/dev"], inReplyTo: null, references: [] },
  };
  assert.equal(messagePlanCheck(plan), null);
  assert.notEqual(messagePlanCheck({ ...plan, to: ["commons@demo.oma.invalid"] }), null);
  assert.notEqual(messagePlanCheck({ ...plan, to: ["garbage-not-an-address!"] }), null);
  assert.notEqual(messagePlanCheck({ ...plan, replyHeaders: { ...plan.replyHeaders, replyTo: ["alice@demo.oma.invalid"] } }), null);
});

test("adversarial: freezeObject is immutable and collision-checked", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-freeze-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 8);
  const id = "m-00000000-0000-4000-8000-000000000000-0";
  try {
    mail.freezeObject(id, { text: "same" });
    mail.freezeObject(id, { text: "same" });
    assert.throws(() => mail.freezeObject(id, { text: "different" }), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.equal(readFileSync(mail.objectPath(id), "utf8"), "same");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: approval plan/header identity mismatch is STORE_CORRUPT", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-approval-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 8);
  const op = generateOperationId();
  const id = generateMessageId(op, 0);
  const actual = { repo: "project" as const, targetRef: "refs/heads/main" as const, expectedBase: oid("1"), candidate: oid("2"), policyRevision: "policy-A" };
  const planned = { ...actual, candidate: oid("3") };
  try {
    const eml = await buildEml({
      from: "alice@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: ["alice@demo.oma.invalid"],
      subject: "approval", kind: "approval_required", approvalFor: actual, contextRevision: null,
      inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body: "review",
    });
    mail.freezeObject(id, eml);
    const plan = {
      kind: "mail.send", message: {
        id, objectPath: `mail/objects/${id}.eml`, sha256: eml.sha256, bytes: eml.bytes, dateMs: 1,
        to: ["principal"], recipients: ["principal"], kind: "approval_required", approvalFor: planned,
        contextRevision: null, replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
      },
    };
    store.transaction(() => store.insertOperation({
      id: op, actor: "alice", requestKey: "k", requestHash: "h", kind: "mail.send",
      payloadJson: "{}", planJson: JSON.stringify(plan),
    }));
    await assert.rejects(mail.publishGated(op), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: terminal operation states cannot be rewritten", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-terminal-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const op = generateOperationId();
  try {
    store.transaction(() => store.insertOperation({
      id: op, actor: "alice", requestKey: "k", requestHash: "h", kind: "route.follow",
      payloadJson: "{}", planJson: JSON.stringify({ kind: "route.follow", topic: "dev", agent: "alice" }),
    }));
    const result = JSON.stringify({ kind: "route.follow", topic: "dev", subscribed: true });
    store.transaction(() => store.setOperationSucceeded(op, result));
    assert.throws(() => store.transaction(() => store.setOperationUnknown(op)), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.throws(() => store.transaction(() => store.setOperationFailed(op, "INTERNAL_ERROR")), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.equal(store.getOperationById(op)?.state, "succeeded");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: config accepts protected root and rejects slot over-reserve", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-config-fix-"));
  const file = join(root, "config.json");
  try {
    const cfg = minimalConfig();
    writeFileSync(file, JSON.stringify(cfg));
    assert.deepEqual(loadConfig(file).integration.protectedPaths, ["/"]);
    writeFileSync(file, JSON.stringify({ ...cfg, quota: { ...cfg.quota, principalReservedSlots: 2 } }));
    assert.throws(() => loadConfig(file), /principalReservedSlots exceeds/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: create quota counts provisioning/retired descendants for every ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-agent-quota-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(() => {
      store.insertAgent({ name: "principal", specHash: "p", role: "principal", desired: "enabled", incarnation: 0, profile: "p", createdBy: null, specJson: "{}" });
      store.insertAgent({ name: "child", specHash: "c", role: "resident", desired: "retired", incarnation: 0, profile: "p", createdBy: "principal", specJson: "{}" });
    });
    const lifecycle = new LifecycleModule(
      store,
      null as unknown as ConstructorParameters<typeof LifecycleModule>[1],
      { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => false },
      () => null,
      null,
      { societyAgents: 10, lineageAgents: 1 },
    );
    const quotaCheck = lifecycle as unknown as { assertCreateQuota(parent: string): void };
    assert.throws(() => quotaCheck.assertCreateQuota("principal"), (error: unknown) => error instanceof StoreError && error.code === "QUOTA_EXCEEDED");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adversarial: Pi batch view rejects unknown/malformed trusted-view fields", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-batch-view-"));
  const id = "b-00000000-0000-4000-8000-000000000000";
  try {
    mkdirSync(root, { recursive: true });
    const valid = { id, agent: "alice", incarnation: 1, deliveryMode: "followUp", notice: "mail", messageIds: ["m-00000000-0000-4000-8000-000000000000-0"] };
    writeFileSync(join(root, `batch-${id}.json`), JSON.stringify(valid));
    assert.deepEqual(readBatchView(id, root), valid);
    writeFileSync(join(root, `batch-${id}.json`), JSON.stringify({ ...valid, extra: true }));
    assert.equal(readBatchView(id, root), null);
    writeFileSync(join(root, `batch-${id}.json`), JSON.stringify({ ...valid, messageIds: [7] }));
    assert.equal(readBatchView(id, root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
''',
)

# Helper files are only a bootstrap mechanism; the resulting patch commit removes them.
(ROOT / "scripts/apply-adversarial-fixes.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/adversarial-fix.yml").unlink(missing_ok=True)
