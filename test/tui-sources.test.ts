import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { AgentStatus, HostConfigV1 } from "../implementation/contracts.js";
import { StoreError } from "../src/domain/errors.js";
import { TEST_RESOURCES } from "./fixtures/spec.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import {
  INITIAL_WORKERS, PRINCIPAL_MODEL, WORKER_LIMIT, WORKER_MODEL, WORKER_PROFILE,
  applyField, fieldsOf, readSettings, revisionFor, settingsOf, writeSettings,
} from "../src/tui/sources/settings.js";
import { CORE_EXTENSION, nextEntries, readExtensions, toggleExtension } from "../src/tui/sources/extensions.js";
import { parseMessage, principalMailbox, readBody, readMailbox, unreadCount } from "../src/tui/sources/mail.js";
import { dashboardData, type DashboardInput } from "../src/tui/dashboard.js";
import { dashboardRows } from "../src/tui/view/dashboard.js";

/** Observation to words: the data layer interprets, the view words it. These
 * tests hold the whole chain, so a regression in either layer shows here. */
const dashboardLines = (input: DashboardInput) => dashboardRows(dashboardData(input));
import { TuiTransport } from "../src/tui/transport.js";
import { STATUS_STALE_MS, encodeStatusView, statusViewPath } from "../src/protocol/status-view.js";
import { sessionArgv } from "../src/tui/session.js";

function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }

