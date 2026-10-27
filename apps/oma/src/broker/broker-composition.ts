/** The application binds concrete owners to Broker's exact live capabilities. */
import { dirname, join } from "node:path";
import { createServer, Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { Actor, ProtocolLimits } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import type { LifecycleModule } from "@oma/lifecycle";
import type { GitModule } from "@oma/git";
import type { ReconcileModule } from "@oma/reconcile";
import { bindAdmissionGate } from "@oma/domain/admission";
import { actorSocketDirectoryAt } from "@oma/domain/paths";
import { statusViewPath } from "@oma/protocol/status-view";
import { ensureOwnedDirectory, removeOwnedFile } from "@oma/storage/directory";
import { clearSocketName } from "@oma/storage/socket-name";
import { TransportSpool } from "@oma/storage/transport-spool";
import type { ProcessLock } from "@oma/native/process-lock";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import type { ExecutionObservation, ExecutionScopePin } from "@oma/contracts/runtime";
import type { ViewsModule } from "../views.js";
import { StatusRefresh } from "@oma/broker/status-refresh";
import { Broker, type BrokerPaths, type PrincipalHostChannel } from "@oma/broker";
import type { BrokerLedger, BrokerTransaction, BrokerDependencies, BrokerMail, BrokerUnits, BrokerViews, BrokerEffects, PublicReviewPort } from "@oma/broker/ports";
import { createPublicDispatchPorts, createInternalDispatchDataPorts } from "./composition.js";
import { credentialStream, prepareCredentialListener } from "@oma/platform-linux/credential-stream";
import { pinLinuxPeer } from "@oma/platform-linux/peer-identity";
import { StoreError } from "@oma/domain/errors";
import { createMachBrokerTransport } from "@oma/platform-mac/mach-transport";

export function brokerLedger(store: Store): BrokerLedger {
  return Object.freeze({
    agentNames: () => store.agentNames(), getAgent: actor => store.getAgent(actor),
    listAgents: () => store.listAgents(), preparedBatches: actor => store.preparedBatches(actor),
    societyOpen: () => store.societyOpen(),
    transaction: body => store.transaction(tx => {
      const captured: BrokerTransaction = Object.freeze({
        updateIncarnation: (actor: Actor, incarnation: number) => tx.updateAgent({ name: actor, incarnation }),
      });
      return body(captured);
    }),
  } satisfies BrokerLedger);
}
export interface BrokerComposition {
  store: Store; mail: MailModule; units: BrokerExecution; views: ViewsModule;
  lifecycle: LifecycleModule; git: GitModule | null; reviews: PublicReviewPort | null;
  reconcile: ReconcileModule | null; paths: BrokerPaths; limits: ProtocolLimits;
  /** Already held before configuration/Store/recovery; its outer lifetime releases it. */
  lock: ProcessLock;
  principalHost?: PrincipalHostChannel | undefined;
}
export interface BrokerExecution extends BrokerUnits {
  pin(scope: string): ExecutionScopePin;
  observeStatus(actors: readonly Actor[]): Promise<ReadonlyMap<Actor, ExecutionObservation | "no-unit">>;
}
function scopeRoot(identity: unknown): { readonly pid: number; readonly startTime: string } | null {
  if (identity === null || typeof identity !== "object") return null;
  const value = identity as ExecutionWitness;
  if (value.kind === "darwin-audit-session") return { pid: value.pid, startTime: String(value.pidVersion) };
  if (value.kind === "linux-namespace") return { pid: value.pid, startTime: value.startTime };
  return null;
}
function linuxSocket(stream: Duplex): Socket {
  if (!(stream instanceof Socket)) throw new TypeError("Linux broker transport requires a native socket owner");
  return stream;
}
export function createBroker(input: BrokerComposition): Broker {
  const { store, mail, units, views, lifecycle, git, reviews, reconcile, paths, limits, lock, principalHost } = input;
  const status = new StatusRefresh(() => store.agentNames(), agents => units.observeStatus(agents));
  const transport: Pick<BrokerEffects, "pinPeer" | "assertEndpoint" | "openListener" | "peerStream" | "prepareEndpoint"> = process.platform === "darwin"
    ? createMachBrokerTransport(limits.idleStreamSeconds)
    : {
      pinPeer: stream => pinLinuxPeer(linuxSocket(stream)),
      assertEndpoint: path => {
        if (Buffer.byteLength(path) > 107 || path.includes("\0"))
          throw new StoreError("UNSUPPORTED_PROFILE", "actor socket path exceeds Linux sun_path");
      },
      openListener: (serve, maxConnections) => {
        const listener = createServer({ allowHalfOpen: true, pauseOnConnect: true }, serve);
        if (maxConnections !== undefined) listener.maxConnections = maxConnections;
        return { listener, prepare: () => prepareCredentialListener(listener) };
      },
      peerStream: (stream, authorize) => credentialStream(linuxSocket(stream), authorize),
      prepareEndpoint: clearSocketName,
    };
  const dependencies: BrokerDependencies = {
    acquireRunScope: scope => units.pin(scope),
    ledger: brokerLedger(store),
    mail: Object.freeze<BrokerMail>({ prepare: auth => mail.prepare(auth), complete: (auth, evidence) => mail.complete(auth, evidence),
      settleFromReceipt: (quiescence, batch) => mail.settleFromReceipt(quiescence, batch) }),
    units: Object.freeze<BrokerUnits>({ observe: actor => units.observe(actor), scopeRoot: actor => scopeRoot(units.scopeRoot(actor)), runnerAlive: actor => units.runnerAlive(actor),
      readLogs: (actor, since, limit) => units.readLogs(actor, since, limit),
      bindRunRevoker: revoke => units.bindRunRevoker(revoke) }),
    views: Object.freeze<BrokerViews>({ refreshWorld: () => views.refreshWorld(), publishStatus: snapshot => views.publishStatus(snapshot),
      observeRunnerSource: read => views.observeRunnerSource(read) }),
    reconcile: reconcile === null ? null : Object.freeze({ sweep: () => reconcile.sweep() }),
    status: Object.freeze({ request: () => status.request() }),
    public: createPublicDispatchPorts(store, mail, status, views, lifecycle, git, reviews, limits),
    internal: createInternalDispatchDataPorts(store, mail, paths.stateRoot),
    effects: Object.freeze<BrokerEffects>({
      ...transport,
      bindAdmission: gate => bindAdmissionGate(store, gate),
      ensureRunRoot: () => ensureOwnedDirectory(paths.runRoot, dirname(paths.runRoot), 0o700),
      ensureActorDirectory: (actor, incarnation) => ensureOwnedDirectory(actorSocketDirectoryAt(paths.runRoot, actor, incarnation), dirname(paths.runRoot), 0o700),
      removeStatusView: () => removeOwnedFile(statusViewPath(paths.stateRoot)),
      makeSpool: descriptor => new TransportSpool(join(paths.stateRoot, "staging"), descriptor),
      closeLedger: () => store.close(),
    }),
  };
  return new Broker(dependencies, paths, limits, lock, principalHost);
}
