# OMA v2 — 현재 검증 상태

이 파일이 current verification status와 검증 명령의 단일 owner다. README/HANDOFF에는 test count, LOC, PASS 표를 중복 기록하지 않는다.

## 현재 source 판정

### 2026-09-19 — 설정 없이 바로 실행

`oma`를 빈 프로젝트 디렉터리에서 실행하면 초기화 명령도 손으로 쓴 설정도 없이 시작한다.

- society 이름이 없으면 실행 디렉터리에서 유도한다. 체크아웃이 다르면 society도 다르다.
- 설정이 없으면 `src/config/defaults.ts`가 보수적인 설정을 만들어 **파일로 기록한 뒤** 계속한다. 생성값은 전부 bounded하고 Control Panel에서 보이고 고칠 수 있으므로 CFG-002의 "무제한·검사 없음·비싼 모델로 채우지 않는다"를 우회하지 않는다. Resident에 `code.integrate`를 기본으로 주지 않고 `initialResidents`는 비운다.
- 로그인·모델 선택은 동봉 엔진이 이미 가진 흐름을 쓴다. 기본 model profile은 `provider=pi, model=current`이며 OMA는 provider나 credential을 스스로 주장하지 않는다. schema가 닫혀 있어 채워야 하는 나머지 model 필드는 placeholder이고 그 사실을 소스에 적었다. 실제 usage bound는 S-04가 계속 소유한다.

**중간에 바로잡은 설계.** 처음에는 사용자의 `~/.pi/agent/`에서 `auth.json`·`models*.json`을 symlink로 상속하게 만들었다. 이는 두 가지로 틀렸다. 사용자의 개인 상태에 손을 대고, 사용자가 Pi를 설치했는지에 따라 동작이 갈려 "Pi 없이도 동작한다"는 전제를 깬다. 되돌렸고, 동봉 엔진은 OMA 소유 agent 디렉터리 안에서만 자기 흐름으로 인증한다. `pi-runtime.ts`와 `entry/oma.ts`에 `homedir`·`.pi` 참조가 없음을 T106이 고정한다.

관측: 빈 디렉터리 `demo-app`에서 인자 없이 실행 → society `demo-app` 생성, `config.json` 자동 생성, agent 디렉터리는 비어 있고(엔진이 스스로 채움) 사용자 `~/.pi` 참조 0건, 종료 코드 0.

검증: `npm test` **997/997 PASS**, `check:architecture` 0 findings, `node scripts/loc.mjs` **190 files / 18,208 code LOC**. `src/config/defaults.ts`는 kernel zone **K0-values**로 분류했다(contracts와 errors만 의존하는 순수 값 생산자).

### 2026-09-19 — Pi 엔진 동봉: 별도 설치 불필요, 사용자 Pi와 공존

OMA가 Pi 엔진을 함께 배포하고 자기 것만 실행한다. Pi는 **수정하지 않고** 동봉한다.

- `@earendil-works/pi-coding-agent`를 devDependencies에서 **dependencies로 옮겼다.** `npm install`이 엔진을 함께 가져오므로 사용자가 Pi를 따로 설치할 필요가 없다.
- `src/runtime/pi-runtime.ts`가 해석의 단일 owner다. `PATH`를 보지 않고 `/usr/bin/pi` fallback도 없다. 엔진이 없으면 `UNSUPPORTED_PROFILE`로 실패한다. entry는 동봉 패키지의 `bin.pi`에서 읽는다. Pi의 `exports` 맵이 `./package.json`을 노출하지 않아 module resolver가 실패하므로, `node_modules` 체인을 직접 걸어 manifest를 읽고 `name`이 일치할 때만 채택한다.
- 엔진에는 `PI_CODING_AGENT_DIR`로 `<stateRoot>/pi`를 지정한다. 지정하지 않으면 엔진이 사용자의 `~/.pi`를 공유하므로, 이것이 공존의 핵심이다. Resident(`pi-adapter`)와 Principal(`tui/session`) 양쪽에 적용했다.
- 운영자는 `OMA_PI_COMMAND`로 다른 엔진을 pin할 수 있다. 절대 경로여야 하고 부재 시 거절한다.

