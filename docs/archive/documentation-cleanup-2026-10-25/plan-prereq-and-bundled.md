# v0.1 선행 작업 + bundled extension 설계서 (초안 — 반박 토론 대상)

> 초안: 조사 결과(8e36fc5a 설문 + 88af2adb 실제 tarball diff) 기반.
> 이 문서는 100% 신뢰 대상이 아니라 반박 에이전트와의 토론으로 확정할 설계다.
> 스펙 원문(사용자 지시 §7)은 WORKSTREAM.md §7에 요약돼 있다.

## 의존 순서 (중요 — 순서가 구현을 결정)

```
A. Pi 0.87.1 → 1.0.1 마이그레이션 (open-tui 0.3.11 + pi-tui 1.0.1 원자적)
        │   ← 이후 작업 대부분이 1.0 API 위에 놓임
        ▼
B. TUI 표면 4건 (compact tools, /thinking show, 큐 메시지, 메일 역할명)
        │   ← 독립 가능
        ▼
C. society-off 재설계 (세션 모드 전환 — 확정: 게이트+execve, §C)
        │
        ▼
D. bundled extension 스펙 (lsp → ask → hashline → web → mcp, §D)
```

A를 먼저 하는 이유: compact 도구 메시지의 정석 구현(`pi.registerToolRenderer()`)은
1.0.1 전용 API이고, open-tui 0.3.11은 peer dep `>=1.0.0`, pi-tui는 `^1.0.1` transitive라
별도 bump 시 이중 설치 위험이 있다.

## A. Pi 0.87.1 → 1.0.1 마이그레이션

**diff 판정 (88af2adb)**: 확정적 파손 없음. OMA의 26개 named import 전부 존재,
InteractiveMode private 11개 전부 유지(이스터에그 2개만 rename — 무관),
thinking/editor/renderer 계약 동일, built-in MCP는 `main()` 단일 주입이라
OMA programmatic 경로와 `--no-extensions` 양쪽에서 구조적으로 배제 증명.

작업:
1. `package.json` 원자적 bump: `pi-coding-agent@1.0.1` + `pi-tui@1.0.1` +
   `pi-open-tui@0.3.11` (peer dep 상호 요구). package-lock 갱신.
2. RPC 포팅: `pi-interactive-host.ts` `preflightResult: success => …` →
   `disposition`으로 rename, 성공 응답에 `data:{disposition}` 포함(spec conformance).
   `"queued"` disposition의 의미 검토 — 0.87.1에서 true로 취급됐으니 현재 동작 유지.
3. `setQuietStartup` 타입 확장(`boolean | "header"`) — 저장값 `"header"`가
   `pi-compat/settings.ts:104`에서 `true`로 평탄화되는 edge 확인.
4. open-tui 0.3.9→0.3.11 이식: `fullscreen-scroll.ts` 삭제(upstream이
   `fullscreenWheelScrollLines`로 대체 — OMA의 wheelScrollLines shim 제거 여부 확인),
   `icons.ts` unicode 모드, `footer.ts` sanitizeStatusPreservingStyles 변경과
   `brandFooter`/`brandHeader` 래핑 호환 확인, thinkingPeek tree-walk 유효성 재검증.
5. **must-test 목록** (88af2adb §8): loader lifecycle(`loadFinalExtensionSet` 재배열 +
   `extensionsOverride`/`safeToolPresentation` 타이밍), ownedEditor proxy E2E,
   session replace/reload, `_hasConversation`, pi-tui 이중 설치 점검(npm ls),
   `SessionSelectorComponent` 생성자 안정성.
6. 오라클 유지: `pi-compat.test.ts` private member 목록 — `checkDaxnutsEasterEgg`/
   `handleDaxnuts` 제거 반영 여부 확인(우리가 override 안 하지만 oracle이 pin할 수 있음).

### A 실행 결과 (1.0.1/0.3.11 이식 완료)

**버전**: `pi-coding-agent@1.0.1` + `pi-tui@1.0.1` + `pi-open-tui@0.3.11` 원자 bump
완료. `npm ls @earendil-works/pi-tui`는 단일 1.0.1을 상위에 dedupe로 둔다 —
pi-coding-agent의 중첩 `node_modules`에는 제3자 패키지만 남고 pi-tui/@earendil-works
사본은 없다(이중 설치 위험 제거). pi-agent-core/pi-ai는 `^1.0.1` 범위로 1.0.3에
묶였다(lockfile 고정).

