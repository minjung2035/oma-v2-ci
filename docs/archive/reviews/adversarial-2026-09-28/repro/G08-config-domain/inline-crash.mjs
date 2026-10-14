// Attack config generations (P0-3): crash at every durable boundary of an
// inline configuration commit, then verify the next load succeeds and reads
// the same bytes. Also probe commit-succeeds-but-load-rejects.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultHostConfig } from "../../../../dist/src/config/defaults.js";
import { validateConfig, loadConfigurationSnapshot, loadConfig } from "../../../../dist/src/config.js";
import { commitInlineConfiguration, createInlineConfiguration } from "../../../../dist/src/config/generations.js";
import { DurabilityFaultError } from "../../../../dist/src/storage/durable-fs.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G08-"));
try {
  const base = defaultHostConfig({
    society: "advsoc", node: "/usr/bin/node", libdir: "/opt/oma/lib",
    rootfs: "/opt/oma/rootfs",
    deploymentDigest: "a".repeat(64),
  });
  const candidate = validateConfig(base);
  const path = join(root, "config.json");
  console.log("create:", createInlineConfiguration(path, candidate));
  let snap = loadConfigurationSnapshot(path);
  console.log("loaded society:", snap.config.society);

  // Enumerate the fault points a commit passes and crash at each, then reload.
  const faultPlan = [
    ["derived-rename", "before"],
    ["derived-rename", "after-visible"],
    ["directory-fsync", "ambiguous"],
    ["directory-fsync", "after-visible"],
    ["file-fsync", "ambiguous"],
    ["file-fsync", "after-visible"],
  ];
  for (const [point, phase] of faultPlan) {
    // fresh snapshot each round (previous commit may have changed the file)
    let s;
    try { s = loadConfigurationSnapshot(path); } catch (e) { console.log(`[${point}/${phase}] PRE-LOAD FAIL:`, e.code || e.message); continue; }
    const target = validateConfig({ ...base, limits: { ...base.limits, subjectBytes: 500 + (s.config.limits.subjectBytes % 10) } });
    const observer = (f) => {
      if (f.point === point && f.phase === phase) throw new DurabilityFaultError(f);
    };
    let crashed = false;
    try { commitInlineConfiguration(s, target, observer); }
    catch (e) { crashed = (e.name === "DurabilityFaultError"); if (!crashed) console.log(`[${point}/${phase}] NON-FAULT throw:`, e.code || e.constructor.name, String(e.message).slice(0,50)); }
    // Now simulate process loss: try to load fresh.
    try {
      const after = loadConfig(path);
      console.log(`[${point}/${phase}] crashed=${crashed} -> load OK society=${after.society} agents=${after.quota.societyAgents}`);
    } catch (e) {
      console.log(`[${point}/${phase}] crashed=${crashed} -> LOAD REJECTED: ${e.code || e.constructor.name} ${String(e.message).slice(0,60)}`);
    }
    // Show leftover temporaries.
    const leftovers = readdirSync(root).filter(n => n !== "config.json");
    if (leftovers.length) console.log(`   leftovers:`, leftovers);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
