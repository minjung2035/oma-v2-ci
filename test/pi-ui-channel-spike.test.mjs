import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const dist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const source = readFileSync(join(dist, "modes/rpc/rpc-mode.js"), "utf8");
const parsed = ts.createSourceFile("rpc-mode.js", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
function uiFactory() {
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "createExtensionUIContext")
      expression = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(expression, "Pi changed the RPC UI owner; repeat the channel spike");
  const requests = [];
  const ui = runInNewContext(`(${expression})()`, {
    output: request => requests.push(request), crypto: { randomUUID: () => "test-id" },
    createDialogPromise: (_options, _fallback, request) => { requests.push(request); return Promise.resolve(undefined); },
    theme: {}, pendingExtensionRequests: new Map(),
  });
  return { ui, requests };
}

test("#10 spike: Pi 1.0.1 exposes only fixed UI RPC methods, not arbitrary method/params", async () => {
  const manifest = JSON.parse(readFileSync(join(dist, "../package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.1", "repeat the spike when upgrading Pi");
  const { ui, requests } = uiFactory();
  const message = 'OMA_PI_BOUNDARY_V1 {"batchId":"batch"}';
  ui.notify(message, "info");
  assert.deepEqual(JSON.parse(JSON.stringify(requests.pop())), {
    type: "extension_ui_request", id: "test-id", method: "notify", message, notifyType: "info",
  });
  ui.notify({ method: "oma.boundary", params: { batchId: "batch" } }, "info");
  assert.equal(requests.pop().method, "notify", "an object in notify cannot select a wire method");
  await ui.select("oma.boundary", ["params"]);
  assert.equal(requests.pop().method, "select");
  ui.setWidget("oma.boundary", ["params"]);
  assert.equal(requests.pop().method, "setWidget");
  for (const name of ["request", "send", "sendRequest", "oma.boundary"])
    assert.equal(ui[name], undefined, `${name} would be a new public transport to spike`);
  const declarations = readFileSync(join(dist, "modes/rpc/rpc-types.d.ts"), "utf8");
  assert.doesNotMatch(declarations, /method: "oma\./);
});

test("#12 engine oracle: branded commands carry no argument hint that a structured replacement would lose", async () => {
  const { BUILTIN_SLASH_COMMANDS } = await import(pathToFileURL(join(dist, "core/slash-commands.js")));
  for (const name of ["quit", "new", "resume", "changelog"]) {
    const command = BUILTIN_SLASH_COMMANDS.find(command => command.name === name);
    assert.ok(command, name);
    assert.equal(command.argumentHint, undefined, `preserve the structured ${name} argument hint after a Pi upgrade`);
  }
});
