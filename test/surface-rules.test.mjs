// Fixtures for the surface rules: for each rule, a tree it must accept, a tree
// it must reject, and a near miss it must not mistake for a violation.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
/** Accept cases assert only the rules under test: a fixture file present for
 * one rule may legitimately lack what another rule requires of the real tree. */
const clean = (findings, ...under) => assert.deepEqual(findings.filter(value => under.includes(value.rule)), []);

test("extension-closure: the extension imports only built-ins, the engine API, typebox and itself", () => {
  withTree({
    "src/pi-extension.ts": 'import { readFileSync } from "node:fs"; import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"; import { a } from "./extension/a.js";',
    "src/extension/a.ts": 'import { Type } from "typebox"; export const a = Type;',
  }, findings => assert.deepEqual(findings, []));
  withTree({
    "src/pi-extension.ts": 'import { StoreError } from "./domain/errors.js";',
    "src/domain/errors.ts": "export class StoreError {}",
  }, findings => assert.ok(has(findings, "extension-closure")));
  withTree({
    "src/extension/a.ts": 'import leftPad from "left-pad";',
  }, findings => assert.ok(has(findings, "extension-closure")));
  // Only the entry composes the extension; nothing else in src reaches in.
  withTree({
    "src/extension/a.ts": "export const a = 1;",
    "src/runner.ts": 'import { a } from "./extension/a.js";',
  }, findings => assert.ok(has(findings, "extension-closure")));
});

