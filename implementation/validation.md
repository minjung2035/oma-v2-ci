# 구현 계약 산출물 검증 기록

작성일: 2026-09-07. 대상은 spec/선언/DDL/template이며 application 구현이 아니다.

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 실제 runtime가 구현되거나 S-01~09가 통과했다고 인용하지 않는다.

| 검사 | 실제 수행 결과 | 한계 |
|---|---|---|
| architecture hash | `2a2e74c1e6b4986145a7ac54b37a9f50c297363a9c134a360f75bbba3db4a404` 유지 | 기준 문서 내용은 변경하지 않음 |
| TypeScript declarations | TypeScript 5.9.3, ES2022, nodenext, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes, noEmit 통과 | 구현 및 runtime schema validator 아님; 배포 Pi/Node version 선택 아님 |
| 두 정합성 수정의 타입 회귀 검사 | [contracts.type-test.ts](tests/contracts.type-test.ts)를 같은 strict 옵션으로 검사 통과; mutation key 필수·read/wait key 금지·create authority 입력 금지·resolved spec 변수의 wire 전달 거절 확인 | compile-only 검사; runtime validator 구현을 뜻하지 않음 |
| mutation 집합 대조 | SQL operations.kind 11개와 TypeScript MutationMethod 집합 일치; public method 분류 누락/중복 없음 | 새 method 추가 때 재검사 필요 |
| 초기 SQL | 임시 SQLite 3.53.4 DB에서 적용, 정확히 여섯 table, user_version=1, FK/integrity 통과 | production binding·WAL power loss 검증 아님 |
| SQL negative check | materialized/batch 없이 presented 설정 시 제약 거절 | 전체 77개 tests 구현·통과를 뜻하지 않음 |
| systemd templates | 임시 renderer 결과 7개를 systemd-analyze verify로 문법/의존성 검사 통과 | ExecStart 실행 파일은 검사본에서 true로 대체; 설치·시작하지 않음 |
| 문서 구조 | local links, code fences, 본문 requirement ID 중복 검사 통과 | 설계의 runtime correctness 증명 아님 |
| bwrap CLI | 로컬 --help에서 argv primitive 및 --size 지원 확인 | 실제 namespace isolation/Principal tools 검증 아님 |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** 기존 저장소 코드를 이 문서 작성·검증에서 읽거나 재사용했다고 추정하지 않는다. 검증은 이 설계 디렉터리와 별도 임시 fixtures에서 수행했다.
