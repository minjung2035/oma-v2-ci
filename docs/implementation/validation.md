# OMA v2 — 현재 검증 상태

DR49 native 전환은 미완료다. 최신 지시는 **Priority 0를 유지해 Linux 검증을 마감한 뒤 지정 work branch를 push하고 macOS 작업을 재개하는 것**이다. 아래 Linux 인수검증을 마쳤으며, 문서 정합성·commit/push와 실제 Mac 관측은 각각 별도 단계다.
아래 실행 결과는 각 당시 입력의 기록이며 현재 source의 전체 PASS가 아니다.
추가 CI에서 Linux rootfs 준비의 native EAGAIN1건을 확인해 재인수를 우선했고, 아래 [새 수정 입력의 전체 재인수](#linux-eagain-수리-뒤-실제-재인수)를 마쳤다. 과거 마감/PASS와 원시 실패는 그대로 보존한다. 문서 반영 뒤 clean 발행/CI 입력을 dirty 실행 입력과 합성하지 않는다.

## Mac exact Unix socket 번역 — 실제 kernel 검증 전

Linux 재인수를 마치고 주 `1a4829819d5876427e3df85863ab022c7f82e575` /
mirror `ae819c1c8adb02286cc24ea7b60b21e788be93c7`를 지정 work branch에 발행했다.
tree `c5d45c9649b49051070c92fc2c74f11f3e957733`는 같고 clean input은
`f334d462f65b19c76fbd658f8171a14f081a5a47a01a22689b5cf04b01dde8d2` /15687 files다.
이는 앞선 실제 runtime의 dirty `02fd1a08…` 입력과 별개다. clean mirror architecture는 exit0다.
README/WATCHDOG 제외·보존, 위임·merge·deploy 없음, 검증 후 소유 설치본/auth/state와 private tool mount를 제거했다.
제거 전 retained evidence282개를 opaque credential과 대조해 실제 값 일치0을 확인했다.

Native [40784728767](https://github.com/minjung2035/oma-v2-ci/actions/runs/40784728767)의 SHA256 대조 ZIP을 회수했다.
Ubuntu job은 success이고 common246/246·Linux integration433/433·execution46/46·Restic-setup8/8,
모두 fail/cancel/skip/todo0이며 source/input 전후 동일이다.
두 Mac common은 각254/254·skip0다. Mac26 packed는26/27·기존 Git preparation guard의 `UNSUPPORTED_PROFILE`1 FAIL이다.
**Mac15는 같은 package 판정이 아니다.** `@oma/tool-web`의 `npm pack --json --ignore-scripts`가120초 budget에서
`spawnSync npm` ETIMEDOUT였다. 원인은 미분류이며 installed workspace qualification에 도달하지 못했다.
이미 stdout은 소유 파일로 streaming하고 있어 buffer overflow로 단정하지 않는다. timeout·성공 조건을 늘리거나 전용 재현 loop를 만들지 않았다.
양 Mac gate는120 executed /108 OBSERVED·product BLOCKED, G-PROCESS/G-FILES/G-AUTH 모두 OPEN이다.
Architecture [40784728753](https://github.com/minjung2035/oma-v2-ci/actions/runs/40784728753)은 이후 completed/success를 확인했다.
같은 clean source `ae819c1c8a`·input `f334d462…`의 실제 serial all3954/3954·errors[]와
baseline14/14+3940/3940·fail/cancel/skip/todo0, 모든 numeric command exit0를 원시에서 대조했다.
fast881·durable872·property34·stress16·platform72도 모두 PASS·skip0다. CI baselineComparison은 NOT_AVAILABLE이며
앞선 local COMPARED와 혼합하지 않는다. kernel/crash standalone은 NOT_RUN이고 native-all의 실제 파일·required names로 포함됐다.
ZIP12860411239/12861155478의 공개 SHA256을 확인했다. `clean-source-full-ci-qualification.json`·원시 exit ledger·
lane reports는 Linux 재인수 root의 `published-ci/`에 있다. 이 통과로 원래 CI 경합 주체나 과거 Git 실패 원인을 확정하지 않는다.

그 뒤 Mac production `seatbeltProfile`의 Unix 규칙을
`network-outbound (remote unix-socket (literal …))`에서 `network-outbound (literal …)`로 좁게 바꿨다.
[고정 upstream 원본](https://raw.githubusercontent.com/eugene1g/agent-safehouse/v0.12.0/profiles/20-network.sb)의 exact DNS socket 표현을 대조했다.
다른 network/file/Mach grant·기본 endpoint·resolver·exec guard는 바꾸지 않았다.
기존 실제 e9a939d619의 raw connect EPERM18건은 변경 전 반례이며, 새 spelling이 원인이었음은 실제 교체 실행 뒤 판정한다.

`darwin-launchd.mjs`는 짧은 소유 Unix socket directory에 실제 listener 둘을 만든다.
같은 부모의 read/metadata 접근은 같고 listed path만 network allowlist에 넣는다. host native probe는 둘 다 실제 connect0을 요구한다.
같은 inherited/port-pruned Node 아래 helper가 DNS·listed·unlisted connect를 각각 기록한다.
argv/report·실제 child PID/UID·endpoint 대조를 validator/factory와 함께 cutover했다.
unlisted의 예상 밖 성공이나 listed/DNS 실패를 없애거나 SETUP_FAILED로 숨기지 않고 actual observation으로 보존한다.
원래 forbidden-file canary·Git/compiler·fresh service target·registered-seed 재취득 관측과 deadline도 유지했다.

| 이 새 변경의 local 실행 | 결과 | 확대 해석 금지 |
|---|---|---|
| production inventory·review stale·DAG·build | 모두 exit0 | 과거 authored review 재승인 없음 |
| 기존 parser·Seatbelt regression |41/41·fail/cancel/skip/todo0 | 합성 evidence grammar·policy contract이지 실제 Mac kernel proof 아님 |
| 실제 영향 caller·Linux layout/profile regression |18/18·fail/cancel/skip/todo0 | 이 선택 실행을 전체 Linux suite라고 부르지 않음 |
| 변경 MJS와 실제 생성 Node module | syntax exit0 | Darwin C compile/link 대체 아님 |
| 실제 fixture의 Linux 실행 | exit1, state 생성 전 실제 OS guard 거절 | Mac 성공이나 sandbox 적용 proof 아님 |

위 local checkpoint에서는 SDK15.5/26.5 compile·normal DNS·listed0/unlisted거절이 NOT_RUN이었다.
이후 실제 실행은 아래에 별도로 기록하며 Mac 설치 완료·complete-scope/backend 채택·세 gate 완료로 합성하지 않는다.
원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-macos-resume/exact-unix-sockets/`다.

### 후속 실제 Unix 경계와 DNS 잔여 거절

주 `3001f967ae76ec52e7cbd8381f0ebd864d7e0255` / mirror `2b8c6f276db7ee2901ed52697b6c9019871029ed`,
tree `b930db4f7a5b7c9a62a6349cf76c0e61b5fa44eb`를 발행했다. Native
[40788082771](https://github.com/minjung2035/oma-v2-ci/actions/runs/40788082771)의 SHA256 확인 ZIP5개를 회수했다.
clean `45a155109641ad8929d962dc5253b6cb59608cbf1ab73908fc197532e5b7373d` /15687 files와 runtime bytes는 전후 동일이다.
양 SDK 실제 compile/link·새 case 각3회 OBSERVED다. GUI UID501·SIP-disabled 관측이며 세 gate는 여전히 OPEN이다.

| 두 Mac의3회·3 variant, 총18 actual 실행 | 실제 결과 | 판정 |
|---|---|---|
| 같은 read-only 부모의 listed Unix socket |18회 connect0 | 명시된 literal network 허용 확인 |
| 같은 부모의 unlisted Unix socket |18회 connect -1/EPERM1 | 부모의 file read 접근만으로 IPC까지 허용되지 않음 |
| 시스템 DNS Unix socket |18회 생성 성공·connect -1/EPERM1 | generic Unix 번역 수리만으로 DNS가 해결되지 않음 |
| DNS-SD·libc·Node |18회 -65563·getaddrinfo8/errno1·ENOTFOUND | 정상 DNS 기능은 아직 미충족 |
| selected Git·compiler·자기 쓰기·금지 file canary |모두 기대 결과 | root 제거의 정상 도구 호환성을 DNS까지 확대하지 않음 |

host 두 private listener와 native DNS는 양성이다. endpoint는 `/var/run/mDNSResponder`와 실제 canonical
`/private/var/run/mDNSResponder`를 선언했고 native/outer stderr는 비어 있다. 같은 경로 grant 부족의 구체적 operation은 아직 분류하지 못했다.
Mac common은 각254/254, Ubuntu246/246·skip/cancel/todo0이다. 이 source의 두 Mac packed는26/27이며
기존 Git preparation guard1건이 실패했다. 직전 Mac15 pack ETIMEDOUT는 이 실행에서 재발하지 않았으나 원인 수리 증거는 아니다.
양 Mac120 executed /108 OBSERVED·12 SETUP_FAILED·product BLOCKED는 유지한다.

원시는 `exact-unix-sockets/actual-unix-dns-{outcomes,summary}.json`·`actual-allowlist-qualification.json`·
`actual-dns-stderr-and-aliases.json`와 `published-ci/`의 실제 source별 ZIP이다.

### 시스템 endpoint metadata 최소 후보 — 실제 실행 전

로컬 listener에는 명시한 read-only 부모 접근이 있고 시스템 socket에는 없다는 차이를 다음 질문으로 좁혔다.
[고정 XNU unp_connect](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/uipc_usrreq.c#L1290)는
`namei`·socket 종류 확인·MAC connect 검사·vnode DAC authorization을 거친다. 이것만으로 어떤 Seatbelt operation이 거절됐는지 확정하지 않는다.
당시 후보는 선언된 exact Unix endpoint에 `file-read-metadata`만 추가했다. file contents·write·조상 subpath·새 Mach service는 허용하지 않았다.
원래 read-equalized listed/unlisted 반례·DNS 원시 단계·deadline·guard는 유지한다.
후보의 inventory/review stale/DAG·build와 guard를 유지한 caller regression59/59는 통과했다.
이 checkpoint에서는 실제 Mac 효과가 NOT_RUN이었다. 아래 교체 실행에서 효과가 없음을 확인해 그 grant를 제거했다.

주 `65be121d10a4b5a7179951d8cc18047f0c477eaa` / mirror `f75a06eeeb7e647aa0ac5a6ebb33d670604053c9`,
tree `d7882eb2f1377c0c328c30b10dc2ac4b2b4d926a`, clean `24357a4a88c565d0c641f4055096da425874eb83ac585e18b34ba1df062717c6` /15687 files다.
Native [40791224507](https://github.com/minjung2035/oma-v2-ci/actions/runs/40791224507)의 실제 양 Mac 각3회·18 variant는
metadata 후보 뒤에도 시스템 connect EPERM1·DNS-SD -65563·getaddrinfo8·Node ENOTFOUND로 같았다.
private listed0/unlisted EPERM은 유지했다. exact leaf metadata 단독으로 DNS가 수리된다는 가설은 지지되지 않았고,
관측된 이익이 없는 grant를 production에 남기지 않았다. metadata가 언제나 불필요하다는 일반 명제는 아니다.
원시는 `endpoint-metadata-candidate/actual-metadata-{outcomes,summary}.json`·`candidate-rejection.json`·source별 ZIP이다.

### DNS 경로와 실제 거절 operation 분리 — 실행 전

이 진단 source의 production은 앞서 실제 확인한 exact network literal만 남겼다.
작은 C 진단은 libc resolver를 대체하지 않고 alias `/var/run/mDNSResponder`와 canonical
`/private/var/run/mDNSResponder`의 raw connect를 독립 수행한다. `/var`·alias·canonical의 실제 lstat도 별도로 기록한다.
오류일 때 종류는 null이며 absent·socket·directory로 추정하지 않는다. PID/UID·path·typed 결과를 validator/factory와 함께 결박했다.
[Apple의 공식 진단 절차](https://developer.apple.com/documentation/security/discovering-and-diagnosing-app-sandbox-violations.md)에 따라
가능하면 실제 소유 DNS observer PID만의 `com.apple.sandbox.reporting`/`com.apple.sandbox` violation을 read-only 수집한다.
원래 fixture budget 안에서만 수행하고 접근 거절/timeout/미수집을 그대로 남긴다. 로그 부재는 거절 부재·role/scope/death proof가 아니다.
이 진단을 위해 root·새 sandbox grant·resolver override·성공 조건/timeout 완화를 추가하지 않았다.
build·guard를 유지한 caller regression59/59·변경 MJS와 실제 생성 Node module syntax는 통과했다.
이 local checkpoint에서는 새 canonical/metadata/denial 관측의 실제 Mac 실행은 **NOT_RUN**이었다.
원시는 `exact-unix-sockets/dns-path-and-denial/`이고, 이후 실제 결과는 다음과 같다.

주 `d82484b292875ea2a1925cef923f91672534ff55` / mirror `9956e673800acdcb62bd595bb896a165c2be3c1e`,
tree `a741e95f2b6a82f14106010b78a4c105eaa20d04`, clean `3f31c762e52867065529f7bbed766b8c34ae9d3a37a940d6bc0dfefba0101a29` /15687 files다.
Native [40794027231](https://github.com/minjung2035/oma-v2-ci/actions/runs/40794027231)의 공개 SHA256 확인 ZIP5개를 회수했다.
양 SDK compile/link·각3 case OBSERVED이고18 variant 모두 canonical connect0·alias connect -1/EPERM1이다.
`lstat("/var")`는 host에서는 성공·symlink, sandbox에서는 -1/EPERM1·kind null이다.
DNS-SD -65563·getaddrinfo8·Node ENOTFOUND는 여전하며 listed0/unlisted EPERM도 유지했다.
소유 DNS observer PID만의 log6회가 모두 수집됐고 실제 `file-read-metadata /var` 거절을 기록했다.
canonical leaf의 명시적 lstat도 metadata 거절이나 raw canonical connect는 성공한다. leaf metadata 단독 grant를 복원하지 않는다.
명시적 lstat 자체의 거절과 resolver 내부 거절을 로그만으로 일대일 귀속하거나 duplicate report를 syscall 횟수로 세지 않는다.
원시는 `actual-path-outcomes.json`·`actual-scoped-denial-records.json`·`actual-relevant-denials.json`과 source별 ZIP이다.
이는 alias traversal 원인 후보를 좁힌 근거이며 정상 DNS·complete backend proof가 아니다.

### /var root symlink metadata 후보 — 실제 효과 미검증

기존 DIRECTORY metadata 허용은 `/var` symlink를 포함하지 않는다. production에
`(allow file-read-metadata (literal "/var"))`만 추가했다. 파일 내용·directory entries·write·broad subpath,
추가 Mach service·resolver fallback·timeout 완화는 없고 기존 실행 guard·Linux backend도 유지한다.
inventory·review stale·DAG·build는 exit0, guard를 유지한 caller regression59/59·fail/cancel/skip/todo0다.
이 local checkpoint에서는 후보의 실제 Mac 효과가 **NOT_RUN**이었다. 이후 실행은 다음과 같다.
원시는 `exact-unix-sockets/var-symlink-metadata/`다.

주 `c68aa2826d24baf14749db1503b67452b1f175fe` / mirror `46a5c6b4427fe67e2f5a797fa53845dad74ad180`,
tree `a768c5ce3fbda9cc63e011b47724b343fd52d672`, clean `5aefad9164bff84d0e973ec25ac0458e1d5bbacd9f644f71eccd99c6cd2aec2d` /15687 files다.
Native [40796369607](https://github.com/minjung2035/oma-v2-ci/actions/runs/40796369607)의 SHA256 확인 ZIP5개를 회수했다.
두 Mac 실제 compile/link·각3 case OBSERVED이며 source/input/runtime bytes는 전후 동일하다.

| 두 Mac·각3회, mode별6 variant | alias connect·DNS-SD | Node lookup | native C getaddrinfo |
|---|---|---|---|
| inherited |6회 모두0 |6회 성공 |6회 성공 |
| bootstrap-only |6회 모두0 |6회 성공 |6회 EAI_NONAME8/errno1 |
| bootstrap-and-xpc |6회 모두0 |6회 성공 |6회 EAI_NONAME8/errno1 |

listed0/unlisted EPERM·Git/compiler0·자기 쓰기·금지 file EPERM은 모든 variant에서 유지했다.
`/var` lstat는 이제 성공·symlink이며 DNS socket leaf의 명시적 metadata 조회는 계속 거절된다.
성공한 getaddrinfo의 잔여 errno1은 API 실패로 해석하지 않는다. resolver나 native C의 hostname/service/flags를 바꾸지 않았다.
bootstrap 제거 조건의 C 실패와 Node 성공을 합쳐 “DNS 전체 완료”라고 하지 않는다.
소유 PID log는 새 `file-read-metadata /etc` 거절을 기록했고 syslog/notification-center 거절도 보존했다.
그 incidental service에 새 권한을 주지 않는다. inherited의 범위 밖 service 실행 반례도 남아 있어 backend 채택·세 gate 완료가 아니다.
Mac common은 각254/254·Ubuntu246/246, Linux integration433/433·execution46/46·Restic-setup8/8·모두 skip/cancel/todo0이다.
Mac packed는 기존 Git preparation `UNSUPPORTED_PROFILE`을 계속 기록했다.
`actual-dns-and-boundary-outcomes.json`·`actual-dns-qualification.json`·`actual-owned-pid-denials.json`·
`actual-relevant-denials.json`·`actual-common-runtime-and-package-result.json`에 부분 수리와 잔여 실패를 함께 남겼다.
Architecture [40796369599](https://github.com/minjung2035/oma-v2-ci/actions/runs/40796369599)도 completed/success다.
같은 clean `46a5c6b442`·`5aefad91…`의 SHA256 확인 ZIP2개에서 all3954/3954·baseline14/14+3940/3940·
모든 numeric command exit0와 fast881·durable872·property34·stress16·platform72 PASS·skip/cancel/todo0·errors[]를 대조했다.
baselineComparison은 NOT_AVAILABLE이고 standalone kernel/crash는 NOT_RUN·native-all 실제 파일/required names 포함이다.
`published-ci/clean-source-full-ci-qualification.json`에 원시 artifact metadata와 함께 남겼으며 이후 source로 소급하지 않는다.


### /etc root symlink metadata 후보 — 실제 효과 미검증

이미 read 허용된 canonical system files에 도달하는 `/etc` symlink의 metadata만 추가했다.
production rule은 exact `/var`와 `/etc` metadata이며 data/write·조상 subpath·추가 Unix/Mach service는 허용하지 않는다.
기존 native C의 `getaddrinfo("example.com", "443", …)`를 그대로 유지해 잔여 실패 수리 여부를 판정한다.
inventory·review stale·DAG·build는 exit0, guard를 유지한 caller regression59/59·fail/cancel/skip/todo0다.
이 local checkpoint에서는 후보의 실제 Mac 효과가 **NOT_RUN**이었다. 이후 주 `b83250394c6c94482fc0619f70a369cd677072f7` /
mirror `3a131bf0d9039330f3e17124eb404c0b67bef5e5`, tree `1ba6bee2c2ad0c72896f20846271c22c36ca2c7b`,
clean `7c5727c253aabaf79ced528df0d581e1bce073140b402dec067ab95e87207d7c` /15687 files를 발행했다.
Native [40799190650](https://github.com/minjung2035/oma-v2-ci/actions/runs/40799190650)의 SHA256 확인 ZIP5개에서
양 Mac 각3 case OBSERVED·18 variant를 확인했다. alias connect·DNS-SD·Node DNS·listed0/unlisted EPERM·
Git/compiler·금지 file 경계는 유지됐지만 native C는 inherited6회 성공·bootstrap 제거12회 EAI_NONAME8/errno1로 그대로다.
따라서 `/etc` metadata 단독은 native libc 수리가 아니다.
소유 PID를 mode와 대조하니 route sysctl·networkd preference·AF_SYSTEM 거절은 **성공한 inherited C**에만 기록됐다.
이를 failing mode의 원인으로 바꾸거나 새 권한을 주지 않는다. `/etc` alias의 실제 filesystem 효과는 아래 결정적 helper 회귀에서 별도로 판정한다.
원시는 `exact-unix-sockets/etc-symlink-metadata/actual-dns-and-boundary-outcomes.json`·
`actual-libc-candidate-qualification.json`·`actual-denials-by-mode.json`·source별 ZIP이다.

### 동일 libc 호출의 service·thread 분리와 alias 회귀 — 실제 Mac 실행 전

[Node26 binding](https://github.com/nodejs/node/blob/v26.0.0/src/cares_wrap.cc#L1946-L2005)은 null service를
[libuv worker](https://github.com/nodejs/node/blob/v26.0.0/deps/uv/src/unix/getaddrinfo.c#L94-L100)에서 호출한다.
기존 C는 main에서 socket/DNS-SD 관측 뒤 service443을 호출했다. 두 차이를 원인으로 단정하지 않는다.
[고정 Libinfo wrapper](https://github.com/apple-oss-distributions/Libinfo/blob/39b70c515baee5b609e7e91693edbd934b6845a1/lookup.subproj/libinfo.c#L2450-L2508)와
SDK15.5/26.5는 flags0의 AI_DEFAULT 전환을 명시하지만 이 upstream revision과 설치된 binary의 일치는 미확인이다.

원래 C 호출과 raw 실패는 그대로 남겼다. 별도 owned process로 같은 C image의 main/service443·main/null service·
pthread/service443을 실행하고 실제 PID/UID·context/service·task/registered/global bootstrap·raw getaddrinfo를 기록한다.
host 세 양성·실제 argv/report 경로·PID/UID를 validator/factory와 함께 결박했고 실패/timeout/null도 OBSERVED로 보존한다.
추가 network/file/Mach grant·원래 flag 변경·resolver override·timeout 확대는 없다.
기존 strict `seatbelt-files`에는 실제 `/var`·`/etc` metadata, host hash와 같은 `/etc/services` bytes,
host에서 읽을 수 있는 `/etc/passwd`의 sandbox 거절을 추가했다. 외부 DNS 없이 실제 helper의 alias/data 경계를 검증한다.
새 build·caller59/59·fail/cancel/skip/todo0·변경 MJS/실제 생성 module syntax·Linux의 state 생성 전 OS 거절은 통과했다.
이 local checkpoint에서는 Mac compile/link·resolver 비교·alias 회귀가 **NOT_RUN**이었다.
원시는 `exact-unix-sockets/libc-isolated-comparison/`·`alias-boundary-regression/`이고 이후 실제 결과는 다음과 같다.

주 `bf0f3e7aee5057a2058dca46628417c1d91b11b3` / mirror `2abeceb800b6805b35a3af80548b20cbd428c799`,
tree `3d7e1f849302d6325ec1fb8096f547f734b7a69b`, clean `25f0fb06d4d1f81ce4178f815b9f103705db5d6a1104c01c42e101c42d8e7336` /15687 files다.
Native [40803548005](https://github.com/minjung2035/oma-v2-ci/actions/runs/40803548005)의 SHA256 확인 ZIP5개를 회수했다.
양 Mac SDK compile/link·bootstrap 각3 case OBSERVED이며 새 비교는 총54개 실제 owned process다.

| 같은 C image의 독립 호출 | inherited | bootstrap-only | bootstrap-and-xpc |
|---|---|---|---|
| main·service443 |6회 성공 |6회 EAI_NONAME8 |6회 EAI_NONAME8 |
| main·null service |6회 성공 |6회 EAI_NONAME8 |6회 EAI_NONAME8 |
| pthread·service443 |6회 성공 |6회 EAI_NONAME8 |6회 EAI_NONAME8 |

실패한 isolated C의 task/global bootstrap은 모두0이다. service 유무·thread 전환·선행 DNS-SD 호출만으로 실패를 설명하지 못한다.
원래 C 실패12회·Node DNS 성공18회와 listed0/unlisted EPERM·금지 file 거절도 그대로 보존됐다.
새 비교를 정상 libc 수리로 부르지 않는다. Node 자신의 post-exec task/global 상태는 이 source에서 관측하지 않았다.

두 Mac의 strict `seatbelt-files` 각3회도 실제 helper·exit0·OBSERVED다. `/var`·`/etc` metadata와 host hash와 같은 services bytes,
host에서 읽히는 passwd의 sandbox 거절·기존 file/symlink/hardlink/상속 후손 경계를 함께 확인했다.
이는 `/etc` exact metadata의 실제 filesystem alias 이익이며 native libc 수리나 G-FILES 전체 완료는 아니다.
`actual-isolated-resolver-outcomes.json`·`actual-original-outcomes.json`·`actual-matrix-qualification.json`·
`alias-boundary-regression/actual-runtime-qualification.json`에 결과를 남겼다. 양 Mac120 executed/108 OBSERVED·12 SETUP_FAILED·세 gate OPEN은 유지한다.

### Node 자신의 post-exec bootstrap·cached/global 복원 — 실제 Mac 실행 전

pre-exec snapshot과 별도 C child의 상태를 Node 자신의 상태로 간주하지 않는다.
기존 Koffi의 실제 선택 entry/hash·단일 package root를 기록하고 fixture 입력으로 read/map만 허용한다.
process-exec·새 Mach/network service·production 정책 기본값은 넓히지 않았다.
Node가 정상 도구/DNS/C 비교를 마친 뒤 자신의 global `bootstrap_port`, task special-port4, 실제 권리 종류·raw Mach status를 기록한다.
`get_special_port`가 반환한 별도 SEND 참조는 정확히 반납하고 그 status도 남긴다. borrowed global 참조를 파괴하지 않는다.
[SDK task special-port](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach/task_special_ports.h)와 실제 로컬 SDK를 대조했다.

valid SEND가 실제 관측됐을 때만 own task/registered port 복원을 시도한다. setter 성공을 탈출로 부르지 않고,
각 mode에 별도로 등록한 fresh target의 실제 launchctl·actor 효과·cleanup과 대조한다.
관측 오류·Mach 실패·port0·effect 미관측을 성공/죽음으로 바꾸지 않는다. PID/UID·argv15·별도 target·typed nullable 결과를
validator/factory와 함께 cutover했고, 예상 밖 cached SEND·범위 밖 service 효과도 OBSERVED로 보존한다.
build·caller59/59·fail/cancel/skip/todo0·실제 생성 module syntax·Linux state 생성 전 OS 거절은 통과했다.
최초 local synthetic case는 이미 tools=null인 variant에 새 관측을 붙여58/59였다. 원래 null case를 보존하고 새 unavailable 관측의 variant만 고쳐59/59이며 원시 실패도 보존했다.
새 Node 자신의 실제 Mac 관측·복원 효과는 **NOT_RUN**이다. 원시는 `exact-unix-sockets/node-post-exec-bootstrap/`다.
실행 guard·Linux backend·세 product gate와 현재 권한/receipt/recovery 계약은 유지한다.



## Linux 발행 뒤 실제 Mac service 반례 (2026-10-28)

주 `257baab324d0cac93fb49fcf1c69ba0231b24db9`와 mirror `2ef7fb517b24e4a48c3ac48646f87f6a81316638`를
지정 work branch에 push했다. tree `32f8cf22e4af7b0728edd52e6cbd6c05b9f11d1c`는 같고
사용자 README/WATCHDOG는 제외·보존했다. 위임·merge·deploy는 없다.
Native [40711228810](https://github.com/minjung2035/oma-v2-ci/actions/runs/40711228810)의
ZIP5개를 공개 artifact SHA256과 대조해 회수했다. clean canonical input은
`232a303bba403d9e6d6ca122e428a2924d0fa4640f3b8a975178fd0524076716` /15686 files이며
모든 OS의 전후 입력이 같았다. 앞선 dirty Linux 전체 입력과 소급 합성하지 않는다.

| 실제 실행 | 결과 | 판정 경계 |
|---|---|---|
| Ubuntu24 common |245/245·skip0 | 이 lane은 전체 Linux3952개나 독립 설치 live 시험이 아님 |
| Mac26 arm64 / SDK26.5 common |253/253·skip0 | 전체 제품 qualification 아님 |
| Mac15 arm64 / SDK15.5 common |253/253·skip0 | 첫 목표 Mac26과 별도 호환성 관측 |
| 각 Mac 독립 packed 설치 |26/27, `@oma/git` canonical-health→PreparationExecutor의 `UNSUPPORTED_PROFILE`1 FAIL | 현재 Darwin preparation 미구현을 그대로 드러냄. skip·host spawn fallback·성공 재분류 없음 |
| 각 Mac Darwin gate |117 executed /105 OBSERVED /12 SETUP_FAILED | candidate/quarantine·Worker 각3회 실패. G-PROCESS/G-FILES/G-AUTH 모두 OPEN |
| fresh service 최초 요청 |양 Mac 각3회 모두 production Seatbelt 적용 caller의 launchctl exit0·joined=true·numericCleanupUsed=false | PID1이 다른 CID에서 unsandboxed controlled actor를 실제 실행. 현 policy+coalition만으로 닫힌 범위라는 후보의 반례 |

Mac26 CID는1393→1397·1435→1439·1497→1509, Mac15는1217→1221·1249→1251·1267→1271이다.
동일 actor의 별도 host 양성과 새 target, production profile·5초 한도, 실제 spawn/wait·실행 marker의
kernel CID/identity를 대조했다. `launchctl print`는 진단이고 marker 부재를 차단 증거로 쓰지 않았다.
GUI UID501·SIP-disabled 범위다. SIP-enabled·headless 지원, 실제 제품 owner crash·durable producer는 미증명이다.
과거 동일 job 재사용에 따른 restart 대기 원인설은 여전히 추정이며 이번 성공으로 과거 실패 원인을 확정하지 않는다.

`/home/dev/oma-audit-artifacts/native-2026-10-28-macos-resume/`의 verified ZIP5개·download metadata,
OS별 `launchd-scope-results.json`·`fresh-service-admission-observed.json`·`native-runtime-observed-summaries.json`을 보존한다.
현 Darwin guard와 Linux 보장을 유지하고 서비스 제어 권한 분리의 최소 반례로 진행한다.
Architecture [40711228820](https://github.com/minjung2035/oma-v2-ci/actions/runs/40711228820)의 같은 clean 입력도 판독했다.
all3952/3952·fast880/880·durable872/872·property34/34·stress16/16·platform72/72,
모두 skip/cancel/todo0·errors[]이며 모든 lane command가 code0·signal/error/timeout 없음이다.
all 입력은 전후 동일하다. baselineComparison은 NOT_AVAILABLE이며 비교 완료로 소급 승격하지 않는다.
standalone kernel/crash lane은 NOT_RUN이고 native-all의 실제 필수 파일/이름과 별개로 표시한다.
원시 ZIP2개와 `published-clean-linux-verification-summary.json`을 보존한다.

### 다음 최소 질문 — bootstrap/XPC 권한 제거 (첫 Mac compile 실패·실행 미실행)

`launchd-bootstrap`의 새 helper는 production profile을 적용하고 상속 그대로 / bootstrap만 제거 /
bootstrap+registered seed 제거를 direct exec 전에 비교한다. 원래 controlled actor와 policy는 바꾸지 않았다.
각 variant의 별도 fresh job을 직접 CLI와 Node 후손 CLI로 요청하고, Node 파일 쓰기·금지 canary·Git hash·
compiler·실제 DNS의 반환/오류·부분 보고를 보존한다. pre-exec report와 marker 부재를 실제 exec/death/denial proof로 쓰지 않는다.
public Mach port API와 libxpc seed 전달의 내부 관례를 구분하며 production backend로 채택하지 않았다.

현재 local parser·production policy41/41·skip0, 변경 JS3개 syntax exit0,
AST로 추출한 생성 Node script syntax exit0, 기존 실제 service6건의 parser 대조,
새 mode의 실제 Linux 실행이 state 전 exit1인 것을 확인했다.
이후 실제 Mac compile을 시도한 첫 결과와 수정 source의 미실행은 아래에 구분한다.
추가 case3회에 맞춰 CI job 전체 상한만300분으로 조정했다(worst-case288분).
기존 probe120초·fixture80초·service5초·제품 timeout과 세 product gate는 유지한다.
원시는 같은 Mac resume root의 `bootstrap-local/`·`upstream-bootstrap-authority-research.json`이다.

첫 발행 주 `3581b838` / mirror `41392d6624`의 Native
[40721951956](https://github.com/minjung2035/oma-v2-ci/actions/runs/40721951956)를 실제 판독했다.
clean 입력 `e6ca64260acf796d80c6cfa756567b60f9754011357ed97fa034b263178fdf72` /15687 files 전후 동일,
common Mac15/26 각254/254·Ubuntu246/246·skip0, 양 Mac 독립 설치26/27이다.
gate 각120 /105 OBSERVED /15 SETUP_FAILED이며 새 bootstrap3건씩은 모두 C compile 단계 실패다.
SDK15.5·26.5가 `mach_port_destroy`의 macOS12부터 unsafe/deprecated 표시를 `-Werror`로 거절했다.
권한 분리 자체가 실행된 것이 아니므로 이를 허용/거절·호환성·제품 결함으로 판정하지 않는다.

경고·compiler 성공 조건은 유지하고 SEND right의 참조만 `mach_port_get_refs`/`mach_port_mod_refs`로
명시 반납하도록 교체했다. RECEIVE right는 제거하지 않으며 record/parser의 이름도 `droppedSendRights`로 맞췄다.
수정 뒤 local parser/policy41/41·skip0·실제 Linux fixture의 state 전 거절을 확인했다.
이 checkpoint 당시 수정 source의 Mac 실행은 NOT_RUN이었다. 후속 실제 결과는 아래에서 별도로 기록한다.
원시는 같은 root의 `bootstrap-rights/observed-first-attempt-summary.json`·원시 ZIP5개와
`bootstrap-rights/send-rights-fix-local/`이며 최초 실패를 삭제·재분류하지 않는다.

### SEND right 교체 뒤 실제 Mac 실행 (2026-10-28)

주 `3ca06ef0485e5114a3d3f62e55aabd26dca1c9d3` / mirror `a4c398f89a2168f4b5da218a3dc5c3073f4e21ac`,
Native [40726395555](https://github.com/minjung2035/oma-v2-ci/actions/runs/40726395555)의 ZIP5개 SHA256을 확인했다.
clean 입력 `92b706badeddfd746705389ea330524770745ae544f2c049456066fc3aef88ba` /15687 files는 양 Mac 전후 동일하다.
실제 SDK compile과 새 case3건씩이 OBSERVED이며 각 gate 전체는108 OBSERVED·12 SETUP_FAILED다.
각 조건은 Mac15·26 각각3회이며 GUI UID501·SIP-disabled 범위다.

| 권한 조건 | 직접 CLI / Node 후손 CLI | 실제 owned service effect | Node·clang·자기 쓰기 / 금지 canary |
|---|---|---|---|
| inherited |각6회 exit0 |12회 PID1 아래 별도 CID 실행 |모든 variant 정상 / EPERM·원본 보존 |
| bootstrap-only |각6회 exit141, `Reentrancy avoided` |미관측 |모든 variant 정상 / EPERM·원본 보존 |
| bootstrap-and-xpc |각6회 exit141, `Reentrancy avoided` |미관측 |모든 variant 정상 / EPERM·원본 보존 |

위 명시적 client 실패와 effect 미관측을 전체 service admission/death proof로 쓰지 않는다.
bootstrap-only의 registered send right는 여전히 남아 있으며, 이를 다시 취득하는 adversary는 미실행이다.
모든18 variant에서 Git은 shim의 `/var/select/developer_dir` EPERM, DNS는 ENOTFOUND였다.
inherited 기준선부터 같으므로 이를 포트 제거 때문에 생긴 Git/DNS 실패로 분류하지 않는다.
다음 입력은 기존 selected developer-tools owner의 실제 Git 양성·같은 hostname host DNS 대조와 정확한 DNS endpoint,
registered seed 재취득 반례다. production 실행 guard는 차단을 유지하며, 세 product gate는 OPEN이고 backend는 미채택이다.
원시는 `bootstrap-rights/send-rights-fix/`의 원시 ZIP5개·OS별 bootstrap row·
`actual-rights-isolation-outcomes.json`·`actual-rights-isolation-summary.json`에 보존한다.

### 같은 published source의 Linux 전체 회귀와 native common 판독

Architecture [40726395696](https://github.com/minjung2035/oma-v2-ci/actions/runs/40726395696), source `a4c398f89a2168f4b5da218a3dc5c3073f4e21ac`의
all ZIP12835895324(SHA256 `3cf5e3b4c1b8488715853a348a95db63a21b9f90c0c0ecdd4080cd39f08edef9`)와
verification ZIP12835700946(`b565a5b7790134bfe1163d6f47471f8e4844793297c8930dc829b1646fd6accb`)를 대조했다.
clean `92b706badeddfd746705389ea330524770745ae544f2c049456066fc3aef88ba` /15687 files 전후 동일이다.

| lane | 실제 tests / pass | fail / cancel / skip / todo |
|---|---|---|
| all |3953 / 3953 |0 / 0 / 0 / 0 |
| fast |881 / 881 |0 / 0 / 0 / 0 |
| durable |872 / 872 |0 / 0 / 0 / 0 |
| property |34 / 34 |0 / 0 / 0 / 0 |
| stress |16 / 16 |0 / 0 / 0 / 0 |
| platform |72 / 72 |0 / 0 / 0 / 0 |

모든 lane errors[]이며 각 command는 code0·signal/error/timeout 없음이다. all의13개 command에 build/typecheck/architecture가 포함된다.
baselineComparison은 각 NOT_AVAILABLE이고 비교 완료라고 쓰지 않는다. 독립 kernel/crash lane의 실행으로 확대하지 않는다.
같은 Native source의 원시 tests.log도 판독해 Mac15/26 각254/254·Ubuntu246/246·skip0과 입력 전후 동일을 확인했다.
Mac packed install의 `@oma/git` canonical-health→preparation `UNSUPPORTED_PROFILE`은 여전히 실패다. skip/fallback으로 바꾸지 않았다.
원시는 `bootstrap-rights/send-rights-fix/clean-source-linux-regression/`·`actual-native-runtime-summary.json`이다.

### 발행 전 checkpoint의 stronger baseline·재취득 반례 — 당시 실제 Mac NOT_RUN

기존 developer-tools owner가 관측한 actual Git으로 host 양성·sandboxed hash를 맞추고 같은 hostname의 host DNS 양성을 추가했다.
실제 확인한 mDNSResponder socket의 원래 경로와 physical alias만 기존 fixture의 exact Unix-socket 입력으로 선언했다.
각 조건의 별도 fresh target에 대해 registered seed 재조회·task bootstrap 복구·launchctl exec와 실제 effect를 기록한다.
validator는 baseline 실패·잘못된 binary/target/PID·거짓 setter 결과 귀속을 거절하되 실제 service 성공/거절과 음성 tool 결과는 보존한다.
local parser/policy41/41·skip0, syntax3개·생성 script syntax, 실제 Linux state 전 거절을 확인했다.
생성한 Node producer를 Linux에서 실제 실행해 자기 쓰기·Git hash·cc syntax 성공, 없는 launchctl의 ENOENT 원시 기록도 확인했다.
이 unsandboxed producer smoke는 Darwin sandbox proof가 아니다. 이 checkpoint 당시 Mac compile·DNS 양립·권한 재취득은 **NOT_RUN**이었다.
production renderer·actor·실행 guard·Linux backend·원래 timeout은 그대로다. local 원시는 `bootstrap-rights/send-rights-fix/baseline-restoration-local/`다.

### stronger baseline·재취득 실제 Mac 판독

주 `f73c315acbc15b48a79b9fc7d3c3a5da0a12b8aa` / mirror `4baca756363b053a18704c828c7e5d013dae5230`,
Native [40735745482](https://github.com/minjung2035/oma-v2-ci/actions/runs/40735745482)의 원시 ZIP5개를 SHA256 대조했다.
gates Mac15 ZIP12838540627 `e4d0e9283f6c0b1085421d8ee751d051006ac735bfc5184b231d05e73f465b3c`,
Mac26 ZIP12836149748 `7a67863518ed0045ecc8885ceb867e984a2f78e99ad496501595bc6e9a62077b`다.
clean `2dcd9200abb3a2b8deb91975541ffe0c9a325a0ce56af3d0a3923bfdc143c136` /15687 files와 runtime artifacts 전후 동일이다.
GUI UID501·arm64·SDK15.5/26.5 각각3회이며 새 case는 OBSERVED, 전체는 각108 OBSERVED·12 SETUP_FAILED다.

| 조건 | 실제 task bootstrap 재취득 | 직접 / Node / 재취득 뒤 CLI | 실제 owned service effect |
|---|---|---|---|
| inherited |기존 nonzero·setter0 |각6회 exit0 |18회 |
| bootstrap-only |seed 조회·setter0·0→nonzero 총6회 |각6회141 |미관측 |
| bootstrap-and-xpc |seed0·setter 미호출6회 |직접/Node 각6회141·재취득 helper6회125 |미관측 |

task handle의 실제 복구와 service 실행 권한의 복구는 다르다. bootstrap-only의 실행 탈출이 확인된 것은 아니다.
host selected Git·같은 hostname DNS 양성은 모두 성공했다. 그러나 sandboxed Git은 전18 variant에서
`fatal: unable to access '/etc/gitconfig': Operation not permitted`·exit128이고 DNS도 inherited부터 ENOTFOUND다.
Git probe는 기존 `GIT_ENV`와 달리 ambient 환경을 사용했다. 기존 owner 적용·native DNS 진단은 다음 입력에서 검증한다.
광범위한 파일/Mach grant·timeout 확대·기대 오류 묵인으로 정상 기능을 선언하지 않는다.
clang·자기 쓰기·금지 canary는18 variant 모두 기대대로지만 backend 미채택·실행 차단·세 gate OPEN은 그대로다.
원시는 `bootstrap-rights/send-rights-fix/selected-baseline-and-restoration/`의 원시 ZIP·OS별 row·
`actual-baseline-restoration-{outcomes,summary}.json`이다. Architecture40735745551 artifact는 아직 미판독이며 과거 all3953 결과를 이 입력으로 승격하지 않는다.

### 후속 회수한 같은 source의 전체 Linux 회귀·native common

Architecture [40735745551](https://github.com/minjung2035/oma-v2-ci/actions/runs/40735745551), source `4baca756363b053a18704c828c7e5d013dae5230`의
all ZIP12839366662 `1941b4c222dab951eef72964c593bca434e797b46c15b149d8d4bff71a28c4a2`,
verification ZIP12839985845 `be75b536a6823dd1a701fb3546118274f18acd717780886d29efefa76ffefb07`를 SHA256 대조했다.
같은 clean `2dcd9200…`에서 all3953/3953·fail/cancel/skip/todo0·errors[]이며 all의13 command는 code0·signal/error/timeout 없음이다.
다른5 lane도 PASS·skip0·errors[]·각 command code0이다. baselineComparison은 모두 NOT_AVAILABLE이다.
원시 all 입력 전후가 같고 Native runtime의 source HEAD·입력·runtime artifacts도 전후 동일하다.
Mac15/26 common 각254/254·Ubuntu246/246·skip0이다. Mac packed 선언/설치 통과26개와 authored installed-runtime PASS16개를 구분한다.
나머지10개에 runtime smoke가 있다고 합성하지 않으며 `@oma/git` preparation `UNSUPPORTED_PROFILE`1건은 여전히 실패다.
원시는 같은 root의 `clean-source-linux-regression/`·`actual-native-runtime-summary.json`이다.

### 다음 Git 환경·native DNS 진단 입력 — Mac NOT_RUN

기존 `GIT_ENV`를 재사용해 system/global config·hooks 정책을 복제하지 않고 host/Node Git을 소유 HOME/TMPDIR에 맞췄다.
normal Node DNS는 그대로 두고 C child에서 raw Unix socket/connect·DNSService IPC·libc getaddrinfo의 실제 status/errno를 분리한다.
host의 같은 native API 양성을 먼저 요구하며, child의 API 거절·timeout·report 부재는 음성/미관측으로 보존한다.
local parser/policy41/41·skip0·생성 script syntax·실제 Linux fixture의 state 전 거절을 확인했다.
실제 Linux producer의 기존 Git 환경 hash·cc syntax 성공과 없는 native helper의 ENOENT·null report 경로를 확인했다.
이것은 Mac DNS 실행 증거가 아니다. 새 C compile·Mac Git 정상화·DNS 거절 원인은 **NOT_RUN**이다.
production renderer·actor·Linux backend·실행 guard·원래 timeout은 바꾸지 않았다.
local 원시는 `bootstrap-rights/send-rights-fix/selected-baseline-and-restoration/git-env-native-dns-local/`다.

### 첫 native DNS 진단 source의 link 실패·Mac15 실행 근거 없음

주 `ae6d72826557e65ad485229f24d1527ca6b8e0e3` / mirror `a399fb7fe5807f2a7a953db28326380de857bee6`,
Native [40743666948](https://github.com/minjung2035/oma-v2-ci/actions/runs/40743666948)의 실제 artifact3개를 SHA256 대조했다.
clean `b89d272184e568470267ec35ecafc6c3ede867e6564b46ef52c0b5d4d55560b1` /15687 files·Mac26 gate runtime artifacts 전후 동일이다.
Mac26 bootstrap3회는 clang/link command exit1, `ld: library 'dns_sd' not found`이며 gate 전체105 OBSERVED·15 SETUP_FAILED다.
Git 환경·native DNS API는 아직 실행되지 않았다. 경고 억제나 성공 조건 변경 없이 잘못 추가한 독립 `-ldns_sd`만 제거했다.
[Apple Libsystem requiredlibs](https://github.com/apple-oss-distributions/Libsystem/blob/main/requiredlibs)에 `system_dnssd`가 속한다.
수정 source의 actual link·Mac Git 정상화·DNS 분류는 **NOT_RUN**이다.

Mac26 common254/254·Ubuntu246/246·skip0은 원시 tests.log에서 별도 확인했다.
Mac15 두 job은 cancelled·runner_name 비어 있음·artifact 없음이다. 취소 원인은 미확인이며 이 source의 Mac15 실행/PASS로 기록하지 않는다.
원시는 같은 root의 `git-env-native-dns/observed-link-failure-summary.json`·`native-job-observed-summary.json`·ZIP3개다.

### 후속 actual link·Git 정상화·DNS의 raw connect 거절

주 `5f1f176183aba017ca2e47d3e70029c145204f26` / mirror `e9a939d6197765db65083ec5537e5689fe1427ce`,
Native [40748217460](https://github.com/minjung2035/oma-v2-ci/actions/runs/40748217460)의 ZIP5개 SHA256을 대조했다.
clean `7670738e80e58d9c0ebe4dabff70b5ec655e67408f95c7ff53983fe7f39817fa` /15687 files·runtime artifacts 전후 동일이다.
SDK15.5/26.5 실제 compile/link와 새 case각3회 OBSERVED, 전체 각108 OBSERVED·12 SETUP_FAILED다.
같은 source의 common은 Mac15·26 각254/254, Ubuntu246/246·skip/cancel/todo0이며 source/runtime bytes 전후 동일이다.
두 Mac의 packed 검증은26/27이다. `@oma/git` preparation의 Linux 전용 guard가 여전히 `UNSUPPORTED_PROFILE`로 거절했다.
나머지26개를 전부 runtime 실행으로 부르지 않는다: authored installed-runtime PASS16개와 선언 검증만 한10개를 구분한다.
이 실행도 GUI UID501·SIP-disabled이며 headless/SIP-enabled qualification은 아니다.
전18 variant의 selected Git hash는 실제 expected bytes와 일치·exit0이고 clang·자기 쓰기·금지 canary도 기대대로다.
DNS는 host native 세 API가 모두 양성인데 sandboxed AF_UNIX 생성 성공 뒤 connect -1/EPERM1,
DNSService -65563·getaddrinfo8/errno1·Node ENOTFOUND다. inherited도 같으므로 root 제거 탓으로 쓰지 않는다.
Unix filter 번역 수정은 아직 미실행이며 실행 guard·세 gate·backend 상태는 바꾸지 않았다.
원시는 `git-env-native-dns/libsystem-link-fix/actual-git-native-dns-{outcomes,summary}.json`·OS별 row·ZIP이다.

### Linux 추가 CI의 실제 EAGAIN — Git 이력과 분리·새 수리 전체 검증 전

Architecture [40743666926](https://github.com/minjung2035/oma-v2-ci/actions/runs/40743666926)의 `exit-codes.tsv`는
`test=1`, 다른 command/lane은0이다. 원시 `test.log`는 사전14/14·main3938/3939·fail1·skip/cancel0이다.
V10A acceptance-budget 시험이 delivery 이전 rootfs 준비의 `openBeneath→statAt→ensureFile` EAGAIN으로 실패했다.
타이머 실패나 과거 Git 거절의 재발이 아니며, 실제 rename 경합 주체·시점은 미관측이다.
같은 source의 독립 serial all3953/3953·5 lane과, 후속 Architecture40748217290의
baseline14/14+3939/3939·serial3953/3953·5 lane·전체 command0은 각각 통과했다. baselineComparison은 NOT_AVAILABLE다.
이 통과를 앞선 EAGAIN 원인 수리로 처리하지 않는다. 원시 실패·exit ledger·source별 ZIP SHA는 그대로 보존한다.

[openat2(2)](https://man7.org/linux/man-pages/man2/openat2.2.html)의 BENEATH EAGAIN 재시도 계약을 적용했다.
새 leaf는 같은 held fd/path/how와 BENEATH|NO_SYMLINKS로 최대8회만 시도하고 지속 EAGAIN·hard denial은 거절한다.
open/openat fallback·flags 완화·filesystem validation 생략·delivery timeout 변경은 없다.
real kernel FD와 실제 inside/outside symlink 경계를 사용하는 좁은 fault 회귀는 수정 전1/1 FAIL,
수정 후 기존 cleanup 포함25/25 PASS·skip0다. 이것은 원래 CI의 rename 경합을 재현했다는 뜻은 아니다.
이 수리 직후 checkpoint에서는 compiled/독립 설치·실사용·전체 Linux 검증이 NOT_RUN이었다. 이후 아래 재인수로 그 미실행 범위를 확인했으며 Mac production 정책은 그동안 보류했다.
원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-linux-contained-open/`와
이전 Mac root의 source별 `clean-source-linux-regression/`·`original-parallel-baseline-failure-classification.json`이다.

### Linux EAGAIN 수리 뒤 실제 재인수

실행 입력은 `02fd1a08633291463c3a79c04622045bbb1b6f73db04e3185b53536873b0003d` /15687 files다.
사용자 README가 포함된 dirty 입력이며, 결과를 문서에 반영한 뒤의 binding이나 clean publication과 같은 입력이라고 하지 않는다.
전후 canonical identity는 같고, 아래 최종 전체 실행의 모든 command는 exit0·timeout 없음이다.

| 실제 실행 | 결과 | 판정 경계 |
|---|---|---|
| `npm test`, 파일 병렬도4 | 사전14/14 + main3940/3940, fail/cancel/skip/todo0 | 두 phase를 각각 확인. 기존 부분 통과를 합친 결과가 아님 |
| `verify-lane all`, 파일 직렬 |3954/3954·fail/cancel/skip/todo0·errors[]·baseline COMPARED | 비교 기준은 e9a939d619의 실제 all3953개 이름. build·typecheck·전체 architecture command도 모두0 |
| 독립 packed workspace 검증 |27/27 PASS | 같은 고정 입력에서 완료한 별도 gate. 이후 성공한 gate를 불필요하게 반복하지 않음 |
| 실제 compiled native/rootfs | native OS·primitive·ownership21/21, delivery deadlines23/23, 실제 rootfs create·재create·drift defer·owner repair | native syscall/FD/namespace는 실제 실행. deadline lane의 Pi protocol engine은 deterministic fixture이며 live provider proof가 아님 |
| 새 runtime-only 설치본 |27개 workspace tarball·production dependency만 설치, 설치 내부 links, 두 checkout masked | 개발 source·checkout node_modules를 복사하지 않음. installed native bytes는 새 compiled leaf와 동일 |
| 실제 Principal·Worker·Personal | 모두 `openai-codex/gpt-6-luna`, `medium`; Worker가 sum.mjs만 수정·실제 test 통과·candidate 제출, Personal은 정확히 `42`+LF | 실제 SDK session의 model/effort와 실제 tool output 확인. 제품 기본 모델 변경 아님 |
| warm history 재개 | 두 mode 실제 PTY 재진입·기존 history bytes 유지·accepted operation8개 완전 동일 | 화면만이 아니라 public diagnostic snapshot으로 비교 |
| 자동 보관·cold 복구 | broker drain·Store close 뒤 실제 Restic 검증·checkpoint·hot roots 회수, 원래 key로 복원 | 정상 종료·검증된 복원 경로. physical power loss나 모든 외부 재인증 조건의 proof는 아님 |
| archive key 손실 | 실제 broker `STORE_CORRUPT`, 대체 key/새 canonical history 없음·원본 DB/checkpoint bytes 유지 | bounded 기존 restart 뒤 ownership loss도 관측. 종료 후 마지막 화면에는 앞선 오류 frame이 없으므로 이를 원시 오류 복사본이라고 하지 않음 |
| 복원 뒤 실제 manual CLI | 실제 `npm test` exit0·`OWNED_SUM_OK`; 원래 request key가 원래 operation/ref/candidate 반환 | submit1·integrate0·extra Worker0 유지. pre-cold operation8개 bytes 불변, 최종 operation11 succeeded·batch4 completed |
| 최종 정상 종료 | 모든 UI 종료0, active execution journal0, 두 번째 자동 archive·roots 회수 | confined auth file 제거·실제 host credential 불포함, 원본 Codex auth bytes/mode 보존 |

실제 host UID/GID는1000/1000이다. 앱도1000/1000·CapEff0·NoNewPrivs1이며 privileged daemon을 쓰지 않았다.
즉시 부모 user namespace의 uid_map(`1000 0 1`)을 host UID0이라는 뜻으로 오독하지 않는다.
private tool mount만 사용했으며 host `/usr/bin/node`·bwrap이나 사용자 파일 권한을 고치지 않았다.

**실패와 정정도 보존한다.** 첫 전체 serial은3934/3954였다. 빈 검증 HOME에 pinned Restic을 준비하지 않아
Restic-setup8개 hook와 session-storage12개가 prerequisite assertion으로 실패했다.
또 npm orchestrator 자체에 test-only `local-test-guard`를 preload해서 baseline/architecture wrapper가 shell 거절로 시험 전에 종료했다.
이는 production 수리나 성공 조건 변경의 근거가 아니다. 실제 pinned binary를 소유 HOME에 복사한 뒤 원래 installer로 hash/FD-exec 검증했고,
guard는 npm 상위 실행기에서만 빼고 test-local/verify-lane의 원래 test-child guard는 유지했다.
해당20개가 먼저20/20 통과한 뒤 **같은 source의 전체 baseline과 전체 serial all**을 다시 실행해 위 통과를 얻었다.
첫3934개와 후속20개를 합쳐 전체 PASS라고 하지 않는다.

실사용 첫 시도에서도 private `/usr/bin`에 Node binary만 둬 인접 npm module이 없었다.
완전한 pinned Node26 distribution을 선택한 뒤 실제 복원 Worker의 `npm test`가 성공했다. 이 문제로 production 코드를 바꾸지 않았다.
Principal tool error3개(빈 inbox 읽기와 GOAL ordinary-mail fields 오류), Worker tool error6개(npm 전제/CLI 사용 오류),
Personal0개를 보존한다. 첫 GOAL schema는 한 차례 사람이 안내했으며 완전 무개입 성공으로 포장하지 않는다.

실제 CI EAGAIN의 rename 주체·경합 시점은 여전히 미관측이다. 새 회귀는 transient EAGAIN을 좁게 주입한 뒤
실제 kernel open·FD read/close와 inside/outside symlink 거절을 확인한 것이다. 원래 자연 경합을 재현했다거나
과거 원인 미상 Git1건이 수리/무해 판정됐다는 뜻이 아니다. flags·여섯 syscall slots·hard-denial·지속 오류 거절·원래 deadline을 유지했다.

원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-linux-contained-open/`이다.
`first-full-failure-classification.json`·최초 `all-serial/`·`original-npm-guard-debug.log`가 실패를,
`prerequisites-corrected/full-regression-result.json`·`all-serial/result.json`이 최종 전체 실행을 소유한다.
`installed-live-complete-result.json`, `installed-real-npm-and-same-key-replay.json`, redacted 실제 SDK session,
host/namespace identity와 원래/최종 cold checkpoint를 함께 보존했다.
이 runtime checkpoint에서는 clean publication·새 CI가 미실행이었다. 이후 발행 source와 실제 관측 결과는 위 [새 Mac 재개 기록](#mac-exact-unix-socket-번역--실제-kernel-검증-전)에 별도로 결박했다.






## Linux 인수검증 마감 — 독립 설치·실제 추론·재개·cold 복구 (2026-10-28)

지정 `work/macos-native-20261025`에서 위임·merge·deploy 없이 실행했다.
고정 입력 `88d1cf0b1a435a0c7494e67ccd306ca328a28c73ed8b8535c5168c9904a1c76b` /15686 files의
serial `all`은 **3952/3952 PASS**, fail/cancel/skip/todo0·errors[]·baseline COMPARED다.
build·전체 typecheck·전체 architecture command도 모두 exit0·signal/timeout 없음이며
canonical identity와15686개 per-file bytes가 실행 전후 동일했다. 결과 반영 뒤 docs-only binding은 별도다.

첫 전체 실행은3948/3952·4 FAIL이었다. 실행기가 pinned toolchain `PATH`를 전달하지 않아
`cloc` ENOENT/2.08 prerequisite 오류가 났다. 해당 실패를 보존하고 실제 cloc2.08 resolution 및
영향받은3개 파일23/23을 확인한 뒤, **같은 입력 전체**를 정상 PATH로 다시 실행해 위 결과를 얻었다.
제품 코드·성공 조건·timeout·검사 목록은 변경하지 않았다.

| 실제 경로 | 확인한 결과 | 경계 |
|---|---|---|
| 독립 runtime-only 설치 | 보존된27개 packed payload의 SHA 검증 후 별도 `npm ci --omit=dev --ignore-scripts`. 모든 workspace link는 설치본 내부 | checkout source/node_modules 복사 없음. 두 checkout을 mount로 가려 package.json조차 보이지 않음을 확인 |
| Principal·native Worker | 실제 `openai-codex/gpt-6-luna`·`medium`. 실패하던 `add`를 수정하고 기존 검증 통과·commit·submit·Principal 수신 | published candidate `d2df1a46f99c1e7f57f9cbc8f27620539dce92ae`는 `sum.mjs`만 변경. Human checkout은 원본 유지, 추가 Worker·integrate0 |
| Personal·도구·history | 같은 실제 모델/effort로 read/write/bash·정확한 `42\n` 생성·검증 성공. 실제 history 재개 후 쓰기 없이 재검증 | 모델 응답은 scripted가 아님. 모델·effort는 session metadata와 실제 UI로 확인 |
| Society 재개·receipt | 재시작 후 기존 accepted fact8건 유지. cold 복원 전11건의 plan/payload/request/result bytes 유지 | 실제 CLI가 원래 key `cli-ed3c0ab0-2bb2-457a-af5c-52b9ae2f258e`로 원래 operation을 반환. git.submit은 끝까지1건 |
| 실제 broker 보관·복원 | 실제 native drain→Store.close→pinned Restic 보관·검증·cold checkpoint·회수. 원래 credential로 실제 broker cold restore 성공 | 합성 quiescence callback이나 빈 offline journal로 대신하지 않음. 최종 operation14 succeeded·batch8 completed·active journal0·정상 종료0 |
| 보관 credential 손실 | 실제 cold 재개를 거절하고 DB/checkpoint bytes 보존. credential 대체 생성·canonical 재초기화 없음 | 기본 `repos` 빈 부모만 생겼다. 이를 canonical history 생성으로 잘못 본 첫 smoke oracle도 보존하고 정정 |

실제 환경은 UID/GID1000·CapEff0·NoNewPrivs1, Node26·bwrap0.12.0이다.
고정 `/usr/bin/bwrap`을 만족시키는 소유 시험 namespace/overlay만 사용했고 host 전역 설정은 바꾸지 않았다.
기존 Codex OAuth는 원문 노출 없이 검증용 SDK 저장소에 가져왔으며 원래 auth bytes/mode를 보존했다.
보존한 session은 redacted이며 검증용 credential·프로젝트·설치 트리는 소유 범위에서 정리한다.

무오류 실행으로 쓰지 않는다. Principal의 잘못된 GOAL `kind`1건, Worker의 `--help`·빈 submit·
replay 명령 끝 마침표3건은 거절 후 수정됐다. 초기 Worker가 요청받은 명시 key를 생략했으므로
실제 CLI 발급 key를 기록하고, cold 복원 뒤 바로 그 key의 같은 receipt를 확인했다.
history 재개에는 welcome 문구가 없어 첫 readiness selector가 맞지 않았지만 실제 UI·명령·종료를 확인했다.
외부 provider 재인증·강제 OAuth refresh·host power loss/reboot·원격 backup 서비스의 모든 조건을 증명하지 않는다.

원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-linux-resume/`다.
`all-final/`은 PATH 누락 실패, `all-pinned-path/`·`all-pinned-path-summary.json`은 후속 전체 PASS,
`installed-live-complete-result.json`·redacted session·ledger·checkpoint·same-key replay는 실제 설치본을 소유한다.
`feature-evidence-matrix.json`은 기능별 이전 회귀와 후속 실제 경로를 구분한다.
이전 입력의 설치/package/offline Restic 근거는 아래 기록과 함께 보존하며 새 입력 PASS로 바꾸지 않는다.

### 원인 미상 단일 CI 실패 — 비차단 추적

Architecture [40647938235](https://github.com/minjung2035/oma-v2-ci/actions/runs/40647938235),
source `2af0de04a041dbc915da87b45c4ba87354104d39`, npm test 파일 병렬도4의
`audit2` 첫 `gitSame[0]?.ok`가 false였다는 것만 확정이다. OMA `git.submit` 응답이며 GitHub push 거절이 아니다.
오류 code/body와 임시 out.json이 보존되지 않아 Git 명령·stream·권한·상태·timeout 중 원인을 분류할 수 없다.
시험 전체4.874초는 요청별 시간/timeout 증거가 아니다(client120초·stream idle1초).
사용자 정정에 따르면 동일 commit의 별도 전체 suite3952/3952·skip0도 통과했다.
후속 baseline·이번 fresh/동시/CPU 경합9회와 전체 실행의 통과는 당시 원인을 설명하지 않는다.
직접 대조한 submit/quarantine/connection/execution owner4개의 bytes도 당시와 같다.
`2479809d`의 두 assertion 응답 JSON 진단은 유지하며 production Git·timeout·성공 조건은 수리한 적이 없다.
**확정 Git 결함이나 Linux 완료의 필수 blocker가 아니다.** 이력은 남기되 무해한 flake·수리 완료로 단정하지 않는다.
재발 또는 실사용 제출 실패·중복 효과·ref/receipt 불일치가 관측되면 응답을 확보하고 즉시 우선순위를 올린다.
`ci-incident-classification.json`이 이 정정을 기록한다. 추가 전용 재현 반복은 하지 않는다.

## Linux 우선 검증 — 부분 근거와 남은 완료 조건 (2026-10-28)

`work/macos-native-20261025`에서만 작업하며 위임·commit·push·merge·deploy하지 않았다.
현재 branch push는 Mac job도 시작하므로 보류한다. 원시 root는
`/home/dev/oma-audit-artifacts/native-2026-10-28-linux-first/`다.

| 실행 입력·범위 | 실제 결과 | 경계 |
|---|---|---|
| 수리 후 고정 입력 `c62c180dea0bd613c9ce625567be0005745422c037fd862d5d1864e785a6abe9` /15686 files | serial `all` **3952/3952 PASS**, fail/cancel/skip/todo0·errors[]·exit0. build·전체 typecheck·전체 architecture도 모든 command exit0·signal 없음·timeout 없음 | 실행 전후 per-file digest와 canonical identity 동일. 결과 기록 뒤 docs-only binding은 별도이며 실제 provider 추론·과거 Git 오류 수리를 증명하지 않음 |
| 최초 고정 입력 `650294ba5b4d11fdbc9aee202c0f84db691036e95c8b18d4c063271451cb9728` /15686 files | full local **3952/3952**, serial14/14·parallel3938/3938, concurrency4, fail/cancel/skip/todo0·exit0·980.926초. 입력 전후 동일 | 아래 독립 설치 verifier 수리 전 입력. 이후 source의 전체 PASS로 재표시하지 않음 |
| 같은 단계의 build·구조 검사 | build27/27, 전체 architecture/transaction/durable/document/spec 검사 exit0·findings0 | 정적 검사는 runtime proof가 아님 |
| 일반 UID 첫 Git socket 경로 | `audit2`의 `P0-1/2/3 + P1-7/8` 선택1/1 및 위 동시 전체 실행에서 통과 | 과거 `2af0de04a0`의 첫 Git 거절은 원시 reply 부재로 원인 미확정·미해결 |
| 독립 workspace 검증 최초 실행 | **23/27 PASS, 4 FAIL**. 완료된 설치 트리 누적으로 `/tmp` ENOSPC | 최초 실패를 보존. 제품 데이터나 사용자 cache를 지워 통과시키지 않음 |
| verifier 수리 뒤 독립 설치 | **27/27 PASS**·공개 entry·자체 declaration·지정 installed runtime 확인, exit0·289.907초 | 각 workspace 완료 후 그 소유 임시 트리만 정리. 외부 SDK declaration 진단44는 별도이며 자체 오류로 합산하지 않음 |
| 별도 runtime-only 제품 설치 |27개 workspace의 실제 `npm pack` payload + root manifest/lock에서 `npm ci --omit=dev --ignore-scripts` 성공 | checkout source·checkout node_modules 복사 없음. 원래 설치 입력의 전후 identity 동일 |
| 그 설치본 실제 터미널·package 사용 | Society/Personal 모두 ready·Ctrl-D·exit0·echo/icanon 복원·expectMissed0. 실제 local package install/list/remove 성공, 사용자 Pi home 미변경 | no-checkout-code/data guard 사용. 실제 provider 추론은 미실행 |
| 그 설치본 실제 Restic 보관·복원 | 두 cycle 각각 자신의 source/restored digest 일치. closed DB bytes·dirty Git status·hardlink·외부 symlink 대상 보존. unreadable source 회수 거절·분실 credential 재생성 거절·원래 credential 복원 뒤 재복원 확인 | 설치된 Linux backend·빈 실제 journal/owner를 사용하는 offline 저장 시험. live Worker 종료 proof는 아래 실제 scope 회귀와 구분 |

일반 UID1000/GID1000·CapEff0·NoNewPrivs1, Node26.0.0·pinned bwrap0.12.0이다.
시험 전용 user/mount/PID namespace에 private `/usr/bin` overlay·`/dev`·`/dev/shm`을 배치했다.
host `/usr/bin`·전역 kernel 설정·사용자 README/WATCHDOG·production policy/C actor는 바꾸지 않는다.

`full-local*`·`initial-build*`·`initial-architecture*`가 첫 고정 입력의 결과다.
`independent-workspaces*`·`independent-install-repair-input.json`은 ENOSPC 전후를,
`independent-product-install.json`·`product-tarballs/`는 packed 설치 입력을,
`installed-real-use*`·`installed-restic*`는 직접 실행·exit·원시 터미널·저장 결과를 소유한다.
`all-after-install-fix/result.json`·`all-input-after*`·`all-after-install-fix-summary.json`은
수리 후 serial 전체 실행과15686개 입력 전후 비교를 소유한다.
`priority-zero-observed-boundaries.json`은 실제 통과한 경계 이름을 기록하며 보편적 완전 증명이 아니다.
첫 Restic smoke는 두 번째 cycle을 첫 cycle digest와 비교해 실패했다. 중간 실제 `git status`가
`.git` directory mtime을 바꾸는 것을 별도 metadata 관측으로 확인했다(index bytes 변경 가설은 반증).
cycle별 source를 동결하도록 throwaway oracle을 수리했고 실패 로그와 두 관측을 모두 보존했다.
제품 verifier·recovery 기대값·timeout은 바꾸지 않았다.

### 후속 실제 Codex Principal·Worker — 제한된 실환경 PASS

사용자 지시로 기존 Codex 인증을 원문 열람·출력 없이 검증용 SDK `AuthStorage`에 가져왔다.
`openai-codex/gpt-6-luna`는 번들 catalog에 실제 등록되어 있다. 두 HostConfig model profile의
`thinking`과 검증용 Principal SDK의 default/model effort를 `medium`으로 설정했다.
양 역할의 실제 session `model_change`·`thinking_level_change` 및 Principal UI가 같은 선택을 기록했다.
사용자 원래 Codex auth의 bytes·mode는 전후 동일하며 사용자 Pi·제품 기본 설정은 바꾸지 않았다.

실제 checkout CLI·PTY·native Linux Worker·인증된 외부 provider를 사용했다. scripted 응답은 없다.
GOAL 게시 후 Worker가 정확한 `LUNA_NATIVE_OK\n`의 `answer.txt`를 만들고 `node verify.mjs`를 통과했다.
실제 published candidate `a9262dc96163ee8f713ba9871594e97c77171934`의 blob bytes와 변경 경로
`answer.txt` 하나를 별도로 확인했다. `worker-1-native-answer-submit-v1`은 `git.submit/succeeded`이며
Principal의 해당 delivery는 presented1이다. accepted operation9 모두 succeeded·batch5 모두 completed,
DB integrity ok·foreign-key 위반0, 추가 Worker·integrate0, Human checkout과 canonical main은 원래 base다.
정상 Ctrl-D·exit0 후 execution journal active entry0, Worker 저장 credential 없음도 확인했다.
실행 중 placeholder 값 자체는 채집하지 않았으므로 live credential exclusion의 모든 경우를 증명하지 않는다.
첫 종료 후 smoke가 이미 정리된 placeholder의 존재를 잘못 기대해 실패했고, 실제 metadata와 실패 로그를
보존한 뒤 종료 후 credential 부재를 검사했다. 제품 credential·recovery·timeout은 바꾸지 않았다.

오류도 보존했다. Principal 도구 오류3건은 GOAL의 잘못된 `kind=message`, 첫 배달 전 없는 inbox,
canonical archive suffix가 빠진 경로였다. Worker 오류3건은 미지원 `--help`, 인자 없는 submit usage,
자신이 보낸 메일의 ack 거절이었다. 이후 실제 작업·수신을 완료했지만 무오류 실행으로 기록하지 않는다.
Worker assistant의 `This operation was aborted`2건은 각각 직전 `oma agent wait`와 대조했으며
외부 provider 인증 거절로 분류하지 않는다. 원시 session·상태·Git 결과는
`/home/dev/oma-audit-artifacts/native-2026-10-28-live-codex-luna/`의 `bounded-live-result.json`,
`role-session-summary.json`, redacted session, `final-owner-observations.json`, `execution-scopes.jsonl`,
`terminal-shutdown-observation.json`에 있다. 원문 credential은 evidence에 저장하지 않는다.

이는 **당시 checkout의 제한된 live 시나리오**다. 그 시점의 설치본 live 추론 미실행은
위 후속 독립 설치본 실행으로 보완했다. 각 입력·실행의 근거는 합치거나 소급 승격하지 않는다.
과거 단일 CI 실패는 위 비차단 추적 분류를 따른다. Linux 검증과 보편적 P0 완전 증명은 구분한다.


### 사용자 기능과 Priority 0의 실행 근거

| 사용자 경로 | 위 full local·후속 serial all에서 실제 실행한 근거 | 확대 해석 금지 |
|---|---|---|
| Society·Principal·Worker·자동 wake | `scenario-society`, `scenario-principal`, `scenario-worker-autonomy`, `native-resident-runtime` | 실제 broker/engine/namespace/receipt, 추론 응답은 scripted provider |
| manual CLI·현재 grant·sender identity | `audit2`, `runner-channel`, `native-unix-message`, `peer-pid` | UID/PID·과거 receipt를 현재 권한으로 승격하지 않음 |
| Git submit·candidate/checks·review | `scenario-confined`, `scenario-merge-review`, `scenario-worker-tools`, `native-git-execution` | test-owned repos만 변경. 이 work branch를 merge한 것이 아님 |
| mail·request key·receipt·restart | `scenario-boundaries`, `scenario-society`, `crash-boundaries`, `global-invariants` | 새 incarnation이 accepted bytes·완료 receipt를 재해석하지 않는 경계 |
| Personal·Pi/tools·설정·history | `personal-pty`, `session-mode-pty`, `session-history`, `config-generations` |16종 installed PTY는 실제 UI/tools이며 추론은 scripted |
| package·선택 extension·resource | `pi-packages-cli`, `package-command-ownership`, `scenario-confined` | local registry/engine 명령. 외부 registry 가용성 qualification이 아님 |
| Restic·원본 보존·복구 | `session-storage`, `session-storage-verification`, `restic-tar`, `restic-setup` | 실제 pinned local Restic. host power loss·원격 backup 서비스는 미실행 |
| durable witness→현재 authority→release | `native-process-scope`의 publication·revocation·cancel·PID2 pin·setsid/double-fork 및6종 owner SIGKILL | after-opening은 기대한 unknown으로 journal bytes를 보존. direct-child close를 전체 death로 쓰지 않음 |

**현재 판정:** Linux의 전체 회귀·독립 설치·실제 추론/도구·재개/보관/복구 근거를 위에 기록했다.
과거 원인 미상 단일 CI 실패는 진단을 유지하는 비차단 이력이며 무한 재현을 완료 조건으로 삼지 않는다.
앞선 빈 OMA auth·기본 모델·9종 API-key 부재는 당시 사실이다. 후속 사용자 승인 Codex 재사용으로
checkout 및 독립 설치본 실제 추론을 실행했으며 사용자 `~/.pi`로 대신하지 않았다.
이 범위의 인수검증을 마감하고 문서 정합성·지정 branch push 후 Mac의 실제 관측을 재개한다.
이는 무결함·보편적 P0 완전 증명이나 실제 Mac 제품 지원 완료 선언이 아니다.

## Fresh service target — local 검증, 실제 Mac 미실행 (2026-10-28)

지정 `work/macos-native-20261025`에서 재개했다. host positive와 sandboxed 최초 target을
동일 actor/once 설정의 별도 launchd job으로 분리했고 production source·Seatbelt 정책·C actor의
5초 deadline/owned-child cleanup은 변경하지 않았다. 변경은 fixture·관측 parser·회귀와 문서다.

- 새 target 귀속 회귀: 수정 전1 FAIL(`Missing expected exception`), 같은 test bytes로 수정 후 통과.
- `node --test test/darwin-evidence.test.mjs packages/platform-mac/test/seatbelt.test.mjs`:
  **40/40 PASS**, fail/cancel/skip/todo0·exit0. 변경 MJS3개의 `node --check`도 exit0.
- 직접 parser smoke: `836e2f5963`의 Mac15·26 기존 각3건을 새 fresh-target 근거로 거절했다.
  역사 OBSERVED 기록은 보존하며 새 grammar로 소급 재승인하지 않는다.
  합성 CLI 거절·spawn 실패·deadline 불명·다른 CID effect4종은 grammar로만 수용했다.
- 실제 Linux launchd fixture 실행은 state 생성 전 exit1/Darwin-only 거절이었다.
  이는 actual Mac service admission의 허용/거절·complete-death proof가 아니다.

원시 명령·exit·로그·test/parser SHA는
`/home/dev/oma-audit-artifacts/native-2026-10-28-service-fresh-target/`의
`red*`, `green*`, `checked-source.json`, `regression-input.json`, `direct-smoke*`에 있다.
README·WATCHDOG.yml과 production policy/C actor는 보호 digest로 전후 대조한다.
**새 fixture의 Mac15·26 실행·새 CI는 NOT_RUN**이다. 이 checkpoint 당시 미실행이던 Linux build/architecture/전체 회귀의 후속 결과는 위 Linux 기록으로 구분한다.
이 local 결과는 아래 이전 canonical binding의 재검증이 아니며 세 product gate는 OPEN이다.

## DR61 명세 개정 — 구현 재개 (2026-10-28)

[native spec](../macos-native-spec.md)를 목표·불변식·확정 결정·미결정 후보·판정 절차·실행 순서로
다시 구성했다. NATIVE-024/025가 후보 검증과 파일 capability/좁은 native leaf 경계를 명시한다.
개정 전 spec·인계 원문은 archive에 보존했다. 이 단계에서는 production source를 바꾸거나
Mac backend를 채택하지 않았다. 문서 개정은 G-PROCESS/G-FILES/G-AUTH의 통과 근거가 아니다.

앞선 Linux Runner·descriptor 수리 및 회수한 Mac15 원시 artifact는
[전환 기록](native-transition.md)과 [현재 인계](../HANDOFF.md)를 따른다.
실제 Mac native 지원·현재 source 전체 회귀·독립 설치·최종 복잡도 검토는 여전히 미완료다.

## DR49 native 전환 — 진행 중 (2026-10-25)

작업 브랜치는 `work/macos-native-20261025`이며 master 병합·배포는 하지 않았다.
현재 G-PROCESS/G-FILES/G-AUTH는 OPEN이고 Mac 제품 진입은 효과 전에 거절한다.
이 거절 시험이나 부분 primitive 성공을 native Society 지원으로 표시하지 않는다.

2026-10-27 재개: 필수 문서·machine map과 자체 작성 production523개를 전체 읽은 뒤 DR59의
잔존 VM 정책/API를 제거했다. 수정 후 workspace26개와 root strict typecheck가 통과했다.
Mac 인증의 새 Mach audit 수신·단일 process event·public Security audit-token 대조 leaf 및
OS identity adapter도26개 workspace/root typecheck를 통과했다. 실제 Darwin 실행은 **NOT_RUN**이다.
첫 정적 검사에서 제거한 package collector를 가리키던 durable map 한 건을 찾아 제거했고,
durable map·문서·규범 fingerprint 검사는 통과했다. 마지막 source의 전체 정적 재검사는 별도다.
과거 authored review는 보존하고 변경 bytes의 review ledger는 NOT_REVIEWED로 무효화했다.
당시에는 테스트를 제외한 구현 견적 질문을 구현 우선 순서로 해석해 runtime·packed install·CI를
보류했다. 이는 최종 목표의 실제 검증 요구를 없애지 않으며, 이후 실행은 입력별 증거로 구분한다.
이 checkpoint 당시 primitive·identity adapter는 production broker transport에 미연결이었다.
후속 source 조립 상태는 아래 기록을 따르며 세 gate는 계속 OPEN이다.

후속으로 Broker의 Linux native credential 타입·listener 생성·endpoint 길이 검사를 OS port로
분리했다. common reference/authority owner를 유지하고 BSM by-value accessor로 opaque token을
해석한다. bind 뒤 preparation 실패·불명 close 수명과 Mach body 정렬/oversized queue도 source에서
수정했다. 26개 workspace와 root strict 검사는 통과했으며, 이 후속 입력의 전체 구조 검사는
`/tmp/oma-native-resume-20261026/transport-static-*`의 입력 전후 identity와 단계별 원시 로그로
구분한다. 새 listener 회귀와 변경 Linux sender/새 Mac FFI 실행은 **NOT_RUN**이다.

후속 Mach connector는 App Client/Broker의 OS 선택에 source로 연결했다. common PacketStream,
인증 EOF, byte length/padding, dial readiness generation과 native port return 상태를 구현했다.
현재 native consumer interface golden만 의도한 세 interface 추가/두 port 변경으로 갱신했으며
public/durable DTO·과거 golden은 그대로다. 타입 검사 중 새 unit fixture의 literal 타입 오류를
수정했고 후속 전체 workspace/root 검사는 통과했다. 새 shared-flow와 실제 Darwin 실행 결과는
아직 이 기록에서 PASS로 주장하지 않는다. 세 gate와 product profile 차단은 유지한다.

| 실제 입력·실행 | 결과와 범위 |
|---|---|
| Mac check·quarantine staging/recipe·scope 소유자 연결 | App은 physical candidate workspace/tmp·quarantine bundle copy/phase repo/tmp를 사용하며 common CandidateStaging.run이 lease·전체 scope 확인·실패 보존·재시도/회수를 소유. accepted 원본 FD/cursor/bytes를 유지한다. setup은 기존 CommandSpec.input→framed stdin→sandbox_init→/dev/null, Worker FD3/RPC는 유지. selected Xcode/CLT 관측도 필수 async execute port로 같은 scope/authority/lease를 사용한다. check/Worker는 자기 writable roots의 실행을 허용하고, check의 compiler 경로는 selected Developer usr/bin·XcodeDefault toolchain bin으로 좁힌다. framework 전체 exec·broad /Applications·unowned spawn fallback은 없다. 실제 Linux ff8ffcd1…(15643개) 및 후속 0fe7fbab…(15643개) 고정 입력 전후·보호4개 동일에서 각각 관련 **177/177·contract mutation7/7 PASS**. 추가 digest 소비자 a5018208…(15641개)는 **133/133 PASS**. 각 전체 digest/command/종료는 staging-final-runtime·owned-tools-final-runtime·digest-consumers-green/summary.json이 소유하며 서로 다른 입력을 합치지 않는다. C18 old mount 문구 단언·raw temporary realpath 규칙 위반·collection 중단/재시도 registry 누락을 수리했고, 실제 duplicate journal owner를 거절한 첫 fixture도 부모 초기화만 하도록 수리했다. 공통 staging의 live scope/free flock 보존·경계 소유자 SIGKILL 뒤 재시작·mode000/external symlink 원본 보존3개를 실제 Linux에서 검증·등록했다. 후속 writable exec 권한의 최종 입력·관련/구조 결과는 이후 admission-runtime/summary.json·admission-final-summary.json이 구분한다. Mac은 script/C compile/output·channel identity·stdin framing/EOF/keep-FD까지 **30×3=90회 준비·모두 NOT_RUN**. paid CI 실행 없음. generic mode000/exact pin/reopen/repair 우회·새 fence 예외·durable/public/accepted 데이터 변경 없음. 세 gate OPEN·native guard/Mac scope 거절 유지. Worker full bootstrap/Git toolchain·§11 형식 version과 양 OS qualification은 미완료. raw native-2026-10-27-setup-recipes/가 source별 실패·수리와 build/type/정적 상태를 보존한다.  최종 ownership 보강은 새 container admission 뒤 내부 lease/tree를 만들며 기존 root에 표시를 남기거나 회수하지 않는다. 실제 delete/marker 두 negative control은 같은 probe SHA에서 실패하고 보강된 owner는 통과했다(ownership-controls.json). 실제 staging4회귀 PASS; disposable nonce만 고정하고 kernel/namespace/PID 사실은 대체하지 않았다. source별 최종 기록은 admission-runtime/summary.json·admission-final-summary.json을 따른다. |
| Git 명시 view·setup FD 전달 기반 | shared candidate/quarantine의 고정 Linux 경로를 제거하고 명시 closed view의 Git/project/workspace/root/bundle/tmp를 사용. Linux producer도 같은 private payload를 만들며 legacy/open/invalid/overlap/UTF-8 손실을 거절한다. 실제 scoped thin bundle의 canonical alias(Unicode/quote/LF) prerequisite 실패를7/8로 재현하고 Git C-quoted UTF-8 octal alternates로 같은 test SHA의8/8을 확인. accepted FD/cursor/refs와 두 단계 scope/권한 순서는 유지. Seatbelt는 기본 extra-FD 전체 close, explicit setup slot만 허용하며 production C header의 real POSIX 동작을 Linux에서 검증: FD64 open→soft limit16 뒤6/8만 유지·CLOEXEC 해제·나머지 close, 음성 대조는 누출 검출·잘못된/없는 FD는125 거절. actual Darwin helper/SDK 실행은 NOT_RUN이고 kept-FD kernel case 추가로27×3=81회 required·모두 미실행. input `1c17ce3c51f070220fd9c9fc3702492cdf76cca0686b749e439e328c9978f122`(15636개) 전후와 보호4개 SHA 동일에서 실제 Linux scope/Worker/Git 실행·phase5·정책/오류/FD/기록을 포함한 관련 **158/158**, contract mutation **7/7 PASS**·fail/cancel/skip/todo0. Linux full build·root strict types·module PASS. 초기 stale graph finding은 generator와 병행한 중간 입력으로 별도 보존하고 최종 전체 구조는 후속 문서 입력에서 확인한다. public/durable/golden/과거 review/accepted bytes는 수정하지 않았고 scope/fence 예외도 추가하지 않음. raw는 native-2026-10-27-git-views/의 view-red/green.log·test SHA·fixed/summary.json·각 build/type/source 기록이 소유. Mac 물리 staging/조립과 전체 scope/file/auth·형식 경계는 미완료 |
| 공통 Worker 정책·Mac recipe 조립 | protocol의 공통 actor/root/lease/설치 grammar와 domain directory access 표를 Linux bind·Mac Seatbelt·PathView가 함께 사용. 모델용 oma는 명시한 OMA_NODE/OMA_CLI를 literal argv로 실행하며 env 기본값도 같은 view에서 계산. Mac recipe는 자기 workspace/home/session write·나머지 declared roots read·hidden deny·exact Mach/Unix IPC·명시 env만 사용하며 App residentPlan/spawn에 연결했으나 기존 native spawn guard는 유지. 읽기 전용 설치의 정확한 client preload만 승인하고 native loader/NODE_PATH/ambient secret은 거절. input `1ee75abc2ea88ed73a7fc3dec5d4c8d77a36df12df6aea05ea684a5012c34e3c`(15631개) 전후와 보호4개 SHA 동일에서 관련 **111/111**, contract mutation **7/7 PASS**·모두 fail/cancel/skip/todo0. 실제 UID1000/CapEff0·pinned bwrap0.12/private /dev와 /usr/bin overlay의 Worker 환경·격리·scope/setsid 후손 종료를 포함하며 Mac 실행 증거가 아님. full build·root strict types·workspace/module·중간 architecture PASS. 최종 결과 문서 입력의 구조 검사는 별도. 초기 타입 widening compile 실패·실제 Node ESM 백슬래시 entry 거절·semantic owner 미분류 finding을 보존하고 전용 경로 거절/정확한 K1 owner를 추가했으며 새로운 fence 예외는 없음. Mac CI에는 trusted preload의 host-read 거절을 추가해26×3=78회 required·모두 NOT_RUN. raw는 native-2026-10-27-worker-recipe/의 fixed/summary.json·raw와 source별 build/type/구조 로그가 소유. historical review/public·durable DTO·accepted bytes는 보존했고 check/quarantine Mac 조립·G-PROCESS/G-FILES/G-AUTH와 형식 경계는 미완료 |
| 실제 Darwin CI 시험 준비 후속 | macos-26/15 각각25개 case×3회=75회 required manifest. 기존 kernel/Mach/Seatbelt 대용량 관측에 framing8종·argv/env/stdin·실제 inherited canary FD 양성/음성·허용/외부 Unix socket을 독립 추가. missing/duplicate/program/observation 귀속·비정상 종료/signal·NOT_RUN·정리/기록 실패를 성공으로 세지 않음. 실제 build output bytes/mode/증분 상태/workspace set과 source identity를 전후 대조하고 개별 raw·SDK/OS/Node/git/package versions·compiled probe SHA를 보존. Linux에서 실제 Darwin driver 거절/75개 NOT_RUN 기록, 실제 C FD oracle의 상속/미상속 대조와 filesystem mutation을 포함한 관련 **109/109 PASS**·fail/cancel/skip/todo0; input `0b599442ae6a60d6f65f50e3fc924d4885d9b6647b18728471c6b613573e5aae`(15625개). full build PASS. 초기 refresh는 역사적 stale review를 거절했고 원문은 보존한 채 명시 invalidate-stale로 현재 derived ledger만 생성했다. 해당 source의 전체 구조 검사는 후속으로 구분. 실제 Darwin75회는 NOT_RUN·세 gate OPEN이며 관측이 완료되어도 driver는 제품 qualification BLOCKED/exit1을 유지. 사용자 설명상 Mac CI 할당량이 소진돼 복구를 나중으로 미뤘으며, push는 Linux만·수동 run_darwin=true일 때만 Mac을 선택하고 지금 dispatch하지 않음. 직전 a1cc3f9c CI7개 job은 steps/logs null·artifact 없음. raw는 native-2026-10-27-ci-readiness/가 소유 |
| 공통 PathView·논리 inbox 후속 | 같은 root/endpoint 표의 mounted/host layout으로 Pi argv/env·relay·entry·session 역변환을 연결. caller dirs 변경 반례를 snapshot으로 거절하고 exact /inbox.md를 검증된 hashline read의 public prepareArguments에 전달해 anchors·offset/limit을 유지. public/durable/receipt와 vendor bytes는 바꾸지 않고 native golden에 transient interface2개만 추가(기존 fingerprint 전부 동일). 정책/실제 일반 read **29/29 PASS**·skip/cancel/todo0·strict types PASS이며 실제 Mac kernel proof가 아님. raw native-2026-10-27-path-view와 source별 후속 실행 기록을 따름. 입력 `e55935e4e63868bba3922a30ad68ea3f16eb59019327a7b9ab20049d8026557c`(15619개) 전후 및 보호4개 SHA 동일에서 실제 UID1000/CapEff0·pinned bwrap0.12/private /dev의 관련 Linux **70/70**, 별도 contract mutation **7/7 PASS**·모두 fail/cancel/skip/todo0. full build와 전체 구조 검사도 통과. 실제 kernel scope8개를 포함하며 전체 Linux 회귀/Mac 지원 결과는 아님. 초기 assertion 문구와 TS fixture 직접 실행 오류, extension 직접 execute 위임을 거절한 구조 finding을 raw에 보존하고 최종은 Pi public prepareArguments를 사용. PathView 내부와 spawn→session return의 변동2개 반례도 실패시킨 뒤 고정 문자열 view로 수리했으며 grant/peer/scope는 cache하지 않음. 최종 결과 문서 입력과 purpose별 조립·actual Mac 검증은 별도 |
| 후속 Mac flag·공통 ancestry 수리 | XNU가 거절하는 NOFOLLOW_ANY+NOFOLLOW 조합을 native leaf에서 제거하되 ANY/BENEATH/CLOEXEC를 유지. 정상 open·중간/최종 symlink 거절의 실제 kernel 회귀를 추가하고 platform lane의 필수 이름으로 결박함. 공통 ancestry의 변동 관측4개 반례는 수정 전5/9 PASS·4 FAIL, 같은 시험 파일 SHA `6d7b7d45...`로 수정 뒤 관련 **51/51 PASS**·fail/cancel/skip/todo0. 실제 Linux file/process 관측과 supplied-reader TS 정책 증거이며 Darwin raw-EINVAL branch/세 gate는 NOT_RUN·OPEN. 첫 full build는 분리 작업트리의 외부 third-party symlink를 설치 경계 검사에서 거절했으며 raw를 보존했다. 기존 의존성 view를 보존하고 locked npm ci를 실제 독립 설치한 뒤 full build PASS. `/home/dev/oma-audit-artifacts/native-2026-10-27-nofollow/`가 원문·실패·수정 source/test SHA·build/선택 결과를 소유하며 전체 후속 회귀는 별도 |
| 후속 SnapshotReader·Darwin metadata·Seatbelt 구현 | SnapshotReader의 O_SYMLINK+O_NOFOLLOW 충돌을 제거하고 전체 parent를 openBeneath로 해석. statAt은 Darwin64 fstatat/AT_SYMLINK_NOFOLLOW·numeric/BigInt/ns와 최초 실제 Node layout 대조, 실제 SDK scalar/offset assert를 구현. Seatbelt는 TS deny-default renderer·환경 검사·정확한 IPC 허용·private pipe와 최소 public sandbox_init/execve C launcher를 구현하고 Darwin workspace build와 실제 driver의6개 추가 case에 연결했다. 실제 Mac 총42개 시도는 NOT_RUN이며 목적별 PathView·scope·pin/exact reopen/실행 결박·인증 qualification과 제품 guard는 별도다. input `1b53992cf75eaa4cd40394f032babb8c729dd816f23a41bc6989b59a8b7c0669`(15617개) 전후 동일에서 full build·전체 architecture/transaction/durable/document/spec PASS와 관련 **95/95 PASS**·fail/cancel/skip/todo0. root types도 후속 구조 입력에서 확인한다. 새 generated helper의 엄격한 asset owner와 source 존재를 검사하며 처음 asset/path/무fence spawn 거절도 보존. platform은 직접 spawn하지 않고 framed recipe를 반환해 기존 process owner를 사용하며 fence exemption을 추가하지 않았다. nofollow audit root의 `recipe-final-{build,architecture,smoke}.log`·`recipe-final-summary.json`이 원본을 소유. 이후 결과 문서 입력과 actual Darwin qualification은 별도이며 이전51/51을 새 source 증거로 재사용하지 않는다 |
| `29938a42` 최신 source 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정 installed-runtime smoke **16/16 PASS**·자체 declaration 오류0. 외부 SDK declaration 진단44개는 별도 분류하며 workspace별 반복을 합산한 새 오류 수로 표시하지 않음. exit0·263.254초·input `ae96e9f67c48f58c95020eaa7beb989ef467baaed258f4e43b24bb8770f84ba9`(15613개) 및 보호 README/architecture/과거 review/golden SHA 전후 동일. 현재 사용자 README가 포함된 입력이며 clean commit의 구조 binding과 구분. `/home/dev/oma-audit-artifacts/native-2026-10-27-qualification/packed-20261026T210501Z/`가 실제 명령·source HEAD·원시 출력·종료·workspace별 합계를 소유. 이후 결과 문서 입력과 실제 Darwin qualification은 별도 |
| `29938a42` 실제 CI와 완료 대조 | Native40400373660·Architecture40400373613의7개 job 모두 terminal failure·steps/logs null·artifact 없음. check-run output의 title/summary/text도 null이고 annotation 본문은 연결 도구가 제공하지 않아 원인은 미확정. 실제 Darwin36개 case는 NOT_RUN. P0–P7와 §13.2의7개 최종 조건을 다시 대조했으며 Darwin scope·pin/exact reopen·실행 대상 결박과 실제 인증/격리/수명 qualification이 미완료다. Linux/설치 통과를 전체 완료로 승격하지 않는다. native spec §14.14와 qualification root의 `p0-p7-audit-29938a42.json`, async audit root의 `ci-29938a42.json`·`ci-29938a42-check-runs-20261027.json`이 범위를 소유 |
| `bd2049c8` 수리 후 전체 Linux 회귀 | **3787/3787 PASS**(serial13/13, parallel3774/3774), fail/cancel/skip/todo0·exit0·973.149초. 실제 UID1000·CapEff0·Node26·pinned bwrap0.12의 private /dev와 /usr/bin overlay에서457개 file·parallel concurrency4·native execution 필수6개를 포함했다. input `9241f47e6aae491e07541aafba2995bf016a8a5b6a5256f1addfef83b2cdd8b9`(15612개)와 보호 README/architecture/과거 review/golden SHA가 전후 동일하며 관측 중 수동 개입은 없었다. 이는 이후 P7 문서-closure 변경 전의 실제 Linux 결과이며 actual Mac/CI 지원 증거가 아님. async audit root의 `full-linux-dev-20261026T203916Z/`가 명령·profile·상태·원시 로그·phase별 실제 합계를 소유 |
| `bd2049c8` 실제 CI | Native40397569660·Architecture40397569605의7개 job 모두 terminal failure·steps/logs null·artifact 없음. 실제36개 Darwin case는 NOT_RUN이고 원인은 미확정이다. async audit root의 `ci-bd2049c8.json`·`ci-bd2049c8-artifacts.json`이 원본을 소유하며 같은 입력의 무의미한 재실행으로 덮지 않음 |
| P7 후속 정적/문서 검사 | 분리 작업트리의 input `950cf5e29804acfc02dc7ef66f7bdd4fcf3fb425f520f2bbc01ed27597de9f06`(15613개) 전후 동일에서 전체 architecture/transaction/durable/document/spec PASS·문서/입력/workflow **32/32 PASS**·fail/cancel/skip/todo0. 첫 architecture 실행은 공유 node_modules 링크가 @oma를 원래 작업트리 밖으로 해석해51개 finding으로 실패했으며 raw를 보존했다.26개 workspace를 실제 분리 작업트리로 연결하고 같은 compiled output을 복사한 뒤 같은 입력의 architecture를 다시 통과했다. gate 규칙은 바꾸지 않았고 production source 변경도 없다. raw `document-closure-static-*`, `document-closure-architecture-*`, `closure-worktree-dependencies.json` |
| P7 문서 입력 누락 수리 | 문서 gate가 실제 읽는 루트 README와 목록 밖 신규 Markdown이 기존 digest에 없었다. 별도 fixture에서 README의 깨진 링크/새 문서의 배치 오류가 결과를 바꿔도 identity가 같았고, 새 반례2개가 수정 전 모두 FAIL했다. README를 필수 입력으로 추가하고 문서 gate의 discovery owner가 발견하는 현재 Markdown도 같은 source/symlink 검사로 결박한다. 반례 본문은 전후 동일하며, 분리 작업트리의 input `9774a54ce1ebd3feab7fed66656dcdb70865b3a1d294966b83999ca107b361c4`(15613개) 전후 동일·문서/입력 목록 **17/17 PASS**·fail/cancel/skip/todo0. 이전15612개 결과의 누락은 보호 README의 별도 SHA 증거로만 한정하며 완전한 입력 closure였다고 승격하지 않음. raw `document-closure-{red,green}-*`와 `readme-closure-red.json`은 async audit root가 소유. commit의 README와 최초 사용자 변경 README는 서로 다른 실제 입력이며, 전자를 쓰는 CI binding과 후자의 로컬 재생성 binding을 섞지 않음 |
| `c2745daa` 전체 Linux 회귀의 실패 보존 | 전체 **3772/3784 PASS·12 FAIL**(serial13/13, parallel3759/3771), fail12·cancel/skip/todo0·exit1. input `ee6bdd0688e7a7a33d81bb9d8e270adcb657a181927eebe93316e806c46459ac`(15612개)와 보호 파일 SHA는 전후 동일. 마지막 peer-pid 시험의 uncaught `this.pinPeer is not a function` 뒤 정리가 열린 socket을 기다려, 나머지 file 완료를 확인하고 해당 소유 test PID만 SIGTERM했다. 원래 오류와 개입을 `peer-pid-cleanup-intervention.json`에 보존하며 정상 완료/PASS로 계산하지 않음. 첫 outer bwrap의 /dev/null EACCES는 시험 시작 전 SETUP_FAILED/NOT_RUN으로 별도 보존. private /dev와 /usr/bin overlay 수정 후 실제 UID1000·CapEff0·bwrap0.12/Node26에서 실행. raw 소유자는 async audit root의 `full-linux-dev-20261026T193211Z/` |
| 위12건의 수정 후 선택 회귀 | UUID/실제 pin·endpoint 주입 fixture를 연결하고 find 완료 경로가 실제 `fdfind`도 사용하도록 수정. 원래 기대값을 유지하고 **26/26 +55/55 PASS**, input `970ceccf70ba1d2eeaa79d0574d0b69db8be7f260032b26f4db9b0b83e3576a7` 전후 동일·skip/cancel/todo0. source HEAD 전의 실제 private fdfind-only probe는 ENOENT, 수정 후1100/1100 경로 반환. 이후 find0/grep fractional-limit 반례2개를 추가해 수정 전29/31 PASS·2 FAIL, 수정 뒤 **31/31 PASS**·input `652fc93dd8586a1a9d67fa0db33164394c70cb6efe0c33e12f27fcc64559644c` 전후 동일·skip/cancel/todo0. 이는 서로 다른 선택 입력이며 전체 후속 PASS가 아님. 원시 로그/실패/SDK source SHA/probe는 async audit root의 `full-repair-focused-*`, `fd-alias-probe-*`, `search-limits-{red,green}-*` |
| `c2745daa` 비동기 audit 후속 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정된 installed-runtime smoke PASS. exit0·279.368초·input `f353d0157c995f17ace4ff1108308989df94fc3709c76efa73dae52ccededef0`(15612개) 전후 동일. 외부 SDK declaration 진단44개는 별도 분류. async audit root의 `packed-20261026T191736Z/`가 source HEAD·실제 명령·로그·종료·identity 소유. native callback/CF 실제 Darwin 실행 증거는 아님 |
| `c2745daa` 새 CI | 작업 브랜치 push 성공. Native40385385778·Architecture40385385695의7개 job 모두 스텝 없이 failure. 마지막 queued Mac15 job도 같은 handle로 재조회해 terminal을 확인했으며 steps/artifact 없음. 실제 Darwin36개 C/Node case는 **NOT_RUN**. annotation 본문은 connector 지원 범위 밖이며 근본 원인은 미확정이다. async audit root의 `ci-c2745daa.json`에 초기/최종 원본 응답을 보존함 |
| 비동기 audit/stream 반환 source 연결 후 | 고정 input `f6eaeca119f2e2df41c40fcc91122b1b14862cb1e8bd94e7e8d7d0269851b148`(15612개) 전후 동일. build·26 workspace/root strict·전체 architecture/transaction/durable/document/spec 검사 PASS. 관련 shared-flow/lifetime **52/52**, generation **9/9**, native consumer-port mutation **7/7 PASS**·fail/cancel/skip/todo0. 새 비동기 PacketStream4개 회귀는 수정 전 모두 FAIL·기존4개 PASS, 수정 뒤8/8. 원시 실패·수리 로그/상태는 `/home/dev/oma-audit-artifacts/native-2026-10-27-async-audit/` 소유. actual Darwin Security/Mach 실행과 WP23·expected Broker identity·세 gate proof가 아님. 이후 결과 문서는 별도 입력 |
| `7ebb7268` 현재 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정된 installed-runtime smoke PASS. exit0·271.606초·input `2e277fbabcb6bf967ce59d99ba0a42184783ec4c337f24625e67589a1625454b`(15612개) 전후 동일. 외부 SDK declaration 진단44개는 원시 로그에 별도 분류하며 자체 오류로 숨기지 않음. 새 audit root의 `packed-install-20261026T184226Z/`가 실제 명령·로그·종료·identity 소유자이며 실제 Darwin qualification이 아님 |
| `7ebb7268` 새 CI 시작 실패 | 작업 브랜치 push 성공. Native40380089004·Architecture40380089190의7개 job 모두4–5초 뒤 스텝 없이 failure. job steps/실행 로그/artifact 없음. check annotation1/2건은 있으나 본문 URL이 connector allowlist400으로 거절됨. 근본 원인 미확정이며 SDK·코드 실패로 추정하지 않음. 새 Node adapter3개 case와 C probe의 이 입력 실행은 **NOT_RUN**. 새 audit root의 `ci-7ebb7268.json`이 원본 응답을 보존함 |
| Mach connector·실제 Darwin Node probe 연결 후 정적/공통 검사 | build·26 workspace/root strict typecheck·전체 architecture/transaction/durable/document/spec 검사 PASS. CI 공통 목록15개 파일 **81/81**, channel generation **9/9 PASS**·fail/skip/cancel/todo0. 각 input `7736cda4f8f874ac9b48ca6b0c8cc1e54c82b0feb359f895e035d758961eb441`(15612개) 전후 동일. 원시 명령/로그/종료 상태는 새 audit root의 `mach-ci-checks-20261026T183534Z/`. 이후 Node fixture의 관측/cleanup deadline과 job ceiling 및 결과 문서는 별도 입력이며 재결박으로 이 PASS를 갱신하지 않음. 실제 Mac Node 세 경우는 CI 실행 전 NOT_RUN이며 세 gate는 OPEN |
| Mach source 연결 뒤 shared/Linux 선택 회귀 | 공통 packet/listener/generation·실제 Linux recvmsg/descriptor 인계 **21/21**, 변경 error/history/package/runner API **41/41**, native consumer-port positive/negative mutation **7/7 PASS**. 각 실행 input `f86efa4eb30d1ebd8af2bd11a59982b73833b0efa87725b25329531d721ddb8f`(15611개) 전후 동일, fail/cancel/skip/todo0. 서로 다른 세 선택 실행이며 전체 suite나 Mac qualification이 아님. 격리 시험은 pinned bwrap0.12.0을 임시 /usr/bin overlay에서 실행했고 UID1000·CapEff0·binary SHA를 보존했다. host /usr/bin은 변경하지 않았다. 원시 로그/상태/단계 명령/전후 identity와 SHA는 `/home/dev/oma-audit-artifacts/native-2026-10-27-mach-connector/`가 소유함 |
| 위 후속의 최초 실패 보존 | 첫 선택 실행 **20/21 PASS·1 FAIL**: missing-directory bind의 ENOENT 기대에 실제 EACCES가 반환됨. 실제 점유된 주소의 EADDRINUSE 및 기존 listener 보존으로 강화 후21/21 확인. 별도 첫 확대 실행 **37/38 PASS·1 FAIL**은 원본 TS를 잘못 실행해 compiled fixture를 찾지 못한 명령 오류. 올바른 compiled JS와 실제 bwrap view에서41/41 확인. 최초 로그도 같은 새 audit root에 보존하며 지우거나 전체 PASS로 덮지 않음 |
| START/public-validation fixture 수정 후 관련 회귀 | **33/33 PASS**, skip/cancel/todo0·18.495초·input `ce9b96e02382976921f01f69b0ae67fe4c1471efd9c3dbba6d37fd4b65fdfd56` 전후 동일. `native-reference-fixtures-focused*`. 실제 Node timer를 사용하며 기존 latency budget과 accepted fact 판정 유지. 첫 전체17 FAIL을 전체 PASS로 대체하지 않음 |
| 외부 구현 대조·reply turn 후속 첫 전체 local | **3762/3779 PASS·17 FAIL**, skip/cancel/todo0·940.027초·input `bc7e189f79ebed11044bd9697a3ed987bbb9904781b93b083585e00a78b02a18` 전후 동일. `native-reference-yield-whole*`. 실패는 START의 옛 host/guest 기대값1건과 public-validation fixture의 새 Node timer import 미연결16건. 문구를 정확히 갱신하고 실제 timer module을 fixture에 연결한 후 정책16/16 PASS·skip0. 전체 재실행 결과와 구분 |
| `5e369b30` 전체 Architecture CI40316751983 | baseline/native-all 모두 **3777/3777 PASS**, skip/cancel/todo0. baseline fast795/795·durable871/871·property34/34·stress13/13·platform29/29 PASS. standalone kernel/crash wrapper는 NOT_RUN이며 native-all의 실제 파일/필수 이름으로 실행. ZIP `12649820624` SHA256 `2a225f1a198ad8e1eb9d389bf93abb0d517c859885f75cd0edbe27cfaa4a9113`, native-all `12648632520` SHA256 `bced406a8587ffe6f8cca335edde624d0ab216128bfdb0d425adbbe85476116c`; source/input 별도 검증. 이후 변경의 결과가 아님 |
| 앞선 전체 CI의 실패 보존 | `e997fe37` baseline3777/3777 PASS, native-all3776/3777·mkdirAt EAGAIN1. `e37ad5e0` 전체3777/3777 및 native-all3777/3777 PASS, stress12/13·mixed lag100ms 실패. raw SHA 확인 후 각 ci 폴더에 보존. 후속 성공으로 실패를 덮지 않음. 실제 mkdirat/owned mkdirAt 각각20만 회·자식25개는 EEXIST만 관측했고 EAGAIN 원인은 미확정 |
| mutation reply turn 회귀 | 새2개는 수정 전2 FAIL, 기존6개 PASS. 공통 PublicDispatcher에서 효과/view 갱신 뒤 turn을 반환한 뒤 **8/8 PASS**, skip/cancel/todo0·16.814초·input `4596344b5a0f10da87f296a04dd9911db91841705c9eddf82ddcb6821e41656d` 전후 동일. admission 철회 뒤 accepted plan/result 보존 포함, 기존50/100ms 지연 기준 유지. `native-dispatch-yield-{before,after}-fix*`; 전체 후속 검증과 별도 |
| `9116bb6b` 새 CI 시작 실패 | Native40318575316/Architecture40318575321의 모든 job은 스텝·실행 로그 없이 시작 전에 failure. 새 Mac self/등록 포트 후보는 **NOT_RUN**이며 compiler/runtime 결과가 아니다. annotation 상세는 현재 조회 도구에서 미확인. 이후 외부 구현 대조와 Chromium rendezvous 후보 반영도 실제 Mac 재실행 전 |
| `e997fe37` 실제 Mac26/15 Mach 후보 SDK 실패 | 기존15개 관측은 각각 OBSERVED. 새 후보는 deprecated mach_port_destroy에 -Werror compile 실패,6개 case 미실행/SETUP_FAILED. 원시 ZIP2개 SHA256/source 확인·`ci-e997fe37/` 보존. 경고 억제 없이 send/receive 권리별 반환으로 수정 후 실제 CI 재실행 필요. 세 gate OPEN이며 전체 workflow PASS가 아님 |
| status owner·Darwin 후보 추가 뒤 독립 설치/정적 | **26/26 packed install/public API/authored declaration/해당 installed runtime PASS**,269.430초. input `a3b7fb252b39a2ca6a6fafb1d587c4bfb58785c9e9b7b601950ee0ce20ed8c0b` 전후 동일. 전체 정적 gate41.075초·정책7/7·inventory18/18 PASS. 외부 SDK declaration44개는 별도이며 authored 오류0. `native-status-mach-*`. 이후 유지보수/결과 문서는 별도 입력이고 실제 Darwin C 실행은 아직 NOT_RUN |
| status owner 후속 Linux 선택46개 파일 | **430/430 PASS**, fail/skip/cancel/todo0·466.084초·input `66ab51c0afa08c39760f8c1e27837113c230e0625564eca6635084724b2d3896` 전후 동일. `native-status-owner-integration*`. read20/mixed39/pending620 lag19ms, 기존 budget50/100/50ms 유지. 같은 입력 전체 정적 gate·정책7/7 PASS. 이후 운영 문서·Darwin 후보 추가는 이 실행의 입력이 아니며 전체/CI 결과로 승격하지 않음 |
| `db68c111` 최신 전체 local | **3773/3775 PASS·2 FAIL**, skip/cancel/todo0·894.612초·input `ec7ee8fc1481ed838594ebe5d4cdf40639d421681b166c671d39b78baf4292bf` 전후 동일. `native-whole-db68c111*`. prompt의 host/guest 기대값과 cgroup 제거의 새 native golden hash가 실패했고 정확한 기대값으로 수정 후 부분 재검증 PASS. production이나 과거 golden을 되돌리지 않음 |
| `db68c111` 실제 Native CI40284241937 | Linux/Mac15/Mac26 공통각 **74/74**, Linux peer3/3·native37/37·선택386/386 PASS·skip/cancel/todo0. input ec7ee8fc… 전후 동일. raw zip5개 SHA/source/input 검증, `ci-db68c111/verified-summary.json`. 양 Darwin SDK compile0·각15개 실제 관측·세 gate OPEN/BLOCKED. peer token도 읽기 전후 동일32bytes이며 per-message origin 미증명 |
| `db68c111` 독립 packed install | **26/26 PASS**, authored declaration 오류0(외부 SDK 진단44는 별도), input ec7ee8fc… 전후 동일·276.137초. `native-post-regression-packed-install*`. 이후 broker 상태 게시 수명 변경은 재검증 대상 |
| `db68c111` Architecture CI40284241877 | **FAIL**. native-all **3772/3775 FAIL3**(prompt/golden/Principal restart delivery), fast794/795 FAIL1. durable871/871·property34/34·stress11/11·platform29/29 PASS·skip0. baseline local serial7/9 FAIL2(지연 예산), parallel3762/3766 FAIL4(prompt/golden/Worker autonomy2). 원시 architecture artifact2개 SHA 검증. 부분 lane PASS를 전체 PASS로 합산하지 않음 |
| CI 후속 상태 게시·동시 실행 수리 | 실제 네 hint가 동일 status를4회 영속 게시한 반례를 보존. 기존 coalescer 재사용·publication task drain, 실제 peer 완료/accepted bytes 대조, Principal actual close 대기로 수정. 관련 **9/9 PASS**·skip/cancel/todo0·47.051초·input `c88fe60f81dbafa4bc638db5999a75916306c5a9e7469fa1308f9e6ac049b361` 전후 동일. `native-status-and-scenario-ownership*`. read19/mixed43/pending12ms; 원래 budget50/100/50ms 유지. 후속 전체/실제 CI는 별도 필요 |
| 전체 Linux 후속 회귀 | **3759/3760 PASS·1 FAIL**, skip/cancel/todo0, 934.673초. input `91909d2aef50ba0583eba51b63f9a1a8b99c0692c707ed9200952d0b1c3d6844` 전후 동일. 유일한 실패는 동적 Runner 제목과 durable registry의 참조2건이며 명시적 시험명으로 수정. `native-whole-current-repaired*`. 이 입력의 Personal PTY는 ambient oma를 사용했으므로 현재 설치 proof로 제외. 이후 실제 설치·통신 변경은 다음 별도 결과 |
| 현재 checkout의 실제 설치·Keychain·Runner·경계 | **70/70 PASS**, skip/cancel/todo0·input `d3892c6bbb1a34dcf9eacb7a676584ce54dcf44127c1831633cd2408ac6c7dae` 전후 동일·64.659초. `native-keychain-install-source-fenced*`. Personal PTY16건은 runtime-only prefix의 exact bin과 checkout module/data 거절 guard를 사용. 실제 socket15건은 fatal UTF-8/BOM/중복 key/unknown correlation·field·type/oversize/EOF/timeout과 poison을 검증. Keychain ownership 정책·Runner 통신·durable registry 포함. signed Keychain/TCC/G-AUTH나 독립 packed install의 대체가 아님. 첫69/70 fixture 실패와54/70 guard setup 실패도 보존 |
| `3f0f6151` 실제 Native CI `40259190478` | Mac15/26·Ubuntu 공통 각 **59/59**, Ubuntu peer **3/3**·native **37/37**·선택 integration **386/386 PASS**, skip/cancel/todo0. 세 OS input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d` 전후 동일. 원시 zip5개 SHA256·source 확인, `ci-3f0f6151/verified-summary.json`. Darwin 각15개 관측/세 gate는 OPEN/BLOCKED이며 workflow 전체 PASS가 아님 |
| 같은 commit의 Architecture CI `40259190470` | **FAIL**. native-all/fast는 installer의 외부 bubblewrap 문서7건이 저장소 `.scratch`에 남아 document-integrity에서 **PRECHECK_FAILED/NOT_RUN**. durable **843/871 FAIL28**, property **28/34 FAIL6**, stress **8/11 FAIL3**, platform **29/29 PASS**·각 skip/cancel/todo0. SHA256 확인한 baseline/all zip과 `architecture-results-summary.json` 보존. 준비 도구의 source/build/bin을 RUNNER_TEMP로 옮겼으며 문서 검사 예외를 추가하지 않음. 후속 실제 CI 검증 필요 |
| `3f0f6151` 전체 Linux local | **3607/3759 FAIL152**, skip/cancel/todo0, 454개 파일·881.448초. input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d` 전후 동일. `native-whole-local-3f0f6151{.log,-status.json}`, 실패 상세 `*-failure-progress.json`. 실패33개 파일의 당시 원문은 `docs/archive/native-full-regressions-2026-10-26/` 보존 |
| 전체 실패 후속 부분 수리 | 실제 candidate SIGKILL cleanup의 의도한 ABORT_ERR 중복 경합은 실제 close join을 유지해 수정 후 **7/7 PASS**. 공통 workspace asset 검증은 Swift source와 원래 entitlements를 모두 요구. 후속 부분 **173/187 FAIL14**의14건은 broker harness의 retainNative 소유·drain 순서 수정 후 **17/17 PASS**. 서로 다른 입력의 부분 결과를 전체 PASS로 합산하지 않음 |
| native receipt·transport 후속 | 실제 namespace의 receipt/lifecycle **16/16**, 실제 connection flood+receipt policy **18/18**, 실제 private socket idle/EOF **4/4**, 설치된 MCP credential adapter의 실제 owned namespace 실행 **1/1 PASS**·각 skip/cancel/todo0·각 input 전후 동일. `native-receipt-real-scopes`, `native-flood-and-receipt-policy`, `native-runner-private-channel-fixed`, `native-mcp-owned-credential-fixed` 원시 log/status. policy stubs는 OS/auth proof가 아니며 MCP host shell guard는 유지. 최신 전체 회귀/CI/packed 설치는 별도 필요 |
| native publication/cursor 수리의 실제 재검증 | **72/72 PASS**, fail/cancel/skip/todo0·input `8e4e28b76f65cee4fb01fdcc9ea181cbba9ecc84b61410e18f20e0a4936f083a` 전후 동일. 초기 journal 게시 뒤 실제 SIGKILL/재초기화·candidate checkout 뒤 SIGKILL/재시도·같은 bundle FD의 진행한 cursor와 교체 pathname·accepted 원본 bytes·canonical refs를 검증했다. UTF-8/owner rule negative controls도 포함. `native-canonical-scope-fixed{.log,-status.json}`. 전체 root runtime과 후속 CI는 별도 |
| native publication 경계 후속 | durable 등록 불일치5건을 실제 owner/checkpoint로 갱신. 관련 최초 실행 **70/72 FAIL2**, skip/cancel/todo0·input `205d2f05143971f0426f0e991d15c4c3019acaa7534a4c6fb5d0661c1649fafc` 전후 동일. 초기 publication 시점에는 아직 journal writer lock을 획득하지 않았으며, quarantine의 bwrap data 소비가 borrowed FD cursor를 EOF로 만들어 동일 FD 재시도를 거절했다. 시험의 시점 구분·공통 Git의 exact-inode 독립 cursor 소유를 수정 중. 원시 `native-canonical-scope-regressions{.log,-status.json}` 보존. 후속 결과는 별도 기록 |
| 후속 전체 build·정적 발견 | 전체 build PASS. 첫 전체 정적 검사는 남은 빈 legacy 디렉터리2개, private UTF-8 decoder3곳, 옮겨진 Worker spawn owner와 옛 exemption을 발견했다. 빈 디렉터리 제거·공개 domain decoder 연결·정확한 owner relocation과 private-input helper 검사 후 rule0건 PASS. candidate의 BOM이 실제로 ready/허가1을 만들던 반례(`native-candidate-bom-before-fix.log`)를 보존하고 거절/poison/허가0 회귀와 parser corpus를 추가. 전체 architecture/runtime/CI 결과는 이후 고정 입력에서 별도 확인 |
| `dd8d7a96` 실제 CI `40254390815` | Mac26/15·Ubuntu 공통 각각 **58/58**, Ubuntu peer3/3·native35/35·확대44개 파일 **386/386 PASS**, skip/cancel/todo0. 세 OS input `4927bdabbfd9b9aba3e478158a2a473174d33c7cfb22d1f6b4a1e89601904ace`·전후 동일. 실제 prerequisites-before에는 rg/fd/fdfind가 없고 Corepack0.36.0은 ambient PATH에만 있었다. Node prefix에0.34.0 설치 후 Worker 실제 명령도 통과. 양 Darwin 각15개 관측/세 gate는 OPEN/BLOCKED이며 전체 workflow PASS가 아님. zip5개 SHA256·source 확인, `ci-dd8d7a96/verified-summary.json` 보존 |
| 전체 검증 도구의 native 전환 작업 트리 | local에서 native execution 시험 제외를 없애고 kernel/all/durable은 pinned0.12.0 preflight를 요구한다. manager opt-in/fixture/cleanup 경로를 제거하되 direct argv/manager 거절 guard는 유지한다. 현재 selection/clock/source-binding 정책 **42/42 PASS**·skip0(`native-verification-all-policy.log`); 이 정책 단위 시험은 새 shared CI installer나 전체 Linux runtime의 PASS가 아니다. installer/전체 native-all job·root 전체 회귀의 실제 실행은 다음 검증 대상 |
| `159c66c8` 실제 CI `40252199462` | Mac26/15·Ubuntu 공통 각각 **58/58**, Ubuntu peer3/3·native35/35 PASS. 확대 integration은 **355/359 FAIL**, skip0: Python message-id header의 선행 folding 공백, 검색 도구, Node26에 없는 Corepack 및 그 실제 실행4건. 세 OS input `b9cada156294180f8e44963308ae06f8a7bd2bbf1c93f290f98b4f8d0e4781a0`·전후 동일. Darwin 양쪽 실제15개 관측의 세 gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 `ci-159c66c8/verified-summary.json`에 보존. 전체 workflow FAIL을 PASS로 표시하지 않음 |
| 남은 audit/phase4 native 전환 작업 트리 | 실제 scope와 원래 accepted/data 단언을 함께 검증한 **30/30 PASS**, strict/noEmitOnError 컴파일 PASS. root 전체 strict 진단0·모듈 경계0건 PASS(`native-root-final-reference-removal.log`, `native-modules-final-reference-removal.log`). 기존 C1은 실제 동시 quarantine의 RUN_TERMINATION_UNKNOWN도 unknown으로 보존하고 exact plan/ref/receipt의 수렴을 요구한다. 최초 실패 로그는 `native-audit-{first-failure,concurrent-scope-failure}.log`에 보존. 이후 작은 manifest child의 shell 제거·CI44개 목록과 prerequisite 수정은 후속 검증 필요 |
| 검색 도구 설치 차이 재현 | isolated PATH에서 실제 rg 부재는 같은 contained-search 거절을 재현하고 실제 rg를 추가하면 같은 파일/질의가 성공했다. 원본 bytes 보존. `native-ripgrep-prerequisite-repro.log`. fd 부재를 원인으로 가정한 첫 대조는 재현되지 않았으며 `native-fd-prerequisite-repro.log`를 그대로 보존. CI는 rg/fd-find/Corepack0.34.0의 실제 설치·버전/SHA를 남기도록 수정 중이며 실패를 skip하지 않음 |
| 확장 native 회귀 및 모듈 독립 설치 — 현재 production 변경 포함 | strict42개 시험 파일에서 **359/359 PASS**, 별도 실제 Linux kernel/sender/namespace **35/35**, 공통 **58/58**, 독립 packed install **26/26 PASS**. 모든 실행 input `e05e5a9542bdda8c50baa8c7d3591251f747418a0bee2872fe63291a699f238e`(15595개)·전후 동일, skip/cancel/todo0. authored declaration 오류0이며 외부 SDK 진단44개는 별도. `native-expanded-{integration,kernel,common}.log`, `native-expanded-independent-install.log`, 각 전후 identity 보존. build26개(7개 재컴파일)·document integrity·production inventory도 PASS. root 전체 strict는 audit/phase4의 제거 API/옛 Promise 처리8개 진단 FAIL, 모듈 검사는 같은2개 시험 파일의 삭제 import3건 FAIL. 전체 root/최종 qualification으로 승격하지 않음 |
| 전체 회귀 전환 후속 — P0·격리·CLI·candidate | 고정된 각 입력에서 strict 컴파일 후 **56/56**, 별도 **66/66**, 실제 CLI/동시 stream **3/3**, candidate·capability·batch **11/11 PASS**·각 skip0. 입력별 `native-p0-ownership-*`, `native-p0-six-seven-*`, `native-cli-stream-*`, `native-phase5-*`가 원시 로그/전후 identity를 소유한다. 서로 다른 입력의 합계를 전체 PASS로 표시하지 않음 |
| parser/view/entry/quarantine 후속 전환 | 각 입력에서 parser/view/native **56/56**, 실제 broker entry **2/2**, 상태 projection **10/10**, 실제 quarantine **4/4**, phase8+durable crash **50/50 PASS**·각 skip0. 원시 `native-parser-views-*`, `native-topology-entry-*`, `native-status-projection-*`, `native-quarantine-*`, `native-phase8-*` 보존. 이후 production 상태 표시 변경은 이 과거 실행의 입력이 아니며 확장 integration/후속 CI로 다시 검증 |
| 확대 integration 최초 로컬 실행 설정 실패 | strict42개 컴파일은 통과했지만 로컬 `/usr/bin/bwrap` mount wrapper를 빼고 실행하여 실제 OS 시험 FAIL/NOT_RUN. `native-expanded-integration-without-local-bwrap.log`를 보존하며 통과로 세지 않음. 실제 pinned bwrap이 보이는 로컬 mount에서 같은42개 전체를 재실행하고 CI에서도 다시 확인해야 함 |
| `65233ca4` 실제 CI `40244936163` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33·선택 integration **197/197 PASS**·skip0. 실제4MiB tmpfs의 ENOSPC, STORAGE_FULL 및 accepted 원본 보존을 확인. 세 OS input `705cae1ca48ba59b776dc6f4b9acac9c7c26314b43e8c4f63235b2bb2cfeab5c`·전후 동일. 양 Darwin gate는 각15개 실제 관측 후 계속 OPEN/BLOCKED이며 workflow 전체 성공으로 표시하지 않음. zip5개 SHA256 확인·`ci-65233ca4/verified-summary.json`과 원시 artifact 보존 |
| 후속 RPC·역사 plan 시험 전환 | 삭제된 host relay를 registry에서 거절하고 현재 internal response를 closed schema로 검증. 역사 v2가 v3 의미를 얻지 못하는 guard·runner 관측·큰 ledger 조회를 유지. strict 부분 컴파일 뒤 **25/25 PASS**·입력 변경0. `native-root-ports-fixed-{before,after}.json`, `native-root-ports-fixed-real.log`. 최초24/25 실패는 옛 internal method 수9 기대값이며, 현재8개 이름의 정확한 닫힌 목록으로 갱신. 이 후속 변경은 아직 작업 트리에 있음 |
| `d5d65ed4` 실제 CI `40243911993` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33 PASS. Linux 선택 integration은 **179/180 FAIL**: 실제 full-filesystem child의 옛 unshare가 uid_map 권한 거절로 미실행. 세 OS input `218696cec4ea5d1dee5cac3969d2a85e526d4114828aa6952004a9e9b5ceaded`·전후 동일. 양 Darwin gate는 계속 OPEN/BLOCKED·각15개 실제 관측. zip5개 SHA256 확인·원시 `ci-d5d65ed4/` 보존. 전체 workflow 성공으로 표시하지 않음 |
| full-filesystem의 native primitive 전환 | 옛 unshare+shell mount를 pinned bwrap의 실제4MiB tmpfs로 대체. 실제 ENOSPC·STORAGE_FULL·accepted mail 원본/게시 검증을 모두 유지했고 global userns 설정을 바꾸지 않음. 추가 native asset/준비 시험과 함께 **21/21 PASS**·skip0, input `5e5793b5df95997edbcf014f55ed8cd7fec98b41908b10921ae40c42d419c39a`(15597개)·전후 동일. `native-full-fs-replacement-*` 보존. 후속 CI 재실행 필요 |
| `d5d65ed4` 이후 독립 모듈 설치 재검증 | **26/26 PASS**. 각 tarball을 선언한 dependency closure만으로 설치하고 public entries·authored declarations·해당 installed runtime을 검증. 외부 SDK declaration44개는 별도 진단이며 authored 오류0개. input `d05e9255f5df7f17f61bc83469997e6bd296362d475ab6c630ee50c805b222c5`·전후 동일. `native-d5-independent-install.log` 보존 |
| 선택 native integration의 단일 고정 입력 실행 | strict/noEmitOnError로19개 시험 파일을 컴파일하고 **180/180 PASS**·skip/cancel/todo0. input `8dcd2c2ec5c10709a5f73d5502db7061097281864c39c677293d9b88405663fe`(15597개)·전후 동일. `native-selected-integration-{before,after}.json`, `native-selected-integration-real.log`. 실제 Native/Pi·권한·receipt·Worker·durable SIGKILL을 같은 실행에서 검증. 전체 root type/module 검사는 여전히 별도 FAIL이며 Mac 제품 qualification이 아님 |
| `6d8263eb` 실제 CI `40239657753` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native **31/31 PASS**·skip0. 세 OS input `2c2cdee2d33c5cf83392cf626a988748c0aff5f492ef84735e9dd34d7de723fb`·전후 동일. Darwin 양쪽 각15개 실제 관측 후 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 결과와 요약을 `ci-6d8263eb/`에 보존 |
| 실제 Native Resident/Broker/Pi 통합과 종료 수리 | **25/25 시나리오**, 실제 Resident6개를 포함한 공통 수명·shutdown **34/34 PASS**·skip0. input `b6a41d6ce65c8964788337a8b91fc19067fffe9343fc537aa72858b123a5a577`(15594개)·전후 동일. 자동 생성 첫 실행·현재 grant·provider 실패·SIGKILL·broker 교체·receipt·tool plan 거절을 실제 Pi/sandbox로 확인. `native-resident-drain-{scenarios,policies}.log` 보존. root 전체 PASS가 아님 |
| systemd 시험의 실제 native 전환 | strict 부분 컴파일 후 정책·권한·accepted fact **71/71 PASS**, input `db9e3ef267d7076bdc3ff1fb0f44a798e5e449f98711a686e8493a65ca370dfe`. 별도 입력 `62abb6d454cbe99a3dfec064faa4ddab4b73c81f5e92e1d5188b1b626286f392`에서 Worker/sandbox **38/38**, 실제 durable SIGKILL **46/46 PASS**·각 전후 동일·skip0. `native-policy-71-real.log`, `native-connected-{worker,crash}-regressions-real.log` 보존. 당시 시나리오25개 중1개 실패도 보존했으며 위 수리 후25/25와 합산하지 않음 |
| 전환 중 재현한 통합 실패 | 첫18개 시나리오 중2개 실패: 자동 시작으로 초기 mail이 cur로 이동하는 fixture 차이, 종료된 Store 재접근. 이후25개 중1개 실패: runner.open 뒤 옛 incarnation으로 stop하고 diagnostic close가 teardown 뒤 도착함. 실패·전후 input과 원시 로그를 보존했으며 skip·죽음 보장 완화로 해결하지 않음 |
| 최신 root 전체 strict typecheck | 후속 audit/phase4 전환 뒤 **PASS, 진단0**·모듈 경계0건 PASS. `native-root-final-reference-removal.log`, `native-modules-final-reference-removal.log`. 이전8개는 `native-root-after-expanded.log`와 옛 시험2개 파일의 삭제 import3건이다(`native-modules-after-expanded.log`). 이전17개는 `native-root-after-cli-stream.log`. 이전54개는 `native-root-after-rpc.log`. 이전61개는 `native-root-after-layout.log`, 이전79개 진단은 `native-root-after-connected.log`에 보존했다. 제거된 unit/host relay API와 기존 물리 시험의 전환이 남았다. 선택 native integration의 PASS를 root 전체 PASS로 표시하지 않음 |
| `64cb2cad` 실제 CI `40237516208` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native 실행·SIGKILL·sender·Git·Resident **24/24 PASS**. build26/26·세 OS 동일 input `d568e62424b4c30f0d9729fb94436c0ffedcbaf93ff3bca5b3a08aadfb5caf10`(15591개), 각 전후 동일. Ubuntu bwrap 한정 AppArmor profile을 명시했고 전역 제한1은 그대로다. Darwin gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 artifact는 `ci-64cb2cad/` |
| 위 CI 이전의 Ubuntu 실제 실패 | `e62881f3`·`ffcb1140`에서 init pin 이전 종료를 재현. 추가 launcher 관측에서 실제 exit1·`bwrap: setting up uid map: Permission denied` 확인. unknown journal을 빈 목록으로 치환하지 않았고 실패 archive도 보존. OS의 application별 userns 권한을 설정한 뒤 동일 scope/격리/권한 시험을 실행해 위 결과를 얻음 |
| 후속 FD·로그·runtime 수정의 Linux 실행 | 옵션처럼 생긴 env 값 오분류, log open 뒤 hard link 도입 시 쓰기, diagnostic 실패 후 stop의 stale active 상태를 재현·수정. 실제 OS 및 공통 정책 **57/57**, 별도 strict 부분 컴파일 후 기존 권한·accepted fact·mail/storage/reconcile **37/37 PASS**·skip0. input `6a69b12e11d829ef9fda6268dca2ca2ba3a8f88af58b6d639096bb6df531ba20`(15594개), 두 실행 전후 동일. 원시 `native-log-and-runtime-fixed-*`, `native-policy-after-runtime-fixes.log` 보존. root 전체 strict typecheck는 여전히 FAIL |
| `7707de9d` 실제 CI `40235030613` | Mac26/15·Ubuntu 공통 시험 각각 **54/54 PASS**·build26/26·세 OS 동일 input `df788571bb8a51a39e945d8262c5484a630ade3c22f4f5841432d4a5adf6cbd6`(15590개), 각 전후 동일. Darwin 두 gate job은 BLOCKED·각 15개 실제 관측·Keychain SDK typecheck PASS. Ubuntu 후속 native-leaf는 제거된 sd_notify import로 2 PASS/1 FAIL이며 새 Linux execution step은 미실행. 전체 workflow 성공이 아님. artifact 5개 zip SHA256 확인·원시 로그를 `ci-7707de9d/`에 보존 |
| 직접 경로의 workspace·독립 설치 | workspace 시험 **421/421 PASS**·skip0. 첫 독립 설치 실행은 lifecycle smoke의 동기 assertion 때문에 실패했으며 async assertion 전환 뒤 **26/26 packed install/public declaration/import/해당 runtime smoke PASS**. 외부 SDK 선언 진단과 authored declaration 결과는 원시 로그에서 구분한다. `native-connected-workspace-tests.log`, `native-connected-isolation{,-fixed}.log` 보존. 전체 root 회귀는 별도 미완료 |
| 후속 native 회귀 | 제거된 notify 시험을 보관한 실제 peer/leaf **3/3 PASS**. 공통 ResidentRuntime과 실제 Linux scope/journal의 동시 시작·옛 incarnation 중지 거절·geometric backoff·5/60s start-limit·권한 거절 **3/3 PASS**. `native-legacy-leaf-fixed.log`, `native-resident-first-real.log` 보존. 후속 source의 Ubuntu CI는 재실행 필요 |
| 직접 native 경로와 공통 OS/정책의 확대 실행 | **80/80 PASS**, fail/skip/cancel/todo0. Linux 실제 namespace·sender·Git sandbox와 공통 FD/파일/로그/종료 정책·protocol·Restic dump oracle을 함께 실행. input `84b40cf23b96c72a8f0f5da5d570bf6c9cd4393862adf64a5778d53d75a0d19f`(15590개), 전후 동일. `native-connected-current-linux.log`와 before/after JSON 보존. 전체 local 및 Darwin qualification 아님 |
| 2026-10-26 직접 native 경로의 실제 관련 시험 | **33/33 PASS**, fail/skip/cancel/todo0. Linux 실제 bwrap0.12·kernel namespace/pidfd·SIGKILL 5개 경계·setsid double fork/FD 폐기·SCM_RIGHTS transfer와 64 FD 반환 반복·credential 위조 거절·candidate checkout/exec·quarantine 검증/import·POSIX FD·로그 정책·shutdown fence. 일부 policy 단위 시험도 포함하며 G-*나 전체 Linux/Mac 제품 qualification으로 승격하지 않음. input `f6ee85ab6055581bf7f400bbf47b452652bb7f15feab63cc7a91852e6c9b44db`(15590개), 전후 동일. 원시 `native-connected-fixed-real.log`와 before/after JSON 보존 |
| 위 실제 경로의 발견·수정 | 취소 후 gate release, pre-gate 부모 SIGKILL 후 init 생존, quarantine mount target 누락, private argv NUL 검증 누락을 실제 재현 후 수정. 첫 실패 로그를 삭제하지 않음. witness 없는 opening은 unknown으로 보존하며 이 사례의 기대된 거절을 복구 완료로 세지 않음 |
| 직접 경로 연결 뒤 전체 root 회귀 | strict typecheck 첫 실행 FAIL(제거된 units/cgroup API, async lifecycle 및 create v3 시험 전환 필요). 전체 local 미완료, 새 source의 전체 PASS 없음. workspace production build는 26개 성공. 최종 architecture/owner/독립 설치와 Darwin CI는 별도 재검증 필요 |
| `adf20331`: Linux 실제 Restic round trip·손상·죽음 불명·복구 | 19/19 PASS. 이전 source의 독립 결과이며 이후 모듈 이동에 대한 전체 재검증 아님 |
| VM 제거·Restic 모듈 이동 후 Linux 회귀 | durable fault·Restic round trip 27/27, 공통 파일/metadata/소유권 73/73 PASS. artifact 로그에 각 실행 범위를 보존 |
| `762c1604` 변경을 위한 Linux 실행 | 정식 build·typecheck PASS. config/generation/native/tar 30/30, package/세션 소유권 108/108 PASS. 전체 local은 미실행 |
| `aea22ec0`: 실제 macOS 26/15 common-runtime | 25개 workspace build 성공. 양 OS 9/10 PASS·1 FAIL. 파일 생성 뒤 EACCES: Darwin arm64 openat 가변 인자 ABI 결함을 발견. 실패를 보존하고 수정 |
| `762c1604`: 실제 macOS 26/15 common-runtime | build 성공, directory FFI 초기화가 없는 `readdir$INODE64` symbol을 요구해 실패. 수정 후 실제 OS 재실행 대기. Linux 성공으로 덮지 않음 |
| `13d60492`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. build 25/25. 별도 Darwin gate는 계속 OPEN/BLOCKED |
| `0d471551`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. 실제 SCM_RIGHTS 인계 뒤 peer PID는 connector 생존·종료 모두 holder를 가리켰다. PID 재사용·동시 메시지 인증 증명은 아니며 G-AUTH는 OPEN |
| VM 제거 후 첫 고정 입력 전체 local | FAIL. serial 9개 중 PASS4·SKIP5, parallel 3644개 중 PASS3527·FAIL52·SKIP65. exit1, signal null, 입력 변경0. 전체 통과로 합산하지 않음 |
| 위 실패 수리 후 부분 회귀 | strict typecheck·build·정적 gate PASS. 실제 bwrap 실행 16/16, Restic 복구/fault 12/12, 모듈/소유권 62/62, mjs 회귀 42/42, 구조/결박 8/8 PASS. 당시 부분 범위이며 아래 전체 재실행과 구분 |
| `982658de`: 수리 후 고정 입력 전체 local | **3640/3640 PASS**. serial9·parallel3631, fail/cancel/skip/todo0. exit0·signal null, 실행 전후 입력 변경0 |
| `982658de`: 실제 macOS 26/15·Ubuntu CI | Mac 각각 20/20, Ubuntu 19/19 PASS. 별도 Darwin gate는 BLOCKED. artifact zip SHA-256 확인 후 원본 보존 |
| P2 handle 연결 후 Linux 부분 회귀 | strict typecheck·build·정적 gate PASS. 관련 192개 중 191 PASS·1 FAIL은 옛 renameSync fault가 호출되지 않은 시험이었다. 실제 renameat 게시 후 flush에 fault를 옮긴 저장 회귀 12/12, 모듈/문서/trace 28/28 PASS. 전체 재실행 결과로 합성하지 않음 |
| `8c9ef61d`: P2 관련 고정 입력 회귀 | **192/192 PASS**, fail/cancel/skip/todo0·exit0·signal null·입력 변경0. 원본 `p2-handles-fixed{.log,-before.json,-after.json,-status.json}` |
| `8c9ef61d`: workspace 독립 설치 | **25/25 PASS**. tarball을 선언한 의존 closure만으로 설치하고 공개 entry·자체 declaration·해당 installed-runtime smoke 확인. 외부 SDK declaration 진단44개는 원시 로그에 별도 남음 |
| `8c9ef61d`: 실제 Mac 26/15·Ubuntu CI | Mac 각각 21/21, Ubuntu 20/20 PASS. 세 OS의 input digest가 `ab24d1368aea45d3e95aee4c0417bd6e65c7404dbeed44685213dd59447111f8`(15556개)로 동일. gate job은 계속 BLOCKED |
| P3 wake·CLI handle 연결 후 Linux 회귀 | build·strict typecheck·transaction 검사 PASS. captured T·wake·drain·현재 authority·CLI 입력 관련127/127, 실제 Mail→살아 있는 Broker hint 연결·same-key·rollback 관련30/30 PASS. 서로 다른 부분 실행이며 전체 PASS로 합성하지 않음 |
| `663adda3`: 실제 Mac 26/15·Ubuntu CI와 독립 설치 | Mac 각각28/28·Ubuntu27/27, workspace 독립 설치25/25 PASS. 공통 CI 세 OS의 input digest `f7750bfd598ef32554bc06176af265645a69c2a2735a66393abcf847aaaa3292`(15558개) 동일. 별도 Darwin gate는 BLOCKED |
| `663adda3`: 고정 입력 전체 local | FAIL. serial9 PASS, parallel3646 중 PASS3642·FAIL4. skip/cancel/todo0·exit1·signal null·입력 변경0. `local-p3{.log,-before.json,-after.json,-status.json}` 보존 |
| 위 4개 fault/checkpoint 연결 수리 | 관련35/35 PASS·skip0·입력 변경0. input `046211bd0c8ecb72fb29129d4200559d680d5460495893dde6bb921f0575cc95`(15558개). `p3-fault-repairs{.log,-before.json,-after.json,-status.json}` 보존. 전체 PASS로 합성하지 않음 |
| 26번째 tool-files workspace 분리 후 Linux 검증 | 정식 build·strict typecheck·정적 architecture PASS. 관련189/189, 별도 실제 SIGKILL·복구17/17, 독립 설치26/26 PASS. input `df4f5b65796e6429afcf52ccbb88c61b050132bb406ecd0964b01ae28e199135`(15564개), 세 실행 모두 입력 변경0. 전체 local PASS로 합산하지 않음 |
| 위 변경의 시험·빌드 실행 오류 | 최초 빌드는 도중 package.json 표기 편집을 입력 고정 검사가 거절했다. 최초 부분 시험160/163은 TS 원본 직접 실행으로 세 상대 경로가 어긋났다. 입력을 고정한 정식 빌드와 컴파일된 시험으로 위 결과를 얻었으며 최초 실패 로그도 보존 |
| `f042b159`: 고정 입력 전체 local·실제 CI | 전체3660/3660 PASS(serial9·parallel3651), skip/cancel/todo0·exit0·입력 변경0. 실제 Mac26/15·Ubuntu 공통 CI 각각30/30·build26/26. 세 OS와 local input `57327bddba87ce9a33f9e266e03d856c355d7a050c55d456b966753c6f26be65`(15564개) 동일. 별도 Darwin gate는 OPEN/BLOCKED |
| OS 경계 확대의 Linux 실행 | 새 실제 OS11개·기존 primitive4개·Linux pidfd/Unix credential5개, 합계20/20 PASS. input `a0143e84c5482b632f25e55cd83450d18b6cbe43c56b2b6d41f3fa7835927be2`(15566개), 입력 변경0. `os-boundaries-linux{.log,-before.json,-after.json,-status.json}` 보존. 새 Darwin 독립 사례는 실제 CI로 별도 판정 |
| 실제 macOS 26/15 Keychain | 독립 Swift primitive SDK typecheck PASS. signed Keychain·release 실행·TCC는 미실행 |
| 현재 source의 전체 local·최종 architecture/trace qualification | 미완료. 일부 이전 실행 PASS를 합산하지 않음 |

실제 workflow: [40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898),
[40197183201](https://github.com/minjung2035/oma-v2/actions/runs/40197183201),
[40200893255](https://github.com/minjung2035/oma-v2/actions/runs/40200893255),
[40201140402](https://github.com/minjung2035/oma-v2/actions/runs/40201140402),
[40201962210](https://github.com/minjung2035/oma-v2/actions/runs/40201962210),
[40202613809](https://github.com/minjung2035/oma-v2/actions/runs/40202613809),
[40202936879](https://github.com/minjung2035/oma-v2/actions/runs/40202936879),
[40205394437](https://github.com/minjung2035/oma-v2/actions/runs/40205394437),
[40207646347](https://github.com/minjung2035/oma-v2/actions/runs/40207646347),
[40210726412](https://github.com/minjung2035/oma-v2/actions/runs/40210726412),
[40216022510](https://github.com/minjung2035/oma-v2/actions/runs/40216022510).
모든 실패 artifact를 보존한다. 원시 local 로그는
`/home/dev/oma-audit-artifacts/native-2026-10-25/`에 있다. 새/변경 source는 NOT_REVIEWED이며
고정 architecture·authored review·과거 검토 기록은 변경하지 않는다.

첫 전체 실행의 입력은 `bcb1b03b01d3605ef0155d0d14d201d35eea9747797109ccd42b8932f67359f2`
(15564개)이며 실행 전후 동일하다. 원시 결과는 위 artifact 디렉터리의
`local-frozen.log`, `local-frozen-before.json`, `local-frozen-after.json`,
`local-frozen-status.json`이 소유한다. 실제 bwrap을 private mount로 배치한 부분 시험은
실제 service/cgroup 또는 manager 없는 제품 실행의 증거가 아니다.

수리 후 전체 실행은 2026-10-25 15:06:43.852–15:21:40.916 UTC에 실행했다.
입력 `7c71573c808ff941dd9849690bf895ccb8e8fe0907ad9616a9c73250dc559d4c`(15556개)는
전후 동일하다. 원본은 `local-repaired.log`, `local-repaired-before.json`,
`local-repaired-after.json`, `local-repaired-status.json`이다. 실행 뒤의 파일 handle 변경은
이 전체 PASS의 입력이 아니다. 이 입력에서도 local runner가 별도로 제외한 service/cgroup
suite 9개는 NOT_RUN이며 Darwin 세 gate의 proof로 합산하지 않는다.

`8c9ef61d`의 실제 Mac 26/15에서 connector가 인계 전에 queue한 첫 바이트를 읽기 전·후
모두 LOCAL_PEERPID는 holder를 가리켰다. 두 process는 살아 있었다. 현재 endpoint의 마지막
PID를 각 요청의 발신자로 간주할 수 없다는 반례이며 G-AUTH를 OPEN으로 유지한다.
SHA-256을 확인한 원본 zip·probe·SDK·시험·input artifact는 `ci-8c9ef61d/`에 보존했다.
그 뒤 CLI context의 held descriptor 연결은 위 runtime/설치 결과의 입력에 포함되지 않는다.

남은 구현은 [전환 기록](native-transition.md)을 따른다. 직접 실행 scope·auth·owned 파일
pin/reopen·quarantine/checker·설치와 P7 최종 대조가 남아 있으며 full support 완료가 아니다.

## 이전 입력의 코드 검증: DR48 (2026-10-25)

| 검사 | 실제 결과와 범위 |
|---|---|
| 전체 local suite | **4184/4184 PASS**. serial9 + parallel4175, fail/cancel/skip/todo0, status0/signal null, 951.28초 |
| 실행 입력 | 15681개, `06811f22e03c6e8eca2e088c1780579a2c3f3525124ec1b3f4b48b4ee77a1c13`. 실행 전후 변경0 |
| build·strict typecheck·전체 정적 gate | PASS. architecture·transaction·durable-boundary·document·spec 검사를 포함 |
| 최신 App 독립 설치 | PASS. 실제 Restic/SQLite close→read-only→reopen, 공개 entry·자체 declaration·설치 runtime |
| Domain·Native·Storage 독립 설치 | PASS. 이후 해당 package 소스 변경 없음 |
| 설치 확인 | 설치된 `oma --help`, managed Restic 0.19.1 확인 |
| review | 새/변경 코드 NOT_REVIEWED. 과거 authored review를 갱신하지 않음 |

원시 결과의 소유자:
`/home/dev/oma-audit-artifacts/session-storage-2026-10-25/verification-result.json`.
같은 디렉터리의 `local-full-accepted.log`, `*-before.json`, `*-after.json`, `*-status.json`이 실제 입력과 종료 상태를 보존한다. 실행 뒤 결과·운영 안내·인계를 기록한 차이는 `post-runtime-input-relation.json`에 있다.

DR48은 Git index·local refs·staged/unstaged·untracked/ignored 파일, mode·소유권·nanomtime·symlink·내부 hardlink의 보관/복원과 삭제·게시 후 실패 재시도를 검사했다. 두 세션의 동일한 random 4MiB 파일은 source 합계 8,388,608 bytes에 대해 unique stored data 4,235,172 bytes였다. 이 fixture 결과를 제품 전체 절감률로 사용하지 않는다.

초기 손상 시험에서 Restic tree cache가 repository 손상을 가린 실패를 보존했다. `--no-cache` 수정 후 실제 손상 pack과 원본 보존을 검증했다. SQLite read-only 조회가 만든 빈 WAL 때문에 복원이 막히던 결함도 회귀로 확인했다. 첫 전체 실행은 수정 전에 SIGTERM으로 중단했으며 PASS로 계산하지 않는다. 자세한 실패·수리 과정은 [정리 전 검증 전문](../archive/documentation-cleanup-2026-10-25/validation.md)에 있다.

## 기동 시간의 마지막 측정 (2026-10-25)

같은 설치·프로젝트에서 통제한 전후 각 3회 중앙값이다.

| 측정 지점 | 이전 → 개선 후 | 측정 경계 |
|---|---|---|
| 대화 화면 | 4.50 → 4.27초 | 실제 entry·PTY·SDK·Open TUI, local scripted provider, systemd 조작 차단 |
| 첫 provider 요청 | 4.77 → 4.54초 | 위와 같은 통제 환경. 실제 외부 provider 응답 시간 아님 |
| 저장소 준비 | 12.69 → 9.67초 | 별도의 실제 Git 준비 측정. Workers 최종 준비 시간 아님 |

VM을 포함한 전체 Society 시작 시간은 측정하지 못했다. 서로 다른 측정값을 더해 전체 시간으로 표시하지 않는다. 원시 입력·로그·실패·검증 판정은
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/verification-result.json`에 있다.

## DR48 입력의 실제 환경 검증과 당시 한계

| 항목 | 현재 판정 |
|---|---|
| 현재 코드의 실제 Linux 서비스/cgroup qualification | NOT_RUN. local runner에서 별도 제외한 suite이며 private bwrap overlay로 대체하지 않음 |
| native macOS·Swift helper·VM·Keychain·APFS | NOT_RUN. 이 저장소에 설치 가능한 OMA.app/guest image 배포물 없음 |
| 현재 코드의 실제 provider turn·release qualification | NOT_RUN. scripted/loopback 검사는 외부 서비스 증거가 아님 |
| 실제 power-loss 내구성 | NOT_RUN. SIGKILL·in-process fault 결과와 구분 |
| 실제 manager/cgroup candidate 검사·reviewer shortage 예외 | 기존 독립 거절의 영향이 남음. fixture 성공으로 실행 지원을 주장하지 않음 |
| 선택적 notmuch·reflink·fresh verifier 및 모델 품질/비용 우위 | 활성 구현이나 비교 실험이 확인된 기능으로 표시하지 않음 |

DR48은 ACL/xattr·special file·nested mount·읽을 수 없는 파일·복원할 수 없는 소유권이 있으면 회수를 거부하고 원본을 남긴다. 도구·키·checkpoint·closed DB identity가 확인되지 않는 cold 세션은 시작하지 않는다. Restic의 과거 snapshot을 자동 prune하지 않으므로 고유 데이터의 누적은 남는다. 상세 사용법은 [operations](../operations.md)가 소유한다.

과거 kernel/crash·provider 실행 기록은 해당 당시의 입력에 대한 기록이다. 현재 입력의 미실행 범위를 그 기록으로 닫지 않는다. 측정용 임시 VM은 제거됐고 전체 VM+Society 시간 결과는 없다.

## 문서 정리의 검증 (2026-10-25)

| 검사 | 결과 |
|---|---|
| 전체 정적 gate `npm run check:architecture` | PASS. workspace·legacy·source inventory·architecture rule·transaction·durable boundary·문서·spec 검사 위반0 |
| 문서·trace·inventory·decision·review closure·verification policy 회귀 | **77/77 PASS**. fail/cancel/skip/todo0 |
| 위 두 실행의 입력 | 15674개, `2f870978ea6dbbb62e8b666d0d8bb29b9ce9a496ef4efda8ac66bb6ac3a1e8b6`. 각각 실행 전후 변경0 |
| 보존 확인 | 원문 사본13개·기존 archive·architecture·PRIORITY-0·review-notes bytes 일치. 규범 조항375개 fingerprint 동일 |
| 변경 범위 | 문서만 변경. production code·schema·설정·권한·기계 판독 map 변경 없음. 전체 runtime suite 재실행은 NOT_RUN |

결과를 기록하기 전 입력의 원시 로그와 상태는
`/home/dev/oma-audit-artifacts/documentation-cleanup-2026-10-25/`의 `architecture.log`, `documentation-tests.log`, 각 `*-before.json`/`*-after.json`/`*-status.json`이 소유한다. `preservation.json`은 문서 원문·규범·보호 파일·코드 입력의 보존을 확인한다. 이 결과를 인계·validation에 기록한 뒤의 입력 차이와 재검사는 같은 디렉터리의 `post-check-input-relation.json`, `final-documentation-checks.log`, `verification-result.json`에 구분한다. 정적 검사는 실제 플랫폼 qualification이 아니다.

정리 전 인계·검증·감사·계획 원문은 [보관 색인](../archive/documentation-cleanup-2026-10-25/README.md)에 있다. 문서를 옮겨도 요구 ID·수용 번호·과거 실패·검토 판정은 유지한다.

## Worker 조립 후속 — 2026-10-27

공통 ExecutionStaging·closed developer launch codec·Mac Worker effects 주입과 explicit Broker→
Runner 전달을 구현했다. 실제 Linux App launch factory 회귀2개와 required Darwin Worker
bootstrap/tools fixture를 추가했다. Mac32종×3회, OS별96회는 모두 NOT_RUN이다. 현재 production
preload의 native guard를 우회하지 않으며 이 거절은 성공한 부팅으로 계산하지 않는다.

첫 입력695ec0dd…(15646개)의85/86 실패는 private staging 목적을 durable slot으로 잘못 사용한
반례다. 기존 preparation slot을 사용하는 source 수정 뒤79eae61b…의86/86·root strict가 통과했고
각 입력 전후와 보호4개가 같다. 원시 checks-1/·checks-2/를 보존한다.

후속 fixed-worker 입력 `ffad23c9cfdbcf30abfc478907474089e36b17704017821df112dfcedacc552d`
(15648개)에서 관련189/189·contract mutation7/7, root strict·전체 구조 검사가 통과했다. 전후 입력과
보호4개 SHA가 같으며 skip/cancel/todo/fail0이다. 이 입력은 아래 추가 겹침 수리 전의 결과다.

최종 검토에서 private state 안쪽의 readonly 형제 경로를 installation/package/Node/developer로
선택하는 네 반례를 추가했다. 기존 policy의5/9·실패4를 private-state-overlap-red.log에 보존하고
양방향 겹침 거절로 source를 수리했다. 후속 실행과 최종 구조 결과는 같은 audit 디렉터리에 입력별로
남긴다. raw root는 /home/dev/oma-audit-artifacts/native-2026-10-27-worker-bootstrap/이다.
CI의 workspace-only build 뒤에 root test fixture를 참조하는 불일치도 확인했다. 실제 root dist를
보관해 없는 상태에서 두 consumer의 module-not-found 실패를 보존했고, common CI가 전체
installation/test graph를 빌드하도록 수리했다. root dist가 없는 상태의 실제 build와 workflow에
적힌 그대로의 Node test 명령을 별도로 검증한다. Mac helper job은 workspace build를 유지한다.

이 기록은 전체 Linux suite·현재 packed install·Darwin kernel·power-loss·제품 지원의 PASS가 아니다.


겹침과 CI build prerequisite 수리 뒤 최종 고정 입력 `f370df2f90d8fc5662cc2eb488f0e186a6151b261edfe7357b3989627d47f7d1`
(15648개)에서 관련194/194·contract mutation7/7·root strict·전체 구조 검사 PASS를 확인했다.
같은 입력에서 workflow에 적힌 그대로의 Node 명령은 공통194/194·Linux native leaf3/3·실제
Linux execution46/46 PASS다. 서로 다른 실행을 합산하지 않으며 모두 fail/skip/cancel/todo0이다.
입력 전후와 보호4개 SHA가 같고 fixed-worker-final/summary.json·final-runtime-counts.json이 소유한다.
root dist가 없는 상태의 실제 full build도 exit0이며 겹침 반례는 동일 test SHA로5/9→9/9다.
마지막 문서 결과 기록 이후 입력은 구조 검사로만 별도 결박하며 runtime 결과를 재결박하지 않는다.

## HostConfig 4 형식 전환 — 2026-10-27

[DR60](../design-revisions.md)은 HostConfig 4에서 Linux 전용 rootfs/mount/backend 설정을
제거하는 명시적 형식 경계다. SandboxHost·RunnerConfinement·GitPaths도 같은 공통 설치
계약을 사용하고 Linux adapter가 trusted state root 아래 rootfs와 별도 OS mount를 선택한다.
현재 native interface golden은 SandboxHost 한 항목만 의도적으로 바꿨다. 역사적 golden·
architecture·authored review는 보존하고 accepted plan/receipt·DB·managed journal bytes는
변환하지 않았다. 실제 이전 설정의 loader/editing/project reader 거절 전후 bytes·inode·
mode·size·mtime·ctime와 sidecar/primary 보존을 검사한다.

초기 관련 입력 ce163b42…(15651개)의247/250·기대 불일치3개를 보존했다. version/error/
Dashboard 정책 기대를 수리한 입력
`abbe06b7b1e67b6c52113e4c4109304f0aaf28004f56596d979f5dc042058c5c`에서250/250 PASS,
skip/cancel/todo/fail0·전후 입력 동일이다. 이것은 부분 관련 실행의 결과다.

첫 전체 입력 `44bcdcbca8ecdadc043b99712165184834bf6dd0402e839be5052c7fd840d42b`
(15651개)은 root strict·전체 구조 검사 PASS였지만 local serial13/13·parallel3859/3883,
실패24개로 전체 exit1이었다. 이전 rootfs shorthand가 남은 audit fixture5개, 새 developer-tools
의존성이 빠진 Broker 조립 fixture17개, 의도한 SandboxHost 기준값1개, required AV27 이름1개다.
같은 입력의 독립 tarball 설치는26/26·자체 선언/import와 지정 runtime smoke PASS다.
외부 SDK declaration 진단은 일부 closure에서44개이며 자체 선언 오류와 구분한다.
이 packed 결과를 이후 입력으로 재결박하지 않는다.

수리 중 입력3b000ef2…의관련81/82·실패1도 보존한다. 조립 fixture의 가상 host PID를 없애는
과정에서 전달값 단언을 누락했고 실제 process.pid의 데이터 전달로 수리했다. 이는 credential·
host identity·scope 사망 증명이 아니다. f68dcf76…의Broker 조립18/18 PASS 뒤 전체를 재실행했다.
실행하지 않는 physical port는 throw하고 실제 process.platform을 사용하며 성공 no-op 후보
checker 중복 fixture를 제거했다. required 이름과 강한 원래 단언은 유지했다.

최종 runtime 입력 `f68dcf7688b61455d90f61b3b0f4b4cf96f3f353531c84288206776dd72fd2d1`(15651개)에서
root strict·전체 구조 검사와 전체 LOCAL **3896/3896 PASS**를 확인했다.
serial13/13·parallel3883/3883, fail/cancel/skip/todo0이며 전후 입력과 보호4개 SHA가
같다. 전체 discovery는473개 파일로 유지했다. 실제 Linux UID1000·CapEff0·pinned bwrap0.12.0/
Node26의 /usr/bin overlay profile이며 OS/PID/kernel 사실을 대체하지 않았다.
raw root는 `/home/dev/oma-audit-artifacts/native-2026-10-27-config-format/`다.
`broad-initial/`, `contract-repairs/`, `contract-repairs-final/`, `broad-repaired/`와
`whole-runtime-counts.json`이 각 실패·수리·범위와 정확한 command/종료/입력을 소유한다.

결과 기록 뒤의 문서 입력은 final-documentation/에서 별도 구조 검사로 결박한다.
이 Linux local/packed 결과는 실제 Darwin·service·paid provider·power-loss qualification의
PASS가 아니다. Darwin32종×3회, OS별96회는 NOT_RUN이고 세 native gate와 Mac 제품 guard는
유지한다. 유료 Mac CI 실행과 master 병합·배포는 하지 않았다.

## FD capability의 실제 관측 준비 — 2026-10-27

Darwin baseline에 file-descriptors case를 추가했다. `/dev/fd` open과 public fileport를 독립
cursor 재열기·정확한 exec로 가정하지 않고 inode·flags·원본/복제 cursor·errno·미시도 값을
관측한다. 실제 private image와 교체 image는 서로 다른 표식을 reply pipe로 보내고 자식은
waitpid로 회수한다. linked/rename/unlink 상태의 FD alias 실행과 이름 교체 대조군을 구분한다.
SDK header/API 부재를 성공으로 채우지 않으며 exit0 하나를 원래 image의 실행으로 해석하지 않는다.

소비자 조립 후 runtime 입력 `76483eecaa1990b0562c2cd21b86567b4aaeaa694d0a218eb7b084d0ccb3f05b`(15656개)에서
CI에 적힌 그대로의 공통 Node 명령225/225·검증 정책35/35·전체 구조 검사 PASS다.
각 실행은 fail/cancel/skip/todo0이며 입력·26 workspace의빌드 산출물15400개와 보호4개 SHA가
전후 같다. 실제 Linux UID1000·CapEff0·Node26·pinned bwrap overlay다. C helper의Linux 관측은
Darwin 실행으로 집계하지 않는다. 실제 common log에 inode/flags/offset/exec 표식 원문을 남겼다.
처음3b2d281b…의225/225·35/35 결과도 별도로 보존하며 합산하지 않는다.

실제 disposable C source 변형3개를 컴파일·실행했다. FD alias를 교체된 이름으로 바꾸는 변형과
독립 open을 dup으로 바꾸는 변형은 producer가0으로 끝나도 실제 CI와 같은 oracle consumer가
거절했다. 표식 없이0으로 끝나는 image는 native positive control에서 거절했고 partial record도
consumer가 거절했다. 동일 canonical header SHA의positive 실행과 mutant SHA/원시 exit/stdio를
negative-controls/에 보존한다. OS/PID/scope 사실은 대체하지 않았다.

원시 root는 `/home/dev/oma-audit-artifacts/native-2026-10-27-file-descriptors/`다.
checks-final/summary.json·final-runtime-counts.json과 negative-controls/consumer-results.json이
각 입력·실행·반례의 범위를 소유한다. 결과 기록 뒤 문서 입력은 final-documentation/의별도
구조 검사로 결박한다. authored production은 이 변경에서 바꾸지 않았으며 이전 전체 Linux
3896/3896·packed26/26을 새 검증 입력에 재결박하지 않는다.

required Darwin은33종×3회·OS별99회, 전부 NOT_RUN이다. 기존240분 budget은 유지했고
유료 Mac CI 실행·master 병합·배포는 하지 않았다. G-PROCESS/G-FILES/G-AUTH는 계속 OPEN,
product guard는 그대로다. 이는 Mac implementation/qualification 완료가 아니다.

게시 전 공백 검사에서 새 테스트 EOF의추가 LF 한 개를 제거했다. 본문은 동일하며 거절 원문과
bytes 관계는 candidate-guard-failure.json에 보존한다. 최종 runtime 입력
`ead1b9960c28b0a8ef0bd2eaf8bead7f883763099aa28d6c57dcd71fea3c099e`(15656개)의공통225/225·정책35/35·전체 구조 검사도
PASS, 전후 입력/빌드 산출물/보호4개 동일이다. checks-post-format/과 post-format-runtime-counts.json이
소유하며 최종 문서 구조 입력은 final-documentation-post-format/에서 별도로 검사한다.

## Darwin 실행기의 공개 FD 상속 API 수정 — 2026-10-27

Linux에서 Darwin 대상으로 컴파일하는 동안 production Seatbelt의 `closefrom` 호출이
SDK15.5·26.5의 ARM64·x64 네 조합에서 모두 선언 부재로 실패했다. 기존 Linux 실행 시험은
glibc의 동명 함수를 사용했으므로 이 Darwin 빌드 오류를 발견하지 못했다. 최초20개 object의
16개 성공·4개 실패와 linker sysroot 설정 실패 원문을 별도로 보존했다.

실행 leaf는 공개 `posix_spawn`의 `POSIX_SPAWN_SETEXEC | POSIX_SPAWN_CLOEXEC_DEFAULT`와
`posix_spawn_file_actions_addinherit_np`로 바꿨다. 표준 stream과 명시한 kept FD만 전달하며
실패 시125로 끝낸다. 일반 exec로 되돌아가는 경로는 없다. 같은 PID의 image 교체와 kernel의
FD 상속 처리는 [Apple XNU 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c),
CLOEXEC_DEFAULT·inherit 사용은 [libuv 구현](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/process.c)과 대조했다.
이 source 대조는 실제 Darwin 실행 결과가 아니다.

Zig0.17.0/LLVM22.1.8과 pinned SDK mirror snapshot의15.5·26.5를 사용한 ARM64·x64
교차 컴파일28/28·SDK stub library 링크28/28이 성공했다. production 실행기와 실제 Darwin용
FD 대조 프로그램을 포함한다. compiler/SDK는 저장소 밖 보조 도구이며 제품 의존성에 추가하지
않았다. 이는 Linux host에서 만든 Mach-O의 정적 검증으로, Apple runner의 실제 SDK·kernel
실행·release 서명 또는 Homebrew dylib qualification을 증명하지 않는다.

공통 시험은 production kept-list의 문법만 독립 검사한다. Darwin 시험에는 동일 PID 확인,
soft/hard FD 한도를16으로 낮추기 전에 연 FD64의 제거, CLOEXEC가 설정된 표준 stream·FD6/8
유지, 빈 keep-list, 없는 channel·target의 실패를 추가했다. 기존 실제 leak 대조군은
CLOEXEC_DEFAULT를 제거한 private helper로 갱신했다. 필수 관측 값이 빠진 record를 거절하는
새 회귀는 수정 전28/29·수정 후29/29였고, 별도 parser와 함께30/30이다. record 문법용
입력은 kernel 관측으로 사용하지 않는다. 새 Darwin 실행 대조군 자체는 NOT_RUN이다.

runtime 입력 `6570c49e25e84d04517d9fc7102e65f4d7db7eca6d7c8654702d024e6e2f13a6`(15657개)에서
CI의 공통 명령226/226·검증 정책35/35·전체 구조 검사 PASS다. fail/cancel/skip/todo0이고
입력·26 workspace의 빌드 산출물15400개·보호4개 SHA가 전후 같다. full build와 strict typecheck도
성공했다. 과거 전체 Linux3896/3896·packed26/26을 이 입력의 결과로 다시 표시하지 않는다.

원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-darwin-crosscompile/`의
sdk-objects-initial/·sdk-objects-repaired/·sdk-linked/·metadata-build/·checks/가 소유한다.
문서 기록은 별도 입력의 구조 검사로 결박한다. Mac33종×3회·OS별99회는 NOT_RUN이고
G-PROCESS/G-FILES/G-AUTH와 제품 진입 guard는 그대로다. 유료 Mac CI는 실행하지 않았다.

## Node POSIX 프로세스 그룹 실행 leaf — 2026-10-27

`startProcess`의 processGroup 옵션이 Linux만 허용하던 부분을 Linux·Darwin 지원 표로
연결했다. Node26의 [detached 계약](https://nodejs.org/download/release/v26.0.0/docs/api/child_process.html#optionsdetached)과
[내장 libuv 구현](https://github.com/nodejs/node/blob/v26.0.0/deps/uv/src/unix/process.c)을 대조했다.
Darwin의 POSIX_SPAWN_SETSID 경로를 그대로 사용하며 제품용 native helper를 추가하지 않았다.
기존 실행 수명·결과 분류·FD 전달 owner를 사용한다.

실제 POSIX C 관측 프로그램은 자손을 만들지 않고 자기 PID·group·session과 받은 FD3의
inode를 출력한다. 공통 CI와 kernel/platform lane에 정상 실행, 취소 뒤 실제 child/stdio close,
deadline 뒤 close, 명시 FD의 동일 inode 네 시험과 required name을 넣었다. 일반 실행의 group
상속도 대조한다. 현재 Linux UID1000·CapEff0·Node26·pinned bwrap overlay에서 실제로 실행했고,
Node의 detached 설정만 끈 disposable JS 변형은 같은 첫 시험에서 실패했다. canonical JS와
시험 bytes는 바꾸지 않았다. 변형 실행의 이름 필터로 제외된 시험은 성공으로 세지 않는다.

입력 `f2afe6609fb3297d68499aae8c6cfbbfdc66b47ecbdfb480ca0d00da909a5264`(15659개)에서
CI의 공통 명령230/230·기존 async/stdio 회귀24/24·검증 정책35/35·전체 구조 검사 PASS다.
각 정상 실행은 fail/cancel/skip/todo0이며 입력·26 workspace 산출물15400개·보호4개 SHA는
전후 동일하다. full build와 strict typecheck도 성공했다. 새 C 관측 프로그램의 SDK15.5·26.5,
ARM64·x64 교차 컴파일·stub 링크4/4는 별도의 정적 결과이며 실제 Darwin Node 실행이 아니다.

원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-posix-process-groups/`의
metadata-build/·sdk-fixture/·checks/·negative-control/가 소유한다. 문서 기록 뒤에는 별도 입력의
구조 검사로 결박한다. 과거 전체 Linux3896/3896·packed26/26을 새 입력에 재결박하지 않는다.

프로세스 그룹은 임의 후손 fence나 전체 사망 증명이 아니다. PreparationExecutor의 Linux
제한과 App의 Darwin 실행 차단은 그대로이며, 이 leaf로 그 조건을 우회하지 않는다.
G-PROCESS/G-FILES/G-AUTH는 계속 OPEN이고 Mac99회/OS 및 새 공통 시험의 실제 Darwin 실행은
NOT_RUN이다. 유료 Mac CI는 실행하지 않았다. 저장소 전체 복잡도 점검은 사용자 지시에 따라
native 구현을 모두 마친 뒤 진행하며 이번 변경에 포함하지 않았다.

### Darwin 디렉터리 기준 확장 속성 관측

Darwin의 assertNoExtendedAttributesAt을 구현했다. 보유한 directory FD를 고정된 metadata
helper에 명시 전달하고, helper 안에서만 public fchdir 후 한 entry를 listxattr로 관측한다.
최종 symlink를 따르지 않고 compression 속성도 조회한다. Node host의 cwd는 바뀌지 않으며
대상 파일을 내용 I/O로 열거나 경로를 재구성하지 않는다. private pthread cwd SPI는 쓰지 않는다.
공개 계약은 Apple의 [fchdir](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/chdir.2)와
[listxattr](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/listxattr.2)를 대조했다.

빈 속성 목록만 허용하는 판정은 공통 TypeScript가 소유한다. helper 오류·signal·잘못된 출력은
빈 관측이 아니다. Linux leaf의 기존 ENOTSUP 처리는 유지하고 Darwin 오류를 같은 성공으로
확대하지 않았다. 고정 helper와 기존 Seatbelt 실행기는 같은 reviewed recipe 표에서 소유자·
source asset·출력·library를 선택하며 빌드 cache와 package URL 검사도 같은 표를 사용한다.

실제 host 시험은 zero-length 속성이 있는 파일의 보관, 빈 entry, parent rename과 원래 경로
교체, 속성이 있는 바깥 대상을 가리키는 symlink와 dangling symlink, 조회 실패를 검사한다.
실제 Linux에서 private reader를 symlink를 따라가도록 바꾼 변형은 같은 symlink 시험에서
실패했고 canonical 시험·built JS SHA는 동일했다. 이름 필터의 미선택 시험은 PASS로 세지 않는다.

입력 `44ce3f3a55b6a761bb771d8609df150d8804d9c37af6c81d0417aceb30c82018`(15666개)에서 공통 CI235/235,
정책35/35, 경계·spawn owner17/17, 전체 구조 검사와 packed26/26이 통과했다. 각 패키지의
public import·authored declaration을 확인했고 설치 후 실행 smoke 17개도 통과했다.
외부 SDK declaration 진단은 authored declaration 실패와 별도로 남긴다. 실제 Linux 시험은
UID1000·CapEff0·pinned bwrap overlay에서 실행했으며 입력·26 workspace 산출물
15405개·보호4개 SHA는 전후 동일했다. full build와 strict types도 통과했다.

처음 구조 검사는 신규 TS 파일 두 개의 semantic zone 누락을 거부했다. 그 실패 입력과
runtime 결과는 checks/에 보존하고, codec K1·OS mechanism K2 분류를 추가한 뒤 독립된
checks-final/ 입력으로 재검증했다. 오류 기록을 새 PASS로 덮어쓰지 않았다.

helper의 SDK15.5·26.5 × ARM64·x64 컴파일4/4와 stub 링크4/4는 Linux host의 정적 결과다.
실제 Darwin helper·새 host 시험은 NOT_RUN이며 유료 Mac CI는 실행하지 않았다. 원문은
`/home/dev/oma-audit-artifacts/native-2026-10-27-directory-xattrs/`가 소유한다. 문서 기록 뒤
별도 구조 입력을 결박하며 과거 전체 Linux3896/3896을 이번 입력으로 재결박하지 않는다.

이 구현은 한 entry의 metadata 관측이다. mode-000 pin·동일 inode 재열기·수리·실행 결박이나
G-PROCESS/G-FILES/G-AUTH 완료가 아니며 PreparationExecutor와 App의 Darwin guard는 유지한다.
전체 코드 복잡도 점검은 native 구현을 모두 마친 뒤에 진행한다.

### Darwin ACL·BSD flags와 보관 회수 거절

Spec §9.2의 ACL·BSD flags 관측을 metadata helper에 연결했다. inherited directory FD에서
child만 cwd를 바꾸고 public lstatx_np로 symlink 자체의 stat·security를 읽는다.
filesec_query_property(FILESEC_ACL)는 성공한 no-ACL 관측과 실패를 구분하며, entry가 없는
명시적 ACL과 그 flags도 보관 대상으로 남긴다. ACL entry 순회 실패의 EINVAL을 빈 ACL로
오해하지 않는다. 모든 BSD flag bit를 관측하고 xattr 조회에는 no-follow·show-compression을
유지한다. 대상의 content I/O open이나 경로 복원은 추가하지 않았다.

공개 SDK 선언과 Apple Libc `71bbe350ab79eef58113991d817ccc6165061a64`의
[lstatx_np](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/sys/statx_np.c)·
[filesec](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/gen/filesec.c)를
대조했다. private opaque ACL layout이나 추측한 syscall ABI를 사용하지 않는다.

보존하지 못하는 metadata가 있으면 공통 TS의 assertNoUnpreservedMetadataAt이 회수를 거절한다.
Linux는 기존 no-follow xattr 관측을 유지하고 Darwin-only 사실은 null로 구분한다. session cache
walker가 새 API를 직접 사용하며 이전 xattr-only 함수·helper 경로·decoder는 alias 없이 제거했다.
검증된 cold metadata DTO·hash·receipt·DB 형식은 바꾸지 않았다.

Darwin actual-host 시험 네 개를 공통 CI에 준비했다: BSD flag, extended ACL, flags가 있는 빈
ACL, 실제 resource fork다. 첫 세 경우에는 바깥 metadata 대상을 향한 symlink를 따라가지
않는지도 검사한다. C fixture는 실제 public API로 metadata를 만들고 관측자는 제품 helper다.
이 네 경우는 Darwin에서만 등록되며 이번 Linux 성공 수에 포함되지 않는다. 실제 Mac 실행은
NOT_RUN이다. Linux에서는 동일한 실제 symlink oracle이 private follow 변형을 거부했다.

입력 `41f1ea2c7d3b99e57694e47e72abf95f3996eea9ec6effdfb27d93177fbe9fa0`(15667개)에서 공통 CI235/235,
정책35/35, boundary·spawn owner17/17, session storage15/15, 전체 구조 검사와 packed26/26이
통과했다. hot 원본 보존·archive/restore·snapshot metadata 회귀를 실제 Linux에서 확인했다.
각 시험은 fail/cancel/skip/todo0이며 입력·26 workspace 산출물15405개·
보호4개 SHA는 전후 동일했다. full build·strict types도 통과했다. installed smoke는
17개 통과했고 기존 외부 SDK declaration44 진단은 authored 타입 성공과 구분한다.

제품 helper와 metadata setup C fixture 두 source를 SDK15.5·26.5 × ARM64·x64로 각각
컴파일·stub 링크했다(8/8·8/8). 이는 Linux host의 정적 결과이며 실제 ACL/flag 지원 PASS가
아니다. 원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-metadata-acl-flags/`가 소유한다.
문서 기록은 별도 구조 입력으로 확인하며 이전 단계 runtime PASS를 새 입력에 재결박하지 않는다.

GUARD_CLOSE의 후손 witness 가능성도 대조했으나 XNU의 API는 PRIVATE이고 guard가
close-on-fork를 강제하므로 채택하지 않았다. 해당 primary source는 rejected-guarded/에 남긴다.
G-PROCESS/G-FILES/G-AUTH, mode-000 pin·exact reopen/repair·실행 결박은 계속 미완료다.
App·PreparationExecutor의 Darwin guard를 해제하지 않았고 유료 Mac CI도 실행하지 않았다.
전체 코드 복잡도 검토는 native 구현·CI 준비를 모두 끝낸 뒤에 진행한다.

### Restic 설치 검증과 실행의 FD 결박

Spec §9.1에 따라 설치 스크립트의 checksum 검증 후 경로 재실행을 제거했다.
기존 설치와 신규 publication을 같은 FD 검증 경로에 모으고, 검증한 파일을 child FD3로
명시적으로 넘겨 기존 native execute leaf를 통해 실행한다. version 확인의 성공·실패 뒤
소유 FD를 닫으며 새 publication도 실제로 연 파일의 checksum을 다시 확인한다.
이 결박은 경로 교체·삭제의 실행 대상을 고정하며 파일 내용의 불변성을 주장하지 않는다.

[Node26의 FD 상속 계약](https://github.com/nodejs/node/blob/v26.0.0/doc/api/child_process.md#optionsstdio)과
[Linux의 검증 후 실행 경합 설명](https://man7.org/linux/man-pages/man3/fexecve.3.html)을 대조했다.
새 OS adapter나 경로 fallback을 추가하지 않았다. Darwin exact execute는 계속 미해결이며
이 Linux 결과를 Mac 지원·실행 검증으로 해석하지 않는다.

실제 pinned Restic과 구별되는 C 실행 파일을 사용한 Linux oracle8/8이 통과했다.
기존·신규 설치의 실행 직전 교체, link count0의 실제 unlink, publication 직후 교체의
checksum 거절, 기존 불일치 파일 보존, mode000 복구, 실제 EACCES 뒤 FD 반환,
불일치 archive 거절을 확인했다. 다운로드 fixture는 실제 pinned archive와 byte-for-byte
같은 bzip2 재압축 bytes를 제공하며 kernel·프로세스 결과는 대체하지 않는다.
동일한 최종 oracle은 격리한 수정 전 installer의 경로 실행을 실제로 거절했다(6실패·2통과).
Linux kernel/full lane의 필수 실행 이름과 Linux native CI에 연결했다.

입력 `d5f1bce12e2f39ffd182f3e9dc0afe25ab46897222c0dc6ea7f33251f4169589`(15670개)에서 위8/8,
공통 CI235/235, 정책35/35, boundary·owner17/17, session storage15/15 및 전체 구조 검사가
통과했다. build·strict types도 통과했다. 입력·workspace 산출물15405개·
보호4개 SHA가 전후 같고 inventory·dependency graph·authored review 상태는 바뀌지 않았다.
이 변경은 root installer·test·CI 범위라 workspace packed26 재시험은 하지 않았으며 이전
packed PASS를 새 입력의 결과로 재결박하지 않는다. 문서 기록은 별도 입력으로 구조 확인한다.
원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-restic-setup-exec/`가 소유한다.

유료 Mac CI는 실행하지 않았다. G-PROCESS/G-FILES/G-AUTH와 Darwin 제품 guard는 유지한다.
전체 코드 복잡도 정리는 native 구현·CI 준비를 모두 마친 뒤에 진행하며 아직 착수하지 않았다.

### Restic dump hardlink의 실제 데이터 근거

Spec §9.1의 hardlink 검증에서 source metadata 일치만으로 수락하던 구멍을 수정했다.
자기 자신·아직 나오지 않은 파일·데이터가 없는 순환 link는 검증된 payload를 대신할 수
없다. 현재 header는 종류·metadata·link를 검증한 뒤 seen에 넣고, hardlink는 앞서 수락한
파일만 참조하게 했다. 다음 header에 도달하기 전에 앞 파일의 payload hash가 확인되므로
추가 graph나 상태 없이 정상 link chain의 데이터 근거가 이어진다. 빈 파일도 같은 규칙이다.

고정 [Restic0.19.1 dump writer](https://github.com/restic/restic/blob/6aa3a516ce654808a1f28f9fa21e9b7c8e6e90bf/internal/dump/tar.go)를
대조했다. 이 writer는 file node마다 regular payload를 출력하므로, 실제 dump가 tar hardlink
header를 만든다고 주장하지 않는다. 기존 OMA의 hardlink grammar에는 정상 이전 참조를
유지하면서 데이터가 없는 그래프와 PAX linkpath의 자기 참조를 거절하는 독립 반례를 추가했다.
일곱 parser 사례는 다양한 chunk 경계, 정상·빈 payload chain과 malformed tar bytes를
검사한다. 동일한 최종 oracle은 격리한 수정 전 compiled verifier에서 실제로 실패했다
(2실패·5통과). 이는 parser 반례이며 Darwin kernel 관측을 흉내 낸 시험이 아니다.

입력 `100f081eb9fbe7b1012572725a0370fc4eabf019adf031acbcf633ccc0d8403e`(15670개)에서 parser7/7,
이를 포함한 공통 CI238/238, 정책35/35, boundary·owner17/17, 실제 pinned Restic의
Linux session archive/restore15/15, 전체 구조 검사, packed 설치26/26이 통과했다.
build·strict types도 통과했다. 각 시험의 fail/cancel/skip/todo는0이며 입력·현재 workspace
산출물15405개·보호4개 SHA는 시험 전후 같았다. parser 구현이 바뀌었으므로
이전 workspace output PASS를 새 결과로 재사용하지 않았다. installed runtime smoke는
17개가 통과했고 외부 dependency declaration 진단은 authored 타입 검사와 구분했다.

platform/full lane은 세 새 oracle 이름을 필수로 요구한다. G-PROCESS/G-FILES/G-AUTH는 미해결이며 제품 Darwin guard를 유지한다. 현재 실제 Darwin은
NOT_RUN이며 유료 Mac CI도 실행하지 않았다. 원문은
`/home/dev/oma-audit-artifacts/native-2026-10-27-restic-hardlink-proof/`가 소유한다.
문서 기록은 별도 입력으로 구조 확인하며 위 runtime PASS를 문서 입력에 재결박하지 않는다.
전체 코드 복잡도 정리는 native 구현·CI 준비를 모두 끝낸 뒤에 진행하며 아직 미착수다.

## 검증 입력과 LOC

아래 값은 **구조 검사의 현재 입력 identity**다. digest 생성은 runtime PASS를 만들지 않는다.

verification input digest `1a19aee9c05f958860115700d2fef071073f3ba4dcf77b68052f03780c398473` (15687 files).

현재 source 목록은 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. `npm run check:inventory`는 cloc 없이 source bytes를 확인한다. `npm run evidence:refresh`의 구조 재생성과 실제 runtime 실행은 별도다.

이전 기록의 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 문서 정리로 새 측정치를 만들지 않는다. DR46 마지막 LOC 시도는 같은-source 반복 결과 불일치로 UNRELIABLE이다. 유효한 최종 LOC·감소율은 주장하지 않는다.

현재 LOC 측정의 경로는 `node scripts/loc.mjs --out <evidence-directory>`가 생성·검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`이다. 생성기는 committed source digest를 먼저 확인하며, source/tool/report의 불일치를 손으로 고치지 않는다. 크기 상한은 없다.

## 재검증 명령

명령의 실제 정의는 [package.json](../../package.json), 요구 범위는 [verification-spec](../verification-spec.md)이 소유한다.

```sh
npm run check:documents
npm run check:spec-inventory
npm run check:inventory
npm run check:architecture
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs test/production-inventory.test.mjs
```

코드 변경이 있으면 해당 lane을 추가한다. 실제 환경이 필요한 suite는 지원·허용 환경에서 실행하고, 미실행은 NOT_RUN으로 기록한다.
