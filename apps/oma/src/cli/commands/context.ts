import { FULL_OID_RE } from "@oma/domain/identifiers";
import { keyOf, parseArguments } from "../arguments.js";
import { prepareContextEffects } from "../effects/context.js";
import { fail, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";

const PUBLISH = { options: { "--expect": "value", "--request": "value" }, positional: { min: 1, max: 1 } } as const;

export function runContextCommand(args: string[]): Promise<never> {
  if (args.length === 0) usage();
  const parsed = parseArguments(args, PUBLISH);
  const dir = parsed.positional[0]!;
  const expect = parsed.value("--expect");
  if (!expect || (expect !== "none" && !FULL_OID_RE.test(expect)))
    fail("--expect requires <oid|none>", 2);
  const key = keyOf(parsed) ?? randKey();
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
