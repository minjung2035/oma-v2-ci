# OMA 진행성과 통합 및 자원 관리 개선 명세

상태: **설계안 작성 완료, 구현 전**. 작성일은 2026-10-30이며 코드 확인 기준은 8fa7b725cf82c2624692d026224b6bfd0073ef2f다. 이 명세는 사용자가 선택한 12개 개선을 네 단계로 구현하기 위한 목표 동작, 책임, 호환성, 수용 시나리오를 정한다. 아래 필드·상태·action은 제안하는 새 계약이며 현재 제공되는 API라는 뜻이 아니다.

목표는 Worker가 변경안과 협업에 집중하도록, 진행을 막는 불필요한 대기·재제출·재검토를 줄이고 실제 실행 결과를 정확하게 표시하는 것이다. 단계 순서는 진행·상태, 벤치마크 준비, 통합 구조, 누적 비용이다. Linux를 대상으로 하며 macOS 경로, provider schema 검증 확대, toolset A/B, 실제 SWE-Milestone 실행은 범위에 포함하지 않는다.

현재 계약은 [implementation-spec](implementation-spec.md), [integration-policy](implementation/integration-policy.md), [모델 도구 표면](model-tool-surface-spec.md)에 있다. 이 문서는 그 계약의 변경안이며 구현 cutover 때 해당 owner 문서와 결정 기록을 갱신한다. [PRIORITY-0](PRIORITY-0.md)의 확정된 사실 보존, 현재 권한 재확인, unknown 보존은 유지한다. hash로 고정된 architecture와 과거 승인·검증 기록을 수정하지 않는다.

## 1 범위와 구현 순서

번호는 대화에서 합의한 개선 목록의 번호다. 새 우선순위 번호로 바꾸지 않는다.

| 단계 | 항목 | 제공할 동작 | 주요 소유 코드 |
|---|---|---|---|
| 1 | 2 복구와 wake 분리 | 긴 복구 중에도 독립 Worker와 review 관측 진행 | packages/reconcile/src/index.ts, operations.ts |
| 1 | 3 승인과 실행 상태 분리 | reviewer stop·wait·재시작으로 기존 승인 소멸하지 않음 | packages/domain/src/review-evaluation.ts, packages/review/src/authority.ts |
| 1 | 4 검사 재시도 | 같은 변경안·리뷰를 보존한 새 검사 시도 | packages/review/src/acceptance.ts, packages/git/src/integration.ts |
| 1 | 5 큰 검색 출력 | Principal도 제한된 미리보기와 전체 결과 파일로 읽음 | packages/tool-runtime/src/contained-tools.ts, contained-search.ts |
| 1 | 7 최초 Worker | 새 Society는 최소 1명, 기존 0명 Society는 host 복구 가능 | packages/lifecycle/src/create.ts, config와 TUI |
| 1 | 12 잘못된 상태 표시 | 준비 실패·검사 대기·실제 반영·공지 전달을 구분 | packages/review/src/advancement.ts, review-evaluation.ts |
| 2 | 6 자원 예산 | 사용자가 선택한 CPU·메모리·task·검사 시간 예산의 실제 집행 | packages/platform-linux, native, process와 host config |
| 2 | 10 검사 환경 | 한 시도의 setup·검사가 같은 작업공간과 HOME 사용 | apps/oma/src/runtime/candidate-checks.ts, packages/git/src/candidate-check.ts |
| 3 | 1 변경안과 통합 시도 분리 | 오래된 base의 변경안 접수, 최신 main과 자동 병합·검사 | packages/review, git, contracts, protocol, storage |
| 4 | 8 작성자 조회 | 인증된 제출에서 파생한 인덱스와 묶음 ref 관측 | packages/git/src/repository.ts |
| 4 | 9 검색 입력 복사 | ignore 판정 후 선택한 파일 내용만 복사 | packages/tool-files/src/index.ts, contained-search.ts |
| 4 | 11 종료와 보관 분리 | 정상 종료 후 hot 보존, 별도 검증 보관·회수 | apps/oma/src/runtime/session-storage.ts, entry/broker.ts |

1단계의 검사 재시도는 3단계가 사용할 통합 시도 표현을 먼저 도입하되, 3단계 전에는 base가 현재 main인 기존 접수 조건을 유지한다. 5번의 결과 파일 소유·읽기 경계는 큰 diff 첨부에도 재사용한다. 6번과 10번은 함께 검증한다. 8번 최적화는 1번에서 정한 원본 변경안의 작성자 의미를 그대로 따른다.

## 2 공통 계약

### 2.1 유지할 불변식

1. main 반영은 현재 권한·정책·작성자·승인과 검사 대상을 확인한 뒤 expected-old CAS로만 수행한다.
2. accepted plan, vote, 검사 결과, terminal receipt의 bytes와 의미는 보존한다. 새 시도는 이전 실패를 성공으로 덮어쓰지 않는다.
3. 결과 불명인 통합이나 아직 살아 있을 수 있는 실행 scope를 실패·종료로 간주해 후속 실행을 겹치지 않는다.
4. Git·파일·프로세스·network 작업을 SQLite transaction 안에서 기다리지 않는다. 긴 비동기 준비 뒤 acceptance와 효과 직전의 검사를 유지한다.
5. 작성자 자기 승인 금지와 authenticated submission 재검사를 유지한다. 모델이 보낸 Git author 문자열이나 성공 주장으로 대체하지 않는다.
6. 일반 Worker의 자율 생성은 유지한다. 첫 Worker 복구를 이유로 Principal에게 일반 생성 권한이나 중앙 배정 책임을 주지 않는다.
7. 실제 반영 diff는 시스템이 자동 생성하고 첨부한다. Worker에게 수작업 작성 책임을 넘기지 않는다.
8. 원본 workspace를 회수하려면 검증된 복원 자료, durable한 선택 기록, 실행 종료 증거가 모두 있어야 한다.

### 2.2 변경안과 시도의 공통 표현

다음은 논리 필드다. 별도 task·queue·review 테이블을 만드는 지시가 아니다. 기존 attest.record와 git.integrate operation의 versioned plan 및 관련 파일을 사용하고, 상태는 그 기록에서 파생한다.

| 개념 | 필수 연결 | 수명 |
|---|---|---|
| 변경안 revision | requestId, revision, sourceBase B, sourceCandidate C, authenticated submitters, reviewPolicyRevision | 제출 코드가 바뀌면 새 revision |
| 코드 검토 | requestId와 revision, actor, verdict, scope, 접수 당시 자격 증거 | stop·wait·run 교체와 독립 |
| 통합 준비 | requestId와 revision, 관측한 main M, 준비 owner, 준비 실패 원인 | main 또는 revision 변경 시 다시 준비 가능 |
| 통합 시도 | operationId, requestId, revision, attemptNumber, expectedMain M, integrationCandidate I, policy/check profile digest, 승인 근거, 공지 파일 참조 | accepted 뒤 내용 불변 |
| 검사 결과 | attempt operationId, step id, 실행 환경 digest, 시작·종료 관측, 종료 이유, 로그 참조 | 성공·실패를 포함한 과거 사실 |

1단계에서는 M=B, I=C다. 3단계에서 M과 B, I와 C가 달라질 수 있다. attemptNumber는 request 내에서 broker가 부여하며 caller가 성공·실패 기록을 덮어쓸 수 없다. 같은 retry 요청 key는 같은 새 시도 하나로 해석한다. 의도적인 다음 재시도는 별도의 요청 key를 사용한다.

무거운 준비와 공지 파일 생성은 acceptance 전에 수행하되 생성 즉시 preaccept owner에 등록한다. accepted git.integrate가 생긴 뒤에는 그 plan이 모든 파일을 소유한다. 준비 실패는 versioned attestation의 준비 실패 fact로 남겨 재시작 뒤에도 이유를 볼 수 있게 한다. 준비 중 죽었고 acceptance가 없으면 원본 요청은 유지하며 orphan 정리 후 다시 준비할 수 있다.

