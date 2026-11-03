# Architecture improvement implementation contracts

This is the versioned implementation owner for the adopted changes in
[the requested specification](../architecture-improvement-spec.md). It does not
alter fixed architecture text or retroactively approve earlier implementation
reviews. [DR67](../design-revisions.md)
records the decision; [validation](validation.md) owns execution evidence.

## Numbered backlog follow-up

The authorized follow-up against `2514385f` preserves accepted identities and
keeps runtime defects, contract/defense improvements, verification defects and
reproduction candidates separate. The remaining #14, #17 and #27 now have owned
implementations and regressions; this is not full/native qualification.
[Validation](validation.md) distinguishes the prior reds, bounded runs and NOT_RUN evidence.

MCP private-state mechanics belong to the SDK-free `tool-files/private-state`
capability, borrowed through `tool-runtime/private-state`. Component opens and
cleanup are descriptor-relative/no-follow; only an opened owned leaf is chmodded.
Keys use exclusive creation, canonical 256-bit validation, regular-file/single-link
checks and file/parent durability barriers. Existing invalid keys are not replaced.
Disposable scratch links are unlinked without entering their targets. MCP receives
no storage-ledger or native execution dependency, and the workspace/extension
closure rules are unchanged. The new file is explicitly classified as a K2
mechanism. Engine-private UI tests stay in the engine's own test workspace rather
than adding a public export or an integration-test import exception.

Configuration publication and collection share a configuration-owned inode lock,
not the Society tenure directory. Project/state overlap is refused before writes,
including repository top-level inputs reached through a subdirectory. Workers-only
reply audience, durable validation, recovery and archive/result paths agree;
Principal approval visibility depends on physical Principal materialization, not
mere acceptance. None of these projections invent receipt, approval or integration
authority. Verification failures and native NOT_RUN results remain separate.

Local package replacement keeps a durable preimage under the existing package-store
lease. Uncommitted work rolls back before the next engine/index read; ordinary
runtime readers refuse pending replacement state. A committed install is not undone
because a later project-preference update fails. Restoration itself is idempotent
across process death and never reconstructs settings/index from guessed values.

Corrupt or missing execution observations have an explicit Human-only Linux recovery
path: prepare a root/host-bound checkpoint and exact archive, reboot the same host,
then apply only after a different kernel boot is observed. Ticket presence closes
normal journal open/initialize; an interrupted reset resumes only its exact initial
frame. Accepted operations, receipts and completion authority are untouched.
The [runbook](execution-recovery.md) states host-affinity, refusal and qualification limits.

A successful SDK command response does not imply an agent run. Trusted delivery
preflight may report never-started only before sending a message, without pending
mail and while the engine is idle. Session ownership and delivery failure consume
only the matching observation before agent_start. Late/wrong-batch observations,
unknown sends and legitimate active runs retain their existing lifetime fences;
there is no arbitrary accepted-turn deadline and no synthesized receipt.

## P1: independent progress and durable decisions

Reconcile has one coalescing operation recovery owner, one review advancement
lane, and one observation/wake lane per Worker. Repeated triggers do not create
concurrent owners of the same lane. Accepted lifecycle intents fence their own
actor; unresolved integrations fence the same canonical main. The execution
journal also recovers a requested slot independently of unrelated slots.
Corruption closes the shared mutation gate. Startup still establishes rootfs,
Store and repository integrity before admission; shutdown joins native death
proofs and does not equate cancellation or direct-child exit with scope death.

Review advancement yields with the existing busy refusal before taking the
project writer while an accepted `git.submit` or `git.integrate` is pending or
unknown. Recovery gets the writer instead of losing each sweep to derived
review work, including empty projections. The gate is derived from current
ledger rows, not a retained waiter/queue; terminal rows release it. Context
publication uses its separate writer, and review reads/acceptance and unrelated
Worker wake lanes remain independent. `reconcile-writer-progress` exercises real
Git/Store/Mail recovery before application and after CAS; `review-writer-priority`
covers pending/unknown, terminal and unrelated-resource admission.

