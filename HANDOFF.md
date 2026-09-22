# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP18**. Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.

## WP12 boundary

`loadConfigurationSnapshot` reads one manifest once and returns one bounded closure: validated config, roles, exact authored layout, authored role sources, and stable per-file dev/inode/size/time/hash identities.

- A manifest replacement after initial read does not mix new paths into the returned snapshot. Old referenced generation files must remain available; WP13 owns that producer/retention requirement.
- Referenced file drift before completion is an explicit failure. This is detection, not exclusion of arbitrary same-UID external writers.
- Per-file 1 MiB limits remain; unique closure additionally has finite file/aggregate-byte budgets. Shared referenced files count once.
- `promptFile` remains index-root-relative even for nested role files.
- `readSettings` consumes one snapshot. The product entry passes that same snapshot to Extensions, removing its independent host/role/manifest parse. Compatibility string calls also perform a complete snapshot read.
- Session/runner callers already consume one complete `loadConfiguration` activation result. No managed writer generation, expected-version serialization, commit result, retention or GC was introduced.

V12A/V12B are required in durable/all. Negative controls reintroduce a second manifest read, role-directory prompt resolution, and unlimited aggregate closure; each fails. Exact evidence is in the external WP12 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, and WP11 whole-candidate validation remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
