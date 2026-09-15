# OMA v2 — 현재 검증 상태

**F1–F4 감사 후속: local·fast·durable 검증 PASS. 실제 systemd/storage quota/provider/power-loss 및 release는 미인증이다.**
이 파일은 현재 검증 상태의 단일 기록 위치다. 명령 색인은 [루트 validation.md](../validation.md), 재개 작업은 [HANDOFF.md](../HANDOFF.md), 최신 변경·비보장 범위는 [F1–F4 후속 수정](../docs/architecture-improvement/f1-f4-remediation.md)을 따른다.

## 0. 현재 F1–F4 감사 후속

- 기준 HEAD: **`d2524ebbac2a8efd03a41a0023358ab40f8a036c` + working tree** (`git rev-parse --short HEAD`: `d2524eb`). 실행일: **2026-09-15**.
- 보고서의 master `9b4ea8f611262b60518767490bc5d3c8a3a41075`와 구분한다. 신규 미커밋 파일도 검증 source에 포함했다.
- 환경: Linux x64, Node **26.7.0**, TypeScript **5.9.3**, cloc **2.08**.
- local → fast → durable 순서로 실행했다. 결과 기록 직전 두 lane의 **404개 source digest**, **153개 production digest** 및 manifest hash를 현재 파일과 대조해 모두 일치함을 확인했다. 이후 변경은 이 파일의 결과 기록뿐이다. 실행 당시 본문은 `/tmp/oma-f1-f4-push.A5hVJj/validation-before.md`에 보존했다.

| 실제 명령/검사 | 결과 | 범위 |
|---|---|---|
| `npm run typecheck` | PASS | pinned compiler, project-wide |
| `npm run build` / `check:package` | PASS | 각 test/lane의 fresh build 및 static package; READY 증거 아님 |
| `npm run check:architecture` | PASS, 0 findings | inventory, graph freshness, ownership/kernel/lattice, transaction |
| `npm test` | **865/865 PASS** | 146개 guarded local files, 약 128초 |
| `npm run verify:fast -- --out <new-dir>` | **151/151 PASS** | F2–F4 및 host-config 회귀와 required-name 검사 |
| `npm run verify:durable -- --out <new-dir>` | **105/105 PASS** | F1 reply/admission 회귀와 기존 durable 경계 |
| `node scripts/loc.mjs` | **153 files / 13,990 code LOC** | inventory/LOC/hash 재생성; release 승인 아님 |

세 test 실행의 fail/cancelled/skipped/todo는 모두 **0**이다. 첫 통합 local은 **849/865**였다. 기존 PublicValidation VM fixture의 명시적 dependency 목록에 새 log codec이 빠져 16개가 실패했다. 실제 codec을 추가하고 기존 assertion/closed whitelist를 유지한 뒤 전체를 새 디렉터리에서 재실행했다. `/tmp/oma-f1-f4-verify.VRiI9p/local.log`는 중간 실패이며 최종 PASS 증거가 아니다.

푸시 전 `src/protocol/log-response.ts`, `test/f1-reply-boundary.test.ts`, `test/f3-log-frame.test.ts`, `test/f4-cli-frame.test.ts`의 포맷 변경을 발견했다. 이전 compiled output과 emitted syntax가 같음을 확인했지만 byte-bound evidence를 재사용하지 않고 graph/LOC 및 local·fast·durable을 모두 새로 실행했다. 위 결과는 이 재검증을 가리키며, `/tmp/oma-f1-f4-final.g7jdbZ/`의 포맷 변경 전 결과와 구분한다.

| Raw artifact | SHA-256 |
|---|---|
| `/tmp/oma-f1-f4-push.A5hVJj/local.log` | `30f3fdc45dce0f48a96b52405ff1d3f8e3d12df608d9c5d73a3bcfd056826542` |
| `/tmp/oma-f1-f4-push.A5hVJj/fast/result.json` | `dd4b284545ef7f0933865e6dc821ef11598463637e73b3b16a8d2d0e39a2e5c2` |
| `/tmp/oma-f1-f4-push.A5hVJj/durable/result.json` | `94936abe4bf5ff380987ce6172d827e7a039efe7d3f9c5334a9f2cf3abcca765` |
| `/tmp/oma-f1-f4-push.A5hVJj/loc.log` | `204bb1240d85b8a03222070717982cf43b86514b17b7519dc8691354ae4faa87` |

