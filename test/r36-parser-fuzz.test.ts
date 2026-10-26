import test from "node:test";
import assert from "node:assert/strict";
import { FrameParser, FrameError, parseJsonObject } from "@oma/protocol/frame";
import { parseNameStatusZ } from "@oma/git/observe";
import { CandidateSetupStatus } from "@oma/git/candidate-check";
import { parseEmlHeaders } from "@oma/mail/headers";
import { decodeAgentRow } from "@oma/storage/rows";
import { StoreError } from "@oma/domain/errors";
import { makeValidAgent } from "./fixtures/spec.js";
import { corruptValueForTest } from "./fixtures/corruption.js";
import { Seeded, PRNG_REVISION, integerParameter, replayMetadata, recordExplorationFailure, minimizeSequence } from "./model/reproducible.js";
import { FUZZ_SEEDS, INVALID_JSON, VALID_JSON, GIT_VALID, GIT_INVALID, SETUP_VALID, SETUP_FAILED, SETUP_INVALID, EML_VALID, EML_INVALID } from "./fuzz/corpus.js";

// Generator bounds only, NOT newly invented production JSON depth/item/time limits.
const MAX_CASE_BYTES = 4096;
const cases = integerParameter("OMA_TEST_FUZZ_CASES", 256, 100000);
function framed(payload: Buffer): Buffer {
  const header = Buffer.alloc(4); header.writeUInt32BE(payload.length); return Buffer.concat([header, payload]);
}
function readFrames(bytes: Buffer, seed: number): unknown[] | string {
  const parser = new FrameParser(MAX_CASE_BYTES), random = new Seeded(seed), result: unknown[] = [];
  try {
    for (let offset = 0; offset < bytes.length;) {
      const end = Math.min(bytes.length, offset + 1 + random.index(19));
      result.push(...parser.feed(bytes.subarray(offset, end)).map(frame => frame.raw)); offset = end;
    }
    parser.finish(); return result;
  } catch (error) {
    assert.ok(error instanceof FrameError, "frame target escaped its explicit rejection type");
    assert.equal(parser.poisoned, true);
    assert.throws(() => parser.feed(framed(Buffer.from('{"valid":true}'))), FrameError, "fatal parser must not resynchronize");
    return error.code;
  }
}
/** Private setup grammar only; no process or OS gate is simulated here. */
function readSetup(bytes: Buffer, seed: number) {
  const random = new Seeded(seed); let authorizations = 0;
  const parser = new CandidateSetupStatus(() => { authorizations++; });
  try {
    for (let offset = 0; offset < bytes.length;) {
      const end = Math.min(bytes.length, offset + 1 + random.index(19));
      parser.write(bytes.subarray(offset, end)); offset = end;
    }
    const outcome = parser.finish();
    assert.ok(authorizations <= 1);
    return { outcome, authorizations };
  } catch (error) {
    assert.ok(error instanceof StoreError && error.code === "REF_STATE_UNKNOWN", "setup parser escaped its rejection boundary");
    const before = authorizations;
    assert.throws(() => parser.write(Buffer.from(SETUP_VALID)), next => next === error, "a rejected setup must never resume authorization");
    assert.throws(() => parser.finish(), next => next === error);
    assert.equal(authorizations, before); assert.ok(authorizations <= 1);
    return { error: error.code, authorizations };
  }
}
function exercise(bytes: Buffer, seed: number): void {
  assert.ok(bytes.length <= MAX_CASE_BYTES);
  try { parseJsonObject(bytes); } catch (error) { assert.ok(error instanceof FrameError, "JSON target escaped its explicit rejection type"); }
  assert.deepEqual(readFrames(framed(bytes), seed), readFrames(framed(bytes), seed));
  const git = parseNameStatusZ(bytes); assert.equal(typeof git.ok, "boolean");
  assert.deepEqual(readSetup(bytes, seed), readSetup(bytes, seed));
  try { parseEmlHeaders(bytes, { maxHeaderBytes: MAX_CASE_BYTES }); }
  catch (error) { assert.ok(error instanceof StoreError && error.code === "INVALID_REQUEST", "EML target escaped its supported rejection boundary"); }
}

