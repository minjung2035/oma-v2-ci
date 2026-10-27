/** TUI-012: the Dashboard's rows, worded from structured data.
 *
 * Every value is either something observed or an explicit unknown carrying why
 * and when. Nothing here turns a missing observation into "ready", "0" or
 * "inactive" (arch §23.5, MAINTENANCE §10).
 */
import type { DashboardData } from "../model.js";

export interface DashboardRow { readonly label: string; readonly value: string }

function clock(observedAtMs: number): string {
  const time = new Date(observedAtMs);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${two(time.getHours())}:${two(time.getMinutes())}:${two(time.getSeconds())}`;
}

export function dashboardRows(data: DashboardData): readonly DashboardRow[] {
  const rows: DashboardRow[] = [];
  const seen = data.status;
  if (seen.kind === "observed") {
    rows.push({ label: "Workers", value: `${seen.created} created` });
    rows.push({ label: "Active", value: seen.active === null ? `unknown (Unit not observed; ${clock(seen.observedAtMs)} observed)` : String(seen.active) });
    rows.push({ label: "Pending", value: `${seen.pending} (${clock(seen.observedAtMs)} observed)` });
    rows.push({ label: "Status", value: `observed (${clock(seen.observedAtMs)})` });
  } else {
    const unknown = `unknown (${seen.reason}; ${clock(seen.observedAtMs)} observed)`;
    // A configured seed count is not a running count; it is labelled as config.
    rows.push({ label: "Workers", value: `${data.configuredWorkers} configured` });
    rows.push({ label: "Active", value: unknown });
    rows.push({ label: "Pending", value: unknown });
    rows.push({ label: "Status", value: unknown });
  }
  // WP28, P0V-66: what waits for the Principal's session is the ledger's count
  // -- messages in no batch and in a prepared one. A batch is prepared, and
  // its messages leave `new/`, before the session takes it (a session in a
  // turn defers it), so `new/` alone is only what arrived and is in no batch
  // yet. Neither is whether the Human has looked at a message, and opening
  // one here changes nothing. arch §23.5: what could not be read is unknown.
  const waiting = seen.kind !== "observed" ? `unknown (${seen.reason}; ${clock(seen.observedAtMs)} observed)`
    : seen.principalPending === null ? `unknown (Principal absent from observation; ${clock(seen.observedAtMs)} observed)`
    : `${seen.principalPending} pending delivery to the Principal session (${clock(seen.observedAtMs)} observed)`;
  const arrived = data.unread === null ? "New arrivals unknown (mailbox unreadable)" : `${data.unread} new arrivals`;
  rows.push({ label: "Mail", value: `${waiting} · ${arrived}` });
  // WP15.05: configured is not observed. The session's value is what this
  // product started it with, not the engine's own report.
  // DR24: a profile that leaves the model to the engine has no model of its
  // own to show; the engine's report is the model, and until it comes, unknown.
  const model = data.principalModel;
  if (model.engineManaged === true)
    rows.push({ label: "Principal model", value: model.engine === undefined ? "unknown (Not reported by the engine yet)"
      : `${model.engine} (running; Config > Principal model changes it)` });
  else {
    if (model.engine !== undefined) rows.push({ label: "Engine", value: `${model.engine} (running)` });
    rows.push({ label: "Model", value: model.session === null ? `${model.configured} (Configured; no running session)`
      : model.session === model.configured ? `${model.configured} (Configured; current session started with this setting)`
      : `${model.configured} (Configured; next session; current session started with ${model.session})` });
  }
  if (data.workerModel !== undefined) rows.push({ label: "Worker model", value: data.workerModel });
  // Declared confinement is not evidence that a Resident is running.
  rows.push({ label: "Sandbox", value: "Required" });
  // The engine owns inference and never reports spend to OMA (INF-001), so a
  // usage figure here would be invented.
  rows.push({ label: "Usage", value: "unknown (Owned by the engine)" });
  return Object.freeze(rows);
}
