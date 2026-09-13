# OMA v2 안정성 보존형 아키텍처 개선 제안서

## 0. 문서 성격

이 문서는 OMA v2의 현재 architecture/spec을 대체하는 새로운 규범이 아니다.

목적은 현재의 강점인:

```text
single broker
single SQLite writer
durable accepted intent
immutable evidence
explicit unknown
normal/recovery separation
incarnation/cgroup fencing
bounded external effects
fail-closed OPEN gates

```

를 그대로 보존하면서, 앞으로 코드가 커질 때 발생할 **shared-contract 비대화, change amplification, conceptual dependency cycle, duplicated dispatch validation, format 진화 비용**을 줄이는 것이다.

따라서 이 제안의 기본 철학은 다음과 같다.

> 현재 OMA를 새 architecture로 갈아엎는 것이 아니라, 이미 존재하는 좋은 architecture의 “kernel”을 더 명확하게 만든다.

현재 OMA는 아키텍처가 부족해서 구조를 다시 짜야 하는 코드베이스가 아니다.

오히려:

> **강한 safety-oriented modular monolith에서, 작은 systems substrate로 진화할 준비가 된 상태**

에 가깝다.

---

# 1. 현재 상태에서 확인되는 실제 구조적 과제

## 1.1 `implementation/contracts.ts`의 책임 밀도가 너무 높다

현재 `implementation/contracts.ts`에는 동시에 다음이 들어 있다.

```text
primitive aliases
ErrorCode / Failure
OperationResult / Receipt
public wire DTO
internal wire DTO
AuthContext
AgentStatus
RunLease / batch boundary
inference DTO
module interface
persisted MessagePlan
persisted OperationPlan
resource/protocol/config types

```

또한 기본 identity 타입도 여전히:

```ts
type Actor = string;
type Oid = string;
type OperationId = string;
type MessageId = string;
type BatchId = string;
type RequestKey = string;

```

형태다.

더 중요한 점은 `contracts.ts`가 `src/module-ports.ts`를 type import하고, 반대로 `module-ports.ts`가 `contracts.ts`의 타입을 import한다는 것이다. runtime cycle은 아니지만 conceptual/type dependency가 양방향이다.

현재 단계에서 가장 큰 architecture debt 중 하나다.

다만 해결 방법은 `contracts.ts`를 삭제하는 것이 아니다.

---

## 1.2 operation closed-world 검사가 개수 자체를 알고 있다

현재 architecture checker는 `OperationPlan` kind 집합과 codec registry를 비교하면서 동시에:

```js
kinds.size !== 11

```

을 별도 오류로 취급한다.

OMA에서 closed operation set을 강하게 검사하는 것은 좋은 정책이다.

하지만 architecture checker가 **현재 operation 종류의 숫자**까지 알아야 할 이유는 없다.

필요한 invariant는:

```text
OperationPlan kinds
=
Operation codec registry keys
=
각 kind의 plan/result/relation validation coverage

```

이다.

11이라는 숫자는 본질적 architecture invariant가 아니다.

---

## 1.3 PublicDispatcher의 validation이 두 경로에 중복된다

현재 stream preflight와 실제 dispatch가 각각 다음을 검사한다.

```text
envelope shape
version
method
request key
current actor/incarnation
capability
params
admission

```

일부 의미 차이는 의도적이다. preflight는 큰 body를 받기 전에 거절해야 하기 때문이다.

하지만 실제 구현은 상당량의 validation logic을 두 경로에서 각각 다시 작성하고 있다.

이 구조는 장기적으로:

```text
preflight accepts
dispatch rejects

```

또는 그 반대의 semantic drift가 발생할 수 있는 seam이다.

여기서 중요한 것은 두 검사를 한 번만 하자는 것이 아니다.

**시간적으로 다시 검사해야 하는 authorization은 계속 두 번 검사하되, “검사 규칙 구현”을 하나로 만든다.**

---

## 1.4 composition root에 작은 temporal dependency가 존재한다

현재 broker entry는:

```ts
let contextOwner: GitModule | null = null;
const hasGoal = () => contextOwner?.hasCommittedContext() ?? false;

const lifecycle = new LifecycleModule(... hasGoal ...);

const git = new GitModule(...);

contextOwner = git;

```

순서다.

현재 `GitModule` 생성에는 Lifecycle이 필요하지 않는다.

따라서 이 mutable late binding은 제거할 수 있다.

심각한 버그는 아니지만, 이런 패턴이 늘어나면 composition root가 dependency cycle을 수동으로 해결하는 장소가 된다.

