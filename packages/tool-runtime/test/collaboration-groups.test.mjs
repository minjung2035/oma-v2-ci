import test from "node:test";
import assert from "node:assert/strict";
import { collaborationSurface, decodeCollaborationSurface } from "@oma/domain/collaboration-surface";
import { registerToolSurface, parseSurfacePlan } from "../dist/tool-surface.js";

function fixture(role = "resident", branch = [], policy = () => true, own = () => true) {
  const plan = collaborationSurface(role), hooks = new Map(), tools = new Map();
  let active = [];
  for (const name of [...plan.direct, ...Object.values(plan.groups).flat()]) {
    if (name.endsWith("_tools")) continue;
    tools.set(name, { name, description: name, parameters: { type: "object" }, sourceInfo: { source: "extension", path: "/verified/oma.js" } });
  }
  const context = { sessionManager: { getBranch: () => branch } };
  const pi = { on(name, fn) { const list = hooks.get(name) ?? []; list.push(fn); hooks.set(name, list); },
    registerTool(tool) { tools.set(tool.name, { ...tool, sourceInfo: { source: "extension", path: "/verified/oma.js" } }); },
    getAllTools: () => [...tools.values()], getActiveTools: () => active,
    setActiveTools: names => { active = [...names]; } };
  const previous = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = JSON.stringify(plan);
  try { registerToolSurface(pi, plan.direct.filter(name => name.startsWith("oma_")), {
    role, own, permitted: policy, fatal: message => { throw new Error(message); } }); }
  finally { if (previous === undefined) delete process.env.OMA_TOOL_SURFACE; else process.env.OMA_TOOL_SURFACE = previous; }
  const emit = async (name, event = {}) => {
    let result;
    for (const fn of hooks.get(name) ?? []) result = await fn(event, context) ?? result;
    return result;
  };
  const call = (name, id) => tools.get(name).execute(id, {}, undefined, undefined, context);
  const commit = async choices => {
    const toolResults = choices.map(([toolName, toolCallId, isError = false]) => ({ toolName, toolCallId, isError }));
    const toolResultEntryIds = toolResults.map((message, i) => {
      const id = `entry-${branch.length}-${i}`;
      branch.push({ id, type: "message", message: { role: "toolResult", ...message } });
      return id;
    });
    const result = await emit("turn_end", { entries: [], toolResultEntryIds, toolResults });
    if (result) branch.push(...result.entries);
    return result;
  };
  return { plan, tools, emit, call, commit, branch, get active() { return active; } };
}
test("001. Exact role catalogs and legacy surface separation", () => {
  const worker = collaborationSurface("resident"), principal = collaborationSurface("principal");
  assert.equal(worker.direct.length, 19); assert.equal(principal.direct.length, 12);
  assert.equal(new Set([...worker.direct, ...principal.direct]).size, 22);
  const expanded = plan => [...new Set([...plan.direct, ...Object.values(plan.groups).flat()])];
  assert.equal(expanded(worker).length, 26); assert.equal(expanded(principal).length, 17);
  assert.equal(new Set([...expanded(worker), ...expanded(principal)]).size, 29);
  assert.equal(new Set([...worker.direct, ...principal.direct].filter(name => name.startsWith("oma_"))).size, 9);
  for (const role of ["resident", "principal"]) assert.deepEqual(parseSurfacePlan(JSON.stringify(collaborationSurface(role))).plan, collaborationSurface(role));
  assert.equal(parseSurfacePlan('{"version":2,"defaultMode":"DISABLED","direct":["read"],"optional":[],"disabled":[]}').state, "malformed");
  for (const change of [p => { p.extra = 1; }, p => { p.direct.push("oma_mail_send"); },
    p => { p.groups.lsp_tools.push("bash"); }, p => { p.groups.extra = []; }, p => { p.role = "worker"; }]) {
    const p = structuredClone(principal); change(p); assert.throws(() => decodeCollaborationSurface(p));
  }
});
for (const order of [["lsp_tools", "web_tools"], ["web_tools", "lsp_tools"]]) {
  test(`002. Groups accumulate in ${order.join(" then ")} order after persisted results`, async () => {
    const f = fixture(); await f.emit("session_start");
    assert.equal(f.active.length, 19); assert.equal(f.tools.has("toolset"), false);
    const first = await f.call(order[0], "one"); assert.equal(f.active.length, 19);
    assert.equal(first.details.effective, "next-model-call-after-result-persistence");
    await f.commit([[order[0], "one"]]);
    for (const name of f.plan.groups[order[0]]) assert.ok(f.active.includes(name));
    await f.call(order[1], "two"); await f.commit([[order[1], "two"]]);
    assert.equal(f.active.length, 26);
    const repeated = await f.call(order[0], "three"); assert.deepEqual(repeated.details.added, []);
    await f.commit([[order[0], "three"]]); assert.equal(f.active.length, 26);
    await f.emit("before_provider_request");
  });
}
test("003. One-batch union, resume and branch inheritance do not execute members", async () => {
  const f = fixture(); await f.emit("session_start");
  await f.call("lsp_tools", "one"); await f.call("web_tools", "two");
  await f.commit([["lsp_tools", "one"], ["web_tools", "two"]]);
  assert.equal(f.active.length, 26); assert.equal(f.branch.filter(entry => entry.type === "custom").length, 1);
  const resumed = fixture("resident", structuredClone(f.branch)); await resumed.emit("session_start"); assert.equal(resumed.active.length, 26);
  const fork = fixture("resident", structuredClone(f.branch)); await fork.emit("session_tree"); assert.equal(fork.active.length, 26);
  const uncommitted = fixture(); await uncommitted.emit("session_start"); await uncommitted.call("web_tools", "lost");
  const restored = fixture("resident", uncommitted.branch); await restored.emit("session_start"); assert.equal(restored.active.length, 19);
});

