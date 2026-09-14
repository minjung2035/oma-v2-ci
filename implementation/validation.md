# OMA v2 — 현재 검증 상태

**최신 로컬 전체 테스트와 fast lane은 PASS. 실제 환경 적합성 및 release는 미인증이다.**
이 파일은 현재 검증 상태의 단일 기록 위치다. 명령 색인은 [루트 validation.md](../validation.md), 재개 작업은 [HANDOFF.md](../HANDOFF.md), 변경 상세는 [P10–P15 보고서](../docs/architecture-improvement/p10-p15-adversarial-review.md)를 따른다.

## 1. 마지막 전체 실행의 source와 환경

- 실행일: **2026-09-14**.
- 실행 당시 Git HEAD: `133a15c71b282eec447db142921ef1045fd06abb` + P10–P15 working-tree 변경.
- 검증한 구현을 반영한 commit: **`930053c307785106b0a881975cad596c943e8ac1`**.
- 환경: Node **26.7.0**, pinned TypeScript **5.9.3**, cloc **2.08**.
- fast에서 기록한 **377개 source digest**가 full suite 종료 후에도 전부 일치했다. production LOC source hash도 일치했다.
- 이번 문서 정리는 production code/test를 변경하지 않는다. 아래 수치는 문서 편집 중 새로 실행했다고 주장하는 값이 아니라 해당 source snapshot의 실행 기록이다.

| 실제 명령/검사 | 결과 | 범위 |
|---|---|---|
| `npm run typecheck` | PASS | pinned compiler, project-wide |
| `npm run build` / `npm run check:package` | PASS | compile 및 static package 검사; entrypoint 부팅 증거 아님 |
| `npm run check:architecture` | PASS, 0 findings | inventory, evidence, owner/lattice/kernel, transaction gate |
| `npm test` | **884/884 PASS** | build 후 전체 TS-compiled 및 MJS suite; 약 232초 |
| `npm run verify:fast -- --out <new-dir>` | **99/99 PASS** | required-name 검사 포함 |
| `node scripts/loc.mjs` | **147 files / 13,364 code LOC** | generated LOC/hash; release 예산 승인 아님 |

두 test 실행 모두 fail/cancelled/skipped/todo는 **0**이다. 과거 phase5 smoke 실패와 pinned compilation 실패는 이 실행에서 재현되지 않았다.
단위·대역·process-crash 시험을 포함한 suite 통과를 실제 systemd/kernel/provider/VM power-loss 전체 증명으로 확대하지 않는다.

## 2. Artifact와 freshness

| 자료 | 해석 |
|---|---|
| [production-files.txt](../production-files.txt) | 재생성 및 누락 검사 완료 |
| [production-loc.json](../production-loc.json), [production-loc-hashes.json](../production-loc-hashes.json) | 위 source의 pinned cloc 측정; production 변경 시 재생성 |
| [P5 dependency graph JSON](../docs/architecture-improvement/evidence/p5-dependency-graph.json) | P10–P15에서 재생성; 현재 checker가 source universe/graph freshness 검사 |
| [P10–P15 실행 보고서](../docs/architecture-improvement/p10-p15-adversarial-review.md#5-실행-결과) | 마지막 실행의 raw artifact 위치, SHA-256 및 검증 한계 |
| [traceability.json](traceability.json), [adversarial-review.md](adversarial-review.md), `evidence/*` | 별도 과거 generator/raw evidence. 최신 release proof로 재인증하지 않음 |
| [source-owners.json](source-owners.json) | authored owner locator, runtime proof 아님 |

Raw 실행 결과는 보고서에 명시한 `/tmp` 경로에 있다. 임시 파일의 영구 보존이나 다른 머신에서의 가용성을 보장하지 않는다.
Artifact가 없어졌다면 같은 명령을 새 output directory에서 실행한다. 검증한 source와 달라지면 과거 PASS를 자동 상속하지 않는다.

## 3. 남은 검증과 release 게이트

- `verify:durable`, `verify:property`, `verify:kernel`, `verify:crash`, `verify:stress`, `verify:all`: 이번 P10–P15 작업에서 **lane 단위 NOT_RUN**. 일부 소속 tests를 `npm test`로 실행한 것과 lane의 environment/required evidence 완료는 다르다.
- VM power-cut 실제 prepare/reboot/verify, ENOSPC, read-only remount, backup/restore 및 live systemd/cgroup 관측: **NOT_RUN/환경 준비 필요**. 기존 guard/process-crash oracle을 실제 전원단절 proof로 취급하지 않는다.
- S-01/S-01-CANDIDATE isolation·descendant·resource, S-02 Human Pi attach, S-03 trusted consumption, S-04 provider codec/accounting: 실제 환경 evidence 없이 OPEN을 해제하지 않는다.
- S-05/S-06 hostile import·kernel containment·crash/backup 경계, S-08/S-10 tiered attestation, S-11 clean-room, S-09 품질·비용·latency: 각 [SPIKE 계약](spikes.md)의 남은 조건을 유지한다. 유료 provider와 host reboot는 이번에 실행하지 않았다.
- A-008/A-009: LOC 초과와 release 승인 조건이 남는다. 아키텍처 검토 보고서나 테스트 통과만으로 budget/release gate를 닫지 않는다.
- [compliance.md](compliance.md)의 requirement별 fresh evidence 결합 및 release certificate는 별도다. `not_applicable`, stub, skip으로 필수 증거를 면제하지 않는다.

## 4. 과거 기록의 위치

- [문서 정리 전 검증 snapshot](https://github.com/minjung2035/oma-v2/blob/930053c307785106b0a881975cad596c943e8ac1/implementation/validation.md): C01–C07 source-only 당시 상태.
- [conformance-followup.md](conformance-followup.md): C01–C07 수정 근거와 당시 미실행 범위.
- [R37/R39 검증 snapshot](https://github.com/minjung2035/oma-v2/blob/2a00fa20dae8f68d8f489401ba821c16d3c35fc4/implementation/validation.md), [이전 실행 기록](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/implementation/validation.md).
- [전체 단계별 이력 색인](../docs/README.md).

Historical finding의 owner/source SHA를 다시 확인한 뒤 current bug, already-fixed, stale-doc 또는 OPEN gate로 분류한다.

## 5. 보존한 검증 규범

아래 VAL 규범의 문구는 변경하지 않는다. 규범 변경은 문서 정리와 분리한다.

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

| 결과 범주 | 참조 | 해석 |
|---|---|---|
| 초기 설계/primitive/선언 검사 | historical validation Phase 0–9 | 당시 환경의 제한된 결과 |
| 이전 runtime/CLI/첨부 감사의 leaf 진단 | 각 source SHA와 raw logs | 당시 범위의 실행 |
| C01–C07 후속 source 변경 | conformance-followup.md | 당시 source review와 미실행 기록 |
| P10–P15 통합 검증 | 위 §1–2와 실행 보고서 | 명시된 snapshot의 실제 local 실행; release proof와 구분 |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
