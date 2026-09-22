# OMA v2 — consistency plan execution

## Current state

- Branch `refactor/safety-preserving-architecture`; user plan `oma-v2-consistency-plan-b25961c/` remains unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05.
- WP03 remains BLOCKED/incomplete on an approved disposable-user systemd topology. Preserve its evidence and dependencies.
- Next selected eligible card: **WP12**, then WP18. Goal mode is inactive. Keep exactly one WP active and continue without confirmation.
- Evidence root: `/tmp/oma-consistency-evidence-Vc66uK`. `implementation/validation.md` solely owns current count/LOC/PASS tables.

## WP05 handoff essentials

Delivery receipt v1 bytes and identity relations are unchanged; publication semantics are now C1-strengthened.

- Validate encoded candidate and exact batch/session/adapter/entry relations before publication.
- Create an unpredictable 0600 temporary under one held private parent; bounded write, file fsync, no-replace final link, final decode/mode validation, temp unlink, then parent fsync.
- Success returns only after final parent flush. Final-link followed by flush uncertainty preserves the final receipt and reports failure/unknown; it never deletes final evidence.
- A temp-write crash seam leaves no partial final name. Throw/process fault evidence is not VM/storage power-loss V05C.
- EEXIST validates and returns the first valid receipt. Conflict is preserved and rejected; nothing overwrites or widens mode.
- Resident runner already used the returned receipt. Principal completion now also uses the publisher's returned first fact rather than the later attempted boundary.
- Receipt reads require a bounded private 0600 regular file. Existing valid receipts remain compatible.

V05A/V05B are required in durable/all. Negative controls remove parent fsync and ignore the returned first fact; both fail. Exact evidence is in the external WP05 handoff/task result. V05C remains BLOCKED/NOT_RUN because no approved VM/storage powercut profile exists.

## Retained WP17/WP11 boundaries

WP17's five preaccept dispositions, inode identity, native uncertainty retention, aggregate cleanup and idempotent retry remain. Full caller migrations remain WP18–20. WP11's pure deep config validator, exact edit descriptor registry and validate-before-write ordering remain C0/C1; managed generations/serialization remain WP12–15.

## Limits

- No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch-protection action was performed.
- Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open.
- Preserve v1 schema/wire/receipt/live fencing. C2 needs named compatibility/retention/uncertainty fixtures; C3 needs approval.
- Nine manifest omissions remain WP29; runtime/dev dependency classification and artifact-only installation remain WP31.
- Partial/SCOPE_ONLY reviews remain explicit; static gates/types/counts do not close unperformed source/runtime review.
- Overall WP00–WP32 execution and release qualification remain incomplete.
