# G03-broker-r2 적대적 검증 결과

2차 독립 감사. 검토 범위: `src/broker.ts`, `src/broker/{composition,connection,internal-dispatcher,logs,peer-authenticator,peer-pin,principal-endpoint,process-ancestry,public-dispatcher,replies,transport-spool}.ts`, `src/entry/broker.ts`, `src/frame.ts`. 규칙: 코드 무수정, build/test 무실행, systemctl/sudo 금지, 산출물은 `review/adversarial-2026-09-28/` 아래에만.

## 1. 커버리지

`wc -l` 값(실측)과, read offset/limit로 마지막까지 읽은 줄 번호·그 줄 앞 20자.

| 파일 | 줄 수(wc -l) | 전부 읽음 | 비고(마지막 읽은 줄 N / 앞 20자) |
|---|---|---|---|
| src/broker.ts | 546 | 예 | 546 / `}` (파일 끝, drainAndClose 닫힘) |
| src/broker/composition.ts | 151 | 예 | 151 / `}` (createInternalDispatchPorts 끝) |
| src/broker/connection.ts | 265 | 예 | 265 / `}` (RpcConnection 끝) |
| src/broker/internal-dispatcher.ts | 244 | 예 | 244 / `}` (InternalDispatcher 끝) |
| src/broker/logs.ts | 22 | 예 | 22 / `}` (readUnitLogs 끝) |
| src/broker/peer-authenticator.ts | 126 | 예 | 126 / `}` (runnerAuth/클래스 끝) |
| src/broker/peer-pin.ts | 44 | 예 | 44 / `}` (maybeClose/클래스 끝) |
| src/broker/principal-endpoint.ts | 404 | 예 | 404 / `}` (PrincipalHostEndpoint 끝) |
| src/broker/process-ancestry.ts | 94 | 예 | 94 / `}` (descendsFrom 끝) |
| src/broker/public-dispatcher.ts | 206 | 예 | 206 / `  return request.request;` 직후 `}` (keyOf 끝) |
| src/broker/replies.ts | 5 | 예 | 5 / `export function okAnswe` (okAnswer 한 줄) |
| src/broker/transport-spool.ts | 111 | 예 | 111 / `}` (dispose/클래스 끝) |
| src/entry/broker.ts | 234 | 예 | 234 / `});` (void main().catch 끝) |
| src/frame.ts | 194 | 예 | 194 / `}` (ConnectionDecoder 끝) |

호출 경로 확인을 위해 그룹 밖에서 읽음: `src/runtime/run-registry.ts`(begin/publish/revoke/settlementQuiescence/pinCgroup), `src/runtime/broker-lifetime.ts`(settleWithin/BrokerLifetime/stopOnHostLoss), `test/fixtures/delivery-receipt.ts`(preparedFixture 조립), `test/connection-bounds.test.ts`·`test/r14-connection-lifecycle.test.ts`(harness 패턴), `PRIORITY-0.md`, `AUDIT-BRIEF.md`.

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G03-broker-r2-01 | Medium | recovery | openRun의 incarnation commit 뒤 `listenActor` 실패 시 incarnation이 lease 없이 durable하게 전진하고 그 invocation은 재개 불가 | confirmed |
| G03-broker-r2-02 | Low | boundary | 효과 커밋 뒤 응답이 frame 한계를 넘으면 FRAME_TOO_LARGE(retry:never)로 답한다 | confirmed |
| G03-broker-r2-03 | Info | authority | Yama ptrace scope 0 host에서 Principal 자손 판정 붕괴(known-limitation) | high |
| G03-broker-r2-04 | Info | structural | cgroup-containment 판정이 peer-authenticator 안에 4회 반복(P0-2 drift 위험) | medium |

High 이상 없음.

## 3. 발견 상세

