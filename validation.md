# 설계 및 runtime 검증 색인

## 현재 상태 — C01–C07 코드 이행 감사 후속

**확인된 source 불일치에 대한 수정은 반영했지만 실행 적합성은 NOT_RUN이며 release-ready가 아니다.** 감사 대상 `2a00fa20dae8f68d8f489401ba821c16d3c35fc4` 이후 R25 replay, R32 정상 fixture, R34 concrete owner policy, R36 actual lifecycle sequence 및 R38 inventory 도구를 수정했다. 전체 41개 카드의 소스와 시험을 다시 전수 감사·실행한 것은 아니다.

| 읽을 문서 | 내용 |
|---|---|
| [HANDOFF.md](HANDOFF.md) | 현재 재개 기준, 후속 수정, 미완료 검증 |
| [C01–C07 후속 기록](implementation/conformance-followup.md) | 각 finding의 source 수정·시험·잔여 범위와 commit 목록 |
| [현재 검증 상태](implementation/validation.md) | 실제 수행/NOT_RUN, stale generated artifacts와 유지한 규범 |
| [기존 R37/R39 종료 기록](implementation/refactoring-closure.md) | 이전 구조 분리/호출 순서의 기록, 이번 finding 해결 인증은 아님 |
| [물리 순서](implementation/physical-ordering.md) | canonical phase와 source binding |
| [compliance 계약](implementation/compliance.md) | owner/entrypoint/test/evidence 구분과 실패 조건 |
| [LOC 계약](implementation/loc-budget.md) | cloc 2.08과 unchanged budget |

C01/C02의 확인된 replay 분기와 C03의 phase2/phase4 fixture를 수정했다. C04는 exact transport/subprocess 정책과 actual caller를 정렬했으며 C07은 actual lifecycle을 통과하는 시퀀스를 추가했다. 그 외 fixture·AST 규칙·native 경로의 전체 검증은 아직 없다.

## C05/C06은 현재 PASS가 아니다

`production-files.txt`, `production-loc.json`, `production-loc-hashes.json`은 **STALE**다. 실제 generator를 실행하지 않았으며 source list나 측정 hash를 손으로 채우지 않았다. `npm run inventory`는 실제 실행 시 source list만 생성한다. `npm run check:inventory`는 그 list와 실제 recursive source를 비교하고 architecture 검사도 이를 선행한다. cloc 2.08 LOC/hash 생성은 별도 실제 실행이 필요하다.

모든 typecheck/build/package/architecture/transaction 검사와 fast/durable/kernel/crash/property/stress/all lane은 **NOT_RUN**이다. 새 회귀의 source와 필수 lane 연결이 있다는 사실을 실행 PASS로 부르지 않는다. 검사 방법과 새 output directory를 포함한 명령 예시는 후속 기록에 있다.

기존 source-owners metadata, traceability, generated report 및 raw logs는 해당 source/environment 범위에서만 해석한다. 새로운 코드/의존성/시험에 과거 로그를 재결합하지 않는다. core T01–T77과 tiered T78–T90, OPEN Pi/provider/kernel 계약 및 LOC review 규범도 그대로 유지한다.

## 과거 기록

이전 색인은 [감사 기준 SHA의 snapshot](https://github.com/minjung2035/oma-v2/blob/2a00fa20dae8f68d8f489401ba821c16d3c35fc4/validation.md), 더 오래된 실행 기록은 [historical validation](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/implementation/validation.md)에 보존했다. 과거의 178/178, 5개 leaf PASS, 9,774 LOC 또는 0/258을 이번 변경의 실행 결과나 구현률로 재사용하지 않는다.
