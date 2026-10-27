import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** Public reads preserve authentication, version and parameter error precedence. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { StoreError } from "@oma/domain/errors";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
type Answer = { ok: true; result: unknown } | { ok: false; code: string | undefined; retry: string | undefined };
/** A refusal may be an answer frame or a thrown error; both are the caller's outcome. */
async function answer(call: Promise<object>): Promise<Answer> {
  try {
    const value = await call as { ok: boolean; result?: unknown; error?: { code: string; retry: string } };
    return value.ok ? { ok: true, result: value.result } : { ok: false, code: value.error?.code, retry: value.error?.retry };
  } catch (error) { return { ok: false, code: (error as { code?: string }).code, retry: undefined }; }
}
/** Real dispatch over a fixture ledger. */
function society(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-categories-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" })); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new PolicyExecution();
  t.mock.method(units, "observe", () => ({ activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "" }));
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) } });
  return { broker };
}

test("V21A: a read preserves authentication, version and DTO checks", async t => {
  const f = society(t);
  const status = (request: Record<string, unknown>, who: AuthContext = auth) => answer(f.broker.dispatch(who, request as never, null));
  assert.deepEqual(await status({ v: 1, id: "u", method: "no.such", params: {} }), { ok: false, code: "UNKNOWN_METHOD", retry: "never" });
  assert.deepEqual(await status({ v: 2, id: "v", method: "status.get", params: {} }), { ok: false, code: "UNSUPPORTED_VERSION", retry: "never" });
  assert.deepEqual(await status({ v: 1, id: "d", method: "status.get", params: { agent: 7 } }), { ok: false, code: "INVALID_REQUEST", retry: "never" });
  assert.deepEqual(await status({ v: 1, id: "s", method: "status.get", params: {} }, { ...auth, incarnation: 9 }), { ok: false, code: "STALE_RUN", retry: "never" });
  assert.deepEqual(await status({ v: 1, id: "k", method: "status.get", request: "r-read", params: {} }), { ok: false, code: "INVALID_REQUEST", retry: "never" });
});
