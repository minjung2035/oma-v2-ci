# P0 — pinned environment baseline execution log

이 문서는 `refactor/safety-preserving-architecture` 브랜치에서 실제로 실행한 검증 기록이다. 상태 어휘는 [MAINTENANCE.md](../../MAINTENANCE.md) §26을 따른다(NOT_RUN / BLOCKED / UNVERIFIED / PARTIAL / PROVEN). 실행하지 않은 것을 PASS로 쓰지 않는다.

## 1. 환경과 현재 기준

| 항목 | 값 |
|---|---|
| source | `refactor/safety-preserving-architecture` |
| 착수 HEAD | `d13310585c412fef3e32db24ba2b42b7b006b1f5` |
| Node | v26.7.0 |
| TypeScript | 5.9.3 (repo pin, `npm ci`로 설치) |
| kernel/systemd | Linux, `systemctl --user is-system-running` = running |
| native 도구 | bwrap, pi, git, cloc, systemd-run 모두 존재 |
| dependency 설치 | `NODE_ENV=production` 때문에 최초 `npm ci`가 devDependency를 건너뛰었다. `npm ci --include=dev`로 pin된 toolchain을 확보했다. |

착수 시점 HEAD는 **green이 아니었다**. 아래는 현재 source에서 실제로 관측한 gate 결과다.

## 2. Gate 결과 (pinned toolchain)

| gate | 착수 시점 HEAD | 현재 | 비고 |
|---|---|---|---|
| `npm run inventory` | 실행 | PASS | `SOURCE_LIST_GENERATED`, files=145 |
| `npm run check:inventory` | 실행 | PASS | `SOURCE_LIST_CURRENT` |
| `npm run typecheck` | **FAIL 4건** | **PASS** | repo pin 5.9.3에서 최초 실행. `src/protocol/run-lease.ts` brand cast 1건 + stale test fixture 3건 |
| `npm run build` | PASS | PASS | `check-package` 포함 |
| `npm run check:package` | PASS | PASS | |
| `npm run check:architecture` | **FAIL 5건** | **PASS 0건** | 아래 §3 |
| `npm test` | **FAIL** | **PARTIAL** | 아래 §4 |
| `npm run verify:*` lane | NOT_RUN | NOT_RUN | §5 |

`npm run check:architecture`의 5건은 master에서도 존재하던 latent 실패였다(master에서 103건). 상세는 §3.

## 3. architecture gate에서 실제로 고친 결함

| # | finding | 원인 | 조치 |
|---|---|---|---|
| 1 | `subprocess-owner` × 3 (`src/git/canonical-command.ts`, `src/git/context-mirror.ts`, `src/broker/logs.ts`) | R31에서 adapter로 옮긴 native 실행이 process owner를 우회했다. `test/r34-owner-policy.test.mjs`도 함께 실패 중이었다. | owner list를 늘리는 대신 `src/process/run.ts`의 `runProcessSync`와 `src/process/policies.ts`의 `runJournal` 경유로 이전. bound(`maxBuffer`/timeout/killSignal)와 명령 argv는 그대로 유지 |
| 2 | `duplicate-id-schema` (`src/pi-extension.ts`) | compiled 단일 extension은 host runtime을 import할 수 없어 identity grammar를 mirror한다. rule에는 이 예외를 표현할 방법이 없었다. | policy에 file-exact `identifierMirrors` 항목과 이유를 명시. wildcard 금지, 동등성은 `test/id-contracts.test.ts`가 pin |
| 3 | `operation-exhaustiveness` | checker가 `OPERATION_CODECS` registry를 요구하지만 **production에 존재한 적이 없었다**(test fixture에만 존재). P1의 완료 조건이 미충족 상태였다. | `src/storage/operation-codec.ts`에 pure metadata registry를 추가하고 decode 경계가 실제로 사용하도록 연결. `satisfies Record<MutationMethod, OperationCodec>`로 exhaustiveness를 compile-time에 고정 |

추가로 tooling 결함 1건을 고쳤다: `scripts/dependency-graph.mjs`의 Tarjan SCC 구현이 `Set`을 index로 접근해 **cycle을 전혀 찾지 못하는 false PASS**를 냈다. 수정 후 재측정했다(P5 문서 §6).

## 4. `npm test` 현재 상태 — PARTIAL

전체 suite는 131개 file이다. 한 파일이 native/sandbox 조건에서 오래 걸리거나 멈출 수 있어, per-file timeout을 걸고 파일별로 실행했다(`npm test`와 같은 command shape). 아래는 최근 전수 실행과 그 뒤 개별 재실행의 결과다.

- 이전 전수 실행: **97 PASS / 34 FAIL**
- stale fixture 수정 후 개별 재실행으로 PASS로 전환: `adversarial-audit`, `adversarial-contract-fixes`, `architecture-contracts`, `authority`, `context-acceptance-integrity`, `global-invariants`, `integrity-files`, `integrity-publications`, `r21-context-workflow`, `r37-preparation-boundaries`, `refactoring-cli-regressions`, `refactoring-git-regressions`, `result-relation-integrity`, `runtime-contracts`, `mail-integrity`, `mail-recovery-integrity`, `phase8`

실패 원인은 세 종류이며, 원인별로 다르게 처리했다.

### 4.1 production invariant를 약화시키지 않고 고친 것 (fixture가 현재 contract와 불일치)