**실제 upstream delta vs 예측 (§A 작업과 대조)**:
- 예측대로: `preflightResult`가 `boolean` → `PromptDisposition`(`"handled"|"queued"|"started"`)으로
  바뀌고 성공 `RpcResponse`에 `data:{disposition}`가 생겼다. `QuietStartup`은
  `boolean | "header"`. `handleDaxnuts`/`checkDaxnutsEasterEgg`는 실제로 0.87.1
  private 선언에 있었고 1.0.1에서 제거됐다 — 둘 다 OMA pin 목록에 없어서 무관.
  `registerToolRenderer`/`ToolExposure`/`ToolRendererResolver`는 root export에 있다.
- 예측과 달랐던 점: InteractiveMode private surface의 11개 pin은 **전부 그대로**
  (실측: `shutdown` 등 12개 전원 function으로 존재). `InteractiveMode.d.ts`의 다른
  변화는 신규 private(shouldShowStartupHeader/shouldShowStartupDetails/
  offerRadiusMcpServer 등) 추가뿐 — OMA가 override하는 member는 하나도 안 바뀌었다.
  내장 명령 집합(`BUILTIN_SLASH_COMMANDS` + `/debug`/`/arminsayshi`/`/dementedelves`
  unlisted)도 동일 — `PI_BUILTIN_COMMANDS` 미러 그대로. `SessionSelectorComponent`/
  `ModelSelectorComponent`/`ThinkingSelectorComponent` 생성자, `SessionManager`
  static(create/open/continueRecent/listAll), `ToolDefinition`의 render 계약,
  `ResourceLoader`/`ProjectTrustStore` 생성자 전부 호환 — typecheck 0 오류.
- 신규 관찰: `SessionManager._hasConversation()` 추가(setup-only entry는 대화로
  세지 않아 빈 session 파일 생성 억제). `loadFinalExtensionSet`은 pre-trust 결과
  인자/`loadExtensionPaths`/replacement warning/runtime 반환으로 재작성됐으나
  `extensionsOverride`는 최종 로딩 뒤에 적용되는 타이밍 그대로 — OMA의 override가
  여전히 마지막 재배열 지점. pi-tui 1.0.1은 `TuiAltScreen.wheelScrollLines`와
  `TuiMouseEvent.wheelDelta`를 추가했다.
- **한계**: 88af2adb/8e36fc5a 두 분석 커밋은 이 clone의 object database에 없어
  그 diff 자체를 재독할 수 없었다. 위 판정은 실제 npm tarball(0.87.1↔1.0.1,
  open-tui 0.3.9↔0.3.11)을 직접 diff해 낸 것이다.

**포팅 결정**:
1. RPC (`pi-interactive-host.ts`): 콜백 인자를 `disposition`으로 받고 성공 응답에
   `data:{disposition}`를 실는다 — upstream `rpc-mode.js`가 같은 지점에서
   `success(id,"prompt",{disposition})`를 쓴다. 세 disposition 전부 수용=성공
   (거절은 prompt() promise reject로만 온다). OMA 소비자(adapter/delivery/session)는
   `success===true`만 읽으므로 `data`는 additive. `input_result.queued`는 여전히
   `session.ts`의 `busy` 스냅샷 — disposition이 응답보다 늦게 오므로 그 의미 그대로.
2. `quietStartup`: 저장값 `"header"`를 Boolean으로 평탄화하던 것을 literal 통과로
   교체(`1.0.1`에서 `"header"`는 header만 보이고 details는 숨기는 세 번째 값).
   회귀 시험 추가(pi-compat.test.ts).
