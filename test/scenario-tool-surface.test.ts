/** DR27 / TSP: real engine registration, invocation and persistent per-role settings. */
import test from "node:test";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";
import { commitRoleSet, readSettingsForEditing, roleSetOf } from "../src/tui/sources/settings.js";

for (const role of ["principal", "resident"] as const) for (const mode of ["valid", "collision", "unknown"] as const)
  test(`DR27 / TSP: ${role} ${mode} surface through the real engine and persisted settings`, { timeout: 120_000, ...(role === "resident" ? { skip: RESIDENT_TEST_OPTIONS.skip } : {}) }, async () => {
    await withScenario({ residents: ["worker-a"] }, async s => {
      const settings = readSettingsForEditing(s.configPath);
      const roleName = role === "principal" ? settings.config.principalProfile : settings.workerProfile!;
      const roles = roleSetOf(settings.snapshot!);
      const toolSurface = { defaultMode: "DISABLED", direct: mode === "unknown" ? ["missing_tool"] : [], disabled: [],
        groups: mode === "unknown" ? [] : [{ name: mode === "collision" ? "oma_mail_send" : "files", description: "Explore workspace",
          members: [{ tool: "ls" }] }], roots: [] };
      commitRoleSet(settings.snapshot!, settings.config, { ...roles, [roleName]: { ...roles[roleName]!, toolSurface } });
      await s.restartBroker(); await s.restartEngine();
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
      if (role === "principal") await s.prompt("Inspect the configured surface.");
      else {
        await s.residentSends("worker-a", { to: ["worker-a"], subject: "Inspect", body: "Inspect the configured surface." }, "work");
        const result = await s.activate("worker-a"); assert.equal(result.code, 0, result.stderr);
      }
      if (mode === "valid") {
        assert.ok(seen[0]!.includes("files")); assert.ok(!seen[0]!.includes("ls"));
        assert.ok(seen[1]!.includes("ls"));
        assert.match(toolResults(s.provider.seen[1]!.body).at(-1)!.text, /enabled 1/);
        assert.doesNotMatch(toolResults(s.provider.seen[2]!.body).at(-1)!.text, /error|refused|unknown/i);
      } else {
        assert.ok(seen[0]!.includes("oma_mail_send")); assert.ok(!seen[0]!.includes("ls"));
        assert.ok(!seen[0]!.includes("files")); assert.ok(!seen[0]!.includes("missing_tool"));
        assert.equal(s.store.getOperation(role === "principal" ? "principal" : "worker-a", "surface-mail")?.state, "succeeded");
      }
    });
  });
