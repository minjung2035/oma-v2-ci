# OMA v2 — 현재 검증 상태

이 파일이 current verification status와 검증 명령의 단일 owner다. README/HANDOFF에는 test count, LOC, PASS 표를 중복 기록하지 않는다.

## 현재 source 판정

브랜치 `refactor/safety-preserving-architecture`, WP22 검증 트리의 부모 `b315f89`, 실행일 2026-09-23. WP22는 C1 storage accounting 정리다. broker process마다 하나의 `StorageAdmission`이 매 결정마다 owned tree를 새로 관측하고, 아직 tree에 없는 예약을 더한다. streamed request의 예약은 preflight부터 실행 종료나 연결 종료까지 유지되며 한 번만 반납된다. 이미 수락된 일의 정산은 기존 `limits.frameBytes`만큼의 headroom 안에서 한 번에 하나만 quota를 넘을 수 있다. 시작 시에는 같은 판정으로 bounded recovery에 들어간다. 새 설정 field, usage entity, wire, error code, DB schema와 권한은 추가하지 않았다.

검증 입력: verification input digest `1d9dff5b216265347262d42fbb761460bc515e97ad03c34b1cfece2a38bb0243` (564 files). source/test/script/config/manifest/implementation/generated measurement·graph를 결박하며 validation digest field만 정규화한다.

### 실행 결과

| 검사 | WP22 실행 / 대기 범위 |
|---|---|
| type/build/package/local and lanes | PASS: fast/durable/property/stress 240/266/33/7, local 1413/1413, package; all fail/cancelled/skipped/todo=0 (`wp22-*-initial`, `wp22-local-initial`, `wp22-package-initial`). metadata-bound final rerun required |
| accounting model | logical usage = fresh allocated/logical tree scan + outstanding reservations. A streamed request reserves its declared bytes (first its transport copy, then its accepted copy), so its own dispatch needs room for both; a non-stream admission and every recovery stage count every other connection's reservation. Nothing is cached. The scan is not a hard filesystem quota: same-UID writers outside the broker and SQLite/WAL growth are seen after the fact |
| V22A | two real submissions over scripted sockets: while an accepted stream's execution runs, a concurrent mail.send whose tree alone fits but tree plus the reservation does not is QUOTA_EXCEEDED; after settlement a tree exactly at the quota admits; a stream cut mid-body removes its transport copy and reservation; a completed connection closed twice releases once, so a stream one byte too large is refused before spooling; lease units refuse overflow, negative bytes and exhaustion and release idempotently |
| V22B | at the cap a pending mail settles by recovery within the headroom while new mail and activation are refused; past the headroom settlement is refused, the object is retained and it settles once room exists; one over-cap settlement at a time, unbounded within the cap; a maximal 32-recipient settlement measured file growth within the headroom while SQLite/WAL growth (measured, about 180 KiB on this host) is recorded, not bounded; on a real full tmpfs (user+mount namespace) new mail is STORAGE_FULL with no row and no staged file, and the accepted mail stays pending with its object intact |
| negative controls | on the unchanged production (`75fa748`) the at-cap settlement, the in-flight reservation visibility and the owner units fail; mutants that release the reservation at handle, ignore reservations in the gate, release twice, allow unlimited or unbounded-concurrency settlement, remove the headroom, skip the overflow check or stop mapping ENOSPC each fail. A mutant that records completion after a failed materialization survives: on the full filesystem no completion record can be written either. Lane registration red/green. disposable sources restored |
| not covered | kernel/project quota, VM or storage power loss, provider load, fd/task/RSS stress under long concurrency (WP22.05 beyond V22A) and external writer races are not claimed; the workspace byte guard stays a trusted-extension soft cap |
| systemd/provider/powercut/CI/A-008 | BLOCKED/NOT_RUN/open as previously recorded |

Raw evidence: `/tmp/oma-consistency-evidence-Vc66uK/wp22-*`. Complete initial and metadata-bound final reruns remain required.

Final PASS condition: `wp22-fast-final`, `wp22-durable-final`, `wp22-property-final`, `wp22-stress-final`, `wp22-package-final`, `wp22-local-final` must bind one digest with exit 0 and zero unrun tests.

## 기존 검토 맥락 — 현재 source 실행 증거 아님

아래는 이전 검토에서 남긴 source/문제 설명이다. 이 절의 PASS·실행·숫자·SPIKE 해결 표현을 WP01 이후 source의 확인으로 사용하지 않는다. 전체 문서/역사적 claim 정리는 WP32의 실제 source 대조 범위이며, 이번에는 검토하지 않은 나머지를 완료했다고 하지 않는다.

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

### 제품 표면: 여덟 번째 감사에서 닫은 것

**전송하지 못한 prompt가 어느 것인지 말하지 못했다.** run이 도는 동안 typed된 prompt는 host의 대기열에 들어가면서 그 자리에서
`> text`로 화면에 그려진다 — 사람이 보기에는 이미 수락된 것이다. 그런데 나중에 그 write가 실패하면 화면에 남는 것은
`⚠ 입력을 전송하지 못했습니다: ...` 한 줄뿐이었고, 대기하던 셋 중 무엇이 사라졌는지도, 다시 칠 원문도 남지 않았다. 수락을 동기로
답하게 만든 일곱 번째 수정과 같은 이유로, 실패 보고도 **이름이 있어야 한다**. `SessionSink`에 `onPromptFailed(text, reason)`을
두어 실패한 prompt가 자기 원문과 함께 돌아오고, 표면은 그것을 transcript에 `✗ 보내지 못한 입력: ...`으로 보존한 뒤 draft가 비어
있으면 draft로 복원하며, 알림은 그 원문이 지금 어디에 있는지를 말한다. 사람이 그 사이에 다른 것을 치고 있었다면 draft는 건드리지
않는다 — 되돌려 주는 일이 지금 쓰는 것을 덮어쓰면 그것은 복구가 아니라 두 번째 손실이다. 실패 사유는 문장이 아니라 원인만
전달한다: 표면이 문장을 소유하고, `전송하지 못했습니다`를 두 겹으로 붙이면 "어디에 남았는지"가 화면 폭 밖으로 밀려난다(그 절단을
실제로 한 번 만들었고, 시험이 그 꼬리를 보고 잡았다). 같은 절단이 두 번 나오지 않도록 알림의 순서도 바꿨다 — 그 줄은 화면 폭으로
잘리고 길이를 engine이 정하는 부분은 사유뿐이므로, **어디에 남았는지를 사유보다 앞에** 둔다. 잘리면 사람은 사유를 잃고 복구 방법을
남기며, 반대 순서는 그 반대다. 역검증은 4,000자짜리 사유로 실패를 보고해도 `입력은 그대로 있습니다`가 화면에 남고 어떤 줄도 폭을
넘지 않는 것을 본다. 역검증은 대기열 `first`/`second`/`third` 중 `second`의 write만 실패시켜,
실패 보고가 `second`를 그 원문과 함께 지목하고 `third`가 그대로 이어서 나가는 것을 본다.

**bracketed paste의 안전이 terminal 구현에만 기대고 있었다.** DEC 2004는 terminal이 지키는 약속이다. clipboard가 스스로
`ESC[201~`를 담고 있고 terminal이 그것을 그대로 흘리면, OMA는 그 지점에서 paste가 끝났다고 믿고 뒤따르는 개행을 사람이 누른
Enter로 읽는다 — 사람이 읽지도 않은 텍스트가 제출되는, 일곱 번째 수정이 막으려던 바로 그 실패가 주입으로 되살아난다. 그래서 그
약속에만 기대지 않는다. 첫째, 끝 표시 뒤 **같은 read에 남은 byte는 key가 아니라 그 paste의 내용으로 흡수한다**(그 read가 또 다른
끝 표시를 반쯤 맞춘 채로 끝나면 그 byte들도 content로 되돌려 준다 — paste는 이 read에서 닫히므로 매칭을 마저 할 다음 read가 없고,
버리면 clipboard의 텍스트가 조용히 사라진다. 이것은 이 수정 자체를 적대적으로 다시 읽다가 찾았고, 되돌림을 없애면 시험이
`abcd[2` 대신 `abcd`를 보고 실패한다). 둘째, paste가 끝난
뒤 선언된 burst(`pasteBurstMs`) 안에 도착한 Enter는 제출이 아니라 그 paste의 개행으로 읽는다 — 사람은 그 구간 안에 Enter를 누를 수
없고, clipboard를 재생하는 terminal은 언제나 그 안에 있다. 대가는 그 구간에 실제로 누른 Enter가 한 번 텍스트가 되는 것이며, 그것은
지연이지 제출이 아니다. 시간이 판정에 들어오므로 decoder의 clock을 주입 가능하게 만들어 시험이 경쟁 대신 사실을 진술한다. 역검증은
burst가 지난 뒤의 같은 byte가 다시 `{kind:"enter"}`가 되는 것을 함께 본다 — 규칙이 만료되지 않고 Enter를 죽이면 그것도 실패다.

