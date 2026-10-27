# DR49 native 전환의 구현·검증 경계

2026-10-25 사용자 구현 지시는 이전 문서 정리 범위를 대체한다. 구현 순서는
[명세 P0–P7](../macos-native-spec.md#13-구현-순서와-완료-조건)이다.
VM 지원은 폐기하며 새 구현의 fallback으로 남기지 않는다. architecture 원문과 과거
검토 기록은 변경하지 않는다. accepted plan, receipt와 DB 4의 뜻을 유지한다. HostConfig 4는 Linux 전용 설정을 제거하는 명시적 형식 경계이며 HostConfig 3 원본은 변환하지 않고 보존한다.

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

### 2026-10-26 전체 CI 결과와 완료된 mutation의 응답 경계

`5e369b30`의 전체 baseline/native-all 각각3777/3777·skip0을 실제 artifact에서 확인했다.
앞선 EAGAIN1건과 strict mixed-lag 실패도 보존하며 뒤의 성공으로 원인을 해결했다고 하지 않는다.
기존 PublicDispatcher에서 효과/view 갱신 뒤 답변 전에 event-loop turn을 반환하고,
그 사이 admission이 닫혀도 accepted plan/result는 그대로 답한다(DR58/NATIVE-021).
새2개는 수정 전 실패했고 수정 뒤 기존6개와 합쳐8/8 PASS다. 추가 OS branch나 queue,
durability 생략, 지연 기준 완화는 없으며 전체 후속 입력은 별도 재검증한다.

### 2026-10-26 다른 저장소의 실제 구현 대조

사용자 지시에 따라 sandbox-runtime·Codex·Gemini CLI·Chromium의 고정 source를
[대조했다](native-reference-review.md). 공통 정책/OS adapter 분리와 Chromium의 Mach
rendezvous·kernel trailer 검증을 후보에 적용한다. 기존 실제 timeout을 지우거나 group kill을
전체 scope 사망으로 완화하지 않는다. 새 CI가 실행 전에 종료된 경우도 NOT_RUN으로 남긴다.

### 2026-10-26 status 게시 owner와 Darwin 인증 후보 확대

네 mutation hint가 같은 status를 네 번 영속 게시하던 실제 반례를 재현했다. Broker가
기존 process의 CoalescedWake를 재사용해 게시 작업 하나와 후속 hint 하나를 소유하고,
활성 게시를 drain한 뒤 Store를 닫는다. DR57/NATIVE-020이 그 수명과 owner를 소유한다.
후속 실제 Linux 선택46개 파일 **430/430 PASS**, skip/cancel/todo0·input 전후 동일이다.
이는 전체 Linux suite나 Darwin 제품 qualification의 대체 결과가 아니다.

Darwin 인증의 별도 후보로 Mach 메시지의 SDK audit trailer를 시험한다. 두 sibling sender가
같은 상속 send right에 순서대로 요청을 미리 넣고, 두 번째 body는 첫 sender의 PID를 주장한다.
수신자는 body가 아닌 kernel trailer를 각 메시지에서 얻는다. sender 둘이 살아 있는 경우와
모두 실제 waitpid로 join된 뒤 읽는 경우를 각각3회 실행한다. 후자는 queued identity와 현재
liveness가 다르다는 경계도 확인한다. [고정 XNU의 상속 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/ipc_tt.c#L2168)과
[SDK trailer 정의](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach/message.h#L730)를
조사 기준으로 사용하며 실제 runner kernel과 같다고 가정하지 않는다. 이 후보는 실제 CI
실행 전이고 제품 transport·live pin·scope membership·PID 재사용 증명이 아니므로 G-AUTH는 OPEN이다.
후보의 compile/실행 실패도 기존15개 관측을 지우지 않도록 독립 기록한다.

Coalition도 [고정 syscall source](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/sys_coalition.c#L215)와
[종료 요청 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/coalition.c#L2179)을
대조했다. 해당 source는 privileged coalition 소속을 요구하며 종료 요청은 active count에 따른
종료 통지이지 member 전체 kill/후손 생성 fence가 아니다. source 검토는 현재 Darwin 실행 증명이
아니며, private API/root daemon을 제품의 숨은 의존성으로 추가하거나 G-PROCESS를 닫지 않는다.

### 2026-10-26 전체 회귀와 credential 경계 수리

전체 local3760개 중3759 PASS·1 FAIL·skip0을 확인했다. 남은 시험명 참조를 고친 뒤 실제
설치 prefix의 Personal PTY16개·Keychain real socket15개·소유권 정책·Runner·durable registry의
70/70을 확인했다. input과 실패 원문은 validation을 따른다. 기존 ambient oma PTY 결과를 현재
checkout의 설치 proof로 사용하지 않으며, 실제 prefix 밖 checkout 읽기를 거절한다.

Keychain에서 raw malformed UTF-8가 대체 문자로 수락되는 결함을 실제 socketpair로 재현했다.
공통 strict JSON/UTF-8 owner를 사용하고 VM operation/event·느슨한 옵션을 제거했다. 미사용
AuthContext.cgroup은 현재 source와 fixture에서 삭제했다. 현재 권한은 여전히 native pin과 매 요청
재검사로 판정하며 accepted/receipt/status wire의 뜻은 바꾸지 않는다. DR56과 NATIVE-018/019,
source owner가 현재 물리 순서와 credential 경계를 소유한다. 새/변경 코드는 NOT_REVIEWED다.

추가 G-AUTH 후보인 LOCAL_PEERTOKEN도 조사했다. [Apple XNU의 고정 source](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/uipc_usrreq.c#L900)는 이 token도 peer socket의 last_pid로 조회한다.
이는 구현 source의 관측이며 현재 CI kernel에서의 실행 증명은 아니다. queued-transfer probe가
첫 요청 byte를 읽기 전후의 raw SDK token과 errno/size를 기록하도록 확대했으며 실제 Mac CI로
확인한다. 이 후보나 Linux 통과로 G-AUTH를 닫지 않는다.

### 2026-10-26 전체 시험 실행부 전환

남은 audit/phase4의 실제 namespace·private channel·entry 경로를 연결하고 root strict/type DAG
진단을0으로 복구했다. 실제 CI44개 파일386/386과 Mac/Linux 공통58/58을 확인했다.
정책 전용 fixture와 실제 kernel/Worker/Pi 증거의 범위는 계속 분리한다.

현재 후속 작업은 전체 회귀 실행부다. local discovery가 native 실행 시험을 더 이상 제외하지
않으며 required file 삭제는 실패다. manager opt-in·unit cleanup·vsock CI 준비를 폐기하고
공통 Linux CI 설치 스크립트에 pinned bwrap·도구·변경 없는 global userns 제한 관측을 모았다.
전체 native-all job이 실제 kernel/crash 파일과 필수 oracle을 포함하도록 결박한다.
실행하지 않은 standalone wrapper를 실행한 것으로 표시하지 않는다. 이 후속 실행부 변경의
실제 전체 build/static/runtime/CI 재검증은 진행 중이다.

전체 정적 검사가 잡은 private UTF-8 decoder 세 곳은 공개 `@oma/domain/utf8` owner를
사용하도록 연결했다. candidate setup의 기존 decoder가 BOM을 지워 exec를 허가하던
실제 반례를 보존했고, BOM 거절·오류 poison·허가0을 회귀와 parser corpus에 추가했다.
journal/log의 canonical bytes·형식은 그대로다. Worker spawn의 owner map은 현재 세
경계(portable private pipe, Linux argv/seccomp, App Resident composition)를 정확히
가리킨다. host state FD를 Worker에 넘기지 않으며 outer journaled namespace의 실제
종료를 요구한다. 새 unfenced helper caller를 거절하는 정적 규칙과 negative control도 둔다.

Durable boundary 전수 검사에서 옛 unit owner/checkpoint와 미등록 native publication을 발견했다.
현재 registry는 create-execution checkpoint와 실제 journal 초기화 SIGKILL·candidate checkout
SIGKILL·quarantine 재검증/import를 가리키며, 논리 재시도를 SIGKILL로 표시하지 않는다.
초기 관련 실행72개 중2개 실패를 보존했다. 초기 journal 게시와 writer-lock 획득은 다른
시점이므로 아직 획득하지 않은 lock을 주장하던 시험을 바로잡았다. 실제 quarantine은
bwrap의 data FD 소비로 borrowed bundle cursor가 EOF가 되어 같은 FD 재시도가 실패했다.
공통 Git owner가 기존 native primitive로 같은 inode의 독립 cursor를 소유/반환하도록 고쳤고,
진행한 caller cursor와 교체된 pathname에서도 원래 accepted bytes를 사용하는 시험으로 검증한다.

### 2026-10-26 전체 회귀 전환 후속

미사용 domain cgroup parser/export를 제거하고 systemd parser fuzz를 현재 CandidateSetupStatus의
fragmentation·fatal decode·오류/EOF poison oracle로 교체했다. 불완전한 EOF 후 준비 frame을
다시 넣으면 final exec 권한이 열리던 반례를 재현·수리했다. 첫 오류와 EOF 실패는 같은 owner에
남고 후속 write/finish로 성공을 만들지 못한다.

Principal과 실제 실행 이력이 없는 recovered empty Resident slot은 종료 코드0의 실행으로
표시하지 않는다. 공통 process owner의 status projection과 App 역할 projection이 각각 맡는다.
서로 독립된 실제 namespace owner에서 같은 actor를 시작·중지하는 격리 시험을 추가했다.

CLI·audit2의 기존 요청 키/stream/schema/receipt 단언은 실제 namespace PID2 test driver,
private socketpair와 kernel peer/descent 경로에 연결했다. 테스트 driver는 제품 Worker/Pi의
대체 qualification이 아니며 해당 제품 시험은 별도 실제 시나리오다. 기존 phase5 candidate의
network·옛 cap 초과·owner/request 취소는 실제 scope/journal로 전환했고 전체 namespace 죽음과
원래 오류를 모두 검증한다. 정책 전용 시험은 native pin/권한/죽음 증거를 만들지 않는다.

선택 native integration은42개 시험 파일로 확대했다. 이 목록의 PASS와 root 전체 회귀는
별개다. 현재 audit/phase4의 옛 물리 시험 전환·전체 정적/회귀·최종 설치 대조가 남았다.
원문/기존 ID는 archive에 보존하며 고정 architecture와 authored review bytes는 변경하지 않는다.

### 2026-10-26 직접 실행 연결

공통 `ExecutionCoordinator`가 durable opening→blocked namespace witness flush→현재 권한→
gate release→직접 child close와 전체 namespace 사망→journal retire를 소유한다.
Resident는 공통 `ResidentRuntime`과 private socketpair를 사용하고 Linux leaf는 실제 PID2 child를
따로 pin한다. 공개 byte stream은 각 recvmsg sender를 still-pinned connector와 비교한다.
systemd/path/journald·host relay의 production 소스와 자산은 제거했다. 과거 원본은 archive에
있으며 runtime fallback이나 새 source의 PASS가 아니다. accepted create v3·역사 v2의 구분은 DR52다.

Candidate는 실제 read-only canonical mount에서 정확한 checkout을 만들고 같은 trusted child를
check argv로 exec한다. setup 상태는 exec에서 닫히는 private FD로만 분류한다. quarantine은
공통 TS로 verify 후 전체 scope 사망을 확인하고, 별도 import sandbox에만 canonical RW를 준다.
첫 실제 시험의 `/quarantine` mount target 누락과 Worker private argv의 NUL 검증 누락을
재현·수정했으며 실패 원시 로그도 보존했다.

SIGKILL at opening/witness/effect/retire 경계를 실제 시험했다. witness 직후 init 생존 반례를
DR54의 새 capability 복구로 수정했다. witness 없는 opening은 command를 재생하거나 빈
목록으로 바꾸지 않으며 journal과 증거를 남긴다. 이 잔여 unknown과 기존 Linux state의 누락
journal, historical v2 미완료 unit intent는 지원 완료로 숨기지 않는다.

Resident/Broker/Pi 통합은 실제 Native owner·전용 runner channel·candidate/quarantine으로
연결했다. 시나리오의 가짜 unit 관측·수동 runner spawn은 제거했다. 자동 생성의 첫 실행도
같은 owner를 사용하며 host 환경·내부 tool plan은 owner 생성 때 명시적으로 결박한다.
실제 시험에서 pre-run incarnation으로 stop하던 fixture와 scope 사망 뒤 diagnostic close를
기다리지 않던 수명 경합을 확인했다. 공통 Resident close가 모든 slot과 diagnostic completion을
join하고 새 start를 영구 거절하도록 수정했으며 App의 Native lifetime에 연결했다.
실제 시나리오·crash·정책 시험의 입력별 결과는 validation이 소유한다. 기존 root 시험의 제거된
API 참조 전환, 전체 Linux 회귀, 최종 owner/규범/격리 설치 검증은 진행 중이다.
P4 Darwin 제품 집행과 G-PROCESS/G-FILES/G-AUTH는 계속 미해결이다.

`test/native-integration/tsconfig.json`은 전환한 시험만 strict/noEmitOnError로 컴파일하는
선택 목록이다. `scripts/test-native-integration.mjs`는 같은 목록에서 실행 파일을 도출한다.
Linux CI의 실제 제품·SIGKILL 회귀 범위이며 root 전체 typecheck/회귀의 대체 판정이 아니다.
과거 systemd의 boot-unit/create-unit 경계 ID는 재사용하지 않고 원문을 archive에 보존했다.
현재 crash 시험은 boot-execution/create-execution과 실제 파일 게시·Git import 경계를 사용한다.

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

### OS 경계 시험 확대

`f042b159`의 전체 local은3660/3660·skip0·입력 변경0이고 실제 CI의 Mac26/15·Ubuntu는
각각30/30·build26/26이다. gate는 여전히 BLOCKED다. 사용자가 직접 Mac을 검증할 수 없으므로
`test/native-os-contracts.test.mjs`를 양 OS의 실제 파일/FD/잠금/process/socket 경계 시험으로
추가한다. mock으로 syscall을 대체하지 않으며 새 시험과 독립 Darwin 사례별3회 관측은
이전 전체 PASS와 분리한다. 다음 실행의 결과는 validation 및 raw artifact가 소유한다.

### 2026-10-27 구현 우선 후속

필수 전체 읽기와 DR59 VM 표시/history/relay/invocation 잔존 제거를 진행했다.
`@oma/native`에 Mach inline audit facts·단일 process event·public Security audit-origin leaf,
`@oma/platform-mac`에 audit-peer identity adapter를 추가했다. actor/capability 판단이나 전체
후손 종료 owner가 아니며, shared broker transport 연결과 실제 Darwin 실행은 미완료다.
최신 사용자 범위에 따라 runtime/CI 테스트는 우선 보류하고 타입·정적 검사를 진행한다.

Broker의 peer identity 획득도 필수 kernel port로 분리했다. 현재 Linux composition은 실제
SO_PEERCRED/SO_PEERPIDFD adapter를 주입하고, 공통 PeerAuthenticator는 reference 수명과
현재 actor/scope/capability 판정만 소유한다. kernel port 누락을 ambient Linux fallback으로
대신하지 않는다. Mac identity adapter의 transport 연결과 이 변경의 runtime 회귀는 미실행이다.

후속으로 Broker의 native credential 타입·socket 생성·endpoint 길이 검사를 OS composition으로
분리했다. Broker는 Duplex와 listener 수명 계약을 받고 actor/current grant·요청 ref 수명을
계속 소유한다. `sameSender`는 실제 kernel receive 객체와 원래 pin의 동일성만 대조한다.
Linux는 SO_PEERCRED 복사본을 message 증거로 쓰지 않으며, Mac 후보는 전체 audit token을
대조한다. 공개 BSM accessor로 opaque token을 해석하며 field 위치를 auth 계약으로 쓰지 않는다.

listener의 bind 성공 뒤 preparation 실패도 실제 close callback을 기다리도록 수정했다.
close가 throw하면 불명 상태를 pending으로 남기고 기존 drain grace가 이를 제한한다.
관련 실제 Unix listener 회귀 세 개는 작성했지만 runtime 시험은 NOT_RUN이다.

### Mach byte connector의 source 조립

후속으로 App의 Client/Broker connector 선택에 Mac rendezvous와 byte stream을 연결했다.
공통 PacketStream은 byte 경계·backpressure·인증한 EOF·실제 자원 반환을 소유하고, 기존
BrokerChannel은 connector readiness Promise를 같은 generation 수명으로 소유한다. Mac 이름/nonce는
발견과 응답 연결뿐이며 raw kernel token과 live peer pin의 대체가 아니다. COPY_SEND 실패 뒤
pseudo-receive로 돌아온 두 header reference를 반환하고, 실패한 close를 후속 no-op으로 지우지 않는다.

새 연결은 미검증 후보이며 product profile guard는 유지한다. 실제 Mach 과정·SDK/profile와
process/file gate는 남아 있다. Security validation의 sync I/O를 async/tracked owner로 옮기고
실제 latency도 검증해야 한다. 현재 native port golden의 의도한 변화만 갱신했으며 과거 golden,
public/durable DTO와 과거 authored review는 바꾸지 않았다.

### Darwin 실행기의 FD 전달 수정

Seatbelt 실행기에서 Darwin SDK에 없는 `closefrom` 사용을 발견해 공개 `posix_spawn`의
SETEXEC·CLOEXEC_DEFAULT와 명시 inherit action으로 바꿨다. FD 번호를 한도까지 훑지 않고
같은 PID에서 image를 교체한다. Linux의 kept-list 문법 시험과 Darwin의 실제 FD 상속 시험을
분리했으며 후자는 낮춘 soft/hard 한도 밖 FD, CLOEXEC 표준 stream·명시 channel, 빈 목록,
없는 channel·target, leak 대조군을 검사하도록 준비했다.

SDK snapshot 두 버전·CPU 두 종류의 교차 컴파일과 링크는 정적 검증이다. 실제 Darwin 실행과
G-PROCESS/G-FILES/G-AUTH 수용은 남아 있다. 제품 guard와 accepted data/receipt/auth 의미는
유지한다. 이번 수정의 입력과 시험 결과는 [검증 기록](validation.md)이 소유한다.

### Node의 POSIX group 실행 연결

공통 startProcess의 group 실행 leaf는 Node26이 제공하는 Linux·Darwin 경로를 사용한다.
자기 PID/group/session과 명시 FD를 관측하는 실제 host 시험을 공통 CI에 넣었다. 이는 직접
child의 실행·취소·close를 다루며 전체 후손 scope를 만들지 않는다. PreparationExecutor와
제품 Darwin guard를 이 변경으로 해제하지 않았다. 수용 범위와 미실행 항목은 검증 기록에 남긴다.

### Darwin의 directory-relative xattr leaf

보유한 directory FD를 고정 helper의 FD3으로 전달하고 그 child에서만 public fchdir와
no-follow listxattr를 실행한다. 내용 I/O를 위한 target open 없이 최종 symlink 자체를
관측하며 compression 속성도 포함한다. 보관 여부는 공통 TypeScript가 결정하고, 조회·실행·
출력 해석 실패는 빈 속성 목록으로 처리하지 않는다. helper는 이 metadata 조회 외의 실행이나
mutation을 하지 않는다. 빌드 recipe·source asset·설치 후 실행·공통 CI 시험까지 연결했다.

한 entry 관측은 pin·repair·동일 image 실행 결박을 대신하지 않는다. core native gate와
제품 Darwin guard는 유지하며 실제 Mac 실행은 NOT_RUN이다. SDK 정적 결과와 Linux 실제
시험의 입력은 검증 기록에 따로 남긴다. 전체 코드 복잡도 검토는 native 구현 완료 뒤에 한다.

### Darwin metadata의 ACL·BSD flags 보완

xattr-only helper와 API를 일반 metadata 관측으로 교체했다. 고정 child가 보유 directory
inode에서 public lstatx_np와 filesec_query_property로 최종 symlink 자체의 stat·ACL 존재를
읽고, 전체 BSD flags와 no-follow xattr-list 크기를 TS로 넘긴다. 공통 TS가 보존할 수 없는
metadata의 회수를 거절하며 hot 원본을 유지한다. 명시적 빈 ACL과 ACL flags도 거절한다.
이전 함수·binary 경로는 호환 wrapper로 남기지 않았다. durable DTO나 receipt는 바꾸지 않았다.

실제 Mac ACL·flag·resource-fork 사례는 CI용으로 준비했으며 NOT_RUN이다. SDK 정적 결과와
Linux archive/restore·원본 보존 회귀는 검증 기록에 입력별로 남긴다. exact file pin과 scope,
Broker authority gate는 여전히 열려 있고 제품 Darwin guard도 유지한다. 전체 코드 복잡도
정리는 native 구현·CI용 테스트 준비를 모두 마친 뒤에 진행한다.
