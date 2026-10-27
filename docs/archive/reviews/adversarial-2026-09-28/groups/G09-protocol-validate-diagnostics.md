# G09-protocol-validate-diagnostics 적대적 검증 결과

저장소 `/home/dev/oma-v2`, HEAD `070a52d`. 코드 미수정. 재현 스크립트는
`review/adversarial-2026-09-28/repro/G09-protocol-validate-diagnostics/` 아래에 있고
`dist/src/...`를 import해 실제 실행했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막 읽은 줄 · 앞 20자) |
|---|---|---|---|
| src/protocol/batch-view.ts | 129 | 예 | 129 `    );` (encodeBatchView 끝) |
| src/protocol/byte-queue.ts | 54 | 예 | 54 `}` (ByteQueue 끝) |
| src/protocol/channel.ts | 189 | 예 | 189 `}` (keyOf 끝) |
| src/protocol/host-api.ts | 38 | 예 | 38 `}` (hostApiHelloProblem 끝) |
| src/protocol/host-channel.ts | 104 | 예 | 104 `}` (HostChannelReader 끝) |
| src/protocol/host-guest.ts | 287 | 예 | 287 `}` (parseResize/egress 끝) |
| src/protocol/jsonl.ts | 89 | 예 | 89 `  close(): void { if (` (JsonlReader.close) |
| src/protocol/log-response.ts | 71 | 예 | 71 `}` (boundedLogResponse 끝) |
| src/protocol/methods.ts | 428 | 예 | 428 `}` (resourceCategoryOf 끝) |
| src/protocol/operation-results.ts | 27 | 예 | 27 `}` (submitResult 끝) |
| src/protocol/principal-credential.ts | 73 | 예 | 73 `}` (sameFixedString 끝) |
| src/protocol/receipt-codec.ts | 113 | 예 | 113 `}` (decodeReceipt 끝) |
| src/protocol/receipts.ts | 31 | 예 | 31 `}` (receiptLines 끝) |
| src/protocol/request-codec.ts | 31 | 예 | 31 `}` (decodeMutationPayload 끝) |
| src/protocol/response-codec.ts | 88 | 예 | 88 `}` (decodeRpcReply 끝) |
| src/protocol/run-lease.ts | 81 | 예 | 81 `}` (assertValidatedRunLease 끝) |
| src/protocol/status-view.ts | 76 | 예 | 76 `}` (decodeStatusView 끝) |
| src/validate.ts | 417 | 예 | 417 `}` (ok 끝) |
| src/pi-extension.ts | 39 | 예 | 39 `}` (extension 끝) |
| src/diagnostics/files.ts | 166 | 예 | 166 `}` (NodeIntegrityFiles 끝) |
| src/diagnostics/integrity.ts | 161 | 예 | 161 `}` (inspectIntegrity 끝) |
| src/diagnostics/ledger.ts | 197 | 예 | 197 `}` (inspectLedger 끝) |
| src/diagnostics/mail.ts | 28 | 예 | 28 `}` (mailHeadersMatch 끝) |

`wc -l` 값(위 표)은 `wc -l` 실제 실행 결과. 호출 경로 확인을 위해 그룹 밖의
`src/domain/canonical-json.ts`, `src/domain/request-identity.ts`, `src/frame.ts`,
`src/request-cache.ts`, `src/cli/cache-codec.ts`, `src/broker/public-dispatcher.ts`,
`src/mail.ts`, `src/git/submit.ts`, `src/storage/operation-codec.ts`도 읽었다.

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G09-01 | Low | structural | 무제한 재귀 codec(`snapshotJson`/`canonicalJson`)를 부르는 export가 RangeError를 계약에 없는 형태로 던지고, 안전은 전적으로 호출자별 방어에 의존 | confirmed |
| G09-02 | Info | structural | `decodeMutationPayload`의 선언된 throw 타입(TypeError)과 실제(RangeError) 불일치 — 이름 없는 전제(P0-6) | confirmed |

High 이상 없음.

## 3. 발견 상세

### G09-01 admission·replay 경로가 무제한 재귀 codec에 깊이 무방비로 노출되나, 현행 호출자는 모두 방어되어 있음

