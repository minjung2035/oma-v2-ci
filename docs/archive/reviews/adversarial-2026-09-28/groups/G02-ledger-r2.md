# G02-ledger-r2 적대적 검증 결과 (2차 독립 감사)

검토 대상 HEAD `070a52d`, branch `feat/macos-hidden-vm`. 코드 수정·`npm build/test`·`systemctl`/`sudo` 없음.
재현 스크립트: `review/adversarial-2026-09-28/repro/G02-ledger-r2/unbounded-and-clamp.mjs` (dist import, mkdtemp,
스크립트 끝에서 정리). 기존 시험 하나(`dist/test/r12-ledger-transitions.test.js`)를 `node --test`로 돌려 clamp
방어를 확증했다.

## 1. 커버리지

모든 줄 수는 감사 시작 시 `wc -l`로 얻은 실제 값이다(추정 없음). 각 파일을 read offset/limit로 마지막 줄까지 읽었다.

| 파일 | 줄 수(wc -l) | 전부 읽음 | 비고(마지막으로 읽은 줄 N — 내용 앞 20자) |
|---|---|---|---|
| src/store.ts | 396 | 예 | 396 — `}` (validDesiredTransi… 함수의 닫는 중괄호) |
| implementation/schema-v1.sql | 108 | 예 | 108 — `COMMIT;` |
| src/storage/transitions.ts | 198 | 예 | 198 — `}` (LedgerTransitions 클래스 닫음) |
| src/storage/operation-transitions.ts | 77 | 예 | 77 — `}` (OperationTransition… 닫음) |
| src/storage/operation-codec.ts | 264 | 예 | 264 — `}` (decodeOperation 닫음) |
| src/storage/operation-journal.ts | 59 | 예 | 59 — `}` (OperationJournal 닫음) |
| src/storage/rows.ts | 187 | 예 | 187 — `}` (decodeOperationIdPro… 닫음) |
| src/storage/ledger-reader.ts | 228 | 예 | 228 — `}` (LedgerReader 클래스 닫음) |
| src/storage/transaction.ts | 71 | 예 | 71 — `}` (TransactionScope 닫음) |
| src/storage/facets.ts | 71 | 예 | 71 — `export function readFa…` (writeFacets 반환) |
| src/storage/receipt-projector.ts | 36 | 예 | 36 — `}` (receiptOfOperation 닫음) |
| src/reconcile.ts | 241 | 예 | 241 — `}` (ReconcileModule 닫음) |
| src/reconcile/operations.ts | 104 | 예 | 104 — `}` (OperationRecovery 닫음) |
| src/reconcile/preaccept.ts | 103 | 예 | 103 — `}` (collectUnaccepted… 반환/닫음) |
| src/ports/ledger.ts | 30 | 예 | 30 — `export type ReceiptPro…` (타입만, 런타임 없음) |
| src/request-cache.ts | 249 | 예 | 249 — `}` (RequestCache 클래스 닫음) |

부속으로 PRIORITY-0.md(220줄) 전부, implementation/schema-v1.sql 전부를 읽었고, 호출 경로 확인을 위해
`views.ts`, `broker/public-dispatcher.ts`, `lifecycle/policy.ts`, `dist/test/r12-ledger-transitions.test.js`,
`dist/test/fixtures/spec.js` 등 그룹 밖 파일을 참조했다(판정 대상은 할당 파일).

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G02-ledger-r2-01 | Medium | resource | 운영 목록 쿼리에 LIMIT/페이징 없음 — 시간에 따라 무한 성장하는 표를 단일 writer 이벤트 루프에서 통째로 디코딩 | confirmed |
| G02-ledger-r2-02 | Low | resource | RequestCache 메타데이터(`.json`) 읽기에 바이트 상한 없음(body 경로와 비대칭) | high |
| G02-ledger-r2-03 | Info | structural | 시계 소스 이원화: `LedgerTransitions`만 `now` 주입 가능, `Store`/`OperationTransitions`는 `Date.now()` 직접 호출 | confirmed |

## 3. 발견 상세

