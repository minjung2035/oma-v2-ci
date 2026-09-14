# OMA v2 검증 색인

이 파일은 검증 문서를 찾기 위한 루트 색인이다. 장기 유지보수 원칙은 [`MAINTENANCE.md`](MAINTENANCE.md), 문서 권위와 historical/generated 구분은 [`implementation/README.md`](implementation/README.md), 현재 재개점은 [`HANDOFF.md`](HANDOFF.md)를 따른다.

## 현재 판정

**C01–C07 감사에서 확인된 일부 source 문제에 대한 수정과 회귀 source는 반영되어 있지만, 전체 실행 적합성과 release 상태는 아직 인증되지 않았다.**

상세 current verification status는 [`implementation/validation.md`](implementation/validation.md)가 기준이다. 다음을 서로 같은 의미로 취급하지 않는다.

- source 수정
- test 작성
- static review
- test 실행
- 실제 systemd/kernel 환경 검증
- release proof

과거 `DONE`, 과거 test count, 과거 LOC와 과거 raw log는 현재 source의 PASS가 아니다.

## 현재 문서

| 문서 | 역할 |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | 현재 재개점과 남은 우선 작업 |
| [`implementation/validation.md`](implementation/validation.md) | 실제 수행, NOT_RUN, BLOCKED, STALE 상세 |
| [`implementation/compliance.md`](implementation/compliance.md) | requirement와 fresh evidence의 release 계약 |
| [`implementation/test-matrix.md`](implementation/test-matrix.md) | acceptance oracle |
| [`implementation/spikes.md`](implementation/spikes.md) | OPEN gate와 필요한 실제 검증 |
| [`docs/architecture-improvement/p10-p15-adversarial-review.md`](docs/architecture-improvement/p10-p15-adversarial-review.md) | P10–P15 dependency/capability 정제와 적대적 검증 기록 |

## Evidence 상태

- `NOT_RUN`: 실행하지 않음.
- `BLOCKED`: 환경 또는 OPEN gate 때문에 실행/완료할 수 없음.
- `UNVERIFIED`: source/test가 있어도 current source-bound 실행 증거가 없음.
- `PARTIAL`: 일부 범위만 실행됨.
- `PROVEN`: 현재 source revision의 실제 production path와 필요한 negative/environment evidence가 결합됨.

## Generated artifact

다음은 current source에 종속된 generated artifact다.

- `production-files.txt`
- `production-loc.json`
- `production-loc-hashes.json`
- `implementation/traceability.json`
- `implementation/adversarial-review.md`
- `implementation/evidence/*`

Freshness는 `implementation/validation.md`의 판정을 따른다. 사람이 source list, LOC, hash를 직접 최신 측정처럼 고치지 않는다.

## 재검증 entry

현재 실행 명령은 `package.json` scripts를 사용한다. 대표 순서는 다음과 같다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
node scripts/loc.mjs
```

각 lane은 기존 artifact를 덮지 않는 새 output directory를 사용한다. 필요한 환경이 없으면 PASS가 아니라 BLOCKED/NOT_RUN으로 기록한다.

## Historical record

다음은 현재 지침이 아니라 과거 작업의 상세 기록이다.

- [`implementation/conformance-followup.md`](implementation/conformance-followup.md) — C01–C07 후속 변경
- [`implementation/refactoring-closure.md`](implementation/refactoring-closure.md) — R37–R39 종료 기록
- 과거 commit의 `HANDOFF.md`와 `implementation/validation.md`
- `implementation/evidence/*`의 당시 raw evidence

Historical finding을 현재에 적용하려면 당시 source SHA를 확인하고 current HEAD에서 owner/call path를 다시 찾은 뒤 재현 또는 fresh evidence로 확인한다.

## 문서별 기록 위치

- 장기 관리 원칙 → `MAINTENANCE.md`
- 현재 재개점 → `HANDOFF.md`
- 상세 current verification → `implementation/validation.md`
- 특정 감사/대형 작업 상세 → 별도 follow-up/closure 기록
- architecture/spec 의미 → 상위 규범 문서

이 분리를 유지하여 과거 코드베이스 기준 문서와 현재 검증 상태가 섞이지 않게 한다.
