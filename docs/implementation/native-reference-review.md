# Native 실행 경계의 외부 구현 대조

2026-10-26 사용자 지시에 따라 다른 저장소의 실제 source를 대조했다. 아래 commit은
조사 입력을 고정하며, 그 저장소 전체의 보안 감사나 OMA 지원 증명이 아니다.
OMA의 수용 기준은 [PRIORITY-0](../PRIORITY-0.md)와
[native 명세](../macos-native-spec.md)이며 세 gate를 다른 제품의 지원 표기로 대신하지 않는다.
실행 결과는 [validation](validation.md)이 소유한다.

| 저장소와 고정 입력 | 실제로 확인한 방법 | OMA에서 사용할 부분과 추가로 필요한 증거 |
|---|---|---|
| Anthropic sandbox-runtime `98a4016d27609ed34dd1fb43d23ed6efb6eeeb77` | 공통 TS manager가 OS adapter를 선택하고 Mac adapter가 deny-default Seatbelt profile과 sandbox-exec command를 만든다. filesystem/network/Mach 서비스 허용을 각각 구성한다 | 공통 정책과 OS 집행부의 분리, SBPL literal escaping과 명시적 Mach 허용 범위는 참고한다. profile 생성·command wrapping은 임의 후손 사망이나 owned-file entry pin의 증명이 아니다 |
| Codex `970111f6cb62cc02fe36a82ea7d71b37a2889c97` | Unix process group에 signal을 보내며 Mac의 EPERM에는 proc_listpgrppids로 같은 group의 멤버를 찾아 재시도한다. parent-death signal은 Linux 한정이다 | signal 전송과 실제 사망을 구분하는 데 참고한다. 다른 group/session으로 이동한 후손과 broker 재시작 뒤 exact scope의 복구를 이 함수로 증명하지 않는다 |
| Gemini CLI `cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005` | TS SandboxManager가 program/args/env/cwd/cleanup을 반환한다. Unix 종료는 pgrep -P를 재귀 호출한 snapshot과 group/개별 signal을 사용한다. 파일 service도 sandboxed command를 통해 실행한다 | 조립과 OS command의 분리는 활용할 수 있다. fork·reparent와 snapshot 사이의 fence, PID 재사용, permission-independent pin/exact reopen은 별도이며 기존 보장을 낮추어 이 종료 함수를 도입하지 않는다 |
| Chromium `655c7be0fe437601b893c7d886a3cb5e80fc4d6b` | Mac Mach bootstrap rendezvous를 만들고 수신 message의 kernel audit trailer로 sender를 판정한다. 메시지 shape를 먼저 검증하고, 설정된 process requirement도 audit token으로 확인한다. send/receive right는 별도 owner로 반환한다 | Mach 후보의 endpoint 구성·receive header 초기화·trailer 경계 검증과 right 반환에 적용한다. 서비스 이름이나 message body는 권한이 아니다. 실제 OMA transport, live pin·PID 재사용·scope membership·현재 authority 검사는 여전히 필요하다 |
| OpenClaw fs-safe `463856edc710e523867d5753c25a17d4ef76fd87` | staged symlink를 Mac의 O_EVTONLY/O_SYMLINK와 held parent로 보유하고, 열린 inode를 admission 관측과 대조한다. cooperative writer lock과 publication 이후 불명 결과 보존을 명시한다 | 특정 symlink의 수명과 parent capability 분리는 참고한다. 문서가 제외한 비협조 writer의 마지막 syscall 경합, 임의 rename·권한 철회·프로세스 사망 뒤 복구를 OMA의 G-FILES 보장으로 승격하지 않는다 |

## 확인한 source

- Anthropic: [Mac adapter](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/macos-sandbox-utils.ts),
  [공통 manager](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/sandbox-manager.ts).
- Codex: [process group 집행](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/utils/pty/src/process_group.rs),
  [child 생성과 cleanup owner](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/utils/pty/src/posix_child.rs).