---

## 1.5 Operation kernel은 이미 반쯤 존재한다

새로운 `OperationJournal`을 처음부터 발명할 필요는 없다.

현재 이미:

```text
LedgerReader
OperationTransitions
TransactionScope
operation-codec
Store claim/accept wrappers

```

가 operation durability의 핵심 mechanism을 상당 부분 소유한다.

특히 `OperationTransitions`는:

```text
insert
unaccepted plan update
succeed
fail
unknown
terminal immutability
preaccept-only failure rejection
result relation validation

```

을 중앙에서 강제한다.

즉 앞으로 해야 하는 것은 새로운 workflow framework 추가가 아니라:

> **이미 존재하는 operation durability mechanism을 명확한 kernel boundary로 승격하는 것**

이다.

---

## 1.6 durable format은 현재 host path와 강하게 결합돼 있다

v1 `OperationPlan`에는 현재 실제로 다음 값이 durable하게 저장된다.

```text
agent.create.workspacePath
git.submit.bundle.path
context.publish.stagingPath

```

그리고 read-time relation validator가 현재 `stateRoot`와 이 path의 exact 관계를 검사한다.

이 설계는 현재 crash/recovery integrity에는 강하다.

반면 state directory portability에는 약하다.

하지만 이것은 **지금 당장 삭제할 필드가 아니다.**

이미 persisted v1 semantics이므로 일반 refactoring으로 제거하면 안 된다.

이 문제는 별도의 **format evolution 프로젝트**로 다뤄야 한다.

---

## 1.7 architecture enforcement는 강하지만 파일별 정책이 늘어날 위험이 있다

현재 checker는 이미:

```text
capability owner
resource owner
limit owner
identifier owner
method owner
request identity owner
SQLite owner
subprocess owner
protocol I/O exception

```

을 구체적으로 관리한다. 현재 raw SQLite owner는 `src/store.ts` 하나이며 subprocess owner도 좁게 제한된다.

이 방향은 좋다.

그러나 앞으로 owner가 계속 늘어나면 architecture checker가:

```text
특수 파일 A 허용
특수 파일 B 허용
특수 파일 C 예외

```

형태로 성장할 가능성이 있다.

장기적으로는 파일별 규칙 위에 **작은 dependency lattice**가 하나 더 필요하다.

---

# 2. 개선에서 절대 보존해야 하는 것

다음은 이번 architecture 개선의 대상이 아니다.

### SQLite ownership

SQLite connection과 synchronous transaction ownership을 여러 repository/service 객체로 흩뜨리지 않는다.

### Transaction boundary

transaction 안에:

```text
await
filesystem durability effect
Git
systemctl
provider/network

```

를 넣지 않는다.

### Durable intent와 physical effect 분리

accepted operation과 physical effect를 하나의 generic transaction처럼 숨기지 않는다.

### Recovery

Recovery를 exception handler 또는 normal execute 재호출로 축소하지 않는다.

### Unknown semantics

관찰 실패를 absence/success/dead/zero로 변환하지 않는다.

### Deployment

single-broker modular monolith를 유지한다.

Microservice 분해는 개선 방향이 아니다.

### Ports

모든 class마다 interface를 만들지 않는다.

실제 effect 또는 trust boundary가 있는 지점에만 narrow port를 둔다.

### OPEN gate

S-01-CANDIDATE, S-02, S-03, S-04 등의 미확정 adapter를 architecture 정리 과정에서 임의 구현하지 않는다.

---

# 3. 권장 개선 순서

개선은 다음 순서를 권장한다.

```text
P0  verification baseline 복구
 ↓
P1  low-risk semantic entropy 제거
 ↓
P2  contracts ownership 분해
 ↓
P3  operation kernel 명시화
 ↓
P4  Store/SQLite subsystem 정리
 ↓
P5  dependency lattice
 ↓
P6  independent integrity diagnostics
 ↓
P7  filesystem fault model
 ↓
P8  persisted format evolution
 ↓
P9  VM power-cut / long-running maturity

```

P0\~P5는 architecture 개선이다.

P6\~P9는 systems-project maturity 개선이다.

둘을 한 번에 진행하지 않는다.

---

# 4. P0 — 먼저 verification baseline을 복구한다

## 목적

architecture refactor를 시작하기 전에 현재 repository가 무엇을 실제로 검증하고 있는지 다시 고정한다.

현재 validation 기록 자체가 다음을 명시한다.

```text
typecheck/build/test/package/architecture/transaction: NOT_RUN
inventory/LOC/hash generator: NOT_RUN
production-files.txt: STALE
production-loc*: STALE

```

