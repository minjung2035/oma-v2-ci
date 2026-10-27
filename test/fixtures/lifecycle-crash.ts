import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { join } from "node:path";
import { LifecycleModule } from "@oma/lifecycle";
import { ResidentRuntime } from "@oma/process/resident-runtime";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ALL_CAPS, makeValidResolvedSpec } from "./spec.js";
import { TEST_VIEW_LIMITS } from "./limits.js";

export function lifecycleFixture(root: string, store: Store, afterRegistration?: () => void) {
  const society = `bc${sha256Hex(root).slice(0, 20)}`;
  const frozen = makeValidResolvedSpec("child");
  // These crash cases exercise pre-GOAL provisioning, where no process may
  // execute. Registration is the production common owner; an unexpected
  // launch fails the fixture instead of inventing a native death proof.
  let attempts = 0;
  let incarnation = (actor: string): number | null => store.getAgent(actor)?.incarnation ?? null;
  const units = Object.assign(new ResidentRuntime({
    references: actor => { const row = store.getAgent(actor); if (!row) throw new Error("missing accepted Resident");
      const spec = resolvedSpecOf(row); return { profile: spec.profile, modelProfile: spec.modelProfile }; },
    incarnation: actor => incarnation(actor),
    async begin() { attempts++; throw new Error("pre-GOAL fixture attempted execution"); },
    confirmDead: () => attempts === 0, revoke() {}, hint() {}, failure(error) { throw error; },
  }), { bindIncarnationReader(reader: (actor: string) => number | null) { incarnation = reader; } });
  const register = units.ensureResident.bind(units);
  units.ensureResident = (...args) => { register(...args); afterRegistration?.(); };
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
  const cleanup = () => { if (attempts !== 0) throw new Error("pre-GOAL fixture acquired a process lifetime"); };
  return { society, units, mail, lifecycle, config, cleanup };
}
