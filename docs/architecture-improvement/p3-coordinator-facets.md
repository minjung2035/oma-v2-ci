# P3/P4 — registry and mail-recovery facet consumers

Base: 4a85d48a2331ccda26681e891aba70f424263e93.
Migrated RegistryOperations and ordinary mail recovery to the existing Store
read facets and transaction-scoped operation/delivery/subscription write facets.
No SQL, authority order, immutable bytes, recovery policy, transaction extent,
await boundary or physical effect ordering was changed.

Four actual coordinator tests pass before and after the migration: route retry
and live authority timing, ACK ownership and rollback, admission closure, and
recovery refusing success without its archive observation. The materializer in
this characterization is controlled; it is not a P7 filesystem-fault proof.
Together with the existing twelve actual SQLite transition tests, the after-run
has 16 PASS, zero failure/cancellation/skip/todo. Strict semantic compilation of
both production closures has zero errors. Node 22.16.0, TS 5.8.3, @types/node
25.1.0; not the locked full-project P0 build.

Commands:

```sh
./node_modules/typescript/bin/tsc --module NodeNext --moduleResolution NodeNext --target ES2023 --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck --rootDir . --outDir dist src/lifecycle/registry-operations.ts src/mail/reconcile.ts
node --test --test-concurrency=1 test/coordinator-facets.test.mjs test/operation-transition-characterization.test.mjs
```

Source SHA-256:
- src/lifecycle/registry-operations.ts: d69a815feeaa7473bf5396154dc5e6bbc08a654a32e58c5d4841c366dfdd961c
- src/mail/reconcile.ts: 7aa35a9fda610755e26ace9656c103f665ddd4ac885ab2500d44ac957763812b
- test/coordinator-facets.test.mjs: 0b902b25d4c586fd7324260d03871810a6ca34a07e7053f179e990a70ea97ab5

Raw after-run: evidence/p3-coordinator-after.tap. Other coordinator migrations and
P5–P7 remain separate implementation units; no OPEN gate or release claim changes.
