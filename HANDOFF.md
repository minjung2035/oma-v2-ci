# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18, WP06, WP19, WP20, WP21.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP22**, then WP24; every other remaining card waits on BLOCKED WP03 (directly or through WP07/WP13/WP25). Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP21 boundary

Every public and internal method descriptor names an internal D04 resource category; the logical storage quota refuses only admit and settle, after validation.

- Categories: read, admit, settle, safety-control; `host.reconcile` is staged and gates each recovery stage (mail settle, stop safety, create/start/git/context admit, unit start admit, unit stop safety). `resourceCategoryOf` has no fallback.
- Reads, safety stops and an accepted same-key lookup are never refused for storage; settlement stays gated until the WP22 reserve. The pre-DB startup guard remains the named WP22 gap.
- A coordinator's post-acceptance failure is an `AcceptedFailure`, so the public retry follows the accepted phase. Startup attempts every resident stop before reporting.

V21A (fast/all) and V21B (durable/all) are required. Unchanged production fails nine of ten cases; nine mutants and lane removal each fail. No wire, code, schema or permission change; validation errors now precede QUOTA_EXCEEDED. Exact evidence is in the external WP21 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation, WP12 one bounded configuration snapshot, WP18 one context preaccept scope (exclusive pinned staging root, plan-reference retention, per-tree native quiescence), WP19 sequential create/bootstrap brief settlement, WP20 mail/submit linked-object ownership and WP06 one receipt observation union with separate live/recovery settlement (`settleFromReceipt` awaits its WP07 caller) remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
