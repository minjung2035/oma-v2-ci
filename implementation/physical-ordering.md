# Production physical effect ordering

**MUST [SEQ-001]** 아래 표는 기존 규범의 실행 순서를 고정한다. 내부 함수 분리는 허용하지만 새로운 service/state/IPC phase를 추가하지 않는다.

**MUST [SEQ-002]** 이 문서는 REC/LIFE/UNIT/BATCH/INT 요구의 canonical 호출 순서다. 하나의 단계가 실패했을 때 다음 단계로 진행하지 않는다. DB rollback이 이미 발생한 filesystem/systemd/Git 효과까지 취소한다고 가정하지 않는다. 공통 helper를 거쳐도 production entrypoint에서 이 순서가 실행된다는 증거가 필요하다.

| 경로 / production owner | MUST 순서 | MUST 실패·완료 경계 |
|---|---|---|
| broker entry → broker.ts / reconcile.ts | 안전한 runtime dir/lock file 준비 → lifetime OS lock 획득 → config 검증 → DB open/migration → old run fence/death 확인 → pending physical reconciliation → authenticated endpoint 준비 → READY=1 | lock loser는 DB open/migrate/reconcile/unit effect/READY 금지. 소켓 존재가 READY 증거 아님 |
| actor socket → broker create handler | auth/strict DTO/key 조회 → durable 부모에서 host 정책으로 resolved spec 계산 → T-create-intent → frozen OID clone/verify → workspace rename/fsync → mailbox/runner/unit render → daemon-reload 결과 확인 → unit LoadState/config 검증 → T-create-ready → initial mail materialize → GOAL 확인 → 필요 시 path enable/start/관측 → receipt | initialResidents에서 child를 찾지 않음. clone에서 branch를 재해석하지 않음. provisioning은 READY 아님 |
| actor socket → broker start handler | key/auth/record 조회 → retired/provisioning 거절 → 이미 정상 enabled면 no-op → old cgroup 사망 확인 → GOAL 검증 → desired enabled+op commit → path/service effect → actual 관측 → succeeded | GOAL 없는 실패가 desired/path를 새로 바꾸지 않음. process spawn만으로 성공하지 않음 |
| actor socket → broker stop handler | key/auth → T-stop-intent → path stop/disable 및 관측 → endpoint/inference revoke → service stop → descendants 사망 확인 → pending broker-owned effects 목록 → succeeded | unit effect 실패해도 desired=stopped의 inference 거절은 즉시 유효. catch에서 나머지 revoke/stop 안전 조치를 건너뛰지 않음. 사망 불명확이면 unknown |
| runner → runner.open | unit/cgroup invocation 인증 → durable RuntimeAgentRecord 조회 → desired/GOAL 검사 → 이전 run 사망 → incarnation+recoverable ownership transaction → 제한 endpoint → frozen spec 기반 sandbox/Pi | seed 목록·기본 profile fallback 금지. 이름과 DB row 불일치면 중단 |
| trusted batch.prepare → mail.ts | owner/incarnation 검사 → T-batch-prepare snapshot/연결 commit → new→cur/fsync → inbox view atomic publish → PreparedBatch 응답 | DB commit만 끝났는데 PreparedBatch 성공 응답 금지. post-transaction 실패면 prepared 상태를 남겨 같은 prepare로 복구; batch.stage 없음 |
| trusted batch.complete → mail.ts | auth/fencing → pinned S-03 gate 확인 → adapter의 trusted receipt 검증 → T-batch-complete/presented commit → completed:true | DTO field·file existence·agent_end boolean은 증거 아님. OPEN gate는 SPIKE_UNRESOLVED, flag 변화 0 |
| git.integrate → git.ts / sandbox.ts | identity/auth/profile 지원 gate → 조건 검사 → pending intent → exact candidate/check-profile snapshot으로 kernel-bounded 검사 → 실제 종료 결과 → final policy/base/authority 재검사 → CAS → ref 대조 → base receipt 또는 tiered fixed mail 보충 → succeeded | resource primitive 미검증인데 nonempty checks 실행 금지. checks를 []로 대체 금지. test timeout/signal/관측 불명확을 PASS로 변환 금지 |

