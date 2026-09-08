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

## Phase 0-9 구현 중 실행된 검증 기록 (2026-09-07)

| 검사 | 실제 수행 결과 |
|---|---|
| 기준 hash | `2a2e74c1e6b4986145a7ac54b37a9f50c297363a9c134a360f75bbba3db4a404` 유지 (N-001) |
| 타입 검사 | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noEmit 통과; `tsc -p tsconfig.build.json` 전체 68개 테스트 빌드 통과 |
| 전체 테스트 | `npm test` → **68/68 pass, 0 fail, 0 skipped** (phase2-8 + authority + request-cache + actor-socket audit) |
| DDL | 정확히 6개 테이블; user_version=1; FK/integrity ok; negative CHECK (presented w/o materialized+batch) 거절 |
| process-kill | T18-T22 mail 경계를 외부 kill harness(SIGKILL)로 실제 실행 후 외부 가시 상태(파일 hash/DB rows) 대조 |
| systemd 실서비스 | T36 start-limit(자동 reset 없음), T37 stop 중 mail 도착(cgroup 후손 0), T38 cgroup 미확인 시 RUN_TERMINATION_UNKNOWN, REC-007 broker lock |
| sandbox E2E | bwrap(SB-001 rootfs + 시스템 오버레이) → sandboxed Pi 0.85.1 → 신뢰 확장 로드 → custom message role='custom' 전달; provider 없음 → stopReason=error → batch 미완료(위조 증거 없음) |
| git 실저장소 | bundle quarantine(RO alternate)+수입+published ref+peer exact fetch, CAS 경쟁/보호 경로/재개, context commit+CAS+스냅샷 (git 2.55.0) |
| NEG 스캔 | Board/Artifact/Focus/Change/Review 엔티티, task queue/outbox/event bus/workflow, 자동 복구/요약 에이전트 → src/ 전역 검색 0건 |
| LOC | 9,190 (non-empty physical lines from `node scripts/loc.mjs`; A-008 target is 8,000). The 8,001–10,000 allowance requires the documented reason and module breakdown below. |
| release gate | **미달** — S-02(격리 Human session 없음), S-04(provider credential 없음), S-06(VM/전원장애 환경 없음) OPEN; 해당 경로는 fail-closed(SPIKE_UNRESOLVED) 또는 청구되지 않음 |

## Normative test coverage map (T01–T77) — runtime audit 2026-09-08

결과 구분: ✅ 실행(해당 executable test가 suite에서 통과) / ◐ 부분(핵심 일부만, 나머지 미실행) / ❌ 미실행(unresolved/blocker). suite 명령: `npm test` (`68/68`).

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
| T25 | ◐ | phase3 "batch notice caps at 6…" | batch prepare/fairness full 경계 미실행 |
| T26–T27 | ❌ | — | batch snapshot/kill 지점 미실행 |
| T28 | ❌ | — | Pi steer 귀속은 S-03 gate |
| T29–T30 | ◐ | phase5 "deliver smoke" (provider error → complete 미발생, presented 0) | T30 kill 지점 미실행 |
| T31 | ✅ | phase5 "T31-neg…" | |
| T32 | ✅ | phase3 "T32: path-based views…" | |
| T33–T35 | ❌ | — | path enable/timer 재발견/slot 대기 미실행 |
| T36–T38 | ✅ | phase4 (실 systemd user) | |
| T39–T41 | ❌ | — | create durable kill / AGENT_CONFLICT / GOAL gate 미실행(T41 일부: deliver smoke no-provider) |
| T42 | ✅ | phase5 "T42…" | |
| T43–T44 | ❌ | — | S-02 gate (격리 Human session 없음) |
| T45–T47 | ◐ | phase5 "deliver smoke" (sandboxed Pi 로드, host home 미노출 일부) | sandbox escape 항목 다수 미실행 |
| T48–T51 | ✅ | phase6 (mock provider; T50/T51 settle/unknown) | 실제 provider codec은 S-04 gate |
| T52 | ❌ | — | sentinel secret 로그 누출 검사 없음 |
| T53–T55 | ✅ | phase7 | |
| T56 | ◐ | S-05 실험 기록(hostile extra-ref), phase7 T55/T59(ref conflict) | bundle malformed 단독 테스트 미실행 |
| T57–T58 | ❌ | — | TEST-004 git kill 지점 미실행 |
| T59 | ✅ | phase7 T55/T59 + phase8 T68b | |
| T60–T61 | ✅ | phase7 | |
| T62 | ◐ | phase7 T62 policy-reread race + malformed-policy + resource-boundary tests; phase5 descendant-timeout/sandbox negatives | policy change during actual candidate execution and quota-backed workspace/staging enforcement remain SPIKE_UNRESOLVED |
| T63–T64 | ❌ | — | INT kill 지점 미실행 |
| T65/T67 | ✅ | phase7 | |
| T66 | ❌ | — | CTX kill 지점 미실행 |
| T68 | ✅ | phase8 T68a/b/c + audit D1/D2 (READY ordering) | |
| T69 | ◐ | audit D2(손상 상태 → exit 1/STORE_CORRUPT), phase8 T68c(fsck) | hash 손상/빈 DB 재초기화 미실행 |
| T70 | ❌ | — | ENOSPC 주입은 S-06 gate |
| T71 | ❌ | — | backup restore 미실행 |
| T72 | ❌ | — | S-06 gate (VM 부재) |
| T73 | ✅ | cli.test (실 systemd 유닛 + 실 socket CLI acceptance) | 본 audit에서 신규 실행 |
| T74 | ✅ | phase9 NEG 스캔 + loc.mjs | |
| T75/T76 | — | default core 비활성(notmuch/approval false) | optional 활성 시 필수 |
| T77 | ❌ | — | S-09 gate (평가 corpus 없음) |

