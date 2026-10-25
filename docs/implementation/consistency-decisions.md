# Consistency decisions — D01–D06, 계획 카드, 적대적 점검

이 문서는 **결정 기록**이다([문서 지도](../README.md)). 규범 문장은 spec이 가지고, 이 문서는 그 규범이 왜 그런지 적는다.
절 제목에 붙은 상태(ACCEPTED, "… pending", NEEDS_RUNTIME_EVIDENCE)는 그 절을 쓴 시점의 것이다. 지금의 검증 상태는
[validation.md](validation.md)가 소유한다. D01의 "prepared batch의 rollover"는 [DR9](../design-revisions.md)가 바꿨다.

| 절 | 내용 |
|---|---|
| Fact / Relation / Phase / Authority | 모든 결정의 판단 틀 |
| D01–D06, Decision case matrix — V01A | WP01에서 채택한 기술 결정과 사례별 oracle |
| WP01.03–WP01.05 | profile 의도와 실제 증거, 의미 변경 표면, 실행·호환 gate |
| WP25, WP23, WP26, WP27, WP29, WP28, WP31, WP30, WP32 | 카드별 결정(작성 순서) |
| Re-review and adversarial verification | WP32 뒤의 재검토 |
| Whole-codebase adversarial pass — AV1..AV31 | 적대적 점검(AV1–AV8)과 실제 provider 점검(AV9–AV31)의 발견, 의도된 동작으로 둔 것 |
| ENG1 | 엔진 0.85.1 → 0.87.1 |

---

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
| quota | observed allocation and bounded active reservation | current owned tree and in-memory reservation leases; not a hard FS quota | timestamped status | pending bytes, ownership transfer, read/admit/settle/safety action | admission before new acceptance/effect; release exactly once | all actions still authenticate; recovery uses explicit stage category | resource policy + accounting; broker composes | CFG-003, REC-002 |
| lifecycle | desired identity/spec and observed invocation/death | agents and systemd actual invocation/cgroup | status, unit file, Dashboard | actor/incarnation/invocation pin and parent authority | intent transaction then physical effect then actual observation then terminal transaction | recheck same invocation/spec/current authority after await and before effect | lifecycle coordinators + run registry + units | LIFE-003, LIFE-008, UNIT-007 |
| Git | accepted immutable candidate/base/policy and actual ref | operation plan plus Git objects/refs | result mail and operation receipt | exact candidate/base/target/policy; no-op differs from applied CAS | acceptance then final checks then CAS then observed ref then settlement | no-op/retry-to-CAS rechecks current policy/stop/authority; applied non-no-op settles historical fact | Git coordinator and publication observer | INT-001, INT-003, INT-004 |
| protocol | closed request and known acceptance state | operation ledger; CLI freeze cache is untrusted hint | CLI result/retry guidance | actor/key/hash/descriptor; current connection correlation | freeze before send; only DB commit proves acceptance | authenticate every retry; wire identity claims never grant authority | method registry/codec + channel; domain owns meaning | IPC-004, IPC-006, IPC-007 |

The domain table is documentation completeness evidence only. V01A checks that
its requirement references exist in the actual spec. V01B executes the existing
integration support guard and the real v1 DDL in an in-memory SQLite database;
existing wire golden tests retain closed public/internal vocabulary and recipes.
Neither test proves delivery persistence, process death or permission enforcement.

## D01–D06 — adopted technical decisions (ADR-RESULT)

Review basis: actual v1 DDL/contracts, spec requirements in the table, architecture
§§7.3/12.4/23, physical-ordering SEQ-001–004, current operations authoring contract
and WP00 source/caller findings. Runtime source is still the baseline. ACCEPTED
means authorization to implement this technical choice within the supplied plan,
not approval to mutate operating societies, lift a release gate or make a C3 change.

### D01 — ACCEPTED; WP05–08 runtime evidence pending

Select exact old-incarnation receipt settlement **before** rollover. Preserve v1
receipt bytes, ordered manifest, session/entry/adapter relation and 0600 mode.
Observe bounded filesystem evidence outside T; recheck exact batch/state inside
T-batch-complete. The internal recovery entry requires singleton writer lifetime
and old-run or startup quiescence. It is not a new RPC, does not issue a stale
lease, and does not weaken live complete. Only proven-absent receipts permit the
remaining prepared batches to roll over; absence does not prove no tool effect.
Unavailable/conflicting/legacy-mismatched evidence blocks re-execution and remains
intact for diagnosis. Completed incarnation is historical, never reassigned.
(DR9, Priority 0: a prepared batch's incarnation is historical too -- its first
delivery attempt. Rollover no longer rewrites it; a run inherits every prepared
batch, and a receipt of any attempt from that first one to the ending run
settles it. See design-revisions.md DR9 for how this differs from the rejected
`receipt.incarnation <= current` below.)
Principal examines settlement before starting a new turn; live endpoint registration
still applies, and offline recovery is broker-owned, never anonymous completion.

Reject receipt rewriting, accepting `receipt.incarnation <= current`, new batch
states/tables/receipt versions and fresh delivery as a completion retry: each would
erase evidence or relax authority. First valid receipt wins, including sessionPath;
use private same-filesystem temp, file fsync, no-replace publish and parent fsync.
After final publication, uncertain flush preserves that name. WP05 proves ordering,
WP06 validates observations/authority, WP07 rollover, WP08 Principal reuse. WP27/30
must independently qualify engine persistence and process/power-loss boundaries.
Rollout: validator/publication before consumers and rollover; no migration of old
mismatches. Code revert must not undo completed rows, receipts or external effects.

### D02 — ACCEPTED C2; WP11–14 implementation/compatibility gates pending

Keep inline-v1 and manual operations-v1 readers. Manual concurrent multi-file
editing is NOT an atomic snapshot guarantee. Managed editing creates immutable
`.oma-config/generations/<generation>/{host.json,models.json,roles/,prompts/}` below
the selected index root and replaces the ordinary manifest file last. Manifest
keys stay kind/host/models/roles; promptFile remains index-root-relative. No
symlink commit pointer, new HostConfig field, live reload or sidecar database.

One owner serializes expected-version read/compare through final publication;
current host tenure alone is not serialization. The supported writer is the
tenure-owning host. Cross-process independent managed writers and simultaneous
manual edits are not supported. Shared input roles expand to per-profile copies
without changing effective meaning. Validate the entire candidate; preserve
permitted prompt/extension metadata, never coerce unrelated quotas. (D23: tool
surface is OMA-internal policy now, not authored role metadata.)

Generation identity uses a new internal SHA-256 recipe over logical relative
names and exact logical contents **before** embedding generation paths; include
prompt bytes, exclude external extension code and self-referential output paths.
WP13 must pin byte framing/normalization with golden vectors before publication.
This is not a change to request/spec/check-profile hash recipes. CFG-005 policy
revision changes for semantic host/model/role/prompt/extension-selection changes,
not whitespace or same-semantic save. Compare excluding policyRevision itself;
external code/deployment identity stays separately checked before engine spawn.

Reject multi-file in-place edits and rename-then-rollback on fsync error. File and
new directory-chain flush precede manifest temp flush, replace and parent flush.
Post-publication uncertainty blocks another edit until observation/recovery; UI
reload failure cannot roll back committed config. Old reader generations remain.
WP13 must fix finite generation-count/byte budgets and prove rejection at exhaustion
before managed editing is enabled; GC requires quiescence, not age. Old writers
must not edit promoted generations. Compatibility needs old-reader fixtures and
explicit flat export to a new destination; never automatic flattening/overwrite.
Backup includes manifest, generation closure and prompts. Rollback is a new validated
pointer commit, not deletion of history or rewriting accepted specs.

WP13 result (2026-09-24): budgets fixed at 16 committed generations or 256 MiB of
generation bytes; one generation is bounded by the loader closure (256 files, 8 MiB),
so a valid bundle's first managed edit always fits. Exhaustion refuses the edit with
LIMIT_EXCEEDED before any write. Collection runs only at the owner's quiescent start
(tenure held, no broker) and keeps the current and the previously committed generation.
Generation identity recipe `oma-config-generation-v1` is pinned by golden vectors.
Published generations are read-only (0500/0400), so an in-place writer is refused.

### D03 — NEEDS_RUNTIME_EVIDENCE; WP03 is mandatory

Accept one startup-owned launch location (society, state/run roots, config path,
deployment mode) consumed by broker, unit renderer and runner; no credential or
new public field. Encode systemd argv rather than interpolate shell text. Custom
XDG roots, spaces, non-ASCII and host-selected top-level symlink are covered.

Do not yet declare foreground and managed modes equivalent. Systemd-managed mode
retains After/BindsTo and actual cgroup authority. Product mode retains private
host/broker channel and inherited tenure; it must not silently launch a broker
service it does not own. WP03 must run `oma -> broker -> Resident` under a disposable
user with no prior broker.service and prove readiness, fencing, teardown and restart.
If this disproves the existing topology, render only truthful mode-specific
dependencies after equivalent teardown is demonstrated; otherwise activation fails
closed with existing unsupported/gate errors. Removing BindsTo globally or adding
a new service/authority protocol is rejected. Such expansion needs a revised ADR
and, for C3, explicit separate approval. No unit migration is executed by WP01.

### D04 — ACCEPTED; WP21–23 policy/accounting gates pending

Classify actions, not merely method names, as read/admit/settle/safety-control.
Logical admission excess must not categorically block bounded receipt lookup,
settlement or stop/revoke. Authentication/integrity/current authority still apply.
Same-key accepted lookup precedes new consumption. Reconcile is mixed: preparing
physical resources, import, CAS or activation is not free read-only settlement.
Startup must be able to enter bounded recovery without accepting new consumption;
the old blanket pre-DB quota guard is a named WP22 gap, not an approved bypass.

Reject hard-quota/exact-accounting claims for cached tree scans and reserve-based
ENOSPC guarantees. WP22 owns one explicit reserve derivation/configuration source,
finite concurrent settlements, lease transfer and exhaustion behavior before
enabling exemptions; no new usage/cost accounting entity or HostConfig field.
WP23 may use bounded asynchronous diagnostic scans, but never stale view bytes as
final admission proof. Physical failure preserves accepted evidence and uncertainty.
Safety cleanup attempts independent remaining revoke/stop actions after one fails.

### D05 — ACCEPTED C2; WP15/16 compatibility gates pending

Choose Bootstrap worker profile, not a hidden default-worker/delegation setting.
With no seeds, there is no target: disable/refuse the edit and say why. Model
content applies at next role engine start; Principal selection at next Principal
session, worker limit at broker restart, seeds only before first bootstrap.
Already accepted modelProfile/resource/capability references remain frozen.

Default society is 15 ASCII slug characters (fallback `project`) + `-` + first
16 lowercase SHA-256 hex of the canonical absolute Linux project path. Observe
realpath once in the entry adapter; the derivation stays pure. Truncation is not
collision-proof: require a full-path binding comparison before any mutation.
The planned C2 file is `S/project-binding.json`, closed fields `kind` equal to
`oma-project-binding-v1`, `society`, `canonicalProjectPath`; host directory 0700,
file 0600, private-temp/file-fsync/no-replace/parent-fsync before provisioning.
It is host identity metadata, not a DB/wire/receipt revision or new workflow entity.
It belongs in quiescent backup/restore; older binaries cannot enforce it and must
not be used as writers after promotion. Existing slug-only state is neither renamed
nor rebound implicitly. Missing legacy binding requires explicit operator-reviewed
binding/migration before mutation; mismatch fails closed even with --society.
Read-only diagnosis preserves the old tree. State-root moves are not simple rename
because leases and accepted paths refer to it. WP16 must supply collision, aliases,
legacy and initialization-failure fixtures before enabling this new default.

WP16 result (2026-09-24): enabled. `defaultSocietyFor` implements the recipe; the
entry observes realpath once. The binding is published before configuration or
provisioning; mismatch and unreadable bindings are refused even with --society; an
existing unbound society is bound only with `--bind-project`; a pre-D05 default-name
society of the project is pointed out, never replaced by a new one. Provisioning now
separates absent from unreadable project/canonical repositories and flushes a new
bare repository before and after its rename.

### D06 — ACCEPTED; runtime success remains unproven

Receipt absence, unreadability, timeout and failed acceptance acknowledgement are
different. Unconfirmed prompt acceptance keeps/fences ownership; do not release
and send a queued Human prompt into a possibly active delivery run. Only correlated
settlement, explicit preaccept refusal or confirmed termination ends that claim.
Return unsent Human input with identity/text on session end; never replay uncertain
input automatically. Separate accept/idle/turn/drain deadlines; closing/signalling
one process is not descendant death or lease release. WP09/10 own actual races.

No-op integration (`base==candidate`) has no CAS effect to prove authorization.
Recovery repeats current policy, eligibility, stop and authority checks, using the
existing error classification. Applied non-no-op CAS is historical settlement and
must not be re-executed or denied merely because authority changed afterwards.
Executable nonempty checks remain gated; this is not evidence of bypassing a
supported check profile. DR31 supersedes the original rootfs='/' opt-out: Society is confined-only. Preserve no OMA cost
cap, open S-01-CANDIDATE/tiered gates and immutable accepted facts. Every blocked
state needs bounded reobservation or explicit diagnosis/repair; not every state
eventually succeeds. WP24 owns no-op evidence. WP27/30/31 own actual engine, kernel,
power-loss and deployment proof. Neither local PASS nor SIGKILL proves power loss.

