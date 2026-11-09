# Darwin gate 판정표

[native 명세](../macos-native-spec.md)의 세 gate를 요구 항목별로 증거와 대조한다. 판정은 다음 셋 중 하나다.

- **닫힘**: 해당 반례를 실제 Darwin 관측이나 제품 경로가 직접 거절한다.
- **부분**: primitive는 확인됐지만 제품 조립이나 일부 반례가 남았다.
- **열림**: 증거가 없다.

gate 전체는 모든 항목이 닫혀야 PASS다. `scripts/verify-native.mjs`의 OPEN 판정은 이 표가 전부 닫힐 때까지 바꾸지 않는다. 기준 source는 네 runtime job이 처음 전부 success였던 `f2e466b7c23`이다([validation](validation.md)). gate 관측은 darwin-gates의 각 OS 3회 120 case다.

## G-FILES

| 요구 항목(명세 6절) | 증거 | 판정 |
|---|---|---|
| directory-relative open/list/effect, no-follow·beneath | gate `files`: beneath 탈출 errno 107, symlink errno 62, 교체 뒤 held root 유지, held directory lock 0. 공통 suite의 owned-directory·durable-fs 시험(세 Mac success) | 닫힘 |
| regular entry pin/repair, mode-000 | gate `files`: mode-000 pin EACCES(13)는 unknown으로 남고, held inode repair는 0. FIFO event pin 확인. owned-directory 001–009 | 닫힘 |
| `/dev/fd` duplicate·descriptor exec 반례 | gate `file-descriptors`: duplicate는 같은 inode에 cursor를 공유한다. FD exec는 swap 전후와 unlink 뒤 모두 errno 13이다. 제품은 이 경로를 쓰지 않는다 | 닫힘(반례를 배제로 판정) |
| 독립 read cursor | 기존 readable FD의 positioned I/O 또는 private verified copy를 쓴다. gate `file-descriptors`의 공유 cursor 반례를 대체 경로로 쓰지 않는다 | 부분: 제품 호출자별 capability 목록이 아직 없다 |
| exact executable | gate `suspended-image`: 정지 image A/B 양성과, B를 map한 뒤 경로를 A로 되돌린 반례를 release 전에 거절한다. `launchd-image`: `SpawnConstraint.cdhash` 단독 결박은 배제된다. 제품 `darwin-job-control`은 정지 target의 audit origin cdhash를 설치본 bytes에서 계산한 hash와 대조하고, 불일치면 release하지 않는다. `native-runtime-generation` 001은 private Node와 의존성을 봉인한 generation을 쓴다(세 Mac) | 부분: main image만 결박한다. script·module·library bytes는 봉인된 generation이 보증하고, loader context와 PID 재사용 대조는 G-AUTH와 함께 남는다 |
| no-replace publish와 parent flush | gate `files`: link publish 성공, 중복 link EEXIST(17), directory flush 0. durable-fs 시험(세 Mac) | 닫힘 |
| Seatbelt 경로 정책 | gate `seatbelt-files`: writable·readonly·denied, symlink·hardlink 거절, 보호 parent pin. 제품 Worker probe의 private read 거절·shared write 거절(세 Mac) | 닫힘 |
| Society lock과 fence 수명 | Society 소유권 12/12(세 Mac): Host SIGKILL 뒤 takeover 거절, 실행 범위 전체 사망까지 fence 유지, 충돌 port 거절 | 닫힘 |
| 외부 writer(SQLite·Git)의 root 결박 | Git quarantine은 정지 scope에서 검증한 뒤 import한다(gate `git-setup-quarantine`, 제품 009). SQLite는 Broker가 소유한 state root 아래에 있다 | 부분: validation이 남긴 StateRoot capture, private work/source fetch, 진단 writer 결박과 수명 인수가 남았다 |

G-FILES 판정: **OPEN**. 남은 항목은 독립 cursor의 호출자별 capability 목록, main image 밖 bytes의 결박 근거 정리, 외부 writer 결박 세 가지다.

## G-AUTH

명세 5절의 다섯 질문을 각각 판정한다: 실제 sender, 그 process가 살아 있는지, 현재 run 소속, 기대한 Broker, 현재 권한. 반례는 선점·교체·전달·PID 재사용이다.

