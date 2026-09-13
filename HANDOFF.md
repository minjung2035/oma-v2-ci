# OMA v2 — 안정성 보존형 아키텍처 작업 인수인계

이 문서는 `refactor/safety-preserving-architecture` 브랜치에서 진행 중인 **안정성 보존형 아키텍처 개선 작업의 현재 재개점**을 기록한다. 장기 유지보수 원칙은 [`MAINTENANCE.md`](MAINTENANCE.md), 상위 계약은 [`architecture.md`](architecture.md)와 [`implementation-spec.md`](implementation-spec.md), 이번 작업의 원안은 [`docs/proposals/2026-09-13-safety-preserving-architecture.md`](docs/proposals/2026-09-13-safety-preserving-architecture.md)를 따른다.

이 문서는 구현 존재, focused 검증, full-project 검증, release proof를 구분한다. 다음 작업자는 문서의 SHA를 현재 HEAD라고 가정하지 말고 **작업 시작 즉시 branch/PR HEAD를 다시 조회**해야 한다.

## 0-A. 이번 재개(2026-09-13, pinned local 실행)의 판정

착수 HEAD `d13310585c412fef3e32db24ba2b42b7b006b1f5`는 green이 아니었다. pinned toolchain(Node 26.7.0 / TypeScript 5.9.3, `npm ci --include=dev`)에서 `typecheck` 4건·`check:architecture` 5건이 실패했고 suite 전반의 fixture drift가 있었다. 현재 HEAD 기준:

- **PASS**: `inventory`, `check:inventory`, `typecheck`, `build`(+`check:package`), `check:architecture`(0 findings).
- **suite**: 135 file 중 **134 PASS / 1 FAIL**. 남은 하나는 `phase5`의 sandboxed-Pi smoke로, 동일 profile이 harness 밖에서 custom message를 전달함은 확인했지만 harness 안에서 child 출력이 없다(원인 미확정). [docs/architecture-improvement/p0-baseline-execution.md](docs/architecture-improvement/p0-baseline-execution.md) §4.3.
- **FAIL(gate)**: LOC 12,343 code lines — A-008/A-009에 따라 architecture review 전 release 불가.
- **NOT_RUN/BLOCKED**: `verify:*` lane 전체, VM power-cut(guard만 구현·검증), live systemd/cgroup 관측, ENOSPC/backup-restore.

단계별 상태는 [docs/architecture-improvement/progress.md](docs/architecture-improvement/progress.md)에 있다(P1 registry·P5 lattice·P6 offline integrity·P7 process-crash fault matrix·P8 version boundary·P9 persisted fuzz = PROVEN, power-cut VM 실행만 BLOCKED).

이번에 바뀐 authoritative owner:

- `src/storage/operation-codec.ts`의 `OPERATION_CODECS` — kind와 plan/result/relation validator binding. decode 경계가 이 registry를 사용한다.
- `src/mail/headers.ts` — OMA header metadata 검증 전 unfold.
- `src/domain/persisted-formats.ts` — persisted field 분류, version 경계, portability 정책.
- `src/storage/durable-fs.ts`·`immutable-file.ts`·`context-stream.ts`·`batch-view.ts` — test-only `DurabilityObserver` seam.
- `src/git/context.ts`·`context-repository.ts`·`src/git.ts` — context 후보 준비 뒤 base/authority 재확인, base locator의 object format 선검증.
- `src/reconcile.ts` — store-scope recovery 실패에서 원래 진단 메시지 보존.
- `src/domain/admission.ts` — 두 번째 broker 소유 충돌을 BROKER_UNAVAILABLE로 보고.
- native 실행 adapter 3곳은 process owner를 경유한다.
- `scripts/dependency-graph.mjs`·`dependency-lattice.mjs` — 측정·enforcement 단일 extractor, `scripts/powercut-lane.mjs` — guarded power-cut lane, `scripts/contract-imports.mjs` — P2 import migration snapshot.

먼저 실행할 명령:

```sh
npm ci --include=dev
npm run typecheck && npm run check:architecture
node --test --test-concurrency=1 dist/test/phase5.test.js
node --test --test-concurrency=1 dist/test/durable-fault-matrix.test.js dist/test/persisted-format-boundary.test.js dist/test/persisted-state-fuzz.test.js
```

변경하지 않은 normative surface: wire method, DB schema(version 1), persisted v1 plan/result bytes, OPEN SPIKE 상태, physical effect ordering.

