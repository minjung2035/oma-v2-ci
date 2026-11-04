/** One-shot kernel job mechanics. The shared execution owner must publish
 * identity before reading prepared and recheck authority before release.
 * Image checks cover mapped main images, not scripts, role or installation. */
import { closeSync, fstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { snapshotCommand, type CommandSpec } from "@oma/domain/process-command";
import { ExecutionNotStarted } from "@oma/domain/process-command";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withAsyncCleanup, withCleanup } from "./cleanup.js";
import { currentDarwinAuditToken, darwinProcessStopHint, pinDarwinProcess, retainDarwinProcessPin, reacquireChangedDarwinProcess, observeDarwinCoalitionPopulation,
  darwinCoalitionMemberHints, signalDarwinCoalitionMember, type DarwinCoalitionIdentity, type DarwinProcessPin } from "./audit-session.js";
import { observeDarwinAuditOrigin } from "./audit-origin.js";
import { controlPipe } from "./control-socket.js";
import { openDirectory, openRegularBeneath, withinDirectory } from "./files.js";
import { createMachEndpoint, createMachFilePort, listenMachDiscardService, lookupMachService,
  type MachMessage, type MachSendRight } from "./mach-message.js";
import { bundledJobHelper, encodeDarwinJob } from "./darwin-job-launch.js";
import { submitLaunchdJob, startLaunchdJob, type DarwinSetupProcess } from "./darwin-launchd-job.js";
import { machoImageCdHashes } from "./darwin-macho-image.js";
import { machPoll } from "./mach-poll.js";
import { captureDarwinJobPeer, type DarwinJobPeer } from "./darwin-job-peer.js";

export interface DarwinJobProcessPin {
  readonly pid: number; readonly uid: number; readonly gid: number;
  alive(): boolean;
  inScope(identity: unknown): boolean;
  close(): void;
}
export interface DarwinJobImageDigests {
  readonly helper: string;
  readonly images: readonly string[];
}
export interface DarwinJobFile { readonly target: number; readonly fd: number }
type DarwinJobTerminal = { readonly kind: "waited"; readonly pid: number; readonly waitStatus: number } |
  { readonly kind: "stopped" };
export interface DarwinJobControl {
  pinChild(): DarwinJobProcessPin;
  readonly identity: DarwinCoalitionIdentity;
  /** Lazy: trusted setup starts only when the shared owner has persisted identity. */
  readonly prepared: Promise<void>;
  /** Owner-requested stop has no fabricated child wait status. */
  readonly terminal: Promise<DarwinJobTerminal>;
  /** The actual helper generation ended; descendant population is separate. */
  readonly closed: Promise<void>;
  population(): "populated" | "empty" | "unknown";
  release(): void;
  terminate(): void;
  close(): void;
}
type Data = Extract<MachMessage, { kind: "data" }>;
function unknown(message: string, cause?: unknown): StoreError {
  return new StoreError("RUN_TERMINATION_UNKNOWN", message, { cause });
}
function selected(path: string, expected?: string): readonly string[] {
  const fd = withinDirectory(path, (parent, name) => openRegularBeneath(parent, name));
  return withCleanup(() => {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 268435456n) throw unknown("job image is not a bounded regular file");
    const bytes = readFileSync(fd), after = fstatSync(fd, { bigint: true });
    if (BigInt(bytes.length) !== before.size || ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(key =>
      before[key as "dev"] !== after[key as "dev"])) throw unknown("job image changed during selection");
    if (expected !== undefined && createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new StoreError("UNSUPPORTED_PROFILE", "selected native image differs from its trusted installation digest");
    return machoImageCdHashes(bytes, process.arch === "arm64" ? "arm64" : "x64");
  }, () => closeSync(fd));
}
async function image(pin: DarwinProcessPin, hashes: readonly string[], retry = true): Promise<DarwinProcessPin> {
  const operation = observeDarwinAuditOrigin(pin.token, hashes);
  const kind = await withAsyncCleanup(async () => (await operation.result).kind, () => operation.returned), state = pin.state();
  if (kind === "matched" && state === "changed" && retry) {
    let replacement: DarwinProcessPin | undefined;
    try { replacement = reacquireChangedDarwinProcess(pin); return await image(replacement, hashes, false); }
    catch (error) { return withCleanup(() => { throw error; }, () => replacement?.close()); }
  }
  if (kind !== "matched" || state !== "stopped")
    throw unknown(`stopped job image did not match the selected generation: origin=${kind}, process=${state}`);
  return pin;
}
/** Borrows all input FDs during acquisition, then owns fileport copies until
 * READY. No channel or pathname grants workload/actor authority. The returned
 * identity is transient until a qualified journal producer accepts it. */
