# G13-platform-guest 적대적 검증 결과

저장소 `/home/dev/oma-v2`, branch `feat/macos-hidden-vm`, HEAD `070a52d`. 코드 미수정.
`dist/`는 HEAD 빌드를 그대로 사용. 재현 스크립트는
`review/adversarial-2026-09-28/repro/G13-platform-guest/` 아래에 있으며 실제로 실행했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막 읽은 줄 · 내용 앞 20자) |
|---|---|---|---|
| src/platform/guest/archive.ts | 60 | 예 | 60 `  }\n}` (finally rmSync … 끝) |
| src/platform/guest/control.ts | 139 | 예 | 139 `}` (GuestControl.serve 끝) |
| src/platform/guest/egress.ts | 116 | 예 | 116 `}` (serve finally host.destroy 끝) |
| src/platform/guest/host.ts | 171 | 예 | 171 `}` (terminal() screen.on error 끝) |
| src/platform/guest/identity.ts | 50 | 예 | 50 `}` (readGuestIdentity return 끝) |
| src/platform/guest/linux-system.ts | 144 | 예 | 144 `}` (`receiptWaitFloor: () =>` 끝) |
| src/platform/guest/project.ts | 109 | 예 | 109 `}` (export() return 끝) |
| src/platform/guest/provision.ts | 106 | 예 | 106 `}` (writeInstance dir fsync 끝) |
| src/platform/guest/pty.ts | 78 | 예 | 78 `}` (setWindowSize TIOCSWINSZ 끝) |
| src/platform/guest/requests.ts | 83 | 예 | 83 `}` (status() return 끝) |
| src/platform/guest/server.ts | 147 | 예 | 147 `}` (safeRefuse catch 끝) |
| src/platform/guest/session.ts | 175 | 예 | 175 `}` (finish() endListeners 끝) |
| src/platform/guest/stream.ts | 116 | 예 | 116 `});\n}` (receive() socket.resume 끝) |
| src/platform/guest/systemd-launcher.ts | 55 | 예 | 55 `}` (stop() return 끝) |
| src/entry/guestctl.ts | 44 | 예 | 44 `});` (startGuestServer.then 끝) |
| src/entry/guesthost.ts | 76 | 예 | 76 `});` (startGuestServer.then 끝) |
| src/entry/guest-provision.ts | 44 | 예 | 44 `main().catch(...)` |
| src/entry/guest-session.ts | 61 | 예 | 61 `});` (session.onEnd 끝) |
| platform/guest/bridge/oma-vsock-bridge.c | 114 | 예 | 114 `}` (main return status 끝) |
| platform/guest/environment.d/60-oma-egress.conf | 6 | 예 | 6 `OMA_EGRESS_SOCKET=…oma-egress.sock` |
| platform/guest/systemd/oma-control@.service | 19 | 예 | 19 `RestrictAddressFamilies=AF_UNIX AF_VSOCK` |
| platform/guest/systemd/oma-control.socket | 13 | 예 | 13 `WantedBy=sockets.target` |
| platform/guest/systemd/oma-guestctl.service | 26 | 예 | 26 `WantedBy=multi-user.target` |
| platform/guest/systemd/oma-guesthost.service | 26 | 예 | 26 `WantedBy=multi-user.target` |
| platform/guest/systemd/oma-provision.service | 18 | 예 | 18 `RequiredBy=oma-guestctl.service …` |
| platform/guest/systemd/oma-society@.service | 20 | 예 | 20 `RestrictAddressFamilies=AF_UNIX AF_VSOCK` |
| platform/guest/systemd/oma-society.socket | 11 | 예 | 11 `WantedBy=sockets.target` |
| platform/guest/sysusers.d/oma.conf | 9 | 예 | 9 `u oma-bridge - "OMA host bridge" …` |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G13-01 | High | resource | stream.put 수신 중 writeSync 실패(ENOSPC/EIO/EDQUOT)가 data 리스너에서 uncaughtException으로 새어 guesthost 프로세스를 죽인다 | confirmed |
| G13-02 | Low | boundary | bundleObjectFormat이 헤더 앞 4096바이트만 읽어 그 밖에 있는 `@object-format=`을 sha1로 오독한다(뒤에서 git verify가 backstop) | confirmed |
| G13-03 | Low | race | stream.get이 source를 두 번 열어(해시 1회, pipe 1회) 사이에 same-uid 교체가 가능하다(host가 sha256으로 backstop) | high |
| G13-04 | Low | resource | systemd-launcher.start의 `--unit=` 재사용: 소켓이 뜨지 않은 채 남은 unit이 재시작을 막는다(운영 복구 필요) | medium |