실제로 `production-manifest.json`은 `src` 전체를 production input으로 정의하지만, 체크인된 `production-files.txt`에는 최근 생성된 `src/broker/*`, `src/storage/*`, `src/git/*` 등의 파일이 포함되지 않는다.

## 먼저 할 일

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test

```

환경이 허용하면 이후:

```text
fast
durable
property
kernel
crash
stress
all

```

lane을 실행한다.

## 중요한 원칙

P1 이후 architecture refactor의 before/after를 비교하려면 **P0의 fresh baseline이 필요하다.**

따라서 production-files를 사람이 직접 편집해서 green으로 만들지 않는다.

## 완료 조건

```text
fresh production inventory
fresh source hashes
current HEAD typecheck result
current architecture result
current test result
각 native lane의 PASS/BLOCKED 명확한 분리

```

가 존재한다.

---

# 5. P1 — 가장 먼저 적용할 low-risk 구조 개선

이 단계는 persisted format이나 public contract를 바꾸지 않는다.

## P1-1. hard-coded operation count 제거

현재:

```js
if (kinds.size !== 11 || !registry)

```

를 제거한다.

대신 다음만 강제한다.

```text
OperationPlan kind set
==
OPERATION_CODECS key set

```

그리고 각 registry entry에:

```text
planCheck
resultCheck
relationsCheck

```

가 존재해야 한다는 기존 검사를 유지한다.

가능하면 TypeScript 레벨에서도:

```ts
satisfies Record<MutationMethod, OperationCodec>

```

형태를 canonical protection으로 둔다.

### 효과

operation 추가 시:

```text
"11을 12로 바꾸는 것"

```

이 더 이상 architecture 작업이 되지 않는다.

새 kind가 registry에서 빠지면 type/static check가 실패한다.

### 위험

매우 낮음.

### 완료 조건

새 dummy operation kind를 compile fixture에서 추가했을 때:

- registry 미추가 → 실패
- registry 추가 → operation 개수와 무관하게 통과

해야 한다.

---

## P1-2. broker composition root temporal coupling 제거

현재:

```text
Lifecycle 생성
→ mutable contextOwner
→ Git 생성
→ contextOwner 할당

```

을 다음처럼 단순화한다.

```text
Store
→ Mail
→ Units / Views
→ Git
→ hasGoal = () => git.hasCommittedContext()
→ Lifecycle
→ Reconcile
→ Broker

```

현재 Git constructor는 Lifecycle을 요구하지 않으므로 이것이 가능하다.

새 interface도 필요 없다.

### 효과

`contextOwner: GitModule | null` 제거.

초기화 순서가 실제 dependency graph와 일치한다.

### 위험

낮음.

### 완료 조건

composition root에 mutable late-binding dependency가 사라지고 startup/recovery ordering tests가 그대로 유지된다.

---

## P1-3. PublicDispatcher validation owner 단일화

현재 preflight와 dispatch가 같은 규칙을 각각 구현한다.

개선 목표는:

```text
같은 validation 구현
+
서로 다른 시간의 re-check

```

다.

권장 구조:

```ts
decodePublicEnvelope(...)
authorizePublicRequest(...)
validateStreamPolicy(...)

```

또는:

```ts
validatePublicRequest(
  auth,
  raw,
  phase: "stream-preflight" | "dispatch"
)

```

형태다.

다만 **preflight 결과를 body 수신 뒤 그대로 신뢰하면 안 된다.**

dispatch에서는 다시 현재:

```text
actor incarnation
desired
capability
admission state

```

를 읽어야 한다.

즉:

```text
검사 코드 공유
!=
검사 결과 재사용

```

이다.

### 효과

version/key/params/capability rule drift 감소.

### 위험

낮음\~중간.

### 필수 negative test

한 validation rule을 의도적으로 변형했을 때 preflight/dispatch 양쪽이 동시에 영향을 받아야 한다.

또한:

```text
preflight 성공
→ actor stop/revoke
→ body 완료
→ dispatch 거절

```

case가 반드시 유지되어야 한다.

---

# 6. P2 — `contracts.ts`를 facade로 낮춘다

이 단계가 architecture 측면에서 가장 큰 개선이다.

하지만 production owner를 바로 `src/`로 옮기기보다 **현재 규범 파일 경계를 보존한 채 먼저 물리적으로 분리하는 방식**을 권장한다.

## 권장 구조

```text
implementation/
  contracts.ts                 # compatibility/spec facade

  contracts/
    identity.ts                # Actor/Oid/IDs/basic JSON
    errors.ts                  # ErrorCode/Failure
    public-wire.ts             # PublicMethods/Request/Response
    internal-wire.ts           # InternalMethods/InternalResults
    durable.ts                 # MessagePlan/OperationPlan/Result
    runtime.ts                 # AuthContext/RunLease/status/batch
    host.ts                    # ResourceLimits/ProtocolLimits/config types

