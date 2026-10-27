/** TUI-021: the broker's status view and the terminal's reader agree.
 *
 * The broker writes through `ViewsModule.publishStatus`; the TUI reads through
 * `decodeStatusView`. If the two drift, the Dashboard silently falls back to
 * unknown forever, so the writer's real output is fed to the real reader.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { ViewsModule } from "#oma-test/app/views";
import { decodeStatusView, encodeStatusView, statusViewPath } from "@oma/protocol/status-view";
import { TuiTransport } from "#oma-test/app/application/status-observation";

test("T118 what the broker publishes is what the Dashboard accepts, and only its owner can read it", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-status-view-"));
  const store = new Store(join(root, "runtime.sqlite"), undefined, { society: "demo" });
  try {
    const views = new ViewsModule(store, root, "demo", "principal");
    const before = Date.now();
    // A unit whose state cannot be read must reach the reader as unknown
    // fields, not as a guessed "inactive".
    const snapshot = { observedAtMs: Date.now(), units: new Map(), failure: "unavailable" as const };
    views.publishStatus(snapshot, await views.statusOf(snapshot));
    const decoded = decodeStatusView(readFileSync(statusViewPath(root), "utf8"), "demo");
    assert.equal(decoded.kind, "view", decoded.kind === "invalid" ? decoded.reason : "");
    if (decoded.kind !== "view") return;
    assert.ok(decoded.view.observedAtMs >= before, "the view must carry when it was observed");
    assert.deepEqual(decoded.view.agents.map(agent => agent.agent).sort(),
      store.listAgents().map(agent => agent.name).sort());
    for (const agent of decoded.view.agents) assert.equal(agent.activeState, null);
    // Host-private: pending counts and unit states are not for other users.
    assert.equal(statSync(statusViewPath(root)).mode & 0o777, 0o600);
    // Another society reading the same path is refused rather than shown.
    assert.equal(decodeStatusView(readFileSync(statusViewPath(root), "utf8"), "other").kind, "invalid");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T118: an oversized or linked status view is refused, not read into memory", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-status-bounds-"));
  try {
    const path = statusViewPath(root);
    // Larger than the declared bound. Reading it whole and checking afterwards
    // would cost the memory the file claims before the refusal.
    writeFileSync(path, "x".repeat(4096));
    const observation = await new TuiTransport(root, "demo", 1024).status();
    assert.equal(observation.kind, "unknown");
    assert.match((observation as { reason: string }).reason, /too large/);

    // A link where the view should be is refused rather than followed.
    rmSync(path);
    symlinkSync("/etc/passwd", path);
    const linked = await new TuiTransport(root, "demo", 1024 * 1024).status();
    assert.equal(linked.kind, "unknown");
    assert.match((linked as { reason: string }).reason, /Could not read/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T118: a view dated ahead of the reader's clock is unknown, not current", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-status-future-"));
  try {
    const now = 1_800_000_000_000;
    // After the clock is set back an hour, the last view is an hour "ahead".
    writeFileSync(statusViewPath(root), encodeStatusView("demo", { observedAtMs: now + 3_600_000, agents: [] }));
    const observation = await new TuiTransport(root, "demo", 1024 * 1024, () => now).status();
    assert.equal(observation.kind, "unknown", "a future-dated view passed as current");
    assert.match((observation as { reason: string }).reason, /clock/);
    // Within one refresh interval of skew it is still an observation.
    writeFileSync(statusViewPath(root), encodeStatusView("demo", { observedAtMs: now + 1_000, agents: [] }));
    assert.equal((await new TuiTransport(root, "demo", 1024 * 1024, () => now).status()).kind, "observed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