## Decision case matrix — V01A

All cases below are implementation obligations, with runtime tests **NOT_RUN** in
WP01. C0/C1/C2 are the supplied compatibility categories; none permits C3. The
case key is stable so a removed unknown/legacy row fails the completeness review.

| Case | Existing rule / conflict | Chosen rule | Owning WP | Oracle | Class | Requirement |
|---|---|---|---|---|---|---|
| D01.exact | reassign-first conflicts with strict receipt | settle exact old receipt before rollover | WP06, WP07 | V06B, V07A | C1 | BATCH-004, BATCH-006 |
| D01.absent | boundary insufficient permits duplicate notice | only proven final-name absence permits re-presentation; not tool replay | WP06, WP07 | V06A, V07B | C1 | BATCH-005 |
| D01.unavailable | read errors can hide behind no evidence | no new delivery or deletion; bounded reobservation | WP06 | V06A | C1 | BATCH-006, ERR-002 |
| D01.conflicting | exact identity required | preserve evidence, no completion/re-execution; diagnose repair | WP06 | V06A | C1 | BATCH-006 |
| D01.completed | terminal batch immutable | exact replay only, retain historical incarnation | WP06 | V06B | C0 | DB-008 |
| D01.legacy-mismatch | old rollover can strand earlier receipt | no incarnation coercion; offline provenance review or blocked | WP07 | V07B | C1 | BATCH-006 |
| D02.inline | whole loader validation differs from writer | validate full candidate before durable replace | WP11 | V11A | C1 | CFG-005 |
| D02.manual | explicitly non-atomic manual bundle | one manifest read; concurrent manual edits unsupported | WP12 | V12A, V12B | C1 | CFG-005 |
| D02.managed | role/host writes independently visible | immutable generation and manifest-last commit; bounded retention | WP13 | V13A, V13C | C2 | CFG-005, FS-002 |
| D02.conflict | tenure is not edit serialization | serialize expected version through commit, bounded busy/conflict | WP13 | V13B | C2 | CFG-005 |
| D02.outcome-unconfirmed | pointer may have changed before flush failed | observe/recover before next edit, no automatic rollback | WP13 | V13A | C2 | REC-004 |
| D03.location | runner defaults ignore broker custom locator | one launch location, systemd argv validation and exact XDG | WP03 | V03A | C1 | FS-001, UNIT-002 |
| D03.foreground | fixed BindsTo may name absent service | actual clean-manager gate before claiming Resident support | WP03 | V03B | C2 | UNIT-004 |
| D03.systemd | managed lifetime tied to service/cgroup | retain real dependency, no global BindsTo removal | WP03 | V03B | C0 | UNIT-004, AUTH-003 |
| D04.read | blanket guard rejects diagnostics | bounded authenticated reads despite logical over-limit | WP21 | V21B | C1 | IPC-004 |
| D04.admit | new consumption needs capacity | gate new consumption, not accepted same-key receipt lookup | WP21, WP22 | V21B, V22A | C1 | IPC-006 |
| D04.settle | outer quota blocks existing responsibility | bounded explicit settlement reserve; ENOSPC remains failure/unknown | WP22 | V22B | C1 | ERR-002 |
| D04.safety | one stop failure can suppress later actions | independent bounded revoke/stop attempts, no false death | WP21, WP25 | V21B, V25B | C1 | LIFE-003 |
| D04.recovery | sweep mixes settlement with new effects | stage-specific resource gate; no blanket quota-free reconcile | WP21, WP22 | V21B, V22B | C1 | REC-001 |
| D05.bootstrap | seed-only edit labelled next activation | explicit bootstrap-only; zero seeds has no editable target | WP15 | V15A | C2 | LIFE-009, TUI-008 |
| D05.apply-time | architecture Principal timing conflicts with TUI-005 | next Principal session; frozen worker references retained | WP15 | V15B | C1 | TUI-005, TUI-009 |
| D05.binding | basename loses canonical project identity | slug+digest plus full binding; reject legacy mismatch before mutation | WP16 | V16A, V16B | C2 | TUI-019, TUI-022 |
| D06.acceptance-unknown | timeout releases possibly active claim | hold/fence until correlated terminal/nonacceptance/death evidence | WP09, WP10 | V09A, V10A | C1 | PR-002, IPC-007 |
| D06.no-op | main==candidate alone appears applied | no-op repeats current eligibility/policy/stop/authority | WP24 | V24B | C1 | INT-001, INT-004 |
| D06.applied | non-no-op observed applied CAS | historical settlement, no new CAS and no retroactive permission test | WP24 | V24A | C0 | INT-004 |
| D06.unsupported | unqualified checks/codec/resources remain gated | reject unsupported, confined-only Society per DR31; no cost cap | WP27, WP31 | V27A, V31B | C0 | INT-007, SB-002-E, INF-001 |
| D06.power-loss | process crash is not storage power loss | explicit VM/storage gate, retain NOT_RUN without proof | WP05, WP30 | V05C, V30B | C0 | REC-004 |
| preaccept.acceptance-unknown | DB observation may fail during cleanup | retain exact owned artifacts on uncertain acceptance; attempt all cleanups | WP17 | V17A | C1 | FS-007, DB-009 |

## WP01.03 — profile intent versus actual evidence

This is the immutable **WP01 decision-time snapshot**, not the live release status
table. Later evidence belongs to its executing WP and final validation record; do
not relabel this unexecuted review as an executed kernel/provider test. A profile
can be an intended support contract while its release gate remains open.

| Profile | Intended contract | Required actual oracle / limitation | WP01 execution | Evidence owner |
|---|---|---|---|---|
| profile.systemd-managed | fixed services/path/timer, Type=notify readiness, After/BindsTo | disposable user-manager first boot, exact config/XDG, cgroup death and restart | NOT_RUN | WP03, WP25, WP30 |
| profile.foreground | host-owned broker and one registered Principal; private channel/tenure | no preinstalled broker.service; equivalent revoke/quiescence/fencing or activation rejected | NOT_RUN | WP03, WP10, WP25 |
| profile.confined | bwrap private network and declared mount/FD closure; engine-owned credentials outside | actual pinned bwrap/cgroup/engine checks, not argv or module import tests | NOT_RUN | WP27, WP30, WP31 |
| profile.engine-fixture | provider-free controlled engine/extension execution | actual bundled engine boundary/tool-event semantics; not provider or disk power-loss evidence | NOT_RUN | WP27, WP30 |
| profile.provider | host-chosen real provider through engine-owned authentication | separately authorized credential/cost/environment; no invented credential or cost cap | NOT_RUN | WP27, WP30, WP31 |

WP00's local tools/tests and early kernel/crash BLOCKED/NOT_RUN probes establish
none of these runtime rows. Provider fixtures do not demonstrate actual provider
behavior. Process SIGKILL can test crash reentry but power-loss claims additionally
require a VM/storage experiment against the final source. S-01-CANDIDATE, S-03
steer/concurrency and tiered S-08/S-10 remain intentionally unqualified where the
current product gates them. This plan does not implement those unrelated features.

## WP01.04 — semantic change surfaces, not a universal registry

DR46 updates the owner paths and current format constraints in this table; it does not claim WP01 originally approved schema 4.

The paths below identify existing owners to review when implementing the named
WPs; listing a path does not certify its implementation. Public vocabulary,
persistent encodings and effect authority stay independent. C2 config metadata
is host authoring data, not a new operation/message/batch state.

| Surface | Existing owner paths | Allowed semantic input/output change | Must remain unchanged | Owning WP |
|---|---|---|---|---|
| surface.public | packages/protocol/src/methods.ts, packages/contracts/src/public-wire.ts, packages/contracts/src/internal-wire.ts | add internal action-category metadata to existing method decisions; no new RPC | key rules, method names, strict payload/error/correlation and live authentication | WP21, WP26 |
| surface.durable | packages/protocol/src/operation-codec.ts, packages/storage/src/transitions.ts, packages/contracts/src/durable.ts, packages/storage/src/schema-v4.sql | validated exact evidence selects existing transitions before rollover; ownership scope settles current plans | six entities, DR46 current schema 4 only; state enums and exact accepted request/spec/receipt bytes | WP04, WP06, WP07, WP17, WP20, WP24 |
| surface.editor | packages/config/src/index.ts, packages/config/src/operations.ts, apps/oma/src/application/settings.ts, apps/oma/src/application/extensions.ts | pure full validator plus snapshot/source/version and closed edit descriptors; generation writer owns publication | DR46 HostConfig schema 3 fields, role metadata semantics, index-root prompt references, no implicit delegation change | WP11, WP12, WP13, WP14, WP15, WP16 |
| surface.resources | scripts/check-legacy.mjs, packages/domain/src/admission.ts | DR46 retires this resource-policy surface and bans reintroduction; the actual integrity/drain gate keeps its owner | retired field vocabulary has no runtime owner; unknown handling and actual resource lifetime ownership remain | WP21, WP22, WP23 |
| surface.authority | packages/broker/src/index.ts, apps/oma/src/runtime/principal-delivery.ts, packages/engine/src/principal-session.ts | separate live complete from narrow trusted recovery; single correlated run owner across await | current peer/incarnation checks, single writer, inherited fence and real descendant death | WP03, WP07, WP08, WP09, WP10, WP25 |
| surface.evidence | implementation/source-owners.json, implementation/mutation-owners.json, production-files.txt, scripts/verification-lanes.mjs | update actual owner/caller/test trace when runtime responsibility moves; include new production sources | generated evidence must be recomputed, not hand merged; no static/runtime proof inflation | WP29, WP30, WP31, WP32 |

No wire/DDL/durable codec/type declaration changes are needed by WP01. Existing
`contracts-ownership.test.mjs`, `p2-wire-golden.test.mjs` and request-hash fixtures
are reused rather than regenerating their goldens. New internal observation/claim
types in later WPs require runtime validators and effect-time checks; readonly or
branding alone never supplies authority, linear ownership or filesystem durability.

## WP01.05 — execution and compatibility gates

Use the supplied dependency graph, one active WP at a time. This is the selected
topological order, not numeric sorting:

```text
WP00 → WP01 → WP02 → WP03 → WP04 → WP11 → WP17 → WP05 → WP12 → WP18 → WP06 → WP13 → WP19 → WP07 → WP14 → WP16 → WP20 → WP08 → WP15 → WP21 → WP09 → WP22 → WP24 → WP10 → WP25 → WP23 → WP26 → WP27 → WP29 → WP28 → WP31 → WP30 → WP32
```

After WP01, **WP02 only** is next eligible among the unfinished WPs. It needs
production-valid fixtures and independent boundary oracles, not runtime changes
borrowed ahead from WP03/04. Each implementation must first fail a production-linked
regression; callers that could recreate the defect must be inspected and migrated.

C0 preserves observable behavior; C1 fixes evidenced invalid behavior with error/
compatibility fixtures. D02 managed generation and D05 binding/bootstrap meanings
are C2: adopted direction is not completed migration. Reader-first fixtures, writer
restrictions, backup/reference retention, and uncertain-publication recovery must
pass in WP13/15/16 before enabling the change. D03 is conditional on actual WP03
environment evidence, not a dependency cycle. A result that disproves the selected
design requires an ADR revision and affected-WP review, not implied permission.

C3 stays forbidden: no schema/wire/receipt version, authority enlargement, new
service or durable entity is approved here. If v1 cannot satisfy an invariant,
record the counterexample and isolate an explicitly approved migration/dependency
change; keep the affected work blocked, and continue independent eligible work.
Runtime gaps are the case matrix's named owner/oracle pairs. In particular WP03
topology, WP13 retention/recipe/old-reader compatibility, WP22 reserve/exhaustion,
WP27 engine persistence and WP30 actual crash/power-loss remain **NOT_RUN**.

For a C0/C1 code revert, v1 bytes remain readable but the fixed defect may return.
A code revert cannot roll back accepted ledger facts, receipts or Git effects.
After a generation commit, rollback is a new validated pointer update. After
binding promotion, use only binding-aware writers. Parent-fsync uncertainty is
never proof that publication did not occur. Final WP32 requires source-bound
handoffs, all primary-file reviews, actual environment gates and the authorized
CI/packaging evidence; local static/fixture success does not discharge them.

## WP25 — identity, authority and lifetime of a run

WP25.01 table. Each row is one fact the code observes; the right-hand columns say
what it is **not** evidence of. No row is a substitute for another, and an actor
string alone is never authority.

| Identity / fact | Proves | Does not prove | Established / checked at |
|---|---|---|---|
| actor name | which registry row a request is about | who is asking, or that any run exists | `AuthContext` is built only from a bound peer (`PeerAuthenticator.context`); `assertActorIdentity` rechecks role and incarnation against the row |
| incarnation | the ledger epoch of the agent's current run | that the run is alive or that an earlier epoch is dead | advanced only by `Broker.openRun`, under `desired=enabled`, after `RunRegistry.begin` proved the previous invocation's cgroup empty/removed and previous receipts settled (D01) |
| accepted `previousIncarnation` | the epoch an accepted start/stop intent was about | permission to act on a later epoch | frozen in the plan at acceptance; `LifecycleActions.currentIntent` requires desired **and** incarnation equal before every effect (normal, same-key retry, reconcile); otherwise the operation is `unknown`, never rewritten |
| systemd InvocationID | one activation of the service unit | death of an earlier activation's descendants | `openRun` requires the runner's claimed ID to be the observed one; every capability read re-observes it |
| cgroup pin (`OwnedRun`) | the kernel cgroup the run was admitted in, held by FD from opening through revoked-awaiting-death | that a signal, exit or socket close ended the run | `population()` reads `cgroup.events` through the pinned FD; `removed` only after events were once seen (Linux 6.12 keeps nlink); read failure is `unknown`, never empty |
| peer liveness (pidfd, `SharedPeerPin`) | the connected process is alive now | the run's death when it is not; another process of the run may live | rechecked at each capability read together with cgroup membership of the peer |
| society lease (abstract socket + inherited open file description) | one host owns the society until every inheritor closed it | anything about a single run | taken by the host before any write; released by the kernel with the last descendant |
| `desired` | management intent | physical state | `stopped` makes `openRun` refuse; stop acceptance commits it before the physical attempt |
| `confirmDead(agent, incarnation)` | unit inactive/failed, its cgroup empty or removed, stable across two observations, epoch not advanced | anything when an observation is unavailable | `units.ts`; false on every unknown |

