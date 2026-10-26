import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// CLI acceptance (P1): the real `oma` CLI binary against the real broker over
// Unix sockets from a real owned PID namespace and pinned trusted runner.
// Manual CLI children are authenticated by their actual process descent. Covers IPC-006 freeze-cache semantics, IPC-008 --request
// recovery, CLI-003 exit codes, and the streamed submit path — through the
// CLI, never by calling library APIs directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { nativeScriptResidents, type NativeScriptResidents } from "./fixtures/native-script-residents.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { GitModule } from "@oma/git";
import { ReconcileModule } from "@oma/reconcile";
import { Broker } from "@oma/broker";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { encodeFrame } from "@oma/protocol/frame";
import { sha256Hex } from "@oma/domain/canonical-json";
import type { ResolvedAgentSpec } from "@oma/contracts";
const G = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
};
const ROOT = join(import.meta.dirname ?? process.cwd(), "..", "..");
const CLI = join(ROOT, "apps", "oma", "dist", "cli.js");
interface Env {
    dir: string;
    state: string;
    runRoot: string;
    society: string;
    store: Store;
    units: NativeScriptResidents;
    cleanup: () => Promise<void>;
}
async function envOf(): Promise<Env> {
    const dir = mkdtempSync(join(tmpdir(), "oma-cli-"));
    const state = join(dir, "state");
    const runRoot = join(dir, "run");
    const society = `cli${Date.now().toString(36)}`;
    mkdirSync(state, { recursive: true });
    mkdirSync(runRoot, { recursive: true });
    const store = new Store(join(state, "runtime.sqlite"));
    store.transaction((_t) => {
        for (const [name, role] of [
            ["principal", "principal"],
            ["a", "resident"],
            ["b", "resident"],
        ] as const) {
            store.insertAgent({
                name,
                ...storedSpec(ALL_CAPS, "p", name),
                role,
                desired: "enabled",
                incarnation: 0,
                profile: "p",
                createdBy: null,
            });
        }
    });
    const units = await nativeScriptResidents(store, state);
    const mail = createMailModule({ stateRoot: state, society }, store, 64);
    const resolver = (_p: {
        name: string;
        profile: string;
    }, input: {
        name: string;
        from: string;
        brief: string;
    }): ResolvedAgentSpec => ({
        ...input,
        modelProfile: "m",
        profile: "child",
        capabilities: ["mail.send", "git.submit"],
    });
    const lifecycle = createLifecycleModule(store, units, {
        stateRoot: state,
        projectGit: join(state, "repos", "project.git"),
        society,
        hasGoal: () => false,
        activationAllowed: () => true,
    }, resolver, mail);
    const views = new ViewsModule(store, state, society, "p");
    const git = createGitModule({
        stateRoot: state,
        projectGit: join(state, "repos", "project.git"),
        contextGit: join(state, "repos", "context.git"),
        worldDir: join(state, "world"),
        society,
    }, store, mail, null, null, null, units.quarantine({ stateRoot: state, projectGit: join(state, "repos/project.git"), contextGit: join(state, "repos/context.git"), worldDir: join(state, "world"), society }));
    const recon = createReconcileModule(store, mail, git, null, units, lifecycle, {
        hasGoal: () => true,
        activationAllowed: () => true,
        projectGit: join(state, "repos", "project.git"),
    });
    const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: git, reviews: null, reconcile: recon, paths: {
        stateRoot: state,
        runRoot,
        society,
        hasGoal: () => true,
    } });
    units.attach(broker);
    await broker.start();
    return {
        dir,
        state,
        runRoot,
        society,
        store, units,
        cleanup: async () => {
            await units.closeExecution();
            await broker.drainAndClose();
            removeTree(dir);
        },
    };
}
function seedProject(env: Env): string {
    const seed = join(env.dir, "seed");
    mkdirSync(seed, { recursive: true });
    const sh = (args: string[], cwd?: string): string => {
        const r = spawnSync("git", args, {
            cwd: cwd ?? env.dir,
            env: G,
            encoding: "utf8",
        });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return (r.stdout ?? "").trim();
    };
    sh(["init", "-q", "-b", "main"], seed);
    writeFileSync(join(seed, "base.txt"), "b".repeat(65536) + "\n", "utf8");
    sh(["add", "-A"], seed);
    sh([
        "-c",
        "user.name=O",
        "-c",
        "user.email=o@localhost",
        "commit",
        "-qm",
        "base",
    ], seed);
    const base = sh(["rev-parse", "HEAD"], seed);
    sh(["clone", "-q", "--bare", seed, join(env.state, "repos", "project.git")]);
    sh([
        "--git-dir",
        join(env.state, "repos", "project.git"),
        "symbolic-ref",
        "HEAD",
        "refs/heads/main",
    ]);
    return base;
}
/**
 * Trusted test runner: run the CLI inside an actually owned PID namespace.
 * The inherited private control socket first obtains a run lease via
 * runner.open (the production path), then executes each scenario's CLI
 * invocation with OMA_SOCKET pointing at the lease's actor socket.
 */
