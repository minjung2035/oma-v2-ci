/** MAC-701 / MODE-006: the signed helper's Keychain channel, without a VM.
 * The engine owns this child until actual close; EOF only rejects requests. */
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { spawnSupervisedService, stopOwnedChild } from "../../process/async.js";
import type { KeychainStore } from "./keychain.js";
import { macBundleResources } from "./bundle.js";

const LINE_BYTES = 1024 * 1024;
type Pending = { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout };

/** P0-6: the helper channel is waited on only so long (NB-30). A wedged
 * helper that still holds the channel answers no request; close ends it. */
const REQUEST_DEADLINE_MS = 60_000;
const CLOSE_DEADLINE_MS = 30_000;
export interface KeychainDeadlines {
  readonly requestMs?: number;
  readonly closeMs?: number;
}

/** The credential API shared by VM-backed and Keychain-only clients. The
 * caller owns the channel's lifetime; this adapter owns only credential
 * response meaning and cannot send a VM operation. */
export function nativeKeychainStore(
  request: (op: "keychain.get" | "keychain.put", fields: Record<string, string>) => Promise<Record<string, unknown>>,
  invalidResponse: () => void = () => {},
): KeychainStore {
  return {
    async get(account) {
      const answer = await request("keychain.get", { account });
      if (answer.value !== undefined && typeof answer.value !== "string") {
        invalidResponse();
        throw new StoreError("BROKER_UNAVAILABLE", "the Keychain helper returned an invalid credential response");
      }
      return answer.value as string | undefined;
    },
    async put(account, value) { await request("keychain.put", { account, value }); },
  };
}

/** Resources may contain the installation; never search PATH or another bundle. */
export function bundledKeychainHelper(libdir: string): string {
  const resources = macBundleResources(libdir);
  return join(dirname(resources), "MacOS", "oma-vmhelper");
}

export class KeychainClient implements KeychainStore {
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private buffered = "";
  private ending = false;
  private readonly deadlines: Required<KeychainDeadlines>;
  private readonly store: KeychainStore;
  private constructor(private readonly channel: Socket, private readonly libdir: string, private readonly ended: Promise<void>,
    private readonly child: ChildProcess, deadlines?: KeychainDeadlines) {
    this.deadlines = { requestMs: deadlines?.requestMs ?? REQUEST_DEADLINE_MS, closeMs: deadlines?.closeMs ?? CLOSE_DEADLINE_MS };
    this.store = nativeKeychainStore((op, fields) => this.ask(op, fields), () => this.fail());
    child.once("close", () => { this.fail(); });
    child.on("error", () => { this.fail(); });
    child.stderr?.resume();
    channel.setEncoding("utf8");
    channel.on("data", (chunk: string) => { this.received(chunk); });
    channel.on("error", () => { this.fail(); });
    channel.once("end", () => { this.fail(); });
    channel.once("close", () => { this.fail(); });
  }

  static async launch(libdir: string, fence?: number, deadlines?: KeychainDeadlines): Promise<KeychainClient> {
    const child = spawnSupervisedService(bundledKeychainHelper(libdir), ["--keychain-only"], { PATH: "/usr/bin:/bin" }, true, fence);
    const ended = new Promise<void>(resolve => child.once("close", () => resolve()));
    try {
      const channel = child.stdio[3];
      if (channel === null || channel === undefined || !("write" in channel))
        throw new StoreError("UNSUPPORTED_PROFILE", "the Keychain helper has no control channel");
      return new KeychainClient(channel as Socket, libdir, ended, child, deadlines);
    } catch (error) {
      const errors = [error];
      try { stopOwnedChild(child); } catch (cleanup) { errors.push(cleanup); }
      // No client was handed off. Keep ownership, including its inherited fence,
      // until the child actually closes even when partial setup failed.
      await ended;
      if (errors.length > 1) throw new AggregateError(errors, "Keychain helper setup and cleanup failed");
      throw error;
    }
  }

  async withWriter<T>(fence: number, run: (writer: KeychainStore) => Promise<T>): Promise<T> {
    const writer = await KeychainClient.launch(this.libdir, fence, this.deadlines);
    try { return await run(writer); }
    finally { await writer.close(); }
  }

  private fail(): void {
    this.ending = true;
    this.channel.destroy();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new StoreError("BROKER_UNAVAILABLE", "the Keychain helper channel ended")); }
    this.pending.clear();
  }

  private received(chunk: string): void {
    this.buffered += chunk;
    for (let at = this.buffered.indexOf("\n"); at >= 0; at = this.buffered.indexOf("\n")) {
      const line = this.buffered.slice(0, at); this.buffered = this.buffered.slice(at + 1);
      if (Buffer.byteLength(line) > LINE_BYTES) { this.fail(); return; }
      let answer: Record<string, unknown>;
      try { answer = JSON.parse(line) as Record<string, unknown>; }
      catch { this.fail(); return; }
      if (!answer || typeof answer !== "object" || Array.isArray(answer) || !Number.isSafeInteger(answer.id) || typeof answer.ok !== "boolean") {
        this.fail(); return;
      }
      const item = this.pending.get(answer.id as number);
      if (item === undefined) { this.fail(); return; }
      this.pending.delete(answer.id as number);
      clearTimeout(item.timer);
      if (answer.ok) item.resolve(answer);
      else item.reject(new StoreError("BROKER_UNAVAILABLE", "the Keychain could not be accessed"));
    }
    if (Buffer.byteLength(this.buffered) > LINE_BYTES) this.fail();
  }

  private ask(op: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    if (this.ending || this.channel.destroyed) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "the Keychain helper channel ended"));
    const id = ++this.sequence;
    const line = `${JSON.stringify({ op, id, ...fields })}\n`;
    if (Buffer.byteLength(line) > LINE_BYTES)
      return Promise.reject(new StoreError("INVALID_REQUEST", "the credential exceeds the Keychain channel limit"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A wedged helper is unanswerable: the request ends, and a channel
        // that can no longer order answers ends with it (NB-30).
        this.pending.delete(id);
        this.fail();
        reject(new StoreError("BROKER_UNAVAILABLE", `the Keychain helper did not answer ${op} in time`));
      }, this.deadlines.requestMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.channel.write(line, error => { if (error) this.fail(); }); }
      catch { this.fail(); }
    });
  }

  async get(account: string): Promise<string | undefined> {
    return this.store.get(account);
  }
  async put(account: string, value: string): Promise<void> { await this.store.put(account, value); }
  async close(): Promise<void> {
    this.fail();
    // The helper exits on supervision EOF. Wait for that exit, not for EOF
    // itself -- and only so long: a wedged child is ended, never waited on
    // forever (NB-30). Ownership is kept until its actual close either way.
    const endedInTime = await Promise.race([this.ended.then(() => true as const),
      new Promise<false>(resolve => { const timer = setTimeout(() => resolve(false), this.deadlines.closeMs); timer.unref(); })]);
    if (endedInTime) return;
    try { stopOwnedChild(this.child); } catch { /* ending it was already tried */ }
    await this.ended;
  }
}