**문서가 약속한 deadline이 분할 UTF-8에는 실제로 없었다.** 일곱 번째 수정은 "시작해 놓고 끝나지 않은 모든 token에 deadline"이라고
적었지만, `pendingDelayMs`는 paste와 ESC/CSI만 보았다. 반쪽 code point를 들고 있는 상태는 `TextDecoder` 내부에만 있어서 decoder가
스스로 관측할 수 없었기 때문이다. 이제 마지막 code point 길이만큼의 text byte를 따로 기억해 "지금 반쪽을 들고 있는가"를 decoder가
답하고, 그 상태에도 단일 deadline이 붙는다. 포기할 때는 U+FFFD로 바꿔 prompt에 넣지 않고 기다리던 decode state와 함께 버린다 —
아무도 누르지 않은 문자를 engine에 보내는 일이기 때문이며, terminal이 만들어 보낸 U+FFFD도 같은 이유로 key가 아니다. 시험은
`ED 95`에서 deadline이 선언되는 것, `9C`가 오면 `한`이 되는 것, 오지 않으면 아무 문자도 남기지 않고 다음 byte가 자기 key가 되는
것을 본다.

**거절된 paste에서 빠져나오는 길이 사람의 글자를 지웠다.** 한도를 넘은 paste는 draft에 아무것도 더하지 않는다. 그런데 초과 상태는
원인을 들고 있지 않았고, 화면은 언제나 "Backspace로 줄여 주세요"라고 안내했으며, Backspace는 언제나 grapheme 하나를 지웠다 —
`hello`를 쳐 둔 사람이 큰 paste를 거절당한 뒤 안내대로 Backspace를 누르면 `hell`이 되었다. paste가 넣지도 않은 글자를 대신 낸
것이다. 그래서 `PromptDraft.overflow`를 boolean에서 **원인**(`"typed" | "paste"`)으로 바꿨다. 타이핑이 넘긴 것이면 draft에 사람의
글자가 있으니 Backspace가 줄이고, 거절된 paste면 첫 편집이 글자 대신 상태만 해제하며, 알림 문구도 원인별로 갈린다. 역검증은 같은
시험 안에서 타이핑으로 만든 초과가 여전히 Backspace로 한 글자 줄어드는 것을 함께 본다 — 두 경로를 한 규칙으로 되돌리면 둘 중
하나가 반드시 깨진다.

**관측하지 못한 것**: 실제 terminal이 clipboard 안의 `ESC[201~`를 어떤 형태로 흘리는지(위 두 방어는 주입한 byte와 주입한 clock으로
관측했고, 실제 terminal·clipboard 조합으로는 관측하지 않았다), bracketed paste를 지원하지 않는 terminal에서의 동작.

### Principal 제품 경로: 아홉 번째 감사에서 닫은 것

외부 적대적 감사가 HEAD `611c07a`를 FAIL로 판정하며 결함 5건을 지목했다. 다섯 건 모두 소스에서 사실로 확인했고 — 오탐은 없었다 —
같은 자리에서 반복되는 결함이라 판단한 둘은 패치가 아니라 **구조**를 바꿨다.

**attach 때 받은 권한을 연결이 끝날 때까지 다시 쓰고 있었다(P0).** `principal.attach`는 성공 시 `AuthContext`를 한 번 만들어
연결 closure에 담아 두었고, 그 뒤의 모든 요청이 그 값으로 판정됐다. engine A가 attach한 뒤 engine B가 재등록해도 A의 연결은 그대로
살아 있었다 — 규범(IPC-011)이 "재등록은 이전 credential을 무효로 한다"고 적은 것과 정반대로, 이미 들어와 있는 연결에는 무효화가
닿지 않았다. 새 credential을 막는 것만으로 권한을 회수했다고 부른 것이 결함의 뿌리였다. 그래서 권한을 **값이 아니라 binding**으로
바꿨다: 연결은 attach할 때 등록 **세대 번호**에 묶이고, 모든 요청과 preflight가 "지금 등록된 세대가 아직 그 번호인가"를 다시 묻는다.
재등록·broker 교체·endpoint 종료는 세대를 올리고 그 자리에서 이전 세대의 socket을 파괴한다. 역검증: 실제 자식 프로세스를 engine으로
세우고 그 연결을 연 채 재등록하면 다음 요청이 `AUTH_FAILED`가 되며, 세대 비교를 지우면 그 요청이 통과해 시험이 실패한다.

**두 engine을 막는 것이 lock이 아니라 connect probe였다(P0, TOCTOU).** host는 admin socket에 연결해 보고 실패하면 broker를
spawn한 뒤 `{kind:"started"}`를 돌려주었고, `oma.ts`는 state가 `already-running`만 아니면 engine을 시작했다 — `unavailable`,
즉 broker가 아예 없는 경우까지 포함해서. probe와 자식이 lock을 잡는 시점 사이에 다른 `oma`가 먼저 lock을 잡으면 두 프로세스가 같은
private workspace와 같은 session 기록의 writer가 된다. 구조 원칙을 하나 세워 닫았다 — **spawn한 pid는 소유가 아니다.** 소유의
증거는 broker가 society lock을 쥔 뒤에만 보내는 `ready` 하나뿐이고, 그 보완물로 `onDisowned`를 두었다. 제품의 어떤 코드도
`broker.state`를 보고 engine을 시작할지 판단하지 않는다. 자식 쪽도 바꿨다: broker는 config·SQLite·복구보다 먼저 lock을 시도하고,
얻지 못하면 `SOCIETY_OWNED_EXIT`(6)으로 끝난다 — "이미 주인이 있다"와 "내가 못 떴다"는 host가 반대로 다뤄야 하는 사실이므로
(앞은 소유 포기, 뒤는 재시작) 같은 status로 말할 수 없다. 역검증 셋: 실제 `dist/src/entry/broker.js`를 lock을 쥔 프로세스 옆에서
띄우면 status 6과 그 이유를 stderr로 내고 `runtime.sqlite`를 만들지 않으며(lock을 놓아 주면 같은 실행이 다른 status가 된다),
status 6으로 끝난 자식은 재시작되지 않고 소유 포기가 되며, 준비 신호 전에 engine을 시작하면 composition 시험이 실패한다.

**등록 응답에 상관관계가 없었다(P1).** supervisor의 `pending`은 session handle 없는 callback 하나였다. engine A의 등록이 시간
초과로 버려진 뒤 A에 대한 broker의 늦은 답이 도착하면, 그 답이 그때 기다리고 있던 engine B의 promise를 해결했다 — B가 A의 credential을
받는다. 이제 `pending`이 자기 `sessionHandle`을 들고 있고, 응답은 그 handle과 대조된 뒤에만 해결된다. 어긋난 답은 이유와 함께
버린다. 같은 이유로 supervision channel의 `refused`도 handle을 싣도록 문법을 넓혔다 — 거절만 이름이 없으면 같은 혼선이 거절 쪽으로
남기 때문이다. 역검증: stand-in broker가 다른 handle로 답하면 등록은 부재로 끝나고 이유가 남으며, 대조를 지우면 그 답이 현재 등록을
해결해 실패한다.

**소유가 정해지기 전에 있는 파일을 다시 썼다(P2).** `provisionSociety()`는 모든 `oma` 시작에서, 즉 누가 society를 소유하는지 알기
전에 돌면서 이미 있는 `/etc/passwd`·`/etc/group`을 `writeFileSync`로 덮어썼다. 내용이 같아도 쓰기는 쓰기다 — inode와 timestamp가
바뀌고, 경쟁에서 진 프로세스가 소유자의 트리를 건드린 것이 된다. 감사가 제안한 "소유 확정 뒤에 provisioning"은 순환이라 택하지 않았다
(broker는 트리가 없으면 시작할 수 없고, 소유는 broker가 확정한다). 대신 **멱등을 "같은 바이트를 다시 쓴다"가 아니라 "쓰지 않는다"로**
정의했다: 생성 파일은 현재 내용이 생성값과 다를 때만 쓰고, 읽을 수 없는 생성 파일은 "다르다"가 아니라 설명할 수 없는 항목이므로
덮어쓰지 않고 거절한다. 역검증: 두 번째 provisioning 뒤 inode·mtime·ctime이 모두 그대로이며, 무조건 쓰기로 되돌리면 실패한다.
내용이 위조된 identity 파일은 여전히 교정되는 것도 같은 시험이 함께 본다.

**검증 기록이 자기 산출물과 맞지 않았다(P1).** `611c07a`의 commit message는 `npm test 1135/1135`를 적었는데 이 파일은 여전히
`1128/1128`이었고, LOC 인용값도 산출물과 어긋났으며, CI는 `NOT_OBSERVED`로만 적혀 있어 "아직 안 봤다"처럼 읽혔다. 실제로는 이
브랜치에서 확인된 run 67개가 전부 실패이고 가장 최근 run의 `baseline` job은 step 0개로 끝났다. 위 실행 결과 표를 이번 실행의 실제
값으로 갱신하고, CI 행을 `NOT_OBSERVED`에서 **FAIL**로 바꿔 현재 SHA에 묶인 성공 run이 없다는 사실을 적었다. A-008(10,000행) 초과와
kernel/crash lane의 `BLOCKED, NOT_RUN`은 그대로 열려 있다.

**이번 수정 전체의 역검증**은 결함을 하나씩 소스에 되돌린 사본에서 시험을 돌려, **정확히 그 시험만** 실패하는 것으로 확인했다.

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| 세대 binding 제거(attach 때 권한 고정) | T114 재등록이 이미 attach된 연결을 끊는다 | 실패함 |
| broker entry가 소유와 실패를 같은 status로 말함 | T115 실제 entry가 두 번째 주인이 되기를 거절한다 | 실패함 |
| host가 소유 status에 재시작으로 반응 | T115 소유 status는 재시작이 아니라 소유 포기다 | 실패함 |
| spawn 직후 engine 시작 | T119 engine은 소유가 증명된 뒤에만 시작한다 | 실패함 |
| 등록 응답의 handle 대조 제거 | T115 다른 session을 지목한 답은 현재 등록을 해결하지 않는다 | 실패함 |
| 생성 파일 무조건 쓰기 | T115 두 번째 provisioning은 inode·timestamp를 보존한다 | 실패함 |

