# C01–C07 코드 이행 감사 후속 조치

## 1. 기준과 현재 판정

기준 자료는 사용자가 첨부한 `01_CODE_CONFORMANCE_REPORT.md`와 `02_CARD_CONFORMANCE.md`다. 두 보고서의 감사 대상은 `minjung2035/oma-v2@2a00fa20dae8f68d8f489401ba821c16d3c35fc4`이며, 이번 수정 시작 때 확인한 master도 같은 commit이었다. 기존 R00–R40을 처음부터 다시 작성한 것이 아니라 보고서의 구체적인 미충족 경계를 수정했다.

**판정: 확인된 코드 반례와 일부 통합 불일치에 대한 수정은 반영했으나, 전체 코드 이행·실행 적합성을 승인하지 않는다.** source 수정, 작성된 회귀시험, 실행 결과, generated evidence를 서로 다른 상태로 기록한다. 이전 감사 자체와 당시의 반례는 역사적 기준이며 이번 수정으로 소급 삭제되지 않는다.

모든 저장소 읽기/쓰기/commit은 GitHub plugin을 사용했다. 테스트·typecheck·build·kernel/provider·설치·performance 및 generator는 실행하지 않았다. master의 GitHub Actions 실행 이력 조회는 `total_count=0`이었다. 이를 쓰기 권한 문제나 실행 PASS로 해석하지 않는다.

## 2. finding별 후속 상태

| ID | 이번 수정 | 정확한 현재 상태 | 아직 필요한 확인 |
|---|---|---|---|
| C01 | nonterminal start replay가 현재 desired 및 frozen previousIncarnation과 일치하는지 effect 전에 검사 | SOURCE_FIXED / TESTS_AUTHORED / NOT_RUN | 실제 public-dispatch 회귀 실행 및 real systemd 경로 |
| C02 | stop replay에 frozen previousIncarnation을 전달하고 새 epoch/상반된 desired에는 효과를 발행하지 않음 | SOURCE_FIXED / TESTS_AUTHORED / NOT_RUN | 새 run 발급·stop 경합과 native death proof |
| C03 | phase4의 canonical Agent seed/권한/복구 hash·epoch·async cleanup 수정; 추가로 phase2의 정상 Mail/Store/batch fixture 이관 | WITNESSED_FIXTURES_FIXED / GLOBAL_MIGRATION_UNVERIFIED | 다른 legacy phase/audit fixture 전수 검토와 전체 suite 도달성·개수 비교 |
| C04 | exact codec/transport/subprocess ownership 정책을 실제 경로와 정렬; Units와 CLI 직접 spawn을 공통 실행기로 이동 | WITNESSED_OWNER_MISMATCHES_FIXED / WHOLE_GATE_NOT_RUN | pinned TypeScript의 전체 gate, SCC/기타 AST findings 및 새 음성 대조군 실행 |
| C05 | recursive inventory owner, stale-list 검사, inventory-only 생성 경로와 누락 회귀 작성 | TOOLING_FIXED / GENERATED_ARTIFACTS_STILL_STALE | 실제 production-files 재생성, cloc 2.08 LOC/hash와 설치 closure 대조 |
| C06 | 새 oracle를 기존 lane에 연결하고 미실행 범위를 유지 | OPEN / NOT_RUN | baseline, build/typecheck, full lanes, 설치, 성능, current-source evidence |
| C07 | 실제 PublicDispatcher → LifecycleModule → LifecycleActions를 호출하는 seeded retry sequence와 C01/C02 corpus 추가 | COVERAGE_ADDED_IN_SOURCE / NOT_RUN | 생성 sequence/minimizer 실행, kernel/crash와 별도 결과 기록 |

C05의 현재 `production-files.txt`, `production-loc.json`, `production-loc-hashes.json`을 새로운 측정처럼 수동 작성하지 않았다. 이 파일들은 여전히 STALE다. 새 코드가 존재한다는 이유로 C05/C06을 해결 완료로 바꾸지 않는다.

## 3. C01/C02의 결정 경계

`src/lifecycle/actions.ts`는 normal start/stop과 reconcile의 별도 결정 경로를 유지한다. 공통 helper `currentIntent`는 실행 허가를 새로 생성하지 않고 다음 관계만 검사한다.

```text
현재 target.desired == accepted plan.desired
현재 target.incarnation == accepted plan.previousIncarnation
```

과거 pending/unknown 요청이 이 관계를 만족하지 않으면 unit start/stop을 호출하지 않는다. target desired나 accepted plan을 고쳐 일치시키지 않으며, 역사적 효과가 증명되지 않은 요청은 unknown으로 남긴다. stop에는 현재 새 incarnation이 아니라 원래 plan의 incarnation을 전달한다. terminal replay의 기존 인증 순서와 result bytes는 유지한다.

이는 과거 효과가 어떤 invocation에서 발생했는지를 새로 증명한 구현이 아니다. frozen epoch와 다른 현재 실행만으로 과거 요청을 성공 또는 확정 실패로 합성하지 않는다. DDL/공개 enum/epoch table/새 wire field는 추가하지 않았다.

