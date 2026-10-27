// Attack config generations (operations bundle, P0-3): concurrent edit (two
// TUIs) lost update, and commit-succeeds-but-load-rejects. Builds a real
// operations bundle via the migration script and drives dist commit/load.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfigurationSnapshot, validateConfig, loadConfig } from "../../../../dist/src/config.js";
import { commitManagedGeneration, collectManagedGenerations, MANAGED_DIRECTORY } from "../../../../dist/src/config/generations.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G08-ops-"));
try {
  const installation = join(root, "installation");
  mkdirSync(join(installation, "dist/src"), { recursive: true });
  writeFileSync(join(installation, "dist/src/pi-extension.js"), "export default function () {}\n");
  const model = { provider: "fixture", model: "m", credentialRef: "r", codecRevision: "c", pricingRevision: "p", maxInputTokens: 1024, maxOutputTokens: 128, inferenceTimeoutSeconds: 30 };
  const profile = { modelProfile: "standard", capabilities: [], delegable: [], childProfile: null, resources: { memoryBytes: 1073741824, tasks: 64, cpuQuotaPercent: 100, tmpBytes: 268435456, workspaceBytes: 1073741824, stagingBytes: 536870912, checkTimeoutSeconds: 300 } };
  const config = {
    schemaVersion: 1, society: "demo",
    installation: { node: process.execPath, libdir: installation, rootfs: "/rootfs", deploymentDigest: "a".repeat(64) },
    modelProfiles: { standard: model },
    agentProfiles: { principal: structuredClone(profile), resident: structuredClone(profile) },
    principalProfile: "principal",
    initialResidents: [{ name: "worker", profile: "resident", brief: "work" }],
    quota: { societyAgents: 4, lineageAgents: 4, societyUnits: 4, lineageUnits: 4, principalReservedUnits: 1, inferenceSlots: 2, principalReservedSlots: 1, storageBytes: 1048576 },
    integration: { policyRevision: "test", protectedPaths: [], checks: [] },
    limits: { frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64, replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456, logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30 },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
  const input = join(root, "legacy.json");
  writeFileSync(input, JSON.stringify(config));
  const output = join(root, "operations");
  const path = join(output, "config.json");
  const mig = spawnSync(process.execPath, [resolve("scripts/split-operations-config.mjs"), input, output], { encoding: "utf8", timeout: 10000 });
  if (mig.status !== 0) { console.log("migrate failed:", mig.stderr || mig.stdout); process.exit(1); }
  console.log("bundle built; initial load society:", loadConfig(path).society);

  const commit = (snap, count) => commitManagedGeneration(
    { config: snap.config, layout: snap.layout, authoredRoles: snap.authoredRoles, sourceFiles: snap.sourceFiles, roles: snap.roles },
    { config: validateConfig({ ...snap.config, limits: { ...snap.config.limits, subjectBytes: count } }) });

  // --- CONCURRENCY: two TUIs load the SAME snapshot, both commit. ---
  const tuiA = loadConfigurationSnapshot(path);
  const tuiB = loadConfigurationSnapshot(path); // same underlying bytes
  const r1 = commit(tuiA, 500);
  console.log("TUI-A commit:", r1.kind, r1.generation?.slice(0, 12));
  let bOutcome;
  try { const r2 = commit(tuiB, 400); bOutcome = `${r2.kind} ${r2.generation?.slice(0,12)}`; }
  catch (e) { bOutcome = `REJECTED ${e.code}: ${String(e.message).slice(0,60)}`; }
  console.log("TUI-B commit (stale snapshot):", bOutcome);
  console.log("final subjectBytes on disk:", loadConfig(path).limits.subjectBytes);

  // --- commit-succeeds-but-load-rejects probe: after each committed edit, reload ---
  for (const count of [500, 400, 600]) {
    const s = loadConfigurationSnapshot(path);
    const r = commit(s, count);
    try {
      const back = loadConfig(path);
      console.log(`edit->${count}: ${r.kind} reload OK agents=${back.limits.subjectBytes}`);
    } catch (e) {
      console.log(`edit->${count}: ${r.kind} but RELOAD REJECTED ${e.code}: ${String(e.message).slice(0,60)}`);
    }
  }
} finally {
  spawnSync("chmod", ["-R", "u+rwX", root]);
  rmSync(root, { recursive: true, force: true });
}
