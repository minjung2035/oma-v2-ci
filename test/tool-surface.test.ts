import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { readConfigurationSource } from "@oma/config/operations";
import { collaborationSurface, decodeCollaborationSurface, type CollaborationSurfacePlan } from "@oma/domain/collaboration-surface";
import { parseSurfacePlan, registerToolSurface, type SurfaceFence } from "@oma/tool-runtime/tool-surface";

const invalid = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST";

test("001. Current surface plans reject ambiguous or arbitrary catalogs before touching the registry", () => {
  const plan = collaborationSurface("resident");
  for (const candidate of [
    { ...plan, direct: ["UPPER"] },
    { ...plan, direct: [...plan.direct, plan.direct[0]] }, { ...plan, direct: [...plan.direct, "missing"] },
    { ...plan, groups: { ...plan.groups, web_tools: ["web_search"] } }, { ...plan, optional: ["ls"] },
  ]) assert.throws(() => decodeCollaborationSurface(candidate), invalid);
  // The adversarial name vectors belong to this decoder contract as well.
  for (const name of ["a".repeat(200), "UPPER", "9leading", "has space", "has/slash", "toolset", "oma_mail_send"])
    for (const candidate of [{ ...plan, direct: [...plan.direct, name] },
      { ...plan, groups: { ...plan.groups, web_tools: [...plan.groups.web_tools, name] } }])
      assert.throws(() => decodeCollaborationSurface(candidate), invalid);
  assert.deepEqual(decodeCollaborationSurface(JSON.parse(JSON.stringify(plan))), plan);
  for (const raw of [" ", "{", "null", "[]", '{"version":1}', '{"version":2}',
    JSON.stringify({ ...plan, direct: ["9leading"] })]) assert.equal(parseSurfacePlan(raw).state, "malformed");
  assert.equal(parseSurfacePlan(undefined).state, "absent");
});


