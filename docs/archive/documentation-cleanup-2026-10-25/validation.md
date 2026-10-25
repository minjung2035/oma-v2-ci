# OMA v2 — 현재 검증 상태

## DR48 세션 작업공간 보관 (2026-10-25)

프로젝트별 pinned Restic 0.19.1 저장소와 Broker의 pre-provision restore/post-drain archive를
연결했다. immutable checkpoint, hot/cold selection, closed SQLite identity, 현재 native 종료
확인, leased stage와 실제 child close를 분리한다. ACL/xattr·special file·nested mount와 복원할
수 없는 소유권은 회수를 거부한다. 기존 DB/mail/runner/Principal history를 제거하지 않는다.

실제 Git fixture의 index/local refs/staged/unstaged/ignored·mode·symlink/hardlink 왕복과
삭제/게시 후 EIO 재시도는 집중 검사에서 통과했다. 두 세션의 동일한 random 4MiB 파일을
각각 보관했을 때 최종 전체 실행의 shared source 8388608 bytes 대비 unique stored data는
4235172 bytes였다(`local-full-accepted.log`).
원시 fixture 크기는 매 실행마다 달라지며 제품 전체 절감률로 해석하지 않는다.

초기 손상 시험은 Restic tree cache가 손상된 repository pack을 가려 잘못 성공했다.
--no-cache로 실제 repository를 읽게 수정한 후 실제 손상 pack·원본 보존 시험이 통과했다.
추가 actual Store/SQLite 시험은 읽기 전용 조회가 만든 0바이트 WAL 때문에 cold 복원이
막히는 결함을 검출했다. 빈 sidecar만 부재와 동등하게 취급하고 본문/비어 있지 않은 sidecar의
byte identity는 유지한다. 실제 Store row·close/read-only/reopen 회귀를 추가했다. 이 결함을
고치기 위해 첫 전체 local은390초에 SIGTERM으로 중단했으며 입력 changed[]다. 그 실행을
전체 PASS로 계산하지 않는다(`local-full-final-status.json`, `actual-sqlite-diagnosis.log`).
최종 `local-full-accepted`는 serial9/9·parallel4175/4175, 합계 **4184/4184 PASS**다.
fail/cancel/skip/todo0, status0/signal null,951.28초이며 입력15681개
`06811f22e03c6e8eca2e088c1780579a2c3f3525124ec1b3f4b48b4ee77a1c13`, 전후 changed[]다.
최종 build·strict typecheck·architecture/transaction/durable-boundary/document/spec 검사를
통과했다. 같은 입력의 최신 App 독립 설치에서 실제 Restic/Store close/read-only/reopen과
4개 public entry·자체 declaration·설치 runtime을 통과했다. Domain/Native/Storage의 별도
packed 설치도 PASS이며 그 이후 해당 package의 소스 변경은 없다. 설치된 `oma --help`와
managed Restic0.19.1도 확인했다. 증거 소유자는
`/home/dev/oma-audit-artifacts/session-storage-2026-10-25/verification-result.json`이다.

전체 실행 후 결과·운영 안내·인계를 기록하며 입력 동일성을 소급하지 않는다. 그 차이는
`post-runtime-input-relation.json`이 기록한다. 첫 실패/중단을 최종 PASS로 바꾸지 않는다.
실제 systemd/cgroup, Mac/VM, provider, power-loss qualification은 NOT_RUN이다.
새/변경 코드는 NOT_REVIEWED다.

## Society 기동 시간 개선 (2026-10-25)

기준 commit은 `aa28212`다. 새 Human history mirror는 기존 strict protocol clone이
이번 invocation에서 끝낸 객체·연결 검사를 관찰하며, 같은 mirror에 대한 중복 full
fsck만 생략한다. 기존 mirror·경합에서 진 mirror는 이 관찰을 받지 못한다. 디스크에
검증 영수증을 남기거나 재사용하지 않는다. canonical publication은 기존 대기·CAS로
수행하고 기존 저장소 재사용 시 full 검사를 유지한다.

스냅샷은 private stream 한 개를 borrowed stdin FD로 Git fast-import에 넘긴다.
길이로 구분한 raw bytes와 별도 검증한 marks로 파일명·binary·개행·실행 비트·symlink·
SHA-1/SHA-256 의미를 유지한다. Git 자식 수는 파일 수와 무관하다. Linux reader는
held root 아래 부모 경로를 openat2 한 번으로 열며, 매번 현재 경로를 확인하므로 이전
directory FD의 재사용으로 교체를 숨기지 않는다. Mac의 no-follow walk는 유지한다.
private Node compile cache는 Society state/권한과 분리되며 link·공유 디렉터리는 거절한다.
소스 변경·cache 실패·명시적 비활성화 시 현재 source로 실행한다.

같은 설치·동일 프로젝트에서 이전 production module을 load hook으로 실행한 통제된
전후 각3회 중앙값은 화면 **4.50→4.27초**, 첫 provider 요청 **4.77→4.54초**다.
실제 entry·PTY·SDK·Open TUI를 실행하고 provider만 로컬 scripted fixture로 대체했다.
실제 systemd 조작은 전파되는 preload guard로 차단했다. 별도의 실제 Git 준비 측정은
**12.69→9.67초**이며 약24% 감소했다. 각 회차는 새 owned state를 사용하고 현재
worktree bytes를 읽는다. baseline hook은 이전 코드의 의미를 비교하며 이전 배포의
독립 설치 qualification을 주장하지 않는다. 저장소 준비 시간과 Workers/도구의 최종
권한 준비는 구별하며 실제 Linux 서비스/cgroup·Mac/VM/Keychain·provider·power-loss는
NOT_RUN이다.

