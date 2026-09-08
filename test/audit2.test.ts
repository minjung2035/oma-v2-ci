// Second focused runtime-correctness audit (P0-1/2/3 + P1-7/8): real socket
// E2E through the cgroup-authenticated actor channel. A systemd user unit runs
// a raw-socket driver (encodeFrame/FrameParser) so we can exercise pipelining,
// stream-length/excess, closed-schema validation, and status filtering at the
// actual broker boundary — never only unit-testing the decoder.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule, unitName } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { GitModule } from "../src/git.js";
import { ReconcileModule } from "../src/reconcile.js";
import { Broker } from "../src/broker.js";
import { FrameParser, encodeFrame } from "../src/frame.js";
import type { ResolvedAgentSpec } from "../implementation/contracts.js";

const G = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const ROOT = join(import.meta.dirname ?? process.cwd(), "..", "..");
const SHA = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");

interface Env {
  dir: string;
  state: string;
  runRoot: string;
  society: string;
  store: Store;
  cleanup: () => void;
}

function envOf(): Env {
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
        specHash: "h",
        role,
        desired: "enabled",
        incarnation: 0,
        profile: "p",
        createdBy: null,
        specJson: "{}",
      });
    }
  });
  const units = new UnitsModule(
    society,
    {
      node: process.execPath,
      libdir: "/usr/lib/oma",
      state,
      society,
      agent: "",
    },
    join(dir, "xdg"),
  );
  const mail = new MailModule({ stateRoot: state, society }, store, 64);
  const resolver = (
    _p: { name: string; profile: string },
    input: { name: string; from: string; brief: string },
  ): ResolvedAgentSpec => ({
    ...input,
    profile: "child",
    capabilities: ["mail.send", "git.submit", "context.publish"],
  });
  const lifecycle = new LifecycleModule(
    store,
    units,
    {
      stateRoot: state,
      projectGit: join(state, "repos", "project.git"),
      society,
      hasGoal: () => true,
    },
    resolver,
  );
  const views = new ViewsModule(store, state, society, "p");
  const git = new GitModule(
    {
      stateRoot: state,
      projectGit: join(state, "repos", "project.git"),
      contextGit: join(state, "repos", "context.git"),
      worldDir: join(state, "world"),
      society,
      quarantineTmpBytes: 64 * 1024 * 1024,
      checkTimeoutSeconds: 30,
    },
    store,
    mail,
    null,
  );
  const recon = new ReconcileModule(store, mail, git, units, {
    projectGit: join(state, "repos", "project.git"),
  });
  const broker = new Broker(store, mail, units, views, lifecycle, git, recon, {
    stateRoot: state,
    runRoot,
    society,
  });
  broker.start();
  return {
    dir,
    state,
    runRoot,
    society,
    store,
    cleanup: () => {
      try {
        broker.drainAndClose();
      } catch {
        /* already closed */
      }
      spawnSync("systemctl", ["--user", "stop", `oma-${society}-*`], {
        env: G,
      });
      spawnSync("systemctl", ["--user", "reset-failed", `oma-${society}-*`], {
        env: G,
      });
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
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return (r.stdout ?? "").trim();
  };
  sh(["init", "-q", "-b", "main"], seed);
  writeFileSync(join(seed, "base.txt"), "b".repeat(65536) + "\n", "utf8");
  sh(["add", "-A"], seed);
  sh(
    [
      "-c",
      "user.name=O",
      "-c",
      "user.email=o@localhost",
      "commit",
      "-qm",
      "base",
    ],
    seed,
  );
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

function makeCandidate(
  env: Env,
  base: string,
  tag: string,
): { candidate: string; bundle: Buffer } {
  const clone = join(env.dir, `clone-${tag}`);
  const sh = (args: string[], cwd?: string): string => {
    const r = spawnSync("git", args, {
      cwd: cwd ?? env.dir,
      env: G,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
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
  sh(
    ["-c", "user.name=X", "-c", "user.email=x@localhost", "commit", "-qm", tag],
    clone,
  );
  const candidate = sh(["rev-parse", "HEAD"], clone);
  const exportRef = `refs/oma/export/req-${tag}`;
  sh(["update-ref", exportRef, candidate], clone);
  const bpath = join(env.dir, `${tag}.bundle`);
  sh(["bundle", "create", bpath, exportRef, `^${base}`], clone);
  return { candidate, bundle: Buffer.from(readFileSync(bpath)) };
}

/**
 * Raw socket driver, run inside the agent unit (cgroup-authenticated actor
 * channel). Drives writes with explicit byte-level control and collects all
 * reply frames in arrival order.
 */
const DRIVER = String.raw`import { writeFileSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { FrameParser, encodeFrame } from "@ABS@";

async function main() {
  const admin = process.env.OMA_ADMIN_SOCK;
  const scenarios = JSON.parse(readFileSync(process.env.OMA_SCENARIOS_FILE, "utf8"));
  // obtain the actor socket via runner.open
  const actorSock = await new Promise((resolve, reject) => {
    const s = connect(admin, () => s.write(encodeFrame({ v: 1, id: "ro", method: "runner.open", params: { agent: process.env.OMA_ACTOR } })));
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
main().catch((e) => { try { writeFileSync(process.env.OMA_OUT, JSON.stringify({ fatal: String(e && e.message || e) })); } catch {} process.exit(3); });
`;

test("P0-1/2/3 + P1-7/8: real-socket serialization, stream length, closed schema, status filter", async (t) => {
  const probe = spawnSync("systemctl", ["--user", "is-system-running"], {
    encoding: "utf8",
  });
  if (probe.status !== 0 && !/running|degraded/.test(probe.stdout)) {
    t.skip("no systemd user manager");
    return;
  }
  const env = envOf();
  const society = env.society;
  try {
    const base = seedProject(env);
    const cand = makeCandidate(env, base, "x");
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
                  mediaType: "x",
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
        expect: 0,
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
                exportRef: "r",
                prerequisites: [base],
                to: ["b"],
                subject: "s",
                body: "",
                paths: [],
                bundle: {
                  bytes: cand.bundle.length,
                  sha256: SHA(cand.bundle),
                  mediaType: "x",
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
                exportRef: "r",
                prerequisites: [base],
                to: ["b"],
                subject: "s",
                body: "",
                paths: [],
                bundle: {
                  bytes: 4,
                  sha256: SHA(Buffer.from("abcd")),
                  mediaType: "x",
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
    writeFileSync(
      driverPath,
      DRIVER.replace("@ABS@", join(ROOT, "dist", "src", "frame.js")),
      "utf8",
    );
    writeFileSync(
      join(env.dir, "scenarios.json"),
      JSON.stringify(scenarios),
      "utf8",
    );
    const outPath = join(env.dir, "out.json");
    const unit = unitName(society, "a", "service");
    writeFileSync(
      join(env.dir, unit),
      [
        "[Unit]",
        "Description=audit2 driver",
        "[Service]",
        "Type=oneshot",
        `Environment=OMA_ADMIN_SOCK=${join(env.runRoot, "admin.sock")}`,
        `Environment=OMA_ACTOR=a`,
        `Environment=OMA_SCENARIOS_FILE=${join(env.dir, "scenarios.json")}`,
        `Environment=OMA_OUT=${outPath}`,
        `Environment=HOME=${env.dir}`,
        `ExecStart=/usr/bin/node ${driverPath}`,
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
      "utf8",
    );
    const link = spawnSync(
      "systemctl",
      ["--user", "link", join(env.dir, unit)],
      { env: G },
    );
    assert.equal(link.status, 0, `link: ${link.stderr}`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { env: G });
    const started = spawn("systemctl", ["--user", "start", unit], { env: G });
    const startExit = new Promise<number | null>((resolve) => {
      const t2 = setTimeout(() => resolve(null), 90000);
      started.on("exit", (c) => {
        clearTimeout(t2);
        resolve(c);
      });
    });
    const deadline = Date.now() + 120000;
    while (!existsSync(outPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(await startExit, 0, "unit start failed");
    assert.ok(existsSync(outPath), "driver produced no output");
    const results = JSON.parse(readFileSync(outPath, "utf8")) as Array<{
      name: string;
      replies?: Array<{
        id?: string;
        ok?: boolean;
        error?: { code: string };
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
    assert.deepEqual(
      ids("serialize"),
      ["c1", "s1"],
      "pipelined requests must serialize on one socket",
    );

    // P0-2 exact: submit succeeded
    assert.equal(
      byName("exact")?.replies?.[0]?.ok,
      true,
      `exact submit: ${JSON.stringify(byName("exact")?.replies)}`,
    );

    // P0-2 short+EOF: STREAM_INVALID, no success
    const short = byName("short");
    assert.ok(
      short?.replies?.length === 0 ||
        short?.replies?.some((r) => r.error?.code === "STREAM_INVALID"),
      `short stream: ${JSON.stringify(short?.replies)}`,
    );

    // P0-2 excess garbage: STREAM_INVALID, mutation must NOT succeed
    const eg = byName("excess-garbage");
    assert.ok(
      eg?.replies?.[0]?.error?.code === "STREAM_INVALID" || eg?.timeout,
      `excess garbage should be STREAM_INVALID: ${JSON.stringify(eg?.replies)}`,
    );
    const egOp = env.store.transaction((_t) =>
      env.store.getOperation("a", "excess-garbage"),
    );
    assert.equal(
      egOp,
      null,
      "excess garbage must not create an operation (mutation must not succeed)",
    );

    // P0-2 coalesced: success
    assert.equal(
      byName("coalesced")?.replies?.[0]?.ok,
      true,
      `coalesced: ${JSON.stringify(byName("coalesced")?.replies)}`,
    );

    // P0-3: stream submit then next control request: submit first, status second
    assert.deepEqual(
      ids("stream-then-next"),
      ["stn", "s2"],
      "next request must wait for the stream submit",
    );

    // P1-7: status filter — a and b return only their own agent
    const sa = byName("status-a")?.replies?.[0]?.result as
      | Array<{ agent: string }>
      | undefined;
    const sb = byName("status-b")?.replies?.[0]?.result as
      | Array<{ agent: string }>
      | undefined;
    assert.ok(
      Array.isArray(sa) && sa.length === 1 && sa[0]!.agent === "a",
      `status a: ${JSON.stringify(sa)}`,
    );
    assert.ok(
      Array.isArray(sb) && sb.length === 1 && sb[0]!.agent === "b",
      `status b: ${JSON.stringify(sb)}`,
    );

    // P1-8 closed-schema negatives
    assert.equal(
      byName("neg-oid")?.replies?.[0]?.error?.code,
      "INVALID_REQUEST",
      "git.known bad oid",
    );
    assert.equal(
      byName("neg-unknown-param")?.replies?.[0]?.error?.code,
      "INVALID_REQUEST",
      "status.get unknown param",
    );
    assert.equal(
      byName("neg-bad-prereq")?.replies?.[0]?.error?.code,
      "INVALID_REQUEST",
      "git.submit bad prereq",
    );
    assert.equal(
      byName("neg-version")?.replies?.[0]?.error?.code,
      "UNSUPPORTED_VERSION",
      "v=2 must be rejected",
    );
    assert.equal(
      byName("neg-read-request")?.replies?.[0]?.error?.code,
      "INVALID_REQUEST",
      "read method with top-level request",
    );
  } finally {
    env.cleanup();
  }
});
