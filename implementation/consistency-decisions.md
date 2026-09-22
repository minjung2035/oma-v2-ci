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
permitted prompt/extension/toolSurface metadata, never coerce unrelated quotas.

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
supported check profile. Preserve explicit rootfs='/' unconfined mode, no OMA cost
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
| D06.unsupported | unqualified checks/codec/resources remain gated | reject unsupported, preserve rootfs opt-out and no cost cap | WP27, WP31 | V27A, V31B | C0 | INT-007, SB-002-E, INF-001 |
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
| profile.unconfined | explicit rootfs='/' opt-out with visible warning, never silent fallback | actual entry and Dashboard report it; never claim confinement from this profile | NOT_RUN | WP27, WP28, WP31 |
| profile.engine-fixture | provider-free controlled engine/extension execution | actual bundled engine boundary/tool-event semantics; not provider or disk power-loss evidence | NOT_RUN | WP27, WP30 |
| profile.provider | host-chosen real provider through engine-owned authentication | separately authorized credential/cost/environment; no invented credential or cost cap | NOT_RUN | WP27, WP30, WP31 |

WP00's local tools/tests and early kernel/crash BLOCKED/NOT_RUN probes establish
none of these runtime rows. Provider fixtures do not demonstrate actual provider
behavior. Process SIGKILL can test crash reentry but power-loss claims additionally
require a VM/storage experiment against the final source. S-01-CANDIDATE, S-03
steer/concurrency and tiered S-08/S-10 remain intentionally unqualified where the
current product gates them. This plan does not implement those unrelated features.

## WP01.04 — semantic change surfaces, not a universal registry

The paths below identify existing owners to review when implementing the named
WPs; listing a path does not certify its implementation. Public vocabulary,
persistent encodings and effect authority stay independent. C2 config metadata
is host authoring data, not a new operation/message/batch state.

| Surface | Existing owner paths | Allowed semantic input/output change | Must remain unchanged | Owning WP |
|---|---|---|---|---|
| surface.public | src/protocol/methods.ts, implementation/contracts/public-wire.ts, implementation/contracts/internal-wire.ts | add internal action-category metadata to existing method decisions; no new RPC | key rules, method names, strict payload/error/correlation and live authentication | WP21, WP26 |
| surface.durable | src/storage/operation-codec.ts, src/storage/transitions.ts, implementation/contracts/durable.ts, implementation/schema-v1.sql | validated exact evidence selects existing transitions before rollover; ownership scope settles current plans | six entities, user_version=1, state enums, request/spec/receipt bytes; no golden refresh | WP04, WP06, WP07, WP17, WP20, WP24 |
| surface.editor | src/config.ts, src/config/operations.ts, src/tui/sources/settings.ts, src/tui/sources/extensions.ts | pure full validator plus snapshot/source/version and closed edit descriptors; generation writer owns publication | HostConfigV1 keys, role metadata semantics, index-root prompt references, no implicit delegation change | WP11, WP12, WP13, WP14, WP15, WP16 |
| surface.resources | src/domain/resources.ts, src/storage/quota.ts | explicit action policy, bounded reservation transfer and diagnostic snapshot; freeze derivation/budgets in WP22 | resource field vocabulary, integer/size validation, no cost accounting or stale cache authorization | WP21, WP22, WP23 |
| surface.authority | src/broker.ts, src/runtime/principal-delivery.ts, src/tui/session.ts | separate live complete from narrow trusted recovery; single correlated run owner across await | current peer/incarnation checks, single writer, inherited fence and real descendant death | WP03, WP07, WP08, WP09, WP10, WP25 |
| surface.evidence | implementation/source-owners.json, implementation/mutation-owners.json, production-files.txt, scripts/verification-lanes.mjs | update actual owner/caller/test trace when runtime responsibility moves; include new production sources | generated evidence must be recomputed, not hand merged; no static/runtime proof inflation | WP29, WP30, WP31, WP32 |

No wire/DDL/durable codec/type declaration changes are needed by WP01. Existing
`contracts-ownership.test.mjs`, `p2-wire-golden.test.mjs` and request-hash fixtures
are reused rather than regenerating their goldens. New internal observation/claim
types in later WPs require runtime validators and effect-time checks; readonly or
branding alone never supplies authority, linear ownership or filesystem durability.
