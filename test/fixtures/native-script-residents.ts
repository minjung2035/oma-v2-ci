import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
/** Real trusted test runners for protocol/CLI regressions. The program is the
 * test driver, not the production Worker. Journal, namespace, PID2 pin, private
 * control channel, byte-sender authentication and whole-scope death are real.
 * Product Worker/Pi launch remains covered by the separate native scenarios. */
import { closeSync } from "node:fs";
import { Socket } from "node:net";
import type { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { ResidentRuntime } from "@oma/process/resident-runtime";
import { acquireExecutionChild, type ExecutionTicket } from "@oma/process/owned-execution";
import { runnerScope } from "@oma/platform-linux/runner-scope";
import { controlSocketPair } from "@oma/native/control-socket";
import { pinNamespaceRunner, type NamespaceInitIdentity } from "@oma/native/pid-namespace";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import type { BoundPeer } from "@oma/broker/ports";
import type { Broker } from "@oma/broker";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { prepareResidentRootfs, hostSystemLayout } from "@oma/platform-linux/resident-rootfs";
import { quarantineExecution } from "#oma-test/app/runtime/quarantine-execution";
import type { GitPaths } from "@oma/git/paths";
import { join } from "node:path";

export async function nativeScriptResidents(store: Store, state: string) {
  const rootfs = residentRootfsPath(state);
  prepareResidentRootfs(rootfs, hostSystemLayout(), process.getuid!(), process.getgid!());
  ExecutionJournal.initialize(state);
  const executions = new ExecutionRuntime(state);
  await executions.recover();
  const scripts = new Map<string, { path: string; env: NodeJS.ProcessEnv }>();
  const tickets = new Map<string, ExecutionTicket<NamespaceInitIdentity>>();
  const channels = new Map<string, { socket: Socket; peer: BoundPeer }>();
  let broker: Broker | null = null;
  let incarnationOf = (actor: string): number | null => store.getAgent(actor)?.incarnation ?? null;
  let revoke: ((actor: string) => void) | undefined;
  const runtime = new ResidentRuntime<NamespaceInitIdentity>({
    references(actor) {
      const row = store.getAgent(actor);
      if (!row || row.role !== "resident") throw new StoreError("ADDRESS_NOT_FOUND", "test runner has no Resident");
      const spec = resolvedSpecOf(row);
      return { profile: spec.profile, modelProfile: spec.modelProfile };
    },
    incarnation: actor => incarnationOf(actor),
    confirmDead: actor => executions.confirmDead(`resident:${actor}`),
    revoke(actor) { revoke?.(actor); channels.get(actor)?.socket.destroy(); },
    hint() {}, failure(error) { console.error("Native test runner failed:", error); },
    async begin(actor, _references, authorize, prepared, signal) {
      const script = scripts.get(actor);
      if (!script || !broker) throw new Error("native script must be assigned before launch");
      const pair = controlSocketPair(); let parent: number | undefined = pair.parent, child: number | undefined = pair.child;
      let socket: Socket | undefined, ticket: ExecutionTicket<NamespaceInitIdentity> | undefined;
      try {
        socket = new Socket({ fd: parent, readable: true, writable: true }); parent = undefined;
        socket.pause(); socket.on("error", () => {});
        ticket = await executions.begin(`resident:${actor}`, execution => runnerScope({
          executable: process.execPath, argv: [script.path],
          env: { ...process.env, ...script.env, OMA_TEST_INVOCATION_ID: execution.replaceAll("-", "") },
          timeoutMs: 120_000, stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024,
        }), signal, authorize, prepared, [child]);
        const inherited = child; child = undefined; closeSync(inherited);
        const pin = await acquireExecutionChild(ticket, () => {
          try { return { kind: "ready", pin: pinNamespaceRunner(ticket!.witness) }; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "EAGAIN") return { kind: "waiting" }; throw error; }
        }, signal, 10_000);
        const owner = new SharedPeerPin(() => pin.alive(), () => pin.close());
        const peer: BoundPeer = Object.freeze({ pid: pin.pid, uid: pin.uid, gid: pin.gid,
          sameSender: () => false,
          inheritedRunner: Object.freeze({ actor, invocationId: ticket.execution.replaceAll("-", "") }),
          alive: () => owner.alive(), retainForExecution: () => owner.retainForExecution(), releaseConnection: () => owner.releaseConnection() });
        const connection = { socket, peer }; channels.set(actor, connection);
        socket.once("close", () => { if (channels.get(actor) === connection) channels.delete(actor); owner.releaseConnection(); });
        broker.attachRunner(socket, peer); tickets.set(actor, ticket);
        return ticket;
      } catch (error) {
        socket?.destroy();
        await withAsyncCleanup(async () => { if (ticket) await ticket.stop(); throw error; }, async () => {
          cleanupAll([() => { if (parent !== undefined) closeSync(parent); }, () => { if (child !== undefined) closeSync(child); }]);
        });
        throw error;
      }
    },
  });
  return Object.assign(runtime, {
    attach(value: Broker) { broker = value; },
    quarantine: (paths: GitPaths) => quarantineExecution({ ...paths,
      checkNode: process.execPath, checkAssetsDir: process.cwd() }, executions),
    bindRunRevoker(callback: (actor: string) => void) { revoke = callback; },
    bindIncarnationReader(reader: (actor: string) => number | null) { incarnationOf = reader; },
    scopeRoot: (actor: string) => runtime.witness(actor),
    runnerAlive: (actor: string) => channels.get(actor)?.peer.alive() ?? false,
    async readLogs(): Promise<never> { throw new StoreError("UNSUPPORTED_PROFILE", "test driver has no product diagnostic log store"); },
    async runScript(actor: string, path: string, env: NodeJS.ProcessEnv) {
      scripts.set(actor, { path, env });
      await runtime.start(actor, true);
      const ticket = tickets.get(actor);
      if (!ticket) throw new Error("native test runner has no ticket");
      const result = await ticket.completion;
      if (result.kind !== "exited" || result.exitCode !== 0)
        throw new Error(`native test runner failed: ${result.kind}/${result.exitCode}: ${result.stderr.toString("utf8")}`);
      if (!executions.confirmDead(`resident:${actor}`)) throw new Error("test runner scope remains unobserved");
      return result;
    },
    closeExecution: () => withAsyncCleanup(() => runtime.close(), () => executions.close()),
  });
}
export type NativeScriptResidents = Awaited<ReturnType<typeof nativeScriptResidents>>;