### 2.3 상태 표시와 재시도

status는 review, integration, notice를 별도 필드로 제공한다. 단일 문구만으로 모든 상태를 표현하지 않는다. proposed integration phase는 아래 표를 따른다.

| phase | 조건 | 사용자에게 필요한 정보 |
|---|---|---|
| review-needed | 현재 revision에 필요한 결정이 부족 | 부족한 검토와 대상 revision |
| ready | 검토 조건 충족, 실행은 아직 시작하지 않음 | 준비 또는 writer 차례 대기 |
| preparing | 살아 있는 owner가 통합 결과·공지 자료를 준비 | 시작 시각, 대상 main |
| waiting-resources | accepted 시도에 실행 자원이 아직 배정되지 않음 | 기다리는 예산 또는 슬롯 |
| checking | 해당 시도의 실제 검사 scope가 실행 중 | step, elapsed, 설정된 deadline |
| applying | 검사·최종 gate를 지나 main CAS 수행 또는 관측 중 | 정확한 시도 ID |
| blocked | 충돌·준비 실패·검사 실패·권한 부족 등 확인된 장애 | reason, 근거, 누가 무엇을 해야 하는지 |
| superseded | 효과 미발생이 확인된 시도가 새 main/revision으로 대체됨 | 대체 이유와 다음 시도 |
| unknown | main 효과 또는 scope 종료를 확인할 수 없음 | 복구 관측 대상과 자동 재실행 불가 이유 |
| applied | 해당 시도의 반영 증거가 확인됨 | 실제 적용 commit과 diff |
| already-included | 새 시도 반영 전에 C가 관측한 main에 포함됐음이 확인됨 | 관측 main과 포함 증거, 식별 가능하면 실제 반영 시도 |

request의 cancelled/rejected는 별도 terminal이다. 이미 활성 pending/unknown 시도가 있으면 그 시도를 먼저 정산하며 already-included로 덮지 않는다. 새 반영이 불필요한 already-included는 관측 main과 C를 결박한 별도 종료 fact로 남기고, 자기 CAS 성공 receipt를 합성하지 않는다. 아직 반영 여부를 모르는 시도는 취소 요청만으로 cancelled가 되지 않는다. applied 뒤 공지 전달이 남으면 integration=applied, notice=pending으로 표시한다. ready를 applying으로 표시하지 않으며, blocked인데 missing 목록이 비어 있으면 계약 위반이다. 캐시된 실행 관측에는 observedAt을 포함하고 stale 관측을 현재 실행 증거로 쓰지 않는다.

상태 projection은 현재 revision과 연결된 활성 시도, 살아 있는 준비 owner, 해당 revision의 마지막 준비/실행 결과 순서로 판단한다. 이전 revision이나 이미 대체된 시도의 실패를 새 실행의 blocked로 표시하지 않는다. 준비 실패 fact 자체를 저장하지 못했다면 원인을 진단으로 반환하고 persistence unknown을 표시하며, 영속 기록이 생겼다고 주장하지 않는다.

retryable과 nextAction은 오류 문자열 추측이 아니라 phase·effect knowledge·현재 권한으로 계산한다. 다음 시도를 만들기 전 이전 시도의 main 효과와 scope 종료 여부를 확인한다. unknown에 대한 retry는 새 통합 생성이 아니라 기존 시도의 관측·복구다.

## 3 단계 1 진행과 상태

### 3.1 항목 2 복구와 관측의 수명 분리

현재 sweep은 operations.sweep, review advancement, observeUnits를 차례로 기다린다. 세 책임의 진행 owner를 분리한다. 각 책임에는 하나의 in-flight 작업과 재실행 필요 표시만 두며, 동일 이벤트가 반복되면 합친다. wake trigger는 긴 recovery Promise를 기다리지 않고 관측·wake owner를 실행할 수 있어야 한다.

operation 복구는 기존 single-flight를 유지한다. review owner는 상태 계산과 새로운 실행의 dispatch까지만 짧게 수행하고 검사 프로세스 완료를 기다린 채 전체 review 순회를 점유하지 않는다. lifecycle 관측도 한 Worker의 느린 stop 관측 때문에 나머지 Worker를 순차 대기시키지 않는다. 실행 중 작업 수는 실제 owner·대상 수로 제한하고 이벤트마다 새 Promise를 무제한 쌓지 않는다.

동시성은 자원별 fence 안에서 허용한다. main의 pending/unknown writer는 같은 main의 새 writer를 막고, 특정 Worker의 미확인 scope는 그 incarnation의 재시작을 막는다. 관련 없는 Worker와 조회·리뷰 접수는 계속 진행한다. Store 손상에 대한 전체 mutation fence는 유지한다. startup은 registry·원장 관계를 먼저 검증한 후 unresolved 자원에 대한 fence를 설치하며, 긴 물리 복구 전체를 activation의 선행 조건으로 만들지 않는다.

모든 비동기 작업은 broker의 종료 owner가 등록·취소·회수한다. shutdown에서 취소 신호만 보내고 종료 완료로 기록하지 않는다. 오래 걸리는 동기 Git 호출은 별도 lane으로 이름만 옮겨도 event loop를 막으므로, 이 단계가 바꾸는 정상 복구·관측 경로에서는 비동기 실행 또는 짧은 bounded 관측으로 바꿔야 한다.

수용 시나리오: 한 Git 복구 효과를 제어된 미완료 상태로 유지한 동안 다른 Worker의 신규 메일 wake와 review 상태 갱신이 완료된다. 같은 자원은 진행하지 않는다. trigger를 반복해도 동일 복구가 중복 실행되지 않으며, 해제 후 한 번 정산된다. startup·shutdown·Store 손상도 같은 구분을 보존한다. 임의의 sleep 후 성공을 보는 대신, 보류한 효과를 해제하기 전에 독립 동작이 완료됐는지를 판정한다.

### 3.2 항목 3 검토 증거와 실행 상태 분리

vote 접수 시 actor의 신원·review 권한·작성자 제외를 확인하고 그 자격을 기록한다. effective vote는 해당 revision의 최신 vote, 명시적 철회/무효화, 새로운 작성자 provenance, 정책 조건으로 판단한다. desired=enabled 여부나 살아 있는 run 유무로 과거 vote를 제거하지 않는다. wait, stop, retire, 재시작은 검토 철회와 다른 행동이다. retired actor에게 새 vote 권한이 생기는 것은 아니다.

reviewer가 자신의 vote를 철회하는 행동과, host가 권한 사고 등으로 특정 actor/vote를 무효화하는 행동을 versioned attestation으로 명시한다. 이전 bytes는 보존하고 무효화 사유·범위를 별도 기록한다. Worker가 타인의 vote를 임의 무효화하거나, 코드 작성자가 자신의 작성자 판정을 해제할 수 없다.

quorum은 revision 접수 때 정책과 author/capacity snapshot에서 결정한다. 이후 단순 실행 상태 변화로 quorum이나 Principal approval bundle을 바꾸지 않는다. 작성자 provenance 또는 승인 정책 자체가 바뀌면 해당 근거를 명시하고 새 요구를 계산한다. 기존의 maxWorkers 기반 capacity fallback을 유지하되, stop으로 요구 peer 수를 줄이거나 늘리는 간접 경로를 없앤다.

새 main 효과를 내는 requester의 현재 권한·stop 상태는 별도로 재검사한다. reviewer stop 후 승인이 유효하다는 이유로 stopped requester가 main을 갱신할 수 있는 것은 아니다.

