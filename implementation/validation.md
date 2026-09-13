# 검증 상태 — C01–C07 코드 이행 감사 후속

**현재 상태: source 수정 및 시험 작성, 실행 검증 NOT_RUN, release 미인증.** 상세 변경·commit·미충족 범위는 [conformance-followup.md](conformance-followup.md), 재개 기준은 [HANDOFF.md](../HANDOFF.md)에 있다.

이번 후속 작업의 기준은 사용자가 첨부한 `01_CODE_CONFORMANCE_REPORT.md`, `02_CARD_CONFORMANCE.md`의 `2a00fa20dae8f68d8f489401ba821c16d3c35fc4`다. 해당 SHA에서 보고된 결함과 변경 후의 source 상태를 구분한다. 기존 [R37/R39 검증 기록](https://github.com/minjung2035/oma-v2/blob/2a00fa20dae8f68d8f489401ba821c16d3c35fc4/implementation/validation.md)과 [그 이전 실행 기록](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/implementation/validation.md)은 고정 snapshot으로 보존한다.

## 1. 실제 수행과 미실행

| 종류 | 이번 결과 |
|---|---|
| GitHub master/source 조회 | 수행; 감사 기준과 시작 HEAD가 같음을 확인 |
| GitHub source/test/tooling/doc write 및 commit | 수행; 반환된 commit/blob SHA 확인 |
| C01/C02 normal/recovery 제어 흐름 정적 검토 | 수행; frozen desired/epoch fence와 별도 결정 경로 확인 |
| 정상 fixture와 architecture policy의 source 대조 | phase2/phase4 및 관련 actual owner 범위 수행 |
| GitHub Actions master 실행 이력 조회 | total_count=0; 실행 증거가 아니며 권한 거부 판정도 아님 |
| typecheck/build/test/package/architecture/transaction gate | NOT_RUN |
| kernel/Pi/provider/설치/VM power-loss probe | NOT_RUN |
| production inventory/LOC/hash/trace/report generator | NOT_RUN |
| status/stop latency, queue/RSS/FD 성능 측정 | NOT_RUN |

자료에 실린 과거 5/5 leaf test, 178/178 runtime, 9,774 LOC, 0/258 compliance를 이번 source 결과로 재사용하지 않는다. source-only 판단을 actual coordinator test execution이나 native proof로 부르지 않는다.

## 2. 수정한 경계와 작성한 회귀

C01/C02: 과거 nonterminal start/stop은 accepted plan의 desired/previousIncarnation과 현재 target이 맞지 않으면 새 unit 효과를 발행하지 않는다. plan과 target을 덮어쓰지 않고 unknown을 유지한다. `r25-action-replay.test.ts`는 actual PublicDispatcher/LifecycleModule/Store와 controlled unit port를 사용한다. 실제 socket·systemd·cgroup은 이 대역 시험의 범위가 아니다.

C03: `phase4.test.ts`의 valid Agent/hash/auth/epoch 및 awaited cleanup을 수정했다. 추가로 `phase2.test.ts`의 정상 데이터는 actual Mail/Store로 생성하고, CHECK/FK 음성은 정상 Store를 닫은 뒤 명시적 raw helper로 주입한다. 다른 legacy phase/audit 전체의 valid fixture 이관은 아직 전수 검증하지 않았다.

C04: 실제 framed channel의 node:net와 구체적 subprocess owner를 구분했다. Units/CLI raw spawn은 공통 bounded mechanism으로 이동했다. `r34-owner-policy.test.mjs`는 actual import와 금지된 neighboring/pure import를 검사하도록 작성했다. 전체 AST/compiler/import SCC가 통과했다는 뜻은 아니다.

C07: `r36-lifecycle-sequences.test.ts`의 start/stop/retry는 actual lifecycle dispatch를 통과한다. 독립 예상 trace, seed, authored C01/C02 corpus와 minimizer를 연결했다. 기존 Store/Mail model을 삭제하지 않았다.

새 tests는 기존 fast/durable/property/all lane에 추가됐다. kernel/crash의 기존 필수 파일과 no-skip/critical-oracle 정책은 제거하지 않았다. expanded 실행 개수·이름·도달성의 전후 비교는 NOT_RUN이다.

## 3. C05/C06 및 generated artifact 상태

| 파일/범위 | 현재 해석 |
|---|---|
| production-files.txt | 이전 generated list, STALE. 재생성하지 않았으므로 C05의 실제 omission 해결은 미확인 |
| production-loc.json, production-loc-hashes.json | STALE. 현 코드의 LOC 또는 source-bound 측정값으로 사용 금지 |
| production-inventory.mjs / loc.mjs --inventory-only | actual recursive source-list 생성·누락 검사 코드 작성. 실행은 NOT_RUN |
| check:inventory | 현재 stale list를 거절하도록 연결. 실행 PASS 아님 |
| traceability.json / adversarial-review.md | 새 generator 실행 없음. 전 규범 owner/evidence 완료로 해석 금지 |
| 기존 raw test logs 및 audit-source-pins.json | 당시 source/environment의 역사적 기록. 새 source hash에 재결합하지 않음 |
| source-owners.json | authored locator metadata이며 current-source execution proof가 아님 |

`npm run inventory`는 실제 실행 시 source list만 생성한다. full LOC/hash는 `node scripts/loc.mjs`의 pinned cloc 2.08 실행이 필요하다. source list 생성과 LOC 측정을 나눈 것은 cloc를 다른 계산기로 대체하거나 LOC 규범을 완화한 것이 아니다.

실행 환경용 명령 순서와 각 lane의 새 output directory 예시는 [후속 기록 §7](conformance-followup.md#7-inventory실행증거의-남은-경계)에 있다. 명령 예시 자체는 실행 로그가 아니다. 실패·환경 미지원·누락 oracle은 그대로 기록해야 하며 skip으로 전체 PASS를 만들지 않는다.

## 4. 계속 남는 게이트

S-01/S-01-CANDIDATE의 실제 isolation/descendant/resource, S-02의 기존 Human Pi attach, S-03의 trusted consumption, S-04의 provider codec/accounting은 실제 evidence 없이 해제하지 않는다. S-05/S-06의 hostile import, crash, 전원단절 및 backup/restore를 새로 인증하지 않았다. 유료 provider와 host reboot는 실행하지 않았다.

S-08/S-10 tiered attestation/challenge/floor와 S-11 strict clean-room, S-09 품질·비용·latency 평가는 기존 미확정 상태다. base를 tiered 완료로 바꾸거나 not_applicable을 선언해 필수 proof를 면제하지 않는다. current source가 10,000 LOC 이하인지도 새 cloc 측정 전에는 알 수 없다.

## 5. 보존한 검증 규범

다음 규범의 문구는 유지한다. 기존 상세 실행 기록은 위 고정 historical snapshot에 있다.

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

| 결과 범주 | 참조 | 현재 해석 |
|---|---|---|
| 초기 설계/primitive/선언 검사 | historical validation Phase 0–9 | 당시 환경의 제한된 결과 |
| 이전 runtime/CLI/첨부 감사의 leaf 진단 | 각 source SHA와 raw logs | 당시 범위, 이번 변경의 실행 아님 |
| C01–C07 후속 source 변경 | conformance-followup.md | source review 및 commit 확인, 실행 NOT_RUN |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
