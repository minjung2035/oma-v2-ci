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
import { candidateSandbox } from "@oma/platform-linux/candidate-sandbox";
import { Broker } from "@oma/broker";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { PolicyExecution } from "./fixtures/execution.js";
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
        },
    };
}
// ---------------------------------------------------------------------------
// AUD-1/AUD-2 retain their service-renderer meaning in the raw archive.
// Current literal argv/backoff/containment are tested through actual native owners.
test("AUD-3: candidate sandbox argv does not inherit host environment", () => {
    const argv = candidateSandbox({ rootfs: "/rootfs", node: process.execPath, libdir: "/checks" }, "a".repeat(40), { id: "audit", argv: ["/checks/run"], env: { SAFE: "1" },
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
        const units = new PolicyExecution();
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
        const units = new PolicyExecution();
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
