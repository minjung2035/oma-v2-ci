# 최종 승인 기준 — 체크 개수보다 증거의 완전성

## A. 계획 완료와 제품 검증을 구별한다

이 패키지의 문서·링크·dependency·test-ID·파일 배정 검사는 **계획 구조 검사**다. 그것이 PASS여도 제품 구현과 제품 검증은 NOT_RUN이다. `PLAN-QA.json`을 source test evidence에 넣지 않는다.

구현 상태는 아래 세 수준으로 나눈다.

| 수준 | 필요한 사실 |
|---|---|
| CODE_COMPLETE | required 구현과 회귀 시험이 작성되고 compatibility decisions가 반영됨 |
| LOCAL_VERIFIED | source-bound type/build/architecture/local/durable/property/stress 시험이 실제로 통과 |
| RELEASE_QUALIFIED | 선언한 지원 topology에 필요한 actual engine/pty/kernel/crash와 별도 요구 powercut/provider 증거까지 확보 |

필수 lane이 BLOCKED이면 그 수준은 달성되지 않았다. “환경만 없을 뿐 완료”를 RELEASE_QUALIFIED로 표시하지 않는다.

## B. 필수 기술 조건

**Identity:** old run authority는 새 effect를 승인하지 않는다. batch rollover는 유효한 기존 receipt를 무효화하지 않는다. exact ordered manifest와 최초 completion 사실은 보존된다.

**Evidence:** 부재·관측 실패·충돌이 구별된다. 유효 receipt의 settlement는 engine redelivery 없이 재시도된다. 증거가 없다는 이유로 arbitrary external effect의 부재를 선언하지 않는다.

**Durability:** receipt final name은 no-replace와 parent flush까지 관측한다. 설정 관리형 generation은 manifest 하나가 commit point이며 혼합 세대를 정상으로 읽지 않는다. 프로세스 crash와 powercut 결과가 구분된다.

**Configuration:** 모든 성공한 편집 결과가 실제 전체 validator를 통과한다. stale edit lost-update가 일어나지 않는 managed writer critical section이 있다. optional missing extension 제거·core 보존·unknown field 보존/거절 의미가 명확하다.

**Ownership:** unaccepted artifact는 확실한 미수락과 quiescence가 확인될 때만 정리한다. accepted/uncertain evidence가 연결 cleanup에 따라 삭제되지 않는다. cleanup의 일부 실패로 다른 자원의 정리가 생략되지 않는다.

**Resources:** read/admit/settle/safety-control의 정책이 연결된다. hard quota가 없는 profile을 hard bounded라고 주장하지 않는다. queue·waiter·temporary·generation retention과 초과 결과가 명시돼 있다.

**Lifecycle:** support topology마다 current lease/death proof/old action fencing이 actual kernel 시험으로 확인된다. custom config locator는 실제 Resident까지 전달된다. terminal method의 기존 현재 권한 조건이 일반화 과정에서 사라지지 않는다.

**UI:** configured/committed/active와 queued/written/engineAccepted/settled가 사실대로 표현된다. stale/unknown view를 zero/idle로 숨기지 않는다. 미전송 입력은 구별돼 반환된다.

## C. 필수 증거 조건

각 F01–F12/N01/N02/Q01/Q02는 재현/설계개선/이미수정/반증/의도된 제한 중 하나의 판정과 근거를 갖는다. H01–H05는 실제 검증 또는 명시 미해결로 남기며 단지 계획에 포함했다고 closed로 바꾸지 않는다.

모든 수정된 root-cause class에는 최소 하나의 **기존 잘못된 의미를 되살리면 실패하는** regression이 있다. 단순 이름·주석·syntax mutation만 실패하는 것으로 대신하지 않는다. 정상 positive control은 계속 통과한다.

모든 production 파일은 실제 읽기 기록과 유지/수정 판단을 갖는다. 계획상의 SCOPE_ONLY/작업 배정과 실제 구현 AI의 READ/REVIEWED는 다른 필드로 남긴다. 실제 새 파일과 tracked contracts/tests/scripts는 WP00에서 범위를 확장한다.

fresh build·locked dependencies·raw exit codes·skips·input digest·actual commit이 연결된다. prior same-SHA source reading은 검토 근거일 수 있지만 새로운 runtime 결과는 아니다.

## D. 불필요한 구조 증가를 막는 기준

새 class/helper/port마다 기존 결정을 어디서 제거했는지 또는 불법 상태를 어디서 막았는지 적는다. 호출자가 같은 암묵적 전제를 여전히 기억해야 한다면 추상화를 재검토한다. 파일 수 감소/증가나 LOC만으로 승인하지 않는다.

범용 workflow engine, 전역 mutable Context, 모든 recovery 통합, domain 전체 generic Observation 프레임워크는 이 계획의 목표가 아니다. 정당한 별도 프로세스 closure와 서로 다른 effect lifecycle을 유지한다.

## E. 최종 보고 문장

승인 가능한 보고는 “이 commit·profile·환경에서 이 불변식들을 다음 시험으로 확인했고, 이 항목은 미검증이다”다. “모든 결함 제거”, “100% 안전”, “10점 완성”은 검증 가능한 완료 조건이 아니다. 계획 이행은 명시한 계약의 일관성과 검증 범위를 크게 개선하는 수단이지 숨은 모든 결함의 부재 증명은 아니다.
