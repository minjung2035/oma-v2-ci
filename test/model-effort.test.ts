import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultHostConfig } from "@oma/config/defaults";
import { validateConfig } from "@oma/config";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { residentOptions } from "./fixtures/resident.js";
import { dashboardRows } from "@oma/tui/view/dashboard";
import type { DashboardData } from "@oma/tui/model";
import {
  WORKER_MODEL, commitField, engineModelChoiceOf, readSettings, workerModelText, writeSettings,
} from "#oma-test/app/application/settings";

const installation = { society: "demo", node: "/usr/bin/node", libdir: "/opt/oma/",  deploymentDigest: "a".repeat(64) };

test("DR46-F01: Worker edits keep the accepted reference and save model and effort contents", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-worker-model-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "config.json");
  writeSettings(path, defaultHostConfig(installation));
  let settings = readSettings(path);
  const worker = settings.workerProfile!;
  const workerReference = settings.config.agentProfiles[worker]!.modelProfile;
  const principalModel = settings.config.agentProfiles[settings.config.principalProfile]!.modelProfile;
  assert.equal(workerModelText(settings.config, worker), "The engine's default");

  assert.deepEqual(commitField(settings, WORKER_MODEL, { provider: "fake", model: "scripted-2", thinking: "high" }), { kind: "saved" });
  settings = readSettings(path);
  const own = settings.config.modelProfiles[workerReference]!;
  assert.deepEqual([own.provider, own.model, own.thinking], ["fake", "scripted-2", "high"]);
  assert.equal(own.inferenceTimeoutSeconds, 600, "the limits the Worker ran with are kept");
  assert.equal(settings.config.agentProfiles[worker]!.modelProfile, workerReference);
  assert.equal(settings.config.agentProfiles[settings.config.principalProfile]!.modelProfile, principalModel, "the Principal did not change");
  assert.equal(workerModelText(settings.config, worker), "fake/scripted-2 · high");

  // A model with no effort to choose keeps none, not the previous one.
  commitField(settings, WORKER_MODEL, { provider: "fake", model: "plain" });
  settings = readSettings(path);
  assert.equal(settings.config.modelProfiles[workerReference]!.thinking, undefined);
  assert.equal(workerModelText(settings.config, worker), "fake/plain");

  // Selecting the Principal model copies its current contents into the fixed Worker reference.
  commitField(settings, WORKER_MODEL, principalModel);
  settings = readSettings(path);
  assert.equal(settings.config.agentProfiles[worker]!.modelProfile, workerReference);
  assert.deepEqual(settings.config.modelProfiles[workerReference], settings.config.modelProfiles[principalModel]);
  assert.equal(workerModelText(settings.config, worker), "The engine's default");

  // The Worker's own profile is never another agent's to change.
  const shared = { ...settings.config, agentProfiles: { ...settings.config.agentProfiles,
    [settings.config.principalProfile]: { ...settings.config.agentProfiles[settings.config.principalProfile]!, modelProfile: workerReference } } };
  writeSettings(path, shared);
  assert.throws(() => commitField(readSettings(path), WORKER_MODEL, { provider: "fake", model: "scripted-2" }), /share this model profile/);
});

test("DR24: an effort is one of the engine's levels, in the configuration and from the engine's screen", () => {
  const config = defaultHostConfig(installation);
  const profile = config.modelProfiles[config.agentProfiles[config.principalProfile]!.modelProfile]!;
  assert.throws(() => validateConfig({ ...config, modelProfiles: { ...config.modelProfiles, x: { ...profile, thinking: "turbo" as never } } }),
    /thinking must be one of/);
  assert.doesNotThrow(() => validateConfig({ ...config, modelProfiles: { ...config.modelProfiles, x: { ...profile, thinking: "xhigh" } } }));
  assert.deepEqual(engineModelChoiceOf({ provider: "fake", model: "m", thinking: "low" }), { provider: "fake", model: "m", thinking: "low" });
  assert.equal(engineModelChoiceOf({ provider: "fake", model: "m", thinking: "turbo" }), null);
  assert.equal(engineModelChoiceOf({ provider: "", model: "m" }), null);
  assert.equal(engineModelChoiceOf({ provider: "fake", model: "m".repeat(201) }), null);
});

test("DR24: a Resident's engine runs the effort its profile or the engine's default names", () => {
  const options = residentOptions("/state");
  const plan = (thinking?: string) => planPiSpawn(residentEngineEffects.sandbox, { ...options,
    profile: { ...options.profile, ...(thinking ? { thinking } : {}) } }).args;
  const high = plan("high");
  assert.equal(high[high.indexOf("--thinking") + 1], "high");
  assert.equal(plan().includes("--thinking"), false, "no effort named: the engine's own");
});

test("DR24: the effort levels offered for a Worker's model are the engine's own for that model", async () => {
  const { effortLevelsOf } = await import("@oma/engine/interactive");
  // Resolve pi-ai the way the engine does -- parented at the engine package so a
  // hoisted or nested install layout finds the same copy the engine loads.
  const models = await import(import.meta.resolve("@earendil-works/pi-ai/models", import.meta.resolve("@earendil-works/pi-coding-agent"))) as {
    getSupportedThinkingLevels(model: unknown): string[] };
  const { getSupportedThinkingLevels } = models;
  for (const model of [{ reasoning: false }, { reasoning: true }, { reasoning: true, thinkingLevelMap: { xhigh: "x" } },
    { reasoning: true, thinkingLevelMap: { minimal: null, max: "m" } }, { reasoning: true, thinkingLevelMap: { xhigh: null, low: "l" } }])
    assert.deepEqual(effortLevelsOf({ id: "fixture", name: "fixture", api: "openai-completions", provider: "fixture",
      baseUrl: "http://localhost", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096, maxTokens: 512, ...model }), getSupportedThinkingLevels(model), JSON.stringify(model));
});

test("DR24: the Dashboard names the engine's model once, and what a Worker runs", () => {
  const base = { status: { kind: "unknown", observedAtMs: 0, reason: "n/a" }, configuredWorkers: 0, unread: 0, rootfs: null } as const;
  const rows = (data: Partial<DashboardData>) => dashboardRows({ ...base, principalModel: { configured: "default", session: "default" }, ...data } as DashboardData);
  const engine = rows({ principalModel: { configured: "default", session: "default", engine: "fake/scripted-2 · high", engineManaged: true },
    workerModel: "Same as the Principal" });
  assert.deepEqual(engine.filter(row => /model|Model|Engine/.test(row.label)).map(row => `${row.label}: ${row.value}`), [
    "Principal model: fake/scripted-2 · high (running; Config > Principal model changes it)",
    "Worker model: Same as the Principal",
  ]);
  assert.match(rows({ principalModel: { configured: "default", session: null, engineManaged: true } })
    .find(row => row.label === "Principal model")!.value, /^unknown/);
  // A profile that names its own model is still shown as configured.
  assert.ok(rows({}).some(row => row.label === "Model" && row.value.startsWith("default (Configured")));
});
