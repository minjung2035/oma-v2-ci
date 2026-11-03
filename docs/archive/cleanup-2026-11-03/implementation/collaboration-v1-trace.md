# collaboration-v1 — 요구사항과 실제 증거 연결

실행 결과의 owner는 [validation](validation.md#collaboration-v1--원래-owner-교정과-현재-미완료)이다. 이 표는 [총괄 명세](../model-collaboration-surface-spec.md)와 여섯 companion의 70개 절 및 64개 수용 시나리오를 빠짐없이 추적한다. PARTIAL은 해당 전체 요구의 통과가 아니다. NOT_IMPLEMENTED는 새 계약의 production 경로가 없다는 뜻이며 기존 기능의 부재를 주장하지 않는다. DOCUMENTED는 조사/설계 산출물만을 뜻한다. gate는 승인 기록이 생기기 전까지 열린다.

입력: `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` + 보존된 dirty WIP. 과거 DR64/DR66·old session/history의 사실은 보존한다. live legacy 지원의 후속 부분 제거는 MCS-S13 행을 따른다. cutover하지 않았고 새 source는 NOT_REVIEWED다.

후속 사용자 제거 방침은 [MCS-S13](../model-collaboration-surface-spec.md#mcs-s13--최종-코드의-레거시-제거와-저장-사실의-명시적-비호환)/[DR72](../design-revisions.md#dr72--collaboration-최종-코드에서-레거시-병행-지원을-제거하고-저장-사실은-보존한다)을 따른다. 위의 old-session 보존은 조사 당시 source 설명이며 최종 runtime 호환층 유지 요구가 아니다. 저장된 사실을 보존하면서 live legacy 지원을 제거하는 작업과 명시적 비호환 검증은 아직 미완료다.

## 구현·증거 위치 약어

- **CAT**: `packages/domain/src/collaboration-surface.ts`, `packages/tool-runtime/src/{tool-surface,collaboration-groups}.ts`; 회귀 `packages/tool-runtime/test/collaboration-groups.test.mjs`.
- **PI**: `test/collaboration-groups-engine.test.ts`; pinned Pi 1.2.0 (DR73) + persistent session + loopback HTTP scripted provider. non-group tools는 inert fixture. live provider/broker action 증거가 아니다.
- **TEXT**: `packages/domain/src/collaboration-prompts.ts`, `packages/domain/test/collaboration-prompts.test.mjs`, `packages/extension/src/prompt-boundary.ts`, `packages/extension/test/prompt-boundary.test.mjs`; actual default/custom prompt HTTP oracle은 PI.
- **MAIL**: `packages/mail/src/{records,display,materializer}.ts`, `apps/oma/src/views/{collaboration-mail,collaboration-history}.ts`, `packages/storage/src/{ledger-reader,store-access,store}.ts`; 실제 Store/Mail 및 production prepare/refresh 연결. 실제 mount/kernel·delivery 전체 qualification과 구별한다.
- **RECORDS**: `apps/oma/src/views/collaboration-{state,reviews,review-materials,receipts,logs}.ts`, Git/Review/Lifecycle의 원래 observation ports; GOAL/status·original patch/새 endpoint companion·exact target·optional family/request isolation·T guards. actual source bytes/refs/Store 및 delivery/material publication SIGKILL/fresh-process 재개 회귀이며 physical containment 전체 입증은 아님. 기존 MCP는 DR71대로 보존하며 추가 서버 격리를 새 요구로 두지 않는다.
- **INV**: `apps/oma/src/runtime/{host-invocations,collaboration-sources,invocation-codec}.ts`, `apps/oma/src/request-cache.ts`, broker `invocation-sources.ts`, extension `collaboration-invocations.ts`, Client/RequestService 및 `packages/protocol/src/invocation-*.ts`; 원래 key/protected bytes/receipt/rejection/cache handoff와 Pi reconnect. 실제 Client/RequestService/Unix RPC/native compound-publication 및 obsolete-bundle·caller-repository 없는 continuation은 격리 Linux에서 PASS; full failure/concurrency/platform qualification은 미완료.
- **ACT**: `packages/domain/src/collaboration-{inputs,review,targets}.ts`, extension `collaboration-{tools,help}.ts`, INV, 원래 Mail/Git/Review/Lifecycle owners와 versioned plans. 아홉 tool 등록/API/closed decoding은 전체 product completion이 아니다.
- **HUMAN/OPS**: 기존 Human controls/TUI/PrincipalSession/PiRpc, session birth·launch/child policy·config admission closure·profile compatibility. host-local authority와 actual exit를 보존하되 전체 migration/rollback/native qualification은 미완료다.
- **GATE**: 명세 V03/V09의 별도 DR, lifecycle/context 축소·Principal approval withdrawal·send/spawn acceptance·exact-ref 채택, Human controls/profile migration 및 platform/provider qualification. 명령 실패나 시간이 오래 걸림은 별도 gate가 아니다.

## 70개 요구 절

| 요구 | 현재 구현/증거 또는 남은 owner | 판정 |
|---|---|---|
| MCS-S01 | ACT/INV/RECORDS/CAT/TEXT의 production 연결; 전체 실행·qualification 남음 | PARTIAL |
| MCS-S02 | 실제 모델 비용·완료율·안전 비교 없음 | NOT_RUN |
| MCS-S03 | 원래 owner/accepted bytes 보존 경로와 guarded 회귀; 전체 경계 미완료 | PARTIAL |
| MCS-S04 | share/auto-publication/retry 의미는 spec 구분; ACT/INV 연결의 전체 검증 남음 | PARTIAL |
| MCS-S05 | 아홉 action closed schema·registry·caller/host·원래 owner 연결; 전체 product 완료 아님 | PARTIAL |
| MCS-S06 | CAT/PI 누적 exposure 및 authenticated launch 선택; 전체 provider/restore qualification 남음 | PARTIAL |
| MCS-S07 | RECORDS role fence·ordinary-tool roots·host admission; physical OMA role containment 미완료 | PARTIAL |
| MCS-S08 | ACT one-root publication; native attachment SHA-1/SHA-256 collection/CAS 및 selected create source/workspace/ready/brief actual SIGKILL·sender retirement·두 Store/runtime-owner 재개 통과; 실제 Client before/after acceptance·publication 권한·accepted capacity 경합 통과; full activation/전체 faults 남음 | PARTIAL |
| MCS-S09 | ACT exact targets·source/retry/control gates; 전체 Review race/restart/physical 경로 미완료 | PARTIAL |
| MCS-S10 | HUMAN/OPS host-local 경로; 별도 authority/lifecycle/context 결정과 전체 실행 gate 남음 | GATE |
| MCS-S11 | CAT/TEXT·아홉 action help/schema·vendor metadata; 실제 모델 사용성 비교 남음 | PARTIAL |
| MCS-S12 | I0–I6 qualification·migration·평가 미완료, fresh selected bootstrap closed | GATE |
| MCS-S13 | v2 selector/domain builder·legacy extension 등록·child resolver selector 제거; launch-before-SDK/original birth admission; fresh review adoption 및 old/adopted review의 current advancement·direct version2 integration 생성 제거. original payload/fact/receipt read 분리와 현재 실행 거절은 MCS-AUD-09; MCS-AUD-10의 owned diff 없는 direct fallback·새 notice의 retired reader 안내·obsolete repository port/export도 제거했다. MCS-AUD-11은 stored merge v1/v2의 current 실행 fallback도 제거하고 original pending/unknown·terminal receipts를 보존한다. 전체 old public payload/accepted-plan·Views/profile·운영/drain 전수와 최종 qualification은 남음 | PARTIAL |
| MCS-R01 | MAIL/RECORDS 원래 source와 projection 분리; 전체 family faults/qualification 남음 | PARTIAL |
| MCS-R02 | role roots·read-only mount wiring·ordinary-tool containment; OMA physical/kernel containment 미입증 | PARTIAL |
| MCS-R03 | MAIL exact body/metadata/ancestry·accepted attachment observations; MCS-AUD-12의 16KiB/256KiB current contained read/grep/result-page 및 원래 EML/receipt/delivery 보존. direct tool composition과 actual provider roundtrip을 구분하며 전체 variants/recovery 남음 | PARTIAL |
| MCS-R04 | MAIL bounded history/inbox/topics/threads·dependency-first refresh; full coverage/cost 남음 | PARTIAL |
| MCS-R05 | RECORDS GOAL/peers/subscriptions/logs/creation·safe cadence·unavailable 의미; log bytes/manifest/status/discovery actual SIGKILL 후 source frames 보존; 전체 live/native 남음 | PARTIAL |
| MCS-R06 | original stored patch와 새 endpoint/binary/symlink/gitlink companions·scoped status; 전체 faults/privacy 남음 | PARTIAL |
| MCS-R07 | ACT canonical exact tuple/path/hash·original Review re-derivation; 모든 race/restart 부정 사례 남음 | PARTIAL |
| MCS-R08 | family/request isolation·last-good files·current-link refusal·health notices·diagnostic caught corruption의 original gate·early-T guards; 전체 crash 남음 | PARTIAL |
| MCS-R09 | bounded discovery/ordinary navigation·metadata-only caches; full search/retention/GC qualification 남음 | PARTIAL |
| MCS-R10 | INV canonical receipt와 RECORDS R10 refused 표시·receipt observation/status actual SIGKILL/two fresh child 재개; disappearance/contradiction/concurrency 전체 남음 | PARTIAL |
| MCS-T00 | ACT closed decoding·raw SDK args/normalized effects 분리·Content freeze, effective recipient bound의 schema/pre-invocation 연결; 전체 providers/denials 남음 | PARTIAL |
| MCS-T01 | oma_send freeze/root/Date·accepted attachment 단일 root; actual native SIGKILL/reopen·empty body·no duplicate CAS/submit 통과; all variants 남음 | PARTIAL |
| MCS-T02 | oma_spawn one root/source/spec/brief; actual native CAS/workspace/ready/brief SIGKILL 뒤 same-key receipt·sender retirement/current broker recovery, pre-ingress full capacity 거절; 실제 Client의 acceptance 전/후 source 없는 재개 통과; full activation/variants 남음 | PARTIAL |
| MCS-T03 | oma_merge omitted/existing/exact-retry source와 child linkage; 실제 Host 및 Client/Unix-RPC에서 canonical child 성공 뒤 authority 구분·원래 parent continuation PASS; 전체 variants/qualification 남음 | PARTIAL |
| MCS-T04 | oma_challenge exact applied target·recorded revert/source; conflict/policy/crash 전체 남음 | PARTIAL |
| MCS-T05 | ACT exact target와 실제 Client/RPC의 own-vote stale·freeze/accept race·forged tuple/self-review·Principal reject finality/withdrawal 거절; MCS-AUD-12의 별도4개 native Worker/SDK current LOW/MEDIUM/HIGH CAS·Principal final reject 추가. original SCN-R01–09는 FAIL 조사 상태이며 전체 HIGH/withdrawal/restart qualification 남음 | PARTIAL |
| MCS-T06 | current oma_wait의 native Linux fixture: safe boundary, 실제 bash sibling 결과의 history persistence, no continuation/no ACK와 원래 ACK fact 보존을 wait/restart/delivery 뒤 확인; 전체 오류·old-incarnation·capacity variants 남음 | PARTIAL |
| MCS-T07 | 실제 Client→Mail follow/unfollow의 future-recipient snapshot·기존 delivery/ACK 불변·old replay/Principal 거절; 모든 subscribe/send 경합 남음 | PARTIAL |
| MCS-T08 | 실제 Client→Git/Lifecycle full-context GOAL CAS·BOM/CRLF 다른 문서 보존·stale/null overwrite 거절·원래 notice replay; all faults/conflicts 남음 | PARTIAL |
| MCS-T09 | 실제 Client→Society close의 native scope death·개별 stop ownership·old close replay 불변; product Worker/전체 native qualification 남음 | PARTIAL |
| MCS-T10 | CAT/PI cumulative groups·production role/provenance wiring; real reload/kill/provider 남음 | PARTIAL |
| MCS-T11 | vendor writer/hashline/LSP/web/MCP owner 보존·ordinary roots; DR71의 기존 MCP 기능 보존, 추가 MCP 차단 요구 없음; 전체 native/vendor 회귀 남음 | PARTIAL |
| MCS-T12 | INV canonical outcomes·protected no-effect closure·receipt/cache publication 오류 분리; 모든 interruptions 남음 | PARTIAL |
| MCS-T13 | action schema/help/normalization 및 실제 Pi groups/prompt checkpoint; 전체 action/provider snapshot 남음 | PARTIAL |
| MCS-P01 | full role/authority/environment/tools host assembly·production boundary, DR73의 cold custom-message/resume와 실제 Worker 전달 회귀; 전체 profile qualification 남음 | PARTIAL |
| MCS-P02 | Worker 전문·scope/PI payload·selected launch wiring; live model/전체 activation 남음 | PARTIAL |
| MCS-P03 | Principal 전문·narrow launch/roots·PI payload; 전체 physical activation 미입증 | PARTIAL |
| MCS-P04 | immutable authority/source boundary·escaped host environment·scope restore; full extension/physical 남음 | PARTIAL |
| MCS-P05 | actual host paths/limits/role values 및 ambient root scrub; 모든 native platform 남음 | PARTIAL |
| MCS-P06 | RECORDS README·selected START/Principal pointer delivery·fresh admission closed; delivery JSON/index publication SIGKILL·두 fresh-process 재개에서 exact generation 링크/과거 bytes 불변; 전체 frame/activation 남음 | PARTIAL |
| MCS-P07 | exact inbox generation notice·health change·original recovery guidance; delivery failures 전체 남음 | PARTIAL |
| MCS-P08 | CAT branch/persisted groups·profile compatibility·구형 session birth의 원본 불변 실행 거절; migration/rollback 미완료 | PARTIAL |
| MCS-P09 | unit/actual Pi checkpoint와 role/injection 부정 사례; DR71의 MCP 보존/authority 구분 및 live evaluation 미완료 | PARTIAL |
| MCS-X01 | explicit birth/closed v3/selected guards·versioned publication plans, single current surface parser와 launch-before-SDK/birth-owner admission; standalone broker도 Store/recovery 이전 거절; old payload/plan 전수·drain 남음 | PARTIAL |
| MCS-X02 | INV protected original/date 관계·authenticated lineage·freeze/receipt/cache handoff·post-observation barrier·Pi reconnect·actual Client Unix RPC의 before/after acceptance loss 복구; all crash/fork/compaction 미완료 | PARTIAL |
| MCS-X03 | one Mail root·root/Date/provenance; actual native collection/CAS SIGKILL 뒤 sender retirement에도 원래 bytes/recipient·no ACK/no second submit 유지; full variants 남음 | PARTIAL |
| MCS-X04 | one create plan·source publication before workspace/brief·capacity; actual native recovery 남음 | PARTIAL |
| MCS-X05 | exact Review source/revision/retry 및 original child/parent 분리. MCS-AUD-09의 no-adopt/current original-scope gate와 current-policy fresh proposal/vote/context·host retry race; retired IMP-R19/AUD-01 adoption-positive 의미와 FAIL은 archive에 보존. MCS-AUD-10의 current owned diff/role-scoped full·compact notice discovery 회귀 추가. MCS-AUD-11의 old accepted-plan incompatibility/receipt·same-key·fresh Node component reopen 회귀 추가. 기존 child-success native case FAIL/BLOCKED도 이 교정으로 해소됐다고 보지 않음; 전체 recovery/platform/actual Client 변형은 미완료 | PARTIAL |
| MCS-X06 | original policy·exact target·vote/control/GOAL CAS gates; full concurrent acceptance 남음 | PARTIAL |
| MCS-X07 | original batch/generation·no ACK·Pi-owned continuation/wait; current native Linux/scripted-provider fixture에서 delayed continue/wait/unobserved와 real sibling persistence/restart 확인; live inference·전체 crash/old-incarnation 남음 | PARTIAL |
| MCS-X08 | HUMAN/OPS private host authority·actual exit/reclaim·capacity separation; DR35 private start·records-before-credential·late refresh·Human editor hold의 controlled composition 회귀 통과; 실제 전체 UI·수명/결정 gate 남음 | GATE |
| MCS-X09 | GOAL projection/CAS·Worker special-context profile refusal(새 child resolution/observation의 selector 생략 우회 제거 포함); qualified migration/rollback 남음 | GATE |
| MCS-X10 | persisted group results-before-next-request·branch/provenance/role restore; real provider/reload 남음 | PARTIAL |
| MCS-X11 | incremental/source-free caches·existing cadence·cleanup/actual exit; complete cost/cancel/native 남음 | PARTIAL |
| MCS-V01 | 24 legacy mappings와 old/new owner 연결; full historical/rollback corpus 남음 | PARTIAL |
| MCS-V02 | source owner·trace·generated digests/graph; authored review NOT_REVIEWED | PARTIAL |
| MCS-V03 | baseline만 verified 1/8; I0 gates/I1–I6 완료 아님 | PARTIAL |
| MCS-V04 | immutable legacy/selected birth·launch/birth의 원본 불변 거절; accepted recovery/migration/rollback 전체 남음 | PARTIAL |
| MCS-V05 | 아래 64행과 actual selected regressions; full acceptance PASS 아님 | PARTIAL |
| MCS-V06 | actual EIO/reopen·real child lifecycle faults; source/metadata/receipt/log publication actual SIGKILL/restart, attachment CAS/quarantine collection actual SIGKILL 추가, delivery/material publication SIGKILL·boundary0; mandatory physical crash 미완료 | PARTIAL |
| MCS-V07 | build/typecheck/package/static architecture 및 packed27 authored declaration/installed runtime checkpoint는 validation 참조. 원래 guarded Personal shell FAIL은 native-owned PTY/원래 guard 회귀로 후속 교정했으나 이전 FAIL/TIMEOUT은 보존; whole-local/full verify·physical/native/provider 미완료 | PARTIAL |
| MCS-V08 | pilot·preregistered held-out A/B 및 equally reliable B/C 없음 | NOT_RUN |
| MCS-V09 | action metadata·현재 기록 일부; full runbooks/qualification/evaluation 미완료 | PARTIAL |
| MCS-C01 | commit-pinned public source 조회 기준 | DOCUMENTED |
| MCS-C02 | 관찰한 prompt/tool/exposure source와 adaptation 구분 | DOCUMENTED |
| MCS-C03 | 다른 engine/session/shell/patch/search API를 가져오지 않음 | DOCUMENTED |
| MCS-C04 | 관찰·OMA 판단·미검증 가설 구분; actual comparison은 없음 | DOCUMENTED |

## 64개 수용 시나리오

정확한 입력/필수 oracle은 [수용 matrix](../model-collaboration-surface/validation.md#mcs-v05--deterministic-acceptance-matrix)에 있다. 아래 증거는 전체 시나리오 PASS가 아닌 현재 범위다. 빈 칸 대신 아직 필요한 production 경로를 명시한다.

| Test | 현재 증거 / 다음 구현 경계 | 판정 |
|---|---|---|
| MCS-A01 | CAT/ACT production role registry·PI definitions checkpoint; full action execution 남음 | PARTIAL |
| MCS-A02 | ACT 아홉 closed action schema·runtime decoder·group empty schema; 모든 SDK/provider 입력 남음 | PARTIAL |
| MCS-A03 | ACT optional-null omission·required GOAL null/false 보존 회귀; 전체 provider families 남음 | PARTIAL |
| MCS-A04 | INV bounded Content·MAIL exact UTF-8/BOM/CRLF/body 회귀; all concurrent source mutation 남음 | PARTIAL |
| MCS-A05 | descriptor-relative/no-follow/bounded reads·freeze-before-local 보호; all faults/physical containment 남음 | PARTIAL |
| MCS-A06 | authenticated role/source/capability admission·ordinary roots; physical/kernel OMA role containment 미완료 | PARTIAL |
| MCS-A07 | CAT closed entries·role/provenance fence·production registration; all reload/provider 남음 | PARTIAL |
| MCS-A08 | PI 양방향·same-batch/repeat union과 production vendor composition; live provider 남음 | PARTIAL |
| MCS-A09 | PI persisted order/resume·CAT fork/refusal; 부분 그룹 event를 두 역할의 actual SDK journal reopen에서 거절·원본 보존; actual kill/compaction/reload 전체 남음 | PARTIAL |
| MCS-A10 | caller raw/normalized capture·host frozen metadata validation·TEXT source escaping; full effect chain 남음 | PARTIAL |
| MCS-A11 | INV exact reply record/ID·inherited subject only·explicit recipients; all races/denials 남음 | PARTIAL |
| MCS-A12 | presence-aware subject/body·actual native SIGKILL/reopen에서도 attachment-only empty body·subject-only fallback; all effective bounds 남음 | PARTIAL |
| MCS-A13 | ACT Worker sole @self validation·Principal denial; real equivalent-authority bypass 남음 | PARTIAL |
| MCS-A14 | caller one-time Git spelling/OID resolution·first-OID dedup·dirty work preservation; actual native 전체 남음 | PARTIAL |
| MCS-A15 | original publication provenance·canonical/prior-root relationships; full forwarding/crash oracle 남음 | PARTIAL |
| MCS-A16 | accepted one-root ordered attachments; SHA-1/SHA-256 actual native collection/CAS kill/restart와 원래 단일 publication 통과; multi-source 전체 남음 | PARTIAL |
| MCS-A17 | original recipient snapshot/accepted delivery owner 재사용; partial delivery actual native 미실행 | PARTIAL |
| MCS-A18 | protected originals·private staging/borrowed spool cleanup 분리; actual death/unknown corruption 전체 남음 | PARTIAL |
| MCS-A19 | Mail-root dependency·original bundle/EML 유지·no child submit/notice; actual native CAS kill 후 두 Store 재개 통과; all variants 남음 | PARTIAL |
| MCS-A20 | 실제 SDK→Client→broker/native 생성: agent.create만으로 local publication 거절(git.submit); canonical OID는 publication 없이 단일 create/clone/brief 완료; original child-policy intersection 사용 | PASS (이 scenario 범위; 전체 activation qualification 아님) |
| MCS-A21 | one accepted create/source/spec/brief, actual SIGKILL4지점·두 Store/runtime-owner 재개·frozen bytes/독립 clone/main 보존; full Client/Worker activation 남음 | PARTIAL |
| MCS-A22 | 실제 accepted 두 create/단일 남은 enabled slot 경합; original busy completion 뒤 loser pending·fresh full refusal·Store/runtime 재개 유지; explicit host-capacity 증가 후 재개만 original 완료, no eviction/ACK/activation | PASS (이 scenario 범위; kernel/physical qualification 아님) |
| MCS-A23 | exact name/spec policy·stopped/retired not restart; original creation outcomes 전체 남음 | PARTIAL |
| MCS-A24 | actual native Mail CAS/collection kill→sender retirement→원래 accepted delegation 완료; stale broker tenure/creation 전체 남음 | PARTIAL |
| MCS-A25 | original compound freeze·actual Client/Unix RPC/native canonical publication 성공; missing obsolete bundle/repository 재개와 원래 LOW policy 관계 통과; full variants 남음 | PARTIAL |
| MCS-A26 | existing proposal resolution·frozen source retention·no fresh builder; restart/concurrency 전체 남음 | PARTIAL |
| MCS-A27 | append-only source revision·pending/unknown refusal·original Review invalidation; full race oracle 남음 | PARTIAL |
| MCS-A28 | ACT tier/title presence normalization·original policy floors; all effective policy changes 남음 | PARTIAL |
| MCS-A29 | exact settled failure receipt/source tuple·original retry owner; crash/same-key 실제 경로 전체 남음 | PARTIAL |
| MCS-A30 | terminal/existing resolution·no invented original receipt/revision; all terminal Review cases 남음 | PARTIAL |
| MCS-A31 | original policy/provenance/adoption expectations·canonical re-derivation; complete real acceptance 남음 | PARTIAL |
| MCS-A32 | exact source/context/own-vote tuple·effect-time original checks; all stale/concurrent cases 남음 | PARTIAL |
| MCS-A33 | canonical own-fact/source derivation은 unrelated peer 변경과 분리; all acceptance race oracle 남음 | PARTIAL |
| MCS-A34 | closed target path/kind/digest/relationships·host re-derivation; physical OMA guessed-path 전체 남음 | PARTIAL |
| MCS-A35 | original author/own-vote/withdrawal authority guards; every role/control case 남음 | PARTIAL |
| MCS-A36 | exact previous own-vote 기대·append-only Review facts; later-vote/non-revival 전체 oracle 남음 | PARTIAL |
| MCS-A37 | narrowed Principal status/approval target·original decision owner; authority decision/full finality 남음 | PARTIAL |
| MCS-A38 | outside-T inspect·inside-T exact control/expectation checks; full bidirectional race 남음 | PARTIAL |
| MCS-A39 | exact applied identity·stored original patch/manifest·original CAS owner; crash/native 전체 남음 | PARTIAL |
| MCS-A40 | recorded applied delta/revert/source and policy gates; conflict/tier/native full path 남음 | PARTIAL |
| MCS-A41 | original challenge frozen correction·no mutable reconstruction; settled/pending races 전체 남음 | PARTIAL |
| MCS-A42 | original Review policy/quorum/fallback·scoped status를 재사용; new wrappers 전체 oracle 남음 | PARTIAL |
| MCS-A43 | INV actual SDK identity/protected date/reopen/reconnect·metadata SIGKILL; 격리 Linux의 실제 Client Unix RPC canonical child/metadata-only parent continuation·before/after acceptance reply loss PASS; 전체 crash/fork/compaction 남음 | PARTIAL |
| MCS-A44 | original-key lock·unknown fence·no key escape·competing metadata link의 post-observation barrier; physical crash/concurrency 전체 남음 | PARTIAL |
| MCS-A45 | receipt fact vs replacement order·canonical checks-before-no-effect·protected date 손상과 독립적인 accepted receipt; all disappearances 남음 | PARTIAL |
| MCS-A46 | original invocation identity 대 후속 identical call 분리 회귀; full actual continuation 남음 | PARTIAL |
| MCS-A47 | read-only SDK branch/earliest lineage·group fork state; compaction/archive/physical restore 미완료 | PARTIAL |
| MCS-A48 | MAIL/RECORDS read·refresh·receipt/log projection actual SIGKILL/restart no ACK/presentation; original prepare/delivery preservation; full native 남음 | PARTIAL |
| MCS-A49 | current Pi safe-boundary wait와 실제 sibling history persistence/late observation/restart를 native Linux fixture에서 실행; scripted provider이며 old-incarnation·전체 오류/죽음 variants 남음 | PARTIAL |
| MCS-A50 | enabled capacity와 wait/idle·termination request 대 actual exit 분리; full live capacity/death 남음 | PARTIAL |
| MCS-A51 | original subscription/send acceptance owner 연결; full concurrent recipient-snapshot oracle 남음 | PARTIAL |
| MCS-A52 | bounded GOAL Content·required null/full OID·original full-context CAS; physical faults/all files 남음 | PARTIAL |
| MCS-A53 | original Society action·fresh-admission closure와 execution death 분리; full original stop/restart 남음 | PARTIAL |
| MCS-A54 | OMA role records·ordinary read/search/hashline roots·ambient root scrub; DR71로 기존 MCP 기능 보존/추가 차단 요구 철회 명시; physical/kernel 범위 미입증 | PARTIAL |
| MCS-A55 | MAIL 132-message history/topic/thread·bounded Child navigation; actual production cost/full page headers 남음 | PARTIAL |
| MCS-A56 | RECORDS original stored patch와 new endpoint binary companions·scoped scratch bytes/hash; full materials/fault corpus 남음 | PARTIAL |
| MCS-A57 | real EIO/fresh owner·family/request unavailable·caught diagnostic corruption의 original fence·T-before-identity/cache-hit guards; disk-full/physical 전체 남음 | PARTIAL |
| MCS-A58 | original cadence/live getters·successful stamps/dependency-first discovery; full activation boundary/native 남음 | PARTIAL |
| MCS-A59 | actual root navigation·ordinary selective reads·missing/unavailable semantics; full cold/ignore/search qualification 남음 | PARTIAL |
| MCS-A60 | last-good files/accepted facts·fresh-owner retry; all reconciler/GC/unknown interruptions 남음 | PARTIAL |
| MCS-A61 | legacy birth/v2/plans/receipt supersession 보존; entire historical ACK/context/plan corpus 남음 | PARTIAL |
| MCS-A62 | explicit selected birth·profile incompatibility·closed admission·accepted recovery intent; migration/rollback full path 남음 | PARTIAL |
| MCS-A63 | full default/custom role text·host scope·PI payload·capability incompatibility refusal; qualified profile migration 남음 | PARTIAL |
| MCS-A64 | HUMAN host-local commands/private drafts·real child completion cleanup; delayed Escape/death/reclaim 전체 남음 | PARTIAL |

## 다음 안전 경계

1. ACT/INV의 남은 실제 acceptance·partial effect·same-key recovery를 원래 owners에서 완성한다. native child-success 실패를 mock/skip/약한 oracle로 대체하지 않는다.
2. physical OMA role containment와 전체 delivery/Human 수명을 닫는다. DR71대로 기존 MCP 기능은 보존한다. callback·MCP 결과·metadata·consent·transport close를 OMA/Human authority나 actual death로 해석하지 않는다.
3. 새/이동 durable boundary의 실제 fault/retry/restart 증거·전체 static/package/authored review·operations/migration/rollback을 완료한 뒤 mandatory physical/provider qualification과 I6 실제 A/B/C를 수행한다. fresh selected bootstrap과 미결정 GATE는 유지한다.
4. command failure/abort는 해당 로그/부분 효과를 확인하고 계속한다. `bwrap`·native 환경·provider credentials처럼 실제 빠진 조건은 그 lane만 BLOCKED로 기록하며 다른 작업을 중단하지 않는다.
