# P10–P15 — capability 경계와 architecture checker 적대적 검증

기준: `refactor/safety-preserving-architecture`, 시작 HEAD `133a15c71b282eec447db142921ef1045fd06abb`.
요구사항: 작업 입력 `temp.md`의 P10–P15. 이 기록은 비규범적 변경/검증 보고서이며
`architecture.md`, `implementation-spec.md`, physical ordering, wire/persisted v1 계약을 대체하지 않는다.

## 1. 적용한 구조

- **P10:** `dependency-graph.mjs`의 `createArchitectureProgram()` → `architectureSources()` →
  `graphFromProgram()`이 유일한 production source/edge 경로다. 테스트 root는 제외하되
  import로 들어오는 contract leaf와 compatibility bridge는 포함한다. checker는 **같은 graph 객체**를
  source identity assertion, lattice, evidence freshness에 사용한다. checked-in evidence의 `sourceFiles`가
  다르면 다른 rule/package finding보다 먼저 실패한다.
- **P11:** public/internal 검증 결과는 method–params discriminated union이다. handler switch의
  마지막은 `assertNever`이며, validation 이후 case별 params 재단언은 없다. 외부 unknown method와
  다른 채널의 internal method는 기존 validation 단계에서 거절한다. preflight 결과를 authorization
  cache로 재사용하지 않으며 dispatch에서 현재 authority/params/admission을 다시 확인한다.
- **P12:** dispatcher가 consumer-owned structural ports만 받는다. concrete 객체의 method를
  `Broker` composition에서 필요한 함수로 투영한다. Store writer/transaction, Git recovery/repair,
  Mail materialization 등 consumer에게 필요 없는 권한은 전달하지 않는다. 새 service/state/effect는 없다.
- **P13:** coarse L0–L5는 유지하고, L1의 68개 파일을 `kernel-zones.mjs`에서 **파일 단위로** 분류한다.
  미분류/중복 분류, 상향 runtime dependency, 순수 owner의 effect import를 거절한다.
- **P14:** `module-ports.ts`는 선언만 소유한다. row/transaction type은 storage의 authoritative owner를
  직접 참조한다. `UnitObserve`, `SandboxHost`는 port에 선언하고 기존 views/sandbox export는 유지한다.
  실제 class conformance는 production Program에 포함된 `src/entry/module-conformance.ts`가 검사한다.
  normative module compatibility facade와 wire/persisted 선언은 변경하지 않는다.
- **P15:** 독립 SCC oracle 및 syntax mutation을 먼저 실행한 뒤 Program/import classification/SCC를
  dependency graph owner로 통합했다. coarse lattice, kernel zones, owner policy는 별도 모듈에 남긴다.
  checker를 LOC 목적으로 임의의 여러 rule 파일로 쪼개지는 않았다. exact baseline 정책은 그대로다.

Architecture graph와 runtime package graph는 같은 것이 아니다. 후자는 실제 entry roots와
`production-files.txt`에 대한 **runtime** reachable closure이며 type-only leaf를 배포 reachability로
취급하지 않는다. 새 compile-only source는 기존 `src/**` inventory 규칙에 따라 기록된다.

현재 evidence: Program source **148개**(contract owner/bridge 10개), runtime edge **553개**,
type-only edge **259개**, runtime SCC **0개**, 기존 Store/facet type-only SCC **1개**.
P5와의 source/type-edge 수치 차이는 누락되던 Program closure/inline type import를 포함한 결과이기도 하므로
새 runtime subsystem 수나 복잡도 감소 지표로 해석하지 않는다.

## 2. 재현한 공격/누락과 수정

