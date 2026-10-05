// MUST [UNIT-002/003]: pure rendering; no environment, filesystem or command reads.
import { StoreError } from "../domain/errors.js";
import { ACTOR_NAME_RE, isValidSocietyName } from "../domain/identifiers.js";

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
  profileHex?: string;
  /** D05/WP25: hex of the accepted spec's canonical resource text. */
  resourcesHex?: string;
  /** D23/TSP-005: hex of the deployment's encoded Resident tool-surface
   * plan -- OMA policy the runner reads once and hands the engine. */
  toolSurfaceHex?: string;
  memoryBytes?: number;
  tasks?: number;
  cpuQuotaPercent?: number;
}

/** Where a placeholder lands decides how systemd reads it. ExecStart words are
 * C-unescaped and `$`-expanded; path settings take the value verbatim and only
 * expand specifiers (observed on systemd 257). */
const ARGUMENT = new Set(["NODE", "LIBDIR", "CONFIG_ARG", "STATE_ARG", "RUN_ARG"]);
const PATH = new Set(["STATE"]);
/** P0V-115 (G05-02): a society's and an agent's name land in ExecStart words,
 * a Description, a Unit= and a watched path alike, and no one escape reads
 * the same in all of them. Only a name that needs none is rendered -- this
 * renderer's own rule, not one it trusts its callers to have kept. */
const NAME: Readonly<Record<string, (value: string) => boolean>> = {
  SOCIETY: isValidSocietyName,
  AGENT: value => ACTOR_NAME_RE.test(value),
};

export function renderUnit(template: string, values: RenderValues): string {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && /[\0\r\n]/.test(value))
      throw new StoreError("INVALID_REQUEST", `render value ${key} contains NUL/newline`);
  }
  const substitutions: Readonly<Record<string, string | number | undefined>> = {
    NODE: values.node, LIBDIR: values.libdir, STATE: values.state, STATE_ARG: values.state,
    CONFIG_ARG: values.config, RUN_ARG: values.run,
    SOCIETY: values.society, AGENT: values.agent, PROFILE_HEX: values.profileHex, RESOURCES_HEX: values.resourcesHex,
    TOOL_SURFACE_HEX: values.toolSurfaceHex,
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
  if (values.toolSurfaceHex !== undefined && !/^(?:[0-9a-f]{2})+$/.test(values.toolSurfaceHex))
    throw new StoreError("UNSUPPORTED_PROFILE", "tool surface must have a nonempty canonical hex encoding");
  return template.replace(/@([A-Z0-9_]+)@/g, (_placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(substitutions, key) || substitutions[key] === undefined)
      throw new StoreError("UNSUPPORTED_PROFILE", `unit template input is missing: ${key}`);
    const value = String(substitutions[key]);
    if (Object.prototype.hasOwnProperty.call(NAME, key) && !NAME[key]!(value))
      throw new StoreError("INVALID_REQUEST", `${key} is not a name a unit can carry`);
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
