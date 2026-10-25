# 숫자 bound 분류 장부 (UX-38 기록과 DR37/DR39 현재 상태)

> UX-38 배치 1–5가 사용자-facing 용량·시간 거절을 durable spool / 진행-리셋 창 /
> FIFO 작업 집합 / 정직한 절하로 변환한 뒤 남은 bound를 전수 조사해 분류한다.
> 2026-10-09 DR39에서 DR37의 제한 제거와 어긋나던 항목을 바로잡았다.
> 아래의 나머지 UX-38 수치는 당시 조사 기록이며, 전체 숫자의 새 전수 검증을 뜻하지 않는다.
> 이 문서는 인벤토리다 — bound의 동작 계약은 각 소유 코드와 spec 문서가 유지하고,
> 여기의 분류 변경은 그 계약을 덮어쓰지 않는다.

## 분류 기준

| 분류 | 의미 |
|---|---|
| `PROTOCOL/WIRE-MANDATED` | 상대방(peer)과 공유하는 wire/frame/문법 계약. 제거하면 인코딩된 payload가 상대에 닿지 않거나 프레임 동기화가 깨진다. 설정값(limits 테이블)으로 조정 가능한 bound도 여기 — 계약의 값이자 구현의 bound다. |
| `FORMAT-MANDATED` | 파일/아티팩트 포맷 자체가 강제하는 bound(u16·u32 필드 폭, NAME_MAX, DNS 라벨, RFC 라인 한도, 앵커 알파벳 공간). |
| `SECURITY/INTEGRITY` | 보안·무결성 불변량을 지키는 bound — 파서 스택 보호, 신뢰할 수 없는 산출물의 자원 한도, 절단이 증거를 위조하는 경로, 읽기 도중 변경의 거절. |
| `RESOURCE-PROTECTION` (의도적 유지) | 메모리·디스크·보유 수 등 프로세스 자원을 의도적으로 제한하는 bound. 방어적이지만 자의적인 값은 그렇게 명시한다 — 프로토콜 요구사항인 척하지 않는다. |
| `QUIESCENT/JITTER` | 정체·liveness 감지, 재시도, grace/deadline 창. 진행이 관측되면 리셋되고, 관측 불가능한 곳에서는 관대한 고정 상한+정직한 실패다. |
| `TEST-ONLY` | 프로덕션 경로에서 도달할 수 없는 bound(테스트 전용 표면). |

또한 표에 없는 항목 두 부류를 먼저 선언한다 — 조사에서 발견했지만 bound가 아닌 것:

- **청크/버퍼 크기**(전부 구현 상세, payload 상한이 아님): `packages/storage/src/context-files.ts`·`context-stream.ts`·`submit-spool.ts`·`immutable-file.ts`·`file-digest.ts`·`snapshot-reader.ts`의 64 KiB/1 MiB 읽기 버퍼, `packages/client/src/channel.ts`의 64 KiB 스트림 청크, `src/platform/host/archive-crypto.ts`의 `CHUNK`(64 KiB), `src/git/observe.ts`의 1 MiB 읽기 청크. 스트림 전체가 아니라 한 번의 read/write만 묶는다.
- **이미 비차단으로 변환된 bound**(거절 아님): `packages/client/src/index.ts`의 `PREVIEW_BYTES`(1 MiB)와 `PAGE`(64 KiB) — 완전 결과는 `packages/storage/src/output-spool.ts`에 보존되고 inline은 프리뷰 경계일 뿐. `packages/tool-runtime/src/contained-search.ts`의 `SEARCH_PREVIEW_BYTES`(1 MiB)도 같다 — 완전 결과는 `<workspace>/.oma-search-*`/`.oma/search-results`에 기록된다. `src/runtime/connect-proxy.ts`의 `CONNECT_TUNNELS`는 `Infinity`로 기본 동시 연결 제한이 없다. 명시적으로 지정한 유한 테스트/embedding 값만 FIFO로 동작한다. `src/runtime/inference-relay.ts`의 `RELAY_CONNECTIONS_PER_REQUEST`(4)는 별도의 provider relay 연결 산출 값이며 인터넷 접근 권한이나 CONNECT 상한을 정하지 않는다. `src/platform/guest/histories.ts`의 `PREVIEW_CHARS`(160)와 `RESPONSE_MARGIN`(4096)은 `after` 커서 페이징으로 프레임에 맞춘다. vendored pi-lsp의 진단 bound(`OMA_MAX_DIAGNOSTICS_PER_FILE` 1024·`OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS` 8 KiB·`OMA_MAX_DIAGNOSTIC_URIS` 4096)는 marker+count 절하다 — 초과분은 숨기지 않고 `[oma: …]` marker로 보인다.

## 1. PROTOCOL/WIRE-MANDATED

