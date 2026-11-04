# 현재 검증 상태 — 2026-11-04 KST

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

## 검증 입력과 LOC

아래 값은 문서 기록 후 **구조 검사의 입력 identity**다. 전체 runtime 실행의 입력 hash는 위 별도 manifest가 소유하며, 구조 digest를 갱신해 runtime PASS를 만들지 않는다.

verification input digest `e27bd52a4947689d40df94ae22ddb89ff535f6d7f523c79c69ef28f6921c78db` (15828 files).

소스 목록은 [production-files.txt](../../production-files.txt), per-file hash는 [production-loc-hashes.json](../../production-loc-hashes.json)에 있다. 이전 cloc 2.08 측정은 354 files / 35,832 code LOC였다. 이 역사적 기록은 현재 source의 LOC claim이 아니며 새 측정값으로 사용하지 않는다. 현재 LOC는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`에서 확인한다.
