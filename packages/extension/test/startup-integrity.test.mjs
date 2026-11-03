/** AUD-21: a rejected bundled payload's reason is what startup says.
 *
 * The core extension registers the tool surface and four fail-closed bundle
 * adapters in one load. Pi dispatches session_start handlers in registration
 * order, and a handler that refuses exits the process -- so a surface plan,
 * which names the bundled tools and cannot admit what a rejected bundle left
 * unregistered, used to make the surface's own consequence the only thing the
 * operator ever read. These cases start the real composition: the first with
 * one added byte in a copied pi-web-access payload (the audit's repro shape),
 * the second with the payload intact under the real Worker surface plan.
 *
 * This is not an end-to-end engine run: the child supplies Pi's own dispatch
 * semantics (ExtensionRunner.emit -- every handler awaited in registration
 * order, a handler's throw recorded and dispatch continuing) and nothing else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, appendFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collaborationSurface } from "@oma/domain/collaboration-surface";

const WEB_TOOLS = ["web_search", "source_check", "fetch_content", "get_search_content"];
/** Only LSP/web members wait for a cumulative entry in collaboration-v1. */
const OPTIONAL_ONLY = [...WEB_TOOLS, "lsp_status", "lsp_diagnostics", "lsp_fix"];
const EXPECTED_INITIAL = ["oma_send", "oma_spawn", "oma_merge", "oma_challenge", "oma_review", "oma_wait", "oma_follow",
  "read", "write", "replace", "insert", "replace_within", "grep", "find", "ls", "bash", "mcp", "lsp_tools", "web_tools"];
const EXTENSION_PACKAGE = dirname(dirname(fileURLToPath(import.meta.resolve("@oma/extension"))));
const ROOT = dirname(dirname(EXTENSION_PACKAGE));
const RESULT_PREFIX = "__OMA_AUD21__";

/** A tree the copied extension resolves its bare imports through: every
 * product dependency, with @oma/tool-web replaced by the owner under test. */
