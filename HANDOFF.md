# OMA v2 — consistency plan execution

- Branch `refactor/safety-preserving-architecture`; user plan directory stays unchanged/untracked and must never be staged/reset.
- Completed scopes: WP00, WP01, WP02, WP04, WP11, WP17, WP05, WP12, WP18.
- WP03 remains BLOCKED/incomplete on approved disposable-user systemd topology; preserve its evidence/dependencies.
- Next selected eligible card: **WP06**. Goal mode inactive. Keep one WP active and continue without confirmation.
- Evidence root `/tmp/oma-consistency-evidence-Vc66uK`; `implementation/validation.md` solely owns current result counts/LOC/PASS tables.
- Seven test files carry the user's formatting-only edits (AST-equal to HEAD). They are not WP work: never stage, reset or reformat them. Bind final evidence in a clean worktree.

## WP18 boundary

`context.publish` acquires two artifacts before acceptance: an exclusively created staging root and a frozen mail object.

- `prepareContextStream` creates `staging/context-<op>` exclusively, pins its identity and returns a `PreparedContextTree`. Until it returns it owns failure cleanup: exact files first, then its root; a replaced file keeps both. An existing root is never adopted.
- From return to the acceptance transaction, one `PreacceptScope` owns tree and object. Each is registered at acquisition with an observer of the accepted plan's reference (`stagingPath`; message id and sha256), not row existence. Candidate, EML, freeze, final canonical observation and T all end in `settleFailure` (primary first) or one `settle`.
- An unavailable acceptance observation retains. A tree on which this repository started a native preparation is retained while the executor is uncertain; a later request refused before native work removes its own tree.
- Post-accept failures stay with `rejectAccepted`; connection close never removes accepted evidence, and same-key retry/reconcile reuse the frozen plan without a new candidate or payload.
- `src/git.ts` (WP24) gained one composition line for the required `preparationQuiescent(tree)` effect.

V18A/V18B are required in durable/all. Pre-fix and baseline runs fail four leaks/deletions; five semantic mutants and lane removal each fail. Exact evidence is in the external WP18 handoff/task result.

## Retained boundaries and limits

WP05 private no-replace receipt publication/first-fact return, WP17 preaccept dispositions, WP11 whole-candidate validation and WP12 one bounded configuration snapshot remain. No operational society, real credential/provider, unit install, powercut, push/PR/merge or branch policy action occurred.

mail/submit/create still settle by row existence (`settleByAcceptance`) until WP19/WP20; `MailModule.freezeObject` can leave a published destination when validation/fsync fails before an owner is returned (WP20). The `ctx-accepted` crash boundary is a systemd-only suite and BLOCKED here. Clean-user systemd/kernel, installed runtime/provider persistence, VM/storage power loss, current-SHA CI and A-008 release review remain unqualified/open. Preserve v1 schema/wire/receipt/live fencing. Nine manifest omissions remain WP29; dependency classification/artifact-only install remain WP31. Partial/SCOPE_ONLY reviews stay explicit. Overall WP00–WP32/release completion is not claimed.
