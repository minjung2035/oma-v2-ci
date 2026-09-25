import { FULL_OID_RE } from "../../ids.js";
import { keyOf, parseArguments } from "../arguments.js";
import { fail, usage } from "../exit.js";
import { randKey, replayOrSend } from "../request-service.js";

const INTEGRATE = { options: { "--expect": "value", "--request": "value" }, positional: { min: 1, max: 1 } } as const;

export function runIntegrateCommand(args: string[]): Promise<never> {
  if (args.length === 0) usage();
  const parsed = parseArguments(args, INTEGRATE);
  const candidate = parsed.positional[0]!;
  const expected = parsed.value("--expect");
  if (!expected) usage();
  if (!FULL_OID_RE.test(candidate) || !FULL_OID_RE.test(expected)) fail("invalid oid", 2);
  return replayOrSend(
    "git.integrate",
    { candidate, expected },
    keyOf(parsed) ?? randKey(),
    undefined,
  );
}
