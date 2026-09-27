# 문서 지도

이 저장소의 모든 문서가 무엇을 소유하는지, 어느 문서가 우선하는지, 새 정보를 어디에 적는지를 이 문서 한 곳이 정한다.
다른 문서의 "읽기 순서"는 이 지도를 줄여 보인 것이며, 어긋나면 이 지도를 고친다. 이 지도의 규칙은 [PRIORITY-0](../PRIORITY-0.md)의
"문서와 식별자에도 같은 원칙"에서 나온다.

## 처음 읽는 사람

1. [PRODUCT.md](../PRODUCT.md) — 무엇을 왜 만드는가(의도)
2. [PRIORITY-0.md](../PRIORITY-0.md) — 모든 판단의 최상위 원칙
3. 이 지도 — 나머지 문서가 어디에 있고 무엇을 소유하는가
4. 할 일에 따라: 코드를 고친다면 [MAINTENANCE.md](../MAINTENANCE.md), 지금 상태를 알려면 [HANDOFF.md](../HANDOFF.md)와 [validation.md](../implementation/validation.md), 운영한다면 [operations/README.md](../operations/README.md)

## 문서의 종류와 권위

문서는 여섯 종류다. 종류가 권위를 정한다. 같은 사실을 두 종류의 문서에 적지 않는다.

| 종류 | 문서 | 무엇을 소유하는가 |
|---|---|---|
| **원칙** | [PRIORITY-0.md](../PRIORITY-0.md) | 모든 설계·수정·시험 판단의 최상위 기준. 규범이나 코드가 이 원칙과 충돌하면 규범을 고친다 |
| **규범**(구속력 있는 계약) | [architecture.md](../architecture.md) | 상위 설계 계약. bytes를 N-001이 결박하므로 고치지 않는다. 이 문서와 어긋나는 판단은 결정 기록(DR)에 적는다 |
| | [implementation-spec.md](../implementation-spec.md) | 구현 MUST/MUST NOT. 규범 문장의 owner |
| | [physical-ordering](../implementation/physical-ordering.md), [integration-policy](../implementation/integration-policy.md), [compliance](../implementation/compliance.md), [loc-budget](../implementation/loc-budget.md), [test-matrix](../implementation/test-matrix.md), [spikes](../implementation/spikes.md), [systemd/README](../implementation/systemd/README.md), [store-opening](../implementation/store-opening.md), [contracts/README](../implementation/contracts/README.md) | spec을 구체화하는 계약(순서, tiered 정책, release trace, LOC 측정, 수용 시험, OPEN spike, unit template, Store 열기, contract owner) |
| | `implementation/contracts.ts`, `contracts/`, `schema-v1.sql`, `systemd/*.in` | 문서가 아니라 실제 wire·durable·deployment 선언 |
| **결정 기록** | [consistency-decisions.md](../implementation/consistency-decisions.md) | 계획의 D01–D06, 카드(WP)별 결정, 재검토와 AV1–AV31, ENG1. 규범이 **왜** 그런지 |
| | [design-revisions.md](../implementation/design-revisions.md) | 설계 수정 DR1–DR14와 그것이 바꾼 규범, architecture와 어긋나는 문장 |
| **점검 기록** | [priority-0-audit.md](../implementation/priority-0-audit.md) | Priority 0 파일 단위 점검의 근거(파일:줄), 코드 발견 P0V-01–P0V-24와 수정 commit, 변이 결과, 14차 실제 점검, 문서·식별자 발견 P0D-01–P0D-14, 외부 전수 검토를 판정한 4차 점검 P0V-25–P0V-53 |
| **지침**(비규범) | [MAINTENANCE.md](../MAINTENANCE.md) | 사람과 AI가 코드를 고칠 때의 작업 규율 |
| | [PRODUCT.md](../PRODUCT.md) | 제품 의도. 규범을 소유하지 않는다 |
| | [operations/README.md](../operations/README.md) | 운영자 안내(설정 형식, 관리형 편집, 지원 범위). 계약은 spec이 소유한다 |
| | [test/fixtures/README.md](../test/fixtures/README.md) | fixture 층이 무엇을 증명하고 무엇을 증명하지 않는가 |
| **현재 상태** | [implementation/validation.md](../implementation/validation.md) | 현재 검증 판정, 시험 수·LOC 같은 모든 수치, 알려진 한계, 재검증 명령. 수치는 여기에만 적는다. 끝의 VAL 조항은 규범이다 |
| | [HANDOFF.md](../HANDOFF.md) | 다음 작업자의 재개점: 판정 한 줄, 환경, 도구와 절차, 남은 일 |
| **색인·과거** | [README.md](../README.md), 이 지도, [implementation/README.md](../implementation/README.md) | 진입점과 색인. 사실을 소유하지 않는다 |
| | [archive.md](archive.md) | 현재 tree에서 뺀 과거 기록이 있는 Git snapshot |