전후 원시 측정·손상된 history/marks·경로 교체·현재 source 재확인 회귀와 최초 실패를
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/`에 보존한다. 최종 build,
typecheck, static gate, 전체 local, 변경5개 package 설치 및 각 전후 input identity의
판정은 그 안의 `verification-result.json`이 소유한다. 아래 PASS 수치는 이전 입력의
결과다. 원칙·SDK 버전·기능은 유지하며 새/변경 코드는 NOT_REVIEWED다.

## 품질 후속 수정의 검증 소유자 (2026-10-25)

첫 push 체크포인트는 `df713512`이며 현재 작업 브랜치는
`work/code-quality-improvements-20261025`다. 이후 변경은 rollback 실패 연결의
재사용 차단(진행 중인 delivery traversal 포함), immutable 관찰·게시의 최초 손상 및
cleanup 오류 보존, bridge 양방향 backpressure, Personal/operation decode 책임 분리,
공개 Terminal 주입과 검증된 workspace build 재사용이다. SDK 버전·기존 기능·원칙을
유지했으며 private 13 methods/1 field 의존이 남는다. 새 코드는 NOT_REVIEWED다.

후속 입력의 최종 실행 상태와 전후 source identity는
`/home/dev/oma-audit-artifacts/quality-followup-2026-10-25/verification-result.json`이
소유한다. 같은 디렉터리의 원시 red/green, 빌드 timing, 전체 local, strict typecheck,
static gate와 변경 package 설치 로그를 함께 본다. 아래 DR47 수치를 이 입력의
PASS로 전용하지 않는다. 실제 Linux 서비스/cgroup, Mac/VM/Keychain, provider,
power-loss qualification은 계속 NOT_RUN이다.

## DR47 코드 품질 보완 수용 (2026-10-25)

[품질 보완 명세](../code-quality-improvement-spec.md)의 CQ47-01..05를 구현했다.
Config는 모든 등록 FD cleanup을 한 번씩 시도하고 최초 오류와 후속 오류를 보존한다.
Keychain close는 한 종료 Promise를 공유하고 child가 먼저 종료되거나 deadline이 끝나면
타이머를 해제하며 실제 child close까지 소유한다. 실제 로컬 FD와 통제된 helper 종료의
새 negative 검사를 포함한 focused147/147이 통과했다(이전 중간 입력의 진단 실행).

runInteractive는 물리 AST 함수 범위575→94줄이며 입력·선택·UI epoch/panel·session event·RPC·
SDK 생성·disposal을 의미 owner로 분리했다. App의 공개 subpath는140→4개로 줄였다.
실제 소비자인 installer assets와 admin diagnostics3개를 남기고136개 퇴역 경로에
호환 alias를 남기지 않았다. Root integration만 native private Node import로 동일 App
compiled module을 검증한다. production·다른 workspace·target 변조·퇴역 API의 우회는 거절한다.
Host raw SDK private 접근0, 잔여13 methods/1 field는 단일 version/shape 검사 adapter가
소유한다. SDK private 의존 자체를 제거했다고 주장하지 않는다.

현재 코드의 전체 build와 strict typecheck, 전체 static gate가 PASS다.
입력15663개 `4afed4b8591227f4b5d85a2f360b03d30356cf08866f361648137a128a0b1965`에서 전체 local은
**4126/4126 PASS**(serial9 + parallel4117, 469 files, concurrency4),
fail/cancel/skip/todo0, 전후 bytes 변경0이다. Native/Config/Engine/Mac/App 독립 tarball
설치5개도 같은 입력에서 PASS, 변경0이다. App의 공개4개와 실제 bin, 퇴역된 내부 경로
거절, Engine의 compiler-owned JSON과 checked adapter를 설치 상태에서 확인했다.
자체 선언 진단0이며 기존 SDK 외부 선언 진단44는 별도로 기록한다.

원시 근거는 /home/dev/oma-audit-artifacts/quality-improvement-2026-10-25/의
local-full-first.log·*-status.json·*-before.json·*-after.json, changed-isolation.log,
focused-final.log, architecture-first.log, build-all-final.log, change-metrics.json이다.
이전 red 재현은 code-quality-2026-10-25/fault-probes.json에 그대로 보존했다.
실행 중 source/docs/build/install을 쓰지 않았고 첫 serial9 동안 CPU 작업을 병행하지 않았다.
실행 후 문서3개만 갱신한 관계는 completion-evidence.json이 소유하며 기록 뒤 binding을 재검사한다.

Priority0의 durable bytes·현재 권한·unknown·captured T/동일 Store gate 의미와
immutable architecture/review-notes의 해시를 유지했다. 새/변경 코드는 NOT_REVIEWED이며
과거 review를 재승인하지 않았다. 실제 systemd/cgroup·Mac/VM/Keychain·provider·power-loss는
계속 NOT_RUN이다. private bwrap overlay의 local PASS를 실환경 qualification으로 세지 않는다.




## DR46 Lifecycle 독립 전환과 root18 후속 검증 (2026-10-24)

root18 fresh build와 전체 정적 gate는 PASS다(`build-eighteen-root.log`,
`architecture-eighteen-root.log`). `eighteen-local-full.log`는 serial9 PASS와
parallel4,063 PASS/2 FAIL, 합계4,072 PASS/2 FAIL이다. 입력15,561개
`f8d7692266462b67dfce9f9c832b51747dbe276fe83ec38a052d3acdc3bbeaee`, 변화0,
skip/cancel/todo0이다. P08 reflective fixture에 새 독립 Review 인자가 빠졌고 P22의 현재
dispatch surface pin에는 의도적으로 분리한 세 interface가 반영되지 않았다. 실제 missing
activation 거절 조건은 유지하면서 현재 생성자 모양으로 바꾸고 PublicReviewPort·PublicGitPort·
PublicDispatchDependencies의 actual surface만 갱신했다(`review-dispatch-surface-repair.json`).
wire·나머지 interface·negative mutation 판정이나 과거 authored review는 갱신하지 않는다.
두 root fixture와 binding은 exact before/after SHA로만 Lifecycle 전환 baseline에 반영했다.
`eighteen-guards-final.log`는 P08/P22 positive/R38 **3/3 PASS**,
입력15,561개 `99323e921601c8b90d344308c998c126ba69236a21d5cf16f1ed57a742728417`,
변화0이다. 이전 raw 전체2 FAIL을 전체 PASS로 합성하지 않는다.

독립 checkout의 `@oma/lifecycle`은 실제9개 feature src, 명시적9개 공개 entry와 기능 시험을
소유한다. 생성·bootstrap·start/stop·society open/close·ack/follow·recovery와 creation proof의
판정을 유지한다. 구체 Store/Units/Mail·filesystem/process/native를 feature에 넘기지 않는다.
live ledger 조회와10개의 원래 captured transaction closure, 필요한 unit/workspace/Mail/
identity·artifact scope·directory effect를 app에서 연결한다. 기존 constructor의 repository
identity와 live incarnation reader 연결도 app이 소유한다. feature의 activation gate 거절은
그 연결 전에 수행한다. LifecyclePaths의 사용하지 않는 Git/origin 필드는 physical composition
입력으로 분리했으며 실제 confined origin 선택은 그대로 유지한다.

실제 clone/staging·contained inode·TreeLease·native preparation/unknown lifetime 구현은
`@oma/git/workspace`로 이동했다. provisioning HEAD의 물리적 관측도 그 owner가 수행한다.
accepted base/spec/incarnation 비교, 단위 설치, provisioning→enabled의 원래 root T와
opaque creation evidence mint/WeakMap/consume은 Lifecycle의 원래 판정 owner에 남긴다.
readiness가 입증된 뒤 Resident가 소유한 workspace를 재해석하지 않는다. 같은 spec/plan/
receipt와 실시간 stop·권한·activation 조건, 모든 Resident 정지 시도와 unknown death 처리를
유지한다. 새로운 callback bag·old constructor facade·원래 tx를 빌리는 ambient write는 없다.

첫 port typecheck는 아직 옮기지 않은 직접 collaborator/alias 생성자11건을 거절했다
(`typecheck-lifecycle-ports-first.log`). 실제 projection/ID/scope와 새 mandatory 효과를 연결하고
현재 worker bootstrap·SIGKILL child import를 공개 API로 바꿨다. 최종 공식 typecheck
`typecheck-lifecycle-final.log`도 PASS이며 새로운 T의 compile-only async/thenable 및
부적절한 batch 권한 거절을 포함한다. repaired direct typecheck와
새19개 workspace build `build-lifecycle-first.log`는 PASS다. 전체 정적 gate
`architecture-lifecycle-first.log`도 PASS, production14,278개/위반0, durable strongest
injection은61 SIGKILL/11 in-process-fault/23 logical이다.

`lifecycle-focused.log`는 **227/227 PASS**, skip/cancel/todo0,
`isolation-lifecycle.log`는 **19개 모두** 독립 tarball 설치·공개 entry·자산·자체
declaration/runtime PASS다. 두 실행의 입력15,569개
`d897504a6985a29f5534dfdf58b7fa3aa8f89fc99312f909d9c98a8755a77df3`, 변화0이다.
10개 stale tx closure·후속 T 빌리기·Promise/thenable 거절·live incarnation/intent·실제 SQLite
SIGKILL 후 같은 key 재시작·stop fence·권한 취소 뒤 async workspace/units 경계·frozen spec와
origin·owned/untrusted directory·held preaccept·bootstrap/서로 다른 진행 상태를 포함한다.
installed Lifecycle runtime은 ledger 구현/Git/native 없이 자신의 closure에서 current authority,
lineage, activation gate 누락 거절과 모든 Resident의 quiescence를 확인한다. 실제 systemd unit
설치나 macOS/VM·provider turn·전원 차단의 증거는 아니다. 기존 Pi 외부 declaration 진단44건과
author-owned 진단0을 구분한다. actual root source 반영과 새 전체 실행은 별도 원본이 소유한다.
전체25개 전환의 완료 표시는 아니다.

## DR46 Git·Review 독립 전환과 root16 후속 검증 (2026-10-24)

root16 첫 전체 `sixteen-local-full.log`는 serial9 PASS와 parallel4,050 PASS/4 FAIL,
합계4,059 PASS/4 FAIL이었다. 입력15,545개
`d53fe850b9d75dfc4936b94f80669a81802a21083bd026eb2f9dbe328283cba2`, 변화0이다.
실패는 미리 생긴 cur를 없는 것으로 가정한 P04 fixture, ambient unique-symbol 선언을
실행 코드로 본 계약 검사, 옛 Mail 복구 함수 mock 두 건이다. 실제 첫-cur 조건을 빈 디렉터리
제거로 만들고, initializer 없는 declare const unique symbol만 허용하며, 현재 Mail 복구
진입점을 연결했다. 기존 flush 실패·prepared 보존·복구·route 판정은 유지한다.
`sixteen-fixture-final.log`는13/13 PASS, 입력15,545개
`05c2ad4c8465e0c99b76222ee315a550e8deb5a7ac373704fe301ccafc7518ce`, 변화0이다.
후속 전체 `sixteen-local-final-full.log`는4,062 PASS/1 FAIL이다. 같은 입력이며 변화0,
skip/cancel/todo0이다. 남은 R38 실패는 fixture 수정 전 verification binding을 갱신하지 않은
기록 오류다. `sixteen-binding-repair.json`은 binding만 바뀌고 정규화 입력 digest는 같음을
확인한다. `sixteen-provenance-final.log`는 해당 R38 **1/1 PASS**다. 두 raw 전체 FAIL은
합성한 전체 PASS로 바꾸지 않는다.

독립 checkout의 실제 Git/Review src·public exports·직접 의존·기능 시험을 각각
`@oma/git`, `@oma/review`로 옮겼다. Git workflow import는 canonical command adapter를
평가하지 않으며 실제 repository adapter는 별도 공개 entry다. Git은 Mail/Review 구현이나
type에 의존하지 않는다. Review는 Mail과 공통 contracts/domain/protocol만 사용한다.
app은 독립 ReviewAuthorityReader를 먼저 만들고 Git의 동기 pre-CAS gate와 Review에 연결한다.
Git 객체의 reviews 조립/노출은 제거했고 broker/reconcile에는 별도 review port를 연결한다.
Git5개/Review3개 transaction method는 원래 root T의 captured closure이며 stale callback,
다음 T 빌리기, Promise/thenable 탈출과 live transaction getter를 실제 Store로 검사한다.
Review의 corruption 관측은 원래 Store admission gate에 연결하며 이미 접수된 복구 쓰기와
새 acceptance를 구분한다. proof mint/WeakMap·receipt decoder와 single writer의 owner는 유지한다.

Mail이 logical notification·RFC/MIME·freeze를 소유하고 Git은 알림 내용을 선택한다.
기존 submit/context의 literal RFC 옵션과 같은 Date에서 실제 발행 bytes/hash/metadata를
비교했다. 공통 Git observation/ChangedPath DTO, preaccept owner/파일 artifact 선언과 알림
초안은 contracts가 소유한다. 순수 policy/tier/경로/관측 해석과 diff 표시 함수는 domain의
실제 구현 하나를 사용한다. 물리적 관측·CAS·quarantine·snapshot은 Git에 남긴다.

`request-identity-production-call-audit.json`은 authored production471개 파일의18개 호출을
검사했다. 별도 stream 인자를 넘기는 유일한 호출은 폐기할 facade 내부 forwarding이었다.
실제 stream descriptor는 이미 params에 있다. request-hash facade와 옛 세 번째 인자·분기는
제거하고 원래의 method+params hash recipe와 모든 기존 literal byte vector를 유지한다.
옛 stream-positive와 facade 함수 identity 판정은 퇴역한다. 제거한 인자는 새 DR46 음성
검사에서 명시적으로 거절하며, 실제 Store의 다른 payload 재사용 오류와 원래 code/message를
새 domain owner에서 검사한다. 이미 접수된 stored hash/plan/result는 재해시·재작성하지 않는다.

첫 `git-review-focused.log`는412 PASS/41 FAIL, 입력15,561개
`5dee9b7fcb48a792e9a381adb68154e47d6306dbe161b4e4241af7aff17f9f6d`, 변화0이었다.
실패한 기존 private fault seam과 composition mock을 실제 repository/현재 factory로 옮겼다.
옛 협력 객체에 없던 freeze를 새 adapter에 추가한 부분은 원래 mutability로 되돌린다.
captured transaction projection과 발급 증거의 freeze는 유지한다. GOAL 모순 음성 검사는
읽기 전용 EML을 수정하다 실패하는 대신 실제 notification port에서 hash-valid인 다른
bytes/metadata를 만들어 동일한 corruption 판정을 확인한다. 잘못 작성한 새 corruption
oracle은 일반 agent 쓰기 대신 실제 새 acceptOperation을 거절하는지 확인한다.
어떤 복구/권한/바이트 판정도 통과를 위해 반대로 바꾸지 않았다.

최종 공식 typecheck `typecheck-git-review-final.log`도 PASS이며 새 transaction port의
compile-only async/thenable·권한 제한 검사를 포함한다.
현재 새 build `build-git-review-runtime-repair.log`와 전체 정적 gate
`architecture-git-review-runtime-repair.log`는 PASS다. production14,274개, 위반0,
durable strongest injection은60 SIGKILL/11 in-process-fault/23 logical이다.
이전 gate의 옮겨진 boundary owner·미등록 projection·parameterized test title 참조와
빌드 중 생성한 stale graph 실패도 각각 raw log에 남긴다. 빌드가 끝난 뒤 evidence를 갱신한다.
`git-review-repaired.log`는 **475/475 PASS**, skip/cancel/todo0,
`isolation-git-review-repaired.log`는 **18개 모두** 독립 tarball 설치·공개 entry·자산·자체
declaration/runtime PASS다. 두 실행의 입력15,561개
`1706b86e93d81a81d977288631686aa1977a381b1767b4fe38e02de48328a232`, 변화0이다.
실제 Git/Review acceptance 직후 SIGKILL·같은 key retry·재시작·원본 mail/plan/terminal 보존을
포함한다. Git17개/Review3개 공개 entry와 installed canonical CAS/ref·current eligible vote/
cancel gate를 선언한 closure에서 실행했다. 자체 declaration 진단0이며 기존 Pi 외부 진단은
extension/tool-runtime/네 tool에서 각각44건으로 별도다. 실제 macOS/VM·user systemd·provider
turn·전원 차단은 이 검사로 실행했다고 주장하지 않는다. root 반영/새 build/전체 local 결과는
별도 transfer/build/local artifact가 소유하며 전체25개 전환은 아직 미완료다.

Git/Review actual root 전환은 `git-review-transfer-result.json` APPLIED 277개,
conflicts0이다. 변경 전 원본 archive는 `git-review-root-before.tar.gz`이며 `.git`, 설치물,
build output을 Source 대신 복사하지 않았다. 현재 root18개 workspace의 새 실행 결과는
`build-eighteen-root.log`, `architecture-eighteen-root.log`, `eighteen-local-full.log`,
`eighteen-local-status.json` 원본이 소유한다. 위의 과거 raw FAIL이나 stage PASS를 root의
새 전체 PASS로 재해석하지 않는다. authored231개 MJS의 `node --check`는0 failures였으며
provider turn을 실행하지 않았다(`authored-js-syntax-git-review.log`).

## DR46 독립 workspace 전환: 검증 진행 중 (2026-10-24)

root15 새 build와 전체 정적 gate는 PASS다(`build-fifteen-root.log`,
`architecture-fifteen-root.log`). 그 입력의 전체 local `fifteen-local-full.log`는 serial9/9 PASS,
parallel3,946 PASS/91 FAIL로 끝났다(합계3,955 PASS/91 FAIL), skip/cancel/todo0.
입력15,526개 `594200e5a687b98d66a5b2dc7efd346117be948670becdb81f655b534873a5d2`, 변화0.
실패는 compliance fixture의 새 production root 미포함1건, deadline fixture의 옛 부모 경로22건,
surface/TUI fixture의 같은 부모 경로20건, interactive VM fixture의 새 protocol import46건,
source-digest fixture의 제거된 tsconfig 기대2건이다. raw FAIL을 보존하며 이를 전체 PASS로 바꾸지 않는다.
별도 `fifteen-deadlines-diagnostic.log`도 같은 실제 파일의22 FAIL/1 PASS로 부모 누락을 확인했다.

업무 port 기초는 독립 checkout에서 진행 중이다. 공통 row/NewOperation/NewAgent DTO를
contracts로, 실제 닫힌 frozen spec parser와 최소 authority reader를 domain으로, 같은 receipt
projection 구현을 protocol로 옮겼다. storage의 SQL/row 관계 검증·실제 transaction scope는
유지하며 옛 public type/error/projector convenience 경로를 제거했다. pure authority 원래 시험은
domain/test가 소유한다. 실제 업무별 consumer port와 모듈 분리는 아직 남아 있다.
첫 build는 PASS(`build-business-foundation-first.log`)였다. 추가 root15 fixture 수리 중 한 시도의
빠진 dirname import는 compiler가 거절했다(`build-business-foundation-repairs.log`, exit2).
해당 import와 나머지 TUI/source-digest fixture를 고친 현재 build는
`build-business-foundation-current.log`에서 PASS다. root의 고정 입력은 수리 중 변경하지 않았다.

첫 집중 `business-foundation-focused.log`는 218 PASS/17 FAIL이었다. 입력15,529개
`268b2e422d23c14d214dcfe71ff20dc1d372d18310bf5d1a15bb726f00d9d242`, 변화0.
남은 실패는 broker VM mock의 옛 authority import15건과 실제 SIGKILL 후 새 packages 설치
디렉터리까지 임시 파일로 간주하던 fixture2건이다. mock은 실제 domain/agent-spec owner를
연결하고, SIGKILL fixture는 실행 전 설치 트리 전체와 재시작 후 트리를 재귀 비교한다.
수정 후 `business-foundation-final.log`는 **235/235 PASS**, skip/cancel/todo0이다.
입력15,529개 `ad1408a306f3ac686e57d48821d5d7fec761f49d17832358cae17cb129971232`, 변화0.
root15의 실패91건과 권한·frozen row·receipt·preaccept·실제 confined delivery 회귀가 포함된다.
같은 입력의 `isolation-business-foundation.log`는 **15개 모두** 외부 tarball 설치·공개 API·
소유 자산·자체 declarations PASS다. 외부 Pi declaration 진단44건의 구분은 유지한다.
이는 선택한 회귀와 설치 검사 결과이며 root 전체 local PASS는 아니다.

공통 기초는 원래 root에114개 source 파일을 충돌 없이 반영했다
(`business-foundation-transfer-result.json`: APPLIED, conflicts0). 변경 전 working-tree byte는
`business-foundation-root-before.tar.gz`에 보관했다. root fresh build와 전체 정적 gate도 PASS다
(`build-business-foundation-root.log`, `architecture-business-foundation-root.log`). root 전체 local
`business-foundation-root-local-full.log`는 serial9/9 PASS, parallel4,021 PASS/16 FAIL로 끝났다
(합계4,030 PASS/16 FAIL), skip/cancel/todo0. 입력15,529개
`990835f3649e186a34a228f6293c308da11dbf7862d19d56567726e945b468c0`, 변화0.
16건은 public validation VM fixture의 옛 authority import key였다. root와 stage의 같은 fixture만
실제 domain/authority import에 맞춰 고쳤다. `foundation-public-validation-final.log`16/16 PASS,
입력15,529개 `0f3aa7d298e38278d0a2d1932d7fe3adcf592d6ec40d94ab003cb8712bc22638`, 변화0.
raw 전체 FAIL을 집중 PASS로 덮어쓰지 않는다.

독립 checkout의 Mail ledger port는 현재 필요한 조회와7개 transaction method만 노출한다.
broker 조립이 원래 tx closure를 동결해 전달하며 ambient Store mutation은 전달하지 않는다.
DR46-F05 수정 전 `mail-arrival-before-final.log`: 정상1 PASS/음성3 FAIL,
입력15,530개 `8f56c06b71c8ec13f81afb75ad163a65e490dc6b8f20b7ec167f656fcd24a901`, 변화0.
실제 partial/0-byte append와 SIGKILL 뒤 붙은 timestamp를 materialized/succeeded로 승격하던
결함이다. owned append primitive가 regular inode를 pin/repair하고 완전한 record와 parent를
flush하도록 고쳤다. zero progress는 pending으로 남고, 끊긴 tail은 원문을 지우지 않고 줄을 닫는다.
첫 Mail 집중 `mail-ledger-focused.log`는115 PASS/15 FAIL이다. 입력15,535개
`6b39b67c339e85273e9e66c27350654c19a31fa52c78e2e7328fae445b03c7bd`, 변화0.
15건은 새 조립 import에 대한 VM mock key를 다른 상대경로로 쓴 시험 수리 오류였다.
현재 `mail-ledger-final.log`는 **130/130 PASS**, skip/cancel/todo0.
입력15,535개 `3bcdfacb7cba00d46678b15113770217c29e2d254193cd4e14957ac4bb216a9c`, 변화0.
부분/정지 append·실제 SIGKILL/retry/restart·반복 복구, owned mode-000/link/FIFO 거절,
transaction 탈출/다음 T 재사용/Promise·thenable 거절과 기존 mail/batch/receipt/preaccept가 포함된다.
첫 build는 PASS다(`build-mail-ledger-first.log`). 첫 typecheck의 새 compile-only thenable
fixture가 PromiseLike 형식을 만족하지 않아 미사용 ts-expect-error로 실패했다. 올바른
PromiseLike 음성 입력으로 고친 root tsc는 `typecheck-mail-ledger-final.log`에서 PASS다.
그 입력에서는 Mail의 physical effect port와 package 전환이 남아 있었다.

Mail physical effect port의 첫 집중 `mail-effects-focused.log`는212 PASS/1 FAIL,
skip/cancel/todo0이다. 입력15,541개
`d872a2947e91a41a0ab08d23ee39babe444ea0739753a896a576f8ee27a73f7c`, 변화0.
실제 held inode 게시/관측/이동/arrival과 부분 acquisition FD 반환, arrival의 file/parent fsync
오류, 기존 namespace/immutable/fault/SIGKILL/receipt가 통과했다. V20B 한 건은 owned mode-500을
unavailable로 가정한 fixture였다. P0-8 수리가 성공하는 경우와 실제 I/O 실패가 pending을
유지하는 경우를 분리했고 같은 제목의 완료 조건/수락 bytes 불변 의미는 유지한다.
첫 effect build는 scope variable의 never-return flow annotation 누락을 compiler가 거절했다
(`build-mail-effects-first.log`, exit2). 명시적 MailPreacceptScope annotation으로 고친 fresh build는
`build-mail-effects-current.log`에서 PASS다. txClaim의 임의 기본값으로 우회하지 않았다.

현재 분리 checkout에 `@oma/mail`의 실제15개 소스·14개 명시적 public entry·자체 batch 시험과
필수 MailLedger/MailEffects가 있다. DB/파일/receipt/parent effect의 실제 owner는 app 조립이
연결한다. storage는 caller-held inbox capability와 동일 immutable publication 구현을 쓰고,
Mail은 기존 라우팅·metadata/body·배달/정산 결정과 단일 순수 batch renderer를 소유한다.
첫 workspace build는 root에만 runtime dependency를 요구한 check-package에서 nodemailer를
거절했다(`build-mail-workspace-first.log`). 실제 선언 owner별 lock/설치 경계/동일 버전 검증으로
고친 `build-mail-workspace-current.log`는 PASS다. deployment layout에도 실제 Mail을 포함했다.
`modules-mail-workspace.log` 위반0과 `mail-owned-api-smoke.log`의 MIME/body/routing/batch API
검사도 통과했다. 이 smoke는 현재 checkout API이며 아직 외부 tarball 설치 증거가 아니다.
후속 타입/전체 정적 gate·집중 회귀·16개 독립 설치·root 반영은 이어서 실행한다.

현재 Mail workspace의 공식 typecheck와 새 build는 PASS다
(`typecheck-mail-workspace.log`, `build-mail-workspace-final.log`). 첫 전체 정적 gate
`architecture-mail-workspace.log`는 owned-state exception이 불필요하다는 guard에서 FAIL했다.
새 mailbox의 모든 효과가 held descriptor를 사용해 원래 규칙으로 보호되므로 그 exemption을
제거했다. modules/legacy/inventory는 통과했으며 이후 architecture/transaction/durable/document/
spec gate는 이 첫 aggregate에서 미실행이다. 후속 전체 gate를 별도로 실행한다.

수정 후 `architecture-mail-workspace-repair.log`는 전체 PASS다. production14,266개,
위반0이며 durable strongest injection은58 SIGKILL/11 in-process-fault/23 logical이다.
같은 입력의 `mail-workspace-focused.log`는 **305/305 PASS**, skip/cancel/todo0,
`isolation-mail-workspace.log`는 **16개 모두** tarball 독립 설치·공개 entry·자산 exact-set/SHA·
자체 declaration/runtime PASS다. 입력15,545개
`b039d1897b027ecb013a2e2420ed49f265e450eb39884627de2e2eb5b868814b`, 두 실행 모두 변화0.
Mail14개 public entry와 실제 installed MIME/header/body/routing/batch renderer는 storage/native/
app 없이 자기 선언 closure에서 실행했다. caller-held copy fallback, scope 탈출, owned mode 수리,
동일 inode와 acquisition 실패의 실제 FD 반환, file/parent flush 오류와 SIGKILL 복구를 포함한다.
기존 Pi declaration 외부 진단은 extension/tool-runtime/네 tool에서 각44건이며 별도다.

추가 실제 Node syntax 검사 `authored-js-syntax-first.log`는213개 authored MJS 중 한 파일을
거절했다. functional-pi-smoke의 import가 shebang 앞에 놓여 Node가 파싱하지 못했다.
shebang을 첫 줄로 되돌리고 실제 소비자가 없는 workspaceBytes와 폐기된 quota 설명도 제거했다.
이 검사는 provider turn을 실행하지 않으며 해당 functional/provider qualification은 NOT_RUN이다.
과거 provider 없는 extension surface smoke를 이 provider script의 성공으로 확대하지 않는다.

15번째 `@oma/extension`은 독립 checkout에서 실제 조립·핵심 도구·delivery·channel·bridge·
prompt 소스와 기능 시험을 소유한다. 원래 root에 반영했으며 전체 모듈 전환은 미완료다.

root 14 workspace의 새 build 후 전체 local `fourteen-local-full.log`: serial **9/9 PASS**,
parallel **4,026 PASS/7 FAIL** (합계 4,035 PASS/7 FAIL), skip/cancel/todo0.
입력 15,519개 `f8d21a57eb9c4a450fa27cb1bc07ba1428c4b8253560108a9c7a1a545c047121`, 변화0.
7건은 build fixture가 현재 build-workspaces의 workspace-assets helper를 복사하지 않은 같은
원인이었다. raw FAIL을 보존한다. 새 build 후 root 정적 gate는
`architecture-fourteen-root-afterbuild.log`에서 통과했다. 빌드 전 graph가 오래됐던 첫 root gate의
FAIL도 보존하며 뒤의 PASS로 덮어쓰지 않는다.

extension 첫 집중 `extension-focused.log`: **418 PASS/45 FAIL**, 입력 15,523개
`d4c024b4187f84328faec94387d90a53b29b542b602ca82ddb89825d2bac76e2`, 변화0.
새 경로의 부모 디렉터리를 만들지 않은 fixture와 두 잘못된 상대 경로·임시 디렉터리 cleanup을
고쳤다. `extension-repaired.log`: **481 PASS/1 FAIL**, 입력 15,524개
`e3b75e4fa9d81edfe376c6a68ef526ed4abeab4b1f197b3df43d10a2819d3a42`, 변화0.
마지막 한 건도 tool-surface fixture의 같은 부모 경로 문제였다.

DR46-F03은 이동한 extension dirname에서 app preload를 추정하던 분리 checkout의 회귀다.
`preload-owner-before.log` **0 PASS/1 FAIL**, 입력 15,524개
`849f67312f6c4dd99733d40dbf5f930baabc2cdf12f8c33ad343548f537980c6`, 변화0으로 먼저 확인했다.
현재는 Resident/Principal이 DEPLOYMENT_LAYOUT의 실제 app-owned preload를 사용한다.
DR46-F04의 옛 T117 unshare-only probe는 제품의 network 차단 증거가 아니므로 퇴역했다.
새 시험은 실제 planPiSpawn→spawnSandboxed의 host-loopback marker와 --share-net 제거 음성
제어를 비교하며 파일/credential 봉인도 유지한다. 기존 T117의 나머지 실제 경로는 유지한다.

수정 후 `extension-current-final.log`: **162/162 PASS**, skip/cancel/todo0. 입력 15,525개
`bb62e0249cdd300a9b672a5b4fe3d34bc69f2a440a3a48b94539d70d64fbb792`, 변화0.
root에서 실패했던 build-stamp 7건, 새 preload/namespace 오라클, 실제 bundled Pi confined
delivery/receipt·custom mail·installed CLI, receipt publication/observation/rollover/kill 경계가 포함된다.
같은 입력의 `extension-functional.log`도 실제 Pi가 새 core 경로를 로드하고 예상 활성 도구를
보고했다. model turn이 없는 profile의 group expansion은 관찰되지 않았으므로 그 부분은
이 실행의 PASS가 아니다. provider/systemd/native Mac/VM/power-loss qualification도 아니다.
`isolation-extension.log` 첫 시도는 새 installed smoke의 messageId fixture가 ordinal을
누락해 runtime read에서 거절됐다. 앞 4개 package만 완료했고 이후 package는 이 실행에서
미실행이다. 입력 `59650f38895ead075c10c0bc38a39af49d726226f5ed66e5d691f21a1117ad5b`, 변화0.
실제 domain/derived 생성자로 양성 fixture를 고치고 전체 설치를 별도로 재실행한다.
`isolation-extension-final.log`는 **15개 모두** tarball 외부 설치·공개 API·자산 exact-set/SHA·
자체 declarations PASS다. 새 extension의 실제 조립 등록·archive read·Personal ask entry와
네 tool의 installed registration/LSP 진단·종료/hashline read도 통과했다. 입력 15,525개
`f4e5e6f78a220dfd99f3a74d2fda764dfe1ba25173b013f91716682c23521748`, 변화0.
외부 Pi declaration 진단은 extension/tool-runtime/네 tool에서 각44건으로 별도이며 upstream
타입 전체 PASS로 확대하지 않는다.
공식 `npm run typecheck`와 새 build도 PASS다(`typecheck-extension-final.log`,
`build-extension-transfer.log`). `isolation-extension-transfer.log`의 최종 설치 재검사도 15개 모두 PASS다. 입력 15,525개
`7d84f2f52273695c967b8fdbace5018c20be07875077c8421a54a535bc2816c6`, 변화0.
최종 compiled artifact를 외부 설치한 같은 등록/read/asset/declaration 오라클이며 외부 Pi
진단과 실제 플랫폼의 미실행 범위는 위와 같다.
최종 metadata 첫 갱신은 production manifest의 새 extension 소스/manifest 누락을 실제 coverage
guard가 거절해 digests 단계에서 중단했다(`digests-extension-transfer.log`). 그 실행의 review/
binding/aggregate gate는 미실행이다. 실제 두 owner root를 명시해 inventory를 보완하며 검사를
약화하지 않는다.
metadata의 다음 시도는 review oracle 발견기가 root test만 읽어 이동된 post-listen 시험을
찾지 못하고 review 단계에서 중단했다(`reviews-extension-transfer-repair.log`). binding/aggregate
gate는 미실행이다. 같은 ID/입력/assertion을 실제 workspace/test에서 발견하도록 고치고 주석/
fixture 문자열을 AST로 배제했다. immutable review-notes는 그대로이며 새 byte/path는 계속
NOT_REVIEWED다. `extension-review-final.log` **29/29 PASS**, skip/cancel/todo0, 입력 15,526개
`c38dab6c641b755b2af0daaac3f6d08dfb990467f4285458bce105b8dd24eaae`, 변화0. 실제 생성기/장부/
oracle 음성 제어와 extension 자체 시험이 포함된다. `npm run build:extension`도 실제 독립
workspace build로 PASS다(`build-extension-alias.log`).
`architecture-extension-complete.log` 첫 aggregate는 modules/legacy/inventory/rules/lattice/
transactions/durable이 위반0이었으나, audit의 옛 mail-tools 링크1건으로 documents FAIL이었다.
spec inventory는 앞 단계 실패로 미실행이다. 역사적 경로/행/발견 의미는 그대로 적고 현재 owner
링크만 복구했다. 이후 metadata와 전체 gate를 다시 결박한다.
module/legacy/architecture-rules 자체 검사는 각 위반0이다. tarball/타입/전체 정적 검증은 이어서
실행하며 이 집중 결과를 현재 15 workspace 전체 local PASS로 승격하지 않는다.

14 workspace 전체 정적 gate 첫 실행 `architecture-four-tools-first.log`는 문서 링크 5건으로
FAIL이었다. module/legacy/inventory/rules/lattice/transaction/durable 경계는 위반 0이었고
spec inventory는 앞 단계 실패로 실행되지 않았다. 링크 target을 실제 새 owner로 수정했다.
optional proxy의 조건부 안내를 확인한 `conditional-guide-final.log`는 **11/11 PASS**,
skip/cancel/todo 0. 입력 15,519개
`5a3d30c932761543d8054acf93889706390d84ed5a90b2b0c68182517e7db801`, 변화 0.
수정 후 공식 `npm run typecheck`도 PASS다(`typecheck-vendor-owner-final.log`).
문서 target 수정 후 `architecture-four-tools-second.log`는 전체 PASS, 위반 0이다.
production 14,252개, verification input 15,519개
`00b186db82f5216fe8cfab8753818fe7f9e344c691e21e88dfcd78fe8d110541`, runtimeProof false다.
독립 artifact 시험도 현재 소유 구조에 맞춰 실제 선언 tool 의존의 bundle을 검증하게 고쳤다.
`module-build-four-tools.log`는 TUI/extension artifact와 module-relative layout **4/4 PASS**,
skip/cancel/todo 0. 입력 `6deeeedb320e74834faf88472e6b6211b959a217ad477f32136869be7a059c04`, 변화 0.
자산 변조 거절 의미는 실제 owner를 사용하는 DR46-F02 오라클이 유지한다.
이 기록 후 구조 binding과 전체 정적 gate를 갱신하며 root 반영/전체 local은 별도 실행한다.

DR46-F02 실제 owner binding: 첫 entry 재현 뒤 같은 통합 오라클이 네 tool 모두에서 변조
payload 평가·도구 등록을 확인했다. `vendor-owner-binding-before.log` **0 PASS / 4 FAIL**,
입력 15,519개 `aa989840e68a728562b30a2c26ce5d649a93b62a85745aadfaf3ebd302eaf2bd`, 변화 0.
실제 import 대상만 검증하게 고치고 미사용 override·빈 WebToolsOptions를 삭제했다.
`vendor-owner-final.log`는 **219/219 PASS**, skip/cancel/todo 0,
입력 15,519개 `8d5bff876a12bb36de007e93998f90cc247316e5cede10621d006a3e15472dc7`, 변화 0.
같은 네 오라클에서 모듈 평가 false·도구 0·세션 거절 exit 1을 확인했다. 상태는 FIXED_LOCAL이며
실제 systemd/provider 실행으로 표시하지 않는다. 실제 공유 네트워크 코드와 어긋난 옛 START
allowlist/선택 proxy 설명도 고치고 R30의 불변 시험을 유지했다.

수정 후 `isolation-vendor-owner-final.log`: 현재 14개 모두 tarball 외부 설치·runtime API·
자산 exact-set/SHA·자체 declaration PASS이며 네 tool의 실제 installed registration,
LSP fixture 진단/종료와 hashline read도 PASS다. 외부 Pi 선언 44건은 각 관련 package에서 별도다.
네 vendor 유지 스크립트 `--check`도 현재 runtime emit/pin 일치를 확인했다
(`vendor-check-{lsp,hashline,web,mcp}.log`). web/MCP upstream emit의 타입 진단은 로그에
그대로 남아 있으므로 upstream TypeScript 전체가 깨끗하다는 판정이 아니다.

네 tool 분리 집중 `four-tools-focused.log`: **420 PASS**, 정적 시험 파일 2개는 공통 검사
파일의 주석 문법 오류로 load FAIL(그 안의 case는 이 실행에서 실행되지 않음).
입력 15,514개 `a71daf4130ae08541037a4a2b4f531343e35005704bcbc129a620291ff8a1215`, 변화 0.
주석을 고친 `four-tools-guards-repair.log`는 두 파일 **26/26 PASS**, skip/cancel/todo 0,
입력 15,514개 `3823a89daa6ed17fff4c03308c57657914afe19c8ade7b3c5aa334ee8d0ce8c5`, 변화 0.
420건은 package 소유 기능 시험과 기존 실패 helper/current-only fixture 수정,
실제 integration/context witness 및 journal SIGKILL/restart/retry를 포함한다.

14 package의 tarball·선언 의존 closure 외부 설치·자산 전체 대조·자체 declaration은
`isolation-four-tools-second.log`에서 모두 PASS다. 첫 시도는 npm pack의 큰 JSON 목록이
execFileSync의 기본 pipe buffer를 넘어 도구 FAIL였다(`isolation-four-tools-first.log`).
목록을 truncate하지 않고 owned scratch 파일로 받아 해결했다. 이어
`isolation-four-tools-registration.log`도 14개 모두 PASS다. 실제 외부 설치에서 네 tool의 등록,
fixture LSP server 진단 호출/종료, hashline의 contained read를 실행했다. 실제 provider task나
systemd 증거는 아니다. tool-runtime/네 tool의 upstream Pi declaration 진단은 각 44개이며
자체 declaration의 PASS와 구분한다. 나머지 9 package의 외부 진단은 0이다.

npm이 제외하는 web/MCP의 isexe `.npmignore`는 원래 bytes/SHA를 명시한 보관 이름으로 옮겼다.
현재 source와 설치물의 exact-set·빈 디렉터리·전수 SHA 비교 및 실제 등록 전 verifier를 모두
통과했다. runtime JS·의존 버전·upstream/ snapshot은 바꾸지 않았고 raw 실험의 누락 판정을
보존했다. 소유 자산 검사 negative control은 `test-assets-packaging.log` 4/4 PASS다.

원래 root의 Host3/DB4/plan2 전체 local 재실행: **3,991 PASS / 45 FAIL**,
skip/cancel/todo 0. 직렬 8 PASS/1 FAIL, 병렬 3,983 PASS/44 FAIL.
15,499개 입력 `c0be8f4edf792636994b1f4ce383b22abf9a6bc372d067bf26c8cd6a7cbfda28`,
전후 변화 0. `current-format-local-{before,after,status}.json`과
`current-format-local-full.log`를 보존한다. 형식 전환에서 남은 helper/양성 DTO/구 schema
fixture, 퇴역 resource·decoder assertion, 삭제된 owner를 가리킨 검증 fixture를 수정 중이다.
응답성의 50ms 기준은 완화하지 않았다. 같은 root에서 다른 작업을 실행하지 않은 단독 재실행
`status-responsiveness-alone.log`는 **4/4 PASS**다. 전체 실패 판정을 이 결과로 지우지 않는다.

LSP 분리와 CLI/config/goal fixture 수정 집중 `lsp-focused.log`: **176/176 PASS**,
skip/cancel/todo 0. 입력 15,503개
`b21ffd870e70cc0987cb859c95f8b67b8a5646d170ab501a38ec472482908a41`, 전후 변화 0.
이후 네 tool의 기능 시험을 소유 package로 옮겼으며 새로운 입력에서 재검증한다.

10 workspace 이후 입력 고정 전체 local 실행은 직렬 9 PASS, 병렬 **4,042 PASS / 5 FAIL**이다.
총 4,051 PASS / 5 FAIL, skip/cancel/todo 0. 430 files, 입력 15,504개 SHA-256
`d608933848728f3836adea3609ecfde035213e674e42320f518a7356fb0abc1f`, 실행 전후 변화 0건.
`ten-local-{before,after,status}.json` / `ten-local-full.log`가 원시 근거다. 실패는 layout-only
fixture의 builder/workspace 링크 누락, 이전 설정 schema assertion, 미지 profile 보존 fixture,
모든 옛 review가 무효화되면 빈 index를 고르던 검증 fixture 2건이다. 이 다섯 곳을 수정하고
집중 19/19가 `test-ten-local-repairs.log`에서 통과했다. 이 집중 수정을 전체 PASS로 기록하지 않는다.

DR46-F01은 실제 runner entry capture에서 재현한 후 Host3/DB4 전환에서 FIXED_LOCAL로 수정했다.
재현 당시 `review`가 현재 역할 설정의 `standard`로 재지정됐다. 실제 systemd/provider 검증으로 표시하지 않는다.

Host3/DB4/plan2 전환 집중: `resource-current-focused.log`는 **265 PASS / 8 FAIL**, 입력
15,498개 `377306c769ee13e776c8016f4c06ba4ca76833c1adb363ec789d5a5b34842db8`, 변화 0이다.
그중 1개는 잘못 포함한 systemd 전용 파일의 환경 BLOCKED이며 나머지는 fixture의 예외 종류·
기존 short name·정책 hash였다. 이 실행에서 actual confined Worker SCN-X01/X02가 통과했다.
외부 selection에 있던 미존재 managed-generation-kill은 Node가 실행하지 않았으므로 coverage에 포함하지 않는다.
수정 후 `resource-current-repairs.log`는 **214/214 PASS**, skip/cancel/todo 0, 입력 15,499개
`6a1297d35a02016ea25b9dbdf83ee293261bc2a23ef867556b73c97ae28fe710`, 변화 0이다.
새 실제 SHA-1/SHA-256 CAS/no-op witness SIGKILL·restart·권한/정책 변경·같은 요청 재시도
4건과 기존 journal short-write/receipt/config 실제 SIGKILL, runner entry capture, current-only
형식 거절, LSP/hashline contained writer를 포함한다. 이전 DB 1/2/3·Host 1/2·bare plan은
읽기 변환이나 삭제 없이 거부했다. 개별 workspace 소유 테스트도 `resource-workspace-tests.log`에서
10개 package, 총 **18 PASS**, fail/skip/cancel/todo 0이다. 이 결과는 전체 모듈 개편 완료나
새 구조의 전체 local PASS가 아니다. 이후 정적 지도·문서 변경은 별도로 다시 결박한다.

canonical no-op을 실제 경계 primitive로 등록한 뒤 aggregate가 context authorization owner의
미등록 시험 1건을 발견했다(`architecture-resource-current.log`; 앞선 module/legacy/inventory/
architecture/transaction group은 통과, aggregate는 FAIL). 예외로 제외하지 않고 context 실제
witness SIGKILL을 추가했다. `context-witness-final.log`는 **64/64 PASS**, skip/cancel/todo 0,
입력 15,499개 `f2c53aa899a8ae698ebf5997a569f832a3c99149cdfd365dcba5d7b0a022bb32`,
변화 0이다. 직접 통합 CAS/no-op 4건에 context authorization 2건을 더한 실제 SIGKILL/restart/
retry와 빈 preaccept scope/미사용 별칭 제거, current DDL/삭제 재도입 negative control을 포함한다.
이후 전체 정적 gate는 `architecture-resource-final.log`에서 모두 PASS다. production inventory
14,248개, module/legacy/rules/architecture/transaction/durable/document/spec 위반 0건이다.
입력 15,499개 `9225b5d8d7bc78dd661f8deab17b655302e12a785039ca3a8e207216a30399b7`,
runtimeProof false다. root에 충돌 없이 반영한 뒤 새 build와 전체 local을 재실행한다.

`isolation-resource-current.log`: 현재 열 package를 pack해 선언 의존 closure만으로 외부 설치한
runtime API와 자체 declaration이 모두 통과했다. upstream Pi declaration 진단은 44개 별도로
기록했다. 나머지 package의 외부 진단은 0이며 외부 타입까지 통과했다고 표현하지 않는다.

journal flush 주입 보충: 제품 build와 설정/generation/실제 SIGKILL 집중 **29/29 PASS**,
skip/cancel/todo 0 (`test-journal-kill-final.log`). journal append·file flush·parent flush를 실제
kill observer에 포함했다. 강제로 1바이트씩 쓴 뒤 1/66/133/134번째 byte에서 SIGKILL해 manifest
불변과 같은 candidate 재시도·rollback predecessor를 확인했다. 0바이트 write는 교체 없이
거부한다. 이후 전체 local suite는 이 입력을 고정해 실행하며 별도 결과로 기록한다.

설정/guest 형식 전환: HostConfig schema 2와 host/guest protocol 7의 build 및 집중
**196/196 PASS**, skip/cancel/todo 0 (`test-config-v2-final.log`). 실제 키 대체·CONNECT·열린
lease·run 종료·설정 generation·session·TUI 연결을 검사했다. guest의 옛 optional hold 조건이
새 lease를 닫는 회귀와 이전 request fixture를 수정한 뒤 실행했다. 중단한 `test-config-v2.log`는
PASS가 아니다. 이후 journal 형식과 닫힌 profile 변경은 별도 재검증 중이다.

도구 공통 실행 패키지 전환: 열 번째 `@oma/tool-runtime` 추가 후 build 통과, 구조 규칙 위반 0건.
도구·vendor·child 취소/종료·독립 extension 빌드 집중 실행은 **246 PASS / 1 FAIL**,
skip/cancel/todo 0 (`test-tool-runtime.log`). 실패는 아직 갱신 전인 source graph identity 결박이며
실제 구조 gate를 우회하지 않고 metadata 갱신 후 재실행한다. schema 2의 journal·닫힌 profile과
실제 SIGKILL/namespace 회귀는 수정 후 **64/64 PASS** (`test-journal-repairs.log`).
이후 플랫폼 공통 journal 관측·문법 사본 제거·quarantine 선언 삭제는 최종 재검증 중이다.

10 workspace의 제품 lockfile 기반 tarball 격리 설치·runtime public API·OMA declaration은
모두 통과했다 (`isolation-ten-workspaces-final.log`). tool-runtime이 참조하는 upstream Pi
declaration 진단 **44건**은 별도 외부 진단이며 OMA 선언의 PASS에 포함하지 않는다. 나머지
9개 패키지의 외부 진단은 0건이다. 최초의 새 registry 해석은 전이 버전 API 불일치로 실패했고,
lock 고정 뒤 전체 외부 declaration 검사도 upstream 오류로 실패했다. 두 로그를 보존한다.
검증기는 제품 lock의 선언한 폐쇄만 설치하고, OMA의 모든 public declaration을 엄격히 검사한다.
의존 선택 음성 대조 3/3 및 자체 선언 오류·누락 import·root Node type 누출 음성 대조 1/1 통과.

세션 레거시 정리: typecheck/build와 집중 **190/190 PASS**, skip/cancel/todo 0
(`test-history.log`). birth 기록 없는 Society history는 bytes를 유지하고 재개를 거부하며,
현재 birth 기록과 같은 빌드의 중단 시작 복구는 유지한다. 옛 basename Society 검색은 제거했다.

소스/패키지·설정 강제 종료 합동 실행: **1,001 PASS / 106 FAIL**, skip/cancel/todo 0.
입력 15,495개 SHA-256 `9ea5b418dc2be4cc8bf13be1819d326842be250a86ec5e90710583d3c716ff8d`,
실행 전후 변경 0 (`config-source-{before,after,status}.json`, `config-source-checks.log`).
공개 API로 이동하지 않은 fixture·옛 lane probe와 테스트 이름, 분석기의 workspace 해석 누락을
수정한 후 집중 **149/149 PASS** (`test-config-source-repairs.log`). 새 negative control 2개는
설치된 declaration에 가려지는 owned-path 전달과 workspace transaction 효과를 실제 거부한다.
이 집중 통과를 수정 후 전체 suite PASS로 기록하지 않는다.

설정 패키지 전환 진행: `@oma/config` 추가 후 typecheck/build 통과. 설정 게시·불변 snapshot 2개와
배포 namespace 3개 **5/5 PASS**, build stamp 회귀 **7/7 PASS**. config/파일/receipt 강제 종료
집중 실행은 36개 중 34 PASS/2 FAIL이었고, 실패한 child의 이전 설정 경로를 공개 API resolve로
수정했다. 수정 후 재실행은 아직 전이다. DB/wire/config 형식은 이 이동 단계에서 바꾸지 않았다.

저장 패키지 전환 진행: `@oma/storage`가 SQLite·파일 primitive·schema를 소유한다. 이 단계의
root typecheck와 제품 build, package-local rollback/만료 권한/thenable 거부 **3/3 PASS**.
무효 quota gate 제거와 nested workspace 해석 검사는 집중 실행 **30/30 PASS**, skip/cancel/todo 0
(`runtime-storage-resolution-final.log`, 아래 artifact 디렉터리). 이후 storage 이동 집중 실행은
125개 중 116 PASS/9 FAIL이었으며, 옛 child import·negative fixture·schema 중복 hash 수집과
미갱신 입력 binding을 수정해 재검증 중이다. 이 숫자는 전체 개편의 완료 판정이 아니다.

아래의 일곱 workspace/110개 실행 기록은 storage 이동 **이전 입력**의 기록이다.

기준 `dc21c13e`에서 [모듈화 명세](../modularization-spec.md)에 따라
contracts/domain/protocol/client/TUI와 native/process의 실행 소스를 일곱 workspace로 옮겼다.
공개 exports·직접 의존·빌드 순서·배포 해시·검증 입력에 패키지를 포함한다.
옛 import facade와 효과 없는 lifecycle quota 계약을 삭제했다. 나머지 기능 패키지와
설정·저장·egress·과거 형식 정리는 진행 대상으로 남아 있다. 전체 개편 완료 판정이 아니다.

이 전환은 DB schema/wire 형식을 변경하지 않으며, acceptance transaction과 실제 자원 소유권을
옮기거나 복제하지 않는다. 기존 리뷰의 SHA와 경로가 달라진 항목은 `NOT_REVIEWED`로 남긴다.
`review-ledger --invalidate-stale`는 이전 claim의 경로·SHA·무효 사유를 보존하고
`review-notes.json`을 수정하지 않는다. 생성된 graph·inventory·fingerprint는 실행 증거가 아니다.

첫 입력 고정 전체 local 실행은 실패했다. serial 4 PASS / 5 SKIP,
parallel 3,688 PASS / 294 FAIL / 66 SKIP이며, 입력 15,486개 SHA-256은
`be32433697d13307f35e4e38e259e8305b7555440e2c64d5100d8fe58d6ba459`이다.
전후 입력이 같음을 확인했다. 경로를 보유한 VM/소스 fixture와 실행 환경을 수정했고
이후 입력 고정 전체 재검증을 실행했다. 수정·빌드와 겹친 중간 실행은 현재 코드의 PASS로 사용하지 않는다.

현재 환경은 Linux, Node.js 26.0.0이다. private toolchain에 설치한 `oma`, Corepack 0.34.0,
bubblewrap 0.12.0을 사용한다. 호스트 `/usr/bin`을 변경하지 않고 임시 user namespace overlay에
실제 `/usr/bin/bwrap`을 제공하며 `/dev`를 device bind한다. 초기 overlay의 device 접근 오류와
설치 명령 누락으로 중단한 집중 실행도 원시 로그에 남긴다. 실제 user systemd/cgroup lane,
macOS native·VM·provider task·power loss는 이번 환경에서 `NOT_RUN`이다.
이전 native 결과나 과거 리뷰를 이번 바이트에 재승인하지 않는다.

원시 로그와 입력 map: `/home/dev/oma-audit-artifacts/modularization-2026-10-23/`.
두 번째 전체 local 실행은 420개 파일, concurrency 4에서 **4,048 PASS / 1 FAIL**이다.
serial 9 PASS, parallel 4,039 PASS / 1 FAIL이며 fail 외 cancel/skip/todo는 모두 0이다.
입력 15,482개 SHA-256 `1b16f6fbafffc9b35a48992ea6940fc2e538764c80a8e490587b429a68605526`의
전후 파일별 해시 변화는 0건이다. 실패는 이동한 TUI 경로가 sandbox 숨김 목록에 빠진 것이다.
목록과 실제 경로 검사를 수정한 뒤 실제 sandbox 6/6이 통과했다. source/dist·workspace link·
private prompt adapter는 읽을 수 없고 Worker의 CLI·extension·relay는 동작한다.
이 집중 PASS를 수정 후 전체 suite PASS라고 표시하지 않는다.

다섯 기반 패키지의 외부 tarball 설치·공개 API·declaration 검사는 모두 통과했다.
native/process 추가 후에는 다시 검사한다. 일곱 패키지와 root의 typecheck가 통과했고,
그 과정에서 종전 include에서 누락된 compile-only port fixture를 현재 port로 고쳐 실제 검사에
포함했다. native/process 이동 이후 전체 suite는 아직 미실행이다.

native/process 추가 뒤 집중 실제 실행은 **110/110 PASS**이며 cancel/skip/todo 0이다.
FD·process ownership·관측·CLI·lease·Principal channel·설치 digest·실제 Resident sandbox를
검사했다. 입력 15,488개 SHA-256
`b21d640c177dbfc30a443cb053925cfc6b6aefadb0db73a1ed06656cd1a6843c`의 전후 변화는 0건이다.
`native-process-runtime-{before,after,status}.json`과 `native-process-runtime.log`가 원시 근거다.
소스/패키지 테스트 실행의 30개 fixture 실패는 수정 후 관련 89/89가 통과했다. 일곱 패키지의
격리 tarball 설치·공개 API·declaration이 통과했고 전체 구조 검사도 위반 0건으로 통과했다.
패키지 로컬 테스트의 비공개 타 패키지 접근·미선언 의존·devDependency를 통한 역방향 type
참조를 막는 음성 대조도 5/5로 통과했다. 이후 결과 문서·인계 입력은 별도 기록 바이트다.
`foundation-local-{before,after,status}.json`과 `foundation-local-full.log`, `mask-fix-live.log`가
각 결과의 입력과 원시 실행을 보존한다.


## 기존 결함·설치 안내 수정 (2026-10-15, DR45)

기준 `d18f62d1`의 기존 실행 경로를 수정했다. [DR45](../design-revisions.md#dr45--감사에서-확인한-실행재시도-결함과-운영-안내-수정)는 guest 최초 seed, host import 재시도, 겹친 stream 전송, 변화 없는 bundle, 긴 검사 중 취소·context 게시, review 이력 조회, credential 분할 응답, Personal 최초 확장 상속과 broker spawn 실패를 다룬다. Worker별 clone, LOW 자동 병합과 DR37의 네트워크·자원 정책은 유지했다. Linux checkout 설치 조건과 미제공 macOS 앱·VM 배포물은 [운영 안내](../operations.md)에 명시했다.

첫 전체 로컬 시험은 4,047 PASS / 7 FAIL이었다. context 복구의 동기 예외 2건은 Promise 오류 계약으로 복원했다. 기존 모드 선택창을 가정한 PTY 2건은 현재의 명시적 Personal 전환·일반 종료로 수정했다. 실제 spawn 실패에서 종료 오류가 일회성 listener를 소진하는 경로, N-001의 오래된 architecture hash, startup 정리 함수가 빠진 시험용 RequestLedger도 수정했다. 집중 재실행에서 남은 옛 화면 문구 assertion까지 현재 Personal 화면과 터미널 반환 순서로 대조했다.

| 실행 | 결과 | 범위 |
|---|---|---|
| `npm test` | **4,054/4,054 PASS** | 416 files; 직렬 9 + 병렬 4,045; fail/cancel/skip/todo 0 |
| 실제 candidate check 회귀 | **1/1 PASS** | systemd/bwrap에서 네트워크·기존 제한 초과 실행, owner 종료와 요청 취소 각각의 cgroup descendant 종료 관측 |
| build / typecheck | PASS | Linux, Node.js v24.21.0; CI의 Node.js 26 실행 증거가 아님 |
| `check:architecture` | PASS | inventory·규칙·의존 방향·transaction·durable boundary·문서·spec inventory 모두 통과 |
| 보고서 반영 뒤 입력·검토·문서 회귀 | **38/38 PASS** | source inventory, review closure, consistency decisions, traceability policy |

실제 Git·socket 시험은 신규/기존 mirror의 dirty·untracked 내용 보존, no-change/rewind bundle, 업로드 전 단절·성공 응답 유실·영구 거절 뒤 host 재시작, 동일 key의 변경 payload 거절, 오래된 재시도의 checkpoint 역행 방지와 bundle 해제를 검증했다. 겹친 stream과 늦은 연결 종료는 이미 완성된 파일을 훼손하지 않는다. 취소 수락 뒤 준비물 정리가 실패해도 검사 중단은 전달되며, CAS 후 완료 공지가 지연된 요청은 취소 성공으로 표시하지 않는다. 12개 완료/대기 review의 sweep·목록은 각각 이력을 한 번 읽는다. 분할 credential 바이트는 relay 밖으로 먼저 전달되지 않는다.

전체 실행 입력은 15,468개 파일, SHA-256 `629f9a1a1dd3663ac63172834f055e7b656e60645dc7e8fd860d1efb4bd8e487`이다. 실행 뒤에는 이 결과 기록과 N-001 traceability fingerprint만 추가로 갱신했다. 최초 구조 검사에서 해당 fingerprint 누락을 발견했으며 최종 구조·입력 결박 검사는 별도 실행으로 통과했다. 원시 성공/실패 로그, 실행 입력 map과 결과는 `/home/dev/oma-audit-artifacts/repairs-2026-10-15`에 보존한다. 작업 폴더의 사용자 메모는 수정하지 않고 같은 변경을 적용한 별도 worktree에서 전체 시험·문서 검사를 실행했다.

native macOS VM·Keychain과 실제 provider 호출, 나머지 systemd-required 전체 lane 및 power-loss 검증은 **NOT_RUN**이다. 이미 생성된 canonical main은 자동 재작성하지 않는다. 51개 기존 `NOT_REVIEWED`를 포함한 검토 범위와 과거 native/release 판정은 이번 local PASS로 갱신하지 않는다.

## 실제 task: gpt-6.1-sol medium (2026-10-12)

기준 `d543c84c`에서 Human이 Principal·Worker를 6.1 sol medium으로 지정하고 실제 코딩
과제를 수행하도록 요청했다. 자동 suite나 scripted provider를 task 실행 증거로 대신하지
않았다. 실제 `oma` Society·bundled Pi·인증된 `openai-codex/gpt-6.1-sol` inference,
systemd/bwrap 환경에서 expense-report의 정확한 cents 집계, validation/filter, JSONL
CLI/CSV, 문서와 회귀를 맡겼다. 세션 model-change, thinking-level-change와 실제 assistant
response metadata에서 Principal·구현 Worker·소환된 두 리뷰어 모두 medium을 확인했다.

처음 결과는 **BLOCKED**였다. HIGH 요청의 첫 동료 표 뒤 두 번째 표가 INTERNAL_ERROR로
거부됐다. read-only emission 재현은 `MIME emission differs from frozen approval claim`을
가리켰고, folded 정책 헤더의 decoded revision에 앞 공백 하나가 추가됨을 확인했다.
`src/mail/headers.ts`에서 raw unfolded header의 경계 공백을 decoding 전에 정리했다.
encoded revision의 실제 공백은 지우지 않는다. 독립 folded wire fixture와 writer 왕복
회귀가 수정 전 FAIL, 수정 후 PASS다. build와 MIME/헤더/merge/Worker autonomy 집중 회귀
20/20 PASS, fail/cancel/skip/todo 0이다. 최종 typecheck와 architecture 전체 검사도 PASS다.

최종 결과는 **PASS_AFTER_RUNTIME_FIX**다. 정상 종료 후 실제 Society를 다시 열어 같은
키의 실패 표 기록을 확인했다. 새 deployment가 정책 revision을 바꿨으므로 Worker는
옛 요청을 취소하고 동일 후보의 새 HIGH 요청을 열었다. 옛 사실과 표를 바꾸지 않았고,
기존 두 리뷰어가 새 binding/diff를 확인하고 실제 표를 남겼다. Principal도 exact diff를
읽어 새 승인 ID에 투표했다. `git.integrate` 한 건이 succeeded, canonical main은
`b18f625384c019a81b290932f6347f6696867bd8`, 요청은
`merge-95baec00-1f41-421f-992c-35e85ade1a76`다. Worker의 post-merge test 12/12와
별도 canonical 요구사항 검사 44/44 PASS다. 제품 exit 0와 세 Worker unit inactive/dead를
확인하고 복사한 host credential을 제거했다.

[실행 증거](../../test/audit/real-task-2026-10-12.evidence.json)는 실제 모델 선택, parent별
소환, 승인 표, integration, 검사와 operator 개입을 기록한다. raw 로그·세션·SQLite
operation·결과 코드는 `/home/dev/oma-audit-artifacts/real-task-6.1-sol-medium-2026-10-12`에
있다. 이 실행은 Linux의 한 실제 task이며 전체 suite·모든 challenge·native macOS의
PASS를 뜻하지 않는다. 아래 수치는 각 과거 입력의 기록으로 유지한다.

## Worker 리뷰어 보충 안내 (2026-10-12)

Human 요청으로 기준 `0d84ff34`의 내장 Worker 시스템 프롬프트에 리뷰어 부족 시 보충 안내를
추가했다. 기존 peer에게 먼저 요청하고 자격 있는 인원 자체가 부족할 때만 기존 agent.create로
필요한 수를 보충한다. brief의 요청 이름·exact diff·관련 검사·자신의 approve/reject, enabled와
요청자/인증된 제출자 제외, 자식 reviewer 자격, 생성과 승인의 구분, 기본 challenge 정족수와
Principal/broker의 역할을 명시한다. model-facing 영문과 한국어 comment를 함께 수정했다.
기존 리뷰·생성 권한이나 적용 정책은 변경하지 않는다. custom prompt 선택 의미도 유지한다.

`npm run build`, `npm run typecheck`는 PASS다. 기존 회귀
`node --test dist/test/role-prompts.test.js dist/test/prompt-boundary.test.js dist/test/resident-confinement.test.js`
35/35 PASS, fail/cancel/skip/todo 0이다. 영어 model input과 기본/custom prompt가 실제 Resident
spawn plan에 전달되는 기존 oracle를 실행했다. 소환을 실제로 선택한 모델의 운영 증거는 아니다.
변경한 생산 파일은 `packages/config/src/role-prompts.ts` 한 개이며 SHA-256은
`ae884a04324ea98c95c3d5b9014e8857607f1f1a70f95d827693f7f790f2a2d2`다.
구조·메타데이터 검사와 raw logs는
`/home/dev/oma-audit-artifacts/worker-reviewers-2026-10-12/result.json`에 별도로 보존한다.
아래 전체 suite·crash PASS는 각각의 과거 입력에 대한 결과다.

## Review 권한·실행 조정·파생 증거 (2026-10-11, DR44)

기준 `067bb7c`의 구조를 직접 검토하고 Review acceptance/advancement/authority/message/status,
Principal turn admission/launch/projection, Broker listener 관측, Pi 공개 autocomplete,
Store capability·diagnostic·platform·conversation port를 개선했다. 필수 문서와 영향 owner를
먼저 읽었으며 서브에이전트는 사용하지 않았다. 단일 T·writer·HostTenure·actual exit·unknown과
historical receipt의 의미를 보존한다. 변경 이유와 잔여 경계는 [DR44](../design-revisions.md#dr44--review-권한과-실행-조정의-변경-경계)와
[Application 경계 안내](../application-boundaries.md)를 따른다.

초기 sandbox 실행에서 Git child EPERM을 관측했다. 초기 dist가 기준 HEAD의 산출물로 남아
있었으므로 132/132와 이어진 223 PASS / 2 FAIL 실행은 변경 코드의 runtime 증거로 철회한다.
두 실패는 stale inventory/input binding 검사였다. typecheck는 moved constant의 잘못된 import와
회귀 fixture property 이름을 거절했고 실제 owner의 export와 fixture 이름으로 정정했다.
첫 surface 검사도 public AutocompleteProvider 타입의 owner 등록 누락을 거절했다.
실제 빌드 뒤 DR44 코드와 새 회귀가 dist에 존재함을 확인하고 최종 실행을 진행한다.

첫 fresh 전체 local 실행은 3,916 PASS / 105 FAIL(415 files)이었고 15,462개 입력의
실행 전후 변경은 0건이었다. 추출 전 Principal 필드를 직접 만들던 fixture, 이전 GuestHost
listening 경로, 새 Pi adapter의 controlled import 누락과 eager private import가 주요 원인이다.
실제 TurnAdmission과 새 observation owner를 fixture에 공급하고 optional Pi adapter는 UI를
시작할 때 불러온다. 같은 계층 type cycle을 허용하던 옛 oracle과 새 회귀의 requestName 인자
순서도 정정한다. Personal 확장 선택 PTY 두 실패는 별도로 재현한다. 실패 실행은 보존한다.

첫 집중 재실행은 101 PASS / 84 FAIL이다. CommonJS controlled fixture에서 UI adapter의
deferred import가 local `require` 이름과 충돌했고 constructor를 생략한 Principal fixture에
ready 값이 빠졌다. package resolver를 명시적으로 이름 붙이고 실제 ready 상태를 공급한다.
Personal 확장 설정은 저장·재로드됐지만 이전 UI에 보낸 확인이 새 화면에 표시되지 않았다.
확인을 reload 완료 뒤 현재 UI에 보낸다. PTY의 saved 표시와 실제 extension 제거 검사는 유지한다.

다음 집중 실행은 141 PASS / 2 FAIL이다. 원시 PTY를 보존한 재현에서 autocomplete factory가
reload 전에 받은 ctx.cwd를 다시 읽어 stale context guard에 거절됨을 확인했다. 등록할 때 cwd를
읽고 문자열만 capture한다. 공개 wrapper는 반복 등록에도 겹치지 않고 prototype/private field를
수정하지 않는다. saved 확인은 현재 UI에 보낸다. 기존 PTY의 saved·실제 tool 제거 oracle을
줄이지 않으며 재로드 성공을 최종 실행에서 다시 확인한다.

수정 뒤 Pi compatibility·Personal 실제 PTY 집중 실행은 20/20 PASS이며 skip/cancel/todo는
0이다. build·typecheck도 통과했다. build child 실행 오류와 status 0이 함께 오는 별도 결함은
discovery·compile·package 모두 실패로 처리하며 실제 build script의 실패 주입을 검증한다.
직접 검토한 생산 delta는 40개다. 기준 미검토 50개 중 review.ts를 직접 검토해 현재 49개가
남으며 나머지를 자동 승인하지 않는다. authored review의 기존 순서와 변경 없는 기록을 보존한다.

직접 분석한 graph는 454 TS files / 1,897 runtime edges / 543 type-only edges다.
runtime cycle, runtime/type union SCC, type-only 상향 edge는 모두 0이다. readiness 판정은
Integration→ReviewAuthorityReader→순수 ReviewState이며 Review workflow로 되돌아가지 않는다.
Pi global autocomplete prototype 교체를 제거했다. Store provenance는 기존 decoder에 남는다.

최종 전체 local suite는 4,021/4,021 PASS(415 files, serial 9 + parallel 4,012)이며
fail/cancel/skip/todo는 0이다. 실제 primitive crash는 EXECUTED+PASS 63/63이다. 두 실행의
공통 runtime 입력은 `32c17e1595580f5d1149189823ea38c8647d5722e96f30c33f405812200a6ae6`
(15,463 files)이고 각각 실행 전후 변경과 lane 입력 차이는 0건이다. 실제 SIGSTOP·부모 SIGKILL·
재시작·반복 복구 범위다. VM power loss 또는 모든 entrypoint crash의 증거로 확장하지 않는다.
build·typecheck·전체 architecture gate도 통과했다. 원시 로그·입력 map·SHA·실패 실행과 검토
범위는 [DR44 evidence](../../test/audit/architecture-quality-2026-10-11.evidence.json)와
`/home/dev/oma-audit-artifacts/architecture-quality-2026-10-11`에 보존한다. crash 원본은 옆의
`architecture-quality-2026-10-11-clean-crash`다. 결과 기록의 bytes는 실행 뒤 작성됐으며 별도
metadata/structure 검사로 결박한다. 실행한 production code는 변경하지 않았다.
동일 feature의 전후 변경 비용이나 독립 평점을 측정한 결과로 해석하지 않는다.

마지막 staged 검사에서 새 Principal helper 두 파일의 EOF 빈 줄을 정리한 뒤 위 전체
suite·crash를 다시 실행해 현재 소스 바이트를 검증했다. 앞선 성공 실행과 원시 증거도
별도 snapshot으로 보존한다. 결과 기록 bytes의 최종 metadata·structure 검사 원본은
같은 artifact 디렉터리의 `clean-post-record-result.json`이다.

아래 DR43 이하 실행은 과거 입력의 결과다. structural binding 생성만으로 runtime PASS를
만들지 않는다. native Mac·VM power loss·paid
provider·release 및 별도 kernel qualification은 이번 작업에서 NOT_RUN이다. 기존 startup
목표 미달과 나머지 Pi private UI hook은 남는다.

## Society 조립·플랫폼 책임 경계 (2026-10-10, DR43)

DR42 완료·푸시 `06df8990` 뒤 Human이 추가 요청한 설계 개선이다. entry의 project/session 준비,
실행 등록·mail delivery, TUI interaction, outgoing transition을 기존 Application 계층의 네 단위로
분리한다. HostTenure와 Core owner의 권한·actual exit·unknown 의미를 유지한다. platform의
process coordinator와 adapter 및 계약 위치·의존 규칙을 코드와 짧은 안내로 명시한다.
새 supervisor/registry/layer는 추가하지 않고 서브에이전트는 사용하지 않았다.

첫 typecheck는 destructured never-returning fail callback의 flow narrowing, nullable conversation
관측, 이동한 transport 참조로 실패했다. 명시적 Fail 타입과 단일 관측 및 실제 owner 참조를
적용한 재검사는 통과했다. 기존 composition/package 회귀 114/114, host history 분할·correlation·
stale engine observation 검증을 추가한 실행 116/116 PASS다. controlled 모듈 경계에서 실제 entry와
네 Application 구현을 실행하며 HostTenure의 실제 구현과 기존 assertion을 유지한다.
독립 모듈 build/경계까지 합친 집중 실행은 120/120 PASS다. CLI 인자를 내부 bootstrap 입력으로
바꾼 뒤 첫 전체 structure/build는 exactOptionalPropertyTypes에서 undefined 전달을 거절했다.
요청 필드를 명시적 string | undefined로 표현해 타입 계약을 맞춘다. 첫 review metadata 생성은
테스트 경로를 oracle ID로 사용해 거절됐고 기존 DR43/T119 oracle 이름으로 정정했다.
첫 durable boundary 검사는 project binding publication의 등록 위치가 이전 main을 가리켜
두 건을 거절했다. 같은 kill/retry/restart oracle을 실제 bootstrap publication 위치로 옮겨 등록한다.
등록 수·시험 강도와 checker는 유지한다. entry는 881→171줄, main은 728→54줄이며
이 수치는 소스 분해 결과이고 평점·feature 변경 비용·startup 성능 향상의 증거는 아니다.
이전 DR42 suite/native evidence는 DR43 bytes의 실행으로 재사용하지 않는다.
host history channel을 표시 구성보다 먼저 열므로 취득 직후 cleanup을 등록한다. 표시 transport
초기화 실패에서도 channel/tenure가 반환되는 실제 composition 회귀를 추가했다.
최종 집중 검증 121/121과 build·typecheck·전체 architecture gate가 통과했다. 전체 local suite는
4,013/4,013 PASS(415 files, serial 9 + parallel 4,004; fail/cancel/skip/todo 0)이며 실제 primitive
crash lane은 EXECUTED+PASS 63/63이다. 두 실행의 공통 runtime 입력은
`33259b0cae1da21d7653edc0b2f46fc1580dc000bfadc647b581f2e8e8137c30` (15445 files)이며 실행 전후 변경은 0건이다.
실제 SIGSTOP·부모 SIGKILL·재시작·반복 복구 범위이고 VM power loss 또는 entrypoint crash를
검증했다고 확장하지 않는다. 결과 기록의 bytes에는 후속 structure/metadata/input 검사를 적용하며
이미 runtime suite가 실행했다고 주장하지 않는다. 직접 검토한 생산 delta는 9개이고 상속된
미검토 50개는 유지한다. graph는 438 files / 1,835 runtime edges / 483 type-only edges /
runtime cycles 0이며 Store type-only SCC는 남는다. 원시 로그·명령·input map·SHA는
[DR43 evidence](../../test/audit/composition-2026-10-10.evidence.json)와 외부 artifact에 보존했다.
native Mac·VM power loss·paid provider·release는 NOT_RUN이고 기존 startup 목표 미달은 남는다.

## Host/Guest owner 결함 수정 (2026-10-10, DR42)

기준 HEAD `ae15804000ce6`에서 지정된 여섯 항목을 확인했다. VzDriver의 줄 소비는 이미
구현돼 있었고 기존 helper 실행 37/37이 통과했다. 두 Node helper client의 JSONL·ID·deadline
owner를 공통화하며 UTF-8 줄별 제한과 malformed response 회귀를 강화했다. project별 mutation,
maintenance barrier, archive quiescence, egress autonomous recovery, Keychain 유한 contention wait와
공통 RPC dispatcher를 구현했다. 서브에이전트는 사용하지 않았다.

집중 첫 실행은 258 PASS / 5 FAIL이었다. archive 테스트의 새 request key에 staged bundle이
없었고 endpoint 테스트의 일반 bool 관측 fixture가 archive 전용 확인으로 바뀌어 두 건 실패했다.
이를 실제 staging/관측 계약에 맞게 정정했다. 새 egress backoff보다 짧은 200 ms fixture는
명시적 test retry cadence를 받는다. Vz의 malformed credential 거절 뒤 다른 유효한 응답을
받는 기존 의미를 유지했다. build 과정은 optional signal·Buffer 해석·mock 인수 타입 진단으로
실패했고 타입을 정정했다. 실패 실행을 최종 PASS로 바꾸지 않는다.
집중 재실행 274/274 PASS, build/typecheck와 architecture rules 0 findings다.
실제 user systemd에서도 socket이 없는 live holder/child를 만든 뒤 짧은 stop이 unknown을 반환하고,
전체 stop 및 collected unit 관측이 stopped를 반환하는 것을 확인했다.

첫 전체 suite는 4,008/4,008 PASS이며 15,439개 입력의 실행 전후 변경은 0건이다.
실행 중 추가 검토에서 project fence가 ledger 이전에 놓이면 immutable outcome/key binding 판정이
현재 maintenance/입력 검증에 가려질 수 있음을 확인했다. ledger는 과거 결과를 먼저 읽고 pending
효과·결과 게시에만 owner를 적용하도록 보완했다. historical replay·key reuse·pending assertion을
추가한 집중 검증 59/59도 통과했다. Keychain/Archive key의 OS writer 앞 중복 promise queue도
제거해 같은 프로세스의 대기 역시 유한 budget을 적용받도록 했다. 취득한 첫 writer는 deadline으로
중단하지 않는 회귀를 추가했고, lock/credential/cleanup 집중 검증은 87/87 PASS다.
같은 검토에서 모든 project role 설정을 쓰는 packages.replace도 maintenance/archive barrier에
참여해야 함을 확인했다. 전역 package 게시만 exclusive 구간으로 처리하고 일반 mirror 작업은
계속 project별로 병렬 실행한다. unbound archive까지 package writer와 충돌하는 회귀를 추가했고, package/project/archive 통합 집중 실행 65/65도 통과했다.
이 변경 뒤 입력을 다시 고정한 전체 회귀는 4,010/4,010 PASS(415 files), actual primitive crash는
EXECUTED+PASS 63/63이다. 공통 runtime 입력은 `efbad65e03c83dbc3fb64264c17b972a186403b5be58c93ebb4c8dbfc0fc913d`
(15,439 files)이며 각각 전후 변경은 0건이다. SIGSTOP·부모 SIGKILL·재시작·반복 복구 범위이고
VM power loss나 entrypoint crash의 증거로 확장하지 않는다. 후속 결과 기록의 bytes에는 별도
structure·input 검사를 적용하며 runtime suite가 이미 실행했다고 주장하지 않는다.
기존 suite/native evidence를 이번 bytes의 실행으로 재사용하지 않는다. 결과와 로그 hash는
[DR42 evidence](../../test/audit/host-repairs-2026-10-10.evidence.json)에 기록한다.
native Mac·VM power loss·paid provider·release는 NOT_RUN이며, 기존 전체 startup 5초 목표 미달은 남는다.

## 모듈 독립성 (2026-10-10, DR41)

기준 `babe732`에서 TUI 효과·Principal 수명·설정과 package/Platform 책임을 분리했다.
TUI는 Application/Runtime 저장·프로세스 구현을 import하지 않는다. 두 독립 빌드가 전체 Runtime·
Application·Broker·Store 없이 컴파일·로드되고 Extension의 검증된 vendor와 Pi manifest를 포함한다.
서브에이전트는 사용하지 않았다. 이전 배치의 suite·native 증거를 이번 변경의 실행으로 재사용하지 않는다.

집중 MJS 첫 실행 123 PASS / 173 FAIL은 이동한 소스의 controlled import 경로와 owner oracle의
경로가 이전 위치를 가리킨 실패다. 실제 새 owner에 연결하고 Application의 기존 surface 검사 범위도
보존한 재실행은 296/296 PASS다. 독립 산출물 build/load·vendor 변조·기존 출력 교체 거절은 2/2 PASS다.
TS 집중 첫 실행은 165 PASS / 1 FAIL이었다. Principal child의 기록을 50ms 뒤에 가정한 fixture를
실제 첫 기록 관측 뒤 검사하도록 정정했다. receipt unknown·busy·Human 입력 순서의 assertion은 유지한다.
첫 build/typecheck는 shebang 앞에 import가 놓여 실패했고 첫 structure 검사 5건은 private import 경로가
남아 실패했다. shebang과 공개 import를 수정한 build/typecheck·rule check는 통과했다.

정정 뒤 Principal·package·Society port·실제 Resident sandbox 집중 검증은 58/58 PASS,
최종 모듈·독립 산출물·입력 identity·surface gate oracle은 33/33 PASS다. 첫 전체 architecture gate의
문서 링크 6건은 이동 전 파일을 가리켜 거절됐다. 현재 owner로 링크를 갱신했다.
첫 전체 local suite는 3,961 PASS / 29 FAIL이다(414 files; serial 9 PASS + parallel 3,952 PASS).
15,433개 입력의 실행 전후 변경은 0건이다. 27건은 entry 함수만 추출한 package ownership fixture에
새 directory port가 빠져 실패했다. port를 공급하고 index 호출이 그 port를 받는지 검증한다.
2건은 consistency owner 경로와 N-001 architecture hash가 이전 값을 가리킨 실패다. Human이 지정한
DR41 경계 변경을 대조하고 현재 규범 hash·traceability 및 owner 경로를 갱신한다.
첫 실행의 실패를 최종 PASS로 바꾸지 않는다. 정정 뒤 고정한 최종 runtime 입력 sha256는 `5539955a6f8dd31eac0858934acb9d82d3ee87019c0046cb0afdefc56ba8097f`다.

| 최종 실행 | 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,990/3,990 | serial 9 + parallel 3,981; fail/cancel/skip/todo 0; 414 files, parallel 412, concurrency 8 |
| actual crash lane | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP·부모 SIGKILL·재시작·반복 복구; VM power loss/entrypoint crash 증거는 아님 |
| 독립 TUI·Extension | BUILD+LOAD PASS | manifest·declaration·공개 API 전체 로딩·vendor copy 검증·변조 및 기존 출력 교체 거절 |
| build/typecheck/architecture | PASS | inventory·rules·dependencies·transactions·durable boundaries·documents·spec inventory |

전체 suite와 crash의 15,433개 입력 bytes는 동일하고 전후 변경은 0건이다. 결과 기록과 evidence는
이 실행 후 작성한 입력이다. 코드 bytes는 바꾸지 않았으며 후속 기록에는 structure/문서/input 검사를
별도로 적용한다. 직접 검토한 변경 생산 delta는 49개, 전체 변경 생산 경로는 55개다. 상속된
미검토 50개를 유지한다. 이동된 211개 named declaration의 emitted representation을 비교하고,
바뀐 runtime body 세 곳의 wording/directory port 주입을 직접 검토했다. type-only 선언은 emit에서
지워지므로 이 비교를 타입 계약 검증으로 대신하지 않는다. source graph는 430 files / 1,802 runtime
edges / 471 type-only edges / runtime cycles 0이며 Store type-only SCC 한 묶음은 남는다.
단일 feature의 변경 비용 감소나 평점은 추정하지 않고 전체 changeset과 기존 owner inventory를
구분한다. 원시 로그와 최종 독립 산출물은 `/home/dev/oma-audit-artifacts/modules-2026-10-10`에 보존하고
명령·로그 hash·공통 입력 map은 [DR41 evidence](../../test/audit/modules-2026-10-10.evidence.json)에 기록했다.
검증의 현재 digest field는 전체 local gate 입력을 결박한다. runtime 뒤 작성한 결과 기록의 bytes까지
이미 실행했다고 주장하지 않는다. macOS native·VM power loss·paid provider·release qualification은
Linux 배치에서 NOT_RUN이다. 기존 시작 시간 목표는 이 배치에서 측정·개선하지 않았다.

## 추가 아키텍처 감사 (2026-10-10, DR40)

기준 `3b9bcea`에서 Human이 지정한 A-01~A-11을 구현했다. 계약·effect·capability의
소유권을 유지하면서 내부 간접 참조와 수동 동기화를 줄였다. 서브에이전트는 사용하지 않았다.
설정과 nested RPC 응답, transaction scope, 실제 Pi/LSP/MCP 및 아키텍처 negative control을 검증한다.
전체 local suite와 actual primitive crash 결과를 이 구간과
[바이트 증거](../../test/audit/architecture-2026-10-10.evidence.json)에 기록했다.

집중 첫 실행 83/83, 아키텍처 oracle·실제 Git changeset·원자 설정 view 59/59가 통과했다.
첫 Pi/LSP/MCP 집중 실행은 109 PASS / 38 FAIL이었다. 새 UI owner가 fixture의 controlled
import 목록에 없어서 interactive owner 38건이 거절됐으며 실제 helper를 fixture에 연결한
재실행은 38/38 PASS다. structure gate의 첫 7건 거절은 이동한 scratch/staging owner 선언을
정정한 뒤 0 findings다. 이동한 staging의 durable boundary 등록 경로도 정정했다.
그 검사 중 시작한 suite는 coordinator만 TERM으로 종료하고 해당 child가 종료할 때까지 기다렸으며
이 부분 실행을 전체 suite의 성공으로 표시하지 않는다. 실패 실행을 최종 PASS로 바꾸지 않는다.
첫 전체 실행은 3,966 PASS / 17 FAIL이다. 16건은 테스트 PATH에 설치된 oma 링크가
빠진 ENOENT였고, 1건은 이전 verification input digest가 남은 기록 오류였다.
입력은 15,419개이며 실행 전후 변경은 0건이다.
환경·기록을 정정한 두 번째 전체 실행은 3,982 PASS / 1 FAIL이다. Personal PTY 16건은
모두 통과했다. 남은 build-stamp fixture는 삭제한 inode가 재할당되지 않는다고 가정해
실패했다. 이전 출력의 descriptor를 재빌드 assertion까지 고정해 물리적인 교체 증거를
유지하도록 수정했고, 해당 파일 6/6이 통과했다. 두 번째 입력도 전후 변경 0건이다.
제품 build 구현은 변경하지 않았다. 고정한 최종 입력으로 전체 suite와 crash lane을 재검증했다.

| 최종 실행 | 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,983/3,983 | serial 9 + parallel 3,974; fail/cancel/skip/todo 0; 411 files, parallel 409, concurrency 8, TMPDIR=/var/tmp |
| actual crash lane | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP·부모 SIGKILL·재시작·반복 복구; VM power loss/entrypoint crash 증거는 아님 |
| build / typecheck / architecture | PASS | inventory·rules·dependencies·transactions·durable boundaries·documents·spec inventory; runtime cycles 0 |
| 전체 MCP vendor re-emit | PASS: BUNDLE_CURRENT 2,727 files | 기존 cross-spawn type 선언 관련 emit 진단은 남으며 baseline/current 모두 동일한 emitted set을 검증함 |

최종 runtime 입력 sha256는 `3b6620ac1d073e1be23979d38613a690afa8f7c3692d16a3b01a5ac6362085c3`다.
전체 suite와 crash lane의 15,419개 입력 bytes는 동일하며 실행 전후 변경은 0건이다.
이 결과 문서와 evidence는 실행 후 작성한 입력이다. 마지막 diff 검사에서 staging/tar 소스
두 파일의 끝 빈 줄도 제거했다. 재빌드한 15,150개 emitted file은 이전 실행 bytes와 모두
동일하다(build input identity stamp 제외). 이 후속 소스·기록 bytes까지 기존 runtime suite가
실행했다고 주장하지 않으며 architecture gate와 validation input 검사를 별도로 실행한다.
변경 생산 파일 21개의 delta와 영향 owner를 직접 검토하고 현재 SHA·DR40 oracle에 결박했다.
상속된 미검토 50개와 과거 native 검증은 재승인하지 않는다. 생성된 dependency graph는
423 files / 1,786 runtime edges / 454 type-only edges / runtime cycles 0이다.
Store 중심 type-only SCC 한 묶음은 남는다. LOC를 새로 측정한 주장은 하지 않는다.
실제 changeset은 이 11개 항목 전체의 55개 경로(source 21, tests 15, tools 9, metadata 10)다.
public mutation 13개의 관련 owner inventory 평균 14.46개와 구분하며, 한 feature의 변경 비용이
줄었다고 추정하지 않는다. 상세 명령·로그 SHA·input map은 evidence에 있고 원시 로그는
`/home/dev/oma-audit-artifacts/architecture-2026-10-10`에 보존했다.

SDK metadata 검사와 전체 vendor re-emit 검사를 구분한다. 첫 전체 re-emit은 생성기에
TypeScript import를 추가한 문자열 치환이 기존 divergence 템플릿까지 변경해 실패했다.
baseline 재실행은 통과했으며 템플릿의 원문을 복원해 생성기 회귀를 수정했다. 목록만
검사한 결과를 전체 vendor 재생성 성공으로 표시하지 않는다. 기존 private Pi hook·Store type-only 순환·복잡한
보안 데이터 흐름 검사는 남는다. 평점이나 단일 feature 변경 파일 수 개선을 추정하지 않는다.
macOS native·VM power loss·paid provider·release qualification은 이번 실행에서 NOT_RUN이다.
시작 시간 목표는 이번 아키텍처 배치에서 개선하지 않았다.

## 아키텍처 변경 책임 분리 (2026-10-09, DR39)

DR38 여섯 결함 수정·푸시 완료 뒤 승인받은 구조 개선을 구현했다.
Society settings/panel, Review documents/status, VM/Keychain API의 변경 책임을 분리하고
codec key와 paramsCheck owner symbol의 중복 선언 두 개를 실제 메서드에서 도출한다.
현재 진입점 1020→879줄, Review 1281→1126줄이다. 파일 크기는 구조적 완료의 증명이 아니다.
Broker·Store·acceptance·recovery 소유권은 유지한다. 서브에이전트는 사용하지 않았다.

추출 단계에서 build/typecheck와 structure gate 0 findings, 집중 회귀 216/216, settings composition
62/62가 통과했다. 첫 전체 local suite는 serial 9 PASS, parallel 3,959 PASS / 3 FAIL이었다. 새로운 파일이 inventory에 게시되기 전에
시작한 structure 검사 2건은 manifest 누락으로 실패했고, 생성 완료 후 재실행은 통과했다.
최초 settings 추출은 raw stat owned-state 규칙에 거절되어 기존 inode-checked pointer reader로
수정했다. 이 실패들을 최종 PASS로 바꾸지 않는다.

실제 PTY 기준은 화면 3.028초 / broker 15.054초 / 첫 도구 15.779초이며 SQLite mutation이
정확히 한 번 succeeded다. 5초 예산 실패로 harness exit 1이다. BPF-filtered process trace의
clone 8.568초 / pack-objects 7.202초 / strict fsck 2.983초는 trace 실행 값이다.
Git transport 옵션의 별도 실험은 개선이 부족해 적용하지 않았다. 전체 ptrace 실행은
화면 지연·응답 timeout 후 종료되어 성능 기준으로 쓰지 않는다. 시작 목표는 미달이다.

설정 pointer의 같은 크기/mtime 교체와 unobservable read 재확인, review history 20,000건의
newest suffix, UTF-8 notice 분할과 경계 newline을 집중 검사했다. VM credential API는 별도
surface로 검사했다. Swift stop 오류 무시를 수정했지만 native Swift 컴파일·실행은 NOT_RUN이다.
[Apple stop API](https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop%28completionhandler%3A%29)의 오류가 nil일 때만 stop 성공이라는 계약에 따라 구현했으며 이 문서 확인은
실행 증거가 아니다. macOS native, paid provider, VM power loss와 release qualification도 미실행이다.

기존 입력 digest에서 빠졌던 `platform/`과 `.gitignore`도 현재 source closure에 포함했다.
Swift·guest unit·source publication 규칙의 변경을 바이트로 추적하며 native 실행 PASS를 뜻하지 않는다.
첫 전체 suite의 15,403 입력은 `92bae4d455f2cb420b43feade3ee843821e3d7cfcbd86ba7b093b8c387a540d6`이고
전후 byte 변경은 0건이다. TMPDIR=/var/tmp의 disk filesystem에서 directory allocation이
4096-byte fixture target을 넘는 오류와 preaccept inode 재사용·publication create/flock 수거
경쟁의 실제 결함을 발견했다. 이 첫 실행은 실패이며 최종 PASS로 바꾸지 않는다.
수정 후 affected owners 113/113가 통과했다. 새 collector-before-flock 회귀는 baseline에서
실패, 현재 코드에서 통과했다. inode pin은 acceptance/discard/refusal에서 실제 닫힘을 검사했다.
수정한 15,404 입력을 다시 고정해 전체 local suite, actual crash와 PTY를 실행했다.
최종 runtime 입력 sha256는 `fc4796d0cc73aa62d3627bf32909d9837b03801b160ac5f2dacaeec9ef20332f`다.
실행 전후 15,404개 source bytes의 변경은 0건이다. 이 결과 기록과 evidence는 실행 후 입력이다.
그 미래 바이트까지 runtime suite가 실행한 것으로 주장하지 않는다. 기록 후 구조 검사를 재실행한다.

| 최종 실행 | 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,973/3,973 | serial 9 + parallel 3,964; fail/cancel/skip/todo 0; 407 files, parallel 405, concurrency 8, TMPDIR=/var/tmp |
| actual crash lane | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP·부모 SIGKILL·반복 복구; VM power loss/entrypoint crash 증거는 아님 |
| build / typecheck / architecture | PASS | source inventory·rules·dependencies·transactions·boundaries·documents·spec inventory; runtime cycles 0 |
| 최종 Society PTY 3회 | 화면 2.96~3.07초, broker 15.06~15.37초, 첫 도구 15.83~16.21초 | 새 HOME/data, installed OMA와 bundled Pi, 실제 systemd broker, provider만 로컬 시험 응답; 3회 모두 mutation succeeded 정확히 한 행과 child exit 0 |

시작 예산 5초는 **FAIL**이며 PTY harness exit 1을 성공으로 바꾸지 않는다. 1초 목표도 미달이다.
이 배치에서 Git pack 실험을 제품에 넣지 않았고 시작 시간 개선을 달성한 주장은 하지 않는다.
preaccept pin은 정산까지 파일당 descriptor 하나를 사용한다. 실제 OS descriptor/I/O 한계는
명시적 오류로 보존하며 새 OMA quota를 만들지 않는다. pre-lock 준비 중 죽은 plain temporary는
살아 있는 writer의 죽음을 입증하지 못하므로 보존한다.
이번 review ledger는 수정과 새 owner 15개를 현재 bytes와 oracle에 결박했다. 상속된 미검토
50개나 과거 native 환경 PASS를 재승인하지 않는다. 상세 명령·로그 SHA·source SHA·중간 실패는
[DR39 evidence](../../test/audit/architecture-2026-10-09.evidence.json)에 기록했다.
원시 로그는 `/tmp/oma-architecture-2026-10-09`, 별도 Git trace2 실험은
`/home/dev/oma-audit-artifacts/architecture/git-transport-2026-10-09`에 보존했다.
결과 기록의 미래 바이트는 그 runtime 실행의 입력으로 주장하지 않는다.

## 이전 실행 결과: host·guest 소유권·종료·ready 수정 (2026-10-09, DR38)

Human이 제시한 6건을 수정했다. 중복 maintenance lease와 외부 해제 거절,
host state-disk 작업 직렬화, 같은 society의 open/resume/close 직렬화, running project binding,
필수 ready record publication, 실패를 보존하는 종료와 API/lock 정리를 구현했다.
HostService의 project/session/snapshot/transfer 조정을 4개 concrete owner로 분리했다.
네트워크는 DR37의 unrestricted host 정책을 유지하며 guest role/allow를 권한 증거로 쓰지 않는다.
변경 생산 파일 12개의 수정과 영향 owner를 직접 검토하고 SHA-256·named DR38 oracle에 결박했다.
서브에이전트는 사용하지 않았다. 당시 추가 아키텍처 개선은 수정 완료 뒤 계획만 작성하는 범위였다.
이후 진행 승인이 DR39의 구현 범위를 추가했다.

수정 전 회귀에서 8개의 동작 실패를 재현했다. 기존 shutdown 실패가 API listener를 남겨
검사 worker가 종료되지 않아 해당 검사 소유 worker 하나를 TERM으로 정리했다. 이 실행을
정상 종료한 suite로 표시하지 않는다. 수정 후 platform 5개 파일 집중 검사 80/80,
실제 daemon entry의 controlled native boundary 검사 4/4가 통과했다.
entry 첫 실행의 1건 실패는 assert.match에 문자열을 전달한 테스트 오류였으며 수정 후 4 PASS다.

| 검사 | 이번 실행 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,962/3,962 | serial 9 + parallel 3,953; fail/cancel/skip/todo 0. 405개 파일, parallel 403개 concurrency 8 |
| build / typecheck | PASS | 이번 최종 생산 코드와 테스트 입력 |
| architecture aggregate | PASS: 0 findings | inventory·rules·architecture·transactions·boundaries·documents·spec inventory; runtime cycle 0 |

첫 구조 검사는 새 coordinator의 raw directory listing 2곳과 archive existence probe 1곳을
거절했다. 기존 host-owned listing/permission repair를 사용하고 관측 불가·archive 비정상 entry를
refuse하도록 수정해 통과했다. 이 실패 로그도 보존했다. review ledger 첫 시도는 inventory
생성 완료 전에 실행해 새 파일을 거절했으며 inventory 완료 뒤 재실행했다.

전체 local suite의 입력은 15,382 files, sha256
`0ee898bf2cbcd92d73b89c35a00719df16db9796a471d0d96149b9de92b1fe05`다.
suite 전후 전체 입력의 바이트를 대조해 변경 0건을 확인했다. 아래 현재 구조 입력 field와
이 결과 문서·[DR38 evidence](../../test/audit/host-ownership-2026-10-09.evidence.json)는 실행 후
기록이다. 그 미래 바이트까지 runtime suite가 실행한 것으로 다루지 않는다. 기록 뒤 구조 검사를
별도로 실행한다. 명령·로그 SHA·변경 생산 파일 SHA와 미실행 범위는 evidence에 있다.

이 Linux 실행은 LocalDriver·guest services·Host API Unix socket·copyFileSync clone 및
controlled macOS entry 경계를 검증한다. Virtualization.framework/APFS/Keychain/AF_VSOCK
native·macOS VM boot·power loss는 미실행이다. 이전 kernel/crash PASS는 DR37 당시 결과다.
이번 수정은 앞선 시작 시간의 새 측정이 아니며 최초 Society의 전체 준비 5초 예산은 여전히
충족했다고 주장할 수 없다. raw log는 `/tmp/oma-host-ownership-2026-10-09`에 보존한다.

현재 구조 검사의 입력 identity(생성 자체는 runtime PASS가 아니다):
verification input digest `bf286431ffb1095fcb3d8c71eef8cbb10fc6e744f34c1001628b04116a12f2a8` (15681 files).

## 이전 실행 결과: 지정한 제한 제거·기능 복구 (2026-10-09, DR37)

사용자가 지정한 SC-01/02/03/04/05/20/23/26/30/31/32, 총 11개 항목을 구현하고 검증했다.
SC-01~05/20/31의 OMA 네트워크·실행 자원·인원·저장 quota를 제거하고,
SC-23/26의 MCP·웹 기능, SC-30의 reader 소유 패키지 GC, SC-32의 비동기 fd 자동완성을 복구했다.
문서와 실제 실행 측정부터 진행했고 서브에이전트는 사용하지 않았다.
45개 변경 생산 파일과 영향 owner를 직접 검토하고 현재 SHA-256와 named oracle에 결박했다.
상속된 미검토 파일이나 과거 환경 PASS를 metadata 생성으로 재승인하지 않는다.

| 검사 | 이번 최종 실행 결과 | 범위 |
|---|---|---|
| `node scripts/test-local.mjs` (별도 build 후) | PASS: 3,946/3,946 | serial 9 + parallel 3,937. fail/cancel/skip/todo 0. 404개 파일: serial 2 + parallel 402, concurrency 8 |
| `verify-lane.mjs kernel` | EXECUTED+PASS: 68/68 | 실제 user systemd/cgroup/bwrap/socket, checker와 MCP/web native 추가 3건 포함 |
| `verify-lane.mjs crash` | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP/부모 SIGKILL·반복 복구; VM power loss는 미실행 |
| build / typecheck / architecture aggregate | PASS | inventory·rules·architecture·transactions·durable registry·documents·spec inventory |
| `npm audit --json` | PASS: 알려진 취약점 0건 | 이번 변경에서 의존성 버전을 바꾸지 않음 |

실제 두 confined Worker의 TCP·UDP, private HTTP의 목적지 인증 보존·proxy 인증 제거,
12개 CONNECT 동시 연결을 관측했다. checker는 인터넷을 사용하며 과거 1초 제한을 넘어
정상 완료하고, owner 취소 시 남은 자식까지 전체 cgroup을 종료한다. MCP credential helper의
실제 명령 실행과 웹 configured/per-call proxy의 실제 요청도 통과했다.

패키지 reader 회귀는 production client-preload를 실행한다. reader SIGKILL 전에는 세대를
보존하고 종료 뒤 회수한다. collector가 rename 후 marker를 지운 다음 SIGKILL되어도
`.collecting-*` tombstone을 재시작에서 회수한다. metadata index의 단기 lease는 즉시 닫으며,
상주 publisher에서 실제 `packages.sync` 3회 후 옛 세대가 회수된다. fd는 Pi installer로
백그라운드 설치하며 기존 autocomplete provider가 설치 뒤 재귀 결과를 내는 회귀가 통과했다.

첫 kernel 실행은 67 PASS·1 FAIL이었다. `TasksMax`를 생략해도 systemd 기본값 38,426이
실제 적용되는 결함을 발견했다. Resident/checker에 `TasksMax=infinity`를 명시하고 manager에서
무한 값을 관측하는 회귀를 추가해 최종 68 PASS를 얻었다. 전체 세 번째 실행의 serial 9 PASS /
parallel 3,879 PASS·56 FAIL과 네 번째의 serial 9 PASS / parallel 3,936 PASS·1 FAIL 로그는
보존했다. 제거한 heartbeat의 남은 호출을 수정하고 stale 환경·surface oracle 및 reader lease가
없는 역사적 extension fixture를 정산했다. 이 중간 실행들을 최종 PASS로 바꾸지 않는다.

시작 측정은 전체 검사 종료 뒤 Personal·Society 즉시 도구·Society 일반 대화를 각각 3회씩
순서대로 실행했다. 새로운 HOME/data와 현재 checkout, 실제 OMA entry·bundled Pi·PTY를
사용하며 모델만 로컬 대본이다. OS page cache는 비우지 않았고 모든 child exit는 0이다.

| 실제 관측 | 최종 3회 범위 | 요청한 예산 판정 |
|---|---|---|
| Personal 화면 / 첫 응답 | 1.23~1.25초 / 1.54~1.56초 | 5초 이내; 1초 목표 미달 |
| Society 화면 / 일반 대화 첫 응답 | 2.95~3.08초 / 3.22~3.35초 | 대화는 5초 이내; 1초 목표 미달 |
| 최초 Society broker 준비 | 14.76~14.97초 | 전체 준비 5초 목표 **FAIL** |
| 시작 직후 첫 Society tool 완료 | 15.49~15.72초 | 3회 모두 SQLite의 `society.set` succeeded 정확히 한 행; 5초 목표 **FAIL** |

변경 전 실제 1회는 화면 2.931초·broker 14.561초·첫 도구 15.262초였다.
`--wait-broker --early-tool` 명령의 exit 1은 예산 미달이다. 도구 실행 실패와 혼동하거나
PASS로 바꾸지 않는다. 처음부터 요청한 도구가 준비를 기다리는 시간은 화면 표시와 별개다.

```sh
npm run build
node scripts/test-local.mjs
npm run typecheck
npm run check:architecture
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs kernel --out <new-directory>
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs crash --out <another-new-directory>
python3 scripts/benchmark-startup.py --node <node24> --mode personal --runs 3
python3 scripts/benchmark-startup.py --node <node24> --runs 3 --wait-broker --early-tool
python3 scripts/benchmark-startup.py --node <node24> --runs 3
npm audit --json
```

Node v24.21.0, Linux UID 1001, user systemd 257.13, bwrap 0.12.0, cgroup v2에서 실행했다.
local suite는 `OMA_TEST_SYSTEMD=0`과 local-test-guard, 존재하지 않는 user bus를 쓰며,
native lane은 실제 `/run/user/1001/bus`에서 guard 없이 실행한다. PATH에는 cloc 2.08과
현재 dist를 가리키는 임시 `oma` 링크를 포함한다. 명령·raw log SHA·실측·변경 실행 파일 SHA는
[DR37 evidence](../../test/audit/unrestricted-2026-10-09.evidence.json)에 있다.
원시 로그는 `/tmp/oma-unrestricted-2026-10-09`에 보존했다.

runtime 입력은 15,376 files, sha256 `8cb5c9c1b0bf0f760205ab88dfd4401cbc3cb1f1bf5cde631ac9c314fd667cca`였다.
local/kernel/crash와 최종 시작 측정 뒤 15,376개 파일의 바이트를 고정 map과 대조해 변경 0건을
확인했다. 이 결과 문서와 evidence는 실행 이후 기록이다. 그 미래 바이트까지 runtime suite가
실행했다는 뜻이 아니며, 기록 후 구조 검사를 별도로 재실행한다.

미실행: macOS Virtualization.framework/APFS/Keychain/AF_VSOCK native·VM 부팅,
실제 유료 provider, VM power loss, host reboot, 전체 release qualification.
새 NAT NIC의 guest DHCP/DNS 계약은 [macOS 플랫폼](../macos-platform.md)과 DR37을 따른다.
외부 signed guest image가 network unit·virtio_net·networkd/resolved·resolv.conf 연결을 포함해야
한다. 이 저장소에는 image builder가 없어 image packaging/부팅을 수행하지 않았다.
legacy reader marker 없는 package 세대는 기존 독자 종료를 증명할 수 없어 보존한다.
프로토콜 payload 문법/바이트 검증과 P0 권한·파일·종료 소유는 유지한다.

## 이전 실행 결과: 적대적 감사 발견 수정·재검증 (2026-10-09, DR36)

사용자의 전체 수정·푸시 지시에 따라 수정과 현재 입력의 검사를 실행했다. 아래 기록 전용 감사와 이전 suite 수는
해당 시점의 기록이다. 최초 13건의 수정 상태는 [audit](../priority-0-audit.md), 추가로 조사한
인터넷·skills·MCP 등의 32개 제한은 [장부](../user-expectation-ledger.md)에 있다.
서브에이전트 없이 직접 수정·검증했다. 역사적 결함 oracle의 exit 0은 수정 성공으로 바꾸지 않는다.

| 검사 | 당시 실행 결과 | 범위 |
|---|---|---|
| `npm test` | PASS: 3,938/3,938 | serial 9 + parallel 3,929. fail/cancel/skip/todo 0. 403개 파일; systemd 필수 9개 파일은 별도 lane |
| `verify-lane.mjs kernel` | EXECUTED+PASS: 65/65 | 실제 user systemd/cgroup/bwrap/Unix socket. broker 재시작 포함 |
| `verify-lane.mjs crash` | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP/부모 SIGKILL·반복 복구. VM power loss 증거는 아님 |
| native candidate 대조 | PASS: 4건 | baseline, memory cap +1 byte, stdout/stderr 각각 1 MiB 초과 정상 완료, 검증된 2,147,484초 timeout 실제 실행 |
| build / typecheck / architecture aggregate | PASS | inventory, rules, architecture, transactions, durable registry, documents, spec inventory 포함. registry strongest-injection 숫자는 이번 실제 kill 수가 아님 |
| `npm audit --json` | PASS: 알려진 취약점 0건 | nodemailer 10.0.16 고정; 일반 SMTP 원격 공격의 OMA 재현 주장은 없음 |

집중 검사에는 read-only 봉인·owned traversal·quota 26 PASS, 수리·MIME·production C 24 PASS,
준비/수리 13 PASS, 이력 격리/숫자/Principal fixture 정산 24 PASS, 공개 Pi API와 process owner 대역
110 PASS가 있다. 이전 전체 시도의 95개 실패는 보존했으며 원인은
stale API 대역·비동기 권한 재검사 횟수·sync timeout 거절 타입·PATH의 cloc 부재·입력 digest였다.
첫 진단 실행은 Git 비공개 객체 유입과 오래된 숫자 oracle를 발견했고, 등록되지 않은 가짜
Principal 대기 때문에 중단했다. 당시 Personal PTY의 `spawn oma ENOENT`는 임시 설치 링크를
빠뜨린 검사 환경 문제였다. 새 fixture는 실제 grant/attach와 설치 명령을 제공한다.

kernel 첫 실행은 64 PASS/1 FAIL이었다. 새 quota 관측이 immutable context directory를
0555에서 0755로 바꾸어 다음 broker가 STORE_CORRUPT로 거절하는 실제 제품 결함이었다.
관측에 read/search만 수리하도록 고치고 기존 strict validator를 유지했다. 봉인 보존 회귀와
새 kernel lane 65 PASS가 이를 검증한다. 첫 실패 로그는 보존했다.

최종 시작 측정은 빌드·테스트와 겹치지 않게 3회씩 순서대로 실행했다. 각 회는 새로운
HOME/data와 같은 현재 checkout, 실제 OMA entry·bundled Pi·PTY를 쓴다. 모델만 로컬 대본이며
OS page cache는 비우지 않았다. 모든 child exit 0이다.

| 실제 관측 | 3회 범위 | 요청한 예산 판정 |
|---|---|---|
| Personal 화면 / 첫 응답 | 1.22~1.24초 / 1.51~1.53초 | 5초 이내; 1초 목표 미달 |
| Society 화면 / 일반 대화 첫 응답 | 2.93~2.99초 / 3.22~3.27초 | 대화는 5초 이내; 1초 목표 미달 |
| 최초 Society broker 준비 | 14.47~14.67초 | 전체 준비 5초 목표 **FAIL** |
| 시작 직후 첫 Society tool 완료 | 15.19~15.38초 | 모두 SQLite에서 `society.set` succeeded 정확히 한 행; 5초 목표 **FAIL** |

`--wait-broker --early-tool` 측정 명령은 예산 미달로 exit 1을 반환했다. 이를 도구 실패나 PASS로
바꾸지 않는다. 부하가 겹친 이전 측정과 Human private 객체를 잘못 복사했던 약 9초 측정은
현재 성능 판정에서 제외한다. Human protocol clone의 별도 단독 대조는 약 6.4초였고
`pack.window=0`도 유의미하게 개선하지 않아 적용하지 않았다. 개인정보 경계·strict history 검증을
건너뛴 시간을 목표 달성으로 다루지 않는다.

```sh
npm test
npm run typecheck
npm run check:architecture
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs kernel --out <new-directory>
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs crash --out <another-new-directory>
node test/audit/repairs-2026-10-09/native-checks.mjs
python3 scripts/benchmark-startup.py --node <node24> --runs 3 --wait-broker --early-tool
python3 scripts/benchmark-startup.py --node <node24> --mode personal --runs 3
python3 scripts/benchmark-startup.py --node <node24> --runs 3
npm audit --json
```

이 호스트는 Node `/opt/oma-test-node/bin/node` v24.21.0, UID 1001,
`XDG_RUNTIME_DIR=/run/user/1001`이다. local suite의 PATH에는 cloc 2.08과 설치된 `oma` 명령이
필요하다. 이번에는 `/tmp/oma-repair-2026-10-09/bin/oma`가 현재 빌드 entry를 가리키게 했다.
raw 로그는 그 `/tmp` 아래 남겼다. portable 판정·명령·source/log 해시는
[DR36 수정 evidence](../../test/audit/repairs-2026-10-09.evidence.json)에 있다.

전체 suite 실행 시 입력 closure는 sha256 `924ba992c8f836bffc9a8f550ce4acc82a3151bc444b488262f212b5de9ae822`
(15,374 files)였다. 이후 바뀐 것은 결과 문서·evidence이며 실행 코드·테스트·설정 바이트는
실행 시작 시 고정한 해시와 대조한다. kernel 실행 중 생성된 review/LOC metadata와 기록 문서도
당시 capture 이후 변경으로 별도 표시했다; 그 lane의 실행 코드·테스트는 일치한다.
위 DR37 구조 identity는 이후 기록까지 포함한다. 과거 suite가 미래의 자기 결과 문서까지
검증했다는 뜻이 아니다. 각 작업의 기록 후 구조 검사는 별도로 실행한다.

미실행: macOS Virtualization.framework/APFS/Keychain/AF_VSOCK native, 실제 유료 provider,
VM power loss, host reboot, 전체 release qualification. 이전 패키지 세대 보유에 따른 디스크 증가와
정적 provenance의 dynamic-call 한계도 남는다. 58개 변경 생산 파일과 영향 owner를 직접 검토한 것이며,
상속된 미검토 파일을 metadata 재생성만으로 승인하지 않는다.

## 과거 작업: 추가 적대적 감사·기록만 (2026-10-08–09)

이 절의 판정은 수정 지시 이전 기록이다. 아래 checkpoint·전수 원장·suite 수는 해당 시점의 기록이다.
기준 HEAD `0364e99c`와 DR35의 미커밋 시작 수정이 있는 worktree를 함께 고정하고 감사했다.
서브에이전트 없이 문서·실행 먼저 진행했다. production 수정과 기존 테스트 수정은 없다.

발견 13건 중 10건은 실행 재현, 2건은 정적 근거, 1건은 내부 중복으로 분류했고 모두 OPEN이다.
의미·심각도·수정 방향은 [audit](../priority-0-audit.md)의 AV-20261008-01–13이 소유한다.
원시 관측값·양성 대조·source/compiled/Pi 바이트·검사 결과·마지막 대조는
[evidence](../../test/audit/adversarial-2026-10-08.evidence.json), 영역별 검토와 미실행 범위는
[coverage](../../test/audit/adversarial-2026-10-08.coverage.json)에 있다.

이번 oracle는 결함을 재현하면 exit 0이다. 이를 제품 수정 PASS로 읽지 않는다.
confined check는 실제 user manager/cgroup/bwrap에서 대조 검사까지 실행했다.
설정은 실제 두 writer, 패키지는 실제 archive/apply/index와 import된 확장 reader,
C는 production relay의 Unix socketpair 경계, 시작은 실제 PTY와 bundled Pi(모델만 대본)이다.
이 범위를 실제 Mac VM·AF_VSOCK·유료 provider·powercut·전체 release 증거로 확대하지 않는다.
앞선 3,919-suite PASS를 이번 입력의 fresh whole-suite PASS로 재결박하지 않았다.

빌드된 owner가 필요한 재현 명령(빌드는 현재 source에서 준비되어 있어야 함):

```sh
node test/audit/adversarial-2026-10-08/settings-race.mjs
node test/audit/adversarial-2026-10-08/quota-probe.mjs
node test/audit/adversarial-2026-10-08/package-generation.mjs
XDG_RUNTIME_DIR=/run/user/1001 node test/audit/adversarial-2026-10-08/native-checks.mjs
cc -O2 -Wall -Wextra -o /tmp/oma-audit-relay test/audit/adversarial-2026-10-08/relay-probe.c
/tmp/oma-audit-relay
python3 test/audit/adversarial-2026-10-08/early-tool-benchmark.py --node /opt/oma-test-node/bin/node --runs 1
```

실행 환경은 Node v24.21.0, Linux UID 1001, 현재 checkout의 pinned Pi 1.0.1이다.
다른 UID의 `XDG_RUNTIME_DIR`와 Node 경로는 해당 환경에 맞춘다. script의 임시 상태는 자체 소유한 경로에만
만들며 PTY 원시 artifact는 `/tmp`에 남긴다. metadata 손상 시험은 root 권한의 통과를 허용하지 않는다.
architecture rule의 fresh 실행은 PASS/0 findings였지만 실제 AV-01을 놓쳤다. 구조 검사의 한계를 audit에 기록했다.
문서/기록 검사와 최종 생산 바이트 대조의 정확한 판정은 evidence의 `checks`/`finalByteComparison`에 기록한다.
감사 기록 추가로 검증 입력이 바뀌는 것을 기존 release/whole-source PASS의 자동 재승인으로 다루지 않는다.

기준: 2026-10-03 적대적 검증, 생산 source checkpoint `a75c29911c077a2d2b207a48773268e2e2355ca0`. 이 문서는 현재 판정·실행 결과·수치·로그·한계의 단일 owner다. 검증 요구는 [verification-spec](../verification-spec.md), 과거 실행은 [archive](../archive.md)가 소유한다.

## 과거 source 판정 (2026-10-03)

전수 감사는 **진행 중**이다. 현재 production 356개와 추가 실행·계약·native·build/verification source 74개를
[파일별 원장](../../test/audit/full-2026-10-03.review.json)에 고정했다. 원장의 개별 상태·P0 근거가 진행 판정이며,
아래 세 차례의 선택 경계 coverage는 당시 snapshot으로 보존한다. 전수 정적 검토와 실제 release/플랫폼 실행은 별개다.

**Release-blocked.** 최근 mail-v1 merge/review/challenge의 코드와 집중 회귀는 존재한다. 앞선 세 차례 탐색의 제품 결함 16건과 검증 artifact 불일치 1건에 이번 전수 pass의 제품 결함 1건을 더해, 현재 제품 17건 + 검증 artifact 1건이 모두 미수정이다. 전체 구현, 현재 입력의 전체 suite, native macOS 완료를 주장하지 않는다. merge-review spec의 설계안 지위나 활성 규범을 이번 감사로 변경하지 않는다. 아래 2026-10-02 문서 통합과 마지막 기능 checkpoint는 각각 당시 실행 범위를 보존한 기록이다.

## 전수 감사 인계 시점

2026-10-03 사용자 요청으로 [HANDOFF](../HANDOFF.md)에 완료·남은 영역과 직전 작업을 기록했다.
현재 source 범위와 개별 판정은 [전수 원장](../../test/audit/full-2026-10-03.review.json),
신규 결함은 [AV-18](../priority-0-audit.md#av-20261003-18--context-준비-실패가-이미-획득한-lease를-반환하지-않음-p2)을 따른다.

| 항목 | 인계 시점 판정 |
|---|---|
| 고정 전체 정적 범위 | production 356 + 추가 source 74 = 430개. 원장 줄 수는 개행으로 센 참고치이며 cloc 측정이 아님 |
| 전체 읽기와 파일별 P0 판정 저장 | `REVIEWED_STATIC` 430개: production 356 + 추가 74 — 전수 완료. 직접 판정 50 + 위임 pass 취합 342 + B-pass(비P0 일반버그 wave) 잔여 38 |
| 위임 pass | 7개 백그라운드 에이전트 부분 중복 분업(사용자 명시 승인), 부모가 발견 교차 확인·기록. 에이전트는 읽기 전용 |
| 판정 미완료 잔여 | 없음 — B2가 잔여 비TUI 9개, B1이 TUI 28개를 whole-read로 확정해 430/430. 일반 버그 pass로 NB-01..NB-28 추가 기록 |
| source bytes | UNCHANGED: 원장의 production/추가 430개 SHA-256 모두 재대조. HEAD `a75c299` 유지 |
| 신규 required-behavior oracle | DEFECTS REPRODUCED: 4 tests, fail 4, pass/skip/cancel 0 — AV-18(lease fd 잔류), AV-19(`.prepare-*` 잔재 수거 불가), AV-20(startup 비-mail 격리 부재: sweep은 격리·startup은 reject), AV-25(비UTF-8 파일명 → `kind:"corrupt"`) |
| 기존 선택 회귀 | 앞선 세 pass의 361 PASS 기록 보존. 이번 인계 작업에서 다시 실행한 것은 아님 |
| 현재 발견 | AV-01..31 총 31건: 제품 27 + 검증 도구/artifact 4, 모두 미수정 |
| 해결된 후보 | 직전 3개 후보 모두 확정: 임시 tree 잔재(AV-19), workerStatus frame(AV-24), surrogate/비UTF-8 이름(AV-25) |
| full evidence 마감 | NOT_COMPLETE: 새 source/oracle/log/compiled/report 결박 evidence를 마감해야 함. 첫 세 evidence는 역사적 snapshot 그대로 유지 |
| 전체 정적 감사 / 실제 플랫폼·release | INCOMPLETE / NOT_RUN. macOS/native·systemd·powercut·전체 release lane은 여전히 NOT_RUN |

[full oracle](../../test/audit/adversarial-2026-10-03-full.mjs)의 AV-18/19/20/25 실행 로그는 `/tmp/oma-full-oracles-2.log`다.
실제 사용자 상태, manager/VM, provider는 사용하지 않았다. 문서 검사 로그는 `/tmp/oma-full-handoff-documents.log`다.

## 2026-10-03 적대적 검증

사용자 요청으로 clean tree에 기준 커밋 `a75c299`를 만든 뒤 빌드한 생산 코드에 검증을 실행했다.
생산 코드 수정은 없으며, 발견·근거·수정 방향은 [감사 기록](../priority-0-audit.md#2026-10-03-적대적-검증--기준-커밋-a75c299)이 소유한다.
재현 artifact는 [adversarial-2026-10-03.mjs](../../test/audit/adversarial-2026-10-03.mjs)다.
source/fixture/oracle SHA-256과 실행 summary는 [감사 evidence](../../test/audit/adversarial-2026-10-03.evidence.json)에 결박했다.
이 파일도 release qualification을 뜻하지 않는다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| build / typecheck | PASS | `/opt/oma-test-node/bin`의 Node 24.21.0. 생산 코드와 TypeScript 시험을 현재 source로 빌드 |
| merge/review/challenge 집중 회귀 | PASS | 6개 파일, 79 tests, fail/skip/cancel 0 |
| grammar/evaluator fuzz/mail facts/P0/confinement 회귀 | PASS | 6개 파일, 75 tests, fail/skip/cancel 0. fuzz는 3 seeds × 170 ledgers |
| 신규 적대적 oracle | DEFECTS REPRODUCED | 8 tests, fail 8, skip/cancel 0. 제품이 지켜야 할 동작을 assert하며 AV-01..07을 검출. AV-03은 mode/bounds 두 조건 |
| check:architecture | FAIL | 첫 check:inventory에서 source list/LOC hashes 불일치. 이후 chain 단계는 이 aggregate 호출에서 NOT_RUN |
| check:architecture:rules | PASS | 독립 실행, 0 findings |
| check:boundaries | PASS | 구조 검사, 0 findings. registry strongest-injection counts는 이번 실행의 실제 kill 수가 아님 |
| check:documents / git diff --check | PASS | 감사 문서 저장 후에도 문서 구조·링크 검사 0 findings, whitespace 오류 없음 |

집중 회귀 명령과 standalone 재현 명령은 다음과 같다. `NODE_OPTIONS`의 guard 경로는 child가 cwd를
바꾸어도 해석되도록 절대 경로로 지정했다. 상대 guard 경로로 시작한 첫 시도는 CLI child import 실패여서
제품 실패나 위 표의 실행 결과로 세지 않고, 절대 경로로 다시 실행한 결과를 사용했다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
npm run build
npm run typecheck
node --test --test-concurrency=1 \
  dist/test/merge-review.test.js dist/test/challenge-review.test.js \
  dist/test/review-faults.test.js dist/test/review-concurrency.test.js \
  dist/test/review-evaluation.test.js dist/test/merge-cli.test.js
node --test --test-concurrency=1 \
  dist/test/review-grammar.test.js dist/test/review-evaluation-fuzz.test.js \
  dist/test/mail-facts-boundary.test.js dist/test/priority-0.test.js \
  dist/test/p0-review7.test.js dist/test/resident-confinement.test.js
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03.mjs
```

