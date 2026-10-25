import type { PublicMethods } from "@oma/contracts";
import { keyOf, parseArguments } from "../arguments.js";
import { readBody, resolveOid, sha256Hex } from "../effects.js";
import { prepareSubmitEffects } from "../effects/submit.js";
import { finishFailure, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";
import { explicitFullOid } from "../request-intent.js";
import { call } from "../transport.js";

const SUBMIT = {
  options: { "--to": "values", "--subject": "value", "--file": "value", "--path": "values", "--request": "value" },
  positional: { min: 1, max: 1 },
} as const;

export function runSubmitCommand(args: string[]): Promise<never> {
  if (args.length === 0) usage();
  const parsed = parseArguments(args, SUBMIT);
  const revision = parsed.positional[0]!;
  const key = keyOf(parsed) ?? randKey();
  return effect(
    "git.submit",
    key,
    async () => {
      const candidate = resolveOid(revision);
      const to = parsed.values("--to");
      const subject = parsed.value("--subject") ?? "Re: submit";
      const body = readBody(parsed.value("--file"));
      const paths = parsed.values("--path");
      const reply = (await call("git.known", { candidate }))[0];
      if (!reply?.ok) finishFailure(reply, "git.known: ");
      // The production channel already decoded this method's closed result.
      const known = reply.result as PublicMethods["git.known"]["result"];
      const prepared = prepareSubmitEffects(candidate, key, known);
      const params: Record<string, unknown> = {
        candidate,
        exportRef: prepared.exportRef,
        prerequisites: prepared.prerequisites,
        to: to.length > 0 ? [...to] : ["commons"],
        subject,
        body,
        paths: [...paths],
      };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256Hex(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    },
    () => {
      const to = parsed.values("--to");
      return {
        to: to.length > 0 ? [...to] : ["commons"],
        subject: parsed.value("--subject") ?? "Re: submit",
        paths: [...parsed.values("--path")],
        ...explicitFullOid("candidate", revision),
      };
    },
  );
}
