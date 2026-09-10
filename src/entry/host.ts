// MUST [PR-002]/[REC-002]/[UNIT-TPL-003]: call the existing broker, never a model.
import { join } from "node:path";
import { BrokerChannel } from "../runner.js";
import { isValidSocietyName } from "../ids.js";

function usage(): never {
  console.error("usage: host.js <principal-relay|reconcile> --society <name>");
  process.exit(4);
}

const args = process.argv.slice(2);
const mode = args[0];
const societyIdx = args.indexOf("--society");
if ((mode !== "principal-relay" && mode !== "reconcile") || societyIdx < 0 || !args[societyIdx + 1]) usage();
const society = args[societyIdx + 1]!;
if (!isValidSocietyName(society)) usage();
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);

async function main(): Promise<void> {
  const channel = new BrokerChannel();
  try {
    await channel.connect(join(runRoot, "host.sock"));
    const reply = await channel.call(mode === "principal-relay" ? "host.principalRelay" : "host.reconcile", {});
    if (!reply.ok) {
      console.error(`host ${mode} failed: ${reply.error?.code ?? "ERROR"} ${reply.error?.message ?? ""}`);
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(reply.result ?? {}));
  } finally { channel.close(); }
}

main().catch((error: unknown) => {
  console.error(`host ${mode}: broker unavailable: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 3;
});
