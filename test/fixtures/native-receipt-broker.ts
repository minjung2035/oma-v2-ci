/** Receipt/openRun policy over a real owned namespace. The test invokes the
 * server owner directly; this fixture does not authenticate a runner or
 * qualify G-AUTH. Kernel scope population, journal and cleanup are real. */
import { join } from "node:path";
import type { Broker } from "@oma/broker";
import type { RunLease } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { ViewsModule } from "#oma-test/app/views";
import { nativeLifecycleExecution } from "./native-lifecycle-execution.js";
import { testBroker } from "../helpers/broker-fixture.js";
import { TEST_VIEW_LIMITS } from "./limits.js";
import { withAsyncCleanup } from "@oma/native/cleanup";

export type NativeReceiptBroker = Broker & { openReceiptRun(label: string): Promise<RunLease> };
export async function nativeReceiptBroker(f: { root: string; store: Store; mail: MailModule }, actor = "alice"): Promise<NativeReceiptBroker> {
  const row = f.store.getAgent(actor);
  if (!row) throw new Error("receipt fixture has no accepted Resident");
  const units = await nativeLifecycleExecution(f.store, f.root);
  let ownedBroker: Broker | null = null;
  try {
  const spec = resolvedSpecOf(row); units.ensureResident(actor, spec.profile, spec.modelProfile);
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos/project.git"),
    society: "demo", hasGoal: () => true, activationAllowed: () => true }, () => { throw new Error("receipt fixture cannot create agents"); }, f.mail);
  const broker = testBroker({ store: f.store, mail: f.mail, units,
    views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle,
    git: null, reviews: null, reconcile: null,
    paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  ownedBroker = broker;
  const drain = broker.drainAndClose.bind(broker);
  broker.drainAndClose = async () => { await units.closeExecution(); await drain(); };
  let current: string | null = null;
  const result = Object.assign(broker, { async openReceiptRun(label: string): Promise<RunLease> {
    if (current !== null && current !== label) {
      // The real execution journal must refuse a replacement while the
      // previous namespace is populated. A label cannot invent a new UUID.
      await units.attemptConcurrentExecution(actor);
      throw new Error("a replacement was admitted while the previous namespace was live");
    }
    if (current === null) { await units.start(actor, true); current = label; }
    const invocation = units.observe(actor).invocationId;
    return (Reflect.get(broker, "openRun") as (actor: string, invocation: string) => Promise<RunLease>).call(broker, actor, invocation);
  } });
  await broker.start(); return result;
  } catch (error) {
    return withAsyncCleanup(async () => { throw error; }, () => ownedBroker ? ownedBroker.drainAndClose() : units.closeExecution());
  }
}