**실제 관측.** 이 개발 머신에는 사용자 Pi가 `/usr/bin/pi → /usr/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`로 설치돼 있다. 그럼에도 OMA는 `/usr/bin/node <저장소>/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`를 실행하고 `PI_CODING_AGENT_DIR=<stateRoot>/pi`를 넘긴다. 임시 state root로 `oma`를 기동했을 때 세션이 계속 살아 있었고(제한 시간까지), OMA 소유 agent 디렉터리가 생성됐으며 시작 실패 메시지는 0건이었다. 즉 **사용자 Pi가 있어도 자기 복사본을 쓰고, 설정도 섞이지 않는다.**

**LOC.** 동봉 엔진은 수정하지 않은 upstream 의존이므로 LOC-003에 따라 production 계산 대상이 아니다. 엔진을 수정하기 시작하면 계산 대상이 되고 A-008 기준을 다시 검토해야 한다는 것을 TUI-018에 명시했다.

규범: architecture **§23.11**, spec **TUI-016/017/018**, test-matrix **T105**. 기준본 hash는 `b64baeb1…`로 갱신했다.

검증: `npm test` **995/995 PASS**(신규 8건 `test/pi-runtime.test.ts`), `check:architecture` 0 findings, `node scripts/loc.mjs` **189 files / 18,088 code LOC**.

미검증: sandbox(Resident) 경로의 rootfs 안 엔진 bind는 `SandboxHost`가 아직 외부 공급이라 이번 범위 밖이다. node/git까지 포함한 OS별 배포본도 별도 작업이다.


### 2026-09-19 — extension digest를 spawn 직전에 재검증

미구현 상태였던 MUST를 구현했다. `operations/README`는 "runner entry는 시작 직전에 기록된 SHA-256을 다시 확인한 뒤 core 및 role extension을 Pi에 `-e` 전달한다"고, TUI-010은 "선택한 항목의 SHA-256을 기록하고 실행 직전에 다시 확인한다"고 요구하지만, **재검증 코드가 어디에도 없었다**. digest는 config 로드 때 한 번 계산된 뒤 `src/runner.ts`에서 `.path`만 남기고 버려졌고, Principal 경로도 같았다.

- `src/runtime/extension-integrity.ts`가 단일 owner다. 기록된 `{path, sha256}`를 spawn 직전에 다시 해싱해 비교하고, 불일치·삭제·정규 파일 아님·형식이 틀린 digest를 모두 `UNSUPPORTED_PROFILE`로 기동 거절한다. "그 extension만 빼고 계속"하는 경로는 없다. role의 tool 표면은 host가 승인한 것의 일부이기 때문이다.
- 파일은 한 번 열어 그 descriptor에서 해싱한다. stat과 read 사이에 경로가 바뀌어도 원본으로 해싱되지 않는다.
- Resident 경로(`runner.ts` → `pi-adapter.ts`)와 Principal 경로(`entry/oma.ts` → `tui/session.ts`) 양쪽 모두에 적용했다. core extension도 기록 목록에 포함해 검증하되 argv에는 두 번 전달하지 않는다.

**범위는 정직하게 좁다.** 이것은 config 로드와 spawn 사이의 창을 닫을 뿐이다. 검증 직후 Pi가 파일을 여는 사이에 같은 UID가 파일을 바꾸는 경합은 막지 못하며, deployment manifest digest나 Pi executable 승인을 대신하지도 않는다. 자산 식별이지 containment가 아니다. `operations/README`가 이미 같은 한계를 적고 있다.

검증: `npm test` **987/987 PASS**, `check:architecture` 0 findings, `node scripts/loc.mjs` **188 files / 17,966 code LOC**. T104를 test-matrix에 추가했고 회귀 3건이 `test/tui-integration-defects.test.ts`에 있다. 경계 test 2건의 assertion을 정정했는데, 주석의 요구사항 ID(`TUI-010`)를 경로 참조로 오인하는 false positive였다. 완화가 아니라 실제 참조 구문만 보도록 좁힌 것이다.


### 2026-09-19 — refactor 종료: contract 역의존 0, 통합 결함 4건 수정

**Contract 역의존 제거 (완료).** `contract-direction-plan.json`의 네 alias를 모두 없앴고 `currentFrozenContractAliases`는 0이다.