Authority, kept distinct (D06): `operation.get` returns the caller's **own**
receipt to the current actor and needs no management capability. `agent.start` /
`agent.stop` require current `agent.manage.*` over the target (`requireManage`)
before anything else, including the replay of a terminal receipt by the same key.
Broker recovery (`reconcileAction`) has no caller; it acts only when
`currentIntent` still holds.

WP25.02 — logical stop acceptance (`desired=stopped`, operation pending) is
separate from physical proof. `UnitsModule.stop` attempts path stop, path disable,
endpoint revoke, service stop and path verification independently; any failure or
an unproven death is `RUN_TERMINATION_UNKNOWN`, and the operation stays `unknown`.
A start refused by the unit's start limit is `START_LIMIT` (systemd 257 reports
it only through `NRestarts >= StartLimitBurst`); the limit is reset only by an
explicit manager start, never by reconcile. V25A: an old start/stop intent, by
reconcile or by same-key retry, leaves the current incarnation's run untouched
and settles `unknown`; a current stop succeeds and proves death.

WP25.03 historical resource transport (superseded by DR37/DR46; this is not the current unit contract) — the Resident unit is rendered once, at creation, from the accepted spec:
MemoryMax/TasksMax/CPUQuota and `OMA_RESOURCES_HEX` (the canonical resource text).
The runner takes workspace, `/tmp` and check limits from that text and refuses to
start without it; only the model comes from the current profile at activation
(D05). Units rendered before WP03 already lack the launch location and are refused
by the runner; there is no automatic re-rendering of existing Resident units, so a
society created before this change set needs its Residents recreated (open item for
the WP31 support table). The Principal is not a unit: its session still reads its
workspace limit from the current principal profile (`src/runtime/engine/principal-session.ts`); whether
the Principal's accepted spec should bind it is left to WP28's review.

WP25.04 — `revoke` closes authorization and keeps the pin (`revoked-awaiting-death`);
the pin is released by the next `begin` after it proves the cgroup empty/removed, or
with the broker. V25B is carried by existing oracles: SEQ-002 (every stop step is
attempted after a path or revoke failure, and the result is unknown, not success),
T38 (an unconfirmed stale cgroup blocks start, incarnation unchanged), SEQ-002 in
phase4 (unknown old-run death stops startup before mail reconciliation), R37
shutdown (an unknown native outcome keeps Store and lock). Descendant-death proof
of the engine inside a real Resident remains WP30.

## WP23 — status observation off the event loop, bounded read model

WP23.01 measurement (disposable account, systemd 257, 64 listed agents, 16
concurrent `status.get` plus 4 `mail.send`; harness `test/status-responsiveness.test.ts`).
`systemctl --user show` p50: 1 unit 8.5 ms, 8 units 20.8 ms, 32 units 59.8 ms,
64 units 114.6 ms, 128 units 212.9 ms, i.e. about 6.9 ms + 1.61 ms per unit.

| Measure (real user manager) | Before (`1f6c31e`) | After |
|---|---|---|
| longest event-loop stall, status reads | 10 098 ms | 16 ms |
| longest stall, reads with mutations | 10 143 ms | 38 ms |
| `status.get` p50 / p95 | 5 558 / 10 097 ms | 267 / 286 ms |
| slowest `mail.send` in the burst | 639 ms | 48 ms |
| one `status.get` with 620 pending messages | 3 886 ms stall | 10 ms stall |

Causes: every `status.get`, every mutation's view refresh and the 5 s timer ran one
synchronous `systemctl show` per agent; the pending counts re-decoded each pending
delivery's operation, whose decoding re-validates every delivery of that operation
(quadratic in recipients); request parameter checks decoded every agent row with its
spec digest to learn which names exist.

Budgets (stated for up to 256 listed agents; the default quota is 8): status reads
stall the loop < 50 ms; with mutations < 100 ms, which includes each mutation's own
synchronous Store/fsync work (20-45 ms for `mail.send`, unchanged by WP23); a status
answer within 2 s (`STATUS_OBSERVATION_BUDGET_MS`), else unknown; at most one
observation command in flight; one running refresh plus one shared follow-up;
32 units per `show` (`STATUS_CHUNK`, about 60 ms).

WP23.02 — `StatusRefresh` (`src/views/status-refresh.ts`) is the one owner of display
observation: `status.get`, the published status view and its timer share it. A caller
during a refresh gets the single follow-up that starts after it, so an answer never
predates its question; past the budget a caller gets an unknown snapshot dated when it
asked, and a hung command is not started again beside itself. `UnitsModule.observeStatus`
asks one read-only `show` per chunk and binds each block to its unit by `Id`; a
missing, repeated, foreign or malformed block leaves only that agent unknown.

WP23.03 — display reads are narrowed, full-row reads are kept where effects depend
on them. `pendingWorkRows` + `pendingWorkByAgent` count every agent's pending work
from one read: every counted row is decoded, and the relations the counts rest on
are checked over the whole read (owner exists, no future-incarnation batch, manifest
equals the exact linked delivery set of the same owner, nothing counted twice); it
refuses exactly what per-agent `pendingWork` refuses and counts exactly the same
(seeded equivalence test). It does not re-check each delivery against its
operation's recipient snapshot; recovery (`reconcile`) keeps `pendingWork`'s full-row
reads. `agentNames` gives parameter checks and the refresh the existing names,
each checked as an identity; anything that acts on an agent reads its full row.
One projection is computed per observation and shared by the answers waiting on it
and the published view; nothing is cached across observations.

WP23.04 — authority never reads a snapshot. Peer authentication (every capability
read), `openRun`, `confirmDead`, lifecycle start/stop and reconcile's final checks
observe the unit synchronously at the moment they act, as before. V23B (kernel): a
snapshot taken while the unit was stopped keeps saying so, with its time, after the
unit really starts; `confirmDead` is false and a manager's start is refused with
`RUN_TERMINATION_UNKNOWN`; the control that takes the cached "inactive" as death
proof would have authorized acting on the live run.

WP23.05 — an unobserved unit is `null` in every unit field (never "inactive"), the
registry rows and pending counts are still answered, and `observedAtMs` is the
observation's start (or the time asked, on timeout). The status view is written after
the answer, detached; a write failure is logged and changes no request's outcome.
The terminal's reader already reports a missing, unreadable, malformed, foreign or
stale view as unknown with its reason (T118), unchanged.

