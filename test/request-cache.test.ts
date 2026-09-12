import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { RequestCache, CacheError, type FreezeInput, type CacheReader } from "../src/request-cache.js";
import { decodeReceipt } from "../src/protocol/receipt-codec.js";

const HELLO_HASH = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const OP = "op-12345678-1234-4234-8234-123456789abc";
function fixture(t: TestContext, reader?: CacheReader): { home: string; dir: string; cache: RequestCache } {
  const home = mkdtempSync(join(tmpdir(), "oma-cache-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, ".local/state/oma/requests");
  return { home, dir, cache: new RequestCache(home, reader) };
}
function context(key = "cache-1", text = "hello"): FreezeInput {
  const bytes = Buffer.byteLength(text);
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    key, method: "context.publish", createdAtMs: 1,
    params: {
      expected: null, entries: [{ path: "GOAL.md", bytes, sha256 }],
      content: { bytes, sha256, mediaType: "application/vnd.oma.context-v1" },
    },
    digest: { bytes, sha256 },
  };
}
const follow = (key = "follow-1"): FreezeInput => ({ key, method: "route.follow", params: { topic: "commons" }, createdAtMs: 1 });

// These tests are execution specifications, not generated evidence or a PASS claim.
test("RequestCache publishes body before frozen metadata and round-trips valid legacy shape", t => {
  const { dir, cache } = fixture(t);
  const input = context();
  assert.equal(input.digest?.sha256, HELLO_HASH);
  assert.deepEqual(cache.read(input.key), { kind: "absent" });
  const published = cache.freeze(input, Buffer.from("hello"));
  assert.equal(published.kind, "created");
  assert.deepEqual(cache.read(input.key), { kind: "present", value: { ...input, lastReceipt: null } });
  const body = cache.readBody(input.key, { bytes: 5, sha256: HELLO_HASH });
  assert.equal(body.kind, "present");
  if (body.kind === "present") assert.equal(Buffer.from(body.value).toString(), "hello");
  for (const suffix of ["json", "body"]) assert.equal(statSync(join(dir, `cache-1.${suffix}`)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir).sort(), ["cache-1.body", "cache-1.json"]);
  // Previously valid cache JSON needs no version field or migration.
  writeFileSync(join(dir, "legacy.json"), JSON.stringify({ ...follow("legacy"), lastReceipt: null }));
  assert.equal(cache.read("legacy").kind, "present");
});

test("malformed, extended, wrong-method and wrong-relation cache JSON are corrupt, never absent", t => {
  const { dir, cache } = fixture(t);
  cache.freeze(follow("bad"));
  const path = join(dir, "bad.json");
  assert.equal(cache.read("bad").kind, "present");
  const valid = { ...follow("bad"), lastReceipt: null };
  const invalid: unknown[] = [
    { ...valid, extra: true },
    { ...valid, method: "status.get" },
    { ...valid, params: {} },
    { ...valid, params: { topic: "commons", extra: true } },
    { ...valid, key: "different" },
    { ...valid, digest: { bytes: 5, sha256: HELLO_HASH } },
    { ...context("bad"), lastReceipt: null, digest: { bytes: 4, sha256: HELLO_HASH } },
    { ...valid, lastReceipt: { operation: OP, state: "invented" } },
  ];
  for (const value of invalid) {
    const bytes = JSON.stringify(value);
    writeFileSync(path, bytes);
    assert.equal(cache.read("bad").kind, "corrupt", bytes);
    assert.throws(() => cache.freeze(follow("bad")), (e: unknown) => e instanceof CacheError && e.code === "CACHE_CORRUPT");
    assert.equal(readFileSync(path, "utf8"), bytes, "corrupt evidence must not be rewritten");
  }
  writeFileSync(path, '{"key":');
  assert.equal(cache.read("bad").kind, "corrupt");
  assert.equal(cache.read("../bad").kind, "corrupt");
  assert.throws(() => cache.freeze(follow("../bad")), /invalid|key/i);
  assert.equal(decodeReceipt(null).ok, false, "null is not a Receipt");
});

test("I/O uncertainty is preserved instead of becoming an absent cache", t => {
  for (const code of ["EACCES", "EIO"]) {
    const { cache } = fixture(t, () => ({ kind: "unavailable", reason: code }));
    assert.deepEqual(cache.read("cache-1"), { kind: "unavailable", reason: code });
    assert.deepEqual(cache.readBody("cache-1", { bytes: 5, sha256: HELLO_HASH }), { kind: "unavailable", reason: code });
    assert.throws(() => cache.freeze(follow()), (e: unknown) => e instanceof CacheError && e.code === "CACHE_UNAVAILABLE");
  }
  const { cache } = fixture(t);
  assert.deepEqual(cache.read("cache-1"), { kind: "absent" });
  assert.deepEqual(cache.readBody("cache-1", { bytes: 5, sha256: HELLO_HASH }), { kind: "absent" });
});

test("body-only crashes and metadata-only corruption cannot reconstruct a freeze", t => {
  const { dir, cache } = fixture(t);
  mkdirSync(dir, { recursive: true });
  writeFileSync(cache.bodyPath("orphan"), "hello");
  assert.equal(cache.read("orphan").kind, "corrupt");
  assert.throws(() => cache.freeze(context("orphan"), Buffer.from("hello")), /orphan/);
  cache.freeze(context(), Buffer.from("hello"));
  const digest = { bytes: 5, sha256: HELLO_HASH };
  writeFileSync(cache.bodyPath("cache-1"), "hell");
  assert.equal(cache.readBody("cache-1", digest).kind, "corrupt");
  writeFileSync(cache.bodyPath("cache-1"), "world");
  assert.equal(cache.readBody("cache-1", digest).kind, "corrupt");
  unlinkSync(cache.bodyPath("cache-1"));
  assert.equal(cache.readBody("cache-1", digest).kind, "absent");
  assert.throws(() => cache.freeze(context(), Buffer.from("hello")), /missing/);
  assert.equal(readdirSync(dir).includes("cache-1.body"), false);
});

test("initial freeze cannot overwrite an identity or smuggle in a receipt", t => {
  const { dir, cache } = fixture(t);
  cache.freeze(context(), Buffer.from("hello"));
  const before = readFileSync(join(dir, "cache-1.json"), "utf8");
  assert.equal(cache.freeze(context(), Buffer.from("hello")).kind, "existing");
  assert.throws(() => cache.freeze(context("cache-1", "world"), Buffer.from("world")),
    (e: unknown) => e instanceof CacheError && e.code === "REQUEST_KEY_REUSED");
  assert.throws(() => cache.freeze({ ...follow(), lastReceipt: null } as FreezeInput), /lastReceipt/);
  assert.equal(readFileSync(join(dir, "cache-1.json"), "utf8"), before);
  assert.equal(readFileSync(cache.bodyPath("cache-1"), "utf8"), "hello");
});

test("receipt updates cannot replace immutable request fields or change operation identity", t => {
  const { dir, cache } = fixture(t);
  cache.freeze(follow());
  const pending = { operation: OP, state: "pending" };
  const updated = cache.updateReceipt("follow-1", pending);
  assert.deepEqual(updated, { ...follow(), lastReceipt: pending });
  const bytes = readFileSync(join(dir, "follow-1.json"), "utf8");
  assert.throws(() => cache.updateReceipt("follow-1", { ...pending, operation: "op-87654321-1234-4234-8234-123456789abc" }), /operation differs/);
  assert.throws(() => cache.updateReceipt("follow-1", { ...pending, params: {} }), /closed object/);
  assert.equal(readFileSync(join(dir, "follow-1.json"), "utf8"), bytes);
});

test("competing processes cannot publish different bodies for one frozen identity", async t => {
  const { home, cache } = fixture(t);
  const sourceUrl = new URL("../src/request-cache.js", import.meta.url).href;
  const run = (text: string) => {
    const source = `import { RequestCache } from ${JSON.stringify(sourceUrl)};
      const cache = new RequestCache(${JSON.stringify(home)});
      console.log('ready');
      await new Promise(resolve => process.stdin.once('data', resolve));
      try { console.log(JSON.stringify(cache.freeze(${JSON.stringify(context("race", text))}, Buffer.from(${JSON.stringify(text)})))); }
      catch (error) { console.log(JSON.stringify({ kind: 'error', code: error.code })); }
      process.stdin.destroy();`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => child.kill());
    let output = "";
    let stderr = "";
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    child.stdout.on("data", bytes => { output += String(bytes); if (output.includes("ready\n")) readyResolve(); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    const done = new Promise<void>((resolve, reject) => {
      child.once("error", error => { readyReject(error); reject(error); });
      child.once("exit", code => {
        if (code === 0) resolve();
        else { const error = new Error(`child exit ${code}: ${stderr}`); readyReject(error); reject(error); }
      });
    });
    return { child, ready, done, output: () => output };
  };
  const a = run("hello");
  const b = run("world");
  await Promise.all([a.ready, b.ready]);
  a.child.stdin.end("go\n");
  b.child.stdin.end("go\n");
  await Promise.all([a.done, b.done]);
  const outputs = [a.output(), b.output()];
  assert.equal(outputs.filter(output => output.includes('"kind":"created"')).length, 1);
  const observed = cache.read("race");
  assert.equal(observed.kind, "present");
  if (observed.kind !== "present" || !observed.value.digest) assert.fail("winner must have a validated stream descriptor");
  const body = cache.readBody("race", observed.value.digest);
  assert.equal(body.kind, "present");
  if (body.kind === "present") assert.ok(["hello", "world"].includes(Buffer.from(body.value).toString()));
});