| 위치 | 값 | 사용자-facing | 계약과 근거 |
|---|---|---|---|
| `packages/protocol/src/frame.ts` `FrameParser`/`FrameCollector` | uint32-BE 길이 + `maxFrameBytes`(≤ 0xffffffff) | 예(프레임 초과 시 스트림 poison) | broker↔client·runtime↔engine의 length-prefixed 프레임. 선언 길이가 bound를 넘으면 스트림 동기화를 보장할 수 없어 poison한다. 큰 payload는 프레임을 늘리지 않고 blob 스트림(bundle·context descriptor)으로 우회한다. |
| `packages/domain/src/protocol-limits.ts` `REFERENCE_PROTOCOL_LIMITS` | frameBytes 256 KiB·mailBodyBytes 256 KiB·subjectBytes 512·addresses 64·replyReferences 64·contextFiles 256·contextBytes 8 MiB·bundleBytes 256 MiB·logBytes 1 MiB·batchMaxMessages 24·idleStreamSeconds 30·receiptWaitSeconds 30 | 예(각 bound가 요청 문법을 묶음) | `ProtocolLimits` — 이 배포의 wire 계약 전체를 명명하는 limits 테이블(`packages/domain/src/limits.ts` `PROTOCOL_LIMIT_FIELDS`). 수신·발신 양쪽이 같은 limits로 디코드한다. 값은 설정 가능하며 wire 안의 대체 채널은 없다 — bound 자체가 계약이다. |
| `packages/client/src/channel.ts:94` | 채널당 진행 중 요청 1 | 예(LIMIT_EXCEEDED) | 요청/응답 상관이 id 다중화 없이 직렬 호출을 가정하는 wire 시맨틱. 병렬 호출은 또 다른 채널을 연다. |
| `packages/protocol/src/host-guest.ts` | `HOST_GUEST_PROTOCOL` 6·`PLATFORM_FRAME_BYTES` 256 KiB·`TERMINAL_FRAME_BYTES` 64 KiB·`VERSION` ≤64·`REQUEST_KEY` ≤128·`ID` ≤64·`METHOD` 점문법·`TOKEN` ≤128·`GUEST_PORTS` 700/701 | 예 | host driver↔guest agent wire v6. 터미널 출력은 64 KiB 프레임으로 쪼개지므로 크기 거절이 아니라 프레임 단위다. |
| `packages/protocol/src/host-channel.ts:25`·`packages/extension/src/principal-channel.ts:24` | `HOST_CHANNEL_LINE_BYTES` 128 | 아니오(내부 채널) | host↔trusted extension 제어 라인 프로토콜의 라인 문법. |
| `packages/protocol/src/receipt-chunks.ts:9` `MAX_RECEIPT_BYTES` | 64 MiB | 예(초과 영수증은 수취 불가) | 배달 영수증은 청크 재조립 후 통째 검증하는 산출물 — 우리 포맷이 스스로 선언한 bound. 청크 수신은 `operation.read` 페이지의 진행-리셋 창으로 이미 변환됐다(느린 링크도 완수). 이 bound 이상의 영수증을 생산하는 경로는 프로토콜에 없다. |
| `src/storage/delivery-receipt.ts:395` | 인코딩된 영수증 ≤ 설정 frame limit | 예 | 같은 영수증-문서 bound의 기록 측. |
| `packages/protocol/src/jsonl.ts` | `lineBytes`(호출자 설정, pi-rpc는 frameBytes) | 아니오(초과 라인은 폐기+계수) | Pi engine JSONL 프레임. 초과 라인은 다음 LF까지 버리고 drop을 계수해 wire를 재정렬 — 거절이 아니라 절하. 깨진 프레임만 reader를 poison한다(무결성). |
| `packages/protocol/src/batch-view.ts` | batch view ≤ frameBytes·messageIds ≤ batchMaxMessages | 예 | 배치 뷰 문서는 한 프레임으로 전송된다. 배치 자체는 청크로 배달되며 이 bound는 요약 뷰의 것이다. |
| `packages/broker/src/connection.ts` | RPC 응답 ≤ frameBytes → FRAME_TOO_LARGE | 예 | 응답이 프레임을 넘으면 "요청은 처리됨"으로 명시 실패 — wire bound. |
| `packages/protocol/src/status-page.ts:14` | 한 status row ≤ 응답 프레임 | 예 | 행은 페이지되지만 한 행은 쪼갤 수 없다 — wire bound의 최소 단위. |
| `packages/protocol/src/log-response.ts`·`packages/protocol/src/log-limits.ts` `MIN_LOG_FRAME_BYTES` | 로그 응답 ≤ min(frameBytes, logBytes) | 예(`truncated: true` 마커) | `boundedLogOutput`/`boundedLogResponse`는 프레임에 맞춰 UTF-8 경계에서 정직히 절단하고 `truncated`를 둔다. `MIN_LOG_FRAME_BYTES`는 "로그 응답을 수용할 수 있는 프레임"의 floor — frameBytes 설정의 포맷 전제다. |
| `src/runtime/pi-rpc.ts` | pending 명령 1·명령 ≤ frameBytes | 예 | Pi engine의 JSONL 명령 채널 — 한 명령씩 직렬, 한 명령은 한 프레임. |
| `packages/domain/src/identifiers.ts` | actor ≤32·topic ≤64·request key 1–96·OID 40/64-hex·wire path ≤4096 | 예(문법 거절) | 신원/주소 지정 문법 — wire가 이름을 규정한다. |
| `packages/domain/src/limits.ts` `MIN_MIXED_BATCH_MESSAGES` | `batchMaxMessages` ≥ 2 | 예(설정 거절) | 용량 상한이 아니라 공정성 **하한** — direct와 public이 동시에 pending인 actor는 단일 메시지 배치에서 기아한다(`packages/config/src/index.ts` 검증과 `src/mail/batch-policy.ts` 선택 시점이 같은 바닥을 강제한다). |
| `packages/domain/src/mail-values.ts` | `MAIL_HEADER_BYTES` 256 KiB·`storedMailBytes`(header+3×body+라인 오버헤드 유도 상한)·`policyRevision` ≤128 | 예 | 메일 wire 문법 + 저장 인코딩 확장의 정확한 산출. |
| `src/mail/headers.ts` | `MAX_HEADER_LINE_BYTES` 998(RFC 5322 §2.1.1)·`DEFAULT_HEADER_LIMIT` = MAIL_HEADER_BYTES | 예 | 메일 포맷 계약 — 한 헤더 라인이 998 바이트를 넘으면 wire 표현이 아니다. |
| `packages/domain/src/review-bounds.ts` | `NOTICE_PART_OVERHEAD` 512·`LONGEST_*` 문법 최대값 | 아니오(유도 계정) | 완료 notice의 파트당 봉투 예약과 최악 문법 폭 — `mailBodyBytes`가 실제로 담을 수 있는지의 산출 근거. bound가 아니라 bound의 하한 검증. |
| `packages/domain/src/egress.ts` | `EGRESS_ENTRY_BYTES` 253·`EGRESS_ALLOW_MAX` 256·`AUTHORITY_BYTES` 261 | 예(설정 거절) | 253은 DNS wire 표기의 포맷 상한, 256은 host-guest 스키마가 역할별 allowlist에 선언한 wire bound(디코드 시점에 강제), 261은 host:port 문법 폭. |
| `packages/domain/src/ask-user-question/questionnaire.ts` | `MAX_QUESTIONS` 4·`MIN_OPTIONS` 2·`MAX_OPTIONS` 4·`MAX_HEADER_LENGTH` 16·`MAX_LABEL_LENGTH` 60 | 예(도구 호출 거절) | upstream `ask_user_question` 툴 스키마의 표면 계약 — OMA가 재구현하는 upstream 계약이며 모델이 보는 스키마와 Human UI가 같은 bound를 공유한다. |
| `packages/tool-mcp/src/index.ts` | MCP 서버명 ≤128 | 예 | upstream 이름 문법. |
| `src/entry/pi-interactive-host.ts`·`packages/tui/src/session.ts`·`packages/tui/src/prompt.ts`·`packages/tui/src/limits.ts` `humanPromptByteLimit` | 프롬프트 ≤ min(16 KiB, frame−envelope) | 예(제출 거절) | 프롬프트는 `human_input` 명령 프레임 안에 실린다 — wire bound가 지배하고 16 KiB 로컬 상한은 의도적 UI 자원 bound(§4). |
| `src/entry/oma-society.ts:767` | 한 host-history 페이지 엔트리 ≤ UI 프레임 | 예 | 페이지 리스트는 프레임에 맞춰 묶이고, 한 엔트리가 프레임을 넘으면 FRAME_TOO_LARGE — 쪼갤 수 없는 단위의 wire bound. |
| `src/cli/effects.ts` `readLocalFile` | 파일 ≤ `cliFrameBytes()` | 예(`file is larger than a request can carry`) | 파일 내용은 요청 프레임에 실린다 — 요청이 한 프레임이므로 대체 채널은 없다. 읽기 도중 성장·변경·비정규는 무결성 거절(§3). |
| `src/cli/effects/submit.ts` `submitBundle` | 번들 ≤ `cliBundleBytes()` | 예 | 제출 번들은 선언된 blob descriptor 스트림 — descriptor bound가 곧 wire bound. |
| `src/cli/effects/goal.ts`·`src/cli/effects/context.ts` | context ≤ `cliContextBytes()` | 예 | 같은 blob descriptor 계약의 context 스트림 bound. |
| `src/cli/effects/code.ts` `readCode`(merge-diff) | diff ≤ `bundleBytes()` | 예(`the diff exceeds the N-byte bound; narrow it with --path`) | 완료 notice 문서(`review.ts` `noticeDocument`)가 `bounds.bundleBytes` 안에 들어가야 하고 diff는 그 문서의 본문이다 — diff 전용 대체 채널은 없고, 절단된 diff는 적용 불가한 증거이다. 이전에는 고정 768 KiB로 더 좁게 거절했는데 이는 wire bound보다 작은 자의적 거절이었으므로 이번에 `bundleBytes()+1`로 정렬했다. `--path`가 정식 완화책이다. |
| `packages/domain/src/validation.ts` | `brief` ≤8 KiB·`prerequisites` ≤1024·`paths` ≤1024·`sinceSeconds` 1–31536000·`note` ≤64 KiB | 예(문법 거절) | 요청 필드 문법 — 요청 전체가 이미 프레임-한정이며 이들은 그 안의 필드 bound. |
| `packages/protocol/src/methods.ts` `UNBOUNDED_PUBLIC_LIMITS` | `Number.MAX_SAFE_INTEGER` | 아니오 | 공개 디코드가 배포 한도를 제거함을 명명하는 장치 — 구조 문법만 남기고 용량 bound를 뜻한다(UX-38 변환의 산출물). |

