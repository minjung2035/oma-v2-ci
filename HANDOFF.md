# OMA v2 — consistency plan execution

## Current task

WP00 is complete (C0 baseline only) under `oma-v2-consistency-plan-b25961c/`
(user-supplied plan, kept untracked and unchanged). Next permitted: WP01 or WP02;
recommended next: WP01. Follow the dependency graph, not numeric order.
Only one WP may be active. No runtime/schema/wire/receipt/authority change has
been made by this execution.

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
