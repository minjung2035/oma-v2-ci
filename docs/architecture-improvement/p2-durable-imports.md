# C4 — durable contract imports and pre-Journal transition characterization

Migrated Store, the ledger reader, row/operation decoders, operation transitions,
closed durable validators and shared value validators to precise contract owners.
Every changed file was compared to its source-pinned original: imports retain
identical aliases and all non-import tokens are unchanged. The migration changes
neither SQL nor executable validation/transition behavior.

Before introducing a Journal, captured 12 actual SQLite characterization tests:
key retry/reuse, immutable accepted plan, same-transaction preparation, exact
terminal bytes, failed/unknown transitions, rejection of preaccept-only failures,
cross-entity rollback, commit-time decoding and expired/async transaction handles.
The same tests pass after the import migration. Together with 18 actual wire
schema vectors, the after-run has 30 pass, zero fail/cancelled/skipped/todo.

Environment: Node 22.16.0, TypeScript 5.8.3 transpilation; node:sqlite and real
on-disk temporary databases. This is stronger than the prior stub-only tests but
is not the repository's pinned full build/typecheck, native host or power-loss
proof. Source identity report: `evidence/p2-durable-imports.json`. Raw before/after
logs: `evidence/p3-transitions-before.tap.gz`, `evidence/p2-durable.tap.gz`.

P3 O1 is characterization only at this point; a new Journal is not claimed yet.
P0 locked dependency/full-repository evidence remains blocked. Original v1
contracts and schema, physical ordering and OPEN SPIKE states are unchanged.

TAP logs are losslessly gzip-compressed; use `gzip -dc <file.tap.gz>` to read.
