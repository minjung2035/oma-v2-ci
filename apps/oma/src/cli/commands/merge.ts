/** mail-v1 review commands. `oma merge` works a merge request and
 * `oma challenge` a revert of an applied merge. Every mutation is an
 * attest.record fact under a stable request key; candidate/base revisions
 * resolve once, at freeze time, and a same-key replay answers the frozen
 * request instead of re-resolving HEAD or the base ref (CLI-001..003). */
import type { PublicMethods } from "@oma/contracts";
import { isValidFullOid, isValidMessageId } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { keyOf, parseArguments, splitSubcommand, type ParsedArguments } from "../arguments.js";
import { readBody, recordedBase, resolveOid, sha256Hex, workspaceDirty } from "../effects.js";
import { prepareSubmitEffects } from "../effects/submit.js";
import { readCode } from "../effects/code.js";
import { fail, finishFailure, finishRead, finishReceipt, usage } from "../exit.js";
import { effect, randKey, requestReceipt } from "../request-service.js";
import { call, cliBundleBytes } from "../transport.js";
import { decodeUtf8 } from "@oma/domain/utf8";


const REQUEST_KEY_MAX = 96;
const PAGE = 64 * 1024;

type RequestKind = "merge" | "challenge";
const UUID_TAIL = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const NAME_RE = {
  merge: new RegExp(`^merge-(?:[0-9a-f]{8}|${UUID_TAIL})$`),
  challenge: new RegExp(`^challenge-(?:[0-9a-f]{8}|${UUID_TAIL})$`),
} as const;
const noun = { merge: "merge request", challenge: "challenge" } as const;

function requestName(kind: RequestKind, parsed: ParsedArguments): string {
  const name = parsed.positional[0]!;
  if (!NAME_RE[kind].test(name)) fail(`a ${noun[kind]} name is ${kind}-<request id>`, 2);
  return name;
}

/** Merge open's submit key is `${K}.submit`: it too must be a request key. */
function openKey(parsed: ParsedArguments): string {
  const key = keyOf(parsed) ?? randKey();
  if (key.length > REQUEST_KEY_MAX - ".submit".length)
    fail(`--request key is too long for its submit request (${key.length} > ${REQUEST_KEY_MAX - 7} characters)`, 2);
  return key;
}

function dirtyWarn(): void {
  // Uncommitted work is never part of the resolved candidate; say so once.
  if (workspaceDirty())
    console.error("oma: workspace has uncommitted changes that are not part of the candidate");
}

/** Publish the candidate through the same preparation `oma submit` uses: the
 * broker-known check, the export ref and the bundle it uploads. A receipt that
 * is not yet a success is the command's answer, with the submit key. */
async function ensurePublished(candidate: string, key: string): Promise<void> {
  const submitKey = `${key}.submit`;
  const reply = (await call("git.known", { candidate }))[0];
  if (!reply?.ok) finishFailure(reply, "git.known: ", key);
  const known = reply.result as PublicMethods["git.known"]["result"];
  if (known.hasCandidate) return;
  const self = process.env.OMA_ACTOR ?? "commons";
  const receipt = await requestReceipt("git.submit", submitKey,
    () => {
      const prepared = prepareSubmitEffects(candidate, submitKey, known);
      const params: Record<string, unknown> = {
        candidate, exportRef: prepared.exportRef, prerequisites: prepared.prerequisites,
        to: [self], subject: `merge candidate ${candidate.slice(0, 12)}`,
        body: "Candidate for a merge request; review happens in the request thread.",
        paths: [],
      };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256Hex(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    },
    () => isValidFullOid(candidate) ? { candidate, to: [self] } : { to: [self] },
    { recoveryKey: key });
  if (receipt.state !== "succeeded") {
    console.error(`oma: Candidate publication for --request ${key} is ${receipt.state}; the open was not sent`);
    finishReceipt(receipt, key);
  }
}

/** Only explicitly written full-OID arguments compare on replay: a resolved
 * HEAD or origin/main is the frozen request's, not this invocation's. */
function explicitOids(parsed: ParsedArguments, names: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const name of names) {
    const value = parsed.value(name);
    if (value !== null && isValidFullOid(value)) fields[name.slice(2)] = value;
  }
  return fields;
}

async function openMerge(parsed: ParsedArguments): Promise<never> {
  const tier = parsed.value("--tier");
  if (tier !== "LOW" && tier !== "MEDIUM" && tier !== "HIGH") fail("--tier must be LOW, MEDIUM or HIGH", 2);
  const title = parsed.value("--title");
  if (title === null || title.length === 0) fail("merge open requires --title", 2);
  const file = parsed.value("--file");
  if (file === null) fail("merge open requires --file <reason>", 2);
  const key = openKey(parsed);
  return effect("attest.record", key,
    // Resolution happens only when nothing is frozen: a replay answers the
    // recorded request without the workspace's current HEAD or origin/main.
    async () => {
      const candidate = resolveOid(parsed.value("--candidate") ?? "HEAD");
      const base = parsed.value("--base") === null
        ? (recordedBase() ?? fail("no recorded base: run `git fetch origin main` and build the candidate on it", 2))
        : resolveOid(parsed.value("--base")!);
      dirtyWarn();
      return { method: "attest.record",
        params: { kind: "merge.open", tier, title, reason: readBody(file), candidate, base } };
    },
    () => ({ kind: "merge.open", tier, title, ...explicitOids(parsed, ["--candidate", "--base"]) }),
    { beforeSend: frozen => ensurePublished((frozen.params as { candidate: string }).candidate, key) });
}

