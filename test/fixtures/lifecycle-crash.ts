import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { join } from "node:path";
import { cleanupOwnedSystemdUnits, requireSystemdTestManager } from "./systemd.js";
import { LifecycleModule } from "@oma/lifecycle";
import { UnitsModule } from "@oma/platform-linux/units";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ALL_CAPS, makeValidResolvedSpec } from "./spec.js";
import { TEST_VIEW_LIMITS } from "./limits.js";

export function lifecycleFixture(root: string, store: Store) {
  requireSystemdTestManager();
  const society = `bc${sha256Hex(root).slice(0, 20)}`;
  const frozen = makeValidResolvedSpec("child");
  const units = new UnitsModule(society, {
    node: process.execPath, libdir: process.cwd(), state: root, society, agent: "", config: join(root, "config.json"), run: join(root, "oma", society)
  }, join(root, "units"));
  const mail = createMailModule({ stateRoot: root, society }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
  const lifecycle = createLifecycleModule(store, units, {
    stateRoot: root, projectGit: join(root, "repos/project.git"), society, hasGoal: () => false,
    activationAllowed: () => true,
  }, (_parent, input) => ({ ...frozen, ...input }), mail);
  const config: Parameters<LifecycleModule["bootstrap"]>[0] = {
    principalProfile: "p", initialResidents: [{ name: "child", profile: "p", brief: "first" }, { name: "peer", profile: "p", brief: "second" }],
    modelProfiles: { md: { provider: "none", model: "none", inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "md", capabilities: [...ALL_CAPS], delegable: [...ALL_CAPS], childProfile: "p" } },
  };
  const cleanup = () => cleanupOwnedSystemdUnits(root, society);
  return { society, units, mail, lifecycle, config, cleanup };
}