test("R36 parser corpus fixes independent golden outputs and fatal error behavior", () => {
  for (const value of VALID_JSON) {
    const bytes = framed(Buffer.from(JSON.stringify(value)));
    for (let cut = 0; cut <= bytes.length; cut++) {
      const parser = new FrameParser(MAX_CASE_BYTES);
      const actual = [...parser.feed(bytes.subarray(0, cut)), ...parser.feed(bytes.subarray(cut))].map(frame => frame.raw);
      parser.finish(); assert.deepEqual(actual, [value]);
    }
  }
  for (const source of INVALID_JSON) assert.throws(() => parseJsonObject(Buffer.from(source)), FrameError);
  assert.throws(() => parseJsonObject(Buffer.from([0x7b, 0x22, 0xc0, 0x80, 0x22, 0x3a, 0x31, 0x7d])), FrameError);
  assert.deepEqual(parseNameStatusZ(Buffer.from(GIT_VALID)), { ok: true, value: [{ status: "A", path: "new file.txt" }, { status: "M", path: "한글.txt" }] });
  for (const source of GIT_INVALID) assert.equal(parseNameStatusZ(Buffer.from(source)).ok, false);
  assert.deepEqual(readSetup(Buffer.from(SETUP_VALID), 1), { outcome: { kind: "ready" }, authorizations: 1 });
  assert.deepEqual(readSetup(Buffer.from(SETUP_FAILED), 1), { outcome: { kind: "failed", code: "REF_STATE_UNKNOWN" }, authorizations: 0 });
  for (const source of SETUP_INVALID) assert.equal(readSetup(Buffer.from(source), 1).error, "REF_STATE_UNKNOWN");
  assert.equal(parseEmlHeaders(EML_VALID).subject, "fixture");
  for (const source of EML_INVALID) assert.throws(() => parseEmlHeaders(source), { code: "INVALID_REQUEST" });
});

for (const seed of FUZZ_SEEDS) test(`R36 parser fuzz seed=${seed} cases=${cases} prng=${PRNG_REVISION}`, { timeout: 60000 }, async t => {
  const random = new Seeded(seed), metadata = replayMetadata(seed, { cases, maxCaseBytes: MAX_CASE_BYTES });
  const corpus = [...INVALID_JSON, ...GIT_INVALID, SETUP_VALID, SETUP_FAILED, ...SETUP_INVALID, EML_VALID, ...EML_INVALID];
  for (let index = 0; index < cases; index++) {
    let bytes: Buffer;
    if (index % 3 === 0) bytes = Buffer.from(Array.from({ length: random.index(256) }, () => random.index(256)));
    else {
      bytes = Buffer.from(corpus[random.index(corpus.length)]!);
      if (bytes.length) bytes[random.index(bytes.length)]! ^= 1 << random.index(8);
    }
    try { exercise(bytes, seed); }
    catch (error) {
      const reduced = await minimizeSequence([...bytes], async candidate => {
        try { exercise(Buffer.from(candidate), seed); return false; } catch { return true; }
      }, 64);
      t.diagnostic(`replay artifact: ${recordExplorationFailure("parser", { ...metadata, index, inputHex: bytes.toString("hex"), reducedHex: Buffer.from(reduced.sequence).toString("hex"), probes: reduced.probes, oneMinimal: reduced.oneMinimal })}`);
      throw error;
    }
  }
});

test("R36 durable decoders reject one-field mutations after a valid control", () => {
  const agent = makeValidAgent("alice");
  const raw = { name: agent.name, role: agent.role, desired: agent.desired, incarnation: agent.incarnation,
    profile: agent.profile, created_by: agent.createdBy, spec_hash: agent.specHash, spec_json: agent.specJson, created_at_ms: 1, updated_at_ms: 1 };
  assert.equal(decodeAgentRow(raw).name, "alice");
  for (const value of ["1", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, false])
    assert.throws(() => decodeAgentRow(corruptValueForTest(raw, "incarnation", value)), { code: "STORE_CORRUPT" });
});

test("R36 parser mutation sentinel redetects duplicate-key acceptance from the saved corpus", () => {
  const source = INVALID_JSON[1];
  assert.throws(() => parseJsonObject(Buffer.from(source)), FrameError);
  const mutant = (text: string) => JSON.parse(text); // deliberately removes the duplicate-key guard
  assert.doesNotThrow(() => mutant(source));
  assert.deepEqual(mutant(source), { v: 1 }, "mutant would silently collapse identity; the golden reject oracle detects it");
});
