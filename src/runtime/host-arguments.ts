/** CLI-001 / INV04: host words have one grammar before any host effect.
 * An option owns its next value, even when that value looks like an option.
 * `pi` hands its entire tail to the separate package-command grammar. */
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName } from "../domain/identifiers.js";
import { isUuid } from "../protocol/host-guest.js";
import { isSessionMode, type SessionMode } from "../domain/session-mode.js";

function refuse(message: string): never { throw new StoreError("INVALID_REQUEST", message); }
function options(args: readonly string[], spec: Readonly<Record<string, "flag" | "value">>, count: number) {
  const values = new Map<string, string | true>();
  const positional: string[] = [];
  let terminated = false;
  for (let index = 0; index < args.length; index++) {
    const word = args[index]!;
    if (terminated) { positional.push(word); continue; }
    if (word === "--") { terminated = true; continue; }
    if (!word.startsWith("-")) { positional.push(word); continue; }
    const name = word === "-h" ? "--help" : word;
    const kind = name === "--help" ? "flag" : Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (kind === undefined) refuse(`Unknown option ${word}`);
    if (values.has(name)) refuse(`${name} must be given once`);
    const value = kind === "flag" ? true : args[++index];
    if (value === undefined || value === "" || (typeof value === "string" && value.includes("\0"))) refuse(`${name} requires a nonempty value`);
    values.set(name, value);
  }
  const help = values.has("--help");
  if (positional.length !== count && !(help && positional.length === 0)) refuse(`Expected ${count} argument(s), got ${positional.length}`);
  return { positional, help, flag: (name: string) => values.get(name) === true,
    value: (name: string) => { const value = values.get(name); return typeof value === "string" ? value : undefined; } };
}
export type OmaArguments =
  | { readonly kind: "help" }
  | { readonly kind: "login" }
  | { readonly kind: "pi"; readonly args: readonly string[] }
  | { readonly kind: "session"; readonly society: string | undefined; readonly config: string | undefined; readonly bindProject: boolean; readonly mode?: SessionMode; readonly resume?: string };
export function parseOmaArguments(args: readonly string[]): OmaArguments {
  if (args[0] === "pi") return { kind: "pi", args: args.slice(1) };
  if (args[0] === "login") {
    const parsed = options(args.slice(1), {}, 0);
    return { kind: parsed.help ? "help" : "login" };
  }
  const parsed = options(args, { "--society": "value", "--config": "value", "--bind-project": "flag", "--mode": "value", "--resume": "value" }, 0);
  const society = parsed.value("--society");
  if (society !== undefined && !isValidSocietyName(society)) refuse("Invalid society name");
  const mode = parsed.value("--mode");
  if (mode !== undefined && !isSessionMode(mode)) refuse("--mode must be society or personal");
  if (mode === "personal" && (society !== undefined || parsed.value("--config") !== undefined || parsed.flag("--bind-project")))
    refuse("Personal mode does not take --society, --config or --bind-project");
  const resume = parsed.value("--resume");
  if (resume !== undefined && (society !== undefined || parsed.value("--config") !== undefined || parsed.flag("--bind-project")))
    refuse("--resume does not take --society, --config or --bind-project");
  return parsed.help ? { kind: "help" } : { kind: "session", society, config: parsed.value("--config"),
    bindProject: parsed.flag("--bind-project"), ...(mode === undefined ? {} : { mode }), ...(resume === undefined ? {} : { resume }) };
}
export type MacArguments =
  | Extract<OmaArguments, { kind: "session" }>
  | { readonly kind: "help" | "status" | "list" | "stop" }
  | { readonly kind: "pi"; readonly args: readonly string[] }
  | { readonly kind: "attach"; readonly society: string; readonly takeover: boolean }
  | { readonly kind: "bind"; readonly society: string }
  | { readonly kind: "open"; readonly society: string; readonly projectId: string };
export function parseMacArguments(args: readonly string[]): MacArguments {
  const [command, ...rest] = args;
  if (command === undefined || command.startsWith("-")) {
    const parsed = parseOmaArguments(args);
    if (parsed.kind !== "session" && parsed.kind !== "help") return refuse("Expected a session or help");
    if (parsed.kind === "session" && (parsed.config !== undefined || parsed.bindProject))
      refuse("Mac Society configuration and project binding belong to the app; use open or attach");
    return parsed.kind === "help" ? { kind: "help" } : parsed;
  }
  if (command === "pi") return { kind: "pi", args: rest };
  if (command === "status" || command === "list" || command === "stop") {
    const parsed = options(rest, {}, 0);
    return { kind: parsed.help ? "help" : command };
  }
  if (command === "bind") {
    const parsed = options(rest, {}, 1);
    if (parsed.help) return { kind: "help" };
    if (!isValidSocietyName(parsed.positional[0])) refuse("Invalid society name");
    return { kind: "bind", society: parsed.positional[0]! };
  }
  if (command !== "open" && command !== "attach") refuse("Expected attach, status, list, bind, open, stop or pi");
  const parsed = options(rest, command === "open" ? { "--project": "value" } : { "--takeover": "flag" }, 1);
  if (parsed.help) return { kind: "help" };
  const society = parsed.positional[0]!;
  if (!isValidSocietyName(society)) refuse("Invalid society name");
  if (command === "attach") return { kind: "attach", society, takeover: parsed.flag("--takeover") };
  const projectId = parsed.value("--project");
  if (!isUuid(projectId)) refuse("--project requires a project id");
  return { kind: "open", society, projectId };
}
