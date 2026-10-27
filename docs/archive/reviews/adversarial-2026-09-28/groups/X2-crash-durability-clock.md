# X2-crash-durability-clock 적대적 검증 결과

교차 영역(패턴 단위) 감사. `src/` 전체(264 `.ts`)를 7개 패턴으로 훑어 후보를 표로 남기고, 후보마다 함수 전체와 호출자·진입점을 읽어 판정했다. 출발점 (a)~(d)와 이미 다른 그룹 보고서에 있는 코드 경로는 "기존 ID와 같음"으로 표시하고, 같은 모양의 **다른 자리**만 새 ID로 올렸다.

기준 커밋: `feat/macos-hidden-vm` HEAD `070a52d`. 코드 미수정, build/test 미실행.

## 1. 커버리지 (패턴별 후보 목록)

grep은 후보 수집에만 썼고, 판정은 각 함수·호출자·진입점을 read로 읽어서 했다. "판정" 열: 위반=새 발견, 기존=다른 그룹 보고서에 이미 있음, 부합=방어 확인.

### 패턴 1 — 존재를 완성의 증거로 씀 (`existsSync`/`statSync`/`lstat`)

| 파일:줄 | 판정 | 근거 |
|---|---|---|
| platform/host/service.ts:143 `if (!existsSync(target)) encryptArchive(...)` | 기존(G12-01) | 부분 archive를 완성본으로 승격. 이미 G12 confirmed. |
| runtime/provision.ts:147 `if (existsSync(path)) return false` | 부합 | 바인딩 게시 전 존재 확인일 뿐, 완성 판정 아님. `publishProjectBinding`/`collectBindingTemporaries`가 owner(durable-boundaries). |
| runtime/provision.ts:250,259 `existsSync(projectGit)`/`hasCanonicalMain` | 부합 | canonical main은 CAS로 게시(`createCanonicalMain`, P0V-85). 존재+ref 확인 뒤 CAS가 진짜 판정. |
| lifecycle/workspace.ts:97 `if (!existsSync(join(temporary,".git")))` | 부합 | 준비 중 clone 재개 판정. 게시는 `WorkspaceCoordinator.prepare`(리스 보유)가 owner. |
| platform/guest/project.ts:67,71 `existsSync(staged)` + size + sha256 재검 | 부합 | 존재만으로 승격하지 않고 size·sha256을 다시 본다. |
| request-cache.ts:56 주석 "No existsSync precheck" / :61 `fstatSync(fd)` | 부합 | 열고 나서 fstat, ENOENT만 absent. I/O 실패를 absent로 승격 안 함(P0-5 준수). |
| storage/immutable-file.ts:35,58 fstat 전후 비교 | 부합 | 바이트·inode·mtime 재검으로 TOCTOU 방어. |
| config/operations.ts:177 `lstatSync(identity.path)` | 부합 | 이어서 fd로 열고 fstat 재검(operations.ts:189,200). |

### 패턴 2 — 최종 경로 직접 쓰기 (durable-fs primitive 우회)

