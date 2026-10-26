import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// V03A/V03B (WP03, D03): the product-owned topology on a clean user manager.
// The broker entry is started the way the product starts it (explicit launch
// location, no fixed broker unit), in XDG roots the manager does not share, so
// a unit that re-derived its location or depended on a broker unit that does
// not exist would be observed here, not assumed away.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultHostConfig, DEFAULT_RESIDENT_PROFILE } from "@oma/config/defaults";
import { deploymentDigest } from "#oma-test/app/runtime/deployment-manifest";
import { provisionSociety, residentRootfsPath } from "#oma-test/app/runtime/provision";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { GitModule } from "@oma/git";
import { sha256Hex } from "@oma/domain/canonical-json";
import { unitName } from "@oma/platform-linux/units";
import { actorSocketPathAt } from "@oma/domain/paths";
import { cleanupOwnedSystemdUnits, requireSystemdTestManager } from "./fixtures/systemd.js";
import { ALL_CAPS } from "./fixtures/spec.js";
requireSystemdTestManager();
const systemctl = (...args: string[]) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 1 << 20, killSignal: "SIGKILL" });
const show = (unit: string, ...properties: string[]): Record<string, string> => {
    const out = systemctl("show", unit, ...properties.map(property => `--property=${property}`));
    assert.equal(out.status, 0, out.stderr);
    return Object.fromEntries(out.stdout.trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(what: string, condition: () => boolean, ms = 30000): Promise<void> {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50))
        if (condition())
            return;
    assert.fail(`timed out waiting for ${what}`);
}
const cmdline = (pid: number): string[] | null => {
    try {
        return readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").slice(0, -1);
    }
    catch {
        return null;
    }
};
interface Topology {
    root: string;
    society: string;
    stateRoot: string;
    runRoot: string;
    configPath: string;
    env: NodeJS.ProcessEnv;
    resident: string;
    path: string;
}
function topology(): Topology {
    const root = mkdtempSync(join(tmpdir(), "v03-"));
    const society = `v3${Date.now().toString(36)}`;
    // Spaces and non-ASCII in every root the unit must carry; none of them is the
    // manager's own XDG location.
    // The runtime directory is the manager's own: `systemctl --user` reaches the
    // manager through it, so a different one is refused (see the case below).
    const data = join(root, "data 한");
    const run = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;
    const xdgConfig = join(root, "cfg");
    mkdirSync(join(xdgConfig, "systemd", "user"), { recursive: true });
    const stateRoot = join(data, "oma", society);
    const runRoot = join(run, "oma", society);
    // `$` and `%` are what systemd expands in ExecStart; the file is named them.
    const configPath = join(root, "설정 dir", "custom $HOME %h.json");
    const env = { ...process.env, XDG_DATA_HOME: data, XDG_RUNTIME_DIR: run, XDG_CONFIG_HOME: xdgConfig, NOTIFY_SOCKET: "" };
    return { root, society, stateRoot, runRoot, configPath, env,
        resident: unitName(society, "child", "service"), path: unitName(society, "child", "path") };
}
function provision(t: Topology): void {
    const seed = join(t.root, "seed");
    mkdirSync(seed);
    const git = (...args: string[]) => {
        const out = spawnSync("git", args, { cwd: seed, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
        assert.equal(out.status, 0, out.stderr);
    };
    git("init", "-q", "-b", "main");
    writeFileSync(join(seed, "README.md"), "launch topology\n");
    git("add", ".");
    git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "seed");
    // The product's own first-run steps: provisioning, then the default config.
    provisionSociety(t.stateRoot, { projectDir: seed });
    const libdir = process.cwd();
    const cfg = defaultHostConfig({ society: t.society, node: process.execPath, libdir,
        rootfs: residentRootfsPath(t.stateRoot), deploymentDigest: deploymentDigest(libdir) });
    cfg.initialResidents = [{ name: "child", profile: DEFAULT_RESIDENT_PROFILE, brief: "launch topology" }];
    mkdirSync(join(t.root, "설정 dir"), { recursive: true, mode: 0o700 });
    writeFileSync(t.configPath, JSON.stringify(cfg));
    // The default location holds a configuration for another society: a unit
    // that silently fell back to it would refuse to run rather than pass.
    writeFileSync(join(t.stateRoot, "config.json"), JSON.stringify({ ...cfg, society: `${t.society}x` }));
}
interface Broker {
    child: ChildProcess;
    output: () => string;
    exited: Promise<number | null>;
}
async function startBroker(t: Topology): Promise<Broker> {
    const child = spawn(process.execPath, [join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"),
        "--society", t.society, "--config", t.configPath, "--state-root", t.stateRoot, "--run-root", t.runRoot], { env: t.env, stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    child.stderr!.on("data", bytes => { output += String(bytes); });
    const exited = new Promise<number | null>(resolve => child.on("close", code => resolve(code)));
    await until("broker readiness", () => /broker (ready|listening)/.test(output) || child.exitCode !== null);
    assert.match(output, /broker (ready|listening)/);
    return { child, output: () => output, exited };
}
async function publishGoal(t: Topology): Promise<void> {
    const store = new Store(join(t.stateRoot, "runtime.sqlite"), undefined, { society: t.society });
    try {
        const mail = createMailModule({ stateRoot: t.stateRoot, society: t.society }, store, 64);
        const git = createGitModule({ stateRoot: t.stateRoot, projectGit: join(t.stateRoot, "repos", "project.git"),
            contextGit: join(t.stateRoot, "repos", "context.git"), worldDir: join(t.stateRoot, "world"), society: t.society }, store, mail, { policyRevision: "1", protectedPaths: [], checks: [] });
        const principal = store.getAgent("principal")!;
        const bytes = Buffer.from("# GOAL\nobserve the launch topology\n");
        const receipt = await git.publishContext({ actor: "principal", incarnation: principal.incarnation, role: "principal", channel: "actor",
            capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } }, "v03-goal", { expected: null, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }],
            content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield bytes; })());
        assert.equal(receipt.state, "succeeded");
    }
    finally {
        store.close();
    }
}
const incarnation = (t: Topology): number => {
    const store = new Store(join(t.stateRoot, "runtime.sqlite"), undefined, { society: t.society });
    try {
        return store.getAgent("child")!.incarnation;
    }
    finally {
        store.close();
    }
};
const expectedRunnerArgv = (t: Topology): string[] => [process.execPath, join(process.cwd(), "apps", "oma", "dist", "entry", "runner.js"),
    "--society", t.society, "--agent", "child", "--config", t.configPath, "--state-root", t.stateRoot, "--run-root", t.runRoot];