## 3. 발견 상세

### G13-01 stream.put 수신 중 writeSync 실패가 uncaughtException으로 새어 guesthost를 죽인다
- 심각도: High
- 분류: resource
- 위반 규칙: P0-4(자원 owner: guesthost 프로세스가 자기 listener/자식/소켓의 owner인데 예외 한 번으로 전부 사라진다), P0-5(디스크 실패라는 unknown이 프로세스 종료로 승격)
- 코드 경로: `src/platform/guest/stream.ts:96`(`const onData = (chunk) => { … for (let at=0; at<chunk.length; ) at += writeSync(fd, chunk, at, chunk.length-at); … }`) ← `stream.ts:110`(`socket.on("data", onData)`); 진입 `stream.ts:33`(`serveStream`의 try/catch는 `readLeadingFrame` await만 감싼다) ← `src/entry/guesthost.ts:70`(`stream: { … serve: socket => { void serveStream(socket, …) } }`). guesthost 진입에 `process.on("uncaughtException")` 없음(`src/entry/guesthost.ts` 전체; grep 결과 uncaughtException 핸들러는 `src/entry/oma.ts:361`뿐, 이는 별도의 session 프로세스다).
- 원인: `receive()`는 소켓 `data` 이벤트 콜백 `onData` 안에서 동기 `writeSync`를 호출한다. 데이터 디스크가 수신 도중 가득 차거나(ENOSPC), quota 초과(EDQUOT), I/O 오류(EIO)가 나면 `writeSync`가 throw한다. 이 throw는 `finish(error)` 경로를 타지 않는다 — Node가 libuv read 콜백에서 `data`를 emit하므로 스택에 이 예외를 감쌀 JS 호출자가 없고, `serveStream`의 try/catch는 이미 반환된 뒤다(첫 프레임 await만 감쌌다). 따라서 프로세스 수준 `uncaughtException`이 되고, 핸들러가 없어 Node 기본 동작으로 guesthost가 종료된다. put 전 `statfsSync` 사전검사(`stream.ts:59`)는 TOCTOU라 동시 쓰기·다른 society의 쓰기로 뚫린다.
- 영향: host가 project.import용 bundle을 스트리밍하는 동안(또는 archive.tar를 stream.get으로 내보내는 것과 무관하게 put 경로) 데이터 디스크가 차 있으면 society 채널·terminal·egress·stream을 모두 서비스하는 guesthost 단일 프로세스가 죽는다. 실행 중인 society session들은 자기 user unit으로 살아남지만(설계상 의도) egress pool·진행 중 스트림은 끊기고, host는 응답 손실을 unknown으로 본다. `Restart=on-failure`(oma-guesthost.service:19)로 재기동되나 진행 중이던 모든 연결이 끊긴 뒤다. 공격자가 데이터 디스크를 채운 상태를 유지하면 put마다 재크래시가 가능하다.
- 최소 반례: 데이터 디스크의 여유가 `reserveBytes(1GiB)`+선언 bytes 사전검사는 통과할 만큼 있으나 실제 수신 도중 다른 쓰기로 0이 되는 경우, 또는 사전검사와 수신 사이에 디스크가 차는 경우. 첫 `data` chunk의 `writeSync`가 ENOSPC로 throw.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G13-platform-guest/stream-writesync.mjs`. `receive()`의 `onData` 제어흐름을 그대로 옮기고 `writeSync` 자리에 ENOSPC를 던지는 함수를 두되, 실제 소켓처럼 `data`를 `setImmediate`(JS 호출자 없는 지점)에서 emit했다. 관측: `UNCAUGHT EXCEPTION escaped: ENOSPC: no space left on device, write` / `RESULT: a mid-stream writeSync failure becomes an uncaught exception (process crash)`. 대조로 try/catch가 감싸는 동기 emit에서는 잡힌다(첫 판에서 확인) — 즉 실제 소켓 경로에서만 새는 것이 핵심이다.
- 확신도: confirmed(메커니즘 재현). 실제 vsock·디스크 full 통합 재현은 환경이 없어 하지 않음(§6).
- 개선 방향: `receive()`의 쓰기·해시 갱신을 try/catch로 감싸 실패를 `finish(error)`로 라우팅해 STREAM/STORAGE 계열 refusal로 만들고 staging을 정리하게 한다. 또는 guesthost 진입에 마지막 방어선으로 프로세스 수준 핸들러를 두되(연결만 정리) 근본은 리스너 안 동기 I/O 예외 격리다.

### G13-02 bundleObjectFormat이 헤더 앞 4096바이트만 읽어 그 밖의 `@object-format=`을 sha1로 오독한다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음(뒤에서 git이 backstop)
- 코드 경로: `src/platform/guest/project.ts:44`(`const head = Buffer.alloc(4096); const count = readSync(fd, head, 0, head.length, 0);`) → `project.ts:48`(`const declared = lines.find(line => line.startsWith("@object-format="));`) → `project.ts:49`(`const format = declared === undefined ? "sha1" : …`)
- 원인: v3 bundle 헤더의 `@object-format=` 줄이 앞 4096바이트 밖에 있으면(참조 목록이 매우 길거나 조작된 헤더) 발견하지 못하고 sha1로 판정한다.
- 영향: 실전에서는 낮다. 오판 뒤 새 mirror는 `git init --object-format=sha1`이 되고 sha256 bundle의 `git bundle verify`가 실패(BUNDLE_INVALID)하며, 기존 mirror는 `--show-object-format` 대조(`project.ts:90`)에서 BUNDLE_INVALID로 걸린다. 정상 git v3 bundle은 `@object-format`을 헤더 첫 줄들에 두므로 걸리지 않는다. durable fact 오염은 없고 잘못된 거절만 가능.
- 최소 반례: 첫 줄 `# v3 git bundle`, 그 뒤 4096바이트를 채우는 padding, 그다음 `@object-format=sha256`.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G13-platform-guest/bundle.mjs`. 관측: `1) @object-format beyond 4096 bytes read as: sha1 <-- MISREAD (declared sha256)` / `2) @object-format within window: sha256`.
- 확신도: confirmed
- 개선 방향: bundle 헤더를 빈 줄(헤더 종료)까지 읽어 format 줄을 찾는다. 또는 format 판정을 오직 git(`rev-parse --show-object-format`/verify)에만 맡긴다.