Scope: the `status.get` owner is `src/broker/public-dispatcher.ts` and its ports
`src/broker/composition.ts`, and the Store facade is `packages/storage/packages/storage/src/store.ts`; they were changed
beyond the card's candidate list because the status path runs through them. Not
changed or measured here: the storage admission tree scan (a fresh, correctness-critical
final check per admitted mutation, D04/WP22), `refreshWorld` on each mutation (4-6 ms
at 64 agents), and `src/diagnostics/*` (SCOPE_ONLY). Negative controls: 11 mutants,
10 fail; M6 (the display projection's "counted twice" guard) is equivalent -- the
primary key, the single batch column and manifest decoding already make a second
count impossible -- and is kept for parity with `pendingWork`.

## WP26 — protocol, CLI and request-cache boundary

WP26.01 inventory. Trust boundary: what the file accepts from outside its
process or owner. Budget: the bound it enforces (encoded bytes unless said).

| File | Trust boundary | Budget / relation | Success means |
|---|---|---|---|
| `packages/protocol/src/frame.ts` | bytes from any peer | uint32 length ≤ configured frame bytes; strict UTF-8 JSON, duplicate keys, surrogates, unsafe integers refused; a fatal error never resynchronizes | one JSON object root, fields still unknown |
| `packages/protocol/src/byte-queue.ts` | caller-owned chunks | frame-sized copies only | bytes delivered in order |
| `packages/protocol/src/jsonl.ts` | engine stdout | bounded line, LF only, no implicit final line; a well-formed line over the bound is skipped whole and reported (DR15) | one line handed to its owner |
| `packages/client/src/channel.ts` (`BrokerChannel`) | broker socket | one request in flight; request and response ≤ frame bytes after encoding; idle and receipt deadlines; stream bytes equal the descriptor | a decoded reply for this request id |
| `packages/protocol/src/response-codec.ts` | broker reply | id, version and method discriminator must match; closed result per method | a transport fact, not replay authority |
| `packages/protocol/src/receipt-codec.ts` | receipt bytes (broker or cache) | closed shape; REQUEST_NOT_FOUND only with an empty operation; `receiptSupersession` orders observations of one operation | structural receipt, not ledger authority |
| `packages/protocol/src/request-codec.ts` | frozen cache/ledger payload | closed caller DTO per mutation method | structurally valid payload; broker still checks authority |
| `packages/protocol/src/methods.ts` | method name and params | closed public/internal method sets; params decoded per method with current actor names; internal resource category | a known method with decoded params |
| `packages/protocol/src/log-response.ts` | journal text | whole v1 response ≤ frame bytes including envelope, id and escaping; truncation flagged | a decodable bounded response |
| `packages/protocol/src/batch-view.ts` | prepared batch view | UTF-8 bytes, never UTF-16 length | six-field projection |
| `packages/protocol/src/host-channel.ts` | inherited descriptor | one bounded line per message | one closed host message |
| `packages/protocol/src/principal-credential.ts` | credential line | fixed-format credential and session handle | a well-formed credential, not authority |
| `packages/protocol/src/run-lease.ts` | `runner.open` result | paths checked against composition facts | transport identity, not live authority |
| `packages/protocol/src/status-view.ts` | host-private view file | schema, society, observation time, closed rows | a view; staleness is the reader's decision |
| `src/broker/connection.ts` | one actor/host connection | one in-flight request; response ≤ frame bytes; EOF/close/error/timeout distinct; accepted work is not socket-owned | a reply written or a failure closed |
| `src/broker/replies.ts` | none | envelope only | `ok`/`error` envelope |
| `src/cli/transport.ts` | environment (socket, frame bytes, credential descriptor) | 60 s CLI deadline; frame bytes decimal and within log-response bounds | replies of one call |
| `src/cli/arguments.ts` | argv | single-valued options, request key syntax | parsed options or usage exit |
| `src/cli/request-intent.ts` | explicit argv vs frozen request | compares only arguments with defined semantics | no conflict with the frozen intent |
| `src/cli/cache-codec.ts`, `src/request-cache.ts` | files in `~/.local/state/oma/requests` | absent / present / corrupt / unavailable kept apart; no-replace publication; body bytes and digest; one receipt lock per key | a frozen request, or a receipt ordered after the last one |
| `src/cli/request-service.ts` | all of the above | resend only after decoded REQUEST_NOT_FOUND, with frozen params and body | a broker receipt shown with its key |
| `src/cli/effects*.ts`, `src/cli/commands/*.ts` | local files, Git, argv | no-follow reads of regular files only, a named file (`--file`, `--reply`) bounded by the CLI's request frame (`readLocalFile`, AV8), digest of streamed bundles, random private temp dirs | a fresh request built once, before freezing |

WP26.02 — transport owns frames, connection and one-shot task lifetime; authority is
read again at dispatch (`validatePublicRequest` runs for stream preflight and again
for dispatch, never stored across an await). Resource categories live in the
internal method descriptor, not on the wire.

WP26.03/04 — the CLI resends a frozen request only after an explicit, decoded
REQUEST_NOT_FOUND, with the frozen params and body; every other lookup outcome ends
without a resend (R08 scenarios). Found defect, fixed: when the broker had answered
with a receipt and the request cache could not record it (unwritable cache, lock
that cannot be opened, or a receipt contradicting the cache's earlier observation),
the CLI printed only the cache error and exited 3 -- no receipt, and no key. A
command run without `--request` has a random key, so the Human could not ask again
and a retry took a new key and repeated the effect. `settle` now shows the receipt
and the `--request` key first; an unrecordable receipt exits with the receipt's own
code, a contradicting one exits 3. The receipt lock's open failure is now
`CACHE_UNAVAILABLE`, not a raw error. `receipt-supersession.test.mjs` stays CLI
cache evidence, not batch receipt recovery.

WP26.05 — canonical JSON, request identity, derived ids/paths and method metadata
already have single owners; re-validation at a different trust boundary (cache
codec vs broker DTO vs receipt codec) is kept.

Oracles. V26A: R14 (every header split, fatal UTF-8/JSON/length/EOF never
resynchronizes, disconnect keeps dispatched ownership and cancels queued work,
backpressure, half-close), R15 channel generations, P0 malformed-frame flood.
V26B: R08 lookup scenarios plus `send` resent with the bytes frozen before the
source changed, a settled receipt not replaced by a later pending one, and the fix
above. V26C: request and response budgets counted in UTF-8 bytes on the real
`BrokerChannel`, foreign id and unknown fields refused, with R15 response codec,
F3/F4 frame bounds and P2 wire golden. Negative controls: 6 mutants, all fail.
Not covered: the host channel and Principal credential paths end to end (WP28),
concurrent CLI processes on one key beyond `receipt-supersession.test.mjs`.

## WP27 — engine, extension and relay against the pinned engine

WP27.01 — the engine is pinned by `package-lock.json`: `@earendil-works/pi-coding-agent`,
`pi-ai` and `pi-agent-core` 0.85.1 (`PI_ADAPTER_REVISION` `oma-pi-rpc-v1@0.85.1`); no
dependency changed here. What OMA relies on, and where the real engine shows it:
SDK `ModelRuntime.create` / `ModelRegistry.find` / `getApiKeyAndHeaders` /
`SettingsManager` (T116, resolution from OMA's own agent directory); RPC mode with
`--no-approve --no-context-files --no-skills --no-prompt-templates --no-extensions`
and `-e` for the core extension; extension API `registerCommand`, `sendMessage`
(custom type, `triggerTurn`, `deliverAs`), `on("message_end")`, `on("agent_settled")`,
`appendEntry`, `sessionManager.getSessionFile` / `getLeafEntry`, `ui.notify`; RPC events
`response`, `message_end`, `extension_ui_request` (notify), `agent_settled`. V27A runs
all of them on the real engine.

V27A (real engine, generated rootfs, the adapter's own confined plan, relay with a
placeholder, TLS provider stand-in answering one Anthropic turn): `PiAdapter.deliver`
returns the boundary; the session file reads `custom_message(oma-mail)`, then the
assistant message with `stop`, then `custom(oma-delivery-boundary)` whose id is the
notified `entryId`; the provider saw the batch and the real key. Found defect, fixed:
the confined plan named its executable `bwrap`, and the owned spawn `deliver` uses
accepts only an absolute executable, so **no confined Resident could deliver a batch**
(runner line `adapter(...).deliver(batch)` failed with UNSUPPORTED_PROFILE every
time). T117 had started the plan through `spawnSandboxed`, which pins
`/usr/bin/bwrap`, and never went through `deliver`. The plan now names
`SANDBOX_EXECUTABLE` (`/usr/bin/bwrap`), the same binary.

WP27.02 — three facts are kept apart. The extension appended the boundary entry
(V27A reads it in the session file after the engine closed); the adapter received the
boundary notification naming that entry; the session data survives an OS crash or
power loss -- **not proven**: the engine's session writes are not claimed durable
here, and settlement rests on the runner's durable receipt (D01), not on the session
file. Power loss stays NOT_RUN (WP30).

WP27.03 — the relay is a byte relay for one delivery: fixed origin from the host's
profile, the caller's authority headers dropped, the placeholder swapped for the
key in headers and path only, 4 concurrent requests (beyond is 503, not a queue), an
idle timeout of the adapter's idle budget, no resend of an unclear request, and the
answer streamed through as it arrives (new V27B oracle), closed after the delivery.
It does not read tokens or prices.

WP27.04 — placeholder generation is total. H05 held: a candidate equal to the key
recursed without bound, so a key whose replaceable part has no letter or digit (a
token with a `_`/`-` signature, a key of separators, a long punctuation segment)
crashed with a stack overflow instead of being refused. Now at most 8 candidates,
then UNSUPPORTED_PROFILE; the shapes providers use still get a same-length
placeholder that differs from and does not contain the key.

WP27.05 — containment is unchanged and separately evidenced: mount plan and relay
path (T113), no host view or network and no product code inside (T117), the engine's
credential directory never mounted, the explicit `rootfs = "/"` opt-out still
announced as unconfined in that historical WP27 run. DR31 later removes that profile: rootfs='/' is now UNSUPPORTED_PROFILE before Resident startup. Tool surface limits are not OS isolation.

Negative controls: 4 mutants, all fail (unbounded placeholder retry, plan naming
`bwrap` by PATH, relay buffering the whole answer, a boundary notice naming an entry
the session does not hold). Not covered: a real provider, provider-side retries and
long streams (NOT_RUN, no credential), session durability under power loss (WP30),
the Principal's engine (WP28). The repository defines no separate `engine` lane;
V27A and the T113/T114/T116/T117 engine and relay oracles run in the durable lane,
which needs bubblewrap and openssl on the host (a skip there is not a pass).

## WP29 — where each kind of guarantee actually holds

| Claim kind | Holds at | Enforced by / negative oracle | Does not mean |
|---|---|---|---|
| closed method / kind / field vocabularies (`PUBLIC_METHODS`, `OPERATION_CODECS`, capability vocabulary, `RESOURCE_FIELDS`, `LIMIT` descriptors, set-field recipe) | type (compile) | `satisfies` / `[Missing] extends [never]` bindings; P22 A–D and V29A compile a mutated real Program and require an error | a runtime check of input -- decoders do that |
| `ValidatedPlan` / decoded-operation brands | type provenance | non-exported unique symbol, issued only by the operation codec; no `as ValidatedPlan` outside it in `src` | that the relations still hold after decode, one use, or anything across a crash |
| `readonly`, `Object.freeze` | type / shallow runtime | compiler; freeze on the owning object | ownership, aliasing control or durability |
| request, receipt, config, batch-view, status-view decoding | runtime | closed decoders; R15, R36 corpus, V02A/V11A, T118 | authority -- the broker re-reads current state |
| authority (peer, incarnation, capability, lease) | runtime, at the effect | `PeerAuthenticator`, `assertCurrentActor`, `currentIntent`, `requireManage`; V25A, V23B | anything a cached or earlier observation says |
| architecture import / effect / fence / transaction / ownership rules | static source analysis | `scripts/architecture/rules/*`, each with accept and reject fixtures; the exit-owner rule also with alias and look-alike fixtures (V29A) | data flow: a value passed through a function is outside every static rule |
| owner maps (`source-owners.json`, `mutation-owners.json`), traceability | inventory | drift and completeness checks (R39, P1) | proof: a requirement is proven only by an executed oracle with a fresh result |
| lane `requiredNames` | execution evidence | the named test must run and pass in that lane | that the name covers the requirement -- the card's oracle text does |
| cgroup death, unit state, start limit | kernel / user manager | kernel lane (T36, T38, V25A, V07B, V23B) | a pid, a signal or a socket close |
| session and receipt durability under power loss | not proven | -- | NOT_RUN (WP30) |
| a model-supplied tool value (extension → CLI) | runtime, at its slot | the extension's slot grammar (bound to the wire owner) and `parseArguments`; AV1 | that the value is true, only that it is data in the slot its grammar names |
| where the relay writes a credential, and that none comes back | runtime, at the relay | declared slots, refusal elsewhere, response tripwire; AV2 | that a compressed or frame-split echo is seen -- compression is refused, frame splitting is a stated residual |
| a model's tool scope | runtime, at engine start and at each tool call | `assertModelScope` and the workspace guard; AV3 | anything a tool the Human installed does outside the guard's path tools |
| a check of a state-tree entry covers the effect on it | runtime (one resolution), static (rule) | held parents and the `state-tree-held-parent` rule; AV4, AV5 | data flow of a path through a function, and the quarantine script inside its namespace |
| a peer or the Principal's engine has ended | runtime, at each observation | `pidfdLiveness` (running / exited / failed; EINTR asked again at most eight times) and `processEnded` (/proc answers); AV6 | that an unanswered question is reported as unavailable -- authority refuses it as CAPABILITY_DENIED (stated residual) |
| the previous configuration generation survives collection | runtime, at the commit and at the quiescent collection | since P0V-61 each record names the generation its commit replaced and is flushed before the commit point, and a commit whose record fails is not made; `generationsToKeep` removes only what the last record of the current generation's commit vouches for, and nothing when the journal was not read whole (P0V-72); AV7 | a journal that stays unreadable keeps everything, so a full edit budget is not freed by a restart |
| a local file the CLI is given | runtime, at `readLocalFile` | O_NOFOLLOW on the named file, a regular file, at most the CLI frame; AV8 | that directories on its path are not links -- only the named file is not followed |

WP29.01 — one overstated comment corrected: the operation-result brand was said to
"prove" ledger relations; it records that the codec checked them at decode time.
The compile-time claims in `capabilities.ts`, `limits.ts`, `resources.ts`,
`exhaustive.ts` and the operation codec are real compile-time bindings (P22).

WP29.02 — the request-hash set-field recipe was a `Record<string, string[]>`: a
misspelled method or field compiled and silently skipped normalization. It is now
checked against `MutationMethod` and each method's array params (V29A compiles an
unknown method, a missing field and a non-array field and requires an error); the
recipe values, and so the v1 hash, are unchanged.

WP29.03 — the CLI exit-owner rule matched only the literal call `process.exit(...)`.
It now also catches a reference, element access, destructuring (renamed too),
`globalThis.process` and a `node:process` import, and still ignores look-alikes
(`app.exit()`, `obj.process.exit()`, strings, comments, `process.env`) (V29A; the
previous rule lets five of the eight spellings through). Data flow stays out of scope;
the CLI exit behaviour tests own it. No broad allowlist was added.

WP29.04 — proof scopes of fixtures: `createCompleteConfigurationFixture` is
production-valid and goes through the real loader (V02A rejects deliberately
broken variants); layout-only fixtures prove parsing, not a startable config;
`receipt-supersession.test.mjs` and the CLI replay suite are CLI cache evidence,
never batch receipt recovery (that is V06/V07/V08); spawn-plan unit tests prove
argv and environment, and only V27A/T117 prove an actual spawn.

## WP28 — what the TUI says, and on what evidence

WP28.01 — every statement on the screen and the fact behind it:

| Where | Says | Evidence |
|---|---|---|
| Dashboard Workers / Active / Pending / Status | counts with the observation time, or `unknown (reason; time)` | the broker's status view (WP23 snapshot); missing, unreadable, malformed, foreign or stale is unknown (T118) |
| Dashboard Mail | `N건 Principal 세션에 전달 대기 (time 관측) · 새 도착 M건`, or `unknown (reason; time) · 새 도착 M건` | N: the ledger's pending count for the Principal in the status view (in no batch, or in a prepared one); M: files in the Principal's `new/`. P0V-66 corrected the evidence recorded here earlier -- `new/` alone. A batch is prepared, and its messages move to `cur/` (`moveToCur`), before the session takes it, and a session in a turn defers it (UNIT-005) |
| Dashboard Model | configured value, and what the running session started with | configuration and `sessionModel` (V15B); never the engine's own report |
| Dashboard Sandbox / Usage | declared confined rootfs (DR31); usage unknown | configuration; the engine owns spend (INF-001) |
| Config notices | saved (with when it applies), unchanged, saved but not read back, save failed | the managed writer's outcome (WP13/WP15) |
| Transcript `✗ 보내지 못한 입력` | a prompt that was never written, returned once and in order | WP09 session disposition |
| Transcript `⚠ … 확인하지 못했습니다(자동으로 다시 보내지 않음)` | a prompt written but not answered | WP09; never resent |
| Mail list `●` | arrived and in no batch yet (P0V-66: not "not yet delivered" -- a prepared batch's messages are in `cur/` and still wait); opening it is neither delivery nor acknowledgement | the Maildir file's place (`new/`) and a read-only bounded read of it |

Found and fixed. (1) The mail count and `●` said "unread", which reads as the
Human's reading; they count messages not yet delivered to the Principal's session,
and opening one writes nothing (V28A). (2) A failure after the terminal opened --
any rejection of `main`, e.g. a broker that fails to start -- ended through the
top-level catch, which wrote the message and exited without restoring the terminal:
raw mode, the alternate screen, bracketed paste and a hidden cursor were left on
the Human's shell, the message was written into the alternate screen and lost, and
the broker and engine were not ended. `openTerminal` now restores on every process
exit (its comment already promised "unconditional"), and the top-level catch first
abandons the tenure, stops the broker and restores the terminal, then writes the
reason on the Human's own screen. V28B, in a real pty: the normal quit, an exit that
never calls restore and a rejection after the terminal opened all hand the terminal
back with echo and line mode on and the screen modes undone, and nothing takes it
again afterwards; the previous code fails the last two.

WP28.02/03 — screens pass edit intents only; writing, validation and revision stay
with the managed writer. Unsent prompts come back once, in order, when the session
ends; there is no crash-surviving draft store and nothing on screen promises
recovery after a crash.

WP28.04 — bounds: the transcript is byte-bounded, a Human prompt is limited by its
encoded frame bytes, the key decoder bounds escape and paste input, and a code point
split across reads is one key (V28B); a resize reaches the owner and redraws.

The Principal's workspace limit (left open by WP25): the Principal is not a unit and
`oma` starts each session from the current principal profile -- model and workspace
limit together, D05's "next Principal session"; there is no accepted spec the host
could read before its broker exists. Recorded, not changed.

Lanes: the repository has no `pty` lane; V28B runs in the durable lane with Python's
pty module (a skip there is not a pass). Not covered: the whole `oma` entry in a pty
with a real broker and engine, SIGHUP, and terminal emulator differences.

## WP31 — the installation, its support range and its lockfile

WP31.01 — the support table lives in `operations/README.md` ("지원 범위 (WP31)"): Node
24.21.0, Debian 13 / Linux 6.12 / cgroup v2, systemd 257.13, util-linux 2.41.5,
bubblewrap 0.12.0 at `/usr/bin/bwrap`, the 0.85.1 engine packages, koffi 3.2.1,
nodemailer 10.0.1, typebox 1.3.7, with each host difference and the WP that met it.
Anything not listed is NOT_RUN, not assumed.

WP31.02/03 — the declared deployment is a built tree used as `installation.libdir`
(DEPLOYMENT_LAYOUT, checked by `check:package`). `npm pack` ships no `dist`, and the
package declares no `bin`: the README said `oma` was an installed command, which no
install step provides. The README now gives the real invocation (`node
<install>/dist/src/entry/oma.js`) and says no command is put on PATH; adding a
`bin`/installer is an install-surface (C2) decision not taken here.

V31A: the closure -- `dist`, schema, unit templates, `package.json`, the lockfile
and the lockfile's production modules -- copied to a fresh prefix passes
`check:package`, and with every module resolution and file read into the source
tree refused it resolves its assets, runs its own engine (`--version` 0.85.1), and
loads the broker, runner, host and CLI entries to their own usage checks. Found and
fixed: the engine lookup walked every `node_modules` from the installation up to
`/`, so an installation missing its engine ran another installation's; it now looks
only in the installation root's own `node_modules` and otherwise refuses
(UNSUPPORTED_PROFILE). The previous lookup fails V31A.

WP31.05 — found and fixed: on 2026-09-19 `package.json` moved the engine and
`pi-tui` to `dependencies` but `package-lock.json` kept them as development
dependencies (dev-flagged with their whole closure), so a production install
(`npm ci --omit=dev`) left the engine out. The lanes never showed it because they
copy the development tree's `node_modules`. The lockfile was regenerated offline
with `--package-lock-only`: 0 version changes, 0 packages added or removed, 160 dev
flags cleared, root dependency kinds matching `package.json`. V31B checks the root
kinds and walks the production closure for dev flags (the previous lockfile fails),
and the package check names a missing unit template, a missing entry and a
dependency version that is not the locked one.

WP31.04 — launch location and config path reach every unit (WP03), and a Resident
historically ran with its accepted resources (WP25; superseded by DR37/DR46). Old units
without those are refused and must be recreated; managed config generations are
not readable by earlier writers. Not covered: other Node versions and
distributions, an `npm ci --omit=dev` install from the registry (offline here), and
a systemd-managed broker in operation.

## WP30 — crosscutting invariants, crash points and qualification

WP30.01 / V30A (property lane) — an independent model of one prepared batch's
delivery evidence, written from D01's decision table and run on the composed runtime
(real Store, Mail, receipt files and `Broker.openRun` after each broker restart,
which closes and reopens the database) over 24 seeded 8-event sequences: publish,
corrupt, a late receipt from an incarnation the batch has left, hide, reveal, open.
Each step compares the incarnation, the batch state and incarnation, the open
outcome and the receipt bytes; each sequence ends by making the evidence readable
and opening once more (liveness). Unreadable evidence blocks until it is readable
again and then settles; conflicting or late evidence blocks, is kept, and never
becomes success on its own; a completed batch stays completed. Mutants that treat
unreadable or conflicting evidence as absent, or roll over without settling, fail
it. Lifecycle, mail/ledger and parser models remain R36/R35.

WP30.02 — FAULT-MATRIX rows and the seam that exercises each (lanes as of v7):

| Boundary | Oracle | Lane / status |
|---|---|---|
| receipt temp before creation / partial write / file fsync / final publish / parent fsync | V05A, V05B checkpoint crashes | crash PASS; power loss (V05C) NOT_RUN |
| receipt durable, ledger still prepared | V06A, V07A, V08A (completion only, no redelivery) | durable/crash PASS |
| batch.complete commit, response lost | V06B exact replay | durable PASS |
| old receipt settled, rollover not committed | V07B incarnation-commit fault | durable PASS |
| rollover committed, endpoint not bound | V07B (no live lease after a failed open); endpoint-bind fault not injected separately | durable PASS / partial |
| Principal prompt before write / written, unanswered / accepted, no boundary | V09B, V09A, V10A | durable PASS |
| boundary notified, session durability unknown | V27A shows entry and notice agree; durability not claimed | durable PASS / power NOT_RUN |
| config candidate before validation | V11A | durable PASS |
| generation build / flush / pointer rename / parent flush | V13A crash at every durability point | durable PASS; power NOT_RUN |
| committed config, UI reload fails | V15A saved-unread | durable PASS |
| stale edit between compare and publish | V13B POLICY_CHANGED | durable PASS |
| context/tree preparation error / last observation fails | V18A, V18B | durable/crash PASS |
| bootstrap partial freeze / linked create | V19A, V19B | durable PASS |
| DB COMMIT outcome unknown | V17A, V20 | durable/crash PASS |
| Git CAS before authority change / after CAS / third ref | V24B, V24A | durable PASS |
| logical quota exceeded | V21B, V22A/B | durable/stress PASS |
| transport disconnect after acceptance | R14 (V26A) | durable PASS |
| unit path stop fails | SEQ-002 (V25B) | fast/kernel PASS |
| broker/host ends with children left | V03B, R37 shutdown, V10B | kernel/durable PASS |
| status refresh fails | V23A, WP23.05, T118 | stress/fast PASS |
| unsupported DB version | V04 | durable PASS |

Injected exceptions run cleanup and process crashes do not: the crash lane kills at
real checkpoints and the parent observes the boundary was reached (WP02 driver).

WP30.03 — safety and liveness are judged apart: V30A, V07B and V23A each require
progress once the fault clears (readable evidence settles, a manager that answers
again is observed), while conflicting evidence, a start limit and unproven death
stay blocked with their reason.

WP30.04 — every fix in this plan has a regression that fails when its cause is put
back, run as a mutant in a disposable copy on the disposable account or by
restoring the previous code: WP03 10/10, WP07 5/5, WP08 6/6, WP09 4/6 (two
equivalent), WP10 6/6, WP13 13/14 (one equivalent), WP14 8/8, WP15 7/7, WP23 10/11
(one equivalent), WP25 10/10, WP26 6/6, WP27 4/4, WP28 3/3, WP30 3/3; WP29 and WP31
by the previous rule, lockfile and resolver failing their oracles.

WP30.05 — qualification, raw results kept apart:

| Environment | Result |
|---|---|
| node / git-fs (fast, durable, property, stress, local) | PASS at v7, zero skips |
| engine (bundled 0.85.1, provider stand-in) | PASS (V27A, T116, T117) |
| pty | PASS (V28B; Python pty harness) |
| kernel (disposable user manager, systemd 257) | PASS 63/63 at v7 |
| crash (process SIGKILL at checkpoints) | PASS 63/63 at v7 |
| powercut (VM storage loss) | NOT_RUN -- no approved VM; SIGKILL results are not power-loss evidence |
| real provider | NOT_RUN -- no credential authorized |
| CI | NOT_RUN -- nothing pushed |

## WP32 — closure, invariants and the verdict

WP32.01 / V32A — `implementation/review-ledger.json` is generated (`npm run
review:ledger`) from the plan's 220 assignments, git history since `b25961c`,
the tree's test names and `implementation/review-notes.json`, and checked by
`scripts/review-closure.mjs` (fast lane). Every current and baseline production
file has one status: 73 changed with the changing WP's oracles present as tests, 10
read in full and left unchanged (with the oracles that exercise them), 139 not
reviewed in this implementation, none removed. **The review is not complete**: the
139 were assigned by the plan and are covered by the suite, but were not re-read
line by line here, and they are not marked reviewed. The checker refuses a review
with no work package, no oracle or an oracle that is not a test, a missing file and
a hand-edited summary.

WP32.02 — the invariants, where each is defined, owned and shown:

| INV | Owner in this tree | Regression that shows it |
|---|---|---|
| INV01 identity vs current authority | incarnation/InvocationID/pin table (WP25), batch incarnation (D01), generation id (D02) | V25A, V07A/B, V30A, V13B |
| INV02 unknown is not absent/success/dead | receipt observation (D01), `confirmDead`, status snapshot, peer and engine liveness (`pidfdLiveness`, `processEnded`), configuration collection (`generationsToKeep`), storage walk, mailbox read | V06A, V30A, V23A/B, T38, AV6, AV7 |
| INV03 terminal facts and frozen intent kept | receipt supersession, CLI freeze, completed batches, create readiness (the agent left `provisioning`) | V26B, V06B, V30A, AV4 |
| INV04 one policy owner per decision | method descriptors, operation codec, request-hash recipe, exit owner, CLI argument spec (`parseArguments`), model workspace (`modelWorkspaceFor`) | P22, V29A, P1, AV1, AV3 |
| INV05 lifetimes and responsibility explicit | connection vs accepted task, run pin, preaccept scope | R14, V25B, V17A |
| INV06 current authority at the effect | `currentIntent`, `assertCurrentActor`, peer re-check | V25A, V23B, V24B |
| INV07 atomicity and durability units named | receipt publish + parent fsync, generation + manifest | V05A/B, V13A |
| INV08 read/admit/settle/repair distinct | resource categories, storage admission | V21B, V22A/B |
| INV09 a checked value's guarantee is the check's scope | WP29 guarantee table | V29A, P22, AV1, AV2, AV3, AV4, AV5 |
| INV10 every I/O, queue and retention bounded | status refresh, relay, frame budgets, placeholder | V23A, V27B, V26C |
| INV11 observation and display create no authority | status snapshot, TUI facts | V23B, V28A, T118 |
| INV12 evidence and scope not hidden | review ledger, validation binding, qualification table | V32A, R38 |

WP32.03 — documents: README states the real install and invocation, operations/README
the support range (WP31); HANDOFF keeps only the resume point. architecture.md,
implementation-spec.md and physical-ordering.md were not rewritten: no approved
ADR changed their normative text in this implementation beyond what the owning WPs
recorded here.

WP32.04/05 — the final source is bound by `implementation/validation.md` (digest
and lane results); CI has not run (nothing pushed), powercut and a real provider are
NOT_RUN. **Verdict: not release-approved.** What is established: every card's code
and oracles, local lanes, the disposable-user kernel and crash lanes, the bundled
engine and a real pty. What is not: 139 files not re-read, power loss, a real
provider, CI.

## Re-review and adversarial verification (after WP32)

Oracle closure. Every one of the plan's 73 oracles is now a test by its own id, or
carried by named tests that an executed lane requires (`implementation/oracle-map.json`:
V00A/V32B by the R38 digest binding, V00B by the R35 evidence policy, V10B by R37
shutdown, V25B by SEQ-002 and T38, V26A by R14/R15, V29B by V02A and V32A, V30B by
the crash evidence policy and V07B), or recorded as not run (V05C power loss, V30B
powercut/provider, V32B CI), which the verdict lists. The check found that SEQ-002,
T38, the R38 digest tests and the R35 evidence tests ran but no lane required them,
and that `runtime-contracts` (SEQ-002 stop ordering) ran in no lane at all; they are
required now.

Mutants for the cards finished in earlier sessions (WP04-WP06, WP11, WP12, WP17-WP22,
WP24), one minimal reversion of a guard each, run on the disposable account: 30
mutants, 20 failed their card's oracles at once. Of the 10 that survived, 9 were gaps
and one an equivalent:

| Survivor | Gap | New oracle |
|---|---|---|
| WP05 receipt file not fsynced before publication | seams named the flush; nothing watched it | V05A watches `fsyncSync` itself |
| WP06 unreadable receipt directory read as absent | no test of a directory that cannot be opened | V06A directory EACCES is unavailable |
| WP06 live completion ignores incarnation / session path | the broker's run check masked the Mail check | V06A binds incarnation and session directly |
| WP12 one file over 1 MiB | only the aggregate bound was tested | V12B single-file bound |
| WP12 file changed before snapshot completion | no seam after the manifest | `source-read` observer seam; V12A |
| WP12 file changed during one file's read | no seam between the read and the second fstat | none (see below) |
| WP18 replaced staging root deleted by cleanup | no replacement test | V18A replaced root kept, REF_STATE_UNKNOWN |
| WP24 recovery CAS losing to a third writer settled | only the live race was tested | V24A race at the last policy reread |
| WP11 commit without the first validation | -- | equivalent: both writers validate again before writing |

Rerun of the 9 gaps: 8 now fail; the ninth, a change inside one file's read (between
the read and the second fstat), is a race no seam can place deterministically without
an intrusive hook in the read path; it stays a code-reviewed guard.

Counterexamples tried against the finished product:

- A Resident flooding its own actor socket: every connection cost the broker a
  socket and a peer pidfd with no bound (INV10). Fixed: `ACTOR_CONNECTIONS` (16) per
  actor socket, refused by the kernel listener before a pidfd is taken; V26A shows the
  flood held and the Resident answered after it (the uncapped listener fails it).
- Idle connections to the inference relay (WP27 "연결 수"): unbounded. Fixed:
  `RELAY_CONNECTIONS_PER_REQUEST` × concurrency; V27B (the uncapped relay fails it).
- A status view dated ahead of the reader's clock (a clock set back): shown as the
  current observation for as long as the jump (INV11). Fixed: more than one refresh
  interval ahead is unknown with its reason; T118.
- Terminal escape bytes in a Resident's mail subject or body, or in engine output:
  refuted -- every screen line passes `pad`/`fit`/`displayable`, which drop C0/C1
  controls and zero-width clusters.

## Whole-codebase adversarial pass (after v9) -- AV1..AV31 as applications of INV01..INV12

Every production file was read against the trust boundaries: a Resident (its
actor socket, and the workspace, home and session directory its sandbox writes),
the Principal's model (its tools on the host), code inside a sandbox, and a
process of the same user. No finding gets a principle of its own. Each one is a
place where an invariant of `guide/PRINCIPLES.md` or a MUST of the spec already
applied and was not honoured; it is fixed through that invariant's owner (an
existing one, or one extended), every new helper meets the abstraction
acceptance criterion there (it removes an independent decision, a premise a
caller must remember, or a resource that can be missed), and the WP32.02 and
WP29 tables below name the owners and regressions. "AV1..AV31" are regression
ids, like R38 or T118, not principles. The requirement links are in
`implementation/source-owners.json` (CLI-001, PR-004, FS-003, INF-007, FS-005,
SB-006).

| Id | Finding (counterexample) | Invariant / MUST violated | Owner (fix) | What the owner removes | Regression |
|---|---|---|---|---|---|
| AV1 | Principal's `oma_mail_send` with `to = [commons, --file, <host file>]` read that file as the body and posted it to the archive; an injected `--kind approval_required` sent what the tool does not offer (run) | INV04: which argv token is an option was decided three times, independently (`opt` first occurrence, `positional` with its own option list, `multiOpt`). INV09: the tool schema checked a value's type, not the slot it lands in. CLI-001 is the command grammar | `src/cli/arguments.ts` `parseArguments` (one declared spec per command); the extension checks each value against the wire grammar of its slot (INV04: its mirror is bound to the owner by an equivalence test) and puts it in that slot | three independent option decisions become one; the extension caller no longer relies on the CLI to reinterpret its values | AV1 (three tests) |
| AV2 | placeholder in the request path or in any header was swapped for the real key; a provider 404 naming the path returned the key into the sandbox (run) | INF-007 (no credential in the sandbox, in any form) over INF-005's "header values and request path"; INV09: the relay checked only the authority headers while it swapped everywhere | `InferenceRelay` (INF-005's owner): the swap happens exactly in the slots it checks (authority header value, `key` query); a placeholder elsewhere is refused; a response carrying the key is cut off before it reaches the sandbox, with compression refused so the bytes are visible | a second, wider swap scope than the checked one | AV2 (three tests) |
| AV3 | the Principal's engine ran with `principal/private` as the workspace; the workspace guard let the model read and edit the Human's session history | PR-003/PR-004 (Human session and credentials never model-facing), FS-003 (the Principal CLI's cache is in its private scratch); INV04: the Principal's workspace was decided inline in `entry/oma.ts` while a Resident's came from `derived.ts`; INV09: the guard's guarantee was the width of the directory it was handed | `modelWorkspaceFor` in `domain/derived.ts` (the path owner) for both kinds of agent; the Principal's scratch `principal/private/workspace` is also its CLI's home (FS-003) and is created by provisioning like the rest of the private space; `assertModelScope` refuses, where each engine starts, a workspace overlapping session history, engine settings or credentials, or views | two independent workspace decisions become one; the start no longer depends on every layout author remembering what the guard must not reach | AV3 (two tests) |
| AV4 | the receipt's session check resolved the path and opened it again inside the directory the sandbox writes; create recovery ran `git rev-parse HEAD` in a workspace after the Resident had had it | INV03: readiness, once proven and recorded by the agent leaving `provisioning`, is a settled fact -- recovery re-derived it from current state (the HEAD the model can move), the exact misreading INV03 names; FS-005 (no agent symlink is followed to open a host file), INV09 and architecture section 4 for the session check; SB-006 (session contents are model-origin) | `sessionPathCheck` opens the file once beneath the session directory, following no link; `CreationPublicationObserver.ready` and `WorkspaceCoordinator.ensure` observe the workspace only while the agent is `provisioning` and take the recorded fact afterwards | a second resolution of a model-writable path; a re-derivation of a settled fact | AV4 (two tests) |
| AV5 | spool, quarantine staging, mailbox move, rootfs, configuration generations, provisioning, status view, world directory, Principal inbox named paths again after checking them | FS-005 (no-follow, exclusive create, no agent symlink followed) as architecture section 4 states it (the parent is resolved once and the path never said again) -- INV09 applied to the namespace: a check and an effect that are two walks guarantee nothing about each other | the storage primitives (`withinDirectory`, `entryAt`, `openBeneath`, `ensureDirectory`, `removeOwnedTree`/`removeOwnedFile`), extended by `observeImmutableEntry` and `writeExclusiveFsyncedEntry` so a caller acts on the entry it checked; the `state-tree-held-parent` rule holds `src/` to them | the second walk at each site; the rule removes the need to remember the discipline per file | AV5 (four tests) |
| AV6 | found by the v11 kernel lane, not by reading: under load a live Resident's `git.submit` was refused CAPABILITY_DENIED (retry never). Reproduced (1 in about 20 loaded runs) and caught in the act: `poll` on the peer's pidfd returned -1 with errno EINTR in the same millisecond as the refusal. The same collapse in /proc: `processIdentity` returned null for any read failure, and the Principal endpoint retired the registration -- connections cut, credential dropped -- on that null | INV02 (unknown is not dead; an observation failure is not a licence to delete): a `poll` a pending SIGCHLD interrupted, and a /proc read that failed with EMFILE, were each read as the process having ended. `lockFileDescriptor` and `holdAbstractName` in the same leaf already keep the third answer; the pidfd poll did not | `pidfdLiveness` (leaf: running, exited, failed; EINTR asked again at most `PIDFD_POLL_ATTEMPTS` times, INV10; POLLNVAL is failed), and `processEnded` (process-ancestry: ended only when /proc names no such process or another start time). Authority still needs an answered "running" (INV06); retirement needs an answered "ended" | the reading of an interrupted or failed observation as an exit, at the one primitive for each question; the two inline "has the engine ended" expressions in `principal-endpoint` become one owner | AV6 (two tests) |
| AV7 | AV6 was missed by the line-by-line reading, so INV02 was swept again through every observation whose failure is swallowed into a value (catches returning a definite value, defaults kept when a read fails, `existsSync`). Where that value decided an effect: the configuration collection read an unreadable journal as an empty history and removed every generation but the current, and removed the actual previous generation when its record was lost (a crash between the manifest's rename and the append); an existing generation that could not be read was reported as holding other bytes (STORE_CORRUPT); storage admission measured a root it could not see as 0 bytes; the Dashboard counted an unlistable Principal mailbox as 0 waiting and the Mail screen showed it as "no mail" | INV02 (an observation failure is not a licence to delete, and unavailable is not conflicting or empty); INV03 for the journal: the manifest's commit point is the fact, the journal only its order; arch §23.5 and TUI-012 ("never convert a missing observation into 0") for the display | `recordCommitted` writes back the generation the manifest named before (the committer knows it exactly) when the journal does not end with it; `generationsToKeep` removes a generation only when the journal vouches for it; `sameBytes` answers only for missing, linked or different files; `observedStorageBytes` walks its root like any entry; the mailbox read (`readMailbox`/`unreadCount`) carries "could not be read" to `DashboardData.unread` (null) and the Mail screen | a journal or directory that could not be read standing in for an empty one, at each owner; the old catch-all defaults | AV7 (six tests) |
| AV8 | the same sweep for INV10 and for what the records promise: WP26 records CLI effects as "no-follow reads". The bundle and context reads were; the file named by `--file` (send, submit, agent brief) and `--reply` was read through a link and without a bound, so a link given as the body put the file it pointed at in the request, and `/dev/zero` was read until memory ran out. The Principal's own tools cannot make a link (bash is excluded), so no model path reached it; a person's CLI and a Human-installed tool could | FS-005 (no agent symlink followed to a host file), INV10 (every I/O bounded), INV12 (the WP26 inventory claimed a bound the code did not keep) | `readLocalFile` in `cli/effects.ts`: O_NOFOLLOW, a regular file, at most `cliFrameBytes()` -- the one owner of the CLI's frame, now shared with the transport (INV04) -- for both `readBody` and the reply source | the link-following, unbounded reads at the two call sites; the frame value computed inside the transport alone | AV8 (one test) |
| AV9 | found by the real-provider functional run (ENG1 engine, GPT-6 Luna): `status` reported the Principal as `inactive / dead / success / 0` while its engine ran. systemd answers for a unit it does not have (the Principal has none) with `LoadState=not-found` and the values of a clean exit, and the observation did not read LoadState | INV02 (a unit that does not exist is not a unit that ran and exited) | the batched status observation (`observeStatus`) reads LoadState and answers `no-unit`; the status row shows null unit fields and `reason: "no systemd unit"`. The kernel lane's V23B had asserted the old reading for an agent with no unit and now asserts `no-unit` | the reading of an absent unit as a clean exit in the read model; effect paths (`confirmDead`) observe again and are unchanged | AV9 (one test, V23B) |
| AV10 | same run: the delivery notice showed a Korean subject as RFC 2047 encoded words, and pointed the Principal at `/inbox.md`, which on the host where the Principal runs is no file -- a batch holds up to 24 messages and the notice names six | BATCH-002 (the notice carries the subject; the index gives every id and a directly readable path) | `displaySubject` beside `decodeSubject` in `mail/headers.ts` (decoded, or the header as it arrived if it is not this writer's); the Principal's mail tool reads `/inbox.md` from its batch view the way it already reads `/mail/archive/cur/...` names. The notice stays one text for both roles | an encoded subject in a notice; an index the Principal could not read | AV10 (two tests) |
| AV11 | same run: the Principal could check status and mail and nothing else. Its profile holds `agent.create`, `agent.manage.descendants`, `route.follow` and `context.publish`; the default seeds no Resident ("created when they are asked for"), and no Resident works before the Principal publishes the GOAL (§15.1, LIFE-004) -- but the Principal's model had four tools and no shell, and the credential that makes a CLI the Principal's stays with the extension (T114). No society could start | arch §8.3 and §15.1 (the Principal publishes the GOAL and Residents are created on request) over PR-004 (the Principal's shell stays excluded while S-02 is open); INV09 (each value in its slot, as AV1) and INV04 (one grammar mirror bound to the wire, one revision resolver, one path owner) | `principal-tools.ts`: one tool per CLI command the Principal's capabilities allow (agent create, start/stop, follow/unfollow, context publish, logs), registered only for an engine with the product's credential channel; the brief is a fresh temporary, the context directory must be inside the Principal's scratch, the default base is the society's main resolved by the CLI's own `resolveOid` in the canonical repository (`projectGitPathAt`, now the one owner of that path) | the gap between the Principal's capabilities and its model's means; five inline copies of the canonical repository path | AV11 (three tests) |
| AV12 | found by the second functional run, once AV11 let the Principal create and start a Resident: every `agent.start` ended `unknown` and the Resident never ran. An explicit start first ran `reset-failed`; systemd unloads an inactive unit nothing references, and answers `reset-failed` for it with "not loaded" (exit 1), so the start failed before it enabled anything. The kernel lane starts a unit right after creating it, while it is still loaded, and never met this | INV02 ("no failed state to clear" is an answer, not a failed repair); T36's repair is of a failed unit | `UnitsModule.start` resets only a unit it observed `failed`; T36's explicit repair of a start-limited unit is unchanged | a repair step that could only fail on the units it was not needed for | AV12 (one test, T36) |
| AV13 | the third functional run, with Residents running: a Resident could not commit, submit, follow a topic or read `/inbox.md`, `/world` or `/mail/archive` with its file tools. Its engine was started with `--exclude-tools bash,powershell` and its guard refused the shell and confined every path tool to `/workspace` -- although the START the broker writes for it names exactly those paths and the commands `oma send`, `oma submit HEAD`, `oma agent ...` | SB-001 and arch §16 (the rootfs holds Git and a shell for the model), arch §11.1 and CLI-001 (the Resident commits and runs `oma` in its sandbox), VIEW-001 (START names those paths and commands); TSP-009 (the mount plan, not the tool surface, is the boundary). PR-004's exclusion is the host Principal's | the engine argv excludes the shell only for an engine outside a sandbox (the Principal; a Resident of an unsealed deployment); the runner states `OMA_TOOL_SCOPE=sandbox` in a confined engine's environment (mirrored by the extension, bound by a test, INV04), and the guard then leaves the shell and reading to the mount plan, while write/edit stay in the workspace within its quota | a Principal-only rule applied to Residents; START instructions no Resident could follow | AV13 (two tests) |
| AV14 | same run: every Resident activation started a new Pi session, so a Resident woken by new mail had lost what it had done; every TUI run started a new Principal session | arch §7 (the runner joins one Pi session to the mail queue; activation resumes it, "Pi session 재개 또는 새 session"); PR-003 and TUI-004 (the Human's context stays in the existing session; a TUI exit does not make a new Principal) | both engine argv builders pass `--continue`: the engine opens the most recent session in the agent's session directory, or a new one when there is none | a fresh session at every activation and every TUI start | AV14 (two tests, on the real engine) |
| AV15 | the functional runs, repeatedly and for two models: a Resident replied to `principal@provtest.oma.invalid` -- the address its mail's From and Reply-To show -- and the send tool refused it; models read messages as `<id>:2,`, the file name the index lists, and the read and ack tools refused it | BATCH-002 (a notice and its index name each message readably) and INV04 (what OMA displays and what its tools accept are one grammar, not two) | the mail tools take this society's RFC address as the logical address it displays -- `logicalFromDisplay`, the extension's mirror of the inverse of `displayAddress`, bound to it by round trip -- and a message's archive file name, or this society's RFC Message-ID (`<id@society.oma.invalid>`, which In-Reply-To and References show; MAIL-004), as the message; anything else is refused as before | the gap between the names OMA shows and the names its tools take | AV15 (one test) |
| AV16 | the fourth functional run, once AV13 gave the Resident its shell: `bash: node: command not found`. The sandbox's PATH was `/usr/bin:/bin`, the pinned Node is bound as one file at `/opt/oma-node/node`, and there was no `oma` command at all -- although CLI-001 governs "the `oma` executable in the Resident rootfs" and START names `oma send`, `oma submit HEAD` | CLI-001 and arch §11.1 (the model-facing CLI is a command in the sandbox); SB-007 keeps the rootfs to mount targets and passwd/group, so the command belongs to the installation mounted at `/opt/oma` | `DEPLOYMENT_LAYOUT.modelCommand` (`dist/libexec/oma`); `modelCommandScript()` and `RESIDENT_PATH_ENV` in `sandbox.ts` derive the launcher (the pinned Node running the installed CLI) and the PATH (it, then the pinned Node's directory) from `RESIDENT_PATHS`; the build writes the launcher, the deployment manifest pins it, the package check requires it executable and byte-equal to its owner | a START that named a command the sandbox did not have | AV16 (one test, in the production sandbox) |
| AV17 | the fifth functional run: both Residents' runners failed with BATCH_CONFLICT at every activation, one batch was presented seventeen times (incarnations 2 to 20) and never completed, and systemd's start limit ended both. No confined Resident had ever completed a batch: the boundary the confined engine reports names its session file by the sandbox's view (`/run/oma-sessions/...`), and the receipt check requires the host session directory. V27A and T117 stop at the boundary and never published a receipt on the confined path | D01 and SB-006 (the trusted runner's receipt names the durable session file; the engine's report is model-side data) | `hostSessionPath` in `sandbox.ts` translates a session path back through the one mount table (`residentMounts`, now shared with `confinedPath`, INV04), only from the session mount and only a plain file directly in it; `PiAdapter` applies it to every confined boundary, and a path that does not translate is no boundary. V27A now publishes and verifies the receipt | the sandbox's view of a path used as the host's | AV17 (one test), V27A |
| AV18 | same run: a Resident's `oma submit` answered CAPABILITY_DENIED git.submit. CREATE-002 gives a child the parent's current capabilities ∩ the parent profile's delegable ∩ the child profile, and the default Principal delegated `git.submit` and `agent.manage.self` without holding them, so every Resident the Principal creates -- the default's only kind ("created when they are asked for") -- got `mail.send` and `route.follow` only | CREATE-002 (the intersection, no widening by role) and arch §11/§15 (Residents submit the society's code); AUTH-001 still keeps `code.integrate` from the Principal | the default Principal profile holds what it delegates; a test runs the default configuration through `resolveChildSpec` and requires the Resident profile's capabilities, and that no profile delegates what it does not hold | a delegation the default configuration could never honour. A society bootstrapped before this keeps its Principal's frozen spec (LIFE-008) | AV18 (one test) |
| AV19 | the full local suite during this work: T115 (two first starts racing on one state root) failed once with `EEXIST ... symlink 'usr/bin'`: both starts saw the rootfs link absent and the second create lost | provisionSociety's contract ("safe to lose a race with another start") | `ensureLink`/`ensureFile` treat EEXIST as the race it is and observe the entry the other start made, once | a lost race failing a start | T115 (15 of 15 after the change) |
| AV20 | the sixth functional run, on a fresh society: the Principal created two Residents at once. The second create was accepted, found the first still completing and answered BROKER_UNAVAILABLE "its intent is retained"; the Resident stayed `provisioning` for as long as the broker ran. The intent was retained for the reconcile timer (arch §6.1, §6.5, §17.1; REC-002), and nothing installs that timer: `ensureReconcile` has had no caller since it was written, and the product's broker is a foreground one, whose lifetime no timer unit can share | REC-002 (a 5 s bounded sweep, joined when one runs, no model call), arch §6.5 ("이벤트는 빠른 반응용이며 원본이 아니다") and D03 (each mode renders only the lifetime dependencies that are true) | a foreground broker runs the sweep itself for exactly its own lifetime: `Broker` starts it with the status timer, each tick is `ReconcileModule.sweep` plus the view refresh, the drain waits for a running one like any dispatched task, and a failure is reported once until it changes. `RECONCILE_INTERVAL_MS` is the broker's own interval, and v0.1.0 ships no external reconcile service/timer unit or `host.reconcile` RPC at all | a recovery the design depends on that no deployment runs | AV20 (four tests) |
| AV21 | same run: a Resident's runner exited with BROKER_UNAVAILABLE after every delivery longer than `idleStreamSeconds` (30 s); the next incarnation settled the batch from its receipt (D01), but each long batch cost a failed start against the unit's start limit (5 in 60 s). The runner held the connection it opened the run with through the whole turn, and the broker closes a connection nothing speaks on for that long | the connection's bounded idle (IPC, CFG-004) on both ends, and authority by the calling unit rather than by the connection (`requireRunnerUnit`) | the runner dials again for the call after a delivery; a connection serves the calls made together, not the run | a connection held past the bound its own channel enforces | AV21 (one test) |
| AV22 | same run: that refused create reached the model as `BROKER_UNAVAILABLE: BROKER_UNAVAILABLE` and no key, and the model asked again under a new key -- the one thing the error table forbids for that code ("bounded same-key 조회/재시도; 새 key 금지") | ERR-001 (the caller branches on retry) and the CLI's own recovery lines, which name the key wherever an outcome is unclear | a mutation failure whose retry is `same-key` names the request key and says not to use a new one; one never to retry does not | a retry instruction the caller could not follow | AV22 (one test, two cases) |
| AV23 | same run: a Resident's report in Korean reached the Principal as a Base64 body; a Principal has no shell to decode it, and a Resident did so with `base64 -d`. The pinned MIME adapter (MAIL-003) chooses Base64 or quoted-printable for any text body that is not short ASCII, and cannot write the 8bit body arch §5.1 shows | arch §5.1 (UTF-8 plain text body), BATCH-002 (the index gives a path that can be read) and AV10's reading of it (a reader meets a message as its sender wrote it) | the read tool shows the stored header block unchanged and the body with its transfer encoding undone; an encoding it cannot undo exactly leaves the message as stored. The stored bytes are not changed. Bound to the runtime's own writer by a test over both encodings | a stored encoding shown to a reader as the message | AV23 (two tests) |
| AV24 | the seventh functional run: a Resident ran its tests and then `sleep 31` in one bash call; the command printed nothing for 30 s, the adapter read the engine as idle, and the run ended DEADLINE_EXCEEDED inside the tool. Builds, installs and test suites have that shape | WP10's deadline table ("정상 긴 턴/진짜 idle" told apart; idle is the partial-line/stream stall) and CFG-004 (frame/stream no-progress), with the turn budget (inferenceTimeoutSeconds) bounding the whole turn | the idle budget is held while a tool the engine announced (`tool_execution_start` .. `tool_execution_end`, by `toolCallId`) runs, and resumes when none does; a tool that never ends meets the turn budget | an announced tool's silence read as the engine's | AV24 (two tests; V10A unchanged) |
| AV25 | same run: a Resident's edit of a 35 KB workspace was refused "agent workspace quota would be exceeded" under a 2 GiB quota. Since the engine update (ENG1) the edit tool takes `edits: [{ oldText, newText }]`, and the workspace guard read the older top-level `newText`, so every edit by every agent was refused | BATCH-006 (the pinned engine revision is the contract the extension speaks) and TSP-009 (the guard keeps writes in the workspace and quota; it does not reinterpret a tool) | the guard reads the engine's validated input -- the engine folds its older single-edit form into `edits` before any tool_call handler sees it -- and bounds growth by the replacement text; a test takes the input from the pinned engine's own edit tool | a guard mirroring an input shape the engine no longer sends | AV25 (one test) |
| AV26 | the eighth functional run, on the Human's side: the Mail screen listed "재시작 후 OMA 결과 기 억 확인" for a subject without that space, and its body view was empty for every message. The TUI had its own header decoder, which kept the fold's space between adjacent encoded words, and found the end of the header block at "\n\n", which the writer's CRLF mail never has; its body, had it been found, kept its transfer encoding | INV04 (one owner of how a reader meets a stored message), arch §5.1 and TUI-011 (the Mail screen reads the Principal's mail), and the reader rule AV10 and AV23 apply | `src/mail/display.ts` owns `readableMail`/`readableBody` (the eml reader in headers.ts still never decodes a body); the Mail screen splits at the first blank line in either form, shows each header through `displaySubject` and the body through `readableBody`; the extension's AV23 copy is a declared mirror bound to the owner by a test (PI-001) | a second decoder, and a boundary only older mail has | AV26 (two tests) |
| AV27 | the ninth functional run, with `code.integrate` delegated by the host (A-002): a Resident told by a submit mail to `git fetch origin <published-ref>` got "does not appear to be a git repository". The workspace is cloned on the host from the host path, so its `origin` named a path the sandbox does not have | GIT-002 (the Resident's clone is from `/git/project.git`, and peer fetch is `fetch origin <published-ref>`) and SB-002-C (a host path reaches a Resident only through the mount table) | the workspace preparation sets `origin` to the canonical repository as the Resident reaches it, before the workspace is published and while only trusted preparation has touched it; the base still comes from the host path. Whether Residents are sealed has one reading, `residentsConfined` in sandbox.ts, used by the runner and the broker alike. A workspace already published keeps its origin: the trusted side does not write into a tree the model owns (FS-005) | a path handed to the model in the host's view | AV27 (two tests) |
| AV28 | same run: an integrate on a main that had moved answered `STALE_BASE: STALE_BASE` and nothing else. The error table returns the actual OID for STALE_BASE and NOT_DESCENDANT, arch §11 says the same, and CTX-003 gives CONTEXT_CONFLICT its actual revision; the failure's `details` (already in the closed Failure shape) was never filled | ERR-001's table and CTX-003; `publicFailure` still sanitizes everything else | a `StoreError` may carry the value a conflict found (`actual`); `publicFailure` returns it as `details.actual` for those three codes and no other; STALE_BASE and CONTEXT_CONFLICT, which are refused before acceptance, carry it; the CLI shows it. NOT_DESCENDANT is only reached after acceptance, on the base the caller named, so it has no other value to return | a documented return value that was never returned | AV28 (three tests) |
| AV29 | same run: the Principal's second context publication was refused "unsupported context directory .local". Its workspace is the CLI's home (FS-003), so the CLI's private request cache is there from the first call on; the first publication of the workspace worked only because no CLI call had run yet | FS-003 (the scratch holds the CLI's private state) and CTX-002 (a context tree is the closed set of context files); INV09 (a value is checked in its slot) | the Principal's publish tool refuses the workspace itself, every time, and says to publish a directory holding only the context files; the tool's description says the same | a refusal that depended on whether a CLI call had happened | AV29 (one test) |
| AV30 | same run: a status call naming `principal@provtest.oma.invalid` was refused as not an agent. That call names the Principal, whose status the wire grammar refuses in any form, but the same slot refused a Resident's address too: AV15 took the displayed names in the mail tools only | AV15's rule (a tool takes the names OMA shows) for every slot that names an existing actor | `actorNameOf` in the extension maps this society's actor address to the actor for status, lifecycle and logs; creation, which names a new actor, keeps its own check | one reading of names in two places | AV30 (with AV29's test) |
| AV31 | the twelfth functional run quit the product's `oma` while two Residents were inside a 90 s tool call. The broker was gone within a second and both Residents ran on with no broker; when their turns ended their runners failed until systemd's start limit stopped them. `oma` was the terminal session's leader, and its exit hung up the terminal: the broker, in its process group and handling SIGTERM and SIGINT only, died of SIGHUP in the middle of the drain the SIGTERM had started. A user closing the terminal window does the same | D03 (a product-owned broker's host loss must still revoke, quiesce the Residents and fence the next start) and LIFE-006 | `stopOnHostLoss` in broker-lifetime.ts owns the signals by which a host goes away (SIGTERM, SIGINT, SIGHUP; DR17 made it every catchable termination signal, SIGQUIT too, for every process with a drain), each ending the broker through the one drain; the entrypoint registers it before anything slow. The supervision channel's close already took the same path | a host-loss path that skipped the drain | AV31 (two tests) |


Design revisions DR1–DR7 (after AV31, at the user's request) are recorded in
`design-revisions.md`: the decisions behind AV10/AV17/AV27 (paths in the model's
view), AV20 (the periodic sweep), AV22/AV28 (what a failure may say), the
integrate delegation, AV23/AV26 (the stored mail format), redelivery, and AV31
(the broker's lifetime), with the clauses each one changes. DR8 (the integration
fact and the host's current revision) followed. DR9–DR13 come from the Priority 0
audit (`../PRIORITY-0.md`, `priority-0-audit.md`): delivery attempts, pre-acceptance
artifacts after a crash, session-entry durability before a receipt, one
configuration commit owner, and one reading of an unknown.

Corrections made while applying the invariants rather than per-card rules:
AV3 first kept the Principal's CLI home in `principal/private` while moving only
the workspace, which put the request cache outside the private scratch FS-003
names; the home is now the scratch, and the directories kept out of the model's
reach are the ones PR-003/PR-004 name (session history, engine credentials).
AV4 first keyed on "incarnation 0" as a proxy; INV03 keys on the recorded fact,
the agent having left `provisioning`. AV2's rule is the spec's INF-005 sentence
narrowed by INF-007; that sentence now says so (INV12). architecture.md is not
changed: N-001 binds its reviewed bytes, and its "header and request path only"
already contains the narrower slots. AV1's rule is CLI-001's grammar with one parser for it.

Found by the sixth functional run and left as they are, because the plan intends
them: an unknown `agent.start`/`agent.stop` whose intent a later operation
replaced stays unknown and is listed in later stop receipts (the
`previousIncarnation` row above: "otherwise the operation is `unknown`, never
rewritten"); a stop that cannot prove death while the unit is restarting is
unknown (LIFE-003); the Principal has no integrate tool (AUTH-001); a Resident's
first commit needs a Git identity it sets itself, because the sandbox
environment is SB-002's closed list and commit author provenance is S-08's;
`/inbox.md` does not exist before the first batch; a Principal receives mail
at its turn boundary (PR-003, TUI-004); the failure message is the code
(`publicFailure` sanitizes).

Found by the ninth run and left as they are: the host has no ripgrep, and a
sealed Resident's programs are the host's (SB-007), so `rg` is absent in the
sandbox too; the Principal has no integrate tool, because the plan's integrator
is a Resident the host delegated `code.integrate` to (A-002), and with that
delegation a Resident integrated a submitted candidate and main moved; the
Principal's own status is refused by the wire grammar.

Residuals: a WebSocket frame header inside the key's bytes would hide it from the
byte tripwire (with compression refused, the provider would have to fragment its
own echo there); the quarantine's shell script names its mount targets by path
inside its private mount namespace. After AV6, a live authority the broker could
not observe (a unit observation that is unknown, or a peer liveness still
unanswered after the bounded retry) is refused, as INV06 requires, but reported
as CAPABILITY_DENIED rather than as unavailable. Reporting it as unavailable
would change how an accepted operation settles (failed becomes unknown), which
is authority and settlement semantics this plan fixed; it is left as it is and
stated here. After AV7, a journal that stays unreadable keeps every generation,
so a society at its edit budget refuses edits with LIMIT_EXCEEDED although a
restart will not collect; two consecutive lost journal records could still lose
the previous generation -- closed by P0V-61, which records each commit, with the
generation it replaced, before the commit point. The first is the price of not
deleting on an unknown.

### The pass's own evidence

Mutants (one minimal reversion of each fix, on the disposable account): 50 in
all, 49 fail their regression. The survivor is equivalent by construction: with
AV1's slot validation, addresses placed before rather than after `--` reach the
same CLI parse. Results that were corrected rather than accepted: the first AV4
session trap fired on the directory's own `realpath` (a check-then-open reader
then refused by accident) and one AV4 mutant did not compile; after AV3 and AV4
were re-aligned to FS-003/PR-004 and INV03, their six mutants were rerun
(scope check removed, engine credentials not kept, the CLI home outside the
scratch, the old workspace, readiness re-derived, a settled workspace walked)
and all fail. The AV5 path-taking reversions are killed by the rule running
against the real tree, not by the architecture gate's stale-LOC check. Not
covered by a unit regression, stated: `CreateCoordinator` passing the recorded
fact to `WorkspaceCoordinator.ensure` (the kernel-lane create recovery runs it).
AV6's seven mutants (an interrupted poll read as an exit, not asked again or
asked without bound, POLLNVAL read as an exit, an unreadable /proc read as an
ended engine or every /proc failure as an exit, a session retired on an engine
that could not be observed) all fail. Its end-to-end evidence is the loaded
rerun of the kernel test that found it: before the fix one failure in about
20 runs under full CPU load, with the EINTR caught at the refusal; after it,
60 of 60 runs of the same loaded loop pass (`/home/dev/oma-evidence/v11/eintr-*.log`).
At the earlier rate 60 passes could still occur by chance (about 5 to 30 in
100), so the loop is supporting evidence; the cause caught in the act and the
seven killed mutants are the primary evidence. AV7's nine mutants (the lost
record not written back, an unreadable journal as an empty history, a vouched
journal keeping only the current, an unrecorded generation removed, an
unreadable generation as other bytes, an unseen storage root as 0, an
unlistable mailbox as empty or as 0 waiting, the Mail screen silent about it)
all fail, and so do AV8's four (the named file followed through a link, a file
that is not regular read, one larger than the frame read, the reply source read
outside the owner). AV9-AV11's nine (LoadState ignored, a missing unit shown
without saying so, the encoded subject in a notice, `/inbox.md` not resolved,
the Principal's tools not registered, an agent name, a context directory outside
the workspace, the default base resolved elsewhere, a lifecycle action -- each
unchecked) all fail.