수용 시나리오: HIGH 요청에 두 peer가 승인한 뒤 한 reviewer를 stop해도 Principal의 기존 approval 참조가 유효하다. 명시적 철회, 새 reject, 자기 승인으로 드러난 provenance 변경은 실제로 막힌다. 작성자 stop이 quorum을 바꾸지 않으며 requester stop은 새 반영을 막는다.

### 3.3 항목 4 검사 재시도

검사 실패는 해당 시도의 결과다. 변경안 자체를 폐기하지 않는다. requester 또는 host가 같은 요청에 명시적인 retry action을 보내면 최신 revision, 승인, 정책, main, 이전 scope 종료를 확인하고 새 attempt를 만든다. 일반 review action 표면에 retry를 추가하며 별도 CLI 업무 경로를 만들지 않는다. Principal의 기존 권한은 이 action 때문에 확장하지 않는다.

retry 입력은 request 이름, expectedRevision, expectedAttempt, reason, requestKey를 포함한다. 두 caller가 같은 실패에 동시에 재시도해도 새 활성 attempt는 하나다. 동일 key replay는 같은 결과를 반환한다. 다른 key여도 expectedAttempt가 이미 교체되었으면 최신 상태를 반환하며 또 실행하지 않는다.

코드·정책·승인 범위가 같으면 peer와 Principal의 결정을 다시 요구하지 않는다. 명시적 vote 철회와 provenance 변경은 계속 검사한다. 이전 CHECK_FAILED나 timeout receipt는 유지한다. 자동으로 무한 재실행하거나 실패를 transient로 추정하지 않는다. 기본 재시도는 전체 검사 pipeline을 새 환경에서 다시 실행하며, 일부 성공 step 재사용은 초기 범위에서 제외한다.

1단계에서는 main이 기존 base와 다르면 이를 이유와 함께 막고 기존 갱신 절차를 안내한다. 3단계 완료 후에는 같은 요청의 최신 main 통합 준비로 연결한다. preparation 실패에 대한 retry는 잘못된 applying 표시를 반복하지 않고 준비부터 수행한다.

수용 시나리오: 동일 candidate의 첫 검사가 실패하고 명시적 retry에서 성공하면 승인 수는 그대로이고 attempt·검사 영수증은 둘이다. 동시 retry, 같은 key replay, 취소 경합, policy 변경, 종료 불명은 중복 실행·승인 우회를 일으키지 않는다.

### 3.4 항목 5 큰 결과의 파일 보관과 범위 읽기

Principal의 code write 금지와 runtime의 결과 보관 권한을 분리한다. runtime이 소유한 session 결과 디렉터리에 전체 출력을 스트리밍하고, 모델에는 미리보기·전체 bytes·완전성·파일 참조·후속 읽기 방법을 반환한다. 프로젝트 소스 트리에 쓰기 권한을 부여하지 않는다. 조회 권한은 원래 결과를 읽을 수 있는 actor에 한정한다.

초기 표시 기본값은 UTF-8 미리보기 16 KiB, metadata를 포함한 tool result 32 KiB 이하다. 이는 출력 전체를 거부하는 자원 quota가 아니라 한 번의 모델 입력 크기 기준이며, 제품 설정에서 조정할 수 있다. 긴 한 줄도 bytes 단위로 나누되 UTF-8 경계를 보존한다. 전체 결과를 먼저 하나의 문자열로 만든 뒤 자르는 구현은 허용하지 않는다.

후속 read는 검증된 파일 참조와 byte/line 범위를 받으며 한 페이지 기본 상한은 64 KiB다. next offset과 digest를 제공하고 원래 검색을 다시 실행하지 않고 같은 결과를 이어 읽는다. 기존 read 도구의 검증된 result-root/range 경로를 확장하며 새 범용 artifact 서비스는 만들지 않는다.

사용자가 명시한 match limit에 도달한 결과와, 실행은 완료했지만 표시만 잘린 결과를 구분한다. 결과 파일 쓰기 실패 시 작은 부분 출력과 complete=false, 정확한 원인을 반환한다. 원문 전체 inline fallback이나 성공으로 보이는 조용한 손실은 허용하지 않는다. 결과 파일은 session 기록에서 참조되는 동안 보존하고 11번의 보관 대상에 포함한다. private 결과는 commons에 자동 공개하지 않는다.

수용 시나리오: 1.58 MB 이상의 Principal 검색 결과와 긴 단일 행이 표시 상한을 지키고, 페이지를 모두 읽으면 원래 결과 bytes가 복원된다. disk-full·취소·권한 없는 actor·경로 치환에서는 partial 또는 거절을 정확하게 표시하고 소스 write 권한은 그대로다.

### 3.5 항목 7 최초 Worker 보장

새 Society 설정의 initialResidents는 최소 1명이며 maxWorkers 이하이어야 한다. UI·설정 저장·bootstrap의 검증 owner를 통일한다. Personal 모드는 이 조건의 대상이 아니다. bootstrap 완료 후 모든 Worker를 의도적으로 stop한 상태에 자동 생성으로 개입하지 않는다.

기존 0명 Society는 읽기·진단이 가능해야 한다. host의 설정/복구 경로에 첫 Worker 생성 행동을 제공하고 기존 agent.create의 접수·provision·초기 메일·용량 검사를 재사용한다. Principal actor 권한을 우회하거나 bootstrap 완료 기록을 지우지 않는다. 이름·profile·brief를 명시하고, 동시에 복구를 요청해도 하나의 생성만 접수되게 한다. 이 경로는 resident가 한 번도 없는 상태의 복구이며 일반 생성 권한 확장이 아니다.

수용 시나리오: 신규 0명 설정은 저장 전에 거절되지만 기존 0명 원장은 읽힌다. host 복구 후 Worker가 응답하며 같은 key replay와 crash recovery에서 중복되지 않는다. 정상 Society의 전원 stop 및 Personal에는 자동 Worker가 생기지 않는다.

### 3.6 항목 12 공지 준비 실패와 상태 정합성

1단계의 필수 범위는 상태 오류 제거다. diff/공지 크기 초과·파일 작성 실패 때문에 git.integrate를 생성하지 못했다면 blocked와 notice-preparation reason을 기록한다. 현재의 메모리 oversize set만으로 영구 skip하지 않는다. 재시작과 명시적 retry 뒤에도 이유·재시도 조건이 일관되어야 한다. 준비에 성공하기 전 applied 제목의 공지를 보내지 않는다.

자동 diff 생성은 유지한다. 본문에 전체 diff를 여러 통으로 넣는 기존 형식이 한도를 넘으면, 5번의 파일 게시 primitive로 정확한 전체 diff를 보관하고 짧은 요약과 읽을 수 있는 첨부 참조를 보낸다. 첨부에는 request/revision/attempt, 비교 OID 두 개, bytes, SHA-256을 포함한다. hash만 있고 수신자가 읽을 수 없는 경로는 첨부 완료가 아니다. 큰 diff를 모델이 다시 만들게 하지 않는다.

본문 상한과 artifact의 스트리밍 처리를 분리한다. 실제 저장 공간 부족 등으로 전체 파일을 보존하지 못했다면 준비 실패로 막으며, 새 고정 파일 크기 제한을 조용히 추가하지 않는다. 파일은 acceptance 전에 완성·검증하고, 공지 delivery는 반영 확인 뒤 게시한다. CAS 뒤 공지 전달만 실패한 경우 main을 다시 적용하지 않는다.

수용 시나리오: 작은 시험용 상한에서 큰 diff를 넣어도 phantom applying이 없다. 파일 첨부에 성공하면 수신자가 원본 전체를 읽을 수 있고, 실패하면 명확한 blocked가 된다. 재시작·동시 review 변경·CAS 직후 죽음·공지 전달 실패를 구분한다. 현재 기본 bundle 한도는 256 MiB이며, 작은 상한을 사용한 과거 재현을 기본 설정에서의 8 KiB 실패로 서술하지 않는다.

## 4 단계 2 벤치마크 준비

