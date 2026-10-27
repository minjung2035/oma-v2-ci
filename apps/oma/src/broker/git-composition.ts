import { reviewLedger, reviewRuntime } from "./review-composition.js";
/** App composition: Git and Review are separate feature owners. */
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import type { Oid } from "@oma/contracts";
import type { IntegrationPolicy, IntegrationPolicyReader, FrozenCheck } from "@oma/domain/integration-policy";
import { GitModule } from "@oma/git";
import { GitRepository } from "@oma/git/repository";
import type { QuarantineExecution } from "@oma/git/quarantine";
import type { GitPaths } from "@oma/git/paths";
import { ReviewModule, type ReviewBounds, type ReviewEffects } from "@oma/review";
import { ReviewAuthorityReader } from "@oma/review/authority";
import { gitLedger, gitMessaging } from "./git-ledger.js";

type CandidateCheck = (candidate: Oid, check: FrozenCheck, cancellation: AbortSignal | undefined, authorize: () => void) => Promise<void>;
function composeGit(paths: GitPaths, store: Store, mail: MailModule,
  policy: IntegrationPolicy | null, reader: IntegrationPolicyReader | null, check: CandidateCheck | null, quarantine: QuarantineExecution | null) {
  store.bindRepositoryIdentity({ society: paths.society });
  const ledger = gitLedger(store);
  const repository = new GitRepository(paths, { submissions: () => ledger.submissions() }, quarantine);
  const authority = new ReviewAuthorityReader({
    attestationFacts: () => store.attestationFacts(),
    getOperation: (actor, key) => store.getOperation(actor, key),
    listAgents: () => store.listAgents(),
  }, policy?.tiered?.highPeerFloor ?? 1);
  const git = new GitModule(ledger, gitMessaging(mail), repository, policy, reader, check, {
    assertApplicable: request => authority.assertApplicable(request),
  });
  return { git, repository, authority };
}
export function createGitModule(paths: GitPaths, store: Store, mail: MailModule,
  policy: IntegrationPolicy | null = null, reader: IntegrationPolicyReader | null = null,
  check: CandidateCheck | null = null, quarantine: QuarantineExecution | null = null): GitModule {
  return composeGit(paths, store, mail, policy, reader, check, quarantine).git;
}
export function createGitServices(paths: GitPaths, store: Store, mail: MailModule,
  policy: IntegrationPolicy | null = null, reader: IntegrationPolicyReader | null = null,
  check: CandidateCheck | null = null,
  bounds: ReviewBounds = { mailBodyBytes: 256 * 1024, subjectBytes: 512, bundleBytes: 256 * 1024 * 1024 }, quarantine: QuarantineExecution | null = null) {
  const { git, repository, authority } = composeGit(paths, store, mail, policy, reader, check, quarantine);
  const effects: ReviewEffects = {
    ...repository.review, ...reviewRuntime(),
    policy: () => git.boundPolicy(), currentPolicy: () => git.currentIntegrationPolicy(),
    applyMerge: operation => git.applyMerge(operation), cancelMerge: request => git.cancelMerge(request),
    withWriter: work => git.withProjectWriter(work),
  } satisfies ReviewEffects;
  const reviews = new ReviewModule(reviewLedger(store), {
    freezeReviewMessage: (id, ordinal, sender, input) => mail.freezeReviewMessage(id, ordinal, sender, input),
    materialize: id => mail.materialize(id),
  }, effects, bounds, paths.society, authority);
  return Object.freeze({ git, reviews });
}
