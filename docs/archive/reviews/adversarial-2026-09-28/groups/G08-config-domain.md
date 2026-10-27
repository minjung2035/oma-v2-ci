# G08-config-domain 적대적 검증 결과

저장소 `/home/dev/oma-v2`, HEAD `070a52d`. 코드 수정·build/test 실행 없음. 재현 스크립트는
`review/adversarial-2026-09-28/repro/G08-config-domain/` 아래 `.mjs`이며 `dist/src/...`를 import해 실행했다.

## 1. 커버리지

`wc -l` 값과, read 도구로 마지막 줄까지 읽어 확인한 최종 줄 내용의 앞 20자. (표시된 파일 중
`src/config.ts`, `src/domain/canonical-json.ts`는 마지막 줄에 개행이 없어 실제 마지막 코드 줄
번호는 `wc -l`+1이며, read 도구로 그 마지막 줄까지 전부 확인함.)

| 파일 | 줄 수 | 전부 읽음 | 비고(마지막 줄 내용 앞 20자) |
|---|---|---|---|
| src/config.ts | 249 | 예 | `}` (마지막: `return validatedSnapshot(...)` 종료 `}`) |
| src/config/defaults.ts | 158 | 예 | `}` (defaultHostConfig 종료) |
| src/config/generations.ts | 600 | 예 | `}` (collectTemporaries 종료) |
| src/config/operations.ts | 422 | 예 | `}` (readSource 종료) |
| src/config/policy.ts | 52 | 예 | `}` (createChildSpecResolver 종료) |
| src/domain/admission.ts | 41 | 예 | `export function obse` (observeStoreFailure) |
| src/domain/canonical-json.ts | 93 | 예 | `}` (sha256Hex 종료) |
| src/domain/capabilities.ts | 40 | 예 | `}` (capabilityCheck 종료) |
| src/domain/child-policy.ts | 41 | 예 | `}` (resolveChildSpec 종료) |
| src/domain/context-policy.ts | 121 | 예 | `}` (contextFileCheck 종료) |
| src/domain/deployment.ts | 40 | 예 | `}` (isDeploymentDigest 종료) |
| src/domain/derived.ts | 179 | 예 | `}` (isMailObjectRelativePathFor 종료) |
| src/domain/errors.ts | 316 | 예 | `}` (errorExit 종료) |
| src/domain/exhaustive.ts | 4 | 예 | `}` (assertNever 종료) |
| src/domain/identifiers.ts | 120 | 예 | `}` (parseMessageId 종료) |
| src/domain/integer-fields.ts | 32 | 예 | `}` (integerFieldsCheck 종료) |
| src/domain/limits.ts | 37 | 예 | `}` (isProtocolLimits 종료) |
| src/domain/lineage.ts | 75 | 예 | `}` (assertCreateCapacity 종료) |
| src/domain/mail-values.ts | 79 | 예 | `}` (isExactCandidateIdentity 종료) |
| src/domain/persisted-formats.ts | 115 | 예 | `}` (oidMatchesFormat 종료) |
| src/domain/request-identity.ts | 94 | 예 | `}` (firstRequestProjectionMismatch 종료) |
| src/domain/resources.ts | 53 | 예 | `}` (assertStorageQuotaSupported 종료) |
| src/domain/spec-identity.ts | 15 | 예 | `}` (resolvedSpecDigest 종료) |
| src/domain/tool-surface.ts | 227 | 예 | `}` (depthOf 종료) |
| src/domain/utf8.ts | 23 | 예 | `}` (decodeUtf8 종료) |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G08-01 | Medium | resource | canonical-json/request-identity 깊은 중첩 재귀에 depth 상한이 없어 StoreError 아닌 RangeError로 던진다 | confirmed(도메인 함수 수준), 도달성 medium |
| G08-02 | Low | boundary | `unitNameFor` 파생 이름이 society/kind 경계에서 서로 다른 두 소유자에게 같은 문자열이 될 수 있다 | confirmed (known-limitation) |
| G08-03 | Info | structural | 정규화된 숫자 표기 `String(n)`가 `JSON.stringify`와 우연히 일치할 뿐, 명세로 결박되어 있지 않다 | high |

High 이상 없음.

## 3. 발견 상세