**관측하지 못한 것**: 두 `oma` 프로세스를 실제로 동시에 띄워 lock 경쟁을 재현한 것은 아니다. 실제 `dist/src/entry/broker.js`를
lock을 쥔 프로세스 옆에서 띄워 진 쪽의 동작만 production 경로로 관측했고, 이긴 쪽과 진 쪽이 같은 순간에 갈리는 지점은 관측하지
않았다. CI 사실은 감사 보고를 인용한 것이며 이 세션에서 `gh`로 재확인하지 않았다.

### Principal 제품 경로: 열 번째 감사에서 닫은 것

외부 적대적 감사가 HEAD `51759fd`를 FAIL로 판정하며 결함 4건을 지목했다. 네 건 모두 소스에서 사실로 확인했다 — 오탐은 없었다.
네 건 가운데 셋이 같은 자리, 즉 **"소유를 무엇으로 아는가"** 에서 나왔고, 아홉 번째 감사에서도 같은 자리를 패치했으므로 이번에는
그 정의 자체를 갈아엎었다.

**소유를 잃은 뒤에도 engine이 계속 돌았다(P0).** `broker-supervisor`는 재시작 한도를 소진하면 `onDisowned`를 부르고, `oma.ts`는
그 자리에서 화면에 줄만 적었다. 이미 시작한 Pi session은 그대로 살아 있었고, 그 society의 lock은 아무도 쥐고 있지 않으므로 두 번째
`oma`가 들어와 자기 engine을 시작할 수 있었다 — `principal/private`와 session 기록의 writer 둘. 시험(`oma-composition-policy`)은
그 동작을 "이미 쓰고 있던 session을 끊지 않는다"로 **고정까지 해 두고 있었다**. 잘못된 oracle이 결함을 지켜 준 것이라 시험도 함께 뒤집었다.

뿌리는 `onDisowned`의 처리 방식이 아니라 소유의 정의였다. 소유가 자식(broker)의 lock에서 파생하는 한, broker가 죽고 다시 뜨는
back-off 구간과 한도 소진 이후 전체가 소유의 공백이고, 공백마다 같은 결함이 다시 생긴다. 그래서 소유를 자식에게서 떼어
**host가 직접 드는 society lease**(`src/runtime/society-lease.ts`, run root의 `society.lease`)로 옮겼다. host는 설정을 읽기 전,
state에 한 바이트를 쓰기 전, broker를 띄우기 전에 lease를 잡고 자기 수명 내내 들고 있다. broker의 lock은 없어지지 않았지만 이제
다른 질문 — 이 프로세스가 society의 유일한 SQLite writer가 되어도 되는가 — 에만 답한다.

따름정리 둘을 코드로 박았다. 첫째, **lease와 engine의 수명은 같다**: 소유를 잃는 사건은 통지가 아니라 teardown이며, session을 닫고
전달을 멈춘 **뒤에** lease를 놓는다(순서가 뒤집히면 놓는 순간부터 두 engine이 겹친다). 둘째, **lease를 소유보다 먼저 알게 되므로
provisioning을 소유로 막을 수 있다** — 아홉 번째 감사에서 "순환이라 택하지 않았다"고 적었던 그 순환이 사라졌다.

**두 `oma`의 첫 시작이 실제로 경쟁하면 진 쪽이 깨졌다(P1).** `provision.ts`는 `if (existsSync(path)) return false;` 뒤에 최종
경로로 바로 `git init --bare` 했다. 두 프로세스가 같은 틈에 들어가면 진 쪽은 `File exists`나 config lock 충돌로 exit 128을 받고,
그것이 `STORE_CORRUPT`가 되어 제품이 "저장소가 깨졌다"고 말했다 — 실제로는 아무것도 깨지지 않았는데. 생성을 원자적으로 바꿨다:
같은 부모 아래 점으로 시작하는 staging 디렉터리에 `git init --bare` 한 뒤 `renameSync`로 제자리에 놓고, `ENOTEMPTY`/`EEXIST`/`ENOTDIR`는
"경쟁에서 졌다"로 읽어 이긴 쪽의 repository를 그대로 받아들인다. 아홉 번째 감사에서 "관측하지 못한 것"으로 남겨 두었던
**실제 두 프로세스의 동시 첫 시작**을 이번에는 시험으로 만들었다(둘 다 exit 0, canonical main을 심은 쪽은 정확히 하나,
`git fsck --strict` 통과, staging 디렉터리 잔해 없음).

**소유를 알기 전에 있는 상태를 고쳤다(REC-007 위반, P1).** 여덟·아홉 번째 감사에서 "같은 바이트를 다시 쓰지 않는다"까지는 갔지만,
내용이 **다르면** 여전히 덮어썼고 어긋난 symlink는 교체했다 — 소유를 모르는 시점에. 규범이 금지하는 것은 재작성이 아니라 소유 전의
쓰기다. 그래서 하나의 멱등 함수를 **두 개의 정책**으로 갈랐다: `provisionSociety`는 없는 것만 만들고, 있고 다른 것은 손대지 않은 채
`pendingRepairs`로 **보고**한다. `repairSociety`는 그것을 되돌리며, lease 보유자만, broker 준비 뒤에, 정확히 한 번 실행한다.
시험도 뒤집었다 — 변조된 `/etc/passwd`가 준비 단계에서 교정되는 것을 검증하던 행은, 이제 바이트·inode·mtime·ctime이 모두 그대로임을
요구한다.

**engine이 죽어도 이미 attach된 자손이 권한을 유지했다(P1).** `principal.attach`는 자손 여부를 attach 시점에 한 번만 확인했고,
`authority()`는 등록 세대만 다시 봤다. engine이 죽으면 그 자식은 init으로 reparent되어 더 이상 누구의 자손도 아닌데, 세대는 그대로라
그 고아가 Principal 권한을 계속 썼다. 이제 권한은 **매 요청과 preflight마다 `/proc`에서 다시 계산**한다: 현재 등록 세대인가, 그리고
연결한 프로세스가 지금도 등록된 engine의 자손인가. engine의 죽음은 pid가 아니라 pid와 시작 시각의 쌍으로 판정하고, 확인되면 session
전체를 은퇴시키되 거절을 먼저 쓴 뒤에 끊는다. 시험은 실제 자식을 낳는 stand-in engine을 세우고, 그 자식으로 attach한 뒤 engine을
SIGKILL하고 **reap까지 기다려서**(좀비는 `/proc`에 같은 시작 시각으로 남아 있어 기다리지 않으면 시험이 결함을 못 본다) 관측한다.

**이번 수정 전체의 역검증**은 결함을 하나씩 소스에 되돌린 사본에서 시험을 돌려, **정확히 그 시험만** 실패하는 것으로 확인했다.

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| `onDisowned`를 화면 출력만으로 되돌림 | T119 소유를 잃은 society는 그 소유가 지불한 engine을 잃는다 | 실패함(1/12) |
| provisioning을 lease로 막지 않음 | T119/REC-007 lease를 못 잡은 프로세스는 아무것도 쓰지 않는다 | 실패함(1/12) |
| rootfs 생성 pass가 다른 내용을 덮어씀 | T115/REC-007 두 번째 준비는 트리를 바이트·inode 그대로 둔다 | 실패함(1/24) |
| lease가 모든 실패를 "남의 것"으로 보고 | T119 잡을 수 없는 lease는 남의 소유로 보고되지 않는다 | 실패함(1/5) |
| 최종 경로에 직접 `git init --bare` | T115/REC-007 두 첫 시작이 경쟁해도 둘 다 살아남는다 | 실패함(3/3 재실행) |
| `authority()`에서 자손 재확인 제거 | T114/AUTH-003 죽은 engine은 그것이 낳은 프로세스의 권한을 함께 가져간다 | 실패함 |

**관측하지 못한 것**: lease 경쟁은 실제 두 프로세스로 관측했으나(한쪽이 쥔 society를 다른 쪽이 `null`로 거절당하고, SIGKILL된
프로세스의 lease를 커널이 돌려주는 것까지), 그 두 프로세스가 **실제 `oma` 진입점**인 것은 아니다 — `tryHoldSociety`를 직접 부르는
실제 별도 프로세스다. `oma` 진입점 전체의 경쟁은 여전히 통제된 모듈 경계에서만 관측했다. engine 사망 시험의 stand-in engine은 Pi가
아니라 자식을 낳는 Node 프로세스다. CI 사실은 감사 보고에서 인용한 것이며 이 세션은 `gh` 인증이 없어 직접 재확인하지 않았다.

### Principal 제품 경로: 열한 번째 감사에서 닫은 것

외부 적대적 감사가 HEAD `3792782`를 FAIL로 판정하며 결함 5건을 지목했다. 코드에 관한 네 건은 모두 소스에서 사실로 확인했다 —
오탐은 없었다. 감사가 정한 우선순위(lease를 실제 process-death fence로 → registration-before-delivery → repair-before-broker →
non-owner UI write 차단)를 그대로 따랐고, 앞선 두 감사가 이미 **같은 자리**(소유를 무엇으로 아는가)를 지적했으므로 이번에도 패치가
아니라 구조를 바꿨다.