New review opens and votes carry version 2 policy/qualification evidence.
Quorum capacity is frozen; reviewer wait, stop, restart and retirement do not
revoke an accepted qualified vote. Current requester permission, current policy,
provenance, explicit withdrawal/invalidation and the final CAS gate remain live.
Only a reviewer withdraws their own vote; only authenticated host Principal
invalidation may revoke another actor's vote. Both may interrupt a pending
pre-CAS check. Already applied/unknown attempts cannot be treated as cancellable.
Legacy version 1 review continuation requires explicit adoption; missing historic
qualification is not invented from today's agent row.

`review.retry` appends a fact and creates a distinct derived integration key.
Failed receipts, prior votes and accepted bytes remain unchanged. Unknown or
pending attempts cannot retry. Preparation failures are durable blocked facts;
a timer does not silently repeat failed checks or failed notice preparation.
Status separates an executing check, live preparation, known application and
notice delivery. Current policy/requester blocks and unavailable main observations
are visible, with a next action and observation time.

Search output streams to a runtime-owned file with a SHA-256 reference. Initial
preview is 16 KiB; pages are at most 64 KiB. Storage failure produces bounded,
explicit partial output. Reading a result does not grant source write authority;
references are resolved under the actor's result root through no-follow file
capabilities and verified before paging. Automatic merge diffs use the same
primitive, preserve binary patches and exact base/candidate OIDs, and are retained
by accepted plans. Their bytes are checked before CAS and notice publication.

Configuration 5 requires at least one initial Worker. Existing configuration 4
with zero seeds remains readable. An explicit host `firstWorkerRecovery` request
(version, key, name, profile, brief) can create the first Worker only when the
registry already has the Principal and has no resident history. It reuses normal
creation acceptance/provisioning and preserves replay/crash semantics; it grants
no ordinary Principal `agent.create` authority. A host recovery configuration may
set a valid seed list while recovering an already bootstrapped empty registry.
Personal sessions use their existing separate execution path.

## P2: workload budgets and shared check pipelines

Optional configuration-5 `resources.version=1` carries `cpuCores`,
`memoryMaxBytes`, `swapMaxBytes`, `tasksMax`, `checkWallTimeMs`, `tmpfsMaxBytes`,
and `maxConcurrentCheckPipelines`. An omitted field imposes no additional limit.
Linux probes an already delegated cgroup-v2 parent; it does not change unrelated
parent controllers. An unsupported requested profile refuses before launch.
Requested/effective/support/reason and included/excluded scope are reported.

The child enters an OMA-owned workload cgroup before its first workload exec;
Worker engines/tools, candidate scopes and trusted preparation/synchronous Git
helpers inherit aggregate CPU/memory/swap/task limits. Broker control, Principal
host UI, external inference and external graders remain outside. Private tmpfs
mounts receive the requested size ceiling. One project writer currently admits
one pipeline, so the effective concurrency ceiling is 1 even if the configured
upper bound is larger. This is not a host-wide budget across Societies.

A deadline begins cancellation. CHECK_TIMEOUT is terminal only after the owned
candidate scope is confirmed dead; an unconfirmed helper/scope stays unknown.
OOM/task failures use actual cgroup counters. Pipeline receipts include those
observations. No hard workspace disk quota is claimed.

`integration.pipeline.version=2` explicitly replaces an empty legacy `checks`
array. Each ordered setup/check step has id, argv, workspace-relative cwd, env and
optional deadline. The policy includes environment, toolchain digest and cache
policy. One exact checkout, private HOME and sandbox serve the complete pipeline;
retry starts fresh. Failure stops subsequent steps. The trusted nondumpable
supervisor reports through its private channel; candidate JSON is only output.
Per-step stdout/stderr and completion records live under `checks/<run UUID>` and
bind the candidate, integration attempt and policy digest. An incomplete or
unconfirmed run never acquires a successful receipt. Tracked source generation is
recorded as a binary diff against the original candidate; it is not silently
published or universally forbidden. Legacy checks retain independent sandboxes.

