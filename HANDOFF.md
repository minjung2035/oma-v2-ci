# OMA v2 — consistency plan execution

## Current task

WP00 and WP01 are complete under `oma-v2-consistency-plan-b25961c/`
(user-supplied plan, kept untracked and unchanged). **Next permitted: WP02.**
Follow the selected dependency graph, not numeric order. Only one WP may be active.
WP01 adopted v1-preserving decisions; their runtime gates are not completed.
No production runtime/schema/wire/receipt/authority change has been made.
Current verification owner: `implementation/validation.md`. External per-WP
handoffs are immutable evidence, not new runtime qualification.

## WP00.01 — source and environment

Intent: bind observations to actual source bytes and environment before judging
old findings. HEAD/dirty tree are facts, not runtime authority. Evidence becomes
usable only with the command, exit status, input digest and raw log together.

- Starting HEAD: `b25961cc46532f5e30ff60cc381fed51c59d13ab`.
- Branch: `refactor/safety-preserving-architecture`.
- Initial tracked tree: clean. The only untracked input is the plan package;
  do not stage, rewrite or delete it.
- Evidence root: `/tmp/oma-consistency-evidence-Vc66uK` (outside the repository).
- `source-head.txt`, `branch.txt`, `working-tree.txt`, `initial.patch`,
  `tracked-files.txt`, `untracked-files.txt`, `input-digest-before.json`,
  `environment.log` preserve the observed starting state.
- Node 26.7.0, npm 12.0.2, Git 2.55.0, SQLite 3.53.4, Linux/Btrfs,
  bwrap 0.11.2, systemd 261, cloc 2.08 were observed.
- A running user manager is not a disposable test user. No operational society,
  credential, paid provider, VM powercut, remote branch or PR was touched.

The preceding handoff is historical context in Git, not evidence for this work.
Current verification claims remain source-bound; do not upgrade any environment
NOT_RUN/BLOCKED status from local test results.

## WP00.02 — inventory and ownership

Intent: enumerate every tracked file and the compiler-resolved import closure;
assign review responsibility without claiming source review or runtime coverage.
The fixed production assignments remain authoritative for their existing paths.

`file-assignments.json` and `wp00-file-assignment.{json,log}` in the evidence root
map every tracked path to exactly one primary WP. The nine contract modules in
`implementation/contracts/` are in the compiler closure but outside the fixed
production manifest. They are explicitly assigned to WP29 for manifest/LOC
scope review; no baseline generator was run to conceal this discrepancy.

The supplemental artifact map covers tests, scripts, contracts, CI and docs.
Its `NOT_STARTED`/`NOT_RUN` rows are assignments, not file-review conclusions.

## WP00.03 — unchanged baseline

Intent: inspect committed measurements before install/build, then execute the
actual package scripts. Do not repair code merely to make the baseline green.

Raw evidence is `wp00-inventory-before`, `wp00-install`, `wp00-typecheck`,
`wp00-build`, `wp00-package`, `wp00-architecture`, and `wp00-local` (`.json` metadata
plus `.log` stdout/stderr). Every invocation exited 0; the local suite reported
zero skipped/todo/cancelled tests. Input digests before and after were unchanged.
No generator was invoked. See the external WP00 handoff for exact commands and
scope; this does not refresh old CI/provider/kernel/powercut claims.

## WP00.04 — findings reclassified

Intent: read current owners and caller paths, separating source-level mismatch
from reproduced runtime failure. `WP00-findings.md` in the evidence root records
all F01–F12, N01–N02, H01–H05 and Q01–Q02 with next oracle owners.
No product bug has been declared fixed. H hypotheses remain uncertain pending
their actual environment/decision tests. `WP00-FILE-REVIEW.md` records exact
read ranges and KEEP/INVESTIGATE reasons, without claiming unread file closure.

## WP00.05 — evidence closure / next step

Intent: keep immutable raw evidence outside verification inputs and prove the
oracles reject stale input and hidden nonexecution before relying on them.

Read `/tmp/oma-consistency-evidence-Vc66uK/WP00-HANDOFF.md` before WP01/02.
It fills the plan HANDOFF template with actual argv, exit codes, source binding,
raw logs, negative-control assertions, restored positive controls and limitations.
`WP00-evidence.sha256` binds the external artifacts; `wp00-close.json` records
the ending commit/digest. `wp00.patch` records the documentation-only tree delta.

V00A: an actual input edit and a deliberately omitted input each failed the
existing source-digest regression in an isolated detached worktree. V00B: a
mutant accepting skipped tests failed; real kernel/crash dry qualification
returned BLOCKED/NOT_RUN. Restored originals passed. No manager mutation,
provider call or VM power loss was performed. The user plan checksums still match.

