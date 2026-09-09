# 구현 계약 산출물 및 runtime 검증 기록

최초 작성일: 2026-09-07. 마지막 runtime audit: 2026-09-10, HEAD `326a1d6`.

이 문서는 설계 문서의 구현 상태를 기록한다. `architecture.md`와 `implementation-spec.md`는 normative baseline이며, 이 파일의 PASS는 해당 요구 전체가 production release 조건을 충족했다는 뜻이 아니다. OPEN SPIKE와 미실행 test는 PASS로 승격하지 않는다.

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

| 검사 | 실제 수행 결과 | 한계 |
|---|---|---|
| architecture hash | `2a2e74c1e6b4986145a7ac54b37a9f50c297363a9c134a360f75bbba3db4a404` 유지 | 현재 runtime은 이 baseline을 구현하며, 후속 설계 확장은 별도 문서에서 승인 전까지 활성화하지 않음 |
| TypeScript declarations | TypeScript 5.9.3, ES2022, nodenext, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes, noEmit 통과 | 구현 및 runtime schema validator 아님; 배포 Pi/Node version 선택 아님 |
| 두 정합성 수정의 타입 회귀 검사 | [contracts.type-test.ts](tests/contracts.type-test.ts)를 같은 strict 옵션으로 검사 통과; mutation key 필수·read/wait key 금지·create authority 입력 금지·resolved spec 변수의 wire 전달 거절 확인 | compile-only 검사; runtime validator 구현을 뜻하지 않음 |
| mutation 집합 대조 | SQL operations.kind 11개와 TypeScript MutationMethod 집합 일치; public method 분류 누락/중복 없음 | 새 method 추가 때 재검사 필요 |
| 초기 SQL | 임시 SQLite 3.53.4 DB에서 적용, 정확히 여섯 table, user_version=1, FK/integrity 통과 | production binding·WAL power loss 검증 아님 |
| SQL negative check | materialized/batch 없이 presented 설정 시 제약 거절 | 전체 acceptance test 구현·통과를 뜻하지 않음 |
| systemd templates | 임시 renderer 결과 7개를 systemd-analyze verify로 문법/의존성 검사 통과 | ExecStart 실행 파일은 검사본에서 true로 대체; 설치·시작하지 않음 |
| 문서 구조 | local links, code fences, 본문 requirement ID 중복 검사 통과 | 설계의 runtime correctness 증명 아님 |
| bwrap CLI | 로컬 --help에서 argv primitive 및 --size 지원 확인 | 실제 namespace isolation/Principal tools 검증 아님 |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** `node scripts/loc.mjs`의 기존 출력은 non-empty physical line legacy count다. 주석을 제외한 새 LOC 정책과 혼동하지 않는다. 주석·공백 제외 code-only audit은 `cloc 2.08` + OMA systemd language definition으로 별도 계산하며 두 수치를 모두 기록한다.

## Phase 0-9 구현 중 실행된 검증 기록 (2026-09-07)

| 검사 | 실제 수행 결과 |
|---|---|
| 기준 hash | `2a2e74c1e6b4986145a7ac54b37a9f50c297363a9c134a360f75bbba3db4a404` 유지 (N-001) |
| 타입 검사 | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noEmit 통과; `tsc -p tsconfig.build.json` 전체 83개 테스트 빌드 통과 |
| 전체 테스트 | `npm test` → **83/83 pass, 0 fail, 0 skipped** (실 systemd 검사는 user-manager 경합 방지를 위해 file concurrency 1) |
| DDL | 정확히 6개 테이블; user_version=1; FK/integrity ok; negative CHECK (presented w/o materialized+batch) 거절 |
| process-kill | T18-T22 mail 경계를 외부 kill harness(SIGKILL)로 실제 실행 후 외부 가시 상태(파일 hash/DB rows) 대조 |
| systemd 실서비스 | T36 start-limit(자동 reset 없음), T37 stop 중 mail 도착(cgroup 후손 0), T38 cgroup 미확인 시 RUN_TERMINATION_UNKNOWN, REC-007 broker lock |
| sandbox E2E | bwrap(SB-001 rootfs + 시스템 오버레이) → sandboxed Pi 0.85.1 → 신뢰 확장 로드 → custom message role='custom' 전달; provider 없음 → stopReason=error → batch 미완료(위조 증거 없음) |
| git 실저장소 | bundle quarantine(RO alternate)+수입+published ref+peer exact fetch, CAS 경쟁/보호 경로/재개, context commit+CAS+스냅샷 (git 2.55.0) |
| NEG 스캔 | Board/Artifact/Focus/Change/Review 엔티티, task queue/outbox/event bus/workflow, 자동 복구/요약 에이전트 → src/ 전역 검색 0건 |
| LOC | 9,900 (non-empty physical lines from `node scripts/loc.mjs`; A-008 target is 8,000). The documented A-009 allowance applies; 10,000-line review gate is not crossed. |
| release gate | **미달** — S-01–S-06 및 S-09는 raw spike evidence 전까지 OPEN; S-03-dependent Pi completion은 fail-closed이며 미실행 항목은 PASS로 계산하지 않음 |

