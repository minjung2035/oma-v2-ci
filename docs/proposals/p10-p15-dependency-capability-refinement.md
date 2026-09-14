# OMA v2 아키텍처 정제 개선 제안서

## 0. 문서 성격

이 문서는 OMA v2의 기존 architecture.md, implementation-spec.md 또는 기존 안정성 보존형 아키텍처 제안서를 대체하지 않는다.

현재 작업 기준은 다음과 같다.

- repository: minjung2035/oma-v2
- branch: refactor/safety-preserving-architecture
- reviewed HEAD: 133a15c71b282eec447db142921ef1045fd06abb

현재 브랜치는 이미 contract owner 분리, operation closed-world registry, logical Store facets, measured dependency lattice, independent integrity inspection, durability fault seam, persisted-format boundary 등의 큰 구조 개선을 수행한 상태다. 기존 제안서의 목적 역시 OMA의 safety-oriented architecture를 갈아엎는 것이 아니라 기존 kernel을 명료하게 만드는 것이었다.

따라서 본 제안의 목적은 새로운 architecture를 발명하는 것이 아니다.

이미 강한 OMA의 safety model을 코드 모듈 사이의 dependency capability에도 끝까지 적용하고, architecture enforcement 자체의 신뢰도를 높이는 것이 목적이다.

기능 완성도, release readiness, 미구현 feature는 본 문서의 평가 대상이 아니다.

---

## 1. 요약

현재 OMA v2의 가장 큰 장점은 architecture가 단순한 디렉터리 convention에 머물지 않는다는 점이다.

다음과 같은 규칙들이 실제 정적 검사 대상으로 올라와 있다.

- single SQLite owner
- subprocess owner
- pure domain/protocol boundary
- transaction 내부 async/effect 금지
- persisted-plan cast 금지
- request identity 단일 owner
- operation decoder exhaustiveness
- runtime import cycle 금지
- dependency lattice
- exact source-bound exception

현재 dependency evidence 기준으로 production graph는 138개 파일, runtime edge 550개, type-only edge 147개이며 runtime SCC는 0이다. 이는 현재의 coarse-grained dependency direction이 잘 통제되고 있음을 의미한다.

그러나 다음 단계의 구조적 문제가 남아 있다.

1. architecture evidence와 실제 TypeScript Program이 서로 다른 source universe에서 계산될 수 있다.
2. 138개 production 파일 중 68개가 하나의 L1-kernel에 들어 있어 kernel 내부 semantic boundary가 충분히 표현되지 않는다.
3. dispatcher 같은 consumer가 필요한 capability 대신 concrete subsystem 전체를 안다.
4. protocol method set은 closed-world인데 실제 dispatch handler coverage는 같은 수준으로 닫혀 있지 않다.
5. internal port declaration이 실제 implementation type을 다시 알고 있어 abstraction과 conformance 검사가 섞여 있다.
6. architecture checker가 충분히 강해진 만큼 checker 자체가 correctness-critical subsystem이 되었지만, 독립적인 oracle이 아직 부족하다.

본 제안은 이를 P10–P15의 여섯 단계로 개선한다.

---

## 2. 보존해야 할 현재 architecture

이번 개선 과정에서 다음 특성은 변경하지 않는다.

- single broker
- single SQLite writer
- accepted durable intent
- immutable recovery evidence
- explicit unknown
- normal execution / recovery decision separation
- current-authority revalidation
- incarnation/run fencing
- bounded host effects
- fail-closed persisted-state decoding

특히 다음과 같은 형태로 개선해서는 안 된다.

- table마다 별도의 repository/writer 객체를 만들어 SQLite ownership을 분산하지 않는다.
- normal execution과 recovery를 하나의 generic workflow engine으로 합치지 않는다.
- Store의 물리적 writer를 여러 service로 분리하지 않는다.
- dependency graph를 예쁘게 만들기 위해 persisted v1 format이나 wire method를 변경하지 않는다.
- interface 개수를 늘리는 것 자체를 modularity 개선으로 간주하지 않는다.
- file LOC나 fan-out 숫자를 낮추기 위해 의미 있는 orchestration을 기계적으로 쪼개지 않는다.
- 현재 Store/facet의 type-only SCC를 숫자상의 cycle 제거만을 위해 중복 schema로 대체하지 않는다.