- `Capability`, `ResourceLimits`, `ProtocolLimits`는 이제 contract owner가 선언하고, `src/domain/`의 runtime descriptor가 **양방향 compile-time exhaustiveness**로 그 선언에 묶인다. 한쪽에만 항목을 추가하면 gate가 아니라 build가 실패한다.
- `Transaction`은 port로 대체하지 않고 **제거**했다. `StorePort.transaction`의 콜백은 인자가 없고 `src/`와 port 어느 쪽도 contract의 `Transaction`을 소비하지 않아, port를 만들면 호출자 없는 abstraction이 된다. 계획의 전략과 다르며 그 근거를 plan JSON의 `completed`에 기록했다.
- Contract 선언 표면은 68 → 67, facade export는 67 → 66이다. 실제로 바뀐 선언이 위 네 개뿐임을 HEAD 대비 declaration diff로 확인한 뒤 golden fixture를 갱신했고, 근거는 `implementation/contracts/README.md`에 남겼다.

**Architecture checker 정리 (범위 축소).** 계획은 "rules/로 이전된 검사를 architecture-check.mjs에서 제거"였으나, 음성 fixture로 실증한 결과 두 구현은 **이전이 아니라 상호보완**이다. 같은 위반에 대해 rule module은 `contract-direction` 하나를, legacy는 `contract-ownership`에 더해 `type-import-cycle`까지 보고한다. 따라서 `contractOwnershipFindings`는 유지하고, 실제로 죽은 코드인 `frozenContractAliases` allowlist(2,445자)만 제거했다. CLI/mutation 규칙에는 애초에 중복이 없었다.

**통합 결함 4건 수정.**

1. Extensions 화면이 role 파일의 optional `toolSurface`를 지울 수 있었다. `toggleExtension`이 세 필드만 다시 썼기 때문이다. 이제 쓰기 직전에 파일을 다시 읽어 `extensions`만 교체하고 나머지 필드를 보존한다.
2. Principal TUI 세션에 role extension과 `toolSurface`가 적용되지 않았다. `entry/oma.ts`가 `extensions: []`를 넘기고 있었다. 이제 Principal role의 extension 목록과 검증된 projection을 `OMA_TOOL_SURFACE`로 전달한다.
3. Config 화면이 split operations bundle을 파괴할 수 있었다. `writeSettings`가 index 파일에 flat `HostConfigV1`을 덮어썼다. 새 `commitField`가 형식을 판별해 각 필드를 실제 owner 파일(role 파일 또는 host.json)에 patch하고 policy revision을 갱신한다. bundle 밖으로 나가는 상대 경로는 거절한다.
4. Tool surface의 fail-closed가 느슨했다. `setActiveTools` 실패를 `catch {}`로 삼키고, `getActiveTools` 실패를 빈 배열로 취급해 **모든 tool을 비활성화할 수 있었다**. 이제 세 경로 모두 명시적으로 실패한다.

**검증.**

- `npm run typecheck`, `npm run build`, `npm run check:package`: PASS.
- `npm run check:architecture`: PASS, 0 findings.
- `npm test`: **984/984 PASS**, fail/skipped/todo=0. 신규 9건은 `test/tui-integration-defects.test.ts`이며 수정 전이라면 모두 실패한다. P23 오라클 2건은 "frozen alias 예외 유지"에서 **"어떤 예외도 없다"**는 더 강한 오라클로 교체했다.
- `node scripts/loc.mjs`: **187 files / 17,920 code LOC**. A-008 review 요구는 유지된다.

미검증 범위는 그대로다. TSP-005–008은 실제 Pi 프로세스 관측이 없어 `unverified`이고, S-02의 `principal.attach`도 미구현이다. 결함 4의 수정은 fail-closed 경로를 단위 검증한 것이지 live Pi에서 확인한 것이 아니다.


### 2026-09-18 — Extension tool 표면 투영 (pi-proxy 설계 재구현)