### G13-03 stream.get이 source를 두 번 열어 사이에 same-uid 교체가 가능하다
- 심각도: Low
- 분류: race
- 위반 규칙: 없음(host가 sha256으로 backstop)
- 코드 경로: `src/platform/guest/stream.ts:80`(`size = statSync(source).size`) → `stream.ts:82-83`(`for await (const chunk of createReadStream(source)) hash.update(chunk)`) → `stream.ts:85`(`createReadStream(source).pipe(socket)`)
- 원인: 크기·sha256을 계산한 파일과 실제로 pipe하는 파일이 서로 다른 open이다. staging 파일은 oma uid 소유이고 FS-005 모델상 같은 uid의 다른 프로세스가 그 사이에 교체할 수 있다. 세 번의 관측이 원자적이지 않다.
- 영향: 낮다. host는 프레임으로 받은 bytes/sha256(첫 읽기 산물)과 실제 수신 바이트를 대조하므로 교체가 일어나면 host 측 검증이 실패(안전한 거절)한다. 조용한 손상은 없다. 다만 same-uid 적대 프로세스가 있는 위협 모델에서 무결성은 host 검증에만 의존한다.
- 최소 반례: get 처리 중 `statSync`~두 번째 `createReadStream` 사이에 oma uid 프로세스가 staging 파일을 다른 내용으로 교체.
- 재현 방법: 추론만. 코드 줄로 세 번의 독립 open을 확인. 시간창 재현은 same-uid 경쟁 프로세스가 필요.
- 확신도: high
- 개선 방향: 한 번 열어(fd) 그 fd로 크기·해시·전송을 모두 수행하거나(O_NOFOLLOW로 fstat+fd 기반 read), get이 create가 원장에 기록한 sha256과 대조한 뒤 전송한다.

