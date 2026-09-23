# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18, WP06, WP19, WP20, WP21, WP22.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP24**; every other remaining card waits on BLOCKED WP03 (directly or through WP07/WP13/WP25). Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP22 boundary

One `StorageAdmission` per broker process owns the logical storage quota: a fresh tree scan plus every outstanding reservation, no cache.

- A streamed request reserves its declared bytes from preflight until its execution settles or its connection closes, released once; it therefore needs room for its transport and accepted copies, and every other admission counts it.
- Settlement of accepted work may pass the quota by the existing `limits.frameBytes` headroom, one over-cap settlement at a time; past it settlement is refused and its evidence retained. Startup enters bounded recovery on the same judgement.
- The scan is not a hard filesystem quota; physical exhaustion stays STORAGE_FULL (observed on a real full tmpfs).

V22A (stress/all) and V22B (durable/all) are required. Unchanged production fails the at-cap settlement, in-flight reservation visibility and owner units; eight mutants fail and one (completion recorded after a failed materialization on a full filesystem) survives as indistinguishable there. WP22.05 long-run stress is NOT_RUN. Exact evidence is in the external WP22 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation, WP12 one bounded configuration snapshot, WP18 one context preaccept scope (exclusive pinned staging root, plan-reference retention, per-tree native quiescence), WP19 sequential create/bootstrap brief settlement, WP20 mail/submit linked-object ownership, WP21 category admission and accepted-phase failures and WP06 one receipt observation union with separate live/recovery settlement (`settleFromReceipt` awaits its WP07 caller) remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