**lease가 process-death fence가 아니었다(P0).** 열 번째 감사에서 소유를 broker에서 host로 옮겼지만, lease를 놓는 것은 여전히
**이 프로세스가 실행하는 코드**였다. `close()`는 신호이지 죽음이 아니므로, host가 SIGKILL을 보내고 lease를 놓은 직후 두 번째 `oma`가
들어와 자기 engine을 시작할 수 있었고, host 자신이 SIGKILL되면 커널이 그 즉시 lock을 떨어뜨리는데 engine은 그대로 살아 있었다.
호출 순서를 고쳐서는 닫을 수 없는 구멍이다 — 코드가 아예 돌지 않는 경로가 문제이기 때문이다.

그래서 lease를 **프로세스가 드는 lock이 아니라 open file description이 드는 lock**으로 바꿨다. flock은 프로세스가 아니라 열린 파일
기술(description)에 붙고, 자식이 물려받은 descriptor는 같은 description을 가리키므로, lock은 그 descriptor **마지막 하나가 닫힐 때**
풀린다. lease 덕분에 시작되는 모든 자식(broker, engine, 그리고 그들이 시작한 것들)에게 그 descriptor를 물려주면, "engine과 그 자손이
모두 죽기 전에는 society가 넘어가지 않는다"가 **커널이 지키는 사실**이 된다 — 이 코드가 한 줄도 돌지 않는 SIGKILL·정전에서도.
따름정리로, 놓는 것은 **늦을 수는 있어도 이를 수는 없다**: 기다리지 못한 teardown은 두 engine이 아니라 커널을 기다리는 것으로 퇴화한다.

**소유가 흩어진 플래그로 표현돼 있었다.** `lease`, `session`, `brokerReady`, `disowned`가 따로 있었고 그 사이의 불변식은 진입점
문장 순서에 살았다. 세 번의 감사가 같은 부류의 결함을 서로 다른 자리에서 찾아낸 이유가 그것이라, 플래그를 없애고
**`HostTenure`**(`src/runtime/host-tenure.ts`) 하나로 합쳤다. 이 프로세스가 society를 소유하는 동안 정확히 그만큼 존재하는 객체이고,
소유가 주는 모든 권한을 이 객체에 **묻는다**: fence(무엇을 물려줘야 하는가), `deliverable`(지금 전달해도 되는가),
`assertOwned`(이 쓰기가 허용되는가), `end`(무엇이 죽은 뒤에 놓는가). 부팅 순서도 이 객체를 중심으로 고정했다 —
**lease 취득 → provision → repair 성공 → broker spawn → engine 등록**.

**등록이 거절됐거나 미정인데 delivery가 돌았다(P1).** 전달은 "broker가 준비됐다"만 보고 있었고, 그것은 credential이 engine에
도달했다는 뜻이 아니다. 이제 `principalRegistered`는 `brokerLive`와 **별개의 항**이고, broker가 다시 준비될 때마다 먼저 닫힌다
(재시작한 broker는 이전 broker가 준 등록을 상속하지 않는다). 전달 조건은 네 항 전부 — tenure, 살아 있는 broker, 현재 등록,
engine — 이며 하나라도 거두면 닫힌다. broker 쪽 host endpoint도 같은 질문을 스스로 한다: host 신원은 **필요하지만 충분하지 않고**,
이 broker가 그 host의 engine에 대한 등록을 쥐고 있어야 하며, 등록의 유효성은 매 요청마다 pid와 시작 시각으로 다시 계산한다.
(이 재계산은 이번에 새로 쓴 시험이 찾아낸 결함이다 — 처음 구현은 기록된 pid를 그대로 믿었다.)

**rootfs 수리와 Resident 활성화 사이에 happens-before가 없었다(P1).** 수리는 broker 준비 뒤에 돌았고, broker는 듣기 시작하자마자
할 일이 있는 Resident를 활성화한다. 두 프로세스 사이에 확인 절차가 없으므로 의지할 수 있는 순서는 broker가 **존재하기 전**의 순서뿐이다.
수리를 broker spawn 앞으로 옮기고, 수리 실패를 치명적으로 만들었다 — 보증할 수 없다고 말한 rootfs 위에서 Resident를 돌리는 것과
건강한 시작을 구분할 수 없게 만드는 것이 이전 동작이었다.

**소유하지 않은 Control Panel이 read-only가 아니었다(P1).** `setField`/`setExtension`이 소유를 묻지 않아, 두 `oma` 프로세스가 한
society의 정책 파일을 동시에 고칠 수 있었다. 검사를 **쓰기 지점**으로 옮겼다(`owning()`) — 쓰기가 일어난다는 것을 아는 유일한 자리다.

**CI 증거(P2).** 감사의 구조적 지적을 받아들인다: 커밋 내부에 그 커밋 자신의 SHA에 대한 CI 결과를 적는 것은 항상 한 SHA 뒤처지며
자기충족적이다. 이 세션에도 `gh` 인증이 없어 실행 사실을 직접 확인하지 못했다. 따라서 이 문서가 증거로 내세우는 것은 CI 행이 아니라
아래의 **되돌린 결함 표**다 — 트리 안에서 재현 가능하고, 외부 상태에 의존하지 않는다.

**역검증**: 결함을 하나씩 소스에 되돌린 사본(`src/`·`test/`만 동기화한 sandbox)에서 시험을 돌려, **정확히 그 시험만** 실패하는 것으로
확인했다.

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| `HostTenure.end()`에서 engine 종료 대기 제거 | REC-007 lease는 멈추라고 말한 뒤가 아니라 engine이 사라진 뒤에 놓인다 / T119 종료는 engine이 실제로 거두어진 뒤에 society를 돌려준다 | 실패함(tenure 2/13, composition 1/18) |
| 두 spawn helper에서 `stdio.push(fence)` 제거 | T119/REC-007 owned RPC 자식과 supervised service가 lease를 들고 시작한다(채널 변형 포함) | 실패함(4/13) |
| `deliverable`에서 `principalLive` 항 제거 | PR-002 네 항 전부 / 거절된 등록은 열지 않는다 / 재시작한 broker는 등록을 상속하지 않는다 + T119/PR-002 거절된 등록은 아무것도 전달하지 않는다 | 실패함(tenure 3/13, composition 1/18) |
| 수리를 broker spawn 뒤로 옮기고 실패를 비치명적으로 되돌림 | T119/REC-007 rootfs는 그 위에서 무엇이 돌기 전에 바로잡힌다 / 바로잡지 못하면 broker도 engine도 시작하지 않는다 | 실패함(2/18) |
| `setField`/`setExtension`의 소유 확인 제거 | T119/REC-007 남의 society 위의 Control Panel은 쓰지 못한다 / 소유를 돌려준 화면도 같다 | 실패함(2/18) |
| host endpoint의 등록 gate 제거 | T114/PR-002 등록을 쥐고 있는 동안에만 delivery가 제공된다 / 끝난 등록은 delivery를 다시 닫는다 | 실패함(2/45) |
| `registeredEngine`의 pid·시작 시각 재확인 제거 | T114/PR-002 끝난 등록은 아무도 알려 주지 않아도 delivery를 닫는다 | 실패함(1/45) |

두 번째 행은 이번 세션에서 **처음에는 아무 시험도 실패하지 않았다** — fence를 `oma.ts` 경계에서만 확인하고 있었고, helper가 그것을
실제로 자식에게 건네는지는 아무도 묻지 않았다. 그 자리를 메우는 시험(자식이 스스로 `fstat`으로 답하고, 부모가 자기 몫을 놓은 뒤에도
society가 넘어가지 않는 것까지 실제 프로세스로 관측)을 새로 쓴 뒤에야 위의 결과가 됐다. 대조군 — fence 인자를 뺀 같은 helper —
은 같은 자리에 lease가 아닌 descriptor가 오고 society가 즉시 넘어가는 것을 보여, 앞의 네 시험이 "자식이 우연히 죽지 않았다"가 아니라
"자식이 lease를 들고 있다"를 증거하고 있음을 고정한다.

**관측하지 못한 것**: fence의 커널 보증은 실제 프로세스로 관측했다(host SIGKILL, engine 생존 중 1초 동안의 거절, 손자 프로세스만
남은 경우, 제품의 두 spawn helper). 그러나 그 실제 프로세스들은 `tryHoldSociety`와 spawn helper를 직접 부르는 별도 Node 프로세스이지
**실제 `oma` 진입점**이 아니다 — 진입점 전체의 배선은 여전히 통제된 모듈 경계(`node:vm`, 닫힌 `require` 지도)에서만 관측했다.
정전·강제 재부팅은 관측하지 않았다(커널 동작에 대한 추론이다). `HostTenure` 시험의 engine은 Pi가 아니라 stand-in이며, Pi 자체는
동봉본을 그대로 쓰고 수정하지 않는다. CI는 이 세션에서 인증이 없어 확인하지 않았다.

### Principal 제품 경로: 열두 번째 감사에서 닫은 것

감사는 fence 자체가 아니라 **fence가 닿는 범위**를 쟁점으로 삼았고, 그 지적은 맞았다. 네 건을 감사가 매긴 우선순위 그대로 닫았다.