function cleanup(t: Topology, brokers: Broker[]): void {
    for (const broker of brokers)
        if (broker.child.exitCode === null)
            broker.child.kill("SIGKILL");
    cleanupOwnedSystemdUnits(t.root, t.society);
    // The provisioned rootfs keeps read-only directories; the fixture owns them.
    spawnSync("chmod", ["-R", "u+rwX", t.root]);
    rmSync(t.root, { recursive: true, force: true });
    rmSync(t.runRoot, { recursive: true, force: true });
}
test("V03B unsupported: a runtime directory the user manager does not use is refused before the Store opens", async () => {
    const t = topology();
    try {
        provision(t);
        const run = join(t.root, "run 한");
        mkdirSync(run, { mode: 0o700 });
        const refused = spawnSync(process.execPath, [join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"), "--society", t.society,
            "--config", t.configPath, "--state-root", t.stateRoot, "--run-root", join(run, "oma", t.society)], { env: { ...t.env, XDG_RUNTIME_DIR: run }, encoding: "utf8", timeout: 20000 });
        assert.equal(refused.status, 1, refused.stderr);
        assert.match(refused.stderr, /UNSUPPORTED_PROFILE: the systemd user manager is not reachable/);
        assert.doesNotMatch(refused.stderr, /broker (ready|listening)/);
        assert.equal(existsSync(join(t.stateRoot, "runtime.sqlite")), false);
    }
    finally {
        cleanup(t, []);
    }
});
test("V03A/V03B product topology: the unit carries the resolved location, starts without a broker unit, and is stopped by drain and startup", { timeout: 240000 }, async () => {
    const t = topology();
    const brokers: Broker[] = [];
    try {
        provision(t);
        // First start bootstraps the registry and installs the Resident's units.
        let broker = await startBroker(t);
        brokers.push(broker);
        const unit = show(t.resident, "LoadState", "FragmentPath", "BindsTo", "Requires", "ExecStart");
        assert.equal(unit.LoadState, "loaded");
        assert.equal(unit.BindsTo, "", "a product-owned broker is no unit a Resident can bind to");
        assert.doesNotMatch(unit.Requires ?? "", /broker/);
        // The manager reports ExecStart before `$` expansion; /proc below shows the
        // words the runner actually received.
        const reported = expectedRunnerArgv(t).map(word => word.replaceAll("$", () => "$$")).join(" ");
        assert.ok(unit.ExecStart!.includes(`argv[]=${reported} ;`), String(unit.ExecStart));
        // Path settings are verbatim: the watched inbox is the state root's, spaces and all.
        assert.equal(show(t.path, "Paths").Paths, `${join(t.stateRoot, "mail", "inboxes", "child", "new")} (DirectoryNotEmpty)`);
        broker.child.kill("SIGTERM");
        assert.equal(await broker.exited, 0, broker.output());
        await publishGoal(t);
        // With a GOAL the product's own reconciliation activates the Resident.
        broker = await startBroker(t);
        brokers.push(broker);
        await until("the unit to run the runner with the broker's location", () => {
            const main = Number(show(t.resident, "MainPID").MainPID);
            return main > 0 && JSON.stringify(cmdline(main)) === JSON.stringify(expectedRunnerArgv(t));
        });
        // The broker opens the run's actor endpoint only for an authenticated
        // runner.open, and only under its own run root.
        await until("the runner to open a run against this broker", () => existsSync(actorSocketPathAt(t.runRoot, "child", 1)));
        broker.child.kill("SIGTERM");
        assert.equal(await broker.exited, 0, broker.output());
        // Drain stopped what nothing else would: no fixed unit binds this Resident.
        const drained = show(t.resident, "ActiveState", "MainPID");
        assert.ok(["inactive", "failed"].includes(drained.ActiveState!), JSON.stringify(drained));
        assert.equal(show(t.path, "ActiveState").ActiveState, "inactive");
        const opened = incarnation(t);
        assert.ok(opened >= 1, "the unit-started runner reached this broker at the rendered run root");
        // Ungraceful loss: nothing tears the Resident down, so the next broker must.
        broker = await startBroker(t);
        brokers.push(broker);
        await until("reactivation", () => show(t.resident, "ActiveState").ActiveState === "active");
        const before = show(t.resident, "InvocationID", "MainPID");
        broker.child.kill("SIGKILL");
        await broker.exited;
        assert.equal(show(t.resident, "InvocationID").InvocationID, before.InvocationID, "a killed broker leaves its Resident running");
        // A second broker for the society is refused while the first's lock is gone
        // but its Resident still runs: the restarted broker is the single writer.
        broker = await startBroker(t);
        brokers.push(broker);
        assert.equal(cmdline(Number(before.MainPID)), null, "startup quiescence ended the orphaned runner before serving");
        const second = spawnSync(process.execPath, [join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"), "--society", t.society,
            "--config", t.configPath, "--state-root", t.stateRoot, "--run-root", t.runRoot], { env: t.env, encoding: "utf8", timeout: 20000 });
        assert.notEqual(second.status, 0);
        assert.match(second.stderr, /already owns this society/);
        broker.child.kill("SIGTERM");
        assert.equal(await broker.exited, 0, broker.output());
        assert.ok(["inactive", "failed"].includes(show(t.resident, "ActiveState").ActiveState!));
        assert.ok(existsSync(t.configPath));
    }
    finally {
        cleanup(t, brokers);
    }
});
