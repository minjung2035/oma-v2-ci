// PR-002/UNIT-TPL-003: call the existing broker, never a model.
import { join } from "node:path";
import { BrokerChannel } from "@oma/client/channel";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { launchedPath } from "../runtime/assets.js";

function usage(): never {
  console.error("usage: host.js principal-relay --society <name> --run-root <dir>");
  process.exit(4);
}
const args = process.argv.slice(2);
const mode = args[0]; const societyIdx = args.indexOf("--society");
if (mode !== "principal-relay" || societyIdx < 0 || !args[societyIdx + 1]) usage();
const society = args[societyIdx + 1]!;
if (!isValidSocietyName(society)) usage();
// D03: the broker this unit calls is the one at the rendered run root.
let runRoot: string;
try { runRoot = launchedPath(args, "runRoot", society); }
catch (error) { console.error(`host: ${error instanceof Error ? error.message : String(error)}`); usage(); }
async function main(): Promise<void> {
  const channel = new BrokerChannel();
  try {
    await channel.connect(join(runRoot, "host.sock"));
    const reply = await channel.call("host.principalRelay", {});
    if (!reply.ok) {
      console.error(`host ${mode} failed: ${reply.error.code} ${reply.error.message}`);
      process.exitCode = 2; return;
    }
    console.log(JSON.stringify(reply.result));
  } finally { channel.close(); }
}
main().catch((error: unknown) => {
  console.error(`host ${mode}: broker unavailable: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 3;
});
