import type { Actor, Capability } from "../../implementation/contracts/identity.js";
import type { AgentCreateInput } from "../../implementation/contracts/values.js";
import type { HostConfigV1, ResolvedAgentSpec } from "../../implementation/contracts/host.js";
import type { MessagePlan, OperationPlan } from "../../implementation/contracts/durable.js";

export interface LifecyclePaths { stateRoot: string; projectGit: string; society: string; hasGoal(): boolean; activationAllowed?: () => boolean }
export interface SpecResolver {
  (parent: { name: Actor; profile: string; role: "resident" | "principal"; desired: string; capabilities: readonly Capability[] }, input: AgentCreateInput): ResolvedAgentSpec | null;
  refresh?: () => void;
  revision?: () => string;
}
export type AgentQuota = Pick<HostConfigV1["quota"], "societyAgents" | "lineageAgents">;
export type SeedConfig = Pick<HostConfigV1, "initialResidents" | "principalProfile" | "agentProfiles" | "modelProfiles">;
export type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;
/** Preparation-only refinements of the existing DDL/wire plan. */
export type PhysicalCreatePlan = CreatePlan & { initialMessage: MessagePlan; existingCreation: null };
export type LinkedCreatePlan = CreatePlan & { initialMessage: null; existingCreation: string };