## Normative test coverage map (T01–T77) — runtime audit 2026-09-08

결과 구분: ✅ 실행(해당 executable test가 suite에서 통과) / ◐ 부분(핵심 일부만, 나머지 미실행) / ❌ 미실행(unresolved/blocker). suite 명령: `npm test` (`83/83`).

| T# | 상태 | 증명 executable test | 비고 |
|---|---|---|---|
| T01 | ✅ | phase-0 기재(hash/import/schema inventory) + production-manifest/loc.mjs | NEG 스캔은 T74 |
| T02 | ✅ | phase2 "T02: fresh DDL…" | |
| T03 | ✅ | phase2 "T03: invalid enum…" | |
| T04 | ✅ | phase2 "T04: frame reconstruction…" + audit A1/A3 | |
| T05 | ✅ | phase2 "T05: malicious frames…" + audit B1(UNKNOWN_METHOD framed) | |
| T06 | ✅ | audit A4(decoder) + audit2 실 socket exact/short/EOF/N+1/N+2/N+3/excess-garbage/hash-mismatch/timeout/coalesced/split | 모든 stream failure는 STREAM_INVALID preaccept; mutation 미성공 |
| T05 | ✅ | phase2 + audit B1 + audit2 neg-* (unknown field/OID/version/read-request) | |
| T73 | ✅ | cli.test (실 systemd 유닛 + 실 socket) | + P1-4/5/6: submit/context frozen-first, agent create --from HEAD, submit --to 다중/기본 |
| T07 | ✅ | phase2 + audit2 real actor-socket git/mail same-key same-payload (serial + concurrent) | same operation/receipt, delivery 1 |
| T08 | ✅ | phase2 + audit2 real actor-socket mail/git same-key different body/recipient/candidate (serial + concurrent mail race) | REQUEST_KEY_REUSED; winner delivery 1 |
| T09 | ◐ | cli 시나리오 6+7(dead socket → operation.get miss → replay) | "accepted 뒤 response kill" 정확 재현 아님 |
| T10 | ✅ | phase2 "T10: different keys…" | |
| T11 | ✅ | phase5 "T11-neg…" | |
| T12 | ❌ | — | old-incarnation socket 재연결 거절 테스트 없음 |
| T13 | ✅ | phase4 "T13: capability escape…" | |
| T14–T22 | ✅ | phase3 (T18–T22 외부 kill harness) | TEST-004 kill 지점 실행됨 |
| T23 | ❌ | — | cross-FS/hardlink fixture 미실행 |
| T24 | ❌ | — | forged approval/ack 테스트 없음 |
| T25 | ◐ | phase5 "T25 deterministic core…" + manifest compatibility | 40개 두 class의 cap/fairness/notice와 frozen manifest는 실행; full-index/original-byte oracle은 미실행 |
| T26 | ✅ | phase5 T25 test의 prepare 뒤 late-mail 재prepare | 기존 prepared IDs 불변 |
| T27 | ❌ | — | batch prepare/cur kill 지점 미실행 |
| T28 | ❌ | — | Pi steer 귀속은 S-03 gate |
| T29–T30 | ◐ | phase5 "deliver smoke" (provider error → complete 미발생, presented 0) | T30 kill 지점 미실행 |
| T31 | ✅ | phase5 "T31-neg…" | |
| T32 | ✅ | phase3 "T32: path-based views…" | |
| T33–T35 | ❌ | — | path enable/timer 재발견/slot 대기 미실행 |
| T36–T38 | ✅ | phase4 (실 systemd user) | |
| T39 | ◐ | phase4 "T39/LIFE-007…" | same-spec 수렴은 실행; 각 durable 경계 process-kill 미실행 |
| T40 | ✅ | phase4 "T40/LIFE-001…" + CREATE-003 policy recheck | changed resolved spec은 AGENT_CONFLICT, 기존 workspace 보존 |
| T41 | ◐ | phase4 "T41/CTX-006…" + dynamic Resident fenced runner | pre-GOAL 무활성/GOAL 후 runner.open은 실행; reboot/provider-call oracle 일부 미실행 |
| T42 | ✅ | phase5 "T42…" | |
| T43–T44 | ❌ | — | S-02 gate (격리 Human session 없음) |
| T45–T47 | ◐ | phase5 "deliver smoke" (sandboxed Pi 로드, host home 미노출 일부) | sandbox escape 항목 다수 미실행 |
| T48–T51 | ✅ | phase6 (mock provider; T50/T51 settle/unknown) | 실제 provider codec은 S-04 gate |
| T52 | ❌ | — | sentinel secret 로그 누출 검사 없음 |
| T53–T55 | ✅ | phase7 | |
| T56 | ◐ | S-05 namespace run + phase7 GIT-006 extra-ref rejection and T55/T59 ref conflict | malformed/pack-corrupt bundle and full hostile prerequisite corpus remain unexecuted |
| T57–T58 | ❌ | — | TEST-004 git kill 지점 미실행 |
| T59 | ✅ | phase7 T55/T59 + phase8 T68b | |
| T60–T61 | ✅ | phase7 | |
| T62 | ◐ | phase7 T62 policy-reread race + malformed-policy + resource-boundary tests; phase5 descendant-timeout/sandbox negatives | policy change during actual candidate execution and quota-backed workspace/staging enforcement remain SPIKE_UNRESOLVED |
| T63–T64 | ◐ | phase7 `INT-003` stop-before-CAS + phase8 reconcile fixtures | SIGKILL during candidate/CAS and full REF_STATE_UNKNOWN recovery harness remain unexecuted |
| T65/T67 | ✅ | phase7 | |
| T66 | ◐ | phase7 `CTX-004: pending context publication after CAS is completed by reconcile` | crash-equivalent mail failure recovery; actual SIGKILL/전원장애 지점은 미실행 |
| T68 | ✅ | phase8 T68a/b/c + audit D1/D2 (READY ordering) | |
| T69 | ◐ | audit D2(손상 상태 → exit 1/STORE_CORRUPT), phase8 T68c(fsck) | hash 손상/빈 DB 재초기화 미실행 |
| T70 | ❌ | — | ENOSPC 주입은 S-06 gate |
| T71 | ❌ | — | backup restore 미실행 |
| T72 | ❌ | — | S-06 gate (VM 부재) |
| T73 | ✅ | cli.test (실 systemd 유닛 + 실 socket CLI acceptance) | 본 audit에서 신규 실행 |
| T74 | ✅ | phase9 NEG 스캔 + loc.mjs | |
| T75/T76 | — | default core 비활성(notmuch/approval false) | optional 활성 시 필수 |
| T77 | ❌ | — | S-09 gate (평가 corpus 없음) |

