# 안정성 보존형 아키텍처 개선 — 현재 진행

작업 브랜치: `refactor/safety-preserving-architecture`. 최초 기준 `e2afe9ab050d87705451cd127c458ad216aa52d4`, 이번 재개 기준 `e314fc6842cc46191e324c0c49b055a53cf6d70e` (PR #2, 17 commits). 원문은 [제안서](../proposals/2026-09-13-safety-preserving-architecture.md)에 그대로 있다. master에는 자동 병합하지 않는다.

이 표는 이전 진행표에서 누락된 실제 P3/P4 커밋을 반영한다. P1 당시 문서는 [historical snapshot](p1-progress-history.md)으로 보존했다. 오래된 PR 본문의 P2 미착수 표기는 현재 상태가 아니다.

| 단계 | 현재 상태 | 근거 / 남은 일 |
| --- | --- | --- |
| P0 | 전체 검증 BLOCKED | 이번 환경에서도 GitHub/npm DNS 해석 실패. pinned 의존성 설치/전체 suite/native lane/full LOC는 실행 증거 필요 |
| P1 | 구현 반영 | magic count, composition, public validation; 과거 25 test 증거는 당시 source에 한정 |
| P2 | 일부 반영 | concept owners, facade, module-ports 단방향, protocol/storage/domain import 이전; 잔여 subsystem/gate 정리 필요 |
| P2.5 | 경계 도입 반영 | validated ledger output brand 보존; p25-identities.md |
| P3 | Journal·Store 연결·scoped operation API·복구 exhaustive 분기 반영 | p3-journal.md, p3-store-integration.md, p3-recovery.md; coordinator call-site 이전 남음 |
| P4 | logical facets 반영 | p4-facets.md; 동일 writer/connection/transaction, six read/write facets, 과거 focused 21 tests |
| P5 | 미완료 | 현재 전체 import graph 측정과 dependency gate |
| P6 | 미완료 | reconcile과 독립인 read-only integrity |
| P7 | 미완료 | leaf durability fault matrix와 반복 recovery |
| P8/P9 | 범위 밖 | persisted v1 변경/VM power-cut은 이번 요청에 포함하지 않음 |

## 이번 재개 시 확인

현재 컨테이너에는 첨부 원문은 있으나 이전 `/mnt/data/oma-p7` 작업 사본은 없다. 저장소의 실제 커밋을 기준으로 필요한 source를 복원하며, 이전 실행 결과를 현재 실행 결과라고 재사용하지 않는다. 실제 실행 명령과 source hash, 검증 한계는 각 구현 단위 문서에 추가한다.

구현 존재, focused test PASS, 전체 검증, release proof는 구분한다. 새로운 Journal/진단/시험 코드가 있다는 이유로 OPEN SPIKE를 닫지 않는다. accepted v1 bytes, normal/recovery 분리, explicit unknown, SQLite 단일 writer와 synchronous transaction, 현재 physical ordering을 보존한다.
