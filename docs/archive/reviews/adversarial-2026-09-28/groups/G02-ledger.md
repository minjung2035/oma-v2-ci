# G02-ledger 적대적 검증 결과

검토 대상 HEAD `070a52d`, branch `feat/macos-hidden-vm`. 코드 수정·build/test 실행 없음.
재현 스크립트는 `review/adversarial-2026-09-28/repro/G02-ledger/` 아래 두 개(`clock-and-state.mjs`,
`schema-atomicity.mjs`)이고 `dist/src/...`를 import해 실제 실행했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 |
|---|---|---|---|
| src/store.ts | 285 | 예 | preflight·migrate·transaction·write API 전부 |
| implementation/schema-v1.sql | 108 | 예 | CHECK·인덱스·user_version·DB-001/002 |
| src/storage/transitions.ts | 152 | 예 | delivery/batch/usage 전이, `now` 주입 인자 |
| src/storage/operation-transitions.ts | 79 | 예 | operation state machine SQL |
| src/storage/operation-codec.ts | 235 | 예 | 디코딩·payload/plan/relation 검증 |
| src/storage/operation-journal.ts | 60 | 예 | classifyKey/accept 멱등 |
| src/storage/rows.ts | 180 | 예 | 전 행 디코더·경계값 |
| src/storage/ledger-reader.ts | 168 | 예 | SELECT-only, rowid 정렬, lineage |
| src/storage/transaction.ts | 78 | 예 | AsyncLocalStorage scope, Promise 거부 |
| src/storage/facets.ts | 78 | 예 | read/write facet 바인딩 |
| src/storage/receipt-projector.ts | 40 | 예 | receipt 투영 |
| src/reconcile.ts | 250 | 예 | startup/sweep/quiesce/observeUnits |
| src/reconcile/operations.ts | 96 | 예 | 스윕 순서·backoff·verdict |
| src/reconcile/preaccept.ts | 120 | 예 | preaccept artifact 수거 |
| src/ports/ledger.ts | 40 | 예 | 포트 타입만(런타임 없음) |
| src/request-cache.ts | 250 | 예 | freeze/replay/updateReceipt/lock |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G02-ledger-01 | Low | resource | RequestCache 메타데이터 읽기에 크기 상한 없음 | high |
| G02-ledger-02 | Info | structural | `Date.now()` 직접 호출과 주입 가능한 `now`의 혼재(store.ts vs transitions.ts) | confirmed |

## 3. 발견 상세

### G02-ledger-01 RequestCache 메타데이터 읽기에 크기 상한 없음
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음(자원 고갈, sandbox 자기 프로세스 한정)
- 코드 경로: `src/request-cache.ts:57`(`readCacheFile`) ← `src/request-cache.ts:118`
  (`readMetadata` → `this.reader(this.path(key))` — `expectedBytes` 미전달) ← `read`/`prepareReplay`/`updateReceipt`
- 원인: `readCacheFile`은 `expectedBytes`가 주어질 때만 `stat.size` 상한을 검사한다(`request-cache.ts:64`).
  body 읽기(`readBody`)는 `expected.bytes`를 넘겨 상한이 있으나, 메타데이터(`.json`) 읽기는 상한 인자 없이
  `readFileSync(fd)`로 파일 전체를 메모리에 올린다(`request-cache.ts:66`). 이 캐시는 FS-003 "private
  model-mutable preaccept cache"로 모델이 sandbox 안에서 직접 쓰는 파일이다(`src/cli/request-service.ts:15`,
  `HOME` 기반). 프레임 크기 상한(`frame.ts`의 `FrameParser`/`ConnectionDecoder`)은 wire 경로에만 걸리고
  이 로컬 파일 읽기에는 걸리지 않는다.
- 영향: 모델이 자기 키 경로에 매우 큰 `.json`을 두면 자신의 `oma` CLI 프로세스(request-service)가 그
  파일을 통째로 읽어 메모리를 소모한다. broker 프로세스나 durable ledger에는 닿지 않는다. 확정된 사실의
  의미를 바꾸지 못하고, 다른 agent에도 번지지 않는다(각 sandbox의 `HOME`이 분리). 그래서 P0 위반이 아니라
  자기 자신에 국한된 자원 문제다.
