# OMA v2 — consistency plan execution

## Current state

- Branch: `refactor/safety-preserving-architecture`.
- User plan: `oma-v2-consistency-plan-b25961c/`, unchanged and untracked. Never stage, reset, rewrite, or delete it.
- WP00, WP01, WP02, and WP04 are complete within their documented scopes.
- WP03 is **BLOCKED / not complete**: the clean disposable-user topology preflight refused before manager invocation. Evidence: `/tmp/oma-consistency-evidence-Vc66uK/WP03-BLOCKED-HANDOFF.md`. No runtime/template relaxation was made and `BindsTo` was preserved.
- Next independent eligible WP: **WP11**, then WP17 as dependencies permit. WP03-dependent work remains blocked.
- Goal mode is inactive. Do not use earlier goal IDs or goal tools.
- All WP00–WP32 todos are registered with actual dependencies (`metadata.wp` identifies the card; todo number is not the WP number). Only one WP may be active.
- Continue without asking for confirmation. Record unavailable qualification honestly and proceed with other eligible work rather than inventing PASS.

## Evidence and required predecessor reads

Evidence root: `/tmp/oma-consistency-evidence-Vc66uK`. Preserve it. Before the next card, read the completed WP handoffs and the WP03 blocked handoff, then the new card and its actual source. Each completed WP has source-bound raw logs, file review, task result, patch, and checksum manifest. Historical resume files are checkpoints, not the latest status.

`implementation/validation.md` is the sole current verification-status and result-count owner. Do not duplicate its PASS/count/LOC tables here. It binds the current authored verification inputs by normalized digest and retains honest `NOT_RUN`/`BLOCKED` qualifications.

## WP04 handoff essentials

WP04 is a C1 correction to Store opening, not a schema migration or an additional writer. Compatibility observation now precedes writer PRAGMAs and migration. Closed/quiescent database artifacts are observed under the already-required startup single-writer fence; observation metadata is not authority.

- Existing WAL plus SHM is read through the native read-only `readonly_shm=1` path. Existing journal or incomplete sidecar evidence is preserved and refused as unavailable.
- With all sidecars absent, a conditional read-only immutable main-file view avoids SQLite creating sidecars during compatibility observation; identities and absence are rechecked before writer setup. This is not a fallback that ignores a failed or active WAL.
- Store accepts a filesystem path, not a caller-supplied SQLite URI. Database/sidecar leaves must be singly linked regular files so another hard-link name cannot hide the original sidecars.
- The v1 readable registry, DDL, wire, receipts, live fencing, transaction capability, and full row/relation decoders are unchanged. Version zero is eligible only for an empty SQLite schema.
- Until construction returns, the constructor owns its native connection. Any later setup/composition failure closes it; primary, rollback, and close causes are retained.
- `implementation/store-opening.md` defines phases, authority assumptions, failure semantics, compatibility, and rollback.

Production-linked V04A/V04B regressions use actual Store/native SQLite paths plus independent file identities/bytes. They cover unsupported DELETE/WAL inputs, retained WAL facts, corrupt/unversioned inputs, alias and sidecar ambiguity, a killed hot rollback journal, supported v1/new databases, PRAGMA/migration/reader failures, cleanup causes, lock ownership, permissions, and ownership transfer. The durable/all lanes require both stable IDs.

A separate owned bwrap fixture observed an actual read-only mount and Store refusal without altering the database. It borrows this checkout's built runtime and dependencies: it is not installed-runtime, manager, provider, or power-loss qualification. POSIX permission denial and direct-child SIGKILL are likewise not those broader qualifications.

Formatter-shaped changes to earlier WP02 test/fixture files were preserved. A source-bound TypeScript AST comparison against the committed source found no semantic AST differences; all complete verification scopes were rerun on the preserved bytes. The failed JavaScript byte-comparison attempt is retained as a negative method result because the TypeScript emitter preserves some source formatting.

## Limits that remain binding

- Actual clean-user systemd/kernel qualification, production-only installation, real provider/PTY persistence, VM/storage power loss, and successful current-SHA CI remain unproved unless a later WP supplies their prescribed evidence.
- No operational society, real credential, paid provider, unit installation, VM powercut, push, PR, merge, or branch-protection change was authorized or performed.
- D01–D06 remain as recorded in `implementation/consistency-decisions.md`; D03 still needs WP03 environment evidence.
- Preserve v1 schema/wire/receipt and live fencing. C2 requires its reader/writer/retention/uncertainty fixtures; C3 requires separate approval.
- Nine contract sources omitted from the production manifest remain WP29 scope. Runtime/dev lockfile classification and artifact-only installation remain WP31 scope.
- A-008 architecture review/release gate remains open; updated measured artifacts do not close it.
- Partial or scope-only source reviews remain explicit in each FILE-REVIEW. Assignment, type checks, static gates, and fixture results never close an unperformed runtime review.
- Overall WP00–WP32 execution and release qualification are not complete.