### G03-broker-r2-01 openRun의 incarnation commit 뒤 endpoint 게시 실패 시 incarnation이 lease 없이 전진하고 재개 불가
- 심각도: Medium
- 분류: recovery
- 위반 규칙: P0-1(현재 권한과 과거 사실 분리 — incarnation은 현재 권한이나, lease 없는 전진이 남음), P0-5(관측 실패를 사실로 승격하지 않음 — 실패한 open이 incarnation 소비로 확정됨)
- 코드 경로: `src/broker.ts:459-475`(`openRun`의 `this.store.transaction(tx => { ... tx.updateAgent({ name: actor, incarnation: next }); })` **커밋 후** `const lease = record.publish(this.listenActor(actor, next))`; `listenActor`가 던지면 `catch`에서 `record.revoke()` 후 rethrow) → 다음 `runner.open`은 `src/broker.ts:439-443`(`if (active?.invocationId === invocationId) { if (!active.lease || ...) throw STALE_RUN }`) → 새 invocation은 `src/runtime/run-registry.ts:141`(`begin`의 `if (previous && !["empty","removed"].includes(previous.population())) throw RUN_TERMINATION_UNKNOWN`).
- 원인: incarnation 전진은 DB transaction으로 커밋되지만, 그 incarnation에 대응하는 run endpoint(actor socket) 게시(`listenActor` → `mkdirSync`/`unlinkSync`/`actorSocketDirectoryAfterAdmission`의 `assertAdmission`)는 transaction **밖**·커밋 **뒤**에 있다. `listenActor`가 실패하면(ENOSPC/EACCES/sun_path 초과/커밋과 게시 사이 corruption 관측으로 인한 `assertAdmission` throw) incarnation은 `next`로 남고 `OwnedRun`은 revoke된다. revoke된 record는 `RunRegistry` map에서 제거되지 않으므로(`run-registry.ts`의 `revoke()`는 phase만 바꿈), 같은 invocationId의 재시도는 `active.lease === null`로 STALE_RUN을 받고, 새 invocation은 이전 record의 cgroup이 아직 populated이면 `RUN_TERMINATION_UNKNOWN`으로 막힌다.
- 영향: 해당 invocation은 broker 재시작 없이 run을 열 수 없다. incarnation N에 대한 lease는 한 번도 live가 아니었으므로 그 N에 묶인 durable receipt는 생기지 않는다(따라서 과거 사실의 의미 훼손은 아님 — Critical 아님). 그러나 "새 관측·명시적 repair"가 아니라 실패 자체가 incarnation을 소비했고, 회복은 이전 runner 프로세스가 죽어 cgroup이 비고 systemd가 새 invocation을 주어야만 가능하다. 즉 운영상 정지(stall)에 가깝고, `absent` receipt 정산(`settlePreviousIncarnation`)이 이미 커밋되었다면 그 정산만 남고 새 run은 열리지 않은 어긋난 상태가 잠시 존재한다.
- 최소 반례: agent incarnation=1, runner가 `runner.open(inv=id)` 호출. incarnation-commit transaction 성공 직후 `listenActor`가 던짐(예: staging/run 디렉터리 mkdir ENOSPC, 또는 actor socket 경로가 sun_path 107바이트 초과). → agent.incarnation=2, lease 없음. 같은 id로 재open → STALE_RUN. 새 invocation id2로 재open → (이전 cgroup이 populated인 동안) RUN_TERMINATION_UNKNOWN.
- 재현 방법: `review/adversarial-2026-09-28/repro/G03-broker-r2/openrun-postcommit.mjs`. `timeout 60 node review/.../openrun-postcommit.mjs`.
  관측:
  ```
  before openRun incarnation = 1
  first openRun threw: simulated post-commit listenActor failure (ENOSPC/EACCES)
  after failed openRun incarnation = 2
  second openRun (same invocationId) threw: run endpoint is revoked, replaced or failed
  third openRun (fresh invocationId) threw: previous invocation cgroup is not proven empty
  final incarnation = 2
  ```
  (`listenActor`를 커밋 직후 던지도록 private method를 감싸 주입. incarnation 전진과 커밋 관측은 실 Store로 확인.)
- 확신도: confirmed(재현됨). 단, 주입은 Reflect로 private `listenActor`를 감싼 것이고, 실전에서 이 지점이 던질 확률(ENOSPC/EACCES/corruption)은 드물다.
- 개선 방향: incarnation commit과 endpoint 게시를 한 원자 경계로 묶거나(게시 준비를 커밋 전에 하고 커밋 뒤에는 실패하지 않는 순수 상태 전환만 남김), 게시 실패 시 incarnation 전진을 되돌리는 보상 경로(같은 invocation이 같은 incarnation을 다시 시도할 수 있도록)를 명시. 어느 쪽이든 "실패한 open이 incarnation을 소비한다"를 없애는 방향. revoke된 record가 registry에 남아 새 invocation까지 막는 부분은 별도로 검토(cgroup empty 확인은 정당하나, lease가 한 번도 없었던 record를 begin 판정의 previous로 삼는 것이 맞는지).

