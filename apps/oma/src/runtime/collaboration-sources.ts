/** Source preparation for the existing Client/host freeze owners. No send, queue,
 * acceptance, publication, session write or source repair happens here. */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Json, ProtocolLimits } from "@oma/contracts";
import type { FreshBuild } from "@oma/client/request-service";
import { currentContext, inContext } from "@oma/client/context";
import { contextBytes, frameBytes } from "@oma/client/settings";
import { collaborationArguments, collaborationMutationMethod, collaborationInlineParameters } from "@oma/domain/collaboration-inputs";
import { COMMITTED_WORK_FALLBACK } from "@oma/domain/mail-values";
import { isValidFullOid, isValidMessageId } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { readBoundedWithin } from "@oma/tool-files";
import { prepareGoalEffects } from "./input-effects/goal.js";
import { resolveOid, recordedBase } from "./input-effects.js";
import { reviewInputProblem } from "@oma/domain/attestation";
import { collaborationTargetPath, collaborationReviewInput, collaborationSubmissionInput, collaborationSubmissionContext, decodeCollaborationProposalMetadata, type CollaborationProposalMetadata } from "@oma/domain/collaboration-review";
import { decodeCollaborationTarget, type CollaborationTarget } from "@oma/domain/collaboration-targets";

export interface CollaborationSourceScope {
  readonly role: "resident" | "principal";
  readonly actor?: string;
  readonly target?: (reference: string) => CollaborationTarget;
  readonly proposalMetadata?: (request: string) => CollaborationProposalMetadata;
  /** Caller resolves each local spelling once. Host validation supplies only
   * the exact submitted OIDs, never reopens the caller's repository. */
  readonly resolveRevision?: (revision: string, field: "candidate" | "base" | "from" | "attachment") => string;
  readonly recordedBase?: () => string | null;
  readonly society: string;
  readonly cwd: string;
  readonly recordRoot: string;
  /** Model-view roots and their independently supplied physical roots. */
  readonly roots: readonly { readonly view: string; readonly physical: string }[];
  readonly limits: Pick<ProtocolLimits, "frameBytes" | "mailBodyBytes" | "contextBytes" | "subjectBytes">;
  readonly goal: typeof prepareGoalEffects;
  /** Host composition supplies the canonical Mail reader, never a projection. */
  readonly reply?: (id: string) => { readonly id: string; readonly subject: string };
  /** Host validation consumes already frozen caller bytes, never opens the
   * model's path. Actual file I/O belongs only to the caller runtime. */
  readonly readFile?: (path: string, maximum: number) => string;
}
const object = (value: Json | undefined): value is { [key: string]: Json } => value !== null && typeof value === "object" && !Array.isArray(value);
function inside(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}
function sourceText(scope: CollaborationSourceScope, path: string, maximum: number): string {
  if (!path || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) || path.includes("\0"))
    throw new StoreError("INVALID_REQUEST", "SOURCE_UNREADABLE: expected a permitted local file, not a URL");
  const target = resolve(scope.cwd, path);
  const root = [...scope.roots].sort((a, b) => b.view.length - a.view.length).find(entry => inside(entry.view, target));
  if (!root) throw new StoreError("CAPABILITY_DENIED", "SOURCE_UNREADABLE: file is outside this role's permitted source roots");
  try {
    return scope.readFile ? scope.readFile(path, maximum) : decodeUtf8(readBoundedWithin(root.physical, relative(root.view, target), maximum));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new StoreError("INVALID_REQUEST", message.startsWith("SOURCE_CHANGED:") ? message : `SOURCE_UNREADABLE: ${message}`, { cause });
  }
}
/** Reference syntax grants no mail access. The host still verifies the accepted parent. */
export function collaborationMessageId(reference: string, recordRoot: string, society: string): string {
  if (isValidMessageId(reference)) return reference;
  const rfc = reference.startsWith("<") && reference.endsWith(">") ? reference.slice(1, -1) : reference;
  const suffix = `@${society}.oma.invalid`;
  if (rfc.endsWith(suffix) && isValidMessageId(rfc.slice(0, -suffix.length))) return rfc.slice(0, -suffix.length);
  const prefix = `${recordRoot.replace(/\/$/u, "")}/mail/messages/`;
  if (reference.startsWith(prefix) && reference.endsWith(".md")) {
    const id = reference.slice(prefix.length, -3);
    if (isValidMessageId(id)) return id;
  }
  throw new StoreError("INVALID_REQUEST", "replyTo must be a message identity or a permitted displayed message path");
}
function sourceRevision(scope: CollaborationSourceScope, value: unknown, field: "candidate" | "base" | "from" | "attachment", resolved: Map<string, string>): string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("-") || value.includes("\0") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value))
    throw new StoreError("INVALID_REQUEST", "SOURCE_UNREADABLE: expected a local committed revision, not an option, URL or empty source");
  if (isValidFullOid(value)) return value;
  const previous = resolved.get(value);
  if (previous !== undefined) return previous;
  if (!scope.resolveRevision) throw new StoreError("UNSUPPORTED_PROFILE", "local revision resolution requires its protected caller source driver");
  const oid = scope.resolveRevision(value, field);
  if (!isValidFullOid(oid)) throw new StoreError("INVALID_OID", "local revision did not resolve to a full commit OID");
  resolved.set(value, oid);
  return oid;
}
export function validateCollaborationSources(tool: string, raw: unknown, role: CollaborationSourceScope["role"]): void {
  const args = collaborationArguments(tool, raw);
  if (tool === "oma_send") collaborationMutationMethod(tool, args); // Includes @self presence restrictions before source reads.
  if (tool === "oma_send" && role === "principal" && Array.isArray(args.to) && args.to.includes("@self"))
    throw new StoreError("CAPABILITY_DENIED", "Principal messages cannot create Worker continuations");
  if (!["oma_send", "oma_spawn", "oma_goal", "oma_review", "oma_merge", "oma_challenge", "oma_follow", "oma_society"].includes(tool))
    throw new StoreError("UNSUPPORTED_PROFILE", "this action's exact-target/publication staging driver is not connected yet");
  if (tool === "oma_send" && role === "principal" && Array.isArray(args.attachments) && args.attachments.some(source =>
      !object(source) || !isValidFullOid(source.commit)))
    throw new StoreError("CAPABILITY_DENIED", "Principal attachments require already published full OIDs; local revision resolution is not permitted");
  if (["oma_spawn", "oma_merge", "oma_challenge"].includes(tool) && role !== "resident")
    throw new StoreError("CAPABILITY_DENIED", "committed submission and Worker creation sources belong to Workers");
  if (tool === "oma_goal" && (role !== "principal" || args.expectedRevision !== null && !isValidFullOid(args.expectedRevision)))
    throw new StoreError("INVALID_REQUEST", "GOAL requires the Principal and an exact full context OID or required null");
}
export function prepareCollaborationSources(tool: string, raw: unknown, scope: CollaborationSourceScope): FreshBuild {
  validateCollaborationSources(tool, raw, scope.role);
  const args = collaborationArguments(tool, raw);
  const attachments: { commit: string; objectFormat: "sha1" | "sha256" }[] = [], resolutions: string[] = [];
  if (tool === "oma_send" && Array.isArray(args.attachments)) {
    // Resolve each spelling once and retain one attachment per exact OID.
    const resolved = new Map<string, string>();
    const included = new Set<string>();
    for (const source of args.attachments) {
      if (!object(source)) throw new StoreError("INVALID_REQUEST", "invalid attachment source");
      const commit = sourceRevision(scope, source.commit, "attachment", resolved);
      resolutions.push(commit);
      if (!included.has(commit)) {
        attachments.push({ commit, objectFormat: commit.length === 40 ? "sha1" : "sha256" });
        included.add(commit);
      }
    }
    delete args.attachments; // The inline-only owner never stages publications.
  }
  const loadTarget = (reference: string): CollaborationTarget => {
    const address = collaborationTargetPath(reference, scope.recordRoot);
    const target = scope.target ? scope.target(reference) : decodeCollaborationTarget(
      Buffer.from(sourceText(scope, join(scope.recordRoot, address.relative), scope.limits.frameBytes), "utf8"), address.name);
    if (target.request !== address.request) throw new StoreError("INVALID_REQUEST", "target path names a different original request");
    return target;
  };
  if (tool === "oma_merge" || tool === "oma_challenge") {
    if (!scope.actor) throw new StoreError("INVALID_REQUEST", "submission requires its authenticated actor");
    const proposal = typeof args.proposal === "string" ? loadTarget(args.proposal) : undefined;
    const applied = tool === "oma_challenge" && typeof args.merge === "string" ? loadTarget(args.merge) : undefined;
    const metadata = proposal === undefined ? undefined : scope.proposalMetadata ? scope.proposalMetadata(proposal.request) :
      decodeCollaborationProposalMetadata(JSON.parse(sourceText(scope, join(scope.recordRoot, "reviews", proposal.request, "details.json"), scope.limits.frameBytes)));
    // Check actor/kind/revision-reference metadata before any local Git read.
    collaborationSubmissionContext(tool, args, scope.actor, scope.role, scope.limits.subjectBytes, proposal, applied, metadata);
    const field = tool === "oma_merge" ? "change" : "replacement", supplied = args[field];
    if (supplied !== undefined || tool === "oma_merge" && proposal === undefined) {
      const change = supplied === undefined ? { candidate: "HEAD" } : supplied;
      if (!object(change) || typeof change.candidate !== "string") throw new StoreError("INVALID_REQUEST", "invalid committed submission source");
      const resolved = new Map<string, string>();
      const candidate = sourceRevision(scope, change.candidate, "candidate", resolved);
      const requestedBase = change.base ?? (proposal?.kind === "proposal" ? proposal.source.base : scope.recordedBase?.());
      if (requestedBase === null || requestedBase === undefined)
        throw new StoreError("INVALID_REQUEST", "SOURCE_UNREADABLE: the recorded workspace base is unavailable; supply an explicit committed base");
      args[field] = { candidate, base: sourceRevision(scope, requestedBase, "base", resolved) };
    }
    const input = collaborationSubmissionInput(tool, args, scope.actor, scope.role, scope.limits.subjectBytes, proposal, applied, metadata);
    if (typeof args.reason !== "string") throw new StoreError("INVALID_REQUEST", "a nonblank reason is required");
    const problem = reviewInputProblem(input.kind === "collaboration.existing" ? {
      kind: "review.retry", name: input.target.requestName, expectedRevision: input.target.revision,
      expectedAttempt: input.target.expectedAttempt, reason: args.reason,
    } : input, scope.limits);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    return { method: "attest.record", params: { ...input } };
  }
  if (tool === "oma_review") {
    if (typeof args.target !== "string" || !scope.actor) throw new StoreError("INVALID_REQUEST", "exact review requires its original target and authenticated actor");
    const target = loadTarget(args.target);
    const input = collaborationReviewInput(args, target, scope.actor, scope.role), problem = reviewInputProblem(input, scope.limits);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    return { method: "attest.record", params: { ...input } };
  }
  if (tool === "oma_spawn") args.from = sourceRevision(scope, args.from, "from", new Map());
  const field = tool === "oma_spawn" ? "brief" : tool === "oma_send" || tool === "oma_goal" ? "content" : null;
  if (field !== null) {
    const content = args[field];
    if (!object(content) || typeof content.value !== "string") throw new StoreError("INVALID_REQUEST", "invalid closed Content");
    const maximum = tool === "oma_goal" ? scope.limits.contextBytes : scope.limits.mailBodyBytes;
    const body = content.kind === "file" ? sourceText(scope, content.value, maximum) : content.value;
    if (Buffer.byteLength(body, "utf8") > maximum) throw new StoreError("LIMIT_EXCEEDED", "Content exceeds its effective byte bound; no truncation");
    args[field] = { kind: "text", value: body };
  }
  if (tool === "oma_goal") {
    const content = args.content;
    if (!object(content) || typeof content.value !== "string" || content.value.trim().length === 0)
      throw new StoreError("INVALID_REQUEST", "GOAL must not be blank");
    const expected = args.expectedRevision;
    if (expected !== null && typeof expected !== "string") throw new StoreError("INVALID_REQUEST", "invalid required GOAL revision");
    const prepared = scope.goal(content.value, expected);
    return { method: "context.publish", params: { expected, goalMail: { subject: "GOAL updated" }, entries: prepared.entries,
      content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
  }
  let reply: { readonly id: string; readonly subject: string } | undefined;
  if (tool === "oma_send" && typeof args.replyTo === "string") {
    const id = collaborationMessageId(args.replyTo, scope.recordRoot, scope.society);
    if (scope.reply) reply = scope.reply(id);
    else {
      // This is only a request-building observation. Host preparation independently
      // compares it to the canonical Mail owner before the first protected freeze.
      const metadata: unknown = JSON.parse(sourceText(scope, join(scope.recordRoot, "mail", "metadata", `${id}.json`), scope.limits.frameBytes));
      if (!metadata || typeof metadata !== "object" || !("version" in metadata) || metadata.version !== "collaboration-v1" ||
          !("message" in metadata) || metadata.message !== id || !("subject" in metadata) || typeof metadata.subject !== "string")
        throw new StoreError("INVALID_REQUEST", "SOURCE_UNREADABLE: reply metadata is inconsistent");
      reply = { id, subject: metadata.subject };
    }
    if (reply.id !== id) throw new StoreError("STORE_CORRUPT", "reply observation changed its original message identity");
    if (!Object.hasOwn(args, "subject")) args.subject = reply.subject;
    delete args.replyTo;
  }
  const prepared = collaborationInlineParameters(tool, args, { society: scope.society, role: scope.role, subjectBytes: scope.limits.subjectBytes });
  if (reply) prepared.params.replyToMessage = reply.id;
  if (prepared.method === "mail.send") {
    if (attachments.length > 0 && prepared.params.body === "") {
      if (!Object.hasOwn(args, "subject")) {
        const subject = collaborationInlineParameters(tool, { ...args, content: { kind: "text", value: COMMITTED_WORK_FALLBACK } },
          { society: scope.society, role: scope.role, subjectBytes: scope.limits.subjectBytes }).params.subject;
        if (typeof subject !== "string") throw new StoreError("INTERNAL_ERROR", "derived attachment subject is unavailable");
        prepared.params.subject = subject;
      }
    }
    prepared.params.collaboration = { version: "collaboration-v1", resolutions, attachments };
  }
  return prepared;
}

/** Caller-side health observation only. No RPC, source preparation, refresh,
 * ACK, receipt checkpoint, process observation or raw health-body injection. */
export function callerCollaborationRecordNotice(root: string): string | null {
  const unavailable = `OMA could not observe current record health. Retained files are previous observations, not proof of absence. Record health: ${JSON.stringify(join(root, "health.md"))}`;
  try {
    if (currentContext().env.OMA_RECORD_ROOT !== root || !isAbsolute(root) || resolve(root) !== root || root === "/" || root.includes("\0")) return unavailable;
    const bytes = readBoundedWithin(root, "health.md", Math.min(16 * 1024, frameBytes()));
    const text = decodeUtf8(bytes), lines = text.split("\n"), states = lines.filter(line => line.startsWith("Refresh: "));
    if (!text.startsWith("# Collaboration records health\n") || states.length !== 1) return unavailable;
    if (states[0] === "Refresh: unavailable") return unavailable;
    // Read only this closed numeric observation, never inject health/source text.
    // Stable counts change the next-boundary notice when coverage deteriorates,
    // without appending a new notice merely because observation time advanced.
    const prefix = "Unavailable observations (families, review requests, diagnostic sources): ";
    const issues = lines.filter(line => line.startsWith(prefix));
    if (issues.length > 1) return unavailable;
    let detail = "";
    if (issues.length === 1) {
      const counts: unknown = JSON.parse(issues[0]!.slice(prefix.length));
      if (!Array.isArray(counts) || counts.length !== 3 || !counts.every(count =>
          typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && !Object.is(count, -0))) return unavailable;
      if (counts.some(count => count > 0)) detail = ` Collection failures: ${counts[0]} record families with unavailable observations; ${counts[1]} review requests with unavailable observations; ${counts[2]} unavailable diagnostic sources.`;
    }
    if (states[0] === "Refresh: partial")
      return `OMA record coverage is partial.${detail} Read ${JSON.stringify(join(root, "health.md"))} for permitted families, collection failures and separately timed observations. Missing records are not proof of absence. This notice grants no authority and does not refresh or acknowledge anything.`;
    return states[0] === "Refresh: complete" && detail === "" ? null : unavailable;
  } catch { return unavailable; }
}

/** Runtime side: the same ordinary-file roots the engine was launched with. */
export function prepareCallerCollaborationSources(tool: string, args: unknown, role: CollaborationSourceScope["role"]): FreshBuild {
  const context = currentContext(), env = context.env;
  const recordRoot = env.OMA_RECORD_ROOT, society = env.OMA_SOCIETY;
  if (!recordRoot || !society || !isAbsolute(recordRoot)) throw new StoreError("UNSUPPORTED_PROFILE", "host-bound collaboration source roots are unavailable");
  const roots = (role === "principal" ? [context.cwd, recordRoot] :
    [context.cwd, env.HOME, recordRoot, env.OMA_MAIL_ARCHIVE, env.OMA_WORKER_ARCHIVE, env.OMA_WORLD_ROOT])
    .filter((root): root is string => typeof root === "string" && isAbsolute(root)).map(root => ({ view: root, physical: root }));
  const subjectBytes = Number(env.OMA_SUBJECT_BYTES), mailBodyBytes = Number(env.OMA_BODY_BYTES);
  if (![subjectBytes, mailBodyBytes].every(value => Number.isSafeInteger(value) && value > 0))
    throw new StoreError("UNSUPPORTED_PROFILE", "effective collaboration source limits are unavailable");
  return prepareCollaborationSources(tool, args, { role, society, actor: env.OMA_ACTOR ?? "", cwd: context.cwd, recordRoot, roots,
    limits: { frameBytes: frameBytes(), contextBytes: contextBytes(), subjectBytes, mailBodyBytes },
    resolveRevision: revision => inContext(context, () => resolveOid(revision)),
    recordedBase: () => inContext(context, () => recordedBase()),
    goal: (body, expected) => inContext(context, () => prepareGoalEffects(body, expected)) });
}