| 파일:줄 | 판정 | 근거 |
|---|---|---|
| platform/host/archive-crypto.ts:39 `openSync(outPath, O_CREAT\|O_EXCL)` 직쓰기 | 기존(G12-01) | temp+rename 없음. |
| platform/host/snapshot.ts:31 `renameSync(partial,final)` fsync 없음 | 기존(G12-02) | partial/dir fsync 없음. |
| platform/guest/stream.ts:104 `writeSync` (put 수신) | 기존(G13-01) | 아래 패턴 3의 crash와 동일 코드. |
| **platform/host/project.ts:96,104,116** getStream `openSync(O_TRUNC)`+`writeSync` in onData | **위반(X2-01, 신규)** | host 전송 경로. 패턴 3에서 상술. |
| platform/host/record.ts:57-64 temp→fsync→rename→dir fsync | 부합 | 올바른 게시(직접 구현이나 순서 정확). |
| platform/guest/provision.ts:103 `writeFileSync(path,...)` 직쓰기+fsync | 위반(X2-03, Low) | instance record 직쓰기. 아래 상술. |
| platform/guest/archive.ts:50 `writeFileSync(manifest.json)`, tar `--file staged` | 부합 | staging 산출물. 완료 owner는 원장 outcome(requests.ts). G13 §5가 확인. |
| storage/delivery-receipt.ts:422 `writeFileSync(fd,encoded)` | 부합 | createLockedTemporary→link→validate→cleanup 전체 primitive 사용. |
| storage/context-stream.ts:168, submit-spool.ts:75 `writeSync(fd,part)` | 부합 | 스트리밍 수신 중 사전 확보된 fd에 씀. hash·size 재검 후 게시. |
| config/generations.ts:291,377,443 `renameSync` | 부합 | 전부 `withinDirectory` 아래, 게시 전 fsync·검증. P0V-61 순서. |
| resident-rootfs.ts:116,125 `writeFileSync(fd,content)` | 부합 | rootfs 준비(파생, 재구성 가능). |
| entry/omahostd.ts:50 `openSync(O_EXCL)` state.img | 부합 | 최초 1회 sparse 생성, EEXIST 무시(멱등). |

### 패턴 3 — 이벤트 콜백 안의 동기 throw

| 파일:줄 | 판정 | 근거 |
|---|---|---|
| platform/guest/stream.ts:104 `writeSync` in `on("data")` | 기존(G13-01) | guesthost crash. |
| **platform/host/project.ts:104 `writeSync` in `on("data",take)` (getStream)** | **위반(X2-01)** | omahostd에 uncaughtException 핸들러 없음 → 프로세스 종료. |
| platform/host/project.ts:80 putStream `socket.write` in for-await | 부합 | write 반환값만 씀, throw 없음. drain 대기. |
| broker/connection.ts onData→receive, spool.append | 부합 | decoder.feed try/catch, raw 경로 INTERNAL_ERROR는 fatal()로 흡수. |
| platform/rpc.ts:64 receive() | 부합 | `parser.feed` try/catch, frameListeners는 동기 throw 안 함. |
| runtime/broker-supervisor.ts:229 `reader.push` in on("data") | 부합 | push는 버퍼 적재만. |
| platform/guest/session.ts:53,96 fromProgram/fromScreen in on("data") | 부합 | parser.feed try/catch(:120), socket.write는 throw 안 함. |
| runtime/egress-forwarder.ts:48 on("data") | 부합 | pipe 설정 뒤 데이터 경로는 pipe가 처리. |
| **entry/omahostd.ts, entry/runner.ts, entry/broker.ts, entry/guesthost.ts, entry/guestctl.ts, entry/guest-session.ts** | **참고(X2-01의 조건)** | `uncaughtException` 핸들러는 **entry/oma.ts:361 하나뿐**. 나머지 진입은 없음 → 이벤트 콜백 throw가 곧 프로세스 종료. |

### 패턴 4 — fire-and-forget promise

| 파일:줄 | 판정 | 근거 |
|---|---|---|
| broker.ts:161,176,249,256 `void ...catch(...)` | 부합 | 전부 .catch/.finally로 실패 처리, sweep 실패는 lastSweepFailure 기록. |
| entry/oma.ts:484,570 `void delivery.tick().then` | 부합 | tick 내부가 자체 정산·복구. |
| platform/host/lifecycle.ts:125,166,198 `void ...catch(()=>undefined)` | 부합 | 상태기계가 crashed/ready로 다시 관측. |
| storage/transaction.ts:28 `void value.catch(()=>undefined)` | 부합 | transaction 콜백이 promise 반환 시 방어(동기 tx 강제). |
| sandbox.ts:233 `void oid; void checkProfile` | 부합 | 미사용 변수 표식(타입 전용). |

### 패턴 5 — 여러 단계 효과 중간 실패