Review ledger: every production file has now been read in full; files a change
touched carry that change's regressions, files read and left unchanged carry the
tests whose loaded module closure contains them (`review-notes.json`, `by:
AV-review`). NOT_REVIEWED is 0. The verdict is still not approved: power loss,
a real provider and CI have not run, and each needs the user.

## ENG1 -- engine upgrade 0.85.1 -> 0.87.1 (asked for by the user, 2026-09-25)

The user asked for the bundled engine to be updated so that the functional run with a
real provider can use GPT-6 Luna, which 0.85.1 does not know. WP31 keeps a
dependency upgrade out of every card and asks for it as its own review, risk and test
item; WP27 asks that the exact locked version be mapped to what OMA uses from it. This
section is that item.

Review (the 0.86.0-0.87.1 changelog against the WP27.01 inventory). OMA's extension
listens to `tool_call`, `session_start`, `message_end` and `agent_settled`, registers
tools and commands, and sends custom messages with `triggerTurn`/`deliverAs`; the
runner uses `ModelRuntime`, `ModelRegistry.getApiKeyAndHeaders` and `SettingsManager`.
- 0.87.0 defers a run requested from an `agent_settled` handler until every settled
  handler has finished: the delivery extension starts its turn from there; V27A
  delivers a batch to a recorded boundary on 0.87.1.