test("extension-dynamic-load and extension-execute: no run-time loading, no invoking a tool handler", () => {
  // Near miss: defining an execute handler is not invoking one.
  withTree({
    "src/extension/tools.ts": "export const tool = { async execute() { return 1; } };",
  }, findings => assert.deepEqual(findings, []));
  withTree({ "src/extension/a.ts": 'export const load = () => import("./b.js");' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  withTree({ "src/extension/a.ts": 'export const load = () => require("x");' },
    findings => assert.ok(has(findings, "extension-dynamic-load")));
  withTree({ "src/extension/a.ts": "export const run = (tool: any) => tool.execute();" },
    findings => assert.ok(has(findings, "extension-execute")));
  withTree({ "src/extension/a.ts": "export const run = (tool: any) => tool.execute.call(tool);" },
    findings => assert.ok(has(findings, "extension-execute")));
});

test("engine-primitive-owner: one owner per borrowed primitive, and no borrowed layout", () => {
  withTree({
    "src/tui/view/text.ts": 'import { visibleWidth } from "@earendil-works/pi-tui"; export const w = visibleWidth;',
    "src/tui/keys.ts": 'import { parseKey } from "@earendil-works/pi-tui"; export const k = parseKey;',
  }, findings => assert.deepEqual(findings, []));
  withTree({ "src/tui/view/text.ts": 'import { truncateToWidth } from "@earendil-works/pi-tui";' },
    findings => assert.ok(has(findings, "engine-primitive-owner")));
  withTree({ "src/tui/screen.ts": 'import { visibleWidth } from "@earendil-works/pi-tui";' },
    findings => assert.ok(has(findings, "engine-primitive-owner")));
  withTree({ "src/tui/session.ts": 'import type { X } from "@earendil-works/pi-coding-agent";' },
    findings => assert.ok(has(findings, "engine-primitive-owner")));
});

test("tui-view-boundary: the view sees only data, and only the app draws through the seam", () => {
  withTree({
    "src/tui/view/index.ts": 'export { render } from "./screens.js";',
    "src/tui/view/screens.ts": 'import type { State } from "../model.js"; export const render = (s: State) => s;',
    "src/tui/model.ts": "export interface State { open: boolean }",
    "src/tui/app.ts": 'import { render } from "./view/index.js";',
  }, findings => clean(findings, "tui-view-boundary"));
  withTree({ "src/tui/view/screens.ts": 'import { readFileSync } from "node:fs";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "src/tui/view/screens.ts": 'import { readMailbox } from "../sources/mail.js";', "src/tui/sources/mail.ts": "export const readMailbox = 1;" },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "src/tui/view/text.ts": "export const fit = 1;", "src/tui/app.ts": 'import { fit } from "./view/text.js";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
  withTree({ "src/tui/view/index.ts": "export const render = 1;", "src/entry/oma.ts": 'import { render } from "../tui/view/index.js";' },
    findings => assert.ok(has(findings, "tui-view-boundary")));
});

test("tui-write-owner, tui-ledger, tui-transport-owner, tui-internal-method", () => {
  withTree({
    "src/tui/sources/settings.ts": 'import { replaceDerivedFile } from "../../storage/durable-fs.js"; replaceDerivedFile("a", "b");',
    "src/tui/transport.ts": 'import type { ChannelLimits } from "../protocol/channel.js";',
  }, findings => clean(findings, "tui-write-owner", "tui-ledger", "tui-transport-owner", "tui-internal-method"));
  withTree({ "src/tui/sources/mail.ts": 'import { renameSync } from "node:fs"; renameSync("a", "b");' },
    findings => assert.ok(has(findings, "tui-write-owner")));
  // Near miss: writing to a terminal stream is not a filesystem write.
  withTree({ "src/tui/screen.ts": 'export const draw = (out: { write(t: string): void }) => out.write("x");' },
    findings => clean(findings, "tui-write-owner", "tui-ledger", "tui-transport-owner", "tui-internal-method"));
  withTree({ "src/tui/app.ts": 'import { Store } from "../store.js";', "src/store.ts": "export class Store {}" },
    findings => assert.ok(has(findings, "tui-ledger")));
  withTree({ "src/tui/app.ts": 'import { BrokerChannel } from "../protocol/channel.js";', "src/protocol/channel.ts": "export class BrokerChannel {}" },
    findings => assert.ok(has(findings, "tui-transport-owner")));
  withTree({
    "src/protocol/methods.ts": 'export const INTERNAL_METHODS = { "host.reconcile": {} } as const;',
    "src/tui/transport.ts": 'export const call = "host.reconcile";',
  }, findings => assert.ok(has(findings, "tui-internal-method")));
  // Near miss: the name in a comment is prose, not a call.
  withTree({
    "src/protocol/methods.ts": 'export const INTERNAL_METHODS = { "host.reconcile": {} } as const;',
    "src/tui/transport.ts": "// never calls host.reconcile\nexport const x = 1;",
  }, findings => clean(findings, "tui-write-owner", "tui-ledger", "tui-transport-owner", "tui-internal-method"));
});

test("product-cli-separation and resident-product-surface: closures do not cross", () => {
  withTree({
    "src/entry/oma.ts": 'import { a } from "../tui/app.js";', "src/tui/app.ts": "export const a = 1;",
    "src/cli.ts": 'import { b } from "./cli/effects.js";', "src/cli/effects.ts": "export const b = 1;",
    "src/entry/runner.ts": 'import { c } from "../runner.js";', "src/runner.ts": "export const c = 1;",
  }, findings => clean(findings, "product-cli-separation", "resident-product-surface"));
  withTree({ "src/entry/oma.ts": 'import { parse } from "../cli/arguments.js";', "src/cli/arguments.ts": "export const parse = 1;" },
    findings => assert.ok(has(findings, "product-cli-separation")));
  withTree({ "src/cli.ts": 'import { a } from "./tui/app.js";', "src/tui/app.ts": "export const a = 1;" },
    findings => assert.ok(has(findings, "product-cli-separation")));
  withTree({ "src/entry/runner.ts": 'const entry = "dist/src/entry/oma.js";' },
    findings => assert.ok(has(findings, "resident-product-surface")));
  // Near miss: a type-only import is erased and carries nothing at run time.
  withTree({ "src/entry/runner.ts": 'import type { State } from "../tui/model.js";', "src/tui/model.ts": "export interface State {}" },
    findings => clean(findings, "product-cli-separation", "resident-product-surface"));
  // The deployment layout names the product surface to hide it; that is allowed.
  withTree({ "src/entry/runner.ts": 'import { L } from "../domain/deployment.js";', "src/domain/deployment.ts": 'export const L = ["dist/src/tui"];' },
    findings => clean(findings, "product-cli-separation", "resident-product-surface"));
});

test("product-pi-command and model-surface-product-words", () => {
  withTree({ "src/tui/app.ts": 'export const hint = "run pi install";' },
    findings => assert.ok(has(findings, "product-pi-command")));
  withTree({ "src/cli/exit.ts": 'export const usage = "press Ctrl+X";' },
    findings => assert.ok(has(findings, "model-surface-product-words")));
  // Near miss: the same words in a comment are not shown to anyone.
  withTree({ "src/cli/exit.ts": "// the host has a Control Panel (Ctrl+X)\nexport const usage = \"usage\";" },
    findings => assert.deepEqual(findings, []));
});

test("product-bare-error and product-undeclared-bound", () => {
  withTree({ "src/tui/app.ts": 'throw new Error("x");' }, findings => assert.ok(has(findings, "product-bare-error")));
  withTree({ "src/tui/app.ts": "export const width = 80;" }, findings => assert.ok(has(findings, "product-undeclared-bound")));
  // Code inside a template expression is still code.
  withTree({ "src/tui/app.ts": "export const id = (h: string) => `r-${h.slice(0, 32)}`;" },
    findings => assert.ok(has(findings, "product-undeclared-bound")));
  // Near misses: a declaration file, a byte identity, a file mode, a small index.
  withTree({
    "src/tui/limits.ts": "export const W = 80;",
    "src/tui/keys.ts": "export const esc = String.fromCharCode(27); export const csi = 0x5b; export const mode = 0o600; export const i = 3;",
    "src/tui/app.ts": 'export const label = "80 columns";',
  }, findings => clean(findings, "product-bare-error", "product-undeclared-bound"));
});

test("user-pi-state: the user's home and Pi state are never named", () => {
  withTree({ "src/runtime/pi-runtime.ts": 'import { homedir } from "node:os"; export const h = homedir();' },
    findings => assert.ok(has(findings, "user-pi-state")));
  withTree({ "src/entry/oma.ts": 'export const dir = "/home/u/.pi/agent";' },
    findings => assert.ok(has(findings, "user-pi-state")));
  // Near miss: OMA's own agent directory is named "pi", not ".pi".
  withTree({ "src/runtime/pi-runtime.ts": 'import { join } from "node:path"; export const dir = (s: string) => join(s, "pi"); export const f = "x.pie";' },
    findings => assert.deepEqual(findings, []));
});

test("settings-placement-owner, closed-switch and module-port-import", () => {
  withTree({
    "src/tui/sources/settings.ts": "const PLACEMENT = {}; export function f(field: string) { switch (field) { default: return PLACEMENT; } }",
    "src/tui/app.ts": 'import { assertNever } from "../domain/exhaustive.js"; export function run(effect: { kind: "a" }) { switch (effect.kind) { case "a": return; default: return assertNever(effect); } }',
  }, findings => assert.deepEqual(findings, []));
  withTree({ "src/tui/sources/settings.ts": "export function f(field: string) { switch (field) {} switch (field) {} }" },
    findings => assert.ok(has(findings, "settings-placement-owner")));
  withTree({ "src/tui/app.ts": 'export function run(effect: { kind: "a" }) { switch (effect.kind) { case "a": return; } }' },
    findings => assert.ok(has(findings, "closed-switch")));
  // Near miss: assertNever over some other value does not close this switch.
  withTree({ "src/tui/app.ts": 'declare const assertNever: (x: never) => never; declare const other: never; export function run(effect: { kind: "a" }) { switch (effect.kind) { default: return assertNever(other); } }' },
    findings => assert.ok(has(findings, "closed-switch")));
  withTree({ "src/broker/public-dispatcher.ts": 'import { Store } from "../store.js";', "src/store.ts": "export class Store {}" },
    findings => assert.ok(has(findings, "module-port-import")));
  withTree({ "src/cli.ts": 'import { m } from "./mail.js";', "src/mail.ts": "export const m = 1;" },
    findings => assert.ok(has(findings, "module-port-import")));
});

test("principal-session-env: the session environment survives producer, forwarder and consumer", () => {
  const producer = (extra = "") => `
import { PRINCIPAL_CREDENTIAL_ENV } from "../protocol/principal-credential.js";
export function principalEnvironment(paths, profile, limits, session) {
  return {
    HOME: "/h",
    OMA_SOCKET: "/s",
    OMA_FRAME_BYTES: "1",
    OMA_PRINCIPAL_SESSION: session.sessionHandle,
    ${extra}
    ...(session.credential === null ? {} : { [PRINCIPAL_CREDENTIAL_ENV]: session.credential }),
  };
}`;
  const consumer = `
import { PRINCIPAL_CREDENTIAL_ENV } from "../protocol/principal-credential.js";
export function socketPath() {
  // Only a caller given no endpoint reaches these, so they are not requirements.
  return process.env.OMA_SOCKET ?? \`/run/\${process.env.OMA_SOCIETY}/\${process.env.OMA_ACTOR}\`;
}
export async function callActor() {
  const frame = process.env.OMA_FRAME_BYTES;
  const credential = process.env[PRINCIPAL_CREDENTIAL_ENV];
  const handle = process.env.OMA_PRINCIPAL_SESSION;
  return [frame, credential, handle];
}`;
  const constants = 'export const PRINCIPAL_CREDENTIAL_ENV = "OMA_PRINCIPAL_CREDENTIAL";';
  const forwarder = names => `
const PRINCIPAL_CREDENTIAL = "OMA_PRINCIPAL_CREDENTIAL";
const PRINCIPAL_SESSION = "OMA_PRINCIPAL_SESSION";
const FRAME_BYTES = "OMA_FRAME_BYTES";
export function cliEnvironment(home, socket) {
  const entries = [\`HOME=\${home}\`, \`OMA_SOCKET=\${socket}\`, "LANG=C.UTF-8"];
  for (const name of [${names}]) {
    const value = process.env[name];
    if (value !== undefined) entries.push(\`\${name}=\${value}\`);
  }
  return entries;
}`;
  const tree = (forwardList, producerExtra = "") => ({
    "src/tui/session.ts": producer(producerExtra),
    "src/cli/transport.ts": consumer,
    "src/protocol/principal-credential.ts": constants,
    "src/extension/mail-tools.ts": forwarder(forwardList),
  });

  // Accept: every name the CLI reads at call time is forwarded, and every
  // forwarded name is one the host actually sets.
  withTree(tree("FRAME_BYTES, PRINCIPAL_CREDENTIAL, PRINCIPAL_SESSION"),
    findings => clean(findings, "principal-session-env"));

  // Reject: the exact defect this rule exists for -- the tools rebuild the
  // environment without the credential, so every OMA tool fails to attach
  // while nothing in the producer or the consumer looks wrong.
  withTree(tree("FRAME_BYTES"), findings => {
    assert.ok(has(findings, "principal-session-env"));
    assert.ok(findings.some(value => value.reason.includes("OMA_PRINCIPAL_CREDENTIAL")));
    assert.ok(findings.some(value => value.reason.includes("OMA_PRINCIPAL_SESSION")));
  });

  // Reject the other direction: a name forwarded to the CLI that the Principal's
  // environment never sets is a requirement nobody meets.
  withTree({
    ...tree("FRAME_BYTES, PRINCIPAL_CREDENTIAL, PRINCIPAL_SESSION"),
    "src/extension/mail-tools.ts": `${forwarder("FRAME_BYTES, PRINCIPAL_CREDENTIAL, PRINCIPAL_SESSION")}
const UNSET = "OMA_NEVER_SET";
export function alsoForwards() { return [\`\${UNSET}=x\`]; }`,
  }, findings => clean(findings, "principal-session-env"));

  // Near miss: names the consumer reads only to derive an endpoint when it was
  // given none are not requirements of a caller that was given one.
  withTree(tree("FRAME_BYTES, PRINCIPAL_CREDENTIAL, PRINCIPAL_SESSION"), findings => {
    for (const value of findings.filter(entry => entry.rule === "principal-session-env"))
      assert.doesNotMatch(value.reason, /OMA_ACTOR|OMA_SOCIETY/);
  });

  // Near miss: an unrelated tree without these files is not a violation.
  withTree({ "src/tui/session.ts": "export const a = 1;" },
    findings => clean(findings, "principal-session-env"));
});
