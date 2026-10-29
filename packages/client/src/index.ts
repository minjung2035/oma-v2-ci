import { createHash } from "node:crypto";
import type { MutationMethod, PublicMethod, PublicMethods, Receipt } from "@oma/contracts";
import { currentContext, inContext, type ClientContext } from "./context.js";
import { ClientError, fail } from "./errors.js";
import { RequestService, type FreshBuild, type RequestOptions } from "./request-service.js";
import { runtime, type GrantProvider } from "./runtime.js";
import { frameBytes } from "./settings.js";
import { Transport } from "./transport.js";
export { ClientError } from "./errors.js";

/** P0: a complete answer is never refused for its size. Longer than this, the
 * tool result carries a marked head and the path the whole text was saved to;
 * what the caller asked for stays one read away instead of one error away. */
const PREVIEW_BYTES = 1024 * 1024;
const PAGE = 64 * 1024;
const fullOid = (value: unknown): value is string => runtime().fullOid(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function bodyText(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > frameBytes()) fail("file is larger than the request frame", 2);
  return bytes.toString("utf8").replace(/\r\n/g, "\n");
}
class DeferredReceipt extends ClientError {
  constructor(readonly publication: Receipt, readonly key: string) {
    super("candidate publication did not complete", runtime().receiptExit(publication) || 3, key, publication);
  }
}
export interface MergeOpenInput {
  tier: "LOW" | "MEDIUM" | "HIGH"; title: string; reason: string; candidate?: string; base?: string;
}
export interface ChallengeOpenInput {
  merge: string; tier: "LOW" | "HIGH"; title: string; reason: string;
  replacement?: { candidate: string; base: string };
}
export interface ReviewDiffInput {
  name: string; view?: "proposal" | "original"; path?: string; cursor?: number;
}
export interface ReviewResponseInput {
  name: string; action: "comment" | "approve" | "reject"; body: string; approval?: string;
}

