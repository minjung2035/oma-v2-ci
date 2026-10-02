# 구현을 지배할 불변식

이 문서는 기존 규범의 대체물이 아니라 이번 계획의 공통 실행 기준이다. 이름을 새로 붙였지만 핵심은 MAINTENANCE의 Fact / Relation / Phase다. 기존 wire·DB·권한 의미와 충돌하면 WP01의 ADR부터 확정한다. [S01](SOURCES.md#s01), [S37](SOURCES.md#s37).

## 중심 명제

**다음 상태 전이는 명시적인 사실, 그 사실 사이의 관계, 현재 권한으로 결정한다. 연결 종료·재시작·설정 편집 때문에 과거에 확정된 사실의 의미가 바뀌지 않는다.**

하나의 거대한 state machine이나 모든 모듈을 통과하는 범용 Context를 만들라는 뜻이 아니다. 논리적 관계는 일관되게, 실행·복구·표시는 각자의 경계에서 처리한다.

| ID | 집행할 계약 | 구체적 의미 | 잘못된 해석 |
|---|---|---|---|
| INV01 | 사실의 identity와 현재 권한을 구별한다 | BatchId/전달 attempt/RunLease/설정 generation을 혼동하지 않는다 | 과거 incarnation을 현재 값으로 덮어쓰면 증거도 갱신됐다고 생각함 |
| INV02 | unknown은 absent/success/dead와 다르다 | 관측 실패는 추가 효과·삭제 권한이 아니다 | catch 후 null 반환으로 무조건 재시도 |
| INV03 | 과거 terminal fact와 frozen intent를 보존한다 | same-key는 동일 payload/bytes에 묶이고 완료 기록은 퇴행하지 않는다 | HEAD에서 payload를 새로 생성하거나 기존 receipt를 새 결과로 교체 |
| INV04 | 한 결정의 정책 owner는 하나다 | 독립 표현은 허용하되 관계와 의미는 단일 정의/동등성 시험에 묶인다 | 파일 쓰기 owner만 하나면 재시도 의미도 하나라고 주장 |
| INV05 | 수명과 책임을 명시한다 | connection/accepted task, direct child/descendants, preaccept/accepted artifact를 구별 | socket close와 함께 accepted evidence 삭제 |
| INV06 | 효과 직전 현재 권한을 검사한다 | await 전 검증을 effect 시점 권한으로 재사용하지 않는다 | DRY라는 이유로 final authority/death check 제거 |
| INV07 | 원자성·영속성의 단위를 명시한다 | 파일 rename, parent flush, DB COMMIT, config bundle commit은 별개다 | 개별 파일 atomic replace를 bundle transaction으로 부름 |
| INV08 | read·admit·settle·repair를 구별한다 | 신규 소비 거절이 진단과 정산의 무조건 차단이 되지 않게 한다 | recovery라는 이름만 붙이면 quota·권한을 모두 우회 |
| INV09 | 검증된 값의 보장 범위는 실제 검사 범위다 | branded 타입은 출처와 검사 결과를 드러내는 도구이며 runtime 보장을 대체하지 않는다 | readonly/타입 이름만으로 once-only·durability가 보장된다고 주장 |
| INV10 | 모든 I/O·queue·retention은 명시적으로 bounded다 | 시간/bytes/items/동시성/보관량과 초과 결과를 소유자가 정한다 | unknown을 없애려고 무한 대기/재시도 |
| INV11 | 관측·표시는 권한을 만들지 않는다 | cached status·알림·UI 성공은 durable fact와 다르다 | 오래된 캐시를 dead proof나 성공 증거로 사용 |
| INV12 | 실행 근거와 검증 범위를 숨기지 않는다 | 실제 production path·negative control·정확한 source binding을 요구한다 | 파일 수·test count·정적 gate 0건으로 전체 안전성 선언 |

## 네 가지 증거 상태와 세 가지 행위

`verified-present`, `observed-absent`, `unavailable`, `corrupt/conflicting`을 각 domain의 닫힌 union으로 표현한다. 필요 없는 generic Observation framework는 만들지 않는다.

행위는 `새 효과 수행`, `이미 발생한 효과의 기록 정산`, `추가 관측/운영 복구`로 나눈다. **증거가 없다는 이유만으로 새 효과를 수행하지 않는다.** 재전달 가능한 mail notification과 멱등 키로 보호된 OMA mutation, 외부의 비멱등 효과를 구별한다. end-to-end exactly-once는 이 계획의 보장이 아니다.

## 유지해야 하는 비대칭

정상 실행과 recovery는 같은 결정을 같은 순서로 수행하지 않는다. 정상 실행은 입력에서 시작하고 recovery는 남은 fact에서 시작한다. Principal 장수 session과 Resident 배치별 engine도 같지 않다. 공통화할 것은 evidence 판정과 settlement 규칙이고, 권한과 수명까지 지우는 것이 아니다.

한 정책을 여러 시점에서 검사하는 것은 필요한 재검증일 수 있다. 반대로 서로 다른 validator가 같은 정책을 독립 정의하면 representation drift다. 변경 시 어느 쪽인지 먼저 설명한다.

## 보존 목록

Store의 synchronous transaction capability, operation decoder의 cross-row relation, CLI frozen cache와 explicit-not-found resend, Git expected-old CAS, run/pidfd/cgroup pin, immutable publication과 derived replacement의 분리, OPEN spike/unsupported gate, extension runtime closure, 실제 fixture 사용을 유지한다. [S03](SOURCES.md#s03), [S04](SOURCES.md#s04), [S49](SOURCES.md#s49), [S27](SOURCES.md#s27), [S43](SOURCES.md#s43), [S47](SOURCES.md#s47).

## 추상화의 수용 기준

새 class/port/helper는 다음 중 적어도 하나를 실제로 줄여야 한다: 동일 결정의 독립 구현 수, 호출자가 기억해야 할 전제 수, 실패 시 누락 가능한 자원 수, 변경을 검증하기 위해 읽는 파일·분기 수. 이름이 예쁘거나 LOC가 줄었다는 이유는 부족하다. Batch identity처럼 원래 다른 개념은 오히려 분리해서 이해 비용을 낮춘다.