| 발견 | 재현/수정 |
|---|---|
| tsconfig root에 없는 type-only leaf가 evidence에서 빠짐 | root → type leaf fixture. production Program closure와 source identity를 비교 |
| evidence 디렉터리 전체가 없으면 freshness 검사를 생략함 | 디렉터리 존재 여부에 따른 exemption을 제거. evidence 삭제 자체가 gate 실패가 되는 mutation으로 고정 |
| self-import는 checker가 거절하지만 evidence SCC에는 표시되지 않음 | singleton self-loop fixture가 먼저 실패. 동일 SCC helper가 self-loop도 집계 |
| 서로 다른 SCC 구현을 checker/evidence가 사용 | iterative Tarjan 한 owner로 통합. 독립 transitive-closure/mutual-reachability oracle과 대조 |
| `import x = require()`를 package/checker가 놓침 | direct/re-export/dynamic/require/import-equals 변형을 하나의 syntax classifier로 처리 |
| inline `import("...").Type` 누락, type-only import-equals 오분류 | 명시적 type edge 추출. runtime closure에서는 계속 제외 |
| nonliteral dynamic import가 evidence의 빈 external specifier로 들어감 | unresolved로 기록하고 checker/runtime closure가 거절 |
| TS `paths`로 이름 붙인 local import가 external package로 처리됨 | compiler resolver로 local identity를 찾고 lattice/manifest에 포함 |
| `const write = writeFileSync` / namespace / destructuring alias로 transaction effect 검사를 우회 | alias declaration을 따라 effect module을 확인. 실제 effect는 실행하지 않는 mutation fixture |
| Store를 선언 port로 좁히면 transaction receiver 인식을 놓침 | canonical `StorePort` signature도 transaction owner로 검사. interface-typed effect mutation으로 고정 |
| 순수 codec이 grammar 대신 UUID 생성기도 포함한 `ids.ts` facade를 import | grammar consumer를 `domain/identifiers.ts`로 연결하고 `ids.ts`는 K2로 분류 |
| inline type edge를 측정하자 compatibility facade → ports → batch codec → facade cycle이 드러남 | batch codec이 `PreparedBatch`/`ProtocolLimits`의 직접 leaf owner를 사용. schema 복제나 cycle 예외 없음 |
| port 투영 도입 중 short-circuit/부재 guard가 달라질 수 있음 | 일반 mail.send에는 approval ledger 조회를 추가하지 않고, principal 부재 시 기존 zero-result 반환을 filesystem/mail effect보다 먼저 유지 |

## 3. P13 측정 → semantic review → enforcement

모든 cross-zone runtime edge는 generated evidence의 `kernel.crossZoneEdges`에 나타난다.
그 edge를 실제 imported operation과 함께 검토한 결과를 아래 방향별로 묶었다. **현재 edge가 있다는
이유로 방향을 허용한 것이 아니다.** 생성기는 review 승인을 자동 부여하지 않는다.

```text
K3 ledger owner (11) → K2 bounded mechanisms (18) → K1 representations (18) → K0 values (21)
                     각 zone은 모든 더 낮은 zone에도 의존 가능
```

| cross-zone 방향 | 최종 분류 | owner semantics |
|---|---|---|
| K1 → K0 | required | closed wire/durable/mail/frame/cache representation이 identifier, canonical JSON, lexical path, value policy를 사용 |
| K2 → K0 | required | filesystem/process/config/transport/UUID mechanism이 입력 grammar, 오류, path/ref identity와 bounded command value를 사용 |
| K2 → K1 | required | config JSON decoding, transport framing/response decoding, durable batch-view publication의 representation 검증 |
| K3 → K0 | required | ledger row/journal/transition의 identity, admission, error, canonical/hash relation |
| K3 → K1 | required | persisted row/operation의 fail-closed decoding 및 frozen relation/receipt 검증 |
| K3 → K2 | required | Store가 DB 경로의 실제 directory를 검증. storage primitive가 ledger/workflow를 호출하는 반대 방향은 금지 |
| K0/K1 → `ids.ts` | accidental convenience dependency, 제거 | grammar만 필요한 consumer가 randomness mechanism을 알 이유가 없음 |

디렉터리 이름과 다른 분류도 책임에 근거한다.

- `storage/paths.ts`는 host root에 대한 **lexical** construction뿐이며 filesystem containment 증명이 아니다: K0.
- `process/command.ts`는 subprocess를 실행하지 않는 description/validation: K0.
- `domain/persisted-formats.ts`, `durable.ts`는 format/plan representation을 판별한다: K1.
- `protocol/channel.ts`는 실제 transport, `config/policy.ts`는 host refresh callback과 snapshot 수명: K2.
- row/operation codec, facets, transaction, ledger-facing module ports는 single ledger boundary: K3.

K0/K1의 native import는 exact source/module pair만 허용한다. crypto는 해당 hash owner의
named `createHash`만 허용하며 namespace/default/randomness import로 확대하지 않는다.
새 kernel file은 zone 결정을 요구하고 금지 방향에는 예외를 추가하지 않았다.

Store/facet의 기존 type-only SCC는 그대로 보존한다. 이는 하나의 writer vocabulary를 재사용하는
관계이며 runtime cycle이 아니다. 이를 없애려고 DTO/Store method schema를 복제하지 않았다.

## 4. 검증 계약

`test/architecture-oracles.test.mjs`는 다음을 고정한다.

- 3-node graph **512개 전수** + seeded random graph **1,000개**를 독립 SCC oracle과 비교;
  20,000-node chain으로 recursive stack overflow도 방지.
