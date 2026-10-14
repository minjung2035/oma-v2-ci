# G05-sandbox-units-engine 적대적 검증 결과

branch `feat/macos-hidden-vm`, HEAD `070a52d`. 코드 수정·build·test·systemctl·sudo 없음.
재현 스크립트는 `review/adversarial-2026-09-28/repro/G05-sandbox-units-engine/` 아래에 두고 `dist/src/...`를 import해 실행했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 |
|---|---|---|---|
| src/sandbox.ts | 236 | 예 | 마지막 읽은 줄 236 `"integration checks ` (candidate() throw) |
| src/units.ts | 432 | 예 | 마지막 읽은 줄 432 `  }` (startLimitStatus 종료) |
| src/units/execute.ts | 49 | 예 | 마지막 읽은 줄 49 `}` (observeUnitCommand 종료) |
| src/units/observe.ts | 63 | 예 | 마지막 읽은 줄 63 `}` (parseCgroupProcs 종료) |
| src/units/render.ts | 68 | 예 | 마지막 읽은 줄 68 `}` (renderUnit 종료) |
| src/runtime/provision.ts | 471 | 예 | 마지막 읽은 줄 471 `}` (publishProjectBinding 종료) |
| src/runtime/resident-rootfs.ts | 226 | 예 | 마지막 읽은 줄 226 `}` (prepareResidentRootfs 종료) |
| src/runtime/vsock-seccomp.ts | 52 | 예 | 마지막 읽은 줄 52 `}` (vsockSeccompFilter 종료) |
| src/runtime/pi-spawn-plan.ts | 258 | 예 | 마지막 읽은 줄 258 `}` (planPiSpawn 종료) |
| src/runtime/pi-adapter.ts | 286 | 예 | 마지막 읽은 줄 286 `}` (PiAdapter 종료) |
| src/runtime/pi-rpc.ts | 307 | 예 | 마지막 읽은 줄 307 `}` (PiRpcClient 종료) |
| src/runtime/pi-runtime.ts | 121 | 예 | 마지막 읽은 줄 121 `}` (piIsolationEnv 종료) |
| src/runtime/assets.ts | 133 | 예 | 마지막 읽은 줄 133 `}` (launchedLocation 종료) |
| src/runtime/deployment-manifest.ts | 152 | 예 | 마지막 읽은 줄 152 `}` (assertDeploymentDigest 종료) |
| src/runtime/extension-integrity.ts | 72 | 예 | 마지막 읽은 줄 72 `}` (verifiedPaths 종료) |
| implementation/systemd/broker.service.in | 20 | 예 | 마지막 읽은 줄 20 `WantedBy=default.` |
| implementation/systemd/principal-relay.service.in | 16 | 예 | 마지막 읽은 줄 16 `StandardError=jour` |
| implementation/systemd/principal.path.in | 10 | 예 | 마지막 읽은 줄 10 `WantedBy=default.` |
| implementation/systemd/reconcile.service.in | 14 | 예 | 마지막 읽은 줄 14 `StandardError=jour` |
| implementation/systemd/reconcile.timer.in | 12 | 예 | 마지막 읽은 줄 12 `WantedBy=timers.t` |
| implementation/systemd/resident.path.in | 10 | 예 | 마지막 읽은 줄 10 `WantedBy=default.` |
| implementation/systemd/resident.service.in | 29 | 예 | 마지막 읽은 줄 29 `StandardError=jour` |

(줄 수는 `wc -l` 실측값. 참고로 읽은 의존 파일: src/protocol/jsonl.ts, src/process/async.ts 130–270, src/domain/identifiers.ts 1–55.)

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G05-01 | Medium | boundary | vsock seccomp 필터가 x32 ABI(AUDIT_ARCH_X86_64 + `__X32_SYSCALL_BIT`)의 socket()을 걸러내지 못한다 | confirmed(코드), high(도달성 조건부) |
| G05-02 | Low | boundary | renderUnit이 ExecStart에 들어가는 `@SOCIETY@`/`@AGENT@`의 `$`를 이중화하지 않는다(상류 식별자 검증에만 의존) | confirmed |
| G05-03 | Info | structural | seccomp 필터 바이트를 fd3에 쓰는 결정이 spawnSandboxed와 pi-adapter.deliver 두 곳에 독립 구현되어 있다(P0-2) | high |
| G05-04 | Info | authority/ownership | 소유자가 바뀐(foreign) unit 파일을 관측하면 confirmDead가 자식 사망을 "확정"으로 승격한다 — 방어적 판단이나 P0-5 경계에 있다 | medium |