`test/fixtures/lifecycle-replay.ts`는 actual Store, operation decoder, management authority, PublicDispatcher와 LifecycleModule을 사용한다. **Units만 명시적인 관측/효과 대역**이며 실제 authenticated socket/cgroup 시험이라고 부르지 않는다. `test/r25-action-replay.test.ts`는 pending/unknown, normal/recovery, desired/epoch 변경, unchanged 대조군, terminal bytes, stale caller, revoke, GOAL/provisioning/retired/unknown death를 구분한다.

## 4. 정상 fixture와 negative oracle

`test/phase4.test.ts`의 principal/a/b seed는 `makeValidAgent`를 사용하고 목표 시험 전에 actual getAgent decoder를 통과하도록 구성했다. principal incarnation 0과 resident incarnation 1을 auth와 맞췄다. T38은 stopped target 자신의 실패하는 credentials 대신 유효한 별도 manager를 사용하므로 death oracle에 도달할 수 있다. pending start/stop fixture는 실제 requestHash와 해당 target의 epoch를 사용한다. Broker의 비동기 start/drain을 기다리고 생성한 society unit만 정리한다.

phase2에서는 가짜 `specHash`, `requestHash`, `{}` payload와 서로 맞지 않는 message plan을 정상 setup에서 제거했다. idempotency·message/delivery 대조군은 actual MailModule.send로 생성한다. batch INSERT와 exact delivery linkage를 같은 transaction 안에서 만들고, missing/foreign/already-linked 음성 사례는 해당 transaction이 거절되는지 확인한다. SQL CHECK/FK 음성은 정상 Store를 닫은 뒤 `mutateRawRowAfterClose`에서 주입하고 다시 연 Store의 정상 상태도 검사한다.

기존 시험 제목과 핵심 음성 조건을 보존하는 방향으로 수정했지만 **expanded test count와 전체 assertion 도달성의 실행 비교는 NOT_RUN**이다. 이 두 파일 수정으로 다른 legacy fixture까지 전역 이관됐다고 선언하지 않는다. production decoder와 S-03 gate를 느슨하게 하지 않았다.

## 5. architecture owner 정렬

`scripts/architecture-owners.mjs`는 경로 전체 예외나 기존 findings baseline이 아니라 구체적 책임을 선언한다.

| owner | 허용 이유 |
|---|---|
| src/process/run.ts | bounded sync command 및 final no-await 관측 |
| src/process/async.ts | bounded asynchronous child/pipe 수명 |
| src/process/policies.ts | 공통 runner를 통한 명시적 inherited-terminal host editor |
| src/rpc-client.ts | 유한 framing/write/drain/close 정책을 가진 장기 Pi JSONL session |

protocol family에서 `src/protocol/channel.ts`의 `node:net`만 실제 transport 책임으로 구분한다. 같은 파일의 fs/subprocess/SQLite/Store/entrypoint import나 다른 pure codec의 net import는 계속 거절한다. raw SQLite owner는 actual Store다. Units와 CLI에는 새로운 spawn 예외를 주지 않았다.

Units는 공통 process runner를 호출한다. CLI는 중복 Git environment와 raw spawn을 제거하고 기존 bounded `runGitText`를 사용한다. parent 관측은 성공한 명시적 parent manifest만 사용하므로 unavailable/timeout 결과를 root commit으로 축약하지 않는다. 기존 first-parent prerequisite 의미와 frozen-first request/cache 정책은 유지한다. 명령 한도 도입은 명시적 동작 변경이며 CLI/native 회귀는 미실행이다.

`test/r34-owner-policy.test.mjs`는 actual project import 정책 대조와 type-only/mixed import, neighboring owner, forbidden filesystem/SQLite/Store/subprocess 사례를 포함한다. 다른 AST 규칙, compiler diagnostics, exact source-hash baseline invalidation 및 source closure 실패를 제거하지 않았다. 전체 gate가 통과했다고 주장하지 않는다.

## 6. 실제 lifecycle sequence와 lane 연결

기존 독립 Store/Mail model은 유지했다. 새 `test/r36-lifecycle-sequences.test.ts`에서는 첫 action이 actual dispatch를 통해 접수된 뒤 controlled unit effect가 실패하도록 한다. 이어서 새 start/stop 의도를 actual coordinator로 실행하고 원래 key의 normal/recovery 재시도를 대조한다.

새 incarnation 발급만 별도의 명시적 외부 runner event로 모델링한다. 이 DB event를 start/stop 구현의 대체물로 사용하지 않는다. seed/PRNG/replay metadata, authored C01/C02 corpus 및 bounded minimizer를 연결했고, 실제 실패할 때만 탐색 artifact를 만든다. kernel 또는 SIGKILL 증거는 별도다.

기존 lane의 필수 파일을 삭제하지 않고 다음을 추가했다.