### G13-04 systemd-launcher.start의 unit 이름 재사용이 소켓 미기동 잔재로 막힐 수 있다
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음
- 코드 경로: `src/platform/guest/systemd-launcher.ts:29`(`const unitOf = (society) => \`oma-session-${society}\``) → `systemd-launcher.ts:34-42`(`systemd-run --user --unit=${unitOf(society)} --collect …`) → 미기동 시 `systemd-launcher.ts:44-47` 10초 폴링 후 BROKER_UNAVAILABLE
- 원인: `--collect`는 실패·비활성 unit을 GC하지만, `systemd-run`이 unit을 만들고 프로세스가 떴으나 소켓 리스닝 전에 죽지 않고 활성으로 남으면 같은 이름의 재시작이 "unit already exists"로 거절될 수 있다. 두 host 연결이 동시에 같은 society를 open할 때도(각 연결이 독립 `serveRequests` 체인) `listening` 사전검사를 둘 다 통과한 뒤 둘째 `--unit=`이 실패한다.
- 영향: 잘못된/일시적 거절(BROKER_UNAVAILABLE, retry same-key). durable fact 오염 없음. 드물고 운영 복구(unit reset)로 풀린다.
- 최소 반례: society open이 unit은 등록했으나 guest-session이 소켓 listen 전에 멈춘 상태에서 재open.
- 재현 방법: 추론만. systemd 필요(브리프상 systemctl 금지).
- 확신도: medium
- 개선 방향: start 전 기존 동명 unit의 상태를 관측해 stale이면 reset하거나, unit 인스턴스 이름에 boot/attempt 식별자를 붙여 잔재와 구분한다.

## 4. 리팩터링 필요 지점
- `sha256`/`sha256File` 스트리밍 해시가 archive.ts, project.ts, stream.ts에 세 번 거의 동일하게 있다(archive.ts:16, project.ts:32, stream.ts get 경로). 한 owner로 모으면 "선언 bytes/sha256을 언제 무엇에 대해 검증하는가"의 단일 판정이 가능해진다(P0-2). 지금은 검증 시점(create 후 vs get 시 재계산 vs import 전 재검증)이 파일마다 흩어져 있다.
- staging 산출물(archive.tar, export.bundle, bundle)의 게시가 "temp에 쓰고 이름을 마지막에 원자적으로 publish"(MAC-1030 근방 host 규범)와 다르게 최종 staging 경로에 직접 쓴다(archive.ts tar `--file staged`, project.ts export bundle `create … staged`, stream.ts put O_EXCL 직쓰기). guest는 outcome 원장(requests.ts publishNoReplace, temp+rename+fsync)이 완료 신호의 owner라 부분 산출물이 완성본으로 승격되지는 않지만(§5 참조), 게시 규율을 원장과 별개로 파일에도 통일하면 G12-01류의 재발 여지가 준다.

## 5. 점검했고 문제없다고 판단한 것