## 2. FORMAT-MANDATED

| 위치 | 값 | 근거 |
|---|---|---|
| `src/platform/host/archive-crypto.ts` | `CHUNK` 64 KiB·`MAX_CHUNKS` 0x100000000 | 아카이브 암호 포맷의 nonce·인증 데이터가 32-bit 청크 번호를 품는다 — 넘으면 포맷이 아니다(동시에 nonce 재사용 방지). |
| `src/platform/package-archive.ts` `PACKAGE_ARCHIVE_BOUNDS` | `pathBytes` 4096·`componentBytes` 255·`bytes`/`fileBytes` MAX_SAFE_INTEGER | `pathBytes`는 u16 wire 길이 필드+PATH_MAX 계열, `componentBytes`는 NAME_MAX — 둘 다 포맷이 강제. `bytes`·`fileBytes`는 "u64가 정확히 이름 붙일 수 있는 최대치" — 넘으면 크기를 정확히 관측할 수 없는 스트림-정직 거절. `entries` 8M은 §4 참조(포맷이 아닌 작업 집합). |
| `packages/tool-hashline/src/vendor/pi-hashline-edit-pro` `MAX_HASH_LINES` | = `HASH_SPACE`(앵커 알파벳 `ANCHOR_COUNT`) | hashline 앵커 공간 자체가 유한 — 넘는 파일은 앵커로 주소 지정 불가. 거절 메시지가 대체 채널("use write")을 명명한다. |
| `src/mail/headers.ts` `MAX_HEADER_LINE_BYTES` | 998 | RFC 5322 §2.1.1 라인 한도 — 메일 포맷이 강제(§1에서도 wire 문법으로 인용). |
| `src/runtime/session-mode.ts` | `MAX_BYTES` 16 KiB·절대 경로 ≤4096 | `session-mode.json`은 OMA가 쓰는 소형 문서 — "이 bound를 넘는 파일은 이 소유자가 쓴 것이 아니다"라는 포맷 식별 bound이기도 하다. |
| `src/runtime/session-history.ts` | `HEADER_BYTES` 1 MiB | 세션 히스토리 헤더(첫 라인) 탐색 bound — 대화 크기가 아닌 헤더 발견 경계. |
| `src/runtime/project-binding.ts` | `BINDING_MAX_BYTES` 4096 | `project-binding.json` — 같은 "우리가 쓴 문서" 식별 bound. |
| `src/request-cache.ts` `REFERENCE_METADATA_BYTES` | 512 KiB(프레임 2개) | 요청 메타데이터 캐시 파일은 요청+영수증 각각 ≤1 프레임 — 2 프레임보다 큰 파일은 이 캐시가 쓴 것이 아니다(포맷 식별). |
| `src/git/observe.ts` `LS_TREE_RECORD_BYTES` | 4352(wire path 4096 + 헤더 여유) | 점증 파서의 레코드 문법 bound — 출력 전체는 스트리밍되므로 bound는 한 레코드의 문법 폭이다. |
| `packages/config/src/generations.ts` | `GENERATION_ID`/`COMMIT_RECORD` 정규식·`JOURNAL_TAIL_BYTES` 4096 | generation 디렉터리·commit 레코드 문법과 저널 꼬리 읽기 경계. |
| `src/platform/guest/project.ts` | `BRANCH` ≤200·`BUNDLE_CAPABILITIES_BYTES` 64 KiB | 번들 capabilities 헤더의 읽기 bound와 branch명 문법. |
| `src/platform/host/snapshot.ts` `SNAPSHOT_ID` | ≤100자 | snapshot 이름 문법. |
| `packages/storage/src/submit-spool.ts`·`packages/storage/src/transport-spool.ts`·`packages/storage/src/context-stream.ts` | 선언된 descriptor 바이트 수 | 스트림이 선언한 `bytes`와 실제 수신이 다르면 STREAM_INVALID — 용량 bound가 아니라 무결성 검증이다. |

