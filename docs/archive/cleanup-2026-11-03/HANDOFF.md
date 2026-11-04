# 현재 인계 — collaboration-v1 구현 착수

## 현재 요청 — 협업 표면 구현

사용자가 상세 명세 작성 뒤 `작업시작`을 지시했다. [collaboration-v1](model-collaboration-surface-spec.md)의 I1 읽기·권한 기반부터 착수했으며, 기존 모델 도구·wire·session·accepted history는 아직 cutover하지 않았다. 개별 lifecycle/context 축소와 새 send/spawn publication authority의 제품·계약 gate도 완료로 간주하지 않는다.

실제 입력은 `/home/dev/oma-v2-model-surface-cleanup`, `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12`와 광범위한 기존 dirty WIP다. 아래 과거 HEAD·PASS는 이번 구현의 증거가 아니다. 기존 수정·삭제·untracked 자료를 보존하고, agent 위임·commit·push·merge·배포는 하지 않는다.

현재는 **전체 PARTIAL, 검증 완료 milestone 1/8**이다. 이는 구현률이 아니다. 아홉 action·role records·original invocation·publication·Human controls·명시적 surface 선택의 production 연결을 확장했지만, 운영·마이그레이션·rollback의 전체 실행, 물리/native/provider qualification과 실제 A/B/C는 끝나지 않았다. legacy 기본값과 fresh selected bootstrap의 closed gate를 유지한다. source는 NOT_REVIEWED다.

사용자 정정은 DR71로 기록했다. 기존 Principal MCP 기능을 추가 차단·격리 대상으로 확대하지 않는다. MCP gateway/정책은 보존하고 OMA 자체의 actor/Human authority·role projection 경계는 유지한다. 앞선 미완료 목록의 MCP 추가 차단 요구를 철회하며, MCP 자체의 기존 회귀 실패를 PASS로 바꾸지는 않는다.

Lifecycle creation 관측의 실제 비용 결함을 고쳤다. 원래 Store의 observationStamp/transaction 상태를 결박하여 검증된 diagnostic count만 재사용한다. fresh capacity admission·T-local rows는 계속 원래 full read이며 실패한 stamp/row validation은 cache success로 숨기지 않는다. 원래50/100ms oracle을 유지한 V23A는 read32ms/mixed35ms로 통과했다.

selected create의 원래 native publication→독립 workspace→ready COMMIT→initial brief materialization 경로도 실제 child SIGKILL로 연결했다. 두 Store/runtime-owner 재개가 원래 root/spec/from/brief/bundle과 단일 acceptance를 보존하며 sender retirement는 accepted delegation을 취소하지 않고 stale broker owner는 효과 전에 거절한다. 새 Worker/Pi activation·full Client spawn·kernel/physical qualification의 완료로 올리지 않는다. 관련 현재 실행과 fixture 초기 실패는 validation owner에 기록했다.
실제 SDK journal→Client→Unix RPC→production Host/Lifecycle/Git/Mail의 생성 재개도 acceptance 전/후 두 경로를 통과했다. caller의 HEAD 저장소·brief 파일·일반 cache가 없어도 원래 freeze를 재사용하며, 미접수 호출은 현재 capabilities를 요구하고 accepted 호출은 원래 receipt만 관측한다. Worker/Pi activation은 별도 미완료다.
생성 권한과 용량 경합도 실제 source/effect owner로 검증했다. `agent.create`만으로 새 commit을 게시하지 못하며 기존 canonical commit은 재사용한다. 둘 다 수락된 생성이 마지막 enabled slot을 다투면 하나만 enabled가 되고 다른 원래 intent는 재개 후에도 pending이다. host의 명시적 capacity 변경·재개 없이 다른 Worker를 밀어내거나 새 이름으로 대체하지 않는다.
최근 수정은 원래 owner를 재사용한다. Mail root/Date freeze와 accepted plan 전달, protected receipt fact 비교 및 absent-only caller-cache handoff, Review child 성공 뒤 metadata-only handoff를 보강했다. record family/request 실패를 unavailable로 격리하며 normalized corruption은 원래 admission gate에 도달시킨다. State/receipt/Mail/history/Review materials의 공개 게시 API는 cache hit·empty history를 포함해 T의 파일 I/O 전에 거절한다. Engine cleanup은 Process를 통해 원래 Native 구현을 재사용한다. 실제 child로 재현한 Principal end 중복과 RPC cleanup에 의한 completion 누락도 수정했다. Git 관측 scratch는 parent를 보유한 기존 directory primitives로 생성·반납하며, Principal의 ambient Worker/world/archive/record roots는 전달하지 않는다.

