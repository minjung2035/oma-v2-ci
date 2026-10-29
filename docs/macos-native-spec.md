# macOS native 전환 명세 — 공통 제품과 검증된 OS 경계

2026-10-28 전면 개정. 사용자 목표는 **VM 없이 Mac·Linux에서 같은 제품을 실행하고, 업무 로직은 TypeScript로 공유하며, 기존 기능·데이터·권한을 보존하는 것**이다. 특정 Linux primitive의 복제나 기존 spec의 구현 가정 자체는 목표가 아니다.

이 문서는 구현 방향과 미결정 항목을 소유한다. 규범은 [macos-platform](macos-platform.md), 변경 이유는 [DR61](design-revisions.md#dr61--native-전환은-제품-보장과-구현-후보를-분리한다), 실제 결과는 [validation](implementation/validation.md), 재개점은 [HANDOFF](HANDOFF.md)를 따른다. [개정 전 원문](archive/macos-native-spec-2026-10-28-pre-redesign.md)은 역사 자료다. 개정은 미구현 기능의 완료나 보안 계약 완화를 뜻하지 않는다.

## 1. 범위와 불변식

- Society·Personal·Principal/Worker·manual CLI·Pi 도구·mail·Git/checks·review·설정/package·history·Restic backup/restore를 끝까지 연결한다. 지원되지 않는 경로를 조용히 빼지 않는다.
- VM/VZ/vsock/guest/systemd/journald와 두 번째 native 업무 runtime을 기본 실행이나 fallback으로 남기지 않는다. foreground terminal 제품이며 GUI·background attach는 별도 범위다.
- [PRIORITY-0](PRIORITY-0.md)의 durable fact·현재 authority·observation을 구분한다. accepted plan·request key·receipt·과거 결과를 현재 incarnation이나 설정으로 재해석하지 않는다.
- unknown은 dead/absent/success가 아니다. 전체 후손 종료가 필요한 효과에 direct-child exit나 process scan을 대신 쓰지 않는다. 이 제품 계약을 변경하려면 별도 사용자 결정이 필요하다.
- Worker는 자기 허용 영역만 사용한다. broker DB·receipt·canonical Git·다른 actor·host credential은 보호한다. 일반 network 공유·실행 quota 없음은 유지한다.
- Mac native는 새 state root에서 시작한다. 기존 VM state/disk/archive, native Personal history, accepted bytes는 자동 변환·삭제하지 않는다.
- 첫 지원 목표는 macOS 26 arm64·Linux다. macOS 15는 호환성 관측이다. root daemon·EndpointSecurity entitlement·private coalition 제어·최소 OS 상향은 기본 의존성이 아니다.

## 2. 구조와 재사용

| Owner | 책임 |
|---|---|
| App | OS adapter 선택, Society/Personal 조립, 시작·종료 순서 |
| domain / broker / lifecycle | 현재 권한, incarnation, admission, 업무 판단 |
| process | child·pipe·cancel·drain, wake/backoff, 실행/복구 조정 |
| storage / config / Git | 원래 durable owner의 게시·검증·정산·복구 |
| tool-files | SDK 없는 파일 정책과 snapshot 수명; private adapter에서 독립 descriptor leaf 사용 |
| file-descriptors / native / platform-* | 좁은 POSIX descriptor 연산 / 나머지 syscall·sandbox·peer/process 관측. 업무 정책 없음 |

기존 workspace와 공개 API를 우선 사용한다. 새 의존성이 필요하면 manifest·DAG·경계 검사·독립 설치를 함께 바꾼다. package 수를 맞추려고 책임을 합치거나, Node-only 원칙 때문에 불가능한 FD 경로를 흉내 내지 않는다.

Sandbox 기본 방향은 Linux bwrap, Mac Seatbelt다. [Anthropic](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/macos-sandbox-utils.ts)의 policy/adapter 분리와 [Codex](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/utils/pty/src/process_group.rs)의 실행 수명을 비교 입력으로 쓴다. 라이브러리 전체의 network 정책이나 best-effort 종료를 OMA 계약으로 자동 채택하지 않는다. 직접 채택·부분 재사용·작은 자체 adapter 중 의존성, 기능 차이, 유지보수 비용으로 선택한다.

## 3. 스스로 결정해야 할 때

**기존 계약·구현 → 유사 제품 원본 → OS 문서/SDK·source → 최소 실제 실행 → 결정 기록** 순서로 판단한다. 검색은 막힌 성질을 대상으로 한다. 예: `descendant termination after owner death`, `fd reopen independent offset`, `launchd inherited descriptor`, `Mach expected server audit token`. 제품명이나 API 이름이 같다는 것은 동등성의 근거가 아니다.

미결정 항목은 아래 형식으로 갱신한다. 코드가 존재해도 실행 근거가 없으면 후보다.

| 항목 | 남길 내용 |
|---|---|
| 요구 | 사용자에게 보이는 동작과 보호할 데이터/권한 |
| 후보 | 최소 두 접근; 이미 사용 중인 구현 재사용도 포함 |
| 근거 | URL·source revision, 대상 SDK/OS·권한·배포 조건 |
| 반례 | 후보가 틀렸음을 보여줄 가장 작은 실제 시나리오 |
| 판정 | 채택 / 후보 / 배제 / 사용자 결정 필요; 다음 행동과 이유 |

한 번에 가장 큰 불확실성 하나를 줄인다. 반례를 통과한 후보에만 caller·persisted format을 연결한다. 동일 입력·전제의 실패는 재실행하지 않는다. 새 source/OS/구현 또는 다른 관측 질문이 있어야 다시 시험한다. 자료를 찾지 못한 것과 불가능함은 다르다.

SDK 선언만으로 stable public API라고 보지 않는다. header의 private/deprecated 표시와 실제 지원 OS 범위를 따로 기록한다.

다음은 구현자가 정한다: 내부 API·자료구조·기존 leaf 재사용·동등한 구현 선택. 다음은 사용자에게 묻는다: 기능 제외, 보안/복구 보장 완화, privileged 서비스·restricted entitlement, OS 지원 하한 변경, 데이터 migration. 조회 가능한 repo/CI 정보를 사용자에게 되묻지 않는다.

## 4. 실행과 복구

### 4.1 공유할 계약

실행 시작은 `opening 기록 → 실제 child/scope 취득 → witness 영속화 → 현재 권한 재검사 → gate release`다. 종료는 `admission/wake 차단 → grant 철회 → 종료 요청 → 필요한 종료 관측 → pipe/log/FD drain → journal retire`다. 정상 실행과 crash recovery는 판단을 구분하고 관측 primitive만 공유한다.

다음 세 관측을 한 boolean으로 합치지 않는다.

| 관측 | 증명하는 것 | 증명하지 않는 것 |
|---|---|---|
| 직접 child exit/close | 그 child의 결과·stdio 수명 | 탈출한 후손의 죽음 |
| scope population | 특정 범위의 현재 구성/종료 | 현재 role·실행 권한 |
| authority revoke | 이후 OMA 효과의 허가 철회 | kernel process나 기존 writable FD의 소멸 |

Linux의 실제 namespace-init/pidfd 경로는 보존한다. Darwin에 같은 형태의 witness를 먼저 만들지 않는다. boot identity·재사용 방지·fresh acquisition·전체 범위 판정이 성립하는 수단을 먼저 정한다. 저장 PID/UUID/label은 신호 권한이 아니다. opening만 남은 crash와 witness 이후 crash를 각각 처리한다.

### 4.2 Darwin 후보 — 아직 채택된 complete-scope backend 없음

| 후보 | 얻는 것 | 남은 문제와 다음 판정 |
|---|---|---|
| 일반 child + process group | 가장 단순한 실행·정상 cleanup; 기존 runtime 선례 | setsid/double-fork 후손이 생존하는 실제 반례 있음. best-effort 기능에는 사용 가능하나 complete-death 대체로는 배제 |
| launchd job + audit session | OS가 시작한 job과 session 관측 | session join/재사용, all-owner-death 복구, launch handoff가 미해결. SessionCreate만으로 containment라고 쓰지 않음 |
| launchd job + resource coalition 관측 | kernel ID 소멸을 PID scan과 다른 종료 증거로 사용 가능 | 상속·CID 소멸·fresh token 제어·late-fork 재탐색은 확인. **bootout 단독은 detached 후손을 남겼고, 현 production Seatbelt에서도 기존 service가 다른 CID·unsandboxed로 실행됐다. 현 조합만으로 complete backend 채택은 배제** |
| Seatbelt로 이탈/새 생성 경로 제한 | 집합을 닫을 수 있다면 group 종료 활용 가능 | inherited service는 실제 범위 밖 실행이다. null task/registered 분리 뒤 Node 자신의 task/global0·fresh service141은 확인했지만 native C resolver가 실패한다. 정상 도구·manual CLI와 양립한 complete backend는 미채택이며 CLI 이름 차단은 해법이 아님 |
| unprivileged bootstrap subset | 별도 namespace에서 허용된 lookup을 보존할 가능성 | 실제 SDK15.5/26.5·ordinary UID501은 host/inherited부터 API125로 생성하지 못했다. unprivileged/parent·subset 안의 libc/manual CLI는 NOT_RUN. 이 환경의 후보로 미채택이며 모든 OS에서 불가능하다는 판정은 아님 |
| broker-mediated spawn / 실행별 쓰기 영역 | 후손 전부 죽음과 특정 데이터의 writer exclusion을 분리할 가능성 | **설계 후보**. 임의 도구 호환성·기존 workspace/receipt/재전달/회수 의미를 먼저 대조. 권한 revoke만으로 writer exclusion이라 하지 않음 |
| macOS 27 ES descendant client | 기존·미래 descendant subtree의 auth/notify | OS 상향과 Apple entitlement 승인 필요. 현재 기본 범위 밖이며 owner-loss·종료 보장도 별도 검증 |

Resource coalition의 [고정 XNU 관측 코드](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/coalition.c)에서 `tasks_started/tasks_exited`는 같은 lock 아래 읽힌다. `termrequested`는 empty 알림 요청이며 즉시 fork 차단이 아니다. [같은 revision의 설명](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/doc/observability/coalitions.md)은 ID 비재사용과 loaded service 재시작의 coalition 재사용을 명시한다. 일시적 empty·terminate 요청을 닫힌 실행 범위로 승격하지 않는다. 목표 kernel의 위 전제를 실제 확인하며, SDK에 없는 ABI를 public이라 부르거나 private 제어 syscall로 우회하지 않는다.

Mac15·26 각3회에서 job bootout 후 detached 생존, controlled release 뒤 기존 CID의 ESRCH와 별도 live CID의 성공 조회를 확인했다([기록](implementation/native-transition.md)). [고정 reap 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/coalition.c#L2240)은 terminated·active_count0 뒤 ID를 hash에서 제거한다. started==exited에는 pending activation이 없으므로 ID 소멸과 혼동하지 않는다.
inherited spawn은 같은 CID였고 explicit own/다른 CID spawn은 EPERM이었다. private attribute는 시험 전용 adversary이며 제품 launch API가 아니다. [privilege/entitlement 조건](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L4020)을 서비스 경유 실행·headless·다른 보안 환경의 admission proof로 확대하지 않는다.

`885c07fedf`의 두 Mac 각3회에서 fresh kernel task-name token과 before/after generation·CID를
결박한 SDK 제어, wrong-member 미호출, release 전 CID 소멸을 확인했다([기록](implementation/native-transition.md)).
peer가 준 port를 kernel task라고 믿지 않는다. unprofiled controlled target의 결과를 role authority나 새 Seatbelt label 복구로 확대하지 않는다.
`4d140a51d5`의 두 Mac 각3회에서는 CID만으로 첫 snapshot 뒤 생긴 후손을 다음 scan에서 찾아 제어하고 release 전 ID 소멸까지 확인했다. PID count를 bytes로 읽지 않고 scan은 hint로만 쓴다. empty/truncated scan·deadline은 death proof가 아니다.
`836e2f5963`의 두 Mac 각3회에서 production Seatbelt target·상속 후손도 fresh controller로 제어하고 release 전 CID 소멸을 확인했다. 다만 service 호출은 fixture deadline으로 끝나 명시적 거절/허용을 판정하지 못했다.
동일 job의 host 양성 후 재시작 대기가 섞였을 가능성은 `[INFERENCE]`다. 별도 `service-positive`와 fresh `service-target`으로 분리한 `2ef7fb517b`의 Native [40711228810](https://github.com/minjung2035/oma-v2-ci/actions/runs/40711228810)에서 양 Mac 각3회 모두 sandboxed launchctl exit0·numeric cleanup 없음, PID1 아래 다른 CID의 unsandboxed actor 실행을 확인했다([인계](HANDOFF.md#4-가장-가까운-재개점-service-관측의-혼입-제거)). 이는 현 policy+coalition의 닫힌 범위 후보에 대한 반례이며 과거 timeout 원인 수리는 아니다. GUI UID501·SIP-disabled 범위를 넘겨 일반화하지 않는다.
다음 최소 질문은 bootstrap/XPC 제어 권한을 exec 전에 분리할 수 있는지와 정상 도구·DNS의 양립 여부다. public API와 libxpc의 내부 port 전달 관례를 구분하고, 오래된 bootstrap proxy를 바로 제품에 이식하지 않는다. 다른 service 경로·실제 product owner crash·durable producer의 증명도 별도다. 실행 guard·Linux backend·기존 writer/receipt/recovery 계약은 유지한다.
`launchd-bootstrap`의 첫 `41392d6624`는 unsafe/deprecated API로 compile 실패했다. SEND 참조만 반납하도록 교체한 `a4c398f89a`의 Native [40726395555](https://github.com/minjung2035/oma-v2-ci/actions/runs/40726395555)에서는 양 Mac 각3회 실제 compile·실행을 확인했다. inherited service12회는 성공, bootstrap만/모두 제거한24회는 CLI141·effect 미관측이고 Node·clang·자기 쓰기·금지 canary는18 variant 모두 기대대로다. 단, Git shim/ DNS는 상속 기준선부터 실패했으므로 권한 제거의 호환성 실패로 분류할 수 없다. selected Git·host DNS 양성과 registered seed 재취득 반례를 다음에 확인한다. backend·role authority·전체 service admission/death proof는 아직 채택하지 않는다. [Chromium V2 원본](https://chromium.googlesource.com/chromium/src/+/dc38dfd79ac22ae4d60fb49a78f63ab0920f958e/sandbox/mac/seatbelt_sandbox_design.md)의 proxy 제약과 public Mach API/libxpc 내부 관례 구분도 유지한다.

후속 `4baca756363`의 Native [40735745482](https://github.com/minjung2035/oma-v2-ci/actions/runs/40735745482)에서 host selected Git·DNS 양성은 확인했다.
그러나 sandboxed Git은 inherited부터 `/etc/gitconfig` EPERM·128, DNS도 exact socket 입력 뒤 ENOTFOUND였다. 정상 도구 양립은 아직 미충족이다.
bootstrap-only는 registered seed 재조회·setter0·task bootstrap 복구6회를 관측했으나 launchctl141·effect 미관측이었다.
task handle 복구를 service 실행 권한 복구/탈출로 확대하지 않는다. 모든 seed 제거 뒤에는 이 재취득 방법에서 seed0·setter 미호출이었다.
기존 Git 환경 owner와 native DNS 진단으로 다음 원인을 분리하며 fixture용 광범위 권한·production 실행 허용으로 우회하지 않는다.
현재 probe는 host/Node Git에 기존 `GIT_ENV`를 적용했고 native DNS 단계별 진단을 추가했다. local41/41과 Linux producer smoke는 통과했지만 이 변경의 Mac compile·Git 정상화·DNS 원인 분류는 NOT_RUN이다. Node resolver·production 정책과 실행 guard를 바꾸지 않았다.
첫 진단 source `a399fb7fe58`는 Mac26에서 잘못 추가한 `-ldns_sd`가 없어 link 실패했다. Git 환경 효과·DNS API 실행은 미관측이며, default Libsystem의 `system_dnssd` 소유를 대조해 그 독립 flag만 제거했다. 수정 뒤 실제 실행과 취소된 Mac15 job의 대체 실행은 NOT_RUN이며 정상 기능이나 gate 완료로 쓰지 않는다.
교체 뒤 `e9a939d619`의 Native [40748217460](https://github.com/minjung2035/oma-v2-ci/actions/runs/40748217460)에서는 양 Mac 실제 compile/link·각3회 관측을 확인했다. selected Git hash18회는 성공했으며 DNS는 socket 생성 성공 뒤 exact endpoint connect EPERM1로 분류됐다. 이 checkpoint에서는 Unix filter 번역 수정 전이었다.
Linux의 실제 설치·추론/복구·전체 회귀·clean CI 마감 뒤 Mac을 재개했다([검증 owner](implementation/validation.md#linux-eagain-수리-뒤-실제-재인수)). exact Unix·root alias·Node DNS와 실제 helper 경계를 확인했다. `de1624b9aa`는 같은 SDK import/layout의 Node 내부 libc가 controlled lookup 전후 모두 성공함을 확인했지만 Node-child C는 실패한다. 앞선 controlled lookup은 성공의 필수조건이 아니며 startup/image/task 생성 경로는 미분리다. 다음 동일 C의 direct-exec/child 비교는 NOT_RUN이다. public subset은 ordinary host에서도 생성하지 못했다. complete backend는 미채택이며 broad network/Mach·resolver fallback·exec guard 해제로 우회하지 않는다.

`proc_signal_with_audittoken`은 SDK에 있으나 private/unstable이다. Mac15·26 각3회 ordinary-UID
nonparent controller가 genuine kernel trailer token의 SIGKILL과 wrong-version ESRCH를 확인했다.
trailer 대조 단독으로 role authority·실제 PID 재사용·fresh-profile recovery·전체 scope death를 증명하지 않는다.

Mac15·26 각3회에서 inherited signal은 전달됐지만 동일 SBPL을 fresh 적용한 쪽은 EPERM이었고 nested 재적용도 EPERM이었다. 따라서 SBPL 재적용을 recovery reaper로 사용하지 않는다. `seatbelt-signals`는 unreaped owned child만 쓰는 label 실험이며 permissive fixture profile·EOF 종료를 production policy나 complete-death proof로 옮기지 않는다.

Native `40618265543`의 SIP-disabled Mac15·26에서는 GUI job 생성에 성공했지만, `SpawnConstraint.cdhash=A`에 경로를 B로 교체한 실행이 각3회 실제 B를 실행했다. 이 환경에서 launchd constraint 단독 exact-image 결박은 배제한다. SIP-enabled 환경이나 headless 지원으로 일반화하지 않는다.

[ES descendant API](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client(_:_:).md)는 macOS 27+, entitlement 필요, root/TCC 불필요라고 명시한다. 통상의 ES client 조건과 혼동하지 않는다. 이 API도 단독으로 Seatbelt 전체 정책을 대체하지 않는다.

### 4.3 수용 기준

정상 실행과 fork/setsid/close-all-fds, leader·runner·broker·host SIGKILL, PID/ID 재사용, restart를 통과해야 한다. `populated/empty/unknown` 각각의 producer를 설명할 수 있어야 한다. 종료 불명인 동일 자원의 재사용·정산·회수는 원래 owner가 막는다. 후보 실패가 관계없는 파일 도구나 Personal 이식까지 막는 이유가 되어서는 안 된다.

## 5. 인증과 채널

- trusted host↔broker↔runner/Principal은 부모가 만든 private channel과 실제 child identity를 우선 사용한다. UUID·env·pathname을 신원으로 승격하지 않는다.
- model actor 요청과 runner 관리 요청을 분리하고, 매 요청 current grant·incarnation·capability를 공유 broker owner가 확인한다. EOF는 revoke 근거이지 scope death가 아니다.
- manual CLI도 제품 범위다. 추가 FD가 임의 후손에게 항상 전달된다고 가정하지 않는다.

| 후보 | 사용/판정 |
|---|---|
| inherited socket/pipe | 직접 시작하는 trusted client의 기본 경로. handoff·복제·EOF·owner death 검증 |
| Mach + kernel audit trailer | manual CLI의 실제 message sender 후보. 기존 adapter와 [Chromium rendezvous](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/base/apple/mach_port_rendezvous_mac.cc) 재사용. current-run 결박과 expected Broker producer는 별도 필요 |
| Unix socket peer credentials | endpoint 관측에는 유용. Darwin의 queued/인계된 메시지별 origin 증거로 사용하지 않음 |
| generation-bound bearer credential | 일반적인 단순화 후보지만 현재 Principal의 credential+descent 계약보다 약해질 수 있음. 자동 채택하지 않음 |

G-AUTH는 실제 sender, 살아 있는 그 process, 현재 run 소속, 기대한 Broker, 현재 권한을 각각 검증한다. 유효한 Node 서명이나 nonce echo 하나가 이 다섯 질문의 답은 아니다. parent channel·launch service·서명 requirement 중 expected identity의 출처를 선택하고 선점/교체/전달/PID 재사용 반례로 확인한다.

## 6. 파일과 설치된 실행파일

### 6.1 하나의 파일 정책, 다른 capability

path 문법·소유 경계·종류·hardlink·repair 정책·동일 bytes·publication·cleanup은 기존 TS owner가 맡는다. `entryAt(fd, name)` 문자열 API는 directory-relative 연산으로 교체한다. tool-files는 Node/Koffi 외 업무 의존성이 없는 `@oma/file-descriptors`를 private adapter로만 사용한다([DR62](design-revisions.md#dr62--파일-도구의-native-의존성은-독립-descriptor-leaf로-제한한다)). broad native module을 import 예외 처리하지 않고 leaf의 실제 transitive closure도 검사한다.

`DirHandle`, metadata observation, readable/writable FD, entry pin, independent cursor, executable selection은 다른 capability다. 모든 호출자에게 Linux O_PATH+proc-fd 형태를 강요하지 않는다. 각 caller가 실제로 필요한 capability를 확인하고 불필요한 reopen을 없앤다. Node FD read/write/hash/stream은 그대로 쓴다.

| 문제 | 후보와 판정 |
|---|---|
| directory-relative open/list/effect | 기존 `mkdirat`·`unlinkat`·directory cursor를 독립 descriptor leaf로 이관. 단일 leaf open은 `openat`+no-follow; 여러 component의 beneath 계약은 별개로 검증 |
| regular entry pin/repair | accessible O_EVTONLY + held-inode 관측/fchmod 후보; 이미 소유한 I/O FD 유지도 비교. mode-000·FIFO/device의 type-before-I/O는 독립 검증 |
| 독립 read cursor | 이미 소유한 readable FD의 positioned I/O, kernel reopen, private verified copy를 목적별 비교. duplicate와 copy는 원래 inode의 독립 reopen과 다른 계약 |
| exact executable | Linux FD-exec 유지. Darwin 후보는 [launchd `SpawnConstraint.cdhash`](https://developer.apple.com/documentation/security/defining-launch-environment-and-library-constraints), SDK의 START_SUSPENDED + [public Security dynamic guest](https://developer.apple.com/documentation/security/seccodecopyguestwithattributes(_:_:_:_:)) 검증, 보호된 immutable installation generation이다. mapped image·arch/hash 집합·release 전 mismatch 거절·PID 재사용·script/loader context를 실제 확인한다. mutable pathname check→exec는 대체 proof가 아님 |
| 외부 writer의 root 결박 | held directory 기준 cwd/relative path 또는 해당 VFS의 실제 capability. Node host 전체의 cwd 변경으로 여러 동시 작업을 묶지 않음 |

현재 확인된 반례: Darwin `/dev/fd` duplicate는 cursor를 공유했고 descriptor 경로 exec는 errno13이었다. `/dev/fd/<directory>/<name>`은 directory API가 아니다. O_EVTONLY mode-000은 EACCES였다. `openbyid_np`는 syscall 번호가 보여도 platform/private entitlement 조건이 있으며 현재 일반 CLI 해법이 아니다. [기존 조사](implementation/native-reference-review.md)와 원시 artifact를 먼저 읽고 같은 가정을 반복하지 않는다.

`suspended-image` 선행 시험은 정상 A/B·Node/Git/compiler·interpreter 대조와 **B를 map한 뒤 pathname을 A로 복원하고 첫 dynamic guest lookup**을 시작하는 반례를 함께 기록한다. lookup 성공이나 on-disk signing metadata를 검증 성공으로 바꾸지 않는다. 실제 requirement status와 release 전/후 실행 marker로 판정하며, main-image 검증은 script/module/library bytes·후손 수명·sender role을 보증하지 않는다.

`859c9ff3be`의 Mac15·26 각3회에서 위 main-image 양성과 치환 후 사용자 코드 실행 전 거절을 확인했다([판정 기록](implementation/native-transition.md)). 이 primitive를 후속 조립의 기준 후보로 쓴다. 제품에 연결할 때는 unreaped child 소유, descriptor/cwd 전달, 보호된 script/library generation과 owner-loss 정리를 함께 충족한다. fixture의 process-group supervisor를 production scope backend로 옮기지 않는다.

mode-000 등 안전하게 취득·수리할 수 없는 entry는 unknown으로 남긴다. metadata 조회 뒤 pathname chmod로 다른 inode를 건드리지 않는다. 한 손상 entry 때문에 무관한 cleanup까지 생략하지 않는다. 기존 metadata/history bytes는 보존한다.

### 6.2 소유권과 publication

Society·broker·tree-reader lock은 서로 다른 수명이다. held directory/inode의 실제 flock 계약을 검증하며 TTL·heartbeat·PID 파일로 ownership을 대체하지 않는다. `temp → write-all → file flush → verify → no-replace publish/derived replace → parent flush`를 유지한다. 같은 이름/다른 bytes는 충돌이다. SQLite/Git 등 외부 writer도 같은 root capability에 연결해야 한다.

외부 source와 이번 호출이 `O_EXCL`로 만든 비공개 temporary를 구분한다. 후자는 held parent의 `linkat`로 같은 leased inode를 no-replace 공개한다. 이 이름은 해당 writer 소유이며 collector는 live flock을 존중해야 한다.
외부 source의 FD hardlink가 없거나 cross-device면, 이미 확인한 held-source bytes를 목적지의 비공개 leased temporary에 복사·hash 검증한 뒤 공개한다. 기존 destination은 덮어쓰지 않고 bytes를 검증하며 cleanup identity는 실제 공개한 inode다. source와의 inode 공유 자체는 영속 계약이 아니다.

## 7. Sandbox와 path view

Deny-default Seatbelt와 기존 Linux confinement을 같은 목적별 policy에서 만든다. Worker·candidate·quarantine은 다른 최소 권한 입력을 받는다. read·write·exec·library mapping·IPC를 구분하고 credential/다른 actor/설치 code/receipt/DB를 노출하지 않는다. 상속 FD는 명시된 채널만 남긴다.

Linux mount 주소(`/workspace`, `/inbox.md` 등)는 공통 `PathView`의 논리 주소다. Darwin에 같은 root 경로를 만들지 않는다. 실제 cwd·session·toolchain·receipt 경로를 한 owner에서 매핑한다. `/var`/`/private/var`, `/tmp`, symlink alias, 공백·비ASCII·Homebrew·CLT 경로를 시험한다. 지원하지 않는 APFS 이름 충돌은 덮어쓰지 않고 거절한다.

기존 Seatbelt helper를 계속 쓸지 upstream runtime을 채택할지는 argv/env/stdio·inherited FD·policy 표현력·배포 의존성으로 결정한다. helper는 syscall 집행만 맡으며 TS의 lifecycle·retry·authority를 복제하지 않는다. sandbox 적용 실패를 unsandboxed exec로 바꾸지 않는다.

## 8. Git, checks, Restic

- Git owner는 frozen bundle/commit·object format·prerequisite·fsck·hooks/filter/replace-object scrub을 유지한다. 검증과 canonical import는 별도 scope이며 untrusted parser/check에 canonical write를 주지 않는다.
- Candidate는 exact commit의 checkout과 frozen argv/env를 사용한다. private setup 준비 뒤 현재 권한을 다시 확인하고 exec gate를 연다. script stdout/stderr는 준비 성공의 증거가 아니다. nonempty checks를 빈 목록으로 낮추지 않는다.
- Restic은 pinned upstream을 사용한다. 기존 TS inventory/tar/hash/PAX/hardlink verifier를 유지하고 GNU tar나 두 번째 검증 runtime을 만들지 않는다. password는 argv/env에 넣지 않는다.
- Archive는 source quiescence·Store close → backup → 실제 repository stream/inventory/source 검증 → checkpoint → cold commit → reclaim 순서다. restore는 open/provision 전에 별도 stage에서 검증한다. 검증/metadata/종료 불명이면 원본을 남긴다. backup 성공과 reclaim 성공을 합치지 않는다.

## 9. 제품 경로와 durable 호환성

공통 `oma`에서 Society·Personal·모드 전환·history·packages·Pi·도구를 실제 연결한다. VM 전용 command를 다른 파괴적 효과로 재해석하지 않는다. Keychain은 선택된 작은 helper로 분리하고 실패 시 평문 credential로 fallback하지 않는다. scripted credential은 signed Keychain·잠김/TCC 검증이 아니다.

현재 HostConfig 4·DB 4·plan v3/역사 v2 reader·managed committed-v2와 실행 journal의 현재 코드를 먼저 확인한다. 새 형식은 registry에서 할당하며 migration과 native 새 state를 혼동하지 않는다. 기존 acceptance/receipt 의미를 유지한 내부 adapter 변경에 불필요한 durable 형식을 추가하지 않는다. 새 witness를 journal에 넣는 것은 producer와 recovery proof를 확보한 뒤다.

## 10. 기존 코드의 처리

| 유지·재사용 | 수리·교체 판단 |
|---|---|
| 공통 ledger/authority/receipt·ResidentRuntime·coalesced wake·logs·Restic verifier | Darwin broad unsupported guard를 제거하기 전에 실제 caller별 capability 연결 |
| Linux namespace/pidfd·sandbox·현재 정상 시나리오 | tagged witness 도입으로 생긴 Linux 회귀; 새 추상화의 편의 때문에 Linux 의미를 바꾸지 않음 |
| Mach transport/audit leaf·POSIX file/metadata leaf·Seatbelt recipe | 각 leaf의 실제 실행·반례를 보고 채택; 현재 파일 존재를 완료로 계산하지 않음 |
| Keychain WIP와 사용자 변경 | branch/snapshot을 확인하고 보존; 오래된 인계의 미통합 표기를 현재 사실로 쓰지 않음 |

`audit-session.ts`의 scan→empty, 저장 witness를 fresh identity로 반환하는 recovery, `execution-launch.ts`의 throw-only 경로는 채택 가능한 backend가 아니다. launch-data 소유권/ABI/argv/stdio 문제도 별도다. 후보를 교체하면 미사용 코드·exports·caller를 함께 제거하고 guard만 성공으로 바꾸지 않는다.

## 11. 작업 단위와 판정

각 변경은 `요구 → 기존 owner/caller → 최소 반례 → 구현 → 실제 smoke/회귀 → 문서·경계 갱신`으로 닫는다. OS primitive를 증명하기 전에 app 전체나 journal을 재설계하지 않는다. 여러 실패가 같은 setup에서 발생하면 공통 원인을 먼저 고친다.

- 결과 이름은 채택 결정과 실행 사실을 구분한다: 후보 / 배제 / 채택, NOT_RUN / SETUP_FAILED / OBSERVED / PASS.
- Fixture는 실제 argv·UID·FD·cwd·cleanup을 사용한다. Node binary를 JS script로 넘기거나 root-mapped 환경으로 일반 사용자 권한을 증명하지 않는다.
- child 실패를 긴 timeout으로 가리는 harness를 피한다. 원래 error와 cleanup error를 보존하고 live owner를 drain한 뒤 Store를 닫는다.
- source/wording/forwarding만 고정하는 시험 대신 bytes·inode·권한·상태 전이·실제 실행을 검증한다. permanent regression은 소비자에게 의미 있는 반례에만 추가한다.
- 외부 prerequisite가 없으면 도달 가능한 구현을 끝내되, 없는 capability를 stub·mock·fallback으로 메우지 않는다. 같은 조사를 반복하는 대신 빠진 증거와 다음 선택을 제시한다.

## 12. Mac 없이 개발하는 CI 계약

| 단계 | 실제 확인 |
|---|---|
| Local | build/type/module/document 검사, 변경 경로 smoke, 관련 Linux 회귀 |
| 독립 설치 | workspace tarball만으로 선언·asset·runtime 실행; checkout/hoisted dependency 우연 사용 금지 |
| macOS 26 | 작은 primitive 반례 → production adapter → 실제 Society/Personal·Pi·CLI·Git·Restic·설치 scenario |
| macOS 15 | 별도 호환성 결과. macOS 26 결과와 합쳐 지원 PASS로 표시하지 않음 |
| 최종 | 전체 Linux 회귀·경계/owner/형식 대조·실제 Mac 결과·복잡도 검토. 미실행 release 환경은 명시 |

실행하지 않은 API를 static compile이나 mock으로 qualification하지 않는다. 필요한 정상/실패/kill-restart 경계가 모두 연결돼야 전체 완료다. input/source SHA·OS/image/SDK/arch·tool versions·명령·exit/signal·stdio·잔존 자원·cleanup을 artifact에 남긴다. 부분 재실행을 전체 PASS로 합성하지 않는다.

Mac CI는 의미 있는 변경 묶음에 실행한다. **push/workflow 조건을 먼저 읽는다.** 현재 work branch push가 Mac job을 실행할 수 있으므로 Linux만 돌 것이라고 가정하지 않는다. 일반 paid 실행을 반복하기 전에 local/static/fixture 검사를 끝낸다. 기존 public artifact는 [run 40548845744](https://nightly.link/minjung2035/oma-v2-ci/actions/runs/40548845744)처럼 접근 가능한 경로를 사용하고, 실패한 API/log URL을 반복 추측하지 않는다. artifact의 source와 현재 source는 구분한다.

## 13. 구현 순서와 완료 조건

**현재 우선순위:** Linux 전체 회귀·독립 설치·실제 추론/도구·재개/보관/복구의 인수검증을 마쳤다. 사용자 지시대로 문서 정합성·지정 work branch commit/push 후 macOS 작업을 이어간다. 아래 P0–P7는 제품 전체 순서이며 Linux 검증의 완료 근거와 실제 Mac 관측을 구분한다.
독립 설치본에서도 Principal·Worker·Personal의 기존 Codex 인증 `gpt-6-luna`·`medium` 실행을 확인했다.
검증용 선택이며 제품 기본 정책 변경이 아니다. 실제 결과·오류·미실행 범위는 [검증 기록](implementation/validation.md)을 따른다.
과거 첫 `ok:false`는 원인 미상 단일 CI 통합시험 실패다. 확정 Git 결함·Linux 완료의 필수 blocker·무해한 flake·수리 완료로 단정하지 않는다. 이력과 진단을 유지하고 재발·실사용 제출 실패·중복 효과·ref/receipt 불일치 시 즉시 승격한다.

| 단계 | 작업 | 다음 단계 조건 |
|---|---|---|
| P0 | 목표·불변식·현재 source/WIP·실패·후보를 정리 | 원래 데이터/계약 보존, 후보와 결정이 분리됨 |
| P1 | lifetime·file/exec·auth의 결정적인 작은 실증 | 각 후보의 지원 조건·반례 결과와 다음 선택. 미해결 전제 위에 대규모 연결하지 않음 |
| P2 | 파일 capability·tool-files·설정/package 연결 | 실제 file 도구와 publication/repair가 양 OS에서 동작 |
| P3 | 실행·recovery·grant·로그 연결 | startup/stop/kill/restart와 old receipt/current authority 분리 |
| P4 | Worker·manual CLI·candidate·quarantine 연결 | 정상 도구 사용과 금지 효과의 실제 반례 통과 |
| P5 | Restic·credential·독립 설치 | 실제 backup/verify/restore·원본 보존·선택 credential 동작 |
| P6 | Society/Personal/TUI 전체 제품 경로 | 새 설치에서 VM/systemd 없이 두 OS의 named scenario 통과 |
| P7 | 전체 회귀·복잡도·owner/spec/evidence 최종 대조 | 현재 source에 결박한 결과, 미완료/제한의 정확한 표시 |

P1의 독립 후보는 필요한 순서로 검증하고, 이미 근거가 확보된 P2 작업은 진행할 수 있다. 다만 공통화·시험 개수가 늘어난 것을 핵심 gate 해결로 계산하지 않는다. 최종 인도는 모든 사용자 기능, affected caller/test/docs, clean cutover, 실제 실행 proof를 포함한다. work branch만 commit/push하며 merge·deploy하지 않는다.

## 14. 다음 모델 인계

[HANDOFF](HANDOFF.md)의 현재 source·실패·재개점과 최신 사용자 지시부터 확인한다. 현재 지시는 **Linux 검증·문서 마감 뒤 지정 work branch를 push하고 macOS를 이어가는 것**이다. Linux 결과는 verification 입력별로 구분하고 단일 CI 실패는 비차단 추적 이력으로 남긴다. 사용자 변경과 기존 보장을 보존하며 위임·merge·deploy하지 않는다. 긴 과거 조사와 이전 지시는 [개정 전 인계](archive/native-handoff-2026-10-28-pre-redesign.md)에 보존했다.

재개 후 첫 행동은 새 framework 작성이 아니라 가장 가까운 실제 실패의 owner를 확인하는 것이다. 다음 결정이 필요한 경우 §3과 해당 후보 표를 갱신하고, 그 결정을 뒤집을 반례를 함께 제시한다. 소요시간은 확정 작업과 미결정 전제를 나눠 사용자에게 범위로 답한다. 견적을 맞추려고 기능·보장·시험을 줄이지 않는다.