### G08-01 canonical-json/request-identity 깊은 중첩에 depth 상한이 없어 RangeError로 던진다
- 심각도: Medium
- 분류: resource
- 위반 규칙: P0-5 (unknown/미분류 실패를 사실로 승격하는 경계에 인접), 없음(주로 견고성)
- 코드 경로: `src/domain/canonical-json.ts:16`(`snapshotJson`의 `visit` 재귀), `:58`(`appendCanonical` 재귀) → `src/domain/request-identity.ts:47`(`canonicalRequestParams`→`snapshotJson`), `:63-71`(`buildRequestIdentity`→`canonicalJson`), `:82-86`(`firstRequestProjectionMismatch`→`requestParamsEqual`→`buildRequestIdentity`)
- 원인: `snapshotJson`의 `visit`와 `appendCanonical`가 모두 순수 재귀이며 nesting depth 상한이 없다. 입력 JSON이 약 1만~2만 단계 이상 중첩되면 V8 콜스택을 넘겨 `RangeError: Maximum call stack size exceeded`가 발생한다. 이 오류는 `StoreError`가 아니라 code가 없는 순수 `RangeError`다. `errorCodeOf`(errors.ts:112)는 이를 `INTERNAL_ERROR`로 뭉갠다.
- 영향: request hash 계산(`buildRequestIdentity`)과 replay 비교(`firstRequestProjectionMismatch`)는 admission·정산 경로에서 불린다. 명백히 잘못된(과다 중첩) 입력이 `INVALID_REQUEST`(exit 2, settled)로 거절되지 않고, `INTERNAL_ERROR`(exit 3, "결과 불명") 또는 처리기 밖으로 새는 미포착 예외가 된다. 후자면 unknown을 사실처럼 다루는 경계 직전에서 프로세스가 죽거나 오분류된다(P0-5의 texture). frame 상한(기본 256 KiB)은 이 정도 깊이의 중첩 배열(`[[[...]]]`)을 담기에 충분하다(1 depth ≈ 2 byte).
- 최소 반례: `buildRequestIdentity("mail.send", { to: ["a@b"], body: <2만 단계 중첩 배열> })` → `RangeError`. `canonicalJson(<1만 단계 중첩>)`도 동일.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G08-config-domain/canonical-json.mjs` →
  `deep 10000: RangeError Maximum call stack size exceeded`.
  `node review/adversarial-2026-09-28/repro/G08-config-domain/request-identity.mjs` →
  `depth 20000: RangeError code=undefined Maximum call stack size exceeded`.
- 확신도: 도메인 함수가 상한 없이 RangeError를 던진다는 사실은 confirmed. admission wire 경로가
  hashing 이전에 깊이를 제한하는지(그룹 밖 frame.ts/도메인 decoder)는 끝까지 추적하지 못했다.
  `src/frame.ts:62`의 `JSON.parse`는 reviver로 duplicate key·surrogate·비유한/unsafe 수만
  막고 nesting depth는 막지 않으므로(V8 JSON.parse는 깊은 배열을 반복적으로 파싱해 통과), 파싱은
  성공하고 뒤이은 순수-재귀 정규화에서만 터진다. 도달성은 §6에 남긴다.
- 개선 방향: 정규화(`snapshotJson`/`appendCanonical`)에 다른 OMA 입력 표면과 같은 명시적 depth
  상한을 두고 초과 시 `StoreError("INVALID_REQUEST")`로 거절한다(도메인 오류 vocabulary 안으로).

### G08-02 파생 unit 이름이 society/kind 경계에서 두 소유자에게 같은 문자열이 될 수 있다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음 (known-limitation)
- 코드 경로: `src/domain/derived.ts:150-158`(`unitNameFor`: `oma-${society}-${kind}.${suffix}`)
- 원인: 이름이 `-`로 이어붙는데 society 이름과 kind(=actor 이름) 모두 `-`를 포함할 수 있어, 서로
  다른 `(society, kind)` 쌍이 같은 문자열을 만든다. 예: `("soc-broker","worker")` 와
  `("soc","broker-worker")` 는 둘 다 `oma-soc-broker-worker.service`.
- 영향: 서로 다른 두 society의 unit 이름이 충돌할 수 있다. 다만 이는 `implementation/validation.md`
  "알려진 한계"의 P0V-26(DR14)에 이미 기록되어 있다: 같은 이름이 되는 unit은 교체하지 않고
  agent 생성 시 `AGENT_CONFLICT`로 거절한다. `derived.ts`는 순수 파생만 하고 그 방어는 상위(생성
  경로)에 있으며, 헤더 주석(`derived.ts:149` "constructing a name is not a ... observation")도 이를 인정한다.
- 최소 반례: 위 두 쌍.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G08-config-domain/identifiers.mjs` →
  `society soc-broker resident worker: [ 'oma-soc-broker-worker.service', ... ]`.