## 3. SECURITY/INTEGRITY

| 위치 | 값 | 사용자-facing | 근거 |
|---|---|---|---|
| `packages/domain/src/canonical-json.ts` `JSON_NESTING_LIMIT` | 64 | 예(깊은 JSON 거절) | 재귀 파서의 스택/재귀 고갈 보호 — canonical JSON은 내용이 아니라 형태를 검증한다. |
| `src/git/quarantine.ts` `QUARANTINE_RESOURCES` | 전 필드 0 | 아니오 | DR37에서 CPU/메모리/tasks/timeout/silence cap 제거. 호환 선언만 남고, namespace·tree lease·broker cancellation·전체 객체 무결성 검증이 작업을 소유한다. |
| `packages/tool-lsp/src/vendor/pi-lsp/runtime/text-edits.js` | `OMA_MAX_WORKSPACE_EDITS` 2048·`OMA_MAX_WORKSPACE_EDIT_BYTES` 4 MiB | 예(해당 fix 요청만 거절) | 의도적 유지 — 절단된 edit 목록은 오염된 fix를 날조하고, 무제한 materialization은 엔진 OOM 위험이라 둘 다 거절보다 나쁘다. 거절은 그 요청 하나에만 적용되고 서버·다른 요청은 생존한다. 대체 채널 없음. |
| `packages/tool-lsp/src/vendor/pi-lsp/runtime/lsp-client.js` `OMA_MAX_INBOUND_FRAME_BYTES` | 4 MiB | 예(귀속 가능한 요청만 거절) | 오작동/적대 서버가 엔진 프로세스 메모리를 무제한으로 키우는 것을 막는 방어 bound — oversized 프레임은 그 요청만 거절하고 본문은 bounded discard 뒤 wire 재정렬, 미식별 프레임은 drop+count만 한다. |
| `packages/domain/src/tool-surface.ts` `SURFACE_LIMITS` | groups 32·members/group 16·depth 4·names 512·desc 512 B | 예(플랜 거절) | 툴 표면 플랜의 구조 문법 — 방어적이며 자의적인 값이지만, 플랜은 네비게이션 메타데이터일 뿐이며 bound는 구조적 정직성을 위해 유지한다. |
| `src/runtime/connect-proxy.ts` `CONNECT_HEADER_BYTES` | 8192 | 예 | 프록시가 파싱하는 CONNECT 헤더의 상한 — 정직한 CONNECT 요청이 도달할 수 없는 범위에서 외부 입력 파서를 보호한다. |
| `src/cli/effects.ts` `readBounded` | grew/changed 거절·`size`는 호출자 bound | 예 | FILE_CHANGED_DURING_READ 계열 — 읽는 도중 바뀐 파일을 조용히 받지 않는 무결성 거절(장치 파일 같은 무한 소스도 닫는다). |
| `src/runtime/user-files.ts` `readUserFile` | 호출자가 준 bound·변경 감지 | 예(STORE_CORRUPT) | OMA 소유 메타데이터의 무결성 읽기 — bound를 넘는 파일은 손상으로 분류된다(포맷 식별 + 무결성 겸용). |
| `packages/tool-runtime/src/child-env.ts` | env 키/값 문법 | 예 | 자식 프로세스로의 주입 채널을 닫는 deny-by-default 정책. |
| `packages/protocol/src/jsonl.ts`·`packages/protocol/src/frame.ts` poison | — | 아니오 | 깨진 프레임 동기화는 읽기 계속을 거짓으로 만든다 — poison이 정직한 응답이다. |
| `packages/process/src/command.ts` `validateCommand` | argv/env 문법·`stdoutSpool === stderrSpool` 거절·`silenceMs > timeoutMs` 모순 거절 | 예(내부 계약 위반) | 두 스트림이 같은 파일로 truncate되면 무소음 손실 — 거절은 무결성이다. |

## 4. RESOURCE-PROTECTION (의도적 유지)

> 전부 **방어적이며 자의적인 값**이다 — 어느 wire 계약·포맷도 이 숫자를 강제하지 않는다. 유지 이유는 프로세스 자원(메모리·디스크·보유 수)을 묶는 것과, 소형 durable 문서의 부정 크기를 감지하는 것이다. 사용자-facing 거절이 발생하는 항목은 `사용자-facing` 열에 명시한다.

