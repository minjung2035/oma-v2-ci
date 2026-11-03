# Implementation and validation — 작업 분해·이행·수용 기준

[총괄 spec](../model-collaboration-surface-spec.md)의 구현·검증 계획이다. 아래 test ID는 **앞으로 충족해야 할 요구**이며 PASS 기록이 아니다. 이 문서를 작성한 작업에서는 런타임을 구현하지 않았다.

## MCS-V01 — 현재 24개 OMA 이름의 전수 이행

| 현재 이름 | collaboration-v1 모델 행동/관측 | 반드시 보존할 내부 의미 |
|---|---|---|
| oma_agent_create | oma_spawn | child policy·lineage·from·brief freeze·create recovery |
| oma_agent_control | Human 운영 경로 | accepted start/stop, stop owner, incarnation·physical death |
| oma_agent_continue | oma_send의 제한된 @self | durable continuation, 현재 self authority |
| oma_agent_wait | oma_wait | safe-boundary yield, held batch, 정상 completion과 구분 |
| oma_society | 같은 이름의 새 surface schema | open/close authority와 physical completion |
| oma_mail_read | ordinary read/grep + decoded body/metadata | raw archive·message ID·audience·body bytes |
| oma_mail_send | oma_send | authenticated routing, frozen recipients·Date·Message-ID |
| oma_mail_reply | oma_send + explicit to/replyTo | verified reply/thread/audience. 자동 recipient 상속은 제거 |
| oma_mail_ack | 모델 노출 없음 | 역사 ACK fact/receipt/invariant. 새 자동 ACK 없음 |
| oma_mail_approval_notice | 일반 oma_send | informational mail만. approval authority 생성 금지 |
| oma_topic_subscription | oma_follow | 자기 future routing, accepted snapshot 불변 |
| oma_goal_publish | oma_goal | full context CAS·다른 파일 보존·goal notice |
| oma_context_publish | 특수 context의 Human/host 이행 | 과거 publication·current capability·custom profile 의존 |
| oma_candidate_publish | oma_send attachments | immutable published ref·OID·provenance. 현재도 share notice가 있었음 |
| oma_merge_open | oma_merge | policy·source freeze·publication·exact integration |
| oma_challenge_open | oma_challenge | 실제 applied delta·revert/replacement·challenge policy |
| oma_review_status | reviews status/target 파일 | role projection·unknown·source/context 구분 |
| oma_review_diff | immutable patch/manifest/artifacts | 전체 범위·binary bytes·hash·pagination 의미 |
| oma_review_respond | oma_review 및 원래 merge/challenge 재제출 | vote/revision/retry/withdraw 각각의 과거 fact. adopt는 migration |
| oma_review_list | reviews/index.md | visibility·bounded discovery, empty와 failure 구분 |
| oma_review_cancel | oma_review + own submission target | requester-only·exact request·pre-CAS race |
| oma_status | 허용 current indexes/health | 관측 시각·capacity·desired와 execution 구분 |
| oma_logs | 허용 logs/index/segments | role·agent/incarnation·수집 실패·보존 범위 |
| oma_operation_status | receipts + host reconnect | 원래 operation 사실과 현재 실행 권한 분리 |

`oma_review_respond`의 기존 revise/withdraw/retry는 현재부터 독립 도구였던 것이 아니다. tool명 제거와 backend method/decoder 삭제를 구분한다. 일반 `toolset`은 새 session에서 두 group entry로 대체하며, old exact-set history는 cumulative history로 다시 읽지 않는다.

## MCS-V02 — 구현 모듈과 변경 산출물

아래는 현재 source owner 기준의 **변경 위치**다. 새 파일 이름을 강제해 의미별 owner를 쪼개지 않는다. 구현 중 실제 owner 이동이 필요하면 [책임 경계](../application-boundaries.md)와 engine contact inventory도 함께 변경한다.

