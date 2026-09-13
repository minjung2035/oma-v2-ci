# P2.5 — validated ledger identity 보존

기준 source: `29295f9c46a8a9a7163dc01564f7be654baf0b99`. 기존 `domain/identifiers.ts`의 brand와 parser를 재사용한다. 별도 ID grammar나 wire brand를 추가하지 않았다.

## 변경

`DecodedOperation`의 id/actor/requestKey, 다섯 row decoder의 반환 identity, recoverable operation ID projection과 reader 반환값에서 이미 검증된 brand를 보존한다. 기존 producer용 row DTO, wire의 string aliases, accepted plan/result JSON, SQL, validation 순서는 그대로다. 모든 string을 brand하거나 arbitrary path/body/profile을 확장하지 않는다.

## 실제 검증

Node 22.16.0, TypeScript 5.8.3, @types/node 25.1.0 환경에서 source blob 동일성을 확인해 복원한 Store의 37-file TypeScript closure를 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes로 semantic compile했다. 기준본과 변경본 모두 오류 0개다. 이는 repo pin TypeScript 5.9.3의 full-project typecheck가 아니다.

변경한 production 세 파일의 emitted JavaScript SHA-256은 before/after 동일하다. 새 compiler tests 2개(정상 브랜드 전달 및 6개 잘못된 인자 거절)와 기존 actual SQLite transition characterization 12개를 함께 실행해 14 PASS / 0 FAIL / 0 SKIP / 0 TODO / 0 CANCELLED를 확인했다. [원본 TAP](evidence/p25-identities.tap.gz).

명령:

```sh
./node_modules/typescript/bin/tsc --module NodeNext --moduleResolution NodeNext --target ES2023 --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck --rootDir . --outDir dist src/store.ts
node --test --test-concurrency=1 test/operation-transition-characterization.test.mjs test/opaque-ledger-identities.test.mjs
```

source SHA-256:

- operation-codec.ts: fe35505c669fd7afe22596652349b65c56bbca41469b890c1e8bee45f8275584
- rows.ts: 22f28c6020696c28977f5bd66a2cb571875dd5e848256af78e18ca6099671642
- ledger-reader.ts: c751fef32b0874463bee3e79b15cd6731ad42920d0fef9bac27f7f222dbef8a3
- test/opaque-ledger-identities.test.mjs: f1b1835ea497b0b7835542a0949f438954fe185becdae76cb77b7d82ee8969f7

## 판단 고시

전체 row 입력 타입을 brand로 바꾸지 않고 validated output subtype만 강화했다. 이는 제안서의 점진적 경계 도입을 따른다. Legacy batch manifest의 string[] 공개 타입은 소비자 호환성을 유지한다. 최초 로컬 시도에서 manifest의 배열 타입까지 강화했을 때 발생한 consumer 오류는 broad cast로 숨기지 않고 해당 확장을 제외했다. 진단 출력을 큰 compiler AST 대신 code/message로 제한했다.

## 진행 상태

P2 contract owners와 일부 subsystem import migration은 앞선 커밋에 존재한다. 이번 단위는 P2.5 output boundary다. 다음 단위는 기존 transition characterization을 유지하는 P3 OperationJournal 및 transaction-scoped facet이다. P0 full/pinned/native verification은 여전히 별도의 실행 조건이며 이 결과로 OPEN gate를 닫지 않는다.
