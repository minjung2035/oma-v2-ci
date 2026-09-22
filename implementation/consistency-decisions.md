# Consistency decisions — WP01

Decision baseline: `59422d48fa05f40e578884309a2190beac0129da` (runtime source
unchanged from `b25961cc46532f5e30ff60cc381fed51c59d13ab`). The supplied plan is
an immutable input, not an execution report. This record adopts technical scope,
not operational authority or release qualification. No runtime fix is delivered
by WP01. Runtime gaps remain assigned to the owning WPs below.

## Fact / Relation / Phase / Authority

Each domain keeps its own owner. A validated snapshot describes an observation,
not timeless authority. No generic manager, new durable state or retry engine is
introduced. SQLite is the only ledger; a receipt and a live run are distinct.

| Domain | Fact | Authoritative store | Derived view | Relation | Commit point | Current authority check | Decision owner | Requirement |
|---|---|---|---|---|---|---|---|---|
| delivery | exact ordered batch and trusted boundary | batches/deliveries plus private v1 receipt and Pi session | inbox and presented status | actor, batch, ordered IDs, incarnation, adapter, session, entry | file/parent flush before T-batch-complete; old receipt settlement before rollover | live peer/current lease OR broker singleton plus old-run/startup quiescence; distinct entrypoints | mail completion + receipt validator; broker/run owner fences | BATCH-006, BATCH-004, AUTH-003 |
| config | authored closure and validated effective config | one host-selected manifest or inline file; immutable managed generation | settings and apply-time labels | same manifest/version, known profiles/models, resource cross-constraints | inline durable replace OR generation flush then manifest replace/parent flush | current host tenure plus serialized expected-version-to-publication section | config loader/validator/editor, not TUI renderers | CFG-005, TUI-007 |
| preaccept | owned partial artifact and acceptance observation | operation plan and identity-bound filesystem artifacts | preparation diagnostics | exact created resource, operation winner and whether its plan names that resource | register responsibility before preparation; transfer only after acceptance observation | caller authority rechecked at acceptance; DB uncertainty cannot authorize deletion | scope owns cleanup; each coordinator owns acceptance decision | DB-009, FS-007 |
| quota | observed allocation and bounded active reservation | current owned tree and in-memory reservation leases; not a hard FS quota | timestamped usage/status | pending bytes, ownership transfer, read/admit/settle/safety action | admission before new acceptance/effect; release exactly once | all actions still authenticate; recovery uses explicit stage category | resource policy + accounting; broker composes | CFG-003, REC-002 |
| lifecycle | desired identity/spec and observed invocation/death | agents and systemd actual invocation/cgroup | status, unit file, Dashboard | actor/incarnation/invocation pin and parent authority | intent transaction then physical effect then actual observation then terminal transaction | recheck same invocation/spec/current authority after await and before effect | lifecycle coordinators + run registry + units | LIFE-003, LIFE-008, UNIT-007 |
| Git | accepted immutable candidate/base/policy and actual ref | operation plan plus Git objects/refs | result mail and operation receipt | exact candidate/base/target/policy; no-op differs from applied CAS | acceptance then final checks then CAS then observed ref then settlement | no-op/retry-to-CAS rechecks current policy/stop/authority; applied non-no-op settles historical fact | Git coordinator and publication observer | INT-001, INT-003, INT-004 |
| protocol | closed request and known acceptance state | operation ledger; CLI freeze cache is untrusted hint | CLI result/retry guidance | actor/key/hash/descriptor; current connection correlation | freeze before send; only DB commit proves acceptance | authenticate every retry; wire identity claims never grant authority | method registry/codec + channel; domain owns meaning | IPC-004, IPC-006, IPC-007 |

The domain table is documentation completeness evidence only. V01A checks that
its requirement references exist in the actual spec. V01B executes the existing
integration support guard and the real v1 DDL in an in-memory SQLite database;
existing wire golden tests retain closed public/internal vocabulary and recipes.
Neither test proves delivery persistence, process death or permission enforcement.
