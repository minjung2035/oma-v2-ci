import { SYSTEM_BIND_CANDIDATES } from "@oma/platform-linux/resident-rootfs";
import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { PiAdapter } from "@oma/engine/pi-adapter";
import { planPiSpawn, type PiAdapterOptions } from "@oma/engine/pi-spawn-plan";
import { RESIDENT_ENVIRONMENT, RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { hostSystemLayout, prepareResidentRootfs, residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { validateConfig } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";
import { RunnerModule, type RunnerProfile } from "#oma-test/app/runner";
import { candidateSandbox } from "@oma/platform-linux/candidate-sandbox";
import { prepareResident, residentOptions, RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
/** The confined environment a plan sets, read back from its argv. */
function planEnvironment(args: readonly string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 1)
        if (args[index] === "--setenv")
            env[args[index + 1]!] = args[index + 2]!;
    return env;
}
/** The pinned Node's installation prefix: `<prefix>/bin/node`. */
const prefixOf = (node: string): string => dirname(dirname(node));
/** The package-manager commands a Worker is told it has (`npm test`), as the
 * pinned Node's own distribution lays them out: `<prefix>/bin/<command>` a
 * link to `<prefix>/lib/node_modules/<module>/<entry>`. An independent
 * oracle -- the production table is not read here. */
const TOOLCHAIN = [["npm", "npm", "bin/npm-cli.js"], ["npx", "npm", "bin/npx-cli.js"], ["corepack", "corepack", "dist/corepack.js"]] as const;
const FOUR_GIB = 4 * 1024 ** 3;
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
        for (const path of SUPPORT_PATHS)
            assert.ok(SYSTEM_BIND_CANDIDATES.includes(path), path);
        for (const path of ["/etc/resolv.conf", "/etc/ssl/certs", "/etc/nsswitch.conf", "/etc/hosts", "/etc/localtime"])
            assert.ok(layout.binds.includes(path), path);
        assert.equal(layout.binds.includes("/etc/ld.so.cache"), false);
        assert.deepEqual(layout.links, []);
        assert.equal(layout.binds.includes("/etc/passwd"), false);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("F34/F35: explicit entries cannot override the normalized base environment", () => {
    const options = residentOptions("/state");
    const { host, lease, directories } = options.confinement;
    const argv = residentArgv(host, lease, directories, [], { HOME: "/host/home", PATH: "/host/bin", LANG: "host", USER: "root" });
    for (const [name, value] of Object.entries(RESIDENT_ENVIRONMENT))
        assert.equal(argv[argv.lastIndexOf(name) + 1], value);
    assert.throws(() => residentArgv(host, lease, directories, [], { HOME: "bad\0value" }), { code: "UNSUPPORTED_PROFILE" });
    assert.throws(() => residentArgv(host, lease, directories, ["/etc/shadow"]), { code: "UNSUPPORTED_PROFILE" });
});
test("U1: config validation and Resident plans reject missing confinement and host-root profiles", () => {
    const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(),  deploymentDigest: "a".repeat(64) });
    for (const rootfs of ["/", "relative", "/state/../rootfs", "/rootfs\0"])
        assert.throws(() => validateConfig({ ...config, installation: { ...config.installation, rootfs } }), { code: "INVALID_REQUEST" });
    const options = residentOptions("/state");
    assert.throws(() => planPiSpawn(residentEngineEffects.sandbox, { ...options, confinement: undefined } as never), { code: "UNSUPPORTED_PROFILE" });
    assert.throws(() => planPiSpawn(residentEngineEffects.sandbox, { ...options, confinement: { ...options.confinement, host: { ...options.confinement.host, rootfs: "/" } as never } }), { code: "UNSUPPORTED_PROFILE" });
});
test("F34/F35/F36 live: locale, identity, temp, user-local PATH and support files work without host env or network", RESIDENT_TEST_OPTIONS, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-env-live-"));
    let child: ReturnType<typeof spawnSandboxed> | undefined;
    try {
        const options = residentOptions(root, process.cwd(), join(process.cwd(), "apps/oma/dist/cli.js"));
        prepareResident(options);
        const bin = join(options.paths.agentHome, ".local/bin");
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, "local-probe"), "#!/bin/sh\nprintf local-ok\n", { mode: 0o700 });
        const layout = hostSystemLayout();
        const targets = layout.binds.filter(path => SUPPORT_PATHS.includes(path));
        const before = targets.filter(path => statSync(path).isFile()).map(path => [path, readFileSync(path).toString("base64")] as const);
        const plan = new PiAdapter(residentEngineEffects, options).spawnPlan();
        for (const path of targets) {
            const at = plan.args.indexOf(path);
            assert.deepEqual(plan.args.slice(at - 1, at + 2), ["--ro-bind", path, path]);
            assert.equal(lstatSync(join(residentRootfsPath(options.confinement.host.stateRoot!), path)).isSymbolicLink(), false);
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
        child = spawnSandboxed([plan.command, ...plan.args.slice(0, plan.args.lastIndexOf("--") + 1), RESIDENT_PATHS.node, "-e", body], plan.env, plan.input, plan.cwd);
        let out = "", err = "";
        child.stdout.on("data", chunk => { out += String(chunk); });
        child.stderr.on("data", chunk => { err += String(chunk); });
        const [code] = await once(child, "close");
        assert.equal(code, 0, err);
        const report = JSON.parse(out);
        for (const [key, value] of Object.entries(RESIDENT_ENVIRONMENT))
            assert.equal(report.env[key], value, key);
        // A host's NODE_OPTIONS must still be refused, but oma deliberately sets
        // its own -- w10 loads the in-process client preload through it.
        for (const key of ["DBUS_SESSION_BUS_ADDRESS", "SSH_AUTH_SOCK", "DISPLAY", "NODE_EXTRA_CA_CERTS"])
            assert.equal(report.env[key], undefined, key);
        assert.match(report.env.NODE_OPTIONS ?? "", /^--import=file:\/\/.*runtime\/client-preload\.js$/, "NODE_OPTIONS is oma's preload, nothing else");
        assert.equal(report.user.username, "agent");
        assert.equal(report.user.shell, "/bin/sh");
        assert.equal(report.locale, "UTF-8");
        assert.equal(report.local, "local-ok");
        assert.equal(report.tmp, "temp");
        assert.deepEqual(report.modes, [0o700, 0o700]);
        assert.ok(report.routes > 1, "the sandbox shares the host network");
        assert.ok(report.files.every(([, writable]: [
            string,
            boolean
        ]) => !writable));
        for (const [path, bytes] of before)
            assert.equal(readFileSync(path).toString("base64"), bytes);
        const first = prepareResidentRootfs(residentRootfsPath(options.confinement.host.stateRoot!), layout, process.getuid!(), process.getgid!());
        assert.deepEqual(first.deferred, []);
        assert.deepEqual(first.corrected, []);
    }
    finally {
        child?.kill("SIGKILL");
        rmSync(root, { recursive: true, force: true });
    }
});
test("FI-1: a Resident's Git commits as its actor, and no Git flow waits on an editor or a prompt", () => {
    // Static: no editor anywhere a merge, rebase or amend would look for one,
    // and Git never asks a terminal for credentials it cannot have.
    for (const [name, value] of [["GIT_EDITOR", ":"], ["EDITOR", ":"], ["VISUAL", ":"], ["GIT_TERMINAL_PROMPT", "0"]] as const)
        assert.equal((RESIDENT_ENVIRONMENT as Record<string, string>)[name], value, name);
    // Per actor: the identity is the address the actor's mail carries.
    const env = planEnvironment(planPiSpawn(residentEngineEffects.sandbox, residentOptions("/state")).args);
    assert.deepEqual([env.GIT_AUTHOR_NAME, env.GIT_AUTHOR_EMAIL, env.GIT_COMMITTER_NAME, env.GIT_COMMITTER_EMAIL], ["alice", "alice@demo.oma.invalid", "alice", "alice@demo.oma.invalid"]);
    for (const name of ["GIT_EDITOR", "EDITOR", "VISUAL", "GIT_TERMINAL_PROMPT"])
        assert.equal(env[name], (RESIDENT_ENVIRONMENT as Record<string, string>)[name], name);
});
test("FI-2: the pinned Node's npm, npx and corepack are mounted and linked beside it", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-toolchain-"));
    try {
        const options = residentOptions(root);
        const node = "/pinned/node-v24/bin/node";
        const args = planPiSpawn(residentEngineEffects.sandbox, { ...options, confinement: { ...options.confinement, host: { ...options.confinement.host, node } } }).args;
        // Each module the toolchain reaches is bound read-only from the pinned
        // Node's own prefix, `-try` because a distribution Node may package npm
        // elsewhere (then the rootfs link falls through PATH to /usr/bin).
        for (const module of new Set(TOOLCHAIN.map(([, module]) => module))) {
            const target = `/opt/oma-node/lib/node_modules/${module}`;
            const at = args.indexOf(target);
            assert.ok(at > 0, `${module} is not mounted`);
            assert.deepEqual(args.slice(at - 2, at + 1), ["--ro-bind-try", `${prefixOf(node)}/lib/node_modules/${module}`, target]);
        }
        const env = planEnvironment(args);
        const path = env.PATH!.split(":");
        assert.ok(path.indexOf("/opt/oma-node") >= 0 && path.indexOf("/opt/oma-node") < path.indexOf("/usr/bin"), "the pinned Node's commands win over the host's");
        // The rootfs carries the links and the empty mount targets, as the
        // official distribution's `bin/` does.
        const rootfs = residentRootfsPath(options.confinement.host.stateRoot!);
        prepareResidentRootfs(rootfs, hostSystemLayout(), process.getuid!(), process.getgid!());
        for (const [command, module, entry] of TOOLCHAIN) {
            assert.equal(readlinkSync(join(rootfs, "opt/oma-node", command)), `lib/node_modules/${module}/${entry}`, command);
            assert.ok(statSync(join(rootfs, "opt/oma-node/lib/node_modules", module)).isDirectory(), `${module} mount target`);
        }
        // A second start writes nothing (REC-007).
        assert.deepEqual(prepareResidentRootfs(rootfs, hostSystemLayout(), process.getuid!(), process.getgid!()), { deferred: [], corrected: [] });
        // An integration check runs the same toolchain (`npm test` as a check argv).
        const check = candidateSandbox({ rootfs: "/rootfs", node, libdir: "/checks" }, "a".repeat(40), { id: "npm", argv: ["npm", "test"], env: {},  }, []).argv;
        const at = check.indexOf("/opt/oma-node/lib/node_modules/npm");
        assert.deepEqual(check.slice(at - 2, at + 1), ["--ro-bind-try", `${prefixOf(node)}/lib/node_modules/npm`, "/opt/oma-node/lib/node_modules/npm"]);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("FI-2: the toolchain contract -- this host's pinned Node ships the commands a Worker is promised", () => {
    // The image-side half of the contract: the deployment's Node (here, the
    // Node running OMA) carries npm/npx/corepack in its own prefix, or the
    // operating system's /usr/bin does. A deployment that satisfies neither
    // cannot run the `npm test` the Worker prompt names.
    const node = realpathSync(process.execPath);
    for (const [command, module, entry] of TOOLCHAIN)
        assert.ok(existsSync(join(prefixOf(node), "lib/node_modules", module, entry)) || existsSync(join("/usr/bin", command)), `${command}: neither ${prefixOf(node)}/lib/node_modules/${module}/${entry} nor /usr/bin/${command}`);
});


test("FI-1/2/5 live: a Worker commits, amends, rebases and merges without -c flags or an editor, and runs npm/npx", RESIDENT_TEST_OPTIONS, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-dev-live-"));
    let child: ReturnType<typeof spawnSandboxed> | undefined;
    try {
        const options = residentOptions(root, process.cwd(), join(process.cwd(), "apps/oma/dist/cli.js"));
        prepareResident(options);
        const plan = new PiAdapter(residentEngineEffects, { ...options, profile: { ...options.profile } } as PiAdapterOptions).spawnPlan();
        // `timeout` bounds each step a missing editor would hang; 124 is that hang.
        const script = [
            "set -u", "out() { printf '%s=%s\\n' \"$1\" \"$2\"; }",
            "cd /workspace && git init -q -b main repo && cd repo",
            "printf 'one\\n' > f && git add f",
            "timeout 20 git commit -q -m first </dev/null >/dev/null 2>&1; out commit $?",
            "out identity \"$(git log -1 --format='%an <%ae>|%cn <%ce>' 2>/dev/null)\"",
            "timeout 20 git commit -q --amend </dev/null >/dev/null 2>&1; out amend $?",
            "git checkout -q -b topic && printf 'topic\\n' > f && git commit -q -am topic >/dev/null 2>&1",
            "git checkout -q main && printf 'main\\n' > f && git commit -q -am main >/dev/null 2>&1",
            "git checkout -q topic && git rebase -q main >/dev/null 2>&1; out conflict $?",
            "printf 'resolved\\n' > f && git add f",
            "timeout 20 git rebase --continue </dev/null >/dev/null 2>&1; out rebase $?",
            "git checkout -q main && timeout 20 git merge -q --no-ff topic </dev/null >/dev/null 2>&1; out merge $?",
            "out npm \"$(command -v npm)\"",
            "out npmVersion \"$(timeout 60 npm --version 2>/dev/null)\"",
            "out npxVersion \"$(timeout 60 npx --version 2>/dev/null)\"",
            "out corepackVersion \"$(timeout 60 corepack --version 2>/dev/null)\"",
            "out cpus \"${OMA_CPUS-unset}\"",
        ].join("\n");
        child = spawnSandboxed([plan.command, ...plan.args.slice(0, plan.args.lastIndexOf("--") + 1), "/bin/sh", "-c", script], plan.env, plan.input, plan.cwd);
        let out = "", err = "";
        child.stdout.on("data", chunk => { out += String(chunk); });
        child.stderr.on("data", chunk => { err += String(chunk); });
        const [code] = await once(child, "close");
        assert.equal(code, 0, err);
        const report = Object.fromEntries(out.trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
        assert.equal(report.commit, "0", "a plain `git commit` needs no -c user.*");
        assert.equal(report.identity, "alice <alice@demo.oma.invalid>|alice <alice@demo.oma.invalid>");
        assert.equal(report.amend, "0", "an amend keeps its message instead of waiting on vi");
        assert.notEqual(report.conflict, "0", "the fixture rebase must stop on a conflict");
        assert.equal(report.rebase, "0", "rebase --continue keeps the message instead of waiting on vi");
        assert.equal(report.merge, "0");
        assert.equal(report.npm, "/opt/oma-node/npm", "npm is the pinned Node's");
        assert.match(report.npmVersion ?? "", /^\d+\.\d+\.\d+$/);
        assert.match(report.npxVersion ?? "", /^\d+\.\d+\.\d+$/);
        assert.match(report.corepackVersion ?? "", /^\d+\.\d+\.\d+$/);
        assert.equal(report.cpus, "unset");
    }
    finally {
        child?.kill("SIGKILL");
        rmSync(root, { recursive: true, force: true });
    }
});
