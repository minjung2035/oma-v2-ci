import test from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { PiAdapter } from "../src/runtime/pi-adapter.js";
import { planPiSpawn } from "../src/runtime/pi-spawn-plan.js";
import { RESIDENT_ENVIRONMENT, RESIDENT_PATHS, SYSTEM_BIND_CANDIDATES, residentArgv } from "../src/sandbox.js";
import { hostSystemLayout, prepareResidentRootfs } from "../src/runtime/resident-rootfs.js";
import { spawnSandboxed } from "../src/process/async.js";
import { validateConfig } from "../src/config.js";
import { defaultHostConfig } from "../src/config/defaults.js";
import { prepareResident, residentOptions, RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";

const SUPPORT_PATHS = ["/etc/resolv.conf", "/etc/ssl/certs", "/etc/pki/ca-trust", "/etc/pki/tls/certs", "/etc/nsswitch.conf", "/etc/hosts", "/etc/localtime"];

test("F36: optional system binds are closed, absence-gated, and include symlink targets", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-system-layout-"));
  try {
    mkdirSync(join(root, "usr"));
    assert.deepEqual(hostSystemLayout(root).binds, ["/usr"]);
    mkdirSync(join(root, "etc/ssl/certs"), { recursive: true });
    for (const path of ["/etc/resolv.conf", "/etc/nsswitch.conf", "/etc/hosts", "/etc/localtime"]) {
      writeFileSync(join(root, path + ".target"), "static");
      symlinkSync(join(root, path + ".target"), join(root, path));
    }
    symlinkSync(join(root, "missing"), join(root, "etc/ld.so.cache"));
    const layout = hostSystemLayout(root);
    for (const path of SUPPORT_PATHS) assert.ok(SYSTEM_BIND_CANDIDATES.includes(path), path);
    for (const path of ["/etc/resolv.conf", "/etc/ssl/certs", "/etc/nsswitch.conf", "/etc/hosts", "/etc/localtime"]) assert.ok(layout.binds.includes(path), path);
    assert.equal(layout.binds.includes("/etc/ld.so.cache"), false);
    assert.deepEqual(layout.links, []);
    assert.equal(layout.binds.includes("/etc/passwd"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("F34/F35: explicit entries cannot override the normalized base environment", () => {
  const options = residentOptions("/state");
  const { host, lease, directories } = options.confinement;
  const argv = residentArgv(host, lease, directories, { HOME: "/host/home", PATH: "/host/bin", LANG: "host", USER: "root" });
  for (const [name, value] of Object.entries(RESIDENT_ENVIRONMENT)) assert.equal(argv[argv.lastIndexOf(name) + 1], value);
  assert.throws(() => residentArgv(host, lease, directories, { HOME: "bad\0value" }), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => residentArgv({ ...host, systemBinds: ["/etc/shadow"] }, lease, directories), { code: "UNSUPPORTED_PROFILE" });
});

test("U1: config validation and Resident plans reject missing confinement and host-root profiles", () => {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), rootfs: "/rootfs", deploymentDigest: "a".repeat(64) });
  for (const rootfs of ["/", "relative", "/state/../rootfs", "/rootfs\0"])
    assert.throws(() => validateConfig({ ...config, installation: { ...config.installation, rootfs } }), { code: "UNSUPPORTED_PROFILE" });
  const options = residentOptions("/state");
  assert.throws(() => planPiSpawn({ ...options, confinement: undefined } as never), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => planPiSpawn({ ...options, confinement: { ...options.confinement, host: { ...options.confinement.host, rootfs: "/" } } }), { code: "UNSUPPORTED_PROFILE" });
});

test("F34/F35/F36 live: locale, identity, temp, user-local PATH and support files work without host env or network", RESIDENT_TEST_OPTIONS, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-env-live-"));
  let child: ReturnType<typeof spawnSandboxed> | undefined;
  try {
    const options = residentOptions(root, process.cwd(), join(process.cwd(), "dist/src/cli.js"));
    prepareResident(options);
    const bin = join(options.paths.agentHome, ".local/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "local-probe"), "#!/bin/sh\nprintf local-ok\n", { mode: 0o700 });
    const layout = hostSystemLayout();
    const targets = layout.binds.filter(path => SUPPORT_PATHS.includes(path));
    const before = targets.filter(path => statSync(path).isFile()).map(path => [path, readFileSync(path).toString("base64")] as const);
    const plan = new PiAdapter(options).spawnPlan();
    for (const path of targets) {
      const at = plan.args.indexOf(path);
      assert.deepEqual(plan.args.slice(at - 1, at + 2), ["--ro-bind", path, path]);
      assert.equal(lstatSync(join(options.confinement.host.rootfs, path)).isSymbolicLink(), false);
    }
    const body = `
      const fs = require('fs'), cp = require('child_process');
      const paths = ${JSON.stringify(targets)};
      const files = paths.map(path => { let writable = false; try { fs.accessSync(path, fs.constants.W_OK); writable = true; } catch {} return [path, writable]; });
      console.log(JSON.stringify({ env: process.env, user: require('os').userInfo(), files,
        locale: cp.execFileSync('/usr/bin/locale', ['charmap'], { encoding: 'utf8' }).trim(),
        local: cp.execFileSync('/bin/sh', ['-c', 'local-probe'], { encoding: 'utf8' }),
        routes: fs.readFileSync('/proc/net/route', 'utf8').trim().split('\\n').length,
        modes: ['XDG_DATA_HOME', 'XDG_RUNTIME_DIR'].map(key => fs.statSync(process.env[key]).mode & 511),
        tmp: (() => { fs.writeFileSync(process.env.TMPDIR + '/probe', 'temp'); return fs.readFileSync('/tmp/probe', 'utf8'); })() }));
    `;
    child = spawnSandboxed([plan.command, ...plan.args.slice(0, plan.args.lastIndexOf("--") + 1), RESIDENT_PATHS.node, "-e", body], plan.env, plan.filter, plan.cwd);
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += String(chunk); }); child.stderr.on("data", chunk => { err += String(chunk); });
    const [code] = await once(child, "close");
    assert.equal(code, 0, err);
    const report = JSON.parse(out);
    for (const [key, value] of Object.entries(RESIDENT_ENVIRONMENT)) assert.equal(report.env[key], value, key);
    for (const key of ["DBUS_SESSION_BUS_ADDRESS", "SSH_AUTH_SOCK", "DISPLAY", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS"]) assert.equal(report.env[key], undefined, key);
    assert.equal(report.user.username, "agent"); assert.equal(report.user.shell, "/bin/sh");
    assert.equal(report.locale, "UTF-8"); assert.equal(report.local, "local-ok"); assert.equal(report.tmp, "temp");
    assert.deepEqual(report.modes, [0o700, 0o700]);
    assert.equal(report.routes, 1);
    assert.ok(report.files.every(([, writable]: [string, boolean]) => !writable));
    for (const [path, bytes] of before) assert.equal(readFileSync(path).toString("base64"), bytes);
    const first = prepareResidentRootfs(options.confinement.host.rootfs, layout, process.getuid!(), process.getgid!());
    assert.deepEqual(first.deferred, []); assert.deepEqual(first.corrected, []);
  } finally { child?.kill("SIGKILL"); rmSync(root, { recursive: true, force: true }); }
});
