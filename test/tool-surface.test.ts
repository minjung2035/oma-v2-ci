import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { readConfigurationSource } from "@oma/config/operations";
import { guardWorkspaceTools } from "@oma/tool-runtime/workspace-guard";
import {
  SURFACE_LIMITS, encodeToolSurfacePlan, planToolSurface,
  type GroupSpec, type ToolSurfaceConfig,
} from "@oma/domain/tool-surface";
import { OMA_TOOL_NAMES } from "@oma/extension/mail-tools";
import { expandedActiveTools, initialActiveTools, parseSurfacePlan, registerToolSurface, type SurfaceFence } from "@oma/tool-runtime/tool-surface";

const invalid = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST";

function config(overrides: Partial<ToolSurfaceConfig> = {}): ToolSurfaceConfig {
  return { defaultMode: "DISABLED", direct: [], disabled: [], groups: [], roots: [], ...overrides };
}
function group(name: string, members: GroupSpec["members"]): GroupSpec {
  return { name, description: `${name} group`, members };
}

test("T99/TSP-001: a valid nested projection flattens to immediate children and derived roots", () => {
  const plan = planToolSurface(config({
    direct: ["read"],
    disabled: ["danger"],
    groups: [
      group("web", [{ tool: "fetch" }, { group: "browser" }]),
      group("browser", [{ tool: "click" }, { tool: "screenshot" }]),
    ],
  }));
  assert.deepEqual(plan.roots, ["web"], "a group nothing nests is the entry point");
  assert.deepEqual(plan.groups.find(entry => entry.name === "web")!.children, ["fetch", "browser"]);
  assert.deepEqual(plan.groups.find(entry => entry.name === "browser")!.children, ["click", "screenshot"]);
  assert.deepEqual([...plan.grouped].sort(), ["click", "fetch", "screenshot"]);
  assert.deepEqual(plan.direct, ["read"]);
  assert.deepEqual(plan.disabled, ["danger"]);
});

test("T99/TSP-001: explicit roots are honoured and an unknown root is refused", () => {
  const plan = planToolSurface(config({
    groups: [group("a", [{ group: "b" }]), group("b", [{ tool: "t" }])],
    roots: ["a", "b"],
  }));
  assert.deepEqual(plan.roots, ["a", "b"]);
  assert.throws(() => planToolSurface(config({
    groups: [group("a", [{ tool: "t" }])], roots: ["nope"],
  })), invalid);
});

test("T99/TSP-001: every cycle shape is refused at config time, not inside the sandbox", () => {
  assert.throws(() => planToolSurface(config({ groups: [group("a", [{ group: "a" }])] })), invalid);
  assert.throws(() => planToolSurface(config({
    groups: [group("a", [{ group: "b" }]), group("b", [{ group: "a" }])],
  })), invalid);
  assert.throws(() => planToolSurface(config({
    groups: [group("a", [{ group: "b" }]), group("b", [{ group: "c" }]), group("c", [{ group: "a" }])],
  })), invalid);
});

test("T99/TSP-001: conflicting or dangling references are refused", () => {
  const cases: Array<[string, ToolSurfaceConfig]> = [
    ["unknown subgroup", config({ groups: [group("a", [{ group: "ghost" }])] })],
    ["duplicate group", config({ groups: [group("a", [{ tool: "x" }]), group("a", [{ tool: "y" }])] })],
    ["tool claimed twice", config({ groups: [group("a", [{ tool: "x" }]), group("b", [{ tool: "x" }])] })],
    ["disabled member", config({ disabled: ["x"], groups: [group("a", [{ tool: "x" }])] })],
    ["direct and grouped", config({ direct: ["x"], groups: [group("a", [{ tool: "x" }])] })],
    ["direct and disabled", config({ direct: ["x"], disabled: ["x"] })],
    ["group name used as tool", config({ direct: ["a"], groups: [group("a", [{ tool: "x" }])] })],
    ["duplicate member", config({ groups: [group("a", [{ tool: "x" }, { tool: "x" }])] })],
    ["bad name", config({ direct: ["Not A Name"] })],
  ];
  for (const [label, candidate] of cases)
    assert.throws(() => planToolSurface(candidate), invalid, `${label} must be refused`);
});

