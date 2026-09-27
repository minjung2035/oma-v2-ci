/** Guest control service (root): serves the host's control channel on the
 * unix socket the vsock bridge relays to (MAC-202, §4.4). */
import { readGuestIdentity, systemUser } from "../platform/guest/identity.js";
import { startGuestServer } from "../platform/guest/server.js";
import { GuestControl } from "../platform/guest/control.js";
import { linuxGuestSystem } from "../platform/guest/linux-system.js";
import { PLATFORM_FRAME_BYTES } from "../protocol/host-guest.js";

function argOf(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index > 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : fallback;
}

const socketPath = argOf("--socket", "/run/oma-guestctl/control.sock");
const dataDir = argOf("--data", "/var/lib/oma");
const imageManifest = argOf("--image", "/usr/lib/oma/image.json");
// Where the guest's `oma` keeps its state roots (XDG_DATA_HOME/oma).
const societiesDir = argOf("--societies", "/var/lib/oma/data/oma");
const control = new GuestControl(linuxGuestSystem(dataDir, societiesDir));

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