- 0.87.0 extends `TurnEndEvent`, adds `AgentBeforeSettleEvent` and the session entry
  `context_edit`: OMA constructs no engine event, switches exhaustively on none, and
  reads no session entry but its own custom entries.
- 0.86.0 routes RPC `steer`/`follow_up` through extension `input` handlers: OMA
  registers none.
- 0.86.0 changes custom provider stream inputs and limits tool-result `details` to
  JSON values: OMA defines no provider, and its `details` are JSON.
- 0.86.0 adds prompt-cache warming, `streaming` by default: an engine may make extra
  provider requests during a long run. For a Resident they go through the relay like
  any other request. Inference cost is the engine's (INF-001); OMA does not change the
  engine's setting and says so here.

Changed. `package.json`/`package-lock.json` lock `pi-coding-agent` and `pi-tui` 0.87.1;
the engine's own shrinkwrap now nests `pi-ai` and `pi-agent-core` 0.87.1 under it.
`typebox` follows the engine (1.3.27), by the rule that set 1.3.7 before: 0.85.1
depended on exactly 1.3.7, so the schemas OMA's tools declare are read by the same
library the engine validates them with. `PI_ADAPTER_REVISION` is
`oma-pi-rpc-v1@0.87.1` in both places that state it, and BATCH-006 pins that value: a
receipt names the engine its adapter was verified against (INV12), so keeping
`@0.85.1` would have claimed a verification that 0.87.1 did not have. The BATCH-006
trace row is re-inventoried and so unverified until its evidence is bound again.

