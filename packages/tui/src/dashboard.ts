/** TUI-012: the Dashboard's data. Pure.
 *
 * Interprets configuration and the latest observation into `DashboardData`.
 * It never converts a missing observation into "ready", "0" or "inactive"
 * (arch §23.5); wording is the view's (`view/dashboard.ts`).
 */
import type { AgentStatus, HostConfig } from "@oma/contracts";
import { NO_UNIT_REASON } from "@oma/protocol/status-view";
import type { DashboardData } from "./model.js";
import type { Observation } from "@oma/protocol/status-view";

export interface DashboardInput {
  readonly config: HostConfig;
  readonly principalModel: DashboardData["principalModel"];
  readonly workerModel?: string;
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

/** CREATE-003: every registered Resident consumes a creation slot, including retired ones. */
export function createdCount(statuses: readonly AgentStatus[]): number {
  return statuses.filter(status => status.agent !== "principal").length;
}

export function dashboardData(input: DashboardInput): DashboardData {
  const { config, observation } = input;
  const status: DashboardData["status"] = observation.kind === "observed"
    ? {
      kind: "observed", observedAtMs: observation.observedAtMs,
      created: createdCount(observation.statuses), active: activeCount(observation.statuses),
      // NB-05: residents only, like `created`/`active` -- the Principal's
      // pending count is reported separately as `principalPending`; adding it
      // here would double-report it on one screen.
      pending: observation.statuses.reduce((total, row) => row.agent === "principal" ? total : total + row.pending, 0),
      principalPending: observation.statuses.find(row => row.agent === "principal")?.pending ?? null,
    }
    : { kind: "unknown", observedAtMs: observation.observedAtMs, reason: observation.reason };
  return Object.freeze({
    status,
    configuredWorkers: config.initialResidents.length,
    unread: input.unread,
    principalModel: input.principalModel,
    ...(input.workerModel === undefined ? {} : { workerModel: input.workerModel }),
  });
}
