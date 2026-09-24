/** V21A: every public and internal method names one closed resource category,
 * with no fallback for an unknown name, and a read over the storage limit still
 * passes authentication, version, key and DTO checks first. Real Store, Broker
 * and public dispatcher; unit observation is a scripted port.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "../implementation/contracts.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { Broker } from "../src/broker.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { PUBLIC_METHODS, INTERNAL_METHODS } from "../src/protocol/methods.js";
import { StoreError } from "../src/domain/errors.js";
import { ALL_CAPS, TEST_RESOURCES, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

const CATEGORIES = ["read", "admit", "settle", "safety-control"];
const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
type Answer = { ok: true; result: unknown } | { ok: false; code: string | undefined; retry: string | undefined };
/** A refusal may be an answer frame or a thrown error; both are the caller's outcome. */
async function answer(call: Promise<object>): Promise<Answer> {
  try {
    const value = await call as { ok: boolean; result?: unknown; error?: { code: string; retry: string } };
    return value.ok ? { ok: true, result: value.result } : { ok: false, code: value.error?.code, retry: value.error?.retry };
  } catch (error) { return { ok: false, code: (error as { code?: string }).code, retry: undefined }; }
}
/** A society whose state tree is always over a one-byte storage quota. */
function society(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-categories-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" })); });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "", config: join(root, "config.json"), run: join(root, "oma", "demo"), brokerUnit: "" }, join(root, "units"), { p: TEST_RESOURCES });
  t.mock.method(units, "observe", () => ({ activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, cgroup: "", invocationId: "" }));
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = new LifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const broker = new Broker(store, mail, units, views, lifecycle, null, null, { stateRoot: root, runRoot: join(root, "run"), society: "demo", storageBytes: 1 });
  return { broker };
}

test("V21A: every public and internal method names one closed resource category", () => {
  for (const [method, descriptor] of Object.entries(PUBLIC_METHODS)) {
    const resource = (descriptor as unknown as Record<string, unknown>).resource;
    assert.ok(CATEGORIES.includes(String(resource)), `${method} has a closed category`);
    // A read or ephemeral call never becomes new work, and a keyed mutation is never a read.
    assert.equal(resource === "read", descriptor.mode !== "mutation", method);
  }
  for (const [method, descriptor] of Object.entries(INTERNAL_METHODS)) {
    const resource = (descriptor as unknown as Record<string, unknown>).resource;
    if (method === "host.reconcile") assert.equal(resource, "staged", "recovery classifies its own stages");
    else assert.ok(CATEGORIES.includes(String(resource)), `${method} has a closed category`);
  }
  const categories = Object.fromEntries([...Object.entries(PUBLIC_METHODS), ...Object.entries(INTERNAL_METHODS)]
    .map(([method, descriptor]) => [method, (descriptor as unknown as Record<string, unknown>).resource]));
  assert.equal(categories["agent.stop"], "safety-control");
  assert.equal(categories["batch.complete"], "settle");
  assert.equal(categories["operation.get"], "read");
  assert.equal(categories["runner.pending"], "read");
});

test("V21A: an unknown or prototype method name has no category to fall back to", async () => {
  const methods = await import("../src/protocol/methods.js") as unknown as Record<string, unknown>;
  const resourceOf = methods.resourceCategoryOf as ((method: string) => unknown) | undefined;
  assert.equal(typeof resourceOf, "function", "one lookup owns the category of a method name");
  for (const name of ["nope.read", "toString", "__proto__", "constructor", ""])
    assert.throws(() => resourceOf!(name), (error: unknown) => error instanceof StoreError && error.code === "UNKNOWN_METHOD", name);
});

test("V21A: over the storage limit a read still gets authentication, version and DTO checks first", async t => {
  const f = society(t);
  const status = (request: Record<string, unknown>, who: AuthContext = auth) => answer(f.broker.dispatch(who, request as never, null));
  assert.deepEqual(await status({ v: 1, id: "u", method: "no.such", params: {} }), { ok: false, code: "UNKNOWN_METHOD", retry: "never" });
  assert.deepEqual(await status({ v: 2, id: "v", method: "status.get", params: {} }), { ok: false, code: "UNSUPPORTED_VERSION", retry: "never" });
  assert.deepEqual(await status({ v: 1, id: "d", method: "status.get", params: { agent: 7 } }), { ok: false, code: "INVALID_REQUEST", retry: "never" });
  assert.deepEqual(await status({ v: 1, id: "s", method: "status.get", params: {} }, { ...auth, incarnation: 9 }), { ok: false, code: "STALE_RUN", retry: "never" });
  assert.deepEqual(await status({ v: 1, id: "k", method: "status.get", request: "r-read", params: {} }), { ok: false, code: "INVALID_REQUEST", retry: "never" });
});
