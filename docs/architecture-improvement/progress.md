# 안정성 보존형 아키텍처 개선 — 현재 진행

작업 브랜치: `refactor/safety-preserving-architecture`. 최초 기준 `e2afe9ab050d87705451cd127c458ad216aa52d4`, 이번 재개 기준 `21aebb76ca5100639962ffb9ccc396bc0c3d86a7`. 원문은 [제안서](../proposals/2026-09-13-safety-preserving-architecture.md)에 그대로 있다. master에는 자동 병합하지 않는다.

P1 당시 진행 문서는 [historical snapshot](p1-progress-history.md)으로 보존했다. 그 문서와 PR의 오래된 본문에 있는 P2 미착수 표기는 현재 판정이 아니다.

| 단계 | 현재 상태 | 근거 / 남은 일 |
| --- | --- | --- |
| P0 | 전체 검증 BLOCKED | 고정 의존성 설치/전체 suite/native lane 및 full LOC는 별도 실행 필요 |
| P1 | 기존 구현 존재 | magic count, composition, public validation; 과거 25 test 증거는 당시 source에 한정 |
| P2 | 진행 | concept owners, facade, module-ports 단방향, protocol/storage/domain import 이전 반영; 잔여 subsystem/gate 정리 필요 |
| P2.5 | 경계 도입 반영 | validated ledger output brand 보존; p25-identities.md |
| P3 | 진행 | 기존 SQLite 특성 시험 + [Journal mechanism 10 test](p3-journal.md); Store 연결/scoped facet/recovery exhaustiveness 남음 |
| P4 | 미완료 | 단일 writer/connection을 유지하는 logical facets |
| P5 | 미완료 | 실제 graph와 dependency gate |
| P6 | 미완료 | reconcile과 독립인 read-only integrity |
| P7 | 미완료 | leaf durability fault matrix와 반복 recovery |
| P8/P9 | 범위 밖 | persisted v1 변경/VM power-cut은 이번 요청에 포함하지 않음 |

각 구현 단위 문서에 실제 실행 명령, 검증 범위, source hash와 제안서 대비 판단을 기록한다. 구현 존재와 실행 PASS, release proof는 구분한다. 새로운 Journal/진단/시험 코드가 있다는 이유로 OPEN SPIKE를 닫지 않는다.
