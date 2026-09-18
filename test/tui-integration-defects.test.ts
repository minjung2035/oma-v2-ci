import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { HostConfigV1 } from "../implementation/contracts.js";
import { StoreError } from "../src/domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../src/domain/deployment.js";
import { TEST_RESOURCES } from "./fixtures/spec.js";
import { readConfigurationSource } from "../src/config/operations.js";
import { encodeToolSurfacePlan } from "../src/domain/tool-surface.js";
import { readExtensions, toggleExtension } from "../src/tui/sources/extensions.js";
import {
  PRINCIPAL_MODEL, WORKER_LIMIT, WORKER_MODEL,
  commitField, layoutOf, readSettings,
} from "../src/tui/sources/settings.js";
import { sessionArgv, sessionEnv } from "../src/tui/session.js";
import { registerToolSurface } from "../src/pi-extension.js";
import { assertExtensionIntegrity, verifiedPaths } from "../src/runtime/extension-integrity.js";

const CORE = DEPLOYMENT_LAYOUT.extension;
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const SURFACE = {
  defaultMode: "DISABLED",
  direct: ["read"],
  groups: [{ name: "web", description: "web tools", members: [{ tool: "fetch" }] }],
};

/** A split operations bundle with a toolSurface on the resident role. */
function bundle(root: string): string {
  const libdir = join(root, "lib");
  mkdirSync(join(libdir, "dist", "src"), { recursive: true });
  mkdirSync(join(libdir, "extensions"), { recursive: true });
  writeFileSync(join(libdir, CORE), "export {};\n");
  writeFileSync(join(libdir, "extensions", "review.js"), "export {};\n");
  writeFileSync(join(root, "prompt.md"), "");
  const host: Partial<HostConfigV1> = {
    schemaVersion: 1,
    society: "demo",
    installation: { node: process.execPath, libdir, rootfs: libdir, deploymentDigest: digest("d") },
    principalProfile: "principal",
    initialResidents: [{ name: "a", profile: "resident", brief: "seed" }],
    quota: { societyAgents: 8, lineageAgents: 4, societyUnits: 100, lineageUnits: 50, principalReservedUnits: 10, inferenceSlots: 4, principalReservedSlots: 1, storageBytes: 1024 },
    integration: { policyRevision: "rev-initial", protectedPaths: [], checks: [] },
    limits: { frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64, replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456, logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 1, receiptWaitSeconds: 1 },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
  writeFileSync(join(root, "host.json"), JSON.stringify(host, null, 2));
  writeFileSync(join(root, "models.json"), JSON.stringify({
    cheap: { provider: "p", model: "cheap", credentialRef: "none", codecRevision: "c", pricingRevision: "r", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 },
    strong: { provider: "p", model: "strong", credentialRef: "none", codecRevision: "c", pricingRevision: "r", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 },
  }, null, 2));
  const role = (model: string, child: string | null): Record<string, unknown> => ({
    agentProfile: { modelProfile: model, capabilities: [], delegable: [], childProfile: child, resources: TEST_RESOURCES },
    extensions: [CORE],
    promptFile: "prompt.md",
    toolSurface: SURFACE,
  });
  writeFileSync(join(root, "principal.json"), JSON.stringify(role("strong", "resident"), null, 2));
  writeFileSync(join(root, "resident.json"), JSON.stringify(role("cheap", null), null, 2));
  const index = join(root, "index.json");
  writeFileSync(index, JSON.stringify({
    kind: "oma-operations-v1", host: "host.json", models: "models.json",
    roles: { principal: "principal.json", resident: "resident.json" },
  }, null, 2));
  return index;
}

test("toggling an extension preserves every other field of the role file", () => {
  const root = scratch("oma-defect-ext-");
  try {
    const index = bundle(root);
    const context = readExtensions(index, "principal", "resident");
    assert.equal(context.editable, true);

    toggleExtension(context, "extensions/review.js", "principal", true);

    const written = readJson(join(root, "principal.json"));
    assert.deepEqual(written.extensions, [CORE, "extensions/review.js"]);
    // The optional projection and the prompt reference must survive the toggle.
    assert.deepEqual(written.toolSurface, SURFACE);
    assert.equal(written.promptFile, "prompt.md");
    assert.ok(written.agentProfile, "agentProfile must remain");
    // The loader still accepts the file, so the projection is still validated.
    const roles = readConfigurationSource(index).roles;
    assert.ok(roles["principal"]!.toolSurface, "toolSurface survives a round trip");
    assert.deepEqual(roles["principal"]!.toolSurface!.roots, ["web"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a Config edit patches the split bundle's real owners instead of flattening it", () => {
  const root = scratch("oma-defect-cfg-");
  try {
    const index = bundle(root);
    assert.equal(layoutOf(index).kind, "operations");
    const settings = readSettings(index);

    commitField(settings, PRINCIPAL_MODEL, "cheap");

    // The index stays an operations manifest; it is not overwritten with a
    // flattened HostConfigV1.
    const manifest = readJson(index);
    assert.equal(manifest.kind, "oma-operations-v1");
    assert.ok(manifest.roles, "roles map survives");
    assert.equal(manifest.quota, undefined, "the index must not gain flattened host fields");

    // The change landed in the role file, and its projection is untouched.
    const principal = readJson(join(root, "principal.json"));
    assert.equal((principal.agentProfile as Record<string, unknown>).modelProfile, "cheap");
    assert.deepEqual(principal.toolSurface, SURFACE);

    // CFG-005: the policy revision moved with the edit.
    const host = readJson(join(root, "host.json"));
    assert.notEqual((host.integration as Record<string, unknown>).policyRevision, "rev-initial");

    // The bundle still loads, so nothing structural was destroyed.
    const reloaded = readSettings(index);
    assert.equal(reloaded.config.agentProfiles["principal"]!.modelProfile, "cheap");
    assert.ok(readConfigurationSource(index).roles["resident"]!.toolSurface);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a quota edit on a split bundle lands in the host file only", () => {
  const root = scratch("oma-defect-quota-");
  try {
    const index = bundle(root);
    commitField(readSettings(index), WORKER_LIMIT, 12);
    const host = readJson(join(root, "host.json"));
    assert.equal((host.quota as Record<string, unknown>).societyAgents, 12);
    assert.equal(readJson(index).kind, "oma-operations-v1");
    assert.deepEqual(readJson(join(root, "resident.json")).toolSurface, SURFACE);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a worker model edit targets the resident role, not the principal", () => {
  const root = scratch("oma-defect-worker-");
  try {
    const index = bundle(root);
    commitField(readSettings(index), WORKER_MODEL, "strong");
    assert.equal((readJson(join(root, "resident.json")).agentProfile as Record<string, unknown>).modelProfile, "strong");
    assert.equal((readJson(join(root, "principal.json")).agentProfile as Record<string, unknown>).modelProfile, "strong");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the Principal session carries its role's projection into the Pi process", () => {
  const plan = readConfigurationSource(bundle(scratch("oma-defect-env-"))).roles["principal"]!.toolSurface!;
  const encoded = encodeToolSurfacePlan(plan);
  const withSurface = sessionEnv({ HOME: "/h", PATH: "/usr/bin" }, {
    society: "demo", provider: "pi", model: "current", extensions: [], toolSurface: encoded,
  });
  assert.equal(withSurface.OMA_TOOL_SURFACE, encoded);
  assert.equal(withSurface.HOME, "/h");
  const without = sessionEnv({ HOME: "/h", PATH: "/usr/bin" }, {
    society: "demo", provider: "pi", model: "current", extensions: [],
  });
  assert.ok(!("OMA_TOOL_SURFACE" in without), "a role without a projection sets no variable");
});

test("the entrypoint gives the Principal session its role extensions and projection", () => {
  const source = readFileSync(new URL("../../src/entry/oma.ts", import.meta.url), "utf8");
  // The Principal must not be started with a hardcoded empty extension list.
  assert.doesNotMatch(source, /extensions:\s*\[\]/);
  assert.match(source, /loadConfiguration\(configPath\)/, "role settings must be read");
  assert.match(source, /roleExtensions/);
  assert.match(source, /encodeToolSurfacePlan/);
});

interface FakeHost {
  setActiveTools(names: string[]): void;
  getActiveTools(): string[];
  getAllTools(): { name: string }[];
  registerTool(tool: unknown): void;
  on(event: string, handler: () => void): void;
}

function fakeHost(overrides: Partial<FakeHost> = {}): FakeHost & { active: string[]; registered: string[] } {
  const state = { active: ["read", "fetch", "danger"], registered: [] as string[] };
  const host = {
    ...state,
    setActiveTools(names: string[]) { state.active = [...names]; },
    getActiveTools() { return [...state.active]; },
    getAllTools() { return ["read", "fetch", "danger", "oma_mail_read"].map(name => ({ name })); },
    registerTool(tool: unknown) { state.registered.push((tool as { name: string }).name); },
    on() { /* session_start is exercised directly */ },
    ...overrides,
  };
  Object.defineProperty(host, "active", { get: () => state.active });
  Object.defineProperty(host, "registered", { get: () => state.registered });
  return host as FakeHost & { active: string[]; registered: string[] };
}

test("the tool surface fails closed when the host refuses to apply it", () => {
  const plan = encodeToolSurfacePlan({
    version: 1, defaultMode: "DISABLED", direct: ["read"], disabled: ["danger"],
    grouped: ["fetch"], groups: [{ name: "web", description: "web", children: ["fetch"] }], roots: ["web"],
  });
  const previous = process.env.OMA_TOOL_SURFACE;
  try {
    process.env.OMA_TOOL_SURFACE = plan;
    const refusing = fakeHost({ setActiveTools() { throw new Error("host refused"); } });
    assert.throws(
      () => registerToolSurface(refusing as never, ["oma_mail_read"]),
      /could not be applied/,
      "a refused projection must not be swallowed",
    );

    // A malformed plan must also fail loudly rather than leaving the surface as is.
    process.env.OMA_TOOL_SURFACE = "{not json";
    assert.throws(() => registerToolSurface(refusing as never, ["oma_mail_read"]), /could not be applied/);

    // An unreadable active set must never be treated as empty.
    process.env.OMA_TOOL_SURFACE = plan;
    const blind = fakeHost({ getAllTools() { throw new Error("no registry"); } });
    assert.throws(() => registerToolSurface(blind as never, ["oma_mail_read"]), /could not read the registered tools/);
  } finally {
    if (previous === undefined) delete process.env.OMA_TOOL_SURFACE;
    else process.env.OMA_TOOL_SURFACE = previous;
  }
});

test("the tool surface applies the projection when the host accepts it", () => {
  const previous = process.env.OMA_TOOL_SURFACE;
  try {
    process.env.OMA_TOOL_SURFACE = encodeToolSurfacePlan({
      version: 1, defaultMode: "DISABLED", direct: ["read"], disabled: ["danger"],
      grouped: ["fetch"], groups: [{ name: "web", description: "web", children: ["fetch"] }], roots: ["web"],
    });
    const host = fakeHost();
    registerToolSurface(host as never, ["oma_mail_read"]);
    assert.deepEqual(host.registered, ["web"], "one facade per group");
    assert.deepEqual(host.active, ["oma_mail_read", "read", "web"]);
    assert.ok(!host.active.includes("danger"));
    assert.ok(!host.active.includes("fetch"));
  } finally {
    if (previous === undefined) delete process.env.OMA_TOOL_SURFACE;
    else process.env.OMA_TOOL_SURFACE = previous;
  }
});

test("an unknown settings field is refused before anything is written", () => {
  const root = scratch("oma-defect-unknown-");
  try {
    const index = bundle(root);
    const before = readFileSync(join(root, "host.json"), "utf8");
    assert.throws(() => commitField(readSettings(index), "not-a-field", 1), (error: unknown) =>
      error instanceof StoreError && error.code === "INVALID_REQUEST");
    assert.equal(readFileSync(join(root, "host.json"), "utf8"), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a recorded extension digest is re-checked and a changed file refuses the start", () => {
  const root = scratch("oma-integrity-");
  try {
    const file = join(root, "review.js");
    writeFileSync(file, "export {};\n");
    const recorded = digest(readFileSync(file, "utf8"));
    assertExtensionIntegrity([{ path: file, sha256: recorded }]);

    // Same path, different bytes after the digest was recorded.
    writeFileSync(file, "export const evil = 1;\n");
    assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: recorded }]), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /changed after it was recorded/.test(error.message));

    // A file that disappeared is refused, not skipped.
    rmSync(file);
    assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: recorded }]), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /unreadable now/.test(error.message));

    // A directory at the recorded path is not a regular file.
    mkdirSync(file);
    assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: recorded }]), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");

    // A malformed recorded digest is refused before anything is hashed.
    assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: "nope" }]), (error: unknown) =>
      error instanceof StoreError && /not a SHA-256/.test(error.message));
    assert.deepEqual(verifiedPaths([{ path: "/a.js", sha256: recorded }, { path: "/b.js", sha256: recorded }]), ["/a.js", "/b.js"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the digest recorded at configuration load survives to the spawn boundary", () => {
  const root = scratch("oma-integrity-flow-");
  try {
    const index = bundle(root);
    const recorded = readConfigurationSource(index).roles["principal"]!.extensions;
    assert.ok(recorded.length > 0, "the loader records at least the core extension");
    for (const extension of recorded) assert.match(extension.sha256, /^[0-9a-f]{64}$/);

    // The pairs the entrypoint forwards must keep both fields, not just the path.
    const forwarded = recorded.map(extension => ({ path: extension.path, sha256: extension.sha256 }));
    assertExtensionIntegrity(forwarded);

    // The spawn paths are exactly the recorded ones, in the recorded order.
    assert.deepEqual(verifiedPaths(forwarded), recorded.map(extension => extension.path));

    // Tampering with the installed file after load refuses the start.
    writeFileSync(forwarded[0]!.path, "export const tampered = 1;\n");
    assert.throws(() => assertExtensionIntegrity(forwarded), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the spawn paths never pass the core extension twice", () => {
  const paths = { piCommand: "/usr/bin/pi", coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" };
  const argv = sessionArgv(paths, {
    society: "demo", provider: "pi", model: "current",
    extensions: [{ path: "/lib/core.js", sha256: "0".repeat(64) }, { path: "/lib/review.js", sha256: "1".repeat(64) }],
  });
  assert.equal(argv.filter(entry => entry === "/lib/core.js").length, 1);
  assert.ok(argv.includes("/lib/review.js"));
});

test("the Principal and Resident spawn seams carry the same role contract", () => {
  const root = scratch("oma-seam-");
  try {
    const index = bundle(root);
    const role = readConfigurationSource(index).roles["principal"]!;

    // Whatever the Resident path forwards, the Principal path must forward too:
    // extensions with digests, the projection, and the role prompt.
    const argv = sessionArgv(
      { piCommand: "/usr/bin/node", piArgs: ["/lib/cli.js"], coreExtension: "/lib/core.js",
        sessionDir: "/s", workspace: "/w", home: "/h", piAgentDir: "/state/pi" },
      {
        society: "demo", provider: "pi", model: "current",
        extensions: role.extensions.map(e => ({ path: e.path, sha256: e.sha256 })),
        prompt: "role prompt",
        toolSurface: encodeToolSurfacePlan(role.toolSurface!),
      },
    );
    assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], "role prompt",
      "the Principal must run with its role prompt, as a Resident does");

    const env = sessionEnv({ HOME: "/h" }, {
      society: "demo", provider: "pi", model: "current", extensions: [],
      toolSurface: encodeToolSurfacePlan(role.toolSurface!),
    }, { piAgentDir: "/state/pi" });
    assert.ok(env.OMA_TOOL_SURFACE, "the projection reaches the engine");
    assert.equal(env.PI_CODING_AGENT_DIR, "/state/pi", "the engine stays in OMA's directory");

    // A role without a prompt must not push an empty flag.
    const bare = sessionArgv(
      { piCommand: "/usr/bin/node", piArgs: [], coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" },
      { society: "demo", provider: "pi", model: "current", extensions: [] },
    );
    assert.ok(!bare.includes("--append-system-prompt"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
