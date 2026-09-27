/** Guest host service (the oma user): the society and terminal channels on
 * the unix socket the vsock bridge relays to (MAC-202, §4.5, §4.6). */
import { join } from "node:path";
import { readGuestIdentity, systemUser } from "../platform/guest/identity.js";
import { startGuestServer } from "../platform/guest/server.js";
import { GuestHost } from "../platform/guest/host.js";
import { systemdSessionLauncher } from "../platform/guest/systemd-launcher.js";
import { PLATFORM_FRAME_BYTES } from "../protocol/host-guest.js";

function argOf(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index > 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : fallback;
}

const socketPath = argOf("--socket", "/run/oma-guesthost/society.sock");
const dataDir = argOf("--data", "/var/lib/oma");
const imageManifest = argOf("--image", "/usr/lib/oma/image.json");
const libdir = argOf("--libdir", "/usr/lib/oma");
const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/run/user/1000";
const dataHome = process.env.XDG_DATA_HOME ?? join(dataDir, "data");

const host = new GuestHost({
  societiesDir: join(dataHome, "oma"),
  projectsDir: join(dataDir, "projects"),
  stopDeadlineMs: 150_000,
  launcher: systemdSessionLauncher({
    sessionsDir: runtimeDir,
    node: process.execPath,
    libdir,
    env: {
      HOME: process.env.HOME ?? join(dataDir, "home"),
      XDG_DATA_HOME: dataHome,
      XDG_RUNTIME_DIR: runtimeDir,
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      ...(process.env.DBUS_SESSION_BUS_ADDRESS === undefined ? {} : { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }),
    },
  }),
});

startGuestServer({
  socketPath,
  bridge: systemUser("oma-bridge"),
  identity: () => readGuestIdentity(dataDir, imageManifest, ["society", "terminal"]),
  channels: {
    society: { kind: "json", serve: ({ peer }) => host.serve(peer) },
    terminal: { kind: "bytes", serve: (socket, hello) => host.terminal(socket, hello) },
  },
  frameBytes: PLATFORM_FRAME_BYTES,
  helloDeadlineMs: 5000,
  requestTimeoutMs: 60_000,
}).then(() => { console.error("guesthost listening"); }, error => {
  console.error(`guesthost: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
