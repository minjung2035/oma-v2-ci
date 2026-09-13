# 안정성 보존형 아키텍처 개선 — 현재 진행

## 기준과 범위

시작 기준은 `master`의 `e2afe9ab050d87705451cd127c458ad216aa52d4`, 작업 브랜치는 `refactor/safety-preserving-architecture`다. `master`를 덮어쓰거나 강제 push하지 않는다.

[첨부 제안서 원문](../proposals/2026-09-13-safety-preserving-architecture.md)은 첫 커밋 `da73fea3a38745fbbc15e80085b53b62df1ad972`에 byte-identical하게 보존했다. Git blob `fcdc99b6bc2cde060571fa1fd4f065ca1f5752cf`, SHA-256 `39a51c8ff8e968e0abf4c8d5179e6ce310c5c12344131f642b42d00e05bd626a`.

**전체 P0 baseline은 BLOCKED다.** CI runner 미배정과 로컬 clone/의존성 설치 불가 때문에, 동일성 확인된 파일의 독립 검사로 범위를 제한했다. 이는 제안서의 P0 완료 후 순차 실행과 다른 제한적 진행이며, 통합 검증이나 release 승인이 아니다. 상세 원인과 버전 차이는 [baseline.md](baseline.md)에 기록한다.

## 구현 단위별 상태

| 단위 | 현재 상태 | 증거 / 남은 조건 |
| --- | --- | --- |
| 원문 보존 | 완료 | 첫 커밋, 원문 blob 동일성 확인 |
| P0 verification | BLOCKED | inventory/LOC/hash 및 pinned full build/typecheck/test/native lanes NOT_RUN |
| P1-1 operation closure | 구현 + 독립 검사 | `2fff630` / 8 fixture tests PASS; 1/2/11/12 kinds, 누락/추가/callability/닫히지 않은 kind 거절 |
| P1-2 composition order | 구현 + 제어된 entry 검사 | [P1-2 기록](p1-composition.md) / 3 tests PASS; 실제 host startup/recovery 통합 검증은 NOT_RUN |
| P1-3 public validation | 대기 | rule 공유, dispatch 시점 stop/revoke/admission 재검증 필요 |
| P2 contracts ownership | 대기 | facade/equivalence, module-ports cycle, subsystem별 import migration |
| P2.5 internal opaque IDs | 대기 | wire string 유지, boundary부터 점진 도입 |
| P3 operation kernel | 대기 | 기존 transitions 재사용, workflow ordering 보존 |
| P4 Store logical facets | 대기 | SQL/connection/writer 소유권 분산 금지 |
| P5 dependency lattice | 대기 | 실제 graph 측정 후 enforcement |
| P6–P9 maturity/format | 별도 단계 | P0–P5와 동시에 진행하지 않음, v1 silent migration 금지 |

## 판단 변경과 검증 기록

[D01–D03 당시 상세 기록](decisions-p0-p1-1.md)은 원본 내용 그대로 보존했다. 그 문서의 진행표는 P1-1 종료 시점 snapshot이며 현재 상태는 이 파일을 따른다.

- D01: read-only, source-pinned CI evidence 경로를 제안에 추가했다.
- D02: P0 차단을 숨기지 않고 독립적으로 검증 가능한 작은 단위만 진행한다.
- D03: 고정 count 제거에 더해 empty/open kind 집합을 fail-closed로 거절한다.
- D04: P1-2는 새 interface 없이 Git을 먼저 구성하고 live context reader를 공유한다. 제어된 테스트와 실제 host proof를 구분한다.

로컬 도구는 Node v22.16.0 / TypeScript 5.8.3이다. repo pin 5.9.3 검증으로 표시하지 않는다. 과거 PASS/LOC/hash를 현재 결과로 재사용하지 않는다.

Single broker, single SQLite writer, synchronous transaction boundary, accepted intent, immutable evidence, explicit unknown, normal/recovery 분리, incarnation fencing, bounded effects 및 OPEN SPIKE를 유지한다. Wire v1 / schema / persisted v1 plan을 변경하지 않는다.
