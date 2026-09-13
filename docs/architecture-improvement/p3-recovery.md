# P3 O5 — explicit recovery exhaustiveness

Base: `0e3be9610a8cbe462ec3cb8c14f170d8adb34a29`.

Git recovery, Reconcile recovery and startup now enumerate the closed operation
set and prove the default is never. No recovery callback registry, generic
workflow engine or new effect ordering was introduced. All three existing Git
routes remain unchanged. Other existing kinds are explicitly ignored by Git,
as before. Reconcile's DB-only kinds keep their SPIKE_UNRESOLVED recovery failure
and startup's previous no-physical-replay behavior. Startup retains separate
mail failure handling, quiesce/health/requiesce and its activation argument.

D08: a future runtime kind that bypasses the closed decoder now fails explicitly
instead of silently returning from Git/startup. The valid v1 operation set,
receipts, schema and OPEN gates do not change. A new kind requires an explicit
decision in every recovery owner at compile time.

Executed six tests: all passed, zero failure/cancellation/skip/todo.
Tests extract the production method bodies and control only physical owners;
they test every current route, absent Git, startup ordering and unexpected kinds.
Semantic compiler fixtures retain production case/default clauses with actual
contract types. Removing a kind or adding an unhandled kind produces TS2345;
valid coverage has no diagnostics. This is not a full host recovery proof or a
full semantic compile of all Git/Reconcile dependencies. Local TS is 5.8.3.
See evidence/p3-recovery.json and evidence/p3-recovery.tap.

Next separate units: coordinator facet migration, remaining contract owner
migration and measured dependency direction, then independent integrity/fault
verification. P8/P9 stay outside this request.
