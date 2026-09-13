# P5 — 측정된 dependency lattice

이 문서는 제안서 §10(P5)의 결과이자 현재 enforcement의 설명이다. 제안서에 적힌 개념 layer(L0–L5)를 코드에 강제한 것이 아니라, **현재 HEAD의 실제 import graph를 수집한 뒤 그 graph가 허용하는 최소 coarse DAG를 고정**했다. 측정 도구와 checker는 같은 extractor를 공유하므로 문서·evidence·enforcement가 따로 drift할 수 없다.

## 1. 측정 방법

```sh
node scripts/dependency-graph.mjs --summary          # 요약(사이클, fan-in/out, 외부 module)
node scripts/dependency-graph.mjs --edges            # edge 전체
node scripts/dependency-graph.mjs --write-evidence   # checked-in evidence 재생성
npm run check:architecture                           # evidence freshness + lattice enforcement
```

- 대상: `tsconfig.json`의 file set 중 `src/**`, `implementation/**` (test source 제외).
- edge 종류: `runtime`(값 import/export, dynamic import, `import x = require()`)와 `type`(`import type`, 전체가 type-only인 named import). mixed `import { type X, Y }`는 runtime edge다. mixed 절이 하나라도 값을 포함하면 runtime으로 계산한다.
- 외부 package(`node:*`, `koffi`, `nodemailer`, Pi SDK)는 internal edge가 아니므로 별도 집계한다.
- cycle은 Tarjan SCC로 계산한다. runtime graph와 runtime+type union graph를 따로 본다.

### 측정 결과 (evidence: `docs/architecture-improvement/evidence/p5-dependency-graph.json`)

| 항목 | 값 |
|---|---|
| production files | 137 |
| runtime edge | 547 |
| type-only edge | 147 |
| runtime SCC (길이 > 1) | 0 |
| runtime+type SCC (길이 > 1) | 1 (L1 내부, 아래 §4) |
| 최대 fan-in | `src/domain/errors.ts` 85, `src/ids.ts` 27, `src/domain/identifiers.ts` 21 |
| 최대 fan-out | `src/mail.ts` 26, `src/broker.ts` 24, `src/entry/broker.ts` 17 |

runtime edge 행렬은 완전한 하삼각이다. 어떤 runtime edge도 아래 layer에서 위 layer로 향하지 않는다.

## 2. 확정한 lattice

| layer | 성격 | files |
|---|---|---|
| L0 `L0-contracts` | `implementation/**` 선언/호환 surface | 1 |
| L1 `L1-kernel` | `src/domain/**`, 순수 codec(`ids`, `hash`, `validate`, `frame`), `src/process/**`, `src/protocol/**`, `src/storage/**`, `src/durable.ts`, `src/config*`, 단일 SQLite owner `src/store.ts`, mail 순수 value codec 3개 | 67 |
| L2 `L2-facts` | 관측/fact: `src/units*`, `src/diagnostics/**`, `src/authority.ts`, `src/request-cache.ts` | 10 |
| L3 `L3-workflow` | `src/mail*`, `src/git*`, `src/lifecycle*`, `src/inference*`, `src/views*`, `src/reconcile/**` | 34 |
| L4 `L4-orchestration` | `src/broker*`, `src/runtime/**`, `src/reconcile.ts`, `src/runner.ts`, `src/sandbox.ts` | 16 |
| L5 `L5-entry` | `src/entry/**`, `src/cli*`, `src/pi-extension.ts`, `src/rpc-client.ts` | 9 |

L1에 대한 판단 근거:

- `src/store.ts`는 제안서 최종 구조에서 SQLite owner로 kernel에 속한다(`OperationJournal → SQLite`). P4의 logical facet은 같은 layer 안에서 Store type을 참조하므로 layer 경계를 넘지 않는다.
- `src/mail/{addresses,facts,headers}.ts`는 `src/domain/**`만 import하는 순수 value codec이며, P6 integrity observer가 공유한다. workflow module이 아니다.
- `src/cli/cache-codec.ts`는 codec이고 `src/request-cache.ts`가 이를 소비한다.

## 3. Enforcement

