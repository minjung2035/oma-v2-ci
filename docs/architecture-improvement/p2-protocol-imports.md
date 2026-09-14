# C3 — protocol registry and frozen DTO/receipt contract imports

Migrated the public/internal method registry, frozen request decoder and receipt
shape decoder from the compatibility facade to their exact concept owners. The
three original files are identified in `evidence/p2-protocol-imports.json`.
`contractImportSnapshot` verified unchanged aliases, inline references and every
non-import token. No validator, method, error, payload, receipt or effect changed.

Added independent literal vectors for all 16 public methods, extra-field refusal,
closed public/internal method inventories, exact canonical request bytes and
receipt/lookup distinctions. The same 18 runtime tests pass before and after this
unit. Raw after-run TAP is `evidence/p2-wire.tap`. The tests execute the actual
schema functions, but do not attest to transport, host authority or systemd.

Local execution: Node 22.16.0 / TypeScript 5.8.3 transpilation. Full repository
5.9.3 typecheck/build is still not available. C1/C2 focused tests remain separate.
Further protocol/broker callers will migrate as their source closure is restored.

Unlike a permanent body-hash test for every production file, this migration
report is historical evidence. Later legitimate implementation edits must not
require updating an unrelated golden of executable bodies. Ongoing enforcement
belongs to contract ownership and dependency-direction checks.