### G02-ledger-r2-01 운영 목록 쿼리에 LIMIT/페이징 없음
- 심각도: Medium
- 분류: resource
- 위반 규칙: 없음(자원 고갈; P0 확정 사실의 의미는 바뀌지 않음)
- 코드 경로: `src/storage/ledger-reader.ts:71`(`agents()` — `SELECT * FROM agents`),
  `:80-81`(`subscriptions()`), `:225-227`(`usages()` — `SELECT * FROM usage ORDER BY rowid`),
  `:195-206`(`pendingWorkRows()`), `:187`(`pendingDeliveries()`), `:117`(`recoverableIds()`) →
  `src/store.ts:319`(`listAgents`), `:321`(`allSubscriptions`), `:385`(`usageRows`), `:373`(`pendingWorkRows`)
  → 핫 경로 호출자 `src/broker/public-dispatcher.ts:76`(모든 public 요청마다 `listAgents().map`으로 actorNames),
  `src/reconcile.ts:69`/`:174`/`:222`(스윕/종료마다 전 agent), `src/views.ts:46`/`:51`(refreshWorld).
- 원인: `LedgerReader`의 전 목록 SELECT에는 LIMIT도 페이징도 없다. 관리자용 진단 읽기(`store.ts:120`
  `readDiagnosticSnapshot`)에만 `maxRows`/`maxBytes`/`maxDatabaseBytes` 예산과 `LIMIT_EXCEEDED`가 있고,
  운영 경로에는 그 대칭이 없다. `node:sqlite`의 `.all()`은 결과 전부를 배열로 구체화하며, 그 위에 각 행 디코더가
  다시 관계 재검증을 돈다(예: 삭제되지 않는 usage 표를 `usages()`가 통째로 디코딩). broker는 단일 writer이므로
  이 구체화·디코딩은 동기적으로 이벤트 루프를 점유한다(store.ts는 `busy_timeout=5000`으로 그 루프의 대기
  상한을 이미 R6-19 한계로 문서화).
- 영향: `usage`·`subscriptions`·`deliveries` 표는 society 수명 동안 요청·구독·전달마다 한 행씩 늘고
  삭제되지 않는다(operation은 no-delete, 주석 `store.ts:341`). agent 수는 create quota로 상한이 있으나
  (LineageSnapshot/assertCreateCapacity, `lifecycle/policy.ts:25-29`) usage/subscription/delivery는 그런 상한이
  코드에 없다. 충분히 오래 돌면 `usages()`/`allSubscriptions()`/`pendingWorkRows()` 한 번이 큰 배열을
  구체화하며 단일 writer 루프를 그 시간만큼 멈춘다. durable 사실의 *의미*는 바뀌지 않으므로 P0 위반은 아니고,
  조용한 손상 없이 성능·가용성이 저하되는 자원 문제다. 진단 경로에는 예산이 있는데 운영 경로에는 없다는
  비대칭이 핵심.
