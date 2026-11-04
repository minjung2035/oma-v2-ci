/** Registration coverage, not authenticated broker or live-provider proof. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { collaborationSurface, collaborationOmaNames } from "@oma/domain/collaboration-surface";
import * as registration from "@oma/extension/mail-tools";

function scope(surface, run) {
  const previous = { ...process.env };
  Object.assign(process.env, { OMA_AGENT_HOME: "/test-agent", OMA_MAIL_ARCHIVE: "/test-mail",
    OMA_SOCKET: "/test-control.sock", OMA_MAIL_ADDRESSES: "64", OMA_RECORD_ROOT: "/test-records", OMA_ACTOR: "alice" });
  if (surface === undefined) delete process.env.OMA_TOOL_SURFACE;
  else process.env.OMA_TOOL_SURFACE = surface;
  try { return run(); }
  finally {
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
    Object.assign(process.env, previous);
  }
}

for (const role of ["resident", "principal"]) test(`001. Collaboration registration: ${role} registers exactly the current actions, not legacy wrappers`, () => {
  const plan = collaborationSurface(role), tools = new Map();
  const pi = { registerTool(tool) { tools.set(tool.name, tool); }, on() {} };
  // Channel role is an explicit fixture input; no credential authentication is claimed.
  const channel = { attached: role === "principal", current: () => null, waitForGrant: async () => {} };
  scope(JSON.stringify(plan), () => {
    registration.registerOmaTools(pi, "/test-workspace", channel);
    assert.deepEqual([...tools.keys()].sort(), [...collaborationOmaNames(role)].sort());
    assert.deepEqual(registration.omaToolNames(role === "principal"), collaborationOmaNames(role));
  });
  for (const tool of tools.values()) {
    assert.equal(Object.hasOwn(tool.parameters.properties, "request"), false, "models do not supply replacement recovery keys");
    assert.equal(tool.executionMode, "sequential");
  }
});

for (const [label, raw] of [["absent", undefined], ["legacy", JSON.stringify({ version: 2, defaultMode: "DISABLED",
  direct: ["oma_mail_send", "oma_mail_ack"], optional: [], disabled: [] })], ["malformed", "{"]]) {
  test(`002. Collaboration registration: ${label} plan cannot revive the old registration or ownership catalog`, () => {
    const names = [];
    scope(raw, () => {
      registration.registerOmaTools({ registerTool(tool) { names.push(tool.name); } }, "/test-workspace");
      assert.deepEqual(names, []);
      assert.deepEqual(registration.omaToolNames(false), []);
      assert.deepEqual(registration.omaToolNames(true), []);
    });
  });
}

test("003. Removed model readers and old module entrypoints do not survive in the installed workspace output", async () => {
  assert.equal(Object.hasOwn(registration, "readableMail"), false);
  assert.equal(Object.hasOwn(registration, "replyPathFor"), false);
  const entry = import.meta.resolve("@oma/extension");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", entry), "utf8"));
  assert.equal(Object.hasOwn(manifest.exports, "./principal-tools"), false);
  for (const name of ["agent-tools", "review-tools", "principal-tools"])
    for (const suffix of [".js", ".d.ts", ".js.map", ".d.ts.map"])
      assert.equal(existsSync(new URL(`./${name}${suffix}`, entry)), false, `retired output ${name}${suffix} remains`);
});

for (const role of ["resident", "principal"]) for (const addresses of [1, 7, 64, 128]) {
  test(`004. Recipient contract: ${role}, effective bound ${addresses} reaches both schema and pre-invocation validation`, async () => {
    let send;
    scope(JSON.stringify(collaborationSurface(role)), () => {
      process.env.OMA_MAIL_ADDRESSES = String(addresses);
      registration.registerOmaTools({ registerTool(tool) { if (tool.name === "oma_send") send = tool; }, on() {} }, "/test-workspace",
        { attached: role === "principal", current: () => null, waitForGrant: async () => {} });
    });
    assert.ok(send);
    assert.equal(send.parameters.properties.to.maxItems, addresses);
    const input = { to: Array.from({ length: addresses }, (_, index) => `w${index}`), content: { kind: "text", value: "exact body" } };
    assert.deepEqual(send.prepareArguments(input), input);
    const overflow = { ...input, to: [...input.to, "one-more"] };
    assert.throws(() => send.prepareArguments(overflow), /effective recipient bound/);
    await assert.rejects(send.execute("not-an-invocation", overflow), /effective recipient bound/);
  });
}

test("005. Recipient contract: selected registration refuses absent or invalid host bounds rather than inventing a default", () => {
  scope(JSON.stringify(collaborationSurface("resident")), () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
      if (value === undefined) delete process.env.OMA_MAIL_ADDRESSES; else process.env.OMA_MAIL_ADDRESSES = value;
      const names = [];
      assert.throws(() => registration.registerOmaTools({ registerTool(tool) { names.push(tool.name); }, on() {} }, "/test-workspace"), /effective host recipient bound/);
      assert.deepEqual(names, []);
    }
  });
});
