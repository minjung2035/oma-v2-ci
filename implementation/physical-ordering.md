# Production physical effect ordering

**MUST [SEQ-001]** 아래 표는 기존 규범의 실행 순서를 고정한다. 내부 함수 분리는 허용하지만 새로운 service/state/IPC phase를 추가하지 않는다.

**MUST [SEQ-002]** 이 문서는 REC/LIFE/UNIT/BATCH/INT 요구의 canonical 호출 순서다. 하나의 단계가 실패했을 때 다음 단계로 진행하지 않는다. DB rollback이 이미 발생한 filesystem/systemd/Git 효과까지 취소한다고 가정하지 않는다. 공통 helper를 거쳐도 production entrypoint에서 이 순서가 실행된다는 증거가 필요하다.

| 경로 / production owner | MUST 순서 | MUST 실패·완료 경계 |
|---|---|---|
| broker entry → broker.ts / reconcile.ts | 안전한 runtime dir/lock file 준비 → lifetime OS lock 획득 → config 검증 → D04의 bounded recovery resource preflight → DB open/migration → old run fence/death 확인 → pending physical reconciliation → authenticated endpoint 준비 → READY=1 | lock loser는 DB open/migrate/reconcile/unit effect/READY 금지. 논리 quota 초과는 새 admission을 막되 기존 책임의 bounded recovery를 일괄 금지하지 않는다. 실제 공간 부족은 성공이 아니며 accepted evidence를 보존한다. startup reserve/효과별 admission은 WP22 gate, 소켓 존재는 READY 증거가 아님 |
| actor socket → broker create handler | auth/strict DTO/key 조회 → durable 부모에서 host 정책으로 resolved spec 계산 → T-create-intent → frozen OID clone/verify → workspace rename/fsync → mailbox/runner/unit render → daemon-reload 결과 확인 → unit LoadState/config 검증 → T-create-ready → initial mail materialize → GOAL 확인 → 필요 시 path enable/start/관측 → receipt | initialResidents에서 child를 찾지 않음. clone에서 branch를 재해석하지 않음. provisioning은 READY 아님 |
| actor socket → broker start handler | key/auth/record 조회 → retired/provisioning 거절 → 이미 정상 enabled면 no-op → old cgroup 사망 확인 → GOAL 검증 → desired enabled+op commit → path/service effect → actual 관측 → succeeded | GOAL 없는 실패가 desired/path를 새로 바꾸지 않음. process spawn만으로 성공하지 않음 |
| actor socket → broker stop handler | key/auth → T-stop-intent → path stop/disable 및 관측 → endpoint/inference revoke → service stop → descendants 사망 확인 → pending broker-owned effects 목록 → succeeded | unit effect 실패해도 desired=stopped의 inference 거절은 즉시 유효. catch에서 나머지 revoke/stop 안전 조치를 건너뛰지 않음. 사망 불명확이면 unknown |
| runner → runner.open | unit/cgroup invocation 인증 → durable RuntimeAgentRecord 조회 → desired/GOAL 검사 → 이전 run 사망 → D01 exact old receipt 관측 및 T-batch-complete → incarnation 및 receipt-absent prepared ownership transaction → 제한 endpoint → frozen spec 기반 sandbox/Pi | receipt IO는 T 밖, exact batch/state 재검사는 T 안. unreadable/conflict는 rollover/재전달 금지. completed incarnation 유지, seed/default fallback 금지. endpoint 준비 실패를 live run으로 반환하지 않음 |
| trusted batch.prepare → mail.ts | owner/incarnation 검사 → T-batch-prepare snapshot/연결 commit → new→cur/fsync → inbox view atomic publish → PreparedBatch 응답 | DB commit만 끝났는데 PreparedBatch 성공 응답 금지. post-transaction 실패면 prepared 상태를 남겨 같은 prepare로 복구; batch.stage 없음 |
| trusted batch.complete → mail.ts | auth/fencing → pinned adapter revision/path 확인 → trusted durable receipt 검증 → T-batch-complete/presented commit → completed:true | DTO field·file existence·agent_end boolean은 증거 아님. receipt 불일치·위조는 commit 없이 `SESSION_BOUNDARY_UNCONFIRMED` 또는 `BATCH_CONFLICT` |
| git.integrate → git.ts / sandbox.ts | identity/auth/profile 지원 gate → 조건 검사 → pending intent → exact candidate/check-profile snapshot으로 kernel-bounded 검사 → 실제 종료 결과 → final policy/base/authority 재검사 → CAS → ref 대조 → base receipt 또는 tiered fixed mail 보충 → succeeded | resource primitive 미검증인데 nonempty checks 실행 금지. checks를 []로 대체 금지. test timeout/signal/관측 불명확을 PASS로 변환 금지 |

**MUST [SEQ-003]** lock 전 허용 작업은 argv/path 문법 검사와 lock 획득에 필요한 trusted runtime directory mkdir/open뿐이다. state root 초기화, SQLite constructor/open, migration, Git/systemd effect, reconciliation을 import/constructor의 side effect로 실행하지 않는다. DB 연결 factory는 lock 획득 이후에만 호출한다. 동시 두 broker 시험에서 loser가 DB-open seam에 도달하지 않았음을 검증한다.

**MUST [SEQ-004]** create-ready는 생성 가능한 물리 자원이 준비됐다는 뜻이다. 최초 GOAL 전에는 ready/stopped 또는 enabled-with-GOAL-gate 상태에서 inference 없이 준비될 수 있다. 단, 실패한 explicit start에서 desired를 enabled로 바꾸지는 않는다. bootstrap 복구·일반 start의 성공 의미를 혼동하지 않는다. 위 표가 기존 절과 불일치하면 두 문서를 함께 정정하고 제3의 순서를 코드에 만들지 않는다.

## Current owner lookup — 비규범적 안내

이 문서는 ordering만 소유한다. 현재 구현 owner/call path를 여기 표로 복제하지 않는다.

- requirement/source owner: [source-owners.json](source-owners.json)
- durable mutation별 owner/change surface: [mutation-owners.json](mutation-owners.json)
- current 실행 상태: [validation.md](validation.md)

Owner가 이동해도 위 SEQ 규범의 의미가 자동으로 바뀌는 것은 아니다. Ordering 변경이 필요하면 architecture/spec과 이 문서를 함께 검토한다.
