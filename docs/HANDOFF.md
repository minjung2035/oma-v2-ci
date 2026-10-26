# OMA v2 — 현재 인계

## 현재: 9116bb6b와 외부 구현 대조 후속

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
[native 명세 §14.8](macos-native-spec.md#148-재개-후-구현--2026-10-27)을 따른다.
새 Mach/audit/process-event leaf와 Mac audit-peer adapter는 source 대조·타입 검사를 진행했고,
production transport 연결과 실제 Mac 실행은 미완료다. 최신 사용자 범위는 구현 우선이며
runtime/CI 테스트를 우선 제외한다. 과거 PASS를 현재 입력에 붙이지 않고 세 gate를 OPEN으로 유지한다.

후속 Broker transport port 정리로 공통 owner에서 Linux native 타입과 socket 생성·sun_path 검사를
제거했다. 실제 Linux adapter를 App이 주입하며 request/authority/reference 수명은 Broker에 남는다.
native audit token은 BSM by-value accessor로 해석한다. listener의 preparation 실패 뒤 실제
close 대기와 불명 close 보존을 수정했고 회귀를 작성했다. 새 회귀 실행과 Mac 실제 transport는
아직 NOT_RUN/미완료다. anonymous bootstrap check-in과 공개 header 계약 차이를 참고 기록에 남겼다.
