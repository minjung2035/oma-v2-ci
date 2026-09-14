# implementation 문서 지도

이 파일은 `implementation/` 문서를 권위와 수명주기로 구분하는 비규범적 색인이다. 새 규범을 정의하지 않는다. 충돌 시 `architecture.md`와 `implementation-spec.md`를 포함한 상위 계약이 우선한다.

프로젝트 시작점은 [루트 README](../README.md), 제안서·단계별 보고서를 포함한 전체 색인은 [docs/README.md](../docs/README.md)에 있다.

## 읽기 순서

새 작업자는 먼저 [`../MAINTENANCE.md`](../MAINTENANCE.md)를 읽고 다음 순서를 따른다.

1. [`../architecture.md`](../architecture.md)
2. [`../implementation-spec.md`](../implementation-spec.md)
3. [`physical-ordering.md`](physical-ordering.md)
4. [`contracts.ts`](contracts.ts), [`schema-v1.sql`](schema-v1.sql)
5. [`compliance.md`](compliance.md), [`spikes.md`](spikes.md), [`integration-policy.md`](integration-policy.md), [`test-matrix.md`](test-matrix.md), [`loc-budget.md`](loc-budget.md)
6. [`../HANDOFF.md`](../HANDOFF.md)
7. [`../validation.md`](../validation.md), [`validation.md`](validation.md)
8. 관련 production source와 test

과거 작업 기록은 이 순서를 대신하지 않는다.

## A. 규범/계약 문서

일반 bug fix나 문서 정리에서 임의로 고치지 않는다.

| 문서 | 역할 |
|---|---|
| [`../architecture.md`](../architecture.md) | 최상위 architecture source of truth |
| [`../implementation-spec.md`](../implementation-spec.md) | 구현 MUST/MUST NOT 계약 |
| [`physical-ordering.md`](physical-ordering.md) | canonical physical ordering |
| [`contracts.ts`](contracts.ts) · [owner 안내](contracts/README.md) | wire/type declaration |
| [`schema-v1.sql`](schema-v1.sql) | durable schema |
| [`compliance.md`](compliance.md) | requirement→owner→entrypoint→test→evidence 계약 |
| [`spikes.md`](spikes.md) | OPEN implementation gates와 필요한 evidence |
| [`integration-policy.md`](integration-policy.md) | integration/tier policy 계약 |
| [`test-matrix.md`](test-matrix.md) | acceptance/evaluation oracle 목록 |
| [`loc-budget.md`](loc-budget.md) | LOC/build 측정 계약 |
| [`systemd/README.md`](systemd/README.md) 및 templates | 고정 deployment surface |

규범 변경이 필요하면 maintenance 문서에서 의미를 덮어쓰지 말고 별도 architecture/spec 변경으로 처리한다.

## B. 현재 유지보수/재개 문서

| 문서 | 역할 |
|---|---|
| [`../MAINTENANCE.md`](../MAINTENANCE.md) | 장기 bug-fix/refactor/evidence 원칙 |
| [`../HANDOFF.md`](../HANDOFF.md) | 현재 재개점, 남은 BLOCKED/NOT_RUN/UNVERIFIED |
| [`../validation.md`](../validation.md) | 검증 문서·명령 색인. 현재 결과표를 중복 관리하지 않음 |
| [`validation.md`](validation.md) | 실제 수행/미실행과 current verification 상태의 단일 기록 |

`HANDOFF.md`에는 장문의 작업 일지와 과거 commit 목록을 계속 누적하지 않는다.

## C. 현재 metadata / generated artifact

| 파일 | 해석 |
|---|---|
| `source-owners.json` | 검토된 owner/call-path locator. 실행 proof가 아님 |
| `traceability.json` | requirement/trace inventory. current proof로 자동 승격 금지 |
| `../production-files.txt` | generated production inventory. 재생성 전 stale일 수 있음 |
| `../production-loc.json`, `../production-loc-hashes.json` | source-bound generated 측정. 다른 revision에 재사용 금지 |

Freshness는 `validation.md`의 판정을 따른다. Generated artifact를 사람이 고쳐 새 실행처럼 보이게 만들지 않는다.

## D. Historical record

다음 문서는 중요한 역사 자료지만 현재 지침이 아니다.

| 문서 | 기록 |
|---|---|
| [`conformance-followup.md`](conformance-followup.md) | C01–C07 코드 이행 감사 후속 변경 |
| [`refactoring-closure.md`](refactoring-closure.md) | R37–R39 구조개편 종료 시점 기록 |
| [`adversarial-review.md`](adversarial-review.md) | 특정 source/evidence에서 생성된 adversarial audit ledger |
| [`evidence/`](evidence/) | 당시 raw log, source pin, environment/dependency 기록 |
| [아키텍처 개선 이력](../docs/README.md#아키텍처-변경실행-이력) | P0–P22 단계별 상세 보고서; 현재 재개 지시와 구분 |

Historical 문서의 `DONE`, PASS 수, LOC, owner 이름을 현재 HEAD에 그대로 상속하지 않는다. current source에서 owner/call path를 다시 찾고 필요하면 재현하거나 fresh evidence를 만든다.

## 새 정보 기록 위치

- 반복 적용되는 장기 원칙 → `../MAINTENANCE.md`
- 다음 작업자가 알아야 하는 현재 상태 → `../HANDOFF.md`
- 실제 실행 검증 → `validation.md`와 fresh evidence output
- 특정 감사/대형 작업의 상세 → 별도 follow-up/closure 문서; 종료 후 historical 취급
- architecture/spec 의미 변경 → 상위 규범 변경 절차

## Historical finding 사용 절차

```text
historical claim
  -> 당시 source SHA 확인
  -> current HEAD에서 owner/call path 재탐색
  -> 현재도 재현되는지 확인
  -> current bug / already-fixed / stale-doc / OPEN-gate로 분류
```

과거 finding을 현재 todo list처럼 기계적으로 실행하지 않는다. 반대로 과거 수정 marker만 보고 동일 bug class가 사라졌다고 가정하지도 않는다.

## 현재 상태를 읽는 단일 경로

처음에는 아래 네 파일만 보면 된다.

```text
MAINTENANCE.md
HANDOFF.md
validation.md
implementation/validation.md
```

필요한 경우에만 historical record와 raw evidence를 따라간다.
