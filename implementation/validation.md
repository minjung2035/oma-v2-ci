# 검증 상태 — R37/R39 종료 시점

**현재 상태: 실행 검증 NOT_RUN, release 미인증.** 카드 처리와 GitHub commit 성공을 runtime PASS 또는 배포 승인으로 해석하지 않는다. 이번 종료 기록은 [refactoring-closure.md](refactoring-closure.md), 카드/commit 목록은 [HANDOFF.md](../HANDOFF.md)에 있다.

이 파일의 과거 장문 실행 기록은 삭제된 증거가 아니라 Git history의 고정 snapshot으로 보존했다: [R37 종료 시점의 이전 validation.md](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/implementation/validation.md). 이전 파일의 “현재”, 83/83, 178/178, 9,774 LOC 및 개별 PASS는 각각 그 기록의 source/environment에 한정된다. 현재 리팩터링 코드에서 재실행한 값이 아니다.

## 1. 실제 수행한 작업과 하지 않은 작업

| 종류 | 이번 결과 | 해석 |
|---|---|---|
| GitHub master/ref/source 조회 | 수행 | 기존 R37 중간 변경과 대상 owner의 코드를 읽음 |
| GitHub contents write/commit | 수행, 반환된 commit SHA 확인 | 저장소에 source/test/doc가 기록됐다는 확인 |
| source의 정적 읽기 | 수행 | Promise 연결, final authorization/CAS 순서, immutable plan, 관측과 effect 분리 점검 |
| runtime/typecheck/build/test | NOT_RUN | pass/fail/test count를 새로 산출하지 않음 |
| package/install/native/kernel/Pi/provider probe | NOT_RUN | 실제 설치 asset, SDK, cgroup, provider 또는 전체 E2E 보장 아님 |
| LOC/trace inventory/report/compliance generator | NOT_RUN | 새 집계·normative fingerprint·실행 source pin을 손으로 만들지 않음 |
| 품질/비용/성능 평가 | NOT_RUN | 개선률, 예상 통과율 또는 release-ready 점수 없음 |

R37 종료 marker는 `7875afbbe71ae44a65415648774e7f9b95fa4b34`다. R39는 source 연결/검증 도구/문서를 변경했으므로 R37의 source snapshot만으로도 최종 R39 proof를 대신할 수 없다.

## 2. 현재 source에서 정적으로 확인한 보호 경계

Git façade는 quarantine과 context 준비 Promise를 반환하고 호출자는 이를 기다린다. 생성은 workspace 준비가 끝난 뒤에만 공개 경계로 진행한다. 비동기 대기 뒤 현재 권한·spec/incarnation·desired·expected ref를 다시 읽으며, 최종 검사와 CAS/start 사이에 임의의 새 await를 두지 않았다.

systemd show와 startup fsck는 bounded async 관측 경로를 사용한다. 비동기 결과는 Store-bound `confirmDead`를 대체하지 않는다. logical 요청 완료 후에도 불확실한 native 준비가 남으면 shutdown barrier가 Store/lock 해제를 차단한다. 이것을 임의 descendant 사망 또는 kernel quota 인증으로 확대하지 않는다.

증거 checker는 같은 fingerprint/같은 link의 record를 보존하며 바뀐 owner/entrypoint/call path/test는 unverified로 처리한다. 새 dependency/test 파일, missing/stale/extra/duplicate trace, import closure 이탈을 실패로 남긴다. report가 과거 runtime log를 현재 source hash에 재결합하던 경로는 제거했다. 이 설명은 checker 자체를 실제 실행하여 확인한 PASS가 아니다.

## 3. 작성한 시험과 미실행 lane

| lane/검사 | 현재 상태 | 실행 시 요구되는 환경과 범위 |
|---|---|---|
| typecheck, build, check:package | NOT_RUN | 현재 lockfile/Node/TypeScript와 실제 emitted/install asset |
| check:architecture, check:transactions | NOT_RUN | source closure, transaction capability와 async callback 정적 규칙 |
| verify:fast | NOT_RUN | deterministic domain/schema 및 R39 trace policy |
| verify:durable | NOT_RUN | 실제 SQLite/Git/filesystem, R37 child/preparation/shutdown 경합 |
| verify:kernel | NOT_RUN | 실제 user-systemd/native socket/cgroup/Pi 관련 기존 oracle |
| verify:crash | NOT_RUN | 요구된 physical stop point 도달 후 SIGKILL/restart; 단순 예외 주입과 구분 |
| verify:property | NOT_RUN | 고정 seed 모델·parser corpus·global invariant |
| verify:stress | NOT_RUN | 자원/queue/FD/RSS 계측; 임의 process-tree death 인증 아님 |
| verify:all, npm test | NOT_RUN | 전체 serial suite, skip/todo/critical-oracle 누락을 통과로 세지 않음 |
| cloc/loc fixture | NOT_RUN | pinned cloc 2.08 및 systemd language filter |
| trace inventory/report/compliance | NOT_RUN | 현재 source/문서의 실제 분모 및 새 scope-matched 실행 evidence |

