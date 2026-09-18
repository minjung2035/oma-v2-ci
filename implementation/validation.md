# OMA v2 — 현재 검증 상태

이 파일이 current verification status와 검증 명령의 단일 owner다. README/HANDOFF에는 test count, LOC, PASS 표를 중복 기록하지 않는다.

## 현재 source 판정

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

`node scripts/loc.mjs`의 현재 source-bound 결과는 **187 files / 17,763 code LOC**이며 A-008의 10,000행 기준을 넘는다. 따라서 **architecture review가 필수이고 release는 차단 상태**다. 이 판정은 기록만 하고 기능 작업을 중단하지 않기로 했으며, review 자체는 별도 작업으로 분리한다.

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