Default local suite는 `audit`, `audit2`, `cli`, `phase4`, `phase5`, `phase8`, `crash-boundaries`의 systemd-required 7개 파일을 **NOT_RUN**으로 명시한다. 실제 manager/provider/powercut 및 release는 **NOT_RUN/미인증**이다. quota `SPIKE_UNRESOLVED`, positive READY 요구, OPEN SPIKE와 LOC 승인 게이트는 유지한다. 이번 owned local socket/Store/command fixtures는 실제 배포 인증이 아니다. `/tmp` artifact의 영구 보존은 보장하지 않는다.

## 0a. 과거 P24 감사 후속

- 기준 HEAD: **`48d3f4081522d54c73b5be131a124e24db8eae7d` + working tree** (`git rev-parse --short HEAD`: `48d3f40`). 실행일: **2026-09-14**.
- 환경: Linux x64, Node **26.7.0**, TypeScript **5.9.3**, cloc **2.08**. 신규 미커밋 파일도 검증 source에 포함했다.
- default `npm test`는 user-systemd mixed 파일 7개를 제외한 **local suite**다. 과거 906개 전체 suite와 직접 비교하거나 systemd/provider 검증으로 확대하지 않는다.
- fast → local → durable 순서로 실행했다. 결과 기록 직전 fast/durable 각각 **399개 source digest**, **152개 production digest**와 manifest hash가 전부 일치했다. 이후 유일한 source pin 차이는 이 파일의 결과 기록 갱신이다. 실행 당시 본문은 `/tmp/oma-p24-complete.gmIVEe/validation-before.md`에 보존했다.

| 실제 명령/검사 | 결과 | 범위 |
|---|---|---|
| `npm run typecheck` | PASS | project-wide pinned compiler |
| `npm run build` / `check:package` | PASS | compile/static package; 지원된 READY 부팅 증거 아님 |
| `npm run check:architecture` | PASS, 0 findings | inventory, graph freshness, ownership/kernel/lattice, transaction |
| `npm test` | **840/840 PASS** | 142개 local test files, 약 124초 |
| `npm run verify:fast -- --out <new-dir>` | **124/124 PASS** | P24 owner guards, V01/V02/V04/V05와 required-name 검사 포함 |
| `npm run verify:durable -- --out <new-dir>` | **103/103 PASS** | P01–P07 gate/mail/Git 회귀와 기존 durable 경계 |
| `node scripts/loc.mjs` | **152 files / 13,902 code LOC** | inventory/LOC/hash 재생성; budget/release 승인 아님 |

세 test 실행 모두 fail/cancelled/skipped/todo는 **0**이다. Source-freeze 전 초기 828/833 실패, 통합 중 컴파일 오류, qualification runner 이관 중 839/840 실패는 모두 중간 결과다. 수정 후 위 명령을 새 디렉터리에서 다시 실행했다. 이전 `/tmp/oma-p24-frozen.qNI3AI/` 및 `/tmp/oma-p24-verified.WZhRiu/` 실행은 최종 PASS 증거가 아니다.

| Raw artifact | SHA-256 |
|---|---|
| `/tmp/oma-p24-complete.gmIVEe/local.log` | `ec6643b815464197b0e3f259e42e852d68ce1633ecf4eeaf1b54b75f9978f25e` |
| `/tmp/oma-p24-complete.gmIVEe/fast/result.json` | `9d74c486d298100f6737b5efa1aabfead82fae9cf8179546b546d052624235d6` |
| `/tmp/oma-p24-complete.gmIVEe/durable/result.json` | `d5e8f2169760b5af1ea4d2cec262e2e33147325db6ebfcfe0e2ccc3006d9071e` |
| `/tmp/oma-p24-complete.gmIVEe/loc.log` | `a7fca6e05004d8388df487979bb4135d69a2339e4715cf6bc89ce68590922210` |

