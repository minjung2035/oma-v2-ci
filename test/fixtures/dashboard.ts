// Test-only Dashboard data. Structured, as the view receives it.
import type { DashboardData } from "../../src/tui/model.js";

export function unknownDashboard(reason = "broker 미연결"): DashboardData {
  return Object.freeze({
    status: Object.freeze({ kind: "unknown" as const, observedAtMs: Date.UTC(2026, 8, 18), reason }),
    configuredWorkers: 0, workerLimit: 8, unread: 0, principalModel: Object.freeze({ configured: "strong", session: null }), rootfs: null,
  });
}
