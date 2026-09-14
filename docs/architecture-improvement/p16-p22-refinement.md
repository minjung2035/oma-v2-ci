# P16–P22 — 데이터 경계·타입 소유권과 진화 검증

## 0. 성격과 기준

이 문서는 후속 정제의 결정·검증 범위를 기록한다. architecture/spec, wire/DB/persisted v1, physical ordering 또는 OPEN SPIKE를 대체하지 않는다.

- 사용자 검토 기준: `930053c307785106b0a881975cad596c943e8ac1`.
- 작업 기준: `6b3583814e1586da1efac06559914ef5556d4ebb`, `refactor/safety-preserving-architecture`. 두 revision의 차이는 문서뿐이다.
- P10–P15의 Program source universe, full evidence freshness, runtime/union SCC, typed handler closure, narrow capability와 independent oracle은 유지한다. 이미 해결한 문제를 다시 미완료로 취급하지 않는다.
- 실행 결과와 source pin의 단일 위치는 [현재 검증 상태](../../implementation/validation.md)다. 이 보고서는 최신 test count·LOC·edge 수를 복제하지 않는다.

## 1. P16 — 실제로 제거한 데이터 지식

| 경계 | 선택 | 사라진 지식 / 유지한 사실 |
|---|---|---|
| Public dispatcher → agent | Consumer-owned `PublicAgentView` | `AgentRow` import를 제거. readonly `name`, `incarnation`, `desired`, `specJson`만 노출하며 desired의 값은 기존 `AgentStatus` 계약을 참조 |
| Composition → PublicAgentView | 새 plain object projection | row 객체 자체와 parent/spec hash/creation metadata 등을 전달하지 않음. `listAgents`도 name만 전달 |
| Receipt projection | **대안 A: projection 자체를 K3로 이동** | `storage/receipt-projector.ts`가 `DecodedOperation`을 소비. K1 `protocol/receipts.ts`는 wire receipt 표시/exit/not-found만 담당 |
| Operation result constructor → ValidatedPlan | 발급 owner를 **K3에 유지** | 이 brand는 단순 JSON shape가 아니라 payload/hash, delivery, agent 및 operation 관계의 검증 사실. K1에서 재발급하거나 더 약한 type으로 바꾸지 않음 |

Receipt용 DTO·validator·adapter registry를 하나 더 만들지 않았다. 기존 projection 함수의 동작과 `mail.receiptOf` 호환 export를 유지하고 모든 소비자를 새 owner로 연결했다. 저장된 JSON, request hash, accepted bytes, terminal result는 다시 만들거나 rewrite하지 않는다.

남아 있는 `operation-results.ts → operation-codec.ts` type edge는 relationally validated plan을 요구하는 관계다. 이를 없애기 위해 assertions를 늘리거나 brand issuer를 representation 계층으로 옮기는 것은 더 약한 경계이므로 선택하지 않았다. 이 설명은 edge의 의미에 대한 검토 기록이며 checker whitelist가 아니다.

## 2. P17·P18 — 선언 계약과 composition

### Internal port의 semantic owner

- `src/ports/ledger.ts`: operation row query, transaction/close, receipt projection 계약.
- `src/ports/runtime.ts`: units, views, reconcile, runner, sandbox와 내부 observation/composition 값.
- `src/module-ports.ts`: 기존 명칭을 유지하는 type-only compatibility facade.
- `src/entry/module-conformance.ts`: 실제 구현의 호환성을 확인하는 compile-only composition 검사.

실제 consumer는 필요한 runtime port owner를 직접 참조한다. 동결된 normative 계약의 facade 연결은 변경하지 않는다. 이동 전 owner에서 얻은 declaration fingerprint와 새 두 owner의 합을 비교하므로, 새 코드에서 expected를 다시 학습해 선언 변경을 숨기지 않는다. 기존 contract binding/alias의 합도 유지한다.

이 선언들은 coarse `L0-contracts` 안의 **erased internal contracts**이며 K0–K3 runtime kernel 소유권과 구별된다. 단순한 directory 예외가 아니다. `internal-port-runtime` 검사는 명시적 type import/export를 제외한 실행 코드·value import·re-export를 거부한다. 정상 declaration erasure와 구현 conformance를 별도로 검사한다.