후속 diagnostic records 교정은 unavailable result·enumeration·frame read 내부에서 삼킨 normalized corruption을 원래 Store/gate에 전달한다. independent log bytes와 accepted Mail replay를 보존하며 fresh acceptance만 fence한다. ordinary EIO를 corruption으로 바꾸지 않는다. diagnostic T guard는 identity 조회보다 먼저 실행하며 Principal은 source enumeration 전에 거절한다.

R10 receipt의 before-send closure 표기는 `refused`로 바로잡되 원래 binding의 `rejected` phase·failure·no receipt/no operation은 바꾸지 않았다. receipt/log 파일의 여섯 publication-parent flush 뒤 actual child SIGKILL과 두 번씩의 same-key fresh-process 재개도 통과했다. accepted/protected facts와 원래 log frames·bytes를 보존하며 ACK/presentation을 만들지 않는다. publication child의 죽음/재개이지 전체 broker·physical power-loss·SDK/kernel qualification은 아니다.

후속 원래 freeze 관계 검사에서 binding 날짜 불일치를 놓치던 두 replay/handoff 경로와, 경쟁 publication을 읽은 뒤 durability barrier를 생략하던 metadata-copy 경로를 재현·수정했다. key/method/date/hash 관계와 기존 replay flush owner를 공용으로 사용하며 historical hash·accepted receipt 의미는 바꾸지 않는다. 세 metadata publication 경계의 실제 child SIGKILL/same-key fresh-process restart도 통과했다. cache-only 증거와, 후속 격리 Linux에서 통과한 실제 canonical-child/native-parent continuation 증거는 별도다.

직전 build/root typecheck와 production-source checkpoint의 한 격리 Linux guarded serial **334/334 PASS, fail/skip/cancel0**이며 원래 Client/native/publication 회귀와 lifecycle count/T/rollback/external-edit/corruption/failure 관측 및 과거 whole-local 실패 파일을 포함한다. 현재27 workspace tarball 설치·authored declaration/installed runtime 검사도 PASS하되 일부 Pi 접점의 external declaration diagnostics44는 여전히 남는다. authored source review나 native macOS/provider qualification을 뜻하지 않는다. 전체 repository suite는 아래 실패/중단 이력을 그대로 유지한다.

