# 문서 지도

현재 사용법·구현 계약·검증 결과의 위치를 안내한다. 과거 작업 지시와 미채택 계획은 [보관 기록](archive.md)에 둔다.

## 읽는 순서

1. 제품을 사용하려면 [운영 안내](operations.md), 제품의 목적은 [PRODUCT](PRODUCT.md)를 읽는다.
2. 코드를 수정하려면 [PRIORITY-0](PRIORITY-0.md), [HANDOFF](HANDOFF.md), [MAINTENANCE](MAINTENANCE.md)를 읽는다.
3. 관련 코드는 [책임 경계](application-boundaries.md)에서 찾고, 실제 검증 범위는 [validation](implementation/validation.md)에서 확인한다.
4. 변경할 주제의 계약과 연결된 결정 기록을 확인한다.

## 현재 문서

| 찾는 내용 | 기준 문서 | 범위 |
|---|---|---|
| 최상위 원칙 | [PRIORITY-0](PRIORITY-0.md) | 확정된 사실·현재 권한·관측·수명의 구분 |
| 제품의 목적 | [PRODUCT](PRODUCT.md) | Principal/Worker 협업과 Society/Personal의 경계 |
| 설치·사용·설정·세션 보관 | [operations](operations.md) | 현재 사용 방법과 실행 조건 |
| 코드 구조·package·실행 연결 | [application-boundaries](application-boundaries.md) | 현재 workspace 경로와 각 기능의 책임 |
| 수정·검증 절차 | [MAINTENANCE](MAINTENANCE.md) | 작업 규율과 오류·복구·증거 취급 |
| 최신 작업과 제약 | [HANDOFF](HANDOFF.md) | 현재 재개점. 과거 작업 일지를 누적하지 않음 |
| 실제 실행 결과와 한계 | [validation](implementation/validation.md) | 최신 검증 입력·원시 근거·미실행 범위 |
| 숫자 제한을 확인하는 방법 | [limit-bounds](limit-bounds.md) | 제한의 분류와 실제 소유 코드. 과거 숫자 목록은 보관 |

## 구현·검증 계약

| 계약 | 소유 범위 |
|---|---|
| [implementation-spec](implementation-spec.md) | 신원·권한·IPC·메일·Git·lifecycle·복구·제품 표면·물리 순서·Store·unit renderer |
| [integration-policy](implementation/integration-policy.md) | 기존 tiered integration 정책. 수용된 변경은 해당 DR과 함께 확인 |
| [macos-platform](macos-platform.md) | DR49 native 전환·VM 폐기·선행 gate·모듈 경계 계약 |
| [verification-spec](verification-spec.md) | 수용 번호·시험·증거·LOC·qualification 요구 |

계약의 존재는 구현 완료나 시험 통과를 뜻하지 않는다. 사용자 구현 지시로 DR49 native 전환을 진행 중이며, 실제 범위와 차단 조건은 validation을 따른다.

## 구현 중인 전환

[macOS native 전환 명세](macos-native-spec.md)는 VM 없는 공통 TypeScript 제품의 목표·확정 결정·미결정 후보·검증 순서를 정한다. 다음 구현자의 판단 절차와 원본 근거를 포함하며, 후보의 존재·설계 채택·실제 native 지원 완료를 구분한다.

## 기준본과 결정 기록

| 문서 | 읽는 방법 |
|---|---|
| [architecture](architecture.md) | N-001이 hash로 결박한 고정 기준본. 원문을 수정하지 않음 |
| [design-revisions](design-revisions.md) | 수용된 설계 변경의 이유. DR 번호의 뜻을 재사용하지 않음 |
| [consistency-decisions](implementation/consistency-decisions.md) | D01–D06·계획 카드·적대적 검토 당시의 결정 |
| [과거 기록](archive.md) | 감사·작업 일지·이전 인계/검증·구현 명세 기록·미채택 설계안 |

PRIORITY-0가 최상위다. 사용자 결정으로 고정 기준본과 달라진 내용은 해당 DR과 현재 구현 계약을 함께 확인한다. 과거 문서의 OPEN·ACCEPTED·PASS·브랜치·경로는 작성 당시의 사실이며 현재 지시나 지원 판정으로 사용하지 않는다.

## 새 정보를 어디에 적는가

| 정보 | 기록 위치 |
|---|---|
| Core 동작·물리 순서·Store·unit 계약 | implementation-spec |
| 기존 tiered 정책 / macOS 플랫폼 계약 | integration-policy / macos-platform |
| 시험·증거·qualification 요구 | verification-spec |
| 설계 선택의 이유 | design-revisions |
| 현재 실행 판정·입력·원시 로그·한계 | validation |
| 최신 요청·제약·재개점 | HANDOFF |
| 사용법 / 코드 구조 / 유지보수 규율 | operations / application-boundaries / MAINTENANCE |
| 과거의 긴 기록·채택 전 계획 | archive |

같은 동작의 규범과 현재 실행 수치는 한 문서가 소유하고 다른 문서는 링크한다. 문서를 옮길 때도 요구 ID·수용 번호·과거 검증 및 승인 사실의 의미는 유지한다.

## 기계 판독 입력

실제 TypeScript 계약·SQL schema·unit template과 아래 map은 코드 입력이므로 `packages/`와 `implementation/`에서 관리한다.

| 파일 | 용도 |
|---|---|
| [source-owners.json](../implementation/source-owners.json) | requirement별 production owner·entrypoint·call path·negative test |
| [mutation-owners.json](../implementation/mutation-owners.json) | durable mutation owner와 변경 범위 |
| [durable-boundaries.json](../implementation/durable-boundaries.json) | kill·retry·restart 검증 경계 |
| [traceability.json](../implementation/traceability.json) | 규범 fingerprint와 evidence inventory |
| [oracle-map.json](../implementation/oracle-map.json) | 계획 oracle과 verification lane |
| [review-notes.json](../implementation/review-notes.json), [review-ledger.json](../implementation/review-ledger.json) | byte에 결박된 검토 기록과 생성 ledger |
| [broker-lifecycle-review.json](../implementation/broker-lifecycle-review.json) | broker lifecycle 경계 검토 |

`npm run evidence:refresh`는 graph·source inventory/digest·review ledger·구조 입력 binding을 갱신한다. 생성 결과는 `runtimeProof: false`다. 과거 PASS나 review를 새 입력의 승인으로 바꾸지 않으며, stale authored review를 자동으로 다시 결박하지 않는다.