### 4.1 항목 6 자원 예산의 범위와 설정

maxWorkers는 논리 Worker 용량으로 유지한다. CPU·메모리·task·실행 시간의 대용으로 쓰지 않는다. host가 선택한 workload resource profile을 별도로 도입하며 기본은 미설정이다. 과거의 폐지된 quota config를 이름만 복원하지 않고 새 version의 목적·단위·지원 여부를 명시한다.

| 제안 필드 | 의미 | 미설정 |
|---|---|---|
| cpuCores | workload 전체의 CPU bandwidth 상한, 양의 소수 가능 | 추가 제한 없음 |
| memoryMaxBytes | workload 전체 resident memory 등의 cgroup charge 상한 | 추가 제한 없음 |
| swapMaxBytes | workload swap 상한, 0은 사용 불가 | 기존 host 설정 |
| tasksMax | 프로세스와 thread를 포함한 task 상한 | 추가 제한 없음 |
| checkWallTimeMs | setup을 포함한 시도별 검사 wall time | deadline 없음 |
| tmpfsMaxBytes | 생성하는 임시 mount의 용량 상한 | 기존 host 설정 |
| maxConcurrentCheckPipelines | Society 내 검사 pipeline 실행 수 | 1 |

resource profile은 Worker engine과 도구 후손, 검사 pipeline 및 OMA가 실행하는 무거운 helper를 workload scope에 포함한다. broker의 원장·복구 제어 프로세스는 별도 scope에 두어 workload OOM을 정산할 수 있게 한다. 실행 시 포함한 PID scope와 제외 항목을 보고한다. 외부 inference 서버, host의 다른 앱, 별도 grader container는 자동으로 이 예산에 들어가지 않는다.