## 3. 발견 상세

### G05-01 vsock seccomp 필터가 x32 ABI의 socket()을 걸러내지 못한다
- 심각도: Medium
- 분류: boundary
- 위반 규칙: (직접적 P0 위반 아님; MAC-205/D-5의 봉인 목표 약화)
- 코드 경로: `src/runtime/vsock-seccomp.ts:31`(arch JEQ) → `:34-35`(socket/socketpair nr JEQ) → `:38`(최종 ALLOW)
- 원인: 필터는 (1) `seccomp_data.arch == AUDIT_ARCH_X86_64(0xc000003e)`인지 확인하고, 아니면 모든 syscall을 EPERM으로 거부한다. (2) 통과하면 `nr`를 `socket=41`/`socketpair=53`와 정확히 비교해 AF_VSOCK만 막는다. 문제는 x32 ABI가 **같은** `AUDIT_ARCH_X86_64`를 보고하면서 syscall 번호에 `__X32_SYSCALL_BIT(0x40000000)`를 OR한다는 점이다. 즉 x32 `socket()`의 nr은 `0x40000029`이고, `:34`의 `JEQ 0x29(41)`와 `:35`의 `JEQ 0x35(53)`에 모두 실패해 최종 `SECCOMP_RET_ALLOW(:38)`로 떨어진다. 필터는 x32 socket() 호출을 검사 없이 허용한다.
- 영향: x32를 지원하도록 빌드된 커널(CONFIG_X86_X32_ABI)에서, sandbox 안의 프로그램이 x32 진입으로 `socket(AF_VSOCK, ...)`를 부르면 필터가 막지 못한다. vsock은 network namespace로 봉인되지 않으므로(모듈 주석 §MAC-205), 이는 sandbox의 유일한 vsock 방어가 우회되는 것이다. arm64에는 해당 없음.
- 최소 반례: x86_64/CONFIG_X86_X32 커널에서 `syscall(0x40000000|41 /*x32 socket*/, 40 /*AF_VSOCK*/, 1, 0)`. arch는 x86_64로 보고되어 `:31`을 통과, nr은 어느 JEQ에도 안 맞아 ALLOW.
- 재현 방법: `repro/G05-sandbox-units-engine/seccomp-x32.mjs` (실제 커널 syscall은 하지 않고 BPF 프로그램을 디코드해 분기를 증명). 출력:
  - `x32 socket() nr = X32_BIT|41 = 0x40000029 = 1073741865`
  - `=> an x32 socket() call falls through JEQ(socket) and JEQ(socketpair) to the final ALLOW.`
  실제 x32 syscall 실행은 커널 config 의존이라 하지 않음("추론+코드 확인").
- 확신도: confirmed(코드 분기), high(공격 도달성은 커널의 x32 지원과 x32 코드 실행 가능성에 조건부)
- 개선 방향: arch를 x86_64로 확정한 뒤 nr을 비교하기 전에 `nr & __X32_SYSCALL_BIT`를 확인해, x32 socket/socketpair도 같은 vsock 검사로 보내거나(비교 전에 비트 마스킹), x32 진입 전체를 거부한다(다른 ABI를 거부하듯). 표준 seccomp 지침(x32 우회 방지)과 같은 처리.