test("T99/TSP-001: the projection stays bounded", () => {
  const many = Array.from({ length: SURFACE_LIMITS.groups + 1 }, (_value, index) =>
    group(`g${index}`, [{ tool: `t${index}` }]));
  assert.throws(() => planToolSurface(config({ groups: many })), invalid);
  const wide = group("g", Array.from({ length: SURFACE_LIMITS.membersPerGroup + 1 },
    (_value, index) => ({ tool: `t${index}` })));
  assert.throws(() => planToolSurface(config({ groups: [wide] })), invalid);
  const chain = Array.from({ length: SURFACE_LIMITS.depth + 2 }, (_value, index) =>
    group(`g${index}`, index === SURFACE_LIMITS.depth + 1 ? [{ tool: "leaf" }] : [{ group: `g${index + 1}` }]));
  assert.throws(() => planToolSurface(config({ groups: chain })), invalid);
});

test("T101/TSP-005: DIRECT default shows unmentioned tools and hides grouped and disabled ones", () => {
  const plan = planToolSurface(config({
    defaultMode: "DIRECT",
    disabled: ["danger"],
    groups: [group("web", [{ tool: "fetch" }])],
  }));
  const active = initialActiveTools(plan, ["read", "danger", "fetch", "web", ...OMA_TOOL_NAMES], OMA_TOOL_NAMES);
  assert.ok(active.includes("read"), "an unmentioned tool follows defaultMode");
  assert.ok(active.includes("web"), "a root group is the entry point");
  assert.ok(!active.includes("danger"), "a disabled tool is never active");
  assert.ok(!active.includes("fetch"), "a grouped tool waits for its group");
  for (const owned of OMA_TOOL_NAMES) assert.ok(active.includes(owned), `${owned} must stay available`);
});

test("T101/TSP-005: DISABLED default hides everything the projection does not name", () => {
  const plan = planToolSurface(config({
    defaultMode: "DISABLED",
    direct: ["read"],
    groups: [group("web", [{ tool: "fetch" }])],
  }));
  const active = initialActiveTools(plan, ["read", "other", "fetch", "web", ...OMA_TOOL_NAMES], OMA_TOOL_NAMES);
  assert.deepEqual(active, [...OMA_TOOL_NAMES, "read", "web"].sort());
});

test("T101/TSP-008: a projection cannot strand the agent without OMA's own tools", () => {
  const plan = planToolSurface(config({ defaultMode: "DISABLED", disabled: [...OMA_TOOL_NAMES] }));
  const active = initialActiveTools(plan, [...OMA_TOOL_NAMES, "x"], OMA_TOOL_NAMES);
  for (const owned of OMA_TOOL_NAMES) assert.ok(active.includes(owned));
});

test("T102/TSP-006: opening a group is additive and idempotent", () => {
  const first = expandedActiveTools(["read", "web"], ["fetch", "browser"]);
  assert.deepEqual(first.revealed, ["fetch", "browser"]);
  assert.deepEqual(first.next, ["browser", "fetch", "read", "web"]);
  const again = expandedActiveTools(first.next, ["fetch", "browser"]);
  assert.deepEqual(again.revealed, []);
  assert.deepEqual(again.next, first.next);
  // Tools another extension activated are never removed.
  const foreign = expandedActiveTools(["someone-elses-tool"], ["fetch"]);
  assert.ok(foreign.next.includes("someone-elses-tool"));
});

test("T103/TSP-007: an unreadable projection fails closed rather than exposing hidden tools", () => {
  assert.equal(parseSurfacePlan(undefined).state, "absent");
  assert.equal(parseSurfacePlan("   ").state, "absent");
  for (const raw of ["{", "[]", "null", '{"version":2}', '{"version":1,"defaultMode":"MAYBE"}',
    '{"version":1,"defaultMode":"DIRECT","direct":[1],"disabled":[],"grouped":[],"groups":[],"roots":[]}',
    '{"version":1,"defaultMode":"DIRECT","direct":[],"disabled":[],"grouped":[],"groups":[{"name":"g"}],"roots":[]}'])
    assert.equal(parseSurfacePlan(raw).state, "malformed", `${raw} must be malformed`);
  const plan = planToolSurface(config({ defaultMode: "DIRECT", groups: [group("web", [{ tool: "fetch" }])] }));
  const parsed = parseSurfacePlan(encodeToolSurfacePlan(plan));
  assert.equal(parsed.state, "plan");
});