1. **vsock bridge C 메모리 안전성(oma-vsock-bridge.c 전체).** `connect_service`(56–65)는 `strcpy` 전에 `strlen(path) >= sizeof address.sun_path`로 막고(NUL 여유 포함), `write_all`(68–75)은 부분쓰기·EINTR를 처리, `relay`(79–102)는 poll 기반으로 EINTR/EAGAIN 재시도·half-close(shutdown SHUT_WR) 전달, `read`/`write` 모두 fd를 close(107,110–112). `atoi` 없음, 인자 파싱은 `strtol`을 LISTEN_PID에만 쓰고 `*end=='\0'`로 완전소비 확인(41). `-Wall -Wextra -O2` 무경고 컴파일. `bridge-args.sh` 실행: 인자 0/1개·LISTEN_FDS≠1·LISTEN_PID 불일치·초과길이 경로 모두 usage(2)로 안전 종료, 크래시 없음.
2. **어느 CID의 연결이든 받는지(oma-vsock-bridge.c:47–54).** `peer_is_host`가 `getpeername` 실패·길이 부족·`svm_family!=AF_VSOCK`이면 -1(식별 불가), CID가 `OMA_ALLOWED_CID`(=VMADDR_CID_HOST=2)가 아니면 0을 돌려 `main`(105–110)이 close(3)로 unread 거절. kernel의 vsock loopback 미탑재(MAC-204)가 2차 방어. socket unit들도 `RestrictAddressFamilies=AF_UNIX AF_VSOCK`, `CapabilityBoundingSet=`(비움), `NoNewPrivileges=yes`로 브리지 권한을 최소화.
3. **peer 인증(server.ts:74–79, guest-session.ts:38–43).** guestctl/guesthost 서버는 소켓 mode가 아니라 `SO_PEERCRED`(peerCred)로 브리지 uid만 답하고(FS-005/AUTH-003 명시), 그 외 uid는 unread destroy. socket 파일은 root:oma-bridge 0660(server.ts:64–66) / guest-session은 0600. sysusers가 oma·oma-bridge를 분리해 oma 프로세스가 브리지 소켓을 열어 host를 사칭하지 못하게 한다.
4. **request key 멱등·crash 창(requests.ts 전체, MAC-240/241).** intent를 효과 **전에**, outcome을 **후에** `publishNoReplace`(temp+rename+dir fsync, durable-fs.ts:180)로 no-replace 게시. 같은 key+다른 내용은 REQUEST_KEY_REUSED, 같은 요청 재시도는 outcome에서 응답, intent만 있으면 재실행(효과가 멱등: import는 verify 후 fetch, archive는 tar 재생성). 일시 오류(INTERNAL_ERROR/BROKER_UNAVAILABLE/STORAGE_FULL)는 outcome을 남기지 않아 다시 실행(P0-5). 손상 intent는 STORE_CORRUPT. `ledger.mjs` 실행으로 사례 1–5 모두 기대대로 확인(재실행 없음, outcome 손실 시 재실행, 다른 내용 거절, 일시오류 outcome 미기록, 절단 intent STORE_CORRUPT).
5. **archive 게시의 G12-01 대응(archive.ts:41–58, stream.ts:78–86, host.ts:150–156).** host G12-01은 `existsSync`가 부분 파일을 완성본으로 승격한 것이었다. guest는 완료 신호의 owner가 파일 존재가 아니라 **원장 outcome**이다: `archive.create`는 tar→sha256을 다 계산한 뒤에야 outcome을 남기고, host는 MAC-241대로 응답 손실 시 `request.status`로 조회해 outcome이 있을 때만 `stream.get`을 부른다. tar 도중 죽으면 outcome이 없어 재시도가 `--file staged`를 O_TRUNC로 다시 쓴다. 따라서 부분 archive.tar가 완성본으로 승격되지 않는다. (파일 게시 규율 자체는 §4 리팩터링으로 남김.)
6. **REC-007 원장 경계(archive.ts, project.ts, requests.ts 주석·host.ts).** guest 원장은 guesthost 자신의 것이고 society의 Store(broker가 유일 writer)에 쓰지 않는다. archive는 DB를 열지 않고 파일만 tar한다(archive.ts 헤더), §8.4 "멈춰 있을 때만"은 host.open이 `archiving` set으로, archive.create가 `running(society)` 검사(archive.ts:47)로 이중 방어. WAL을 포함해 정지 상태의 파일을 뜬다.
7. **tar 경로 탈출(restore).** guest 할당 파일에 tar extract/restore가 없다(grep `extract|-x|restore|untar` 무결과). restore는 host측(G12)이라 이 그룹 판정 대상 아님.
8. **freeze deadline·unknown(control.ts:64–101).** receiptWaitFloor가 unknown이면 freeze를 거부(P0-5), deadline은 항상 타이머로 끝나고 프로세스 종료 시 release()가 즉시 thaw(ExecStopPost의 `--thaw`가 SIGKILL·크래시까지 커버, guestctl.service:14). 시계 역행 관련: setTime은 양수 정수만.
9. **egress 우회(egress.ts, 60-oma-egress.conf).** 이 그룹 파일에는 프록시 허용목록·NO_PROXY/http_proxy 처리 로직이 없다(그건 runtime/egress-forwarder·sandbox 소관). 여기 egress.ts는 host가 미리 연 연결 pool을 중계할 뿐이고, park된 연결에 무엇이든 도착하면 broken으로 destroy(egress.ts:26–32), request key가 오면 destroy(egress.ts:106). conf는 `OMA_EGRESS_SOCKET` 한 줄만 export.
10. **pty/session 자원(pty.ts, session.ts, guest-session.ts).** master는 O_CLOEXEC로 열어 자식이 상속하지 못하게 하고 slave는 spawn 후 즉시 close(session.ts start finally). 한 화면만 attach, takeover는 이전 화면에 detached 통지(session.ts attach). backlog 초과 화면은 drop(session.ts fromProgram). 종료 신호는 HOST_LOSS_SIGNALS로 받아 program에 SIGTERM 전달 후 종료(guest-session.ts), 소켓 unlink.
11. **provision 멱등·부분 프로비저닝(provision.ts, guest-provision.ts).** format은 오직 `provision==instance && 전 디바이스 0` 일 때만(provision.ts:35–40), blkid exit 2+stderr 없음만 "파일시스템 없음", 그 외는 BROKER_UNAVAILABLE(P0-5, provision.ts:88–99). 마운트 후 instance 기록 대조(instanceCheck). writeInstance는 파일·디렉터리 fsync(provision.ts:104–106). society 이름은 `^[a-z][a-z0-9-]{0,31}$`(ACTOR_NAME_RE)라 unit `@`/경로/셸 메타 주입 불가, argv는 execve 직접 전달(셸 없음).

## 6. 확인하지 못한 것
- G13-01의 실제 vsock+데이터 디스크 ENOSPC 통합 재현: vsock·전용 디스크 환경이 없어 메커니즘 모델 재현으로 대신했다(제어흐름·핸들러 부재는 소스로 확정). 실기에서 guesthost 종료를 직접 관측하려면 kernel/systemd 환경이 필요(브리핑상 금지).
- systemd unit의 실제 기동·socket activation(Accept=yes per-connection instance) 동작, linger·user@1000 의존: systemctl 금지로 정적 검토만.
- G13-04의 unit 재사용 경쟁: systemd 필요로 추론만.
- koffi 네이티브 경로(linux-system.ts clock_settime/ioctl, pty.ts posix_openpt 등)의 인자 marshalling은 Linux+koffi 로드가 필요해 정적으로만 검토.
- host↔guest 실제 프레임 왕복(server.ts handshake, FramedPeer)의 런타임 경계는 통합 환경 없이 소스로만 확인.