test("002. A role file cannot declare a projection -- the field fails the load, whatever it holds", () => {
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
/** Pi persists tool results separately from exposure entries. This fixture
 * exercises that protocol, not SDK/provider/kernel qualification. */
function projectionHost(plan: CollaborationSurfacePlan | string = collaborationSurface("resident"), fence?: SurfaceFence) {
  const current = collaborationSurface("resident");
  const names = [...current.direct, ...Object.values(current.groups).flat()];
  const registry = new Map<string, TestTool>(names.map(name => [name, { name, description: `${name} performs work.`, parameters: {},
    sourceInfo: { source: "builtin" } }]));
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let active = [...registry.keys()], branch: unknown[] = [], refuseApply = false;
  const previous = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = typeof plan === "string" ? plan : JSON.stringify(plan);
  try {
    registerToolSurface({
      on(event: string, handler: (...args: unknown[]) => unknown) { handlers.set(event, handler); },
      registerTool(tool: TestTool) { registry.set(tool.name, tool); },
      getAllTools: () => [...registry.values()], getActiveTools: () => active,
      setActiveTools(names: string[]) {
        if (refuseApply) throw new Error("injected apply failure");
        active = names.filter(name => registry.has(name));
      },
    } as never, current.direct.filter(name => name.startsWith("oma_")), { role: "resident", fatal: message => { throw new Error(message); }, ...fence });
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
    async expose(group: "web_tools" | "lsp_tools", id: string = group, args: unknown = {}) {
      return registry.get(group)!.execute!(id, args);
    },
    finish(results: { id: string; group: "web_tools" | "lsp_tools"; isError?: boolean }[]) {
      const toolResults = results.map(result => ({ role: "toolResult", toolName: result.group,
        toolCallId: result.id, isError: result.isError ?? false }));
      branch.push(...toolResults.map(message => ({ id: `result-${message.toolCallId}`, type: "message", message })));
      const result = emit("turn_end", { entries: [], toolResults, toolResultEntryIds: results.map(result => `result-${result.id}`) });
      branch.push(...(result?.entries ?? []));
    },
  };
}

test("003. Complete groups accumulate only after persisted turn end and never change their own batch", async () => {
  const host = projectionHost(); host.start(); const core = host.active();
  assert.equal(host.block("toolset")?.block, true); assert.equal(host.registry.has("toolset"), false);
  assert.equal(host.block("web_search")?.block, true);
  const result = await host.expose("web_tools"); assert.deepEqual(host.active(), core);
  assert.equal(result.details.effective, "next-model-call-after-result-persistence");
  host.finish([{ id: "web_tools", group: "web_tools" }]);
  assert.equal(host.block("web_search"), undefined);
  await host.expose("lsp_tools"); assert.equal(host.block("lsp_status")?.block, true);
  host.finish([{ id: "lsp_tools", group: "lsp_tools" }]);
  assert.equal(host.block("lsp_status"), undefined); assert.equal(host.block("web_search"), undefined);
  const both = host.active(); await host.expose("web_tools", "repeat"); host.finish([{ id: "repeat", group: "web_tools" }]);
  assert.deepEqual(host.active(), both, "repeat is idempotent; no exact-set reset survives");
});

test("004. Bad shapes cannot replace a valid pending group exposure", async () => {
  const host = projectionHost(); host.start(); await host.expose("web_tools", "good");
  for (const args of [null, "web_tools", [], { select: [] }, { request: "not-a-mutation" }, { group: "unknown" }])
    await assert.rejects(host.expose("lsp_tools", "bad", args));
  host.finish([{ id: "good", group: "web_tools" }]); assert.equal(host.block("web_search"), undefined);
  assert.equal(host.block("lsp_status")?.block, true);
});

test("005. Only successful persisted group results restore; interrupted/failed calls and different branches remain separate", async () => {
  const host = projectionHost(); host.start(); await host.expose("web_tools", "first");
  host.finish([{ id: "first", group: "web_tools" }]); const committed = host.branch();
  await host.expose("lsp_tools", "interrupted"); host.start(committed);
  assert.equal(host.block("lsp_status")?.block, true); assert.equal(host.block("web_search"), undefined);
  await host.expose("lsp_tools", "failed"); host.finish([{ id: "failed", group: "lsp_tools", isError: true }]); host.start();
  assert.equal(host.block("lsp_status")?.block, true);
  host.start([]); assert.equal(host.block("web_search")?.block, true);
  host.start(committed); assert.equal(host.block("web_search"), undefined);
});

test("006. Unpersisted group results cannot become a committed snapshot", async () => {
  const host = projectionHost(); host.start(); await host.expose("web_tools", "pending");
  assert.throws(() => host.emit("turn_end", { entries: [], toolResults: [{ toolCallId: "pending", toolName: "web_tools", isError: false }], toolResultEntryIds: [] }), /persisted/);
  assert.equal(host.block("read")?.block, true);
});

test("007. Malformed, impossible and shadowed current surfaces fail closed", () => {
  for (const plan of ["{", " ", JSON.stringify({ version: 2 }), JSON.stringify({ ...collaborationSurface("resident"), direct: ["missing"] })]) {
    const host = projectionHost(plan); assert.throws(() => host.start()); assert.deepEqual(host.active(), []);
    assert.equal(host.block("oma_send")?.block, true);
  }
  const host = projectionHost(undefined, { own: name => name !== "web_tools" });
  assert.throws(() => host.start(), /shadowed/);
  const failedApply = projectionHost(); failedApply.refuseApply(); assert.throws(() => failedApply.start(), /apply failure/);
  assert.equal(failedApply.block("oma_send")?.block, true);
});

test("008. Late non-catalog registrations stay unavailable; provenance revocation closes the role surface", () => {
  let shadowed = false;
  const host = projectionHost(undefined, { permitted: name => name !== "unverified", own: name => name !== "oma_send" || !shadowed });
  host.start();
  host.registry.set("late", { name: "late", description: "Not in the current role contract", parameters: {}, sourceInfo: { source: "extension", path: "/verified.js" } });
  host.registry.set("unverified", { name: "unverified", parameters: {}, sourceInfo: { source: "extension", path: "/unknown.js" } });
  host.finish([]); assert.equal(host.block("late")?.block, true); assert.equal(host.block("unverified")?.block, true);
  shadowed = true; assert.equal(host.block("oma_send")?.block, true);
  assert.throws(() => host.emit("before_provider_request"), /shadowed/);
});

test("009. An exposed definition cannot disappear or change after a safe boundary", async () => {
  for (const change of ["remove", "replace"] as const) {
    const host = projectionHost(); host.start(); await host.expose("web_tools"); host.finish([{ id: "web_tools", group: "web_tools" }]);
    if (change === "remove") host.registry.delete("web_search");
    else host.registry.set("web_search", { name: "web_search", description: "Changed metadata", parameters: {} });
    assert.throws(() => host.emit("before_provider_request"), /changed outside/); assert.equal(host.block("read")?.block, true);
  }
});

test("010. Corrupt, partial or foreign committed exposure cannot be restored", () => {
  for (const data of [
    { version: 1, surface: "collaboration-v1", role: "resident", active: ["missing"] },
    { version: 1, surface: "collaboration-v1", role: "resident", active: ["web_search"] },
    { version: 1, surface: "collaboration-v1", role: "resident", active: null },
    { version: 1, surface: "collaboration-v1", role: "principal", active: [] },
  ]) {
    const host = projectionHost(); assert.throws(() => host.start([{ type: "custom", customType: "oma-collaboration-exposure", data }]));
    assert.deepEqual(host.active(), []);
  }
});
