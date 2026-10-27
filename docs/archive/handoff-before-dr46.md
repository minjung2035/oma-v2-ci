# OMA v2 — 현재 인계 (2026-10-12)

## 실제 모델의 구현·리뷰·merge 실행 (2026-10-12)

Human의 요청은 자동 테스트 실행이 아니라 실제 코딩 task 수행이다. 격리한 expense-report
프로젝트를 실제 설치 진입점으로 열고 Principal·seed Worker·Worker가 만든 리뷰어 2명 모두
`openai-codex/gpt-6.1-sol`, `medium`으로 실행했다. 실제 OAuth inference, systemd unit와
bwrap를 사용했다. 한 Worker가 정확한 금액 집계·JSONL CLI·CSV·필터·검증·문서·회귀를
구현하고 HIGH 요청의 `peer-needed`에서 부족한 두 리뷰어를 직접 생성했다. 모델 세션과
durable operation에서 각 역할의 선택 모델·effort·독립 표를 확인했다.

실행 도중 두 번째 표에서 `INTERNAL_ERROR`가 재현됐다. 접힌 approval-policy 헤더의 wire
공백이 정책 ID에 들어가 frozen claim과 달랐다. `mail/headers.ts`에서 decoding 전에
wire 공백만 정리하고 encoded revision 자체의 공백은 보존한다. 새 회귀는 수정 전 FAIL,
수정 후 PASS다. 제품을 정상 종료·재빌드·재개한 뒤 같은 키의 실패 표가 기록됐다. 배포
변경으로 정책 revision이 바뀌어 Worker가 옛 요청을 취소하고 같은 패치의 새 HIGH 요청을
열었다. 옛 사실을 수정하지 않고 두 동료와 Principal이 새 실제 표를 남겼다.

최종 요청 `merge-95baec00-1f41-421f-992c-35e85ade1a76`의 integration은 succeeded이고
canonical main은 `b18f625384c019a81b290932f6347f6696867bd8`다. Worker의 main 재검사
12/12와 별도 요구사항 44/44가 통과했다. 제품 정상 종료와 세 Worker unit inactive를
확인했다. 상세 증거는 [실행 기록](../test/audit/real-task-2026-10-12.evidence.json)과
`/home/dev/oma-audit-artifacts/real-task-6.1-sol-medium-2026-10-12/result.json`에 있다.
전체 local suite·native macOS 실행 결과는 이 실행으로 갱신하지 않는다.

## Worker 리뷰어 보충 안내

Human이 merge/challenge 리뷰어를 Worker 소환으로 보충하는 방법을 시스템 프롬프트에
명시하도록 요청했다. 기준 `0d84ff34`에서 내장 Worker의 영문 model input과 한국어 comment를
함께 수정했다. 기존 동료에게 먼저 리뷰를 요청하고 자격 있는 인원 자체가 부족할 때만
필요한 Worker를 생성한다. brief는 요청 이름과 정확한 diff·관련 검사·자신의 approve/reject를
지시한다. enabled와 요청자/인증된 제출자 제외, 자식의 별도 reviewer 자격, 생성과 승인의
구분, 기본 challenge 정족수와 Principal/broker의 역할을 안내한다. 권한·투표 정책은 그대로다.

build·typecheck와 기존 role-prompts/prompt-boundary/resident-confinement 35/35가 통과했다.
현재 결과는 [validation](implementation/validation.md)의 최신 절이 소유한다. 아래 DR44의
전체 suite·crash 숫자는 당시 입력의 기록이며 이 프롬프트 변경의 실행으로 재사용하지 않는다.

## DR44 인계 (2026-10-11)

기준은 `067bb7c`다. Human이 8.4점 정적 평가와 추가 17개 개선 후보를 제공하고 코드 품질과
구조적 변경 비용을 개선하도록 요청했다. 필수 문서·영향 owner를 직접 읽고 서브에이전트 없이
수정·검증·승인된 커밋·푸시를 진행한다. 이전 인계는 [DR43 인계](archive/handoff-before-dr44.md)에 보존했다.

Review facade에서 authority read·preparation·messages·acceptance·advancement·status를 나눴다.
ReviewAcceptance만 T를 소유한다. Integration은 미리 구성된 ReviewAuthorityReader의 작은
port를 사용하며 Review workflow를 다시 호출하지 않는다. frozen 준비 계획을 cast로 변경하던
recipient 처리와 합성 operation provenance cast를 제거했다. Principal의 turn arbitration은
순수 TurnAdmission, spawn 입력은 principal-launch, 표시 projection은 principal-events다.
PrincipalSession·HostTenure의 실제 child lifetime은 유지한다. BrokerListeners는 listener 준비와
실제 close만 소유하고 Broker가 최종 drain·Store·lease를 반환한다.

Pi autocomplete는 공개 wrapper/constructor를 사용하며 prototype/private fdPath를 바꾸지 않는다.
남은 tool-init private import 우회는 Pi/Pi TUI 1.0.1 preload·export 계약 검사로 제한한다.
Store type SCC와 diagnostics 상향 타입 edge를 제거했고 native adapter와 Society UI에도 좁은
port를 적용했다. 직접 생성한 graph는 454 files, runtime/type union cycles와 type-only 상향 edge 0이다.
evidence:refresh는 파생 구조만 생성하고 stale authored review를 거절하며 runtimeProof:false다.
검증 실패·fresh 실행은 [validation](implementation/validation.md)에 기록한다. 초기 기준 dist의
통과 숫자는 수정 코드의 증거로 재사용하지 않는다. 남은 미검토 49개도 자동 승인하지 않는다
(기준 50개 중 review.ts의 실제 변경을 이번에 직접 검토했다).

Pi의 stale ctx.cwd capture를 제거하고 Personal 저장 확인을 reload 뒤 현재 UI에 보낸다.
최종 Pi·Personal PTY 집중 검증은 20/20 PASS다. 자식 실행 오류가 status 0을 동반하면 build가
성공으로 끝나던 추가 결함도 수정했고 discovery/compile/package 세 단계의 실패 회귀를 유지한다.
최종 전체 local suite 4,021/4,021과 실제 primitive crash 63/63이 통과했다. 공통 입력
15,463개의 실행 전후 변경과 lane 입력 차이는 0건이다. build·typecheck·architecture도 PASS다.
결과와 실패 기록은 [DR44 evidence](../test/audit/architecture-quality-2026-10-11.evidence.json)에
보존한다. 결과 기록 bytes의 후속 metadata/structure 검사는 외부 `clean-post-record-result.json`에 고정한다. production code는
runtime 실행 뒤 변경하지 않는다.

native Mac·VM power loss·paid provider·release·별도 kernel qualification은 NOT_RUN이다.
기존 startup 목표 미달, 나머지 Pi private UI hook과 Society root의 deferred UI/transition
연결은 남는다. 두 ledger와 세 process lifetime은 각자의 의미 owner를 유지한다.
