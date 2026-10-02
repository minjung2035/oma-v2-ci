# G03-broker 적대적 검증 결과

검토 범위: `src/broker.ts`, `src/broker/{composition,connection,internal-dispatcher,logs,peer-authenticator,peer-pin,principal-endpoint,process-ancestry,public-dispatcher,replies,transport-spool}.ts`, `src/entry/broker.ts`, `src/frame.ts`. 규칙: 코드 무수정, build/test 무실행, 산출물은 `review/adversarial-2026-09-28/` 아래에만.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 |
|---|---|---|---|
| src/broker.ts | 344 | 예 | 수명·listen·openRoll·drain |
| src/broker/composition.ts | 172 | 예 | port 팩토리(순수 위임) |
| src/broker/connection.ts | 292 | 예 | RpcConnection 상태기계 |
| src/broker/internal-dispatcher.ts | 291 | 예 | runner/host 채널 dispatch |
| src/broker/logs.ts | 27 | 예 | journal 관측(진단) |
| src/broker/peer-authenticator.ts | 129 | 예 | 신원·cgroup·live 권한 |
| src/broker/peer-pin.ts | 46 | 예 | pidfd 소유·retain |
| src/broker/principal-endpoint.ts | 300 | 예 | Principal 두 endpoint |
| src/broker/process-ancestry.ts | 111 | 예 | /proc descendsFrom |
| src/broker/public-dispatcher.ts | 209 | 예 | 공개 method dispatch |
| src/broker/replies.ts | 5 | 예 | envelope 생성 |
| src/broker/transport-spool.ts | 129 | 예 | .wire 임시 사본 |
| src/entry/broker.ts | 246 | 예 | 프로세스 진입·lock·lease |
| src/frame.ts | 179 | 예 | 길이 prefix + JSON |

호출 경로 확인을 위해 그룹 밖에서 읽은 파일: `src/leaf.ts`(peerCred/peerPidFd/pidfdLiveness/socketDescriptor), `src/protocol/byte-queue.ts`, `implementation/validation.md`(알려진 한계), `PRIORITY-0.md`, `AUDIT-BRIEF.md`.

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G03-broker-01 | Medium | resource/boundary | 효과 커밋 후 응답이 frame 한계를 넘으면 FRAME_TOO_LARGE로 답한다(P0V-44 밖 경로 포함) | high |
| G03-broker-02 | Low | boundary | `git.known` 응답 truncation이 조용히 prerequisite를 버린다 | high |
| G03-broker-03 | Low | boundary | `len=0` frame이 FRAME_TOO_LARGE가 아니라 INVALID_REQUEST로 poison된다(연결 종료 차이) | confirmed |
| G03-broker-04 | Info | authority | Yama scope 0 host에서 Principal 경계 붕괴(known-limitation) | high |
| G03-broker-05 | Info | structural | `listenInternal`/`listenOn`의 `existsSync`+`unlinkSync` 소켓 unlink에 TOCTOU 창이 있으나 lock/lease로 봉인 | medium |

High 이상 없음. 아래는 상세.

## 3. 발견 상세

