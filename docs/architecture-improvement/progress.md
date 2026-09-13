# 안정성 보존형 아키텍처 개선 — 진행 기록

## 작업 기준

- 시작 기준: `master`의 `e2afe9ab050d87705451cd127c458ad216aa52d4`.
- 작업 브랜치: `refactor/safety-preserving-architecture`. `master`는 직접 덮어쓰지 않는다.
- 제안 원문: [`2026-09-13-safety-preserving-architecture.md`](../proposals/2026-09-13-safety-preserving-architecture.md).
- 원문 저장 커밋: `da73fea3a38745fbbc15e80085b53b62df1ad972`.
- 첨부 원문과 저장 파일의 Git blob: `fcdc99b6bc2cde060571fa1fd4f065ca1f5752cf` (일치 확인).
- 원문 SHA-256: `39a51c8ff8e968e0abf4c8d5179e6ce310c5c12344131f642b42d00e05bd626a`.
- 이 문서는 작업 기록이지 architecture/spec을 대체하는 규범이 아니다.

## 보존 조건

Single broker / single SQLite writer / synchronous transaction boundary / durable accepted intent / immutable evidence / explicit unknown / normal-recovery separation / incarnation fencing / bounded effects를 유지한다. Wire v1, DB schema, persisted v1 plan 및 OPEN SPIKE 상태를 일반 리팩터링으로 변경하지 않는다.

## 진행표

| 단위 | 상태 | 결과 또는 다음 검증 |
| --- | --- | --- |
| 원문 보존 | 완료 | 원문 그대로 첫 커밋, blob 동일성 확인 |
| P0 baseline | 진행 중 | 잠긴 의존성 설치, inventory generator, typecheck/build/package/architecture/tests 및 각 lane의 실제 실행 결과 확보 |
| P1-1 count-independent operation closure | 대기 | kind/registry/validator coverage 동등성 및 negative fixture |
| P1-2 composition order | 대기 | nullable late binding 제거, startup/recovery 순서 보존 |
| P1-3 public validation | 대기 | 검사 구현 공유, dispatch 시점 authority 재조회 및 revoke/stop regression |
| P2 contracts ownership | 대기 | facade 보존; C1, C2, subsystem import migration을 별도 커밋 |
| P2.5 opaque identity | 대기 | public JSON 불변, boundary부터 점진 도입 |
| P3 operation kernel | 대기 | 기존 transition owner를 재사용, explicit recovery exhaustiveness |
| P4 logical Store facets | 대기 | SQL/connection/writer 분산 없이 logical facet |
| P5 dependency lattice | 대기 | 실제 import graph 측정 후 방향 규칙 결정 |
| P6–P9 maturity/format work | 별도 단계 | 제안서에 따라 P0–P5와 한꺼번에 진행하지 않음; v1 silent migration 금지 |

## 변경 판단 고시

### D01 — P0에 재현 가능한 CI evidence 경로 추가

로컬 작업 컨테이너는 GitHub DNS/직접 clone이 불가능하다. 연결된 GitHub API의 읽기/쓰기는 가능하므로 GitHub-hosted runner에서 기존 repository scripts를 실행하고 source SHA와 raw log를 함께 보존한다. 이는 제안서의 검증 순서를 바꾸는 것이 아니라 실행 가능성과 증거 추적성을 보완하는 추가 작업이다.

Workflow는 작업 브랜치 push 또는 명시적 dispatch로만 실행한다. `contents: read`, `persist-credentials: false`, SHA-pinned actions를 사용하며 코드 자동 수정/commit, secret/provider 호출, production state 접근을 추가하지 않는다. Source archive는 검사 전 입력의 재현용이며 private repository Actions artifact로만 보존한다.

기존 inventory의 실패를 먼저 기록하고 generator 실행 후 결과를 별도로 보존한다. Generator 출력은 검토 후 독립 커밋한다. 원래 source 파일 목록을 사람이 수작업으로 맞추지 않는다. 각 lane의 `result.json`과 exit code를 그대로 기록하며 `SETUP_FAILED`, skip, timeout을 PASS로 바꾸지 않는다. Native 환경 미지원은 후속 검증 문서에서 BLOCKED 원인과 함께 분리한다.

## 검증 현황

현재 새 실행 결과는 아직 없다. 과거 PASS/test count/LOC를 이번 source의 결과로 재사용하지 않는다. P0 workflow가 실제 완료되기 전에는 baseline 완료로 표기하지 않는다.
