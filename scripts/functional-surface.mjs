#!/usr/bin/env node
/** Deterministic, no-inference smoke of the installed Pi SDK and trusted extension.
 * Scripted assistant messages enter Pi's ordinary tool pipeline; no tool is
 * mocked or forwarded. Checks core -> selected -> replaced -> resumed -> reset,
 * persisted safe-boundary commits, and contained anchored edits. This is not
 * provider, broker, sandbox, pricing, crash-ordering or release qualification.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeToolSurfacePlan, planToolSurface, residentToolSurfaceConfig } from "@oma/domain/tool-surface";
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
    const config = residentToolSurfaceConfig();
    Object.assign(process.env, {
      HOME: home, PI_CODING_AGENT_DIR: agentDir,
      OMA_TOOL_SURFACE: encodeToolSurfacePlan(planToolSurface(config)),
      OMA_AGENT_HOME: home, OMA_MAIL_ARCHIVE: archive,
      OMA_SOCKET: join(workdir, "unused-control.sock"), OMA_PROBE_OUT: probeOut,
    });
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
      assert.deepEqual([...executed.active].sort(), before, "selection must stay frozen through tool_result");
      assert.deepEqual([...committed.active].sort(), after, "selection changes only at turn_end");
      assert.equal(committed.persisted.length, committed.ids.length, "all boundary results must be persisted");
    };

    writeFileSync(join(workdir, "sample.txt"), "alpha\nbeta\n");
    await open(SessionManager.create(workdir, sessionDir), "startup");
    exact(core, "initial core");
    const selected = active(["insert", "replace_within"]);
    const replaced = active(["insert"]);
    await run([
      { active: core, calls: [call("read-initial", "read", { path: "sample.txt", offset: 1, limit: 100 }),
        call("select", "toolset", { select: ["insert", "replace_within"] })] },
      { active: selected, calls: () => {
        const served = anchor("read-initial");
        return [call("replace", "replace", { remove_from: served, remove_to: served, replacement_lines: "ALPHA" })];
      } },
      { active: selected, calls: [call("read-after-replace", "read", { path: "sample.txt", offset: 1, limit: 100 })] },
      { active: selected, calls: () => [call("replace-selection", "toolset", { select: ["insert"] }),
        call("within-old-loadout", "replace_within", { replace_from: anchor("read-after-replace"),
          replace_to: anchor("read-after-replace"), replace_old: "ALPHA", replace_new: "Alpha" })] },
      { active: replaced },
    ]);
    success("replace"); success("within-old-loadout");
    assert.equal(readFileSync(join(workdir, "sample.txt"), "utf8"), "Alpha\nbeta\n");
    boundary("select", core, selected);
    boundary("replace-selection", selected, replaced);
    const selection = JSON.parse(text(success("replace-selection")));
    assert.deepEqual(selection.removed, ["replace_within"]);
    assert.equal(selection.nextActiveCount, replaced.length);
    const file = session.sessionFile;
    assert.ok(file, "the smoke must persist a real session file");
    assert.deepEqual(session.sessionManager.getBranch().filter(entry => entry.type === "custom" &&
      entry.customType === "oma-toolset").at(-1)?.data.select, ["insert"]);
    await close();

    await open(SessionManager.open(file, sessionDir), "resume");
    exact(replaced, "restored committed selection");
    await run([
      { active: replaced, calls: [call("read-resumed", "read", { path: "sample.txt", offset: 1, limit: 100 })] },
      { active: replaced, calls: () => [call("reset", "toolset", { select: [] }),
        call("insert-old-loadout", "insert", { anchor: anchor("read-resumed"), direction: "after", lines: "inserted" })] },
      { active: core, calls: [call("insert-refused", "insert", { anchor: "unused", direction: "after", lines: "forbidden" })] },
      { active: core },
    ]);
    success("insert-old-loadout");
    assert.equal(result("insert-refused").isError, true, "a removed optional tool must not execute");
    assert.equal(readFileSync(join(workdir, "sample.txt"), "utf8"), "Alpha\ninserted\nbeta\n");
    boundary("reset", replaced, core);
    await close();
    await open(SessionManager.open(file, sessionDir), "resume");
    exact(core, "restored reset");
    await close();
    assert.deepEqual(extensionErrors, []);
    console.log(`functional surface PASS: core ${core.length} -> selected ${selected.length} -> replaced ${replaced.length} -> resumed ${replaced.length} -> reset ${core.length}; anchored replace/replace_within/insert and removed-tool refusal`);
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
