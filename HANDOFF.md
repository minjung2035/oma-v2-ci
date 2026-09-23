# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18, WP06.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP19** (WP13 and WP07 wait on BLOCKED WP03). Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP06 boundary

A delivery receipt is observed as exactly one of `verified`, `absent`, `unavailable` or `conflicting`, and every consumer reads the same four meanings.

- `absent` is a missing final name under an opened receipt directory, or a missing receipt directory under the runner root the batch was prepared beneath. A vanished runner root, an unreadable receipt or session, or an incoherent read is `unavailable`; a receipt with another identity or incarnation, a non-private or non-JSON file, a containment refusal or a missing session is `conflicting`. Diagnostics carry problem, errno and expected/claimed identity, never session content.
- Checked receipts are issued only by the decoder and recognised at runtime. The expected batch always comes from the ledger row.
- Live `batch.complete` keeps unit, lease and incarnation fencing; `requireVerifiedReceipt` maps absent/unavailable/conflicting to SESSION_BOUNDARY_UNCONFIRMED/BROKER_UNAVAILABLE/BATCH_CONFLICT. The Resident runner presents again only on `absent`.
- `settleFromReceipt(quiescence, batchId)` is the broker-owned recovery entry: no RPC route, no batch creation, no engine, no lease. It needs `RunRegistry.settlementQuiescence(actor)` (issued only while the actor's next run is opening, naming the previous incarnation, ending at publish/revoke/replace), keeps a completed batch's first fact and settles only verified receipts inside one re-checking transaction.
- WP07 must call it in `openRun` after `begin` and before the incarnation transaction, reassign only `absent` batches and define startup authority. WP08 must observe before Principal re-delivery.

V06A and "V06B local" are required in durable/all; the kernel-lane V06B is BLOCKED and not claimed. Unchanged production fails five V06A cases; seven semantic mutants and lane removal each fail. Exact evidence is in the external WP06 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation, WP12 one bounded configuration snapshot and WP18 one context preaccept scope (exclusive pinned staging root, plan-reference retention, per-tree native quiescence) remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

mail/submit/create still settle by row existence (`settleByAcceptance`) until WP19/WP20; `MailModule.freezeObject` can leave a published destination when validation/fsync fails before an owner is returned (WP20). The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
