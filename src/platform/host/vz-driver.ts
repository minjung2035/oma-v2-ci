/** The production `VmDriver` and `KeychainStore`: `oma-vmhelper`, the one
 * signed Swift binary that touches Virtualization.framework and the Keychain
 * (macos-platform §2.1, MAC-701).
 *
 * The helper is a supervised child of `omahostd` and speaks JSON lines on
 * descriptor 3, a socketpair only this process holds; when it closes, the
 * helper stops the VM and exits, so the VM never outlives `omahostd` (§9.3).
 * A guest port is reached the way vfkit's connect mode does it: the helper
 * listens on `<socketDir>/port-<n>.sock`, and each connection accepted there
 * becomes one vsock connection to guest port n.
 *
 *   → { op: "start", id, config }            ← { id, ok: true } | { id, ok: false, error }
 *   → { op: "forceStop", id }                ← { id, ok }
 *   → { op: "keychain.get", id, account }    ← { id, ok, value? }
 *   → { op: "keychain.put", id, account, value } ← { id, ok }
 *   ← { event: "stopped", cause: "guest" | "error", message? }
 *   ← { event: "sleep" } | { event: "wake" }
 */
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { StoreError } from "../../domain/errors.js";
import { spawnSupervisedService } from "../../process/async.js";
import type { VmDriver } from "./lifecycle.js";
import type { KeychainStore } from "./keychain.js";

export interface VmConfig {
  readonly kernel: string;
  readonly initrd: string;
  readonly cmdline: string;
  readonly disks: readonly { readonly path: string; readonly readOnly: boolean }[];
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly consoleLog: string;
  readonly ports: readonly number[];
}

export interface HelperCommand {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

type Pending = { resolve(value: Record<string, unknown>): void; reject(error: Error): void };
const LINE_BYTES = 1024 * 1024;

export class VzDriver implements VmDriver, KeychainStore {
  private readonly pending = new Map<number, Pending>();
  private readonly stopListeners: (() => void)[] = [];
  private readonly powerListeners: ((event: "sleep" | "wake") => void)[] = [];
  private sequence = 0;
  private buffered = "";

  private constructor(private readonly child: ChildProcess, private readonly channel: Socket,
    private readonly socketDir: string, private readonly config: VmConfig) {
    channel.setEncoding("utf8");
    channel.on("data", (chunk: string) => { this.received(chunk); });
    const gone = (): void => { this.helperGone(); };
    // A helper that dies resets its end; the close that follows says the rest.
    channel.on("error", () => { channel.destroy(); });
    channel.once("close", gone);
    child.once("exit", gone);
  }

  /** The helper runs for as long as `omahostd` does. */
  static launch(helper: HelperCommand, socketDir: string, config: VmConfig): VzDriver {
    const child = spawnSupervisedService(helper.executable, helper.argv, helper.env, true);
    const channel = child.stdio[3];
    if (channel === null || channel === undefined || !("write" in channel))
      throw new StoreError("UNSUPPORTED_PROFILE", "the VM helper has no control channel");
    return new VzDriver(child, channel as Socket, socketDir, config);
  }

  onStopped(listener: () => void): void { this.stopListeners.push(listener); }
  /** §9.1: the Mac is going to sleep, or has woken. */
  onPower(listener: (event: "sleep" | "wake") => void): void { this.powerListeners.push(listener); }

  private received(chunk: string): void {
    this.buffered += chunk;
    if (this.buffered.length > LINE_BYTES) { this.channel.destroy(); return; }
    for (let at = this.buffered.indexOf("\n"); at >= 0; at = this.buffered.indexOf("\n")) {
      const line = this.buffered.slice(0, at);
      this.buffered = this.buffered.slice(at + 1);
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; }
      catch { this.channel.destroy(); return; }
      if (message.event === "stopped") { for (const listener of this.stopListeners) listener(); continue; }
      if (message.event === "sleep" || message.event === "wake") { for (const listener of this.powerListeners) listener(message.event); continue; }
      const waiting = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (waiting === undefined) continue;
      this.pending.delete(message.id as number);
      if (message.ok === true) waiting.resolve(message);
      else waiting.reject(new StoreError("BROKER_UNAVAILABLE", typeof message.error === "string" ? message.error : "the VM helper refused"));
    }
  }

  private helperGone(): void {
    for (const waiting of this.pending.values()) waiting.reject(new StoreError("BROKER_UNAVAILABLE", "the VM helper ended"));
    this.pending.clear();
    // Whatever was running ran inside the helper.
    for (const listener of this.stopListeners.splice(0)) listener();
  }

  private ask(op: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      if (this.channel.destroyed) { reject(new StoreError("BROKER_UNAVAILABLE", "the VM helper ended")); return; }
      this.pending.set(id, { resolve, reject });
      this.channel.write(`${JSON.stringify({ op, id, ...fields })}\n`);
    });
  }

  async start(): Promise<void> { await this.ask("start", { config: { ...this.config, socketDir: this.socketDir } }); }
  async forceStop(): Promise<void> { await this.ask("forceStop"); }

  connect(port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect(join(this.socketDir, `port-${port}.sock`));
      socket.once("connect", () => { resolve(socket); });
      socket.once("error", reject);
    });
  }

  async get(account: string): Promise<string | undefined> {
    const answer = await this.ask("keychain.get", { account });
    return typeof answer.value === "string" ? answer.value : undefined;
  }
  async put(account: string, value: string): Promise<void> { await this.ask("keychain.put", { account, value }); }

  /** Ends the helper; the VM, if any, ends with it. */
  close(): void { this.channel.destroy(); this.child.kill("SIGTERM"); }
}
