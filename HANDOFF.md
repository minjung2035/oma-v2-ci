# OMA v2 — R37/R39 종료 인계

## 0. 현재 결론

이번 요청의 재개 위치였던 **R37 중간 상태에서 R37 잔여 변경과 마지막 R39 정리까지 master에 반영했다.** 두 카드의 상태는 `DONE_WITH_BLOCKED_SUBSTEPS`다. 완료 marker는 중단 뒤 재개 위치용이며 테스트 PASS, full-clause compliance 또는 release-ready를 의미하지 않는다.

**typecheck/build/test/설치/프로브/LOC/증거 generator는 모두 NOT_RUN이다.** 과거의 178/178, 9,774 LOC, 0/258 및 단일 CLI PASS를 현재 source 결과로 재사용하지 않는다. 현재 branch는 실행 검증된 배포본이 아니다.

현재 구현/검증 상태의 기준 문서는 [종료 기록](implementation/refactoring-closure.md), [검증 상태](implementation/validation.md), [물리 순서](implementation/physical-ordering.md), [compliance 계약](implementation/compliance.md)이다. 기존 장문 인계는 [R37 종료 시점의 고정 snapshot](https://github.com/minjung2035/oma-v2/blob/7875afbbe71ae44a65415648774e7f9b95fa4b34/HANDOFF.md)에 보존했다. 그 문서의 로컬 checkout/작업 모드/잔여 한도와 “현재” 실행 수치를 새 작업의 사실로 이어받지 않는다.

## 1. 실행 범위와 재개 기준

- 저장소: `minjung2035/oma-v2`, 기존 `master`.
- 계획 분석 기준: `5b4ffe1238af00aac4a569a5c4d7d9e71092dea0`.
- 이번 재개에서 확인한 중간 HEAD: `e6e9a766ac09c150726df8f5f9f481616ca2841d`.
- R37 종료 commit: `7875afbbe71ae44a65415648774e7f9b95fa4b34`.
- R39 종료 commit: **이 HANDOFF를 갱신한 `R39 DONE_WITH_BLOCKED_SUBSTEPS:` commit**. 자기 commit hash를 미리 계산하거나 임의로 적지 않는다.
- 작업은 GitHub plugin의 파일 읽기/쓰기/commit으로 수행했다. 로컬 checkout, shell git, 테스트 실행, branch/PR 생성 또는 history rewind는 하지 않았다.

첨부 묶음의 실행 순서는 다음과 같으며 다시 정렬하지 않았다.

```text
R00(skip) → R01 → R40 → R02 → R03 → R04 → R05 → R06 → R34 → R07 → R08 → R09
→ R18 → R23 → R22 → R26 → R32 → R10 → R11 → R13 → R12 → R14 → R19 → R20 → R21
→ R15 → R16 → R24 → R27 → R17 → R25 → R28 → R33 → R29 → R35 → R38 → R30 → R31
→ R36 → R37 → R39
```

이번 재개에서 처리할 다음 미완료 카드는 남기지 않았다. 다만 아래 blocked substep, 미연결/unverified trace 및 실행 검증은 남는다. 앞선 모든 카드의 source를 이번에 다시 감사하거나 실행한 것은 아니다.

## 2. 확인한 카드 종료 marker

이 표는 GitHub commit 검색에서 확인한 카드별 최근 종료 marker를 기록한다. 중복된 같은 카드 marker를 서로 다른 카드 완료로 세지 않는다. R39 이전 표는 인수한 이력이고, 이번에 직접 종료한 카드는 R37/R39다. 상태 이름을 implementation correctness나 runtime PASS로 확대하지 않는다.

| 카드 | 기록된 상태 | 확인한 종료 commit |
|---|---|---|
| R00 | NO_CODE_CHANGE | 별도 commit 없음 |
| R01 | DONE | `bf697778df4cff96e495002c0ffee11172de40f6` |
| R40 | DONE | `8c77fa660e1727551a616859a225d0350a352b1d` |
| R02 | DONE | `b292c04cdcbd1103ecf5cad7a577929d9d4942cb` |
| R03 | DONE | `926c27e31b2bf86c12a4d3aee065472f0e07cc46` |
| R04 | DONE | `2347f69939ab1186544dd9c7e3bceffe23282273` |
| R05 | DONE | `27cef16a58a8b7289689a02ad3004c59f4f96651` |
| R06 | DONE | `5d7e7e8072e1752e417bb0db1b1fd4bf521d3180` |
| R34 | DONE | `fa6f716708a65fcbb9efd3fd50476c4c3397929a` |
| R07 | DONE | `9c597497d4d0bad1ff9d9de8a6836bbf9d4c5a17` |
| R08 | DONE | `c9801a0f87e01623c2ee6187cf313d1189b5c483` |
| R09 | DONE | `6acbb73a5b3e3ff4dd1b7919f163b75297706423` |
| R18 | DONE | `60bae92908ed15148683758f1ad50e6303254c0e` |
| R23 | DONE | `71394d7b0a851d873d3b29d03fd346f17a9d58bb` |
| R22 | DONE | `2f9df7382473dc4fc9bcf776fab9be85add838ba` |
| R26 | DONE | `07bf8998716df6f570821680a8acb505bde2c172` |
| R32 | DONE | `aaf868300da2840e348ff977b87536c30f763582` |
| R10 | DONE | `f773bddbb482ed2481e5ee0df3f2b9cbce38e7f0` |
| R11 | DONE | `6a8085e0e3268d66c7dd5594ea0d3e7bcbc7dc80` |
| R13 | DONE | `83dcc22ad27d208b2af2d2e7f262391f4c41a3cb` |
| R12 | DONE | `46b17202f06742b0496f688046077d59809cc4f7` |
| R14 | DONE | `e5d5ccac75787b2e6aa00c4d479a32861f106061` |
| R19 | DONE | `7552efcf2147b5a374550cc0ecf50d9c30db4888` |
| R20 | DONE | `9eb108dbc0a2469c22dca9057b6e2ce63a83c0b9` |
| R21 | DONE | `1c09c245746d5bf210b46f0e93432a46631381ed` |
| R15 | DONE | `dd7ea4eb7f6d89c2e654821126cd859424726814` |
| R16 | DONE | `85f937b1dfc59af66c4838be3bd8f4ffa3628a0c` |
| R24 | DONE_WITH_BLOCKED_SUBSTEPS | `d94aa02facb127b282053450f06ef7bd27cad455` |
| R27 | DONE_WITH_BLOCKED_SUBSTEPS | `1c690fd417e57d269b5d72b56f3fad7a5a33b51f` |
| R17 | DONE | `727e7b934c7109035c00fbba1981272aa869cee4` |
| R25 | DONE | `8856e418729167e2cd75d7c0c9fe3395a8629378` |
| R28 | DONE_WITH_BLOCKED_SUBSTEPS | `0fd101f56ee544b8081c86f1b13c392c224a7d0f` |
| R33 | DONE | `2336a774f7c0306f8f2369c96c13d64ca1378273` |
| R29 | DONE | `3cc343b4fed388ad79e777f49f01450eafa3c100` |
| R35 | DONE_WITH_BLOCKED_SUBSTEPS | `d75f99136c26febc29cb0bba921ef5ff07475c12` |
| R38 | DONE | `dd1c9294d772cf59f334cac35508e049352eff1f` |
| R30 | DONE_WITH_BLOCKED_SUBSTEPS | `be158f5f8effbacddab02dbd3d76f26e3b800745` |
| R31 | DONE | `9624d537cfcf386ed84e74ce22af86b4d45ea38e` |
| R36 | DONE | `7a99ab506cc2b421420efb552b46d29fd21ff3d6` |
| R37 | DONE_WITH_BLOCKED_SUBSTEPS | `7875afbbe71ae44a65415648774e7f9b95fa4b34` |
| R39 | DONE_WITH_BLOCKED_SUBSTEPS | 이 문서의 최종 commit |

이번 재개에서 write가 전혀 없는 전체 BLOCKED 카드는 없다. 인수한 R24의 당시 facade 연결 제한은 R31의 후속 composition 기록과 함께 읽는다. 이를 현재 write 권한이 없다는 의미로 재사용하지 않는다. R27의 이전 추가 시험 write 제한도 후속 R27 marker와 구분한다.

## 3. 이번 R37 잔여 변경의 실제 commit

| Commit | 내용 |
|---|---|
| `bd8623ab69a70d4c2bdc2bc5907b63ee457c9009` | Git 준비 Promise 전달 및 대기열 없는 writer admission |
| `e8554e7a9120e72058aa782b75bb7ff77898648d` | workspace 완료 대기, create completion 합류와 current identity/authority 재검사 |
| `0eae7ab8827762ecee29e24d9a6aa1ba47955993` | context 준비 대기 후 actor/base 재검사 및 sync acceptance/CAS |
| `96438fe0b301bf7bff68b5f7a90bcbd5d7c21519` | context Git 준비의 bounded async 연결 |
| `d1e4d3b38b0974973bf67eed3bdd3d75a7b27758` | read-only async systemctl 관측 |
| `ba177ee370bf261273d9be2357b47a411eb6979b` | Units 관측 single-flight, 기존 death proof 유지 |
| `1ddd428246470601b590aeaef1b6b92493074284` | async startup fsck/복구 관측 및 durable identity 재조회 |
| `643615b898b1641dfee73f94ed58a463f1843085` | native async command 회귀시험 작성 |
| `a4fa4b37a2eb00bac4f8634f8aaecf8855b935b4` | native preparation shutdown barrier |
| `3e360d415ba75529a00b74412e4e123edd263132` | Store/lock 종료와 native quiescence 연결 |
| `1b09d7180621f2cbb29ff3b5bdf50be5555ea831` | 지연 preparation의 auth/ref/create 회귀시험 |
| `29718d1120207918a54c71f17e2a8f8ca3f5f5f1` | 초기 config 실패 시 불필요한 grace 조회 없이 lock 정리 |
| `a299aa112c9a7ab65426337bec16253f1c72136b` | 기존 preadmission scheduling 경계와 frozen integrate 입력 유지 |
| `277fa9273083be6aebdb60987ebaf104271a2cff` | 지연 unit 관측 중 current state 변경 회귀시험 |
| `a235d508f26715d538f44f1c9d085dc57d3c48` | controlled gate 전에 실패한 시험이 무한 대기하지 않도록 보강 |
| `7875afbbe71ae44a65415648774e7f9b95fa4b34` | native shutdown 회귀시험 및 R37 종료 marker |

발견하여 수정한 핵심 누락은 비동기 `workspace.ensure()`를 기다리지 않던 생성 경로와 quarantine Promise를 반환하지 않던 Git façade였다. 이전 중간 commit에 이미 존재한 async 실행기 자체를 이번에 처음 구현했다고 계산하지 않는다.

## 4. 이번 R39 변경의 실제 commit

| Commit | 내용 |
|---|---|
| `84f91f957189e0d1dbbf8a90614d19257f70ba86` | trace fingerprint/link/matrix/source-closure 공통 owner |
| `303d24216ef93acd06b3f5f590134d4d3b50054f` | compliance invalidation 및 실제 source closure 검사 |
| `dbfed5432738297c058f082904d0903f05f3d967` | 보고서와 실행 proof 분리, historical pin 덮어쓰기 제거 |
| `1b79e2736bdd39af388cd67591acc41645ea61d9` | 검토한 source owner/entrypoint/test의 명시적 metadata |
| `0807566b86a6d5328d8110fa28cd7dde71e80596` | trace policy와 core/tiered 독립 inventory 시험 |
| `4efd0f93d0187d4b15f1344243db7a3f74ce1f42` | compliance 정상 대조군과 corruption/import/pin 시험 유지 |
| `b01d3afa3afe78d94c0a8796a8b93e33e367c8a9` | R37/R39 시험의 explicit lane 등록 |
| `f10dac2ed46fa4fe902f870a44b831220314bfb5` | 기존 acceptance-auth의 유효 spec/단일 society/live revoke/proof 전달 수정 |
| `fd0efabdb5b956c456085f9c0bf558fb22224a37` | 현재 ownership/ordering/compatibility/남은 검증 문서 |
| `526a5a43912a4bea65fed0ec28d8b2e6b89fc7ff` | physical-ordering과 현재 coordinator 연결 |
| `f9bf6ddd50fcbc977e5a90390cb248e8bf52ec71` | LOC 규범 유지 및 stale 산출물 표시 |
| `74326cc21a070f60b0b4e53efbc043f60a5d37f6` | source link overlay와 proof 상태 문서화 |
| `38bc2535db255d03b497b26f79829261e56f1ecf` | validation의 현재 NOT_RUN 상태와 historical archive 분리 |
| `07e906a44d6efc5fe3d9feb709ed554acb1f884b` | root validation 색인에서 과거 최신 PASS/LOC 주장 제거 |
| 이 문서의 commit | 최종 HANDOFF 및 R39 종료 marker |

## 5. 새 layout과 보존한 의미

개념적 facade는 기존 `src/git.ts`, `src/lifecycle.ts`, `src/units.ts`, `src/reconcile.ts`로 유지한다. 세부 owner는 `src/git/*`, `src/lifecycle/*`, `src/units/*`, `src/process/*`, `src/runtime/broker-lifetime.ts`로 나뉜다. 설치 entrypoint는 R38의 `dist/src/entry/*` layout이며 source 경로를 배포 실행 경로로 임의 대체하지 않는다. 실제 package/install 검증은 NOT_RUN이다.

길게 걸릴 수 있는 Git 준비와 fsck/show를 기다린 뒤에는 현재 actor/lease/spec/incarnation/desired/base/policy를 다시 관측한다. 최종 authority 검사와 CAS/start 사이에 await를 추가하지 않는다. worker에는 Store/transaction/authority 결정권을 주지 않았다.

wire v1, closed methods/error codes, 여섯 durable entity, schema version, operation/message/request identity, hash 입력, 기존 accepted/terminal bytes 및 fixed unit 이름은 이 재개에서 새로 정의하지 않았다. legacy integrate plan decoder를 migration으로 바꾸지 않았다. private preparation은 새로운 runtime durable queue나 sidecar가 아니다.

명시적 동작 변경은 bounded writer/preparation admission과 불확실한 native 종료 처리다. 바쁜 요청은 기존 `BROKER_UNAVAILABLE`로 같은 key 재시도를 요구하며 무한 대기열에 쌓지 않는다. unknown/timeout/abort를 성공으로 바꾸지 않고, native quiescence가 불확실하면 Store/lock을 정상 종료처럼 해제하지 않는다. direct-child 종료가 임의 descendant 전체의 사망을 보장한다고 주장하지 않는다.

## 6. 지침과 실제 코드/문서가 달랐던 부분

카드에 제안된 새 파일명은 현재 coordinator/adapter 구조에 맞췄으며 기존 owner를 다시 중복 생성하지 않았다. 비동기화는 준비/진단 관측 경계에 한정하고 최종 CAS, death proof, 일부 canonical read/fsync는 동기로 남겼다. 전체 event loop 경로를 nonblocking으로 바꿨다는 뜻이 아니다.

기존 source에 있던 fake 정상 fixture와 society 혼용은 production 검증을 완화하지 않고 시험 setup을 고쳤다. 검증해야 할 negative condition에 도달하기 전 STORE_CORRUPT가 발생하는 시험을 정상인 것처럼 유지하지 않았다.

`architecture.md`와 `implementation-spec.md`의 기존 규범을 새 구현에 맞추어 완화하지 않았다. 현재 세부 ownership/authority/data/order/compatibility 설명은 `implementation/refactoring-closure.md`와 physical-ordering의 비규범적 binding 절에 연결했다. 공개 state/method/service를 추가하는 설계 변경은 하지 않았다.

trace fingerprint 및 실행 evidence는 생성 도구를 실제로 실행해야 한다. 이번 작업은 `source-owners.json`의 검토된 locator와 shared loader를 연결했으며 generated trace/report/LOC/hash를 수동 재생성하지 않았다. 미검토 규범은 추정 owner/비슷한 이름의 test로 채우지 않고 UNLINKED/unverified로 남긴다. 전체 authoritative owner 감사나 full-clause proof가 끝났다는 선언은 아니다.

## 7. 남는 blocked substep과 unverified 범위

| 범위 | 남는 제한 |
|---|---|
| R30 / D04 | 공개 unit 관측 timestamp 등의 wire 확장은 인수한 marker의 deferred 범위로 유지 |
| R27/R28 / D05/D09 | provider/Pi/새 host resource budget이 필요한 부분은 기존 gate 유지. helper/test 작성은 지원 인증이 아님 |
| R35 | 실제 VM power-loss, 유료 provider 및 feature 환경 실행을 수행하지 않음 |
| R37 / D05/D09/D10 | candidate kernel resource enforcement와 임의 descendant 사망 인증을 새 primitive 없이 보장하지 않음. 불확실한 native preparation은 보존 |
| R39 / D01/D09 | 미확정 tiered target oracle·계약을 발명하지 않음. 실제 core/target inventory에서 누락/중복이면 실패하도록 검사 |
| 전체 trace | 미연결 규범의 owner/negative-oracle 검토와 production entrypoint 실행 evidence가 남음. 새 source로 proof 승격 없음 |
| generated inventory/LOC/pins | 재생성 NOT_RUN. 이전 source-bound evidence는 current proof가 아님 |

S-01/S-02/S-03/S-04, S-01-CANDIDATE, S-05/S-06의 필요한 실제 검증을 새로 통과한 것은 아니다. S-08/S-10의 tiered attestation/challenge/floor와 S-11 strict clean-room, S-09 품질·비용 평가는 기존 미검증 상태를 유지한다. base 동작을 tiered 완료로 표현하지 않는다. optional not_applicable도 실제 비활성 profile 거절 증거가 필요하다.

## 8. NOT_RUN과 보존한 기록

| 검증 | 이번 상태 |
|---|---|
| typecheck/build/check:package | NOT_RUN |
| check:architecture/check:transactions | NOT_RUN |
| verify:fast/durable/kernel/crash/property/stress/all, npm test | NOT_RUN |
| actual systemd/cgroup/native/Pi/provider/설치 probe | NOT_RUN |
| cloc 2.08/LOC fixture, 현재 production inventory/hash | NOT_RUN |
| trace inventory/report/compliance의 실제 실행과 새 분모 | NOT_RUN |
| VM 전원단절, 유료 provider, 성능/RSS/FD/품질 비교 | NOT_RUN |

실행 명령은 `implementation/validation.md`에 따로 나열했으며 실행 로그로 제시한 것이 아니다. 기존 `implementation/evidence` raw log와 `audit-source-pins.json`, generated adversarial report 및 production LOC artifacts는 historical 기록으로 보존했다. 새 source hash에 과거 로그를 결합하지 않았다. 오래된 0/258을 구현 비율로, 오래된 LOC를 현재 budget 충족으로 해석하지 않는다.

최종 상태는 **카드 처리 종료 + 남은 substep/UNVERIFIED/NOT_RUN 명시**다. 실제 빌드·회귀·설치·규범 증거 검증 전에는 현재 master를 검증 완료 배포본으로 취급하지 않는다.
