import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { readConfigurationSource } from "@oma/config/operations";
import { SURFACE_LIMITS, encodeToolSurfacePlan, planToolSurface, type ToolSurfaceConfig } from "@oma/domain/tool-surface";
import { parseSurfacePlan, registerToolSurface, type SurfaceFence } from "@oma/tool-runtime/tool-surface";

const invalid = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST";

function config(overrides: Partial<ToolSurfaceConfig> = {}): ToolSurfaceConfig {
  return { defaultMode: "DISABLED", direct: ["read", "oma_mail_read"], optional: ["fetch", "diagnostics"], disabled: [], ...overrides };
}

test("surface plans reject ambiguous admission before touching the registry", () => {
  for (const candidate of [
    config({ optional: ["read"] }), config({ direct: ["read", "read"] }),
    config({ disabled: ["fetch"] }), config({ optional: ["toolset"] }),
    config({ optional: ["Not A Name"] }),
    config({ optional: Array.from({ length: SURFACE_LIMITS.names + 1 }, (_, index) => `tool${index}`) }),
  ]) assert.throws(() => planToolSurface(candidate), invalid);
  for (const raw of [" ", "{", "null", "[]", '{"version":1}', JSON.stringify({ ...config(), version: 2, groups: [] }),
    JSON.stringify({ ...config(), version: 2, defaultMode: "DIRECT" })])
    assert.equal(parseSurfacePlan(raw).state, "malformed");
  assert.equal(parseSurfacePlan(undefined).state, "absent");
});


