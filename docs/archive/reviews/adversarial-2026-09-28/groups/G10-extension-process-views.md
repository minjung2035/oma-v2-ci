# G10-extension-process-views 적대적 검증 결과

저장소 `/home/dev/oma-v2`, branch `feat/macos-hidden-vm`, HEAD `070a52d`. 코드 미수정. `dist/`는 HEAD 빌드본 사용.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막으로 읽은 줄 · 앞 20자) |
|---|---|---|---|
| src/extension/batch-view.ts | 191 | 예 | L191 `}` |
| src/extension/cli-process.ts | 158 | 예 | L158 `}` |
| src/extension/contained-files.ts | 151 | 예 | L151 `}` |
| src/extension/contained-tools.ts | 59 | 예 | L59 `}` |
| src/extension/delivery.ts | 104 | 예 | L104 `}` |
| src/extension/inference-bridge.ts | 43 | 예 | L43 `}` |
| src/extension/mail-tools.ts | 394 | 예 | L394 `}` |
| src/extension/principal-channel.ts | 85 | 예 | L85 `}` |
| src/extension/principal-tools.ts | 133 | 예 | L133 `}` |
| src/extension/shared.ts | 28 | 예 | L28 `}` |
| src/extension/tool-surface.ts | 160 | 예 | L160 `}` |
| src/extension/utf8.ts | 9 | 예 | L9 `}` |
| src/extension/workspace-guard.ts | 119 | 예 | L119 `}` |
| src/process/async.ts | 261 | 예 | L261 `}` |
| src/process/command.ts | 46 | 예 | L46 `}` |
| src/process/policies.ts | 78 | 예 | L78 `}` |
| src/process/preparation.ts | 53 | 예 | L53 `}` |
| src/process/run.ts | 64 | 예 | L64 `export function deco` (decodeProcessText) |
| src/views.ts | 127 | 예 | L127 `}` |
| src/views/pending-work.ts | 113 | 예 | L113 `}` |
| src/views/status-refresh.ts | 72 | 예 | L72 `}` |
| src/authority.ts | 55 | 예 | L55 `}` |
| src/hash.ts | 18 | 예 | L18 `}` |
| src/ids.ts | 27 | 예 | L27 `}` |
| src/module-ports.ts | 15 | 예 | L15 `} from "./ports/runt` |
| src/rpc-client.ts | 4 | 예 | L4 `export type { PiEven` |
| src/ports/runtime.ts | 106 | 예 | L106 `}` |
| src/entry/host.ts | 35 | 예 | L35 `});` |
| src/entry/module-conformance.ts | 30 | 예 | L30 `};` |
| implementation/contracts.ts | 13 | 예 | L13 `export type { Store,` |

줄 수는 `wc -l` 실측값. 각 파일을 offset/limit로 마지막 줄까지 읽음.

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G10-01 | Medium | logic | mutation 도구의 request key가 tool call id에 묶이지 않아 재실행 시 중복 효과 여지 | medium |
| G10-02 | Low | boundary | grep/find는 fd-격리 없이 경로 기반 사전검사에만 의존(walk 중 심볼릭 링크·TOCTOU 미포함) | low |
| G10-03 | Low | boundary | workspace-guard의 quota 사전검사가 경로 기반 lstat(TOCTOU)이나 실제 효과는 fd-격리라 경계는 유지 | low |
| G10-04 | Low | resource | inference-bridge가 listener 성공 전에 provider를 등록, listen 실패는 stderr 로그만 | low |
| G10-05 | Low | boundary | runJournal이 종료 상태 검사 전에 truncated prefix를 성공으로 반환 | low |

High 이상 없음.

## 3. 발견 상세

