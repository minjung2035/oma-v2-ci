# OMA v2 — 현재 검증 상태

이 파일이 current verification status와 검증 명령의 단일 owner다. README/HANDOFF에는 test count, LOC, PASS 표를 중복 기록하지 않는다.

## 현재 source 판정

브랜치 `refactor/safety-preserving-architecture`, 검증 대상 작업 트리의 부모 `07226da`, 실행일 2026-09-20. 날짜별 누적 기록은 두지 않는다. 지난 판정은 Git history에서 조회하고, 아래는 현재 tree의 사실만 적는다(MAINTENANCE §29).

검증 입력: verification input digest `c67653e59af4f9c923867df9574ffe3d83c5a778f1b7a5a08e1fcdcd63673a58` (523 files). 로컬 판정을 결정하는 실행 source, tests, scripts, package/TypeScript 설정, production manifest·LOC 산출물, implementation 계약·owner·trace·systemd·architecture 문서와 CI workflow의 경로·내용을 경로 순으로 해시한 값이다. `implementation/validation.md` 자체는 이 한 digest field만 정규화하고 나머지 바이트를 포함한다. runtime log와 생성 adversarial report는 판정의 출력이므로 제외한다. commit 이름은 어느 revision을 뜻했는지만 말하고 어떤 working-tree 바이트를 검증했는지는 말하지 않으므로, 아래 결과는 이 digest에 묶인다. 입력이 바뀌었는데 다시 실행해 다시 적지 않으면 `R38`이 실패한다.