### G03-broker-r2-02 효과 커밋 뒤 응답이 frame 한계를 넘으면 FRAME_TOO_LARGE(retry:never)로 답한다
- 심각도: Low
- 분류: boundary
- 위반 규칙: P0-5(unknown/실패 응답을 terminal never로 승격)
- 코드 경로: `src/broker/connection.ts`의 `dispatch` 성공 분기 — handle()이 resolve된 **뒤** `const frame = encodeFrame(outcome.value); if (frame.length > Math.min(frameBytes,0xffffffff)+4) throw new FrameError("FRAME_TOO_LARGE", ...)` → `fatal(...)`이 오류 frame으로 응답. `fatal`의 errorFrame이 `retry: "never"`(FrameError 경로).
- 원인: 응답 직렬화 크기 검사가 handle 실행(효과 커밋) **이후**다. `public-dispatcher`의 mutation은 `finally`에서 `refreshViews`까지 지나 이미 커밋된 상태.
- 영향: 효과가 커밋됐는데 호출자는 `FRAME_TOO_LARGE retry:never`를 받는다. `retry:never`이므로 well-behaved 호출자는 same-key 재시도를 하지 않아 커밋된 receipt를 same-key 흡수로 발견하지 못한다. 다만 public mutation 응답은 모두 receipt(작음)이고, `logs.read`(boundedLogResponse)·`git.known`(frameBytes에서 break)·`status.get`은 codec이 frameBytes 이하로 이미 제한하므로, 실제 mutation에서 이 경로에 닿기 어렵다. internal `runner.pending`의 `recoverableBatchIds`는 무제한처럼 보이나 prepared batch 수가 실질적으로 제한(batchMaxMessages=24)되어 도달 어려움. 그래서 방어 경로에 가깝고 심각도 Low.
- 최소 반례: 응답 객체가 frameBytes를 초과하는 handle. (repro는 256바이트 frame 한계에 2000자 result로 강제.)
- 재현 방법: `review/adversarial-2026-09-28/repro/G03-broker-r2/frame-too-large-after-effect.mjs`. `timeout 60 node review/.../frame-too-large-after-effect.mjs`.
  관측:
  ```
  effect ran (committed): true
  frames to caller: [{"v":1,"id":"req","ok":false,"error":{"code":"FRAME_TOO_LARGE","message":"RPC response exceeds the configured frame budget","retry":"never"}}]
  caller sees: ERROR FRAME_TOO_LARGE retry=never
  ```
- 확신도: confirmed(경로·응답 재현). 실전 도달성은 낮음(응답 codec이 상한을 강제).
- 개선 방향: 효과를 내는 method의 결과 상한을 계약(receipt version)으로 못박아 "커밋됨 + never 실패 응답" 조합을 없앰. 1차 보고 G03-broker-01과 동일 원인이며, 그쪽은 P0V-44(stop receipt `remainingOperations`, `status.get`)를 문서화된 예외로 든다. §7 참조.

### G03-broker-r2-03 Yama ptrace scope 0 host에서 Principal 자손 판정 붕괴
- 심각도: Info
- 분류: authority/ownership (known-limitation)
- 위반 규칙: P0-1 — 단 코드·문서가 host 속성으로 명시한 의도된 한계
- 코드 경로: `src/broker/process-ancestry.ts:1-30`(주석이 Yama scope>=1 전제를 진술), `descendsFrom`(`process-ancestry.ts:82-93`), `principal-endpoint.ts`의 매 요청 `authority()`·`attach`.
- 원인: Principal 신원 판정이 "등록된 engine의 자손인가"에 의존하고, 이는 kernel ptrace 제한에 기댄다. scope 0 host에서는 같은 UID의 프로세스가 engine을 trace해 자손처럼 위장할 여지가 있다.
- 영향: 같은 UID 적대 프로세스의 Principal 사칭. `implementation/validation.md`의 "알려진 한계"에 이미 기재되어야 하는 항목으로, 코드 주석이 전제를 숨기지 않고 진술함.
- 최소 반례: `kernel.yama.ptrace_scope=0` host.
- 재현 방법: 추론만(커널 설정·sudo 필요, 규칙상 제외). 코드가 전제를 정확히 진술함을 확인.
- 확신도: high — known-limitation.
- 개선 방향: 없음. host 속성으로 명시됨.