**fence가 실제 모델 대면 CLI까지 닿지 않았다(P0 ①).** `runCliProcess`는 자식에게 fd 0–2(credential이 있으면 3까지)만 주고 lease를
주지 않았다. 그 CLI는 society의 reader가 아니라 **writer**다 — agent home이 `<stateRoot>/principal/private`이고 request cache를 그
아래에 쓴다. engine에 보낸 신호는 engine의 자식에게 가지 않으므로, 모델이 `oma_mail_send`를 부른 직후 host와 engine을 SIGKILL하면
CLI는 자기 timeout(120초) 내내 살아서 쓰고, 그 사이 새 `oma`가 society를 가져간다. 정확히 lease가 막으려던 두 writer다. 이제 확장은
자기 환경의 `OMA_SOCIETY_FENCE_FD`를 읽어 그 descriptor를 자식의 fd 4에 놓고, 자식에게도 같은 이름으로 그 번호를 알린다. 선언이
있는데 descriptor가 없거나 lease의 종류가 아니면 **자식을 시작하지 않고 실패한다** — 선언을 무시하고 시작하는 것은 그 선언이 막으려던
상태 그 자체이기 때문이다.

**pathname으로 이름 붙인 lease는 대체될 수 있었다(P0 ②).** flock은 inode를 잠그지만 호출자는 경로로 파일을 고른다. 같은 UID의 어떤
프로세스든 그 경로를 `unlink`/`rename`하고 새 파일을 그 자리에 만들 수 있다 — 기존 소유자는 옛 inode의 lock을 계속 쥐고, 새 `oma`는
정식 경로에 있는 새 inode를 잠그며, 한 society에 서로를 보지 못하는 두 소유자가 생긴다. 취득 뒤에 inode를 다시 확인하는 것은 창을
좁힐 뿐 검사와 사용이 여전히 두 단계다. 감사의 요구대로 패치가 아니라 **설계를 바꿨다**: lease는 abstract AF_UNIX namespace의 이름
`\0oma.society.<sha256(uid + state root)>`이고, 파일시스템에 아무것도 만들지 않는다. 지울 directory entry가 없으니 바꿔치기할 대상이
없고, 두 번째 `bind`는 커널이 `EADDRINUSE`로 거절하며, 이름은 마지막 descriptor가 닫힐 때 — SIGKILL 포함 — 풀린다. FS-005가 "같은
UID에서 file mode로 경계를 주장할 수 없다"고 말한 것을 mode가 아니라 **이름공간**에 적용한 것이다. 이름을 run root가 아니라 state
tree에서 뽑은 것도 같은 회에 고쳤다: 하나의 `XDG_DATA_HOME`을 두 `XDG_RUNTIME_DIR`에서 열면 lease가 둘이 됐다.

**standalone broker와 host tenure가 합의하지 않았다(P1 ③).** systemd unit이나 손으로 띄운 broker는 `broker.lock`만 쥔다. 그래서 새
`oma`는 비어 있는 lease를 받아 설정을 쓰고, society를 provision하고, **repair까지** 한 다음 — repair는 `/etc/passwd`·`/etc/group`과
rootfs 안 symlink를 고친다 — `superviseBroker`의 admin probe에서야 남의 broker를 발견했다. 이제 그 질문을 **아무것도 쓰기 전에**
묻는다. 이미 듣고 있는 broker가 있으면 lease까지 돌려주고 Control Panel로 남는다: 행동하지 않기로 한 society를 쥐고 다음 `oma`를
막을 이유가 없다.

그러나 묻는 쪽만 고치는 것은 여전히 검사와 사용이 두 단계다 — probe와 첫 쓰기 사이에 올라오는 broker는 막지 못한다. 같은 자리에서
두 번 나온 결함이므로 이번에는 **broker 쪽에서도 같은 질문에 답하게** 했다. 제품이 시작하지 않은 broker는 `broker.lock` 외에
society lease를 **자기가** 잡고, 잡지 못하면 SQLite 파일 하나 만들지 않고 소유 status로 끝난다. 제품이 시작한 broker는 그
descriptor를 fd 4로 물려받았으므로 다시 잡지 않는다 — 다시 잡으려 하면 자기 host에게 `EADDRINUSE`로 거절당한다. 자기가 어느
쪽인지는 supervisor가 환경에 넣어 준 `OMA_SOCIETY_FENCE_FD` 선언으로 알고, 그 선언이 가리키는 descriptor가 없거나 lease의 종류가
아니면 시작하지 않는다. 이로써 "이 society에 손을 대도 되는가"는 host와 broker 양쪽에서 같은 커널 객체 하나에 묻는 질문이 되고,
`broker.lock`은 그 옆에서 원래의 다른 질문 — 이 프로세스가 유일한 SQLite writer가 되어도 되는가 — 에만 답한다.

**run root 신뢰 판정이 lease 취득 뒤였다(P1 ④).** `tryHoldSociety`가 `mkdirSync(runRoot)`를 먼저 하고 lease를 열었으므로, 상대
경로·비정규화 경로·symlink된 run root를 가리킨 `oma`는 그 디렉터리를 만들고 society를 가져가고 설정을 쓴 뒤에야 자신이 받은 검사에
닿았다. 이제 경로에 대한 판단이 lease보다 **앞**에 끝난다. state root는 lease 이름이 거기서 나오므로 lease 자신이 검사한다.

**fence 전파를 사람이 묻지 않게 했다.** 같은 자리에서 반복되는 결함이므로 검토가 아니라 구조로 막았다:
`scripts/architecture/rules/fence-rules.mjs`가 `src/` 안의 모든 spawn 지점을 훑어, fence를 넘기거나 `fenceExemptSpawnOwners`에 이유를
적어 두거나 둘 중 하나를 강제한다. 사라진 spawn에 대한 면제와, 이제 fence를 넘기는데도 남아 있는 면제는 **둘 다 gate 실패**다 —
면제가 파일 안에서 조용히 낡지 않는다.

**역검증**: 결함을 하나씩 소스에 되돌린 사본(`src/`·`test/`·`scripts/`만 동기화한 sandbox)에서 시험을 돌렸다.

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| `runCliProcess`에서 fence 전달·선언 제거(감사가 발견한 원본 형태) | T119/REC-007 engine이 시작한 모델 대면 CLI가 society를 들고, host·engine이 죽은 뒤에도 유지한다 / 선언한 fence가 없으면 CLI를 unfenced로 시작하지 않는다 | 실패함(2/17). 같은 되돌림을 architecture gate도 **단독으로** 잡았다: `fence-propagation`, `src/extension/cli-process.ts#runCliProcess` 1 finding |
| lease를 `<stateRoot>/society.lease` flock으로 되돌림 | T119/FS-005 society를 잡는 것은 아무것도 쓰지 않고, 파일시스템의 어떤 것도 lease가 아니다 | 실패함(3/17) — 의도한 FS-005 1건과, lease의 종류가 바뀌자 fence 검사가 그것을 lease로 인정하지 않아 함께 실패한 CLI 시험 2건 |
| broker 진입점에서 lease 취득 제거(감사가 지적한 원본 형태: `broker.lock`만 쥠) | T119/REC-007 제품 밖에서 시작한 broker는 `oma`가 쥔 society에서 소유 status로 끝나고 아무것도 쓰지 않는다 / P1 composition root의 lease 관련 3건 | 실패함(1/26 + 3/11) |
| supervisor가 `OMA_SOCIETY_FENCE_FD` 선언을 넣지 않게 되돌림 | T119/REC-007 제품이 시작한 broker는 lease descriptor를 fd 4로 받고 그 번호를 환경에서 듣는다 | 실패함(1/26) — 정확히 그 시험 하나. 합성 시험은 supervisor를 보지 않으므로 여기서는 11/11 통과이고, 그것이 두 시험이 서로 다른 경계를 고정한다는 뜻이다 |
| standing broker probe를 provision/repair 뒤로 옮김 | T119/REC-007 이미 듣고 있는 broker는 이 프로세스가 무엇을 쓰기 전에 발견된다 | 실패함(2/22) |
| run root 판정을 lease 취득 뒤로 옮김 | VAL-002/FS-005 run root는 society를 잡기 전에 판정된다 | 실패함(2/22) |

마지막 두 행은 대조군도 함께 실패한다. 그것이 옳은 동작이다: 두 대조군이 고정하는 것이 결과가 아니라 **순서**이기 때문이다. broker
대조군의 첫 단언은 "probe가 일어났다"이고(되돌림이 probe 자체를 없앴다), run root 대조군의 단언은
`assertHostDirectoryLayout < tryHoldSociety`다(되돌림이 뒤집은 바로 그 부등호다). 첫 두 행의 대조군 — fence를 선언하지 않은 engine —
은 반대로 **그대로 통과한다**: 그 시험이 고정하는 것이 "fence가 없으면 society가 즉시 넘어간다"는 결함 쪽 사실이므로, 결함을 되돌린
트리에서 통과하는 것이 정의상 맞다.

첫 행의 시험은 stand-in이 아니라 실제 세 프로세스 사슬(host → engine → CLI)로 관측했다. CLI는 자기 fd 4를 `fstat`해 dev:ino로
스스로 답하고, host와 engine을 SIGKILL한 뒤에도 society가 500ms 동안 넘어가지 않는 것과, CLI를 죽인 뒤에는 넘어가는 것까지 같은
시험 안에서 관측한다.

**관측하지 못한 것**:

- **봉쇄된 Resident(`spawnSandboxed`/bwrap, `pi-adapter#deliver`)는 fence를 받지 않는다.** 일부러 그렇게 뒀다. lease는 듣고 있는
  이름이므로 봉쇄 안에 descriptor를 넣으면 봉쇄 안에서 그 이름에 답할 수 있게 된다. 정직한 해법은 fence가 아니라 커널이 집행하는
  자손 종료 경계(cgroup)이고, 그것은 이 회차에서 하지 않았다. 지금 상태는 `architecture.md`와 `implementation-spec.md`에 예외로
  적혀 있으며 **닫히지 않았다**.