- 최소 반례: sandbox 안에서 `$HOME/.local/state/oma/requests/<validkey>.json`에 수백 MB의 유효 JSON
  객체를 쓴 뒤 같은 키로 `oma` mutation을 재생하면 `readMetadata`가 전체를 읽는다.
- 재현 방법: 추론만. 코드 경로는 위와 같이 끝까지 확인했다. 실제 대용량 파일 생성은 sandbox 밖에서
  의미가 없어(신뢰 경계상 self-inflicted) 스크립트로 만들지 않았다. body 경로에는 상한이 있고 메타데이터
  경로에는 없다는 비대칭은 `request-cache.ts:64`와 `:118`의 직접 대조로 확정.
- 확신도: high(코드 경로 확정, 영향 범위는 sandbox 자기 프로세스로 한정)
- 개선 방향: body와 같은 방식으로 메타데이터 읽기에도 유한한 바이트 상한을 두는 방향. durable fact가 아닌
  로컬 관측이므로 상한 초과는 `corrupt`가 아니라 `unavailable`/거부로 두는 편이 P0-5와 맞는다.

### G02-ledger-02 `Date.now()` 직접 호출과 주입 가능한 `now`의 혼재
- 심각도: Info
- 분류: structural
- 위반 규칙: 없음
- 코드 경로: `src/storage/transitions.ts:60`(`private readonly now: () => number = Date.now`) vs
  `src/store.ts:203`(`insertAgent` 직접 `Date.now()`), `:224`/`:229`(`updateAgent`),
  `src/storage/operation-transitions.ts:31`(`insert`), `:41`/`:52`/`:63`/`:73`(succeed/fail/unknown/updatePlan)
- 원인: `LedgerTransitions`는 시계를 주입 가능한 인자로 받지만 `Store`는 생성 시 그 인자를 주지 않아 기본
  `Date.now`가 쓰인다. `Store.insertAgent`/`updateAgent`와 `OperationTransitions`는 `Date.now()`를 직접
  부른다. 즉 시계 주입 경로가 절반만 존재한다. 이 자체는 결함이 아니다 — 아래 §5에서 확인했듯 모든 갱신이
  `MAX(?, created_at_ms)`로 시계 역행을 clamp하기 때문에 durable 불변조건은 지켜진다.
- 영향: 없음(정확성). 시험이 시계 역행 경계를 주입으로 덮으려 할 때 절반은 monkeypatch에 의존해야 하는
  구조적 마찰만 있다(P0-7 시험 주입의 편의 문제).
- 최소 반례: 없음.
- 재현 방법: 위 줄 번호 직접 대조.
- 확신도: confirmed
- 개선 방향: 시계를 한 owner(예: Store 생성자 주입값)에서 받아 `OperationTransitions`·`insertAgent`·
  `updateAgent`까지 같은 함수로 전달하면 P0-7 주입 시험이 monkeypatch 없이 모든 at_ms 경계를 덮는다.

## 4. 리팩터링 필요 지점

- 시계 소스 일원화(G02-ledger-02). 지금은 `transitions.ts`만 주입 가능하고 `store.ts`·
  `operation-transitions.ts`는 직접 `Date.now()`. 정확성 문제는 아니나 P0-7 주입 시험의 결을 위해 한 곳으로.