## 1. 현재 브랜치와 범위

- 작업 브랜치: `refactor/safety-preserving-architecture`
- 최초 기준 master: `e2afe9ab050d87705451cd127c458ad216aa52d4`
- 이 인계 문서 작성 직전 HEAD: `09ca186c1450d7c045b6bc6d5b1232021bf6029f`
- PR: `#2`, Draft 유지
- 이 HEAD 기준 PR 누적: 23 commits / 136 changed files
- 사용자 요청 범위: 제안서의 **P7까지 구현 완료**
- P8 persisted-format evolution, P9 VM power-cut/fuzz maturity는 이번 요청 범위 밖
- 원 제안서는 `docs/proposals/`에 보존되어 있으며 refactor 편의를 위해 수정하지 않는다.

Master에는 자동 병합하지 않는다. Full pinned/native 검증 없이 PR을 release-ready로 간주하지 않는다.

## 2. 반드시 보존할 안전성 불변식

이번 작업의 목적은 구조를 예쁘게 만드는 것이 아니라 기존 safety semantics를 유지하면서 ownership과 검증 가능성을 높이는 것이다. 아래 항목은 refactor 편의를 위해 약화하면 안 된다.

- broker는 하나이고 SQLite writer/transaction owner도 하나다.
- accepted operation intent와 accepted plan/result relation은 durable evidence다.
- accepted v1 bytes를 현재 state/path에 맞춰 rewrite하지 않는다.
- `unknown`은 absence나 success가 아니며 임의로 승격하지 않는다.
- normal path와 recovery policy를 generic workflow engine 하나로 합치지 않는다.
- authority/admission/incarnation/cgroup fencing은 effect 직전까지 현재 값을 다시 확인한다.
- immutable evidence publication과 derived-file replacement는 다른 API/의미를 유지한다.
- 외부 effect는 bounded해야 하며 effect ordering을 바꾸는 refactor를 하지 않는다.
- OPEN SPIKE/gate는 test/helper가 생겼다는 이유만으로 닫지 않는다.
- P8 전에는 schema v1 또는 persisted plan v1의 silent migration/rewrite를 하지 않는다.

특히 lifecycle replay에서 historical operation의 `desired`, `previousIncarnation`, operation identity를 현재 target에 맞춰 고치면 안 된다.

## 3. 단계별 현재 상태

| 단계 | 상태 | 현재 구현 / 근거 | 남은 일 |
| --- | --- | --- | --- |
| P0 | **BLOCKED / 부분 focused 검증만 존재** | Node 22.16.0, local TS 5.8.3 기반 focused evidence | repo pin TS 5.9.3, 전체 inventory/typecheck/build/package/architecture/test/native lanes |
| P1 | **구현 완료** | operation-kind magic count 제거, broker composition 정리, shared public validation + live recheck | full-current-source P0에서 재확인 |
| P2 | **대부분 반영, closure 미완료** | physical contract owners, compatibility facade, module-ports cycle 제거, protocol/storage/domain/일부 coordinator import migration | 현재 전체 graph 기준 잔여 facade/direct import와 owner migration 확인 |
| P2.5 | **반영 완료** | validated ledger output에서 opaque/branded identity 보존 | wire/string surface까지 무리하게 brand 확장하지 않음 |
| P3 | **대부분 완료** | `OperationJournal`, Store integration, scoped operation API, recovery exhaustiveness, 일부 coordinator migration | 남은 coordinator flat Store 소비 여부를 P5 graph에서 측정 후 최소 이전 |
| P4 | **대부분 완료** | operations/agents/subscriptions/deliveries/batches/usage logical read/write facets, 동일 SQLite connection/writer 유지 | 필요한 consumer migration만 수행; Store 물리 분할 금지 |
| P5 | **실질 미완료** | 기존 narrow owner checker만 존재 | 실제 import graph 측정 → coarse dependency DAG 확정 → checker enforcement |
| P6 | **구현 및 focused oracle 존재** | independent ledger/files/mail/Git/context integrity, offline/live admin path, `scripts/check-state.mjs` | full P0 및 실제 positive systemd/cgroup 환경 검증은 별도 |
| P7 | **미완료** | 기존 durability tests는 있으나 제안서의 deterministic VFS-like fault seam/matrix는 없음 | low-level fault seam + restart/integrity/reconcile convergence matrix |

현재 구현 진척을 숫자로 표현하면 사용자 요청 범위(P1~P7 구현)를 기준으로 대략 70%대 중반이지만, 이는 일정 추정일 뿐 correctness metric이 아니다.

