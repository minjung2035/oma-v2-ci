# OMA v2 — consistency plan execution

## Current state

- Branch: `refactor/safety-preserving-architecture`.
- User plan: `oma-v2-consistency-plan-b25961c/`, unchanged and untracked. Never stage/reset/rewrite/delete it.
- Completed within documented scopes: WP00, WP01, WP02, WP04, WP11, WP17.
- WP03 remains **BLOCKED / incomplete**: clean disposable-user topology preflight refused before manager invocation. Preserve `/tmp/oma-consistency-evidence-Vc66uK/WP03-BLOCKED-HANDOFF.md` and all original dependency edges.
- Next selected eligible card: **WP05**. Goal mode is inactive; never reuse old goal IDs/tools.
- Keep exactly one WP active. Continue without confirmation; record unavailable qualification honestly and proceed with other eligible work.

## Evidence discipline

Evidence root: `/tmp/oma-consistency-evidence-Vc66uK`. Read predecessor handoffs, the card/ADRs, and actual source. Historical resume files are not latest status. `implementation/validation.md` solely owns current counts/LOC/PASS tables; do not duplicate them here.

## WP17 handoff essentials

WP17 adds a narrow preaccept ownership scope, not a generic resource manager or a new durable table.

- Registration binds an owning operation identity, a concrete resource identity, its `PreacceptOwner`, the authoritative reference observer, and optional native-quiescence observer.
- Closed dispositions are `unaccepted-known`, `accepted-referenced`, `accepted-unreferenced`, `outcome-unknown`, and `cleanup-unconfirmed`.
- Unknown DB/reference/native-descendant quiescence retains evidence. An accepted row alone is not ownership: an accepted-unreferenced artifact is discarded only after that relation is observed.
- Cleanup attempts continue after one failure. `settleFailure(primary)` preserves the primary cause and aggregates cleanup failures with the full disposition report.
- Failed cleanup does not mark ownership released. It may retry the same frozen decision; successful repeated settlement is inert and cannot create new ownership.
- Published-file observation distinguishes known absence from unavailable identity. A replaced inode is never deleted and is reported cleanup-unconfirmed.
- Submit-spool identity is captured immediately after exclusive open, before streaming/fallible work; preparation failure cleanup uses that inode identity rather than unconditional path deletion.
- `PreparationExecutor.quiescence` exposes only `quiescent`/`unknown`; non-exit or arbitrary-descendant uncertainty stays sticky and prevents cleanup authorization.
- Existing `settleByAcceptance` callers now use the scope and pass operation identity. Full relation-aware caller migrations and domain-specific exception handling remain WP18–WP20 as the card requires.

V17A/V17B production-linked cases cover aggregate cleanup, DB/native unknown retention, retry/idempotence, inode replacement, and an actual accepted Store row whose plan does not reference the artifact. Negative controls restore DB-error→false and accepted-row blanket retention; both fail. Exact commands/results live in the WP17 external handoff/task result.

## WP11 boundary retained

The canonical pure config validator creates deep immutable candidates; one exact descriptor registry owns editable config field semantics; all supported settings writes validate the whole candidate before publication. This is C0/C1 and does not claim managed-generation atomicity, serialization, or retention. See `/tmp/oma-consistency-evidence-Vc66uK/WP11-HANDOFF.md`.

## Limits still binding

- No operational society, real credential, paid provider, unit installation, VM powercut, push/PR/merge, or branch-protection action was performed.
- Clean-user systemd/kernel, production-only installation, provider persistence, VM/storage power loss, successful current-SHA CI, and A-008 release review remain unqualified/open.
- Preserve v1 schema/wire/receipt/live fencing. C2 requires named compatibility/retention/uncertainty fixtures; C3 requires approval.
- Nine manifest omissions remain WP29; runtime/dev package classification and artifact-only installation remain WP31.
- Partial/SCOPE_ONLY reviews stay explicit. Types, static checks, assignment, and fixture counts never substitute for unperformed runtime/source review.
- Overall WP00–WP32 and release qualification remain incomplete.