test("D23: a role file cannot declare a projection -- the field fails the load, whatever it holds", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-surface-cfg-"));
  try {
    const libdir = join(dir, "lib");
    mkdirSync(dirname(join(libdir, DEPLOYMENT_LAYOUT.extension)), { recursive: true });
    writeFileSync(join(libdir, DEPLOYMENT_LAYOUT.extension), "export {};\n");
    writeFileSync(join(dir, "host.json"), JSON.stringify({ installation: { libdir } }));
    writeFileSync(join(dir, "models.json"), JSON.stringify({}));
    writeFileSync(join(dir, "prompt.md"), "");
    const writeRole = (extra: Record<string, unknown>): void => {
      writeFileSync(join(dir, "resident.json"), JSON.stringify({
        agentProfile: { modelProfile: "m" },
        extensions: [DEPLOYMENT_LAYOUT.extension],
        promptFile: "prompt.md",
        ...extra,
      }));
    };
    writeFileSync(join(dir, "index.json"), JSON.stringify({
      kind: "oma-operations-v1", host: "host.json", models: "models.json",
      roles: { resident: "resident.json" },
    }));

    // A plain role file loads, with no projection anywhere in the result.
    writeRole({});
    const loaded = readConfigurationSource(join(dir, "index.json")).roles["resident"]!;
    assert.ok(loaded && !Object.hasOwn(loaded, "toolSurface"), "loaded settings carry no surface");

    // Even a once-valid block is rejected: the surface is internal policy, not
    // configuration, so no spelling of it may take effect through a role file.
    for (const surface of [
      { defaultMode: "DISABLED", direct: ["read"],
        groups: [{ name: "web", description: "web tools", members: [{ tool: "fetch" }] }] },
      { surprise: true },
      null,
    ]) {
      writeRole({ toolSurface: surface });
      assert.throws(() => readConfigurationSource(join(dir, "index.json")), invalid,
        `toolSurface ${JSON.stringify(surface)} must fail the load`);
    }

    // Unknown fields stay closed around it too.
    writeRole({ nope: 1 });
    assert.throws(() => readConfigurationSource(join(dir, "index.json")), invalid);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

interface TestTool {
  name: string;
  description?: string;
  parameters: object;
  sourceInfo?: { source: string; path?: string };
  execute?: (id: string, args: unknown) => Promise<{ details: Record<string, unknown> }>;
}
/** Model-facing declarations and persisted boundary entries are separate, just
 * as in Pi: tool results alone cannot restore an uncommitted selection. */
function projectionHost(plan: ToolSurfaceConfig | string = config(), fence?: SurfaceFence) {
  const registry = new Map<string, TestTool>(["read", "fetch", "diagnostics", "danger", "oma_mail_read"].map(name =>
    [name, { name, description: `${name} performs work. More guidance.`, parameters: {},
      sourceInfo: { source: "builtin" } }]));
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let active = [...registry.keys()], branch: unknown[] = [], refuseApply = false;
  const previous = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = typeof plan === "string" ? plan : encodeToolSurfacePlan(planToolSurface(plan));
  try {
    registerToolSurface({
      on(event: string, handler: (...args: unknown[]) => unknown) { handlers.set(event, handler); },
      registerTool(tool: TestTool) { registry.set(tool.name, tool); },
      getAllTools: () => [...registry.values()], getActiveTools: () => active,
      setActiveTools(names: string[]) {
        if (refuseApply) throw new Error("injected apply failure");
        active = names.filter(name => registry.has(name));
      },
    } as never, ["oma_mail_read"], { fatal: message => { throw new Error(message); }, ...fence });
  } finally {
    if (previous === undefined) delete process.env.OMA_TOOL_SURFACE; else process.env.OMA_TOOL_SURFACE = previous;
  }
  const context = { sessionManager: { getBranch: () => branch } };
  const emit = (event: string, data: object = {}) =>
    handlers.get(event)?.(data, context) as { block?: boolean; entries?: unknown[] } | undefined;
  return {
    registry, active: () => active, emit, branch: () => [...branch],
    start(entries: unknown[] = branch) { branch = [...entries]; emit("session_start"); },
    block: (name: string) => emit("tool_call", { toolName: name }),
    refuseApply() { refuseApply = true; },
    async select(select: unknown, id = "select") {
      return registry.get("toolset")!.execute!(id, { select });
    },
    finish(results: { id: string; isError?: boolean }[]) {
      const toolResults = results.map(result => ({ role: "toolResult", toolName: "toolset",
        toolCallId: result.id, isError: result.isError ?? false }));
      branch.push(...toolResults.map(message => ({ type: "message", message })));
      const result = emit("turn_end", { entries: [], toolResults, toolResultEntryIds: results.map(result => result.id) });
      branch.push(...(result?.entries ?? []));
    },
  };
}

test("selection replaces optional tools at persisted turn end and never changes its own batch", async () => {
  const host = projectionHost(); host.start();
  const core = host.active();
  assert.equal(host.block("danger")?.block, true);
  assert.equal(host.block("fetch")?.block, true);
  const result = await host.select(["fetch"]);
  assert.deepEqual(host.active(), core);
  assert.equal(result.details.nextActiveCount, core.length + 1);
  host.finish([{ id: "select" }]);
  assert.ok(host.active().includes("fetch"));
  await host.select(["diagnostics"], "next");
  assert.equal(host.block("fetch"), undefined, "the previous batch loadout remains callable");
  host.finish([{ id: "next" }]);
  assert.deepEqual(host.active(), [...core, "diagnostics"].sort());
  await host.select([], "clear"); host.finish([{ id: "clear" }]);
  assert.deepEqual(host.active(), core);
});

test("bad shapes and names cannot replace a valid pending selection", async () => {
  const host = projectionHost(); host.start();
  await host.select(["fetch"], "good");
  for (const select of [null, "fetch", [1], ["fetch", "fetch"], ["read"], ["missing"], ["oma_society"]])
    await assert.rejects(host.select(select, "bad"));
  await assert.rejects(host.registry.get("toolset")!.execute!("bad", { select: [], request: "not-a-mutation" }));
  host.finish([{ id: "good" }]);
  assert.ok(host.active().includes("fetch"));
});

test("the last successful persisted selection wins, while pending and failed calls do not restore", async () => {
  const host = projectionHost(); host.start();
  await host.select(["fetch"], "first");
  await host.select(["diagnostics"], "second");
  host.finish([{ id: "first" }, { id: "second" }]);
  const committed = host.branch();
  await host.select([], "interrupted");
  host.start([...committed, { type: "message", message: { role: "toolResult", toolName: "toolset",
    isError: false, details: { select: [] } } }]);
  assert.ok(host.active().includes("diagnostics"));
  await host.select(["fetch"], "failed"); host.finish([{ id: "failed", isError: true }]);
  host.start();
  assert.ok(host.active().includes("diagnostics"));
  host.start([]);
  assert.equal(host.active().includes("diagnostics"), false, "a different branch has its own committed loadout");
  host.start(committed);
  assert.ok(host.active().includes("diagnostics"), "fork/resume restores the committed branch");
});

test("unpersisted results cannot become a committed snapshot", async () => {
  const host = projectionHost(); host.start(); await host.select(["fetch"]);
  assert.throws(() => host.emit("turn_end", { entries: [], toolResults: [{ toolCallId: "select",
    toolName: "toolset", isError: false }], toolResultEntryIds: [] }), /persisted/);
  assert.equal(host.block("read")?.block, true);
});

test("malformed, impossible and shadowed surfaces fail closed for all calls", () => {
  for (const plan of ["{", " ", config({ direct: ["missing"] }), config({ optional: ["missing"] })]) {
    const host = projectionHost(plan);
    assert.throws(() => host.start());
    assert.deepEqual(host.active(), []);
    assert.equal(host.block("oma_mail_read")?.block, true);
  }
  const host = projectionHost();
  host.registry.set("toolset", { name: "toolset", parameters: {} });
  assert.throws(() => host.start(), /conflicts/);
  const failedApply = projectionHost(); failedApply.refuseApply();
  assert.throws(() => failedApply.start(), /apply failure/);
  assert.equal(failedApply.block("oma_mail_read")?.block, true);
});

test("late admitted registrations enter the catalog only at a safe boundary; shadows close the surface", async () => {
  let shadowed = false;
  const host = projectionHost(config(), {
    permitted: name => name !== "unverified",
    own: name => name === "toolset" || (name === "oma_mail_read" && !shadowed),
  });
  host.start();
  host.registry.set("late", { name: "late", description: "A verified extra tool.", parameters: {},
    sourceInfo: { source: "extension", path: "/verified.js" } });
  host.registry.set("unverified", { name: "unverified", description: "Not admitted.", parameters: {},
    sourceInfo: { source: "extension", path: "/unknown.js" } });
  assert.equal(host.block("late")?.block, true);
  await assert.rejects(host.select(["late"]));
  host.finish([]);
  await host.select(["late"]); host.finish([{ id: "select" }]);
  assert.equal(host.block("late"), undefined);
  await assert.rejects(host.select(["unverified"]));
  shadowed = true;
  assert.equal(host.block("oma_mail_read")?.block, true);
  assert.throws(() => host.emit("before_provider_request"), /shadowed/);
});

test("a selected definition cannot disappear or change after the safe boundary", async () => {
  for (const change of ["remove", "replace"] as const) {
    const host = projectionHost(); host.start();
    await host.select(["fetch"]); host.finish([{ id: "select" }]);
    if (change === "remove") host.registry.delete("fetch");
    else host.registry.set("fetch", { name: "fetch", description: "Changed implementation metadata.", parameters: {} });
    assert.throws(() => host.emit("before_provider_request"), /changed outside/);
    assert.equal(host.block("read")?.block, true);
  }
});

test("a corrupt or no-longer-admitted committed selection stops restoration", () => {
  for (const data of [{ version: 1, select: ["missing"] }, { version: 1, select: ["fetch", "fetch"] },
    { version: 1, select: null }, { version: 2, select: [] }]) {
    const host = projectionHost();
    assert.throws(() => host.start([{ type: "custom", customType: "oma-toolset", data }]));
    assert.deepEqual(host.active(), []);
  }
});
