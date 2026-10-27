/** DR27 / TSP / D23: the tool surface is OMA's internal policy. It reaches an
 * engine as OMA_TOOL_SURFACE in its environment -- the spawn plans' own env --
 * and never through an authored role file, so the scenario sets it the way
 * OMA itself would, on the engine process. */
import test from "node:test";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";
import { encodeToolSurfacePlan, planToolSurface } from "@oma/domain/tool-surface";

/** The internal plan for each shape the gate must handle. `valid` groups a
 * routine tool; `collision` names a group after an OMA tool; `unknown`
 * selects a tool the registry never holds. The last two are not configurations
 * a host could write -- the field is closed -- but what reaches the engine as
 * bytes must still fail closed, explicitly, at session start. */
const plan = (mode: "valid" | "collision" | "unknown"): string => encodeToolSurfacePlan(planToolSurface({
  defaultMode: "DISABLED",
  direct: mode === "unknown" ? ["missing_tool"] : [],
  disabled: [],
  groups: mode === "unknown" ? [] : [{
    name: mode === "collision" ? "oma_mail_send" : "files",
    description: "Explore workspace",
    members: [{ tool: "ls" }],
  }],
  roots: [],
}));

/** The engine ends when the surface cannot be validated. `session.running`
 * tracks the child, so polling it is the observable startup failure. */
async function engineDied(session: { running: boolean }, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (session.running && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(session.running, false, "a refused surface must stop the engine, not quietly degrade it");
}

for (const role of ["principal", "resident"] as const) for (const mode of ["valid", "collision", "unknown"] as const)
  test(`DR27 / TSP / D23: ${role} ${mode} internal surface through the real engine`, { timeout: 120_000, ...(role === "resident" ? { skip: RESIDENT_TEST_OPTIONS.skip } : {}) }, async () => {
    await withScenario({ residents: ["worker-a"], engineEnv: { OMA_TOOL_SURFACE: plan(mode) } }, async s => {
      const seen: string[][] = [];
      s.script((request, index) => {
        seen.push(request.tools?.map(tool => tool.function!.name!) ?? []);
        if (mode === "valid" && index === 0) return tools(call("files", {}));
        if (mode === "valid" && index === 1) return tools(call("ls", { path: "." }));
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
        assert.ok(seen[0]!.includes("files")); assert.ok(!seen[0]!.includes("ls"));
        assert.ok(seen[1]!.includes("ls"));
        assert.match(toolResults(s.provider.seen[1]!.body).at(-1)!.text, /enabled 1/);
        assert.doesNotMatch(toolResults(s.provider.seen[2]!.body).at(-1)!.text, /error|refused|unknown/i);
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
