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
  // Whether a Resident is confined changes what OMA can promise about it, so it
  // is a dashboard line rather than something only a runner log mentions.
  // `/` means no trusted rootfs was declared, because SB-001 forbids binding the
  // host root; anything else is the rootfs Residents are confined to.
  lines.push({ label: "Sandbox", value: config.installation.rootfs === "/"
    ? "비봉인 (신뢰 rootfs 미선언)" : `봉인 (${config.installation.rootfs})` });
  lines.push({ label: "Model", value: input.principalModel });
  // The engine owns inference and never reports spend to OMA (INF-001), so a
  // usage percentage here would be invented. Unknown is said, not guessed.
  lines.push({ label: "Usage", value: "unknown (엔진이 소유)" });
  return Object.freeze(lines);
}
