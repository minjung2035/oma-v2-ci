# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18, WP06, WP19, WP20.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP21** (WP13, WP07, WP14, WP16, WP08 and WP15 wait on BLOCKED WP03). Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP20 boundary

Mail and submit settle every preaccept object through one `PreacceptScope`, like create and context.

- `freezeObject` owns only the inode its own publication linked; a failure after the link (validation, fsync) or in staging cleanup removes it and reports the primary failure first. An existing destination is never removed.
- An object or spool belongs to an accepted operation only if the plan names the same message (id+sha256) or bundle (path+sha256): `frozenMessageDisposition` is shared by mail, submit, context and create. Row existence no longer decides; `settleByAcceptance` stays only for the WP17 test in a user-edited file.
- Retry and recovery keep the frozen EML, recipient snapshot and bundle; archive presence alone is never success. The child mail harness halts at its checkpoint, so a simulated kill runs no cleanup.

V20A and V20B are required in durable/all. Unchanged production leaks an object after a post-link fsync failure and reports a cleanup EIO instead of the refusal; five mutants fail in the new file, two more in existing suites, one (submit spool row-exists) survives as unreachable. RequestCache/RPC connection loss and concurrent same-key are NOT_RUN. Exact evidence is in the external WP20 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation, WP12 one bounded configuration snapshot, WP18 one context preaccept scope (exclusive pinned staging root, plan-reference retention, per-tree native quiescence), WP19 sequential create/bootstrap brief settlement and WP06 one receipt observation union with separate live/recovery settlement (`settleFromReceipt` awaits its WP07 caller) remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
