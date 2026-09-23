# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18, WP06, WP19.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP20** (WP13, WP07, WP14 and WP16 wait on BLOCKED WP03). Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP19 boundary

Create and bootstrap freeze an initial brief before acceptance; one `PreacceptScope` now decides every brief.

- Bootstrap prepares seeds one at a time and registers each brief as soon as it is frozen. The seed-set transaction, or any failure before it, settles all of them; nothing keeps freezing after a failure.
- Create registers its brief right after freezing; policy refresh, re-resolution and the acceptance transaction end in `settleFailure`/`settle`.
- A brief belongs to an accepted operation only if its plan's `initialMessage` has the same id and sha256. A linked plan names none, so a same-name loser's brief is discarded without a row-exists shortcut. Winner choice stays in the transaction; post-accept workspace, readiness, mail and activation are unchanged.

V19A and V19B are required in durable/all. Unchanged production leaks two briefs per bootstrap partial failure and one per refresh failure; three semantic mutants and lane removal each fail. Exact evidence is in the external WP19 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation, WP12 one bounded configuration snapshot, WP18 one context preaccept scope (exclusive pinned staging root, plan-reference retention, per-tree native quiescence) and WP06 one receipt observation union with separate live/recovery settlement (`settleFromReceipt` awaits its WP07 caller) remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

mail/submit still settle by row existence (`settleByAcceptance`) until WP20; `MailModule.freezeObject` can leave a published destination when validation/fsync fails before an owner is returned (WP20). The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
