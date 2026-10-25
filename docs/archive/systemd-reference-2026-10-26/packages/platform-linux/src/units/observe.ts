import { parseCgroupPopulation } from "@oma/domain/cgroup-population";
// MUST [UNIT-005/006]: malformed or incomplete observations never establish success/death.
import type { UnitObservation } from "@oma/contracts/runtime";
import type { UnitCommandOutcome } from "./execute.js";

const REQUIRED = ["ActiveState", "SubState", "Result", "ExecMainStatus", "ControlGroup", "InvocationID"] as const;
export function parseProperties(bytes: string, required: readonly string[]): ReadonlyMap<string, string> | null {
  const values = new Map<string, string>();
  for (const line of bytes.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || /[\0\r]/.test(line)) return null;
    const key = line.slice(0, separator);
    if (values.has(key)) return null;
    values.set(key, line.slice(separator + 1));
  }
  return required.every((key) => values.has(key)) ? values : null;
}

export function unknownObservation(): UnitObservation {
  return { activeState: "unknown", subState: "unknown", result: "unknown", execMainStatus: -1, cgroup: "", invocationId: "" };
}

export function parseUnitObservation(command: UnitCommandOutcome): UnitObservation {
  if (command.kind !== "succeeded") return unknownObservation();
  const values = parseProperties(command.stdout, REQUIRED);
  if (!values) return unknownObservation();
  const activeState = values.get("ActiveState")!;
  const subState = values.get("SubState")!;
  const result = values.get("Result")!;
  const rawStatus = values.get("ExecMainStatus")!;
  const cgroup = values.get("ControlGroup")!;
  const invocationId = values.get("InvocationID")!;
  if (!["active", "reloading", "inactive", "failed", "activating", "deactivating", "maintenance", "refreshing"].includes(activeState) ||
      !/^[a-z][a-z0-9-]*$/.test(subState) || !/^[a-z][a-z0-9-]*$/.test(result) ||
      !/^(0|[1-9]\d*)$/.test(rawStatus) || !Number.isSafeInteger(Number(rawStatus)) ||
      (invocationId !== "" && !/^[0-9a-f]{32}$/.test(invocationId)) ||
      (cgroup !== "" && (!cgroup.startsWith("/") || cgroup === "/" || cgroup.split("/").some((part) => part === "." || part === ".."))))
    return unknownObservation();
  return { activeState, subState, result, execMainStatus: Number(rawStatus), cgroup, invocationId };
}

export function parseCgroupProcs(bytes: string): number[] | null {
  const pids: number[] = [];
  for (const line of bytes.split("\n")) {
    if (!line) continue;
    if (!/^[1-9]\d*$/.test(line) || !Number.isSafeInteger(Number(line))) return null;
    pids.push(Number(line));
  }
  return pids;
}
