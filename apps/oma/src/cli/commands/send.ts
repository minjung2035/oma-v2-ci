import { isValidFullOid } from "@oma/domain/identifiers";
import { prepareGoalEffects } from "../effects/goal.js";
import { basename } from "node:path";
import { parseMessageFileId } from "@oma/domain/identifiers";
import { exactCandidateCheck, isMailKind } from "@oma/domain/mail-values";
import { keyOf, parseArguments } from "../arguments.js";
import { readBody } from "../effects.js";
import { prepareReplyEffects } from "../effects/mail.js";
import { fail, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";

const SEND = {
  options: { "--subject": "value", "--file": "value", "--kind": "value", "--reply": "value", "--request": "value",
    "--intent": "value", "--candidate": "value", "--expect": "value", "--policy-revision": "value" },
  positional: { min: 0, max: Number.MAX_SAFE_INTEGER },
} as const;
const ACK = { options: { "--request": "value" }, positional: { min: 1, max: 1 } } as const;

export function runSendCommand(args: string[]): Promise<never> {
  const parsed = parseArguments(args, SEND);
  const to = [...parsed.positional];
  const intent = parsed.value("--intent");
  if (intent !== null) {
    if (intent !== "goal") fail("unknown mail intent", 2);
    const expected = parsed.value("--expect"), subject = parsed.value("--subject"), file = parsed.value("--file");
    if (expected === null || (expected !== "none" && !isValidFullOid(expected))) fail("GOAL mail requires --expect <oid|none>", 2);
    if (!subject || !file || to.length !== 1 || to[0] !== "residents") fail("GOAL mail requires residents, --subject and --file", 2);
    if (["--kind", "--reply", "--candidate", "--policy-revision"].some(name => parsed.value(name) !== null))
      fail("GOAL mail cannot include ordinary mail kind, reply or approval fields", 2);
    const base = expected === "none" ? null : expected;
    return effect("context.publish", keyOf(parsed) ?? randKey(), () => {
      const prepared = prepareGoalEffects(file, base);
      return { method: "context.publish", params: { expected: base, goalMail: { subject }, entries: prepared.entries,
        content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
    }, () => ({ expected: base, goalMail: { subject } }));
  }

  const subject = parsed.value("--subject");
  const reply = parsed.value("--reply");
  if (to.length === 0 && !reply) fail("send requires an address (or --reply)", 2);
  if (!subject && !reply) fail("send requires --subject (or --reply to reuse its subject)", 2);
  const kindRaw = parsed.value("--kind") ?? "message";
  if (!isMailKind(kindRaw)) fail(`invalid --kind ${kindRaw}`, 2);
  const candidate = parsed.value("--candidate");
  const expectedBase = parsed.value("--expect");
  const policyRevision = parsed.value("--policy-revision");
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
  const key = keyOf(parsed) ?? randKey();
  return effect(
    "mail.send",
    key,
    () => {
      const params: Record<string, unknown> = {
        to,
        subject: subject ?? "Re",
        kind: kindRaw,
        body: readBody(parsed.value("--file")),
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
  const id = basename(value).replace(/(?:\.eml|:2,[A-Za-z]*)$/, "");
  const parsed = parseMessageFileId(id);
  if (parsed === null) fail("ack requires a message id or mail path", 2);
  return parsed;
}

export function runAckCommand(args: string[]): Promise<never> {
  if (args.length === 0) usage();
  const parsed = parseArguments(args, ACK);
  const message = parseMessageArg(parsed.positional[0]!);
  const key = keyOf(parsed) ?? randKey();
  return effect(
    "mail.ack",
    key,
    () => ({ method: "mail.ack", params: { message } }),
    () => ({ message }),
  );
}