### G05-02 renderUnit이 ExecStart의 `$`를 SOCIETY/AGENT에서 이중화하지 않는다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음(상류 검증으로 막힘; P0-6 관점의 표현 결함)
- 코드 경로: `src/units/render.ts:33`(`ARGUMENT` 집합에 NODE/LIBDIR/CONFIG_ARG/STATE_ARG/RUN_ARG만 있음) → `:57`(`ARGUMENT.has(key) ? value.replaceAll("$", ...) : value`) → `:58-60`(문자 escape 정규식 `/[%\\\t "']/g`에 `$` 없음)
- 원인: 주석(`:29-31`)은 "ExecStart words are C-unescaped and `$`-expanded"라고 명시하고, 그래서 ARGUMENT 값의 `$`를 `$$`로 이중화한다. 그러나 `@SOCIETY@`·`@AGENT@`도 resident/broker/relay/reconcile의 ExecStart 줄(`--society @SOCIETY@`, `--agent @AGENT@`)에 들어가는데 `ARGUMENT` 집합에 없어 `$`가 이중화되지 않고, 문자 escape 목록에도 `$`가 없어 그대로 통과한다. 같은 "ExecStart word이므로 `$` 보호가 필요하다"는 결정이 어떤 placeholder에는 적용되고 어떤 것에는 빠졌다.
- 영향: 만약 society/agent 이름에 `$`가 들어올 수 있었다면 systemd가 `${VAR}`/`$X`를 환경변수로 확장해 ExecStart 인자가 바뀐다. 실제로는 `isValidSocietyName`/`isValidActorName`이 `^[a-z][a-z0-9-]{0,31}$`(identifiers.ts:14,39)로 `$`를 원천 차단하므로 **현재 도달 불가**. 방어가 render 층이 아니라 식별자 층 한 곳에만 있어 심층 방어가 아니다.
- 최소 반례: `renderUnit("ExecStart=x @SOCIETY@", {society:"a$b", ...})` → `"ExecStart=x a$b"` (이중화 안 됨). 대조로 `@LIBDIR@="/opt/o a"`는 `\x20`로 escape됨.
- 재현 방법: `repro/G05-sandbox-units-engine/render-dollar.mjs`, `render-inject.mjs`. 출력: `society raw: "ExecStart=x a$b"`, `dollar count: 1`. (개행/CR/NUL/공백/따옴표/%/tab/backslash는 모두 거부·escape됨을 render-inject.mjs가 확인.)
- 확신도: confirmed
- 개선 방향: ExecStart에 렌더링되는 placeholder(SOCIETY, AGENT 포함)를 하나의 "argument" 처리로 통합해 `$` 이중화와 문자 escape를 모두 받게 하거나, `$`를 공통 escape 정규식에 추가한다. render 층의 불변식이 caller 검증에 기대지 않도록.

### G05-03 seccomp 필터를 fd3에 쓰는 로직 중복 구현
- 심각도: Info
- 분류: structural
- 위반 규칙: P0-2(한 결정 = 한 owner)
- 코드 경로: `src/runtime/pi-adapter.ts:229-236`(child.stdio[3].on("error")+end(filter)) 와 `src/process/async.ts:255-260`(spawnSandboxed 안의 동일 코드)
- 원인: "sandbox 자식의 fd3에 filter 바이트를 흘려 넣고, bwrap가 그 끝을 닫아 생기는 error를 무시한다"는 같은 결정이 두 함수에 독립 구현되어 있다. pi-adapter.deliver는 전용 `spawnSandboxed`(argv[0]==="bwrap" 및 `--seccomp`↔filter 동반을 검증)를 쓰지 않고 `spawnOwnedRpc(..., filter!==undefined)`로 우회해, filter/`--seccomp` 동반 검증(async.ts:250-251)을 거치지 않는다. 현재는 planPiSpawn(pi-spawn-plan.ts:246, residentArgv가 항상 `--seccomp 3`을 넣음)이 둘을 동시에 만들어 실질 위험은 없다.
- 영향: 지금은 손상 없음. 그러나 filter 전달·검증이 두 owner로 갈라져, 한쪽만 고치면 drift가 생긴다.
- 재현 방법: 코드 대조만(추론).
- 확신도: high
- 개선 방향: 봉인된 engine spawn을 `spawnSandboxed` 한 경로로 모으거나, filter를 fd3에 쓰는 helper 하나를 두 spawn이 공유하게 한다.