3. open-tui 0.3.9→0.3.11: OMA는 vendored 사본이 없고 `pi-open-tui/extensions/open-tui/index.ts`를
   그대로 resolve한다. 0.3.11 diff는: `fullscreen-scroll.ts`와 `fullscreen` config
   삭제(휠 스크롤은 Pi 1.0.1의 `fullscreenWheelScrollLines` 설정 필드 — InteractiveMode가
   `renderer.setWheelScrollLines(settings.getFullscreenWheelScrollLines())`로 읽고
   비수치/미설정은 `"auto"` — + pi-tui 네이티브가 소유; OMA shim은 원래 없었고 추가할 것도 없다.
   `editor.ts`의 `applyFullscreenWheelScrollLines` plumbing과 open-tui 소유
   `setWheelScrollLines` setter도 함께 사라졌다 — OMA editor proxy는 그 계약을
   호출한 적이 없다),
   `icons.ts`에 `"unicode"` IconMode + SSH 자동 선택, `footer.ts`가
   `sanitizeStatusPreservingStyles`로 교체(확장이 칠한 SGR 유지 — OMA는 plain status만
   쓰므로 무영향), `settings-command.ts`에서 휠 UI 제거. `header.ts`/`peek.ts`/
   `state.ts`/`runtime.ts`/`session-lifecycle.ts`/`git.ts`/`telemetry.ts`는 byte-identical —
   `brandHeader`의 anchor(`Pi v{VERSION}` top border, tagline, Welcome, tips)와
   `brandFooter`의 `~` cwd는 그대로이고 `thinkingPeek` tree-walk 가정도 유효.
   open-tui.json에 남은 옛 `fullscreen` 키는 0.3.11이 읽지 않는 inert 키.
4. `PI_ADAPTER_REVISION` → `oma-pi-rpc-v1@1.0.1` (delivery.ts + delivery-receipt.ts +
   spec BATCH-006 + traceability 재지문) — ENG1(a218a0f)의 관례대로 "검증한 엔진"을
   이름에 박는다. 미정산 영수증은 업그레이드 뒤 conflicting — 기존 society는 정산 뒤
   올리는 절차가 그대로 적용된다.
5. 오라클: `PI_INTERACTIVE_PRIVATE_MEMBERS` 12개 전원이 1.0.1 prototype에 function으로
   존재해 목록 변경 없음 — 문서상 버전 문자열만 1.0.1로 갱신. `#10 spike`의 version pin도
   1.0.1로 옮기며 `createExtensionUIContext`가 여전히 고정 메서드만 노출함을 재확인.

**must-test 결과**: typecheck 0 오류; `pi-compat` 오라클 전부 PASS(환경 스트립 목록·
resume hint·private member 존재); interactive-input 내장 명령 미러 PASS;
open-tui-pty 8 ending + personal-pty 15 ending이 실제 1.0.1 InteractiveMode +
0.3.11 확장 + ownedEditor 프록시로 `/new`·`/resume`·`/fork`·`/reload`
(update·failure 양쪽)·kill·retry 통과 — loader lifecycle(`extensionsOverride`
재배열, upstream 필수 검증), ownedEditor E2E, session replace/reload,
`_hasConversation`(빈 session 미생성), SessionSelectorComponent 실경로를
커버한다. pi-tui 단일 설치 확인은 위.

## B. TUI 표면 4건 (A 이후, 상호 독립 — 병렬 분업 가능)

### B1. compact 도구 메시지 — **확정: 외형+핵심 동작** (pi-compact-tools 이식, OMA 네이티브)

사용자 확정: **외형(compact 행·접두어 제거·회색배경 제거) + 핵심 동작(live state
indicator, "Done in Xs · N lines" 컨트롤 행, 인자 확장)**. 명령/silent/config/theme
자산은 제외. `oma_` 접두어는 **표시명만** — wire/tool 이름 변경 금지.
- **정석 경로**: `pi.registerToolRenderer(resolver)` (1.0.1 공개 API)로
  `renderShell:"self"` + compact `renderCall`/`renderResult` 등록 — prototype patch 불필요.
  이게 `npm:pi-compact-tools`의 compact style을 "가져오는" 정확한 의미:
  **style을 포팅하되 mechanism은 upstream 패치가 아니라 OMA 소유 renderer**.
- 대상: **Principal에 노출되는 OMA 도구만** — 표시명 정리:
  `oma_mail_send`→`mail send`, `oma_mail_read`→`mail read`, `oma_merge`→`merge`,
  `oma_challenge`→`challenge`, `oma_status`→`status`, `oma_society`→`society`,
  `oma_agent_lifecycle`→`agent lifecycle` (oma_ 접두어 제거, snake→space).
  Principal에도 보이는 Pi 기본 도구(read/ls/grep 등)는 compact chrome으로
  감싸되 이름은 그대로.