function harness(t, label, { tamper }) {
  const dir = mkdtempSync(join(tmpdir(), `oma-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "harness", "node_modules", "@oma"), { recursive: true });
  for (const entry of readdirSync(join(ROOT, "node_modules"))) {
    if (entry === "@oma") {
      for (const scoped of readdirSync(join(ROOT, "node_modules", "@oma")))
        if (scoped !== "tool-web")
          symlinkSync(join(ROOT, "node_modules", "@oma", scoped), join(dir, "harness", "node_modules", "@oma", scoped));
    } else symlinkSync(join(ROOT, "node_modules", entry), join(dir, "harness", "node_modules", entry));
  }
  const owner = join(dir, "web");
  if (tamper) {
    mkdirSync(owner);
    cpSync(join(ROOT, "packages/tool-web/dist"), join(owner, "dist"), { recursive: true });
    cpSync(join(ROOT, "packages/tool-web/package.json"), join(owner, "package.json"));
    symlinkSync(join(ROOT, "node_modules"), join(owner, "node_modules"));
    // One added byte in an owned member, in the shape the product's own
    // owner-binding oracle uses: its evaluation would be visible.
    appendFileSync(join(owner, "dist", "vendor", "pi-web-access", "runtime", "utils.js"),
      "\nglobalThis.__OMA_WEB_PAYLOAD_EVALUATED__ = true;\n");
  }
  symlinkSync(tamper ? owner : join(ROOT, "packages", "tool-web"),
    join(dir, "harness", "node_modules", "@oma", "tool-web"));
  cpSync(join(EXTENSION_PACKAGE, "dist"), join(dir, "harness", "extension", "dist"), { recursive: true });
  cpSync(join(EXTENSION_PACKAGE, "package.json"), join(dir, "harness", "extension", "package.json"));
  for (const sub of ["workspace", "state", "archive", "records"]) mkdirSync(join(dir, sub), { recursive: true });
  return { dir, entry: join(dir, "harness", "extension", "dist", "index.js") };
}

const CHILD = `
import { fileURLToPath, pathToFileURL } from "node:url";
const [entry, workspace] = process.argv.slice(1);
process.chdir(workspace);
const entryUrl = pathToFileURL(entry).href;
const out = process.stdout.write.bind(process.stdout);
const realStderr = process.stderr.write.bind(process.stderr);
const stderr = [];
process.stderr.write = chunk => { stderr.push(String(chunk).trimEnd()); return true; };
const tools = new Map(), hooks = new Map();
let active = [];
const ownPath = fileURLToPath(entryUrl);
const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  on(event, handler) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
  events: { on() {}, off() {}, emit() { return false; } },
  registerCommand() {}, registerShortcut() {}, registerFlag() {}, getFlag() {},
  getActiveTools: () => [...active],
  setActiveTools: names => { active = [...names]; },
  getAllTools: () => [...tools.values()].map(tool => ({ name: tool.name, parameters: tool.parameters,
    description: tool.description, sourceInfo: { source: "extension", path: ownPath } })),
  appendEntry() {}, sendMessage() {}, sendUserMessage() {},
  exec() { throw new Error("registration cannot execute a command"); },
};
const context = { cwd: workspace, hasUI: false, sessionManager: { getBranch: () => [] }, ui: { setStatus() {}, notify() {} } };
const exits = [], stop = new Error("captured refusal");
process.exit = code => { exits.push(code); throw stop; };
const extension = (await import(entryUrl)).default;
await extension(pi);
const atRegistration = stderr.length;
const sessionStart = hooks.get("session_start") ?? [];
const ran = [];
for (const [index, handler] of sessionStart.entries()) {
  ran.push(index);
  try { await handler({ type: "session_start", reason: "startup" }, context); }
  catch (error) { if (error === stop) break; }
  if (exits.length > 0) break;
}
process.stderr.write = realStderr;
out(process.env.OMA_AUD21_RESULT_PREFIX + JSON.stringify({ handlerCount: sessionStart.length, ran, atRegistration,
  exits, stderr, tools: [...tools.keys()], active, evaluated: globalThis.__OMA_WEB_PAYLOAD_EVALUATED__ === true }) + "\\n");
`;

/** Starts the real extension once, in a child process, under the Worker plan
 * (the deployment's own planner builds the plan the engine is handed). */
function start(t, label, options) {
  const { dir, entry } = harness(t, label, options);
  const env = { ...process.env, OMA_AUD21_RESULT_PREFIX: RESULT_PREFIX, OMA_VERIFIED_EXTENSIONS: JSON.stringify([entry]) };
  for (const name of ["OMA_HOST_CHANNEL", "OMA_TOOL_SCOPE", "OMA_PACKAGE_STORE", "OMA_INFERENCE_SOCKET",
    "OMA_EGRESS_PROXY_SOCKET", "OMA_EGRESS_PROXY_PORT"])
    delete env[name];
  Object.assign(env, {
    PI_CODING_AGENT_DIR: join(dir, "state"), OMA_AGENT_HOME: join(dir, "workspace"),
    OMA_SOCKET: join(dir, "state", "control.sock"), OMA_MAIL_ARCHIVE: join(dir, "archive"),
    OMA_ACTOR: "installedworker",
    OMA_RECORD_ROOT: join(dir, "records"),
    OMA_MAIL_ADDRESSES: "64",
    OMA_TOOL_SURFACE: Object.hasOwn(options, "surface") ? options.surface : JSON.stringify(collaborationSurface("resident")),
  });
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD, entry, join(dir, "workspace")],
    { encoding: "utf8", timeout: 300000, killSignal: "SIGKILL", env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null, "the startup child was not killed by the harness deadline");
  const observed = result.stdout.split("\n").find(line => line.startsWith(RESULT_PREFIX));
  assert.ok(observed, `startup produced no result line: ${result.stderr}`);
  return JSON.parse(observed.slice(RESULT_PREFIX.length));
}

test("001. A rejected payload's own reason is the diagnostic startup refuses on", async (t) => {
  const observed = start(t, "aud21-rejected", { tamper: true });
  assert.deepEqual(observed.exits, [1], "the session is refused");
  assert.deepEqual(observed.tools.filter(name => WEB_TOOLS.includes(name)), [], "a rejected bundle registers no tool");
  assert.equal(observed.evaluated, false, "no byte of the rejected payload is evaluated");
  assert.equal(observed.atRegistration, 1, "the reason is stated before any session_start handler can exit the process");
  assert.equal(observed.stderr.length, 1, "the whole diagnostic output is the refusal's own reason");
  assert.match(observed.stderr[0], /pi-web-access payload failed integrity verification/);
  assert.match(observed.stderr[0], /runtime\/utils\.js/, "the reason names the member that changed");
});

test("002. The intact bundled surface still validates under the Worker plan", async (t) => {
  const observed = start(t, "aud21-intact", { tamper: false });
  assert.deepEqual(observed.exits, [], "a healthy startup has no refusal to make");
  assert.deepEqual(observed.stderr, [], "a healthy startup says nothing on the diagnostic stream");
  assert.deepEqual(observed.tools.filter(name => WEB_TOOLS.includes(name)), WEB_TOOLS,
    "the bundled web tools register in upstream's own order");
  assert.equal(observed.ran.length, observed.handlerCount, "every session_start handler ran");
  const registered = new Set(observed.tools);
  assert.ok(observed.active.length > 0, "the surface validated the plan against the registry the adapters filled");
  assert.ok(observed.active.every(name => registered.has(name)), "every admitted tool is one this load registered");
  assert.deepEqual([...observed.active].sort(), [...EXPECTED_INITIAL].sort(), "the actual catalog matches the independent collaboration Worker contract");
  assert.ok(observed.active.includes("lsp_tools") && observed.active.includes("web_tools"), "the cumulative entry tools are core");
  assert.equal(observed.tools.includes("toolset"), false, "the retired exact-selection runtime is absent");
  assert.deepEqual(observed.active.filter(name => OPTIONAL_ONLY.includes(name)), [],
    "no optional tool is exposed before a selection commits");
});

for (const [label, surface] of [["legacy", JSON.stringify({ version: 2, defaultMode: "DISABLED", direct: ["read"], optional: [], disabled: [] })],
  ["absent", undefined]]) test(`003. The actual extension composition refuses ${label} before registering tools or loading bundles`, t => {
  const observed = start(t, `retired-${label}`, { tamper: false, surface });
  assert.deepEqual(observed.exits, [1]);
  assert.deepEqual(observed.tools, []);
  assert.deepEqual(observed.active, []);
  assert.equal(observed.evaluated, false);
  assert.match(observed.stderr.join("\n"), /surface.*(unsupported|explicit|version)|unsupported.*surface/i);
});