## 4. 완료된 주요 구현

### P1 — semantic entropy 제거

- architecture checker가 고정 operation count `11`에 의존하지 않고 closed kind set과 registry의 정확한 일치를 검사한다.
- broker composition에서 Git을 Lifecycle보다 먼저 구성하고 nullable/late-bound context ownership을 제거했다.
- PublicDispatcher validation owner를 공유하지만 preflight 결과를 authority token처럼 저장하지 않는다.
- body 수신 이후 dispatch에서 current actor/capability/admission/incarnation 등 live condition을 다시 검사한다.

P1 당시 focused fixture는 25 PASS였다. 이 수치는 당시 source에 결합된 evidence이며 현재 전체 suite PASS를 뜻하지 않는다.

### P2 — contract owner 분리와 import narrowing

`implementation/contracts.ts`의 개념 owner를 물리적으로 분리했다. 현재 주요 owner는 다음과 같다.

- `implementation/contracts/identity.ts`
- `errors.ts`
- `public-wire.ts`
- `internal-wire.ts`
- `durable.ts`
- `runtime.ts`
- `host.ts`
- `values.ts`
- `module-contracts.ts`

`implementation/contracts.ts`는 compatibility/spec facade로 남는다. `src/module-ports.ts`는 이 facade를 통해 순환하지 않고 precise owner를 직접 본다. Wire/durable migration은 golden/equivalence 및 actual SQLite characterization과 함께 진행했다.

관련 문서:

- [`docs/architecture-improvement/p2-module-ports.md`](docs/architecture-improvement/p2-module-ports.md)
- [`docs/architecture-improvement/p2-protocol-imports.md`](docs/architecture-improvement/p2-protocol-imports.md)
- [`docs/architecture-improvement/p2-durable-imports.md`](docs/architecture-improvement/p2-durable-imports.md)
- [`docs/architecture-improvement/p2-domain-imports.md`](docs/architecture-improvement/p2-domain-imports.md)
- [`docs/architecture-improvement/p2-coordinator-imports.md`](docs/architecture-improvement/p2-coordinator-imports.md)

P2 closure를 문서만 보고 선언하지 말고 P5에서 **현재 실제 import graph**를 다시 측정한다.

### P2.5 — internal opaque identity

기존 `src/domain/identifiers.ts`의 brand/parser를 재사용하고, validated ledger decode output에서 이미 검증된 operation/actor/request/message/batch identity를 보존한다. Wire v1과 arbitrary string/path/profile까지 nominal type을 확장하지 않는다.

관련 문서: [`docs/architecture-improvement/p25-identities.md`](docs/architecture-improvement/p25-identities.md).

### P3 — explicit OperationJournal와 recovery exhaustiveness

`src/storage/operation-journal.ts`가 기존 `LedgerReader`, `OperationTransitions`, `TransactionScope`를 조합한다. 새 SQL owner, 새 DB connection, generic workflow engine, effect callback registry를 만들지 않았다.

Journal은 operation identity/key classification, accept/settlement/recoverable boundary를 모으지만 terminal immutability와 SQL transition 자체는 기존 owner에 남긴다.

Recovery 쪽은 Git/Reconcile/startup의 operation-kind 분기를 closed set에 대해 exhaustive하게 만들었다. 새로운 kind가 추가되면 각 recovery owner가 명시적으로 판단해야 한다.

관련 문서:

- [`docs/architecture-improvement/p3-journal.md`](docs/architecture-improvement/p3-journal.md)
- [`docs/architecture-improvement/p3-store-integration.md`](docs/architecture-improvement/p3-store-integration.md)
- [`docs/architecture-improvement/p3-recovery.md`](docs/architecture-improvement/p3-recovery.md)
- [`docs/architecture-improvement/p3-coordinator-facets.md`](docs/architecture-improvement/p3-coordinator-facets.md)

RegistryOperations와 ordinary mail recovery는 scoped journal/store facets로 이전됐다. 해당 coordinator + 기존 SQLite transition focused run은 16 PASS였다.

### P4 — logical Store facets, single physical writer

`src/storage/facets.ts`와 Store에 다음 logical facet을 두었다.

- operations
- agents
- subscriptions
- deliveries
- batches
- usage

읽기 facet은 immutable facade이며 write facet은 root synchronous transaction capability 안에서만 유효하다. escaped write function이나 async continuation이 이후 transaction 권한을 빌릴 수 없도록 기존 `TransactionScope` semantics를 유지한다.

