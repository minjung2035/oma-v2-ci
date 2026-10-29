/** DR27 / TSP / D23: the tool surface is OMA's internal policy. It reaches an
 * engine as OMA_TOOL_SURFACE in its environment -- the spawn plans' own env --
 * and never through an authored role file, so the scenario sets it the way
 * OMA itself would, on the engine process. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runnerSessionDirPathAt } from "@oma/domain/paths";
import { principalSessionDir } from "@oma/engine/principal-session";
import test from "node:test";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";
import { encodeToolSurfacePlan, planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig } from "@oma/domain/tool-surface";

/** Invalid bytes must stop the engine before a provider request, even though
 * normal host configuration cannot author this policy. */
const plan = (mode: "valid" | "malformed" | "unknown"): string => mode === "malformed" ? "{"
  : encodeToolSurfacePlan(planToolSurface({
    defaultMode: "DISABLED",
    direct: mode === "unknown" ? ["missing_tool"] : ["oma_mail_send"],
    disabled: [], optional: ["ls"],
  }));

/** The engine ends when the surface cannot be validated. `session.running`
 * tracks the child, so polling it is the observable startup failure. */
async function engineDied(session: { running: boolean }, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (session.running && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(session.running, false, "a refused surface must stop the engine, not quietly degrade it");
}

for (const role of ["principal", "resident"] as const) for (const mode of ["valid", "malformed", "unknown"] as const)
  test(`DR27 / TSP / D23: ${role} ${mode} internal surface through the real engine`, { timeout: 120_000, ...(role === "resident" ? { skip: RESIDENT_TEST_OPTIONS.skip } : {}) }, async () => {
    await withScenario({ residents: ["worker-a"], engineEnv: { OMA_TOOL_SURFACE: plan(mode) } }, async s => {
      const seen: string[][] = [];
      s.script((request, index) => {
        seen.push(request.tools?.map(tool => tool.function!.name!) ?? []);
        if (mode === "valid" && index === 0) return tools(call("toolset", { select: ["ls"] }));
        if (mode === "valid" && index === 1) return tools(call("toolset", { select: [] }), call("ls", { path: "." }, "surface-ls"));
        if (mode !== "valid" && index === 0) return tools(call("oma_mail_send", {
          to: [role === "principal" ? "worker-a" : "principal"], subject: "Surface refusal", body: "Mail remains usable", request: "surface-mail",
        }));
        return text("Done.");
      });
      if (mode === "valid") {
        if (role === "principal") await s.prompt("Inspect the configured surface.");
        else {
          await s.residentSends("worker-a", { to: ["worker-a"], subject: "Inspect", body: "Inspect the configured surface." }, "work");
          const result = await s.activate("worker-a"); assert.equal(result.code, 0, result.stderr);
        }
        assert.ok(!seen[0]!.includes("ls"));
        assert.ok(seen[1]!.includes("ls"));
        assert.ok(!seen[2]!.includes("ls"), "empty selection removes the previous optional tool");
        assert.ok(seen.every(names => names.includes("oma_mail_send")), "core survives selection replacement");
        const selection = JSON.parse(toolResults(s.provider.seen[1]!.body).at(-1)!.text);
        assert.deepEqual(selection.select, ["ls"]);
        assert.equal(selection.nextActiveCount, seen[1]!.length);
        const listed = toolResults(s.provider.seen[2]!.body).find(result => result.id === "surface-ls");
        assert.ok(listed, "the previous loadout's call completed after toolset in the same batch");
        assert.doesNotMatch(listed.text, /error|refused|unknown/i);
      } else {
        // A surface that cannot be validated must not run the session at all:
        // the gate closes, the process ends, and no model turn ever starts.
        if (role === "principal") await engineDied(s.session);
        else {
          await s.residentSends("worker-a", { to: ["worker-a"], subject: "Inspect", body: "Inspect the configured surface." }, "work");
          const result = await s.activate("worker-a");
          assert.notEqual(result.code, 0, "a refused surface must end the activation");
        }
        assert.equal(seen.length, 0, "the model was never asked to run a turn");
        assert.equal(s.store.getOperation(role === "principal" ? "principal" : "worker-a", "surface-mail"), null,
          "nothing ran under a surface that failed validation");
      }
    });
  });

for (const role of ["principal", "resident"] as const)
  test(`${role}: the installed catalog stays callable through full selection and reset`, {
    timeout: 120_000, ...(role === "resident" ? { skip: RESIDENT_TEST_OPTIONS.skip } : {}),
  }, async () => {
    await withScenario({ residents: ["worker-a"] }, async s => {
      const optional = (role === "principal" ? principalToolSurfaceConfig() : residentToolSurfaceConfig()).optional;
      const seen: string[][] = [];
      s.script((request, index) => {
        seen.push(request.tools?.map(tool => tool.function!.name!) ?? []);
        if (index === 0) return tools(call("toolset", { select: optional }));
        if (index === 1) return tools(call("toolset", { select: [] }), call("lsp_status", {}, "surface-status"));
        return text("Done.");
      });
      if (role === "principal") await s.prompt("Inspect the available development environment.");
      else {
        await s.residentSends("worker-a", { to: ["worker-a"], subject: "Inspect",
          body: "Inspect the available development environment." }, "surface-catalog");
        const result = await s.activate("worker-a");
        assert.equal(result.code, 0, result.stderr);
      }
      const core = seen[0]!, all = seen[1]!, reset = seen[2]!;
      assert.deepEqual([...reset].sort(), [...core].sort());
      assert.ok(core.every(name => all.includes(name)));
      assert.ok(optional.every(name => all.includes(name)));
      assert.ok(!all.includes("edit") && !all.includes("powershell"));
      if (role === "principal")
        assert.ok(!all.includes("lsp_diagnostics") && !all.includes("lsp_fix"));
      const status = toolResults(s.provider.seen[2]!.body).find(result => result.id === "surface-status");
      assert.ok(status, "an actually selected tool produced a persisted result");
      const directory = role === "principal" ? principalSessionDir(s.root) : runnerSessionDirPathAt(s.root, "worker-a");
      const journals = readdirSync(directory, { recursive: true }).map(String)
        .filter(name => name.endsWith(".jsonl") && !name.startsWith("hashline/"));
      const entries = journals.flatMap(name => readFileSync(join(directory, name), "utf8").trim().split("\n").map(line => JSON.parse(line)));
      const recorded = entries.find(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "surface-status");
      assert.ok(recorded, "the selected tool's execution is durable, not just a provider tool name");
      assert.equal(recorded.message.isError, false);
    });
  });
