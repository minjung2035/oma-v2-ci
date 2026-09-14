# 문서 전체 색인

현재 상태·규범·제안·과거 실행 기록을 구분한다. 기록 속 “현재”, PASS 수, LOC와 source SHA는 **그 문서의 작성/실행 시점**을 뜻하며 최신 결과를 대신하지 않는다.

## 현재 읽을 문서

| 문서 | 역할 |
|---|---|
| [프로젝트 README](../README.md) | 저장소 진입점 |
| [HANDOFF](../HANDOFF.md) | 현재 재개점과 다음 작업 |
| [현재 검증 상태](../implementation/validation.md) | 마지막 실제 실행, source pin, 미검증 환경·release 게이트 |
| [검증 명령 색인](../validation.md) | 명령과 lane 안내; 결과 중복 관리 안 함 |
| [MAINTENANCE](../MAINTENANCE.md) | 장기 수정·리뷰·문서 관리 원칙 |
| [단계별 진행 색인](architecture-improvement/progress.md) | P0–P23 구현 범위와 보고서 탐색 |
| [implementation 지도](../implementation/README.md) | 규범·현재 metadata·historical 자료 구분 |

## 규범과 제안

최상위 계약은 [architecture.md](../architecture.md)와 [implementation-spec.md](../implementation-spec.md)다.
[Physical ordering](../implementation/physical-ordering.md), [compliance](../implementation/compliance.md),
[OPEN SPIKE](../implementation/spikes.md), [integration policy](../implementation/integration-policy.md),
[test matrix](../implementation/test-matrix.md), [LOC/build budget](../implementation/loc-budget.md),
[contract owner 안내](../implementation/contracts/README.md), [systemd templates](../implementation/systemd/README.md)는 구현 계약과 함께 읽는다.

아래 제안서는 검토 당시 원문이며 상위 계약을 대체하지 않는다.

- [P0–P9 안정성 보존형 아키텍처 제안](proposals/2026-09-13-safety-preserving-architecture.md)
- [P10–P15 dependency/capability 정제 제안](proposals/p10-p15-dependency-capability-refinement.md) — 기존 `temp.md`를 내용 변경 없이 이동

## 아키텍처 변경·실행 이력

**아래 보고서는 해당 단계의 source-bound 기록이다. 현재 재개 지시서가 아니다.**
현재 검증 판정은 위 단일 기록 위치를 사용하고, 과거 실패/미착수를 현재 TODO로 그대로 옮기지 않는다.

| 단계 | 기록 |
|---|---|
| 초기 결정·baseline | [baseline](architecture-improvement/baseline.md) · [P0/P1 결정](architecture-improvement/decisions-p0-p1-1.md) · [P0 pinned 실행](architecture-improvement/p0-baseline-execution.md) |
| P0 회귀 | [hash overload](architecture-improvement/p0-hash-overload.md) · [stdin encoding](architecture-improvement/p0-stdin-encoding.md) |
| P1 | [당시 진행표](architecture-improvement/p1-progress-history.md) · [composition](architecture-improvement/p1-composition.md) · [validation](architecture-improvement/p1-validation.md) |
| P2 이관 | [module ports](architecture-improvement/p2-module-ports.md) · [protocol](architecture-improvement/p2-protocol-imports.md) · [durable](architecture-improvement/p2-durable-imports.md) · [domain](architecture-improvement/p2-domain-imports.md) · [coordinator](architecture-improvement/p2-coordinator-imports.md) |
| P2–P7 / P2.5 | [당시 진행표](architecture-improvement/p2-p7-progress.md) · [opaque identity](architecture-improvement/p25-identities.md) |
| P3 | [journal](architecture-improvement/p3-journal.md) · [Store integration](architecture-improvement/p3-store-integration.md) · [recovery](architecture-improvement/p3-recovery.md) · [coordinator facets](architecture-improvement/p3-coordinator-facets.md) |
| P4 | [logical facets](architecture-improvement/p4-facets.md) |
| P5 | [초기 lattice](architecture-improvement/p5-dependency-lattice.md) |
| P6 | [ledger integrity](architecture-improvement/p6-ledger.md) · [physical integrity](architecture-improvement/p6-physical.md) · [pinned 검증](architecture-improvement/p6-verification.md) |
| P7 | [durability faults](architecture-improvement/p7-durability-faults.md) |
| P8 | [persisted formats](architecture-improvement/p8-persisted-formats.md) |
| P9 | [power-cut/fuzz](architecture-improvement/p9-powercut-fuzz.md) |
| P0–P9 종합 | [ORDER-002 변경 기록](architecture-improvement/change-record.md) |
| P10–P15 | [구조 정제·적대적 검증 보고서](architecture-improvement/p10-p15-adversarial-review.md) |
| P16–P22 | [데이터·타입 소유권과 evolution 검증](architecture-improvement/p16-p22-refinement.md) |
| P23 | [Internal contract ownership 정리](architecture-improvement/p23-contract-ownership.md) |

## 다른 감사와 generated evidence

- [C01–C07 후속 기록](../implementation/conformance-followup.md)
- [R37–R39 closure](../implementation/refactoring-closure.md)
- [Generated adversarial ledger](../implementation/adversarial-review.md)
- [기존 implementation evidence](../implementation/evidence/)
- [단계별 architecture evidence](architecture-improvement/evidence/)
- [재생성되는 dependency graph](architecture-improvement/evidence/p5-dependency-graph.json)

Generated artifact는 실행 도구와 source에 결합한다. 특히 dependency graph JSON은 같은 경로에 재생성되므로
과거 보고서의 당시 graph가 필요하면 그 revision의 Git snapshot을 확인한다. raw evidence를 사람이 현재 값처럼 고치지 않는다.

## 문서 정리 시 보존한 snapshot

중복된 인계/상태 본문은 Git history에 보존하고 현재 문서는 역할에 맞게 정리했다.

- [기존 HANDOFF](https://github.com/minjung2035/oma-v2/blob/930053c307785106b0a881975cad596c943e8ac1/HANDOFF.md)
- [기존 verification status](https://github.com/minjung2035/oma-v2/blob/930053c307785106b0a881975cad596c943e8ac1/implementation/validation.md)
- [기존 progress](https://github.com/minjung2035/oma-v2/blob/930053c307785106b0a881975cad596c943e8ac1/docs/architecture-improvement/progress.md)

오프라인에서도 `git show 930053c:<path>`로 원문을 확인할 수 있다. 규범의 의미나 과거 실행 사실을 삭제·수정한 것으로 해석하지 않는다.
