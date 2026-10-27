/** DR1–DR7 (docs/design-revisions.md): design revisions after the
 * real-provider functional runs, each tested where its decision takes effect. */
import test from "node:test";
import assert from "node:assert/strict";
import type { HostConfig } from "@oma/contracts";
import { defaultHostConfig } from "@oma/config/defaults";
import { HOST_GRANTED, resolveChildSpec } from "@oma/domain/child-policy";
import { commitField, readSettings, WORKER_INTEGRATE } from "#oma-test/app/application/settings";
import { applyLabel } from "@oma/tui/view/labels";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

const defaults = (): HostConfig => defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma",
   deploymentDigest: "a".repeat(64) });
const input = { name: "worker", from: "a".repeat(40), brief: "b" };
function created(cfg: HostConfig): readonly string[] {
  const parent = cfg.agentProfiles.parent!;
  const child = resolveChildSpec(cfg, { name: "parent", profile: "parent", capabilities: parent.capabilities }, input);
  assert.ok(child);
  return child.spec.capabilities;
}

/** DR4 -- A-002, AUTH-001, CREATE-002: no one could integrate by default, and
 * in a society already bootstrapped no setting could change that, because
 * CREATE-002 tied the host's delegation of code.integrate to the Principal
 * holding it. */
test("DR4 / A-002, CREATE-002: code.integrate is given by the host's profile, not by the parent", () => {
  assert.deepEqual([...HOST_GRANTED], ["code.integrate"]);
  const cfg = defaults();
  const principal = cfg.agentProfiles[cfg.principalProfile]!;
  assert.equal(principal.childProfile, null, "DR27: the Principal is not a child orchestrator");
  const worker = "resident";
  cfg.agentProfiles.parent = structuredClone(cfg.agentProfiles[worker]!);
  // By default no one has it (AUTH-001, TUI-019).
  assert.equal(principal.capabilities.includes("code.integrate"), false);
  assert.equal(created(cfg).includes("code.integrate"), false);
  // The host turns it on for children, though their parent neither holds nor delegates it.
  const on = structuredClone(cfg);
  on.agentProfiles[worker]!.capabilities = [...on.agentProfiles[worker]!.capabilities, "code.integrate"];
  assert.equal(created(on).includes("code.integrate"), true);
  assert.equal(on.agentProfiles[on.principalProfile]!.capabilities.includes("code.integrate"), false, "the Principal was given it");
  // A parent that holds and delegates it gives nothing the child profile lacks.
  const parentOnly = structuredClone(cfg);
  const p = parentOnly.agentProfiles.parent!;
  p.capabilities = [...p.capabilities, "code.integrate"]; p.delegable = [...p.delegable, "code.integrate"];
  assert.equal(created(parentOnly).includes("code.integrate"), false);
  // Every other capability is still the intersection: nothing widens by role.
  const narrowed = structuredClone(on);
  narrowed.agentProfiles.parent!.delegable = [];
  assert.deepEqual(created(narrowed), ["code.integrate"]);
});

test("DR4 / TUI-019, TUI-007, LIFE-008: the Human turns worker integrate on and off, for workers created afterwards", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const before = readSettings(f.path);
    const field = before.fields.find(entry => entry.id === WORKER_INTEGRATE);
    assert.ok(field && field.kind === "choice");
    assert.equal(field.value, "off");
    assert.equal(applyLabel(field.apply), "New workers only");
    assert.equal(commitField(before, WORKER_INTEGRATE, "on").kind, "saved");
    const on = readSettings(f.path);
    assert.ok(on.config.agentProfiles[on.workerProfile!]!.capabilities.includes("code.integrate"));
    assert.equal(on.config.agentProfiles[on.config.principalProfile]!.capabilities.includes("code.integrate"), false,
      "turning worker integrate on gave the Principal code.integrate");
    assert.equal(commitField(on, WORKER_INTEGRATE, "on").kind, "unchanged");
    assert.equal(commitField(on, WORKER_INTEGRATE, "off").kind, "saved");
    assert.equal(readSettings(f.path).config.agentProfiles[on.workerProfile!]!.capabilities.includes("code.integrate"), false);
    assert.throws(() => commitField(readSettings(f.path), WORKER_INTEGRATE, "maybe"));
  } finally { f.close(); }
});

/** DR3 -- ERR-001, the error table, CTX-003: a failure's message was always
 * its code, so "BROKER_UNAVAILABLE: BROKER_UNAVAILABLE" was all a caller
 * learnt, and facts the spec returns were erased with the internals. */
