import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "../src/domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../src/domain/deployment.js";
import { readConfigurationSource } from "../src/config/operations.js";
import {
  SURFACE_LIMITS, encodeToolSurfacePlan, planToolSurface,
  type GroupSpec, type ToolSurfaceConfig,
} from "../src/domain/tool-surface.js";
import {
  OMA_TOOL_NAMES, expandedActiveTools, initialActiveTools, parseSurfacePlan,
} from "../src/pi-extension.js";

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
  const plan = planToolSurface(config({
    defaultMode: "DIRECT", direct: ["read"], disabled: ["danger"],
    groups: [group("web", [{ tool: "fetch" }, { group: "browser" }]), group("browser", [{ tool: "click" }])],
  }));
  const parsed = parseSurfacePlan(encodeToolSurfacePlan(plan));
  assert.equal(parsed.state, "plan");
  if (parsed.state !== "plan") return;
  assert.equal(parsed.plan.defaultMode, plan.defaultMode);
  assert.deepEqual(parsed.plan.roots, plan.roots);
  assert.deepEqual(parsed.plan.groups.map(entry => entry.children), plan.groups.map(entry => entry.children));
  assert.equal(encodeToolSurfacePlan(plan), encodeToolSurfacePlan(plan), "encoding is stable");
});

test("T100/TSP-002: a role file may declare a projection, and a bad one fails at config load", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-surface-cfg-"));
  try {
    const libdir = join(dir, "lib");
    mkdirSync(join(libdir, "dist", "src"), { recursive: true });
    writeFileSync(join(libdir, DEPLOYMENT_LAYOUT.extension), "export {};\n");
    writeFileSync(join(dir, "host.json"), JSON.stringify({ installation: { libdir } }));
    writeFileSync(join(dir, "models.json"), JSON.stringify({}));
    writeFileSync(join(dir, "prompt.md"), "");
    const writeRole = (surface: unknown): void => {
      writeFileSync(join(dir, "resident.json"), JSON.stringify({
        agentProfile: { modelProfile: "m" },
        extensions: [DEPLOYMENT_LAYOUT.extension],
        promptFile: "prompt.md",
        ...(surface === undefined ? {} : { toolSurface: surface }),
      }));
    };
    writeFileSync(join(dir, "index.json"), JSON.stringify({
      kind: "oma-operations-v1", host: "host.json", models: "models.json",
      roles: { resident: "resident.json" },
    }));

    // Absent block: the role shows every registered tool.
    writeRole(undefined);
    assert.equal(readConfigurationSource(join(dir, "index.json")).roles["resident"]!.toolSurface, null);

    writeRole({
      defaultMode: "DISABLED",
      direct: ["read"],
      groups: [{ name: "web", description: "web tools", members: [{ tool: "fetch" }] }],
    });
    const loaded = readConfigurationSource(join(dir, "index.json")).roles["resident"]!.toolSurface;
    assert.ok(loaded, "the declared projection is validated and kept");
    assert.deepEqual(loaded.roots, ["web"]);
    assert.deepEqual(loaded.direct, ["read"]);

    // A cycle is rejected when the configuration loads, not when Pi starts.
    writeRole({
      groups: [
        { name: "a", description: "a", members: [{ group: "b" }] },
        { name: "b", description: "b", members: [{ group: "a" }] },
      ],
    });
    assert.throws(() => readConfigurationSource(join(dir, "index.json")), invalid);

    // Unknown fields stay closed, inside the block and around it.
    writeRole({ surprise: true });
    assert.throws(() => readConfigurationSource(join(dir, "index.json")), invalid);
    writeFileSync(join(dir, "resident.json"), JSON.stringify({
      agentProfile: {}, extensions: [DEPLOYMENT_LAYOUT.extension], promptFile: "prompt.md", nope: 1,
    }));
    assert.throws(() => readConfigurationSource(join(dir, "index.json")), invalid);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
