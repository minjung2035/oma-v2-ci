// MUST [UNIT-002/003]: pure rendering; no environment, filesystem or command reads.
import { StoreError } from "../domain/errors.js";

export interface RenderValues {
  node: string;
  libdir: string;
  state: string;
  society: string;
  agent: string;
  /** D03: the launch location the broker resolved. Rendered into ExecStart so a
   * unit-started process never re-derives it from the manager's environment. */
  config?: string;
  run?: string;
  /** D03: the lifetime dependency that actually exists for this deployment:
   * the fixed broker unit when systemd runs the broker, "" when it does not. */
  brokerUnit?: string;
  profileHex?: string;
  /** D05/WP25: hex of the accepted spec's canonical resource text. */
  resourcesHex?: string;
  memoryBytes?: number;
  tasks?: number;
  cpuQuotaPercent?: number;
}

/** Where a placeholder lands decides how systemd reads it. ExecStart words are
 * C-unescaped and `$`-expanded; path settings take the value verbatim and only
 * expand specifiers (observed on systemd 257). */
const ARGUMENT = new Set(["NODE", "LIBDIR", "CONFIG_ARG", "STATE_ARG", "RUN_ARG"]);
const PATH = new Set(["STATE"]);

export function renderUnit(template: string, values: RenderValues): string {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && /[\0\r\n]/.test(value))
      throw new StoreError("INVALID_REQUEST", `render value ${key} contains NUL/newline`);
  }
  const substitutions: Readonly<Record<string, string | number | undefined>> = {
    NODE: values.node, LIBDIR: values.libdir, STATE: values.state, STATE_ARG: values.state,
    CONFIG_ARG: values.config, RUN_ARG: values.run, BROKER_UNIT: values.brokerUnit,
    SOCIETY: values.society, AGENT: values.agent, PROFILE_HEX: values.profileHex, RESOURCES_HEX: values.resourcesHex,
    MEMORY_BYTES: values.memoryBytes, TASKS: values.tasks, CPU_QUOTA: values.cpuQuotaPercent,
  };
  for (const key of ["MEMORY_BYTES", "TASKS", "CPU_QUOTA"] as const) {
    const value = substitutions[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0))
      throw new StoreError("UNSUPPORTED_PROFILE", `${key} is not an enforceable positive integer`);
  }
  if (values.profileHex !== undefined && !/^(?:[0-9a-f]{2})+$/.test(values.profileHex))
    throw new StoreError("UNSUPPORTED_PROFILE", "profile must have a nonempty canonical hex encoding");
  if (values.resourcesHex !== undefined && !/^(?:[0-9a-f]{2})+$/.test(values.resourcesHex))
    throw new StoreError("UNSUPPORTED_PROFILE", "resources must have a nonempty canonical hex encoding");
  if (values.brokerUnit !== undefined && values.brokerUnit !== "" && !/^oma-[a-z0-9-]+\.service$/.test(values.brokerUnit))
    throw new StoreError("UNSUPPORTED_PROFILE", "broker dependency must be a fixed OMA service unit or none");
  return template.replace(/@([A-Z0-9_]+)@/g, (_placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(substitutions, key) || substitutions[key] === undefined)
      throw new StoreError("UNSUPPORTED_PROFILE", `unit template input is missing: ${key}`);
    const value = String(substitutions[key]);
    if (PATH.has(key)) {
      // A path setting keeps surrounding whitespace out of the value it reads.
      if (value.trim() !== value || value === "")
        throw new StoreError("UNSUPPORTED_PROFILE", `${key} cannot be a systemd path setting`);
      return value.replaceAll("%", "%%");
    }
    const word = ARGUMENT.has(key) ? value.replaceAll("$", () => "$$") : value;
    return word.replace(/[%\\\t "']/g, (char) =>
      char === "%" ? "%%" : `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  });
}