| 위치 | 값 | 사용자-facing | 근거 |
|---|---|---|---|
| `packages/storage/src/diagnostic-snapshot.ts` `DIAGNOSTIC_READ_LIMITS`·`packages/storage/src/store.ts` | maxRows 10,000·maxBytes 32 MiB·maxDatabaseBytes 64 MiB·integrity_check 100행·foreign-key issue 100건 | 예(진단 답만 LIMIT_EXCEEDED) | 관리자 진단 읽기의 유한 예산(`readDiagnosticSnapshot`이 집행). **운영 읽기는 이 예산을 공유하지 않는다**(주석이 그대로 말함) — UX-38의 전형적 정직한 절하. |
| `packages/config/src/operations.ts` `CONFIGURATION_SOURCE_LIMITS` | files 4096·bytes 64 MiB | 예(소스 클로저 거절) | 스냅샷이 닫히는 동안 소스 파일당 identity 행 1개를 잡는 작업 집합 bound — asset 바이트는 `fileDigest`로 스트리밍되어 메모리에 없다. |
| `packages/config/src/operations.ts` `CONFIGURATION_DOCUMENT_BYTES` | 16 MiB | 예 | 통째로 파싱하는 설정 문서의 상한. |
| `packages/config/src/operations.ts` `EXTENSION_LIST_LIMIT` | 16 | 예 | extension 선언 목록의 상한. |
| `src/runtime/pi-packages.ts` | `PACKAGE_INDEX_BYTES` 8 MiB·`PACKAGE_SETTINGS_BYTES` 1 MiB | 예 | 패키지 스토어 인덱스·설정 문서 상한 — 거절은 설정된 bound를 명명한다. |
| `src/runtime/personal-settings.ts` `PERSONAL_SETTINGS_BYTES` | 17 MiB | 예(LIMIT_EXCEEDED) | Personal 설정 문서의 상한 — 그 크기의 설정 파일은 실존하지 않는 것을 전제한 방어 bound. |
| `src/runtime/local-package.ts` | `PACKAGE_MANIFEST_BYTES` 16 MiB·`TAR_METADATA_BYTES` 1 MiB | 예 | package.json·tar 메타데이터(pax 레코드·long name)의 파서 bound. |
| `src/runtime/deployment-manifest.ts` | `MAX_ENTRIES` 32,768·`MAX_BYTES` 256 MiB | 예(UNSUPPORTED_PROFILE) | 배포 인벤토리의 해시 워크 상한 — 주석이 스스로 말하듯 "absurd inventories를 거절, honest inventories는 통과"하는 방어적 상한. |
| `packages/config/src/generations.ts` `MANAGED_LIMITS` | generations 16·bytes 256 MiB | 예(LIMIT_EXCEEDED + GC 안내) | 설정 이력 보존 bound — "restart oma to collect unused generations"가 정식 완화책이다. |
| `packages/broker/src/index.ts` `ACTOR_CONNECTIONS` | 16 | 예(연결 거절) | broker unix 서버의 동시 연결 상한 — `server.maxConnections` 자원 bound. |
| `src/entry/omahostd.ts` `STATE_DISK_BYTES` | 64 GiB | 예(기동 거절) | host state 디스크의 최소 크기 — 하한이므로 용량 거절이 아니라 프로파일 거절이다. |
| `src/platform/host/service.ts` `SNAPSHOTS_KEPT`·`storageFloor` | 3·max(5 GiB, 디스크의 10%) | 예(전송 거절) | 스냅샷 보존 수와 MAC-660의 여유 공간 하한. |
| `src/entry/guest-session.ts` `backlogBytes` | 4 MiB | 아니오(스크롤백 순환) | PTY 스크롤백의 보유 bound — 오래된 출력을 폐기하는 순환 버퍼이지 거절이 아니다. |
| `packages/tui/src/limits.ts` `CONVERSATION_BOUNDS` | transcriptLines 500·transcriptBytes 256 KiB·transcriptLineBytes 1024·promptBytes 16 KiB·waitingPrompts 16·queuePreview 8/160 | 일부(prompt/waiting 거절) | 화면이 보유하는 대화·입력의 작업 bound. prompt 초과는 wire bound(§1)와 겹치고 waiting 16은 Human이 실행 중인 턴 앞에 쌓는 프롬프트의 큐 bound — 모두 정직한 거절 메시지를 둔다. transcript 계열은 오래된 행의 보존 한계다. |
| `packages/tui/src/limits.ts` `READ_BOUNDS` | mailHeader 64 KiB·mailListRows 200·mailArrivalJournal 256 KiB·extensionScanDepth 3·extensionScanEntries 1024·loggedWords 256 | 아니오(부분 표시는 `partial` 명시) | 읽기 뷰의 예산 — 스캔이 조기에 멈추면 `partial`로 표시하고 큰 메일박스 잔여는 읽지 않고 계수한다. |
| `packages/tui/src/limits.ts` `COMPACT_TOOL_BOUNDS`·`ASK_QUESTION_BOUNDS` | indicator 80 ms/14 프레임·summary 160 cells·failure 140 cells·trackedCalls 2000·previewSplitColumns 72 | 아니오 | 표시·렌더 예산과 추적 호출의 보유 수. |
| `packages/extension/src/mail-tools.ts` | `INDEX_HEAD_BYTES` 1024·`INDEX_ROW_BYTES` 256·`INDEX_PATH_BYTES` 128 | 아니오(파생 인덱스 bound) | `/inbox.md` 파생 인덱스의 선형 크기 산출 — 저장 메시지 자체의 bound와 분리됐다(메시지는 통째 보존). |
| `src/platform/host/keychain-client.ts`·`src/platform/host/vz-driver.ts` `LINE_BYTES` | 1 MiB | 아니오 | host 헬퍼의 라인 프로토콜 bound — 로컬 IPC 채널의 프레임 상한. |
| `packages/process/src/policies.ts` `runGitText` 기본값 | maxBuffer 32 MiB·timeout 30 s | 예(플러밍 출력 상한) | 경량 Git plumbing 호출의 보호 bound — 큰 출력이 예상되는 경로는 이미 스풀/진행-리셋으로 변환됐고, 남은 호출의 출력은 본질적으로 소형(rev-parse·update-ref)이다. |
| `src/git/context-repository.ts`·`src/lifecycle/workspace.ts`·`src/lifecycle/create-publication.ts` | stdout/stderr 4 MiB·timeout 120 s | 예 | context 저장소와 워크스페이스의 소형 plumbing 출력 bound — clone/fetch/checkout처럼 큰 출력은 `PreparationExecutor`(24 h ceiling+120 s 침묵)가 소유한다. |
| `src/git/project-snapshot.ts` | stdout 32 MiB head·stderr 1 MiB | 아니오 | 스냅샷 Git 호출의 관측 head — 완전 출력은 per-call 스풀 파일에 기록된다. |
| `src/units/execute.ts` `UNIT_COMMAND_LIMITS` | timeout 30 s·maxBuffer 1 MiB | 아니오(실패 시 `unknown`) | `systemctl`/`systemd-analyze` 관측 출력의 상한 — 초과 시 관측 불가로 보고한다. |
| `src/platform/host/bookmark.ts` | timeout 10 s·stdout 1 MiB·stderr 4096 | 아니오 | macOS 서명 헬퍼의 일회성 Foundation 호출 bound. |
| `src/platform/guest/archive.ts`·`src/platform/guest/provision.ts`·`src/entry/guest-provision.ts` | 출력 64 KiB·timeout 5분(entry)~0x7fffffff+10분 침묵 창(장기 작업) | 아니오 | guest 관리 명령의 진단 출력 상한 — tar는 checkpoint 진행으로 침묵 창을 리셋하고, provision의 `dd` 같은 장기 쓰기도 진행-리셋 창 아래 돈다. |
| `packages/reconcile/src/preaccept-event.ts` `PREACCEPT_EVENT_KEPT_LIMIT` | 8 | 아니오 | pre-accept 이벤트의 감사 상세 보존 수 — 초과는 유실이 아니라 요약된 보존 한계. |
| `packages/protocol/src/byte-queue.ts` `maxRetainedBytes` | 호출자 설정 | 아니오 | 프레임 파서의 내부 보유 버퍼 — wire bound 그 자체가 아닌 구현 상세. |