### G10-01 mutation 도구의 request key가 tool call id에 묶이지 않는다
- 심각도: Medium
- 분류: logic
- 위반 규칙: P0-5 (unknown을 사실로 승격하지 않는다 / 중복 효과 방지)
- 코드 경로: `src/extension/shared.ts:26-29` (`requestKeyOf`) → `src/extension/mail-tools.ts:314,355` (`oma_mail_send`/`oma_mail_ack`, `async execute(_id, params, signal)`) → `src/extension/principal-tools.ts:65,93,110`
- 원인: 모든 mutation 도구의 `execute` 첫 인자 `_id`(엔진이 주는 tool call id, `node_modules/@earendil-works/pi-coding-agent`의 `wrapToolDefinition`에서 `toolCallId`로 확인됨)를 버린다. 모델이 `request`를 생략하면 `requestKeyOf(undefined)`가 `pi-${crypto.randomUUID()}`로 매번 **새** 키를 만든다. 즉 같은 tool call이 다시 실행되면(같은 tool call id) 새 request key가 생겨 broker의 request-cache 멱등성이 걸리지 않고 send/ack/agent create/context publish 효과가 중복될 수 있다. 반대로 request key를 tool call id에서 유도했다면 같은 tool call의 재실행은 같은 키가 되어 broker가 중복을 흡수한다.
- 영향: 모델이 request key를 명시하지 않은 상태에서 엔진이 tool call을 재실행하는 경로(연결 끊김·세션 재개 시 결과 미기록 재호출)가 있으면 durable mail 중복 전송, 중복 ack, 중복 agent 생성이 가능하다. `cliFailure`(mail-tools.ts:239-248)는 `!finished`일 때 "같은 request로 다시 호출"하라고 모델에게 안내하지만, 모델이 애초에 key를 주지 않았으면 재사용할 안정적 키가 없고 재시도는 새 키가 된다.
- 최소 반례: `oma_mail_send({to:["commons"], subject:"x", body:"y"})` (request 생략) → CLI가 timeout으로 `finished:false` → 엔진이 동일 tool call id로 execute 재호출 → 두 번째 실행이 `pi-<새UUID>`로 send를 다시 접수.
- 재현 방법: 코드 정적 확인. `_id` 미사용은 `grep "async execute("`로 mail-tools.ts:284/314/355/376, principal-tools.ts:65/93/110/127 모두 `_id`(밑줄=미사용) 확인. `wrapToolDefinition`의 `toolCallId` 인자는 `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/tool-definition-wrapper.js:11`에서 확인. 엔진의 재실행 여부는 확인하지 못해(§6) medium.
- 확신도: medium (request key 미결속은 confirmed, 중복 효과 도달은 엔진 재실행 semantics에 의존)
- 개선 방향: 모델이 request를 생략했을 때의 기본 키를 tool call id(`_id`)에서 결정적으로 유도하여, 같은 tool call의 재실행이 같은 request key가 되도록 한다. 또는 request 생략을 거부한다.

### G10-02 grep/find는 fd-격리 없이 경로 기반 사전검사에만 의존한다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음 (사전검사는 존재; walk 내부는 엔진 소유)
- 코드 경로: `src/extension/workspace-guard.ts:26-40` (`allowedWorkspacePath`) / `src/extension/contained-tools.ts:26-58` (read/write/edit/ls만 재등록)
- 원인: `containWorkspaceTools`는 read/write/edit/ls를 fd 기반 openat 격리(`contained-files.ts`)로 재등록하지만 grep/find는 재등록하지 않는다. grep/find는 `guardWorkspaceTools`의 `tool_call` 훅에서 `allowedWorkspacePath`(시작 경로의 각 component를 lstat으로 심볼릭 링크 검사)만 통과하면 엔진 자체 프로그램이 그 시작점부터 자유롭게 walk한다. 검사와 효과가 시간·주체가 분리되어 (1) 검사 후 시작 경로 component가 심볼릭 링크로 교체되는 TOCTOU, (2) walk 도중 만나는 깊은 심볼릭 링크(엔진 grep/find가 따라가는지 여부)가 이 검사 밖에 있다.
- 영향: 엔진의 grep/find가 재귀 중 심볼릭 링크를 따라간다면 workspace 밖 파일 내용이 grep 결과로 노출될 수 있다. read/write/edit/ls는 fd 격리로 이 경로가 막혀 있으므로 grep/find에 국한.
- 최소 반례: workspace 안에 walk 도중 도달하는 하위 디렉터리에 밖을 가리키는 심볼릭 링크를 두고 `grep`을 workspace 루트에 실행. 시작 경로 `.`는 검사를 통과.
- 재현 방법: `repro/G10-extension-process-views/guard.mjs` — 시작 경로가 심볼릭 링크/traversal인 경우는 모두 BLOCK 확인(pre-existing dir-symlink `esc`, `esc/secret.txt`, `../outside` 모두 차단). walk 내부 심볼릭 링크 추적 여부는 엔진 grep/find 구현이 dist에 번들/난독화되어 확인 못함(§6). 따라서 low.
- 확신도: low
- 개선 방향: grep/find도 fd 기반 격리(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS 등가) 또는 심볼릭 링크 미추적을 강제하는 자체 walker로 재등록하여, 검사와 효과를 한 해석으로 합친다.