중요: **`DatabaseSync`와 physical writer ownership은 `src/store.ts`에 남아 있다.** P4는 six repositories/DB connections로 쪼개는 작업이 아니다.

관련 문서: [`docs/architecture-improvement/p4-facets.md`](docs/architecture-improvement/p4-facets.md). 해당 focused run은 21 PASS였다.

### P6 — independent read-only integrity engine

현재 HEAD의 가장 큰 완료 단위다. 다음이 존재한다.

- `src/diagnostics/ledger.ts`
- `src/diagnostics/integrity.ts`
- `src/diagnostics/files.ts`
- `src/diagnostics/mail.ts`
- `scripts/diagnostic-observers.mjs`
- `scripts/check-state.mjs`

관리자 경로 예:

```sh
node scripts/check-state.mjs --state /absolute/state/root --society NAME --mode offline --quiesced
node scripts/check-state.mjs --state /absolute/state/root --society NAME --mode live
```

원칙:

- reconcile/repair/materialize를 호출하지 않는다.
- DB를 physical observation 전후에 다시 읽고 변화가 있으면 atomic consistency를 주장하지 않고 UNKNOWN으로 둔다.
- output은 bounded issue ID 중심이며 raw mail body/credential/unbounded stderr를 내보내지 않는다.
- mail object hash/size/header relation, archive/inbox relation, published Git ref, context snapshot/current, manifest/tree bytes, selected unit observation을 독립적으로 확인한다.
- pending gap과 corruption을 구분하며 unaccepted orphan을 임의 삭제하지 않는다.

P6 구현 과정에서 native process stdin을 string으로 받은 뒤 `Buffer.byteLength` 관찰보다 늦게 encode하던 별도 bug가 드러나 `aeeafd9b...`에서 수정됐다. 이 수정은 P6 observer를 위해 native process owner를 복제하는 대신 기존 process owner를 고친 것이다.

현재 P6 focused serial run은 **54 PASS, 0 fail/cancelled/skipped/todo**다. 여기에는 diagnostic 31, 기존 coordinator/SQLite 16, stdin regression 3, import migration 4가 포함된다. 실제 temporary SQLite/filesystem/Git repository와 standalone admin command를 사용했다.

단, 이 결과는 **repo pin TypeScript 5.9.3 full-project P0가 아니다.** 실제 positive systemd/cgroup proof도 아니다.

관련 문서: [`docs/architecture-improvement/p6-ledger.md`](docs/architecture-improvement/p6-ledger.md), [`docs/architecture-improvement/p6-physical.md`](docs/architecture-improvement/p6-physical.md).

## 5. 지금부터의 작업 순서

### 5.1 먼저 P5 — 실제 dependency lattice를 측정하고 고정한다

제안서는 미리 예쁜 layer를 정한 뒤 코드를 강제로 맞추는 것을 금지한다. 반드시 **현재 HEAD의 import graph 측정이 먼저**다.

권장 순서:

1. `src/**`와 필요한 `implementation/contracts/**`의 static import/export edge를 실제로 수집한다.
2. type-only와 runtime edge를 둘 다 보되, runtime dependency direction을 별도로 확인한다.
3. SCC/cycle, high fan-in/fan-out, facade direct import, Store flat-consumer edge를 보고 semantic owner를 분류한다.
4. 현재 graph가 허용하는 최소 coarse DAG를 문서화한다.
5. 기존 `scripts/architecture-check.mjs`의 세밀한 owner rule은 유지하고 그 위에 coarse direction gate를 추가한다.
6. broad wildcard exception을 만들지 않는다. 필요한 예외는 exact edge와 이유를 적는다.
7. negative fixture에서 forbidden reverse edge를 하나 삽입하면 checker가 실패하는지 확인한다.
8. 같은 graph extractor 결과를 evidence JSON과 checker가 공유하게 하여 문서와 enforcement가 따로 drift하지 않게 한다.

제안서의 개념적 출발점은 다음이지만 실제 graph로 조정해야 한다.

```text
L0 fundamental / pure definitions
  ↓
L1 codecs / storage primitives / process primitives / protocol mechanisms
  ↓
L2 subsystem facts + observations
  ↓
L3 Mail / Git / Lifecycle / Units / Inference workflows
  ↓
L4 Reconcile / Broker / Runner orchestration
  ↓
L5 entry / CLI / extension
```

