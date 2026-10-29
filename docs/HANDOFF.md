# 인수인계 — 구현 재개, 현재 판단과 재개점

## 1. 최신 사용자 지시와 제품 목표

**최신 지시는 Linux 검증·문서 마감 후 지정 work branch를 push하고 macOS 작업을 이어가는 것이다.** Linux의 전체 회귀·독립 설치·실제 추론/도구·재개/보관/복구 근거를 확보했다. 원인 미상 단일 CI 실패는 비차단 추적으로 정정한다. 기존 기능·보안·복구 보장과 사용자 변경을 보존하며, 에이전트 위임·merge·deploy 없이 진행한다.

**Linux 재인수·발행·clean 전체 CI까지 통과했다.** Mac의 exact Unix·root alias·Node DNS 수리와 실제 helper의 허용/거절 회귀는 확인했다. 하지만 권한 제거 뒤 native C resolver는 service/thread 분리에서도 실패하므로 정상 도구 호환성·complete backend는 미충족이다. 다음은 Node 자신의 post-exec task/global bootstrap과 cached 권한 복원 반례다. 구현·local59/59는 마쳤고 새 Mac 실행은 NOT_RUN이다. 세 gate·실행 차단·Linux backend·credential/receipt/recovery 계약은 유지한다. [판정 owner](implementation/validation.md#mac-exact-unix-socket-번역--실제-kernel-검증-전)를 따른다.

목표는 VM 없이 macOS·Linux에서 같은 제품을 실행하는 것이다. TypeScript 업무 owner를 공유하고 OS adapter는 좁은 native primitive만 맡는다. Society·Personal·Principal/Worker·manual CLI·Pi/tools·Git/checks/review·mail·설정/package/history·Restic backup/restore가 모두 범위다. **제품은 아직 미완료다.**

- accepted plan·request key·receipt·durable bytes·현재 권한·복구 의미를 유지한다. unknown을 dead/absent/success로 바꾸지 않는다.
- VM/VZ/vsock/guest/systemd/journald fallback, 별도 native 업무 runtime, root daemon·restricted entitlement를 기본 해법으로 추가하지 않는다.
- 기존 Linux namespace/pidfd 경로를 보존한다. Mac15 관측과 첫 목표인 Mac26 arm64 지원을 구분한다.
- 에이전트 위임 없이 진행한다. work branch만 사용하며 merge/deploy하지 않는다.
- 사용자 `README.md` 변경과 untracked `WATCHDOG.yml`은 보존하고 stage하지 않는다. reset/clean·무차별 stage 금지.
- spec은 핵심 판단·근거·후보·다음 행동을 간결하게 적는다. 검색 가능한 정보를 사용자에게 되묻거나 미확정 후보를 확정 해법으로 적지 않는다.
- Linux 마감 뒤 주 저장소 `257baab324d0cac93fb49fcf1c69ba0231b24db9`와 같은 tree의 CI mirror `2ef7fb517b24e4a48c3ac48646f87f6a81316638`를 지정 work branch에 push했다. primary는 `[skip ci]`, 기존 mirror에서 실제 Mac job을 실행했다. merge/deploy는 하지 않았다.

기준: [개정 spec](macos-native-spec.md), [규범](macos-platform.md), [진행 기록](implementation/native-transition.md), [검증 기록](implementation/validation.md). 개정 전 전문은 [이전 spec](archive/macos-native-spec-2026-10-28-pre-redesign.md)·[이전 인계](archive/native-handoff-2026-10-28-pre-redesign.md)에 있다.

## 2. 재개 기준 source와 현재 작업

| 항목 | 확인한 상태 |
|---|---|
| 주 저장소 | `/home/dev/oma-v2`, branch `work/macos-native-20261025` |
| 재개 기준 주 HEAD | `74eadb6fd34c258393a231930fcdf0c85e601af6` — `Bind sandbox recovery evidence to clean committed inputs` |
| CI mirror | `/home/dev/oma-v2-ci`, 같은 branch, `origin`은 `git@github.com:minjung2035/oma-v2-ci.git` |
| 재개 기준 mirror HEAD / origin ref | `836e2f596314857e2f03a5d91154a40413ecf71a` — `Bind sandboxed recovery probe to clean committed inputs` |
| 인수 시 마지막 committed 코드 변경 | 주 저장소 `2dd8bf5d`: production Seatbelt target + service 호출 관측. 이후 binding commit은 코드 구현이 아님 |
| 이번 작업 | verifier 임시 트리 수명 수리·fresh service target·Linux 인수검증 마감. 관련 native 문서의 기존 변경까지 포함한 commit/push를 사용자에게 명시 승인받음 |
| Linux 발행 source | 주 `257baab324d0cac93fb49fcf1c69ba0231b24db9` / mirror `2ef7fb517b24e4a48c3ac48646f87f6a81316638`, tree `32f8cf22e4af7b0728edd52e6cbd6c05b9f11d1c` 동일 |
| 첫 bootstrap 실험 source | 주 `3581b838463cd55d1294a362014bcfba2e2ce918` / mirror `41392d6624cc5d6301ea97bf0b2127a053956ea0`, tree `ae563d0f9501943c4281e6660c05bd9c64206f1b` 동일. Native40721951956에서 새 helper compile6건 실패, 권한 분리는 미실행 |
| SEND right 교체 뒤 실제 source | 주 `3ca06ef0485e5114a3d3f62e55aabd26dca1c9d3` / mirror `a4c398f89a2168f4b5da218a3dc5c3073f4e21ac`, tree `006be93f2bc1c40c2baf98ebe6697b5a0d0817e0` 동일. Native40726395555의 양 Mac 새3건씩 OBSERVED |
| selected baseline·재취득 실제 source | 주 `f73c315acbc15b48a79b9fc7d3c3a5da0a12b8aa` / mirror `4baca756363b053a18704c828c7e5d013dae5230`, tree `29d2cc1f2698c424ae4d24627191c5e30e3df50c` 동일. Native40735745482의 양 Mac 새3건씩 OBSERVED |
| 마지막 로컬 실행 | Linux 수정 입력 `02fd1a08…` /15687 files: baseline14/14+3940/3940·concurrency4, serial all3954/3954·skip/cancel/todo0·errors[]·baseline COMPARED. 같은 입력 독립 패키지27/27·실제 설치본 Luna medium·보관/복구·같은 receipt 통과. 최초 환경 실패도 보존 |
| 환경 | Linux x64. Mac 실행은 실제 GitHub runner. LSP 미설정 |
| Node26 | `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin` |
| 로컬 제한 | clang/swiftc 없음. macOS SDK snapshot만으로 실제 Mac 실행·qualification 불가 |
| GitHub CLI | 마지막 `gh api …/actions/runs/40659493379`는 인증 부재로 exit4, `GH_TOKEN` 안내. CI 실패가 아니라 조회 인증 실패 |

위 HEAD는 재개 기준이다. 사용자 `README.md`·untracked `WATCHDOG.yml`은 보존하고 commit에서 제외한다. 시작 전부터 변경된 native 문서3개는 기존 내용을 유지한 채 이번 기록과 함께 commit하도록 사용자가 승인했다. 검증의 dirty 입력과 이후 clean commit/CI 입력을 혼합하지 않는다.

직전 clean mirror의 canonical binding은 `1768c39d7c91837d3836041610eba235a06f263657d2994d4b99d87ff1ec4ce9` /15686 files였다. 이번 Linux 첫 full 입력 `650294ba…`는 verifier 수리 전이며, 수리 후 serial all 입력은 `c62c180dea0bd613c9ce625567be0005745422c037fd862d5d1864e785a6abe9` /15686 files다. 후자는 build·typecheck·전체 architecture·3952/3952·skip0·errors[]와 모든 입력 전후 동일을 확인했다. 사용자 README가 포함된 dirty 입력이며 clean mirror·결과 기록 뒤 docs-only binding과 혼합하지 않는다.

사용자는 `Codex error event: This content was flagged for possible cybersecurity risk…`가 반복된다고 보고했다. 이 관측은 사실이나 정확한 trigger·판정 내부는 확인하지 못했다. 개인 리포라는 이유만으로 자동 필터가 면제되는 것은 아니다. 같은 요청 반복·문구 위장으로 우회하지 않으며, 차단된 검증을 완료로 기록하지 않는다. 이것은 위 `gh` 인증 오류와 별개다.

## 3. 지금까지 수행한 작업

아래는 수행 범위이며 제품 전체 완료 선언이 아니다. 세부 source별 결과는 진행 기록에 남아 있다.

| 영역 | 한 일과 확인한 경계 |
|---|---|
| spec 재작성 | DR61: 제품 보장과 구현 후보 분리. DR62: tool-files의 좁은 descriptor leaf. DR63: storage async snapshot cutover. 기존 architecture·과거 authored review를 재승인하거나 의미 변경하지 않음 |
| 파일 도구·descriptor | `/dev/fd/<directory>/<name>` 흉내 대신 directory-relative native leaf로 전환. `@oma/file-descriptors` private adapter·의존성/DAG/독립 설치 연결. 실제 Mac file/snapshot/cursor/hashline, held root·FD pruning/handoff 관측 |
| 파일 metadata·publication | 실제 getattrlist/ACL 관측과 mode-000 취득 한계를 분리. no-replace는 소유한 leased temporary의 같은 inode 게시 또는 검증한 held bytes의 private copy로 처리. 기존 destination 덮어쓰기·path chmod 우회 없음 |
| 공통 runtime·Linux 회귀 | broker scopeRoot 이중 해석으로 생긴 AUTH_FAILED 수리. `/proc/fd`를 `/proc/self/fd`로 수리. 620-pending status event-loop stall 수리, 원래 latency 예산 유지. async module-port/status·storage snapshot caller/선언/clean build 정리 |
| CI·설치·검사 | pre-install binding의 compiler 의존 제거, build-stamp closure 수리, stale workflow/source-wording oracle 제거. 독립 packed install·asset/runtime binding 확인. 구조 검사와 runtime proof를 분리 |
| Darwin startup·Personal | 실제 Node/Seatbelt FD·startup 실패 조사·수리. Keychain helper의 framed read deadlock을 POSIX read로 수리. Society guard를 우회하지 않고 독립 Personal 실제 PTY 진입·Ctrl-D·exit0·terminal 복원 확인 |
| Darwin primitive 조사 | launchd job/CID 상속·bootout 반례, suspended main-image 검증, genuine kernel token 제어, CID-only late-fork recovery를 양 Mac에서 작은 실제 실행으로 검증. 아래 남은 조건 때문에 production backend 채택은 아직 안 함 |
| Linux 첫 Git 거절 | 원시 실패 위치를 특정하고 assertion에 실제 reply를 남기도록 개선. 로컬 실제 socket smoke도 수행했지만 원래 CI 거절은 재현·원인 설명·수리하지 못함 |

최근 주 저장소의 코드 checkpoint는 `51a6a70d`(coalition admission), `1710f130`(fresh token), `2479809d`(late-fork + Git 진단), `2dd8bf5d`(production Seatbelt target)다. 각 사이의 binding commit을 새 기능으로 계산하지 않는다.

### 마지막으로 실제 확인한 검증

| 입력·범위 | 관측 결과 | 확대 해석 금지 |
|---|---|---|
| Mac15·26 `2ef7fb517b`, Native `40711228810` | common 각253/253·skip0, 독립 packed 설치 각26/27·Git preparation `UNSUPPORTED_PROFILE`1 FAIL. gate 각117 /105 OBSERVED /12 SETUP_FAILED | 세 product gate OPEN. 새 source의 실제 실패를 skip·성공으로 바꾸지 않음 |
| 같은 source의 fresh service 최초 요청 | 양 Mac 각3회 모두 production Seatbelt 안의 launchctl exit0·cleanup 불필요, PID1이 다른 CID에서 unsandboxed controlled actor 실행 | **현 policy+coalition만으로 닫힌 범위라는 후보의 실제 반례.** GUI UID501·SIP-disabled 관측이며 SIP-enabled/headless 지원 증명은 아님 |
| 최종 Linux 입력 `88d1cf0b…` /15686 files | 정상 PATH serial all3952/3952·fail/cancel/skip/todo0·errors[]·baseline COMPARED. build/typecheck/architecture 모두 exit0, per-file/canonical 입력 전후 동일 | 첫 PATH 누락 all3948/3952·cloc4 FAIL도 보존. 제품 조건을 바꾼 재시험이 아님 |
| 후속 독립 설치본 live·재개·복구 | 두 checkout을 가리고 Principal·Worker·Personal 실제 GPT-6 Luna/medium, 코드 수정·도구·수신·history 재개·실제 broker archive/restore·같은 receipt 확인 | operation14 succeeded·batch8 completed·submit1·integrate0·active journal0. 외부 재인증/power loss의 모든 조건을 증명하지 않음 |
| verifier 수리 뒤 Linux `c62c180d…` | serial all3952/3952·fail/cancel/skip/todo0·errors[], build·typecheck·전체 architecture 모든 command exit0.15686개 per-file/canonical 입력 전후 동일 | 이 all의 추론은 scripted. 후속 실제 Codex 실행은 별도 근거이며 원래 첫 Git 거절 원인은 미확정 |
| 후속 실제 Codex Linux CLI | Principal·Worker 모두 `openai-codex/gpt-6-luna`·`medium`. GOAL→파일·검증·commit·submit→Principal 수신, operation9 succeeded·batch5 completed·종료0·journal active0 | checkout의 제한된 실제 시나리오. 도구 오류 각3건 후 완료, 설치본 live 추론·전체 제품 완료로 확대하지 않음 |
| 이번 Linux 첫 고정 입력 `650294ba…` | full3952/3952·skip0, serial14·parallel3938/concurrency4, 입력 전후 동일. build27/27·architecture findings0 | verifier 수리 전 입력. 원래 첫 Git 거절의 원인 설명은 아님 |
| 이번 독립 설치 verifier | 최초23/27·ENOSPC4 실패를 보존. 완료 임시 workspace를 즉시 반납하도록 수리 후27/27 PASS | 사용자 파일/cache 삭제·test 기대값 완화 없음. 실제 Mac proof 아님 |
| runtime-only 설치본 실사용 | packed27개 payload만으로 설치. Society/Personal 실제 PTY·Ctrl-D·exit0·terminal 복원, 실제 local package install/list/remove 성공 | 실제 provider credential/추론은 미실행 |
| 설치본 Restic | 각 cycle의 source/restored digest·closed DB·dirty Git·hardlink·원본 보존·credential 손실 거절 확인 | offline fixture이며 live producer 종료는 scope 회귀와 구분 |
| 현재 local fixture/parser 입력 | 새 target 귀속 회귀는 수정 전1 FAIL, 같은 test bytes로 수정 후 parser·Seatbelt40/40·skip0. 변경 MJS3개 syntax exit0 | 실제 Mac compile/실행이나 현재 source 전체 회귀가 아님 |
| 현재 parser 직접 smoke | 기존 양 Mac 각3건을 새 fresh-target 근거로 거절. 합성 거절·spawn 실패·deadline 불명·다른 CID effect grammar 수용. 실제 fixture의 Linux 실행은 state 생성 전 exit1 거절 | 합성 입력은 kernel 관측이 아니며 기존 Mac 결과는 해당 source의 역사 근거로 보존 |
| Linux `4d140a51d5`, Architecture `40654073512` | full serial3952/3952·skip0·errors[]; exploratory baseline 모든 command exit0; fast880·durable872·property34·stress16·platform72 모두 PASS | 이전 간헐 Git 거절의 수리가 아님. Linux 제품 전체 최종 인수도 아님 |
| 직전 로컬/clean mirror | parser/policy52/52·skip0, architecture PASS. 마지막 TS 변경 뒤 build27/27 PASS | 이번 docs 입력에 재결박한 결과가 아님 |
| Mac15 `836e2f5963`, Native `40659493379` | 다운로드한 runtime에서 common253/253·skip0 확인 | 해당 입력 Mac26 runtime은 아직 회수·판독하지 않음 |
| Mac15·26 `836e2f5963` gate artifacts | 각117 executed /105 OBSERVED /12 SETUP_FAILED, productQualification BLOCKED | OBSERVED는 제품 PASS가 아님. G-PROCESS/G-FILES/G-AUTH 모두 OPEN |
| 두 Mac의 production Seatbelt target | 각3회 fresh controller 제어 성공. snapshot 뒤 태어난 후손까지 다음 scan에서 제어, fixture release 전 CID ESRCH와 다른 live CID 성공 query 확인 | GUI UID501·SIP-disabled controlled fixture. 실제 제품 owner crash·durable producer·모든 service admission 증명이 아님 |
| 같은 실행의 service 호출 | 각3회 spawnStatus0, 5초 뒤 fixture cleanup, waitStatus9·joined=true·numericCleanupUsed=true. marker 없음, CLI 명시적 거절 결과 없음 | **서비스 차단 성공이라고 쓰면 안 됨** |

Linux full의 before/after 입력은15686 files, `7461a8886f3ad044027eb7eb96de5ff785e4eefaf1fb929bcad4b04d8f5d2eb4`로 같았다. canonical binding과 다른 종류/입력의 digest를 혼합하지 않는다.

이전 “전체 약35%·해당 세션 약+10%p”는 주관적 추정이었다. 검증된 완료율이나 새 견적이 아니다. todo22/26도 제품 진척률이 아니다. 남은 전제 때문에 전체24시간 완료를 보장하지 않았다.

## 4. 가장 가까운 재개점: service 관측의 혼입 제거

**새 Linux 우선 재개점:** Architecture [40743666926](https://github.com/minjung2035/oma-v2-ci/actions/runs/40743666926)의 `test.log`는 사전14/14 뒤 main3938/3939·fail1이다. 실패는 `V10A: an unanswered command ends at the acceptance budget, and says so`의 delivery 전 rootfs 준비에서 `openBeneath→statAt→ensureFile` EAGAIN이다. 같은 source의 별도 serial all3953/3953과5 lane은 통과했다. 최신 `e9a939d619`의 병렬 baseline14/14+3939/3939·serial all3953/3953·나머지 lane도 통과했지만 이를 원인 수리 증거로 쓰지 않는다.

[openat2(2)](https://man7.org/linux/man-pages/man2/openat2.2.html)는 BENEATH containment를 확인하지 못한 race에서 EAGAIN 재시도를 허용한다. 실제 CI의 rename 주체/경합은 미관측이다. 현재 native leaf는 같은 fd/path/`RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS`로 최대8회만 재시도하고 지속 EAGAIN·hard denial은 원래 오류로 거절한다. open/openat fallback·flags 완화·deadline 변경은 없다. 실제 kernel FD와 링크 거절을 사용하는 fault 회귀와 새 compiled/독립 설치·실사용·전체 검증을 마쳤다. 실행 전제 실수와 정정 뒤 전체 통과는 [검증 owner](implementation/validation.md#linux-eagain-수리-뒤-실제-재인수)에 구분했다. 원래 CI 경합의 자연 재현이나 과거 Git 실패의 수리로 확대하지 않는다.

**Linux 완료·push 뒤 실제 Mac 관측까지 진행했다.** Native [40711228810](https://github.com/minjung2035/oma-v2-ci/actions/runs/40711228810), source `2ef7fb517b24e4a48c3ac48646f87f6a81316638`의 SHA256 확인한 Mac15·26 artifact를 판독했다. 다음 질문은 재시작 대기가 아니라 **상속된 launchd 제어 권한을 정상 도구·DNS·manual CLI와 양립하게 분리할 수 있는가**다.

### 확인한 사실

재개 전 `test/fixtures/darwin-launchd.mjs`는 **동일한 service-target job**을 host에서 먼저 실행·종료 확인한 뒤 marker를 지우고 sandboxed 호출 대상으로 재사용했다. 현재는 동일 actor와 `once` mode의 `service-positive`와 `service-target`을 별도 job으로 만든다. `RunAtLoad=false`, `KeepAlive=false`, `AbandonProcessGroup=false`는 유지한다.

`836e2f5963`의 두 Mac 각3회에서 sandboxed CLI는 5초 내 종료하지 않아 fixture가 자신의 unreaped direct child만 정리했다. Mac15의 `launchctl print`에는 `state = spawn scheduled`, `minimum runtime = 10`, `runs = 1`이 기록됐다. `print`는 진단 텍스트이며 production API나 admission/death proof가 아니다.

**현재 확정:** 새 target의 최초 요청은 양 Mac 각3회 모두 spawnStatus0·waitStatus0·joined=true·numericCleanupUsed=false였다. target actor는 PID1 아래 별도 resource CID에서 `sandboxed=false`로 실행됐다. marker 부재나 print 추정이 아니라 실제 성공 응답과 실행된 controlled program의 kernel 관측이다. 이전 동일 job 재사용/재시작 대기 원인설은 여전히 `[INFERENCE]`이며 이 결과로 당시 timeout 원인을 확정하지 않는다.

### 재개 후 적용한 최소 변경과 다음 검증

1. **적용:** host는 `service-positive`만 실행·종료 확인한다. 그 뒤 동일 actor/program 설정의 `service-target`을 새로 등록하고 sandboxed actor의 최초 요청 대상으로만 사용한다. 양성 marker는 지우지 않는다.
2. **유지:** 기존 5초 한도와 production policy를 바꾸지 않았다. 새 입력의 질문은 “재시작 대기와 무관한 첫 service 실행이 실제 허용되는가”다.
3. **적용:** 두 target·host kickstart·positive 종료 뒤 print·target 전후 print·실제 spawn/wait·cleanup·target별 job 출력·guest effect를 남긴다. validator는 서로 다른 동일 domain target, host 양성 명령의 귀속, 실제 attempt의 target을 대조한다. print 텍스트는 proof로 파싱하지 않는다.
4. **실제 Mac 확인:** Mac26 CID1393→1397·1435→1439·1497→1509, Mac15 CID1217→1221·1249→1251·1267→1271. 동일 actor·production policy·5초 한도를 유지한 fresh-target6건 모두 범위 밖 실행이었다.
5. **판정 / 다음 행동:** 현재 policy+coalition만으로 complete backend를 채택하지 않는다. 실행 차단을 유지한다. launchd control과 service lookup의 권한 경로를 OS 원본·SDK와 대조하고, bootstrap/XPC 권한 제거가 실제 제어와 정상 Node/Git/compiler/DNS에 미치는 한 질문만 최소 실행으로 확인한다. CLI 이름 차단·timeout 확대·marker 부재로 해결하지 않는다.
6. **실제 권한 제거 관측 완료 / backend 미채택:** 첫 `41392d6624`의 unsafe/deprecated `mach_port_destroy` compile 실패를 보존했고, 경고 억제 없이 typed SEND 참조 반납으로 교체했다. Native [40726395555](https://github.com/minjung2035/oma-v2-ci/actions/runs/40726395555), `a4c398f89a`의 양 Mac 각3회에서 helper compile·권한 제거·Node 후손 실행을 실제 관측했다. inherited는 직접/Node service 총12회 성공했고, bootstrap만/모두 제거한24회는 CLI141(`Reentrancy avoided`)·effect 미관측이었다. Node·clang·자기 파일 쓰기·금지 canary는 모든18 variant에서 기대대로였으나 이것을 전체 service 차단으로 확대하지 않는다.

첫 fresh-service 관측 입력은 clean `232a303bba403d9e6d6ca122e428a2924d0fa4640f3b8a975178fd0524076716` /15686 files이며 양 Mac 전후 동일하다. common 각253/253이지만 독립 설치는 각26/27이고 Git preparation은 실제 `UNSUPPORTED_PROFILE`로 실패했다. gate 각105 OBSERVED·12 SETUP_FAILED와 G-PROCESS/G-FILES/G-AUTH OPEN을 그대로 유지한다.

이번 local 원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-service-fresh-target/`다. `red.log`·`green.log`와 각 status, `checked-source.json`, `regression-input.json`, `direct-smoke.log`가 명령·exit·변경 source SHA와 grammar/kernel 경계를 소유한다.
새 원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-macos-resume/`다. Native ZIP5개와 Architecture ZIP2개의 SHA256을 대조했다. `fresh-service-admission-observed.json`·`native-runtime-observed-summaries.json`과 OS별 원시 launchd row를 보존한다. Architecture [40711228820](https://github.com/minjung2035/oma-v2-ci/actions/runs/40711228820)의 같은 clean 입력에서 all3952/3952·skip0·errors[], fast880·durable872·property34·stress16·platform72와 모든 command exit0을 확인했다. baseline comparison은 NOT_AVAILABLE이며 비교 완료로 쓰지 않는다.
조사에서 deprecated `bootstrap_unprivileged`는 native launchd job이 이미 그 port로 시작한다고 명시했고, Chromium V2는 macOS10.10 이후 오래된 bootstrap proxy의 투명 중계가 성립하지 않았다고 설명한다. API 이름만으로 해법을 채택하지 않는다. 새 probe3회가 늘어 CI worst-case 계산은288분이며 job 상한만300분으로 맞췄다. 기존 probe120초·fixture80초·service5초 한도와 제품 timeout은 유지한다.
첫 bootstrap 실험의 원시는 `bootstrap-rights/`다. clean 입력 `e6ca64260acf796d80c6cfa756567b60f9754011357ed97fa034b263178fdf72` /15687 files 전후 동일, common Mac 각254/254·Ubuntu246/246·skip0, Mac 독립 설치26/27이다. gate 각120 /105 OBSERVED /15 SETUP_FAILED 중 추가3건은 위 compile 실패다. 이 실패를 후보의 권한 분리 성공/실패나 기존 Linux 제품 결함으로 해석하지 않는다.
SEND right 교체 뒤 원시는 `bootstrap-rights/send-rights-fix/`다. clean 입력 `92b706badeddfd746705389ea330524770745ae544f2c049456066fc3aef88ba` /15687 files 전후 동일, gate 각108 OBSERVED·12 SETUP_FAILED다. Git은 **상속 양성에서도** `/usr/bin/git` shim의 `/var/select/developer_dir` EPERM, DNS도 모든 variant에서 ENOTFOUND였다. 포트 제거 때문에 Git/DNS가 깨졌다고 단정할 수 없다. 다음은 기존 selected developer-tools owner로 실제 Git 양성을 만들고 같은 hostname의 host DNS 대조·정확한 DNS endpoint를 확인하는 일이다. 남겨진 registered send right에서 bootstrap을 다시 취득하는 adversary도 아직 NOT_RUN이다.

후속 Architecture [40726395696](https://github.com/minjung2035/oma-v2-ci/actions/runs/40726395696), source `a4c398f89a`의 ZIP2개도 SHA256 대조·판독했다. 같은 clean `92b706…`에서 all3953/3953·skip0·errors[], 전체13 command exit0과 입력 전후 동일을 확인했다. baselineComparison은 NOT_AVAILABLE이다. 같은 source의 Mac common 각254/254·Ubuntu246/246·skip0도 확인했다. Mac 독립 설치의 `@oma/git` preparation `UNSUPPORTED_PROFILE`은 그대로 남아 있다. 원시는 `bootstrap-rights/send-rights-fix/clean-source-linux-regression/`·`actual-native-runtime-summary.json`이다.

**다음 입력 구현·local 검증 완료 / 실제 Mac 미실행:** 기존 `observeMacDeveloperTools`의 selected Git으로 host 양성·sandboxed 명령을 일치시켰다. 같은 hostname의 host DNS 양성과 관측한 `/var/run/mDNSResponder` 및 그 실제 socket의 physical alias만 fixture 입력으로 선언한다. registered seed를 다시 조회하고 task bootstrap을 복구한 뒤 별도 fresh target의 launchctl로 exec하는 adversary를 추가했다. production Seatbelt renderer·actor·실행 guard·Linux backend는 바꾸지 않았다. local parser/policy41/41·실제 생성 Node script의 Git/cc 실행·Linux fixture의 state 전 거절을 확인했다. 이 변경 source의 Mac compile·권한 재취득·DNS 양립은 아직 NOT_RUN이며 과거 결과를 승격하지 않는다.

위 NOT_RUN은 발행 전 checkpoint다. 후속 Native [40735745482](https://github.com/minjung2035/oma-v2-ci/actions/runs/40735745482), `4baca756363b053a18704c828c7e5d013dae5230`의 ZIP5개를 SHA256 대조했다. clean `2dcd9200abb3a2b8deb91975541ffe0c9a325a0ce56af3d0a3923bfdc143c136` /15687 files와 runtime artifacts는 양 Mac 전후 동일하다. 새 case각3건은 OBSERVED·전체108 OBSERVED/12 SETUP_FAILED다.

**확정:** host selected Git과 같은 hostname DNS는 모두 양성이다. 그러나 sandboxed Git은 inherited부터 모든18 variant에서 `/etc/gitconfig` EPERM·exit128이며, DNS도 exact socket 입력 뒤 여전히 ENOTFOUND다. Git probe가 production의 `GIT_ENV`를 쓰지 않은 차이가 확인됐다. 기존 환경 owner를 재사용하고 DNS는 raw Unix connect·DNSService·getaddrinfo의 native 결과를 분리해 확인한다. 광범위한 파일/Mach 권한으로 덮지 않는다.

**재취득의 실제 한계:** bootstrap-only는 양 Mac 총6회 registered seed 조회와 setter0, task bootstrap0→nonzero를 확인했다. 하지만 이후 launchctl은 여전히141이고 service effect는 없었다. 이는 task handle 복구 관측이지 실행 탈출 확인이 아니다. 모든 seed 제거 조건은 seed0·setter 미호출·helper125였다. inherited의 직접/Node/restored 총18회 service effect만 실제 성공했다. 세 product gate OPEN·실행 차단·backend 미채택을 유지한다. 원시는 `bootstrap-rights/send-rights-fix/selected-baseline-and-restoration/actual-baseline-restoration-{outcomes,summary}.json`·OS별 row와 ZIP이다. 같은 source의 Architecture40735745551 artifact는 아직 미판독이다.

이후 Architecture [40735745551](https://github.com/minjung2035/oma-v2-ci/actions/runs/40735745551)의 SHA256 대조한 ZIP2개를 판독했다. 같은 clean `2dcd9200…`의 all3953/3953·skip0·errors[]·13 command code0·전후 동일이다. 다른5 lane도 PASS·skip0·errors[]·각 command code0이며 baselineComparison은 모두 NOT_AVAILABLE다. Native common은 Mac각254/254·Ubuntu246/246·skip0다. Mac packed26/27 중 authored installed-runtime PASS는16개이고 `@oma/git` preparation 실패1개는 유지한다. declaration 통과를 runtime 검증으로 합산하지 않는다.

**다음 입력 적용·local41/41 / Mac 미실행:** host/Node Git 모두 기존 `GIT_ENV`와 소유 HOME/TMPDIR로 실행하도록 probe를 맞췄다. C helper에는 exact Unix connect·`DNSServiceCreateConnection`·libc getaddrinfo의 개별 결과를 남기는 진단만 추가했다. Node DNS는 그대로 실행하며 resolver 대체나 정책 확대는 없다. 실제 Linux 생성 producer의 Git/cc와 진단 helper 부재의 ENOENT 기록을 확인했다. 새 C compile·Mac Git 정상화·DNS 거절 분류는 아직 NOT_RUN이다.

`ae6d72826557e65ad485229f24d1527ca6b8e0e3` / mirror `a399fb7fe5807f2a7a953db28326380de857bee6`의 Native [40743666948](https://github.com/minjung2035/oma-v2-ci/actions/runs/40743666948)는 실제로 Mac26 helper link3회가 `ld: library 'dns_sd' not found`로 실패했다. 내 probe의 잘못된 독립 library flag이며 Git 환경 효과·native DNS API는 미실행이다. Apple Libsystem `requiredlibs`의 `system_dnssd` 소유를 대조하고 불필요한 `-ldns_sd`만 제거했다. 경고·성공 조건은 유지하며 교체 뒤 실제 link/실행은 아직 NOT_RUN이다.

이 source의 SHA256 대조 artifact는3개뿐이다. Mac26 common254/254·Ubuntu246/246·skip0이며 gate105 OBSERVED/15 SETUP_FAILED다. Mac15 두 job은 cancelled·runner_name 비어 있음·artifact 없음으로 실행 근거가 없다. 취소 원인은 확인하지 못했고 Mac15 PASS로 합성하지 않는다. 원시는 위 root의 `git-env-native-dns/observed-link-failure-summary.json`·`native-job-observed-summary.json`과 ZIP이다.

이후 `5f1f176183aba017ca2e47d3e70029c145204f26` / mirror `e9a939d6197765db65083ec5537e5689fe1427ce`, Native [40748217460](https://github.com/minjung2035/oma-v2-ci/actions/runs/40748217460)의 ZIP5개 SHA256을 대조했다. 양 Mac SDK15.5/26.5에서 helper compile/link·새 case각3회가 실제 OBSERVED이며 각108 OBSERVED·12 SETUP_FAILED다. 모든18 variant의 selected Git hash·clang·자기 쓰기·금지 canary는 기대대로다. DNS는 host 양성에도 sandboxed AF_UNIX socket 생성은 성공·connect가 EPERM1이며 DNSService=-65563·getaddrinfo=8/errno1·Node ENOTFOUND다. 제거 전 inherited도 같으므로 bootstrap 제거 탓으로 쓰지 않는다. exact Unix network filter 번역의 원인설은 아직 추정·수정 미실행이며 새 Linux 오류를 먼저 처리한다. 원시는 `git-env-native-dns/libsystem-link-fix/actual-git-native-dns-{outcomes,summary}.json`이다.


### 현재 관련 파일

| 파일 | 책임·주의 |
|---|---|
| `test/fixtures/darwin-launchd.mjs` | public launchctl 실험, production `seatbeltProfile` 호출, GUI domain, 별도 positive/fresh target·전후 raw·target별 job 출력·cleanup |
| `test/fixtures/darwin-launchd-actor.c` | controlled C actor·실제 sandbox_init·후손 생성·CID hint·fresh identity control. production 업무 owner가 아님 |
| `scripts/darwin-cases.mjs` | 120 attempts와 관측 parser. service 결과는 성공/거절을 강제하지 않음 |
| `test/darwin-evidence.test.mjs` | synthetic evidence grammar 검증. kernel 실행 증거가 아님 |
| `packages/platform-mac/src/seatbelt.ts` | 실제 deny-default renderer. broad system executable 목록과 좁은 Mach allowlist가 존재. fixture용 permissive profile로 대체 금지 |

fixture marker는 관측·cleanup 조율 전용이다. marker PID·UUID·저장된 token은 신호 권한이나 현재 role이 아니다. 숫자 PID cleanup은 fresh unreaped direct child의 fixture 정리에만 사용됐으며 scope recovery fallback이 아니다.

## 5. 아직 해결되지 않은 제품 작업과 설계 판단

### 실행 범위와 recovery

launchd resource coalition의 상속·fresh generation 제어·CID 소멸 관측은 개별 primitive 근거다. **현재 production Seatbelt와 조합한 닫힌 범위 후보는 service 실행 반례가 나왔으며 complete backend로 채택할 수 없다.** ordinary process group은 setsid/double-fork 반례가 있고, bootout 단독도 detached 후손을 남긴다.

- primitive에서 확인한 것: job별 CID 분리·상속, explicit coalition 이동의 EPERM, fresh kernel identity로 실제 제어, 첫 snapshot 이후 생긴 후손의 재탐색, release 전 ID 소멸.
- 새 미해결: 기존 service를 통한 CID 밖·unsandboxed 실행의 권한 분리. 이후에도 실제 runner/broker/host owner crash, opening만 남은 crash와 witness 이후 crash, boot identity·ID 재사용·PID/exec generation 경계, durable producer·reacquisition을 별도로 증명해야 한다.
- `started==exited`, empty/truncated scan, direct-child exit, deadline은 complete death가 아니다. old CID ESRCH도 같은 boot·지원 query와 다른 live CID 대조가 있어야 해석한다.
- 정상 Node/Git/compiler와 sandboxed target 제어가 함께 성립해야 한다. 새 SBPL을 reaper에 재적용하는 방식은 실제 EPERM 반례가 있어 채택하지 않는다.

### Headless·executable·authority

- 현행 fixture는 `gui/UID`다. plain `user/UID` bootstrap은 이전 두 runner에서 EIO5였다. 같은 실패를 입력 변경 없이 반복하지 않는다.
- [launchctl manual](https://leancrew.com/all-this/man/man1/launchctl.html)상 login/ASID는 GUI login domain이고 gui/UID는 alias다. 이를 SSH/headless 대안이라고 쓰지 않는다. user domain provisioning 조건·별도 API 후보는 아직 미확정이다. GUI-only 제품으로 조용히 축소하지 않는다.
- suspended main-image 검증은 두 Mac에서 정상 A/B·Node/Git/compiler/interpreter와 mapped B→pathname A 치환 거절을 확인했다. script/module/library generation, descriptor/cwd 전달, current authority와 exec gate 연결은 남았다.
- `SpawnConstraint.cdhash` 단독은 현재 SIP-disabled runner에서 B를 실행한 반례가 있어 exact-image 해법으로 배제했다. SIP-enabled 지원으로 확대하지 않는다.
- genuine kernel token·valid signature·CID 소속은 현재 role/expected Broker의 producer가 아니다. parent private channel/Mach transport는 재사용하되 실제 sender·살아 있는 generation·현재 run·기대한 Broker·현재 grant를 따로 결박해야 한다.

### 기존 코드에서 그대로 연결하면 안 되는 경로

| 파일 | 확인한 위험 / 다음 조치 |
|---|---|
| `packages/native/src/audit-session.ts` | coalition buffer32(실제40), proc_listallpids count를 bytes로 해석, scan→empty, 저장 witness→fresh 권한 오인, own pidversion offset36(실제32), SDK errno 반환 오해. 기존 token 조립은 genuine kernel token 경로가 아님 |
| `packages/platform-mac/src/execution-launch.ts` | `launchBlockedDarwin`은 throw-only. 실제 launch-data channel이 구현된 것으로 읽지 않음 |
| `apps/oma/src/runtime/execution-runtime.ts` | 위 observe/terminate와 연결된 caller. 새 producer 확정 뒤 전체 caller를 clean cutover. Linux backend 보존 |
| `packages/platform-mac/src/launchd-job.ts` | 오래된 private liblaunch wrapper. 실제 public launchctl fixture와 별개이며 ownership/free·ABI·argv/stdio·gate 감사가 미완료. 그대로 조립하지 않음 |

이 경로들은 guard를 성공으로 바꾸거나 필드 몇 개만 고쳐 완성할 수 없다. 채택 시 obsolete caller/export/comment를 함께 제거하고 shim·별도 병렬 구현을 남기지 않는다. LSP가 없는 상태에서 audit-session caller는 이미 grep 조사했다. launchd-job의 전체 references 조사는 아직 안 했다.

### 원인 미상 단일 CI 통합시험 실패 — 비차단 추적

- 원본: Architecture [40647938235](https://github.com/minjung2035/oma-v2-ci/actions/runs/40647938235), source `2af0de04a041dbc915da87b45c4ba87354104d39`, npm test 파일 병렬도4. `audit2` compiled788/current source829의 첫 `gitSame[0]?.ok`가 false였다.
- 한 socket의 같은 request key/bundle 두 요청 중 첫 OMA `git.submit` 응답이 실패였다는 것만 확정이다. GitHub push 거절이나 Git 명령 결함이라고 분류할 자료는 없다.
- 오류 code/body는 assertion에 없었고 driver out.json은 fixture finally가 지웠다. 시험 전체4.874초는 요청별 시간·timeout 증거가 아니다. client120초·stream idle1초와 CPU/framing 가설을 구분한다.
- 사용자 정정: 동일 commit의 별도 전체 suite3952/3952·skip0도 통과했다. 이후4d baseline·로컬 smoke·이번 fresh/동시/CPU 경합9회와 전체 실행도 통과했다. 이것으로 원인을 설명하거나 수리했다고 판정하지 않는다.
- 직접 대조한 submit/quarantine/connection/execution owner4개는 당시와 bytes가 같았다. `2479809d`의 두 assertion 응답 JSON 진단만 추가됐으며 production Git·timeout·성공 조건은 바꾸지 않았다.
- **확정 Git 결함도 Linux 완료의 필수 blocker도 아니다.** 실패 이력·진단을 유지하고 추가 전용 재현 반복은 중단한다. 무해한 flake·수리 완료로 단정하지 않는다.
- 재발 또는 실사용 제출 실패·중복 효과·ref/receipt 불일치가 생기면 실제 응답을 확보하고 우선순위를 즉시 올린다. 원시와 정정은 `/home/dev/oma-audit-artifacts/native-2026-10-28-linux-resume/`가 소유한다.

### Linux 인수검증 마감과 Mac 재개 조건

기능별 경로·P0 경계·미실행 범위는 [검증 기록](implementation/validation.md#linux-인수검증-마감--독립-설치실제-추론재개cold-복구-2026-10-28)을 따른다.
고정 입력 `88d1cf0b…` serial all3952/3952·skip0·errors[]와 build/typecheck/architecture·입력 전후 동일을 확인했다.
독립 설치본에서 실제 Codex GPT-6 Luna/medium의 Principal·Worker·Personal, history 재개, broker native drain 뒤 자동 Restic 보관·credential 손실 거절·원래 key의 cold 복원과 receipt 재조회를 확인했다.
이 실행을 보편적 P0 완전 증명으로 확대하지 않는다. 단일 CI 실패는 위 비차단 이력이다. 사용자 지시대로 문서 정합성·commit/push 후 §4의 실제 Mac 관측을 재개하며, Mac 제품 gate는 계속 OPEN이다.


### 이후 제품 연결 순서

1. 위 primitive 반례·지원 조건을 닫거나, spec §3의 복수 후보/사용자 결정 절차로 전환한다.
2. `opening → 실제 child/scope → witness persist → 현재 권한 재검사 → gate release`, stop/recovery/drain/journal retire를 공통 owner에 연결한다.
3. Darwin Git preparation·candidate/quarantine·Worker/manual CLI를 실제 capability로 전환한다. 현재 `UNSUPPORTED_PROFILE`/`REF_STATE_UNKNOWN`을 성공으로 위장하지 않는다.
4. Restic의 실제 backup/verify/restore·quiescence·원본 보존, Keychain 잠김/TCC/실제 credential 경로, 독립 설치를 검증한다. scripted credential/unknown-op 시험을 실제 OAuth 증거로 쓰지 않는다.
5. Society/Personal/Pi/tools와 모든 named scenario를 두 OS에서 연결하고 전체 Linux 회귀·실제 Mac·복잡도/owner/durable 계약을 최종 대조한다.

실행별 쓰기 영역/broker-mediated spawn, 다른 OS primitive, macOS27 ES descendant client는 대안 후보로 남아 있다. 앞의 둘은 기존 writer/receipt/recovery 계약 대조가 필요하고, ES는 OS 하한·Apple entitlement라는 사용자 결정이 필요하다. 미확정 해법 위에 새 journal/schema/framework부터 만들지 않는다.

## 6. 다음 모델이 재사용할 원시 근거

공통 root: `/home/dev/oma-audit-artifacts/native-2026-10-28-descriptor-leaf/`. 이미 받은 파일을 다시 다운로드하지 않는다. ZIP의 SHA256은 회수 당시 공개 API digest와 대조했다.

| 디렉터리 | artifact ID | ZIP SHA256 |
|---|---|---|
| `sandboxed-macos15-gates/` | 12803028541 | `06ee4040ee8943ba4fbb7ce79b714e7ebaf23a8d2ee043c00e33d53117ba01df` |
| `sandboxed-macos26-gates/` | 12802733850 | `2a65887e9e4b79082e37a1524d6a481ef3dde24fe9f0ad7b929e8570789b6af9` |
| `sandboxed-macos15-runtime/` | 12803492680 | `8c3ea4c97731193ba7b865e600827b07f5f8f21faac43bfdb34ca89223de556c` |
| `native-all-4d140a51d5/` | 12802073774 | `475eb0d411bca5a9d856d711625e253a65c6504e5ab86ff2b7b55f66fcb8ce14` |
| `architecture-4d140a51d5/` | 12802795908 | `70f3137cd80f4bd39e01c23ebb063e70834e6717914c59e4f838b6a6d54f2771` |

- 마지막으로 판독한 Native: [40659493379](https://github.com/minjung2035/oma-v2-ci/actions/runs/40659493379), source `836e2f5963`. `sandboxed-*-gates/result.json`의 `cases[].observations.launchdScope.scope`·`jobOutputs`를 읽었다.
- 같은 source Architecture `40659493531`은 아직 결과를 회수·판독하지 않았다. Mac26 runtime도 미회수다. 기존 workflow를 재발행하지 말고 이미 실행된 artifact부터 확인한다.
- 직전 양 Mac common253·late-fork의 입력: [Native40654073529](https://github.com/minjung2035/oma-v2-ci/actions/runs/40654073529), `4d140a51d5`. `late-fork-macos{15,26}-{gates,runtime}/` 네 디렉터리에 보존.
- 직전 Linux 전체: [Architecture40654073512](https://github.com/minjung2035/oma-v2-ci/actions/runs/40654073512). baseline ZIP의 `source.tar.gz`는 추출하지 않았고 원 ZIP은 `/tmp/oma-coalition-<artifactID>.zip`에 보존했다.
- 이전 첫 Git 거절: `architecture-2af0de04a0/`, `native-all-2af0de04a0/`. 로컬 두 실제 reply는 `socket-first-submit-mapped-smoke.json`.
- 이전 primitive: `fresh-token-macos{15,26}-{gates,runtime}/`(`885c07fedf`), `coalition-macos{15,26}-{gates,runtime}/`(`2af0de04a0`), `generation-macos{15,26}-{gates,runtime}/`. source별 세부 수치·SHA는 진행 기록/회수 당시 metadata를 따른다.

큰 JSON의 `.runtime` 전체를 출력하지 않는다. gate는 `summary`·해당 case·관측 필드만, runtime은 totals/errors 또는 `tests.log` 끝의 TAP summary를 읽는다. 서로 다른 입력의 부분 PASS를 합성하지 않는다.

### 재사용할 OS source·선례

- 고정 XNU revision `f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`: [coalition 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/coalition.c), [ID/재시작 설명](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/doc/observability/coalitions.md).
- [proc identity 구조](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info_private.h#L44):56 bytes, own version offset32·original parent version36. coalition IDs는40 bytes.
- [libproc wrapper](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/libproc/libproc.c): proc_listallpids 반환은 PID count, signal SDK는0 또는 errno 정수. private/unstable ABI를 public stable이라고 부르지 않는다.
- [signal kernel 경로](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/proc_info.c#L3544), [task-name 조회](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_proc.c#L5843). peer가 반환한 임의 port를 genuine kernel task port로 취급하지 않는다.
- 유사 구현은 spec §2의 고정 [Anthropic sandbox-runtime](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/macos-sandbox-utils.ts)·[Codex process-group](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/utils/pty/src/process_group.rs)·§5 Chromium rendezvous를 먼저 비교한다. best-effort 종료나 다른 network 정책까지 자동 수입하지 않는다.

## 7. 명시적 재개 요청 이후의 절차

1. 이 인계·spec과 실제 source/WIP를 대조한다. 적용한 local 변경과 미실행된 실제 Mac 관측을 구분하고 기존 결과의 source를 현재 source로 승격하지 않는다.
2. 기록된 Linux 인수검증과 단일 CI 실패의 비차단 분류를 존중한다. 문서 정합성·지정 branch commit/push를 마친 뒤 §4의 실제 Mac fresh-target 관측을 재개한다. 새 Linux 회귀나 실제 제출/receipt 불일치가 생기면 그 실제 오류의 우선순위를 올린다.
3. 기능 제외·보안/복구 보장 완화·privileged 서비스/entitlement·OS 하한·데이터 migration은 사용자가 결정한다. 내부 API/기존 leaf 재사용·동등 구현은 모델이 정한다.
4. production 변경이 있으면 source 동결 뒤 아래 생성 순서를 사용한다. 생성 중 source를 바꾸거나 과거 ledger를 수동 재승인하지 않는다.

```sh
node scripts/loc.mjs --source-digests
node scripts/review-ledger.mjs --invalidate-stale
node scripts/dependency-graph.mjs --write-evidence
npm run build
# 변경한 실제 경로의 smoke와 필요한 회귀를 실행
node --input-type=module -e 'import {bindVerificationInputs} from "./scripts/refresh-evidence.mjs"; console.log(JSON.stringify(bindVerificationInputs()));'
npm run check:architecture
```

직전 production inventory는14336 files였다. C fixture/scripts/tests만 바뀌면 production 목록 재생성이 필요한 변경인지 먼저 구분한다. build/생성·구조 검사만으로 실제 Mac proof를 대신하지 않는다.

5. 소유한 경로만 명시하여 commit한다. 새 파일/삭제는 해당 경로만 먼저 stage한다. `git add --all`이나 사용자 WIP 포함 금지.
6. CI 발행 전 workflow push 조건·비용·mirror의 다른 WIP를 확인한다. 이전 mirror 동기화는 `/home/dev/oma-v2`의 **committed branch**를 fetch/restore했으며 dirty README를 복사하지 않았다. clean 입력의 build/binding/architecture 후 같은 work branch만 push했다. 정리되지 않은 worktree에서 restore를 기계적으로 실행하지 않는다.
7. mirror의 canonical digest를 주 저장소 validation에 별도로 반영하되 source/runtime PASS를 새 입력으로 위장하지 않는다. 이미 있는 공개 artifact는 API metadata + `nightly.link` ZIP을 이용했다. `gh` 인증 실패를 같은 auth-only URL 반복으로 해결하려 하지 않는다.
8. smoke 뒤 기존 spec/진행/validation을 갱신하고 throwaway를 제거한다. 이번 local 변경·검증은 §4·§5에 기록했다. 실제 Mac과 제품 전체 qualification은 여전히 미완료다.

**재개 시 하지 말 것:** 오래된 NOT_RUN을 최신 관측보다 우선하기, private ABI를 public 보장으로 승격하기, primitive proof로 전체 gate 닫기, unsafe audit-session 경로를 작은 패치로 채택하기, 단일 CI 실패를 확정 Git 결함·무해한 flake·수리 완료로 단정하거나 무한 재현을 선행조건으로 삼기, ETA를 맞추려고 범위를 줄이기.

중단 시 인계본의 로컬 링크24개·anchor4개·구현 경로14개·evidence 디렉터리23개의 참조 검사에서 오류0을 확인했다. 이번 재개 문서 입력의 검사 결과와 혼동하지 않는다. §7의 명령은 주 저장소 cwd에서 위 Node26을 PATH에 둔 상태가 전제다.
