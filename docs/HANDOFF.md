# OMA v2 — 현재 인계

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
