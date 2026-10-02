import { FULL_OID_RE } from "../../ids.js";
import { keyOf, parseArguments } from "../arguments.js";
import { fail, usage } from "../exit.js";
import { randKey, replayOrSend } from "../request-service.js";

const INTEGRATE = { options: { "--tier": "value", "--expect": "value", "--request": "value" }, positional: { min: 1, max: 1 } } as const;

export function runIntegrateCommand(args: string[]): Promise<never> {
  if (args.length === 0) usage();
  const parsed = parseArguments(args, INTEGRATE);
  const candidate = parsed.positional[0]!;
  const expected = parsed.value("--expect");
  if (!expected) usage();
  if (!FULL_OID_RE.test(candidate) || !FULL_OID_RE.test(expected)) fail("invalid oid", 2);
  const tier = parsed.value("--tier");
  if (tier !== null && tier !== "LOW" && tier !== "MEDIUM" && tier !== "HIGH") fail("--tier must be LOW, MEDIUM or HIGH", 2);
  return replayOrSend(
    "git.integrate",
    { candidate, expected, ...(tier === null ? {} : { tier }) },
    keyOf(parsed) ?? randKey(),
    undefined,
  );
}