착수 시점 대비 suite에서 확인된 **stale fixture** 원인들이다. 모두 "validator를 완화하지 않고 fixture를 현재 contract에 맞춘다"(MAINTENANCE §25) 원칙으로 처리했다.

- agent row가 `specHash`를 손으로 쓴 값으로 들고 있었다(`"h"`, `"fixture"`, `name` 등). 현재 decoder는 frozen spec digest를 검증한다 → `test/fixtures/spec.ts`의 `storedSpec()`을 도입해 spec과 hash를 함께 만든다.
- `MailModule`/`BatchCoordinator`가 batch view limits 없이 구성되어 `encodeBatchView`가 `UNSUPPORTED_PROFILE`로 실패했다 → `test/fixtures/limits.ts`의 `TEST_VIEW_LIMITS`를 사용.
- EML header fixture가 foreign RFC Message-ID(`external@example.invalid`)를 기대했다. 현재 parser는 OMA header identity만 받는다 → OMA identity로 바꾸고 foreign 거절을 **추가** 단언.
- `libdir: "/usr/lib/oma"`가 실제 module layout과 달라 broker entry가 `UNSUPPORTED_PROFILE`로 거부했다 → layout-consistent `process.cwd()`.
- `actor "a".repeat(31) + MAX_SAFE_INTEGER`가 `sun_path`를 넘지 않아 throw가 없었다 → run root 길이를 45 byte로 만들어 경계를 실제로 통과하도록 수정(짧은 incarnation은 99, 최대 incarnation은 114).
- systemd unit template 기대값(`Restart=no`, `ProtectSystem=strict`, `PrivateNetwork=yes`)이 UNIT-003과 불일치 → 규범값(`Restart=on-failure` 등)으로 교체하고, sandbox 격리는 systemd property가 아니라 SB-001/002 소유임을 주석으로 고정.
- `capabilitiesOf(corrupt)`가 "빈 권한 집합"을 반환한다는 기대 → 현재는 fail-closed로 던진다(§10: corruption ≠ empty permission). oracle을 throw로 변경.
- lineage quota를 `lifecycle.enforceCreateQuota`라는 사라진 private method로 호출 → 순수 owner `assertCreateCapacity(LineageSnapshot, ...)`로 교체.
- `runner`/`units` fault seam이 `run`을 대체했지만 observation 경로는 `command`를 쓴다 → `command` 경계를 제어하도록 수정.
- read-only(0555/0444) publication tree를 `rmSync` 하다 EACCES → `test/fixtures/cleanup.ts`의 `removeTree`/`overwritePublished` 도입.
- 채워지지 않은 `requestHash: "hash"`/`payloadJson: "{}"` 행 → 실제 `requestHash(kind, payload)`와 contract-valid payload/plan으로 교체.
- accepted plan을 Store API로 덮어쓰는 fault 주입 → 이미 immutability가 강화되어 거부된다. raw corruption fixture(`corruptOperationForTest`)로 우회.

### 4.2 P0 기간에 발견한 **실제 production bug** (수정 완료)

| bug | 영향 | 조치 |
|---|---|---|
| RFC 5322 folded header를 parser가 unfold하지 않음 | 64-hex context OID(sha256 repo)를 가진 mail은 `buildEml`이 header를 folding하므로 **OMA가 자기 accepted mail을 다시 읽지 못했다**. context notification materialize/reconcile가 `STORE_CORRUPT`로 실패하고 crash-lane T57/T66/T39 시나리오가 진행 불가 | `parseEmlHeaders`의 `X-OMA-Context`·approval metadata 검증 전에 unfold 적용. `test/mail-header-leaf.test.ts`에 round-trip 회귀 oracle 추가 |
| (tooling) SCC false PASS | P5 측정이 cycle 0으로 잘못 보고 | Tarjan 구현 수정 후 재측정 |

### 4.3 아직 남은 실패 (미완료로 기록)

- `crash-boundaries`, `phase3`, `phase7`, `phase4`, `audit`, `audit2`, `host-entry`, `runner-channel`, `r10-ledger-rows`, `r36-resource-stress`, `request-identity-kernel`, `p0-hardening`, `context-manifest-boundary`, `context-security`, `git-format`, `cli`, `contract-import-migrations`
- `phase5`(sandbox Pi)는 per-file timeout(240–420s) 안에 끝나지 않아 **BLOCKED/시간 초과**로 기록했다. SIGKILL하지 않고 PASS로 계산하지 않는다.

이 항목들은 원인 분류가 끝나지 않았거나 systemd unit 설치·bwrap rootfs·Pi provider 같은 환경 요소가 섞여 있다. **PASS로 포장하지 않는다.**

## 5. 실행하지 않은 것

- `npm run verify:fast|durable|property|kernel|crash|stress|all` lane: NOT_RUN. (개별 test file 실행은 했지만 lane runner의 evidence/skip 정책 평가는 실행하지 않았다.)
- `node scripts/loc.mjs`(cloc 2.08 pinned full LOC): NOT_RUN. `cloc` 2.08은 설치되어 있으나 production-files/LOC/hash generator 전체 실행과 hash 재생성은 아직 실행하지 않았다.
- VM power-cut, ENOSPC, read-only remount, backup/restore: NOT_RUN (환경 없음).
