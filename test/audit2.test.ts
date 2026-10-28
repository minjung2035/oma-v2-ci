import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// Second focused runtime-correctness audit (P0-1/2/3 + P1-7/8): real socket
// E2E through the native scope-authenticated actor channel. A real PID2 runner runs
// a raw-socket driver (encodeFrame/FrameParser) so we can exercise pipelining,
// stream-length/excess, closed-schema validation, and status filtering at the
// actual broker boundary — never only unit-testing the decoder.
// Consolidation pass additions: capability gate (P0-A), request-key claim (P0-C),
// stream excess pre-accept (P0-D) at the same actor boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { nativeScriptResidents, type NativeScriptResidents } from "./fixtures/native-script-residents.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { GitModule } from "@oma/git";
import { ReconcileModule } from "@oma/reconcile";
import { Broker } from "@oma/broker";
import type { ResolvedAgentSpec } from "@oma/contracts";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import { requireBoundedRejection } from "./fixtures/verification-oracles.js";
const G = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
};
const ROOT = join(import.meta.dirname ?? process.cwd(), "..", "..");
const SHA = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
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
    const dir = mkdtempSync(join(tmpdir(), "oma-a2-"));
    const state = join(dir, "state");
    const runRoot = join(dir, "run");
    const society = `a2${Date.now().toString(36)}`;
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
        capabilities: ["mail.send", "git.submit", "context.publish"],
    });
    const lifecycle = createLifecycleModule(store, units, {
        stateRoot: state,
        projectGit: join(state, "repos", "project.git"),
        society,
        hasGoal: () => true,
        activationAllowed: () => true,
    }, resolver, mail);
    const views = new ViewsModule(store, state, society, "p");
    const git = createGitModule({
        stateRoot: state,
        projectGit: join(state, "repos", "project.git"),
        contextGit: join(state, "repos", "context.git"),
        worldDir: join(state, "world"),
        society,
    }, store, mail, { policyRevision: "audit", protectedPaths: ["x.txt"], checks: [] }, null, null, units.quarantine({ stateRoot: state, projectGit: join(state, "repos/project.git"), contextGit: join(state, "repos/context.git"), worldDir: join(state, "world"), society }));
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
    }, limits: {
        frameBytes: 256 * 1024,
        mailBodyBytes: 64 * 1024,
        subjectBytes: 8 * 1024,
        addresses: 64,
        replyReferences: 64,
        contextFiles: 1024,
        contextBytes: 256 * 1024 * 1024,
        bundleBytes: 256 * 1024 * 1024,
        logBytes: 1024 * 1024,
        batchMaxMessages: 64,
        idleStreamSeconds: 1,
        receiptWaitSeconds: 30,
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
            rmSync(dir, { recursive: true, force: true });
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
function makeCandidate(env: Env, base: string, tag: string): {
    candidate: string;
    bundle: Buffer;
} {
    const clone = join(env.dir, `clone-${tag}`);
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
    sh([
        "clone",
        "-q",
        "--no-local",
        join(env.state, "repos", "project.git"),
        clone,
    ]);
    writeFileSync(join(clone, `${tag}.txt`), tag, "utf8");
    sh(["add", `${tag}.txt`], clone);
    sh(["-c", "user.name=X", "-c", "user.email=x@localhost", "commit", "-qm", tag], clone);
    const candidate = sh(["rev-parse", "HEAD"], clone);
    const exportRef = `refs/oma/export/req-${tag}`;
    sh(["update-ref", exportRef, candidate], clone);
    const bpath = join(env.dir, `${tag}.bundle`);
    sh(["bundle", "create", bpath, exportRef, `^${base}`], clone);
    return { candidate, bundle: Buffer.from(readFileSync(bpath)) };
}
/**
 * Raw socket driver, run inside the owned PID namespace (scope-authenticated actor
 * channel). Drives writes with explicit byte-level control and collects all
 * reply frames in arrival order.
 */
const DRIVER = String.raw `import { writeFileSync, readFileSync } from "node:fs";
import { connect, Socket } from "node:net";
import { FrameParser, encodeFrame } from "@ABS@";
const control = new Socket({ fd: 6, readable: true, writable: true });

async function main() {
  const admin = process.env.OMA_ADMIN_SOCK;
  const scenarios = JSON.parse(readFileSync(process.env.OMA_SCENARIOS_FILE, "utf8"));
  // obtain the actor socket via runner.open
  const actorSock = await new Promise((resolve, reject) => {
    const s = control;
    s.write(encodeFrame({ v: 1, id: "ro", method: "runner.open", params: { agent: process.env.OMA_ACTOR, invocationId: process.env.OMA_TEST_INVOCATION_ID } }));
    const parser = new FrameParser(256 * 1024);
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => reject(new Error("no lease")), 30000);
    s.on("data", (d) => {
      buf = Buffer.concat([buf, Buffer.from(d)]);
      try { for (const f of parser.feed(buf)) { clearTimeout(t); const raw = f.raw; if (raw.ok) resolve(raw.result.socketHostPath); else reject(new Error("lease " + JSON.stringify(raw.error))); } } catch {}
      buf = Buffer.alloc(0);
    });
    s.on("error", reject);
  });

  const results = [];
  for (const sc of scenarios) {
    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (o) => { if (!done) { done = true; resolve({ name: sc.name, ...o }); } };
      const sock = connect(actorSock, () => {
        for (const ev of sc.events) {
          if (ev.t === "frame") sock.write(encodeFrame(ev.frame));
          else if (ev.t === "raw") sock.write(Buffer.from(ev.b64, "base64"));
          else if (ev.t === "coalesced") {
            const blob = Buffer.concat(ev.parts.map((p) => p.b64 ? Buffer.from(p.b64, "base64") : encodeFrame(p.frame)));
            sock.write(blob);
          }
        }
      });
      sock.on("error", () => {});
      const parser = new FrameParser(256 * 1024);
      let buf = Buffer.alloc(0);
      const replies = [];
      const timeoutMs = sc.timeoutMs ?? (sc.expect > 0 ? 90000 : 8000);
      const timer = setTimeout(() => { sock.destroy(); finish({ replies, timeout: true }); }, timeoutMs);
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, Buffer.from(d)]);
        try { for (const f of parser.feed(buf)) replies.push(f.raw); } catch {}
        buf = Buffer.alloc(0);
        if (sc.expect > 0 && replies.length >= sc.expect) { clearTimeout(timer); sock.destroy(); finish({ replies }); }
      });
      sock.on("close", () => { clearTimeout(timer); finish({ replies }); });
      // half-close after a delay triggers the broker's short-stream EOF path
      if (sc.closeAfterMs) setTimeout(() => { try { sock.end(); } catch {} }, sc.closeAfterMs);
    });
    results.push(result);
  }
  writeFileSync(process.env.OMA_OUT, JSON.stringify(results));
  process.exit(0);
}
main().then(() => process.exit(0)).catch((e) => { try { writeFileSync(process.env.OMA_OUT, JSON.stringify({ fatal: String(e && e.message || e) })); } catch {} process.exit(3); });
`;
const CONCURRENT_DRIVER = String.raw `import { writeFileSync, readFileSync } from "node:fs";
import { connect, Socket } from "node:net";
import { FrameParser, encodeFrame } from "@ABS@";
const control = new Socket({ fd: 6, readable: true, writable: true });

const once = (path, request) => new Promise((resolve, reject) => {
  const sock = path === process.env.OMA_ADMIN_SOCK ? control : connect(path, () => sock.write(encodeFrame(request)));
  if (sock === control) sock.write(encodeFrame(request));
  const parser = new FrameParser(256 * 1024);
  let buf = Buffer.alloc(0);
  const timer = setTimeout(() => { sock.destroy(); reject(new Error("request timeout")); }, 30000);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, Buffer.from(d)]);
    try {
      for (const f of parser.feed(buf)) {
        clearTimeout(timer);
        if (sock !== control) sock.destroy();
        resolve(f.raw);
        return;
      }
    } catch {}
    buf = Buffer.alloc(0);
  });
  sock.on("error", reject);
});

async function main() {
  const admin = process.env.OMA_ADMIN_SOCK;
  const actor = process.env.OMA_ACTOR;
  const lease = await once(admin, { v: 1, id: "ro", method: "runner.open", params: { agent: actor, invocationId: process.env.OMA_TEST_INVOCATION_ID } });
  if (!lease.ok) throw new Error(JSON.stringify(lease));
  const actorSock = lease.result.socketHostPath;
  const requests = JSON.parse(readFileSync(process.env.OMA_REQUESTS_FILE, "utf8"));
  const replies = await Promise.all(requests.map((request) => once(actorSock, request)));
  writeFileSync(process.env.OMA_OUT, JSON.stringify(replies));
}

main().then(() => process.exit(0)).catch((e) => { try { writeFileSync(process.env.OMA_OUT, JSON.stringify({ fatal: String(e && e.message || e) })); } catch {} process.exit(3); });
`;
test("P0-1/2/3 + P1-7/8: real-socket serialization, stream length, closed schema, status filter", async (t) => {
    const env = await envOf();
    const society = env.society;
    try {
        const base = seedProject(env);
        const cand = makeCandidate(env, base, "x");
        const cand2 = makeCandidate(env, base, "y");
        const badBundle = Buffer.from(cand.bundle);
        badBundle[0] = badBundle[0]! ^ 1;
        const submitMeta = (key: string, bundle: Buffer) => ({
            v: 1,
            id: key,
            method: "git.submit",
            request: key,
            params: {
                candidate: cand.candidate,
                exportRef: `refs/oma/export/req-x`,
                prerequisites: [base],
                to: ["b"],
                subject: "s",
                body: "",
                paths: [],
                bundle: {
                    bytes: bundle.length,
                    sha256: SHA(bundle),
                    mediaType: "application/x-git-bundle",
                },
            },
        });
        const mailFrame = (id: string, key: string, body: string, to = ["b"]) => ({
            v: 1,
            id,
            method: "mail.send",
            request: key,
            params: { to, subject: "mail", kind: "message", body },
        });
        const scenarios = [
            // P0-1 serialization: slow git.submit FIRST, fast status.get SECOND,
            // pipelined on one socket. status must respond strictly after submit.
            {
                name: "serialize",
                expect: 2,
                timeoutMs: 120000,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "c1",
                            method: "git.submit",
                            request: "serial-1",
                            params: {
                                candidate: cand.candidate,
                                exportRef: "refs/oma/export/req-ser",
                                prerequisites: [base],
                                to: ["b"],
                                subject: "s",
                                body: "",
                                paths: [],
                                bundle: {
                                    bytes: cand.bundle.length,
                                    sha256: SHA(cand.bundle),
                                    mediaType: "application/x-git-bundle",
                                },
                            },
                        },
                    },
                    { t: "raw", b64: cand.bundle.toString("base64") },
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "s1",
                            method: "status.get",
                            params: { agent: "a" },
                        },
                    },
                ],
            },
            // P0-D exact over-delivery boundaries (N+1, N+2, N+3) stay preaccept.
            {
                name: "excess-1",
                expect: 1,
                timeoutMs: 8000,
                closeAfterMs: 300,
                events: [
                    { t: "frame", frame: submitMeta("excess-1", Buffer.from("abcd")) },
                    { t: "raw", b64: Buffer.from("abcdX").toString("base64") },
                ],
            },
            {
                name: "excess-2",
                expect: 1,
                timeoutMs: 8000,
                closeAfterMs: 300,
                events: [
                    { t: "frame", frame: submitMeta("excess-2", Buffer.from("abcd")) },
                    { t: "raw", b64: Buffer.from("abcdXY").toString("base64") },
                ],
            },
            {
                name: "excess-3",
                expect: 1,
                timeoutMs: 8000,
                closeAfterMs: 300,
                events: [
                    { t: "frame", frame: submitMeta("excess-3", Buffer.from("abcd")) },
                    { t: "raw", b64: Buffer.from("abcdXYZ").toString("base64") },
                ],
            },
            {
                name: "hash-mismatch",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            ...submitMeta("hash-mismatch", cand.bundle),
                            params: {
                                ...submitMeta("hash-mismatch", cand.bundle).params,
                                bundle: { ...submitMeta("hash-mismatch", cand.bundle).params.bundle, sha256: "0".repeat(64) },
                            },
                        },
                    },
                    { t: "raw", b64: cand.bundle.toString("base64") },
                ],
            },
            {
                name: "stream-timeout",
                expect: 1,
                timeoutMs: 5000,
                events: [{ t: "frame", frame: submitMeta("stream-timeout", cand.bundle) }],
            },
            // P0-2 exact stream
            {
                name: "exact",
                expect: 1,
                timeoutMs: 120000,
                events: [
                    { t: "frame", frame: submitMeta("exact", cand.bundle) },
                    { t: "raw", b64: cand.bundle.toString("base64") },
                ],
            },
            // P0-2 short stream + EOF (close right after) -> STREAM_INVALID, no mutation
            {
                name: "short",
                expect: 1,
                timeoutMs: 8000,
                closeAfterMs: 300,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "short",
                            method: "git.submit",
                            request: "short",
                            params: {
                                candidate: cand.candidate,
                                exportRef: "refs/oma/export/req-short",
                                prerequisites: [base],
                                to: ["b"],
                                subject: "s",
                                body: "",
                                paths: [],
                                bundle: {
                                    bytes: cand.bundle.length,
                                    sha256: SHA(cand.bundle),
                                    mediaType: "application/x-git-bundle",
                                },
                            },
                        },
                    },
                    {
                        t: "raw",
                        b64: Buffer.from(cand.bundle.subarray(0, 20)).toString("base64"),
                    },
                ],
            },
            // P0-2 excess garbage (desc=4 + "abcd" + garbage) -> STREAM_INVALID, mutation must NOT succeed
            {
                name: "excess-garbage",
                expect: 1,
                timeoutMs: 8000,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "eg",
                            method: "git.submit",
                            request: "excess-garbage",
                            params: {
                                candidate: cand.candidate,
                                exportRef: "refs/oma/export/req-excess-garbage",
                                prerequisites: [base],
                                to: ["b"],
                                subject: "s",
                                body: "",
                                paths: [],
                                bundle: {
                                    bytes: 4,
                                    sha256: SHA(Buffer.from("abcd")),
                                    mediaType: "application/x-git-bundle",
                                },
                            },
                        },
                    },
                    {
                        t: "raw",
                        b64: Buffer.from("abcdgarbagegarbage").toString("base64"),
                    },
                ],
            },
            // P0-2 coalesced (meta+raw in one kernel read) -> success
            {
                name: "coalesced",
                expect: 1,
                timeoutMs: 120000,
                events: [
                    {
                        t: "coalesced",
                        parts: [
                            { frame: submitMeta("coal", cand.bundle) },
                            { b64: cand.bundle.toString("base64") },
                        ],
                    },
                ],
            },
            // P0-3: a stream submit followed contiguously by a next control request;
            // the next request must not be dispatched before the submit completes
            // (serialized) -> reply order [submit, status].
            {
                name: "stream-then-next",
                expect: 2,
                timeoutMs: 120000,
                events: [
                    {
                        t: "coalesced",
                        parts: [
                            { frame: submitMeta("stn", cand.bundle) },
                            { b64: cand.bundle.toString("base64") },
                            {
                                frame: {
                                    v: 1,
                                    id: "s2",
                                    method: "status.get",
                                    params: { agent: "a" },
                                },
                            },
                        ],
                    },
                ],
            },
            // P1-7 status filter: different agents must not collapse to unfiltered
            {
                name: "mail-idempotent",
                expect: 2,
                events: [
                    { t: "frame", frame: mailFrame("m1", "mail-same", "body") },
                    { t: "frame", frame: mailFrame("m2", "mail-same", "body") },
                ],
            },
            {
                name: "mail-reused-body",
                expect: 2,
                events: [
                    { t: "frame", frame: mailFrame("m3", "mail-body", "body") },
                    { t: "frame", frame: mailFrame("m4", "mail-body", "different") },
                ],
            },
            {
                name: "mail-reused-recipient",
                expect: 2,
                events: [
                    { t: "frame", frame: mailFrame("m5", "mail-to", "body", ["b"]) },
                    { t: "frame", frame: mailFrame("m6", "mail-to", "body", ["commons"]) },
                ],
            },
            {
                name: "git-idempotent",
                expect: 2,
                timeoutMs: 120000,
                events: [
                    { t: "frame", frame: submitMeta("git-same", cand.bundle) },
                    { t: "raw", b64: cand.bundle.toString("base64") },
                    { t: "frame", frame: { ...submitMeta("git-same", cand.bundle), id: "git-same-2" } },
                    { t: "raw", b64: cand.bundle.toString("base64") },
                ],
            },
            {
                name: "git-retry-bad-stream",
                expect: 1,
                events: [
                    { t: "frame", frame: { ...submitMeta("git-same", cand.bundle), id: "git-same-bad" } },
                    { t: "raw", b64: badBundle.toString("base64") },
                ],
            },
            {
                name: "integrate-protected",
                expect: 1,
                events: [{ t: "frame", frame: {
                            v: 1, id: "integrate-protected", method: "git.integrate", request: "integrate-protected",
                            params: { candidate: cand.candidate, expected: base },
                        } }],
            },
            {
                name: "git-reused-candidate",
                expect: 2,
                timeoutMs: 120000,
                events: [
                    { t: "frame", frame: submitMeta("git-different", cand.bundle) },
                    { t: "raw", b64: cand.bundle.toString("base64") },
                    {
                        t: "frame",
                        frame: {
                            ...submitMeta("git-different", cand2.bundle),
                            id: "git-different-2",
                            params: { ...submitMeta("git-different", cand2.bundle).params, exportRef: "refs/oma/export/req-y" },
                        },
                    },
                    { t: "raw", b64: cand2.bundle.toString("base64") },
                ],
            },
            // P0-A: method-specific capabilities are enforced at the actor boundary.
            {
                name: "status-a",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "a1",
                            method: "status.get",
                            params: { agent: "a" },
                        },
                    },
                ],
            },
            {
                name: "status-b",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "b1",
                            method: "status.get",
                            params: { agent: "b" },
                        },
                    },
                ],
            },
            // P1-8 closed-schema negatives
            {
                name: "neg-oid",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "n1",
                            method: "git.known",
                            params: { candidate: "not-an-oid" },
                        },
                    },
                ],
            },
            {
                name: "neg-unknown-param",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "n2",
                            method: "status.get",
                            params: { agent: "a", extra: 1 },
                        },
                    },
                ],
            },
            {
                name: "neg-bad-prereq",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "n3",
                            method: "git.submit",
                            request: "n3",
                            params: {
                                candidate: cand.candidate,
                                exportRef: "r",
                                prerequisites: ["zz"],
                                to: ["b"],
                                subject: "s",
                                body: "",
                                paths: [],
                            },
                        },
                    },
                ],
            },
            {
                name: "neg-version",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: { v: 2, id: "n4", method: "status.get", params: {} },
                    },
                ],
            },
            {
                name: "neg-read-request",
                expect: 1,
                events: [
                    {
                        t: "frame",
                        frame: {
                            v: 1,
                            id: "n5",
                            method: "status.get",
                            params: { agent: "a" },
                            request: "forbidden",
                        },
                    },
                ],
            },
        ];
        const driverPath = join(env.dir, "driver.mjs");
        writeFileSync(driverPath, DRIVER.replace("@ABS@", new URL(import.meta.resolve("@oma/protocol/frame")).pathname), "utf8");
        writeFileSync(join(env.dir, "scenarios.json"), JSON.stringify(scenarios), "utf8");
        const outPath = join(env.dir, "out.json");
        await env.units.runScript("a", driverPath, {
            OMA_ADMIN_SOCK: "private-runner-control", OMA_ACTOR: "a", OMA_SCENARIOS_FILE: join(env.dir, "scenarios.json"),
            OMA_OUT: outPath, HOME: env.dir,
        });
        assert.ok(existsSync(outPath), "native driver produced no output");
        const results = JSON.parse(readFileSync(outPath, "utf8")) as Array<{
            name: string;
            replies?: Array<{
                id?: string;
                ok?: boolean;
                error?: {
                    code: string;
                };
                result?: unknown;
            }>;
            timeout?: boolean;
            fatal?: string;
        }>;
        const byName = (n: string) => results.find((r) => r.name === n);
        const ids = (n: string) => (byName(n)?.replies ?? []).map((r) => r.id);
        if (process.env.DUMP_A2) {
            writeFileSync("/tmp/a2-results.json", JSON.stringify(results, null, 2));
        }
        // P0-1: status (s1) strictly after context (c1); context is slow so if
        // they ran concurrently the fast status could respond first.
        assert.deepEqual(ids("serialize"), ["c1", "s1"], "pipelined requests must serialize on one socket");
        // P0-2 exact: submit succeeded
        assert.equal(byName("exact")?.replies?.[0]?.ok, true, `exact submit: ${JSON.stringify(byName("exact")?.replies)}`);
        // Half-close keeps the client's read side open: silence is not rejection.
        requireBoundedRejection(byName("short"), "STREAM_INVALID", "short");
        assert.equal(env.store.getOperation("a", "short"), null, "short must remain preaccept");
        for (const name of ["excess-1", "excess-2", "excess-3"] as const) {
            const result = byName(name);
            requireBoundedRejection(result, "STREAM_INVALID", name);
            assert.equal(env.store.getOperation("a", name), null, `${name} must remain preaccept`);
        }
        const mismatch = byName("hash-mismatch");
        requireBoundedRejection(mismatch, "STREAM_INVALID", "hash-mismatch");
        assert.equal(env.store.getOperation("a", "hash-mismatch"), null);
        const timeout = byName("stream-timeout");
        requireBoundedRejection(timeout, "STREAM_INVALID", "stream-timeout");
        assert.equal(env.store.getOperation("a", "stream-timeout"), null);
        // P0-2 excess garbage: STREAM_INVALID, mutation must NOT succeed
        const eg = byName("excess-garbage");
        requireBoundedRejection(eg, "STREAM_INVALID", "eg");
        const egOp = env.store.transaction((_t) => env.store.getOperation("a", "excess-garbage"));
        assert.equal(egOp, null, "excess garbage must not create an operation (mutation must not succeed)");
        // P0-2 coalesced: success
        assert.equal(byName("coalesced")?.replies?.[0]?.ok, true, `coalesced: ${JSON.stringify(byName("coalesced")?.replies)}`);
        // P0-3: stream submit then next control request: submit first, status second
        assert.deepEqual(ids("stream-then-next"), ["stn", "s2"], "next request must wait for the stream submit");
        // P0-C: broker-side request-key semantics on the real actor socket.
        const same = byName("mail-idempotent")?.replies ?? [];
        assert.equal(same[0]?.ok, true);
        assert.equal(same[1]?.ok, true);
        assert.equal((same[0]?.result as {
            operation: string;
        }).operation, (same[1]?.result as {
            operation: string;
        }).operation);
        assert.equal(env.store.getOperation("a", "mail-same")?.state, "succeeded");
        const bodyReuse = byName("mail-reused-body")?.replies ?? [];
        assert.equal(bodyReuse[0]?.ok, true);
        assert.equal(bodyReuse[1]?.error?.code, "REQUEST_KEY_REUSED");
        const bodyOp = env.store.getOperation("a", "mail-body");
        assert.ok(bodyOp);
        assert.equal(env.store.deliveriesForOperation(bodyOp.id).length, 1);
        const recipientReuse = byName("mail-reused-recipient")?.replies ?? [];
        assert.equal(recipientReuse[0]?.ok, true);
        assert.equal(recipientReuse[1]?.error?.code, "REQUEST_KEY_REUSED");
        const recipientOp = env.store.getOperation("a", "mail-to");
        assert.ok(recipientOp);
        assert.equal(env.store.deliveriesForOperation(recipientOp.id).length, 1);
        const gitSame = byName("git-idempotent")?.replies ?? [];
        assert.equal(gitSame[0]?.ok, true, `first git-idempotent response: ${JSON.stringify(gitSame[0])}`);
        assert.equal(gitSame[1]?.ok, true, `second git-idempotent response: ${JSON.stringify(gitSame[1])}`);
        assert.equal((gitSame[0]?.result as {
            operation: string;
        }).operation, (gitSame[1]?.result as {
            operation: string;
        }).operation);
        const badRetry = byName("git-retry-bad-stream")?.replies ?? [];
        assert.equal(badRetry[0]?.error?.code, "STREAM_INVALID");
        assert.equal(env.store.getOperation("a", "git-same")?.state, "succeeded");
        const gitReuse = byName("git-reused-candidate")?.replies ?? [];
        assert.equal(gitReuse[0]?.ok, true);
        assert.equal(gitReuse[1]?.error?.code, "REQUEST_KEY_REUSED");
        const gitOp = env.store.getOperation("a", "git-different");
        assert.ok(gitOp);
        assert.equal(env.store.deliveriesForOperation(gitOp.id).length, 1);
        const protectedIntegrate = byName("integrate-protected")?.replies ?? [];
        assert.equal(protectedIntegrate[0]?.error?.code, "PROTECTED_PATH");
        assert.equal(env.store.getOperation("a", "integrate-protected")?.state, "failed");
        assert.equal(env.store.getOperation("a", "integrate-protected")?.errorCode, "PROTECTED_PATH");
        // P1-7: status filter — a and b return only their own agent
        // The closed status.get result carries the observation time and the agents.
        const statusOf = (name: string) => byName(name)?.replies?.[0]?.result as {
            observedAtMs?: number;
            agents?: Array<{
                agent: string;
            }>;
        } | undefined;
        const sa = statusOf("status-a");
        const sb = statusOf("status-b");
        assert.ok(Number.isSafeInteger(sa?.observedAtMs) && sa?.agents?.length === 1 && sa.agents[0]!.agent === "a", `status a: ${JSON.stringify(sa)}`);
        assert.ok(Number.isSafeInteger(sb?.observedAtMs) && sb?.agents?.length === 1 && sb.agents[0]!.agent === "b", `status b: ${JSON.stringify(sb)}`);
        // P1-8 closed-schema negatives
        assert.equal(byName("neg-oid")?.replies?.[0]?.error?.code, "INVALID_REQUEST", "git.known bad oid");
        assert.equal(byName("neg-unknown-param")?.replies?.[0]?.error?.code, "INVALID_REQUEST", "status.get unknown param");
        assert.equal(byName("neg-bad-prereq")?.replies?.[0]?.error?.code, "INVALID_REQUEST", "git.submit bad prereq");
        assert.equal(byName("neg-version")?.replies?.[0]?.error?.code, "UNSUPPORTED_VERSION", "v=2 must be rejected");
        assert.equal(byName("neg-read-request")?.replies?.[0]?.error?.code, "INVALID_REQUEST", "read method with top-level request");
    }
    finally {
        await env.cleanup();
    }
});
test("P0-C: concurrent request-key races converge on one actor-socket effect", async (t) => {
    const env = await envOf();
    try {
        const mail = (id: string, key: string, body: string) => ({
            v: 1, id, method: "mail.send", request: key,
            params: { to: ["b"], subject: "race", kind: "message", body },
        });
        const requests = [mail("same-1", "race-same", "body"), mail("same-2", "race-same", "body"), mail("diff-1", "race-diff", "one"), mail("diff-2", "race-diff", "two")];
        const driverPath = join(env.dir, "concurrent-driver.mjs");
        const requestsPath = join(env.dir, "concurrent-requests.json");
        const outPath = join(env.dir, "concurrent-out.json");
        writeFileSync(driverPath, CONCURRENT_DRIVER.replace("@ABS@", new URL(import.meta.resolve("@oma/protocol/frame")).pathname), "utf8");
        writeFileSync(requestsPath, JSON.stringify(requests), "utf8");
        await env.units.runScript("a", driverPath, {
            OMA_ADMIN_SOCK: "private-runner-control", OMA_ACTOR: "a", OMA_REQUESTS_FILE: requestsPath,
            OMA_OUT: outPath, HOME: env.dir,
        });
        assert.ok(existsSync(outPath), "native concurrent driver produced no output");
        const replies = JSON.parse(readFileSync(outPath, "utf8")) as Array<{
            ok?: boolean;
            result?: {
                operation: string;
            };
            error?: {
                code: string;
            };
        }>;
        const same = replies.slice(0, 2);
        assert.equal(same[0]?.ok, true);
        assert.equal(same[1]?.ok, true);
        assert.equal(same[0]?.result?.operation, same[1]?.result?.operation);
        const diff = replies.slice(2);
        assert.equal(diff.filter((r) => r.ok).length, 1);
        assert.equal(diff.filter((r) => r.error?.code === "REQUEST_KEY_REUSED").length, 1);
        assert.ok(env.store.getOperation("a", "race-same"));
        const raceDiff = env.store.getOperation("a", "race-diff");
        assert.ok(raceDiff);
        assert.equal(env.store.deliveriesForOperation(raceDiff.id).length, 1);
    }
    finally {
        await env.cleanup();
    }
});
