import { FULL_OID_RE } from "../../ids.js";
import { keyOf, opt } from "../arguments.js";
import { fail, usage } from "../exit.js";
import { randKey, replayOrSend } from "../request-service.js";

export function runIntegrateCommand(args: string[]): Promise<never> {
  const candidate = args[0];
  const expected = opt(args, "--expect");
  if (!candidate || !expected) usage();
  if (!FULL_OID_RE.test(candidate) || !FULL_OID_RE.test(expected)) fail("invalid oid", 2);
  return replayOrSend(
    "git.integrate",
    { candidate, expected },
    keyOf(args) ?? randKey(),
    undefined,
  );
}