실제 manager/provider/powercut은 **NOT_RUN**이다. 지원된 storage quota profile이 없어 실제 broker는 `SPIKE_UNRESOLVED`로 시작을 거부한다. Kernel/all은 새 build의 실제 quota gate를 별도 guarded process에서 관측한 후 BLOCKED/NOT_RUN으로 남으며, 기존 positive READY 요구는 삭제하지 않았다. 이번에 실행한 해당 정책 시험은 소유 임시 fixture를 사용했고 live manager에 접촉하지 않았다. `/tmp` artifact의 영구 보존은 보장하지 않는다.

## 0b. 과거 P24 filesystem containment 실행

- 실행일: **2026-09-14**. HEAD: **`a9bf98d21f785d6773ebd81b50938951356629d6` + P24 working tree** (`git rev-parse --short HEAD`: `a9bf98d`). 신규 미커밋 파일을 포함했다.
- 환경: Linux x64, Node **26.7.0**, TypeScript **5.9.3**, cloc **2.08**.
- 기존 공개/내부 wire·durable 계약, DB schema, package/lock 파일은 변경하지 않았다. P23의 type-only emit 동일성 주장은 이번 runtime 보강에 적용하지 않는다.
- Full 후 fast를 실행했으며, 결과 기록 직전 **387개 fast source digest**, **152개 production digest**와 manifest hash가 모두 일치했다. 이후 pin 차이는 이 문서의 최종 결과 기록뿐이다. 실행 당시 본문은 `/tmp/oma-fs-final.GTA09Z/validation-before.md`, hash는 fast raw result에 남긴다. 코드·테스트·도구와 VAL 규범 문구는 변경하지 않았다.

| 실제 명령/검사 | 결과 | 범위 |
|---|---|---|
| `npm run typecheck` | PASS | project-wide pinned compiler |
| `npm run build` / `check:package` | PASS | compile/static package; entrypoint 부팅 증거 아님 |
| `npm run check:architecture` | PASS, 0 findings | inventory, freshness, ownership/kernel/lattice, transaction |
| `npm test` | **906/906 PASS** | 약 270초; fail/cancelled/skipped/todo 모두 0 |
| `npm run verify:fast -- --out <new-dir>` | **106/106 PASS** | 새 output, required-name 검사; fail/cancelled/skipped/todo 모두 0 |
| `node scripts/loc.mjs` | **152 files / 13,791 code LOC** | inventory/LOC/hash 및 dependency graph 재생성 |
| 새 filesystem 회귀 | **6/6 PASS** | 32개 독립 native-process ABI 검사 포함 |
| 이전 SIGSEGV 경계 반복 | **20/20 PASS** | 4개 crash boundary를 5회 재실행 |

개발 중 중간 전체 실행은 26건이 실패했다. mount namespace 사이 fd 직접 bind를 기존 bounded private tmpfs의 fd-copy로 교정했고, GDB로 `syscall`의 미전달 인자 슬롯 읽기를 확인한 뒤 사용하지 않는 두 인자를 명시했다. 이 수정 후 위 전체 실행을 새로 수행했다. `/tmp/oma-fs-verify.uxUgNV`와 `oma-fs-final-focus.log`의 중간 결과는 PASS 증거가 아니다.

| Raw artifact | SHA-256 |
|---|---|
| `/tmp/oma-fs-final.GTA09Z/full.log` | `9e3bcfa71e6681a1271d637352631dc1d17217ace3d7901eca85117db34e0cf7` |
| `/tmp/oma-fs-final.GTA09Z/fast/result.json` | `104cddce522ef9565574615c612c2c6ac203db8daf2b48419fbbe6c6557a2aa2` |
| `/tmp/oma-fs-final.GTA09Z/loc.log` | `696fa5cd6fc739904d9e55a47bcc95b24b2c22c781b7c7d8a8ec972f7b383d6a` |
| `/tmp/oma-fs-registers-5.log` (원인 진단) | `7e7176b97138ffc0c467c437b13f08cb80bea581464d09490926913f3fab35ef` |

선택한 staging/파일 handoff의 dirfd/bytes 경계만 검증했다. 같은 inode의 내용 변경, process memory, 전체 Git/SQLite VFS, 실제 systemd/provider/VM power-loss 및 release는 검증 범위가 아니다. 기존 OPEN 게이트는 아래 §3대로 유지한다. `/tmp` artifact의 영구 보존은 보장하지 않는다.

