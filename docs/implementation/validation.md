# 현재 검증 상태 — 2026-11-07 KST

제품 전체는 **미완료**, G-PROCESS/G-FILES/G-AUTH는 **OPEN**이다. DR74로 macOS 진입 일괄 차단과 fresh Society 거절을 제거했다. macOS 제품 경로의 실제 실행 결과는 아래 SOURCE110 이후 기록을 따른다.
SOURCE106의 Society 기본 소유권·scope/recovery·private Host 감독·FD close·실행 owner 사망 결합은 ARM·Intel 각10/10 PASS다. SOURCE107 explicit fence까지 ARM11/11 PASS다. Intel11개 본문은 PASS지만002 cleanup의 중복 stream write로 suite가 실패했고 SOURCE108은 이 hook만 수리한다. 이전 실패 원시는 보존한다. full identity/collision·실제 상속 FD 인식·Host/creator 사망 거절·정상 반환/즉시 재취득·변조 거절을 확인했다.
실제 scope/후손의 FD 유지, kernel whole-scope empty·drain·빈 journal 뒤 재취득도 통과했다. Host tenure를 유지한 실행 owner crash/recovery의 기존 journal frame 보존도 확인했다. SOURCE97 ARM의 공통 회귀465/465와 구분한다.
이 기본 소유권 구현과 실제 전체 제품 실행의 인수 범위를 구분한다.
각 source/input/runtime의 결박과 실패 원시는 아래 SOURCE별 기록을 따른다. 후속 성공으로 이전 종료 unknown을 삭제하지 않는다.

2026-11-06 SOURCE130까지 실제 Mac(주 대상 Mac26 arm64)에서 확인한 제품 경로: 새 Society 생성→Broker ready→SIGTERM 정상 drain, Personal 시작, 실제 Host PTY 실행과 Ctrl-D 무잔존 종료, `oma archive`의 Restic backup/verify·restore, 실제 Host 아래 Principal engine→Broker Mach 인증 호출, 실제 Seatbelt Worker 시작·RPC·session 재개. Society 소유권 12/12(세 Mac), 공통 suite 466/466(Mac26·Intel).

| 남은 제품 작업 | 닫히지 않은 범위 |
|---|---|
| Worker 실제 작업 | 닫힘(Mac26·Intel `2865ac9da60`): Worker 도구 probe의 compiler 링크·private read/shared write 거절 PASS, 제품 경로 GOAL→Seatbelt Worker→relay model·submit→quarantine·LOW 통합(006·009·010) PASS. 세 Mac PASS |
| G-FILES | 전체 제품 경로의 StateRoot capture·private work/source fetch·남은 외부 writer/진단 결박과 수명 인수 |
| G-PROCESS | populated-scope termination은 Mac26 12/12 재확인 PASS. 실제 Worker/Pi scope의 kill 인수는 제품 시험 011(엔진 SIGKILL 뒤 detached 후손 종료)로 추가, 판정 대기. restart 인수 남음 |
| G-AUTH/복구 | restart/sleep 상황의 current capability, release 서명 Keychain/SIP 검증 |
| 플랫폼 범위 | macOS x64의 고정 Restic은 무서명이라 archive만 거절(호환성 대상). macOS 15 결과는 매 실행 끝에 취소되어 판정이 적음 |
| 최종 인수 | 세 gate 공식 판정, 전체 Linux 회귀(Ubuntu job을 먼저 실행하도록 변경)·새 설치 시나리오 |

아래 초기 관측과 실패는 역사적 기록이며 최신 제품 완료 선언이 아니다.

## macOS 구현 재개 — 직접 실행과 Node 자식의 libc 비교

병합본 `e0cb4899ab3`에서 보관 인계의 다음 실험을 구현했다. `launchd-bootstrap`의 각 권한 variant에서
기존과 동일한 C image를 pruning launcher task에 직접 exec하고, 기존 Node-child C의 main/service443,
main/service 없음, thread/service443과 비교한다. Seatbelt policy·cwd·실행파일·호출 입력은 동일하며
각 launch 전후 port와 실제 PID/UID·오류·주소 결과를 별도로 보존한다. validator는 다른 image/profile/cwd,
누락된 결과, PID/UID 혼입을 거절하고 실제 실패도 결과로 보존한다. 제품 실행 guard와 세 gate는 유지한다.

로컬 Node 26.0.0에서 전체 build, parser/Seatbelt **41 PASS / 0 FAIL / 0 SKIP**, 전체 architecture·transaction·
durable boundary·문서·명세 inventory 검사가 통과했다. 이 변경의 실제 Darwin 실행은 CI 발행 전 **NOT_RUN**이다.
로컬 원시는 `/tmp/oma-macos-direct-{build,architecture}.log`와 `/tmp/oma-macos-direct-focused.tap`이다.

### 실제 Mac 관측 — source `a54b625fbf7`

Native [41766307991](https://github.com/minjung2035/oma-v2-ci/actions/runs/41766307991)의 Mac26 arm64/SDK26.5와
Mac15 arm64/SDK15.5에서 각3회 실행했다. 각 OS의120개 시도는108 OBSERVED·12 SETUP_FAILED이며
productQualification은 BLOCKED다. 입력15825개 digest `3daac099ecd18fea2e7fa46f0290d33d41829926c7f21e2f20eb8921d01b2f58`와
runtime 산출물은 전후 동일했다. 양 Mac의 gate ZIP을 API의 SHA-256과 대조했다.

| 동일 C image의 libc 호출 | inherited | bootstrap-only / bootstrap-and-xpc |
|---|---|---|
| pruning task 직접 exec |18회 성공 |36회 성공·global bootstrap0 |
| 기존 Node-child |18회 성공 |36회 EAI_NONAME8 |

수치는 양 OS·각3회·3 resolver context의 합이다. 같은 image에서도 실행 경로에 따른 차이가 재현됐다.
Node만의 원인인지 일반 child 생성의 성질인지는 아직 미분리다. 이 결과는 모든 launchd 권한의 제거,
일반 도구의 DNS 호환성, 전체 실행 범위의 closure를 증명하지 않는다. 후속 C fork/posix_spawn 비교는 별도 입력이다.

공통 runtime은 각 **272 PASS / 10 FAIL / 0 SKIP**다. 실패10개는 파일 경쟁 시험의 descriptor 식별이
Darwin `/dev/fd`를 readlink하려 하여 경합을 주입하지 못한 사례였다. 독립 패키지는 각25/27 PASS이며
기존 `@oma/git` preparation guard와 `@oma/tool-lsp` cleanup의 임시 root alias 실패를 보존한다.
gate의12개 준비 실패는 새 integration policy의 maxWorkers 누락3개, quarantine REF_STATE_UNKNOWN3개,
새 collaboration plan 누락의 Worker6개다. 정상 제품 실행이나 지원 완료로 계산하지 않는다.

Ubuntu 공통274·native leaf3·execution46·Restic setup8은 PASS다. 선택 integration은471/472 PASS이며
기존 status-responsiveness의 mixed event-loop lag218ms가 원래 예산을 넘었다. 단언·시간 제한을 바꾸지 않았다.
별도 전체 Architecture [41766308010](https://github.com/minjung2035/oma-v2-ci/actions/runs/41766308010)의 결과는 별도로 판독한다.

원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/direct-exec/`다.
Mac26 gate ZIP `fdc158cc3681af7b99ac91958423f8be41cf6e8006b809c8ae8ddc747a99b536`,
Mac15 gate ZIP `0dfa1d1f5898832c9eddbbcde09a8d77911f68fe295d82db7a9aed342ce3ed3c`다.

### 후속 수정 — 실제 Mac 재검증 전

LSP scratch 생성은 canonical temporary root를 사용하도록 고쳤다. 실제 symlink TMPDIR의 성공·실패
양쪽 cleanup 회귀는 이전 build에서2 FAIL, 수정 build에서6/6 PASS다. 외부 sentinel과 원래 오류를 보존한다.
파일 경쟁 시험은 실제 FD와 named inode의 dev/ino를 비교하여 양 OS에서 경합을 주입한다.
Worker·candidate fixture의 누락 입력과 폐기된 mail-read 호출을 현재 명시적 surface·ordinary record read로 옮겼다.

Seatbelt는 endpoint가 없는 recipe에도 child stdio용 AF_UNIX 생성을 허용한다. pathname 접속은 기존
network-outbound의 exact allowlist를 유지한다. async child의 실제 stdin/stdout·close 회귀와 기존
listed/unlisted Unix 접속 대조로 확인할 입력이며 이 변경의 실제 Darwin 실행은 아직 NOT_RUN이다.
quarantine의 첫 read-only Git subprocess 결과와 C fork/posix_spawn의 실제 child PID·wait·deadline도 추가로 보존한다.
로컬 SDK snapshot/zig의 arm64 object compile은 성공했으며 실제 Apple compiler·kernel 실행을 대체하지 않는다.
후속 build와 parser·Mac recipe·파일 경합·LSP·Worker plan의 선택 실행은136/136 PASS·skip0다.
구조 자료 생성 뒤 전체 architecture·transaction·durable boundary·문서·명세 inventory도 통과했다.
기존 review ledger의 두 변경 파일은 NOT_REVIEWED 상태를 유지하며 과거 검토를 재승인하지 않았다.

### 두 번째 실제 Mac 관측 — source `e8c90b24c77`

Native [41768300064](https://github.com/minjung2035/oma-v2-ci/actions/runs/41768300064)의 양 Mac에서
공통 **282/282 PASS·skip0**, 독립 설치 **26/27 PASS**다. 파일 경쟁10개가 실제로 주입·거절됐으며
LSP installed runtime도 PASS다. 남은 설치 실패는 `@oma/git`의 기존 Linux preparation guard다.
두 OS 모두 `seatbelt-files`의 endpoint 없는 정책에서 실제 async child stdio·close가 각3회 통과했고,
기존 listed/unlisted Unix socket의 허용/거절도 유지했다. 이 primitive 수리를 G-PROCESS로 계산하지 않는다.

각 OS의 gate는 여전히108 OBSERVED /12 SETUP_FAILED /120 executed, productQualification BLOCKED다.
inherited C fork/posix_spawn12회는 libc 성공이며, bootstrap 제거 뒤24회는 모두 실제 child 생성·join에
성공했지만 libc EAI_NONAME8이다. 같은 task의 direct exec 성공과 달리 **일반 C 후손에서도 DNS가 실패**한다.
Node 특유의 spawn 버그라는 가설은 이 관측으로 배제한다. 이 방식은 일반 도구 호환 backend로 미채택이다.

candidate는 maxWorkers 입력을 지나 private gate release0·REF_STATE_UNKNOWN으로 거절됐고,
quarantine도 REF_STATE_UNKNOWN이다. 동일 recipe의 첫 read-only async Git 진단은 exit0·sha1을 반환했다.
Worker6개는 현재 surface 입력을 지나 실제 production preload의 native guard에서 거절됐다.
guard를 제거하거나 실패를 PASS로 바꾸지 않았다. Ubuntu 공통274·native leaf3·execution46·Restic setup8·
선택 integration472/472는 모두 PASS이며 첫 source의 status lag 실패도 보존한다.

입력15825개 `1c992a7942fe82bb023f2c5613ed87ef6e1815c4eadb053d371c1506c28498a0`와 runtime 산출물은
양 Mac gate에서 전후 동일했다. 원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/child-creation/`다.
Mac15 gate ZIP `92998f3604ebd46b1e54a722bdb053313d2102ecb1d9ff76e0b516629e9fd38f`,
Mac26 gate ZIP `90822e4d95538160954e55d45c9296e5402b54e1365c1409ca173bb6b18eca98`를 API digest와 대조했다.

### 세 번째 입력 — owned root 취득과 별도 audit session 비교

`ensureOwnedDirectory`는 이미 존재하는 owned boundary를 기존 kernel beneath/no-link open 한 번으로
취득하고 그 FD 아래에서만 생성·수리한다. 상위 user directory를 읽거나 수리하지 않는다. missing/EACCES에만
기존 생성·held-inode repair walk를 유지하고 containment 거절·EAGAIN을 다른 경로로 우회하지 않는다.
실제 Linux search-only ancestor 회귀는 수정 전1 FAIL, 수정 후 해당 회귀와 기존 directory/native21/21 PASS다.
candidate/quarantine의 원래 예외 문구도 stderr에 남기되 private status와 닫힌 OMA_ERROR marker는 유지한다.

추가 public launchd `SessionCreate=true` 대조는 production Seatbelt·inherited bootstrap·동일 Node/tools에서
독립 fresh service를 호출한다. 실제 task audit token의 ASID가 host 기준선과 다른지, DNS·service effect를
함께 기록한다. 이 입력의 실제 Mac은 NOT_RUN이며 session 분리만으로 containment라고 가정하지 않는다.
resolver fixture의 deadline은 WNOWAIT 관측 뒤 alarm을 차단·해제한 다음 child를 reap한다. 같은 POSIX 함수의
실제 Linux fork/posix_spawn 성공·exit7·deadline/SIGKILL 6개가 모두 join을 확인했다. 이 Linux 검증의 Mach
snapshot은 stub이며 Darwin token·session·backend proof가 아니다.
세 번째 입력의 build·선택65/65·전체 architecture·transaction·durable boundary·문서·명세 inventory는 PASS다.
선택 실행의 최초60/65는 host `/usr/bin/bwrap` 부재의 namespace ENOENT5건이었다. 이를 보존하고
pinned bwrap0.12.0 private `/usr/bin` overlay·위임 user scope에서 같은65개를 모두 통과했다.
동일 환경의 실제 cgroup/tmpfs 사전 시험3/3도 PASS다. source/current review 재승인 없이 generator로
구조 자료를 갱신했다. 원시는 `/tmp/oma-macos-third-{build,architecture}.log`,
`/tmp/oma-macos-third-focused{,-pinned}.tap`, `/tmp/oma-macos-final-linux-20261104/preflight.log`다.
이 입력의 전체 Linux 실행과 실제 Mac은 발행 전 NOT_RUN이다.

### 세 번째 입력의 실제 결과 — source `a81a41c7cdf`

Linux 전체는 **4736/4736 PASS·fail/skip/cancel/todo0**다. Node26.0.0·UID1000·pinned bwrap0.12.0
private overlay·delegated scope에서 수정 없는 `scripts/test-local.mjs`를 실행했다. serial44와 parallel4692,
기본 동시성4이며 1168.933초가 걸렸다. 입력15825개 digest
`60311b6744c4fd82dfd425bc32c3dbe924d04a2472bc21a6c67a1717d4863573`는 전후 같고 changed=[]다.
원시는 `/tmp/oma-macos-final-linux-20261104/`의 full-run.json·TAP·per-file manifests에 보존한다.

Native [41770457977](https://github.com/minjung2035/oma-v2-ci/actions/runs/41770457977)의 양 Mac 공통
**283/283 PASS·skip0**, 독립 설치26/27 PASS다. 각 gate는108 OBSERVED·12 SETUP_FAILED/120 executed이며
제품은 BLOCKED다. `SessionCreate=true`는 실제 kernel ASID를 바꿨으나 양 OS 각3회 모두 fresh service
호출 exit0, PID1 아래 다른 coalition의 unsandboxed actor를 실행했다. **별도 audit session도 현 정책의
scope closure를 제공하지 못한다.** candidate/quarantine의 새 stderr는 일반 `ensureDirectory`가
`/private`를 열려다 EPERM을 받는 것을 확인했다. Worker는 production native guard에서 거절됐다.
Ubuntu 공통275·native leaf3·execution46·Restic8·선택 integration472는 PASS다.

API SHA-256 대조한 원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/session/`다.
Mac26 gate ZIP `b925a99edfb8d63fe0309086a525d6a32eefe0d309ab8f54f7b3bc91a60e297c`,
Mac15 gate ZIP `c045db71eeb5248a90940d869cfccff7375d92f922969768b5b8647d2cc55a8c`다.

### 네 번째 입력 — 검색 전용 ancestor·CI 위임·표준 App Sandbox 후보

일반 `ensureDirectory`도 전체 existing prefix를 kernel beneath/no-link open으로 취득한 뒤 missing tail만
held FD에서 만든다. ENOENT만 prefix를 줄일 수 있고 EAGAIN·EPERM·EACCES·containment 거절은 우회하지 않는다.
실제 search-only ancestor의 existing/new-tail은 수정 전2 FAIL, 수정 후 기존 owned/링크/관측 회귀와 함께
통과했다. 권한 완화·pathname chmod·symlink fallback을 추가하지 않았다.

Architecture [41768300320](https://github.com/minjung2035/oma-v2-ci/actions/runs/41768300320)의 native-all은
4734 PASS·0 FAIL·1 SKIP, sourceChanges=[]였지만 qualification은 FAIL이다. delegated cpu/memory/pids 부재와
이미 현재 이름으로도 요구하던 Restic 다섯 검증의 폐기된 중복 접두사가 원인이다. 현재 여덟 검증은 모두
실행됐다. CI installer에 disposable runner의 user manager 위임·쓰기 preflight를 추가하고 실제 runtime
명령은 동기 scope wrapper로 실행한다. 폐기 접두사만 제거하고 여덟 실제 oracle과 skip 거절을 유지한다.
새 wrapper의 실제 cgroup CPU·memory·tasks/tmpfs3개는 로컬에서 통과했다. hosted CI 결과는 아직 NOT_RUN이다.

표준 `com.apple.security.app-sandbox`는 **미채택 후보**다. 동일 C 복사본의 ad-hoc 서명·실제 entitlement와
custom policy 적용 전 owned canary 접근을 unsigned 양성과 비교한다. inherited bootstrap·production
Seatbelt·동일 Node/Git/compiler/libc DNS·별도 fresh GUI service를 유지한다. 일반 network와 필요한 owned
경로의 파일 예외만 요청하며 root service·restricted entitlement는 사용하지 않는다. 준비 실패와 실제 관측을
구분하고 서명 성공을 enforcement나 scope proof로 계산하지 않는다. 실제 Mac 실행은 발행 전 NOT_RUN이다.
네 번째 입력의 전체 build·filesystem/durable/Git/실제 native 실행 선택112개와 parser/관측/정책 선택74개는
모두 PASS·skip0다. arm64 SDK object compile도 성공했으나 Apple compiler·kernel proof와 구분한다.
원시는 `/tmp/oma-macos-fourth-{build,focused,early,architecture}.log` 또는 `.tap`,
`/tmp/oma-macos-directory-search-{red,green}.tap`과 `/tmp/oma-native-ci-wrapper-resource.tap`이다.

### 네 번째 실제 Mac·CI 결과 — source `e2d29938e75`

Native [41773314673](https://github.com/minjung2035/oma-v2-ci/actions/runs/41773314673)의 양 Mac 각3회에서
표준 App Sandbox 서명본은 custom profile 적용 전 owned0600 canary 읽기를 EPERM1로 거절했고 같은
unsigned image는 읽었다. 실제 enforcement는 관측했지만 **그 뒤 `sandbox_init`은 모두 EPERM·exit2**여서
Node·DNS·서비스 호출에 도달하지 않았다. 정책의 교집합이나 closure를 증명하지 않는다. 원시는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/app-sandbox/`이며 API digest와 ZIP을 대조했다.
Mac26 gate `fcff623fe281be4eb4b13dddd7aad0e6ae65c0d1c7914d223e221aee38c7fbbd`,
Mac15 gate `6ee7a61c742372aea6fcada460ccef8fddce79552411a7ebd0eb324a281bb19d`다.

양 Mac 공통286/286 PASS·skip0이며 독립 설치는 기존 Git guard1건이 남았다. 로컬 Linux 독립 packed
설치는27/27 PASS다(`/tmp/oma-macos-fourth-package-isolation.log`). Ubuntu 공통278·native execution46·
integration472는 PASS이나 setup의 `systemctl set-property … Delegate=yes`가 거절돼 전체 job은 FAIL이다.
Architecture [41773314617](https://github.com/minjung2035/oma-v2-ci/actions/runs/41773314617)도 동일 setup
오류로 actual full은 NOT_RUN이다. 이를 controller 검증 성공이나 제품 회귀로 바꾸지 않는다.

### 다섯 번째 입력 — disposable Git metadata·정책 적용 순서

candidate/quarantine의 설정 파일 교체가 전체 ancestor flush를 요청하는 것을 실제 POSIX search-only
root로 재현했다. 두 사례 모두 수정 전 `flushDirectoryChain→openDirectory` EACCES로 실패했다.
두 caller만 기존 `withinDirectory`·`replaceDerivedEntry`를 사용하여 held parent에서 private 임시 파일을
쓰고 file flush·rename·parent flush한다. disposable checkout attributes/alternates는 accepted evidence가
아니며 기존 accepted publication·전체 durable-directory helper를 변경하지 않는다. 같은 실제 Git checkout·
thin bundle/prerequisite 검증은 수정 후2/2 PASS이며 root mode·canonical refs·accepted bundle bytes를 보존했다.
원시는 `/tmp/oma-macos-git-ancestor-{red,green}.tap`이다. 양 Mac 공통 실행 목록에도 이 사례를 추가했다.

CI 위임은 runtime instance drop-in으로 바꾸고 actual writable controller preflight를 유지한다.
App Sandbox는 반대 순서(custom policy 적용→동일 signed image exec)도 별도 비교한다. outer 적용 결과와
inner의 같은 PID·profile 경로·일반 tools·새 service target을 보존한다. inner가 새 정책을 적용했다고 쓰지
않으며 standalone 서명의 실제 canary 관측과도 구분한다. 기존 App-first 실패를 남긴다. 새 source의 hosted
CI·actual Mac·전체 Linux 결과는 발행 전 NOT_RUN이며 제품 backend·실행 guard는 아직 미채택/유지다.
다섯 번째 입력의 전체 build·parser/정책/실제 search-only Git49개·실제 Linux Git/private gate와 관련 선택94개는
모두 PASS·skip0다. 원시는 `/tmp/oma-macos-fifth-{build,parser,focused,architecture}.log` 또는 `.tap`이다.

### 다섯 번째 입력의 전체 결과 — source `81eb5a178ed`

Linux 전체는 **4744/4744 PASS·fail/skip/cancel/todo0**다. Node26.0.0·UID1000·pinned bwrap private
overlay·delegated scope에서 원래 runner와 기본 동시성4를 유지했다. serial44·parallel4700,1164.803초이며
입력15827개 `48e665fe5b4be1867d96f465e056f71e54259f4fada24e9538339270921d6e5c`는 전후 동일·changed=[]다.
원시는 `/tmp/oma-macos-fifth-linux-20261104/`의 full-run.json·원시 TAP·per-file manifests다.

Native [41775147845](https://github.com/minjung2035/oma-v2-ci/actions/runs/41775147845)의 양 Mac 공통
**288/288 PASS·skip0**, 독립 설치26/27 PASS다. quarantine은 양 OS 각3회 **verify→import 전체 경로를
완료**했고 canonical refs·accepted bundle bytes/cursor 보존을 확인했다. candidate도 준비·최종 gate release1을
지나 실제 최종 명령에 도달했으나 lease FD9의 identity 보존 단언에서 실패했다. Worker6건은 native guard다.
각 gate는111 OBSERVED /9 SETUP_FAILED /120 executed이며 제품은 여전히 BLOCKED다.

두 OS 각3회 custom-first→signed App Sandbox는 SIGABRT·inner report 없음·Node/tools 미실행이었다.
App-first의 sandbox_init EPERM도 그대로다. 이 순서들을 usable policy intersection으로 채택하지 않는다.
API SHA-256 대조한 원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/app-reverse/`다.
Mac26 gate ZIP `4fe547ee5a37f7bd200f376aff3185737e7fecf0d0d0e4eecffb8a81d104406e`,
Mac15 gate ZIP `355594ae9a380c10f58bc52d516addd094720c9e9be6777b322b0aa3b64d5cba`다.
Ubuntu native-runtime job은 전체 PASS다. 새 CI 위임 installer·actual controller 쓰기 preflight도 성공했고
Architecture [41775147818](https://github.com/minjung2035/oma-v2-ci/actions/runs/41775147818)의 두 full lane이
실제 실행 중이었다. 후속 SHA-256 대조 artifact에서 native-all **4744/4744 PASS·skip0·errors[]**,
13 command exit0·sourceChanges=[]를 확인했다. baseline의 fast1154·durable937·property42·stress16·platform79도
모두 PASS·skip0·errors[]·각 command exit0다. 이전 CI의 controller skip와 stale Restic required-name 실패가
같은 oracle을 실제 실행한 이 입력에서 해소됐다. ZIP SHA-256은 native-all
`41a30fda8f91586f7c74054b7055d8e6deec25352ce5cb621fed70eb0d9c31a2`, baseline
`3dd815777da6d734636b5c21c4739e57d4f59a9f0473f7afce82799343a8e867`이다.
원시는 `app-reverse/arch-*`와 `ci-qualification-summary.json`에 보존한다.

### 여섯 번째 입력 — 명시적 lease FD exec 상속·단일 App Sandbox 대조

Node26 실제 exec 대조에서 inherited FD는 CLOEXEC1로 시작해 사라졌고 선택 FD 하나만0으로 복구하면
같은 dev/ino가 유지됐다(`/tmp/oma-macos-fd-exec-20261104/result.json`). native control leaf에 명시적
`inheritOnExec`을 추가하고 Darwin candidate의 기존 slot9 lease만 최종 준비 callback에서 지정한다.
status6은 CLOEXEC, gate8은 닫힘을 유지한다. Linux의 bwrap 슬롯은 별도이므로 이 지정을 적용하지 않는다.
실제 Node→Node exec·pipe byte/EOF 회귀에서 지정 FD200만 유지되고 private FD201은 EBADF였다.
기존 close-on-exec·duplex/pipe·parser와 합쳐37/37 PASS·skip0다.

다음 대조는 **App Sandbox 단독**의 동일 Node/Git/compiler/C DNS와 fresh GUI service 호출이다.
custom policy를 적용했다고 주장하지 않고 source/validator에 그 제한을 명시한다. standalone 서명·canary
대조는 유지하고 기존 두 stacking 실패도 보존한다. 이 대조만으로 전체 파일/IPC 정책이나 제품 scope
closure를 채택하지 않는다. 여섯 번째 입력의 actual Mac은 발행 전 NOT_RUN이다.
여섯 번째 입력의 전체 build·관련 descriptor/Git/private gate/recipe/parser87개는 PASS·skip0다.
원시는 `/tmp/oma-macos-sixth-{build,focused,early,architecture}.log` 또는 `.tap`이다. arm64 SDK object
compile도 성공했지만 actual Apple compiler·kernel proof와 구분한다.

### 여섯 번째 실제 결과 — source `7c7a3da6acf`

Native [41778257534](https://github.com/minjung2035/oma-v2-ci/actions/runs/41778257534)의 양 Mac 공통
**289/289 PASS·skip0**, 독립 설치26/27 PASS다. candidate는 private status/gate를 닫고 lease FD9의
실제 dev/ino를 유지했으며 자기 script 실행까지 통과했다. 다음 `/usr/bin/cc`는 global
`/var/select/developer_dir` metadata를 읽으려다 EPERM으로 실패했다. quarantine은 계속 verify→import를
완료했다. 각 gate는111 OBSERVED /9 SETUP_FAILED /120 executed, productQualification BLOCKED다.

표준 App Sandbox 단독은 두 OS 각3회 실제 Node/Git/compiler/DNS가 성공했으나 fresh service와
복구한 global bootstrap을 통한 service가 모두 exit0으로 **다른 resource coalition**의 actor를 실행했다.
관측 파일은 client의 writable root 안에 두었고 canary는 보존됐다. 두 stacking 순서의 실패도 유지한다.
따라서 App Sandbox 단독도 이 실행 범위를 닫는 backend로 채택하지 않는다. GUI UID501·SIP-disabled
관측이며 headless·SIP-enabled 환경의 일반적 불가능 판정은 아니다.

입력15827개 `6c3b79bfc5b90ab13016fcf4f4b550ed464e54806736833fe85f7a0d94ed0357`와 runtime 산출물은
전후 동일하다. API SHA-256 대조한 원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/app-only/`다.
Mac26 gate ZIP `31e0ba79b582531ac67ec29034b0bd0ec43be17fc9f8d49c16e92772bb1ad2b9`,
Mac15 gate ZIP `8697cca0dcf17d7bb010fa7d628a397805397aa7cf429939e19ddca4111bd3c3`이며
`observed-summary.json`에6회 실제 service/client CID와 정상 도구 결과를 보존했다.

### 일곱 번째 입력 — selected developer shim·bootstrap message filter 대조

candidate와 Worker의 `DEVELOPER_DIR`은 관측한 read-only developer root로 지정한다.
[Apple의 CLI 설정](https://developer.apple.com/documentation/xcode/configuring-command-line-tools-settings)에
따라 `/usr/bin/cc` shim이 global 선택 링크를 다시 읽지 않고 같은 설치를 사용하게 한다.
기존 canonical project·다른 actor·설치본 write 권한은 추가하지 않는다. 실제 candidate fixture에는 다른
DEVELOPER_DIR을 입력하여 host가 관측한 선택이 우선하고 실제 native output까지 실행되는지 확인한다.

[WebKit macOS 원본 adc20e859d](https://github.com/WebKit/WebKit/blob/adc20e859dbd1652b5542788d3d641960dce85e5/Source/WebKit/WebProcess/com.apple.WebProcess.sb.in#L1351)의
`mach-bootstrap`/`apply-message-filter`와 message-number204·207·301·711·800·804를 별도 fixture에서
비교한다. 기존 production policy에 이 suffix만 추가하고 inherited ports·동일 Node/Git/compiler/DNS를
유지한다. 별도 fresh service의 실제 명령과 effect CID를 기록한다. compile/launch 실패도 보존하고
메시지 번호나 WebKit의 Apple 환경을 OMA 지원 근거로 승격하지 않는다. 제품 renderer와 실행 guard는
변경하지 않았다. actual Mac에서 일반 UID로 적용·정상 도구·service 차단이 함께 되는지는 **NOT_RUN**이다.
로컬 build·관련 parser/Worker/installation grammar/Seatbelt/recipe60/60 PASS·skip0와 전체 architecture 검사가
통과했다. 구조 자료를 갱신했고 과거 review의 재승인은 하지 않았다.

### 일곱 번째 실제 결과 — source `09c904b6cee`

Native [41779520021](https://github.com/minjung2035/oma-v2-ci/actions/runs/41779520021)의 양 Mac 공통
**289/289 PASS·skip0**, 독립 설치26/27 PASS다. candidate는 global developer link 오류를 지나갔으나
실제 `/usr/bin/cc`가 license 미동의 메시지·exit69를 반환했다. host Xcode의 동의 상태를 바꾸지 않았으며
이 메시지만으로 실제 미동의나 특정 denied file을 확정하지 않는다. quarantine과 기존 guard는 유지한다.

message filter suffix는 두 OS 각3회 모두 실제 `sandbox_init` EPERM·exit2였고 ports/report·Node/tools
실행에 도달하지 못했다. 이를 service 차단 성공으로 계산하지 않는다. 같은 revision의
[entitlement 처리](https://github.com/WebKit/WebKit/blob/adc20e859dbd1652b5542788d3d641960dce85e5/Source/WebKit/Scripts/process-entitlements.sh)는
`com.apple.private.security.message-filter`를 restricted 분기에서 추가한다. OMA는 이 entitlement를
추가하지 않았다. 이 후보는 현재 일반 권한 backend로 미채택이다.

입력15827개 `b809c26b4f15d884ee40c2962d44912a316425dd6ab67fa5bcf3a8c40d25cfbf`·runtime 산출물은
전후 동일하다. 각 gate111 OBSERVED /9 SETUP_FAILED /120 executed·productQualification BLOCKED다.
API SHA-256 대조 원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/bootstrap-filter/`다.
Mac26 gate ZIP `1e078902ad62a609a1eefa114660d32e96b0013f69ce90f57fa3994f9ea29d6f`,
Mac15 gate ZIP `bfd9eec93a715547dee631e01ae5ac48c870ecc0e9ce9a61438d695492ee9109`와
`observed-filter-summary.json`에 실제6회 EPERM을 보존했다.

### 여덟 번째 입력 — Xcode 상태의 좁은 read와 plain bootstrap deny

candidate·Worker의 개발 도구 정책에 `/Library/Preferences/com.apple.dt.Xcode.plist` 하나의 read만
추가하여 shim의 기존 machine license 상태 조회를 비교한다. 전체 Preferences·사용자 Xcode 설정·
write 권한은 추가하지 않는다. 실제 fixture는 host의 해당 file bytes SHA-256을 관측하고 child의 read와
대조하며, truncate 없는 r+ open의 거절과 실행 전후 같은 hash를 확인한다. license accept나 sudo를
호출하지 않는다. 이 파일이 이전 exit69의 원인인지는 실제 compile 대조 전 **추정**이다.

private message filter와 별도로 production policy에 `(deny mach-bootstrap)`만 붙인 대조를 추가한다.
같은 inherited ports·exact mach lookup·일반 Node/Git/compiler/DNS와 fresh service 두 개를 기록한다.
포트 제거의 DNS 반례나 private filtering EPERM과 다른 질문이며 실패를 성공으로 바꾸지 않는다.
이 입력의 actual Mac은 **NOT_RUN**, 제품 renderer·실행 guard는 유지한다.
전체 build·관련60/60·skip0·생성 candidate ES module 문법·전체 architecture 검사가 통과했다.
원시는 `/tmp/oma-macos-eighth-{final-build,final-focused,architecture}.log` 또는 `.tap`이다.

### 여덟 번째 실제 결과 — source `fdf08e7dca9`

Native [41780793085](https://github.com/minjung2035/oma-v2-ci/actions/runs/41780793085)의 첫 지원 대상
**macOS26 arm64/SDK26.5에서 candidate 각3회가 모두 OBSERVED**다. 실제 exact checkout·private gate
release1·status/gate FD 정리·lease FD9 identity 유지·canonical write 거절·자기 script·`/usr/bin/cc`의
native build와 그 output 실행을 완료했다. machine Xcode 상태 파일의 실제 read/hash·r+ open 거절·
실행 전후 같은 bytes도 확인했다. quarantine은 양 OS에서 계속 verify→import·refs/accepted bytes/cursor
보존을 완료했다. Mac26 gate114 OBSERVED /6 SETUP_FAILED, Mac15는111/9이며 두 제품 판정은 BLOCKED다.
Worker6건은 native launch guard로 남아 있다.

Mac15의 candidate는 license 오류를 지나 Xcode shim의 MobileDevice.framework 로드 거절·exit72에
도달했다. 이 framework의 정확한 물리 경로나 추가 허용이 충분한지는 미확정이다. Mac15 호환성 실패를
감추거나 일반 framework·Preferences grant로 확대하지 않았다. 양 Mac 공통289/289·skip0, packed26/27다.

plain `(deny mach-bootstrap)`는 양 OS 각3회 모두 init·정상 Node/Git/compiler/DNS를 통과했으나 두 fresh
service 호출도 exit0·**다른 coalition**의 actor 실행이었다. 따라서 이 규칙도 service admission closure의
해법으로 미채택이다. private message-filter EPERM·App Sandbox·port 제거의 결과와 구분한다.
입력15827개 `7c8bd2f784d767b2db6b125a52ed601aebcb807de48ae128e57c6629f26bb57f`·runtime 산출물은 전후 같다.
API SHA-256 대조 원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/plain-bootstrap-denial/`다.
Mac26 gate ZIP `452d7c580512eae9c0c0c107557894e06e6af6e1a31a123ff9fdefad77aeedbd`,
Mac15 gate ZIP `369b7e07bab531b068e153067a1cf2fcef18645a73cc972532a7bca1384050a3`와
`observed-denial-summary.json`에 실제 service/client CID·도구 결과를 보존했다.

여섯 번째 입력 `7c7a3da6acf`의 Architecture
[41778257974](https://github.com/minjung2035/oma-v2-ci/actions/runs/41778257974)도 SHA-256 대조했다.
all **4745/4745 PASS·skip0·errors[]**,13 command exit0·sourceChanges=[]다. fast1154·durable937·property42·
stress16·platform79도 모두 PASS·skip0·errors[]다. 원시는 `app-only/arch-*`이며 native-all ZIP
`43ab15d20be714c24ce55c6232ca325829bf965f505a9fc89eac0207aeefd272`, baseline ZIP
`ed3c64b20ba49c01c74546de14a07934d347f6cb63cb953c88b05a41572dfa3a`다. 이 과거 full을 새 입력의 결과로 쓰지 않는다.

### 아홉 번째 입력 — 의미가 제한된 bootstrap lookup 중개 실험

새 controlled C parent는 다른 프로세스의 메시지를 그대로 전달하지 않는다. 미리 정한 세 OS 서비스의
일반 lookup 요청에만 원래 bootstrap에서 새 lookup을 수행해 reply를 만들고 다른 routine/name을 거절한다.
parent의 원래 bootstrap과 child에 지정한 port를 구분하고, 기존 Seatbelt·inherited child·같은 도구/DNS·
독립 fresh service 효과와 실제 요청 trace를 비교한다. 새로운 root나 entitlement는 없다.

이는 [Chromium45의 private XPC signature](https://chromium.googlesource.com/chromium/src/+/refs/tags/45.0.2454.85/sandbox/mac/xpc_private_stubs.sig)를
사용한 **호환성 prototype**이다. 현재 SDK의 export와 로컬 arm64 object compile만 확인했으며 실제
Mac ABI·일반 후손의 정상 동작·service admission은 **NOT_RUN**이다. API 부재·startup 실패·timeout도
명시적으로 보존한다. source/executable/profile hash·실제 parent/child PID·kernel sender PID·요청별 결정·
WNOWAIT 뒤 alarm disarm과 직접 child join을 기록한다. 숫자 PID는 이 unreaped owned child의 fixture
정리에만 사용한다. per-request Mach reference 반환과 arbitrary-descendant death·role authority·headless는
미검증이며 product backend를 연결하지 않는다. canonical input·실행 guard·Linux backend는 유지한다.
로컬 arm64 SDK compile·Node fixture 문법·parser/Seatbelt41/41·skip0·전체 architecture 검사가 통과했다.
원시는 `/tmp/oma-macos-ninth-{sdk,parser,focused,architecture}.log` 또는 `.tap`이다.

### lookup 중개의 cleanup 판정 보강 — 실제 후속 실행 전

중개 parent의 private ABI 실패가 직접 child join 미확인을 감출 수 있는 경로를 수정했다.
command를 시작했다면 실패 status에서도 실제 terminal/join trace가 필요하다. 없으면 fixture 전체의
controlledGenerationsExited를 세우지 않고 cleanup 실패로 남긴다. 기존 validator는 실패 comparison의
unjoined trace를 허용하여 새 회귀가1 FAIL이었고, 수정 뒤 parser/Seatbelt41/41 PASS·skip0다.
private audit/reply 호출 전 실제 request trace도 먼저 기록한다. 로컬 SDK compile·Node 문법은 PASS다.
`dc65b4be010`의 실제 관측을 판독할 때도 join 없는 결과를 완료로 사용하지 않는다. 제품 backend와
실행 guard는 그대로다. 원시는 `/tmp/oma-macos-proxy-join-{red,green}.tap`·`-sdk.log`다.

### lookup 중개의 첫 실제 결과 — source `dc65b4be010`

Native [41782596947](https://github.com/minjung2035/oma-v2-ci/actions/runs/41782596947)의 두 OS 각3회에서
C compile·private symbol 취득·host lookup0·proxy receive right·실제 child spawn0·parent port 복구0을
확인했다. 그러나 private `xpc_pipe_receive`가 매번5를 반환했고 child의 pre-exec report와 Node/tools는
없었다. 각30초의 owned-child deadline은 SIGKILL·waitStatus9·WNOWAIT 뒤 join으로 끝났다.
**이 결과는 서비스 권한 차단이나 도구 호환 성공이 아니다.** proxy comparison은 모두 SETUP_FAILED다.
이6회는 실제 terminal/join이 있으므로 후속 cleanup 보강의 unknown 경로에는 해당하지 않는다.

Mac26의 기존 candidate3회·양 OS quarantine3회는 계속 완료했다. gate는 Mac26 114/120·Mac15 111/120
OBSERVED, 제품 BLOCKED다. 입력15828개 `e27bd52a4947689d40df94ae22ddb89ff535f6d7f523c79c69ef28f6921c78db`와
runtime 산출물은 양 Mac 전후 동일하다. API SHA-256 대조 원시는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/lookup-proxy/`다. Mac26 gate ZIP
`d91dd500f2b6ffb5463d697753956feb244e4cf9681edc191e6c7dc492e144da`, Mac15 gate ZIP
`81ee366e31a2b241317b38e0880a8d4ae6011cf551eec6ae373c4505327f615e`와
`observed-proxy-summary.json`에 raw status·별도 parent/child PID·timeout/join을 보존했다.

### 다음 입력 — Mach 수신 종류와 decoder 경계

public `mach_port_peek`로 수신 전 실제 message ID·size·kernel audit sender PID를 기록한다.
[고정 XNU 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/mach_port.c)은
own receive right의 queue 관측과 trailer byte 크기를 설명한다. historical bootstrap MIG400대만 별도
receive·명시적 error reply로 거절하고 다른 ID는 기록한 뒤 기존 private decoder에 넘긴다.
초기5가 legacy 메시지 때문인지는 아직 **추정**이며 XPC 전체 wire classifier로 주장하지 않는다.
새 polling receiver는 stop 뒤 thread join을 끝내고 receive right를 반납하여 close/peek race를 피한다.
로컬 arm64 SDK compile은 PASS이고 실제 Mac 수신/초기화·Node/tools·fresh service 결과는 NOT_RUN이다.
제품 backend·policy renderer·실행 guard·Linux 경로는 그대로다. raw local compile은
`/tmp/oma-macos-proxy-mig-sdk.log`다.

### Mach peek의 실제 결과 — source `c719bd4a6ac`

Native [41784130833](https://github.com/minjung2035/oma-v2-ci/actions/runs/41784130833)의 두 OS 각3회에서
첫 queued message는 모두 **ID0x400000cf·236 bytes·실제 child PID의 audit trailer**였다.
queue에 메시지가 있는데도 private decoder는5를 반환했다. historical400대 MIG 분기는 실행되지 않았다.
모두30초 뒤 SIGKILL·실제 join이며 child pre-exec/Node/tools 미도달이다. 오류5를 단순한 empty queue나
400대 legacy message 때문이라고 확정할 수 없다. 기능·서비스 차단 성공으로 채택하지 않는다.

입력15828개 `fa88d6edfb8b7710f0373f44e3058a547ba074fe3107e923e0c2d19adef1491b`·runtime 산출물은 양 Mac
전후 동일하다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED, product BLOCKED다.
API SHA-256 대조 원시는 `lookup-proxy/mach-peek/`다. Mac26 gate ZIP
`386346faf81e07f97fa74761beb77e230b31cbe5490c84ba7f155e8207a8aac1`, Mac15 gate ZIP
`0ce2dcf2d8ca3aafbe1f69a1c4b2e37caea7646487bd1721241ae375f187ed69`와
`observed-mach-peek-summary.json`에6회 header·별도 decode 실패·join을 보존했다.

### 다음 입력 — 관측한 interface ID에 대한 제한된 port reply

opaque libxpc 객체 decoder를 빼고 public Mach receive/send와 SDK의 제안된 port/MIG error reply를
직접 대조한다. `0x400000cf` 요청 body에 고정 세 서비스의 정확한 NUL-terminated 이름이 하나 있다면
원래 bootstrap에서 그 서비스만 새로 lookup한다. 다른 body field는 사용하거나 전달하지 않는다.
임의 body도 허용된 고정 port 이외의 lookup·bootstrap port·host 제어를 얻지 못하며 원래 bootstrap과
proxy port는 반환하지 않는다. reply는 해당 ID·send-once 채널에만 생성하고 다른 요청은 폐기한다.

이름 scan은 현재 wire layout 전체를 검증하는 parser가 아니다. 권한은 고정 세 endpoint로 제한하지만
client가 제안된 reply를 정상 수용하는지는 **NOT_RUN**이다. `privateAbi=true`는 미공개 wire ABI의
한계이며 private libxpc function을 사용했다는 주장이 아니다. parent/child·namespace·같은 profile·
일반 도구/DNS·fresh service·실제 요청/반환 길이·join을 기록한다. 전체 backend·role·headless·reference
handoff 증명으로 승격하지 않는다. 새 로컬 SDK compile·Node 문법·parser/Seatbelt41/41·skip0와
전체 architecture 검사는 PASS다. 원시는 `/tmp/oma-macos-proxy-raw-{sdk,focused,architecture}.log` 또는
`.tap`이며 제품 guard와 기존 Linux 경로는 그대로다.

### 제한된 port reply의 실제 결과 — source `c8a69786e22`

Native [41786561812](https://github.com/minjung2035/oma-v2-ci/actions/runs/41786561812)의 두 OS 각3회에서
proxy child의 실제 pre-exec Seatbelt report·Node 쓰기·canary EPERM·Git hash·compiler·일반 C/Node DNS를
확인했다. 모두 child exit0·waitStatus0·timedOut=false·joined=true다. 고정 logd 이름 요청의52-byte reply
전송은 성공했다. 이 전송 성공만으로 client가 받은 port의 전체 의미나 private wire ABI를 검증한 것은 아니다.
다른 interface 요청은 전달하지 않았다. fresh service와 global bootstrap 복구 뒤 다른 fresh service의
launchctl은 모두 exit5·numeric deadline cleanup 없음·guestEffect=null이었다. 정상 도구와 이 두 service
반례를 함께 보존한 첫 제한된 후보이며, 모든 service admission과 arbitrary-descendant 종료 증명은 아니다.

입력15828개 `b8ba93b9ecffb2141e1cc90e5320b6e6a50b4f2c7980bbff2c42624c514fbdeb`와 runtime 산출물은
양 OS 전후 동일하다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED이며 product BLOCKED다.
SHA-256 확인한 원시는 `lookup-proxy/raw-reply/`다. Mac26 ZIP
`00b3de1d7c788640cc6ef77de6eeb41e593b23cc55ff4211c04a01b90b9686d1`, Mac15 ZIP
`c32f95ae184b6c64f6fc5cef266b5c6b0d246b0f2a759dca5468772450ce85c1`이다.

마지막 제품 TS 변경 `fdf08e7dca9`의 Architecture
[41780793092](https://github.com/minjung2035/oma-v2-ci/actions/runs/41780793092) native-all도 SHA-256 대조했다.
all4745/4745 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges=[]다. 원시 ZIP
`2674c9f581fe693742c972d7c0ea735c93efa89538b066f547baf97e24bf567c`는 위 경로의
`art-13300608008/all/result.json`이다. 이 과거 full을 현재 입력의 결과로 바꾸지 않는다.

### 다음 입력 — lookup 중개와 owner-loss·late-fork의 조합

launchd의 별도 job이 proxy를 시작하고 같은 renderer의 좁은 profile을 실제 적용한 뒤 controlled actor를
exec한다. fork·setsid·double-fork·FD 폐쇄 후 job을 제거하고 살아 있는 후손의 late fork를 관측한다.
새 controller는 기존 kernel task-name token 취득과 generation/CID 상관 확인만 사용한다. 첫 PID hint
snapshot 뒤 태어난 후손도 다음 round에서 처리하고 CID 조회를 독립 live CID와 함께 보존한다.
profile 재적용은 하지 않는다. marker/PID는 조정·검색 힌트이며 role·죽음의 권한이 아니다.
시작 후 후손 종료를 확인하지 못하면 전체 cleanup 완료를 거절한다. 이 추가 조합은 **NOT_RUN**이며
제품 backend·gate·headless 지원 판정을 바꾸지 않는다.

### 중개와 owner-loss 조합의 실제 결과 — source `8a5ea22b389`

Native [41787983283](https://github.com/minjung2035/oma-v2-ci/actions/runs/41787983283)의 양 OS 각3회에서
launchd proxy job·실제 sandbox_init·fork/setsid/double-fork/FD 폐쇄를 조합했다. job 제거 뒤 late fork와
첫 hint snapshot 뒤 fork도 같은 CID였다. fresh controller의 kernel token·generation 상관 확인 뒤
대상 제어는 성공했고 다른 CID는 correlated=false·signalStatus=-1이었다. 각2 round 뒤 대상 CID는
ESRCH였고 별도 live CID는 조회0이었다. service child는 waitStatus1280(exit5)·실제 join·deadline cleanup
없음·guestEffect=null이었다. fixture release 전에 관측한 결과이며 완전한 제품 recovery·admission 증명은 아니다.

입력15828개 `bfabcf9ae313b41bd3df735976f8dd163bce60701f42e79dc1ee9e4566e4dd75`와 runtime은 양 OS
전후 동일했다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED·product BLOCKED다. SHA-256 확인한
`lookup-proxy/lifetime/`의 Mac26 ZIP은 `856a7534c9d08df1b94c17eb2761364463782ebc277e1065b5954f859cb21f7b`,
Mac15 ZIP은 `4713dd904e2cc627235e5679d23fc84af4cdc39ff9a9fff065f9702fc65fa49a`다.
`observed-lifetime-summary.json`은6회 CID·fresh 제어·독립 조회와 실제 종료 관측을 요약한다.

### 다음 입력 — deny-all bootstrap과 명시적인 Background 조건

같은 non-null bootstrap endpoint와 receiver에서 모든 lookup을 거절하는 별도 대조를 추가했다.
기존 정상 도구·일반 C/Node DNS·서로 다른 두 fresh service와 실제 child join을 그대로 관측한다.
호환성이 고정 OS port 반환에 의존하는지 분리하는 실험이며 **NOT_RUN**이다. 반환 port 없는 방식도
호환된다면 이름 scan·port 반환 의존성을 줄일 후보가 된다. 현재 wire 의미를 확정한 해법으로 쓰지 않는다.

기존 default user-domain 실패와 달리 `LimitLoadToSessionType=Background`·SessionCreate를 명시한
ordinary-UID job을 별도로 준비했다. [고정 Apple man 원문](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/man/launchd.plist.5)은
session 조건의 의미를 설명하지만 현재 OS 성공을 보장하지 않는다. 실제 UID·kernel audit session·CID·
실행/cleanup을 보존하고 GUI 부재를 입증하지 않은 결과는 guiAbsent=false로 남긴다. actual 실행은
**NOT_RUN**이다. parser/Seatbelt42/42·skip0·C 두 image의 arm64 SDK object compile은 PASS다.
실행 guard·journal 형식·Linux backend는 유지한다.

### deny-all·Background의 실제 결과 — source `5d2951c8a62`

Native [41788772347](https://github.com/minjung2035/oma-v2-ci/actions/runs/41788772347)의 두 OS 각3회에서
deny-all은 selected request0·반환 OS port0으로 Node·Git·compiler·일반 C/Node DNS를 보존했다.
child는 모두 exit0·waitStatus0·실제 join·timeout 없음이었다. fresh service와 global 복구 뒤의 다른
service는 모두 exit5·effect=null이었다. 정상 도구 보존이 고정 logd port 반환을 필요로 한다는
가정은 이 대조에서 지지되지 않았다. 모든 Mach message 거절·dead port 방식이나 전체 admission은 미검증이다.

명시적인 Background user/501 job도 양 OS 각3회 실제 UID501·audit token count8·별도 audit session·
40-byte coalition 결과로 실행됐다. root·entitlement·GUI job 사용은 추가하지 않았다. 이 조건의 성공을
이전 default user-domain 성공이나 GUI 없는 머신의 qualification으로 바꾸지 않는다.

입력15828개 `e4e5c848084e3861527fddc76f05711519827724096137a76132df2e343fddc8`와 runtime은 양 OS
전후 동일했다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED·product BLOCKED다. SHA-256 대조 원시는
`lookup-proxy/deny-all/`이며 Mac26 ZIP `5ed38c3be5cf010433ae13270dab4a98125496fd28ff7427c0861fbbab7298ca`,
Mac15 ZIP `76b2b41309660e621b19d250944da473db2f4d3a84c66783b330406a3ff739ad`다.

### 다음 입력 — 실제 production coalition leaf의 교체·검증

`@oma/native/audit-session`에서 PID count를 byte로 읽던 enumeration·32-byte CID·합성 audit token·
scan→empty 구현을 제거했다. 새 좁은 leaf는 kernel boot UUID·40-byte CID·coalition ID 조회와 genuine
task-name token을 사용한다. ID 조회가 성공하면 task count가 같아도 populated이며 ESRCH나 긍정적인
다른 boot만 empty다. scan은 bounded hint만 제공하며 각 효과 전에 generation/CID/kernel token을
상관 확인한다. controller 자신의 CID 제어는 거절하고 task-name right를 반환한다.

기존 boot 결박 없는 Darwin journal witness는 App에서 unavailable/복구 거절로 남긴다. 저장 witness를
fresh identity로 echo하던 경로를 제거했으며 기존 journal bytes·형식을 변경하지 않는다. 새 transient
identity는 아직 durable producer나 complete backend에 연결하지 않았다.

동일 launchd/proxy/late-fork fixture의 controller를 새 Node executable의 production leaf로 바꾸고
C reference의 CID 조회·독립 live CID를 유지했다. loaded job의 equal task counter 대조도 보존한다.
실제 Mac은 **NOT_RUN**이다. 로컬 build·관련 native/process/parser/policy58/58·skip0는 PASS다.
원시는 `/tmp/oma-macos-coalition-leaf-{build,focused}.log` 또는 `.tap`이며 Linux backend·제품 launch guard는 유지한다.
전체 architecture 검사도 PASS다. 기본 evidence refresh는 삭제된 역사 review 경로 때문에 거절됐으며,
기존 `--invalidate-stale` 모드로 authored notes를 보존하고 새 승인을 만들지 않은 장부를 생성했다.
현재31 CHANGED_WITHOUT_ORACLE·14337 NOT_REVIEWED·220 REMOVED이며 review closure 완료가 아니다.

### production leaf의 실제 결과 — source `9c14a735349`

Native [41790468826](https://github.com/minjung2035/oma-v2-ci/actions/runs/41790468826)의 양 OS 각3회에서
실제 새 Node process가 production leaf를 호출했다. kernel boot UUID/CID 취득·wrong-member false·
정확한 member signal true·post-snapshot fork의 다음 hint/control round를 확인했다. 매번2 round 뒤
leaf는 empty, 독립 C reference는 CID ESRCH였고 별도 live CID 조회는0이었다. loaded positive job은
실제 started=2/exited=2인데도 ID 조회0이었으며 leaf는 여섯 번 모두 populated를 보존했다.
이 결과는 narrow primitive의 조합이다. journal producer·실제 제품 owner crash/recovery·모든 admission을
증명하지 않으며, boot 결박 없는 legacy witness의 unavailable/거절과 제품 launch guard는 유지한다.

입력15829개 `dcc98f3961d855b8903031d4aa57805bdfc793db730f0880bb8db411fe07067c`와 runtime은 양 OS
전후 동일했다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED·product BLOCKED다. SHA-256 확인한
`lookup-proxy/native-leaf/`의 Mac26 ZIP은 `2cda0bd0fa3ab1d36710eebeb5f14e5bca3c85b0c3bdc75c175b932b52cbaef1`,
Mac15 ZIP은 `3183915e1b24e2a993eb1fe111209b9f055cdd409b5427aae354e052643a92ae`다.
`observed-native-leaf-summary.json`은6회 실제 identity·fresh Node control·paired query를 요약한다.

### 다음 입력 — public lookup 수용·전체 요청 폐기·Background 조합

public `bootstrap_look_up` client가 실제 port/right를 얻었는지 별도 C 호출로 기록한다. 송신52-byte 성공이나
일반 도구 실행을 client 수용으로 간주하지 않는다. 같은 caller에서 HOST_LAUNCHCTL_PORT 취득 결과와
참조 반납도 기록한다. 이 read-only 권한 관측은 실제 service 실행 성공/실패와 구분한다.

추가 drop-all receiver는 모든 message를 SDK destructor로 폐기하며 새 reply·lookup·port 반환을 하지 않는다.
동일 도구/DNS·fresh service 두 경로·실제 child join과 비교한다. 성공하면 wire ID·이름 scan 없이
non-null endpoint만으로 호환되는지 좁힐 수 있지만 현재는 **NOT_RUN**이다.
기존 production-leaf lifetime job은 user/UID·Background·SessionCreate 조건으로 옮겨 audit session이
다른 fresh controller의 제어를 대조한다. GUI 부재·제품 headless 지원이나 complete backend를 뜻하지 않는다.
로컬 C 두 image의 arm64 SDK object compile·Node 문법·parser/Seatbelt42/42·skip0가 통과했다.

### public lookup·drop-all·Background 조합의 실제 결과 — source `c54ca8cbfa9`

Native [41791642317](https://github.com/minjung2035/oma-v2-ci/actions/runs/41791642317)의 두 OS 각3회에서
실제 public lookup은 inherited baseline에서0·SEND right·정상 반납이었으나 제안된52-byte proxy reply에서는
5·port0이었다. deny-all·drop-all도5·port0이었다. **52-byte reply의 client 수용은 확인되지 않았으며 port
중개 구현으로 채택하지 않는다.** 일반 도구/DNS 성공을 lookup 성공으로 계산하지 않는다.
HOST_LAUNCHCTL_PORT 취득은 baseline/proxy/deny/drop 모두 status4·port0이었고 host right 반납은0이었다.
이 한 API 대조를 모든 권한 재취득 경로의 폐쇄로 일반화하지 않는다.

모든 요청을 폐기한 drop-all은 실제 replyBytes0·선택/반환 port0으로 Node·Git·compiler·일반 C/Node DNS와
exit0·실제 join·timeout 없음을 보존했다. fresh service 두 경로는 모두 exit5·effect=null이었다.
production leaf의 lifetime job을 user/501·Background·SessionCreate로 옮긴 조합도 양 OS 각3회 모두
late/post-snapshot fork 제어와 독립 CID ESRCH·다른 live CID 조회0을 보존했다. GUI 부재·실제품 recovery는
아직 미검증이며 제품 backend와 guard를 바꾸지 않는다.

입력15829개 `0568d0555683ee0df9914ac1c392eb335ad5127e9cdc2e4dfcfd962542bf4ac6`와 runtime은 양 OS
전후 동일했다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED·product BLOCKED다. SHA-256 확인한
`lookup-proxy/drop-all/`의 Mac26 ZIP은 `e6c0da73da7e9130a5c0b62ead4b1e8ed282e791ba3d5580aedf8e965cab1ff2`,
Mac15 ZIP은 `0a44786d8fd9daee891efe470800e108b122b8da727a7d760afa828911c18963`이다.

### 다음 입력 — LaunchOnlyOnce와 label 없는 CID 반환 관측

Background·SessionCreate의 별도 controlled once job에만 LaunchOnlyOnce를 추가한다. 고정
[Apple source](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/src/core.c#L6066)의
job_useless는 시작한 only-once job의 종료를 제거 조건으로 사용한다. 현재 OS에서는 **NOT_RUN**이다.
실제 actor 종료 후 explicit bootout 없이 CID/독립 live CID·production leaf를 조회하고 print/restart 결과를
별도 기록한다. CLI113은 fixture registration 정리 관측에만 사용하며 scope 죽음은 kernel 조회로 구분한다.
이 옵션이 실제 CID를 반납하면 저장 label을 신호 권한으로 삼지 않는 조합의 다음 후보가 된다.
성공 전 제품 constructor·journal 형식·scope 판정을 변경하지 않는다.

### LaunchOnlyOnce의 실제 결과 — source `b61f2011b04`

Native [41794135599](https://github.com/minjung2035/oma-v2-ci/actions/runs/41794135599)의 양 OS 각3회에서
Background/SessionCreate/LaunchOnlyOnce controlled actor 종료 뒤 explicit bootout 없이 CID ESRCH·별도
live CID 조회0을 확인했다. production leaf는 모두 empty였고 print/restart는 모두113이었다.
이것은 once program의 실제 제거 관측이다. detached 후손·owner SIGKILL·label 재사용과의 조합은 다음 입력이며
stored label을 복구 신호 권한으로 사용하는 producer를 만들지 않는다.

입력15829개 `11636e71e4b180701d5f3bb5bf680cef7ddee08c11dfa879e61820c39b7c6b07`와 runtime은 양 OS
전후 동일했다. gate는 Mac26 114/120·Mac15 111/120 OBSERVED·product BLOCKED다. SHA-256 확인한
`one-shot/`의 Mac26 ZIP은 `be21ffeef11fe907eb63b2286e05ba94b93a7b6799e52029becc7c4359d03cd9`,
Mac15 ZIP은 `50ef4b0cf1eb17274de956a58a4534a902b324353a022e550c565cb53c155fcf`다.

### 다음 입력 — native discard receiver·one-shot owner loss·label 재사용

`@oma/native/mach-message`에 reply/forwarding/이름 해석 없이 받은 message를 SDK destructor로 반환하는
discard service leaf를 추가했다. [고정 XNU copyout](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/ipc_kmsg.c#L4240)의
BODY_ERROR도 전달된 자원을 반환하고 endpoint를 닫는다. oversized/기타 오류 역시 endpoint 종료와 오류로
남긴다. 이 함수는 sender·role·scope death를 부여하지 않는다. 실제 Node host가 endpoint를 소유하고
별도 C supervisor가 그 send right만 fresh child에 지정하는 비동기 대조를 추가했다. Host의 bootstrap은
바꾸지 않는다. source/executable/runtime binding·정상 도구·DNS·fresh service·unreaped-child join을 보존한다.

lifetime job에는 LaunchOnlyOnce를 조합하고 bootout 대신 fresh kernel token으로 실제 proxy owner를
종료한다. late/post-snapshot fork 제어 후 CID를 확인하고, 동일 label의 새 controlled live job을 등록해
옛 boot/CID의 population/effect가 새 generation을 제어하지 않는지 조회한다. 원래 scope의 커널 조회와
새 live PID의 정확한 generation 관측을 registration 진단과 분리한다.

fixture supervisor의 deadline용 SIGALRM mask가 target에 상속되던 설정도 수정했다. spawn attribute로
원래 mask를 복원하고 C client의 실제 mask bit를 별도 기록한다. 이 입력의 actual Mac은 **NOT_RUN**이며
제품 backend·legacy journal 거절·실행 guard는 유지한다. 로컬 C 두 image의 SDK object compile과
Node 문법·parser/Seatbelt43/43·skip0는 PASS다.

병합 전 경계 테스트 강화 수정본의 Linux 전체 테스트는 **4,732 PASS / 0 FAIL / 0 SKIP / 0 cancel / 0 todo**였다. 경계 테스트 85개와 catalog frame 계산·hardlink/unlink 재검증 수정을 포함한다. 기존 시간 민감 검색 시험은 시간 값·완료 단언을 유지한 채 단독 실행으로 격리했다. 세부 판정과 범위는 [재감사 보고서](../module-reaudit-2026-11-04.md)에 기록한다. 이 Linux 결과는 macOS 지원·실제 외부 모델 qualification·실서비스 cutover 완료를 뜻하지 않는다. 과거 작업자의 부분 PASS와 재개 지시는 [보관 원문](../archive/cleanup-2026-11-03/implementation/validation.md)에 분리했다.

## macOS 브랜치 병합 검증

`work/model-surface-cleanup`의 `9de6ee91`에 macOS 브랜치 `88abfea5`를 병합했다. Linux의 동일한 EAGAIN 재시도 구현과 전용 contained-open 회귀를 유지하고, Darwin bootstrap 관측·검증과 exact Unix socket·root alias 처리를 통합한다. 중복된 owned-cleanup EAGAIN 사례는 기존 native 전용 시험으로 유지하며 새 구현이나 중복 시험을 추가하지 않는다. macOS 브랜치의 [검증 원문](../archive/macos-native-2026-11-04/implementation/validation.md)은 당시 입력의 기록으로 별도 보존한다.

**병합 커밋 `7f5ceee5`의 Linux 전체 실행은 4,733 PASS / 0 FAIL / 0 SKIP / 0 cancel / 0 todo다.** Node 26.0.0·UID 1000·delegated user scope·실제 pinned bwrap 0.12.0의 private overlay에서 repository `scripts/test-local.mjs`를 수정 없이 실행했다. 기본 동시성 4, 전체 556개 파일, 단독 3개/44 PASS와 병렬 553개/4,689 PASS이며 native 필수 6개 파일도 포함한다. 실행·입력 재확인 시간은 **1201.806초**다(2026-11-04 10:24:42–10:44:44 KST).

실행 전후 **15,825개 검증 입력의 bytes가 동일**하고 changed=[]다. 고정 입력 digest는 `29cca543e96b38a8dc30049ef64c7d157a69eac5997397d48ea758bab968e17f`다. 원시는 `/tmp/oma-macos-merged-linux-20261104/`의 `full-run.json`, `full.log`, `before-inputs.json`, `after-inputs.json`, `summary-serial.tap`, `summary-parallel.tap`에 보존한다. 성공한 runner가 원래대로 정리하는 TAP은 외부 검증 harness가 열린 read FD로 보존했으며, runner·테스트 선택·시간 제한·단언을 변경하지 않았다. 이 결과 문단은 실행 후 보고 출력이다. 아래 현재 구조 binding은 출력 이후 identity로서 고정 입력의 runtime digest와 구분한다.

빌드·타입 검사, 관련 선택 실행 **302 PASS**, 실제 위임 cgroup·pinned bwrap 사전 실행 **3 PASS**, module/architecture·transaction·durable boundary·문서·명세 inventory 검사도 통과했다. 원시는 `/tmp/oma-macos-merge-actual-{build,typecheck,architecture}.log`, `/tmp/oma-macos-merge-actual-focused.tap`, `/tmp/oma-macos-merge-cgroup-preflight.tap`에 있다. 보관한 macOS 기록 3개의 SHA-256도 원문과 일치한다.

실제 Darwin 실행은 **NOT_RUN**이며 `launchBlockedDarwin()`은 native launch-data channel 부재로 여전히 **UNIMPLEMENTED**다. G-PROCESS·G-FILES·G-AUTH와 fresh Society admission closure를 유지한다. Linux 결과를 macOS 지원·외부 provider qualification·실서비스 cutover 완료로 확대하지 않는다.

## 추가 경계 테스트의 최종 전체 검증

7개 영역에 85개 사례를 추가했다. 새 사례와 기존 관련 시험의 집중 실행은 **164 PASS**, 시간 민감 검색·실제 runner 격리 검증은 별도 **42 PASS**다. 설정 write/load·바이트 상한의 -1/정확/+1·실제 UI socket·FD/inode 변경·SIGKILL·journal flush 실패·committed tool metadata 교체를 검사한다. 개별 파일과 실제 실행/통제 fixture 구분은 [경계 테스트 목록](../module-reaudit-2026-11-04.md#추가-요청--경계-테스트-강화)을 따른다.

최종 전체 실행은 repository `scripts/test-local.mjs`로 **556개 파일** 전부를 실행했다. Node 26.0.0·delegated user scope·실제 pinned bwrap overlay를 사용했고 native 필수 6개 파일도 포함한다. 실제 시간을 측정하는 3개 파일의 단독 44 PASS, 나머지 553개 파일의 concurrency 4 병렬 4,688 PASS를 합해 **4,732 PASS**다. 실패·skip·cancel·todo는 모두 0이며, 전체 시간은 입력 hash 검증을 포함해 **1151.775초**다(2026-11-04 06:33:14–06:52:26 KST).

실행 전후 **15,823개 검증 입력의 bytes가 모두 동일**했고 changed=[]다. 고정 입력 digest는 `386a557f280e7fe3adff5a111ea910d7f08b10b8a27014656543012fe7687dfd`다. `/tmp/oma-boundary-tests-2026-11-04/full-4-run.json`, `full-4.log`, `full-4-before-inputs.json`, `full-4-after-inputs.json`, `final-summary.json`에 원시 결과와 지도를 보존한다. 전체 실행 뒤의 변경은 이 validation과 재감사 보고서의 결과 출력뿐이다. 아래 현재 구조 binding은 보고 출력 이후의 identity이며 이 고정 입력 runtime proof와 구분한다.

이전 실행을 지우거나 통과로 소급하지 않았다. 첫 실행은 추가 inode 조건 분기의 결함을 확인해 테스트 소유 scope만 중단했다(ABORTED_SUPERSEDED). 이후 완료한 두 전체 실행은 각각 4,731 PASS / 1 FAIL이었다. 하나는 기존 native journal 초기화의 EAGAIN으로 목표 SIGKILL에 이르지 못한 실패였고, 다음은 기존 sparse-progress 시간 시험이었다. 상세 원인 범위와 `full-1-aborted-run.json`, `full-2-failed-run.json`, `full-3-failed-run.json`은 재감사 보고서에 기록한다. native의 재시도 한도·실패 시 거부를 변경하지 않았고, 검색 시험의 300ms/400ms 값·모든 단언·필수 파일도 유지했다. 최종 실행에서는 두 사례 모두 실제로 통과했다.

빌드·타입·패키지·module/architecture·transaction·durable boundary·문서·명세 inventory 검사도 통과했다. 근거는 같은 디렉터리의 `build-isolation.log`, `typecheck-isolation.log`, `focused-complete.tap`, `timing-isolated.tap`, `architecture-isolation.log`다. 이번 작업은 Mac 실기기 검증이나 외부 provider qualification을 추가로 실행한 결과가 아니다.

## 2026-11-04 재감사 수정본 최종 검증

사용자가 제공한 과거 보고서의 50개 ID(철회·보류 포함)를 현재 코드와 대조하고, 남아 있던 결함과 인접 경계의 추가 결함을 수정했다. 앱과 26개 패키지의 authored production 587개 파일을 정적으로 분류하고 주요 입력·권한·publication·복구·자원 수명 경계를 수동 검토했다. 모든 파일의 모든 줄을 수동 검토한 전수감사 완료 주장은 아니다. 개별 근거·통제 fixture·실제 SDK/Unix socket/Git/FS/native 실행의 차이는 재감사 보고서에 명시한다.

최종 전체 실행은 unmodified `scripts/test-local.mjs`로 555개 파일(선행 단독 2개, 병렬 553개·concurrency 4)을 실행했다. Node 26.0.0, delegated user scope, 실제 pinned bwrap overlay를 사용했다. 단독 14 PASS와 병렬 4,633 PASS를 합친 **4,647 PASS**, 실패·skip·cancel·todo는 모두 0이며 테스트 실행 시간은 **1174.305초**다. 실행은 2026-11-04 03:33:59–03:53:33 KST였다.

실행 전후 **15,822개 검증 입력의 모든 bytes가 동일**했고 changed=[]다. 해당 고정 입력의 SHA-256은 `447603abcf1856f6cf097d9fa0bf60c078e15c04a2a7430af6f89217fec27089`다. `/tmp/oma-reaudit-2026-11-04/full-3-run.json`, `full-3.log`, `full-3-before-inputs.json`, `full-3-after-inputs.json`, `final-linux-summary.json`에 결과와 입력 지도를 보존했다. 이 문단과 재감사 보고서는 전체 실행 뒤 갱신한 결과 출력이다. 아래 구조 binding은 결과 문서 갱신 뒤 현재 identity이며, 고정 입력으로 수행한 runtime 검증의 digest를 대체하지 않는다.

최종 수정 전의 두 번째 전체 실행도 4,646 PASS였으나, 그동안 별도로 확인한 MCP timeout 버그의 수정 이후 결과로 소급하지 않았다. 새 MCP 회귀를 추가한 최종 실행에서 실제 SDK 정상 연결과 설정/runtime overflow 거부를 포함해 다시 통과했다. 관련 MCP 선택 실행은 26 PASS / 0 FAIL / 0 SKIP다. 빌드·타입 검사·static package·vendor bundle·모듈/구조·transaction·durable boundary·문서·명세 inventory 검사도 통과했다. 세부 로그는 같은 디렉터리의 `build-mcp-timer.log`, `typecheck-mcp-timer.log`, `package-mcp-timer.log`, `mcp-timer-final.tap`, `mcp-timer-vendor-check.log`, `architecture-mcp-timer.log`다.

macOS launch-data channel 실행은 UNIMPLEMENTED이고 실제 Mac의 native 실행·인증·flush·제품 전체 검증은 NOT_RUN/UNVERIFIED다. fresh Society admission closure와 외부 모델 A/B/C·cutover gate는 유지한다. 이 재감사에서는 사용자의 Codex OAuth 토큰·자격 증명 파일을 열거나 변경하지 않았다.

## 기본 실행 재확인 — 신규 Society 기동 거절

사용자는 Worker 구성·분담·실행 흐름의 **제품 기본값**을 요구했다. 기본 initial Residents는 `worker-1`, `worker-2`, `worker-3`이며, 공통 brief에 따라 GOAL을 읽고 서로 소통하여 역할을 자율 분담한다. 앞선 단일 Worker fixture와 직접 명명·역할 배정·wave activation을 수행한 3-Worker fixture는 이 기본 실행을 검증한 결과가 아니다.

별도 작은 프로젝트에서 Worker/role/scheduler override나 birth 준비 없이 실제 `apps/oma/dist/entry/oma.js`를 **인자 없이 실행**했다. 상태·run의 XDG 경로만 격리했다. 결과는 **exit 4**, `collaboration-v1 fresh admission is not qualified; no Society birth or new execution was created`다. `society-bootstrap.ts`의 기존 fresh-admission closure가 SDK/Worker 실행 전에 거절했다. 따라서 **기본 신규 실행은 미완료/기동 거절**이며 모델 inference나 기본 Worker 협업 성공으로 기록하지 않는다. 실행 근거는 `/tmp/oma-live-default/default-cli.log`와 `result.json`이다.

참고로 직전 custom 3-Worker 실행은 `/tmp/oma-live-terra-luna-multi/result.json`에 **302.618초 / 작업 테스트 22 PASS / 독립 계약 검사 11 PASS / 3개 actor의 applied LOW integration 및 실제 peer mail**로 남아 있다. 네 actor의 실제 요청 모델·medium journal을 확인했고 종료했다. 이 PASS는 **격리 fixture의 결과**이며 기본 startup, 자동 scheduling, fresh admission, held-out A/B/C qualification의 대체물이 아니다. 기본 실행을 요구받은 뒤 같은 fixture를 다시 구성하거나 gate를 열지 않았다.

## 실제 외부 모델 단일 협업 실행 — 2026-11-04 KST

요청한 **Principal `gpt-6.1-terra` / Worker `gpt-6-luna`, 양쪽 `medium`**으로 실제 Codex OAuth provider와 native Linux Worker를 실행했다. SDK journal에서 모델과 thinking level을 각각 확인했다. OAuth 값은 도구 출력이나 모델 문맥에 노출하지 않았으며, 원본 credential을 수정하거나 격리 상태에 복사하지 않았다. 임시 SDK command resolver가 런타임의 private pipe로만 인증값을 전달했다. 이것은 제품의 새 credential 기능 구현이 아니다.

작업은 별도 작은 Git 프로젝트의 `normalizeTags` 구현과 `node:test`였다. Principal의 실제 `oma_send` → Worker 구현·commit·`oma_merge` LOW → broker publication/integration → 실제 보고 전달 → Principal의 applied source 확인을 실행했다. 성공한 재실행의 협업 시간은 **122.591초**이며 준비·문제 수정 시간은 제외한다. canonical main은 `2224fbd3f174bf94ebabe5314ee24ab5397d6b92`다. 독립 clone의 **7 tests / 7 PASS / 0 FAIL / 0 SKIP**와 별도 입력·Unicode·중복·TypeError 계약 검사 12개가 통과했다. accepted operation 7개는 모두 succeeded이며 submit, review preparation, integrate와 실제 mail을 포함한다.

첫 실행은 137.084초 뒤 독립 검증에서 실패했다. Worker는 올바른 구현과 7개 테스트를 commit했지만 `oma_merge`에 full hash를 잘못 옮겨 적었다. 원본 main은 그대로였으며 Principal도 완료를 주장하지 않았다. 로컬에 없는 candidate를 ancestry 관측 오류/unknown으로 표시하던 MCS-AUD-18을 기존 `prepareSubmitEffects`에서 교정했다. 없는 local commit은 export ref·bundle 생성 전에 protected preaccept rejection으로 닫고, Git object 손상처럼 관측에 실패한 경우는 unknown을 유지한다. 원래 invocation/accepted 사실을 변경하거나 unknown을 새 key로 우회하지 않는다.

첫 격리 fixture의 종료 코드가 보존 상태에 cleanup용 chmod를 수행해 재개할 수 없었으므로 새 격리 birth에서 재실행했다. 그 재실행의 협업은 성공했으나 최초 검증 harness가 Node의 기본 spec 출력을 TAP으로 오인한 실패도 보존했다. 최종 독립 검증은 `--test-reporter=tap`을 명시하여 다시 실행했다. 모델 보고만으로 PASS를 만들지 않았다.

추가 수정 뒤 빌드·TypeScript·패키지 검사가 통과했고, `collaboration-client-review-actions`, `audit-cli-submit`, `r20-submit-wiring`의 **24 PASS / 0 FAIL / 0 SKIP**를 확인했다. missing candidate의 protected rejection·반복 관측·무효과와 corrupt object의 unknown 보존을 실제 Unix RPC/Store/Git에서 검증한다. **추가 수정 뒤 전체 4,601개를 실행했다는 claim은 아니다.**

원시 근거는 `/tmp/oma-live-terra-luna/`의 `result.json`, `evidence.json`, `principal-final.txt`, `verification-final.tap`, `regression-final.tap`, `build.log`, `test-build-final.log`에 있다. 첫 실패는 `attempt-1/`, 두 번째 harness 판정 오류는 `attempt-2/`에 보존했다. 임시 harness는 `live-scenario.mjs`, `rerun-live.mjs`, 최종 독립 verifier는 `verify-live.mjs`다. 이 단일 실제 모델 실행은 **격리된 explicit current-birth fixture**이며, 제품 fresh admission·held-out A/B/C·실서비스 cutover·macOS qualification 완료가 아니다. 기존 fresh admission closure는 유지한다.

## 후속 구현 교정 — Linux 전체 검증 완료

최종 전체 실행은 Linux / Node 26.0.0에서 `scripts/test-local.mjs`로 555개 파일(단독 2개 + 병렬 553개, concurrency 4)을 모두 실행했다. 실제 native 회귀를 private bwrap overlay와 위임 cgroup scope에서 실행했으며, **exit 0 / signal 없음 / 1,166.90초(19분 26.90초)**다.

| phase | tests | PASS | FAIL | CANCELLED | SKIP | TODO |
|---|---:|---:|---:|---:|---:|---:|
| serial | 14 | 14 | 0 | 0 | 0 | 0 |
| parallel | 4,586 | 4,586 | 0 | 0 | 0 | 0 |
| 전체 | **4,600** | **4,600** | **0** | **0** | **0** | **0** |

원시 로그는 `/tmp/oma-surface-full4.log`, 완결된 TAP은 `/tmp/oma-surface-full4-serial.tap`과 `/tmp/oma-surface-full4-parallel.tap`에 보존했다. 실행 전후 source manifest는 `/tmp/oma-surface-full4-inputs.json`, 실행 관측은 `/tmp/oma-surface-full4-run.json`이다. **15,821개 입력의 전후 hash가 동일했고 `changedInputs: []`다.** 이 전체 실행 직후에는 executable source·tests·scripts를 바꾸지 않고 결과 문서만 갱신했다. 이후 실제 모델 실행에서 추가한 MCS-AUD-18의 수정·검증은 위 별도 절에 기록한다. 아래 구조 binding은 문서 갱신 뒤의 identity이며 runtime manifest를 대체하지 않는다.

빌드(`/tmp/oma-surface-build30.log`), 타입 검사(`/tmp/oma-surface-typecheck-final4.log`), 패키지 검사(`/tmp/oma-surface-package-final4.log`), 구조 전체 검사(`/tmp/oma-surface-architecture-final5.log`)도 PASS다. 첫 후속 전체 실행보다 늘어난 3개 사례는 양 역할의 사용자 확장 회귀 2개와 guard 이중 import 회귀 1개다. 같은 555개 파일을 실행했으며 기존 사례를 삭제하여 실패를 숨기지 않았다.

MCS-AUD-13/14/15/16/17의 index pagination, 일반 read schema, SDK reload 자원 정리, 사용자 확장 admission과 테스트 guard를 교정했다. 기존 Linux 기동/전달 fixture에는 explicit current birth·surface·record root·유효 limit를 공급하고 폐기된 모델 호출을 현재 입력으로 이행했다. setup을 위한 직접 Mail/host 호출은 명시적 fixture authority이며 authenticated Worker/model 실행 증거로 세지 않는다. 원래 accepted bytes·request key·receipt는 변환하지 않았다.

후속 관련 실행은 `/tmp/oma-surface-target6.tap`의 **227 PASS / 0 FAIL / 0 SKIP**다. 실제 Pi·scripted TLS provider·native Linux 실행과 controlled SDK context를 포함하며 실제 외부 provider/모델 A/B/C·power loss를 포함하지 않는다. 이후 index header와 일부 setup/구조 fixture를 조정했으므로 최종 source의 전체 판정은 다음 전체 실행 결과를 따른다. 이전 선택 실행의 PASS를 전체 FAIL 수에서 차감하지 않는다.

첫 후속 Linux 전체 실행은 **4,597 tests / 4,533 PASS / 63 FAIL / 1 SKIP**, 1,074.29초였다. 555개 파일을 모두 실행했으며 실행 전후 15,821개 입력의 변경은 없었다. 원시 결과는 `/tmp/oma-surface-full.log`, TAP은 `/tmp/oma-test-summary-ODWw2Y/summary-{serial,parallel}.tap`, source manifest와 실행 관측은 `/tmp/oma-surface-full-{inputs,run}.json`에 있다. 이 결과를 이후 수정의 PASS로 소급하지 않는다.

남은 17개 파일의 폐기된 모델 도구·모델 작성 request key·누락된 명시적 launch input을 현재 계약으로 이행했다. 원래 Pi 호출의 반복 관측, 서로 다른 의도적 send, 같은 frozen name intent의 기존 child 연결을 구분한다. 실제 Human 개별 제어는 Human 채널에서 검증한다. Worker 논의는 일반 threaded mail이며 review 승인 사실을 만들지 않는다. 독립 채널/credential 검사는 typed host Client와 실제 delivery hook의 component harness로 범위를 명시했고, 실제 SDK catalog·original invocation·native 실행은 별도의 시나리오가 검증한다.

첨부 시나리오에는 실제 배포와 같은 broker-lifetime publication owner를 공급했다. 본문의 BOM은 immutable record와 Content-file 재전송 bytes에서 보존을 확인하고, hashline의 표시용 anchor와 원본 bytes를 구분한다. 설치된 확장의 로드·read-only store 격리와 verified direct user tool의 호출 가능성을 유지하며 retired selector는 노출하지 않는다. 재대조 중 발견한 `collaboration-groups`의 사용자 확장 소거를 수정했다. 별도 catalog나 selector를 만들지 않고 기존 provenance admission과 SDK의 direct exposure를 동일 registry에 합친다. hidden/deferred/unverified 도구 비노출, 그룹 누적·resume/reload와 revoke/late shadow 거절을 양 역할에서 검증한다. 이 수정 전 진행하던 두 번째 전체 실행은 중단했으며 전체 PASS로 세지 않는다.

직접 실행의 cgroup SKIP은 호스트 전체 기능 부재가 아니라 현재 로그인 scope의 위임 부재였다. `systemd-run --user --scope --property=Delegate=yes`의 독립 owned scope에서 실제 CPU·memory·pids 제한 및 namespace 관련 3개 검사가 **3 PASS / 0 FAIL / 0 SKIP**로 끝났다(`/tmp/oma-surface-cgroup.log`). 최종 전체 실행도 이 위임 scope와 private bwrap overlay에서 수행한다. 아래 역사적 전체 수치는 그대로 보존한다.

세 번째 전체 실행은 **4,599 tests / 4,598 PASS / 1 FAIL / 0 SKIP**, 1,170.25초였고 15,821개 입력의 실행 전후 hash가 같았다(`/tmp/oma-surface-full3.log`, `/tmp/oma-surface-full3-inputs.json`, `/tmp/oma-surface-full3-run.json`; raw TAP `/tmp/oma-test-summary-wUE2Pt/summary-{serial,parallel}.tap`). 마지막 실패는 programmatic test runner가 파일 URL과 portable data URL로 guard를 중복 설치하여, 첫 wrapper가 추가한 환경을 두 번째 wrapper의 고정 pre-exec placement 검사가 거부한 사례다. 동일 실패를 독립 재현하고 guard 설치를 process당 한 번으로 제한했다. 기존 arbitrary shell/manager·변조 launcher·임의 env/FD 거절은 유지한다. 실제 cgroup 결과와 marker를 쓰는 guard contract 검사를 구분하며 부분 PASS를 합쳐 전체 PASS로 승격하지 않는다. guard 회귀는 수정 전 실패했고 수정 후 기존 차단 검사와 함께 **29 PASS / 0 FAIL / 0 SKIP**다. 전체와 같은 programmatic phase 경로의 실제 cgroup 검사도 **3 PASS / 0 FAIL / 0 SKIP**로 재검증했다(`/tmp/oma-surface-{guard-before,guard-after,cgroup-fixed}.log`).

외부 provider의 held-out 실제 모델 A/B/C 비교는 **NOT_RUN**이다. scripted TLS provider와 로컬 schema/registry 검사를 외부 모델 증거로 세지 않는다. 기존 fresh admission closure와 실서비스 cutover gate는 열지 않았다.

### macOS 별도 미완료 범위

Linux에서 공통 Mac Worker plan의 새 record/source 환경 항목 누락을 교정했다. 이 portable recipe 검사를 Mac 실행 PASS로 세지 않는다. `packages/platform-mac/src/execution-launch.ts`의 `launchBlockedDarwin()`은 현재 native launch-data channel 부재로 항상 `UNSUPPORTED_PROFILE`을 던진다. 이 실행 경로는 **UNIMPLEMENTED**이며 단순 미검증으로 표시하지 않는다. 실제 macOS host가 없어 다음 항목도 **NOT_RUN/UNVERIFIED**다.

- native scope의 전체 후손 종료, owner crash 뒤 재인수·physical death proof와 slot 재사용.
- Mach rendezvous/bootstrap, audit-token peer 인증과 FD 이전, 실제 host/Worker 연결 수명.
- Seatbelt의 현재 역할별 record root·canonical Git·workspace containment 및 same-UID rename/symlink 음성 경로.
- Keychain credential broker와 Pi inference/egress·MCP의 실제 인증·취소·재시작.
- 실제 Darwin file+directory flush, no-replace/derived publication과 SQLite/Git/receipt crash/recovery 경계.
- macOS 26 arm64의 Society/Personal/Principal/Worker·Human control·package/history·backup/restore 전체 제품 실행. macOS 15 호환 관측도 미실행이다.

범위와 수용 조건은 [native 명세](../macos-native-spec.md)와 [플랫폼 계약](../macos-platform.md)에 남아 있다. Linux의 실제 kernel 결과나 scripted provider 결과로 이 항목을 대체하지 않는다.

## 이전 전체 실행 — 역사적 결과

Linux, Node 26.0.0, CPU 4개, 병렬 파일 4개와 선행 단독 파일 2개를 사용했다. Native Linux 회귀는 private `/usr/bin/bwrap` overlay에서 실제 실행했다. 다음 시간은 **빌드 제외 테스트 시간**이다.

| 입력 | 실제 테스트 | 통과 | 실패 | 미실행 | 시간 |
|---|---:|---:|---:|---:|---:|
| 정리 전 비교 기준 | 4,544 | 4,343 | 200 | 1 | 18분 44초 |
| 실행 비용·공통 준비 정리 후 | 4,544 | 4,344 | 199 | 1 | 16분 54초 |
| 병렬 6개 실험 | 4,544 | 4,342 | 201 | 1 | 16분 24초 |
| 중복 정리·분리·이름 변경 후 전체 실행 | 4,581 | 4,395 | 185 | 1 | 16분 30초 |

마지막 전체 실행은 555개 파일을 발견했다. 9개 사례를 삭제·통합하고 기존 검증을 46개 하위 결과로 분리하여 총수가 37개 늘었다. 숫자 증가를 새 기능이나 검증 범위 증가로 세지 않는다. 이름 대응표로 전체 실행을 대조했으며 의도한 삭제 외 누락과 새 최상위 사례는 없었다.

실행 중 소스·시험·스크립트·문서 입력 1,880개 hash는 바뀌지 않았다. 이후 남은 이름 접두사·검증 목록 참조와 문서를 정리했다. 후속 선택 검사는 아래에 별도로 기록하며 마지막 전체 결과를 소급 수정하지 않는다.

병렬 6개는 4개보다 29초 빨랐지만 contained search의 두 timing 검증이 새로 실패했다. 이 호스트에서는 4개를 유지한다. 마지막 전체 실행은 정리 전보다 약 2분 14초 빨랐다.

## 실패와 플랫폼 범위

마지막 전체 실행의 실패 중 **184개는 정리 전에도 실패하던 사례**, 1개는 exploration 검증 목록 검사에 남은 옛 테스트 이름이었다. 이 참조 오류는 이후 수정했고, 관련 검사에서 통과했다. 기존 실패를 테스트 삭제·부분 PASS 합산으로 해소했다고 보고하지 않는다.

남은 실패는 Principal/Society/Worker 시나리오, confinement, TUI, 기존 도구 호출, native 기동, 구조 inventory·검토 ledger 등에 걸쳐 있다. 예를 들어 Principal 시나리오 35개, Society 18개, Resident confinement 18개, confined 시나리오 11개, merge/review 시나리오 9개가 실패했다. 이 묶음은 실패 위치 분류이며 원인이 모두 같다는 판정이 아니다. 현재 계약에도 필요한 동작은 삭제하지 않았다.

미실행 1개는 Linux cgroup v2의 delegated `cpu`·`memory`·`pids` parent 부재다. macOS 실행 실패가 아니다. Darwin 전용 helper 시험은 실제 Darwin에서만 등록된다. Linux에서 실행한 공통 코드·Darwin recipe 검사는 실제 macOS 지원 완료를 증명하지 않는다. 실제 macOS·provider·power-loss·모델 A/B/C 검증은 이번 작업에서 실행하지 않았다.

## 삭제·통합·이행의 근거

| 정리한 사례 | 유지한 의미·대체 검증 |
|---|---|
| 중복 TypeScript 정상 컴파일 1개 | `test/architecture-evolution.test.mjs`의 pinned compiler 정상 대조. dispatch mutation 검증 유지 |
| public/internal vocabulary 중복 2개 | `test/p2-wire-golden.test.mjs`로 모아 독립 기대 목록·read mode·금지 이름을 유지. 현재 vocabulary 불일치는 계속 실패 |
| surface 이름의 중복 adversarial 1개 | `test/tool-surface.test.ts`로 모든 잘못된 이름·그룹 벡터와 roundtrip 검증 통합 |
| 폐기된 모델 ACK 노출 2개 | spec의 모델 ACK 제거에 따라 삭제. UUID grammar·backend receipt·historical ACK 복구는 유지 |
| 폐기된 전용 review-diff cursor 1개 | 현재 역할별 ordinary read와 독립 Git bytes/hash 대조·일반 paging 검증 유지 |
| 폐기된 전용 mail reader의 oversize/UTF-8 decoder 2개 | 전용 reader의 제거된 입력 계약만 삭제. 현재 ordinary read의 권한·없음·오류·큰 본문 검증 유지 |

전용 mail reader의 나머지 6개 오류 검증은 실제 contained `read`로 옮겼다. 로그 2개는 typed client의 `logs.read`와 실제 backend decoder로 옮겼다. 이 8개가 새 경로에서 통과한 것을 제품 결함 8개 수정으로 세지 않는다.

대형 actor socket 검증은 18개, typed client 검증은 11개 하위 검증으로 분리했다. LSP 환경변수 검증은 3개 경계로, accepted context 손상은 14개 유형으로 각각 결과를 낸다. 비싼 준비·실행은 공유하고 각 손상 뒤 원본 row를 복원한다. 네 파일의 선택 실행은 93개 모두 통과했다.

## 실행 비용과 이름

- 테스트 이름은 파일별 `001. 동작 설명`이며 반복 입력은 조건을 붙인다. 코드명 접두사는 제거하고 필수 검증·fault boundary·요구 추적의 참조도 갱신했다.
- 공통 Git/peer/replay/cleanup fixture를 재사용하고 이미 끝난 작업의 watchdog timer를 해제한다.
- delivery deadline은 test-only 4배 시계를 사용한다. 관련 23개 검증은 약 57초에서 27초로 줄었고 실제 OS 종료·수명 검증은 실제 관측을 유지한다.
- receipt chunk는 가상 시간으로 검증한다. 정상 구현은 통과하며, 각 chunk의 새 관측 창을 전체 공통 deadline으로 바꾼 메모리상 변형은 실패했다. 제품 파일은 수정하지 않았다.
- 독립 architecture mutation의 Program 준비 40회를 4회로 묶고 각 변경 파일의 finding을 개별 확인한다.
- 긴 파일부터 실행하며 시간 cache와 compile cache는 결과를 생략하지 않는다. 실패의 큰 JSON은 artifact로 분리하고 원시 TAP은 보존한다.
- 실행되지 않던 감사 자료 33개(그중 JSON 21개, 약 89,000줄)는 [보관 위치](../archive/test-audits/)로 이동했다. 이것을 실행 테스트 삭제나 속도 향상으로 세지 않는다.

실행 명령과 환경·artifact 설정은 [개발·테스트 안내](../MAINTENANCE.md)에 있다.

## 원시 근거

다음은 이 개발 호스트의 경로다. 저장소 밖의 로그를 versioned 제품 자산이나 배포물로 취급하지 않는다.

| 근거 | 위치 |
|---|---|
| 정리 전 전체 TAP | `/home/dev/oma-test-summary-rsWm0X/` |
| 4개·6개 병렬 비교 | `/home/dev/oma-cleanup-whole.log`, `/home/dev/oma-cleanup-six.log` |
| 마지막 전체 로그·시간·입력 | `/home/dev/oma-cleanup-final-whole.log`, `/home/dev/oma-cleanup-final-time.json`, `/home/dev/oma-cleanup-final-inputs.json` |
| 마지막 전체 raw TAP | `/tmp/oma-test-summary-7Y2mJB/` |
| 큰 scenario 실패 상태 | `/home/dev/oma-cleanup-final-artifacts/` |
| 이름 대응·사례별 비교 | `/home/dev/oma-test-name-map-complete.json`, `/home/dev/oma-cleanup-final-comparison.tsv` |
| 분리·현재 계약 선택 검증 | `/home/dev/oma-cleanup-split-targeted.tap`, `/home/dev/oma-cleanup-semantic-targeted.tap` |
| 가상 시간의 부정 대조 | `/home/dev/oma-cleanup-clock-mutant.tap` |

## 후속 이름·문서 검사

전체 실행 뒤 이름 참조 오류, 남은 접두사와 현재 문서 안내를 수정했다. 인계·검증·native 조사·모듈 감사 등 6개 현재 문서는 합계 3,785줄에서 138줄로 줄였고 원문은 SHA-256과 함께 보관했다. 또한 fast/durable의 필수 검증 목록이 요구하면서 실행 파일에는 빠져 있던 3개 파일을 추가하고, 각 lane이 실제 선택한 파일에서 해당 검증을 찾도록 검사를 강화했다. 전체 runtime를 다시 실행했다고 합산하지 않는다. 최종 선택 검사는 **65/65 PASS, fail/skip/cancel/todo 0**이며 `/home/dev/oma-cleanup-final-reference-tests.tap`에 남겼다. 빌드, module 경계, spec inventory도 통과했다. 이 결과를 전체 FAIL 수에서 차감한 새 전체 실행으로 기록하지 않는다.

## 이전 실행 기록의 진입점

### collaboration-v1 — mail records 첫 구현

spec 작성 당시의 진행 기록은 [정리 전 원문](../archive/cleanup-2026-11-03/implementation/validation.md#collaboration-v1--mail-records-첫-구현)에 있다. 현재 판정은 이 문서 첫 절이다.

### Accepted legacy integration의 실행과 원래 사실 분리 checkpoint

[당시 checkpoint와 한계](../archive/cleanup-2026-11-03/implementation/validation.md#accepted-legacy-integration의-실행과-원래-사실-분리-checkpoint)를 보관했다.

### collaboration-v1 — 원래 owner 교정과 현재 미완료

[당시 선택 실행과 미완료 범위](../archive/cleanup-2026-11-03/implementation/validation.md#collaboration-v1--원래-owner-교정과-현재-미완료)를 보관했다.

### Native discard와 label-independent owner loss — source `8a881a63a74`

Native [41796440616](https://github.com/minjung2035/oma-v2-ci/actions/runs/41796440616)의 양 Mac 각3회에서
production Node discard receiver가 매회24개 메시지를 SDK destructor로 반환했다. 정상 도구·DNS·child join은
유지했고 receiver 오류는 없었다. Background/SessionCreate/LaunchOnlyOnce owner를 fresh kernel-token으로
SIGKILL한 뒤 detached·late-fork 후손을 production coalition leaf로 제어했다. explicit bootout 없이 CID ESRCH와
다른 live CID의 조회 성공을 확인했고 registration/restart는113이었다. 같은 job label을 새 CID로 재사용해도
이전 identity의 signal은 false였고 새 generation은 살아 있었다. label 문자열은 recovery authority가 아니다.

입력15829개 `f0af51ee141ea67bbad6e4e39229dd9d97beed79b1549c8b96c94a603d661a6e`와 runtime 산출물은 전후 동일했다.
API SHA-256 대조한 Mac15 ZIP `1ef1b7c7364438e3f7ca3540ee7a4effe948814d854f61ae3e081e95d42bf79e`,
Mac26 ZIP `e2ccfb16e5e7c8096a640558a5d17823fee3aea202b3034bcabf8d9c5b772454`와 결과는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/native-discard/`에 있다. 이 controlled 관측은
제품의 helper code identity·stdio/FD handoff·durable recovery·전체 권한 경로 검증을 대체하지 않는다.
제품 guard와 G-PROCESS/G-FILES/G-AUTH OPEN은 유지한다.

### 다음 입력 — declared MachServices의 Host gate

ordinary user-domain Background/SessionCreate/LaunchOnlyOnce job에 declared MachService를 두고, helper가
모든8개 kernel audit-token word와 살아 있는 원래 Host generation을 매 control frame마다 대조한다.
별도 process의 service check-in 선점, INIT 위조, GO 위조를 실제 시험하며 Host GO 전에는 target을 생성하지 않는다.
Host가 넘긴 discard SEND capability를 task/registered seed로 설정하고 기존 production Seatbelt/도구 입력을 실행한다.
실패해도 관측한 CID의 종료를 확인해야 fixture cleanup을 완료로 기록한다. 이 입력의 실제 Darwin은 발행 전 NOT_RUN이다.

로컬 SDK object compile·MJS syntax·parser/Seatbelt43/43·전체 architecture 검사는 PASS다. Host의 helper-origin
검사는 현재 유효한 서명과 kernel generation을 확인하며 expected helper code requirement를 선택한 검증은 아니다.
이 프로토콜 prototype을 G-AUTH 완료나 production execution backend로 승격하지 않는다.

### 선택한 main image의 audit 관측과 수신 오류 정리 — 실제 Mac 전

`observeDarwinAuditOrigin`은 선택한 canonical CDHash 목록을 선택적으로 받고, await 전에 고정한
Security requirement를 genuine audit token의 dynamic code에 적용한다. 선택값이 없을 때의 기존 의미는 유지한다.
새 실제 fixture는 같은 Node의 일치·별도 signed shell의 불일치·호출 뒤 목록 변경 무효화를 확인하고 모든 CF 반환을 join한다.
Mach job gate도 별도 helper CDHash와 Node의 거절 대조를 사용한다. 이 입력의 Darwin 실행은 NOT_RUN이며
expected Broker의 출처·현재 role/run 권한이나 script/library generation을 이 primitive로 증명하지 않는다.

일반 Mach receiver도 BODY_ERROR에서 userspace에 전달된 부분 body를 SDK destructor로 반환하고 endpoint를 닫는다.
다른 receive 오류도 해당 stream을 닫아 불명확한 상태에서 계속 진행하지 않는다. 기존 discard receiver와 같은
고정 XNU resource-ownership 규칙이다. 로컬 build·parser/Seatbelt 검증과 실제 Mac 결과는 입력별로 구분한다.

### declared MachServices의 실제 Host gate — source `1d3e9114753`

Native [41799482260](https://github.com/minjung2035/oma-v2-ci/actions/runs/41799482260)의 양 Mac 각3회 모두
선점 check-in1100·위조 INIT/GO의 genuine kernel sender 거절2건·Host release 전 target 미생성·Host GO 뒤
정상 Node/Git/compiler/DNS·child join·CID ESRCH·registration113을 관측했다. 매회38개 bootstrap 메시지를
Node discard receiver가 반환했다. GUI 없이 시작한 runner의 증명이나 전체 G-AUTH 완료는 아니다.

입력15830개 `864c6c0239e8aeb3b2bab266ea5fdc03867fe4b008e20f1bce13ed6c6ed952c5`와 runtime 산출물은 전후 같았다.
API SHA-256 대조한 Mac15 ZIP `dd9134c8541cfce07f24029227f5e28ed2fbaee0bb59aba18b48292c062b123d`,
Mac26 ZIP `6906b75ff06325a0f4e64878c041572f82041b3421a630da622a3c3b1f7c0b3d`와 결과는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/mach-job-gate/`다. 전체 gate는 Mac26 114 OBSERVED/6 SETUP_FAILED,
Mac15 111 OBSERVED/9 SETUP_FAILED이며 productQualification은 BLOCKED다.

### fileport를 통한 private FD 전달 — 실제 Mac 전

native leaf는 borrowed FD를 owned fileport SEND로 만들고, borrowed fileport에서 새 CLOEXEC FD를 취득한다.
[고정 XNU header](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/fileport.h)의
10.7+ interface다. 같은 open file description과 cursor를 공유하므로 독립 reopen이나 role authority가 아니다.
Mach fixture는 source FD를 닫은 뒤 SEND 전달·같은 inode/bytes/cursor·일반 Mach port의 import 거절을 시험한다.
Host gate는 stdio0/1/2와 private7을 전송하고 helper가 CLOEXEC import 후 겹치지 않는 source FD에서 정확한
posix_spawn slot으로 연결한다. release 전 output 없음과 child의 입력/private bytes·분리된 stdout/stderr를 대조한다.

현재 C SDK object compile·workspace build·MJS syntax·parser/Seatbelt44/44·전체 architecture는 PASS이며 실제 Darwin fileport handoff는 NOT_RUN이다.
이 대조는 regular-file stdio이며 pipe streaming/backpressure·전체 process owner와 durable recovery 연결은 남아 있다.

### 실제 pipe 전달과 EOF 대조 — 후속 입력 / Darwin NOT_RUN

같은 Host gate를 별도 service/job/CID에서 반복하되 stdio는 anonymous POSIX pipe로 전달한다.
helper의 READY가 모든 import를 확인한 뒤 Host의 fileport SEND 복사본을 반환한다. helper도 spawn 뒤
자신의 FD source를 닫아 child 종료 후 실제 EOF가 가능해야 한다. private7은 별도 read-only fileport다.
stdout1,048,593 bytes·stderr1,048,605 bytes를 동시에 drain하고 길이·SHA-256·실제 reader close를 대조한다.
오류 경로도 알려진 CID 종료와 pipe handle 반환을 확인해야 fixture cleanup을 완료로 기록한다.

로컬 parser/Seatbelt44/44·MJS syntax가 통과했다. 같은 controlPipe/Node read-stream capture의 실제 Linux
대조도 두 byte count/hash·EOF·close를 통과했으며 `/tmp/oma-macos-pipe-gate-linux-smoke.log`에 있다.
이것은 pipe capture harness의 관측이며 Darwin fileport 또는 제품 scope proof가 아니다. 실제 Mac은 NOT_RUN이다.

### 선택한 image와 fileport의 실제 결과 — source `63dc521bf8c`

Native [41801020566](https://github.com/minjung2035/oma-v2-ci/actions/runs/41801020566)의 양 Mac 각3회에서
native audit 관측은 선택한 Node CDHash에 일치하고 별도 signed shell에는 -67050으로 거절했다. 호출 뒤
목록 변경도 이미 고정한 requirement를 바꾸지 않았다. source FD를 닫은 fileport의 실제 SEND 전달·같은 inode와
bytes·cursor 공유·일반 Mach port import 거절도6회 확인했다. 별도 job gate6회도 선택한 helper image 일치와
다른 signed Node 거절·stdio0/1/2와 private7의 실제 bytes·release 전 무출력·최종 CID 반환을 확인했다.

입력15830개 `d236558d4f02c74727503c7839bafefc4dda126700d6b5c73d83e5b3e4d697fd`와 runtime 산출물은 전후 같았다.
API SHA-256 대조한 Mac15 ZIP `828533b915f7e772048cd4a4c93b4c0f7cfe8716d0a2d1b113d63fef66200f77`,
Mac26 ZIP `857744d44a34dbe123e724860a5bacdaeecddfe68030dd5bbbb7fd3d70d9bb03`와 결과는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/fileport/`다. 전체 gate 수와 제품 BLOCKED는 그대로다.
이 source의 전달은 regular file이며 후속 pipe 입력과 혼합하지 않는다.

### suspended main-image gate 조합 — 후속 입력 / Darwin NOT_RUN

job helper는 target을 START_SUSPENDED/CLOEXEC_DEFAULT로 만들고 실제 WUNTRACED stop을 확인한 뒤
SDK task-name capability에서 얻은 full audit token을 Host에 보고한다. Host는 같은 boot/CID와 선택한
mapped main image의 CDHash 일치·다른 signed image 거절을 확인한 뒤 GO를 보낸다. helper는 그
kernel token으로 SIGCONT하고 이후 실제 child terminal/join을 보고한다. 오류는 자신의 unreaped child를
kill/join하며 저장 PID를 다시 취득하지 않는다. foreign frame도 원래 Host의 liveness를 먼저 확인한다.

로컬 SDK object compile·parser/Seatbelt44/44·MJS syntax는 PASS다. 실제 Darwin 조합은 NOT_RUN이며
첫 mapped image 뒤의 exec chain, script/library generation, 제품 journal producer와 scope/backend 연결은
별도 미완료다. 현재 fixture의 profile pathname을 production private profile-channel로 승격하지 않는다.

### pipe 첫 실제 실행의 setup 실패 — source `e4765402041`

Native [41801898577](https://github.com/minjung2035/oma-v2-ci/actions/runs/41801898577)의 양 Mac 각3회 pipe 대조는
helper 실행파일과 job 디렉터리에 같은 `mach-pipe-gate` 경로를 쓴 fixture 오류로 EEXIST·SETUP_FAILED였다.
job 생성·target 실행·pipe handoff는 미실행이다. file-backed 반복도 같은 이름 충돌로 실패했다.
reader handle 반환은 확인했으며 이 실패를 실제 pipe 호환성 관측이나 성공으로 바꾸지 않는다.
후속 입력은 실행파일을 별도 `*-helper` 경로로 분리했다. 고친 뒤 실제 Mac은 아직 NOT_RUN이다.

입력15830개 `629f7edea4d6ccd5a3c1db6a8c9125d31dbbb3390dc97f7d558bf43a4ee19f6a`와 runtime 산출물은 전후 같았다.
API SHA-256 대조한 Mac26 ZIP `8dfb80f44ee5018c6ee629e92094d7c8bf5ed3ac21ca69e4f142fa0dc6754b35`,
Mac15 ZIP `2cdf02753d20b6e9d5029adc65ed01f4646a354e17b0ffad81762497f7163e71`과 실제 실패는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/pipe/`에 있다. 제품 BLOCKED는 유지한다.

### 최종 Node image의 두 번째 gate — 후속 입력 / Darwin NOT_RUN

첫 launcher image의 stop/검증/GO 뒤, controlled Seatbelt launcher는 POSIX_SPAWN_SETEXEC와
START_SUSPENDED로 최종 Node image를 같은 PID에 올린다. job helper는 두 번째 stop에서 kernel token을
다시 취득한다. Host가 Node CDHash 일치·launcher CDHash 거절·같은 CID·아직 없는 Node report/출력을
확인한 뒤 별도 TARGET_GO를 보낸다. 세 번째 foreign GO도 실제 kernel sender로 거절해야 한다.

이 입력의 C helper2개 SDK object compile·MJS syntax·parser/Seatbelt44/44는 PASS다. 실제 Mac은 NOT_RUN이다.
두 main-image 관측은 script/library protected generation, production profile byte-channel·stdio owner·durable
producer/recovery·G-AUTH의 expected Broker/current role/run proof를 대체하지 않는다.

### production native leaf 뒤 Linux 전체 — source `8a881a63a74`

Architecture [41796440738](https://github.com/minjung2035/oma-v2-ci/actions/runs/41796440738)의 full serial
**4747/4747 PASS·fail/cancel/skip/todo0·errors[]**다. 검사13개 command는 모두 code0이며 sourceChanges=[]다.
API SHA-256 `5b098cfc2ceec63844d9f577dba21b9838f629e6ac34f46098caa4b1d3b563fa`와 대조한 artifact는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/native-discard/linux-all/`에 있다.
이는 해당 source의 Linux 전체 회귀이며 후속 CDHash/fileport source나 Darwin 제품 전체 PASS로 합산하지 않는다.

### pipe와 suspended gate 원시 결과 / verifier 오류 — source `7f332fa478c`

Native [41802869640](https://github.com/minjung2035/oma-v2-ci/actions/runs/41802869640)의 최종 launchd-bootstrap3건씩은
parser의 `stopSignal > 0` 조건 때문에 SETUP_FAILED였다. 원시 stdout은 양 OS 각3회의 regular/pipe gate 모두
선택한 stopped launcher image 일치·다른 signed image 거절·Host 전용 release·정상 tools/DNS·child join·CID ESRCH를
보고한다. pipe stdout1,048,593 bytes의 SHA-256은 `c26032d5154f96bd29c799447d715ab681d8d0aa308ecc6f321a35d98f0672da`,
stderr1,048,605 bytes는 `4cc03dc29be85d2ca4c9fa76f851804953e1ac604a36ffe00cf4813db4fc2311`이며 실제 EOF/reader close도 확인했다.

실제 START_SUSPENDED는 C의 WIFSTOPPED 판정을 통과한 status127·WSTOPSIG0이었다. parser의 양수 signal 요구는
잘못 추가한 조건이다. stopStatus의 stopped bits와 보고된 signal의 정확한 관계를 대조하도록 고쳤고, signal0의
정상 입력과 불일치/비정지 상태 거절 회귀를 추가했다. 보존 stdout6건은 수정 parser로 모두 재판독됐다.
이는 새 kernel 실행이나 과거 CI 판정의 소급 PASS가 아니다. 로컬 parser/Seatbelt는45/45 PASS다.

입력15830개 `95df59f773ced795320a9c74b035986c56ae6b1581ef89179581f38f0e8ba1be`와 runtime 산출물은 전후 같았다.
API SHA-256 대조한 Mac15 ZIP `f0137e7394b3fe2f377063e0d59acbd2481f4cb15db3f10453a58522269a07e0`,
Mac26 ZIP `275acf654728c53ab94496cf609e9c473d380445b325aa6af406e2876c0de45a`와 원시 stdout은
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/suspended-gate/`에, 재판독은
`/tmp/oma-macos-suspended-raw-replay.log`에 있다. 제품 BLOCKED·세 gate OPEN은 그대로다.

### 두 번째 stop 미관측과 cleanup 실패 — source `d5535bb2b5b`

Native [41804260281](https://github.com/minjung2035/oma-v2-ci/actions/runs/41804260281)의 양 Mac 각3회에서
regular/pipe 두 단계 gate 모두 최종 Node stop 응답의10초 한도를 넘겨 SETUP_FAILED였다. 알려진 CID는
production leaf cleanup으로 소멸했고 pipe handles도 반환됐다. 그러나 이미 자동 제거된 LaunchOnlyOnce job에
후속 fixture bootout을 요청해 exit3 오류가 겹쳤고 stdout 대신 stderr의 observation에 원시가 남았다.
최종 Node 실행 전 stop의 성공이나 실행 여부는 이 자료만으로 확정하지 않는다.

입력15830개 `032c7c7d104721f274c15c181fb13041ae16e5256e7ef42ea82a771c88279e6a`와 runtime 산출물은 전후 같다.
API SHA-256 대조한 Mac15 ZIP `c62bdd5c5782b9800cbf8a8e9309c9234ecee9487b284dab16bd8f4d1aee53e5`,
Mac26 ZIP `a6e7fdf663493b3a3bc8f3c820109b06f0375e352d2f475f4c408c4990cdfe85`와 원시는
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/final-target/`다. gate는 Mac26 111 OBSERVED/9 SETUP_FAILED,
Mac15 108 OBSERVED/12 SETUP_FAILED이며 제품 BLOCKED다.

### public one-shot constructor와 소비하지 않는 stop 관측 — 후속 입력 / Darwin NOT_RUN

production `launchd-job.ts`를 고정 public launchctl의 user/UID Background/SessionCreate/LaunchOnlyOnce 제출·기동으로
구현했다. 이전 launch_msg의 container/child 중복 free와 argv0 누락 경로를 제거했다. frozen argv/env와 XML text를
보존하며 private channel로 전달하지 않는 input/capture 옵션은 거절한다. 독립 plist reader와 회귀47/47·workspace build는 PASS다.
전용 temporary도 held parent FD 아래에서 mkdirAt/openAt/unlinkAt으로 생성·반납한다. raw path mutation을 거절한 최초 구조 검사6건을 보존하고 해당 경로를 수리했다.
start는 이 process가 제출한 객체만 받고 label-based removal API는 없다. CLI 종료를 scope death로 해석하지 않는다.
현재 Mach gate가 이 production constructor를 실제 사용하도록 연결했으며 이 입력의 실제 Mac은 NOT_RUN이다.

고정 [kern_exec](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L2068)는
START_SUSPENDED에서 SSTOP/task suspend를 설정하고, [wait 관측](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exit.c#L2792)은
소비한 P_LWAITED 상태를 검사한다. 이를 직전 실패 원인으로 보는 것은 아직 추론이다. helper는 두 stop을
waitid(WNOWAIT|WNOHANG)으로 소비하지 않고 관측하며 SETEXEC 뒤에는 새 kernel pidVersion까지 요구한다.
no event·동일 이전 generation·deadline을 stop/death로 바꾸지 않는다. stop의 continued19도 거절한다.
SDK object compile·MJS syntax·module 경계를 포함한62/62·전체 architecture는 PASS이며 실제 동작은 새 CI에서 확인한다.

오류 시 target의 read-only 상태·bounded stdout/stderr head·stop trace를 보존한다. fixture는 known CID 소멸 뒤
registration 조회도113일 때만 해당 one-shot label의 cleanup을 완료로 기록한다. 둘 중 하나만으로 끝났다고 하지 않는다.
제품 실행 guard·durable producer/recovery와 G-AUTH/G-FILES의 미완료는 유지한다.

### public constructor와 최종 Node stop의 실제 결과 — source `d9179f66b7c`

Native [41807809569](https://github.com/minjung2035/oma-v2-ci/actions/runs/41807809569)의 양 Mac 각3회에서
regular/pipe gate 모두 OBSERVED다. production constructor의 submit/start는 실제 exit0이며, 같은 PID의
launcher와 최종 Node가 서로 다른 kernel pidVersion으로 각각 정지했다. Host는 각 image의 선택 CDHash와
다른 signed image 거절을 대조하고, 최종 TARGET_GO 전 Node report·stdout·stderr가 없음을 확인했다.
full kernel sender가 다른 INIT/GO/TARGET_GO3건은 모두 거절됐다. 정상 Node/Git/compiler/DNS·fresh service
두 경로 exit5·child join·CID ESRCH·registration113도 확인했다. pipe의 두 byte count/hash·EOF·reader close와
handle 반환은 앞서 정의한 기대값에 일치한다. Mac15 호환성 관측은 Mac26 지원 qualification과 구분한다.

입력15831개 `3973a96158875fb125ccb91a8e1d818a8f5c70b8dd2dc5fdc9d8b0de5c576d40`와 runtime 산출물은 전후 같다.
API SHA-256 Mac26 `32da3b17d02f3d52042e09b4d1380c97b5dc36529555746c22cc92a1c27e2613`·Mac15
`bbdab2e61b88375a09f93e9b48cd35cd9a4fe55cd190e0aad30eb46361cf987a`와 대조한 artifact와
요약은 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/public-job/`다. Mac26 전체114 OBSERVED/6 SETUP_FAILED·Mac15 111/9,
제품 BLOCKED·세 gate OPEN이다. 이번 성공은 이전 실패 원인설의 확정이나 protected script/library generation·
durable producer/recovery·expected Broker/current role의 qualification이 아니다.

같은 source의 양 Mac 공통 runtime은 각293/293·skip/cancel/todo0이다. 독립 설치는 각26/27이며 @oma/git의
Linux preparation guard에서 거절됐다. Ubuntu는 native 실행46·leaf3·Restic setup8·integration472가 통과했다.
세 runtime artifact의 input/runtime 전후 동일과 API SHA-256을 대조했다. 전체 Linux 실행과 합산하지 않는다.
별도 Architecture [41807809449](https://github.com/minjung2035/oma-v2-ci/actions/runs/41807809449)의 같은 source
native-all은 **4751/4751 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges=[]**다. API SHA-256
`4377dad38f6197498d3c5dc08beb046646e6893b17f849390342b1c0f5796fce`와 대조한 artifact는 위 root의
`linux-all-art-13311959770/`에 있다. 후속 공통 owner/시작 정지 변경 입력의 전체 결과로 재해석하지 않는다.

### witnessed setup과 terminal-before-drain 공통 owner

공통 owner는 실제 scope를 받은 즉시 witness를 게시하고, 선택적인 trusted preparation 완료 뒤 현재 권한을
다시 확인해 release한다. drain/abort는 준비 완료를 기다리지 않고 이미 취득한 scope의 종료를 요청한다.
선택적인 terminal 통지는 결과의 stdio drain 전에 후손 종료를 시작하게 하며 death proof를 대신하지 않는다.
normal/recovery cleanup은 population이 populated인 동안 재탐색·종료를 반복하고, empty와 closed를 모두
관측한 뒤에만 journal을 retire한다. Darwin backend 연결과 새 durable witness는 아직 없다.
종료 요청이 실패한 populated scope는 unknown으로 보존하고 후속 stop에서 재관측한다. 이미 반환한 이전
scope의 늦은 result는 같은 slot의 새 owner를 정리할 수 없다.

controlled state-machine5건은 authority 지연/철회·준비 중 drain·terminal-before-capture·late member/FD drain을
검사한다. 첫 계약은 이전 owner에 대해 실제 실패했고 수정 뒤 process49/49·workspace build27/27이 통과했다.
실제 Linux namespace/취소/crash19/19와 native execution46/46도 통과했다. 최초 외부 bwrap wrapper는 /dev bind가
없어 제품 외 최소 fork와 /dev/null 접근부터 EACCES였다. /dev bind를 복원한 동일 일반 UID 환경의 결과를
사용하며, 최초 실패를 제품 결함 수리나 Darwin 실행 proof로 계산하지 않는다. 원시는
`/tmp/oma-macos-staged-owner-{process,native-linux-dev-bind,linux-execution}.tap`에 있다.

### helper의 첫 instruction 전 gate — 후속 입력 / Darwin NOT_RUN

public one-shot constructor에 `WaitForDebugger`를 명시하는 선택적 시작 정지를 추가했다.
[고정 launchd manual](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/man/launchd.plist.5#L288)과
[START_SUSPENDED 연결](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/src/core.c#L4608)을 대조했다.
fixture는 launchctl PID를 hint로만 쓰고 새 kernel task-name capability·실제 stopped generation·선택 CDHash를
확인한다. token·generation·정지 상태를 다시 확인한 뒤 SDK token으로만 SIGCONT하며, 후속 Mach ACK는 그
full token과 같아야 한다. task-name 반환·wrong image 거절·같은 CID·release 전 trace 부재도 별도로 대조한다.
이 시작 정지는 protected script/library generation이나 제품 scope/journal producer의 완료가 아니다.

공통 owner8개 state-machine·기존 process·job constructor는 합계54/54, parser/Seatbelt/constructor47/47이
통과했다. 최종 Linux native 실행/crash53/53도 PASS·fail/cancel/skip/todo0이다. 원시는
`/tmp/oma-macos-helper-stop-{process,focused,linux-native}.tap`다. 실제 Mac 시작 정지는 새 CI에서 확인한다.
현재 source에서 두 ownership guard만 제거한 별도 임시 module의007/008은 모두 실제 실패했다.
이는 state-machine negative control이며 kernel proof나 이전 committed 입력의 실행으로 계산하지 않는다.
중간 Linux 재실행은 double-fork의 orphan 단일 조회에서52/53이었다. 기존 fixture는 report의 생성만 기다려
기록 완료나 중간 parent의 exit/reparent와 동기화하지 않았다. 어느 창이 해당 실패였는지는 원시만으로
확정하지 않는다. 완전한 report와 실제 namespace-init children/PPid를 같은 기존10초 한도에서 관측하도록
수리한 뒤 전체53개를 다시 실행했다. 실패는 `*-linux-native-orphan-failure.tap`에 보존하며, 종료 후 후손 사망
assertion이나 실행 선택·예산을 줄이지 않았다.
같은 fixture는 read-only host task/bootstrap/registered-port 취득과 `sudo -n /usr/bin/id -u`를 Host·두 Mach
workload에서 각각 관측한다. self task 양성·각 reference 반환·command 종료와 원시 report를 남긴다. timeout,
부분 report·Host 기준선 부재를 정책 차단 PASS로 읽지 않으며 현재 입력에서 Darwin 결과는 NOT_RUN이다.

### helper 시작 정지의 실제 결과 — source `53f4b54c26d`

Native [41813036923](https://github.com/minjung2035/oma-v2-ci/actions/runs/41813036923)의 양 Mac 각3회에서
regular/pipe gate 모두 OBSERVED다. public WaitForDebugger는 helper를 status4로 정지시켰다. Host는 실제
task-name token·선택 CDHash 일치·다른 image 거절·trace 부재를 확인하고, 다시 같은 generation/token을
대조해 SIGCONT했다. 이후 helper의 Mach ACK가 그 full token과 일치했다. launcher→Node의 두 stop·실제
stdio bytes/EOF·정상 도구·CID/registration 반환도 유지됐다. Mac26 114 OBSERVED/6 SETUP_FAILED·Mac15 111/9다.

Host의 `sudo -n id -u`는 두 OS 각3회 exit0·UID0이었지만 두 Mach workload 각6회는 spawn EPERM이었다.
task-control/name 취득은 sandbox에서 status5였다. 그러나 Host 기준선은6회 모두 SIGSEGV·불완전 report여서
해당 비교는 qualification하지 않는다. crash report는 `_kernelrpc_mach_ports_lookup3`→`mach_ports_lookup`을
가리킨다. 고정 [public wrapper source](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/mach/task.c#L81)는
remote target에 배열을 할당한 뒤 그 주소를 caller의 출력 주소로 사용한다. 추가 probe에서 이 wrapper를
원격 task에 사용한 것은 부적절했다. 후속 fixture는 고정 MIG query의 세 SEND 출력만 caller stack으로 받아
반환한다. fixture-only SPI이며 production API/권한 우회로 채택하지 않는다. 수정 뒤 실제 Mac은 NOT_RUN이다.

입력15832개 `853989920c9c7bba7b5b8a639428cc4388a350b11f3eaaf397bb97947f09002a`와 runtime은 전후 같다.
API SHA-256 Mac26 `0f52a75976e4433fd26d2f8a3f7a01fe864f0a9cd6048a0e4a78c92497b10ae4`·Mac15
`3e0d601bf4792ac1780c39dcad7dabdfa5d213515ea77ff730277d01a2baad29`를 대조했다. artifact·요약은
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/helper-stop/`다. 로컬 `326f7ab23b7`의15개 blob와
tree `77a69b77b0a211f760b93fc20ef0aaeb63716805`가 모두 같은 GitHub API commit이다. SSH key 거절 뒤 연결
도구로 해당 branch를 expected-head·non-force 갱신했다. 원래 로컬 commit은 checkpoint branch에 보존했다.
제품 BLOCKED·세 gate OPEN·legacy recovery 거절은 유지한다.

### held image digest와 production private profile — 후속 입력 / Darwin NOT_RUN

`machoImageCdHashes`는 held bytes에서 CPU별 thin/fat Mach-O의 CodeDirectory hash만 추출한다.
[고정 code-signature layout](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/cs_blobs.h)과
SDK loader/fat header를 대조했다. 잘린/중복/겹친 범위·지원하지 않는 hash/architecture는 거절한다. 이 digest
선택은 page/CMS 검증이나 설치 generation proof가 아니다. Host fixture는 같은 held regular bytes의 전후 metadata와
full SHA-256을 남기고 독립 codesign의 CDHash와 대조한 목록을 실제 stopped-image requirement에 사용한다.
Linux에서 Zig가 만든 실제 arm64 Mach-O의 CDHash는 독립 Python hashlib 결과와 같았다. 이는 file-format 관측이다.

production `oma-seatbelt`는 private profile FD3의 전체 frame/EOF·sandbox 적용·FD pruning 뒤 선택적으로
SETEXEC|START_SUSPENDED한다. 기존 target input과 FD7은 유지하며 실패 시 unconfined exec로 가지 않는다.
Mach gate는 profile을 별도 fileport/pipe로 전달하고 그 writer의 실제 반환도 기다린다. 오류 시 scope 종료를
먼저 요청해, 정지한 target이 읽지 않는 profile pipe의 drain을 기다리는 교착을 피한다.
이 production helper의 두 번째 stop·private profile 조합과 held-byte 선택의 실제 Mac은 새 CI에서 확인한다.
workspace build·관련107/107·C4개 SDK object compile은 PASS이며 제품 scope/journal/auth 연결은 미완료다.
Linux의 독립 packed 설치27/27도 통과했다. 새 Mach-O export는 설치된 package에서 import하고 Linux ELF를
거절했다. 기존 외부 선언 diagnostics44의 범위는 유지하며 이를 전체 diagnostics0으로 보고하지 않는다.
root/helper/Node의 cwd는 recipe의 작업 디렉터리를 사용한다. 생성된 Node fixture도 별도로 syntax 검사했다.
task-port adversary는 control/name과 선택적으로 존재하는 read/inspect export를 각각 관측하며, export 부재는
거절 성공으로 계산하지 않는다. 근거는 `/tmp/oma-macos-private-profile-{focused,isolation,build}.log` 또는 `.tap`다.

### production private profile의 실제 결과 — source `5923a679c58`

Native [41816225702](https://github.com/minjung2035/oma-v2-ci/actions/runs/41816225702)의 양 Mac 각3회에서
regular/pipe gate 모두 OBSERVED다. held helper/Node/launcher bytes의 CDHash가 독립 codesign과 일치했고,
그 목록으로 실제 stopped image를 검증했다. production `oma-seatbelt`는 fileport FD3의 profile frame/EOF를
소비한 뒤 Node를 SETEXEC|START_SUSPENDED했다. 다른 pidVersion의 최종 Node 검증·Host release·정상 tools/DNS·
stdio bytes/EOF·profile writer 반환·CID ESRCH/registration113을 모두 확인했다. 각각 Mac26 114/6·Mac15 111/9이며
제품 BLOCKED다. protected script/library generation·제품 scope/journal/auth producer의 qualification은 아니다.

수정한 Host task-port probe6회는 exit0이다. Host는 control/name/read/inspect API 모두 존재하고 취득0이었으며,
control port의 bootstrap 조회0을 확인했다. name 조회4·read/inspect 조회20도 별개로 남겼다. sandbox의12회는
control/name 취득5·read/inspect 취득-1이었다. 이들 API 외의 권한 경로나 expected Broker를 증명하지 않는다.
caller-stack MIG 조회로 바꾼 결과이며 앞선 public-wrapper SIGSEGV를 소급 PASS로 바꾸지 않는다.

입력15834개 `63e33490f37d60684af439a792853062c657750b2d4b50509a0c6a3bb9ca50d0`와 runtime은 전후 같다.
API SHA-256 Mac26 `4b3482482199e8341b8289bc7c88cd376ef1f86345fa43e7128c0d6afced5148`·Mac15
`a36a566b3ea2066475b4f8cf629c66738f911b0cad72baa5679c90a48c423206`를 대조했다. 원시와 요약은
`/home/dev/oma-audit-artifacts/macos-native-2026-11-04/held-profile/`다. 로컬 `57be0da077c`와 같은
tree `39c09b93561a13386b966b7a902db16278c55187`를 expected-head·non-force로 발행한 입력이다.

별도 Architecture [41813037141](https://github.com/minjung2035/oma-v2-ci/actions/runs/41813037141)의 이전
`53f4b54c26d` native-all은 **4759/4759 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges=[]**다.
13 command 모두 code0이며 API SHA-256 `cffcdb2de695b45952f549aba8f47acc7cf3a4f5995f22bee7003a64628622de`와
대조한 artifact는 `helper-stop/linux-all-art-13315381089/`에 있다. 후속 source의 전체 PASS로 합산하지 않는다.

### 공통 process의 실제 stream source 관측

`observeProcessIO`와 `startProcess`는 같은 capture/spool/sink/timeout/silence/abort/drain 구현을 사용한다.
OS adapter는 실제 producer의 terminal/close와 owned stdio stream·종료 capability만 공급한다. 공유 owner가
각 stdio의 실제 close를 따로 기다리며, live scope pin·현재 권한·journal retire는 execution owner에 남는다.
이 observer는 process를 만들거나 command 실행·scope death를 증명하지 않는다.

실제 anonymous pipe·독립 producer의 input snapshot/whole spool, producer exit 뒤 후손이 잡은 stdio tail,
실제 exit0 뒤 관측 오류, 이미 취소된 live source의 종료/FD 반환, EOF 없는 reader 반환5건을 추가했다. 새 observer 중간 버전은
producer close를 stdio 반환으로 읽어3건에서 tail 유실/조기 closed를 보고했다. 원시는
`/tmp/oma-macos-process-io-producer-close-red.tap`에 보존했다. 별도 EOF 반례도 수정 전 실제 실패했다
(`process-io-short-eof-red.tap`). 공유 owner의 stdio join/EOF 검사 뒤 process/async76/76과 실제 Linux
scope/crash/native53/53이 통과했다. 이는 위 Darwin producer와의 제품 연결이나 전체 회귀 PASS가 아니다.
같은 수정의 독립 packed 설치27/27도 통과했다. 외부 선언 diagnostics44의 기존 범위는 그대로이며,
소유한 stream의 complete EOF와 물리 close·producer close를 함께 관측해야 정상 결과가 된다.

### Darwin의 fresh process pin — 실제 Mac 실행 전

`pinDarwinProcess`는 process event queue를 먼저 등록하고 kernel task-name reference의 전체 audit token을
전후 generation·boot/CID·BSD 상태와 대조한다. 같은 generation의 stopped 상태에서만 resume하며,
종료는 내부 kernel token의 SDK 제어만 사용한다. exec/exit/관측 오류와 close는 재사용을 거절한다.
이는 sender/role/current authority나 scope death 증명이 아니다. 기존 member 제어도 libproc의 반환값
`0 또는 errno`를 직접 읽도록 고쳤다. ambient errno는 이 API의 반환 계약이 아니다.

기존 실제 Mach gate에 production pin을 연결했다. 별도 one-shot helper의 첫 명령 전 취소·CID 소멸,
helper resume, Seatbelt→Node 같은 PID의 이전 pin 제어 거절, 새 Node pin과 실제 종료·task/queue 반환을
검사한다. 로컬 native/platform/parser120/120과 추가 parser 반례37/37은 통과했지만 이 입력의
**실제 Mac 동작은 NOT_RUN**이다. process I/O5개와 execution preparation/terminal8개도 common
runtime CI에 추가해 두 OS의 실제 kernel에서 실행한다. parser 합성 입력을 kernel 근거로 쓰지 않는다.
같은 로컬 수정의 공유 owner/pipe13/13·독립 packed 설치27/27·전체 구조 검사도 통과했다.
외부 선언 diagnostics44와 review ledger의 미검토 상태를 성공으로 재분류하지 않았다.

직전 `5923a679c58`의 Mac runtime artifact도 회수·API SHA-256 대조했다. Mac15·26 공통 각293/293·skip0,
packed 각26/27이며 실패는 기존 Git preparation `UNSUPPORTED_PROFILE`다. 원시는 `held-profile/art-13314678054/`·
`art-13315576051/`이며 SHA-256은 각각 `516e55a0324d0eb0e379ea49f52488fe1b4dfa8cccaa49b0a3660bbcb33258c8`·
`c00ed59530a244845e1a3f7a8db7f39636ced1bce3d772c63e6556819f76630a`다. 두 artifact의 canonical/runtime
입력은 전후 같다. 이 결과를 새 process pin이나 Darwin 제품 PASS로 확대하지 않는다.
같은 source Architecture [41816225769](https://github.com/minjung2035/oma-v2-ci/actions/runs/41816225769)의
Linux native-all은 **4762/4762 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges=[]**다. 13 command
모두 code0이며 artifact `13315353900`의 API SHA-256
`48fe128087b6a256dfaf374c826265cc609eec8fb7677e2535ecb0a16d66e2b1`를 대조했다.
이는 새 pin 변경 전 입력이며 `held-profile/art-13315353900/all/result.json`에 보존한다.

### Fresh process pin의 실제 Mac 관측

Native [41822856093](https://github.com/minjung2035/oma-v2-ci/actions/runs/41822856093), `7effb8103ca`의
Mac15·26 각 regular/pipe3회, 합계12 gate가 OBSERVED다. production pin의 stopped helper resume,
별도 one-shot의 첫 명령 전 exact-token SIGKILL·trace 없음·CID empty·registration113, 같은 PID의
Seatbelt→Node exec 뒤 old pin `changed`/resume=false/terminate=false, 새 Node pin stopped→exited와
dead terminate=false, 모든 task-name/queue 반환을 확인했다. 이는 실제 PID 번호 재사용이나 제품 전체 복구 증명은 아니다.

양 Mac common은 각306/306·skip0으로 새 실제 pipe5개와 공유 owner 상태8개도 실행했다. packed는
기존 Git preparation 차단으로 각26/27이다. 입력15835개 `e684025c62f3e57fc7210823512169cbaed4fb7dfa812a2368290ddcc81f2ba1`와
runtime은 gate/common 모두 전후 같다. root `process-pin/`의 gate artifact Mac15 `13318266538`·Mac26
`13317194451`는 API SHA-256 `e51ad7fa2c3110773199ce3c81cb5688f613531ba015d4ecfd3d6ebdf1f5a58e`·
`de2f1ae87e04a6c46f8383e5a5dedcd37a1d4416277b8d713c62208ecee5e752`와 대조했다. common `13317014116`·
`13318415913`의 SHA-256은 `2edf17aa9816d194dffbb1ac8f0caabb9707b5ce048a42cc0f4afa986007939c`·
`917fd6b9b0a375d7dd3394d8026733f1622d35bd64ffa43710eb2c4abdf9ee7c`다. 모든 product gate는 OPEN이다.

### Production job helper의 private 설정·held cwd — 실제 Mac 실행 전

기존 controlled Mach helper를 `@oma/platform-mac`의 compiled asset으로 이관했다. workload argv/env는
public launchd definition에서 제거하고 authenticated Host의 별도 fileport에 `OMAJOB1` frame으로 전달한다.
C decoder는 완전한 frame/EOF·총량·개수·stdio/중복/범위·문자열·환경을 검사한다. cwd도 별도 held-directory
fileport의 `fchdir`이며 Node Host의 cwd는 바꾸지 않는다. 진단은 전달된 private FD에만 기록하고,
child에는 명시한 descriptor만 `CLOEXEC_DEFAULT` file actions로 준다. 단일/두 image stage를 지원한다.
setup alarm과 workload deadline을 분리하고 workload 중 original Host generation 손실을 관측한다.

실제 portable C decoder에서 빈 인자·개행·한글·환경·literal shell metacharacter의 bytes와 snapshot,
잘린/초과/불법/중복/trailing frame 거절을 실행했다. 관련 platform/parser108/108·skip0과 실제 SDK26.5
arm64 object compile도 통과했다. 최초 golden 문자열 길이의 1-byte 오기는 시험 작성 오류로 정정했으며
제품의 수정 전 실패 근거로 쓰지 않는다. 이 입력의 **실제 Mac helper 실행은 NOT_RUN**이다.
같은 production helper를 기존 실제 Mach gate에 연결해 foreign CONFIG fileport 거절과 FD 반환을
검사하도록 했다. 기존 C fixture 복사본은 제거했다. 아직 제품 scope/journal producer 연결·전체 gate 완료가 아니다.
cwd의 원래 경로를 다른 inode로 바꾼 뒤에도 held directory에서 상대 쓰기를 하고 replacement에는 효과가
없는지, Host cwd가 보존되는지도 실제 Mac oracle에 추가했다. 위 portable C decoder와 추가 parser38/38,
독립 packed 설치27/27·구조 검사·생성된 controlled Node syntax도 통과했다. XNU의
[fileport 전송 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_descrip.c#L390)는
`DTYPE_VNODE`의 전송 가능성을 설명하지만 실제 directory handoff의 대체 근거로 쓰지 않는다.

### Bundled helper의 실제 Mac 관측과 queue 재전달 수정 전 실패

Native [41824850066](https://github.com/minjung2035/oma-v2-ci/actions/runs/41824850066), `ace1216238e`의
production helper는 양 Mac 합계12 gate 중11회 OBSERVED다. private 설정·foreign CONFIG fileport 거절,
production Seatbelt→Node stop, cwd 경로 교체 뒤 원래 held inode에서 상대 쓰기·replacement 효과 없음·Host cwd
보존을 확인했다. Mac26 마지막 pipe gate는 READY 전에 전송 `again`을 `sent`로 단정한 fixture assertion으로
실패했다. 진단 trace는 다섯 FD import까지이며 READY는 미관측이다. CID 소멸과 private 설정/프로파일/pipe
핸들 반환은 확인했지만 이를 성공 실행으로 바꾸지 않는다. source binding15839개
`3189100e6e802b4bb4557588a8a5a87dcd609efddf9741913a41fb3f11840ded`와 runtime은 전후 같다.

Mac15 첫 bootstrap case는 gate6회와 별개로 최종 fixture cleanup에서 실패했다. label reuse의 새 CID actor가
`release` 뒤 one-shot 자동 반환한 다음 `bootout`3이 보고됐다. 새 수정은 이 controlled replacement의 실제
boot/CID empty와 현재 registration113을 모두 확인한 경우에만 자동 반환으로 기록한다. 제품 복구나
일반 bootout 반례의 성공 조건은 바꾸지 않는다. queue retry는 기존 예산 안에서 `again`만 기다려 재전달하고,
오류/초과는 그대로 거절한다. 별도 실제 Mach queue를 채워 fileport 재전달·실패한 SEND copy 반환 뒤 EPIPE를
검사하는 permanent oracle을 common Mac CI에 추가했다. 이 새 반례의 실제 Mac 실행은 **NOT_RUN**이다.

원시는 `job-helper/observed-helper-summary.json`과 artifact Mac15 `13319775290`·Mac26 `13317594284`다.
API SHA-256은 각각 `6b2784218be4ad02d7d40b5de4e41ffb6f8717c59ec94e84b4edd7d938048bc8`·
`a08417f0235c7d778deae528627ab6dfa0173dbfa59b2500f2bad37cb3ac3595`와 대조했다. 두 Mac common307/307·skip0,
packed 각26/27의 Git preparation 실패도 보존했다. common artifact `13319506520`·`13319466622`는
`e6682cec8cc091742986fb10c71c08d73228943fac9013fd9b83887529607a2e`·
`130dad282634cda73812a4adc728f1336310b1ffa141046dae5fd84e89ebc55c`와 대조했고 입력/runtime은 전후 같다.
로컬 retry 수정의 native/platform/parser121/121과 별도 parser/플랫폼 거절38/38이 통과했다.

### Helper delivery 수정의 실제 Mac 관측

Native [41828317248](https://github.com/minjung2035/oma-v2-ci/actions/runs/41828317248), `8a2c2b59e50`의
Mac15·26 regular/pipe 각3회, 합계12 gate가 모두 OBSERVED다. 이 실행의 자연 backpressure counter는
모두0이며 이전 실패를 자연 재현했다고 쓰지 않는다. 별도 permanent oracle은 두 OS에서 실제 Mach queue를
채워 fileport send를3회 `again`으로 만든 뒤 성공 재전달·같은 pipe bytes·모든 reader reference 반환 뒤 EPIPE를
확인했다. common 각308/308·skip0이며 packed는 기존 Git preparation 차단으로 각26/27이다.

원시는 `helper-delivery/`다. gate artifact Mac15 `13322020601`·Mac26 `13322275847`의 API SHA-256
`b1baa99e91e0da49eecb1f85b15b4cf0d54d38bb50f4f783b5e68002d9161297`·
`5b421a224d28adaabddcd8519cdca42a2283923c6c526d67004d9f0d45bc085e`, common `13322446455`·`13323036069`의
`d84e9151a80f0af4eee1b3c00ed745b08eb10fc41d7614eb1951653a537d8899`·
`eed0618c78e26ee3aab7b5518be732508d3c90f47c65b0f5bb45b0da21457137`를 대조했다. common 입력/runtime은 전후 같다.
source의 입력은15840개 `d360df303c1027ba2ad0d0396c0ef7ee73ece885d8dc9ff9014cc1ac2ad734cc`이며 제품 gate는 OPEN이다.

### 공통 owner에 연결한 transient Darwin scope — 실제 Mac 실행 전

`launchDarwinJobScope`는 같은 `observeProcessIO`의 input/capture/spool/sink/timeout/abort/EOF owner와
production job helper의 실제 terminal/close를 연결한다. helper의 selected stopped main image를 먼저
확인해 transient boot/CID를 반환하고, 공유 owner가 witness를 publish한 뒤 lazy prepared로 private 설정과
다음 image stage를 준비한다. 최종 gate는 공유 owner의 fresh authority 관측 뒤에만 연다. 멤버 제어는 fresh
kernel token이며 CID population·leader terminal·stdio EOF·native callback/설정 pipe 반환을 각각 기다린다.
이 transient producer는 installed script/library·expected Broker/role을 보증하거나 새 durable witness를 기록하지 않는다.

파일은 기존 descriptor leaf로 regular type-before-I/O와 held cwd를 얻는다. 실제 anonymous pipe를 libuv
Socket으로 감싸 큰 stdin·private setup·stdout/stderr가 threadpool을 서로 막지 않게 한다. Linux의 별도 실제
pipe 실행에서 입력3개 합계3145749 bytes와 독립 output2개, 다섯 handle close를 확인했다. 이는 Mach 증명이 아니다.
Mac용 세 permanent scenario는 공통 coordinator의 memory journal에서 전체 spool/CID 정리, fresh authority 거절,
production Seatbelt private EOF→Node stop/출력/금지 canary를 검사한다. raw scope는 단일 최종 image만 선택한다.
Seatbelt scope는 adapter가 직접 recipe와 두 번째 stop을 강제하고 준비 단계의 DYLD/LD loader override를
job 생성 전에 거절한다. caller가 `suspendExec:false`를 줘도 최종 gate는 보존한다. 현재 build와 관련 local113/113는
통과했으며 이 세 실제 Mac scenario는 **NOT_RUN**이다. Linux에서는 세 scenario의 platform refusal만 실행했다.
legacy launch/recovery guard·durable journal codec과 Linux backend는 그대로이며, 실제 producer/recovery proof 뒤에 연결한다.
현재 adapter의 독립 packed 설치27/27과 전체 구조 검사도 통과했다. 외부 선언 diagnostics44와 ledger 미검토는 유지한다.
별도 `8a2c2b59e50` Architecture [41828317180](https://github.com/minjung2035/oma-v2-ci/actions/runs/41828317180)의
Linux native-all은 **4769/4769 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges=[]**, 13 command code0다.
API SHA-256 `871ea53a0e29ff9ebba622771e0b67f539f9ca8da48ef9266f0d1f1a5f79254a`를 대조한
`helper-delivery/linux-all-art-13324900868/all/result.json`에 보존했다. 새 scope adapter의 runtime PASS로 합산하지 않는다.

### transient scope 첫 실제 Mac 관측과 journal 파일 검증 준비

`cc2207da880` Native [41837425198](https://github.com/minjung2035/oma-v2-ci/actions/runs/41837425198)의
Mac common ZIP `13326787971`·`13325464931`의 API SHA-256
`7ebe5f643f13e20b13a936128f3672b15560c586ed39ed4f9cfdcd30bd15f071`·
`7a0dab1ed3a1552fe1a725bd50c0d34c623662ce9eab54d82347fbd039ffdc1f`를 대조했다.
새 raw producer의 실제1MiB stdin·전체 stdout spool·stderr·publish→authorize→retire/CID 정리는 양 OS에서 통과했다.
권한 철회는 Mac15에서 통과했으나 Mac26에서는 publish 전 거절로 기대 trace를 충족하지 못했다.
기존 테스트의 포괄적 `assert.rejects`가 실제 cause를 숨겼으므로 정확한 authority 오류의 동일성까지 검사하도록 강화했다.
Seatbelt 통합은 두 OS 모두 테스트의 필수 HOME/TMPDIR 누락으로 생성 전 거절됐으며 runtime 성공으로 쓰지 않는다.
테스트의 owned writable root와 명시적 환경 allowlist에 두 값을 추가했다. 이 수정 뒤 실제 Mac은 아직 NOT_RUN이다.
common 전체는 Mac15 **311/312**, Mac26 **310/312**, skip/cancel0이며 packed26/27의 기존 Git preparation 거절은 남는다.
원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/job-scope/`에 보존한다.

같은 source의 gate ZIP `13327162494`·`13325958543`의 SHA-256
`2abea55c850df59d8c93ed30331e5c975ba4110bf84bbd9385d531284ca82022`·
`e83012ddaeb817234cebc54fce0fb999ae38a2ebe6b0210596e98c11e0ab212d`를 대조했다.
120건 중 Mac15는111 OBSERVED/9 SETUP_FAILED, Mac26은114 OBSERVED/6 SETUP_FAILED다.
worker6건은 기존 native-support의 product gate 거절이며 Mac15 Git setup3건은 selected Xcode가
sandbox 밖 MobileDevice private framework를 요구해 실패했다. 이 입력에서 전체 gate PASS를 주장하지 않는다.

새 `execution-journal-files`는 기존 version2 bytes의 실제 append/reopen·SIGKILL 뒤 opening/witness 보존·
잘린 tail 거절을 두 OS의 공통 CI에 추가한다. legacy Darwin witness는 형식 데이터이며 live/recovery authority가 아니다.
새 codec이나 기존 bytes migration은 없으며 Mac descriptor I/O 확인 뒤 durable producer를 연결한다.

### society lease 후보의 실제 반례 준비 — Mac NOT_RUN

기존 Linux abstract AF_UNIX lease는 마지막 상속 FD가 닫힐 때까지 같은 이름을 배타 소유한다.
Mac에서 pathname flock으로 바꾸면 같은 UID의 unlink/rename 반례를 되살리므로 대안으로 채택하지 않는다.
다른 후보는 ordinary user launchd의 managed Mach receive queue에 OWNER 메시지를 소비하지 않고 두는 것이다.
고정 [XNU mach_port_peek 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/mach_port.c#L928)은
queued message의 kernel audit trailer를 비소비 조회하며, 고정 [launchd backup-port 구현](https://github.com/apple-oss-distributions/launchd/blob/d448a1c8f70a61202f8705f94337f686b87c30c4/src/core.c#L7403)은
helper death 뒤 receive right를 회수하는 경로를 가진다. 선언/source만으로 재시작 후 queue 보존을 보장하지 않는다.

새 controlled probe는 genuine Host 메시지를 남긴 keeper를 fresh kernel token으로 종료한 뒤 두 번째 keeper가
같은 실제 audit trailer를 보는지 검사한다. 이어 별도 launchctl 프로세스의 같은 UID bootout 뒤 동일 service name을
다른 job이 다시 등록하고, 여전히 살아 있는 두 번째 Node sender가 새 claim을 enqueue하는지 검사한다.
원래 Host도 계속 살아 있으므로 이름 재사용이 가능하면 society lease 후보는 **REJECTED**다. probe 성공은 제품 성공이 아니다.
probe는 privileged service나 business runtime이 아니며 제품 lease/launch guard를 바꾸지 않는다.
SDK26.5 arm64 `-Wall -Wextra -Werror` object compile과 Linux의 명시적 Darwin primitive 거절만 확인했다.
실제 Mac queue 보존·same-UID 철회 반례는 아직 **NOT_RUN**이며 새 format/caller에는 연결하지 않는다.

### journal 접근·owner 요청 종료의 실제 실패와 수정 — 새 Mac 미실행

`fa637ad97ce` Native [41839739427](https://github.com/minjung2035/oma-v2-ci/actions/runs/41839739427)의
Mac15 common ZIP `13329245946` SHA-256 `084230d0a85b591f59eeada26c8c0efa5a4fb852e5c0e83ddab5e250a2cb8455`,
Mac26 `13326869759` SHA-256 `6cc843d0cf34836fbd0319aa43d1ba22d77065961592a0f12c779341faec2465`를 대조했다.
두 OS 모두 **311/316·fail5·skip/cancel0**이며 input/runtime은 전후 같다.
수정한 Seatbelt 통합은 양 OS에서 실제 private profile EOF→selected final Node stop→fresh authorize→
1MiB stdin/출력/금지 canary 보존과 CID 정리를 통과했다. 공통 owner의 journal은 아직 memory다.
권한 철회는 두 OS 모두 실제 authorize에 도달했지만 owner가 helper를 종료한 것을 예상 밖 terminal 손실로
처리해 `RUN_TERMINATION_UNKNOWN`을 덧붙였다. 나머지4건은 journal의 read-only event FD를
`/dev/fd`로 read/write upgrade하려다 EACCES가 난 실제 파일 접근 실패다. 이 결과를 product PASS로 쓰지 않는다.
원시는 `job-scope/followup/`의 SHA 검증 ZIP과 `tests.log`다.

새 수정은 journal에 필요한 read/write·append 권한을 처음부터 명시적으로 취득한다.
Darwin은 kernel beneath/no-link와 O_EVTONLY·O_NONBLOCK으로 열린 같은 FD에서 regular type을 확인한 뒤에만
data I/O를 한다. `/dev/fd` upgrade·pathname 재검사 후 재열기·독립 cursor claim은 없다.
읽기 전용 기본 capability와 일반 metadata pin은 read/write로 바꾸지 않으며 Linux O_PATH 경로도 보존한다.
permission-independent pin이나 모든 device driver의 open 부작용까지 증명한 것으로 읽지 않는다.
새 검사는 held inode의 경로 교체 뒤 append, read-only 쓰기 거절, symlink 거절, bounded FIFO 거절과
queued bytes 미소비를 실제 kernel에서 확인한다. journal 형식/기존 bytes는 변경하지 않는다.

owner 요청의 stop과 관측 실패 뒤의 내부 cleanup을 구분했다. 실제 helper exit 또는 CID 소멸을 본 뒤
owner 요청 stop의 terminal 알림을 완료하되 child wait status는 만들지 않는다. 선행 관측 실패는 남으며,
전체 scope의 positive empty와 capture/pipe/callback 반환·close는 공유 owner가 여전히 따로 요구한다.
기존 fresh authority 거절 외에 실제 workload 시작 후 abort와 witness publish 직후 trusted setup 이전 취소를 추가했다.
새 Mac 관측은 아직 **NOT_RUN**이며 legacy launch/recovery guard와 세 product gate OPEN을 유지한다.

lease probe 첫 source `b94338eda7d`의 Mac26 common ZIP `13329971187` SHA-256
`f60e0fb6320aeb339a0c548122271466f17f4f15b1be281afec2fc001e799404`를 대조했다.
probe는 내가 Native send API의 4-byte alignment 계약에 맞지 않는5-byte body를 전달해 메시지 enqueue 전 TypeError로 실패했다.
keeper compile은 통과했으나 queued sender·crash·이름 철회는 아직 실행 근거가 없다. body를4 bytes로 고쳤다.
또 고정 [ipc_kmsg 초기화](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/ipc_kmsg.c#L524)와
[peek 복사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/mach_port.c#L966)를 대조해,
receive copyout과 달리 peek의 stored trailer header는 minimum-size 그대로이고 반환 count가 복사 bytes를 정함을 확인했다.
count와 format을 검증하고 stored size는 raw 관측으로 남긴다. 실제 Mac 재관측 전 후보 판정은 유지한다.

현재 수정본 build와 local59/59·fail/cancel/skip/todo0, 별도 실제 Linux namespace/credential/Git53/53을 확인했다.
`/tmp/oma-macos-journal-access-release-{build.log,local.tap}`와 `journal-access-linux-native.tap`가 명령 결과를 소유한다.
Mac scope scenario는 이 Linux 실행에서 platform refusal만 검증했으며 Mac stop 성공으로 합산하지 않는다.
Darwin event acquisition에는 NONBLOCK/NOCTTY를 명시해 writer 없는 FIFO도 bounded하게 검사하며,
regular 여부를 확인하기 전에 data read/write를 하지 않는다. 실제 Mac의 read/write·append/abort 판정은 아직 미실행이다.
CI는 공통 runtime 테스트 직후 source/runtime 전후 digest와 raw TAP을 별도 `native-shared-*` artifact에 보존한다.
기존 전체 공통 artifact·독립 package 검사와 최종 입력 비교도 유지한다. 앞선 실패 결과는 바꾸지 않는다.

수정본의 독립 packed 설치27/27와 전체 구조 검사도 통과했다. 외부 선언 diagnostics44와 ledger 미검토는 유지한다.

### journal 접근·stop 수정의 실제 양 Mac 성공과 lease 후보 배제

`bb3d4fa43dc`의 push에 실행이 생성되지 않아 같은 tree의 CI 요청 commit `c87459f24b1`을 발행했다.
Native [41844076058](https://github.com/minjung2035/oma-v2-ci/actions/runs/41844076058)의 eager Mac15 ZIP
`13330661170` SHA-256 `72a2bba3bc1c1a7cbee09a5deae068518925dd067055d7bbb7b35cd5d571ff02`, Mac26
`13330312502` SHA-256 `7b61dc159e7937a529738058a6976ae4027dc8c0675d845143fe069b7aaec4c7`를 대조했다.
양 OS **322/322·fail/cancel/skip/todo0**, source/runtime 전후 동일이며 입력은15847개
`330a23b1445e79c320470c18915a3926f0c6672ea13bb41486494c4114efd9aa`다.
실제 read/write append·read-only 쓰기 거절·link/FIFO 거절과 queued data 미소비, journal v2 append/reopen/
SIGKILL 보존·잘린 tail 거절, shared owner의 authority 철회·실행 중 abort·witness 직후 취소가 통과했다.
세 product gate OPEN과 app legacy launch guard는 유지한다.

lease probe도 양 Mac에서 실제 kernel sender를 keeper crash 뒤 보존했으나, 같은 UID의 bootout 뒤
서로 다른 두 살아 있는 owner가 같은 service name의 claim을 만들었다. 따라서 이 managed-Mach 후보는 **REJECTED**다.
returned trailer52 bytes와 stored minimum header8도 실제 관측과 고정 kernel source가 일치했다.
원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/journal-access/`에 있다.
전체 common ZIP Mac15 `13330332933` SHA-256 `b4935efe5c791baec1203d73ca692b2776bf930a21d7038fda5eb11e67bc1f5f`,
Mac26 `13329819738` SHA-256 `9bfc288c5034be1334785fb8210e03cf2956940dd0a86d3ffec7281db9f84061`도 대조했다.
common322/322·packed26/27과 기존 Git preparation 거절, 입력/runtime 전후 동일을 확인했다.
gate ZIP Mac15 `13329709901` SHA-256 `0b6dca690a6fbf746ee182cd5ee0c2ce6da33e26a0213a0ef64fb0eae98e2c70`,
Mac26 `13331091517` SHA-256 `b4a063ee39055e69b3fee7173975f42717ab3acbfd537a9f32383e94aff3afe3`를 대조했다.
각120건 중111/114 OBSERVED이며 product는 BLOCKED다. 전체 gate 성공으로 읽지 않는다.

이전 `cc2207da880` Architecture [41837425337](https://github.com/minjung2035/oma-v2-ci/actions/runs/41837425337)의
native-all ZIP `13328714458` SHA-256 `4adca9269aed9e9075ac3b926e2cd7c484c2e3dda50d485eee96682a3464f7d1`도 대조했다.
그 입력의 실제 Linux all은 **4773/4773·fail/cancel/skip/todo0·errors[]·sourceChanges=[]**, 13 command code0이다.
`job-scope/linux-all-art-13328714458/all/result.json`이 원시이며 새 v3 코드의 전체 회귀로 승격하지 않는다.

### 명시적 Darwin v3 writer와 새 controller 복구 — 실제 Mac 실행 전

기존 v2 grammar를 넓히거나 저장 bytes를 다시 쓰는 대신 별도 v3 writer를 선택했다.
기본 writer·초기 frame은2를 유지한다. reader는 각 frame의 version과 해당 version의 닫힌 witness grammar로
원래 hash chain을 검증한다. v3은 `{kind:"darwin-resource-coalition",bootId,coalitionId}`만 새 관측으로 기록한다.
PID·label·token·command·accepted 업무/credential은 기록하지 않는다. Linux/legacy Darwin v2 witness를 v3에
쓰거나 v3 witness를2로 쓰면 append 전 거절한다. legacy Darwin bytes는 읽되 recovery는 계속 unavailable이다.
새 형식의 append는 기존 business bytes나 journal의 migration이 아니다.

`job-recovery`는 현재 boot/CID lookup과 fresh kernel-token member control만 공급한다. 자신의 CID는 거절하고,
scan을 death로 바꾸지 않으며 unknown과 signal/자원 실패는 공유 coordinator가 ownership을 유지하게 한다.
공유 owner가 전체 CID empty를 본 뒤에만 journal을 retire한다. app의 legacy launch/recovery guard는 아직 연결하지 않았다.
Linux PID extractor는 새 PID 없는 witness를 PID로 해석하지 않도록 종류를 명시하고 나머지는 거절한다.

실제 Mac용 검사는 Host SIGKILL 뒤 stopped helper witness, 실행 후 detached 후손, Seatbelt 후손을
새 journal owner/controller가 회수하는 세 경우다. opening-only는 bytes를 보존하고 unknown을 유지한다.
opening probe는 launch 전 경계이며 creation→witness 사이의 crash를 안전하다고 주장하지 않는다.
새 controller의 Host 자신 scope 거절과 기존 v2 prefix 보존도 검사한다. Mac은 아직 **NOT_RUN**이다.
현재 build·local63/63·별도 실제 Linux66/66(변경된 topology/candidate 경로 포함)은 통과했다.
local의 Mac recovery scenario는 platform refusal이며 kernel recovery PASS가 아니다.
원시는 `/tmp/oma-macos-coalition-recovery-{final-build.log,local.tap,linux-native.tap}`다.

새 v3 writer/recovery의 독립 packed27/27와 전체 구조 검사도 통과했다. Mac adapter는18 public entries이며 외부 선언 diagnostics44·ledger 미검토를 유지한다.

### fresh Darwin v3 recovery의 실제 성공과 application 연결

`39c533683f3` Native [41847949278](https://github.com/minjung2035/oma-v2-ci/actions/runs/41847949278)의
Mac15 eager ZIP `13331183950` SHA-256 `67bb7ab6737c141acb008378278cc0c82c10cf3cdd9464afb3dc36b90add4a78`,
Mac26 `13332038787` SHA-256 `5669717721123304c7d85f8b31ddf605872261672e8708059aa75c3f0ce930a5`를 대조했다.
양 OS **331/331·fail/cancel/skip/todo0**, input/runtime 전후 동일이며 입력은15850개
`4733b4562ca1414ceaf39a2fd61ce5e536ec38e577d84790f6933f077c60cadd`다.
실제 Host SIGKILL 뒤 stopped helper, raw detached 후손, production Seatbelt detached 후손의 v3 witness를
새 controller가 다시 관측하고, fresh token으로 제어해 CID 소멸 뒤에만 retire했다. 독립 descendant pin도 exited였다.
opening-only는 실제 bytes를 보존하며 unknown을 유지했고, v2 원본 prefix와 hash는 바꾸지 않았다.
자신의 CID 제어와 legacy Darwin PID/session 복구는 거절했다. 이 성공은 제품 lease·actor role·installed JS proof가 아니다.
원시는 `/home/dev/oma-audit-artifacts/macos-native-2026-11-04/coalition-recovery/`다.

이 결과 뒤 application의 Darwin backend에 새 observe/acquire와 명시적 v3 writer를 연결했다.
launch guard는 계속 실제 workload를 만들지 않는다. guard의 positive noncreation을 공통 owner에 알려
실행되지 않은 scope의 opening을 retire하고 반복 시도에서도 원래 UNSUPPORTED_PROFILE을 유지한다.
공통 owner 이전에 object spread가 lazy setup getter를 실행하지 않도록 wrapper는 원래 accessor를 지연 전달한다.
Seatbelt crash의 후속 Mac 검사는 실제 `recoverExecutionState` 조립 경로를 사용한다. 이 application 연결의 Mac은 아직 NOT_RUN이다.
현재 build·local66/66, 별도 실제 Linux66/66은 통과했다. local의 새 Mac scenario는 platform refusal이다.

### expected Broker task-name capability 후보 — 실제 Mac 미실행

기존 nonce·valid signed Node만으로 expected Broker를 정하지 않는다. 후보는 trusted shim이 sandbox 전에
실제 controller의 task-name right를 얻고 full kernel token을 대조한 뒤, discard seed와 그 최소 right만 등록하는 것이다.
production Seatbelt source의 SETEXEC와 Node→C child를 거친 뒤에도 source 조회가 되는지 controlled probe를 추가했다.
product helper에 capability를 넣거나 actor/role 권한을 주지는 않는다.

[고정 kobject 조회](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/mach_debug.c#L531)와
SDK의 IPC_OTYPE_TASK_NAME20을 먼저 확인한다. 사용자 port에 `task_info` RPC를 보내 가짜 응답을 kernel 사실로 읽지 않는다.
[task_info converter](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/task.c#L6458)는
TASK_DYLD_INFO에 더 강한 task-read를 요구한다. probe는 Host bootstrap/registered ports/DYLD info 획득 거절,
관계없는 살아 있는 PID의 task-name 획득 거절, 원래 source와 자신의 CID 조회 결과를 각각 기록한다.
Host CID 조회가 실패한 것을 outside-scope proof로 바꾸지 않는다. genuine own-task name20도 expected Broker가 아니라는 반례를 둔다.
SDK26.5 arm64 `-Wall -Wextra -Werror` object compile만 확인했으며 실제 sandbox/Node 상속·거절은 NOT_RUN이다.
이 후보는 Host death/exec에 따른 revoke와 다른 scope capability 전달도 별도 검증해야 하므로 아직 채택하지 않는다.

### task-name 후보의 첫 실제 Mac26 관측과 strict 상수 수정

Source `d7c8bd14e572` Native [41854973526](https://github.com/minjung2035/oma-v2-ci/actions/runs/41854973526)의
Mac26 eager ZIP `13337093635` SHA-256 `770ee00de7608f95cad13ac7ee2bcadf7d813bb3a2bf06c10129cc6a30cc23f1`를
대조·판독했다. common은 **333/334 PASS·1 FAIL·skip/cancel/todo0**이며 source/runtime 전후가 각각 동일하다.
실패는 마지막 fake user-port 단언에서 IPC_OTYPE_NONE0을 잘못 기대한 것이다. 실제 raw는 public
[IPC_OTYPE_UNKNOWN=~0u](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach_debug/ipc_info.h)4294967295,
queryAttempted=false였다. 성공으로 재분류하지 않고 exact 기대값을 SDK 상수로 수정했다.

실제 앞선 두 row는 Seatbelt/Node 뒤 task-name20·audit8 words·원래 Host token 일치, Host bootstrap/
registered ports/DYLD info 각각 KERN_INVALID_ARGUMENT4, unrelated name 획득5였다. Host PID의 CID 조회도
실제40 bytes·errno0·CID849로 성공했고 자기 CID1067과 달랐다. own-task name20 counterexample의 CID는1067이었다.
따라서 다음 검사는 Host CID 조회의 성공까지 필수로 요구한다. 조회 거절을 outside proof로 바꾸는 대안은 없다.
application guard와 `recoverExecutionState`의 Seatbelt Host-crash 연결도 이 Mac26 source에서 통과했다.
Mac15 common과 Mac26 gate는 cancelled이며 해당 OS/범위의 실행 근거로 쓰지 않는다.

후속 후보에는 독립 Host의 exec/death 동안 원래 task-name right를 실제 유지한 뒤 kernel generation을
재조회하고, 그 전에 등록한 watch의 changed/exited를 대조하는 검사를 추가했다. capability 조회만으로
stale process를 현재 Broker로 승인하지 않는다. 이 추가 검사·상수 수정은 실제 Mac NOT_RUN이며 production 인증은 아직 미연결이다.

### 수동 reboot recovery의 host identity 준비 — 실제 Mac 미실행

`currentDarwinHostId`는 SDK의 public `gethostuuid`를 1초 timespec으로 호출하고, 실패·zero UUID를
`RUN_TERMINATION_UNKNOWN`으로 보존한다. 생성 UUID·PID·pathname을 host identity로 대체하지 않는다.
[고정 Libsystem wrapper](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/gethostuuid.c)는
EPERM 때 등록 callback을 허용한다. OMA는 그 callback을 등록하지 않으며 entitlement가 필요한 private bypass도 호출하지 않는다.
독립 C 프로그램 두 번의 결과와 FFI 결과를 실제 Mac에서 대조할 검사를 추가했다. SDK26.5 arm64
`-Wall -Wextra -Werror` object compile·workspace build·관련 local46/46은 통과했다. Linux의 새 Mac 검사는
platform refusal이며 실제 host identity·reboot는 NOT_RUN이다. 수동 복구 CLI의 Linux guard와 Society lease 조건은 유지한다.

Mac15 candidate의 MobileDevice.framework 오류는 이미 읽기 허용된 `/System/Library`를 지목한다.
gate fixture는 해당 framework와 binary의 실제 canonical path·symlink·UID/mode 또는 조회 오류를 기록한다.
권한·정책·성공 기대값은 변경하지 않았다. alias 원인은 아직 미확정이며 새 관측은 NOT_RUN이다.

### source 39c533683f3의 Linux 전체 회귀 실패 보존

Architecture [41847948809](https://github.com/minjung2035/oma-v2-ci/actions/runs/41847948809)의 native-all ZIP
`13335119096` SHA-256 `5635bccd4f280a10f6a4122ba6c2b834d46f98741798e27e04aa45525a438414`를 대조·판독했다.
all은 **4791/4792 PASS·1 FAIL·skip/cancel/todo0**, sourceChanges[]다. 실패는 status responsiveness001의
mixed event-loop lag323ms가 기존100ms 기준을 넘은 것이다. read lag6ms·write max331ms·inFlight1이었다.
원인과 source 변경의 인과관계는 미확정이다. 별도 로컬 단독 실행은 같은 기준으로 mixed52ms·write76ms·1/1 PASS였으며,
이것을 원래 CI 실패 수리나 전체 회귀 PASS로 바꾸지 않는다. 원시는 `coalition-recovery/linux-all-art-13335119096/`와
`/tmp/oma-macos-linux-status-isolated.tap`다. 최신 전체 PASS 근거는 별도 source의 결과로 유지한다.

### inherited expected-peer native adapter 후보 — 실제 Mac 미실행

`pinInheritedDarwinPeer`는 caller 인자 없이 kernel registered slot1만 취득한다. kernel kobject20을
먼저 확인한 뒤 audit8 words·same UID·fresh unique ID/pidVersion·원래 token·서로 다른 현재 CID를 대조한다.
exec/exit watch는 fresh generation 조회 전에 등록한다. 모든 alive 호출은 다시 token/generation/CID/watch를
확인하고, 거절·오류는 sticky revoke다. durable identity·signal/control·role grant는 이 API에 없다.
복제된 registered send references와 VM array, watch를 한 owner가 반환하며 close 실패도 유지한다.
Koffi의 primitive-array decode가 Uint32Array임을 로컬에서 확인하고 일반 배열로 복사해 cleanup callback을 만든다.

새 Node fixture는 실제 production Seatbelt 아래에서 이 API의 Host token/CID·alive·close를 확인한 뒤,
자기 task-name을 새로 등록해 source-coalition 거절, 살아 있는 user port를 등록해 source-type 거절을 요구한다.
정상 API가 실패하거나 source 조회가 거절되면 성공으로 치환하지 않는다. test recipe의 신뢰된 코드 설치 경로만
read/map 입력으로 추가했고 production policy·job helper의 seed-only 등록과 실행 guard는 그대로다.
build·관련 local56/56·C SDK object compile은 PASS다. 새 Mac scenario의 Linux 실행은 platform refusal이며
실제 Native adapter·counterexample·Broker 채널 연결은 NOT_RUN이다.

### hosted arm64 runner 미취득 취소와 CI 실행 순서

source `d7c8bd14e572`의 Mac15 common check annotation은 `The job was not acquired by Runner of type hosted even after multiple attempts`와
macOS arm64 capacity constraints를 명시했다. 제품 실행 실패나 billing 원인으로 추정하지 않는다.
후속 workflow는 common OS matrix와 gate OS matrix를 각각 max-parallel1로 실행해 동시에4개의 Darwin runner를
요청하지 않는다. Mac26·15/Ubuntu와 모든 oracle·기존 timeout·실패 기준·eager/final artifact는 유지한다.
이 순서 변경의 runner 취득 효과는 아직 NOT_RUN이며 결과 없는 job을 PASS로 채우지 않는다.

### source d7c8bd14e572의 실제 Linux 전체 PASS와 후속 Mac runner 취소

Architecture [41854973606](https://github.com/minjung2035/oma-v2-ci/actions/runs/41854973606)의 native-all ZIP
`13339926354` SHA-256 `5b2a547c4a70da3709ac3678f8c4c62123e84dd2ee70840e52e8b8c951a02155`를 대조·판독했다.
all **4795/4795 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges[]**,13 commands 모두0이었다.
status responsiveness001은 원래100ms 기준으로 mixed35ms·write max50ms·read lag7ms·inFlight1이었다.
앞선 source의323ms 실패 원인이나 수리를 확정하지 않는다. 원시는 `peer-source/linux-all-art-13339926354/`다.
후속 source `137df7eed5c6` Native [41858260000](https://github.com/minjung2035/oma-v2-ci/actions/runs/41858260000)는
Ubuntu만 완료했고 Mac4개는 모두 runner 미취득 cancelled다. 새 host identity·Host exec/death의 Mac 실행 증거는 없다.
순차 matrix의 source `1a7191956fd1`도 아직 Mac 관측이 없으며 PASS로 채우지 않는다.

### Darwin held-directory filesystem 관측 — 실제 Mac 미실행

기존 state-root 정책의 Linux filesystem magic을 Darwin type 번호에 적용하는 경로를 확인했다.
`darwinDirectoryFilesystem`은 held directory의 public statfs64에서 type/name·MNT_LOCAL·MNT_RDONLY·
MNT_EXT_FSKIT를 읽는다. 실패·잘못된 layout/name은 UNSUPPORTED_PROFILE이며 local로 추정하지 않는다.
SDK26.5 C static assertions로2168 bytes와 각 필드 offset을 arm64/x64에서 확인했고,
object symbol의 arm64 `fstatfs`와 x64 `fstatfs$INODE64` 구분도 확인했다. 이것은 runtime proof가 아니다.
실제 C·Node type과 FFI 결과, held directory rename 뒤 동일 관측, regular-file FD 거절을 비교하는 검사를 추가했다.
임의 NFS/SMB/FUSE mount나 실제 Mac flags는 NOT_RUN이다. state-root caller에는 아직 연결하지 않았다.
build·관련 local61/61·기존 Linux state-root 정책1/1은 PASS다. local의 새 Mac 검사는 platform refusal이다.

같은 입력은 source pin을 실제 sandbox 안에서 먼저 잡은 뒤 Host exec/death를 만들고 old pin revoke를 확인한다.
변경 뒤 **새 Node 프로세스**도 원래 kernel capability만으로 다시 인증되지 않아야 한다. 프로세스 내부 cache나
단순 PID version 비교만으로 이 반례를 통과시키지 않는다. 새 검사는 실제 Mac NOT_RUN이며 채널 연결은 유지 보류다.

파일 보호의 F_SETLEASE 대안도 검토했다. [고정 XNU](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_subr.c)의
allow_setlease는 private `com.apple.private.vfs.file-leases`를 요구하고, timeout 뒤 강제 lease release도 구현한다.
기본 privileged/entitlement 없는 immutable installation이나 Society lease 대체로 채택하지 않는다. Mac 실험을 했다는 주장은 아니다.

후속 CI는 Mac26 common을 먼저 요청한다. 새 workflow 입력끼리는 같은 branch concurrency group의 이전 run을
supersede한다. 이미 시작한 group 없는 과거 run을 이 변경이 취소했다고 쓰지 않는다. 실제 실행된 실패와 cancelled를
구분하고 eager artifact를 보존하며, 최신 입력의 전체 검증을 마치기 전 제품 완료로 선언하지 않는다.

### Broker current-scope 접점 — Mac 실행·제품 admission 미검증

공통 peer port에 optional `inScope` 관측을 두고, Mach pin은 genuine sender의 watch 전후에 fresh
boot/CID를 조회해 정확한 physical identity와 비교한다. legacy ASID·body PID·다른 boot/CID·extra field는
멤버십을 주지 않는다. auditSession은 kernel correlation으로만 남겼다. 모르는 관측은 인증 거절이며 scope death가 아니다.

`runner.open`은 RunRegistry 생성보다 먼저 오므로 trusted spawn owner의 현재 witness와 inherited actor/invocation
grant를 확인한다. 등록된 Actor는 같은 관측과 **현재 owned run pin**의 identity를 모두 확인한다.
현재 row/incarnation/role/specHash/desired/capability와 run/lease 재검사는 기존 공통 owner에 유지하며 매 요청·acceptance 시점에 적용한다.
Linux는 기존 scopeRoot/ancestry·pidfd 경로를 유지한다. 없는 Darwin membership/identity를 Linux PID로 대체하지 않는다.

build·관련 local62/62·실제 Linux peer pidfd/RunRegistry/authority/acceptance/Runner/topology28/28·evidence parser37/37은 PASS다.
현재 Mac 검사는 kernel message를 실제 자기 endpoint로 송수신하고 pin의 boot/CID·genuine sender·close를 대조하는
mechanics 질문이다. Actor를 실제 run에 admit하는 검사가 아니며 Linux에서는 platform refusal만 실행했다.
새 callback/runner 연결의 Mac 실행은 NOT_RUN이다. private Mac Runner launch·expected Broker·installed code·Society lease와
G-AUTH/G-PROCESS/G-FILES OPEN, execution guard는 유지한다.

hosted arm64 미취득 중 관측을 계속하기 위해 [공식 Intel26 label](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)을
common matrix에 보조로 추가했다. Intel26과 기존 arm64가 첫 두 slot을 사용하며 모든 Ubuntu/Mac15/gate를 유지한다.
Intel의 결과를 arm64 target qualification으로 승격하지 않는다. 새 architecture/실행 순서의 효과도 아직 NOT_RUN이다.

### SOURCE41 실제 Mac26 arm64 결과와 새 peer 채널 연결

Native [41867409124](https://github.com/minjung2035/oma-v2-ci/actions/runs/41867409124)의 source
`ca39f54f6ecd6f4ae75f32f37e1413efbc7c6709`에서 Mac26 arm64 공통 runtime **341/341 PASS**,
fail/cancel/skip/todo0을 확인했다. 입력15858개 digest
`994efb0e3638d77d38188525447aef34ce43874989d206ecdd2714ac81e0ae2e`와 runtime 산출물은 shared 전후 같았다.
eager artifact13342927114의 SHA-256은 `5554993bd829778eee0914f9c0dd22dfb61c4c5f1d820aa59300bd093ca54e77`다.
full artifact13344046616의 SHA-256 `d28a56905fe0bb48c6910dede7f68f5a65901958676f008f75dc5a17af075608`도 대조했다.

실제 Seatbelt·Node 안에서 inherited task-name20·full audit8 words·서로 다른 positive CID와 native source pin을 확인했다.
자기 task-name과 user port는 거절됐다. 원래 Host의 ordinary exec/death 뒤 기존 pin과 **새 Node client** 모두
원래 capability를 거절했다. C에서는 exec 뒤 원래 name의 kobject15·audit17 실패와 새 pidVersion을 관측했다.
host UUID와 held directory statfs 관측도 독립 C와 일치했다. Mach pin의 boot/CID callback은 실제 kernel sender로
확인했지만 실제 Actor/run admission을 완료한 검사는 아니다.

독립 패키지는26/27이며 기존 Git preparation guard1 FAIL이다. 전체 Mac 지원 완료로 쓰지 않는다.
Mac26 gate는 runner 미취득으로 cancelled다. Mac15 common은336/341·5 FAIL이며 새 task-name C fixture가
SDK15에 없는 enum typedef/상수 이름 때문에 compile 전에 거절됐다. artifact13344908519의 SHA-256
`8160aa5f6dc935824b7c03e048eb17d2aa3e1d79f491fb0881b4a4605e805733`을 대조했다. kernel 동작 실패로 해석하지 않는다.
후속 fixture는 동일 natural_t RPC ABI와 고정 XNU wire 값20/UINT32_MAX를 사용한다. 실제 Mac15 재실행은 NOT_RUN이다.
보조 Intel26 공통은320/341·21 FAIL로, unsigned main-image 거절과 fdopendir/readdir ABI 혼용을 확인했다.
ABI 수정은 후속 입력에 포함했으나 실제 Intel 재실행 전이다. arm64 목표와 보조 Intel 결과를 합치지 않는다.

같은 source의 Ubuntu selected integration은471/472이며 V23A mixed event-loop lag185ms로 기존100ms 예산을 넘었다.
원시 artifact13344168576 SHA-256 `fe0f5453a4b77eaf84da3a2438d48fff6e93bf290a8559f2027076c07e959806`을 대조했다.
원래 SOURCE36의 간헐323ms와 별개 입력의 재발이며 원인 수리로 쓰지 않는다. 별도 frozen SOURCE41 worktree의
전체 Linux 실행은 진행 중이고 관측한 V23A는 mixed37ms·read27ms·writeMax56ms였다. 전체 완료 결과는 아직 아니다.
그 실행과 공식 Architecture41867409213 모두 optional scope port 두 항목의 stale interface fingerprint를 찾았다.
공식 baseline은 사전44/44·main4757/4758·fail1이고 fast1182/1183도 같은 fingerprint 실패다.
durable937/937·property42/42·stress16/16·platform79/79는 PASS다. 공식 ZIP13345266311의 SHA-256은
`b46aa9db8a67ab29cefa5a574589cda138e19772ac35a3cc715397188440227b`다.
현재 contract golden은 의도한 PinnedPeerIdentity/BrokerUnits 두 항목만 갱신했다. public/durable DTO·역사 snapshot은
유지했고 전체 contract evolution7/7이 통과했다. 이는 새 권한 승인이나 성능 실패의 수리가 아니다.

후속 구현은 listener의 **실제 소유 receive right**에서 SEND를 만들고 자기 kernel token을 함께 capture한다.
namespace lookup으로 endpoint를 다시 얻지 않는다. private OMAJOB2 frame과 authenticated PEER packet을 받은 C helper는
genuine read-only task-name을 다시 얻어 full token·same UID·distinct CID를 확인한 뒤 registered slots
`[discard, task-name, endpoint]`만 넘긴다. 원래 peer의 exec/death는 helper의 live 검사에서도 거절된다.
공유 launch owner의 witness→prepared→현재 authority→release 순서는 유지한다.

client dial은 fixed inherited source/endpoint를 요구하며 public-name lookup fallback을 제거했다.
OPEN/OPENED의 nonce와 endpoint-purpose hash는 상관관계만 정하고, genuine kernel full token과 source/watch liveness가
모든 수신·송신의 peer 근거다. 매 요청의 current Actor/run/lease 검사는 기존 공통 Broker owner가 계속 소유한다.
다른 살아 있는 signed Node가 reply right를 넘겨받아 응답하는 negative와 actual Seatbelt job의393217-byte 왕복·EOF를
새 실제 OS 회귀에 넣었다. **이 새 producer/consumer 경로의 실제 Mac 실행은 NOT_RUN**이다.
local build와 관련73/73·skip0은 PASS지만 Linux의 Mac 시나리오는 platform refusal이다.
변경한 @oma/platform-mac와 선언된 dependency7개만 pack/install한 설치 검사는 PASS다. monorepo에서 installed-runtime을
직접 부른 첫 시도는 의도한 absent-dependency assertion에 걸렸으며 독립 설치 결과로 사용하지 않았다.
추가 V23A sync-fs trace 실행은 mixed66ms·read23ms·writeMax85ms, 가장 긴 관측 fsync3.526ms였다.
CI의185ms를 재현하거나 설명하지 못했으며100ms 예산은 유지한다.
private Runner/Worker topology, 설치 JS·dependency generation, Society lease·manual reboot recovery는 미완료이며
G-AUTH/G-PROCESS/G-FILES OPEN·product BLOCKED·execution guard를 유지한다.

### SOURCE42 actual gate와 후속 reboot/filesystem 연결

source `9474dc01e4511fa3c69cb78b990e14029eaa58f9`, Native
[41875073672](https://github.com/minjung2035/oma-v2-ci/actions/runs/41875073672)의 Mac26 arm64/SDK26.5 gate는
120 executed /111 OBSERVED /9 SETUP_FAILED, product BLOCKED다. 입력15860개 digest
`78e8f5d8d1bc458cf4038133fffbaea24d679d6391dcc91290089ba6418d1d52`와 runtime 산출물은 전후 동일했다.
artifact13347411914 SHA-256 `43c86e54e21d4f0d4aa46a4b80398d433d940612487342b71f62b2131fe40d93`을 대조했다.
새 실제 confined peer roundtrip3회 모두 destination unavailable로 실패하고 client result는 unobserved였다.
원래 child stderr가 assertion에서 빠졌으므로 후속 fixture는 bounded stderr sink와 전체 result 진단을 보존한다.
parallel promise의 rejection도 즉시 소유해 cleanup 전 unhandled rejection으로 종료하지 않는다.
기존 stale sender/handoff는 각3회 OBSERVED다. 나머지6회 Worker는 기존 native-support guard의 명시적 거절이며 새 채널 성공이 아니다.

보조 Intel26 common은331/344·13 FAIL이다. source41의 directory cursor·snapshot 등10개 ABI 실패는 모두 사라졌다.
새13개는 기존 unsigned helper/C fixture11개와 같은 단계의 peer roundtrip/wrong-peer2개다.
eager artifact13345968260 SHA-256 `2b24846793b876a8d97922e1388dc16f2c36db1859bc9a76a05b3e01f4d9de55`를 대조했다.
후속 build는 선언된 owned helper만 compile 뒤 명시적 ad-hoc codesign하며 실패하면 build cache를 publish하지 않는다.
test의 owned C source fixture도 서명한다. signature 검증 생략·unsigned 허용·entitlement 추가는 없다. 새 실제 Mac 실행은 NOT_RUN이다.

뒤이어 판독한 Mac15 common은341/344·3 FAIL·skip/cancel0이다. artifact13347139178 SHA-256
`4e6c233af4057e7ad1cee141cfe9f6e0496e9ad1cc8477374e60fd6152b62f96`를 대조했다. SDK typedef 수정 뒤
native source·fresh-client exec/death와 독립 C 사실은 실제로 통과했고, fake-user-port 숫자 assertion만0 vs UINT32_MAX로 실패했다.
Mac15의 ordinary user endpoint는0, Mac26은UINT32_MAX를 돌려준다. peer channel2개는 helper 종료로 실행 전제에 실패했다.
후속 native getter/C helper는 genuine local receive/send endpoint를 직접 만들어 kobject 결과를 관측하고,
관측된 닫힌 값 집합0/UINT32_MAX 안에서 inherited endpoint가 그 참조와 같은 타입인지 요구한다.
TASK_NAME20만 audit-token MIG에 넣는 조건과 original full-token·CID·owned endpoint producer는 유지한다.
이는 Mac15 helper의 잘못된 단일 상수 조건을 수리하는 입력이며 새 실제 실행은 NOT_RUN이다.

frozen SOURCE41 local 전체 Linux 결과는4801/4802·fail1·cancel/skip/todo0이며 입력 sourceChanges[]다.
유일한 실패는 위에서 수정한 current port fingerprint다. build/typecheck/architecture12개 command는0이고 tests만1이었다.
`peer-membership/linux-local-all-41/result.json`을 판독했으며 이를 SOURCE42/후속 입력 전체 PASS로 옮기지 않는다.

후속 storage manual recovery는 Darwin gethostuuid/boot-session 관측을 연결하고 v2 ticket을 쓴다.
Linux v1 의미/bytes는 유지하며 양 OS는 다른 version을 거절한다. 자동 migration은 없다.
Darwin의 writable journal/archival I/O는 held parent에서 요청한 regular-file access를 얻어 original event pin의
dev/ino·single-link·owner를 I/O 전에 확인한다. read-only /dev/fd upgrade로 writable capability를 만들지 않는다.
same-boot 거절·read-only corrupt/missing journal·원본 archive·다른 OS ticket·actual flock을 새 OS 회귀에 넣었다.
controlled changed-boot는 state-transition 시험이며 실제 reboot를 했다는 주장이 아니다.
product recovery CLI의 Linux guard는 qualified Society lease를 얻을 때까지 유지한다.

application state-root policy도 실제 Darwin held fstatfs의 local/read-only/FSKit/name을 사용하도록 연결했다.
Linux magic table은 Linux에만 적용한다. Darwin local namespace와 Linux NFS magic의 충돌을 별도 policy 회귀로 확인하며
real NFS/FUSE mount를 실행했다고 쓰지 않는다. 새 실제 Mac state-root/recovery 실행은 NOT_RUN이다.
최종 local build PASS, storage/recovery/filesystem40/40, actual Linux recovery CLI/DR18/journal16/16,
build-stamp13/13, 전체 architecture·문서·명세 검사는 PASS다. review ledger 갱신은 authored approval가 아니다.

Society lease와 installed JS/modules/library generation·Runner/Worker 연결은 계속 남아 있다.
TCP port도 고정 XNU의 공통 SO_REUSEPORT setter와 IPv6 bind의 양쪽 reuse-bit 검사 때문에 raw FD 상속 lifetime 대체로 채택하지 않는다.
SO_RESTRICTIONS는 입출력·cellular/expensive/constrained restriction의 trapdoor이며 일반 setsockopt를 봉쇄하지 않는다.
이 판정은 source 검토이고 새 Mac TCP 실험은 아니다. G-PROCESS/G-FILES/G-AUTH OPEN과 실행 guard를 유지한다.

### SOURCE43 보조 Intel 실행과 client source 검증 정리

Native [41881425344](https://github.com/minjung2035/oma-v2-ci/actions/runs/41881425344)의 source
`67dc69686476266f9a30cda7d338fcda2f30494a`에서 Intel26 common은350/351·fail1·cancel/skip/todo0이다.
artifact13350316466 SHA-256 `fe11ed7af4211d92de8a056e5a258d599808bd0f3a40ddf1534f84ef226ad1d7`을 대조했다.
explicit helper/C signature 뒤 기존 unsigned-image 실패는 없어졌으며 native directory·source·job/recovery,
state-root와 storage manual-recovery6개가 실제 실행됐다. same/changed-boot4건 중 changed-boot2건은 controlled observation이고 실제 reboot proof가 아니다.
wrong-peer는 원래 Host가 살아 있는 동안 다른 Node의 응답을 거절하고 resource return까지 통과했다.
이를 Mac26 arm64 target qualification으로 합치지 않는다. 이 입력의 arm64 common/gate26은 cancelled였으며 실제 결과가 없다.

유일한 roundtrip 실패의 child stderr는 `Mach sender audit origin could not be bound to a live image`와
Security osStatus -67061을 기록했다. 그 뒤 destination unavailable과 channel close가 뒤따랐다.
현재 client는 기존 inherited TASK_NAME20 source pin이 보유하는 full kernel token·fresh generation·distinct CID·watch와
매 메시지의 genuine kernel trailer를 직접 비교한다. 두 번째 generic Security 재조회는 제거했다.
이것은 임의 signed Node를 믿는 fallback이 아니다. original inherited source가 없거나 죽거나 exec하면 거절하며,
forwarded endpoint의 새 sender·body PID·nonce만으로는 승인하지 않는다. server의 Actor Security bind와
공통 current-run/role/row/capability/acceptance 재검사는 유지한다. sandbox 권한을 추가하지 않았다.
**이 client 변경의 실제 positive roundtrip은 아직 NOT_RUN**이다.

같은 source Ubuntu selected integration은471/472이며 V23A mixed112ms·read5ms·writeMax126ms로100ms 예산을 넘었다.
artifact13350966846 SHA-256 `265d5a3f30107d302e3e1629d681a3ae0475b66686b5fdefc37d76c241bcc877`을 대조했다.
이 역시 성능 원인 수리나 PASS가 아니다. Source41/42/43의 간헐 실패를 threshold 변경으로 지우지 않는다.

### Mac15 Xcode system framework alias와 immutable-copy 최소 질문

SOURCE42의 Mac15 gate도 판독했다. artifact13348023481 SHA-256
`a00f9c6672a2a41baf7fd97016074d1fda7efd03477e89de76a3fa85f99eff06`과 source/runtime 전후 일치를 확인했다.
120 executed /108 OBSERVED /12 SETUP_FAILED, product BLOCKED다. roundtrip3·native-support Worker6 외의 candidate3은
Xcode16.4 IDEiOSSupportCore가 MobileDevice를 sandbox 안에서 load하지 못했다.
독립 metadata 진단은 /System/Library/PrivateFrameworks/MobileDevice.framework의 실제 canonical directory가
/Library/Apple/System/Library/PrivateFrameworks/MobileDevice.framework이고 UID0·mode0755임을 기록했다.

후속 developer-tools recipe는 Xcode를 선택한 경우에만 그 **같은 framework의 정확한 canonical root**를 read/map에 넣는다.
Git candidate/quarantine와 Worker의 writable-disjoint 검사에도 포함한다. /Library나 /Library/Apple/System/Library의
parent grant·framework process-exec grant는 없다. CLT recipe에는 추가하지 않는다.
기존 /System/Library 허용이 canonical alias까지 닿지 않았던 차이를 수리하는 입력이며 실제 compiler 재실행은 NOT_RUN이다.

actual production dependency inventory를 읽어135 top-level roots, regular15227 files /116630904 bytes를 관측했다.
이 중29 link는27 workspace alias와 nested bin2개다. 현재 deploymentManifest는 외부 npm byte closure를 아직 묶지 않는다.
새 최소 질문은 private owned fixture의 file/directory에 UF_IMMUTABLE을 설정한 뒤 current Seatbelt job의 readonly FD로
file/directory flags 해제를 시도하고, writable open·hardlink alias 거절과 정상 writable control을 함께 확인하는 것이다.
Actor 완전 종료가 불명확하면 seal/evidence를 보존한다. 이 검사는 complete generation producer나 lifecycle/recovery가 아니다.
새 fixture는 arm64/x64 SDK object compilation을 통과했으며 실제 Mac 실행은 NOT_RUN이다.
관련 local26/26·skip0은 PASS지만 Mac 전용 분기는 Linux refusal이다. build PASS, 구조·문서·명세 입력은 별도로 재결박한다.
G-PROCESS/G-FILES/G-AUTH OPEN과 product execution guard는 유지한다.

### Expected peer와 runtime closure 후속 입력 (SOURCE44 → 45)

SOURCE44 `f1a0b1cd188fc9402e8cf93a8ac660aad0b8c707`의 Native
[41887888910](https://github.com/minjung2035/oma-v2-ci/actions/runs/41887888910)에서
커널 source에 결박한 positive Mach 왕복과 wrong-peer 거절이 ARM26·Intel26 모두 통과했다.
ARM common350/352·fail2, Intel common351/352·fail1이며 cancel/skip/todo0이다.
ARM gate는120 executed /114 OBSERVED /6 SETUP_FAILED, product BLOCKED이다.
남은 setup6은 Worker bootstrap/tools의 기존 native-support guard다. Actor admission 전체의 완료는 아니다.

검증 ZIP은 ARM common13352692879
`e794c71872de5d91ac5610e49b0e01caca354112899ee3ba5dde12510533e82b`,
Intel common13353325280
`a407fe4d8d15090797207fa77db4938b7e41e9ac9060ef6d95820115fe84ebd3`,
ARM gate13351059422
`96077420b49580d855a066115fff8e2194a5c6bdf72f2d601e3c12f07f57e29b`다.
위 artifact별 공식 SHA-256과 내려받은 ZIP을 대조했다.
세 입력의 before/after canonical15864 /`0cf2e1e15982ff62efc5461c2c92ba39f6f8079b69307ef7bafa70ea65cd1ae2`가 같다.
ARM common/gate runtime15496 files/27 workspaces
`a648f470809cb134d88f49a9b7006bb6c1535bbc0a784e7e51ebb19aa18b2bba`,
Intel runtime15496/27
`c1dfa4899e53974289d27312b3321be115fe92b48174d47db74ce83a4a1a184d`도 각 before/after가 같다.

immutable fixture는 양 Mac에서 HOME/TMPDIR 누락으로 Seatbelt 준비 중 거절됐다.
kernel actor unseal 판정은 아직 NOT_RUN이며 새 입력은 명시한 writable work에 두 환경값을 둔다.
ARM witness Host-crash 시험 하나는 최초 process pin acquisition에서 실패했다.
실행 실패를 죽음/정상 복구로 바꾸지 않으며 새 입력은 initial state를 구분하는 진단만 추가한다.
ARM runtime artifact13352678806
`d059e8aeb75fec5a724e24e7bf8e442fd631917895c494c759f417917b0990d6`의 packed isolation은
26/27 뒤 @oma/git preparation의 기존 Linux guard에서 실패했다. source/runtime before/after는 위 ARM 값과 같다.

SOURCE45 후보는 deployment manifest v2에 외부 non-dev npm 파일·contained direct link·디렉터리를 포함한다.
lockfile v3의 optional 부재와 관측 실패를 구분하고, 실제 workspace/group lookup namespace도 읽는다.
링크 체인·installation 탈출·special entry·다른 @oma workspace owner는 거절한다.
기존 configured digest와 accepted state를 자동 변환하거나 다시 쓰지 않는다.
새 배포의 trusted installer가 새 digest를 제공해야 하며 기존 digest 불일치는 거절한다.
기존 설정의 자동 전환이나 데이터 migration을 구현한 것은 아니다.
실제 local tree는30723 regular files/2897 directories/29 links/286093145 bytes였다.
외부 closure를 포함하므로 shared budget은65536 entries/512MiB다.
이는 startup byte inventory이며 immutable private generation·load-time 보호·Node global lookup 차단은 미완료다.
G-PROCESS/G-FILES/G-AUTH OPEN과 제품 실행 guard를 유지한다.

SOURCE45의 별도 Society 후보 질문은 UDP socket의 양방향 shutdown 뒤 옵션 변경도 거절되는지다.
고정 XNU `f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`의
[uipc_socket.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/uipc_socket.c#L4749)는
양쪽 종료와 SETOPTSHUT 미설정이면 옵션 처리 전에 EINVAL을 반환한다.
[udp_disconnect](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/netinet/udp_usrreq.c#L2539)와
[soisconnected](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/uipc_socket2.c#L192)는 이 두 종료 bit를 지우지 않는다.
이는 아직 source inference다. raw mutable socket·SO_RESTRICTIONS 후보와 구분한다.
새 private fixture는 UDP bind/connect/shutdown, disconnect/reconnect, duplicate만 남긴 네 단계에서
REUSEADDR/REUSEPORT/REUSESHAREUID 및 SETOPTSHUT escape의 거절과 경쟁 bind 실패를 함께 요구하고,
마지막 reference 반납 뒤 경쟁 bind 성공을 요구한다. arm64/x64 SDK object compilation은 PASS다.
실제 Mac은 NOT_RUN이며 full Society identity·위조/충돌·fork/owner SIGKILL·inherited Actor/recovery는 여전히 미검증이다.
제품 lease·startup guard에는 연결하지 않았다.

### SOURCE45 actual 결과와 FD flags 후속 입력 (SOURCE46)

SOURCE45 `941dd9006885bfaa7693e5e10feadb8cfe5387d1` Native
[41891828298](https://github.com/minjung2035/oma-v2-ci/actions/runs/41891828298)의
ARM common은354/359·fail5, Intel common은357/359·fail2·cancel/skip/todo0이다.
ARM ZIP13353842514 SHA-256
`7fade709ebd149c97d9823cf84a735a61506904c1716074c0305c7f4cda83cbd`,
Intel ZIP13354027069 SHA-256
`b8a82f3b062fc1b593333a8aabc4c0caa8b0c9119911d01971414104fd1c9650`과 공식 digest를 대조했다.
각 before/after canonical15868
`a4f4fc41fdc4d10c6702ac4371ad7290fd9222b4e63278750728aae293014418`가 같다.
각 runtime15498 files/27 workspaces도 전후 동일하며 ARM은
`61d627bcd870e49c02b8673c02aa59088329442423c695e86c5fcee6c523c8ce`, Intel은
`8fba5556737cc6c872f7367f01f82f19b91679ee781d0c753b6ac723055dcb52`다.

양 Mac의 immutable 후보는 PASS다. UID501 Actor의 readonly inherited FD read23 bytes,
file/directory flags2 유지, writable open·file unseal·directory unseal·hardlink 모두-1/EPERM1,
ordinary child control14 bytes 및 complete scope retirement를 관측했다.
이는 fixture generation의 제한된 보장이며 complete installed code generation과 loader/lifecycle/recovery는 아니다.
실제 deployment v2 inventory도 양 Mac에서 PASS다: ARM30726 files/2896 directories/29 links/285213921 bytes,
Intel30726/2896/29/285496341 bytes다.

shutdown UDP 후보는 **양 Mac에서 배제**한다. 옵션 변경 거절을 요구하는 단계에서 경쟁 bind가 성공했다.
양방향 종료가 socket option 변경을 막는다는 source 관측만으로 port exclusivity를 보장할 수 없다.
최초 connected 단계의 반례이며 다음 disconnect/reconnect/duplicate 단계 완료를 주장하지 않는다.
재현 입력을 [manual fixture](../../test/fixtures/darwin-shutdown-socket.mjs)로 보존하고 자동 lane에서 제거한다.
동일 입력의 알려진 실패를 반복하지 않는 spec§3에 따른 미채택 실험의 종료이며 제품 lease 검증의 PASS가 아니다.

양 Mac 공통 실패 하나는 새 deployment-resolution 시험의 /var 대 /private/var 경로 표기 차이다.
fixture root를 실제 canonical path로 잡도록 수리한다. 다른 workspace copy 거절은 유지한다.
ARM의 추가3개는 witness 직후 cancellation과 positive/wrong-peer 통신이다.
후자 둘은20s 뒤 execution cleanup unconfirmed이며 nested cause가 기본 출력에서 생략됐다.
Intel의 같은 세 검사는 PASS다. fixture error/cancellation diagnostic의 nested cause를 펼치며
deadline·성공 조건·권한·cleanup 정책을 바꾸지 않는다. 원인 수리는 아직 미완료다.

SOURCE46은 owned single-link regular inode 또는 owned directory의 held FD에만 작동하는
Darwin flags primitive를 추가한다. public fstat 64-bit inode layout을 같은 FD의 Node native stat과
대조하고 fchflags로 UF_IMMUTABLE만 변경한 뒤 효과를 다시 읽는다. 다른 flags는 보존한다.
fixture의 trusted owner가 seal/unseal에 이를 사용하고 Actor 쪽 독립 C fstat/denial 관측은 유지한다.
완전한 Actor death가 불명확하면 unseal/회수하지 않는다. 새 FD API의 실제 Mac 실행은 NOT_RUN이다.

SOURCE45 local installed-only deployment3/3은 실제 Linux wrapper에서 PASS다.
10/10 targeted 중 immutable Mac 분기는 Linux refusal이며 object compile·실제 Mac 실행과 구분한다.
G-PROCESS/G-FILES/G-AUTH OPEN 및 product guard는 유지한다.

SOURCE46의 새 socket 질문은 mutable raw socket/종료만 한 socket과 다른 조합이다.
connected UDP에 먼저 DENY_OUT을 추가하고 양방향 shutdown한 뒤 public disconnectx로
unconnected binding을 남긴다. 고정 XNU의 soconnectlock/soconnectxlocked는 DENY_OUT에서 EPERM이고,
sodisconnectxlocked는 UDP disconnect handler를 호출한다. 새 fixture는 두 reconnect API의 거절,
16 reuse/extension 변경 거절과16 competing bind 실패, 마지막 FD 반납 뒤 bind 성공을 함께 요구한다.
SO_RESTRICTIONS=0x1081/DENY_OUT=2는
[private header](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/socket_private.h#L100)의 selector다.
public/stable SDK API라고 하지 않으며 제품에 추가하지 않는다. restricted entitlement도 요청하지 않는다.
arm64/x64 object compile만 PASS이며 실제 Mac은 NOT_RUN이다. 전체 lease identity·fork/crash·recovery 및
private ABI의 배포 적합성은 별도 미결정이다. 동일 shutdown-only 실패를 재실행하는 입력이 아니다.

SOURCE45 ARM gate ZIP13353278733 SHA-256
`5beab428cefd3ffe559df359385896cc599b842f941f5399cc45b814002c98b7`도 대조했다.
120 executed/113 OBSERVED/7 SETUP_FAILED이며 Worker guard6개 외 roundtrip iteration0 하나가 실패했다.
해당 source/runtime before/after는 위 SOURCE45 ARM 값과 동일하다. 나머지 roundtrip2회는 OBSERVED다.
간헐 실패를 정상 왕복의 완전한 qualification으로 확대하지 않는다.
SOURCE46 build와 focused13/13 local은 PASS다. Mac flags API·process 분기는 Linux refusal과 구분한다.

SOURCE44의 전체 Linux 결과가 뒤이어 도착했다. Architecture
[41887889048](https://github.com/minjung2035/oma-v2-ci/actions/runs/41887889048)의
native-all artifact13353838530 SHA-256
`f41b2d4f743913ebcca5c1a3c17a38c658c71e7bf9b07f2ef27aa5d53cb3908c`를 검증했다.
source-head는 `f1a0b1cd188fc9402e8cf93a8ac660aad0b8c707`, input 전후15864/
`0cf2e1e15982ff62efc5461c2c92ba39f6f8079b69307ef7bafa70ea65cd1ae2`로 같다.
all4813/4813·fail/cancel/skip/todo0, sourceChanges[]이며13 command의 code0/signal-null/timedOut-false다.
verification artifact13355047508 SHA-256
`95302b532a1239bfcd3be7563cdf6dd43a2974e47644e6e6c7e9628b0d140cf3`도 대조했고
fast1189/1189, durable937/937, property42/42, stress16/16, platform79/79·모두 skip0을 확인했다.
이는 SOURCE44 회귀 결과다. SOURCE45의 v2 runtime inventory나 SOURCE46 FD API의 전체 Linux PASS로 옮겨 쓰지 않는다.
이전 V23 간헐 lag 실패의 원인 수리·threshold 완화를 뜻하지도 않는다.

### SOURCE46 실제 flags/socket 결과와 private generation 후보 (SOURCE47)

SOURCE46 `b29dea0f6b10b7980c72f3251e52955818ac9cab` Native
[41895403310](https://github.com/minjung2035/oma-v2-ci/actions/runs/41895403310)의
Intel common359/359·fail/cancel/skip/todo0, ARM common356/359·fail3·cancel/skip/todo0이다.
ARM ZIP13355349575 SHA-256
`c2d9aced4692afe2da5efe93eac3f1056687153c337d56ae539232ffee75391b`,
Intel ZIP13356686381 SHA-256
`ff2dff2e70e9ecae3f343409a4be06ee6bf1a7f672acc90ef11e5a07f32e1646`를 대조했다.
양쪽 canonical 전후15871/
`7e987e0ecc3d22babb34dac83d4146fb106de4dfc9c410a577832d7af2b27937`가 같다.
runtime15500 files/27 workspaces도 각각 전후 동일하며 ARM은
`02ee4714d2173ec739e2ffeeaf8062420852b28e47d6a88549d86b6aba09c620`, Intel은
`32f3c9a6340b36b41949712a5a658e1762b2758bae0291da63f993d96897e1b3`다.

새 restricted+shutdown 조합은 양 Mac에서 UID501·16 option mutation 거절·16 competing bind 실패,
connect/connectx 두 reconnect 거절·마지막 FD 반납 뒤 bind 성공을 관측했다.
shutdown-only 후보의 반례와 구분한다. private selector의 배포 적합성·전체 Society identity와
상속/위조·fork/exec·owner SIGKILL·recovery는 아직 미충족이며 product lease로 채택하지 않는다.
Intel의 FD flags API + independent Actor C fixture도 PASS다.
ARM flags fixture는 host seal/read 검사 뒤 scope 실행에서 RUN_TERMINATION_UNKNOWN으로 끝났다.
ARM의 다른 두 실패도 실제 producer의 spool/CID join과 source-pin exec 시험의 scope 실행이다.
일반 TAP error block은 nested cause를 생략하므로 이 결과만으로 원인을 단정하지 않는다.
새 reporter는 원본 TAP 사건과 verdict를 보존하면서 nested error를 diagnostic으로 추가한다.
고의 nested-failure local probe에서 원인이 보존되고 exit1이 유지됨을 확인했다.

SOURCE47 private generation 후보는 configured digest와 대조한 v2 manifest의 각 파일을 held source에서
새 owned single-link inode로 복사하고 개별 hash와 전체 재구성 digest를 다시 확인한다.
contained link/empty directory와 별도 Node 복사도 포함하며 모든 파일·디렉터리를 UF_IMMUTABLE로 잠근다.
Node는 선택한 installed JS entry와 --no-global-search-paths로만 시작하고 loader injection 환경을 거절한다.
Actor writable root와 겹치면 시작 전 거절하며 source config/accepted state를 변환하지 않는다.
private parent는 모든 Actor writable root 밖의 owned0700 directory여야 한다.

새 소유자는 실제 Darwin scope를 직접 취득하고 보유 수를 늘린다.
기존 scope.close의 실제 complete-death/resource-return 검사가 성공한 경우에만 그 보유를 반납한다.
생성 시도 뒤 unknown은 보유를 남기며, 보유가 있거나 unknown이면 generation.close는 unseal/삭제를 거절한다.
EOF·직접 child exit·caller death predicate로 회수하지 않는다. construction failure는 자신이 만든 복사만 회수한다.
전체 설치+별도 Node의 실제 Seatbelt 실행, native dependency import, file/dir/Node unseal·쓰기/alias 거절,
읽을 수 있는 fake HOME global module의 fallback 거절, live-scope 회수 거절과 최종 회수를 시험하도록 연결했다.
local build와 관련8/8은 PASS지만 Mac-specific 실행은 Linux refusal이다. 이 새 producer의 실제 Mac은 NOT_RUN이다.
startup의 generation 선택·orphan recovery/collector·Runner/Worker 조립은 아직 미완료이며 제품 guard는 유지한다.

SOURCE46 ARM gate ZIP13356841771 SHA-256
`332a59b87fe5bd23337a713eb2c1c1d5ba16dcce266e38d48b4f501e6971c8cc`를 대조했다.
120 executed/113 OBSERVED/7 SETUP_FAILED이며 canonical/runtime 전후는 위 SOURCE46 ARM 값과 같다.
Worker guard6 외 roundtrip iteration0 하나가 실패했다. 펼친 cause는 initial pin acquisition changed다.
SOURCE47은 이 관측에 대해 원래 unique ID·PID version·full8 token·boot·CID가 모두 동일할 때에만
새 watcher를 한 번 취득한다. 실제 exec/재사용/CID 변경, unknown/dead/closed 또는 재차 변경은 거절한다.
기존 watcher를 live로 되돌리거나 caller의 PID/token 객체를 받지 않는다.
image 확인 중 changed가 생긴 경우도 genuine factory pin의 private WeakMap 근거로만 새 pin을 얻고,
선택한 CDHash와 stopped 상태를 다시 확인한다. origin mismatch/unknown은 재시도하지 않는다.
이후 기존 journal witness→setup→current authority→release 순서는 유지한다.
새 경합 대응과 image diagnostic의 실제 Mac 재검증은 NOT_RUN이다.

SOURCE46 Mac15 gate ZIP13356702363 SHA-256
`270a999e694ade7c5d746bfc69410a46254d1fa15c897045cc2d1a38aa8ccf01`도 대조했다.
Darwin24.6 arm64/SDK15.5에서120 executed/113 OBSERVED/7 SETUP_FAILED다.
Git/compiler candidate3회는 모두 OBSERVED로 canonical MobileDevice alias 수정의 양성을 확인했다.
Worker guard6 외 roundtrip iteration0의 stopped-image 확인이 실패했다. 원인이 ARM26과 같다고 단정하지 않는다.
새 진단은 origin kind와 process state를 구분한다. canonical 전후는 위 SOURCE46과 같고
runtime15500/27 전후는 `20b0a8713bd1ac9826d4382da3e2853cb4da2416d2d3e5f621d3ca06fe5f8e23`로 같다.

새 generation은 source/parent/Node parent의 모든 directory component를 검사해 symlink ancestor를 거절한다.
별도 Node는 node basename을 보존하는 private bin에 복사하며 generation의 다른 payload와 함께 잠근다.
실제 시험은 그 PATH의 node 명령으로 시작한 자식까지 같은 scope에서 종료하는 것도 요구한다.
caller-shaped changed-pin 객체는 원래 kernel factory로 오인되지 않는 local negative control을 추가했다.
제품 Runner/Worker·Node toolchain 선택과 orphan collector의 연결은 별도 미완료다.

SOURCE47의 preload도 같은 generation에 포함된 JS entry만 허용한다.
source installation의 mutable entry를 preload로 다시 넣거나 Node loader 환경을 주입하는 입력은 시작 전에 거절한다.
잘못된 argv·loader env·writable overlap·outside preload 시험도 공통 owner의 opening/retire로 감싸며,
회귀로 scope가 생성되더라도 release 전 authority 거절과 actual drain을 거치도록 했다.

SOURCE45의 새 v2 inventory를 포함한 full Linux CI도 도착했다. Architecture
[41891828585](https://github.com/minjung2035/oma-v2-ci/actions/runs/41891828585)의
artifact13357036323 SHA-256
`9bf2cef4df667ffaf17104a08f28ea1b3819e6142b1581aeeb7248f6a63c9fcc`를 대조했다.
source `941dd9006885bfaa7693e5e10feadb8cfe5387d1`, before/after15868/
`a4f4fc41fdc4d10c6702ac4371ad7290fd9222b4e63278750728aae293014418`가 같다.
all4817/4817·fail/cancel/skip/todo0, sourceChanges[],13 command code0/signal-null/timedOut-false다.
SOURCE46/47 실행이나 이전 V23 간헐 lag 원인의 수리로 옮겨 쓰지 않는다.

SOURCE47 최종 회수는 storage.removeOwnedEntryAt의 held-parent 삭제를 사용한다.
확보한 generation parent/entry를 재검사하고 그 FD에서만 회수하며 rmSync 경로 삭제를 사용하지 않는다.
이 수정 뒤 build·focused22/22·파일 효과 rule gate를 통과했다. 실제 Mac 통합 실행은 아직 NOT_RUN이다.
고정 XNU의 [exec identity 갱신](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L7096)도 대조했다.
각 exec는 직전과 다른 PID version을 설정하므로 새 pin이 원래 full token/PID version과 같은지 검증하는 조건을 완화하지 않는다.
Original expected-peer watcher의 exec revoke는 재취득 대상이 아니며 그대로 유지한다.

### SOURCE47 실제 generation 결과와 시작 준비·flush 수정 (SOURCE48)

SOURCE47 `eccc2228ac304eb2e95b96fdb811e199e20b6773` Native
[41905019192](https://github.com/minjung2035/oma-v2-ci/actions/runs/41905019192)의
ARM common ZIP13360591227 SHA-256
`1c5e7509aef6c29ba4e73e226e091ec8e9f0c7610793613d6e6da3734ea66d5c`,
Intel common ZIP13359869446 SHA-256
`1347389a65d5bf3db89964885e3df34431bf088bebe6ec3623994ec646d51450`를 대조했다.
canonical15874/`6ad85f25ac53c498c60d3278b982eee1f512f57fd9db3aea424f7e7af587fd85`는
양쪽 전후 동일하다. runtime15502/27 전후도 ARM
`d78d8c2768d4ef1b6290804e917524ab166fd7a15ef3ba5749c7f67235403e48`, Intel
`f27b9d9ea1b95a65cca17f972d0fe84234a1db77f202c3c4290f402c41bfa0a9`로 각각 같다.

ARM은361개 중359 PASS/2 FAIL이다. 전체 private generation 시험은196784ms에 PASS했다.
실제 설치 payload·별도 Node·Koffi import·private PATH child·읽을 수 있는 HOME fallback 거절,
Actor의 file/dir/Node unseal·쓰기·hardlink 거절과 scope 종료 뒤 최종 회수를 확인했다.
이것은 startup orphan recovery나 실제 Runner/Worker 조립의 증명이 아니다.
남은 두 실패는 Mach roundtrip/wrong-peer의 초기 job 취득이다. 펼친 원인은 각각 task-name 취득 불가,
origin=unavailable/process=changed다. ARM gate ZIP13360382956 SHA-256
`b76c1a93ea58ba7f52fd14455dd68727b03cf03177d942c0edd2cff22c8613dc`는
120 executed/113 OBSERVED/7 SETUP_FAILED이며 roundtrip iteration2와 기존 Worker guard6이 남았다.

Intel은360 PASS/0 FAIL/1 cancelled다. 전체 generation 시험이240000ms 제한에 걸렸으며
cleanup을 포함한 case 시간은466819ms다. 성공으로 계산하지 않는다.
SOURCE48은 파일마다 반복하던 parent fsync를 completed-directory 단위로 묶는다.
각 파일 데이터 fsync는 유지하고 모든 directory를 최종 flush한다. 회수도 기존 owned-tree walk를
held-parent surface로 추출해 directory당 한 번 flush한다. path wrapper의 기존 의미는 유지한다.
시험에는 construction/execution/collection phase 시간을 추가하고 원래240초 제한은 유지한다.
held-parent rename·외부 symlink·반복 회수와 batch-copy byte 검사를 실제 Linux에서 통과했다.

초기 launchctl PID는 START_SUSPENDED exec 준비보다 먼저 나타날 수 있다.
SOURCE48은 BSD stopped 관측 뒤에만 첫 pin 취득을 시도한다. 이 readiness hint는 generation·image·role·
complete-death 증거가 아니며 기존 full token/PID version/unique ID/CID·selected image 검사를 유지한다.
task-name 취득 실패의 kernel return도 보존한다. 변경 뒤 build와 focused16/16·directory11/11은 PASS다.
Mac-specific branches의 로컬 결과는 Linux refusal이며 SOURCE48의 실제 Mac 재검증은 NOT_RUN이다.

SOURCE46의 full Linux Architecture
[41895403297](https://github.com/minjung2035/oma-v2-ci/actions/runs/41895403297)도 회수했다.
artifact13359150033 SHA-256
`9d21b5af1c31d72daf73bcc0ee070cbcbb2fea17ef420d131340ea4deda20308`를 대조했다.
source `b29dea0f6b10b7980c72f3251e52955818ac9cab`, before/after15871/
`7e987e0ecc3d22babb34dac83d4146fb106de4dfc9c410a577832d7af2b27937`가 같다.
all4817/4817·fail/cancel/skip/todo0, sourceChanges[],13 command code0/signal-null/timedOut-false다.
이 기록은 SOURCE48 runtime qualification이나 이전 V23 간헐 lag 원인의 설명이 아니다.

### 선택한 실제 자식의 관측 소유권과 direct Worker 채널 시험 (SOURCE49)

SOURCE48 `a9baabe42323474ea7a41833991b6f73ff04b889`는 Native
[41910174291](https://github.com/minjung2035/oma-v2-ci/actions/runs/41910174291), Architecture
[41910174358](https://github.com/minjung2035/oma-v2-ci/actions/runs/41910174358)에 발행했다.
발행 전 build·focused16/16·directory11/11·architecture/문서/spec gate가 통과했다.
canonical15874/`92c8d4fb535051f12d09cb9f388be121c0fc22f078c842dfc16d46a00dfa742a`다.
이 단락 작성 시 실제 Mac 결과는 아직 회수 전이며 앞선 SOURCE47의 runtime PASS와 구분한다.

SOURCE49는 selected-image 검사를 마친 실제 job target에서 독립 pin을 취득하는 surface를 추가한다.
Native factory의 private WeakMap 근거와 원래 unique ID·PID version·full8 token·boot·CID를 모두
대조한다. caller-shaped pin, unknown/dead/changed/closed 원본은 취득하지 않는다.
외부에는 pid/uid/gid·alive·close만 내보내며 resume/kill이나 Actor/role을 부여하지 않는다.
common ticket은 scope가 여전히 owned/populated일 때만 pin 취득을 허용하고, 취득 중 소유권이
변하면 새 pin을 닫고 거절한다. retired ticket은 backend를 다시 호출하지 않는다.
private generation과 application capture wrapper도 이 transient capability를 전달한다.
기존 witness·persisted format·authority/release/retire 순서는 변경하지 않는다.

실제 Mac 시험은 준비 전/회수 뒤 취득 거절, 독립 pin 반납, 실제 Node pid/euid/egid 일치,
complete scope 반환 뒤 alive=false를 요구한다. 같은 PID·CID의 exec 뒤에도 원래 pin과
다음 ticket 취득이 거절되는 별도 대조를 추가했다. 전체 installed generation 시험도 같은
physical pin과 실제 private Node PID의 일치·최종 revoke를 검사한다.

별도 transport 시험은 한 outer launchd scope의 trusted Runner에서 production의
spawnWithPrivateInputs로 Seatbelt Worker를 직접 시작한다. 두 번째 launchd scope나 public service
lookup으로 peer를 다시 얻지 않는다. Worker의 CID·원래 Broker full8 token, 실제 stream sender PID,
393217-byte 양방향 내용·authenticated EOF·공통 owner의 complete death/FD drain/retire를 검사한다.
이 입력의 실제 Mac 실행은 NOT_RUN이며 current Actor/Run admission을 대신하지 않는다.
제품 Runner/Worker 조립과 startup orphan collector·Society lease·Git preparation은 여전히 미완료다.

새 source build는 PASS다. 초기 일반 shell 실행은 /usr/bin namespace launcher ENOENT로
43개 중26 PASS/17 FAIL이었고 원시 log를 보존했다. 기존 delegated cgroup와 고정 bwrap layout으로
실제 namespace/Resident 회귀를 다시 실행해43/43·fail/cancel/skip/todo0를 확인했다.
Mac-specific 가지는 이 Linux 실행에서 refusal만 확인한 것이다. generation local refusal1/1도 PASS다.
세 product gate와 native-support/launchBlockedDarwin guard는 유지한다.

SOURCE48 양 Mac 결과도 회수했다. ARM shared ZIP13360779847 SHA-256
`cd574fc25675408b0097d30ccff5aae65e98899a63231d4a7023b3f5a7882a61`,
Intel shared ZIP13362492774 SHA-256
`07db125b4228824a62faae8eda7d55a23f681c2d1cdfa74ce38a984ef401602d`를 대조했다.
canonical15874/`92c8d4fb535051f12d09cb9f388be121c0fc22f078c842dfc16d46a00dfa742a`는
양쪽 전후 같다. runtime15502/27 전후도 ARM
`9658897c2f299ab989ac8c91b982491b79362ac17c365d5d3ec926e4e106a602`, Intel
`94b980e5f16e848e6a929cba4d6cbc43078c6261aabfe600943b2f9142480e21`로 각각 같다.
ARM364개 중362 PASS/2 FAIL, Intel364/364 PASS·fail/cancel/skip/todo0다.
전체 generation은 양쪽 PASS다. ARM183143ms는 construction112658·execution708·collection17003ms,
Intel262377ms는 construction182884·execution2733·collection33429ms를 포함한다.
constructor/collection의 동기 작업 때문에 전체 wall time은 원래240초 timer보다 길 수 있다.
시험 timeout을 늘리지 않았으며 별도 latency 상한 qualification으로 계산하지 않는다.

ARM 실패 두 개는 capture/spool와 witness-Host-crash 시험의 initial readiness hint 거절이다.
SOURCE49는 stopped 양성이 나올 때까지 다른 모든 hint 상태를 기존10초 제한 안에서 재관측한다.
unavailable/exited hint를 live/dead나 성공으로 바꾸지 않는다. deadline에서는 마지막 hint를 보존하고
unknown으로 거절한다. stopped 뒤의 full kernel generation·selected image 검사는 그대로다.
이 후속 수정 뒤 build와 delegated Linux 선택44/44·fail/cancel/skip/todo0가 PASS다.
SOURCE49의 실제 Mac·새 physical pin/exec/Worker 시험은 아직 NOT_RUN이다.

ARM gate ZIP13362302776 SHA-256
`f74207d4dbfe5707c86f2bfbe8196e035b70415d7129b0264c3e244fdb490f87`는
120 executed/114 OBSERVED/6 SETUP_FAILED다. 남은6개는 기존 Worker product guard다.
gate의 canonical/runtime 전후는 위 SOURCE48 ARM과 같다. 세 product gate는 OPEN/BLOCKED다.

SOURCE47 full Linux Architecture
[41905018864](https://github.com/minjung2035/oma-v2-ci/actions/runs/41905018864)의
artifact13362236353 SHA-256
`c212e14ea158943146d80bc8e9121211816d73af497effa879d5f72acfc98861`를 대조했다.
source `eccc2228ac304eb2e95b96fdb811e199e20b6773`, before/after15874/
`6ad85f25ac53c498c60d3278b982eee1f512f57fd9db3aea424f7e7af587fd85`가 같다.
all4819/4819·fail/cancel/skip/todo0, sourceChanges[],13 command code0/signal-null/timedOut-false다.
이 Linux 결과를 SOURCE49 또는 전체 Mac 제품 완료로 옮겨 쓰지 않는다.

SOURCE48 Mac15 gate ZIP13361594587 SHA-256
`782274c43b9ce749e1700d1accee4e34a6cc57ba82a4d090bb22df5c6871692a`도 대조했다.
Darwin24.6 arm64/SDK15.5에서120 executed/114 OBSERVED/6 Worker SETUP_FAILED다.
canonical 전후는 위 SOURCE48과 같고 runtime15502/27 전후는
`06a7c640a43198ad495a26c3f8f159b3771e6ab0f96e3e1f64876ff3ae5be54a`로 같다.
이 호환성 관측을 첫 목표 Mac26 arm64의 실제 결과와 섞지 않는다.
ARM runtime ZIP13363930529 SHA-256
`81d29e426efff7f43d8c08e507d0b9c83dd10b9304de05f6d4023863b1021c49`도 회수했다.
독립 packed 설치의 @oma/git은 기존 PreparationExecutor Linux guard로 실패하며 미완료로 유지한다.

### SOURCE49 실제 자식 pin 결과와 Mac preparation 연결 (SOURCE50)

SOURCE49 `4470da78dd79a658ef277a91d45fe93ba08e3e8f` Native
[41912881708](https://github.com/minjung2035/oma-v2-ci/actions/runs/41912881708)의
ARM shared ZIP13362669838 SHA-256
`147e35d8c75130613c8a0af85c6ce4db25fe0a8a62fde0764364dbd6c6a2521e`,
Intel shared ZIP13363522050 SHA-256
`abc6b53c05bf1842ab4b4fcc1b160e23b198695a42da192d12e243706d27fa97`를 대조했다.
양쪽369개 중368 PASS/1 FAIL·cancel/skip/todo0다. canonical15874/
`8d4ae9f663e403fb88e6a46d688921bbc9d772c9c0793ac09e524eebf44b7f02`는 양쪽 전후 같다.
runtime15502/27 전후도 ARM
`8518e396ae4ec460008493b67467499d3665134ff8094d97a13f39f982894013`, Intel
`4a01829bd8a31976466fd20fd20c737cc28c7fdb8e3933d59ce0722053476695`로 각각 같다.

선택한 자식의 독립 pin·실제 pid/euid/egid·준비 전/회수 뒤 취득 거절·같은 PID/CID의 exec revoke가
양 Mac에서 PASS다. 전체 private generation과 실제 private Node pin의 일치·최종 revoke도 양쪽 PASS다.
SOURCE48의 다른 두 초기 readiness 거절은 이 실행에서 재발하지 않았다. 모든 환경의 경합 제거를 선언하지 않는다.
새 descendant case는 Worker의 byte stream/EOF 뒤 diagnostic의 currentDarwinBootId 호출이
Seatbelt에서 거절돼 실패했다. 상속의 전체 시험을 성공으로 계산하지 않는다.
SOURCE50은 Worker의 boot sysctl grant를 추가하지 않고 Host가 가진 실제 transport pin의
inScope(이미 영속화한 outer witness)로 소속을 검증한다. 원래 Host full8 token은 계속 대조한다.

ARM gate ZIP13362689885 SHA-256
`62bb41880eb52f9e115c5e02a01be5e0011fb8a713a150a6bf3f4d3a1f2d6c62`는
120 executed/114 OBSERVED/6 Worker SETUP_FAILED다. canonical/runtime 전후는 위 ARM 값과 같다.
G-PROCESS/G-FILES/G-AUTH는 OPEN, productQualification은 BLOCKED다.

SOURCE50은 command 값·검증·ExecutionNotStarted를 순수 Domain 계약으로 옮기고 기존 Process export를
유지한다. launchd 등록·CDHash/선택한 task·CID·fileport·peer source 제어는 Native가 맡으며,
기존 bounded Process launchctl 실행을 주입한다. helper/Seatbelt C와 header4개는 SOURCE49와 byte-identical이다.
physical capture는 Process의 한 구현으로 옮기고 PlatformMac은 Seatbelt recipe와 기존 public entry를 유지한다.
Process→PlatformMac→Process cycle이나 별도 Git 업무 runtime을 추가하지 않는다.

standalone PreparationExecutor의 Darwin 실행은 공통 execution owner의 transient scope를 사용한다.
이 메모리 journal 자체를 durable startup recovery라고 부르지 않는다.
Application은 명시적으로 선택한 실제 capture와 기존 ExecutionRuntime journal을 연결한다.
준비 작업도 opening→실제 CID→witness 영속화→setup→현재 취소 검사→release→complete death/FD drain→retire를 따른다.
준비의 inherited FD는 기존 계약처럼3부터 전달하고 Runner 채널의6부터 전달하는 계약은 구분한다.
provider 입력을 먼저 복사하고 active/unknown 차단·fresh reverifyStale·shutdown barrier를 유지한다.
unknown 물리 scope는 공통 owner의 journal/반납 증거가 계속 막는다.
기본 launchBlockedDarwin과 제품 native-support guard는 그대로이며 새 CLI/env 우회 옵션은 없다.

새 실제 Mac 시험은 standalone FD3/capture, application의 실제 journal 기록과 취소 뒤 CID 소멸,
별도 Host SIGKILL 뒤 fresh-controller recovery를 요구한다. 이 입력의 실제 Mac 실행은 NOT_RUN이다.
제품의 Runner/Worker 조립, 전체 Society lease·orphan generation 선택/회수, 나머지 checks/quarantine·resource 경로와
전체 CLI/release qualification은 아직 미완료다. 새 Mac preparation의 독립 packed Git도 CI에서 재확인해야 한다.

SOURCE50 build·delegated Linux 선택57/57·fail/cancel/skip/todo0와 architecture rule0 findings를 확인했다.
선택 실행의 실제 Linux scope/Resident와 controlled port lifecycle을 Mac-specific refusal과 구분한다.
선택한 provider의 입력 snapshot·중복/active 거절·no-child 반납·unknown 차단/새 quiescence 뒤 재개를 검사했다.
새 source inventory14391개는 현재 목록이며 LOC/runtime 승인이나 과거 review의 재승인이 아니다.

SOURCE48 full Linux Architecture
[41910174358](https://github.com/minjung2035/oma-v2-ci/actions/runs/41910174358)의
artifact13365005395 SHA-256
`c79d95b6d59f80d3695577918de977da80efd75c8d290c162616c5adcf422eb4`도 대조했다.
source `a9baabe42323474ea7a41833991b6f73ff04b889`, before/after15874/
`92c8d4fb535051f12d09cb9f388be121c0fc22f078c842dfc16d46a00dfa742a`가 같다.
all4822/4822·fail/cancel/skip/todo0, sourceChanges[],13 command code0/signal-null/timedOut-false다.
이 결과는 SOURCE50의 전체 회귀나 Mac product qualification이 아니다.

private generation 조립 때 Host의 helper 선택도 trusted installation manifest에 결박해야 한다.
현재 Host가 import한 helper getter의 original installation과 private payload 선택을 섞지 않는 것이 남은 조건이다.
Runner가 읽는 config의 installation 경로·Node toolchain·preload와 실제 private generation의 연결도 미완료다.
이 조건을 단순한 Node main-image/pin PASS로 대체하지 않는다.

SOURCE50 첫 독립 설치는26/27 PASS·PlatformMac1 FAIL이었다. source 자산이 Native로 이동했는데
installed runtime smoke가 옛 PlatformMac/seatbelt/main.c를 직접 읽어 ENOENT였다.
같은 자산의 Native public owner 경로로 수리하고 원래 내용 검사를 유지했다.
첫 architecture의 module gate도 Native→file-descriptors2건을 거절했다.
launchd 등록은 기존 descriptor leaf의 mkdir/open/unlink만 재사용하므로 이 정확한 하향 의존을 선언했다.
leaf의 koffi-only 제약과 Native의 business owner 금지는 유지하며 관련40/40·module gate0 findings를 확인했다.
후속 빌드는27/27 재컴파일해 성공했다. 이 빌드와 겹친 설치 재시험은 tarball export 누락으로 실패했으며
고정 산출물의 결과로 사용하지 않는다. 완료 빌드 뒤 별도 설치 검증을 다시 시작했다.

고정된 빌드 뒤 재실행한 Linux 독립 설치는27/27 PASS다. PlatformMac smoke도 Native 소유 자산의
기존 내용 검사를 통과했다. 동시에 돌던 빌드의 중간 산출물 실패와 구분한다.
전체 architecture에서는 program URL·Mach-O hash의 Native3개를 pure value/wire owner로 분류한 오류도 발견했다.
이들은 실제 프로그램 선택과 code identity를 다루는 K2 mechanism으로 소유권을 정정했다.
갱신한 graph와 architecture gate는0 findings다. business authority·하위 leaf 제약·과거 review 승인은 바꾸지 않았다.
최종 검사 규칙까지 고정한 다음 빌드와 독립 설치를 순서대로 다시 실행한다.

SOURCE50 최종 고정 입력에서 build→독립 설치를 순서대로 마쳤다. Linux packed27/27 PASS이며
동시에 읽히던 빌드 산출물의 앞선 실패와 구분한다. 전체 architecture·durable boundaries·문서·spec gate도 PASS다.
이후 변경은 이 결과 기록과 구조 input binding뿐이며 production/compiled bytes는 바꾸지 않았다.
Mac preparation·수정한 descendant case·새 Host-crash 연결의 실제 실행은 발행 뒤 별도 회수한다.

### SOURCE50 실제 preparation·Worker 결과와 held cwd/slot 연결 수정 (SOURCE51)

SOURCE50 `ea204e13a1c135a40c378e9b79a056be6ee4498b` Native
[41919477476](https://github.com/minjung2035/oma-v2-ci/actions/runs/41919477476)의
ARM shared ZIP13365633886 SHA-256
`5042ada02a642673f3f09ab0d13e5c8c0a05bb938d173bda1e9227c85fc22170`,
Intel shared ZIP13365879258 SHA-256
`6e449628a18e9a678a49c9ee2da1fee0832fa6ac897402c4b97ea6fdf998b634`를 대조했다.
양쪽374개 중371 PASS/3 FAIL·cancel/skip/todo0다. canonical15888/
`7ebaa66f0718296f682b27ffe47e5503718289199c1a6c06a56b74f83a4bc417`는 양쪽 전후 같다.
runtime15526/27 전후도 ARM
`e28507e110745c0f09223bd6ca8e4f0c479c96a4aba4dd45125bdc0fbc8be746`, Intel
`aef6568b2937b008593c16c400e7d693da60571d46745b8bef0a7c1def854fb0`로 각각 같다.

Host transport pin으로 실제 outer CID를 대조한 direct Runner→Seatbelt Worker의 원래 Host full8 token,
양방향393217 bytes·authenticated EOF·complete scope 반환은 양쪽 PASS다.
standalone preparation의 FD3·capture도 양쪽 PASS다. application preparation과 그 Host-crash case는
실행 전 invalid execution slot으로 막혔다. 준비 작업의 UUID suffix를 기존 slot parser가 거절한 것이다.
시험이 이 빠른 거절을 삼키고 effect만 기다려 deadline으로 보고했으므로 SOURCE51은 원래 예외/결과를 먼저 보존한다.
나머지 실패는 C frame decoder 시험이 이동 전 PlatformMac header include 경로를 사용한 compile 실패다.
Native 소유 header로 연결하며 C/header4개의 bytes와 malformed/partial-frame 거절 조건은 유지한다.

SOURCE51은 Darwin v2의 내부 slot 값에 preparation:<UUID-v4> namespace를 추가한다.
동시 준비 작업마다 독립 journal row를 갖고 다른 준비 작업이나 Resident를 대신하지 않는다.
기존 literal preparation·다른 기존 slot·header·frame fields·hash chain·witness encoding은 유지한다.
기존 기록을 다시 쓰거나 accepted plan/request/receipt/state bytes를 migration하지 않는다.
Linux v1의 slot grammar는 바꾸지 않으며 불완전 UUID·principal 이름·경로 문자열은 거절한다.
실제 파일 시험으로 독립 opening3개·기존 prefix bytes 보존·invalid append 무변경·Linux 거절을 확인했다.
새 purpose는 역할 권한이 아니며 opening-only/unknown의 기존 recovery 거절을 유지한다.

ContextRepository의 -C /proc/self/fd/3 의존은 제거한다. shared workflow는 -C .와 held directory를 넘긴다.
Process는 Linux의 유지한 parent proc descriptor, Darwin은 기존 helper의 directory fileport/fchdir를 사용한다.
호출자는 FD를 완료까지 보유하며 pathname cwd와 함께 주면 시작 전 거절한다. control도 await 전에 복사한다.
경로를 rename한 뒤 replacement를 만들어도 원래 held directory에만 쓰는 실제 Linux 회귀가 PASS다.
기존 context publication·preaccept·shutdown·owned-directory도 올바른 dist/test 출력에서 존재를 확인하고 실행했다.
이전 선택 실행에 적은 test-dist 경로는 없어서 Node의 glob가 해당 TS 인자를 실행하지 않았다.
앞선57/57 수치는 실제 실행한 MJS 수치이며 빠진 TS를 검증한 근거로 사용하지 않는다.
이번 수정 뒤 build와 실제 선택75/75·fail/cancel/skip/todo0가 PASS다.

실제 Mac application 취소 시험은 aborted 결과와 실제 complete CID 소멸을 각각 요구한다.
owner stop에 없는 child wait status를 SIGKILL이라고 만들어내지 않는다.
동시 application 준비 작업2개도 각기 다른 row/CID를 갖고 하나를 멈춰도 다른 작업이 살아 있는지 시험한다.
Context preparation의 실제 Git object/GOAL bytes와 accepted ref 미변경을 common 및 독립 packed Git smoke에 추가했다.
이 SOURCE51의 Mac 실행·동시 slot/Host-crash/held-cwd qualification은 아직 NOT_RUN이다.
기존 product guard·default launchBlockedDarwin guard·세 OPEN gate는 유지한다.

SOURCE50 ARM runtime ZIP13366003794 SHA-256
`1aeb62b1f5de8ea2ac213d8bdcbd308512db6b057374b008e0aa035ca7fa83b0`의 독립 packed 설치는27/27 PASS다.
이 결과는 SOURCE51에서 추가한 Context candidate 생성의 검증을 대신하지 않는다.
ARM gate ZIP13365499978 SHA-256
`9acafe5f6925e3f2d9d1742e4032c8e6ef632dbd9c6e8a382c6d235977297ec0`,
Mac15 gate ZIP13366204002 SHA-256
`443fe15545c15ff884842a6fd2863b1dc8766d57843ef41cb12f4aaf84cf65b5`는
각120 executed/114 OBSERVED/6 Worker SETUP_FAILED다. Mac15는 Darwin24.6/SDK15.5다.
canonical 전후는 위 SOURCE50과 같고 ARM runtime은 위 shared 값, Mac15 runtime15526/27 전후는
`b52d551473728c7cb044d003bddc0e076dd6e0c42754535cf1500705708a6808`로 같다.
제품은 여전히 BLOCKED다.

SOURCE49 full Linux Architecture
[41912881861](https://github.com/minjung2035/oma-v2-ci/actions/runs/41912881861)의
artifact13365663333 SHA-256
`95122b31fc8a3629a7c1deed9e3444cbf353d8f19c8e87bde9848f7292c6e508`도 대조했다.
source `4470da78dd79a658ef277a91d45fe93ba08e3e8f`, before/after15874/
`8d4ae9f663e403fb88e6a46d688921bbc9d772c9c0793ac09e524eebf44b7f02`가 같다.
all4827/4827·fail/cancel/skip/todo0, sourceChanges[],13 command code0/signal-null/timedOut-false다.
이 결과를 SOURCE51이나 전체 Mac 제품 완료로 옮겨 쓰지 않는다.

SOURCE51 최종 고정 production의 build·선택75/75·Linux 독립 packed27/27이 PASS다.
확장한 Git smoke의 실제 context candidate/GOAL bytes·accepted ref 미변경도 이 독립 설치에서 확인했다.
전체 module/architecture/durable boundary/문서/spec gate가 통과했다.
구조 자료는 NOT_REVIEWED14361·CHANGED_WITHOUT_ORACLE30·REMOVED220을 유지하며 승인을 생성하지 않았다.
이후 변경은 이 결과와 input binding이며, SOURCE51 실제 Mac 재검증은 아직 회수 전이다.

### Trusted generation의 Host helper 선택 결박 (SOURCE52)

SOURCE51 `5f899d7f961675f44855c53f6b1266bc39aabe3f`는 Native
[41923440218](https://github.com/minjung2035/oma-v2-ci/actions/runs/41923440218), Architecture
[41923440173](https://github.com/minjung2035/oma-v2-ci/actions/runs/41923440173)에 발행했다.
canonical15889/`d85e277c069b01e1e39bb82d8fed4d7ea36f62677e70a7e02f5bf24a521514a8`다.
이 단락 작성 시 실제 Mac 결과는 회수 전이다.

SOURCE52는 generation launch에서 사용하는 Host의 job helper·Seatbelt image와 private Node를
trusted selection에 결박한다. helper2개는 configured digest로 검증한 manifest의 개별 SHA-256,
Node는 held descriptor에서 검증해 복사한 실제 bytes의 SHA-256을 사용한다.
Native는 held image의 전체 file hash와 stat 전후 동일을 대조하고, 이후 기존 mapped-image CDHash/멈춤 검사를 유지한다.
불일치와 malformed stage digest는 실제 job 생성 시도 전 거절한다.
지정된 helper 외의 임의 pathname/stage 실행 권한을 새로 부여하지 않는다.

generation은 caller의 image-digest 옵션을 자신의 고정 selection으로 덮어쓴다.
전체 설치 시험은 고의의 잘못된 caller 값을 주어도 같은 trusted generation selection만 쓰도록 요구한다.
별도의 작은 실제-FD fixture는 다른 helper bytes가 들어 있는 trusted manifest와 현재 Host helper의
불일치를 검사한다. 27 workspace의 최소 inventory와 실제 Node 복사를 사용하며 helper/Seatbelt 두 경우를 분리한다.
불일치가 authority에 도달하지 않고 opening을 반납하며 private generation을 회수하는지 확인한다.
이는 startup orphan collection이나 current Actor/Run authority를 증명하지 않는다.

primitive 시험도 job helper·target Node·Seatbelt stage의 각 hash 불일치와 모든 digest가 맞는 실제 실행을 대조한다.
로컬 build와 관련12/12는 PASS다. Linux에서는 최소 inventory의 실제 I/O와 explicit Darwin refusal만 확인했다.
SOURCE52의 실제 Mac positive/negative 실행은 NOT_RUN이며 기존 전체 generation timeout240초는 늘리지 않았다.
제품의 Native support/default launch guard와 G-PROCESS/G-FILES/G-AUTH OPEN은 유지한다.

SOURCE51의 실제 ARM shared ZIP13369520190 SHA-256
`c3c8b2cf5d442146ba74769235285ee90bb1676abe8426d9e9071d6b13f051d5`를 대조했다.
380/380 PASS·fail/cancel/skip/todo0다. held directory rename·실제 Context candidate,
application preparation의 journal 기록/취소 뒤 complete CID 소멸, 독립 동시 preparation2개,
preparation Host SIGKILL 뒤 새 controller recovery와 기존 whole generation이 모두 PASS다.
canonical15889/`d85e277c069b01e1e39bb82d8fed4d7ea36f62677e70a7e02f5bf24a521514a8`와
runtime15526/27/`a96d32d5e02890f9f6ceca6766ffd92b184e85dfdf0810bc29bbb7c928fefd66`는 각각 전후 동일하다.
ARM gate ZIP13369505460 SHA-256
`93638af934d5a4e9fea1797d99575f781f2bf314106dbbd31ec98d37baa27ca6`는
120 executed/114 OBSERVED/6 Worker SETUP_FAILED다. canonical/runtime 전후도 위 ARM 값과 같다.
이 실제 component 결과를 Society lease·startup orphan generation·실제 product Actor admission의 완료로 확대하지 않는다.
SOURCE52 helper digest selection의 실제 실행은 이 이전 source의 PASS를 승계하지 않는다.

SOURCE52 최종 고정 production의 build·관련12/12·Linux 독립 packed27/27과 전체 architecture/module/durable boundary/문서/spec 검사가 PASS다.
구조 review 상태는 CHANGED_WITHOUT_ORACLE32·NOT_REVIEWED14359·REMOVED220이며 새 승인을 생성하지 않았다.
실제 Mac SOURCE52 검증은 별도 CI 결과로 기록한다.

### Run endpoint의 선행 확보와 listener 인수 (SOURCE53)

SOURCE52 `f6bbfd97a32706fdf983526d6a325f450f063095`는 work branch에 발행했다.
canonical15889/`7f8a7eb0d56ba20dfea350e93da9dfba7e89c9efb767750e0af2bcaff2023579`다.

SOURCE53은 동일 Mach transport가 미래 Actor/Run rendezvous의 실제 receive right를 미리 확보하고,
나중에 Broker listener가 그 right를 한 번 인수할 수 있게 한다. reservation은 실제 Host audit source와
그 endpoint의 send capability만 제공한다. Actor/incarnation을 확정하거나 역할·요청 authority를 만들지 않는다.
기존 48-byte OPEN의 정확한 목적 hash와 kernel sender·live pin 검사는 유지한다.
동일 endpoint의 중복 소유는 거절하며 인수 전 종료는 receive right를 닫는다.
인수 후에는 listener가 receive right를 소유하고, 준비용 참조를 닫아도 live listener를 닫지 않는다.
listener 종료는 아직 남아 있는 준비용 send 참조에도 endpoint를 폐기하며, resource return 실패는 sticky하다.

실제 Darwin fixture는 listener가 생기기 전 잘못된 목적의 OPEN을 queue하고, 선행 capability를
trusted Runner에 전달한 뒤 listener가 인수하도록 구성한다. 실제 scope가 준비되면 reservation을 닫고,
직접 Seatbelt Worker의 original Host/full scope membership·393217-byte 양방향/EOF·반납을 검사한다.
이 추가 실제 Mac case는 아직 NOT_RUN이다. Linux 결과는 backend refusal과 공통 입력 검사만 뜻한다.
이 변경만으로 product Runner assembly·current Actor admission이 완료되었다고 판단하지 않는다.

SOURCE51 Intel shared ZIP13368921623 SHA-256
`c72a16159f7d3b7fdab4c2e25bbcf93821f4c2ee2d53aee735c79b9ab072a0e8`를 대조했다.
380/380 PASS·fail/cancel/skip/todo0이며 canonical15889/d85e277c069b01e1e39bb82d8fed4d7ea36f62677e70a7e02f5bf24a521514a8,
runtime15526/27/`d706e825dce4e6cf249d1dbe0831530aee8a58b78628661a9d2965bd2ab2e02a`가 전후 같다.
SOURCE51 ARM full runtime ZIP13369106305 SHA-256
`73b211508c2ca42cc5bc7411301ada4a862dadf2ac4f61951b6c6c8071f9f97f`는 실제 Darwin packed27/27 PASS다.
이 ZIP의 canonical 및 runtime 전후는 위 SOURCE51 ARM shared 값과 같다.
제품 BLOCKED와 G-PROCESS/G-FILES/G-AUTH OPEN은 유지한다.

SOURCE52 ARM 실제 shared ZIP13370780158 SHA-256
`f2ee82fcca1413532a164f56e8405e61f9961b57d3a98d5fb094cfcd6db9ffef`를 대조했다.
383 tests/382 PASS/1 FAIL·cancel/skip/todo0다. source f6bbfd97a32706fdf983526d6a325f450f063095,
canonical15889/7f8a7eb0d56ba20dfea350e93da9dfba7e89c9efb767750e0af2bcaff2023579,
runtime15526/27/`3a2ce1de64736fb8e629275803e9da790bf8e1e11698330d058c923b9f970f38`가 전후 같다.
전체 generation과 helper/Seatbelt 각각의 trusted-manifest 불일치 거절은 PASS다.
실패1건은 primitive digest test의 HOME/TMPDIR가 explicit writable root 안에 없어서 양성 recipe도 거절된 것이다.
이전 negative의 같은 code만 보는 assertion도 잘못된 정책 거절을 구분하지 못했다.
SOURCE53은 시험의 private temporary만 writable에 넣고, 세 negative 모두 정확한 image-digest mismatch 메시지를 요구한다.
실행 권한·제품 정책을 완화하지 않았으며 이 fixture의 실제 수정 후 재시험은 NOT_RUN이다.

SOURCE53 고정 production build·관련19/19·Linux 독립 packed27/27과 전체 architecture/module/durable boundary/문서/spec gate가 PASS다.
Linux19에는 Mac backend refusal이 포함되므로 추가 Darwin reservation 및 보정된 digest 양성의 실제 PASS로 쓰지 않는다.
review 상태는 CHANGED_WITHOUT_ORACLE32·NOT_REVIEWED14359·REMOVED220이며 승인을 생성하지 않았다.
최종 시험/이 문서 변경 뒤 구조 input을 다시 결박한다.

### Private generation과 공통 Resident 실행 조립 (SOURCE54)

SOURCE53 `bcbd5c281cbb5dd7c0b9282a8e66855cda1002f1`는 Native
[41928606381](https://github.com/minjung2035/oma-v2-ci/actions/runs/41928606381), Architecture
[41928606378](https://github.com/minjung2035/oma-v2-ci/actions/runs/41928606378)에 발행했다.
canonical15889/`caf7a1c2d204c4027a3c6c242a4658f359fed2185d3b9a2fdea7338b51975d01`다.
이 단락 작성 시 SOURCE53 실제 추가 case는 회수 전이다.
SOURCE52 Intel/Mac15와 나머지 pending jobs는 다음 Native 입력 발행으로 취소되었으며 PASS로 기록하지 않는다.

SOURCE54는 App의 동일 Mach transport를 Resident 준비와 Broker listener에 결박한다.
Resident는 현재 incarnation의 다음 endpoint를 물리적으로 확보하되 ledger의 incarnation이나 Run authority를 바꾸지 않는다.
공통 ExecutionRuntime의 journal·준비 뒤 재인가·취소·complete scope 반납을 유지하며,
명시적인 trusted Darwin launch만 private generation으로 전달한다. Linux는 기존 namespace producer를 사용한다.
Darwin Runner 개인 채널은 execution ticket의 실제 독립 child pin으로 묶고, 숫자 PID나 채널의 자기 주장을 pin으로 바꾸지 않는다.
준비 참조는 완전한 실행 반납 뒤 닫고, 인수된 receive right의 종료는 Broker listener가 소유한다.

Broker는 기존 scope recovery 뒤 stateRoot의 sibling private cache에 새 generation을 만든다.
Resident와 native owner drain 뒤에만 generation을 반납하며, 기존 unknown/active scope 거절을 유지한다.
실행 중 Runner는 자신의 실제 entry URL과 process.execPath로 private 설치/Node를 선택하여
Pi·core extension·client preload를 mutable original installation으로 되돌리지 않는다.
config의 deploymentDigest·accepted plan·persisted journal 형식은 바꾸지 않는다.

Node를 private copy로 옮겨도 선택된 원래 distribution의 npm/npx/corepack 기능은 유지해야 한다.
이를 위해 transient SandboxHost/RunnerConfinement의 toolchainNode로 선택된 tool source를 전달한다.
Worker PATH는 private Node, 선택된 distribution bin, actor local bin 순서를 유지한다.
Mac policy는 package-manager 세 command의 literal과 선택된 module roots만 허용하며 bin 전체의 read/exec root를 추가하지 않는다.
이 도구 입력은 model IPC/config 확장이 아니고 trusted Runner/preload의 library generation을 original root로 바꾸지 않는다.
공통 설치 grammar와 Mac의 state/writable overlap 거절을 적용한다. Linux의 동일 transient 값은 기존 mount adapter가 소비한다.

새 실제 Darwin 통합 fixture는 작은 27-workspace 설치와 실제 Native helper bytes를 고정하고,
App NativeResidents/ExecutionRuntime/Store/journal/control pair 및 private Node를 사용한다.
receiver는 시험 프로그램이며 product Runner/Worker가 아니다. 실제 PID/UID·FD6·private entry/Node,
받은 profile/model·journal execution과 binding, 선행 endpoint의 listener 인수,
stop 뒤 실제 pin revoke·빈 journal 및 incarnation 미변경을 요구한다.
실제 Mac 결과는 NOT_RUN이다. 이 시험을 whole product Actor/Run admission 증명으로 올리지 않는다.

아직 generation 제작/수집은 동기 I/O이며 시작 중 Host-loss 처리와 orphan cache 수집은 미완료다.
Society lease·실제 product Worker admission·resource profile·전체 CLI/reboot qualification도 미완료다.
native-support/default blocked launch와 G-PROCESS/G-FILES/G-AUTH OPEN을 유지하며 timeout이나 기능 계약을 완화하지 않는다.

SOURCE54 첫 build는 별도 GitSandboxHost에 없는 toolchainNode를 참조하여 TS2339로 실패했다.
그 불필요한 Git adapter 변경을 반납한 뒤 재build는 PASS였고, 이후 PATH 우선순위 보강의 최종 build를 별도로 실행한다.
첫 선택 시험14건 중 import 이름 오류1건을 보존하며 수정 후14/14가 PASS다.
실제 Linux namespace/control/Resident/log 선택15/15도 PASS다.
최종 build 뒤 다시 고정한 검증 결과는 후속 단락에 기록한다.

SOURCE53 ARM 실제 shared ZIP13370234610 SHA-256
`b5a693acea995a2a6352a182084cbe3a50e44007435f1cb5f571c8103d21ba06`를 대조했다.
385/385 PASS·fail/cancel/skip/todo0이며 canonical15889/caf7a1c2d204c4027a3c6c242a4658f359fed2185d3b9a2fdea7338b51975d01,
runtime15526/27/`1646f78a9d4ff48dcb7e274839abf8925cfbbf275acfaa923f391a3a9bce8e2f`가 전후 같다.
실제 pre-listener capability 전달·잘못된 목적 OPEN 거절·인수 후 준비 참조 종료·listener revoke,
Runner→직접 Seatbelt Worker의 original Host/full CID·393217-byte 양방향/EOF와
보정된 primitive 세 image-digest mismatch 및 matched positive가 모두 PASS다.
이는 SOURCE54 새 Resident 조립의 실제 PASS나 Society lease의 완료가 아니다.

SOURCE54 최종 production의 고정 build는 PASS다. 관련 policy/path19/19,
실제 Linux namespace/Resident/control/log 및 compiled Runner/environment 선택38/38이 PASS다.
최초 선택15개와 최종38개를 중복 합산하지 않는다. 새 Mac 통합 fixture의 Linux 결과는 backend refusal만 뜻한다.
required path의 기존 거절을 보존하며 optional toolchain 값만 확장했고,
이 최종 production 뒤 graph/LOC/review/독립 설치/architecture를 고정하여 검증한다.

SOURCE53 Intel shared ZIP13369574410 SHA-256
`ba3e6676e9d517cb7e2e0a440179640147a3121151bebeb711078a1c8d9902d2`도 대조했다.
385/385 PASS·fail/cancel/skip/todo0이며 source bcbd5c281cbb5dd7c0b9282a8e66855cda1002f1,
canonical15889/caf7a1c2d204c4027a3c6c242a4658f359fed2185d3b9a2fdea7338b51975d01,
runtime15526/27/`829e14112da54561ec66ccb03b7e1aee43b5f8a3d18b635096824d0c38ad1a7f`가 전후 같다.
ARM primary와 Intel supplemental에서 SOURCE53 reservation/mismatch/whole-generation component가 통과한 것이며,
SOURCE54의 새 App Resident fixture나 product qualification으로 옮겨 쓰지 않는다.

Society lease 후보 검토에서 [고정 XNU kern_guarded.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_guarded.c)의
change_fdguard_np를 확인했다. 이 구현은 guard를 붙일 때 FD_CLOEXEC를 강제하고 GUARD_CLOSE에 FD_CLOFORK도 강제한다.
따라서 이 guard를 그대로 기존 exec/fork 상속 lease로 사용할 수 있다고 가정하지 않는다.
이는 source 검토이며 실제 OS guard 시험이나 lease 구현 완료가 아니다. private selector/다른 lease 후보를 자동 채택하지 않는다.
Worker의 직접 Node recipe에 global module search를 끄는 추가 초기 argv 적용과 실제 loader 거절 검증도 아직 남아 있다.

SOURCE54 첫 최종 architecture는 실행 중인 entry의 설치 root를 asset URL처럼 표현하여 module ownership 검사에서 실패했다.
소유 asset 선언이나 검사를 완화하지 않고, 고정된 entry 배치의 dirname/resolve로 실행 root를 구하도록 고쳤다.
이 한 App 변경 뒤 build·선택 검사·구조 metadata·독립 설치를 새로 고정하며 앞 입력의 PASS를 승계하지 않는다.

SOURCE54 owned-root 수정 뒤 고정 build·관련 policy/path19/19·실제 Linux/compiled Runner 선택38/38·독립 packed27/27이 PASS다.
review 상태는 CHANGED_WITHOUT_ORACLE29·NOT_REVIEWED14362·REMOVED220이며 승인을 생성하지 않았다.
전체 architecture를 이 고정 입력에 다시 결박하여 실행한다.

SOURCE54 owned-root 고정 production의 전체 module/architecture/graph/durable boundary/문서/spec gate가 PASS다.
최종 변경은 이 결과 기록과 구조 input binding이며, SOURCE54 실제 Mac의 새 Resident 통합 결과는 아직 회수 전이다.

### Generation 준비의 이벤트 처리·부분 반납과 Runner membership (SOURCE55)

SOURCE54 `f9e1dafe51ec78cc7d2a71f2ef5aa93e6b8900db`는 Native
[41932357288](https://github.com/minjung2035/oma-v2-ci/actions/runs/41932357288), Architecture
[41932357293](https://github.com/minjung2035/oma-v2-ci/actions/runs/41932357293)에 발행했다.
canonical15890/`1b8360db8f154f8c6793c90423c0c9ee4ccbc1e07463e6e8b7e8b2a9d17696c3`다.
ARM shared ZIP13373000996 SHA-256
`5d92235bebe05a21beca11e4b301d4921f47e4bccce31dc897351363336a9aeb`를 대조했다.
387 tests/386 PASS/1 FAIL·cancel/skip/todo0이고 canonical은 위 값으로 전후 같다.
runtime15526/27/`5f52b416781387bed316b3c86bfabca71859870543c92809d21ae74182efb04f`도 전후 같다.
실패1건은 새 Resident fixture에서 실제 `darwin-resource-coalition` witness를 옛 audit-session으로 잘못 분기하여
Linux pinNamespaceRunner를 호출한 것이다. 이 실패를 준비·PID hint의 일시 오류나 product PASS로 바꾸지 않는다.

SOURCE55는 해당 분기를 현재 witness로 고치고 legacy/다른 physical witness를 Linux로 cast하지 않는다.
coalition witness에는 PID/pidVersion이 없으므로 scopeRoot는 null을 유지하고 scopeIdentity만 전달한다.
개인 채널의 BoundPeer에는 실제 independently retained child pin의 optional physical inScope 관측을 전달한다.
Native는 자기 genuine pin의 full generation/watch·boot/CID를 현재 kernel에서 재검사하고,
선택된 scope의 exact kind/boot/CID가 맞으며 여전히 살아 있는 경우에만 membership을 반환한다.
공통 owner가 보유한 slot이나 caller의 PID/boolean을 membership으로 바꾸지 않는다.
Broker의 current Actor/Run/spec/capability 검사는 그대로다. 새 시험은 다른 boot/CID와 exec/stop 뒤 거절을 요구한다.
이 수정 후 실제 Mac App fixture는 아직 NOT_RUN이다.

설치 inventory와 generation 생산자는 같은 generator 절차를 synchronous/async driver가 소비한다.
파일·디렉터리의 inventory/복사/봉인 사이에 이벤트 처리를 재개하며, abort는 한 번만 generator에 전달한다.
그 뒤 부분 generation의 정리와 descriptor 반환이 끝날 때까지 driver를 계속 진행한다.
Broker는 pending preparation을 명시적으로 보유하고 shutdown이 이를 합류한 뒤 native owner와 generation을 반납한다.
async close를 시작하면 generation의 새 launch를 닫고, active/unknown scope에서는 여전히 반환을 거절한다.
이 단계는 crash 뒤 orphan adoption/collection이 아니다.

실제 SOURCE53 Intel whole-generation 시험은 265656ms였고 설정 timeout240초보다 길었다.
동기 constructor/cleanup의 긴 구간을 실제 240초 충족 증거로 쓰지 않는다.
SOURCE55는 봉인/해제 때 각 파일의 긴 전체 상대 경로를 반복 재개방하는 대신 부모 directory descriptor를 유지한다.
각 entry의 원래 dev/ino, Native 소유·single-link·ABI/flags 전후 검사와 directory flush는 유지한다.
root parent도 봉인 완료 뒤 flush한다. 기존 timeout240초는 늘리지 않는다.
개별 Native copy/fsync와 마지막 removeOwnedTreeAt는 동기 작업이므로 모든 I/O의 8ms 상한을 증명한 것은 아니다.
실제 latency/Host-loss·orphan qualification은 추가 검증이 필요하다.

Worker의 직접 private-profile Node argv에도 --no-global-search-paths를 넣는다.
fixture는 일반 Runner에서 HOME의 실제 global module을 읽어 양성 대조하고,
직접 Seatbelt Worker에서는 같은 bytes의 읽기는 가능하지만 require는 MODULE_NOT_FOUND여야 한다.
original Host/full CID·양방향 bytes/EOF·같은 Node image 검사는 유지한다.
Linux Node26의 별도 실제 대조도 flag 없음→module 값, flag 있음→MODULE_NOT_FOUND를 확인했다.
새 Darwin loader/준비 abort/heartbeat·collect 경로는 아직 NOT_RUN이며 product guard는 유지한다.

첫 cooperative build와 관련29/29는 PASS였고, 실제 Intel 소요시간 확인 뒤 directory walk를 보강했다.
SOURCE54 실패 회수 뒤 witness/membership 수정까지 최종 build가 PASS다.
고정 관련59/59가 PASS이며 Linux에서는 실제 iterator/FD 반납·inventory/정책·backend refusal을 확인했다.
Mac 전용 가지의 Linux 통과를 실제 Mac positive로 기록하지 않는다.
첫 Linux scope harness는 Node 실행 경로 오타로 child test 전 실패했으며 수정 실행을 별도로 기록한다.
세 product gate OPEN·native-support/default blocked launch·미완료 Society lease/orphan/full CLI/reboot는 유지한다.

SOURCE55 고정 production의 실제 Linux/compiled Runner 선택33/33은 실행 경로를 고친 별도 harness에서 PASS다.
고정 review 상태는 CHANGED_WITHOUT_ORACLE30·NOT_REVIEWED14361·REMOVED220이며 승인을 생성하지 않았다.
전체 architecture를 이 input에 결박하여 실행한다.

SOURCE55 첫 architecture는 collection 함수가 generator 본문으로 이동했는데 boundary registry가 옛 wrapper 이름을 가리켜 실패했다.
registry owner만 runtimeGenerationSteps로 갱신하고 기존 logical 시험·fact·injection 강도는 그대로 유지했다.
이를 SIGKILL/orphan/power-loss 증거로 올리지 않는다. 이 metadata 수정 뒤 input을 다시 결박한다.

SOURCE55 최종 고정 production의 build·선택59/59·실제 Linux/compiled Runner33/33·독립 packed27/27이 PASS다.
module/architecture/graph/transactions는 PASS이며, boundary owner metadata를 고친 뒤 boundary/문서/spec도 PASS다.
실제 whole-generation fixture는 같은 live scope에서 sync/async close 양쪽 거절을 요구하도록 확장했다.
이 추가 assertion과 결과 기록 뒤 구조 input을 다시 결박한다. 새 Mac positive는 아직 NOT_RUN이다.

### 복구가 확인된 창에서의 disposable generation 회수 (SOURCE56)

SOURCE55 `d2b1e01b91d51262484faa088298989163f60282`는 Native
[41935406131](https://github.com/minjung2035/oma-v2-ci/actions/runs/41935406131), Architecture
[41935406099](https://github.com/minjung2035/oma-v2-ci/actions/runs/41935406099)에 발행했다.
canonical15890/`57e3ab09a30a7304db5a93e02475e9414a85defb403110d8469c5139475bc947`다.
ARM shared ZIP13373662313 SHA-256
`971b963fd2c8a80298fd6c1ab82fb63beecf758d34891d3abe07d9923ce7edb4`를 대조했다.
389/389 PASS·fail/cancel/skip/todo0이며 위 canonical이 전후 같다.
runtime15526/27/`3b304def2369de403118f71ee7dfef844db7825f7e356dc8aead72f8d06ccc79`도 전후 같다.
실제 private Node App Resident의 FD6·독립 child pin·현재 coalition membership, 다른 boot/CID와 stop 뒤 거절,
선행 endpoint 예약과 직접 Worker의 original Host/full CID·양방향 bytes/EOF,
일반 Runner의 global module 양성 대조와 직접 Worker의 loader 거절이 PASS다.
async generation의 heartbeat·부분 준비 취소·active scope의 sync/async close 거절·helper digest도 PASS다.
이는 전체 product Worker admission이나 Society lease 완료가 아니다.

Intel shared ZIP13373659045 SHA-256
`4cb3220c3488fbcb350e7fba97c7b346ff52dc11528cb2b0bb34bfacf0a4e725`를 대조했다.
389 tests/388 PASS/0 FAIL/1 CANCELLED이며 cancel은 whole-generation의 기존 timeout240초다.
canonical은 위 SOURCE55 값, runtime15526/27/`00a9fe99e487e290a1791f2ea2f4190d66f0d80f7db6dcbeeb2ebee34655df34`가 전후 같다.
이를 전체 PASS나 timeout 충족으로 기록하지 않는다. ARM whole-generation은122773ms였고,
Intel은 fixture31947ms·source hash8845ms 뒤 constructor가 timeout 안에 반환하지 못했다.

SOURCE56는 같은 ExecutionRuntime의 admission을 닫은 상태에서 실제 journal recovery를 수행하고,
current owner를 포함하여 journal이 비었음을 확인한 뒤에만 disposable 파일 회수 callback에 들어간다.
준비/실행 admission이 진행 중이면 진입을 거절하고, 회수 중 run/begin 및 bound preparation을 거절한다.
effect 실패는 이후 admission을 계속 닫으며 shutdown은 진행 중 회수에 합류한 뒤 실제 journal을 반납한다.
effect 전 shutdown은 CANCELLED_BEFORE_COMMIT으로 끝나고 파일 callback은 실행하지 않는다.
현재 owner를 건너뛰는 recover() 반환만으로 사망·quiescence를 가정하지 않는다.

generation은 payload 복사 전에 opening 이름 아래 private owner marker를 flush하고 exclusive final 이름으로 발행한다.
marker는 실제 parent/root dev·ino·UID와 configured deploymentDigest 및 허용 경로/종류에 결박된다.
회수는 이 marker가 있는 인식된 이름만 대상으로 삼고, held live producer와 다른 inode·링크·추가 파일을 거절한다.
전체 tree를 검사한 뒤 같은 inode를 다시 확인하며 UF_IMMUTABLE만 해제하고 descriptor 기준으로 반납한다.
opening 이름에는 marker 또는 빈 디렉터리만 허용한다. marker 없는 옛 final generation은 자동 삭제하지 않는다.
Broker는 실제 recovery 창에서 이 작업을 수행한 뒤 새 generation을 준비한다.
source deployment나 accepted plan·journal schema는 바꾸지 않는다. startup adoption/reuse는 구현하지 않았다.

Intel의 반복 경로 재개방 비용을 줄이기 위해 복사를 parent directory별로 묶고 held source/target descriptor를 유지한다.
파일별 이중 hash·source 전후 검사·fsync·fresh single-link copy·mode·전체 inventory 검증·Native flag 검사는 유지한다.
timeout240초를 늘리지 않았다. 시험의 pending constructor도 abort/join한 뒤 cleanup하여 timeout과 정리가 경합하지 않게 한다.
이 최적화와 실제 SIGKILL preparing/running producer 회수의 Mac 결과는 아직 NOT_RUN이다.
새 durable boundary 등록은 static owner/injection 연결이며 실제 Mac SIGKILL·power-loss의 PASS가 아니다.

고정 production build는 PASS다. 관련14/14와 실제 Linux namespace/compiled Runner·maintenance36/36이 PASS다.
Linux 관련14개 중 Mac 전용 가지는 backend refusal만 확인한다. portable marker 시험은 실제 FD와 복제된 claim 거절을 사용한다.
처음 maintenance 시험은 잘못된 test journal version으로 1/2였고 protocol 상수로 수정한 2/2와 최종3/3을 별도로 확인했다.
첫 boundary 검사는 새 collect owner 미등록으로 실패했으며 owner/fact를 등록한 static 검사는 PASS다.
현재 G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED와 native-support/default launch guard를 유지한다.
Society lease·전체 product Actor/Run admission·자원 profile·전체 CLI·실제 reboot/sleep/power-loss qualification은 미완료다.
private cache의 전체 alias/다른 Society writable 배제와 startup reuse/latency qualification도 남아 있다.

SOURCE55 전체 Linux artifact ZIP13375775154 SHA-256
`3b887760701c4347b6e59870355a37af80d9e8016c185408ec7d983a490e721f`는4846 tests/4826 PASS/20 FAIL·cancel/skip/todo0다.
baseline ZIP13376206127 SHA-256 `26d2ed14fd0bc1dc2c1fc1b3c069a1e03101c89af7bd1baf61eb852d9c9b0739`도 대조했다.
baseline의 loc/test/fast/durable는 실패, property/stress/platform은 PASS다. 전체 성공으로 합성하지 않는다.
실패에는 새 Broker import를 빠뜨린 controlled Linux composition dependency 목록,
Native로 옮긴 Seatbelt 자산의 옛 owner 기대값, optional transient SandboxHost.toolchainNode의 옛 fingerprint,
PreparationExecutor의 directoryFd controls를 버린 EML 추적 시험 wrapper가 있다.
SOURCE56는 해당 시험 owner/인자만 현 계약에 맞추고 public/durable DTO·실제 격리 조건·기대 거절을 완화하지 않는다.
composition/workspace33/33과 architecture mutation 포함 선택40/40을 각각 확인했으며 중복 합산하지 않는다.
EML wrapper의 수정 전 로컬 재현은 실제 cwd의 Git HEAD/index를 context fixture로 바꾸었다.
그 commit648ddff97006d9d7759b4fda8c5b6212df3e677e는 별도 checkpoint에 보존하고,
metadata backup 후 원래 SOURCE55 ref/index를 복구했다. 작업 파일은 반납/덮어쓰기하지 않았다.
수정한 wrapper는 모든 원래 controls를 전달하며 별도 build 뒤 실제 시험을 다시 실행한다.

LOC 실패는 pinned cloc의 adaptive filter alarm이 같은 xss.js를 exit0/code0의 불완전한 row로 내보낸 뒤
재측정 결과와 달라진 것이다. 실제 bytes의 alarm 없는 대조는 blank58/comment24/code279다.
측정 producer는 per-filter alarm을 끄고 기존 전체600초 제한을 유지하며 cloc error 진단도 명시적으로 거절한다.
이는 runtime/generation timeout240초 변경이 아니다. 실제 pinned cloc의 해당 bytes 반복 측정 회귀는 PASS다.
첫 inventory 선택은14/15였고 유일한 실패는 아직 갱신하지 않은 구조 input binding이었다.
review 상태는 CHANGED_WITHOUT_ORACLE31·NOT_REVIEWED14361·REMOVED220이며 승인을 생성하지 않았다.
고정 production의 독립 packed 설치27/27은 PASS다. 최종 input binding 뒤 전체 구조 검사를 실행한다.

SOURCE56 최종 test build는 PASS다. directory controls를 보존한 실제 EML8/8이 PASS이며
로컬 실행 전후 Git HEAD/index의 bytes identity가 같다. 구조 binding 뒤 inventory15/15도 PASS다.
고정 production의 전체 module/legacy/inventory/rule/architecture/transaction/boundary/문서/spec gate가 PASS다.
pinned cloc2.08의 전체14392 files 측정과 독립 재측정이 일치했고 code1458907은 이 입력의 정보성 수치다.
이 결과 기록 뒤 input을 다시 결박하고 문서/spec와 binding case를 확인한다.
새 Mac preparing/running SIGKILL 회수·live/foreign refusal·Intel latency의 실제 결과는 아직 NOT_RUN이다.

### Git 검사·반입의 private Node generation 결박 (SOURCE57)

SOURCE56 `2544ed0d05ddb084fcf7ccc08b15ecce34d41431`는 Native
[41941968241](https://github.com/minjung2035/oma-v2-ci/actions/runs/41941968241), Architecture
[41941968211](https://github.com/minjung2035/oma-v2-ci/actions/runs/41941968211)에 발행했다.
canonical15895/`83e067cf501abe835a9b60088c7d2a3706904f497d920a260c98aa1704355b65`다.
ARM shared ZIP13377300567 SHA-256
`55f76ef29925e524240ae4dbc785d9a57b0ae5a4bdd3bbf7d51185dd69b28a4b`와
Intel shared ZIP13377096894 SHA-256
`14263fdf7f7e23330c6e2b53388ffc3f8f9d7bc9b30af4de4cc188f2aa2fbab9`를 대조했다.
각397/397 PASS·fail/cancel/skip/todo0이며 위 canonical이 각 전후 같다.
runtime15528/27은 ARM `2dc008eb06e93bc70164d367a427a6cdb482a98f5745e629341bc54867c91103`,
Intel `f4931ab64c3aa559d347960b03a619c8403ec76206b75e83fe0f5e1078db2bd1`가 각 전후 같다.
whole-generation은 ARM101421ms·Intel171910ms로 기존240초 제한 안에 실제 반환했다.
Intel constructor124555ms이며 이는 startup reuse/latency 전체 qualification이 아니다.

두 실제 Mac에서 preparing/running producer SIGKILL 뒤 fresh ExecutionRuntime이 journal scope를 복구하고
완전한 CID 사망과 빈 journal을 확인한 다음 disposable tree를 회수했다.
live retained generation과 외부 추가 파일은 봉인을 해제하지 않고 거절했다.
복구 창 중 run/begin/bound preparation 거절, effect 실패의 지속 fencing,
effect 전 shutdown의 무효과·실제 journal 반납도 PASS다.
이 결과를 실제 OS reboot·전원 손실이나 전체 Society lease 증명으로 올리지 않는다.

SOURCE57는 Mac Git adapter의 원래 Node command/policy 설명과 direct Seatbelt observation recipe를 분리한다.
App CandidateChecks와 quarantine owner는 Broker가 보유한 같은 generation launch를 공통 ExecutionRuntime.run에 전달한다.
공통 journal·opening/witness·trusted setup·현재 권한 재검사·release·취소·전체 scope 반납 절차는 바꾸지 않는다.
명시적인 physical launch는 Darwin에서만 허용하고, Mac App Git owner에 private runtime이 없으면 실행을 거절한다.
accepted candidate·ref·prerequisite·bundle capability/cursor·pipeline DTO·receipt 형식은 바꾸지 않는다.

generation capture는 policy의 original installation 아래 readonly/mapped/executable/denied 경로도
private copy의 같은 상대 경로로 옮긴다. 원본 설치 전체를 읽는 권한을 덧붙여 mutable library fallback을 열지 않는다.
선택된 외부 toolchain·Git·developer paths와 check의 자기 script/native build 허용은 기존 설명을 유지한다.
초기 실행 Node와 설치 entry는 계속 immutable copy와 trusted helper image digest에 결박한다.

whole-generation 시험은 같은 private copy를 재사용하여 App의 실제 CandidateChecks와 QuarantineImporter를 실행하도록 확장했다.
generation 제작 뒤 원본 candidate-check/quarantine entry bytes를 실패 프로그램으로 바꾸고,
private scope의 exact checkout·원본 설치 읽기 거절·checkout 뒤 현재 권한 철회,
thin bundle verify-before-import·canonical refs 불변·원본 bundle bytes/cursor와 빈 journal·staging을 요구한다.
정리는 실제 owner drain 뒤 mutable fixture source를 복원한다. 이 새 Mac 가지는 아직 NOT_RUN이다.
별도 cold copy나 timeout 확대는 추가하지 않았으며 기존 whole-generation240초 안에서 실행한다.

Mac candidate 설명이 pipeline을 버리고 placeholder argv만 전달하는 누락도 고쳤다.
이제 기존 closed pipeline payload를 그대로 전달한다. Native의 pipeline supervisor 보호는 아직 Linux 전용이므로
Mac pipeline은 해당 보호가 실제 구현·검증되기 전 완료가 아니다. 임의 성공이나 보호 생략으로 처리하지 않는다.
캐시·physical tmp/npm 경로의 Linux 전제도 남아 있고 이 단락은 pipeline 전체 기능의 PASS가 아니다.
Society lease·전체 product Actor/Run admission·resource profile·전체 CLI/reboot·cache adoption은 미완료다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED와 native-support/default launch guard를 유지한다.

SOURCE57 첫 고정 build는 PASS였고 이후 pipeline 전달 한 파일을 보강한 최종 build도 PASS다.
보강 전 관련24/24와 실제 Linux candidate/quarantine/maintenance/staging17/17이 PASS다.
Linux에서 Mac 전용 whole-generation 가지는 backend refusal만 의미한다. 최종 pure-plan 선택은 별도로 실행한다.

최종 plan/조립/refusal25/25가 PASS다. 경로 재결박은 상대 suffix의 원래 spelling을 보존하여
..·중복 separator를 정규화해 허용하지 않도록 보강했고 같은25/25를 다시 확인했다.
이 한 App 변경 뒤 App build·graph/source digests를 새로 고정했다. 앞선 독립 packed27/27은 경로 spelling 보강 전 입력이다.
바뀌지 않은 library26개의 관측과 구분하며, App 보강 뒤 같은 명령을 재실행하지 않은 그 로컬 결과를 최종 packed27/27로 승계하지 않는다.
review는 CHANGED_WITHOUT_ORACLE30·NOT_REVIEWED14362·REMOVED220이며 generation 파일은 hash 승인이 없는 NOT_REVIEWED 상태다.
이 상태를 승인으로 바꾸지 않는다. 전체 architecture는 보강한 production에서 PASS였고,
아래 관측 fixture/workflow를 추가한 최종 입력에도 다시 결박한다.

pipeline supervisor 후보는 [고정 XNU ptrace](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/mach_process.c),
[task access 검사](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_proc.c),
[special-port 설정](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/ipc_tt.c)을 분리해 검토했다.
PT_DENY_ATTACH 성공만으로 Mach control/read access 거절을 가정하지 않는다. task access port는 기존 valid port의 덮어쓰기를 거절한다.
새 controlled C fixture는 ordinary/guard/Seatbelt guard의 실제 자기 supervisor와 직접 child만 대상으로
task control·SDK selector read/inspect·canary memory read·attach/detach와 실제 join을 각각 기록한다.
공통 execution owner가 모든 fixture scope를 반납하며 이 관측 시험은 어떤 결과도 production 보호 채택으로 바꾸지 않는다.
첫 cross object compile은 SDK include 경로, 다음은 SDK에 없는 read/inspect wrapper 선언 때문에 실패했다.
SDK selectors를 명시한 observation-only 호출로 고친 arm64 object compile은 PASS다. 실제 Mac 실행은 NOT_RUN이다.
Linux의 새 case1/1은 명시적 Darwin backend refusal만 의미한다. restricted entitlement·privileged service는 추가하지 않았다.

SOURCE57 최종 production의 build·관련25/25·실제 Linux 관련17/17이 PASS다. 선행 packed27의 App 입력 한계는 위와 같다.
관측 fixture/workflow를 포함한 전체 module/architecture/graph/transactions/boundaries/문서/spec도 PASS다.
supervisor 후보의 SDK arm64/Intel object compile과 Linux backend refusal은 PASS이며 실제 Mac guard 관측은 아직 NOT_RUN이다.
private Git 새 가지와 supervisor 후보를 실제 Mac qualification으로 승계하지 않는다.
이 결과 기록 뒤 구조 input을 재결박하고 문서/spec와 binding case를 확인한다.

### Owned developer 조회와 실제 Broker Actor/Run 관측 (SOURCE58)

SOURCE57 `18bbdf64401f71c10b0c263f454e4c2b4f8819ac`는 Native
[41944488047](https://github.com/minjung2035/oma-v2-ci/actions/runs/41944488047), Architecture
[41944487994](https://github.com/minjung2035/oma-v2-ci/actions/runs/41944487994)에 발행했다.
canonical15898/`2005bbd0d112427f204910e20ede2a4077d9f2b7fd050c0cdeef95b803c18b4d`다.
ARM shared ZIP13378602804 SHA-256 `a9f53b79525cb757fbec7cb608843d5b0f176c0f008f3e91febac0ba1a60a9ae`를 대조했다.
399 tests/398 PASS/1 FAIL·cancel/skip/todo0이며 canonical은 위 값으로 전후 같다.
runtime15528/27/`f5031e46e08a447a16bd5a369543dbdaf489d2d4742521c4c957787f97ffbfad`도 전후 같다.
whole-generation은168419ms 뒤 새 private Git fixture의 developer 관측에서 실패했다.
xcode-select -p의 실제 경로 관측은 반환했고 그 다음 owned xcrun --find git이
성공한 exited/non-truncated 결과를 내지 못해 기존 UNSUPPORTED_PROFILE로 거절했다.
그 입력은 원래 exit/signal/stderr를 cause에 남기지 않아 더 세부 원인은 미확정이다.
private Git 완료나 whole-generation PASS로 기록하지 않는다. 선행 immutable Node scope의 원본 설치 읽기 거절은 실행됐지만 전체 새 case는 FAIL다.

supervisor 관측 자체는 실제 ARM에서 실행됐다. 기존 task access port가 이미 valid여서
새 dead port 설정은 KERN_NO_ACCESS8로 거절됐다. PT_DENY_ATTACH는0, attach child는SIGSEGV11이었다.
Mach control/read/inspect는 ordinary 대조에서도 거절됐으므로 추가 보호의 양성 대조가 아니다.
이 조합을 production pipeline 보호로 채택하지 않는다. 기존 Linux 보호와 Mac 거절은 유지한다.

SOURCE58는 실제 scoped xcode-select가 선택한 developer installation의 고정 usr/bin/git을 realpath로 확인하고,
기존 closed bundle grammar를 적용한 뒤 같은 owned scope에서 Git --exec-path를 관측한다.
추가 service-using locator인 xcrun을 Git 선택에 사용하지 않는다. unchecked /usr/bin/git·host spawn fallback이나 timeout 확대는 없다.
실패하면 bounded 실제 command/argv·kind·exit/signal·truncation·stdout/stderr를 cause에 보존하며 공개 error vocabulary는 바꾸지 않는다.
새 작은 Mac 시험은 이 App bootstrap owner·actual journal·staging 반납을 직접 확인하고,
xcrun의 종전 미관측 종료값을 별도의 diagnostic으로 회수한다. 그 진단은 production tool 선택이나 death proof의 대체가 아니다.

다른 새 시험은 실제 Store/Mail/Lifecycle/Views/Broker·NativeResidents·Mach transport·ExecutionRuntime을 조립한다.
controller가 body PID나 사망 boolean을 공급하지 않는다. 실제 inherited FD6의 잘못된 actor/invocation을 거절한 뒤
current Run의 incarnation commit과 직접 Seatbelt Actor의 실제 kernel sender/full CID를 요구한다.
같은 Host의 genuine endpoint capability를 받은 다른 coalition은 role을 얻지 못해야 한다.
같은 live Actor가 기존 연결에서 desired=stopped 뒤 STALE_RUN을 받으며 아직 kernel member임도 독립 pin으로 확인한다.
마지막에는 실제 scope/journal 반납과 incarnation 미증가를 확인한다.
프로그램은 controlled protocol driver이며 product entry/Pi가 아니다. 작은 generation 밖의 실제 test library imports도 사용하므로
이를 전체 immutable-library 또는 product Runner/Worker qualification으로 올리지 않는다. 새 Mac 가지는 아직 NOT_RUN이다.

최종 production build와 관련13/13은 로컬에서 PASS다. Linux 새 Mac case는 명시적 backend refusal만 의미한다.
Society lease·전체 product Actor/Run 연결·Mac pipeline supervisor/cache/tmp·resource profile·전체 CLI/reboot/adoption은 미완료다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·native-support/default launch guard를 유지한다.

SOURCE57 Intel shared ZIP13377803175 SHA-256 `a70283782bb49ec4aa5ed47c9b145b45bd721bf637758a43f2de7d8c9b9a8070`도 대조했다.
399 tests/396 PASS/3 FAIL·cancel/skip/todo0이며 위 canonical이 전후 같다.
runtime15528/27/`496618e115390b2273bf23160c7e1fead89f63ba9ba0bfec0878242286524618`도 전후 같다.
실패는 같은 xcrun 조회, released-preparation Host-loss recovery의 RUN_TERMINATION_UNKNOWN,
새 supervisor fixture의 unsigned Intel executable 거절이다. 전체 generation은194412ms에 developer 조회에서 실패했다.
마지막은 owned fixture를 ad-hoc sign하여 기존 exact-image gate를 그대로 충족하도록 고쳤다. production image 검사는 완화하지 않는다.
복구 실패는 얕은 reporter가 native aggregate leaf를 생략해 원인 미확정이다.
새 시험 입력은 첫 실패·retained journal·fresh scope 관측과 전체 cause chain을 남기고 동일 오류를 그대로 다시 던진다.
retry·journal retire·unknown의 dead 변환을 추가하지 않으며 이 실패는 미해결 추적으로 남긴다.

SOURCE56 전체 Linux Native artifact ZIP13378597865 SHA-256
`a0eabff5997e3bc67af0608199d5eab79372b9e56ce36be68945f85ab06fcff0`는4855/4855 PASS·fail/cancel/skip/todo0·errors[]다.
source2544ed0d05ddb084fcf7ccc08b15ecce34d41431의15895 per-file hashes가 전후 동일하고 sourceChanges[]다.
baseline ZIP13378627914 SHA-256 `29005759ee634bf28f40df4f0dc7abff04dc7ecc7d4a933d8becbb6e5f6f57b0`도 대조했다.
provenance는 같은 source/canonical15895/83e067cf501abe835a9b60088c7d2a3706904f497d920a260c98aa1704355b65이며
inventory/LOC/typecheck/build/package/architecture/spec/test/fast/durable/property/stress/platform 명령의 exit가 모두0이다.
fast1200·durable937·property42·stress16·platform80이 각각 PASS다. kernel/crash는 별도 standalone NOT_RUN이며 native-all 실행 파일/required name 범위로만 기록한다.
이는 SOURCE55의20개 실패와 LOC 측정 실패를 고친 SOURCE56 결과다. SOURCE57/58의 새 Mac/Actor 입력으로 옮겨 쓰지 않는다.


SOURCE58의 frozen production 입력은 로컬 build와 새 Mac case의 Linux refusal 포함13/13,
복구·supervisor의 Linux refusal10/10을 통과했다. 생성 Actor/Runner fixture 문법 검사도 통과했다.
새로 수행한 packed isolation은 @oma/app을 포함한27개 workspace 전부 설치·public entry·authored declaration 검사를 통과했다.
이 결과는 Mac 실행 증거가 아니며 새 private Git/Actor 양성 경로는 Mac CI 전까지 NOT_RUN이다.
현재 production inventory14392, review ledger는 CHANGED_WITHOUT_ORACLE32/NOT_REVIEWED14360/REMOVED220이다.

SOURCE58 전체 architecture·transaction·durable boundary·document·spec inventory 검사가 모두 exit0으로 끝났다.
구조 검사 PASS는 Mac runtime 또는 product gate 완료를 뜻하지 않는다.


### SOURCE58 실제 Mac 결과와 다음 수정 입력

SOURCE58 `7ee69448905d09fd9bd50f90894863125cafa4ce`, Native41947439003/Architecture41947438987을 발행했다.
ARM shared ZIP13378964074 SHA-256 `6a3098401522a113d3f813c946dbf888cb877b80bc6928299bedf540b4350521`를 대조했다.
canonical15901/`a9a66b2c84db32054e8fd686cb238847d50236f3e9d7e9d6ce8e507487f5789c`와
runtime15528/27/`b91880620236b99c88c14c07896d1a1195fa4a31dd07c9fa3afd0d2c906491c6`가 각각 전후 같다.
401 tests/399 PASS/2 FAIL·cancel/skip/todo0다. 작은 실제 developer tool owner 시험은 PASS다.
선택된 Developer 안의 Git과 execPath, scope death·빈 journal/staging을 실제 확인했다.
종전 xcrun은 같은 pruned scope에서10013ms 뒤 timed-out이며 xcodebuild의 file-event/cache 진단을 남겼다.
이 관측은 xcrun을 추가 locator로 쓰지 않는 변경을 지지하며, timeout 확대나 host fallback의 근거가 아니다.

새 Broker 시험은 실제 current Run/Actor 양성·wrong actor/invocation 거절·genuine pin/CID 확인까지 통과한 뒤
외부 coalition 시험에 쓴 미등록 slot 문자열을 journal이 거절했다. 시험은 FAIL이며 전체 Actor/Run qualification이 아니다.
다음 입력은 기존 preparation slot을 사용한다. persisted journal grammar를 늘리지 않는다.
전체 generation 시험은215299ms에 quarantine의 physical launch 입력 거절로 실패했다.
앞선 실제 private candidate 성공·최종 권한 철회 경로를 지나갔으나 verify/import·전체 generation PASS가 아니다.
QuarantineImporter는 원래 stderr FD를 공급하는데 Mac command는 동시에 stderr capture64KiB를 요구했다.
Darwin capture는 이 중복을 거절하므로 caller가 명시적으로 FD 출력을 선택하도록 수리한다. validator는 유지한다.

Intel26 job126983266508은 checkout의 github.com DNS 실패3회 뒤 exit128로 끝났다.
코드/build/tests는 NOT_RUN이며 그 source의 복구 실패 수리 증거로 쓰지 않는다.
개별 재실행 요청은 실행 중 workflow라는 GitHub403으로 거절됐다. workflow 종료 또는 새 입력에서 실제 재검증이 필요하다.
ARM gate ZIP13378489936 SHA-256 `2458b36fb68581db60550a869273556e8d67e424e44c1e0d011286a165993fec`도 대조했다.
120실행/114 OBSERVED/6 SETUP_FAILED이며 미완료6개는 Worker bootstrap/tools 각3회다.
실제 product preload의 native-support guard가 거절했다. 이 실패를 양성 또는 guard 제거의 근거로 쓰지 않는다.
세 gate OPEN·product BLOCKED를 유지한다.

다음 SOURCE59는 pipeline의 trusted physical view를 양 OS adapter에서 공급한다.
공통 실행 코드의 Linux tmp/npm/download 주소를 제거하고, Mac downloads는 별도 readonly path와 FD10을 사용한다.
Mac staging lease는 cache 유무와 관계없이 FD9다. 캐시 준비도 실제 선택 Git과 owned temporary를 쓰며,
Node download helper는 같은 private generation capture를 사용한다. 기존 authorize/journal/death owner를 우회하지 않는다.
Mac supervisor protection은 여전히 미완료이고 protectPipelineSupervisor의 거절을 유지한다.
Apple [hardened runtime](https://developer.apple.com/documentation/security/hardened-runtime)와
[debugging entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.debugger)에 따라
시험이 소유한 debuggable/protected C image와 후손의 control/read/inspect·canary read·attach 결과를 비교하는 후보를 추가했다.
모든 probe는 실제 journal scope로 종료·반납한다. 새로운 production entitlement·서명 변경은 없으며 후보 미채택이다.
로컬 문법/NOT_RUN 가지는 통과했고 실제 Mac 양성 대조는 아직 NOT_RUN이다.

SOURCE59 첫 frozen build와 관련20/20, 실제 Linux pipeline5/5는 PASS다.
후자는 cache restore/offline install·private receipt·tracked delta·step timeout/전체 scope death·fresh retry를 포함한다.
이후 quarantine caller 수리는 별도 frozen build/검사를 요구한다. 기존 결과를 새 App bytes의 pack/build 증거로 재사용하지 않는다.


SOURCE58 Mac15 ARM shared ZIP13380700080 SHA-256 `7fcb6818fbf76edd45e1a943bd6254f7eaf6589c345c7c8d6f04c6c181bbcb20`도 대조했다.
401/398 PASS/3 FAIL·cancel/skip/todo0다. 같은 canonical15901/a9a66b2c와
runtime15528/27/`8a462ad2a11318549c68b4f5f779404fef0c47dfd0e4411e3f399c04d4de6e88`가 각각 전후 같다.
위 두 실패 외에 held-directory preparation의 scope cleanup이 RUN_TERMINATION_UNKNOWN으로 실패했다.
얕은 TAP 보조 출력이 native AggregateError leaf를 여전히 생략했다. 다음 입력은 diagnostic inspect depth를 제한하지 않고
배열128/문자열8192 한도로 cause를 보존한다. 원래 event/result·unknown 유지와 journal retire 조건은 바꾸지 않는다.
Mac15의 새 실패와 SOURCE57 Intel의 복구 실패를 원인 확인 없이 같은 결함으로 확정하지 않는다.

SOURCE59 quarantine stderr 수리 뒤 frozen build는 PASS, 관련11/11과 실제 Linux Git9/9도 PASS다.
Git9개에는 실제 verify-before-import·canonical refs 보존·candidate 불일치 거절·quoted Unicode/newline view와
phase 사이 live scope의 staging 보존이 포함된다. 앞선 pipeline5개와 달리 이9개는 최종 App bytes로 실행했다.


SOURCE57 Architecture41944487994도 baseline/native-all 모두 success로 끝났다.
전체 Linux ZIP13380301329 SHA-256 `c4dd26b29a6447bafc879c9f1c2db4b7003b67cbf3a5dbd5437f7c01b4cfd448`는
4857/4857 PASS·fail/cancel/skip/todo0·errors[]다. source15898 per-file identity가 전후 같고 sourceChanges[]다.
baseline ZIP13378744570 SHA-256 `6b0cc9d8a656fe64a8980cb1ceb429d86a85c9cd87254e72def55fc061c720d7`도 대조했다.
provenance의 source18bbdf64401f71c10b0c263f454e4c2b4f8819ac·15898/2005bbd0d112427f204910e20ede2a4077d9f2b7fd050c0cdeef95b803c18b4d가 맞고
inventory/LOC/typecheck/build/storage/package/architecture/spec/test/fast/durable/property/stress/platform exit가 모두0이다.
kernel/crash는 별도 standalone NOT_RUN이며 full native-all 범위와 구분한다. 새 SOURCE59 입력의 runtime PASS로 재사용하지 않는다.

SOURCE59 최종 production inventory14392, review는 CHANGED_WITHOUT_ORACLE30/NOT_REVIEWED14362/REMOVED220이다.
전체 generation의 Mac Git 시험에도 빈 lockfile의 cache helper 재구축→실제 재검증 hit 경로를 추가했다.
original download-cache entry를 throw로 바꾼 동안 같은 private generation의 helper를 실행하고 실제 journal/scope 반납을 요구한다.
빈 download 집합이므로 HTTPS·npm 설치의 Mac 성공을 주장하지 않는다. Mac pipeline의 supervisor 거절도 그대로다.
이 fixture의 문법과 generation Linux refusal3/3은 PASS며 새 Mac 경로는 아직 NOT_RUN이다.


SOURCE59 최종 build 뒤 fresh packed isolation은 @oma/app 포함27/27 PASS다.
첫 architecture 시도는 module guard의 고정 Linux npm require 문자열 때문에 실패했다.
기존 npm-owned cacache 예외를 OS private view의 실제 canonical load call에 결박하도록 고쳤다.
파일에 loader 문자열이 있다는 이유로 다른 require까지 허용하지 않는다. decoder 생략·ambient loader·view 재할당·
다른 callsite/consumer·다른 외부 package는 거절한다. Workspace boundary 전체16/16과 실제 module checker가 PASS다.
production bytes는 이 verifier 수리 중 바뀌지 않았으며, 전체 architecture는 새 verifier로 다시 검사한다.

SOURCE59 구조 gate는0 findings로 통과했다. 마지막 module guard 수리는 shadow loader/decoder도 거절하며
최종 guard 회귀16/16과 실제 checker가 PASS다. 새 verifier 입력의 최종 전체 구조 검사를 수행한다.


SOURCE58의 Mac packed 결과도 회수했다. ARM26 ZIP13379943093 SHA-256
`19f7e39d7b893ce5bbbf5d02a4b386cdee23d66fe6ded6590b6dec24f94421f9`, ARM15 ZIP13379368854 SHA-256
`4a333100402d5af8121db88e7ecc1dfc255c29795c1a80589421308922283c78`를 대조했다.
양 OS 모두 App 포함27/27 packed install·public entry·authored declaration PASS이며 위 source/canonical/runtime identity가 최종 전후도 같다.
shared runtime의 ARM26 두 실패·ARM15 세 실패는 그대로 남으며 pack PASS가 전체 CI 또는 product qualification이 아니다.

SOURCE59 최종 전체 architecture·transaction·durable boundary·document·spec inventory가 모두 exit0으로 끝났다.
source production·verifier를 이 검사 동안 고정했다. 문서 결과 기록 뒤 구조 binding과 document/spec/binding case만 다시 확인한다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·native-support/default launch guard를 유지한다.


### SOURCE59 실제 Actor/Run·private Git 성공과 남은 supervisor 대조

SOURCE59 `29c76d30476c7985b0c7d405ac6008a55f87fd99`, Native41950684422/Architecture41950684469를 발행했다.
Intel26 shared ZIP13381241074 SHA-256 `c72b14086ce356e0eba91f07e3cb590d2a6ee96f6047055b3960d8263e254fd8`,
ARM26 shared ZIP13381635167 SHA-256 `2c5112612b3efccf6a52c37d51aad924b50616935d9745579685f95b32ec41d9`를 대조했다.
양쪽404/403 PASS/1 FAIL·cancel/skip/todo0다. canonical15902/`b0b83441cd79445e710714190ac9635651632da61ab7b6b50d7b5333832be2c1`가 전후 같다.
각 runtime15528/27/Intel `e58bd08b46e36e8ecde980ab32ffbf1da4ab4ea35f5cbe91ef1d4cdbbef413ec`,
ARM `c5a44a12c2ef912f5c34e3df400f403d214a5fe51b9d608c18b0c4a52ee6e2b9`도 전후 같다.

실제 Store/Broker/NativeResidents/Runtime 조합은 양 Mac에서 current Run commit·직접 kernel Actor 승인,
wrong actor/invocation·같은 Host capability를 받은 다른 CID 거절, desired=stopped 뒤 기존 live Actor의 STALE_RUN,
전체 scope death·빈 journal·incarnation 미증가를 모두 통과했다. Intel4352ms다.
이는 controlled protocol driver이며 product entry/Pi·전체 immutable 외부 imports qualification이 아니다.
전체 private generation도 Intel166849ms/ARM190339ms로 원래240초 예산 안에서 PASS다.
private Git candidate 성공/최종 권한 철회·quarantine verify-before-import·accepted cursor/bytes 보존·canonical refs 보존,
빈 lockfile cache helper의 private 재구축/재검증 hit와 마지막 immutable generation 회수까지 실제 통과했다.
private Git 구간은 Intel10113ms/ARM18769ms다. 전체 CLI·실제 npm pipeline 실행 성공으로 확대하지 않는다.
SOURCE57 Intel 복구 실패와 SOURCE58 Mac15 preparation 실패는 원인 미확정 추적을 유지한다.

남은 실패1개는 새 hardened signing matrix의 job helper가 terminal 응답 전에 끝난 것이다.
baseline debuggable case가 조기 종료해 Mach memory 양성 대조와 protected case 결과는 아직 미관측이다.
원래 Node는 양 아키텍처에서 runtime flag와 get-task-allow=true를 함께 갖고 있었다.
hardened bit만 보고 외부 task control/read 차단을 주장할 수 없다. production 서명·guard는 그대로다.
ptrace attach는 target의 tracing/parent-wait 관계를 바꿀 수 있으며 helper는 direct unreaped child terminal을 요구한다.
이것이 이번 종료의 원인이라는 것은 아직 추정이다. 다음 SOURCE60은 같은 C의 Mach-only 가지로 먼저 control/read/inspect를 분리하고,
원래 attach 실험은 그대로 별도 실행한다. scope/terminal 판정을 완화하지 않는다. 실패 전 streamed stdout도 진단으로 보존한다.

SOURCE60에는 own IPv6 multicast socket의 실제 name 유지·독립 name 양성·same name 경쟁·source filter metadata·
shutdown/reconnect·dup/last close를 관측하는 작은 후보도 추가한다. multicast는 node-local/lo0이며 payload packet을 보내지 않는다.
public shutdown-only와 명시적 private SO_RESTRICTIONS 조합을 비교하며 public SDK 기능과 private selector를 혼동하지 않는다.
일반 C header/object compile은 arm64/x64 PASS지만 실제 Mac kernel 결과와 Society lease 채택은 NOT_RUN이다.
probe의 관측 시험 PASS는 후보의 보안 성공이 아니다. 전체 Society identity·권한·fork/exec·owner crash 검증도 남는다.
새 C guard의 첫 cross compile은 SDK include 누락/SDK system-header nullability로 실패했고, 실제 SDK를 system include로 지정한
최종 arm64/x64 object compile은 PASS다. 실제 Mac clang -Wall/-Wextra/-Werror 조건은 유지한다.
SOURCE60은 시험·CI·기록만 바꾸며 production bytes/manifest/dependency/패키지는 SOURCE59와 같다.
따라서 production build/packed27 결과를 새로 실행한 것으로 세지 않는다. 새 Mac 가지와 전체 CI는 별도 검증한다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·native-support/default launch guard를 유지한다.

SOURCE60 로컬 새 시험3/3의 Linux NOT_RUN/refusal 가지와 최종 SDK arm64/x64 C object compile을 통과했다.
전체 architecture·transaction·durable boundary·document·spec inventory도 exit0이다.
새 관측 입력은 실제 Mac 실행 전까지 NOT_RUN이며 production gate를 완료로 바꾸지 않는다.


### SOURCE60 양 Mac 공통405/405와 다음 Node/외부 Git 경계

SOURCE60 `c918ae7dd0b239b7e6f8bba9220022bbfda00ab0`, Native41952271814/Architecture41952271565를 발행했다.
ARM26 shared ZIP13382715328 SHA-256 `3ceb7f52dd748fa848a82d593956cc87b021d43b29f9c92925d9268b0f013931`,
Intel26 shared ZIP13382072760 SHA-256 `ee1b5358558e89db755548bb71c3bfb46524adc5146268275d499b6700059b07`를 대조했다.
양쪽405/405 PASS·fail/cancel/skip/todo0다. canonical15904/`453aff5376b9848e8bc37cec4a95fc72d9e13a17b023a783f46ae869547343a1`가 전후 같다.
runtime15528/27은 SOURCE59의 ARM c5a44a12/Intel e58bd08b와 각각 같고 실행 전후도 같다.
공통 scope/복구·현재 Actor/Run·private Git/Node generation 시험이 통과했지만 세 product gate 완료가 아니다.

Mach-only C 대조는 실제 get-task-allow=true baseline에서 control/read/inspect가 모두0이고8-byte canary read도 성공했다.
PT_DENY_ATTACH가0이어도 같은 Mach read가 성공했다. 이 방식만으로 supervisor 보호를 구현하는 후보는 배제한다.
get-task-allow가 없는 hardened C는 ordinary/guard 모두 control5·read/inspect EPERM1·canary 미관측이었다.
모든 실제 scope와 journal을 반납했다. 이는 해당 C image의 양성/음성 대조이며 현재 Node는 여전히 get-task-allow=true다.
다음 SOURCE61은 실제 선택 Node의 owned copy를 ad-hoc runtime sign하여 그 entitlement만 제외하고,
동일 JIT·native FFI와 자기 direct debugger child의 실제 parent-canary 관측을 비교한다.
source Node hash는 전후 보존하며 product installation·generation의 Node 선택과 guard는 바꾸지 않는다.

IPv6 multicast 후보는 full source filter metadata의 읽기/동일성 및 shutdown 뒤 변경 EINVAL을 보존했다.
그러나 shutdown 뒤 same-name contender bind가 성공했고 disconnectx는 local address도 바꿨다.
private DENY_OUT 조합에서도 동일 namespace 독점이 깨졌다. 두 조합 모두 Society lease로 배제하며 metadata 성공만 채택하지 않는다.
기존 IPv4 ANY/private selector 후보의 전체 identity·생산자·상속 검증도 아직 미완료다.

외부 Git의 현재 Mac recipe는 root FD를 보유하지만 Git operand에는 절대 pathname을 사용한다.
그러므로 성공한 SOURCE59/60 Git 시험은 namespace replacement에 대한 root FD 결박의 완성 증거가 아니다.
다음 작은 시험은 실제 held directory를 CWD로 넘기고 Git setup trace 이후·입력 소비 전에 root 이름을 교체한다.
ordinary/실제 Seatbelt scope에서 상대 repository operand의 효과가 원래 inode에 남고 replacement에 생기지 않아야 한다.
trace는 조율 전용이며 실제 내용·scope death·빈 journal을 따로 확인한다. 해당 controller는 자기 시험 root를 허용하므로
전체 App policy의 alias 방어·복수 root 결박 또는 실제 caller 통합을 대신하지 않는다.
[Apple QA1113](https://developer.apple.com/library/archive/qa/qa2001/qa1113.html)는 /.vol 직접 구성은 debugging/performance 분석 전용이라고 명시한다.
이 deprecated/private 경로를 production 해법으로 채택하지 않으며, 출판 입력에는 그 경로를 쓰는 실행 시험도 넣지 않았다.
openbyid_np의 기존 privilege/entitlement 제약도 그대로다.

SOURCE58의 후속 전체 Linux ZIP13379904101 SHA-256 `784678b0a763a528acf9bf92ea65439d22f3a8a4e94e8f32eeeedc6c980c1011`는
4859/4859 PASS·fail/cancel/skip/todo0·errors[]다. 15901 per-file identity가 전후 같고 sourceChanges[]다.
baseline ZIP13380659360 SHA-256 `127b53d93082cac65f500b0783e18f31322d784f43e064b38d1677860397a814`도 대조했다.
provenance는 같은 SOURCE58/15901/a9a66b2c이고 inventory/LOC/typecheck/build/storage/package/architecture/spec/test/5 lane exit가 모두0이다.
standalone kernel/crash는 NOT_RUN이다. 이를 SOURCE61 새 Mac 시험의 runtime PASS로 재사용하지 않는다.

SOURCE61 C parent-observer refactor는 SDK arm64/x64 object compile PASS, 새 Node/Git 및 기존 C 시험의 Linux 가지4/4도 PASS다.
새 C child는 body PID를 받지 않고 자기 getppid의 고정 canary만 관측하며 ptrace attach는 하지 않는다.
production bytes·공개 API·package는 SOURCE59/60과 같고 새 Mac Node/Git 가지는 NOT_RUN이다.
Society lease·supervisor 생산자 통합·외부 Git root 결박·전체 product Runner/Worker·CLI/reboot/release qualification은 남는다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·native-support/default launch guard를 유지한다.

SOURCE61 전체 architecture·transaction·durable boundary·document·spec inventory는 exit0이다.
이 결과는 구조 검사이며 새 protected Node/Git FD 경로의 Mac 실행은 아직 NOT_RUN이다.

## 검증 입력과 LOC

아래 값은 문서 기록 후 **구조 검사의 입력 identity**다. 전체 runtime 실행의 입력 hash는 위 별도 manifest가 소유하며, 구조 digest를 갱신해 runtime PASS를 만들지 않는다.

verification input digest `3ee982d39caeb5e8dc0d153bffa56e40d3ba3d38f23c8260892badec8b26feba` (15954 files).

소스 목록은 [production-files.txt](../../production-files.txt), per-file hash는 [production-loc-hashes.json](../../production-loc-hashes.json)에 있다. 이전 cloc 2.08 측정은 354 files / 35,832 code LOC였다. 이 역사적 기록은 현재 source의 LOC claim이 아니며 새 측정값으로 사용하지 않는다. 현재 LOC는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`에서 확인한다.


### SOURCE61 실제 protected Node 양성/음성 대조와 SOURCE62 통합

SOURCE61 `40b203cdb6b5e22be2beefbbf1ce161adba43d5d`, Native41978047096의 ARM26 shared ZIP13393240513
SHA-256 `f2f118ab0d80fe682a4d7f00c8ed29eaba159948a4511e6e71fc528a36c7cf21`와 Intel26 shared ZIP13393261091
SHA-256 `16a088f3e16412bbea0f2eb6238bb5eff924face44369bcadf9479f67d03539a`를 대조했다.
양쪽407/406 PASS/1 FAIL, cancel/skip/todo0이다. canonical15906/`51054476befe2a4fdf11fecdaf240e3f83d163737a3a7900e186d187efbddb2e`가 전후 같다.
ARM runtime15528/27/`c5a44a12c2ef912f5c34e3df400f403d214a5fe51b9d608c18b0c4a52ee6e2b9`,
Intel runtime15528/27/`e58bd08b46e36e8ecde980ab32ffbf1da4ab4ea35f5cbe91ef1d4cdbbef413ec`도 전후 같다.

실제 선택 Node의 own copy를 runtime 서명하고 get-task-allow만 제외한 두 아키텍처 모두 JIT sum4999950000·Koffi getpid 호출을 통과했다.
원본 Node의 직접 debugger child는 Mach control/read/inspect0·8-byte canary read=true였고,
보호 copy에서는 control5·read/inspect-1 errno1·memory17·0byte·canary=false였다.
원본 Node hash는 전후 보존했고 모든 scope/journal을 실제 반납했다.
이 시험은 원본 설치 바깥 library import를 사용한 작은 후보이며 전체 immutable generation의 Node 보호 완료로 읽지 않는다.

남은 FAIL은 Git `hash-object`가 GIT_TRACE_SETUP event를 내보내지 않아 입력 gate를 열지 못한 시험 동기화 오류다.
scope는 기존10s deadline에 timed-out으로 끝났으며 kernel FD 결박의 실패/성공으로 분류하지 않는다.
SOURCE62는 setup trace를 실제 내보내는 `unpack-objects`에 미리 만든61-byte pack을 전달한다.
Linux 대조에서는 setup 뒤 rename/replacement를 조율했고 held original에만 blob이 기록됐다.
이 대조는 Mac 결과가 아니며 deadline을 늘리지 않았다.

SOURCE62는 `withProtectedMacNode`에서 선택 Node를 leased owned staging에 FD-copy하고 journaled codesign scope로 서명/검증한다.
완료 후 가진 FD·bytes·SHA-256을 generation producer에 넘겨 복사를 검증한 뒤 기존 immutable seal을 적용한다.
원본 설치와 deploymentDigest를 다시 쓰지 않는다. Broker는 이 producer를 사용하며 signing scope의 실제 종료 전 staging을 정리하지 않는다.
Mac `protectPipelineSupervisor`는 public Security.framework의 self code dynamic validation·runtime flag·현재 valid/undebugged status·get-task-allow 부재를 확인하고 PT_DENY_ATTACH를 적용한다.
원본 debuggable Node는 계속 거절한다. static metadata만으로 성공 처리하거나 이 관측을 Actor role/scope death로 사용하지 않는다.
근거 API는 [Apple SecCode 공개 header](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_codesigning/lib/SecCode.h)와
[CSCommon 공개 flags](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_codesigning/lib/CSCommon.h)다.
새 small Node 시험은 실제 guard와 journaled producer를 함께 부르고, 기존 whole-generation 시험은 같은 protected producer와 Seatbelt 내부 guard를 사용한다.
이 새 생산자/guard/whole-generation의 실제 Mac 관측은 아직 NOT_RUN이다.
Society lease·외부 Git root 결박 생산자·전체 product Runner/Worker·CLI/reboot/release qualification은 남는다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·native-support/default launch guard를 유지한다.

SOURCE62 whole-generation fixture는 실제 CandidateChecks의 pipeline setup→check·tracked delta·Broker-owned receipt까지 추가한다.
이는 기존240s budget 안에서 같은 generation을 재사용하며, Mac에서는 아직 NOT_RUN이다.
small producer fixture는 서명 release 전 권한 철회 후 consumer 미호출·실제 scope death·빈 journal도 확인하도록 했다.
초기 로컬 build를 중첩 실행해 compiler input/output 오류가 발생했다. 중복 소유 프로세스를 중단한 뒤 source를 고정하고
최종 단일 build23/27 recompiled·전체 build exit0를 확인했다(`/tmp/oma-source62-build-repaired.log`).
최종 Linux selected14/14(해당 Darwin 경로는 refusal/NOT_RUN)와 실제 namespace pipeline5/5가 통과했다.
workspace module boundary도0 finding PASS다. 이 결과를 Mac 생산자 통과로 승계하지 않는다.

SOURCE60 뒤늦게 회수한 Mac15 shared ZIP13382404640 SHA-256 `229366c291793e45d1f8a58c321f5849d2eee32fc70b83c6a1b8044e7e9e4f07`도405/405 PASS·기타0이다.
같은 source/canonical15904와 runtime15528/27/`4dd76a32b9bde95192645db028f670d87cd5ef10173482ec7019abbdec81894b`가 shared 전후 같다.
SOURCE58 Mac15의 RUN_TERMINATION_UNKNOWN은 이 입력에서 재현되지 않았으나 원인을 고쳤다는 주장은 하지 않는다.
SOURCE60 full ZIP은 ARM26 13382681388/`d6af021ee85566ba7b49743554bb29e54af7b62cc067a4c12c382402bf0ec360`,
Intel26 13382698236/`9b31dac850e28cf41ec222c2939d3f3bf1457430a26a47ce8aee1537f5fac046`,
ARM15 13382882924/`ea08c0dfa8266651661b4c31f0914ee650ded415ca1686cfcfc19fdff4432316`를 SHA-256 대조했다.
각27/27 packed installation(App 포함) PASS, 각 source/canonical/runtime은 shared 및 최종 전후 모두 같다.
이를 SOURCE62 변경 App/native package의 독립 설치 근거로 재사용하지 않는다.

SOURCE62 첫 architecture 검사는 새 native self-protection leaf의 semantic zone 누락1건으로 실패했다.
현재 process 보호 관측/효과만 맡는 leaf를 K2-mechanisms에 명시하고 graph를 다시 생성했다.

SOURCE62 최종 전체 architecture·transaction·durable boundary·document·spec inventory는 exit0이다.
최종 production14394, review 상태 CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
최종 단일 build 뒤 새27/27 packed installation(App 포함)과 installed runtime·declaration 검사는 exit0다.
로컬 원시는 `/tmp/oma-source62-{build-repaired,package-isolation,architecture-final,selected-final,linux-pipeline,review}.log`에 보존했다.
이 구조/로컬 회귀 결과로 새 Darwin 실행을 PASS 처리하지 않는다. 세 gate OPEN·product BLOCKED를 유지한다.


### SOURCE62 protected Node 생산자 발행과 후속 lease composition 시험

SOURCE62 `2cf32ed50ce35174dfb5df86a2b022b53ef124d6` / local checkpoint `7a2a501fb3fb0cdda1a55dd1656db01aed2ee369`,
Native41980352107·Architecture41980352110을 발행했다. canonical15908/`7c312743714222734a31c6929aafab43020ce7f1ade8ac6daf4647474545202c`다.
발행 직전 local27/27 packed App 포함·전체 구조·문서·spec·binding013이 통과했고, 새 Darwin producer/guard/pipeline/Git FD 경로는 아직 NOT_RUN이다.

추가 회수한 SOURCE61 Mac15 shared ZIP13393108769 SHA-256 `e7dfdf1ae973006ada1b889a8f2a24f13bdc2b4bbaefb6dd67c665e0c00cf174`는
407/406 PASS/1 FAIL·기타0이며 유일한 FAIL은 같은 hash-object trace gate timeout이다.
protected Node의 원본 Mach read 양성·보호 copy 음성과 JIT/FFI는 Mac15에서도 관측됐다.
canonical15906/`51054476befe2a4fdf11fecdaf240e3f83d163737a3a7900e186d187efbddb2e`,
runtime15528/27/`4dd76a32b9bde95192645db028f670d87cd5ef10173482ec7019abbdec81894b`가 각각 shared 전후 같다.

후속 wildcard/filter 후보는 기존 multicast 주소 namespace 후보를 재채택하지 않는다.
IPv6 wildcard bind의 실제 contender 배제와 lo0의 ff01 node-local group에 보관한256-bit source-filter metadata를 따로 관측한다.
초기 specific bind/reuse 조합4가지, freeze 전후 ANY/loopback contender·다른 port 양성, metadata read/mutation, reconnect,
dup-only·last-close를 비교하고 public proc_pidfdinfo의 자기 socket handle/generation도 관측한다.
SO_RESTRICTIONS=0x1081은 기존 고정 XNU의 private selector이며 public SDK API라고 쓰지 않는다.
자기 socket만 사용하고 payload 전송은 없다. 이것만으로 Society identity·producer·fork/exec/crash/reacquisition을 증명하지 않는다.
SDK arm64/x64 object compile과 Linux NOT_RUN 가지는 PASS이며 실제 Mac 관측·production 채택은 NOT_RUN이다.
후속 변경은 SOURCE62 실제 Mac 결과가 보존된 뒤 발행한다. 세 gate OPEN·product BLOCKED를 유지한다.

### SOURCE62 ARM 실제 보호 성공과 pipeline/root 조립의 두 실패

ARM26 shared ZIP13393314775 SHA-256 `c42cfecb898559c6e8af12471dadcadf68f144f43b64bf95d9ba1440dbb1b35c`를 대조했다.
407/405 PASS/2 FAIL·cancel/skip/todo0, source `2cf32ed50ce35174dfb5df86a2b022b53ef124d6`다.
canonical15908/`7c312743714222734a31c6929aafab43020ce7f1ade8ac6daf4647474545202c`,
runtime15532/27/`c602a9940e58df05ef36087c30b080ae12cf07c9b9ca87b63c9a355d144991cc`가 각각 shared 전후 같다.

작은 Node case는 실제 protectPipelineSupervisor의 원본 refusal/protected 성공, JIT/FFI,
원본 Mach8-byte canary 양성/protected control5·read/inspect EPERM·0-byte 음성,
journaled signed-node producer의 held bytes/hash/mode와 서명 전 권한 철회 후 consumer 미호출·빈 journal까지 통과했다.
whole-generation은123730ms에 후속 pipeline launch에서 실패했다. fixture16901ms·source hash8948ms·generation70597ms·initial scope731ms를 관측했다.
새 protected producer와 immutable Seatbelt 내부 guard·초기 private candidate/cache helper는 실행됐지만,
그 뒤 pipeline·권한 철회·quarantine 단계까지 완료한 전체 PASS로 읽지 않는다.

1. raw Git은 setup 뒤 rename/replacement 후 held original에만 blob을 기록하고 scope/journal을 반납했다.
   Seatbelt 가지는 command.cwd가 없어 정책 검증에서 실행 전 거절됐다. 실제 sandboxed root 결박은 NOT_RUN이다.
2. 공통 integrationCheckEnvironment가 pipeline에 Linux NODE_PATH를 넣고 있었다.
   private generation의 clean-loader guard가 이를 거절했다. guard를 완화하지 않고 이 경로를 Linux candidate 어댑터로 옮긴다.
   Linux의 동일 NODE_PATH 값은 보존하며 Mac 두 pipeline plan은 NODE_PATH 부재와 prepareSeatbelt 성공을 구조 시험으로 확인한다.

SOURCE63 Seatbelt composition은 명시 cwd를 writable policy에 검증한 뒤, directoryFd가 있으면 최종 capture에서 cwd pathname을 제거한다.
실제 cwd는 held descriptor 하나만 선택하며 raw Darwin capture의 FD+pathname 이중 입력 거절은 유지한다.
Git 시험의 명시 cwd는 의도적으로 replacement이며 held FD는 original이다. FD가 무시되면 다른 repo에 기록돼 실패해야 한다.
이것은 external Git business owner 전체의 결박 완료가 아니며 실제 새 Mac 실행은 NOT_RUN이다.

SOURCE62 Intel26 shared ZIP13394515629 SHA-256 `718aea5bdf4fe4b7bf4e2b3c255d06ff1a1467ef24618262392b4e086ca03913`도 대조했다.
407/405 PASS/2 FAIL·기타0이며 같은 Seatbelt cwd와 Linux NODE_PATH 거절이다. 작은 보호 guard/producer·원본 Mach 양성/보호 음성과 raw Git original-only 효과는 통과했다.
canonical15908은 위 ARM과 같고 runtime15532/27/`f2dc46bfca298dc6d6e9a7c39ae31470ecdd9b6d16a64842cad28a62794afca0`도 shared 전후 같다.
whole-generation duration250772ms는 cleanup까지 포함하며 PASS가 아니다. fixture17925ms·hash6324ms·signing+generation190921ms·initial scope1193ms였다.
SOURCE63은 기존240s budget을 유지하며 signing preparation과 generation copy/seal의 phase 진단을 나눠 느린 구간을 다음 실제 실행에서 관측한다.
SOURCE63 단일 최종 build PASS, 관련 Linux17/17(Mac 실제 경로는 refusal/NOT_RUN)과 실제 Linux pipeline5/5 PASS다.
이후 production 수정 없이 fresh27-package 검사와 full architecture를 수행한다.

SOURCE62 ARM26 full ZIP13393709605 SHA-256 `ecca1fa6881a331d604de15fa938fde7765cf410999d89124c2758c36eddc2d1`도 대조했다.
27/27 packed installation(App 포함) PASS이며 위 canonical/runtime은 최종 전후에도 같다.
shared407/405/2 실패 결과는 변하지 않는다. SOURCE62 Mac15 공통 실행은 현재 queued/NOT_RUN이며 이 근거를 그 OS의 새 guard 통과로 합성하지 않는다.

SOURCE63 최종 단일 build와 전체 architecture·transaction·durable boundary·document·spec inventory는 exit0다.
source 고정 뒤 새27/27 packed installation(App 포함)·installed runtime·declaration 검사도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220을 유지한다.
로컬 원시는 `/tmp/oma-source63-{build-final,package-isolation,architecture-final,selected,linux-pipeline,review}.log`다.
새 Mac pipeline/root-FD composition·wildcard/filter 관측은 아직 NOT_RUN이며 세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.


### SOURCE63 재발행과 SOURCE61 전체 Linux 회수

SOURCE63 `70fa609a5e777b41ab6113d0c75b583f9d5355c3` / local checkpoint `96ba504e794697f44ab4ddc38ce3ab70156e77e1`,
Native41982432919·Architecture41982432949를 발행했다. canonical15910/`6de5feca6f0ca1479d5d13b27999b19b13d2825895ac3fb50d9828b35872db88`다.
직전 local27/27(App 포함)·전체 구조·문서·spec·binding013은 PASS이고 새 Mac 실행은 진행 중이다.
SOURCE62 Mac15 공통 job은 queued 상태에서 새 source 발행에 의해 cancelled됐으므로 여전히 NOT_RUN이다.

SOURCE61 Architecture41978047040 전체 완료 artifact 두 개를 SHA-256 대조했다.
Native-all ZIP13394272784/`42d59aa34b2253c5136dd099a1c0d59620d60f82e25c7cfe4e69fd63d7ec6cbd`는
4866/4866 PASS·fail/cancel/skip/todo0·errors[]·sourceChanges[]다. sourceHead40b203과
canonical15906/`51054476befe2a4fdf11fecdaf240e3f83d163737a3a7900e186d187efbddb2e`의 전후 동일성을 확인했다.
Baseline ZIP13393524578/`f162ab932e5ccec10ce11bf6dc4a9a7edd14fc88834639ead018fef9d3c5e575`도 같은 provenance이고
inventory·LOC·typecheck·build·storage·package·architecture·spec·test·fast/durable/property/stress/platform의15개 exit가 모두0이다.
각 lane은1203/937/42/16/80개 PASS·기타0이며 standalone kernel/crash는 NOT_RUN이다.
이는 SOURCE61 Linux 근거이며 SOURCE62/63 변경 보호/경로/환경의 전체 runtime PASS로 재사용하지 않는다.


### SOURCE63 양 Mac408/408·실제 보호 pipeline/root FD 성공

ARM26 shared ZIP13395010930 SHA-256 `a50af05209fff74b9c7633a7599b8047878c302c90642bdf6dc44422a5f2e3d7`와
Intel26 shared ZIP13395021457 SHA-256 `7df3e794187fef31530b978c2e8bd7568f2be6ff81c4e62457dc34deb34084b3`를 대조했다.
각408/408 PASS·fail/cancel/skip/todo0이며 sourceHead70fa609와 canonical15910/`6de5feca6f0ca1479d5d13b27999b19b13d2825895ac3fb50d9828b35872db88`가 전후 같다.
ARM runtime15532/27/`061925eb4bb8e2aad0307072d0de2e3558b09d06756566a41ac648a801393f62`,
Intel runtime15532/27/`3904c175fe577711ba4c0905897c609b8bf7b056b71ea3d81a960f5d25e83492`도 전후 같다.

원본 debuggable Node 거절·protected self guard·JIT/FFI·own debugger child Mach 음성, journaled protected-Node producer를 양쪽에서 통과했다.
whole immutable generation은 기존240s budget 안에서 실제 Seatbelt guard와 CandidateChecks pipeline setup→check·tracked delta·private receipt,
mutable 원본 entry 거절·권한 철회·quarantine verify/import·accepted bundle cursor/bytes 보존·현재 canonical ref 보존과 scope/journal 반납까지 완료했다.
ARM의 signing preparation1972ms·generation71864ms·private Git13513ms·collection11042ms,
Intel의 signing3612ms·generation129045ms·private Git12300ms·collection16737ms였다.
실제 지연의 주 구간은 서명보다 generation copy/seal이며 이를 다음 release latency 근거로 보존한다.

raw/Seatbelt 두 Git 모두 다른 declared cwd보다 original directory FD를 사용했다. setup 뒤 original rename·replacement 삽입에도
held original에만 blob을 기록했고 replacement에는 없었다. 각 scope와 journal을 반납했다.
이제 FD-relative Git capability의 실제 조합 근거가 있지만 기존 candidate/quarantine business argv 전체는 아직 absolute project/root 경로를 사용한다.
그 owner까지의 결박 완료로 올리지 않는다.

wildcard/filter의 freeze·256-bit metadata 보존·dup/last-close와 public 자기 socket generation 관측도 양쪽에서 실행됐다.
기존 specific bind(reuse4조합)는 새 wildcard bind를 EADDRINUSE48로 막았지만, 반대 순서에서는
wildcard holder 옆의 loopback-specific contender가 매 phase 성공했다. wildcard contender는4회 모두 거절됐다.
따라서 현재 상태 확인만으로 genuine wildcard producer를 증명하지 못하며 Society lease 채택은 보류한다.
SOURCE64는 독립 specific socket이 같은 metadata를 복사하고 reuse를 끈 뒤 freeze/disconnect로
같은 ANY address/port/state를 만들 수 있는지 비교한다. SDK arm64/x64 object compile은 PASS이며 실제 위조 시도는 아직 NOT_RUN이다.

Mac15 common이 package job 뒤에서 연속 취소돼 새 보호 경로의 최소 OS 근거가 없다.
후속 matrix는 Mac15→Intel26→ARM26→Ubuntu 순서로 요청하며 max-parallel2·job 수·실패/timeout 기준을 유지한다.
SOURCE64는 production bytes를 바꾸지 않는 시험/실행 순서 변경이다.
Society strong lease·외부 Git business root 결박·전체 product Runner/Worker·CLI/reboot/release qualification은 남는다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE64 최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
독립 alias 추가 fixture의 arm64/x64 SDK compile·Linux NOT_RUN 가지도 PASS다.
production·public API·package bytes는 SOURCE63과 같아 build/packed 설치 결과를 새 runtime 관측으로 바꾸지 않는다.
새 alias 실험과 Mac15 보호/pipeline/root-FD 경로의 실제 결과는 아직 NOT_RUN이다.


### SOURCE64 Mac15 실제408/408와SOURCE65 canonical checkout 결박

SOURCE64 `6f30ace077f63719c89cb9f6db3d1447d38271c5` / local checkpoint `bf3af99f33b8ff58ecd33dd3cc22e3ba2544eb97`,
Native41983813879·Architecture41983813748를 발행했다.canonical15910/`a9c639e732b40edf01e2c967cea0511d027f003e1c00c2d92035756dfc430ae9`다.
Mac15 shared ZIP13394673803 SHA-256 `e551c66f7be4ab24c6a74825cf1150be67f0ee9a2b28561e5c1115810abec6c4`를 대조했다.
408/408 PASS·fail/cancel/skip/todo0, 위 source/canonical과 runtime15532/27/`029748bf3f35fd5b472c095dccfd562fe963df225818b3a6f7795c58cf0befb6`가 shared 전후 같다.
보호 Node producer/self guard·JIT/FFI·원본 memory 양성/보호 음성과 whole private generation의 pipeline·receipt·권한 철회·quarantine, raw/Seatbelt directory-FD original-only 효과가 최소 OS에서도 실행됐다.
서명1641ms·generation79904ms·private Git13304ms·collection9805ms이며 기존 budget을 유지했다.

독립 alias는 specific bind·reuse on/off·connect/shutdown/disconnect를 모두 성공해 같은 ANY address/port·state48을 만들었다.
원본 socket generation5364와 alias5384/opaque handle은 서로 달랐다. 그러나 specific bind 상태에서 full identity source-filter 복사는 EINVAL22였고
마지막 read도 EINVAL·sameSources=false였다. 주소/port/state만 검사하는 claim은 불충분하며 이 결과를 완전한 metadata 위조 성공이나 불가능으로 단정하지 않는다.
후속 fixture는 live disconnect로 ANY를 만든 뒤 metadata 복사를 다시 시도하고 reconnect→freeze한다. 이 추가 순서는 Mac NOT_RUN이다.

SOURCE65는 단일 disposable candidate entry가 실제 slot7 canonical FD로 cwd를 선택한다.
Native enterDirectory는 fstat-directory→fchdir 후 같은`.`에서 Node cwd cache를 갱신한다. Broker/동시 host의 cwd는 바꾸지 않는다.
entry는 cwd 선택 직후 자기 inherited FD7 copy를 닫고, shared Git owner에는 trusted local `.` reference만 넘긴다.
wire/model invocation grammar는 바꾸지 않는다. canonical observation과 fetch source는 그 cwd 기준이며
fetch target은 private workspace의 .git이다. -C로 source의 의미를 바꾸지 않는다. Linux mounted source 경로도 같은 shared fetch를 사용한다.
Mac recipe는 setup에 FD7을 명시 전달하며 final check에는 canonical inode가 그 slot으로 남지 않았음을 whole-generation fixture가 확인한다.

별도 child의 초기 cwd cache를 채운 뒤 directory 이름을 교체하고 FD로 진입→local FD close→원래 canary/cwd 확인,
실제 shared candidate의 canonical 이름을 빈 다른 repo로 교체한 뒤 original commit checkout을 각각 Linux에서 통과했다.
host cwd는 전후 보존했다. 관련 local11/11·실제 namespace pipeline5/5도 PASS다. 새 App entry·Mac FD7·업무 경로의 실제 Mac 실행은 아직 NOT_RUN이다.
FD7 close 보완 전 시작했던 package/review 검사는 소유 프로세스를 중단했고 최종 bytes로 다시 실행한다.
SOURCE65는 candidate canonical read/fetch 연결이며 quarantine·accepted canonical write·private workspace 전체 root 결박 완료가 아니다.
Society lease·남은 Git owner·전체 product Runner/Worker·CLI/reboot/release와 세 gate OPEN·product BLOCKED를 유지한다.

SOURCE64 Intel26 shared ZIP13394923604 SHA-256 `d2d5b3d26b554002d1869225c2a02eb358eb93141b29a24927e1e803c57b0c5b`를 대조했다.
408/408 PASS·기타0이며 같은 source/canonical15910과 runtime15532/27/`3904c175fe577711ba4c0905897c609b8bf7b056b71ea3d81a960f5d25e83492`가 전후 같다.
Intel에서는 alias-copy-full-identity와 alias-read-full-identity가 모두0이고 mode1/count4/sameSources=true였다.
reuse on/off·freeze·disconnect도 성공하여 독립 socket이 같은 ANY address/port/state48·전체 metadata를 복제했다.
socket opaque handle과 generation은 달랐다. 따라서 current flags/name/source-filter만 검사하는 inherited claim은 반례가 있어 REJECTED다.
Mac15의 EINVAL 관측을 모든 지원 OS의 위조 방지로 일반화하지 않는다.
진짜 bind를 수행한 producer와 그 instance를 결박하는 별도 근거가 없이는 이 후보를 Society lease로 채택하지 않는다.
후속 ANY-reset 순서 관측도 이 반례를 지우거나 기존 실패를 PASS로 바꾸는 재시도가 아니다.

SOURCE65 FD7 close를 포함한 최종 source 고정 뒤 단일 build·full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
fresh27/27 packed installation(App 포함)·installed runtime·declaration 검사도 exit0다.
관련 local11/11·실제 namespace pipeline5/5·새 두 held-root child 시험은 PASS이며 별도 namespace/Actor/CLI 증거로 승계하지 않는다.
production14394, review CHANGED_WITHOUT_ORACLE30 / NOT_REVIEWED14364 / REMOVED220이다.
원시는 `/tmp/oma-source65-{build-closed-fd,package-isolation-closed-fd,selected-closed-fd,linux-pipeline-closed-fd,root-closed-fd,review-closed-fd,architecture}.log`다.
SOURCE65의 실제 Mac candidate canonical FD 업무 연결과 추가 alias 순서는 NOT_RUN이다. product BLOCKED·세 gate OPEN·기본 실행 guard를 유지한다.


### SOURCE65 실제 candidate 연결·Mac15 정리 실패와 SOURCE66 quarantine 연결

SOURCE65 `3810b2384faf427684128d7cc0cb29e835a92ba6` / local checkpoint `78b80ef79465de99684563504d26fcaac7aeeae0`,
Native41985659622·Architecture41985659569를 발행했다. canonical15912/`103754bcbb2ce00a99529e8ac8a72d644da68acab5870587c795dbcf44ebc4ef`다.
Mac15 shared ZIP13396007656 SHA-256 `9b6d798467ec1a043206fc88746414e97970435c8e47c2c83f7188e3ba92d1d5`,
Intel26 shared ZIP13395664596 SHA-256 `1c67e9ea1290e1b06a9c4b5a48cbecfa2510766dcb3fb472f3b9fde36777f8d6`를 대조했다.
양쪽 input은 위 canonical 전후 동일, runtime은 각각15532/27/`6374c4bc9436c187439823b05ab910643c571e499be1d51ef93a50fb62100152`와
15532/27/`26aaabc425895ead19dac9e6c1abfc78850d739b88db09243dd3f9e6c35cbc3d` 전후 동일이다.

Intel410/410 PASS·기타0이며 실제 App candidate FD7 cwd/close·private check/pipeline·권한 철회·quarantine와 전 scope/journal return을 완료했다.
Mac15는410/409 PASS/1 FAIL·기타0다. dedicated held cwd·shared candidate replacement와 초기 실제 candidate/check·FD7 non-inheritance는 통과했지만,
whole-generation의 후속 protected pipeline에서 RUN_TERMINATION_UNKNOWN(populated scope termination failed)이 발생했다.
duration108442ms·서명1276ms·generation65749ms이며 기존240s deadline을 넓히지 않는다.
원본 nested AggregateError entries가 test-worker Error 직렬화 뒤 보이지 않아 현재 원인은 미확정이다.
이전 SOURCE58 Mac15 unknown과 같은 원인이라고 단정하거나 재실행 성공으로 덮지 않는다.
SOURCE66 fixture는 예외가 발생한 원본 process 안에서 full inspect·현재 journal·마지막 CID·fresh population을 진단하고 원래 예외를 그대로 다시 던진다.
새 진단이 실패해도 primary failure를 대체하지 않는다.

SOURCE65 Mac15의 추가 live ANY-reset 후 source-filter 복사도 EINVAL22였다. Intel SOURCE64의 완전한 독립 metadata 위조 반례는 그대로 유효하며 plain frozen-state claim은 REJECTED다.

SOURCE66은 trusted quarantine entry에 실제 canonical FD9을 전달하고 단일 setup cwd로 진입한 뒤 자기 descriptor copy를 닫는다.
verify의 canonical read와 import의 canonical write는 trusted local`.` reference를 사용하며 wire/model grammar는 그대로다.
private verifier는 pathname alternates 대신 검증된 prerequisite OID graph를 private repo에 fetch한다.
canonical 이름을 reopen하는 alternates를 제거했으며 OID별 호출로 새 argv-size quota를 만들지 않는다.
기존 full fsck가 alternates canonical DB도 검사하던 보장을 유지하기 위해 bundle/ref/type 검증 뒤 canonical fsck와 private fsck를 각각 수행한다.
private repo의 자기 prerequisite copies는 accepted state가 아니며 기존 lease·verify→complete-scope-death→현재 권한→import 순서와 actual CID/journal owner를 유지한다.

Linux에서 canonical 이름을 빈 repo로 교체한 뒤 verify의 canonical 무변경·import의 held original-only object promotion·canonical refs/accepted bytes/host cwd 보존을 통과했다.
별도 unrelated canonical object corruption도 REF_STATE_UNKNOWN으로 거절했다.
첫 fault fixture는 Git의0444 object를 수정하려다 EACCES로 실패했고, 자기 테스트 object만 chmod한 뒤 실제 corruption을 주입하도록 고쳤다.
초기 실패 원시를 `/tmp/oma-source66-selected.log`에 보존했고 늦은 cleanup hook도 setup 직후 등록하도록 고쳤다.
최종 관련10/10 및 실제 namespace Git9+pipeline5=14/14가 PASS다.
새 Mac quarantine FD9/graph copy와 cleanup 원인 진단의 실제 결과는 아직 NOT_RUN이며 private workspace/root 전체 결박은 미완료다.
Society lease·남은 Git root·전체 Runner/Worker·CLI/reboot/release와 세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE66 첫 durable-boundaries 검사는 제거한 alternates publication의 오래된 owner 등록1건으로 실패했다.
더 이상 해당 publication이 없는 worker owner를 제거하고 기존 logical import oracle을 실제 QuarantineImporter.runBundle 경계로 옮겨 보존했다.
테스트·허용 실패·살아 있는 accepted import 경계는 제거하지 않았다. 최종 strongest boundary는 sigkill80 / in-process-fault31 / logical21이며0 findings다.
SOURCE66 최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
source 고정 뒤 단일 build·fresh27/27 packed installation(App 포함)·installed runtime·declaration 검사도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
원시는 `/tmp/oma-source66-{build,selected-final,linux-git-pipeline,package-isolation,architecture-final,review,boundaries-final}.log`다.
새 Mac quarantine FD9·private prerequisite graph와 Mac15 cleanup 원인 진단은 아직 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.


### SOURCE66 양 OS412/412와 동기 directory capability 후속

SOURCE66 `15c565f47023985b72692281729beb592c373661` / local checkpoint `814f2cfbe79b3333f33b6656c8330714ee156da4`,
Native41987923514·Architecture41987923567를 발행했다. canonical15913/`8d4766ae990f67ebbb7c0ad08c9e152114c618423fcb0a8c154a78c330411593`다.
Mac15 shared ZIP13396649241 SHA-256 `8bcb1be0bbb74a359ed32ec956b1cb0a28a5ba2114d102a3c49849539838b979`,
Intel26 shared ZIP13397348043 SHA-256 `ef9acc8eb8334c229b250130f49997d7f772b9a0b43028caa2997755719fc93c`를 대조했다.
각412/412 PASS·fail/cancel/skip/todo0이며 같은 source/canonical이 전후 같다.
Mac15 runtime15532/27/`8ad822328fe9f3458d57fc0610d0dfbc866aba7aab0af4bafe8d74e1c47a54cf`,
Intel runtime15532/27/`d249f8e154979730b91bfce3c729a48a8038fc30fe40b0171a27d0f075e23334`도 전후 같다.

실제 protected private generation에서 candidate FD7과 quarantine FD9 canonical cwd/close,
private prerequisite graph fetch·verify/import·accepted bytes/cursor·refs 보존과 scope/journal return을 완료했다.
standalone shared quarantine의 이름 교체 후 original-only import와 unrelated canonical corruption 거절도 실행됐다.
현재 terminal 진단에서 exact check와 protected pipeline은 exit0, 별도 권한 철회는 aborted이고 각각 owner가 scope를 반납했다.
Mac15 private Git22399ms, Intel14842ms를 관측했다. Mac15 SOURCE65 populated-scope failure는 이번에 재현되지 않았으며,
서로 다른 source의 성공으로 기존 실패를 고쳤다고 하지 않는다. 해당 unknown은 원인 미확정으로 보존한다.

SOURCE67은 동기 bounded process에 caller-owned directory control을 추가한다. cwd pathname·custom FD slots와 함께 선택하면 거절한다.
Linux는 동기 호출 동안 살아 있는 parent proc-fd directory를 child cwd에 사용한다.
Darwin은 기존 설치된 tiny native launcher의 명시 directory-fd3 mode에서 fstat-directory→fchdir→close3→exec를 수행한다.
명시 협조 fence4만 유지하며 다른 descriptor는 기존 실제 fd-table pruning으로 반납한다.
이 mode는 profile을 새로 적용하지 않는 physical exec primitive이며 부모의 Seatbelt를 제거하거나 권한을 부여하지 않는다.
기존 profile mode의 framing/validation/deny-default는 그대로다. Native C에는 Git/CAS/업무 payload 해석을 넣지 않는다.
Host cwd는 바꾸지 않으며 이 direct-child observation을 전체 scope death·role·exact executable qualification으로 사용하지 않는다.

SDK arm64/x64 object compile PASS, Linux 실제 경로 교체 뒤 original root 선택·Host cwd 보존·명시 socket 전달2 case와 기존 process I/O5 case가 PASS다.
새 Darwin mode와 inherited Seatbelt denial의 실제 결과는 NOT_RUN이다. 동기 Host canonical/CAS caller 연결도 아직 남아 있다.
Society strong lease·남은 Git/private root/SQLite writer·전체 Runner/Worker·CLI/reboot/release와 G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED를 유지한다.

SOURCE67 source 고정 뒤 단일 build·fresh27/27 packed installation(App 포함)·installed runtime·declaration 검사는 exit0다.
최종 full architecture·transaction·durable boundary·document·spec inventory도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
원시는 `/tmp/oma-source67-{build,package-isolation,process-io,architecture}.log`다.
이 구조 검증을 실제 Mac directory mode 실행이나 아직 연결하지 않은 Host canonical/CAS 보장으로 승격하지 않는다.

### SOURCE68 Host canonical Git directory 연결

trusted composition의 CanonicalExecution은 선택한 Git executable과 caller-owned repository directory map만 담는다.
wire/model grammar에는 FD를 추가하지 않는다. adapter가 작성한 고정 `--git-dir` operand만 local`.`로 바꾸고
동기 directory control로 실행하며, 요청 argument 전체를 검색·변환하거나 Host cwd를 바꾸지 않는다.
GitRepository의 canonical 관측·CAS·published refs/provenance traversal·no-op witness·revert plumbing에 같은 control을 전달한다.
Mac broker는 기존 owned developer-tools observation의 실제 Git을 선택하고 project directory를 연다.
directory는 native retirement와 logical drain을 모두 마친 lifetime.shutdown 성공 뒤 반납하며,
unknown shutdown의 실패 경로에서는 process 종료 전 먼저 반납하지 않는다.
Linux 기본 composition은 기존 경로를 유지한다.

이 연결은 project canonical commands에 한정된다. context의 준비/초기화·review artifact·비동기 integration preparation·
private workspace·SQLite 및 다른 외부 writer의 root 결박은 아직 미완료다.
full product gate나 whole-scope death proof로 승격하지 않는다.
SHA1/SHA256 actual Git 시험은 열린 원본을 rename하고 같은 이름에 빈 repo를 놓은 뒤 shared GitRepository 관측·CAS와
고정 adapter의 published refs·no-op·graph/range·revert가 원본에만 적용됨을 통과했다.
초기 fixture는 기존 CAS 반환의 oid field를 예상값에서 빠뜨려 실패했으며 production 판정을 바꾸지 않고 fixture를 수정했다.
초기 원시는 `/tmp/oma-source68-canonical.log`, 최종 관련 원시는 `/tmp/oma-source68-canonical-final.log`다.
Mac에서 이 Host canonical 연결의 실제 실행은 NOT_RUN이다. 세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE67 `b95a0bb29525c70de6ffad597d9846ec10aa6241` / local checkpoint `d738766e35bb8ffb4f3bdcede24bc8fbc924cd9f`,
Native41991320854·Architecture41991320813를 발행했다.
canonical15914/`c907d33abb69dcb0ecc7b3198e86010aa5d338c5b69b2cb5ff265726f020ea9e`다.
해당 source의 새 동기 directory mode 실제 Mac 결과는 아직 NOT_RUN이다.

추가 수신한 SOURCE66 ARM26 shared ZIP13398400660 SHA-256 `460efeb90390857c288beef701dea5d014a59416aa87a945cf8f557babbb6ed6`도
같은 canonical15913과 runtime15532/27/`75f9ae8911e268696b4d52da232f0ec6dc18a5d8b43a4ab8d40b3c298e7daf2d` 전후 동일,
412/412 PASS·기타0이다. SOURCE66의 세 Mac full artifact도 각각27/27 packed installation(App installed runtime 포함)과
최종 input/runtime 전후 동일을 확인했다. SHA-256 대조한 full ZIP은
ARM26 13398591043/`8d2863be68730cc669269bf21189d02a0abd387a220edcc60c6938481aa919be`,
Intel26 13397404923/`5f51f836a3295da7ebf9ad2e7384c482f5bd302d334c3f7cb96024842f5795bb`,
Mac15 13397219796/`309aa9633f0c6f93ddcd3acd0f71c93f601e2951680fe4b184e651c6b4f3a81e`다.
SOURCE66 결과를 SOURCE67/68 구현의 실제 실행 근거로 승계하지 않는다.

SOURCE67 Mac15 shared ZIP13398043900 SHA-256 `4a06dc3d19dde0135c11389e46b86a01352e57c474cd521862c22c1aaec302f3`를 대조했다.
같은 canonical15914와 runtime15532/27/`f3b6d8d03e1791f965ec23077c8c5b3295cdec3e607df15d9d2cebc2ac7b9671` 전후 동일,
415/415 PASS·fail/cancel/skip/todo0이다. 새 실제 directory-fd3의 이름 교체·명시 socket 전달·inherited Seatbelt denial3 case도 통과했다.
기존 protected pipeline·quarantine도 이번 source에서 통과했으며 SOURCE65 cleanup unknown을 고쳤다는 근거로 쓰지 않는다.
SOURCE68 local 관련 canonical/observation 검사는14/14, 실제 namespace tiered integration·publication·기존 review 회귀는33/33 PASS다.
Mac에서 SOURCE68 Host canonical 연결 실행은 여전히 NOT_RUN이다.

SOURCE68 최종 source 고정 뒤 단일 build·fresh27/27 packed installation(App 포함)·installed runtime·declaration 검사는 exit0다.
full architecture·transaction·durable boundary·document·spec inventory도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
원시는 `/tmp/oma-source68-{build,canonical-final,linux-regression,package-isolation,review,architecture}.log`다.
최종 구조 검증을 아직 미실행인 SOURCE68 Mac consumer qualification로 쓰지 않는다.

### SOURCE67 Intel cold-generation timeout와 SOURCE69 creator-instance 후보

SOURCE67 Intel shared ZIP13398368753 SHA-256 `1ac46f64c8e296b28d13cdc005054c49ffcd9f48065d581b6f909dc82ed53ec6`를 대조했다.
canonical15914/`c907d33abb69dcb0ecc7b3198e86010aa5d338c5b69b2cb5ff265726f020ea9e`와
runtime15532/27/`d6e90bace4e3d6bfc5393dd407b79087150c96c3c41a6ee5176795845df9f51e` 전후 동일이다.
415 tests /414 PASS /1 cancelled /fail0·skip0·todo0이다. 새 directory mode3건은 모두 PASS다.
whole-generation은 기존240000ms test deadline 초과로 cancelled(duration273289ms)이며 PASS로 바꾸지 않는다.
fixture installation30301ms·source digest8027ms·protected Node7147ms 뒤 generation 완료 phase에 도달하지 못했다.
cleanup을 포함한 wall time과 timeout을 구분하고 budget을 넓히거나 다른 source 성공으로 이 관측을 덮지 않는다.
이는 SOURCE65 populated-scope cleanup unknown과 별개로 기록하며 원인 동일성을 추정하지 않는다.

SOURCE68 `2c4c65afc1a9d282e21f20e910a9d46ea58e0692` / local checkpoint `fe4871d84c145b1c0f46ce05c7126fabc6dabd84`,
Native41993196099·Architecture41993195956를 발행했다.
canonical15915/`978a35c1a24332290616c747c29f2bf3e85086476db811358e6bc5e5ebecb7fa`다.
해당 Host canonical consumer의 Mac 결과는 아직 NOT_RUN이다.

SOURCE69는 production 변경 없이 고정 C producer/instance 후보를 추가한다.
helper는 새 no-reuse IPv6 wildcard bind만 수행하고 기존 socket FD를 adoption하는 mode나 임의 exec mode를 제공하지 않는다.
full256 identity와 자기 socket opaque handle/generation을 Mach kernel-audited publication으로 전달한다.
test는 hardened/no-debugging/no-loader-exception으로 서명한 해당 고정 image의 CDHash를 실제 audit-origin과 대조한다.
socket은 fileport로 이전한 뒤 producer 자신의 FD와 fileport SEND reference를 반납한다.
고정 producer가 살아 있는 동안 duplicate/last-close·동일 frozen namespace의 독립 alias instance·다른 image의 body replay를 대조한다.
이 시험은 authenticated creator와 현재 socket instance를 결박할 수 있는지 묻는 primitive 후보다.
keeper namespace discovery/replacement·Host crash 후 claim·Society full identity의 장기 발견·port collision·endpoint 소실·강한 FD4 상속 계약은 미구현이며,
Linux Society lease를 바꾸거나 Mac backend로 채택하지 않는다. 앞선 plain frozen-state 위조 반례도 그대로 유효하다.

양 architecture SDK object compile PASS, JS syntax/Linux NOT_RUN 경로는 PASS다.
실제 Mach publication·cross-process opaque/generation 비교·alias/replay 거절·producer-live last-close는 아직 NOT_RUN이다.
원시는 `/tmp/oma-source69-producer-{arm,intel}.log`와 `/tmp/oma-source69-producer-linux.log`다.
production은 SOURCE68과 동일하므로 build·packed installation을 새로운 source의 실행 근거로 합성하지 않는다.
G-PROCESS/G-FILES/G-AUTH OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE69 full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
고정 publication C layout은88 bytes로 SDK compile-time 검증하며 생존 상태는 실제 audit-token과 일치하는 kernel process pin으로
last-close 대조 전후에 확인한다. producer exit와 동기화해 last-close를 성공시킨 것으로 간주하지 않는다.
새 실제 Mac candidate 결과는 여전히 NOT_RUN이다. 구조 검증 원시는 `/tmp/oma-source69-architecture.log`다.

### SOURCE68 Mac15 canonical revert 실패와 SOURCE70 공통 Git 호환 수정

SOURCE68 Mac15 shared ZIP13399780576 SHA-256 `a2b4f787130d07d4691d6d4b0358f3f8b23eca16191557c8bf0165e222c7ead8`를 대조했다.
canonical15915/`978a35c1a24332290616c747c29f2bf3e85086476db811358e6bc5e5ebecb7fa`와
runtime15532/27/`1ccd272f6d89738291fac367873ccf7c2c0bcb4f9078593c5e148c74416c7bdc` 전후 동일이다.
417/415 PASS/2 FAIL·기타0이다. 두 SHA format의 actual Host canonical 관측·CAS·no-op·graph·range는 통과한 뒤
기존 canonicalRevertCommit merge-tree가 exit129/REF_STATE_UNKNOWN으로 실패했다. whole protected generation/pipeline은 PASS다.
기존 원시가 merge-tree stderr를 노출하지 않아 정확한 rejected option은 아직 확정하지 않는다.
[Git2.39 command grammar](https://git-scm.com/docs/git-merge-tree/2.39.0)에는 explicit `--merge-base`가 없고
[2.43 grammar](https://git-scm.com/docs/git-merge-tree/2.43.0)에는 존재하는 차이를 확인했다.
기본 Git의 이 옵션 지원 차이는 실패 원인 후보이며 새 actual Mac 결과로 확인한다.

SOURCE70은 explicit option 대신 current/base 두 tree를 같은 recorded applied candidate의 단일 자식 commit으로 만들어 병합한다.
따라서 고정 merge base를 선택하며 temporary ref·worktree·canonical main 변경은 만들지 않는다.
합성 commit의 identity/date는 고정이고, 최종 revert commit의 단일 parent는 실제 main이며 기존 message/author 계약을 유지한다.
원래 merge-tree tree/conflict parsing·bounded stdout spool·no-op 거절과 held canonical execution을 유지한다.
Git version branch·실패 뒤 다른 의미의 재시도·새 Git 설치·check skip은 추가하지 않는다.

source 고정 뒤 단일 build와 local canonical/observation20/20 PASS다.
추가 SHA1/SHA256 시나리오는 다른 파일의 후속 작업 보존·같은 파일 충돌 거절·이미 되돌린 main 거절과 canonical refs 무변경을 확인한다.
Mac compatibility 수정의 실제 결과는 NOT_RUN이다. SDK producer candidate는 여전히 미채택이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지하며 SOURCE67 Intel timeout와 SOURCE65 Mac15 cleanup unknown도 미해결로 보존한다.

추가 실제 Linux namespace merge/review·tiered integration·publication47/47도 PASS다.
공식 Git2.39.5 source tar SHA-256 `c58da92c378df4a986ca33266897a7397e86c22ee266a284d8c2432c39066b59`를
별도 `/tmp/oma-source70-git239/`에 빌드해 기존 executable/install을 바꾸지 않고 fixture namespace에만 매핑했다.
그 실제 구버전은 기존 `--merge-base` syntax를 unknown option/exit129로 거절하고, 수정한 actual canonical8/8을 통과했다.
이는 Mac15의 정확한 Git version/option 거절을 직접 관측한 것으로 승격하지 않는다. 새 fixture가 actual Git version도 기록한다.
원시는 `/tmp/oma-source70-{canonical,linux-regression,git239-build,git239-old-syntax,git239-canonical}.log`다.
producer fixture는 publication 전 terminal result를 진단하고 받은 fileport를 검증 실패 경로에서도 반납하도록 정리했다.

SOURCE68 Intel shared ZIP13399148871 SHA-256 `4ced377c28b43c50c51a8960eb95eb620f33c8aee455e9480bcd1dd0a8bab0a0`도 대조했다.
같은 canonical15915와 runtime15532/27/`6a5fa21cc20553dd19d76fd7063630b2a118d82d3ade5a0649bff072fb6871b5` 전후 동일,
417 tests /416 PASS /1 cancelled·fail0·skip0·todo0이다. Host canonical 두 format는 이 환경에서 모두 PASS다.
whole-generation은 다시 기존240000ms 초과(duration266668ms)이며 installation28988ms·source5681ms·protected Node5604ms 뒤
generation 완료 phase에 이르지 못했다. 앞선 SOURCE67 timeout을 재실행으로 PASS 처리하지 않는다.

SOURCE70 workflow는 whole-generation fixture를 나머지 test process가 반환한 뒤 정확히 한 번 실행하도록 분리한다.
동일 test3건·240s deadline·25분 job 상한·matrix max-parallel2·production 동작은 유지한다.
다른 fixture I/O와의 경합은 아직 원인 후보이며, 격리 실행의 성공으로 기존 병렬 환경 실패를 고쳤다고 하지 않는다.
main tests.log와 generation-tests.log를 각각 evaluateExecution하며 generation3개의 정확한 이름을 모두 요구한다.
어느 쪽 실패도 common-runtime 실패로 유지하고 두 원시 log·각 totals와 최종 source/runtime bytes binding을 보존한다.
기존 Mac oracle도 그대로 요구한다. Linux의 동일3개 refusal/NOT_RUN 경로와 oracle evaluator는 PASS이며 실제 Mac 격리 결과는 NOT_RUN이다.

SOURCE70 최종 단일 build·fresh27/27 packed installation(App 포함)·installed runtime·declaration 검사는 exit0다.
최종 full architecture·transaction·durable boundary·document·spec inventory도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
workflow YAML·모든 bash run block과 실제 oracle script의 success/success·failure/success·success/failure 대조를 확인했다.
각 step의 실제 outcome을 evaluator exitCode에 전달하며 어느 실행 단계의 실패도 성공 TAP로 덮지 않는다.
첫 rehearsal은 TAP가 아닌 local spec reporter log를 주어 evaluator가 올바르게 거절했다.
같은 실제 검사를 production TAP reporter로 출력한 뒤 대조를 마쳤고 최초 오류는 `/tmp/oma-source70-workflow-first-evaluation.log`에 보존했다.
최종 구조 원시는 `/tmp/oma-source70-architecture-final.log`, oracle 원시는 `/tmp/oma-source70-workflow-check/`다.
새 실제 Mac compatibility/creator-instance/isolated-generation 결과는 여전히 NOT_RUN이다.

### SOURCE70 발행과 SOURCE71 result directory 수명

SOURCE70 `67dae60fea3bcd4d752417a0dd0c4d430f7089f3` / local checkpoint `c7f20d093ba5f8e7c6edda7ecb5bcb69d14e46f5`,
Native41995942396·Architecture41995942217를 발행했다. canonical15917/`4c5a23aa2962bd10b9c301d0cb9f2acff0e4308f80dc9431cf30388b39070ec1`다.
SOURCE69 test-only checkpoint `6cba878a1298ca81f1ffd6a84f6a5f1f6940359c`와 같은 tree의 remote parent
`67ce0442aea1a7fbcd29bae6c4ceba5858bbfa42`를 보존해 함께 발행했다. SOURCE69만 별도 CI 실행한 것으로 합산하지 않는다.
새 actual Mac 결과는 아직 NOT_RUN이다.

SOURCE71은 result writer의 directory descriptor를 최초 open부터 finish/close까지 소유한다.
마지막 parent flush를 위해 문자열 root를 다시 열지 않으며, 실제 file과 held parent를 flush한 뒤 두 descriptor를 모두 반납한다.
file/root가 제거된 상태는 성공 reference로 바꾸지 않는다. close 실패도 cached failure로 보존하며 같은 숫자 FD를 다시 close하지 않는다.
trusted caller는 createResult/readResult의 별도 ResultDirectoryControl로 이미 열린 root를 전달할 수 있다.
writer는 자기 directory cursor를 따로 소유하고 caller의 descriptor는 닫지 않는다. model path/reference grammar에는 FD를 넣지 않는다.
이 port는 아직 ReviewArtifacts/context/private workspace 전체 consumer로 연결하지 않았으며 전체 G-FILES 보장이 아니다.

source 고정 뒤 단일 production build는10/27 recompile과 root build를 마쳤다.
초기 edit script가 쓰기 전에 실패해 실행된 unchanged build는 `/tmp/oma-source71-pre-edit-build.log`로 구분했다.
실제 수정 build는 `/tmp/oma-source71-build.log`다. 새4건과 기존 file I/O28건은32/32 PASS다.
실제 rename 후 parent 이름이 없는 finish·이름 교체 후 original-only writer/read·bad FD의 pathname fallback 거절·
file/parent unlink 뒤 publication 거절을 관측했다. Host cwd와 borrowed root는 보존했다.
원시는 `/tmp/oma-source71-results.log`다. 새 port의 Mac 실행과 business consumer 전체 연결은 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

추가 기존 result snapshot/range/race 검사를 포함한11/11도 PASS다(`/tmp/oma-source71-result-regression.log`).
SOURCE70 Mac15 shared ZIP13400129339 SHA-256 `c136471ce5efaa566b1475636cf519324d90da359fbcda707683fe80bc189a31`를 대조했다.
위 canonical15917과 runtime15532/27/`b53632285e44f738409ea25b234b53f9023979eca87578514a8c0123162d294f` 전후 동일이다.
분리한 main421/420 PASS/1 FAIL·기타0, generation3/3 PASS·기타0이다. 실제 shared FAIL/generation PASS 판정도 보존됐다.
actual Git은2.39.5 Apple Git-154이며 canonical root/CAS 두 format와 추가 revert6건 모두 통과했다.
generation은108223ms, construction55603ms·private Git14193ms로 기존240s 안에 끝났다.
이 격리 환경 성공을 SOURCE67/68의 병렬 환경 timeout에 대한 production 성능 수정으로 승격하지 않는다.

유일한 main 실패는 새 producer의 빈 entitlements 입력이 plist wrapper 없이 작성돼 codesign이 invalid blob length로 거절한 fixture 오류다.
C compile은 성공했지만 producer execution·Mach provenance·socket/last-close 후보는 아직 NOT_RUN이다.
SOURCE71 fixture는 별도 entitlement 입력 없이 기존 protected C 대조와 같은 `codesign --options runtime` 서명을 사용한다.
디버깅·loader 예외를 추가하지 않으며 고정 signed image CDHash/audit-origin requirement도 유지한다.
이 수정의 실제 Mac 결과는 NOT_RUN이다. 최초 실패를 PASS로 덮지 않는다.

SOURCE70 Intel shared ZIP13400781590 SHA-256 `2726ff00871b899ce3da5d9decb3fede45f74e89f36a2a0da1956d517307fde8`도 대조했다.
같은 canonical15917과 runtime15532/27/`43ad611ee0ec7b2afaea4e26c6fa4eb73bd0d3a427451bfa8e18793c46f6326e` 전후 동일이다.
main421/420 PASS/1 FAIL·기타0이며 동일한 malformed empty-entitlements 서명 실패다. actual Git2.50.1 Apple Git-155에서 canonical8건도 PASS다.
generation3/2 PASS/1 FAIL·기타0이다. construction136245ms·initial private scope947ms를 완료했지만
후속 verifyDarwinGitRuntime의 effect/cleanup이 모두 RUN_TERMINATION_UNKNOWN 계열로 실패(duration184910ms)했다.
240s timeout과는 다른 실패이며 생성 성공이나 다른 OS의 성공으로 scope death를 대체하지 않는다.
현재 cause가 원본 process의 기존 pipeline catch보다 이른 discovery/cache 단계에서 발생해 깊은 leaf는 아직 확인되지 않았다.
SOURCE71 fixture는 전체 effect/cleanup catch에서 원본 nested errors와 journal 전체의 fresh CID population을 진단하고 같은 예외를 다시 던진다.
진단 오류는 primary failure를 대체하지 않으며 capability release·signal·death predicate·deadline을 바꾸지 않는다.
SOURCE65 Mac15 unknown과 같은 원인이라고 단정하지 않는다. SOURCE71 diagnostic syntax와 Linux refusal3건은 PASS이며 새 실제 Mac 결과는 NOT_RUN이다.

SOURCE71 최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
source 고정 뒤 단일 production build·fresh27/27 packed installation(App 포함)·installed runtime·declaration 검사도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
구조 원시는 `/tmp/oma-source71-{build,package-isolation,review,architecture}.log`다.
새 result directory port·producer signing·expanded owned-failure 진단의 실제 Mac 결과는 여전히 NOT_RUN이며 세 gate OPEN·product BLOCKED를 유지한다.

### SOURCE72 review diff의 held-root 업무 연결과 test forwarding 수리

ReviewArtifacts는 기존 CanonicalExecution의 project directory를 기준으로 oma-results를 열고,
SDK result writer·preaccept owner·async trusted Git diff에 같은 root capability를 전달한다.
preaccept owner는 자기 directory cursor를 소유하며 수락 또는 확인된 폐기 때 file pin과 함께 반납한다.
이미 발생한 descriptor-return 실패는 이후 호출에서도 보존하며 재사용된 숫자 FD를 다시 닫지 않는다.
GitRepository의 diff 검증·checked patch bytes·changed-path record도 같은 project capability에서 읽는다.
bindCanonicalCommand는 기존 고정 Git operand 선택을 공유할 뿐 argv 전체를 검색하거나 Model FD를 받지 않는다.
legacy string-only/default Linux composition·result reference/accepted byte/cleanup disposition grammar는 유지한다.
큰 patch를 반복 page hash로 읽지 않고 기존 immutable bounded-chunk byte 검증을 재사용한다.

실제 rename-before-prepare와 등록 직후 rename-during-prepare에서 original-only diff 생성/수락 후 읽기,
unaccepted 원본만 폐기·replacement 동명 bytes 보존·registration 거절의 원본 정리를 확인했다.
canonical refs와 Host cwd는 보존됐다. 새4건과 기존 canonical8건을 관측했고 최종4건 원시는 `/tmp/oma-source72-review-final.log`다.
review source-record·비동기 integration merge·context/private workspace/SQLite와 전체 G-FILES는 아직 미완료다.

첫66건 Linux regression은 모두 PASS를 출력했지만 오래된 preaccept-ownership014 mock이 PreparationExecutor의
새 sinks/directory controls를 전달하지 않아 context의 `git -C . read-tree --empty`와 update-index가 실제 checkout index를 수정했다.
HEAD/ref와 작업 파일은 바뀌지 않았고 임시 GOAL.md index entry만 남았다. 이 실행을 올바른 held-context 검증으로 쓰지 않는다.
변경 전 index·HEAD/ref/log·config·원시 status를 `/tmp/oma-source72-index-observation-1793869797312427201/`에 보존했다.
동일 HEAD 및 관측한 index bytes를 비교한 뒤 별도 read-tree index를 O_EXCL lock/atomic replace로 복구했다.
reset/clean·working-tree checkout·fixture object prune를 하지 않았고 기존 변경과 untracked review 시험을 보존했다.
해당 test mock은5개 인자를 모두 전달하도록 고쳤고 최종 regression은 checkout `.git`을 read-only bind해 같은 사고를 차단한다.
initial 원시는 `/tmp/oma-source72-linux-regression.log`이며 수정 후 새 원시를 별도로 기록한다.

SOURCE71 Mac15 shared ZIP13402010221 SHA-256 `52e321db34b5f5858013a3a706c0526e240cf7544717ee682ef2023f53ca7e74`,
Intel shared ZIP13401702292 SHA-256 `7b0a8e81c3c6daf79a365ae79440a6f9514ebd1075ba96afb78a43b73b17e716`를 대조했다.
각 canonical15918/`a276281b26cb095fac63eaa0aaf5e6422e1fb1105b79f4799a6b35885719d08b` 전후 동일이며,
runtime15532/27은 각각 `36b78335048b02c6aa909928fc936e00cebc8c636d1126f42b6e11d26d747199`와
`16232172c1ebf3605a7213879bbcdf3ff825d335ef725f17d445b1b5f649315a` 전후 동일이다.
양쪽 main425/424 PASS/1 FAIL·기타0, isolated generation3/3 PASS·기타0이다.
새 result directory4건과 canonical8건은 실제 양 Mac 모두 PASS다. 기존 cleanup unknown을 이 성공으로 수정했다고 하지 않는다.
producer는 이제 실행됐으나 expected audit-origin이 unavailable로 거절됐다. 이를 matched나 lease-held로 바꾸지 않는다.
SOURCE72 test는 전체 OSStatus·expected hashes·kernel sender·unconstrained origin(진단 전용)·fresh producer 상태를 기록한다.
채택 predicate는 expected CDHash matched 그대로다. opaque/generation·alias·last-close 결과는 아직 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

수정된 mock을 새 dist로 빌드한 뒤 readonly `.git` namespace에서 동일 regression66/66 PASS를 확인했다.
실행 뒤 checkout index는 HEAD와 동일하며 staged 변화가 없다. 원시는 `/tmp/oma-source72-linux-regression-readonly-git.log`와
빈 `/tmp/oma-source72-checkout-index.patch`다. 초기 잘못된 실행과 최종 실행을 합산하지 않는다.
Architecture CI baseline/native-all도 source bytes 외에 checkout index diff를 별도 검사하고 원시 patch를 보존하도록 했다.
두 workflow의 YAML 및 모든 bash run block syntax를 확인했다.

SOURCE71 ARM26 shared ZIP13401318930 SHA-256 `598ce26138c07c83f74713eea304b4ad87d470416deeeb7939edc7218064d68b`도 대조했다.
같은 canonical15918과 runtime15532/27/`9d1ce4991e1d92cbd0183a99db4170122a509e91f966f197d7a955ec53a8d77a` 전후 동일이다.
main425/424 PASS/1 FAIL와 generation3/3 PASS·각 기타0이며 유일한 main failure도 producer expected-origin 거절이다.
따라서 result port4건·canonical8건·isolated protected runtime은 세 Mac에서 관측했지만 producer instance/alias/last-close 후보는 NOT_RUN이다.
SOURCE71 Mac15 full ZIP13402365134/`e0fea93d1caf67b661799cb565f273195d801adc34445f07e99a6f5dea94e18c`,
Intel full ZIP13402161909/`a7fd55a39b9635a9b4328430733fcb55051b894efc1f1426046564cd882a05a2`의 SHA-256도 대조했고
각27/27 packed installation(App installed runtime 포함)과 최종 input/runtime 전후 동일을 확인했다.
전체 PASS로 합산하거나 SOURCE72에 이 실행 증거를 승계하지 않는다.

SOURCE72 최종 production build와 fixture forwarding 수정 후 root build는 exit0다.
fresh27/27 packed installation(App 포함)·installed runtime·declaration 및 full architecture·transaction·durable boundary·document·spec inventory도 exit0다.
production14394, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14362 / REMOVED220이다.
원시는 `/tmp/oma-source72-{build,package-isolation,review,architecture}.log`다. 초기 build와 test-forwarding 전 build도 별도 보존했다.
새 review root consumer와 producer origin 진단의 실제 Mac 결과는 NOT_RUN이다. 세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

### SOURCE73 producer의 명시 FD 배선과 SQLite 공개 VFS 후보

SOURCE72 `679911bcc09ebc4a5be3de3dd689a837126d2edf` / local checkpoint `c5ba53e8f0f271970c1d45fd3d3661a21949ed8c`,
Native42002668261·Architecture42002668265를 발행했다. canonical15919/`14b33bf4e38374c1b9bf198ad5e1cd1be1b70bb7c6cac32e98f4b8344ac0a901`다.
Mac15 shared ZIP13402889567 SHA-256 `732daab0e9b2de9db7531a18135d6969faa57c34b6b2e36eb7fecabf1e057b6d`를 대조했다.
위 canonical과 runtime15532/27/`adf176d1285869bd5f59fc5f2c9e2d2b0a27f58b9da88ef9a5d2ad88c9fa1be6` 전후 동일이다.
main429/428 PASS/1 FAIL·기타0, generation3/3 PASS·기타0이다. 새 review directory4건도 실제 통과했다.

producer의 expected/unconstrained audit-origin은 모두 unavailable/OSStatus100003이었고 직후 fresh process pin도 generation unavailable로 거절했다.
원인은 C가 자기 생존 채널을 FD3으로 읽는데 App ExecutionRuntime의 일반 inheritedFds는 target6부터 배치하는 fixture 배선 오류다.
FD3에 있던 새 UDP socket을 닫은 뒤 생존 채널도 없는 상태가 됐다. SOURCE73은 fixed fixture의 explicit files target3을 선택한다.
producer image/CDHash matched·fresh alive·socket instance·independent alias·Node replay·producer-live last-close 조건은 유지한다.
기존 unavailable을 matched/dead/held로 바꾸거나 deadline을 넓히지 않는다. 수정 뒤 actual Mac 결과는 NOT_RUN이다.

SQLite는 [Node26의 공개 URI open](https://github.com/nodejs/node/blob/v26.0.0/src/node_sqlite.cc)과
[SQLite 공개 loadable VFS extension](https://www.sqlite.org/loadext.html#persistent_loadable_extensions)을 쓰는 test-only 후보를 추가했다.
기존 default VFS를 복제하고 xFullPathname에서 descriptor-directory spelling을 보존한다. 새 DB engine·업무 SQL·privileged service는 넣지 않는다.
고정 test-owned extension은 in-memory loader에만 명시적으로 로드하며 main DB의 extension loading은 기본 비활성으로 유지한다.
공개 sqlite3_api_routines table로 Node가 이미 내장한 engine의 VFS를 등록한다. OS SQLite library나 Node private symbol을 링크하지 않는다.
OS SDK header의 extension wrapper macro 대신 host가 전달한 공개 function table을 직접 사용한다.
실제 Linux Node26/SQLite3.51.3에서 loader를 닫은 뒤에도 새 VFS가 동작했고, directory rename/replacement 후 row1/2와
DB/WAL/SHM이 held original에만 생긴 것을 확인했다(`/tmp/oma-source73-sqlite-linux-prototype.log`).
이는 Mac의 /dev/fd directory traversal이나 Store 전체의 root 결박 증거가 아니다.
새 Mac fixture는 default와 candidate의 실제 canary·DB open·WAL·replacement 결과를 관측하고 REJECTED/UNSAFE_SPLIT/ORIGINAL_ONLY_OBSERVED를 구분한다.
어떤 결과도 단독 product/G-FILES PASS로 채택하지 않는다. 양 SDK object compile·Linux NOT_RUN 경로는 PASS, actual Mac은 NOT_RUN이다.

workflow는 main 시험 직후 별도 native-main artifact에 source/runtime 전후 binding과 원시 TAP을 먼저 보존한다.
기존 generation 실행·두 oracle 묶음의 성공 조건·최종 native-shared binding·deadline/job/matrix 상한은 유지한다.
main artifact를 cold-generation 완료 근거로 쓰지 않는다. production은 SOURCE72와 같으며 새 build/pack 실행으로 합산하지 않는다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE72 Intel shared ZIP13403118850 SHA-256 `aa0c6211994def0628a5355a59fc07e5a5671cc12f5dab24900216ff9dee6c30`도 대조했다.
같은 canonical15919와 runtime15532/27/`b505525cd1e2081bf497e0956547c751b878850ecf9626979e2cdbdbf877286c` 전후 동일,
main429/428 PASS/1 FAIL·기타0, generation3/3 PASS·기타0이다. review directory4건도 실제 PASS다.
producer의 두 origin도100003, 이후 process pin unavailable이었다. 임시 setup failure를 candidate instance/last-close 판정으로 쓰지 않는다.
SOURCE73 full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
새 Mac SQLite namespace와 corrected producer lifetime의 실제 결과는 여전히 NOT_RUN이다.
원시는 `/tmp/oma-source73-{architecture,sqlite-arm,sqlite-intel,candidates-linux}.log`와 실제 Linux prototype log다.

### SOURCE74 공개 SQLite Unix VFS syscall adapter 후보

SOURCE73 `666d6c23125723548e27bdd93bb3d060160f0f1f` / local checkpoint `188e0cb11dd876d284ec825a51827706adb2ae05`,
Native42005149612·Architecture42005149538의 Mac15 shared ZIP13404318778 SHA-256
`8fc78d25b85acb62ae7efc95150b8cfafa7639fdac15a787fa3bf08cc3f4dea8`를 대조했다.
canonical15921/`04262556f8e49d3c89f1aff70f799bf32c042777ef9e1595208ac63fdc2b60eb`와
runtime15532/27/`adf176d1285869bd5f59fc5f2c9e2d2b0a27f58b9da88ef9a5d2ad88c9fa1be6`는 전후 동일이다.
main430/430 PASS·generation3/3 PASS·각 기타0다. explicit FD3 수정 뒤 producer expected CDHash matched,
fresh live·independent alias/replay 거절·producer-live last-close를 실제 관측했다. full Society lease/backend 채택은 아니다.

Intel main ZIP13404659510 SHA-256 `dd0255c550f5284b26f438f4ef65137a9603e4b16cb8f4950e1aca05dd8cadeb`도 대조했다.
같은 canonical과 runtime15532/27/`b505525cd1e2081bf497e0956547c751b878850ecf9626979e2cdbdbf877286c`는 main 전후 동일이다.
main430/429 PASS/1 FAIL·기타0다. producer의 같은 인증·instance·alias·last-close 조건은 통과했지만
기존 supervisor-guard candidate에서 populated scope termination failed / RUN_TERMINATION_UNKNOWN이 발생했다.
직렬 generation과 전체 packed qualification 완료로 이 main artifact를 해석하지 않는다.
SOURCE74는 해당 fixture의 원래 process 안에서 mode·population·journal·전체 중첩 cause를 기록한다.
unknown을 dead로 바꾸거나 재실행 성공으로 이 실패를 지우지 않는다.

SQLite descriptor-spelling 후보는 실제 양 Mac에서 canary ENOENT와 database-open errcode14로 REJECTED였다.
Linux `/proc/self/fd` 성공을 Mac `/dev/fd`에 옮기지 않는다. SOURCE74는 별도 test-only C extension에서
[공개 VFS v3 syscall hooks](https://www.sqlite.org/c3ref/vfs.html)를 조사한다.
기존 Node 내장 SQLite engine·Unix POSIX locking·WAL/SHM 구현을 유지하고 private virtual prefix만
held directory의 openat/fstatat/unlinkat 등으로 처리한다. 다른 default-VFS 경로는 원래 호출로 전달한다.
Mac은 명시적 unix-posix VFS를 요구하며 private SQLite 구조·Node symbol·OS SQLite library를 쓰지 않는다.
고정 candidate는 단일 test root만 복제해 보유하고 모든 DB close 뒤 명시 반납한다. production root API가 아니다.
이미 callback을 설치한 뒤 setup이 거절돼도 image는 영구 load 상태로 유지하며 bind를 거절한다.

Linux Node26의 실제 내장 engine에서 root caller FD를 닫고 원본 rename/replacement 후 처음 WAL/SHM을 열어,
WAL mode·reader snapshot·writer contention·checkpoint·재개방 integrity·default VFS 공존·반납 후 거절을 확인했다.
원시는 `/tmp/oma-source74-sqlite-linux.log`다. Mac actual 결과와 G-FILES 채택은 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE73 Mac15 full ZIP13405186336 SHA-256 `062c63d610792603dd24d444f9ef7f4c76f16fe3d0499010126d67792439eaa3`도 대조했다.
27/27 packed installation(App installed runtime 포함)과 main/shared/final input/runtime의 원본 대비 동일을 확인했다.
SOURCE74 양 SDK object compile·Linux NOT_RUN 경로·full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
Linux public-hook 원형은 실제1/1 PASS이며 Mac qualification과 합산하지 않는다. production은 SOURCE72와 같다.
원시는 `/tmp/oma-source74-{architecture,sqlite-arm,sqlite-intel,candidates-linux,sqlite-linux}.log`다.

### SOURCE75 integration 준비·prepared ref owner·collector의 canonical root

SOURCE74 `0eeeaad05db7e476b1c4f541c8ef17574bad56f8` / local checkpoint `32da519ab05feac9dea7cc57488e6efd5b06effd`,
Native42007519477·Architecture42007519354를 발행했다. canonical15922/`6fc011c7ab32052c93a5fc2438dd72f4d0a82fe77c02c5f1b05f1235a54942ed`다.
Mac15 shared ZIP13406201920 SHA-256 `e3cf455298762402e651ca47c9189f6f7dbee7a03c95a7de9fcce73de896dda4`와
Intel main ZIP13405627239 SHA-256 `60f4afcf294faaa3dc75375c0b5612ad9977249fbfc881c98c4bfdae936cddb1`를 대조했다.
각 canonical과 runtime15532/27은 전후 동일이며 runtime digest는 Mac15 `adf176d1285869bd5f59fc5f2c9e2d2b0a27f58b9da88ef9a5d2ad88c9fa1be6`,
Intel `b505525cd1e2081bf497e0956547c751b878850ecf9626979e2cdbdbf877286c`다.
양 main431/431 PASS·기타0, Mac15 isolated generation3/3 PASS·기타0다. Intel generation은 이 main artifact 범위 밖이다.
새 SQLite public hook 후보의 실제 WAL mode·rename 뒤 WAL/SHM·reader snapshot·writer contention·checkpoint·integrity reopen·
다른 default VFS 공존·root 반납 뒤 거절은 양 Mac에서 관측했다. Store production 연결·G-FILES 완료는 아니다.
앞선 Intel scope unknown이 이번에 재발하지 않았다는 사실만으로 원인이 수정됐다고 하지 않는다.

SOURCE73 Intel shared ZIP13405341353 SHA-256 `9d8afbbe36aae5558b38db938bbeec41d207b216f5e77bf12b4722a85d898acd`도 대조했다.
canonical15921와 SOURCE73 Intel runtime15532/27은 shared 전후 동일이다. main430/429 PASS/1 FAIL·기타0,
isolated generation3/2 PASS/1 CANCELLED·fail/skip/todo0다. generation001은 기존240000ms 예산을 넘겨273815.784697ms에 timeout을 기록했다.
phase는 fixture installation36901ms·source digest10654ms·protected Node preparation12479ms까지 왔다.
이후 generation construction 완료는 관측하지 못했다. 직렬 실행도 deadline 보장은 아니며 예산을 넓히지 않는다.

SOURCE75는 기존 CanonicalExecution을 async integration merge-tree·commit-tree·prepared update-ref·raw delta에 전달한다.
별도 fixed canonical-directory leaf가 oma-results/oma-preparations만 열며, review와 integration이 같은 project capability를 쓴다.
TreeLease는 trusted borrowed parent cursor로 take·quiescence·collection을 처리하는 선택 port를 갖는다.
이 port가 있으면 logical tree label의 leaf만 held parent에서 열고 닫으며 경로 fallback을 하지 않는다.
기존 lease 없음/불명→unknown·실행 범위 사망의 독립 조건과 기본 Linux 조립은 유지한다.

prepared ref의 preaccept owner는 project와 preparations parent의 자기 cursor를 보유한다.
활성/불명 helper면 폐기를 거절하고 cursor를 보존하며, 수락 또는 관측된 ref 부재 뒤 반납한다.
반납 실패는 보존하고 숫자 FD를 다시 닫지 않는다. 등록 callback 거절은 게시 전 cursor만 반납한다.
삭제 command exit만 성공으로 쓰지 않고 같은 held canonical에서 ref 부재도 확인한다.
startup collector의 enumerate·lease·ref 관측·삭제·lease 정리도 같은 root를 사용하며 실제 App reconcile에 전달한다.
reconcile canonicalMain과 review source-record의 patch/blob 관측도 같은 selected Git/root를 쓴다.
canonical health diagnostics·context/private workspace·SQLite Store와 나머지 G-FILES는 아직 미완료다.

원본 rename/replacement와 등록 중 교체에서 수락·폐기·등록 거절·활성 lease 거절 후 폐기·고아 collector를 실제 Git으로 확인했다.
settlement 직전 caller root FD를 닫아도 owner의 독립 cursor로 원본 ref만 처리했다.
replacement ref·동명 lease bytes·main·Host cwd는 보존됐다. 새6건과 기존 review/canonical을 포함한 최종 Linux 회귀106/106 PASS다.
기존 accepted/unknown/active collector·SIGKILL prepared CAS·lease cleanup 회귀24/24도 PASS다.
review source-record는 교체 후 원본 patch와 정확한 endpoint blob bytes까지 읽었다.
원시는 `/tmp/oma-source75-linux-regression.log`·`/tmp/oma-source75-collector-leases.log`이며 checkout `.git`은 read-only였다.
최종 index diff는 빈 `/tmp/oma-source75-checkout-index.patch`다. Mac actual 새 consumer 결과는 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE74 Intel shared ZIP13405947904 SHA-256 `35a76c6ae456b5c1db2820cb9563188fb6fac36e5c9e19a4028742f777b493b6`도 대조했다.
같은 canonical15922와 위 Intel runtime15532/27은 shared 전후 동일이며 main431/431·generation3/3 PASS·기타0다.
SOURCE73 timeout/unknown 실패를 이 결과로 없애거나 cold-start 예산 보장으로 쓰지 않는다.
SOURCE75 최종 production build와 fresh27/27 packed installation(App installed runtime 포함)은 exit0다.
production14396, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14364 / REMOVED220이다.
원시는 `/tmp/oma-source75-build-final.log`·`/tmp/oma-source75-package-isolation.log`·`/tmp/oma-source75-review.log`다.

SOURCE75 full architecture·transaction·durable boundary·document·spec inventory는 exit0이며 input binding013은1/1 PASS다.
원시는 `/tmp/oma-source75-architecture.log`·`/tmp/oma-source75-input-binding-test.log`다.
SOURCE74 Mac15 full ZIP13406740322 SHA-256 `e4e496fcc4da21c3d54083d72bc77c7d1c314ad8f3862a2d6f3cd219121d2930`의
27/27 packed installation(App installed runtime 포함)과 최종 canonical/runtime 동일도 대조했다.
SOURCE75 actual Mac consumer 시험과 전체 product gate는 완료하지 않았다.

### SOURCE76 실제 Store의 held SQLite root와 review scratch 별칭

SOURCE75 `aaf227c72801dc916ef040fa84e3dcecf12e1df5` / local checkpoint `f550d18144f5b0679927cc459a6ef00a8500137f`,
Native42009716372·Architecture42009716496를 발행했다. canonical15925/`bd3571c3139a5b99971020f01f14da001229e4117b3c2d988f7eccb153b65051`다.
Mac15 shared ZIP13406154977 SHA-256 `f592348549b5d1319263bfde4af086ff8c149415702b1db0bfd71ae7882792b9`,
Intel shared ZIP13406409393 SHA-256 `11ca62fa6028919d865d253a1deea9b5bbd00497bf736aacee3cd7ab976f36a6`,
ARM26 shared ZIP13407307701 SHA-256 `6a7c34ffd1255665b3f52631c50816ad90947fb2689f060b1309441957a64bb5`를 대조했다.
각 canonical과 runtime15536/27은 shared 전후 동일이다. runtime digest는 각각
`c9ec2e96dec268e672ec92627cb1d1adadff24272fda2db022808bb55815c9d8`,
`6437713ec915aa084fb8b66140fa757934df66974982576177eea05e834294fd`,
`d85d80573633bcb4d9aa2d04172b2419b6f097f14f734e267cf7f999650806cc`다.
세 main437/435 PASS/2 FAIL·기타0, 세 isolated generation3/3 PASS·기타0다.
새 integration root6건·creator-instance/alias/last-close·public SQLite syscall 후보는 세 Mac 모두 PASS다.
실패2건은 review source-record scratch의 tmpdir /var 별칭이 no-symlink parent open에 거절된 것이다.
SOURCE76은 OS tmpdir를 realpath로 정규화한 뒤 기존 held no-link open을 유지한다. fallback/Host cwd 변경을 하지 않는다.
이 수정의 실제 Mac 결과는 아직 NOT_RUN이다.

SOURCE75 Mac15 full ZIP13406424943 SHA-256 `53e2ab6411a8c21df5b46325edd6cb2f2737d5fc3e0bf9faede251fbd06ee3cc`,
Intel full ZIP13407463067 SHA-256 `98327b23e5879573acc7870a1531ee6e09e6a0d596e6a135a9c1c0220fa53000`의
27/27 packed installation(App installed runtime 포함)·최종 input/runtime 동일도 대조했다. main 실패를 전체 PASS로 바꾸지 않는다.

SOURCE76은 @oma/native의 C Unix POSIX VFS adapter·Storage 소유 SQLite root loader·Store의 trusted directory control을 연결한다.
Node26.0.0/내장 SQLite3.51.3과 공개 VFS v3 hooks를 요구한다. 실제 양 Mac SOURCE74 environment도 이 version이었다.
OS SQLite·새 engine·private SQLite/Node 구조를 링크하지 않고 public file methods로 기존 read/write/lock/WAL/SHM을 위임한다.
고정 extension은 private memory loader에만 로드하고 실제 Store DB의 extension loading은 비활성이다.
package-owned C source/서명 dylib의 build recipe·export·설치 smoke를 함께 등록했다.
OS와 engine의 다른 generation에는 경로 fallback 없이 거절한다. 기존 Linux의 기본 Store 경로는 유지한다.

각 native root는 directory FD를 복제한다. private virtual prefix의 실제 open/stat/unlink/directory flush만
동일 held parent로 처리하며 unbound prefix는 거절한다. 원래 default VFS의 다른 경로는 기존 OS 호출을 쓴다.
공개 sqlite3_file wrapper가 파일 수명을 세고 생성한 temporary filename을 소유한다.
SQLite의 NULL-name temp open과 FCNTL_TEMPFILENAME도 해당 root로 연결한다.
반납은 실제 DB close 뒤에 수행하며 파일 사용 중이면 거절한다. 관측된 close 실패는 보존하고 숫자 FD를 다시 닫지 않는다.
스키마 사전 검사·sidecar identity·readonly preflight·기존 v4→v5 backup/flush도 같은 held directory를 쓴다.
스키마/accepted bytes/거래 의미를 바꾸지 않는다. App Broker는 State directory를 전달하고 lifetime에 Store를 먼저 등록한다.

초기 multi-root 원형은 서로 다른 두 root에서 성공했지만 같은 inode를 두 root로 열면 첫 root의 반환 뒤
SQLite가 inode별로 공유하는 WAL namespace를 잃어 마지막 close 후 -shm만 남았다.
실제 반례는 `/tmp/oma-source76-same-root-initial.log`다. 같은 inode의 binding은 이제 하나의 VFS namespace를 참조 계수로 보유한다.
등록/반납을 직렬화하되 file/syscall 관측 mutex를 SQLite VFS registry 호출에 걸쳐 보유하지 않는다.
마지막 binding과 file owner가 반납된 뒤에만 namespace/FD를 반납한다.
수정 후 첫 connection close·다른 connection의 계속된 write·마지막 close 뒤 DB만 남는 것을 확인했다.
원시는 `/tmp/oma-source76-same-root-final.log`·`/tmp/oma-source76-root-linux-shared-final.log`다.

초기 production build·27/27 packed install·review 생성은 shared-root 수정 전에 완료했고
`/tmp/oma-source76-package-isolation-before-shared-root.log`·`/tmp/oma-source76-review-before-shared-root.log`로 보존했다.
수정된 production을 다시 build하고 새 독립 설치·review 검사를 시작했다. 이 둘의 결과를 아직 합산하지 않는다.
양 SDK object compile은 수정 뒤 exit0다(`/tmp/oma-source76-sqlite-{aarch64,x86_64}-final.log`).
최종 Linux regression79/79 PASS·기타0이며 Darwin-only consumer는 NOT_RUN 진단과 구분한다.
원시는 `/tmp/oma-source76-linux-regression-final.log`, 빈 `/tmp/oma-source76-checkout-index-final.patch`다. checkout .git은 read-only였다.

Linux 호환 원형은 같은 C source의 Unix VFS와 실제 compiled Store를 사용하되 test loader에서 OS 선택 부분만 치환했다.
초기 prototype의 module hook을 static import 뒤에 설치한 setup 실패도 별도 보존했다.
최종 Store5건은 경로 교체·transaction/rollback·reopen·v4 backup·지원하지 않는 version 보존·hardlink 거절을 확인했다.
원시는 `/tmp/oma-source76-store-linux-prototype-final.log`다. 이 원형을 실제 Mac 또는 기본 Linux backend 결과로 쓰지 않는다.
Mac fixture는 실제 Store5건·shared/different roots·WAL·temp table·마지막 반환을 시험한다.
SQLite temp 시험은 격리된 worker에 production Seatbelt renderer를 적용하고 root 밖 쓰기 거절을 대조한 뒤 실행한다.
Mac actual 새 adapter 결과는 NOT_RUN이며 G-FILES의 context/private workspace·다른 writer·전체 product 검증도 남아 있다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE75 ARM26 full ZIP13407209209 SHA-256 `2d8a97bf5a7ecc90646b9e838ec8aeb928af819be4665364e14e3ae90dab66f3`도 대조했다.
같은 canonical15925·ARM runtime15536/27의 최종 동일과27/27 packed installation(App installed runtime 포함)을 확인했다.
세 Mac의 main 실패2건은 그대로 보존한다.

SOURCE76 shared-root 수정 뒤 최종 production build와 fresh27/27 packed installation(App installed runtime 포함)은 exit0다.
production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source76-build-final.log`·`/tmp/oma-source76-package-isolation.log`·`/tmp/oma-source76-review.log`다.
같은 최종 C로 Store 호환 원형5/5도 다시 실행했다. actual Mac 새 consumer와 실행 guard는 아직 변경하지 않는다.

초기 full architecture는 Native TS loader의 raw SQLite owner 위반과 미분류 kernel zone 두 건을 거절했다.
원시는 `/tmp/oma-source76-architecture-before-sqlite-owner.log`다. SQLite owner allowlist를 넓히지 않는다.
memory loader/DB 수명은 기존 concrete SQLite owner인 Storage store.ts로 옮겼다.
Native TS는 C image의 package-owned URL만 제공하고 기존 K2-mechanisms의 파일 primitive 구역에 등록했다.
설치된 실제 SQL/close 시험은 Storage smoke로 옮기고 Native smoke는 image 존재와 metadata primitive를 확인한다.
owner 변경 전27/27·review 원시는 `/tmp/oma-source76-package-isolation-before-sqlite-owner.log`·`/tmp/oma-source76-review-before-sqlite-owner.log`다.
변경 뒤 실제 compiled Storage와 같은 C의 Linux 호환 원형6/6 PASS를 확인했다(`/tmp/oma-source76-sqlite-owner-linux-prototypes.log`).
그 원형은 native image 선택 port만 Linux build로 치환했고 실제 Mac Seatbelt 단계는 실행하지 않았다.
첫 직접 architecture 재검사는 owner/zone 위반이 없었지만 갱신 전 dependency evidence를 거절했다.
원시는 `/tmp/oma-source76-architecture-owner-only.log`이며 구조 생성 뒤의 최종 전체 검사를 별도로 수행한다.

기존 cold-generation timeout의 후속 후보로 public fclonefileat의 held-source/parent 복제 시험을 추가했다.
[고정 XNU 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/vfs/vfs_syscalls.c)은
readable source FD를 취득하고 기존 destination은 덮어쓰지 않는 clone 내부 경로를 호출한다.
새 fixture는 source rename/unlink/immutable·destination parent 교체·독립 inode·source 후속 변경·두 번째 게시 충돌과 flags를 관측한다.
이는 private runtime producer나 shared copy helper에 아직 연결하지 않은 test-only 후보다.
양 SDK object compile·Linux NOT_RUN 경로는 exit0이며 실제 Mac과 시간 개선은 NOT_RUN이다.
원시는 `/tmp/oma-source76-clone-{aarch64,x86_64}.log`·`/tmp/oma-source76-clone-linux.log`다.

SOURCE76 SQLite owner 이동 뒤 production build·fresh27/27 packed installation(App installed runtime 포함)은 exit0다.
Storage의 installed runtime smoke도 Linux에서 실제 새 DB/schema와 read owner를 실행했다.
최종 production14398, review CHANGED_WITHOUT_ORACLE31 / NOT_REVIEWED14367 / REMOVED220이다.
원시는 `/tmp/oma-source76-build-owner.log`·`/tmp/oma-source76-package-isolation.log`·`/tmp/oma-source76-review.log`다.
owner 이동 뒤 regression79/79 PASS·기타0와 빈 index diff를 확인했다(`/tmp/oma-source76-linux-regression-owner.log`·`/tmp/oma-source76-checkout-index-owner.patch`).
Mac의 새 Storage smoke·Store root·shared-root Seatbelt·clone fixture는 NOT_RUN이다.

SOURCE76 owner·zone·dependency evidence를 고친 최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
원시는 `/tmp/oma-source76-architecture.log`다. owner/zone 예외나 SQLite allowlist 확대를 하지 않았다.
기존 K2 구역에 native image path leaf만 등록했으며 SQLite connection은 기존 K3 Store owner에 남긴다.
최종 canonical input을 다시 결박하고 Mac 새 consumer 실행 전의 NOT_RUN·세 gate OPEN·product BLOCKED를 유지한다.

### SOURCE77 context canonical commands와 원본 process의 generation 실패 진단

SOURCE76 `1372b7484080d3895b2b23f18a9e84f541bbf2e3` / local checkpoint `c9bc8e2de834de96a70f5b05a1106f195d7e7bde`,
Native42015564532·Architecture42015564414를 발행했다. canonical15932/`fede45e1dd29deda3dc77b5b3eaed09af7caa350a8642306a906261e052b2045`다.
Mac15 shared ZIP13408549322 SHA-256 `c4170869817a3caceb4765e00e0c9ae2e72eace5cd3e1a2e937b5fa04c8a1cee`,
Intel shared ZIP13408874467 SHA-256 `5a76f806c403fcb2f04b4e1e04aec27cbcab322719c7ab864e361f3428a53c11`,
ARM26 shared ZIP13410406259 SHA-256 `53ee3828ae76be6bb9d65613b82e2b341c7fdc786f42a63907887db69fb86d70`를 대조했다.
세 canonical과 runtime15540/27은 shared 전후 동일이다. runtime digest는 각각
`604f51a37129d697a365ca27065fea0742c269896d5e2c302bbf9364a5f3aa21`,
`4b7274a7a24f80f3731ff25da11609207abba1ee0252e593dfdc8b636c78a7da`,
`17a6b838bc2ddf5815711b8a9e697dd3a0a684a3f4b38f6a9fb6330a66b5a909`다.
세 main446/446 PASS·기타0다. 실제 Store5건·shared/different SQLite roots·Seatbelt temp SQL·review scratch 수정과 clone 후보3건이 모두 통과했다.
cloned target의 immutable flags도 source를 따라2가 됐고 보통 source 두 건은0이었다. copy producer에 아직 채택하지 않는다.

Intel·ARM26 isolated generation은 각3/3 PASS·기타0다. Mac15는3/2 PASS/1 FAIL·기타0이며 generation001이89396.294625ms에
RUN_TERMINATION_UNKNOWN / populated scope termination failed를 기록했다. construction56946ms 뒤 scope 실행/반납 단계에서 실패했다.
이는 Store failure나240000ms timeout이 아니다. native terminal/death predicate·예산을 바꾸지 않는다.
SOURCE77은 whole-generation fixture의 바깥 catch에서 원래 process의 모든 중첩 cause·selected population·journal을 기록한다.
기존 private-Git catch보다 앞선 main scope/보호 Node 준비 실패도 포함한다. 진단 실패는 primary error를 대체하지 않는다.
Source76 실패를 이후 성공으로 삭제하지 않으며 원인은 아직 미확정이다.

Mac15 full ZIP13409601706 SHA-256 `529db16ce6bbd3f935a7f706208dd6746db40d09775cf0ba8c5afd22b8d84b93`의
27/27 packed installation(Storage 실제 installed runtime와 App 포함)·최종 input/runtime 동일도 대조했다.
Mac15의 generation failure를 full package 성공으로 덮지 않는다.

SOURCE77은 CanonicalExecution의 trusted lifetime resolver로 첫 사용/생성 뒤 context directory cursor를 보유한다.
App의 resolver는 고정 contextGit label만 허용하고 같은 cursor를 재사용하며 native/logical shutdown 확인 뒤 project cursor와 함께 반납한다.
Canonical command의 고정 --git-dir operand만 같은 resolver를 사용한다. argv 전체 탐색·Model FD grammar·process-global cwd는 추가하지 않는다.
ContextRepository의 current/object format·tree/blob/parent 검증·canonical command/preparation target도 같은 cursor를 사용한다.
private working Git에는 기존 held cwd와 selected developer Git을 쓴다. 기본 Linux 조립·accepted OID/manifest/CAS 의미는 유지한다.
private staging/snapshot·두 저장소 사이 pathname fetch·초기 parent durability와 전체 StateRoot capture 등 나머지 G-FILES는 남아 있다.

실제 Git의 SHA1/SHA256과 사전 binding/첫 사용 retaining에서 canonical name을 교체한 뒤 원본 current·GOAL-only·accepted blob/parent 검증·CAS를 확인했다.
replacement refs와 Host cwd는 보존됐으며 처음 만든 context도 preparation 전에 cursor가 보유되고 이후 교체를 견뎠다.
최종 새5건은 `/tmp/oma-source77-context-final.log`, 기존 context 수락/복구·preaccept·root 회귀75/75 PASS는
`/tmp/oma-source77-linux-regression.log`, 빈 index diff는 `/tmp/oma-source77-checkout-index.patch`다.
최초 regression command는 존재하지 않는 compiled 파일을 사전 확인에서 거절해 실행하지 않았다. 파일 목록을 실제 확인한 뒤 위75건을 실행했다.
시험은 checkout .git을 read-only bind했고 production build·fresh27/27 packed installation(App 포함)은 exit0다.
production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source77-build-initial.log`·`/tmp/oma-source77-package-isolation.log`·`/tmp/oma-source77-review.log`다.
새 context consumer와 generation full-cause 진단의 actual Mac 결과는 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard를 유지한다.

SOURCE76 Intel full ZIP13409618055 SHA-256 `092a5e517901194272557bf22f73153969cd68806aa3ed4d1ffa08c7c8784c29`,
ARM26 full ZIP13409639114 SHA-256 `898482e79c1b7f5ac06288e6fba06d3bc7419981848c97e8237f6470bf366042`도 대조했다.
각27/27 packed installation(Storage 실제 installed runtime와 App 포함)·최종 canonical/runtime 동일을 확인했다.
이로써 SOURCE76 새 Store primitive/consumer와 패키지는 세 Mac에서 관측했다. Mac15 generation unknown은 그대로 미해결이다.
SOURCE77 full architecture·transaction·durable boundary·document·spec inventory는 exit0다(`/tmp/oma-source77-architecture.log`).
새 context 및 generation 실패 진단의 actual Mac은 아직 NOT_RUN이다.

### SOURCE78 state 쓰기 전 직접 fixed producer 후보

SOURCE77 `32b25265b584babd7ae7785cbbb819910870c159` / local checkpoint `97bd3be915b4e2cedbda4adc4f6c81a8dade5878`,
Native42019573196의 canonical15933/`c6af49dc63a0bdb0426592a3504061ad78864377b24f89745c7323e2c3717054`를 대조했다.
Mac15 shared ZIP13410813462 SHA-256 `d32394b8195c730c1d49a9f9dd78f0d18a49c944821bcf2e01475564156d83bc`,
Intel shared ZIP13410958669 SHA-256 `feb5f22a1de0bfab4e144f3d2bc9b51a66914837b13e8254179403d6b610b117`는
main 각451/451·generation 각3/3 PASS·기타0다. 새 context5건도 실제 통과했다.
각 runtime15540/27의 digest는 `53d8db97a88434fece36a55d81b5aed7c6704199bb3b1060bcae74f37abea0bd`,
`64a7992317b6c436327d94b25420d3d2e6e78f39a6e56dcb613b11c6f27a2fbd`이며 shared 전후 동일이다.
Mac15 full ZIP13412200710 SHA-256 `ac32dca4578b76b6cbe0a16985ff49f7f3d7c3c4e7a36d5f6cfdce3cda81c59f`는
같은 source/input/runtime의 최종 동일과27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.
이 성공으로 SOURCE76 및 이전 populated-scope termination unknown을 해결했다고 판정하지 않는다.

SOURCE78은 launchd job/ExecutionJournal 없이 public posix_spawn으로 고정 C producer를 직접 실행하는 test-only 후보를 추가했다.
START_SUSPENDED·CLOEXEC_DEFAULT·명시적 FD3 lifetime pipe·private bootstrap special port를 사용한다.
부모는 unreaped direct child의 kernel audit token으로 Security dynamic guest를 조회하고 expected CDHash를 검증한 뒤에만 release한다.
잘못된 CDHash는 release 전에 거절하고 같은 소유 direct child를 회수한다.
실행 뒤 실제 Mach audit trailer·전체 tag·socket opaque/generation·held bind 충돌·producer 생존 중 last-close 해제를 검사한다.
기존 launchd producer 모드는 유지하며 bootstrap-peer 명시 모드만 추가한다.
이는 pathname lock이나 frozen socket metadata 단독을 Society ownership으로 채택한 변경이 아니다.
Society 전체 identity/discovery/collision, inherited FD4의 provenance, owner SIGKILL과 suspended child cleanup 및 제품 recovery는 미해결이다.
production lease/backend·실행 guard·death predicate·예산은 바꾸지 않았다.

로컬 SDK snapshot에는 CoreFoundation/Security framework headers가 없어 direct controller object compile이 준비 단계에서 거절됐다.
없는 framework 경로를 추가한 재시도도 같은 준비 실패이며 실제 Mac compile/link/runtime는 NOT_RUN이다.
이 후보의 Linux 경로는 NOT_RUN 진단만 제공한다. 새 primitive를 제품 완료 근거로 승격하지 않는다.

SOURCE77 ARM26 shared ZIP13411762722 SHA-256 `ea7062b3f7c7aaad21040e7f765539793da0a7576899d6f5cddf006014e7d450`도 대조했다.
같은 canonical15933·runtime15540/27 `1e787a450a548a50264071ba8d520d9e19c953df1a958fe33c605065aad8f0d9`의 shared 전후 동일,
main451/451·generation3/3 PASS·기타0다. SOURCE77 새 context5건이 세 Mac에서 실제 통과했다.
Intel/ARM26 독립 설치는 아직 진행 중이다. SOURCE78 producer 변경의 양 SDK object compile은 exit0이며
Linux 두 시험은 모두 Darwin NOT_RUN 진단이다(`/tmp/oma-source78-fence-linux.log`).
SOURCE78의 production 변경은 없으므로 SOURCE77 build/packed 결과를 새 primitive 실행 증거로 사용하지 않는다.

SOURCE78 full architecture·transaction·durable boundary·document·spec inventory는 exit0다(`/tmp/oma-source78-architecture-final.log`).
CI YAML과21개 shell run block의 문법도 통과했다. production source/asset 변경은 없으며 native 실행 판정은 위 NOT_RUN을 유지한다.

### SOURCE79 canonical context의 같은 capability에 대한 persistence barrier

SOURCE78 `ae7df96c68ef6f4700533a5aa81d11151a1a4d5d` / local checkpoint `2c9e820aa7d867da8a6dd449fe5dba50939ddd2e`,
Native42022826081을 발행했다. canonical15935/`6e9cb8a21e6060fd70aa5f1938e770a46d34f1a55f28a3e81c0b5ada5f4ed194`다.
새 direct producer 후보의 actual Mac compile/link/runtime는 아직 NOT_RUN이다.

SOURCE77 Intel full ZIP13412231782 SHA-256 `45207ca7e53ecb69122b2af4b2e6baf1063b96f59c406cef3939aeccf890f915`,
ARM26 full ZIP13411893494 SHA-256 `4890c10df2635d943631a5b8c1ae65c45ad30f85fc1a4880e0a2cdde7090ee91`도 대조했다.
같은 SOURCE77 canonical/runtime의 최종 동일과 각27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.
SOURCE77 세 Mac의 common451/451·generation3/3·packed27/27을 각각 보존했으며 이전 unknown의 원인 수리로 읽지 않는다.

SOURCE79는 ContextRepository의 canonical object import 뒤 동기화를 Git이 사용하는 같은 directory cursor에 연결한다.
objects 하위 directory를 held root에서 열고 기존 fsyncTree·fsyncHeldDir을 사용한다.
기본 unbound 호출의 기존 경로는 유지한다. 새로운 URI/argv 문법·deadline·accepted OID/receipt 변경은 없다.
prepare 전에 기존 context 이름을 일반 파일로 교체해도 원본에 candidate를 준비·관측·CAS하고 replacement bytes를 보존한다.
이전 pathname barrier만 되돌린 원형은 새 반례에서 실제 STORE_CORRUPT로 실패했고(`/tmp/oma-source79-context-before.log`),
수정 후 새6/6·기존 context 수락/복구/파일 identity/내구성 포함39/39 PASS·기타0다(`/tmp/oma-source79-context-regression.log`).
원형은 load hook으로 해당 compiled method만 이전 두 pathname 호출로 바꿨으며 product source/default backend를 변경하지 않았다.
시험은 checkout .git을 read-only bind했다. 이 변경은 private work/source fetch·초기 parent 생성/동기화·snapshot·전체 StateRoot capture를 완성하지 않는다.
production build·fresh27/27 packed installation(App 실제 installed runtime 포함)·full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
새 canonical barrier의 actual Mac consumer는 아직 NOT_RUN이다. 세 gate OPEN·product BLOCKED와 실행 guard를 유지한다.

SOURCE78 Mac15 main ZIP13412447709 SHA-256 `d4110e50620e682c4852016578bb1c0d17e7b11e72cf8a7ad55adcb57f24de23`를 대조했다.
같은 canonical15935와 runtime15540/27 `53d8db97a88434fece36a55d81b5aed7c6704199bb3b1060bcae74f37abea0bd`가 main 전후 동일이다.
main452/452 PASS·기타0다. 새 direct controller는 actual clang/link·hardened signing 뒤 wrong CDHash에서
Security copy0/parse0/check-67050·released=false·childReaped=true, expected CDHash에서 copy0/parse0/check0을 기록했다.
kernel sender/token·full tag·socket instance와 creator 생존 중 last-close 해제도 실제 통과했다.
Mac15의 headless 로그인/reboot/owner-loss나 제품 lease 채택으로 확대하지 않는다. 다른 Mac과 isolated generation/packed는 아직 진행 중이다.

SOURCE78 Mac15 shared ZIP13412991528 SHA-256 `0e3f13a1d67758f14138304bfc918759a795a7bcc4ba3cc39d1924540137325e`의
같은 canonical/runtime shared 전후 동일과 main452/452·generation3/3 PASS·기타0를 확인했다.
Intel main ZIP13411784963 SHA-256 `ee7ba1f4470e33f4ff08f68e3025a04ea644917c4300c8b6ae77811adf747303`도
같은 canonical15935 및 Intel runtime15540/27 `64a7992317b6c436327d94b25420d3d2e6e78f39a6e56dcb613b11c6f27a2fbd`의 main 전후 동일,
main452/452 PASS·기타0다. direct producer의 wrong/expected CDHash Security 결과와 last-close는 Intel에서도 실제 통과했다.
이로써 direct 후보의 공개 spawn/Security 경로는 두 architecture에서 관측했지만 headless/owner-loss/제품 lease는 미완료다.

SOURCE79 최종 production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source79-build.log`·`/tmp/oma-source79-package-isolation.log`·`/tmp/oma-source79-review.log`·`/tmp/oma-source79-architecture.log`다.
빈 index diff는 `/tmp/oma-source79-checkout-index.patch`에 보존했다. 위 로컬 barrier 수정의 actual Mac 결과는 아직 NOT_RUN이다.

### SOURCE80 discovery candidate와 Linux 조립 fixture 정정

SOURCE79 local checkpoint `3807fcf64bda1bcb4f9a609228c0b834e4b0e606`의 canonical15935/
`224b71c5fdfd5f6b548fbc3e486e02be4e0b7d69151cb15b2fcee2f8b39e30b1`에 로컬39/39·fresh27/27·전체 구조 검증을 결박했다.
해당 production barrier를 다음 test-only 변경과 함께 발행한다. 별도 SOURCE79 actual Mac 실행을 합성하지 않는다.

SOURCE78 Intel shared ZIP13413061853 SHA-256 `0e7bcaf33aac19d3dce5c573e87f3ad1a3cf9bd199d870df507de12dca5cc466`는
같은 canonical15935/Intel runtime의 shared 전후 동일과 main452/452·generation3/3 PASS·기타0다.
Mac15 full ZIP13413725388 SHA-256 `d565f262b161ccf6bb9f4426c993407c42bc65ee4ad8ee192438c42f421a1232`도 대조했다.
같은 source/input/runtime의 최종 동일과27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.

SOURCE77 Architecture42019573172 native-all ZIP13412823840 SHA-256 `ba19a00f4481008e1851101273633ab3d85e814fd6fe4ccf436846310cd256e1`는
canonical15933의 전후 동일·빈 checkout index 및 build/typecheck/구조12 command code0지만 전체 시험은4913/4896 PASS/17 FAIL·기타0다.
실패17건 모두 broker-composition-policy의 uncontrolled dependency: mac-protected-node에서 조립 본문 전에 실패했다.
이는 전체 Linux PASS가 아니다. Native directory port도 같은 fixture에서 명시되지 않은 새 import였다.
SOURCE80은 Linux 조립에서 호출되면 반드시 실패하는 두 명시적 대역을 추가했다.
기존18건의 host loss·startup 순서·lease 거절·storage 복구 단언은 그대로18/18 PASS·기타0다(`/tmp/oma-source80-broker-composition.log`).
해당 fixture 결과를 실제 macOS 보호 Node/FD 실행으로 승격하지 않으며 새 전체 Linux 실행도 아직 NOT_RUN이다.

SOURCE80의 host-peer 후속 원형은 TASK_HOST_PORT에 private publication endpoint를 넣어 원래 bootstrap을 유지하려 했다.
그러나 [고정 XNU task_set_special_port](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/ipc_tt.c)의
TASK_HOST_PORT/TASK_KERNEL_PORT guard는 CSR_ALLOW_KERNEL_DEBUGGER가 허용된 경우에만 이 교체를 허용한다.
[실제 spawn 호출 경로](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c)도
같은 task_set_special_port를 호출한다. 공개 setter라는 사실만으로 SIP-enabled 지원 조건을 만족하지 않는다.
이 후보를 배제하고 own test-only 원형 세 파일을 원래 SOURCE78 구현으로 되돌렸다.
원형은 `/tmp/oma-source80-host-peer-rejected.patch`와 SDK compile 원시에만 보존했다. 실제 Mac 재실행이나 production 채택은 하지 않는다.
TASK_HOST_PORT를 사용하지 않는 기존 bootstrap-peer 직접 producer의 실제 긍정/부정 근거는 유지한다.
Society discovery·full identity/port collision·namespace withdrawal·Host/producer SIGKILL·상속 FD4/current Host role은 여전히 미완료다.
production source/asset는 SOURCE79와 동일하며 기존 build/pack을 새로운 primitive의 실제 실행 증거로 사용하지 않는다.
세 gate OPEN·product BLOCKED·기본 실행 guard·death predicate·예산을 유지한다.

SOURCE78 ARM26 main ZIP13412998719 SHA-256 `b2fe7b0db24b497e14c27919f02a2baecd38b1123a51cdc87f642353084cddef`도 대조했다.
같은 canonical15935와 runtime15540/27 `1e787a450a548a50264071ba8d520d9e19c953df1a958fe33c605065aad8f0d9`가 main 전후 동일이다.
main452/452 PASS·기타0이며 direct producer의 wrong/expected CDHash 및 creator-live last-close가 ARM26에서도 실제 통과했다.
Intel full ZIP13413182751 SHA-256 `4b7072a2ab64aef3b7a9a76dadebd22ee378c8513ffcc8d08ae6e2593793c6c5`도
같은 canonical/Intel runtime의 최종 동일과27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.
SOURCE80 rejected host-peer 원형을 제거한 뒤 full architecture·transaction·durable boundary·document·spec inventory는 exit0다
(`/tmp/oma-source80-architecture-final.log`). product source/asset는 검증한 SOURCE79와 동일하다.

### SOURCE81 private bootstrap-peer를 통한 capability 전달 후보

SOURCE79 production commit `0463517f34bb99df919293776dcba475579d471d`를 ancestor로 포함한 SOURCE80
`6dee428740f9e09437196e5165cb5931c53b6bb7` / local checkpoint `ab7ad79c4a139ae14800a11e53a4622371c9c6fd`를 발행했다.
SOURCE80 canonical15935/`4bd527ae72680e7352c1bc4628c10daabadd0a9a934e0ee8a385a5598cf32888`다.
별도 SOURCE79 CI를 실행하지 않았고 SOURCE80의 새 actual Mac/Linux 결과는 아직 NOT_RUN이다.

SOURCE78 ARM26 shared ZIP13412974584 SHA-256 `39ba1740947b0d5271c465d543b11c44800864b229a342de0e85a11454054382`는
같은 canonical15935/ARM runtime의 shared 전후 동일과 main452/452·generation3/3 PASS·기타0다.
이로써 기존 bootstrap-peer 후보와 isolated generation을 세 Mac에서 각각 관측했다.
이후 SOURCE80 발행 전에 shared artifact를 보존했다. SOURCE78 ARM26 packed는 진행 중이었으며 그 결과를 합성하지 않는다.

SOURCE81은 배제한 TASK_HOST_PORT 대신 기존 private bootstrap-peer로 capability를 전달하는 test-only 후속 mode다.
fixed producer가 먼저 자기 새 socket을 publish하고, 부모가 기존 CDHash·kernel token·full tag·socket instance를 검증한다.
그 후 producer 자신의 private reply receiver와 fresh nonce 요청에만 부모가 보유한 normal bootstrap SEND reference를 전달한다.
producer는 이 right를 bootstrap_check_in의 명시적 operand로 한 번 쓰고 반납한다.
TASK_HOST_PORT/TASK_KERNEL_PORT/exception/access port나 task/global bootstrap setter는 사용하지 않는다.
새 dynamic service의 ack와 nonce 조회 reply도 같은 kernel sender token·full tag·socket instance에 대조한다.
조회 body는 creator metadata뿐이며 socket FD·bootstrap right·제품 권한을 client에게 전달하지 않는다.
기존 bootstrap-peer/launchd producer mode와 producer-live last-close 검사는 유지한다.

이는 undeclared dynamic-name check-in 계약이나 namespace ownership을 채택한 변경이 아니다.
서비스 철회·충돌·owner SIGKILL/suspended child·상속 FD4/current Host role의 제품 결박 및 headless/release 조건은 남아 있다.
producer 양 SDK object compile·JS syntax는 exit0, Linux 두 시험은 Darwin NOT_RUN 진단이다.
controller의 CoreFoundation/Security headers는 로컬 SDK snapshot에 없어 actual compile/link는 여전히 Mac CI에서만 확인한다.
원시는 `/tmp/oma-source81-producer-{arm,intel}.log`·`/tmp/oma-source81-fence-linux.log`다.
새 bootstrap 전달/dynamic discovery의 actual Mac runtime는 아직 NOT_RUN이며 production source/asset는 SOURCE79와 같다.
세 gate OPEN·product BLOCKED·기본 실행 guard·death predicate·예산을 유지한다.

SOURCE81 full architecture·transaction·durable boundary·document·spec inventory는 exit0다(`/tmp/oma-source81-architecture.log`).
새 bootstrap 전달/dynamic service는 actual Mac NOT_RUN이고 production build/pack은 SOURCE79의 동일한 bytes에 대한 기존 결과다.

### SOURCE82 Darwin 협력 socket의 실제 자식 수명 상속

SOURCE81 `a2beeed31d183f3349018bac3a6fc995bb64e0ee` / local checkpoint `366c23d9a7d3d275c241e322beddd1ddf8ed1354`,
Native42027105081을 발행했다. 새 bootstrap capability/dynamic discovery의 actual Mac은 아직 NOT_RUN이다.
SOURCE80 Mac15 main ZIP13414736018 SHA-256 `0929e81201b579c6d8fdd36617ea28aaf476244af301b12d7571ca29b0739d37`,
shared ZIP13414322217 SHA-256 `f502c6e2b33747e709fff40e33bfb31f89f765108801b87dcaf04df4cc0d3144`를 대조했다.
canonical15935/`4bd527ae72680e7352c1bc4628c10daabadd0a9a934e0ee8a385a5598cf32888` 및 runtime15540/27
`00216364774d2b080202d2847c2f7f9bebf7f02bb68ea3869e9307e0448ac7e7`가 각 전후 동일이다.
main453/453·generation3/3 PASS·기타0며 준비 전 canonical name 교체를 포함한 새 context6건이 실제 통과했다.
SOURCE80의 다른 Mac/독립 설치를 이 결과에 합성하지 않는다.

SOURCE82는 Darwin job의 fileport 수신에도 부모가 보유한 협력 socket을 포함한다.
기존 inheritedFence primitive로 부모 FD를 관측하고, 명시적 handoff가 같은 FD를 이미 포함하면 그 child slot을 재사용한다.
보통 FD4에 전달하지만 private/preparation input이 점유하면 다른 빈 slot을 사용하고 실제 child env에 그 번호를 결박한다.
기존 capability를 덮어쓰지 않고 없는/잘못된 부모 FD는 creation 전에 거절한다.
이는 shape-only lease 인식이나 제품 권한을 추가하는 변경이 아니다. 부모가 이미 보유한 socket의 물리적 수명 상속만 담당한다.
Linux backend와 Broker의 FD4 Society provenance 판정은 바꾸지 않는다.

새 실제 Darwin 시험은 ordinary/occupied slot/explicit same socket 세 경우를 나눈다.
setup/authorize 뒤 부모 복사본과 환경을 반납하고, 자식의 실제 socket 통신·명시적 다른 socket 보존·마지막 close의 EOF와
kernel CID/journal 반납을 확인한다. 아직 actual Mac NOT_RUN이며 Linux에서는 명시적 NOT_RUN 진단이다.
로컬 build exit0, 관련 Linux process/context/조립 회귀43/43 PASS·기타0와 빈 index diff를 확인했다.
원시는 `/tmp/oma-source82-build.log`·`/tmp/oma-source82-process-regression.log`·`/tmp/oma-source82-checkout-index.patch`다.
최초 focused11건의 default Linux 실행도 exit0였고 index는 비어 있었다. 최종43건은 checkout .git을 read-only bind했다.
fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata·full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
Society identity/discovery/collision·current Host/FD4 authority·owner crash와 전체 제품 gate는 여전히 미완료다.
세 gate OPEN·product BLOCKED·실행 guard·death predicate·예산을 유지한다.

SOURCE81 Mac15 main ZIP13414403530 SHA-256 `fa16f0dac32d1c1b1921aa7671f8027112ac4a33bcf32f5b15087c65882af1df`를 대조했다.
canonical15935/`41ccb8b27f8b0cbb3e0b1daa63c21535798ead9fba7b843751dd2b948fabe351` 및 SOURCE80과 같은 Mac15 runtime이 main 전후 동일이다.
main453/452 PASS/1 FAIL·기타0다. bootstrap-peer wrong/expected CDHash·last-close와 기존 producer/replay 반례는 통과했다.
새 discovery mode는 wrong CDHash 거절은 통과했지만 expected CDHash의 copy0/parse0/check0 뒤 discovery acknowledgement layout에서 실패했다.
require의 perror가 남긴 Attribute not found는 이 logical layout 실패의 OS 원인으로 해석하지 않는다.
SOURCE82 test-only controller는 같은 채널의 비-ack 메시지 header를 기록하고 mach_msg_destroy로 반납한 뒤 기대한 ack를 기다린다.
기대 id의 size/token/full tag/instance 단언은 그대로다. 이 대기는 원래5000ms의 절대 monotonic deadline 안에서만 실행하며
20초 controller ceiling·creator authentication·제품 gate를 바꾸지 않는다. 실제 header/수리 효과는 아직 NOT_RUN이다.
이것으로 bootstrap_check_in이나 libSystem의 원인을 확정하지 않는다.

SOURCE81 Mac15 shared ZIP13414034487 SHA-256 `31e8c774f3dcf9ed80269c9bfa2b11a229511281e15e77e9c5bb71987dc1e0d7`도 대조했다.
같은 canonical/runtime의 shared 전후 동일이며 main453/452 PASS/1 FAIL·generation3/3 PASS·기타0다.
단일 main failure는 위 discovery acknowledgement layout이다. generation 성공으로 해당 실패나 이전 termination unknown을 삭제하지 않는다.
SOURCE82 최종 production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source82-build.log`·`/tmp/oma-source82-package-isolation.log`·`/tmp/oma-source82-review.log`·`/tmp/oma-source82-architecture.log`다.
CI YAML/21개 bash run block도 문법 통과했다. 새 상속3건과 ack demultiplex는 actual Mac NOT_RUN이다.

### SOURCE83 context snapshot의 retained root 게시와 조회

SOURCE82 `c5c6bbcf79d9797a7f3be1c05a2f86e23357b4b4` / local checkpoint `ac1e2a768778a00666883102ce21f260be609a8e`,
Native42029186323을 발행했다. Mac15 main ZIP13415098178 SHA-256 `11d380615bd91da682e850eb75af8224072be6824dcd1a9357073ca632d86f33`,
shared ZIP13416465865 SHA-256 `34d1c7c225380387961a51268da4da24517df31bd4022fe37d9c45d5739a05c9`,
Intel shared ZIP13415833051 SHA-256 `b43b7ddc6623218da494800c0ab14ec36560d5b248776794222dd0a8151455f5`를 대조했다.
canonical15936/`0e9505333c5c15118862accfadb20bacd370fcbe1b37d73e013155c48328981a` 및 runtime15540/27이 각 전후 동일이다.
Mac15 runtime은 `960976880f770d2b119c71e4e58ef89ab4c9c009b93bbfbda89321b580a252aa`,
Intel runtime은 `b833c9409c9975c42399575acf749ad52cb37dfd416a5b3af0a5cc35eaf2e95b`다.
양쪽 main456/455 PASS/1 FAIL·generation3/3 PASS·기타0다. 실제 cooperation socket 상속3건은 모두 통과했다.
부모 copy 반환 뒤 ordinary/occupied FD4/explicit same FD의 실제 통신·마지막 close EOF·CID/journal 반납을 확인했다.
이것을 Society identity/current Host role의 인증으로 확대하지 않는다.

단일 failure는 discovery 후보다. Mac15는 비-ack id1073742030/size240/bits2147488018을 기록했고,
producer의 dynamic discovery candidate=5 뒤 controller의 ack receive가268451843으로 종료됐다.
ack demultiplex로 원래 형식 단언 실패와 실제 check-in 실패를 분리했지만 후보가 통과한 것은 아니다.
SOURCE83의 test-only 후속은 전달받은 normal bootstrap을 고정 producer 자신의 TASK_BOOTSTRAP_PORT와 bootstrap_port global에 복구한다.
이 right는 해당 C process의 libSystem 수명까지 보유하고 kernel task 종료로 반환한다. client에게는 tag/instance만 답한다.
이는 TASK_HOST_PORT/TASK_KERNEL_PORT 교체나 Actor의 bootstrap 복구가 아니며 실행 guard를 바꾸지 않는다.
수리 효과·원인 확정·headless/release 조건은 실제 Mac NOT_RUN이다. producer 양 SDK object compile은 exit0다.
원시는 `/tmp/oma-source83-producer-{arm,intel}.log`다.

SOURCE83은 context snapshot의 world/source directory를 한 번 보유하고 context/revisions·temporary lease·entry write·seal·
publish·current link의 효과를 같은 cursor 아래에서 수행한다. raw pathname은 labels와 default 초기 capture에만 사용한다.
기존 string entry도 같은 descriptor publication primitive를 호출한다. legacy existing replay는 staging parent가 없어도 유지한다.
기존 rename의 serialized/trusted-root 조건을 kernel의 새 no-replace 보장으로 승격하지 않는다.
readiness 조회도 같은 world root에서 current target과 revision bytes/modes를 검증하며 같은 canonical candidate/goal-only owner를 사용한다.
App은 알려진 world label만 resolver로 보유하고 native/logical shutdown 뒤 context/project cursor와 함께 반납한다.
새 모델 field/argv grammar·accepted manifest/OID/receipt·mode 정책·SQLite schema 변경은 없다.
전체 StateRoot capture·private commit-work/source fetch·Views/진단/다른 writer의 pathname 경로는 여전히 남아 있다.

SHA1/SHA256 × bound/on-demand에서 source/world 이름을 함께 교체한 뒤 원본 bytes·decision subtree·current link·
readiness·동일 revision replay와 replacement sentinels 보존을 확인했다.
초기 새 시험은 잘못된 facade method를 호출해4건 실패했고, 정정 후 본문은 통과했으나 readonly revision cleanup이4건 실패했다.
fixture는 기존 removeOwnedTree cleanup으로 고쳤다. 원시는 `/tmp/oma-source83-snapshot-directory.log`·`/tmp/oma-source83-context-after-adapter.log`다.
기존 cleanup failure 주입은 제거된 pathname reopen 대신 실제 removeOwnedTreeAt의 fsync에 EIO를 주입하도록 바꿨다.
primary EMFILE/cleanup EIO·원래 순서·lease 반환/후속 quiescence 단언은 유지했다.
초기42/41 PASS/1 FAIL은 `/tmp/oma-source83-context-initial.log`, 수정 후46/46은 `/tmp/oma-source83-context-final.log`다.
최종 context 수락/복구/preaccept/조립 포함133/133 PASS·기타0는 `/tmp/oma-source83-context-regression.log`에 있다.
시험은 checkout .git을 read-only bind했고 index diff는 비어 있다(`/tmp/oma-source83-checkout-index.patch`).
최종 production build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata는 exit0다. 최종 full architecture·transaction·durable boundary·document·spec inventory도 exit0다.
새 snapshot consumer와 bootstrap restore 후보의 actual Mac은 NOT_RUN이다.
세 gate OPEN·product BLOCKED·기본 실행 guard·death predicate·예산을 유지한다.

SOURCE80 Architecture42026054889 native-all ZIP13415621795 SHA-256 `6fe90c9ef5bd42e306ea9d65272b3c15e0b88b5f2931713c37e05fa5733c7353`를 대조했다.
같은 canonical15935/`4bd527ae72680e7352c1bc4628c10daabadd0a9a934e0ee8a385a5598cf32888`의 전후 동일,
빈 checkout index·sourceChanges[]·build/typecheck/구조 및 tests13 command code0·signal null을 확인했다.
전체 all4915/4915 PASS·fail/cancel/skip/todo0·errors[]다. 조립 fixture 정정 뒤 전체 Linux 통과 근거다.
SOURCE82 Darwin 상속 변경이나 SOURCE83 shared snapshot 변경의 전체 Linux 결과로 옮겨 적지 않는다.

SOURCE82 ARM26 main ZIP13416158065 SHA-256 `30fb3172617a4ea54e70500408da6407881418f40d48a6ccf112018f00e8ffdf`도 대조했다.
같은 canonical15936 및 runtime15540/27 `59fa0333ce2d789e7b71ddf399d57b723e2afdd6e907609f09a03b9d45bf4247`가 main 전후 동일이다.
main456/455 PASS/1 FAIL·기타0며 실제 cooperation socket3건은 모두 통과했다. 같은 discovery candidate=5·ack timeout을 보존했다.
Mac15 full ZIP13415663019 SHA-256 `dffe840dda0376aa69e92ea7488d88657d930d9683e65d79d5edd02f8b1e84ba`는
같은 source/input/runtime의 최종 동일 및27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.
main의 단일 실패를 package 성공으로 덮지 않는다.
SOURCE83 최종 production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source83-build-final.log`·`/tmp/oma-source83-package-isolation.log`·`/tmp/oma-source83-review.log`다.

SOURCE83의 첫 full architecture는 context-snapshot.ts/staged-tree.ts의 stale owned-state exemption2건을 거절했다.
경로 기반 fs 관측을 제거해 필요 없어진 기존 예외 두 항목을 삭제했다. 새 예외나 owner allowlist는 추가하지 않았다.
원시는 `/tmp/oma-source83-architecture-before-exemption-removal.log`다.
규칙 정리 뒤 production-loc-hashes.json bytes는 동일하고 dependency evidence를 다시 생성했다.
최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다(`/tmp/oma-source83-architecture-final.log`).
이는 구조 판정이며 새 snapshot/restore 후보의 actual Mac 실행을 대체하지 않는다.

### SOURCE84 retained world의 owner-bit 복구

SOURCE83 local checkpoint `0769502fa9e36f85e2cd2211f35acaa128a90f2f` / tree `c2c4b949c6da405fd5b1f6d15d1a3a229a0a404c`의
canonical15937/`7b972d78f2efc5073f4e567f763d80ac892e5a75b546b607e7fcd8103c9cd26e`에 위 검증을 결박했다.
별도 SOURCE83 CI는 발행하지 않았으며 다음 source에 포함한다.

추가 검토에서 retained world가 capture 뒤 mode000이 되면 새 publication이 owned-state repair를 빠뜨리는 반례를 확인했다.
같은 새4건에 root의 mode000을 주입한 이전 compiled source는4/4 EACCES로 실패했다(`/tmp/oma-source84-mode-before-build.log`).
SOURCE84는 publication의 같은 world FD에서 owner bits를 복구하고, App의 최초 world capture에는 기존 openOwnedDirectoryPath를 쓴다.
기존 pin/repair/reopen owner를 재사용하고 별도 pathname chmod/open fallback은 추가하지 않는다.
controlled Linux 조립에는 새 Storage directory port도 호출 시 거절하는 명시적 대역으로 등록했다.
수리 후 새4건+조립18건22/22 PASS는 `/tmp/oma-source84-mode-after-build.log`, context/preaccept/수락/복구 포함133/133 PASS·기타0는
`/tmp/oma-source84-context-regression.log`에 있다. 새 반례는 원본/root 교체·sentinel 보존·owner bits·revision replay·readiness를 함께 검증한다.
모든 regression은 checkout .git을 read-only bind했다.

다음 Native CI의 공통 matrix는 목표 Mac26 ARM·Intel26·Mac15·Linux 순으로 실행한다.
실행 OS/시험 범위·기존 common max-parallel2·각 timeout은 유지하며 시험을 생략하지 않는다.
최종 production build는 exit0다(`/tmp/oma-source84-build.log`). mode 수정 뒤 fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata·full architecture·transaction·durable boundary·document·spec inventory는 exit0다.
새 snapshot consumer/mode repair와 bootstrap restore 후보의 actual Mac은 아직 NOT_RUN이다.
Society 전체 lease·전체 StateRoot capture/다른 writer·제품 Runner/Worker/Pi·복구/release와 세 gate는 여전히 미완료다.

SOURCE84 최종 production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source84-build.log`·`/tmp/oma-source84-package-isolation.log`·`/tmp/oma-source84-review.log`·`/tmp/oma-source84-architecture.log`다.
CI YAML/21개 bash block의 문법은 통과했다. owned-state 예외 두 개는 삭제된 상태이며 새 예외를 추가하지 않았다.
새 snapshot/mode repair·bootstrap restore 후보의 actual Mac은 아직 NOT_RUN이다.

### SOURCE85 정상 bootstrap 상속과 직접 socketpair 전달 후보

SOURCE84 발행 source `834f6ddbabc9996f8dcf82e336f4495235f1ac69` / tree `3750281372fed35bd3a99f9b2f62de686a353ccb`,
Native42035564086·Architecture42035564102의 canonical15937/`041547c3b8940f5711140cd2e302f39d3c57c8594227f657149d9652a3674ebe`를 확인했다.
ARM26 main ZIP13417323949 SHA-256 `8b804b335819aeb5e2d328f21295e76f198949aa276ba22cb48e8d911457d2f5` 및
shared ZIP13418253114 SHA-256 `d1c8ae247cdfe1b9a9913e883ce6a94f6faaf1c07fe19b7fbd54d17df05d3d20`를 대조했다.
같은 source/input 및 runtime `e61fab460bf03009ba4cc0acda9a0aa6662814f2c22a397491902c4f7d522225`의 main/shared 전후 동일을 확인했다.
snapshot의 SHA1/SHA256 × bound/on-demand4건(원본·목적지 교체, mode000, replay/readiness)은 모두 통과했다.
generation3/3 PASS·기타0다. main은460/459 PASS/1 FAIL·기타0다.
실패는 discovery candidate=5·ack receive268451843으로 이전과 동일하다. producer가 task/global bootstrap을 되돌리는 수정도 해결하지 못했다.
관측된 non-ack header1073742030/240bytes의 내부 원인을 확정하지 않는다.
Intel26 main ZIP13418930953 SHA-256 `48cb8a5648b42459de4858daa0dc0f5580b441cdf04cac4293c7574232531d6f`도 대조했다.
같은 canonical/input 및 runtime `615cab3164a9ea06d4d0844c3642c83568a11c14fec8d35c9994833cf4df0c93`의 main 전후 동일,
main460/459 PASS/1 FAIL·기타0를 확인했다. Mac15 및 나머지 검증은 이 기록 시점에 미판독이다.

다음 시험 후보는 discovery 모드에서 정상 task bootstrap을 처음부터 상속한다.
직접 생성한 unreaped child의 suspended image/audit token/CDHash를 먼저 검증하는 조건은 유지한다.
최초 fresh socket은 private socketpair의 SCM_RIGHTS로 전달하고, 부모는 받은 FD의 실제 socket/generation을 비교한다.
이 첫 전달의 provenance는 부모만 가진 socketpair와 직접 검증한 child이며 Mach trailer라고 표현하지 않는다.
별도 bootstrap lookup 후 nonce 응답에는 여전히 실제 kernel audit trailer·전체 tag·socket/generation 검증을 요구한다.
기존 bootstrap-peer 모드와 잘못된 CDHash의 release 전 거절·정상 creator가 살아 있는 동안의 last-close 검증도 유지한다.
실패한 bootstrap restore 경로를 반복하지 않으며 root/privileged entitlement·새 OS floor를 추가하지 않는다.
이는 test fixture 변경뿐이다. production Society backend·guard·death predicate·기존 timeout은 유지한다.
producer의 ARM/Intel SDK object compile은 exit0다(`/tmp/oma-source85-producer-arm.log`·`/tmp/oma-source85-producer-intel.log`).
Linux fixture2건은 명시적 NOT_RUN이며 실제 Darwin 성공 근거가 아니다(`/tmp/oma-source85-candidate-linux.log`).
새 직접 전달/discovery 후보의 actual Mac은 NOT_RUN이다. 세 gate OPEN·제품 BLOCKED와 남은 제품 작업을 유지한다.

SOURCE84 ARM26 full ZIP13418523600 SHA-256 `032702a324c4a99a706451da1b6905f02660c7d5f48cf8f870ea7f26344aecf5`를 대조했다.
같은 source/canonical/runtime의 최종 전후 동일과27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.
main의 discovery1 FAIL은 그대로 남는다. ARM26 gate ZIP13418308618 SHA-256
`07347f353705489d1eecc62ec4a78684bc5563f44f1a1fac1d8991ce430ff2d3`는120 executed/111 OBSERVED·SETUP_FAILED·product BLOCKED다.
이 gate 결과를 main/package 성공이나 제품 gate 통과로 바꾸지 않는다.

### SOURCE86 gate fixture의 실제 canonical FD 전달 정정

SOURCE84 gate의 git-setup-candidate3건은 `candidate setup failed: cwd requires a held directory`로 실패했다.
trusted candidate entry는 Darwin slot7에서 canonical project directory를 받지만, 독립 gate fixture가 이 자리에 `/dev/null`을 전달했다.
fixture는 실제 canonical project를 openDirectory로 열어 slot7로 넘기고 direct child 종료 뒤 반환하도록 정정했다.
status6·release8·lease9 및 private channel identity/exec 전 거절·정확한 checkout·canonical write denial의 기존 assertion은 유지한다.
workspace FD나 임의 pathname cwd로 대체하지 않는다. production entry/recipe는 변경하지 않았다.
worker-bootstrap/tools6건은 실제 Pi의 client-preload가 기존 G-PROCESS/G-FILES/G-AUTH guard에서 거절한 결과다.
그 guard를 제거하거나 이 관측을 Pi 실행 성공으로 바꾸지 않는다.
SOURCE85는 이 입력의 부모로 포함하며 별도 CI를 발행하지 않는다. 새 직접 전달/discovery와 정정된 gate fixture의 actual Mac은 NOT_RUN이다.

### SOURCE87 world navigation도 같은 retained directory 사용

SOURCE84 Mac15 main ZIP13419450516 SHA-256 `81fdd28a9c0a98e0e8b00a15587659cb4d4a4b6cc042004d6bddcfcf03f4cb11`를 대조했다.
같은 source/canonical15937 및 runtime15540/27 `59d7bac89f01bede77cf2c205c3c6aff04334eb96073c2383a6f1b93516d9ef8`가 main 전후 동일이다.
main460/455 PASS/5 FAIL·기타0다. discovery1건 외에 새 snapshot4건이 sealed staging의 renameAt에서 EACCES로 실패했다.
ARM26·Intel26에서 통과한 snapshot 근거를 Mac15로 옮겨 적지 않는다. 이 차이는 미해결이며 mode/게시 계약이나 OS floor를 바꾸지 않았다.
SOURCE84 Intel shared ZIP13418409054 SHA-256 `33d342fbe9cf3eca7325728348375411a512af93e3ffba71115f33542f06de8d`,
full ZIP13419216083 SHA-256 `9a7f26be25e2cb562ea61f0f16acd27b25300bc67c4795dc430cf1511f3a98b1`도 대조했다.
같은 canonical/runtime의 전후 동일이나 generation001은 기존240000ms timeout,3건 중2 PASS/1 cancelled다.
전체 scope 종료 증거로 승격하지 않는다. full artifact의 package rows는0개로 설치 검사는 완료되지 않았다.

다음 production 변경은 world의 agents.tsv/topics.tsv/START.md/Principal mail navigation4개를 같은 directory FD로 게시한다.
ViewsModule은 trusted control에서 빌린 world FD를 반환하지 않으며, default는 한 번 열어 네 게시 뒤 반환한다.
Broker는 context snapshot에 주는 기존 world cache/resolver를 Views에도 공유한다. missing-root 생성 후에도 같은 resolver로 capture한다.
mode000 복구는 그 held inode에서만 하고, 유효하지 않은 capability는 파일 게시 전에 거절한다.
Storage의 replaceDerivedFileAt은 기존 replaceDerivedFile과 같은 leased temporary/collector/rename/fsync/cleanup/세 번의 bounded restart를 공유한다.
새 unleased temporary나 별도 pathname replacement 구현을 사용하지 않는다. 기존 path wrapper도 같은 FD owner에 위임한다.
새 world3건+snapshot/Views/status/조립/게시 중단·불확실 rename·재시도·collector race 회귀73/73 PASS·기타0다.
원시는 `/tmp/oma-source87-publication-regression.log`이며 checkout .git을 read-only bind했다.
최초 선택 회귀42/42도 통과했다(`/tmp/oma-source87-world-regression.log`).
전체 StateRoot 최초 capture·status/mail notice·collaboration/diagnostic 등 다른 writer까지 완료했다는 근거는 아니다.
세 gate OPEN·제품 BLOCKED·실행 guard·현재 권한/receipt/recovery 정책을 유지한다.
새 world control의 actual Mac은 NOT_RUN이다.

SOURCE86 발행 source `95aa07b51d65f7cfb3e70920e50fc768bd16c1e2` / tree `faf6170ebf900f308ae3bdc6034400efd85b6b35`,
Native42037189141·Architecture42037189169의 ARM26 main ZIP13419576248 SHA-256
`787527d1cd7d4f061b716d45856486feb7912621749c8a800f39b339dd13c3bb`를 대조했다.
canonical15937/`dbfffb1ef8ece91f0d8efd6eba39bfb445ac4e013725a8f65b6827bda8b1a951` 및
runtime15540/27 `e61fab460bf03009ba4cc0acda9a0aa6662814f2c22a397491902c4f7d522225`가 main 전후 동일이다.
main460/460 PASS·fail/cancel/skip/todo0다. 기존 bootstrap-peer와 정상 bootstrap/socketpair discovery의 wrong-CDHash 거절 및 올바른 CDHash 양성이 모두 통과했다.
직접 생성/검증한 fixed producer의 fresh FD 전달, 별도 lookup/nonce의 actual kernel sender, 동일 full tag/socket/generation,
creator-live last-close와 unreaped child 반환까지의 한정된 근거다. Host crash·포트 충돌·이름 교체·전체 Society takeover는 증명하지 않았다.
production Society lease 채택 및 제품 gate 통과로 승격하지 않는다. 새 world control 및 다른 OS 결과로도 옮겨 적지 않는다.

SOURCE86 Intel26 main ZIP13419526523 SHA-256 `46903a89eca397b14c77347f8e0ac780698e4f41522d599882da24117ac06638`도 대조했다.
같은 canonical 및 runtime15540/27 `615cab3164a9ea06d4d0844c3642c83568a11c14fec8d35c9994833cf4df0c93`의 main 전후 동일,
main460/460 PASS·기타0다. ARM26 gate ZIP13420151206 SHA-256
`dde94fe2ceb08b12dd91b3fc4fb3b1aab0cf9ccbf990268dffc67de872ef85db`는 같은 source/input 전후 동일이며120 executed/114 OBSERVED다.
정정한 Git candidate3건은 모두 OBSERVED다. 남은6건은 Worker/Pi guard의 SETUP_FAILED이며 product BLOCKED를 유지한다.

SOURCE87 최종 production build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata는 exit0다.
production14398, review CHANGED_WITHOUT_ORACLE30 / NOT_REVIEWED14368 / REMOVED220이다.
원시는 `/tmp/oma-source87-build-final.log`·`/tmp/oma-source87-package-isolation.log`·`/tmp/oma-source87-review.log`다.
첫 full architecture는 새 replaceDerivedFileAt을 durable primitive로 인식하지 못해 기존 ViewsModule.refreshWorld 등록을 stale로 거절했다.
실제 새 shared primitive를 extractor의 file-publication 목록에 등록하고 alias 검사를 양 API 모두에 적용했다.
기존 durable boundary 등록·injection 조건·정확한 owner assertion을 삭제하거나 예외 처리하지 않았다.
원시는 `/tmp/oma-source87-architecture.log`이며 정정 뒤 boundary4/4 PASS는 `/tmp/oma-source87-boundary-regression-final.log`다.
workflow YAML 및 기존21개 bash block 문법은 통과했다.
정정 후 full architecture·transaction·durable boundary·document·spec inventory도 exit0다(`/tmp/oma-source87-architecture-final.log`).

### SOURCE88 snapshot의 이동과 최종 seal을 구분

SOURCE87 local checkpoint `fee7d25a85a762a479b9a8778b7233cb96ec6d62` / tree `13b396137febe91c675b6ea41776eccea49b1d45`의
canonical15938/`b228805eff452513f3315e56baecab3b097049b611e950ba420381b20234a842`에 위 local 검증을 결박했다.
별도 SOURCE87 CI는 발행하지 않으며 다음 source에 포함한다.

Mac15 snapshot4건의 실제 rename EACCES를 보존한 뒤, owned temporary의 이동 권한과 완료된 revision mode를 분리했다.
Apple [XNU rename authorization](https://github.com/apple-oss-distributions/xnu/blob/xnu-11417.140.69/bsd/vfs/vfs_subr.c)은
directory source에 DELETE와 ADD_SUBDIRECTORY를 함께 확인한다. 이 코드는 거절의 설명 후보이며 Mac26과의 모든 실행 차이를 입증하지는 않는다.
새 temporary는 전체 bytes/목록·nlink·파일0644·decisions0555를 먼저 검증/flush하되 root만0755로 유지한다.
rename 뒤 같은 inode의 destination에서 bytes를 다시 검증하고 root0555를 확정/flush한 다음 parent durability barrier를 완료한다.
current link는 이 완료 이후에만 게시한다. 기본 verifyContextRevision(...,true)의 공개 계약은 여전히 최종 root0555만 허용한다.
임시0755 상태를 완료 revision이나 receipt로 인정하지 않는다. 디스크 형식·최종 modes·accepted plan/OID·source bytes는 바꾸지 않는다.
게시 후 seal 전 중단은 canonical 이름의 pending bytes를 남길 수 있다. 재개는 같은 inode/bytes를 검증해 seal을 마치며,
변조된 bytes는 거절하고 덮어쓰거나 current를 게시하지 않는다. 새 fault2건이 두 경우를 검증한다.
shared staged publisher는 destination 검증/metadata completion 뒤 부모들을 flush하도록 정렬했다.
전체 publication/중단/복구/재시도/Views/status/조립/snapshot 회귀75/75 PASS·기타0다(`/tmp/oma-source88-publication-regression.log`).
checkout .git은 read-only bind했으며 index diff는 비어 있다(`/tmp/oma-source88-checkout-index.patch`).
Mac15 기존4건의 성공을 미리 선언하지 않는다. 새 이동/seal의 actual Mac은 NOT_RUN이다.
Society 전체 단일 소유권·최초 StateRoot/나머지 writer·실제 Worker/Pi·복구/release 및 세 gate OPEN·제품 BLOCKED는 유지한다.

SOURCE88 context 수락/복구/preaccept 전체94/94 PASS·기타0도 확인했다(`/tmp/oma-source88-context-regression.log`).
SOURCE86 ARM shared ZIP13418659409 SHA-256 `72466a9abd82ea89f763d169df9e1d1d47856eaf3436f3e1476e14f8f63b2cc7`,
Intel shared ZIP13420485947 SHA-256 `f27a4b2a440b460a17cb220af5ded41d67850ae2c4cb1057e5334ec802a3f4f6`를 대조했다.
각각 위와 같은 SOURCE86 canonical/runtime가 shared 전후 동일이며 generation3/3 PASS·기타0다.
SOURCE84 Intel240초 timeout 및 기존 intermittent termination-unknown의 실제 원인 수리 근거로 옮겨 적지 않는다.
SOURCE86 ARM full ZIP13419383069 SHA-256 `ec4ca3259ba896443a864fcb4798a9aa1db3e1f1601c11636ff13b2942458ecb`도 대조했다.
같은 source/input/runtime의 최종 전후 동일, main460/460·generation3/3·27/27 packed installation(App 실제 installed runtime 포함)을 확인했다.
한정된 common-runtime 결과이며 별도 product gate의 Worker/Pi6건 실패와 나머지 구현 공백은 유지한다.
SOURCE86 Mac15 gate ZIP13420022355 SHA-256 `5f9a8a0e8217d097726ba8fad90e3df237b9e9f9bd57338bd057316c2ba42faa`도 대조했다.
같은 source/input 전후 동일,120 executed/114 OBSERVED다. Git candidate3건도 OBSERVED이며 Worker/Pi6건은 기존 guard의 SETUP_FAILED다.

SOURCE88 최종 production build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata는 exit0다.
production14398, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14366 / REMOVED220이다.
원시는 `/tmp/oma-source88-build-final.log`·`/tmp/oma-source88-package-isolation.log`·`/tmp/oma-source88-review.log`다.
새 snapshot의 actual Mac은 아직 NOT_RUN이며 SOURCE86의 main/package 결과로 대체하지 않는다.
최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다(`/tmp/oma-source88-architecture.log`).
검증 중 기록을 추가하기 전의 provisional binding013은 예상대로 digest 차이를 거절했다.
마지막 기록 bytes를 다시 결박한 뒤013을 통과시킨다. 이 구조 identity 갱신은 runtime 성공을 생성하지 않는다.

### SOURCE89 Store와 status/mail projection의 retained state root 공유

SOURCE88 발행 source `26cf8cb971e3e71e2ba42d2e922fd9d2c742477c` / tree `eacdec5e92957613844c15593d2fe7943988a181`,
Native42040455587·Architecture42040455661의 canonical15938/`e1c3a625e65086604695a76932d8280e42262770662b090670f793fbfa58fabf`를 확인했다.
ARM26 main ZIP13421041793 SHA-256 `735de4f67de2fa350b10352f1d5b53630f4ddcf13ddca842654adbb2e0974fc4`,
shared ZIP13423020168 SHA-256 `9366454e5af9a74447b580f4833696551cd0200afa8b9eee88ed7877bdf8c023`를 대조했다.
같은 source/input 및 runtime15540/27 `ba71fe65e25dcd12b79dcc9d24b6f8fae0178d7833e6d3f44d62282c15f40fee`가 main/shared 전후 동일이다.
main463/462 PASS/1 FAIL·기타0며 world3건과 snapshot4건은 모두 통과했다. generation3/3 PASS·기타0다.
실패는 native-task-name-source의 Host death case003이며 RUN_TERMINATION_UNKNOWN/populated scope termination failed다.
원래 test-process 밖의 error serialization에서 더 안쪽 AggregateError가 손실될 수 있어 다음 fixture는 원래 프로세스에서 full inspect 문자열도 남긴다.
이는 진단 변경이다. 종료 predicate·kill/retry·45초 fixture budget·journal retention을 바꾸거나 unknown을 사망으로 바꾸지 않는다.
Intel26 main ZIP13423000239 SHA-256 `62aac9ae9c4a878500fe6cb0ed082b4858b1a29dbdfb7116e8a7cc228c5c011f`도 대조했다.
같은 source/input 및 runtime15540/27 `12fe7fe46a643a05d56b2830e54b906b03f3a6a6b2d301b28285d621c47f00b5`의 main 전후 동일,
main463/463 PASS·기타0다. ARM의 실패를 Intel 통과로 덮지 않으며 Mac15의 새 seal 성공은 아직 미판독이다.

큰 private file에 fclonefileat을 적용하는 prototype은 채택하지 않았다.
이 API는 생성된 destination FD를 원자적으로 반환하지 않아 clone과 후속 open 사이의 entry 교체를 배제하지 못한다.
새 inode의 nlink1/UID/원본과 다름만으로는 그 inode가 방금 만든 clone인지 증명하지 못하며, UF_IMMUTABLE을 지우는 metadata 효과에는 부족하다.
이 판단은 코드 검토이며 실제 OS 반례를 새로 실행했다고 기록하지 않는다. private prototype은 `/tmp/oma-source89-clone-provenance-rejected.patch`에 보존하고 production3개 파일을 해당 HEAD bytes로 복원했다.
복원 build는 exit0다(`/tmp/oma-source89-restore-build.log`). 기존 검증 copy·copy cursor·generation budget은 유지한다.

새 production은 Broker가 Store 개설 시 잡은 state directory를 lifetime shutdown/Store close 뒤까지 보유하고,
Views status.json 및 mail-notices.json 게시에 같은 FD를 빌려준다. 권한 복구는 그 inode에서만 한다.
publishedMailEntries도 같은 borrowed root의 beneath directory와 statAt을 쓰며, 기본 호출도 한 번 연 root에서 관측한다.
정렬/중복 제거/행 제한·ledger requester provenance는 유지한다. mail 경로가 symlink/관측 실패이면 이전 notice를 빈 성공 목록으로 덮지 않는다.
root 교체·mode000·원본 projection 및 replacement sentinel 보존·unsafe mail traversal·잘못된 capability2건을 추가했다.
status/Views/mail/조립 포함33/33 PASS·기타0는 `/tmp/oma-source89-state-view-regression.log`다.
경로 fs 관측이 사라진 published-mail.ts의 기존 owned-state exemption은 삭제했다. 새 예외나 allowlist를 추가하지 않았다.
최초 StateRoot capture/다른 writer·Human reader의 전체 root 결박·전체 G-FILES 통과를 주장하지 않는다.

SOURCE84 Architecture42035564102 native-all ZIP13420780702 SHA-256 `46f3a618e5c6b7051bec96fdf89fea02bbbc757855c16afec89dc72f57463bb0`도 대조했다.
같은 source/canonical15937의 전후 동일·빈 checkout index·sourceChanges[]와 build/typecheck/구조12 command code0·signal null이다.
all4922/4921 PASS/1 FAIL·기타0다. 실패는 same-uid-namespace004의 legacy pathname verifier가 destination 교체를 거절하지 않은 회귀다.
새 path adapter는 staging pathname verifier를 먼저 실행하고 publication 부모를 그 뒤 취득하는 기존 계약을 복구했다.
FD verifier를 소비하는 native snapshot은 publishStagedDirectoryAt을 직접 사용한다. 경로 verifier를 held FD 검증으로 간주하지 않는다.
기존 거절 assertion과 staging/attack directory 보존 assertion을 유지했다. legacy retry 및 status/mail/조립 포함42/42 PASS·기타0다(`/tmp/oma-source89-compatibility-regression.log`).
checkout .git은 read-only bind했다. 모든 path 기반 workspace 소비자의 G-FILES 완료나 SOURCE89 전체 Linux 성공으로 확대하지 않는다.
이 실제 회귀 수정 뒤 최종 production 입력으로 build/metadata/독립 설치를 다시 수행한다. 앞선 진행 중 검사는 최종 입력 근거로 사용하지 않는다.
세 gate OPEN·제품 BLOCKED·Society 전체 lease/제품 Runner/Worker/Pi/복구/release의 남은 작업을 유지한다.

SOURCE88 Mac15 main ZIP13423411568 SHA-256 `6598240763d510226220f280fe2df5d9bd65330222c64b331ba9a14d3241c6e2`를 대조했다.
같은 source/canonical 및 runtime15540/27 `ac7df51d94c120582610054680de5cba93adaefbb463c3dcc1d3fde71a292987`가 main 전후 동일이다.
main463/463 PASS·기타0다. 실제 snapshot4건의 이전 rename EACCES를 새 이동/seal 순서가 해결했고, world3건과 direct discovery도 통과했다.
final root0555/파일0644·원본 source/world 교체·mode000·동일 revision replay/readiness assertion을 완화하지 않았다.
SOURCE88 Intel shared ZIP13423395903 SHA-256 `2ade5a22c15531ddd91da92311cd2ecffae2422148d2f80e4a39296434d72aac`도 대조했다.
같은 canonical/runtime의 shared 전후 동일 및 generation3/3 PASS·기타0다.
ARM full ZIP13422641515 SHA-256 `b9d3b8861079b147d6beb2b292ef6d51dc685d53f172e4aaff2d8b369146361e`는
같은 source/input/runtime의 최종 전후 동일과27/27 packed installation(App 실제 installed runtime 포함)을 확인했다. Host death의 main1 FAIL은 그대로 보존한다.

SOURCE89 compatibility 수정 뒤 전체 publication/중단/복구/Views/mail/조립/namespace 거절84/84 PASS·기타0다(`/tmp/oma-source89-publication-regression-final.log`).
별도 native diagnostics Linux8건은 Darwin 동작을 실행하지 않았으며 실제 Mac 근거가 아니다(`/tmp/oma-source89-native-diagnostics-linux.log`).
기존 generation fixture는 다음 실제 실행에서만 fstat/read/write/fsync/fchmod의 횟수·시간/bytes를 원본 함수 호출 그대로 집계한다.
측정 뒤 원래 함수를 복구하며 원래240초 timeout·copy/hash/fsync/immutable owner를 유지한다. 지연 원인이나 성능 개선을 미리 주장하지 않는다.
CI YAML 및21개 bash block의 문법은 통과했다.

SOURCE88 Mac15 shared ZIP13423171940 SHA-256 `94b0cec600bc442998583326e7199583f5d11a8450c54cf25f6065371e747b2c`도 대조했다.
같은 source/input/runtime의 shared 전후 동일 및 generation3/3 PASS·기타0다. ARM main의 종료 불확정은 그대로 남아 있다.
SOURCE89 compatibility 수정 뒤 최종 build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata는 exit0다.
production14398, review CHANGED_WITHOUT_ORACLE31 / NOT_REVIEWED14367 / REMOVED220이다.
원시는 `/tmp/oma-source89-build-final2.log`·`/tmp/oma-source89-package-isolation-final.log`·`/tmp/oma-source89-review-final.log`다.
앞선 수정 진행 중의 metadata/packed 실행은 이 최종 입력 검증으로 간주하지 않았다.
최종 full architecture·transaction·durable boundary·document·spec inventory도 exit0다(`/tmp/oma-source89-architecture-final.log`).
이 변경은 local checkpoint로 보존하며, 새 state projection/legacy adapter의 actual Mac은 아직 NOT_RUN이다.

### SOURCE90 제품 Society lease의 Darwin adapter

사용자는 주변 수정·실험·CI 반복에도 제품 차단점이 그대로인 진행을 지적했다.
SOURCE89는 local checkpoint `4ae60f57c5688a64a316f4560f7e2f7a4f014516` / tree `eba6c10b0c868cde564b76bc82eab8c03d3eff10`,
canonical15939/`2507e3c58c3fef269f3e0133e6a09b01d07897300191f778fb8d6cbbab57913a`로 보존했다.
별도 SOURCE89 CI는 발행하지 않는다. 이후 작업은 Society 단일 소유권의 구현·Host 사망/상속 마지막 close 검증에 한정한다.

새 adapter를 shared tryHoldSociety/inheritedFence에 연결했다. Linux name/hold/recognition은 기존 경로를 유지한다.
Native는 고정 creator/control/SCM bridge만 소유하고 subprocess는 기존 Process owner의 trusted callback을 쓴다.
초기 raw child_process import는 architecture가 거절했다(`/tmp/oma-source90-architecture-initial.log`). 새 예외 등록 없이 Process owner로 이관했다.
SIGTERM을 받는 짧은 controller는 자신이 만든 unreaped child만 제어한다. spawn/PID 기록 사이와 wait/reap 중에는 cleanup signal을 막으며,
해제 후에는 PID reuse 전에 owner 변수를 비운다. timeout의 기본 SIGKILL은 유지하고 이 trusted setup만 SIGTERM으로 자신의 stopped child를 정리한다.

creator는 no-reuse wildcard socket을 새로 만들고 outbound 제한/shutdown/disconnect를 적용한다. 기존 FD를 adopt하거나 다른 program을 실행하지 않는다.
control은 START_SUSPENDED 상태의 실제 child token/고정 CodeDirectory를 검증한 후에만 release한다.
creator는 hardened runtime/no entitlement로 서명하며 control에는 그 build의 producer CodeDirectory를 compile-time 상수로 넣는다.
private socketpair로 최초 fence와 별도 owner endpoint만 인계한다. 공개 bootstrap discovery는 FD를 주지 않는다.
fresh nonce/kernel audit sender·고정 creator image·전체 identity·actual socket/generation을 함께 확인한다.
creator는 한 funded holder로 socket copy를 보유한다. 정상 release는 그 copy 반환 acknowledgement 뒤 완료하고,
Host EOF에는 자신의 copy를 반환한다. 나머지 상속 copy가 살아 있으면 kernel bind는 계속 점유돼야 한다.
creator 사망으로 discovery가 사라진 점유 socket은 unknown/unavailable로 거절하며 새 claim을 허가하지 않는다.

전체 identity는 기존 UID/stateRoot SHA-256이다. 1024..49151 port index는 유한한 exclusion 자원이며 전체 identity 자체가 아니다.
서로 다른 full identity가 같은 index를 쓰거나 비제품 socket이 점유하면 unavailable로 거절한다. 다른 Society의 owner/busy로 오인하거나 대체 port로 우회하지 않는다.
이 제약은 spec에 명시했고 충돌 반례도 시험한다. 256-bit kernel namespace와 같은 자원/가용성 의미라고 주장하지 않는다.

제품 shared API의 second fresh Host 거절/쓰기 전 stateRoot 부재, Host SIGKILL 후 child FD 유지/마지막 반환,
creator 사망 후 점유 유지, full identity 충돌, shared socket의 bind/connect/reuse/restriction 변조5건을 추가했다.
아직 모두 actual Mac NOT_RUN이다. controlled child 시험은 실제 Broker/Engine 및 모든 paid scope의 통합 사망 검증을 대체하지 않는다.
프로세스별 협조 FD만으로 전체 scope 사망을 선언하거나 G-PROCESS/G-FILES/G-AUTH guard를 제거하지 않는다.
최초 Linux lease/core31건은 pass였으나 Darwin 분기는 명시적 NOT_RUN이다(`/tmp/oma-source90-lease-linux-initial.log`).
callback 이관 후 TypeScript는 nullable cleanup FD 두 곳을 거절했고, 실제 owned channel 상수를 반환하도록 수정했다.
이전 build의 core40건을 최종 source 근거로 사용하지 않는다. 수정 build/architecture gate는 exit0다(`/tmp/oma-source90-build-core-fixed.log`·`/tmp/oma-source90-architecture-core-fixed.log`).
수정 뒤 Linux lease/runner/stdin44/44 PASS·기타0는 `/tmp/oma-source90-core-regression-fixed.log`다. 새 mutation case는 이 결과 이후 추가했다.
SDK의 producer/bridge ARM/Intel object compile과 mutation fixture ARM object compile은 syntax/mechanic 준비일 뿐 actual Mac signing/IPC/ownership 근거가 아니다.
CoreFoundation/Security controller의 실제 compile·전체 새로운 lease 시험은 Mac CI에서 확인한다.
세 gate OPEN·제품 BLOCKED·나머지 제품 차단점은 유지한다.

SOURCE90 최종 Linux lease/runner/stdin 회귀는45/45 PASS·기타0다(`/tmp/oma-source90-core-regression-final.log`).
새5건의 Darwin 동작은 명시적 NOT_RUN이며 Linux pass 수를 Mac 소유권 근거로 쓰지 않는다.
ARM/Intel producer·bridge SDK object compile도 통과했다. 전체 module 검사는 build script의 내부 dist import를 거절했고,
같은 기존 공개 `@oma/native/darwin-macho-image` entry로 수정했다. 예외 추가 없이 module 검사를 다시 통과했다.

공개 import 수정 뒤 build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata는 exit0다.
production14403, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14371 / REMOVED220이다.
원시는 `/tmp/oma-source90-build-final.log`·`/tmp/oma-source90-package-isolation-frozen.log`·`/tmp/oma-source90-review-final.log`다.
CI는 새로운 Society5건을 broad runtime보다 먼저 한 번 실행하고, 동일 source/input/runtime의 전후 binding과 결과를 즉시 별도 artifact로 보존한다.
이 순서 변경은 timeout/관측 조건/실패 판정을 바꾸지 않는다. 실제 Mac signing/ownership 결과는 아직 NOT_RUN이다.

최종 full architecture·transaction·durable boundary·document·spec inventory는 exit0다(`/tmp/oma-source90-architecture-final.log`).
검증 입력 binding013도1/1 PASS다. source별 Mac 결과가 도착하기 전까지 실제 소유권 채택 판정을 올리지 않는다.

### SOURCE90 actual Intel 실패와 SOURCE91 원인 귀속

SOURCE90 `7556307466315ed4f8a2237666ac472ca9279f54`, Native42056141460·Architecture42056141567을 발행했다.
canonical15946/`ca711c17251832eb029a307c4026398173b48412a1a61ecefdd7b193a352c732`다.
Intel Society ZIP13428513316 SHA-256 `3217925e02d7822108113a155408c52312851fe32328a9d210f63a1d37846382`를 다운로드·대조했다.
동일 source/input/runtime의 Society 전후 동일을 확인했다. runtime15549/27 `5d5d2ccc65a9a79744a6f0b683bf4af61b89d5922fc27d162c857513a4308646`다.
실제5건은1 PASS /4 FAIL·기타0다. socket 변조005만 통과했다. 001/004는 정상 release의 creator acknowledgement에서 실패했다.
기존 합친 write/read/byte 검사에 표시된 errno는 선행 호출 값일 수 있어 `Operation not permitted`만으로 실패 syscall을 단정하지 않는다.
002/003은 같은 resource coalition의 controlled child/creator를 전체 scope pin으로 잡으려다 setup에서 거절됐다. Host 사망/creator 사망은 아직 qualified가 아니다.

SOURCE91은 이 시험에 기존 process event watch를 사용한다. creator는 watch 등록 뒤 nonce/fixed-image로 다시 확인한 동일 kernel audit token으로만 종료한다.
제품의 distinct-coalition scope pin/종료 판정은 유지한다. 정상 반환 실패는 request/acknowledgement의 read count·first byte·fresh errno를 분리하며,
resident creator의 setup/return 오류를 이미 소유한 private channel로 전달해 stderr detach 뒤에도 원인을 보존한다.
반환 실패가 고쳐졌다고 주장하지 않으며 실제 SOURCE91 결과는 NOT_RUN이다. 세 gate OPEN·제품 BLOCKED다.

SOURCE91 수정 뒤 Linux lease/runner/stdin45/45 PASS·기타0다(`/tmp/oma-source91-core-regression-final.log`).
Darwin 동작은 여기서 NOT_RUN이다. 수정 producer의 SDK ARM/Intel object compile·CI YAML/23개 bash block 문법도 통과했다.
CI는 Society 실패로 broad suite가 실행되지 않은 경우 cold generation/독립 설치를 추가 실행하지 않는다.
Society 실패 자체와 전후 입력은 즉시 보존하며 성공으로 바꾸지 않는다. broad suite가 실행된 뒤 실패하면 원래 generation 검증을 유지한다.

SOURCE91 build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata·full architecture/transaction/durable boundary/document/spec는 exit0다.
production14403, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14371 / REMOVED220이다.
원시는 `/tmp/oma-source91-build-final.log`·`/tmp/oma-source91-package-isolation-final.log`·`/tmp/oma-source91-review-final.log`·`/tmp/oma-source91-architecture-final.log`다.

### SOURCE91 actual Intel3/5와 SOURCE92 정상 반환 순서

SOURCE91 `949fe64044dc364915f87dc3a7a7470a9fd9601f`, Native42058618115·Architecture42058618116이다.
canonical15946/`329326c55159824099face0d234ffa11c989fe6281bbe6ee9882e39e86c668e4`다.
Intel Society ZIP13431560287 SHA-256 `7902e4ba5d42d8713dcd7f4ee2c5dce63fc8818212ea809df7b732c80740c324`를 대조했다.
동일 source/input/runtime Society 전후 동일, runtime15549/27 `10217a686ef89059a1b606f6b8be89ab3d2db1ee1f0b78f00afba088b9ba9ade`다.
5건 중3 PASS /2 FAIL·기타0다. Host SIGKILL 뒤 controlled child의 점유 유지/마지막 반환002,
creator 강제 종료 뒤 아직 열린 socket의 unknown 거절003, shared socket 변조005가 통과했다.
이는 실제 Broker/Engine의 전체 paid scope나 Actor의 FD4 close/helper 동시 사망 인수가 아니다.
001/004의 정상 반환은 request write 뒤 `acknowledgement: bytes=0 first=0 errno=0`로 실패했다.
이전 `Operation not permitted`는 실패 syscall의 errno라고 판정하지 않는다. creator의 private 실패 frame도 도착하지 않았다.

SOURCE92는 creator 종료 경로에서 bootstrap receive right를 먼저 명시적으로 revoke하지 않는다.
자신의 socket copy를 close한 뒤 private acknowledgement를 보내고 프로세스 종료로 자신의 Mach rights를 반환한다.
앞선 EOF의 정확한 exit signal/원인은 관측되지 않았으므로 kernel guard exception으로 확정하지 않는다.
반환 순서 수정의 actual Mac 결과는 아직 NOT_RUN이며 기존 실패·세 gate OPEN·제품 BLOCKED를 유지한다.

SOURCE91 Mac15 Society ZIP13432290176 SHA-256 `28586ff88a6f00ab15adf5ca06994baa0afe3cc63086a8cad01b7cd2b8c2e5b6`도 대조했다.
동일 canonical/source의 Society 전후 동일, runtime15549/27 `34a86ee000b0b523416d41d455fde726ffe2c8567c1e4f6cd58abcae9e3f90ce`다.
Intel과 같은3 PASS /2 FAIL·기타0이며001/004는 같은 ack EOF다. Mac26 ARM 결과로 전용하지 않는다.
SOURCE92 수정 뒤 Linux lease/runner/stdin45/45 PASS·기타0다(`/tmp/oma-source92-core-regression-final.log`).
SDK producer ARM/Intel object compile도 통과했으나 실제 수정된 정상 release는 이 Linux/SDK 검사에서 NOT_RUN이다.
CI는 common runtime/Society 결과 뒤에 broad Darwin gate를 실행하도록 순서만 정했다.
gate 자체의 실행·guard·실패 판정·deadline은 유지하며, 앞선 runtime 실패에도 취소되지 않았다면 gate를 실행한다.
Society artifact에는 같은 runner의 설치 시작 뒤 생성된 crash report도 보존한다. report 부재를 정상 종료 근거로 쓰지 않는다.

SOURCE92 build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata·full architecture/transaction/durable boundary/document/spec는 exit0다.
production14403, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14371 / REMOVED220이다.
원시는 `/tmp/oma-source92-build-final.log`·`/tmp/oma-source92-package-isolation-final.log`·`/tmp/oma-source92-review-final.log`·`/tmp/oma-source92-architecture-final.log`다.

### SOURCE92 actual ARM/Intel 정상 반환 실패 보존

SOURCE92 `bb31535b5dfd04bb003d85f9be2131ffbc765577`, Native42060873558·Architecture42060873612이다.
canonical15946/`c6d087088458c036e62838a8989c1d1d760bdf7542077669f5c3d020537494e4`다.
ARM Society ZIP13431897722 SHA-256 `ad537ce733e0d5098c24d1a174153889556901750200ec0f5e7dc0edcf459de4`,
Intel Society ZIP13432606640 SHA-256 `889f20cf8cba6e156de90699a79f3b6ac6f722eaaf55d74bbc09a24ec2b14d29`를 대조했다.
각 source/input/runtime Society 전후 동일이다. runtime15549/27은 ARM `d2959c42d51c144cfd2b38023dd7e58936b9d70bb56cd6ae1962e498cb95f623`,
Intel `7008012fc88631b6ac25ff8e679c4e8aafd1b7352ddf55a028158e01746aa581`다.
양쪽 모두3 PASS /2 FAIL·기타0다. 002/003/005가 통과했고001/004의 ack EOF는 그대로다.
명시적 discovery receive 반환 제거는 이 실패를 고치지 않았다. ARM crash report manifest는 비었고,
Intel의3건은 Spotlight/iconservicesagent/dock의 report로 creator의 종료 원인 근거가 아니다.

SOURCE93은 Host socket을 creator의 반환 acknowledgement까지 유지하고, 그 뒤 Host의 socket/owner endpoint를 모두 cleanup한다.
creator 요청 수신 acknowledgement와 socket copy 반환 acknowledgement를 구분해, 다음 실패에서는 요청 수신 여부도 보존한다.
직접 원인이나 수정 성공을 미리 주장하지 않는다. 세 gate OPEN·제품 BLOCKED다.

SOURCE93 Linux lease/runner/stdin45/45 PASS·기타0다(`/tmp/oma-source93-core-regression-final.log`).
Darwin release는 여기서 NOT_RUN이다. SDK producer ARM/Intel object compile은 통과했다.
controller의 마지막 diagnostics 수정 뒤 assets를 다시 빌드했고 source/dist 일치와 현재 production source digest를 확인했다.
이전 진행 중 build는 최종 packed installation의 입력으로 쓰지 않는다(`/tmp/oma-source93-build-frozen.log`).

SOURCE93 최종 build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata·full architecture/transaction/durable boundary/document/spec는 exit0다.
production14403, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14371 / REMOVED220이다.
원시는 `/tmp/oma-source93-build-frozen.log`·`/tmp/oma-source93-package-isolation-final.log`·`/tmp/oma-source93-review-final.log`·`/tmp/oma-source93-architecture-final.log`다.

### SOURCE93 actual Intel 요청 수신 전 EOF와 SOURCE94 귀속

SOURCE93 `178ce8cfeb1e243a9e95d04a39165c3c810560d0`, Native42062996187·Architecture42062996285이다.
canonical15946/`112b511754b3ac9e670a021496fc40a77b488600a0fe69324adb5cbc74b5f08d`다.
Intel Society ZIP13430959759 SHA-256 `ebe517de73526fc3931f37f5d293d2fbc08bd12528a64ffb3b35f0e1dfe3691f`를 대조했다.
동일 source/input/runtime의 Society 전후 동일, runtime15549/27 `3ff9ee68cd123ff5deb41412b7b712734fee61650fe44f918b8273e45b0aad5e`다.
3 PASS /2 FAIL·기타0이며001/004는 `accepted=0 bytes=0 first=0 errno=0`다.
Host socket을 유지해도 creator의 요청 수신 응답부터 없었다. 반환 순서 변경이 해결했다고 판정하지 않는다.
같은 runner의 crash report6건도 모두 Spotlight/iconservicesagent/dock이며 creator 종료 원인을 설명하지 않는다.

SOURCE94는 release 직전에 기존 nonce/fixed-image discovery로 creator를 확인하고 kernel EXIT/EXITSTATUS event를 등록한 뒤 같은 token을 다시 확인한다.
그 뒤 private request를 보내며, 실패하면 같은 등록의 exit event/status를 남긴다. PID로 신호를 보내거나 전체 scope 사망으로 해석하지 않는다.
이 입력은 원인 귀속용 중간 checkpoint다. 최종 review 재결박·fresh27/27·전체 architecture는 아직 미실행/미완료이며,
앞선 source의 통과를 이 입력의 완료 근거로 전용하지 않는다. 실제 정상 반환과 전체 제품은 여전히 BLOCKED다.

### SOURCE94 actual ARM 종료 상태와 SOURCE95 half-close handback

SOURCE94 `c7c99cf1dda88ef65e20ed8bce9abc2d658e7875`, Native42064703097·Architecture42064703560이다.
canonical15946/`3e6b27e40d2e2f6aee3092bbb0b8affecfe92196d58ffc4920d5132bd41ed4f5`다.
ARM Society ZIP13432976831 SHA-256 `626fe93c5114c406a8ec5190ce3b26cb6873b8b7f2a0fecd78aab592189b0398`를 대조했다.
동일 source/input/runtime Society 전후 동일, runtime15549/27 `c6c5f8e38af9154d9204e4e775e5544235bef948d4f1569b0616b1f29978f7e6`다.
3 PASS /2 FAIL·기타0이며001/004의 accepted0/EOF 뒤 등록한 원래 creator의 EXIT|EXITSTATUS event는 각각 status0이다.
release 직전 두 번의 fresh nonce/fixed-image token은 같았다. 이 실패를 SIGKILL/EXC_GUARD라고 주장하지 않는다.

SOURCE95는 private owner 송신 half-close를 반환 요청으로 삼는다. creator는 원래 owner EOF 경로에서 자신의 socket copy를 close하고 C를 응답한다.
Host는 C를 실제로 받은 뒤 자신의 socket copy를 반환한다. EOF 자체를 성공 acknowledgement로 삼지 않는다.
Host 강제 종료로 응답을 받을 peer도 없으면 creator는 이미 자신의 socket을 반환한 뒤 EPIPE를 정리한다.
실제 Mac 수정 결과는 NOT_RUN이며 이 입력도 최종 review/독립 설치/전체 architecture 마감 전의 중간 checkpoint다.
세 gate OPEN·제품 BLOCKED이며 이전 source 통과를 전용하지 않는다.

### SOURCE95 actual ARM 응답 EOF 보존과 SOURCE96 endpoint 귀속

SOURCE95 `4f09fcedd64399525eb06cb27a721ae32656ec50`, Native42066135767·Architecture42066135786이다.
canonical15946/`38503f316586a9e279cfa9c71d998e30f5c0c723398d6524ba237677934f4cfd`다.
ARM Society ZIP13433122982 SHA-256 `4f57a8adb245c27dd5cf70194ed70fab7cfbfe9db7ad2dc952dc05e347ad5252`를 대조했다.
동일 source/input/runtime Society 전후 동일, runtime15549/27 `5de90f17a045e9ca6df982a3269d9b97cc513bc3ae75176577896b63947856d3`다.
여전히3 PASS /2 FAIL·기타0이며001/004는 ack EOF 뒤 원래 creator의 kernel exit status0이다.
half-close 변경도 성공한 해결책으로 판정하지 않는다. status0만으로 C의 실제 송신 여부는 구분되지 않았다.

SOURCE96은 실패 때 해제 직전의 Host/creator private socket opaque identity·connected peer·kernel state와 해제 뒤 Host state를 기록한다.
creator가 자기 copy를 닫은 뒤 acknowledgement EPIPE를 받은 경로는 diagnostic exit10으로 구분한다.
이 exit status 자체를 제품 성공이나 전체 scope 사망으로 해석하지 않는다. 최종 review/독립 설치/전체 architecture는 계속 미완료다.

### SOURCE96 actual endpoint와 SOURCE97 원래 Host channel 유지

SOURCE96 `d77423b5d1f4b48ea37cb8a2e81a4a04d1e94fbc`, Native42067951318·Architecture42067951832이다.
canonical15946/`682dd45af9150872a81a177503c984b939236d933cd994987761959d91674c13`다.
Intel Society ZIP13434144773 SHA-256 `9464a39f2109d28c42fbc4e6f95df38fd5735a1f94b4824907c9d12388536f64`를 대조했다.
동일 source/input/runtime Society 전후 동일, runtime15549/27 `e3ab2806d38285b515c83dff50244097606914f71142faad7eda9a603db42ee7`다.
3 PASS /2 FAIL·기타0이다. 두 실패의 Host/creator socket info는 모두792 bytes였고 양 endpoint의 connected peer는 서로 정확히 일치했다.
반환 요청 이전 Host state34(0x22: connected + receive closed), creator258(0x102: connected + nonblocking), 요청 뒤 Host50(0x32)다.
creator는 원래 등록한 kernel event에서 status0으로 종료했다. diagnostic exit10이 아니므로 C write가 EPIPE였다고 판정하지 않는다.
인계된 endpoint가 이미 receive-closed인 것을 확인했으며 전체 kernel 실행 경로 자체를 관측한 것은 아니다.

SOURCE97은 SCM_RIGHTS로 AF_UNIX lifetime endpoint를 재인계하지 않는다.
Host가 처음 만든 socketpair의 parent를 계속 소유하고, child는 고정 controller에서 고정 creator의 별도 FD4로 직접 상속한다.
초기 publication/ready는 기존 controller↔creator의 별도 setup stream으로만 흐른다.
Host에 SCM으로 전달하는 것은 실제 새 IPv6 fence FD 하나뿐이며 private handoff version2는 다른 descriptor 수/버전을 거절한다.
Host 채널은 actual fence 인식 뒤 child copy만 반환하고 parent를 creator의 EOF/ack 수명으로 유지한다.
정상 반환의 양성 응답, Host/creator 사망 거절, full identity/collision/mutation 조건은 유지한다.
수정의 actual Mac은 아직 NOT_RUN이다. 최종 review/독립 설치/전체 architecture 마감도 아직 미완료이며 세 gate OPEN·제품 BLOCKED다.

### SOURCE97 actual ARM Society5/5

SOURCE97 `600c46c51c420cd065ae85dcc061ef25a70f711f`, Native42070866793·Architecture42070866838이다.
canonical15946/`41b05918fc216373f063480366576cd0e9181e2c3c9aae5bb7dcdcd5e8866dd1`다.
ARM Society ZIP13436536981 SHA-256 `2bad8474a0d25e2daed8f2ee02247fdb333bd264cc3c770f2e0c60fae367a108`를 대조했다.
source/input/runtime의 Society 전후 동일, runtime15549/27 `b5526e604a8989ed97a4d9607438cbceb9ffebae52f7e280ca2925ef8a23df15`다.
제품 shared lease5/5 PASS·fail/cancel/skip/todo0다. 정상 release/즉시 reacquire001과 충돌 뒤 반환/인수004가 이번에 통과했다.
Host SIGKILL 뒤 controlled child가 유지하는 실제 FD/마지막 반환002, creator 강제 종료 뒤 점유 unknown 거절003, socket 변조005도 통과했다.
이는 controlled child 및 shared API의 실제 보장이다. 실제 Broker/Engine·모든 paid scope·Actor의 FD4 close/helper 사망 결합을 완료했다고 쓰지 않는다.
독립 설치/최종 review/전체 architecture 마감을 진행하며 G-PROCESS/G-FILES/G-AUTH와 제품 guard는 유지한다.

SOURCE97 Intel Society ZIP13435439246 SHA-256 `fdb12b0d4523e2c0cc6122c8ce8c7a26c3fb4fb29929d346582aa393a18bba5f`도 대조했다.
같은 source/canonical의 Society 전후 동일, runtime15549/27 `507d858597e39eee52b1b0fbd897b1c8f466404f2eefad28addde11ee7ab9972`다.
Intel도5/5 PASS·fail/cancel/skip/todo0다. ARM과 Intel에서 기존001/004의 정상 반환 실패가 해소됐다.

SOURCE98에는 같은 실제 fence를 shared ExecutionRuntime/ExecutionJournal/launchDarwinJobScope에 전달하는6번째 시험을 추가했다.
controlled direct workload와 detached descendant가 실제 resource coalition 안에서 FD4를 보유한다.
Host의 자기 copy와 creator copy를 정상 반환해도 populated scope가 남아 있으면 takeover를 거절해야 한다.
공통 owner의 취소 뒤에는 독립 kernel empty·FD/output drain·빈 journal을 확인한 뒤에만 재획득을 요구한다.
이 새6번째 case의 actual Mac은 아직 NOT_RUN이며 전체 Broker/Engine/Actor authority 완료로 확대하지 않는다.

SOURCE97 ARM main ZIP13437256735 SHA-256 `1806ed4b194e95831dd9fae6114c29526b3a0c282255fa4fb021a59edde46959`도 대조했다.
같은 source/canonical/runtime의 main 전후 동일 및465/465 PASS·fail/cancel/skip/todo0다.
SOURCE88의 Host death termination unknown 원인이 수리됐다는 판정은 아니다. 기존 실패 근거를 보존한다.
SOURCE98 Linux lease/runner/stdin46/46 PASS·기타0다(`/tmp/oma-source98-core-final.log`). 실제 새 Darwin scope006은 NOT_RUN이다.

SOURCE98 최종 build·fresh27/27 packed installation(App 실제 installed runtime 포함)·review metadata·full architecture/transaction/durable boundary/document/spec는 exit0다.
production14403, review CHANGED_WITHOUT_ORACLE32 / NOT_REVIEWED14371 / REMOVED220이다.
원시는 `/tmp/oma-source98-build-final.log`·`/tmp/oma-source98-package-isolation-final.log`·`/tmp/oma-source98-review-final.log`·`/tmp/oma-source98-architecture-final.log`다.
이 local 마감은 기본 소유권5건의 SOURCE97 실제 결과나 새006 scope의 미실행 여부를 다른 source로 바꾸지 않는다.

### SOURCE98 actual ARM fixture slot 거절과 SOURCE99 수정

SOURCE98 `61decacabd0d6d759c98e150d70d4a47989862ee`, Native42073419187·Architecture42073419324이다.
canonical15946/`daf595fd03d8a8d934ad848c17438e37c3471a0b2716d7a3a1787ca10fc345eb`다.
ARM Society ZIP13435919229 SHA-256 `f4120d0d2c85f54929310d8f9c9c8ede8ab405724255e408cedadf3eb1c23222`를 대조했다.
같은 source/input/runtime Society 전후 동일, runtime15549/27은 SOURCE97 ARM과 같은 `b5526e604a8989ed97a4d9607438cbceb9ffebae52f7e280ca2925ef8a23df15`다.
실제6건은5 PASS /1 FAIL·기타0다. 기존001~005는 다시 통과했고006은 journal reserve의 `invalid execution slot`에서 거절됐다.
시험이 임의 slot `society-paid`를 사용한 fixture 오류다. 실제 scope 시작/종료의 실패나 인수로 확대하지 않는다.
SOURCE99는 원래 product slot인 `preparation`을 쓰며 journal 계약/검사와 원래 namespace·scope 단언은 유지한다.
production 변경이 없는 시험 수정이다. 새006의 실제 Mac은 여전히 NOT_RUN이다.

### SOURCE99 actual ARM/Intel6/6와 SOURCE100 Host tenure crash/recovery

SOURCE99 `ccddec2fca47501eb10871e4a72973a653dabfc4`, Native42074422688·Architecture42074422588이다.
canonical15946/`40ac9f9d01381229b3ca3150d2e5da2852a99333f7359cedc022f7a826173976`다.
ARM Society ZIP13437364607 SHA-256 `5394c563f1836ca6b722eacf30baf843fb8925ca46d38a67a136e4ad379bd1e1`,
Intel Society ZIP13437769232 SHA-256 `bd4782ba652061e259224f5b7a2056e5a18ca0a98eb3a3b226866934ea543fbd`를 대조했다.
각 source/input/runtime Society 전후 동일이며 runtime15549/27은 ARM `b5526e604a8989ed97a4d9607438cbceb9ffebae52f7e280ca2925ef8a23df15`,
Intel `507d858597e39eee52b1b0fbd897b1c8f466404f2eefad28addde11ee7ab9972`다.
양쪽6/6 PASS·fail/cancel/skip/todo0다. 새006에서 실제 journaled resource coalition의 direct workload와 detached descendant가 FD를 유지했다.
Host/creator의 자기 copy 반환 뒤 populated scope의 takeover 거절, 공통 owner 취소 뒤 독립 kernel empty·FD/output drain·빈 journal·재획득을 확인했다.

SOURCE100의007은 실제 HostTenure와 claimSocietyFence를 사용하는 controlled execution owner를 결합한다.
기존 Host-crash recovery fixture에 fenced mode만 추가하며 나머지 기존 mode는 유지한다.
Host tenure가 살아 있는 동안 실행 owner가 SIGKILL된 뒤 실제 detached descendant가 같은 journal CID에서 살아 있음을 새 pin으로 확인한다.
다른 Host 인수 거절, 같은 tenure의 공통 recovery로 kernel empty/원래 pin exit/빈 journal/기존 frame 보존, tenure 종료 뒤 재획득을 요구한다.
007 actual Mac은 NOT_RUN이며 이 controlled 조립을 전체 Broker CLI/Actor current authority 완료로 확대하지 않는다.


### SOURCE100 actual ARM/Intel7/7와 SOURCE101 private Host 감독 연결

SOURCE100 `5f9edc2e881c64ea024e888795c4beea72eb93ac`, Native42077657954·Architecture42077658291이다.
canonical15946/`f1ec7faa50972a2e054d8ce699992478ab4295d2a22d3062da2d68265fa6801e`다.
ARM Society ZIP13440022728 SHA-256 `7383772fffb9d5a96e7a92f620fc53a4081d824a4abc9314ee314f3a81e8c183`,
Intel Society ZIP13439981535 SHA-256 `53ddf7c1fecfa3a63392e53cf81a9fb04d3305ceecdef7b85dbe3a5aea2a0586`를 대조했다.
각 source/input/runtime 전후 동일, runtime15549는 ARM `b5526e604a8989ed97a4d9607438cbceb9ffebae52f7e280ca2925ef8a23df15`,
Intel `507d858597e39eee52b1b0fbd897b1c8f466404f2eefad28addde11ee7ab9972`다.
양쪽7/7 PASS·fail/cancel/skip/todo0다. 007에서 실제 Host tenure 아래 fenced owner SIGKILL·살아 있는 detached descendant·인수 거절·공통 journal recovery와 기존 frame 보존 뒤 전체 kernel empty/빈 journal/재획득을 확인했다.
이 controlled 조립은 전체 Broker CLI·Actor role 인수가 아니다.

SOURCE101은 실제 Broker 감독 채널이 Darwin에서도 Linux SO_PEERCRED를 호출하던 미연결을 수리한다.
Darwin에만 private inherited endpoint의 getpeereid/전체 LOCAL_PEERTOKEN을 실제 부모와 결박하며, process watch 등록 뒤 token을 다시 확인한다.
Host exec/death·부모 변경·관측 불명은 권한을 철회한다. 매 송수신과 queued registration 전달 전에 살아 있는 원래 부모를 다시 확인한다.
이 endpoint 관측은 공개 socket의 message sender 인증으로 사용하지 않는다. 부모 endpoint를 전달하지 않는 기존 private channel 계약이 전제다.
새008은 실제 HostTenure→spawnSupervisedService→claimSocietyFence→openSupervisionChannel을 사용해 private session 왕복과 Host SIGKILL 뒤 Broker 종료/재취득을 확인한다.
SOURCE101은 INTERMEDIATE checkpoint다. 실제 Mac008·최종 review invalidation/fresh27/전체 인수는 NOT_RUN이며 제품 guard와 세 gate는 유지한다.

SOURCE100 Intel 공통 ZIP13440052374 SHA-256 `da0bcc774083018d0e3665194457c257299831581f9948182906e82c8ef11b4a`도 대조했다.
같은 source/canonical/runtime의 main 전후 동일이며465/465 PASS·fail/cancel/skip/todo0다. 전체 gate·전체 제품 인수와 구분한다.
SOURCE101 local build·workspace boundary·문서/spec 검사와 감독/tenure/조립 회귀77/77 PASS다.
그 중 Darwin8개는 Linux에서 명시적 NOT_RUN이며 실제 Mac 실행으로 계산하지 않는다.


SOURCE100의 나머지 ARM 공통 ZIP13438334431 SHA-256 `4e55f3cc1c5942d77f402315b2b5f6c7d280fb13716d823bed5ad1fd0d9315bf`는465/465 PASS다.
ARM shared ZIP13439943886 SHA-256 `84919cc98b25fd2be8bd7b03adb301a91cb6e4df24060da5e9083d20aeded194`,
Intel shared ZIP13439723060 SHA-256 `cd3afa525b3b4acac12e7875e5a4b1a22cc9d187869f1aa93410475526ce49a6`를 대조했다.
모두 같은 source/canonical 및 각 architecture runtime의 main/shared 전후 동일이다.
ARM cold generation3/3 PASS(첫 case216662ms), Intel은2 PASS/1 CANCELLED(testTimeoutFailure240000ms)다.
Intel construction193670ms·copy193623ms 중 fsync33725회110654ms가 관측됐고, scope-execution-and-return1789ms 뒤 private Git 단계에서 시험 예산이 끝났다.
원래240000ms 제한을 늘리거나 timeout을 성공으로 계산하지 않는다. Society7/7·common465/465의 인수 범위와 이 cold-generation 실패를 구분한다.


SOURCE101의 production 변경 뒤 local fresh packed install27/27(실제 설치 App 포함)·전체 architecture/transaction/durable/document/spec 검사는 PASS다.
기본 ledger 명령은 이미 제거/이동된 과거 reviewed path 때문에 거절했고, 명시적 `--invalidate-stale`로 옛 검토를 무효화했다.
새 ledger는 production14404 중 CHANGED_WITHOUT_ORACLE32·NOT_REVIEWED14372·REMOVED220이며 새 코드가 검토 완료됐다고 표시하지 않는다.
SOURCE102는009 반례를 추가하는 test-only checkpoint다. 006의 기존 조건은 유지하며 별도009에서 workload와 detached descendant가 FD4를 직접 닫은 뒤에도 populated scope의 인수를 거절해야 한다.
이 close-all 반례의 actual Mac은 NOT_RUN이며 기존006/007 성공은 이 조건을 증명하지 않는다. production guard·시간 제한·scope empty predicate는 유지한다.


SOURCE101 actual Intel Society ZIP13440866488 SHA-256 `cdbea5a529156e3378fbb106b75645c7eb767be3f4da9ec2089c0f132e1cbbe7`를 대조했다.
source `dfb27bb1129e7a75bb0e41dbca70239a2eed6b32`, canonical15948/`dc7635b269b6d6a1a37cb94b50fbe2db2ecd77c88878a65b613c83cbbeb2c842`,
runtime15551/`d84699c1b6925c4f7bb0687e2fe0fd67f2e73f6c6bae12e9ba1ff3934d92d68b`가 Society 전후 동일이다.
7 PASS/1 FAIL·기타0다. 008의 private 부모 결박/session 왕복·Host SIGKILL·Broker 원래 pin exit/종료 이유까지 통과했다.
마지막 새 lease 취득은 종료 중인 기존 creator의 nonce 응답을 Security 검증하다 `fence creator mapped image: No such process`로 거절됐다.
이 unknown 거절을 성공으로 바꾸지 않는다. SOURCE102는 Host가 살아 있을 때 고정 creator를 인증하고 watch 등록 뒤 fresh 응답을 다시 대조한다.
Host/Broker와 그 원래 creator의 종료까지 각각 확인한 뒤 새 취득을 한 번 시도한다. deadline/거절 정책/production은 바꾸지 않는 fixture 수리다.
008 전체 PASS와009 close-all의 actual Mac은 SOURCE102에서 아직 NOT_RUN이다.


### SOURCE102 actual close-all 반례와 SOURCE103 trusted scope 참조 수명 수리

SOURCE102 `8899ef1cd78f949873ef290740648abdb0a54d93`, Native42081758324·Architecture42081758241이다.
canonical15948/`af1fd33cf06476031949d907c96af8f36c54678a950b0e932eb2649fc66cecb2`다.
ARM Society ZIP13441651197 SHA-256 `f8d1887366a0ba26206d6f24c9cb77a351ce371afc738386b132c3622931aa6f`,
Intel Society ZIP13440957461 SHA-256 `9b99b6e2256043445e30172ab4d1e73503d514a492c6d5e01ce19c013d0a6760`를 대조했다.
각 source/input/runtime Society 전후 동일, runtime15551은 ARM `1cdd4ad8862848dc0e871d09d85d6fdc21db6276c9317b02fcf7e4a596eda5f8`,
Intel `d84699c1b6925c4f7bb0687e2fe0fd67f2e73f6c6bae12e9ba1ff3934d92d68b`다.
양쪽8 PASS/1 FAIL·기타0다. 008은 실제 private parent/session 왕복·Host SIGKILL·Broker 및 원래 creator exit 뒤 재획득까지 통과했다.
009는 workload와 detached descendant가 FD4를 닫자 아직 populated인 scope를 두고 새 Host가 실제 취득했다. 원래 반례를 성공/unknown으로 재분류하지 않는다.

SOURCE103은 setup 완료 때 모든 fileport 참조를 반환하던 수명 오류를 수리한다.
Process는 상속 cooperation socket을 Native의 retained socket capability로 지정하고, trusted scope owner가 자기 fileport 참조를 별도로 유지한다.
setup/종료 요청만으로 그 참조를 닫지 않으며, 정상 close는 공통 owner의 독립 kernel empty와 capture drain 뒤에만 호출된다.
생성 시도 이후 취득 실패에서 scope empty가 증명되지 않으면 참조 반환도 거절한다. stdio/config fileport의 기존 반환은 유지해 EOF drain을 막지 않는다.
009에는 실제 wildcard socket bind가 EADDRINUSE인지 별도 확인을 추가해 discovery의 일시 unknown만으로 PASS하지 못하게 한다.
INTERMEDIATE checkpoint이며 새9/9 actual Mac·후속 packed/review/전체 인수는 NOT_RUN이다. Runtime owner 자신까지 사망한 결합은 별도 범위이며 이 정상 scope owner 참조 수리로 해결했다고 쓰지 않는다.


### SOURCE103 actual Intel9/9와 SOURCE104 실행 owner 사망 결합

SOURCE103 `c6d7aaabcb886ebfe3f1a37be93f341b04e024aa`, Native42082946202·Architecture42082946035다.
canonical15948/`0640eff9b38017701fc6f3826364209ce12eb98db5fe3d4b4c1032eee8e396ee`다.
Intel Society ZIP13440499674 SHA-256 `056be6045a3d9d589e7d963d4cf860c98eec230210caf892c4beca653a9dd6d4`를 대조했다.
같은 source/input/runtime Society 전후 동일, runtime15551/`31b2ecedeae4f17e1e85707971cab9f655c9c7bf1767619d9e1330b67dbe90b3`다.
9/9 PASS·fail/cancel/skip/todo0다. 009에서 Host/creator 자기 copy 반환과 workload/후손 FD close 뒤에도 실제 wildcard bind EADDRINUSE와 새 Host 거절을 확인했다.
독립 kernel empty·FD/output drain·journal retire 뒤 즉시 재획득도 통과했다. 아직 ARM의 새 수리 인수는 NOT_RUN이다.

SOURCE104는 production 변경 없는 test-only checkpoint다. 새010에서 Host tenure 아래 controlled owner를 실행하고 FD를 닫은 detached descendant와 direct workload를 각각 새 kernel pin으로 결박한다.
현재 tenure 아래 전체 witness가 같은 physical cleanup capability를 미리 취득한다. 실행 owner SIGKILL 뒤 direct workload의 원래 pin exit·detached descendant live/같은 CID populated를 확인한다.
그 Host tenure도 종료한 뒤 실제 binding과 새 Host 인수 거절을 요구한다. 정상 owner 참조 수리가 owner 자신의 사망까지 해결했다고 가정하지 않는다.
시험 cleanup은 미리 보유한 physical capability로 old CID를 종료하고, 독립 empty 뒤 새 tenure/journal exclusive owner 아래서만 기존 journal을 retire한다. unknown은 원시를 보존한다.
010 actual Mac은 NOT_RUN이다. 기존 recovery mode·guard·시간 제한·scope empty predicate는 유지한다.


### SOURCE104 actual ARM/Intel9 PASS·owner 사망010 FAIL과 SOURCE105 scope keeper

SOURCE104 `96b1da5fd0e031919d76330529669d288aa515ae`, Native42084117405·Architecture42084117295다.
canonical15948/`21cb07bcc000ab65df4e40693a6aef4dbb23f473b0b13c8feb2782dbe3ede998`다.
ARM Society ZIP13441404137 SHA-256 `3aa22f235f612ff77078cfc6c6bef3a5ec0ae6d910319f67b42946e535aaa944`,
Intel Society ZIP13443046254 SHA-256 `9b04210b1a0cb5b068fa13237f2dc2f872ee826754a36cabadd902acf0772ff6`를 대조했다.
각 source/input/runtime Society 전후 동일, runtime15551은 ARM `67fdc9045658a73b31f429ccdee21befd1e6c425f0eeb4cf332d1b609bbb0a4c`,
Intel `31b2ecedeae4f17e1e85707971cab9f655c9c7bf1767619d9e1330b67dbe90b3`다.
양쪽9 PASS/1 FAIL·기타0다. 009의 실제 bind 거절/종료 뒤 재취득은 두 architecture에서 통과했다.
010은 owner SIGKILL·direct workload 원래 pin exit·살아 있는 detached descendant·Host tenure 종료 뒤 실제 bind가0으로 성공해 실패했다.
이 원시 반례를 unknown/성공으로 바꾸지 않는다. 실행 owner 자신의 fileport 참조만으로 owner 사망 뒤까지 보장한다는 후보를 배제한다.

SOURCE105는 gate 전 실제 App ExecutionRuntime의 paid witness를 fixed creator에 등록한다.
caller는 전체 Society identity·실제 socket/generation의 보유를 증명하고 creator는 같은 boot/CID의 성공한 kernel lookup을 별도로 확인한다.
creator는 Host용 copy와 enrolled scopes용 copy를 나눠 보유한다. Host EOF/정상 반환은 자기 copy만 닫아 acknowledgement하며, scopes는 kernel ID ESRCH가 확인될 때만 반납한다. unknown은 계속 보유한다.
scope 등록은 이미 fence를 보유한 caller의 exclusion 연장일 뿐 Actor role·process signal·receipt·FD를 부여하지 않는다. 전달받은 proof FD를 fence로 채택하지 않고 자기 새 socket을 복제한다.
이름 lookup의 nonce relay만으로 FD를 보내지 않는다. 고정 creator의 kernel-authenticated response가 보내준 실제 enrollment endpoint를 취득한 뒤 그 endpoint에만 fileport proof를 보낸다.
공개 identity discovery는 fence FD를 내주지 않는다. reply endpoint의 send right는 Actor authority가 아니다.

fenced crash fixture의007/010은 이제 실제 App ExecutionRuntime을 사용하며 기존 opening/witness/다른 recovery mode는 유지한다.
006/009와010은 고정 creator의 fresh 인증 뒤 원래 process watch를 등록·재대조하고, old CID empty 뒤 그 creator의 최종 참조 반환도 확인한 다음 새 tenure를 취득한다.
010에는 oversized/malformed public traffic 뒤 같은 creator 생존·같은 실제 binding 확인도 추가했다.
수신 오류로 live scope copy를 반환하지 않는다. oversized 수신의 discard와 body-error resource 반환은 [고정 XNU mach_msg.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/ipc/mach_msg.c)의 receive-results/error 경로를 대조했다. 이는 source 검토이며 actual Mac proof가 아니다.
취소된 CI가 always 조건으로 cold generation을 새로 시작하던 조건은 !cancelled로 고쳤다. 일반 실패 뒤 검증·240000ms 제한·raw artifact 보존은 유지한다.
SOURCE105 local build·선택92/92 PASS, producer C의 ARM/Intel SDK -Wall/-Wextra/-Werror object compile은 PASS다. Darwin cases는 Linux에서 명시적 NOT_RUN이다.
INTERMEDIATE checkpoint이며 actual Mac controller compile·10/10·최종 packed/review/전체 제품 인수는 NOT_RUN이다. 세 gate와 기본 guard는 유지한다.


### SOURCE105 actual ARM scope retention과 SOURCE106 malformed frame 정렬

SOURCE105 `f5fd0287cd145e1be48a1de5aa24721d824c3697`, Native42087771695·Architecture42087771639다.
canonical15948/`261b72b26629508491a8de2383f04fd082879bc943a8370545cb2d726108a64c`다.
ARM Society ZIP13442614015 SHA-256 `ddff42fc4fb6979fb1dc72784c1e988b840a231dcd788952778a30ef11389f02`를 대조했다.
같은 source/input/runtime Society 전후 동일, runtime15551/`d2d8d12a4c0b8b79f7f6262f11a6969047889035115b7c3d7bab83da42e06782`다.
actual Apple compiler/build27/27은 PASS이며 Society9 PASS/1 FAIL·기타0다.
010은 actual App Runtime scope 등록·owner SIGKILL·direct workload original pin exit·detached descendant live·Host tenure 종료 뒤 실제 bind EADDRINUSE·인수 거절·creator original pin live까지 통과했다.
새 public-noise 대조의 두 번째1-byte body가 Native Mach API의4-byte alignment 검사에서 거절됐다. 제품 creator가 거절하거나 종료된 결과가 아니라 fixture 호출 규격 오류다.
SOURCE106은 이를 정렬된4-byte malformed enrollment로 바꾼 test-only 수정이다. oversized1024-byte 요청과 실제 binding/원래 creator 유지·완전 scope death 뒤 재취득 oracle는 그대로다.
production은 SOURCE105와 같으며 실제010 전체 PASS는 여전히 NOT_RUN이다. 최초 실패와 이전010 binding 해제 반례를 보존한다.
SOURCE105 local 전체 architecture/transaction/durable/document/spec 검사는0 findings로 PASS다. 이 구조 결과를 actual scope/Actor 인수로 계산하지 않는다.


### SOURCE106 actual ARM10/10와 SOURCE107 standalone explicit fence 연결

SOURCE106 `2825999ea5e53b21e63f07226be8680796efe1e2`, Native42089321249·Architecture42089321114다.
canonical15948/`9dceb881347288e456154c1e9fbebb23c7dd434cbec502de6069c638f15d2d8c`다.
ARM Society ZIP13443319792 SHA-256 `6e073fb2bc9b2994268f90106ecaa2a23da2308307d2a762c304725bf0f27aa0`를 대조했다.
같은 source/input/runtime Society 전후 동일, runtime15551/`d2d8d12a4c0b8b79f7f6262f11a6969047889035115b7c3d7bab83da42e06782`다.
10/10 PASS·fail/cancel/skip/todo0다. 010은 실제 App Runtime·kernel pins 아래 owner SIGKILL/Host 종료 뒤 계속 살아 있는 후손과 실제 binding 유지·인수 거절을 확인했다.
1024-byte oversized/정렬된 malformed public traffic 뒤 같은 original creator와 binding이 남았고, old CID empty·creator 최종 exit 뒤 새 tenure의 journal recovery/재취득도 통과했다.
이 controlled 조립을 actual 전체 Broker CLI/Principal/Actor current authority 인수로 확대하지 않는다.

SOURCE107은 standalone Broker의 claim.fence를 ExecutionRuntime에 명시적으로 전달한다.
App owner는 직접 전달받은 cooperation FD를 우선 선택하고, Process는 그 socket을 실제 child slot에 배치·retained fileport로 보유한다.
상속 env marker가 없는 standalone owner도 gate 전에 같은 creator enrollment를 수행한다. fd 번호/env는 역할 권한이 아니며 실제 Society socket 검증은 기존 native control이 맡는다.
새011은 env marker를 지우고 실제 held fence를 constructor로만 전달해 child/descendant FD close·binding 유지·전체 종료 뒤 반환까지 요구한다.
Linux에는 explicit Darwin capability를 주지 않으며 기존 inherited branch와 입력/권한 검사·guard는 유지한다.
SOURCE107 build 및 실제011은 검증 중이다. SOURCE106 local packed/review 작업 도중 후속 source107 수정/build가 시작되어, 그 실행을 source107의 fresh27/정확한 최종 검토 근거로 사용하지 않는다. 최종 입력에서 다시 확인해야 한다.


### SOURCE106 actual Intel10/10와 SOURCE107 ARM11/11·Intel hook failure

SOURCE106 Intel Society ZIP13443998466 SHA-256 `4392cc6de4302f799b1a190a376be57db28370e19a1c8a1252ca7e3f0ba4194b`를 대조했다.
같은 source `2825999ea5e53b21e63f07226be8680796efe1e2`/canonical15948 `9dceb881347288e456154c1e9fbebb23c7dd434cbec502de6069c638f15d2d8c`,
runtime15551/`b99c044add879f22f9388314912f2ef8f50fb593dd3397db98e5a79a7b514fea`가 Society 전후 동일이다. Intel도10/10 PASS·기타0다.

SOURCE107 `015b43d538663305417bbe0fb83fa70ed5c07de5`, Native42090462370·Architecture42090462175다.
canonical15948/`c60d0bac5726b8beda1698d081c9ecc08c4b038c7ca0e16497e623c2be354c9c`다.
ARM Society ZIP13444926967 SHA-256 `fe19a961e1a7e4c38a6b818ca4ccf931521d9cd18b33bae9a3f35af14429e513`,
Intel Society ZIP13444389165 SHA-256 `f2adca89ee730396fa90a8451f8407a8be514e6ebf965e564e7027be339cf937`를 대조했다.
각 source/input/runtime Society 전후 동일, runtime15551은 ARM `30b63f27b41c98432934eb8b5d806151b2f6bd4d6ae430dafb0bc33bd031a6e6`,
Intel `a00b05e0b7eb5fcb522396dc357e3d4b528b214926e5234a5387ddd09a1e5abf`다.
ARM11/11 PASS·기타0다. Intel011까지 본문11개는 PASS지만002 after hook이 이미 body에서 종료한 stream에 finish를 다시 써 ERR_STREAM_WRITE_AFTER_END를 만들었다.
따라서 Intel suite는11 PASS/1 FAIL·기타0로 보존한다. SOURCE108은 writableEnded/destroyed를 확인해 cleanup이 두 번째 payload를 쓰지 않게 한 test-only 수리다.
기존 Host SIGKILL·원래 process pin exit·인수 거절/재취득 조건·기한은 유지한다. SOURCE108 실제 clean suite는 NOT_RUN이다.

SOURCE107 고정 production 입력에서 build·선택93/93 PASS, fresh packed27/27·실제 설치 App runtime PASS를 완료했다.
새 코드 변경 없이 그 입력의 ledger를 --invalidate-stale로 갱신하고 전체 architecture/transaction/durable/document/spec0 findings를 확인했다.
ledger는 CHANGED_WITHOUT_ORACLE32·NOT_REVIEWED14372·REMOVED220/production14404다. 검토 생성으로 과거 authored review를 재승인하지 않는다.
SOURCE108의 production bytes는 SOURCE107과 같다. fixture/doc/ledger binding 변경을 새 전체 runtime proof로 재해석하지 않는다.
다음 제품 연결 지점은 Host의 자기 Broker RPC expected-peer 경로다. 현재 inherited-only Mach dialer에는 직접 시작한 자식을 expected peer로 취득하는 Host 경로가 없다. 기본 guard/세 gate는 계속 유지한다.

### SOURCE109 Host의 자기 Broker 자식 Mach RPC expected-peer 연결

Darwin Host는 public lookup으로 rendezvous만 찾고, 응답 sender는 자신이 띄운 미회수 Broker 자식의 private supervision socketpair audit token과 정확히 같아야 한다.
`pinDarwinPrivateChild`는 socket peer의 uid·token·kernel ppid=Host를 확인하고 process watch를 유지한다. `superviseBroker`는 Darwin ready 시 이 pin이 없거나 죽으면 generation을 disown하며 재시작하지 않는다.
`createChannel`은 현재 ready generation에만 채널을 주고 그 연결은 generation의 watch를 빌린다. 종료·교체 뒤 이전 identity로 새 연결을 열 수 없다.
Principal delivery·Human control은 이 채널을 사용하며 Darwin에서 취득한 source가 없으면 BROKER_UNAVAILABLE로 거절한다. Linux 경로는 기존 peer credential 채널이다.
Broker의 PrincipalEndpoint/HostEndpoint는 supervision channel의 현재 `alive()`를 각 authority read에서 다시 확인한다.

Linux local build·typecheck·선택257 tests 239 PASS/0 FAIL/18 Darwin NOT_RUN, 전체 architecture/transaction/durable/document/spec0 findings다.
실제 Darwin qualification은 `native-society-lease`012다. 실제 Host fork가 Broker 자식을 만들고 production dialer로 Mach 왕복, 비자식 pin 거절, 반환 identity의 AUTH_FAILED, 자식 정상 종료를 확인한다.
012와 dynamic check-in 서비스의 Host lookup은 실제 Mac 실행 전 **NOT_RUN**이다. 전체 Broker CLI의 Principal/Human control 실제 왕복은 별도 인수 범위다.

### SOURCE108 실제 결과와 SOURCE110 일괄 차단 제거 — DR74

SOURCE108 `62d6956decd`, Native42092062911. Society ARM·Intel 각11/11 PASS로 Intel hook 수리를 확인했다.
공통 runtime은 Mac26·Mac15 각465 중462 PASS·3 FAIL이다. 3개는 모두 `native-darwin-fence`001이며, SOURCE105부터 paid scope가 fence creator에 등록하므로 creator 없는 임의 socketpair가 lookup1102로 거절됐다(fail-closed가 맞는 동작). SOURCE109 이후 이 시험은 실제 Society lease를 사용한다.
gate는 각120 중114 OBSERVED·6 SETUP_FAILED다. 6개 worker-bootstrap/tools는 모두 제품 일괄 차단이 실제 Pi client를 거절한 결과였다.

SOURCE110은 DR74에 따라 `assertNativeRuntime`의 macOS 분기, throw-only `launchBlockedDarwin`, 전 OS의 fresh Society `SPIKE_UNRESOLVED` 거절을 제거한다. Darwin 기본 launch는 실제 `launchDarwinJobScope`다.
Linux에서 실제 `oma`를 새 project에서 실행하면 collaboration-v1 birth를 게시하고 TUI까지 진행하며, SIGTERM 뒤 남는 process가 없다. `collaboration-society-admission`006이 이를 고정한다.
macOS 제품 경로(Host·Broker·Runner·Worker Pi)의 실제 실행은 SOURCE110 Mac CI 전 **NOT_RUN**이다.
이 개발 host의 전체 local suite는 bwrap·namespace launcher·cloc 부재로 170개가 실패했다(launcher ENOENT125·bwrap8·cloc2와 그 broker 경로 파생). 제거한 파일을 참조하던 review ledger와 검증 입력 binding은 재생성 뒤 PASS다. Linux 판정은 prerequisite가 설치된 Ubuntu CI가 소유한다.
SOURCE109의 `native-society-lease`012는 양 Mac26에서 001–011 PASS 뒤 결과 없이 job 제한25분에 취소됐다. 원시 log는 권한상 열람 불가다. SOURCE110은 단계 기록 파일·모든 대기의 상한·step timeout을 추가하여 같은 정지를 진단 가능하게 한다. 원인은 아직 미확인이다.
Darwin 제품 경로 시험 `native-product-society`(새 `oma` Society→Broker `broker ready`→무잔존 종료, Personal 시작)를 Mac CI에 추가했다.

### SOURCE110 실제 Mac 결과와 SOURCE111 진단

SOURCE110 `ff3c8c523e0`, Native42146331692. Ubuntu job 전체 PASS(공통 runtime·실제 Linux scope/crash/Git sandbox·durable 회귀 포함)로 DR74 변경의 Linux 회귀가 없다.
Mac26·Mac26 Intel·Mac15 모두 Society 001–011 PASS다. 012는 Mach 왕복·비자식 pin 거절·반환 identity의 AUTH_FAILED·Broker 자식 정상 종료까지 **모두 통과**했다. 실패는 Host fixture가 모든 owner를 반환한 뒤에도 종료하지 않은 것 하나이며, SOURCE109의 25분 정지도 이 원인이다. 남은 handle을 단계 기록에 남기도록 했다.
제품 경로: **Personal 시작은 실제 macOS에서 PASS**(birth 게시·SIGTERM 뒤 무잔존)다. 새 Society는 60초 안에 birth+configuration이 관측되지 않았고 stderr는 비어 있었다. SOURCE111은 birth와 configuration을 나눠 기다리고 시간 초과 시 file tree·process·terminal tail을 보존한다.

### SOURCE111 실제 Mac 결과와 SOURCE112 수리

SOURCE111 `61201d0a8ef`, Native42148722489. Mac26 Society 001–011 PASS, 012는 다시 기능 단언 전부 PASS였다. 결과 직후 Host의 활성 자원은 자기 stderr·IPC·회수 중인 child뿐이었고 2초 뒤 기록이 없어 Host process 자체는 끝났다. 실패는 stdio pipe까지 기다리는 `close` 판정이었다. SOURCE112는 `exit`로 Host 종료를 판정하고 fixture process 무잔존을 별도로 확인한다.
제품 경로: Personal PASS 재현. 새 Society는 Host가 `the connection could not be opened`로 즉시 종료했다. bootstrap의 기존 Broker 탐지가 Darwin에서도 Unix socket connect를 사용했고, Darwin Broker는 Mach rendezvous만 쓰므로 이 관측은 의미가 없으며 긴 TMPDIR 경로에서는 ENOENT가 아닌 오류로 실패했다. 실제 제품 결함이다.
SOURCE112는 Darwin에서 같은 경로의 Mach rendezvous를 lookup한다. UNKNOWN_SERVICE·dead name은 부재, live send right는 존재, 그 밖의 관측 실패는 BROKER_UNAVAILABLE로 거절한다(부재로 읽지 않음). Linux는 기존 socket 관측을 유지한다.

### SOURCE112 실제 Mac 결과와 SOURCE113 수리

SOURCE112 `5518e0e9899`, Native42151174757. Mac26 Society **12/12 PASS**(Host→자기 Broker 자식 Mach RPC 012 포함), Personal PASS다.
새 Society는 이번에 실제 `oma`가 birth·configuration을 게시하고 SIGTERM으로 정상 종료했다. 실제 Broker는 fence·execution recovery를 지나 runtime generation에서 `UNSUPPORTED_PROFILE: runtime generation requires canonical roots and a trusted digest`로 거절했다.
원인은 owner 간 형식 불일치다. Society bootstrap은 `installation.libdir`을 `${libdir}/`로 쓰고 config owner도 이를 허용하지만, Darwin runtime generation과 Mac Git sandbox는 끝 slash 없는 canonical root만 받는다. 유효한 설치가 항상 거절되는 제품 결함이다.
SOURCE113은 config bytes를 바꾸지 않고, Broker 조립에서 canonical root를 한 번 만들어 Git preparation·candidate·quarantine에 넘기며 runtime generation도 같은 정규화를 한다.

### SOURCE113 실제 Mac 결과와 SOURCE114 진단

SOURCE113 `028a6f10b38`, Native42152557290. Mac26 Society 12/12·Personal PASS 재현. 새 Society의 실제 Broker는 runtime generation을 통과했고(약50초) 이후 `contained filesystem operation failed: ENOENT`로 시작에 실패했다. 이 내부 오류는 위치 정보가 없었다. SOURCE114는 StoreError가 아닌 예기치 않은 Broker 시작 오류에 한해 stack을 Broker stderr에 남긴다.

### SOURCE114 실제 Mac 결과와 SOURCE115

SOURCE114 `d1b45be9ce0`, Native42153882186. 새 Society의 실제 Broker가 runtime generation·developer tools·Store·Resident/Mach transport 조립까지 통과한 뒤 `repos/project.git` openDirectory ENOENT로 멈췄다. 시험이 Host와 달리 `--project-dir` 없이 Broker를 시작해 project 준비가 실행되지 않은 것이다. SOURCE115는 Host의 실제 argv와 같이 `--project-dir`을 넘긴다. 준비되지 않은 project 저장소는 bare ENOENT 대신 원인을 말하는 BROKER_UNAVAILABLE로 거절한다.

### SOURCE115 실제 Mac 결과 — 새 Society Broker `broker ready`

SOURCE115 `9288ccd4697`, Native42155468597. **실제 macOS에서 새 `oma` Society의 실제 Broker가 `broker ready`에 도달했다**(runtime generation·developer tools·project 준비·Store·Resident·Mach endpoint 포함). Society 12/12·Personal PASS다.
ready 직후 SIGTERM에서 초기 reconcile 중이던 작업 1개가 CANCELLED_BEFORE_COMMIT, 2개가 INTERNAL_ERROR로 기록됐고 drain이 `CANCELLED_BEFORE_COMMIT: execution was cancelled before release`로 끝나지 않아 exit1이었다. 정상적인 release 전 취소가 drain 실패로 전파되는 경로와 INTERNAL_ERROR의 원인을 찾기 위해, SOURCE116은 INTERNAL_ERROR reconcile 기록과 drain 실패에 원래 stack을 남긴다.

### SOURCE116 실제 Mac 결과와 SOURCE117 수리

SOURCE116 `8a99d03ae0c`, Native42157006782. stack으로 두 원인을 확인했다. (1) drain이 ExecutionRuntime admission을 닫은 뒤 시작된 preparation은 `ExecutionNotStarted`를 받았고, preparation 계층이 이 내부 표지를 원인(BROKER_UNAVAILABLE)으로 바꾸지 않고 넘겨 reconcile이 INTERNAL_ERROR로 분류했다. (2) coordinator는 release 전 취소를 scope 사망 확인·retire 뒤에만 CANCELLED_BEFORE_COMMIT으로 보고하는데(정리 미확인은 RUN_TERMINATION_UNKNOWN), preparation 계층이 이를 uncertain으로 기록하고 shutdown barrier에 다시 던져 정상 drain을 실패시켰다.
SOURCE117은 preparation 경계에서 시작되지 않은 실행을 원래 원인으로 돌려주고, coordinator가 정산한 release 전 취소를 정산된 결과로 다룬다. 다른 실패는 기존대로 uncertain·shutdown fence로 남는다. `preparation-port`002·003이 이를 고정한다.

### SOURCE117 실제 Mac 결과 — 새 Society 전체 제품 경로 PASS(Mac26)

SOURCE117 `5dab668ef2f`, Native42158577774. **Mac26에서 Society 12/12와 제품 경로 2/2 PASS**다: 실제 `oma`가 새 Society를 만들고, 실제 Broker가 `broker ready`에 도달한 뒤 SIGTERM에 exit0으로 정상 drain하며 잔존 process가 없다. Personal도 PASS다. Mac26 Intel은 `broker ready`까지 도달했으나 drain이 시험의 20초 상한을 넘었다(전체184초, 느린 runner). 제품 grace보다 짧은 시험 상한이므로 90초로 조정한다.
처음 실행된 Mac26 공통 suite는 466 중 461 PASS·5 FAIL이다. 3개(`mac-worker-plan`005, `native-darwin-recovery`005, `native-profile`003)는 DR74로 폐기한 일괄 차단을 단언하던 시험이며 남은 실제 계약으로 바꾼다: private profile owner 없는 Mac Worker spawn 거절, 기본 Darwin launch의 실제 job scope 실행·journal retire, 새 state root에서 시작하며 기존 VM bytes 보존. `runtime-maintenance`001은 SOURCE117의 typed reason 반환에 맞춘다. `native-darwin-fence`001 ordinary는 첫 실행에서 creator mapped image ESRCH였고 다른 두 mode는 PASS다. 원인 미확인으로 보존하고 재실행에서 확인한다.

### SOURCE118 실제 Mac 결과와 SOURCE119 수리

SOURCE118 `55c8d4469dd`, Native42160212718. Society는 세 Mac 모두 12/12다. Mac26은 제품 경로 2/2·공통 suite 464/466 PASS다.
**Mac15 제품 결함**: 새 Society Host가 `Cannot read settings: directory-relative operation failed: EACCES`로 종료했다. config generation 게시가 최상위 staging 디렉터리를 0500으로 봉인한 뒤 rename했다. 디렉터리 rename은 자기 `..` 항목을 갱신하므로 Darwin은 이동되는 디렉터리 자체의 쓰기 권한을 요구한다(Mac26에서는 관측되지 않음). SOURCE119는 이미 봉인된 내용은 그대로 두고, 쥐고 있는 최상위 tree fd를 rename 뒤에 0500으로 봉인·flush한다. context snapshot은 이미 같은 순서였다. 검증은 mode를 보지 않으므로 bytes·형식 의미는 같다.
Intel은 Broker가 `git fsck`를 job scope에서 실행 중일 때 시험의 180초 상한에 걸렸다(SOURCE117에서는 184초 만에 ready). 시험 상한을 300초로, step·job 제한을 그에 맞게 늘린다. `native-profile`003은 Society 수를 birth가 있는 항목으로 센다. `native-darwin-fence`001은 공통 suite에서만 간헐적으로 creator 조회 실패(1102/ESRCH)가 나며 전용 Society step에서는 재현되지 않는다. 원인 미확인으로 보존한다.

### SOURCE119 실제 결과 — Intel·Ubuntu job 전체 PASS, SOURCE120 수리

SOURCE119 `0844dc1379f`, Native42164081851. **Mac26 Intel job 전체 SUCCESS**(Society 12/12·제품 경로 2/2·공통 suite 466/466·독립 설치), **Ubuntu job SUCCESS**다. Mac26·Mac15는 Society 12/12·제품 경로 2/2(Mac15 EACCES 수리 확인)다. 공통 suite는 각463/466이다. Darwin gates job이 처음으로 실제 실행됐다(120 중111 OBSERVED).
남은 실패와 SOURCE120 처리:
- `native-darwin-fence`001: 마지막 scope가 끝나 creator가 port를 반환하는 순간의 재획득이 busy(port 아직 bind됨)를 본 뒤 holder 조회에서 이미 사라진 creator(1102/ESRCH)를 만나 오류로 끝났다. 직전 Society가 끝난 직후 `oma`를 다시 시작하는 사용자에게도 같은 경쟁이 생기는 제품 결함이다. 발견조차 안 되는 holder를 비워진 것으로 보고 짧은 상한 안에서 획득을 다시 시도한다. 배타성은 여전히 kernel bind만 정하며, 발견된 비일치 holder와 상한 소진은 기존처럼 거절한다.
- Worker gate(bootstrap/tools 6건): 실제 Seatbelt Worker Pi가 OMA extension을 load하며 `directory-relative operation failed: EPERM`로 실패했다. tool-files private state가 `/`부터 모든 상위 요소에 mkdirat를 먼저 시도했고, Seatbelt는 쓸 수 없는 기존 상위(`/Users` 등)의 mkdir을 EEXIST보다 먼저 EPERM으로 거절한다. 먼저 열고 없는 요소만 만든다.
- Personal gate(3건): fixture가 DR74로 폐기한 Society 일괄 거절(exit4)을 단언했다. Personal 고유 확인은 유지하고 그 항목을 validator·evidence 시험과 함께 제거한다.
- Mac15 `native-integration-directory`001: populated scope termination 실패로 ownership을 보존했다(fail-closed). 원인 오류가 빈 AggregateError로만 남아 오류 문구에 하위 원인을 포함하게 했다. G-PROCESS의 기존 미해결 항목으로 유지한다.

### SOURCE121 — CI 대기 중 병행 구현

- Mac CI에 Darwin storage step을 추가했다: 고정 Restic 설치 뒤 실제 Society lease로 `session-storage`·`session-storage-verification`의 backup/verify/restore를 실행한다.
- 제품 경로 시험 003: 실제 Host를 PTY에서 실행한다. Host가 띄운 Broker child가 Store를 열 때까지(runtime generation·tools 포함) 진행하고 Ctrl-D로 Host·Broker·engine이 모두 끝나 잔존 process가 없어야 한다. SOURCE109의 Host→자기 Broker Mach expected-peer 경로가 제품 Host에서 실행된다.
- 제품 경로 시험 004: 새 Society → Broker ready → 정지 → 실제 `oma archive`(Restic backup/verify·hot 회수, 재실행 시 already archived) → Broker 재시작에서 restore·검증 뒤 ready → 무잔존 정지.
- G-PROCESS: Darwin coalition 구성원 종료가 scan hint 뒤 task-name/audit token 취득 사이에 정상 종료한 구성원을 즉시 unknown으로 거절했다. 같은 generation을 다시 관측해 이미 사라졌으면 미전송(false)으로 돌려주고, 같은 generation이 살아 있을 때만 unknown을 유지한다. 종료 owner는 다음 반복에서 population을 다시 관측한다. Mac15 `native-integration-directory`001의 populated scope termination 실패 후보 원인이며 실제 확인은 다음 실행이 소유한다.

### SOURCE122 — Darwin Principal engine의 Broker expected peer

SOURCE120(취소 전 부분 결과): Mac26 공통 suite **466/466**(fence 재획득 경쟁 수리 확인), Mac26 Intel 466/466, 두 OS Society 12/12·제품 경로 2/2 PASS.
Host는 Principal engine을 일반 owned child로 시작하므로 Darwin engine의 client에는 Worker와 같은 상속 Mach endpoint·peer source가 없어 Society 도구가 Broker에 연결할 수 없었다(남은 작업표의 Principal/Engine Host RPC 항목). §5의 trusted parent channel을 expected identity 원천으로 사용한다: Host는 credential 직전에 자기 Broker child의 kernel pid·전체 audit token(사설 child pin에서 취득)을 같은 private socketpair로 보낸다. engine은 바로 다음 credential에만 그 identity를 결박한다. client는 rendezvous를 lookup하되 등록한 kernel process watch가 live이고 응답 sender token이 정확히 같을 때만 받는다. Broker 쪽 Principal 인증(caller audit token·engine descent)은 그대로다. identity를 attest할 수 없으면 credential을 주지 않는다. `principal-channel`011이 protocol을 고정하고, 제품 경로 003이 실제 Host에서 attestation 실패·credential 거절이 없음을 확인한다. engine의 실제 Society 도구 왕복은 scripted provider를 쓰는 Darwin 제품 시나리오가 필요하며 아직 NOT_RUN이다.

### SOURCE121 실제 결과와 SOURCE123

SOURCE121 `4effdae768d`, Native42171221927(SOURCE122 push로 일부 취소). Society는 세 Mac 모두 12/12다. 새 Darwin storage step과 제품 step은 `npm run setup:storage`가 `Installed Restic could not run`으로 실패했다. 설치기와 제품 `ResticProcess`가 모두 검증한 FD를 `/dev/fd/3`로 exec하는데, Darwin은 descriptor 경로 exec를 거절한다(§6.1 기존 반례). **Darwin에서 Restic backup/restore는 현재 동작하지 않는 제품 결함이다.** pathname exec로 낮추지 않고, spec이 채택한 Darwin exact-executable primitive(main image digest를 생성 전 검증하는 job scope)로 옮기는 작업을 진행한다. 그동안 제품 step은 Restic 설치 실패에 막히지 않고 다른 제품 시험을 실행하며, 제품 경로 004가 이 실패를 보고한다.
제품 경로 005: 실제 Host를 PTY에서 실행하고 engine 기본 모델을 scripted provider로 지정한다. Principal이 `oma_send`(없는 주소)를 호출하면 다음 요청의 tool result가 Broker의 `ADDRESS_NOT_FOUND`여야 한다. SOURCE122의 attested Broker identity로 engine이 실제 Mach 경로로 Broker에 인증·호출했다는 증거다.

### SOURCE124 — Darwin Restic을 image 검증 job scope로 이전

SOURCE122(`f842ebc4792`, 일부 취소)는 세 Mac Society 12/12다. 제품 step은 당시의 Restic 설치 실패로 중단됐다. Mac26 독립 설치는 `@oma/git` 1/27이 isolated smoke 30초 제한에서 ETIMEDOUT이었다. 일괄 차단 제거 뒤 context preparation과 실제 `git fsck`가 Darwin launchd job·Seatbelt로 실행되기 때문이며, Darwin에서만 제한을 180초로 늘린다.
Darwin `ResticProcess`는 `/dev/fd` exec 대신 `launchDarwinJobScope`로 실행한다. 고정 Restic `binarySha256`을 main image 기대 digest로 넘기고 job helper가 생성 전 선택한 bytes의 CodeDirectory와 실제 mapped image를 대조한 뒤 release한다. cwd는 held directory, password는 stdin FD, slot 3–7은 Linux와 같다. 설치기의 설치 후 확인도 같은 경로로 `restic version`을 실행한다. Linux FD exec는 그대로다. 고정 Restic Darwin binary의 CodeDirectory 유무와 실제 backup/verify/restore는 다음 Mac 실행이 판정한다.

### SOURCE125 — 고정 Restic Darwin binary의 서명 확인

고정 Restic 0.19.1 Darwin archive를 내려받아 checksum을 확인하고 공통 Mach-O parser로 대조했다. arm64 binary는 ad-hoc CodeDirectory(`6f23d5d672ad8600f5867ae25464f992835d35db`)를 가지므로 image 검증 job scope로 결박할 수 있다. **x64 binary는 서명이 없어** exact image 결박이 불가능하다. pathname exec로 낮추지 않고 x64에서는 Restic 효과만 `selected image has no supported bounded Mach-O code signature`로 거절하고 원래 작업공간을 유지한다(NATIVE-002의 owner별 거절). Intel은 spec상 호환성 관측 대상이다. Darwin storage step은 ARM64 runner에서만 실행하고, 제품 경로 004는 x64에서 이 거절과 작업공간 보존을 확인한다. Restic 거절이 내부 `ExecutionNotStarted` 표지 대신 원래 원인으로 보이게 했다.

### SOURCE124 실제 결과와 SOURCE126

SOURCE124 `a40d447e52e`, Native42175524579. **Darwin arm64에서 Restic 설치·검증이 image 검증 job scope로 실행됐다**(`restic 0.19.1 ... darwin/arm64`). Intel 독립 설치는 0 FAIL로 `@oma/git` 시간 제한 수리를 확인했다.
남은 실패와 SOURCE126 처리:
- 제품 경로 004(arm64): Restic이 실제로 실행됐으나 두 번째 명령부터 `empty password`였다. Darwin의 `/dev/stdin` open은 descriptor를 복제하여 offset을 공유하므로 같은 password FD를 쓰는 다음 명령이 EOF를 읽는다(Linux `/proc/self/fd/0` reopen은 독립 offset). Darwin에서는 held password를 positioned read(offset 불변)로 읽어 명령마다 자기 stdin pipe로 준다.
- Darwin storage 시험 15건: macOS `tmpdir()`의 `/var` symlink 조상을 제품이 정책대로 거절했다. 시험 root를 realpath로 만든다.
- 제품 경로 003/005: 실제 Host의 Principal engine(Pi interactive)이 시작 직후 `Session ended.`로 끝나 TUI가 나타나지 않았다(Personal은 정상). engine stderr는 의도적으로 보관하지 않아 원인이 보이지 않았고 이는 Linux에도 있는 사용자 결함이다. engine이 첫 protocol 출력 전에 쓴 stderr(아직 prompt·provider bytes가 없음)만 최대 4KB 보관하고 그 시점에 끝나면 종료 이유로 보여준다. 이후 stderr는 기존처럼 보관하지 않는다(`p0-review4`017).

### SOURCE126 실제 결과와 SOURCE127

SOURCE126 `9062bb57754`, Native42180175014. **Mac26 arm64에서 제품 경로 004 PASS**: 실제 `oma archive`가 고정 Restic(image 검증 job scope)으로 backup·verify·hot 회수를 하고, Broker 재시작이 archive를 restore·검증한 뒤 ready에 도달했다. storage 시험은 9/18로 개선됐다.
- 제품 경로 003/005: 새 종료 이유가 원인을 보였다. `required interactive extensions could not be loaded: ... tool path passes through a link or a non-directory`. Principal engine에는 TMPDIR가 전달되지 않아 Node `tmpdir()`가 `/tmp`이고, macOS `/tmp`(그리고 사용자 TMPDIR의 `/var`)는 symlink다. hashline·MCP state와 검색 snapshot이 그 root를 O_NOFOLLOW descriptor로 열다 거절됐다. 실제 Mac 사용자에게도 생기는 제품 결함이다. lsp·review-record·compile-cache·launchd가 이미 쓰던 대로 system temp root 자체만 realpath로 정규화하고, root 안의 경로 containment는 그대로 둔다.
- storage 6건: `restored session differs from its verified checkpoint`. verifier는 symlink를 포함한 모든 entry의 mode·uid·gid·ns mtime을 digest한다. 어느 metadata가 Darwin Restic restore에서 달라지는지 entry 단위로 보고하는 진단 시험 `native-darwin-restic-roundtrip`을 storage step에 추가했다.

### SOURCE127 실제 결과와 SOURCE128

SOURCE127 `dae5941b7fd`, Native42184803022. **Mac26 제품 경로 003 PASS**: 실제 Host가 PTY에서 새 Society를 열고, 자기 Broker child가 Store를 연 뒤 Ctrl-D로 Host·Broker·engine이 모두 정상 종료했다(temp root 정규화 수리 확인). 001·002·004도 PASS로 제품 경로 4/5다.
- Restic round-trip 진단: 고정 Restic은 Darwin에서 symlink 자체의 mtime만 복원하지 않았다(파일·디렉터리·mode·소유자·내용·link target은 동일). snapshot은 그 시각을 정확히 가지고 있다(archive 검증의 PAX 대조). verifier를 약화하지 않고 Darwin restore 직후 snapshot의 `ls --json`에서 symlink 시각을 읽어 containment 아래 `utimensat(AT_SYMLINK_NOFOLLOW)`로 ns 정밀도로 적용하며, 이어지는 checkpoint digest가 결과를 검증한다. 진단 시험은 이 Restic 동작을 고정한다.
- 제품 경로 005: Principal은 prompt 뒤 작업을 시작했으나 provider가 받은 요청이 0이었다. 화면이 spinner frame으로 채워져 원인이 보이지 않아, 시험이 spinner·control sequence를 걸러 알림만 남기고 Society Store 상태를 함께 보존한다.
- Worker gate는 매 push마다 긴 gate job과 함께 취소되어 결과가 없었다. common-runtime job 안에 worker-bootstrap·worker-tools fixture를 바로 실행하는 짧은 step을 추가했다.

### SOURCE128 실제 결과와 SOURCE129

SOURCE128 `388db217449`, Native42189778787. Mac26 Society 12/12, 제품 경로 4/5, **Darwin storage 16/19**(symlink 시각 복원 수리 확인). 새 Worker probe step이 처음 결과를 냈다: 실제 Seatbelt Worker Pi가 여전히 OMA extension load에서 `directory-relative operation failed: EPERM`이었다. tool-files private state가 `/`부터 각 상위 디렉터리를 열며 내려가는데, deny-default Seatbelt는 Worker가 `/Users` 같은 상위 디렉터리를 읽기로 여는 것을 허용하지 않는다. Seatbelt를 넓혀 상위 디렉터리(다른 actor 이름 포함) 목록을 노출하지 않고, 신뢰된 launcher가 준 HOME과 정규화된 system temp root를 시작점으로 삼는다. 그 아래 각 요소는 기존대로 link를 따르지 않고 연다.
제품 경로 005는 Broker Store가 열린 상태에서 Principal의 model 요청이 0이었다. TUI 출력이 newline 없이 커서 이동으로 그려져 알림이 걸러졌으므로 커서 이동을 줄바꿈으로 바꾸고, Principal session history 끝부분(OMA가 주입한 알림 포함)도 보존한다.

### SOURCE129 실제 결과와 SOURCE130

SOURCE129 `a35afb8678a`, Native42194559884. **실제 Seatbelt Worker가 Mac26에서 처음 시작했다**: `worker-bootstrap`이 실제 Worker Pi의 RPC stdin·정확한 session 재개·물리 경로·production preload·선택된 developer tools·직접 child 종료를 확인했다(private state anchor 수리 확인). Society 12/12, storage 16/19.
- `worker-tools`: fixture의 가짜 `pi` 객체에 현재 extension이 쓰는 `on`이 없어(`pi.on is not a function`) 실패했다. Linux 시험과 같은 최소 API로 맞춘다.
- 제품 경로 001·004: Broker ready 직후 SIGTERM이 초기 reconcile job의 setup(정지 image 검증·setup 전송) 중에 도착해 drain이 `RUN_TERMINATION_UNKNOWN`으로 끝났다. owner가 release 전 target을 종료하면 정지된 image는 workload를 실행하지 않았으므로 그 setup 종료를 CANCELLED_BEFORE_COMMIT으로 보고하고 원래 오류를 cause로 남긴다. 전체 scope 사망은 owner의 settle이 여전히 별도로 관측한다.
- 제품 경로 005: 정리된 알림과 history가 원인을 보였다. Principal의 모든 model 요청이 `Request timed out`이었다. 시험이 PTY harness를 `spawnSync`로 실행해 같은 process의 scripted provider event loop를 막았기 때문이다(시험 결함). 비동기 spawn으로 바꾼다. history에서 Principal이 fake/scripted 모델로 요청을 시작했고 OMA가 record health 알림을 주입한 것도 확인했다.

### SOURCE130 실제 결과와 SOURCE131

SOURCE130 `f61b8a223e1`, Native42198450759. **Mac26 제품 경로 001–004 PASS**(release 전 종료를 취소로 정산하는 수리로 SIGTERM drain 정상). **제품 경로 005의 시험 본문도 PASS**: 실제 Host 아래 scripted Principal의 `oma_send`가 attested Mach 경로로 Broker에 인증·호출되어 Broker 자신의 `ADDRESS_NOT_FOUND` 응답을 받았다. 실패는 t.after 정리의 `rmSync` ENOTEMPTY(삭제 직전까지 쓰는 파일)였고 재시도를 둔다.
`worker-bootstrap`은 Mac26·Intel PASS를 재현했다. `worker-tools`는 실제 Seatbelt Worker 안에서 git init/commit/log, npm, collaboration record read, 자기 script 실행까지 통과하고 `cc` 링크에서 `ld: library 'System' not found`로 실패했다. sandbox 안의 xcrun이 SDK를 찾지 못해 clang이 sysroot를 넘기지 못한 것이다. 선택된 developer root에서 결정되는 macOS SDK(이미 읽기 허용된 contents 아래)를 Worker 환경의 `SDKROOT`로 명시한다. Seatbelt policy는 넓히지 않는다.
제품 경로 006(로컬 커밋)을 함께 보낸다: scripted Principal이 `oma_goal`로 GOAL을 게시하면 seed Worker가 Seatbelt scope에서 깨어 relay를 거쳐 model에 도달해야 한다.

### 세 gate의 판정 근거표 — SOURCE130 기준(판정 아님)

NATIVE-002·spec §4.3·§5·§6의 요구를 실제 Mac 근거와 대조한 작업표다. 공식 PASS 판정은 아직 내리지 않는다.

| gate | 요구 | 확보한 실제 근거 | 남은 반례·근거 |
|---|---|---|---|
| G-PROCESS | fork/setsid/close-all-fds·leader/runner/broker/host SIGKILL·PID 재사용·restart에서 전체 후손 종료와 populated/empty/unknown producer | LaunchOnlyOnce+CID scope의 detached 후손·fence FD close·실행 owner 사망·Host SIGKILL 뒤 Society 배제 유지와 전체 scope 사망 뒤 재취득(012까지 세 Mac PASS). 다른 boot의 scope는 positive empty. 정상 Broker drain의 release 전 취소 정산 | Mac15 populated termination 1건 재확인, 실제 Worker/Pi scope의 kill-restart, 제품 경로에서 Broker SIGKILL 뒤 재시작 |
| G-FILES | directory-relative·no-follow·같은 inode repair·no-replace publish·parent flush·exact executable | Mac 공통 suite 466/466의 파일 경쟁·publication·repair, config generation 봉인 순서 수리, temp root 정규화, Seatbelt Worker private state anchor, image 검증 job scope의 Restic/Node exact image 결박 | StateRoot capture·private work/source fetch의 제품 경로 인수, x64 Restic(무서명) 대안 |
| G-AUTH | 실제 sender·살아 있는 process·현재 run 소속·기대 Broker·현재 권한 | Host↔자기 Broker child의 private child pin Mach RPC(012), Principal engine의 Host-attested Broker identity로 실제 Broker 호출·ADDRESS_NOT_FOUND(005 본문), Worker inherited peer endpoint의 실제 Worker 시작 | Worker 금지 효과 반례(worker-tools), restart·sleep 뒤 capability, release 서명 Keychain/SIP |

### 로컬 Linux 전체 회귀 — SOURCE132 입력

이 개발 host의 전체 local suite는 170 실패로 SOURCE110 기준선과 같은 수·원인 분류(namespace launcher ENOENT125·bwrap8·cloc5와 그 broker 경로 파생)다. SOURCE110 이후의 macOS 수리(temp root 정규화·private state anchor·preparation 정산·Restic Darwin 경로·engine 시작 진단·Broker 탐지·Host attestation 등)로 늘어난 Linux 실패는 없다. 새로 보인 `verification-policy`020은 이름을 바꾼 `darwin-evidence`006의 lane 요구 문자열 갱신 누락이었고 수리했다. Ubuntu CI job은 matrix의 마지막이라 매 push에 취소되었으므로 먼저 실행하도록 바꿨다.

### SOURCE131·132 실제 결과와 SOURCE133 진단

SOURCE132 `4393fca55c8`, Native42206468594. **Ubuntu job SUCCESS**(SOURCE119 이후 macOS 수리 전체의 실제 Linux 회귀 없음). 세 Mac 모두 **Worker probe(bootstrap·tools) PASS**: 실제 Seatbelt Worker 안에서 git·npm·collaboration record read·자기 script·`cc` compile/link가 동작하고 private read·shared write는 거절됐다(SDKROOT 수리 확인). **제품 경로 007(Human CLI)·008(Host가 SIGKILL된 Broker child를 재시작하고 Ctrl-D로 모두 종료) 세 Mac PASS**. 제품 경로는 Mac26·Mac15 6/8, Intel 5/8이다.
- 006: scripted Principal의 `oma_goal`(raw body를 stream하는 `context.publish`)이 Broker에서 `INTERNAL_ERROR`(acceptance unknown)로 끝났다. 같은 Host·Broker에서 일반 frame 호출인 `oma_send`(005)는 성공하므로 Mach 경로의 raw stream upload가 가장 유력한 후보다. 호출자에게는 INTERNAL_ERROR만 주되 Broker stderr에 원래 stack을 남기고, 시험은 Host 화면(Broker 알림 포함)을 보존한다.
- 005: 본문 PASS 뒤 정리에서 ENOTEMPTY가 반복된다. 정리 실패 시 `lsof +D`로 writer와 남은 파일을 보고한다.
- Intel 002(Personal 시작)는 이번에 처음 실패했고 원인은 다음 결과로 확인한다.

### SOURCE133 실제 결과와 SOURCE134

SOURCE133 `885bfed390b`, Native42218179357. Ubuntu SUCCESS. Mac26 제품 경로 6/9.
- 006: Broker stack은 `context effect or observation failed`(git context 게시의 accepted 실패)였으나 그 owner가 원래 오류를 버려 근본 원인이 없었다. 원래 오류를 cause로 보존하고 Broker 진단은 cause 사슬 전체를 출력한다.
- 009: GOAL 게시가 실패해 seed Worker가 활성화되지 않았다(Worker 요청 0). 006에 종속된다.
- 005: 정리 실패는 writer가 아니라 제품이 user immutable flag로 봉인한 private runtime generation이었다(다음 시작이 회수). 시험 root 정리가 flag를 먼저 해제한다.

### SOURCE134 실제 결과와 SOURCE135 수리 — Darwin pinned entry reopen

SOURCE134 `200237cb98d`, Native42225429924. Ubuntu SUCCESS. **Mac26 제품 경로 7/9**(005 정리 수리 확인). 006의 cause 사슬이 근본 원인을 보였다: GOAL 게시 뒤 mail fanout이 `reopenPinned`에서 실패해 `mail fanout is not fully materialized`였다.
Darwin pin은 권한 독립 O_PATH가 없어 O_EVTONLY(event-only) descriptor이고, 기존 Darwin reopen은 `/dev/fd/N`을 열었다. Darwin의 `/dev/fd`는 같은 open description을 복제할 뿐이라 event-only pin에서 read/write 접근을 얻지 못한다(§6.1의 duplicate 반례와 같은 성질). 따라서 기존 inode에 append하는 owned file(mail fanout·journal·log 등)의 Darwin 경로가 동작하지 않았다.
SOURCE135는 Darwin에서 pin이 가리키는 inode의 현재 경로를 `fcntl(F_GETPATH)`로 얻어 요청 flag와 `O_NOFOLLOW_ANY`로 다시 열고, 결과가 pin과 같은 dev/ino일 때만 반환한다. 다른 inode면 STORE_CORRUPT로 닫는다. Linux `/proc/self/fd` reopen은 그대로다. `native-darwin-reopen`001이 append·독립 read cursor·이름 변경 뒤 같은 inode 도달을 고정한다. 009(Worker submit)는 006의 GOAL 게시에 종속된다. status view 게시 실패는 하위 원인 전체를 기록하도록 했다.

### SOURCE136–141 실제 결과와 Worker 경로 수리 — `35f87752c76`…`b01fe578086`

Native42278291064·42299906781·42316088628·42329595190. Ubuntu 매 실행 SUCCESS. **세 Mac(Mac26·Mac15·Intel) 제품 경로 001–005·007·008 PASS**: Mac15 001의 Broker drain 실패(`native preparation became uncertain during shutdown`)는 settle이 scope 사망을 증명한 중단 준비를 미증명 후손으로 분류하던 것이었고, 그 경우만 "준비 상태 재확인 필요"로 바꿨다(`preparation-port`004, 기본 경로는 그대로 엄격). Intel 003은 간헐 정지 1회 뒤 재현되지 않았고 정지 시 Host stack sample을 남긴다.
Worker(006/009/010)는 runner 진단(`resident.ended`·`resident.launch` cause, runner stderr의 오류 코드)으로 순서대로 다음 원인을 드러냈다.
- relay socket 경로가 Linux 기준 107 byte 검사에 걸렸다 → 플랫폼별 sun_path(Darwin 103) 검사, 시험 run root는 짧은 `/tmp` 아래.
- relay는 https provider만 받는다(유지). Principal 엔진은 고정 환경만 받아 CA override가 차단 채널이므로(유지), 시험은 Principal을 평문 provider로 시작하고 첫 요청 시 엔진 기본 모델을 Broker가 신뢰하는 TLS provider로 옮긴다.
- `AUTH_FAILED: path is outside every root the confined engine has`: 역할이 기록한 확장(core 포함)은 설정된 설치 경로 아래인데 Darwin runner는 봉인된 private image만 Worker에 노출한다. 설치 경로 아래 확장을 image의 같은 파일로 옮기고 기록된 sha256은 spawn 직전에 그대로 재검사한다(`87ab083dde0`, Linux는 두 경로가 같아 무변경). 거절 메시지는 놓을 수 없던 경로를 포함한다.
세 gate 관측은 양 Mac에서 120/120 EXECUTED·notRun0이고 판정은 여전히 OPEN이다(판정 근거표 참조). `87ab083dde0`의 실제 Mac 결과는 아직 NOT_RUN이다.

### SOURCE142 진단 결과: Worker는 relay로 모델에 도달함

`80532fbeefd`의 Mac26 세션 기록에서 Seatbelt Worker가 relay를 거쳐 `groq/llama-3.1-8b-instant`에 요청하고 scripted 응답을 받은 것이 확인됐다. 006/009/010의 실패는 제품이 아니라 테스트 분류기 때문이었다. Worker 요청을 `Read /world/START.md`라는 옛 brief 문구로 찾았지만, 지금 brief는 인라인이 아니라 전달된 mail 파일(`/oma/mail/messages/…`)로 간다. 그래서 Worker 요청이 Principal 요청으로 분류되어 Principal 스크립트(`oma_goal`)를 받았다. 이제 분류기는 Worker 시스템 프롬프트의 첫 문장으로 Worker 요청을 찾고, 행위자는 시스템 프롬프트의 cwd `…/agents/<actor>/workspace`에서 읽는다.

### SOURCE143 결과와 Seatbelt Worker의 요청 캐시 수리

`b8761424622`의 Mac26 결과에서 제품 경로 001–008이 PASS였고, 006(goal→Seatbelt Worker→relay→모델)도 처음 통과했다. 009와 010에서는 Worker의 `oma_send`·`oma_merge`가 `request cache preparation failed: the directory /private cannot be observed now (EPERM)`로 ACCEPTANCE_UNKNOWN을 받았다. 요청 캐시와 output spool은 `.local/state/oma` 아래 디렉터리를 만든 뒤 `/`까지 모든 조상을 열어 fsync했는데, Seatbelt Worker는 HOME 위의 조상을 검색만 할 수 있고 열 수는 없다. HOME은 runner가 Worker 실행 전에 durable하게 만든 launch owner의 디렉터리다. 이제 두 경로(`ensureOwnedDurableDirectoryBeneath`)는 leaf부터 HOME까지의 모든 이름을 매 호출마다 flush한다. HOME이나 그 조상을 이번 호출이 직접 만들었을 때만 이전처럼 `/`까지 flush한다. 내구성 범위는 줄지 않는다. HOME 위의 이름은 이 호출이 만든 적이 없고, 그 barrier는 HOME을 만든 쪽이 이미 세웠다.

오류 문구(`the directory /private cannot be observed now`)를 다시 확인한 결과, 첫 실패 지점은 flush가 아니라 `ensureOwnedDirectory`였다. 이 함수는 소유 경계 `.local/state/oma`가 아직 없으면 `/`부터 한 단계씩 디렉터리를 열며 내려갔다. 이제는 경계가 없거나 owner가 읽을 수 없을 때 가장 가까운 기존 조상을 같은 한 번의 beneath/no-link 커널 walk로 잡고, 거기서부터 만들거나 수리한다. 위로 올라가는 이유는 부재(ENOENT)뿐이고, 경계 위의 다른 응답은 이전과 같은 root walk로 남긴다. 회귀 테스트 `owned-directory 009`는 검색 권한만 있는 상위 디렉터리로 이 조건을 Linux에서 재현한다. 수정 전 코드에서는 실패하고, 수정 후에는 통과한다.

로컬 Linux 전체 실행 결과(`74b1e1d47f5`, bwrap·cloc 미설치 개발 호스트)는 4890개 중 4653 pass, 167 fail이다. 이 중 134건은 `/usr/bin/bwrap` 부재로 namespace launcher가 시작하지 못한 실패다. 나머지 33건 가운데 요청 캐시 경로와 관련될 수 있는 9개 파일은 이번 storage/request-cache 변경 전 코드(`b8761424622`)로 되돌려도 똑같이 28 fail이었다. 이번 변경이 만든 회귀는 없다. 판정은 bwrap과 pinned 도구를 갖춘 CI Ubuntu job 결과를 기준으로 한다.

### SOURCE144 결과와 Seatbelt Worker의 caller git 수리

`74b1e1d47f5`의 Mac26에서는 요청 캐시 오류가 사라졌다. 대신 009와 010의 Worker 제출이 caller 준비 단계에서 `cannot resolve HEAD to a commit`으로 거절됐다. Worker의 bash `git commit` 자체는 성공했다. 실패한 것은 제출 준비 코드였다. 이 코드는 고정 경로 `/usr/bin/git`을 실행하는데, 이 파일은 macOS의 xcrun shim이다. shim은 DEVELOPER_DIR가 있으면 그 아래의 git을 고르고, 없으면 xcode-select 상태를 읽는다. 그런데 `GIT_ENV`가 DEVELOPER_DIR를 지우고, Seatbelt Worker는 xcode-select 상태를 읽을 수 없다. Worker launch는 Broker가 관찰한 developer tools로 DEVELOPER_DIR와 GIT_EXEC_PATH를 고정한다. 이제 caller 준비 경로(submit·merge·dirty 확인·code view·goal context)는 두 값이 모두 있을 때 같은 닫힌 developer-tools 문법(`describeMacDeveloperTools`)으로 검증한다. 그런 다음 shim이 골랐을 그 git을 직접 실행한다. 둘 중 하나라도 없거나 Linux이면 `/usr/bin/git`을 그대로 쓴다. 문법 밖의 경로는 UNSUPPORTED_PROFILE로 거절한다(`caller-git` 001–003).

`cb644cf212f`의 Mac26에서도 009/010의 Worker 제출은 계속 `cannot resolve HEAD to a commit`으로 거절됐다(001–008 PASS). 원인은 Worker 도구의 client 환경(`clientEnvironment`)이었다. 이 환경은 고정 허용 목록이라 launch가 고정한 DEVELOPER_DIR와 GIT_EXEC_PATH가 빠져 있었고, 그래서 caller git이 여전히 shim을 골랐다. 이제 두 값도 엔진 환경에서 client 환경으로 그대로 넘긴다(`caller-git` 004). 다음 진단을 위해 `resolveOid`는 git stderr의 첫 줄을 거절 메시지에 붙인다. 제품 시험 009/010의 commit 단계도 `pwd`·`command -v git`·`git rev-parse HEAD`를 함께 출력한다.

### SOURCE145 결과: Mac26 제품 경로 001–010 전체 PASS

`2865ac9da60`의 Mac26에서 제품 시험 10/10이 PASS했고 `common-runtime (macos-26)` job 전체가 success였다. goal을 받은 Seatbelt Worker가 commit을 만들고 제출했으며, Broker가 quarantine을 거쳐 공개했다(009). worker-1의 LOW 후보는 통합되어 canonical main이 이동했다(010). 같은 source로 Intel(macos-26-intel)과 macOS 15도 제품 시험 10/10 PASS, `common-runtime` job success다. 세 Mac 모두 제품 경로 001–010 PASS.

### SOURCE146 결과와 Darwin job 종료 경쟁 수리

`b808e266254`의 Mac26에서 제품 시험 11/11 PASS였다. 새로 넣은 011도 통과했다. Worker 엔진을 SIGKILL하면 detached 후손까지 끝났고, 받지 못한 batch는 scope 종료가 확인된 뒤 새 엔진으로 다시 전달됐다. macOS 15도 제품 시험 11/11 PASS였다. 같은 run에서 실패한 세 단계는 다음과 같다.
- Ubuntu의 `status-responsiveness` 001: event loop 지연 226ms. 로컬에서 3회 연속 PASS였고, 공용 코드 변경을 모두 포함한 직전 두 run의 Ubuntu도 success였다.
- macOS 15의 storage 003: Restic job close에서 `job resources are still live`. 직전 run은 19/19였다.
- Intel의 009: Broker가 제출을 `UNSUPPORTED_PROFILE`로 거절. 직전 run은 PASS였다.

storage 실패의 원인은 job helper 종료와 커널 coalition 집계 사이의 경쟁이었다. helper가 끝나는 즉시 scope를 닫힘으로 표시했기 때문에, 그 직후 `close()`가 아직 populated인 coalition을 보고 거절할 수 있었다. 이제 helper가 끝난 뒤 populated이면 최대 5초 동안 empty가 되기를 기다린다. unknown이거나 그 뒤에도 populated이면 이전처럼 live로 남아 `close()`가 거절한다. Intel 009는 Broker의 거절 원인이 결과에 남지 않았다. 그래서 009/010이 실패하면 Host 화면에 찍힌 Broker 운영 출력도 함께 기록하도록 했다.

### SOURCE147 결과와 settle 위치 수정

`a65c7e8b24f`에서 Mac26·macOS 15·Ubuntu는 job success였다. Mac26과 macOS 15는 제품 시험 11/11, storage 19/19였다. Intel은 제품 시험 11/11 PASS였지만 `native-runtime-generation`이 JavaScript heap 2GB OOM(SIGABRT)으로 실패했다. 이 시험은 직전 두 run에서 PASS였고, 그 사이 바뀐 실행 코드는 job control poll의 settle뿐이다. settle이 4ms poll 경로에서 helper 종료 뒤 최대 5초 동안 coalition 조회를 반복했기 때문에, 이것이 회귀 원인일 가능성이 크다. 정확한 할당 경로는 아직 확정하지 못했다. 그래서 poll 변경을 되돌리고, 경쟁이 실제로 난 Restic 경로에 공용 execution owner와 같은 방식의 settle을 넣었다. close 전에 10ms 비동기 간격으로 최대 5초 동안 empty를 기다리고, unknown이거나 그 뒤에도 populated이면 이전처럼 `close()`가 거절한다. 함께 넣은 수정으로, 개발 도구 관측이 deadline에 걸리면 이제 `DEADLINE_EXCEEDED`가 된다. 영구 `UNSUPPORTED_PROFILE`이 아니다(`native-mac-developer-tools` 002).

### SOURCE148 결과

`7797b334d63`에서 Mac26·Intel·Ubuntu는 job 전체 success였다. Intel의 generation OOM은 재발하지 않았다. macOS 15는 storage 단계에서 실패했는데, 시험이 시작되기 전에 고정 Restic을 GitHub에서 내려받다가 `NGHTTP2_REFUSED_STREAM`으로 연결이 거절된 것이다. 제품 시험은 PASS였다. `scripts/install-restic.mjs`는 이제 transport 오류와 5xx 응답을 최대 4회까지 간격을 두고 재시도한다. 4xx는 즉시 실패한다. 어느 시도에서 받은 bytes든 고정 archive·binary digest를 그대로 통과해야 한다(`restic-setup` 8/8).

### SOURCE149 결과와 generation 시험 OOM 원인 정정

`18d5e3f712b`에서 Mac26·macOS 15·Ubuntu는 job 전체 success였다. macOS 15 storage도 PASS였다. Intel은 `native-runtime-generation`이 다시 heap 2GB OOM으로 실패했다. 이 코드에는 job control poll 변경이 없으므로, SOURCE147에서 OOM을 그 변경 탓으로 본 추정은 틀렸다. 원인은 시험 자체의 계측이었다. 시험은 설치본 전체를 복사하는 동안 `fs.readSync`·`writeSync` 등을 `t.mock.method`로 감쌌고, mock은 호출마다 인자와 결과(복사한 Buffer)를 보관한다. arm64에서는 한도 안이었지만 x64에서는 이 누적이 heap 한도를 넘었다. 이제 계측은 원래 함수를 직접 감싸 횟수·시간·바이트만 센다. 제품 코드는 바뀌지 않았다. Restic 경로의 settle은 그대로 유지한다.

### SOURCE150 결과: 네 runtime job 전체 success

`f2e466b7c23`의 Native [42484637825](https://github.com/minjung2035/oma-v2-ci/actions/runs/42484637825)에서 `common-runtime`의 Mac26·Intel(macos-26-intel)·macOS 15·Ubuntu 네 job이 모두 success였다. 같은 source로 처음 전부 통과한 run이다. 여기에는 제품 경로 001–011, Society 소유권, 공통 suite, installed generation, 독립 설치, Restic storage, Linux native 회귀가 포함된다. darwin-gates는 세 gate 판정이 OPEN이어서 설계상 BLOCKED이다.

### SOURCE151 결과

`0cd1849aeab`에서 제품 시험 001–012가 세 Mac 모두 PASS였다. 새 012도 통과했다. runner를 SIGKILL하면 그 엔진 scope와 detached 후손이 끝나고, 그 뒤에만 batch가 새 엔진으로 다시 전달됐다. Intel·macOS 15·Ubuntu는 job 전체 success였다. Mac26은 공통 suite의 `native-sync-directory` 002 하나가 `execution or scope cleanup is unconfirmed`로 실패했다. 이 시험은 이전 run들에서 PASS였다. 오류 메시지에 원인이 남지 않았으므로, 공용 execution owner가 정리 실패의 원인 요약을 메시지에 함께 남기도록 했다.

`7c58aa18517`의 Native [42627628732](https://github.com/minjung2035/oma-v2-ci/actions/runs/42627628732)에서 네 runtime job(Mac26·Intel·macOS 15·Ubuntu)이 모두 success였다. 제품 시험 001–012를 포함하며, Mac26의 `native-sync-directory` 002 실패는 재현되지 않았다.

`7c58aa18517`의 Architecture verification baseline은 Linux 시간 기준 시험 두 개로 실패했다: `status-responsiveness` 001(변경 요청과 섞인 status 처리 중 event loop 183ms, 기준 100ms. SOURCE146에서도 226ms로 한 번 실패)과 `powercut-lane` 009(복구 child timing 시뮬레이션). 둘 다 이번 macOS 작업이 바꾸지 않은 Linux 경로이고 이전 run에서는 PASS였다. 변경 요청의 동기 fsync가 CI 공유 디스크에서 느려질 때의 변동으로 보며, Linux 기준값은 바꾸지 않는다. `47be9ce35fe`의 Mac26 job은 실패한 단계 없이 runner 쪽에서 취소됐다.

`47be9ce35fe`의 macOS 15에서 새 013이 실패했다: Broker SIGKILL·재시작 뒤 같은 Principal의 두 번째 호출이 `ADDRESS_NOT_FOUND`를 받지 못했다. 나머지 12개는 PASS였다. 실패 메시지는 대화 기록에 반복되는 첫 결과로 잘려서 두 번째 답을 담지 못했다. 이제 013은 마지막 답 전체와 Host 화면의 Broker·거절 줄을 출력한다. Host는 Broker readiness마다 Principal을 다시 등록하고 그때 Broker identity를 다시 attest한다(`society-runtime.ts`의 `register`).

`58b52fda5d7`의 macOS 15에서 013의 실제 답을 확인했다. Broker SIGKILL·재시작 뒤 같은 Principal의 `oma_send`가 `BROKER_UNAVAILABLE`(ACCEPTANCE_UNKNOWN)을 받았다. Host 화면에는 이전 generation이 죽을 때의 `[Mail] Delivery error: Mach destination is no longer observed available`과 `broker restarted`가 남았다. 이것은 재시작 뒤 현재 권한이 회복되지 않는 실제 제품 결함 후보다. Host의 `hostChannel`과 엔진의 `dialAttestedMachChannel`은 둘 다 호출마다 현재 generation이나 이름을 새로 조회한다. 그래서 남은 후보는 재등록 경로(`register`: record 준비 실패 시 credential 없이 반환)다. 그 알림은 Broker라는 단어를 포함하지 않아 이전 화면 필터에서 빠졌다. 이제 013은 Host 화면의 모든 고유 알림을 순서대로 출력한다.

`a1a4872accf`의 Mac26 화면 전체를 보면, 재등록 실패 알림("records could not be refreshed", "rejected", "could not be attested")은 하나도 없었다. 두 번째 호출은 0.5초 만에 실패했다. 실패 형식 `{"code":"BROKER_UNAVAILABLE","message":"BROKER_UNAVAILABLE","retry":"same-key"}`은 Broker의 공개 오류 frame이다. 따라서 요청은 재시작한 Broker에 도달했고, 그 Broker가 원인을 숨긴 채 BROKER_UNAVAILABLE로 답했다. Broker는 지금까지 INTERNAL_ERROR의 원인만 자기 stderr에 남겼다. 이제 BROKER_UNAVAILABLE의 원인도 남긴다. 호출자가 받는 응답은 바뀌지 않는다.