test("009. Equivalent metadata reregistration is safe and in-place schema changes are fenced", async () => {
  const same = fixture(); await same.emit("session_start");
  const original = same.tools.get("read");
  same.tools.set("read", { ...original, parameters: structuredClone(original.parameters) });
  await same.emit("before_provider_request");
  assert.ok(same.active.includes("read"));
  const changed = fixture(); await changed.emit("session_start");
  changed.tools.get("read").parameters.additionalProperties = false;
  await assert.rejects(changed.emit("before_provider_request"), /changed outside/u);
  assert.deepEqual(changed.active, []);
});

for (const role of ["principal", "resident"]) {
  for (const field of ["description", "nested schema", "source kind", "source path", "exposure"]) {
    test(`011. ${role}: a committed web group cannot inherit a later ${field} replacement`, async () => {
      const f = fixture(role);
      f.tools.get("fetch_content").parameters = { type: "object", properties: { query: { type: "string" } } };
      await f.emit("session_start");
      await f.call("web_tools", "selected"); await f.commit([["web_tools", "selected"]]);
      await f.emit("before_provider_request");
      const branch = JSON.stringify(f.branch), tool = f.tools.get("fetch_content");
      if (field === "description") tool.description += " changed";
      else if (field === "nested schema") tool.parameters.properties.query.type = "number";
      else if (field === "source kind") tool.sourceInfo.source = "builtin";
      else if (field === "source path") tool.sourceInfo.path = "/other/extension.js";
      else tool.exposure = "hidden";
      await assert.rejects(f.emit("before_provider_request"), /changed outside/);
      assert.deepEqual(f.active, []);
      assert.equal((await f.emit("tool_call", { toolName: "fetch_content" })).block, true);
      assert.equal(JSON.stringify(f.branch), branch, "revocation cannot rewrite the earlier committed exposure event");
    });
  }
}
test("004. Extra arguments, result-persistence gaps and late shadows fail closed", async () => {
  const f = fixture(); await f.emit("session_start");
  assert.throws(() => f.tools.get("web_tools").prepareArguments({ query: "do not dispatch" }));
  await f.call("web_tools", "pending");
  await assert.rejects(f.emit("turn_end", { entries: [], toolResults: [{ toolName: "web_tools", toolCallId: "pending" }], toolResultEntryIds: [] }), /persisted/);
  assert.deepEqual(f.active, []);
  const g = fixture(); await g.emit("session_start");
  g.tools.set("read", { ...g.tools.get("read"), parameters: {} });
  await assert.rejects(g.emit("before_provider_request"), /changed outside/); assert.deepEqual(g.active, []);
});
test("005. Principal cannot inherit Worker exposure or admit a revoked member", async () => {
  const f = fixture("principal"); await f.emit("session_start");
  await f.call("lsp_tools", "one"); await f.commit([["lsp_tools", "one"]]);
  assert.deepEqual(f.plan.groups.lsp_tools, ["lsp_status"]); assert.equal(f.active.includes("lsp_fix"), false);
  assert.equal((await f.emit("tool_call", { toolName: "oma_spawn" })).block, true);
  const worker = fixture(); await worker.emit("session_start"); await worker.call("web_tools", "w"); await worker.commit([["web_tools", "w"]]);
  const wrong = fixture("principal", structuredClone(worker.branch)); await assert.rejects(wrong.emit("session_start"), /another role/);
  const revoked = fixture("resident", structuredClone(worker.branch), name => name !== "fetch_content");
  await assert.rejects(revoked.emit("session_start"), /cannot admit/); assert.deepEqual(revoked.active, []);
});