- 심각도: Low
- 분류: structural / resource(경계)
- 위반 규칙: 없음(직접 위반 아님). P0-6(이름 없는 특수처리·전제)에 인접.
- 코드 경로:
  `src/protocol/request-codec.ts:21` `decodeMutationPayload`(→ `snapshotJson`)
  → `src/domain/canonical-json.ts:16` `snapshotJson`(무제한 재귀)
  및 `src/domain/canonical-json.ts:58` `appendCanonical`(무제한 재귀)
  ← `src/domain/request-identity.ts:35,59` `canonicalRequestParams`/`buildRequestIdentity`
  ← `src/git/submit.ts:83`, `src/mail.ts:57`, `src/storage/operation-codec.ts:210`.
- 원인: `snapshotJson`(visit)과 `appendCanonical`은 JSON 값을 깊이 제한 없이 재귀
  순회한다. V8의 `JSON.parse`는 반복형이라 깊이 100만에도 예외를 던지지 않으므로
  (repro `deep-nesting.mjs`: `JSON.parse array depth 1000000: OK`), 깊이 제한은
  이 두 함수의 스택뿐이다. 깊이 약 5000에서 `RangeError: Maximum call stack size
  exceeded`가 난다(repro: `snapshotJson array depth 5000: RangeError`,
  `canonicalJson object depth 5000: RangeError`). 깊이 5000짜리 배열은 약 10KB로
  frame 한계(256KB) 안이다.
- 영향: 이 RangeError가 방어 없는 자리에서 나면 프로세스 크래시가 될 수 있고, 그러면
  관측 실패(unknown)를 승격하는 P0-5 상황을 유발할 여지가 있다. **그러나 G09 담당
  경로에서 실제로 도달하는 자리는 모두 방어되어 있음을 재현으로 확인했다:**
  1. broker 공개 admission: frame → `parseJsonObject`(`src/frame.ts`)의
     `JSON.parse` **reviver**가 깊은 중첩에서 먼저 `RangeError`를 내고 `feed`가 이를
     `FrameError("INVALID_REQUEST")`로 잡아 parser를 poison한다. `ConnectionDecoder.push`는
     이를 `{kind:"invalid", code:"INVALID_REQUEST"}` 이벤트로 바꿔 **던지지 않는다**
     (repro `frame-reviver.mjs`: `ConnectionDecoder.push(deep): ["invalid/INVALID_REQUEST"]`).
  2. reviver를 통과할 얕은(≈2000) 깊이라도 `checkObject`(validate.ts)가 hashing 전에
     스택오버플로 없이 거절한다(repro `validate-depth.mjs`:
     `mailParamsCheck(deep-object-root): err=missing field "to"`,
     `decodePublicParams(mail.ack, deep): null(rejected)`). 검증을 통과하는 params는
     스키마가 얕아 이후 `canonicalRequestParams`도 얕다.
  3. cache/receipt codec은 `snapshotJson`을 try/catch로 감싸 RangeError(=Error)를
     `{ok:false}`/corrupt로 바꾼다(repro `entry-points.mjs`:
     `decodeReceipt(deep): ok=false`, `decodeCachedRequest`도 동일 구조).
  4. `git.submit`/`context.publish`/`operation-codec`의 `decodeMutationPayload`는
     모두 try/catch로 감싸 INVALID_REQUEST/corrupt로 변환한다.
- 최소 반례: 깊이 100000 배열을 in-memory로 `decodeMutationPayload("mail.ack", v)`에
  직접 넘기면 `RangeError`가 **미포착**으로 던져진다(repro `entry-points.mjs`:
  `decodeMutationPayload(deep): RangeError (RangeError=true, TypeError=false)`).
  현행 호출자는 이를 감싸지만, export 자체는 무방비다.
- 재현 방법: `node deep-nesting.mjs`, `node entry-points.mjs`, `node validate-depth.mjs`,
  `node frame-reviver.mjs` (모두 review/.../repro/G09-.../ 아래). 관측 출력은 위 인용.