- Gemini: [sandbox 계약](https://github.com/google-gemini/gemini-cli/blob/cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005/packages/core/src/services/sandboxManager.ts),
  [process 종료](https://github.com/google-gemini/gemini-cli/blob/cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005/packages/core/src/utils/process-utils.ts),
  [파일 service](https://github.com/google-gemini/gemini-cli/blob/cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005/packages/core/src/services/sandboxedFileSystemService.ts).
- Chromium: [Mac rendezvous](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/base/apple/mach_port_rendezvous_mac.cc),
  [message/trailer 검증](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/base/apple/mach_port_rendezvous.cc),
  [실제 send/receive 시험](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/base/apple/mach_port_rendezvous_unittest.cc).
- OpenClaw: [held symlink 구현](https://github.com/openclaw/fs-safe/blob/463856edc710e523867d5753c25a17d4ef76fd87/native/src/staged_symlink.rs),
  [명시한 수명·경합·복구 한계](https://github.com/openclaw/fs-safe/blob/463856edc710e523867d5753c25a17d4ef76fd87/docs/staged-symlink.md).

## 추가 primitive 후보의 source 판정

[과거 Chromium common.sb](https://github.com/chromium/chromium/blob/cfbe56f17a3d7a3397a09d091252db6e3470223d/sandbox/policy/mac/common.sb)는
syscall-unix allowlist를 사용한다. 조사한 현재 Chromium common.sb에는 그 stanza가 없으며,
이 차이를 현재 Mac kernel의 지원 여부로 단정하지 않는다. XNU의
[setsid/setpgid](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L483)와
[posix_spawn](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L4485)를
대조하면 spawn attribute도 group/session 변경 경로다. 따라서 setsid/setpgid syscall만 막는
후보를 전체 후손 fence로 채택하지 않는다. 실제 profile 집행·spawn/exec·복구 증거가 필요하다.

XNU의 [O_EVTONLY open](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_syscalls.c#L4895)은
별도 process I/O policy가 켜진 경우 FREAD/FWRITE를 제거한다. 그
[policy 변경](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_resource.c#L3077)은
com.apple.private.vfs.disallow-rw-for-o-evtonly entitlement를 요구한다. 이는 고정 source의
조건이며 현재 runner에서의 추가 실행 증명이 아니다. private entitlement를 숨은 의존성으로
추가하지 않고 기존 실제 mode-000 EACCES 관측과 G-FILES OPEN을 유지한다.

## 후보에 적용한 범위

기존 ad hoc mach_ports_register/lookup 구성은 actual send 성공 뒤 receiver queue0과
timeout을 남겼다. 그 원시 실패는 각 source commit과 CI artifact에 보존한다. Chromium의
bootstrap rendezvous와 같은 public API 흐름으로 새 mach-rendezvous-live/exit case를
구성했다. 같은 endpoint에 두 sibling이 차례대로 요청을 넣고, 두 번째 body는 첫 sender의
PID를 주장하며, kernel trailer는 각 실제 sender와 일치해야 한다. 둘이 살아 있을 때와
실제 waitpid로 둘을 join한 뒤 읽는 경우를 구분한다. 독립 mach-self case도 유지한다.
각 case를3회 실행하며 Unix FD transfer·queued byte의 기존15개 관측은 그대로다.

이 변경은 후보 harness이며 production auth policy나 accepted plan/receipt를 바꾸지 않는다.
실제 Mac에서 실행하지 않은 후보는 NOT_RUN이다. compiler 경고·실제 timeout·CI 시작 실패를
성공으로 바꾸지 않으며 G-PROCESS/G-FILES/G-AUTH는 계속 OPEN이다.

## 2026-10-27 추가 실제 코드 대조

- [arapuca Darwin 실행](https://github.com/LeGambiArt/arapuca/blob/55e40035fb87ef766eedf23bd1c01fd91261c447/src/platform/darwin/mod.rs#L126):
  parent PID를2초 간격으로 확인하고 음수 PID에 group signal을 보낸다. setsid로 벗어난 후손이나
  watchdog 프로세스 자체의 사망 뒤 전체 scope 복구를 이 코드로 증명하지 않는다. resource
  polling과 rlimit는 DR37 정책으로 가져오지 않는다.
- [ukai macOS capability 판정](https://github.com/monocursive/ukai/blob/1c1e652246c6018be5663ab7474e717a54867e64/crates/ukai-jail/src/platform/macos/requirements.rs#L78):
  tree termination은 `es_new_descendants_client`의 실제 entitlement/SDK 성공을 요구한다.
  같은 파일의 owner-loss 종료 판정은 native에서 unsupported를 반환한다. 다른 프로젝트도
  임의 후손 lifetime을 단순 group kill 성공으로 대신하지 않는 구체적인 비교 입력이다.
  OMA에 entitlement나 VM 의존을 도입한 결과는 아니다.
- [XNU open의 기존 inode 권한 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_vnops.c#L663):
  `O_SYMLINK`는 최종 symlink의 follow 선택과 관계되며, 일반 기존 vnode open의 권한 검사를
  생략하는 flag로 확인되지 않았다. permission-independent pin의 해결책으로 채택하지 않았다.

위 비교는 명시한 source 구간의 검토이며 저장소 전체 audit·Darwin 실행 시험이 아니다.

## Mach audit identity adapter의 source 연결

- XNU `f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`의
  [message ABI/trailer](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach/message.h),
  [수신 권리 반환](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/mach/mach_msg.c#L392),
  [kevent64 ABI/NOTE_EXIT/NOTE_EXEC](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/event.h)을
  native leaf의 Buffer layout·상수·한 번의 권리 반환과 대조했다. 알 수 없는 수신 권리나 불완전
  trailer는 데이터로 올리지 않는다. process event는 단일 등록 process이며 후손 집합이 아니다.
- Apple Security `db15acbe6a7f257a859ad9a3bb86097bfe0679d9`의
  [공개 SecCode API](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/libsecurity_codesigning/lib/SecCode.h#L135),
  [audit attribute 해석](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/libsecurity_codesigning/lib/cskernel.cpp#L78),
  [kernel audit-token 전달](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/libsecurity_codesigning/lib/csprocess.cpp#L50)을
  대조했다. SecCode 생성만으로는 PID가 검증되지 않으므로 public dynamic validity call까지
  성공해야 양성 관측을 반환한다. PID-only/private API fallback은 없다. network 작업은
  공개 `kSecCSNoNetworkAccess` flag로 배제한다. 실패를 process 사망으로 분류하지 않는다.
- Mac identity adapter는 process event를 먼저 등록하고 audit token을 검증한 뒤 다시 event를
  확인한다. 이후 메시지는 native 수신에서 발급된 사실과 전체 audit token을 대조한다. 이는
  source에서 도출한 결박 설계이며 실제 PID 재사용/exec/queued sender 반례 시험은 NOT_RUN이다.
  유효한 코드 서명은 actor/role/scope 권한이 아니고, 일반 code validation 실패가 어떤 개발
  실행 파일을 제외하는지는 실제 Darwin qualification에서 확인해야 한다.

이 leaf와 adapter는 공통 broker transport에 아직 연결하지 않았다. G-AUTH 완료나 지원 PASS가 아니다.

### 공개 audit-token 접근과 rendezvous 계약 재대조

[XNU의 token 작성부](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L1643)는
현재 여덟 word의 의미를 보이지만 literal 위치에 의존하지 말고 BSM 변환 함수를 쓰도록 명시한다.
[Apple의 token API 안내](https://developer.apple.com/documentation/endpointsecurity/es_process_t/audit_token)는
libbsm 접근 함수 사용을 안내한다. native `audit-token.ts`는 opaque 여덟 uint32 aggregate를
Koffi의 실제 by-value struct로 전달하고 PID/EUID/EGID/session/version을 공개 함수로 읽는다.
Mach receive와 Security validation의 입력 검사도 이 owner를 쓴다. 배열 복사나 decode 자체는
kernel receive 증거가 아니며 native receive가 발급한 객체만 message provenance로 인정한다.
[공개 audit typedef](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/bsm/audit.h)는
session의 signed pid_t 형식과 대조했다. arm64/x64의 실제 FFI 실행은 아직 NOT_RUN이다.

[Apple launchd의 공개 배포 header](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/liblaunch/bootstrap.h#L293)는
`bootstrap_check_in`을 job에 선언된 service에 대한 API로 설명한다. 같은 source의
[anonymous check-in 구현](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/src/core.c#L8867)은
strict 여부와 service 부재에 따라 dynamic service를 만들기도 한다. Chromium의 동적 check-in을
공개 header와 같은 보장으로 승격하지 않는다. 현재 leaf는 선언된 service 계약을 명시하며,
OMA ordinary CLI의 dynamic rendezvous는 실제 대상 OS에서 별도 qualification이 필요하다.
새 launchd job·root daemon·private 등록 API를 숨은 의존성으로 추가하지 않았다.

`mach_ports_register`도 [XNU manual](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/man/mach_ports_register.html)의
제한된 runtime 초기화 slot 계약까지 확인했다. 임의 port 상속이나 Node spawn의 등가성으로
가정하지 않으며, 다른 runtime이 쓰는 slot을 덮어쓰는 구현은 추가하지 않았다.

[XNU의 실제 send 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/mach_msg.c#L669)는
header 포함 크기가 네 byte로 정렬되지 않으면 거절한다. raw Mach leaf에 이 전제 검사를
추가했으며 임의 RPC byte의 padding/실제 길이는 향후 TS transport가 소유한다. oversized message가
queue에 남은 상태를 반복해 소비하려 하지 않도록 receive owner도 즉시 닫는다. close failure는
원래 오류와 함께 보존하며, send/receive 실패를 app acceptance나 scope death로 해석하지 않는다.

[SecCodeCheckValidity](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/libsecurity_codesigning/lib/SecCode.cpp#L248)에서
[dynamic status 검사](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/libsecurity_codesigning/lib/Code.cpp#L181)로
이어지는 호출도 확인했다. code reference 생성 뒤 static 검사만 하고 live audit 조회를 생략하는
경로를 양성 관측으로 사용하지 않는다. 대상 signed/adhoc Node의 실제 호환성은 여전히 미검증이다.

## Mach byte connector와 수신 권리의 후속 연결

`mach-transport.ts`는 kernel audit 사실로 peer를 먼저 pin한 뒤 전용 양방향 port를 구성한다.
주소 hash와 nonce는 발견·응답 연결에만 쓰며 actor/role/capability를 발급하지 않는다.
App이 이 adapter를 Client/Broker에 주입하고 공통 generation·RPC decoder·현재 권한 판정을 쓴다.
native-profile guard는 유지하며 이 source 연결을 실제 Darwin qualification으로 세지 않는다.

[Chromium rendezvous의 receive/reply owner](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/base/apple/mach_port_rendezvous.cc#L97)와
[XNU message 권리 형식](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach/message.h#L329)을
대조했다. OMA는 COPY_SEND로 원래 owner를 유지하고, 수신 reply reference만 명시적으로 분리한다.
거절한 request/stream packet의 받은 권리도 반환한다. 임의 숫자나 객체를 send owner로 받지 않는다.

[XNU manual의 pseudo-receive](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/man/mach_msg.html)와
[실제 반환 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/ipc_kmsg.c#L4305)을
대조해 timeout/interrupt 때 돌아온 임시 send reference를 remote/local 둘 다 반환하도록 수정했다.
SDK destructor는 local field를 반환하지 않으므로 그대로 재시도하거나 destructor만 호출하지 않는다.
resource-shortage bit가 있으면 전달받은 권리를 모두 반환한 뒤에도 성공/재시도 가능 상태로 바꾸지 않는다.
공개 interrupt flag로 native wrapper의 자동 재시도를 막고 TS readiness turn으로 돌려보낸다.

raw Mach body 위의 byte packet은 길이·zero padding과 명시적인 EOF를 담는다. 공통 PacketStream은
data/EOF 모두 발신자 대조 후 전달하고 읽기 buffer·하나의 blocked write·Node backpressure를 소유한다.
[Mach port type](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach/port.h#L268)은
destination receive right 손실만 관측하며 EOF/process/scope 사망으로 해석하지 않는다. native close 실패는
반복 호출로 숨기지 않고, stream close와 자원 반환 확인도 구분하여 listener drain에 전달한다.

새 shared-flow 회귀는 OS 사실을 mock으로 증명하지 않는 공통 TS 시험이다. 실제 Mach cross-process,
queue-full reference 회수, sender 인계·PID 재사용·exec·중도 사망과 bootstrap profile은 실제 Mac에서
별도로 실행해야 한다. `7ebb7268`의 Security dynamic validation은 synchronous FFI이며 disk 작업을 할 수 있다.
WP23 latency qualification 전에는 async/tracked preparation owner로 옮기고 실제 예산을 확인해야 한다.

## Node adapter의 실제 Darwin 시험 경로

`darwin-mach-stream.mjs`는 실제 별도 Node process와 production adapter를 사용한다. 길이393217의
바이트를7001 단위로 분할해 왕복·인증 EOF·stream 자원 반환을 대조하고, queued sender의 실제
close 뒤 audit binding 거절을 관측한다. live handoff는 먼저 원래 connector의 정상 바이트를
받은 다음, 독립 holder에 send right를 넘겨 원래 connector가 살아 있는 동안 같은 body의
foreign packet을 거절하는지 대조한다. 알려진 probe child를 join한 결과는 임의 후손 종료 proof가 아니다.

`verify-native.mjs`는 기존 SDK C 관측을 유지하고 새 Node 세 경우도 각각3회 독립 실행한다.
Node 문법 검사는 SYNTAX_CHECKED이며 C 컴파일 성공으로 표시하지 않는다. 전체 verification
input identity의 전후 일치와 각 stdout/stderr/exit/cleanup을 보존한다. 이 추가가 queue-full
reference count·PID reuse·exec·WP23·G-PROCESS/G-FILES/G-AUTH를 닫지는 않는다. 실제 CI 전에는 NOT_RUN이다.

Node case는 전체 관측45초와 별도 cleanup30초 안에 실제 child/port/listener 반환을 시도한다.
driver의 process ceiling120초와 job90분은 그 바깥이다. 33개 독립 case의 각 ceiling 합66분과
build10분을 job ceiling이 먼저 자르지 않는다. timeout·반환 실패는 관측 성공으로 바꾸지 않는다.

동기식 Security validation의 후속 구현은 [Koffi 공식 async 호출](https://koffi.dev/load#asynchronous-calls)과
[output buffer 수명](https://koffi.dev/output#output-buffers)을 대조했다. callback 전에는 CF reference와
출력 buffer를 반환할 수 없고, 취소/stream close도 그 실제 completion을 기다려야 한다. 이 조사만으로
이 조사만 수행한 당시에는 synchronous leaf가 비동기 전환됐다고 주장하지 않았다.

## 응답자 신원과 기대한 Broker의 결박

추가 source 검토에서 `dialMachChannel`의 live audit pin은 응답한 실제 process만 결박하며,
그 process를 우리가 찾던 Broker로 독립 확인하는 경로는 아직 없음을 확인했다. public bootstrap
name·echo nonce·유효한 Node image 검증만으로 expected Broker identity가 생기지 않는다.
현재 product guard는 그대로이며 일반 CLI의 인증 완료로 판정하지 않는다.

[Chromium의 client 검증](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/base/apple/mach_port_rendezvous_mac.cc#L270)은
별도 `server_requirement_`에 kernel audit trailer를 대조한다. 해당 pinned source의 validate-only와
enforce 설정도 구분했다. 이 구조는 기대 신원의 별도 근거가 필요하다는 대조이며, Chromium의
선택적 requirement나 설정 상태가 OMA의 보안 보장을 대신하지 않는다. 신뢰한 launch/held-state
owner에서 expected Broker identity를 결박하고 서비스 선점·교체·재사용 반례를 확인하는 작업이 남는다.

## Security 호출의 비동기 완료와 반환 owner

`7ebb7268` 후속 source는 [Koffi async 호출](https://koffi.dev/load#asynchronous-calls)의 worker callback으로
두 Security 호출을 실행한다. [출력 buffer 수명](https://koffi.dev/output#output-buffers)에 따라 native
callback 뒤 output을 읽고 CF code/dictionary/data를 반환한다. `result`의 인증 결과와 `returned`의
실제 callback/CF 반환 증거를 분리하여, 인증 거절을 cleanup 성공이나 실패로 바꾸지 않는다.

`bindMachSender`는 watch를 먼저 획득하고 `ready` 뒤 명시적인 `take` 한 번으로 pin을 인계한다.
취소한 acquisition의 `close`는 native callback과 unclaimed watch의 실제 반환을 기다린다. 인계한
pin은 별도 common connection/request owner가 반환한다. 이미 실패한 close는 재시도하거나
다음 호출의 성공으로 숨기지 않는다. Client stream close와 listener의 admission/drain도 이 완료를 join한다.

공통 PacketStream은 [Node26의 construct lifecycle](https://nodejs.org/download/release/v26.0.0/docs/api/stream.html#writable_constructcallback)을
사용해 setup 실패와 construction 이전 취소를 같은 asynchronous destruction으로 돌린다. driver의
native 반환 promise가 settle하기 전에 close/resource-return을 게시하지 않는다. 실제 기존 코드에서
새4개 회귀가 모두 실패했고 수정 뒤 기존4개와 합쳐8/8 PASS다. 이것은 shared-flow 검증이며 Mac
OS 사실을 mock으로 증명하지 않는다. 실제 Mac fixture에 별도 `mach-audit-async` positive/cancel/
claimed-pin owner case를 추가했다. actual Mach token과 Security 함수로 실행하며 CI 전에는 NOT_RUN이다.

driver는 기존 C/Node case를 유지해12개를 각각3회 실행한다. 36개 process ceiling 합72분과 build10분의
바깥에 job100분을 두며 각 case의 관측45초/cleanup30초는 유지한다. 어느 ceiling도 성공 판정의 대체가 아니다.

서비스 선점 방어의 추가 후보로 [같은 고정 sandbox-runtime profile](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/macos-sandbox-utils.ts#L1081)을
확인했다. 기본 거절과 특정 `mach-lookup`만 만들며 이 파일에 `mach-register` 허용은 없다. 이를
OMA의 실제 registration 거절 증거로 사용하지 않는다. 실제 제한된 caller의 등록 거절과 정상 Broker
양성 대조, host/worker 사이 신뢰 경계가 필요하다. 이 후보와 expected-identity 광고/launch 결박을
비교하며, 같은 profile의 `mach-priv-task-port` 등 다른 허용을 OMA에 자동 채택하지 않는다.

정확한 executable 결박의 후보인 `/dev/fd`도 [XNU fdesc 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/miscfs/devfs/devfs_fdesc_support.c#L355)과
[exec permission 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L6716)를
대조했다. fdesc는 VNON vnode와 open syscall의 ENODEV/dup 처리를 사용하며 자체 read는 ENOTSUP다.
exec는 regular vnode를 먼저 요구한다. 이 source로부터 일반 `/dev/fd` open/스크립트 전달을
Mach-O FD 실행과 동일시하지 않는다. 공개 O_EXEC 정의도 정확한 실행 보장의 증명은 아니다.
이것은 pinned source의 추론이고 실제 CI kernel 관측이 아니며 G-FILES는 OPEN이다. 정확한 원문과
범위는 async audit root의 `fd-execution-primary.json`에 보존했다.

## Pi의 실제 walker 이름과 caller limit 보존

전체 Linux에서 find가1100개 중1000개만 반환한 반례를 확인했다. 설치된 Pi1.0.1과
[공식 tool manager](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/utils/tools-manager.ts)는
fd의 실제 system name으로 `fd`, `fdfind`를 순서대로 사용한다. 첫 pass가 fdfind를 사용한 환경에서
OMA의 completion만 fd를 호출해 ENOENT가 났다. 현재 adapter는 실패한 spawn의 실제 close 뒤에만
다음 이름을 시도하며 실행된 walk를 재시도하지 않는다. upstream private module은 import하지 않는다.
실제 fdfind-only probe는 이전 source ENOENT·수정 후1100개 반환을 확인했다.

같은 고정 SDK의 grep은 수치 threshold를 `Math.max(1, limit)`로 유지하고 buffered excess를 읽지
않으며, find는0을 fd의 unlimited로 전달한다. completion이0을1로 줄이거나 fractional grep의
buffered excess를 반환하던 실제 반례도 각각1/300·6/3으로 재현했다. caller 의미를 유지하고 성공한
complete rendering에는 이전 renderer의 truncation metadata를 남기지 않는다. 기존 byte/시간
budget을 늘리거나 입력 bound를 추가하지 않았으며,31개 search 회귀가 수정 뒤 통과했다.

walker 추출 뒤 첫 구조 검사는 이전 `completeSearchText`의 stale exemption과 새 spawn owner 누락을
정확히 거절했다. 실제 spawn site인 `startSearchWalker`로 기존 책임 항목을 옮겼다. 허용 파일·spawn
역할의 수·Society writer 조건은 넓히지 않았고, 실제 close 전 alias 재시도 금지와 parent-pipe
abort/group cleanup의 같은 책임을 명시했다. stale/missing/fence-passing negative control을 유지한다.

## Mac no-follow flags와 공통 ancestry 관측의 후속 수리

[고정 XNU open 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_vnops.c#L412)는
`O_NOFOLLOW_ANY`와 `O_NOFOLLOW`가 함께 있으면 EINVAL을 반환한다. 기존 Darwin adapter는
공통 caller의 후자를 남긴 채 전자를 추가했다. 실제 Node flag에서 후자만 제거하고
ANY/BENEATH/CLOEXEC는 유지한다. [같은 lookup source](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_lookup.c#L466)는
ANY일 때 첫 symlink에서 한계에 도달하도록 하므로 최종 component도 따라가지 않는다.
component별 pathname fallback이나 permission-independent pin의 대체는 추가하지 않는다.
공통 실제 kernel 시험은 정상 file 열기와 중간/최종 symlink 거절을 함께 확인하며 Darwin에서는
raw flags 조합의 실제 EINVAL 대조도 실행한다. 여기의 Linux 통과는 actual Darwin 증거가 아니다.

공통 ancestry의 한 번 읽기는 앞서 관측한 child가 reparent된 뒤 재사용된 부모 PID를 따라갈 수 있었다.
입력 관측으로 구성한4개 반례는 수정 전 모두 실패했다. 경로 전체의 PID/시작 시각/부모 PID를
다시 읽고 마지막에 고정 ancestor를 확인해 관측 불일치를 거절한다. 이는 atomic kernel tree나
임의 후손 종료 보장이 아니며 실제 sender/scope pin과 preflight authority를 계속 요구한다.
[psutil의 실제 parent 구현](https://github.com/giampaolo/psutil/blob/f8b0a6191085f55dc71f7a877c55dce0e4b6feb9/psutil/__init__.py#L839)도
부모 숫자만 신뢰하지 않고 생성을 재관측한다. 그 시간 순서 판정을 복제하거나 새 의존성을 넣지
않았고, OMA는 기존 opaque identity의 동일성과 부모 관계만 대조한다. 반례는 공통 TS 정책 시험이며
Mac kernel 사실을 mock으로 증명하는 시험이 아니다. raw source 구간과 red/green은 nofollow audit root가 소유한다.


## Darwin 스냅샷·메타데이터와 Seatbelt 실행 어댑터 구현

고정 XNU의 [symlink open 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_subr.c#L8366)는
O_SYMLINK에도 O_NOFOLLOW를 더하면 ELOOP로 거절한다. SnapshotReader는 최종 symlink 자체를
열 때 후자만 제거하며, 중간 parent는 두 OS 모두 held root 아래 전체 상대 경로를 한 번에
openBeneath로 해석한다. 개별 component walk로 containment를 약화하지 않는다.

Darwin statAt은 공개 fstatat/AT_SYMLINK_NOFOLLOW로 permission-independent scalar metadata를
조회한다. [XNU stat ABI](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/stat.h#L166)와
[Node26 libuv 변환](https://github.com/nodejs/node/blob/v26.0.0/deps/uv/src/unix/fs.c#L1435)을
대조해 x64의 INODE64 symbol·arm64 native symbol, 144-byte layout, signed/unsigned 값과
nanoseconds를 처리한다. 최초 사용에서 held directory를 실제 Node fstat와 대조하고 실제 SDK
C probe도 크기·offset·scalar width를 assert한다. Node의 공개 fstatSync object에서 metadata
전체를 교체해 Stats/BigIntStats prototype을 보존하며 private constructor/import를 쓰지 않는다.
이는 entry pin·수리·exact reopen·실행 대상 결박을 구현한 것이 아니며 그 거절은 유지한다.

Seatbelt의 deny-default·target same-sandbox·exact IPC filter·literal escaping은 위 고정
sandbox-runtime source를 다시 대조했다. readable/writable/denied/executable host roots와
환경 allowlist를 TS에서 번역하며 IP network는 DR37/46대로 목적지 제한 없이 유지한다.
Unix socket은 exact endpoint, Mach는 exact OMA rendezvous와 좁은 OS 서비스만 허용한다.
Keychain 서비스·Mach register·전역 POSIX IPC는 열지 않는다. nested deny는 모든 allow 뒤에 둔다.

큰 profile은 magic·전체 byte 길이를 갖는 private pipe로 전달하고 선언한 payload와 EOF를 모두 확인한다. producer가 중간에 죽어도 뒤의 deny가 빠진 유효 prefix를 적용하지 않는다. installed launcher의 C는 profile read/FD close, 공개
sandbox_init, absolute execve만 수행한다. 이는 [Chromium의 공개 API wrapper](https://github.com/chromium/chromium/blob/655c7be0fe437601b893c7d886a3cb5e80fc4d6b/sandbox/mac/seatbelt.cc)의
반환/error-buffer 처리와 대조했다. 비공개 compile/apply 함수나 entitlement를 도입하지 않고,
일반 파일만 받는지 미확인인 sandbox-exec -f에 pipe를 가정하지 않는다. Darwin workspace build가
실제 SDK로 launcher를 컴파일하고 결과 bytes/mode를 기존 build cache가 기록한다. 정책·process
관리는 TS이며 native helper에 재구현하지 않는다. recipe는 기존 process의 spawnWithPrivateInputs가 소비할 framed private inputs를 반환한다.
adapter가 직접 spawn하지 않고 stdin/RPC·취소·actual close와 execution scope의 owner는 caller에
남는다. host-state fence FD를 Worker에 누출하거나 미완료 scope의 exemption을 추가하지 않는다. helper/target pathname의 정확한 실행 결박과 전체 descendant
scope는 여전히 G-FILES/G-PROCESS의 별도 미완료 조건이다.

실제 Darwin driver에 파일 write/read 거부·nested denial·symlink/hardlink 우회·자식의 정책 상속,
262144-byte 초과 profile와 별도 stdin의 두 case를 각각3회 추가했다. 총42개 시도이며 새6개를
포함한 최신 실제 Mac 실행은 NOT_RUN이다. compiler/TS 정책 시험을 실제 격리 성공이나 제품
지원으로 승격하지 않는다. 공통 PathView와 목적별 Worker/check/quarantine 조립도 별도로 남는다.


## 공통 PathView와 Pi read 별칭의 적용

PathView는 두 OS의 업무 구현을 만들지 않고 같은 TypeScript root/endpoint 표의 layout만
선택한다. Pi argv/env·relay socket·entry와 session 역변환이 이 표를 쓰며, 역변환 root의 caller
변경 반례는3/4에서 실패시킨 뒤 immutable snapshot으로 수리했다. 최초 시험 문법 오류도
raw에 보존했고 그 실패를 의미 반례로 세지 않는다.

설치된 고정 Pi1.0.1의 examples/extensions/tool-override.ts와 실제 vendored regRead의
registerTool/execute 형태를 대조했다. 새 파일 reader나 vendor patch를 만들지 않고 trusted
registration facade의 public prepareArguments에서 exact /inbox.md 입력만 실제 batch-view file로 전달한다.
원래 normalizer를 먼저 실행하며 execute handler는 직접 호출하지 않고 Pi의 검증/dispatch에 남긴다. 기존 anchored
reader의 schema·이미지/encoding 처리·offset/limit·출력을 유지한다. 이 선택은 공개 SDK의
등록 API와 pinned 구현을 사용하며 private extension registry를 읽거나 바꾸지 않는다.
역변환/별칭은 TS 정책과 실제 일반 파일 read의 증거이며 Mac kernel 사실의 mock이 아니다.
`/home/dev/oma-audit-artifacts/native-2026-10-27-path-view/`가 원시 결과를 소유한다.

## Worker recipe와 고정 Node bootstrap 비교

[Node26 CLI source](https://github.com/nodejs/node/blob/v26.0.0/doc/api/cli.md#node_optionsoptions)의
NODE_OPTIONS grammar와 실제 --import 허용을 대조했다. OMA의 C launcher는 Node 환경을
평가하지 않으므로 sandbox_init 뒤 exec한 target만 승인된 preload를 읽는다. 일반 Node option
허용으로 풀지 않고, trusted read-only 설치 파일의 pathToFileURL 결과와 정확히 같은 한 값만
허용한다. DYLD/LD·NODE_PATH·shell startup/SSH secret은 계속 거절한다. actual Darwin case가
preload에서 실제 host canary read를 거절하는지 확인하도록 준비했고 현재는 NOT_RUN이다.

실제 Linux Node26에서 백슬래시가 포함된 ESM entry가 실패했다. 고정 [ESM resolver source](https://github.com/nodejs/node/blob/v26.0.0/lib/internal/modules/esm/resolve.js#L225)는
encoded separator를 module 경로로 받지 않는다. unsupported 설치/entry를 미리 거절하며
argv의 백슬래시와 filesystem data 경로까지 같은 실패라고 일반화하지 않는다. Node loader를
대체하거나 사용자 경로/accepted bytes를 수정하지 않았다. 초기 실패와 수정 뒤 실제 argv
시험, 공통 Worker/root/env 정책과 Linux 실행 결과는
`/home/dev/oma-audit-artifacts/native-2026-10-27-worker-recipe/`가 소유한다.

공통 role/root/환경 정책은 TS에 있고 platform은 문법과 primitive를 제공한다. App의 기존
Worker spawn owner를 사용하고 Mac native guard는 유지하며 새로운 fence exemption은 없다.
실행 recipe가 있다는 사실은 전체 scope/file binding/auth qualification의 증거가 아니다.

## 명시 Git view의 alternates 형식과 setup FD 전달

실행 환경의 Git2.47.3에 맞춰 [parse_alt_odb_entry](https://github.com/git/git/blob/v2.47.3/object-file.c)와
[C-style quote 구현 비교](https://github.com/git/git/blob/v2.39.5/quote.c)를 읽었다. quoted entry는
unquote_c_style로 byte path를 복원한다. 실제 namespace의 LF/Unicode/quote canonical alias와
thin bundle prerequisite 반례를7/8에서 실패시킨 뒤 UTF-8 byte의 C octal encoding으로 같은
test SHA의8/8을 확인했다. JSON의 unicode escape를 Git 형식으로 가정하지 않는다. 원본 blob
identity·범위·raw는 native-2026-10-27-git-views/git-alternates-primary.json이 소유한다.

추가 FD의 소멸을 soft limit로 판정하지 않는다. 실제 POSIX test가 FD64를 연 뒤 limit16으로
낮추고 production header로6/8만 유지·나머지 close·CLOEXEC 해제를 확인한다. 정리를 생략한
negative actor는 같은 canary를 검출한다. Darwin helper는 기본 closefrom(3)을 유지하고,
explicit keep에만 closefrom(max+1)과 아래 gap close를 사용한다. SDK/helper 전체 실행은
NOT_RUN이며 actual Mac kept-FD control을 driver에 추가한 상태다. 파일/권한/scope 업무는
shared TS에 남으며 descriptor 전달 성공을 arbitrary-descendant death로 승격하지 않는다.


## Mac Git toolchain과 setup 전달 경로 비교

[warren의 실제 수정 c1a6aa32](https://github.com/jayminwest/warren/commit/c1a6aa32aa94ec2e4c34d92b345e8dd060e077b2)의
seatbelt.ts/git-preflight.ts를 확인했다. selected Xcode의 Developer만으로는 shim의
SharedFrameworks 읽기가 부족해 exact app Contents를 readonly로 허용한 사례다. OMA는 실제
xcode-select·xcrun Git·Git exec-path와 canonical paths를 확인하고 selected bundle/CLT의
read/map을 허용한다. quarantine은 exact Git/helper dir만 실행하고 check는 selected Developer의
usr/bin·XcodeDefault.xctoolchain/usr/bin과 자기 writable workspace/tmp 실행을 추가한다. framework
전체에 process-exec를 허용하지 않는다. 실패에 broad /Applications나
unchecked realpath fallback을 추가하지 않는다. 원본 commit·file blob SHA·검토 patch는
native-2026-10-27-setup-recipes/developer-tools-primary.json에 보존했다. 이 비교는 실제 OMA의
Mac 성공 증거가 아니며 Homebrew dylib/full Worker bootstrap은 아직 관측하지 않았다.

비대화형 setup은 일반 CommandSpec.input을 사용하므로 별도 private-input 실행 backend를
만들지 않는다. Worker는 FD3/RPC를 유지한다. actual Darwin fixture는 stdin→정책 적용→/dev/null,
malformed frame/중복 옵션의 pre-exec 거절과 정확한 keep-FD를 실제 helper로 검사하도록 했다.
candidate와 quarantine은 서로의 실패로 뒤의 case가 사라지지 않게 독립 required attempt다.
모든 신규 Mac 관측은 NOT_RUN이며 세 gate와 제품 거절은 유지한다.


## Worker 조립·부팅 fixture 후속 — 2026-10-27

Worker developer observation은 기존 owned execution/staging과 같은 수명을 사용한다. closed
Mac tool metadata와 Runner DI는 Pi engine/lifecycle을 OS별로 복제하지 않으며, selected Contents의
mapping과 Git/helper/bin execution을 구분한다. common storage owner는 ExecutionStaging으로
통합했고 과거 candidate 모듈 export는 제거했다. 이는 scope 또는 executable pin 증거가 아니다.

실제 Linux App launch factory의 ambient 제거·snapshot 전달 회귀와 실제 Darwin Pi RPC/CLI/Git/
npm/자체 script·native build fixture를 구분한다. Darwin OS별96회는 모두 NOT_RUN이고 실제
production preload의 native guard도 유지한다. 이 guard가 거절하면 fixture도 실패해야 한다.
새 code recipe가 full Mac bootstrap 성공 또는 G-PROCESS/G-FILES/G-AUTH를 증명하지 않는다.
§11 config version 경계·실제 Mac 관측·Homebrew dylib와 최종 qualification은 남는다.


### 2026-10-27: fileport와 FD 재열기·실행을 구분하는 관측

[고정 Apple fileport 계약](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/fileport_makeport.2)과
[공개 SDK 선언](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/fileport.h)을 대조했다.
이 API는 기존 open file description을 공유한다. `dup`와 같은 공유와 독립 cursor 재열기,
정확한 executable 선택은 서로 다른 성질이다. [Chromium의 고정 Mach channel 구현](https://chromium.googlesource.com/chromium/src/+/dd480bc4ba0e1b21392f4b5365f77e0182dd3eef/mojo/core/channel_mac.cc)도
FD의 fileport 전달을 사용하지만 OMA의 mode-000 pin·독립 재열기·정확한 exec 보장을 대신하지 않는다.

새 `file-descriptors` case는 실제 `/dev/fd` open과 fileport의 errno·inode·flags·원본/복제 cursor를
각각 기록한다. 별도 private executable copy의 보유 FD·이름 교체·unlink 뒤 실제 exec를 관측하며,
원래 image와 교체 image가 서로 다른 표식을 private reply pipe로 보내고 각 자식을 waitpid로
회수한다. exit0 하나를 정확한 image의 증거로 쓰지 않는다. SDK에 fileport 선언이 없거나 생성이
실패한 경우 다음 연산은 attempted=false/null로 남기고 성공 사실을 만들어내지 않는다.

실제 Linux의 portable oracle은 같은 C helper로 inode/cursor와 원본/교체 image 대조군을
검사한다. 이 Linux 결과를 Darwin record로 넣으면 거절한다. 새 Darwin record는 닫힌 필드와
실제 종료·exec errno·표식·미시도 상태의 일관성을 검사한다. program/budget은 기존 baseline에
case 하나를 더해 총33종×3회, OS별99회이며 기존240분 ceiling 안에 모든 child 상한과
setup/upload 상한이 들어간다. 실제 Darwin 실행은 전부 NOT_RUN이고 세 gate는 OPEN이다.
