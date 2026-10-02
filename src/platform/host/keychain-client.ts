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
type Pending = { resolve(value: Record<string, unknown>): void; reject(error: Error): void };

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
  private constructor(private readonly channel: Socket, private readonly libdir: string, private readonly ended: Promise<void>, child: ChildProcess) {
    child.once("close", () => { this.fail(); });
    child.on("error", () => { this.fail(); });
    child.stderr?.resume();
    channel.setEncoding("utf8");
    channel.on("data", (chunk: string) => { this.received(chunk); });
    channel.on("error", () => { this.fail(); });
    channel.once("end", () => { this.fail(); });
    channel.once("close", () => { this.fail(); });
  }

  static async launch(libdir: string, fence?: number): Promise<KeychainClient> {
    const child = spawnSupervisedService(bundledKeychainHelper(libdir), ["--keychain-only"], { PATH: "/usr/bin:/bin" }, true, fence);
    const ended = new Promise<void>(resolve => child.once("close", () => resolve()));
    try {
      const channel = child.stdio[3];
      if (channel === null || channel === undefined || !("write" in channel))
        throw new StoreError("UNSUPPORTED_PROFILE", "the Keychain helper has no control channel");
      return new KeychainClient(channel as Socket, libdir, ended, child);
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
    const writer = await KeychainClient.launch(this.libdir, fence);
    try { return await run(writer); }
    finally { await writer.close(); }
  }

  private fail(): void {
    this.ending = true;
    this.channel.destroy();
    for (const item of this.pending.values()) item.reject(new StoreError("BROKER_UNAVAILABLE", "the Keychain helper channel ended"));
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
      this.pending.set(id, { resolve, reject });
      try { this.channel.write(line, error => { if (error) this.fail(); }); }
      catch { this.fail(); }
    });
  }

  async get(account: string): Promise<string | undefined> {
    const answer = await this.ask("keychain.get", { account });
    if (answer.value !== undefined && typeof answer.value !== "string") {
      this.fail(); throw new StoreError("BROKER_UNAVAILABLE", "the Keychain helper returned an invalid credential response");
    }
    return answer.value as string | undefined;
  }
  async put(account: string, value: string): Promise<void> { await this.ask("keychain.put", { account, value }); }
  async close(): Promise<void> {
    this.fail();
    // The helper exits on supervision EOF. Wait for that exit, not for EOF itself.
    await this.ended;
  }
}
