// Fixtures for the surface rules: for each rule, a tree it must accept, a tree
// it must reject, and a near miss it must not mistake for a violation.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { surfaceRuleFindings } from "../scripts/architecture/rules/surface-rules.mjs";

function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), "oma-surface-rule-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    }
    return run(surfaceRuleFindings(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const rules = findings => findings.map(value => value.rule);
const has = (findings, rule) => rules(findings).includes(rule);
const productHosts = [
  ...["oma-society", "personal-host", "pi-personal", "oma-mac", "pi-interactive"].map(name => ({
    file: `apps/oma/src/entry/${name}.ts`, compiled: `apps/oma/dist/entry/${name}.js` })),
  ...["personal", "interactive"].map(name => ({ file: `packages/engine/src/${name}.ts`, compiled: `packages/engine/dist/${name}.js` })),
];
/** Accept cases assert only the rules under test: a fixture file present for
 * one rule may legitimately lack what another rule requires of the real tree. */
const clean = (findings, ...under) => assert.deepEqual(findings.filter(value => under.includes(value.rule)), []);

test("extension-closure: the extension imports only built-ins, the engine API, typebox and itself", () => {
  withTree({
    "packages/extension/src/index.ts": 'import { readFileSync } from "node:fs"; import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"; import { a } from "./a.js";',
    "packages/extension/src/a.ts": 'import { Type } from "typebox"; export const a = Type;',
  }, findings => assert.deepEqual(findings, []));
  withTree({
    "packages/extension/src/index.ts": "import { Store } from \"../../storage/src/store.js\";",
    "packages/domain/src/errors.ts": "export class StoreError {}",
  }, findings => assert.ok(has(findings, "extension-closure")));
  withTree({
    "packages/extension/src/a.ts": 'import leftPad from "left-pad";',
  }, findings => assert.ok(has(findings, "extension-closure")));
  // Only the entry composes the extension; nothing else in src reaches in.
  withTree({
    "packages/extension/src/a.ts": "export const a = 1;",
    "apps/oma/src/runner.ts": "import { a } from \"../../../packages/extension/src/a.js\";",
  }, findings => assert.ok(has(findings, "extension-closure")));
});

test("extension-dynamic-load and extension-execute: no run-time loading, no invoking a tool handler", () => {
  // Near miss: defining an execute handler is not invoking one.
  withTree({
    "packages/extension/src/tools.ts": "export const tool = { async execute() { return 1; } };",
  }, findings => assert.deepEqual(findings, []));
  withTree({ "packages/extension/src/a.ts": 'export const load = () => import("./b.js");' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  withTree({ "packages/extension/src/a.ts": 'export const load = () => require("x");' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  // The one sanctioned deferred load: a literal specifier into the vendored
  // bundle dir, evaluated only behind verifyVendorBundle. A computed or
  // outside-vendor specifier is still forbidden.
  withTree({ "packages/tool-lsp/src/index.ts": 'export const load = () => import("./vendor/pi-lsp/runtime/command.js");' },
    findings => assert.ok(!has(findings, "extension-dynamic-load")));
  withTree({ "packages/tool-lsp/src/index.ts": 'export const load = (name: string) => import(`./vendor/pi-lsp/runtime/${name}.js`);' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  withTree({ "packages/tool-lsp/src/index.ts": "export const load = () => import(\"./a.js\");" },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  // A static edge into the vendored bundle is the same violation: its bytes
  // would evaluate at module load, before verifyVendorBundle can run.
  withTree({ "packages/tool-lsp/src/index.ts": 'import { mergeEnvironment } from "./vendor/pi-lsp/runtime/command.js";' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  withTree({ "packages/tool-lsp/src/index.ts": 'export { mergeEnvironment } from "./vendor/pi-lsp/runtime/command.js";' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  // A type-only vendored import erases at compile -- nothing evaluates early.
  withTree({ "packages/tool-lsp/src/index.ts": 'import type { LspServerAdapter } from "./vendor/pi-lsp/runtime/types.js";' },
    findings => assert.ok(!has(findings, "extension-dynamic-load")));
  withTree({ "packages/extension/src/a.ts": "export const run = (tool: any) => tool.execute();" },
    findings => assert.ok(has(findings, "extension-execute")));
  withTree({ "packages/extension/src/a.ts": "export const run = (tool: any) => tool.execute.call(tool);" },
    findings => assert.ok(has(findings, "extension-execute")));
});

test("engine-primitive-owner: one owner per borrowed primitive, and no borrowed layout", () => {
  withTree({
    "packages/tui/src/cells.ts": 'import { visibleWidth } from "@earendil-works/pi-tui"; export const w = visibleWidth;',
    "packages/tui/src/keys.ts": 'import { parseKey } from "@earendil-works/pi-tui"; export const k = parseKey;',
  }, findings => assert.deepEqual(findings, []));
  withTree({ "packages/tui/src/view/text.ts": 'import { truncateToWidth } from "@earendil-works/pi-tui";' },
    findings => assert.ok(has(findings, "engine-primitive-owner")));
  withTree({ "packages/tui/src/screen.ts": 'import { visibleWidth } from "@earendil-works/pi-tui";' },
    findings => assert.ok(has(findings, "engine-primitive-owner")));
  withTree({ "packages/tui/src/private-adapter.ts": 'import type { X } from "@earendil-works/pi-coding-agent";' },
    findings => assert.ok(has(findings, "engine-primitive-owner")));
});

test("tui-view-boundary: the view sees only data, and only terminal owners draw through the seam", () => {
  withTree({
    "packages/tui/src/view/index.ts": 'export { render } from "./screens.js";',
    "packages/tui/src/view/screens.ts": 'import type { State } from "../model.js"; export const render = (s: State) => s;',
    "packages/tui/src/model.ts": "export interface State { open: boolean }",
    "packages/tui/src/app.ts": 'import { render } from "./view/index.js";',
    "packages/tui/src/session-mode.ts": 'import { renderSessionMode } from "./view/index.js";',
  }, findings => clean(findings, "tui-view-boundary"));
  withTree({ "packages/tui/src/view/screens.ts": 'import { readFileSync } from "node:fs";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "packages/tui/src/view/screens.ts": 'import { readMailbox } from "../sources/mail.js";', "apps/oma/src/application/mail.ts": "export const readMailbox = 1;" },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "packages/tui/src/view/text.ts": "export const fit = 1;", "packages/tui/src/app.ts": 'import { fit } from "./view/text.js";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "packages/tui/src/view/text.ts": "export const pad = 1;", "packages/tui/src/session-mode.ts": 'import { pad } from "./view/text.js";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "packages/tui/src/view/index.ts": "export const render = 1;", "packages/tui/src/arbitrary.ts": 'import { render } from "./view/index.js";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "packages/tui/src/view/index.ts": "export const render = 1;", "apps/oma/src/entry/oma.ts": "import { render } from \"../../../../packages/tui/src/view/index.js\";" },
    findings => assert.ok(has(findings, "tui-view-boundary")));
});

test("tui-write-owner, tui-ledger, tui-transport-owner, tui-internal-method", () => {
  withTree({
    "apps/oma/src/application/settings.ts": "import { replaceDerivedFile } from \"../../../../storage/durable-fs.js\"; replaceDerivedFile(\"a\", \"b\");",
    "apps/oma/src/application/status-observation.ts": "import type { ChannelLimits } from \"../../../../packages/client/src/channel.js\";",
  }, findings => clean(findings, "tui-write-owner", "tui-ledger", "tui-transport-owner", "tui-internal-method"));
  withTree({ "apps/oma/src/application/mail.ts": 'import { renameSync } from "node:fs"; renameSync("a", "b");' },
    findings => assert.ok(has(findings, "tui-write-owner")));
  // Near miss: writing to a terminal stream is not a filesystem write.
  withTree({ "packages/tui/src/screen.ts": 'export const draw = (out: { write(t: string): void }) => out.write("x");' },
    findings => clean(findings, "tui-write-owner", "tui-ledger", "tui-transport-owner", "tui-internal-method"));
  withTree({ "packages/tui/src/app.ts": "import { Store } from \"../../storage/src/store.js\";", "packages/storage/src/store.ts": "export class Store {}" },
    findings => assert.ok(has(findings, "tui-ledger")));
  withTree({ "packages/tui/src/app.ts": "import { BrokerChannel } from \"../../client/src/channel.js\";", "packages/client/src/channel.ts": "export class BrokerChannel {}" },
    findings => assert.ok(has(findings, "tui-transport-owner")));
  withTree({
    "packages/protocol/src/methods.ts": 'export const INTERNAL_METHODS = { "host.principalRelay": {} } as const;',
    "apps/oma/src/application/status-observation.ts": 'export const call = "host.principalRelay";',
  }, findings => assert.ok(has(findings, "tui-internal-method")));
  // Near miss: the name in a comment is prose, not a call.
  withTree({
    "packages/protocol/src/methods.ts": 'export const INTERNAL_METHODS = { "host.principalRelay": {} } as const;',
    "apps/oma/src/application/status-observation.ts": "// never calls host.principalRelay\nexport const x = 1;",
  }, findings => clean(findings, "tui-write-owner", "tui-ledger", "tui-transport-owner", "tui-internal-method"));
});

test("product-cli-separation and resident-product-surface: closures do not cross", () => {
  withTree({
    "apps/oma/src/entry/oma.ts": "import { a } from \"../../../../packages/tui/src/app.js\";", "packages/tui/src/app.ts": "export const a = 1;",
    "apps/oma/src/cli.ts": 'import { b } from "./cli/effects.js";', "apps/oma/src/cli/effects.ts": "export const b = 1;",
    "apps/oma/src/entry/runner.ts": 'import { c } from "../runner.js";', "apps/oma/src/runner.ts": "export const c = 1;",
  }, findings => clean(findings, "product-cli-separation", "resident-product-surface"));
  withTree({ "apps/oma/src/entry/oma.ts": 'import { parse } from "../cli/arguments.js";', "apps/oma/src/cli/arguments.ts": "export const parse = 1;" },
    findings => assert.ok(has(findings, "product-cli-separation")));
  withTree({ "apps/oma/src/cli.ts": "import { a } from \"../../../packages/tui/src/app.js\";", "packages/tui/src/app.ts": "export const a = 1;" },
    findings => assert.ok(has(findings, "product-cli-separation")));
  withTree({ "apps/oma/src/entry/runner.ts": 'const entry = "apps/oma/dist/entry/oma.js";' },
    findings => assert.ok(has(findings, "resident-product-surface")));
  // Near miss: a type-only import is erased and carries nothing at run time.
  withTree({ "apps/oma/src/entry/runner.ts": "import type { State } from \"../../../../packages/tui/src/model.js\";", "packages/tui/src/model.ts": "export interface State {}" },
    findings => clean(findings, "product-cli-separation", "resident-product-surface"));
  // The deployment layout names the product surface to hide it; that is allowed.
  withTree({ "apps/oma/src/entry/runner.ts": "import { L } from \"../../../../packages/domain/src/deployment.js\";", "packages/domain/src/deployment.ts": 'export const L = ["packages/tui/dist"];' },
    findings => clean(findings, "product-cli-separation", "resident-product-surface"));
});

test("product closures: dynamic import, require and re-export carry the same runtime boundaries", () => {
  for (const load of ['() => import("./oma-society.js")', '() => require("./oma-society.js")']) {
    withTree({
      "apps/oma/src/entry/oma.ts": `export const start = ${load};`,
      "apps/oma/src/entry/oma-society.ts": 'export { start } from "../runtime/hidden.js";',
      "apps/oma/src/runtime/hidden.ts": 'export const start = () => import("../cli/arguments.js");',
      "apps/oma/src/cli/arguments.ts": "export const parse = 1;",
    }, findings => assert.ok(findings.some(value => value.rule === "product-cli-separation" && value.file === "apps/oma/src/cli/arguments.ts")));
    withTree({
      "apps/oma/src/entry/oma.ts": `export const start = ${load};`,
      "apps/oma/src/entry/oma-society.ts": "export const start = () => import(\"../../../../packages/storage/src/store.js\");",
      "packages/storage/src/store.ts": "export class Store {}",
    }, findings => assert.ok(has(findings, "tui-ledger")));
  }
  withTree({ "apps/oma/src/entry/oma.ts": 'export type { State } from "../cli/arguments.js";',
    "apps/oma/src/cli/arguments.ts": "export interface State {}" }, findings => clean(findings, "product-cli-separation"));
});

test("product entries: every independently launched host entry is covered and hidden from Residents", () => {
  for (const { file, compiled } of productHosts) {
    const cli = relative(dirname(file), "apps/oma/src/cli/arguments.js");
    withTree({ [file]: `import { parse } from "${cli}";`, "apps/oma/src/cli/arguments.ts": "export const parse = 1;" },
      findings => assert.ok(has(findings, "product-cli-separation"), file));
    for (const origin of ["apps/oma/src/entry/runner.ts", "apps/oma/src/cli.ts"]) {
      const target = relative(dirname(origin), file).replace(/\.ts$/, ".js");
      withTree({ [origin]: `export const start = () => import("${target.startsWith(".") ? target : "./" + target}");`, [file]: "export {};" },
        findings => assert.ok(has(findings, origin === "apps/oma/src/cli.ts" ? "product-cli-separation" : "resident-product-surface"), file));
    }
    withTree({ "apps/oma/src/entry/runner.ts": `export const entry = "${compiled}";` },
      findings => assert.ok(has(findings, "resident-product-surface"), file));
  }
});

test("product-pi-command and model-surface-product-words", () => {
  withTree({ "packages/tui/src/app.ts": 'export const hint = "run pi install";' },
    findings => assert.ok(has(findings, "product-pi-command")));
  // DR25: oma's own command is not the engine's.
  withTree({ "packages/tui/src/app.ts": 'export const hint = "run oma pi install npm:x";' },
    findings => assert.ok(!has(findings, "product-pi-command")));
  withTree({ "packages/tui/src/app.ts": 'export const hint = "or pi update, as a Pi user would";' },
    findings => assert.ok(has(findings, "product-pi-command")));
  for (const { file } of productHosts)
    withTree({ [file]: 'export const hint = "run pi install";' },
      findings => assert.ok(has(findings, "product-pi-command"), file));
  withTree({ "apps/oma/src/cli/exit.ts": 'export const usage = "press Ctrl+X";' },
    findings => assert.ok(has(findings, "model-surface-product-words")));
  // Near miss: the same words in a comment are not shown to anyone.
  withTree({ "apps/oma/src/cli/exit.ts": "// the host has a Control Panel (Ctrl+X)\nexport const usage = \"usage\";" },
    findings => assert.deepEqual(findings, []));
});

test("product-bare-error and product-undeclared-bound", () => {
  withTree({ "packages/tui/src/app.ts": 'throw new Error("x");' }, findings => assert.ok(has(findings, "product-bare-error")));
  withTree({ "packages/tui/src/app.ts": "export const width = 80;" }, findings => assert.ok(has(findings, "product-undeclared-bound")));
  // Code inside a template expression is still code.
  withTree({ "packages/tui/src/app.ts": "export const id = (h: string) => `r-${h.slice(0, 32)}`;" },
    findings => assert.ok(has(findings, "product-undeclared-bound")));
  // Near misses: a declaration file, a byte identity, a file mode, a small index.
  withTree({
    "packages/domain/src/surface-bounds.ts": "export const W = 80;",
    "packages/tui/src/keys.ts": "export const esc = String.fromCharCode(27); export const csi = 0x5b; export const mode = 0o600; export const i = 3;",
    "packages/tui/src/app.ts": 'export const label = "80 columns";',
  }, findings => clean(findings, "product-bare-error", "product-undeclared-bound"));
});

test("user-pi-state: the user's home and Pi state are never named", () => {
  withTree({ "packages/engine/src/pi-runtime.ts": 'import { homedir } from "node:os"; export const h = homedir();' },
    findings => assert.ok(has(findings, "user-pi-state")));
  withTree({ "apps/oma/src/entry/oma.ts": 'export const dir = "/home/u/.pi/agent";' },
    findings => assert.ok(has(findings, "user-pi-state")));
  // Near miss: OMA's own agent directory is named "pi", not ".pi".
  withTree({ "packages/engine/src/pi-runtime.ts": 'import { join } from "node:path"; export const dir = (s: string) => join(s, "pi"); export const f = "x.pie";' },
    findings => assert.deepEqual(findings, []));
});

test("settings-placement-owner, closed-switch and module-port-import", () => {
  withTree({
    "packages/domain/src/settings-policy.ts": "const PLACEMENT = {}; export function f(field: string) { switch (field) { default: return PLACEMENT; } }",
    "packages/tui/src/app.ts": "import { assertNever } from \"../../domain/src/exhaustive.js\"; export function run(effect: { kind: \"a\" }) { switch (effect.kind) { case \"a\": return; default: return assertNever(effect); } }",
  }, findings => assert.deepEqual(findings, []));
  withTree({ "packages/domain/src/settings-policy.ts": "export function f(field: string) { switch (field) {} switch (field) {} }" },
    findings => assert.ok(has(findings, "settings-placement-owner")));
  withTree({ "packages/tui/src/app.ts": 'export function run(effect: { kind: "a" }) { switch (effect.kind) { case "a": return; } }' },
    findings => assert.ok(has(findings, "closed-switch")));
  // Near miss: assertNever over some other value does not close this switch.
  withTree({ "packages/tui/src/app.ts": 'declare const assertNever: (x: never) => never; declare const other: never; export function run(effect: { kind: "a" }) { switch (effect.kind) { default: return assertNever(other); } }' },
    findings => assert.ok(has(findings, "closed-switch")));
  withTree({ "packages/broker/src/public-dispatcher.ts": "import { Store } from \"../../storage/src/store.js\";", "packages/storage/src/store.ts": "export class Store {}" },
    findings => assert.ok(has(findings, "module-port-import")));
  withTree({ "apps/oma/src/cli.ts": "import { m } from \"../../../packages/mail/src/index.js\";", "packages/mail/src/index.ts": "export const m = 1;" },
    findings => assert.ok(has(findings, "module-port-import")));
});

test("principal-turn-owner: the host never asks the engine to fold a prompt into a run already going", () => {
  // Accept: a prompt written with nothing else in the message.
  withTree({
    "packages/engine/src/principal-session.ts": 'export const send = (text: string) => ({ type: "prompt", message: text });',
  }, findings => clean(findings, "principal-turn-owner"));
  // Near miss: the batch's own delivery mode is a different thing with the
  // same vocabulary, and it is the broker's fixed policy, not a turn joining
  // another owner's run.
  withTree({
    "packages/mail/src/batches.ts": 'export const batch = { deliveryMode: "followUp", notice: "mail" };',
    "packages/protocol/src/batch-view.ts": 'export const ok = (mode: string) => mode === "steer" || mode === "followUp";',
  }, findings => clean(findings, "principal-turn-owner"));
  // Reject, in each spelling the option can be written.
  withTree({
    "packages/engine/src/principal-session.ts": 'export const send = (text: string) => ({ type: "prompt", message: text, streamingBehavior: "followUp" });',
  }, findings => assert.ok(findings.some(value => value.rule === "principal-turn-owner" && value.file === "packages/engine/src/principal-session.ts")));
  withTree({
    "packages/engine/src/principal-session.ts": 'export const send = (text: string) => ({ type: "prompt", message: text, ["streamingBehavior"]: "steer" });',
  }, findings => assert.ok(has(findings, "principal-turn-owner")));
  withTree({
    "packages/engine/src/pi-adapter.ts": 'export const key = "streamingBehavior";',
  }, findings => assert.ok(has(findings, "principal-turn-owner")));
});

test("principal-session-env and principal-secret-env: the environment survives every hop, and the secret has none", () => {
  const producer = (extra = "") => `
export function principalEnvironment(paths, profile, limits) {
  return {
    HOME: "/h",
    OMA_SOCKET: "/s",
    OMA_FRAME_BYTES: "1",
    ${extra}
  };
}`;
  const consumer = `
export function socketPath() {
  // Only a caller given no endpoint reaches these, so they are not requirements.
  return process.env.OMA_SOCKET ?? \`/run/\${process.env.OMA_SOCIETY}/\${process.env.OMA_ACTOR}\`;
}
export async function callActor() {
  const frame = currentContext().env.OMA_FRAME_BYTES;
  return frame;
}`;
  // The forwarder, shaped as the real one is: the environment copied from the
  // engine for the tools' client.
  const tools = copied => `
const FRAME_BYTES = "OMA_FRAME_BYTES";
export function cliEnvironment(home, socket) {
  const environment = { HOME: home, OMA_SOCKET: socket, LANG: "C.UTF-8" };
  for (const name of [${copied}]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}`;
  const tree = ({ copied = "FRAME_BYTES", producerExtra = "" } = {}) => ({
    "packages/engine/src/principal-launch.ts": producer(producerExtra),
    "packages/client/src/settings.ts": consumer,
    "packages/extension/src/mail-tools.ts": tools(copied),
  });

  // Accept: everything the CLI reads at call time is put there by the
  // forwarder, and everything copied from the engine is set by the host.
  withTree(tree(), findings => clean(findings, "principal-session-env", "principal-secret-env"));

  // Reject: the tools stop copying the frame bound the CLI reads.
  withTree(tree({ copied: "" }), findings => {
    assert.ok(findings.some(value => value.rule === "principal-session-env" && value.reason.includes("OMA_FRAME_BYTES")));
  });
  // Reject: the tools copy a name from the engine that the host never sets.
  withTree({ ...tree(), "packages/extension/src/mail-tools.ts": tools("FRAME_BYTES, \"OMA_NEVER_SET\"") }, findings => {
    assert.ok(findings.some(value => value.rule === "principal-session-env" && value.reason.includes("OMA_NEVER_SET")));
  });

  // Reject: the credential or the session handle given an environment name,
  // anywhere in the source -- as a key the host sets, or a name a reader reads.
  withTree(tree({ producerExtra: 'OMA_PRINCIPAL_CREDENTIAL: "x",' }), findings => {
    assert.ok(findings.some(value => value.rule === "principal-secret-env" && value.file === "packages/engine/src/principal-launch.ts"));
  });
  withTree({ ...tree(), "apps/oma/src/cli/extra.ts": 'export const read = () => process.env["OMA_PRINCIPAL_SESSION"];' }, findings => {
    assert.ok(findings.some(value => value.rule === "principal-secret-env" && value.file === "apps/oma/src/cli/extra.ts"));
  });

  // Near miss: the removed descriptor's name shares the prefix and is not a
  // secret -- the rule distinguishes a descriptor number from the credential.
  withTree({ ...tree(), "apps/oma/src/cli/extra.ts": 'export const read = () => process.env["OMA_PRINCIPAL_CREDENTIAL_FD"];' },
    findings => assert.ok(!findings.some(value => value.rule === "principal-secret-env")));
  // Near miss: names the consumer reads only to derive an endpoint are not
  // requirements of a caller that was given one.
  withTree(tree(), findings => {
    for (const value of findings.filter(entry => entry.rule === "principal-session-env"))
      assert.doesNotMatch(value.reason, /OMA_ACTOR|OMA_SOCIETY/);
  });
  // Near miss: a tree without these files is not a violation.
  withTree({ "packages/engine/src/principal-launch.ts": "export const a = 1;" },
    findings => clean(findings, "principal-session-env", "principal-secret-env"));
});

test("host-loss-signals (AV31, P0V-81): a process with a drain takes it on every termination signal, from the one list", () => {
  const owner = list => ({ "packages/domain/src/host-signals.ts": `export const HOST_LOSS_SIGNALS = Object.freeze([${list}] as const);
export function stopOnHostLoss(stop, target = process) { for (const signal of HOST_LOSS_SIGNALS) target.once(signal, stop); }` });
  const full = '"SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"';
  const entry = body => ({ "apps/oma/src/entry/runner.ts": `import { HOST_LOSS_SIGNALS, stopOnHostLoss } from "../process/host-loss.js";\n${body}` });
  // Accept: the helper, or a loop over the list.
  withTree({ ...owner(full), ...entry("stopOnHostLoss(() => {});") }, findings => clean(findings, "host-loss-signals"));
  withTree({ ...owner(full), ...entry("for (const signal of HOST_LOSS_SIGNALS) process.on(signal, () => {});") },
    findings => clean(findings, "host-loss-signals"));
  // Reject: one signal handled alone, anywhere -- here beside the list, too.
  withTree({ ...owner(full), ...entry('stopOnHostLoss(() => {}); process.on("SIGHUP", () => {});') }, findings => {
    assert.ok(findings.some(value => value.rule === "host-loss-signals" && value.reason.includes("handles SIGHUP alone")));
  });
  withTree({ ...owner(full), "apps/oma/src/platform/x.ts": 'process.once("SIGQUIT", () => {});' }, findings => {
    assert.ok(findings.some(value => value.rule === "host-loss-signals" && value.file === "apps/oma/src/platform/x.ts"));
  });
  // Reject: a process with a drain that takes none of it.
  withTree({ ...owner(full), ...entry("const stop = () => {};") }, findings => {
    assert.ok(findings.some(value => value.rule === "host-loss-signals" && value.file === "apps/oma/src/entry/runner.ts" && value.reason.includes("has a drain")));
  });
  // The birth router has no acquired runtime to drain. Its selected owners do.
  withTree({ ...owner(full), "apps/oma/src/entry/oma.ts": 'export const choose = () => import("./oma-society.js");' },
    findings => clean(findings, "host-loss-signals"));
  for (const file of ["apps/oma/src/entry/oma-society.ts", "apps/oma/src/runtime/personal-session.ts", "packages/tui/src/session-mode.ts"]) {
    withTree({ ...owner(full), [file]: "const stop = () => {};" }, findings => {
      assert.ok(findings.some(value => value.rule === "host-loss-signals" && value.file === file && value.reason.includes("has a drain")));
    });
    withTree({ ...owner(full), [file]: "for (const signal of HOST_LOSS_SIGNALS) process.on(signal, () => {});" },
      findings => clean(findings, "host-loss-signals"));
  }
  // Reject: the list lost a termination signal.
  withTree({ ...owner('"SIGTERM", "SIGINT", "SIGHUP"'), ...entry("stopOnHostLoss(() => {});") }, findings => {
    assert.ok(findings.some(value => value.rule === "host-loss-signals" && value.file === "packages/domain/src/host-signals.ts" && value.reason.includes("SIGQUIT")));
  });
  // Near miss: signalling a child, and other process events, are not handling one.
  withTree({ ...owner(full), ...entry('stopOnHostLoss(() => {}); child.kill("SIGTERM"); process.on("uncaughtException", () => {}); process.on("SIGWINCH", () => {});') },
    findings => clean(findings, "host-loss-signals"));
});

test("utf8-decoder-owner (P0V-86): UTF-8 is read through one owner, which keeps a U+FEFF and refuses malformed bytes", () => {
  const owner = options => ({ "packages/domain/src/utf8.ts": `export function utf8Decoder() { return new TextDecoder("utf-8", ${options}); }` });
  withTree({ ...owner("{ fatal: true, ignoreBOM: true }"), "packages/extension/src/not-the-owner.ts": 'import { decodeUtf8 } from "@oma/domain/utf8";' },
    findings => clean(findings, "utf8-decoder-owner"));
  // Reject: a decoder of its own, anywhere else -- the default strips a BOM.
  withTree({ ...owner("{ fatal: true, ignoreBOM: true }"), "packages/protocol/src/frame.ts": 'const utf8 = new TextDecoder("utf-8", { fatal: true });' }, findings => {
    assert.ok(findings.some(value => value.rule === "utf8-decoder-owner" && value.file === "packages/protocol/src/frame.ts"));
  });
  // Reject: the owner itself drops either property.
  for (const options of ["{ fatal: true }", "{ ignoreBOM: true }", "{ fatal: false, ignoreBOM: true }", ""])
    withTree(owner(options), findings => {
      assert.ok(findings.some(value => value.rule === "utf8-decoder-owner" && value.file === "packages/domain/src/utf8.ts"), options);
    });
  // Near miss: an encoder, and a decoder's name in a comment, are not decoders.
  withTree({ ...owner("{ fatal: true, ignoreBOM: true }"), "apps/oma/src/x.ts": "// new TextDecoder()\nconst e = new TextEncoder();" },
    findings => clean(findings, "utf8-decoder-owner"));
});

test("error-words-owner (DR18, D-1): an error's words on the product surface come from one reading", () => {
  const words = { "packages/domain/src/errors.ts": "export function exceptionText(error) { return error instanceof Error ? error.message : String(error); }" };
  withTree({ ...words, "apps/oma/src/entry/oma.ts": "try { f(); } catch (error) { fail(exceptionText(error)); }",
    "packages/engine/src/principal-session.ts": "const message = event.message;" }, findings => clean(findings, "error-words-owner"));
  // Reject: each way a file reads a thrown value's words itself.
  for (const [file, text] of [
    ["apps/oma/src/entry/oma.ts", "try { f(); } catch (error) { fail(error instanceof Error ? 'x' : 'y'); }"],
    ["apps/oma/src/entry/oma-society.ts", "try { f(); } catch (error) { fail(String(error)); }"],
    ["packages/tui/src/app.ts", "const text = failure.message;"],
    ["apps/oma/src/application/mail.ts", "try { f(); } catch (error) { note(String(error)); }"],
    ["packages/tui/src/prompt.ts", "const text = result.message;"],
  ])
    withTree({ ...words, [file]: text }, findings => {
      assert.ok(findings.some(value => value.rule === "error-words-owner" && value.file === file), `${file}: ${text}`);
    });
  // Near miss: the views only lay out passed words; String() of a value that
  // was not caught is not an error's words.
  withTree({ ...words, "packages/tui/src/view/notice.ts": "const text = notice.message;", "packages/tui/src/app.ts": "const n = String(count);" },
    findings => clean(findings, "error-words-owner"));
});

test("no-open-spike (DR18): nothing in v1 throws SPIKE_UNRESOLVED; a known unsupported setting is UNSUPPORTED_PROFILE", () => {
  withTree({ "apps/oma/src/git/a.ts": 'throw new StoreError("UNSUPPORTED_PROFILE", "x"); const gated = reason === "SPIKE_UNRESOLVED"; // OMA_ERROR=SPIKE_UNRESOLVED' },
    findings => clean(findings, "no-open-spike"));
  for (const text of ['throw new StoreError("SPIKE_UNRESOLVED", "x");', 'const s = "fail() { echo OMA_ERROR=SPIKE_UNRESOLVED >&2; }";'])
    withTree({ "apps/oma/src/git/a.ts": text }, findings => {
      assert.ok(findings.some(value => value.rule === "no-open-spike" && value.file === "apps/oma/src/git/a.ts"), text);
    });
});

test("socket-callback-effects (P0V-104): a data callback makes no synchronous file effect outside a try", () => {
  withTree({ "apps/oma/src/platform/receive.ts": `const take = chunk => { try { writeSync(fd, chunk); } catch (error) { fail(error); } };
socket.on("data", take);
socket.on("data", chunk => { try { fsyncSync(fd); } catch (e) { reject(e); } });
socket.on("data", chunk => reader.push(chunk));` }, findings => clean(findings, "socket-callback-effects"));
  for (const text of [
    'socket.on("data", chunk => { writeSync(fd, chunk); });',
    'const take = chunk => { for (let at = 0; at < chunk.length;) at += writeSync(fd, chunk, at, chunk.length - at); };\nsocket.on("data", take);',
    'function take(chunk) { fsyncSync(fd); }\nsocket.once("data", take);',
    'class R { onData = chunk => { unlinkSync(path); }; start() { socket.on("data", this.onData); } }',
    'socket.on("data", chunk => { try { ok(); } finally { closeSync(fd); } });',
  ])
    withTree({ "apps/oma/src/platform/receive.ts": text }, findings => {
      assert.ok(findings.some(value => value.rule === "socket-callback-effects"), text);
    });
  // Near miss: an effect in another event's callback, or in a function the callback does not name.
  withTree({ "apps/oma/src/platform/receive.ts": 'socket.on("end", () => { closeSync(fd); });\nconst other = () => { writeSync(fd, b); };' },
    findings => clean(findings, "socket-callback-effects"));
});

test("DR46: moved LSP sources keep the verified deferred-load and extension closure rules", () => {
  const file = "packages/tool-lsp/src/index.ts";
  for (const text of [
    'import { LspClient } from "./vendor/pi-lsp/runtime/lsp-client.js";',
    'export { LspClient } from "./vendor/pi-lsp/runtime/lsp-client.js";',
    'export const load = (name: string) => import(`./vendor/pi-lsp/runtime/${name}.js`);',
    'export const load = () => import("./internal.js");',
  ]) withTree({ [file]: text }, findings => assert.ok(has(findings, "extension-dynamic-load"), text));
  withTree({ [file]: 'export const load = () => import("./vendor/pi-lsp/runtime/lsp-client.js");' },
    findings => assert.ok(!has(findings, "extension-dynamic-load")));
  withTree({ [file]: 'import type { Store } from "../../storage/src/store.js";' },
    findings => assert.ok(has(findings, "extension-closure")));
});