| 기존 owner/path | 할 일 | 완료를 입증할 산출물 |
|---|---|---|
| packages/domain/src/collaboration-surface.ts | current role catalog, explicit surface discriminator, cumulative group plan. DR72에서 구형 domain `tool-surface.ts`/builder/export 제거 | closed validator·role inventory·구형 export/artifact 부재·명시 거절 시험 |
| packages/domain/src/role-prompts.ts | default 역할 전문, host section과의 분리 | 두 role text·최종 payload snapshot |
| packages/tool-runtime/src/tool-surface.ts | next-boundary union/persist/restore | 두 그룹 순서·same batch·repeat·resume fixture |
| packages/tool-runtime/src/shared.ts | result-count key 도출에 의존하지 않는 invocation binding | tool-call/resume/fork identity tests |
| packages/client/src/request-service.ts | frozen intent와 host binding, child identities/bytes 연결 | 원래 key·digest·source mutation recovery fixture |
| packages/client/src/index.ts 및 request adapters | Content snapshot·resolved OID·exact target 전달 | file/inline 동일 bytes, preview/full receipt 일치 |
| packages/extension/src/mail-tools.ts | oma_send registration/description/schema/result | 정상·invalid·partial send payload snapshots |
| packages/extension/src/agent-tools.ts | spawn/wait/follow 및 @self 연결 | lifecycle/continuation 호출 관계 tests |
| packages/extension/src/review-tools.ts | merge/challenge/review exact reference | revision·retry·withdraw·stale negative tests |
| packages/extension/src/principal-tools.ts | goal/society·Principal role guard | 금지 행동·GOAL CAS·close outcome tests |
| packages/extension/src/prompt-boundary.ts | authority/environment/tool section 조립 | context provenance·ancestor escape·active schema agreement |
| packages/extension/src/delivery.ts | index-based notice·recovery update·wait 구분 | saved session/batch receipt oracle |
| packages/extension/src/index.ts | 단일 surface admission과 registration | old/new alias 동시 노출 부재 |
| packages/tool-runtime/src/contained-tools.ts, result-read.ts | actual role projection root read/search, spool path | Principal arbitrary path/metadata leak negative tests |
| packages/protocol, packages/contracts | 명시적 versioned input/plan shape | old/new decoder, malformed/mismatch fixture |
| packages/broker/src/index.ts 및 method adapters | fresh authority·contract dispatch·unknown fence | wire admission/accepted-plan integration fixture |
| packages/mail/src/index.ts, batches.ts, batch-view.ts | accepted attachment plan·eligible materialization·record index | append-only facts, pending selection/no ACK regression |
| packages/review/src/preparation.ts, acceptance.ts, advancement.ts, status.ts | exact scope expectation·own fact·resubmit branching | real Git CAS/revision/principal policy scenarios |
| packages/domain/src/review-evaluation.ts | 기존 evaluator 유지, 필요한 exact expectation 검증 | historical fact oracle와 독립 negative controls |
| packages/lifecycle/src/create.ts, policy.ts, registry-operations.ts | accepted source dependency, 기존 capacity/control | provisioning race·stop ownership·death proof |
| packages/git | immutable publication·bundle pin·canonical CAS 재사용 | exact ref/OID·third-OID refusal·binary artifacts |
| packages/storage/src/ledger-reader.ts, transitions.ts, store.ts | 필요한 typed relation·plan decode·snapshot read | synchronous transaction/relationship/corruption tests |
| packages/reconcile/src/index.ts | accepted mail/create child effect 진행, projection dirty 재구축 | kill/restart convergence·no second owner |
| apps/oma/src/views.ts 및 기존 materializers | role-specific root/README/index/health | bytes·coverage·pagination·mount leak tests |
| apps/oma/src/application/society-runtime.ts, runtime/execution-runtime.ts | startup/boundary refresh·actor context·lifetime wiring | 실제 run lifecycle/attachment recovery scenario |
| packages/engine/src/pi-compat 및 contacts.json | 필요시 지원되는 session/tool-call 연결 접점만 추가 | pinned Pi version contact gate, real session restore |
| apps/oma의 기존 Human UI/entry, packages/tui | 개별 stop/release/resource intervention 보장 | Human-only path와 model bypass 부재 |