- `verify:kernel`/`verify:crash`는 이 세션에서도 BLOCKED, NOT_RUN이다(`OMA_TEST_SYSTEMD=1`인 disposable user 환경 아님).
  `crash-boundaries`가 내는 `BLOCKED` 는 PASS가 아니다.
- 현재 SHA에 묶인 CI PASS는 없다. 감사가 인용한 run #70까지 이 브랜치의 성공은 0이며, 이 세션도 `gh` 인증이 없어 직접 확인하지
  않았다.
- **N-001 pin이 낡아 있다(이번 작업과 무관한 기존 상태).** `implementation-spec.md`의 N-001은 `architecture.md`의 SHA-256을
  `7588b31e…`로 고정하고 있으나 HEAD의 `architecture.md`는 이미 `1df3c11…`이었다. 이 pin을 기계적으로 검사하는 gate가 없다. 이번에
  값을 조용히 덮어쓰지 않았다 — 덮어쓰면 일어나지 않은 검토가 일어난 것처럼 기록된다. 별도 작업으로 남긴다.

### 접수 전 artifact 소유권과 CI provenance: 열세 번째 감사에서 닫은 것

감사는 83/100을 매기고 우선순위를 명시했다. 그 순서 그대로 ①과 ②를 닫았고, ③은 **닫지 않았다**(아래 '관측하지 못한 것').

**접수되지 않은 게시물의 주인이 아무도 아니었다(①).** `mail.send`·`git.submit`·`agent.create`·`context.publish`는 모두 접수
transaction보다 **먼저** immutable object를 `mail/objects/<id>.eml`에 게시한다. 그런데 `claimKey → journal.classifyKey`는 순수한
읽기이므로(`src/store.ts:232`), 같은 actor/key를 동시에 요청한 두 호출은 둘 다 `absent`를 보고 `await buildFrozenMessage(...)`를
지나 **각자 다른 messageId를 고정**할 수 있다. transaction에서 진 쪽(`"retry"`), 그 안에서 거부된 쪽, T 안에서 던져진 쪽, 그리고
`agent.create`가 linked로 흡수되어 initial message를 이름으로 갖지 않게 된 쪽은 자기가 만든 inode를 그대로 남겼다. 남은 orphan은
`src/diagnostics/integrity.ts:86`이 `unknown`으로 분류하므로 — "Preaccept orphans are not silently repaired" — corruption 기반
oracle에는 보이지도 않았다.

감사가 제안한 방향이 이 코드베이스의 기존 구조와 같았으므로 그대로 **일반화**했다. `PreparedSubmitSpool`은 이미 "접수 전에 게시된
것을 접수 여부로 정산하는" 상태 기계였다. 그것을 `src/storage/preaccept-artifact.ts`의 `PreacceptOwner`로 끌어올리고,
`freezeObject`가 `void`가 아니라 `PreacceptArtifact`를 돌려주게 했다. 소유 조건은 단 하나 — 그 artifact를 이름으로 가진 operation이
ledger에 접수되었는가 — 이고, 네 coordinator가 전부 같은 질문(`settleByAcceptance`)에 답한다. 정산은 게시 시점의 dev/ino와 지금 그
이름이 가리키는 inode가 같을 때만 unlink하므로 교체된 이름이나 남의 artifact는 건드리지 않고, 두 번 불러도 같다. **DB를 읽을 수
없어 접수 여부를 알 수 없으면 보존한다 — 불확실성은 삭제 권한이 아니다.** 반대로 preparation artifact는 의도의 기록이므로 연결이
끊겨도 남긴다. 이 구분이 `src/git/context.ts`의 주석에 그대로 적혀 있다.

고친 쪽은 orphan을 **만들지 않는** 쪽이지 검사기가 orphan을 **못 본 척하는** 쪽이 아니다. `integrity.ts:86`의 `unknown` 분류는
그대로 두었고, PRE-4가 세 가지 실패 형태를 모두 일으킨 뒤 `OBJECT_DIRECTORY_UNOWNED`가 0건이고 판정이 `PASS`임을 관측한다.

감사가 "staging만 보고 `mail/objects`는 보지 않는다"고 지적한 기존 P06도 같은 회에 보강했다: 여섯 개의 알려진 request key에서
접수된 operation이 이름으로 가진 object 집합을 뽑아 디렉터리와 정확히 대조한다.

**CI가 한 branch만 보고, 자기가 잰 tree가 아닌 SHA로 증거를 보관했다(②).** workflow는
`push: [refactor/safety-preserving-architecture]`에만 연결돼 있었으므로 master의 바이트도, master를 바꾸자는 제안도 CI가 한 번도
관측하지 않았다. 그대로 `pull_request`를 붙이면 더 나쁜 상태가 된다: pull request에서 `github.sha`는 CI가 만들어 낸 merge commit이고
`actions/checkout`의 기본값도 그 merge ref이므로, 증거가 **어떤 repository에도 남지 않는 SHA**에 묶인다. 그래서 검증 대상을
`github.event.pull_request.head.sha || github.sha`로 한 번만 정하고, checkout·artifact 이름·최종 gate가 모두 그 값을 쓰며,
**무엇을 재기 전에** checkout된 tree가 정말 그 commit인지 `git rev-parse HEAD`와 대조한다. 그 뒤 생성기가 입력을 다시 쓰기 전에
local gate와 같은 closure(`verificationInputDigest`)로 "어떤 바이트가 돌았는지"를 기록하고, binding을 잃은 run은 성공을 보고할 수
없다. commit 이름은 어느 revision을 뜻했는지만 말하고 어떤 바이트를 쟀는지는 말하지 않는다 — 이 digest가 그 자리를 메운다.

**역검증**: 결함을 하나씩 소스에 되돌린 사본(`src/`·`test/`·`scripts/`·`.github/`만 동기화한 sandbox)에서 시험을 돌렸다.

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| `mail.send`가 정산·retain을 하지 않던 원래 형태 | PRE-1 동시 같은 key / PRE-2 같은 actor·key를 다투는 다른 method / PRE-3 freeze 직후 주입한 transaction 실패 / PRE-4 그 실패들 뒤 inspection에 UNKNOWN 없음 | 실패함(4/8) — 정확히 그 네 건 |
| `agent.create`가 linked·retry 경로에서 정산하지 않던 원래 형태 | PRE-5 실제 `LifecycleModule.create()`의 linked 경로는 initial message를 이름으로 갖지 않으므로 object를 소유하지 않는다 | 실패함(1/8) — 정확히 그 한 건 |
| `git.submit`이 spool만 정산하고, `context.publish`는 전혀 정산하지 않던 원래 형태 | PRE-8 진 `git.submit` / 충돌한 `context.publish` / `git.submit`과 `mail.send`의 실제 같은 key 경쟁 | 실패함(1/8) — 정확히 그 한 건 |
| workflow를 원래 형태로 되돌림(통합 branch만, `github.sha`로 보관, tree 대조 없음, digest 기록 없음) | T116 master/pull request 연결 / merge commit이 아닌 head commit 검증 / 측정 전 tree 대조 / 생성기 이전 digest 기록 / commit 이름으로 보관 / binding 잃은 run은 성공 불가 | 실패함(6/15) — 기존 T116 9건은 그대로 통과했다. 되돌림이 새 성질에만 닿았다는 뜻이다 |

첫 시도의 PRE-2는 되돌린 트리에서도 **통과했다**. 원인은 시험 쪽이었다: `mail.send`는 transaction 이전에도 `claimKey`를 부르므로
첫 send가 이미 끝난 뒤의 두 번째 호출은 `freezeObject`에 닿기 전에 `REQUEST_KEY_REUSED`로 끝난다 — 순차 호출로는 경쟁 자체가
일어나지 않는다. 실제 동시 경쟁(`Promise.allSettled`로 둘 다 pre-check를 통과시킨 뒤 transaction에서 갈리게)으로 다시 쓴 뒤에야
되돌림에 물렸다. 통과하는 대조군은 증거가 아니라 시험의 결함이라는 것을 그 자리에서 확인한 셈이다.

워크플로 쪽은 정적 대조만으로는 부족하므로, 새로 넣은 두 step과 최종 gate를 YAML에서 뽑아 **실제로 실행**했다: 올바른 SHA에서
binding·digest 기록·최종 gate가 모두 성공하고, 틀린 SHA에서는 binding이 거절하며, 다른 commit 이름이 적힌 provenance와 provenance가
없는 evidence는 최종 gate가 각각 거절한다.

**관측하지 못한 것**:

- **③은 닫지 않았다.** 감사가 세 번째로 든 same-UID FS/S-06 — `src/storage/transport-spool.ts:28,30,54`,
  `src/storage/staged-tree.ts:45,55`, `src/storage/durable-fs.ts:149,161` 이 여전히 pathname 기반인 것 — 과 실제
  systemd/quota/power-cut lane은 이 회차에서 손대지 않았다. 감사 자신이 ①②보다 뒤에 두었고, 현재의 `SPIKE_UNRESOLVED` fail-closed
  broker 동작은 감사도 "오히려 올바른 현 상태"라고 적었다. **닫힌 것으로 세지 않는다.**
- **CI의 새 결박은 이 tree 안에서만 관측했다.** 위 표의 마지막 행과 실제 실행은 workflow 원문과 그 step들의 동작에 대한 것이고,
  GitHub에서 돈 run에 대한 것이 아니다. 이 세션은 여전히 `gh` 인증이 없고, 현재 SHA에 묶인 성공 run은 없다.
