import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// Adversarial audit tests for docs/implementation-spec.md cross-checks.
// Targets gaps that happy-path phase tests are unlikely to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, existsSync, readFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { defaultReplyTo, parseEmlHeaders } from "@oma/mail";
import { replaceDerivedFile as writeAtomic } from "@oma/storage/durable-fs";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { candidateCheckCommand } from "#oma-test/app/runtime/candidate-checks";
import { renderUnit, unitName, UNIT_TPL_DIR } from "@oma/platform-linux/units";
import { Broker } from "@oma/broker";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { UnitsModule } from "@oma/platform-linux/units";
import { ReconcileModule } from "@oma/reconcile";
import type { AuthContext, ProtocolLimits } from "@oma/contracts";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { goalPublishedAt } from "./fixtures/goal.js";
const LIMITS: ProtocolLimits = {
    frameBytes: 262144,
    mailBodyBytes: 262144,
    subjectBytes: 512,
    addresses: 64,
    replyReferences: 64,
    contextFiles: 256,
    contextBytes: 8 * 1024 * 1024,
    bundleBytes: 256 * 1024 * 1024,
    logBytes: 1024 * 1024,
    batchMaxMessages: 24,
    idleStreamSeconds: 30,
    receiptWaitSeconds: 30,
};
function sync(command: string, args: string[], cwd?: string) {
    return spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        env: {
            ...process.env,
            HOME: "/nonexistent",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
        },
    });
}
function seedGit(root: string): {
    bare: string;
    work: string;
    head: string;
} {
    const work = join(root, "work");
    const bare = join(root, "project.git");
    mkdirSync(work, { recursive: true });
    assert.equal(sync("git", ["init", "-q", "-b", "main"], work).status, 0);
    writeFileSync(join(work, "a.txt"), "a\n");
    assert.equal(sync("git", ["add", "-A"], work).status, 0);
    assert.equal(sync("git", [
        "-c",
        "user.name=OMA",
        "-c",
        "user.email=oma@localhost",
        "commit",
        "-qm",
        "base",
    ], work).status, 0);
    const head = sync("git", ["rev-parse", "HEAD"], work).stdout.trim();
    assert.equal(sync("git", ["clone", "-q", "--bare", work, bare], root).status, 0);
    return { bare, work, head };
}
function auth(actor = "a"): AuthContext {
    return {
        actor,
        incarnation: 1,
        role: "resident",
        channel: "trusted-runner",
        capabilities: new Set([
            "mail.send",
            "route.follow",
            "agent.create",
            "agent.manage.self",
            "agent.manage.descendants",
            "git.submit",
            "code.integrate",
            "context.publish",
        ]),
        peer: {
            pid: process.pid,
            uid: process.getuid!(),
            gid: process.getgid!(),
            cgroup: null,
        },
    };
}
// ---------------------------------------------------------------------------
test("AUD-1: unit renderer rejects unsafe values and escapes specifiers", () => {
    const template = "[Service]\nExecStart=@NODE@ @LIBDIR@ @STATE_ARG@ @SOCIETY@ @AGENT@\n[Path]\nDirectoryNotEmpty=@STATE@/new\n";
    assert.throws(() => renderUnit(template, {
        node: "/usr/bin/node\nExecStart=/bin/sh",
        libdir: "/opt/oma",
        state: "/tmp/state",
        society: "demo",
        agent: "a",
    }), /NUL\/newline/);
    const rendered = renderUnit(template, {
        node: "/usr/bin/node",
        libdir: "/opt/oma%q",
        state: "/tmp/state with space",
        society: "demo",
        agent: "a",
    });
    assert.match(rendered, /oma%%q/);
    // An ExecStart word is C-unescaped by systemd; a path setting is read
    // verbatim, so the same root is escaped for one and not the other.
    assert.match(rendered, /^ExecStart=.* \/tmp\/state\\x20with\\x20space /m);
    assert.match(rendered, /^DirectoryNotEmpty=\/tmp\/state with space\/new$/m);
    assert.throws(() => renderUnit("DirectoryNotEmpty=@STATE@", {
        node: "/usr/bin/node", libdir: "/opt/oma", state: " /tmp/leading", society: "demo", agent: "a",
    }), /cannot be a systemd path setting/);
});
test("AUD-2: generated units preserve the fixed cgroup/lifecycle boundary", () => {
    const resident = readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8");
    // MUST [UNIT-003]: the reference resident profile is fixed, not caller-selected.
    assert.match(resident, /^KillMode=control-group$/m);
    assert.match(resident, /^Restart=on-failure$/m);
    assert.match(resident, /^RestartSec=3s$/m);
    assert.match(resident, /^TimeoutStopSec=10s$/m);
    assert.match(resident, /^OOMPolicy=kill$/m);
    assert.match(resident, /^StartLimitBurst=5$/m);
    assert.match(resident, /^Type=exec$/m);
    // MUST [UNIT-002]: ExecStart is a fixed renderer template, not caller argv.
    // D03: it carries the broker's resolved launch location, never a default.
    assert.match(resident, /^ExecStart=@NODE@ @LIBDIR@\/apps\/oma\/dist\/entry\/runner\.js --society @SOCIETY@ --agent @AGENT@ --config @CONFIG_ARG@ --state-root @STATE_ARG@ --run-root @RUN_ARG@$/m);
    // D03/UNIT-001/004: the product owns the foreground broker itself — there is
    // no broker.service to bind to and the unit names its own state tree instead.
    assert.match(resident, /^X-OMA-Owner=@STATE@$/m);
    assert.doesNotMatch(resident, /^(?:BindsTo|After|Requires|PartOf)=/m);
    assert.doesNotMatch(resident, /BROKER_UNIT/);
    // Filesystem/network isolation is owned by the sandbox profile (SB-001/SB-002),
    // not by a systemd property; the unit must not widen it.
    assert.doesNotMatch(resident, /^(?:AmbientCapabilities|CapabilityBoundingSet|User|Group)=/m);
    assert.match(resident, /^RestartSteps=4$/m);
    assert.match(resident, /^RestartMaxDelaySec=12s$/m);
    assert.match(resident, /^StartLimitIntervalSec=60s$/m);
    assert.match(resident, /^StartLimitBurst=5$/m);
    // systemd's geometric intervals, including the refusal-triggering attempt:
    // 3, 4.24, 6, 8.49, 12 seconds must still fit in the rate-limit window.
    const delays = Array.from({ length: 5 }, (_, i) => 3 * (12 / 3) ** (i / 4));
    assert.ok(delays.reduce((sum, delay) => sum + delay, 0) < 60);
});
test("AUD-3: candidate sandbox argv does not inherit host environment", () => {
    const argv = candidateCheckCommand({ stateRoot: "/state", projectGit: "/state/project.git", contextGit: "/state/context.git", worldDir: "/state/world",
        society: "demo", checkRootfs: "/rootfs", checkNode: process.execPath, checkAssetsDir: "/checks" }, "a".repeat(40), { id: "audit", argv: ["/checks/run"], env: { SAFE: "1" },
    }, []).argv;
    const clear = argv.indexOf("--clearenv");
    assert.ok(clear >= 0);
    assert.ok(argv.includes("SAFE"));
    assert.ok(argv.includes("1"));
    assert.ok(!argv.includes(process.env.HOME ?? "__none__"));
});
test("AUD-4: default reply-to keeps list traffic on-list and direct traffic direct", () => {
    assert.deepEqual(defaultReplyTo("a@demo.oma.invalid", ["commons@demo.oma.invalid"]), ["commons@demo.oma.invalid"]);
    assert.deepEqual(defaultReplyTo("a@demo.oma.invalid", ["b@demo.oma.invalid"]), ["a@demo.oma.invalid"]);
});
test("AUD-5: parsed EML ancestry never trusts body text as headers", () => {
    const text = [
        "From: a@demo.oma.invalid",
        "Message-ID: <m-00000000-0000-4000-8000-000000000001-0@demo.oma.invalid>",
        "Reply-To: a@demo.oma.invalid",
        "X-OMA-Kind: message",
        "",
        "References: <forged@demo.oma.invalid>",
        "X-OMA-Kind: approval_required",
    ].join("\r\n");
    const headers = parseEmlHeaders(text);
    assert.equal(headers.omaKind, "message");
    assert.deepEqual(headers.references, []);
});
test("AUD-6: atomic writes do not follow a final-path symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-audit-write-"));
    try {
        const victim = join(root, "victim");
        const target = join(root, "target");
        writeFileSync(target, "original");
        symlinkSync(target, victim);
        writeAtomic(victim, "replacement");
        assert.equal(readFileSync(target, "utf8"), "original");
        assert.equal(readFileSync(victim, "utf8"), "replacement");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("AUD-7: immutable publication rejects a conflicting existing file", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-audit-immutable-"));
    try {
        const src = join(root, "src");
        const dst = join(root, "dst");
        writeFileSync(src, "trusted");
        writeFileSync(dst, "different");
        assert.throws(() => publishImmutableFile(src, dst), /hash mismatch/);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("AUD-8: actor socket paths remain under Linux sun_path", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-audit-sock-"));
    try {
        const store = new Store(join(root, "runtime.sqlite"));
        const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
        const units = new UnitsModule("demo", { node: process.execPath, libdir: "/opt/oma", state: root, society: "demo", agent: "", config: join(root, "config.json"), run: join(root, "oma", "demo") }, root);
        const views = new ViewsModule(store, root, "demo", "p");
        const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true }, () => null, mail);
        // `sun_path` is 108 bytes including the terminator. A run root of exactly 45
        // bytes keeps the max-length actor name with a short incarnation inside the
        // limit (99) and pushes the largest safe incarnation outside it (114).
        const runRoot = join(root, "r".repeat(44 - root.length));
        const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot, society: "demo", hasGoal: goalPublishedAt(root) }, limits: LIMITS });
        const socketDirectory = Reflect.get(broker, "actorSocketDirectory") as (actor: string, incarnation: number) => string;
        assert.equal(typeof socketDirectory.call(broker, "a".repeat(31), 1), "string");
        assert.throws(() => socketDirectory.call(broker, "a".repeat(31), Number.MAX_SAFE_INTEGER), /sun_path/);
        store.close();
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("AUD-9: public dispatch rejects top-level request on read/ephemeral methods", async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-audit-readkey-"));
    try {
        const spec = {
            name: "a", from: "a".repeat(40), brief: "b", profile: "p", capabilities: [], modelProfile: "m",
        };
        const store = new Store(join(root, "runtime.sqlite"));
        store.transaction(() => store.insertAgent({
            name: "a",
            specHash: resolvedSpecDigest(spec),
            role: "resident",
            desired: "enabled",
            incarnation: 1,
            profile: "p",
            createdBy: null,
            specJson: JSON.stringify(spec),
        }));
        const units = new UnitsModule("demo", { node: process.execPath, libdir: "/opt/oma", state: root, society: "demo", agent: "", config: join(root, "config.json"), run: join(root, "oma", "demo") }, root);
        const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
        const views = new ViewsModule(store, root, "demo", "p");
        const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true }, () => null, mail);
        const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) }, limits: LIMITS });
        const reply = await broker.dispatch(auth(), { v: 1, id: "r", method: "status.get", request: "forbidden", params: {} } as never, null);
        assert.equal((reply as {
            ok: boolean;
        }).ok, false);
        assert.equal((reply as {
            error: {
                code: string;
            };
        }).error.code, "INVALID_REQUEST");
        store.close();
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