- 회색 배경: `renderShell:"self"`가 bg shell을 아예 안 씀(theme 편집 불필요).
- 위치: `packages/tui/src/compact-tools.ts`(renderer) + OMA extension에서 등록.
  Worker/Resident에는 적용 안 함(Principal만 노출 — tool surface에서 이미 닫힘).
- `/compact-tools` 사용자 명령은 만들지 않음 — OMA 기본 surface 정책으로 compact가 상시.
- 제외할 upstream 잔재: `compact-tools.json` 설정, silent mode, claude/codex 스타일,
  theme 자산, `/compact-tools` 명령, viewport/silent render patches.

### B2. `/thinking show` 토글
- **반박 수정**: `/thinking`은 Pi builtin이라 `extensionCommand`가 절대 못 봄 —
  `src/pi-compat/prompt-editor.ts`의 **ownedEditor submit 체인에서 isCommand/builtin
  라우팅보다 먼저** `show|hide` 정확 일치를 가로챈다. bare `/thinking`은 upstream
  level 선택에 그대로 통과.
- private `toggleThinkingBlockVisibility()` 호출(공개 API 없음 — oracle에 member
  pin). deterministic setter가 있으면 그쪽 우선. 색은 기존 thinking indicator의
  theme 색 재사용. `hideThinkingBlock` persisted setting도 함께 갱신 + 재렌더 검증.

### B3. 미전송 큐 메시지 표시
- OMA 자체 큐(`session.ts` `waiting[]`) — Pi 네이티브 큐 행과 별개.
- host→engine `queued_prompts` 이벤트(UI socket, PiEvent는 open-typed라 wire 변경 없음)
  → engine이 `ctx.ui.setWidget("oma-queue", lines, {placement:"aboveEditor"})`로 표시,
  비우면 `setWidget(key, undefined)`. S 노력 — 공개 API만 사용.

### B4. 메일 TUI 역할명 가독화
- 메일 목록/상세 진입 전 발신자/수신자 표시를 `worker`(전체 전송)/`worker1` 등
  (개별)/`principal`로 매핑 — 현재 애매한 역할명 대신 roster 기반 표시명.
  위치: `packages/tui/src/` 메일 뷰어(transcript/mail 패널) + 표시명 유틸 — 조사 후 확정.
- (별도 완료) Worker 프롬프트의 메일 제목 지시는 fix/pg2가 처리.

### B 실행 결과 (B1–B4 구현 완료, 커밋 분리)

- **B1 — `88ea1be`**: `pi.registerToolRenderer()` 공개 seam으로 `renderShell:"self"`
  compact renderer 등록(`packages/tui/src/compact-tools.ts`). live 상태 점·한 줄 인자 요약·
  `Done in Xs · N lines` 컨트롤 행·인자/출력 확장, `oma_` 접두어는 표시만 제거 —
  wire/registry 이름 불변. author result renderer는 확장 본문에 보존, 인디케이터
  리페인트는 보이지 않는 belowEditor 위젯의 `requestRender()`로 구동. 타이밍은
  `COMPACT_TOOL_BOUNDS`로 한정.
- **B2 — `c1e6f10`**: `ownedEditor` submit 체인이 `isCommand` 라우팅 **앞에서**
  정확히 `/thinking show`·`/thinking hide`만 가로챈다 — bare `/thinking`과 다른
  인자는 Pi에 통과. Pi가 setter를 안 노출하므로 `hideThinkingBlock` 필드를 읽고
  `toggleThinkingBlockVisibility()`는 상태가 다를 때만 호출 — deterministic.
  private member+field는 compat 선언과 oracle 테스트로 pin.
- **B3 — `f72bc6f`**: OMA 자체 `waiting[]`가 단일 출처. 큐 변이마다
  `queued_prompts` 스냅샷을 interactive channel로 송신하고 엔진은
  `ctx.ui.setWidget("oma-queue", …, {placement:"aboveEditor"})`로 표시, 빈 큐·
  handback·shutdown에서 `undefined`로 제거. 위젯 행은 한정·sanitized, 실제
  제출 문장은 불변.