standalone 재현은 현재 결함이 있는 source에서 exit 1이 정상적인 **검출 결과**다. suite PASS로 승격하지 않는다.
독립 재현은 root-level normal suite에 자동 편입되지 않으며, 수정과 함께 정상 회귀로 옮길 수 있다.
위 명령은 전체 `npm test`, 환경 lane, SIGKILL/powercut 검증을 실행하지 않는다.
실제 사용자 OMA/VM·인증 정보·유료 provider는 사용하지 않았다. inherited execution exclusions는 HANDOFF에 유지한다.

로그는 `/tmp/oma-adversarial-{build,typecheck,baseline,extended,reproductions,architecture,rules,boundaries,documents}.log`다.
임시 로그는 release evidence로 등록하지 않았다. 이번 source에 과거 LOC/trace evidence를 자동 재사용하거나
measurement 파일을 손으로 수정하지 않았다.

### 2차 경계 확장

같은 `a75c299` 생산 source에서 메일 read/reply/arrival, corruption fence, config generation,
lifecycle authority와 IPC 자원 수명으로 범위를 넓혔다. 파일별 선택 경계·한계는
[감사 기록의 2차 검증](../priority-0-audit.md#2차-검증--메일권한설정ipc-경계-확장)에 기록했다.
새 [oracle](../../test/audit/adversarial-2026-10-03-second.mjs)과
[evidence](../../test/audit/adversarial-2026-10-03-second.evidence.json)는 이 실행을 별도로 결박한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| config/mail/IPC/run/registry/TUI/contained-tools 회귀 | PASS | 아래 11개 파일, 106 tests, fail/skip/cancel 0. 1차 154개와 합해 선택 회귀 260개 |
| 추가 적대적 oracle | DEFECTS REPRODUCED | 4 tests, fail 4, skip/cancel 0. AV-09..12 각각 required behavior assertion 실패 |
| 초기 long-thread 탐색 | INCONCLUSIVE | 8192-byte fixture의 350-entry 시도: 3 defect assertions fail, history test 1 cancelled(timeout). history 자체는 이 결과로 확정하지 않음 |
| 축소 long-thread 재현 | DEFECT REPRODUCED | 2048-byte supported config, 정상 접수 40개 이후 short vote와 cancel 거절, reopen 뒤 cancel도 거절. 최종 4-oracle 실행에 포함 |
| 생산 source 변경 여부 | UNCHANGED | 같은 source digest와 HEAD. 생산 코드 수정 없음 |
| 문서·whitespace 검사 | PASS | 추가 발견·범위·한계 저장 뒤 독립 실행 |

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test \
  dist/test/config-generations.test.js dist/test/config-snapshot.test.js \
  dist/test/operations-config.test.js dist/test/mail-integrity.test.js \
  dist/test/mail-recovery-integrity.test.js dist/test/mail-reply.test.js \
  dist/test/r14-connection-lifecycle.test.js dist/test/r16-run-registry.test.js \
  dist/test/r25-lifecycle-owners.test.js dist/test/tui-sources.test.js \
  dist/test/contained-tools.test.js
node --test test/audit/adversarial-2026-10-03-second.mjs
```

2차 로그: `/tmp/oma-adversarial-second-baseline.log`,
`/tmp/oma-adversarial-second-reproductions.log`(초기 timeout 포함),
`/tmp/oma-adversarial-thread-boundary.log`(축소 독립 재현),
`/tmp/oma-adversarial-second-final.log`(최종 4개 oracle),
`/tmp/oma-adversarial-second-documents.log`.
log/source/oracle SHA-256은 2차 evidence를 따른다. initial timeout을 PASS나 새로운 결함으로 승격하지 않는다.
직접 만든 Unix socket endpoint는 tool→CLI 재현의 로컬 fixture이며 native actor 인증 검증을 대신하지 않는다.
실제 manager/VM/provider, 전체 suite, SIGKILL/powercut lane은 계속 NOT_RUN이다.

### 3차 범위 확장과 coverage 공개

같은 생산 source에서 inference relay construction/connection bounds, host/guest run 종료, late resolver와
platform request ledger를 추가 검증했다. source는 checkpoint와 동일하고 제품 수정은 없다.
새 [oracle](../../test/audit/adversarial-2026-10-03-third.mjs)과
[evidence](../../test/audit/adversarial-2026-10-03-third.evidence.json)는 이 실행을 결박한다.
발견과 파일별 경계 판정은 [감사 기록의 3차 검증](../priority-0-audit.md#3차-검증--추론-연결실행-종료영속-원장)을 따른다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| relay/egress/tenure/history/delivery-deadlines 회귀 | PASS | 아래 5개 파일, 81 tests, fail/skip/cancel 0 |
| guest request ledger 회귀 | PASS | 별도 1개 파일, 20 tests, fail/skip/cancel 0. 3차 총 101개, 누적 선택 회귀 361개. 임시 원장 전용 child의 during-effect/after-outcome SIGKILL 2개 포함 |
| 추가 적대적 oracle | DEFECTS REPRODUCED | 5 tests, fail 5, skip/cancel 0. AV-13..17 required behavior 실패. 총 발견 17개 가운데 제품 16/검증 artifact 1 |
| source와 compiled artifact 결박 | UNCHANGED / BOUND | production manifest의 현재 356 files를 1차 source hashes와 대조. 3차 oracle이 import한 compiled file과 회귀 fixture hashes도 기록 |
| 전체 파일 review coverage | INCOMPLETE | production 356개 중 전체 파일 읽기+선택 경계 판정 19개, 선택 함수 판정 36개, 이번 감사의 경계 판정 기록 없음 301개 |
| 문서·whitespace 검사 | PASS | 추가 발견과 범위 목록 저장 뒤 독립 실행 |

coverage는 [파일별 JSON](../../test/audit/adversarial-2026-10-03.coverage.json)의 356개 행에서 계산했다.
전체 파일을 읽었다고 모든 branch/규칙을 검증한 것은 아니다. 55개 파일의 선택 경계 기록도 전수 감사를 뜻하지 않는다.
“기록 없음”은 이번 감사에서 개별 경계 판정을 남기지 않았다는 뜻이며, 예전 commit의 검토나 회귀 실행만으로 상태를 올리지 않는다.
이 목록은 production source의 범위다. 시험·문서·생성 artifact는 해당 실행·hash 목록에서 별도로 다루며
전체 repository의 모든 파일을 감사 완료했다고 주장하지 않는다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test \
  dist/test/inference-relay.test.js dist/test/platform-egress.test.js \
  dist/test/host-tenure.test.js dist/test/session-history.test.js \
  dist/test/delivery-deadlines.test.js
node --test dist/test/platform-request-ledger.test.js
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03-third.mjs
```

3차 로그: `/tmp/oma-adversarial-third-regressions.log`, `/tmp/oma-adversarial-third-ledger-regressions.log`, `/tmp/oma-adversarial-third-oracles.log`,
`/tmp/oma-adversarial-third-documents.log`. source/oracle/coverage/report/log hashes는 3차 evidence를 따른다.
앞선 두 evidence의 report hashes는 당시 저장된 report snapshot이며 3차 실행 판정으로 승격하지 않는다.
3차 fixture는 실제 임시 Unix sockets·product pool/service/parser·synthetic credential만 사용한다.
AV-14/15의 provider 응답 대조는 endpoint 밖 경로의 relay HTTP 403이고 upstream 요청은 없다.
기존 relay 회귀는 loopback의 self-signed TLS provider stand-in을 사용한다. 외부·유료 provider는 사용하지 않는다.
host/guest byte channel의 hello는 fixture가 공급하므로 native VM/bridge/authentication proof를 대신하지 않는다.
임시 ledger의 두 SIGKILL 시험을 다른 durable 경계나 전원 손실 proof로 일반화하지 않는다.
실제 manager/VM, 전체 suite, 전체 SIGKILL/powercut lane은 계속 NOT_RUN이다.

### 마지막 기능 checkpoint

다음은 문서 통합 전 마지막 기능 변경의 checkpoint다. 상세 로그와 당시 source binding은 [정리 전 검증 기록](../archive/validation-before-consolidation.md)에 보존했다. 과거 전체 실행을 현재 PASS로 사용하지 않는다.

| 요구 | 실제 구현과 정상/실패 oracle | 현재 판정·남은 것 |
|---|---|---|
| A tier/floor/checks | `runtime/candidate-checks`, GitModule callback와 broker 조립; candidate-checks·tiered-integration·tier-evaluator·integration-revalidation | 코드/fixture 검증. reviewer shortage 예외는 미구현/별도 거절에 따른 차단 상태. 실제 manager/cgroup candidate 검사도 별도 거절로 NOT_RUN. mutation/실환경 proof 미완료 |
| B Principal | `principalRequestAllowed`, PublicDispatcher, tool-surface와 workspace-guard; principal-stop-fence·tool-surface·실제 Pi의 loopback functional scenario | 제한적 source/runtime 회귀 통과. 다른 도구의 권한은 Principal routine 권한으로 승격하지 않음 |
| C 독립 clone/최초 snapshot/Config/수량 | `lifecycle/workspace`의 `clone --no-local`, raw worktree snapshot, Initial workers commit, 생성 quota와 inference slots; project-snapshot·worker-autonomy·settings-apply-time | SHA1/SHA256/dirty bytes·손상 거절·설정 0 및 재시작 회귀 확인. unit 설치는 scripted; manager proof 아님 |
| D closed/개별 stopped | `lifecycle/society`, actions와 reconcile activation gate; society-control·worker-autonomy·r25-lifecycle-owners | closed 재열기와 terminal replay·개별 stopped·현재 incarnation 회귀 확인. fake units를 실제 manager 증거로 취급하지 않음 |
| E 시간값·선택 mail | PiAdapter/PrincipalDelivery, selector alarm, egress placeholder alarm; delivery-deadlines·egress-observation-deadlines·r25-lifecycle-owners·f3-log-frame | 전체 TypeScript native timer/phase-budget call sites 분류. model/tool 전체 실행 deadline 없음. 긴 selector/egress waits의 native clamp 수정. 종료 grace는 writer exit proof가 아님 |
| F1 Mac seed | host-record project UUID/bookmark/root, bundled Git/helper, existing settings writer의 async seed; mac-project-seed·personal-settings·platform-host-service | absent binding은 빈 seed, unknown은 거절. bound project의 첫 seed에는 이미 실행 중인 app/guest가 필요함. Swift bookmark helper NOT_BUILT/NOT_RUN |
| F2 history | guest/host canonical identity·read-only paged preview·one private duplex channel·actual outgoing exit·post-cleanup host reread; host-history·guest-history·actual local PTY holder·composition/ownership | Linux의 로컬 실제 file/socket/PTY와 controlled process 경계 회귀 확인. remote 검색은 title/첫 메시지 preview 범위. native Mac/actual systemd holder 시작은 NOT_RUN |
| G 기록 | source owners, stale byte-review 철회, LOC/graph/ledger/trace/current digest | 정리 전 checkpoint는 archive에 보존. 이번 reference/trace 결박·구조 검사는 별도로 갱신하며 과거 static PASS를 새 입력에 재사용하지 않음 |

## 이번 문서 통합의 검증

문서 경로·owner·규범 fingerprint 구조 확인은 runtime/systemd/provider proof와 구분한다. 아래는 Node 24.21.0을 사용한 이번 문서 통합의 실행 결과다.

| 검사 | 판정 | 범위 |
|---|---|---|
| 문서 배치·링크·ID/수용 번호 | PASS | 새 파일·이동 파일 포함, 링크/ID/owner 검사 0 findings. 기존 규범 375개 ID와 수용 124행의 번호·내용 유지. 규범 내용은 경로·링크를 제외하고 동일 |
| 고정 architecture·계획·외부 리뷰 bytes | PASS | 정리 전 156개 파일의 SHA-256과 대조. 원문 bytes 동일 |
| 새 merge-review spec 본문 | PASS | 상대 Markdown 링크를 제외한 원문 동일성 확인. 설계·본문 보존 |
| document/trace/compliance/verification/review 경로 회귀 | PASS | 관련 8개 파일의 44 tests, fail/skip/cancel 0. 실제 서비스 실행 제외 |
| build / typecheck / check:architecture | PASS | 패키지 정적 검사·production inventory·규칙·의존 방향·transaction·durable boundary·문서 검사 |
| trace inventory / review ledger 생성 | GENERATED | 실제 owner 경로로 생성. 규범 375개 모두 unverified, stale/extra 0. 기존 UNIT-TPL-001..004의 inventory 누락도 복구. 생성은 검증 승격이 아님 |
| pinned cloc 재측정 | PASS | production 목록·원본 hash·측정 artifact 결박. 크기 상한 없음 |

실행 로그는 `/tmp/oma-doc-cleanup-build.log`, `/tmp/oma-doc-cleanup-typecheck.log`, `/tmp/oma-doc-cleanup-architecture.log`, `/tmp/oma-doc-cleanup-regressions.log`, `/tmp/oma-doc-cleanup-loc.log`, `/tmp/oma-doc-cleanup-review-ledger.log`에 있다. 임시 로그는 release evidence로 등록하지 않았다.

집중 회귀의 실행 명령:

```sh
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs \
  test/review-ledger.test.mjs test/consistency-decisions.test.mjs \
  test/review-closure.test.mjs test/durable-boundaries.test.mjs \
  test/production-inventory.test.mjs dist/test/compliance.test.js
```

## 선행 작업 A: Pi 0.87.1 → 1.0.1 이식 검증 (2026-10-05)

동봉 엔진을 `@earendil-works/pi-coding-agent@0.87.1`→`1.0.1`, `@earendil-works/pi-tui@0.87.1`→`1.0.1`,
`pi-open-tui@0.3.9`→`0.3.11`로 원자적으로 올렸다(package.json + package-lock 한 커밋). 이식 내용과
upstream delta 판정은 [plan §A 실행 결과](../plan-prereq-and-bundled.md#a-실행-결과-1010311-이식-완료)가 소유한다.
`PI_ADAPTER_REVISION`은 ENG1 관례대로 검증한 엔진을 이름에 박아 `oma-pi-rpc-v1@1.0.1`이 되었고
BATCH-006의 규범 본문과 trace 행도 같은 문자열로 재결박했다. 0.87.1 adapter의 미정산 영수증은
업그레이드 뒤 conflicting이다 — 기존 society는 정산 뒤 올린다(ENG1과 같은 절차).

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| package-lock / 설치 closure | PASS | `npm install` 재생성, `npm ls @earendil-works/pi-tui` 단일 1.0.1(dedupe, 중첩 사본 없음). pi-agent-core/pi-ai는 `^1.0.1` 범위로 1.0.3 |
| build / typecheck | PASS | Node 24.21.0(`/opt/oma-test-node/bin`), `npm run build` + `tsc --noEmit` 0 오류 |
| pi-compat 오라클 | PASS | `test/pi-compat.test.ts` 전부 — 환경 스트립 목록·resume hint·private member 12개 존재를 설치본 1.0.1에서 실측 대조. `quietStartup "header"` literal 보존 회귀 추가 |
| wire/명령·호환 경계 | PASS | interactive-input 내장 명령 미러, `pi-ui-channel-spike`의 1.0.1 UI RPC 메서드 목록, `prompt-boundary` 경계 시험 |
| 실제 엔진 PTY 회귀 | PASS | `open-tui-pty`(8 ending) + `personal-pty`(15 ending): 실제 1.0.1 InteractiveMode + open-tui 0.3.11 extension + ownedEditor proxy로 /new·/resume·/fork·/reload·kill·retry·restore |
| delivery/authority 시나리오 | PASS | 전체 `npm test`의 SCN-*/DR27/broker/authority/receipt/frame-boundary 그룹 포함 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane — 아래 NOT_RUN 제외, 총수·실패수는 실행 로그가 소유 |
| check:architecture | PASS | inventory·rules·architecture-check·transactions·boundaries·documents·spec-inventory 0 findings |
| review-ledger / review-closure | GENERATED | 변경 production 파일은 `review-notes.json`의 byte-bound reviewedChange로 결박 후 재생성 |
| systemd-required suite | NOT_RUN | test-local이 명시한 9개 파일(audit/audit2/cli/phase4/phase5/phase8/crash-boundaries/launch-topology/cgroup-pin) — 이 Linux 호스트에 user bus/systemd 없음 |
| kernel/rootfs/deployment attestation | NOT_RUN | 빌드 스크립트가 "entrypoints not started, systemd/kernel/rootfs/Pi pins not attested, deploymentDigest 미합성"으로 보고 — 로컬 한계 그대로 |
| powercut / provider / CI / macOS native | NOT_RUN | 승인된 VM·credential·CI가 없어 이전과 같은 제외. V27A·V31A의 과거 PASS는 이 엔진/이 source로 승격하지 않는다 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업 C: `/society` 게이트 + execve 재진입 검증 (2026-10-05)

기록 없는 Personal 세션의 Society 전환을 구현했다 — `/society` → 프로젝트 자신의 슬롯(`<data>/<project>`)
읽기 전용 게이트 → `session_before_switch` → writer 실제 종료 → host가 `oma --society <project>`로
execve. 계약은 MODE-005, 설계 판정·명령명 확정·내구 경계 선택은 [plan §C 실행 결과](../plan-prereq-and-bundled.md)가
소유한다. 내구 경계는 슬롯의 `publishProjectBinding`: 게이트↔재진입 구간은 무기록이므로 그 사이의
kill/powercut은 다음 `/society`의 재관측으로 끝나고, binding 게시 뒤 재시작은 그 Society를 born으로
인식한다. 미확정 게시는 성공으로 승격하지 않는다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| 게이트 실파일 오라클 | PASS | `test/society-slot.test.ts` 8종 — free·슬롯 무생성, binding 게시→거절 전환(내구 경계), 다른 프로젝트/다른 society 바인딩, 손상 바인딩(unreadable), EACCES 관측 불가(unavailable→거절, 부재 승격 없음), binding 없는 Society 기록, 동일 birth 잔여=재개·다른 birth=거절, legacy slug 슬롯 |
| wire 문법 | PASS | `personal-session-ownership` — `{type:"switch", society}` 수락, session+society 혼합·미스트링·추가 키 거절, 실패 종료(≠0)에는 handoff 없음, 첫 유효 메시지만 |
| host 합성 | PASS | `personal-host-composition` — 자식 실제 종료 전 execve 없음, argv `[oma.js --society <project>]`, `OMA_RESUME_SESSION` 미설정, birth cwd로 chdir(resume된 창과 다를 수 있음), 이름 불일치 INVALID_REQUEST, execve 부재 UNSUPPORTED_PROFILE |
| 엔진 합성 | PASS | `personal-engine-ownership` — `society` 명령 등록, free 슬롯 → before-switch → send → shutdown 순서, 거절·관측 실패 통지 후 세션 유지, darwin 무전환 거절(게이트 미호출), before-switch cancel, 전환 중 이중 진입 불가, IPC send 실패 시 재시도 가능 |
| 실제 PTY 거절 | PASS | `personal-pty` `society-bound` — 설치본 Personal에서 바인딩된 슬롯에 `/society` 입력 시 이름 있는 거절이 화면에 보이고 세션은 계속 살아 응답 |
| 실제 전환 e2e (Linux) | PARTIAL — 환경 한계 | `/society`가 real TUI에서 gate→종료→execve `oma --society <project>`까지 수행됨을 pty-harness로 관측; 재진입 프로세스가 `project-binding.json`(canonical path)+`session-mode.json`(mode society)+provisioning 트리를 실제로 기록하고 Society Control Panel까지 도달. broker 시작은 `UNSUPPORTED_PROFILE: systemd user manager`로 정직 실패 — 이 호스트에 user bus 없음(기존 systemd NOT_RUN lane과 동일). TUI 단계 이후 정상 동작·Worker는 미검증 |
| 내구 경계 회귀 | PASS | `crash-kill-boundaries`의 D05/P0-7 binding SIGKILL 전 지점 absent-or-whole + 임시파일 수거 — `/society`가 의존하는 게시물의 기존 경계 시험 재확인 |
| 인접 회귀 | PASS | `project-binding`, `session-mode-record`, `session-resume`, `session-entry-composition`, `oma-composition-policy`, `session-handoff-owner`, `interactive-input`, `compact-tools`, `society-crash`, `session-mode-pty`, `personal-pty` 전 종 |
| check:architecture·inventory·ledger | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; `production-files.txt`/`production-loc-hashes.json`/`traceability.json`/`review-ledger.json` 재생성, `review-notes.json`에 신규·변경 파일의 byte-bound reviewedChange 결박 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3635 tests → 3634 PASS; 유일 실패 1건은 이 변경이 추가한 두 파일까지 반영하지 않은 stale verification-input digest로, digest를 이 트리의 것으로 갱신 후 `production-inventory` 재실행 10/10 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd broker 완주 / powercut·provider·CI | NOT_RUN | 승인된 환경 없음 — `/society`의 darwin 분기는 주입 시험만으로 구조 검증됐고 native 증거를 주장하지 않는다 |

## 선행 작업: bundled extension #4 — pi-web-access 검증 (2026-10-08)

§7 순서(lsp→ask→hashline→web→mcp)의 네 번째 확장. `pi-web-access@0.35.0`을
`src/extension/vendor/pi-web-access/`에 byte-pinned vendor하고 `src/extension/web-tools.ts`
어댑터가 verify→Society 정책 설치→facade→upstream 팩토리 순서로 정확히 4개
web_research 도구만 등록한다. 구현 내용과 divergence 목록은 WORKSTREAM §9 로그와
`src/extension/vendor/pi-web-access/NOTICE`가 소유한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| upstream 정체성 | PASS | npm tarball shasum `a807f0d5c6dfa6893f24e00320774a55425f864b`·SRI `sha512-D1GMJMNDG2omAkL1ztmO6ZEwEyW7LoFpTcckKh2yXjLyAgDFuhpTQrs2jQPAlVtGb3rjAeIXRZrkhFcwSWdGSg==`·source commit `72c6e67787d67d8a7d01bf0abf30c072a6112de6` — `manifest.json` package 필드와 생성기 EXPECTED_PACKAGE가 결박 |
| 번들 생성·재생성 | PASS | `node scripts/vendor-pi-web-access.mjs --check` → `BUNDLE_CURRENT` (11,020 files): staged 소스 재작성→tsc 재방출→divergence 재적용→발방출 집합 비교→매니페스트 메타(package·dependencies·divergences) 재검증 |
| 번들 무결성 경계 | PASS | `test/web-bundle.test.ts` 12종 — source/dist 번들 검증, 변경·누락·미기재·손상 멤버 fail-closed, upstream-tests 트리 보존(104 entries), 정확한 4개 도구·facade 전달만·검증 실패 시 등록 0+세션 거절, 역할 surface 정합(Principal·Resident 모두 web_research 그룹), ambient discovery deny-by-default(`!command` credential·browser cookies·gh/git clone·host ADC·native media·local file·curator workflows), egress 미결선 시 비어있지 않은 proxy 전면 거절·결선 시 pin 외 값 `[E_OMA_PROXY_PINNED]`, SSRF/내부 대상 사전 거절, 매니페스트 메타 결박 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings — 어댑터의 동적 import는 전부 검증된 번들 안 runtime/ 경로(undici dispatcher는 utils.js divergence의 re-export를 경유; runtime-closure 해석기는 node_modules 해결 지정자를 거절하므로) |
| check:package | PASS | vendored runtime의 host API(`@earendil-works/*`, typebox) import는 설치본 존재를 확인하는 host peer 의미로만 허용 — 사용자 설치 Pi 패키지 해석과 무관 |
| 인접 회귀 | PASS | `lsp-bundle`(BL1)·`hashline-bundle`(BL3)의 surface 테스트에 web_research 등록 집합·그룹 추가 후 전 종 PASS; `platform-packages`·`pi-packages-cli`·`p24-deployment-gates`·`personal-pty` 전 종 PASS — `deployment-manifest.ts`의 MAX_ENTRIES를 4096→32768로 상향(vendored 클로저 ~11k 파일이 deployment inventory walk의 해시 대상; bound는 여전히 absurd inventory 거절) |
| DR27 대기-관측 시나리오 | PASS | `scenario-agent-wait` 5/5 — `idleStreamSeconds` 2→6초·fixture 관측 지연 3.5→10초: 번들 검증(~0.5s)+모듈 평가(~0.8s)이 엔진 기동을 2초 예산 밖으로 밀어 DEADLINE_EXCEEDED로 deterministic 실패하던 것을 예산 상향으로 정정(관측이 제어-idle 예산을 outlive한다는 시나리오 의미 보존) |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3794 tests → 3790 PASS, 실패 4건의 내역: web-bundle/dist 1건과 R38 2건은 이 절 작성 시점의 미재생성 산출물(NOTICE 문구 갱신 후 dist·digest 미동기)로, 재빌드·digest 재결박 후 단독 재실행 전부 PASS; SCN-L02 1건은 8-way 병렬 aggregate에서만 재현되는 타이밍 flake로 단독 재실행 40/40 PASS — systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 | NOT_RUN | `upstream-tests/`는 provenance/포팅용으로 vendored — upstream 자체 하네스 의존(vitest·네트워크 fixture)이라 npm test에 연결하지 않음 |
| macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 승인된 환경 없음 — 이전과 같은 제외. vendored egress dispatcher의 실제 CONNECT forwarder 통과는 Linux 루프백 경계 시험까지만 확인 |

**정정 (후속 맹검증)**: 위 `npm test` 기록("3794 tests → 3790 PASS, 실패 4건")은 deterministic 실패 1건을 누락했다. 이 트리에서 `test/review-closure.test.mjs`의 "DR27/V32A: historical review cannot certify unbound working-tree changes"가 `git ls-tree -r --name-only -z HEAD`의 출력(1,064,186 bytes — vendored 번들이 HEAD tree listing을 Node `execFileSync` 기본 maxBuffer 1 MiB 위로 밀어 올림)이 default bound를 초과해 ENOBUFS로 실패하고, `node scripts/review-ledger.mjs`(`npm run review:ledger`)도 같은 call에서 ENOBUFS로 exit 1이었다. 기록된 4건의 열거에는 이 실패가 없으므로 당시 실행의 실제 실패 수는 최소 5건이었거나, 이 실패가 같은 실행에서 발생했다면 기록이 누락된 것이다. 수정: verification tooling의 모든 동기 git plumbing 호출(`review-ledger.mjs`의 `ls-tree`/`diff --name-only`/`log`, `review-closure.test.mjs`의 동일 두 call)에 canonical bound를 적용했다 — `scripts/review-closure.mjs`의 `GIT_PLUMBING_LIMITS`가 `CANONICAL_PROCESS_LIMITS`(src/git/canonical-command.ts)와 동일 값으로 test에서 결박되고, 회귀 test "V32A: verification git plumbing runs under the canonical process bound"가 generator의 모든 `execFileSync` call site가 bound를 통과함을 pin한다. 수정 후 `node scripts/review-ledger.mjs` exit 0, 해당 suite 파일 8/8 PASS.

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업: bundled extension #5 — pi-mcp-adapter 검증 (2026-10-09)

§7 순서의 마지막 확장. `pi-mcp-adapter@5.0.0`을
`src/extension/vendor/pi-mcp-adapter/`에 byte-pinned vendor하고
`src/extension/mcp-tools.ts` 어댑터가 verify→정책 설치→수명주기 훅→
facade→upstream `createMcpAdapter` 순서로 정확히 `mcp` 1개 도구만
등록한다 — upstream 자체가 lazy 단일 프록시라 OMA grouping을 얹지 않고
surface plan이 `mcp`를 DIRECT로 이름 붙인다. 구현 내용과 divergence
목록은 WORKSTREAM §9 로그와 `src/extension/vendor/pi-mcp-adapter/NOTICE`가
소유한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| upstream 정체성 | PASS | npm tarball shasum `6c20461d658ec7d7b7e303b067e2ff13a7846d00`·SRI `sha512-/3vWQLSXwud+VX1vV/dFfKpp6I40guCeqiaP/XMdXIyon+frIm+sPXGArLlmvY5PIwL2ChJ3AhELIusroGA8Ng==`·source commit `5783e5eacfe820829b18be5d4de91e5f46e79dbb` — `manifest.json` package 필드와 생성기 EXPECTED_PACKAGE가 결박 |
| 번들 생성·재생성 | PASS | `node scripts/vendor-pi-mcp-adapter.mjs --check` → `BUNDLE_CURRENT` (2,727 files): staged 소스 재작성→tsc 재방출→27파일 divergence 재적용→발방출 집합 비교→매니페스트 메타(package·dependencies·divergences) 재검증. upstream `npx-resolver.ts`의 implicit any·cross-spawn 선언 부재에 대한 비치명 tsc 진단은 stderr에 기록되나 발방출 집합 일치 시 성공(BL4 관례) |
| 의존 클로저 | PASS | DEPENDENCIES 핀 테이블 42개 패키지(`@modelcontextprotocol/client`·`core`·`ext-tasks`, `undici`, `zod`, `ajv` 계열, `open` 계열, `@napi-rs/keyring`, `recheck`, `quickjs-wasi` 등)가 `node_modules/` 아래 npm tarball 바이트 그대로(2,086 files); 사용자 설치 패키지는 어떤 vendored import도 충족하지 못한다 — 번들 자체 node_modules walk만 허용 |
| 번들 무결성 경계 | PASS | `test/mcp-bundle.test.ts` 14종 — source/dist 번들 검증, 변경·누락·미기재·링크·손상 멤버 fail-closed, upstream-tests 트리 보존(207 entries), 정확한 `mcp` 1개 도구·facade 전달만(command·flag·shortcut drop 기록)·검증 실패 시 등록 0+세션 거절, `registerMcpServer`/`getMcpServers` 부재로 Pi built-in MCP 공존 경로 소등(`piSupportsMcp` false), 두 role surface plan이 `mcp`를 DIRECT로 명명·그룹 없음, config 검증이 `imports`·`claudePlugins`·surface-변경 설정·`npx`/`npm` command·비-http(s) url·`!`-command secret sink를 거절, OMA 소유 `mcp-adapter.json`(Pi built-in `mcp.json`과 구분되는 upstream adapter-config 이름)만 읽고 malformed fail-closed, OMA state의 credential key·scratch 수명주기(shutdown에 삭제), 공유 child-env scrub(allowlist·proxy pin 일치만·scratch redirect), 정책 설치가 vendored runtime 안에서 live, egress pin·loopback bypass·무결선 no-proxy fallback, 매니페스트 메타 결박 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings — `mcp-tools.ts`의 raw fs mutation은 Pi extension 경계 면제 표(`state-tree-rules.mjs`·`owned-state-rules.mjs`, lsp-tools와 같은 사유)에 명시 등록; `production-files.txt`·`production-loc-hashes.json`·`dependency-graph.json` 재생성 |
| check:package | PASS | vendored runtime의 host API import는 BL4와 같은 host peer 의미로만 허용 |
| `--no-extensions` 정합 | PASS | `pi-spawn-plan.ts`·`pi-interactive-host.ts`·`pi-personal.ts`의 세 엔진 경로 전부 `--no-extensions`(discovery 소등)와 명시 `-e` core extension 경로를 양립 사용 — vendored 등록은 core extension 안에서 일어나므로 정책 충돌 없음 |
| 인접 회귀 | PASS | `lsp-bundle`(BL1)·`hashline-bundle`(BL3)·`web-bundle`(BL4)의 surface 테스트 등록 집합에 `mcp` 추가 후 전 종 PASS — 공유 `child-env.ts` 추출로 LSP의 child env 의미 변경 없음을 lsp suite가 재확인 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane — 재결박 전 첫 실행은 3809 tests → 3803 PASS·6 실패로, 6건 전부가 이 절 작성 시점의 미재생성 산출물(BL1/BL3/BL4 surface 집합 미갱신 3건, review-closure의 ledger 결박 2건, R38 verification-input digest 1건)이었다; 수정·재생성 후 해당 파일 단독 재실행 전부 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 | NOT_RUN | `upstream-tests/`는 provenance/포팅용으로 vendored — upstream 자체 하네스(vitest·네트워크 fixture) 의존이라 npm test에 연결하지 않음 |
| 실제 MCP server live 세션 / macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 승인된 환경·자격 없음 — 경계 시험은 fakePi·정책 프로브·loopback 경계까지, 실제 downstream MCP 서버와의 end-to-end 세션 증거는 주장하지 않는다 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업: bundled extension #5 — pi-mcp-adapter 맹검증 정산 검증 (2026-10-09)

BL5 vendored 어댑터에 대한 맹검증 잔여 발견 F1–F6의 정산. 구현 내용은
WORKSTREAM §9의 해당 로그가 소유한다; 이 절은 검증 범위만 기록한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| F1 SDK child-env union | PASS | `mcp-tools.ts`의 `childEnvFinish`가 scrub 결과 위에 vendored SDK `getDefaultEnvironment` underlay 이름의 `undefined` tombstone을 씌운다 — vendored `node_modules/.../stdio.mjs`의 실제 `StdioClientTransport`로 child를 spawn해 `process.env`를 직렬화, scrub이 거절한 `SHELL`과 win32 underlay 이름(APPDATA·HOMEDRIVE·HOMEPATH·LOCALAPPDATA·SYSTEMROOT·TEMP·USERNAME·USERPROFILE·PROGRAMFILES·LOGNAME·TERM·USER)이 child에서 부재·`HOME`/`LANG`/`PATH`는 OMA 값으로 존재를 확인; tombstone을 뺀 대조군에서는 `SHELL`이 SDK underlay에서 재유입됨을 같이 관측해 결함 재현. dependency 바이트 변경 없이 OMA 소유 코드에서 해결 |
| F2 UI-session escape | PASS | `OmaMcpPolicy`에 deny-by-default `ui-session` permit 추가; `direct-tools.js`·`proxy-modes.js`는 UI-resource 호출을 구조화된 `ui_session_refused`로 조기 거절하고 `ui-session.js`·`glimpse-ui.js`는 방어심층 게이트로 `who`/`orca` subprocess·`npm root -g`·host-global `glimpseui` 동적 import·browser open에 도달하기 전에 거절 — fakePi로 실 vendored stdio server를 띄운 E2E 포함, 정책 미설치 시 upstream 동작 보존 |
| F3 부재 판정 | PASS | `existsSync` 대신 `statSync` ENOENT-only catch — chmod 000 config는 `EACCES`로 propagate(빈 config로 오인 금지)·비-정규 경로는 `[E_OMA_MCP_CONFIG]` 경계 에러·malformed JSON과 구분; `oauth-file-key` 읽기 실패도 ENOENT만 "없음"이고 나머지는 재throw해 침묵 키 재발급 차단 |
| F4 command admission | PASS | `npx`/`npm` 거절이 basename 정규화(`/`, `\`, `.cmd/.exe/.bat/.ps1` shim, 대소문자) 후 비교 — `/usr/bin/npx`·`./node_modules/.bin/npx`·`C:\Tools\npm.cmd`·`C:\Program Files\nodejs\npx.EXE`·`npm.ps1`·`npx.bat`·`NPM` 전부 거절, `npm-helper`·`npx-serve`·`srv.CMD`·`/usr/local/bin/server-bin` 허가 유지 |
| F5 dead code | PASS | 미사용 `omaStateDir()` 헬퍼와 `{stateDir:"",durable:false}` 폴백 제거 — typecheck이 참조 부재를 입증 |
| F6 tautological assert | PASS | `mcp-bundle.test.ts`의 upstream-tests 검증에서 직전에 assert된 조건을 반복하던 `A || B` 분기를 vitest config·test-runner 존재와 suite 규모(>=150 test files)의 실체 검증으로 교체 — vendored 트리가 테스트를 침묵 상실하면 실패 |
| 번들 재생성 | PASS | `node scripts/vendor-pi-mcp-adapter.mjs --write`로 runtime·manifest 재생성 후 `--check` → `BUNDLE_CURRENT` (2,727 files); 의미 변경은 전부 `OMA_DIVERGENCES` 표 기술분, dependency 바이트 무수정 |
| `pi.events` posture | PASS(기록) | facade가 `pi.events`를 그대로 전달하고 `pi-mcp-adapter:runtime-register`는 `normalizeOmaMcpConfig`를 우회해 runtime 서버를 등록할 수 있다 — in-process 전용이고 다른 OMA 확장이 발행할 수 없으며 런타임 거절은 등록 서버에도 적용됨을 모듈 주석·review-notes에 기록; 완전히 닫힌 경계가 아니라 문서화된 posture |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture / check:package | PASS | inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; host API peer import 정책 변경 없음 |
| `test/mcp-bundle.test.ts` | PASS | 18종 전 종 PASS (기존 14종 + tombstone 실spawn·UI 거절 E2E·ENOENT-only 부재·basename 거절 확장) |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3813 tests → 3812 PASS; 유일 실패 1건은 이 절 추가·정산 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 10/10 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 / live MCP 세션 / macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 이전 절과 동일 — 승인된 환경·자격 없음, 경계 시험까지만 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: post-listen 'error' 전수 스캔 검증 (2026-10-07)

DR34 후반에서 미뤄 둔 "listen 성공 후 `.off`로 유일한 'error' 리스너를 해제" 부류의 6곳 전수 정산과 동일 emit-탈출 잔여(rpc FrameParser·egress-bridge stderr·cloc 계정 own-key)의 로컬 검증. 결정론 오라클은 `server.emit("error", EMFILE)`의 동기 주입 — 리스너가 없으면 그 자리에서 throw이고, 있으면 영구 리스너가 journal만 하고 흡수한다.

| 절차 | 결과 | 근거 |
|---|---|---|
| post-listen 'error' 흡수 — 6곳 | PASS | `test/post-listen-error.test.ts` 9 오라클: `server.emit("error", EMFILE)` 직접 주입 뒤 ①영구 리스너 정확히 1개, ②journal 도달(console.error 캡처·audit `(listener)`/`fail`·`onError` 콜백), ③`server.listening` 유지, ④같은 소켓 이름이 여전히 연결을 받음. 죽은 journal 싱크(throwing audit·throwing onError)도 emit을 탈출하지 않음 |
| oma-society 저널 심 | PASS | `EgressForwarder.listen`의 새 `onError`가 `openPrincipalEgress`→`adoptPrincipalEgress`→`notice`로 연결; `egress degradation` 스모크가 adoption 경유 옵션 통과 확인. HostTenure 소유·hold/abandon 계약 불변 — 영구 리스너는 bound 유지라 close/lease 수명에 손대지 않음 |
| rpc FrameParser emit 경계 | PASS | NaN frameBytes 주입 시 생성자 throw이 'data' emit 탈출·uncaughtException 대신 읽기의 RangeError 거절이 되고 `escaped=[]` (platform-rpc.test.ts DR27 신설) |
| egress-bridge·inference-bridge 리스너 가드 | PASS | 실제 EADDRINUSE + `stderr.write`가 던지는 상태에서 두 bridge 모두 wedge 없이 degraded resolve, uncaughtException 0건; inference bridge는 guard 아래 fallback retry가 실제 바인드 포트의 provider URL을 등록 (extension-bridges.test.ts 신설) |
| vendored curator-server | PASS | `runtime/curator-server.js`에 OMA_DIVERGENCES splice로 영구 리스너 + 보호된 journal 적용 — `node scripts/vendor-pi-web-access.mjs --check` → BUNDLE_CURRENT(11,020 files); 설치된 표면은 workflow pin이 "none"이라 도달 불가, 미설치 평가 대비 defense in depth |
| cloc 계정 own-key | PASS | `Object.hasOwn` 기반 `rowAt`으로 `constructor`/`hasOwnProperty` 이름의 인벤토리 멤버가 prototype 상속 멤버로 오계정되지 않음을 inventory-evidence-split 신규 오라클로 고정; `temporary editor file` verdict 인정 추가, 관측 이상 verdict(file size·not-file·cannot read·unable to associate)는 여전히 게이트 실패 |
| startup reject 계약 유지 | PASS | bind 실패는 여전히 `once("error", reject/failed)`가 거절 — 영구 리스너는 대체가 아니라 병존(기존 startup-failure 테스트 전부 PASS로 간접 입증) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; LOC-004 재지문 drift 없음 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3829 tests, 3828 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification / 실제 fd 소진 주입 | NOT_RUN | 로컬 환경 부재 — 게스트·omahostd 단위의 in-situ 관측과 실제 EMFILE 유도(프로세스 fd 한도 소진)는 환경 의존이라 비결정론적이라 의도적으로 제외, 동기 emit 주입으로 같은 경계를 결정론적으로 커버 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: post-listen 'error' 잔여 — vendored listen 경계·emit 안 저널·emit 안 재등록 검증 (2026-10-07)

직전 전수 스캔(위 절)이 고친 부류의 맹검증 잔여 4건 정산. 같은 모델 — 동기 emit 안에서 던지면 emit을 탈출해 프로세스가 죽는다 — 을 vendored listen 경계, 공유 저널, 'listening' emit, request/upgrade emit에 적용했다.

| 절차 | 결과 | 근거 |
|---|---|---|
| vendored pi-mcp-adapter listen 경계 3곳 | PASS | `OMA_DIVERGENCES` splice만으로 정산(생성 runtime 직접 수정 없음): `runtime/ui-server.js` host server(후보별 once-listener 재무장+성공 시 해제)·sandbox proxy(동일 once+off)와 `runtime/mcp-callback-server.js`(once-listener가 성공 후에도 제거되지 않아 첫 post-listen 에러는 settled reject가 삼키고 둘째는 emit을 탈출하던 전이 결함) — 셋 다 영구 리스너 + 보호된 journal, callback은 named `onStartupError`를 listen 성공 시점에 정확히 해제해 "삼킴→무가드" 전이 제거. callback 서버는 허용된 auth:"oauth" 경로로 실도달(mcp-auth-flow → ensureCallbackServer). runtime·manifest는 스크립트 재생성물, `node scripts/vendor-pi-mcp-adapter.mjs --check` → BUNDLE_CURRENT(2,727 files) |
| vendored emit 주입 오라클 | PASS | `mcp-bundle.test.ts` 신규 2종: `Server.prototype.listen` 캡처로 클로저 내부 server에 도달 — 콜백 서버는 연속 2회 `emit("error", EMFILE)` 전부 journal 도달·`listenerCount("error")===1`(startup once 해제)·listening 유지·같은 포트 계속 connect·uncaughtException 0; ui-server는 host+proxy 각각 흡수 |
| broker cleanup 저널 | PASS | `cleanupError`의 `console.error`를 보호된 best-effort write로 — `listen`의 영구 리스너와 `listenActor`의 run-revoke 경로가 모두 동기 'error' emit 안에서 이 싱크에 도달하고, 죽은 stderr의 throw는 emit을 다시 탈출하던 것. `post-listen-error.test.ts` 신규 오라클: 던지는 console.error 아래 실제 `server.emit("error")` 흡수(listening 유지) + 공유 싱크 직접 호출 무탈출 |
| cloc 구조 키 충돌 | PASS | `rowAt`이 `header`/`SUM`/`nonCode` 구조 멤버를 파일 row로 읽지 않도록 `CLOC_REPORT_STRUCTURE_KEYS`로 배제 — 루트에 같은 이름의 파일이 있으면 구조 값이 그 파일의 row로 오독돼 phantom 계정되던 슬롯. 실제 행은 `./`-철자 키(구조 키·prototype 멤버와 충돌 불가) 또는 nonCode verdict만 계정. `inventory-evidence-split.test.mjs` 신규 오라클: 구조만 있는 세 이름 각각이 `cloc omitted or misclassified`로 실패 + `./`행·nonCode verdict는 정상 계정 — 실패 방향 고정 |
| inference-bridge 'listening' emit | PASS | 'listening'도 같은 동기 emit 경계 — emit 안 `registerProvider` 재등록을 가드. 거절은 pre-listen이 설치한 unreachable provider를 그대로 유지(안전한 degraded: relay는 unused로 listen하고 engine이 우회하지 않음), journal은 best-effort, unref·resolve는 도달. `extension-bridges.test.ts` 오라클: 실제 EADDRINUSE fallback + 재등록을 거절하는 registerProvider → wedge 없이 resolve·uncaughtException 0·등록은 unreachable만·저널 기록 |
| inference-relay request/upgrade emit 경계 | PASS | `forward`/`tunnel` 호출을 emit 경계 try/catch로 감쌈 — `admit`이 Refusal이 아닌 실패를 재던지면 unguarded는 `server.emit`을 통째로 탈출해 runner 사망이 되던 것을 그 연결 destroy+`failed` 계수로(정책 거절 refused와 구분, connect-proxy가 같은 부류에 두는 경계). `inference-relay.test.ts` 오라클: `server.emit("request"/"upgrade")` 직접 주입(읽을 수 없는 headers로 admit 안 비Refusal throw 유도) → 연결만 파괴·failed=2·refused=0·escaped=[]·listening 유지. 평가하고 범위 밖으로 둔 잔여: provider 쪽 `upstream` ClientRequest의 'upgrade'/'response'/'error' 리스너 — 본문의 socket write/end/writeHead는 이 Node(destroyed socket도 동기 throw 대신 비동기 'error')에서 emit을 탈출하는 동기 throw 경로가 없고, `accept()`의 `server.emit("connection")`는 http 내부 리스너 대상이라 같은 판정 |
| startup reject 계약 유지 | PASS | vendored 경계 모두 startup bind 실패는 여전히 once-listener가 reject — 영구 리스너는 대체가 아니라 병존이고 callback은 named listener 해제가 listen 성공에만 묶임(기존 startup-failure 테스트 PASS로 간접 입증) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,835 tests, 3,834 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification / 실제 fd 소진 주입 | NOT_RUN | 직전 절과 동일 — 로컬 환경 부재, 동기 emit 주입이 같은 경계의 결정론 오라클 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: 운영 읽기의 진단 예산 공유 결함 (UX-37, 2026-10-07)

`LedgerReader.all`이 행마다 `DIAGNOSTIC_READ_LIMITS`(10,000행/32MiB)를 과금해 운영 흐름(상태 표시·runner 대기열·principal relay·recovery)이 society의 행 수만으로 `LIMIT_EXCEEDED`로 거절되던 결함을 정산했다. 관리자 진단 스냅샷의 유한 상한은 유지한다 — 같은 상태에서 `readDiagnosticSnapshot`만 계속 `LIMIT_EXCEEDED`로 거절함을 대조군으로 고정.

| 절차 | 결과 | 근거 |
|---|---|---|
| 운영 카운트는 SQL 집계 | PASS | `LedgerReader.pendingDeliveryCount`는 `COUNT(*)`; `broker/composition.ts`의 dispatcher port가 이를 직접 바인딩해 `runner.pending`·principal relay가 목록을 물질화하지 않는다. 카운트는 읽기를 줄일 뿐 숨기지 않는다 — 실제 순회 경로는 여전히 행마다 디코딩·검증 |
| 대량 운영 열거는 keyset 스트림 | PASS | `pendingDeliveryRows`는 `MAX(rowid)`를 순회 시작에 동결하고 128행 닫힌 페이지를 `rowid > after`로 진행 — yield 사이에 열린 커서가 없고, 순회 중 새 수용은 이번 순회가 아닌 다음 순회에 귀속. `pendingDeliveries`는 이 스트림의 완전 수집 |
| 나머지 운영 열거는 예산 없는 완전 수집 | PASS | `agents`·`subscriptions`·`submissions`·`attestations`·`recoverableIds`·`operationDeliveries`·`pendingWorkRows`·`preparedBatches`·배치 링크드 목록이 더 이상 행/바이트 상한을 과금하지 않는다. 리니지·소유자·매니페스트↔멤버·수신자 스냅샷 등 행별 검증은 유지. 같은 컬렉션 안 반복 관측은 `ReadScope`로 동기 창 일관 보장 |
| 실패는 빈 답으로 승격하지 않음 | PASS | 어떤 운영 읽기도 query 실패를 `[]`로 변환하지 않는다 — `prepare` 실패는 그대로 throw. `G02-ledger-r2` ②: `prepare`가 throw하는 DB에서 `agentNames`·`recoverableIds`·`pendingDeliveries`·`pendingDeliveryCount`·`pendingWorkRows` 전부 throw |
| 10,000행 초과 완전성 회귀 | PASS | `operational-read-budget.test.ts` ①: shipped DDL+INSERT로 10,001 구독·10,300 운영(10,000 unbatched+300 준비 배치)·10,500 배달 시딩 → 카운트·수령인·rowid 순서·복구 id·`pendingWorkRows`·principal relay 목록·`runner.pending` 집계·배치 상세·링크드 전수 일치; 같은 상태에서 `readDiagnosticSnapshot`은 `LIMIT_EXCEEDED`(음성 대조). ③keyset: 순회 중 삽입분 제외·삭제분 미재방문·다음 순회 재관측 |
| fail→pass 대조 | PASS | 직전 커밋을 별도 worktree에서 tsc로 빌드해 동일 시드(10,001 구독·10,001 배달) 주입 → `allSubscriptions`·`pendingDeliveries`·`recoverableOperations`·`pendingWorkRows` 전부 `LIMIT_EXCEEDED` throw; 수정 후 동일 fixture는 완전 결과 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| 전체 `npm test` | PASS | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,834 tests, 3,834 PASS; systemd-required 9 파일은 환경 부재로 NOT_RUN 분리. 첫 실행의 3건은 정산됨 — P18 경계 스텁을 새 카운트 계약으로 갱신, R38 digest 재결박, SCN-L02는 병렬 부하 타이밍 flake(단독·재실행 모두 PASS) |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice(dependency-graph 재생성 후 PASS)·transactions·boundaries·documents·spec-inventory 0 findings |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 — 결정론 오라클(시드+keyset 시나리오+실패 주입)이 같은 경계를 묶는다 |

## 정산: UX-38 맹검증 잔여 — 변환의 정직성·소유권·도달성 6건 (2026-10-07)

직전 UX-38 커밋(크기·시간 상한의 거절 제거)을 맹검증했을 때, 변환 자체가 새 결함을 만든 6건(F1–F6)을 정산했다. 원칙: 유효한 사용자 작업을 막는 상한은 거절·절단하지 않되 변환은 정확성·정직성·소유권을 보존한다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F1 완전 결과는 모델의 tool이 읽는 경로에 | PASS | 완전 답은 result envelope로 pipe를 건너 부모가 직렬화 contained writer로 `<workspace>/.oma/search-results/`에 통째 기록 — quota 판정·직렬화·guard 승인이 다른 workspace 쓰기와 동일. 회귀: 스풀 경로가 `guardWorkspaceTools` 판정에서 read/grep/find/ls 전부 승인, 실제 `ls`·`find`·`read`·`grep` 호출이 도달, `workspaceUsage`가 바이트를 계정, `details.complete={path,bytes}`가 같은 경로를 명시 |
| F1 스풀이 못 받으면 절단 없이 inline | PASS | quota가 스풀을 담지 못할 때 완전 답 전문이 "could not be written to the workspace spool (…)" 사유와 함께 inline 회귀 — 프리뷰로 묵살하지 않음 |
| F2 heartbeat는 liveness이지 진행이 아님 | PASS | 침묵 창은 임의 바이트가, 진행 창은 비-heartbeat 프레임·비프레임 바이트만이 리셋. `{p:"s"}`만 나오는 자식은 `HEARTBEAT_ONLY_WINDOWS`(10)×stall 창 안에 그룹 kill+스냅샷 sweep — wedged main은 유한 경계 안에 회수 |
| F2 성긴 실진행은 경계를 넘어 생존 | PASS | 400ms 간격으로 match를 drip하는 완전-렌더 pass가 3s heartbeat-only 경계를 넘는 4s+ 동안 `{p:"r"}` 프레임으로 진행 리셋 — 답이 완전 도달 |
| F3 외부 kill의 선언 스냅샷 sweep | PASS | 부모가 살아 있는 채 자식만 외부 SIGKILL → `close` 핸들러가 선언된 `oma-search-*`를 무조건 제거 — 잔여 없음 |
| F5 목적지도 보유 디스크립터 체인 | PASS | 목적지 디렉터리를 rename하고 link를 심는 중간 교체 경주에서, 보유 fd가 옮겨진 실 디렉터리에 계속 쓰고 심은 link 너머로는 한 바이트도 도달하지 않음 |
| F4/F6 소유권·정직성 문서 | PASS | 검색 스풀은 workspace 소유자의 보통 파일(OMA 자동 sweep 없음), client 출력 스풀은 caller 소유(caller가 제거할 때까지 보존 — OMA에 GC 없음); `output-spool.ts` 헤더가 정책과 동기 write/fsync의 의도를 명시, heartbeat worker에 명시적 `error` 리스너 |
| fail→pass 대조 | PASS | 컴파일 산출물을 구 동작으로 되돌려 대조 — /tmp 스풀은 "workspace 안이 아님"으로, heartbeat=진행 리셋은 30s 타임아웃으로, close-sweep 제거는 `oma-search-*` 잔여로, 경로 기반 목적지 쓰기는 1,991 파일의 link 넘김으로 실패; 수정 산출물은 전부 PASS |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules(0 findings — `contained-files.ts`의 owned-state 면제가 F5로 stale되어 제거, 규칙이 다시 파일을 지킴)·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| 집중 회귀 | PASS | `node --test dist/test/contained-tools.test.js` 31/31 PASS — 신규 6종(스풀 도달성+quota·quota 거절 inline·heartbeat-only 회수·성긴 진행 생존·외부 SIGKILL sweep·목적지 경주) + 갱신 2종(1.5s heartbeat 자식 생존 코멘트·stall 인자) 포함 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,851 tests, 3,850 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 단독 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 맹검증 2라운드 잔여 — 선언-전-생성·디스크립터 고갈 정직성 2건 (2026-10-07)

직전 UX-38 정산을 다시 맹검증했을 때 남은 결함 2건(F-1·F-2)을 정산했다. F-1은 실제 suite flake(부하 상태에서 `oma-search-*` 잔여)로 관측된 순서 결함이고, F-2는 사유 평탄화 결함이다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F-1 선언-전-생성 "존재 ⇒ 선언됨" | PASS | `withSearchSnapshot`이 `oma-search-<uuid>` 후보를 생성해 `named?.(baseName)`를 `mkdirSync` 전에 호출하고 EEXIST는 새 이름을 다시 선언. 자식 측 `named`는 `writeSync(1, …)`로 프레임 바이트를 파이프에 박는다 — mkdir 시점에 선언이 이미 pipe 안. 선언 실패는 throw로 생성 전 실패 폐쇄. 부모 `close` sweep은 선언된 이름을 그대로 소비 |
| F-1 fail→pass 대조 | PASS | 컴파일 산출물의 `named` 호출을 mkdirSync 뒤로 되돌린 구 동작에서 최초-관측-시점 kill 테스트가 `oma-search-*` 잔여로 3/3 실패; 수정 산출물은 잔여 없음 |
| F-2 EMFILE/ENFILE 명시 거절 | PASS | `withSearchSnapshot` 본문을 `searchSnapshot`으로 내리고 공개 경계에서 module-scope `descriptorRefusal`이 EMFILE/ENFILE → `WorkspaceRefusal("search snapshot ran out of file descriptors")`로 변환 — `readdirSync`·소스 `openSync`·`openDirectoryWithin`·목적지 open 전수 포괄, 다른 에러 의미 불변 |
| F-2 fd 고갈 거절 문구 | PASS | `ulimit -n 96` + 400단계 트리에서 자식이 완료하고 출력이 "file descriptors"를 명시 — 구 산출물에서는 raw EMFILE이 "contained search failed"로 평탄화되어 실패 대조 |
| wire 선언이 fs 효과에 선행 | PASS | 실제 `searchChildBody`를 파이프 위에서 구동해 관측된 스냅샷 디렉터리가 최대 한 번의 drain 안에 `{p:"d"}`로 선언됐음을 검증 — 선언 바이트는 mkdir 전에 파이프에 들어가므로 "존재하는 디렉터리가 영원히 미선언"은 없다(기술 수정: 관측과 선언 사이에 한 번의 폴링-drain 유예를 두는 것이 오라클의 실제 계약이며, 이전 표기 "매 관측 시점에 이미 선언"은 그 유예를 넘어선 주장이었다) |
| EEXIST 재선언 | PASS | 첫 선언명을 호스트가 선점시켜 헬퍼가 두 번째 새 이름으로 착지 — 두 이름 모두 선언됐고 실제 생성된 것은 둘째 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules(0 findings — `state-tree-rules`의 contained-files 면제 문구를 "생성 전에 이름이 선언되는 `oma-search-*` 디렉터리"로 갱신)·lattice·transactions·boundaries·documents·spec-inventory 0 findings; `node:crypto` import로 stale된 `implementation/evidence/dependency-graph.json`은 `npm run evidence:graph`로 재생성 |
| 집중 회귀 | PASS | `node --test dist/test/contained-tools.test.js` 36/36 PASS — 신규 5종(선언-전-생성 계약·EEXIST 재선언·최초관측 SIGKILL sweep·wire 선언-선행·fd 고갈 거절 문구) + 기존 외부 SIGKILL close-sweep 유지 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,856 tests 전부 PASS; 이 절의 최초 실행에서 보인 2건은 정산됨 — fd-고갈 테스트의 `bash -c ulimit` 래퍼가 local lane의 shell 금지(local-test-guard)에 걸려 `prlimit --nofile=96:96` direct argv로 교체(liveness-observation의 기존 패턴과 동일, 단독 재실행 PASS), 다른 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로 이 트리의 digest로 재결박. systemd-required 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 잔여 — bundled pi-lsp 표면의 숫자 상한·고정 마감 변환 (2026-10-07)

같은 결함류(유효한 처리를 크기/시간만으로 거절·묵살하는 숫자 bound)가 code_intel LSP 표면에 남아 있어 정산했다. 원칙은 UX-38 본편과 같다 — bound를 제거하거나 비차단으로 바꾸고, 엔진 보호상 남는 bound는 정직하게 보이며 한 서버의 초과가 프로세스나 다른 요청을 죽이지 않는다.

| 절차 | 결과 | 근거 |
|---|---|---|
| 어댑터 bound 제거 | PASS | `lsp-tools.ts`: `LSP_FILE_BYTES`(1MiB)·`LSP_MAX_FILES`(100)·`LSP_MAX_PATHS`(64)·`LSP_MAX_SERVERS`(64) 거절 상수 삭제 — `liveFiles`는 비regular/소실 파일만 걸러 크기는 didOpen이 그대로 운반, caller `limit`는 그대로 존중하고 미지정이면 수집 전체가 답(`details.summary.files`에 수 명시), status는 configured catalog 전수 보고 |
| timeout 상한 제거 | PASS | `clampTimeout`이 1s floor만 적용 — 120s 상한 제거. caller 선택 <120s의 정확한 효력과 floor는 회귀로 묶음; >120s 관측은 시간상 NOT_RUN(코드에서 입증) |
| aggregate deadline → 진행-리셋 stall | PASS | 호출당 `LSP_CALL_STALL_MS` 창이 vendored client의 `omaOnInboundFrame` 싱크가 이 호출 소유 hardened adapter를 보고할 때만 리셋 — `slow-stages` fixture(요청당 ~600ms × initialize+didOpen+diagnostics ≈1.9s)가 1200ms 창을 넘어 완료; 침묵 서버는 ~1s 안에 회수. 창은 호출의 per-request timeout보다 좁아지지 않음 — stall은 비-요청 침묵의 backstop이라는 설계 사실을 테스트 명칭·주석에 명시 |
| oversized inbound frame | PASS | 헤더 파싱 시점에 그 프레임이 답하는 요청만 거절(sniffed id가 실제 pending과 매치될 때만 — F-3에서 유일-pending fallback 제거, 미식별 프레임은 drop+카운트만), 본문은 `#discardRemaining` bounded discard로 버린 뒤 wire가 프레임 끝에서 재정렬 — `oversized-then-serve`에서 같은 client의 후속 요청이 정상 응답, 서버 생존. 미완성 본문도 빠른 종료. 프레임 경계 없는 garbage 누적은 버퍼 비움+pending 거절, 미식별 프레임은 drop 카운터가 에러 꼬리 `oma bounds:`로 명시. discard 중 shutdown은 handshake 생략하고 close |
| 진단 절단 정직성 | PASS | `omaFlaggedDiagnostics`가 push store·pull 경로 공용 — 첫 bound까지 유지+`[oma: N more diagnostic(s)…]` marker(`code:"oma/truncation"`), 메시지는 원본 길이 명시 절단. 재flag 멱등(꼬리 marker 재카운트 안 함·`OMA_MESSAGE_TRUNCATION_TAIL`이 재절단 방지) — push 홍수가 pull 소비에서 drop 수를 거짓 보고하지 않고, OMA marker는 codeAction context에서 서버로 가지 않음. tracked-URI 초과는 publication drop+count가 해소 리스트 marker로 명시 |
| code-action·workspace-edit | PASS | action 목록의 256 상한 제거 — 300개 fixture 전수 resolve(각 요청은 per-request timeout과 stall 창이 묶음). workspace-edit 누적 count/bytes 거절은 유지 — 절단 edit은 오염 fix·무제한 materialization은 엔진 OOM이라 둘 다 거절보다 나쁘며, 거절은 그 요청만 |
| 파일 수집 | PASS | `collectPath` 재귀+깊이 bound → 명시 스택(역순 push로 재귀의 depth-first 순서 보존) — 깊은 트리 통째 수집·overflow 없음 |
| B2 rider | PASS | `contained-files.ts` `errnoCode` 가드(비객체 throw의 `.code` 읽기 TypeError 경로 차단)+공개 `isDescriptorOverrun`; `contained-search.ts`가 스냅샷 경계·엔진 walker 양쪽의 EMFILE/ENFILE을 같은 "search snapshot ran out of file descriptors"로 매핑; EEXIST 테스트의 cleanup 등록을 await보다 전으로; 선언명 선점-EEXIST-자식 사망 모서리는 헤더 주석으로 기록 |
| vendor bundle | PASS | `node scripts/vendor-pi-lsp.mjs` → `BUNDLE_CURRENT`; upstream/ byte-exact 유지, divergence anchor 전부 exact-once, manifest `generated.divergences` 동기, 번들 sha256 `82a5999ac583aca062cbaca28af04e7b2340d83a83cf8aac6940e1c715d942fa` |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules(0 findings)·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| review ledger | PASS | 변경된 7개 production 파일의 byte-bound 리뷰 클레임을 재판독 후 새 바이트에 재결박(묵은 갱신 아닌 fresh read 동반, notes `about`에 명시), `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14062·NOT_REVIEWED 61·READ_UNCHANGED 51·REMOVED 8, `review-closure` findings 없음 |
| 집중 회귀 | PASS | `node --test dist/test/lsp-bundle.test.js dist/test/lsp-upstream.test.js` 61/61 PASS — fail→pass 신규: oversized-then-serve·미완성 oversized·push/pull 진단 홍수+초대형 메시지 marker 절단·URI drop marker·300 code-action·slow-stages 진행 리셋·침묵 회수·1.2MiB 파일·80 paths·121 파일 무제한 수집·71 server status·marker 비재전송·이중flag 방지; `dist/test/contained-tools.test.js` 36/36 PASS |
| 전체 `npm test` | PASS | `OMA_TEST_CONCURRENCY=1 npm test` 로컬 lane — build + 397 files serial 실행: serial phase 9/9 PASS, parallel phase 3,864/3,864 PASS·0 fail·0 cancelled·0 skipped(duration 1,639,995ms), runner unrun-check 통과. 직전 실행은 이 절·산출물 변경분이 반영되지 않은 stale digest로 R38 1건만 실패했고, 이 트리의 digest로 재결박 뒤의 이 실행은 R38 포함 전부 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

정직 기록: 이 절의 wire-선언-선행 행은 직전 절의 표기를 수정했다 — 오라클의 실제 계약은 "관측된 디렉터리가 최대 한 번의 drain 안에 선언됨"이며 "매 관측 시점에 이미 선언"은 그 유예를 넘어선 주장이었다.

## 정산: UX-38 잔여 2차 — pi-lsp 런타임의 비차단·정직성 정산 F-4·F-5·F-1·F-2·F-3·F-6 (2026-10-07)

직전 pi-lsp 정산의 맹검증 잔여 — bound가 남아 있되 그 행위가 무성하거나 잘못 귀속된 6건을 정산했다. 전부 `scripts/vendor-pi-lsp.mjs`의 `OMA_DIVERGENCES` 스플라이스로만 `runtime/`을 재생성했고 upstream/ byte-pin은 유지된다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F-4 didOpen backpressure | PASS | `didOpen`→`notify`→`#send`가 `stdin.write()` 반환을 전파하고 runner open 루프가 `false`면 `didDrain()` await — 코퍼스가 서버 읽기보다 빠를 때 자식쪽 메모리에 통째로 쌓이지 않음. `didDrain()`은 drain resolve·stdin error/close reject·`#timeoutMs` 타임아웃·리스너/타이머 settle-정리. `lsp-upstream` 443·469·484·499행 4종: backpressured write 보고+drain settle·slow reader(`slow-drain`) 완주·`stdin-stall` bounded 실패·mid-drain abort가 abort로 보고 |
| F-5 per-file settled | PASS | `runDiagnostics` 팬아웃 `Promise.all`→`Promise.allSettled` — 개별 실패는 그 파일의 `oma/error` marker("diagnostics failed for this file: …")로 강등, 답한 파일은 보존, 전체 거절은 caller abort뿐. 어댑터도 route별 실패를 그 route 절의 명명된 오류로 강등+`details.summary.failedRoutes` 명시, 전 route 실패 시에만 거절 유지. `partial-answers` fixture+lsp-upstream 511·lsp-bundle 834·853·882행 4종 |
| F-1 marker 회계 | PASS | `omaFlaggedDiagnostics`가 꼬리의 모든 `oma/` marker를 벗겨 실진단 수를 셈 — [truncation, URI-drop] 이중 marker 리스트 재flag 시 첫 marker를 실진단으로 새고 진짜 marker를 자르던 버그 제거, 갱신 절단은 기존 marker를 꼬리에 보존. `push-flood-uri-flood` fixture+lsp-upstream 566행 |
| F-2 URI-drop 가시성 | PASS | `#withDroppedUriFlag`를 pull diagnostics early return에도 적용, publish waiter timeout 에러가 `#formatDropped` 꼬리로 drop 수 명시. `pull-uri-flood`·`uri-flood-timeout` fixture+lsp-upstream 587·602행 |
| F-3 oversized 귀속 | PASS | id 스니핑 실패 시 유일 pending에 귀속하던 fallback 제거 — sniffed id가 실제 pending과 매치될 때만 그 요청 거절, 불일치는 drop+카운트(타임아웃 에러 꼬리에 보고). `oversized-notification` fixture+lsp-upstream 537행 |
| F-6 문서 정직성 | PASS | 직전 절이 주장하던 "OMA marker는 codeAction context에서 서버로 가지 않음" 회귀를 실제 테스트로 추가 — `marker-context` fixture가 context 진단 수를 codeAction resolve 편집으로 되돌려 marker 필터링을 증명(lsp-upstream 616행). 이중 marker 재flag도 위 F-1 오라클로 커버 |
| vendor bundle | PASS | `node scripts/vendor-pi-lsp.mjs --check` → `BUNDLE_CURRENT` (48 files), manifest `generated.divergences` 동기, 번들 sha256 `59a572cb4c0226c3e073bb9d9ee3254977cf3ec78c1adf809103c2263fe4227a` |
| 집중 회귀 | PASS | `node --test dist/test/lsp-upstream.test.js` 30/30·`dist/test/lsp-bundle.test.js` 전종 PASS — 신규 오라클 17종 중 14종은 구 런타임/구 어댑터에서 실패 확인 후 통과; 나머지 3종(marker-context 등)은 구 동작이 없어 대조 불가한 회귀 가드 |
| 전체 `npm test` | PASS | `OMA_TEST_CONCURRENCY=1 npm test` 로컬 lane — build + 397 files serial 실행: serial 2/2·parallel 3,881/3,881 PASS·0 fail·0 cancelled·0 skipped(duration 1,599,229ms); R38 digest 결박 테스트 포함 전종. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| review ledger | PASS | 변경 5개 production 파일(lsp-tools.ts·runtime/lsp-client.js·lsp-client.d.ts·runner.js·manifest.json)의 byte-bound 리뷰를 fresh read 후 새 SHA-256에 재결박, `npm run review:ledger` — CHANGED_WITH_ORACLE 14062·NOT_REVIEWED 61·READ_UNCHANGED 51·REMOVED 8 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 잔여 bound 전수 조사 + 남은 자의적 거절 제거 (2026-10-12)

배치 1–5가 변환한 뒤 남은 숫자 bound를 전수 조사·분류하고, 스윕에서 발견한 잔여 사용자-facing 자의적 거절을 제거했다. 결과 장부는 [limit-bounds.md](../limit-bounds.md) — §1 PROTOCOL/WIRE-MANDATED 29·§2 FORMAT-MANDATED 13·§3 SECURITY/INTEGRITY 11·§4 RESOURCE-PROTECTION(의도적 유지) 26·§5 QUIESCENT/JITTER 25·§6 TEST-ONLY 1, 총 105행. §4는 방어적이지만 자의적인 값을 정직하게 그렇게 분류하고, §7은 수치 기반 사용자-facing 거절 26종을 하나씩 판정한다 — wire 계약·포맷·무결성·의도적 자원 보호가 필요한 것만 남았고, 그 외의 용량/시간 거절은 남지 않았다.

| 절차 | 결과 | 근거 |
|---|---|---|
| merge-diff 뷰 bound 정렬 | PASS | `src/cli/effects/code.ts` — production merge-diff의 캡처 bound를 고정 768 KiB에서 `bundleBytes()+1`로 교체. 이전 값은 wire가 선언한 완료-notice 문서 bound(기본 256 MiB)보다 좁은 자의적 거절이었고 `commands/merge.ts`의 오류 문구(`cliBundleBytes()` 명명)와 불일치했다. `+1`은 "정확히 수용"과 "1바이트 초과"를 구별한다. revision 해석(ref/published/ancestry 관측)의 출력 bound도 고유 768 KiB에서 `CANONICAL_PROCESS_LIMITS.maxBuffer`(4 MiB)로 정렬 — broker의 canonical observer와 같은 명령 같은 bound. 고정 MAXIMUM(768 KiB)은 production이 도달하지 않는 show/diff/log/ls-tree/grep 뷰만 묶는 TEST-ONLY bound로 주석과 함께 남았다 |
| workspaceDirty 불리언 관측 | PASS | `src/cli/effects.ts` — `git status --porcelain`을 더는 텍스트 maxBuffer로 읽지 않고 직접 관측한다: 캡처된 stdout이 1바이트라도 있으면 dirty(절단된 목록도 증거), 성공적으로 빈 목록만 clean. 이전에는 256 KiB를 넘는 정직한 dirty 워크스페이스가 `merge open`에서 LIMIT_EXCEEDED로 죽을 수 있었다. timed-out/stalled/spawn-failed는 `requireTextExit`가 계속 던진다 — 실패를 clean으로 읽지 않는다 |
| ReadScope 주석 교정 | PASS | `packages/storage/src/ledger-reader.ts` — "fresh read/snapshot" 인상을 주던 주석을 정확한 기술로 교체: memoized 항목은 그 컬렉션 안에서 키로 처음 읽은 row bytes의 디코딩이며 DB 스냅샷이 아니고, 컬렉션 도중 다른 writer가 바꾼 row는 재관측되지 않는다(새 바이트가 필요하면 새 scope). 동작 변경 없음 |
| 문서 정밀 수정 | PASS | LSP 오라클 서술을 "17 fail-before"에서 "14 fail-before + 3 회귀 가드(구 동작 부재로 대조 불가)"로 이 파일과 WORKSTREAM 양쪽 정정; WORKSTREAM의 B1 fixture 문구를 102 `.test.mjs` + 보조 2종(`isolate-env.mjs` 프리로드·`pdf-fixture.mjs` 헬퍼, fixture는 후자 하나)으로 정밀화 |
| 잔여 거절 판정 | PASS | limit-bounds §7의 26종 전부가 wire/format/integrity/의도적 자원 보호/jitter 중 하나로 귀결 — 스윕에서 변환 가능한데 남은 거절은 셋이었고 전부 제거(merge-diff 뷰 bound·workspaceDirty porcelain 캡·code view published-ref 캡 비대칭). 대표 잔여: merge-diff>bundleBytes(PROTOCOL), 로컬 파일>1요청 프레임(PROTOCOL, 대체 채널 없음), LSP workspace-edit 2048/4 MiB(INTEGRITY — 절단 fix=오염), human prompt 16 KiB+frame(PROTOCOL+RESOURCE), 설정/패키지 문서 bound(RESOURCE, 방어적·자의적으로 명시), 진단 스냅샷(RESOURCE, 운영 읽기와 무관) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules 0·lattice(dependency-graph evidence 재생성)·transactions·boundaries·documents·spec-inventory 전부 0 findings |
| review ledger | PASS | `src/cli/effects.ts`·`src/cli/effects/code.ts` 신규 byte-bound 리뷰 + `packages/storage/src/ledger-reader.ts` 재결박(모두 fresh re-read 후 새 sha256), `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14065·NOT_REVIEWED 59·READ_UNCHANGED 50·REMOVED 8 |
| 집중 회귀 | PASS | `node --test dist/test/principal-code-view.test.js dist/test/merge-cli.test.js dist/test/operational-read-budget.test.js` 16/16 · `dist/test/effect-observation.test.js dist/test/git-effect-evidence.test.js dist/test/merge-review.test.js` 38/38 · `dist/test/scenario-merge-review.test.js` 9/9 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 399 files → 3,900 tests, 3,898 PASS; 실패 2건의 정직한 내역: (a) SCN-L02는 8-way 병렬 aggregate에서만 재현되는 기존 타이밍 flake로 해당 파일 단독 재실행 40/40 PASS(이전 절들에도 같은 양상이 기록됨); (b) R38은 이 절과 신규 문서(limit-bounds.md)가 반영되기 전의 stale verification-input digest로, 이 트리의 digest로 재결박 후 `production-inventory` 재실행 확인. 한 차례 이전 실행은 정산 중 dist 재생성이 suite와 경주한 환경 간섭으로 wedge됐고(SCN-C09/C10·R04–R07·S01·society-bringup), 관련 파일 4종 단독 재실행 96/96 PASS 후의 실행이 위 결과다. systemd-required 9 파일은 test-local이 `OMA_TEST_SYSTEMD=0` 고정으로 설계상 분리 — "환경 부재"는 stale한 오기였고, 실제 lane 실행 결과는 다음 절에 기록한다 |
| systemd-required 9 파일 (verify-lane kernel·crash) | EXECUTED+PASS | 다음 절의 실기록 — `verify-lane.mjs kernel` 12파일 65/65·`crash` 2파일 63/63, 이 호스트의 실제 user systemd에서 전종 초록 |
| macOS native / powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 bound survey 맹검증 잔여 — workspaceDirty 거절 관측 정직성 + systemd lane 실기록 (2026-10-12)

위 절의 맹검증 잔여 2건을 정산했다. F-1: 위 절은 systemd-required lane을 "환경 부재"로 NOT_RUN 표기했으나 이 호스트에는 user systemd 257.13·bwrap 0.12.0·cgroup v2·user bus가 있고 lane은 실제로 실행된다 — stale한 표기를 실측으로 교체했다. F-2: `workspaceDirty()`가 `git status`의 exited-nonzero + 빈 stdout을 clean으로 읽던 잔여를 고쳤다 — 거절된 관측이 absent로 축소되는 결함류 그 자체이며, 구 코드도 같은 의미였으므로 회귀가 아니라 잔존 결함의 정산이다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F-2 workspaceDirty 거절 관측 | PASS | `src/cli/effects.ts` — 비영 종료는 git이 답을 거절한 것이지 빈 목록이 아니다. stderr의 `not a git repository`/`this operation must be run in a work tree`만 유일한 사실상 부정(관측할 워크스페이스 자체가 없음)으로 남기고, 그 외 거절 — 깨진 index, git이 거절하는 ownership 등 — 은 `StoreError(INTERNAL_ERROR)`로 전파한다. `effects/submit.ts`·`effects/code.ts`·`journalView` 등 주변 관측 경계의 refuse-on-nonzero 관례와 일치하고, 명시 full-OID `merge open`/`challenge open`의 비저장소 cwd 호출(`resolveOid`의 full-OID 단축이 만들어 둔 정상 경로)은 보존된다. timed-out·stalled·output-limited·spawn-failed는 종전대로 `requireTextExit`가 던진다 |
| F-2 fail→pass | PASS | `test/merge-cli.test.ts` 신규 2종 — 손상된 `.git/index`로 거절을 재현한 `merge open`이 exit 3 + `oma: INTERNAL_ERROR: git status: fatal:`로 명시 실패하며 요청을 보내지 않는다(구 dist로 재실행하면 무경고 진행·실패를 확인); 비저장소 cwd의 명시-OID open은 경고 없이 완료되는 회귀 가드. 파일 12/12 PASS |
| F-1 systemd lane 실기록 | PASS | `OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs kernel` → EXECUTED+PASS 65/65(12 파일 — systemd-required 8종 + peer-pid·native-leaf·runner-channel·compliance), `crash` → EXECUTED+PASS 63/63(crash-boundaries·global-invariants) — systemd-required 9파일 전종이 실제 user systemd에서 초록. artifacts=/tmp/oma-lane-kernel·/tmp/oma-lane-crash |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice(dependency-graph evidence 재생성)·transactions·boundaries·documents·spec-inventory 전부 0 findings |
| review ledger | PASS | `src/cli/effects.ts` 항목을 fresh re-read 후 새 sha256으로 재결박, `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14065·NOT_REVIEWED 59·READ_UNCHANGED 50·REMOVED 8 |
| 집중 회귀 | PASS | `node --test dist/test/merge-cli.test.js dist/test/effect-observation.test.js dist/test/git-effect-evidence.test.js dist/test/merge-review.test.js dist/test/scenario-merge-review.test.js dist/test/principal-code-view.test.js dist/test/operational-read-budget.test.js dist/test/client.test.js` 88/88 |
| 전체 `npm test` | PASS | `node scripts/test-local.mjs` 로컬 lane 399 files → 3,902 tests, 3,902 PASS·0 fail·0 cancelled·0 skipped(duration 284,386ms). 이 절 작성 중의 첫 실행은 변경분이 반영되기 전의 stale digest로 R38 1건만 실패했고, 재결박 뒤의 위 실행은 R38 포함 전종 PASS — 단독 재실행 `production-inventory`·`document-integrity`·`traceability-policy` 23/23 확인. systemd-required 9 파일은 test-local이 설계상 분리하며 실제 실행은 위 kernel·crash lane 기록 |
| macOS native / powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 잔여 정산 후속 — workspaceDirty not-a-repo 사실상 부정의 상호확인 (2026-10-12)

직전 정산의 맹검증 LOW 잔여 1건을 정산했다. `workspaceDirty()`는 `git status`의 `not a git repository`/`must be run in a work tree` 거절 문자열을 그대로 사실상 부정으로 믿었다 — 그런데 git은 진짜 부재뿐 아니라 존재하나 손상된 `.git`(깨진 HEAD, chmod 000, 삭제된 objects, 끊어진 심링크, 허공을 가리키는 gitdir 포인터, 마운트 경계 너머의 `.git`)에도 같은 문자열로 128을 낸다. 문자열이 아니라 관측 부재를 상호확인하도록 고쳤다.

| 절차 | 결과 | 근거 |
|---|---|---|
| not-a-repo 상호확인 | PASS | `src/cli/effects.ts` — `workspaceClaimPresent`가 관측 디렉터리와 그 조상을 `.git` 엔트리로 걷는다: 디렉터리·gitdir 포인터 파일·끊어진 심링크 전부 워크스페이스 주장이고, lstat이 못 읽는 단계(EACCES 등)도 주장을 배제할 수 없어 실패-폐쇄한다. ENOENT/ENOTDIR만으로 끝까지 걸었을 때만 부재가 확정돼 false. `.git`이 있으면 거절은 존재하는 워크스페이스에 대한 것이므로 `StoreError(INTERNAL_ERROR)` + git stderr로 전파 — corrupt index 등 기존 전파 경로와 같은 판정 |
| 대면 검증 (컴파일된 모듈 직접 호출) | PASS | 9종 — 깨진 `.git/HEAD`·댕글링 `.git` 심링크·`.git` 파일 gitdir 포인터·실제 repo의 `.git` 내부 cwd·`core.bare=true` 오설정 → 전부 INTERNAL_ERROR 전파; bare repo cwd·진짜 비저장소 → false; clean repo false·dirty repo true 유지 |
| bare repo 판정 | PASS | `.git` 부재 + work-tree 거절은 git이 저장소를 읽고 bare임을 확인한 완전한 관측 — bare repo에는 uncommitted work가 있을 곳이 없어 vacuous 부정(false). `.git` 존재 시 같은 거절은 미관측 작업을 숨길 수 있어 전파한다. "거절이면 무조건 전파" 대안보다, 거절이 관측 디렉터리의 미커밋 작업을 숨기는지를 기준으로 선택 |
| fail→pass | PASS | `test/merge-cli.test.ts` 신규 2종 — 손상 `.git/HEAD`로 not-a-repo를 재현한 명시-OID `merge open`: HEAD dist에서는 거절이 clean으로 읽혀 transport까지 진행해 exit 3 불일치로 실패, 수정 dist에서는 exit 3 + `git status: fatal: not a git repository` + 요청 0건으로 명시 실패. bare repo cwd 명시-OID open은 경고 없이 완료 — vacuous 부정 결정 고정. 기존 비저장소 명시-OID 가드(KN)도 유지 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice(dependency-graph evidence 재생성)·transactions·boundaries·documents·spec-inventory 전부 0 findings |
| review ledger | PASS | `src/cli/effects.ts` 항목을 fresh re-read 후 새 sha256으로 재결박, `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14065·NOT_REVIEWED 59·READ_UNCHANGED 50·REMOVED 8 |
| 집중 회귀 | PASS | `node --test dist/test/merge-cli.test.js` 14/14 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 399 files → 3,904 tests, 3,903 PASS·0 cancelled·0 skipped(duration 284,892ms). 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 단독 재실행 PASS 확인. systemd-required 9 파일은 test-local이 `OMA_TEST_SYSTEMD=0`으로 설계상 분리 |
| macOS native / powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |


## DR35: 시작 시간 실행 측정과 수정 (2026-10-08)

사용자가 문서와 실제 실행 측정을 먼저 요구했다. 서브에이전트 없이 기준 HEAD
`0364e99c`의 clean worktree에서 시작했고, 현재 변경은 미커밋이다. 이 절은 시작 경로와
같은 부류의 코드 병목을 수정한 범위의 증거이며 기존 전수 감사나 release의 완료를 뜻하지 않는다.

| 관측 | 실제 결과 | 범위 |
|---|---|---|
| 수정 전 실제 Society 시작 | 최초 출력/실패 146.673초; CPU profiler의 spawnSync 구간 누적 136.459초(호출 벽시계; child CPU 사용량 아님) | raw PTY `/tmp/oma-startup-nhj_86s8`; source snapshot 중 directory 변경을 감지해 exit 3. 정상 시작 성공으로 세지 않음 |
| 동기 Git 원인 확인 | 15,519 선택 파일; trace 중 8,688개의 `hash-object` child | `/tmp/oma-startup-xtxy7bj1`, strace 자체가 시간을 늘리므로 200초 trace 값을 일반 시작 수치로 쓰지 않음 |
| batch Git 적용 뒤 정상 시작 | 대화창 36.49초 | `/tmp/oma-startup-2tmyjkt3`, 원본 보존·authority gate 유지 |
| 대화 실제 입력→모델 요청 | Society 3.131/3.146/3.130초; Personal 1.490/1.481/1.434초 | 독립 HOME/data 3회씩, 실제 OMA+Pi+OpenTUI+PTY, 모델만 로컬 scripted provider. setup 시간은 launch 전에 끝내며 child spawn부터 Node monotonic clock으로 측정 |
| 화면 입력 준비 | Society 2.879~2.893초; Personal 1.213~1.235초 | 같은 3회 측정, 렌더링만으로 모델 입력 준비를 추정하지 않고 이어서 실제 모델 요청을 확인 |
| 첫 모델 응답 | Society 3.153~3.171초; Personal 1.495~1.532초 | 모델 서버 응답은 시험용이므로 실제 유료 provider 속도를 증명하지 않음 |
| 준비 중 종료 | 0.11~0.15초, 모든 회차 exit 0 | Ctrl-D → 실제 host exit, preparation 취소와 자식 회수 포함 |
| Society 전체 준비 | admin socket 연결 30.121초, 이후 종료 0.727초 | `/tmp/oma-startup-benchmark-rq0iokw1`; 단순 UI marker가 아닌 실제 broker endpoint 관측. 첫 모델 요청 3.139초와 구별 |
| 실제 준비 완료 뒤 권한 연결 | PASS, 첫 모델 요청 3.171초 → admin socket 30.010초 → Principal 도구 30.835초 | `/tmp/oma-startup-benchmark-wq3mkkpe`. 실제 모델→`oma_society`→client→broker 흐름으로 시험 Society를 닫음. 종료 뒤 read-only SQLite에서 같은 actor/request key의 `society.set`이 정확히 1행·succeeded인 것을 확인. 준비 중 private engine이 준비 완료 뒤 실제 grant를 받아 쓰는 경로를 UI 문구로 추정하지 않음 |
| 추가 Git 압축 실험 | 기존 fetch 6.455초, pack window/depth/compression 0은 6.406초, bytes 동일 | 복제된 측정용 bare repository만 사용. 유의한 개선이 없어 생산 코드에 적용하지 않음 |
| 공통 runtime import | 0.718초 → 0.029초 | interactive setter의 SDK 의존을 엔진 presentation owner로 옮김. 호스트 import 금지 회귀와 기존 설정 의미론 유지 |
| build / typecheck / package / architecture | PASS | 최종 빌드·타입 검사, package closure, inventory/rules/lattice/transactions/boundaries/documents/spec inventory |
| SDK 분리·설정·엔진 소유권 집중 회귀 | PASS 130/130 | 원래 Pi manager·locked writer, 경계 손상/권한/byte 보존, Linux/Darwin platform-injected 설정, host SDK import 금지. Native Darwin PASS로 확대하지 않음 |
| 시작·취소·history·scratch 집중 회귀 | PASS 7/7 | 실제 inherited lease + native descendant cancellation, raw project 준비, 원래 Pi installer 보존, Personal history inode lifetime, 병렬 scratch 격리 |
| 전체 local suite | PASS 3,919/3,919 (serial 9 + parallel 3,910), fail/cancel/skip 0 | 첫 실행은 9+3,909 tests, 병렬 23 실패. 16건은 이 shell의 `oma` PATH 부재, 2건은 새 preload를 빼먹은 fake install, 1건은 다른 test의 `/tmp` scratch를 비교한 race, 나머지는 architecture/ledger/validation 산출물 미결박. 원인별 수정 후 전체 PASS, SDK 분리 뒤 전체 재실행도 PASS. 최종 parallel 240,892ms + serial 78,574ms; 로그 `/tmp/oma-final-full-suite.log`. systemd-required 9 파일은 test-local 설계상 NOT_RUN 분리 |
| native macOS / real provider / powercut / release qualification | NOT_RUN | Linux 시작·로컬 시험 모델 증거를 해당 레인의 PASS로 확대하지 않음 |

**대화 시작의 5초 한도는 충족했고 1초 목표는 미달이다. Society authority·Worker 준비 전체가
5초 안에 완료됐다고 주장하지 않는다.** 준비 중에는 그 사실을 화면에 표시하며, credential과
mail delivery는 broker 준비·registration 뒤에만 허용한다. 원본 index/refs/filters·상속 lease·
child 실제 종료·rootfs quiescence와 모든 설치 바이트 검증은 유지했다.

대화 6회·broker 준비 1회 측정, 별도 실제 권한 연결 1회와 생산 변경의 SHA-256은 [startup evidence](../../test/audit/startup-2026-10-08.evidence.json)에 고정했다.
재현은 [benchmark](../../scripts/benchmark-startup.py), 결정은 [DR35](../design-revisions.md),
사용자 상태는 UX-39가 소유한다. raw logs는 `/tmp/oma-startup-final-{society,personal,broker}.log`,
최종 검사 로그는 `/tmp/oma-final-{build,typecheck,architecture,startup-tests}.log`이다.

## 현재 알려진 한계와 남은 검증

- 실제 manager/cgroup candidate 검사와 reviewer shortage 예외는 기존 독립 거절의 영향을 받는다. fixture 성공을 실제 서비스 증거로 사용하지 않는다.
- native Mac VZ·Keychain·APFS·Swift build와 실제 host↔guest lifecycle 증거는 이 Linux 환경에서 NOT_RUN이다.
- 이전 systemd/VM ownership/isolated-HOME probe 거절과 aggregate suite 금지는 [HANDOFF](../HANDOFF.md)에 유지한다. 문서 이동은 실행 허가가 아니다.
- F1의 bound project 첫 관측에는 이미 실행 중인 app/guest를 요구했던 한계가 남아 있다.
- F2의 Linux file/socket/PTY 및 controlled ownership 회귀는 remote/native 실행 증거의 대체가 아니다.
- kernel·crash systemd lane은 이 호스트의 user systemd에서 EXECUTED+PASS로 기록됐다(위 정산 절). powercut lane과 native 환경 lane은 이 작업에서 실행하지 않으며, release 판정은 필요한 환경과 전체 검증이 갖춰진 뒤 별도로 갱신한다.
- optional verifier·notmuch·reflink·비용 상한·성능 우위는 구현과 실험 증거 없이 활성 기능으로 표시하지 않는다. 현재 unsupported 정책과 후속 구현의 구분은 해당 contract/DR을 따른다.

## 검증 입력과 측정 artifact

아래 binding은 구조 검사의 입력 identity다. digest 생성 자체가 runtime PASS를 뜻하지 않는다.

과거 구조 입력 sha256 `273e7a8b329b1178f3068066e59c0e6d96e03cfa9878578a9091e8f022c471bf` (15355 files)..

당시 기록한 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 기존 artifact와의 불일치를 여기서 수리했다고 주장하지 않는다. 크기 제한은 없으며 값은 release proof가 아니다.

K63: 현재 source list는 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. 기존 digest 파일명은 최소 변경을 위해 유지하지만 내용은 `oma-production-source-digests-v1`이며 LOC/tool/report digest를 포함하지 않는다. `node scripts/loc.mjs --source-digests`로 명시적으로 갱신하고 `npm run check:inventory`는 cloc 없이 source bytes를 검증한다. `--inventory-only`는 계속 목록만 갱신한다.

현재 LOC는 `node scripts/loc.mjs --out <evidence-directory>`가 cloc 2.08로 생성·재검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`에만 있다. 생성기는 committed source digest를 먼저 검증하며 이를 재작성하지 않는다. CI는 검증한 commit 아래 report·report digest·source digest·tool version을 함께 업로드한다. committed LOC claim과 측정치의 결박은 더 이상 제공하지 않으며, source digest 결박은 유지한다. 아래 구조 입력 identity는 DR34(UX-08 CONNECT egress) 2차 맹검증 변경분(paused-socket 수명주기·Teredo 거절·rest 의미)과 BL1(bundled extension #1 pi-lsp — vendor 페이로드·verifyVendorBundle·lsp-tools 어댑터·tool-surface 플랜·workspace-guard 확장), BL2(bundled extension #2 ask_user_question — OMA 네이티브 구현: client contract/model/envelope/protocol, extension 등록, TUI presenter/component, role surface·deployment·두 host 경계 결선), BL3(bundled extension #3 pi-hashline-edit-pro — vendor 페이로드+의존 closure·commit/read seam divergence·hashline-tools 어댑터·file_edit surface·contained writer identity seam), BL4(bundled extension #4 pi-web-access — vendor 페이로드+의존 closure·OMA 정책/egress divergence·web-tools 어댑터·web_research surface·deployment-manifest 엔트리 bound 상향), BL5(bundled extension #5 pi-mcp-adapter — vendor 페이로드+42패키지 의존 closure·27파일 OMA 정책 divergence·mcp-tools 어댑터·공유 child-env 추출·`mcp` DIRECT surface), BL5 맹검증 정산(F1 SDK child-env underlay tombstone·F2 UI-session deny-by-default permit과 direct/proxy/ui-session/glimpse-ui 거절 게이트·F3 ENOENT-only 부재 판정·F4 command basename 정규화 거절·F5 dead `omaStateDir` 제거·F6 tautological assert 교체·`pi.events` runtime-register posture 기록·runtime/manifest 재생성·`mcp-bundle.test.ts` 18종), BL5 정산 후속(SDK underlay 이름의 disposition을 검증된 번들 바이트에서 파싱해 결박하는 drift oracle·win32 trailing-dot/shim fixpoint command admission), LOC 재생성 고정(cloc --ignored 판정을 report의 nonCode 블록에 접는 비코드 분류·clocCoverage 공유 계정 규칙 — vendored LICENSE/NOTICE/.map/dotfile/빈 파일/바이너리 1,620개를 명시 분류, 미계정·미인정 verdict는 여전히 실패), post-listen 'error' 전수 스캔 정산(6곳 listen 경계의 영구 'error' 리스너 + 보호된 best-effort journal, `egress-forwarder`의 `onError` 심과 oma-society `notice` 연결, `rpc.ts` FrameParser 생성자의 'data' emit 내부화, `egress-bridge` stderr.write 가드, cloc 계정의 `Object.hasOwn` own-key 조회와 `temporary editor file` verdict 인정·LOC-004 문구 동기화), post-listen 스캔 맹검증 잔여 정산(vendored pi-mcp-adapter `ui-server` host/proxy·`mcp-callback-server` listen 경계의 OMA_DIVERGENCES 영구 리스너와 runtime·manifest 재생성, broker `cleanupError` 보호된 저널, cloc `rowAt` 구조 키 배제, inference-bridge 'listening' 재등록 가드, inference-relay request/upgrade emit 경계), UX-37 운영 읽기의 진단 예산 분리(`LedgerReader.all`의 per-row 과금 제거·`pendingDeliveryRows` keyset 스트림·`pendingDeliveryCount` SQL 집계·dispatcher 카운트 바인딩·`G02-ledger-r2` 회귀 3종), UX-38 툴 표면 상한·마감 변환(client 출력 digest spool·영수증 청크 진행-리셋 관측·mail 저장/인덱스 bound 분리·수신자 64·contained-search 프레임 관측+완전 재렌더+결과 스풀·contained-files 깊이 거절 제거·`durable-boundaries` `#spoolOutput` 등록)와 그 맹검증 잔여 정산 F1–F6(완전 결과를 직렬화 contained writer로 workspace `.oma/search-results/`에 기록+guard 도달·침묵/진행 이중 창+heartbeat-only 경계·`close` 무조건 스냅샷 sweep·스풀 소유권 명시·목적지 보유-fd 체인+EMFILE 명시 거절·worker `error` 리스너·`contained-files.ts` owned-state 면제 stale 제거), UX-38 맹검증 2라운드 잔여 정산(F-1 contained-search 선언-전-생성 — `withSearchSnapshot`이 `oma-search-<uuid>`를 생성해 `named`를 mkdirSync 전에 호출·EEXIST 새 이름 재선언·자식 측 동기 writeSync(1)로 "존재 ⇒ 선언됨" 성립, F-2 withSearchSnapshot 경계의 EMFILE/ENFILE → "search snapshot ran out of file descriptors" 명시 거절·state-tree-rules 면제 문구 갱신·contained-tools 회귀 5종), UX-38 잔여 3차 — 네트워크/프로세스 표면의 용량 거절·고정 마감 변환(connect-proxy·inference-relay·host/guest egress·egress-forwarder의 용량→FIFO 작업 집합, readLeadingFrame/oneFrame·프로세스 silenceMs의 진행-리셋 침묵 창과 `stalled` 분류, stdout/stderrSpool 통째 보존과 git/mkfs/패키스 스풀 결선, 회귀: r37-async-process 6종·egress-connect 큐잉·inference-relay 큐잉/철회·platform-egress 작업 집합·session-process-owner node:fs 스텁), UX-38 batch 5 — durable-capacity 변환(quarantine 진행-리셋 침묵 검출+heartbeat·per-executor sticky 정산, gitlink/merge-tree 출력 스풀+점증 파싱과 GITLINKS_OBSERVATION_BYTES 폐기, workspace Git clone/fetch/checkout·canonical fsck의 PreparationExecutor 진행-리셋 전환, 설정 소스 4096 파일/64 MiB·문서 16 MiB 재명명, 패키지 아카이브 스트리밍+8M working-set 한도, 브로커 over-quota degraded 기동+StorageAdmission.startupState, 프로세스 계보 깊이 제한→Set 사이클 검출, OMA_WORKSPACE_BYTES 결선 검증+PR-004/T68d/D04/descent 오라클, runWorkspaceGit 제거, state-tree/owned-state 규칙 면제·held-parent 정산과 durable-boundaries collection 등록 2건) 변경분의 로컬 검증을 위해 다시 결박한 것이고, 이전 runtime PASS를 새 source의 PASS로 승격하지 않는다.

## 재검증

명령은 [package.json](../../package.json), 검증 요구는 verification-spec이 소유한다.

```sh
npm run check:documents
npm run check:inventory
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs
```

바뀐 검사·owner 경로의 관련 회귀를 이어 실행한다. 환경이 필요한 suite는 허용 환경과 기존 거절을 먼저 확인한다. 새 durable 경계에는 의미 있는 negative control과 kill·retry·restart oracle를 연결하고 결과를 여기에 기록한다. 전체 suite 수를 위해 실행 금지를 우회하지 않는다.

DR46 extension 최종 정적 결박: `architecture-extension-current.log`의 전체 gate가 PASS다.
production 14,254개, 모든 gate 위반0이며 strongest boundary 주입55/11/23은 유지한다.
입력 15,526개 `eb5eb3a0c0c89ac71e2f5b2a162137bd2b11e24b28163c21a0c8c7e505cbed5f`,
runtimeProof false. `extension-transfer-result.json`: APPLIED139, conflicts0, 빈 디렉터리1개 정리.
이전 working-tree 원본은 외부 `extension-root-before.tar.gz`에 먼저 보관했다. root15의 새 build와
전체 local은 별도 실행하며 위의 독립 checkout 결과를 root 전체 PASS로 승격하지 않는다.

DR46 Mail 최종 source 반영: `mail-transfer-result.json`은 APPLIED210, conflicts0이며 빈
디렉터리1개를 정리했다. root의 변경 전 working-tree bytes는 `mail-root-before.tar.gz`에
먼저 보관했다. `authored-js-syntax-final.log`는213개 모두 parse PASS이며 provider 실행은 아니다.
반영 직전 `architecture-mail-transfer.log` 전체 gate도 PASS다. root16의 새 build·binding·
전체 local은 별도로 실행하며 위 stage 결과를 root 전체 PASS로 승격하지 않는다.


Lifecycle source의 actual root 전환은 `lifecycle-transfer-result.json` APPLIED101 files,
conflicts0이다. Root19의 새 build/정적 gate/전체 local 원본은 `build-nineteen-root.log`,
`architecture-nineteen-root.log`, `nineteen-local-full.log`, `nineteen-local-status.json`이다.
과거 raw FAIL이나 stage227/19 PASS를 root 전체 PASS로 재해석하지 않는다.


Root19 전체 local 원본 `nineteen-local-full.log`는 serial9 PASS와 parallel4065 PASS/3 FAIL,
합계4074 PASS/3 FAIL이다. skip/cancel/todo0, input15569개
`3f0746a2eb920c024f341dc2ffbc5da1387883b41e5e797255eaa5cf1b247838`, changed[]였다.
3 FAIL은 coordinator-facets MJS의 RegistryOperations 생성3곳이 새 ledger/ID port 없이
구체 Store를 전달한 실제 미전환 호출부다. assertion이나 입력·판정은 줄이지 않고 실제
lifecycleLedger와 Native ID owner를 연결했다(`nineteen-facets-fixture-repair.json`).
재실행 `nineteen-facets-final.log`는4/4 PASS, skip/cancel/todo0이며 input15569개
`98cff831dbd2b62b94872ff96e71eb05c3bc72292bec9683c03898b758d9faa4`, changed[]다.
검증 binding은 normalized narrative를 바꾸지 않고 고쳤고 후속 source transfer의
expected root hash도 두 파일만 기록했다. 과거 전체 FAIL을 전체 PASS로 승격하지 않는다.

Reconcile 단계는 독립 checkout20개 workspace에서 작업 중이다. 실제 read-only 복구 port,
Git health/Storage collection owner와4개 공개 API·설치 runtime 검사 입력을 추가했다.
현재 source의 결과는 `build-reconcile-final.log`, `architecture-reconcile-first.log`,
`reconcile-focused.log`, `isolation-reconcile.log`, `typecheck-reconcile-final.log` 원본만이
소유한다. 파일 존재나 예정 명령을 PASS로 세지 않는다. Root19 이후 남은6개 중 하나이며
아직 전체25개 완료나 native/platform qualification을 주장하지 않는다.


Reconcile 독립 checkout 검증: `architecture-reconcile-docs.log`의 전체 정적 gate가 PASS이며
production14284개, findings0, durable strongest61 SIGKILL/11 in-process-fault/23 logical이다.
원래 `architecture-reconcile-first.log`는 fsck collection boundary의 옛 등록2건으로 FAIL,
`architecture-reconcile-boundary.log`는 실제 이동 후 남은 doc link5건으로 FAIL이었다. 실제
physical owner 등록/링크만 고쳤고 기존 제목·assertion·리뷰 판정을 바꾸지 않았다.
새20개 workspace build는 `build-reconcile-boundary.log`, 공식 타입 검사는
`typecheck-reconcile-final.log`가 소유한다.
`reconcile-repaired.log`는 163/163 PASS; skip/cancel/todo0. Input15578 files `af0594adb4f2f6adea24c2a54290621cabdec8829ec5d2e3ce191a3a563dd134`, changed[].
원래 `reconcile-focused.log`는147 PASS/1 FAIL이었다. class mock을 object factory로 바꾸며
필요한 separator를 누락한 실제 syntax 오류를 수정했다. assertion은 바꾸지 않았다.
`authored-js-syntax-reconcile-repaired.json`은236개 authored MJS의 parse-only0 failures다.
`isolation-reconcile.log`는 원래 input15578개
`7abcfd57e89c537cc5ce2efad6e1b950134b3ad9a8df0407118d7875d7bfde2c`, changed[]에서20개 package 모두 packed independent install/공개 entry/authored
선언을 통과했다. Reconcile4개 API와 실제 shared sweep/live gate/identity/stop smoke,
Git actual bare-repo fsck/동일 in-flight lease/손상 거절/diagnostic spool 수거도 설치 runtime으로
실행했다. 순수 coordinator fixture를 systemd/실제 Resident death 또는 native platform
qualification으로 부르지 않는다. SDK 외부 선언 진단과 authored 선언 결과는 별도다.
두 실행 입력의 실제 normalized 차이는 root composition MJS fixture 한 파일뿐이며
production/package/build input은 동일하다(`reconcile-isolation-input-relation.json`).
서로 다른 input digest를 같은 실행으로 덮어쓰지 않는다. 전체 설치 검사는 package bytes가
바뀌지 않은 fixture 문법 수정 때문에 반복하지 않았다.
Root19 source의 전체 raw3 FAIL과 targeted4 PASS는 위 기록 그대로 유지한다.


Reconcile actual root 전환은 `reconcile-transfer-result.json` APPLIED74 files/conflicts0이며
변경 전 원본은 `reconcile-root-before.tar.gz`다. Root20 새 build·정적 gate와 guard/provenance
원본은 `build-twenty-root.log`, `architecture-twenty-root.log`, `twenty-guards.log`다.
전체25개 개편의 완료나 root20 전체 local PASS로 세지 않는다.


Broker stage21 작업 중: 실제 최소 port와 runtime/app/Native/Storage 소유자를 나눴다.
처음 `build-broker-first.log`는 RunLease import1건, `build-broker-ports.log`는 새 API 미전환
시험 호출7건, `build-broker-callers.log`는 Native 내부 self-import의 package check로 FAIL.
실제 import/호출부를 고친 `build-broker-native.log`는 build/package PASS였다.
초기 `broker-owner-smoke.log`3/3 PASS는 실제 Unix listener/drain/외부 소유 flock과
짧은 write 전체 bytes·zero-write 오류1회·실제2개 FD close를 확인했다. skip/cancel/todo0,
input15590개 `9cfdcc592eaff680a6880a1d3d5b9d4efb3445a271cad5c36893a239ac26949d`, changed[].
이것은 실제 systemd/Resident death나 power-loss qualification이 아니다. F06 root19의
원래 무한 루프 재현과 이 stage-local 수정 검증을 구별하며 root20에는 아직 미반영이다.
후속 read-only count owner/Scope T/SIGKILL·AST surface/negative control을 더한 새 build는
`build-broker-boundaries.log`가 소유한다. 새 `broker-ledger-projection.test.mjs`의 결과와
21개 독립 설치·전체 정적 gate·공식 타입 검사는 각각 실행 원본으로만 판정한다.


Broker stage21의 `architecture-broker-boundary.log`는 전체 정적 gate PASS, production14291개,
findings0, durable strongest62 SIGKILL/11 in-process-fault/23 logical이다. 첫 static은 stale
owned-state 예외와 raw listing2건, 다음은 이동한 status-view collection 등록2건으로 FAIL였다.
예외를 새 파일로 복사하지 않고 실제 owned primitive/physical owner로 고쳤다.
`typecheck-broker-final.log`는 공식 PASS이며 Broker의 no-async/no-accept/spec-write generic
T 검사도 포함한다. `authored-js-syntax-broker-current.json`은241개 parse-only0 failures였다.

첫 집중 원본 `broker-focused.log`는397 PASS/20 FAIL/1 cancelled/skip0, input15592개
`2a2237a15493e658a73813b2aa45e16dcf297c2ba924d091a583af386bae90dd`, changed[]였다.
15개는 이전 Native/Broker/Process VM module key, 3개는 제거한 Broker pass-through에 걸린
spy, 1개는 fixture Store 이중 close, 1개는 이전 lattice path였고 cancel1은 옛 signal helper
URI의 조기 child exit 뒤 ready wait였다. 판정·timeout·권한 검사를 줄이거나 facade를 되살리지
않고 실제 owner에 맞췄다. single close fixture와 test-owned Broker lifetime도 정리했다.
중간 `build-broker-fixture-repair.log`는 다른 Git-only fixture에 과도하게 들어간 cleanup1건의
타입 FAIL이고, 그것만 되돌린 `build-broker-fixture-final.log`는 build/package PASS다.
수정 후 `broker-repaired.log`는 418/418 PASS; skip/cancel/todo0. Input15592 files `1220cb591804f0a14cb61e29d423b768ebfd6ff7d440eb61a7a32c6177926637`, changed[].
실제 projected root T before/after SIGKILL2건에서 incarnation rollback/commit과 이전 receipt의
모든 bytes·same-key retry를 확인했다. 이는 SQLite boundary 증거이며 실제 systemd run/death,
provider turn, power-loss qualification을 뜻하지 않는다.

`isolation-broker.log`는 원래15592개 input
`2a2237a15493e658a73813b2aa45e16dcf297c2ba924d091a583af386bae90dd`, changed[]에서21개
모두 packed independent install/public API/authored declarations PASS다. Broker15개 entry,
실제 Unix listener/drain/native flock lifetime과 no SQLite/Mail/Git/Lifecycle/Reconcile closure를
설치 runtime으로 확인했다. 두 input의 차이는 root test5개와 validation binding만이며
production/package/build input은 동일하다(`broker-isolation-input-relation.json`). 서로 다른
입력을 한 실행으로 덮어쓰지 않고, package bytes를 바꾸지 않은 test repair 때문에 전체
설치 검사를 반복하지 않았다. SDK 외부 선언44 진단과 authored 결과는 구별한다.
F06 zero-write와 Principal owned-listing 수정은 이 stage-local 검증에 포함됐으나 actual root
반영은 별도 source transfer 기록이 소유한다. Root20 전체 local PASS로 승격하지 않는다.


Broker actual root 전환: `broker-transfer-result.json` APPLIED177 files/conflicts0,
변경 직전 working-tree 원본 `broker-root-before.tar.gz`. 실제 root21의 새 원본은
`install-twentyone-root.log`, `build-twentyone-root.log`, `architecture-twentyone-root.log`,
`twentyone-guards.log`다. Stage418개 집중/21개 tarball PASS와 root 전체 local을 구별한다.
4개 구현 모듈과 실제 플랫폼 qualification이 남았으므로 전체25개 완료로 표시하지 않는다.


## DR46 Engine 독립 전환 — stage22 (2026-10-24)

actual root 반영은 별도 source transfer가 소유한다. 독립 사본의 `@oma/engine`은 SDK host·RPC·
Principal session·Resident adapter·settings 변환·private Pi adapter와 Open TUI 문자열/버전
wrapping의 실제 소스를 소유한다. 실제 파일/lock·확장 digest 재검증·sandbox·birth/history·
설정 선택·credential helper와 TUI의 질문/compact/panel 구현은 app이 원래 owner로 연결한다.
Engine의 내부 의존은 contracts/domain/protocol/process뿐이며 Store/config/Mail/TUI/platform
구현 import나 옛 root pi-compat facade가 없다. 원래 한 lock hold, project re-read conflict,
현재 권한·정확한 bytes·실제 child 종료와 상속 fence를 유지한다.

`engine-final.log`: 493/493 PASS, fail/cancel/skip/todo0, 입력15621개 `8844fb26a1ce2772944b6c00fadad1c6067118557c1dbb02aa6bf5db99a3ca72`, changed[].
`isolation-engine-repaired.log`: 같은 입력에서22개 모두 tarball 독립 npm ci·공개 API·authored
선언 검사 PASS. Engine32개 공개 entry의 실제 SDK settings/child RPC/종료와 no Storage·Mail·
config·TUI·Broker closure를 설치물에서 실행했다. SDK 외부 선언44 진단은 authored 결과와
구별한다. 이는 scripted transport와 로컬 lock/process 검증이며 provider turn·systemd/cgroup·
실제 Mac/VM·power-loss qualification은 NOT_RUN이다. `typecheck-engine-final.log`의 공식
명령은 PASS, authored MJS250개 parse-only도 실패0이다. `architecture-engine-repaired.log`의
모든 정적 gate가 PASS이며 durable strongest62 SIGKILL/11 fault/23 logical을 유지한다.

원본 `engine-focused.log`는454 PASS/39 FAIL, `engine-repaired.log`는491 PASS/2 FAIL,
skip/cancel0이었다. 이전 source/module/fixture asset 경로와 분리한 실제 product surface의
negative fixture를 현재 owner로 맞췄고 Native의 실제 local import에 flock fault를 연결했다.
세 과거/무version session 허용 사례는 같은 뜻의 ID로 재사용하지 않고 별도 DR46 refusal
이름으로 바꿨다. 현재 pinned SDK header만 승인하고, saved bytes와 birth는 그대로 둔다.
`engine-focused-failure-classification.json`이 각 실제 입력과 분류를 보존한다. 첫 설치 원본
`isolation-engine.log` FAIL은 새 probe child의 newline quoting 오류이며 String.raw와 transport
종료 시 pending response 거절로 고쳤다. 판정/timeout을 줄이거나 옛 fallback을 복구하지 않았다.

`engine-common-surface-relation.json`은 기존40 interface의 hash가 모두 같고 기존 FencedEngine
선언 하나만 common runtime에 추가됐음을 기록한다. Wire 변경은 없다. Engine의 배포 asset
`pi-compat/contacts.json`은 남은 private 접점·정확한 의존 버전·원래 검증 범위의 단일 목록이다.
DR46 `engineFile`은 실제 production caller0의 dead API와 그 전용 cleanup2건만 퇴역시켰다.
Role prompt literal·extension asset DTO와 verifiedPaths·actorAddress literal의 owner를 실제
순수/common 모듈로 옮겼으며 판정 사본을 만들지 않았다. Historical review를 새 승인으로
갱신하지 않았고 immutable architecture/review notes의 bytes는 그대로다.


## DR46 Engine 실제 root22 반영

`engine-transfer-result.json`은226 files APPLIED, conflicts0이고 원본 working-tree bytes는
`engine-root-before.tar.gz`에 보관했다. 새22개 build/package 검사와 전체 정적 gate는 PASS
(`build-twentytwo-root.log`, `architecture-twentytwo-root.log`).
`twentytwo-guards.log`: 28/28 PASS, fail/cancel/skip/todo0, 입력15621개 `4f61df80bde31f6b921d85f5d449c8110b431f8276e9bdaed945649630b9b081`, changed[].
실제 root 입력에서 원래 권한 gate/단일 captured T/SIGKILL, settings lock/current header·birth
불변/상속 FD·real child 종료, owned listing과 zero-progress descriptor cleanup을 확인했다.
이 결과는 전체 local PASS나 실제 systemd/Mac/VM/provider/power-loss qualification이 아니다.

Linux 독립 stage23: 집중404/404와23개 tarball 외부 설치가 같은15,628개 입력 5b762ea9cda4330b2ae2212a66f707eb189e496fa2d4d7d89e1fb9b160923905에서 PASS, 전후 입력 변경0. 첫398/6 및 재실행403/1 실패는 원본 로그에 보존했다. 중첩 systemd 자산의 배포 목록 중복 집계를 실제 순회 owner에서 고쳤다. Linux systemd/cgroup 실제 서비스 qualification은 NOT_RUN이다.


## DR46 Linux/Mac/App 소스 전환과 stage 검증 (2026-10-24)

최종 source transfer는 final25-transfer-result.json의808 files APPLIED/conflicts0이며 변경 직전
원본은 final25-root-before.tar.gz다. 실제 root25의 새 install/build/full-local 결과는 후속 절에서
별도로 기록한다. stage 결과를 root 전체 PASS로 승격하지 않는다.

Mac stage: mac-repaired.log 296/296 PASS, skip/cancel/todo0. 입력15640개
284711e31283a6daf26dc479c4539b5aaabbc4d99ee394c44fd80396cde9c2c2, changed[].
원본 mac-focused.log 290 PASS/6 FAIL은 이전 URL/native 경계 fixture/물리 mock seam 수정 전
결과다. 실제 Mac 파일 zero-write stall과 cleanup을 고쳤으며 원시 재현을 보존한다.

App stage: app-focused.log 944 PASS/351 FAIL(1295 tests), app-repaired.log 1291 PASS/12 FAIL
(1303 tests), skip/cancel/todo0. 각각15644 files 입력 d4c3f40d559739de557e7b449091323bfe17923b99cb8fe8f2f9e6fe44a8a1fd,
355b88191b034486b4fbccdf27530ef85e4e12963a30a4a1bb1e462af64a4862, changed[].
synthetic 개별 패키지 fixture의 src까지 과도하게 바꾼 경로 치환, 실제 SDK/lock/settings/physical
owner에 맞지 않던 collaborator, 남은 실행 URL과 타입 owner를 수정했다. product surface 검사도
App의 src→dist를 올바르게 대응하도록 고쳐 실제 negative control이 계속 거부하도록 했다.
판정·deadline·오류/FD cleanup 단언을 줄이거나 옛 facade를 복구하지 않았다.

마지막 실행/cleanup 집중 app-entry-cleanup-final.log는115 PASS/1 FAIL(116 tests), 입력15644개
0fe4f57465719e4b6d3fa80c3b17c222552d13146b4e3b141b47b7d909b5f069, changed[].
남은 review fixture의 두 번째 옛 diagnostic path를 고친 app-review-final.log는1/1 PASS,
입력15644개 0a9db6d169ec968e6e57d1e002584e0ddf959509d160a82234d0064167726c74, changed[].
앞선 전체 실패를 새 전체 PASS로 바꾸지 않는다. architecture-app-final.log의 전체 static은 PASS다.

isolation-final25.log는24개 workspace의 독립 tarball/npm ci/API/authored declarations/자산을
통과한 뒤 App의 설치 bin probe에서 FAIL했다. 입력15644개
0a9db6d169ec968e6e57d1e002584e0ddf959509d160a82234d0064167726c74, changed[].
검증용 isolated lock 생성기가 workspace bin을 누락해 링크가 없었다. 실제 manifest의 bin을
보존하고 spawn 실패도 명확히 검사하도록 고쳤다. 전체25개를 pack하는 App-only 재검증
isolation-app-repaired.log는140개 공개 API·자체 선언·전체 의존 자산·실제 설치된 oma --help를
통과했다. 입력15644개 17eb569c182ddfd628a3b731ef42cd475b59658e30899106a59e7c1a1c3f4687, changed[].
final25-isolation-input-relation.json은 두 입력의 차이4개를 명시하며 실행/package bytes는 같다.
이전24개 closure의 lock은 달라지지 않는다. 외부 Pi SDK 선언44 진단은 자체 선언 PASS와 구별한다.
실제 Mac/VM/Keychain·Linux manager 서비스·real provider·power-loss qualification은 NOT_RUN이다.


DR46 변경 범위/비용 측정: final25-locality.json은 실제 manifest와 import graph를 사용한다.
전환 전 graph457 files/runtime1911/type547, 현재514 files/runtime1941/type756, 양쪽 unresolved0이다.
선언 분리로 늘어난 edge를 품질 점수나 성능 개선으로 해석하지 않는다. Web package build closure는
5개 workspace, TUI는4개다. Domain의 공통 정책 변경은 더 넓은 dependent closure를 재검증한다.
실제 fresh-process public import 측정에서 Engine brand55개/TUI screen66개/Web entry4개 모듈을
로드했으며 SQLite·Broker·Storage·Lifecycle·플랫폼 구현을 로드하지 않았다. 해당 entry의 결과이며
전체 제품 startup closure로 확대하지 않는다(runtime-{brand,tui,web}-load.json).

같은 Node26 개발 환경의 현재 TUI build4.310초/test2개0.215초, Web build14.998초/test9개18.960초를
측정했다(final25-build-startup-timings.json). 패키지 build 초기에는 별도 cloc 측정을 병행했으므로
경쟁 없는 benchmark나 개편 전후 비교로 부르지 않는다. Personal actual PTY/local scripted provider
3회는 화면1.549/1.845/1.640초, 응답2.058/2.323/2.111초, 종료 모두0이다.
원시 terminal/launch/request/exit와 지표를 measurement-personal-startup.log의 임시 위치에 보존한다.
실제 provider와 Society 서비스 startup은 NOT_RUN이며 비교 가능한 개편 전 시간 baseline은 없다.

LOC 측정은 SOURCE_BOUND 결과를 얻지 못했다. 첫 시도는 Linux environment.d/sysusers.d의 conf
분류 누락으로 거부했다. conf를 systemd 언어로 명시한 뒤 전체 inventory를 세었지만 cloc2.08이
같은 두 vendored TS bytes에 대해 반복 실행마다 서로 다른 code/comment 수를 냈다. 단독2파일
3회와 Perl hash seed 고정4회에서도 재현했다(cloc-two-file-repeats.json,
cloc-fixed-seed-repeats.json). 원본 bytes의 SHA 변화는0이다. fresh re-measure gate를 완화하거나
파일을 제외하지 않았고 최종 LOC 및 감소율은 NOT_RUN/UNRELIABLE로 둔다. 원시 loc-final25*.log와
미승인 report는 남기되 통과한 측정치로 사용하지 않는다. source inventory/digest 검사는 별개다.


## DR46 원본25 첫 전체 local — 실패 원본 보존

final25-root-local.log는 serial9 PASS와 parallel4096개 중4078 PASS/18 FAIL이다.
합계4105 tests/4087 PASS/18 FAIL, cancel/skip/todo0. 입력15644개
4a7f16ae54f4d9b85cc0c9392e567b3992a41625347ba6da984422be3e472f26, 전후 changed[].
root의 새 npm ci, clean build55.971초, 공식 typecheck41.994초는 PASS다. build 뒤 npm rebuild
--ignore-scripts로 실제 workspace bin을 연결하고 기존 개발용 oma 링크도 새 App entry로 갱신했다.
첫 정적 검사는 남아 있던 빈 src 디렉터리4개로 FAIL했고, 파일 삭제 없이 빈 디렉터리만 정리한
architecture-final25-root-repaired.log는 전체 PASS다. 원래 FAIL 로그는 남겼다.

18개 실패는 옛 unit/Resident PATH 단언4개, synthetic source/디렉터리 불일치3개,
자식 프로세스의 옛 module URL7개, 제거한 Broker pass-through의 사용되지 않는 mock3개,
workspace target을 따라가지 않는 lock 검증1개다.
분류의 항목 경계는 final25-full-fixture-repairs.json의 실제12개 test 파일 변경과 원본 오류를
함께 본다. 구체적으로 context/bundle child2개, settings/request/binding child4개, liveness child1개가
현재 공개 owner를 사용하도록 바뀌었다. 기존 SIGKILL 지점·메모리/stream bound·원본 bytes·
terminal/receipt·실제 FD/child·sandbox 격리와 usage/exit 단언은 유지한다. lock 검증은 실제
link.resolved target으로 이어져 전체 production closure의 non-dev 조건을 계속 검사한다.
이 변경은 test/fixture만이며 production bytes는 변경하지 않았다. 수정 후 집중과 새 전체 결과는
별도로 기록하며 첫 전체 FAIL을 PASS로 바꾸지 않는다.


수정 후 원본 집중 final25-root-fixtures.log:112/112 PASS, fail/cancel/skip/todo0.
입력15644개 8230908056e7bd47c279e02869bb5b758b11da6d28a51cf2bdd3ffcf7921d47e, changed[].
실제 settings/request/binding SIGKILL·retry/restart, /proc EMFILE unknown, 메모리/stream bound,
accepted mail 복구/terminal·frozen bytes, real sandbox CLI·격리와 전체 runtime lock closure를 포함한다.
첫 전체 실패를 이 집중 결과로 승격하지 않고 새 전체 실행으로 확인한다.


## DR46-F08 status 인코딩 비용과 재검증

final25-root-local-repaired.log의 첫 serial 구간은8 PASS/1 FAIL이었다. V23A read lag59ms가
기존50ms 기준을 넘었으며 같은 제품 코드의 앞선 전체 실행에서는45ms였다. 나머지 실행을
원인 조사 목적으로 중단했다(final25-root-local-repaired-interruption.json). 원시 실행은
signal SIGKILL, 입력15644개 04adc00c4262d10ec8363946205f8440b6115c1044b4170485f74dac1941ac60,
changed[]이며 전체 결과로 계산하지 않는다. 시험 기준·timeout·fixture 부하를 낮추지 않았다.

Protocol/status-page는 각 행마다 누적 전체 응답을 재직렬화했다. 원본 probe는64행에서
row 직렬화2080회,16페이지 burst12.14–16.62ms였다(status-page-before-probe.json).
각 행 UTF8 bytes와 comma를 누적하고 기존 continuation 공간을 그대로 예약하는 선형 계산은
64회, burst0.68–3.56ms였다(status-page-after-probe.json). 원본 함수와 frame0..4096,
empty/single/multiple rows·cursor·UTF8/제어/escape id/값의98328개 경우를 비교해 결과 JSON의
정확한 bytes 또는 오류 code/message가 모두 같았다. corpus SHA는
ef954425da4da405960262d8473d9fa0390560049e6cb0f77f59e7b1e325f475다.
이는 해당 helper의 현재 환경 측정이며 전체 제품 startup 개선율로 해석하지 않는다.

새 package-owned status-page.test.mjs의3개 회귀는 PASS다. 실제 기존 V23A cold process3회는
read lag16/24/27ms, mixed47/43/44ms, p95 294/290/285ms로 원래50/100/1000ms 기준을 통과했다.
원시 status-linear-cold-{1,2,3}.log를 보존한다. 단일 관측 부하의 비용을 줄인 수정이며 권한,
accepted bytes·terminal·receipt, unknown, 실제 child/FD 수명은 변경하지 않았다.
앞선 stage/root package byte 일치 관계 뒤 Protocol의 이1개 runtime source가 바뀌었으므로
새 Protocol/Broker/App 설치 검증과 원본 전체 local로 확인한다.


## DR46 최종 원본25 로컬 검증 (2026-10-24)

**코드 전환과 가능한 로컬 검증은 완료. 실제 플랫폼 qualification은 미완료다.**
원본 final25-root-final.log는 serial9/9와 parallel4099/4099, 합계 **4108/4108 PASS**다.
fail/cancel/skip/todo0, status0/signal null, 입력15645개
2d8ca17fe14204634d87ca99f5d9cdf5b34ae62e235600cdfca0c22aefa37d43, 전후 changed[].
실제 기존 V23A는 read lag40ms/mixed45ms/p95 283ms, pending620 상태는lag20ms로 원래 기준을
통과했다. 기존 durable/권한/bytes·terminal·receipt·unknown·자원 수명 조건과 새 status 선형
회귀3개를 포함한다. 첫 전체4105개 중18 FAIL과 후속 응답성 FAIL/중단 기록도 그대로 남긴다.

동일 입력의 isolation-status-linear.log는 최신 Protocol30/Broker15/App140 공개 entry와 자체
declaration, 설치 자산과 runtime을 PASS했다. Protocol의 새3개 byte/cursor/linear-work 회귀를
실제 독립 설치물로도 실행했다. 앞선25개 설치 증거 이후 바뀐 runtime source는 Protocol의
status-page.ts 하나이며 공개 declaration bytes는 그대로다. 나머지 workspace의 원시 설치
결과와 stage/root source 관계를 보존한다. App의 외부 SDK declaration44 진단은 별도이며
이를 외부 타입 전체 PASS로 부르지 않는다. 새 clean build/package 검사는
build-status-linear-root.log에서 PASS다. 이전 공식 typecheck PASS와 새 strict compile도 보존한다.

전체 실행이 끝난 뒤 이 결과와 인계를 기록한다. runtime의 원래 입력과 기록 후 입력을
동일하다고 바꾸지 않고 final25-post-runtime-input-relation.json에서 실제 차이를 기록한다.
현재 source 결박/구조 판정은 refresh-final25-post-runtime-*와 architecture-final25-post-runtime.log,
실행 proof는 위의 원래 raw log/입력 map이 소유한다. 과거 reviewed notes를 갱신하거나 새 승인으로
만들지 않았다. immutable architecture와 review-notes의 SHA도 원래 값 그대로 유지한다.

미실행: local runner가 명시적으로 제외한 실제 systemd/cgroup9개 파일, 실제 macOS/VM/Keychain,
real-provider turn, 실제 power-loss qualification. 현재 user manager는 running이지만 dev는
disposable qualification 계정이 아니고 호스트 /usr/bin/bwrap도 없다. private namespace의
로컬 bwrap/실제 Linux FD·lock·SIGKILL·C bridge·scripted provider 결과로 이를 대체하지 않는다.
필수 실제 환경 검사가 남아 있으므로 명세의 개편 전체 qualification 완료로 표시하지 않는다.
LOC는 cloc2.08의 같은-source 반복 결과 불일치로 UNRELIABLE이며 유효한 최종 감소율을 주장하지 않는다.