### G03-broker-r2-04 cgroup-containment 판정이 peer-authenticator 안에 4회 반복
- 심각도: Info
- 분류: structural
- 위반 규칙: P0-2(같은 결정 한 owner) — 현재 표현은 동일하나 손으로 맞춰짐
- 코드 경로: `src/broker/peer-authenticator.ts`의 `context`(currentCapabilities 안 1회 + 그 밖 1회), `requireRunnerUnit`, `requireHostUnit`, `runnerActor` — `prefix = cgroup.endsWith("/") ? cgroup : \`${cgroup}/\`` 와 `peerGroup !== cgroup && !peerGroup.startsWith(prefix)` 형태가 반복.
- 원인: cgroup 포함(containment) 판정이 한 함수로 모이지 않고 여러 자리에 같은 식으로 복제됨.
- 영향: 지금은 동일하나, 한 곳만 고치면 drift가 생겨 권한 판정이 자리마다 달라질 위험(P0-2가 경계한 representation drift).
- 재현 방법: 코드 대조(정적).
- 확신도: medium
- 개선 방향: cgroup-containment를 한 순수 함수로 뽑아 네 자리가 그것을 호출.

## 4. 리팩터링 필요 지점

- **incarnation commit과 endpoint 게시의 원자성**(발견 01): 커밋 뒤 실패할 수 있는 작업이 남아 있어, 실패가 durable한 incarnation 전진을 남긴다. "커밋 뒤에는 실패하지 않는다"를 만족하도록 게시 준비를 커밋 앞으로 옮기거나 보상 경로를 둔다.
- **cgroup-containment 단일 owner화**(발견 04, P0-2).
- **결과 상한의 계약화**(발견 02): 효과 커밋 경계 뒤 응답 크기 검사가 여러 method에 잠재. receipt version으로 상한을 계약에 넣는 방향(1차 보고와 동일 결론).

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **DB commit 뒤 view 갱신 실패가 응답을 실패로 바꾸는가**: 아니다. `openRun`은 커밋·게시 뒤 `this.refreshViews()`를 부르고 lease를 반환하는데, `refreshViews`(`broker.ts`의 `refreshWorld` try/catch)는 자체적으로 예외를 삼킨다. `public-dispatcher.dispatchChecked`의 `finally { release(); if (mutation) refreshViews(); }`도 응답이 정해진 뒤 실행되어 커밋된 효과의 응답을 실패로 바꾸지 못한다. (근거: `broker.ts` `refreshViews`, `public-dispatcher.ts` finally.)
- **frame 길이 경계(0/한계±1/0xffffffff)·정수 overflow**: `frame.ts`의 `feed`/`drain`에서 `length > this.bound` 선행, `checkedLimit`이 `min(max,0xffffffff)`로 고정. `beginStream`의 declaredBytes는 `Number.isSafeInteger`·`<0` 검사. (근거: `frame.ts` `checkedLimit`, `FrameParser.feed`, `ConnectionDecoder.drain`/`beginStream`.)
- **duplicate/escaped key·__proto__·unsafe number·surrogate**: `findDuplicateKey`가 escape 철자까지 검출, reviver가 non-finite/unsafe integer/unpaired surrogate 거부. (근거: `frame.ts` `findDuplicateKey`, `parseJsonObject` reviver.)
- **버퍼 무제한 증가**: `requireControlBudget`(`bound+4`), `beginStream`의 `maxCollectedStreamBytes`, streamSink 경로는 chunk 보관 안 함. (근거: `frame.ts` `requireControlBudget`/`drain`.)
- **동시 연결 수**: `server.maxConnections = ACTOR_CONNECTIONS`(16), 초과는 handle 전 커널이 닫음; 내부/principal 소켓은 uid+pidfd 게이트. (근거: `broker.ts` `listenActor`의 `maxConnections`.) `test/connection-bounds.test.ts`가 이 경계를 실 소켓으로 검증함(코드로 확인).
- **pid 재사용 / /proc TOCTOU**: 신원은 `SO_PEERPIDFD` pin, liveness는 매 read `alive()`(pidfd). cgroup은 pid로 읽되 권한 부여는 항상 `alive()` 참을 함께 요구하므로, pidfd가 원 프로세스 사망을 보면 pid 재사용 프로세스에 권한이 가지 않음. (근거: `peer-authenticator.ts` `context`·`requireRunnerUnit`의 `!credentials.alive()`/`!peer.alive()` 조건.)
- **이전 incarnation 연결이 새 권한으로 효과**: `context`의 currentCapabilities가 매 read마다 store row·incarnation·specHash·role·cgroup·live 재검사 후 불일치 시 빈 capability. `principalContext`도 동일. principal-endpoint `authority()`는 generation·descendsFrom·alive를 매 요청 재도출. (근거: `peer-authenticator.ts` currentCapabilities, `principal-endpoint.ts` `authority`/`live`.)
- **principal register/rollover·이전 세션 회수**: `register`가 먼저 `retire()`(실패 전 이전 세션·연결 회수)하고 새 credential mint, generation 증가. `engineRuns`가 죽은 engine을 `setImmediate`로 retire. `close()`가 credential 소멸. (근거: `principal-endpoint.ts` `register`/`retire`/`engineRuns`/`close`.)
- **두 endpoint 간 순서·host만 delivery**: 모델 endpoint는 attach 전 모든 요청 거부, delivery(prepare/complete)는 `PrincipalHostEndpoint`에서 `isHost`(pid+startTime) 확인·`registeredEngine()!==null` 확인 후에만. (근거: `principal-endpoint.ts` `PrincipalHostEndpoint.dispatch`.)
- **engine 사망 후 자손 reparent**: `descendsFrom` fail-closed(unreadable/malformed/too-deep=자손 아님), 종료 판정은 `processEnded`만. (근거: `process-ancestry.ts` `descendsFrom`/`processEnded`.)
- **dispatcher 예외 격리·unhandled rejection**: public/internal dispatch가 예외를 `failureAnswer`로 흡수. `start`의 `void this.starting.catch(...)`가 legacy 비대기 호출의 unhandled rejection 방지하되 권위 Promise는 reject 유지. (근거: `public-dispatcher.ts` dispatch try/catch, `internal-dispatcher.ts` try/catch/finally, `broker.ts` start.)
- **timer 단조 시계**: `NODE_ALARMS`가 `performance.now()`로 deadline 재무장 → 벽시계 역행 무영향. `logs.ts`의 `Date.now()`는 observedAtMs(관측 스탬프)로 기한 아님. (근거: `connection.ts` `NODE_ALARMS`, `logs.ts` `readUnitLogs`.)
- **transport-spool 소유/정리/부분쓰기**: O_EXCL|O_NOFOLLOW 생성, append 전량-write 루프, seal에서 fsync+length+sha256, handoff에서 dev/ino/size 재검증(교체 탐지), dispose 한 번만 unlink+close, owner 상태기계 connection→execution→disposed. accepted artifact 아님(IPC-003). (근거: `transport-spool.ts` 전체.)
- **accept 후 연결 끊김 시 효과 보존**: `serveFrames`의 `onClosed: () => { if (!executing) releaseReservation(); }` — 실행 중 종료는 reservation을 반납하지 않아 accepted copy 쓰기를 막지 않음. executing task가 body/peer 소유. (근거: `broker.ts` `serveFrames`, `connection.ts` `disposeConnectionState` 주석.)
- **closeAdmission/drain 중 도착 요청**: 모든 listen 콜백이 `if (this.draining) socket.destroy()/return`. `drainAndClose`는 `settleWithin`으로 starting·executingTasks·listenerCloses를 grace 안에서 정산 후에만 Store/lock 반납, `quiesceOnDrain` 실패는 삼키되 unproven으로 표시해 drain을 실패로 끝냄(P0V-58, `broker-lifetime.ts` `settleWithin`). (근거: `broker.ts` `closeAdmission`/`drainAndClose`, `broker-lifetime.ts`.)
- **society 단독 소유**: `entry/broker.ts`의 `ProcessLock.tryAcquire`+`claimSocietyFence`, 실패 시 `SOCIETY_OWNED_EXIT`. 감독 채널 미확립 시 lock 반납 후 미기동(P0V-28). (근거: `entry/broker.ts` main.)

