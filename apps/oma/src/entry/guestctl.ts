import { receiptWaitFloor } from "../platform/guest/receipt-wait.js";
/** Guest control service (root): serves the host's control channel on the
 * unix socket the vsock bridge relays to (MAC-202, §4.4). */
import { readGuestIdentity, systemUser } from "../platform/guest/identity.js";
import { startGuestServer } from "../platform/guest/server.js";
import { GuestControl } from "../platform/guest/control.js";
import { linuxGuestSystem } from "@oma/platform-linux/guest-system";
import { PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { stopOnHostLoss } from "@oma/process/host-loss";

function argOf(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index > 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : fallback;
}

const socketPath = argOf("--socket", "/run/oma-guestctl/control.sock");
const dataDir = argOf("--data", "/var/lib/oma");
const imageManifest = argOf("--image", "/usr/lib/oma/image.json");
// Where the guest's `oma` keeps its state roots (XDG_DATA_HOME/oma).
const societiesDir = argOf("--societies", "/var/lib/oma/data/oma");
const system = linuxGuestSystem(dataDir, () => receiptWaitFloor(societiesDir));
// P0V-82, MAC-620: a freeze always ends -- and when the process that took it
// dies, its deadline timer dies with it. So whatever outlives this process
// ends it: systemd runs `--thaw` after every stop of this unit, however it
// stopped (ExecStopPost); each start thaws what a predecessor left; and this
// process ends its own freeze on every end it sees. A thaw of a filesystem
// that is not frozen is not an error.
if (process.argv.includes("--thaw")) { system.thaw(); process.exit(0); }
system.thaw();
const control = new GuestControl(system);
process.on("exit", () => { control.release(); });
stopOnHostLoss(() => { process.exit(0); });

startGuestServer({
  socketPath,
  bridge: systemUser("oma-bridge"),
  identity: () => readGuestIdentity(dataDir, imageManifest, ["control"]),
  channels: { control: { kind: "json", serve: ({ peer }) => control.serve(peer) } },
  frameBytes: PLATFORM_FRAME_BYTES,
  helloDeadlineMs: 5000,
  requestTimeoutMs: 60_000,
}).then(() => { console.error("guestctl listening"); }, error => {
  console.error(`guestctl: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