```

그리고:

```ts
// implementation/contracts.ts

export * from "./contracts/identity.js";
export * from "./contracts/errors.js";
export * from "./contracts/public-wire.js";
...

```

형태로 facade를 유지한다.

기존 import는 당장 깨지지 않는다.

---

## P2-1. module-ports cycle부터 제거한다

현재:

```text
contracts.ts
  -> module-ports.ts

module-ports.ts
  -> contracts.ts

```

이다.

분리 후에는:

```text
implementation/contracts.ts
        ↓
src/module-ports.ts
        ↓
implementation/contracts/identity.ts
implementation/contracts/runtime.ts
implementation/contracts/host.ts

```

처럼 만든다.

즉 `module-ports.ts`는 facade `contracts.ts`를 import하지 않는다.

그 결과 facade에서 module port를 re-export하더라도 dependency는 단방향이 된다.

---

## P2-2. production source는 필요한 contract만 import한다

현재 많은 파일이:

```ts
import type {...} from "../../implementation/contracts.js";

```

를 사용한다.

이를 점진적으로:

```text
broker/protocol -> public-wire/runtime
storage        -> durable/identity
units          -> runtime/host
git            -> durable/identity/public-wire

```

처럼 좁힌다.

한 번에 전체 repository import를 바꾸지 않는다.

subsystem별로 한다.

---

## P2-3. wire compatibility를 golden test로 고정한다

contracts 분해 과정에서는 다음이 한 byte도 바뀌면 안 된다.

```text
public method set
internal method set
request/response JSON shape
OperationPlan JSON shape
ErrorCode set
resource/config field

```

따라서 facade와 분리된 owner의 type/schema equivalence를 자동 검사한다.

---

# 7. P2.5 — internal opaque identity를 점진적으로 도입한다

wire format을 branded string으로 바꾸자는 뜻이 아니다.

외부 JSON은 계속 string이다.

권장 구조는:

```text
wire:
  string

boundary decoder:
  string -> ValidatedOperationId

internal:
  ValidatedOperationId

```

이다.

예:

```ts
declare const operationIdBrand: unique symbol;

type ValidatedOperationId =
  string & { readonly [operationIdBrand]: true };

```

우선순위가 높은 대상은:

```text
OperationId
MessageId
BatchId
RequestKey
Oid
ActorName
SocietyName

```

이다.

모든 string을 brand하지 않는다.

특히:

```text
subject
body
profile name
error message
filesystem arbitrary path

```

같은 값까지 brand하는 것은 과도하다.

## 도입 순서

```text
parser return type
→ durable decoder
→ derived identity helpers
→ storage query methods
→ coordinator internals

```

public contracts는 그대로 유지한다.

## 기대 효과

다음과 같은 단순 identity mix-up을 compile-time에서 줄인다.

```text
OperationId를 MessageId 인자에 전달
BatchId와 RequestKey 혼동
validated OID가 필요한 위치에 임의 string 전달

```

---

# 8. P3 — 기존 operation durability를 `OperationJournal` kernel로 승격한다

이 단계의 핵심은 **새 generic workflow engine을 만들지 않는 것**이다.

현재 `OperationTransitions`와 operation decoder가 이미 좋은 mechanism을 갖고 있다.

따라서 새로운 kernel은 기존 코드를 감싸고 ownership을 명확히 하는 수준이어야 한다.

## 목표 책임

개념적으로:

```text
OperationJournal
  get(actor,key)
  getById(id)
  classifyKey(actor,key,hash)
  accept(...)
  succeed(...)
  fail(...)
  markUnknown(...)
  recoverableIds()

```

를 소유한다.

실제 API 이름은 달라도 된다.

Journal이 소유하면 안 되는 것:

```text
Git CAS
mail materialization
systemd start/stop
recipient expansion
policy selection
recovery decision
provider call

```

즉:

```text
Journal = durable operation mechanism
Coordinator = operation policy/effect ordering

```

이다.

---

## P3-1. `OperationRegistry`는 pure metadata만 소유한다

예:

```ts
const OPERATION_REGISTRY = {
  "mail.send": {...},
  "mail.ack": {...},
  ...
} satisfies Record<MutationMethod, OperationDefinition>;