- 별도 저장소 `pi-proxy-`(pi-tool-surface-proxy)의 설계를 **코드 이식 없이** OMA 계약으로 재구현했다. 이식하지 않은 것은 자식 extension 로더, host facade, registry capture, 자식 handler 직접 실행 경로다. OMA는 이미 operations 계약과 Pi의 `-e`로 extension을 로드하므로 그 계층이 필요 없고, 그대로 가져왔다면 PI-001/TUI-010의 자동 탐색·임의 경로 금지를 위반했을 것이다.
- 원본 1,367 LOC 중 실제로 필요한 것은 **검증·평탄화 + 집합 산술**뿐이었다. 결과는 `src/domain/tool-surface.ts` 1개 파일과 `src/pi-extension.ts`의 추가분이며 증가량은 368 code LOC다.
- 규범: architecture.md **§23.12**, implementation-spec.md **§20 (TSP-001–010)**, test-matrix **T99–T103**. 기준본 hash는 `031e72cd…`로 갱신했다.
- 소유권 분리: cycle/중복/미지 참조/한도 검증은 host 쪽 `src/domain/tool-surface.ts`가 단일 owner이고, sandbox 쪽 `src/pi-extension.ts`는 검증된 plan에 대한 집합 연산만 한다. `pi-extension.ts`가 OMA runtime 모듈을 import하지 않는 기존 불변식을 유지했다.
- Pi 0.85.1이 `getActiveTools`/`getAllTools`/`setActiveTools`를 실제로 노출함을 `node_modules`의 타입 선언에서 확인했다. 활성화 기반 투영은 pinned Pi에서 구현 가능하다.
- 설정은 operations role 파일의 선택적 `toolSurface` 블록이다. CFG-005가 허용하는 role별 metadata 범위이며 `HostConfigV1`·wire·ledger·DB entity를 확장하지 않는다.
- `npm test`: **975/975 PASS**, fail/skipped/todo=0. 신규 13건은 `test/tool-surface.test.ts`다.
- `npm run check:architecture`: PASS, 0 findings. `src/domain/tool-surface.ts`는 kernel zone **K0-values**로 분류했다.
- `node scripts/loc.mjs`: **187 files / 17,763 code LOC**. A-008 review 요구는 계속 유지된다.

미검증 범위: 실제 Pi 프로세스에서 group facade를 호출해 `setActiveTools`가 반영되는 것은 관측하지 않았다. 활성화 산술과 fail-closed 동작은 단위 검증만 했으므로 TSP-005–008의 trace는 `unverified`다.

### 2026-09-18 — 제품 표면(TUI) 구현

- 브랜치/기준 HEAD: `refactor/safety-preserving-architecture` / `ee5d12b`. 이 판정 시점의 규범 추가와 TUI 구현은 그 commit에 들어 있다.
- 새 production source: `src/entry/oma.ts`와 `src/tui/**` 13개 파일. 기존 모듈 변경은 `src/domain/deployment.ts`(tui entry 등록)와 `src/runtime/assets.ts`(동일 entry) 두 곳뿐이다.
- `npm run typecheck`, `npm run build`, `npm run check:package`: PASS. package 산출물에 `tui: dist/src/entry/oma.js`가 포함된다.
- `npm run check:architecture`: PASS, 0 findings. `src/tui/`는 `scripts/dependency-lattice.mjs`의 **L5-entry**로 분류했다. 예외를 추가한 것이 아니라 layer를 선언했으며, 아래 layer는 TUI를 import하지 않는다.
- `npm test`: **962/962 PASS**, fail/cancelled/skipped/todo=0, 실행 시간 172,773 ms. 신규 45건은 `test/tui-model.test.ts`(15), `test/tui-sources.test.ts`(13), `test/tui-app.test.ts`(10), `test/tui-boundary.test.ts`(7)다.
- `node scripts/loc.mjs`: **186 files / 17,395 code LOC**. 직전 16,021에서 1,374 증가했고 전량이 제품 표면이다. A-008 review 요구는 계속 유지된다.
- `node scripts/compliance.mjs --inventory`: 276 clauses. TUI-001–014는 `source-owners.json`에 owner/entrypoint/callPath/negativeTests를 연결했고 상태는 **unverified**다. TUI-015는 build scope라 owner가 없다.

#### 실제 entrypoint 실행 관측

격리 임시 state root에서 `node dist/src/entry/oma.js --society demo --config <path>`를 직접 실행하고 키 입력을 stdin으로 주입해 다음을 관측했다. TTY가 아니므로 raw mode는 적용되지 않았고 80x24 기본값으로 렌더링했다.