export async function startDarwinJobControl(source: CommandSpec, files: readonly DarwinJobFile[],
  images: readonly string[], invoke: DarwinSetupProcess, signal?: AbortSignal, peerSource?: DarwinJobPeer, directoryFd?: number, imageDigests?: DarwinJobImageDigests): Promise<DarwinJobControl> {
  let attempted = false;
  const owners: (() => void)[] = [], pins: DarwinProcessPin[] = [];
  let root: DarwinProcessPin | undefined, rootAccepted = false;
  try {
    const command = snapshotCommand(source), targets = files.map(file => file.target), stages = images.length;
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "job setup was cancelled");
    if (process.platform !== "darwin" || (process.getuid?.() ?? 0) <= 0 || stages !== 1 && stages !== 2 || images[0] !== command.executable)
      throw new StoreError("UNSUPPORTED_PROFILE", "job setup requires explicit Darwin main image stages");
    if (directoryFd !== undefined && (!Number.isSafeInteger(directoryFd) || directoryFd < 0 || command.cwd !== undefined || !fstatSync(directoryFd).isDirectory()))
      throw new StoreError("UNSUPPORTED_PROFILE", "job requires one held directory and no pathname cwd");
    if (imageDigests !== undefined && (typeof imageDigests.helper !== "string" || !/^[0-9a-f]{64}$/.test(imageDigests.helper) ||
        !Array.isArray(imageDigests.images) || imageDigests.images.length !== images.length || imageDigests.images.some(value => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))))
      throw new StoreError("UNSUPPORTED_PROFILE", "native image digests do not match the explicit stages");
    const peer = peerSource === undefined ? undefined : captureDarwinJobPeer(peerSource);
    if (peer !== undefined) owners.push(() => peer.endpoint.close());
    const frame = encodeDarwinJob(command, targets, stages, false, peer?.token), hashes = images.map((path, index) => selected(path, imageDigests?.images[index])), helper = bundledJobHelper(), helperHashes = selected(helper, imageDigests?.helper);
    const capabilities = files.map(file => { const port = createMachFilePort(file.fd); owners.push(() => port.close()); return port; });
    const directory = directoryFd === undefined ? (() => {
      const cwd = openDirectory(command.cwd ?? process.cwd());
      return withCleanup(() => createMachFilePort(cwd), () => closeSync(cwd));
    })() : createMachFilePort(directoryFd);
    owners.push(() => directory.close());
    const token = currentDarwinAuditToken(), label = "org.oma.job." + randomUUID(), serviceName = label + ".control";
    const endpoint = createMachEndpoint(); owners.push(() => endpoint.receive.close(), () => endpoint.send.close());
    const sink = listenMachDiscardService(label + ".discard"); owners.push(() => sink.close());
    const sinkSend = lookupMachService(label + ".discard"); owners.push(() => sinkSend.close());
    attempted = true;
    const registration = submitLaunchdJob({ label, startSuspended: true, machServices: [serviceName],
      command: { executable: helper, argv: [serviceName, ...token.map(String)], env: {}, cwd: "/",
        timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 } }, 10000, invoke);
    startLaunchdJob(registration, 10000, invoke);
    const deadline = performance.now() + 10000; let lastReadiness = "no PID";
    for (;;) {
      if (signal?.aborted || performance.now() >= deadline) throw unknown(`initial job image was not observed in time: ${lastReadiness}`);
      const observation = invoke(["print", registration.target], 1000);
      if (observation.kind !== "exited" || observation.exitCode !== 0) throw unknown("job PID hint is unavailable", observation);
      const matches = [...observation.stdout.toString().matchAll(/^\s*pid = ([1-9][0-9]*)\s*$/gm)];
      if (matches.length === 1) {
        const pid = Number(matches[0]?.[1]), readiness = darwinProcessStopHint(pid);
        lastReadiness = readiness;
        if (readiness === "stopped") { root = pinDarwinProcess(pid); pins.push(root); break; }
        // A hint taken while launchd publishes its PID may be unavailable or
        // already stale. It grants no authority: require a positive stopped
        // observation within the original deadline before acquiring any pin.
      }
      await delay(5);
    }
    const original = root; root = await image(root, helperHashes); if (root !== original) pins.push(root); rootAccepted = true;
    const controller = root, identity = controller.identity, service = lookupMachService(serviceName); owners.push(() => service.close());
    let pending: { id: number; yes(message: Data): void; no(error: unknown): void } | undefined;
    let problem: Error | undefined, prepared: Promise<void> | undefined, ready = false, released = false, returned = false, stopping = false, ownerStopped = false;
    let terminalDone = false, rootDone = false, allReturned = false, closeFailure: unknown;
    const inputReturns: Promise<void>[] = [];
    let finish!: (value: DarwinJobTerminal) => void, failTerminal!: (error: unknown) => void, finishRoot!: () => void;
    const terminal = new Promise<DarwinJobTerminal>((yes, no) => { finish = yes; failTerminal = no; });
    const rootClosed = new Promise<void>(yes => { finishRoot = yes; });
    const closed = rootClosed.then(async () => { await prepared?.catch(() => {}); await Promise.all(inputReturns); allReturned = true; });
    void terminal.catch(() => {});
    const terminate = (): void => {
      stopping = true;
      const errors: unknown[] = [];
      try { cleanupAll([...capabilities.map(port => () => port.close()), () => directory.close()]); }
      catch (error) { errors.push(error); }
      const population = observeDarwinCoalitionPopulation(identity);
      if (population === "unknown") errors.push(unknown("job population is unobserved"));
      if (population === "populated") for (const pid of darwinCoalitionMemberHints(identity))
        try { signalDarwinCoalitionMember(identity, pid); } catch (error) { errors.push(error); }
      if (errors.length) throw unknown("job member termination is unconfirmed", new AggregateError(errors));
    };
    const failed = (error: Error): void => {
      if (problem) return;
      problem = error;
      try { terminate(); } catch (cause) { problem = unknown("job observation and termination failed", new AggregateError([error, cause])); }
      pending?.no(problem); pending = undefined;
      if (!terminalDone && !ownerStopped) { terminalDone = true; failTerminal(problem); }
    };
    const one = Buffer.alloc(4); one.writeUInt32LE(1);
    const send = (id: number, right?: MachSendRight): void => {
      if (problem || returned || service.send(id, one, right) !== "sent") throw problem ?? unknown("job gate enqueue was not confirmed");
    };
    const sendSetup = async (id: number, right?: MachSendRight): Promise<void> => {
      const limit = performance.now() + 10000;
      for (;;) {
        if (problem || stopping || returned || rootDone || performance.now() >= limit) throw problem ?? unknown("job setup enqueue is unconfirmed");
        if (service.send(id, one, right) === "sent") return;
        await delay(4);
      }
    };
    const take = (id: number): Promise<Data> => {
      if (problem || pending || rootDone) throw problem ?? unknown("job control response cannot be observed");
      const response = new Promise<Data>((yes, no) => { pending = { id, yes, no }; });
      void response.catch(() => {}); return response;
    };
    const poll = machPoll(() => {
      try {
        for (let n = 0; n < 64 && sink.discard(); ++n) { /* no service-control replies */ }
        if (!problem) for (let n = 0; n < 32; ++n) {
          const packet = endpoint.receive.receive(); if (packet.kind === "again") break;
          withCleanup(() => {
            if (!packet.sender.token.every((word, index) => word === controller.token[index])) return;
            if (packet.reply !== null || !pending || packet.id !== pending.id ||
                packet.bytes.length !== ([0x4f4d4123, 0x4f4d4128].includes(packet.id) ? 48 : 16) || packet.bytes.readUInt32LE() !== 1)
              throw unknown("job helper protocol was poisoned");
            const waiting = pending; pending = undefined; waiting.yes(packet);
          }, () => packet.reply?.close());
        }
        const state = controller.state();
        if (state === "changed" || state === "unknown") failed(unknown("job helper generation became unobserved"));
        if (!rootDone && (state === "exited" || observeDarwinCoalitionPopulation(identity) === "empty")) {
          rootDone = true;
          if (!terminalDone && ownerStopped) {
            terminalDone = true; finish({ kind: "stopped" });
            pending?.no(new StoreError("CANCELLED_BEFORE_COMMIT", "job helper stopped at its owner's request")); pending = undefined;
          } else if (!terminalDone) failed(unknown("job helper ended before a terminal response"));
          finishRoot();
        }
      } catch (error) { failed(error instanceof Error ? error : unknown("job control observation failed", error)); }
    }, failed);
    poll.request(true); owners.push(() => poll.close());
    let target: DarwinProcessPin | undefined;
    const observeTarget = async (packet: Data, stage: number): Promise<void> => {
      const pin = pinDarwinProcess(packet.bytes.readUInt32LE(8)); pins.push(pin);
      const actual = Array.from({ length: 8 }, (_, index) => packet.bytes.readUInt32LE(16 + index * 4));
      if (pin.identity.bootId !== identity.bootId || pin.identity.coalitionId !== identity.coalitionId ||
          !pin.token.every((word, index) => word === actual[index])) throw unknown("job target kernel generation did not agree");
      const expected = hashes[stage]; if (expected === undefined) throw unknown("job image stage is unavailable");
      const selectedPin = await image(pin, expected); if (selectedPin !== pin) pins.push(selectedPin); target = selectedPin;
    };
    const prepare = async (): Promise<void> => {
      if (stopping) throw unknown("job setup was stopped");
      const ack = take(0x4f4d4121);
      if (!controller.resume()) throw unknown("job helper could not resume its selected image");
      await sendSetup(0x4f4d4120, endpoint.send); await ack;
      const pipe = controlPipe();
      let read = pipe.read, write = pipe.write;
      let config: MachSendRight | undefined, writer: Socket | undefined;
      try {
        config = createMachFilePort(read); closeSync(read); read = -1;
        const output = new Socket({ fd: write, readable: false, writable: true }); writer = output; write = -1;
        inputReturns.push(new Promise<void>(yes => output.once("close", yes)));
        const drained = new Promise<void>((yes, no) => { output.once("error", no); output.once("close", yes); });
        void drained.catch(() => {});
        writer.end(frame); await sendSetup(0x4f4d412a, config); config.close(); await drained;
      } finally { cleanupAll([() => config?.close(), () => { writer?.destroy(); },
        () => { if (read >= 0) closeSync(read); }, () => { if (write >= 0) closeSync(write); }]); }
      await sendSetup(0x4f4d412b, directory); directory.close();
      if (peer !== undefined) { await sendSetup(0x4f4d412d, peer.endpoint); peer.endpoint.close(); }
      const first = take(0x4f4d4123);
      for (const [index, file] of capabilities.entries()) await sendSetup(0x4f4d4130 + index, file);
      await sendSetup(0x4f4d4122, sinkSend); await observeTarget(await first, 0);
      cleanupAll(capabilities.map(port => () => port.close()));
      if (stages === 2) {
        const next = take(0x4f4d4128); send(0x4f4d4124); await observeTarget(await next, 1);
      }
      const ended = take(0x4f4d4125);
      void ended.then(packet => {
        if (!target || packet.bytes.readUInt32LE(8) !== target.pid) throw unknown("job terminal child did not agree");
        terminalDone = true; finish({ kind: "waited", pid: target.pid, waitStatus: packet.bytes.readUInt32LE(12) }); send(0x4f4d4126);
      }).catch(error => failed(error));
      ready = true;
    };
    return Object.freeze({ identity, terminal, closed,
      pinChild() {
        if (!ready || stopping || returned || problem || !target)
          throw problem ?? unknown("selected job child is not available");
        const pin = retainDarwinProcessPin(target);
        const alive = (): boolean => {
          const state = pin.state();
          return (state === "live" || state === "stopped") && observeDarwinCoalitionPopulation(identity) === "populated";
        };
        return Object.freeze({ pid: pin.pid, uid: pin.token[1]!, gid: pin.token[2]!, alive,
          inScope(current: unknown): boolean {
            if (!alive() || current === null || typeof current !== "object" || Array.isArray(current) ||
                Object.keys(current).sort().join() !== "bootId,coalitionId,kind") return false;
            return "kind" in current && "bootId" in current && "coalitionId" in current &&
              current.kind === pin.identity.kind && current.bootId === pin.identity.bootId &&
              current.coalitionId === pin.identity.coalitionId && alive();
          }, close: () => pin.close() });
      },
      get prepared() {
        prepared ??= (rootDone || returned ? Promise.reject(unknown("job helper already ended")) : prepare()).catch(error => { failed(error); throw error; });
        void prepared.catch(() => {}); return prepared;
      },
      population: () => observeDarwinCoalitionPopulation(identity),
      terminate() { ownerStopped = true; terminate(); },
      release() {
        if (!ready || stopping || released || returned || problem || !target || target.state() !== "stopped" || controller.state() !== "live")
          throw problem ?? unknown("job workload gate is not ready");
        send(stages === 2 ? 0x4f4d4129 : 0x4f4d4124); released = true;
      },
      close() {
        if (closeFailure !== undefined) throw closeFailure;
        if (returned) return;
        if (!allReturned || observeDarwinCoalitionPopulation(identity) !== "empty") throw unknown("job resources are still live");
        returned = true;
        try { cleanupAll([...owners, ...pins.map(pin => () => pin.close())]); }
        catch (error) { closeFailure = error; throw error; }
      },
    });
  } catch (error) {
    if (rootAccepted) try { root?.terminate(); } catch (cause) { error = new AggregateError([error, cause]); }
    return withCleanup(() => { throw attempted ? unknown("job acquisition did not complete", error) : new ExecutionNotStarted(error); },
      () => cleanupAll([...owners, ...pins.map(pin => () => pin.close())]));
  }
}
