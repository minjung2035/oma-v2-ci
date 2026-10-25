/** CLI-001's grammar with one owner (INV04): a value is data, never an option.
 *
 * The CLI is started by people and by the trusted extension on a model's
 * behalf, and in both cases some of its arguments are values another party
 * chose -- an address, a subject, a message path. A parser that looks an option
 * up by its first occurrence, ignores options it does not know and drops a
 * value that happens to begin with `--` lets such a value become an option:
 * one address spelled `--file` followed by a path made the CLI read that path
 * as the mail body, ahead of the option the caller had actually given.
 *
 * So every command declares the options it takes, and the parser admits
 * exactly those: each at most once unless declared repeatable, a value taken
 * verbatim from the next argument whatever it looks like, anything else that
 * looks like an option refused, and everything after `--` positional. What a
 * value is follows from where it stands, never from how it is spelled.
 */
import { isValidRequestKey } from "@oma/domain/identifiers";
import { fail } from "./exit.js";

/** `value`: exactly one value, at most once. `values`: one value per
 * occurrence, any number of times. */
export type OptionKind = "value" | "values";
export interface ArgumentSpec {
  readonly options: Readonly<Record<string, OptionKind>>;
  readonly positional: { readonly min: number; readonly max: number };
}
export interface ParsedArguments {
  readonly positional: readonly string[];
  /** The option's value, or null when it was not given. */
  value(name: string): string | null;
  /** Every value of a repeatable option, in order. */
  values(name: string): readonly string[];
}

/** Anything a caller could mean as an option. A value that must look like one
 * goes after `--`, or in the slot of the option that owns it. */
const optionLike = (token: string): boolean => token.length > 1 && token.startsWith("-");

export function parseArguments(args: readonly string[], spec: ArgumentSpec): ParsedArguments {
  const given = new Map<string, string[]>();
  const positional: string[] = [];
  let terminated = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (terminated) { positional.push(token); continue; }
    if (token === "--") { terminated = true; continue; }
    if (!optionLike(token)) { positional.push(token); continue; }
    const kind = Object.hasOwn(spec.options, token) ? spec.options[token] : undefined;
    if (kind === undefined) fail(`unknown option ${token}`, 2);
    const value = args[index + 1];
    if (value === undefined) fail(`${token} requires a value`, 2);
    index++;
    const values = given.get(token) ?? [];
    if (kind === "value" && values.length > 0) fail(`${token} must be given once`, 2);
    values.push(value);
    given.set(token, values);
  }
  if (positional.length < spec.positional.min || positional.length > spec.positional.max)
    fail(`expected ${spec.positional.min === spec.positional.max ? spec.positional.min : `${spec.positional.min}..${spec.positional.max}`} argument(s), got ${positional.length}`, 2);
  const declared = (name: string): void => {
    if (!Object.hasOwn(spec.options, name)) throw new TypeError(`option ${name} is not declared by this command`);
  };
  return Object.freeze({
    positional: Object.freeze(positional),
    value(name: string): string | null { declared(name); return given.get(name)?.[0] ?? null; },
    values(name: string): readonly string[] { declared(name); return Object.freeze([...(given.get(name) ?? [])]); },
  });
}

export function splitSubcommand(args: readonly string[], options: ArgumentSpec["options"]): { name: string; rest: string[] } {
  const parsed = parseArguments(args, { options, positional: { min: 1, max: Number.MAX_SAFE_INTEGER } });
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (token === "--") index++;
    else if (optionLike(token)) { index++; continue; }
    return { name: parsed.positional[0]!, rest: [...args.slice(0, index), ...args.slice(index + 1)] };
  }
  throw new TypeError("parsed subcommand has no argument slot");
}

/** The request key a mutation was given, validated, or null. */
export function keyOf(parsed: ParsedArguments): string | null {
  const key = parsed.value("--request");
  if (key !== null && !isValidRequestKey(key)) fail(`invalid request key ${key}`, 2);
  return key;
}
