# P6 — read-only ledger integrity, first unit

Base: `32f8f2f9abe0253523e0af220f487f7e93ed3c74`.
Added bounded administrator-only diagnostic snapshots and an independent
whole-ledger integrity evaluator. The evaluator reuses closed pure decoders but
performs its own set/lineage/delivery/batch/usage checks, never reconciliation.

The read-only SQLite connection is opened by a separate function at the existing
`src/store.ts` raw SQLite owner. It never constructs the production Store, runs
migration, changes journal mode, or exposes SQL/writes. Missing files are not
created. Unknown versions, extra entities/views/triggers/virtual tables, linked
paths and resource-budget exhaustion fail closed. Queries use one read snapshot.
Existing Store methods, Journal and transaction SQL remain unchanged.

Checks cover all six closed rows, SQLite integrity and foreign keys, unique
identities, frozen operation/payload/hash/result relations, lineage, exact batch
membership, delivery presentation and usage actor/incarnation/profile ownership.
Historical subscription/desired state is not confused with current intent.
Pending and unknown operations are reported without rewriting or completing them.
A consistent snapshot may contain unresolved intent; PASS is not release proof.

D09: an administrator read-only connection is not another writer. Physical SQLite
ownership stays in Store; the evaluator does not import Store/transitions/recovery.
The CLI and physical observers are a separate next unit. P5 is not declared done
by adding this independently testable diagnostic boundary.

Executed with Node 22.16.0, TypeScript 5.8.3, @types/node 25.1.0:

```sh
./node_modules/typescript/bin/tsc --module NodeNext --moduleResolution NodeNext --target ES2023 --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck --rootDir . --outDir dist src/store.ts src/diagnostics/ledger.ts
node --test --test-concurrency=1 test/integrity-ledger.test.mjs test/coordinator-facets.test.mjs test/operation-transition-characterization.test.mjs
```

Compilation: zero diagnostics. Tests: 26 pass, zero fail/cancelled/skipped/todo,
including 10 new real-SQLite diagnostic tests. Tested no DB content change after
an offline read, no creation/migration, malformed/cyclic/dangling relations,
closed error reporting, budgets, historical state and issue truncation.
Raw TAP and exact source hashes are under `evidence/p6-ledger.*`.

Limits: this is focused verification, not the repository-pinned 5.9.3 full build.
Read-only SQLite can participate in SHM locking; it does not promise zero kernel
metadata activity. Offline DB+filesystem diagnosis requires a quiesced broker;
a live DB snapshot does not pin filesystem state. Concurrent hostile parent
replacement/openat2, systemd, provider, power-loss and OPEN SPIKE proofs remain
outside these tests. No original v1 format or public wire/CLI surface changes.