현재 존재하는 Store/storage의 유일한 union SCC는 runtime cycle이 아니라 type-level 관계이며, runtime graph는 여전히 acyclic하다. 이를 제거하기 위해 method vocabulary를 복제하는 것은 single-owner 원칙보다 나쁜 결과를 낼 수 있다.

---

## 3. 현재 구조에서 확인된 핵심 문제

### 3.1 Architecture evidence source universe가 완전히 동일하지 않다

현재 scripts/dependency-graph.mjs에는 두 가지 source 수집 경로가 존재한다.

graphFromProgram()은 실제 TypeScript Program에 들어간 전체 source closure를 사용한다.

반면 checked-in evidence를 만드는 collectDependencyGraph()의 기본 source는 productionSources()이며, 이는 tsconfig.json의 parseJsonConfigFileContent(...).fileNames를 시작점으로 사용한다.

현재 tsconfig.json은:

```json
"include": [
  "src/**/*.ts",
  "implementation/contracts.ts",
  "test/**/*.ts"
]
```

이다. 즉 contract leaf 파일들은 implementation/contracts.ts에서 type-import되어 Program에는 들어가지만 root file set에는 직접 포함되지 않는다.

그 결과 현재 checked-in dependency evidence는:

```text
L0-contracts files = 1
```

이라고 기록한다. 실제 contract owner는 identity.ts, durable.ts, runtime.ts, host.ts, public-wire.ts, internal-wire.ts, module-contracts.ts 등 여러 파일로 분리되어 있다.

더 중요한 점은 architecture enforcement는 graphFromProgram(program)을 사용하지만 evidence freshness는 다시 collectDependencyGraph()를 사용한다는 것이다. 따라서 두 경로는 같은 edge extractor를 공유하지만 source universe 자체는 같다고 보장되지 않는다.

이는 현재 가장 먼저 수정해야 할 문제다.

Architecture evidence는 단순 문서가 아니라 gate의 신뢰 근거이므로:

> 검사 대상과 증거 대상의 source identity가 먼저 같아야 한다.

---

### 3.2 L1-kernel이 너무 넓다

현재 L1-kernel에는 다음이 함께 들어간다.

