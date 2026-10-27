/** NATIVE-005: the signed helper's Keychain-only channel.
 * The engine owns this child until actual close; EOF only rejects requests. */
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { isAbsolute, join, normalize } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { spawnSupervisedService, stopOwnedChild } from "@oma/process/async";
import type { KeychainStore } from "@oma/contracts/credentials";
import { NativeChannel } from "./native-channel.js";

/** P0-6: the helper channel is waited on only so long (NB-30). A wedged
 * helper that still holds the channel answers no request; close ends it. */
const REQUEST_DEADLINE_MS = 60_000;
const CLOSE_DEADLINE_MS = 30_000;
export interface KeychainDeadlines {
  readonly requestMs?: number;
  readonly closeMs?: number;
}

/** The credential API of the standalone Keychain helper. The
 * caller owns the channel's lifetime; this adapter owns only credential
 * response meaning. */
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
  if (!isAbsolute(libdir) || libdir === "/" || libdir.includes("\0") || normalize(libdir) !== libdir)
    throw new StoreError("UNSUPPORTED_PROFILE", "Keychain helper requires the exact normalized installation root");
  return join(libdir, "packages/platform-mac/dist/keychain/oma-keychain");
}

export class KeychainClient implements KeychainStore {
  private readonly requests: NativeChannel;
  private readonly deadlines: Required<KeychainDeadlines>;
  private readonly store: KeychainStore;
  private closing: Promise<void> | null = null;
  private constructor(private readonly channel: Socket, private readonly libdir: string, private readonly ended: Promise<void>,
    private readonly child: ChildProcess, deadlines?: KeychainDeadlines) {
    this.deadlines = { requestMs: deadlines?.requestMs ?? REQUEST_DEADLINE_MS, closeMs: deadlines?.closeMs ?? CLOSE_DEADLINE_MS };
    this.requests = new NativeChannel(channel, {
      endedMessage: "the Keychain helper channel ended",
      refusal: () => new StoreError("BROKER_UNAVAILABLE", "the Keychain could not be accessed"),
    });
    this.store = nativeKeychainStore((op, fields) => this.ask(op, fields), () => this.fail());
    child.once("close", () => { this.fail(); });
    child.on("error", () => { this.fail(); });
    child.stderr?.resume();
  }

  static async launch(libdir: string, fence?: number, deadlines?: KeychainDeadlines): Promise<KeychainClient> {
    const child = spawnSupervisedService(bundledKeychainHelper(libdir), [], { PATH: "/usr/bin:/bin" }, true, fence);
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

  private fail(): void { this.requests.close(); }

  private ask(op: "keychain.get" | "keychain.put", fields: Record<string, string>): Promise<Record<string, unknown>> {
    return this.requests.request(op, fields, this.deadlines.requestMs);
  }

  async get(account: string): Promise<string | undefined> {
    return this.store.get(account);
  }
  async put(account: string, value: string): Promise<void> { await this.store.put(account, value); }
  close(): Promise<void> {
    return this.closing ??= this.closeOwned();
  }

  private async closeOwned(): Promise<void> {
    this.fail();
    // The helper exits on supervision EOF. Wait for that exit, not for EOF
    // itself -- and only so long: a wedged child is ended, never waited on
    // forever (NB-30). Ownership is kept until its actual close either way.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let endedInTime: boolean;
    try {
      endedInTime = await Promise.race([this.ended.then(() => true as const),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), this.deadlines.closeMs); timer.unref(); })]);
    } finally { clearTimeout(timer); }
    if (endedInTime) return;
    try { stopOwnedChild(this.child); } catch { /* ending it was already tried */ }
    await this.ended;
  }
}
