# C5 — pure value, identity and error dependencies

Migrated six remaining facade imports in the Store/codec dependency closure:
request identity, mail values, error metadata, canonical JSON, context policy and
resolved spec identity. Declarations now name identity/errors/values/host owners
without pulling the module compatibility facade into the type graph. Original
aliases and all non-import tokens were checked against the pre-refactor sources.

Repeated actual SQLite characterization and all public-wire golden tests: 30
pass, 0 fail/cancelled/skipped/todo (Node 22.16.0, TS 5.8.3 transpilation).

A semantic typecheck of the restored Store closure now resolves without missing
source. It reports an existing crypto overload error in `sha256Hex`: a union of
string/Uint8Array is passed with a string encoding argument. This is NOT a PASS.
The installed typings are @types/node 24.0.4, not the repository pin. The next
small compatibility fix will preserve input bytes while selecting the proper
overload explicitly. It is not hidden inside this import-only refactor.

These targeted results do not establish whole-repository typecheck or P0 success.
Other subsystems still need their import migration and dependency graph review.
