# 안정성 보존형 아키텍처 개선 — 현재 진행

작업 브랜치: `refactor/safety-preserving-architecture`. 이 문서를 쓴 시점의 HEAD는 `f00c428`이고, 착수 HEAD는 `d13310585c412fef3e32db24ba2b42b7b006b1f5`였다. 원문 제안서는 [제안서](../proposals/2026-09-13-safety-preserving-architecture.md)에 그대로 있다. master에는 자동 병합하지 않는다.

상태 어휘는 [MAINTENANCE.md](../../MAINTENANCE.md) §26을 따른다(NOT_RUN / BLOCKED / UNVERIFIED / PARTIAL / PROVEN). 상세 기록: [P0](p0-baseline-execution.md) · [P5](p5-dependency-lattice.md) · [P6](p6-verification.md) · [P7](p7-durability-faults.md) · [P8](p8-persisted-formats.md) · [P9](p9-powercut-fuzz.md).

| 단계 | 현재 상태 | 근거 / 남은 일 |
| --- | --- | --- |
| P0 gate | **PASS (suite 135/135) / release gate FAIL** | pinned TS 5.9.3에서 inventory/check:inventory/typecheck/build/check:package/check:architecture PASS. `npm test`는 135 file 전부 PASS(주요: phase3 11, phase4 18, phase5 13, phase7 11, phase8 3, crash-boundaries 46, audit 13). LOC는 12,351 code lines로 A-008/A-009 review 조건에 걸린다. `verify:*` lane은 NOT_RUN |
| P1 operation closure | **PROVEN (source-bound static)** | `OPERATION_CODECS` registry를 신설해 closed kind set과 plan/result/relation validator를 `satisfies Record<MutationMethod, ...>`로 묶었고, decode 경계가 실제로 이 registry를 쓴다. magic count 의존 없음 |
| P1 composition / validation | 구현 반영(이전 단계) | 착수 시점 source에 이미 존재. 이번 실행에서 해당 focused 검증은 재실행하지 않았다 |
| P2 contract owner 분리 | **구현 반영, 재검증 PARTIAL** | `implementation/contracts.ts`는 facade로 남고 production의 facade import는 49건이며 **전부 type-only**다(runtime 0). P5 evidence에 고정 |
| P2.5 opaque identity | 구현 반영 | validated ledger output에 brand 유지. 착수 시점에 pinned toolchain typecheck 오류 1건이 있었고 수정했다 |
| P3 OperationJournal | 구현 반영 | Journal은 기존 SQLite owner의 mechanism을 조합하고 terminal immutability는 기존 owner에 남는다. 이번 실행에서 focused 재실행은 하지 않았다 |
| P4 logical Store facets | 구현 반영 | SQLite writer는 여전히 `src/store.ts` 하나다. facets와 Store의 type 참조는 한 layer 안의 cycle로 측정·문서화 |
| P5 dependency lattice | **PROVEN (measured + enforced)** | 137 files, runtime 547, type-only 147, runtime SCC 0. `dependency-lattice`/`-unclassified`/`type-import-cycle`/`dependency-evidence-stale` gate와 negative fixture 6건, evidence generator 연결 |
| P6 independent integrity | **PROVEN (offline)** | 실제 state root에서 clean PASS / corrupt FAIL(`MAIL_OBJECT_INVALID`·`MAIL_ARCHIVE_INVALID`·`INBOX_NEW_INVALID`), 관측 전후 파일·durable row 불변(repair 없음). focused: integrity-ledger 10, integrity-files 11, integrity-publications 3, diagnostic-admin 7 PASS. live systemd/cgroup 관측은 NOT_RUN |
| P7 durable-FS fault seam | **PROVEN (process crash model)** | `durable-fs`/`immutable-file`/`context-stream`/`batch-view`에 deterministic fault point(before/after-visible/ambiguous). fault는 crash simulation이라 cleanup을 실행하지 않는다. fault matrix **9 PASS** |
| P8 persisted format evolution | **PROVEN (version boundary)** | field inventory/분류표, explicit `user_version` fail-closed, unknown plan format 분류, host-derived locator 3종과 read-only portability report. **5 PASS**. v2 writer는 만들지 않았고 v1 bytes는 rewrite하지 않는다 |
| P9 VM power-cut / fuzz | **fuzz PROVEN / power-cut BLOCKED** | persisted-state fuzz 6 target **7 PASS**(seed/corpus 체크인). power-cut lane은 guard 포함 구현 + guard test **4 PASS**, 실제 VM 실행은 NOT_RUN(이 환경은 disposable VM 아님) |

## 1. 이번 실행에서 실제로 고친 것

### 1.1 production 결함

- **folded header read failure**: `buildEml`이 64-hex context/approval 값을 RFC 5322 folding으로 내보내는데 parser가 unfold하지 않아, sha256 repository에서 OMA가 자기 accepted mail을 다시 읽지 못했다(materialize/reconcile가 STORE_CORRUPT). `parseEmlHeaders`가 검증 전에 unfold하도록 수정하고 `test/mail-header-leaf.test.ts`에 round-trip oracle을 추가했다.
- **process owner 위반 3건**: `src/git/canonical-command.ts`, `src/git/context-mirror.ts`, `src/broker/logs.ts`가 `node:child_process`를 직접 import했다. owner list 확장이 아니라 `src/process/run.ts`/`src/process/policies.ts` 경유로 이전했다. argv, env, timeout, native combined output cap은 그대로다.
- **operation registry 부재**: checker가 요구하던 `OPERATION_CODECS`가 production에 존재한 적이 없었다. 기존 validator를 binding하는 pure metadata registry를 만들고 decode 경계에 연결했다. 새 validation, 새 effect, 새 recovery 결정은 없다.

### 1.2 tooling 결함

- Tarjan SCC 구현이 `Set`을 index로 접근해 **cycle을 찾지 못하는 false PASS**를 냈다. 수정 후 재측정했고, 그 결과 storage/Store type cycle 1건이 드러나 lattice 정책으로 문서화했다.

### 1.3 fixture 정렬

stale fixture 원인별 조치는 [p0-baseline-execution.md](p0-baseline-execution.md) §4.1에 정리했다. production validator를 완화한 사례는 없다.

## 1.4 P6~P9에서 추가한 production surface

- `src/storage/durable-fs.ts`, `src/storage/immutable-file.ts`, `src/storage/context-stream.ts`, `src/storage/batch-view.ts`: test-only `DurabilityObserver` seam(production은 인자 없음).
- `src/domain/persisted-formats.ts`: persisted field 분류표, version/portability 정책. `src/store.ts`가 이 상수를 사용한다.
- `scripts/dependency-graph.mjs`, `scripts/dependency-lattice.mjs`: 측정·enforcement 공용 extractor.
- `scripts/powercut-lane.mjs`: guarded power-cut lane(`verify:powercut`).

## 2. 남은 것 (다음 작업자가 먼저 볼 것)

1. `phase5`의 sandboxed-Pi smoke 한 건만 남는다: harness 밖에서 동일 profile이 custom message를 전달함을 확인했지만 harness 안에서는 child 출력이 없다. [p0-baseline-execution.md](p0-baseline-execution.md) §4.3.
2. LOC gate: 12,351 code lines. A-009에 따라 10,001 이상은 architecture review 전 release 불가다. 모듈별 수치와 초과 사유 정리가 필요하다.
3. `npm run verify:fast|durable|property|kernel|crash|stress|all` lane 미실행. VM power-cut, ENOSPC, backup/restore 미실행.
4. P1/P2/P3/P4의 focused 재실행(이번 세션은 gate·P5~P9와 suite 정렬에 집중했다).