Evidence on 0.87.1: V27A (bundled engine, production plan, batch to a recorded
boundary), T116 (credential resolved from OMA's agent directory; the real key reaches
the provider from a placeholder), T117 (a confined Resident reaches its provider only
through the relay), V31A/V31B and the package check (the installation runs its own
engine; the lock is what is installed), the whole local suite.

Stated, not changed. A receipt the 0.85.1 adapter wrote for a batch not yet settled is
`conflicting` after the upgrade (V08B: neither delivered again nor completed; the
evidence is kept): an existing society is upgraded only after every prepared batch
has settled. BATCH-006 still admits one revision; admitting the earlier one too would
change receipt semantics the plan fixed. Separately, `implementation/traceability.json`
already differed from the spec for clauses this change does not touch (N-001, CFG-005
and others); re-inventorying them would reset their review state, so only the
BATCH-006 row was replaced and the rest is left as it was found.

### 2026-09-30 — DR26 installation failure and observation sweep

- TUI-010/WP14 + D02 → shared `storage/file-digest.ts`, configuration loader and generation writer → 6/12 MiB package regressions, tamper at spawn and stale commit → isolated mutants KILLED (see validation DR26 evidence).
- INV02 → `tui/project-settings.ts` application result shared by Linux/macOS → corrupt-settings failure, no activation claim, explicit retry, update preserving disabled roles → isolated mutants KILLED (see validation DR26 evidence).
- INV02 → `runtime/pi-packages.ts` index reader and `tui/sources/extensions.ts` partial observation → malformed index and partial-list regressions → isolated mutants KILLED (see validation DR26 evidence).
- Transport completeness/closed input → `platform/package-archive.ts` → streaming writes, strict UTF-8 and executable flag regressions → isolated mutants KILLED (see validation DR26 evidence).

