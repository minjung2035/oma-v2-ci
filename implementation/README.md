# implementation/ — 현재 구현 계약과 locator

이 디렉터리는 historical 작업 일지가 아니라 **현재 구현을 수정·검증할 때 직접 쓰는 계약과 machine-readable metadata**를 둔다. 최상위 의미는 [architecture.md](../architecture.md)와 [implementation-spec.md](../implementation-spec.md)가 우선한다.

## 기본 읽기 순서

새 작업은 다음 정도만 읽고 시작한다.

1. [MAINTENANCE.md](../MAINTENANCE.md)
2. [architecture.md](../architecture.md)
3. [implementation-spec.md](../implementation-spec.md)
4. 이 문서에서 작업 종류에 맞는 implementation owner
5. [HANDOFF.md](../HANDOFF.md)와 [validation.md](validation.md)

과거 phase/audit 보고서를 먼저 읽지 않는다.

## 현재 계약 문서

| 문서 | 역할 |
|---|---|
| [physical-ordering.md](physical-ordering.md) | durable/physical effect의 canonical ordering |
| [compliance.md](compliance.md) | requirement → owner → executable evidence 계약 |
| [spikes.md](spikes.md) | OPEN qualification/spike 조건 |
| [integration-policy.md](integration-policy.md) | base/tiered integration policy 계약 |
| [test-matrix.md](test-matrix.md) | acceptance oracle T01–T90 |
| [loc-budget.md](loc-budget.md) | production LOC/inventory 측정 계약 |
| [validation.md](validation.md) | 현재 verification 상태와 실행 명령 |
| [contracts/README.md](contracts/README.md) | contract owner 경계 |
| [systemd/README.md](systemd/README.md) | deployment template surface |

`contracts.ts`, `contracts/`, `schema-v1.sql`, `systemd/*.in`은 문서가 아니라 실제 contract/deployment surface다.

## AI 작업용 machine-readable map

| 파일 | 먼저 볼 때 |
|---|---|
| [mutation-owners.json](mutation-owners.json) | durable mutation 추가/수정, 관련 runtime/test owner 찾기 |
| [source-owners.json](source-owners.json) | requirement별 production owner/call path 찾기 |
| [contract-direction-plan.json](contract-direction-plan.json) | contract → implementation 역의존 제거 |
| [broker-lifecycle-review.json](broker-lifecycle-review.json) | broker lifecycle 추가 분리 여부 판단 |
| [traceability.json](traceability.json) | normative clause fingerprint/evidence inventory |

mutation 작업은 다음 명령으로 change surface부터 확인한다.

```sh
npm run mutation:locality -- git.submit
```

`durable.ts`, `validate.ts`, `protocol/methods.ts` 같은 중앙 registry는 파일 크기만으로 분해하지 않는다. map의 `path + symbol`을 사용해 필요한 section만 읽는다.

## Generated/current evidence

- `../production-files.txt`, `../production-loc.json`, `../production-loc-hashes.json`: production inventory/LOC source-bound artifact.
- `evidence/dependency-graph.json`: architecture Program dependency evidence. import/source graph 변경 후 `npm run evidence:graph`로 재생성한다.
- `adversarial-review.md`: `scripts/adversarial-report.mjs`가 필요할 때 생성하는 point-in-time report다. checked-in current guidance로 취급하지 않는다.
- verification lane output과 raw logs는 [validation.md](validation.md)의 source/date/status와 함께 해석한다.

Generated artifact는 사람이 최신 실행처럼 수동 보정하지 않는다.

## Historical 문서

완료된 P0–P24 기록, proposal, C01–C07 follow-up, R37–R39 closure, 과거 adversarial report/raw evidence, 장문의 verification 누적 기록은 current tree에 두지 않는다. [docs/archive.md](../docs/archive.md)의 정리 직전 snapshot에서 조회한다.

새 audit가 끝났다고 `followup-2.md`, `closure-final.md` 같은 파일을 계속 추가하지 않는다. 지속되는 규율은 MAINTENANCE, 현재 상태는 HANDOFF, 실행 결과는 validation, owner 정보는 JSON map에 반영한다.
