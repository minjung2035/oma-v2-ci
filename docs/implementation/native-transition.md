# DR49 native 전환의 구현·검증 경계

2026-10-25 사용자 구현 지시는 이전 문서 정리 범위를 대체한다. 구현 순서는
[명세 P0–P7](../macos-native-spec.md#13-구현-순서와-완료-조건)이다.
VM 지원은 폐기하며 새 구현의 fallback으로 남기지 않는다. architecture 원문과 과거
검토 기록은 변경하지 않는다. accepted plan, receipt와 DB 4의 뜻을 유지한다. HostConfig 4는 Linux 전용 설정을 제거하는 명시적 형식 경계이며 HostConfig 3 원본은 변환하지 않고 보존한다.

## 선행 시험

`scripts/verify-native.mjs`가 실제 OS/SDK/Node와 source SHA를 기록한다. Darwin probe는
실제 SDK로 빌드한 작은 syscall 시험이며 production 정책의 대체 구현이 아니다.
G-PROCESS/G-FILES/G-AUTH는 각각 독립된 미해결 조건이다. 일부 syscall 성공으로 전체
gate를 닫지 않는다. OPEN은 exit 1, setup 실패는 exit 2다. CI artifact는 실패 때도 보존한다.

- G-PROCESS: kqueue 자동 후손 추적 지원과 setsid/FD 폐기 후 group kill의 반례.
- G-FILES: held directory flock, mode-000 event pin/repair, FIFO 종류 관측,
  no-follow/beneath, rename 후 held root, directory flush, no-replace publication.
  exact executable 결박까지 증명되기 전에는 gate가 OPEN이다.
- G-AUTH: Unix peer PID와 endpoint 상속/인계의 차이. peer PID를 현재 socket holder로
  해석하지 않는다. UID·PID·token만으로 새 권한을 부여하지 않는다.

## 진행 기록

### 2026-10-28 Linux 인수검증 마감·독립 설치본 live/recovery·CI 이력 정정

고정 입력 `88d1cf0b1a435a0c7494e67ccd306ca328a28c73ed8b8535c5168c9904a1c76b` /15686 files의
serial all3952/3952·fail/cancel/skip/todo0·errors[]·baseline COMPARED, build/typecheck/architecture
모든 command exit0·입력 전후 동일을 확인했다. 첫 all의 PATH 누락/cloc4 FAIL과 정상 PATH의
영향 파일23/23·후속 전체 PASS를 모두 보존한다. 제품 코드·성공 조건·timeout은 바꾸지 않았다.

검증된 packed27개 payload로 독립 설치하고 두 checkout을 mount로 가렸다.
실제 GPT-6 Luna/medium Principal·Worker의 코드 수정·검증·submit·수신과 Personal 도구/추론,
두 모드의 history 재개를 확인했다. 실제 broker native drain·Store.close 뒤 자동 Restic 보관,
분실 credential의 원본 보존 거절, 원래 credential의 실제 cold 복원과 같은 key의 원래 receipt도 확인했다.
pre-cold accepted fact11건이 그대로이고 최종 operation14 succeeded·batch8 completed·submit1·
integrate0·추가 Worker0·active journal0·정상 종료0이다. SDK auth 원문·사용자 README/WATCHDOG는 보존했다.
모델 인자 오류·명시 key 생략·prose 마침표와 두 smoke selector/oracle 오류도 원시에 구분했다.

사용자 정정으로 과거 `2af0de04a0`의 첫 `ok:false`는 **원인 미상 단일 CI 실패·비차단 이력**이다.
Git 결함/무해한 flake/수리 완료로 단정하지 않고 진단을 유지하며, 재발·실사용 제출 실패·중복 효과·
ref/receipt 불일치 시 승격한다. 아래 이전 checkpoint의 강한 blocker 표현은 이 정정으로 대체한다.
Linux 인수검증·문서 마감 후 지정 work branch push와 Mac 재개를 사용자에게 지시받았다.
기존 native 문서3개의 변경도 보존해 commit에 포함하도록 승인받았고 README/WATCHDOG는 제외한다.
원시 root는 `/home/dev/oma-audit-artifacts/native-2026-10-28-linux-resume/`,
범위·증거는 [validation](validation.md#linux-인수검증-마감--독립-설치실제-추론재개cold-복구-2026-10-28)을 따른다.
실제 push/새 Mac 실행·세 product gate 통과는 아직 이 기록의 관측이 아니다.

### 2026-10-28 후속 실제 Codex GPT-6 Luna / medium 검증

후속 사용자 지시로 기존 Codex 인증을 원문 노출 없이 검증용 SDK 저장소에 가져왔다.
Principal·Worker 모두 `openai-codex/gpt-6-luna`·`medium`으로 설정하고 실제 checkout CLI·PTY·
native Worker·외부 provider로 GOAL→파일/검증/commit/submit→Principal 수신을 확인했다.
published blob·변경 경로, operation9 succeeded·batch5 completed·journal active0·정상 종료0을 대조했다.
추가 Worker·integrate는 없고 원래 Codex auth bytes/mode·사용자 설정·Human checkout을 보존했다.
도구 오류 각3건 후 완료했으며 두 wait abort는 직전 실제 `oma agent wait`와 대조했다.
실행 중 placeholder 값은 채집하지 않았고 종료 후 Worker credential 부재를 확인했다.
제품 code·기본 모델·security/recovery policy·timeout은 변경하지 않았다.
원시·범위는 [validation](validation.md#후속-실제-codex-principalworker--제한된-실환경-pass)을 따른다.
이 checkout live 결과를 앞선 packed 설치본의 live 추론이나 과거 Git 거절의 원인 수리로 확대하지 않는다.
Linux 완료 조건은 아직 열려 있으며 macOS는 계속 보류한다.

### 2026-10-28 Linux 우선 전환·전체 회귀와 독립 설치 수명 수리

최신 사용자 지시로 Mac 구현·CI·push를 보류했다. P0 durable fact·현재 권한·unknown·ownership을
유지한 Linux 오류·전체 기능·독립 설치·실사용·전체 회귀를 먼저 검증한다.
일반 UID1000/CapEff0·Node26·bwrap0.12에서 첫 고정 입력 `650294ba…`/15686 files의
build27/27·architecture findings0·전체3952/3952·skip0·전후 동일을 확인했다.
이 입력의 첫 Git socket 선택1/1과 전체 동시 실행도 통과했지만 과거 거절 원인은 여전히 미확정이다.
verifier 수리 뒤 고정 입력 `c62c180dea0bd613c9ce625567be0005745422c037fd862d5d1864e785a6abe9`
/15686 files의 serial all도3952/3952·fail/cancel/skip/todo0·errors[]로 통과했다.
build·전체 typecheck·전체 architecture command 모두 exit0이며 per-file/canonical 입력도 전후 동일했다.

독립 workspace 검증은 완료된 설치 트리를 끝까지 누적해23/27 뒤 ENOSPC4건으로 실패했다.
각 verifier child가 끝나면 해당 임시 directory만 정리하고 cleanup 실패도 보존하도록 수리했다.
이후27/27 packed/public API/authored declaration/지정 runtime이 통과했다. production code는 미변경이다.
별도로 packed27개 payload·root manifest/lock에서 source/node_modules 복사 없이 제품을 설치했다.
그 설치본의 실제 Society/Personal PTY·Ctrl-D·exit0·terminal 복원과 local package install/list/remove,
실제 Restic 보관·복원·unreadable source 보존·분실 credential 재생성 거절을 확인했다.
첫 저장 smoke의 cycle 혼합 oracle 실패와 `.git` directory mtime 관측도 원시로 보존했다.

구체적 명령·source별 결과·기능/P0 근거와 한계는 [validation](validation.md)을 따른다.
이 단계 당시 OMA 소유 auth/default provider/model과 확인한9종 API-key 환경이 없어 실제 provider 추론은 NOT_RUN이었다.
후속 실제 Codex 실행은 위 별도 기록을 따르며 원래 첫 Git 거절의 요청별 reply/원인은 여전히 미확정이다.
사용자 README·WATCHDOG와 Mac WIP를 보존한다. Linux 완료 근거를 닫기 전 Mac으로 넘어가지 않는다.

### 2026-10-28 service 양성 대조와 fresh target 분리 — 구현 재개

명시적 재개 요청으로 인계·spec·실제 code와 보존된 `836e2f5963`의 양 Mac3회씩을 대조했다.
기존 fixture의 동일 service job 재사용은 확인했으며, 재시작 대기 원인설은 여전히 추정이다.
host가 실행·종료를 확인하는 `service-positive` 뒤 별도 `service-target`을 같은 actor/once 설정으로 등록한다.
5초 한도·production Seatbelt·C actor·숫자 PID cleanup 범위는 바꾸지 않았다.
두 target·host 양성 명령·positive 종료 뒤/target 전후 print·실제 attempt·target별 job 출력을 남기고,
parser는 두 target의 분리와 명령 귀속을 검사한다. print 텍스트를 admission proof로 쓰지 않는다.

새 귀속 회귀는 수정 전1 FAIL, 같은 test bytes로 수정 후 parser·Seatbelt40/40 PASS·skip0이었다.
변경 MJS3개 syntax exit0. 직접 smoke에서 기존 Mac 결과6건을 새 fresh-target 근거로 거절하고,
합성 거절·spawn 실패·deadline 불명·다른 CID effect를 결과 재분류 없이 수용했다.
실제 Linux의 launchd fixture는 state 생성 전에 exit1로 Darwin-only guard를 유지했다.
합성 grammar는 실제 OS proof가 아니다. **새 fixture의 Mac15·26 실행·새 CI·전체 회귀는 NOT_RUN**이며
G-PROCESS/G-FILES/G-AUTH는 OPEN이다. 원시는
`/home/dev/oma-audit-artifacts/native-2026-10-28-service-fresh-target/`에 보존한다.
재개 전 README·문서 WIP·WATCHDOG.yml을 보존했으며 commit·push·merge·deploy하지 않았다.

### 2026-10-28 production Seatbelt 후손 제어 확인과 사용자 중단

Native [40659493379](https://github.com/minjung2035/oma-v2-ci/actions/runs/40659493379) /
`836e2f5963`의 Mac15·26 gate artifact를 회수·SHA256 대조 후 판독했다.
각117 executed/105 OBSERVED/12 SETUP_FAILED이며 세 product gate는 OPEN이다.
두 Mac 각3회에서 실제 production `seatbeltProfile`을 적용한 detached target과 상속 후손을
fresh controller로 제어했다. 첫 snapshot 뒤 태어난 후손은 다음 scan에서 제어했고,
fixture release 전 old CID ESRCH·다른 live CID query 성공을 확인했다.
GUI UID501·SIP-disabled controlled fixture이며 실제 제품 owner crash·durable producer proof는 아니다.
같은 source의 다운로드한 Mac15 runtime은253/253·skip0이다. Mac26 runtime과
Architecture40659493531 결과는 아직 회수·판독하지 않았다.

service 시도는 두 Mac 각3회 모두 spawnStatus0 뒤 5초 deadline에서 fixture cleanup,
waitStatus9·joined=true·numericCleanupUsed=true였다. 명시적 거절/허용은 판정하지 못했다.
Mac15 진단에는 spawn scheduled·minimum runtime10·runs1이 있었다. 동일 job을 host 양성 후
재사용한 데 따른 재시작 대기 가능성은 추정이지 확정 원인이 아니다.
당시 별도 positive job과 최초 실행 target 분리는 제안만 했고 아직 적용하지 않았다. 이후 적용 범위는 위 재개 기록을 따른다.
이 결과를 service 차단 성공으로 쓰거나 marker 부재를 death/admission proof로 쓰지 않는다.

당시 최신 사용자 지시는 **작업 중단과 인수인계 작성**이었다. 중단 뒤 구현·시험·commit·push 없이
[인계](../HANDOFF.md)를 작성했고, 이후 명시적 재개 요청에 따른 변경은 위 기록으로 구분한다.
아래 이전 checkpoint의 NOT_RUN은 그 source/시점의 기록이며 위 관측보다 최신이 아니다.

### 2026-10-28 CID-only late-fork 재탐색 실제 통과와 Seatbelt 다음 판정

Native [40654073529](https://github.com/minjung2035/oma-v2-ci/actions/runs/40654073529) /
`4d140a51d5`의 두 Mac common은253/253·skip0, gate117회는105 OBSERVED·12 SETUP_FAILED다.
각 OS의3회 모두 첫 scan이 late child만 찾았고, 그 snapshot 뒤 태어난 grandchild는 포함하지 않았다.
첫 제어 뒤 kernel 집계는8 started/7 exited로 여전히 live였고, 다음 scan이 새 PID를 찾아 SDK 제어했다.
두 번째 제어 뒤 **release 전 CID ESRCH**와 별도 live CID의 성공 조회를 확인했다.
effect 입력은 kernel CID hint였으며 marker에 저장한 PID·old owner token/FD는 쓰지 않았다.
이는 unprofiled controlled target·GUI UID501·SIP-disabled 범위다. 원시는 SHA256 확인한
`late-fork-macos{15,26}-{gates,runtime}/`다.

다음 fixture는 동일한 `seatbeltProfile` production renderer를 detached target에 실제 적용하고,
후속 fork는 그 label을 상속한다. trusted fresh controller는 재적용 없이 외부에서 제어한다.
추가로 host가 실제 실행·종료를 확인한 dormant owned job을 sandboxed `/bin/launchctl kickstart`로
다시 시작하려 한다. 실제 spawn/wait·deadline cleanup·job 출력과 marker 양성만 기록한다.
거절을 기대값으로 고정하거나 marker 부재를 거절/죽음으로 해석하지 않는다.
Linux parser/policy52/52·skip0은 통과했고 새 sandboxed target·service 시도의 Mac 실행은 NOT_RUN이다.
bootstrap/다른 service 경로·실제 product owner crash·durable producer는 여전히 별도다.

같은 `4d140a51d5`의 Architecture `40654073512`는 full serial3952/3952·skip0·errors[]이고,
baseline 모든 command exit0·5개 lane PASS·skip0이다. input 전후15686 files·
`7461a8886f3ad044027eb7eb96de5ff785e4eefaf1fb929bcad4b04d8f5d2eb4`가 같다.
원시는 digest 확인한 `native-all-4d140a51d5/`, `architecture-4d140a51d5/`다.
이 성공은 이전 exploratory 첫 Git 거절의 원인 설명이나 수리가 아니다.
로컬 진단도 private bwrap0.12 overlay의 mapped-root namespace에서1/1 PASS였고, 실제 두 Git reply는
같은 succeeded operation이었다(`socket-first-submit-mapped-smoke.json`). 일반 UID proof로 세지 않는다.
최초 local smoke는 고정 `/usr/bin/bwrap` 부재로 spawn-failed(-2)·JSON EOF였으며 별개 setup 실패다.
overlay·script·temporary dump는 제거했고 이전 CI 거절의 원인 추적은 유지한다.

### 2026-10-28 fresh kernel token 제어와 release 전 CID 소멸 확인

Native [40650124720](https://github.com/minjung2035/oma-v2-ci/actions/runs/40650124720) /
`885c07fedf`의 Mac15·26 common은 각각253/253·skip0이고 gate117회는105 OBSERVED·12 SETUP_FAILED다.
각 OS의3회 모두 fresh exec controller가 kernel task-name port에서 audit token을 얻었다.
before/after unique·version과 CID가 일치한 detached target의 SDK SIGKILL은0이었으며,
**fixture release 전에** 기존 CID는 ESRCH·별도 CID는 live query 성공이었다.
다른 CID의 target은 correlated=false·signalStatus=-1(미호출)이었다.
old owner의 token/FD나 target의 Mach 응답은 사용하지 않았고 private entitlement·숫자 PID fallback도 없다.
이것은 GUI UID501·SIP-disabled·unprofiled controlled target의 primitive proof이며 role authority가 아니다.
원시는 API SHA256 확인한 `fresh-token-macos{15,26}-{gates,runtime}/`다.
[고정 kernel signal](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/proc_info.c#L3544)은
token lookup→MAC→동일 proc_ident ref 재취득→UID 권한 검사 뒤 실제 signal을 보낸다.

다음 fixture는 owner/job 제거 뒤 태어난 child와 **첫 PID snapshot 뒤** 태어난 grandchild를 추가한다.
`proc_listallpids`의 [반환 단위는 PID count](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/libproc/libproc.c#L62)다.
bounded scan은 candidate hint만 내며 각 effect에서 membership/token을 다시 결박한다.
재탐색과 paired CID query를 반복하되, empty/truncated scan·deadline을 scope death로 바꾸지 않는다.
관측용 marker PID는 제어 입력으로 쓰지 않는다. Linux parser/policy52/52·skip0은 통과했고
새 late-fork/discovery C의 실제 Mac compile·실행은 아직 NOT_RUN이다.
product owner crash·Seatbelt/service admission·durable producer와 세 product gate는 여전히 미해결이다.

### 2026-10-28 Linux full serial PASS와 별도 exploratory Git 거절

Architecture [40647938235](https://github.com/minjung2035/oma-v2-ci/actions/runs/40647938235) /
`2af0de04a0`의 native-all은3952/3952·skip0·errors[] PASS다. input before/after는15686 files·
`bef0de38e4b254be781e24e5dcefe09ec5c0c9913be2d5a4186edf7d75db584a`로 같았다.
fast880·durable872·property34·stress16·platform72도 전부 PASS·skip0이다.
다만 exploratory baseline의 `test`는 exit1이었다. P0 real-socket 시험에서 첫 `git-idempotent`
reply의 ok=false가 관측됐으며, 원시에는 error body가 없다(`dist/test/audit2.test.js:788`).
같은 입력의 serial full PASS가 이 실패를 지우지 않는다. 계약·timeout·기대값은 유지하고 기존
assertion에 실제 reply를 남기도록 했다. 원인/수리는 아직 미확정이며 재실행 PASS만으로 해결 처리하지 않는다.
원시는 digest 확인한 `native-all-2af0de04a0/`, `architecture-2af0de04a0/`다.

### 2026-10-28 coalition 소멸과 explicit admission 거절 실제 확인

Native [40647938085](https://github.com/minjung2035/oma-v2-ci/actions/runs/40647938085) /
`2af0de04a0`의 Mac15·26 common은 각각253/253·skip0이다. gate117회는105 OBSERVED·12 SETUP_FAILED다.
새 actor는 두 SDK에서 `-Wall -Wextra -Werror`로 compile됐다. 각 OS의3회 모두 inherited child가
같은 resource CID에 있었고, private setter는0을 반환했으나 explicit own/다른 CID의 spawn은 EPERM(1)이었다.
bootout 뒤 detached actor 생존·6 started/5 exited를 다시 관측했다. **시험용 release 뒤** 기존 CID 조회는
ESRCH(-1/3)로 바뀌었고, 별도 live CID의 query는 성공·2 started/1 exited였다.
이는 count0과 다른 kernel ID 소멸 관측이며 all-owner-death 제어의 증명은 아니다.
SIP-disabled·GUI UID501에서의 범위이며 headless/SIP-enabled·service-mediated spawn은 미검증이다.
원시는 API SHA256 확인한 `coalition-macos{15,26}-{gates,runtime}/`다.

다음 최소 시험은 fresh exec controller의 `task_name_for_pid → task_info(TASK_AUDIT_TOKEN)`다.
[고정 PID lookup](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_proc.c#L5843)은
same-user·MAC 검사 뒤 kernel task-name port를 반환하고,
[task_info](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/task.c#L6444)는 이 port에서 audit token을 읽는다.
fixture는 unique/version before→membership→kernel token→unique/version after를 대조한 뒤 SDK signal을 호출한다.
다른 live job을 wrong-member 대조로 쓰고, release 전에 CID query를 남긴다. 거절/미호출(-1)/실제 효과를
구분하며 새 sandbox profile·private entitlement·숫자 PID fallback은 추가하지 않는다.
Linux parser/policy52/52·skip0은 통과했고 새 C getter·control의 Mac 실행은 아직 NOT_RUN이다.
이 선행 시험은 durable authority producer·전체 후손 탐색·fork race·all-owner-death 복구가 아니다.

### 2026-10-28 clean Personal과 generation-checked SDK 제어 실제 통과

Native [40642688171](https://github.com/minjung2035/oma-v2-ci/actions/runs/40642688171) /
`0aebf98b64`의 Mac15·26 common은 각각252/252·skip0이다.
각 OS의 gate117회는105 OBSERVED·12 SETUP_FAILED이며 세 product gate는 OPEN이다.
조사용 preload 없이 Personal 각3회 화면 ready·Ctrl-D·exit0·terminal 복원·Unicode cwd의 Personal birth와
무 Society birth를 확인했다. 별도 Society 실행은 state 생성 전 exit4였다.
파일명을 session mode로 오인한 oracle은 기존 `readSessionBirth` 의미로 교체했고 진단용 preload는 제거했다.
실제 signed Swift helper의 EOF 전 fragmented frame 회귀도 두 OS에서 통과했다.
원시는 API SHA256 확인한 `generation-macos{15,26}-{gates,runtime}/`다.

`mach-token-control`도 두 Mac 각3회 OBSERVED다. UID501의 nonparent sibling controller가
kernel Mach trailer의 genuine token으로 실제 대상을 SIGKILL했고, target은 signal9로 join됐다.
잘못된 generation은 ESRCH(3), signal0은 EINVAL(22), 실제 SIGKILL은0을 반환했다.
fixture-only numeric cleanup은 사용하지 않았고 두 owned child를 모두 join했다.
SDK header는 private/unstable이며 [고정 wrapper](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/libproc/libproc.c#L479)의
반환 계약은0 또는 errno다. raw syscall이나 private entitlement는 추가하지 않았다.
controller에는 새 profile을 적용하지 않았다. 이 결과는 role·실제 PID 재사용·fresh sandboxed reaper·
임의 후손의 token 취득·전체 scope 복구를 증명하지 않는다. 제품 guard와 journal은 그대로다.

다음 판정은 resource coalition의 **재활성화 불가능한 종료 관측과 외부 admission**이다.
task count의 일시적0은 pending activation을 배제하지 않는다. job 제거와 controlled exit 뒤
동일 boot의 기존 CID가 kernel query에서 사라지는지, 별도 live job을 대조하며 관측한다.
admission 및 all-owner-death 복구가 남으므로 이를 complete-scope backend 채택으로 읽지 않는다.

다음 fixture는 controller가 제거한 job의 controlled actors를 release한 뒤, 기존 CID와 별도 live CID를
짝지어2초까지 query한다. **이 release는 시험 cleanup이며 실제 recovery proof가 아니다.**
실제 job 안에서는 inherited spawn을 대조군으로, own/다른 controlled CID를 명시한 suspended spawn을 시도한다.
`posix_spawnattr_setcoalition_np`는 SDK에 없는 [고정 private 선언](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/spawn/spawn_private.h#L86)을
따르는 시험 전용 adversary다. raw coalition control syscall·private entitlement·제품 경로는 추가하지 않는다.
symbol 부재·거절·실제 성공을 구분하고 새 direct unreaped child만 종료·join한다.
Linux parser/policy52/52·skip0과 실제 fixture의 Linux 거절·무 state 생성은 확인했다.
새 C의 Mac compile·admission·CID 소멸은 아직 NOT_RUN이다.

### 2026-10-28 main-image 검증 통과와 실제 Keychain frame deadlock 수리

Native `40634523433` / `859c9ff3be`의 두 Mac은 각각114회·99 OBSERVED·15 SETUP_FAILED다.
각3회 suspended-image에서 A/B·Node·Git·compiler·shebang interpreter가 실제 release/exit0을 보였다.
잘못된 B/A requirement는-67050, B-map 뒤 pathname을 A로 복원한 첫 lookup의 validation은-67034였고,
두 반례 모두 constructor/main 실행 없이 SIGKILL·join됐다. main-image primitive의 이 선행 범위는
검증됐으며 script/module/library bytes·완전한 scope·현재 Broker 권한으로 확대하지 않는다.
원시는 API digest 확인한 `live-frame-macos{15,26}-{gates,runtime}/`에 있다.

같은 입력의 common은 두 OS 모두250/251·skip0이다. 유일한 실패는 credential-free unknown-op의
완성된 frame에 EOF 전 응답을 요구한 회귀다. 두 helper 모두5초 deadline까지 답하지 않았고,
기존 EOF/잘못된 입력 사례는 통과했다. Swift reader를 Foundation의64KiB readData 대신 bounded
POSIX read와 재사용 scoped buffer로 교체했다. EINTR·partial read·EOF·기존 frame limit/오류는 유지한다.
credential 정책·storage 형식·helper 소유권·deadline·fallback은 바꾸지 않았다.
로컬 source binding/ledger/DAG 재생성과2/27 rebuild, 관련 Linux76/76·skip0 및 실제 rebuilt Personal의
ready→Ctrl-D→exit0·terminal 복원·Personal birth·무 Society provisioning은 확인했다.
이 수리의 실제 Swift compile·EOF 전 응답·Mac UI 재실행은 아직 NOT_RUN이다.

Architecture `40631668145` / `9e2cbceb9b`의 Linux full native-all은3950/3950·skip0 PASS다.
baseline check exit는 전부0이고 fast/durable/property/stress/platform도 실제 PASS·skip0이다.
input before/after는15687 files·`489ab823aa5c95f0c43da6a471ecfdd0bcd6fd94fe88b13b515f0314e8dd9996`으로 같다.
이전1건 실패 입력과 구분하며 이후 Swift 수정 입력의 새 full PASS라고 기록하지 않는다.
원시는 digest 확인한 `native-all-9e2cbceb9b/`, `architecture-9e2cbceb9b/`다.

### 2026-10-28 Keychain 대기 분리와 초기 Mach stop의 실제 의미

Native `40631668104` / `9e2cbceb9b`의 Mac15·26 common은 각각252/252·skip0이며,
gate는 각각114회·96 OBSERVED·18 SETUP_FAILED다. digest 확인 원시는 `suspended-macos{15,26}-{gates,runtime}/`에 있다.
두 OS의 첫 Personal trace는 host → pi-personal → 실제 `oma-keychain` child를 보였다.
engine은 `personalModels → KeychainClient.launch` 뒤 channel 응답을 기다린다. Keychain 접근 자체의
대기인지 frame reader의 대기인지는 아직 분리하지 못했다. 기존 helper 시험은 입력 직후 EOF를
보내므로 이 차이를 잡지 못했다. credential을 읽지 않는 fragmented unknown-op 시험을 **EOF 전에
완전한 거절 응답을 받아야 하는 계약**으로 강화했다. 이 입력의 Swift reader는 아직 바꾸지 않았으며,
다음 실제 Mac 실행이 before 회귀를 판정한다. recipe path·오류 문구만 고정하던 oracle과 required-name은 제거했다.

suspended controller는 두 SDK에서 실제 compile/실행됐지만, 첫 positive가 WIFSTOPPED=true·WSTOPSIG=0에서
시험의 SIGSTOP=17 가정에 막혔다. [고정 XNU의 초기 정지](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L2208)는
signal 전달 대신 SSTOP·task_suspend_internal을 설정한다. 특정 signal 값 검사는 삭제하고 C의
WIFSTOPPED·실행 전 무출력·실제 requirement·release/실행 marker 검사는 유지했다.
positive 결과는 assertion 전에 보존하도록 고쳤다. 이후 pathname 치환 반례와 정상 도구의
full qualification은 아직 NOT_RUN이며 gate는 OPEN이다. Linux parser/policy50/50·skip0은 통과했다.

### 2026-10-28 실제 Personal wait 관측과 suspended-image 다음 판정

Native `40625206025` / `4bea9f8442`의 Mac15·26 common은 각각251/251·skip0이다.
Society의 provisioning 전 거절·기존 bytes 보존 계약도 두 OS에서 실제 통과했다.
gate 실행은 각각111회·96 OBSERVED·15 SETUP_FAILED이며 세 product gate는 그대로 OPEN이다.
각 OS의 첫 Personal 시도는 실제 waitpid상 미종료·ready=false·빈 출력, termios ECHO/ICANON=true였다.
native sample은 exit0으로 root Node의 `uv__io_poll → kevent` 대기를 보였다. 어느 JS await/child에서
멈췄는지는 이것만으로 알 수 없다. 원시는 digest 확인한 `truthful-macos{15,26}-{gates,runtime}/`에 있다.

Mac26의 큰 stderr JSON 중간에는 uncaught assertion stack이 끼어들었다. fixture는 record의 write
callback 완료 뒤 throw하도록 수정했다. 후속 Personal 시험만 조사용 preload로 Node child 생성
call site와18초 시점의 active child/resource 종류를 기록한다. experimental diagnostics channel은
진단용이며 PID/서명/role authority나 정상 제품 경로의 대체가 아니다. 원인 확인 뒤 제거한다.
Linux 실제 parent/child 대기 관측과262144-byte failure record의 완전한 decode를 확인했다
(`personal-startup-trace-linux.json`). 이 관측은 Mac UI 성공을 뜻하지 않는다.

`suspended-image` fixture와 evidence validator를 추가했다. START_SUSPENDED의 A/B 양성 대조,
B를 map한 뒤 pathname을 A로 복원하고 **첫 dynamic guest lookup**부터 A/B requirement를 검사하는
반례, Node/Git/compiler 및 shebang interpreter 대조를 같은 actual-child 경로로 실행한다.
동기 Security 호출은 owned-group Python supervisor가 제한하고 unreaped direct-child PID만 제어한다.
plain spawn·명시 file actions를 쓰며 실패한 SETEXEC/addinherit recipe를 반복하지 않는다.
arch별 cdhash 집합을 requirement로 검증하고 실제 release/constructor/main 결과를 남긴다.
main image만의 관측이지 script/module/library bytes·전체 후손·expected-Broker proof가 아니다.
Linux C target 두 variant의 실제 실행·같은 PID constructor/main, Linux kernel refusal와 parser/policy50/50은
확인했다. Darwin controller의 Security-framework compile/실행은 아직 NOT_RUN이며 채택하지 않았다.
driver는114회·11개 program을 예약하고 workflow의 최악 시간 한도를 함께 늘렸다.

### 2026-10-28 두 Mac의 파일 수리 확인과 launchd 후보 반례

Native `40618265543` / `a62af1bae3`의 Mac15·26은 각각111회 실행·96 OBSERVED·15 SETUP_FAILED다.
새 readable-directory·immutable checked-source/collision 회귀는 두 OS에서 실제 통과했다. common 전체는 각각249/250·skip0이며,
남은1건은 Personal/login/install까지 전부 exit4라고 고정하던 이전 global-guard 계약이다. 그 가정을 제거하고 Society의
무상태 거절·기존 bytes 보존만 검사하도록 이관했다. Linux 관련39/39와 selector component exit4/무상태는 확인했지만
수정된 Darwin-only assertion의 재실행은 NOT_RUN이다. component는 실제 Linux ESM Koffi를 먼저 로드한 selector 시험이지 Darwin kernel proof가 아니다.

GUI/501(Aqua)에서는 두 job의 생성·서로 다른 resource coalition·fork/setsid 상속·집계를 각3회 관측했다.
bootout 뒤 ordinary ack는 없지만 detached·독립 other job은 계속 실제 ack했고 집계는 started5/exited4였다.
등록 제거와 전체 후손 죽음은 다르므로 단순 bootout backend는 채택하지 않는다.
image의 A/B 양성 대조도 실행됐지만 constraint A의 교체된 B가 실제 variant2 marker를 남겼다.
SIP-disabled 두 환경에서 launchd constraint를 exact-image proof로 사용할 수 없다. 실제 종료/복구·expected-Broker gate는 OPEN이다.

Personal의 ready=false·빈 출력은 확인했지만, 당시 harness의 exited/echo/icanon은 timeout 때의 고정값이었다.
child 생존·raw mode 진입으로 해석할 수 없다. 실제 waitpid/termios와 owned child의 bounded native sample을 다음에 관측한다.
Git candidate는 gate release0/REF_STATE_UNKNOWN, quarantine도 REF_STATE_UNKNOWN이다. directory 수리로 해결됐다고 기록하지 않는다.
네 immutable ZIP의 SHA256은 API digest와 일치하며 원시는 `portable-macos{15,26}-{gates,runtime}/`에 보존했다.
clean mirror의 첫 검사는 누락된 workspace 설치/선언 때문에 실패했다. `npm ci` 뒤27/27 rebuild와 전체 architecture가 통과했다.

같은 입력의 Architecture `40618265528` native-all은3947/3948·skip0으로 FAIL이었다.
유일한 실패 R35는 이미 삭제한 SBPL 문자열·recipe copy 검사의 required-name2개가 남은 것이었다.
그 두 요구만 제거하고 실제 IPC proof로 다시 이름 붙이지 않았다. R35/entry 회귀23/23, 실제 platform lane72/72·skip0이 통과했다.
이는 후속 WIP 입력의 선택 검증이며 원래 full 결과를 PASS로 바꾸지 않는다.

PTY helper는 exit7·ready 미출력 child도20초 뒤 `exited=false/code=null`로 보고하는 반례를 재현했다.
실제 waitpid·termios를 보고하고, ready timeout의 unreaped owned child만 bounded sample하도록 고쳤다.
early exit 회귀와 기존 terminal/mode10/10, Linux live timeout의 실제 flags·owned group cleanup/direct-child join,
실제 compiled Personal의 ready→Ctrl-D→exit0·terminal 복원을 확인했다. `/usr/bin/sample`은 Linux에서 unavailable로 기록됐으며
Darwin native sample은 다음 실행 전까지 NOT_RUN이다. group cleanup을 arbitrary-descendant death proof로 사용하지 않는다.



### 2026-10-28 readable directory와 portable immutable publication

Native `40612861610` / `c01e308a15`의 두 Mac은 각각111회 실행·90 OBSERVED·21 SETUP_FAILED다.
constraint 없는 `launchd-scope`도 user/501 bootstrap5에서 멈췄으므로 image constraint만의 실패로 해석하지 않는다.
후속은 manageruid/name/pid를 기록하고 **별도 gui/UID context**를 시험한다. headless 지원이나 backend 채택을 뜻하지 않는다.
두 Mac의 동일 sandbox·production stderrFd2 Git query는 exit0/sha1이었다. 전달 문제라는 가설은 배제하고 임시 진단을 제거했다.
이전 `3d9ed7493`의 Mac26 common247/247·skip0과 Linux installed Personal tools1/1·skip0은 해당 입력의 근거로 유지한다.

실제 Mac Personal은 화면 전에 `directory type mismatch: …/data/oma`로 실패했다.
readable owned directory는 처음 연 directory FD를 그대로 유지하도록 고쳤다. EACCES일 때만 기존 pin/repair/reopen을 시도하며
Darwin mode-000 반례를 pathname chmod로 우회하지 않는다. 이 수정의 Mac 결과는 아직 NOT_RUN이다.

private temporary 생성·receipt 공개는 기존 held-parent `linkAt` 관례를 재사용한다.
외부 source의 `tryLinkDescriptor`는 Linux FD hardlink를 유지하고, Darwin 또는 EXDEV에서는 checked bytes의 검증된 목적지-side copy를 공개한다.
writer flock·no-replace·충돌 검증·실제 published inode의 cleanup identity·flush 순서는 유지한다. inode 공유 assertion과 source-text mutator gate는 삭제했다.
Linux UID1000의 파일/receipt 회귀60/60·skip0, build·전체 strict가 통과했다.
처음 넓은 선택은 `/usr/bin/bwrap` 부재로 native Git1건이 실패했다. 실제0.12 binary를 넣은 disposable mount namespace에서 preaccept28/28·skip0을 확인했다.
이는 root-mapped 관측이며 일반 UID permission proof는 아니다. overlay scaffold도 제거했다.
실제 다른 device(42→26)의 copy에서 source-name 교체·destination-parent 교체·충돌 보존·published identity·flock contention과 해제를 확인했다.
현재 compiled Personal+bundled Pi의 실제 Linux PTY도 birth 공개→화면→Ctrl-D→exit0·terminal 복원·Society 미생성을 통과했다.
원시는 `native-2026-10-28-descriptor-leaf/portable-publication-*.json`와 `publication-preaccept-namespace.json`이 소유한다.
Darwin publication/Personal after-proof와 세 product gate는 아직 미완료다. plan111·program10·outer270분은 유지한다.


### 2026-10-28 Personal의 독립 진입 복구

`entry/oma.ts`의 모드 선택 전 Darwin 전체 차단을 제거했다. Personal은 기존 Human OS 권한·history owner를 쓰며
Society broker/role/scope를 로드하지 않는다. Society entry·broker·runner·client의 capability guard는 그대로다.
지원되지 않는 Society는 자기 entry에서 provisioning 전에 거절한다. resume의 birth/history 조회는 읽기 관측이다.

수정 전 compiled entry는 Linux에서 platform selector만 제어한 component smoke로 Personal도 exit4/무상태로 거절했다.
처음 시도는 Koffi가 잘못된 OS binary를 찾은 setup 실패였으며 실제 Linux Koffi를 먼저 로드해 관측을 분리했다.
이는 Darwin kernel 실행이 아니다. 수정 뒤 실제 Linux PTY·bundled Pi·새 HOME/data에서 Personal 화면 표시 →
Ctrl-D → exit0·echo/icanon 복원·Personal birth1개·Society 미생성을 확인했다. build·전체 strict와 관련87개도 통과했다.

실제 Mac의 `personal-entry`는 credential/inference 대체 없이 같은 새 terminal 경로와 Society의 무상태 거절을 확인한다.
Mac 결과는 아직 미확인이고 signed Keychain·도구·resume 전체 검증을 이 startup smoke로 대신하지 않는다.
plan108회·program10개의 driver242분+설치/credential/upload20분을 outer270분 안에 둔다.


### 2026-10-28 file fence의 실제 수정 확인과 public launchd 후보

Native `40607179845`, 입력 `4173f5941`의 Mac15·26에서 nested credential read·credential/parent rename 거절과
무관한 create/rename/unlink 허용이 각각3회 통과했다. 각102회 실행 중90 OBSERVED·12 SETUP_FAILED이며 세 product gate는 OPEN이다.
Git setup은 candidate125·quarantine REF_STATE_UNKNOWN으로 여전히 실패하고, Worker는 production guard에서 거절한다.
Mac26 common은246/247·skip0으로, 남은1건은 변경된 deny 문구를 고정한 assertion이다. 이 문자열 검사와 copy-only 검사는
삭제하며 denial 문구를 다시 고정하지 않는다. 환경·literal argv·위조 lease/경로 거절 검사는 유지한다.

다음 `launchd-job`은 일반 사용자 `launchctl bootstrap user/UID`의 controlled job만 다룬다.
[고정 XNU 문서](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/doc/observability/coalitions.md)는
coalition 상속·ID 비재사용과 loaded service 재시작 시 같은 coalition 재사용을 설명하지만 목표 OS의 실행 증거는 아니다.
실험은 별도 job·setsid/double-fork·FD 전체 close·bootout 후 live ack와 집계 관측을 비교한다.
read-only libproc/private coalition ABI만 관측하며 private coalition 제어·numeric PID signal은 호출하지 않는다.
fixture의 private release/deadline·관측한 generation 종료는 arbitrary descendant death나 복구 proof가 아니다.

별도 A/B 양성 대조와 mutable pathname 교체로 Apple의 `SpawnConstraint.cdhash`를 시험하고 SIP 상태·실제 service 상태를 보존한다.
2초 marker 부재만으로 mismatch의 실행 전 거절을 판정하지 않는다. Mac 실행 전까지 새 후보는 NOT_RUN·미채택이며
105회 시도·9개 program의 driver234분+설치/credential/upload20분을 outer260분 안에 배치했다.
Git setup의 후속 임시 진단은 같은 profile의 실제 async/sync Git 관측을 남길 뿐 production status grammar나 권한을 바꾸지 않는다.


### 2026-10-28 실제 Node 시작과 signal 후보 배제, file fence 수리

| 공개 입력 `87cc9c92e` | 관측과 한계 |
|---|---|
| Architecture `40601095851` | full native-all3946/3946·skip0, baseline와 fast/durable/property/stress/platform exit0. 별도 kernel/crash lane은 NOT_RUN이며 실제 파일·필수 oracle은 all에 포함됐다. 후속 WIP의 PASS로 확대하지 않는다 |
| Native `40601096157`, Mac15·26 각각 | 102회 실행·87 OBSERVED·15 SETUP_FAILED. 각3회의 실제 Node가 stdin과977337-byte profile 전송 뒤 실행됐다. startup SIGABRT는 닫았지만 file/Git/Worker 기능 실패는 별개다 |
| 같은 입력의 signal label 실험 | 두 OS 각3회 모두 inherited 실제 전달·fresh EPERM·nested 적용 EPERM·적용 실패 후 inherited 전달·owned child join. 같은 profile text로 recovery label을 재구성할 수 없다는 반례다 |
| 같은 입력의 file fence | 쓰기 허용 root 내부 credential 읽기가 허용되어 실제 negative control이 실패했다. file* deny 뒤라는 소스 문자열 순서는 containment oracle이 아니었다 |

[고정 upstream](https://github.com/anthropic-experimental/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/macos-sandbox-utils.ts#L932)은 구체적 operation 우선순위와 보호 경로의 ancestor 이동 차단을 명시한다.
명시적으로 허용한 file operation을 deny에도 다시 적고 writable ancestor vnode의 unlink/create를 pin한다.
실제 fixture는 nested credential과 그 parent의 rename 거절을 요구하되 무관한 rename/unlink가 계속 가능한지도 검사한다.
단순 rule-order assertion은 삭제했다. 이 수리는 후속 Mac 실행 전까지 미확인이다.

Git setup의 실제 실패는 /private/var/select/sh 읽기 거절이다. 그 system selector만 read-only로 추가했으며
/etc/gitattributes 접근은 허용하지 않고 shared GIT_ENV에서 system attributes를 제외한다.
실제 Git의 system canary→unspecified 전환을 private root-mapped user/mount namespace에서 확인했다.
Worker의 남은 종료는 production native-support guard이며 gate를 거짓으로 닫아 우회하지 않는다.

### 2026-10-28 metadata 완료와 후속 lifetime 실험

Architecture companion `40596658850`의 native-all은 **PRECHECK_FAILED / NOT_RUN**이다.
runtime build와 별개인 root strict checker에서 compile-only View status 계약의 동기 반환 기대가 남아 있었다.
Promise 계약과 exported proof 이름을 이관하며, 전체 runtime 회귀를 실행한 결과로 대체하지 않는다.

| 입력/환경 | 관측과 한계 |
|---|---|
| Native `450dd44dd` / run `40596658828`, Mac15·26 각각 | common248/248·skip0. getattrlist의 정상 empty·symlink·BSD flag·nonempty/zero-entry ACL·resource fork 경로가 실제 통과했다 |
| 같은 Mac 입력의 독립 설치 각각 | 전체27개 중26 PASS. native temp-alias 수리는 통과했다. Git은 fixture가 아니라 shared PreparationExecutor의 Linux-only guard에서 거절됐다. 건너뛰거나 direct host exec로 대체하지 않는다 |
| 같은 Mac 입력의 gate 각각 | 99회 실행,48 OBSERVED·51 SETUP_FAILED. Node는 allocator를 지나 JavaScript의 os binding에 도달했으나 uv_os_uname 실패 시 GetOSInformation의 assertion으로 중단됐다 |
| 같은 입력 Ubuntu | common239/239·실제 native execution46/46·integration433/433, 모두 skip0 |
| main `0853bfd7`의 clean checkout, Node26 UID1000 | dependency·dist 없이 pre-install hash → npm ci → workspace27/27 전체 rebuild → status22/22 통과. 전후 canonical digest는 e3a2c4b9…로 동일했고 공개 mirror의 source identity와 일치했다 |

고정 Libc uname은 OSTYPE·HOSTNAME·OSRELEASE·VERSION·HW_MACHINE을 모두 질의한다.
누락된 kern.hostname/kern.version의 exact read-only 항목을 추가했다. 실제 Node 성공은 후속 CI에서 판정한다.
metadata의 임시 ACL dump/별도 observer 진단만 제거했고 실제 보존·symlink 회귀는 유지했다.

다음 lifetime 실험은 독립 C producer의 fresh/inherited/nested signal 비교다. signal 전후 살아 있는
직접 child임을 확인하고 join까지 PID를 reap하지 않아 outsider에 signal할 수 없게 한다.
inherited 실제 delivery와 owned join이 positive control이다. fixture의 EOF 종료는 arbitrary descendant death 증거가 아니다.
3회 독립 관측이 추가되어 plan은102회이며 개별120s budget은 그대로다. driver226분+설치/credential/upload20분이
outer clock 안에 들어가도록250분으로 계산했다. 이는 timeout 실패를 숨기거나 product gate를 닫는 변경이 아니다.

### 2026-10-28 clean-checkout 반례와 Node page-size 질의

| 공개 입력 | 관측과 한계 |
|---|---|
| Native `caa779abf` / run `40591092710`, Mac15·26 각각 | 99회 모두 실행,45 OBSERVED·54 SETUP_FAILED. C target의 FD-close/kept-FD는 각3회 통과했다. stdio CLOEXEC·selected channel·soft/hard limit 아래 canary·same-PID exec·negative leak control을 실제 관측했다. 세 product gate는 OPEN |
| 같은 입력 root build | DR63의 `storage/ledger-reader.ts`와 `store.ts` 두 파일이 commit에서 빠져 pendingWorkRows가 이전 동기 타입이었다. root typed build가 거절됐고 Mac common/packed는 실행되지 않았다. 미커밋 local source의 PASS를 committed source의 PASS로 읽으면 안 된다 |
| 같은 입력 실제 Node crash | root loader 예외 뒤 C actor는 main에 도달했다. Node는 `RandomNumberGenerator::SetEntropySource`→Abseil mutex→LowLevelAlloc의 arithmetic overflow로 SIGABRT |
| Architecture `562548397` / run `40577594148` | all3930/3944,14 FAIL. 13개는 build-stamp fixture의 workspace-executables import 누락, 하나는 workflow 순서를 문자열로 고정한 assertion. platform70/70·property34/34·stress15/15는 별도 PASS |

Node26 [allocator](https://github.com/nodejs/node/blob/v26.0.0/deps/v8/third_party/abseil-cpp/absl/base/internal/low_level_alloc.cc#L356)는 sysconf(_SC_PAGESIZE)를 size_t로 변환한다.
고정 Libc `71bbe350`의 getpagesize는 numeric HW_PAGESIZE 질의 실패 시−1을 돌려준다.
[고정 XNU의 OID](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_mib.c#L1059)는 `hw.pagesize_compat`이며 기존 `hw.pagesize`와 별개다.
exact read-only 항목만 추가했다. 실제 Node 시작 성공은 후속 Mac 실행 전까지 미확인이다.

pre-install binding은 compiler helper에서 vendored 경로 상수만 pure module로 분리해 복구했다.
깨끗한 dependency-free fixture에서 실제 hash CLI 실행과 후속 source 변경의 digest 무효화를 확인했다.
build-stamp의 실제 build/cache 회귀13개는 수리 후 통과했다. incidental workflow assertion은 삭제했고
동일한 source 문자열 기대값으로 재고정하지 않았다. 실행 중 source 편집으로 stale해진 validation binding은 최종 구조 생성 뒤 갱신한다.

### 2026-10-28 metadata·loader 반례와 status projection (DR63)

공개 입력 `9c95aaaac`의 Native run `40580105329` 원시 ZIP·digest를 별도로 보존했다.

| 입력/환경 | 관측과 한계 |
|---|---|
| 실제 Mac26/15 각각 | common247/248. 빈 NO_INHERIT ACL은 getattrlist의44-byte security payload로 존재했지만 lstatx/acl_get_link_np는 없다고 답했다. fixture 소실이 아니라 관측 손실이다 |
| 실제 Mac26/15 독립 설치 각각 | 전체27개를 실행해25 PASS·2 FAIL. Broker와 tool-files runtime은 통과했고 git/native smoke의 비정규 temp alias 두 건을 canonicalize했다 |
| 실제 Darwin crash report | Node와 C target의 main 이전 dyld CacheFinder→ignite→boot_boot→ignition_halt, LIBIGNITION namespace35/code2에서 SIGABRT |
| 같은 입력 Ubuntu |431/431·skip0, pending620 지연6ms. 앞선74ms 실패의 원인을 해결했다는 뜻은 아니다 |
| DR63 Local Node26, UID1000 | 기존 latency9/9, pending620 maxLag17ms로50ms 예산 유지. 실제 durable mail620개를 status 파일로 게시·decode했고 다른 turn이 projection 완료 전에 진행했다 |
| 같은 코드의 native lifecycle | host의 bwrap 부재로6건 실패한 뒤 private mount에 실제0.12.0을 제공해14/14 통과. root-mapped namespace이며 일반 UID의 permission proof가 아니다 |

metadata helper는 공개 getattrlist의 flags와 extended-security 전체 필요 크기를 관측한다.
ACL payload를 할당/해석하지 않고 xattr·BSD flag·ACL 보존 판정은 기존 TS owner에 남긴다.
Darwin 확인 전인 수리이며 정상 empty·symlink·BSD flag·nonempty/empty ACL 회귀를 다음 CI에서 함께 실행한다.

Loader 수리는 [고정 upstream의 literal-root 예외](https://github.com/anthropics/sandbox-runtime/blob/98a4016d27609ed34dd1fb43d23ed6efb6eeeb77/src/sandbox/macos-sandbox-utils.ts#L913)와
[원문190](https://github.com/anthropic-experimental/sandbox-runtime/issues/190)을 대조했다.
literal `/`의 읽기만 허용해 root dirent 이름이 보이며 subtree read/exec는 허용하지 않는다.
실제 profile 실행은 다음 CI로 검증한다. SDK-declared libproc FD pruning은 이미 별도 control에서 통과했다.
SDK26.5 `libproc.h:41–44`는 인터페이스를 private·향후 변경 가능으로 명시한다. stable public API라고
분류하지 않으며, 선언된 record만 사용하고 실제 지원 OS별 회귀를 지원 조건으로 둔다.

DR63은 SELECT들을 yield 전에 캡처한 뒤 full-row/lineage 검증을 나누고, 게시 owner가 projection을
join한 뒤 draining을 확인한다. 새 batch와 이전 delivery를 섞지 않는 회귀 및 projection 중 shutdown이
Store를 먼저 닫거나 status 파일을 재생성하지 않는 회귀가 통과했다. wire·durable 형식과 budget은 그대로다.

### 2026-10-28 독립 descriptor leaf와 파일 도구 전환

`@oma/file-descriptors`로 기존 mkdirat/unlinkat/directory cursor를 옮기고 모든 caller를
이관했다. 단일 leaf의 openat+no-follow와 별도 directory cursor를 제공하며 Node/Koffi 외
업무 의존성이 없다. tool-files의 가짜 directory FD pathname과 native의 obsolete entryAt
export를 제거했다. snapshot 정책과 link를 따라가지 않는 정리는 기존 TS owner에 남겼다.

Broad native import 허용은 transitive domain/metadata까지 평가하므로 채택하지 않았다.
실제 leaf closure의 우회 import·re-export·숨은 runtime 의존성을 검사하며 manifest·DAG·
독립 설치·deployment layout을 함께 갱신했다(DR62/NATIVE-026).

실제 Linux UID1000 smoke에서 비ASCII directory·binary write/read·root rename/replacement
뒤 held bytes·snapshot 제거·외부 planted-link 대상 보존을 관측했다. 관련 파일/hashline/
generation cleanup/publication/native OS 시험55/55, 전체 contained-tools30/30 PASS다.
분리 중 추가한 filename U+FEFF 반례는 수정 전 손실로 FAIL했고, strict/BOM-preserving
decoder 수리·재빌드 후 같은 반례1/1 PASS다. 후속 boundary/closure 시험36/36와 module·
architecture rules·문서·규범 inventory 검사는 PASS다. 실제 Darwin과 전체 회귀 결과는 별도다.

후속 tarball 독립 설치는27/27 workspace의 공개 API·자체 declaration·지정 runtime smoke가
PASS다. tool-files의 workspace closure는 자신과 file-descriptors뿐이며 native/domain/metadata
helper를 설치하지 않는다. 외부 SDK declaration 진단44개는 자체 오류와 별도로 기록됐다.

실제 공개 CI 입력 `7d81b4f2`의 Mac26/15는 각각247/248 PASS·1 FAIL·skip0이다.
새 file 도구·snapshot·root replacement·cursor/BOM·hashline 경로는 두 OS에서 통과했고,
실패는 empty ACL의 NO_INHERIT flag가 있는 directory의 metadata 거절이었다. 당시에는 helper
누락과 fixture persistence를 구분하지 못했으며, 기대값을 낮추거나 directory 전체를 거절하지 않았다.
그 입력에서 Mac packed install은 이 실패 때문에 실행되지 않았다.

Ubuntu 확대431개는430 PASS·1 FAIL이며 pending620 status의 event-loop 지연74ms가50ms
예산을 넘었다. 별도 target Node26 선택30/30은 PASS이나 전체 실패를 대체하지 않는다.
원시 artifact와 SHA256 확인은 native-2026-10-28-descriptor-leaf 아래에 보존했다.
Darwin kept-FD 반례는 posix_spawn에서 EBADF, Seatbelt 파일 시나리오는 SIGABRT였다.
당시 새 후보는 단일-thread 확인·SDK-declared PROC_PIDLISTFDS inventory·미허용 FD close·직접 execve였고
실제 Mac 검증 전이었다. direct child/FD 정리는 complete descendant scope의 대체가 아니다.

Architecture CI는 설치 전 source-digest가 TypeScript를 import하여 중단됐다. 깨끗한 checkout의
같은 실패와 locked npm ci 뒤 같은 digest 명령의 성공을 확인하고 설치→source binding→generator
순서로 고쳤다. source hash 기준이나 실패 판정을 완화하지 않는다.

후속 공개 입력 `562548397`(Native `40577594097`)에서 SDK 빌드와 독립 C FD control은 통과했다.
same-PID·CLOEXEC stdio·명시 채널·낮춘 hard limit 위 FD64의 제거까지 실제 관측했지만,
Seatbelt 적용 뒤 C actor/Node의 SIGABRT는 남았다. 새 FD leaf 성공과 sandbox target 성공을 구분하며
OS crash report를 다음 artifact에 수집한다. 세 gate는 계속 OPEN이다.

Mac26 공통 시험은 진단에서 BigInt를 JSON 직렬화한 오류로245/248이다. 이 계측 오류는 inspect로
수리했지만 ACL persistence 결과는 아직 얻지 못했다. 독립 설치는 별도 실행되어 Broker smoke의
Linux 전용 Unix credential 준비가 Mac에서 실패했다. 검사기는 하나의 실패로 다른 workspace의
실행을 생략하지 않고 전체 결과를 출력한 뒤 실패하도록 고쳤고, Linux27/27이 통과했다.
Broker smoke는 요청을 받지 않는 listener/lock/drain 시험인데 Linux credential 설정까지 주입하고
있었다. 불필요한 OS 가정을 제거했으며 실제 credential 시험과 제품의 인증 owner는 그대로다.


### 2026-10-28 Runner admission 회귀 수리

Broker composition이 `BrokerUnits.scopeRoot()`의 `{pid, startTime}`을 전체
`ExecutionWitness`로 다시 해석해 유효한 Linux root를 `null`로 바꿨다. 실제 private
channel의 `runner.open`이 `AUTH_FAILED`로 거절되는 것을 확인하고 중복 projection을
제거했다. 같은 handshake에서 `ok: true`·incarnation 증가·종료 코드0을 확인했으며,
기존 `connection-bounds`의 실제 actor socket flood·해제 후 응답 시험도1/1 PASS다.
`npm run build`는 통과했다. 실행은 pinned bwrap을 mount한 임시 user/mount namespace
안에서 했으며 전체 회귀·일반 사용자 파일 권한·Darwin qualification의 증거는 아니다.

같은 전환에서 두 descriptor adapter가 Linux 경로를 `/proc/self/fd`가 아닌
`/proc/fd`로 만들던 회귀도 확인했다. 실제 held inode 읽기와 tool write가 모두
ENOENT로 실패했고, 경로 복구 후 pathname 교체에도 원래 bytes를 읽고 contained
write/read가 성공했다. 재빌드와 선택60개 시험이 PASS·skip0이다.

기존 CI run `40548845744`의 macOS15 원시 artifact를 공개
[artifact 경로](https://nightly.link/minjung2035/oma-v2-ci/actions/runs/40548845744)에서
확보했다. runtime218/247 PASS·29 FAIL, gate99회 실행 중39회 OBSERVED·60회
SETUP_FAILED이며 세 gate 모두 OPEN이다. `/dev/fd` duplicate는 cursor를 공유했고
그 경로의 executable 실행은 errno13으로 거절됐다. 이 결과는 현재 Darwin reopen을
독립 cursor로, descriptor 경로를 exact executable로 취급할 근거가 아니다.
metadata fixture는 canonical temp root를 사용하도록 고쳤고 production의 no-link
검사는 유지했다. obsolete workflow 문자열 비교 시험은 삭제했으며 실패 원문은
`/home/dev/oma-audit-artifacts/native-2026-10-28-recovered-ci`에 보존했다.

### 2026-10-26 전체 CI 결과와 완료된 mutation의 응답 경계

`5e369b30`의 전체 baseline/native-all 각각3777/3777·skip0을 실제 artifact에서 확인했다.
앞선 EAGAIN1건과 strict mixed-lag 실패도 보존하며 뒤의 성공으로 원인을 해결했다고 하지 않는다.
기존 PublicDispatcher에서 효과/view 갱신 뒤 답변 전에 event-loop turn을 반환하고,
그 사이 admission이 닫혀도 accepted plan/result는 그대로 답한다(DR58/NATIVE-021).
새2개는 수정 전 실패했고 수정 뒤 기존6개와 합쳐8/8 PASS다. 추가 OS branch나 queue,
durability 생략, 지연 기준 완화는 없으며 전체 후속 입력은 별도 재검증한다.

### 2026-10-26 다른 저장소의 실제 구현 대조

사용자 지시에 따라 sandbox-runtime·Codex·Gemini CLI·Chromium의 고정 source를
[대조했다](native-reference-review.md). 공통 정책/OS adapter 분리와 Chromium의 Mach
rendezvous·kernel trailer 검증을 후보에 적용한다. 기존 실제 timeout을 지우거나 group kill을
전체 scope 사망으로 완화하지 않는다. 새 CI가 실행 전에 종료된 경우도 NOT_RUN으로 남긴다.

### 2026-10-26 status 게시 owner와 Darwin 인증 후보 확대

네 mutation hint가 같은 status를 네 번 영속 게시하던 실제 반례를 재현했다. Broker가
기존 process의 CoalescedWake를 재사용해 게시 작업 하나와 후속 hint 하나를 소유하고,
활성 게시를 drain한 뒤 Store를 닫는다. DR57/NATIVE-020이 그 수명과 owner를 소유한다.
후속 실제 Linux 선택46개 파일 **430/430 PASS**, skip/cancel/todo0·input 전후 동일이다.
이는 전체 Linux suite나 Darwin 제품 qualification의 대체 결과가 아니다.

Darwin 인증의 별도 후보로 Mach 메시지의 SDK audit trailer를 시험한다. 두 sibling sender가
같은 상속 send right에 순서대로 요청을 미리 넣고, 두 번째 body는 첫 sender의 PID를 주장한다.
수신자는 body가 아닌 kernel trailer를 각 메시지에서 얻는다. sender 둘이 살아 있는 경우와
모두 실제 waitpid로 join된 뒤 읽는 경우를 각각3회 실행한다. 후자는 queued identity와 현재
liveness가 다르다는 경계도 확인한다. [고정 XNU의 상속 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/ipc_tt.c#L2168)과
[SDK trailer 정의](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/mach/message.h#L730)를
조사 기준으로 사용하며 실제 runner kernel과 같다고 가정하지 않는다. 이 후보는 실제 CI
실행 전이고 제품 transport·live pin·scope membership·PID 재사용 증명이 아니므로 G-AUTH는 OPEN이다.
후보의 compile/실행 실패도 기존15개 관측을 지우지 않도록 독립 기록한다.

Coalition도 [고정 syscall source](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/sys_coalition.c#L215)와
[종료 요청 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/coalition.c#L2179)을
대조했다. 해당 source는 privileged coalition 소속을 요구하며 종료 요청은 active count에 따른
종료 통지이지 member 전체 kill/후손 생성 fence가 아니다. source 검토는 현재 Darwin 실행 증명이
아니며, private API/root daemon을 제품의 숨은 의존성으로 추가하거나 G-PROCESS를 닫지 않는다.

### 2026-10-26 전체 회귀와 credential 경계 수리

전체 local3760개 중3759 PASS·1 FAIL·skip0을 확인했다. 남은 시험명 참조를 고친 뒤 실제
설치 prefix의 Personal PTY16개·Keychain real socket15개·소유권 정책·Runner·durable registry의
70/70을 확인했다. input과 실패 원문은 validation을 따른다. 기존 ambient oma PTY 결과를 현재
checkout의 설치 proof로 사용하지 않으며, 실제 prefix 밖 checkout 읽기를 거절한다.

Keychain에서 raw malformed UTF-8가 대체 문자로 수락되는 결함을 실제 socketpair로 재현했다.
공통 strict JSON/UTF-8 owner를 사용하고 VM operation/event·느슨한 옵션을 제거했다. 미사용
AuthContext.cgroup은 현재 source와 fixture에서 삭제했다. 현재 권한은 여전히 native pin과 매 요청
재검사로 판정하며 accepted/receipt/status wire의 뜻은 바꾸지 않는다. DR56과 NATIVE-018/019,
source owner가 현재 물리 순서와 credential 경계를 소유한다. 새/변경 코드는 NOT_REVIEWED다.

추가 G-AUTH 후보인 LOCAL_PEERTOKEN도 조사했다. [Apple XNU의 고정 source](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/uipc_usrreq.c#L900)는 이 token도 peer socket의 last_pid로 조회한다.
이는 구현 source의 관측이며 현재 CI kernel에서의 실행 증명은 아니다. queued-transfer probe가
첫 요청 byte를 읽기 전후의 raw SDK token과 errno/size를 기록하도록 확대했으며 실제 Mac CI로
확인한다. 이 후보나 Linux 통과로 G-AUTH를 닫지 않는다.

### 2026-10-26 전체 시험 실행부 전환

남은 audit/phase4의 실제 namespace·private channel·entry 경로를 연결하고 root strict/type DAG
진단을0으로 복구했다. 실제 CI44개 파일386/386과 Mac/Linux 공통58/58을 확인했다.
정책 전용 fixture와 실제 kernel/Worker/Pi 증거의 범위는 계속 분리한다.

현재 후속 작업은 전체 회귀 실행부다. local discovery가 native 실행 시험을 더 이상 제외하지
않으며 required file 삭제는 실패다. manager opt-in·unit cleanup·vsock CI 준비를 폐기하고
공통 Linux CI 설치 스크립트에 pinned bwrap·도구·변경 없는 global userns 제한 관측을 모았다.
전체 native-all job이 실제 kernel/crash 파일과 필수 oracle을 포함하도록 결박한다.
실행하지 않은 standalone wrapper를 실행한 것으로 표시하지 않는다. 이 후속 실행부 변경의
실제 전체 build/static/runtime/CI 재검증은 진행 중이다.

전체 정적 검사가 잡은 private UTF-8 decoder 세 곳은 공개 `@oma/domain/utf8` owner를
사용하도록 연결했다. candidate setup의 기존 decoder가 BOM을 지워 exec를 허가하던
실제 반례를 보존했고, BOM 거절·오류 poison·허가0을 회귀와 parser corpus에 추가했다.
journal/log의 canonical bytes·형식은 그대로다. Worker spawn의 owner map은 현재 세
경계(portable private pipe, Linux argv/seccomp, App Resident composition)를 정확히
가리킨다. host state FD를 Worker에 넘기지 않으며 outer journaled namespace의 실제
종료를 요구한다. 새 unfenced helper caller를 거절하는 정적 규칙과 negative control도 둔다.

Durable boundary 전수 검사에서 옛 unit owner/checkpoint와 미등록 native publication을 발견했다.
현재 registry는 create-execution checkpoint와 실제 journal 초기화 SIGKILL·candidate checkout
SIGKILL·quarantine 재검증/import를 가리키며, 논리 재시도를 SIGKILL로 표시하지 않는다.
초기 관련 실행72개 중2개 실패를 보존했다. 초기 journal 게시와 writer-lock 획득은 다른
시점이므로 아직 획득하지 않은 lock을 주장하던 시험을 바로잡았다. 실제 quarantine은
bwrap의 data FD 소비로 borrowed bundle cursor가 EOF가 되어 같은 FD 재시도가 실패했다.
공통 Git owner가 기존 native primitive로 같은 inode의 독립 cursor를 소유/반환하도록 고쳤고,
진행한 caller cursor와 교체된 pathname에서도 원래 accepted bytes를 사용하는 시험으로 검증한다.

### 2026-10-26 전체 회귀 전환 후속

미사용 domain cgroup parser/export를 제거하고 systemd parser fuzz를 현재 CandidateSetupStatus의
fragmentation·fatal decode·오류/EOF poison oracle로 교체했다. 불완전한 EOF 후 준비 frame을
다시 넣으면 final exec 권한이 열리던 반례를 재현·수리했다. 첫 오류와 EOF 실패는 같은 owner에
남고 후속 write/finish로 성공을 만들지 못한다.

Principal과 실제 실행 이력이 없는 recovered empty Resident slot은 종료 코드0의 실행으로
표시하지 않는다. 공통 process owner의 status projection과 App 역할 projection이 각각 맡는다.
서로 독립된 실제 namespace owner에서 같은 actor를 시작·중지하는 격리 시험을 추가했다.

CLI·audit2의 기존 요청 키/stream/schema/receipt 단언은 실제 namespace PID2 test driver,
private socketpair와 kernel peer/descent 경로에 연결했다. 테스트 driver는 제품 Worker/Pi의
대체 qualification이 아니며 해당 제품 시험은 별도 실제 시나리오다. 기존 phase5 candidate의
network·옛 cap 초과·owner/request 취소는 실제 scope/journal로 전환했고 전체 namespace 죽음과
원래 오류를 모두 검증한다. 정책 전용 시험은 native pin/권한/죽음 증거를 만들지 않는다.

선택 native integration은42개 시험 파일로 확대했다. 이 목록의 PASS와 root 전체 회귀는
별개다. 현재 audit/phase4의 옛 물리 시험 전환·전체 정적/회귀·최종 설치 대조가 남았다.
원문/기존 ID는 archive에 보존하며 고정 architecture와 authored review bytes는 변경하지 않는다.

### 2026-10-26 직접 실행 연결

공통 `ExecutionCoordinator`가 durable opening→blocked namespace witness flush→현재 권한→
gate release→직접 child close와 전체 namespace 사망→journal retire를 소유한다.
Resident는 공통 `ResidentRuntime`과 private socketpair를 사용하고 Linux leaf는 실제 PID2 child를
따로 pin한다. 공개 byte stream은 각 recvmsg sender를 still-pinned connector와 비교한다.
systemd/path/journald·host relay의 production 소스와 자산은 제거했다. 과거 원본은 archive에
있으며 runtime fallback이나 새 source의 PASS가 아니다. accepted create v3·역사 v2의 구분은 DR52다.

Candidate는 실제 read-only canonical mount에서 정확한 checkout을 만들고 같은 trusted child를
check argv로 exec한다. setup 상태는 exec에서 닫히는 private FD로만 분류한다. quarantine은
공통 TS로 verify 후 전체 scope 사망을 확인하고, 별도 import sandbox에만 canonical RW를 준다.
첫 실제 시험의 `/quarantine` mount target 누락과 Worker private argv의 NUL 검증 누락을
재현·수정했으며 실패 원시 로그도 보존했다.

SIGKILL at opening/witness/effect/retire 경계를 실제 시험했다. witness 직후 init 생존 반례를
DR54의 새 capability 복구로 수정했다. witness 없는 opening은 command를 재생하거나 빈
목록으로 바꾸지 않으며 journal과 증거를 남긴다. 이 잔여 unknown과 기존 Linux state의 누락
journal, historical v2 미완료 unit intent는 지원 완료로 숨기지 않는다.

Resident/Broker/Pi 통합은 실제 Native owner·전용 runner channel·candidate/quarantine으로
연결했다. 시나리오의 가짜 unit 관측·수동 runner spawn은 제거했다. 자동 생성의 첫 실행도
같은 owner를 사용하며 host 환경·내부 tool plan은 owner 생성 때 명시적으로 결박한다.
실제 시험에서 pre-run incarnation으로 stop하던 fixture와 scope 사망 뒤 diagnostic close를
기다리지 않던 수명 경합을 확인했다. 공통 Resident close가 모든 slot과 diagnostic completion을
join하고 새 start를 영구 거절하도록 수정했으며 App의 Native lifetime에 연결했다.
실제 시나리오·crash·정책 시험의 입력별 결과는 validation이 소유한다. 기존 root 시험의 제거된
API 참조 전환, 전체 Linux 회귀, 최종 owner/규범/격리 설치 검증은 진행 중이다.
P4 Darwin 제품 집행과 G-PROCESS/G-FILES/G-AUTH는 계속 미해결이다.

`test/native-integration/tsconfig.json`은 전환한 시험만 strict/noEmitOnError로 컴파일하는
선택 목록이다. `scripts/test-native-integration.mjs`는 같은 목록에서 실행 파일을 도출한다.
Linux CI의 실제 제품·SIGKILL 회귀 범위이며 root 전체 typecheck/회귀의 대체 판정이 아니다.
과거 systemd의 boot-unit/create-unit 경계 ID는 재사용하지 않고 원문을 archive에 보존했다.
현재 crash 시험은 boot-execution/create-execution과 실제 파일 게시·Git import 경계를 사용한다.

기존 변경은 `/home/dev/oma-audit-artifacts/native-2026-10-25/initial.patch`와
`initial-untracked/`에 보존했다. 작업 브랜치는 `work/macos-native-20261025`이며
master 병합·배포는 하지 않는다. 실제 실행 결과의 정본은 validation이다.

### 실제 연결된 공통 코드

- P2: `native/posix-files.ts`의 mkdirat/unlinkat/renameat/linkat를 기존 storage 게시,
  config generation 게시, package staging/수거 owner가 사용한다. 정책과 flush 순서는
  원래 TS owner에 남긴다. Darwin의 openat beneath/no-follow는 실제 kernel이 받는
  flags를 사용하며, 검증되지 않은 permission-independent pin/reopen은 효과 전에 거절한다.
- P3: broker의 ancestry/reuse 판정은 하나이며 `/proc`와 libproc 관측만 native leaf로
  분리했다. broker supervisor의 기존 monotonic window·backoff를 process package의
  RestartPolicy가 담당한다. 이 자체로 systemd 실행 관리의 전환이 끝난 것은 아니다.
- P5의 독립 작업: Restic dump는 storage의 Restic 검증 owner가 streaming hash·PAX·link·
  entry coverage·EOF를 검증한다. App은 storage API를 호출하는 조립만 맡고 GNU tar와 inline child script를 제거한다. JSON inventory가
  정확한 nanosecond metadata와 원본 inode 관계를 별도로 검증하며 source 재관측,
  checkpoint 게시, cold commit, 회수, restore 순서는 유지한다. 관측용 content hash/link/inode는
  메모리에만 추가하며 durable checkpoint 형식·digest 정의는 바꾸지 않는다.

P4의 Darwin 실행과 P6 제품 지원은 gate가 해결되기 전 완료로 판정하지 않는다.
P2의 entry pin/reopen, P3의 Resident wake·로그·backoff 전체 연결, P5의 quarantine/checker/설치, P6의 제품 실행 연결,
P7의 최종 owner/규범 대조는 별도 잔여 작업이다. 공통 코드의 시험 성공을 해당 전체 단계의
완료로 승격하지 않는다.

VM-only App host/guest·entry·VZ·guest 자산·protocol은 실행 소스에서 제거했다. 과거 시험은
원문을 archive에 보존하고 native PASS에 합산하지 않는다. Keychain은 VM framework 없는
독립 primitive로 분리했으며 Darwin 컴파일과 signed release 실행은 각각 별도 검증이다.
Restic child/FD 수명은 process, tar/inventory/tool 파일 검증은 storage, App은 두 API의
조립을 맡는다. storage→process 의존을 추가하지 않고 dump callback으로 연결한다.

이 checkpoint의 Linux 실제 Restic·durable fault 회귀는 27/27 통과했다. production 그래프
472 files에서 runtime/type union 순환·unresolved import는 모두 0개이며 모듈 경계 위반
negative control 3/3을 통과했다. 전체 회귀와 최종 source-bound qualification은 아직 남았다.

### 최초 Darwin 실행

원본 `d80035f701227bca5ee884b0a83f1dea14a403aa`,
[CI 40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898).
macOS 26 arm64(SDK 26.5)와 macOS 15 arm64(SDK 15.5), Node 26.0.0에서 실제 실행했다.
양 OS 모두 NOTE_TRACK=ENOTSUP(45), setsid 후손이 group kill 후 생존,
mode-000 event pin=EACCES(13)을 관측했다. directory flock·directory fsync·linkat
no-replace는 성공했으나 G-FILES 전체 통과가 아니다. peer PID의 fork 상속 관측은
연결/현재 소유자의 구분을 추가 검증할 입력이며 socket transfer 방어의 증명이 아니다.
gate job은 exit 1/BLOCKED이고 artifact를 보존했다. 최초 held-root probe는 mode-000
실패가 뒤 관측에 영향을 줬으므로 다음 실행에서 namespace 관측과 분리한다.

### 공통 조정과 실제 Darwin 회귀

`13d60492`에서 Resident start/stop 순서는 `process/resident-supervisor`가 소유하고
Linux UnitsModule이 이 구현을 실제 호출한다. status·command 완료와 독립 scope death proof를
분리하며 stop 중 한 단계 실패 뒤에도 revoke·terminate·사망 관측을 시도하고 오류를 보존한다.
Linux 관련 회귀 92/92를 통과했다. systemd adapter는 이행 중 reference이며 manager 제거·
공통 wake/log·직접 sandbox scope 연결이 남았다.

[CI 40202613809](https://github.com/minjung2035/oma-v2/actions/runs/40202613809)의 실제
macOS 26/15 arm64에서 common-runtime 각각 20/20, Ubuntu에서 19/19를 통과했다.
같은 source의 별도 Darwin gate job은 OPEN/BLOCKED이며 통과로 합산하지 않는다.
이 CI로 openat 가변 인자·64-bit dirent ABI 결함을 수정·검증했고 SDK layout을 assert했다.
archive verifier 성공은 실제 macOS Restic round trip 또는 G-FILES 전체의 증거가 아니다.

`0d471551`의 [CI 40202936879](https://github.com/minjung2035/oma-v2/actions/runs/40202936879)는
connector와 형제 process인 holder에 SCM_RIGHTS로 socket을 전달했다. 실제 holder 메시지 뒤
peer PID는 connector 생존·종료 양쪽에서 holder를 가리켰다. common-runtime 결과는 이전과
같고 별도 gate는 BLOCKED다. PID 재사용·동시 인계/버퍼 메시지까지 검증하지 않았으므로
G-AUTH를 닫지 않는다.

### 전체 회귀의 첫 실패와 수리

입력을 고정한 첫 전체 local은 52개 실패·70개 skip으로 끝났다. 원시 로그와 입력은
validation에 보존했다. VM-only 시험·PTY·이미지 서명 도구는 실행 대상에서 제거하고
원문을 archive에 보존했다. 유지되는 시험은 실제 native syscall에 fault를 주입하고,
package 목록의 관측 실패는 기존 filesystem port로 검증한다. metadata 손상 수리·원본
보존·primary/cleanup 오류 보존 oracle을 유지한다. 모듈 허용 경계는 확장하지 않았다.

Linux PID namespace의 별도 물리 probe는 setup 실패로 끝났으며 scope proof로 사용하지
않는다. runner/namespace-init/launcher 종료와 재시작 후 fence의 실제 연결은 미완료다.

위 probe의 mount setup을 고친 별도 실행은 Linux 6.12.111·bwrap 0.12.0에서 runner,
namespace init, launcher SIGKILL의 세 경우를 관측했다. setsid·double fork·FD 폐기 후손을
포함해 pin한 process 세 개가 모두 종료했고 init pidfd readiness 뒤 후손 생존은 관측되지
않았다. 원본 `linux-namespace-probe/result-v3.json`은 artifact 디렉터리에 있다.
이는 재시작·fence·권한 연결을 증명하지 않으며 G-PROCESS를 닫지 않는다.

`982658de`의 전체 local은 3640/3640 PASS·skip0·입력 변경0으로 끝났다. 이후 P2 변경은
mailbox·context·spool·cache·package·provision·deployment·Git 준비의 상위 proc 경로를
directory-relative API로 치환한다. nanosecond stat·symlink raw bytes와 게시/flush/cleanup
순서를 보존하며, Darwin의 미검증 pin·attribute 관측은 효과 전에 거절한다. 이것만으로
P2나 Darwin filesystem qualification 완료를 주장하지 않는다.

현재 모듈 경계의 해석은 DR50/NATIVE-008을 따른다. 25개를 고정 개수로 두지 않으며,
새 독립 책임은 새 workspace로 분리할 수 있다. 위 파일 handle 연결은 기존
native/storage/config/Git/App owner에서 수행했다.

다음 P2 작업은 engine-hosted 파일 정책을 SDK 연결에서 분리한다. 26번째 workspace인
`@oma/tool-files`는 Node built-in만 사용하며 containment·inode·hard-link·snapshot 정책을
하나의 TS owner에서 유지한다. 기존 tool-runtime·hashline·LSP 호출자를 공개 API로 연결하고
tool-runtime의 이전 contained-files 소스·export는 제거한다. Linux descriptor 경로는 작은
private leaf에 모으며 Darwin은 효과 전에 거절한다. 이 분리는 G-FILES 해결이나 Darwin
파일 도구 지원이 아니다. workspace graph·독립 설치·기존 도구 회귀 결과는 validation에 기록한다.
이 변경의 Linux 정식 build·strict typecheck·architecture는 통과했다. 관련189/189·별도 SIGKILL17/17과
독립 설치26/26은 같은 입력을 유지했다. 새 모듈의 의존 closure는 자기 자신뿐이고 SDK 진단은0개다.
기존 SDK 소비 모듈의 외부 declaration 진단44개는 별도로 보존하며 authored declaration 성공과 구분한다.

`8c9ef61d`의 고정 입력 P2 회귀는 192/192, workspace 독립 설치는 25/25 통과했다.
[CI 40207646347](https://github.com/minjung2035/oma-v2/actions/runs/40207646347)의 공통 runtime은
Mac 26/15 각각 21/21·Ubuntu 20/20이며 동일한 verification input digest를 기록했다.
별도 gate는 계속 BLOCKED다. queuedTransfer probe에서 인계 전에 connector가 보낸 첫
바이트를 읽기 전·후 모두 LOCAL_PEERPID는 holder였고 두 process는 살아 있었다.
last endpoint PID는 queued request의 sender proof가 아니다. 이는 G-AUTH의 실제 반례이며
auth 정책을 UID/PID-only로 완화하지 않는다. 이후 CLI context의 directory/entry 접근도
native handle API로 연결하며 이 변경의 시험은 앞 결과와 구분한다.

### P3의 commit hint와 공통 wake 수명

`CoalescedWake`는 process의 공통 TS owner다. 활성 callback 하나·pending bit 하나만
유지하며 callback은 생성 owner의 async context에서 실행한다. Reconcile 안에서 발생한
hint가 그 recovery context를 빌려 자기 sweep을 await하는 일을 막는다. 실패는 그대로
caller에게 반환하고, close는 대기 hint를 취소하며 이미 활성인 callback을 종료 proof로
취급하지 않는다.

materialized 0→1 여부는 기존 storage transition owner가 판정하고 transient boolean으로
반환한다. SQL·첫 확정 시각·durable 형식은 바꾸지 않는다. App Mail ledger adapter는 원장을
독립 조회하지 않고 captured T의 반환값으로 수신자만 모아 COMMIT 뒤
Broker.hintWork로 연결한다. rollback·terminal same-key·이미 materialized된 행의 재확인은
새 hint를 만들지 않는다. Broker는 주기 timer와 hint를 같은 coalescer에 연결하며 drain이
활성 task를 기다린다. 실행 권한/desired/GOAL/incarnation/원장·Maildir 판정은 기존 Reconcile
owner에 남는다. inactive status 외에 confirmDead가 필요하며 unknown이면 실행하지 않는다.
이는 P3의 실제 연결이며 직접 sandbox scope·공통 로그·Resident backoff 전체는 아직 남았다.

CLI context의 held-root 교체 회귀를 포함한 관련50/50과 wake/captured T/authority 관련127/127,
실제 Mail→살아 있는 Broker hint 연결을 포함한30/30을 통과했다. 서로 다른 부분 실행이며
현재 입력의 전체 회귀·독립 설치·실제 Mac 결과는 별도로 다시 확인한다. 이전 partial 입력의
독립 설치 결과를 마지막 storage transient 반환값 변경의 검증으로 재사용하지 않는다.

`663adda3`의 [CI 40210726412](https://github.com/minjung2035/oma-v2/actions/runs/40210726412)는
Mac 26/15 각각28/28·Ubuntu27/27, 최종 production 입력의 독립 workspace 설치25/25를
통과했다. 별도 gate는 BLOCKED다. 전체 local은 입력 변경0으로 끝났으나 오래된 Node FS
함수의 fault/checkpoint가 native 경로를 놓친4건이 실패했다. 실제 public mailbox move 직후,
exact-inode cleanup reopen, 생성된 tree의 held-parent close로 옮긴 관련35/35를 통과했다.
실제 SIGKILL·flush 순서·primary/cleanup 오류·잔존 object·lease/FD 회수 oracle을 유지했다.

### Linux 직접 실행의 별도 물리 실험

`linux-scope-recovery-probe/`는 아직 제품 형식이나 실행 backend가 아니다. 기록 게시 전
차단·게시 뒤 차단·실행 뒤 owner/runner SIGKILL을 별도 실험했고 관측한 pin은 모두 종료했다.
단순 block pipe는 writer EOF에서 release byte 없이도 효과를 냈다(`eof-result.json`).
namespace init이 writer를 함께 보유한 대조에서는 같은 EOF에 효과가 없었고, owned init
종료 뒤에도 효과가 없었다. 앞선 fixture가 writer를 두 대조 모두 상속시킨 무효 negative
control과 Unix socket path 길이 setup 실패도 원본을 보존했다. 임의 후손·재시작·auth 전체
qualification 또는 production journal 형식 채택으로 표시하지 않는다. 새 durable 형식을
도입한다면 명세 §11과 registry의 별도 결정을 먼저 따른다.

### OS 경계 시험 확대

`f042b159`의 전체 local은3660/3660·skip0·입력 변경0이고 실제 CI의 Mac26/15·Ubuntu는
각각30/30·build26/26이다. gate는 여전히 BLOCKED다. 사용자가 직접 Mac을 검증할 수 없으므로
`test/native-os-contracts.test.mjs`를 양 OS의 실제 파일/FD/잠금/process/socket 경계 시험으로
추가한다. mock으로 syscall을 대체하지 않으며 새 시험과 독립 Darwin 사례별3회 관측은
이전 전체 PASS와 분리한다. 다음 실행의 결과는 validation 및 raw artifact가 소유한다.

### 2026-10-27 구현 우선 후속

필수 전체 읽기와 DR59 VM 표시/history/relay/invocation 잔존 제거를 진행했다.
`@oma/native`에 Mach inline audit facts·단일 process event·public Security audit-origin leaf,
`@oma/platform-mac`에 audit-peer identity adapter를 추가했다. actor/capability 판단이나 전체
후손 종료 owner가 아니며, shared broker transport 연결과 실제 Darwin 실행은 미완료다.
최신 사용자 범위에 따라 runtime/CI 테스트는 우선 보류하고 타입·정적 검사를 진행한다.

Broker의 peer identity 획득도 필수 kernel port로 분리했다. 현재 Linux composition은 실제
SO_PEERCRED/SO_PEERPIDFD adapter를 주입하고, 공통 PeerAuthenticator는 reference 수명과
현재 actor/scope/capability 판정만 소유한다. kernel port 누락을 ambient Linux fallback으로
대신하지 않는다. Mac identity adapter의 transport 연결과 이 변경의 runtime 회귀는 미실행이다.

후속으로 Broker의 native credential 타입·socket 생성·endpoint 길이 검사를 OS composition으로
분리했다. Broker는 Duplex와 listener 수명 계약을 받고 actor/current grant·요청 ref 수명을
계속 소유한다. `sameSender`는 실제 kernel receive 객체와 원래 pin의 동일성만 대조한다.
Linux는 SO_PEERCRED 복사본을 message 증거로 쓰지 않으며, Mac 후보는 전체 audit token을
대조한다. 공개 BSM accessor로 opaque token을 해석하며 field 위치를 auth 계약으로 쓰지 않는다.

listener의 bind 성공 뒤 preparation 실패도 실제 close callback을 기다리도록 수정했다.
close가 throw하면 불명 상태를 pending으로 남기고 기존 drain grace가 이를 제한한다.
관련 실제 Unix listener 회귀 세 개는 작성했지만 runtime 시험은 NOT_RUN이다.

### Mach byte connector의 source 조립

후속으로 App의 Client/Broker connector 선택에 Mac rendezvous와 byte stream을 연결했다.
공통 PacketStream은 byte 경계·backpressure·인증한 EOF·실제 자원 반환을 소유하고, 기존
BrokerChannel은 connector readiness Promise를 같은 generation 수명으로 소유한다. Mac 이름/nonce는
발견과 응답 연결뿐이며 raw kernel token과 live peer pin의 대체가 아니다. COPY_SEND 실패 뒤
pseudo-receive로 돌아온 두 header reference를 반환하고, 실패한 close를 후속 no-op으로 지우지 않는다.

새 연결은 미검증 후보이며 product profile guard는 유지한다. 실제 Mach 과정·SDK/profile와
process/file gate는 남아 있다. Security validation의 sync I/O를 async/tracked owner로 옮기고
실제 latency도 검증해야 한다. 현재 native port golden의 의도한 변화만 갱신했으며 과거 golden,
public/durable DTO와 과거 authored review는 바꾸지 않았다.

### Darwin 실행기의 FD 전달 수정

Seatbelt 실행기에서 Darwin SDK에 없는 `closefrom` 사용을 발견해 공개 `posix_spawn`의
SETEXEC·CLOEXEC_DEFAULT와 명시 inherit action으로 바꿨다. FD 번호를 한도까지 훑지 않고
같은 PID에서 image를 교체한다. Linux의 kept-list 문법 시험과 Darwin의 실제 FD 상속 시험을
분리했으며 후자는 낮춘 soft/hard 한도 밖 FD, CLOEXEC 표준 stream·명시 channel, 빈 목록,
없는 channel·target, leak 대조군을 검사하도록 준비했다.

SDK snapshot 두 버전·CPU 두 종류의 교차 컴파일과 링크는 정적 검증이다. 실제 Darwin 실행과
G-PROCESS/G-FILES/G-AUTH 수용은 남아 있다. 제품 guard와 accepted data/receipt/auth 의미는
유지한다. 이번 수정의 입력과 시험 결과는 [검증 기록](validation.md)이 소유한다.

### Node의 POSIX group 실행 연결

공통 startProcess의 group 실행 leaf는 Node26이 제공하는 Linux·Darwin 경로를 사용한다.
자기 PID/group/session과 명시 FD를 관측하는 실제 host 시험을 공통 CI에 넣었다. 이는 직접
child의 실행·취소·close를 다루며 전체 후손 scope를 만들지 않는다. PreparationExecutor와
제품 Darwin guard를 이 변경으로 해제하지 않았다. 수용 범위와 미실행 항목은 검증 기록에 남긴다.

### Darwin의 directory-relative xattr leaf

보유한 directory FD를 고정 helper의 FD3으로 전달하고 그 child에서만 public fchdir와
no-follow listxattr를 실행한다. 내용 I/O를 위한 target open 없이 최종 symlink 자체를
관측하며 compression 속성도 포함한다. 보관 여부는 공통 TypeScript가 결정하고, 조회·실행·
출력 해석 실패는 빈 속성 목록으로 처리하지 않는다. helper는 이 metadata 조회 외의 실행이나
mutation을 하지 않는다. 빌드 recipe·source asset·설치 후 실행·공통 CI 시험까지 연결했다.

한 entry 관측은 pin·repair·동일 image 실행 결박을 대신하지 않는다. core native gate와
제품 Darwin guard는 유지하며 실제 Mac 실행은 NOT_RUN이다. SDK 정적 결과와 Linux 실제
시험의 입력은 검증 기록에 따로 남긴다. 전체 코드 복잡도 검토는 native 구현 완료 뒤에 한다.

### Darwin metadata의 ACL·BSD flags 보완

xattr-only helper와 API를 일반 metadata 관측으로 교체했다. 고정 child가 보유 directory
inode에서 public lstatx_np와 filesec_query_property로 최종 symlink 자체의 stat·ACL 존재를
읽고, 전체 BSD flags와 no-follow xattr-list 크기를 TS로 넘긴다. 공통 TS가 보존할 수 없는
metadata의 회수를 거절하며 hot 원본을 유지한다. 명시적 빈 ACL과 ACL flags도 거절한다.
이전 함수·binary 경로는 호환 wrapper로 남기지 않았다. durable DTO나 receipt는 바꾸지 않았다.

실제 Mac ACL·flag·resource-fork 사례는 CI용으로 준비했으며 NOT_RUN이다. SDK 정적 결과와
Linux archive/restore·원본 보존 회귀는 검증 기록에 입력별로 남긴다. exact file pin과 scope,
Broker authority gate는 여전히 열려 있고 제품 Darwin guard도 유지한다. 전체 코드 복잡도
정리는 native 구현·CI용 테스트 준비를 모두 마친 뒤에 진행한다.