## 6. 확인하지 못한 것

- 발견 01의 실전 트리거 확률: 실제로 `listenActor`가 커밋 뒤 던지는 조건(ENOSPC/EACCES/corruption 관측/ sun_path 초과)은 주입으로만 재현했고, 프로덕션 파일시스템에서의 자연 발생은 관측하지 못함. incarnation 되돌림 부재의 운영상 영향(재시작으로만 회복되는지 vs cgroup empty 후 자동 회복)은 systemd 실환경 미검증.
- systemd fixed-unit broker 수명(`systemdManaged` 분기), NOTIFY_SOCKET/sd_notify 실경로: systemd 필요, 규칙상 추론만.
- 실제 SO_PEERCRED/SO_PEERPIDFD 커널 동작·EINTR 재시도(`leaf.ts` pidfd liveness): native·소켓 필요. 분류 로직만 코드로 확인.
- `start()` 중 listen과 `running=true` 사이 창으로 도착한 요청: 콜백은 `draining`만 검사하고 `running`은 검사하지 않으나, 진입 전 recovery가 완료되어 있어(entry의 recover→listen 순서) 실 위반으로 보이지 않음. 그러나 이 창에서의 요청 처리를 실제로 주입해 확인하지 못함.
- 발견 02가 실제 mutation에서 도달 가능한지: 응답 codec들이 frameBytes 이하로 제한함을 코드로 확인했으나, 모든 receipt 형식이 상한 아래임을 형식 단위로 전수 확인하지는 못함.

