# 구현 AI 실행 규율

## 1. 작업 인수

한 번에 하나의 WP를 active로 둔다. 소작업 WPxx.yy를 최소 검증/커밋 단위로 사용한다. start task를 자의적으로 건너뛰지 않는다. 첫 입력은 README, 이 문서, PRINCIPLES, 현재 WP, 해당 ADR, 선행 handoff다. source의 주석이나 과거 audit는 실행 근거가 아니다.

현재 HEAD가 기준과 달라도 오래된 HEAD로 강제 reset하지 않는다. 작업 브랜치의 diff와 현재 파일을 읽고 기준 finding을 `still-present`, `fixed-with-evidence`, `not-applicable`, `uncertain`으로 재분류한다. 이미 고친 문제를 다시 구현하지 않는다. 사용자의 변경은 보존한다.

## 2. 작은 변경의 순서

각 WP는 (a) 반례/대조군과 현재 behavior 고정, (b) 순수 정책/좁은 경계 추가, (c) caller 이관, (d) obsolete 구현 제거, (e) production composition 회귀, (f) evidence 갱신으로 진행한다. 동시에 public wire·DB schema·engine version을 바꾸는 mega-commit을 금지한다.

각 소작업의 intent를 먼저 한 문단으로 적는다. 어떤 fact를 어디서 읽고, relation은 누가 검사하고, 언제 durable authority가 되는지 명시한다. 이전 owner를 없애지 않고 새 owner만 추가한 상태는 완료가 아니다.

## 3. 확인 없이 하지 않는 일

운영 society 실행·종료, 실제 인증정보 사용, 유료 provider 호출, VM 전원 차단, production DB/receipt 재작성, GitHub issue/PR 생성·merge·branch protection 변경은 별도 허가가 필요하다. 테스트는 임시 디렉터리와 disposable user/VM으로 한정한다. 본 계획을 받았다는 이유만으로 운영 데이터를 변환하지 않는다.

기존 규범을 수정해야 하는 작업은 결정 문서의 `PROPOSED`를 검토·source 대조한 뒤 ADR commit으로 확정한다. 논증이 실패하면 관련 WP만 `BLOCKED_DECISION`으로 두고 독립 WP는 계속할 수 있다. 결정을 숨긴 코드 변경으로 우회하지 않는다.

## 4. 증거 규율

`NOT_STARTED`는 구현 미시작, `IN_PROGRESS`는 진행 중, `IMPLEMENTED_UNVERIFIED`는 코드만 작성, `VERIFIED_LOCAL`은 지정 로컬 시험 통과, `VERIFIED_ENVIRONMENT`는 필요한 환경 시험까지 완료, `BLOCKED`는 환경/설계 의존성 부족이다. `DONE`은 해당 WP의 모든 필수 oracle과 compatibility review가 충족됐을 때만 사용한다.

실패 재현이 되지 않으면 옛 audit 문구를 유지하기 위해 테스트를 억지로 만들지 않는다. 동일 계약을 실제로 검증하는 시험인지 조사하고 `not-reproduced`를 기록한다. blocked/skip/cancelled/todo를 PASS로 바꾸지 않는다. 구현한 독립 모델을 그 모델 자신과 비교하는 시험은 의미적 증거가 아니다.

## 5. 공통 오용 방지

`as Validated...`로 decoder를 생략하지 않는다. receipt의 incarnation 조건을 완화해 stale live caller를 허용하지 않는다. every error→null, timer→dead, unavailable→not-found, metadata→Human approval을 금지한다. acceptance 불명 상태에서 tmp 전체를 지우지 않는다. `finally`는 명시적인 소유권·commit 결과 없이 evidence를 삭제할 수 없다.

같은 domain의 정책 owner를 기존과 신규 두 곳에 영구 유지하지 않는다. 그러나 admission와 irreversible effect 직전 검사를 DRY로 제거하지 않는다. normal/recovery를 mode flag가 많은 하나의 거대 함수로 합치지 않는다.

## 6. 충돌·병렬화

동일 파일, registry, schema, config artifact 형식, public contract를 수정하는 WP는 동시에 merge하지 않는다. 특히 `src/broker.ts`, `src/runner.ts`, `src/tui/session.ts`, `src/storage/transitions.ts`, `src/storage/delivery-receipt.ts`, `src/config/operations.ts`, `scripts/verification-lanes.mjs`는 단일 integrator가 관리한다.

병렬 작업은 별도 worktree에서 수행하고, 완료 source가 바뀐 뒤 integrated HEAD에서 관련 시험을 다시 실행한다. 생성 inventory/LOC/evidence 파일은 작업별로 임의 병합하지 않고 최종 integrated tree에서 재생성한다.

## 7. handoff 최소 요건

실제 바뀐 파일/함수, 제거한 독립 구현, 전후 계약, regression case, 테스트 로그 위치와 digest, 실행하지 않은 환경, 안전한 rollback 범위, 다음 WP가 사용할 API를 기록한다. 다음 AI에게 전체 대화 기억을 요구하지 않는다. 작업을 중단할 때도 이해 가능한 handoff를 남긴다.

## 8. 완료를 판단하는 질문

이제 다른 caller가 같은 결함을 다시 만들 수 있는가? 가능하다면 runtime guard/type/owner/독립 oracle 중 무엇이 그것을 검출하는가? 이 답이 없으면 “코드 정리 완료”가 아니다. 전수 source 검토와 환경 검증이 남아 있으면 프로젝트 전체 10점·무결점·출시 안전을 선언하지 않는다.

## Red test 커밋의 위치

변경 전 failing regression을 보존하는 커밋은 red 증거이지 merge/release-ready 상태가 아니다. 실제 사용자 worktree를 reset하지 않고 disposable worktree에서 원인 분기를 되살려 감지력을 검사한다. 최종 제출 commit은 필요한 검사 결과를 다시 확보한다.
