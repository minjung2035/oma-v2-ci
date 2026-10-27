import { renderBatchView } from "@oma/mail/batch-view";
/** Product adapters for Mail's bounded effects. Decisions remain in Mail. */
import { join } from "node:path";
import type { MessageId } from "@oma/contracts";
import { mailObjectPathAt, mailAudiencePathAt } from "@oma/domain/paths";
import { generateOperationId, generateBatchId } from "@oma/native/identity";
import { ensureOwnedDirectory, removeOwnedFile } from "@oma/storage/directory";
import { writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";
import { publishImmutableFile, readImmutableBytes, observeImmutableFile } from "@oma/storage/immutable-file";
import { PreacceptArtifact, PreacceptScope } from "@oma/storage/preaccept-artifact";
import { HeldMailInbox } from "@oma/storage/mailbox";
import { publishBatchView } from "@oma/storage/batch-view";
import { readDeliveryReceipt, deliveryDecision, observeDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { consumeIntegrationPublication } from "@oma/git/integration-publication";
import { consumeSubmissionPublication } from "@oma/git/publication";
import { consumeContextPublication } from "@oma/git/context-publication";
import { consumeCreationPublication } from "@oma/lifecycle/create-publication";
import type { MailSociety } from "@oma/mail";
import type { MailEffects } from "@oma/mail/ports";

function freezeMailObject(paths: MailSociety, messageId: MessageId, text: string, sha256: string): PreacceptArtifact {
  const stagingDir = join(paths.stateRoot, "staging", "mail-objects");
  ensureOwnedDirectory(stagingDir, paths.stateRoot);
  const staged = join(stagingDir, `${messageId}.${generateOperationId()}.tmp`);
  writeExclusiveFsyncedFile(staged, text);
  const destination = mailObjectPathAt(paths.stateRoot, messageId);
  let owned: PreacceptArtifact | null = null;
  const failures: unknown[] = [];
  try { publishImmutableFile(staged, destination, sha256, undefined, identity => { owned = new PreacceptArtifact(destination, identity); }); }
  catch (error) { failures.push(error); }
  try { removeOwnedFile(staged); } catch (error) { failures.push(error); }
  const artifact: PreacceptArtifact = owned ?? new PreacceptArtifact(destination, null, true);
  if (failures.length === 0) return artifact;
  try { artifact.discardUnaccepted(); } catch (error) { failures.push(error); }
  throw failures.length > 1 ? new AggregateError(failures, "mail object freeze and owned cleanup failed") : failures[0];
}
export function mailEffects(paths: MailSociety): MailEffects {
  return Object.freeze({
    nextOperationId: generateOperationId,
    nextBatchId: generateBatchId,
    newPreacceptScope: () => new PreacceptScope(),
    freezeMailObject: (id, text, sha256) => freezeMailObject(paths, id, text, sha256),
    readMessage: message => readImmutableBytes(mailObjectPathAt(paths.stateRoot, message.id), message.sha256, message.bytes),
    observeArchive: message => observeImmutableFile(mailAudiencePathAt(paths.stateRoot, message), message.sha256, message.bytes),
    publishMailArchive: message => publishImmutableFile(mailObjectPathAt(paths.stateRoot, message.id), mailAudiencePathAt(paths.stateRoot, message), message.sha256),
    openInbox: actor => new HeldMailInbox(paths.stateRoot, actor),
    readReceipt: (batch, maximum) => readDeliveryReceipt(paths.stateRoot, batch, maximum),
    receiptDecision: (batch, maximum, attempts) => deliveryDecision(observeDeliveryReceipt(paths.stateRoot, batch, maximum, attempts)),
    publishBatchView: (batch, limits, info) => publishBatchView(paths.stateRoot, batch, renderBatchView(batch, limits, info)),
    publication: Object.freeze({
      consumeIntegration: consumeIntegrationPublication,
      consumeSubmission: consumeSubmissionPublication,
      consumeContext: consumeContextPublication,
      consumeCreation: consumeCreationPublication,
    }),
  } satisfies MailEffects);
}