- Program source identity, imported-only leaf, test-only root exclusion, self-loop, import syntax/path alias,
  transaction local aliases, kernel의 16가지 zone 방향 및 exact classification.
- port emit이 `export {};`뿐인지 확인하고, 실제 Store와 port signature를 가상으로 어긋나게 만들었을 때
  pinned TypeScript 5.9.3이 **conformance 파일에서** 실패하는지 확인.
- source/snippet hash가 바뀐 baseline은 stale; wildcard/line-only exception은 거절.

기존 architecture-contracts, contract ownership/golden, journal/facet, broker composition, public validation
회귀도 유지한다. P13 도입으로 positive architecture fixture의 임의 파일명만 실제 zone owner로 바꿨다.
P14의 import-migration body snapshot은 검토한 **선언 이동**에 맞춰 갱신했으며, contract bindings는 유지하고
별도 erased-output/conformance mutation으로 보강했다. wire/persisted golden은 갱신하지 않았다.

새 oracle은 `verify:fast`/`verify:all`의 source test와 required-name 검사에도 포함된다.

## 5. 실행 결과

| 검사 | 최종 결과 |
|---|---|
| `npm run typecheck` | PASS — pinned TypeScript 5.9.3 |
| `npm run build` / package check | PASS |
| `npm run check:architecture` | PASS — inventory, evidence, owner/lattice/kernel, transaction gate 0 findings |
| `npm test` | **884/884 PASS**, fail/cancelled/skipped/todo 0, 약 232초 |
| `npm run verify:fast -- --out <new-dir>` | **99/99 PASS**, required-name 검사 PASS |
| `node scripts/loc.mjs` | cloc 2.08로 147개 source, 13,364 code LOC 및 hash 재측정 |
| 최종 diagnostics / `git diff --check` | blocking error 없음 / PASS |

첫 full serial 실행에서는 876개 중 frozen contract surface 1개가 실패했다.
normative compatibility alias/format을 원문으로 복구하여 해결했고, wire/persisted golden은 변경하지 않았다.
후속 883/883 실행 뒤 StorePort transaction regression까지 포함한 **최종 884/884 실행**으로 다시 확인했다.
추가로 import 경로를 바꾼 kernel 8개 파일의 emitted runtime AST를 시작 HEAD와 비교해
import/불필요한 grouping 외의 runtime body가 같음을 확인했다.

완료 후 비동기 formatter가 동결 계약을 다시 변경하는 문제도 재현했다. 원문을 다시 복원하고
`implementation/contracts/biome.json`에서 해당 디렉터리의 **formatting만** 비활성화했다.
타입·계약·아키텍처 검사나 golden은 완화하지 않았다. internal dispatcher는 직전 full suite가 검사한
emitted artifact와 runtime AST가 같았으며, 이후 전체 **884/884**와 fast **99/99**를 다시 실행했다.
위 표와 아래 digest는 이 마지막 실행을 기준으로 한다.

최종 fast 실행 시 수집한 **377개 source digest 전부**가 full suite 종료 후에도 일치했다.
생성된 production LOC source hash도 모두 일치한다. 이 수치로 A-008/release budget 승인을 대신하지 않는다.

로컬 raw artifact(임시 디렉터리이므로 영구 보존을 의미하지 않음):

- fast: `/tmp/oma-p10-p15-fast-stable-1789348581/result.json`
- full: `/tmp/oma-p10-p15-stable-suite.ML41gN.log` (exit 0)
- `SHA256(JSON.stringify(fast.sourceDigests))`: `e832a0a4fbd90b78e8f141a7f69458764f41e4a0bfcf58488ecf9d699e152e8b`
- full log SHA-256: `4b6e07930c0d1ad02bbfe7e38058ef34541e842dbcc8dd0f19514d6ca21d9ae8`

## 6. 증거의 한계

이 변경은 single broker/writer, accepted durable intent, immutable recovery evidence, explicit unknown,
normal/recovery decision 분리, current-authority revalidation, incarnation/run fencing, bounded effects를
재설계하지 않는다. DB schema, wire method, persisted v1 bytes, OPEN SPIKE 상태를 바꾸지 않는다.

정적 import/alias 분석은 임의 JavaScript의 모든 reflective/eval 동작에 대한 증명이 아니다.
본 검증은 compiler-resolved dependency와 테스트에 명시된 syntax/behavior 범위를 증명한다.
테스트 통과를 새로운 systemd/kernel/rootfs/provider/power-loss 또는 release certification으로 격상하지 않는다.
현재 graph 수치/전체 edge와 matrix의 authoritative evidence는
[`evidence/p5-dependency-graph.json`](evidence/p5-dependency-graph.json)이다.