unresolved 요약: T12,T23,T24,T27,T28,T33–T35,T39,T41,T43,T44,T46,T47,T52,T57,T58,T62–T64,T66,T70–T72,T77은 환경 또는 실제 kill/corpus harness가 남아 있다. T66은 crash-equivalent recovery만 실행했다. TEST-004 kill 지점(T27/T30/T39/T57/T58/T63/T66)은 실제 process/power-cut harness 전까지 PASS로 계산하지 않는다.

## 2nd runtime-correctness audit (2026-09-08) — P0-1/2/3 + P1-4..9

실 socket E2E(test/audit2.test.ts, cgroup-authenticated actor 채널)로 확정·수정:
- **P0-1** IPC-002 per-connection 직렬화: `serveFrames`가 이전 handle()이 settle되기 전에 resumeParsing으로 다음 요청을 dispatch하던 것 수정 → connection-local FIFO 유닛 큐(이전 요청 완료 후에만 다음 dispatch). `serialize`/`stream-then-next` 시나리오가 slow first 요청 뒤 fast 요청이 늦게 응답함을 증명.
- **P0-2** exact raw stream 길이/초과: decoder가 descriptor.bytes만 소비하고 초과를 queue에 남겨 mutation 성공 후 재해석 → `excessStatus()` 추가, stream 완료 시 excess면 STREAM_INVALID pre-dispatch(테스트: excess-garbage는 STREAM_INVALID + op 미생성).
- **P0-3** audit A5는 decoder byte 보존 테스트(규범적)로 유지; 브로커는 serialized dispatch로 다음 요청을 이전 완료 후에만 처리.
- **P1-4** CLI `--request` frozen-first: submit/context가 복구 시 HEAD/파일을 재해석 → `effect()`(frozen params + persisted body 사용), 직접 비교 가능한 명시 인자 충돌만 REQUEST_KEY_REUSED. stream 바이트는 `<key>.body`로 영속.
- **P1-5** `agent create --from HEAD`: 로컬 git rev를 전체 OID로 resolve 후 freeze, 전체 OID만 전송. HEAD 이동 후 복구는 frozen OID 유지.
- **P1-6** `submit --to`: positional 파서에서 `--to` 누락 버그 → multiOpt, `--to a --to b` 및 기본 commons 테스트.
- **P1-7** `status <agent>`: checkParams가 agent를 버리던 것 + dispatch `undefined` 하드코딩 수정 → 요청한 Resident만 반환(a/b 서로 다름 테스트).
- **P1-8** closed runtime schemas: status.get/git.known/git.submit/git.integrate/context.publish/logs.read unknown-field·OID·safe-int·nested entries 검증 + envelope `v===1`(UNSUPPORTED_VERSION) + read/ephemeral top-level `request` 금지. audit2 neg-* 테스트.
- **P1-9** FrameParser의 substring `NaN`/`Infinity` 거절 제거 → 문자열 값 허용, invalid numeric literal은 JSON.parse로 거절(phase2 P1-9 테스트).

