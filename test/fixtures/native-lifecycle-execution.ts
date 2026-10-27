/** Lifecycle tests use real journal/namespace scopes with a small trusted
 * keepalive program. No runner control grant is minted. Product Worker/Pi and
 * authenticated CLI execution are covered by their separate actual runners. */
import type { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { ResidentRuntime } from "@oma/process/resident-runtime";
import { runnerScope } from "@oma/platform-linux/runner-scope";
import type { NamespaceInitIdentity } from "@oma/native/pid-namespace";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup } from "@oma/native/cleanup";

export async function nativeLifecycleExecution(store: Store, root: string) {
  ExecutionJournal.initialize(root);
  const executions = new ExecutionRuntime(root); await executions.recover();
  let incarnationOf = (actor: string): number | null => store.getAgent(actor)?.incarnation ?? null;
  let revoke: ((actor: string) => void) | undefined;
  const runtime = new ResidentRuntime<ExecutionWitness>({
    references(actor) {
      const row = store.getAgent(actor);
      if (!row || row.role !== "resident") throw new StoreError("ADDRESS_NOT_FOUND", "lifecycle test Resident is missing");
      const spec = resolvedSpecOf(row); return { profile: spec.profile, modelProfile: spec.modelProfile };
    },
    incarnation: actor => incarnationOf(actor),
    confirmDead: actor => executions.confirmDead(`resident:${actor}`),
    revoke: actor => revoke?.(actor), hint() {}, failure: error => console.error("Native lifecycle test scope:", error),
    begin: (actor, _refs, authorize, prepared, signal) => executions.begin(`resident:${actor}`, () => runnerScope({
      executable: process.execPath, argv: ["-e", "setInterval(()=>{},1000)"], env: { PATH: "/usr/bin:/bin", HOME: root },
      timeoutMs: null, stdoutBytes: 4096, stderrBytes: 4096,
    }), signal, authorize, prepared),
  });
  return Object.assign(runtime, {
    bindIncarnationReader(reader: (actor: string) => number | null) { incarnationOf = reader; },
    bindRunRevoker(callback: (actor: string) => void) { revoke = callback; },
    scopeRoot: (actor: string) => {
      const identity = runtime.witness(actor);
      if (identity === null) return null;
      if (identity.kind === "darwin-audit-session") return { pid: identity.pid, startTime: String(identity.pidVersion) };
      return { pid: identity.pid, startTime: identity.startTime };
    }, runnerAlive: () => false,
    async readLogs(): Promise<never> { throw new StoreError("UNSUPPORTED_PROFILE", "lifecycle test has no product log store"); },
    attemptConcurrentExecution: (actor: string) => executions.run(`resident:${actor}`, runnerScope({
      executable: process.execPath, argv: ["-e", "process.exit(0)"], env: { PATH: "/usr/bin:/bin", HOME: root },
      timeoutMs: 5000, stdoutBytes: 4096, stderrBytes: 4096,
    }), undefined, () => {}),
    closeExecution: () => withAsyncCleanup(() => runtime.close(), () => executions.close()),
  });
}
export type NativeLifecycleExecution = Awaited<ReturnType<typeof nativeLifecycleExecution>>;
