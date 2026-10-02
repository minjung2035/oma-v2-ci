import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { FrameParser, encodeFrame } from "../src/frame.js";
import { generateOperationId } from "../src/ids.js";
import { RequestCache } from "../src/request-cache.js";
import { StoreError, publicFailure, failureText } from "../src/domain/errors.js";
import { attestationProblem } from "../src/domain/attestation.js";
const candidate = "2".repeat(40), base = "1".repeat(40);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const exact = [candidate, "--base", base, "--target", "main", "--policy-revision", "p1"];
const identity = { repo: "project", targetRef: "refs/heads/main", candidate, expectedBase: base, policyRevision: "p1" };
function run(home: string, args: string[]) {
  return new Promise<{ code: number | string; stdout: string; stderr: string }>(resolve => execFile(process.execPath, [CLI, ...args], {
    cwd: home, env: { PATH: process.env.PATH, HOME: home, OMA_SOCKET: join(home, "peer.sock") }, timeout: 10000, maxBuffer: 1024 * 1024,
  }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}
test("DR27: actual review CLI freezes evidence once, keeps exact identity, and rejects replay changes before file I/O", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-attest-cli-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const evidence = join(home, "evidence.md"); writeFileSync(evidence, "reviewed original bytes");
  const calls: Record<string, unknown>[] = []; const op = generateOperationId();
  const server = createServer(socket => { const parser = new FrameParser(256 * 1024);
    socket.on("error", () => {}); socket.on("data", (bytes: Buffer) => {
      for (const frame of parser.feed(bytes)) { calls.push(frame.raw);
        socket.end(encodeFrame({ v: 1, id: frame.raw.id, ok: true, result: { operation: op, state: "pending" } })); }
    }); });
  await new Promise<void>(resolve => server.listen(join(home, "peer.sock"), resolve)); t.after(() => server.close());
  const args = ["approve", ...exact, "--file", evidence, "--request", "review"];
  assert.equal((await run(home, args)).code, 0);
  assert.equal(calls[0]!.method, "attest.record"); assert.deepEqual(calls[0]!.params, {
    kind: "peer", identity, verdict: "APPROVE", evidence: "reviewed original bytes" });
  unlinkSync(evidence); assert.equal((await run(home, args)).code, 0);
  assert.equal(calls[1]!.method, "operation.get"); assert.deepEqual(calls[1]!.params, { key: "review" });
  const changed = await run(home, ["object", ...exact, "--file", evidence, "--request", "review"]);
  assert.equal(changed.code, 2); assert.match(changed.stderr, /REQUEST_KEY_REUSED/); assert.equal(calls.length, 2);
  const cache = new RequestCache(home).read("review"); assert.equal(cache.kind, "present");
});
test("DR27: CLI closed grammar rejects ambiguous modes, missing identity and invalid tiers without transport", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-attest-refuse-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const op = generateOperationId();
  for (const args of [
    ["approve", ...exact, "--decision", "APPROVE", "--file", "missing"],
    ["approve", candidate, "--file", "missing"],
    ["object", ...exact, "--decision", "REJECT", "--file", "missing"],
    ["challenge", op, "--valid", "false", "--floor", "HIGH", "--file", "missing"],
    ["challenge", op, "--valid", "true", "--applies", "false", "--file", "missing"],
    ["integrate", candidate, "--expect", base, "--tier", "low"],
  ]) { const result = await run(home, args); assert.equal(result.code, 2, result.stderr);
    assert.doesNotMatch(result.stderr, /Acceptance status unknown|cannot read/); }
});
test("DR27: exact attestation identity uses the shared non-coercing grammar; missing conditions survive public sanitization", () => {
  const fact = { kind: "peer", identity, verdict: "APPROVE", evidence: "read" };
  assert.equal(attestationProblem(fact), null);
  for (const policyRevision of ["p\n1", "p".repeat(129), ""]) assert.notEqual(attestationProblem({ ...fact, identity: { ...identity, policyRevision } }), null);
  assert.notEqual(attestationProblem({ ...fact, verdict: { toString: () => "APPROVE" } }), null);
  assert.notEqual(attestationProblem({ ...fact, identity: { ...identity, candidate: "a".repeat(64) } }), null);
  const failure = publicFailure(new StoreError("INTEGRATION_CONDITIONS", "missing", { details: { effectiveTier: "HIGH", missing: "Principal ACCEPT" } }));
  assert.deepEqual(failure.details, { effectiveTier: "HIGH", missing: "Principal ACCEPT" });
  assert.match(failureText(failure), /Principal ACCEPT/);
});
