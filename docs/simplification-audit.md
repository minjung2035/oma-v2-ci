# 간소화 agenda 검증 — 항목별 판정 (2026-10-03, 에이전트 10개)

기준: 모델 surface(OMA prompt·authority·tool 표면)는 유지. 수정 대상 = ① 사용자가 납득 어려운 억제,
② Pi/OS 기능의 내부 재구현, ③ 과도 plumbing/과거 잔재, ④ 외부↔내부 불필요 간섭.
판정: 확정 / 부분 / 반박. 각 항목에 핵심 근거 file:line과 수정 방향.

## A. Pi 통합

| # | 판정 | 근거와 결론 |
|---|---|---|
| A1 RPC 재구현 축소 | **부분 — 교체 불가, 타입 재사용만 가능** | `protocol/jsonl.ts`, `runtime/pi-rpc.ts`는 OMA 소유지만 Pi의 `RpcClient`는 spawn/env/timeout semantics가 OMA의 isolation(clearenv, fd3/4/5/6, drain-based send, poison framing)과 충돌. `serializeJsonLine`/`attachJsonlLineReader`는 exports map에 없어 import 불가. 대안: `RpcCommand`/`RpcResponse`/`JsonAgentSessionEvent`(root-exported)를 send/onEvent 경계 타입으로 채택 |
| A2 wire type 수동 재정의 | **확정 — drift 위험 실재** | `PiEvent`+string discriminant가 곳곳에; exported type 대부분 shape 일치 확인(0.87.1). 미고정 mirror: `"To resume this session:"` literal, `PI_SESSION_*` strip list, `auth.json` merge shape. 수정: exported type 채택 + 나머지 literal을 engine-oracle test로 고정 |
| A3 builtin command mirror | **부분 — 불가피** | `PI_BUILTIN_COMMANDS`(pi-interactive-host.ts:52-54)는 test-pinned이나 Pi에 public builtin registry가 없음(0.87.1). `ExtensionRunner.getCommands()`는 extension command만 반환. 수정: pi-compat 격리 + upstream export 요청. `/trust`,`/bug`,`/import` 거절과 `/export` 재작성은 의도된 정책으로 유지 |
| A4 settings 직접 편집 | **부분 — 대부분 불가피** | retry 수치/keybindings/open-tui.json/theme/auth.json merge는 public setter 부재. `theme`/`telemetry` 등 일부는 setter 존재하나 비원자 write+다른 lock으로 net loss. OMA의 atomic multi-file writer(pi-runtime.ts:37-85) 유지, pi-compat의 자연스러운 자리 |
| A5 compat layer 잔여 | **확정 — 목록 확정됨** | API 없는 항목: retry.maxRetries/baseDelayMs/maxAgentDelayMs/provider.*, keybindings.json, open-tui.json, themes/*.json, auth.json merge, models*.json/bin 도구 adoption |
| A6 session 파일 해석 | **대부분 반박** | OMA는 첫 줄 header만 admission probe(session-history.ts:53-78) — 나머지는 전부 SessionManager 위임. SessionManager에 header-only API 없어 probe는 최소 경계. pi-compat 격리 대상 |
| A7 pi-compat layer 신설 | **확정 — 실현 가능** | Pi 접점은 이미 거의 집중(entry+runtime/pi-*+extension). 최대 surface: `InteractiveMode` private patch ~11개(두 entry), rendered-string probes, deep test imports. 격리 불가능: mail/ledger/sandbox/credential/session-birth |
| A8 exact pin | **확정** | `^0.87.1` caret + private-member patch + env/file-format mirror 조합은 위험. `pi-open-tui:0.3.9`는 이미 exact — 정책 통일 필요 |

## B. OpenTUI / interactive

| # | 판정 | 근거와 결론 |
|---|---|---|
| B9 InteractiveMode patch | **확정** | Society 8개+Personal 6개 private member patch(pi-interactive-host.ts:519-580, pi-personal.ts:59-278). 단 헤더/푸터/에디터는 pi-open-tui(OMA 소유)에서 정식 API 가능; `handleFatalRuntimeError`/`updateTerminalTitle`/`showSessionSelector` 등은 pi-coding-agent hook 필요 — OpenTUI 소유만으로 못 덮음 |
| B10 stdout.write override | **확정** | 2곳(host:453-455, personal:280-284). `fullscreenExitOutput`에 "none"/template이 없어 불가피했음. engine API 추가 시 제거 가능 |
| B11 ANSI branding | **확정** | `open-tui-brand.ts`가 rendered output을 문자열/regex로 재작성(logo/tagline/`Pi v~`/`~`/`Welcome`/`Ask Pi anything`/tip). open-tui.json brand fields 또는 `setBrand` API로 대체 가능 |
| B12 editor proxy | **확정** | `interactive-editor.ts`: onSubmit capture, actionHandlers set-trap, onPasteImage stub, handleInput/history wrap. Society만 해당(Personal은 미래핑). 정식 hook: submit delegate, command dispatch, bindAction, paste policy, input-admission bound |
| B13 bootstrap 중복 | **부분 — 정당한 차이 포함** | 13개 공유 패턴 실재(extension path resolve, preparePi*, brand, ExtensionModules, no* flags, reload/dispose wrap 등). 차이는 authority: Society는 ownedEditor/human_input/credential/fd5-6, Personal은 birth/keychain/re-exec. 정식 API 후 공통 helper |
| B14 image paste | **확정 — silent + half-supported** | `onPasteImage=()=>{}` + set-trap swallow. notice 없음. `onPasteImagePath`는 안 막혀서 path 붙여넣기는 절반 동작. protocol(`human_input` text-only)이 차단 — images 필드 또는 거절 notice 필요 |

## C. resource ecosystem

| # | 판정 | 근거와 결론 |
|---|---|---|
| C15 AGENTS.md 차단 | **확정 — Personal에서 납득 불가** | 모든 엔진에 `--no-context-files`/`noContextFiles`. Personal은 sandbox 없이 사용자 프로젝트 cwd에서도 차단(fixture가 명시적으로 검증). `agentsFilesOverride`로 vetted 파일 투입 가능, customPrompt와 양립 확인 |
| C16 skills 차단 | **확정** | `noSkills` + `enableSkillCommands:false` 이중. Personal/user-package skills까지 차단. `skillsOverride`/`additionalSkillPaths` 경로 존재 |
| C17 prompt templates | **확정** | `noPromptTemplates` + `expandPromptTemplates`가 `/oma-deliver` 전용(pi-interactive-host.ts:461) — 사용자 template은 미전개 literal로 전송됨 |
| C18 package resource | **확정** | `writePackageIndex`가 `resolved.extensions`만 사용하고 skills/prompts/themes를 버림(pi-packages.ts:154-175). 게스트에 파일은 가는데 인덱싱 안 함 |
| C19 project-local resources | **확정** | Personal에서 `.pi/skills`/`.pi/prompts`/`AGENTS.md`/`SYSTEM.md`/`APPEND_SYSTEM.md` 전부 차단. Society는 경계 방어 가능하나 사용자 표면에 미문서화 |
| C20 local extension 거절 | **확정 — 이유 해소 가능** | `REMOTE_SOURCE`만 허용(pi-packages.ts:55,114). Worker sandbox 가시성이 이유지만 package store snapshot이면 기존 보장(inside-store/no-links/digest) 유지 가능. Personal은 Worker가 없는데도 절대경로 거부 |
| C21 extension prompt guidance | **부분 — Society에서 silent drop** | `promptSnippet`/`promptGuidelines`는 Pi default prompt section에서만 렌더 — Society는 customPrompt라 도달 안 함(설치 extension의 guidance가 경고 없이 유실). Personal은 도달 |
| C22 Pi 기본 prompt 차단 | **확정 — 유지(verify only)** | 모든 Society 엔진 `--system-prompt` 적용. Personal만 Pi default 사용 |

## D. tool surface

| # | 판정 | 근거와 결론 |
|---|---|---|
| D23 DIRECT/GROUPED/DISABLED | **부분/반박** | built-in 맞으나 spec이 role file 선언을 요구(TSP-002, operations.ts:306-345). 생성 경로는 선언 안 씀(author-only). 사용자 노출 DAG 제거는 spec 개정 필요 — 코드 결함 아님 |
| D24 authority 분리 | **확정 — 유지** | enable(extensions list)과 authority(capabilities∩storedSpec, 매 요청 재계산)는 분리·검증됨 |
| D25 name-based allowlist | **확정 — 실패 모드 실재** | `pi-extension.ts:38-40`의 hard-coded name set. ① extension을 Principal에 켜도 tool이 model에 도달 불가 — UI가 거짓말(가장 혼란스러운 발견) ② name shadowing(permitted name으로 등록하면 통과) ③ built-in rename 시 silent 축소. 허가 판단을 tool effect/category 또는 명시 OMA policy로 이동 필요 |
| D26 golden compat test | **부분** | wire goldens/tool-name 세트/action enum 고정은 있으나, 전체 tool의 serialized schema·result envelope·unknown 표현의 골든 없음 |

## E. extension → OMA 통신

| # | 판정 | 근거와 결론 |
|---|---|---|
| E27 subprocess per call | **확정 — per-call이 문제** | tool call당 Node spawn 1 + socket ≥1(merge open은 ~4 connection). 경계 자체는 PI-001 closure + engine exec의 fd 전달 부재로 의도적이나, supervised persistent CLI(KeychainClient 패턴)로 spawn 횟수 제거 가능 |
| E28 CLI 이중 역할 | **확정** | freeze/replay/effects(file read, git resolve, context tree, bundle build)를 CLI가 소유 — extension이 runtime import 불가(PI-001)라 CLI가 사실상 client library. oma-client library 공유 또는 persistent helper가 해결책 |
| E29 FD3/FD4 plumbing | **확정하나 경계 내 필수** | credential env 노출 방지(socketpair)와 lease inheritance(abstract name lock)는 커널 수준 correctness — persistent helper에도 필요. 제거 가능한 것은 stdout parsing/exit-code/argv 인코딩 등 subprocess 기인 부분뿐 |
| E30 constant mirror | **확정하나 의도적** | mirror는 INV04 test-bound 선언 메커니즘. contracts leaf를 extension closure에 열지는 정책 결정. 발견: `OMA_INCARNATION`은 producer만 있고 reader 없음(dead contract); credential line은 3곳에 철자; `agent wait --observe` stdout shape는 계약 없음 |

## F. sandbox / 개발환경

| # | 판정 | 근거와 결론 |
|---|---|---|
| F31 outbound network | **확정 — capability cliff 실재** | `--unshare-all`(NIC 자체 없음). provider relay만 예외. npm/curl/git/pip/API 경로는 차단이 아니라 물리적 부재. `features.egress`는 schema에 있으나 false 고정 — 대체 경로가 아예 없음이 핵심 |
| F32 guest NIC 없음 | **확정 — schema에 NIC 없음** | VmConfig가 networkDevices를 표현 불가 — configurable이 아니라 하드코딩된 부재. 우회 인프라(egress pool/vsock)가 이 정책 때문에 존재 |
| F33 credential relay | **확정 — 유지** | fixed origin + slot-confined credential substitution + response tripwire + accept-encoding 강제. 좁고 정확 |
| F34 clearenv 완화 | **확정 — allowlist 자체가 없음** | `--clearenv` + 나열 setenv만. LANG/LC_ALL/TZ/TERM/TMPDIR/XDG 없음 — locale/시간대 기본값까지 사라짐(cliEnvironment만 LANG=C.UTF-8 예외). safe env allowlist + role env 필드 부재 |
| F35 PATH | **확정** | `RESIDENT_PATH_ENV`=`/opt/oma/<cli>:/opt/oma-node:/usr/bin:/bin`. user-local bin 불가. mount 정책이 실질 제한 |
| F36 DNS/CA/NSS | **확정 — latent gap** | resolv.conf/CA/nsswitch/localtime 미탑재. egress 활성화해도 즉시 동작 불가 |
| F37 rootfs/toolchain | **부분** | host /usr은 ro 노출이나 설치 불가·toolchain contract 없음. macOS guest image는 repo에 없어 검증 불가 |

## G. resource enforcement

| # | 판정 | 근거와 결론 |
|---|---|---|
| G38 workspace quota 전수 scan | **확정** | positive-growth write마다 전체 workspace 재귀 walk(workspace-guard.ts:26-85). write queue 직렬화라 incremental accounting으로 O(1) 가능하나 shell write 때문에 post-shell rescan은 필요 — "write마다"가 "shell call마다"로 줄어듦 |
| G39 society admission scan | **확정 — streamed는 2번** | reserve(preflight) + admit(dispatch)가 각각 state tree 전체 walk(quota.ts:98-130). same request 안에서 관측을 넘겨줄 수 있음 |
| G40 shell write 우회 | **확정 — confined만** | sandbox bash는 quota 미검사 후 쓰기 — 다음 scan에서야 발견. unconfined는 bash 자체가 차단 |
| G41 resource defaults | **확정 — 이미 configurable** | 2GiB/128/512MiB 실재하나 per-agentProfile 설정 가능(개별 agent는 아님). default 상향만 남음 |
| G42 run-start freeze | **확정 — 올바른 semantics** | accepted spec에 freeze, cgroup은 incarnation 재생성 없이 resize 불가라 정당. 작업 불필요 |

## H. macOS package plumbing

| # | 판정 | 근거와 결론 |
|---|---|---|
| H43 Darwin→Linux 복사 | **확정 — real risk** | 설치된 tree byte-copy — platform-conditional optionalDeps(esbuild/sharp/node-gyp)가 darwin 바이너리로 도착. tarball 전달 + guest `npm --offline`이 H43+H44 동시 해결 |
| H44 custom archive | **확정 — 정당화되나 bespoke** | no-network 전제의 산물; tar의 link/device/owner 표면을 의도적으로 배제. guest-native install이면 폐기 가능 |
| H45 generation sync | **확정 — host-store vs guest-generation 이중** | 파이프라인은 sound(~1200줄, idempotent)하나 guest가 resolver를 indexing에만 씀. guest-authoritative는 전제 변경 필요 |
| H46 symlink 생략 | **확정 — silent drop** | `.bin` shim·패키지 내부 symlink·`.git`·mode·mtime이 조용히 유실 — 최소 fail-or-record 필요 |

## I. config / pre-release baggage

| # | 판정 | 근거와 결론 |
|---|---|---|
| I47 v1→v3 migration | **확정 — droppable** | internal generation compat. 두 SQL + migration loop + deployment-asset 요구 + READABLE 축소가 비용 |
| I48 legacy attestation | **확정 — live wire path** | mail-v1 아닌 config에서는 지금도 production 경로(attestation.ts:37-45). 삭제는 I47과 연동(decode 유지 여부) |
| I49 legacy binding | **확정** | slug-only society 감지+명시 마이그레이션 UX. pre-release면 삭제 가능 |
| I50 engine-home adoption | **확정** | 매 기동마다 과거 per-society pi home을 merge(pi-runtime.ts:113-157). 일회성 코드가 영구 실행 |
| I51 inline vs managed | **부분** | commit owner는 통합됐으나 dual layout + roleSet 변환 + `--config` 표면 남음. inline은 bootstrap 경로라 완전 삭제는 대안 필요 |
| I52 generation machinery | **확정 — surplus 실재** | journal/retention budget/이전 generation 보존/legacy journal 파싱 — 그런데 **rollback basis를 읽는 코드가 아무것도 없음**. atomic bundle swap + revision/hash로 축소 가능 |
| I53 project→session 복제 | **부분 — 버그 아님** | 복제는 실재하나 derived cache로 동기화됨(rederive). 비용은 machinery이지 정합성 아님 |
| I54 dead ModelProfile | **확정** | 8개 required 필드 중 5개 미독(credentialRef, codecRevision, pricingRevision, maxInputTokens, maxOutputTokens) |
| I55 always-false flags | **확정** | notmuch/reflinkSeed/formalApproval/egress 모두 write-only |
| I56 usage ledger | **확정** | reserveUsage/settleUsage는 test와 diagnostic read만 — production caller 없음. quota 8개 중 5개도 write-only |

## J. process / systemd

| # | 판정 | 근거와 결론 |
|---|---|---|
| J57 .path wakeup | **확정하나 의도적 중복** | physical trigger(DB projection이 아닌 파일), armed-state durable record, sub-5s latency, broker-down 시 manager pull-up. broker direct activation은 mail-accept hot path에 N×60ms systemctl을 넣어 더 나쁨 |
| J58 transient units | **반박** | unit 파일은 identity/armed-state substrate: `X-OMA-Owner`, UnitFileState/enable, reboot 생존, cgroup peer-auth(requireRunnerUnit은 cgroup이 credential). transient은 이 전부를 못 줌 |
| J59 reconcile timer | **반박** | 대부분 durable op recovery + artifact GC + review advance + unit 관측. drift repair는 일부에 불과 |
| J60 ownership primitives | **부분 — 기질별 정당** | 7개 substrate(cgroup/process-group/direct-child/CLI/fd-lease/supervision-channel/transient)는 각각 다른 death proof. direct-child 계열만 grace→escalate→confirm 공통화 가능 |

## K. integrity / repo 구조

| # | 판정 | 근거와 결론 |
|---|---|---|
| K61 entry-only hash | **확정 — contract 결정 필요** | entry SHA만 고정, 상대 import는 unhashed. "호스트가 승인한 executable"이 계약이면 closure digest로 확장 필요; asset identification이 계약이면 현행 정확 |
| K62 ExtensionModules | **반박** | Pi의 jiti reload가 못 하는 native ESM `import()` re-identify를 수행. 유지 |
| K63 LOC/hash gate | **CI gate로 확정, runtime gate는 반박** | `check:inventory`가 committed-vs-fresh LOC 바이트 비교 — evidence integrity로 정당. comment/blank churn 마찰 있으면 code-lines-only compare로 완화 여지 |
| K64 doc archaeology | **확정** | current truth 재구성에 architecture(frozen)×DR1-30×spec 삼각측량 필요. 해결: contract section마다 current-rule 요약 + DR을 provenance로 |
| K65 tag comments | **확정하나 load-bearing** | DR/P0V/WP 태그 513개 — traceability gate이 소비. 대량 삭제 금지; tag→contract index 생성 제안 |
| K66 branch CI | **확정** | push trigger에 이 branch 없음; systemd/kernel/crash/macOS lanes는 hosted runner에서 구조적으로 NOT_RUN |

## 목록 외 신규 발견 (중복 통합)

**모델/사용자 표면**
1. **Extension tool이 Principal에 도달 불가(최혼란)** — Config Extensions UI에서 켜도 `permitted` name-set 밖 tool은 model에 보이지도 호출도 안 됨. UI가 기능을 암시하는데 이름표가 침묵으로 무효화 (`pi-extension.ts:38-42`, `tool-surface.ts:105`, `workspace-guard.ts:88-89`)
2. `/share` 허용 vs `/bug` 거절 — 같은 rationale(세션 내용 업로드)인데 하나만 거절됨 (`pi-interactive-host.ts:53,67-75`)
3. `onPasteImagePath` 미차단 — image paste와 path paste가 비대칭으로 절반 동작
4. Worker `disabled` tool은 projection만 — 성공적 projection 후 `refusal=null`이라 per-call fence 없음. Principal만 per-call fence. extension의 `setActiveTools` 재호출로 재추가 가능 여부는 미검증 (`tool-surface.ts:111,186`)
5. fail-closed brittleness — plan의 `disabled:` 이름이 live registry에 없으면 session start에서 전체 surface가 OMA-only로 붕괴
6. `.pi/SYSTEM.md`/`APPEND_SYSTEM.md`가 Personal에서도 사장 — append-only prompt조차 불가
7. `/import`가 Personal에서도 거절 — 정상 Pi 기능
8. `!` shell이 Principal scratch cwd/`/usr/bin:/bin`에서 실행 — 사용자 기대와 다름
9. prompt 16KiB/16 waiting caps — Pi엔 없는 제한(방어 가능하나 visible)

**통신/프로토콜**
10. `OMA_PI_BOUNDARY_V1 ` magic-prefix를 `ctx.ui.notify`로 밀어넣는 stringly-typed 채널 — typed extension→host event 필요
11. `safeToolPresentation`이 loaded extension의 `tools` Map을 mutate + `renderResult` default를 재구현해 drift (`interactive-display.ts:27-42`)
12. suggestion description을 `value — description` 문자열 스크래핑 (`pi-interactive-host.ts:399`)
13. `agent wait --observe`의 stdout JSON shape가 무계약 codec
14. credential line 철자가 3곳 (host-channel, principal-channel, cli-process inline)
15. `OMA_INCARNATION` env는 producer만 있고 reader 없음 — dead contract

**성능/구조**
16. unconfined `grep`/`find`가 호출마다 workspace 전체를 private snapshot으로 복사 + spawn (`contained-files.ts`, `contained-search.ts`)
17. streamed request는 quota scan 2회 (reserve+admit)
18. `views.refreshWorld`가 write txn마다 3 TSV 원자 재작성
19. `fsck --strict`가 submit마다 canonical object store 전체 대상 (NB-02와 연동)
20. `manifestOf` + tar가 export마다 society tree 2회 walk
21. boot마다 VM image 전체 hash
22. unconfined Resident는 `process.env` 전체 상속 — 나머지는 모두 strip인데 denylist 방식 (pi-spawn-plan.ts:167-181)

**코드 잔재**
23. `settleByAcceptance` — 자기 docstring이 "no production caller"라 명시, test만 호출
24. `readAttestation` export, caller 0
25. quota config 8개 중 5개 필드 write-only (societyUnits, lineageUnits, principalReservedUnits, inferenceSlots, principalReservedSlots)
26. MAC-240 legacy intent canonicalizer — persisted intent의 "legacy spelling" digest 재계산 전용
27. 소유주 line 없는 unit을 위한 legacy owner 추론 (`units.ts:184-202`)
28. legacy bare Message-ID/QP 인코딩 수용 (`mail-values.ts:48-57`)
29. historical `git.integrate` plan 3번째 변형 + optional result shape (`durable.ts:222-228,566-568`)
30. `effortLevelsOf` — pi-ai의 private `getSupportedThinkingLevels`의 line-for-line 복제(public API는 active model만 답함)
31. in-process `setInterval` sweep vs `reconcile.service` oneshot — 같은 sweep인데 drain handshake 유무가 다름 (dual-mode 의도적이나 미문서)
32. ~15개 committed generated store의 drift surface (production-*, implementation/*.json, evidence/dependency-graph)