### Broker composition

`src/broker/composition.ts`의 두 explicit factory가 필요한 함수와 값만 새 객체에 투영한다. Service locator, container, cached observation 또는 generic dispatch framework는 추가하지 않았다.

- Concrete Store/Git/Lifecycle 등의 객체를 port property로 직접 전달하지 않는다.
- Peer 인자도 structural subtype의 추가 capability가 새어나가지 않도록 다시 좁은 객체로 투영한다.
- 각 closure는 호출 시 실제 method/current row를 읽는다. 메서드를 먼저 bind하거나 preflight 결과를 cache하지 않는다.
- Broker는 여전히 socket, auth/lifetime, lease/lock, shutdown 및 private callback wrapper를 소유한다. 그 순서와 override 연결을 바꾸지 않는다.

## 3. P19 — Type coupling은 관측·분류, 방향 금지는 아님

기존 [generated graph](evidence/p5-dependency-graph.json)의 runtime/type matrix를 재사용한다. `kernel.internalPortContracts`와 `kernel.typeOnlyReview`는 같은 Program에서 계산하며 별도 source universe나 손으로 관리하는 edge 목록이 아니다.

검토 항목은 kernel/coarse 상향 type edge, internal port 관계와 composition conformance다. 분류는 다음 **구조적 문맥**을 나타낸다.

- `compatibility-facade`: normative/compatibility 계약의 연결.
- `port-conformance`: composition에서 실제 구현 호환성을 검사하는 의존.
- `internal-port-contract`: erased port/data 계약 사이의 연결.
- `representation-relation`: kernel representation 관계. 자동으로 바람직하다고 승인하지 않음.
- `implementation-knowledge-review`: 위 문맥만으로 설명되지 않는 검토 대상.

`mode: report-only`, `classificationsAreApproval: false`가 명시된다. 유형 분류는 개별 edge 허용 목록도, semantic proof도 아니다. 새 상향 type edge가 추가되어도 이 보고 기능만으로 실패시키지 않는 fixture를 둔다. 기존 runtime DAG와 cross-layer union SCC gate는 그대로 동작한다.

추가 type 방향 gate는 실제 부적절한 coupling, legitimate 관계의 분류, false-positive control이 모두 준비된 뒤 별도로 검토한다. 현재의 relational brand 의존까지 무조건 금지하지 않는다.

## 4. P20 — 현재 값과 과거 기록의 단일 소유

