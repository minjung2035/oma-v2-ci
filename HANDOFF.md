# OMA v2 — consistency plan execution

## Current task

WP00 is active under `oma-v2-consistency-plan-b25961c/` (user-supplied plan,
kept untracked and unchanged). Follow its dependency graph, not numeric order.
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
