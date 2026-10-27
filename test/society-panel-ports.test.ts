import assert from "node:assert/strict";
import test from "node:test";
import { defaultHostConfig } from "@oma/config/defaults";
import { societyPanelPorts, type PanelState, type SocietySettingsView } from "@oma/tui/society-panel";

function fixture() {
  const config = defaultHostConfig({ society: "demo", node: "/node", libdir: "/lib/",  deploymentDigest: "a".repeat(64) });
  let view: SocietySettingsView = { config, workerProfile: "worker", unread: null, extensions: [] };
  let reads = 0;
  let outcome: { kind: "saved" } | { kind: "saved-unread"; reason: string } = { kind: "saved" };
  let failure: unknown;
  const saves: unknown[] = [];
  const state: PanelState = { observation: { kind: "unknown", reason: "offline", observedAtMs: 1 }, owned: true,
    conversationOpen: false, screenReady: false, sessionModel: null, engine: { model: null, thinking: null } };
  const ports = societyPanelPorts({ settings: () => { reads++; return view; }, unread: () => null,
    mail: () => ({ rows: [], unreadable: "offline", omitted: 0 }), body: () => null,
    saveField: (...args) => { saves.push(args); if (failure) throw failure; return outcome; }, setExtension() {},
  }, () => state);
  return { ports, saves, reads: () => reads, setUnread: () => { view = { ...view, unread: "read-back failed" }; },
    setOutcome: () => { outcome = { kind: "saved-unread", reason: "saved; cannot observe" }; },
    setFailure: (value: unknown) => { failure = value; } };
}
test("DR41: Society panel consumes one complete settings view per projection without a storage implementation", () => {
  const f = fixture();
  f.ports.configFields(); assert.equal(f.reads(), 1);
  const dashboard = f.ports.dashboard(); assert.equal(f.reads(), 2); assert.equal(dashboard.unread, null);
  assert.equal(dashboard.status.kind, "unknown");
  f.setUnread();
  assert.ok(f.ports.configFields().filter(row => row.kind !== "link").every(row => row.value === "?"));
  assert.equal(f.reads(), 3);
  assert.equal(f.ports.dashboard().principalModel.configured, "unknown");
});
test("DR41: Society settings port preserves saved-unread, unknown bootstrap and thrown publication uncertainty", () => {
  const f = fixture(); f.setOutcome();
  assert.deepEqual(f.ports.setField("initial-workers", 2), { kind: "saved-unread", reason: "saved; cannot observe" });
  assert.deepEqual(f.saves, [["initial-workers", 2, "unknown"]]);
  const unconfirmed = new Error("publication may have committed"); f.setFailure(unconfirmed);
  assert.throws(() => f.ports.setField("initial-workers", 3), error => error === unconfirmed);
});
