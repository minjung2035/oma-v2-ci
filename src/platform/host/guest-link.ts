/** The host's connections to the guest (macos-platform §4.3).
 *
 * Every connection begins with the host's hello and the guest's answer. The
 * answer is read as untrusted input (MAC-230) and checked against what this
 * host booted: a guest that reports another image is not spoken to (MAC-601,
 * A7). A changed `bootId` means the guest rebooted, and everything the host
 * held for the previous boot -- placeholders, requests whose outcome is
 * unknown -- is settled again by the listeners (MAC-211, MAC-241).
 */
import type { Socket } from "node:net";
import { FramedPeer, PlatformError, sendHello, sendHelloForBytes } from "../rpc.js";
import {
  portOf, type Channel, type HelloParams, type HelloResult,
} from "../../protocol/host-guest.js";

/** How a connection to a guest port is made: vsock through the VM helper in
 * production, a local socket in tests. */
export interface GuestPorts { connect(port: number): Promise<Socket> }

export interface HostIdentity {
  readonly hostVersion: string;
  readonly installationId: string;
  readonly instanceId: string;
  /** The image this host booted. */
  readonly expectImage: string;
  readonly protocol: { readonly min: number; readonly max: number };
}
export interface LinkOptions {
  readonly frameBytes: number;
  readonly helloDeadlineMs: number;
  readonly requestTimeoutMs: number;
}

export class GuestLink {
  private bootId: string | null = null;
  private readonly rebootListeners: ((bootId: string) => void)[] = [];

  constructor(private readonly ports: GuestPorts, private readonly identity: HostIdentity, private readonly options: LinkOptions) {}

  get currentBoot(): string | null { return this.bootId; }
  onReboot(listener: (bootId: string) => void): void { this.rebootListeners.push(listener); }

  private hello(channel: Channel, extra: { society?: string; takeover?: true } = {}): HelloParams {
    return { channel, protocol: this.identity.protocol, hostVersion: this.identity.hostVersion,
      installationId: this.identity.installationId, instanceId: this.identity.instanceId,
      expectImage: this.identity.expectImage, ...extra };
  }

  private observe(result: HelloResult): void {
    if (result.guestImage !== this.identity.expectImage)
      throw new PlatformError({ code: "ENGINE_VERSION_SKEW", message: "the engine is not the version this app started", retry: "never" });
    const previous = this.bootId;
    this.bootId = result.bootId;
    if (previous !== null && previous !== result.bootId) for (const listener of this.rebootListeners) listener(result.bootId);
  }

  /** A control or society connection, after its hello. */
  async json(channel: "control" | "society"): Promise<FramedPeer> {
    const socket = await this.ports.connect(portOf(channel));
    const peer = new FramedPeer(socket, { frameBytes: this.options.frameBytes, requestTimeoutMs: this.options.requestTimeoutMs });
    try { this.observe(await sendHello(peer, this.hello(channel))); }
    catch (error) { peer.close(); throw error; }
    return peer;
  }

  /** A terminal, egress or stream connection, after its hello, with whatever
   * the guest sent right behind its answer. */
  async bytes(channel: "terminal" | "egress" | "stream", extra: { society?: string; takeover?: true } = {}):
    Promise<{ readonly socket: Socket; readonly rest: Buffer }> {
    const socket = await this.ports.connect(portOf(channel));
    let answered: { result: HelloResult; rest: Buffer };
    try { answered = await sendHelloForBytes(socket, this.hello(channel, extra), this.options.frameBytes, this.options.helloDeadlineMs); }
    catch (error) { socket.destroy(); throw error; }
    try { this.observe(answered.result); }
    catch (error) { socket.destroy(); throw error; }
    return { socket, rest: answered.rest };
  }
}