- **B4 — `617dce1`**: 메일 목록/상세 발신자와 상세의 새 `To:` 행이 roster
  기반 표시명(`packages/tui/src/mail-names.ts` 순수 매핑): `residents`/`commons`→
  `worker`(전체 전송), roster의 `worker<N>`(이름순, `principal` 제외)는 개별
  발신/수신자, `principal`, `topic-<x>`→`topic/<x>`. roster는 broker 발행
  status view의 agent 목록 — 미관측 시 actor명은 헤더 원문 유지(추측 금지).
  `readMailbox(paths, roster)`가 표시명을 만들고 내구 EML/logical `to` facts는
  불변. To 없는 메시지는 `To:` 행 자체가 없다.
- **보수 — `6c91bef`**: host-ownership fixture의 dependency map에 B1의
  `compact-tools` import와 B3의 `setWidget` seam이 누락돼 있던 것을 보강.

## C. society-off 재설계 — **확정: 게이트 + execve 재진입**

- 사용자 확정: **기록 없는 미사용 세션 → 게이트 → 표준 provisioning → 정상 종료 →
  execve 재진입(society birth)**. 세션 내 모드 교체는 불가(레이아웃/정체성 다름),
  chooser는 주 경로 아님, `RESUME_SESSION_ENV`는 fresh society에 해당 없음.
- 게이트(반박 확정): unbound project/session이 proxy — `observeProjectBinding`
  kind !== "bound"이면 기록 없는 미사용 세션. 기존 unused-cleanup 의미론과 동일
  선을 쓴다.
- 구현 위치: `/society`(가칭 — 최종 명령명은 구현 에이전트가 표면 조사 후 제안)를
  extensionCommand로 받아 → 게이트 검사 → 실패 시 이유 메시지 → 통과 시 정상 종료
  경로 + execve 재스폰 인자로 society birth. reload/powercut 중간 상태는 birth
  기록이 durable한 시점에 정직하게 답한다.
- 명령 표면: `/society` 하나. `oma society` CLI 별칭은 후속 — v0.1 범위 밖.

### C 실행 결과 (게이트 + execve 재진입 구현)

- **명령 확정 — `/society`**: 표면 조사 결과 Personal 경계는 이미 `/oma`(Config)
  하나를 등록하고 엔진 명령(`/import` 등)을 섀도하지 않는다. `/society`는
  Personal birth의 `boundary` 팩토리가 등록하는 두 번째 명령 — Society TUI나
  Pi 내장 명령과 충돌 없음. `oma society` CLI 별칭은 계획대로 v0.1 범위 밖.
- **게이트 — `src/runtime/society-slot.ts`**: 프로젝트 자신의 슬롯
  `<data>/<projectSociety(cwd)>`(`projectSociety` = `defaultSocietyFor(cwd,
  sha256(cwd))` — DR24의 프로젝트 명칭 그대로)를 읽기 전용으로 판정한다.
  `observeProjectBinding`이 bound면 그 기록을 이름으로 거절, unreadable·
  unavailable은 부재로 승격하지 않고 거절, `stateRootHasSociety`(unused
  cleanup이 쓰는 동일 술어)가 참이면 binding 없는 pre-binding 상태로 거절.
  birth record(`session-mode.json`)는 unused-cleanup이 무시하는 잔여이지만
  birth로서는 내구 기록이므로 재진입이 게시할 것과 같은 것만 잔여로
  인정하고 다른 것은 거절. legacy slug 슬롯은 I49의 fail-closed 거절과 같은
  선. 게이트 자체는 아무것도 쓰지 않는다.
- **전환**: `/society` → 게이트 free → `session_before_switch`(cancel 가능)
  → IPC `{type:"switch", society}` → `InteractiveMode.shutdown()`의 실제
  종료 → host(`personal-host.ts`)는 자식 종료 후에만 프로젝트 명칭과
  일치하는지 검증하고 `process.chdir(세션의 birth cwd)` 뒤
  `process.execve(… oma.js --society <project>)`. `RESUME_SESSION_ENV`는
  삭제되고 저장 history는 재개되지 않는다 — 재진입한 `oma --society`가
  표준 binding 게시·`publishSessionBirth`·provisioning을 그대로 수행한다.
- **내구 경계**: 게이트↔재진입 사이는 무기록 구간이다. kill/powercut은
  다음 `/society`가 같은 슬롯을 재관측하는 것으로 끝난다. 슬롯에 binding이
  게시된 뒤(`publishProjectBinding` — no-replace link + fsync + reread)의
  재시작은 그 Society를 born으로 인식하고 `/society`는 거절, 직접
  `oma --society`는 기존 재개 경로를 탄다. 미확정 게시는 성공으로 승격하지
  않는다(`publishProjectBinding`이 그대로 실패로 돌린다).