test("T100/TSP-002: the plan round-trips through its transport encoding unchanged", () => {
  // The claim is the whole plan, so it is checked as the whole plan. This test
  // used to name three of the seven fields, which is a weaker predicate than
  // its own title: `direct`, `disabled`, `grouped` and the group names could
  // have been dropped in transit and nothing here would have said so.
  const plan = planToolSurface(config({
    defaultMode: "DIRECT", direct: ["read"], disabled: ["danger"],
    groups: [group("web", [{ tool: "fetch" }, { group: "browser" }]), group("browser", [{ tool: "click" }])],
  }));
  for (const [field, value] of Object.entries(plan))
    assert.ok(Array.isArray(value) ? value.length > 0 : value !== undefined,
      `${field} is empty here, so this plan cannot witness that it survives`);

  const encoded = encodeToolSurfacePlan(plan);
  assert.deepEqual(Object.keys(JSON.parse(encoded)).sort(), Object.keys(plan).sort(),
    "the transport carries exactly the fields the plan has");
  const parsed = parseSurfacePlan(encoded);
  assert.equal(parsed.state, "plan");
  if (parsed.state !== "plan") return;
  const { version, ...carried } = plan;
  assert.equal(version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.plan)), JSON.parse(JSON.stringify(carried)),
    "a field of the plan did not survive the transport");
  assert.equal(encodeToolSurfacePlan(plan), encoded, "encoding is stable");

  // The far end must validate every field the near end writes. A field the
  // decoder accepts as missing is a field the sandbox would run without, and
  // the encoder is free to stop sending it without anything noticing.
  for (const field of Object.keys(JSON.parse(encoded) as Record<string, unknown>)) {
    const partial = JSON.parse(encoded) as Record<string, unknown>;
    delete partial[field];
    assert.equal(parseSurfacePlan(JSON.stringify(partial)).state, "malformed",
      `a projection missing ${field} was accepted`);
  }
  for (const field of ["name", "description", "children"]) {
    const partial = JSON.parse(encoded) as { groups: Record<string, unknown>[] };
    delete partial.groups[0]![field];
    assert.equal(parseSurfacePlan(JSON.stringify(partial)).state, "malformed",
      `a group missing ${field} was accepted`);
  }
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

/** The real `fatal` ends the engine process; the harness records it and throws
 * instead, so the refusal's message and its session-stopping effect are both
 * observable. Every startup failure takes this path -- the execution fence
 * (tool_call) then covers the calls already possible before the exit lands. */
function projectionHost(plan: ToolSurfaceConfig | string, refuseApply = false, fence?: SurfaceFence) {
  const registry = new Map<string, { name: string; parameters: object; execute?: () => Promise<unknown> }>(
    ["read", "fetch", "danger", "oma_mail_read"].map(name => [name, { name, parameters: {} }]));
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const exits: string[] = [];
  let active = [...registry.keys()];
  const previous = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = typeof plan === "string" ? plan : encodeToolSurfacePlan(planToolSurface(plan));
  try {
    registerToolSurface({
      on(event: string, handler: (...args: any[]) => unknown) { handlers.set(event, handler); },
      registerTool(tool: { name: string; parameters: object }) { registry.set(tool.name, tool); },
      getAllTools: () => [...registry.values()], getActiveTools: () => active,
      setActiveTools(names: string[]) { if (refuseApply) throw new Error("injected apply failure"); active = names.filter(name => registry.has(name)); },
    } as never, ["oma_mail_read"], { fatal: message => { exits.push(message); throw new Error(message); }, ...fence });
  } finally {
    if (previous === undefined) delete process.env.OMA_TOOL_SURFACE; else process.env.OMA_TOOL_SURFACE = previous;
  }
  return { registry, active: () => active, start: () => handlers.get("session_start")!(),
    exited: () => exits,
    block: (name: string) => handlers.get("tool_call")!({ toolName: name }) as { block: boolean; reason: string } | undefined };
}