`src/**`·`implementation/**`의 모든 production file은 정확히 한 layer prefix에 match해야 한다. match하지 않는 file은 `dependency-lattice-unclassified`로 실패한다(새 directory가 조용히 lattice를 빠져나갈 수 없다).

| rule | 조건 | 현재 상태 |
|---|---|---|
| `dependency-lattice` | runtime edge가 자기 layer 또는 더 fundamental layer로만 향한다 | 0 findings |
| `dependency-lattice-unclassified` | 모든 production file이 layer에 속한다 | 0 findings |
| `type-import-cycle` | runtime+type SCC가 **두 layer 이상**을 가로지르지 않는다 | 0 findings |
| `runtime-import-cycle` (기존) | runtime graph에 SCC가 없다 | 0 findings |
| `dependency-evidence-stale` | checked-in evidence가 현재 graph와 같다 | PASS |

type-only edge는 runtime coupling을 만들지 않으므로 상방 참조 자체는 실패가 아니다. 대신 ① cycle이 되면 실패하고, ② 상방 type edge는 evidence에 그대로 기록된다(현재 6건: `src/module-ports.ts` → composition 대상, `src/storage/{facets,transaction}.ts` → `src/store.ts`, `src/diagnostics/integrity.ts` → `src/git/observe.ts`).

Evidence는 `npm run evidence:graph`로만 재생성한다. 손으로 편집하지 않으며, source/edge가 바뀌면 gate가 `dependency-evidence-stale`로 실패한다.

## 4. layer 안의 cycle 1건 (의도)

runtime+type union graph의 유일한 SCC는 다음이다.

```text
src/storage/facets.ts → src/storage/operation-journal.ts → src/storage/operation-transitions.ts
→ src/storage/transaction.ts → src/store.ts → (facets)
```

runtime 방향은 `src/store.ts → src/storage/**` 한 방향뿐이다. 반대 방향은 `Pick<Store, …>`·`keyof Store` 같은 type-level 참조이며, P4가 의도한 “하나의 SQLite mechanism + 그 logical facet” 관계다. facet table을 Store method에서 파생시키는 대신 별도 목록으로 복제하면 MAINTENANCE §4의 single-owner 규칙을 깨므로, 이 참조는 유지하고 **layer를 가로지르는 cycle만** 실패로 정의했다.

## 5. Negative/positive fixture

`test/dependency-lattice.test.mjs`가 실제 checker(`analyzeProgram`)를 실행해 다음을 고정한다.

- L1 → L4 runtime edge는 `dependency-lattice`로 실패하고, L4 → L1은 통과한다.
- layer 밖 file은 `dependency-lattice-unclassified`로 실패한다.
- 두 layer를 가로지르는 type-only cycle은 `type-import-cycle`로 실패한다.
- 한 layer 안의 type-only cycle은 통과한다(§4).
- 현재 production graph는 lattice rule에 대해 0 findings다.

## 6. P5 기간에 함께 고친 것

- **SCC 계산 bug**: 최초 측정 도구의 Tarjan 구현이 `Set`을 index로 접근해 cycle을 전혀 찾지 못했다(거짓 PASS). `scripts/dependency-graph.mjs`의 구현을 수정한 뒤 재측정했고, 그 결과가 위 수치다.
- **직접 facade import 정책**: `implementation/contracts.ts`를 직접 import하는 production edge는 49건이며 **전부 type-only**다(runtime 0). facade는 호환/spec surface로 유지하고, runtime 결합을 금지하는 현재 상태를 evidence로 고정한다.
- **P0 repair**: `subprocess-owner` 위반 3건(`src/git/canonical-command.ts`, `src/git/context-mirror.ts`, `src/broker/logs.ts`)은 owner list를 늘리는 대신 `src/process/run.ts`·`src/process/policies.ts` 경유로 옮겼다. exact-edge 예외를 추가하지 않았다.
- **identifier mirror**: `src/pi-extension.ts`는 PI-002에 따라 host runtime을 import할 수 없는 단일 compiled file이므로 identity grammar를 mirror한다. policy에 file-exact 항목(`identifierMirrors`)과 이유를 명시했고, 두 decoder의 동등성은 `test/id-contracts.test.ts`가 pin한다.

변경하지 않은 것: wire method, DB schema, persisted v1 plan/result bytes, OPEN gate, physical effect ordering.
