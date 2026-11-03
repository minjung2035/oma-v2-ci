#!/usr/bin/env node
/** Deterministic, no-inference smoke of the installed Pi SDK and trusted extension.
 * Scripted assistant messages enter Pi's ordinary tool pipeline; no tool is
 * mocked or forwarded. Checks core -> web -> union -> resumed -> repeated union,
 * persisted safe-boundary exposure, retired-selector refusal and contained edits. This is not
 * provider, broker, sandbox, pricing, crash-ordering or release qualification.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { pathToFileURL } from "node:url";
import { enterBoundedScript } from "./bounded-script.mjs";

if (await enterBoundedScript(import.meta.url, { timeoutMs: 60000 })) {
  const root = resolve(import.meta.dirname, "..");
  const workdir = mkdtempSync(join(tmpdir(), "oma-functional-surface-"));
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let session;
  try {
    // Isolate extension discovery, credentials and owned paths from the caller.
    for (const name of Object.keys(process.env))
      if (name.startsWith("OMA_") || name.startsWith("PI_")) delete process.env[name];
    const agentDir = join(workdir, "pi"), sessionDir = join(workdir, "sessions");
    const home = join(workdir, "home"), archive = join(workdir, "archive");
    for (const path of [agentDir, sessionDir, home, archive]) mkdirSync(path, { recursive: true });
    const probeOut = join(workdir, "probe.jsonl");
    const config = collaborationSurface("resident");
    const recordRoot = join(workdir, "records"); mkdirSync(recordRoot);
    Object.assign(process.env, {
      HOME: home, PI_CODING_AGENT_DIR: agentDir,
      OMA_TOOL_SURFACE: JSON.stringify(config), OMA_ACTOR: "smokeworker",
      OMA_RECORD_ROOT: recordRoot, OMA_MAIL_ADDRESSES: "64",
      OMA_AGENT_HOME: home, OMA_MAIL_ARCHIVE: archive,
      OMA_SOCKET: join(workdir, "unused-control.sock"), OMA_PROBE_OUT: probeOut,
    });
    // The real extension's read-only invocation observations require the App's
    // installed runtime composition, just as both product engine entries do.
    await import(pathToFileURL(join(root, DEPLOYMENT_LAYOUT.clientPreload)).href);
    process.chdir(workdir);
    const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
      await import("@earendil-works/pi-coding-agent");
    const { AssistantMessageEventStream, getCurrentTools } = await import("@earendil-works/pi-ai");
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"),
      modelsPath: null, modelsStorePath: join(agentDir, "models-store.json"), refreshOnCreate: false });
    const model = modelRuntime.getModel("openai", "gpt-4o-mini");
    assert.ok(model, "the installed engine must contain the smoke model descriptor");
    // Satisfy Pi's prompt admission without a provider connection. The stream
    // function below is replaced before any prompt; this key is never transmitted.
    await modelRuntime.setRuntimeApiKey(model.provider, "local-script-no-network");
    const extensionErrors = [];
    const open = async (manager, reason) => {
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false },
        retry: { enabled: false }, cacheWarming: "off" });
      const loader = new DefaultResourceLoader({ cwd: workdir, agentDir, settingsManager,
        noExtensions: true, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        additionalExtensionPaths: [join(root, "packages/extension/dist/index.js"),
          join(root, "dist/test/fixtures/surface-probe-extension.js")] });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, [], "all real extensions must load");
      const created = await createAgentSession({ cwd: workdir, agentDir, modelRuntime, model,
        thinkingLevel: "off", resourceLoader: loader, settingsManager, sessionManager: manager,
        sessionStartEvent: { type: "session_start", reason } });
      session = created.session;
      // An accidental unscripted request fails locally, never reaches a provider.
      session.agent.streamFunction = () => { throw new Error("unscripted inference request"); };
      await session.bindExtensions({ onError: error => { extensionErrors.push(error); } });
      assert.deepEqual(extensionErrors, []);
    };
    const close = async () => {
      if (!session) return;
      try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
      finally { session.dispose(); session = undefined; }
    };
    const core = [...config.direct].sort();
    const active = select => [...core, ...select].sort();
    const exact = (expected, label) => {
      assert.deepEqual([...session.getActiveToolNames()].sort(), expected, label);
      assert.deepEqual([...session.getCallableToolNames()].sort(), expected, `${label}: callable surface`);
    };
    const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
    const result = id => {
      const found = session.messages.find(message => message.role === "toolResult" && message.toolCallId === id);
      assert.ok(found, `persisted tool result ${id}`);
      return found;
    };
    const text = value => value.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    const success = id => { const value = result(id); assert.equal(value.isError, false, text(value)); return value; };
    const anchor = id => {
      const line = text(success(id)).split("\n").find(line => line.includes("│"));
      assert.ok(line, "real anchored read must serve an anchor");
      return line.slice(0, line.indexOf("│")).trim();
    };
    const run = async steps => {
      let index = 0;
      session.agent.streamFunction = (_model, context) => {
        const step = steps[index++];
        assert.ok(step, "unexpected extra assistant turn");
        exact(step.active, `turn ${index}`);
        assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name).sort(), step.active,
          "the provider-facing transcript must match the callable loadout");
        const calls = typeof step.calls === "function" ? step.calls() : step.calls;
        const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: calls ?? [{ type: "text", text: "Scripted turn complete." }],
          stopReason: calls ? "toolUse" : "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        const stream = new AssistantMessageEventStream();
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
        return stream;
      };
      await session.prompt("Execute the deterministic surface smoke.");
      assert.equal(index, steps.length, "every scripted boundary must execute: " + JSON.stringify({extensionErrors,errors:session.messages.filter(message => message.isError || message.stopReason === "error")}));
      assert.deepEqual(extensionErrors, [], "extension failures must not be swallowed");
    };
    const observations = () => readFileSync(probeOut, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const boundary = (id, before, after) => {
      const reports = observations();
      const executed = reports.find(report => report.phase === "tool_result" && report.id === id);
      const committed = reports.find(report => report.phase === "turn_end" && report.ids.includes(id));
      assert.ok(executed && committed, `real tool/result boundary for ${id}`);
      assert.deepEqual([...executed.active].sort(), before, "exposure must stay frozen through tool_result");
      assert.deepEqual([...committed.active].sort(), after, "exposure changes only at turn_end");
      assert.equal(committed.persisted.length, committed.ids.length, "all boundary results must be persisted");
    };

    writeFileSync(join(workdir, "sample.txt"), "alpha\nbeta\n");
    await open(SessionManager.create(workdir, sessionDir), "startup");
    exact(core, "initial core");
    const web = active(config.groups.web_tools);
    const expanded = active(Object.values(config.groups).flat());
    await run([
      { active: core, calls: [call("read-initial", "read", { path: "sample.txt", offset: 1, limit: 100 }),
        call("expose-web", "web_tools", {}), call("same-batch-refused", "lsp_status", {})] },
      { active: web, calls: () => {
        const served = anchor("read-initial");
        return [call("replace", "replace", { remove_from: served, remove_to: served, replacement_lines: "ALPHA" })];
      } },
      { active: web, calls: [call("read-after-replace", "read", { path: "sample.txt", offset: 1, limit: 100 })] },
      { active: web, calls: () => [call("expose-lsp", "lsp_tools", {}),
        call("within-core-loadout", "replace_within", { replace_from: anchor("read-after-replace"),
          replace_to: anchor("read-after-replace"), replace_old: "ALPHA", replace_new: "Alpha" })] },
      { active: expanded },
    ]);
    success("replace"); success("within-core-loadout");
    assert.equal(result("same-batch-refused").isError, true, "a not-yet-exposed member must not execute");
    assert.equal(readFileSync(join(workdir, "sample.txt"), "utf8"), "Alpha\nbeta\n");
    boundary("expose-web", core, web); boundary("expose-lsp", web, expanded);
    const exposure = JSON.parse(text(success("expose-lsp")));
    assert.deepEqual(exposure.permitted, config.groups.lsp_tools);
    assert.equal(exposure.resultingCount, expanded.length);
    const file = session.sessionFile;
    assert.ok(file, "the smoke must persist a real session file");
    const committed = session.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "oma-collaboration-exposure");
    assert.equal(committed.length, 2);
    assert.deepEqual([...committed.at(-1).data.active].sort(), Object.values(config.groups).flat().sort());
    await close();

    await open(SessionManager.open(file, sessionDir), "resume");
    exact(expanded, "restored committed cumulative exposure");
    await run([
      { active: expanded, calls: [call("read-resumed", "read", { path: "sample.txt" })] },
      { active: expanded, calls: () => [call("repeat-web", "web_tools", {}),
        call("insert-core-loadout", "insert", { anchor: anchor("read-resumed"), direction: "after", lines: "inserted" })] },
      { active: expanded, calls: [call("retired-selector-refused", "toolset", { select: [] })] },
      { active: expanded },
    ]);
    success("insert-core-loadout");
    assert.equal(result("retired-selector-refused").isError, true, "a retired selector is not callable and cannot reset exposure");
    assert.equal(readFileSync(join(workdir, "sample.txt"), "utf8"), "Alpha\ninserted\nbeta\n");
    boundary("repeat-web", expanded, expanded);
    assert.deepEqual(JSON.parse(text(success("repeat-web"))).added, []);
    await close();
    await open(SessionManager.open(file, sessionDir), "resume");
    exact(expanded, "restored repeated union; no legacy reset");
    await close();
    assert.deepEqual(extensionErrors, []);
    console.log(`functional surface PASS: core ${core.length} -> web ${web.length} -> union ${expanded.length} -> resumed/repeated ${expanded.length}; anchored replace/replace_within/insert, unexposed-member and retired-selector refusal`);
    console.log("Limits: deterministic assistant stream, no inference/provider transport, broker calls, sandbox activation, crash injection, pricing or release qualification.");
  } catch (error) {
    console.error("functional surface FAIL:", error);
    process.exitCode = 1;
  } finally {
    try {
      if (session) {
        try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
        finally { session.dispose(); }
      }
    } finally {
      process.chdir(originalCwd);
      for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
      Object.assign(process.env, originalEnv);
      rmSync(workdir, { recursive: true, force: true });
    }
  }
}
