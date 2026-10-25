/** Test-owned lifetime. Production supplies its lock before configuration/Store. */
import { dirname, join } from "node:path";
import type { ProtocolLimits } from "@oma/contracts";
import { REFERENCE_PROTOCOL_LIMITS } from "@oma/domain/protocol-limits";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { ProcessLock } from "@oma/native/process-lock";
import { createBroker, type BrokerComposition } from "#oma-test/app/broker/broker-composition";
import type { Broker } from "@oma/broker";
export function testBroker(input: Omit<BrokerComposition, "lock" | "limits"> & { limits?: ProtocolLimits }): Broker {
  ensureOwnedDirectory(input.paths.runRoot, dirname(input.paths.runRoot), 0o700);
  const lock = ProcessLock.acquire(join(input.paths.runRoot, "broker.lock"));
  let broker: Broker;
  try { broker = createBroker({ ...input, limits: input.limits ?? { ...REFERENCE_PROTOCOL_LIMITS }, lock }); }
  catch (error) { lock.close(); throw error; }
  const drain = broker.drainAndClose.bind(broker);
  let closing: Promise<void> | null = null;
  // The test owns this token, while the real Broker still owns its actual drain.
  // An uncompleted drain must keep the token held, as the production lifetime does.
  broker.drainAndClose = () => closing ??= drain().then(() => { lock.close(); });
  return broker;
}