unresolved 요약: T12,T23,T24,T26–T28,T33–T35,T39–T41,T43,T44,T46,T47,T52,T57,T58,T62–T64,T66,T70–T72,T77 → 환경(격리 Human session, provider credential, 전원장애 VM, evaluation corpus, notmuch/approval 정책) 또는 미구현 테스트 부재. TEST-003/TEST-004에서 요구하는 kill 지점(T27/T30/T39/T57/T58/T63/T66)은 해당 SPIKE(S-03/S-05/S-06) 결과가 확정된 뒤 실행하며, 미실행 항목은 어떤 방식으로도 PASS로 계산하지 않는다.

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
- **P0-B INT**: HostConfig integration policy가 `GitModule`에 조립 주입되고 protected path/policy revision/check profile이 caller wire에서 오지 않는다. CAS 직전 authoritative policy revision을 config reader로 재조회하고 unreadable/malformed/race를 `POLICY_CHANGED`로 fail-closed한다. candidate checks는 실제 systemd transient cgroup에서 memory/tasks/CPU/runtime, bwrap에서 tmp cap을 사용하며 workspace/staging byte quota는 `SPIKE_UNRESOLVED`로 명시한다.
- **P0-C IPC/DB**: broker/store canonical request hash 및 DB unique winner를 유지하고 real actor socket에서 git/mail same-key same/different payload, concurrent same-key races, delivery 단일성을 확인했다.
- **P0-D STREAM**: N+1/N+2/N+3, malformed excess, short EOF, hash mismatch, idle timeout 및 accepted key의 bad-stream retry를 real Unix socket에서 확인했다. 모두 preaccept `STREAM_INVALID`이며 operation이 없다.
- **FS-003/IPC-008**: RequestCache가 unknown field/digest/receipt/key를 reject하고 file fsync → rename → parent-directory fsync를 수행한다. body bytes와 0600 mode round-trip test를 추가했다.

현재 runtime suite는 `npm test` **73/73 pass, 0 fail, 0 skipped**; S-02/S-04/S-06/S-09 release gate는 여전히 OPEN이며 아래 coverage의 미실행 항목은 PASS로 계산하지 않는다.

production LOC: 8,299 baseline → **9,268** current. The 8,001–10,000 allowance is used because the executable contract requires broker-side idempotency, exact stream-boundary and digest enforcement, closed runtime/config validation, host integration policy wiring, durable CLI cache fsync, candidate-check fail-closed sandbox wiring, and the complete CLI command surface; deleting those would weaken IPC/DB/CFG/CLI requirements. No new durable entity/service/framework was added.

### A-009 production LOC breakdown (2026-09-08)
`node scripts/loc.mjs` output (non-empty physical lines): broker 1,251; git 1,246; mail 899; store 833; cli 734; lifecycle 483; config 452; inference 402; frame 293; runner 293; contracts 283; validate 270; units 243; sandbox 199; views 158; request-cache 147; entry/broker 143; hash 114; reconcile 113; schema-v1.sql 108; leaf 106; ids 83; entry/host 81; entry/runner 76; pi-extension 59; rpc-client 59; authority 49; systemd templates 91; **total 9,268**.
