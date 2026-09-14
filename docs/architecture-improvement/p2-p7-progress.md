# P2–P7 implementation log

Requested continuation: implement the attached proposal through P7, retaining
small implementation commits and documenting every deviation. Starting branch:
`refactor/safety-preserving-architecture`, source `cbe25a050772da336a95a01c9e81cdd5414468c1`.
The original proposal is unchanged in `docs/proposals/`.

## Verification environment

The repository/branch were re-read before editing. Local GitHub/npm DNS is not
available; locked dependency installation and a complete clone are unavailable.
GitHub content is read through the authorized connector and each locally restored
source is checked against its Git blob SHA before editing. Local tools are Node
22.16.0 and TypeScript 5.8.3, not the repository's 5.9.3 pin. GitHub's previously
recorded workflow still has no executed steps. Full P0 remains BLOCKED; no old
LOC or PASS result is promoted to current-source evidence.

## C1 — physical contract owners and compatibility surface

Implemented nine declaration-only owners and a 67-export compatibility facade.
All 68 original declarations have the same normalized token surface. The
architecture checker now resolves the facade's exported symbol to its actual
owner instead of assuming declarations physically live in the facade.

Executed: `node --test test/contracts-ownership.test.mjs` — 5 tests, 5 pass,
0 fail/skip/todo. Tests cover a golden source surface, field/optionality/private
helper mutation detection, exact facade exports, leaf DAG direction, and
exhaustiveness through re-exports. This is local focused evidence, not P0.

Decision D06: add `values.ts` and `module-contracts.ts` to the proposed split.
Shared value declarations avoid a new durable/public-wire type cycle; module
compatibility ports must not be owned by low-level wire definitions. No wire
field, error code, persisted plan field, gate, table or workflow changed.

Remaining in this continuation: module-ports/import migration; existing opaque
identity adoption; operation Journal and scoped Store facets; measured dependency
direction; independent read-only integrity; deterministic durable-FS faults.
P8/P9 and any persisted v1 migration are outside this request.