- `verify:kernel`/`verify:crash`는 이 세션에서도 BLOCKED, NOT_RUN이다.

### society lease의 신원과 receipt의 순서: 열네 번째 감사에서 닫은 것

감사는 코드품질 84/100, release confidence 58/100을 매기고 순서를 명시했다 — ① lease FD identity 검증 → ② 그 exploit을
process-level regression으로 고정 → ③ RequestCache CAS/monotonic receipt → ④ flock errno 분리 → ⑤ S-06 dirfd mutation 정리 →
⑥ CI green + branch protection. ①–⑤를 그 순서대로 닫았고 ⑥은 **닫지 못했다**(아래 '관측하지 못한 것').

**아무 socket이나 society lease로 통했다(①, HIGH).** `inheritedFence`는 선언된 descriptor를 `fstat`해서 socket이면 lease로
받아들였다. socketpair도 socket이다. 그래서 손으로 띄운 아무 프로세스나 descriptor 4에 아무 AF_UNIX socket을 얹고 환경변수
하나(`OMA_SOCIETY_FENCE_FD=4`)를 선언하면, 다른 `oma`가 이미 쥐고 있는 society를 소유한다는 증명으로 통했다 — 그리고 broker는
그 선언을 믿고 **lease를 아예 잡지 않았다**. 소유자가 둘이 되는 것보다 나쁜 결과다: 소유를 아무도 쥐지 않은 채 소유했다고
announce한 상태가 된다.

`fstat`이 답할 수 있는 것은 **모양**이고 필요한 것은 **신원**이었다. 감사가 "proof claim ↔ implementation predicate 불일치"라고
부른 바로 그 형태다 — 주석은 강한 성질을 주장하는데 oracle은 약한 술어를 본다. 그래서 술어를 조금 더 조이지 않고 **질문을
바꿨다**: 이 descriptor는 *어떤 이름*을 쥐고 있는가. society lease는 abstract AF_UNIX namespace의 이름
(`"\0oma.society." + sha256(uid\nstateRoot)`)이고 커널은 한 open file description에게만 그 이름을 준다. 그러므로 **이름을 쥐고
있다는 것이 곧 소유한다는 것**이며, 그 descriptor를 내민 프로세스의 주장은 하나도 믿을 필요가 없다.
`abstractNameHeld(fd)`(`src/leaf.ts:294`)가 그 하나의 oracle이고 `holding | other | unreadable` 세 답만 낸다. "평가하지 못했다"를
"남의 것이다"나 "괜찮다"로 접는 순간 둘 다 소유를 아무도 쥐지 않은 society 위에 engine을 띄우므로, 세 번째 답은 접지 않는다.

그리고 **판정의 주인을 하나로 옮겼다.** 예전에는 "무엇이 lease인가"를 entrypoint가 스스로 정했다. 지금은
`claimSocietyFence(stateRoot)` 하나가 `inherited | taken | elsewhere`를 돌려주고 entrypoint는 그것을 묻고 따르기만 한다
(`src/entry/broker.ts:74`). 감사가 "다음 적대적 감사의 핵심 타깃"으로 지목한 그 불일치 형태를 이 tree에서 한 건 더 찾아 같은
방식으로 닫았다: `test/broker-composition-policy.test.mjs`는 제품이 더 이상 수행하지 않는 `fstat`+`isSocket()` 검사를 증명하고
있었다. 네 가지 모양 판정(제품이 lease를 두지 않는 descriptor, 열려 있지 않은 descriptor, 남의 society의 lease, socket이 아닌
것)을 의미의 주인인 `test/society-lease-identity.test.mjs`로 옮겨 **커널에게** 묻게 하고, 조립 증명에는 "entrypoint가 그 거절을
소유 판정이 아니라 기동 실패로 다룬다"만 남겼다. 거기에 **source gate**를 붙였다 — entrypoint는
`tryHoldSociety`·`inheritedFence`·`SOCIETY_FENCE_FD`·`fstatSync`를 이름으로도 부르지 못한다. 한 번의 실행이 그 규칙을 우연히
지키는 것과 그 규칙에 닿을 길이 아예 없는 것은 다르고, 이 술어가 entrypoint로 흘러들어간 것이 애초의 결함이었다.

**그 exploit을 프로세스 경계에서 고정했다(②).** 감사가 요구한 시험 그대로다 — society A의 유효한 lease FD를 society B의 broker에
넘겨도 B가 거부한다. 진짜 `execve`를 건너서 묻는다: descriptor를 새 프로세스로 상속시키는 것이 이 성질이 참이어야 하는 유일한
자리이기 때문이다. **대조군의 대조군**을 같이 둔다 — 같은 descriptor를 그것이 정말 lease인 society에 대해서는 받아들여야 한다.
그러지 않으면 제품이 전부 거절해도 이 시험은 통과한다.

**정산된 receipt가 나중의 덜 확정된 관측에 덮였다(③, MEDIUM).** `RequestCache`는 읽고·판단하고·쓰는 세 단계를 각각 따로 했으므로
두 프로세스가 같은 key를 다투면 `failed`로 정산된 receipt 위에 `pending`이 앉을 수 있었다. 두 가지를 동시에 넣었다.
`receiptSupersession(previous, observed)`이 **순서**의 유일한 주인이고 — terminal 뒤의 non-terminal은 `stale`,
succeeded↔failed는 `contradiction`, 같은 terminal의 반복도 `stale` — `withReceiptLock(key, body)`가 읽기와 쓰기를 **하나의 임계
구역**으로 묶는다. 잠글 수 없으면 `CACHE_UNAVAILABLE`로 실패한다: 잠그지 못한 채 진행하는 것이 애초의 결함이었다.

**`flock` 실패가 전부 "남이 소유"로 접혔다(④, LOW–MEDIUM).** 경쟁인 것은 `EWOULDBLOCK` 하나뿐이고 `EBADF`는 평가 실패다.
`held | contended | failed` 세 답으로 분리했다. 판정하지 못한 것을 소유로 보고하면 host는 재시작 가능한 고장과 정당한 소유를
구별할 수 없다.

**검증한 parent를 버리고 pathname을 다시 해석했다(⑤).** 감사가 S-06이라고 부른 same-UID FS namespace 경쟁이다. 결함의 모양은 늘
같았다 — 경로를 풀고, 검사하고, **그 경로로 다시** 효과를 낸다. 같은 UID의 아무 프로세스나 그 사이에 namespace를 바꿀 수 있으므로
두 번의 walk가 같은 객체에 닿는다는 보장이 없다. 같은 자리에서 반복해서 나온 결함이므로 술어를 늘리는 대신 구조를 바꿨다:
`openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS)`로 연 **parent dirfd**를 쥔 채 `withinDirectory(path, (parent, name) => …)` 안에서
효과까지 끝낸다. 검사한 디렉터리와 쓰는 디렉터리가 같은 객체임을 커널이 보증하므로, 그 사이에 넣을 창 자체가 없다.

**이 저장소의 S-06은 이것이 아니다.** `implementation/spikes.md:110-120`의 S-06은 durability/systemd/전원 차단 qualification이고
상태는 여전히 **OPEN(환경 부재)** 이다. 감사는 같은 이름을 same-UID FS 경쟁에 썼다. 코드로 닫을 수 있는 쪽은 닫았고 환경이 있어야
닫히는 쪽은 닫지 않았다 — 이름이 같다고 함께 닫힌 것으로 세지 않는다.

**역검증**: 결함을 하나씩 `dist/`에 — 조립 증명은 build 산출물이 아니라 원문을 transpile하므로 `src/entry/broker.ts` 한 파일에도
— 되돌려 시험을 돌렸다. harness는 매 회 원본을 그대로 복구하고 마지막에 `git diff --stat`으로 tree가 되돌아왔음을 확인한다.

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| `inheritedFence`가 socket이면 무엇이든 lease로 받던 원래 형태 | AUTH-003 신원 검사 전부(모양이 같은 nameless socket, pathname socket, 남의 society, `execve` 건넌 regression) | 실패함(6건) |
| `ENOTSOCK`을 다시 `unreadable`로 접음 | "일반 파일은 lease가 아니다" — 확정된 거절이 평가 실패로 보고되는지 | 실패함(1건) |
| `receiptSupersession`이 언제나 `supersedes` | REC-007 순서 3건(경쟁 시험 포함) | 실패함(3건) |
| `withReceiptLock`이 그냥 `body()` | 경쟁 중인 잠금 시험 | 실패함(1건) |
| `flock` 실패를 전부 `contended`로 | LOC-003 세 답 분리 | 실패함(1건) |
| pathname 기반 `rename`/`lstat` 형태 복귀 | S-06/FS-005 held-parent 4건 | 실패함(4건) |
| entrypoint가 `elsewhere`를 무시 | P1 조립: 남이 소유한 society에서는 기동하지 않는다 | 실패함(1건) |
| 소유 판정을 entrypoint 안으로 되돌림 | P1 조립 8건(source gate 포함) | 실패함(8건) |

대조군으로 동작하지 않은 것은 없다.

한 가지는 정확히 적어야 한다. `withReceiptLock`을 되돌렸을 때 **결정적으로** 실패하는 것은 경쟁 잠금 시험 한 건이고, 같은 파일의
경쟁 시험 — 여러 프로세스가 같은 key들을 동시에 걸어 정산된 receipt가 덮이는지 보는 것 — 은 **stress**다: 단독으로 돌리면 8/8
실패하지만 대조군 8개를 이어 돌린 회차에서는 물리지 않았다. 확률적으로 재현하는 시험을 결정적 증거로 세지 않는다.