P5 중 `domain/` 파일을 이름만 보고 대량 이동하지 않는다. 먼저 owner와 dependency direction을 고정한다.

P5 완료 기준은 적어도 다음이다.

- current source graph evidence 존재
- coarse DAG가 current code에서 설명 가능
- checker가 reverse edge/cycle를 실제로 거절
- 기존 narrow owner rule 유지
- direct compatibility-facade import 정책 명시
- no runtime semantic change / no wire/schema change

### 5.2 P2/P3/P4 잔여 migration은 P5 결과로만 최소 수행

P5 측정에서 발견되는 다음 항목만 처리한다.

- production의 잔여 direct `implementation/contracts.ts` import
- coordinator가 굳이 flat Store API를 잡고 있는 edge
- concept owner를 우회하는 compatibility import

단, 모든 caller를 facet으로 바꾸기 위한 기계적 migration은 하지 않는다. 새 interface를 모든 class에 만들거나 generic Repository/Service/Controller 계층을 도입하지 않는다.

### 5.3 마지막 큰 구현 단위 P7 — deterministic durable-FS fault boundary

P7 seam은 **low-level durability primitive에만 둔다.** 후보 owner는 다음이다.

- `src/storage/durable-fs.ts`
- `src/storage/immutable-file.ts`
- `src/storage/context-stream.ts`
- `src/storage/batch-view.ts`

workflow coordinator, Mail/Git/Lifecycle constructor 전체에 `FsPort`/`FaultFs`를 전달하지 않는다.

Fault taxonomy는 최소 다음 세 의미를 구분해야 한다.

```text
BEFORE             syscall/effect 전 실패
AFTER_VISIBLE      외부에서 보일 수 있는 effect 직후 실패
AMBIGUOUS          effect 여부를 호출자가 단정할 수 없는 observation
```

필수 deterministic point 예:

- file create 전/후
- write 중/후
- file fsync
- link/rename 직후
- destination validation 전/후
- parent directory fsync
- owned temp unlink
- second directory fsync

가능하면 global mutable injector보다 **명시적이고 좁은 test seam**을 사용한다. Production default path는 기존 syscall ordering을 그대로 사용해야 한다.

각 fault point의 oracle은 다음 순서를 자동화한다.

```text
accepted operation 준비
→ targeted low-level effect
→ deterministic fault
→ restart-equivalent 재개
→ read-only integrity
→ reconcile
→ read-only integrity again
→ reconcile 반복
→ convergence 확인
```

반드시 확인할 결과:

- false success 없음
- immutable accepted/evidence bytes 변경 없음
- duplicate physical effect 없음
- unknown이 arbitrary success로 승격되지 않음
- 같은 operation identity 유지
- owned temporary만 cleanup
- post-visible failure를 absence로 오판하지 않음
- repeated reconcile이 같은 terminal/unknown 상태로 수렴

P7은 real VM power-cut proof가 아니다. SIGKILL/VM power loss 확대는 P9 범위다.

## 6. P0 / 전체 검증 상태

현재 local focused environment:

- Node `22.16.0`
- TypeScript `5.8.3`
- repo pin은 TypeScript `5.9.3`

이 차이 때문에 지금까지의 strict semantic closure compile을 **repo pinned full typecheck PASS**라고 부르면 안 된다.

