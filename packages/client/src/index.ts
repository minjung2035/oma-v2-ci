import { createHash } from "node:crypto";
import type { MutationMethod, PublicMethod, PublicMethods, Receipt } from "@oma/contracts";
import { currentContext, inContext, type ClientContext } from "./context.js";
import { ClientError, fail } from "./errors.js";
import { RequestService, type FreshBuild } from "./request-service.js";
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
class DeferredReceipt extends Error {
  constructor(readonly receipt: Receipt, readonly key: string) { super("candidate publication did not complete"); }
}
export interface ReviewInput {
  action: "open" | "review" | "vote" | "cancel" | "status" | "diff";
  name?: string; tier?: string; title?: string; body?: string; reason?: string;
  candidate?: string; base?: string; merge?: string; verdict?: string; approval?: string;
  path?: string; cursor?: number; view?: "revert" | "original";
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
      await this.prepare?.(signal);
      if (signal?.aborted) throw new ClientError(`Outcome unknown: observation stopped before replying${request === undefined ? "" : `; --request ${request}`}`, 3, request, undefined, false, "BROKER_UNAVAILABLE");
      return action();
    });
  }
  requestReceipt(method: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, signal?: AbortSignal): Promise<Receipt> {
    return this.scope(signal, () => this.requests().requestReceipt(method, key, build, comparable), key);
  }
  async effect(method: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return this.scope(signal, async () => {
      try { return this.present(await this.requests().requestReceipt(method, key, build, comparable), key); }
      catch (error) {
        if (error instanceof DeferredReceipt) return this.present(error.receipt, error.key);
        if (error instanceof ClientError && error.receipt !== undefined) {
          const receipt = error.receipt as Receipt, observedKey = error.request ?? key;
          const text = this.bounded(`${runtime().receiptText(receipt, observedKey)}\noma: ${error.message} (Query again: use --request ${observedKey} with the same command; do not rerun with a new key)`, observedKey);
          if (error.contradicted || runtime().receiptExit(receipt) !== 0)
            throw new ClientError(text, error.exitCode, observedKey, receipt, error.contradicted);
          return text;
        }
        if (error instanceof ClientError && error.request === undefined)
          throw new ClientError(`${error.message}; --request ${key}`, error.exitCode, key, undefined, false, error.code);
        throw error;
      }
    }, key);
  }
  private bounded(text: string, key?: string): string {
    return Buffer.byteLength(text) <= PREVIEW_BYTES ? text : this.preview(Buffer.from(text, "utf8"), key);
  }
  /** A marked head of an answer that does not fit one tool result: the
   * `[preview]` notice names the complete answer's size and the path it was
   * saved to, so the head can never be mistaken for the answer. A caller
   * with no usable home still gets the exact size and why it is not saved;
   * a receipt's durable record is untouched either way (`--request` answers
   * the same text again). */
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
    return `${head}\noma: [preview] the complete ${bytes.length}-byte answer ${where}${key === undefined ? "" : `; --request ${key}`}`;
  }
  private present(receipt: Receipt, key: string): string {
    const text = this.bounded(runtime().receiptText(receipt, key), key);
    const code = runtime().receiptExit(receipt);
    if (code !== 0) throw new ClientError(`${text}\n--request ${key}`, code, key);
    return text;
  }
  query<M extends Exclude<PublicMethod, MutationMethod>>(method: M, params: Record<string, unknown>, signal?: AbortSignal): Promise<PublicMethods[M]["result"]> {
    return this.scope(signal, async () => {
      if (runtime().mutation(method)) fail("mutation requires a frozen request", 2);
      const reply = (await this.transport.call(method, params))[0];
      if (!reply?.ok) throw new ClientError(reply === undefined ? "invalid broker response" : runtime().failureText(reply.error),
        reply === undefined ? 3 : runtime().failureExit(reply.error));
      return reply.result as PublicMethods[M]["result"];
    });
  }
  async queryText(method: Exclude<PublicMethod, MutationMethod>, params: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return this.bounded(JSON.stringify(await this.query(method, params, signal)));
  }
  sendMail(input: { to: string[]; subject: string; body: string; kind: string; replyFile?: string }, key: string, signal?: AbortSignal): Promise<string> {
    const { replyFile, ...direct } = input;
    return this.effect("mail.send", key, () => ({ method: "mail.send", params: { ...direct, body: bodyText(input.body),
      ...(replyFile === undefined ? {} : runtime().reply(replyFile, false)) } }),
      () => ({ to: input.to, subject: input.subject, kind: input.kind }), signal);
  }
  sendGoal(file: string, expected: string | null, subject: string, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("context.publish", key, () => {
      const prepared = runtime().goal(file, expected);
      return { method: "context.publish", params: { expected, goalMail: { subject }, entries: prepared.entries,
        content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
    }, () => ({ expected, goalMail: { subject } }), signal);
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
  async review(kind: "merge" | "challenge", input: ReviewInput, key: string, signal?: AbortSignal): Promise<string> {
    if (input.action === "status") return this.queryText("review.status", input.name === undefined ? {} : { name: input.name }, signal);
    if (input.action === "diff" && (!Number.isSafeInteger(input.cursor ?? 0) || (input.cursor ?? 0) < 0))
      throw new ClientError("invalid cursor", 2);
    if (input.action === "diff") return this.scope(signal, async () => {
      const detail = await this.query("review.status", { name: input.name }, signal) as {
        identity?: { candidate?: string; expectedBase?: string; policyRevision?: string };
        target?: { identity?: { candidate?: string; expectedBase?: string; policyRevision?: string } };
      };
      const view = kind === "merge" ? "merge" : input.view ?? "revert";
      const identity = view === "original" ? detail.target?.identity : detail.identity;
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
      return this.bounded(JSON.stringify({ name: input.name, view, base: identity.expectedBase, candidate: identity.candidate,
        policyRevision: identity.policyRevision ?? null, sha256: sha256(bytes), bytes: bytes.length,
        cursor, next: cut < bytes.length ? cut : null, text: bytes.subarray(cursor, cut).toString("utf8") }));
    });
    const explicit = () => input.action === "open" ? { kind: `${kind}.open`, tier: input.tier, title: input.title,
      ...(kind === "challenge" ? { merge: input.merge } : {}),
      ...(fullOid(input.candidate) ? { candidate: input.candidate } : {}), ...(fullOid(input.base) ? { base: input.base } : {}) }
      : { kind: input.action, name: input.name, ...(input.action === "vote" ? { verdict: input.verdict,
        ...(input.approval === undefined ? {} : { approval: input.approval }) } : {}) };
    if (input.action === "open" && key.length > 89) throw new ClientError("--request key is too long for its submit request", 2, key);
    return this.effect("attest.record", key, async () => {
      let params: Record<string, unknown>;
      if (input.action === "open") {
        const pair = kind === "challenge" && input.candidate === undefined ? null : {
          candidate: runtime().resolveOid(input.candidate ?? "HEAD"),
          base: input.base === undefined ? runtime().recordedBase() : runtime().resolveOid(input.base),
        };
        if (pair !== null) {
          if (pair.base === null) throw new ClientError("no recorded base: run `git fetch origin main` and build the candidate on it", 2, key);
          if (runtime().workspaceDirty()) process.stderr.write("oma: workspace has uncommitted changes that are not part of the candidate\n");
          await this.ensurePublished(pair.candidate, key);
        }
        params = { kind: `${kind}.open`, tier: input.tier, title: input.title, reason: bodyText(input.reason ?? ""),
          ...(kind === "challenge" ? { merge: input.merge } : {}), ...pair };
      } else params = { ...explicit(), ...(input.action === "cancel" ? { reason: bodyText(input.reason ?? "") }
        : { body: bodyText(input.body ?? "") }) };
      return { method: "attest.record", params };
    }, explicit, signal);
  }
}
