# OMA v2 — 현재 인계

## 현재: 사용자 요청으로 구현 중단·다음 모델 인계

[사실] 2026-10-27 사용자 요청으로 장기 구현 목표는 **paused**다. 재개 기준은
[최신 native 인계 §14](macos-native-spec.md#14-다음-모델-인계)이며, 사용자가 재개하기 전에는
구현·검사·CI·commit/push를 계속하지 않는다.

[사실] 마지막 push 확인 구현은 `eb63b6f245b7ac6ed7589782a20beffac6948ffa`다.
Keychain helper의 빌드·설치·CI 후속 변경은 별도 linked worktree에 **미commit·미push**로
남아 있다. 실제 위치,14/14 초기 시험과 Linux build/strict의 범위, 아직 하지 않은 Mac/최종
검사, 복구 patch는 최신 §14에 기록했다. 메인 README의 사용자 변경을 보존한다.

[사용자 지시] **CI가 현재 불가능해도 구현 자체와 꼼꼼한 테스트 구성을 모두 작성해 두고,
복구 후 실제 검증과 발견된 문제 수정으로 빠르게 마무리한다.** CI 부재를 구현을 미루는
사유로 삼지 않는다. 구현은 최대한 TypeScript·Pi와 작은 OS primitive로 유지하며 경우별 if·
중복 policy·상관 boolean을 쌓지 않는다. native 구현·CI 준비 후 전체 코드 복잡도 검토를 한다.

[사실] 아래 commit/단계별 내용은 당시의 역사 자료다. 그 성공·진행 상태를 현재 WIP나
Mac qualification으로 해석하지 않는다. 아래의 옛 §14.n 표기는 snapshot에 보존한 이전
인계의 번호이며, 현재 작업 순서는 위 최신 §14를 따른다.

## 이전 기록: FD 재열기·정확한 실행의 실제 Darwin 관측 준비

기존 file probe의 held root 관측만으로 독립 cursor와 exact exec를 가정하지 않는다.
새 file-descriptors case와 같은 C helper의 실제 POSIX oracle을 구현했다. 원래/교체 image의
다른 표식, 이름 swap/unlink 뒤 held FD alias 실행, inode/flags/offset/errno와 미시도 상태를
구분한다. Linux 결과의 Darwin 재분류와 불완전·모순된 record는 거절한다.

required matrix는33종×3회·OS별99회이며240분 job budget은 유지했다. Mac 전체 NOT_RUN,
G-PROCESS/G-FILES/G-AUTH와 제품 guard는 유지한다. 유료 Mac CI는 실행하지 않는다.
고정 runtime 입력 `ead1b9960c28b0a8ef0bd2eaf8bead7f883763099aa28d6c57dcd71fea3c099e`(15656개)의
literal common CI225/225·정책35/35·전체 구조 검사가 통과했다. fail/cancel/skip/todo0,
입력/빌드 산출물/보호4개 전후 동일이다. 실제 C mutant3개는 같은 oracle consumer가 거절했다.
결과 기록 뒤 문서 입력과 실제 커밋/푸시는 validation과 native-2026-10-27-file-descriptors/의
final-documentation-post-format/·main-result.json을 따른다. runtime 결과를 새 문서 입력에 재결박하지 않는다.
이전 Config4 입력의 전체 Linux3896/3896·packed26/26은 아래 당시 입력의 결과다.

## 직전: HostConfig 4와 Linux private 실행 배치 전환

HostConfig 4는 rootfs/mount/backend 설정을 받지 않는다. SandboxHost·RunnerConfinement·GitPaths의
Linux 필드도 제거했고 Linux adapter가 state root 아래 rootfs와 검증한 system mount를 선택한다.
공통 설치 surface 관측은 storage로 분리했다. Darwin은 Linux skeleton을 생성하지 않는다.
이전 형식은 파일/managed history/accepted bytes를 변환하지 않고 거절하며 native guard는 유지한다.

현재 runtime 입력 `f68dcf7688b61455d90f61b3b0f4b4cf96f3f353531c84288206776dd72fd2d1`(15651개)의
root strict·전체 구조와 전체 Linux LOCAL 3896/3896가 통과했다. serial13/13·parallel3883/3883,
fail/cancel/skip/todo0·전후 입력과 보호4개 SHA 동일이다. 첫 전체 입력44bcdcbc…의실패24개와
수리 중81/82는 raw로 보존했다. 같은44bcdcbc…의독립 packed install26/26·자체 선언/import/
지정 runtime smoke PASS는 그 입력의 결과로만 기록한다. source package는 그 뒤 바꾸지 않았다.

현재 native golden은 DR60의SandboxHost 한 항목만 갱신했다. 원래 README·architecture·
authored review·역사적 contract golden은 보존한다. 정확한 원문은 validation과 외부
native-2026-10-27-config-format/에 있다. 문서 결과 기록 뒤의 구조 입력과 실제 커밋·푸시는
같은 root의final-documentation/·main-result.json으로 구분하며 runtime PASS를 재결박하지 않는다.

다음은 P0–P7의남은 Darwin 구현/qualification이다. G-PROCESS/G-FILES/G-AUTH, 정확한 executable/
metadata 결박과 Mac 실제 end-to-end·설치 검증은 미완료다. Darwin96회/OS는 NOT_RUN이고 paid
CI는 기본 off다. user systemd/VM fallback·거짓 scope proof·기능 축소로 닫지 않는다.
release Keychain·TCC·sleep/wake·power loss도 별도 미검증이다. master 병합·배포하지 않는다.

## 직전: Worker toolchain 연결과 실제 부팅 검증 준비

Broker-owned leased temporary와 기존 preparation journal slot에서 developer/Git/exec-path를
관측하고, closed transient metadata를 명시적으로 Runner에 전달한다. ambient 값은 제거/덮어쓰기,
Runner는 decode 후 삭제한다. physical Mac PathView·필수 tools·좁은 readonly/exec roots를 조립한
engine effects를 Runner에 주입했다. 공통 ExecutionStaging이 candidate/runtime-tools의 수명과
실제 scope 사망 후 회수를 맡으며 과거 CandidateStaging 모듈/export는 제거했다.

실제 Linux App launch factory·namespace/pidfd·상속 socket 회귀2개와 shared codec/planner/
staging 검사를 추가했다. 첫 runtime-tools durable slot 거절은 raw로 보존하고 기존 preparation
slot 사용으로 수리했다. 실제 Darwin은 Pi RPC/session resume·production preload·oma/Git/npm·
own script/C 실행·권한 거절의 required fixture를 추가해 OS별96회가 준비돼 있다. 전부 NOT_RUN,
paid CI 기본 off, native guard/backend 거절 유지다. 현재 preload의 guard 거절을 성공 부팅으로
표시하지 않는다. 최종 입력별 결과는 validation과 native-2026-10-27-worker-bootstrap/에 기록한다.

당시 다음 경계였던 §11의 명시 config/format version 전환은 위 HostConfig 4 기록을 따른다. Linux 전용 rootfs/layout 검사의 OS 조립을
분리했지만 HostConfig3 필드를 optional로 풀거나 accepted bytes를 재작성하지 않았다.
G-PROCESS/G-FILES/G-AUTH·Homebrew dylib·실제 Mac 부팅과 최종 양 OS qualification도 남는다.

최종 고정 입력 `f370df2f90d8fc5662cc2eb488f0e186a6151b261edfe7357b3989627d47f7d1`(15648개)의 관련194/194·contract7/7,
root strict·전체 구조 검사가 통과했다. 같은 입력의 literal CI 명령도 공통194/194·native leaf3/3·
실제 execution46/46 PASS·skip/cancel/todo/fail0이다. 전후 입력과 보호4개가 같으며 검증 원문은
fixed-worker-final/에 있다. private-state nested root4개 반례는 같은 test SHA로5/9→9/9를
확인했고 common CI의 누락된 root fixture build도 실제 부재 실패 뒤 full build로 수리했다.
현재 source의 전체 Linux/packed/lane 최종 검증과 Mac qualification을 이 결과로 닫지 않는다.

## 직전: Mac check·quarantine 물리 staging과 실행 recipe 연결

App의 Mac 경로에 candidate 전용 lease/workspace/tmp, quarantine의 held bundle FD→새 readonly
input.bundle 복사와 phase별 tmp/repo를 연결했다. shared TS가 체크 환경·exact checkout·verify와
import를 소유하며 OS adapter는 physical view·Seatbelt 문법을 만든다. 원본 accepted FD의 cursor와
bytes는 유지하고, 이전 scope가 살아 있으면 단계 전환·재사용·staging 회수를 막는다. free flock
하나를 arbitrary-descendant 사망 증거로 해석하지 않는다.

비대화형 setup은 기존 CommandSpec.input 소유자로 framed profile을 stdin에 전달한다. C는
sandbox_init 뒤 stdin을 readonly /dev/null로 바꾸고 고정 slot만 유지한다(candidate6/8/9,
quarantine7). Worker는 기존 FD3/profile와 별도 RPC stdin을 유지한다. selected Xcode/CLT의
actual Git/exec-path와 정확한 bundle Contents만 관측·허용하며 framework mapping과 process-exec
허용을 분리했다. lookup 실패 시 broad root나 /usr/bin/git fallback을 만들지 않는다.

도구 경로 관측도 별도 raw spawn으로 실행하지 않는다. Mac developer-tools는 필수 async
execute port를 받고, App은 같은 candidate/quarantine execution slot·현재 authority·retained lease를
전달한다. xcode-select/xcrun/Git 조회의 불명 수명도 staging 회수를 막으며 unowned fallback은 없다.
직접 process 관측을 사용하는 Darwin fixture는 실제 도구/직계 자식만 관측하며 제품 scope proof를
주장하지 않는다.

check/Worker는 자기 writable roots의 script·native addon·build output을 실행할 수 있다.
check의 컴파일러 실행은 selected Developer usr/bin·XcodeDefault.xctoolchain/usr/bin으로 한정한다.
실제 Darwin candidate case는 committed script/C compile/output 실행과 private channel inode
대조까지 준비했으며 현재 NOT_RUN이다. framework 전체의 process-exec grant는 없다.

실제 Linux 관련174/174·contract mutation7/7, 별도 digest 소비자133/133과 build/strict/module이
통과했다. 후속 common staging 소유자까지 고정15643개 ff8ffcd1... 입력 전후/보호4개
동일에서177/177·contract mutation7/7을 확인했다. 도구 조회 execute port의 후속 입력은 별도로 기록한다. 입력 전후 identity·범위·실패와 수리 관계는 validation과
native-2026-10-27-setup-recipes/의 fixed/·digest-consumers{,-green}/가 소유한다. C18의 실패는
mount→root 문구 단언이었으며 같은 outside path의 AUTH_FAILED를 검사하도록 수리했다.

실제 Darwin candidate/quarantine은 별도 case로 서로의 실패에 가려지지 않게 했다. 총30×3=90회
준비·NOT_RUN이며 paid CI는 실행하지 않았다. SDK/OS 증거·G-PROCESS/G-FILES/G-AUTH는 OPEN,
제품 guard와 ExecutionRuntime의 Mac scope 거절은 유지한다. generic permission-independent
pin/reopen/repair를 우회하지 않으므로 실제 entry는 그 primitive가 미완료이면 그대로 실패한다.
staging 회수의 중단/재시도 registry 누락도 실제 gate가 발견했다. 공통 storage의
CandidateStaging.run이 lifecycle을 소유하도록 옮겼고, 실제 Linux에서 lease를 먼저 닫은 live
scope의 free flock만으로는 회수하지 않음·종료 후 retry·boundary owner 자체의 SIGKILL 뒤
fresh owner 재시작·mode000/symlink 외부 원본 보존의3개 회귀가 통과했다. 첫 fixture는 관찰
부모가 journal lock을 보유해 실제 exclusive-owner 거절을 받았고, 부모가 초기화만 하도록 수리했다.
이것은 공통 TS 소유권/실제 Linux 검증이며 Mac scope 또는 파일 primitive의 성공 증거가 아니다.

후속으로 기존 이름 충돌이 원래 데이터를 지우거나 잘못된 owned lease 표시를 남기는 두
negative control을 실제 Linux에서 같은 probe SHA로 실패시켰다. 새 private container를 먼저
exclusive mkdir로 확보한 뒤 내부 leased tree를 만드는 방식은 같은 probe에서 통과했고, 전체
staging4회귀도 통과했다. nonce만 고정된 fixture 데이터이며 FS/EEXIST/flock/scope는 실제 OS다.
도구 위치도 closed developer grammar로 확인한 뒤 Git --exec-path를 실행한다.


첫 전체 구조 검사는 owned temporary의 raw realpath 조회1건을 거절했다. contained openDirectory로
수리했고 새 fence/observation 예외는 없다. 수정 후 결과와 입력은 owned-temp-runtime/summary.json·
qualified-final-summary.json이 구분한다.
Worker의 full bootstrap/CLI/Git toolchain 조립·관측, §11 형식 version 경계와 양 OS qualification은
남는다. 새로운 호스트 상태 fence 예외·durable/public schema·accepted bytes 변경은 없다.

## 직전: Git 실행 view와 명시 FD 전달 기반 구현

candidate/check와 quarantine의 공통 TS에서 Linux 고정 경로를 제거했다. 부모의 명시된
closed view에서 Git/project/workspace 또는 root/bundle/tmp를 받고, 두 Linux producer도 같은
payload를 만든다. 누락·추가 필드·겹친 root·잘못된 UTF-8을 거절하고 과거 payload fallback은
없다. canonical observer도 부모가 선택한 절대 Git을 받으며 기본 Linux 실행은 유지한다.

실제 namespace에서 Unicode/quote/줄바꿈 canonical 경로의 thin bundle prerequisite 실패를
7/8로 재현했다. Git의 C-quoted UTF-8 octal path를 사용해 같은 test SHA로8/8을 확인했다.
accepted bundle FD/cursor·prerequisite·ref/authority·verify→전체 scope 종료→import 순서는 같다.

Seatbelt의 기본 동작은 추가 FD 전체 close이며, 고정 setup protocol만 명시 slot을 보존할 수
있다. C는 전달/close/exec만 맡고 TS가 목록을 검증한다. 실제 production C header를 Linux에서
컴파일·실행해 FD64를 연 뒤 soft limit16으로 낮춰도6/8만 남고 CLOEXEC가 해제됨을 확인했다.
정리를 생략한 negative control은 실제 누출을 검출했다. Mac SDK/helper 실행은 NOT_RUN이며
같은 경계 case를 추가한 실제 Darwin27×3=81회는 준비만 했다. paid CI는 실행하지 않았다.

고정15636개 input `1c17ce3c...` 전후와 보호4개 SHA 동일에서 관련158/158·contract mutation7/7
PASS·fail/cancel/skip/todo0이다. full Linux build·strict types·module도 통과했다. 상세 raw와
최종 문서 입력의 전체 구조 결과는 validation과 native-2026-10-27-git-views/가 소유한다.
이 기록 당시 Mac 물리 staging/목적별 조립은 미완료였다. 후속 source 연결은 위 기록을 따른다.
실제 scope 결합·형식 경계와 세 gate는 계속 남는다.

## 현재: 공통 Worker 정책과 Mac 실행 recipe 연결

actor별 root/lease/설치 grammar를 공통 protocol 검증기로 옮겼고, 읽기/쓰기 directory 표를
Linux bind·Mac Seatbelt·PathView가 같이 사용한다. Mac Worker는 자기 workspace/home/session만
쓰며 설치/공유 roots는 read-only, hidden paths는 deny, broker Mach 이름과 relay/egress Unix
endpoint만 명시한다. 표준 env와 모델용 oma의 Node/CLI 경로도 현재 view에서 만든다. Mac
residentPlan/spawn 조립에 연결했지만 spawn은 기존 native guard로 여전히 차단된다.

client preload는 읽기 전용 설치 파일의 정확한 NODE_OPTIONS 한 값만 허용한다. native loader
주입·NODE_PATH·ambient provider/SSH secret은 계속 거절한다. 실제 Darwin preload가 sandbox
적용 뒤 host read를 거절하는 독립 case를 추가해 OS별26×3=78회를 준비했다. 실제 Mac은
NOT_RUN이고 수동 CI를 dispatch하지 않았다. check/quarantine의 Mac 목적별 조립과 전체
scope/file binding/auth, 형식 경계·최종 qualification은 계속 남는다.

고정15631개 input `1ee75abc...` 전후와 보호4개 SHA 동일에서 관련111/111·contract mutation7/7
PASS·fail/cancel/skip/todo0이다. 실제 Linux Worker 환경/격리/scope·setsid 후손을 포함하며
Mac kernel proof는 아니다. full build와 strict types도 통과했고 최종 문서 입력의 전체 구조
검사는 별도로 기록한다. 초기 compile 타입 widening과 Node ESM 백슬래시 경로 실패, 새 codec
semantic owner 누락 finding도 raw에 보존했다. Node가 거절하는 설치/ESM entry 경로는 미리
거절하며 경로나 과거 accepted bytes를 고쳐 쓰지 않는다. 원본은 validation과
`/home/dev/oma-audit-artifacts/native-2026-10-27-worker-recipe/`가 소유한다.

## 현재: 구현 후속과 실제 Darwin CI 검증 준비

`a1cc3f9c`의 PathView 구현을 작업 브랜치에 push했다. 후속 CI 준비는 macos-26/15 각각
25개 독립 case를3회씩 총75회 실행한다. Seatbelt framing8종·argv/env/stdin·실제 canary FD
누출의 양성/음성 대조·허용/외부 Unix socket을 추가했다. 오류·누락·중복·잘못된 observation
귀속·미실행·정리 실패를 거절하며 실제 build output bytes/mode와 입력 identity를 실행 전후
대조한다. 이는 세 gate를 닫는 proof가 아니며 driver의 정상 관측 완료도 BLOCKED/exit1이다.
Linux에서 초기 기반38/38 뒤 추가 경계/관련 회귀109/109·full build를 확인했다. 입력별 전체
구조 검사는 후속으로 구분하고 원본은 native-2026-10-27-ci-readiness/와 validation을 따른다.
실제 Darwin 신규 case는 아직 NOT_RUN이다. 명령과 최신 결과는 validation을 따른다.
사용자가 Mac CI 할당량 소진을 설명하고 복구를 나중으로 미뤘다. 추가 Mac 실행을 방지하기
위해 push는 Linux만 실행하며 수동 workflow_dispatch의 run_darwin=true일 때 Mac을 포함한다.
지금 Mac workflow를 dispatch하지 않는다. 비실행을 qualification PASS로 세지 않는다.

`a1cc3f9c`의 Native40427540193·Architecture40427540022도7개 job 모두 steps/logs null,
artifact 없음으로 실행 전 실패했다. 원인은 미확정이며 같은 source 재실행 없이 구현과
검증 준비를 이어간다. 변경 source의 실제 Mac 통과를 주장하지 않는다.

## 공통 PathView·논리 inbox 후속 구현

`e4a74b54`의 파일/Seatbelt 구현을 작업 브랜치에 push했다. 후속 PathView는 두 layout의
argv/env/relay/entry와 session 역변환을 연결하고 exact /inbox.md를 기존 hashline read로
전달한다. 현재 정책/일반 read29/29 뒤 관련 실제 Linux70/70·contract mutation7/7, full build와 전체 구조 검사를 확인했다. 입력/보호 SHA 전후 동일이며 원본과 source별 범위는 validation을 따른다.
Mac purpose별 조립·scope/pin/exact exec 보장과 실제42개 Darwin 시도는 미완료/NOT_RUN이다.
Native40420671166·Architecture40420671129의7개 job도 steps/logs null·artifact 없음으로
실행 전 실패했다. 원인은 미확정이고 이 외부 조건 때문에 가능한 source 구현을 중단하지 않는다.

## 앞선 Mac 파일·Seatbelt 실행 어댑터 구현

Mac adapter가 XNU에서 EINVAL인 두 no-follow flag를 함께 전달하던 결함을 수리했다. 강한
ANY/BENEATH/CLOEXEC를 유지하고 일반 file과 중간/최종 symlink 실제 회귀를 추가했다.
공통 ancestry의 변동 관측4개 반례도 먼저 실패시킨 뒤 전체 체인의 identity/부모 관계 재검사로
수리했으며 관련51/51과 독립 설치 후 full build를 확인했다. Mac kernel/전체 후속 증거는 별도다.
§14.15와 validation을 따르며 CI 차단과 가능한 source 구현 작업을 함께 중단하지 않는다.

추가로 SnapshotReader의 최종 symlink flag/전체 parent containment와 Darwin fstatat scalar
metadata를 구현했다. Seatbelt에는 TS deny-default policy·env 검사·private pipe 실행과 최소
public sandbox_init/execve C launcher를 넣었고 Darwin build·실제 독립 probe에 연결했다.
총42개 실제 Darwin 시도는 NOT_RUN이며 목적별 PathView/Worker/check/quarantine 조립, 임의
후손 scope와 permission-independent pin/exact reopen/실행 대상 결박은 미완료다. 최신 결과는
validation과 reference review를 따른다. 과거 Linux/설치 결과를 이 source에 재결박하지 않는다.
최종 source의15617개 고정 입력 `1b53992c...`에서 full build·전체 구조 검사와 관련95/95를 확인했다.
actual Mac은 NOT_RUN이며 세 gate/제품 guard는 유지한다. 기존 process private-input owner를
소비할 recipe만 제공하고, 새로운 무fence spawn이나 scope exemption은 추가하지 않았다.

`29938a42` 현재 source의 독립 설치26/26·공개 API/자체 선언 PASS, 지정 runtime smoke16/16을
확인했다. input `ae96e9f6...`(15613개)과 보호 파일 SHA는 전후 동일이다. 최신 실제 CI는
Native40400373660·Architecture40400373613의7개 job 모두 스텝 실행 전 실패·artifact 없음이다.
P0–P7·최종7개 조건을 다시 대조했으며 Darwin 실행 범위와 파일 pin/exact reopen/실행 대상 결박,
실제 인증/격리/수명 검증이 남았다. §14.14와 validation의 source별 증거를 따르며 완료로 판정하지 않는다.

`bd2049c8` 수리 후 전체 Linux는 **3787/3787 PASS**·fail/cancel/skip/todo0·exit0이며 입력과
보호 파일 SHA는 전후 동일이다. 실제 Mac CI는 새 push에서도7개 job 모두 스텝 시작 전 실패했다.
Mac36개 case는 NOT_RUN이며 세 gate·제품 guard는 유지한다. 정확한 입력별 결과는 validation을 따른다.

`c2745daa`를 작업 브랜치에 push했다. 최신 비동기 audit source의 input `f353d015...`(15612개)에서
**26/26 독립 설치·공개 API/자체 declaration·지정 runtime smoke PASS**, 전후 identity 동일이다.
실제 Native40385385778/Architecture40385385695는7개 job 모두 스텝 실행 없이 terminal failure다.
대기 중이던 마지막 Mac15 job도 같은 handle로 확인했고 artifact는 없다. 실제 Mac36개 case는
NOT_RUN이며 세 gate·제품 guard를 유지한다. 실패 원인은 annotation 본문을 읽을 수 없어 미확정이다.
원시 로그는 `/home/dev/oma-audit-artifacts/native-2026-10-27-async-audit/`를 따른다.

후속 전체 Linux는3772/3784 PASS·12 FAIL이었다. 이전 UUID/DI fixture11건과 실제 find의 fdfind
alias 누락1건을 확인했다. peer-pid의 원래 오류 뒤 cleanup hang을 SIGTERM한 개입까지 raw에 남겼다.
수정 뒤 관련26/26·55/55, 추가 find0/grep threshold 반례의31/31을 확인했다. 이후 새 source 전체는
3787/3787을 확인했으며 과거 실패도 유지한다. §14.12와 validation이 실제 입력별 범위를 소유한다.

P7 입력 대조에서 README와 목록 밖 새 Markdown의 digest 누락을 반례로 확인해 수리했다.
분리 작업트리의15613개 고정 입력에서 문서/목록17/17 PASS이며 §14.13과 validation을 따른다.
원래 사용자 README를 바꾸거나 commit하지 않았고, 그 실제 bytes를 포함한 로컬 binding과 커밋된
README를 쓰는 CI binding은 구분한다. 구조 재생성으로 과거 runtime PASS를 현재 결과로 바꾸지 않는다.

작업 브랜치에 `343d4f85`와 `7ebb7268`을 push했다. Mach byte connector의 마지막 응답/EOF drain,
kernel sender와 port 소유권, App OS 주입과 실제 Darwin Node probe3개를 연결했다. 원래 README와
고정 architecture/과거 review bytes는 유지한다. input `7736cda4...`의 build/types/전체 정적·공통81/81·
generation9/9, 후속 `2e277fba...`의 전체 정적 및 **26/26 독립 설치** 결과는 validation을 따른다.

새 Native40380089004/Architecture40380089190은7개 job 모두 스텝 실행 없이 failure다. 실제 Mac
Node/C 관측은 NOT_RUN이고 원인은 미확정이다. connector가 annotation 본문을 거절해 사용자에게
표시된 오류 문구를 요청했으며 독립 구현 작업은 계속할 수 있다. 같은 입력을 무작정 rerun하지 않는다.

후속 source에서 Security validation을 async 호출과 명시적 callback/CF/watch 반환 owner로 옮겼다.
새4개 shared-flow 회귀는 수정 전 모두 실패했고 수정 뒤 기존4개와 합쳐8/8 PASS다. 실제 Darwin
실행은 여전히 NOT_RUN이다. 다음 source 작업은 응답한 live process와 expected Broker identity의
독립 결박이다. 후자는 Chromium의 별도 server ProcessRequirement와 대조해
현재 빠진 경계를 명시했다. process/file backend, queue-full/reference/PID-reuse/exec 반례와
전체 최신 Linux 회귀 및 실제 Mac CI qualification도 남았다. 세 gate는 OPEN이며 제품 guard를 유지한다.

비동기 후속의 고정15612개 input `f6eaeca1...`에서 build/types/전체 구조 검사·관련52/52·generation9/9·
surface mutation7/7이 fail/cancel/skip/todo0으로 통과했다. raw 실패4개와 수리8/8, 실제 source-bound
검사 원본은 `/home/dev/oma-audit-artifacts/native-2026-10-27-async-audit/`에 있다. 새로운 실제 Darwin
audit async/cancel/claimed-pin case는 CI 실행 전 NOT_RUN이며 과거26/26 설치 결과를 새 source에 붙이지 않는다.

## 9116bb6b와 외부 구현 대조 후속

최신 후속 전체 local은 `native-reference-yield-whole*`의 **3762/3779 PASS·17 FAIL**,
skip/cancel/todo0·940.027초·input `bc7e189f79ebed11044bd9697a3ed987bbb9904781b93b083585e00a78b02a18`
전후 동일이다. 실패는 START의 host/guest 기대값1건과 public-validation fixture의 새 실제
node:timers/promises import 미연결16건이다. 정확한 host 문구와 실제 Node timer module로
fixture를 연결했다. 이후 validation 정책16/16 PASS이며 전체 후속은 별도 재실행한다.
수정된 START/role prompt/status/public validation의 관련33/33도 PASS·skip/cancel/todo0,
18.495초·input `ce9b96e02382976921f01f69b0ae67fe4c1471efd9c3dbba6d37fd4b65fdfd56`
전후 동일이다(`native-reference-fixtures-focused*`).
mock timer·skip·latency 완화를 추가하지 않았다. 외부 대조에는 fs-safe와 XNU spawn/VFS의
실제 조건도 추가했다. VFS의 O_EVTONLY policy는 Apple private entitlement를 요구하므로
제품 의존성으로 채택하지 않는다. 새로운 Darwin 실행 성공으로 해석하지 않는다.

후속 확인: 앞선 세 Linux CI는 모두 종료했다. `5e369b30`의 Architecture40316751983은
baseline과 native-all 모두 성공했다. 각각 전체3777/3777·skip/cancel/todo0이며 baseline의
fast795/795·durable871/871·property34/34·stress13/13·platform29/29도 성공했다. raw ZIP
SHA256과 source/input을 별도로 확인했다. `e997fe37` native-all의 mkdirAt EAGAIN1건과
`e37ad5e0` stress의 mixed lag100ms 실패도 원문을 보존한다. 뒤의 성공이 이 실패를 지우지 않는다.
실제 mkdirat/owned mkdirAt를 각각20만 회와 자식25개로 관측했지만 EAGAIN은 재현하지 못했다.
임의 retry나 관측 실패의 absent 변환은 추가하지 않았다.

응답 지연 후속은 기존 PublicDispatcher owner에서 효과/view 갱신 뒤 reply 전에 event-loop
turn을 반환한다. 새 회귀2개는 수정 전2/2 실패, 수정 뒤 기존6개와 합쳐8/8 PASS·skip0,
입력 `4596344b5a0f10da87f296a04dd9911db91841705c9eddf82ddcb6821e41656d` 전후 동일이다.
admission이 그 turn에 닫혀도 이미 accepted된 plan/result를 재해석하지 않는 시험을 포함한다.
DR58/NATIVE-021·기존 broker owner에 연결했으며 latency budget은 그대로다. 전체 후속 검증은 진행 중이다.

최신 push HEAD는 `9116bb6b667edb0e3a4a31d05e4fa1bb20bb6b1e`다. 아래 기록은 각 제목의
commit 시점이며 최신 상태를 덮어쓰지 않는다. Native40318575316/Architecture40318575321은
모든 job이 스텝·로그 없이 시작 전에 failure로 끝났다. 이를 시험 실패나 PASS로 세지 않는다.
연결 GitHub 도구가 check annotation을 제공하지 않고 local gh도 미로그인이라 상세 원인은
미확인이다. 사용자에게 해당 run의 Errors/Annotations 문구를 요청했고 자동 재실행하지 않는다.
앞선 세 입력의 전체 Linux CI 최종 결과는 위 후속 확인을 따른다.

사용자 지시대로 Anthropic sandbox-runtime·Codex·Gemini CLI·Chromium의 실제 고정 source를
대조하고 [참고 기록](implementation/native-reference-review.md)을 추가했다. 공통 TS/OS adapter
분리와 Chromium의 kernel audit trailer/rendezvous를 반영한다. process group signal·pgrep
snapshot은 OMA의 전체 후손 사망 증명을 대신하지 않는다. Mach 후보를 새 rendezvous case로
교체하되 실제 두 sender·거짓 body PID·queued sender 사망의 조건과 기존15개 Unix 관측은
유지한다. 새 후보는 아직 실제 Mac에서 NOT_RUN이며 세 gate는 OPEN이다. 이 후속은 미push다.

## 5e369b30 후속: Mach 기본 수신과 상속 분리

현재 push는 `5e369b3072608581ba3ff74bc958ac58d97acef4`다. Native40316752088의
Mac26/15 공통 job은 성공했고 Ubuntu 선택 회귀는 아직 실행 중이다. Architecture40316751983,
앞선40315064788/40315665888의 baseline/native-all도 실제 live 상태를 재확인했다. all lane은
file concurrency1·7200초 예산이며 관측이 오래 걸린다는 이유로 재시작하지 않는다.

Mac26 gate의 raw `ci-5e369b30/12646079564/`는 두 compile0·기존15개 OBSERVED·Mach6개
SETUP_FAILED다. 실제 sender send는 성공했지만 부모 receive queue는 첫 send 뒤와 등록 해제
전후 모두0이었다. 상속 실패와 기본 messaging/fixture 실패를 구분할 수 없어 Mach 자체의
불가능으로 판정하지 않는다. 다음 후속은 같은 send/receive helper를 사용하는 독립 self
message와 부모 registered port가 실제 held receiver인지 대조한다. 새 후보는 각각3회,
기존 두-sender 조건도 그대로 실행하며 실제 Mac CI 전에는 NOT_RUN이다. 세 gate는 OPEN이다.
기존 README dirty·architecture/review 원문을 보존하며 master 병합·배포는 하지 않는다.

## e37ad5e0 Mach 후보의 실제 receive 실패

최신 push는 `e37ad5e09af764cd9c956de0d2a81a9fb9c1ef2b`다. Native CI40315665892에서
두 Darwin SDK는 baseline/Mach 모두 compile0을 확인했다. Mach6개는 실제 receive timeout으로
exit2이며 G-AUTH 통과가 아니다. Mac26 raw ZIP SHA 확인 후 `ci-e37ad5e0/12647290712/`에 보존했다.
이는 후보 harness의 수신 실패로서 Mach audit trailer 자체의 불가능 증명으로도 사용하지 않는다.
등록 해제 전후 실제 receive queue와 inherited right type을 기록해 원인을 구분하도록 확대한다.
앞선 e997의 Mac26/15 공통 runtime각74/74·input2a646498… 동일 raw도 확보했다. 두 commit의
전체 Linux CI는 계속 실행 중이며 결과를 확인해야 한다. root README만 원래 dirty다.

## e997fe37 실제 Mac SDK 후속

`e997fe373be6bdeb7cb0dad75be89995c36d4fbf`를 작업 브랜치에 push했다. Native CI40315064670,
Architecture CI40315064788을 실제 실행 중이다. 아래 “최신 push db68”은 해당 기록 시점이다.
Mac26/15 gate raw artifact는 ZIP SHA 확인 후 `ci-e997fe37/`에 보존했다. 기존15개 관측은
각각 OBSERVED다. 새 Mach 후보 compile은 `mach_port_destroy`의 SDK deprecation이
-Werror에 걸려 실패했고6개 case는 실제 미실행/SETUP_FAILED다. 경고 억제 없이 정확히 취득한
send/receive 권리를 각각 deallocate/mod_refs로 반환하도록 수정했으며 실제 CI 재실행이 필요하다.
세 gate는 계속 OPEN이다. 공통/전체 Linux CI 결과도 별도 확인해야 한다.

## status owner 후속 검증과 Darwin 후보 재개점

최신 push HEAD는 아직 db68c111이며 아래 후속은 미push다. 최신 입력
`66ab51c0afa08c39760f8c1e27837113c230e0625564eca6635084724b2d3896`에서 전체 정적 gate
PASS(41.449초), 실행 정책7/7, 실제 Linux 선택46개 파일430/430 PASS·skip/cancel/todo0
(466.084초), 각각 input 전후 동일이다. raw `native-status-owner-{architecture,policy,integration}*`.
read lag20/mixed39/pending620 lag19ms로 기존 budget50/100/50ms를 유지했다.

그 뒤 운영 안내/책임 경계의 폐기된 VM·guest sync·systemd 설명을 현재 구현으로 바로잡고,
Darwin Mach audit trailer의 실제 메시지별 sender 후보를 추가했다. 두 sibling sender가 body의
claimed PID를 공유해도 kernel origin은 별도로 검사하며, queued sender가 둘 다 실제 join된
뒤에도 identity가 남는 경우와 살아 있는 경우를 분리한다. 두 case를 각각3회 실제 Mac CI에서
실행한다. baseline15개 관측과 compile 실패를 독립 보존한다. Linux에서는 이 C를 실행하지
않았으며 G-PROCESS/G-FILES/G-AUTH는 계속 OPEN이다. Coalition source 검토도 제품 종료 proof가 아니다.

다음은 metadata 재생성/정적 gate·독립 packed install26·작업 브랜치 push/실제 Mac26/15 및
Linux 전체 CI 결과·raw artifact 확인이다. 고정 architecture/review와 root README 원래 dirty는
보존한다. 최신 입력의 전체 runtime PASS를 앞선430개 부분 결과로 합성하지 않는다.

위 후속 중 build PASS, ledger는 authored review를 재결박하지 않고 derived stale 판정을 유지했다.
입력 `a3b7fb252b39a2ca6a6fafb1d587c4bfb58785c9e9b7b601950ee0ce20ed8c0b`에서 전체 정적 gate
PASS(41.075초), 독립 packed install26/26 PASS(269.430초), 실행 정책7/7·input inventory18/18 PASS,
각 전후 동일이다(`native-status-mach-*`). 외부 SDK declaration44개와 authored 오류0은 구분한다.
그 뒤 MAINTENANCE의 옛 물리 설명도 pinned kernel scope/실제 sender로 바로잡았다. 제품 code는
같으며 문서 입력 재결박/검사 후 push한다. 새 Mach C는 실제 Mac CI 실행 전까지 NOT_RUN이다.

## db68c111 실제 전체 실행 뒤 후속

현재 HEAD/push는 `db68c111e8c203d3d8b8c821884a4b912597883a`다. 아래 앞선 기록의
“push3f”는 그 기록 시점이며 최신 브랜치 상태가 아니다. user 목표는 전체 native 지원이며 ACTIVE다.
최신 전체 local3775개는 **3773 PASS·2 FAIL**, skip/cancel/todo0·894.612초·input ec7ee8fc… 전후 동일
(`native-whole-db68c111*`). 실패는 host/guest prompt 기대값과 AuthContext.cgroup 제거의 native golden
미갱신이었다. 현재 기대값을 정확히 수정한 후 `native-final-expectations-fixed*`가 PASS다.
과거 golden은 유지하고 새 architecture-surfaces-native.json의 AuthContext만 생성기로 갱신했다.

실제 Native CI40284241937: Linux/Mac15/Mac26 공통각74/74, Linux peer3/3·native37/37·선택386/386
PASS·skip/cancel/todo0. raw zip5개 SHA/source/input을 확인했다. 실제 양 Darwin SDK compile0·각15개
관측 뒤 세 gate는 계속 OPEN/BLOCKED다. LOCAL_PEERTOKEN도 첫 connector byte 읽기 전후 동일한
32-byte token이며 per-message origin proof가 아니다. 원시 `ci-db68c111/verified-summary.json`.
독립 packed install26/26·입력 ec7ee8fc… 전후 동일도 PASS다(`native-post-regression-packed-install*`).

Architecture CI40284241877은 FAIL: native-all3772/3775 FAIL3(prompt/golden/SCN-L02), fast794/795 FAIL1,
durable871/871·property34/34·stress11/11·platform29/29 PASS. baseline local serial7/9 FAIL2(지연),
parallel3762/3766 FAIL4(prompt/golden/Worker autonomy2). 원시 artifact2개 SHA 확인 후 같은 ci 폴더에
추출했다. 이 실제 CI 추가 실패를 로컬2개 실패와 혼동하지 않는다.

후속 실제 중복 status 게시 반례는 네 hint에 fsync 게시4회였다(`native-status-publication-before-fix*`).
Broker가 기존 CoalescedWake로 게시를 coalesce하고 executingTasks에 등록·drain하도록 수정했다.
기존 지연 예산은 그대로다. 새 peer 실제 실행 때문에 pending 상태를 불변으로 보던 시나리오는
frozen message ID별 provider 대본과 실제 scope completion을 사용하고 accepted plan/메일 원본/
완료 delivery를 비교하도록 수정했다. Principal 재시작도 실제 exited를 기다린다. 실패 시 lines/events/
provider body+reply를 보존하며 실제 SCN-L02 CI 원인은 후속 증거로 계속 대조해야 한다.

후속 관련9/9 PASS·skip/cancel/todo0,47.051초·input c88fe60f… 전후 동일
(`native-status-and-scenario-ownership*`). read lag19/mixed43/pending12ms, budget50/100/50ms 유지.
현재 최신 후속은 미push다. DR57/NATIVE-020/source owner를 갱신했으며 공통 메타데이터·전체 정적·
확대46개 integration(지연 oracle 때문에 파일은 serial)·독립 설치·새 push/CI 확인이 다음이다.
기존 README dirty와 고정 architecture/review notes를 보존한다. 실행 중 검증 입력은 수정하지 않는다.

## 최신 후속 입력과 재개점

작업은 ACTIVE이며 목표를 축소하지 않는다. 최신 push는 여전히3f0f6151이다.
현재 후속 전체 local은 **3759/3760 PASS·1 FAIL**, skip/cancel/todo0·934.673초,
input `91909d2aef50ba0583eba51b63f9a1a8b99c0692c707ed9200952d0b1c3d6844`
전후 동일(`native-whole-current-repaired*`). 유일한 실패는 동적 Runner 시험명을 durable registry가
찾지 못한2개 참조였다. 같은 수용 의미의 명시적 시험명으로 수정했다. 이전152개 실패는 재발하지 않았다.
이 전체 실행의 Personal PTY는 ambient oma를 호출하므로 현재 checkout의 설치 증거로 사용할 수 없다.
CI의16개 PTY 실패는 spawn oma ENOENT였다.

후속 실제 설치/통신/경계 시험은 **70/70 PASS**, input
`d3892c6bbb1a34dcf9eacb7a676584ce54dcf44127c1831633cd2408ac6c7dae`
전후 동일·skip/cancel/todo0(`native-keychain-install-source-fenced*`). Personal16개는 현재 runtime
산출물을 시험 소유 prefix에 복사하고 exact executable을 실행하며 checkout module/data 읽기를
거절한다. 이 결과는 독립 packed install26개와 별도다. 첫69/70의 obsolete encoding-fault fixture와
그다음54/70의 source-guard URL import 누락 실패도 raw로 보존했다.

실제 socketpair에서 malformed UTF-8가 credential 대체 문자로 수락된 결함을 재현했고
`native-keychain-invalid-utf8-before-fix.json`을 보존했다. 공통 protocol parseJsonObject를 연결하고
Keychain 채널의 VM op/event·선택적 strict/timeout 모드를 완전히 제거했다. 실제 OS socket15개는
raw UTF-8/BOM/중복 key/correlation/field/type/oversize/EOF/timeout/poison을 검사한다.
현재26개 workspace build와 AuthContext 미사용 cgroup 필드 제거 뒤 build도 PASS다.
73개 현재 source/test의 제거 SHA 목록은 native-auth-unused-cgroup-removal.json이다.
status wire·no-unit 표기·과거 v2 plan reader·accepted bytes/receipt는 유지한다.

DR56·NATIVE-018/019에 현재 native 물리 순서와 credential 경계를 명시하고 source owner를 연결했다.
역사 unit/cgroup 계약의 ID를 재사용하지 않는다. 고정 architecture/과거 review는 변경하지 않는다.
Darwin queued transfer probe에 LOCAL_PEERTOKEN의 raw SDK token 전후 관측을 추가했으며 Linux에서는
검증하지 못했다. 실제 Mac15/26 CI가 필요하고 세 gate는 계속 OPEN이다.
현재 메타데이터 갱신 → 전체 정적 gate → 독립 설치26 → 작업 브랜치 push/실제 CI 확인이 남았다.
기존 root README dirty는 절대 stage하지 않는다. 실행 중 session은 먼저 확인하고 input을 고정한다.

## 최신 전체 실행 후속

최신 push는 `3f0f615113e5cd32116c3959ecb506df6454f5ae`다. Native CI
`40259190478`의 Mac15/26·Ubuntu 공통 각59/59, Ubuntu peer3/3·native37/37·선택386/386을
확인했다. 세 OS input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d`
전후 동일·skip0. zip5개 SHA 확인·raw `ci-3f0f6151/verified-summary.json` 보존. Darwin 각15개
관측의 세 gate는 OPEN/BLOCKED다. Architecture CI `40259190470`는 연결 복구 후 조회하여 baseline/all 모두 failure로 종료된 것을 확인했다.
실패 원시 artifact를 확보해 로컬 후속 수정과 대조 중이다.

같은 입력의 전체 local454개 파일은3759개 중3607 PASS/152 FAIL·skip/cancel/todo0,
881.448초·입력 변경0이다. `native-whole-local-3f0f6151{.log,-status.json}`과
`*-failure-progress.json`(152개 상세)이 원시 근거다. 실패33개 파일은
`docs/archive/native-full-regressions-2026-10-26/`에3f 원문으로 보존했다. 후속18개 파일은
137/148 PASS·11 FAIL(`native-whole-first-repairs*`)이며 전체152건 중11건만 남았다는 뜻은 아니다.

후속 부분 검증: `native-whole-second-repairs` 173/187 PASS·14 FAIL(모두 broker composition),
그 harness의 retainNative/close 순서를 수정한 뒤 `native-broker-policy-current`17/17 PASS.
실제 receipt/lifecycle16/16(`native-receipt-real-scopes`), 실제 connection flood+receipt policy18/18
(`native-flood-and-receipt-policy`), private socket idle/EOF4/4(`native-runner-private-channel-fixed`),
설치된 MCP credential adapter의 실제 소유 namespace 실행1/1(`native-mcp-owned-credential-fixed`) PASS.
각 raw 로그와 input 전후 결박은 audit root에 있다. MCP 첫 실행의 잘못된 slot 실패도 보존했다.
이 부분 결과를 전체 회귀 PASS로 합산하지 않는다. Runner의 과거 AV21 reconnect ID는 재사용하지 않고
새 NATIVE-RUNNER-CONTROL-01로 시험·lane을 결박했다. host shell guard는 그대로다.

최신 `native-current-full-build` 전체 build PASS(입력 c7fe632a… 전후 동일).
Architecture native-all artifact SHA256 `9c334e16238f10e657c20a738dab4afb57470d77af3379ee2f0cb1167cf63d64`
검증 후 `ci-3f0f6151/architecture-all/`에 추출했다. 결과는 PRECHECK_FAILED/NOT_RUN:
installer가 .scratch/bubblewrap에 둔 외부 문서7건이 document-integrity에 걸렸다.
검사 예외를 추가하지 않고 installer의 외부 도구 source/build/bin을 RUNNER_TEMP의 mktemp 디렉터리로
옮겼다. bash -n PASS, 실제 CI 재실행은 아직이다. baseline artifact도 SHA256 확인 후 확보했다. durable843/871 FAIL28, property28/34 FAIL6,
stress8/11 FAIL3, platform29/29 PASS·각 skip/cancel/todo0. 요약은
ci-3f0f6151/architecture-results-summary.json이며 현재 수정으로 재검증해야 한다.
loc --source-digests, dependency graph, compliance inventory 갱신 완료. review ledger invalidate,
verification input binding, 전체 static/회귀와 packed 설치·push/CI 재실행이 다음 작업이다.

현재 후속 변경은 미push다. 실제 candidate SIGKILL에서 의도한 async-iterator ABORT_ERR가
cleanup failure로 중복 보고되던 경합을 재현했다(`native-candidate-kill-race-diagnostic.log`).
실제 close를 반드시 join하고 그 의도한 abort만 중복 오류에서 구분한 뒤 실제7/7을 확인했다
(`native-candidate-close-race-fixed*`). 선언된 workspace 자산도 package 검사에서 빠져 있었으므로
공통 asset snapshot 검증을 연결했다. Keychain의 main.swift와 원래 entitlements를 둘 다 명시한다.
이 최신 변경의 전체 build/static/runtime/독립 설치/CI는 아직 완료되지 않았다.

fixture 후속은 lifecycle await, 실제 native quarantine, runner entry의 실제 private FD,
retired relay의 거절/무효과, native port golden을 수정 중이다. 과거 golden/review 원문은
갱신하지 않는다. 새 golden은 architecture-surfaces-native.json이다. policy mock은 OS/auth proof를
만들지 않는다. 아직 native Receipt/openRun fixture와 connection flood, Runner transport fixture,
MCP command의 owned scope, 두 composition harness·build fixture와 나머지 실패를 수리해야 한다.
현재 실행 중 session/cell은 도구로 확인하고 build/test 중에는 verification input을 수정하지 않는다.

현재 목표는 `docs/macos-native-spec.md` P0–P7의 실제 native 구현·검증이다. 사용자 구현
지시가 이전 ‘문서 정리만’ 범위를 대체했다. VM/systemd 실행 fallback을 남기지 않는다.
기존25개는 고정 개수가 아니며 현재26개 workspace의 공개 API·단방향 runtime/type DAG·
독립 build/test/설치를 유지한다. master 병합·배포와 에이전트 위임은 하지 않는다.

## 현재 코드와 시험

- 작업 브랜치 `work/macos-native-20261025`, 원시 CI 결과를 확인한 push `dd8d7a96634aba03c6e2be06081fabfdbd3ba63f`. 후속 수정은 이 기록 뒤 작업 브랜치에 push하여 실제 CI를 다시 확인한다. 재개할 때 실제 HEAD와 최신 workflow부터 조회한다. 기존 Root README.md의 원래 dirty는 절대 stage하지 않는다.
- 공통 TS ExecutionCoordinator/ResidentRuntime/Supervisor·journal·저장/복구/인증 판정을 실제 Linux namespace/pidfd/private runner/byte sender와 연결했다. Native Worker/Pi·candidate·quarantine·entry/CLI가 실제로 실행된다. systemd/path/journald/host relay·미사용 cgroup parser/export의 production fallback은 제거했다.
- EOF poison 재진입·진단 close 경합을 수리했고 Principal/실행 이력 없는 empty Resident를 exit0 실행으로 표시하지 않는다. accepted bytes/plan/receipt/권한의 뜻은 보존한다. 역사 v2 unit intent reader는 의미 보존용이며 실행 fallback이 아니다.
- 고정 input `e05e5a95...`에서 선택42개 파일359/359·실제 Linux35/35·공통58/58·독립 packed install26/26 PASS, 각 전후 동일·skip0. 26개 workspace build도 PASS다. 실제 결과의 정본은 validation이며 서로 다른 부분 PASS를 전체 PASS로 합산하지 않는다.
- 후속 audit/phase4 전환 뒤 root 전체 strict 진단0·모듈 경계0건 PASS. 실제 native/CLI/entry/lifecycle30/30도 PASS. 작은 manifest child를 direct Node argv로 바꾼 뒤 phase5도11/11 PASS. 현재 선택 CI는44개 파일로 확대했으며 실제 CI의 전체 숫자는 후속 결과에서 확인해야 한다.

## 실제 CI와 재현

실제 `dd8d7a96` CI `40254390815`에서 Mac26/15·Ubuntu 공통 각58/58,
Ubuntu peer3/3·native35/35·확대44개 파일386/386 PASS·skip/cancel/todo0을 확인했다.
세 OS input `4927bdabbfd9b9aba3e478158a2a473174d33c7cfb22d1f6b4a1e89601904ace`
전후 동일. Darwin 양쪽 각15개 실제 관측의 세 gate는 계속 OPEN/BLOCKED다.
원시 zip5개 SHA256/source/input을 확인했고 `ci-dd8d7a96/verified-summary.json`에 보존했다.
이전159의355/359 실패와 원시 재현도 지우지 않는다.

후속 작업 트리에서는 systemd 전용 제외/opt-in/fixture/cleanup을 폐기하고 전체 native 실행부로
전환했다. selection/clock/source-binding 정책42/42 PASS다. Native 설치와 AppArmor 설정은
`scripts/setup-native-linux-ci.sh` 한 owner로 추출했고 cloc pin도 같이 설치한다. Native workflow와
architecture workflow가 이를 부른다. Architecture에는 별도 native-all job을 추가했고 kernel/crash
oracle/file을 all에 결박했다. 새 shared installer와 full job은 아직 실제 CI 재실행 전이다.
현재 로컬 build/static/full Linux 실행부터 확인해야 한다.

후속 전체 build는 PASS이며 정적 rule0건을 확인했다. 세 private UTF-8 decoder는 공통
domain owner로 연결했고 candidate BOM이 허가를 열던 반례를 회귀/corpus로 남겼다.
옮겨진 Worker spawn의 정확한 세 owner를 갱신하고 private-input helper의 새 unfenced
caller를 거절하도록 확장했다. 이 최신 입력의 전체 정적/전체 runtime/CI는 재검증 중이다.

후속 durable gate가 옛 unit owner/checkpoint·미등록 publication5건을 발견했다. 현재 registry로
갱신했고 실제 초기 journal SIGKILL과 candidate checkout SIGKILL을 추가했다. 첫72개 실행의
실패2개(초기 게시 전후 lock 시점, bwrap이 borrowed bundle FD cursor를 소비함)를 보존했다.
공통 Git owner가 exact-inode 독립 cursor를 소유/반환하도록 수정한 뒤 관련72/72 PASS·skip0,
input `8e4e28b7...` 전후 동일이다. 전체 Linux와 새 CI 실행은 여전히 별도 필요하다.

## 아직 남은 독립 작업

1. 전환한 전체 검증 실행부를 실제 전체 Linux suite와 정적 gate로 확인한다. 최초 정책 시험은 retired requiredName3건으로 FAIL이었고 현재 native oracle로 결박한 뒤42/42를 확인했다. manager 거절 guard나 실제 OS 보장을 낮추지 않는다.
2. native가 연결된 root 전체 build·정적 architecture/trace·Linux 전체 회귀와 설치를 현재 입력에 대조한다. 현재 선택359/359나 root strict PASS는 전체 runtime PASS가 아니다.
3. source inventory/owner/trace/review ledger를 실제 source로 갱신하고 후속 작업 브랜치를 push하여 실제 CI를 확인한다. 새/변경 코드는 NOT_REVIEWED다.
4. witness 없는 opening, 기존 Linux state의 누락 execution journal, 미완료 historical v2 unit intent를 빈 상태나 native 완료로 자동 전환하지 않는다. Darwin 세 gate도 독립적으로 미해결이며 Mac 제품 진입은 효과 전에 차단한다.

## 보존·환경·원시 증거

PRIORITY-0가 최상위다. 과거 accepted fact와 현재 권한, 관측과 unknown/부재/죽음,
실제 FD/child/lock completion을 구분한다. `docs/architecture.md`, `implementation/review-notes.json`,
과거 authored review는 변경하지 않는다. 보호 SHA와 원래 README patch 일치를 다시 확인했다.

Node PATH는 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin`이다.
로컬 `/usr/bin/bwrap`은 없으므로 실제 pinned0.12 binary를 private overlay mount로 배치해
실제 Linux 시험을 실행한다. wrapper를 뺀 첫 확대 실행 FAIL/NOT_RUN도 원시 로그로 보존했다.
이 로컬 배치를 실제 service/cgroup·Darwin·provider·power-loss qualification으로 승격하지 않는다.
Mac 실기기는 없으며 GitHub macOS26/15를 실제로 검증한다.

최초 HEAD는 `d571645941e621eec6ccd91504cfbdc72389200d`이고 초기 dirty 사본은
`/home/dev/oma-audit-artifacts/native-2026-10-25/{initial.patch,initial-status.txt,initial-untracked/}`다.
원시 시험·CI·재현·현재 입력 관계도 같은 audit root에 있다. [validation](implementation/validation.md)과
[전환 기록](implementation/native-transition.md)이 구현·실행 범위의 정본이다. 재개 시 실제
working tree·실행 중 cell/session·최신 CI를 먼저 확인하고 활성 목표를 작은 부분 작업으로 줄이지 않는다.

2026-10-27 후속: 필수 문서·machine map·자체 작성 production523개 전체 읽기를 완료한 뒤
DR59 잔존 VM 정책/API를 제거했다. 실제 최신 차이는 working tree와
[최신 native 인계](macos-native-spec.md#14-다음-모델-인계)을 따른다.
새 Mach/audit/process-event leaf와 Mac audit-peer adapter는 source 대조·타입 검사를 진행했고,
production transport 연결과 실제 Mac 실행은 당시 미완료였다. 사용자의 테스트 제외 조건은 구현
견적의 조건이며 원래 목표의 실제 CI 요구를 대체하지 않는다. 과거 PASS를 현재 입력에 붙이지
않고 세 gate를 OPEN으로 유지한다.

후속 Broker transport port 정리로 공통 owner에서 Linux native 타입과 socket 생성·sun_path 검사를
제거했다. 실제 Linux adapter를 App이 주입하며 request/authority/reference 수명은 Broker에 남는다.
native audit token은 BSM by-value accessor로 해석한다. listener의 preparation 실패 뒤 실제
close 대기와 불명 close 보존을 수정했고 회귀를 작성했다. 새 회귀 실행과 Mac 실제 transport는
아직 NOT_RUN/미완료다. anonymous bootstrap check-in과 공개 header 계약 차이를 참고 기록에 남겼다.

`343d4f85` 이후에는 Mac Mach connector를 App Client/Broker 선택까지 source로 연결했다.
새 PacketStream과 handshake는 kernel sender/EOF·backpressure·received/pseudo-received rights의
수명을 명시한다. 이 source 조립은 실제 Mac 지원 PASS가 아니며 세 gate와 product 차단은 유지한다.
Security validation의 sync I/O를 async/tracked owner로 옮기는 작업과 실제 Mac 반례가 남아 있다.
구현 견적의 테스트 제외 조건은 목표의 실제 검증 요구를 없애지 않는다. 최신 실행 결과는 입력별
validation과 외부 원시 로그를 확인하고, 단순 build/type PASS로 OS gate를 닫지 않는다.

원래 목표의 실행 검증도 재개했다. Mach source 연결 후 공통/실제 Linux 메시지·인계·listener
선택21/21, 변경 error/history/package/runner API41/41, native consumer-port mutation7/7 PASS다.
각 input `f86efa4e...`(15611개) 전후 동일·skip/cancel/todo0이며 전체/Mac PASS가 아니다.

새 Darwin Node adapter probe는 실제 process 왕복·인증 EOF/자원 반환, queued sender exit,
live send-right handoff를 각각3회 실행하도록 기존 C 관측 driver에 연결했다. source의 마지막
응답/EOF를 destination port loss보다 먼저 drain하도록 수정했다. input `7736cda4...`(15612개)의
build·types·전체 구조 검사, 공통81/81·generation9/9 PASS와 원시 로그를 새 audit root에 보존했다.
이후 fixture deadline·job ceiling/결과 문서는 별도 입력이다. 실제 Mac 실행과 async Security
validation, process/file backend의 미해결 보장 및 전체/설치 검증은 계속 남아 있다.
최초 bind errno fixture 실패와 잘못된 TS 실행 명령 실패도 새 audit root
`/home/dev/oma-audit-artifacts/native-2026-10-27-mach-connector/`에 보존했다. native 문서의 현재
견적 제외와 실제 최종 검증 요구를 혼동하지 않는다. actual Mac adapter fixture/CI와 async image
validation·process/file backend 및 마지막 전체 검증·독립 설치는 아직 남아 있다.