function config(root: string): HostConfigV1 {
  return {
    schemaVersion: 1,
    society: "demo",
    installation: { node: process.execPath, libdir: root, rootfs: root, deploymentDigest: digest("d") },
    modelProfiles: {
      cheap: { provider: "p", model: "cheap", credentialRef: "none", codecRevision: "c", pricingRevision: "r", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 },
      strong: { provider: "p", model: "strong", credentialRef: "none", codecRevision: "c", pricingRevision: "r", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 },
    },
    agentProfiles: {
      principal: { modelProfile: "strong", capabilities: [], delegable: [], childProfile: "resident", resources: TEST_RESOURCES },
      resident: { modelProfile: "cheap", capabilities: [], delegable: [], childProfile: null, resources: TEST_RESOURCES },
    },
    principalProfile: "principal",
    initialResidents: [{ name: "a", profile: "resident", brief: "seed a" }, { name: "b", profile: "resident", brief: "seed b" }],
    quota: { societyAgents: 8, lineageAgents: 4, societyUnits: 100, lineageUnits: 50, principalReservedUnits: 10, inferenceSlots: 4, principalReservedSlots: 1, storageBytes: 1024 },
    integration: { policyRevision: "rev-initial", protectedPaths: [], checks: [] },
    limits: {
      frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64, replyReferences: 64,
      contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456, logBytes: 1048576,
      batchMaxMessages: 24, idleStreamSeconds: 1, receiptWaitSeconds: 1,
    },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}

function scratch(prefix: string): string { return mkdtempSync(join(tmpdir(), prefix)); }

test("T93/TUI-005,009: a model change rewrites only that profile's model reference", () => {
  const root = scratch("oma-tui-settings-");
  try {
    const settings = settingsOf(join(root, "config.json"), config(root));
    assert.equal(settings.workerProfile, "resident");

    const principalChanged = applyField(settings, PRINCIPAL_MODEL, "cheap");
    assert.equal(principalChanged.agentProfiles["principal"]!.modelProfile, "cheap");
    // TUI-009: an existing Resident keeps its own frozen reference.
    assert.equal(principalChanged.agentProfiles["resident"]!.modelProfile, "cheap");
    assert.deepEqual(principalChanged.quota, settings.config.quota);
    assert.deepEqual(principalChanged.initialResidents, settings.config.initialResidents);

    const workerChanged = applyField(settings, WORKER_MODEL, "strong");
    assert.equal(workerChanged.agentProfiles["resident"]!.modelProfile, "strong");
    assert.equal(workerChanged.agentProfiles["principal"]!.modelProfile, "strong");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T93/TUI-005: an undeclared model or profile name is refused, not coerced", () => {
  const root = scratch("oma-tui-settings-");
  try {
    const settings = settingsOf(join(root, "config.json"), config(root));
    for (const [field, value] of [[PRINCIPAL_MODEL, "invented"], [WORKER_MODEL, "invented"], [WORKER_PROFILE, "nope"]] as const)
      assert.throws(() => applyField(settings, field, value), (error: unknown) =>
        error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
    assert.throws(() => applyField(settings, "not-a-field", 1), (error: unknown) =>
      error instanceof StoreError && error.code === "INVALID_REQUEST");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T94/TUI-007: writing settings replaces config.json atomically with a fresh policy revision", () => {
  const root = scratch("oma-tui-write-");
  try {
    const path = join(root, "config.json");
    const original = config(root);
    writeFileSync(path, JSON.stringify(original, null, 2));
    const before = readSettings(path);
    assert.equal(before.config.integration.policyRevision, "rev-initial");

    const written = writeSettings(path, applyField(before, WORKER_LIMIT, 12));
    const reloaded = readSettings(path);
    assert.equal(reloaded.config.quota.societyAgents, 12);
    assert.notEqual(reloaded.config.integration.policyRevision, "rev-initial");
    assert.equal(reloaded.config.integration.policyRevision, written.integration.policyRevision);
    // Deterministic: the same content yields the same revision, so a no-op
    // rewrite does not churn the policy identity.
    assert.equal(revisionFor(applyField(before, WORKER_LIMIT, 12)), revisionFor(applyField(before, WORKER_LIMIT, 12)));
    assert.notEqual(revisionFor(applyField(before, WORKER_LIMIT, 12)), revisionFor(applyField(before, WORKER_LIMIT, 13)));
    assert.equal(JSON.parse(readFileSync(path, "utf8")).quota.societyAgents, 12);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T96/TUI-008: Initial workers is bootstrap seed only and never touches the running quota", () => {
  const root = scratch("oma-tui-seed-");
  try {
    const settings = settingsOf(join(root, "config.json"), config(root));
    const seedField = settings.fields.find(field => field.id === INITIAL_WORKERS)!;
    assert.equal(seedField.kind === "number" && seedField.apply, "bootstrap-only");

    const grown = applyField(settings, INITIAL_WORKERS, 4);
    assert.equal(grown.initialResidents.length, 4);
    assert.deepEqual(grown.quota, settings.config.quota);
    assert.deepEqual(grown.initialResidents.slice(0, 2), settings.config.initialResidents);
    assert.equal(new Set(grown.initialResidents.map(resident => resident.name)).size, 4);

    const shrunk = applyField(settings, INITIAL_WORKERS, 1);
    assert.deepEqual(shrunk.initialResidents, settings.config.initialResidents.slice(0, 1));
    assert.deepEqual(shrunk.quota, settings.config.quota);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T96/TUI-007: every exposed field declares an apply scope that matches its real effect", () => {
  const root = scratch("oma-tui-scope-");
  try {
    const fields = fieldsOf(config(root), "resident");
    const scopes = new Map(fields.flatMap(field => (field.kind === "link" ? [] : [[field.id, field.apply] as const])));
    assert.equal(scopes.get(PRINCIPAL_MODEL), "next-session");
    assert.equal(scopes.get(WORKER_MODEL), "next-activation");
    assert.equal(scopes.get(WORKER_LIMIT), "restart");
    assert.equal(scopes.get(INITIAL_WORKERS), "bootstrap-only");
    // The Config screen never offers to run Residents as the Principal.
    const profileField = fields.find(field => field.id === WORKER_PROFILE)!;
    assert.ok(profileField.kind === "choice" && !profileField.options.includes("principal"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T97/TUI-010: the core extension stays first and selection is confined to libdir", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const extensionDir = join(fixture.installation, "extensions");
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(join(extensionDir, "review.js"), "export {};\n");
    writeFileSync(join(extensionDir, "browser.js"), "export {};\n");
    fixture.edit("roles/resident.json", role => {
      role.extensions = [CORE_EXTENSION, "extensions/review.js"];
    });
    const settings = readSettings(fixture.path);
    const context = readExtensions(settings.snapshot!, "principal", "resident");
    assert.equal(context.editable, true);
    assert.equal(context.rows[0]!.id, CORE_EXTENSION);
    assert.equal(context.rows[0]!.locked, true);
    const review = context.rows.find(row => row.id === "extensions/review.js")!;
    assert.equal(review.principal, false);
    assert.equal(review.workers, true);
    assert.ok(context.rows.some(row => row.id === "extensions/browser.js"), "host-placed file is offered");

    const principalPath = context.roles.find(role => role.name === "principal")!.path;
    const authored = readFileSync(principalPath, "utf8");
    toggleExtension(context, "extensions/review.js", "principal", true);
    // D02/WP13: the change is a new managed generation the loader reads; the
    // manual role file the bundle was migrated from is kept as it was.
    const extensionsOf = () => readSettings(fixture.path).snapshot!.authoredRoles.principal!.value.extensions as string[];
    assert.deepEqual(extensionsOf(), [CORE_EXTENSION, "extensions/review.js"]);
    assert.equal(readFileSync(principalPath, "utf8"), authored);

    const current = readExtensions(readSettings(fixture.path).snapshot!, "principal", "resident");
    toggleExtension(current, CORE_EXTENSION, "principal", false);
    assert.equal(extensionsOf()[0], CORE_EXTENSION);
    assert.throws(() => toggleExtension(current, "extensions/missing.js", "workers", true), (error: unknown) =>
      error instanceof StoreError && error.code === "INVALID_REQUEST");
    // The context read before the first toggle is stale now: it is refused.
    assert.throws(() => toggleExtension(context, "extensions/browser.js", "workers", true), (error: unknown) =>
      error instanceof StoreError && error.code === "POLICY_CHANGED");
  } finally { fixture.close(); }
});

test("T97/TUI-010: an inline config exposes only the locked core and refuses edits", () => {
  const root = scratch("oma-tui-inline-");
  try {
    const path = join(root, "config.json");
    writeFileSync(path, JSON.stringify(config(root), null, 2));
    const context = readExtensions(path, "principal", "resident");
    assert.equal(context.editable, false);
    assert.deepEqual(context.rows.map(row => row.id), [CORE_EXTENSION]);
    assert.equal(context.rows[0]!.locked, true);
    assert.throws(() => toggleExtension(context, "extensions/x.js", "principal", true), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-010/WP14.04: the written entry list keeps the core first, stays deduplicated and keeps the authored order", () => {
  assert.deepEqual(nextEntries([CORE_EXTENSION], "extensions/b.js", true), [CORE_EXTENSION, "extensions/b.js"]);
  // Enabling appends; it does not re-sort what the host authored.
  assert.deepEqual(nextEntries([CORE_EXTENSION, "extensions/b.js"], "extensions/a.js", true),
    [CORE_EXTENSION, "extensions/b.js", "extensions/a.js"]);
  assert.deepEqual(nextEntries([CORE_EXTENSION, "extensions/z.js", "extensions/a.js", "extensions/m.js"], "extensions/a.js", false),
    [CORE_EXTENSION, "extensions/z.js", "extensions/m.js"]);
  assert.deepEqual(nextEntries([CORE_EXTENSION, "extensions/a.js"], "extensions/a.js", true), [CORE_EXTENSION, "extensions/a.js"]);
  assert.deepEqual(nextEntries([CORE_EXTENSION], CORE_EXTENSION, false), [CORE_EXTENSION]);
});

test("T98/TUI-011: unread comes from the mailbox position, and no read state is written", () => {
  const root = scratch("oma-tui-mail-");
  try {
    const box = principalMailbox(root);
    mkdirSync(box.newDir, { recursive: true });
    mkdirSync(box.curDir, { recursive: true });
    const eml = (subject: string, kind: string): string =>
      ["From: worker-a@demo.oma.invalid", `Subject: ${subject}`, `X-OMA-Kind: ${kind}`, "", "본문입니다.", ""].join("\n");
    writeFileSync(join(box.newDir, "m-1"), eml("API 선택 필요", "question"));
    writeFileSync(join(box.curDir, "m-2:2,"), eml("구현 완료", "result"));

    const rows = readMailbox(box).rows;
    assert.equal(rows.length, 2);
    const unread = rows.filter(row => row.unread);
    assert.deepEqual(unread.map(row => row.id), ["m-1"]);
    assert.equal(unreadCount(box), 1);
    assert.equal(rows.find(row => row.id === "m-1")!.kind, "question");
    assert.equal(rows.find(row => row.id === "m-1")!.from, "worker-a");
    assert.equal(readBody(join(box.newDir, "m-1")), "본문입니다.\n");

    // Reading must not move, rename or create anything.
    const before = [...readMailbox(box).rows];
    readMailbox(box);
    readBody(join(box.newDir, "m-1"));
    assert.deepEqual(readMailbox(box).rows, before);
    assert.equal(unreadCount(box), 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-011: folded and encoded headers are read without truncating the subject", () => {
  const encoded = Buffer.from("긴 제목", "utf8").toString("base64");
  const parsed = parseMessage([
    "From: a@demo.oma.invalid",
    `Subject: =?UTF-8?B?${encoded}?=`,
    "References: <one@x>",
    "  <two@x>",
    "",
    "body",
  ].join("\n"));
  assert.equal(parsed.headers["subject"], "긴 제목");
  assert.equal(parsed.headers["references"], "<one@x> <two@x>");
  assert.equal(parsed.body, "body");
});

test("T98/TUI-012: the Dashboard keeps an unobserved value unknown instead of guessing", () => {
  const root = scratch("oma-tui-dash-");
  try {
    const cfg = config(root);
    const unknownLines = dashboardLines({
      config: cfg, principalModel: { configured: "strong", session: null }, unread: 2,
      observation: { kind: "unknown", reason: "principal 실행 endpoint 없음", observedAtMs: Date.UTC(2026, 8, 18) },
    });
    const byLabel = new Map(unknownLines.map(line => [line.label, line.value]));
    for (const label of ["Active", "Pending", "Status"]) {
      assert.match(byLabel.get(label)!, /^unknown \(/, `${label} must stay unknown`);
      assert.doesNotMatch(byLabel.get(label)!, /^(0|Ready|inactive)$/);
    }
    // A configured seed count must not be presented as a running count.
    assert.match(byLabel.get("Workers")!, /configured/);
    assert.match(byLabel.get("Usage")!, /^unknown/);
    // WP28: the count is what waits for the Principal's session, not reading.
    assert.equal(byLabel.get("Mail"), "2건 Principal 세션에 전달 대기");

    const observed = dashboardLines({
      config: cfg, principalModel: { configured: "strong", session: null }, unread: 0,
      observation: {
        kind: "observed", observedAtMs: Date.UTC(2026, 8, 18),
        statuses: [
          { agent: "a", desired: "enabled", activeState: "active", subState: null, unitResult: null, execMainStatus: null, pending: 1, preparedBatches: 0, reason: null, runnerObservedAtMs: null },
          { agent: "b", desired: "stopped", activeState: "inactive", subState: null, unitResult: null, execMainStatus: null, pending: 2, preparedBatches: 0, reason: null, runnerObservedAtMs: null },
          { agent: "principal", desired: "enabled", activeState: "active", subState: null, unitResult: null, execMainStatus: null, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null },
        ],
      },
    });
    const observedByLabel = new Map(observed.map(line => [line.label, line.value]));
    assert.equal(observedByLabel.get("Active"), "1");
    assert.equal(observedByLabel.get("Workers"), "2 / 8");
    assert.match(observedByLabel.get("Pending")!, /^3 \(/);
    assert.match(observedByLabel.get("Status")!, /^observed \(/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-012/SB-002-E: the Dashboard says whether Residents are confined", () => {
  const root = scratch("oma-tui-sandbox-");
  try {
    const cfg = config(root);
    const line = (installation: { rootfs: string }): string => {
      const lines = dashboardLines({
        config: { ...cfg, installation: { ...cfg.installation, ...installation } },
        principalModel: { configured: "strong", session: null }, unread: 0,
        observation: { kind: "unknown", reason: "x", observedAtMs: Date.UTC(2026, 8, 18) },
      });
      return new Map(lines.map(entry => [entry.label, entry.value])).get("Sandbox")!;
    };
    // `/` is not a rootfs: SB-001 forbids binding the host root, so the value
    // means none was declared. The user has to be able to read that.
    assert.match(line({ rootfs: "/" }), /비봉인/);
    const confined = line({ rootfs: "/opt/oma/rootfs" });
    assert.doesNotMatch(confined, /비봉인/);
    assert.match(confined, /\/opt\/oma\/rootfs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-021: the Dashboard reads the broker's status view and never invents one", async () => {
  const root = scratch("oma-tui-view-");
  try {
    let clock = Date.UTC(2026, 8, 19, 12, 0, 0);
    const transport = new TuiTransport(root, "demo", 65536, () => clock);
    // No broker has published anything: unknown, with the reason.
    const absent = await transport.status();
    assert.equal(absent.kind, "unknown");
    assert.match((absent as { reason: string }).reason, /broker 관측 없음/);

    const row: AgentStatus = { agent: "a", desired: "enabled", activeState: "active", subState: "running",
      unitResult: "success", execMainStatus: 0, pending: 2, preparedBatches: 0, reason: null, runnerObservedAtMs: null };
    writeFileSync(statusViewPath(root), encodeStatusView("demo", { observedAtMs: clock, agents: [row] }));
    const fresh = await transport.status();
    assert.equal(fresh.kind, "observed");
    assert.equal((fresh as { statuses: readonly unknown[] }).statuses.length, 1);

    // A broker that stopped publishing is not a quiet broker.
    clock += STATUS_STALE_MS + 1;
    const stale = await transport.status();
    assert.equal(stale.kind, "unknown");
    assert.match((stale as { reason: string }).reason, /멈춤/);
    // The last real observation time is kept so the screen can show its age.
    assert.equal(stale.observedAtMs, clock - STATUS_STALE_MS - 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-021: a malformed or foreign status view is unknown, not partially shown", async () => {
  const root = scratch("oma-tui-view-bad-");
  try {
    const now = Date.UTC(2026, 8, 19);
    const transport = new TuiTransport(root, "demo", 65536, () => now);
    const good: AgentStatus = { agent: "a", desired: "enabled", activeState: null, subState: null, unitResult: null,
      execMainStatus: null, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null };
    for (const [label, body] of [
      ["not json", "{"],
      ["other society", encodeStatusView("other", { observedAtMs: now, agents: [good] })],
      ["negative pending", encodeStatusView("demo", { observedAtMs: now, agents: [{ ...good, pending: -1 }] })],
      ["unknown schema", JSON.stringify({ schema: 2, society: "demo", observedAtMs: now, agents: [] })],
      ["unknown desired state", JSON.stringify({ schema: 1, society: "demo", observedAtMs: now, agents: [{ ...good, desired: "ready" }] })],
      ["no time", JSON.stringify({ schema: 1, society: "demo", agents: [] })],
    ] as const) {
      writeFileSync(statusViewPath(root), body);
      const observed = await transport.status();
      assert.equal(observed.kind, "unknown", `${label} was shown as observed`);
    }
    // Oversized: larger than one frame is not a view the broker wrote.
    writeFileSync(statusViewPath(root), " ".repeat(70000));
    assert.equal((await transport.status()).kind, "unknown");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T92/TUI-004,014: the Principal session runs Pi in RPC mode with discovery switched off", () => {
  const argv = sessionArgv(
    { piCommand: "/usr/bin/pi", coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" },
    { society: "demo", provider: "pi", model: "current", workspaceBytes: 1024,
      extensions: [{ path: "/lib/core.js", sha256: "0".repeat(64) }, { path: "/lib/review.js", sha256: "1".repeat(64) }] },
  );
  assert.equal(argv[0], "--mode");
  assert.equal(argv[1], "rpc");
  for (const flag of ["--no-approve", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-extensions"])
    assert.ok(argv.includes(flag), `missing ${flag}`);
  assert.equal(argv[argv.indexOf("--exclude-tools") + 1], "bash,powershell");
  // provider=pi/model=current uses the existing connection rather than pinning a model.
  assert.ok(!argv.includes("--model"));
  // The core extension is passed once, not duplicated by the profile list.
  assert.equal(argv.filter(entry => entry === "/lib/core.js").length, 1);
  assert.ok(argv.includes("/lib/review.js"));

  const pinned = sessionArgv(
    { piCommand: "/usr/bin/pi", coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" },
    { society: "demo", provider: "openai-codex", model: "gpt", workspaceBytes: 1024, extensions: [] },
  );
  assert.equal(pinned[pinned.indexOf("--model") + 1], "openai-codex/gpt");
});
