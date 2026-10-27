/** Closed setup and Linux grammar regressions. Actual execution is exercised
 * separately by native-git-execution.test.mjs without mocks. */
import test from "node:test";
import assert from "node:assert/strict";
import { candidateSandbox } from "@oma/platform-linux/candidate-sandbox";
import { CandidateSetupStatus, decodeCandidateSetupStatus } from "@oma/git/candidate-check";
import { snapshotIntegrationPolicy } from "@oma/domain/integration-policy";
const host = { rootfs: "/tmp/oma-check/rootfs", node: process.execPath, libdir: "/tmp/oma-check/product" };
const candidate = "a".repeat(40);
const check = snapshotIntegrationPolicy({ policyRevision: "test", protectedPaths: [], checks: [{ id: "exact", argv: ["/bin/test", "literal $variable", "=", "literal $variable"], env: { CHECK: "selected" } }] }).checks[0]!;
test("INT-002: exact argv and inherited canonical capability without execution quotas", () => {
  const command = candidateSandbox(host, candidate, check, ["/usr", "/lib"]);
  assert.equal(command.executable, "/usr/bin/bwrap");
  for (const flag of ["--unshare-all", "--share-net", "--new-session", "--die-with-parent", "--clearenv"]) assert.ok(command.argv.includes(flag));
  assert.deepEqual(command.argv.slice(command.argv.indexOf("--ro-bind-fd"), command.argv.indexOf("--ro-bind-fd") + 3), ["--ro-bind-fd", "7", "/git/project.git"]);
  assert.deepEqual(JSON.parse(command.argv.at(-1)!), { candidate, argv: check.argv,
    view: { git: "/usr/bin/git", project: "/git/project.git", workspace: "/workspace" } });
  assert.ok(Buffer.isBuffer(command.input) && command.input.length > 0); assert.equal(command.timeoutMs, null);
  assert.ok(!command.argv.some(arg => /MemoryMax|TasksMax|CPUQuota|RuntimeMaxSec|systemd-run/.test(arg)));
  assert.throws(() => candidateSandbox(host, candidate, check, ["/home"]), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => candidateSandbox({ ...host, rootfs: "/" }, candidate, check, []), { code: "UNSUPPORTED_PROFILE" });
});
test("INT-007: complete private prepared/ready sequence requests one final authorization", () => {
  let authorizations = 0; const status = new CandidateSetupStatus(() => { authorizations++; });
  for (const byte of Buffer.from('{"kind":"prepared"}\n{"kind":"ready"}\n')) status.write(Buffer.from([byte]));
  assert.equal(authorizations, 1); assert.deepEqual(status.finish(), { kind: "ready" });
  assert.deepEqual(decodeCandidateSetupStatus(Buffer.from('{"kind":"failed","code":"UNSUPPORTED_PROFILE"}\n')), { kind: "failed", code: "UNSUPPORTED_PROFILE" });
});
test("INT-007: missing, partial, repeated, reordered or open private status is unknown", () => {
  for (const text of ['', '{"kind":"ready"}\n', '{"kind":"prepared"}\n', '{"kind":"prepared"}\n{"kind":"ready"}',
    '{"kind":"prepared"}\n{"kind":"prepared"}\n', '{"kind":"prepared","actor":"forged"}\n',
    '{"kind":"failed","code":"CHECK_FAILED"}\n', '{"kind":"failed","code":"REF_STATE_UNKNOWN"}\n{"kind":"ready"}\n',
    'OMA_ERROR=UNSUPPORTED_PROFILE\n', '{"kind":"prepared"}\n{"kind":"ready"}\n{}\n', 'x'.repeat(1025)])
    assert.throws(() => decodeCandidateSetupStatus(Buffer.from(text)), { code: "REF_STATE_UNKNOWN" }, text);
});
test("INT-007/P0-1: current authority refusal prevents private gate release", () => {
  const denied = new Error("current authority revoked"), status = new CandidateSetupStatus(() => { throw denied; });
  assert.throws(() => status.write(Buffer.from('{"kind":"prepared"}\n')), error => error === denied);
  assert.throws(() => status.write(Buffer.from('{"kind":"ready"}\n')), error => error === denied);
  assert.throws(() => status.finish(), error => error === denied);
});
test("INT-007/P0-5: incomplete EOF stays poisoned and cannot later authorize exec", () => {
  for (const prefix of ['', '{"kind":', '{"kind":"prepared"}\n']) {
    let authorizations = 0;
    const status = new CandidateSetupStatus(() => { authorizations++; });
    status.write(Buffer.from(prefix));
    let failure: unknown;
    assert.throws(() => status.finish(), error => { failure = error; return (error as { code: string }).code === "REF_STATE_UNKNOWN"; });
    const before = authorizations;
    assert.throws(() => status.write(Buffer.from('{"kind":"prepared"}\n{"kind":"ready"}\n')), error => error === failure);
    assert.throws(() => status.finish(), error => error === failure);
    assert.equal(authorizations, before);
  }
});

test("INT-007/P0-2: setup grammar preserves and refuses a BOM without authorizing exec", () => {
  let authorizations = 0; const status = new CandidateSetupStatus(() => { authorizations++; });
  assert.throws(() => status.write(Buffer.from('\ufeff{"kind":"prepared"}\n{"kind":"ready"}\n')), { code: "REF_STATE_UNKNOWN" });
  assert.throws(() => status.write(Buffer.from('{"kind":"prepared"}\n{"kind":"ready"}\n')), { code: "REF_STATE_UNKNOWN" });
  assert.throws(() => status.finish(), { code: "REF_STATE_UNKNOWN" });
  assert.equal(authorizations, 0);
});