async function review(kind: RequestKind, parsed: ParsedArguments): Promise<never> {
  const name = requestName(kind, parsed);
  const file = parsed.value("--file");
  if (file === null) fail(`${kind} review requires --file`, 2);
  return effect("attest.record", keyOf(parsed) ?? randKey(),
    () => ({ method: "attest.record", params: { kind: "review", name, body: readBody(file) } }),
    () => ({ kind: "review", name }));
}

async function vote(kind: RequestKind, parsed: ParsedArguments): Promise<never> {
  const name = requestName(kind, parsed);
  const verdict = parsed.value("--verdict");
  if (verdict !== "approve" && verdict !== "reject") fail("--verdict must be approve or reject", 2);
  const file = parsed.value("--file");
  if (file === null) fail(`${kind} vote requires --file`, 2);
  const approval = parsed.value("--approval");
  if (approval !== null && !isValidMessageId(approval)) fail("--approval names a message id", 2);
  return effect("attest.record", keyOf(parsed) ?? randKey(),
    () => ({ method: "attest.record",
      params: { kind: "vote", name, verdict, body: readBody(file),
        ...(approval === null ? {} : { approval }) } }),
    () => ({ kind: "vote", name, verdict, ...(approval === null ? {} : { approval }) }));
}

async function cancel(kind: RequestKind, parsed: ParsedArguments): Promise<never> {
  const name = requestName(kind, parsed);
  const file = parsed.value("--file");
  if (file === null) fail(`${kind} cancel requires --file`, 2);
  return effect("attest.record", keyOf(parsed) ?? randKey(),
    () => ({ method: "attest.record", params: { kind: "cancel", name, reason: readBody(file) } }),
    () => ({ kind: "cancel", name }));
}

async function status(kind: RequestKind, parsed: ParsedArguments): Promise<never> {
  const name = parsed.positional.length === 0 ? null : requestName(kind, parsed);
  const replies = await call("review.status", name === null ? {} : { name }).catch(() => fail("broker unreachable", 3));
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, `${kind} status: `);
  return finishRead(reply.result);
}

/** One `PAGE`-sized window ending on a UTF-8 boundary. */
function pageWindow(bytes: Buffer, cursor: number): { cut: number } {
  const end = Math.min(bytes.length, cursor + PAGE);
  if (end === bytes.length) return { cut: end };
  let cut = end;
  while (cut > cursor && (bytes[cut]! & 0xc0) === 0x80) cut--;
  return { cut: cut === cursor ? end : cut };
}

async function diff(kind: RequestKind, parsed: ParsedArguments): Promise<never> {
  const name = requestName(kind, parsed);
  const path = parsed.value("--path");
  const cursorText = parsed.value("--cursor");
  const view = kind === "challenge" ? (parsed.value("--view") ?? "revert") : "merge";
  if (view !== "merge" && view !== "revert" && view !== "original") fail("--view must be revert or original", 2);
  if (cursorText !== null && !/^\d+$/.test(cursorText)) fail(`invalid cursor ${cursorText}`, 2);
  const replies = await call("review.status", { name }).catch(() => fail("broker unreachable", 3));
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, `${kind} diff: `);
  const detail = reply.result as { identity?: { expectedBase?: string; candidate?: string; policyRevision?: string };
    target?: { identity?: { expectedBase?: string; candidate?: string; policyRevision?: string } } };
  const identity = view === "original" ? detail.target?.identity : detail.identity;
  if (identity === undefined || !isValidFullOid(identity.candidate) || !isValidFullOid(identity.expectedBase))
    fail(`${kind} status carries no diff identity for ${name}`, 2);
  const repository = process.env.OMA_PROJECT_GIT;
  if (!repository) fail("no canonical code repository was provided", 2);
  let text: string;
  try {
    text = readCode(repository, { action: "merge-diff", revision: identity.candidate!, base: identity.expectedBase!,
      ...(path === null ? {} : { path }) }).text;
  } catch (error) {
    if (error instanceof StoreError && error.code === "LIMIT_EXCEEDED")
      fail(`the diff exceeds the ${cliBundleBytes()}-byte bound; narrow it with --path`, 2);
    if (error instanceof StoreError) fail(error.message, 2);
    throw error;
  }
  const bytes = Buffer.from(text, "utf8");
  const cursor = cursorText === null ? 0 : Number(cursorText);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= Math.max(bytes.length, 1) ||
      (cursor < bytes.length && (bytes[cursor]! & 0xc0) === 0x80))
    fail(`cursor is not at a page boundary: ${cursorText}`, 2);
  const { cut } = pageWindow(bytes, cursor);
  return finishRead({
    name, view, base: identity.expectedBase!, candidate: identity.candidate!,
    policyRevision: identity.policyRevision ?? null,
    sha256: sha256Hex(bytes), bytes: bytes.length,
    cursor, next: cut < bytes.length ? cut : null,
    text: decodeUtf8(bytes.subarray(cursor, cut)),
  });
}

