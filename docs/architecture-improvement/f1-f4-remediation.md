# F1–F4: reply 입력, request identity, log frame 경계

기준은 보고서의 master `9b4ea8f611262b60518767490bc5d3c8a3a41075`가 아니라
`refactor/safety-preserving-architecture`의 `d2524ebbac2a8efd03a41a0023358ab40f8a036c` + working tree다.
실제 실행 결과·날짜·source pin은 [현재 검증 상태](../../implementation/validation.md)에서 확인한다.
공개/내부 wire DTO, durable v1 계약, DB schema, physical ordering 및 OPEN SPIKE는 변경하지 않는다.

## 수정 경계

- **F1 / MAIL-005·MAIL-008:** `MailModule.replyHeaders`는 사용자 선택을 먼저 해석한다.
  비메시지 operation, 독립 initial message가 없는 linked creation, 다른 ordinal,
  미존재 대상은 `INVALID_REQUEST`다. 이 경로는 새 operation을 수락하지 않는다.
  `operationMessage`의 내부 publication invariant, Store의 accepted-row 검증,
  materializer의 실제 immutable bytes/hash 검증은 여전히 `STORE_CORRUPT`이며
  `AdmissionGate`의 영구 차단 정책을 약화시키지 않는다.
- **F2 / ID-002·IPC-007/008:** CLI `keyOf`에서 `--request` 생략과 값 누락을 구분한다.
  다음 option, empty 값, 중복 지정도 거절한다. cache/source/Git/socket 준비와
  UUID 생성보다 앞선 exit 2다. 생략 시 신규 key, 유효한 명시 key의 frozen-cache
  lookup/retry 정책은 유지한다. 별도의 CLI parser 재설계는 하지 않았다.
- **F3 / VIEW-003·CFG-003:** `src/protocol/log-response.ts`는 순수한 K1 wire codec이다.
  `logs.read` 성공 envelope의 ID, boolean/timestamp metadata, JSON escaping,
  UTF-8 bytes를 실제 `JSON.stringify` 결과로 계산하고 Unicode-safe prefix를 선택한다.
  frame 때문에 추가로 잘리면 `truncated: true`를 유지한다. `logBytes`의 raw journal
  제한은 별개로 계속 적용하며, 그 경계에서도 partial UTF-8 문자를 만들지 않는다.
  host는 최소 log envelope를 담지 못하거나 uint32 framing 범위를 넘는 설정을 거절한다.
  최소값은 empty ID와 최대 safe-integer timestamp 기준이다. 유난히 긴 개별 ID가
  empty log response조차 담을 공간을 남기지 않으면 `INVALID_REQUEST`이며,
  임의 ID 길이에 대한 성공 보장을 추가하지 않는다.
- **F4 / CFG-003:** 규범이 모든 endpoint에 같은 host 한도를 요구하고 sandbox가 이미
  `OMA_FRAME_BYTES`를 전달하므로, 고정 256 KiB를 별도 CLI 상한으로 보지 않는다.
  CLI는 해당 환경값을 unsigned decimal bytes로 검증하고 요청/응답 모두에 적용한다.
  미설정만 256 KiB 기본값을 사용한다. empty, 비정수/비숫자, unsafe integer,
  지원 범위 밖의 값은 연결 전에 `INVALID_REQUEST`다. sandbox 밖에서 직접 실행할 때도
  비기본 host와 같은 값을 전달해야 한다. framing의 4-byte length header는 body 한도에
  포함하지 않는다. 기존 absolute 60-second deadline과 무자동재시도 정책은 유지한다.

## 회귀와 한계

- `test/f1-reply-boundary.test.ts`: 실제 Store/Mail/PublicDispatcher/AdmissionGate의
  입력 오류 후 정상 수락, linked creation·ordinal·미존재 판정과 실제 bytes 손상 후 차단.
- `test/f2-cli-request.test.ts`: 11개 mutation의 준비 전 거절, tripwire 양성 대조,
  새 request identity와 명시 key의 frozen-cache lookup. Peer는 소유 local mock socket이다.
- `test/f3-log-frame.test.ts`, `test/protocol-method-descriptors.test.ts`: 기본 1 MiB log /
  256 KiB frame, 작은 frame, escaping/다중 byte/ID 예산, 실제 frame decoder와 최소 설정.
- `test/f4-cli-frame.test.ts`: 더 크거나 작은 설정의 양방향 한도, 기본값,
  잘못된 설정의 연결 전 거절과 무재시도. 실제 broker startup 증거는 아니다.
- F1은 durable lane, F2–F4 및 host-config 회귀는 fast lane의 required files/names에 포함한다.
  모든 신규 tests는 default guarded local suite에도 포함한다.

지원된 storage quota profile 부재에 따른 `SPIKE_UNRESOLVED`는 그대로다.
이 수정과 local mock/fixture 통과는 실제 systemd, provider, power-loss 또는 release 인증이 아니다.
과거 audit source pins를 현재 값으로 덮어써 재인증하지 않는다. 새 graph/LOC와 lane source digests는
새 실행에만 결합한다. LOC/release 승인과 실제 환경 검증은 별도 작업이다.