Cache defaults to `off`. `npm-downloads` selects a trust scope and lockfile.
The key includes repository, trust scope, OS/architecture, toolchain, npm version,
lockfile bytes and setup policy. Only anonymous, SHA-512-pinned public npm tarballs
are downloaded by a trusted helper; redirects, credentials, private source,
HOME and node_modules are not cache publications. Immutable content files are
verified on reuse and inserted into npm's own cacache in the private attempt.
Misses and corruption leave normal setup responsible for success. A cache hit
never skips setup or checks. Distribution npm's already mounted read-only sibling
modules are included in module resolution.

## Compatibility and remaining cutovers

The Store backs up an existing schema-4 database durably before publishing the
schema-5 gate; historical plan/result bytes are preserved. New facts/config are
closed and versioned. Older independent check plans retain their old meaning.
New profile values apply to a new broker execution, not to an already running
scope.

The subsequent P3/P4 cutovers below are implemented in the same worktree.
No live model, benchmark, push or merge forms part of the local stage tests.
Historical checkpoint evidence remains unchanged; final verification is recorded
separately rather than rebinding an older authored approval.


## P3 checkpoint

New opens use v3 proposal semantics. Revision and policy-adoption facts retain
historical bytes; v3 votes bind the proposal revision and, when required, the
prepared integration context. The original B/C remains the provenance input.
Clean integration preparation uses normal merge-tree ancestry, then an immutable
broker ref with parents M/C. Raw old/new object, mode and path records and path
prefix overlap determine conservative approval reuse. Other clean results need
at least MEDIUM context review. Every accepted result is checked before CAS.

Preparation facts own their exact patch and prepared ref. Helpers inherit a
preparation lease; startup cannot collect an unaccepted ref while its helper is
active or unknown. Known pre-CAS main movement supersedes the attempt; unknown
outcomes remain fenced. Inclusion without a CAS is a separate fact. Challenges
revert the successful attempt's actual M/I delta. Explicit host retry and policy
adoption preserve old receipts and re-evaluate current authority.

The P3 checkpoint passes 20 tests including 8 real Git scenarios in
`test/architecture-p3.test.ts`; raw results and input hashes are stored beside the
P1/P2 evidence. This is a targeted checkpoint, not full-suite qualification.
Final compatibility/architecture validation is recorded separately below.


## P4: derived cost and explicit storage policy

The authenticated provenance index is derived and rebuildable. Each query still
observes all publication refs in one batch, validates accepted identity, and reads
the current B..C range. A new submission or publication transition changes the
index generation. A warm query takes two Git processes at 1, 8, 32 and 128
submissions in the local test; this does not claim constant CPU or constant ref
bytes. Cold construction still traverses the published commit graph.

Search first snapshots names and ignore controls through held descriptors.
Pinned rg/fd applies precedence, hidden/glob and explicit-file semantics. Only
selected payload is copied; selected inode and ancestor/control observations are
checked again before use. Binary detection stays with rg. The snapshot is
per-call, with no mutable shared cache. Cancellation and parent EOF own selection
as well as the content walker; a walker ignoring SIGTERM cannot keep a private
snapshot alive. Result references are read-only capabilities, never source paths.
The SDK-free `@oma/tool-files/results` subpath is the shared publisher/reader
boundary; Git and Client cannot import the model file-tool root.

Configuration 5 optionally sets `storage.closeMode` to `keep-hot` (default) or
`on-close`. Legacy implicit archiving gets a migration notice; explicit on-close
is preserved. Normal hot close/resume does metadata checks and native quiescence,
with no full DB/tree content digest, backup or restore. Disk use consequently
stays allocated until explicit archive or on-close archive. `oma archive
--society <name> [--config <path>]` takes the same Society lease as resume and
refuses active sessions. It does not bootstrap or activate a model.