- 확신도: confirmed. 문서 서술과 실제 코드가 일치하므로 새 결함이 아니라 known-limitation으로 표기.
- 개선 방향: 문서대로 유지(상위 AGENT_CONFLICT 방어). 파생 층에서 결정성 강화가 필요하면 society와
  kind 사이 구분자를 이름 문법이 배제하는 바이트로 바꾸는 방향(현 UNIT-001 결박은 그대로).

### G08-03 정규화 숫자 표기가 명세가 아니라 `String(n)`의 우연한 일치에 기댄다
- 심각도: Info
- 분류: structural
- 위반 규칙: 없음
- 코드 경로: `src/domain/canonical-json.ts:60`(`output.push(String(value))`)
- 원인: canonical 숫자 표기가 `String(value)`다. 현재 V8에서 `String(n) === JSON.stringify(n)`가
  모든 유한 수에 대해 성립(`1e21`,`1e-7`,`5e-324`,`1.5e300`,안전정수 밖 큰 정수까지 확인)하지만,
  이는 명세로 결박된 사실이 아니라 런타임 구현 일치다. hash 입력의 결정성은 이 일치에 의존한다.
- 영향: 지금은 충돌·비결정성 없음(재현으로 확인). 다만 숫자 표기의 owner가 명세 아닌 런타임이라
  P0-1(결박된 사실의 의미가 실행 환경에 기대지 않아야 함)의 정신에서 약하다. -0는 "0"으로
  0과 같은 bytes가 되나, 두 값은 JSON 의미상 동일해 충돌 아님.
- 최소 반례: 없음(구조 지적).
- 재현 방법: `node review/adversarial-2026-09-28/repro/G08-config-domain/canonical-json.mjs`의
  roundtrip 줄들이 `canon == JSON.stringify` 임을 보인다.
- 확신도: high.
- 개선 방향: 숫자 canonical 표기를 명시 규칙(예: golden vector로 결박된 표기 함수)로 소유해 런타임
  구현에서 분리한다.

## 4. 리팩터링 필요 지점
- `snapshotJson`/`appendCanonical`(canonical-json.ts)와 `LineageSnapshot`의 depth·recursion 경계가
  서로 다른 방식이다. lineage는 `visiting`/`complete` set으로 cycle을 막고 반복 큐(`descendants`)를
  쓰지만, canonical-json은 순수 재귀에 상한이 없다(G08-01). "재귀 도메인 순회의 depth 상한"을 한
  개념으로 두면 같은 종류의 누락을 한 곳에서 막을 수 있다(P0-6).
- 숫자 canonical 표기(G08-03)의 owner를 명세로 끌어올리면 request-hash·generation-id·spec-digest가
  모두 한 결박에 묶인다(P0-2/P0-1).

## 5. 점검했고 문제없다고 판단한 것 (근거 줄)

1. **inline config commit crash-recovery (P0-3, P0-7).** `commitInlineConfiguration`/`publishInline`
   (generations.ts:441-499)의 모든 durable 경계(`derived-rename` before/after-visible,
   `directory-fsync` ambiguous/after-visible, `file-fsync` ambiguous/after-visible) 직후 SIGKILL을
   주입하고 다음 load를 확인. 6/6 경계 모두 다음 load 성공, 커밋점 rename 전 crash는 원본 유지,
   후는 새 값. `.tmp` 잔재는 `collectTemporaries`(:591)가 quiescent start에서 수거.
   재현: `inline-crash.mjs` → 모든 줄 `crashed=true -> load OK`.
2. **operations bundle 동시 편집(lost update) (P0-3).** 두 TUI가 같은 snapshot을 읽고 각각 commit.
   두 번째(stale) commit은 `assertCurrent`(generations.ts:189-200, sourceFiles sha256 비교)에서
   `POLICY_CHANGED`로 거절. lost update 없음. 재현: `ops-concurrency.mjs` →
   `TUI-B commit (stale snapshot): REJECTED POLICY_CHANGED`.
3. **operations commit-succeeds-but-load-rejects (P0-3).** 여러 연속 편집 후 매번 재로드 성공
   (`ops-concurrency.mjs`의 `edit->... reload OK`). 쓰는 검증(`validateConfig`)과 읽는 검증
   (`readConfigurationSource`→`validateConfig`)이 같은 owner이며, `assertReproduces`(:299-313)와
   `publishInline` 내부의 loader round-trip이 커밋 전에 실제 loader로 재현을 증명한다.
   inline reader와 operations reader의 비대칭(operations만 `libdir` 절대경로 요구,
   operations.ts:387)은 `assertReproduces`가 실제 operations loader를 돌려 커밋 전에 걸러낸다.
