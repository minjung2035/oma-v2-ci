import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { RequestCache } from "#oma-test/app/request-cache";
import type { SubmitInput } from "@oma/git/submit";
import {
  gitAuth,
  gitCommand,
  gitFixture,
  seedGit,
} from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { runCliWithPeer } from "./fixtures/cli-peer.js";
import { runCliWithLookup } from "./fixtures/cli-lookup.js";

function fixture(format: "sha1" | "sha256" = "sha1") {
  const root = mkdtempSync(join(tmpdir(), "oma-submit-audit-"));
  const home = join(root, "home");
  mkdirSync(home);
  mkdirSync(join(home, "tmp"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => {
    tx.insertAgent(makeValidAgent("a"));
    tx.insertAgent(makeValidAgent("b"));
  });
  seedGit(root, format);
  const cwd = join(root, "seed");
  const parent = gitCommand(cwd, ["rev-parse", "HEAD"]);
  gitCommand(cwd, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@localhost",
    "commit",
    "--allow-empty",
    "-qm",
    "second local commit",
  ]);
  const candidate = gitCommand(cwd, ["rev-parse", "HEAD"]);
  const { git, paths } = gitFixture(root, store);
  const base = gitCommand(root, [
    "--git-dir",
    paths.projectGit,
    "rev-parse",
    "refs/heads/main",
  ]);
  return {
    root,
    home,
    cwd,
    store,
    git,
    paths,
    base,
    parent,
    candidate,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function probe(home: string, fault: "none" | "git" | "read"): string {
  const path = join(home, "probe.mjs");
  writeFileSync(
    path,
    `import fs from 'node:fs'; import cp from 'node:child_process';
    import { dirname, join } from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
    const spawn = cp.spawnSync, open = fs.openSync, read = fs.readSync; let bundleFd;
    cp.spawnSync = (command, args, options) => {
      if (command === '/usr/bin/git' && args[0] === 'bundle' && args[1] === 'create') {
        fs.appendFileSync(join(process.env.HOME, 'probe.jsonl'), JSON.stringify({ path: args[2], mode: fs.statSync(dirname(args[2])).mode & 511 }) + '\\n');
        if (${JSON.stringify(fault)} === 'git') { fs.writeFileSync(args[2], 'partial'); return spawn('/usr/bin/false', [], options); }
      }
      return spawn(command, args, options);
    };
    fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (typeof path === 'string' && path.endsWith('/candidate.bundle')) bundleFd = fd; return fd; };
    // P0V-78: the bundle is read through the CLI's one bounded reader.
    fs.readSync = (fd, ...args) => { if (${JSON.stringify(fault)} === 'read' && fd === bundleFd) throw Object.assign(new Error('controlled bundle read error'), { code: 'EIO' }); return read(fd, ...args); };
    syncBuiltinESMExports();`,
  );
  return path;
}
function assertTemporaryCleanup(home: string, key: string) {
  const events = readFileSync(join(home, "probe.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { path: string; mode: number });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.mode, 0o700);
  assert.equal(dirname(dirname(events[0]!.path)), join(home, "tmp"));
  assert.equal(events[0]!.path.includes(key), false);
  assert.deepEqual(readdirSync(join(home, "tmp")), ["keep.txt"]);
  assert.equal(
    readFileSync(join(home, "tmp/keep.txt"), "utf8"),
    "unrelated fixture",
  );
}

for (const format of ["sha1", "sha256"] as const)
  for (const mode of [
    "incremental",
    "self-contained",
    "already-known",
  ] as const) {
    test(`CLI submit: ${mode} ${format} uses broker evidence and freezes the original candidate`, async () => {
      const f = fixture(format);
      try {
        const key = `submit-${mode}`;
        const preload = probe(f.home, "none");
        const bodyPath = join(f.home, "body.txt");
        writeFileSync(bodyPath, "\ufeff  first\r\nsecond\rthird\n \r\n");
        writeFileSync(join(f.home, "tmp/keep.txt"), "unrelated fixture");
        const unrelated = gitCommand(f.cwd, [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@localhost",
          "commit-tree",
          `${f.base}^{tree}`,
          "-m",
          "unrelated root",
        ]);
        const requested = mode === "already-known" ? f.base : f.candidate;
        const run = await runCliWithPeer(
          f.home,
          f.cwd,
          [
            "submit",
            requested,
            "--request",
            key,
            "--to",
            "b",
            "--file",
            bodyPath,
          ],
          async (request, body) => {
            if (request.method === "git.known") {
              assert.deepEqual(request.params, { candidate: requested });
              return {
                v: 1,
                id: request.id,
                ok: true,
                result: {
                  hasCandidate: mode === "already-known",
                  prerequisites:
                    mode === "self-contained"
                      ? ["f".repeat(f.base.length), unrelated]
                      : [f.base],
                },
              };
            }
            assert.equal(request.method, "git.submit");
            assert.equal(request.request, key);
            const params = request.params as SubmitInput;
            assert.equal(params.candidate, requested);
            assert.equal(params.body, "\ufeff  first\nsecond\rthird\n \n");
            assert.deepEqual(
              params.prerequisites,
              mode === "incremental" ? [f.base] : [],
            );
            assert.notEqual(
              f.base,
              f.parent,
              "first parent is not the broker's available base",
            );
            assert.equal(params.bundle === undefined, mode === "already-known");
            const result = await f.git.submit(
              gitAuth,
              key,
              params,
              body ?? (async function* () {})(),
            );
            return { v: 1, id: request.id, ok: true, result };
          },
          preload,
        );
        assert.equal(run.signal, null);
        assert.equal(run.status, 0, run.stderr);
        assert.deepEqual(
          run.requests.map((request) => request.method),
          ["git.known", "git.submit"],
        );
        assert.equal(f.store.getOperation("a", key)?.state, "succeeded");
        if (mode !== "already-known") assertTemporaryCleanup(f.home, key);
        else assert.deepEqual(readdirSync(join(f.home, "tmp")), ["keep.txt"]);
        const cached = new RequestCache(f.home).read(key);
        assert.equal(cached.kind, "present");
        if (cached.kind !== "present")
          throw new Error("missing frozen request");
        rmSync(bodyPath);
        gitCommand(f.cwd, [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@localhost",
          "commit",
          "--allow-empty",
          "-qm",
          "moved HEAD",
        ]);
        const retry = await runCliWithLookup(
          f.home,
          f.cwd,
          ["submit", "HEAD", "--request", key, "--to", "b", "--file", bodyPath],
          key,
          cached.value.lastReceipt!,
        );
        assert.equal(retry.status, 0, retry.stderr);
        assert.equal(retry.requests.length, 1);
        assert.equal(retry.requests[0]!.method, "operation.get");
        assert.deepEqual(new RequestCache(f.home).read(key), cached);
        // P0V-38 / N15, P0-5: the lookup needs the key alone. A frozen body
        // that is gone does not keep the broker's receipt from the Human; it
        // would matter only for a resend, which a receipt makes unnecessary.
        if (cached.value.digest !== undefined) {
          rmSync(new RequestCache(f.home).bodyPath(key));
          const lookedUp = await runCliWithLookup(f.home, f.cwd,
            ["submit", "HEAD", "--request", key, "--to", "b", "--file", bodyPath], key, cached.value.lastReceipt!);
          assert.equal(lookedUp.status, 0, lookedUp.stderr);
          assert.deepEqual(lookedUp.requests.map(request => request.method), ["operation.get"]);
        }
      } finally {
        f.close();
      }
    });
  }

for (const fault of ["git", "read"] as const) {
  test(`CLI submit: ${fault} failure cleans the private bundle before exiting`, async () => {
    const f = fixture();
    try {
      const key = `failed-${fault}`;
      writeFileSync(join(f.home, "tmp/keep.txt"), "unrelated fixture");
      const run = await runCliWithPeer(
        f.home,
        f.cwd,
        ["submit", f.candidate, "--request", key],
        async (request) => {
          assert.equal(request.method, "git.known");
          return {
            v: 1,
            id: request.id,
            ok: true,
            result: { hasCandidate: false, prerequisites: [f.base] },
          };
        },
        probe(f.home, fault),
      );
      assert.equal(run.signal, null);
      assert.equal(run.status, fault === "git" ? 2 : 3, run.stderr);
      assert.match(
        run.stderr,
        fault === "git" ? /git bundle/ : /controlled bundle read error/,
      );
      assert.equal(run.requests.length, 1);
      assertTemporaryCleanup(f.home, key);
      assert.equal(new RequestCache(f.home).read(key).kind, "absent");
      assert.equal(f.store.getOperation("a", key), null);
    } finally {
      f.close();
    }
  });
}