## 3rd consolidation/correctness pass (2026-09-08) — P0-A..D + durability

실행·수정·검증:
- **P0-A AUTH**: `src/authority.ts`가 persisted `agents.spec_json`의 닫힌 resolved spec만 수용하고 unknown/malformed capability는 empty set으로 fail-closed; actor entrypoint와 runner auth가 이 단일 근거를 사용한다. `authority.test.ts`, CREATE-002, AUTH-002 및 real actor-socket capability gate 통과.
- **P0-B INT/GIT**: HostConfig integration policy is broker-owned and authoritative policy is reread immediately before CAS; malformed/unreadable/race fails `POLICY_CHANGED`. Main-writer intent is durably recorded before candidate checks, stop/capability rechecked before CAS, and pending integrate operations recover as success/unknown/fail. Git child environments use fixed HOME/PATH/config/hooks; bundle import runs in a private unshare namespace with bounded CPU/address-space/PID/tmp limits and RO canonical objects. Candidate-check workspace/staging quota and fixed worker boundary remain `SPIKE_UNRESOLVED` (no transient `systemd-run`, per UNIT-001).
- **P0-C IPC/DB**: broker/store canonical request hash 및 DB unique winner를 유지하고 real actor socket에서 git/mail same-key same/different payload, concurrent same-key races, delivery 단일성을 확인했다.
- **P0-D STREAM**: N+1/N+2/N+3, malformed excess, short EOF, hash mismatch, idle timeout 및 accepted key의 bad-stream retry를 real Unix socket에서 확인했다. 모두 preaccept `STREAM_INVALID`이며 operation이 없다.
- **FS-003/IPC-008**: RequestCache가 unknown field/digest/receipt/key를 reject하고 file fsync → rename → parent-directory fsync를 수행한다. body bytes와 0600 mode round-trip test를 추가했다.
- **CTX-003/004**: context commit이 expected revision을 parent로 기록하고 candidate를 CAS 전에 plan에 영속화한다. CAS 후 snapshot/current/mail 단계가 중단돼도 `GitModule.reconcile`/`ReconcileModule`이 ref==candidate를 보충하고, 제3 ref는 unknown으로 유지한다. crash-equivalent CTX-004 회귀 테스트 통과.

