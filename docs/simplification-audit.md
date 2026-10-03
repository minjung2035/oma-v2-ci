# 간소화 agenda 검증 — 항목별 판정 (2026-10-03, 에이전트 10개, 검증판 rev2)

기준: 모델 surface(OMA prompt·authority·tool 표면)는 유지. 수정 대상 = ① 사용자가 납득 어려운 억제,
② Pi/OS 기능의 내부 재구현, ③ 과도 plumbing/과거 잔재, ④ 외부↔내부 불필요 간섭.
판정: 확정 / 부분 / 반박. 각 항목에 핵심 근거 file:line과 수정 방향.

rev2: 사용자 재검증 32개 수정사항을 별도 4개 에이전트로 코드+설치된 Pi 0.87.1 대조해 반영.
검증 판정은 각 행의 `[rev2]`에 표기. 본 문서는 발견 보고서이며 specification이 아니다 —
제품 정책 변경은 spec 개정(TSP/operations.md/arch)과 함께 진행.

## A. Pi 통합

| # | 판정 | 근거와 결론 |
|---|---|---|
| A1 RPC 재구현 축소 | **부분 — 교체 불가, 타입 재사용만 가능** [rev2 확인] | `RpcClient`/`RpcCommand`/`RpcResponse`/`JsonAgentSessionEvent`는 root export 실재(`dist/index.d.ts:28`). `RpcClient` 자체는 불가: 자체 spawn·고정 stdio·merged env·30s timeout·자체 req id 부여·stderr 보관 등 OMA isolation과 충돌(clearenv, fd3-6, drain-based send, poison framing, FRAME bound). 대안 확정: `PiRpcClient.send` 인자를 `RpcCommand`, inbound를 `RpcResponse|JsonAgentSessionEvent`로. 단 OMA 내부 UI 소켓 이벤트(`panel_open`/`human_input` 등)는 OMA 자체 프로토콜이라 `PiEvent` 유지 |
| A2 wire type 수동 재정의 | **확정 — drift 위험 실재** | `PiEvent`+string discriminant가 곳곳에; exported type 대부분 shape 일치 확인(0.87.1). 미고정 mirror: `"To resume this session:"` literal, `PI_SESSION_*` strip list, `auth.json` merge shape. 수정: exported type 채택 + 나머지 literal을 engine-oracle test로 고정 |
| A3 builtin command mirror | **부분 — 불가피** | `PI_BUILTIN_COMMANDS`(pi-interactive-host.ts:52-54)는 test-pinned이나 Pi에 public builtin registry가 없음(0.87.1). `ExtensionRunner.getCommands()`는 extension command만 반환. 수정: pi-compat 격리 + upstream export 요청. `/trust`,`/bug`,`/import` 거절과 `/export` 재작성은 의도된 정책으로 유지 |
| A4 settings 직접 편집 | **부분 — Pi 공개 API 실재, 단 OMA 원자성이 우위** [rev2 수정] | rev1 오류 정정: `prepareEngineFile`은 파일마다 별도 lock→read→replace를 4회 수행(pi-runtime.ts:37-85) — "atomic multi-file writer"가 아니었음. Pi 0.87.1은 `SettingsStorage` 인터페이스(settings-manager.d.ts:136-138)와 `SettingsManager.fromStorage()`(:175), `setTheme`/`setHideThinkingBlock`/`setQuietStartup`/telemetry/analytics/skill/fullscreen setter를 제공. 한계: ① `SettingsStorage`는 root-exported 아님(`Parameters<typeof SettingsManager.fromStorage>[0]`로 접근) ② Pi write는 async-queued 비원자(`writeFileSync` in-place, `flush()` 필요) ③ retry 수치 setter 부재(getter만) ④ keybindings/open-tui/theme/auth는 범위 밖. 결론: **Pi의 parsing/migration/getter·setter semantics는 `SettingsManager`를 재사용하고, persistence는 OMA durable `SettingsStorage`(readUserFile/replaceUserFile 구현)가 소유** — Pi 기본 `FileSettingsStorage`는 `writeFileSync` in-place라 그대로 사용 금지. setter가 있는 필드만 커버되고 retry+3개 파일은 여전히 직접 write |
| A5 compat layer 잔여 | **부분 — 절반은 compat이 아니라 삭제** [rev2 수정] | compat 유지 대상: retry.maxRetries/baseDelayMs/maxAgentDelayMs/provider.*, keybindings.json, open-tui.json, themes/*.json. 삭제 대상(영구 compat 금지): auth.json merge, models*.json adoption, bin/fd·bin/rg 도구 adoption — 순수 pre-DR24 migration 코드로 I50과 함께 삭제. 현재 코드는 per-society `pi` home을 생성하지 않음(pi-runtime.ts:232-234) |
| A6 session 파일 해석 | **대부분 반박** | OMA는 첫 줄 header만 admission probe(session-history.ts:53-78) — 나머지는 전부 SessionManager 위임. SessionManager에 header-only API 없어 probe는 최소 경계. pi-compat 격리 대상 |
| A7 pi-compat layer 신설 | **확정 — 실현 가능** | Pi 접점은 이미 거의 집중(entry+runtime/pi-*+extension). 최대 surface: `InteractiveMode` private patch ~11개(두 entry), rendered-string probes, deep test imports. 격리 불가능: mail/ledger/sandbox/credential/session-birth |
| A8 exact pin | **부분 — 이미 재현 가능, 선언적 변경** [rev2 수정] | `package.json`은 `^0.87.1`이나 `package-lock.json`이 0.87.1 tarball+integrity를 exact 고정(lockfile :28-31, :1929-1932) — `npm ci`는 지금도 reproducible. manifest를 `"0.87.1"`로 바꾸는 건 "Pi upgrade는 명시적 compat 작업"이라는 선언이지 재현성 수정 아님. 추가 발견: `pi-coding-agent` 하위 nested `pi-tui`(lock :515-526)는 `resolved`만 있고 `integrity` 없음(상위 npm-shrinkwrap 기인) |

## B. OpenTUI / interactive

| # | 판정 | 근거와 결론 |
|---|---|---|
| B9 InteractiveMode patch | **확정 — OpenTUI 소유이므로 API 수정이 정답** [rev2 강화] | Society 8개+Personal 6개 private member patch(pi-interactive-host.ts:519-580, pi-personal.ts:59-278). OMA가 pi-open-tui를 소유하므로 workaround 유지 근거 없음 — 헤더/푸터/에디터는 OpenTUI 정식 API로. 단 `handleFatalRuntimeError`/`updateTerminalTitle`/`showSessionSelector` 등은 pi-coding-agent 영역이라 upstream hook 필요 |
| B10 stdout.write override | **확정** | 2곳(host:453-455, personal:280-284). `fullscreenExitOutput`에 "none"/template이 없어 불가피했음. engine API 추가 시 제거 가능 |
| B11 ANSI branding | **확정 — OpenTUI 수정으로 대체** [rev2] | `open-tui-brand.ts`가 rendered output을 문자열/regex로 재작성(logo/tagline/`Pi v~`/`~`/`Welcome`/`Ask Pi anything`/tip). open-tui.json brand fields 또는 `setBrand` API를 **OpenTUI에 직접 추가**하는 게 정답 — scraping 유지 금지 |
| B12 editor proxy | **확정 — OpenTUI hook 추가로 대체** [rev2] | `interactive-editor.ts`: onSubmit capture, actionHandlers set-trap, onPasteImage stub, handleInput/history wrap. Society만 해당(Personal은 미래핑). OpenTUI에 정식 hook(submit delegate, command dispatch, bindAction, paste policy, input-admission bound)을 추가해 proxy 폐기 |
| B13 bootstrap 중복 | **부분 — 정당한 차이 포함** | 13개 공유 패턴 실재(extension path resolve, preparePi*, brand, ExtensionModules, no* flags, reload/dispose wrap 등). 차이는 authority: Society는 ownedEditor/human_input/credential/fd5-6, Personal은 birth/keychain/re-exec. 정식 API 후 공통 helper |
| B14 image paste | **확정 — silent + half-supported** | `onPasteImage=()=>{}` + set-trap swallow. notice 없음. `onPasteImagePath`는 안 막혀서 path 붙여넣기는 절반 동작. protocol(`human_input` text-only)이 차단 — images 필드 또는 거절 notice 필요 |

## C. resource ecosystem

| # | 판정 | 근거와 결론 |
|---|---|---|
| C15 AGENTS.md 차단 | **확정 — Personal에서 납득 불가** [rev2 보강] | 모든 엔진에 `--no-context-files`/`noContextFiles`. Personal은 sandbox 없이 사용자 프로젝트 cwd에서도 차단. 주의(rev2): `loadProjectContextFiles`는 **trust-gate 아님** — 활성화하면 AGENTS.override.md/AGENTS.md/CLAUDE.md가 ancestor discovery로 즉시 로드됨. Resident의 model-writable workspace에서 model이 AGENTS.md를 심으면 다음 reload에 주입 가능. 곧바로 취약점은 아니나 "human project instruction"과 "worker 자신이 생성한 instruction"을 동일 취급할지는 제품 정책 → **Society는 raw discovery 대신 canonical context 선정 → `agentsFilesOverride`로 OMA가 vetted 파일만 주입**하는 방식 검토. Personal은 Pi semantics 그대로 |
| C16 skills 차단 | **확정** | `noSkills` + `enableSkillCommands:false` 이중. Personal/user-package skills까지 차단. `skillsOverride`/`additionalSkillPaths` 경로 존재. project `.pi/skills`는 `projectTrusted` 필요(OMA는 false로 설정 중 — 별도 trust 결정). Skills section은 `read` 또는 `bash`가 selectedTools에 있을 때만 렌더됨 |
| C17 prompt templates | **확정** | `noPromptTemplates` + `expandPromptTemplates`가 `/oma-deliver` 전용(pi-interactive-host.ts:461) — 사용자 template은 미전개 literal로 전송됨 |
| C18 package resource | **확정** | `writePackageIndex`가 `resolved.extensions`만 사용하고 skills/prompts/themes를 버림(pi-packages.ts:154-175). Pi 0.87.1 `ResolvedPaths`는 4종 모두 제공(package-manager.d.ts:13-18) — 정상 Pi 기능을 일부러 버리는 중. 게스트에 파일은 가는데 인덱싱 안 함 |
| C19 project-local resources | **확정 — mode별 분리 필요** [rev2 수정] | Personal: `.pi/skills`/`.pi/prompts`/`.pi/themes`/`AGENTS.md`/`CLAUDE.md`는 정상 Pi 지원 복원이 맞음. Society: 리소스는 지원하되 **`.pi/SYSTEM.md`로 OMA system prompt를 대체하게 하면 안 됨** — OMA는 `--system-prompt`로 identity 소유 유지(실제로 `--system-prompt`가 discovery보다 우선승리라 이미 보호됨). `APPEND_SYSTEM.md`도 Society는 명시적 OMA 정책 하에서만. Personal의 project `.pi` 리소스는 `projectTrusted` 해결 필요(현재 false, pi-personal.ts:155) |
| C20 local extension 거절 | **확정 — 이유 해소 가능** | `REMOTE_SOURCE`만 허용(pi-packages.ts:55,114). Worker sandbox 가시성이 이유지만 package store snapshot이면 기존 보장(inside-store/no-links/digest) 유지 가능. Personal은 Worker가 없는데도 절대경로 거부 |
| C21 extension prompt guidance | **확정 — Society에서 silent drop, 처방 확정** [rev2 수정] | `customPrompt` 설정 시 Pi는 `tools`/`rules`/`docs` section 자체를 생성 안 함(system-prompt.js:79-94) — `promptSnippet`/`promptGuidelines`가 도달 불가 확인. OMA 자체 group tool의 promptSnippet(tool-surface.ts:146)도 유실됨. 정확한 처방: 기본 prompt 되살리기가 아니라 in-engine에서 `before_agent_start` 훅이 `systemPromptOptions.sections`(mutable, customPrompt와 공존)로 활성 tool의 guidance만 재계산·주입 — `pi.getAllTools()`로 live active set 기준. `promptGuidelines` 입력 필드 자체는 buildRules에만 연결돼 복구 불가 |
| C22 Pi 기본 prompt 차단 | **확정 — 유지(verify only)** | 모든 Society 엔진 `--system-prompt` 적용. Personal만 Pi default 사용 |

## D. tool surface

| # | 판정 | 근거와 결론 |
|---|---|---|
| D23 DIRECT/GROUPED/DISABLED | **확정 — 제품 정책으로 재분류** [rev2 수정] | 제품 의도: GROUPED는 사용자/role author 기능이 아니라 **OMA built-in extension surface 관리 내부 정책**. 그러나 현재 spec은 role file의 authored config로 정의(TSP-001/002, operations.md:68,187-213, arch §23.10). generic engine은 내부에 남기되 authored product config에서 제거 → spec 개정 필요(TSP-001/002, operations.md, arch §23.10). 삭제 시 `toolSurfaceOf`(operations.ts:306-345)와 plumbing(session.ts, runner.ts, pi-spawn-plan.ts, generations.ts, settings.ts) 제거; `domain/tool-surface.ts`+`OMA_TOOL_SURFACE` env는 internal로 유지 |
| D24 authority 분리 | **확정 — 유지** | enable(extensions list)과 authority(capabilities∩storedSpec, 매 요청 재계산)는 분리·검증됨 |
| D25 name-based allowlist | **확정 — provenance 기반으로 교체** [rev2 수정] | `pi-extension.ts:36-45` hard-coded name set. 실패 모드: ① Principal에 extension 켜도 tool이 model에 안 도달(가장 혼란스러운 발견) ② name shadowing — extension tool은 builtin 이후 registry에 기록돼 `"read"` 같은 이름 덮으면 permitted 통과(실제 hole) ③ builtin rename 시 silent 축소. **rev1의 "effect/category" 처방은 불가 — Pi `ToolDefinition`에 그런 메타데이터 없음.** 정확한 처방: `pi.getAllTools()`의 `ToolInfo.sourceInfo{path,source,scope,origin}`로 provenance — `source:"builtin"` 안전 이름 + `sourceInfo.path ∈ 검증된 -e 경로 set`(role별 digest-pin 이미 존재)만 허용. shadowing hole도 동시에 닫힘. per-call fence용 name→sourceInfo map은 session_start/setActiveTools 후 재구축 |
| D26 golden compat test | **부분** | wire goldens/tool-name 세트/action enum 고정은 있으나, 전체 tool의 serialized schema·result envelope·unknown 표현의 골든 없음 |

## E. extension → OMA 통신

| # | 판정 | 근거와 결론 |
|---|---|---|
| E27 subprocess per call | **확정 — 처방은 oma-client library** [rev2 수정] | tool call당 Node spawn 1 + socket ≥1. rev1의 "persistent supervised CLI"는 중간층을 영구화할 뿐. 더 나은 구조: **extension-safe oma-client library(`src/client/` 신규 트리)를 Extension과 CLI가 공유** — freeze/replay, same-key lookup, receipt recording은 library가 유지. 차단점(rev2 확인): PI-001 closure rule이 extension에 `src/extension/*`+`node:*`+engine+typebox만 허용하고 `import type`조차 금지 — `src/client/` 도입은 **architecture rule 개정 선행** 필요(type-only edge 면제 + `src/client/` 허용). 규칙 개정 거부 시 fallback이 persistent CLI. 참고: `descendsFrom(pid,ancestor)` zero-depth 매치로 in-process attach는 오늘도 동작 |
| E28 CLI 이중 역할 | **확정** | freeze/replay/effects(file read, git resolve, context tree, bundle build)를 CLI가 소유 — extension이 runtime import 불가(PI-001)라 CLI가 사실상 client library. oma-client library 공유가 해결책(E27과 동일 경로) |
| E29 FD3/FD4 plumbing | **부분 — 두 FD의 성격이 다름** [rev2 수정] | FD3 credential socketpair: env/argv(`/proc/<pid>/{environ,cmdline}`) 노출 방지용 — **in-process client로 가면 제거 가능**(grant가 이미 `PrincipalChannel.current()` 메모리에 존재). FD4 society lease: subprocess plumbing이 아니라 **kernel lifetime lease — 어떤 구조든 유지 필수**. 제거 가능한 것은 argv/stdout/exit-code parsing 등 subprocess 기인 부분뿐. host↔engine FD3(HOST_CHANNEL_FD)는 별개 채널로 유지 |
| E30 constant mirror | **확정하나 의도적** | mirror는 INV04 test-bound 선언 메커니즘. contracts leaf를 extension closure에 열지는 정책 결정. 발견: `OMA_INCARNATION`은 producer만 있고 reader 없음(dead contract); credential line은 3곳에 철자; `agent wait --observe` stdout shape는 계약 없음 |

## F. sandbox / 개발환경

| # | 판정 | 근거와 결론 |
|---|---|---|
| F31 outbound network | **확정 — capability cliff 실재** [rev2 보강] | `--unshare-all`(NIC 자체 없음). `features.egress`는 config 설정 가능한 게 아니라 **contract에 literal `false`**(host.ts:87, config.ts:255-264). egress 채널 자체는 존재(EgressPool/InferenceRelay)하나 provider-scoped라 일반 egress 불가 |
| F32 guest NIC 없음 | **확정 — schema에 NIC 없음** | VmConfig가 networkDevices를 표현 불가 — configurable이 아니라 하드코딩된 부재. 우회 인프라(egress pool/vsock)가 이 정책 때문에 존재 |
| F33 credential relay | **확정 — 유지** | fixed origin + slot-confined credential substitution + response tripwire + accept-encoding 강제. 좁고 정확 |
| F34 clearenv 완화 | **확정 — platform별 차이 있음** [rev2 수정] | Linux resident: env가 `HOME`/`PATH`/`OMA_*`/`TOOL_SCOPE`/`OMA_INFERENCE_*`뿐 — LANG/LC_ALL/TZ/TERM/TMPDIR/XDG/SHELL/USER 전무(sandbox.ts:132-137). **macOS guest는 이미 LANG/XDG_DATA_HOME/XDG_RUNTIME_DIR/HOME/PATH/TERM 있음** — 부족은 TZ/SHELL/USER/TMPDIR. 최소 allowlist: LANG/LC_ALL(C.UTF-8, rootfs locale 확인), TZ=UTC(+`/etc/localtime` 또는 TZDIR), TERM, TMPDIR=/tmp, SHELL, USER, XDG_* under confined home. **host desktop env는 계속 배제 — `process.env` 상속 allowlist로 전환 금지** |
| F35 PATH | **확정** | `RESIDENT_PATH_ENV`=`/opt/oma/<cli>:/opt/oma-node:/usr/bin:/bin`. user-local bin 불가. mount 정책이 실질 제한 |
| F36 DNS/CA/NSS | **확정 — latent gap** | `SYSTEM_BIND_CANDIDATES` closed list에 resolv.conf/CA/nsswitch/localtime 없음. egress 활성화 시 추가: resolv.conf(또는 정적 파일), CA bundle, nsswitch.conf, /etc/hosts, /etc/localtime — 전부 read-only bind |
| F37 rootfs/toolchain | **부분** | host /usr은 ro 노출이나 설치 불가·toolchain contract 없음. macOS guest image는 repo에 없어 검증 불가 |

## G. resource enforcement

| # | 판정 | 근거와 결론 |
|---|---|---|
| G38 workspace quota 전수 scan | **확정 — 처방은 filesystem layer** [rev2 수정] | positive-growth write마다 전체 workspace walk(workspace-guard.ts:28-44, write queue 직렬화). incremental O(1)만으로 불충 — shell/background process write가 tool wrapper를 우회하므로. `/workspace`는 plain `--bind`(tmpfs는 /tmp만)라 kernel 경계 없음. 선례: candidate-checks.ts:76-77이 `--size --tmpfs /workspace` 사용 중. durable workspace용 정답: **loop-mounted filesystem image 또는 prjquota(state FS의 XFS/ext4 project quota)** — extension layer가 아닌 filesystem/runtime enforcement. 스캔은 admission UX(fail-fast)로 유지 |
| G39 society admission scan | **확정 — streamed는 2번** | reserve(preflight) + admit(dispatch)가 각각 state tree 전체 walk(quota.ts:98-130). same request 안에서 관측을 넘겨줄 수 있음. 참고: 스캔은 SQLite WAL/page growth도 과소계상 — 진짜 경계는 state tree 전체 위에 있어야 함 |
| G40 shell write 우회 | **확정 — confined만** | sandbox bash는 quota 미검사 후 쓰기 — 다음 scan에서야 발견. unconfined는 bash 자체가 차단. network 개방 시 background process도 쓸 수 있어 tool-layer quota는 더 무의미해짐 → G38의 FS-layer 경계 필수 |
| G41 resource defaults | **확정 — 이미 configurable** | 2GiB/128/512MiB 실재하나 per-agentProfile 설정 가능(개별 agent는 아님). default 상향만 남음 |
| G42 run-start freeze | **확정 — 올바른 semantics** | accepted spec에 freeze, cgroup은 incarnation 재생성 없이 resize 불가라 정당. 작업 불필요 |

## H. macOS package plumbing

| # | 판정 | 근거와 결론 |
|---|---|---|
| H43 Darwin→Linux 복사 | **확정 — 실재, 최종해법은 guest-native install** [rev2 최종] | `oma pi`가 Mac의 npm으로 resolve → darwin-arm64 tree를 byte-copy → esbuild/sharp/node-gyp류 platform optionalDep가 Mach-O로 guest에 도착. 현재 no-NIC 구조를 잠시 유지해야 한다면 `--os=linux --cpu=arm64 --libc` platform-pin(npm 공식 override, `npmCommand`로도 가능)은 **compatibility를 개선하는 interim mitigation** — prebuilt optional-dep *선택*만 고치고 install script는 여전히 Darwin에서 실행되므로 `process.platform` 체크·node-gyp compile·custom native build는 위험 잔존. **완전한 arbitrary package compatibility는 guest-native install이 필요** — F32 network를 먼저 고치고 바로 guest-native로 가는 것이 정답, interim architecture에 비용을 쓸 이유는 없음 |
| H44 custom archive | **확정 — 정당화되나 bespoke** | no-network 전제의 산물; tar의 link/device/owner 표면을 의도적으로 배제(bounded, regular files only — sound). guest-native install 경로 생기면 폐기 가능 |
| H45 generation sync | **확정 — host-store vs guest-generation 이중** | 파이프라인은 sound(~1200줄, idempotent)하나 guest가 resolver를 indexing에만 씀. guest-authoritative는 전제 변경 필요 |
| H46 symlink 생략 | **확정 — silent drop** | `.bin` shim·패키지 내부 symlink·`.git`·mode·mtime이 조용히 유실 — 최소 fail-or-record 필요 |

## I. config / pre-release baggage

| # | 판정 | 근거와 결론 |
|---|---|---|
| I47 v1→v3 migration | **확정 — coordinated 제거 필요** [rev2 보강] | v0.1.0 pre-release라 최초 public format을 현재 최신으로 재정의하는 게 맞음. 단 삭제는 한 묶음: 두 SQL은 deployment-manifest-pinned(assets.ts requireEntry로 boot 거부) + production-inventory 요구 + READABLE set은 wire field(`stateSchema{written,readable}`, host-guest.ts:80 — macOS image boot gate) + preflight/diagnostics 사용. ~8파일+wire contract 일괄 변경 |
| I48 legacy attestation | **확정 — live wire path** | mail-v1 아닌 config에서는 지금도 production 경로(attestation.ts:37-45, tiered.review 생략 시 legacy). 삭제 시 mail-v1 필수화 + persisted op decode 유지 필요 |
| I49 legacy binding | **확정** | slug-only society 감지+명시 마이그레이션 UX는 live fail-mode(orphan 방지 refusal). pre-release라 삭제 가능하나 동작 변경으로서 명시적 결정 |
| I50 engine-home adoption | **확정 — A5와 함께 삭제** [rev2] | 매 기동마다 과거 per-society pi home을 merge(pi-runtime.ts:113-157, oma-society.ts:74,684). 현재 코드는 그런 home을 생성하지 않음. 단 pre-DR24 dogfood install이 있었다면 그 로그인을 잃음 — "no pre-release external state" 선언 하에 삭제 |
| I51 inline vs managed | **부분** | commit owner는 통합됐으나 dual layout + roleSet 변환 + `--config` 표면 남음. inline은 bootstrap 경로라 완전 삭제는 대안 필요 |
| I52 generation machinery | **부분 — surplus는 좁다** [rev2 수정] | rev1이 과도하게 썼음: 현재 구조는 **multi-file atomic publish**(host.json+models.json+roles+prompts를 .staging 후 단일 rename, file/dir 0400/0500+fsync), **stale-edit 방지**(assertCurrent가 publish+commit window에서 재해시), **crash consistency**(journal 선기록+post-rename flush+unconfirmed 차단+torn-tail 정리)를 제공 — 단순 config.json atomic replace로 치환하면 이 계약을 잃음. "immutable snapshot dir + 하나의 atomic current pointer"가 이미 현재 설계. 진짜 surplus: legacy single-id journal 파싱(L493-499)과 previous-generation retention(rollback out-of-scope 선언 시 — 단 journal은 committed-superseded와 crash-torn publish 구분에도 필요). 처방: 단일파일 replace 금지; 필요하면 legacy record 파싱 제거 + 문서화 |
| I53 project→session 복제 | **부분 — 버그 아님** | 복제는 실재하나 derived cache로 동기화됨(rederive). 비용은 machinery이지 정합성 아님 |
| I54 dead ModelProfile | **확정 — 5개 dead required field** [rev2 확인] | `credentialRef`, `codecRevision`, `pricingRevision`, `maxInputTokens`, `maxOutputTokens`는 runtime model selection 경로에서 미독. macOS egress는 config credentialRef가 아니라 `EGRESS_ENGINE_MANAGED` 하드코딩(egress-forwarder.ts:68, resolver.ts:24). `inferenceTimeoutSeconds`는 사용됨(runner.ts:169,178,227, session.ts:195, settings.ts:432). 처방: 5개를 schema에서 제거(breaking) 또는 optional-ignored로 격하; provider/model/inferenceTimeoutSeconds/thinking 유지 |
| I55 always-false flags | **확정 — feature baseline 시 flag 삭제** [rev2 보강] | notmuch/reflinkSeed/formalApproval/egress 모두 false만 허용(config.ts:255-264), closedRecord가 4키 전부 필수. egress가 baseline이 되면 flag를 true로 확장하는 게 아니라 **flag 자체 삭제**가 제품 철학에 부합. `features` 자체를 optional로도 고려 |
| I56 usage ledger | **확정 — usage subsystem 전체 삭제 후보** [rev2 최종] | `reserveUsage`/`settleUsage`/`getUsage`의 production caller 없음(확인). diagnostics가 `usage` table을 decode+검증(ledger.ts:81,95,132,137,198-201)하는 것도 사실 — **그러나 그건 유지 이유가 아니라 함께 수정할 dependent surface**. v0.1 최초 public schema로 리셋(I47)하면 내부 개발 state compatibility 전제가 없으므로 `usage` table·`UsageRow`/`decodeUsageRow`·Store wrapper·mutator·diagnostic projection·관련 SQL을 통째로 제거 가능 — schema-v4를 만들 필요가 없으며, 공개 전에 죽은 table 때문에 새 migration version을 만드는 것이야말로 제거 대상 문제 자체. 처방: 단순 caller check가 아니라 diagnostics/schema/readable-version/image compatibility까지 묶는 coordinated reset(I47 삭제 세트에 편입) |

## J. process / systemd

| # | 판정 | 근거와 결론 |
|---|---|---|
| J57 .path wakeup | **확정하나 의도적 중복** [rev2 검증 유지] | physical trigger(DB projection이 아닌 Maildir 파일, `DirectoryNotEmpty`), armed-state durable record(enable+UnitFileState), broker-down 시 manager pull-up, cgroup identity substrate. broker direct activation은 mail-accept hot path에 N×60ms systemctl을 넣어 더 나쁨 |
| J58 transient units | **반박** [rev2 검증 유지] | unit 파일은 identity/armed-state substrate: `X-OMA-Owner`, UnitFileState/enable, [Install] reboot 생존, cgroup peer-auth(requireRunnerUnit은 `/proc/<pid>/cgroup`이 credential). transient은 이 전부를 못 줌 |
| J59 reconcile timer | **반박** [rev2 검증 유지] | `ReconcileModule.sweep` = operations.sweep(durable op recovery) + reviews.advanceAll(review advance) + observeUnits(desired↔observed 수렴) + startup에 artifact GC/canonical fsck/quiesce. drift repair는 일부에 불과 |
| J60 ownership primitives | **부분 — 기질별 정당** | 7개 substrate(cgroup/process-group/direct-child/CLI/fd-lease/supervision-channel/transient)는 각각 다른 death proof. direct-child 계열만 grace→escalate→confirm 공통화 가능 |

## K. integrity / repo 구조

| # | 판정 | 근거와 결론 |
|---|---|---|
| K61 entry-only hash | **부분 — 갭은 Linux package store로 한정** [rev2 최종] | 정확한 표현: **OMA-owned compiled assets는 whole-tree content-addressed**(deployment-manifest.ts:119-121 `dist/src`+contracts+systemd)이고, **runtime dependencies는 pinned `package-lock.json` 바이트의 integrity 계약에 의존**(:126-127) — 설치된 `node_modules` byte tree 자체는 해시하지 않으므로 post-install 변조/손상은 못 잡음(잔여 gap). macOS package store는 `.packages-generations/p-<archive-sha256>` content-addressed immutable generation. 실제 갭: **Linux `.packages`는 plain dir — entry pin만, `./lib/*.js`/node_modules transitive import 미고정**. `assertExtensionIntegrity`도 "asset identification, not containment"로 문서화됨(extension-integrity.ts:9-12). 처방: Linux store를 macOS와 같은 content-addressed generation으로 + 계약 명시 |
| K62 ExtensionModules | **반박 — 유지** [rev2 최종] | `registerHooks`는 `?oma-extension=<id>:<gen>`로 module URL을 재식별 — native ESM cache 회피에 실제 필요. `/reload`뿐 아니라 `/new`,`/resume`,`/fork`의 같은-process session 재생성(pi-interactive-host.ts:476)에도 필요 — 단순 /reload 편의 코드가 아니라 in-process session 경계 코드. 40줄 self-contained. **유지; Pi가 public module invalidation을 제공하면 삭제 후보** |
| K63 LOC/hash gate | **부분 — 사실과 가치판단 분리** [rev2 수정] | `check:inventory`가 committed `production-files.txt`+per-file sha256+cloc version+report hash를 바이트 비교 — evidence integrity로 정당. committed artifact가 주는 것: diff로 리뷰되는 commit-time claim과 source hash의 상호결합 + 조기 로컬 실패. 사용자 제안 실현 가능: manifest+source digest는 유지하고 `production-loc.json`만 CI-generated evidence로 격하(잃는 건 committed-claim↔measurement binding). 어느 쪽도 방어 가능 |
| K64 doc archaeology | **확정** | current truth 재구성에 architecture(frozen)×DR1-30×spec 삼각측량 필요. 해결: contract section마다 current-rule 요약 + DR을 provenance로 |
| K65 tag comments | **확정하나 load-bearing** | DR/P0V/WP 태그 513개 — traceability gate이 소비. 대량 삭제 금지; tag→contract index 생성 제안 |
| K66 branch CI | **확정** | push trigger에 이 branch 없음; systemd/kernel/crash/macOS lanes는 hosted runner에서 구조적으로 NOT_RUN |

## 목록 외 신규 발견 (중복 통합) — rev2 판정 병기

**모델/사용자 표면**
1. **Extension tool이 Principal에 도달 불가(최혼란)** — Config Extensions UI에서 켜도 `permitted` name-set 밖 tool은 model에 보이지도 호출도 안 됨. UI가 기능을 암시하는데 이름표가 침묵으로 무효화. D25의 provenance 교체와 함께 해결 (`pi-extension.ts:38-42`, `tool-surface.ts:105`, `workspace-guard.ts:88-89`)
2. `/share` 허용 vs `/bug` 거절 — **rev2: 결함 아님 — 목록에서 제거**. 둘 다 사용자 호출+명시 동의(`/bug`는 "Pi developers" disclaimer+transcript 포함 여부+Upload/Export 선택). 차이는 수신자: `/bug`→engine 개발자, `/share`→사용자 본인 GitHub private gist 또는 Radius org artifact. Society env엔 `gh`/일반 `~/.config` credential이 없으나 adoption된 engine auth.json에 radius provider가 존재할 수 있어 무조건 inert는 아님 — 어느 쪽이든 simplification defect는 아님. recipient 기반 rationale만 문서화
3. `onPasteImagePath` 미차단 — image paste와 path paste가 비대칭으로 절반 동작
4. Worker `disabled` tool은 projection만 — **rev2: 보안 결함 아님(문서화된 모델)**. 성공적 projection 후 `refusal=null`이라 per-call fence 없음 — extension이 `setActiveTools`로 재추가 가능 **확인**(agent-session.js:914-926, ExtensionAPI 무제한). 그러나 TSP-009·arch:1471이 "투영은 권한 경계가 아니다"로 명시 — 실권한은 sandbox/capability. 잔여: Principal만 per-call fence인 비대칭은 제품 결정(`plan.disabled`를 영구 tool_call block으로 올리면 해소). invariant test 대상이지 fence 누락 아님
5. fail-closed brittleness — **rev2: 실제 개선 대상**. plan의 `disabled:` 이름이 live registry에 없으면 session이 OMA-only surface로 붕괴한 채 살아감 → built-in compatibility failure로 **명시적 start 실패**가 정답(사용자가 모델 성능 저하를 나중에 발견하게 하지 말 것)
6. `.pi/SYSTEM.md`/`APPEND_SYSTEM.md` — **rev2: mode별 분리**. Personal은 정상 Pi semantics 복원(세 핀 `systemPrompt:""`/`systemPromptOverride`/`appendSystemPrompt:[]`은 active suppressor라 `undefined`/필드 제거로 해제, no* flag도 반전). Society는 OMA prompt ownership 침해하지 않는 범위(위 C19). AGENTS/CLAUDE/skills는 Society에서도 지원
7. `/import`가 Personal에서도 거절 — 정상 Pi 기능
8. `!` shell이 Principal scratch cwd/`/usr/bin:/bin`에서 실행 — 사용자 기대와 다름
9. prompt 16KiB/16 waiting caps — Pi엔 없는 제한(방어 가능하나 visible)

**통신/프로토콜**
10. `OMA_PI_BOUNDARY_V1 ` magic-prefix를 `ctx.ui.notify`로 밀어넣는 stringly-typed 채널 — **rev2 확인**: notify wrapper→`extension_ui_request`로 전달(pi-interactive-host.ts:438-443, delivery.ts:14,122-131). typed 채널 전환 전 spike 필요: engine이 `extension_ui_request`의 임의 `method`를 통과시키는지 — 통과하면 `method:"oma.boundary"`+structured params로 전환(prefix parse는 decode-compat으로 잔류)
11. `safeToolPresentation`이 loaded extension의 `tools` Map을 mutate + `renderResult` default를 재구현해 drift (`interactive-display.ts:27-42`)
12. suggestion description을 `value — description` 문자열 스크래핑 (`pi-interactive-host.ts:399`)
13. `agent wait --observe`의 stdout JSON shape가 무계약 codec
14. credential line 철자가 3곳 (host-channel, principal-channel, cli-process inline)
15. `OMA_INCARNATION` env는 producer만 있고 reader 없음 — dead contract

**성능/구조**
16. unconfined `grep`/`find`가 호출마다 workspace 전체를 private snapshot으로 복사 + spawn (`contained-files.ts`, `contained-search.ts`)
17. streamed request는 quota scan 2회 (reserve+admit)
18. `views.refreshWorld`가 write txn마다 3 TSV 원자 재작성
19. `fsck --strict`가 submit마다 canonical object store 전체 대상 — **rev2: audit 사실 맞음, 최적화는 test 후**. `git fsck --full`이 기본값이고 alternates의 object pool까지 검사하므로 quarantine repo에서 canonical store 전체가 매 submit 검사 대상. 개선 설계: startup/recovery→canonical full fsck(`assertCanonicalHealthyAsync`, reconcile.ts:228-237), submit quarantine→candidate validation만. 단 `--no-full` 즉시 적용 금지 — bundle이 thin이라 prerequisite가 alternate에만 존재하면 `--no-full`이 canonical 손상을 submit 경로에서 놓침. **candidate reachable closure 검증이 기대 보장을 유지하는지 fixture로 먼저 증명** (NB-02와 연동)
20. `manifestOf` + tar가 export마다 society tree 2회 walk
21. boot마다 VM image 전체 hash — **rev2: 삭제 금지**. Ed25519 signature→manifest→file bytes streaming SHA-256은 **release integrity proof**(image.ts:39-73). size는 hash의 fast pre-check일 뿐이고 mtime gate는 없음 — mtime/size 기반 cache는 신뢰 수준을 낮춤. 비용은 실재하나 이 검사만이 "부팅 시점 bytes = 서명된 release"를 증명(dm-verity는 최초 블록 읽기까지 발견 지연)
22. unconfined Resident는 `process.env` 전체 상속 — 나머지는 모두 strip인데 denylist 방식 (pi-spawn-plan.ts:167-181)

**코드 잔재**
23. `settleByAcceptance` — 자기 docstring이 "no production caller"라 명시, test만 호출 — **rev2: 즉시 삭제 가능**
24. `readAttestation` export, caller 0 — **rev2: 즉시 삭제 가능**
25. quota config 8개 중 5개 필드 write-only (societyUnits, lineageUnits, principalReservedUnits, inferenceSlots, principalReservedSlots)
26. MAC-240 legacy intent canonicalizer — persisted intent의 "legacy spelling" digest 재계산 전용
27. 소유주 line 없는 unit을 위한 legacy owner 추론 (`units.ts:184-202`)
28. legacy bare Message-ID/QP 인코딩 수용 (`mail-values.ts:48-57`)
29. historical `git.integrate` plan 3번째 변형 + optional result shape (`durable.ts:222-228,566-568`)
30. `effortLevelsOf` — pi-ai의 private `getSupportedThinkingLevels`의 line-for-line 복제(public API는 active model만 답함)
31. in-process `setInterval` sweep vs `reconcile.service` oneshot — **rev2: 의도된 dual-mode이나 절반이 dormant**. 둘 다 같은 `ReconcileModule.sweep()`을 호출 — in-process(broker.ts:162-165, 비-systemd 모드)와 외부 oneshot(`host.js reconcile`→`host.reconcile` RPC, reconcile unit cgroup gate). 그러나 `ensureReconcile`에 production caller가 없어(test만) 외부 경로는 실질 도달 불가 → wire하거나 dormant pair 삭제/문서화
32. ~15개 committed generated store의 drift surface (production-*, implementation/*.json, evidence/dependency-graph)
