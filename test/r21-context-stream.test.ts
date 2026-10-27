import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, lstatSync, rmSync, existsSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { BlobDescriptor, ContextEntry } from "@oma/contracts";
import { generateOperationId } from "@oma/native/identity";
import { ContextTextValidator, contextFileCheck } from "@oma/domain/context-policy";
import { TreeLease, treeQuiescence, leasePathOf } from "@oma/storage/tree-lease";
import { PreparedContextTree, prepareContextStream } from "@oma/storage/context-stream";
import { contextStagingPathAt } from "@oma/domain/paths";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const files = [
  { path: "GOAL.md", data: Buffer.from("\uFEFF# 한글 GOAL\r\nunchanged bytes\n") },
  { path: "RATIONALE.md", data: Buffer.alloc(0) },
  { path: "decisions/a..b.md", data: Buffer.from("final 한글\r\n") },
];
const body = Buffer.concat(files.map(file => file.data));
const entries = (): ContextEntry[] => files.map(file => ({ path: file.path, bytes: file.data.length, sha256: digest(file.data) }));
const descriptor = (): BlobDescriptor => ({ bytes: body.length, sha256: digest(body), mediaType: "application/vnd.oma.context-v1" });
async function* parts(bytes: Uint8Array, width: number): AsyncIterable<Uint8Array> {
  yield new Uint8Array(0);
  for (let offset = 0; offset < bytes.byteLength; offset += width) yield bytes.subarray(offset, offset + width);
  yield new Uint8Array(0);
}

test("R21: streaming text policy agrees with independent valid and invalid UTF-8 vectors at every split", () => {
  const cases: Array<{ path: string; bytes: Buffer; valid: boolean }> = [
    { path: "GOAL.md", bytes: Buffer.from("한글\r\n"), valid: true },
    { path: "GOAL.md", bytes: Buffer.from("\uFEFFhello"), valid: true },
    { path: "GOAL.md", bytes: Buffer.from("\uFEFF"), valid: false },
    { path: "GOAL.md", bytes: Buffer.alloc(0), valid: false },
    { path: "RATIONALE.md", bytes: Buffer.alloc(0), valid: true },
    { path: "GOAL.md", bytes: Buffer.from([0xe3, 0x81]), valid: false },
    { path: "GOAL.md", bytes: Buffer.from([0xc0, 0xaf]), valid: false },
    { path: "GOAL.md", bytes: Buffer.from("a\0b"), valid: false },
    { path: "GOAL.md", bytes: Buffer.from("a\x7fb"), valid: false },
    { path: "../GOAL.md", bytes: Buffer.from("valid text"), valid: false },
  ];
  for (const item of cases) {
    assert.equal(contextFileCheck(item.path, item.bytes) === null, item.valid);
    for (let split = 0; split <= item.bytes.length; split++) {
      const validator = new ContextTextValidator(item.path);
      const a = validator.append(item.bytes.subarray(0, split));
      const b = validator.append(item.bytes.subarray(split));
      const c = validator.finish();
      assert.equal(a === null && b === null && c === null, item.valid, `${item.path}/${item.bytes.toString("hex")}/${split}`);
    }
  }
});