```

여기에 우선 담을 것은:

```text
plan validator
result validator
relation validator

```

정도다.

Recovery 함수 자체를 registry에 넣는 것은 처음에는 권하지 않는다.

그러면 registry가 DI container 또는 generic workflow framework로 변질되기 쉽다.

---

## P3-2. recovery switch는 explicit하게 유지하되 exhaustiveness를 compiler에 맡긴다

현재 Git과 Reconcile에서 kind switch가 존재한다.

이 자체는 문제가 아니다.

중요한 것은 새 operation 추가 시 누락을 compiler가 잡는 것이다.

```ts
switch (operation.kind) {
  ...
  default:
    return assertNever(operation);
}

```

방식으로 바꿔:

```text
새 kind 추가
→ recovery owner 미정
→ compile failure

```

가 되도록 한다.

---

## P3-3. coordinator는 journal transition만 사용한다

현재의:

```text
store.transaction(tx => tx.setOperationSucceeded(...))

```

같은 경로가 완전히 잘못된 것은 아니다.

장기적으로는 operation lifecycle write가 한 vocabulary로 모이도록 한다.

예:

```text
tx.operations.succeed(...)
tx.operations.fail(...)
tx.operations.unknown(...)

```

이런 형태의 내부 facet은 의미가 있다.

단독 DB connection을 가진 Repository 객체를 만드는 것은 의미가 없다.

---

# 9. P4 — Store를 SQLite subsystem으로 발전시킨다

이 단계는 `Store`를 없애는 프로젝트가 아니다.

현재 `Store` facade는 compatibility/composition boundary로 유지한다.

## 목표

```text
Store
 ├─ operations
 ├─ agents
 ├─ subscriptions
 ├─ deliveries
 ├─ batches
 └─ usage

```

와 같이 내부 책임을 명확히 한다.

현재 이미 존재하는:

```text
LedgerReader
LedgerTransitions
OperationTransitions
TransactionScope

```

를 활용한다.

새 SQL을 다시 작성하지 않는다.

---

## 첫 단계

raw `DatabaseSync` owner는 계속 `src/store.ts`에 둔다.

먼저 **logical facet**만 만든다.

이 단계에서는 architecture rule:

```text
sqliteOwners = ["src/store.ts"]

```

를 바꾸지 않는다.

---

## 두 번째 단계

facets가 안정되고 실제 이득이 확인된 뒤에만:

```text
src/storage/sqlite/database.ts

```

등으로 physical SQLite owner를 이동하는 것을 검토한다.

이때도:

```text
DatabaseSync 1개
root TransactionScope 1개
writer 1개

```

를 유지한다.

즉:

```text
SQLite subsystem 확대
!=
SQLite ownership 분산

```

이다.

---

# 10. P5 — architecture checker에 dependency lattice를 추가한다

현재 checker의 세밀한 owner rule은 유지한다.

그 위에 coarse dependency direction을 추가한다.

단, 먼저 **현재 실제 import graph를 측정**한 뒤 결정해야 한다.

임의로 예쁜 layer를 먼저 만들고 코드에 맞추면 안 된다.

## 목표 개념

대략 다음 정도다.

```text
L0  fundamental / pure definitions
        ↓
L1  codecs / storage primitives / process primitives / protocol mechanisms
        ↓
L2  subsystem facts + observations
        ↓
L3  Mail / Git / Lifecycle / Units / Inference workflows
        ↓
L4  Reconcile / Broker / Runner orchestration
        ↓
L5  entry / CLI / extension

```

실제 DAG는 current import graph를 보고 확정한다.

---

## `domain/` 정리는 이 단계 이후에 한다

지금 바로:

```text
domain/foo.ts -> fundamental/foo.ts

```

식으로 파일을 옮기는 것은 우선순위가 아니다.

먼저 semantic owner를 확정한다.

그 뒤:

```text
admission       -> broker
child-policy    -> lifecycle
context-policy  -> git/context
mail-values     -> mail

```

처럼 owner subsystem으로 이동시킨다.

`fundamental`에 들어갈 조건은 엄격하게 둔다.

> effect가 없고, 상위 subsystem을 모르며, 실제로 여러 subsystem이 공유하는 primitive인가?

아니면 subsystem에 둔다.

---

# 11. P6 — `oma fsck`보다 먼저 독립 integrity engine을 만든다

read-only integrity checker 자체는 매우 가치가 크다.

하지만 곧바로 새로운 public CLI surface를 추가하는 것은 권하지 않는다.

현재 public/CLI contract가 닫혀 있기 때문이다.

따라서 첫 단계는:

```text
src/diagnostics/integrity.ts
scripts/check-state.mjs

