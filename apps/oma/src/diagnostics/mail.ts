/** P6: frozen header relations, not mail publication or approval authority. */
import type { MessagePlan } from "@oma/contracts/durable";
import { parseEmlHeaders } from "@oma/mail/headers";
import { parseDisplayedAddress } from "@oma/mail/addresses";
export interface MailHeaderExpectation {
  readonly message: MessagePlan;
  readonly society: string;
  readonly actorNames: ReadonlySet<string>;
}
export function mailHeadersMatch(bytes: Uint8Array, expected: MailHeaderExpectation): boolean {
  const { message, society, actorNames } = expected;
  const headers = parseEmlHeaders(bytes, { maxHeaderBytes: bytes.byteLength });
  const addresses = (raw: readonly string[] | null, wanted: readonly string[]) => {
    if (raw === null || raw.length !== wanted.length) return false;
    const actual = raw.map(value => parseDisplayedAddress(value, society, actorNames));
    if (actual.some(value => value === null)) return false;
    actual.sort(); const sorted = [...wanted].sort();
    return actual.every((value, index) => value === sorted[index]);
  };
  const approval = message.approvalFor ?? null, actual = headers.approvalFor;
  return headers.messageId?.split("@", 1)[0] === message.id && headers.omaKind === message.kind &&
    headers.dateMs === Math.floor(message.dateMs / 1000) * 1000 && headers.omaContext === message.contextRevision &&
    addresses(headers.to, message.to) && addresses(headers.replyTo ?? [], message.replyHeaders.replyTo) &&
    headers.inReplyTo === message.replyHeaders.inReplyTo && headers.references.length === message.replyHeaders.references.length &&
    headers.references.every((value, index) => value === message.replyHeaders.references[index]) &&
    (approval === null ? actual === null : actual !== null && actual.repo === approval.repo && actual.targetRef === approval.targetRef &&
      actual.expectedBase === approval.expectedBase && actual.candidate === approval.candidate && actual.policyRevision === approval.policyRevision);
}
