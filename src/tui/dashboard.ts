/** TUI-012: Dashboard projection. Pure.
 *
 * Every line is either a value this process actually observed or an explicit
 * unknown carrying why and when. Nothing here converts a missing observation
 * into "ready", "0" or "inactive" (arch §23.5, MAINTENANCE §10).
 */
import type { AgentStatus, HostConfigV1 } from "../../implementation/contracts.js";
import type { DashboardLine } from "./model.js";
import type { Observation } from "./transport.js";

export interface DashboardInput {
  readonly config: HostConfigV1;
  readonly principalModel: string;
  readonly unread: number;
  readonly observation: Observation;
}

function clock(observedAtMs: number): string {
  const time = new Date(observedAtMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

function unknown(observation: Extract<Observation, { kind: "unknown" }>): string {
  return `unknown (${observation.reason}; ${clock(observation.observedAtMs)} 관측)`;
}

/** Residents only. The Principal is not a worker and is reported separately. */
export function activeCount(statuses: readonly AgentStatus[]): number {
  return statuses.filter(status => status.agent !== "principal" && status.activeState === "active").length;
}

export function readyCount(statuses: readonly AgentStatus[]): number {
  return statuses.filter(status => status.agent !== "principal" && status.desired !== "retired").length;
}

export function dashboardLines(input: DashboardInput): readonly DashboardLine[] {
  const { config, observation } = input;
  const limit = config.quota.societyAgents;
  const lines: DashboardLine[] = [];
  if (observation.kind === "observed") {
    const { statuses, observedAtMs } = observation;
    const pending = statuses.reduce((total, status) => total + status.pending, 0);
    lines.push({ label: "Workers", value: `${readyCount(statuses)} / ${limit}` });
    lines.push({ label: "Active", value: String(activeCount(statuses)) });
    lines.push({ label: "Pending", value: `${pending} (${clock(observedAtMs)} 관측)` });
    lines.push({ label: "Status", value: `observed (${clock(observedAtMs)})` });
  } else {
    // A configured seed count is not a running count; it is labelled as config.
    lines.push({ label: "Workers", value: `${config.initialResidents.length} configured / ${limit} limit` });
    lines.push({ label: "Active", value: unknown(observation) });
    lines.push({ label: "Pending", value: unknown(observation) });
    lines.push({ label: "Status", value: unknown(observation) });
  }
  lines.push({ label: "Mail", value: `${input.unread} unread` });
  lines.push({ label: "Model", value: input.principalModel });
  // S-04 keeps per-request cost bounds open, so no usage percentage is shown.
  lines.push({ label: "Usage", value: "unknown (S-04 가격 codec 미확정)" });
  return Object.freeze(lines);
}
