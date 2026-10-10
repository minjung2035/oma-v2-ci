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
import type { Socket } from "node:net";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { connectSocket } from "../rpc.js";
import { StoreError } from "../../domain/errors.js";
import { spawnSupervisedService } from "../../process/async.js";
import type { VmDriver, VmStopCause } from "./lifecycle.js";
import type { KeychainStore } from "./keychain.js";
import { nativeKeychainStore } from "./keychain-client.js";
import { NativeChannel } from "./native-channel.js";

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

/** P0-6: no request of the helper waits forever. A wedged helper that still
 * holds the channel is ended by the deadlines its requests carry, not by the
 * next request's luck (NB-29). */
const START_DEADLINE_MS = 300_000;
const STOP_DEADLINE_MS = 120_000;
const KEYCHAIN_DEADLINE_MS = 60_000;
export interface VzDeadlines {
  readonly startMs?: number;
  readonly stopMs?: number;
  readonly keychainMs?: number;
}

export class VzDriver implements VmDriver {
  private readonly requests: NativeChannel;
  private readonly stopListeners: ((cause: VmStopCause) => void)[] = [];
  private readonly powerListeners: ((event: "sleep" | "wake") => void)[] = [];
  private readonly deadlines: Required<VzDeadlines>;
  readonly keychain: KeychainStore;

  private constructor(private readonly child: ChildProcess, private readonly channel: Socket,
    private readonly socketDir: string, private readonly config: VmConfig, deadlines?: VzDeadlines) {
    this.deadlines = { startMs: deadlines?.startMs ?? START_DEADLINE_MS,
      stopMs: deadlines?.stopMs ?? STOP_DEADLINE_MS, keychainMs: deadlines?.keychainMs ?? KEYCHAIN_DEADLINE_MS };
    this.requests = new NativeChannel(channel, {
      helper: "VM", endedMessage: "the VM helper ended", strictResponses: false, timeoutEndsChannel: false,
      refusal: message => new StoreError("BROKER_UNAVAILABLE", typeof message.error === "string" ? message.error : "the VM helper refused"),
      event: message => {
        if (message.event === "stopped" && (message.cause === "guest" || message.cause === "error")) {
          for (const listener of this.stopListeners) listener(message.cause);
          return true;
        }
        if (message.event === "sleep" || message.event === "wake") {
          for (const listener of this.powerListeners) listener(message.event);
          return true;
        }
        return false;
      },
    });
    this.keychain = nativeKeychainStore((op, fields) => this.ask(op, fields, this.deadlines.keychainMs));
    child.once("exit", () => { this.helperGone(); });
    child.once("error", () => { if (child.pid === undefined) this.helperGone(); });
  }

  /** The helper runs for as long as `omahostd` does. */
  static launch(helper: HelperCommand, socketDir: string, config: VmConfig, deadlines?: VzDeadlines): VzDriver {
    const child = spawnSupervisedService(helper.executable, helper.argv, helper.env, true);
    const channel = child.stdio[3];
    if (channel === null || channel === undefined || !("write" in channel))
      throw new StoreError("UNSUPPORTED_PROFILE", "the VM helper has no control channel");
    return new VzDriver(child, channel as Socket, socketDir, config, deadlines);
  }

  onStopped(listener: (cause: VmStopCause) => void): void { this.stopListeners.push(listener); }
  /** §9.1: the Mac is going to sleep, or has woken. */
  onPower(listener: (event: "sleep" | "wake") => void): void { this.powerListeners.push(listener); }

  private helperGone(): void {
    this.requests.close();
    // P0-5: EOF rejects requests, but only actual helper exit proves VM death.
    for (const listener of this.stopListeners.splice(0)) listener("error");
  }

  private ask(op: string, fields: Record<string, unknown> = {}, deadlineMs = KEYCHAIN_DEADLINE_MS): Promise<Record<string, unknown>> {
    return this.requests.request(op, fields, deadlineMs);
  }

  async start(): Promise<void> { await this.ask("start", { config: { ...this.config, socketDir: this.socketDir } }, this.deadlines.startMs); }
  async forceStop(): Promise<void> { await this.ask("forceStop", {}, this.deadlines.stopMs); }

  connect(port: number, deadlineMs = 10_000): Promise<Socket> {
    return connectSocket(join(this.socketDir, `port-${port}.sock`), deadlineMs);
  }

  /** Ends the helper; the VM, if any, ends with it. */
  close(): void { this.requests.close(); this.child.kill("SIGTERM"); }
}