### G10-03 workspace-guard의 quota 사전검사는 경로 기반이나 실제 효과는 fd-격리다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음
- 코드 경로: `src/extension/workspace-guard.ts:67-90` (`workspaceWriteFits`, `resolve`+`lstatSync`) vs `src/extension/contained-tools.ts:28-39` (`write`, 직렬화 안에서 `sizeWithin`/`writeWithin` fd 격리)
- 원인: `guardWorkspaceTools`의 `workspaceWriteFits`는 `resolve(root, input.path)`한 경로에 `lstatSync`로 현재 크기를 재어 quota 여유를 계산한다(경로 기반, TOCTOU 가능). 그러나 실제 write는 `containWorkspaceTools`의 직렬화된 `write()`가 `sizeWithin`(fd)로 다시 재고 `writeWithin`(fd, O_NOFOLLOW, nlink>1 거부)로 수행한다. 사전검사는 보조적 quota 힌트일 뿐 경계 판정이 아니다.
- 영향: quota 사전검사의 계산이 TOCTOU로 어긋나도 실제 쓰기 경계(격리·nlink·quota 재검사)는 유지된다. 두 곳이 같은 결정(quota)을 서로 다른 방식으로 구현하는 중복(P0-2 관점의 representation drift 소지)이 남는다.
- 최소 반례: 없음(경계 위반 재현 불가). guard의 `workspaceWriteFits`는 심볼릭 링크 파일의 현재 크기를 `current.isFile()===false`로 0 취급하는 등 계산 편차가 있으나, 최종 쓰기가 nlink/링크를 거부.
- 재현 방법: `repro/G10-extension-process-views/containment.mjs` — 실제 효과 계층(contained-files)이 심볼릭/하드링크/traversal/NUL을 모두 거부, 하드링크 write 후 외부 파일 `TOP SECRET` 불변 확인.
- 확신도: low
- 개선 방향: quota 판정을 fd 기반 한 owner(contained-tools의 직렬화 경로)로 일원화하고 guard의 사전검사는 명시적으로 "보조 힌트"로 표기하거나 제거해 중복 판정을 없앤다.

### G10-04 inference-bridge가 listener 확인 전에 provider를 등록한다
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음 (fail-closed, durable fact 아님)
- 코드 경로: `src/extension/inference-bridge.ts:27-42`
- 원인: `server.listen(port, "127.0.0.1")`는 비동기이며, `server.on("error", ...)`는 실패를 stderr에 기록만 한다. 그 직후 `pi.registerProvider(provider, { baseUrl: http://127.0.0.1:port, ... })`가 무조건 실행된다. listen이 실패해도 provider는 등록된 상태로 남는다.
- 영향: sandbox 내 loopback 포트 충돌 등으로 listen이 실패하면 모델 추론 요청이 연결 거부로 실패한다. 이는 fail-closed(추론 불가)이며 durable fact를 손상시키지 않는다. 진단 품질 문제.
- 최소 반례: 같은 포트가 이미 점유된 sandbox netns에서 로드 → stderr에 "unavailable", 이후 첫 turn에서 추론 연결 거부.
- 재현 방법: 추론만(엔진 provider 파이프라인 필요). 단계는 위와 같음.
- 확신도: low
- 개선 방향: listen 실패를 provider 등록과 결속(실패 시 등록 생략 또는 명시적 실패)하여 "동작하는 bridge처럼 보이지 않게" 한다는 주석의 의도를 실제로 강제.

