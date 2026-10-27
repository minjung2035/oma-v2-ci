/** Composition of common Resident policy with the selected scope and channel
 * primitives. This file does not interpret accepted plans or settle receipts. */
import { closeSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";
import type { Store } from "@oma/storage";
import type { HostConfig } from "@oma/contracts";
import type { BoundPeer } from "@oma/broker/ports";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { ResidentRuntime } from "@oma/process/resident-runtime";
import { controlSocketPair } from "@oma/native/control-socket";
import { pinNamespaceRunner, type NamespaceInitIdentity } from "@oma/native/pid-namespace";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import { cleanupAll } from "@oma/native/cleanup";
import { runnerScope } from "@oma/platform-linux/runner-scope";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { encodedResidentToolSurface } from "@oma/domain/tool-surface";
import { StoreError } from "@oma/domain/errors";
import type { ExecutionRuntime } from "./execution-runtime.js";
import { ResidentLogStore } from "@oma/storage/resident-logs";
import { residentLogSinks, residentLogView } from "@oma/process/resident-logs";
import { acquireExecutionChild } from "@oma/process/owned-execution";
import { withCleanup } from "@oma/native/cleanup";
import { encodeMacDeveloperTools, type MacDeveloperTools } from "@oma/protocol/mac-developer-tools";

export function createNativeResidents(store: Store, executions: ExecutionRuntime,
  location: { stateRoot: string; runRoot: string; society: string; configPath: string }, config: HostConfig,
  attach: (socket: Socket, peer: BoundPeer) => void, hint: () => void,
  liveIncarnation: (actor: string, invocationId: string) => number | null,
  launch: { readonly environment?: Readonly<NodeJS.ProcessEnv>; readonly toolSurface?: string; readonly developerTools?: MacDeveloperTools } = {}) {
  // The application owns the host launch environment and internal surface.
  // Freeze them for this owner, including automatically created Residents;
  // ambient changes during another launch cannot supply different bytes.
  const environment = Object.freeze({ ...(launch.environment ?? process.env) });
  const toolSurface = launch.toolSurface ?? encodedResidentToolSurface();
  const developerTools = launch.developerTools;
  const developerToolsHex = developerTools === undefined ? undefined : encodeMacDeveloperTools(developerTools);
  const logs = new ResidentLogStore(location.stateRoot);
  const channels = new Map<string, { socket: Socket; peer: BoundPeer }>();
  let revoke: ((actor: string) => void) | undefined;
  let incarnationOf = (actor: string): number | null => store.getAgent(actor)?.incarnation ?? null;
  const runtime = new ResidentRuntime<ExecutionWitness>({
    references: actor => {
      const row = store.getAgent(actor);
      if (!row || row.role !== "resident") throw new StoreError("ADDRESS_NOT_FOUND", "Resident identity is missing");
      const spec = resolvedSpecOf(row);
      if (!config.agentProfiles[spec.profile] || !config.modelProfiles[spec.modelProfile])
        throw new StoreError("UNSUPPORTED_PROFILE", "accepted Resident profile cannot execute in this deployment");
      return { profile: spec.profile, modelProfile: spec.modelProfile };
    },
    incarnation: actor => incarnationOf(actor),
    confirmDead: actor => executions.confirmDead(`resident:${actor}`),
    revoke: actor => { revoke?.(actor); channels.get(actor)?.socket.destroy(); },
    hint, failure: error => { console.error("Resident execution remains fenced:", error); },
    begin: async (actor, references, authorize, prepared, signal) => {
      const pair = controlSocketPair(); let parent: number | undefined = pair.parent, child: number | undefined = pair.child;
      let socket: Socket | undefined;
      let ticket: Awaited<ReturnType<ExecutionRuntime["begin"]>> | undefined;
      let log: ReturnType<ResidentLogStore["open"]> | undefined;
      let sinks: ReturnType<typeof residentLogSinks> | undefined;
      try {
        socket = new Socket({ fd: parent, readable: true, writable: true }); parent = undefined;
        socket.pause(); socket.on("error", () => {});
        ticket = await executions.begin(`resident:${actor}`, execution => {
          const invocation = execution.replaceAll("-", "");
          log = logs.open(actor, invocation);
          sinks = residentLogSinks(actor, invocation, () => liveIncarnation(actor, invocation), entry => log!.append(entry));
          const env: NodeJS.ProcessEnv = { ...environment,
            OMA_PROFILE_HEX: Buffer.from(references.profile).toString("hex"),
            OMA_MODEL_PROFILE_HEX: Buffer.from(references.modelProfile).toString("hex"),
            OMA_TOOL_SURFACE_HEX: Buffer.from(toolSurface).toString("hex") };
          delete env.OMA_SOCIETY_FENCE_FD; delete env.OMA_HOST_CHANNEL;
          // Explicit trusted launch input, never inherited ambient data. The
          // Runner decodes it before constructing its Worker effects.
          if (developerToolsHex === undefined) delete env.OMA_DEVELOPER_TOOLS_HEX;
          else env.OMA_DEVELOPER_TOOLS_HEX = developerToolsHex;
          return runnerScope({ executable: config.installation.node,
            argv: [join(config.installation.libdir, "apps/oma/dist/entry/runner.js"), "--society", location.society,
              "--agent", actor, "--execution", execution, "--config", location.configPath, "--state-root", location.stateRoot, "--run-root", location.runRoot],
            env, timeoutMs: null, stdoutBytes: config.limits.logBytes, stderrBytes: config.limits.logBytes,
            stdoutOverflow: "discard", stderrOverflow: "discard" });
        }, signal, authorize, prepared, [child], {
          stdoutSink: bytes => sinks!.stdoutSink(bytes), stderrSink: bytes => sinks!.stderrSink(bytes),
        });
        const fullCompletion = ticket.completion.then(result => { log!.close(); return result; }, error => withCleanup(() => { throw error; }, () => log!.close()));
        void fullCompletion.catch(() => {});
        ticket = Object.freeze({ ...ticket, completion: fullCompletion });
        const inherited = child; child = undefined; closeSync(inherited);
        const witness = ticket.witness;
        const pin = await acquireExecutionChild(ticket, () => {
          try { return { kind: "ready", pin: pinNamespaceRunner(witness as NamespaceInitIdentity) }; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "EAGAIN") return { kind: "waiting" }; throw error; }
        }, signal, config.limits.receiptWaitSeconds * 1000);
        const owner = new SharedPeerPin(() => pin.alive(), () => pin.close());
        const peer: BoundPeer = Object.freeze({ pid: pin.pid, uid: pin.uid, gid: pin.gid,
          sameSender: () => false, // This private channel never accepts an observed-message transport.
          inheritedRunner: Object.freeze({ actor, invocationId: ticket.execution.replaceAll("-", "") }),
          alive: () => owner.alive(), retainForExecution: () => owner.retainForExecution(), releaseConnection: () => owner.releaseConnection() });
        const connection = { socket, peer }; channels.set(actor, connection);
        socket.once("close", () => {
          if (channels.get(actor) === connection) channels.delete(actor);
          try { owner.releaseConnection(); } catch (error) { console.error("Runner pin close failed:", error); }
        });
        attach(socket, peer);
        return ticket;
      } catch (error) {
        socket?.destroy();
        const failures: unknown[] = [error];
        if (ticket !== undefined) try { await ticket.stop(); } catch (cleanup) { failures.push(cleanup); }
        try { cleanupAll([() => { if (parent !== undefined) closeSync(parent); }, () => { if (child !== undefined) closeSync(child); }]); }
        catch (cleanup) { failures.push(cleanup); }
        try { log?.close(); } catch (cleanup) { failures.push(cleanup); }
        if (failures.length > 1) throw new AggregateError(failures, "Resident launch and cleanup failed");
        throw error;
      }
    },
  });
  return Object.assign(runtime, {
    bindRunRevoker: (callback: (actor: string) => void) => { revoke = callback; },
    bindIncarnationReader: (reader: (actor: string) => number | null) => { incarnationOf = reader; },
    scopeRoot: (actor: string) => {
      const identity = runtime.witness(actor);
      if (identity === null) return null;
      if (identity.kind === "darwin-audit-session") return { pid: identity.pid, startTime: String(identity.pidVersion) };
      return { pid: identity.pid, startTime: identity.startTime };
    },
    runnerAlive: (actor: string) => channels.get(actor)?.peer.alive() ?? false,
    readLogs: async (actor: string, sinceSeconds: number, limit: number) => residentLogView(logs.read(actor), sinceSeconds, limit),
  });
}
export type NativeResidents = ReturnType<typeof createNativeResidents>;