DR37의 resource/quota 필드는 과거 설정·accepted spec을 읽기 위한 호환 선언이다. memory/tasks/CPU/tmp/workspace/staging/check-timeout·저장량·society/lineage agent count는 OMA admission이나 systemd cap으로 집행하지 않는다. 기본값은 0이며, 이전 양수 값도 재작성하지 않는다. `StorageAdmission.startupState()`는 `admitted`를 반환한다. 권한·corruption/draining fence·파일 containment와 실제 OS/I/O 오류는 계속 적용한다.

## 5. QUIESCENT/JITTER budgets

> 진행으로 리셋되는 침묵 창과 고정 경과 마감을 구분한다. 고정 마감은 실제 진행 중인 작업에도 도달할 수 있으며, 결과를 성공·부재로 바꾸는 근거가 될 수 없다. 아래 값은 소유 코드의 관측 정책이다. DR37이 제거한 실행·quarantine·CONNECT cap은 복구하지 않는다.

| 위치 | 값 | 근거 |
|---|---|---|
| `packages/tool-lsp/src/index.ts` | `LSP_TIMEOUT_MS` 120 s(기본)·`LSP_CALL_STALL_MS` 300 s | timeout은 caller 선택 예산의 기본값(1 s floor, 상한 없음), stall은 inbound 프레임마다 리셋되는 침묵 창(요청 timeout보다 좁아지지 않음 — 비-요청 침묵의 backstop). |
| `packages/tool-runtime/src/contained-search.ts` | `SEARCH_STALL_MS` 60 s·`HEARTBEAT_ONLY_WINDOWS` 10·`KILL_GRACE_MS` 2 s | 수신 바이트마다 리셋되는 침묵 창; heartbeat만 나오는 wedged main은 10창 안에 회수(heartbeat는 liveness이지 진행이 아니므로 진행 창을 리셋하지 못한다 — 의도적 liveness 경계); kill 후 grace. |
| `src/runtime/connect-proxy.ts` | handshake/idle/dial 0·keepalive 5 s | DR37: 기본 handshake/idle/dial 마감 없음. 5초는 HTTP keep-alive 연결의 보유 시간이며 raw CONNECT 터널의 시간 제한이 아니다. |
| `packages/broker/src/status-refresh.ts` | `STATUS_OBSERVATION_BUDGET_MS` 2 s | 상태 관측의 예산 — 관측이 예산을 넘으면 stale로 표시하지 요청을 거절하지 않는다. |
| `packages/protocol/src/status-view.ts` | `STATUS_REFRESH_MS` 5 s·`STATUS_STALE_MS` 4×refresh | status 파일의 갱신 주기와 stale 판정 창. |
| `packages/storage/src/store.ts` `DEFAULT_BUSY_RETRIES` | 5 | SQLite busy 재시도 — 동시성 jitter 완충. |
| `src/runtime/society-lease.ts` `ACQUIRE_ATTEMPTS` | 3 | 소유권 lease의 bounded 재시도 — 초과는 경합 보고. |
| `src/runtime/engine-auth.ts` `PLACEHOLDER_ATTEMPTS` | 8 | 자격증명 placeholder의 bounded 후보 생성 — 초과는 거절. |
| `src/runtime/host-tenure.ts` `ENGINE_EXIT_GRACE_MS` | 5 s | 엔진 종료의 teardown grace. |
| `src/runtime/pi-runtime.ts` `PI_PROVIDER_RETRIES` | 5 | provider 재시도 스펙 주입. |
| `src/platform/host/keychain-client.ts` | `REQUEST_DEADLINE_MS` 60 s·`CLOSE_DEADLINE_MS` 30 s | Keychain 헬퍼의 요청/종료 데드라인 — 진행 미관측의 관대한 상한. |
| `src/platform/host/vz-driver.ts` | `START_DEADLINE_MS` 300 s·`STOP_DEADLINE_MS` 120 s·`KEYCHAIN_DEADLINE_MS` 60 s | VM start/stop/keychain 데드라인 — VM 상태는 진행을 관측할 수 없어 고정 상한+정직한 실패다. |
| `src/platform/host/service.ts` `DEFAULT_TIMINGS` | handshake 60 s/retry 250 ms·drain 60 s·health 10 s·hung 30 s·restarts 3/10 min/backoff 1 s | MAC-320/330/331의 lifecycle 예산 — 진행 미관측 경계의 spec 값. |
| `src/platform/host/service.ts` `ARCHIVE_KEY_LOCK_WAIT_MS` | 30 s | 아카이브 키 락의 대기 상한. |
| `src/platform/guest/control.ts` | `FREEZE_LIMIT_MS` 10 s·`FREEZE_MARGIN_MS` 500 ms | fs.freeze의 quiescence 상한과 마진. |
| `packages/domain/src/limits.ts` `CLI_OBSERVATION_SECONDS` | 180 | 한 CLI 관측의 예산 — 수신 청크마다 리셋되는 창의 크기(`client/transport.ts`). |
| `src/request-cache.ts` `RECEIPT_LOCK_ATTEMPTS` | 200×5 ms | 영수증 락의 대기 예산 — 초과 시 CACHE_UNAVAILABLE로 정직 보고. |
| `packages/process/src/command.ts` | `timeoutMs`(호출자)·`silenceMs`(진행-리셋) | 비동기 runner의 이중 창 — 데이터 수신이 침묵 타이머를 리셋하고 동기 runner는 진행을 못 봐서 `silenceMs`를 TypeError로 명시 거절한다. |
| `src/git/canonical-command.ts` `CANONICAL_PROCESS_LIMITS` | timeout 120 s·maxBuffer 4 MiB | canonical plumbing의 데드라인/출력 bound — 대형 출력은 스풀+점증 파싱으로 이미 우회됐다. |
| `src/lifecycle/workspace.ts`·`src/git/context-repository.ts` | ceiling 24 h·silence 120 s | clone/fetch/checkout 등 장기 Git 작업 — 진행 출력이 창을 리셋한다. |
| `src/git/quarantine.ts` | timeout/silence 0 | DR37에서 제거. cancellation과 실제 namespace/process 종료로 수명을 관측한다. |
| `src/platform/guest/archive.ts` | silence 10 min·timer 상한 0x7fffffff | tar checkpoint 진행이 침묘 창을 리셋. |
| `packages/protocol/src/alarm.ts`·`packages/broker/src/connection.ts` | setTimeout ≤ 0x7fffffff | Node 타이머의 플랫폼 상한을 넘는 지연을 클램프하는 구현 상세. |
| `packages/tui/src/limits.ts` `TERMINAL_BOUNDS` | escape 64 B/50 ms·paste 16 KiB/1000 ms/50 ms·exit 2 s·startup 10 s | 터미널 디코더의 jitter 예산 — 불완전한 escape/paste 시퀀스가 무제한 자라지 않게 한다. |
| `packages/broker/src/index.ts` limits | `idleStreamSeconds` 30·`receiptWaitSeconds` 30 | 소켓 유휴·영수증 대기 창 — 설정된 프로토콜 값으로 관측 창에 들어간다. |

