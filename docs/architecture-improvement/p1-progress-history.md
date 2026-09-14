# 안정성 보존형 아키텍처 개선 — P1 당시 진행 기록

> Historical snapshot: 아래의 현재/미착수/BLOCKED는 P1 당시 판정이다. 최신 상태는 [현재 진행 색인](progress.md)과 [검증 상태](../../implementation/validation.md)를 따른다.

## 기준과 범위

시작 기준은 `master`의 `e2afe9ab050d87705451cd127c458ad216aa52d4`, 작업 브랜치는 `refactor/safety-preserving-architecture`다. `master`를 덮어쓰거나 강제 push하지 않는다.

[첨부 제안서 원문](../proposals/2026-09-13-safety-preserving-architecture.md)은 첫 커밋 `da73fea3a38745fbbc15e80085b53b62df1ad972`에 byte-identical하게 보존했다. Git blob `fcdc99b6bc2cde060571fa1fd4f065ca1f5752cf`, SHA-256 `39a51c8ff8e968e0abf4c8d5179e6ce310c5c12344131f642b42d00e05bd626a`.

**P1의 세 단위는 구현했지만 전체 P0 baseline은 BLOCKED다.** CI runner 미배정과 로컬 clone/의존성 설치 불가 때문에, 동일성 확인된 파일의 독립 검사로 검증 범위를 제한했다. 이는 제안서의 P0 완료 후 순차 실행과 다른 제한적 진행이며, 통합 검증이나 release 승인이 아니다. 전체 제안서 구현 완료를 주장하지 않는다.

## 구현 단위별 상태

| 단위 | 현재 상태 | 증거 / 남은 조건 |
| --- | --- | --- |
| 원문 보존 | 완료 | 첫 커밋, 원문 blob 동일성 확인 |
| P0 verification | BLOCKED | inventory/LOC/hash 및 pinned full build/typecheck/test/native lanes NOT_RUN |
| P1-1 operation closure | 구현 + 독립 검사 | `2fff630` / 8 fixture tests PASS; 1/2/11/12 kinds, 누락/추가/callability/닫히지 않은 kind 거절 |
| P1-2 composition order | 구현 + 제어된 entry 검사 | `b4d153d` / [P1-2 기록](p1-composition.md) / 3 tests PASS; 실제 host startup/recovery 통합 검증은 NOT_RUN |
| P1-3 public validation | 구현 + 제어된 dispatch 검사 | [P1-3 기록](p1-validation.md) / 14 tests PASS; stop/revoke/incarnation/admission 재검증; wire/transport/native 통합 증거는 아님 |
| P2 contracts ownership | 미착수 | P0 확보 후 facade/equivalence, module-ports cycle, subsystem별 import migration |
| P2.5 internal opaque IDs | 미착수 | wire string 유지, boundary부터 점진 도입 |
| P3 operation kernel | 미착수 | 기존 transitions 재사용, workflow ordering 보존 |
| P4 Store logical facets | 미착수 | SQL/connection/writer 소유권 분산 금지 |
| P5 dependency lattice | 미착수 | 실제 graph 측정 후 enforcement |
| P6–P9 maturity/format | 별도 단계 / 미착수 | P0–P5와 동시에 진행하지 않음, v1 silent migration 금지 |

P1 세 파일을 함께 실행한 결과는 **25 tests / 25 PASS / 0 FAIL / 0 SKIP**이다. 이는 새 독립 fixture의 합계이지 전체 repository suite 또는 fast/all lane 실행 결과가 아니다. [실행 범위와 baseline](baseline.md), [raw TAP](evidence/p1-combined.tap), [source 식별 기록](evidence/p1-focused-summary.json)을 함께 읽는다.

## 판단 변경 고시

[D01–D03 당시 상세 기록](decisions-p0-p1-1.md)은 원본 내용 그대로 보존했다. 그 문서의 진행표는 P1-1 종료 시점 snapshot이며 현재 상태는 이 파일을 따른다.

- D01: read-only, source-pinned CI evidence 경로를 제안에 추가했다. 검증 실행이 성공했다는 뜻은 아니다.
- D02: P0 차단을 숨기지 않고 독립적으로 검증 가능한 작은 P1 단위만 진행했다. baseline 없이 P2 이후 구조 변경까지 확대하지 않았다.
- D03: 고정 count 제거에 더해 empty/open kind 집합을 fail-closed로 거절한다.
- D04: P1-2는 새 interface 없이 Git을 먼저 구성하고 live context reader를 공유한다. 제어된 테스트와 실제 host proof를 구분한다.
- D05: P1-3은 phase별 기존 오류 우선순위와 메시지를 보존하면서 규칙 구현을 공유한다. optional bundle descriptor가 없는 명시적 stream preflight는 dispatch와 동일하게 조기 거절하도록 강화했다. stream 없는 정상 submit은 유지했다. 자세한 판단은 p1-validation.md에 있다.

## 보존한 경계

Single broker, single SQLite writer, synchronous transaction boundary, accepted intent, immutable evidence, explicit unknown, normal/recovery 분리, incarnation fencing, bounded effects 및 OPEN SPIKE를 변경하지 않는다. Wire v1 / schema / persisted v1 plan과 effect dispatch switch는 변경하지 않았다. Production inventory/LOC/hash 산출물은 generator 미실행 상태에서 수작업 갱신하지 않았다.

## 인계 조건

로컬 검사는 Node v22.16.0 / TypeScript 5.8.3에서 실행했다. repo pin 5.9.3의 semantic typecheck 또는 native host 검증으로 표시하지 않는다. P1-2/P1-3 테스트의 transpile 성공은 semantic typecheck가 아니다. 과거 PASS/LOC/hash를 현재 결과로 재사용하지 않는다.

다음 진행의 선행 조건은 실제 runner에서 잠긴 의존성 설치와 P0 전체 명령 실행, 생성된 inventory/LOC/hash 검토, 환경 차단과 제품 실패의 분리다. 그 전에는 이 변경을 release-ready로 표시하거나 master에 자동 병합하지 않는다. 이 문서는 architecture/spec을 대체하는 규범이 아니다.