These extend existing owners/principles, not new per-defect principles. Repository-wide review is not yet complete.

- P0V-51 → a valid Principal-only project remains installable; activation names only roles present → regression PASS, `principal-only` mutant KILLED.
- P0V-119/IPC-005 → guest request hashing retains its legacy encoder for persisted explicit-undefined fields and shares `JSON_NESTING_LIMIT`, rejecting excess nesting before publication → regression PASS, `ledger-depth` mutant KILLED.
- CFG-001/TUI-007 → numeric editing uses the safe-integer domain, not a nine-digit/4096 cap; Worker quota accepts zero subject to normal configuration validation → regression PASS, `number-digits` mutant KILLED. Bootstrap population construction bounds remain under review.
## ENG2 -- engine upgrade 0.87.1 -> 1.0.1 + pi-tui 1.0.1 + pi-open-tui 0.3.11 (2026-10-05)

Pre-requisite work item A of `docs/plan-prereq-and-bundled.md`: later v0.1 work needs
1.0-only APIs (`registerToolRenderer`, `ToolExposure`) and pi-open-tui 0.3.11 peers
`>=1.0.0`, so the three pins moved atomically rather than risking a dual pi-tui
install. `npm ls @earendil-works/pi-tui` resolves one top-level 1.0.1; the engine
package no longer vendors a nested engine closure (its nested `node_modules` now
holds only third-party packages), so `pi-ai`/`pi-agent-core` dedupe to top-level
1.0.3 under their `^1.0.1` ranges.

Review (actual 0.87.1↔1.0.1 and 0.3.9↔0.3.11 npm tarballs, plus the installed
dist). Two contract ports and one regression test:
- RPC `prompt`: `preflightResult` now reports the `PromptDisposition`
  (`handled`/`queued`/`started`) and the success response carries
  `data.disposition`, the same shape the engine's own `--mode rpc` writes. OMA
  treats every disposition as acceptance (rejection is still the prompt promise
  rejecting) and its `accepted` fence keeps a later failure from sending a second
  answer. OMA admission semantics are unchanged -- consumers read only `success`.
- `quietStartup` widened to `boolean | "header"`: the settings bridge now passes
  the `"header"` literal through instead of flattening it to `true`, held by a new
  A4 regression.
- pi-open-tui 0.3.11 deletes `fullscreen-scroll.ts` and its `fullscreen` config:
  wheel scroll is owned by Pi's `fullscreenWheelScrollLines` setting and pi-tui's
  `TuiAltScreen.setWheelScrollLines`, which OMA never shimmed. `unicode` icon mode
  and the footer status sanitizer that preserves SGR are additive for OMA (plain
  statuses only). `header.ts`/`peek.ts`/`state.ts`/`runtime.ts` are byte-identical,
  so the brandHeader/brandFooter anchors and the thinkingPeek tree-walk stand.
- The twelve pinned `InteractiveMode` private members all exist on the 1.0.1
  prototype; the removed `handleDaxnuts`/`checkDaxnutsEasterEgg` were never in
  OMA's list. The builtin-command mirror, selector constructors, SessionManager
  statics and the ToolDefinition render contract typecheck unchanged.

`PI_ADAPTER_REVISION` is `oma-pi-rpc-v1@1.0.1` in both places that state it, and
BATCH-006 pins that value (INV12; ENG1's rule). `implementation/traceability.json`'s
BATCH-006 row was re-inventoried with the new normative text; the rest is left as it
was found, per ENG1.

Evidence on 1.0.1: the pi-compat oracles read the installed package (strip list,
resume hint, private members); interactive-input holds the builtin-command mirror;
open-tui-pty and personal-pty drive the real 1.0.1 InteractiveMode through /new,
/resume, /fork, /reload, kill, retry and restoration; the local suite passes in
full. systemd-required files, powercut, provider, CI and the macOS lanes are
NOT_RUN as before -- see `docs/implementation/validation.md`.

Stated, not changed. A receipt the 0.87.1 adapter wrote for a batch not yet settled
is `conflicting` after the upgrade, exactly as ENG1 recorded for 0.85.1: an existing
society upgrades only after every prepared batch has settled. The `fullscreen` key
an old open-tui.json may still carry is inert under 0.3.11.