const WRAP = String.raw `import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { connect, Socket } from "node:net";
import { FrameParser, encodeFrame } from "@ABS_FRAME@";
const control = new Socket({ fd: 6, readable: true, writable: true });

const admin = process.env.OMA_ADMIN_SOCK;
const scenarios = JSON.parse(readFileSync(process.env.OMA_SCENARIOS_FILE, "utf8"));

function framed(sockPath, frame) {
  return new Promise((resolve, reject) => {
    let bytes;
    if (Array.isArray(frame)) bytes = Buffer.from(frame);
    else if (typeof frame === "string") {
      const body = Buffer.from(frame);
      bytes = Buffer.alloc(4 + body.length);
      bytes.writeUInt32BE(body.length);
      body.copy(bytes, 4);
    } else bytes = encodeFrame(frame);
    const sock = sockPath === admin ? control : connect(sockPath, () => sock.write(bytes));
    if (sock === control) sock.write(bytes);
    const parser = new FrameParser(256 * 1024);
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("wrap timeout")); }, 30000);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, Buffer.from(d)]);
      try { for (const f of parser.feed(buf)) { clearTimeout(timer); if (sock !== control) sock.destroy(); resolve(f.raw); } } catch {}
      buf = Buffer.alloc(0);
    });
    sock.on("error", reject);
  });
}

const lease = await framed(admin, { v: 1, id: "ro", method: "runner.open", params: { agent: process.env.OMA_ACTOR, invocationId: process.env.OMA_TEST_INVOCATION_ID } });
if (!lease.ok) { writeFileSync(process.env.OMA_OUT, JSON.stringify({ leaseError: lease.error })); process.exit(2); }
const sock = lease.result.socketHostPath;
const results = [];
for (const s of scenarios) {
  if (s.frame) {
    const reply = await framed(sock, s.frame);
    results.push({ code: reply.ok ? 0 : 2, stdout: JSON.stringify(reply), stderr: reply.error?.code ?? "" });
    continue;
  }
  if (s.git) {
    const g = spawnSync("git", s.git, { cwd: s.cwd ?? "/tmp", encoding: "utf8" });
    results.push({ git: s.git, code: g.status, stdout: g.stdout ?? "", stderr: g.stderr ?? "" });
    continue;
  }
  const r = spawnSync(process.execPath, [process.env.OMA_CLI, ...s.args], {
    cwd: s.cwd ?? "/tmp",
    env: { ...process.env, OMA_SOCKET: s.socket ?? sock, HOME: s.home ?? process.env.OMA_HOME, ...(s.env ?? {}) },
    encoding: "utf8",
    timeout: 60000,
  });
  results.push({ args: s.args, code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
}
writeFileSync(process.env.OMA_OUT, JSON.stringify(results));
process.exit(0);
`;
test("CLI acceptance: freeze cache, same-key semantics, recovery, streamed submit (real native scope, real sockets)", async (t) => {
    const env = await envOf();
    const society = env.society;
    try {
        const base = seedProject(env);
        // CLI workdir: a clone with one local commit to submit
        const work = join(env.dir, "work");
        const sh = (args: string[], cwd?: string): string => {
            const r = spawnSync("git", args, {
                cwd: cwd ?? env.dir,
                env: G,
                encoding: "utf8",
            });
            if (r.status !== 0)
                throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
            return (r.stdout ?? "").trim();
        };
        sh(["clone", "-q", join(env.state, "repos", "project.git"), work]);
        writeFileSync(join(work, "c.txt"), "cli\n", "utf8");
        sh(["add", "c.txt"], work);
        sh([
            "-c",
            "user.name=C",
            "-c",
            "user.email=c@localhost",
            "commit",
            "-qm",
            "cli",
        ], work);
        const candidate = sh(["rev-parse", "HEAD"], work);
        const bodyFile = join(env.dir, "body.txt");
        writeFileSync(bodyFile, "hello body\n", "utf8");
        const briefFile = join(env.dir, "brief.md");
        writeFileSync(briefFile, "# checker brief\n", "utf8");
        const homeDir = join(env.dir, "home-a");
        mkdirSync(homeDir, { recursive: true });
        // scenarios (in one unit run; shared HOME = shared freeze cache)
        const scenarios: Array<{
            args?: string[];
            git?: string[];
            frame?: unknown;
            cwd: string;
            home?: string;
            socket?: string;
        }> = [
            {
                args: [
                    "send",
                    "b",
                    "--subject",
                    "hello",
                    "--file",
                    bodyFile,
                    "--request",
                    "k1",
                ],
                cwd: work,
                home: homeDir,
            },
            {
                args: [
                    "send",
                    "b",
                    "--subject",
                    "hello",
                    "--file",
                    bodyFile,
                    "--request",
                    "k1",
                ],
                cwd: work,
                home: homeDir,
            },
            {
                args: [
                    "send",
                    "b",
                    "--subject",
                    "other",
                    "--file",
                    bodyFile,
                    "--request",
                    "k1",
                ],
                cwd: work,
                home: homeDir,
            },
            {
                args: [
                    "send",
                    "b",
                    "--subject",
                    "hello",
                    "--file",
                    bodyFile,
                    "--request",
                    "k1",
                ],
                cwd: work,
                home: homeDir,
            },
            {
                args: ["submit", "HEAD", "--subject", "cli subm", "--request", "ksub"],
                cwd: work,
                home: homeDir,
            },
            {
                args: ["submit", "HEAD", "--request", "ksub2"],
                cwd: work,
                home: homeDir,
                socket: join(env.dir, "dead.sock"),
            },
            {
                args: ["submit", "HEAD", "--request", "ksub2"],
                cwd: work,
                home: homeDir,
            },
            // P1-6: --to parsing (single / repeatable / default commons)
            {
                args: ["submit", "HEAD", "--to", "a", "--request", "kto1"],
                cwd: work,
                home: homeDir,
            },
            {
                args: ["submit", "HEAD", "--to", "a", "--to", "b", "--request", "kto2"],
                cwd: work,
                home: homeDir,
            },
            {
                args: ["submit", "HEAD", "--request", "kto3"],
                cwd: work,
                home: homeDir,
            },
            // P1-5: agent create --from HEAD (resolved locally), then frozen recovery
            {
                args: [
                    "agent",
                    "create",
                    "checker",
                    "--from",
                    "HEAD",
                    "--file",
                    briefFile,
                    "--request",
                    "kfrom",
                ],
                cwd: work,
                home: homeDir,
            },
            {
                git: [
                    "-c",
                    "user.name=C",
                    "-c",
                    "user.email=c@localhost",
                    "commit",
                    "-qm",
                    "move-head",
                    "--allow-empty",
                ],
                cwd: work,
            },
            {
                args: [
                    "agent",
                    "create",
                    "checker",
                    "--from",
                    "HEAD",
                    "--file",
                    briefFile,
                    "--request",
                    "kfrom",
                ],
                cwd: work,
                home: homeDir,
            },
            {
                args: [
                    "agent",
                    "create",
                    "checker2",
                    "--from",
                    "HEAD",
                    "--file",
                    briefFile,
                    "--request",
                    "kfrom2",
                ],
                cwd: work,
                home: homeDir,
            },
            // P1-4: submit frozen-first after HEAD moves
            {
                args: ["submit", "HEAD", "--request", "ksubf"],
                cwd: work,
                home: homeDir,
            },
            {
                git: [
                    "-c",
                    "user.name=C",
                    "-c",
                    "user.email=c@localhost",
                    "commit",
                    "-qm",
                    "move2",
                    "--allow-empty",
                ],
                cwd: work,
            },
            {
                args: ["submit", "HEAD", "--request", "ksubf"],
                cwd: work,
                home: homeDir,
            },
        ];
        const typedStart = scenarios.length;
        const policyRevision = " 정책-v1 ";
        const approvalArgs = (key: string, oid = candidate, policy = policyRevision, recipient = "principal") => [
            "send", recipient, "--kind", "approval_required", "--subject", "exact approval",
            "--candidate", oid, "--expect", base, "--policy-revision", policy,
            "--file", bodyFile, "--request", key,
        ];
        for (const args of [
            approvalArgs("approval"), approvalArgs("approval"),
            approvalArgs("approval", candidate, "changed-policy"),
            approvalArgs("unpublished-approval", base),
            approvalArgs("missing-principal", candidate, policyRevision, "b"),
            approvalArgs("short-oid", candidate.slice(0, 8)),
        ])
            scenarios.push({ args, cwd: work, home: homeDir });
        const identity = { repo: "project", targetRef: "refs/heads/main", candidate, expectedBase: base, policyRevision };
        const validMail = { to: ["principal"], subject: "raw approval", body: "body", kind: "approval_required", approvalFor: identity };
        const invalidMail = [
            { ...validMail, to: ["b"] },
            { ...validMail, approvalFor: { ...identity, trusted: true } },
            { ...validMail, kind: "critical" },
            { ...validMail, approvalFor: { ...identity, policyRevision: "bad\nheader" } },
        ];
        for (const [index, params] of invalidMail.entries())
            scenarios.push({
                cwd: work, frame: { v: 1, id: `raw-${index}`, request: `raw-${index}`, method: "mail.send", params },
            });
        scenarios.push({ cwd: work, frame: String.raw `{"v":1,"id":"raw-4","request":"raw-4","method":"status.get","\u006dethod":"mail.send","params":${JSON.stringify(validMail)}}` });
        const rawRequest = { v: 1, id: "invalid-wire", request: "invalid-wire", method: "mail.send", params: validMail };
        const invalidFrames = [
            { frame: [0, 0, 0, 1, 0xff], code: "INVALID_REQUEST" },
            { frame: "[]", code: "INVALID_REQUEST" },
            { frame: '{"value":1e999}', code: "INVALID_REQUEST" },
            { frame: '{"value":9007199254740992}', code: "INVALID_REQUEST" },
            { frame: { ...rawRequest, v: 2 }, code: "UNSUPPORTED_VERSION" },
            { frame: { ...rawRequest, method: "mail.forge" }, code: "UNKNOWN_METHOD" },
            { frame: { ...rawRequest, trusted: true }, code: "INVALID_REQUEST" },
            { frame: { ...rawRequest, params: { ...validMail, toString: "not a schema field" } }, code: "INVALID_REQUEST" },
            { frame: { ...rawRequest, params: { ...validMail, kind: "normal" } }, code: "INVALID_REQUEST" },
            { frame: { ...rawRequest, params: { ...validMail, subject: "한".repeat(171) } }, code: "INVALID_REQUEST" },
            ...[
                { ...identity, policyRevision: "한".repeat(43) },
                { ...identity, policyRevision: "\ud800" },
                { ...identity, expectedBase: "a".repeat(64) },
                { ...identity, repo: "context" },
                { ...identity, targetRef: "refs/heads/other" },
            ].map((approvalFor) => ({ frame: { ...rawRequest, params: { ...validMail, approvalFor } }, code: "INVALID_REQUEST" })),
        ];
        for (const item of invalidFrames)
            scenarios.push({ cwd: work, frame: item.frame });
        const contextStart = scenarios.length;
        const contextDir = join(env.dir, "context-docs");
        mkdirSync(join(contextDir, "decisions"), { recursive: true });
        writeFileSync(join(contextDir, "GOAL.md"), "# authenticated context\n");
        writeFileSync(join(contextDir, "RATIONALE.md"), "");
        writeFileSync(join(contextDir, "decisions/a..b.md"), "decision\n");
        for (let retry = 0; retry < 2; retry++)
            scenarios.push({
                args: ["context", "publish", contextDir, "--expect", "none", "--request", "ctx-live"], cwd: work, home: homeDir,
            });
        const contextInvalid: Array<Array<[
            string,
            Buffer
        ]>> = [
            [[".git/config", Buffer.from("[core]\nfsmonitor=false\n")], ["GOAL.md", Buffer.from("goal")]],
            [["GOAL.md", Buffer.from([0xc0, 0xaf])]],
            [["GOAL.md", Buffer.alloc(0)]],
            [["GOAL.md", Buffer.from("x")], ["GOAL.md", Buffer.from("y")]],
        ];
        for (const [index, files] of contextInvalid.entries()) {
            const body = Buffer.concat(files.map(([, bytes]) => bytes));
            const frame = { v: 1, id: `ctx-wire-${index}`, request: `ctx-wire-${index}`, method: "context.publish", params: {
                    expected: null, entries: files.map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256Hex(bytes) })),
                    content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" },
                } };
            scenarios.push({ cwd: work, frame: [...Buffer.concat([encodeFrame(frame), body])] });
        }
        // wrap + unit
        const wrapPath = join(env.dir, "wrap.mjs");
        writeFileSync(wrapPath, WRAP.replace("@ABS_FRAME@", new URL(import.meta.resolve("@oma/protocol/frame")).pathname), "utf8");
        const outPath = join(env.dir, "cli.out.json");
        writeFileSync(join(env.dir, "scenarios.json"), JSON.stringify(scenarios), "utf8");
        const runEnvironment = {
            OMA_ADMIN_SOCK: "private-runner-control", OMA_ACTOR: "a", OMA_CLI: CLI,
            OMA_HOME: homeDir, OMA_OUT: outPath, OMA_SCENARIOS_FILE: join(env.dir, "scenarios.json"), HOME: env.dir,
        };
        await env.units.runScript("a", wrapPath, runEnvironment);
        assert.ok(existsSync(outPath), "native wrapper produced no output");
        const results = JSON.parse(readFileSync(outPath, "utf8")) as Array<{
            args: string[];
            code: number;
            stdout: string;
            stderr: string;
        }>;
        // 1) first send: accepted, receipt with an operation id
        const r1 = results[0]!;
        assert.equal(r1.code, 0, `send failed: ${r1.stderr}`);
        const rec1 = JSON.parse(r1.stdout) as {
            operation: string;
            state: string;
        };
        assert.equal(rec1.state, "succeeded");
        // mail actually landed in b's inbox (new/)
        const inboxDir = join(env.state, "mail", "inboxes", "b");
        const newFiles = existsSync(inboxDir)
            ? readdirSync(join(inboxDir, "new")).filter((f) => f.startsWith("m-"))
            : [];
        assert.ok(newFiles.length >= 1, `no mail reached b's inbox; ${inboxDir}`);
        // 2) same key + same payload -> the SAME receipt (idempotent)
        const r2 = results[1]!;
        assert.equal(r2.code, 0, `re-send failed: ${r2.stderr}`);
        assert.equal((JSON.parse(r2.stdout) as {
            operation: string;
        }).operation, rec1.operation);
        // 3) same key + DIFFERENT payload -> REQUEST_KEY_REUSED, exit 2
        const r3 = results[2]!;
        assert.equal(r3.code, 2, `expected exit 2, got ${r3.code}: ${r3.stdout}${r3.stderr}`);
        assert.match(r3.stderr, /REQUEST_KEY_REUSED/);
        // 4) --request <key> re-invocation of the succeeded op (IPC-008)
        const r4 = results[3]!;
        assert.equal(r4.code, 0, `--request replay failed: ${r4.stderr}`);
        assert.equal((JSON.parse(r4.stdout) as {
            operation: string;
        }).operation, rec1.operation);
        // 5) submit via the CLI (bundle built locally, streamed): succeeded + ref
        const r5 = results[4]!;
        assert.equal(r5.code, 0, `submit failed (code ${r5.code}): stdout=${JSON.stringify(r5.stdout)} stderr=${JSON.stringify(r5.stderr)}`);
        const subRec = JSON.parse(r5.stdout) as {
            result: {
                publishedRef: string;
                candidate: string;
            };
        };
        const refOid = sh([
            "--git-dir",
            join(env.state, "repos", "project.git"),
            "rev-parse",
            subRec.result.publishedRef,
        ]);
        assert.equal(refOid, subRec.result.candidate);
        // 6) dead socket: unknown acceptance -> exit 3, freeze cache retained
        const r6 = results[5]!;
        assert.equal(r6.code, 3, `expected exit 3 for dead socket, got ${r6.code}: ${r6.stdout}${r6.stderr}`);
        const cachePath = join(homeDir, ".local", "state", "oma", "requests", "ksub2.json");
        assert.ok(existsSync(cachePath), "freeze cache must survive a dead-socket attempt");
        // 7) --request recovery against the live broker: operation.get miss ->
        //    replay of the frozen payload -> succeeded with ITS OWN receipt/ref
        const r7 = results[6]!;
        assert.equal(r7.code, 0, `recovery failed (code ${r7.code}): stdout=${JSON.stringify(r7.stdout)} stderr=${JSON.stringify(r7.stderr)}`);
        const rec2 = JSON.parse(r7.stdout) as {
            result: {
                publishedRef: string;
                candidate: string;
            };
        };
        const ref2Oid = sh([
            "--git-dir",
            join(env.state, "repos", "project.git"),
            "rev-parse",
            rec2.result.publishedRef,
        ]);
        assert.equal(ref2Oid, rec2.result.candidate, "recovered submit's ref must resolve to ITS candidate");
        // ---- P1-6: submit --to parsing ----
        const rTo1 = results[7]!;
        assert.equal(rTo1.code, 0, `--to a submit failed: ${rTo1.stdout}${rTo1.stderr}`);
        const rTo2 = results[8]!;
        assert.equal(rTo2.code, 0, `--to a --to b submit failed: ${rTo2.stdout}${rTo2.stderr}`);
        const rTo3 = results[9]!;
        assert.equal(rTo3.code, 0, `no --to submit failed: ${rTo3.stdout}${rTo3.stderr}`);
        // "--to" must never leak as a recipient: a's inbox got the kto1 result mail
        const inboxA = join(env.state, "mail", "inboxes", "a", "new");
        const inboxB = join(env.state, "mail", "inboxes", "b", "new");
        const inboxCommons = join(env.state, "mail", "inboxes", "commons", "new");
        const mA = existsSync(inboxA)
            ? readdirSync(inboxA).filter((f) => f.startsWith("m-"))
            : [];
        assert.ok(mA.length >= 1, `kto1 result mail must reach a's inbox; ${JSON.stringify(mA)}`);
        // kto2 targets a AND b (repeatable --to) -> both have new result mail from kto2
        const a2 = existsSync(inboxA)
            ? readdirSync(inboxA).filter((f) => f.startsWith("m-"))
            : [];
        const b2 = existsSync(inboxB)
            ? readdirSync(inboxB).filter((f) => f.startsWith("m-"))
            : [];
        assert.ok(a2.length >= 2, `kto2 should add another mail to a (now ${a2.length})`);
        assert.ok(b2.length >= 1, `kto2 must reach b via the repeatable --to; ${JSON.stringify(b2)}`);
        // kto3 (no --to) defaults to commons
        const broadcast = JSON.parse(env.store.getOperation("a", "kto3")!.planJson).intent.message;
        assert.deepEqual([...broadcast.recipients].sort(), ["a", "b"]);
        assert.equal(existsSync(inboxCommons), false, "commons is an address, not an actor mailbox");
        // ---- P1-5: agent create --from HEAD ----
        const rFrom1 = results[10]!;
        assert.equal(rFrom1.code, 0, `agent create --from HEAD failed: ${rFrom1.stdout}${rFrom1.stderr}`);
        const fromRec = JSON.parse(rFrom1.stdout) as {
            operation: string;
            state: string;
        };
        assert.equal(fromRec.state, "succeeded");
        assert.match(readFileSync(join(env.state, "world", "agents.tsv"), "utf8"), /checker\tresident\tenabled\tchild/);
        const gitCode = results[11]!;
        assert.equal(gitCode.code, 0, `git move-head: ${gitCode.stderr}`);
        // recovery after HEAD moved: MUST use the originally frozen OID (exit 0,
        // same receipt) — the old code would re-resolve HEAD and fail REQUEST_KEY_REUSED.
        const rFrom2 = results[12]!;
        assert.equal(rFrom2.code, 0, `agent create --from HEAD --request recovery failed: ${rFrom2.stdout}${rFrom2.stderr}`);
        assert.equal((JSON.parse(rFrom2.stdout) as {
            operation: string;
        }).operation, fromRec.operation, "recovery must reuse the frozen agent-create request");
        // A fresh local-only HEAD is not in canonical project.git and must fail closed.
        const rFrom3 = results[13]!;
        assert.equal(rFrom3.code, 2);
        assert.match(rFrom3.stderr, /PREREQUISITE_MISSING/);
        // ---- P1-4: submit frozen-first after HEAD moves ----
        const rSubf1 = results[14]!;
        assert.equal(rSubf1.code, 0, `submit freeze failed: ${rSubf1.stdout}${rSubf1.stderr}`);
        const subf1 = JSON.parse(rSubf1.stdout) as {
            operation: string;
            result: {
                candidate: string;
            };
        };
        const git2 = results[15]!;
        assert.equal(git2.code, 0, `git move2: ${git2.stderr}`);
        const rSubf2 = results[16]!;
        assert.equal(rSubf2.code, 0, `submit recovery after HEAD moved failed: ${rSubf2.stdout}${rSubf2.stderr}`);
        const subf2 = JSON.parse(rSubf2.stdout) as {
            operation: string;
            result: {
                candidate: string;
            };
        };
        assert.equal(subf2.operation, subf1.operation, "submit recovery must not create a new operation");
        assert.equal(subf2.result.candidate, subf1.result.candidate, "recovery must use the frozen candidate, not the moved HEAD");
        const typed = results.slice(typedStart, typedStart + 6);
        for (const [index, result] of results.slice(typedStart + 6, typedStart + 11).entries()) {
            assert.equal(result.code, 2);
            assert.equal(result.stderr, "INVALID_REQUEST");
            assert.equal(env.store.getOperation("a", `raw-${index}`), null);
        }
        const wireResults = results.slice(typedStart + 11, contextStart);
        assert.equal(wireResults.length, invalidFrames.length);
        for (const [index, result] of wireResults.entries()) {
            assert.equal(result.code, 2, JSON.stringify({ index, input: invalidFrames[index], result }));
            assert.equal(result.stderr, invalidFrames[index]!.code);
        }
        assert.equal(env.store.getOperation("a", "invalid-wire"), null);
        assert.deepEqual(typed.map((result) => result.code), [0, 0, 2, 2, 2, 2], JSON.stringify(typed));
        assert.equal(JSON.parse(typed[0]!.stdout).operation, JSON.parse(typed[1]!.stdout).operation);
        assert.match(typed[2]!.stderr, /REQUEST_KEY_REUSED/);
        assert.match(typed[3]!.stderr, /CANDIDATE_NOT_PUBLISHED/);
        for (const key of ["unpublished-approval", "missing-principal", "short-oid"])
            assert.equal(env.store.getOperation("a", key), null, `${key} must remain preaccept`);
        const approval = env.store.getOperation("a", "approval")!;
        const message = JSON.parse(approval.planJson).intent.message;
        assert.deepEqual(message.approvalFor, { repo: "project", targetRef: "refs/heads/main",
            candidate, expectedBase: base, policyRevision });
        assert.equal(env.store.getDelivery(message.id, "principal")!.materialized, 1);
        const parsed = spawnSync("python3", ["-c",
            "import sys,json,email.policy; from email.parser import BytesParser; m=BytesParser(policy=email.policy.default).parsebytes(sys.stdin.buffer.read()); print(json.dumps({k.lower():str(v) for k,v in m.items()}))",
        ], { input: readFileSync(join(env.state, message.objectPath)), encoding: "utf8" });
        assert.equal(parsed.status, 0, parsed.stderr);
        const headers = JSON.parse(parsed.stdout);
        assert.equal(headers.to, `principal@${society}.oma.invalid`);
        assert.equal(headers["x-oma-approval-policy"], policyRevision);
        assert.equal(headers["x-oma-approval-candidate"], candidate);
        assert.equal(headers["x-oma-approval-base"], base);
        const contexts = results.slice(contextStart);
        assert.deepEqual(contexts.map(result => result.code), [0, 0, 2, 2, 2, 2], JSON.stringify(contexts));
        const firstContext = JSON.parse(contexts[0]!.stdout);
        assert.equal(firstContext.operation, JSON.parse(contexts[1]!.stdout).operation);
        assert.equal(firstContext.state, "succeeded");
        assert.equal(readFileSync(join(env.state, "world/context/current/GOAL.md"), "utf8"), "# authenticated context\n");
        assert.equal(sh(["--git-dir", join(env.state, "repos/context.git"), "rev-parse", "refs/heads/main"]), firstContext.result.revision);
        const tree = sh(["--git-dir", join(env.state, "repos/context.git"), "ls-tree", "-r", firstContext.result.revision]).split("\n");
        assert.ok(tree.every(line => line.startsWith("100644 blob ")), JSON.stringify(tree));
        assert.deepEqual(tree.map(line => line.split("\t")[1]), ["GOAL.md", "RATIONALE.md", "decisions/a..b.md"]);
        for (const [index, result] of contexts.slice(2).entries()) {
            assert.equal(result.stderr, "INVALID_REQUEST");
            assert.equal(env.store.getOperation("a", `ctx-wire-${index}`), null);
        }
        // A new real invocation exercises CLI --reply against an accepted archive object.
        const originalMessage = JSON.parse(env.store.getOperationById(rec1.operation)!.planJson).intent.message;
        const invalidText = join(env.dir, "invalid-text.txt");
        writeFileSync(invalidText, Buffer.from([0xff]));
        writeFileSync(join(env.dir, "scenarios.json"), JSON.stringify([{
                args: ["send", "--reply", join(env.state, "mail/archive/cur", `${originalMessage.id}:2,`), "--subject", "reply", "--file", bodyFile, "--request", "real-reply"],
                cwd: work, home: homeDir,
            }, {
                args: ["send", "--reply", join(env.dir, "missing-reply.eml"), "--subject", "reply", "--file", bodyFile, "--request", "real-reply"],
            }, {
                args: ["send", "b", "--subject", "invalid text", "--file", invalidText, "--request", "invalid-text"],
            }, {
                frame: { v: 1, id: "forged-from", request: "forged-from", method: "mail.send", params: { to: ["b"], subject: "forged", kind: "message", body: "body", from: "principal" } },
            }, {
                frame: { v: 1, id: "header-injection", request: "header-injection", method: "mail.send", params: { to: ["b"], subject: "subject\r\nBcc: principal", kind: "message", body: "body" } },
            }, {
                frame: { v: 1, id: "valid-mail-control", request: "valid-mail-control", method: "mail.send", params: { to: ["b"], subject: "valid", kind: "message", body: "body" } },
            }]));
        await env.units.runScript("a", wrapPath, runEnvironment);
        const replyResults = JSON.parse(readFileSync(outPath, "utf8"));
        assert.equal(replyResults[0].code, 0, JSON.stringify(replyResults));
        assert.equal(replyResults[1].code, 0, JSON.stringify(replyResults));
        assert.equal(JSON.parse(replyResults[0].stdout).operation, JSON.parse(replyResults[1].stdout).operation);
        assert.equal(replyResults[2].code, 2, JSON.stringify(replyResults));
        assert.equal(env.store.getOperation("a", "invalid-text"), null);
        for (const [index, key] of ["forged-from", "header-injection"].entries()) {
            assert.equal(replyResults[index + 3].code, 2, JSON.stringify(replyResults));
            assert.equal(replyResults[index + 3].stderr, "INVALID_REQUEST");
            assert.equal(env.store.getOperation("a", key), null);
        }
        assert.equal(replyResults[5].code, 0, JSON.stringify(replyResults));
        assert.equal(env.store.getOperation("a", "valid-mail-control")?.state, "succeeded");
        const replyMessage = JSON.parse(env.store.getOperation("a", "real-reply")!.planJson).intent.message;
        assert.deepEqual(replyMessage.recipients, ["a"], "direct reply uses original sender, not original recipient");
        assert.ok(env.store.getDelivery(replyMessage.id, "a"));
        const replyDecoded = spawnSync("python3", ["-c",
            "import sys,json,email.policy; from email.parser import BytesParser; m=BytesParser(policy=email.policy.default).parsebytes(sys.stdin.buffer.read()); print(json.dumps({k:str(m[k]).strip() for k in ['Reply-To','In-Reply-To']}))",
        ], { input: readFileSync(join(env.state, replyMessage.objectPath)), encoding: "utf8" });
        assert.equal(replyDecoded.status, 0, replyDecoded.stderr);
        const replyHeaders = JSON.parse(replyDecoded.stdout);
        assert.equal(replyHeaders["Reply-To"], `a@${society}.oma.invalid`);
        assert.equal(replyHeaders["In-Reply-To"], `<${originalMessage.id}@${society}.oma.invalid>`);
    }
    finally {
        await env.cleanup();
    }
});
