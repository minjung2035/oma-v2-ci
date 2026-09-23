# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18, WP06, WP19, WP20, WP21, WP22, WP24.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next eligible card: **none in this environment**. Every remaining card (WP07–10, WP13–16, WP23, WP25–32) depends directly or transitively on BLOCKED WP03; resuming needs an approved disposable-user systemd topology for WP03. Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP24 boundary

Git recovery settles only an effect it can prove (D06).

- A no-op integration (`base==candidate`) has no CAS to prove its authorization: its recovery repeats the current policy, eligibility, stop and authority checks and settles only if they pass, like execute. An applied non-no-op CAS settles as history without new authority.
- A CAS that finds a third main leaves it untouched and the operation unknown; recovery never overwrites it or rebuilds from the current HEAD. Executable checks stay gated.

V24A (SHA-1/SHA-256) and V24B are required in durable/all. Unchanged production settles a pending no-op after stop, policy change or capability removal; four mutants and lane removal each fail. Exact evidence is in the external WP24 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation, WP12 one bounded configuration snapshot, WP18 one context preaccept scope (exclusive pinned staging root, plan-reference retention, per-tree native quiescence), WP19 sequential create/bootstrap brief settlement, WP20 mail/submit linked-object ownership, WP21 category admission and accepted-phase failures, WP22 one storage owner with reservation leases and settlement headroom and WP06 one receipt observation union with separate live/recovery settlement (`settleFromReceipt` awaits its WP07 caller) remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