| 요구 항목 | 증거 | 판정 |
|---|---|---|
| 실제 sender(메시지별) | gate `mach-self`·`mach-rendezvous-live`·`mach-rendezvous-exit`: kernel audit trailer의 PID가 메시지마다 실제 송신자를 가리킨다. 주장한 PID와 다른 holder가 보낸 두 번째 메시지도 holder로 나온다 | 닫힘 |
| Unix peer credential을 메시지 origin으로 쓰지 않음 | gate `queued-transfer`·`socket-transfer`: 연결자가 살아 있거나 죽은 뒤에도 peer 조회는 현재 holder를 답한다. 그래서 queued·인계된 메시지의 origin 증거가 아니다. 제품의 actor 경로는 Mach audit trailer를 쓴다 | 닫힘(배제) |
| 살아 있는 그 process, PID 재사용 | gate `mach-token-control`: pidversion이 다르면 ESRCH, genuine token만 신호한다. `mach-stream-stale`: 송신자가 죽은 뒤 받은 메시지의 audit binding을 거절한다 | 닫힘 |
| 인계·전달 반례 | gate `mach-stream-handoff`: 다른 process로 넘어간 endpoint의 bytes 0, audit binding 거절. `mach-audit-async`: 취소된 binding 거절, 선택한 image 불일치는 unavailable | 닫힘 |
| 기대한 Broker(Host→Broker) | Society 소유권 012: Host는 자기 Broker child를 private child identity로 Mach에 연결하고, non-child나 반환된 identity를 거절한다. 제품 005: Principal engine→Broker Mach 인증 호출(세 Mac) | 닫힘 |
| 현재 run 소속과 현재 권한 | 제품 008: Broker SIGKILL 뒤 재시작한 generation에서 계속 동작한다. 011: 엔진 사망 뒤 scope 종료가 확인돼야 재전달한다. 상속 FD는 명시 채널만 남는다(gate `seatbelt-kept-fds`) | 부분: Broker 재시작 뒤 같은 Principal이 새 generation에 현재 권한으로 닿는 제품 시험 013 추가(판정 대기). 실제 sleep/wake는 [NATIVE-006](../macos-platform.md)상 CI 밖 미검증 범위다 |
| 서명 Keychain | 명세 9절: scripted credential은 signed Keychain·잠김/TCC 검증이 아니다 | 열림: release 서명 Keychain·SIP 검증이 없다. NATIVE-006은 서명 Keychain·TCC를 CI의 scripted credential과 다른 별도 미검증 범위로 둔다. 실제 서명 release와 물리 Mac이 필요하다 |

G-AUTH 판정: **OPEN**. 남은 항목은 sleep을 포함한 restart 뒤 current capability 반례와 release 서명 Keychain·SIP 검증이다.

## G-PROCESS

| 요구 항목(명세 4.3) | 증거 | 판정 |
|---|---|---|
| fork·setsid 후손 종료 | 제품 011: Seatbelt Worker 엔진을 SIGKILL하면 새 session의 detached 후손도 끝난다(세 Mac). gate `process`: process group kill만으로는 setsid 후손이 살아남는다. 제품은 group이 아니라 coalition으로 scope를 잡는다 | 닫힘(제품 경로) |
| leader·runner·broker·host SIGKILL | 제품 008(Broker), 011(엔진 leader). Society 소유권 002·007·008·010(Host·실행 owner SIGKILL, 실행 범위 유지·회수) | 닫힘: 제품 012(runner SIGKILL 뒤 엔진 scope·detached 후손 종료, 그 뒤에만 재전달)가 세 Mac에서 PASS(`0cd1849aeab`) |
| PID/ID 재사용 | gate `mach-token-control`(pidversion), coalition ID는 재사용되지 않는다(명세 4.2의 XNU 근거, `launchd-scope` 관측) | 닫힘 |
| restart와 재전달 | 제품 011: scope 종료 뒤에만 새 엔진으로 재전달한다. 008: Broker 재시작 | 닫힘 |
| populated/empty/unknown producer | coalition `coalition_info_resource_usage`: 성공이면 populated, ESRCH이면 empty, 그 밖에는 unknown이다(`audit-session.ts`). storage 003은 unknown 사망을 원본 보존으로 처리한다 | 닫힘 |
| scope 밖 실행 경로 | gate `launchd-scope`: 제품 Seatbelt 프로필만 적용하면 기존 GUI service가 다른 coalition에서 unsandboxed로 실행된다. 제품 job helper는 target의 bootstrap port를 응답 없는 discard sink로 바꾼다(`job-helper/main.c`). 명세 4.2: 제한된 bootstrap endpoint는 두 OS 각 3회 service 두 경로를 막았다 | 열림: 제품 조합(sink·Seatbelt·job helper)에서 이 반례를 직접 거절한 관측이 없다. 권한 재취득·manual CLI·GUI 부재도 미검증이다 |

G-PROCESS 판정: **OPEN**. 핵심은 scope 밖 실행 경로다. 이 반례가 제품 조합에서 막힌다는 직접 관측이 필요하다.