계획 원본 `oma-v2-consistency-plan-b25961c/`는 바꾸지 않는 입력이다(`SHA256SUMS.txt`). 이 저장소의 결정 기록이 계획을 어떻게 적용했는지 적는다.

### 우선순위

충돌하면 이 순서로 판단한다. 편한 쪽을 고르지 않는다(MAINTENANCE §1 "문서 충돌 처리").

1. **PRIORITY-0** — 원칙. "최상위 원칙"은 이 문서만을 뜻한다.
2. **architecture.md** — 규범 가운데 최상위인 설계 계약. 그 문장과 어긋나는 결정은 design-revisions가 기록하고, 그 결정의 규범 문장은 spec이 가진다.
3. **implementation-spec.md**, 그다음 implementation/의 규범 문서와 선언.
4. **결정 기록** — 규범이 왜 그런지 설명한다. 규범 문장을 대신하지 않는다.
5. **지침·현재 상태·색인** — 규범의 의미를 덮어쓰지 않는다.

결정 기록의 절 제목에 붙은 상태(예: "runtime evidence pending")는 **작성 당시의 상태**다. 지금의 검증 상태는 validation.md가 소유한다.

## 규범이 다루는 범위

| 주제 | architecture | spec | acceptance |
|---|---|---|---|
| Core runtime | §§1–22 | §§1–17, §20 | T01–T77 |
| tiered integration | §§12.5–12.8 | [integration-policy](../implementation/integration-policy.md) | T78–T90(예약 대역, 행 없음, tiered 출시 차단) |
| 제품 표면·엔진 | §23.1–23.9, §§23.11–23.13 | §18 | T91–T98, T104–T127(대역은 test-matrix의 TEST-008 표) |
| tool 표면 투영 | §23.10 | §19 | T99–T103 |

절 번호가 바뀌면 이 표부터 고친다. 절 번호를 본문 여러 곳에 적지 않는다.

## 새 정보를 어디에 적는가

| 새 정보 | 적는 곳 |
|---|---|
| 규범의 의미가 바뀌었다 | spec(또는 해당 implementation 규범 문서). 설계 판단이 함께 바뀌면 design-revisions에 DR로 이유를 적는다. architecture는 고치지 않는다 |
| 계획 카드나 적대적 점검의 결정 | consistency-decisions의 해당 절 |
| Priority 0 점검의 다음 회차 | priority-0-audit(새 파일을 만들지 않는다) |
| 반복 적용되는 작업 규율 | MAINTENANCE |
| 검증 실행 결과, 시험 수, LOC, 알려진 한계 | validation(다른 문서에는 수치를 적지 않는다) |
| 다음 작업자가 바로 알아야 할 상태 | HANDOFF |
| owner·경계·증거의 기계 판독 정보 | `implementation/*.json` map |
| 특정 작업의 일회성 상세(commit 목록, 작업 일지) | commit 설명과 Git history. 현재 tree에 closure 문서를 더하지 않는다 |

현재 tree에서 과거 기록을 빼면 [archive.md](archive.md)에 그 snapshot commit과 위치를 적는다. 과거 기록의 `current`, PASS 수, LOC, TODO는 지금의 사실이 아니다.

이 규칙의 목적은 문서 수를 줄이는 것이 아니다. 사람이든 AI든 "지금의 사실"을 찾을 때 과거 snapshot이나 다른 종류의 문서를 읽지 않게 하는 것이다.
