/** DR72/MCS: current cumulative exposure through the product engine. Retired or
 * invalid plans are refused by production launch builders before engine entry.
 * These scripted-provider tests are not live-provider or platform qualification. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runnerSessionDirPathAt } from "@oma/domain/paths";
import { principalSessionDir, principalWorkspace, sessionArgv } from "@oma/engine/principal-session";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import test from "node:test";
import { RESIDENT_TEST_OPTIONS, residentOptions } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults, textOf } from "./fixtures/scripted-provider.js";

for (const role of ["principal", "resident"] as const) for (const mode of ["malformed", "unknown", "retired"] as const)
  test(`001. Scenario tool surface: ${role} ${mode} plan refuses in its launch builder before sandbox/SDK entry`, () => {
    const raw = mode === "malformed" ? "{" : mode === "retired" ? JSON.stringify({ version: 2,
      defaultMode: "DISABLED", direct: ["read"], optional: [], disabled: [] })
      : JSON.stringify({ ...collaborationSurface(role), direct: ["missing_tool"] });
    const unsupported = (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "UNSUPPORTED_PROFILE" && /tool surface.*(unsupported|malformed)/.test(error.message);
    if (role === "principal") assert.throws(() => sessionArgv({ piCommand: process.execPath,
      coreExtension: "/lib/core.js", collaborationStateRoot: "/state", workspace: principalWorkspace("/state"),
      home: "/home", sessionDir: principalSessionDir("/state"), toolSurface: raw }, {
      society: "demo", provider: "fake", model: "scripted", extensions: [],
    }), unsupported);
    else {
      const base = residentOptions("/state");
      const options = { ...base, profile: { ...base.profile, toolSurface: raw } };
      let sandboxEntered = false;
      assert.throws(() => planPiSpawn({ pathView() { sandboxEntered = true; throw new Error("must not enter sandbox"); } } as never, options), unsupported);
      assert.equal(sandboxEntered, false);
    }
  });

for (const { role, entry } of [{ role: "principal", entry: "prompt" }, { role: "principal", entry: "delivery" },
  { role: "resident", entry: "delivery" }] as const)
  test(`002. Product engine: ${role} ${entry} cumulative groups, repeat, callable metadata and durable member result`, {
    timeout: 120_000, ...(role === "resident" ? { skip: RESIDENT_TEST_OPTIONS.skip } : {}),
  }, async () => {
    await withScenario({ residents: ["worker-a"] }, async s => {
      if (entry === "delivery") {
        // A current Principal action creates the actual accepted trigger delivery.
        const recipient = role === "resident" ? "worker-a" : "principal";
        s.script([tools(call("oma_send", { to: [recipient], subject: "Inspect",
          content: { kind: "text", value: "Inspect the available development environment." } }, "surface-trigger")), text("Sent.")]);
        await s.prompt("Send the environment-inspection request.");
        const accepted = s.operations("principal").filter(operation => operation.kind === "mail.send" && operation.state === "succeeded");
        assert.equal(accepted.length, 1, "the current action must actually accept the trigger mail");
        assert.deepEqual(s.store.deliveriesForOperation(accepted[0]!.id).map(delivery => delivery.recipient), [recipient]);
      }
      const requestStart = s.provider.seen.length;
      const seen: string[][] = [];
      s.script((request, index) => {
        seen.push(request.tools?.map(tool => tool.function!.name!) ?? []);
        if (index === 0) return tools(call("web_tools", {}, "surface-web"));
        if (index === 1) return tools(call("lsp_tools", {}, "surface-lsp"));
        if (index === 2) return tools(call("web_tools", {}, "surface-repeat"), call("lsp_status", {}, "surface-status"));
        return text("Done.");
      });
      if (entry === "prompt") await s.prompt("Inspect the available development environment.");
      else if (role === "principal") assert.equal((await s.deliver()).kind, "delivered");
      else {
        const result = await s.activate("worker-a"); assert.equal(result.code, 0, result.stderr);
      }
      assert.equal(seen.length, 4, "all three group boundaries reached a subsequent provider request");
      const plan = collaborationSurface(role);
      assert.deepEqual([...seen[0]!].sort(), [...plan.direct].sort());
      assert.deepEqual([...seen[1]!].sort(), [...plan.direct, ...plan.groups.web_tools].sort());
      const expanded = [...plan.direct, ...Object.values(plan.groups).flat()].sort();
      assert.deepEqual([...seen[2]!].sort(), expanded); assert.deepEqual([...seen[3]!].sort(), expanded);
      assert.ok(seen.every(names => !names.includes("toolset") && names.includes("oma_send")));
      assert.ok(seen.every(names => !names.includes("edit") && !names.includes("powershell")));
      if (role === "principal") assert.ok(!expanded.includes("lsp_diagnostics") && !expanded.includes("lsp_fix"));
      const guidance = s.provider.seen.slice(requestStart).map(request => request.body.messages.filter(message => message.role === "system").map(textOf).join("\n"));
      for (const [index, request] of s.provider.seen.slice(requestStart).entries()) {
        assert.equal(request.body.messages[0]?.role, "system", `request ${index} needs a leading system message`);
        const policy = guidance[index]!;
        assert.ok(policy.includes(role === "principal" ? "You are the Principal of an OMA coding team." : "You are a Worker in an OMA coding team."),
          `request ${index} retains the authored role`);
        assert.match(policy, /<oma_authority>[\s\S]*OMA authenticates your actor[\s\S]*<\/oma_authority>/);
        assert.match(policy, /<oma_tools>[\s\S]*Available tools:[\s\S]*<\/oma_tools>/);
        const environments = [...policy.matchAll(/<oma_environment>\s*([\s\S]*?)\s*<\/oma_environment>/g)];
        assert.ok(environments.length > 0, `request ${index} retains host environment`);
        const environment = JSON.parse(environments.at(-1)![1]!);
        assert.equal(environment.surface, "collaboration-v1");
        assert.equal(environment.role, role === "principal" ? "Principal" : "Worker");
        assert.equal(environment.actor, role === "principal" ? "principal" : "worker-a");
        assert.equal(environment.workspace, role === "principal" ? principalWorkspace(s.root) : "/workspace");
        assert.equal(environment.activation_processes_survive, role === "principal");
        assert.equal(environment.platform, process.platform);
      }
      assert.equal(/^- web_search:/m.test(guidance[0]!), false);
      assert.equal(/^- web_search:/m.test(guidance[1]!), true, "exposed member guidance must reach the real provider payload");
      assert.equal(/^- lsp_status:/m.test(guidance[2]!), true, "exposed member guidance must reach the real provider payload");
      assert.equal(/^- web_search:/m.test(guidance[3]!), true, "repeat cannot remove the other group");
      const status = toolResults(s.provider.seen[requestStart + 3]!.body).find(result => result.id === "surface-status");
      assert.ok(status, "a directly called exposed member produced a persisted result");
      const repeat = toolResults(s.provider.seen[requestStart + 3]!.body).find(result => result.id === "surface-repeat");
      assert.ok(repeat); assert.deepEqual(JSON.parse(repeat.text).added, []);
      const directory = role === "principal" ? principalSessionDir(s.root) : runnerSessionDirPathAt(s.root, "worker-a");
      const journals = readdirSync(directory, { recursive: true }).map(String)
        .filter(name => name.endsWith(".jsonl") && !name.startsWith("hashline/"));
      const entries = journals.flatMap(name => readFileSync(join(directory, name), "utf8").trim().split("\n").map(line => JSON.parse(line)));
      const recorded = entries.find(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "surface-status");
      assert.ok(recorded); assert.equal(recorded.message.isError, false);
      const exposures = entries.filter(entry => entry.type === "custom" && entry.customType === "oma-collaboration-exposure");
      assert.equal(exposures.length, 3);
      for (const [index, id] of ["surface-web", "surface-lsp", "surface-repeat"].entries()) {
        const persisted = entries.findIndex(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === id);
        assert.ok(persisted >= 0 && persisted < entries.indexOf(exposures[index]), "exposure follows its real persisted result");
      }
    });
  });