- 최소 반례: 한 society에서 mail.send/usage 예약을 반복(요청 N회)하면 `usage` 행이 N개로 자란다. 그 뒤
  `usages()`(또는 이를 부르는 status 경로)가 N개를 한 배열로 올린다. repro는 대신 삭제 불가·상한 없음이 즉시
  확인 가능한 `agents`로 2001행을 넣어 `listAgents()`가 전부를 한 배열로 반환함을 보인다.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G02-ledger-r2/unbounded-and-clamp.mjs` →
  `PART2 unbounded OK: listAgents returned 2001 decoded rows in one array (~5.7MB heap growth); no LIMIT, no caller cap`.
  운영 표 중 quota가 없는 usage/subscription/delivery의 실제 대량 성장은 admission 경로(그룹 밖)를 함께
  돌려야 하므로 여기서는 표 하나로 무제한성을 확정하고 성장원은 §6에 남긴다.
- 확신도: confirmed(LIMIT 부재·전량 구체화는 실행으로 확정; 실서비스 성장 속도는 그룹 밖 경로에 의존)
- 개선 방향: 진단 경로와 같은 유한 예산/페이징을 운영 목록에도 두는 방향. 특히 삭제되지 않는 `usage`와
  `deliveries`는 rowid 커서 기반 페이징 또는 상태별 인덱스 질의로 상한을 갖게. 상한 초과는 durable fact가
  아니므로 `corrupt`가 아니라 명시적 거부/부분결과로(P0-5와 정합).

### G02-ledger-r2-02 RequestCache 메타데이터 읽기에 바이트 상한 없음
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음(sandbox 자기 프로세스에 국한)
- 코드 경로: `src/request-cache.ts:79`(`readCacheFile`, `expectedBytes` 없을 때 `readFileSync(fd)`로 전량 읽기)
  ← `:117`(`readMetadata` → `this.reader(this.path(key))`, 상한 인자 미전달) ← `read`/`prepareReplay`/
  `updateReceipt`.
- 원인: `readCacheFile`은 `expectedBytes`가 주어질 때만 `stat.size` 상한을 검사한다(`request-cache.ts:74`).
  body 읽기(`readBody`, `:158`)는 `expected.bytes`를 넘겨 상한이 있으나 메타데이터(`.json`) 읽기는 상한 인자
  없이 파일 전체를 메모리에 올린다. 이 캐시는 FS-003 "private model-mutable preaccept cache"로 모델이 sandbox
  안에서 직접 쓰는 파일이다.
- 영향: 모델이 자기 키 경로에 매우 큰 유효 `.json`을 두면 자신의 `oma` CLI 프로세스가 그 파일을 통째로 읽어
  자기 메모리를 소모한다. broker나 durable ledger에는 닿지 않고 다른 agent로 번지지 않는다(각 sandbox `HOME`
  분리). self-inflicted 자원 문제.
- 최소 반례: sandbox 안에서 `$HOME/.local/state/oma/requests/<validkey>.json`에 수백 MB의 유효 JSON을 쓴 뒤
  같은 키로 재생 → `readMetadata`가 전체를 읽음.
- 재현 방법: 추론만. 코드 경로는 위와 같이 끝까지 확인. body(`:158`)엔 상한, metadata(`:117`)엔 없음의
  비대칭을 직접 대조. (1차 보고 G02-ledger-01과 동일 결함이며 재확인함.)
- 확신도: high(코드 경로 확정, 영향 범위 self-inflicted)
- 개선 방향: body와 같은 유한 바이트 상한을 metadata 읽기에도. 초과는 `unavailable`/거부로(P0-5 정합).

### G02-ledger-r2-03 시계 소스 이원화
- 심각도: Info
- 분류: structural
- 위반 규칙: 없음
- 코드 경로: `src/storage/transitions.ts:32`(`private readonly now: () => number = Date.now`) vs
  `src/store.ts:281`(`insertAgent` 직접 `Date.now()`), `:306`/`:312`(`updateAgent`),
  `src/storage/operation-transitions.ts:24`(`insert`), `:41`/`:56`/`:66`/`:74`(updatePlan/succeed/fail/unknown).
- 원인: `LedgerTransitions`는 `now`를 주입 가능한 인자로 받지만 `Store`는 그것을 주지 않아 기본 `Date.now`가
  쓰이고, `Store`·`OperationTransitions`는 `Date.now()`를 직접 부른다. 시계 주입 경로가 절반만 존재. 그 자체는
  결함이 아니다 — 아래 §5처럼 모든 갱신이 `MAX(?, created_at_ms)`로 역행을 clamp해 durable 불변조건이 지켜짐.
- 영향: 정확성 영향 없음. P0-7 시계-역행 경계 시험이 절반은 `Date.now` monkeypatch에 의존해야 하는 구조적 마찰.
- 재현 방법: 위 줄 번호 직접 대조.
- 확신도: confirmed
- 개선 방향: 시계를 한 owner에서 받아 `OperationTransitions`·`insertAgent`·`updateAgent`까지 같은 함수로 전달.

## 4. 리팩터링 필요 지점

- 운영 목록 쿼리의 상한/페이징 부재(-01). 진단 경로(`store.ts:120`)와 같은 유한 예산을 운영 경로에도. 특히
  삭제 없는 `usage`/`deliveries`.
- RequestCache body/metadata 읽기 상한 비대칭(-02).
- 시계 소스 일원화(-03).

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **시계 역행 vs schema CHECK — 1차의 핵심 주장 재판정: 참.** 모든 at_ms *UPDATE*가 `MAX(?, created_at_ms)`로
  clamp한다. 문장을 하나씩 재확인:
  - `store.ts:308` updateAgent(desired) `updated_at_ms=MAX(?, created_at_ms)` ✓
  - `store.ts:313` updateAgent(incarnation) `MAX(?, created_at_ms)` ✓
  - `operation-transitions.ts:41` updatePlan, `:56` succeed, `:66` fail, `:74` unknown — 모두 `MAX(?, created_at_ms)` ✓
  - `transitions.ts:69` markMaterialized `materialized_at_ms=MAX(?, created_at_ms)` ✓
  - `transitions.ts:79` markAcknowledged `acknowledged_at_ms=MAX(?, created_at_ms)` ✓
  - `transitions.ts:152` completeBatch `completed_at_ms=MAX(?, created_at_ms)` ✓, presented는
    `presented_at_ms=MAX(?, created_at_ms, materialized_at_ms)`(`:159`)로 materialization까지 포함해 clamp ✓
  - `transitions.ts:193` settleUsage `updated_at_ms=MAX(?, created_at_ms)`(+ TS 선계산 `at=Math.max(now,createdAtMs)`) ✓

  신규 INSERT는 한 이벤트에서 시계를 한 번 읽어 created=updated로 넣어 CHECK를 만족:
  `store.ts:281-285`(insertAgent, 단일 `now`), `operation-transitions.ts:24-30`(insert, 단일 `now`),
  `transitions.ts:100-106`(insertPreparedBatch, 단일 `createdAt`), `transitions.ts:184-188`(reserveUsage, 단일 `at`),
  `transitions.ts:44`(follow, `this.now()` 신규행). deliveries 신규행 `created_at_ms=this.now()`(`transitions.ts:56`)는
  clamp 없으나 신규행이라 선행값이 없고 schema는 `created_at_ms>=0`만 요구 → 위반 불가.

  **schema에 `completed_at_ms >= created_at_ms`나 delivery `*_at_ms >= created_at_ms` CHECK가 없다는 점을
  특별히 확인**(schema-v1.sql:60-63의 batches, :74-92의 deliveries — 오직 NULL/NOT NULL 상관 CHECK뿐).
  따라서 이 순서 불변은 오직 (a) 쓰기 시 `MAX(?, created_at_ms)` clamp와 (b) 디코더 `rows.ts:135`
  (`presentedAtMs < materializedAtMs` → corrupt), `rows.ts`의 `optionalTime(...,created)`가 지킨다. 쓰기가 이미
  clamp하므로 정상 경로는 그 corrupt를 만들지 않는다.

  재판정 결과: 1차의 "모든 at_ms 갱신이 MAX(?, created_at_ms)로 clamp되어 시계 역행이 CHECK를 깨지 못한다"는
  **참**이다. 확증:
  - 기존 시험 `dist/test/r12-ledger-transitions.test.js` 10개 전부 PASS(그중 "P0V-56 / R01, F1: every order of
    the wall clock across a delivery's stages is a valid history" 포함).
  - 자체 repro PART1: 시계를 1시간 되돌린 뒤 updateAgent(desired) → `updated_at_ms == created_at_ms`(clamp 확인).

- **transaction 경계 / COMMIT 실패.** `BEGIN IMMEDIATE`는 busy를 명시 재시도 후 `DB_BUSY`로, corruption 아닌
  실패를 corruption으로 삼지 않음(`store.ts:239-256`, P0V-69). `transaction()`은 콜백 동기성 강제
  (`assertSynchronousResult`, `transaction.ts:24-31`) → insertedIds 재조회 → `transitions.validatePending()` →
  `COMMIT`(`store.ts:258-274`). COMMIT이 throw하면 catch가 `ROLLBACK`을 감싸고 이미 롤백된 경우를 삼킨다.
  SQLite(WAL, synchronous=FULL, 단일 writer)에서 COMMIT 오류는 통상 미커밋을 뜻하고, 드물게 커밋 후 반환 전
  SIGKILL이면 그 operation 행은 durable로 남아 recovery sweep가 다시 읽는다(`reconcile.ts` snapshot/recoverable).
  즉 "COMMIT 실패=사실"로 단정하는 코드는 이 그룹에 없다(상태 단정은 상위 coordinator 소유, 그룹 밖).
  transaction 안 물리효과는 M-004로 금지되고 async 탈출은 `assertSynchronousResult`가 막음. 중첩 거부
  `store.ts:259`·`transaction.ts:44`.

- **operation state machine terminal 퇴행/ same-key 다른 hash/ frozen 재해석.** succeed/fail/unknown 모두
  `state IN ('pending','unknown')` 가드 + 정확히 1행 변경 검사(`operation-transitions.ts:56-58`,`:66-68`,`:74-76`).
  동일 결과 재적용은 no-op(`:52-54`,`:63-65`,`:72-73`), 다른 결과로의 terminal 재쓰기는 STORE_CORRUPT.
  `updatePlan`은 원 acceptance transaction·pending에서만(`operation-transitions.ts:39-45`, `transaction.ts:47-50`
  `requireUnaccepted`). same-key replay는 `classifyKey`가 request_hash로 retry/reused를 가름
  (`operation-journal.ts:34-37`) — 다른 hash는 retry가 못 되고 REQUEST_KEY_REUSED. UNIQUE(actor,request_key)
  + `REQUEST_KEY_REUSED`(`operation-transitions.ts:33`, `operation-journal.ts:44-53`). frozen payload/plan은
  디코딩 시 `requestHash` 재계산(`operation-codec.ts:216`)과 `validatePayloadRelation`(`:117-171`)으로
  재해석 불가(P0-1/INV03 부합).

- **reconcile 멱등성 / P0-5 / 무한루프.** 이 그룹 recover는 물리 handler(lifecycle/git/mail, 그룹 밖)만 호출하고
  스스로 pending→terminal로 올리지 않음(`reconcile.ts:161-176`). 스윕은 유한 snapshot 1회 순회 + resumeAfter
  회전 + no-progress backoff(monotonic `performance.now()` 기본, `operations.ts:53`) → 무한루프 없음
  (`operations.ts:66-102`). recover 후 상태 재조회, terminal일 때만 repaired 셈(`operations.ts:88-99`).
  corruption은 mutation gate를 닫고 원 사실 보존(`reconcile.ts:134-146`, P0-5). unknown은 관측 실패를 사실로
  올리지 않음(observeUnits의 `confirmDead` 재확인, `reconcile.ts:180-231`; `activeState==="unknown"`은
  outcome `unknown`으로 남김). `verdict`로 한 오류를 두 번 세지 않음(`operations.ts:56`,`:96-100`).
  backoff·budget은 벽시계가 아닌 monotonic 시계 기본이라 시계 역행 무해.

- **operation-codec / rows 디코딩 경계.** 손상 JSON은 STORE_CORRUPT(`operation-codec.ts:118-120`,`rows.ts:79`),
  알 수 없는 kind는 `isMutationMethod` 거부(`operation-codec.ts:195`), 추가/누락 컬럼은 키 개수+`hasOwn`로 거부
  (`operation-codec.ts:191-192`, `rows.ts:42-45`), 큰 정수/음수/NaN은 `safeInteger` 거부
  (`rows.ts:56-59`, `operation-codec.ts:110`), 빈/NUL/서러게이트 문자열은 `text()` 거부(`rows.ts:60-63`),
  existingCreation 순환은 `active` 집합으로 탐지(`operation-codec.ts:187`,`:210`). busy는 별도 `DB_BUSY`
  (`store.ts:363-366`)로 과잉 STORE_CORRUPT 없음.

- **request-cache 부분쓰기 / 캐시가 durable fact와 다른 답을 주는 경로.** body를 metadata보다 먼저 no-replace
  게시하고 body-only crash는 orphan으로 남겨 새 payload를 재구성하지 않음(`request-cache.ts:196-235`, `read`의
  orphan 판정 `:120-131`은 orphan body를 `corrupt`로). `updateReceipt`는 별도 `.lock` 파일로 read-modify-write를
  직렬화하고 stale/contradiction 순서를 존중해 오래된 관측이 최신을 덮지 못함(`request-cache.ts:216-248`).
  캐시는 durable ledger가 아니라 broker receipt의 기억(FS-003)이며 캐시 적중이 새 효과를 내지 않음.

- **두 broker / 외부 writer / 스키마 원자성.** schema는 `BEGIN EXCLUSIVE … PRAGMA user_version=1; COMMIT` 한
  트랜잭션(schema-v1.sql:6,107). `migrate()`는 readable 집합만 통과, 그 외 no-migration으로 fail-closed
  (`store.ts:203-227`). `preflightDatabase`는 sidecar/journal 잔재·별칭(nlink)·identity 변화를 관측해 열지
  않음(`store.ts:44-99`), 단 이는 startup writer fence를 외부가 이미 쥐었다는 전제 위의 관측임을 스스로 명시
  (`store.ts:39-42` 주석) — 단일 writer 강제 자체는 이 그룹 밖(§6).

## 6. 확인하지 못한 것

- **-01의 실서비스 성장 속도.** `usage`/`subscriptions`/`deliveries`가 실제로 얼마나 빨리 커지는지는 행을
  만드는 admission/quota 경로(그룹 밖)를 함께 돌려야 판정된다. 무제한성(LIMIT 부재·전량 구체화)은 repro로
  확정했으나, "언제 broker 메모리/지연이 실문제가 되는가"의 임계는 확인 못 함. 그래서 심각도를 Critical/High가
  아닌 Medium으로 둔다.
- **단일 writer 강제.** DB-002 "broker is the sole writer"는 런타임 전제다. 여러 broker/외부 writer 동시 open,
  WAL 삭제·잘림에 대한 실제 kill·restart 주입은 systemd/락 환경이 필요(절대 규칙 3)해 BLOCKED. preflight/락
  코드는 읽어 확인했으나 동시성 실물 시험은 못 돌림.
- **물리 recovery handler(lifecycle/git/mail).** pending을 증거 없이 승격하는지는 그룹 밖 파일이라 판정 대상
  아님. 이 그룹 reconcile는 그들을 호출만 하고 스스로 승격하지 않음을 확인.

## 7. 1차 보고(groups/G02-ledger.md)와의 차이

- **커버리지 줄 수:** 1차는 16개 중 15개 파일의 줄 수가 실제와 달랐다(store.ts 285 vs 실제 396,
  transitions.ts 152 vs 198, operation-transitions.ts 79 vs 77, operation-codec.ts 235 vs 264,
  operation-journal.ts 60 vs 59, rows.ts 180 vs 187, ledger-reader.ts 168 vs 228, transaction.ts 78 vs 71,
  facets.ts 78 vs 71, receipt-projector.ts 40 vs 36, reconcile.ts 250 vs 241, operations.ts 96 vs 104,
  preaccept.ts 120 vs 103, ports/ledger.ts 40 vs 30, request-cache.ts 250 vs 249; schema만 108로 일치).
  본 2차는 `wc -l` 실측값을 표에 적고 각 파일을 마지막 줄까지 읽어 마지막 줄 번호·내용 앞 20자를 기록했다.
- **핵심 주장 재판정:** 1차의 "모든 at_ms 갱신이 `MAX(?, created_at_ms)`로 clamp되어 시계 역행이 CHECK를 깨지
  못한다"를 UPDATE/INSERT 문 전부를 하나씩 다시 확인해 **참으로 확정**한다(§5, store.ts:308/313,
  transitions.ts:69/79/152/159/193, operation-transitions.ts:41/56/66/74, 신규 INSERT 단일 시계 읽기
  포함). 시험 실행(r12 10개 PASS)과 자체 repro(PART1 clamp)로 확증. 1차가 줄 수를 틀렸음에도 이 결론 자체는
  옳았다. 특히 지시받은 batches.completed_at_ms(transitions.ts:152, schema에 순서 CHECK 없음 — clamp가
  유일 방어), deliveries의 *_at_ms(69/79/159), agents.updated_at_ms(308/313), usage.updated_at_ms(193),
  그리고 store.ts 286–396행(updateAgent·operation 위임·validDesiredTransition)과 transitions.ts 153–198행
  (completeBatch 후반·reserveUsage·settleUsage)을 개별 확인했다.
- **격상된 발견:** 1차가 §6에 "확신도 low, 새 결함으로 올리지 않음"으로 남긴 무제한 목록 쿼리를, 본 2차는
  전량 구체화를 repro로 확정하고 삭제되지 않는 usage/deliveries 성장원과 핫 경로 호출자(public-dispatcher
  요청마다 listAgents)를 짚어 **Medium 결함(G02-ledger-r2-01)**으로 격상한다. 진단 경로엔 예산이 있고 운영
  경로엔 없다는 비대칭이 근거.
- **재확인된 발견:** RequestCache metadata 읽기 상한 부재(1차 -01 ≙ 2차 -02, Low)와 시계 소스 이원화
  (1차 -02 ≙ 2차 -03, Info)는 동일하게 재확인.
- **차이 없는 부분:** transaction 경계, operation state machine, reconcile 멱등성, codec/rows 경계,
  request-cache 부분쓰기, 스키마 원자성 판정은 1차와 같은 결론(문제없음). 단 본 2차는 줄 번호를 실제 파일에
  맞춰 갱신했다.
