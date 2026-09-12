import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { Json, MutationMethod } from "../implementation/contracts.js";
import { RequestCache } from "../src/request-cache.js";
import { generateOperationId } from "../src/ids.js";
import { explicitFullOid, requestIntentConflict } from "../src/cli/request-intent.js";

const oid = "a".repeat(40);
const otherOid = "b".repeat(40);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function invoke(home: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: join(home, "never.sock") },
    encoding: "utf8", timeout: 15_000,
  });
}

test("method is compared before projecting current arguments", () => {
  let called = false;
  const conflict = requestIntentConflict({
    expectedMethod: "route.unfollow",
    explicitParams: () => { called = true; throw new Error("must not read arguments"); },
  }, { method: "route.follow", params: { topic: "work" } });
  assert.equal(conflict, "method");
  assert.equal(called, false);
});

test("direct full OIDs compare while aliases contribute no invented provenance", () => {
  assert.deepEqual(explicitFullOid("from", oid), { from: oid });
  assert.deepEqual(explicitFullOid("candidate", "c".repeat(64)), { candidate: "c".repeat(64) });
  for (const alias of ["HEAD", "main", "v1", "HEAD~1", "a".repeat(12)])
    assert.deepEqual(explicitFullOid("from", alias), {});
  assert.equal(requestIntentConflict({
    expectedMethod: "agent.create", explicitParams: () => ({ name: "alice", ...explicitFullOid("from", otherOid) }),
  }, { method: "agent.create", params: { name: "alice", from: oid, brief: "frozen" } }), "from");
  assert.equal(requestIntentConflict({
    expectedMethod: "git.submit", explicitParams: () => ({ to: ["alice", "bob"], paths: ["a", "z", "a"] }),
  }, { method: "git.submit", params: { to: ["bob", "alice", "bob"], paths: ["z", "a"], candidate: oid } }), null);
});

test("actual CLI refuses another method/full OID before network, files or Git effects", () => {
  const cases: Array<{ method: MutationMethod; params: Json; args: string[] }> = [
    { method: "route.follow", params: { topic: "work" }, args: ["unfollow", "work"] },
    { method: "agent.start", params: { agent: "alice" }, args: ["agent", "stop", "alice"] },
    { method: "route.follow", params: { topic: "work" }, args: ["send", "bob", "--subject", "subject", "--file", "missing-source"] },
    { method: "agent.create", params: { name: "alice", from: oid, brief: "frozen" },
      args: ["agent", "create", "alice", "--from", otherOid, "--file", "missing-source"] },
    { method: "git.submit", params: {
      candidate: oid, exportRef: "refs/oma/export/example", prerequisites: [], to: ["commons"],
      subject: "Re: submit", body: "frozen", paths: [],
    }, args: ["submit", otherOid] },
  ];
  for (const entry of cases) {
    const home = mkdtempSync(join(tmpdir(), "oma-r06-conflict-"));
    try {
      const key = "r06-request";
      const cache = new RequestCache(home);
      cache.write({ key, method: entry.method, params: entry.params, createdAtMs: 1, lastReceipt: null });
      const cachePath = join(home, ".local", "state", "oma", "requests", `${key}.json`);
      const before = readFileSync(cachePath);
      const output = invoke(home, [...entry.args, "--request", key]);
      assert.equal(output.error, undefined);
      assert.equal(output.status, 2, `${entry.method}: ${output.stderr}`);
      assert.match(output.stderr, /REQUEST_KEY_REUSED/);
      assert.deepEqual(readFileSync(cachePath), before);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("actual CLI cached create ignores a missing brief and an unresolvable HEAD", () => {
  const home = mkdtempSync(join(tmpdir(), "oma-r06-replay-"));
  try {
    const key = "r06-frozen";
    const cache = new RequestCache(home);
    cache.write({
      key, method: "agent.create", params: { name: "alice", from: oid, brief: "frozen brief" }, createdAtMs: 1,
      lastReceipt: {
        operation: generateOperationId(), state: "succeeded",
        result: { kind: "agent.create", agent: "alice", desired: "enabled", remainingOperations: [] },
      },
    });
    const cachePath = join(home, ".local", "state", "oma", "requests", `${key}.json`);
    const before = readFileSync(cachePath);
    const output = invoke(home, ["agent", "create", "alice", "--from", "HEAD", "--file", "deleted-brief", "--request", key]);
    assert.equal(output.error, undefined);
    assert.equal(output.status, 0, output.stderr);
    assert.equal(JSON.parse(output.stdout).state, "succeeded");
    assert.deepEqual(readFileSync(cachePath), before);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