Storage selection v2 has generation and hot/archiving/cold/restoring phases.
An additional action lock prevents overlapping same-process storage calls;
all actions retain the Society fence, and restic holds the project lock and
staging lease. Immutable checkpoint and permanent identity v1 bytes remain
readable and are not rewritten. Archiving retains hot authority until verified
checkpoint publication and cold selection; restoring retains cold authority
until the published tree is verified. Failures after cold selection preserve it.
No background archive job or implicit eviction daemon is introduced.

The local P4b/P4c checkpoint passed 23 tests, including actual restic recovery
and a 32 MiB ignored-tree hot-close/resume test with zero payload reads and no
repository creation. P4a measurements and later full verification are separate
artifacts under `implementation/evidence/architecture-improvements`.

## Explicit limits

These are local deterministic/native tests, not provider acceptance or a
SWE-Milestone performance claim. Pipeline concurrency remains one per project
writer. External graders/inference and other Societies need their own aggregate
host budget; filesystem hard disk quota is not implemented. Cold provenance
rebuild and ignore-control/name traversal still cost work proportional to input.
An interrupted pipeline retains its started manifest/logs and unknown native
state; no success receipt is synthesized. Runtime search-result retention is
actor-owned and has no independent garbage-collection daemon. Fault injection
coverage is reported with the tests actually run, not as exhaustive power-loss
qualification at every filesystem boundary.


## Implementation and acceptance map

| Requested item | Implementation owner | Local regression evidence |
|---|---|---|
| 1 proposal / integration attempt | review advancement, Git integration preparation/publication, versioned attestation codec | architecture-p3: stale base, revisions, inclusion, context/Principal review, conflicts, actual before/after-CAS SIGKILL and binary rename |
| 2 independent recovery/wake | reconcile lanes; execution slot recovery | architecture-p1a, architecture-p1a-execution, installed recovery |
| 3 durable reviews/quorum | review evaluation, authority, acceptance | architecture-p1a/p1b, review-active-capacity |
| 4 explicit failed-check retry | review retry fact and distinct integration key | architecture-p1b and native shared-pipeline fresh retry |
| 5 complete results/range reads | tool-files/results; tool-runtime/result-read | architecture-p1c and contained-tools |
| 6 resource budgets | Linux workload-budget; execution-runtime | architecture-p2-resources, architecture-p2-pipeline |
| 7 first Worker | config5; lifecycle CreateCoordinator recovery | architecture-p1a; worker-autonomy/capacity |
| 8 provenance cost | Git provenance-index and batch ref observation | architecture-p4a: exact historical oracle at 1/8/32/128 submissions |
| 9 selective search copying | contained-search held snapshot and pinned walker | architecture-p4b; contained-tools cancellation/parent-death |
| 10 shared check environment/cache | check-pipeline, pipeline-cache/recorder | architecture-p2-pipeline/cache and architecture-boundaries |
| 11 hot close / explicit archive | session-storage v2; session-archive host command | session-storage native restic and injected publication/reclamation faults |
| 12 truthful notice/status | review status projection, messages, immutable diff artifacts | architecture-p1b/p1c and scenario-merge-review |

Resource receipts now include kernel memory/swap/task peaks, CPU usage and
throttling, observedAt and unavailable counters. Throttling names its aggregate
budget scope; other counters describe the run leaf. Pipeline receipts report disk
free bytes and elapsed/preparation-to-first-step time. These are observations,
not disk quotas, host-wide totals or measurements of external graders. Per-step
elapsed time excludes no failed step. A preparation interval is not labelled as
pure scheduler queue time. No p50/p95 or model-cost numbers are fabricated from
single native probes; provider usage and workload distributions require the
separately authorized live/benchmark runs.

The final regression closure also repairs baseline test fixtures that still
expected the retired model CLI, omitted creation metadata, schema4 defaults or
one default Worker. The verification lane names now point to the current typed
client, role guards, contained-file and native socket tests. No removed model
CLI or per-edit quota is reinstated to satisfy those historic names. Generated
review-ledger invalidation retains authored review notes and leaves changed
source NOT_REVIEWED; local tests do not constitute an independent authored review.

