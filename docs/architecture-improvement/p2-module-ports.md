# C2 — module-ports contract dependency

Removed the direct `src/module-ports.ts -> implementation/contracts.ts` edge.
The facade still exposes every existing compatibility port. Module ports now
import identity/runtime/durable/host owners directly; all aliases, signatures,
conformance constraints and non-import tokens are unchanged.

The original module-ports blob is `e2259e91ad49c62477997c1cbc387df808b8dc0e`.
The migration characterization checks bindings and non-import tokens separately
from owner selection. Negative cases reject a remaining facade edge, wrong
concept owner, accidental runtime import, alias drift and executable drift.

Executed locally with Node 22.16.0 / TypeScript 5.8.3:
`node --test test/contracts-ownership.test.mjs test/contract-import-migrations.test.mjs`
8 tests, 8 pass, 0 fail/cancelled/skipped/todo. This is not full semantic conformance
of the concrete implementations; their existing compile-time constraints remain.
Other production import migrations and full P0 verification are still pending.
No SQLite connection, effect ordering, public protocol or persisted format changed.