test("DR3 / ERR-001: a failure carries only the facts its code may, and every code has its words", async () => {
  const { ERROR_DESCRIPTIONS, ERROR_METADATA, StoreError, failureText, publicDetails, publicFailure } = await import("@oma/domain/errors");
  assert.deepEqual(Object.keys(ERROR_DESCRIPTIONS).sort(), Object.keys(ERROR_METADATA).sort());
  const oid = "1".repeat(40);
  const carried = (code: Parameters<typeof publicDetails>[0], details: Record<string, unknown>) =>
    publicFailure(new StoreError(code, "internal detail that must not leak", { details })).details;
  assert.deepEqual(carried("STALE_BASE", { actual: oid }), { actual: oid });
  assert.deepEqual(carried("CONTEXT_CONFLICT", { actual: null }), { actual: null });
  assert.deepEqual(carried("CAPABILITY_DENIED", { capability: "git.submit" }), { capability: "git.submit" });
  assert.deepEqual(carried("BROKER_UNAVAILABLE", { reason: "busy" }), { reason: "busy" });
  // Nothing outside the table: another code, another field, a value out of its set, an extra field.
  for (const [code, details] of [["CAPABILITY_DENIED", { actual: oid }], ["INTERNAL_ERROR", { reason: "busy" }], ["CAPABILITY_DENIED", { capability: "root" }],
    ["BROKER_UNAVAILABLE", { reason: "/home/dev/secret" }], ["STALE_BASE", { actual: oid, path: "/state" }], ["STALE_BASE", { actual: "HEAD" }]] as const)
    assert.equal(carried(code, details), undefined, `${code} ${JSON.stringify(details)}`);
  assert.equal(publicFailure(new StoreError("STALE_BASE", "x", { details: { actual: oid } })).message, "STALE_BASE", "the wire message stays the code");
  assert.equal(failureText({ code: "CAPABILITY_DENIED", message: "CAPABILITY_DENIED", details: { capability: "git.submit" } }),
    "CAPABILITY_DENIED: Insufficient permission for this request (capability: git.submit)");
  // An authored validation sentence is kept as it was written.
  assert.equal(failureText({ code: "INVALID_REQUEST", message: "invalid params for mail.send" }), "INVALID_REQUEST: invalid params for mail.send");
});

test("DR3 / AUTH-001: a capability revoked before acceptance names the capability", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("@oma/storage");
  const { assertCurrentActor } = await import("@oma/domain/authority");
  const { publicFailure } = await import("@oma/domain/errors");
  const { makeValidAgent } = await import("./fixtures/spec.js");
  const root = mkdtempSync(join(tmpdir(), "oma-dr3-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("alice", { capabilities: ["mail.send"] })); });
    const auth = { actor: "alice", incarnation: store.getAgent("alice")!.incarnation, role: "resident" as const, channel: "actor" as const,
      capabilities: new Set(["mail.send", "git.submit"] as const), peer: { pid: 1, uid: 1, gid: 1 } };
    const error = (() => { try { assertCurrentActor(store, auth as never, "git.submit"); return null; } catch (caught) { return caught; } })();
    assert.deepEqual(publicFailure(error).details, { capability: "git.submit" });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

/** DR7 -- D03, LIFE-006 (AV31): the broker was in the terminal's session, so a
 * hang-up there killed it mid-drain. A supervised service leads its own
 * session; its lifetime is its channel and an explicit stop. */
test("DR7 / D03: a supervised service leads its own session, apart from its starter's terminal", async () => {
  const { spawnSupervisedService } = await import("@oma/process/async");
  const { readFileSync } = await import("node:fs");
  const sessionOf = (stat: string): number => Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[3]);
  const child = spawnSupervisedService(process.execPath, ["-e",
    "process.stderr.write(require('node:fs').readFileSync('/proc/self/stat', 'utf8'))"], { PATH: process.env.PATH ?? "/usr/bin:/bin" });
  let stat = "";
  child.stderr!.setEncoding("utf8"); child.stderr!.on("data", chunk => { stat += chunk; });
  const code = await new Promise<number | null>(resolve => { child.once("exit", resolve); });
  assert.equal(code, 0);
  const own = sessionOf(readFileSync("/proc/self/stat", "utf8"));
  assert.notEqual(sessionOf(stat), own, "the service shares its starter's session and terminal");
  assert.equal(sessionOf(stat), child.pid, "the service does not lead its session");
});

test("DR3: a failure after acceptance keeps the facts its code may carry", async () => {
  // The thirteenth run: a create refused while another completed said
  // BROKER_UNAVAILABLE without its reason, because the accepted wrapper dropped it.
  const { StoreError, acceptedFailure, publicFailure } = await import("@oma/domain/errors");
  const wrapped = acceptedFailure(new StoreError("BROKER_UNAVAILABLE", "another accepted creation is completing", { details: { reason: "busy" } }));
  assert.deepEqual(publicFailure(wrapped).details, { reason: "busy" });
});
