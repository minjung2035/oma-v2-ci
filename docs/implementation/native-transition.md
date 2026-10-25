# DR49 native 전환의 구현·검증 경계

2026-10-25 사용자 구현 지시는 이전 문서 정리 범위를 대체한다. 구현 순서는
[명세 P0–P7](../macos-native-spec.md#13-구현-순서와-완료-조건)이다.
VM 지원은 폐기하며 새 구현의 fallback으로 남기지 않는다. architecture 원문과 과거
검토 기록은 변경하지 않는다. accepted plan, receipt, DB 4, HostConfig 3의 뜻을 유지한다.

## 선행 시험

`scripts/verify-native.mjs`가 실제 OS/SDK/Node와 source SHA를 기록한다. Darwin probe는
실제 SDK로 빌드한 작은 syscall 시험이며 production 정책의 대체 구현이 아니다.
G-PROCESS/G-FILES/G-AUTH는 각각 독립된 미해결 조건이다. 일부 syscall 성공으로 전체
gate를 닫지 않는다. OPEN은 exit 1, setup 실패는 exit 2다. CI artifact는 실패 때도 보존한다.

- G-PROCESS: kqueue 자동 후손 추적 지원과 setsid/FD 폐기 후 group kill의 반례.
- G-FILES: held directory flock, mode-000 event pin/repair, FIFO 종류 관측,
  no-follow/beneath, rename 후 held root, directory flush, no-replace publication.
  exact executable 결박까지 증명되기 전에는 gate가 OPEN이다.
- G-AUTH: Unix peer PID와 endpoint 상속/인계의 차이. peer PID를 현재 socket holder로
  해석하지 않는다. UID·PID·token만으로 새 권한을 부여하지 않는다.

## 진행 기록

기존 변경은 `/home/dev/oma-audit-artifacts/native-2026-10-25/initial.patch`와
`initial-untracked/`에 보존했다. 작업 브랜치는 `work/macos-native-20261025`이며
master 병합·배포는 하지 않는다. 실제 실행 결과의 정본은 validation이다.

### 실제 연결된 공통 코드

- P2: `native/posix-files.ts`의 mkdirat/unlinkat/renameat/linkat를 기존 storage 게시,
  config generation 게시, package staging/수거 owner가 사용한다. 정책과 flush 순서는
  원래 TS owner에 남긴다. Darwin의 openat beneath/no-follow는 실제 kernel이 받는
  flags를 사용하며, 검증되지 않은 permission-independent pin/reopen은 효과 전에 거절한다.
- P3: broker의 ancestry/reuse 판정은 하나이며 `/proc`와 libproc 관측만 native leaf로
  분리했다. broker supervisor의 기존 monotonic window·backoff를 process package의
  RestartPolicy가 담당한다. 이 자체로 systemd 실행 관리의 전환이 끝난 것은 아니다.
- P5의 독립 작업: Restic dump는 storage의 Restic 검증 owner가 streaming hash·PAX·link·
  entry coverage·EOF를 검증한다. App은 storage API를 호출하는 조립만 맡고 GNU tar와 inline child script를 제거한다. JSON inventory가
  정확한 nanosecond metadata와 원본 inode 관계를 별도로 검증하며 source 재관측,
  checkpoint 게시, cold commit, 회수, restore 순서는 유지한다. 관측용 content hash/link/inode는
  메모리에만 추가하며 durable checkpoint 형식·digest 정의는 바꾸지 않는다.

P4의 Darwin 실행과 P6 제품 지원은 gate가 해결되기 전 완료로 판정하지 않는다.
P2의 entry pin/reopen, P3의 Resident wake·로그·backoff 전체 연결, P5의 quarantine/checker/설치, P6의 제품 실행 연결,
P7의 최종 owner/규범 대조는 별도 잔여 작업이다. 공통 코드의 시험 성공을 해당 전체 단계의
완료로 승격하지 않는다.

VM-only App host/guest·entry·VZ·guest 자산·protocol은 실행 소스에서 제거했다. 과거 시험은
원문을 archive에 보존하고 native PASS에 합산하지 않는다. Keychain은 VM framework 없는
독립 primitive로 분리했으며 Darwin 컴파일과 signed release 실행은 각각 별도 검증이다.
Restic child/FD 수명은 process, tar/inventory/tool 파일 검증은 storage, App은 두 API의
조립을 맡는다. storage→process 의존을 추가하지 않고 dump callback으로 연결한다.

이 checkpoint의 Linux 실제 Restic·durable fault 회귀는 27/27 통과했다. production 그래프
472 files에서 runtime/type union 순환·unresolved import는 모두 0개이며 모듈 경계 위반
negative control 3/3을 통과했다. 전체 회귀와 최종 source-bound qualification은 아직 남았다.

### 최초 Darwin 실행

원본 `d80035f701227bca5ee884b0a83f1dea14a403aa`,
[CI 40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898).
macOS 26 arm64(SDK 26.5)와 macOS 15 arm64(SDK 15.5), Node 26.0.0에서 실제 실행했다.
양 OS 모두 NOTE_TRACK=ENOTSUP(45), setsid 후손이 group kill 후 생존,
mode-000 event pin=EACCES(13)을 관측했다. directory flock·directory fsync·linkat
no-replace는 성공했으나 G-FILES 전체 통과가 아니다. peer PID의 fork 상속 관측은
연결/현재 소유자의 구분을 추가 검증할 입력이며 socket transfer 방어의 증명이 아니다.
gate job은 exit 1/BLOCKED이고 artifact를 보존했다. 최초 held-root probe는 mode-000
실패가 뒤 관측에 영향을 줬으므로 다음 실행에서 namespace 관측과 분리한다.

### 공통 조정과 실제 Darwin 회귀

`13d60492`에서 Resident start/stop 순서는 `process/resident-supervisor`가 소유하고
Linux UnitsModule이 이 구현을 실제 호출한다. status·command 완료와 독립 scope death proof를
분리하며 stop 중 한 단계 실패 뒤에도 revoke·terminate·사망 관측을 시도하고 오류를 보존한다.
Linux 관련 회귀 92/92를 통과했다. systemd adapter는 이행 중 reference이며 manager 제거·
공통 wake/log·직접 sandbox scope 연결이 남았다.

[CI 40202613809](https://github.com/minjung2035/oma-v2/actions/runs/40202613809)의 실제
macOS 26/15 arm64에서 common-runtime 각각 20/20, Ubuntu에서 19/19를 통과했다.
같은 source의 별도 Darwin gate job은 OPEN/BLOCKED이며 통과로 합산하지 않는다.
이 CI로 openat 가변 인자·64-bit dirent ABI 결함을 수정·검증했고 SDK layout을 assert했다.
archive verifier 성공은 실제 macOS Restic round trip 또는 G-FILES 전체의 증거가 아니다.

`0d471551`의 [CI 40202936879](https://github.com/minjung2035/oma-v2/actions/runs/40202936879)는
connector와 형제 process인 holder에 SCM_RIGHTS로 socket을 전달했다. 실제 holder 메시지 뒤
peer PID는 connector 생존·종료 양쪽에서 holder를 가리켰다. common-runtime 결과는 이전과
같고 별도 gate는 BLOCKED다. PID 재사용·동시 인계/버퍼 메시지까지 검증하지 않았으므로
G-AUTH를 닫지 않는다.

### 전체 회귀의 첫 실패와 수리

입력을 고정한 첫 전체 local은 52개 실패·70개 skip으로 끝났다. 원시 로그와 입력은
validation에 보존했다. VM-only 시험·PTY·이미지 서명 도구는 실행 대상에서 제거하고
원문을 archive에 보존했다. 유지되는 시험은 실제 native syscall에 fault를 주입하고,
package 목록의 관측 실패는 기존 filesystem port로 검증한다. metadata 손상 수리·원본
보존·primary/cleanup 오류 보존 oracle을 유지한다. 모듈 허용 경계는 확장하지 않았다.

Linux PID namespace의 별도 물리 probe는 setup 실패로 끝났으며 scope proof로 사용하지
않는다. runner/namespace-init/launcher 종료와 재시작 후 fence의 실제 연결은 미완료다.

위 probe의 mount setup을 고친 별도 실행은 Linux 6.12.111·bwrap 0.12.0에서 runner,
namespace init, launcher SIGKILL의 세 경우를 관측했다. setsid·double fork·FD 폐기 후손을
포함해 pin한 process 세 개가 모두 종료했고 init pidfd readiness 뒤 후손 생존은 관측되지
않았다. 원본 `linux-namespace-probe/result-v3.json`은 artifact 디렉터리에 있다.
이는 재시작·fence·권한 연결을 증명하지 않으며 G-PROCESS를 닫지 않는다.

`982658de`의 전체 local은 3640/3640 PASS·skip0·입력 변경0으로 끝났다. 이후 P2 변경은
mailbox·context·spool·cache·package·provision·deployment·Git 준비의 상위 proc 경로를
directory-relative API로 치환한다. nanosecond stat·symlink raw bytes와 게시/flush/cleanup
순서를 보존하며, Darwin의 미검증 pin·attribute 관측은 효과 전에 거절한다. 이것만으로
P2나 Darwin filesystem qualification 완료를 주장하지 않는다.

현재 모듈 경계의 해석은 DR50/NATIVE-008을 따른다. 25개를 고정 개수로 두지 않으며,
새 독립 책임은 새 workspace로 분리할 수 있다. 위 파일 handle 연결은 기존
native/storage/config/Git/App owner에서 수행했다.

다음 P2 작업은 engine-hosted 파일 정책을 SDK 연결에서 분리한다. 26번째 workspace인
`@oma/tool-files`는 Node built-in만 사용하며 containment·inode·hard-link·snapshot 정책을
하나의 TS owner에서 유지한다. 기존 tool-runtime·hashline·LSP 호출자를 공개 API로 연결하고
tool-runtime의 이전 contained-files 소스·export는 제거한다. Linux descriptor 경로는 작은
private leaf에 모으며 Darwin은 효과 전에 거절한다. 이 분리는 G-FILES 해결이나 Darwin
파일 도구 지원이 아니다. workspace graph·독립 설치·기존 도구 회귀 결과는 validation에 기록한다.
이 변경의 Linux 정식 build·strict typecheck·architecture는 통과했다. 관련189/189·별도 SIGKILL17/17과
독립 설치26/26은 같은 입력을 유지했다. 새 모듈의 의존 closure는 자기 자신뿐이고 SDK 진단은0개다.
기존 SDK 소비 모듈의 외부 declaration 진단44개는 별도로 보존하며 authored declaration 성공과 구분한다.

`8c9ef61d`의 고정 입력 P2 회귀는 192/192, workspace 독립 설치는 25/25 통과했다.
[CI 40207646347](https://github.com/minjung2035/oma-v2/actions/runs/40207646347)의 공통 runtime은
Mac 26/15 각각 21/21·Ubuntu 20/20이며 동일한 verification input digest를 기록했다.
별도 gate는 계속 BLOCKED다. queuedTransfer probe에서 인계 전에 connector가 보낸 첫
바이트를 읽기 전·후 모두 LOCAL_PEERPID는 holder였고 두 process는 살아 있었다.
last endpoint PID는 queued request의 sender proof가 아니다. 이는 G-AUTH의 실제 반례이며
auth 정책을 UID/PID-only로 완화하지 않는다. 이후 CLI context의 directory/entry 접근도
native handle API로 연결하며 이 변경의 시험은 앞 결과와 구분한다.

### P3의 commit hint와 공통 wake 수명

`CoalescedWake`는 process의 공통 TS owner다. 활성 callback 하나·pending bit 하나만
유지하며 callback은 생성 owner의 async context에서 실행한다. Reconcile 안에서 발생한
hint가 그 recovery context를 빌려 자기 sweep을 await하는 일을 막는다. 실패는 그대로
caller에게 반환하고, close는 대기 hint를 취소하며 이미 활성인 callback을 종료 proof로
취급하지 않는다.

materialized 0→1 여부는 기존 storage transition owner가 판정하고 transient boolean으로
반환한다. SQL·첫 확정 시각·durable 형식은 바꾸지 않는다. App Mail ledger adapter는 원장을
독립 조회하지 않고 captured T의 반환값으로 수신자만 모아 COMMIT 뒤
Broker.hintWork로 연결한다. rollback·terminal same-key·이미 materialized된 행의 재확인은
새 hint를 만들지 않는다. Broker는 주기 timer와 hint를 같은 coalescer에 연결하며 drain이
활성 task를 기다린다. 실행 권한/desired/GOAL/incarnation/원장·Maildir 판정은 기존 Reconcile
owner에 남는다. inactive status 외에 confirmDead가 필요하며 unknown이면 실행하지 않는다.
이는 P3의 실제 연결이며 직접 sandbox scope·공통 로그·Resident backoff 전체는 아직 남았다.

CLI context의 held-root 교체 회귀를 포함한 관련50/50과 wake/captured T/authority 관련127/127,
실제 Mail→살아 있는 Broker hint 연결을 포함한30/30을 통과했다. 서로 다른 부분 실행이며
현재 입력의 전체 회귀·독립 설치·실제 Mac 결과는 별도로 다시 확인한다. 이전 partial 입력의
독립 설치 결과를 마지막 storage transient 반환값 변경의 검증으로 재사용하지 않는다.

`663adda3`의 [CI 40210726412](https://github.com/minjung2035/oma-v2/actions/runs/40210726412)는
Mac 26/15 각각28/28·Ubuntu27/27, 최종 production 입력의 독립 workspace 설치25/25를
통과했다. 별도 gate는 BLOCKED다. 전체 local은 입력 변경0으로 끝났으나 오래된 Node FS
함수의 fault/checkpoint가 native 경로를 놓친4건이 실패했다. 실제 public mailbox move 직후,
exact-inode cleanup reopen, 생성된 tree의 held-parent close로 옮긴 관련35/35를 통과했다.
실제 SIGKILL·flush 순서·primary/cleanup 오류·잔존 object·lease/FD 회수 oracle을 유지했다.

### Linux 직접 실행의 별도 물리 실험

`linux-scope-recovery-probe/`는 아직 제품 형식이나 실행 backend가 아니다. 기록 게시 전
차단·게시 뒤 차단·실행 뒤 owner/runner SIGKILL을 별도 실험했고 관측한 pin은 모두 종료했다.
단순 block pipe는 writer EOF에서 release byte 없이도 효과를 냈다(`eof-result.json`).
namespace init이 writer를 함께 보유한 대조에서는 같은 EOF에 효과가 없었고, owned init
종료 뒤에도 효과가 없었다. 앞선 fixture가 writer를 두 대조 모두 상속시킨 무효 negative
control과 Unix socket path 길이 setup 실패도 원본을 보존했다. 임의 후손·재시작·auth 전체
qualification 또는 production journal 형식 채택으로 표시하지 않는다. 새 durable 형식을
도입한다면 명세 §11과 registry의 별도 결정을 먼저 따른다.
