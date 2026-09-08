// CLI acceptance (P1): the real `oma` CLI binary against the real broker over
// unix sockets from inside a real systemd user unit (cgroup-authenticated
// actor channel). Covers IPC-006 freeze-cache semantics, IPC-008 --request
// recovery, CLI-003 exit codes, and the streamed submit path — through the
// CLI, never by calling library APIs directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { UnitsModule, unitName } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { GitModule } from "../src/git.js";
import { ReconcileModule } from "../src/reconcile.js";
import { Broker } from "../src/broker.js";
import type { ResolvedAgentSpec } from "../implementation/contracts.js";

const G = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const ROOT = join(import.meta.dirname ?? process.cwd(), "..", "..");
const CLI = join(ROOT, "dist", "src", "cli.js");

interface Env {
  dir: string;
  state: string;
  runRoot: string;
  society: string;
  store: Store;
  cleanup: () => void;
}

function envOf(): Env {
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
      ["commons", "resident"],
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
    capabilities: ["mail.send", "git.submit"],
  });
  const lifecycle = new LifecycleModule(
    store,
    units,
    {
      stateRoot: state,
      projectGit: join(state, "repos", "project.git"),
      society,
      hasGoal: () => false,
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

/**
 * Worker wrap: run the CLI inside the agent unit (cgroup-authenticated actor
 * channel). The unit's oneshot process first obtains a run lease via
 * runner.open (the production path), then executes each scenario's CLI
 * invocation with OMA_SOCKET pointing at the lease's actor socket.
 */
const WRAP = String.raw`import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { FrameParser, encodeFrame } from "@ABS_FRAME@";

const admin = process.env.OMA_ADMIN_SOCK;
const scenarios = JSON.parse(readFileSync(process.env.OMA_SCENARIOS_FILE, "utf8"));

function framed(sockPath, frame) {
  return new Promise((resolve, reject) => {
    const sock = connect(sockPath, () => sock.write(encodeFrame(frame)));
    const parser = new FrameParser(256 * 1024);
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("wrap timeout")); }, 30000);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, Buffer.from(d)]);
      try { for (const f of parser.feed(buf)) { clearTimeout(timer); sock.destroy(); resolve(f.raw); } } catch {}
      buf = Buffer.alloc(0);
    });
    sock.on("error", reject);
  });
}

const lease = await framed(admin, { v: 1, id: "ro", method: "runner.open", params: { agent: process.env.OMA_ACTOR } });
if (!lease.ok) { writeFileSync(process.env.OMA_OUT, JSON.stringify({ leaseError: lease.error })); process.exit(2); }
const sock = lease.result.socketHostPath;
const results = [];
for (const s of scenarios) {
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

test("CLI acceptance: freeze cache, same-key semantics, recovery, streamed submit (real unit, real sockets)", async (t) => {
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
    seedProject(env);
    // CLI workdir: a clone with one local commit to submit
    const work = join(env.dir, "work");
    const sh = (args: string[], cwd?: string): string => {
      const r = spawnSync("git", args, {
        cwd: cwd ?? env.dir,
        env: G,
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return (r.stdout ?? "").trim();
    };
    sh(["clone", "-q", join(env.state, "repos", "project.git"), work]);
    writeFileSync(join(work, "c.txt"), "cli\n", "utf8");
    sh(["add", "c.txt"], work);
    sh(
      [
        "-c",
        "user.name=C",
        "-c",
        "user.email=c@localhost",
        "commit",
        "-qm",
        "cli",
      ],
      work,
    );
    const bodyFile = join(env.dir, "body.txt");
    writeFileSync(bodyFile, "hello body\n", "utf8");
    const homeDir = join(env.dir, "home-a");
    mkdirSync(homeDir, { recursive: true });
    // scenarios (in one unit run; shared HOME = shared freeze cache)
    const scenarios = [
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
    ];
    // wrap + unit
    const wrapPath = join(env.dir, "wrap.mjs");
    writeFileSync(
      wrapPath,
      WRAP.replace("@ABS_FRAME@", join(ROOT, "dist", "src", "frame.js")),
      "utf8",
    );
    const outPath = join(env.dir, "cli.out.json");
    writeFileSync(
      join(env.dir, "scenarios.json"),
      JSON.stringify(scenarios),
      "utf8",
    );
    const unit = unitName(society, "a", "service");
    const unitFile = join(env.dir, unit);
    writeFileSync(
      unitFile,
      [
        "[Unit]",
        "Description=OMA CLI acceptance wrapper",
        "[Service]",
        "Type=oneshot",
        `Environment=OMA_ADMIN_SOCK=${join(env.runRoot, "admin.sock")}`,
        `Environment=OMA_ACTOR=a`,
        `Environment=OMA_CLI=${CLI}`,
        `Environment=OMA_HOME=${homeDir}`,
        `Environment=OMA_OUT=${outPath}`,
        `Environment=OMA_SCENARIOS_FILE=${join(env.dir, "scenarios.json")}`,
        `Environment=HOME=${env.dir}`,
        `WorkingDirectory=${env.dir}`,
        `ExecStart=/usr/bin/node ${wrapPath}`,
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
      "utf8",
    );
    const link = spawnSync("systemctl", ["--user", "link", unitFile], {
      env: G,
    });
    assert.equal(link.status, 0, `systemctl link: ${link.stderr}`);
    spawnSync("systemctl", ["--user", "daemon-reload"], { env: G });
    const started = spawn("systemctl", ["--user", "start", unit], { env: G });
    // NOTE: spawn, never spawnSync — the broker runs in this test process, so
    // a blocking systemctl start would freeze the broker's event loop and
    // starve the very unit we are waiting for.
    const startExit = new Promise<number | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 90000);
      started.on("exit", (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    const deadline = Date.now() + 90000;
    while (!existsSync(outPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(existsSync(outPath), "wrapper produced no output");
    assert.equal(await startExit, 0, "unit start failed");
    const results = JSON.parse(readFileSync(outPath, "utf8")) as Array<{
      args: string[];
      code: number;
      stdout: string;
      stderr: string;
    }>;

    // 1) first send: accepted, receipt with an operation id
    const r1 = results[0]!;
    assert.equal(r1.code, 0, `send failed: ${r1.stderr}`);
    const rec1 = JSON.parse(r1.stdout) as { operation: string; state: string };
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
    assert.equal(
      (JSON.parse(r2.stdout) as { operation: string }).operation,
      rec1.operation,
    );

    // 3) same key + DIFFERENT payload -> REQUEST_KEY_REUSED, exit 2
    const r3 = results[2]!;
    assert.equal(
      r3.code,
      2,
      `expected exit 2, got ${r3.code}: ${r3.stdout}${r3.stderr}`,
    );
    assert.match(r3.stderr, /REQUEST_KEY_REUSED/);

    // 4) --request <key> re-invocation of the succeeded op (IPC-008)
    const r4 = results[3]!;
    assert.equal(r4.code, 0, `--request replay failed: ${r4.stderr}`);
    assert.equal(
      (JSON.parse(r4.stdout) as { operation: string }).operation,
      rec1.operation,
    );

    // 5) submit via the CLI (bundle built locally, streamed): succeeded + ref
    const r5 = results[4]!;
    assert.equal(
      r5.code,
      0,
      `submit failed (code ${r5.code}): stdout=${JSON.stringify(r5.stdout)} stderr=${JSON.stringify(r5.stderr)}`,
    );
    const subRec = JSON.parse(r5.stdout) as {
      result: { publishedRef: string; candidate: string };
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
    assert.equal(
      r6.code,
      3,
      `expected exit 3 for dead socket, got ${r6.code}: ${r6.stdout}${r6.stderr}`,
    );
    const cachePath = join(
      homeDir,
      ".local",
      "state",
      "oma",
      "requests",
      "ksub2.json",
    );
    assert.ok(
      existsSync(cachePath),
      "freeze cache must survive a dead-socket attempt",
    );

    // 7) --request recovery against the live broker: operation.get miss ->
    //    replay of the frozen payload -> succeeded with ITS OWN receipt/ref
    const r7 = results[6]!;
    assert.equal(
      r7.code,
      0,
      `recovery failed (code ${r7.code}): stdout=${JSON.stringify(r7.stdout)} stderr=${JSON.stringify(r7.stderr)}`,
    );
    const rec2 = JSON.parse(r7.stdout) as {
      result: { publishedRef: string; candidate: string };
    };
    const ref2Oid = sh([
      "--git-dir",
      join(env.state, "repos", "project.git"),
      "rev-parse",
      rec2.result.publishedRef,
    ]);
    assert.equal(
      ref2Oid,
      rec2.result.candidate,
      "recovered submit's ref must resolve to ITS candidate",
    );
  } finally {
    env.cleanup();
  }
});