새 R37 시험은 `r37-async-process`, `r37-preparation-boundaries`, `r37-recovery-observation`, `r37-shutdown-observation`이다. R39는 `traceability-policy.test.mjs`, 기존 `compliance.test.ts` 및 `acceptance-auth.test.ts`를 정리했다. recovery의 scripted unit race test와 실제 kernel lane은 별개의 oracle이다. 기존 성공 이름을 재사용했다는 이유로 새 연결 전체를 proven으로 간주하지 않는다.

다음은 실행 환경에서 사용할 명령 목록이며 **이번에 실행했다는 기록이 아니다**.

```sh
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm run verify:fast
npm run verify:durable
npm run verify:kernel
npm run verify:crash
npm run verify:property
npm run verify:stress
npm run verify:all
node scripts/loc.mjs
node scripts/compliance.mjs --inventory
node scripts/adversarial-report.mjs
node scripts/compliance.mjs
```

`--inventory`와 LOC/report 명령은 파일을 생성/갱신하므로 실제 source closure와 실행 로그를 고정해 기록해야 한다. 실패하거나 환경이 미지원이면 해당 상태를 유지한다. 임의로 skip하거나 OPEN profile을 비활성 성공으로 위장해 전체 PASS를 만들지 않는다.

## 4. 현재 재사용할 수 없는 생성 산출물

| 기존 파일 | R39 처리 |
|---|---|
| `production-files.txt`, `production-loc.json`, `production-loc-hashes.json` | 이전 snapshot, 현재 수치로 재사용하지 않음. 재생성 NOT_RUN |
| `implementation/traceability.json` | 수동 hash 갱신 없음. 명시적 `source-owners.json` overlay와 current source 검사를 거쳐 읽음. 미연결 행은 unverified |
| `implementation/adversarial-review.md` | 이전 generated report 유지. 새 generator 실행 NOT_RUN; 현재 full-scope 결과로 인용 금지 |
| `implementation/evidence/runtime-tests.txt`, `cli-oracle-tests.txt` | 과거 raw log 보존. 현재 코드 재실행이나 class-wide proof가 아님 |
| `implementation/evidence/audit-source-pins.json` 등 이전 pin | 변경된 owner/dependency/spec에 대해 stale. 과거 로그를 새 hash에 붙이지 않음 |
| `implementation/source-owners.json` | 검토한 locator의 authored metadata. 실행 evidence나 자동 완전 coverage가 아님 |

core T01–T77과 target tiered T78–T90은 별도 actual-row inventory다. 이번에는 전체 inventory를 실행하지 않았으므로 새 분모를 보고하지 않는다. 누락/중복 target oracle은 실패 조건이며 새 oracle을 규범 결정 없이 발명하지 않았다. 오래된 0/258 표시는 당시 evidence gap이지 구현이 0%라는 뜻이 아니다.

## 5. 계속 남는 게이트와 위험

S-01의 실제 isolation/descendant/resource proof, S-01-CANDIDATE의 kernel-bounded 작업 영역, S-02의 기존 Human Pi attach 경계, S-03의 trusted consumption, S-04의 provider codec/cancel/accounting은 관련 실제 evidence 전까지 해제하지 않는다. S-05/S-06의 hostile import/crash/power-loss 범위도 이번 코드 작성으로 새 인증을 얻지 않았다. VM 전원단절이나 유료 provider 호출을 수행하지 않았다.

S-08/S-10의 tiered attestation/challenge/floor 계약과 S-11의 strict clean-room verifier는 기존 OPEN/비활성 경계를 유지한다. base 경로를 tiered 구현으로 재명명하지 않는다. S-09의 사회 품질·비용·지연 비교는 미실행이다. optional feature도 실제 disabled-profile rejection 증거 없이는 not_applicable로 승격하지 않는다.

미연결 규범의 authoritative owner와 negative oracle 검토, 설치된 production entrypoint의 실행 증거 및 formal trace promotion은 남아 있다. 타입/API·test source·commit marker만으로 이 공백이 닫혔다고 보고하지 않는다. 현재 LOC가 10,000 이하인지도 재측정 전에는 알 수 없다.

## 6. 검증 기록에 적용되는 기존 규범

다음 다섯 규범은 기존 문서의 문구를 유지한다. Phase 0–10의 상세 수치/표/실행 이력은 위 고정 historical snapshot에서 확인한다. 이 절에 남은 과거 단계의 설명을 R37/R39의 새 실행 결과로 해석하지 않는다.

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

| 결과 범주 | 참조 | 현재 해석 |
|---|---|---|
| 초기 설계/primitive/선언 검사 | 고정 historical validation snapshot의 Phase 0–9 | 해당 당시 환경의 제한된 결과 |
| 이전 runtime 및 단일 CLI oracle | 같은 snapshot의 runtime audit 및 raw logs | 당시 source 범위, 현재 실행 아님 |
| R37/R39 코드·문서 정리 | 이 문서 §§1–5 | 정적 source 읽기와 commit 확인, 실행 NOT_RUN |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
