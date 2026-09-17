import { FULL_OID_RE } from "../../ids.js";
import { keyOf, opt } from "../arguments.js";
import { prepareContextEffects } from "../effects/context.js";
import { fail, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";

export function runContextCommand(args: string[]): Promise<never> {
  const dir = args[0];
  const expect = opt(args, "--expect");
  if (!dir) usage();
  if (!expect || (expect !== "none" && !FULL_OID_RE.test(expect)))
    fail("--expect requires <oid|none>", 2);
  const key = keyOf(args) ?? randKey();
  return effect(
    "context.publish",
    key,
    () => {
      const prepared = prepareContextEffects(dir);
      const params: Record<string, unknown> = {
        expected: expect === "none" ? null : expect,
        entries: prepared.entries,
        content: {
          ...prepared.digest,
          mediaType: "application/vnd.oma.context-v1",
        },
      };
      return {
        method: "context.publish",
        params,
        digest: prepared.digest,
        stream: prepared.content,
      };
    },
    () => ({ expected: expect === "none" ? null : expect }),
  );
}