test("006. Groups: forged persisted-result IDs and discarded boundary drafts cannot expose tools", async () => {
  const f = fixture(); await f.emit("session_start"); await f.call("web_tools", "one");
  await assert.rejects(f.emit("turn_end", { entries: [], toolResultEntryIds: ["forged"],
    toolResults: [{ toolCallId: "one", toolName: "web_tools", isError: false }] }), /matching persisted/);
  assert.deepEqual(f.active, []);
  const g = fixture(); await g.emit("session_start"); await g.call("web_tools", "two");
  g.branch.push({ id: "result", type: "message", message: { role: "toolResult", toolCallId: "two", toolName: "web_tools", isError: false } });
  await g.emit("turn_end", { entries: [], toolResultEntryIds: ["result"],
    toolResults: [{ toolCallId: "two", toolName: "web_tools", isError: false }] });
  await assert.rejects(g.emit("before_provider_request"), /not committed/);
  assert.deepEqual(g.active, []);
});

test("007. Groups: failed results do not activate and non-direct registrations cannot be admitted", async () => {
  const f = fixture(); await f.emit("session_start"); await f.call("web_tools", "failed");
  await f.commit([["web_tools", "failed", true]]);
  assert.equal(f.active.length, 19);
  await f.emit("before_provider_request");
  const g = fixture();
  g.tools.set("fetch_content", { ...g.tools.get("fetch_content"), exposure: "hidden" });
  await assert.rejects(g.emit("session_start"), /cannot admit/);
  assert.deepEqual(g.active, []);
});

test("008. Groups: v3 requires an authenticated host role, not just an environment catalog", () => {
  const previous = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = JSON.stringify(collaborationSurface("principal"));
  try {
    assert.throws(() => registerToolSurface({}, [], { fatal: message => { throw new Error(message); } }), /authenticated role/);
    assert.throws(() => registerToolSurface({}, [], { role: "resident", fatal: message => { throw new Error(message); } }), /authenticated role/);
  } finally { if (previous === undefined) delete process.env.OMA_TOOL_SURFACE; else process.env.OMA_TOOL_SURFACE = previous; }
});

for (const role of ["resident", "principal"]) {
  test(`009. Role exposure: ${role} rejects persisted exposure containing only part of a group`, async () => {
    const plan = collaborationSurface(role);
    for (const [group, members] of Object.entries(plan.groups)) {
      if (members.length === 1) continue;
      for (const missing of members) {
        const branch = [{ type: "custom", customType: "oma-collaboration-exposure",
          data: { version: 1, surface: plan.surface, role, active: members.filter(name => name !== missing) } }];
        const original = JSON.stringify(branch);
        const f = fixture(role, branch);
        await assert.rejects(f.emit("session_start"), /incomplete|malformed/,
          `${group} without ${missing} is not a committed cumulative group selection`);
        assert.deepEqual(f.active, [], "a partial persisted group cannot become callable");
        assert.equal((await f.emit("tool_call", { toolName: "read" })).block, true);
        assert.equal(JSON.stringify(branch), original, "refusal must preserve the original event bytes");
      }
    }
  });
}

for (const role of ["resident", "principal"]) test(`010. ${role}: verified direct user extensions survive groups and reload; hidden, deferred, unverified and revoked tools stay closed`, async () => {
  const denied = new Set(["unverified"]), own = name => !["custom", "hidden", "deferred", "unverified"].includes(name);
  const f = fixture(role, [], name => !denied.has(name), own);
  const add = (h, name, exposure) => h.tools.set(name, { name, description: name, parameters: { type: "object" },
    ...(exposure ? { exposure } : {}), sourceInfo: { source: role === "principal" ? "npm" : "cli", path: "/verified/user.js" } });
  for (const [name, exposure] of [["custom"], ["hidden", "hidden"], ["deferred", "deferred"], ["unverified"]]) add(f, name, exposure);
  await f.emit("session_start");
  assert.ok(f.active.includes("custom"));
  for (const name of ["hidden", "deferred", "unverified"]) {
    assert.ok(!f.active.includes(name)); assert.equal((await f.emit("tool_call", { toolName: name })).block, true);
  }
  assert.equal(await f.emit("tool_call", { toolName: "custom" }), undefined);
  const result = await f.call("web_tools", "web");
  await f.commit([["web_tools", "web"]]);
  assert.equal(f.active.length, result.details.resultingCount);
  assert.ok(f.active.includes("custom"));
  assert.ok(!f.branch.at(-1).data.active.includes("custom"));
  const resumed = fixture(role, structuredClone(f.branch), name => !denied.has(name), own);
  add(resumed, "custom"); await resumed.emit("session_start");
  assert.deepEqual(resumed.active, f.active);
  denied.add("custom"); await resumed.emit("session_tree");
  assert.ok(!resumed.active.includes("custom")); assert.equal((await resumed.emit("tool_call", { toolName: "custom" })).block, true);
  denied.delete("custom"); await f.emit("before_provider_request");
  f.tools.set("custom", { ...f.tools.get("custom"), sourceInfo: { source: "extension", path: "/different/user.js" } });
  await assert.rejects(f.emit("before_provider_request"), /changed outside/);
  assert.deepEqual(f.active, []);
});