- 확신도: confirmed (재귀 크래시 재현 및 각 호출자 방어 재현).
- 개선 방향(코드 수정 아님, 방향만): 깊이 제한을 무제한 재귀 codec 자체에 두거나
  (G08의 canonical-json 발견과 한 owner로 묶어), admission 경계에서 명시적 최대 중첩
  깊이를 하나의 이름 있는 계약으로 강제하면, "모든 호출자가 알아서 방어한다"는 이름
  없는 전제(P0-6)를 없앨 수 있다. 지금은 방어가 세 층(frame reviver, checkObject,
  호출자 try/catch)에 흩어져 있어 새 호출자가 하나만 빠뜨려도 크래시가 된다.

### G09-02 `decodeMutationPayload`의 계약 throw 타입과 실제 throw 타입 불일치

- 심각도: Info
- 분류: structural
- 위반 규칙: 없음. P0-6.
- 코드 경로: `src/protocol/request-codec.ts:22,28`은 `throw new TypeError(...)`만
  명시하나, 첫 줄 `snapshotJson(value)`가 깊은 입력에서 `RangeError`를 던진다.
- 원인: 함수가 던질 수 있는 오류 종류가 문서/코드 표면에 드러나지 않는다.
- 영향: `catch (e instanceof TypeError)` 식으로 좁게 잡는 미래 호출자가 RangeError를
  놓칠 수 있다. 현행 호출자는 모두 무조건 catch라 실질 영향 없음.
- 재현 방법: `node entry-points.mjs` — `RangeError=true, TypeError=false`.
- 확신도: confirmed.
- 개선 방향: G09-01과 함께, 깊이 제한을 codec 안에서 정의된 오류로 정규화.

## 4. 리팩터링 필요 지점

- 무제한 재귀 방어의 owner가 없다(P0-2/P0-6). `snapshotJson`/`canonicalJson`의 깊이
  안전은 frame reviver·`checkObject`·호출자 try/catch 세 곳이 우연히 함께 막고 있다.
  G08이 지적한 `canonical-json.ts:16,58`의 무제한 재귀를 한 곳에서 bound하는 것이
  구조적으로 옳다(본 G09 발견은 그 재귀가 실제 admission 경로에서는 현재 막혀 있음을
  확인·보강한다).

## 5. 점검했고 문제없다고 판단한 것 (공격했지만 막힌 경로, 근거 줄)

- **깊은 중첩 params가 hashing(request identity) 전에 멈추는가 (브리프 핵심 질문):**
  멈춘다. broker 경로는 `frame.ts`의 `parseJsonObject` reviver(RangeError→FrameError
  INVALID_REQUEST, `frame.ts` feed의 catch)와 `validate.ts:34` `checkObject`(깊이
  거절)로 hashing 전에 차단된다. cache/receipt는 try/catch로 흡수. 재현:
  `validate-depth.mjs`, `frame-reviver.mjs`, `entry-points.mjs`.
- **prototype 오염 (`__proto__`/constructor):** `receipt-codec.ts:76,96`의 closed-object
  검사가 `__proto__`를 unknown 키로 거절, `canonical-json.ts:41`은 `defineProperty`로
  literal `__proto__`를 프로토타입 설정 없이 보존. `Object.prototype`이 오염되지
  않음(repro `codec-fuzz.mjs`: `Object.prototype.polluted after: undefined`,
  `requestProblem __proto__: unknown field __proto__`, run-lease는 `AUTH_FAILED`).
- **중복 key (평문·이스케이프 표기):** `frame.ts` `findDuplicateKey`가 `\u0061`=`a`도
  중복으로 잡음(repro `boundaries.mjs`: `dup escaped: a`, `parse dup: rejected
  INVALID_REQUEST`).
- **receipt 승격 의미 (P0-5):** `receipt-codec.ts:receiptSupersession`이 `unknown`을
  terminal로 승격하지 않고(`succeeded→failed`=contradiction, `failed→unknown`=stale,
  `null→unknown`=supersedes), TERMINAL 집합은 succeeded/failed만(repro `codec-fuzz.mjs`).
  `receiptNotFound`(receipts.ts)는 빈 operation+REQUEST_NOT_FOUND로만 해석되고 다른
  코드는 거절(repro `boundaries.mjs`: `empty operation is reserved for REQUEST_NOT_FOUND`).
  receipt 버전/adapter revision을 현재 권한·설정으로 재해석하는 분기는 이 파일들에
  없다(P0-1 부합).
