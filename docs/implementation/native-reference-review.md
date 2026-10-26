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