### G03-broker-01 효과 커밋 후 응답이 frame 한계를 넘으면 FRAME_TOO_LARGE로 답한다
- 심각도: Medium
- 분류: resource / boundary
- 위반 규칙: P0-5(unknown을 사실로 승격), P0-4(accept 후 효과 보존)
- 코드 경로: `src/broker/connection.ts:238`(`encodeFrame(outcome.value)` 뒤 `frame.length > ...frameBytes ... throw new FrameError("FRAME_TOO_LARGE", ...)`) → `src/broker/connection.ts:186`(`fatal` → 오류 frame으로 연결 종료). 같은 형태가 `src/broker.ts:200`(`fail`의 정적 오류 frame 검사)에도 있다.
- 원인: dispatch는 mutation을 실제로 커밋한 뒤(`public-dispatcher` finally에서 `refreshViews`) 결과를 직렬화한다. 결과 크기가 `frameBytes`를 넘으면 커밋은 이미 끝났는데 호출자는 `FRAME_TOO_LARGE`(retry: never)만 받는다. `validation.md`(알려진 한계, P0V-44/DR14)는 stop receipt의 `remainingOperations`와 `status.get`을 이 예외의 대상으로 명시하나, 같은 물리 경로는 `operation.get`(임의로 커진 과거 receipt), `mail.send`/`git.submit`/`context.publish`의 receipt 등 result가 무한 상한이 아닌 모든 mutation에도 열려 있다. 즉 문서가 든 두 필드는 예시이고 경로는 dispatch 전체다.
- 영향: accept·커밋된 durable fact(operation row/receipt)가 존재하는데 호출자에게는 실패로 보인다. 호출자가 same-key로 재시도하면 receipt 조회로 흡수되지만(P0V-44가 든 두 필드는 애초에 same-key 흡수 대상이 아님), receipt 자체가 커서 났다면 재조회도 같은 크기로 다시 FRAME_TOO_LARGE가 된다 — 즉 unknown이 아니라 "영구히 읽을 수 없는 커밋된 사실"이 된다.
- 최소 반례: `frameBytes`를 작게(예: 4 KiB) 잡은 society에서 미해결 operation이 많은 agent에 `agent.stop` → stop receipt의 `remainingOperations`가 4 KiB를 넘음 → 효과(stop)는 커밋, 응답은 FRAME_TOO_LARGE, 재조회도 동일.
- 재현 방법: 추론만. dist 단위 실행으로는 store/mail/lifecycle 전체 조립이 필요해 이 그룹의 raw-socket 범위를 넘는다. 경로는 `connection.ts:236-241`에서 `encodeFrame` 후 길이 검사가 커밋 이후임을 코드로 확인.
- 확신도: high (경로는 확정, 실행 미수행)
- 개선 방향: receipt versioning(문서가 이미 지목)으로 크기 상한을 계약에 넣거나, 커밋 전 결과 상한을 admit해 커밋 자체를 거절(그러면 unknown이 아니라 명시적 거절). 어느 쪽이든 "커밋됨 + 실패 응답"의 조합을 없애는 방향. P0V-44의 서술 대상을 두 필드에서 "무한 상한 result 전체"로 넓히는 문서 정정도 필요.

### G03-broker-02 `git.known` 응답 truncation이 조용히 prerequisite를 버린다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음(진단/조회 경로)
- 코드 경로: `src/broker/public-dispatcher.ts:171-180`(`for (const oid of known) { ... if (bytes + extra > frameBytes) break; ... }`)
- 원인: known ref가 frame에 다 안 들어가면 `break`로 나머지를 조용히 누락하고 `truncated` 같은 표시 없이 반환한다. `hasCandidate`는 유지되지만 `prerequisites`가 잘린다.
- 영향: 호출자가 잘린 prerequisite 목록을 완전한 것으로 믿으면 필요한 ref를 push하지 않을 수 있다. mutation은 아니고, submit/integrate 시 broker가 다시 판정하므로 durable fact를 훼손하진 않는다. 진단 품질 저하.
- 최소 반례: published ref가 수천 개 있어 목록이 frameBytes를 넘는 society.
- 재현 방법: 추론만(GitModule 전체 조립 필요).
- 확신도: high
- 개선 방향: 잘렸음을 응답에 표시하거나, 이 method의 계약이 "완전 목록"을 보장하지 않음을 문서화. `git.known` 소비자가 목록의 완전성에 의존하지 않는지 owner 확인.

