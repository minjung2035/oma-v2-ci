# OMA 협업 표면 구현 명세 — collaboration-v1

상태: **상세 spec / 구현 착수(I1 일부) / cutover 미실시 / 실제 모델 비교 미실행**.

이 문서는 사용자의 전체 재설계 명세 작성 요청에 따른 산출물이다. 문서 작성은 구현·cutover 승인이나 기존 DR64/DR66의 폐기를 뜻하지 않는다. 기준 source는 `a47f70af146791370d3b8e68aad88813654eaf12` 위의 현재 dirty worktree다. 작업트리의 기존 수정은 이 spec의 구현으로 계산하지 않는다. [현재 표면](model-tool-surface-spec.md)은 실제 cutover 전까지 현행 계약이다.

사용자의 후속 작업 시작 지시에 따라 읽기 전용 mail records의 첫 구현을 착수했다. 현재 연결·검증 범위와 미완료는 [구현 진행과 검증](implementation/validation.md#collaboration-v1--mail-records-첫-구현)을 따른다. 기존 session/tool surface는 전환하지 않았다.

`collaboration-v1`은 이 spec에서 제안하는 새 표면 식별자다. 기존 numeric wire/schema 버전을 재사용한다는 뜻이 아니다. MUST/MUST NOT은 **이 spec을 채택할 구현의 요구사항**이며, 이미 보장된 현재 제품 사실이 아니다.

## 1. 문서 구성과 소유권

| 문서 | 단독으로 소유하는 내용 |
|---|---|
| 이 문서 | 범위·설계 결정·현재 대비 차이·권한·전체 카탈로그·채택 조건 |
| [records](model-collaboration-surface/records.md) | 읽기 경로, 표현 bytes, metadata, exact target, index·상태 갱신, 접근 경계 |
| [tools](model-collaboration-surface/tools.md) | 도구별 정확한 영어 description·parameter help, 입력 schema, 기본값, 결과·오류, 호출 예시 |
| [prompts](model-collaboration-surface/prompts.md) | 프롬프트 조립, Worker/Principal 전문, 환경·START·알림 문구, 기존 프롬프트 이행 |
| [runtime](model-collaboration-surface/runtime.md) | acceptance·freeze·복구·publication·delivery·review·lifecycle·group 상태 전이와 owner |
| [validation](model-collaboration-surface/validation.md) | 24개 도구 이행, 모듈별 작업, version cutover/rollback, 시험 matrix, 모델 비교 |
| [codex-reference](model-collaboration-surface/codex-reference.md) | Codex CLI의 고정 commit 출처, 실제 관찰, 적용/비적용 근거 |

이 문서 집합의 요구 ID는 `MCS-` prefix를 사용한다. 기존 AV/INV/DR 번호의 의미를 재사용하지 않는다. 설명용 예시의 `<...>`는 placeholder이며 실행 가능한 실제 ID가 아니다. 실제 tool schema는 모델에게 placeholder를 자동 생성하라고 요구하지 않는다.

## 2. 목표와 비목표

### MCS-S01 — 모델에게 필요한 것은 협업 의도다

모델은 기록을 탐색하고, 동료와 말하고, 코드를 공유·제안하고, 정확한 변경을 판단하고, 필요하면 실행을 양보한다. publication 순서, operation key 생성, 재전송, ACK, legacy adoption을 일상 업무로 수행하지 않는다.

모델의 자율성은 어떤 peer·topic·분업·순서·구현 방법을 택하는지에 있다. OMA는 task DAG, claim/lease, 의무적 leader, 자동 reviewer 배정, 정해진 협업 문서 양식, 모든 단계의 Principal 승인을 요구하지 않는다. Runtime 내부의 기존 실행 lease는 유지하지만 이를 모델용 task lease로 노출하지 않는다.

### MCS-S02 — 단순함의 척도

도구 수뿐 아니라 서로 다른 인자 개념, 발견 단계, 반복 입력, 읽어야 하는 무관한 본문, 실패 해석, 복구 작업을 줄인다. 신뢰성을 위해 내부 코드가 늘어날 수 있다. LOC 감소를 수용 조건으로 삼지 않는다.

### MCS-S03 — 바꾸지 않는 경계

- Worker 독립 clone과 명시적 Git 반영. 다른 Worker의 merge가 workspace를 자동 reset하지 않는다.
- Principal의 사용자 의도·GOAL·판단 역할. 일반 shell/write/Worker 생성 권한은 없다.
- authenticated actor, capability, sandbox, 현재 effect authority의 집행. 도구 노출은 권한이 아니다.
- LOW/MEDIUM/HIGH, author exclusion, Principal reject의 terminal 의미, capacity fallback, exact integration scope, CAS와 사후 challenge.
- accepted fact·원래 bytes·과거 receipt·actor의 의미. `unknown`은 absent/failed/dead/success가 아니다.
- Pi의 provider·모델·세션·compaction·inference retry 소유권. Codex는 참고한 인터페이스이지 교체 엔진이 아니다.
- 기존 hashline 계약, MCP vendor gateway, 실제 지원하는 LSP/web 도구.

비목표: 새로운 shared writable workspace, arbitrary binary artifact store, 모델용 OMA CLI 부활, FUSE 필수화, 별도 daemon/message bus/일반 workflow engine, confidential DM 보장, lifecycle 자동 time-slicing, provider serializer fork.

## 3. 현재 구현과 정확한 차이

### MCS-S04 — 이미 가능한 기능을 새 기능으로 세지 않는다

현재 `oma_candidate_publish`도 게시와 sharing notice를 한 번에 수행한다. `oma_merge_open`은 이미 자동 candidate publication을 한다. `oma_review_respond`에는 이미 revise/withdraw/retry/adopt object action이 있다. request key 자동 생성·frozen input·same-key recovery도 존재한다. 기존 mail archive·`/inbox.md`·`/world/agents.tsv`·`topics.tsv`도 파일이다.

새 표면은 이 기능들을 처음 발명하는 것이 아니다.

| 현재 | collaboration-v1 | 실질적 변화 |
|---|---|---|
| `oma_mail_read`가 raw archive decoding; batch index는 주로 ID/경로 | 일반 read/grep으로 body·metadata·thread/topic 기록 탐색 | plain-text projection 확대와 dedicated read 제거 |
| review/status/log/operation 전용 조회 | role-scoped 파일과 boundary 갱신 | 표현·freshness 책임을 runtime이 인수 |
| send/reply/candidate-publish/continue | send의 본문·파일·commit·replyTo·제한된 @self | 전달 의도의 한 계약 |
| 새 제안은 open, 수정·retry는 respond action | 원래 merge/challenge에 exact proposal ref로 재제출 | 같은 제안의 연속성 |
| Worker vote는 name/action/body; acceptance 시 scope 결정 | 모델이 읽은 immutable exact target 입력 | 읽은 revision/scope와 vote 대상의 명시적 결박 |
| 모델에 key 보존·operation 조회·같은 key 재호출 안내 | host가 invocation 연결과 복구 소유 | 실제 내부 책임 확대 |
| 모델 ACK | 모델 표면 제거; historical fact 유지 | ACK 자동화가 아닌 절차 제거 |
| canonical에 이미 있는 from + inline brief로 create | 필요한 publication을 포함하는 spawn + text/file brief | 검증된 권한 안의 합성 추가 |
| exact optional-set `toolset` | LSP/web 진입 도구의 cumulative activation | 선택 의미 변경 |
| 모델 self/descendant/Principal 개별 control | Human 개별 control, Principal Society control | 실제 model-surface capability 축소 |
| capability가 있는 Worker의 특수 context publication | 일반 지식은 send/commit, 특수 context는 운영 경로 | 실제 surface 축소·custom profile 이행 필요 |

현재의 `oma_mail_reply`는 수신자 자동 상속을 지원한다. 새 send는 `to`를 명시하므로 답장 입력이 늘 수 있다. 이 trade-off를 호출 수 개선으로 숨기지 않는다.

## 4. 최종 공개 카탈로그

### MCS-S05 — OMA 행동

| 이름 | Worker | Principal | 목적 |
|---|---:|---:|---|
| `oma_send` | ✓ | ✓ | 메시지와 정확한 committed 자료 전달 |
| `oma_spawn` | ✓ | — | committed 출발점의 독립 동료 생성 |
| `oma_merge` | ✓ | — | 새 merge 또는 기존 proposal 재제출 |
| `oma_challenge` | ✓ | — | 정확한 applied merge에 대한 교정 제안 |
| `oma_review` | ✓ | ✓ | approve/reject 또는 정확한 자기 제출·판정 철회 |
| `oma_wait` | ✓ | — | 현재 continuation 양보 |
| `oma_follow` | ✓ | — | 자기 topic 구독 변경 |
| `oma_goal` | — | ✓ | 전체 GOAL과 notification 게시 |
| `oma_society` | — | ✓ | Worker 실행 전체 open/close |

Worker 7, Principal 4, 합집합 9다. `oma_read/status/share/revise/withdraw/retry/context_publish/agent_control`이라는 새 모델 도구는 등록하지 않는다. backend decoder/method를 삭제하라는 뜻은 아니다.

`oma_review`에 status/list/diff/revise/retry/adopt를 다시 집어넣지 않는다. `withdraw`는 기능을 없앤 것이 아니라 같은 세 필드의 공식 입장 철회로 남긴다. 정확한 target 종류와 actor를 검증한다.

### MCS-S06 — 일반 도구와 공개 수

Worker 기본: `read`, `write`, `replace`, `insert`, `replace_within`, `grep`, `find`, `ls`, `bash`.

Principal 기본: `read`, `grep`, `find`, `ls`, `ask_user_question`.

공통: vendor `mcp`, `lsp_tools`, `web_tools`. 그룹 진입은 원래 member tools를 **다음 model call부터 누적 공개**하며 자체 실행하지 않는다. 진입 도구도 유지한다.

- Worker LSP: `lsp_diagnostics`, `lsp_fix`, `lsp_status`.
- Principal LSP: `lsp_status`만.
- web: `web_search`, `source_check`, `fetch_content`, `get_search_content`.
- 사용자 extension은 기존 provenance admission으로 별도 처리한다. 숫자에 몰래 포함하지 않는다.

| 지표 | 현재 | 새 spec |
|---|---:|---:|
| OMA 이름 합집합 | 24 | 9 |
| 전체 이름 합집합 | 43 | 29 |
| Worker 최초 / 모두 공개 | 19 / 40 | 19 / 26 |
| Principal 최초 / 모두 공개 | 13 / 21 | 12 / 17 |

새 initial union은 22다. MCP 내부 도구, Personal, 사용자 extension은 제외한다. 초기 Worker 이름 수는 감소하지 않으며 성능 우위를 의미하지 않는다.

## 5. 역할·capability·정보 가시성

### MCS-S07 — 권한 matrix

| 효과/자료 | Worker | Principal | Human/host |
|---|---|---|---|
| workspace read | 현재 허용 범위 | 현재 허용 범위 | 운영 경계 |
| workspace edit/bash | 현재 capability/sandbox 안 | 금지 | 제품 정책 |
| mail send | mail.send | 기존 Principal send | 제품 경로 |
| 새 local commit 공개 | git.submit 필요 | 금지 | 운영 경로 |
| 이미 공개된 commit 참조 | 기존 audience 안 | 기존 접근 범위 안 | 운영 경로 |
| Worker 생성 | agent.create + child policy; 필요하면 git.submit도 | 금지 | bootstrap/운영 |
| peer vote | 독립 reviewer 및 current authority | 금지 | 기존 운영 계약 |
| Principal vote | 금지 | delegated approval + 정확한 approval identity | 기존 계약 |
| 자기 proposal 철회 | requester | 금지 | 기존 repair/control만 |
| 자기 vote 철회 | 허용된 state | 자기 유효 승인에 한해 허용된 state | 기존 invalidate와 별개 |
| workers-only thread/roster/log | 기존 Worker 범위 | 금지 | 운영 가시성 |
| 전체 Society open/close | 금지 | 기존 권한 | 기존 제품 제어 |
| 개별 stop/start·특수 context | 새 모델 표면에서 없음 | 새 모델 표면에서 없음 | 기존 owner의 authenticated 제어 |

Principal에게 자기 승인 철회를 노출하는 것은 현재 Principal tool의 approve/reject-only보다 넓은 **표면 변경**이다. backend가 허용하는 자기 vote withdrawal과 state gate를 쓰되, terminal reject를 번복할 수 있게 만들지 않는다. role schema에 허용되지 않는 target이 들어오면 거절한다.

수신자는 delivery 대상이지 새 confidentiality boundary가 아니다. 기존 public/Worker audience를 보존한다. projection 경로와 metadata에서 비허용 자료의 제목·ID·경로도 누설하지 않는다.

MCP에는 [DR71](design-revisions.md#dr71--기존-mcp-기능을-새-collaboration-역할-제한으로-추가-차단하지-않는다)을 적용한다. 위 역할 matrix를 기존 vendor MCP 기능 전체에 대한 새 차단·격리 요구로 확대하지 않는다. 기존 MCP 계약과 owner를 보존하며, OMA가 제공하는 role records와 mutation RPC의 원래 인증·권한 검증은 유지한다.

## 6. 이전 제안에서 이번 spec이 정밀화한 결정

### MCS-S08 — commit 첨부 send의 acceptance

이전 초안은 publication 후 mail acceptance를 연속 호출하는 합성을 제시했다. 그 방식은 Worker 종료 시 아직 수락되지 않은 다음 단계의 실행 권한/owner를 남긴다.

이 spec은 **본문·수신자 snapshot·commit publication 계획을 하나의 broker-owned mail intent로 먼저 수락**하고, 그 계획에 따라 Git publication과 mailbox materialization을 수행한다. Git과 DB가 하나의 물리 transaction이라는 뜻은 아니다. partial publication 상태는 존재하지만 `accepted mail + attachments pending`이지, 이미 수락된 mail을 나중에 preaccept rejection으로 바꾸지 않는다.

따라서 accepted send는 Worker engine이 종료되어도 기존 mail/reconcile owner가 이어서 처리할 수 있다. typed send의 합성 지원에는 새로운 versioned payload/plan이 필요하다. 구체적 순서는 runtime 문서가 소유한다. 기존 legacy candidate-publication→mail 이력은 소급 변환하지 않는다.

새 accepted plan은 검증한 exact publication 범위를 broker에 위임한다. 현재 broker tenure·writer·artifact 검사는 계속 필요하지만 원래 Worker process의 생존에 의존하지 않는다. 이것은 standalone legacy publication의 권한을 넓히는 변경이 아니라 새 plan의 명시적 authority 계약이며, 해당 DR와 실제 effect 경계 검증 없이 cutover할 수 없다.

spawn도 새 create intent에 source publication dependency를 결박하여 같은 원칙을 따른다. 필요한 게시 권한을 create 권한에서 추론하지 않는다.

### MCS-S09 — risk tier와 revision

기존 proposal revision의 tier는 현재 owner가 계산하는 `max(previous tier, current policy floor, deterministic tier)`를 유지한다. 기존 proposal 재제출에서 `tier`는 기존 제안의 tier와 일치해야 하며 model-only tier 변경 API로 쓰지 않는다. 새 정책 때문에 더 높은 tier가 계산되면 그 결과와 새 review 요구를 반환한다. 별도의 arbitrary escalation fact를 이 spec에 몰래 추가하지 않는다.

### MCS-S10 — lifecycle의 선택은 명시적이다

DR66의 enabled Worker cap과 physical-death 증거를 유지한다. wait/idle은 슬롯 반환이 아니다. 지속 동료 재사용을 기본으로 하며, capacity의 강제 교체는 Human 제품 제어다. 완전 자율적인 Worker 교체가 필수라면 **이 선택의 제품 승인이 없으므로 cutover하지 않는다**. 이 spec은 자동 park/eviction/resume 정책을 만들어 해결한 척하지 않는다.

## 7. 정보 배치 원칙 — Codex CLI를 적용하는 범위

### MCS-S11 — 한 기계적 계약에 한 설명 owner

| 정보 | 전달 위치 |
|---|---|
| 역할, 자율적 진행, 증거·완료 판단, 협업 습관 | 짧고 완결된 역할 system prompt |
| 역할·권한의 비협상 경계 | host-owned authority section + 실제 broker/sandbox |
| 경로, actor, platform, 관측 시각, 실행 수명 | generated environment section와 `/oma/README.md` |
| 각 행동의 입력, 기본값, 금지 조합, 결과 의미 | tool description + property help |
| 현재 목표·작업 설명 | GOAL·Human 입력·spawn brief; system 권한으로 승격하지 않음 |
| 새 delivery·stale projection·복구 결과 | provenance가 있는 작은 runtime event |
| 본문·diff·로그·과거 전체 | 필요할 때 파일로 읽기 |

Codex의 outcome-oriented 지침, 관련 정보별 section, tool purpose와 field help의 분리, 환경 정보 escaping을 참고한다. `apply_patch`, `exec_command/write_stdin`, `update_plan`, permission escalation, Codex subagent semantics, 특정 provider의 tool_search를 OMA에 있다고 쓰지 않는다. 역할 프롬프트가 Pi base prompt를 대체한다는 현재 조립 방식을 고려하여 두 역할 전문은 독립적으로 완결되어야 한다.

## 8. 수용과 변경 관리

### MCS-S12 — 채택 gate

다음은 구현 전 결정/검증이 필요한 항목이며 현재 모두 미완료다.

1. 개별 lifecycle·특수 context의 모델 노출 축소를 제품 결정으로 승인.
2. `/oma` role projection, bounded 갱신, unavailable 표시, Principal mount 경계를 구현·검증.
3. original invocation 연결, broker-owned send/spawn plan, crash recovery를 구현·검증.
4. exact review target과 stale/own-record 검증을 실제 effect boundary에 연결.
5. 실제 provider에 전달된 schema와 실행 validator, 누적 registry, 프롬프트 전문의 일치를 확인.
6. 기존 accepted history와 old sessions의 versioned compatibility를 확인.
7. deterministic safety suite 후 real-model held-out 비교를 수행. 기계적 PASS와 모델 개선을 분리.

모델 비교에서 단순 표면이 더 많은 Human 개입, 잘못된 대상, 가용성 저하를 만들면 이름 수를 지키려고 이를 감수하지 않는다. spec 수정은 해당 owner와 버전을 함께 갱신한다. 현재 고정 architecture·역사적 승인·validation 결과를 고쳐 새 설계가 검증된 것처럼 만들지 않는다.

### MCS-S13 — 최종 코드의 레거시 제거와 저장 사실의 명시적 비호환

사용자는 후속 구현 지시에서 **구형 코드·호환층 전부 제거**를 선택했다. [DR72](design-revisions.md#dr72--collaboration-최종-코드에서-레거시-병행-지원을-제거하고-저장-사실은-보존한다)는 이 결정의 근거와 범위를 소유한다. 이 절은 S12의 old-session compatibility gate와 X01/X09/V04의 old/new 병행 보존 계획 중 아래와 충돌하는 부분에 대한 **최종 산출물 계약**이다. 과거 DR64/DR66·수용 번호·당시 승인/검증의 뜻을 바꾸지 않는다.

- 최종 Society 실행 코드에는 구형 모델 도구·등록·exact-set selector·old/new 병행 decoder·자동 fallback/alias를 남기지 않는다. 새 이름의 adapter로 구형 경로를 호출하는 우회도 제거한다. Personal 모드나 기존 vendor MCP 기능을 이 제거 범위로 확대하지 않는다.
- 저장 session/journal/ledger/plan/receipt/approval/ACK·원래 request key·source bytes는 임의 삭제하거나 새 뜻으로 재작성하지 않는다. history에 남은 도구 이름이 현재 callable registry로 다시 살아나지 않는다.
- 이행 대상은 사전에 원래 release/원래 owner로 accepted work를 drain하거나, 최종 release가 명시적으로 비호환을 보고하고 **새 실행을 거절**하는 경로로 처리한다. 이를 위해 최종 binary가 구형 runtime/decoder를 다시 불러오거나 자동 변환하지 않는다. pending/unknown을 terminal·absent로 간주하지 않고, unresolved invocation은 보존하며 전환을 거절한다.
- 구형 Society birth/plan/profile·버전 없는 payload의 불가용성을 새 표면의 암묵적 opt-in으로 해석하지 않는다. 비호환 거절은 원본 변경/새 operation·새 key·Git ref/mail effect를 만들지 않아야 한다. 별도 read-only 원시 자료 보존은 새 효과 실행 지원이 아니다.
- Rollback은 fresh admission을 닫고 검증된 원래 owner로 drain하거나 operator 진단 상태로 남기는 절차다. 최종 코드에 legacy registry/decoder를 남기거나 backup 복원으로 외부 효과를 취소하는 절차가 아니다.
- 제거·거절·drain/복구·Human 개별 control/profile 이행의 실제 검증을 끝내기 전에는 이 계약을 충족했다고 보고하지 않는다. 신규 Society는 DR74에 따라 collaboration-v1으로 태어난다. 기본 노출·실서비스 cutover는 이 구현 지시로 승인되지 않았다.