- RequestCache의 body/metadata 읽기 상한 비대칭(G02-ledger-01). 두 읽기가 같은 유한 상한 규칙을 쓰도록.

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **시계 역행 vs schema CHECK.** 모든 at_ms 갱신이 `MAX(?, created_at_ms)`(및 presentation은
  `MAX(?, created_at_ms, materialized_at_ms)`)로 clamp한다: `transitions.ts:78`(materialize),
  `:86`(acknowledge), `:118`(batch completion), `:126`(presentation), `:143`(settleUsage);
  `operation-transitions.ts:41`(updatePlan),`:52`(succeed),`:63`(fail),`:73`(unknown);
  `store.ts:225`/`:230`(updateAgent). 신규 insert는 한 이벤트에서 시계를 한 번 읽어 created=updated로 넣는다:
  `store.ts:205`(insertAgent), `operation-transitions.ts:31`(insert), `transitions.ts:105`(prepared batch),
  `:137`(reserveUsage). 따라서 역행/점프가 `updated_at_ms >= created_at_ms`, delivery/batch의 at_ms
  관계, `completed_at_ms` CHECK 어느 것도 깨뜨리지 못한다. 재현: `repro/G02-ledger/clock-and-state.mjs`
  — `MAX(?, created_at_ms)`가 rewound 500을 1000으로 clamp(PASS), naive UPDATE는 CHECK 위반(negative
  control PASS). 디코더도 `presentedAtMs < materializedAtMs`를 손상으로 잡되(`rows.ts:151`) 쓰기가 이미
  clamp하므로 정상 경로에서 그 손상은 만들어지지 않는다. 시계 역행이 STORE_CORRUPT나 영구 정지로 번지지 않음.
- **transaction 경계.** `BEGIN IMMEDIATE`는 busy를 명시적 재시도 후 `DB_BUSY`로 두고, corruption이 아닌
  실패를 corruption으로 삼지 않는다(`store.ts:157-176`, P0V-69 주석). COMMIT은 콜백이 동기임을 강제한
  뒤(`assertSynchronousResult`, `transaction.ts:26`) 실행되고, 예외 시 `ROLLBACK`을 감싸며 이미 롤백된
  경우를 삼킨다(`store.ts:196`). COMMIT 실패를 '실패'로 단정하는 코드는 이 그룹에 없다 — COMMIT 후 상태
  단정은 상위 coordinator 소유(그룹 밖). transaction 안에서 파일/host 효과 금지는 M-004로 명문화되고
  `assertSynchronousResult`가 async 탈출을 막는다(`transaction.ts:20-27`). 중첩은 `store.ts:181`·
  `transaction.ts:56`에서 거부.
- **operation state machine terminal 퇴행.** succeed/fail/unknown 모두 `state IN ('pending','unknown')`
  가드와 정확히 1행 변경 검사를 쓴다(`operation-transitions.ts:56`,`:67`,`:76`). 동일 결과 재적용은
  no-op(`:47`,`:60`,`:71`), 다른 결과로의 terminal 재쓰기는 STORE_CORRUPT. `updatePlan`은 원 acceptance
  transaction에서만, pending 상태에서만 허용(`operation-transitions.ts:35-42`, `transaction.ts:47`
  `requireUnaccepted`). same-key replay는 `classifyKey`가 request_hash로 retry/reused를 가르므로 다른
  hash가 같은 결과를 얻지 못한다(`operation-journal.ts:35-38`). request_key 충돌은 UNIQUE(actor,request_key)
  + `REQUEST_KEY_REUSED`(`operation-transitions.ts:33`, `operation-journal.ts:47-52`). frozen payload/plan은
  디코딩 시 `requestHash`·`validatePayloadRelation`으로 재해석 불가(`operation-codec.ts:186`,`:110-160`,
  P0-1/INV03 부합).
- **reconcile 멱등성/증거 없는 승격.** 이 그룹의 recover는 물리 handler(lifecycle/git/mail, 그룹 밖)만
  호출하고, 스스로 pending을 failed/succeeded로 올리지 않는다. 스윕은 유한 snapshot 1회 순회, resumeAfter
  회전, no-progress backoff로 무한루프 없음(`operations.ts:60-96`). recover 후 상태를 다시 읽어 terminal일
  때만 repaired로 셈(`operations.ts:80-90`). corruption은 mutation gate를 닫고 원 사실을 보존
  (`reconcile.ts:143-155`, P0-5). unknown은 관측 실패를 사실로 올리지 않음(`reconcile.ts` observeUnits의
  `confirmDead` 재확인, `:196`,`:216`).
