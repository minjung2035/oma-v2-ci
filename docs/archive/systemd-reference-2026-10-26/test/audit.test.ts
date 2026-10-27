import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
// Runtime-correctness audit regression (P0): IPC framing, stream
// chunk-boundary ownership, per-connection stream isolation, and READY
// ordering — every claim here is executable.
//  Part A: ConnectionDecoder byte-boundary unit cases (6)
//  Part B: real broker socket round-trip over unix sockets (framed E2E)
//  Part C: real systemd user-unit E2E — two concurrent git.submit uploads
//          through the real actor channel (cgroup auth), chunking variants
//  Part D: entry/broker.js ordered bootstrap — READY=1 only after recovery,
//          startup failure -> exit 1 with no READY and no serving
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { spawnSync, spawn } from "node:child_process";
import { ConnectionDecoder, FrameParser, encodeFrame } from "@oma/protocol/frame";
import { Store } from "@oma/storage";
import { requestHash } from "@oma/domain/request-identity";
import { MailModule } from "@oma/mail";
import { UnitsModule } from "@oma/platform-linux/units";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { GitModule } from "@oma/git";
import { deploymentDigest } from "#oma-test/app/runtime/deployment-manifest";
import { ReconcileModule } from "@oma/reconcile";
import { Broker } from "@oma/broker";
import { loadConfig } from "@oma/config";
import { resolveChildSpec } from "@oma/domain/child-policy";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { unitName } from "@oma/platform-linux/units";
import type { ResolvedAgentSpec } from "@oma/contracts";
import { cleanupOwnedSystemdUnits, requireSystemdTestManager, } from "./fixtures/systemd.js";
import { requireSubmitConvergence } from "./fixtures/verification-oracles.js";
requireSystemdTestManager();
const G = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
};
// ---------------------------------------------------------------------------
// Part A — ConnectionDecoder byte-boundary cases
// ---------------------------------------------------------------------------
/** one metadata frame for git.submit that declares `bodyBytes` raw bytes */
function metaFrame(bodyBytes: number, extra: Record<string, unknown> = {}): Buffer {
    const raw = {
        v: 1,
        id: "sub",
        method: "git.submit",
        params: {
            candidate: "c".repeat(40),
            exportRef: "refs/oma/export/req-1",
            prerequisites: [],
            to: ["b"],
            subject: "s",
            body: "",
            paths: [],
            bundle: { bytes: bodyBytes, sha256: "0".repeat(64), mediaType: "x" },
            ...extra,
        },
    };
    return encodeFrame(raw);
}
test("A1: metadata frame and raw stream fully separated (two data events)", () => {
    const dec = new ConnectionDecoder(64 * 1024);
    const meta = metaFrame(11);
    const ev1 = dec.push(meta);
    assert.equal(ev1.length, 1);
    assert.equal(ev1[0]!.kind, "frame");
    // broker would call beginStream here (declared = params.bundle.bytes)
    const begin = dec.beginStream(11);
    assert.equal(begin.length, 0); // no raw queued yet
    const ev2 = dec.push(Buffer.from("0123456789A"));
    assert.equal(ev2.length, 1);
    assert.equal(ev2[0]!.kind, "stream");
    assert.equal((ev2[0]! as {
        bytes: Buffer;
    }).bytes.toString(), "0123456789A");
    assert.equal(dec.streaming(), false);
});
test("A2: metadata's last byte and the raw's first bytes share one chunk", () => {
    const dec = new ConnectionDecoder(64 * 1024);
    const meta = metaFrame(10);
    const raw = Buffer.from("abcdefghij");
    const before = meta.subarray(0, meta.length - 3); // all but the last 3 meta bytes
    const seam = Buffer.concat([
        meta.subarray(meta.length - 3),
        raw.subarray(0, 4),
    ]);
    const rest = raw.subarray(4);
    const ev1 = dec.push(before);
    assert.equal(ev1.length, 0); // incomplete frame
    const ev2 = dec.push(seam);
    assert.equal(ev2.length, 1);
    assert.equal(ev2[0]!.kind, "frame");
    dec.beginStream(10);
    const ev3 = dec.push(rest);
    assert.equal(ev3.length, 1);
    assert.equal(ev3[0]!.kind, "stream");
    assert.equal((ev3[0]! as {
        bytes: Buffer;
    }).bytes.toString(), "abcdefghij");
});
test("A3: raw body split at arbitrary byte boundaries (1-byte pushes)", () => {
    const dec = new ConnectionDecoder(64 * 1024);
    dec.push(metaFrame(9));
    dec.beginStream(9);
    const raw = Buffer.from("123456789");
    for (let i = 0; i < 8; i++) {
        const ev = dec.push(raw.subarray(i, i + 1));
        assert.equal(ev.length, 0, `no event until complete (byte ${i})`);
        assert.equal(dec.streaming(), true);
    }
    // the 9th byte completes the declared length -> exactly the stream event
    const evLast = dec.push(raw.subarray(8));
    assert.equal(evLast.length, 1);
    assert.equal(evLast[0]!.kind, "stream");
    assert.equal(dec.streaming(), false);
});
test("A4: under-delivery stays streaming; over-delivery with non-frame leftover is invalid", () => {
    const dec = new ConnectionDecoder(64 * 1024);
    dec.push(metaFrame(10));
    dec.beginStream(10);
    assert.equal(dec.streaming(), true);
    dec.push(Buffer.from("abc")); // only 3 of 10
    assert.equal(dec.streaming(), true); // still collecting
    const evDone = dec.push(Buffer.from("defghij")); // 10 total -> completes
    assert.equal(evDone.length, 1);
    assert.equal(evDone[0]!.kind, "stream");
    assert.equal(dec.streaming(), false);
    // excess: leftover bytes that cannot parse as a frame -> invalid (not silent)
    const dec2 = new ConnectionDecoder(64 * 1024);
    dec2.push(metaFrame(4));
    dec2.beginStream(4);
    const evs = dec2.push(Buffer.from("abcdgarbage-not-a-frame"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0]!.kind, "stream");
    const evMore = dec2.resumeParsing();
    assert.equal(evMore.length, 1);
    assert.equal(evMore[0]!.kind, "invalid");
});
test("A5: metadata + raw + next control frame contiguous in one chunk", () => {
    const dec = new ConnectionDecoder(64 * 1024);
    const meta = metaFrame(6);
    const raw = Buffer.from("abcdef");
    const next = encodeFrame({
        v: 1,
        id: "st",
        method: "status.get",
        params: {},
    });
    const evs = dec.push(Buffer.concat([meta, raw, next]));
    assert.deepEqual(evs.map((e) => e.kind), ["frame"]); // one frame per drain
    // broker path: decide stream -> beginStream consumes the already-queued raw
    const evStream = dec.beginStream(6);
    assert.deepEqual(evStream.map((e) => e.kind), ["stream"]);
    // broker path: decision "no stream" -> resumeParsing yields the next frame
    const evNext = dec.resumeParsing();
    assert.deepEqual(evNext.map((e) => e.kind), ["frame"]);
});
test("A6: two decoders on interleaved streams never share bytes", () => {
    const a = new ConnectionDecoder(64 * 1024);
    const b = new ConnectionDecoder(64 * 1024);
    const metaA = metaFrame(5, { request: "req-a" });
    const metaB = metaFrame(9, { request: "req-b" });
    a.push(metaA);
    b.push(metaB);
    a.beginStream(5);
    b.beginStream(9);
    const evA = a.push(Buffer.from("AAAAA"));
    const evB = b.push(Buffer.from("BBBBBBBBB"));
    assert.equal((evA[0]! as {
        bytes: Buffer;
    }).bytes.toString(), "AAAAA");
    assert.equal((evB[0]! as {
        bytes: Buffer;
    }).bytes.toString(), "BBBBBBBBB");
});
// ---------------------------------------------------------------------------
// Part B — real broker socket round-trip (framed responses)
// ---------------------------------------------------------------------------
interface BrokerEnv {
    dir: string;
    state: string;
    runRoot: string;
    society: string;
    store: Store;
    broker: Broker;
    git: GitModule;
    cleanup: () => void;
}
function brokerEnv(): BrokerEnv {
    const dir = mkdtempSync(join(tmpdir(), "oma-audit-"));
    const state = join(dir, "state");
    const runRoot = join(dir, "run");
    const society = `au${Date.now().toString(36)}`;
    mkdirSync(state, { recursive: true });
    mkdirSync(runRoot, { recursive: true });
    const store = new Store(join(state, "runtime.sqlite"));
    const units = new UnitsModule(society, {
        node: process.execPath,
        libdir: "/usr/lib/oma",
        state,
        society,
        agent: "", config: join(state, "config.json"), run: join(state, "oma", society)
    }, join(dir, "xdg"));
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
        capabilities: ["mail.send", "route.follow", "git.submit"],
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
    }, store, mail, null);
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
    broker.start();
    return {
        dir,
        state,
        runRoot,
        society,
        store,
        broker,
        git,
        cleanup: () => {
            try {
                broker.drainAndClose();
            }
            catch {
                /* store may already be closed */
            }
            cleanupOwnedSystemdUnits(dir, society);
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
/** production-client pattern: encodeFrame requests, FrameParser responses */
function framedCall(sockPath: string, frame: unknown, stream?: Buffer, opts: {
    chunkSize?: number | "coalesced" | "split";
} = {}): Promise<Array<Record<string, unknown>>> {
    return new Promise((resolve, reject) => {
        const sock = connect(sockPath, () => {
            const meta = encodeFrame(frame);
            if (!stream) {
                sock.write(meta);
            }
            else if (opts.chunkSize === "coalesced") {
                sock.write(Buffer.concat([meta, stream]));
            }
            else if (opts.chunkSize === "split") {
                // arbitrary byte splits across the whole payload
                const all = Buffer.concat([meta, stream]);
                let off = 0;
                const timer = setInterval(() => {
                    const step = 1 + Math.floor(Math.random() * 13);
                    const end = Math.min(all.length, off + step);
                    sock.write(all.subarray(off, end));
                    off = end;
                    if (off >= all.length)
                        clearInterval(timer);
                }, 5);
            }
            else {
                sock.write(meta);
                setTimeout(() => {
                    // raw in 3 sequential chunks with a delay (separated variant)
                    const n = Math.ceil(stream.length / 3);
                    for (let i = 0; i < 3; i++) {
                        const s = stream.subarray(i * n, Math.min(stream.length, (i + 1) * n));
                        if (s.length > 0)
                            sock.write(s);
                    }
                }, 30);
            }
        });
        const parser = new FrameParser(256 * 1024);
        let buf = Buffer.alloc(0);
        const replies: Array<Record<string, unknown>> = [];
        const timer = setTimeout(() => {
            sock.destroy();
            reject(new Error("framedCall timeout"));
        }, 15000);
        sock.on("data", (d) => {
            buf = Buffer.concat([buf, Buffer.from(d)]);
            try {
                for (const f of parser.feed(buf)) {
                    replies.push(f.raw as Record<string, unknown>);
                }
            }
            catch {
                /* incomplete */
            }
            buf = Buffer.alloc(0);
            if (replies.length > 0) {
                clearTimeout(timer);
                sock.destroy();
                resolve(replies);
            }
        });
        sock.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}
test("B1/IPC-009: framed runner channel rejects host methods", async () => {
    const env = brokerEnv();
    try {
        const replies = await framedCall(join(env.runRoot, "admin.sock"), {
            v: 1,
            id: "h1",
            method: "host.principalRelay",
            params: {},
        });
        assert.equal(replies.length, 1);
        assert.equal(replies[0]!.ok, false);
        assert.equal((replies[0]!.error as {
            code: string;
        }).code, "AUTH_FAILED");
        // unknown method -> framed error answer, still parsable by a FrameParser client
        const err = await framedCall(join(env.runRoot, "admin.sock"), {
            v: 1,
            id: "h2",
            method: "no.such.method",
            params: {},
        });
        assert.equal(err.length, 1);
        assert.equal(err[0]!.ok, false);
        assert.equal((err[0]!.error as {
            code: string;
        }).code, "UNKNOWN_METHOD");
    }
    finally {
        env.cleanup();
    }
});
// ---------------------------------------------------------------------------
// Part C — real systemd user-unit E2E: concurrent streamed submits
// ---------------------------------------------------------------------------
function seedProject(env: Pick<BrokerEnv, "dir" | "state">): string {
    const seedDir = join(env.dir, "seed");
    mkdirSync(seedDir, { recursive: true });
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
    sh(["init", "-q", "-b", "main"], seedDir);
    writeFileSync(join(seedDir, "base.txt"), "a".repeat(131072) + "\n", "utf8");
    sh(["add", "-A"], seedDir);
    sh([
        "-c",
        "user.name=O",
        "-c",
        "user.email=o@localhost",
        "commit",
        "-qm",
        "base",
    ], seedDir);
    const base = sh(["rev-parse", "HEAD"], seedDir);
    sh([
        "clone",
        "-q",
        "--bare",
        seedDir,
        join(env.state, "repos", "project.git"),
    ]);
    sh([
        "--git-dir",
        join(env.state, "repos", "project.git"),
        "symbolic-ref",
        "HEAD",
        "refs/heads/main",
    ]);
    return base;
}
/** commit a candidate + bundle against base in its own clone */
function makeCandidate(env: BrokerEnv, base: string, tag: string): {
    candidate: string;
    bundle: Buffer;
    exportRef: string;
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
    return { candidate, bundle: Buffer.from(readFileSync(bpath)), exportRef };
}
const HELPER_SRC = String.raw `import { connect } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { encodeFrame, FrameParser } from "@ABS@";
const admin = process.env.OMA_ADMIN_SOCK;
const bundlePath = process.env.OMA_BUNDLE;
const actor = process.env.OMA_ACTOR;
const variant = process.env.OMA_VARIANT;
const out = process.env.OMA_OUT;
const candidate = process.env.OMA_CANDIDATE;
const base = process.env.OMA_BASE;
const exportRef = process.env.OMA_EXPORT_REF;
const bundle = readFileSync(bundlePath);
const sha = (b) => createHash("sha256").update(b).digest("hex");

function framed(sockPath, frame, streamBytes, mode, wantReplies = 1) {
  return new Promise((resolve, reject) => {
    const sock = connect(sockPath, () => {
      const meta = encodeFrame(frame);
      if (mode === "coalesced") sock.write(Buffer.concat([meta, streamBytes]));
      else if (mode === "split") {
        const all = Buffer.concat([meta, streamBytes]);
        let off = 0;
        const t = setInterval(() => {
          const step = 1 + Math.floor(Math.random() * 17);
          const end = Math.min(all.length, off + step);
          sock.write(all.subarray(off, end));
          off = end;
          if (off >= all.length) { clearInterval(t); }
        }, 4);
      } else {
        sock.write(meta);
        setTimeout(() => {
          const third = Math.ceil(streamBytes.length / 3);
          for (let i = 0; i < 3; i++) {
            const s = streamBytes.subarray(i * third, Math.min(streamBytes.length, (i + 1) * third));
            if (s.length) sock.write(s);
          }
        }, 40);
      }
    });
    const parser = new FrameParser(256 * 1024);
    let buf = Buffer.alloc(0);
    const replies = [];
    const done = setTimeout(() => reject(new Error("helper framed timeout")), 15000);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, Buffer.from(d)]);
      try { for (const f of parser.feed(buf)) replies.push(f.raw); } catch {}
      buf = Buffer.alloc(0);
      if (replies.length >= wantReplies) {
        clearTimeout(done);
        sock.destroy();
        resolve(replies);
      }
    });
    sock.on("error", (e) => { clearTimeout(done); reject(e); });
  });
}

async function main() {
  const lease = await framed(admin, { v: 1, id: "ro", method: "runner.open", params: { agent: actor, invocationId: process.env.INVOCATION_ID } }, Buffer.alloc(0), "coalesced");
  if (!lease[0] || lease[0].ok !== true) {
    writeFileSync(out, JSON.stringify({ error: lease[0]?.error ?? "no-lease" }));
    process.exit(2);
  }
  const replay = await framed(admin, { v: 1, id: "ro2", method: "runner.open", params: { agent: actor, invocationId: process.env.INVOCATION_ID } }, Buffer.alloc(0), "coalesced");
  if (!replay[0] || replay[0].ok !== true || replay[0].result.incarnation !== lease[0].result.incarnation || replay[0].result.socketHostPath !== lease[0].result.socketHostPath) {
    writeFileSync(out, JSON.stringify({ error: "same invocation did not converge" }));
    process.exit(2);
  }
  const actorSock = lease[0].result.socketHostPath;
  const meta = {
    v: 1, id: "sub", method: "git.submit", request: "audit-" + actor,
    params: {
      candidate, exportRef, prerequisites: [base], to: ["b"], subject: "audit", body: "", paths: [],
      bundle: { bytes: bundle.length, sha256: sha(bundle), mediaType: "application/x-git-bundle" },
    },
  };
  const want = variant === "followup" ? 2 : 1;
  const replies = await framed(actorSock, meta, bundle, variant, want);
  writeFileSync(out, JSON.stringify(replies));
  process.exit(0);
}
main().catch((e) => {
  try { writeFileSync(process.env.OMA_OUT, JSON.stringify({ fatal: String(e && e.message || e) })); } catch {}
  process.exit(3);
});
`;
test("C1: two concurrent git.submit uploads over the real actor channel — connection-local streams, no cross-consumption", {
    timeout: 60000,
}, async () => {
    const env = brokerEnv();
    const society = env.society;
    try {
        const base = seedProject(env);
        env.store.transaction((_t) => {
            for (const [name, role] of [
                ["a", "resident"],
                ["b", "resident"],
            ] as const) {
                if (!env.store.getAgent(name)) {
                    env.store.insertAgent({
                        name,
                        ...storedSpec(ALL_CAPS, "p", name),
                        role,
                        desired: "enabled",
                        incarnation: 0,
                        profile: "p",
                        createdBy: null,
                    });
                }
            }
        });
        // runner facade auth: the helper process must be INSIDE the unit's cgroup.
        // write a oneshot unit per agent that runs the helper once.
        const helperPath = join(env.dir, "helper.mjs");
        writeFileSync(helperPath, HELPER_SRC.replace("@ABS@", new URL(import.meta.resolve("@oma/protocol/frame")).pathname), "utf8");
        const u = (name: string, variant: string): string => {
            const unit = unitName(society, name, "service");
            const unitFile = join(env.dir, unit);
            writeFileSync(unitFile, [
                "[Unit]",
                "Description=OMA audit E2E helper",
                "[Service]",
                "Type=oneshot",
                `Environment=OMA_ADMIN_SOCK=${join(env.runRoot, "admin.sock")}`,
                `Environment=OMA_BUNDLE=${join(env.dir, `${name}.bundle`)}`,
                `Environment=OMA_ACTOR=${name}`,
                `Environment=OMA_VARIANT=${variant}`,
                `Environment=OMA_OUT=${join(env.dir, `${name}.out.json`)}`,
                `Environment=OMA_CANDIDATE=${envCand(name)}`,
                `Environment=OMA_BASE=${base}`,
                `Environment=OMA_EXPORT_REF=${envRef(name)}`,
                `Environment=HOME=${env.dir}`,
                `ExecStart=${process.execPath} ${helperPath}`,
                "[Install]",
                "WantedBy=default.target",
                "",
            ].join("\n"), "utf8");
            const link = spawnSync("systemctl", ["--user", "link", unitFile], {
                env: G,
            });
            if (link.status !== 0)
                throw new Error(`systemctl link: ${link.stderr}`);
            return unit;
        };
        // candidates + bundles for both agents
        const candA = makeCandidate(env, base, "a");
        const candB = makeCandidate(env, base, "b");
        writeFileSync(join(env.dir, "a.bundle"), candA.bundle);
        writeFileSync(join(env.dir, "b.bundle"), candB.bundle);
        const envCand = (name: string): string => name === "a" ? candA.candidate : candB.candidate;
        const envRef = (name: string): string => name === "a" ? candA.exportRef : candB.exportRef;
        const unitA = u("a", "split");
        const unitB = u("b", "coalesced");
        spawnSync("systemctl", ["--user", "daemon-reload"], { env: G });
        // start both concurrently (one systemctl start each, back-to-back)
        const pA = spawn("systemctl", ["--user", "start", unitA], { env: G });
        const pB = spawn("systemctl", ["--user", "start", unitB], { env: G });
        const deadline = Date.now() + 30000;
        let outA: string | null = null;
        let outB: string | null = null;
        while (Date.now() < deadline && (!outA || !outB)) {
            await new Promise((r) => setTimeout(r, 250));
            const pa = join(env.dir, "a.out.json");
            const pb = join(env.dir, "b.out.json");
            if (existsSync(pa))
                outA = readFileSync(pa, "utf8");
            if (existsSync(pb))
                outB = readFileSync(pb, "utf8");
        }
        pA.kill("SIGKILL");
        pB.kill("SIGKILL");
        assert.ok(outA, "agent a helper produced no result");
        assert.ok(outB, "agent b helper produced no result");
        let resA: unknown = null;
        let resB: unknown = null;
        try {
            resA = JSON.parse(outA);
            resB = JSON.parse(outB);
        }
        catch {
            /* fall through to the array check below which prints raw text */
        }
        assert.ok(Array.isArray(resA), `agent a helper output is not a reply array: ${outA}`);
        assert.ok(Array.isArray(resB), `agent b helper output is not a reply array: ${outB}`);
        type SubmitReply = {
            id?: string;
            ok?: boolean;
            result?: {
                operation: string;
                state: string;
            };
            error?: {
                code: string;
            };
        };
        const repliesA = resA as SubmitReply[];
        const repliesB = resB as SubmitReply[];
        const publishedRefs: string[] = [];
        // Concurrent preparation can leave accepted work pending/unknown. Require
        // its original receipt/intent, then run a bounded test-case recovery sweep.
        for (const [actor, replies, candidate] of [
            ["a", repliesA, candA],
            ["b", repliesB, candB],
        ] as const) {
            assert.ok(Array.isArray(replies), `${actor} driver: ${JSON.stringify(replies)}`);
            const reply = replies.find((value) => value.id === "sub");
            assert.ok(reply, `${actor} returned no correlated response`);
            const accepted = env.store.getOperation(actor, `audit-${actor}`);
            assert.ok(accepted?.kind === "git.submit", `${actor} has no accepted submit`);
            assert.equal(accepted.plan.candidate, candidate.candidate);
            if (reply.ok === true) {
                assert.equal(reply.result?.operation, accepted.id);
                assert.ok(["pending", "unknown", "succeeded"].includes(reply.result?.state ?? ""));
            }
            else {
                assert.equal(reply.ok, false);
                assert.equal(reply.error?.code, "REF_STATE_UNKNOWN", "unexpected concurrent submit rejection");
            }
            const settled = await requireSubmitConvergence(accepted.id, () => env.store.getOperation(actor, `audit-${actor}`), (id) => env.git.reconcile(id));
            assert.ok(settled.kind === "git.submit");
            const message = settled.plan.message;
            assert.equal(createHash("sha256")
                .update(readFileSync(join(env.state, message.objectPath)))
                .digest("hex"), message.sha256);
            assert.deepEqual(env.store
                .deliveriesForOperation(settled.id)
                .map((row) => [row.recipient, row.messageId, row.materialized]), [["b", message.id, 1]], "result mail must converge exactly once with publication");
            publishedRefs.push(settled.plan.publishedRef);
        }
        const [refA, refB] = publishedRefs;
        assert.ok(refA && refB);
        assert.notEqual(refA, refB);
        // streams were never cross-consumed: each ref points at ITS OWN candidate
        const sh = (args: string[]): string => {
            const r = spawnSync("git", args, { env: G, encoding: "utf8" });
            if (r.status !== 0)
                throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
            return (r.stdout ?? "").trim();
        };
        assert.equal(sh([
            "--git-dir",
            join(env.state, "repos", "project.git"),
            "rev-parse",
            refA,
        ]), candA.candidate);
        assert.equal(sh([
            "--git-dir",
            join(env.state, "repos", "project.git"),
            "rev-parse",
            refB,
        ]), candB.candidate);
    }
    finally {
        env.cleanup();
    }
});
// ---------------------------------------------------------------------------
// Part D — entry/broker.js ordered bootstrap (READY only after recovery)
// ---------------------------------------------------------------------------
function minimalConfig(society: string, rootfs = "/rootfs"): Record<string, unknown> {
    return {
        schemaVersion: 3,
        society,
        installation: {
            node: process.execPath,
            // MUST [R38]: the configured LIBDIR must be the layout the loaded modules
            // resolve from, or the entry refuses to start. Tests run from the package
            // root, where dist/ and implementation/ live side by side.
            libdir: process.cwd(),
            // SB-002-E: the trusted Resident rootfs must be a real non-root path.
            // Callers that spawn a broker pass a directory they created; the decode
            // callers keep the shape-only default.
            rootfs,
            deploymentDigest: deploymentDigest(process.cwd()),
        },
        modelProfiles: {
            md: {
                provider: "none",
                model: "none",
                inferenceTimeoutSeconds: 1,
            },
        },
        agentProfiles: {
            p: {
                modelProfile: "md",
                capabilities: ["mail.send", "git.submit"],
                delegable: [],
                childProfile: null,
            },
            child: {
                modelProfile: "md",
                capabilities: ["mail.send"],
                delegable: [],
                childProfile: null,
            },
        },
        principalProfile: "p",
        initialResidents: [],
        integration: { policyRevision: "1", protectedPaths: [], checks: [] },
        limits: {
            frameBytes: 262144,
            mailBodyBytes: 1048576,
            subjectBytes: 200,
            addresses: 32,
            replyReferences: 64,
            contextFiles: 64,
            contextBytes: 1048576,
            bundleBytes: 268435456,
            logBytes: 1048576,
            batchMaxMessages: 32,
            idleStreamSeconds: 900,
            receiptWaitSeconds: 30,
        }
    };
}
test("CFG-001/IPC-001: configuration and frames share strict JSON decoding", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-config-json-"));
    const path = join(dir, "config.json");
    try {
        const json = JSON.stringify(minimalConfig("strict"));
        writeFileSync(path, json);
        assert.equal(loadConfig(path).society, "strict");
        const invalidUtf8 = Buffer.from(json);
        invalidUtf8[invalidUtf8.indexOf("none")] = 0xff;
        const invalid = [
            Buffer.from(json.slice(0, -1) + ',"soci\\u0065ty":"strict"}'),
            Buffer.from(json.replace('"provider":"none"', '"provider":"none","provider":"none"')),
            Buffer.from(json.replace('"provider":"none"', '"provider":"\\ud800"')),
            Buffer.from(json.replace('"md":', '"\\ud800":')),
            Buffer.from(json.replace('"societyAgents":8', '"societyAgents":1e999')),
            invalidUtf8,
        ];
        for (const body of invalid) {
            writeFileSync(path, body);
            assert.throws(() => loadConfig(path), /config unreadable/);
            const header = Buffer.alloc(4);
            header.writeUInt32BE(body.length);
            assert.throws(() => new FrameParser(body.length).feed(Buffer.concat([header, body])), { code: "INVALID_REQUEST" });
        }
        writeFileSync(path, json.replace('"policyRevision":"1"', '"policyRevision":"정책😀"'));
        assert.equal(loadConfig(path).integration.policyRevision, "정책😀");
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("CREATE-002: child capabilities use the authenticated parent's effective set", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-audit-auth-"));
    try {
        const society = `au${Date.now().toString(36)}`;
        const raw = minimalConfig(society);
        const profiles = raw.agentProfiles as Record<string, Record<string, unknown>>;
        const parentProfile = profiles.p!;
        parentProfile.childProfile = "child";
        parentProfile.delegable = ["mail.send"];
        profiles.child = {
            ...parentProfile,
            capabilities: ["mail.send", "git.submit"],
            childProfile: null,
        };
        const configPath = join(dir, "config.json");
        writeFileSync(configPath, JSON.stringify(raw), "utf8");
        const cfg = loadConfig(configPath);
        const input = { name: "child-a", from: "0".repeat(40), brief: "brief" };
        const limited = resolveChildSpec(cfg, { name: "a", profile: "p", capabilities: ["git.submit"] }, input);
        assert.deepEqual(limited?.spec.capabilities, []);
        const granted = resolveChildSpec(cfg, { name: "a", profile: "p", capabilities: ["mail.send", "git.submit"] }, input);
        assert.deepEqual(granted?.spec.capabilities, ["mail.send"]);
        assert.equal(cfg.modelProfiles["constructor"], undefined);
        assert.equal(cfg.agentProfiles["toString"], undefined);
        parentProfile.modelProfile = "constructor";
        writeFileSync(configPath, JSON.stringify(raw));
        assert.throws(() => loadConfig(configPath), /modelProfile unknown/);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("LIFE-009 entry: fresh broker seeds once and restart ignores population edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-bootstrap-entry-"));
    const society = `bs${Date.now().toString(36)}`;
    const data = join(dir, "data");
    const state = join(data, "oma", society);
    const xdg = join(dir, "config");
    const root = join(dir, "seed");
    mkdirSync(join(state, "repos"), { recursive: true });
    mkdirSync(root);
    const git = (args: string[], cwd = root) => {
        const result = spawnSync("/usr/bin/git", args, {
            cwd,
            env: {
                ...process.env,
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_CONFIG_NOSYSTEM: "1",
            },
            encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    const run = async () => {
        const child = spawn(process.execPath, [
            join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"),
            "--society",
            society,
        ], {
            env: {
                ...process.env,
                XDG_DATA_HOME: data,
                XDG_CONFIG_HOME: xdg,
                XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`,
                NOTIFY_SOCKET: "",
            },
            stdio: ["ignore", "ignore", "pipe"],
        });
        let output = "";
        child.stderr!.on("data", (bytes) => {
            output += bytes.toString();
        });
        const exited = new Promise<void>((resolve) => child.on("close", () => resolve()));
        try {
            // Without a NOTIFY_SOCKET the entry reports the same readiness boundary in
            // its foreground wording; both lines mean startup completed.
            const ready = () => /broker (ready|listening)/.test(output);
            for (let i = 0; i < 500 && !ready() && child.exitCode === null; i++)
                await new Promise((resolve) => setTimeout(resolve, 20));
            assert.match(output, /broker (ready|listening)/);
        }
        finally {
            child.kill("SIGTERM");
            await exited;
        }
    };
    try {
        git(["init", "-q", "-b", "main"]);
        writeFileSync(join(root, "base.txt"), "base\n");
        git(["add", "."]);
        git([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "base",
        ]);
        const base = git(["rev-parse", "HEAD"]);
        git(["clone", "-q", "--bare", root, join(state, "repos", "project.git")]);
        const rootfs = join(dir, "rootfs");
        mkdirSync(rootfs);
        const cfg = minimalConfig(society, rootfs);
        cfg.initialResidents = [
            { name: "child", profile: "child", brief: "initial" },
        ];
        writeFileSync(join(state, "config.json"), JSON.stringify({ ...cfg, society: `${society}x` }));
        for (const name of ["broker", "runner"]) {
            // A unit-started runner is handed the broker's location explicitly.
            const args = name === "runner" ? ["--agent", "child", "--config", join(state, "config.json"),
                "--state-root", state, "--run-root", join(dir, "run", "oma", society)] : [];
            const rejected = spawnSync(process.execPath, [
                join(process.cwd(), "apps", "oma", "dist", "entry", `${name}.js`),
                "--society",
                society,
                ...args,
            ], {
                env: { ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: xdg },
                encoding: "utf8",
                timeout: 3000,
            });
            assert.equal(rejected.status, name === "broker" ? 1 : 4, rejected.stderr);
            assert.match(rejected.stderr, /config society does not match/);
            assert.equal(existsSync(join(state, "runtime.sqlite")), false);
        }
        writeFileSync(join(state, "config.json"), JSON.stringify(cfg));
        await run();
        const start = readFileSync(join(state, "world", "START.md"), "utf8");
        assert.match(start, /\/inbox\.md/);
        assert.match(start, /oma_merge/);
        assert.match(start, /not authority/);
        assert.match(readFileSync(join(state, "world", "agents.tsv"), "utf8"), /child\tresident\tenabled\tchild/);
        let store = new Store(join(state, "runtime.sqlite"));
        // Reading a create/bootstrap plan needs the trusted repository identity,
        // exactly like the broker composition binds it on its own connection.
        store.bindRepositoryIdentity({ society });
        const op = store.getOperation("principal", "bootstrap-child")!;
        assert.equal(op.state, "succeeded");
        assert.equal(store.pendingDeliveries("child").length, 1);
        assert.equal(store.getAgent("child")!.incarnation, 0);
        store.close();
        assert.equal(git(["rev-parse", "HEAD"], join(state, "agents", "child", "workspace")), base);
        cfg.initialResidents = [
            { name: "another", profile: "child", brief: "do not reseed" },
        ];
        writeFileSync(join(state, "config.json"), JSON.stringify(cfg));
        await run();
        store = new Store(join(state, "runtime.sqlite"));
        store.bindRepositoryIdentity({ society });
        assert.equal(store.getAgent("another"), null);
        assert.equal(store.getOperation("principal", "bootstrap-child")!.id, op.id);
        assert.equal(store.pendingDeliveries("child").length, 1);
        store.close();
    }
    finally {
        cleanupOwnedSystemdUnits(dir, society);
        rmSync(dir, { recursive: true, force: true });
        rmSync(join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`, "oma", society), { recursive: true, force: true });
    }
});
test("D1: READY=1 arrives after startup recovery (recovered mail op observable), never before", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "oma-audit-d1-"));
    const society = `au${Date.now().toString(36)}`;
    const runRoot = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;
    let child: ReturnType<typeof spawn> | undefined;
    let notifyRelay: ReturnType<typeof spawn> | undefined;
    try {
        const xdgData = join(dir, "data");
        const stateRoot = join(xdgData, "oma", society);
        mkdirSync(stateRoot, { recursive: true });
        mkdirSync(runRoot, { recursive: true });
        mkdirSync(join(stateRoot, "repos"), { recursive: true });
        seedProject({ dir, state: stateRoot });
        const rootfs = join(dir, "rootfs");
        mkdirSync(rootfs);
        writeFileSync(join(stateRoot, "config.json"), JSON.stringify(minimalConfig(society, rootfs)), "utf8");
        // seed a pending mail operation (accepted-before-materialize fixture)
        const store = new Store(join(stateRoot, "runtime.sqlite"));
        // A reader of create/context plans needs the trusted repository identity,
        // exactly like the broker composition binds it.
        store.bindRepositoryIdentity({ society });
        store.transaction((_t) => {
            for (const [name, role] of [
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
        const mail = createMailModule({ stateRoot, society }, store, 64);
        await assert.rejects(sendWithStop(mail, store, {
            actor: "a",
            incarnation: 0,
            role: "resident",
            channel: "actor",
            capabilities: new Set(ALL_CAPS),
            peer: {
                pid: process.pid,
                uid: process.getuid!(),
                gid: process.getgid!(),
                cgroup: null,
            },
        }, "k1", { to: ["b"], subject: "pending", kind: "message", body: "recover me" }, "accepted"));
        const recoveryId = store.getOperation("a", "k1")!.id;
        store.close();
        // sd_notify listener: node dgram cannot create AF_UNIX datagram sockets in
        // this runtime, so a tiny python3 relay owns the unix-dgram socket and
        // appends every datagram to a log file the test polls.
        const notifyPath = join(dir, "notify.sock");
        const notifyLog = join(dir, "notify.log");
        notifyRelay = spawn("python3", ["-u", "-c", PY_RELAY, notifyPath, notifyLog], { stdio: "ignore" });
        const relayDeadline = Date.now() + 5000;
        while (!existsSync(notifyPath) && Date.now() < relayDeadline) {
            await new Promise((r) => setTimeout(r, 50));
        }
        assert.ok(existsSync(notifyPath), "python notify relay never bound");
        child = spawn(process.execPath, [
            join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"),
            "--society",
            society,
        ], {
            env: {
                ...process.env,
                XDG_DATA_HOME: xdgData,
                XDG_RUNTIME_DIR: runRoot,
                NOTIFY_SOCKET: notifyPath,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr!.on("data", (d) => {
            stderr += String(d);
        });
        const gotReady = await waitForReady(notifyLog, 20000).catch((error: unknown) => {
            throw new Error(`${String(error)}; broker stderr: ${stderr}`);
        });
        assert.match(gotReady, /READY=1/);
        // at READY time the admin socket must already exist (start before READY)
        assert.equal(existsSync(join(runRoot, "oma", society, "admin.sock")), true);
        // and the pending mail op was recovered BEFORE READY (ordered bootstrap)
        const storeAfter = new Store(join(stateRoot, "runtime.sqlite"));
        const op = storeAfter.transaction((_t) => storeAfter.getOperationById(recoveryId));
        assert.equal(op?.state, "succeeded");
        assert.equal(existsSync(join(stateRoot, "mail", "archive", "cur")), true, "result mail materialized before READY");
        storeAfter.close();
        child.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 300));
        child.kill("SIGKILL");
        notifyRelay.kill("SIGKILL");
        void stderr;
    }
    finally {
        child?.kill("SIGKILL");
        notifyRelay?.kill("SIGKILL");
        rmSync(join(runRoot, "oma", society), { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
    }
});
test("D2: startup recovery failure -> no READY, exit 1, nothing served", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-audit-d2-"));
    const society = `au${Date.now().toString(36)}`;
    const runRoot = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`;
    const children: ReturnType<typeof spawn>[] = [];
    try {
        const xdgData = join(dir, "data");
        const stateRoot = join(xdgData, "oma", society);
        mkdirSync(stateRoot, { recursive: true });
        mkdirSync(runRoot, { recursive: true });
        mkdirSync(join(stateRoot, "repos"), { recursive: true });
        seedProject({ dir, state: stateRoot });
        const rootfs = join(dir, "rootfs");
        mkdirSync(rootfs);
        writeFileSync(join(stateRoot, "config.json"), JSON.stringify(minimalConfig(society, rootfs)), "utf8");
        const store = new Store(join(stateRoot, "runtime.sqlite"));
        const missingOp = "op-00000000-0000-4000-8000-0000000000d2";
        const missingMessage = "m-00000000-0000-4000-8000-0000000000d2-0";
        store.transaction((_t) => {
            store.insertAgent({
                name: "a",
                ...storedSpec(ALL_CAPS, "p", "a"),
                role: "resident",
                desired: "enabled",
                incarnation: 0,
                profile: "p",
                createdBy: null,
            });
            // Valid accepted plan, but its immutable object is deliberately absent.
            // Recovery must fail on the missing object, never on plan-shape corruption.
            const missingPayload = {
                to: ["a"],
                subject: "absent",
                body: "object",
                kind: "message",
            };
            store.insertOperation({
                id: missingOp,
                actor: "a",
                requestKey: "k1",
                requestHash: requestHash("mail.send", missingPayload),
                kind: "mail.send",
                payloadJson: JSON.stringify(missingPayload),
                planJson: serializePlanIntent({
                    kind: "mail.send",
                    message: {
                        id: missingMessage,
                        objectPath: `mail/objects/${missingMessage}.eml`,
                        sha256: "0".repeat(64),
                        bytes: 1,
                        dateMs: 1,
                        to: ["a"],
                        recipients: ["a"],
                        kind: "message",
                        contextRevision: null,
                        replyHeaders: { replyTo: ["a"], inReplyTo: null, references: [] },
                    },
                }),
            });
            store.insertDeliveries([
                {
                    messageId: missingMessage,
                    recipient: "a",
                    operationId: missingOp,
                },
            ]);
        });
        store.close();
        const notifyPath = join(dir, "notify.sock");
        const notifyLog = join(dir, "notify.log");
        const notifyRelay = spawn("python3", ["-u", "-c", PY_RELAY, notifyPath, notifyLog], { stdio: "ignore" });
        children.push(notifyRelay);
        await new Promise((r) => setTimeout(r, 300)); // relay binds before the broker runs
        const child = spawn(process.execPath, [
            join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"),
            "--society",
            society,
        ], {
            env: {
                ...process.env,
                XDG_DATA_HOME: xdgData,
                XDG_RUNTIME_DIR: runRoot,
                NOTIFY_SOCKET: notifyPath,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        children.push(child);
        let stderr = "";
        child.stderr.on("data", (bytes) => {
            stderr += String(bytes);
        });
        child.stdout.resume();
        const exitCode = await new Promise<number | null>((resolve) => {
            const t = setTimeout(() => {
                child.kill("SIGKILL");
                resolve(null);
            }, 20000);
            child.on("close", (code) => {
                clearTimeout(t);
                resolve(code);
            });
        });
        assert.equal(exitCode, 1, "broker must exit non-zero on startup failure");
        // The immutable object is what is absent: the corruption is reported as a
        // missing file, not as a malformed plan.
        assert.match(stderr, /STORE_CORRUPT: immutable file is missing/);
        const events = existsSync(notifyLog) ? readFileSync(notifyLog, "utf8") : "";
        assert.equal(events.includes("READY=1"), false, "READY must never be sent");
        assert.equal(existsSync(join(runRoot, "oma", society, "admin.sock")), false, "no serving socket before recovery completes");
        notifyRelay.kill("SIGKILL");
    }
    finally {
        for (const child of children)
            child.kill("SIGKILL");
        rmSync(join(runRoot, "oma", society), { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
    }
});
const PY_RELAY = String.raw `
import socket, sys, os
path, log = sys.argv[1], sys.argv[2]
try: os.unlink(path)
except FileNotFoundError: pass
s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
s.bind(path)
f = open(log, "a")
while True:
    data = s.recv(65536)
    if data:
        f.write(data.decode("utf-8", "replace"))
        f.flush()
`;
async function waitForReady(logPath: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
        if (existsSync(logPath))
            last = readFileSync(logPath, "utf8");
        if (last.includes("READY=1"))
            return last;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no READY=1 within ${timeoutMs}ms; datagram log: ${JSON.stringify(last)}`);
}
