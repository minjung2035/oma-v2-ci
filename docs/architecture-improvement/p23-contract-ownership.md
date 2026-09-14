# P23 — Internal contract ownership

기준: `dd7905bd8aef1e005a8279b4a9589f3e1a854d9a`. 기존 아키텍처·동작을 유지하는 type-only 정리다. 실제 실행 결과는 [현재 검증 상태](../../implementation/validation.md)에만 기록한다.

## 소유권 결정

- `src/ports/ledger.ts`의 `OperationLookup`은 receipt에 필요한 `id`, `kind`, `state`, `result`, `errorCode`만 표현한다. 성공/실패/미완료 상태의 result/error null 관계는 contract에 남긴다.
- RawOperationRecord, 원본 JSON, 검증 brand, plan/payload와 relational decoding은 storage에 유지한다. 조회 contract는 recovery snapshot을 대체하지 않는다. 실제 workflow는 계속 기존 Store와 DecodedOperation을 사용한다.
- Receipt projector는 이 최소 contract를 입력 타입으로 사용한다. 객체 복제·필드 삭제를 추가하지 않았고, 기존 decodeReceipt와 오류 판정도 그대로다. 실제 호출자는 여전히 Store가 검증한 snapshot을 넘긴다.
- StorePort의 실제 참조는 호환 facade와 module conformance뿐이며 transaction 인자를 쓰는 production 소비자는 없다. 따라서 전체 StoreWrites/WriteFacets를 contract로 올리지 않고 인자 없는 동기 callback만 표현한다.
- `SynchronousResult`는 기존 PromiseLike 제외 타입식을 소유한다. 실제 Transaction, brand, AsyncLocalStorage, scope 만료, rollback, thenable 거부와 effect 검사는 그대로다. 인자 없는 callback 타입은 런타임 쓰기 권한을 제거하는 보안 장치가 아니다.
- `BatchViewLimits`는 host ProtocolLimits의 두 필드를 고르는 공용 contract이므로 `src/ports/runtime.ts`가 소유한다. protocol/batch-view는 사용하고 기존 type export 경로를 재수출한다.
- `entry/module-conformance.ts`는 기존 module conformance와 함께 DecodedOperation → OperationLookup, 실제 receipt projector → ReceiptProjector를 검사한다.

## Ownership gate

`contract-ownership`은 runtime DAG와 별도 정책이다. canonical internal ports와 contract 소스가 implementation owner를 type import, inline import type, re-export 등으로 참조하는 것을 검사한다. 동일 TypeScript Program의 resolved dependency 정보를 재사용한다.
P19의 일반 type-coupling evidence는 계속 report-only다. 이번 gate는 그 전체를 실패 조건으로 바꾸지 않고 contract ownership 위반만 별도로 판정한다.

기존 공개 v1 호환 선언 `implementation/contracts/module-contracts.ts`의 정확한 `Transaction = import('../../src/store.js').Transaction` alias는 별도 좁은 예외다. 이 공개 alias를 변경하거나 전체 storage transaction을 contract로 승격시키는 것은 이번 범위가 아니다. 새 internal port가 해당 alias를 통해 implementation 타입을 가져오는 것은 허용하지 않는다. canonical internal port 자체에는 implementation 예외가 없다.
CFG-005에서 이미 canonical field/vocabulary metadata가 소유하는 `ResourceLimits`, `ProtocolLimits`, `Capability`의 공개 alias도 기존 정확한 선언만 유지한다. 이들은 storage/workflow 소유 타입이 아니며, 기존 단일 metadata owner를 복제하지 않는다. 각 source/target/specifier/alias name과 erased export 형태를 한정하고 동일 target의 추가 참조도 거부한다. `src/domain/` 전체를 예외로 취급하지 않고 internal port의 직접 참조는 여전히 금지한다.

## 회귀와 범위

- 최소 조회 필드, raw plan/JSON 비노출, Promise 및 Promise union callback 거부, 기존 decoder limit 경로 호환, 실제 module conformance를 compile-time fixture로 확인한다.
- Ownership 위반 fixture와 contract 간 정상 의존을 architecture oracle로 구분한다. Legacy 예외는 다른 이름·참조·facade 우회를 허용하지 않는지도 검사한다.
- P17 이전 선언 fingerprint는 삭제하지 않고 P23에서 변경한 선언/신규 contract만 명시적 delta로 관리한다. 공개/내부 wire·durable 선언과 DB schema는 수정하지 않는다.
- 변경된 여섯 production TS 파일은 기준 commit과 TypeScript emit(removeComments)을 비교하여 실행 JavaScript가 동일한지 확인한다. Store/Broker 동작, transaction/recovery 정책을 바꾸지 않는다.
- 새 플랫폼, SDK, workflow 분해, 기능 추가는 하지 않는다. 별도 구조적 필요가 확인되기 전 이 영역의 추가 refactoring은 진행하지 않는다.