```

같은 **비제품/관리자 검증 경로**가 적절하다.

## 검사 대상

```text
DB closed-row validation
cross-row operation relation
delivery/message relation
batch manifest relation
usage relation
immutable mail object hash
archive/inbox consistency
published Git ref relation
context snapshot/current relation
agent spec/hash relation

```

가능하면 두 모드로 나눈다.

```text
offline integrity
live observation

```

systemd/cgroup이 필요한 검사는 별도다.

---

## 가장 중요한 원칙

Integrity checker는 **reconcile을 호출하면 안 된다.**

```text
check
!=
repair

```

이어야 한다.

그래야 recovery implementation을 recovery implementation 자신으로 검증하는 문제가 줄어든다.

---

## 나중에 공개 `oma fsck`로 승격

독립 checker가 충분히 안정된 뒤:

```text
OMA CLI에 공개할 가치가 있는가?

```

를 architecture/spec 결정으로 올린다.

즉 `oma fsck` 자체는 좋은 목표지만 일반 refactor에서 CLI method를 즉흥 추가하지 않는다.

---

# 12. P7 — Durable FS를 OMA의 VFS-like fault boundary로 발전시킨다

현재 OMA의 crash semantics를 다음 수준으로 올릴 수 있는 가장 높은 ROI 영역이다.

다만 `FsPort`를 모든 constructor에 주입하는 식으로 만들면 안 된다.

## 올바른 범위

현재의:

```text
storage/durable-fs.ts
storage/immutable-file.ts
storage/context-stream.ts
storage/batch-view.ts

```

같은 low-level durability primitive 주변만 seam을 만든다.

workflow coordinator까지 `FaultFs`를 전달하지 않는다.

---

## deterministic fault point 예

```text
file create 전/후
write 중
file fsync
link/rename 직후
destination validation 전
parent directory fsync
temp unlink
second directory fsync

```

fault injector는:

```text
fail before operation
fail after externally visible operation
return ambiguous observation

```

을 구분해야 한다.

---

## oracle

각 fault point에서:

```text
restart
→ read-only integrity
→ reconcile
→ integrity again

```

을 수행한다.

확인할 핵심:

```text
false success 없음
immutable bytes 변경 없음
duplicate physical effect 없음
unknown이 arbitrary success로 승격되지 않음
same operation identity 유지
reconcile 반복 수렴

```

---

# 13. P8 — persisted format evolution은 별도 프로젝트로 다룬다

`workspacePath`, bundle staging path, context staging path를 durable plan에서 제거하고 싶다는 방향은 장기적으로 타당하다.

하지만 현재 v1에서는 이 값이 accepted relation의 일부다.

따라서 **그냥 삭제하지 않는다.**

## 먼저 format inventory를 만든다

모든 persisted field를 다음으로 분류한다.

| 종류예                           |                                            |
| ----------------------------- | ------------------------------------------ |
| intrinsic identity            | operation ID, actor, candidate OID         |
| immutable logical fact        | recipients, resolved spec, policy revision |
| derived durable identity      | published ref                              |
| host-derived physical locator | workspacePath, stagingPath                 |
| reconstructable presentation  | archive display path                       |
| historical result             | terminal result JSON                       |

---

## 이후 결정

v2를 만든다면:

```text
v1 read compatibility
v1 recovery compatibility
v2 writer format
migration/no-migration policy
backup/restore portability
old binary behavior
unknown version fail-closed behavior

```

를 먼저 설계한다.

Schema user\_version 또는 plan version 변경이 필요하다면 이는 별도 architecture/spec 작업이다.

---

## 절대 금지

```text
기존 v1 row를 현재 path에 맞춰 rewrite
현재 stateRoot 기반으로 accepted bytes 재생성
legacy plan을 새 format으로 silent upgrade

```

---

# 14. P9 — system project maturity 단계

Architecture가 안정된 이후 진행한다.

## VM power-cut lane

Nightly 수준으로:

```text
boot isolated VM
→ scenario 실행
→ exact checkpoint
→ forced power-off
→ reboot
→ integrity check
→ reconcile
→ integrity/model comparison

```

을 구성한다.

현재 SIGKILL crash lane을 대체하지 않는다.

둘은 다른 failure model이다.

---

## persisted-state fuzz

특히 높은 ROI 대상:

```text
plan_json
result_json
agent spec JSON
EML headers
context manifest
Git command output parser
systemd observation parser
cgroup.events
RPC frame