현재 runtime suite는 `npm test` **83/83 pass, 0 fail, 0 skipped**다. S-01–S-06/S-09 release gate는 raw evidence 전까지 OPEN이며 coverage의 미실행 항목은 PASS로 계산하지 않는다.

production LOC: 8,299 baseline → **9,900** current (`node scripts/loc.mjs`). The 8,001–10,000 allowance is used for the executable IPC, lifecycle, batch, recovery, quarantine, and validation contracts; no new durable entity/service/framework was added. The 10,001-line architecture-review gate is not crossed.

### A-009 production LOC breakdown (2026-09-08)
`node scripts/loc.mjs` output (non-empty physical lines): git 1,564; broker 1,166; mail 980; store 851; lifecycle 829; cli 749; config 460; inference 402; frame 293; contracts 283; validate 270; units 235; sandbox 199; entry/broker 184; leaf 159; views 159; reconcile 149; request-cache 147; runner 118; hash 114; schema-v1.sql 108; ids 83; entry/host 81; pi-extension 59; rpc-client 59; entry/runner 58; authority 49; systemd templates 92; **total 9,900**.

## Phase 10 runtime audit — 2026-09-10, HEAD `326a1d6`

실행 명령:

```text
npm test
node scripts/loc.mjs
git status --short
```

결과:

| 항목 | 결과 | 해석 |
|---|---|---|
| TypeScript build | 통과 | `tsc -p tsconfig.build.json` |
| runtime test suite | **83 passed, 0 failed, 0 skipped** | Node test concurrency=1; 실제 systemd/user socket/sandbox를 포함한 현재 suite |
| lifecycle/batch closure | 통과한 범위 확인 | dynamic Resident runner open, same-name create convergence/conflict, GOAL gate, singleton broker lock, stop/start/reconcile, deterministic batch notice가 실행됨 |
| candidate checks | 부분 통과 | candidate descendant termination과 fail-closed resource-boundary test가 있음; workspace/staging quota와 고정 worker primitive는 여전히 `SPIKE_UNRESOLVED` |
| Pi delivery | 부분 통과 | sandboxed Pi 0.85.1에서 trusted extension/custom message가 동작; provider 없음 상태에서 boundary evidence가 생성되지 않음 |
| Git/context recovery | 통과한 범위 확인 | bundle quarantine, published ref, CAS race, policy reread, context CAS/reconcile가 실행됨 |
| release gate | **미달** | S-01~S-06/S-09 raw evidence 및 남은 coverage가 해결되지 않음 |

이번 commit에서 문서와 직접 연결되는 구현 변경은 `src/lifecycle.ts`, `src/runner.ts`, `src/reconcile.ts`, `src/broker.ts`, `src/units.ts`, `src/mail.ts`, `src/store.ts`, 관련 entrypoint와 테스트다. 이 기록은 변경을 새 durable entity/service로 해석하지 않는다.

### Current LOC audit

현재 저장소의 `node scripts/loc.mjs` 결과는 **9,900**이다. 이 스크립트는 기존 baseline과의 비교를 위해 non-empty physical lines를 센다.

공백과 comment-only line을 제외한 code-only audit은 cloc 2.08 및 OMA systemd filter로 **9,407 code lines / 493 comment lines / 533 blank lines / 34 source files**였다. 두 수치는 같은 예산 정책을 서로 다르게 계산한 결과이므로 섞지 않는다. 8,000 목표와 10,000 초과 architecture review gate에 대한 release 판단은 normative LOC policy가 고정된 뒤 한 가지 계산기를 canonical로 선택해야 한다.

### 현재 남은 release blockers

- S-03: Pi session flush와 trusted boundary evidence가 고정되기 전 `batch.complete`는 presented를 확정할 수 없다.
- S-04: 실제 provider codec/usage upper bound은 mock inference test만으로 닫히지 않는다.
- S-06: 전원 장애, ENOSPC, backup/restore는 실행되지 않았다.
- candidate check: workspace/staging quota와 fixed worker resource primitive가 확정되지 않았다. transient `systemd-run`을 추가하지 않는다.
- test coverage: T12, T23, T24, T27, T28, T33–T35, T39, T41, T43–T44, T46–T47, T52, T57–T58, T62–T64, T66, T70–T72, T77은 완전한 acceptance evidence가 없다.
- S-09: Principal+society의 품질·비용·토큰 benchmark가 없다.