WP01 must first read D01–D06 and the current normative contracts. Do not mark
runtime-dependent ADR claims qualified until their designated environment WP.
WP00 completion does not imply any of WP01–WP32 or the overall goal is complete.

## WP01.01–05 — adopted decisions and bounded verification

Intent: lock existing domain facts, relations, transitions and current authority
before runtime refactors. D01–D06 choices and existing-rule conflict resolutions
are in `implementation/consistency-decisions.md`, with case/profile/registry
tables, migration/rollback constraints and a checked topological execution order.
Existing normative clauses were updated together; actual architecture bytes
are bound by N-001. D03 still needs WP03's clean disposable-user evidence.

`test/consistency-decisions.test.mjs` first failed on missing/contradictory
decisions. It retains exact v1 DDL and invokes the production unsupported-profile
guard. A detached guard-removal control was rebuilt and failed its assertion;
undo/rebuild restored the positive control. Unchanged contract/wire goldens
were reused. These are document/local-contract tests, not proof of delivery
settlement, managed publication, engine persistence or power-loss durability.

Read `/tmp/oma-consistency-evidence-Vc66uK/WP01-HANDOFF.md` and its file review,
task result, patch and `WP01-evidence.sha256` before WP02. Raw evidence names
exact argv, exit, source inputs and log hashes. Final local gates were rerun
after verification-record metadata changed; no prior-source result was promoted.
No generator or production runtime owner was changed. C2 choices still need
their specified fixtures; C3 still needs separate approval. Overall plan and
release/environment qualification remain incomplete.

Execution preference: report each WP's start and end to the user (scope, actual
verification and remaining gates), then proceed immediately to the next eligible
WP without waiting for confirmation. Goal mode is inactive; do not call goal tools.

## Active WP02 — fixture / oracle tooling scope

Intent for WP02.01: distinguish shape-valid data from complete configuration,
live Store/Mail and installed-runtime fixtures. A normal configuration must pass
the real closed loader before it is returned; explicit corruption happens only
after that baseline. Local file assets and a fake deployment digest do not prove
an installed runtime. No production validator or authority is weakened.

WP00/WP01 handoffs and evidence manifests were reread/verified. Current candidate
Q02 remains: the config-bundle positive control calls only readConfigurationSource
with incomplete host/model/profile values. Extend that same composition to
loadConfiguration first; preserve all existing containment cases.

Additional test-only scope: extract the already-complete operations fixture to
`test/fixtures/configuration.ts`; migrate its two callers, document layer names
in `test/fixtures/README.md`, and extend existing fixture/verification tests.
Reuse existing durable seams and process harnesses for subsequent WP02 substeps;
no production imports from test code, no new global bypass flags.

WP02.01 checkpoint: the old positive fixture failed the real loader with
`config: root.schemaVersion is required`. The complete fixture was extracted
from the existing operations tests rather than duplicating config construction;
both inline and split forms now pass the loader before being returned.
Existing test names/cases were preserved. Explicit quota/resource/model-relation
corruption controls reject both formats, and Extensions composition reloads
before and after writing. No product validator or runtime source changed.

Focused checks, typecheck, build and architecture/inventory passed (`wp02-01-*`
outside the repository). WP02 is still IN_PROGRESS: effect observation/driver,
failure matrix, V02C controls and lane/report integration remain. The validation
record currently binds WP01, not these changed verification inputs; full-suite
record refresh and final rerun belong to WP02 closure, not an inherited PASS.
See `/tmp/oma-consistency-evidence-Vc66uK/WP02-RESUME.md` for exact read scopes
and the reusable existing crash seams to review next.

WP02.02 intent: observe file hashes/inodes and raw committed SQLite facts from
test-only code independently of production planners. Reuse existing unit-effect
and engine-event counters with their narrower proof scopes. Add local Mail replay
and real configuration replacement controls; never infer absence from an I/O
error. Additional test-only files: `test/fixtures/effect-observation.ts` and
`test/effect-observation.test.ts`. Existing uncommitted formatting in
`test/fixtures/configuration.ts` is preserved, not reset. All WP00–WP32 todos
are now registered with the plan's dependencies; only WP02 remains active.

WP02.03 intent: extract the existing IPC-checkpoint/SIGKILL pattern into a bounded
test-only driver, preserving the systemd exclusion of the original mixed suite.
A matching child message plus confirmed SIGKILL is required; timeout/early exit/
wrong point/throw-only cleanup are failures. Fresh-process physical observation
is separate from the checkpoint claim. New driver tests and fixtures stay under
`test/`; reuse `crash-worker.ts` only on local Mail boundaries. No live manager
or production test-bypass is introduced.