```

oracle은 단순 “crash하지 않음”이 아니다.

```text
invalid input
→ no physical effect
→ no silent repair
→ closed failure / explicit unknown

```

이어야 한다.

---

# 15. 최종 목표 구조

물리 파일 구조를 지금 즉시 아래처럼 바꾸라는 뜻은 아니다.

목표 ownership은 대략 다음과 같다.

```text
                    CLI / Pi
                      │
                 entry/adapters
                      │
             Broker / Runner / Reconcile
                      │
        ┌─────────────┼───────────────┐
        │             │               │
      Mail         Lifecycle         Git
        │             │               │
        └─────────────┼───────────────┘
                      │
                OperationJournal
                      │
        ┌─────────────┼───────────────┐
        │             │               │
     SQLite       Durable FS       Process/OS
        │             │               │
        └─────────────┴───────────────┘
                      │
               fundamental facts

```

여기서 중요한 것은:

```text
Broker가 kernel이 아님
GitModule이 kernel이 아님
Store 전체가 domain kernel이 아님
contracts.ts가 모든 개념의 owner가 아님

```

이라는 것이다.

OMA의 가장 핵심적인 kernel은:

```text
validated identity
+
durable accepted operation
+
immutable relation
+
effect observation
+
safe transition

```

이다.

---

# 16. 구체적인 우선순위

| 우선순위작업효과위험 |                                            |                              |        |
| ---------- | ------------------------------------------ | ---------------------------- | ------ |
| P0         | inventory/test/architecture fresh baseline | 모든 후속 작업의 신뢰성 확보             | 낮음     |
| P1         | hard-coded `11` 제거                         | operation 확장 비용 감소           | 매우 낮음  |
| P1         | `contextOwner` late binding 제거             | composition root 단순화         | 낮음     |
| P1         | PublicDispatcher validation 단일 owner       | protocol drift 감소            | 낮음\~중간 |
| P2         | contracts facade 분해                        | conceptual coupling 크게 감소    | 중간     |
| P2.5       | internal opaque IDs                        | identity mix-up 감소           | 중간     |
| P3         | existing operation mechanism → Journal     | OMA core semantics 명확화       | 중간     |
| P4         | Store logical facets                       | storage change surface 감소    | 중간     |
| P5         | dependency lattice                         | architecture entropy 억제      | 중간     |
| P6         | independent integrity checker              | 운영/복구 진단력 증가                 | 낮음\~중간 |
| P7         | DurableFs fault injection                  | crash correctness 대폭 강화      | 중간     |
| P8         | v1/v2 format evolution                     | 장기 portability/compatibility | 높음     |
| P9         | VM power cut + persisted fuzz              | systems maturity 향상          | 높음     |

---

# 17. 실제 작업 단위는 크게 잡지 않는다

예를 들어 `contracts.ts` 개선은 하나의 거대한 PR로 하면 안 된다.

권장 sequence:

```text
C1 contracts submodule skeleton + facade equivalence
C2 module-ports cycle 제거
C3 public wire import migration
C4 durable import migration
C5 host/config import migration
C6 facade direct production import 금지 rule
C7 opaque internal IDs

```

Operation kernel도:

```text
O1 current transition characterization
O2 hard-coded count 제거
O3 OperationJournal facade
O4 Store call sites migration
O5 recovery exhaustiveness
O6 Store logical facets

```

처럼 나눈다.

각 단계에서 repository는 계속 유효한 상태여야 한다.

---

# 18. 변경 증폭을 실제 metric으로 관리한다

이 구조개편의 성공은 LOC가 줄었는지로 판단하지 않는다.

다음 scenario를 주기적으로 측정한다.

## 새 mutation 하나 추가

현재 필요한 수정 위치와 개선 후 수정 위치를 비교한다.

목표:

```text
kind declaration
registry
effect-specific coordinator
recovery owner
tests

```

외의 unrelated shared file 수정 수가 줄어야 한다.

---

## 새 capability 하나 추가

목표:

```text
canonical owner 한 곳
+
필요한 concrete grant/policy

```

만 수정하고 나머지는 파생되어야 한다.

---

## 새 ID 종류 추가

목표:

```text
grammar/constructor owner
→ decoder

```

가 명확해야 한다.

consumer마다 regex가 생기면 실패다.

---

# 19. Architecture checker의 장기 역할

checker는 점점 많은 버그 패턴을 직접 구현하는 거대한 static analyzer가 되어서는 안 된다.

좋은 checker는 다음 몇 가지를 강하게 증명하면 된다.

```text
dependency direction
single source ownership
effect owner
transaction purity
registry exhaustiveness
production import closure
test/evidence freshness

