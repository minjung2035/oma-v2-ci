import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LifecycleModule } from "../../src/lifecycle.js";
import { UnitsModule, unitName } from "../../src/units.js";
import { MailModule } from "../../src/mail.js";
import { Store } from "../../src/store.js";
import { sha256Hex } from "../../src/hash.js";
import { ALL_CAPS, resolvedSpec } from "./spec.js";
import type { ResolvedAgentSpec } from "../../implementation/contracts.js";

export function lifecycleFixture(root: string, store: Store) {
  const society = `bc${sha256Hex(root).slice(0, 20)}`;
  const frozen = JSON.parse(resolvedSpec(ALL_CAPS, "p", "child")) as ResolvedAgentSpec;
  const units = new UnitsModule(society, { node: process.execPath, libdir: join(process.cwd(), "dist"), state: root, society, agent: "" }, join(root, "units"));
  const mail = new MailModule({ stateRoot: root, society }, store, 64);
  const lifecycle = new LifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "repos/project.git"), society, hasGoal: () => false }, (_parent, input) => ({ ...frozen, ...input }), mail);
  const config: Parameters<LifecycleModule["bootstrap"]>[0] = {
    principalProfile: "p", initialResidents: [{ name: "child", profile: "p", brief: "first" }, { name: "peer", profile: "p", brief: "second" }],
    modelProfiles: { md: { provider: "none", model: "none", credentialRef: "none", codecRevision: "none", pricingRevision: "none", maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "md", capabilities: [...ALL_CAPS], delegable: [...ALL_CAPS], childProfile: "p", resources: frozen.resources } },
  };
  const cleanup = () => {
    const names = ["child", "peer"].flatMap(actor => [unitName(society, actor, "service"), unitName(society, actor, "path")]);
    for (const name of names) spawnSync("systemctl", ["--user", "disable", "--now", name], { encoding: "utf8", timeout: 30000 });
    spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8", timeout: 30000 });
  };
  return { society, units, mail, lifecycle, config, cleanup };
}