`/tmp/oma-native-host.njsfv3/run.sh`의 UID1000/capabilities 제거·private bwrap overlay를 재사용한다. 이전 whole-local537 files/1200초 시도는 FAIL+TIMEOUT이고 전체 summary가 없다. 관측된10 실패 중 V23A는 실제 비용 결함을 수정했다. 나머지7건은 stale tool wording·누락된 locator/registry inventory·invalid surface fixture·살아 있는 scope의 busy/unknown 구분·in-process fanout 예외를 process kill로 오해한 oracle을 교정했다. Personal PTY와 MCP credential command 두 건은 local-test-guard가 실제 shell을 거절하므로 여전히 실패이며 guard를 완화하거나 skip하지 않았다. 선택334로 whole-local PASS를 합성하지 않는다. 원시 입력/로그/한계는 [validation](implementation/validation.md#collaboration-v1--원래-owner-교정과-현재-미완료), 요구 연결은 [trace](implementation/collaboration-v1-trace.md)가 소유한다.

재개점은 남은 action/운영의 원래 acceptance/effect/recovery 경로와 미실행 whole-local 경로를 구체적으로 검증하는 것이다. 기존 MCP에 새 제한을 추가하지 않으며 두 shell fixture의 안전한 실행 환경 문제와 product 권한을 혼동하지 않는다. 실제 native/provider·A/B/C와 명시적 제품/계약 gate는 별도로 닫고 milestone1/8·NOT_REVIEWED·closed bootstrap을 유지한다. command 실패/중단만으로 전체를 종료하지 않고 partial effects를 확인해 이어간다. 활성화·commit·push·merge·배포하지 않았다.

## 이전 요청 — 모듈 감사 결함 수정

사용자가 macOS와 vendor 내부를 제외한 감사 결함의 모듈별 병렬 수정과 회귀 보강을
승인했다. 14개 수정 담당과 parent 통합으로 19개 workspace의 코드를 다뤘다.
23개 결함의 수정과 AUD-25의 끊어진 고정 slot 경로 제거를 반영했다.
AUD-13은 일반 Principal 권한을 넓히는 대신 DR67의 Host-only 계약에 맞춰 제외했다.
원래 제외된 AUD-04/26/27/28도 제품 결함 수정으로 집계하지 않는다.

[DR70](design-revisions.md#dr70--모듈-감사의-경쟁경계-결함을-기존-권한-안에서-수정한다)과
[모듈 감사의 후속 수정](module-audit-2026-10-31.md#후속-수정--2026-11-01)을 따른다.
실행 결과·입력·환경 한계는 [validation](implementation/validation.md)이 소유한다.
기존 WIP와 과거 authored review는 보존하며 commit·push·merge·배포하지 않았다.
실제 provider 모델 검증이나 macOS qualification으로 확대하지 않는다.

## 이전 모델 도구 표면 cutover와 유지되는 제약

사용자가 승인한 [모델 도구 표면 명세](model-tool-surface-spec.md)의 구현을
`/home/dev/oma-v2-model-surface-cleanup`에서 진행했다. 기준 HEAD는
`74eadb6fd34c258393a231930fcdf0c85e601af6`이며 merge/deploy는 하지 않았다.

모델용 CLI·구 도구/group을 제거하고 typed Client·role별 core/optional·exact `toolset`·
reviewer/생성 관측·hashline 편집·prompt/START·설치 caller를 함께 전환했다.
Human용 CLI와 broker authority·accepted history는 유지한다. 결정은 DR64,
실행별 결과와 남은 한계는 [validation](implementation/validation.md)이 소유한다.

후속 DR65에서는 Codex CLI의 모델별 prompt/tool spec을 대조해 기본 모델 문구를 영어로
재작성했다. Principal의 고가 판단과 Worker의 자율 실행을 구분하고, 시작/담당 범위 공유·
대기 중 독립 작업·증거 전달·검증/통합 완결을 유연한 기본 습관으로 명시했다.
LOW의 사전 승인 없는 fast path와 적용 후 자동 통지·challenge는 유지한다.
builtin/hashline/LSP/web/MCP 설명도 OMA wrapper에서 바꾸며 vendor 바이트·입력 계약은 보존한다.
이하의 이전 benchmark-essential/Worker-cap 작업 범위를 현재 모듈 감사의 수정 범위로 혼동하지 않는다. 현재 요청과 판정은 위 절 및 감사 보고서를 따른다.

DR66 now uses active Worker capacity: default `maxWorkers=6`, initial Workers 3.
Only enabled residents occupy active slots; historical stopped/retired identities
do not permanently consume capacity. Creation publication and reactivation use
atomic admission, and accepted provisioning waits for a released slot after a race.
Unconfirmed execution termination remains fenced. Capacity changes require restart;
stop enough Workers before lowering the cap below the enabled population.
Review fallback subtracts only active authors while excluding every historical
author from voting. Temporary reviewer shortage and rejection do not lower quorum.
Current execution evidence and limitations are recorded in [validation](implementation/validation.md).

실제 Sol medium A/B/C 비교는 NOT_RUN이다. OMA engine auth가 비어 있고 확인한
배포 profile은 `pi/current`다. 정확한 provider/model/medium 설정과 사용할 인증 없이
다른 모델이나 scripted provider로 대체 통과시키지 않는다.

아래는 이전 native 작업의 인계이며 이번 tool surface 변경의 검증 결과가 아니다.

## 이전 native 작업의 사용자 지시

최신 지시는 **개정 spec을 따라 작업을 시작하는 것**이다. 앞선 spec 작성 후 중단 지시는 재개 요청으로 대체됐다. tool-files의 directory-relative 연산 전환부터 실제 검증하며, work branch만 사용하고 merge/deploy하지 않는다. 에이전트 위임은 사용하지 않는다.

[개정 명세](macos-native-spec.md)는 제품 보장·확정 결정·복수 후보·결정 절차·검증 순서를 간결하게 구분한다. DR61/NATIVE-024·025는 파일 capability와 좁은 native leaf 사용을 명시하지만 Darwin 실행 backend를 채택하거나 보안/복구 계약을 낮추지 않는다. 개정 전 전문은 [spec](archive/macos-native-spec-2026-10-28-pre-redesign.md)과 [인계](archive/native-handoff-2026-10-28-pre-redesign.md)에 원문으로 보존했다.

## 작업 입력과 보존

| 항목 | 마지막 확인 사실 |
|---|---|
| 주 작업트리 | `/home/dev/oma-v2`, `work/macos-native-20261025`, 이번 checkpoint parent `d8248ad6` |
| 공개 CI mirror | `/home/dev/oma-v2-ci`, 같은 branch; 마지막 원시 회수 입력 `4d140a51d5` |
| 현재 변경 | 두 Mac common253/253·skip0. CID-only 재탐색이 첫 snapshot 뒤 태어난 후손까지 찾아 제어·release 전 CID 소멸 각3회 확인. 다음 production Seatbelt target·service kickstart 시도의 Mac 실행은 NOT_RUN. Linux parser/policy52/52·skip0. 이전 exploratory 첫 Git 거절은 원인 미확정으로 유지. README·WATCHDOG.yml은 사용자 변경으로 제외·보존한다 |
| 금지 | merge/deploy, reset/clean으로 WIP 정리, 고정 architecture·과거 authored review 재승인 |
| 환경 | Linux, 실제 Mac은 GitHub CI. LSP 미설정. gh 인증은 없지만 공개 API metadata 조회와 SSH push는 가능. Node26은 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin` |
| CI 주의 | 현재 native workflow는 push로 Mac job이 실행될 수 있음. 재개 시 workflow 조건부터 확인 |

이 표는 작업 중 확인한 입력이지 재개 시점의 HEAD를 보증하지 않는다. 상세 변경 목록·이전 Keychain 작업은 보관 인계와 실제 worktree를 대조한다.

## 이번 구현에서 확인한 것

- `broker-composition.ts`: 이미 `{pid,startTime}`인 scopeRoot를 tagged witness로 다시 읽던 회귀를 제거. 실제 private-fd `runner.open`의 AUTH_FAILED가 성공으로 바뀌었고 400-socket flood 시험 1/1 PASS.
- `native/descriptor-path.ts`, `tool-files/descriptor-files.ts`: Linux `/proc/fd`를 `/proc/self/fd`로 수리. 실제 rename/replacement 뒤 held bytes 읽기와 tool write/read smoke PASS.
- Mac metadata fixture의 temp root를 canonicalize하고, workflow 문구를 고정하던 incidental test를 제거. 관련 Linux 선택 시험 60/60 PASS; 해당 Mac 수정의 재실행은 NOT_RUN.
- 위 입력에서 build PASS. 일반 사용자 permission 증거와 root-mapped namespace smoke는 구분한다. throwaway smoke 파일은 제거했다.

실행 기록은 [native-transition](implementation/native-transition.md), 전체 상태는 [validation](implementation/validation.md)가 소유한다. 이 선택 결과는 현재 source 전체 회귀나 Darwin qualification이 아니다.

## 재사용할 원시 근거

[공개 run 40548845744 artifact](https://nightly.link/minjung2035/oma-v2-ci/actions/runs/40548845744) 접근은 성공했다. 같은 run의 auth-only API/log URL을 반복 시도하지 않는다.

- 추출 위치: `/home/dev/oma-audit-artifacts/native-2026-10-28-recovered-ci/macos15-gates/`, `macos15-runtime/`.
- Mac15 gate: SETUP_FAILED, 세 gate OPEN. process-group 탈출 후손 생존, mode-000 event pin EACCES, `/dev/fd` shared cursor, descriptor exec errno13을 관측했다.
- Mac15 runtime: 218/247 PASS·29 FAIL. 주요 원인은 strict root에서 `/var` alias fixture, `/dev/fd/<directory>/<name>` 사용, stale workflow assertion. fixture/assertion만 수리했고 Darwin tool directory 연산은 아직 미구현이다.
- Seatbelt kept-FD 실제 오류는 `Seatbelt target exec: Bad file descriptor`; 다른 helper/worker/setup 실패도 별도다. generic timeout으로 합치지 않는다.
- 파일 후보 배제 근거: `/home/dev/oma-audit-artifacts/native-2026-10-27-file-binding-feasibility/audit.json`. 새 CI 관측은 그 당시 NOT_RUN 표기보다 최신이다.

직접 회수한 최신 Native run은 `40654073529`, 최신 Architecture는 `40654073512`(둘 다4d140a51d5)이다.
후자는 full serial3952/3952·skip0·baseline 모든 exit0·5개 lane PASS다. 이전2af 입력의 exploratory 첫 Git 거절 원인은 미확정이며 이후 PASS로 해결 처리하지 않았다. Mac 세 product gate는 OPEN이다.
file/Git/Worker의 남은 실패와 source별 수치는 [진행 기록](implementation/native-transition.md)이 소유한다.
원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-descriptor-leaf/`에 보존했다.
immutable artifact ZIP의 SHA256은 공개 API digest와 일치했다.
validation binding은 clean committed bytes를 가리키므로 dirty README 입력과 구분한다.

## 재개 요청을 받으면

1. 위 입력과 현재 변경을 대조한다. docs-only 개정과 기존 구현 WIP를 섞어 새 PASS로 기록하지 않는다.
2. [명세 §3–6](macos-native-spec.md)의 후보/판정 절차를 따른다. Darwin full-scope와 exact executable binding, expected-Broker producer는 미해결이다. launchd/coalition/audit-session을 확정 해법으로 읽지 않는다.
3. 독립 descriptor의 실제 Mac file/snapshot/cursor/hashline·tool-files 설치와 C target의 FD pruning·same-PID handoff는 확인했다. SDK libproc는 private·변경 가능하므로 지원 OS별 실제 회귀를 유지한다.
4. DR63 storage cutover는 미커밋 dist가 없는 checkout에서 실제 재빌드·status 회귀로 확인했다. metadata getattrlist도 실제 Mac에서 통과했다. Git packed smoke의 UNSUPPORTED_PROFILE은 실제 shared Linux-only preparation guard이며 기대값을 낮추지 않는다.
5. main-image·Personal·file/publication 및 fresh kernel token의 제어는 두 Mac 실제 확인했다. CID-only loop가 첫 snapshot 뒤 생긴 후손도 재탐색·제어해 ID 소멸을 관측했지만 unprofiled controlled 범위다. 새 production Seatbelt target·service kickstart 시도는 NOT_RUN이고 실제 owner crash·다른 service admission·durable producer·script/library generation·현재 Broker 권한이 남는다. Git REF_STATE_UNKNOWN과 세 product gate는 미해결이다.
   `packages/native/src/audit-session.ts`의 scan→empty·32-byte coalition buffer(XNU40), PID count를 bytes로 읽는 loop·pidversion offset36(XNU/실제 C32)·saved witness→fresh identity·SDK errno 오해는 production proof가 아니다. `platform-mac/execution-launch`도 아직 throw-only다. 새 primitive 조립 때 이 경로/호출자를 cutover하며 shim으로 보존하지 않는다.
6. 실제 primitive 반례를 먼저 닫고 execution journal/auth/caller를 연결한다. 이후 전체 제품·Linux 회귀·packed install·Mac CI·복잡도 검토가 남는다. stop/receipt/archive 보장은 그대로다.

상세 파일별 위치와 이전 조사 전문은 보관 인계에 있다. 이미 실패한 전제를 반복 조사하지 말고 달라진 입력 또는 새로운 반례 질문을 명시한다.
