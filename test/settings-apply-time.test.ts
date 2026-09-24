// V15A/V15B (WP15, D05): each Config field says truthfully whether and when a
// value takes effect, and configured values are never shown as observed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { loadConfigurationSnapshot } from "../src/config.js";
import {
  bootstrapStateOf, commitField, fieldsOf, readSettings, INITIAL_WORKERS, PRINCIPAL_MODEL, WORKER_LIMIT, WORKER_MODEL, WORKER_PROFILE,
  type BootstrapState,
} from "../src/tui/sources/settings.js";
import { dashboardRows } from "../src/tui/view/dashboard.js";
import { StoreError } from "../src/domain/errors.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { unknownDashboard } from "./fixtures/dashboard.js";

const blocked = (fields: ReturnType<typeof fieldsOf>, id: string): string | null => {
  const field = fields.find(entry => entry.id === id)!;
  assert.ok(field, `field ${id} is not offered at all`);
  return field.kind === "link" ? null : field.blocked;
};

test("V15A: bootstrap state is read from the observed registry, and unknown is never assumed", () => {
  assert.equal(bootstrapStateOf({ kind: "unknown" }), "unknown");
  assert.equal(bootstrapStateOf({ kind: "observed", statuses: [] }), "pending");
  assert.equal(bootstrapStateOf({ kind: "observed", statuses: [{ agent: "principal" }] }), "done");
  assert.equal(bootstrapStateOf({ kind: "observed", statuses: [{ agent: "principal" }, { agent: "worker" }] }), "done");
});

test("V15A: seed fields are editable only while they can still take effect, and say why otherwise", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.path);
    for (const state of ["pending", "unknown"] as BootstrapState[]) {
      const fields = fieldsOf(settings.config, settings.workerProfile, state);
      assert.equal(blocked(fields, INITIAL_WORKERS), null, state);
      assert.equal(blocked(fields, WORKER_PROFILE), null, state);
    }
    const done = fieldsOf(settings.config, settings.workerProfile, "done");
    assert.match(blocked(done, INITIAL_WORKERS) ?? "", /이미 bootstrap/);
    assert.match(blocked(done, WORKER_PROFILE) ?? "", /이미 bootstrap/);
    // Fields read at later starts stay editable after bootstrap.
    for (const id of [PRINCIPAL_MODEL, WORKER_MODEL, WORKER_LIMIT]) assert.equal(blocked(done, id), null, id);
    // The writer refuses what the screen does not offer, and writes nothing.
    const manifest = readFileSync(f.path);
    assert.throws(() => commitField(settings, INITIAL_WORKERS, 2, "done"), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
    assert.deepEqual(readFileSync(f.path), manifest);
  } finally { f.close(); }
});

test("V15A: with no seeds the bootstrap profile is shown with no target, not hidden or silently kept", () => {
  const f = createCompleteConfigurationFixture();
  try {
    assert.equal(commitField(readSettings(f.path), INITIAL_WORKERS, 0, "pending").kind, "saved");
    const settings = readSettings(f.path);
    assert.equal(settings.config.initialResidents.length, 0);
    const fields = fieldsOf(settings.config, settings.workerProfile, "pending");
    assert.match(blocked(fields, WORKER_PROFILE) ?? "", /bootstrap worker 없음/);
    const before = readFileSync(f.path);
    assert.throws(() => commitField(settings, WORKER_PROFILE, "verifier", "pending"));
    assert.deepEqual(readFileSync(f.path), before, "a profile choice with no seed to carry it was stored somewhere");
  } finally { f.close(); }
});

test("V15A: the bootstrap profile changes the seeds only, never a profile's childProfile", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.path);
    const before = settings.config.agentProfiles;
    assert.equal(commitField(settings, WORKER_PROFILE, "verifier", "pending").kind, "saved");
    const after = loadConfigurationSnapshot(f.path).config;
    assert.deepEqual(after.initialResidents.map(seed => seed.profile), ["verifier"]);
    assert.deepEqual(after.agentProfiles, before, "an agent profile (childProfile, model, resources) changed");
  } finally { f.close(); }
});

test("V15A / WP15.03: confirming the value already configured writes nothing and says so", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.path);
    const limit = settings.config.quota.societyAgents;
    const manifest = readFileSync(f.path);
    assert.equal(commitField(settings, WORKER_LIMIT, limit, "done").kind, "unchanged");
    assert.deepEqual(readFileSync(f.path), manifest);
    assert.equal(commitField(readSettings(f.path), WORKER_LIMIT, limit + 1, "done").kind, "saved");
  } finally { f.close(); }
});

test("V15B: the dashboard shows the configured model as configured, and the running session's as what it started with", () => {
  const rows = (configured: string, session: string | null) =>
    dashboardRows({ ...unknownDashboard(), principalModel: { configured, session } }).find(row => row.label === "Model")!.value;
  assert.match(rows("review", null), /^review \(설정값 · 실행 중인 세션 없음\)$/);
  assert.match(rows("review", "review"), /^review \(설정값 · 현재 세션도 이 설정으로 시작\)$/);
  assert.match(rows("review", "standard"), /^review \(설정값 · 다음 세션부터 · 현재 세션은 standard로 시작\)$/);
  for (const value of [rows("review", null), rows("review", "review"), rows("review", "standard")])
    assert.doesNotMatch(value, /현재 모델|running model|active model/, "a configured value was labelled as the observed model");
});

test("V15A / WP15.03: an inline configuration confirmed at its current value is not rewritten", () => {
  const f = createCompleteConfigurationFixture();
  try {
    // The fixture's legacy inline file is a complete, valid inline config.
    const before = readFileSync(f.input);
    const inode = statSync(f.input).ino;
    const settings = readSettings(f.input);
    assert.equal(settings.layout.kind, "inline");
    assert.equal(commitField(settings, WORKER_LIMIT, settings.config.quota.societyAgents, "done").kind, "unchanged");
    assert.deepEqual(readFileSync(f.input), before);
    assert.equal(statSync(f.input).ino, inode, "the unchanged inline file was replaced");
    assert.equal(commitField(readSettings(f.input), WORKER_LIMIT, settings.config.quota.societyAgents + 1, "done").kind, "saved");
    assert.notEqual(statSync(f.input).ino, inode);
  } finally { f.close(); }
});