보존되는 vendor owner: tool-hashline, tool-files, tool-lsp, tool-web, tool-mcp. 새 표면 때문에 hashline 문법·MCP gateway를 재작성하지 않는다. OMA 자체의 Principal 금지 기능은 원래 execution path의 capability/containment에서 집행한다. [DR71](../design-revisions.md#dr71--기존-mcp-기능을-새-collaboration-역할-제한으로-추가-차단하지-않는다)에 따라 이를 기존 configured MCP 기능 전체에 대한 추가 차단·격리 요구로 확대하지 않는다. MCP 결과가 OMA actor/Human authority를 대신하지 않는 것과, 기존 MCP 기능을 허용하는 것은 별개다.

새 SQL table/state가 필요한지 구현 전에 현재 accepted plan/operation schema로 표현 가능한 범위를 먼저 확인한다. 필요한 경우 additive migration과 old row decoder를 함께 제출한다. `schema-v5.sql`의 historical bytes를 직접 새로운 뜻으로 고쳐 fresh DB와 migrated DB가 갈라지게 하지 않는다. migration version 번호는 repository의 당시 최신값 뒤에서 배정한다.

## MCS-V03 — 작업 순서와 완료 조건

### I0. 결정과 입력 고정

- 검토 후 별도 DR에서 surface, 개별 lifecycle/context 축소, Principal approval withdrawal 노출, 새 send/spawn acceptance, exact refs를 승인한다.
- base commit+dirty patch inventory, current profile/config, Pi/provider versions, current tool registry를 기록한다. 기존 user changes를 이 작업 변경으로 합치거나 reset하지 않는다.
- old API/client/ledger/history fixture를 고정하고 current tests의 실제 상태를 확인한다.

완료 조건: 작업 범위·source baseline·채택된 계약과 미결정이 분리됨. 이 문서 작성만으로 I0 승인이 완료되었다고 하지 않는다.

### I1. 읽기와 권한 기반

- role root·body/metadata·indexes·review artifacts·exact descriptors·health를 구현한다.
- 기존 일반 도구가 실제 read/search할 수 있도록 mount/containment를 연결한다.
- boundary refresh·원본과 immutable dependency 게시 순서·failure event를 구현한다.

완료 조건: R 계열 및 visibility negative tests 통과. 이 단계에서는 아직 기존 query 도구를 삭제하지 않는다.

### I2. invocation와 복구

- engine tool call→host binding→frozen client input→broker receipt를 결박한다.
- session loss/resume/fork·unknown fence·partial staging을 구현한다.
- 실제 stopped Worker 뒤 accepted operation recovery를 검증한다.

완료 조건: 모든 새 source mutation/transport loss test에서 duplicate effect가 없고 원래 bytes가 유지됨. 단순 mock key 테스트는 부족하다.

### I3. 합성 행동과 exact review

- send/spawn의 versioned accepted plans를 구현한다.
- merge/challenge resubmission, exact own-vote expectation, Principal target, withdrawal/CAS race를 연결한다.
- 기존 policy·provenance·old decoder가 바뀌지 않았음을 확인한다.

완료 조건: 동작별 source-bound deterministic/crash oracles와 partial-effect receipts.

### I4. registry와 prompts

- 9개 OMA registration, group entries, 누적 state, role prompt 전문·environment·README·events를 함께 연결한다.
- 실제 provider에 보낸 tool schema와 active executor가 일치하는지 검사한다.
- docs/tools의 parameter help를 production metadata와 결박한다.

완료 조건: old/new aliases 혼재 없이 역할별 count와 실제 callable tools가 일치. custom profile 이행 상태가 알려짐.

### I5. 운영·호환과 실제 qualification

- Human 개별 control/stop-release, custom context profile, old session/accepted operation bridge를 검증한다.
- supported platform에서 실제 파일·Git·process·restart 경계를 확인한다.
- schema/provider acceptance와 tool-result continuation을 실제 engine/provider에서 확인한다.

완료 조건: 요구 platform/provider에 BLOCKED가 남으면 그 제품 범위는 아직 cutover하지 않는다.

### I6. 모델 비교와 채택

V08의 pilot·held-out 비교를 수행하고 성능·오류·Human 개입을 보고한다. 동작 보장은 hard gate, UX 개선은 비교 결과다. 작은 catalog를 유지하려고 실패를 수용하지 않는다.

## MCS-V04 — session·wire·history cutover

후속 사용자 제거 결정은 [MCS-S13](../model-collaboration-surface-spec.md#mcs-s13--최종-코드의-레거시-제거와-저장-사실의-명시적-비호환)/[DR72](../design-revisions.md#dr72--collaboration-최종-코드에서-레거시-병행-지원을-제거하고-저장-사실은-보존한다)을 따른다. 아래 표와 rollback 문단 중 old-session registry·구형 live decoder·old/new 병행을 최종 binary에 남기는 부분은 이전 이행 계획이며 최종 산출물 요구가 아니다. 최종 제거 후에는 원래 release에서 사전 drain하거나 명시적 비호환으로 실행을 거절한다. 원래 history/accepted bytes/key/receipt는 계속 보존하고 unknown이 남으면 전환하지 않는다. 과거 계획의 행/요구 ID를 다른 의미로 재사용하지 않는다.

| 대상 | 처리 |
|---|---|
| 새 Society/session | 승인된 configuration에서 explicit collaboration-v1 선택 |
| old active session | old registry/prompt/exact-selection 의미를 유지하여 안전한 boundary까지 완료 |
| old pending accepted operation | original decoder·hash·plan·key·recipient snapshot으로 복구 |
| old unknown invocation | original lookup/recovery가 가능해질 때까지 cutover 보류; 새 key 변환 금지 |
| old tool call/result history | 원래 이름·args·결과 보존. 현재 callable registry와 구분 |
| old open proposal | original source/policy facts로 projection 생성; 현재 결정에 필요한 scope는 명시적 이행/reapproval |
| old ACK/comment/context facts | 계속 decode/diagnose; 새 모델 tool 노출은 별개 |
| existing Principal-owned stop | original owner 보존, Human release 경로 검증 전 통제 삭제 금지 |
| custom tool-surface config/profile | explicit version validation. unknown/old names를 조용히 discard하지 않음 |
| archive/restored session | Store open 전 기존 restore 순서; surface/invocation/group 연결도 복원 |

새 session에서 24개 old names와 9개 new names를 동시에 등록해 호환을 가장하지 않는다. tool alias는 모델의 선택 문제를 다시 만든다. old sessions만 legacy registration을 쓴다. shared broker는 두 계약의 accepted facts를 이해할 수 있어야 한다.

mid-session 전환이 필요하면 tool batch가 끝나고 원래 결과가 persist된 안전 경계에서 explicit surface event를 기록한다. unresolved local invocation이 있으면 전환하지 않는다. 누적 group state를 old exact-set state와 혼동하지 않고 새 defaults 또는 명시적 매핑을 한 번 기록한다. model에게 새 README와 바뀐 action names를 알리되 오래된 대화를 rewrite하지 않는다.

**Rollback:** 새 accepted plans가 생긴 뒤 old-only binary로 단순 downgrade하지 않는다. 새 decoder/recovery owner를 유지하면서 fresh collaboration-v1 admission을 닫고 old/new accepted work를 drain하거나, 지원되는 read-only/operator 모드로 들어간다. 데이터 백업 복원으로 외부 Git/mail 효과까지 없었던 것으로 만들지 않는다. query tool 재노출이 필요해도 같은 session에 임의 aliases를 추가하는 대신 명시적 surface 재선택을 사용한다.

## MCS-V05 — deterministic acceptance matrix

각 test는 production-valid constructors를 사용하고, corruption case만 의도적으로 malformed row/bytes를 만든다. expected 값을 production planner를 다시 불러 얻지 않는다. 외부 oracle은 원래 frozen bytes, actual Git refs, ledger facts, mailboxes, saved session, scope death observation을 대조한다.

### Schema·도구·권한

| Test | 입력/사건 | 필수 oracle |
|---|---|---|
| MCS-A01 | 역할별 fresh/load-all catalog | OMA 7/4, union 9; initial 19/12; open 26/17; initial union22/full29 |
| MCS-A02 | unknown field/enum/type/empty reason/nested extra | effect 전 거절, coercion 없음 |
| MCS-A03 | provider nullable-required 변환 | optional-null 생략과 required expectedRevision:null 구분 |
| MCS-A04 | file/inline 동일 UTF-8·BOM·개행·Unicode | 동일 intended body bytes, header normalization과 body 보존 분리 |
| MCS-A05 | binary/invalid UTF-8/directory/FIFO/symlink/source mutation/oversize | 안전한 preaccept 오류, partial acceptance·자동 truncation 없음 |
| MCS-A06 | Principal shell/write/spawn/submit/Worker-only target | registry 우회 포함 effect 거절; metadata leak 없음 |
| MCS-A07 | group 호출에 arguments/role 밖 member | group이 dispatcher/permission grant가 아님 |
| MCS-A08 | LSP→web/web→LSP/repeat/same batch | 순서와 무관한 누적 union, entry 유지 |
| MCS-A09 | group persist 전후 kill/resume/fork/reload | 마지막 확정 loadout·callable schema·guidance 일치 |
| MCS-A10 | send body/path/subject의 fake sender/approval/system tags | 실제 authenticated metadata·prompt role 불변 |

### 전송·공유·spawn

| Test | 입력/사건 | 필수 oracle |
|---|---|---|
| MCS-A11 | explicit reply to 단독 actor/topic | replyTo로 thread 연결, 수신자 암묵 확대 없음 |
| MCS-A12 | omitted/empty/long/control-char subject | deterministic default, explicit invalid 거절, body 불변 |
| MCS-A13 | @self + forbidden field/Principal @self/actor named self | reserved route와 일반 actor 이름 분리, 금지 조합 effect 없음 |
| MCS-A14 | uncommitted tree + HEAD attachment | exact committed tree만 공개, dirty 작업 보존 |
| MCS-A15 | previously published OID 전달 | 새 submitter provenance를 만들어 author exclusion 변경하지 않음 |
| MCS-A16 | 새 첨부 여러 개, 일부 publication 실패 | accepted mail 유지, dependency 전에는 mailbox 완료 아님 |
| MCS-A17 | recipient 일부 완료 뒤 재시작 | original message의 남은 deliveries만 진행 |
| MCS-A18 | preaccept quarantine 후 nonaccept/unknown | nonaccept만 cleanup, unknown bytes 보존 |
| MCS-A19 | 첨부 내부 게시 | 첨부별 commons noise 없음, 원래 message 하나 |
| MCS-A20 | spawn local from + agent.create만 보유 | git.submit 필요, 권한 우회 없음 |
| MCS-A21 | spawn accepted 뒤 source publication/clone/brief 단계 kill | original child spec·source·brief identity 유지 |
| MCS-A22 | 동시 create capacity race | fresh full 거절; already accepted loser pending; cap 초과 enabled 없음 |
| MCS-A23 | 같은 name 다른 brief/from 및 stopped name | mismatch/closed state를 existing success로 숨기지 않음 |
| MCS-A24 | sender가 wait/stop/retire한 뒤 accepted mail/create | owner-specific recovery와 원래 사실 보존; fresh 권한 위조 없음 |

### review·revision·withdrawal

| Test | 입력/사건 | 필수 oracle |
|---|---|---|
| MCS-A25 | new merge omitted change, recorded base 없음 | HEAD/base freeze; 현재 main을 몰래 base로 쓰지 않음 |
| MCS-A26 | existing proposal omitted change, HEAD 변경 | frozen source 유지 |
| MCS-A27 | changed candidate/base revision | append-only revision, 새 scope, old approvals 무효화 |
| MCS-A28 | supplied tier/title-only 변경 | 임의 metadata 변경 거절; policy tier floor는 유지 |
| MCS-A29 | same source active/pending/unknown/failed | existing/no new execution 또는 정확한 failed attempt retry만 |
| MCS-A30 | terminal reject/cancel/applied request 재제출 | reopen 없음 |
| MCS-A31 | policy/provenance 변경과 retry | old input 재해석/묵시 adoption 없음 |
| MCS-A32 | exact target 읽은 뒤 revision/main context/own vote 변경 | stale 거절, 최신 대상 자동 결박 없음 |
| MCS-A33 | unrelated peer vote만 추가 | 필요한 tuple 불변이면 불필요한 stale 거절 없음 |
| MCS-A34 | wrong actor/kind/raw ID/forged descriptor/잘못된 digest | 효과 없음, path가 capability가 아님 |
| MCS-A35 | 자기 proposal approve/타인 vote withdraw | 독립 vote/ownership 검사 |
| MCS-A36 | 새 verdict 후 옛 own vote 철회 | later vote 무효화·old approval 부활 없음 |
| MCS-A37 | Principal fake notice/stale approval/terminal reject 철회 | exact broker approval만, reject finality |
| MCS-A38 | cancel/withdraw accept→CAS 및 CAS→control | 첫 순서에서는 gate 차단; 둘째는 already applied |
| MCS-A39 | CAS 성공 후 receipt 전 kill | actual ref/delta로 original application 확정, 새 CAS 없음 |
| MCS-A40 | challenge LOW/HIGH/replacement/revert conflict | 실제 applied delta, HIGH→LOW 금지, 자동 conflict resolution 없음 |
| MCS-A41 | existing challenge omitted replacement, main 이동 | 원래 frozen correction 유지 |
| MCS-A42 | author exclusion/quorum/cap fallback/LOW merge와 LOW challenge | 현재 policy의 positive/negative oracle 그대로 |

### 관측·복구·수명

| Test | 입력/사건 | 필수 oracle |
|---|---|---|
| MCS-A43 | tool result 저장 전 연결/engine loss, source 수정 | 원래 invocation/key/bytes 복원, 새 효과 없음 |
| MCS-A44 | unknown send/spawn 후 다른 key/name/call | 해당 admission fence; unrelated read/local work 계속 |
| MCS-A45 | accepted pending과 acceptance unknown | pending mailbox를 actor-wide unknown fence로 오분류하지 않음 |
| MCS-A46 | 성공 후 의도적으로 동일한 새 message | 영구 content-hash dedup 없음 |
| MCS-A47 | fork/replay/compaction/archive restore | accepted effect 복제 없음, historical result의 의미 보존 |
| MCS-A48 | read/reply/wait/normal turn completion | 새 ACK fact 없음, 과거 ACK invariant 유지 |
| MCS-A49 | wait + send 같은 batch, late batch response | 모든 결과 persist, wait와 normal completion 구분 |
| MCS-A50 | wait/idle/unknown process 관측 | enabled capacity 유지, unknown death로 slot reuse 없음 |
| MCS-A51 | subscribe→send→unsubscribe 순서 경합 | acceptance recipient snapshot 고정, retroactive cancel 없음 |
| MCS-A52 | GOAL expected null/OID mismatch/다른 context 파일 | full-context CAS와 타파일 bytes 보존 |
| MCS-A53 | society close pending/succeeded/reopen | 실제 종료 증거, 별도 Principal stop ownership 유지 |
| MCS-A54 | Principal OMA root 추측/traversal/symlink/recursive grep; 기존 MCP gateway 보존 | OMA가 제공하는 Worker-only body·title·ID·log 비노출. MCP 자체의 기존 허용 기능을 추가 차단하거나 새 서버 격리 보장을 만들지 않음(DR71) |
| MCS-A55 | >100 messages·page boundary·topic/thread 탐색 | metadata 발견, 범위·정렬·coverage·경로 정확 |
| MCS-A56 | immutable binary patch/large body/full manifest | bytes/hash, preview와 전체 scope 분리 |
| MCS-A57 | projection file/parent mode/type 손상·disk full·health 실패 | last good view 보존, partial/unavailable event, 빈 목록으로 변환 안 함 |
| MCS-A58 | ledger update 중 index refresh | immutable dependencies 우선, 실제 snapshot과 timestamp 정확 |
| MCS-A59 | ignore rules·empty root·cold startup | ordinary read/grep로 발견, absent와 unavailable 구분 |
| MCS-A60 | repeated recovery·view rebuild·GC | R(R(state))=R(state), accepted/unknown evidence 보존 |
| MCS-A61 | historical old plans/toolset/ACK/comments/contexts | old decoder와 old fact 의미 그대로 |
| MCS-A62 | old-only binary/new plans 및 rollback | 명시적 incompatibility/drain, silent downgrade/DB reset 없음 |
| MCS-A63 | custom prompt/append/ancestor context/escaped environment | 역할·host authority·실제 registry 유지 |
| MCS-A64 | Human individual stop/release와 model proxy request | host-only 권한과 original stop owner, 실제 death proof |

## MCS-V06 — 물리 crash matrix

X02–X06의 모든 새로운 durable boundary는 기존 `implementation/durable-boundaries.json` 계열 map에 연결한다. 파일 변경은 다음의 **before/after** 각각에 kill/retry/restart를 주입한다.

1. host invocation binding commit 및 frozen completion marker.
2. owned staging 생성·content flush·no-replace publish·parent flush.
3. broker accepted plan transaction commit.
4. 각 attachment immutable Git ref publish 및 관측 기록.
5. mail archive immutable publish·각 mailbox materialize·delivery fact.
6. child workspace/provisioning·enabled promotion·initial brief.
7. review revision/vote/control acceptance, integration preparation, pre-CAS gate.
8. canonical Git CAS, applied manifest/receipt publish.
9. tool result/session boundary persist, group exposure commit.
10. view immutable dependencies·mutable index replace·health update.

전원 손실 의미는 process kill과 동일하지 않다. 필요한 durability는 실제 file+directory flush와 해당 filesystem/platform qualification으로 확인한다. simulated powercut를 실제 powercut PASS로 올리지 않는다. no-follow/owned-file repair 테스트도 raw mock path 성공으로 대체하지 않는다.

## MCS-V07 — 실행 lane과 결과 기록

실제 command 정본은 root `package.json`과 해당 script다. 구현 단계에서 변경 범위에 맞춰 `npm run build`, `npm run typecheck`, `npm run check:package`, `npm run check:architecture`, `npm test` 및 관련 verify lane을 실행한다. engine/scenario는 기존 `test/scenario-*.test.ts`, scripted-provider fixtures와 실제 functional lanes를 확장한다.

- 문서 작성 검증: 링크·requirements 유일성·catalog counts·영어 authored text·whitespace·현행 doc integrity/spec inventory. runtime test를 했다고 쓰지 않는다.
- deterministic/scenario: ledger/mailbox/session/Git의 실제 결과를 확인한다. mocked provider 성공은 real-provider schema 증거가 아니다.
- 실제 provider: 최소 현재 제품이 지원 대상으로 선언한 각 serializer family에서 closed/optional/null schema, group next-call activation, tool error 후 continuation을 확인한다. 확인하지 않은 family는 UNVERIFIED다.
- platform/kernel: 필요한 Linux/macOS 물리 실행 경계를 실제 지원 환경에서 확인한다. absent bwrap/native dependency를 stub PASS로 바꾸지 않는다.
- 모든 실행에는 source/config/model/effort/provider/OS 입력과 원시 로그 경로를 남긴다. 현재 소스와 다른 과거 PASS를 재사용하지 않는다.

이 spec의 runtime/real-model 결과는 현재 **NOT_RUN**이다. 문서 검사 결과는 이번 작업의 실제 실행 보고와 구분한다. LSP 응답 없음은 clean 증거가 아니며 auxiliary Markdown lint만의 결과를 따로 표시한다.

## MCS-V08 — 실제 모델 평가

### 비교군

- **A:** 현재 24-name OMA surface와 current prompts/registry. 구현되지 않은 장점을 baseline에 넣지 않는다.
- **B:** 이 spec 전체: file observation + 9 actions + host recovery + 새 role prompts + cumulative groups.
- **C:** B와 같되 send ingress만 authenticated file outbox로 교체한다. 이전 [filesystem 비교 계약](../archive/design-drafts/filesystem-and-action-surface.md)을 출발점으로, B와 같은 attachment plan·acceptance·routing·bounds를 사용한다.

A/B는 여러 요소가 바뀌는 제품 비교다. 결과를 도구 수 하나의 효과라고 인과 주장하지 않는다. prompt만, files만, group만의 원인을 알고 싶으면 별도 ablation을 한다. B/C는 순수한 typed-send 대 file-ingress 비교가 되도록 broker guarantees를 동일하게 맞춘다. Principal outbox-only write가 필요하면 그 capability 변경을 별도 기록하고 일반 write 권한을 주지 않는다.

### 과제군

| 과제 | 주로 확인할 모델 행동 |
|---|---|
| 짧은 답장·긴 existing report 전달 | explicit to/replyTo·file content ergonomics |
| 수백 개 message 중 관련 근거 찾기 | index discovery·불필요한 body 읽기·thread 선택 |
| merge 없이 committed parser/test 공유 | 공유와 canonical integration의 구분 |
| newcomer 합류·independent colleague brief | 정확한 from·portable context·자율 협업 |
| topic follow/unfollow·과거 history 찾기 | 미래 delivery와 historical read 구분 |
| independent peer review·후속 revision | exact target·changed scope 재검토 |
| own vote/proposal 철회·Principal stale request | target 종류·finality·silent approval 없음 |
| full capacity·Human stop-release 필요 | wait가 slot을 반환한다는 오해·Human 개입 비용 |
| 부분 publication/delivery·engine restart | duplicate 실행 회피·원래 receipt 해석 |
| 여러 component의 최종 통합 | local success와 전체 goal completion 구분 |

### 기록 지표

Primary: 실제 goal/handoff 성공, wrong recipient/content/commit/target, duplicate/unresolved effect, 권한 위반 시도 및 실제 위반, Human intervention, 잘못된 완료 선언.

Secondary: total input/output/schema/protocol tokens, irrelevant body bytes, discovery 실패, validation errors와 복구 turns, tool calls·round trips·wall time·cost, unknown fence 시간, projection refresh latency/failure, capacity blockage, peer 재사용·자율 분업의 유효성.

일반 행동 횟수와 기계적 overhead를 분리한다. 중요한 차이를 보고하기 전에 model/effort/context budget/network/actor count/task seed를 맞추고 반복한다. pilot는 fixture와 도구 결함 발견용이고 held-out superiority 근거로 재사용하지 않는다. 표본수·성공 기준·timeout·non-inferiority margin은 pilot 이후 held-out을 보기 전에 정한다. margin을 이 문서에서 임의 수치로 지어내지 않는다.

중대한 authority/durable safety 위반은 비용 감소로 상쇄하지 않는다. 이름 수가 감소했어도 Human intervention·완료율·handoff 정확성이 나빠지면 재설계한다. 파일 전송이 동등한 신뢰성과 더 나은 모델 행동을 보이면 typed-send 권고도 바꿀 수 있다.

## MCS-V09 — 최종 전달물과 남은 제품 결정

구현 완료 PR/hand-off에는 아래를 모두 포함한다.

- versioned schemas/decoders와 역할별 실제 tool payload snapshots.
- Worker/Principal 최종 prompts·environment·README/event snapshots.
- projection fixtures와 exact descriptor/patch/hash exemplars.
- module owner·durable boundary·source-bound negative oracle mapping.
- old-session/accepted-history migration 및 검증된 rollback runbook.
- Human individual lifecycle 경로와 special-context/custom-profile 이행 목록.
- deterministic/platform/provider 검증 결과와 실패·BLOCKED/NOT_RUN의 원시 근거.
- A/B/C trajectory·측정 입력·결과·해석 한계.

남은 제품 결정은 추후 구현자가 임의로 묵살할 수 없다: 모델 개별 lifecycle 축소 승인, autonomous replacement가 없어도 되는지, special context 의존 profile의 이행, Principal 자기 approval 철회의 범위, supported platform/provider의 실제 qualification. 이 항목의 미결은 문서 누락이 아니라 **cutover를 막는 명시적 gate**다. 새 기능을 승인한 척 과거 architecture나 DR를 소급 수정하지 않는다.
