# P4 — scoped logical Store facets

Base: `00899e20ec4d971c1c6222d0ad9b4816c8957d46`.

Added six immutable read facets on Store and six write-only facets on the
transaction capability: operations, agents, subscriptions, deliveries, batches,
usage. Flat compatibility methods remain. A single frozen table now owns the
write method vocabulary; the transaction method list is derived from it.

Facet calls reuse existing SQL/decoder/transition methods. No connection,
transaction runner, query language, side table, durable format or effect policy
was added. Operation facets reach the real Journal through the Store adapter.
Raw SQLite remains owned by src/store.ts.

Crucially, write facets wrap the already-scoped transaction closures rather than
binding raw Store methods. Extracted/escaped facet functions cannot borrow a
later transaction. New acceptance gates still apply, while explicit settlement
of previously accepted intent remains permitted.

Executed: strict semantic closure compilation and 21 actual tests, all passed
with zero fail/cancelled/skipped/todo. Seven new tests cover immutable/live reads,
all escaped write methods, cross-entity rollback, closed admission, escaped async
continuations and semantic TypeScript separation. The previous 14 tests remain
passing. Evidence and exact tool/source scope: evidence/p4-facets.json and .tap.
Local TS 5.8.3 is not the repository's 5.9.3 pin; full P0 remains blocked.

Deviation D07: canonical facet tables derive the compatibility write vocabulary
instead of adding a second manually synchronized method list. Physical SQLite
ownership is deliberately not relocated. Coordinator migrations and recovery
exhaustiveness are subsequent implementation units; P4 alone is not P7 closure.
