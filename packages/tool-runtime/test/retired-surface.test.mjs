import test from "node:test";
import assert from "node:assert/strict";
import { parseSurfacePlan, registerToolSurface } from "../dist/tool-surface.js";

const legacy = JSON.stringify({ version: 2, defaultMode: "DISABLED", direct: ["read", "oma_mail_send"],
  optional: ["web_search"], disabled: [] });

function host(raw, branch = []) {
  const registered = [], hooks = new Map();
  let active = ["read", "oma_mail_send", "web_search"];
  const registry = new Map(active.map(name => [name, { name, description: name, parameters: {} }]));
  const pi = {
    registerTool(tool) { registered.push(tool.name); registry.set(tool.name, tool); },
    on(name, handler) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
    getAllTools: () => [...registry.values()],
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
  };
  const previous = process.env.OMA_TOOL_SURFACE;
  if (raw === undefined) delete process.env.OMA_TOOL_SURFACE;
  else process.env.OMA_TOOL_SURFACE = raw;
  try {
    registerToolSurface(pi, ["oma_mail_send"], { role: "resident", own: () => true,
      fatal(message) { throw new Error(message); } });
  } finally {
    if (previous === undefined) delete process.env.OMA_TOOL_SURFACE;
    else process.env.OMA_TOOL_SURFACE = previous;
  }
  const context = { sessionManager: { getBranch: () => branch } };
  const emit = async (name, event = {}) => {
    let result;
    for (const handler of hooks.get(name) ?? []) result = await handler(event, context) ?? result;
    return result;
  };
  return { emit, registered, get active() { return active; } };
}

test("001. A valid version-2 plan is explicitly unsupported, never decoded as a live plan", () => {
  const parsed = parseSurfacePlan(legacy);
  assert.equal(parsed.state, "malformed");
  assert.match(parsed.reason, /unsupported.*surface.*version/i);
  assert.equal(Object.hasOwn(parsed, "plan"), false);
});

for (const [label, raw] of [["legacy", legacy], ["absent", undefined], ["malformed", "{"],
  ["unknown-version", JSON.stringify({ version: 99 })]]) {
  test(`002. Retired surface: ${label} surface registers no selector and closes calls at every entry boundary`, async () => {
    const branch = [{ type: "custom", customType: "oma-toolset", data: { version: 1, select: ["web_search"] } },
      { type: "message", message: { role: "toolResult", toolName: "toolset", toolCallId: "original",
        isError: false, content: [{ type: "text", text: "historical selection" }] } }];
    const original = JSON.stringify(branch);
    for (const boundary of ["session_start", "session_tree", "before_agent_start", "before_provider_request"]) {
      const f = host(raw, branch);
      assert.deepEqual(f.registered, [], "there is no replacement or compatibility selector");
      assert.equal((await f.emit("tool_call", { toolName: "oma_mail_send" }))?.block, true,
        "even an omitted startup event cannot authorize a tool call");
      await assert.rejects(f.emit(boundary), /surface|collaboration/i);
      assert.deepEqual(f.active, []);
      assert.equal((await f.emit("tool_call", { toolName: "read" }))?.block, true);
      assert.equal(JSON.stringify(branch), original, "neither old selection nor result history is migrated or rewritten");
    }
  });
}
