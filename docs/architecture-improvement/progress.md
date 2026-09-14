# 아키텍처 개선 — 단계별 진행 색인

구현 기준: `930053c` (2026-09-14), 브랜치 `refactor/safety-preserving-architecture`.
현재 실행 결과와 release 미검증 범위는 [implementation/validation.md](../../implementation/validation.md), 다음 작업은 [HANDOFF.md](../../HANDOFF.md)를 따른다.
이 문서는 단계와 보고서를 연결하며 과거 실행 개수·LOC를 현재 결과로 복사하지 않는다.

## 구현 상태

| 단계 | 반영한 범위 | 상세 기록 |
|---|---|---|
| P0 | pinned compilation/build/package/architecture 및 전체 suite 실행 완료. release gate와 별개 | [최신 검증 상태](../../implementation/validation.md) · [초기 baseline 이력](p0-baseline-execution.md) |
| P1 | operation closed-world registry, composition 순서, shared validation/live recheck | [composition](p1-composition.md) · [validation](p1-validation.md) |
| P2 / P2.5 | physical contract owners, compatibility facade, owner별 import, validated identity | [module ports](p2-module-ports.md) · [identity](p25-identities.md) |
| P3 | OperationJournal과 explicit recovery closure, 기존 ledger mechanism 재사용 | [journal](p3-journal.md) · [Store integration](p3-store-integration.md) · [recovery](p3-recovery.md) |
| P4 | logical read/write facets, single physical writer 유지 | [facets](p4-facets.md) |
| P5 | 측정된 coarse dependency lattice와 enforcement | [P5 당시 기록](p5-dependency-lattice.md) · [현재 graph](evidence/p5-dependency-graph.json) |
| P6 | independent read-only ledger/physical integrity 및 offline 검증 | [ledger](p6-ledger.md) · [physical](p6-physical.md) · [당시 검증](p6-verification.md) |
| P7 | low-level durability fault seam과 process-crash matrix | [fault 기록](p7-durability-faults.md) |
| P8 | persisted format/version boundary와 read-only portability 정책 | [format 기록](p8-persisted-formats.md) |
| P9 | persisted-state fuzz 및 guarded VM power-cut lane. 실제 VM power loss는 미검증 | [power-cut/fuzz 기록](p9-powercut-fuzz.md) |
| P10 | production Program source universe와 evidence/checker 일치 | [P10–P15 보고서](p10-p15-adversarial-review.md) |
| P11 / P12 | exhaustive typed dispatch와 narrow consumer capability | [P10–P15 보고서](p10-p15-adversarial-review.md) |
| P13 / P14 | kernel semantic zones와 declaration/conformance 분리 | [P10–P15 보고서](p10-p15-adversarial-review.md) |
| P15 | 독립 SCC oracle, 실제 production mutation, alias/evidence 우회 회귀 | [P10–P15 보고서](p10-p15-adversarial-review.md) |

구현 반영과 실제 host/kernel/provider 인증은 구분한다. P5/P7 구현이나 P10–P15 정제를 미완료로 기록한 이전 일지는 당시 snapshot이다.

## 원안과 이력

- [P0–P9 원 제안서](../proposals/2026-09-13-safety-preserving-architecture.md)
- [P10–P15 정제 제안서](../proposals/p10-p15-dependency-capability-refinement.md) — 기존 `temp.md` 원문 보존
- [P0–P9 변경 기록](change-record.md)
- [문서 정리 전 progress snapshot](https://github.com/minjung2035/oma-v2/blob/930053c307785106b0a881975cad596c943e8ac1/docs/architecture-improvement/progress.md)
- [전체 문서·세부 이력 색인](../README.md)

Runtime package closure와 architecture Program graph는 서로 다른 집합이다. 최신 graph 수치는 generator의 JSON을 기준으로 하며,
과거 보고서의 root-file/edge 수와 단순 비교해 새 runtime subsystem이나 복잡도 감소로 해석하지 않는다.
