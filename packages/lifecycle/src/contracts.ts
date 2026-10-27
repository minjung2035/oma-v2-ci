import type { Actor, Capability } from "@oma/contracts/identity";
import type { AgentCreateInput } from "@oma/contracts/values";
import type { HostConfig, ResolvedAgentSpec } from "@oma/contracts/host";
import type { MessagePlan, OperationPlan } from "@oma/contracts/durable";

export interface LifecyclePaths {
  stateRoot: string; society: string; hasGoal(): boolean; activationAllowed(): boolean;
}
export interface SpecResolver {
  (parent: { name: Actor; profile: string; role: "resident" | "principal"; desired: string; capabilities: readonly Capability[] }, input: AgentCreateInput): ResolvedAgentSpec | null;
  refresh?: () => void;
  revision?: () => string;
}
export type SeedConfig = Pick<HostConfig, "initialResidents" | "principalProfile" | "agentProfiles" | "modelProfiles">;
export type CreatePlan = Extract<OperationPlan, { kind: "agent.create" }>;
/** Preparation-only refinements of the existing DDL/wire plan. */
export type PhysicalCreatePlan = CreatePlan & { initialMessage: MessagePlan; existingCreation: null };
export type LinkedCreatePlan = CreatePlan & { initialMessage: null; existingCreation: string };