### G05-04 foreign unit 관측이 confirmDead를 "사망 확정"으로 승격한다
- 심각도: Info
- 분류: authority/ownership
- 위반 규칙: P0-5 경계(관측 실패 아님; 관측 결과의 해석 문제)
- 코드 경로: `src/units.ts:335`(`observe`가 residentForeign이면 `NO_UNIT` 반환) → `:39` NO_UNIT=`{activeState:"inactive",...,execMainStatus:0}` → `:396-417` confirmDead가 이 NO_UNIT을 보고 cgroup 검사를 건너뛰고 `dead=true` 반환 → `:314-317` stop이 이를 신뢰
- 원인: P0V-59에 따라 unit 이름이 다른 소유자(state tree)의 것이면 "이 society의 unit이 아니다"로 보고 NO_UNIT(깨끗이 종료한 값)을 돌려준다. residentForeign은 unit 파일의 Description/X-OMA-Owner를 실제로 읽으며, 읽기 실패는 `unobserved`로 throw되어 unknown이 unknown으로 남는다(units.ts:224-227). 그러나 "unit 파일이 지금 foreign이다"라는 사실을 "이 society가 시작한 자식 프로세스가 죽었다"로 승격하는 것은, 같은 UID의 적이 이 society의 unit 파일을 덮어쓴 뒤라면 이전에 시작된 실제 resident 프로세스가 cgroup에 살아 있어도 사망으로 판정될 수 있다.
- 영향: 위협 모델(같은 UID의 적대 프로세스가 이 society의 unit을 덮어씀)은 상당 부분 범위 밖이고, incarnation guard가 별개로 존재한다. 정상 운영에서는 발생하지 않는다. 그래서 방어적 판단으로 본다.
- 최소 반례: (추론) resident가 시작되어 cgroup에 프로세스가 살아 있는 상태에서, 제3자가 `INSTALL_DIR`의 해당 service 파일을 다른 Description으로 덮어씀 → 이후 stop/confirmDead가 NO_UNIT 기반으로 dead=true.
- 재현 방법: 추론만(unit 파일 덮어쓰기와 살아있는 cgroup을 동시에 만드는 것은 systemd 환경이 필요해 이 검토 규칙상 실행하지 않음).
- 확신도: medium
- 개선 방향: foreign 판정 시 death를 확정하기 전에, 이전에 이 society가 기록한 incarnation의 cgroup이 여전히 살아있지 않은지 별도 관측으로 확인하거나, foreign을 "이 society 소유 아님"이라는 unknown-계열로 두어 사망 확정과 분리한다.

## 4. 리팩터링 필요 지점
- G05-03: 봉인 engine의 fd3 filter 전달을 단일 helper/단일 spawn 경로로 통합(P0-2).
- G05-02: render의 ExecStart placeholder escape 정책을 placeholder별 특수처리(ARGUMENT 집합 누락)가 아니라 "ExecStart word" 개념 하나로 통합(P0-6).