### G03-broker-03 `len=0` frame이 FRAME_TOO_LARGE가 아니라 INVALID_REQUEST로 poison된다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음
- 코드 경로: `src/frame.ts:130-133`(`FrameParser.feed`: length 0이면 `bound` 초과가 아니므로 통과 → `parseJsonObject(take(0))` → 빈 바이트 UTF-8 디코드 후 `JSON.parse("")` 실패 → `INVALID_REQUEST` poison). `ConnectionDecoder.drain`도 동일(`frame.ts:156-162`).
- 원인: 경계 자체는 안전(0은 한계 이하, 정수 overflow 없음). 다만 0바이트 body를 "빈 프레임"으로 특별 취급하지 않고 JSON 파싱까지 가서 실패로 poison한다. 경계값 처리로는 정상(reject)이나 오류 분류가 프레이밍 오류가 아니라 JSON 오류가 된다.
- 영향: 없음에 가까움. 연결은 어차히 종료(poison sticky, 재동기화 안 함, IPC-001/002 계약대로). 진단 메시지가 "malformed JSON"이라 원인이 0길이 프레임임을 가린다.
- 최소 반례: 헤더 `00 00 00 00`.
- 재현 방법: `review/adversarial-2026-09-28/repro/G03-broker/frame-boundaries.mjs` 실행. 관측: `len=0 rejected as INVALID_REQUEST`, 전체 `pass=13 fail=0`.
- 확신도: confirmed
- 개선 방향: 필요 없음(견고성은 유지). 진단만 원하면 0길이를 프레이밍 오류로 명명. P0-6 관점에서 "0 특수처리"를 새로 넣을 이유는 약함.

### G03-broker-04 Yama ptrace scope 0 host에서 Principal 경계 붕괴
- 심각도: Info
- 분류: authority/ownership (known-limitation)
- 위반 규칙: P0-1(권한 경계) — 단 의도된 한계로 문서화됨
- 코드 경로: `src/broker/process-ancestry.ts:1-30`(주석이 Yama scope>=1 전제를 명시), `descendsFrom`(`process-ancestry.ts:98-110`), `principal-endpoint.ts`의 매 요청 재검사(`serve`의 `authority()`, `attach`).
- 원인: Principal 신원은 "등록된 engine의 자손인가"로 판정하는데, 이는 kernel의 ptrace 제한(Yama scope>=1)에 의존한다. scope 0 host에서는 같은 UID의 임의 프로세스가 engine을 trace해 그 자손처럼 보이거나 자격을 탈취할 수 있다.
- 영향: 같은 UID 적대 프로세스가 Principal을 사칭. `validation.md` "알려진 한계 / 보안 경계"에 이미 기재됨.
- 최소 반례: `kernel.yama.ptrace_scope=0` host.
- 재현 방법: 추론만(sudo/커널 설정 필요, 규칙상 제외). 코드가 전제를 주석으로 정확히 진술함을 확인.
- 확신도: high — 문서 서술과 코드가 일치하므로 새 결함 아님(known-limitation).
- 개선 방향: 없음. 코드가 host 속성으로 명시(숨기지 않음). 문서와 코드 일치 확인 완료.

### G03-broker-05 내부 소켓 unlink의 TOCTOU 창(lock/lease로 봉인)
- 심각도: Info
- 분류: structural / race
- 위반 규칙: 없음
- 코드 경로: `src/broker.ts:158`(`if (existsSync(path)) unlinkSync(path)` in `listenInternal`), `src/broker.ts:181`(동 `listenOn`), `src/broker.ts:214`(`listenActor`).
- 원인: `existsSync`→`unlinkSync`→`listen` 사이에 TOCTOU 이론적 창이 있다. 그러나 이 경로 진입 전 `entry/broker.ts`에서 `ProcessLock.tryAcquire`(80행대)와 `claimSocietyFence`(society lease)가 이미 society 단독 소유를 봉인하므로, 두 broker가 같은 runRoot의 소켓을 동시에 unlink하는 상황이 도달 불가능.
- 영향: 실질 영향 없음. 봉인 근거를 명시.
- 최소 반례: lock/lease 없이 같은 runRoot로 두 broker 직접 기동(정상 경로에서 불가).
- 재현 방법: 추론만.
- 확신도: medium
- 개선 방향: 없음. 봉인이 다른 층(process-lock, society-lease)에 있음을 확인.

## 4. 리팩터링 필요 지점