test("DR27 / TSP-001,007: colliding groups never overwrite built-in or OMA tools, and the session stops", () => {
  for (const name of ["read", "oma_mail_read"]) {
    const host = projectionHost(config({ groups: [group(name, [{ tool: "fetch" }])] }));
    const original = host.registry.get(name);
    assert.throws(() => host.start(), /conflicts with a registered tool/);
    // The session does not continue past a refused surface: the process is
    // told to end (recorded here; the real default exits), and the execution
    // fence stays closed until it does.
    assert.match(host.exited().at(-1) ?? "", /conflicts with a registered tool/);
    assert.equal(host.registry.get(name), original);
    assert.deepEqual(host.active(), ["oma_mail_read"]);
    assert.equal(host.block("read")?.block, true);
    assert.equal(host.block("oma_mail_read"), undefined);
  }
});

test("DR27 / TSP-007 / #5: unknown selectors refuse the projection and stop the session", () => {
  for (const plan of [config({ direct: ["missing"] }), config({ disabled: ["missing"] }),
    config({ groups: [group("web", [{ tool: "missing" }])] })]) {
    const host = projectionHost(plan);
    assert.throws(() => host.start(), /references unknown tool/);
    assert.match(host.exited().at(-1) ?? "", /references unknown tool "missing"/);
    assert.equal(host.registry.has("web"), false);
    assert.equal(host.block("danger")?.block, true);
    assert.equal(host.block("oma_mail_read"), undefined);
  }
});

test("DR27 / TSP-007: a refused surface ends the engine even when the fallback apply also fails", () => {
  const malformed = projectionHost("{", true);
  assert.throws(() => malformed.start(), /malformed/);
  assert.match(malformed.exited().at(-1) ?? "", /malformed/);
  assert.equal(malformed.block("danger")?.block, true);
  assert.equal(malformed.block("oma_mail_read"), undefined);

  const host = projectionHost(config({ groups: [group("web", [{ tool: "fetch" }])] }), true);
  assert.throws(() => host.start(), /could not be applied/);
  assert.match(host.exited().at(-1) ?? "", /could not be applied/);
  assert.ok(host.active().includes("danger"), "negative control: the engine retained this tool");
  assert.equal(host.block("danger")?.block, true);
  assert.equal(host.block("oma_mail_read"), undefined);
});

test("DR27 / TSP-006: group registration waits for the full registry and remains additive across session starts", async () => {
  const host = projectionHost(config({ groups: [group("web", [{ tool: "fetch" }])] }));
  assert.equal(host.registry.has("web"), false);
  host.start(); assert.deepEqual(host.active(), ["oma_mail_read", "web"]);
  assert.equal(host.block("web"), undefined);
  const facade = host.registry.get("web"); assert.ok(facade?.execute);
  await facade.execute(); assert.deepEqual(host.active(), ["fetch", "oma_mail_read", "web"]);
  await facade.execute(); assert.deepEqual(host.active(), ["fetch", "oma_mail_read", "web"]);
  host.start(); assert.equal(host.registry.get("web"), facade);
  assert.deepEqual(host.active(), ["oma_mail_read", "web"]);
  host.registry.set("web", { name: "web", parameters: {} });
  assert.throws(() => host.start(), /conflicts/);
  assert.equal(host.block("web")?.block, true);
});

test("DR27: a Principal projection cannot activate routine tools directly or through a group", async () => {
  const allowed = new Set(["read", "oma_mail_read", "files"]);
  const permitted = (name: string): boolean => allowed.has(name);
  const host = projectionHost(config({ defaultMode: "DIRECT", direct: ["danger"],
    groups: [group("files", [{ tool: "read" }, { tool: "fetch" }])] }), false, { permitted });
  let guard!: (event: { toolName: string; input: object }) => { block: boolean } | undefined;
  guardWorkspaceTools({ on: (_name: string, hook: typeof guard) => { guard = hook; } } as never,
    "/tmp", false, true, permitted);
  host.start();
  assert.deepEqual(host.active(), ["files", "oma_mail_read"]);
  await host.registry.get("files")!.execute!();
  assert.deepEqual(host.active(), ["files", "oma_mail_read", "read"]);
  assert.equal(guard({ toolName: "fetch", input: {} })?.block, true);
  assert.equal(guard({ toolName: "danger", input: {} })?.block, true);
  assert.equal(guard({ toolName: "read", input: { path: "." } }), undefined);
  assert.equal(guard({ toolName: "write", input: { path: "." } })?.block, true);
  assert.equal(guard({ toolName: "extension_alias", input: {} })?.block, true);
});
