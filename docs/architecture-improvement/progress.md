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
| P0 baseline | BLOCKED | CI runner 미배정, 실행 step 0; 전체 baseline 미확보. 상세는 baseline.md |
| P1-1 count-independent operation closure | 구현 + 독립 fixture 검증 | 1/2/11/12 kind 허용; missing/extra key, callable coverage, 열린 discriminant 거절; 8 tests PASS (로컬 비고정 TS 5.8.3) |
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

로컬 작업 컨테이너는 GitHub DNS/직접 clone이 불가능하다. 연결된 GitHub API의 읽기/쓰기는 가능하므로 GitHub-hosted runner에서 기존 repository scripts를 실행하고 source SHA와 raw log를 함께 보존하는 경로를 추가했다. 이는 제안서의 검증 목표에 실행 가능성과 증거 추적성을 보완하는 추가 작업이다.

Workflow는 작업 브랜치 push 또는 명시적 dispatch로만 실행한다. `contents: read`, `persist-credentials: false`, SHA-pinned actions를 사용하며 코드 자동 수정/commit, secret/provider 호출, production state 접근을 추가하지 않는다. Source archive는 검사 전 입력의 재현용이며 private repository Actions artifact로만 보존하도록 구성했다. 아직 runner 실행이 없어 artifact가 생성됐다고 주장하지 않는다.

기존 inventory의 실패를 먼저 기록하고 generator 실행 후 결과를 별도로 보존하도록 구성했다. Generator 출력은 실제 확보 후 검토하여 독립 커밋한다. 원래 source 파일 목록을 사람이 수작업으로 맞추지 않는다. 각 lane의 `result.json`과 exit code를 그대로 기록하며 `SETUP_FAILED`, skip, timeout을 PASS로 바꾸지 않는다.

### D02 — P0 차단 상황의 작업 범위 제한

CI run `34736432730`은 runner ID 0, 실행 step 0으로 끝났다. 원인은 확인되지 않았으므로 결제/계정 문제라고 단정하지 않는다. 전체 소스의 generator/typecheck/build/test 및 native lane은 NOT_RUN/BLOCKED를 유지한다.

제안서의 P0 완료를 임의 선언하는 대신, 원본 Git blob과 동일성이 확인된 파일을 로컬에 복원하여 독립적으로 검증할 수 있는 작은 정적 검사 단위를 진행한다. 이는 완전한 baseline 이후 순차 작업이라는 제안과 다른 제한적 진행이며, 통합 검증이나 release 승인을 대체하지 않는다. 상태/권한/저장 형식 변경은 이 결과로 정당화하지 않는다.

### D03 — magic count 제거와 함께 열린 kind 집합도 거절

단순히 `11` 비교만 삭제하지 않았다. `OperationPlan`이 없거나 비어 있거나, union member에 kind가 없거나, `kind: string`/optional kind처럼 닫히지 않은 선언이면 거절한다. 유효한 비어 있지 않은 literal kind 집합은 개수와 무관하게 registry key 집합 및 세 validator의 callable coverage와 비교한다. 새로운 예외 목록이나 runtime effect는 추가하지 않았다.

새 fixture는 실제 `analyzeProgram`을 호출한다. compiler fixture는 `satisfies Record<MutationMethod, OperationCodec>`에 새 kind를 추가했을 때 누락이 오류가 되는지 검사한다. `fast`와 `all`에 파일 및 required oracle 이름도 연결했다.

## 실제 검증

독립 fixture를 원본 checker에 적용하면 8 tests 중 5 PASS / 3 FAIL, 수정 후 8 PASS / 0 FAIL / 0 SKIP이다. 실행 환경은 Node v22.16.0 / TypeScript 5.8.3이며 repo 고정 버전 5.9.3의 결과가 아니다. 자세한 source hash와 범위는 [baseline.md](baseline.md), [evidence/p1-operation-registry.json](evidence/p1-operation-registry.json)을 따른다.

전체 repository PASS, fresh production inventory/LOC/hash, native crash/kernel 적합성은 아직 확보하지 않았다. 과거 PASS/test count/LOC를 이번 source의 결과로 재사용하지 않는다.