- FRAME_TOO_LARGE-after-commit(발견 01)는 한 원인(결과 상한이 커밋 경계 뒤에 검사됨)이 여러 method에 걸쳐 반복된다. P0V-44가 든 두 필드만 문서화한 것은 P0-6의 "이름 없는 예외가 여러 곳"에 해당. 결과 크기 상한을 receipt 계약(version)으로 이름 붙이는 것이 근본 방향.
- `peerCgroup`/cgroup-prefix 검사 로직(`prefix = ...endsWith("/") ? ... : \`${...}/\``와 `peerGroup !== observed.cgroup && !peerGroup.startsWith(prefix)`)이 `peer-authenticator.ts`의 `context`, `requireRunnerUnit`, `requireHostUnit`, `runnerActor`에 4회 반복된다(context 안에서도 2회). P0-2(한 판정 한 owner) 관점에서 cgroup-containment 판정을 한 함수로 모으는 편이 drift 위험을 줄인다. 현재 표현은 동일하나 손으로 맞춰져 있다.

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **frame 길이 경계(0, 한계-1, 한계, 한계+1, 0xffffffff)**: `frame.ts:130-133`, `frame.ts:156-159`에서 `length > this.bound` 검사가 정수 overflow 없이(uint32BE는 `byte-queue.ts:39-42`) 선행. `checkedLimit`(`frame.ts:105-108`)가 한계를 `min(max, 0xffffffff)`로 고정. repro `frame-boundaries.mjs` `pass=13 fail=0`으로 확인.
- **부분 read / 헤더·body 분할**: `ByteQueue`가 임의 청크 경계를 재조립(`byte-queue.ts` shift/peek/take). repro 5번 통과.
- **poison sticky(재동기화 없음)**: `FrameParser.feed`(`frame.ts:124`)와 `ConnectionDecoder.push`(`frame.ts:...`)가 `this.failure`를 먼저 던짐. repro 7번 `same error object=true`.
- **duplicate key / escaped key / __proto__**: `findDuplicateKey`(`frame.ts:11-46`)가 escape 철자까지 검출, reviver가 unsafe number/surrogate 거부(`frame.ts:88-96`). repro 8·9번 통과, prototype pollution 없음(`polluted=undefined`).
- **버퍼 무제한 증가**: `ownRemainder`(`byte-queue.ts:57-64`)와 `requireControlBudget`(`frame.ts`)이 `bound+4`로 상한. collected stream은 `maxCollectedStreamBytes`로 상한(`frame.ts` `beginStream`). repro 10·11번 통과.
- **동시 연결 수 한계**: `server.maxConnections = ACTOR_CONNECTIONS`(`broker.ts:216`), 초과 연결은 handle 전에 커널이 닫음(주석 INV10). 내부/principal 소켓은 uid+pidfd로 게이트.
- **pid 재사용 race**: 신원은 `SO_PEERPIDFD`(`leaf.ts:82`)로 pin, liveness는 pidfd poll(`leaf.ts:137`)로 매번 재관측. cgroup은 pid로 읽되(`peer-authenticator.ts:16`) 항상 `alive()`(pidfd) 참을 전제로만 권한 부여하므로 원 프로세스 생존 창 안에서만 pid 유효 → 재사용 봉인.
- **peer-pin이 과거 관측을 현재 권한으로 재사용(P0-1)**: `SharedPeerPin.alive()`(`peer-pin.ts:22-25`)와 `currentCapabilities`(`peer-authenticator.ts:56-70`, `principal`쪽 `peer-authenticator.ts:98-108`)가 매 read마다 store row·incarnation·specHash·cgroup·live를 재검사하고, 불일치 시 빈 capability 집합 반환. 복사된 grant를 남기지 않음(P0V-60 주석). principal-endpoint의 `authority()`/`live()`(`principal-endpoint.ts` serve)도 매 요청 재도출.
- **engine 사망 후 자손 reparent**: `descendsFrom`이 fail-closed. repro `process-ancestry.mjs`에서 중간 프로세스 SIGKILL 후 손자가 pid1로 reparent되어 `descendsFrom==false`, 그러나 손자는 생존(INV02: unknown이 아니라 관측된 "자손 아님"). `pass=9 fail=0`.
- **accept 후 연결 끊김 시 효과 보존**: `serveFrames`의 reservation 소유권(`broker.ts:...` `releaseReservation`/`executing`)과 `connection.ts`의 "executing task가 body/peer 소유"(`disposeConnectionState` 주석 `connection.ts:...`)로 실행 중 연결 종료가 accepted copy 쓰기를 막지 않음. `onClose`→`close`는 executing 중 releaseReservation을 하지 않음(`onClosed: () => { if (!executing) releaseReservation(); }`).
- **응답 backpressure**: `connection.ts` dispatch에서 `socket.write` false면 `phase="backpressure"`, `onDrain`에서 `finishWrite`(`connection.ts:280-283`). backpressure 중 fatal은 즉시 close(`fatal`의 `phase === "backpressure"` 분기).
- **timer 단조 시계**: `NODE_ALARMS`가 `performance.now()`로 deadline 계산·재무장(`connection.ts:31-46`) → 벽시계 역행에 무영향. `logs.ts:24`의 `Date.now()`는 관측 타임스탬프(observedAtMs)로 기한 아님.
- **dispatcher 예외 격리**: public `dispatch`(`public-dispatcher.ts:190-193`)와 internal `dispatch`(`internal-dispatcher.ts` try/catch/finally)가 예외를 `failureAnswer`로 흡수, 연결/broker를 죽이지 않음. 알 수 없는 method는 UNKNOWN_METHOD, 채널 불일치는 AUTH_FAILED(`internal-dispatcher.ts:...`).
- **internal vs public 권한 분리**: internal method는 `descriptor.channel !== channel` 거부, `batch.read`/`principal.attach`/`principal.detach`는 broker 채널에서 AUTH_FAILED. host endpoint는 `isHost`(pid+startTime) 확인 후에만 batch.prepare/complete 서빙(`principal-endpoint.ts` PrincipalHostEndpoint.dispatch).
- **start 중 unhandled rejection**: `void this.starting.catch(...)`(`broker.ts:141`)로 legacy 비대기 호출의 unhandled rejection 방지, 권위 Promise는 여전히 reject.
- **두 broker 같은 socket/state root**: `ProcessLock.tryAcquire` + `claimSocietyFence`(`entry/broker.ts:80-120`대)가 society 단독 소유 봉인. 실패 시 `SOCIETY_OWNED_EXIT`.
- **transport-spool 소유/정리/부분쓰기**: `TransportSpool`이 O_EXCL|O_NOFOLLOW로 생성(`transport-spool.ts:...`), append 전량 write 루프(부분쓰기 처리), seal에서 fsync+length+sha256 검증, handoff에서 dev/ino/size 재검증(교체 탐지), dispose가 한 번만 unlink+close(owner 상태기계 connection→execution→disposed). accept된 workflow artifact가 아닌 순수 transport 사본임을 명시(IPC-003).

## 6. 확인하지 못한 것

- 발견 01(FRAME_TOO_LARGE-after-commit)의 실제 실행 재현: Store/Mail/Lifecycle/Git 전체 조립이 필요해 이 그룹의 dist 단위·raw-socket 범위를 넘음. 경로는 코드로 확정했으나 end-to-end 미실행.
- systemd fixed-unit 형태의 broker 수명(`systemdManaged` 분기), NOTIFY_SOCKET/sd_notify 실경로: systemd 필요, 규칙상 추론만.
- rollover 뒤 endpoint bind 실패의 주입(WP30에 미검증으로 기재됨): `listenActor`의 `server.on("error")`가 해당 incarnation일 때만 revoke하는 경로는 읽었으나 bind 실패를 실제 주입하지 못함.
- 실제 SO_PEERCRED/SO_PEERPIDFD 커널 동작과 EINTR 재시도(`livenessFromPoll`)의 커널 레벨 재현: native lib·소켓 필요. 분류 로직은 코드로 확인.
- `git.known` 소비자가 잘린 목록에 의존하는지(발견 02의 실제 영향 범위): 소비자는 그룹 밖(CLI/agent). owner 확인 미완.