| 경로 | 판정 | 근거 |
|---|---|---|
| config/generations.ts commitManagedGeneration / commitInline | 부합 | publishGeneration→recordCommit(commit point 전)→manifest rename→dir fsync; unconfirmed 추적. P0V-61. |
| broker/openRun listenActor(tx 밖) | 기존(G03-r2-01) | 출발점 (d). |
| git/*, lifecycle/*, mail/* coordinator | 부합 | durable-boundaries.json의 reconcile/reject/unknown owner가 중간 상태 판정. |
| runtime/provision.ts ensureBareRepository→publishProjectBinding | 부합 | 각 게시가 staging→rename, collect* 가 잔재 회수. |

### 패턴 6 — 시계

| 파일:줄 | 분류 | 판정 | 근거 |
|---|---|---|---|
| storage/operation-transitions.ts / store.ts `updated_at_ms=MAX(?,created_at_ms)` | 기록 | 부합 | 역행해도 CHECK(updated>=created) 안 깨짐. 정렬엔 안 씀. |
| storage/ledger-reader.ts:28 주석 + ORDER BY name/topic/rowid | 순서 | 부합 | 순서는 rowid/name, 벽시계 아님. 명시적 규율. |
| broker/connection.ts:29, protocol/channel.ts:20, pi-rpc.ts:22 NODE_ALARMS | 기한 | 부합 | `performance.now()`(단조) + 재무장 + `Math.max(1,Math.min(0x7fffffff,·))` → 2^31 초과·suspend 안전. |
| runtime/broker-supervisor.ts:257 restart window `performance.now()` | 기한 | 부합 | MAC-650: 벽시계 역행 방어를 위해 단조 시계 사용(주석 명시). |
| runtime/principal-delivery.ts:133,214 acceptBy | 기한 | 부합 | `performance.now()`, `Math.max(0,·)`·`Math.min(waitMs,1000)`. |
| **platform/host/snapshot.ts:77 `statSync(...).mtimeMs` 정렬로 prune** | 순서→삭제 | 기존(G12-04) | 벽시계 mtime으로 keep/삭제 판정. |
| storage/status-view (views.ts:99 observedAtMs=Date.now) / status-refresh.ts | 기록 | 부합 | 관측 시점 기록. T118이 "reader 시계보다 앞선 view는 unknown"으로 처리. 효과 판정 아님. |
| platform/guest/provision.ts:103 `new Date().toISOString()` | 기록 | 부합 | instanceId 판정은 uuid, 시간은 표기용. |

### 패턴 7 — 자원 고갈

| 자리 | 판정 | 근거 |
|---|---|---|
| platform/host/project.ts getStream: take throw 시 fd(:96) 미반납 | 위반(X2-02, X2-01에 종속) | onData throw가 finally(:121) 우회. 프로세스가 죽으므로 커널이 회수하나, 죽기 전 누수. |
| broker/connection.ts pending/timers | 부합 | close()가 cancelTimers·releaseConnection·off(모든 리스너). |
| platform/rpc.ts pending Map, frameListeners | 부합 | end()가 pending 전부 reject, 피어 수명에 묶임(무한 성장 아님). |
| runtime/egress-forwarder open Set | 부합 | concurrent 상한, engine/upstream close에 delete. |
| stream.ts put `statfsSync` 사전검사 | 부합-불충분 | TOCTOU지만 그 자체는 방어 시도. 실패는 X2-01/G13-01(수신 중 ENOSPC). |

**커버리지 비고(줄 수는 `wc -l` 값):** durable-fs.ts(359, 끝줄 `}` fsyncTree), immutable-file.ts(216), staged-tree.ts(105), stream.ts(전체, receive 끝), project.ts(전체, getStream/putStream 끝 `return declared`), session.ts(전체, finish 끝), record.ts(전체), service.ts(전체), generations.ts(전체, collectTemporaries 끝), operation-transitions.ts(전체), status-refresh.ts(전체), snapshot.ts(전체, pruneSnapshots 끝), delivery-receipt.ts(해당 구간 395-455), store.ts(275-315), broker/connection.ts(15-125), protocol/channel.ts(15-55), platform/rpc.ts(40-130), broker-supervisor.ts(220-280), 각 entry/*.ts(전체). grep 후보는 위 표에 빠짐없이 반영.

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| X2-01 | High | resource | host getStream/putStream의 `writeSync`가 `on("data")`에서 uncaughtException으로 새어 omahostd를 죽인다 | confirmed(메커니즘) |
| X2-02 | Low | resource | X2-01 crash 시 getStream의 목적지 fd가 finally를 우회해 반납되지 않음 | high |
| X2-03 | Low | persistence | `writeInstance`가 데이터 디스크 instance record를 temp+rename 없이 최종 경로에 직접 쓴다 | high |

High 이상 1건, Medium 0건, Low 2건, Info 0건.

## 3. 발견 상세

### X2-01 host getStream/putStream의 writeSync가 on("data")에서 uncaughtException으로 새어 omahostd를 죽인다
- 심각도: High
- 분류: resource
- 위반 규칙: P0-4(자원 owner·프로세스 수명), P0-5(관측 실패/부분 수신을 프로세스 정지로 승격)
- 코드 경로: `src/platform/host/project.ts:101`(`const take = (chunk: Buffer): void => {`) → `:104`(`for (let at=0; at<chunk.length;) at += writeSync(fd, chunk, at, chunk.length-at);`) ← `:110`(`socket.on("data", take)`) ← `src/platform/host/service.ts`의 `exportProject`(getStream)·`archive`(getStream, kind="archive") ← `src/entry/omahostd.ts`(진입에 `process.on("uncaughtException")` 없음; 전체 grep상 핸들러는 `src/entry/oma.ts:361` 하나뿐, 이는 별개 프로세스).
- 원인: getStream은 host(omahostd)가 guest로부터 export bundle·archive.tar를 받아 `openSync(path, O_WRONLY|O_CREAT|O_TRUNC)`(`:96`)로 연 fd에 소켓 `data` 콜백 `take` 안에서 동기 `writeSync`로 쓴다. host의 transfer 디렉터리(`runDir/transfer`)가 수신 도중 가득 차거나(ENOSPC), quota 초과(EDQUOT), I/O 오류(EIO)면 `writeSync`가 throw한다. 이 throw는 감싸는 Promise executor의 reject로 가지 않는다 — Node는 libuv read 콜백에서 `data`를 emit하므로 이 예외를 잡을 JS 호출자가 스택에 없고, 곧장 프로세스 `uncaughtException`이 된다. omahostd 진입에 핸들러가 없어 Node 기본 동작으로 host 서비스가 종료된다. 이는 G13-01(guest stream.ts, guesthost)과 **동일한 모양의 다른 자리**로, host 쪽 export/archive 전송 경로다. putStream(`:80`)은 `socket.write`만 써서 같은 문제가 없다(write는 throw 대신 backpressure).
- 영향: host 서비스(VM 상태기계·guest link·egress·Host API)가 한 번의 디스크 부족/오류로 통째로 죽는다. 진행 중이던 archive/export가 unknown으로 끊기고, VM·재개는 launchd 재기동에 의존한다. "부분 수신이라는 관측 실패"가 "프로세스 정지"라는 광역 효과로 승격된다(P0-5).
- 최소 반례: `exportProject` 또는 `archive` 실행 중, host의 `runDir/transfer` 파일시스템 여유가 declared bytes 도중 0이 되는 경우(다른 쓰기·큰 export). 첫 `data` chunk의 `writeSync`가 ENOSPC로 throw → uncaughtException.
- 재현 방법: `node review/adversarial-2026-09-28/repro/X2-crash-durability-clock/ondata-throw-uncaught.mjs`. 실제 `net.Socket`으로 서버를 열고, project.ts getStream과 동일하게 `new Promise(...)` executor 안에서 `socket.on("data", take)`를 등록한 뒤 `take`가 `writeSync` 대신 ENOSPC를 던지게 했다. 관측: `promiseRejected: false` / `uncaughtException code: ENOSPC` / `RESULT: CONFIRMED — throw in on("data") escapes the Promise -> uncaughtException`. 실제 vsock+전용 디스크에서의 omahostd 종료 직접 관측은 macOS/커널 환경이 없어 못 했다(메커니즘·핸들러 부재는 소스로 확정).
- 확신도: confirmed(언어/런타임 메커니즘). 실기 통합 재현은 환경 부재로 미실행.
- 개선 방향: 스트림 수신을 이벤트 콜백 내 동기 syscall로 하지 않거나(pipeline/파이프 + 오류 이벤트 경로로 흡수), `take`의 syscall을 try/catch로 감싸 `reject`로 보내 Promise가 STREAM 오류로 정상 종료되게 한다. 아울러 host 진입(omahostd 등 oma.ts 외 모든 entry)에 uncaughtException/unhandledRejection 정책을 두어, 이벤트 콜백 throw가 조용히 프로세스를 죽이지 않게 한다(guest stream.ts와 공통 owner로).

### X2-02 X2-01 crash 시 getStream 목적지 fd가 반납되지 않음
- 심각도: Low
- 분류: resource
- 위반 규칙: P0-4(생긴 자원은 한 owner가 한 번 반납)
- 코드 경로: `src/platform/host/project.ts:96`(`const fd = openSync(...)`) → `:121`(`} finally { closeSync(fd); socket.destroy(); }`)
- 원인: `take`가 `on("data")`에서 throw하면 실행이 finally(:121)를 거치지 않고 uncaughtException으로 튄다(X2-01). 그 사이 `fd`와 부분 파일이 남는다.
- 영향: 프로세스가 어차피 죽으므로 커널이 fd·파일을 회수한다. 실질 누수는 프로세스 종료 전 순간에 국한. X2-01을 고치면(throw를 reject로) 이 finally가 다시 도달 가능해져 함께 닫힌다.
- 최소 반례: X2-01과 동일.
- 재현 방법: 추론만(X2-01 repro가 같은 제어흐름을 보인다).
- 확신도: high
- 개선 방향: X2-01의 try/catch→reject 수정으로 finally 경로 복원.

### X2-03 writeInstance가 instance record를 직접 쓰기로 게시
- 심각도: Low
- 분류: persistence
- 위반 규칙: 없음(정합. P0-4 관점의 견고성)
- 코드 경로: `src/platform/guest/provision.ts:100-105`(`writeFileSync(path, ...)` → 같은 path를 열어 fsync → 디렉터리 fsync)
- 원인: 데이터 디스크의 instance record(`INSTANCE_FILE`)를 temp+rename(no-replace) 없이 최종 경로에 `writeFileSync`로 직접 쓴다. `writeSync` 도중 SIGKILL/ENOSPC면 잘린/0바이트 파일이 남을 수 있다.
- 영향: `readInstance`(:90-98)가 `JSON.parse` 실패·`isUuid` 실패를 `STORE_CORRUPT`로 던진다. 즉 부분 파일은 "성공"이 아니라 손상으로 판정되어 unknown을 사실로 승격하지 않는다(fails-closed). 최초 provisioning 1회 경로라 재기록 충돌 여지도 작다. 그래서 위반이 아니라 견고성 지적이다.
- 최소 반례: 최초 부팅 provisioning 중 `writeInstance`의 write 도중 전원 차단 → 잘린 record. 다음 부팅 `readInstance`가 STORE_CORRUPT.
- 재현 방법: 추론만(데이터 디스크·부팅 경로 필요).
- 확신도: high
- 개선 방향: record.ts:writeHostRecord처럼 temp→fsync→rename→dir fsync로 게시(부분 파일이 손상으로도 남지 않게).

## 4. 리팩터링 필요 지점

- **스트림 수신의 단일 owner(P0-2).** guest `stream.ts:receive`와 host `project.ts:getStream`은 "소켓에서 declared bytes를 받아 sha256을 검증하며 fd에 쓴다"는 같은 결정을, 이벤트 콜백 내 동기 writeSync로 각자 구현한다(G13-01, X2-01이 그 결과). 한 수신 유틸(오류를 reject로 흡수, backpressure 처리)로 통일하면 두 crash가 함께 닫힌다.
- **파일 게시의 단일 owner(P0-2, G12 §4와 동일 결론).** record.ts(올바른 temp+rename+fsync), archive-crypto.ts(temp/rename 없음), snapshot.ts(fsync 없는 rename), provision.ts:writeInstance(직쓰기)가 "durable 파일 게시"를 서로 다른 강도로 구현한다. durable-fs의 `publishNoReplace`/`replaceDerivedFile` 계열로 통일 대상.
- **entry 프로세스의 실패 정책(P0-6).** uncaughtException 핸들러가 oma.ts에만 있고 broker/runner/omahostd/guesthost/guestctl/guest-session에는 없다. "이벤트 콜백 throw = 조용한 프로세스 종료"라는 같은 위험이 여러 진입에 있으므로, 프로세스 종료 정책을 한 개념으로 두는 편이 낫다.

## 5. 점검했고 문제없다고 판단한 것

- **DB 시계 역행(operation-transitions.ts, store.ts).** 모든 시간 UPDATE가 `MAX(?, created_at_ms)`라 `updated_at_ms < created_at_ms` CHECK를 벽시계 역행이 깨지 못한다(operation-transitions.ts:41,56,66,74; store.ts:308,313). 순서 판정은 시간이 아니라 rowid/name(ledger-reader.ts:28 주석·:65,71,80; store.ts:349 `ORDER BY rowid DESC`). insert는 created=updated=한 번의 Date.now()(P0V-56). 시나리오: `Date.now`를 과거로 monkeypatch한 update 2회 → CHECK 유지, 정렬 불변.
- **타이머 경계값(NODE_ALARMS·channel.alarm·pi-rpc).** `!Number.isFinite||<=0`은 RangeError로 거절(connection.ts:26). 남은 시간은 `Math.max(1, Math.min(0x7fffffff, remaining))`로 클램프하고 deadline까지 재무장하므로, 2^31ms 초과 deadline이 Node의 1ms 폴백으로 조기발화하지 않고, `performance.now()`가 단조라 NTP·suspend에도 duration이 늘어지지 않는다(broker-supervisor.ts:257 MAC-650 주석과 정합).
- **broker 재시작 window 역행(broker-supervisor.ts:257-268).** `performance.now()`로 window를 재므로 벽시계 역행이 오래된 재시작을 window 안에 붙잡아 broker를 포기시키지 못한다.
- **broker/connection·platform/rpc 프레임 파서 throw.** onData가 `parser.feed`를 try/catch로 감싸 close/fatal로 흡수(connection.ts, rpc.ts:64). 시나리오: 잘린/거대 프레임 주입 → 예외가 프로세스로 새지 않고 연결만 닫힘.
- **config generation 다단계 crash(generations.ts).** publishGeneration→recordCommit(commit point 전, P0V-61)→manifest rename→parent fsync, flush 실패는 unconfirmed로 다음 edit이 재검. 모든 rename은 `withinDirectory` 아래. commit point 후 죽어도 manifest가 진짜 owner라 부분 generation이 current로 안 읽힘.
- **status-refresh/status-view 시계.** observedAtMs는 관측 시점 기록이고 효과 판정이 아니다(WP23). budget 초과는 unknown snapshot 반환(P0-5). T118이 reader 시계보다 앞선 view를 unknown 처리.
- **guest archive 부분 산출물(archive.ts).** tar `--file staged` 직쓰기지만 완료 owner는 원장 outcome(requests.ts publishNoReplace)이라 부분 tar가 완성본으로 승격되지 않는다(G13 §5와 동일 결론, 재확인).

## 6. 확인하지 못한 것

- X2-01의 실제 vsock 브리지 + 전용 데이터 디스크 ENOSPC 하에서 omahostd 종료를 직접 관측: macOS/커널·전용 디스크 환경이 없어 언어 메커니즘 재현으로 대신(핸들러 부재·제어흐름은 소스로 확정, AUDIT-BRIEF §절대규칙상 systemd/네트워크 금지).
- X2-03의 부팅 provisioning 경로에서의 실제 잘린 record: 데이터 디스크·게스트 부팅 환경 필요.
- snapshot.ts fsync/mtime 계열은 macOS APFS clonefile 특성에 의존하며 이미 G12-02/G12-04가 소유. 본 그룹은 mtime을 "순서 판정에 벽시계"로 재확인만 하고 새 ID를 만들지 않았다.