## 1. 과거 P23 실행의 source와 환경

- 실행일: **2026-09-14**.
- 실행 당시 Git HEAD: **`dd7905bd8aef1e005a8279b4a9589f3e1a854d9a` + P23 working-tree 변경**. 미커밋 신규 파일도 실행 source에 포함했다.
- 환경: Node **26.7.0**, pinned TypeScript **5.9.3**, cloc **2.08**.
- 전체 suite 후 fast를 실행했다. fast의 **385개 source digest**, production LOC의 모든 source digest와 manifest hash가 결과 기록 직전 전부 일치했다.
- Runner의 source pin에는 이 검증 문서도 포함된다. 실행 후의 유일한 pin 차이는 이 파일의 결과 기록 갱신이며, 코드·테스트·도구·다른 계약 source와 VAL 규범 문구는 그대로다. 실행 당시 hash는 raw result에 남긴다.

| 실제 명령/검사 | 결과 | 범위 |
|---|---|---|
| `npm run typecheck` | PASS | pinned compiler, project-wide |
| `npm run build` / `npm run check:package` | PASS | compile 및 static package 검사; entrypoint 부팅 증거 아님 |
| `npm run check:architecture` | PASS, 0 findings | inventory, evidence, owner/lattice/kernel, transaction 및 별도 contract-ownership gate |
| `npm test` | **900/900 PASS** | build 후 전체 TS-compiled 및 MJS suite; 약 275초 |
| `npm run verify:fast -- --out <new-dir>` | **106/106 PASS** | required-name 검사 포함; 새 output directory 사용 |
| `node scripts/loc.mjs` | **151 files / 13,505 code LOC** | generated LOC/hash; release 예산 승인 아님 |
| 기준 HEAD와 변경 production TS의 emit 비교 | **6/6 동일** | removeComments 적용 JavaScript; 공개/내부 wire·durable 계약과 DB schema diff 없음 |

두 test 실행 모두 fail/cancelled/skipped/todo는 **0**이다. 과거 phase5 smoke 실패와 pinned compilation 실패는 이 실행에서 재현되지 않았다.
단위·대역·process-crash 시험을 포함한 suite 통과를 실제 systemd/kernel/provider/VM power-loss 전체 증명으로 확대하지 않는다.

최초 P23 전체 실행은 **898/899 PASS**였다. 새 gate가 기존 CFG-005 canonical vocabulary alias를 과도하게 거부했으므로, 공개 선언을 바꾸지 않고 정확한 세 alias만 보존하도록 교정했다. 추가 참조/port 직접 참조를 거부하는 fixture를 추가하고 graph·LOC 재생성 후 전체 suite와 fast를 재실행했다. 중간 실패 `/tmp/oma-p23-verified.GlFqCE/full.log`는 최종 PASS가 아니다.
푸시 직전 `scripts/architecture-check.mjs`, `test/internal-port-contracts.test.mjs`의 source pin 변경을 발견하여 현재 source로 전체 suite와 fast를 다시 실행했다. 위 결과와 raw artifact는 이 재검증을 가리킨다. Production/LOC source digest는 그대로 일치했다.

## 2. 과거 P23 artifact와 freshness

| 자료 | 해석 |
|---|---|
| [production-files.txt](../production-files.txt) | 재생성 및 누락 검사 완료 |
| [production-loc.json](../production-loc.json), [production-loc-hashes.json](../production-loc-hashes.json) | 위 source의 pinned cloc 측정; production 변경 시 재생성 |
| [P5 dependency graph JSON](../docs/architecture-improvement/evidence/p5-dependency-graph.json) | 이번 source에서 재생성; 동일 Program의 kernel/internal-port/type review와 freshness 검사 |
| [P23 기록](../docs/architecture-improvement/p23-contract-ownership.md) | 최소 contract 결정·좁은 기존 alias 예외·ownership gate 및 변경하지 않은 런타임 경계 |
| [traceability.json](traceability.json), [adversarial-review.md](adversarial-review.md), `evidence/*` | 별도 과거 generator/raw evidence. 최신 release proof로 재인증하지 않음 |
| [source-owners.json](source-owners.json) | authored owner locator, runtime proof 아님 |

