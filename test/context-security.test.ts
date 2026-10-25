import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, linkSync, symlinkSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { RequestCache } from "#oma-test/app/request-cache";
import { sha256Hex } from "@oma/domain/canonical-json";
import { contextFileCheck } from "@oma/domain/validation";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

const cases = [
  { name: "empty", path: "GOAL.md", bytes: Buffer.alloc(0) },
  { name: "invalid-utf8", path: "GOAL.md", bytes: Buffer.from([0xc0, 0xaf]) },
  { name: "binary", path: "GOAL.md", bytes: Buffer.from("hello\0world") },
  { name: "config", path: ".git/config", bytes: Buffer.from("[core]\nfsmonitor = false\n") },
  { name: "attributes", path: ".gitattributes", bytes: Buffer.from("* filter=evil\n") },
  { name: "traversal", path: "decisions/../escape.md", bytes: Buffer.from("escape") },
];

test("CTX-001: broker-domain rejects unsupported paths and non-text before acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-security-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    seedGit(root);
    // The published actor identity and its durable capability are the boundary
    // under test, so the fixture seeds a real, decodable agent row first.
    store.transaction(() => store.insertAgent(makeValidAgent("a")));
    const { git } = gitFixture(root, store);
    for (const item of cases) {
      const files = item.path === "GOAL.md" ? [item] : [{ path: "GOAL.md", bytes: Buffer.from("# goal\n") }, item];
      files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const body = Buffer.concat(files.map(file => file.bytes));
      await assert.rejects(git.publishContext(gitAuth, item.name, {
        expected: null, entries: files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: sha256Hex(file.bytes) })),
        content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" },
      }, (async function* () { yield body; })()), { code: "INVALID_REQUEST" });
      assert.equal(store.getOperation("a", item.name), null);
    }
    for (const paths of [["GOAL.md", "GOAL.md"], ["RATIONALE.md", "GOAL.md"]]) {
      const data = Buffer.from("xx");
      await assert.rejects(git.publishContext(gitAuth, "bad-order", {
        expected: null, entries: paths.map(path => ({ path, bytes: 1, sha256: sha256Hex(Buffer.from("x")) })),
        content: { bytes: 2, sha256: sha256Hex(data), mediaType: "application/vnd.oma.context-v1" },
      }, (async function* () { yield data; })()), { code: "INVALID_REQUEST" });
      assert.equal(store.getOperation("a", "bad-order"), null);
    }
    assert.equal(contextFileCheck("decisions/a..b.md", Buffer.from("valid 한글\n")), null);
    assert.equal(contextFileCheck("RATIONALE.md", Buffer.alloc(0)), null);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("CTX-002/FS-003: a rejected context publish leaves no staging artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-staging-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    seedGit(root);
    store.transaction(() => store.insertAgent(makeValidAgent("a")));
    const { git } = gitFixture(root, store);
    const stagingDir = join(root, "staging");
    // P0V-77: a kept tree keeps its lease beside it; the trees are counted apart.
    const stagingNames = () => (existsSync(stagingDir) ? readdirSync(stagingDir).filter(name => name.startsWith("context-")).sort() : []);
    const stagingEntries = () => stagingNames().filter(name => !name.endsWith(".lease"));
    const stagingLeases = () => stagingNames().filter(name => name.endsWith(".lease"));
    const publish = (key: string, expected: string | null, files: Array<{ path: string; bytes: Buffer }>) => {
      const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const body = Buffer.concat(sorted.map(file => file.bytes));
      return git.publishContext(gitAuth, key, {
        expected, entries: sorted.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: sha256Hex(file.bytes) })),
        content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" },
      }, (async function* () { yield body; })());
    };
    const goal = { path: "GOAL.md", bytes: Buffer.from("# shared goal\n") };

    const first = await publish("staging-first", null, [goal]);
    assert.equal(first.state, "succeeded");
    const acceptedStaging = stagingEntries();
    assert.equal(acceptedStaging.length, 1, "an accepted publication keeps its recovery artifact");

    // Stale base and malformed content: the input error is what the caller can
    // act on, and the refused request leaves nothing behind.
    await assert.rejects(publish("staging-malformed", null, [{ path: "GOAL.md", bytes: Buffer.alloc(0) }]), { code: "INVALID_REQUEST" });
    // Stale base with valid content: a conflict, and still no artifact.
    await assert.rejects(publish("staging-stale", null, [goal]), { code: "CONTEXT_CONFLICT" });
    assert.deepEqual(stagingEntries(), acceptedStaging, "refused requests add no staging artifact");
    assert.deepEqual(stagingLeases(), acceptedStaging.map(name => `${name}.lease`), "a refused request's lease goes with its tree");
    assert.equal(store.getOperation("a", "staging-malformed"), null);
    assert.equal(store.getOperation("a", "staging-stale"), null);
  } finally { store.close(); removeTree(root); }
});

test("CTX-001: real CLI rejects symlink, hardlink, metadata and binary before connecting", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-cli-"));
  try {
    for (const name of ["symlink", "directory-link", "hardlink", ...cases.filter(item => item.name !== "traversal").map(item => item.name)]) {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, "GOAL.md"), "# goal\n");
      if (name === "symlink" || name === "hardlink") {
        const target = join(root, `${name}-target`);
        writeFileSync(target, "private source\n");
        rmSync(join(dir, "GOAL.md"));
        (name === "symlink" ? symlinkSync : linkSync)(target, join(dir, "GOAL.md"));
      } else if (name === "directory-link") symlinkSync(root, join(dir, "decisions"));
      else {
        const item = cases.find(item => item.name === name)!;
        if (item.path === ".git/config") mkdirSync(join(dir, ".git"));
        writeFileSync(join(dir, item.path), item.bytes);
      }
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url)), "context", "publish", dir, "--expect", "none", "--request", name], {
        env: { ...process.env, HOME: join(root, "home"), OMA_SOCKET: join(root, "absent.sock") }, encoding: "utf8", timeout: 10000,
      });
      assert.equal(child.status, 2, `${name}: ${child.stderr}`);
      assert.doesNotMatch(child.stderr, /connect.*absent\.sock/);
      assert.equal(new RequestCache(join(root, "home")).read(name).kind, "absent");
    }
    const valid = join(root, "valid");
    mkdirSync(join(valid, "decisions"), { recursive: true });
    writeFileSync(join(valid, "GOAL.md"), "# 한글 goal\n");
    writeFileSync(join(valid, "RATIONALE.md"), "");
    writeFileSync(join(valid, "decisions/a..b.md"), "valid\n");
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url)), "context", "publish", valid, "--expect", "none", "--request", "valid"], {
      env: { ...process.env, HOME: join(root, "home"), OMA_SOCKET: join(root, "absent.sock") }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.status, 3, child.stderr);
    const cache = new RequestCache(join(root, "home"));
    const frozen = cache.read("valid");
    assert.ok(frozen.kind === "present", "valid context must have a readable frozen request");
    assert.equal(frozen.value.method, "context.publish");
    assert.equal(frozen.value.lastReceipt, null);
    const digest = frozen.value.digest;
    assert.ok(digest, "a context freeze must retain its body digest");
    const body = cache.readBody("valid", digest);
    assert.ok(body.kind === "present", "the frozen body must match its recorded digest");
    assert.equal(Buffer.from(body.value).toString(), "# 한글 goal\nvalid\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