**MUST [SEQ-003]** lock 전 허용 작업은 argv/path 문법 검사와 lock 획득에 필요한 trusted runtime directory mkdir/open뿐이다. state root 초기화, SQLite constructor/open, migration, Git/systemd effect, reconciliation을 import/constructor의 side effect로 실행하지 않는다. DB 연결 factory는 lock 획득 이후에만 호출한다. 동시 두 broker 시험에서 loser가 DB-open seam에 도달하지 않았음을 검증한다.

**MUST [SEQ-004]** create-ready는 생성 가능한 물리 자원이 준비됐다는 뜻이다. 최초 GOAL 전에는 ready/stopped 또는 enabled-with-GOAL-gate 상태에서 inference 없이 준비될 수 있다. 단, 실패한 explicit start에서 desired를 enabled로 바꾸지는 않는다. bootstrap 복구·일반 start의 성공 의미를 혼동하지 않는다. 위 표가 기존 절과 불일치하면 두 문서를 함께 정정하고 제3의 순서를 코드에 만들지 않는다.

## R37–R39 현재 source binding — 비규범적 구현 기록

위 순서를 바꾸거나 새 phase를 추가한 표가 아니다. 현재 경로와 미검증 범위는 [refactoring-closure.md](refactoring-closure.md)에 상세히 기록했다. 아래 연결과 관련 시험은 정적으로 검토했으며 **실행 NOT_RUN**이다.

| 기존 경계 | 현재 source owner | `await` 뒤 재검사와 최종 구간 |
|---|---|---|
| lock/startup/READY/shutdown | `src/entry/broker.ts` → `src/runtime/broker-lifetime.ts` → `src/reconcile.ts` | async fsck 뒤 old run death를 재확인. READY 전 복구 순서 유지. shutdown은 logical task와 native preparation barrier를 모두 확인하기 전 Store/lock 해제 금지 |
| create intent/workspace/ready | `src/lifecycle/create.ts` → `src/lifecycle/workspace.ts` → `src/lifecycle/create-publication.ts` | workspace Promise를 기다린 뒤 operation/plan bytes/spec/incarnation과 current authority를 재조회. 공개·ready 이전 준비 완료 확인 |
| create initial mail/activation | `src/lifecycle/create.ts` → mail gate → `src/units.ts` | mail 대기 뒤 current identity/desired/GOAL/activation 재확인. 최종 검사와 start 사이 새 await 없음 |
| submit 준비/publication | `src/git/submit.ts` → `src/git/quarantine.ts` → `src/git/canonical-command.ts` | facade가 Promise를 유실하지 않음. accepted evidence 유지, final live authority 확인 뒤 canonical publication 관측 |
| integrate final decision/CAS | `src/git/integration.ts` → `src/git/canonical-command.ts` | 최종 policy/base/authority 확인부터 CAS와 ref 재관측까지 동기 구간. preparation worker에는 Store 또는 authority 결정권 없음 |
| context 준비/CAS/알림 | `src/git/context.ts` → `src/git/context-repository.ts` → `src/git/context-publication.ts` | candidate 준비·mail 렌더 대기 뒤 expected/current authority 재확인. accepted candidate를 복구에서 새로 계산하지 않음 |
| unit 관측/사망 판정 | `src/units/execute.ts`, `src/units/observe.ts`, `src/units.ts` | 비동기 show는 facts만 반환. Store incarnation reader와 동기 `confirmDead`를 대체하지 않음 |

process timeout/abort/output cap은 관측 결과이지 physical rollback이 아니다. 불확실한 native preparation은 `src/process/preparation.ts`의 barrier에 남으며, 연결 종료나 response 실패만으로 accepted staging을 지우지 않는다. 실제 cgroup/Pi/kernel 자원 보장 및 power-loss 증명은 기존 SPIKE gate에 남는다.