### 실행 결과

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:package` | PASS. entries 4개(broker/runner/host/tui), runtime dependency 4개 pin |
| `npm run check:architecture` | PASS, 0 findings |
| `npm test` | **1128/1128 PASS**, fail/cancelled/skipped/todo=0 |
| `npm run test:functional-surface` | PASS (release qualification 아님) |
| `npm run check:inventory` | `SOURCE_LIST_CURRENT`, `loc: SOURCE_BOUND` (cloc 2.08로 재측정해 일치) |
| `npm run verify:fast` | PASS, EXECUTED |
| `npm run verify:durable` | PASS, EXECUTED |
| `npm run verify:property` | PASS, EXECUTED |
| `npm run verify:stress` | PASS, EXECUTED |
| `npm run verify:kernel` / `verify:crash` | BLOCKED, NOT_RUN (이 세션은 `OMA_TEST_SYSTEMD=1`인 disposable user 환경이 아님) |
| GitHub Actions current-SHA | NOT_OBSERVED (push 완료, 이 세션의 `gh` 인증 없음) |
| `node scripts/loc.mjs` | **217 files / 20,342 code LOC** |

### 현재 범위

이 tree는 Core 위에 세 가지를 얹은 상태다.

- **제품 표면(TUI)** — `oma` 단일 진입점, 대화 화면과 `Ctrl+X` Control Panel(Dashboard/Config/Mail). 규범은 architecture §23, spec의 TUI 요구, test-matrix T91–T106.
- **Extension tool 표면 투영** — role별 DIRECT/DISABLED/GROUPED 투영. 규범은 architecture §23.10, spec의 TSP 요구, test-matrix T99–T103.
- **엔진 동봉** — Pi를 함께 배포하고 자기 것만 실행하며, 설정 파일 없이 기동한다. 규범은 architecture §23.3, spec의 TUI-016–019, test-matrix T105–T106.

### 실제 프로세스 경계 검증에서 찾은 결함

단위 테스트는 산술만 고정한다. 실제 엔진·실제 pty·실제 SIGKILL을 붙이자 단위 테스트가 잡을 수 없는 결함 1건이 나왔다.

- **투영이 설정된 role에서 core extension이 로드에 실패했다.** `registerToolSurface`가 로드 시점에 `pi.getAllTools()`를 호출했는데 엔진은 "Action methods cannot be called during extension loading"으로 거절한다. 결과는 extension 전체 로드 실패였다. 등록은 로드 시점에, 투영은 `session_start`에 하도록 고쳤다. 모델 턴보다 먼저이므로 봉쇄 의미는 유지된다. 단위 테스트도 이 계약(로드는 성공, 투영은 session_start)을 반영하도록 고쳤다.

`npm run test:functional-surface`는 동봉 엔진을 RPC로 띄우고 **엔진 자신에게** 활성 tool을 물어 확인한다. 관측: 등록 11개 중 활성은 `read`(DIRECT), `oma_group_probe`(root facade), OMA 소유 4개이며 `write`(DISABLED)·`grep`(GROUPED)·`edit`/`find`/`ls`(defaultMode)는 비활성이다. group 열기는 모델 턴이 필요해 provider 없는 이 프로필에서는 관측하지 못했고 skip으로 보고한다.

TTY는 `script`로 실제 pty를 띄워 raw mode 취득·복원과 크기 보고를 확인한다. 설정 쓰기는 쓰기 전후 각 경계에서 실제 SIGKILL을 걸고, 남은 파일이 항상 loader를 통과하며 임시 파일이 남지 않음을 확인한다.

관측 extension은 `test/fixtures/surface-probe-extension.ts`이며 test 전용이다. production 의존 closure에 들어가지 않고 tool을 등록하지 않는다(TEST-002).

### 적대적·결합 검증에서 찾은 결함

`test/surface-adversarial.test.ts`와 `test/surface-core-coupling.test.ts`를 추가하면서 실제 결함 1건을 발견하고 고쳤다.

- **Extensions 화면이 설치 디렉터리 밖 경로를 role 파일에 쓸 수 있었다.** `toggleExtension`이 caller가 준 id를 봉쇄 검사 없이 받아, `../outside.js` 같은 값이 role 파일에 기록됐다. 다음 시작에서 loader가 거절하므로 설정이 깨진 채 발견되는 형태였다. TUI-010의 "임의 경로 추가 금지"를 owner가 직접 집행하도록 고쳤고, 목록 생성과 toggle 양쪽에 realpath 기반 봉쇄를 적용했다.

나머지 적대적 경로는 이미 올바르게 동작했다: bundle 밖 참조 거절, 손상된 host/role 파일을 추측으로 덮어쓰지 않음, 퇴화한 터미널 크기(1x1까지)에서 폭 초과 없음, 이름 문법·description 한도 집행, 비정상 mail 항목(디렉터리·심볼릭 링크·바이너리·빈 파일)에서 예외 없이 표시.

결합 검증은 생성된 설정이 core의 닫힌 validator를 그대로 통과하고, capability·resource·limit이 core 어휘 안에 있으며, 자식 capability가 부모 delegable을 넘지 않고, 제품 표면이 method 집합을 넓히지 않았음을 고정한다.

### 엔진과의 중복 정리

- **inference relay 제거.** `INF-001`이 broker relay를 요구했지만 relay는 만들어지지 않았고, 코드에는 호출 경로 없는 355줄이 남아 있었다. 규범을 실제 선택으로 확정하고 `src/inference*`·`domain/usage-budget.ts`를 제거했다. 대가로 OMA는 multi-agent 비용 상한을 집행하지 않으며 그 사실을 §13.3에 적었다. `usage` 표와 여섯 durable entity는 그대로 두었다.
- **provider spike(S-04) 제거.** 그 spike는 OMA가 직접 만들 provider codec·가격 upper bound·usage 회계를 gate했는데, `INF-001`이 그 셋을 모두 엔진에 넘기면서 gate할 구현이 남지 않았다. 존재하지 않는 구현을 OPEN gate로 들고 있는 것은 중복이자 허위 미해결이라 판단해 `spikes.md`에서 삭제하고 spec·contract·보고 script의 참조를 정리했다. spike가 담고 있던 사실 중 유효한 것은 아래 한 줄이며, 되살릴 조건은 §13.3에 적었다.
  - 별도 relay나 새 credential store 없이 host-side Pi RPC를 쓰는 경로에서 `npm run test:functional-pi`는 요청 `pi/current`를 `openai-codex/gpt-5.6-luna`로 해석했고, `oma_mail_read` 1회 성공·terminal `stop`·session persist·durable batch presented=1을 확인했다. 이 1건은 resident 기본 대화 경로가 엔진 연결로 동작한다는 증거일 뿐, 가격·429/5xx·취소 codec에 대해서는 아무것도 말하지 않는다. 그것들은 이제 OMA의 계약이 아니다.
- **acceptance 행은 그대로 둔다.** `TEST-006`이 T01–T77 행의 삭제·재분류를 금지하므로 T48–T51(quota reserve/provider settle)은 표에 남는다. 다만 이 행들을 discharge할 OMA 경로가 없다는 사실을 `adversarial-report`의 gate 문구에 적었다.
- **터미널 폭 측정**을 엔진의 grapheme 기반 계산으로 교체했다. 직접 만든 표는 12개 표본 중 4개(ZWJ 가족, 결합 문자, 넓은 이모지, 피부색 시퀀스)에서 틀렸다.
- **키 식별**을 엔진 어휘로 위임했다. 청크 분할은 제품이 계속 소유한다.
- **남긴 중복**: byte framing과 유닉스 소켓 클라이언트. 그 위의 OMA 정책 계층이 어차피 남고 설치 표면을 늘리지 않기 위한 판단이며 근거를 §23.13과 TUI-020에 남겼다.
- **중복이 아닌 것으로 확인**: 경로 봉쇄(커널 수준), START 화면(자동 탐색 금지), 파일 가드(role별 quota), canonical JSON, git bundle/CAS.

### 관측한 것

- 임시 state root에서 `dist/src/entry/oma.js`를 직접 실행해 다섯 화면(대화/Dashboard/Config/Mail 목록·상세/Extensions)이 렌더링되고 종료 코드 0임을 확인했다.
- Config에서 값을 바꾸면 해당 설정 파일에 기록되고 policy revision이 갱신된다. split bundle에서는 role 파일과 host 파일이 각각 갱신되고 index는 manifest로 남는다.
- 사용자 Pi가 `/usr/bin/pi`에 설치된 머신에서도 OMA는 자기 복사본을 실행하고 `PI_CODING_AGENT_DIR`로 자기 디렉터리를 넘긴다.
- 설정이 없는 빈 디렉터리에서 인자 없이 기동하면 society를 디렉터리에서 유도하고 설정 파일을 생성한 뒤 시작한다.

이 관측은 production entrypoint가 동작함을 보인 것이지 COMP-004의 `proven`이 아니다. 실제 Pi provider 연결, TTY raw mode, broker `status.get` 왕복은 포함하지 않았다.

### 제품 경로를 끝까지 연결한 것

앞선 기록은 세 가지를 "호출자가 없다" 또는 "architecture 결정이 필요하다"로 남겼는데, 셋 모두 결정할 것이 아니라 찾지 않은 것이었다. 각각 실제 실행으로 닫았다.

- **Resident는 기본으로 봉인된다(`SB-007`, `SB-002-E`).** 설정 없이 시작하면 rootfs가 `/`였기 때문에 제품 기본 상태의 워커는 봉인 없이 돌았다. 이제 `provisionSociety()`가 state root 아래에 rootfs를 만든다 — 빈 mount target, agent만 이름으로 갖는 생성된 `/etc/passwd`·`/etc/group`, host 운영체제의 `/usr` 등 닫힌 목록의 RO bind, 실제 Node binary 한 파일. 기본 설정의 `installation.rootfs`가 이 경로다. 실행 중 드러난 결함 하나: `oma`가 기록하는 설치 경로는 `/`로 끝나고 mount 번역이 그 표기에 의존해 아무것도 맞추지 못했다. 표기와 무관하게 비교하도록 고쳤다.
- **relay는 production 경로에 붙었다(`INF-008`).** 앞선 기록은 credential 인계에 Principal → broker 경로가 필요하다고 적었으나 틀렸다. runner가 동봉 엔진의 공개 SDK로 OMA 소유 agent directory에서 직접 해석한다. 한 delivery 동안 relay를 열고, 끝나면 닫는다. sandbox는 진짜 key와 같은 모양의 자리표시자를 받는다 — Codex provider가 token claim에서 계정을 읽고 WebSocket을 먼저 시도한다는 것을 엔진 코드에서 확인해 자리표시자의 모양 보존과 upgrade 터널을 넣었다.
- **Dashboard는 관측값을 보인다(`TUI-021`).** 앞선 기록은 "사람이 띄운 TUI가 읽을 권한을 가진 endpoint가 없어 `IPC-012`가 닿는 결정이 필요하다"고 적었다. socket method를 늘릴 필요가 없었다. broker가 `status.get`과 같은 답을 host 전용 `0600` view로 게시하고, 갱신 시점과 5초 주기로 다시 쓰고, 멈출 때 지운다. TUI는 그 파일을 읽고 없음·손상·다른 society·20초 넘은 오래됨을 이유와 시각이 붙은 `unknown`으로 보인다.
- **society는 프로젝트를 다룬다(`TUI-022`).** canonical `main`을 빈 commit으로 심던 것을 첫 시작에서 프로젝트의 커밋된 `HEAD`로 시작하게 했다. 커밋되지 않은 변경과 추적되지 않는 파일은 가져오지 않고, 이후 디렉터리의 새 커밋이 canonical 이력을 움직이지 않는다.

**실제로 실행해 확인한 것** (stub 없음)

| 확인 | 방법 |
|---|---|
| 실제 bwrap 안의 동봉 엔진이 자리표시자만 갖고, relay를 거쳐 진짜 key로 provider에 도달 | T117, 생성된 rootfs + production mount 계획 + TLS stand-in |
| 봉인 안에서 state root·엔진 credential 파일·host home 불가시, `/` 쓰기 불가, 외부 연결 `ENETUNREACH`, 신원은 `agent` | T117 escape probe |
| 봉인 안에서 trusted extension 로드, mail이 `role: custom`으로 전달, provider 없으면 오류로 종료 | T117 delivery smoke (systemd lane의 수동 mount 덧대기 smoke를 대체) |
| 봉인 없이 실제 엔진 → bridge → relay → provider, `?beta=true` 같은 엔진 자체 query 보존 | T116 |
| 자리표시자 치환이 header와 path에만, body는 그대로; WebSocket upgrade 양방향 | T114 |
| broker가 쓴 view를 TUI reader가 그대로 수용, `0600` | T118 |
| broker 실행 중 view 존재, 5초 주기 재게시(+5007ms), 정지 시 제거 | 실제 broker 실행 |
| 빈 프로젝트에서 `oma` 실행 → 생성된 rootfs가 설정에 기록, broker 기동, Dashboard `observed` | 실제 `oma` 실행 |
| 프로젝트 `HEAD` = canonical `main`, dirty·untracked 제외, 두 번째 시작에 재가져오기 없음 | T115 + 실제 저장소 |

확인에 쓴 society의 systemd unit·runRoot·state는 모두 되돌렸다.

### 구조 정리: 책임 분리와 regex 검사의 이전

외부 품질 검토가 지적한 세 곳과 TUI 레이아웃 교체 준비를 처리했다. core는 건드리지 않았다.

- **`pi-extension.ts` → `src/extension/`.** 739줄 한 파일에 섞여 있던 batch view codec, workspace guard, mail tool, inference bridge, delivery boundary, tool surface를 파일로 나눴다. `pi-extension.ts`는 조립만 하는 32줄 entry다. "OMA runtime을 import하지 않는다"는 보장은 한 파일이라는 사실이 아니라 `extension-closure` 규칙이 지킨다. 등록 순서는 그대로다.
- **`pi-adapter.ts` → `pi-spawn-plan.ts` + `pi-adapter.ts`.** 엔진을 어떻게 띄울지(argv·환경·봉인)는 프로세스 없이 계산되는 데이터로, delivery 생명주기(spawn·RPC·boundary 대기)는 I/O로 나눴다.
- **TUI view 계층.** 보이는 방식은 `src/tui/view/`가 전부 소유한다. Dashboard는 미리 만든 문장 대신 `DashboardData`(관측 상태·수치)를, 알림은 `Notice`(무슨 일이 있었는지)를 넘기고 view가 문장으로 만든다. 레이아웃 교체는 `view/`만 바꾸는 일이다.
- **source-regex 검사 → `surface-rules.mjs`(AST).** 19개 규칙을 positive/negative/false-positive fixture 10묶음과 함께 옮겼다. 대신 지운 regex 테스트는 규칙과 짝이 맞는 것만 지웠다.

**AST로 옮기자 regex가 못 보던 것이 드러났다.**

| 발견 | 원인 | 조치 |
|---|---|---|
| **host TUI 코드가 Resident 안에서 읽혔다** (`TUI-003` 위반) | 지난 변경이 설치 디렉터리 전체를 `/opt/oma`로 bind했고, 예전 regex 테스트는 파일 세 개의 문자열만 봤다. `resident-product-surface` 규칙이 `deployment.ts`의 경로 문자열을 잡으면서 드러났다 | 배포 layout이 product surface 경로를 선언하고 mount 계획이 가린다. 실제 bwrap에서 `dist/src/tui`가 비어 보이고, `oma.js`는 열리지 않으며, 가린 자리에 쓰기가 안 되고, 엔진과 extension은 그대로 동작함을 확인했다(T117) |
| `settings.ts`의 `.slice(0, 32)` | regex가 template literal을 통째로 지워 그 안의 코드를 못 봤다 | `CONFIG_BOUNDS.revisionDigestHex`로 선언 |
| hex·octal 리터럴 오탐 | TS AST의 `NumericLiteral.text`는 10진수로 정규화된다 | 규칙이 원문 표기(`getText()`)로 판단 |
| type-only import 경로를 문자열로 오인 | module specifier도 문자열 리터럴이다 | 문자열 규칙에서 specifier 제외. fixture가 잡았다 |

**의도적으로 지운 것**

- `"the engine is never modified, only consumed"`: 문자열을 지운 뒤 `node_modules`를 찾았으므로 식별자 이름밖에 맞출 수 없는 공허한 검사였다. 엔진 불변은 배포 digest 검사가 지킨다.
- `"removing the relay left no orphan"`: `Inference*` 선언이 다시 생기면 P2 계약 golden pin이 먼저 실패한다. 중복이었다.
- `mail-header-leaf`의 "`cli/effects/mail.ts`가 `mail/headers.js`를 import해야 한다" 양성 pin: 배선을 고정할 뿐 경계를 지키지 않는다. 경계(전체 mail 모듈 import 금지)는 `module-port-import`가 지킨다.
- entrypoint에 `roleExtensions`가 쓰였는지 보던 regex: Principal profile 조립을 `principalSessionProfile()`로 꺼내 역할의 모델·extension·digest·projection이 그대로 넘어가는지 행동으로 검사한다.

### Principal 제품 경로: 두 번째 감사에서 드러난 것

감사에서 P1으로 지적된 세 가지는 같은 하나의 구멍이었다. `oma`가 Principal engine에 `HOME`/`PATH`만 넘겨서 trusted extension이 OMA tool을 아예 등록하지 않았고(`OMA_CLI_PATH`/`OMA_AGENT_HOME`/`OMA_MAIL_ARCHIVE`/`OMA_SOCKET` 부재), `OMA_WORKSPACE_BYTES`가 없어 write/edit이 전부 차단됐으며, engine의 cwd가 될 `principal/private`를 아무도 만들지 않았고, 무엇보다 Principal이 broker에 자기를 증명할 방법이 없었다. Principal에는 systemd scope가 없어 Resident를 인가하는 cgroup·run lease 검사가 성립하지 않는다.

architecture §23.5가 이미 답을 정해두고 있었다. broker가 run마다 private connection credential을 만들고, host가 자신이 띄운 session에만 넘기고, model 도구에는 제한된 principal actor endpoint만 노출한다. IPC-011이 이 handshake를 미뤄둔 이유는 "남이 띄운 Pi session에 붙는 법"이 미정이었기 때문인데, TUI-004에서 OMA가 session을 직접 기동하게 되면서 그 질문이 사라졌으므로 handshake를 확정했다.

- broker는 시작 시 32바이트 난수를 `<runRoot>/principal.cred`에 0600으로 게시하고 `<runRoot>/principal.sock`을 연다. credential은 파생값이 아니며 broker가 멈추면 메모리와 디스크에서 함께 사라진다.
- 그 endpoint의 연결은 `principal.attach`가 성공하기 전까지 아무도 아니다. 다른 session handle의 두 번째 attach는 거절되므로 society는 Principal 하나를 유지한다(architecture §8.4).
- model-facing CLI는 환경에 credential이 있을 때만 매 연결의 첫 frame으로 그것을 제시한다. Resident의 환경에도 sandbox에도 credential은 없으므로 다른 호출자에게는 아무 변화가 없다.
- `T114`가 이것을 검사한다.

**첫 수정은 실제 제품 경로에서 동작하지 않았다.** 두 번째 감사가 정확히 짚었다. 호스트가 credential을 engine 환경에 넣어도, 
model이 실제로 쓰는 tool은 `src/extension/mail-tools.ts`에서 `/usr/bin/env -i`로 환경을 **다시 만든다**. 그 목록에 credential과 
session handle이 없었으므로 `oma_status`·`oma_mail_send`·`oma_mail_ack`는 전부 attach 없이 요청을 보내 `AUTH_FAILED`로 끝났다. 
당시 테스트가 이것을 놓친 이유는 결함이 아니라 **oracle의 seam**이다: 테스트가 CLI를 직접 spawn하면서 credential을 손으로 넣었기 
때문에, 그 사이의 `env -i` 한 단계를 건너뛰었다. 지금은 실제 `registerOmaTools`가 등록한 tool을 구동하고 engine의 `exec`만 
대역으로 두되 그 대역이 진짜로 프로세스를 띄운다. 결함을 되살려 두 test가 모두 실패하는 것을 확인했다.

같은 이유로 세 곳(생산자 `principalEnvironment`, 전달자 `cliEnvironment`, 소비자 `cli/transport.ts`)을 정적 규칙 
`principal-session-env`로 묶었다. CLI가 호출 시점에 읽는 이름이 전달 목록에 없거나, 전달하는 이름을 host가 설정하지 않으면 
architecture gate가 실패한다. 테스트를 더 쓰는 것보다 이쪽이 재발을 막는다.

그리고 **진입점 자체를 실행하는 테스트가 없었다**. 두 번 다 부품은 전부 검사돼 있었고 그것들을 잇는 파일만 검사되지 않았다. 
`T119`가 실제 `src/entry/oma.ts`를 통제된 모듈 경계에서 실행해 순서와 값을 본다. 두 결함을 각각 되살려 이 테스트가 
실패하는 것을 확인했다: credential을 기다리지 않게 바꾸면 순서 단언이 깨지고, 환경을 손으로 조립하게 바꾸면 세 단언이 깨진다.

`cliEnvironment`의 읽기 시점도 옮겼다. 등록 시점에 읽는 다른 값들과 달리 이것만 호출 시점에 `process.env`를 읽고 있었는데, 
engine이 시작된 환경과 나중의 환경이 다를 수 있다는 점에서 같은 종류의 균열이다. 이제 `registerOmaTools`에서 한 번 캡처한다.

**credential 전달 경로도 바꿨다.** 첫 수정은 `<runRoot>/principal.cred`에 0600으로 게시했는데, 0600은 다른 UID를 막는 권한이지 
같은 UID의 다른 프로세스를 막는 권한이 아니다. 그 프로세스야말로 `peer-authenticator`의 주석이 배제하겠다고 적은 대상이고, 
게다가 host가 session handle을 미리 알리지 않았으므로 먼저 attach한 쪽이 Principal이 되는 구조였다. 지금은 host가 broker를 
시작하기 전에 handle을 등록하고, broker는 등록이 있을 때만 endpoint를 열며, credential은 등록한 host만 가진 descriptor로 
한 번 간다. 파일은 없다. 등록이 없는 broker(예: systemd가 띄운 것)는 endpoint 자체를 열지 않는다.

**startup ordering도 실제로는 보장되지 않았다.** broker를 먼저 spawn하도록 고쳤지만 `superviseBroker`는 pid가 생기면 곧바로 
반환했고, credential은 그 뒤 recover/bootstrap을 지나 `broker.start()` 안에서야 생긴다. 지금은 credential을 그 descriptor로 
기다리는 것이 곧 readiness barrier다: endpoint가 listening된 뒤에만 publish하므로, credential을 받았다는 것이 endpoint가 
있다는 뜻이다. 늦게 publish하는 broker, 전혀 publish하지 않는 broker, 다른 host가 소유한 broker 세 경우를 `T115`가 검사한다.

credential 채널에는 두 가지를 더 걸었다. broker는 descriptor 3이 실제로 파이프일 때만 session을 등록한다 — 다른 방식으로 
시작된 broker가 낡은 `OMA_PRINCIPAL_SESSION`을 물려받았을 때 credential을 로그나 남의 파일에 쓰는 일을 막는다. session 
handle 비교도 credential과 같은 고정 길이 비교로 바꿨다. handle은 권한을 주지 않지만, credential을 이미 쥔 호출자에게는 
handle이 남은 전부이므로 사실상 비밀의 나머지 절반이다.

`ATTACH_CONFLICT`도 계약대로 돌려준다. PR-001이 두 번째 attach를 conflict로 규정했고 오류 어휘에도 따로 있는데 구현은 
`AUTH_FAILED`였다. 두 오류의 복구 정책이 다르다.

batch view는 여전히 일부러 넘기지 않는다. Principal을 위해 batch를 준비하는 runner가 없으므로 delivery command는 
unavailable로 남는다(TRACE-002). 이것은 아래 "남은 것"의 PR-002 항목이다.

### 같은 감사에서 함께 고친 것

- **`npm test`가 skip을 통과로 읽었다.** Node의 test runner는 skip이 있어도 exit 0이므로, bubblewrap 없는 호스트에서 봉인 
  시험 4개가 skip돼도 통과로 보였다. 이제 실행 요약을 읽어 skip·todo·cancelled가 하나라도 있으면 실패한다(R35가 lane에 
  적용하던 규칙과 같다). 실제 skip을 하나 넣어 suite가 exit 1로 끝나고 그 test 이름을 출력하는 것을 확인했고, CI runner에는 
  bubblewrap을 설치해 애초에 skip되지 않게 했다.
- **`SOURCE_BOUND`가 LOC 수치를 검증하지 않았다.** 파일 집합과 해시만 확인하고, A-008이 판정하는 총계는 보지 않았다. 이제 
  `SUM`이 자기 rows의 합인지, 두 산출물이 같은 cloc 실행에서 나왔는지, manifest 밖 파일이 총계를 부풀리지 않는지 확인한다.
- **workflow job 시계가 자기 check 합보다 짧았다.** ceiling 합이 190분인데 job은 150분이었다. 210분으로 올렸고 `T116`이 
  둘의 관계를 검사한다.
- **Mail 화면과 status view의 bounded read가 bounded가 아니었다.** `readFileSync(...).slice(0, LIMIT)`는 파일 전체를 먼저 메모리에 올린다. 이제 `O_NOFOLLOW`로 열어 `fstat`으로 정규 파일임을 확인하고 한도만큼만 읽는다. 링크는 따라가지 않으므로 손상된 Maildir이 host 파일 내용을 화면에 올릴 수 없다. 이전 adversarial test는 링크를 따라가는 동작을 정상으로 취급하고 있었고, 그 단언을 거절 단언으로 바꿨다. `TuiTransport`도 같은 방식으로 고쳤다.
- **unread 수와 목록이 어긋날 수 있었다.** `unreadCount`는 `new/`의 모든 항목을 세고 `readMailbox`는 비파일을 버렸다. 이제 둘 다 같은 행 도출을 쓴다.
- **"Newest first"가 사실이 아니었다.** message id는 무작위 UUID를 담으므로 파일 이름 순서는 시각과 무관하다. 정렬 기준을 Maildir 파일의 mtime으로 바꾸고, unread를 먼저 보이게 했다.
- **relay의 경로 검사가 철자 목록이었다.** `..`/`%2e%2e`만 막고 `%2e.`·`.%2e`는 통과했다. 이제 선언된 endpoint에 이어 붙인 뒤 URL parser로 canonical form을 만들고 그 결과가 endpoint 안인지 검사하므로 철자 목록이 필요 없다. encoded separator(`%2f`/`%5c`)는 canonicalisation이 보존하고 provider가 해석할 수 있으므로 따로 거절한다.
- **CI workflow가 green이 될 수 없었다.** 모든 명령을 900초에 죽이면서 3600/7200초 예산의 lane을 호출했고, hosted runner에 없는 systemd lane을 실행했으며, 생성기 이전에 관측한 stale inventory를 기록만 하고 넘어갔다. 이제 lane마다 자기 예산보다 큰 ceiling을 주고, systemd lane은 NOT_RUN으로 기록하며, stale inventory는 실패다. `T116`이 workflow 원문과 lane 정의를 정적으로 대조한다.
- **LOC/hash 증거가 source에 묶여 있지 않았다.** 파일 목록은 최신인데 측정 기록은 21개 적은 집합의 것이었고, `src/pi-extension.ts`가 33줄인데 657 code LOC로 적혀 있었다. `check:inventory`가 이제 기록된 sha256을 현재 바이트와 대조하므로 같은 드리프트는 발생 즉시 실패한다.
- **peer 신원이 Node 비공개 필드에 의존한다.** 없앨 수는 없지만(공개 API가 없다) `src/leaf.ts`로 옮겨 다른 비공개 primitive와 함께 한곳에서 이름을 갖게 했고, 실제 accepted socket에서 `SO_PEERCRED`가 이 프로세스를 가리키는지 검사한다.

### Principal 제품 경로: 세 번째 감사에서 닫은 것

**credential이 여전히 같은 UID의 프로세스에 노출돼 있었다.** 두 번째 수정은 파일을 없앴지만 credential을 engine의 초기 환경에 넣었다. 
이 host(Yama scope 1)에서 실측하면 같은 UID의 비조상 프로세스는 `/proc/<pid>/environ`을 **읽을 수 있고**, 상속된 pipe를 
`/proc/<pid>/fd/N`으로 **다시 열 수 있으며**, `/proc/<pid>/mem`은 읽지 못하고, 상속된 socket은 다시 열지 못한다(ENXIO). 
그래서 secret은 environment에서 완전히 빼고 socketpair로만 옮기며 메모리에만 둔다: broker→host는 spawn 때 연 socketpair, 
host→engine도 socketpair, 확장→CLI도 CLI의 descriptor 3 socketpair다. engine의 `exec`은 stdin을 닫고 추가 descriptor를 넘기지 
못하므로 확장이 CLI를 직접 띄우고(`src/extension/cli-process.ts`, 새 subprocess owner), 환경은 상속 없이 명시한 것만 준다.

secret을 숨기는 것만으로는 부족하므로 attach에 **조상 검사**를 더했다. 연결한 프로세스가 등록된 engine의 자손이어야 하며, 
engine은 pid와 시작 시각으로 고정한다. engine 자체도 host의 자식이어야 등록된다. 비자손 프로세스가 engine의 자손이 되려면 
engine을 ptrace해야 하고 Yama scope ≥1은 이를 거부한다. scope 0 host에서는 어떤 user-space 검사도 같은 UID의 두 프로세스를 
구별하지 못하며, 이는 host의 성질로 적어 둔다. T114의 "감사의 공격" 시험이 올바른 credential과 handle을 가진 비자손 프로세스를 
실제로 거절하고, 조상 검사를 끄면 그 시험이 실패하는 것을 확인했다.

**TUI가 비정상 종료하면 broker가 남았다.** host가 broker에 넘긴 socketpair가 곧 생존 신호다. host가 어떻게 죽든 커널이 descriptor를 
닫으므로 broker는 그것을 보고 스스로 멈춘다. T115가 실제 supervisor를 돌리는 host 프로세스를 SIGKILL해서 broker가 "host 부재"를 
이유로 끝나는 것을 확인한다. 이 시험의 첫 버전은 stand-in이 다른 이유로 먼저 종료해 **잘못된 이유로 통과**하고 있었다. 종료 이유를 
파일로 남기게 고쳤고, 종료 감지를 끄면 시험이 실패하는 것을 확인했다.

**broker 사망·재시작 뒤 복구가 없었다.** supervisor는 준비 신호("endpoint가 listening")를 기다리며 pid 등장을 준비로 보지 않는다. 
engine은 broker를 기다리지 않고 먼저 뜨고, broker가 준비될 때마다 같은 handle로 재등록되어 새 credential을 받는다. broker가 
예기치 않게 끝나면 한도 안에서 재시작한다. 이전 credential은 무효다.

**PR-002를 구현했다.** host가 idle한 session에 대해 `batch.prepare`를 호출하고, 확장이 batch를 custom message로 제시하고, turn이 
`stop`으로 끝나면 확장이 boundary를 알리고, host가 receipt를 쓰고 `batch.complete`를 호출한다. 준비와 완료는 host endpoint에서 host 
pid에게만 서빙되므로 model 쪽에서는 완료할 수 없다. 구현 중 두 가지를 더 찾았다. core의 batch view 코덱이 수신자를 Resident 이름으로만 
허용해 Principal에게는 batch를 만들 수 없었고(코덱과 확장 미러를 함께 고쳤다), 확장의 delivery 핸들러는 오류로 끝난 turn의 batch를 
영원히 pending으로 붙잡아 오래 사는 Principal session에서 이후 전달을 모두 막았다(고쳤고, 되살리면 T114의 재시도 시험이 실패한다). 
Principal session 디렉터리는 receipt가 다른 agent와 같은 방식으로 찾을 수 있도록 `agents/principal/runner/sessions`로 옮겼다. 
출시 전이라 기존 `principal/private/sessions`의 대화 기록은 옮기지 않는다.

**`oma_mail_read`의 bounded read가 TOCTOU였다.** 크기 확인 뒤 파일 전체를 읽었다. 이제 측정한 크기만큼만 읽고, 한 바이트를 더 읽어 
성장 여부를 보고, 식별자를 다시 비교한다. 시험은 writer가 파일을 한도 위아래로 계속 오가게 하면서 읽는다. 옛 구현으로 되돌리면 
5번 모두 한도 4096바이트를 넘는 4416–4864바이트를 돌려준다. 이 시험도 첫 버전은 writer가 시작하기 전에 읽기가 끝나 아무것도 
검증하지 않았고, 두 번째 버전은 writer가 잘못된 오프셋에 써서 한도를 넘지 않았다. 둘 다 역검증의 **실패 사유**를 보고 찾았다.

**LOC `SOURCE_BOUND`가 값 자체를 묶지 않았다.** hash 기록이 이제 report의 digest를 담아 report만 따로 고칠 수 없고, `check:inventory`는 
고정 버전 cloc(2.08)이 있으면 source를 다시 측정해 모든 값을 비교한다. 재측정하지 못하면 `CONSISTENT_NOT_REMEASURED`로 부르고 
`SOURCE_BOUND`라 하지 않는다. CI는 cloc 2.08 릴리스를 digest로 고정해 설치하고, 재측정을 필수로 하며, 재생성한 값이 커밋과 다르면 
실패한다. CI에 cloc 설치 단계가 아예 없어 `loc` 단계가 항상 실패하던 문제도 이것으로 닫혔다.

### Principal 제품 경로: 네 번째 감사에서 닫은 것

**idle 관측과 turn 시작이 원자적이지 않았다.** delivery는 session이 idle일 때만 시작해 S-03의 미결 질문에 기대지 않겠다는 것이 
핵심 안전 주장이었는데, `busy`는 engine이 `turn_start`를 보고해야 켜졌다. Human이 prompt를 보낸 직후부터 engine이 그것을 보고할 
때까지 session은 idle로 보였고, 그 사이에 delivery가 같은 queue에 자기 명령을 넣을 수 있었다. 이제 session 소유권을 무엇을 쓰기 
전에 동기적으로 예약하고, Human prompt와 delivery가 같은 소유권을 쓴다. settle되지 않고 끝난 delivery는 예약을 돌려준다. 
예약 자체는 옳았지만 이때 정한 **대기 방식**은 Pi의 계약을 잘못 읽은 것이었고, 다섯 번째 감사에서 고쳤다(바로 아래).

**PR-003의 저장 경계를 어겼다.** 직전 커밋은 receipt 검증을 Resident와 통일하려고 Principal session을 
`agents/principal/runner/sessions`로 옮겼는데, PR-003은 Human 기록을 `principal/private`에 두라고 규정한다. 경로 소유자를 
`sessionDirFor(actor)` 하나로 만들어 Principal은 `principal/private/sessions`를 쓰고 receipt 검증도 같은 소유자에게 묻는다. 
규범을 지키면서 receipt도 검증된다.

**확장이 일부 실패 경로에서 batch를 계속 붙잡았다.** session 경로가 없거나 entry가 기대와 다르면 `pending`을 비우지 않아서, 
오래 사는 Principal session이 이후 모든 전달을 거절했다. 이제 turn이 어떻게 끝나든 확장의 claim은 풀린다. batch 자체는 broker에 
prepared로 남아 다시 전달된다.

**host identity가 pid 숫자였다.** Resident와 engine은 pid 재사용을 명시적으로 막는데 host만 숫자 비교였다. 이제 시작 시각까지 
고정한 identity로 답한다. **supervision socket도 broker가 소유한다**: broker만 따로 멈춰도 descriptor를 붙잡고 남지 않는다.

**CLI 출력 상한이 바이트가 아니었다.** 디코드한 문자열 길이로 세고 있어서 3바이트 문자 위주 출력이면 선언한 1 MiB보다 훨씬 
많이 쥐었다. 문자로 세는 구현으로 되돌리면 1,048,576바이트 상한에 3,141,759바이트를 쥔다.

### Principal 제품 경로: 다섯 번째 감사에서 닫은 것

**`agent_settled`를 prompt 하나당 하나로 읽었다.** 네 번째 수정은 turn이 돌고 있을 때 Human prompt를 engine의 follow-up queue에 
넣고(`streamingBehavior: "followUp"`) 대기 중인 prompt 수만큼 `agent_settled`를 세었다. 동봉한 Pi 0.85.1의 계약은 그렇지 않다. 
`docs/rpc.md`는 `agent_settled`를 "full session-level run이 settle된 뒤"로 정의하고, `agent_end`만 "retry·compaction·queued 
continuation이 뒤따를 수 있는" 한 번의 낮은 수준 run으로 구분한다. 구현(`dist/core/agent-session.js`의 `_runAgentPrompt`)도 
`agent.prompt()` 뒤에 queue가 빌 때까지 `agent.continue()`를 돌리고 `finally`에서 `agent_settled`를 **한 번** 낸다. 그래서 
queue에 든 prompt가 몇 개든 settle은 하나였고, 세어 둔 나머지만큼 소유권이 영원히 Human에게 남아 이후 delivery가 모두 
`deferred`가 되었다. 더 나쁘게는, queue에 든 Human turn이 delivery와 **같은 run** 안에서 실행되므로 확장이 그 run에 대해 기록하는 
boundary가 Human의 turn까지 덮었다 — "idle session에 넣었으니 boundary는 delivery 자신의 것"이라는 PR-002의 안전 주장이 
성립하지 않았다.

이제 소유권의 단위를 engine의 agent run으로 못박았다. session이 예약돼 있는 동안 들어온 Human prompt는 engine이 아니라 host가 
순서대로 들고 있다가, run이 끝나는 바로 그 단계에서 — 소유권을 동기적으로 다시 잡으면서 — 자기 prompt로 쓴다. `streamingBehavior`는 
제품 어디에도 쓰지 않으며, 그것을 이름으로라도 쓰면 architecture rule `principal-turn-owner`가 실패한다(accept·reject·near-miss 
fixture 포함). 그래서 run 하나에는 소유자도 boundary도 하나뿐이고, Human은 기다리지도 다시 입력하지도 않는다.

역검증: prompt를 engine queue로 되돌리면 "the Human's prompt was written into the delivery's own run"으로, settle 때 쓰지 않게 
하면 "the Human's prompt was never written after the delivery settled"로 실패한다. 세 개를 대기시키고 run을 세 번 돌리는 시험은 
각 prompt가 순서대로 정확히 한 번씩 쓰이고 마지막 settle에서 session이 풀리는 것을 본다.

**engine이 거절한 prompt를 아무도 읽지 않았다.** `PiRpcClient.send()`는 stdin에 JSON을 쓴 것까지만 기다린다. Pi는 `prompt`를 
preflight에서 답하고, 모델이 없거나 compaction 중이면 `success:false`로 **수락 전에** 거절한다. 그 경우 run이 시작되지도 
끝나지도 않으므로 예약은 영원히 남고 사용자는 입력이 사라진 것을 알 방법이 없었다. 이제 session이 자기 request id의 응답을 
확인해 거절이면 예약을 돌려주고 화면에 사유를 적는다. 대기 중이던 Human prompt가 있으면 그것이 이어서 실행된다. 응답 확인을 
끄면 "a refused prompt left the session claimed"로 실패한다.

**delivery가 실패한 assistant message 하나로 포기했다.** `message_end`는 `agent_settled`보다 앞선다. Pi는 retry 가능한 실패를 
다시 시도하고 compaction 뒤 같은 run을 이어가므로, 첫 실패 message에서 claim을 돌려주면 아직 streaming 중인 engine에 대해 
session이 비었다고 말하는 셈이었다. 이제 마지막 assistant stop reason만 기억하고 run이 settle될 때 판정한다. 되돌리면 "the 
delivery gave up on a failed message before the run had settled"로 실패한다.

**같은 오독이 Resident 경로에도 있었다.** 감사는 Principal만 지적했지만 `PiAdapter`도 첫 실패 assistant message에서 
`providerFailed`를 세우고 즉시 깨어났다. Resident는 batch마다 engine을 새로 띄우므로 소유권 문제는 없지만, Pi가 retry로 
이어서 끝낸 run의 batch를 실패로 보고하는 것은 같다. 여기도 마지막 stop reason만 기억하고 run이 settle될 때 판정하며, 
boundary가 있으면 도중의 실패는 판정을 바꾸지 않는다. R28의 fake Pi를 실패 message를 한 번 낸 뒤 이어서 끝내는 형태로도 
돌리도록 두 경우 모두 시험한다. 수정을 되돌리면 그 시험이 실제로 전달된 batch를 거절한다 —
`SESSION_BOUNDARY_UNCONFIRMED`: 실패 message에서 깨어나는 바람에 boundary가 도착하기 전에 증거를 판정한다.

**T119의 oracle이 폐기된 경로를 성공 조건으로 두고 있었다.** entry 배선 시험의 stand-in이 `principal/private/sessions`로 되돌린 
뒤에도 `agents/principal/runner/sessions`를 돌려주고 그 값을 단언했다. 경로 규칙을 시험이 따로 적어 두면 두 번째 소유자가 생긴다. 
이제 stand-in은 소유자가 답했다는 표시만 돌려주고, 시험은 entry가 그 값을 그대로 넘겼는지만 본다 — entry가 경로를 스스로 적으면 
"the entry decided the session directory itself"로 실패한다. 실제 경로가 무엇인지는 소유자를 시험하는 T114가 단언한다.

**PR-002와 IPC-011에 authoritative owner가 없었다.** 구현은 있는데 `source-owners.json`에 링크가 없어 owner·entrypoint·callPath·
negative test가 비어 있었다. 둘 다 채웠다. TRACE-002가 요구하는 나머지(현재 revision의 실행 증거)는 다른 requirement와 마찬가지로 
compliance 기록 절차를 거치지 않았으므로 상태는 `unverified` 그대로다.

### 제품 표면: 여섯 번째 감사에서 닫은 것

**사람이 입력한 것이 제품이 쥐는 양을 정했다.** `limits.ts`는 화면이 무엇까지 커지는지를 한 곳에서 읽게 하는 파일인데, 정작
사용자가 직접 넣는 가장 큰 두 가지 — 작성 중인 prompt와, 다섯 번째 수정으로 host가 들고 있게 된 대기 prompt — 에만 상한이 없었다.
둘 다 선언한다(`promptBytes` 16 KiB, `waitingPrompts` 16). prompt는 문자 수가 아니라 UTF-8 source bytes를 세고, 현재
`frameBytes`가 더 작거나 quote/backslash가 JSON에서 escape되면 request id와 command envelope까지 직렬화한 실제 Pi command가
frame 안에 드는 더 작은 지점에서 멈춘다. 붙여넣기도 같은 key 경로를 거치고, 대기 queue가 차면 조용히 버리지 않고 거절해 알린다.
붙여넣기 하나가 화면 갱신 횟수까지 정하던 것도 같이 고쳤다 — `feed`는 chunk 하나에 frame 하나를 그린다. 문자 수 한도로
되돌리면 한국어 입력에서 "the prompt grew past its declared UTF-8 byte bound"로, envelope 검사를 빼면 JSON escape 경계에서 실패한다.

**500줄 상한이 모든 기록 생산자에게 적용되지 않았다.** Human prompt의 echo만 `line()`을 거치지 않고 직접 배열에 넣고 있어서,
긴 run 동안 — 사람이 평소보다 많이 입력하는 바로 그때 — 아무도 다시 잘라 주지 않았다. 기록에 줄을 넣는 경로를 하나로 만들었다.
되돌리면 "the transcript held 700 lines past a bound of 500"으로 실패한다.

**전송조차 못 한 prompt가 화면을 영원히 busy로 남겼다.** `submit()`이 예약 **전에** `onBusy(true)`를 찍고, 해제는 event 경로에서만
`false`가 되었다. frame보다 큰 prompt는 한 바이트도 쓰이지 않고 `FRAME_TOO_LARGE`로 거절되므로 어떤 run도 시작·종료하지 않고,
claim은 돌아오는데 그 보고는 돌아오지 않았다. 이제 소유권 이동 자체가 busy 보고를 소유한다. 옛 구현으로 되돌리면 화면은
`[true]`만 듣고 끝난다 — 세션은 비어 있는데 "응답 생성 중"이 남는다.

**host endpoint의 unknown method가 `AUTH_FAILED`였다.** 그 지점에서 host identity는 이미 확인된 뒤이므로, 서빙하지 않는 method는
인증 실패가 아니라 method surface 실패다(IPC-012). 이 repo는 error class로 재시도 가능성을 판정하므로 문구 문제가 아니다.
`UNKNOWN_METHOD`로 고쳤고, 실제 protocol method 두 개(내부 `runner.open`, 공개 `status.get`)로 확인한다.

**두 번째 `oma`가 authority 없는 engine을 또 띄웠다.** broker를 다른 프로세스가 소유하면 이 프로세스에는 principal host endpoint와
credential이 없다. 다른 `oma`가 이미 Principal session을 돌리는 경우든 broker만 별도 service로 실행 중인 경우든, 여기서 뜬 engine은
society에 요청하지도 못하면서 같은 `principal/private`와 같은 session 기록의 두 번째 writer가 된다. 이제 그 경우 engine을 시작하지
않고 같은 상태를 보는 Control Panel로 남으며 화면이 이유를 적는다.
되돌리면 "a second Principal engine was started for a society this process does not own"으로 실패한다.

**터미널 read를 key 경계로 취급했다.** UTF-8 code point와 CSI가 read 사이에서 나뉘면 문자가 깨지거나 escape tail이 prompt로
들어갔다. app 수명의 `KeyDecoder`가 두 종류의 partial state를 이어받고, 미완료 report는 64 bytes까지만 보유한 뒤 final byte까지
discard한다. 한국어와 CSI의 모든 byte split, 10,000-byte report, unknown report로 확인했다. app이 chunk마다 decoder를 새로 만들게
되돌리면 split oracle이 실패한다.

**Backspace와 초과 prompt가 Human의 요청 경계를 보존하지 않았다.** UTF-16 code unit 삭제는 supplementary·combining·ZWJ grapheme을
손상했고, 한도를 넘은 paste는 보관된 prefix를 완전한 요청처럼 제출했다. `PromptDraft`가 text와 overflow를 함께 소유하고 grapheme
단위 편집·admission·submission을 한 state machine으로 처리한다. overflow 상태의 Enter는 submit 0회이며 notice를 남기고, Backspace로
상태를 해제한 뒤에만 제출한다. `slice(0, -1)` 또는 prefix submit을 복원하면 각각 Unicode와 whole-prompt oracle이 실패한다.

**fast verification lane이 이미 삭제된 R27 test를 요구했다.** 그 lane은 모든 precheck를 통과한 뒤 test 실행 전에 `SETUP_FAILED`가
되어 실제로는 한 번도 PASS할 수 없었다. 삭제된 제품 기능의 test/name requirement를 lane에서 제거하고, 모든 lane의 선언이 현재 test
source를 가리키는지 검증하는 inventory regression을 추가했다.

**검증 기록이 판정을 결정하는 입력에 묶여 있지 않았다.** commit 이름은 어느 revision을 뜻했는지만 말하지 어떤 working-tree
바이트를 돌렸는지는 말하지 않는다. 실행 source만 해시해도 `package.json`의 test script, TypeScript strict 옵션, production manifest,
owner/trace/spec 또는 workflow가 바뀐 사실을 놓친다. 그래서 **verification input digest**를 기록한다 — 실행 source·tests·scripts뿐
아니라 로컬 gate를 결정하는 package/compiler 설정, production/LOC 입력, implementation 계약·owner·trace·systemd·문서, CI workflow를
실제 순회해 포함한다(`scripts/source-digest.mjs`; symlink 거절). 기록 파일 자체는 이 digest field만 정규화해 self-reference를 끊고
나머지는 포함한다. 대표 입력 mutation과 새 implementation 파일 추가가 digest를 바꾸며 runtime output은 바꾸지 않는다는 `R38`을
추가했다. 다시 실행해 다시 적지 않으면 "the validation record names verification inputs that are not this tree's"로 실패한다.

### 제품 표면: 일곱 번째 감사와 전체 적대적 검증에서 닫은 것

**transcript의 500이 줄이 아니라 append 횟수였다.** 기록에 들어가는 경로는 하나였지만, 그 하나가 세던 것은 "몇 번 넣었는가"였다.
모델의 한 응답은 한 번의 append이고 수천 줄일 수 있으므로, 500 entry는 수백만 줄과 같은 말이었다. 반대로 줄만 세는 것도 한도가
아니다 — 한 줄이 megabyte일 수 있다. 그래서 대화가 무엇을 쥐는지를 한 state machine이 소유하게 했다(`src/tui/transcript.ts`):
줄 자르기, 줄당 1 KiB, 전체 256 KiB, 최근 500 논리 줄을 모두 그 안에서 집행하고, 자르기는 UTF-8 code point 경계에서 수행해
저장된 줄이 깨진 byte로 끝나지 않으며 grapheme은 가능한 한 쪼개지 않는다. 역검증은 같은 입력에 대해 약한 규칙이 실패하는 것을
함께 본다 — append를 세면 2000줄짜리 한 번을 1 entry로 들고 있고, byte 한도 없이 줄만 세면 512 KiB를 들고 있다.

**붙여넣기의 개행이 전부 Enter였다.** 여섯 번째 수정은 붙여넣기를 같은 key 경로에 태웠지만, 그 경로에서 `\n`은 제출이다. 사람이
여러 줄을 붙여넣으면 마지막 줄을 읽기도 전에 앞줄들이 차례로 Principal에게 갔다 — `rm -rf build`가 사람이 Enter를 누르기 전에
제출되는 형태다. 이제 terminal의 bracketed paste(DEC 2004)를 화면 취득 때 켜고 반납 때 끄며, `ESC[200~`…`ESC[201~` 사이를 한
입력 경계로 받는다. paste는 제출이 아니라 draft 편집이고, 내용의 C0/C1은 텍스트로 소독하며, 한도를 넘은 paste는 prefix를 남기지
않고 통째로 거절한다. 브래킷을 벗기면 그 시험이 `["rm -rf build"]`가 먼저 제출되는 것을 보고 실패한다.

**끝나지 않은 것에 deadline이 없었다.** 미완 CSI를 들고 있는 decoder는 멈춰 있는 것이 아니라, 사람이 다음에 누르는 키를 그
report의 마지막 byte로 삼켜 버린다. 이제 decoder가 "무엇을 기다리는지"를 알기에 스스로 delay를 말하고, 시작해 놓고 끝나지 않은
모든 token(분할 UTF-8, 미완 ESC/CSI, 열린 paste, 한도 초과로 버리는 중인 report)에 단일 deadline이 걸린다. deadline을 없애면
`ESC[` 뒤에 친 `C`가 `{kind:"right"}`가 아니라 그 CSI의 final byte로 사라지는 것을 시험이 본다.

**거절된 prompt가 보낸 것처럼 화면에 남았다.** echo를 먼저 그리고 거절을 나중에 알리면, 사람이 보기에 그 줄은 Principal이 이미
들고 일하는 prompt와 구별되지 않고 다시 칠 원문도 남지 않는다. 다섯 번째 수정이 "not running을 관측하는 것과 run을 시작하는 것은
한 단계"라고 정한 것과 같은 이유로, 수락 관측과 화면 표시도 한 단계여야 한다. `submitPrompt` port가 수락 여부를 그 호출에서
답하고, transcript에는 수락된 것만 들어가며, 거절이면 원문 그대로 draft로 돌아가고 사유를 알린다. 비동기 보고로 되돌리면
"a refused prompt was echoed into the transcript"로 실패한다.

**적대적 검증에서 찾은 실결함: 미완 paste가 조각으로 전달됐다.** 위 수정을 넣은 뒤 스스로 경계를 밀어 보다가, terminal이
`ESC[201~`을 보내지 않은 채 입력이 끊기면 `flushPending()`이 그때까지 모은 내용을 **정상 paste로** draft에 넣는 것을 발견했다.
주석은 "rejected paste rather than partially delivered"라고 적혀 있었고 코드는 그 반대였다 — paste bound가 막으려던 바로 그 실패,
즉 전체처럼 읽히는 조각이 prompt에 남는 일이다. 끝나지 않은 paste는 truncated로 종료하도록 고쳤다. 시험은 조각이 거절되고
Backspace로 초과 상태를 푼 뒤 타이핑이 정상으로 이어지는 것까지 본다.

**관측한 것**: 실제 pty에 `ESC[?2004h`가 기동 직후 나가고 `ESC[?2004l`가 복원 시 나가는 것, pty로 보낸 두 줄 paste가 `"a\nb"`
하나로 도착하는 것, SIGINT/SIGTERM/uncaughtException 경로가 모두 같은 복원을 거치는 것. **관측하지 못한 것**: paste가 매우 클 때의
peak memory(최종 보유량만 관측했고 그 사실을 시험 주석에 적었다), bracketed paste를 지원하지 않는 terminal에서의 동작.

### 남은 것

- **broker를 `oma`가 시작하지 않은 배포에서는 이 프로세스가 Principal 대화 세션을 열지 않는다.** Principal endpoint는 supervision
  channel이 있을 때만 열린다. systemd unit이나 다른 `oma`가 broker를 소유한 society에서는 authority 없는 두 번째 engine을 시작하지
  않고 Control Panel로 남는다. Dashboard·Mail·Config는 그대로 동작하지만 대화는 broker를 소유한 `oma`에서 이어가야 한다.
- **Yama ptrace scope 0 host**에서는 같은 UID의 프로세스가 engine을 trace할 수 있으므로 Principal 권한 경계가 성립하지 않는다.
- **S-03**: 실행 중인 turn 안에서의 delivery boundary 귀속은 여전히 미결이다. Principal delivery는 idle session에만 전달해 이 질문에 
  의존하지 않는다. 따라서 Human이 긴 turn을 진행하는 동안에는 전달이 그 turn이 끝날 때까지 기다린다.
- TUI/TSP requirement의 trace 상태는 `unverified`다. owner/callPath/negative test는 연결돼 있으나 compliance 기록 절차를 거치지 않았다.
- **비용 상한**: relay가 chokepoint를 되돌려주지만 stream을 해석하지 않으므로 비용 상한은 여전히 OMA 계약이 아니다(`INF-005`).
- 봉인은 host에 `bwrap`과 `/usr`이 있어야 한다. 없는 host에서 T117은 이유를 적고 skip되며 — 이제 skip은 `npm test` 실패다 — 
  제품은 `installation.rootfs`를 `/`로 두는 비봉인 선언으로만 돌 수 있다.
- node/git을 포함한 OS별 배포본은 별도 작업이다.

### A-008 LOC gate — OPEN

현재 수치는 A-008의 10,000행 기준을 넘으므로 **architecture review가 필수이고 release는 차단 상태**다. 기록만 하고 기능 작업을 중단하지 않기로 했으며 review는 별도 작업이다. 동봉 엔진은 수정하지 않은 upstream 의존이라 LOC-003에 따라 계산 대상이 아니며, 엔진을 수정하면 계산 대상이 된다(TUI-018).

## 기본 재검증

실제 명령 정의는 [package.json](../package.json)이 기준이다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
node scripts/loc.mjs
```

source/import graph가 바뀌었다면 current dependency evidence를 재생성한다.

```sh
npm run evidence:graph
npm run check:architecture
```

dependency evidence의 current path는 `implementation/evidence/dependency-graph.json`이다. Generated list, LOC/hash, dependency evidence를 사람이 새 실행처럼 수동 보정하지 않는다.

mutation 하나만 수정할 때는 먼저 관련 surface를 좁힌다.

```sh
npm run mutation:locality -- git.submit
```

focused test를 실행하더라도 전체 invariant/release 의미로 승격하지 않는다.

## 환경별 verification lane

각 output directory는 기존 artifact를 덮지 않는 새 경로를 사용한다.

```sh
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
```

필요한 systemd/kernel/provider/VM 환경이 없으면 PASS가 아니라 `BLOCKED` 또는 `NOT_RUN`으로 기록한다. 일반 개발 host의 SIGKILL/process fixture를 VM power-loss proof로 취급하지 않는다.

## A-008 LOC gate — 현재 OPEN

`node scripts/loc.mjs`의 현재 source-bound 결과는 **217 files / 20,342 code LOC**이며 A-008의 10,000행 기준을 넘는다. 따라서 **architecture review가 필수이고 release는 차단 상태**다. 이 판정은 기록만 하고 기능 작업을 중단하지 않기로 했으며, review 자체는 별도 작업으로 분리한다.

이 gate가 열려 있다는 사실을 기능 추가의 승인으로 해석하지 않는다. TUI 및 제품 표면 source도 TUI-015/LOC-003에 따라 같은 manifest와 같은 budget으로 계산하며, 별도 manifest로 분리해 Core 수치에서 제외하지 않는다.

## 남아 있는 release gate

- `spikes.md`의 OPEN qualification 조건은 fresh harness evidence 없이 닫지 않는다.
- live systemd/cgroup/READY, provider failure/usage/cancel, hostile import, filesystem/kernel containment, VM power-cut/ENOSPC/read-only/restore 등 environment-specific proof는 별도다.
- S-08/S-10 tiered attestation/floor와 S-11 clean-room, S-09 품질·비용·latency 평가는 해당 profile 계약을 따른다.
- LOC/A-008/A-009 판정은 `node scripts/loc.mjs`의 current source-bound 결과로만 갱신한다.
- requirement별 release proof는 [compliance.md](compliance.md)를 따른다.

과거 상세 실행 로그와 단계별 PASS 기록은 [docs/archive.md](../docs/archive.md)의 pre-cleanup snapshot에서 조회한다.

## 보존하는 verification 규범

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
