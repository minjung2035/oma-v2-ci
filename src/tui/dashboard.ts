/** TUI-012: the Dashboard's data. Pure.
 *
 * Interprets configuration and the latest observation into `DashboardData`.
 * It never converts a missing observation into "ready", "0" or "inactive"
 * (arch §23.5); wording is the view's (`view/dashboard.ts`).
 */
import type { AgentStatus, HostConfigV1 } from "../../implementation/contracts.js";
import { NO_UNIT_REASON } from "../protocol/status-view.js";
import type { DashboardData } from "./model.js";
import type { Observation } from "./transport.js";

export interface DashboardInput {
  readonly config: HostConfigV1;
  readonly principalModel: DashboardData["principalModel"];
  readonly unread: number | null;
  readonly observation: Observation;
}

/** Residents only. The Principal is not a worker and is reported separately.
 *
 * P0V-39, P0-5: a status file that was read is not a unit that was observed.
 * A Resident whose unit could not be observed has no active state (null), and
 * counting only the ones that said "active" would show that as 0 -- so any such
 * Resident leaves the count unknown. A unit that does not exist was observed:
 * it is not active. */
export function activeCount(statuses: readonly AgentStatus[]): number | null {
  const residents = statuses.filter(status => status.agent !== "principal");
  if (residents.some(status => status.activeState === null && status.reason !== NO_UNIT_REASON)) return null;
  return residents.filter(status => status.activeState === "active").length;
}

export function readyCount(statuses: readonly AgentStatus[]): number {
  return statuses.filter(status => status.agent !== "principal" && status.desired !== "retired").length;
}

export function dashboardData(input: DashboardInput): DashboardData {
  const { config, observation } = input;
  const status: DashboardData["status"] = observation.kind === "observed"
    ? {
      kind: "observed", observedAtMs: observation.observedAtMs,
      ready: readyCount(observation.statuses), active: activeCount(observation.statuses),
      pending: observation.statuses.reduce((total, row) => total + row.pending, 0),
      principalPending: observation.statuses.find(row => row.agent === "principal")?.pending ?? null,
    }
    : { kind: "unknown", observedAtMs: observation.observedAtMs, reason: observation.reason };
  return Object.freeze({
    status,
    configuredWorkers: config.initialResidents.length,
    workerLimit: config.quota.societyAgents,
    unread: input.unread,
    principalModel: input.principalModel,
    // `/` is not a rootfs: SB-001 forbids binding the host root, so the value
    // means none was declared.
    rootfs: config.installation.rootfs === "/" ? null : config.installation.rootfs,
  });
}