## 6. TEST-ONLY

| 위치 | 값 | 근거 |
|---|---|---|
| `src/cli/effects/code.ts` `MAXIMUM` | 768 KiB | `readCode`의 `show`/`diff`/`log`/`ls-tree`/`grep` 뷰 bound — 프로덕션 경로는 merge-diff만 도달하며(`src/cli/commands/merge.ts`·`packages/client/src/index.ts` 경유 `runtime().code`), merge-diff는 이제 `bundleBytes()+1`로 bound된다(§1). revision 해석(ref/published/ancestry 관측)의 출력 bound는 `CANONICAL_PROCESS_LIMITS.maxBuffer`(4 MiB)로 broker의 canonical observer가 같은 명령에 두는 bound와 일치시켰다 — published-ref 목록이 768 KiB를 넘는 저장소가 code view에서만 거절되는 비대칭을 없앴다. 나머지 액션은 테스트에서만 도달 가능하므로 이 값은 fixture 보호용이다. |

## 7. 잔여 사용자-facing 거절의 정리

UX-38 배치 1–5 이후 스윕에서 확인된, 여전히 존재하는 **수치 기반 사용자-facing 거절**과 그 판정:

1. **`oma merge diff` / 완료 notice diff** — diff가 `bundleBytes`를 넘으면 LIMIT_EXCEEDED, "narrow it with --path". **PROTOCOL/WIRE-MANDATED** — diff는 완료 notice 문서의 본문이며 그 문서는 `bundleBytes` 안에 들어가야 한다. diff 전용 대체 채널은 존재하지 않고, 절단된 diff는 적용 불가한 증거이다. 본 정산에서 CLI 뷰 bound를 기존 고정 768 KiB에서 `bundleBytes()+1`로 정렬했다 — 이전 값은 wire bound보다 좁은 자의적 거절이자 오류 문구(`cliBundleBytes()`를 명명)와 불일치하는 결함이었다.
2. **로컬 파일 입력**(`--file` 계열, `readLocalFile`) — 파일이 한 요청 프레임(`frameBytes`)보다 크면 거절. **PROTOCOL/WIRE-MANDATED** — 대체 채널 없음.
3. **컨텍스트·번들 스트림** — `contextBytes`·`bundleBytes` descriptor bound. **PROTOCOL/WIRE-MANDATED**.
4. **LSP workspace edit** — edit 수 2048/newText 4 MiB 초과 시 그 요청만 거절. **SECURITY/INTEGRITY**(의도적) — 절단=오염 fix, 무제한=OOM.
5. **LSP inbound frame** — 4 MiB 초과 프레임은 귀속 가능한 요청만 거절+wire 재정렬. **SECURITY/INTEGRITY**(방어적).
6. **Human 프롬프트** — `min(16 KiB, frame−envelope)` 초과 시 제출 거절. wire bound는 **PROTOCOL**, 16 KiB 로컬 상한은 **RESOURCE-PROTECTION**(의도적 UI 자원 bound).
7. **대기 프롬프트 큐** — 16개 초과 시 거절. **RESOURCE-PROTECTION**(의도적).
8. **설정·패키지 문서** — 설정 소스 4096 파일/64 MiB·문서 16 MiB·extension 목록 16·개인 설정 17 MiB·패키지 인덱스 8 MiB/설정 1 MiB/매니페스트 16 MiB·tar 메타데이터 1 MiB. **RESOURCE-PROTECTION**(방어적·자의적 — 거절 문구가 설정된 bound를 명명한다).
9. **배포 인벤토리** — 32768 엔트리/256 MiB 초과 시 UNSUPPORTED_PROFILE. **RESOURCE-PROTECTION**(방어적 — 소스 주석이 스스로 "absurd inventory 거절"로 명기).
10. **설정 이력** — 16 세대/256 MiB 초과 시 LIMIT_EXCEEDED+"restart oma to collect". **RESOURCE-PROTECTION**(보존 한계, 완화책 명시).
11. **진단 스냅샷** — 10,000행/32 MiB/64 MiB 초과 시 LIMIT_EXCEEDED. **RESOURCE-PROTECTION**(진단 전용 — 운영 읽기는 무관).
12. **디스크립터 고갈**(EMFILE/ENFILE) — contained search/files 경계에서 명시 거절("search snapshot ran out of file descriptors"). **RESOURCE-PROTECTION** — OS가 강제하는 자원 불변량이며 정직한 실패다.
13. **canonical JSON 깊이** — 64 초과 거절. **SECURITY/INTEGRITY**.
14. **아카이브 청크 수** — 2^32 초과 거절. **FORMAT-MANDATED**(32-bit 청크 번호).
15. **hashline 파일** — `HASH_SPACE` 행 초과 시 E_FILE_TOO_LARGE+"use write". **FORMAT-MANDATED** — 대체 경로를 명명.
16. **영수증 재조립** — 64 MiB 초과 거절. **PROTOCOL/WIRE-MANDATED**(자체 포맷의 선언 bound — 이 크기의 영수증을 생산하는 경로가 없다).
17. **`git status` porcelain**(merge/challenge open의 dirty 경고) — 256 KiB 캡에서 LIMIT_EXCEEDED를 던지던 잔여를 이번 정산에서 수정했다: 불리언 관측이므로 절단된 목록도 dirty의 증거이다. **변환됨**(RESOURCE-PROTECTION 캡이 더는 거절하지 않음).
18. **code view의 published-ref 열거** — `readCode` revision 해석이 고유 768 KiB 캡을 쓰던 것을 `CANONICAL_PROCESS_LIMITS.maxBuffer`(4 MiB)로 정렬했다 — 같은 `for-each-ref` 명령에 broker가 두는 bound와 같아져, 큰 발행 이력의 저장소가 code view에서만 거절되는 비대칭이 없다. **변환됨**(남은 4 MiB는 §5의 canonical plumbing bound와 공유).
19. **egress allowlist** — 역할별 256 엔트리 초과 시 설정/디코드 거절. **PROTOCOL/WIRE-MANDATED**(호스트-게스트 스키마 선언).
20. **요청 필드 문법** — `brief` 8 KiB·`prerequisites`/`paths` 1024·`sinceSeconds` 1년·`note` 64 KiB·`logBytes` 뷰. **PROTOCOL/WIRE-MANDATED**.
21. **배치 뷰·status 행·host-history 엔트리·로그 응답** — 한 프레임에 들어가지 않는 최소 단위는 거절(로그는 `truncated` 마커로 절하). **PROTOCOL/WIRE-MANDATED**.
22. **채널 동시 요청** — 채널당 진행 중 요청 1건 초과 시 LIMIT_EXCEEDED. **PROTOCOL/WIRE-MANDATED**(직렬 시맨틱; 병렬은 새 채널).
23. **플랫폼 프레임·터미널 프레임·라인 채널** — host-guest `PLATFORM_FRAME_BYTES`/`TERMINAL_FRAME_BYTES`, host channel `LINE_BYTES` 128. **PROTOCOL/WIRE-MANDATED**.
24. **격리 리소스** — DR37에서 제거. 호환 필드는 모두 0이며 OMA의 CPU/메모리/tasks/시간 cap을 부과하지 않는다.
25. **tool surface 플랜·ask_user_question·MCP 이름 문법** — **PROTOCOL/WIRE-MANDATED**(upstream 계약) 또는 **SECURITY/INTEGRITY**(surface 플랜의 방어적 구조 bound)로 문서화 — §1·§3 표 참조.
26. **VM/헬퍼 데드라인·재시도** — vz-driver·keychain·service timings·society-lease·engine-auth 등. **QUIESCENT/JITTER** — 진행 미관측 경계의 관대한 상한 또는 재시도 예산.

## 8. 확인 방법

UX-38의 원래 표와 2026-10-09 DR37/DR39 후속 확인을 구분한다. DR39에서 직접 재확인한 범위는 quota/admission, quarantine, CONNECT의 동시성·시간·목적지 정책, Review 문서의 byte 계산이다. 나머지 표를 이번 배치에서 전수 재검증했다는 주장은 하지 않는다. 항목이 소스와 어긋나면 소스가 정본이며, 그때는 이 문서를 수정하라. `npm run check:documents`가 이 문서의 링크와 ID 무결성을 검증한다.