- **macOS**: Personal의 `/society`는 전환 없이 거절한다(숨은 VM의 Society는
  앱이 소유 — MODE-006 계약 변경 없음).
- **테스트**: 게이트 실파일 8종(test/society-slot.test.ts — free/바인딩
  게시 전환/다른 프로젝트 바인딩/손상 바인딩/관측 불가/pre-binding 기록/
  동일 birth 잔여·다른 birth/legacy), wire 문법(society 전용·혼합 거절·
  실패 종료 시 handoff 없음 — personal-session-ownership), host 합성(execve
  인자·no RESUME·실제 종료 후·이름 불일치 거절·execve 불가 —
  personal-host-composition), 엔진 합성(등록·free 전환·거절 통지·darwin 거절·
  cancel·직렬화·send 실패 재시도 — personal-engine-ownership).
- **라이더**: `Indicator.drawnAt` 제거 — 아무 곳에서도 읽지 않던 장부.

## D. Bundled extension 스펙 (원문 = WORKSTREAM §7 — 초기 계획안 취급)

**구현 순서 확정(반박)**: lsp → ask → hashline → web → mcp. lsp가 런타임 dep 0이라
vendor harness(매니페스트/무결성/자산 복사)의 첫 연습 대상. 각각 독립 커밋+테스트.

**egress 확정(사용자)** — *S-07/SB-004 보류의 재개*: design-revisions.md는
"project egress(의존성 fetch proxy)는 v1에 없다"를 기록한다(SP-07-A spike가
결과 없이 닫힘). 이 작업은 그 보류를 사용자 지시로 되돌리는 스코프 변경이다.
재개 시 문서상 조건(SB-004/SP-07-A, 구현이 따라야 할 MUST):
- Human이 설정한 endpoint 외 연결 거절(allowlist가 정책의 정의)
- OPTIONAL 노출 — `UNSUPPORTED_PROFILE` 거절을 조건부 허용으로 교체
- S-01 escape 시험 통과 + host network 공유로 대체 금지(`--unshare-all` 유지)

