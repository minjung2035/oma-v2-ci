/** Actual SDK + core extension in a fresh process. No product Worker or live
 * provider is activated. Existing Mail/Store facts and an unresolved old journal
 * must survive refusal unchanged; the scripted HTTP provider must see no call. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "@oma/storage";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { scriptedProvider } from "./fixtures/scripted-provider.js";

const CHILD = String.raw`
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { sessionArgv } from "@oma/engine/principal-launch";
const workspace = process.env.OMA_RETIRE_WORKSPACE, agentDir = process.env.PI_CODING_AGENT_DIR;
process.chdir(workspace);
// The product's launch builder runs before the SDK can open or append to history.
// The explicit bypass is a negative control, not a supported execution path.
if (process.env.OMA_RETIRE_BYPASS !== "1") sessionArgv({ piCommand: process.execPath,
  coreExtension: process.env.OMA_RETIRE_EXTENSION, workspace, home: workspace,
  sessionDir: dirname(process.env.OMA_RETIRE_HISTORY), toolSurface: process.env.OMA_TOOL_SURFACE },
  { society: "demo", provider: "fake", model: "scripted", extensions: [] });
const runtime = await ModelRuntime.create({ authPath: agentDir + "/auth.json", modelsPath: agentDir + "/models.json",
  refreshOnCreate: false, allowModelNetwork: false });
const model = runtime.getModel("fake", "scripted");
if (!model) throw new Error("scripted model fixture missing");
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const core = (await import(pathToFileURL(process.env.OMA_RETIRE_EXTENSION).href)).default;
const resourceLoader = new DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  systemPrompt: "Refused sessions must never reach inference.", extensionFactories: [core] });
await resourceLoader.reload();
const { session } = await createAgentSession({ cwd: workspace, agentDir, modelRuntime: runtime,
  model, thinkingLevel: "off", tools: ["read"], settingsManager,
  sessionManager: SessionManager.open(process.env.OMA_RETIRE_HISTORY), resourceLoader });
await session.bindExtensions({ onError: error => { process.stderr.write(error.error + "\n"); } });
session.dispose();
process.stderr.write("UNEXPECTED_RETIREMENT_ADMISSION\n");
process.exit(77);
`;

function files(root: string, prefix = ""): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) for (const [name, bytes] of files(root, path)) result.set(name, bytes);
    else { assert.equal(entry.isFile(), true); result.set(path, readFileSync(join(root, path))); }
  }
  return result;
}

for (const [label, raw, bypass] of [["version-2", JSON.stringify({ version: 2, defaultMode: "DISABLED", direct: ["read"], optional: [], disabled: [] }), false],
  ["absent", undefined, false], ["malformed", "{", false], ["late-extension-only negative control", JSON.stringify({ version: 2 }), true]] as const) {
  test(`001. Fresh SDK process: ${label}; no inference, accepted facts unchanged, ${bypass ? "late guard demonstrably appends SDK metadata" : "launch refusal preserves pending history"}`, { timeout: 30_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-retired-sdk-")), data = join(root, "data"), workspace = join(root, "workspace");
    mkdirSync(data); mkdirSync(workspace);
    const provider = await scriptedProvider();
    let store: Store | undefined;
    try {
      const agentDir = join(root, "agent"); provider.configure(agentDir);
      store = new Store(join(data, "runtime.sqlite"));
      store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob")); });
      const mail = createMailModule({ stateRoot: data, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS);
      const receipt = await mail.send({ actor: "alice", incarnation: 1, role: "resident", channel: "actor",
        capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } },
      "original-accepted", { to: ["bob"], subject: "Retained accepted fact", kind: "message", body: "\ufefforiginal\r\n" });
      assert.equal(receipt.state, "succeeded");
      const operation = store.getOperation("alice", "original-accepted"); assert.ok(operation);
      store.close(); store = undefined;
      const manager = SessionManager.create(workspace, join(data, "history"));
      manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "old-pending", name: "toolset", arguments: { select: ["web_search"] } }],
        api: "openai-completions", provider: "openai", model: "historical-fixture", stopReason: "toolUse", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
      manager.appendCustomEntry("oma-toolset", { version: 1, select: ["web_search"] });
      const history = manager.getSessionFile(); assert.ok(history);
      const before = files(data);
      const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir, OMA_AGENT_HOME: workspace, OMA_MAIL_ARCHIVE: join(data, "mail", "archive", "cur"),
        OMA_SOCKET: join(data, "control.sock"), OMA_ACTOR: "alice", OMA_RETIRE_WORKSPACE: workspace,
        OMA_RETIRE_HISTORY: history, OMA_RETIRE_EXTENSION: new URL(import.meta.resolve("@oma/extension")).pathname,
        OMA_TOOL_SURFACE: raw, OMA_RETIRE_BYPASS: bypass ? "1" : "0" };
      delete env.OMA_HOST_CHANNEL;
      const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); }); child.stdout.resume();
      const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 20_000);
      let code: number | null, signal: NodeJS.Signals | null;
      try { [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null]; }
      finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
      assert.equal(signal, null, stderr); assert.equal(code, 1, stderr);
      assert.match(stderr, /tool surface.*(unsupported|explicit)|unsupported tool surface version/);
      assert.doesNotMatch(stderr, /UNEXPECTED_RETIREMENT_ADMISSION/);
      assert.equal(provider.seen.length, 0, "the actual SDK must refuse before asking the provider");
      const after = files(data);
      if (bypass) {
        const name = join("history", history.slice(history.lastIndexOf("/") + 1)), original = before.get(name)!;
        const observed = after.get(name)!;
        assert.deepEqual(observed.subarray(0, original.length), original, "even the negative control retains the original pending call");
        const extra = observed.subarray(original.length).toString("utf8").trim().split("\n").map(line => JSON.parse(line) as { type: string });
        assert.deepEqual(extra.map(entry => entry.type), ["thinking_level_change"], "prove that SDK construction precedes the late extension refusal");
        after.set(name, original);
      }
      assert.deepEqual(after, before, "launch refusal preserves all DB/mail/journal bytes and creates no new artifact; control differs only by SDK metadata");
      store = new Store(join(data, "runtime.sqlite"));
      assert.deepEqual(store.getOperation("alice", "original-accepted"), operation);
      assert.deepEqual(receiptOfOperation(store.getOperation("alice", "original-accepted")!), receipt);
    } finally { store?.close(); await provider.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