- durable: phase2 및 R25 action replay.
- property: actual lifecycle sequence 및 필수 실행 이름.
- fast/all: R34 exact owner policy, R38 inventory negative tests.

skip/todo/critical-oracle 누락과 test-count 감소를 실패로 남기는 기존 검증을 유지했다.

## 7. inventory·실행·증거의 남은 경계

`scripts/production-inventory.mjs`는 실제 디렉터리의 recursive inventory를 소유한다. 잘못된 상대 경로, 누락된 필수 source root, symlink, duplicate canonical source, unsupported .in 및 stale generated list를 거절한다. 같은 bytes를 가진 서로 다른 source 파일은 각각 남긴다.

`npm run inventory`는 `scripts/loc.mjs --inventory-only`를 실행하도록 추가했다. 실제 실행하면 source list만 생성하고 LOC/hash는 STALE_NOT_RUN이라고 표시한다. full loc 경로는 계속 cloc 2.08/systemd language filter/skip-uniqueness를 사용하며 모든 file row와 SUM을 대조한 뒤 실제 source hashes를 쓴다.

`npm run check:inventory`와 architecture 선행 검사는 stale list를 실패시킨다. **현재 generated list는 재생성하지 않았으므로 이 precheck를 통과했다고 보고하지 않는다.** 실측이 없는 source count, LOC, RSS, latency, FD delta 또는 hash를 채워 넣지 않았다.

아래 명령은 실행 환경용 재검증 순서이며 이번 실행 로그가 아니다. dependency 설치는 기존 lockfile과 TypeScript 5.9.3을 사용하고 실제 Node/native 요구를 확인해야 한다. 출력 디렉터리는 매 실행 새로 지정한다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm run verify:fast -- --out /tmp/oma-conformance-fast-new
npm run verify:durable -- --out /tmp/oma-conformance-durable-new
npm run verify:property -- --out /tmp/oma-conformance-property-new
npm run verify:kernel -- --out /tmp/oma-conformance-kernel-new
npm run verify:crash -- --out /tmp/oma-conformance-crash-new
npm run verify:stress -- --out /tmp/oma-conformance-stress-new
npm run verify:all -- --out /tmp/oma-conformance-all-new
node scripts/loc.mjs
```

실제 규범/trace generator는 마지막 source와 scope-matched 새 raw logs를 기준으로 별도 실행해야 한다. 이전 178/178, 다른 SHA의 leaf 5/5, 9,774 LOC 또는 과거 audit pins는 이 수정의 PASS 근거가 아니다. 실제 paid provider, host reboot, VM power cut은 새로 수행하지 않았다. OPEN Pi/provider/kernel/tiered 계약은 해제하지 않았다.

## 8. 후속 commit 목록

| commit | 변경 |
|---|---|
| 45e98baa1e535d47f479949da932bf00494c34cc | actual lifecycle replay fixture |
| a9ac85fafa801f376cb81e3dc9f88bb1ad9cf9b2 | C01/C02 회귀시험 최초 작성 |
| 778d2100fe805841463cae4fd6cf17bf8d328908 | frozen desired/incarnation replay fence |
| a204a37348c4d4612ae4efe6e8e405896274736e | valid transition 및 인증 대조군 정리 |
| a99e64197743b03e372742e8548fdfb882a47759 | phase4 normal fixture와 kernel oracle setup |
| 939498757011db3b67c254a9e457a4782b1bfa2a | Units spawn 공통화 |
| 1ca835b3e4ff7a5919a086d6ebbd7695277447f1 | exact architecture owner 정책 |
| 3dbd0f90c876df2871d101dd3d42e070ada06133 | actual AST gate 정책 연결 |
| de46ca22540b9d77f00e4336eb58945a9d961c7b | owner 정책 정상/음성 시험 |
| b754b7ba10e3eebb351d404a280b8cf60ffe1344 | actual lifecycle seeded sequence |
| 0a08eb7a7181e6a506b4980d762c65d06a743c95 | recursive source inventory owner |
| 587a6e0d3009254d94ea99131218e8615c6150af | inventory-only와 cloc 결과 분리 |
| 5a6f5655eb23b794dcc7c8a242675e58770f5588 | manifest omission/duplicate/symlink 회귀 |
| 29b6717cc15aca3f69f0ec4eef452544dfa07fa9 | phase2 normal Mail/Store/batch fixture |
| 025471826c7b1eeae346d6940e613422bf6d00a2 | CLI direct spawn 제거와 bounded Git 관측 |
| 3c8fb50813d5269f28d94ec3b4b5c8eadbc886f0 | 새 회귀의 기존 lane 편입 |
| 943aac7ed2b808a8fa29b0dbfee0bc3c1a05615c | package inventory 명령과 stale precheck |

이 문서 이후의 문서 commit은 이 표에 자기 hash를 예측해 넣지 않는다. 모든 DONE 계열 marker는 작업 재개 위치이며 runtime 또는 원본 41개 카드의 완전한 적합성 인증이 아니다.
