/** Closed observational mail summary. No acceptance or publication witness. */
import type { InvocationMailObservation } from "@oma/contracts/public-wire";
import { snapshotJson } from "@oma/domain/canonical-json";
import { isPublishedRef } from "@oma/domain/derived";
import { isValidMessageId, isValidOperationId } from "@oma/domain/identifiers";
import { checkArray, checkEnum, checkInt, checkObject, checkOid, checkOptional, checkString } from "@oma/domain/validation";

const count = checkInt({ min: 0 });
const sha256 = checkString({ re: /^[a-f0-9]{64}$/u });
const shape = checkObject({
  message: value => isValidMessageId(value) ? null : "invalid mail summary identity",
  emlSha256: sha256, bodySha256: sha256, bodyBytes: count, attachmentCount: count,
  attachments: checkArray(checkObject({ commit: checkOid, objectFormat: checkEnum(["sha1", "sha256"]),
    publishedRef: value => value === "refs/heads/main" || isPublishedRef(value) ? null : "invalid attachment reference",
    sourcePublication: value => value === null || isValidOperationId(value) ? null : "invalid source publication",
    sourcePublicationOrdinal: checkOptional(count),
    reachableFrom: checkOptional(checkOid),
    publication: checkEnum(["canonical-before-acceptance", "shared-before-acceptance", "published-before-delivery", "accepted-dependency"]),
  })), omittedAttachments: count,
  delivery: checkObject({ recipientCount: count, materialized: count, presented: count }),
  source: checkEnum(["accepted-plan-and-delivery-facts; no fresh ref observation"]),
});
export function decodeInvocationMail(value: unknown):
  { readonly ok: true; readonly value: InvocationMailObservation } | { readonly ok: false; readonly reason: string } {
  try {
    const copied = snapshotJson(value), problem = shape(copied);
    if (problem !== null) return { ok: false, reason: problem };
    // SAFETY: the closed shape validated every copied field before narrowing.
    const mail = copied as unknown as InvocationMailObservation;
    if (mail.attachments.length + mail.omittedAttachments !== mail.attachmentCount ||
        mail.delivery.presented > mail.delivery.materialized || mail.delivery.materialized > mail.delivery.recipientCount ||
        new Set(mail.attachments.map(source => source.commit)).size !== mail.attachments.length ||
        mail.attachments.some(source => source.objectFormat !== (source.commit.length === 40 ? "sha1" : "sha256") ||
          source.reachableFrom !== undefined && source.reachableFrom.length !== source.commit.length ||
          source.sourcePublication === null && (source.publishedRef !== "refs/heads/main" || source.reachableFrom === undefined || source.sourcePublicationOrdinal !== undefined || source.publication !== "canonical-before-acceptance") ||
          source.sourcePublication !== null && (source.publishedRef === "refs/heads/main" || source.publication === "canonical-before-acceptance")))
      return { ok: false, reason: "inconsistent mail summary relationships" };
    return { ok: true, value: mail };
  } catch { return { ok: false, reason: "invalid closed invocation mail observation" }; }
}
