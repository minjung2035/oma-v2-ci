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

## 검증 입력과 LOC

아래 값은 문서 기록 후 **구조 검사의 입력 identity**다. 전체 runtime 실행의 입력 hash는 위 별도 manifest가 소유하며, 구조 digest를 갱신해 runtime PASS를 만들지 않는다.

verification input digest `d236558d4f02c74727503c7839bafefc4dda126700d6b5c73d83e5b3e4d697fd` (15830 files).

소스 목록은 [production-files.txt](../../production-files.txt), per-file hash는 [production-loc-hashes.json](../../production-loc-hashes.json)에 있다. 이전 cloc 2.08 측정은 354 files / 35,832 code LOC였다. 이 역사적 기록은 현재 source의 LOC claim이 아니며 새 측정값으로 사용하지 않는다. 현재 LOC는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`에서 확인한다.