- **타입 혼동/경계값:** `checkInt`는 numeric string·NaN·Infinity·MAX_SAFE+1 거절
  (repro `boundaries.mjs`). `decodeRunLease`(run-lease.ts:35)는 incarnation="5"·0·4번째
  키(`__proto__`)를 `AUTH_FAILED`로 거절. `credentialMatches`는 길이·타입 검사 후
  상수시간 비교(principal-credential.ts:sameFixedString).
- **ReDoS/유니코드:** validate.ts의 정규식은 중첩 수량자가 없어 100000자 입력도 0ms
  (repro `boundaries.mjs`). `checkString`은 unpaired surrogate 거절.
- **byte-queue/channel/host-channel 버퍼·backpressure:** `byte-queue.ts:ownRemainder`가
  retained budget 초과 시 RangeError, `channel.ts`는 in-flight 1건 제한(`LIMIT_EXCEEDED`)
  ·inboundBytes 한계·drain 기반 backpressure·close 시 listener 제거+late error 무해화.
  `jsonl.ts`는 line 한계 초과를 skip(bounded memory)하거나 FRAME_TOO_LARGE, poisoned
  상태로 재진입 차단. `host-channel.ts`는 128B line 한계·ASCII grammar·broken 후 무수신.
- **methods.ts 권한/분류:** `PUBLIC_METHODS`/`INTERNAL_METHODS`가 닫힌 레지스트리이며
  `resourceCategoryOf`(methods.ts:끝)는 미등록 method에 fallback 없이 UNKNOWN_METHOD를
  던진다(기본 허용 아님). `internalEnvelopeProblem`은 exact-key 검사.
  `agent.stop`만 `safety-control`, 나머지 mutation은 `admit`로 분류됨을 확인.
- **diagnostics P0-5/DR13:** `files.ts`/`integrity.ts`/`ledger.ts`가 관측 실패를
  `unknown`(OBSERVER_FAILED, *_UNAVAILABLE)으로, absent/corrupt와 구분해 보고하고,
  `DiagnosticLedger.report`(ledger.ts)는 unknown이 있으면 status UNKNOWN, 관측 실패를
  PASS로 승격하지 않는다. 진단은 read-only(주석·`observe`가 잡는 예외를 unknown으로,
  쓰기/락 없음). `maxRows`/`maxIssues`/`maxEntries`/`maxFileBytes`로 큰 입력을 bound.
  integrity의 판정은 storage owner(`decodeOperation`, `decodeBatchManifest` 등)를 재사용
  하고 자체 재판정을 하지 않음(P0-2 부합).
- **status-view/log-response/batch-view:** 모두 schema 고정·society 일치·surrogate 안전
  경계 절단(log-response `prefix`)·frame 한계 준수. staleness는 reader(시계 owner)에게
  위임(P0-1: 시계=권한/관측 분리).
- **pi-extension.ts:** 순수 조립. 동적 로드 없이 정적 import만. workspace는
  `realpathSync(cwd)`. OMA runtime import 없음(주석의 extension-closure).

## 6. 확인하지 못한 것

- broker 소켓 서버(그룹 밖)가 `ConnectionDecoder`의 `{kind:"invalid"}` 이벤트를 받은
  뒤 연결만 닫고 프로세스는 유지하는지의 최종 확인은 소켓 계층(다른 그룹) 소관이라
  코드만 읽고 실행하지 않았다. `ConnectionDecoder.push`가 던지지 않는 것까지는 확인.
- `operation-codec.ts:210`의 `requestHash(kind, payloadRaw)`가 try/catch 밖이지만,
  선행 `decodeMutationPayload` 성공은 payload가 얕은 스키마임을 뜻하므로 실무상
  bound된다. 손상 DB에 극단 깊이 payload_json이 있고 그것이 `decodeMutationPayload`를
  통과하는 시나리오는 없다고 판단하나, DB 손상 주입까지는 재현하지 않았다(추론).
- host-guest/host-api/terminal 프레이밍의 실제 vsock 왕복은 환경(macOS/guest)이 없어
  codec 순수 함수 수준만 검증했다.