문서의 역할 정리는 선행 `6b35838`에 이미 반영되어 있어 다시 대량 재작성하지 않았다. 이번에는 새 owner/보고서 링크와 [유지보수 원칙](../../MAINTENANCE.md#29-문서-관리-규칙)만 갱신한다.

| 사실 | 현행 owner |
|---|---|
| dependency source/edge/SCC/type review | `dependency-graph.mjs`가 재생성한 graph JSON |
| runtime package closure | production inventory/build/package 검사. architecture Program과 별개 |
| production LOC/hash | `loc.mjs` 산출물 |
| 최신 실행·source pin·NOT_RUN/release 범위 | `implementation/validation.md` |
| 현재 재개점 | `HANDOFF.md` |
| 당시 선택·실패·수정 근거 | 해당 revision의 단계별 보고서/Git snapshot |

Mutable derived facts를 README/HANDOFF/여러 보고서에 현재 값으로 복사하지 않는다. 새 숫자로 고쳐야 하는 authored dependency 목록도 만들지 않는다. Historical 기록의 당시 실패·개수를 수정해 현재 PASS처럼 보이게 하지 않는다.

## 5. P21 규칙 수용과 checker 범위

장기 정책은 [MAINTENANCE §27](../../MAINTENANCE.md#27-정적-규칙은-계약-위반의-재발을-검증한다)에 있다. 기존 compiler/AST/graph/helper를 우선 재사용하며 LOC 목표만을 위한 checker 분해와 새 naming heuristic을 추가하지 않았다.

이번 `internal-port-runtime` 수용 근거:

| 조건 | 검증 |
|---|---|
| 지키는 계약 | Internal port는 runtime implementation/capability owner가 아니라 erased declaration surface |
| Positive | 실제 ledger/runtime/facade의 erasure 및 implementation conformance |
| Direct negative | export된 runtime const/enum |
| Indirect negative | local import alias, namespace alias, value re-export, side-effect import |
| False-positive control | type alias/re-export, ambient brand, port 밖의 정상 runtime value |
| 근거가 naming 취향이 아닌 이유 | 명시적으로 선택한 contract 경계에서 실제 TypeScript emission을 검사. prefix만으로 runtime kernel 검사를 면제하지 않음 |

P22의 method/operation/capability 검증은 production compiler와 기존 declaration-surface helper를 사용한다. 별도 registry, compiler facade 또는 수동 method 이름 목록을 생성하지 않는다.

## 6. P22 — 실제 source에 대한 evolution drill

`test/architecture-evolution.test.mjs`는 모든 변경을 compiler memory 안에서만 수행한다. 가상의 신규 wire method/operation을 저장소에 구현하거나 v1 fixture에 추가하지 않는다.

| Drill | 누락 시 검증 | Positive control / 한계 |
|---|---|---|
| A: public read method | DTO 추가 후 descriptor, 실제 handler의 `assertNever`, response decoder가 각각 누락을 검출 | 필요한 연결을 모두 갖춘 read-method fixture가 실제 Program 전체에서 compile |
| B: operation kind | canonical plan/result kind 집합, 실제 codec의 `satisfies`, result validator의 case coverage | schema 연결을 모두 갖추면 해당 closure 검사 통과. 가상의 workflow/physical effect/recovery가 구현됐다고 주장하지 않음 |
| C: kernel file | 새 파일의 `kernel-zone-unclassified` | 기존 zone 검사 API에 명시적 K0 소유권을 제공하면 통과. production membership은 수정하지 않음 |
| D: capability 확대 | public/internal Store port에 optional repair/recover/transaction 추가 시 reviewed interface snapshot 불일치 | ordinary assignability만으로는 이 확대가 compile한다는 것도 확인. 기존 실제 composition의 exact keys·non-identity·live lookup 검사는 별도 유지 |

### Drill A가 발견한 실제 누락

`response-codec.ts`의 `ReadResultMethod`가 손으로 나열한 union이어서 DTO/descriptor/handler만 추가하면 response decoder 누락을 compiler가 잡지 못했다. 새 drill이 이 상태에서 실패하는 것을 확인한 뒤 다음 타입만 바꿨다.

```ts
type ReadResultMethod = Exclude<PublicMethod, MutationMethod | "operation.get">;
```

Mutation과 `operation.get`는 이미 별도의 receipt decode branch가 소유한다. 나머지 메서드의 check 목록은 canonical method 집합으로 닫힌다. 실행 JavaScript가 작업 기준과 동일함도 비교했다. 기존 wire grammar, validation 순서, failure code나 unknown 처리에는 변화가 없다.

Receipt projection/CLI 표시는 kind별 새 registry가 아닌 기존 generic receipt 경로다. 여기의 runtime 보존은 `error-receipt-policy`, `error-phase-invariants`, `receipt-admission-boundary`와 전체 suite로 검증한다. Reconcile/normal 판단은 합치지 않았으며 synthetic schema drill을 실제 recovery 성공으로 확대하지 않는다.

## 7. 실행과 안전성 경계

대상 검사와 최종 전체 실행의 명령·결과·source pin·artifact 위치는 [현재 검증 상태](../../implementation/validation.md)만 갱신한다. 검증 entry는 `package.json`과 [검증 색인](../../validation.md)을 따른다.

단일 physical writer, synchronous transaction, immutable accepted v1 evidence, explicit unknown, normal/recovery 분리, irreversible effect 직전 current-authority/incarnation 재검증, bounded I/O를 유지한다. Host/VM/provider 검증, OPEN SPIKE 및 LOC/release 승인은 별도이며 이 정제로 완료 처리하지 않는다.