- 대화 화면, Dashboard, Config, Mail 목록, Mail 상세, Extensions 다섯 화면이 모두 렌더링되고 `Ctrl+X`/방향키/Enter/Esc 경로가 동작한다. 종료 코드 0.
- Config에서 Principal model을 바꾸자 `config.json`의 `agentProfiles.principal.modelProfile`이 `strong`→`cheap`으로 기록되고 `integration.policyRevision`이 `rev-initial`→`rev-8800fa24…`로 갱신됐다. 화면에는 `Principal model = cheap · 저장됨 · 다음 세션부터`가 표시됐다.
- broker가 없는 환경이라 Dashboard의 Active/Pending/Status는 `unknown (principal 실행 endpoint 없음; <시각> 관측)`으로 표시됐고 0이나 Ready로 바뀌지 않았다.

이 관측은 production entrypoint가 실제로 동작함을 보인 것이지 COMP-004의 `proven`이 아니다. 실제 Pi provider 연결, TTY raw mode, `principal.attach`를 통한 broker 관측은 포함하지 않았다.

#### 구현하지 않은 범위

- `principal.attach` credential handshake는 여전히 미구현이다(IPC-011, S-02). 따라서 TUI는 broker의 `status.get`을 아직 호출할 수 없고 Dashboard의 broker 유래 값은 항상 unknown이다. 이 경로는 `src/tui/transport.ts`에 구현돼 있어 endpoint가 생기면 동작한다.
- session 경계를 넘지 않는 Principal model per-request 전환은 TUI-005가 명시적으로 범위 밖으로 둔다.

### 2026-09-18 — architecture §23 / spec §19 (제품 표면·TUI) 규범 추가

- 브랜치/기준 HEAD: `refactor/safety-preserving-architecture` / `15da3eb`. 당시 working tree의 문서 변경이며 이후 `ee5d12b`에 포함됐다.
- 변경 범위는 **문서 전용**이다. `src/` 및 `test/`의 production/test source는 바꾸지 않았다.
- `npm run typecheck`: PASS. `npm run check:architecture`: PASS, 0 findings(inventory/rule module/gate/transaction 전부).
- `npm test`: **917/917 PASS**, fail/cancelled/skipped/todo=0, 실행 시간 172,378 ms.
- `node scripts/compliance.mjs --inventory`: 276 clauses. 신규 TUI-001–015 및 TEST-008 총 16건이 `unverified`로 등재됐다. 구현 전이므로 owner/callPath/negativeTests는 비어 있는 것이 정상이다.
- `node scripts/loc.mjs`는 이번에 재실행하지 않았다. source 변경이 없으므로 아래 수치를 그대로 인용하며, TUI 구현이 시작되면 재측정한다.
- architecture.md 기준본 hash가 `177e60f7…`에서 `fe70eda0…`로 바뀌었고 N-001에 반영했다. 이전 pin과의 차이는 링크 수정 2줄과 신규 §23이며 둘 다 검토했다.

### 이전 판정 (`fd58193`)

- 브랜치/기준 HEAD: `refactor/safety-preserving-architecture` / `fd58193` (`2026-09-18`).
- 검토 범위: 최근 10개 commit `4259159..fd58193`의 CLI locality 분리, mutation ownership map, modular architecture rules, transport ownership test, current 문서 정리.
- HEAD를 repository 외부의 분리 worktree에 checkout하고 dependency 파일만 복제하여 main tree의 `dist`나 이전 PASS를 재사용하지 않았다.
- `npm run inventory`, `check:inventory`, `typecheck`, `build`, `check:package`, `evidence:graph`, `check:architecture`: PASS. Architecture rule/module 및 기존 gate 모두 0 findings.
- 최초 `npm test`는 CLI header import owner가 `src/cli/effects/mail.ts`로 이동했는데 `test/mail-header-leaf.test.ts`가 이전 `src/cli.ts` import를 고정해 1건 실패했다. 현재 test를 실제 leaf owner에 맞게 수정했다.
- 수정 후 `npm test`: **917/917 PASS**, fail/cancelled/skipped/todo=0, 실행 시간 166,141 ms.
- `node scripts/loc.mjs`: **173 files / 16,021 code LOC**. A-008 architecture review 요구는 유지한다.
- GitHub Actions/CI와 live systemd/kernel/provider/VM lane은 이번 결과에 포함하지 않았다.

현재 source의 기본 local verification은 **PASS**다. 이 판정은 local test/build 정합성만 뜻하며 systemd/kernel/provider/power-loss qualification 또는 release certification이 아니다.

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
