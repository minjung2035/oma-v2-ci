import { isValidRequestKey } from "../ids.js";
import { fail } from "./exit.js";

export function opt(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : null;
}

export function multiOpt(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1] !== undefined) {
      const value = args[index + 1]!;
      if (!value.startsWith("--")) out.push(value);
    }
  }
  return out;
}

export function positional(args: string[], optionNames: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (optionNames.includes(value)) {
      index++;
      continue;
    }
    out.push(value);
  }
  return out;
}

export function keyOf(args: string[]): string | null {
  const key = opt(args, "--request");
  if (args.includes("--request") && key === null) fail("--request requires a value", 2);
  if (args.indexOf("--request") !== args.lastIndexOf("--request")) fail("--request must be specified once", 2);
  if (key !== null && !isValidRequestKey(key)) fail(`invalid request key ${key}`, 2);
  return key;
}