4. **generation retention / A,B,A journal (P0-3, P0V-61).** `generationsToKeep`(:551-557)는 legacy
   record와 읽지 못한 journal을 "all keep"로 처리하고, 현재 generation이 대체한 직전만 추가로 유지.
   기존 `test/generation-retention.test.ts`가 A,B,A·record 유실·short read·unreadable journal을 모두
   덮으며, 그 로직을 코드로 재확인. 참조 중인 generation을 지우지 않는다.
5. **canonical-json `__proto__` (boundary).** `snapshotJson`이 `defineProperty`로 literal
   `__proto__` 키를 데이터로 보존하며 prototype 오염 없음(canonical-json.ts:44-46).
   재현: `canonical-json.mjs` → `proto key => {"canon":"{\"__proto__\":{\"polluted\":1},\"a\":2}"}`,
   `objProtoPolluted`는 표시 안 됨(undefined).
6. **errno 답함/안 답함 표 (P0-5).** `unobserved`(errors.ts:96-101)와 `ANSWERED_ERRNO`(:86).
   브리프의 errno 전부 확인: EINTR/EAGAIN/ENOMEM/EMFILE/ENFILE/ENOSPC/EROFS/ESTALE/EACCES/EIO →
   BROKER_UNAVAILABLE(안 답함, 사실 승격 안 함), ELOOP/ENAMETOOLONG/ENOTDIR/ENOENT/EISDIR →
   null(이름 사실, 호출자가 판정). accepted-phase에서 unavailable 관측은 `failed`로 승격되지 않고
   unknown/exit3 유지(classifyError, :198-210). 재현: `errors.mjs`.
   (ENOSPC는 `normalizeStorageFailure`에서는 STORAGE_FULL, `unobserved`에서는 BROKER_UNAVAILABLE로
   갈리나 둘 다 비-terminal이라 P0-5 위반 아님.)
7. **request hash 충돌/분리 (IPC-005).** set-field(mail.send.to, git.submit.prerequisites/to/paths)만
   sortedUnique로 정규화되어 순서·중복이 접혀 의미상 같은 요청이 같은 hash가 됨(의도).
   recipe에 없는 method는 순서 보존(distinct). -0/0은 같은 수라 같은 hash. 다른 값이 같은 bytes가
   되는 충돌은 못 찾음. 재현: `request-identity.mjs`.
8. **identifier 경계.** 예약어(principal/commons/residents/broker/reconcile/principal-relay/topic),
   `topic-` 접두, 대문자, 길이(32/33), 선행 비알파, `_` 모두 올바르게 거절(identifiers.ts:26-33).
   재현: `identifiers.mjs`.
9. **tool-surface 권한 기본값 (fail-closed).** `planToolSurface`(tool-surface.ts)는 defaultMode를
   DIRECT|DISABLED로만 받고, cycle(:96-118 `assertAcyclic`), 중복 owner(:191), disabled∩direct,
   group∩tool 이름 충돌을 모두 거절한다. 미지의 참조는 `INVALID_REQUEST`로 fail-closed.
10. **capabilities/child-policy 기본값 (fail-closed).** `isCapability`(capabilities.ts:38)는 닫힌
    집합 membership만 true. `resolveChildSpec`(child-policy.ts:29-46)은 parent∩delegable∩child의
    교집합 + HOST_GRANTED(code.integrate)만 부여하며 fail-open 없음.

## 6. 확인하지 못한 것
- G08-01의 **admission 도달성**: request params가 hashing(`buildRequestIdentity`) 이전에 그룹 밖
  layer(도메인 method decoder, wire dispatch)에서 nesting depth로 거절되는지 끝까지 추적하지 못했다.
  `src/frame.ts:62`가 depth를 막지 않는 것과 도메인 함수가 상한 없이 RangeError를 던지는 것은
  confirmed이나, 특정 method의 admission 경로가 깊은 값을 hashing까지 실제로 흘리는지는 미확인.
  Medium/도달성 medium으로 둔 이유.
- 전원 차단(powercut) 이후의 fsync 순서·물리적 내구성은 fault seam(논리적 SIGKILL 시뮬레이션)으로만
  확인했고 실제 하드웨어 배리어는 검증 못 함(validation.md 알려진 한계 WP12/WP13과 동일 범위).
- `commitManagedGeneration`의 generation-id overflow/재사용: id는 내용 SHA-256(`generationIdOf`,
  :53)이라 숫자 overflow 개념이 없고 재사용은 `sameBytes`(:229) 비교로 안전하다고 판단했으나,
  16개 예산 소진 후 quiescent collection 실패가 겹치는 조합은 실제 디스크에서 재현하지 않았다
  (validation.md AV7 known-limitation과 일치).