- src/domain/**
- src/protocol/**
- src/process/**
- src/storage/**
- src/config/**
- src/store.ts
- src/durable.ts
- src/frame.ts
- src/validate.ts
- src/ids.ts
- src/hash.ts
- src/module-ports.ts
- 일부 mail codec
- 일부 CLI codec

총 138개 파일 중 68개가 L1이며, L1 내부 runtime edge가 180개 존재한다.

현재 lattice는 의도적으로 aspirational architecture가 아니라 측정된 coarse DAG다. 같은 layer 또는 더 fundamental한 layer로의 runtime dependency를 허용한다.

이 접근은 기존 structure regression을 막는 데 매우 적합했다.

그러나 이제는 다음 질문을 충분히 표현하지 못한다.

- domain이 storage mechanism을 알아도 되는가?
- codec이 process mechanism을 알아도 되는가?
- storage primitive가 protocol 정책을 알아도 되는가?
- Store mechanism과 pure value semantics 사이의 허용 방향은 무엇인가?

현재 pureBoundaryViolation 같은 별도 규칙이 일부를 방어하지만, L1 전체의 semantic architecture를 설명하지는 않는다.

즉 현재 상태는:

- inter-layer architecture: 강함
- intra-kernel architecture: 상대적으로 coarse

이다.

---

### 3.3 Consumer가 capability 대신 concrete owner 전체를 받는다

PublicDispatcher는 socket과 lease ownership을 Broker로부터 분리한 좋은 구조다.

그러나 dependency surface는 여전히 다음과 같다.

- Store
- MailModule
- UnitsModule
- ViewsModule
- LifecycleModule
- GitModule

즉 public request dispatch라는 한 consumer가 여섯 개 concrete owner를 직접 알고 있다.

InternalDispatcher도 유사하게:

- Store
- MailModule
- ReconcileModule
- PeerAuthenticator

의 실제 module surface를 안다.

반대로 OperationJournal 계열에서 이미 사용 중인 좋은 패턴은:

> owner 전체가 아니라 consumer가 실제로 필요한 operation만 받는다.

이다.

OMA는 runtime security 영역에서는 이미 다음 원칙을 강하게 사용한다.

> actor에게 전체 시스템 권한을 주지 않고 필요한 capability만 준다.

동일한 원칙을 module dependency에도 적용할 필요가 있다.

---

### 3.4 Closed protocol과 dispatch implementation 사이에 마지막 gap이 있다

PUBLIC_METHODS는 closed method set과 metadata를 강하게 연결한다.

method를 추가하면 mode, key policy, stream policy, capability, authority rule, params validator가 함께 정의되어야 한다.

하지만 실제 execution은 PublicDispatcher의 별도 switch(method)에 있다.

현재 switch의 마지막은:

```ts
default:
  return UNKNOWN_METHOD
```

이다.

그러나 이 시점의 method는 이미 isPublicMethod()를 통과한 값이다.

따라서 semantic하게는 default가 존재할 이유가 없다.

현재 구조에서는:

```text
PublicMethods
   =
PUBLIC_METHODS descriptor
```

는 강하게 검사되지만,

```text
PublicMethods
   =
actual public handlers
```

는 동일한 강도로 compile-time closure가 걸려 있지 않다.

Internal dispatcher에도 같은 형태가 존재한다.

또한 validation 이후에도 params가 Record<string, unknown>으로 축약되어 각 case 안에서:

```ts
as { ... }
as never
as unknown as ...
```

형태의 재 narrowing이 필요하다.

즉 validation은 성공했지만 그 validation fact를 type system이 끝까지 보존하지 못한다.

---

### 3.5 Port declaration과 implementation conformance가 같은 파일에 있다

src/module-ports.ts는 StorePort, SyncUnitsPort, DerivedViewsPort, ReconcilePort, SandboxPort 등의 명확한 내부 boundary를 정의한다.

그러나 같은 파일이 다시:

- StoreImplementation
- UnitsImplementation
- ViewsImplementation
- ReconcileImplementation
- RunnerImplementation
- SandboxImplementation

을 import하고 ActualModuleConformance를 계산한다.

그 결과 current graph에는 module-ports.ts에서 상위 implementation으로 향하는 여러 type-only upward edge가 존재한다.

runtime dependency는 아니므로 즉각적인 correctness 문제는 아니다.

하지만 conceptual ownership 측면에서는:

> port declaration + implementation knowledge

가 하나의 파일에 들어 있다.

이 둘은 분리할 가치가 있다.

---

### 3.6 Architecture checker 자체가 새로운 critical subsystem이 되었다

현재 architecture-check.mjs는 단순 lint가 아니다.

이 파일은 다음을 판단한다.

- effect owner
- transaction closure
- runtime import closure
- schema duplication
- request identity construction
- persisted JSON narrowing
- runtime SCC
- dependency lattice
- contract exhaustiveness
- baseline exception validity
- evidence freshness

즉 architecture checker의 false negative는 실제 architecture violation을 PASS로 만들 수 있다.

이미 이전 단계에서 Tarjan SCC 구현 결함으로 cycle을 찾지 못하는 false PASS가 실제로 발생했고, 수정 후 숨겨져 있던 cycle이 발견된 전례가 있다.

현재 HEAD에서도 normative self-audit를 통해 weakened oracle과 mirror exemption을 다시 강화했다.

이는 checker를 더 복잡하게 만들지 말아야 한다는 뜻이 아니라:

> checker도 production correctness mechanism에 준하는 독립 oracle을 가져야 한다.

는 뜻이다.

---

## 4. 제안하는 목표 구조

전체 구조를 완전히 다시 계층화하지 않는다.

현재 L0–L5를 유지하되 L1 내부만 더 명확히 표현한다.

개념적 목표는 다음과 같다.

```text
L5 Entry / Composition
        |
L4 Orchestration
        |
L3 Workflow
        |
L2 Facts / Observation
        |
+-----------------------------+
| Kernel internal structure   |
|                             |
| K3 Durable owner            |
|       |                     |
| K2 Effect mechanisms        |
|       |                     |
| K1 Codec / protocol values  |
|       |                     |
| K0 Pure semantic values     |
+-----------------------------+
        |
Normative contracts
```

단, 이 그림을 즉시 directory rule로 강제하지 않는다.

먼저 실제 L1 edge를 측정하고 각 파일을 semantic zone에 분류한 뒤, 현재 legitimate edge와 accidental edge를 검토하여 DAG를 확정한다.

즉 기존 P5와 달리 이번에는:

> 현재 graph가 허용하는 최소 structure

가 아니라:

> 현재 graph를 측정한 뒤 owner semantics로 정당화할 수 있는 structure

를 만든다.

---

## 5. P10 — Architecture evidence source universe 통일

### 목적

Architecture gate와 checked-in dependency evidence가 정확히 동일한 production Program을 보게 한다.

### 변경안

dependency-graph.mjs에서 architecture용 graph의 canonical source를 하나로 만든다.

예:

```text
createArchitectureProgram()
        |
        v
graphFromProgram()
        |
        +--> lattice enforcement
        |
        +--> checked-in evidence
```

반면 runtime packaging closure는 현재처럼 별도 개념으로 유지한다.

```text
runtime entry roots
    +
production-files.txt
        |
runtimeImportClosure()
```

두 graph의 역할을 명시적으로 구분한다.

### Architecture graph

포함:

- runtime source
- type-only contract leaves
- compatibility type bridge
- all production TypeScript Program closure

사용 목적:

- layer
- type edge
- runtime edge
- SCC
- fan-in/out
- architecture evidence

### Runtime package graph

포함:

- 실제 runtime entrypoint에서 reachable한 runtime import

사용 목적:

- package completeness
- test import 방지
- runtime manifest 검증

둘을 하나로 합치지 않는다.

### Acceptance criteria

- evidence generator와 architecture lattice enforcement가 동일한 graphFromProgram() 결과를 사용한다.
- implementation/contracts/*.ts leaf가 architecture evidence에 나타난다.
- architecture evidence source set과 analyzer source set의 identity가 동일함을 테스트한다.
- root include에 없는 type-only imported production file도 evidence에서 빠지지 않는다.
- runtime package inventory의 의미는 변경하지 않는다.
- wire/DB/runtime semantics 변경 없음.

### 필요한 regression test

fixture:

```text
root.ts
  import type -> leaf.ts
```

에서 leaf.ts가:

- architecture graph: 포함
- runtime closure: 제외 가능

임을 동시에 고정한다.

---

## 6. P11 — Public/Internal dispatch closure 강화

### 목적

이미 closed-world인 protocol definition을 actual handler implementation까지 닫는다.

### 1단계: unreachable default 제거

validated PublicMethod switch의 마지막은:

```ts
default:
  return assertNever(method);
```

형태가 되어야 한다.

Unknown method는 이미 validation 단계에서 처리된다.

Internal method도 동일하게 적용한다.

이렇게 하면 새 method가 contract와 descriptor에 추가됐는데 handler case를 추가하지 않은 변경은 TypeScript compile 단계에서 실패한다.

### 2단계: validation fact의 type 보존

현재 validation 결과:

```ts
{
  method: PublicMethod;
  params: Record<string, unknown>;
}
```

대신 method별 discriminated union을 만든다.

개념적으로:

```ts
type ValidatedPublicCall = {
  [M in PublicMethod]: {
    method: M;
    params: PublicMethods[M]["params"];
    descriptor: typeof PUBLIC_METHODS[M];
    ...
  }
}[PublicMethod];
```

그러면:

```ts
switch (call.method)
```

안에서 call.params 역시 해당 method의 정확한 params type으로 좁혀진다.

목표는 dispatcher에서 다음을 제거하는 것이다.

```ts
params as never
params as { ... }
params as unknown as ...
```

### Acceptance criteria

- valid-method switch의 default UNKNOWN_METHOD 제거.
- public/internal dispatch가 compile-time exhaustive.
- method validation 성공 후 handler가 params를 다시 assertion-cast하지 않음.
- protocol error precedence는 기존과 동일.
- stream preflight와 dispatch의 시간적 revalidation semantics는 변경하지 않음.
- authorization을 한 번만 실행하도록 합치지 않음.

---

## 7. P12 — Consumer-shaped capability ports

### 목적

Concrete owner를 분해하는 것이 아니라 consumer가 볼 수 있는 권한 surface를 줄인다.

가장 먼저 적용할 대상은 PublicDispatcher와 InternalDispatcher다.

현재:

```text
PublicDispatcher
 ├─ Store
 ├─ MailModule
 ├─ UnitsModule
 ├─ ViewsModule
 ├─ LifecycleModule
 └─ GitModule
```

목표:

```text
PublicDispatcher
 ├─ AuthorityReadPort
 ├─ OperationReceiptPort
 ├─ MailCommandPort
 ├─ LifecycleCommandPort
 ├─ GitPublicPort
 ├─ StatusReadPort
 └─ LogReadPort
```

중요한 점은 새 service class를 일곱 개 만들자는 뜻이 아니다.

Structural typing과 composition projection을 사용한다.

```text
real Store/Mail/Git/Lifecycle
          |
          | composition root projection
          v
small typed capability object
          |
          v
PublicDispatcher
```

Port는 consumer가 소유한다.

즉 PublicDispatcher에 필요한 port라면 broker 영역에서 정의하고, GitModule이 broker port를 import하게 만들지 않는다.

예시:

```ts
interface MailCommandPort {
  send(...): Promise<Receipt>;
}
interface LifecycleCommandPort {
  create(...): Promise<Receipt>;
  start(...): Receipt;
  stop(...): Receipt;
  ack(...): Receipt;
  follow(...): Receipt;
}
```

Git 또한 dispatcher가 실제 사용하는 method만 노출한다.

- knownRefs
- isPublished
- submit
- integrate
- publishContext

reconcile, context repair 등 public dispatcher가 사용하지 않는 capability는 보이지 않아야 한다.

### InternalDispatcher

동일하게:

- InternalLedgerView
- BatchCommandPort
- RunnerIdentityPort
- ReconcilePort

정도로 분리한다.

단순 Pick<ConcreteModule, ...>을 port 정의로 사용하면 concrete implementation dependency가 그대로 남으므로 장기적으로는 명시 interface를 선호한다.

### 적용 범위 제한

이 패턴을 모든 class에 기계적으로 적용하지 않는다.

다음 조건을 만족하는 boundary를 우선한다.

- 다수의 owner를 조합하는 consumer
- 외부 trust boundary와 인접
- 현재 concrete dependency가 넓음
- 잘못된 method 접근이 safety 의미를 가질 수 있음

따라서 PublicDispatcher, InternalDispatcher가 우선이고, MailModule이나 모든 coordinator를 즉시 port화하지 않는다.

### Acceptance criteria

- public-dispatcher.ts가 Store/Mail/Units/Views/Lifecycle/Git concrete class를 import하지 않는다.
- internal-dispatcher.ts도 동일 원칙을 따른다.
- composition root에서만 concrete → port projection이 일어난다.
- port를 도입하면서 새 runtime service, new state, new effect를 만들지 않는다.
- current authority check 위치와 effect ordering은 변경하지 않는다.

---

## 8. P13 — L1 kernel semantic sub-lattice

### 목적

현재의 coarse L1-kernel 안에서 의미 없는 dependency가 증가하는 것을 방지한다.

현재 L1 68개 파일을 바로 여러 physical directory로 이동하지 않는다.

먼저 zone classification + evidence를 추가한다.

### 후보 zone

#### K0 — pure semantic/value

예:

- domain pure values
- identifier grammar
- canonical value construction
- pure validation primitives

원칙:

- external effect 없음
- Store 없음
- process 없음
- filesystem 없음
- workflow 없음

#### K1 — codec / protocol representation

예:

- protocol codecs
- frame
- wire descriptor
- mail header/address/fact codec
- cache codec

원칙:

- K0 의존 가능
- effect owner 의존 금지
- Store 의존 금지

protocol/channel.ts의 node:net 같은 이미 명시된 exact transport owner는 별도 mechanism classification 또는 exact exception으로 둔다.

#### K2 — effect mechanism

예:

- process/*
- durable filesystem primitive
- filesystem storage primitive
- protocol transport
- host/config loading mechanism

이 레이어는 effect를 수행할 수 있지만 workflow decision을 소유해서는 안 된다.

#### K3 — durable ledger owner

예:

- Store
- transaction scope
- ledger reader
- operation journal
- transitions
- rows/operation codec

SQLite writer ownership은 계속 단 하나다.

### 구현 순서

#### P13-A: 측정만 한다

kernel-zones evidence를 만든다.

- zone별 file
- runtime matrix
- type-only matrix
- cross-zone edge
- SCC

이 단계에서는 gate를 추가하지 않는다.

#### P13-B: 실제 edge review

모든 cross-zone runtime edge를 다음 세 종류로 분류한다.

- required
- misplaced responsibility
- accidental convenience dependency

#### P13-C: 금지 방향 확정

review 후에만 architecture gate로 승격한다.

최소한 다음은 명시적으로 금지하는 것이 바람직하다.

- pure semantics -> Store/effect mechanism
- codec -> Store/workflow
- process mechanism -> workflow/orchestration
- storage primitive -> workflow/orchestration

현재 coarse lattice가 이미 막는 항목과 중복되더라도, kernel 의미 자체를 문서화한다는 가치가 있다.

### 중요 원칙

현재 P5는 “현재 graph를 freeze”하는 성격이었다.

P13은 그렇게 해서는 안 된다.

현재 edge가 있다는 이유만으로 새 semantic rule에서 허용하지 않는다.

각 방향은 owner semantics로 설명 가능해야 한다.

### Acceptance criteria

- 모든 L1 file이 정확히 하나의 kernel zone에 속한다.
- zone 밖 새 파일은 fail.
- runtime zone graph가 명시적 DAG다.
- exception은 broad prefix가 아니라 exact owner/edge 수준이어야 한다.
- SQLite owner 수는 증가하지 않는다.
- existing Store/facet type-only SCC는 별도 검토하되 숫자상 cycle 제거를 목적으로 schema를 복제하지 않는다.

---

## 9. P14 — Port declaration과 conformance 분리

### 목적

src/module-ports.ts를 실제 boundary declaration으로 순화한다.

현재 이 파일은 port를 선언하면서 concrete implementation까지 import한다.

이를 두 책임으로 분리한다.

```text
module-ports
    = boundary declaration
module conformance
    = implementation이 boundary를 만족하는지 검증
```

### 1단계

ActualModuleConformance를 module-ports.ts 밖으로 이동한다.

### 2단계

module-ports.ts가 concrete top-level module을 type import해야 하는 이유를 하나씩 제거한다.

예를 들어 현재:

```text
OperationRow / Transaction -> Store를 통해 import
UnitObserve              -> ViewsModule 파일
SandboxHost              -> Sandbox implementation
```

처럼 boundary value와 implementation location이 섞인 부분을 검토한다.

가능하면 type의 authoritative owner로 직접 이동시킨다.

다만 이를 위해 새로운 duplicate DTO를 만들지는 않는다.

### 선택 가능한 conformance 방식

우선순위는 다음과 같다.

1. implementation 자체의 implements

   dependency 방향이 자연스럽다면 가장 단순하다.

2. 별도의 compile-only conformance module

   실제 class와 port를 함께 import해 typecheck만 수행한다.

3. 현재 같은 중앙 conformance type

   가장 마지막 선택이다.

목표는:

> port가 implementation을 아는 구조

에서:

> implementation 또는 composition verification이 port를 아는 구조

로 이동하는 것이다.

### Acceptance criteria

- module-ports.ts에 top-level concrete implementation imports가 남지 않는다.
- implementation conformance는 pinned TypeScript typecheck에서 계속 강제된다.
- module compatibility facade는 유지한다.
- wire/persisted contract에 내부 implementation type을 새로 노출하지 않는다.

---

## 10. P15 — Architecture checker hardening

### 목적

Architecture checker 자체를 신뢰 가능한 작은 verification system으로 만든다.

### 10.1 SCC independent oracle

Tarjan implementation과 독립적인 단순 reference SCC 구현을 test 전용으로 둔다.

작은 random directed graph를 생성해:

```text
production SCC implementation
==
reference SCC implementation
```

을 property-test한다.

한 구현을 다른 구현으로 다시 테스트하는 것이 아니라 서로 다른 알고리즘을 사용한다.

이는 과거 false PASS 유형을 직접 방어한다.

---

### 10.2 Rule-family mutation fixtures

각 architecture rule family에 최소 하나의:

- positive control
- single violation
- semantically equivalent syntax variation

을 둔다.

예:

#### transaction effect

- direct call
- imported alias
- local function
- local alias

#### identifier mirror

- exact mirror
- divergent mirror

#### runtime import

- direct import
- re-export
- dynamic literal
- nonliteral dynamic

현재 checker가 이미 일부를 수행하므로 새 framework를 만들 필요는 없다.

빠진 rule family만 보강한다.

---

### 10.3 Checker 구조 분리

검증을 충분히 확보한 후에만 architecture-check.mjs를 책임별로 분리한다.

예:

```text
architecture/
  program.mjs
  ast-utils.mjs
  import-rules.mjs
  owner-rules.mjs
  transaction-rules.mjs
  contract-rules.mjs
  lattice-rules.mjs
```

분리 자체와 semantics 변경을 같은 commit에서 하지 않는다.

현재 하나의 큰 analyzer를 무조건 잘게 쪼개는 것이 목표가 아니라:

- rule owner가 명확하고
- 각 rule을 독립 테스트할 수 있는 상태

가 목표다.

---

### 10.4 Evidence consistency self-check

Architecture checker 실행 시 다음 관계를 assertion한다.

```text
architecture evidence source set
==
architecture analyzer production source set
```

이 관계가 깨지면 다른 architecture finding보다 먼저 실패한다.

---

### 10.5 Baseline 정책 유지

현재 source hash + snippet hash에 묶인 exact exception 정책은 유지한다.

Broad wildcard exception이나 line-only suppression은 도입하지 않는다.

---

## 11. 최종 목표 dependency 형태

이번 제안 이후의 핵심 구조는 다음과 같아야 한다.

```text
                         ┌──────────────────┐
                         │ Entry/Composition │
                         └─────────┬────────┘
                                   │ concrete wiring
                      ┌────────────┴────────────┐
                      │                         │
              Public Dispatcher        Internal Dispatcher
                      │                         │
               narrow capability ports only
                      │
        ┌─────────────┼──────────────────┐
        │             │                  │
      Mail         Lifecycle            Git
        │             │                  │
        └─────────────┼──────────────────┘
                      │
                durable Store
                      │
        ┌─────────────┴──────────────┐
        │                            │
  storage mechanisms            pure/kernel values
```

여기서 가장 중요한 변화는 box 숫자가 아니다.

현재:

> consumer -> owner 전체

관계를:

> consumer -> 필요한 capability

로 바꾸는 것이다.

---

## 12. 파일 단위 예상 변경 범위

| 파일/영역 | 제안 |
|---|---|
| scripts/dependency-graph.mjs | architecture graph를 Program closure 기준으로 통일 |
| scripts/architecture-check.mjs | 동일 graph를 enforcement/evidence에 재사용 |
| scripts/dependency-lattice.mjs | 기존 L0–L5 유지 + 추후 kernel zone enforcement 연결 |
| docs/.../p5-dependency-graph.json | full Program 기준으로 재생성 |
| src/broker/public-dispatcher.ts | typed validated call + exhaustive dispatch + narrow ports |
| src/broker/internal-dispatcher.ts | 동일 |
| src/broker/*ports*.ts | consumer-owned capability declaration |
| src/broker.ts / src/entry/broker.ts | concrete → capability projection |
| src/module-ports.ts | declaration-only 방향으로 정리 |
| conformance 위치 | concrete implementation knowledge 이동 |
| architecture checker tests | SCC differential oracle, source-universe fixture, handler closure fixture |
| dependency evidence | kernel-zone matrix 추가 |

---

## 13. 구현 순서

변경 순서는 다음을 권고한다.

### 1순위 — P10

#### evidence source universe 통일

이게 먼저다.

측정기가 정확하지 않은 상태에서 새 dependency rule을 만드는 것은 피한다.

---

### 2순위 — P11

#### dispatch exhaustiveness + typed validation

behavior change 없이 높은 안전성 효과를 얻을 수 있고 범위도 좁다.

---

### 3순위 — P12

#### dispatcher capability ports

현재 가장 명확한 concrete-coupling hotspot을 줄인다.

---

### 4순위 — P13

#### L1 semantic sub-lattice

측정과 review가 필요하므로 앞 단계보다 큰 작업이다.

---

### 5순위 — P14

#### port/conformance ownership 정리

P13의 kernel zone이 결정된 뒤 수행하는 것이 import direction을 판단하기 쉽다.

---

### 6순위 — P15

#### checker decomposition + independent oracle 확대

단, P10의 source-set consistency test와 SCC reference test는 더 일찍 추가해도 된다.

Checker 파일 자체의 구조 분리는 마지막에 한다.

---

## 14. 각 단계의 변경 규율

각 단계는 다음 원칙을 따라야 한다.

### 하나의 commit에서 architecture와 behavior를 동시에 바꾸지 않는다

예:

- port 도입 + error precedence 변경 금지.
- dispatch union typing + method semantics 변경 금지.

### 기존 owner rule을 완화해서 migration을 통과시키지 않는다

새 구조가 checker에 걸린다면 먼저:

- 구조가 틀린가?
- checker가 실제로 과도한가?

를 판단한다.

편의를 위해 owner list를 넓히는 것을 기본 해법으로 사용하지 않는다.

### 새 abstraction은 제거하는 knowledge가 있어야 한다

새 interface/file 하나가 생길 때:

- 어떤 dependency knowledge를 제거했는가?
- 어떤 잘못된 접근을 compile-time에 불가능하게 했는가?

에 답할 수 있어야 한다.

단순 forwarding layer는 만들지 않는다.

---

## 15. 전체 완료 조건

본 제안의 완료를 다음 상태로 정의한다.

1. Architecture evidence와 analyzer가 동일한 Program source set을 사용한다.
2. Public/Internal method handler set이 compile-time exhaustive하다.
3. Validated request의 method-param relation이 handler까지 type으로 유지된다.
4. Public/Internal dispatcher가 concrete subsystem class를 직접 의존하지 않는다.
5. L1 내부 파일이 semantic kernel zone으로 분류된다.
6. Kernel zone의 금지 runtime dependency가 machine-enforced 된다.
7. module-ports declaration이 concrete implementation knowledge를 소유하지 않는다.
8. Architecture checker SCC가 independent test oracle과 대조된다.
9. 기존 single writer / durable intent / recovery semantics / authority revalidation / persisted formats는 변경되지 않는다.
10. 새 architecture exception을 broad allowlist 방식으로 만들지 않는다.

---

## 16. 기대 효과

이 작업의 목적은 dependency line 수를 줄이는 것이 아니다.

다음 변화가 핵심이다.

현재:

> 올바른 architecture를 개발자가 알고 있어야 한다.

목표:

> 잘못된 architecture를 작성하려 하면 type system / architecture gate가 먼저 막는다.

현재 OMA는 이미 operation durability와 recovery 영역에서는 이 수준에 상당히 근접해 있다.

다음 단계에서는 동일한 discipline을:

- module dependency
- consumer capability
- protocol implementation
- architecture evidence

에 적용한다.

이 작업이 완료되면 OMA의 구조는 단순히 “runtime cycle이 없는 modular monolith”가 아니라:

> 권한이 좁고, owner가 명확하며, dependency topology와 실행 contract가 서로 검증되는 safety-oriented modular runtime

으로 한 단계 정제된다.

---

## 17. 최종 권고

현재 OMA v2에 필요한 것은 대규모 rewrite가 아니다.

우선순위는 다음 네 문장으로 요약할 수 있다.

1. 먼저 측정의 정확성을 고친다.
2. 그 다음 handler closure를 닫는다.
3. 그 다음 모듈 사이에 전체 객체가 아니라 capability를 전달한다.
4. 마지막으로 coarse kernel 내부의 semantic dependency를 강제한다.

특히 이번 단계에서 가장 피해야 할 것은 “architecture 개선”이라는 명목으로 interface, repository, service class를 대량 추가하는 것이다.

OMA의 다음 architecture 개선은 abstraction의 개수를 늘리는 작업이 아니라:

> 각 코드가 알 필요가 없는 것을 더 이상 알 수 없게 만드는 작업

이어야 한다.
