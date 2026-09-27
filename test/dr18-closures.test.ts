/** DR18: the decisions that closed the open questions and spikes, each held
 * by a test of what the product now does. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { StoreError } from "../src/domain/errors.js";
import { RegistryOperations } from "../src/lifecycle/registry-operations.js";
import { makeValidAgent } from "./fixtures/spec.js";

const peer = { pid: 1, uid: 1000, gid: 1000, cgroup: null };

test("DR18 / MAIL-001/002: a topic is followed by Residents; the Principal's follow is refused and records nothing", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr18-route-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "runtime.sqlite"));
  t.after(() => store.close());
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("worker-a")); });
  const registry = new RegistryOperations(store);
  const principal = { actor: "principal", incarnation: store.getAgent("principal")!.incarnation, role: "principal" as const,
    channel: "host" as const, capabilities: new Set(["route.follow" as const]), peer };
  assert.throws(() => registry.follow(principal, "release", true, "p-follow"),
    (error: unknown) => error instanceof StoreError && error.code === "CAPABILITY_DENIED" && /Residents/.test(error.message));
  assert.equal(store.getOperation("principal", "p-follow"), null, "a refused follow was recorded");
  assert.deepEqual(store.subscribers("release"), []);
  const resident = { actor: "worker-a", incarnation: store.getAgent("worker-a")!.incarnation, role: "resident" as const,
    channel: "actor" as const, capabilities: new Set(["route.follow" as const]), peer };
  assert.equal(registry.follow(resident, "release", true, "r-follow").state, "succeeded");
  assert.deepEqual(store.subscribers("release"), ["worker-a"]);
});

test("DR18 / S-01-CANDIDATE: checks are an unsupported configuration, and the root protects every change", async () => {
  const { protectedPathMatches } = await import("../src/git/observe.js");
  const { assertSupportedIntegration, snapshotIntegrationPolicy } = await import("../src/git/integration-policy.js");
  for (const path of ["README.md", "src/a.ts", "deep/er/file", ".github/workflows/ci.yml"])
    assert.equal(protectedPathMatches(path, "/"), true, path);
  assert.equal(protectedPathMatches("src/a.ts", "docs/"), false);
  assert.equal(protectedPathMatches("docs/a.md", "docs/"), true);
  assert.throws(() => assertSupportedIntegration(snapshotIntegrationPolicy({ policyRevision: "p", protectedPaths: [],
    checks: [{ id: "test", argv: ["/usr/bin/true"], env: {}, timeoutSeconds: 1 }] })),
  (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /not run by this version/.test(error.message));
});
