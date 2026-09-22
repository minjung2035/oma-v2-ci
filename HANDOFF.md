# OMA v2 — consistency plan execution

## Current state

- Branch: `refactor/safety-preserving-architecture`.
- User plan: `oma-v2-consistency-plan-b25961c/`, unchanged and untracked. Never stage, reset, rewrite, or delete it.
- WP00, WP01, WP02, WP04, and WP11 are complete within their documented scopes.
- WP03 is **BLOCKED / not complete**: its clean disposable-user topology preflight refused before manager invocation. Evidence: `/tmp/oma-consistency-evidence-Vc66uK/WP03-BLOCKED-HANDOFF.md`. No runtime/template relaxation was made and `BindsTo` was preserved.
- Next independent eligible WP: **WP17**. WP03-dependent work remains blocked.
- Goal mode is inactive. Do not use earlier goal IDs or goal tools.
- Todos encode the actual dependency graph (`metadata.wp` identifies a card; todo number is not the WP number). Keep exactly one WP active.
- Continue without asking for confirmation. Record unavailable qualification honestly and proceed with other eligible work rather than inventing PASS.

## Evidence and predecessor reads

Evidence root: `/tmp/oma-consistency-evidence-Vc66uK`. Preserve it. Read the completed WP handoffs, WP03 blocked handoff, the next card, adopted ADRs, and actual current source before implementation. Historical resume files are checkpoints, not latest status.

`implementation/validation.md` is the sole current verification-status/count/LOC owner. Do not duplicate its PASS/count/LOC tables here. Each completed WP has raw source-bound command records, file review, task result, patch, and checksum manifest.

## WP11 handoff essentials

WP11 is a C0/C1 ownership correction; it does not enter the managed-generation C2 migration.

- `validateConfig(raw)` is the single pure whole-candidate validator. It preserves the existing closed fields, integer bounds, model/profile/capability/quota relations, and error meanings, then returns a deep-copied/frozen `ValidatedConfigCandidate` with null-prototype model/profile maps.
- `loadConfiguration` remains the file-reading facade and existing callers still receive compatible `HostConfigV1` values. A type brand does not replace runtime validation.
- The settings writer validates the complete transformed candidate before any inline or split authored file changes. Invalid cross-field edits preserve all authored file identities and bytes.
- `EditableField` is a literal union. One null-prototype `PLACEMENT` descriptor registry owns value validation/pure transform, display, apply-time metadata, and split-file placement. The actual TypeScript compiler rejects a missing descriptor or a weakened string-indexed claim.
- `extensions` remains a navigation link, not an editable config command. Prototype names are not registry members.
- Worker profile is explicitly a bootstrap-only edit. With zero seeds it is not displayed and direct application is rejected; it does not become an implicit child-delegation edit.
- Config edits do not rewrite persisted agent specs, accepted operation plans, or request hashes. Existing runtime rows retain their frozen identities.
- Existing inline durable replace and split owner files remain. WP11 proves validate-before-write, not multi-file atomicity, expected-version serialization, managed generation retention, or external-writer exclusion; those remain WP12–WP15 scope.

Production-linked V11A/V11B/V11C cases are registered in durable/fast/property and all lanes respectively. Negative controls restore the old writer, replace the snapshot with shallow freeze, and remove one descriptor; the matching runtime/compiler oracles fail. Exact results and remaining limitations are in the WP11 external handoff/task result.

A tracked `.pi-lens.json` excludes generated `dist/**` and vendored `reference/**` from diagnostic walks, matching the repository's existing gitleaks policy without excluding authored build/package/verification inputs. The WebSocket RFC sample nonce in an authored test is computed at runtime rather than stored as a credential-shaped literal.

## Previously completed WP04 boundary

Store compatibility observation precedes writer setup; active WAL is never ignored through an unconditional immutable fallback. Journal/incomplete-sidecar/alias/corrupt evidence is preserved and refused, constructor failures close their owned native connection, and v1 DDL/wire/receipt/authority remain unchanged. See `/tmp/oma-consistency-evidence-Vc66uK/WP04-HANDOFF.md` and `implementation/store-opening.md`.

## Limits that remain binding

- Clean-user systemd/kernel qualification, production-only installation, real provider/PTY persistence, VM/storage power loss, and successful current-SHA CI remain unproved unless a later WP supplies their prescribed evidence.
- No operational society, real credential, paid provider, unit installation, VM powercut, push, PR, merge, or branch-protection change was authorized or performed.
- D01–D06 remain as recorded in `implementation/consistency-decisions.md`; D03 still needs WP03 environment evidence.
- Preserve v1 schema/wire/receipt and live fencing. C2 requires its reader/writer/retention/uncertainty fixtures; C3 requires separate approval.
- Nine contract sources omitted from the production manifest remain WP29 scope. Runtime/dev lockfile classification and artifact-only installation remain WP31 scope.
- A-008 architecture review/release gate remains open; updated measured artifacts do not close it.
- Partial or scope-only source reviews remain explicit in FILE-REVIEW evidence. Assignment, type checks, static gates, and fixture results never close an unperformed runtime review.
- Overall WP00–WP32 execution and release qualification are not complete.