const OPEN_SPEC = { options: { "--tier": "value", "--title": "value", "--file": "value",
  "--candidate": "value", "--base": "value", "--request": "value" }, positional: { min: 0, max: 0 } } as const;
const BODY_SPEC = { options: { "--file": "value", "--request": "value" }, positional: { min: 1, max: 1 } } as const;
const VOTE_SPEC = { options: { "--verdict": "value", "--file": "value", "--approval": "value", "--request": "value" },
  positional: { min: 1, max: 1 } } as const;
const STATUS_SPEC = { options: {}, positional: { min: 0, max: 1 } } as const;

export async function runMergeCommand(args: string[]): Promise<never> {
  const { name: action, rest } = splitSubcommand(args, {
    ...OPEN_SPEC.options, ...VOTE_SPEC.options, "--merge": "value", "--view": "value", "--path": "value", "--cursor": "value",
  });
  switch (action) {
    case "open": return openMerge(parseArguments(rest, OPEN_SPEC));
    case "review": return review("merge", parseArguments(rest, BODY_SPEC));
    case "vote": return vote("merge", parseArguments(rest, VOTE_SPEC));
    case "cancel": return cancel("merge", parseArguments(rest, BODY_SPEC));
    case "status": return status("merge", parseArguments(rest, STATUS_SPEC));
    case "diff": return diff("merge", parseArguments(rest,
      { options: { "--path": "value", "--cursor": "value" }, positional: { min: 1, max: 1 } }));
    default: return usage();
  }
}

const CHALLENGE_OPEN_SPEC = { options: { "--merge": "value", "--tier": "value", "--title": "value",
  "--file": "value", "--candidate": "value", "--base": "value", "--request": "value" },
  positional: { min: 0, max: 0 } } as const;

async function openChallenge(parsed: ParsedArguments): Promise<never> {
  const merge = parsed.value("--merge");
  if (merge === null || !NAME_RE.merge.test(merge)) fail("--merge names a merge-<request id> request", 2);
  const tier = parsed.value("--tier");
  if (tier !== "LOW" && tier !== "HIGH") fail("--tier must be LOW or HIGH", 2);
  const title = parsed.value("--title");
  if (title === null || title.length === 0) fail("challenge open requires --title", 2);
  const file = parsed.value("--file");
  if (file === null) fail("challenge open requires --file <reason>", 2);
  const candidateArg = parsed.value("--candidate"), baseArg = parsed.value("--base");
  if ((candidateArg === null) !== (baseArg === null)) fail("--candidate and --base go together", 2);
  const key = openKey(parsed);
  return effect("attest.record", key,
    async () => {
      const pair = candidateArg === null ? null
        : { candidate: resolveOid(candidateArg), base: resolveOid(baseArg!) };
      if (pair !== null) dirtyWarn();
      return { method: "attest.record",
        params: { kind: "challenge.open", merge, tier, title, reason: readBody(file), ...pair } };
    },
    () => ({ kind: "challenge.open", merge, tier, title, ...explicitOids(parsed, ["--candidate", "--base"]) }),
    { beforeSend: async frozen => {
      const params = frozen.params as { candidate?: string };
      if (params.candidate !== undefined) await ensurePublished(params.candidate, key);
    } });
}

export async function runChallengeCommand(args: string[]): Promise<never> {
  const { name: action, rest } = splitSubcommand(args, {
    ...OPEN_SPEC.options, ...VOTE_SPEC.options, "--merge": "value", "--view": "value", "--path": "value", "--cursor": "value",
  });
  switch (action) {
    case "open": return openChallenge(parseArguments(rest, CHALLENGE_OPEN_SPEC));
    case "review": return review("challenge", parseArguments(rest, BODY_SPEC));
    case "vote": return vote("challenge", parseArguments(rest, VOTE_SPEC));
    case "cancel": return cancel("challenge", parseArguments(rest, BODY_SPEC));
    case "status": return status("challenge", parseArguments(rest, STATUS_SPEC));
    case "diff": return diff("challenge", parseArguments(rest,
      { options: { "--view": "value", "--path": "value", "--cursor": "value" }, positional: { min: 1, max: 1 } }));
    default: return usage();
  }
}