## 5. 점검했고 문제없다고 판단한 것 (공격했지만 막혀 있던 경로)
- **renderUnit 개행/CR/NUL 주입**: `render.ts:41-43`이 모든 값의 `[\0\r\n]`을 throw. `render-inject.mjs`로 society/state에 개행·CR 주입이 `INVALID_REQUEST`로 거부됨을 확인. 새 줄로 ExecStart/다른 지시자를 주입 불가.
- **renderUnit 공백/따옴표/%/tab/backslash 주입**: `render.ts:58-60`이 `%→%%`, 나머지를 `\xNN`로 escape. `render-inject.mjs`에서 `a b" ; rm -rf /`가 `a\x20b\x22\x20;\x20rm...`로 무해화, `%n%i%%`가 `%%n%%i%%%%`로, PATH 설정의 `%`도 `%%`로 이중화됨(`render.ts:52`).
- **PATH 설정(STATE)의 공백/앞뒤 공백**: `render.ts:49-51`이 `value.trim()!==value`를 거부. `state-tab`은 내부 tab만 있어 통과하나 지시자 값 안에서 무해(경로의 일부).
- **renderedExecArgv ↔ effectiveExecArgv 왕복**: `exec-roundtrip.mjs`로 `\x20`→공백 역변환이 정확함을 확인. units.ts:243-249가 manager가 실제 실행할 argv와 렌더 argv를 비교해 quoting/specifier drift를 install 시점에 거부.
- **hostSessionPath 경로 탈출**: `sandbox.ts:200-207`. `path-translate.mjs`로 `../`, `/`, `.`, `..`, NUL, 빈 이름, prefix 혼동(`/run/oma-sessionsXYZ`)이 모두 `null`로 거부됨을 확인. session mount 안의 plain file만 통과.
- **confinedPath sibling-prefix 혼동**: `sandbox.ts:222-224`가 `${host}/` 구분자를 요구. `path-translate.mjs`로 `/state/.../workspace-evil/x`가 `AUTH_FAILED`로 거부됨 확인.
- **residentArgv 봉인 플래그**: `sandbox.ts:105-107`에 `--unshare-all --new-session --die-with-parent --cap-drop ALL --seccomp 3`가 모두 존재. rootfs는 `--ro-bind`로 `/`, workspace/home/sessions만 `--bind`(rw), 나머지 ro-bind. `--clearenv` 후 env 화이트리스트(setenvPairs, `sandbox.ts:44-49`)가 이름 정규식·NUL을 거부.
- **system bind 화이트리스트**: `sandbox.ts:213-214`가 `SYSTEM_BIND_CANDIDATES`(`/usr /bin /sbin /lib /lib64 /etc/alternatives /etc/ld.so.cache`) 외 경로를 거부. 홈/`~/.pi`/auth.json/`/proc`·`/sys` 원본 bind 없음(proc/dev는 `--proc`/`--dev`로 새로 만듦).
- **hidden mask 상대경로 검증**: `sandbox.ts:216-220`이 절대경로·`.`/`..`/빈 컴포넌트를 거부.
- **hostSystemLayout symlink 대상**: `resident-rootfs.ts:96-100`이 top-level link 대상을 `/usr` 안으로 제한하고 `..` 거부.
- **JSONL 경계(긴 줄/비UTF-8/부분 줄/조기 EOF)**: `jsonl.ts`. 긴 줄은 skip+report(DR15), 비UTF-8/비JSON은 reader poison + `INVALID_REQUEST`, 미종료 EOF는 poison + `INVALID_REQUEST`(finish). pi-rpc.ts:200-206은 부분 줄에 독립 deadline을 걸어 dribble로 무한 연장 불가.
- **pi-adapter exit/signal 해석(P0-5)**: `pi-adapter.ts:270-315`. accept/settle/boundary 미완이면 `SESSION_BOUNDARY_UNCONFIRMED`(unknown 계열), 엔진이 stopReason error/aborted를 답했을 때만 `PROVIDER_FAILED`. timeout은 `DEADLINE_EXCEEDED`. unknown을 success/failed로 승격하지 않음.
- **pi-rpc FD/child 누수(P0-4)**: `pi-rpc.ts:265-303` terminate가 모든 listener off, stream destroy, 살아있으면 SIGKILL. 한 pending write만 허용(`send` LIMIT_EXCEEDED).
- **extension-integrity TOCTOU 창**: `extension-integrity.ts:26-36`이 open→fstat(isFile)→같은 fd에서 read해 stat/read 사이 swap을 막음. 모듈 스스로 "spawn 후 Pi open 전 same-UID 교체는 막지 못함"을 명시(scope 정직).
- **deployment-manifest 검증 중 변경**: `deployment-manifest.ts:60-73`이 before/after fstat의 size·mtimeMs·ctimeMs 비교로 검증 중 교체를 거부. `openRegularBeneath`로 링크/특수파일 거부.
- **assets 경로 탈출**: `assets.ts:32-44` realpath 후 `relative`로 설치 루트 밖(`..`)을 거부.
- **pi-runtime PATH 비의존**: `pi-runtime.ts:80-86`이 설치 루트의 `node_modules`만 보고 PATH의 Pi로 폴백하지 않음. override는 절대경로 강제.
- **provision 원자성/레이스**: `provision.ts:151-192` staging 이름에 randomBytes+PID격, rename onto non-empty를 ENOTEMPTY/EEXIST로 "졌다" 판정, fsyncTree/fsyncHeldDir로 durable. lostRace는 1회만(재시도 후 두 번째 EEXIST는 진짜 실패).
- **resident-rootfs create/repair 권한 분리**: `resident-rootfs.ts:114-137` create는 differing을 defer만, repair만 correct. openBeneath O_NOFOLLOW로 링크 경유 쓰기 차단.
- **systemd unit Restart/StartLimit**: broker/relay/resident에 `StartLimitIntervalSec=60s StartLimitBurst=5`가 있어 무한 재시작 억제. resident.service.in은 `Restart=on-failure RestartSec=3s`.

## 6. 확인하지 못한 것
- G05-01의 실제 도달성: 대상 커널이 CONFIG_X86_X32_ABI로 빌드되었는지, sandbox 안에서 x32 진입으로 syscall을 낼 수 있는지는 실 커널·systemd 환경이 필요해 실행하지 못함(검토 규칙상 systemctl/실행환경 금지). BPF 분기 자체는 seccomp-x32.mjs로 확정.
- G05-04의 실제 재현: 살아있는 cgroup + foreign unit 덮어쓰기 동시 상태는 systemd user manager가 필요해 실행하지 못함(추론).
- `install()`의 systemctl 왕복 검증(FragmentPath/DropInPaths/ExecStart effective/MemoryMax 등)은 실제 systemd 없이는 관측 못 함. 렌더 순수 함수와 파서(`renderedExecArgv`/`effectiveExecArgv`)만 오프라인 확인.
- pi-adapter의 실제 bwrap+engine 통합 동작(봉인된 실행)은 실행하지 않음(brief 허용: 생성 함수만 호출).
