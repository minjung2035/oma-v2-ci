# 설계 및 runtime 검증 색인

## 현재 상태 — R37/R39 종료 기록

**실행 검증은 NOT_RUN이며 release-ready가 아니다.** 이번 작업에서는 R37의 비동기 준비/관측 연결과 R39의 source owner·검증 도구·인계를 갱신했다. GitHub commit 성공은 확인했지만 typecheck/build/test/package/LOC 및 실제 kernel/Pi/provider 시험은 실행하지 않았다.

| 읽을 문서 | 내용 |
|---|---|
| [HANDOFF.md](HANDOFF.md) | 카드 완료 marker, 실제 commit, 남은 substep, 재검증 범위 |
| [현재 검증 상태](implementation/validation.md) | 수행/미수행 구분, lane별 NOT_RUN, stale source pin 및 release gate |
| [리팩터링 종료 기록](implementation/refactoring-closure.md) | 현재 owner/호출 경로, async 준비와 sync final effect, 호환성·제한 |
| [물리 순서](implementation/physical-ordering.md) | 기존 canonical phase와 새 source binding |
| [compliance 계약](implementation/compliance.md) | owner/entrypoint/test/evidence 구분 및 checker의 실패 조건 |
| [LOC 계약](implementation/loc-budget.md) | cloc 2.08, 현재 미측정 상태와 unchanged budget |

R37 완료 marker는 `7875afbbe71ae44a65415648774e7f9b95fa4b34`이며, R39 최종 marker는 HANDOFF 변경 commit에서 확인한다. marker는 작업 재개 위치용이지 full-clause behavioral proof가 아니다.

## 생성 산출물과 실행 증거를 구분한다

`implementation/source-owners.json`은 검토한 source locator의 authored metadata다. `traceability.json`의 미연결 행은 unverified로 유지한다. 새 checker는 owner/dependency/test가 바뀐 과거 proof를 그대로 통과시키지 않는다. 전체 규범의 남은 owner/negative-oracle 검토와 production entrypoint 실행 증거가 완료된 것은 아니다.

`production-files.txt`, `production-loc.json`, `production-loc-hashes.json`, generated adversarial report 및 기존 evidence pin/log는 이번 작업에서 재생성하지 않았다. 현재 source의 PASS, test count, LOC 또는 compliance 분모로 인용해서는 안 된다. 현재 production LOC가 budget 안에 있는지도 실제 재측정 전에는 미확인이다.

T01–T77 core와 T78–T90 tiered target은 별도 actual-row inventory로 검사한다. target 숫자를 합계 상수에 넣거나 missing oracle을 생략하여 PASS를 만들지 않는다. actual generator 실행과 수용 시험은 NOT_RUN이다.

## 과거 기록

이전 페이지는 [고정 historical snapshot](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/validation.md)에 보존했다. 상세 이전 실행 이력은 [당시 implementation/validation.md](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/implementation/validation.md)에 있다.

그 기록의 83/83·178/178, 9,774 code lines, non-empty physical line 값과 단일 CLI PASS는 당시 source/environment의 관측이다. 서로 다른 기준을 합치거나 현재 코드의 결과로 재사용하지 않는다. 초기 systemd template/Git CAS/Maildir 조합 실험도 실제 OMA 전체 runtime/Pi/provider 또는 전원 장애의 증거가 아니다.

현재 미실행 gate와 명령 목록은 위 현재 검증 상태를 따른다. 실제 실행과 source pin이 없는 품질 개선률이나 출시 승인은 이 문서에서 산출하지 않는다.
