# P3 O3 — OperationJournal mechanism

재개 기준: `21aebb76ca5100639962ffb9ccc396bc0c3d86a7`.

기존 LedgerReader / OperationTransitions / TransactionScope를 조합하는 작은 Journal을 추가했다. 새 SQL, database connection, transaction runner, effect callback, recovery registry는 없다. 같은 key/hash의 retry는 조회 판정이며 effect replay 권한이 아니다. 기존 Store의 claim-key 경쟁 처리와 오류 메시지를 그대로 사용한다. Store 연결과 transaction-scoped facet은 별도 구현 단위로 진행한다.

## 실행 증거

`node --test test/operation-journal-policy.test.mjs`: 10 tests, 10 pass, 0 fail/cancelled/skipped/todo. Node 22.16.0 / TypeScript 5.8.3. 실제 Journal과 실제 StoreError를 transpile하여 제어된 reader/transition collaborator로 실행했다. 이것은 full semantic typecheck나 실제 SQLite 통합 결과가 아니다. 기존 실제 SQLite transition characterization과 Store 연결 검증은 별도 단위다.

[원본 TAP gzip](evidence/p3-journal-policy.tap.gz)은 `gzip -dc`로 읽는다. Blob SHA: `12de812fa5bd3d0405bd60d95f86f4b8f1efc9c1`.

소스 SHA-256:
- Journal: `2cb03d9bf30a25926adeb1feb402ae4c5b5bb801de82ec694b7a23e4732d1f16`
- test: `8c9945092e50c49fa79da8f8b25f2b2cd2366bfbba3734f5a8f0ea866f295414`

## 판단 고시

D07: 사용자가 P7까지 재개를 명시했다. P0의 고정 의존성/전체 native 실행 차단은 유지하면서 소스 blob으로 동일성을 확인한 경계별 구현과 실제로 실행 가능한 독립 검증을 계속한다. 완료되지 않은 검증을 PASS로 바꾸거나 master에 자동 병합하지 않는다.

D08: Journal이 기존 transition을 다시 구현하지 않도록 SQL 및 terminal immutability는 기존 owner에 남겼다. 생성자에는 효과 실행 함수나 recovery 결정 함수를 받지 않는다. v1 payload/plan/result bytes와 OPEN gate는 변경하지 않았다.