Linux 집행은 위임된 cgroup v2의 cpu.max, memory.max, memory.swap.max, pids.max와 기존 native scope를 연결한다. task가 workload 코드를 실행하기 전에 placement를 끝내고, 이미 생성된 후손이 밖에 남는 이동 경합을 막는다. cgroup을 자원 집행에 쓰더라도 기존 pinned scope·sender 인증·종료 증거를 경로 문자열로 대체하지 않는다. cgroup v2의 계층적 제한과 controller 지원 조건을 따른다. [Linux 공식 문서](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

사전 점검은 requested/effective/supported/reason을 반환한다. 사용자가 요구한 필드를 집행할 수 없으면 그 profile의 실행을 거절하고, 사용자가 명시적으로 미설정 profile로 바꿀 수 있게 한다. 조용히 제한을 생략하거나 sudo를 요구하는 전제는 두지 않는다. 예산 변경은 기본적으로 다음 실행부터 적용하며, 현재 실행에 적용됐다고 표시하지 않는다.

deadline 만료는 cancellation과 scope 종료를 시작한다. 실제 종료 확인 전 슬롯을 재사용하거나 timeout receipt를 완료 상태로 게시하지 않는다. OOM·task 한도·timeout·일반 check 실패·종료 불명을 구분하고 cgroup event counter 등 실제 근거를 기록한다. tmpfs bytes는 memory budget과 독립된 추가 물리 메모리가 아니다. workspace 디스크는 우선 사용량·여유 공간 관측 대상으로 두며, filesystem quota를 구현하지 않은 profile에 hard disk limit을 보장하지 않는다.

동시 Society와 외부 채점기를 같은 컴퓨터에서 실행하려면 공통 부모 예산 또는 launcher의 총예산 배분이 필요하다. Society별 제한 세 개가 host 전체 제한이 되는 것은 아니다. benchmark 기록에는 포함된 프로세스와 container, CPU/RAM/swap/disk, resource profile, Worker 수, 채점 동시성을 함께 남긴다. 이 명세만으로 16 GB 호스트에서 3+3 실행 가능을 판정하지 않는다.

### 4.2 항목 10 한 시도의 공유 검사 환경

검사 정책에 versioned pipeline을 도입한다. 논리 형식은 setupSteps, checkSteps, env, toolchainDigest, cachePolicy다. 각 step은 id, argv, cwd, env와 선택적 deadline을 갖는다. 명령은 argv로 실행하며 shell 해석이 필요하면 정책이 shell을 명시한다. cwd는 검증된 pipeline workspace 아래로 제한한다.

한 attempt는 정확한 I를 한 번 checkout하고 하나의 sandbox·workspace·HOME을 유지한다. setupSteps를 순서대로 실행한 뒤 checkSteps를 같은 환경에서 실행한다. 따라서 setup의 npm ci 결과를 다음 npm test가 사용할 수 있다. step별 stdout/stderr·종료 결과는 따로 보관하고, broker만 기록할 수 있는 제어 경로로 단계 완료를 확인한다. candidate 출력의 JSON을 trusted step receipt로 취급하지 않는다.

기본은 첫 실패에서 중단한다. setup 실패도 어느 단계의 실패인지 표시한다. retry는 fresh workspace·HOME에서 전체 pipeline을 시작하며, 이전 attempt의 mutable 작업공간을 재사용하지 않는다. background process가 있으면 attempt owner가 종료까지 소유하고 다음 attempt에 남기지 않는다.

검사 시작 시 checkout I를 확인하고 pipeline이 바꾼 tracked source를 검사 결과에 기록한다. code generation이나 build가 tracked 파일을 바꾼다는 이유만으로 공통 runtime이 실패시키지 않는다. 결과는 I에서 고정된 setup·check policy를 실행한 증거이며 모든 step이 원본 파일을 수정 없이 읽었다는 증거와 구분한다. 원본 불변성을 요구하는 프로젝트는 정책의 검사 step에서 이를 검증한다. 검사 중 생성된 코드를 main에 몰래 반영하지 않으며, 필수 check는 모두 같은 I와 같은 pipeline policy를 근거로 해야 한다.

처음 제공할 공유 cache는 선택적인 package download cache다. 기본은 off이고, full workspace·HOME·node_modules의 무조건 공유는 제공하지 않는다. key는 repository/trust scope, OS/architecture, toolchain·package manager, lockfile, setup policy의 digest를 포함한다. private attempt에 복원하고 package manager integrity 검사를 유지한다. 게시물은 immutable이며 공유 파일을 직접 수정하지 않는다. cache miss·손상 시 정상 setup으로 재생성할 수 있어야 하고, cache hit가 check 성공을 의미하지 않는다. 자격증명과 private source는 cache 대상에서 제외한다. [GitHub의 cache와 artifact 구분 및 cache 신뢰 경계](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)

기존 checks 배열은 독립 sandbox라는 현재 의미를 보존한다. v2 pipeline으로 변환할 때 공유 workspace라는 의미 변화와 실행 순서를 보여 주고 설정 revision을 새로 만든다. accepted v1 시도를 새로운 공유 환경으로 재해석하지 않는다.

### 4.3 단계 2 수용 조건

실제 Linux에서 메모리·CPU·task 상한과 후손 포함을 확인한다. 작은 시험 예산 안에서 제한을 유발하고, host 전체 자원을 고갈시키는 시험은 하지 않는다. 요구 controller 미지원은 실행 전 판정된다. timeout·취소·OOM 뒤 broker가 응답하고 죽음 확인 전 재실행하지 않는다.

실제 pipeline에서 setup이 만든 dependency를 후속 step이 사용하고, checkout은 attempt당 한 번임을 관측한다. 다른 attempt에는 임의 파일이 남지 않는다. 정책 변경, cache key 충돌·손상, 정상 code generation과 원본 불변성 check, setup 중 취소, 동시 slot 대기와 재시작을 검증한다. mock 결과는 native 예산 집행 증거로 사용하지 않는다.

## 5 단계 3 변경안과 통합 시도 분리

### 5.1 항목 1 접수와 검토의 identity

새 merge.open은 B가 현재 main인지 요구하지 않는다. B와 C의 full OID·object format, C의 publication, B가 C의 ancestor인지, 인증된 작성자와 원본 변경 B→C의 보호 경로·tier를 확인한다. 현재 main이 B의 후손인 정상 전진 이력이면 검토를 시작할 수 있다. main이 강제 재작성되어 B를 포함하지 않으면 자동 병합 대상에서 보류하고 명시적인 base 갱신을 요구한다. 이를 일반적인 main 전진과 같은 stale로 처리하지 않는다.

request 이름은 유지하고 코드 수정마다 immutable revision을 추가한다. revise 입력은 expectedRevision, B, C, reason을 가지며 requester가 접수한다. 동시 revise는 expectedRevision으로 충돌을 드러낸다. 이전 리뷰는 읽을 수 있지만 변경된 코드에 자동 승계하지 않는다. 취소·Principal reject로 끝난 요청을 revise나 retry로 부활시키지 않는다.

main이 앞으로 움직였다는 사실은 request의 terminal stale을 만들지 않는다. original proposal, integration preparation, accepted attempt의 identity를 구분한다. 원본 제출의 작성자 판정에 broker가 만든 병합 commit이나 이미 main에 들어간 다른 변경의 작성자를 섞지 않는다.

### 5.2 자동 통합 준비와 반영 순서

검토가 충족된 요청은 같은 repository의 main writer 차례를 기다린다. 초기 구현은 단일 writer와 하나의 통합 pipeline을 사용하며 기존 operations에서 준비 대상을 파생한다. 별도 daemon·durable queue·추측 실행은 도입하지 않는다. ready 순서를 기본으로 하되 충돌·사용자 조치 대기 요청은 다음 요청의 준비를 막지 않는다. main 효과가 unknown인 writer는 예외로 같은 main을 계속 fence한다.

정상 실행은 다음 순서를 따른다.

1. 현재 main M, proposal revision, 정책과 작성자 증거를 관측한다.
2. M=B이면 I=C를 사용한다. C가 이미 M에 포함돼 있다면 새 CAS 없이 already-included를 별도 보고한다. 자기 시도의 applied로 꾸미지 않는다.
3. M이 전진했다면 Git의 정상 merge-base 계산으로 M과 C를 병합한다. 충돌이면 해당 파일·종류와 원본 diff를 Worker에게 보내고 blocked로 둔다. 모델을 호출해 자동 충돌 해결하거나 임의 ours/theirs 전략으로 진행하지 않는다.
4. clean merge이면 결과 tree를 갖는 임시 commit I를 만든다. 첫 parent는 M, 둘째 parent는 C로 하고 provenance는 별도 원본 제출 연결로 유지한다. 준비한 OID와 merge 설정을 고정한다.
5. M→I의 실제 변경에 대해 보호 경로·tier·검토 재사용 조건을 평가한다. 필요한 추가 검토가 있으면 정확한 결과를 첨부하고 기다린다.
6. 원본 proposal과 I, 정책, 승인 증거, 공지 자료를 묶어 git.integrate 시도를 접수한다. 긴 준비 중 revision·provenance·결정이 바뀌면 이 준비를 폐기하고 다시 평가한다.
7. 2단계의 pipeline으로 I를 검사한다. 검사 성공 뒤 현재 권한·정책·취소·작성자·승인과 main=M을 다시 확인한다.
8. CAS(M,I)가 반영됐음을 확인하고 실제 M→I diff의 완료 공지를 게시한다.

git merge-tree는 working tree/index를 수정하지 않고 정상 Git의 내용 병합·rename 처리를 수행할 수 있다. 반환 tree만 보고 성공을 판단하지 않고 exit status와 conflict 목록을 함께 확인한다. --merge-base로 B를 강제하여 Git이 계산한 다른 공통 조상을 무시하지 않는다. [Git 공식 문서](https://git-scm.com/docs/git-merge-tree)

준비 commit은 broker-owned immutable ref로 보호하고 accepted plan에서 그 ref·OID 관계를 검증한다. Worker publication으로 위장하거나 일반 미게시 candidate를 허용하는 우회는 만들지 않는다. 준비 중의 ref·파일은 owner가 정리하고, accepted 또는 acceptance unknown이면 보존한다. 원본 C와 준비된 I에 대한 publication 검증 경로를 명시적으로 구분한다.

### 5.3 승인 재사용과 통합 결과 검토

코드 검토는 request/revision의 B→C에 대한 결정이다. 최신 main과 합친 결과를 허용하는지는 별도 integration gate가 판단한다. 초기 정책은 다음과 같다.

| 변화 | 코드 검토 기록 | 새 통합에 필요한 조건 |
|---|---|---|
| main 변화 없음 | 재사용 | 현재 정책·권한과 I 검사 |
| main 전진, 원본 변경 대상의 내용·mode·경로 맥락 불변 | 재사용 | clean merge, 실제 delta 확인, I 검사 |
| main이 원본 변경 대상과 겹침 | 보존 | I의 맥락 검토, 현재 정책의 peer/Principal 조건, I 검사 |
| 충돌 해결 등으로 C 변경 | 이전 revision 기록으로 보존 | 새 revision 코드 검토와 I 검사 |
| 정책·tier 상승 또는 새 작성자 확인 | 보존 | 새 요구를 충족하는 결정과 작성자 제외 재평가 |

재사용 판정의 변경 대상에는 수정·추가·삭제의 양쪽 path, rename 전후 path, mode/type 변화와 directory/file 충돌 관계를 포함한다. 처음에는 해당 entry들이 B와 M에서 동일하고, M→I에 원본 변경 외의 예상하지 못한 변경이 없음을 확인하는 보수적 비교를 사용한다. patch-id 하나나 파일명 교집합만으로 동등성을 인증하지 않는다. 복잡한 이력·rename으로 판정을 증명하지 못하면 맥락 검토로 보낸다.

맥락 검토는 같은 request에 추가되며 scope가 integration-context이고 정확한 M, I, proposal revision, 정책·검사 profile에 결박된다. 기존 코드 리뷰와 혼동하지 않는다. 기존 tier가 MEDIUM/HIGH이면 해당 tier의 peer·Principal 조건을 적용한다. LOW인데 맥락 검토가 필요한 경우 첫 구현에서는 MEDIUM 이상으로 올리고 이유를 표시한다. 검토자 부족 시 기존 capacity fallback에 따라 명시적 Principal 결정을 요구한다. LOW의 모든 clean merge에 일률적인 사전 검토를 추가하지 않는다.

main이 다시 움직이면 기존 맥락 승인은 기록으로 남고 새 M/I에 그대로 복사하지 않는다. 새 준비가 자동 재사용 조건을 충족하는지 평가한다. 같은 파일의 서로 독립적인 변경도 초기에는 추가 검토가 생길 수 있으며, 이를 줄이는 정교한 영향 분석은 후속 개선이다. 의미적 독립성을 자동 증명하는 엔진은 만들지 않는다.

서로 다른 파일의 변경도 결합 후 동작을 깨뜨릴 수 있으므로 모든 새로운 I를 검사한다. 검사를 통과했다는 사실은 해당 check profile에 대한 증거이며 모든 의미적 상호작용의 부재를 보장하지 않는다. 이 방식은 최신 대상과 합쳐진 결과를 검사하는 merge queue의 책임 분리를 따른다. [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), [GitLab merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/)

### 5.4 main 이동과 복구

CAS 전에 main이 달라졌고 해당 시도가 반영되지 않았음이 확인되면 attempt만 superseded로 정산하고 새 M에서 다시 준비한다. 이때 Worker의 새 merge.open이나 코드 재제출을 요구하지 않는다. 재준비 이벤트는 합치고, 같은 M/revision에서 실패한 준비를 sweep마다 반복하지 않는다. 코드·base·정책 변경 또는 명시적 retry가 재실행 근거다.

CAS 수행 여부가 불명확하면 unknown으로 남긴다. 같은 request에 새 I를 만들어 결과를 덮지 않는다. 기존 frozen I의 ref·통합 기록과 main 관측으로 먼저 정산한다. main이 이미 I이거나 승인된 후속 이력에 I가 포함된 경우의 반영 증거를 명시적으로 확인한다. 단순히 C의 코드가 비슷하게 존재한다는 이유로 그 시도의 성공을 추정하지 않는다.

recovery는 accepted plan의 동일 M/I를 관측·정산한다. 새로운 main과의 병합은 정상 advancement가 만드는 새 시도다. accepted plan을 복구하면서 rebase·merge하여 I 자체를 바꾸지 않는다. 취소/철회가 CAS 전에 접수되면 최종 gate에서 반영을 막고, CAS 후에는 되돌리기 요청으로 처리한다.

challenge는 원본 C가 아니라 성공한 attempt의 실제 M→I를 대상으로 한다. broker-prepared revert는 그 실제 변경을 최신 main에서 되돌린 결과다. 첫 parent 정보와 applied attempt 연결을 사용해 다른 Worker가 먼저 넣은 변경까지 되돌리지 않도록 한다. challenge도 같은 준비·검토·검사·CAS 규칙을 따른다.

### 5.5 단계 3 수용 조건

실제 Git·Store·review 모듈로 다음을 확인한다.

- 같은 B에서 서로 다른 파일을 수정한 두 요청이 먼저 검토된 뒤, 재제출 없이 순서대로 반영된다. 두 번째 검사 대상은 첫 번째 변경을 포함한 I다.
- 각각 검사하면 통과하지만 합친 결과에서 불변식이 깨지는 반례는 두 번째 I 검사에서 막힌다.
- 같은 파일의 clean merge, rename/delete, mode 변경, binary 변경과 복수 merge-base에서 재사용·맥락 검토·충돌 판정이 일관된다.
- 검사 중 main 이동은 기존 시도와 다음 시도를 분리한다. CAS 직후 kill은 새 병합 실행으로 처리되지 않는다.
- 새 revision, 동시 revise/retry/cancel, provenance drift, policy 변경은 예전 승인으로 통과하지 않는다.
- already-included와 실제로 이 시도가 반영한 applied를 구분하며, 되돌리기는 M→I만 대상으로 한다.

## 6 단계 4 누적 비용

### 6.1 항목 8 인증된 작성자 조회 인덱스

작성자의 의미는 기존 구현과 같다. D=commits(B..C)와 각 인증된 제출의 도달 가능한 commit 집합이 교차하거나 제출 candidate가 C이면 해당 actor가 작성자다. failed submission은 제외하고 pending submission은 올바른 published ref가 실제로 존재할 때만 포함한다. Git commit의 author/committer 문자열을 신원으로 쓰지 않는다.

repository owner에 재생성 가능한 메모리 인덱스를 둔다. 입력은 제출 operation의 상태·actor·candidate·publishedRef와 실제 ref 관측이다. commit→인증된 submitter 집합을 만들고, 현재 candidate의 commit 집합과 교차한다. 캐시는 원본이 아니며 restart 뒤 정확히 재구성한다. 새 durable DB/table을 추가하지 않는다.

ref는 묶어서 관측하고 Git 객체의 traversal은 batch process 또는 재사용 가능한 object reader를 사용한다. 제출마다 별도 Git 프로세스 두 개를 띄우는 구조를 없앤다. 새 제출이 기존 commit을 포함하면서 새로운 actor를 추가할 수 있으므로, 이미 본 commit이라는 이유로 actor 관계 갱신을 생략하지 않는다. 초기 재구성과 대규모 새 제출 비용은 피할 수 없으며 관측 지표로 드러낸다.

제출 접수·상태 정산·publication 변경은 인덱스 generation을 바꾼다. mail freeze 등 비동기 준비 뒤 acceptance 직전에 generation과 실제 ref identity를 재확인한다. 바뀌면 작성자를 재계산하고 준비된 author/approval 결과를 재사용하지 않는다. ref mismatch는 손상, 조회 실패는 unknown이며 빈 작성자 집합으로 대체하지 않는다. 외부 변경도 놓치지 않도록 canonical ref 관측을 캐시 generation만으로 생략하지 않는다.

첫 구현의 성능 목표는 warm 조회에서 제출 수에 비례하는 Git 프로세스 실행 수를 없애는 것이다. 묶음 ref 출력의 bytes와 처리량은 전체 ref 수에 따라 늘 수 있으므로 전체 작업량 O(1)을 주장하지 않는다. cold rebuild와 warm query, preaccept 재검사를 따로 측정한다. query 경로의 Git 프로세스 수는 제출 수에 무관한 고정된 batch 호출 수여야 한다.

수용 시나리오: 1·8·32·128개 제출에서 기존 정확한 oracle과 actor 집합이 같고 warm query의 subprocess 수가 일정하다. shared ancestor를 가진 새 actor, failed/pending 제출, ref 부재·치환, mail freeze 중 새 제출, 재시작을 포함한다. 최근 고친 provenance race를 다시 여는 최적화는 불합격이다.

### 6.2 항목 9 검색 대상 선별 후 내용 복사

Principal의 contained search가 먼저 전체 regular file 내용을 복사하는 흐름을 바꾼다. 허용된 root 안에서 경로·ignore 제어 파일을 관측해 검색 대상 목록을 만들고, 선택한 파일의 내용만 descriptor containment 아래 복사한다. Worker의 일반 Pi 검색 경로는 별도의 현재 동작으로 유지한다.

ignore 규칙은 pinned ripgrep의 기존 정책을 재사용한다. 중첩 .gitignore/.ignore, negation, hidden, glob, 명시적 파일 경로의 우선순위를 별도 수기 parser로 흉내 내지 않는다. 안전한 이름/ignore-file projection에서 ripgrep으로 파일을 선택하고 실제 내용은 held/no-follow 접근으로 읽는 방식을 기본 설계로 한다. placeholder metadata만으로 binary 여부를 확정하지 않고 선택된 실제 내용의 검색에서 판정한다. [ripgrep의 자동 필터링 규칙](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md#automatic-filtering)

대상 root 외부의 global config·parent ignore를 새로 가져오지 않는다. 현재 search policy가 허용하는 ignore 원본을 명시하고 projection에 포함한다. skip된 디렉터리 안의 negation 재포함 의미를 보존한다. 포함될 가능성이 있는 파일 이름 관측은 필요할 수 있지만, ignore된 대용량 payload를 읽고 복사하지 않는다. 경로 목록 자체가 크면 그것도 streaming/spool로 처리한다.

선별과 내용 복사 사이의 rename·symlink 교체·ignore 파일 변경은 확인한다. root 밖을 읽거나 조용히 다른 파일을 검색하지 않는다. 일관된 관측을 만들지 못하면 명시적인 변경 감지 결과를 반환한다. mutable workspace 전체를 commit ID만으로 캐시해 uncommitted 변경을 누락하지 않는다. 첫 구현에서는 검색 간 내용 snapshot 캐시를 넣지 않고 불필요한 payload 복사 제거에 집중한다.

수용 시나리오: 32 MiB 이상 ignored 파일의 내용 복사량은 0이고 검색 결과는 동일하다. 중첩 ignore·negation·hidden·glob·명시 파일·한글 경로·rename·symbolic link race를 포함한다. 지표는 총 경로 수, 선택 파일 수, 읽고 복사한 bytes, elapsed다. 특정 머신에서 한 번 측정한 밀리초를 일반 성능 보장으로 쓰지 않는다.

### 6.3 항목 11 종료와 cold 보관 분리

정상 close의 기본 목표는 실행을 안전하게 끝내고 재개 가능한 hot session을 남기는 것이다. 입력 중단, accepted 작업의 정산/보존, Worker/native scope 종료 확인, 원장·필수 메타데이터 flush와 Store.close까지 수행한다. 이 경로에서 전체 workspace hash·restic backup·dump 검증·원본 삭제를 의무적으로 실행하지 않는다.

새 설정은 storage.closeMode=keep-hot을 기본으로 한다. archive는 별도의 host 행동이며, 사용자가 선택한 on-close 보관 모드는 유지할 수 있다. 선택적인 retention/여유 공간 정책은 닫힌 session에 대해서만 검증 archive를 시작할 수 있다. 종료한 프로세스에서 계속 일할 것처럼 background 작업을 남기지 않는다. 실행 가능한 기존 host process가 없으면 보관은 다음 명시적 실행까지 대기한다.

| 저장 상태 | 원본의 위치와 재개 규칙 |
|---|---|
| hot | workspace가 원본이다. 일반 종료·권한·원장 검증 뒤 바로 사용 |
| archiving | hot 원본을 유지하고 backup·검증 중이다. 실패하면 hot으로 유지 |
| cold | 검증 checkpoint를 durable하게 선택했다. 원본 회수를 재개할 수 있음 |
| restoring | cold를 원본으로 유지하며 독립 staging에 복원·검증 중 |

이 표는 기존 session storage manifest를 versioning한 표현이며 새 일반 job 원장을 뜻하지 않는다. archive/resume는 동일 session lock과 generation으로 경합을 막는다. 복원을 시작한 동안 hot으로 잘못 인식하거나, archive가 사용 중인 workspace를 삭제하지 못하게 한다. active session은 eviction 대상이 아니다.

cold 전환 순서는 기존의 quiesce, 원본 관측, backup, inventory·내용 검증, 원본 재확인, 저장소 flush, immutable checkpoint 게시, cold 선택 flush, 원본 회수를 유지한다. 회수 중 죽으면 선택된 cold checkpoint에서 다시 진행한다. 검증 실패나 disk-full이면 원본을 남긴다. ignored 파일·untracked 작업·Worker HOME은 사용자 데이터로 계속 보존한다. 검색의 ignore 최적화 규칙을 archive에 적용하지 않는다.

hot resume에서는 restore나 전체 content hash를 수행하지 않는다. cold resume은 기존 검증 절차를 유지한다. 중복 hash를 줄이는 후속 최적화는 동일 held tree와 불변성 증거로 대체할 수 있는 경우에만 별도 검증한다. 이번 단계는 full verification을 없애는 것이 아니라 정상 close/resume의 필수 경로에서 cold 변환을 분리하는 것이다. restic의 증분 change detection만으로 OMA의 삭제 전 검증을 대체하지 않는다. [restic 공식 문서](https://restic.readthedocs.io/en/stable/040_backup.html#file-change-detection)

수용 시나리오: 큰 ignored tree·HOME을 가진 session의 keep-hot close에서 backup/전체 digest 호출은 0이고 다음 hot resume도 restore가 0이다. 명시적 archive/restore 후 ignored·untracked·HOME bytes와 지원 metadata가 같다. backup·checkpoint 게시·cold 선택·부분 회수·restore publish 경계마다 kill/restart를 넣고, archive/resume 경합·special file·권한 실패·공간 부족에서 원본을 잃지 않는다.

## 7 기존 기록과 설정의 호환성

### 7.1 과거 사실과 새 판정의 경계

이 설계는 현재 문서의 요청당 단일 통합, 최신 main 접수, enabled reviewer 판정, 자원 quota 미지원, 종료 시 archive 규칙을 변경한다. 따라서 구현 시 해당 owner 계약과 새로운 DR, closed DTO/codec, config validator, 파생 상태, 필요한 migration 및 시험을 함께 수정한다. 설계안 작성만으로 기존 DR이 철회되거나 구현이 승인·완료된 것으로 기록하지 않는다.

기존 terminal operation·stale/cancelled/rejected request의 원본 bytes와 당시 receipt는 그대로 읽는다. 새 버전으로 시작했음을 이유로 과거 요청을 자동 부활시키지 않는다. 기존 pending/unknown 통합은 원래 accepted plan으로 먼저 관측·복구하며 새로운 main에 맞게 수정하지 않는다.

기존 미완료 review를 새 계약으로 계속 진행하려면 request를 가리키는 명시적인 adoption fact를 기록한다. adoption은 원본 변경안·review locator와 새 의미가 적용되는 시점을 포함한다. 기존 reviewer 자격을 접수 당시 증거로 확인할 수 있으면 재사용하고, 확인할 수 없는 자격을 현재 상태에서 역산하지 않는다. 이 경우 필요한 새 vote를 요청한다. 검사 실패 요청의 명시적 retry는 adoption과 새 attempt 생성을 함께 요청할 수 있지만 원래 실패 receipt는 유지한다.

active accepted attempt가 있으면 adoption을 대기시킨다. 새 version을 쓴 저장소는 이를 해석하지 못하는 구버전 실행을 storage/config version gate로 막는다. migration은 backup과 원본 보존을 전제로 중단·재시도 가능해야 한다. downgrade를 위해 새 기록을 삭제하지 않는다.

### 7.2 설정 변환

resource profile, pipeline policy, storage.closeMode, Society seed 최소 개수는 versioned config의 단일 검증·generation 게시 경로를 사용한다. 저장과 읽기의 validator가 다르면 안 된다. 기존 0명 설정은 legacy recovery 상태로 읽고 첫 Worker 복구 후 정상 config로 전환한다.

기존 독립 checks는 자동으로 공유 pipeline이 되지 않는다. 사용자가 정한 명시적 보관 설정은 보존한다. 이전 버전에 명시적 선택 없이 적용되던 자동 archive는 migration 안내에서 keep-hot 기본값과 disk 사용 증가를 표시한다. 이미 accepted된 실행에는 새 자원·검사 설정을 소급 적용하지 않는다.

### 7.3 저장 형식과 공개 표면

새 fact와 operation plan은 명시적인 version을 갖고 decoder가 지원 version을 분기한다. 과거 fact에 필드를 채워 새 version인 것처럼 재직렬화하지 않는다. proposal revision, retry, review 철회, 맥락 검토, 준비 실패는 기존 attestation 수락 owner의 제한된 확장이다. 범용 event bus나 숨은 JSON key/value entity를 추가하지 않는다.

표면 변경은 기존 typed 도구의 review/status/read action에 모으되 서로 다른 입력을 optional 필드 덩어리로 만들지 않는다. action별 discriminated input을 사용한다. requestKey와 expectedRevision/expectedAttempt는 재실행·경합을 판정하는 실제 계약이다. 사람이 쓰는 host 복구·보관 경로와 모델 권한을 구분한다.

## 8 검증 계획과 단계별 완료 기준

아래 ID는 이 변경안의 시나리오 식별자다. 기존 verification-spec의 T 번호나 과거 acceptance 결과를 재사용하지 않는다. 구현 cutover 때 정식 시험과 source owner에 연결한다. 현재 판정은 모두 **NOT_RUN**이며 과거 감사 재현은 문제의 근거로만 사용한다.

| 시나리오 | 대상 | 판정할 결과 |
|---|---|---|
| IMP-R01 | 2 | 미완료 복구를 해제하기 전에 독립 wake·review 관측 완료 |
| IMP-R02 | 2 | 같은 main/scope fence, 반복 trigger, startup/shutdown에서 중복 없음 |
| IMP-R03 | 3 | reviewer stop/wait/retire 후 vote 유지, 명시적 revoke는 반영 |
| IMP-R04 | 3 | requester 권한·새 provenance·정책 변경은 별도 gate에서 거절 |
| IMP-R05 | 4 | 같은 요청에서 첫 검사 실패·둘째 성공, 원래 승인과 실패 보존 |
| IMP-R06 | 4 | 동시 retry·같은 key replay·unknown에서 중복 attempt 없음 |
| IMP-R07 | 5 | 큰 결과와 긴 한 줄의 bounded preview, 전체 range 재구성 |
| IMP-R08 | 5 | spool 실패·취소·권한·치환에서 inline 폭증이나 유출 없음 |
| IMP-R09 | 7 | 신규 0명 거절, legacy 0명 host 복구, 중복 bootstrap 없음 |
| IMP-R10 | 12 | oversize·준비 실패가 blocked, actual applied와 notice pending 구분 |
| IMP-R11 | 12 | 큰 자동 diff 첨부를 수신자가 읽음, 해시·OID·내용 일치 |
| IMP-B01 | 6 | 실제 controller 적용·후손 포함·미지원 사전 거절 |
| IMP-B02 | 6 | timeout/OOM/task limit 후 broker 생존, 종료 확인 전 슬롯 재사용 없음 |
| IMP-B03 | 10 | 한 checkout·HOME에서 setup→check, retry는 fresh 환경 |
| IMP-B04 | 10 | cache miss/손상·code generation·원본 불변성 check·정책 변경·취소의 정확한 결과 |
| IMP-I01 | 1 | 같은 base 두 요청을 재제출 없이 순서대로 통합 |
| IMP-I02 | 1 | 개별 PASS·결합 FAIL 반례가 main에 들어가지 않음 |
| IMP-I03 | 1 | overlap/rename/binary/복수 base에서 승인 범위와 conflict 정확 |
| IMP-I04 | 1 | main 이동·CAS kill·cancel/revise 경합에서 사실 보존 |
| IMP-I05 | 1 | already-included 구분, challenge가 실제 적용 delta만 되돌림 |
| IMP-C01 | 8 | 제출 수 증가에도 warm Git 호출 수 일정, 작성자 집합 동일 |
| IMP-C02 | 8 | freeze 중 새 제출·ref 치환·재시작에서 provenance 보존 |
| IMP-C03 | 9 | ignored payload 복사 0, 기존 검색 결과·containment 동일 |
| IMP-C04 | 9 | ignore/rename race·uncommitted 변경에서 stale 결과 은폐 없음 |
| IMP-C05 | 11 | hot close/resume의 full archive/restore 호출 0 |
| IMP-C06 | 11 | cold 전환·회수·restore 경계 kill과 경합에서 데이터 보존 |
| IMP-M01 | 공통 | v1 receipt replay, adoption, migration 중단·재시도·구버전 거절 |

각 단계는 해당 시나리오, 관련 기존 회귀, build/typecheck, architecture·문서·spec 검사로 닫는다. 프로세스/파일/ref 효과는 실제 Linux·Git·Store 관측으로 확인한다. mock은 특정 경합을 제어하는 증거로 구분한다. 모델-facing 도구 변경은 scripted scenario와 실제 설정된 Principal/Worker smoke를 구분해 기록한다. smoke 성공을 모든 provider 지원이나 benchmark 완료로 확대하지 않는다.

1단계가 끝나면 같은 작업에서 불필요한 wake 지연·승인 소멸·재요청·거대 inline 출력이 제거되고 상태가 사실과 맞아야 한다. 2단계가 끝나면 선택한 예산의 집행 및 pipeline 재현성을 확인할 수 있어야 한다. 3단계가 끝나면 최신 main 준비를 시스템이 담당하고 검토와 통합 시도의 이력이 구분되어야 한다. 4단계가 끝나면 동일 의미를 유지하면서 이력 조회·검색 입력 복사·일상 close/resume의 불필요한 비용이 줄어야 한다.

## 9 관측 지표와 benchmark 진입

성능 수치는 동일 source·config·입력·host 조건에서 before/after로 비교한다. 통과 기준은 작업을 생략해 빨라지는 것이 아니라 동일 결과와 보존 조건을 만족하면서 해당 낭비가 사라지는 것이다.

| 영역 | 기록할 지표 |
|---|---|
| 진행 | mail accepted→모델 batch handoff, wake 이유, 복구 대기 시간, 자원별 fence 이유 |
| 검토 | 요청·revision·attempt 수, 승인 재요청 이유, 맥락 검토 비율, 재제출 수 |
| 통합 | preparation/check/CAS/notice 단계 시간, 검사 대상 OID, main 이동 횟수 |
| 출력 | preview bytes, 전체 결과 bytes, partial 이유, range read 횟수 |
| 자원 | 요청/실제 예산, peak memory·swap·tasks, CPU throttling, OOM, disk free, check queue 시간 |
| 검사 환경 | checkout/setup/check 시간, cache hit/miss, fresh/cached 실행의 결과 일치 |
| 누적 비용 | submission 수, warm/cold Git 호출·조회 bytes, 검색 선택/복사 bytes, close/resume/archive 시간 |

이 지표는 진단이며 새 완료 판정이나 모델 비용 한도를 만들지 않는다. 토큰·provider 비용은 엔진이 제공하는 실제 usage를 사용하고 없으면 unavailable로 남긴다. mean 하나로 긴 정체를 숨기지 않고 sample 수와 p50/p95, 최댓값을 함께 기록한다.

SWE-Milestone는 먼저 사용자가 선택한 가장 짧은 1개와 동시 채점으로 측정한다. 이 명세가 실제 실행을 시작하는 지시는 아니다. 나머지 6개 및 3+3 진행 여부는 그 peak resource와 완료 시간·채점 overlap 결과를 본 뒤 사용자가 결정한다. 공통 부모 예산 바깥의 grader가 있으면 관측 범위에 별도로 표시하고 전체 자원 여유를 계산한다. 한 번의 단독 PASS로 3개 동시 실행 가능을 확정하지 않는다.

## 10 구현 묶음과 변경 경계

| 묶음 | 변경 | 의존성 | 완료 후 다음 작업 |
|---|---|---|---|
| P1a | 2의 독립 진행, 3의 vote 자격·quorum, 7의 seed/복구 | 공통 상태·권한 원칙 | 진행과 승인 회귀 확인 |
| P1b | 4의 versioned attempt/retry, 12의 상태·준비 실패 | P1a, 저장 형식·adoption | 과거 실패 보존과 retry 확인 |
| P1c | 5의 결과 spool/range, 12의 큰 diff 첨부 | 파일 소유와 공개 권한 | 모델-facing scenario 확인 |
| P2 | 6의 예산과 10의 pipeline | P1의 attempt·상태 | Linux 집행·setup 재사용 검증 |
| P3 | 1의 proposal revision·자동 통합·맥락 승인·challenge | P1b와 P2 | 실제 Git 경쟁·kill 회귀 |
| P4a | 8의 provenance 인덱스 | P3의 원본 작성자 의미 | 정확성 oracle·프로세스 수 비교 |
| P4b | 9의 선별 복사 | P1c의 streaming 출력 | ignore 동등성과 복사량 비교 |
| P4c | 11의 hot 종료와 독립 archive | P1의 shutdown owner, 결과 파일 보존 | close/resume·cold crash 회귀 |

각 묶음에서 구현 코드와 함께 해당 계약 owner, 필요한 새 DR, protocol/config codec, 테스트·migration을 갱신한다. source digest·graph는 실제 생성 도구로 갱신하고 authored review를 새 입력의 승인으로 바꾸지 않는다. 이 설계안을 마칠 때는 명세와 문서 지도만 변경한다.

첫 구현에서 미루는 것은 추측 merge 병렬화, 의미적 영향 분석, 성공 step만 골라 재실행, 범용 durable scheduler, full workspace 공유 cache, archive 검증 강도 완화다. 모두 위 12개 문제를 해결하는 데 필수적이지 않으며, 향후 측정된 병목이 있을 때 별도로 설계한다.
