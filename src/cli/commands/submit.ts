import type { PublicMethods } from "../../../implementation/contracts.js";
import { keyOf, multiOpt, opt } from "../arguments.js";
import { readBody, resolveOid, sha256Hex } from "../effects.js";
import { prepareSubmitEffects } from "../effects/submit.js";
import { finishFailure, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";
import { explicitFullOid } from "../request-intent.js";
import { call } from "../transport.js";

export function runSubmitCommand(args: string[]): Promise<never> {
  const revision = args[0];
  if (!revision) usage();
  const key = keyOf(args) ?? randKey();
  return effect(
    "git.submit",
    key,
    async () => {
      const candidate = resolveOid(revision);
      const to = multiOpt(args, "--to");
      const subject = opt(args, "--subject") ?? "Re: submit";
      const body = readBody(opt(args, "--file"));
      const paths = multiOpt(args, "--path");
      const reply = (await call("git.known", { candidate }))[0];
      if (!reply?.ok) finishFailure(reply, "git.known: ");
      // The production channel already decoded this method's closed result.
      const known = reply.result as PublicMethods["git.known"]["result"];
      const prepared = prepareSubmitEffects(candidate, key, known);
      const params: Record<string, unknown> = {
        candidate,
        exportRef: prepared.exportRef,
        prerequisites: prepared.prerequisites,
        to: to.length > 0 ? to : ["commons"],
        subject,
        body,
        paths,
      };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256Hex(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    },
    () => {
      const to = multiOpt(args, "--to");
      return {
        to: to.length > 0 ? to : ["commons"],
        subject: opt(args, "--subject") ?? "Re: submit",
        paths: multiOpt(args, "--path"),
        ...explicitFullOid("candidate", revision),
      };
    },
  );
}
