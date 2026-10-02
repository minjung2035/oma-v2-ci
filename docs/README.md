# 문서 지도

문서의 진입점과 주제별 owner는 이 파일 하나가 정한다. 루트 README는 진입 링크만 제공한다. 실제 TypeScript contract·SQL schema·unit template·기계 판독 map은 코드 입력이므로 저장소의 `implementation/`에 둔다.

## 처음 읽는 사람

1. [PRIORITY-0](PRIORITY-0.md): 확정된 사실과 현재 권한을 분리하는 최상위 원칙.
2. [PRODUCT](PRODUCT.md): 제품의 목적과 경계.
3. [HANDOFF](HANDOFF.md): 최신 사용자 요청과 재개점.
4. 아래 주제의 기준 문서. 실제 실행 여부와 한계는 [validation](implementation/validation.md)에서 확인한다.

## 주제별 기준 문서

| 찾는 내용 | 기준 문서 | 소유 범위 |
|---|---|---|
| 프로젝트 수정 방법 | [MAINTENANCE](MAINTENANCE.md) | 작업 규율과 변경·검증 절차 |
| 실행·설정·세션·package·extension | [운영 안내](operations.md) | 사용 방법. wire/durable 계약을 정의하지 않음 |
| Core 구현 계약 | [implementation-spec](implementation-spec.md) | 신원·권한·IPC·메일·Git·lifecycle·복구·제품 표면과 physical ordering·Store opening·contract owner·unit renderer |
| 기존 tiered 정책 | [integration-policy](implementation/integration-policy.md) | 기존 attestation/finding/scope 정책. 수용 변경의 근거는 연결된 DR |
| 다음 merge/review/challenge 구현 | [merge-review-spec](merge-review-spec.md) | 최신 대화의 설계안. 이번 정리에서 본문을 변경하지 않음 |
| macOS host와 hidden Linux VM | [macos-platform](macos-platform.md) | RPC·VM·project·credential·image·복구 계약과 helper 안내 |
| 시험·release evidence·LOC·qualification·fixture | [verification-spec](verification-spec.md) | 기존 TEST/COMP/LOC/SP/VAL 조항과 수용 번호의 단일 owner |
| 현재 실행 결과·한계·재검증 | [validation](implementation/validation.md) | 현재 판정과 수치의 단일 owner. 과거 실행 이력은 archive |

같은 동작의 규범은 한 owner에서 정의하고 다른 문서는 연결한다. 문장 존재 자체가 구현 완료나 시험 통과를 뜻하지 않는다.

## 현재 계약·설계안·과거 기록

| 종류 | 위치 | 의미 |
|---|---|---|
| 최상위 원칙 | PRIORITY-0 | 모든 계약과 작업 판단의 기준 |
| 구현·검증 계약 | 위 implementation-spec, integration-policy, macos-platform, verification-spec | 구현해야 할 조건 |
| 설계안 | merge-review-spec | 다음 변경의 목표. 이미 활성 정책·코드로 전환됐다고 해석하지 않음 |
| 지침 | PRODUCT, MAINTENANCE, operations | 의도와 사용 방법. 계약의 의미를 덮어쓰지 않음 |
| 현재 상태 | HANDOFF, validation | 재개점과 실제 검증 판정 |
| 고정 기준본 | [architecture](architecture.md) | N-001이 결박한 원문. 기존 설계의 배경과 상위 기준 |
| 결정 기록 | [design-revisions](design-revisions.md), [consistency-decisions](implementation/consistency-decisions.md) | 규범을 정한 이유와 작성 당시의 결정 |
| 점검 기록 | [priority-0-audit](priority-0-audit.md) | P0V/P0D 발견과 수정 근거 |
| 보관 기록·입력 원본 | [archive](archive.md) | 과거 검증·인계, 고정 계획, 외부 리뷰와 Git snapshot |

고정 architecture 원문은 수정하지 않는다. 그 원문 상대 링크가 유지되도록 연결된 문서는 `docs/implementation/`에 둔다. architecture의 오래된 UI·tier/floor·LOC 문장을 현재 동작으로 단독 인용하지 않는다. 수용된 변경은 해당 규범과 DR을 함께 확인한다. 결정 기록의 OPEN/ACCEPTED/당시 실행 결과도 현재 판정을 대신하지 않는다.

### 우선순위

PRIORITY-0가 최상위다. architecture는 고정 상위 기준본이며, 사용자 결정에 따라 달라진 설계는 DR에 이유를 기록하고 구현 계약이 변경된 규범을 소유한다. 불일치는 구현 결함·stale 설명·미결정 설계·명시적 미지원 중 무엇인지 표시한다. 설계안이나 과거 기록만으로 활성 권한과 과거 fact의 의미를 바꾸지 않는다.

## 새 정보를 어디에 적는가

| 새 정보 | 적는 곳 |
|---|---|
| Core MUST/MUST NOT과 physical ordering·Store·contract·unit 경계 | implementation-spec |
| 기존 tiered 정책 | integration-policy |
| 다음 merge/review 정책의 설계 | merge-review-spec. 채택 시 그 문서의 전환 절차 적용 |
| macOS 플랫폼 계약 | macos-platform |
| 수용 시험·증거·qualification·측정 요구 | verification-spec |
| 설계 선택의 이유 | design-revisions. 기존 DR 번호의 뜻을 재사용하지 않음 |
| 계획 카드·적대적 검토의 이유 | consistency-decisions |
| Priority 0 발견과 점검 | priority-0-audit |
| 현재 실행 판정·로그·수치·한계 | validation |
| 최신 요청·다음 작업·제약 | HANDOFF |
| 반복 작업 규율·제품 의도·운영 방법 | MAINTENANCE, PRODUCT, operations |
| 과거 시점의 긴 기록·입력 원본 | archive. 과거 PASS를 현재 PASS로 사용하지 않음 |

문서 이동·통합은 요구 ID·수용 번호·확정된 기록의 의미를 바꾸지 않는다. 계약 이동 시 source-owners와 trace inventory를 실제 위치로 맞추고 이전 evidence를 자동 승격하지 않는다. architecture와 계획 원본의 byte 결박을 유지한다.

## machine-readable map

현재 source owner나 실행 수치를 문서에 복제하지 않는다.

| 파일 | 용도 |
|---|---|
| [source-owners.json](../implementation/source-owners.json) | requirement별 production owner·entrypoint·call path·negative test |
| [mutation-owners.json](../implementation/mutation-owners.json) | durable mutation owner와 change surface |
| [durable-boundaries.json](../implementation/durable-boundaries.json) | kill·retry·restart가 필요한 경계 |
| [traceability.json](../implementation/traceability.json) | 규범 fingerprint와 evidence inventory |
| [oracle-map.json](../implementation/oracle-map.json) | 계획 oracle과 verification lane |
| [review-notes.json](../implementation/review-notes.json), [review-ledger.json](../implementation/review-ledger.json) | byte에 결박된 검토 기록과 생성 ledger |
| [contract-direction-plan.json](../implementation/contract-direction-plan.json) | contract 의존 방향 결정 |
| [broker-lifecycle-review.json](../implementation/broker-lifecycle-review.json) | broker lifecycle 경계 검토 |

Production inventory·LOC·dependency graph·review ledger·trace inventory는 생성 도구로 갱신한다. 예전 값을 새 측정처럼 손으로 보정하지 않는다. 현재 결과는 validation이 소유한다.
