# OMA v2 — consistency plan execution

## Current state

- Branch: `refactor/safety-preserving-architecture`.
- User plan: `oma-v2-consistency-plan-b25961c/`, unchanged and untracked. Never stage/reset it.
- WP00, WP01 and WP02 are complete within their documented scopes.
- Next recommended/eligible WP: **WP03**. WP04/WP11/WP17 are also dependency-eligible;
  use the selected plan order, not numeric sorting. Only one WP is active at a time.
- Goal mode is inactive. Do not use earlier goal IDs or goal tools.
- All WP00–WP32 todos are registered with actual dependencies (`metadata.wp`
  identifies the card; todo number is not the WP number).
- User explicitly requests continuous execution: report each card's start/end,
  then proceed without asking confirmation. Unavailable qualification must be
  recorded honestly; continue independent eligible work rather than invent PASS.

## Evidence and required predecessor reads

Evidence root: `/tmp/oma-consistency-evidence-Vc66uK`. Preserve it.
Read `WP00-HANDOFF.md`, `WP01-HANDOFF.md`, `WP02-HANDOFF.md` and the current card
before proceeding. Each completed WP has file reviews, raw logs and source-bound
closure metadata/checksums. `WP02-TASK-RESULT.json` names the exact ending commit,
changed-file hashes, patch, commands, negative controls and next eligible tasks.
The older `WP01-RESUME.md` / `WP02-RESUME.md` are historical checkpoints, not the
latest status. Current verification status owner: `implementation/validation.md`.
Detailed earlier intent/handoff history is retained in Git and external evidence.

## WP02 handoff essentials

C0 test/tooling only: no main-tree production runtime, DDL, wire, receipt version,
authority or manager gate changes. Reused/extracted complete config fixtures,
added independent FS/SQLite/Git observations, bounded IPC-checkpoint/SIGKILL driver,
fresh observer process, explicit failure matrix, prompt/unit effect observations,
and stable lane IDs. `test/fixtures/README.md` gives APIs and exact case mapping.
Original incomplete fixture failed the actual loader in a detached control;
corrected production composition passed. Missing/wrong/timeout/throw-only/false
checkpoint controls distinguish reported signals from independent physical effects.
Final local and fast/durable/property runs were repeated after record metadata
changed. Preserved existing configuration-fixture formatting without resetting it.

## Limits that remain binding

- Actual clean-user systemd/kernel, full installed runtime/provider qualification,
  VM/storage power loss and current-SHA successful CI remain unproved here.
- A running UID 1000 manager is not a disposable test user. No operational society,
  real credentials, paid provider, VM powercut, push, PR or merge was authorized.
- D01–D06 are adopted at `implementation/consistency-decisions.md`; D03 still needs
  WP03 environment evidence. Normative intent is not implemented runtime proof.
- Preserve v1 schema/wire/receipt and live fencing. C2 needs its specified reader/
  writer/retention/uncertainty fixtures. C3 requires separate approval.
- Nine contract sources omitted from the production manifest remain WP29 scope;
  runtime/dev lockfile classification and artifact-only install remain WP31 scope.
- Partial/unread source scopes are explicit in each FILE-REVIEW. Assignment,
  types, static checks and fixture results never close unperformed runtime review.
- Overall WP00–WP32 execution and release qualification are **not complete**.