### G10-05 runJournal이 종료 상태 검사 전에 truncated prefix를 성공으로 반환한다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음 (문서화된 bounded view)
- 코드 경로: `src/process/command.ts:38-50` (`runJournal`)
- 원인: `timed-out`은 먼저 throw하지만, 그 다음 `if (result.stdoutTruncated) return { bytes, truncated: true }`가 `result.kind`(예: `output-limited`)와 무관하게 truncated prefix를 성공으로 반환한다. 즉 출력 한계로 종료된 관측도 truncated=true로 리턴된다.
- 영향: 이 값은 read-only 진단 view 전용이며 주석·계약상 "Git/cgroup/ref 결정 parser에 전달되지 않는다". truncation은 조용하지 않고 명시적 플래그로 표시된다. 따라서 unknown을 사실로 승격하는 위반은 아니나, `output-limited`(중단된 관측)를 truncated view로 취급하는 순서는 경계값으로 남는다.
- 최소 반례: 매우 큰 journal에서 `maxBytes` 초과 → `stdoutTruncated=true` → exit code/kind 검사 없이 반환.
- 재현 방법: 추론만(journalctl 환경 필요, systemd 검토 금지 규칙). 단계는 위와 같음.
- 확신도: low
- 개선 방향: truncated prefix 반환을 `kind`가 `exited`이거나 명시적으로 truncation-허용 상태일 때로 한정하고, `spawn-failed`/`unobserved`와 구분한다.

## 4. 리팩터링 필요 지점
- quota 판정이 두 곳(`workspace-guard.workspaceWriteFits` 경로 기반, `contained-tools.write` fd 기반)에 독립 구현되어 있다(P0-2). fd 기반 owner로 일원화 권장.
- grep/find(경로 기반 guard)와 read/write/edit/ls(fd 격리)의 경계 방식이 비대칭이다. 한 격리 owner로 모으면 "검사와 효과는 한 해석"(contained-files.ts 주석) 원칙이 모든 path 도구에 균일 적용된다.
- mutation 도구의 기본 request key 생성이 tool call id와 무관(G10-01). request 멱등 키의 owner를 한 곳에 두고 tool call id에 결속.