Raw artifact는 다음과 같다. `/tmp`의 영구 보존이나 다른 머신에서의 가용성은 보장하지 않는다.

| 실행 | 위치 | SHA-256 |
|---|---|---|
| 전체 suite | `/tmp/oma-p23-push.f9cRRI/full.log` | `0d497f70122141c2d47a371519fe2453ff05b5351f166f06f0271dd90724114c` |
| Fast result / source pins | `/tmp/oma-p23-push.f9cRRI/fast/result.json` | `7c962bfacc6fa6888cac6ce114ea1e89e631a16a253e8c58425eb9f7f52de221` |
| LOC 실행 | `/tmp/oma-p23-final.LXxndr/loc.log` | `51d450f12d0beb6f09b4866ba1427778dfb92b818d2fb6a3b461fc8c17356463` |

Artifact가 없어졌다면 같은 명령을 새 output directory에서 실행한다. 검증한 source와 달라지면 과거 PASS를 자동 상속하지 않는다.

## 3. 남은 검증과 release 게이트

- `verify:property`, `verify:kernel`, `verify:crash`, `verify:stress`, `verify:all`: 이번 F1–F4 후속에서 **실제 lane 단위 NOT_RUN**. 일부 소속 tests를 `npm test`로 실행하거나 guarded 임시 fixture에서 BLOCKED 판정을 검사한 것과 실제 lane의 environment/required evidence 완료는 다르다. Fast/durable 실행은 §0에 기록한다.
- VM power-cut 실제 prepare/reboot/verify, ENOSPC, read-only remount, backup/restore 및 live systemd/cgroup 관측: **NOT_RUN/환경 준비 필요**. 기존 guard/process-crash oracle을 실제 전원단절 proof로 취급하지 않는다.
- S-01/S-01-CANDIDATE isolation·descendant·resource, S-02 Human Pi attach, S-03 trusted consumption, S-04 provider codec/accounting: 실제 환경 evidence 없이 OPEN을 해제하지 않는다.
- S-05/S-06 hostile import·kernel containment·crash/backup 경계, S-08/S-10 tiered attestation, S-11 clean-room, S-09 품질·비용·latency: 각 [SPIKE 계약](spikes.md)의 남은 조건을 유지한다. 유료 provider와 host reboot는 이번에 실행하지 않았다.
- A-008/A-009: LOC 초과와 release 승인 조건이 남는다. 아키텍처 검토 보고서나 테스트 통과만으로 budget/release gate를 닫지 않는다.
- [compliance.md](compliance.md)의 requirement별 fresh evidence 결합 및 release certificate는 별도다. `not_applicable`, stub, skip으로 필수 증거를 면제하지 않는다.

## 4. 과거 기록의 위치

- [P23 검증 snapshot](https://github.com/minjung2035/oma-v2/blob/a9bf98d21f785d6773ebd81b50938951356629d6/implementation/validation.md)과 [소유권 기록](../docs/architecture-improvement/p23-contract-ownership.md): §1–2의 이전 source/PASS를 보존하며 현재 P24 결과와 구분한다.
- [P16–P22 검증 snapshot](https://github.com/minjung2035/oma-v2/blob/dd7905bd8aef1e005a8279b4a9589f3e1a854d9a/implementation/validation.md)과 [정제 기록](../docs/architecture-improvement/p16-p22-refinement.md): 이전 PASS와 당시 source를 보존한다.
- [P10–P15 검증 snapshot](https://github.com/minjung2035/oma-v2/blob/6b3583814e1586da1efac06559914ef5556d4ebb/implementation/validation.md)과 [당시 실행 보고서](../docs/architecture-improvement/p10-p15-adversarial-review.md): 이번 결과와 구분해 보존한다.
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
| P10–P15 통합 검증 | 위 과거 snapshot과 당시 실행 보고서 | 해당 snapshot의 실제 local 실행 |
| P16–P22 통합 검증 | 위 과거 snapshot과 후속 정제 기록 | 당시 working-tree source의 실제 local 실행 |
| P23 통합 검증 | 위 §1–2와 소유권 정리 기록 | 명시된 working-tree source의 실제 local 실행; release proof와 구분 |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
