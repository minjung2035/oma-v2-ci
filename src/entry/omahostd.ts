/** omahostd: the Mac's host service, a LaunchAgent (macos-platform §2.1).
 *
 * usage: omahostd.js --bundle <OMA.app>
 *
 * Everything decided here is decided in the modules it composes; this entry
 * only knows where things are on a Mac: the app bundle (the image, the
 * release key, the VM helper) and the support directory. macOS only; it is
 * typechecked everywhere and run on a Mac (the mac-vm lane).
 */
import { chmodSync, closeSync, constants, ftruncateSync, mkdirSync, openSync, statSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyImage, bootableWith } from "../platform/host/image.js";
import { VzDriver } from "../platform/host/vz-driver.js";
import { HostService } from "../platform/host/service.js";
import { hostResolver } from "../platform/host/resolver.js";
import { newHostRecord, readHostRecord, writeHostRecord } from "../platform/host/record.js";
import { HOST_GUEST_PROTOCOL } from "../protocol/host-guest.js";
import { HOST_LOSS_SIGNALS } from "../runtime/broker-lifetime.js";

const STATE_DISK_BYTES = 64 * 1024 ** 3;
const GIB = 1024 ** 3;

function fail(message: string): never { process.stderr.write(`omahostd: ${message}\n`); process.exit(2); }
const at = process.argv.indexOf("--bundle");
const bundle = at > 0 ? process.argv[at + 1] : undefined;
if (bundle === undefined) fail("usage: omahostd.js --bundle <OMA.app>");
if (process.platform !== "darwin") fail("omahostd runs on macOS");

// Where the host keeps its own files, from the environment as the Linux entry
// takes its XDG directories; the user's other state is never looked at.
const userHome = process.env.HOME;
if (process.env.OMA_HOST_HOME === undefined && (userHome === undefined || !userHome.startsWith("/"))) fail("HOME is not set");
const home = process.env.OMA_HOST_HOME ?? join(userHome!, "Library", "Application Support", "OMA");
const dirs = { run: join(home, "run"), vm: join(home, "vm"), engine: join(home, "engine"), logs: join(home, "logs"), archives: join(home, "archives") };
for (const dir of [home, ...Object.values(dirs), join(dirs.run, "vm")]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); }
const recordPath = join(home, "host-record.json");
const record = readHostRecord(recordPath) ?? (() => { const fresh = newHostRecord(); writeHostRecord(recordPath, fresh); return fresh; })();

async function main(): Promise<void> {
  const releaseKey = createPublicKey(readFileSync(join(bundle!, "Contents", "Resources", "release-key.pem")));
  const version = readFileSync(join(bundle!, "Contents", "Resources", "guest", "current"), "utf8").trim();
  const image = await verifyImage(join(bundle!, "Contents", "Resources", "guest", version), releaseKey,
    { min: Math.max(1, HOST_GUEST_PROTOCOL - 1), max: HOST_GUEST_PROTOCOL });
  bootableWith(image, record.highestSchemaWritten);

  // The state disk: sparse, and made only once (MAC-303).
  const statePath = join(dirs.vm, "state.img");
  try { const fd = openSync(statePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); ftruncateSync(fd, STATE_DISK_BYTES); closeSync(fd); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const neverWritten = statSync(statePath).blocks === 0;
  const provision = record.provisioning === "pending" && neverWritten;

  const cmdline = [`console=hvc0`, `ro`, `roothash=${image.verityRoot}`, `oma.instance=${record.instanceId}`,
    ...(provision ? [`oma.provision=${record.instanceId}`] : [])].join(" ");
  const driver = VzDriver.launch({ executable: join(bundle!, "Contents", "MacOS", "oma-vmhelper"), argv: [], env: { PATH: "/usr/bin:/bin" } },
    join(dirs.run, "vm"), {
      kernel: image.paths.kernel, initrd: image.paths.initrd, cmdline,
      disks: [{ path: image.paths.system, readOnly: true }, { path: image.paths.verity, readOnly: true }, { path: statePath, readOnly: false }],
      cpus: 4, memoryBytes: 4 * GIB, consoleLog: join(dirs.logs, "guest-console.log"), ports: [700, 701],
    });
  const service = await HostService.start({
    runDir: dirs.run, recordPath, driver, uid: process.getuid!(), git: join(bundle!, "Contents", "Resources", "git", "bin", "git"),
    archivesDir: dirs.archives, keychain: driver,
    identity: { hostVersion: process.env.OMA_APP_VERSION ?? "0.0.0", installationId: record.installationId, instanceId: record.instanceId,
      expectImage: image.version, protocol: { min: Math.max(1, HOST_GUEST_PROTOCOL - 1), max: HOST_GUEST_PROTOCOL } },
    resolve: hostResolver(dirs.engine, driver),
    power: listener => { driver.onPower(listener); },
    statePath,
  });
  service.lifecycle.onState(state => {
    if (state !== "ready") return;
    const current = readHostRecord(recordPath);
    if (current === null) return;
    writeHostRecord(recordPath, { ...current, image: { current: image.version, previous: current.image.current === image.version ? current.image.previous : current.image.current },
      highestSchemaWritten: Math.max(current.highestSchemaWritten ?? 0, image.stateSchema.written) });
  });
  // MAC-321: launchd's SIGTERM at logout, restart or update -- and, AV31 and
  // P0V-81, every other way this process is asked to end.
  let ending = false;
  for (const signal of HOST_LOSS_SIGNALS) process.on(signal, () => {
    if (ending) return;
    ending = true;
    void service.shutdown().finally(() => { driver.close(); process.exit(0); });
  });
}
main().catch(error => { fail(error instanceof Error ? error.message : String(error)); });
