# 안정성 보존형 아키텍처 개선 — 현재 진행

작업 브랜치: `refactor/safety-preserving-architecture`. 이 문서를 쓴 시점의 HEAD는 `851bb7c`이고, 착수 HEAD는 `d13310585c412fef3e32db24ba2b42b7b006b1f5`였다. 원문 제안서는 [제안서](../proposals/2026-09-13-safety-preserving-architecture.md)에 그대로 있다. master에는 자동 병합하지 않는다.

상태 어휘는 [MAINTENANCE.md](../../MAINTENANCE.md) §26을 따른다(NOT_RUN / BLOCKED / UNVERIFIED / PARTIAL / PROVEN). 상세 실행 기록은 [p0-baseline-execution.md](p0-baseline-execution.md), P5는 [p5-dependency-lattice.md](p5-dependency-lattice.md)를 따른다.

| 단계 | 현재 상태 | 근거 / 남은 일 |
| --- | --- | --- |
| P0 gate | **PARTIAL** | pinned TS 5.9.3에서 inventory/check:inventory/typecheck/build/check:package/check:architecture PASS. `npm test`는 131 file 중 일부 실패가 남아 있다(§4.3). LOC gate는 12,170 code lines로 A-008/A-009 review 조건에 걸린다. verify lane과 full LOC/hash 재생성은 부분 실행 |
| P1 operation closure | **PROVEN (source-bound static)** | `OPERATION_CODECS` registry를 신설해 closed kind set과 plan/result/relation validator를 `satisfies Record<MutationMethod, ...>`로 묶었고, decode 경계가 실제로 이 registry를 쓴다. magic count 의존 없음 |
| P1 composition / validation | 구현 반영(이전 단계) | 착수 시점 source에 이미 존재. 이번 실행에서 해당 focused 검증은 재실행하지 않았다 |
| P2 contract owner 분리 | **구현 반영, 재검증 PARTIAL** | `implementation/contracts.ts`는 facade로 남고 production의 facade import는 49건이며 **전부 type-only**다(runtime 0). P5 evidence에 고정 |
| P2.5 opaque identity | 구현 반영 | validated ledger output에 brand 유지. 착수 시점에 pinned toolchain typecheck 오류 1건이 있었고 수정했다 |
| P3 OperationJournal | 구현 반영 | Journal은 기존 SQLite owner의 mechanism을 조합하고 terminal immutability는 기존 owner에 남는다. 이번 실행에서 focused 재실행은 하지 않았다 |
| P4 logical Store facets | 구현 반영 | SQLite writer는 여전히 `src/store.ts` 하나다. facets와 Store의 type 참조는 한 layer 안의 cycle로 측정·문서화 |
| P5 dependency lattice | **PROVEN (measured + enforced)** | 137 files, runtime 547, type-only 147, runtime SCC 0. `dependency-lattice`/`-unclassified`/`type-import-cycle`/`dependency-evidence-stale` gate와 negative fixture 6건, evidence generator 연결 |
| P6 independent integrity | **구현 존재, 재검증 PARTIAL** | HEAD에 `src/diagnostics/*`와 `scripts/check-state.mjs`가 있다. 이번 세션에서 실제 state root에 대한 offline/live 실행 증거는 새로 만들지 않았다 |
| P7 durable-FS fault seam | **NOT_RUN** | deterministic seam과 fault matrix 미구현 |
| P8 persisted format evolution | **NOT_RUN** | format inventory/migration policy 미구현. v1 silent rewrite는 여전히 금지 |
| P9 VM power-cut / fuzz | **NOT_RUN** | power-cut lane, persisted-state fuzz corpus 미구현 |

## 1. 이번 실행에서 실제로 고친 것

### 1.1 production 결함

- **folded header read failure**: `buildEml`이 64-hex context/approval 값을 RFC 5322 folding으로 내보내는데 parser가 unfold하지 않아, sha256 repository에서 OMA가 자기 accepted mail을 다시 읽지 못했다(materialize/reconcile가 STORE_CORRUPT). `parseEmlHeaders`가 검증 전에 unfold하도록 수정하고 `test/mail-header-leaf.test.ts`에 round-trip oracle을 추가했다.
- **process owner 위반 3건**: `src/git/canonical-command.ts`, `src/git/context-mirror.ts`, `src/broker/logs.ts`가 `node:child_process`를 직접 import했다. owner list 확장이 아니라 `src/process/run.ts`/`src/process/policies.ts` 경유로 이전했다. argv, env, timeout, native combined output cap은 그대로다.
- **operation registry 부재**: checker가 요구하던 `OPERATION_CODECS`가 production에 존재한 적이 없었다. 기존 validator를 binding하는 pure metadata registry를 만들고 decode 경계에 연결했다. 새 validation, 새 effect, 새 recovery 결정은 없다.

### 1.2 tooling 결함

- Tarjan SCC 구현이 `Set`을 index로 접근해 **cycle을 찾지 못하는 false PASS**를 냈다. 수정 후 재측정했고, 그 결과 storage/Store type cycle 1건이 드러나 lattice 정책으로 문서화했다.

### 1.3 fixture 정렬

stale fixture 원인별 조치는 [p0-baseline-execution.md](p0-baseline-execution.md) §4.1에 정리했다. production validator를 완화한 사례는 없다.

## 2. 남은 것 (다음 작업자가 먼저 볼 것)

1. `npm test` 잔여 실패: `crash-boundaries`, `phase3`, `phase4`, `phase7`, `request-identity-kernel`, `runner-channel`, `r10-ledger-rows`, `r36-resource-stress`, `p0-hardening`, `context-manifest-boundary`, `context-security`, `git-format`, `cli`, `host-entry`, `audit`, `audit2`, `contract-import-migrations`. `phase5`는 per-file timeout으로 BLOCKED.
2. `npm run verify:fast|durable|property|kernel|crash|stress|all` lane 미실행.
3. LOC gate: 12,170 code lines. A-009에 따라 10,001 이상은 architecture review 전 release 불가다. 목표(8,000) 초과 사유/모듈별 수치를 남기는 작업이 필요하다.
4. P7/P8/P9 미착수.
5. P2/P3/P4/P6의 focused 재실행(이번 세션은 P0 gate와 P5에 집중했다).
