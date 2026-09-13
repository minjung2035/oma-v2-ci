# P3 O4 — Store operation writes now use the Journal

Source inspected before this unit: `a89912b425cd7750324ec44e2a2c6326ad06540f`.
The existing OperationJournal was present but not yet composed into Store.
This unit connects it to the existing LedgerReader, OperationTransitions and
TransactionScope. The compatibility methods remain, including the `reused`
error export. Key classification and acceptance policy no longer have a second
implementation in Store.

No SQL, schema, decoder, transition policy, transaction ordering, wire field,
accepted plan byte or OPEN gate changed. The Journal neither opens a connection
nor runs a transaction. The one Store connection still owns the root transaction.

## Executed evidence

Before: existing 12 SQLite transition-characterization tests passed.
After: the same 12 and 2 Journal integration tests passed: 14 pass, zero
fail/cancelled/skipped/todo. The integration test instruments only delegation
and still runs the actual Store, SQLite, decoders and transitions.

The entire restored transitive ledger/filesystem source closure was also
semantically checked and emitted before and after with strict,
noUncheckedIndexedAccess and exactOptionalPropertyTypes enabled.
Environment: Node 22.16.0, TypeScript 5.8.3, @types/node 24.0.4.
This is NOT the repository-pinned TypeScript 5.9.3 / locked full build.
No external dependency was stubbed for these SQLite tests.

Raw logs: `evidence/p3-integration-before.tap.gz` and
`evidence/p3-integration-after.tap` (`gzip -dc`).
Machine-readable source/tool/scope report: `evidence/p3-integration.json`.

## Progress / remaining

Journal composition and real transition preservation are implemented.
Scoped transaction facets, recovery exhaustiveness and coordinator migration
remain separate units. Full P0 package/native evidence remains blocked; this
focused execution does not certify release readiness. P8/P9 are not in scope.
