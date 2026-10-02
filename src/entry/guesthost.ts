/** Guest host service (the oma user): the society and terminal channels on
 * the unix socket the vsock bridge relays to (MAC-202, §4.5, §4.6). */
import { join } from "node:path";
import { readGuestIdentity, systemUser } from "../platform/guest/identity.js";
import { startGuestServer } from "../platform/guest/server.js";
import { GuestHost } from "../platform/guest/host.js";
import { systemdSessionLauncher } from "../platform/guest/systemd-launcher.js";
import { EgressPool, startEgressService } from "../platform/guest/egress.js";
import { RequestLedger } from "../platform/guest/requests.js";
import { GuestProjects } from "../platform/guest/project.js";
import { serveStream } from "../platform/guest/stream.js";
import { GuestArchives } from "../platform/guest/archive.js";
import { GuestPackages } from "../platform/guest/packages.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { listening } from "../platform/guest/host.js";
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

const ledger = new RequestLedger(join(dataDir, "requests"));
const projects = new GuestProjects(join(dataDir, "projects"), join(dataHome, "oma"), ledger);
const sessionsDir = runtimeDir;
const archives = new GuestArchives(join(dataHome, "oma"), ledger, society => listening(join(sessionsDir, `${society}.sock`)));
// DR25: the engine's processes run as the society sessions do.
const engineEnv = {
  HOME: process.env.HOME ?? join(dataDir, "home"),
  XDG_DATA_HOME: dataHome,
  XDG_RUNTIME_DIR: runtimeDir,
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
};
const packages = new GuestPackages({ ledger, projects, dataDir: join(dataHome, "oma"), libdir, node: process.execPath,
  entry: join(libdir, DEPLOYMENT_LAYOUT.entries.guestPackages), env: engineEnv, timeoutMs: 10 * 60_000 });
const host = new GuestHost({
  archives, packages,
  societiesDir: join(dataHome, "oma"),
  projectsDir: join(dataDir, "projects"),
  projects, ledger,
  stopDeadlineMs: 150_000,
  launcher: systemdSessionLauncher({
    sessionsDir: runtimeDir,
    node: process.execPath,
    libdir,
    env: {
      ...engineEnv,
      ...(process.env.DBUS_SESSION_BUS_ADDRESS === undefined ? {} : { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }),
    },
  }),
});

// §4.7: the host's pooled egress connections, and the socket the guest's own
// processes ask for them on.
const egress = new EgressPool();
startEgressService({ socketPath: join(runtimeDir, "oma-egress.sock"), pool: egress, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 30_000 })
  .catch(error => { console.error(`guesthost: egress: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });

startGuestServer({
  socketPath,
  bridge: systemUser("oma-bridge"),
  identity: () => readGuestIdentity(dataDir, imageManifest, ["society", "terminal", "egress", "stream"]),
  channels: {
    society: { kind: "json", serve: ({ peer }) => host.serve(peer) },
    terminal: { kind: "bytes", serve: (socket, hello) => host.terminal(socket, hello) },
    egress: { kind: "bytes", serve: socket => { egress.park(socket); } },
    stream: { kind: "bytes", serve: socket => { void serveStream(socket, { ledger, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 60_000,
      reserveBytes: 1024 ** 3, dataDir }); } },
  },
  frameBytes: PLATFORM_FRAME_BYTES,
  helloDeadlineMs: 5000,
  requestTimeoutMs: 60_000,
}).then(() => { console.error("guesthost listening"); }, error => {
  console.error(`guesthost: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