- **operation-codec/rows 디코딩 경계.** 손상 JSON은 STORE_CORRUPT(`operation-codec.ts:104`,
  `rows.ts:73`), 알 수 없는 kind는 `isMutationMethod`로 거부(`operation-codec.ts:170`), 추가/누락 컬럼은
  키 개수+`hasOwn`로 거부(`operation-codec.ts:167`, `rows.ts:47`), `__proto__`는 `snapshotJson`이
  `defineProperty`로 중화(`canonical-json.ts:43-45`, 프로토타입 오염 없음), 큰 정수/음수/NaN은
  `safeInteger`·frame reviver로 거부(`rows.ts:56`, `frame.ts:65`). 과잉 STORE_CORRUPT 없음: busy는 별도
  `DB_BUSY`(`store.ts:32`,`:250`).
- **request-cache 부분쓰기·durable fact 불일치.** body를 metadata보다 먼저 no-replace 게시하고, body-only
  crash는 orphan으로 남겨 새 payload를 재구성하지 않음(`request-cache.ts:206-233`, `read`의 orphan 판정
  `:127-136`). `updateReceipt`는 파일 락으로 read-modify-write를 직렬화하고, stale/contradiction 순서를
  존중해 오래된 관측으로 최신을 덮지 않음(`request-cache.ts:238-262`). 캐시는 durable ledger가 아니라
  broker receipt의 기억일 뿐(FS-003), 캐시 적중이 durable fact와 다른 결과를 주도록 새 효과를 내지 않음.
- **DB-001 스키마 적용 원자성/user_version.** 스키마는 `BEGIN EXCLUSIVE … PRAGMA user_version=1; COMMIT`
  한 트랜잭션. `migrate()`는 readable 집합만 통과시키고 그 외는 no-migration으로 fail-closed
  (`store.ts:135-155`). preflight는 sidecar/journal 잔재·별칭·identity 변화를 관측해 열지 않음
  (`store.ts:44-96`). 재현: `repro/G02-ledger/schema-atomicity.mjs` — COMMIT 미도달 시 user_version=0
  롤백(PASS), Store가 v1 적용 후 재열기 멱등(PASS).
- **무제한 쿼리/메모리.** ledger-reader의 전 목록 쿼리는 rowid/name 정렬로 나오되 별도 LIMIT은 없다
  (`ledger-reader.ts` agents/usages/subscriptions/pendingWorkRows). 그러나 broker가 유일 writer이고 행 수는
  admission으로 제한되며, 관리자용 진단 읽기에는 명시적 row/byte 예산이 있다(`store.ts:106`
  `readDiagnosticSnapshot`, `LIMIT_EXCEEDED`). 운영 경로의 무제한 목록은 이 그룹에서 새 위반으로 볼 근거를
  찾지 못했다(§6 참조).

## 6. 확인하지 못한 것

- 운영 목록 쿼리(`listAgents`/`usageRows`/`allSubscriptions`/`pendingWorkRows`)에 LIMIT이 없다는 점이 큰
  ledger에서 broker 메모리 압박이 되는지는, 행 수를 실제로 키우는 admission/quota 경로(그룹 밖)를 함께
  보아야 판정 가능하다. 진단 경로에는 예산이 있으나(`store.ts:106`) 운영 경로에는 없어, 이 비대칭이 의도된
  것인지 확인하지 못했다. 확신도 low — 새 결함으로 올리지 않고 여기 남긴다.
- 여러 broker/외부 writer 동시 open, WAL 삭제·잘림에 대한 실제 kill·restart 주입은 systemd/락 환경이
  필요해(절대 규칙 3) 이 그룹에서 실행하지 못했다. preflight/락은 코드로 확인했으나 동시성 실물 시험은
  BLOCKED.
- 물리 recovery handler(lifecycle/git/mail reconcile)가 pending을 증거 없이 승격하는지는 그룹 밖 파일이라
  판정 대상이 아니다. 이 그룹의 reconcile는 그들을 호출만 하며 스스로 승격하지 않음을 확인했다.
