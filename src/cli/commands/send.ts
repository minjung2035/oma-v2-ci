import { basename } from "node:path";
import { parseMessageFileId } from "../../ids.js";
import { exactCandidateCheck, isMailKind } from "../../domain/mail-values.js";
import { keyOf, opt, positional } from "../arguments.js";
import { readBody } from "../effects.js";
import { prepareReplyEffects } from "../effects/mail.js";
import { fail, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";

export function runSendCommand(args: string[]): Promise<never> {
  const to = positional(args, [
    "--subject",
    "--file",
    "--kind",
    "--reply",
    "--request",
    "--candidate",
    "--expect",
    "--policy-revision",
  ]);
  const subject = opt(args, "--subject");
  const reply = opt(args, "--reply");
  if (to.length === 0 && !reply) fail("send requires an address (or --reply)", 2);
  if (!subject && !reply) fail("send requires --subject (or --reply to reuse its subject)", 2);
  const kindRaw = opt(args, "--kind") ?? "message";
  if (!isMailKind(kindRaw)) fail(`invalid --kind ${kindRaw}`, 2);
  const candidate = opt(args, "--candidate");
  const expectedBase = opt(args, "--expect");
  const policyRevision = opt(args, "--policy-revision");
  let approvalFor:
    | {
        repo: string;
        targetRef: string;
        candidate: string | null;
        expectedBase: string | null;
        policyRevision: string | null;
      }
    | undefined;
  if (kindRaw === "approval_required") {
    approvalFor = {
      repo: "project",
      targetRef: "refs/heads/main",
      candidate,
      expectedBase,
      policyRevision,
    };
    const error = exactCandidateCheck(approvalFor);
    if (error || !to.includes("principal"))
      fail(error ?? "approval_required requires explicit principal recipient", 2);
  } else if (candidate !== null || expectedBase !== null || policyRevision !== null) {
    fail("approval identity flags require --kind approval_required", 2);
  }
  const key = keyOf(args) ?? randKey();
  return effect(
    "mail.send",
    key,
    () => {
      const params: Record<string, unknown> = {
        to,
        subject: subject ?? "Re",
        kind: kindRaw,
        body: readBody(opt(args, "--file")),
      };
      if (reply) {
        const prepared = prepareReplyEffects(reply, subject === null);
        if (subject === null) params.subject = prepared.inheritedSubject!;
        params.replyToMessage = prepared.replyToMessage;
      }
      if (approvalFor) params.approvalFor = approvalFor;
      return { method: "mail.send", params };
    },
    () => ({
      to,
      ...(subject === null ? {} : { subject }),
      kind: kindRaw,
      ...(approvalFor ? { approvalFor } : {}),
    }),
  );
}

function parseMessageArg(value: string): string {
  const id = value.startsWith("m-") ? value : basename(value).replace(/:2,$/, "");
  const parsed = parseMessageFileId(id);
  if (parsed === null) fail("ack requires a message id or mail path", 2);
  return parsed;
}

export function runAckCommand(args: string[]): Promise<never> {
  const raw = args[0];
  if (!raw) usage();
  const message = parseMessageArg(raw);
  const key = keyOf(args) ?? randKey();
  return effect(
    "mail.ack",
    key,
    () => ({ method: "mail.ack", params: { message } }),
    () => ({ message }),
  );
}