그 경쟁 시험 자체도 네 번 고쳐 썼다. 경쟁자가 하나뿐이면 정산하는 쪽의 읽기-쓰기 창 안에 들어가는지가 스케줄링 운이고,
`pending` 위의 `pending`은 이미 `stale`이라 첫 pass 뒤로는 아무것도 쓰지 않으며, 끝 신호를 먼저 확인하는 경쟁자는 한 번도 쓰지
않을 수 있다. 경쟁자 셋이 `pending`/`unknown`을 번갈아 쓰며 정산이 끝날 때까지 돌게 하고 나서야 결함에 물렸다. **통과하는
대조군은 증거가 아니라 시험의 결함**이라는 것을 이 회차에서도 그대로 확인했다.

**관측하지 못한 것**:

- **⑥ CI green과 branch protection은 닫지 못했다.** 감사는 이 브랜치의 성공 run 0 / 실패 72, `f1f18bd`의 run은 어떤 step도 돌기
  전에 끝났고 `master`와 개발 브랜치가 둘 다 `protected: false`라고 적는다. 이 세션은 `gh` 인증이 없어 직접 확인하지 않았고 push
  뒤의 run을 관측할 수단도 없다. 위 PASS 행들은 전부 로컬 관측이다.
- **`verify:fast`는 이 기록을 고치기 전 실행에서 FAIL이었다.** 실패한 두 건은 `R38` 자기참조 검사 — 이 파일이 인용하는 수치와
  digest가 낡았다는 것 — 뿐이었고 다른 실패는 없었다(204 tests / 202 pass / 2 fail). 이 기록을 고친 뒤 다시 실행한 결과를 위
  표에 적었다.
- **저장소의 S-06(durability/systemd/전원 차단)은 여전히 OPEN**이고 `verify:kernel`/`verify:crash`는 BLOCKED, NOT_RUN이다.
  환경 gate이지 코드 gate가 아니다.
- **fence descriptor 상수가 두 곳에 선언돼 있다** — `src/process/async.ts:153-156`과 `src/extension/cli-process.ts:40-41`. 지금은
  값이 같지만 이것을 기계적으로 대조하는 gate가 없다. 이번 회차에서 손대지 않았고 drift 위험으로 남긴다.

### 설정 bundle의 소유권과 tool surface 전송의 총체성: TUI/Tool Surface 정합성 개선안 R1

감사와 별개로 "TUI와 extension은 Core가 이미 판정한 의미를 소비하고, 스스로 같은 의미를 다시 판정하지 않는다"는 개선안을 받았다.
이 tree에서 열네 번 반복된 결함이 전부 **하나의 사실에 owner가 둘이고 약한 쪽이 write를 쥐고 있다**는 같은 모양이었으므로 방향은
맞다고 판단했다. 다만 근거 없이 구조를 옮기지는 않기로 하고, 각 항목에 대해 **실제로 재현되는 결함이 있는지 먼저 확인**했다.
이번 회차에서 닫은 것은 우선순위 R1(P1, P2)이고 P3–P6은 닫지 않았다(아래 '하지 않은 것').

**bundle이 무엇을 담고 있는지를 세 곳이 각자 답했고, 그중 규칙이 없는 쪽이 write를 쥐고 있었다(P1).** `oma-operations-v1`
manifest를 읽는 코드가 `src/config/operations.ts`, `src/tui/sources/settings.ts`, `src/tui/sources/extensions.ts` 세 곳에 있었다.
loader의 규칙은 강하다 — 참조는 정규화된 상대 경로여야 하고, bundle root 안에서 해석돼야 하며, symlink를 통과해서는 안 된다.
Config 화면의 것은 그보다 약했고, Extensions 화면의 것은 `join(root, String(file))` 한 줄로 containment가 **아예 없었다**. 그리고
그 화면이 role 파일에 **쓴다**.

고치기 전에 probe로 재현했다. `roles.resident`를 `"../OUTSIDE.json"`으로 적은 bundle에서 loader는 거부했지만
(`roles.resident escapes the configuration bundle`), `readExtensions`는 role 경로로 `/tmp/oma-probe-.../OUTSIDE.json`을 돌려줬고
`toggleExtension`은 그 파일을 **bundle 바깥에서 덮어썼다**. 제품이 절대 load하지 않을 설정이 TUI에게는 편집 가능한 설정이었던
셈이다.

그래서 화면의 규칙을 조이는 대신 **질문의 주인을 옮겼다**. `configurationLayout(path)`가 "이 bundle은 무엇을 담고 있는가"의
유일한 답이 되고(`ConfigurationLayout`), `readConfigurationSource`도 그것을 소비한다 — manifest를 두 번 걷지 않는다. 두 화면은
자기 parser를 잃었고 `layout.roles`가 준 경로에만 쓴다. loader가 거부하는 bundle은 편집 대상이 아니라 **보고 대상**이 된다
(`editable: false`). 증명도 실행 하나에 기대지 않는다. `test/config-bundle-owner.test.mjs`의 네 번째 시험은 두 화면의 **소스에
`"oma-operations-v1"` 문자열이 없을 것**을 요구한다 — 형식을 부를 수 없는 화면은 형식을 다시 해석할 수 없다.

**tool surface 전송은 owner가 이미 하나였고, 틀린 것은 증명 쪽이었다(P2).** `encodeToolSurfacePlan`은 `src/domain/tool-surface.ts`
하나뿐이고 `src/runner.ts`, `src/tui/session.ts`, `scripts/functional-surface.mjs`가 모두 그것을 부른다. decode도
`src/extension/tool-surface.ts` 하나뿐이다. 그래서 P2에는 옮길 소유권이 없었다. 대신 **감사가 지목한 그 불일치가 시험 안에
있었다**: `T100/TSP-002: the plan round-trips through its transport encoding unchanged`라는 이름의 시험이 실제로는 일곱 필드 중
`defaultMode`, `roots`, 그리고 group의 `children` 세 가지만 확인하고 있었다. `direct`, `disabled`, `grouped`, group의 `name`과
`description`은 전송 중에 사라져도 이 시험이 아무 말도 하지 않았다. 이름은 전체를 주장하는데 술어는 일부를 본다.

술어를 이름에 맞췄다. plan의 모든 필드가 비어 있지 않은 값을 갖도록 만든 뒤 encode→decode 결과 전체를 한 번에 비교하고,
전송된 JSON의 key 집합이 plan의 key 집합과 같을 것을 요구하고, **encoder가 쓰는 모든 필드를 하나씩 지워가며 decoder가 전부
`malformed`로 거부하는지** 확인한다. decoder가 없어도 받아주는 필드는 sandbox가 그것 없이 동작하는 필드이고, encoder가 조용히
보내지 않게 되어도 아무도 모르는 필드다.

되돌린 결함과 그때 실패해야 하는 시험:

| 되돌린 결함 | 실패해야 하는 시험 | 결과 |
|---|---|---|
| Extensions 화면이 다시 bundle 경로를 스스로 조립(containment 없음) | CFG-005 탈출·symlink 2건 | 실패함(2건) |
| 화면 소스에 `"oma-operations-v1"`를 되돌려 놓음 | CFG-005 source gate | 실패함(1건) |
| encoder가 `disabled` 필드를 전송하지 않음 | T100 round-trip, T103 fail-closed | 실패함(2건) |
| decoder가 `grouped` 누락을 받아들임 | T100 round-trip | 실패함(1건) |

소유권을 옮기면서 기존 시험 두 건을 고쳤고, 둘 다 제품이 아니라 시험 쪽의 문제였다. `surface-adversarial`의 거절 검사는
화면이 내던 옛 문구(`relative path`)를 정규식으로 보고 있었으므로 loader의 문구로 바꿨다 — 거절 자체는 전후 모두 일어난다.
`tui-sources`의 T97 fixture는 manifest가 이름만 대고 파일은 만들지 않은 `models.json`을 갖고 있었다. 화면이 loader의 규칙을
쓰기 시작하면서 manifest가 부르는 모든 참조가 해석돼야 하므로 그 bundle은 이제 편집 대상이 아니다. 제품이 시작할 수 없는
bundle이었다는 뜻이고, fixture가 존재하는 파일을 부르도록 고쳤다.

**하지 않은 것**: 개선안의 P3(환경변수를 `PrincipalLaunchPlan`으로), P4(`PrincipalSession` ownership을 `RunState` union으로),
P5(`PanelReadPorts`/`SocietyWriteCapability` 분리), P6(`updateValidatedDocument`). 각각 probe로 확인한 결과 **재현되는 결함을
찾지 못했다**. 특히 P3에서 환경을 조립하는 두 곳(`src/tui/session.ts`의 `sessionEnv`, `src/runtime/pi-spawn-plan.ts`의
`omaEnvironment`)은 같은 사실의 두 owner가 아니라 **서로 다른 두 사실**이었다 — 전자는 host에서 뜨는 Principal engine의 환경,
후자는 `--clearenv` 아래 confined Resident의 환경이고 겹치는 항목은 `OMA_TOOL_SURFACE` 하나다. 재현되는 결함 없이 구조를 옮기는
것은 이 기록이 반복해서 경계해 온 종류의 변경이므로 남겨 둔다.

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

`node scripts/loc.mjs`의 현재 source-bound 결과는 **220 files / 21,891 code LOC**이며 A-008 기준을 넘는다. WP22 변경 뒤 LOC/hash와 dependency graph를 재생성했지만 review/release gate는 OPEN이다.

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