## 5. 점검했고 문제없다고 판단한 것
- **contained-files.ts 경로 탈출 전부 차단(confirmed)**: symlink 파일/디렉터리 component, 하드링크(nlink>1) write, 절대경로, `..` traversal, NUL 모두 거부. 하드링크 write 시도 후 외부 파일 내용 불변(`TOP SECRET`). 근거: `contained-files.ts:53-58`(entryAt: `/`·NUL·`.`·`..` 거부), `:70-80`(openat O_NOFOLLOW per component + ELOOP/ENOTDIR→refuse), `:100-104`(ownedFile nlink>1 거부), `:31-36`(componentsWithin 절대/traversal/NUL 거부). 재현: `repro/.../containment.mjs`.
- **guardWorkspaceTools 사전검사(confirmed)**: 호스트에서 bash/powershell 거부, grep/find/read의 pre-existing dir-symlink·`../outside` 차단. 근거 `workspace-guard.ts:102-118`. 재현: `repro/.../guard.mjs`.
- **batch-view 매니페스트 파싱(confirmed)**: `__proto__` 매니페스트는 prototype pollution을 일으키지 않고(`exactObject` 키 수 검사로 비어있지 않은 `__proto__`는 거부, 반환 객체는 필드별 재구성), 음수 incarnation·중복 messageId·추가 키·frame 초과 모두 거부. 근거 `batch-view.ts:36-46`(exactObject), `:135`(dup set), `:130`(incarnation<0), `:112-118`(frameBytes). 재현: 인라인 node 확인.
- **readBatchView 파일 재검사**: O_NOFOLLOW|O_NONBLOCK, before/after fstat(dev/ino/size/mtime/ctime) 비교, `size+1` 읽어 성장 탐지. `batch-view.ts:157-186`.
- **process 신호/종료 해석(정적 confirmed)**: `async.ts:127`·`run.ts:24-30` — signal 죽음은 `signalled`, timeout은 `timed-out`, spawn 실패는 `spawn-failed`, 알 수 없는 code는 `unobserved`이며, exit 0으로 승격하지 않음. `command.ts:16-19`(requireTextExit)는 non-exited를 전부 StoreError로 throw(P0-5 준수). exit vs signal 혼동 없음.
- **process group kill(async.ts:98-108)**: ownGroup일 때 `process.kill(-pid, SIGKILL)`, 실패 시 직접 child kill 재시도, 그룹 실패를 그룹 사멸로 해석하지 않음(주석·`nativeError`). exited PID를 신호 대상 재사용하지 않음(`terminationRequested||exited` 가드).
- **preparation 불확실성 sticky(preparation.ts:8-15, 44-46)**: 비-exit 관측은 `uncertainNativePreparation`/`this.uncertain`로 남아 RUN_TERMINATION_UNKNOWN을 던지고, quiescent로 승격하지 않음(P0-5).
- **출력 버퍼 한계(async.ts:145-159, run.ts:52-56)**: 바이트 단위 카운트·초과 시 terminate("output-limited")·마지막에 1회 디코드(문자 경계 분할 방지, P0V-35). 무제한 버퍼 아님.
- **society fence 상속(cli-process.ts:44-58)**: 선언된 fence가 열려있지 않거나 소켓이 아니면 throw하여, unfenced 두 번째 writer 생성을 막음(P0-4/REC-007).
- **principal-channel(principal-channel.ts)**: credential은 소켓 fd3에서만, 형식 불일치·과대 라인은 broken 처리 후 clear, close/error 시 clear(과거 broker의 credential 재사용 방지). 환경변수에 credential 없음.
- **cli-process credential 전달(cli-process.ts:135-141)**: env가 아닌 fd3 소켓으로 전달, `/proc/<pid>/environ` 노출 회피. 환경은 상속이 아닌 구성(`cliEnvironment`).
- **pending-work 투영(pending-work.ts)**: 중복·소유자 불일치·미래 incarnation·매니페스트-링크 불일치를 STORE_CORRUPT로 던지고 "더 작은 수"로 눌러쓰지 않음(관측 실패를 0으로 표시하지 않음, INV11/P0-5).
- **status-refresh(status-refresh.ts)**: 관측 실패는 `failure:"unavailable"`, timeout은 빈 units+`failure:"timeout"`, observedAtMs는 질문 시각 이후. 오래된 스냅샷은 unknown으로 읽히도록 시각을 실음.
- **views.status(views.ts:98-124)**: 관측 실패(catch)를 running/exit0로 해석하지 않고 unknownReason="unavailable", no-unit은 NO_UNIT_REASON으로 명시(INV02). fieldEscape로 TSV 주입 차단.
- **authority.ts**: 손상은 빈 권한집합이 아니라 STORE_CORRUPT(capabilitiesOf 경로), incarnation/desired 재검사, capability는 결정 시점에 auth·actor 양쪽에서 재확인(P0-1). 기본값이 허용이 아님.
- **ids.ts/hash.ts**: `randomUUID()` 사용, 비정규 UUID면 throw(충돌·시계 의존 없음). requestHash는 단일 owner builder 경유, 원시 해시 primitive 미노출.
- **mail readableMail(mail-tools.ts:73-99)**: base64/QP 디코드는 재인코딩 왕복 검증·엄격 정규식, 실패 시 원문 반환. boundedBytes는 크기 고정·성장/변경 탐지.

## 6. 확인하지 못한 것
- 엔진(pi-coding-agent)이 같은 tool call id로 `execute`를 재실행하는지(연결 끊김·세션 재개 시) — dist가 번들/난독화되어 미확인. G10-01의 중복 효과 도달성은 이에 의존(medium).
- 엔진의 grep/find가 재귀 walk 중 심볼릭 링크를 따라가는지 — 구현이 번들되어 미확인. G10-02의 노출 도달성은 이에 의존(low).
- inference-bridge listen 실패 후 provider 등록 상태에서 첫 turn 동작 — 엔진 provider 파이프라인 필요, 미실행.
- runJournal의 truncated 반환 순서 — journalctl/systemd 환경 필요(검토 규칙상 금지), 미실행.
- cli-process의 `terminate`가 프로세스 그룹 kill을 쓰지 않음(SIGTERM→5s→SIGKILL, 직접 child만). CLI가 손자 프로세스를 남기면 누수 가능하나, 모델-facing `oma` CLI의 자식 생성 여부와 society fence의 회수 범위는 그룹 밖 파일이라 판정 보류.