web/lsp/mcp 도구는 **Principal과 Worker 모두에 제공** —
그리고 범위는 도구만이 아니다. Resident의 `--unshare-all` 아웃바운드 부재로
`npm install`/`git clone https`/pip/cargo도 현재 전부 불가 → **OMA host egress를
범용 HTTP CONNECT 프록시로** 설계(inference relay의 bind-mount 소켓 패턴 확장):
- Resident env에 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`(+npm/git proxy 설정)
  주입 → 패키지 매니저·https git이 그대로 동작.
- 프록시가 정책 지점: 도메인 allowlist, 사설IP/내부대역 차단(SSRF), credential
  헤더 스트립, 감사 로그. raw host network/credential 비노출 원칙 유지.
- SSH git clone·raw TCP/UDP는 범위 밖 — 필요 시 같은 경로에 SOCKS5 추가
  (SSH는 ProxyCommand 경유 가능) — v0.1는 CONNECT만, SOCKS는 후속 결정.
- 도구 트래픽(web/mcp/lsp)도 같은 프록시를 경유 — 역할별 정책 차등 가능.
- **기반 재사용(조사 확인)**: 기존 EgressHost(`src/platform/host/egress.ts`)에
  커넥션 풀/placeholder 수명/lease/boot 무효화가 이미 있음 — `egress.open`은
  현재 provider-origin 하드바인딩 InferenceRelay 전용. 범용화 = `egress.connect`
  (목적지+정책검사) 메서드 추가 + 정책 엔진 — 새 서브시스템이 아니라 확장.

**반박 필수 교정 3건**:
- workspace-guard 이름 갭: `replace`/`replace_within`/`insert`/`lsp_fix`가
  PATH_TOOLS/WRITE_TOOLS에 없으면 경로·읽기전용 게이팅 우회 — 표 추가 필수.
- vendored 런타임 deps: hashline `diff`/`file-type`/`xxhash-wasm`, mcp
  `@sinclair/typebox`/`zod` 등 — vendor snapshot에 같이 둠(런타임 fetch 금지).
- multi-file vendor 무결성: 기존 단일파일 검사로 부족 — vendor 번들 단위
  digest+매니페스트, 누락/손상 시 startup fail-closed.
- per-role tool-surface 표: Principal/Worker 각각 어떤 도구가 surface되는지 명시
  표 — surface 계획이 실제 존재하는 도구만 참조하게(없는 도구 참조 = 기동 거부).

구현 단위:
1. **ask_user_question** (OMA 네이티브 — vendoring 아님, UI/authority 소유).
   스키마는 rpiv-ask-user-question 2.12.0 호환 (question 1-4, header,
   option 2-4{label,description,preview?}, multiSelect, custom 항상 가능,
   일괄 답변+submit, cancel structured result, machine-readable details).
   위치 `packages/extension/src/ask-user-question.ts` + `packages/tui/src/ask-user-question/`.
   DIRECT 노출. Worker schema 미노출(role surface에서 닫힘).
   OpenTUI 정식 hook 추가(private hack 금지 — OMA 소유니까).
2. **hashline** — `packages/tool-hashline/src/vendor/pi-hashline-edit-pro/` vendored.
   anchors+replace/replace_within/insert+validation+stale refusal+post-edit diff.
   write는 OMA contained fs/quota 경유. 기존 edit와 장기 공존 금지 — 수렴 시점 명시.
   제외: copy/move/anchor_grep/undo/config UI/global state.
3. **pi-lsp** — `packages/tool-lsp/src/vendor/pi-lsp/` vendored. tools:
   lsp_diagnostics/lsp_fix(preview 기본, 실제 write는 contained writer)/lsp_status.
   OMA wrapper가 spawn/cancel/death/root/PATH/bounds 소유. server 미탑재=unavailable
   (clean과 구분). per-call lifecycle 유지(daemon은 benchmark 없이 만들지 않음).
   Principal에 write authority 부여 금지.
4. **pi-web-access** — vendored. tools 4개 그대로. cache root=agent-owned HOME,
   host cookie/Keychain/gh credential 자동발견 금지, allowBrowserCookies·answer
   model 기본 OFF. SSRF/redirect/output bounds 유지.
5. **pi-mcp-adapter** — vendored. OMA GROUPED 재래핑 금지(upstream 자체 lazy+proxy).
   기본: surface `mcp` 1개, downstream direct exposure OFF, script OFF, lazy,
   metadata cache, Pi 1.0 built-in MCP와 동시 실행 금지(**A의 증명: built-in은
   OMA 경로에 존재하지 않음 — 이 검증을 테스트로 pin**). host config/credential
   상속 금지.
6. **Tool surface 기본 구성** — DIRECT: core+hashline read+write+ask_user_question+mcp.
   root groups: file_edit{replace,replace_within,insert},
   code_intel{lsp_diagnostics,lsp_fix,lsp_status},
   web_research{web_search,source_check,fetch_content,get_search_content}.

경계 원칙(스펙 §7): extension이 role/authority를 바꾸지 않음; vendored source는
각 `packages/tool-*/src/vendor/`에 upstream snapshot+MIT notice+manifest; runtime fetch 금지;
user packages와 분리; upstream code+tests 최대 재사용, OMA 경계는 얇은 adapter;
깨진 vendor 파일은 startup fail-closed + deployment digest 포함.

테스트: upstream tests 재사용 + 조합 경계(동시 로드 시 name collision 없음,
intended surface 정확, hidden 미활성, idempotent reload, provenance, 격리)
+ 각 extension 경계 목록(스펙 §8 원문) + packaging test.

## 반박 토론 수렴 — **해결됨**

1. A 선행 확정 — registerToolRenderer/`ToolExposure:"hidden"`은 1.0 전용이라
   B1(정석 경로)과 D(hidden 도구)가 A에 의존. B2/B3는 0.87에서도 가능하나
   단일 Pi 버전 전환 비용이 더 싸서 A 먼저.
2. OMA 자체 renderer 채택 — patch 불필요, safeToolPresentation 보존.
3. B2는 submit 체인 인터셉트로 교정됨(위).
4. C는 게이트+execve로 사용자 확정(위).
5. hashline 기존 edit와의 수렴: v0.1은 공존, 수렴은 별도 결정으로 보류.
6. egress 프록시는 사용자 확정 — web/lsp/mcp를 Principal+Worker 모두 제공.
