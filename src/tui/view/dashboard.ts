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
    rows.push({ label: "Workers", value: `${seen.ready} / ${data.workerLimit}` });
    rows.push({ label: "Active", value: seen.active === null ? `unknown (unit을 관측하지 못함; ${clock(seen.observedAtMs)} 관측)` : String(seen.active) });
    rows.push({ label: "Pending", value: `${seen.pending} (${clock(seen.observedAtMs)} 관측)` });
    rows.push({ label: "Status", value: `observed (${clock(seen.observedAtMs)})` });
  } else {
    const unknown = `unknown (${seen.reason}; ${clock(seen.observedAtMs)} 관측)`;
    // A configured seed count is not a running count; it is labelled as config.
    rows.push({ label: "Workers", value: `${data.configuredWorkers} configured / ${data.workerLimit} limit` });
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
  const waiting = seen.kind !== "observed" ? `unknown (${seen.reason}; ${clock(seen.observedAtMs)} 관측)`
    : seen.principalPending === null ? `unknown (관측에 Principal이 없음; ${clock(seen.observedAtMs)} 관측)`
    : `${seen.principalPending}건 Principal 세션에 전달 대기 (${clock(seen.observedAtMs)} 관측)`;
  const arrived = data.unread === null ? "새 도착 unknown (메일함을 읽지 못함)" : `새 도착 ${data.unread}건`;
  rows.push({ label: "Mail", value: `${waiting} · ${arrived}` });
  // WP15.05: configured is not observed. The session's value is what this
  // product started it with, not the engine's own report.
  const model = data.principalModel;
  rows.push({ label: "Model", value: model.session === null ? `${model.configured} (설정값 · 실행 중인 세션 없음)`
    : model.session === model.configured ? `${model.configured} (설정값 · 현재 세션도 이 설정으로 시작)`
    : `${model.configured} (설정값 · 다음 세션부터 · 현재 세션은 ${model.session}로 시작)` });
  // Whether a Resident is confined changes what OMA can promise about it.
  rows.push({ label: "Sandbox", value: data.rootfs === null ? "비봉인 (신뢰 rootfs 미선언)" : `봉인 (${data.rootfs})` });
  // The engine owns inference and never reports spend to OMA (INF-001), so a
  // usage figure here would be invented.
  rows.push({ label: "Usage", value: "unknown (엔진이 소유)" });
  return Object.freeze(rows);
}