```

세부 business rule은 domain validator와 tests가 담당한다.

즉 architecture checker의 목표 역시:

> rule 수를 계속 늘리는 것이 아니라 rule의 범위를 더 근본적으로 만드는 것

이다.

---

# 20. 하지 말아야 할 개선

## Microservice화

하지 않는다.

현재 단일 broker process가 durable writer/authority/recovery ordering을 명확하게 만드는 장점이 크다.

## Repository/Service/Controller 패턴 도입

하지 않는다.

현재 systems-style coordinator/mechanism 분리가 더 적합하다.

## 모든 class interface화

하지 않는다.

effect seam과 external observation boundary만 narrow port를 사용한다.

## Generic operation workflow engine

하지 않는다.

Git integration, context publication, lifecycle create의 물리 ordering은 명시적인 코드로 남긴다.

Journal이 그 의미를 숨기면 안 된다.

## v1 durable plan silent migration

하지 않는다.

## `domain/` 대규모 파일 이동부터 시작

하지 않는다.

먼저 owner를 확정한 뒤 물리 layout을 바꾼다.

## architecture checker를 통과시키기 위한 broad exception

하지 않는다.

## 새 tests를 만들었다는 이유로 OPEN gate를 닫기

하지 않는다.

---

# 21. 각 Phase의 완료 조건

## P1 완료

```text
operation count magic number 없음
composition late binding 없음
preflight/dispatch rule implementation 단일화
동적 authority recheck 유지

```

## P2 완료

```text
contracts facade API unchanged
concept별 physical owner 존재
module-ports type dependency 단방향
production의 giant facade import 대폭 감소
wire/durable golden equality

```

## P3 완료

```text
operation state transition mechanism 한 boundary
terminal immutability 한 owner
new operation 추가 시 compiler/static exhaustiveness
workflow effect ordering은 coordinator에 유지

```

## P4/P5 완료

```text
SQLite writer 여전히 하나
dependency graph가 문서와 checker에서 동일
reverse runtime import 없음
domain generic bucket 감소

```

## P6/P7 완료

```text
read-only integrity checker
repair와 독립
deterministic durability fault matrix
repeated recovery convergence

```

## P8 완료

```text
v1 compatibility policy
migration policy
backup/restore fixture
format version behavior
old/new binary boundary 정의

```

---

# 22. 최종 제안

현재 OMA v2에 필요한 것은 “더 많은 abstraction”이 아니다.

필요한 것은 **현재 이미 존재하는 좋은 abstraction 중 어떤 것이 실제 kernel인지 확정하는 것**이다.

현재 구조에서 가장 중요한 다음 세 축은 이미 보인다.

### 1. Durable operation kernel

`OperationTransitions`, decoder, transaction capability를 중심으로 한 mechanism을 `OperationJournal`이라는 명확한 architecture boundary로 승격한다.

### 2. Contract ownership

`implementation/contracts.ts`의 외부 호환성은 유지하지만 내부 owner를 wire/durable/runtime/host 단위로 분해한다.

### 3. Independent integrity/fault verification

현재 강한 crash/recovery architecture를 `read-only integrity checker + deterministic DurableFs faults`로 독립 검증한다.

이 세 가지를 제대로 끝내면 OMA는:

```text
"잘 분해된 방어적 application"

```

에서

```text
"작은 durable systems substrate 위에
broker/agent society가 구현된 구조"

```

로 성격이 더 분명해진다.

그리고 그 이후에야 persisted format v2, VM power-cut, 장기 fuzz/soak 같은 성숙도 투자가 의미가 커진다.

가장 중요한 것은 순서다.

**현재의 crash consistency, authority, durable state와 fail-closed semantics를 조금이라도 약화시키면서 구조를 예쁘게 만드는 리팩터링은 하지 않는다.**

좋은 개선은 코드가 짧아지는 개선이 아니다.

> **새로운 기능이나 버그 수정이 들어왔을 때 사람이 동시에 기억해야 하는 규칙의 수와 확인해야 하는 파일의 수가 줄어드는 개선이다.**

그 기준으로 보면 OMA v2의 다음 architecture 단계는 대규모 재작성보다:

```text
verification freshness
→ 작은 drift seam 제거
→ contract ownership 분리
→ operation kernel 명시화
→ dependency hierarchy
→ independent integrity/fault system
→ format evolution

```

순서가 가장 안전하고 효과적이다.