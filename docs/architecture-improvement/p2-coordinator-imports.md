# P2 — authority/registry contract owners

Source baseline: e314fc6842cc46191e324c0c49b055a53cf6d70e.
Narrowed five remaining type-import seams: authority, lifecycle contracts/policy,
registry operations and receipt projection. All other tokens, authority timing,
SQL, wire/durable declarations and workflow branches are unchanged.

Added an AST migration utility whose owner index comes from the existing named
compatibility facade rather than a second list. It preserves aliases, supports
qualified import types and rejects runtime/namespace/wildcard/unknown imports.
The CLI modifies only explicitly selected regular source files after validating
all requested edits. A separate equality command checks before/after emitted JS.
These are development tools, not production runtime or a schema migration.

Executed on Node 22.16.0 / TypeScript 5.8.3 / @types/node 25.1.0:

- strict semantic compilation of RegistryOperations and actual mail-recovery
  source closures: zero errors, with noUncheckedIndexedAccess and
  exactOptionalPropertyTypes;
- four migration regression tests and the existing twelve real SQLite transition
  tests: 16 PASS, zero failure/cancellation/skip/todo;
- transpiled runtime byte equality for each of the five edited production files.

Commands:

```sh
node scripts/contract-imports.mjs --check src/authority.ts src/lifecycle/contracts.ts src/lifecycle/policy.ts src/lifecycle/registry-operations.ts src/protocol/receipts.ts
./node_modules/typescript/bin/tsc --module NodeNext --moduleResolution NodeNext --target ES2023 --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck --rootDir . --outDir dist src/lifecycle/registry-operations.ts src/mail/reconcile.ts
node --test --test-concurrency=1 test/contract-migration-seams.test.mjs test/operation-transition-characterization.test.mjs
node scripts/verify-import-runtime.mjs <source-baseline-root> src/authority.ts src/lifecycle/contracts.ts src/lifecycle/policy.ts src/lifecycle/registry-operations.ts src/protocol/receipts.ts
```

Raw TAP is gzip-compressed in evidence/p2-coordinator-imports.tap.gz. Compilation
is a focused source closure, not the locked 5.9.3 full-project P0 build. Other
import migrations, full dependency measurement and P6/P7 remain separate units.