test("R21: file boundaries, zero-byte non-GOAL and UTF-8 splits preserve literal bytes and fixed modes", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-stream-"));
  try {
    for (const width of [1, 2, 3, 7, body.length]) {
      const id = generateOperationId();
      const tree = await prepareContextStream(root, id, entries(), descriptor(), parts(body, width));
      assert.equal(tree.path, join(contextStagingPathAt(root, id), "tree"));
      for (const file of files) {
        assert.deepEqual(readFileSync(join(tree.path, file.path)), file.data);
        assert.equal(lstatSync(join(tree.path, file.path)).mode & 0o777, 0o644);
        assert.equal(lstatSync(join(tree.path, file.path)).nlink, 1);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const fault of ["short", "long", "aggregate-hash", "entry-hash", "invalid-text"] as const) {
  test(`R21: ${fault} fails before acceptance and cleans only that preparation`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-r21-fault-"));
    try {
      const control = await prepareContextStream(root, generateOperationId(), entries(), descriptor(), parts(body, 2));
      const manifest = entries(); const content = descriptor(); const id = generateOperationId();
      let bytes = body;
      if (fault === "short") bytes = body.subarray(0, -1);
      if (fault === "long") bytes = Buffer.concat([body, Buffer.from("x")]);
      if (fault === "aggregate-hash") content.sha256 = "0".repeat(64);
      if (fault === "entry-hash") manifest[0]!.sha256 = "0".repeat(64);
      if (fault === "invalid-text") { bytes = Buffer.from(body); bytes[0] = 0xff; }
      const sibling = join(root, "unrelated"); writeFileSync(sibling, "retained");
      await assert.rejects(prepareContextStream(root, id, manifest, content, parts(bytes, 2)), {
        code: fault === "invalid-text" ? "INVALID_REQUEST" : "STREAM_INVALID",
      });
      for (const file of files) {
        assert.equal(existsSync(join(contextStagingPathAt(root, id), "tree", file.path)), false);
        assert.deepEqual(readFileSync(join(control.path, file.path)), file.data);
      }
      assert.equal(existsSync(contextStagingPathAt(root, id)), false, "a failed preparation removes the root it created");
      assert.equal(readFileSync(sibling, "utf8"), "retained");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("R21: source mutations after the first await cannot alter frozen metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-freeze-"));
  try {
    const manifest = entries(); const content = descriptor();
    async function* mutation(): AsyncIterable<Uint8Array> {
      manifest[0]!.path = "../outside"; manifest[0]!.bytes = 1; content.sha256 = "0".repeat(64);
      yield body;
    }
    const tree = await prepareContextStream(root, generateOperationId(), manifest, content, mutation());
    assert.deepEqual(readFileSync(join(tree.path, "GOAL.md")), files[0]!.data);
    assert.deepEqual(readdirSync(tree.path).sort(), ["GOAL.md", "RATIONALE.md", "decisions"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AV-18: a failed staging-root acquire releases its lease -- nothing holds it after", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-lease-"));
  try {
    const id = generateOperationId();
    const staging = contextStagingPathAt(root, id);
    mkdirSync(dirname(staging), { recursive: true });
    // Something already stands where the staging root must be created: the
    // acquire fails after the lease is taken, and the lease must not stay held.
    writeFileSync(staging, "existing entry, not a directory");
    await assert.rejects(prepareContextStream(root, id, entries(), descriptor(), parts(body, 2)));
    assert.equal(treeQuiescence(staging).kind, "quiescent",
      "a stranded held lease would read active and keep the tree forever");
    assert.ok(existsSync(leasePathOf(staging)), "the lease file remains; only the hold is released");
    rmSync(staging);
    // Recovery sees a quiescent lease: the retry is not fenced by the dead hold.
    const retry = await prepareContextStream(root, generateOperationId(), entries(), descriptor(), parts(body, 2));
    assert.ok(existsSync(join(retry.path, "GOAL.md")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R21: an exclusive-path collision cannot delete an earlier operation's frozen files", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-collision-"));
  try {
    const id = generateOperationId();
    const tree = await prepareContextStream(root, id, entries(), descriptor(), parts(body, 3));
    await assert.rejects(prepareContextStream(root, id, entries(), descriptor(), parts(body, 3)), { code: "EEXIST" });
    for (const file of files) assert.deepEqual(readFileSync(join(tree.path, file.path)), file.data);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("V18A: a failed preparation keeps its root when a file it created was replaced", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-replaced-"));
  try {
    const id = generateOperationId();
    const goal = join(contextStagingPathAt(root, id), "tree", "GOAL.md");
    async function* replaced(): AsyncIterable<Uint8Array> {
      yield body.subarray(0, files[0]!.data.length);
      // Another writer replaces the finished file this preparation created.
      writeFileSync(`${goal}.other`, "someone else's file");
      renameSync(`${goal}.other`, goal);
      yield Buffer.from([0xff]);
    }
    await assert.rejects(prepareContextStream(root, id, entries(), descriptor(), replaced()), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal((error.errors[0] as { code?: string }).code, "INVALID_REQUEST");
      assert.ok(error.errors.some(cause => (cause as { code?: string }).code === "STORE_CORRUPT"));
      return true;
    });
    assert.equal(readFileSync(goal, "utf8"), "someone else's file");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("V18A: a staging root replaced after preparation is kept, and its cleanup is reported unconfirmed", () => {
  const base = mkdtempSync(join(tmpdir(), "oma-v18a-root-"));
  try {
    const root = join(base, "staging-op");
    mkdirSync(root, { mode: 0o700 });
    const pinned = lstatSync(root);
    const prepared = new PreparedContextTree(join(root, "tree"), root, { dev: pinned.dev, ino: pinned.ino }, TreeLease.take(root));
    // Something else now stands where the prepared root was.
    renameSync(root, join(base, "moved-away"));
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(join(root, "not-ours"), "another operation's bytes");
    assert.throws(() => prepared.discardUnaccepted(), (error: unknown) => (error as { code?: string }).code === "REF_STATE_UNKNOWN");
    assert.ok(existsSync(join(root, "not-ours")), "cleanup deleted a root it did not create");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