The full regression also exposed an intermittent EAGAIN at owned-directory
creation. Its native cause is not established. The storage owner now settles that
uncertain result only when the usual held, no-link directory validation succeeds;
it does not claim creation or add the path to the created-directory list. Failed
observation preserves both errors and bypasses stray-leaf repair. Missing paths,
links and EACCES remain failures. This adds no blind retry, pathname fallback or
new sandbox permission. `architecture-directory-observation` tests those four
cases against real descriptor observation; broker/TUI and directory/preparation
regressions are recorded separately in the validation evidence.

## Final local result

P1a/P1b/P1c, P2, P3 and P4a/P4b/P4c are implemented. The final full local run
passed 4,007 tests (14 serial and 3,993 parallel), with no failure, cancellation,
skip or todo. Build and the complete architecture/transaction/boundary/document/
spec-inventory gates passed. All 15,733 verification inputs and the separately
listed 192 changed-file hashes were unchanged throughout that run. Later edits
record these results only. [Validation](validation.md) links raw results and
the [complete changed-path list](../../implementation/evidence/architecture-improvements/changed-paths.txt).

This is uncommitted implementation and local verification, not independent
authored approval, live provider qualification, benchmark results or a 3+3 host
capacity verdict. The original requested specification and historical authored
review bytes are preserved. No push, merge, benchmark or live model request was
performed by this implementation task.

## Module audit repair boundaries

[DR70](../design-revisions.md#dr70--모듈-감사의-경쟁경계-결함을-기존-권한-안에서-수정한다)
records the follow-up. The historical findings and corrected classifications
remain in the [module audit](../module-audit-2026-10-31.md); executed evidence
belongs to [validation](validation.md).

Review advancement derives acceptance and read-back keys from the same attempt.
An adopted/revised scope without its prepared context is left to the existing
v3 preparation path, never encoded as an incompatible v2 integration. Ordinary
Principal actors still cannot invalidate another reviewer's vote: that remains
authenticated host-Principal authority, not a new model action.

Reply reference truncation always retains the immediate parent; one slot cannot
also retain the root. Batch fitting accounts for the complete escaped view and
its redelivery notice before acceptance. Metadata elision is explicit; immutable
mail bytes, the index and selected manifest stay complete. Unselected deliveries
remain available for later batches, with direct/public-list fairness unchanged.
The batch codec owns the configured frame floor.

Status paging uses roster-row names, including the Principal, without broadening
Worker-only control or log identities. Large resume catalogs use bounded frames
correlated to one request and settle only at their final frame or explicit error.
Each catalog frame awaits its local socket write completion before queuing the
next; an event-loop yield alone does not bound a slow reader's queued bytes.
This is flow control, not a peer processing acknowledgement or durable receipt.
MODE-005 fresh-mode switching supersedes the unused fixed society-slot path.

Private scratch cleanup repairs only owned held directory capabilities and
never follows links. Package rollback restores the recorded mode independently
of umask. Result pages are captured from the same reads that validate the hash.
Conditional writes detect changes through their final descriptor sample, not
an atomic CAS against an unrelated writer after that sample.

Live native-slot contention is busy/same-key; retained or unobserved execution
ownership keeps the termination fence. Failed flock evaluation does not assert
a live owner. Linux openat2 retries only EAGAIN, finitely, with identical held
root/name/containment flags; persistent uncertainty and hard denials still refuse.
Configuration acceptance checks the installation root before project seeding,
and the exact published generation tree is rechecked before manifest rename.

MCP scratch removal follows the adapter's shutdown hook. Normal stdio close
observes child exit; the upstream SIGKILL fallback does not await that evidence
and remains an explicitly unqualified vendor seam. Bundle integrity failures
retain their causal diagnostic without allowing a rejected payload to load.
