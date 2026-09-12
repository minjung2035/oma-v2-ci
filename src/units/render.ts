// MUST [UNIT-002/003]: pure rendering; no environment, filesystem or command reads.
import { StoreError } from "../domain/errors.js";

export interface RenderValues {
  node: string;
  libdir: string;
  state: string;
  society: string;
  agent: string;
  profileHex?: string;
  memoryBytes?: number;
  tasks?: number;
  cpuQuotaPercent?: number;
}

export function renderUnit(template: string, values: RenderValues): string {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && /[\0\r\n]/.test(value))
      throw new StoreError("INVALID_REQUEST", `render value ${key} contains NUL/newline`);
  }
  const substitutions: Readonly<Record<string, string | number | undefined>> = {
    NODE: values.node, LIBDIR: values.libdir, STATE: values.state,
    SOCIETY: values.society, AGENT: values.agent, PROFILE_HEX: values.profileHex,
    MEMORY_BYTES: values.memoryBytes, TASKS: values.tasks, CPU_QUOTA: values.cpuQuotaPercent,
  };
  for (const key of ["MEMORY_BYTES", "TASKS", "CPU_QUOTA"] as const) {
    const value = substitutions[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0))
      throw new StoreError("UNSUPPORTED_PROFILE", `${key} is not an enforceable positive integer`);
  }
  if (values.profileHex !== undefined && !/^(?:[0-9a-f]{2})+$/.test(values.profileHex))
    throw new StoreError("UNSUPPORTED_PROFILE", "profile must have a nonempty canonical hex encoding");
  return template.replace(/@([A-Z0-9_]+)@/g, (_placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(substitutions, key) || substitutions[key] === undefined)
      throw new StoreError("UNSUPPORTED_PROFILE", `unit template input is missing: ${key}`);
    let value = String(substitutions[key]);
    if (key === "NODE" || key === "LIBDIR") value = value.replaceAll("$", () => "$$");
    return value.replace(/[%\\\t "']/g, (char) =>
      char === "%" ? "%%" : `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  });
}
