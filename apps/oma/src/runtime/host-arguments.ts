/** CLI-001 / INV04: host words have one grammar before any host effect.
 * An option owns its next value, even when that value looks like an option.
 * `pi` hands its entire tail to the separate package-command grammar. */
import { StoreError } from "@oma/domain/errors";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { isSessionMode, type SessionMode } from "@oma/domain/session-mode";

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
  | { readonly kind: "archive"; readonly society: string; readonly config: string | undefined }
  | { readonly kind: "recover-execution"; readonly society: string; readonly config: string | undefined; readonly phase: "prepare" | "apply" }
  | { readonly kind: "pi"; readonly args: readonly string[] }
  | { readonly kind: "session"; readonly society: string | undefined; readonly config: string | undefined; readonly bindProject: boolean; readonly mode?: SessionMode; readonly resume?: string; readonly noProjectExtensions?: true; readonly surface?: "collaboration-v1" };
export function parseOmaArguments(args: readonly string[]): OmaArguments {
  if (["attach", "open", "bind", "stop", "status", "list"].includes(args[0] ?? ""))
    refuse("The macOS VM commands have been retired. Start a native session with oma; existing VM data is preserved and is not migrated.");
  if (args[0] === "recover-execution") {
    const parsed = options(args.slice(1), { "--society": "value", "--config": "value", "--prepare": "flag", "--apply": "flag" }, 0);
    if (parsed.help) return { kind: "help" };
    const society = parsed.value("--society");
    if (society === undefined || !isValidSocietyName(society)) refuse("recover-execution requires a valid --society");
    if (parsed.flag("--prepare") === parsed.flag("--apply")) refuse("recover-execution requires exactly one of --prepare or --apply");
    return { kind: "recover-execution", society, config: parsed.value("--config"), phase: parsed.flag("--prepare") ? "prepare" : "apply" };
  }
  if (args[0] === "archive") {
    const parsed = options(args.slice(1), { "--society": "value", "--config": "value" }, 0);
    if (parsed.help) return { kind: "help" };
    const society = parsed.value("--society");
    if (society === undefined || !isValidSocietyName(society)) refuse("archive requires a valid --society");
    return { kind: "archive", society, config: parsed.value("--config") };
  }
  if (args[0] === "pi") return { kind: "pi", args: args.slice(1) };
  if (args[0] === "login") {
    const parsed = options(args.slice(1), {}, 0);
    return { kind: parsed.help ? "help" : "login" };
  }
  const parsed = options(args, { "--society": "value", "--config": "value", "--bind-project": "flag", "--mode": "value", "--resume": "value", "--no-project-extensions": "flag", "--surface": "value" }, 0);
  const society = parsed.value("--society");
  if (society !== undefined && !isValidSocietyName(society)) refuse("Invalid society name");
  const mode = parsed.value("--mode");
  if (mode !== undefined && !isSessionMode(mode)) refuse("--mode must be society or personal");
  if (mode === "personal" && (society !== undefined || parsed.value("--config") !== undefined || parsed.flag("--bind-project")))
    refuse("Personal mode does not take --society, --config or --bind-project");
  const resume = parsed.value("--resume");
  const noProjectExtensions = parsed.flag("--no-project-extensions");
  if (noProjectExtensions && (mode !== "personal" || resume !== undefined))
    refuse("--no-project-extensions requires a new --mode personal session");
  if (resume !== undefined && (society !== undefined || parsed.value("--config") !== undefined || parsed.flag("--bind-project")))
    refuse("--resume does not take --society, --config or --bind-project");
  const surface = parsed.value("--surface");
  if (surface !== undefined && surface !== "collaboration-v1") refuse("--surface must be collaboration-v1; retired Society execution cannot be selected");
  if (surface !== undefined && mode === "personal") refuse("Personal mode has no Society collaboration surface");
  return parsed.help ? { kind: "help" } : { kind: "session", society, config: parsed.value("--config"),
    bindProject: parsed.flag("--bind-project"), ...(mode === undefined ? {} : { mode }), ...(resume === undefined ? {} : { resume }),
    ...(surface === undefined ? {} : { surface }), ...(noProjectExtensions ? { noProjectExtensions: true as const } : {}) };
}