## 7. 1차 보고와의 차이

1차 보고(`groups/G03-broker.md`)의 커버리지 표는 14개 파일 중 다수의 줄 수가 실측과 달랐다. 대표: broker.ts 344 vs 실제 546, principal-endpoint.ts 300 vs 404, connection.ts 292 vs 265, internal-dispatcher.ts 291 vs 244, public-dispatcher.ts 209 vs 206, frame.ts 179 vs 194, composition.ts 172 vs 151, entry/broker.ts 246 vs 234, process-ancestry.ts 111 vs 94, peer-authenticator.ts 129 vs 126, transport-spool.ts 129 vs 111. (replies.ts 5, logs.ts 22/27은 오차가 없거나 작음.) 특히 broker.ts 345–546(=`openRun`/`settlePreviousIncarnation`/`closeAdmission`/`drainAndClose`), principal-endpoint.ts 301–404가 1차에서 실제로 읽혔는지 표만으로는 확인되지 않는다.

내용상 실제 차이:

- **새 발견(1차에 없음) — G03-broker-r2-01(openRun incarnation-burn).** 1차 보고 §6은 "rollover 뒤 endpoint bind 실패의 주입 ... `server.on("error")`가 해당 incarnation일 때만 revoke하는 경로는 읽었으나 bind 실패를 실제 주입하지 못함"이라고 적어, 이 경로를 **미검증으로 남겼다.** 2차는 `listenActor` 실패를 주입해, bind 실패가 아니라 **incarnation-commit 뒤 게시 실패**가 incarnation을 lease 없이 durable하게 전진시키고 그 invocation을 재개 불가로 만든다는 것을 재현했다(`openrun-postcommit.mjs`). 이는 broker.ts 459–475 구간(1차 표의 344줄 기준으로는 파일 범위 밖)의 판정이다.
- **동일 원인 재확인 — G03-broker-r2-02 ≈ 1차 G03-broker-01(FRAME_TOO_LARGE-after-commit).** 1차는 이를 Medium·"추론만"으로 두었다. 2차는 `RpcConnection`을 fake socket으로 조립해 "handle 실행(효과) 후 FRAME_TOO_LARGE retry:never 응답"을 실제로 재현했다(`frame-too-large-after-effect.mjs`, confirmed). 다만 실 mutation 응답이 codec으로 frameBytes 이하로 제한됨을 확인해, 2차는 심각도를 Low로 낮췄다(1차 Medium). P0V-44 문서 예외가 예시임을 넓혀야 한다는 방향은 1차와 동일.
- **동일 결론 — Yama scope 0(1차 04 ≈ 2차 03), cgroup 판정 반복(1차 §4 두 번째 항목 ≈ 2차 04).** 판정·근거 일치.
- **1차 고유 항목 — G03-broker-02(`git.known` truncation), G03-broker-03(len=0 frame 분류).** 2차도 해당 코드(`public-dispatcher.ts`의 known 루프 break, `frame.ts`의 len=0 경로)를 읽었고 판정에 동의하나(§5의 frame 경계·버퍼 항목에 흡수), 별도 발견으로 재분류하지 않았다. 특히 len=0은 poison·연결 종료로 안전하고 진단 품질 문제에 그쳐 Info 이하로 보아 §5에 둔다.

요약: 1차 보고는 줄 수 오차에도 불구하고 대부분의 경로를 실제로 짚었고 판정도 견실했다. 2차가 추가한 실질 발견은 **openRun의 incarnation-commit 뒤 게시 실패**(1차가 미검증으로 남긴 영역)이며, FRAME_TOO_LARGE-after-commit은 재현으로 확신도를 올리고 실 도달성 근거로 심각도를 조정했다.
