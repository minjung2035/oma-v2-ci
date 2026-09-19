# OMA v2 — 현재 검증 상태

이 파일이 current verification status와 검증 명령의 단일 owner다. README/HANDOFF에는 test count, LOC, PASS 표를 중복 기록하지 않는다.

## 현재 source 판정

브랜치 `refactor/safety-preserving-architecture`, 기준 HEAD `42e6e8d`, 실행일 2026-09-19. 날짜별 누적 기록은 두지 않는다. 지난 판정은 Git history에서 조회하고, 아래는 현재 tree의 사실만 적는다(MAINTENANCE §29).

### 실행 결과

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:package` | PASS. entries 4개(broker/runner/host/tui), runtime dependency 4개 pin |
| `npm run check:architecture` | PASS, 0 findings |
| `npm test` | **996/996 PASS**, fail/cancelled/skipped/todo=0 |
| `node scripts/loc.mjs` | **187 files / 17,946 code LOC** |

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

### 남은 것

- TUI/TSP requirement의 trace 상태는 `unverified`다. owner/callPath/negative test는 연결돼 있으나 compliance 기록 절차를 거치지 않았다.
- **비용 상한**: relay가 chokepoint를 되돌려주지만 stream을 해석하지 않으므로 비용 상한은 여전히 OMA 계약이 아니다(`INF-005`).
- 봉인은 host에 `bwrap`과 `/usr`이 있어야 한다. 없는 host에서 T117은 이유를 적고 skip되며, 제품은 `installation.rootfs`를 `/`로 두는 비봉인 선언으로만 돌 수 있다.
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

`node scripts/loc.mjs`의 현재 source-bound 결과는 **190 files / 18,208 code LOC**이며 A-008의 10,000행 기준을 넘는다. 따라서 **architecture review가 필수이고 release는 차단 상태**다. 이 판정은 기록만 하고 기능 작업을 중단하지 않기로 했으며, review 자체는 별도 작업으로 분리한다.

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