export class Client {
  private readonly transport: Transport;
  private service: RequestService | undefined;
  private readonly context: ClientContext;
  constructor(context: ClientContext, grant: GrantProvider = () => null,
    private readonly prepare?: (signal?: AbortSignal) => Promise<void>) {
    this.context = { ...context, env: Object.freeze({ ...context.env }) };
    this.transport = new Transport(grant);
  }
  private requests(): RequestService {
    // The context's home is the request cache's root (the local caller's
    // is its agent-owned OMA_AGENT_HOME). A caller whose environment has no
    // HOME has no root; a shared /tmp guessed for it is not one.
    const home = this.context.env.HOME;
    if (home === undefined || home.length === 0)
      throw new ClientError("HOME is not set; the request cache has no root", 4);
    return this.service ??= new RequestService(runtime().cache(home, 2 * frameBytes()),
      (method, params, key, body) => this.transport.call(method, params, key, body));
  }
  private scope<T>(signal: AbortSignal | undefined, action: () => Promise<T>, request?: string): Promise<T> {
    return inContext({ ...this.context, signal }, async () => {
      try {
        await this.prepare?.(signal);
        if (signal?.aborted) throw new ClientError(`Outcome unknown: observation stopped before replying${request === undefined ? "" : `; observe oma_operation_status with key ${request}`}`, 3, request, undefined, false, "BROKER_UNAVAILABLE");
        return await action();
      } catch (error) {
        if (error instanceof ClientError) throw error;
        const failure = runtime().failure(error);
        throw new ClientError(JSON.stringify({ ...failure, ...(request === undefined ? {} : { request }) }),
          runtime().failureExit(failure), request, undefined, false, failure.code, failure);
      }
    });
  }
  requestReceipt(method: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, signal?: AbortSignal): Promise<Receipt> {
    return this.scope(signal, () => this.requests().requestReceipt(method, key, build, comparable), key);
  }
  async effect(method: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, signal?: AbortSignal, options: RequestOptions = {}): Promise<string> {
    return this.scope(signal, async () => {
      let receipt: Receipt;
      try { receipt = await this.requests().requestReceipt(method, key, build, comparable, options); }
      catch (error) {
        if (error instanceof DeferredReceipt) return this.present(error.publication, error.key, "candidate-publication");
        if (error instanceof ClientError && error.receipt !== undefined) {
          const receipt = error.receipt as Receipt, observedKey = key;
          const text = this.bounded(`${runtime().receiptText(receipt, observedKey, error.request === `${key}.submit` ? "candidate-publication" : undefined)}\n${error.message}; observe oma_operation_status with key ${observedKey}; preserve the same request key and frozen input`, observedKey);
          if (error.contradicted || runtime().receiptExit(receipt) !== 0)
            throw new ClientError(text, error.exitCode, observedKey, receipt, error.contradicted, error.code);
          return text;
        }
        if (error instanceof ClientError && error.request === undefined)
          throw new ClientError(error.failure === undefined ? `${error.message}; request ${key}` : JSON.stringify({ ...error.failure, request: key }),
            error.exitCode, key, undefined, false, error.code, error.failure);
        throw error;
      }
      return this.present(receipt, key);
    }, key);
  }
  private bounded(text: string, key?: string): string {
    return Buffer.byteLength(text) <= PREVIEW_BYTES ? text : this.preview(Buffer.from(text, "utf8"), key);
  }
  /** A marked head of an answer that does not fit one tool result: the
   * `[preview]` notice names the complete answer's size and the path it was
   * saved to, so the head can never be mistaken for the answer. A caller
   * with no usable home still gets the exact size and why it is not saved;
   * a receipt's durable record is untouched either way. */
  private preview(bytes: Buffer, key?: string): string {
    let cut = Math.min(bytes.length, PREVIEW_BYTES);
    while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
    const head = bytes.subarray(0, cut).toString("utf8");
    const home = this.context.env.HOME;
    let where: string;
    if (home !== undefined && home.length > 0) {
      try {
        where = `is at ${runtime().spoolOutput(home, bytes)}`;
      } catch (error) {
        where = `could not be saved (${error instanceof Error ? error.message : String(error)}); its head follows`;
      }
    } else {
      where = "could not be saved (no HOME); its head follows";
    }
    return `${head}\n[preview] the complete ${bytes.length}-byte answer ${where}${key === undefined ? "" : `; request ${key}`}`;
  }
  private present(receipt: Receipt, key: string, phase?: "candidate-publication"): string {
    const text = this.bounded(runtime().receiptText(receipt, key, phase), key);
    const code = runtime().receiptExit(receipt);
    if (code !== 0) throw new ClientError(text, code, key, receipt, false, receipt.error?.code);
    return text;
  }
  query<M extends Exclude<PublicMethod, MutationMethod>>(method: M, params: Record<string, unknown>, signal?: AbortSignal): Promise<PublicMethods[M]["result"]> {
    return this.scope(signal, async () => {
      if (runtime().mutation(method)) fail("mutation requires a frozen request", 2);
      const reply = (await this.transport.call(method, params))[0];
      if (!reply?.ok) throw new ClientError(reply === undefined ? "invalid broker response" : runtime().failureText(reply.error),
        reply === undefined ? 3 : runtime().failureExit(reply.error), undefined, undefined, false,
        reply?.ok === false ? reply.error.code : undefined, reply?.ok === false ? reply.error : undefined);
      return reply.result as PublicMethods[M]["result"];
    });
  }
  queryText(method: Exclude<PublicMethod, MutationMethod>, params: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const key = method === "operation.get" && typeof params.key === "string" ? params.key : undefined;
    return this.scope(signal, async () => {
      const value = await this.query(method, params, signal);
      return this.bounded(key === undefined ? JSON.stringify(value) : runtime().receiptText(value as Receipt, key), key);
    }, key);
  }
  sendMail(input: { to: string[]; subject: string; body: string; kind: string; replyFile?: string }, key: string, signal?: AbortSignal): Promise<string> {
    const { replyFile, ...direct } = input;
    return this.effect("mail.send", key, () => ({ method: "mail.send", params: { ...direct, body: bodyText(input.body),
      ...(replyFile === undefined ? {} : runtime().reply(replyFile, false)) } }),
      () => ({ to: input.to, subject: input.subject, kind: input.kind }), signal);
  }
  publishGoal(body: string, expected: string | null, subject: string, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("context.publish", key, () => {
      if (Buffer.byteLength(body, "utf8") > frameBytes()) fail("file is larger than the request frame", 2);
      const prepared = runtime().goal(body, expected);
      return { method: "context.publish", params: { expected, goalMail: { subject }, entries: prepared.entries,
        content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
    }, () => ({ expected, goalMail: { subject } }), signal);
  }
  publishContext(directory: string, expected: string | null, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("context.publish", key, () => {
      const prepared = runtime().context(directory);
      return { method: "context.publish", params: { expected, entries: prepared.entries,
        content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
    }, () => ({ expected }), signal);
  }
  createAgent(input: { name: string; from: string; brief: string }, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("agent.create", key, () => ({ method: "agent.create",
      params: { name: input.name, from: runtime().resolveOid(input.from), brief: bodyText(input.brief) } }),
      () => ({ name: input.name, ...(fullOid(input.from) ? { from: input.from } : {}) }), signal);
  }
  controlAgent(action: "start" | "stop", name: string, key: string, signal?: AbortSignal): Promise<string> {
    const method = action === "start" ? "agent.start" : "agent.stop", params = { agent: name };
    return this.effect(method, key, () => ({ method, params }), () => params, signal);
  }
  continueAgent(note: string, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("agent.continue", key, () => ({ method: "agent.continue", params: { note: bodyText(note) } }), () => ({ note }), signal);
  }
  subscribe(action: "follow" | "unfollow", topic: string, key: string, signal?: AbortSignal): Promise<string> {
    const method = action === "follow" ? "route.follow" : "route.unfollow", params = { topic };
    return this.effect(method, key, () => ({ method, params }), () => params, signal);
  }
  replyMail(input: { replyFile: string; body: string; to?: string[]; subject?: string; kind?: string }, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("mail.send", key, () => {
      const reply = runtime().reply(input.replyFile, input.subject === undefined);
      return { method: "mail.send", params: { to: input.to ?? [], subject: input.subject ?? reply.inheritedSubject!,
        body: bodyText(input.body), kind: input.kind ?? "message", replyToMessage: reply.replyToMessage } };
    }, () => ({ to: input.to ?? [], kind: input.kind ?? "message", ...(input.subject === undefined ? {} : { subject: input.subject }) }), signal);
  }
  approvalNotice(input: { subject: string; body: string; candidate: string; base: string; policyRevision: string; cc?: string[]; replyFile?: string },
    key: string, signal?: AbortSignal): Promise<string> {
    const params = { to: [...new Set(["principal", ...input.cc ?? []])], subject: input.subject, kind: "approval_required",
      approvalFor: { repo: "project", targetRef: "refs/heads/main", candidate: input.candidate,
        expectedBase: input.base, policyRevision: input.policyRevision } };
    return this.effect("mail.send", key, () => ({ method: "mail.send", params: { ...params, body: bodyText(input.body),
      ...(input.replyFile === undefined ? {} : runtime().reply(input.replyFile, false)) } }), () => params, signal);
  }
  publishCandidate(input: { candidate: string; subject: string; body: string; to?: string[]; paths?: string[] }, key: string, signal?: AbortSignal): Promise<string> {
    const explicit = () => ({ to: input.to ?? ["commons"], subject: input.subject, paths: input.paths ?? [],
      ...(fullOid(input.candidate) ? { candidate: input.candidate } : {}) });
    return this.effect("git.submit", key, async () => {
      const candidate = runtime().resolveOid(input.candidate);
      const known = await this.query("git.known", { candidate }, signal);
      const prepared = runtime().submit(candidate, key, known);
      const params: Record<string, unknown> = { ...explicit(), candidate, body: bodyText(input.body),
        exportRef: prepared.exportRef, prerequisites: prepared.prerequisites };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    }, explicit, signal);
  }
  /** Publish the candidate under `key`'s own frozen request, `${key}.submit`,
   * while every recovery text names `key` -- the request the caller actually
   * started. The two identities stay apart: the frozen request, its replay and
   * its `operation.get` lookups keep the `.submit` key; only what the model is
   * told to query again wears the parent's. */
  private async ensurePublished(candidate: string, key: string): Promise<void> {
    const known = await this.query("git.known", { candidate }, currentContext().signal);
    if (known.hasCandidate) return;
    const self = this.context.env.OMA_ACTOR ?? "commons";
    const submitKey = `${key}.submit`;
    const receipt = await this.requests().requestReceipt("git.submit", submitKey, () => {
      const prepared = runtime().submit(candidate, submitKey, known);
      const params: Record<string, unknown> = { candidate, exportRef: prepared.exportRef, prerequisites: prepared.prerequisites,
        to: [self], subject: `merge candidate ${candidate.slice(0, 12)}`,
        body: "Candidate for a merge request; review happens in the request thread.", paths: [] };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    }, () => ({ candidate, to: [self] }), { displayKey: key });
    if (receipt.state !== "succeeded") throw new DeferredReceipt(receipt, key);
  }
  async reviewDiff(input: ReviewDiffInput, signal?: AbortSignal): Promise<string> {
    const kind = input.name.startsWith("merge-") ? "merge" : "challenge";
    if (!Number.isSafeInteger(input.cursor ?? 0) || (input.cursor ?? 0) < 0) throw new ClientError("invalid cursor", 2);
    return this.scope(signal, async () => {
      const detail = await this.query("review.status", { name: input.name }, signal) as {
        identity?: { candidate?: string; expectedBase?: string; policyRevision?: string };
        target?: { name: string; identity?: { candidate?: string; expectedBase?: string; policyRevision?: string } };
      };
      const view = input.view ?? "proposal";
      const identity = view === "original" && kind === "challenge" ? detail.target?.identity : detail.identity;
      if (!fullOid(identity?.candidate) || !fullOid(identity.expectedBase)) throw new ClientError(`${kind} status carries no diff identity for ${input.name}`, 2);
      const repository = this.context.env.OMA_PROJECT_GIT;
      if (!repository) throw new ClientError("no canonical code repository was provided", 2);
      const bytes = Buffer.from(runtime().code(repository, { action: "merge-diff", revision: identity.candidate,
        base: identity.expectedBase, ...(input.path === undefined ? {} : { path: input.path }) }).text);
      const cursor = input.cursor ?? 0;
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= Math.max(bytes.length, 1) || (cursor < bytes.length && (bytes[cursor]! & 0xc0) === 0x80))
        throw new ClientError(`cursor is not at a page boundary: ${cursor}`, 2);
      let cut = Math.min(bytes.length, cursor + PAGE);
      while (cut < bytes.length && cut > cursor && (bytes[cut]! & 0xc0) === 0x80) cut--;
      return this.bounded(JSON.stringify({ name: input.name, sourceRequest: view === "original" && kind === "challenge" ? detail.target?.name : input.name,
        view, base: identity.expectedBase, candidate: identity.candidate,
        policyRevision: identity.policyRevision ?? null, sha256: sha256(bytes), bytes: bytes.length,
        cursor, next: cut < bytes.length ? cut : null, text: bytes.subarray(cursor, cut).toString("utf8") }));
    });
  }
  openMerge(input: MergeOpenInput, key: string, signal?: AbortSignal): Promise<string> {
    return this.openReview({ ...input, kind: "merge.open" }, key, signal);
  }
  openChallenge(input: ChallengeOpenInput, key: string, signal?: AbortSignal): Promise<string> {
    return this.openReview({ kind: "challenge.open", merge: input.merge, tier: input.tier, title: input.title,
      reason: input.reason, ...input.replacement }, key, signal);
  }
  private openReview(input: (MergeOpenInput & { kind: "merge.open" }) |
    (Omit<ChallengeOpenInput, "replacement"> & { kind: "challenge.open"; candidate?: string; base?: string }),
    key: string, signal?: AbortSignal): Promise<string> {
    const explicit = () => ({ kind: input.kind, tier: input.tier, title: input.title,
      ...(input.kind === "challenge.open" ? { merge: input.merge } : {}),
      ...(fullOid(input.candidate) ? { candidate: input.candidate } : {}), ...(fullOid(input.base) ? { base: input.base } : {}) });
    if (key.length > 89) throw new ClientError("request key is too long for its candidate publication request", 2, key);
    return this.effect("attest.record", key, () => {
      const pair = input.kind === "challenge.open" && input.candidate === undefined ? null : {
        candidate: runtime().resolveOid(input.candidate ?? "HEAD"),
        base: input.base === undefined ? runtime().recordedBase() : runtime().resolveOid(input.base),
      };
      if (pair !== null) {
        if (pair.base === null) throw new ClientError("no recorded base: fetch canonical main and build the candidate on it", 2, key);
        if (runtime().workspaceDirty()) process.stderr.write("oma: workspace has uncommitted changes that are not part of the candidate\n");
      }
      return { method: "attest.record", params: { ...explicit(), reason: bodyText(input.reason), ...pair } };
    }, explicit, signal, { beforeSend: async frozen => {
      const params = frozen.params as Record<string, unknown>;
      if (fullOid(params.candidate)) await this.ensurePublished(params.candidate, key);
    } });
  }
  respondReview(input: ReviewResponseInput, key: string, signal?: AbortSignal): Promise<string> {
    const params = { name: input.name, ...(input.action === "comment" ? { kind: "review" } : {
      kind: "vote", verdict: input.action, ...(input.approval === undefined ? {} : { approval: input.approval }) }) };
    return this.effect("attest.record", key, () => ({ method: "attest.record", params: { ...params, body: bodyText(input.body) } }), () => params, signal);
  }
  cancelReview(name: string, reason: string, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("attest.record", key, () => ({ method: "attest.record", params: { kind: "cancel", name, reason: bodyText(reason) } }),
      () => ({ kind: "cancel", name }), signal);
  }
}
