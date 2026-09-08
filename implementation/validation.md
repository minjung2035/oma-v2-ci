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
| 타입 검사 | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noEmit 통과; `tsc -p tsconfig.build.json` 전체 49개 테스트 빌드 통과 |
| 전체 테스트 | `node --test dist/test/*.test.js` → **49/49 pass, 0 fail** (phase2-8) |
| DDL | 정확히 6개 테이블; user_version=1; FK/integrity ok; negative CHECK (presented w/o materialized+batch) 거절 |
| process-kill | T18-T22 mail 경계를 외부 kill harness(SIGKILL)로 실제 실행 후 외부 가시 상태(파일 hash/DB rows) 대조 |
| systemd 실서비스 | T36 start-limit(자동 reset 없음), T37 stop 중 mail 도착(cgroup 후손 0), T38 cgroup 미확인 시 RUN_TERMINATION_UNKNOWN, REC-007 broker lock |
| sandbox E2E | bwrap(SB-001 rootfs + 시스템 오버레이) → sandboxed Pi 0.85.1 → 신뢰 확장 로드 → custom message role='custom' 전달; provider 없음 → stopReason=error → batch 미완료(위조 증거 없음) |
| git 실저장소 | bundle quarantine(RO alternate)+수입+published ref+peer exact fetch, CAS 경쟁/보호 경로/재개, context commit+CAS+스냅샷 (git 2.55.0) |
| NEG 스캔 | Board/Artifact/Focus/Change/Review 엔티티, task queue/outbox/event bus/workflow, 자동 복구/요약 에이전트 → src/ 전역 검색 0건 |
| LOC | 6,393 (비어 있지 않은 물리 줄; A-008 목표 8,000 이하) |
| release gate | **미달** — S-02(격리 Human session 없음), S-04(provider credential 없음), S-06(VM/전원장애 환경 없음) OPEN; 해당 경로는 fail-closed(SPIKE_UNRESOLVED) 또는 청구되지 않음 |

## Normative test coverage map (T01–T77) — runtime audit 2026-09-08

결과 구분: ✅ 실행(해당 executable test가 suite에서 통과) / ◐ 부분(핵심 일부만, 나머지 미실행) / ❌ 미실행(unresolved/blocker). suite 명령: `node --test dist/test/*.test.js` (60/60).

| T# | 상태 | 증명 executable test | 비고 |
|---|---|---|---|
| T01 | ✅ | phase-0 기재(hash/import/schema inventory) + production-manifest/loc.mjs | NEG 스캔은 T74 |
| T02 | ✅ | phase2 "T02: fresh DDL…" | |
| T03 | ✅ | phase2 "T03: invalid enum…" | |
| T04 | ✅ | phase2 "T04: frame reconstruction…" + audit A1/A3 | |
| T05 | ✅ | phase2 "T05: malicious frames…" + audit B1(UNKNOWN_METHOD framed) | |
| T06 | ◐ | audit A4(short/excess), cli 시나리오 7(recovery) | broker socket의 submit hash-mismatch preaccept 미단독 검증 |
| T07 | ✅ | phase2 "T07: same actor/key/payload…" | |
| T08 | ✅ | phase2 "T08: REQUEST_KEY_REUSED" + cli 시나리오 3(exit 2) | |
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
| T62 | ❌ | — | check 중 policy 변경 재검사 없음(check 경로 비활성) |
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