현재도 반드시 별도로 실행해야 하는 P0/full verification:

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
npm run verify:fast -- --out <fresh-dir>
npm run verify:durable -- --out <fresh-dir>
npm run verify:property -- --out <fresh-dir>
npm run verify:kernel -- --out <fresh-dir>
npm run verify:crash -- --out <fresh-dir>
npm run verify:stress -- --out <fresh-dir>
npm run verify:all -- --out <fresh-dir>
node scripts/loc.mjs
```

이전 환경에서는 locked dependency 설치/전체 clone 및 GitHub Actions runner 실행이 안정적으로 확보되지 않았다. 따라서 `NOT_RUN/BLOCKED`를 failure와 혼동하지 말고, 반대로 focused PASS를 full PASS로 승격하지 않는다.

Production inventory/LOC/hash generated file은 사람이 green으로 맞추지 않는다. generator를 실행하고 fresh source에 결합된 결과만 인정한다.

## 7. 증거와 문서 읽기 순서

다음 작업자는 아래 순서로 읽으면 된다.

1. [`docs/proposals/2026-09-13-safety-preserving-architecture.md`](docs/proposals/2026-09-13-safety-preserving-architecture.md)
2. 이 `HANDOFF.md`
3. [`docs/architecture-improvement/progress.md`](docs/architecture-improvement/progress.md) — 일부 상태 문구는 후속 P6 커밋보다 오래됐을 수 있으므로 HEAD와 함께 해석
4. P2 문서들
5. [`docs/architecture-improvement/p25-identities.md`](docs/architecture-improvement/p25-identities.md)
6. P3 journal/store/recovery/coordinator 문서들
7. [`docs/architecture-improvement/p4-facets.md`](docs/architecture-improvement/p4-facets.md)
8. [`docs/architecture-improvement/p6-ledger.md`](docs/architecture-improvement/p6-ledger.md)
9. [`docs/architecture-improvement/p6-physical.md`](docs/architecture-improvement/p6-physical.md)
10. 각 문서가 가리키는 `docs/architecture-improvement/evidence/*`
11. `MAINTENANCE.md`, `implementation/validation.md`, `implementation/spikes.md`

Evidence 파일은 해당 source/tool/environment에 결합된 historical execution record다. 이후 source가 바뀌면 새 evidence를 생성한다.

## 8. 주요 milestone commit

아래 SHA는 탐색용 anchor다. 작업 시작 시 branch history에서 다시 확인한다.

- `da73fea...` — 원 제안서 보존
- `2fff630...` — P1 operation-kind closure
- `b4d153d...` — P1 broker composition
- `cbe25a0...` — P1 public validation/live recheck
- `566e74c...` — durable contract import narrowing + actual SQLite characterization
- `138aca4...` — domain pure-value/identity dependency narrowing
- `21aebb7...` — P2.5 validated ledger identity brands
- P3/P4 연속 커밋 — OperationJournal, Store integration, facets, recovery exhaustiveness
- `32f8f2f...` — registry/mail recovery scoped facet consumers
- `77ac4c7...` — independent read-only ledger integrity
- `aeeafd9...` — native process stdin encoding fix
- `09ca186...` — independent physical publication integrity + admin observer

커밋 메시지와 docs/evidence를 우선하고 SHA prefix만으로 의미를 추정하지 않는다.

## 9. 커밋/작업 규율

남은 작업도 구현 단위로 나눠 커밋한다.

권장 단위:

1. `arch: measure current dependency graph`
2. `arch: enforce measured dependency lattice`
3. 필요한 경우 `refactor: finish dependency-directed consumer migration`
4. `test(storage): add deterministic durable-fs fault seams`
5. `test(recovery): verify fault/restart/integrity convergence`
6. `docs: close P7 implementation status and refresh handoff`

각 구현 커밋에는 가능한 범위의 regression/negative oracle과 진행 문서를 함께 남긴다. 검증 결과에는 정확한 command, source SHA/digest, Node/TS version, PASS/FAIL/SKIP/NOT_RUN을 기록한다.

## 10. 하지 말아야 할 것

- microservice로 분할
- generic Repository/Service/Controller 계층 도입
- 모든 class에 interface를 만드는 작업
- operation kind를 generic workflow callback registry로 치환
- Store를 여러 SQLite writer/connection으로 분할
- current state에 맞춰 v1 accepted plan/result rewrite
- `unknown`을 retry 편의를 위해 success/absence로 변경
- recovery가 normal handler를 그대로 다시 호출하도록 통합
- integrity checker가 reconcile/repair를 호출
- P7 fault injector를 모든 workflow constructor까지 전파
- broad architecture-checker exception으로 P5를 통과
- test 추가만으로 OPEN SPIKE를 닫음
- P8/P9를 이번 P7 작업에 섞음

## 11. 다음 작업자가 바로 시작할 위치

첫 실작업은 **P5 import graph 측정**이다. 아직 dependency lattice를 코드에 쓰지 말고, 현재 branch의 source graph를 먼저 수집한다.

P5 결과를 기준으로 최소 migration과 checker를 고정한 뒤, **P7 low-level durability fault seam과 recovery convergence matrix**로 간다. P6 integrity engine은 P7의 oracle로 재사용하되 recovery 구현을 검사기 안에서 호출하지 않는다. 테스트 orchestration에서만 `integrity → reconcile → integrity` 순서를 구성한다.

P5/P7 구현이 끝나도 마지막으로 남는 것은 full pinned P0/native proof다. 그것이 없으면 구현 완료와 release-ready를 구분해서 보고한다.
