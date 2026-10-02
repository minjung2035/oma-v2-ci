# G07-mail-cli-leaf 적대적 검증 결과

저장소 `/home/dev/oma-v2`, HEAD `070a52d`. 코드 수정·빌드·systemctl 없음. 재현 스크립트는
`review/adversarial-2026-09-28/repro/G07-mail-cli-leaf/` 아래에 있고 이미 빌드된 `dist/`를 import한다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막으로 읽은 줄·내용 앞 20자) |
|---|---|---|---|
| src/mail.ts | 178 | 예 | 178 `}` (MailModule 끝) |
| src/mail/addresses.ts | 44 | 예 | 44 `}` (parseDisplayedAddress 끝) |
| src/mail/batches.ts | 208 | 예 | 208 `}` (batchNotice 끝) |
| src/mail/batch-policy.ts | 32 | 예 | 32 `}` (batchViewOf 끝) |
| src/mail/display.ts | 56 | 예 | 56 `}` (readableBody 끝) |
| src/mail/facts.ts | 102 | 예 | 102 `}` (messagePlanFrom 끝) |
| src/mail/headers.ts | 173 | 예 | 173 `}` (parseEmlHeaders 끝) |
| src/mail/materializer.ts | 130 | 예 | 130 `}` (publishDelivery 끝) |
| src/mail/reconcile.ts | 54 | 예 | 54 `}` (reconcileOrdinaryMail 끝) |
| src/mail/routing.ts | 38 | 예 | 38 `}` (logicalReplyAddress 끝) |
| src/mail/serialize.ts | 100 | 예 | 100 `}` (buildFrozenMessage 끝) |
| src/cli.ts | 42 | 예 | 42 `main(process.argv.sl` (부트스트랩) |
| src/cli/arguments.ts | 75 | 예 | 75 `}` (keyOf 끝) |
| src/cli/cache-codec.ts | 68 | 예 | 68 `}` (decodeCachedRequest 끝) |
| src/cli/effects.ts | 87 | 예 | 87 `}` (resolveOid 끝) |
| src/cli/exit.ts | 93 | 예 | 93 `}` (fatal 끝) |
| src/cli/request-intent.ts | 32 | 예 | 32 `}` (explicitFullOid 끝) |
| src/cli/request-service.ts | 179 | 예 | 179 `}` (effect 끝) |
| src/cli/transport.ts | 167 | 예 | 167 `}` (call 끝) |
| src/cli/commands/agent.ts | 66 | 예 | 66 `}` (runAgentCommand 끝) |
| src/cli/commands/context.ts | 39 | 예 | 39 `}` (runContextCommand 끝) |
| src/cli/commands/integrate.ts | 21 | 예 | 21 `}` (runIntegrateCommand 끝) |
| src/cli/commands/logs.ts | 34 | 예 | 34 `}` (runLogsCommand 끝) |
| src/cli/commands/routes.ts | 21 | 예 | 21 `}` (runRouteCommand 끝) |
| src/cli/commands/send.ts | 98 | 예 | 98 `}` (runAckCommand 끝) |
| src/cli/commands/status.ts | 19 | 예 | 19 `}` (runStatusCommand 끝) |
| src/cli/commands/submit.ts | 58 | 예 | 58 `}` (runSubmitCommand 끝) |
| src/cli/effects/context.ts | 76 | 예 | 76 `}` (prepareContextEffects 끝) |
| src/cli/effects/mail.ts | 31 | 예 | 31 `}` (prepareReplyEffects 끝) |
| src/cli/effects/submit.ts | 86 | 예 | 86 `}` (prepareSubmitEffects 끝) |
| src/leaf.ts | 398 | 예 | 398 `}` (hasNativeLeaf 끝) |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G07-01 | Low | boundary | `pidfdLiveness`가 pidfd가 아닌 임의 fd를 "exited"로 판정 | confirmed |
| G07-02 | Low | boundary | `buildEml`이 문자열이 아닌 subject에 StoreError가 아닌 raw TypeError를 던짐 | confirmed |
| G07-03 | Info | structural | `headerBlock`의 UTF-8/제어문자 검사가 문자열 입력과 바이트 입력에서 비대칭 | high |
| G07-04 | Info | resource | `readBounded`가 `stat.size+1` 버퍼를 미리 할당(head 읽기 제외) | medium |

High 이상 없음. mail 헤더/주소/serialize/arguments/cache-codec/leaf의 주요 적대 벡터는 모두 막혀 있었다(§5).

## 3. 발견 상세

### G07-01 `pidfdLiveness`가 pidfd가 아닌 임의 fd를 "exited"로 판정
- 심각도: Low
- 분류: boundary
- 위반 규칙: P0-5 (unknown을 사실로 승격) — 단, 호출자 계약으로 방어됨
- 코드 경로: `src/leaf.ts:214-227` (`pidfdLiveness`) → `src/leaf.ts:190-201` (`livenessFromPoll`)
- 원인: `pidfdLiveness(fd)`는 `fd`가 음수/비정수인지만 확인하고, 그 fd가 실제로 pidfd인지
  검증하지 않는다. 일반 fd(예: EOF에 도달한 pipe인 stdin)에 `poll(POLLIN)`을 걸면 `POLLIN|POLLHUP`이
  올라오고 `livenessFromPoll`은 이를 `{kind:"exited"}`로 분류한다. docstring은 "Only accepts an
  owned peerPidFd result"라고 주장하지만 코드에는 그 강제가 없다.
- 영향: 만약 어떤 호출자가 `peerPidFd`가 아닌 fd(fd 혼동, fd 재사용, 잘못 전달)를 넘기면, 살아 있는
  actor가 "exited"로 판정되어 그 권한이 회수될 수 있다(P0-5의 "관측 실패를 dead로 승격"). 현재
  코드베이스에서 `pidfdLiveness`의 호출자는 `peerPidFd`의 반환 fd만 넘기므로 실제 도달 경로는 없다.
  그래서 Low. 그러나 `peerPidFd`의 결과 fd와 임의 fd를 타입으로 구분하지 않는 것은 P0-5가 경계하는
  "unknown/observation을 fact로" 계열의 잠재 결함이다.
- 최소 반례: `pidfdLiveness(0)` (node script 실행 시 stdin이 EOF pipe) → `{kind:"exited"}`.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G07-mail-cli-leaf/leaf-probe.mjs`.
  관측: `pidfdLiveness(0): {"kind":"exited"}`, `pidfdLiveness(-1): {"kind":"failed","errno":9}`,
  `pidfdLiveness(999999): {"kind":"failed","errno":9}`.
- 확신도: confirmed
- 개선 방향: fd가 pidfd임을 타입으로 보장(brand된 handle을 `peerPidFd`가 반환하고 `pidfdLiveness`가
  그 타입만 받도록)하거나, `poll` 전에 fstat으로 pidfd(anon_inode)임을 확인. 코드는 고치지 말 것.

### G07-02 `buildEml`이 문자열이 아닌 subject에 raw TypeError를 던짐
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음 (도달 경로가 검증된 호출자에 한정)
- 코드 경로: `src/mail/serialize.ts:23-24` (`assertNoCrlf(p.subject,...)`) → `src/mail/serialize.ts:33`
  (`Buffer.byteLength(p.subject, "utf8")`)
- 원인: `assertNoCrlf`는 `/[\r\n]/.test(value)`로 value를 문자열로 강제 변환하여, `undefined`나
  숫자 subject도 "undefined"/숫자문자열로 통과시킨다. 그다음 `Buffer.byteLength(undefined,...)`가
  `ERR_INVALID_ARG_TYPE` TypeError를 던진다. 이 예외는 StoreError가 아니라 raw TypeError다.
- 영향: production 경로에서는 `renderFrozenMessage`/`freezeMessageFacts`가 subject 문자열을
  검증하고, CLI `send.ts:70`은 `subject ?? "Re"`로 항상 문자열을 만든다. 따라서 실제 도달은 호환용
  `buildEml` export를 직접 잘못 부를 때뿐이다. 그럴 때 오류 분류가 INVALID_REQUEST가 아니라
  internal TypeError로 나와 진단 품질이 떨어진다.
- 최소 반례: `buildEml({ ...유효필드, subject: undefined })`.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G07-mail-cli-leaf/serialize3-probe.mjs`.
  관측: `one-ref THREW TypeError code=ERR_INVALID_ARG_TYPE ... at buildEml (.../serialize.js:33:35)`
  (test object가 subject를 누락한 경우). 정상 subject(`serialize2-probe.mjs`)는 모두 OK.
- 확신도: confirmed
- 개선 방향: `buildEml` 초입에서 `typeof p.subject !== "string"`을 StoreError("INVALID_REQUEST")로
  거절. 코드는 고치지 말 것.

### G07-03 `headerBlock`의 UTF-8/surrogate 검사가 입력 타입에 따라 비대칭
- 심각도: Info
- 분류: structural
- 위반 규칙: 없음
- 코드 경로: `src/mail/headers.ts:38-52` (`headerBlock`)
- 원인: 문자열 입력 경로는 `/\p{Cs}/u.test(block)`로 lone surrogate를 거절하고 byteLength로 limit을
  검사한다. 바이트(Uint8Array) 입력 경로는 `decodeUtf8`(strict)로 UTF-8 위반을 거절하지만 그 뒤
  같은 surrogate 검사를 다시 하지 않는다(decodeUtf8이 strict라 실질적으로 동치일 가능성이 높음).
  두 경로가 "무엇을 header block으로 받아들이는가"를 각각 정하는 형태(P0-2가 경계하는 두 owner
  모양)라, 미묘한 차이가 생기면 저장 시(bytes)와 읽기 시(string) 판정이 갈릴 수 있다.
- 영향: 현재는 strict decodeUtf8이 lone surrogate를 만드는 입력을 이미 거절하므로 관측된 실제
  차이는 없다. 그래서 Info. 구조상 한 검사(surrogate/byte limit)를 두 분기에서 독립 구현한 지점.
- 최소 반례: 없음(관측된 발산 입력을 찾지 못함, §6 참조).
- 재현 방법: 추론만. `headers-probe.mjs`의 `8bit-latin1`은 바이트 경로에서 "header is not UTF-8"로
  거절됨을 확인. 문자열/바이트 경로가 같은 입력에서 다르게 판정하는 사례는 만들지 못함.
- 확신도: high (코드 구조), 발산 사례는 미확인
- 개선 방향: block 판정을 한 함수로 모아 두 입력이 같은 규칙을 통과하도록. 코드는 고치지 말 것.

### G07-04 `readBounded`가 whole 읽기에서 `stat.size+1` 버퍼를 선할당
- 심각도: Info
- 분류: resource
- 위반 규칙: 없음
- 코드 경로: `src/cli/effects.ts:73-83` (`readBounded`)
- 원인: whole 읽기는 `Buffer.alloc(stat.size + 1)`을 먼저 할당하고, size가 limit을 넘으면 그 후에
  `refuse("size")`한다 — 즉 size 검사(`if (whole && stat.size > limit) refuse`)가 alloc보다 먼저
  있어서 limit 초과 파일은 큰 버퍼를 할당하지 않는다. 따라서 자원 고갈 경로는 실제로는 막혀 있다.
  head 읽기는 `Math.min(stat.size, limit)+1`로 제한된다. 남은 미세 포인트는 limit 자체가 큰 경우
  (context 8 MiB, bundle 256 MiB) 한 번에 그만큼을 alloc한다는 것뿐이며, 이는 프레임/스트림 계약상
  의도된 상한이다.
- 영향: 없음(상한이 계약으로 고정). 기록용 Info.
- 최소 반례: 없음.
- 재현 방법: 코드 검토(effects.ts:73-83). 추론만.
- 확신도: medium
- 개선 방향: 불필요. 상한이 이미 owner(transport의 frame/stream bound)로 고정됨.

## 4. 리팩터링 필요 지점

- `headers.ts`의 `headerBlock` 문자열/바이트 이중 판정(G07-03): 한 판정 함수로 합치면 P0-2 관점에서
  "무엇이 유효한 header block인가"의 owner가 하나가 된다. 단 지금도 관측된 발산은 없다.
- `leaf.ts`의 pidfd/일반 fd 타입 미구분(G07-01): `peerPidFd`가 brand된 handle을 돌려주고
  `pidfdLiveness`가 그 타입만 받으면, "이 fd가 정말 pidfd인가"라는 관측을 코드가 아니라 타입이
  보장한다(P0-5). 같은 vocabulary("running/exited/failed")를 쓰는 flock/abstract-name과 대칭.

## 5. 점검했고 문제없다고 판단한 것 (공격했지만 막혀 있던 경로)

- **CRLF/LF 헤더 주입** (`headers.ts:118`): 각 줄에 `/[\x00-\x08\x0b-\x1f\x7f]/` + 998바이트 제한.
  bare CR, NUL, 998+ 줄 모두 거절(`headers-probe.mjs`: `bare-CR-in-value`, `nul-in-header`,
  `998+line` 전부 REJECTED). serialize의 `assertNoCrlf`(serialize.ts:22-24)가 from/to/reply/
  message-id/references의 CR/LF도 거절(`crlf-in-to` REJECTED).
- **From 사칭·homoglyph·대소문자·+태그** (`addresses.ts:31-43`, `materializer.ts:83-96`): raw 파서는
  `Admin+boss@`, homoglyph 로컬파트를 문자열로는 받아들이나, materializer의 `parseDisplayedAddress`가
  logical 주소로 되돌릴 때 `knownActors.has(raw)` + 정확한 케이스/형식만 통과. `Alice`,`alice+tag`,
  Cyrillic `аlice`, `ALICE@`, `bob@other`는 모두 `null`(`serialize-address-probe.mjs`). To/Reply-To가
  MessagePlan의 recipients와 정확히 일치하지 않으면 materialize가 STORE_CORRUPT(materializer.ts:97-99).
- **Message-ID/In-Reply-To/References 위조로 다른 thread 붙이기** (`mail.ts:65-86`): 답장 대상은
  caller가 준 문자열이 아니라 `replyHeaders(input.replyToMessage)`가 store operation으로 검증한
  parent에서만 나온다(mail.ts:99-116). References는 parent의 ancestry에서 파생되며 caller가 직접
  넣을 수 없다. 다른 수신자에게 붙이는 것도 route가 store snapshot으로 재확장되어 막힘.
- **RFC 2047 인코딩 워드 우회** (`headers.ts:75-98`): Base64 canonical 재검사(`bytes.toString("base64")
  !== encoded` 거절), Q 워드는 명시 허용 시에만, 인접 인코딩워드 사이 비공백 gap에 `=?` 있으면 거절.
  subject의 raw projection은 durable 소비자를 위해 보존되며 body는 절대 디코드하지 않음(display.ts).
- **수신자 중복·과다** (`mail.ts:68`, `facts.ts:97-99`, `routing.ts`): `[...new Set(...)].sort()`로
  dedup, `messagePlanFrom`이 `new Set(recipients).size !== recipients.length`면 INTERNAL_ERROR.
- **은퇴/프로비저닝 agent, 자기 follow** (`routing.ts:14-35`): `desired==="retired"|"provisioning"`은
  주소 확장에서 제외/거절. topic 구독자도 같은 필터. self-reply-to는 `selectReplyTargets`가 dedup.
- **Maildir tmp→new / 방송 중 crash** (`materializer.ts:105-129`, `mail.ts:150-160`,
  `reconcile.ts`): archive publish 후 delivery마다 file publish + `markMaterialized`를 별도 tx로.
  crash 시 재실행은 `reconcileMailOperation`이 immutable no-replace(`publishImmutableFile`,
  immutable-file.ts:127-216, EEXIST/재검증 멱등)로 재게시하고 모든 delivery가 materialized일 때만
  succeeded로. 부분 방송은 unknown/pending으로 남아 P0-5 준수. `moveToCur`(batches.ts:132-165)는
  cur를 먼저 durable하게 만들고 new를 나중에 제거, FS-005로 디렉터리를 한 번 열어 관측/이동 대상을
  동일하게 유지.
- **reconcile이 원문 없는 delivery를 판정** (`reconcile.ts:9-31`): archive `absent`는 "materialize
  필요"로만 두고 repair 아님. `corrupt`는 throw, `unavailable`은 BROKER_UNAVAILABLE(unknown).
  recipient snapshot이 바뀌면 STORE_CORRUPT. P0-5 준수.
- **batch 경계·재할당·정책 경계값** (`batch-policy.ts:9-27`, `batches.ts:88-118`): max<1/NaN/1.5는
  UNSUPPORTED_PROFILE, 두 class 동시 pending에 max<2도 거절(`serialize-address-probe.mjs`).
  incarnation>auth.incarnation인 prepared batch는 BATCH_CONFLICT(batches.ts:93, DR9). complete/
  settleFromReceipt는 batch·actor·incarnation·manifest·state를 tx 안에서 재확인.
- **CLI argv 파싱** (`arguments.ts:41-66`): 값처럼 보이는 옵션은 슬롯에서 verbatim(`--subject --file`
  → subject=`--file`), `--` 이후 positional, 단일 옵션 중복 거절, 미지 옵션 거절, NUL은 값으로 통과.
  (`arguments-probe.mjs` 전부 계약대로).
- **request key 생성·재시도** (`request-service.ts`, `request-intent.ts`): key는 caller가 주거나
  `randKey()`(uuidv4). 재시도는 frozen cache에서 같은 key로 replay하며 REQUEST_NOT_FOUND가
  증명될 때만 재전송, source에서 재구성 안 함. 다른 payload가 같은 key면 REQUEST_KEY_REUSED(exit 2).
- **cache-codec 손상·prototype 오염** (`cache-codec.ts`): closed-object 검사, key 바인딩,
  `__proto__` 오염 거절, mutation method만, digest/descriptor 일치 강제(`cache-codec-probe.mjs`
  전부 REJECT). corrupt/unavailable cache는 source builder에 도달하지 않음(request-service.ts:180-197).
- **transport timeout/연결 끊김의 exit code** (`transport.ts:120-137`, `exit.ts`,
  `errors.ts:313`, `receipts.ts:15`): 60초 deadline → BROKER_UNAVAILABLE. `call` 예외 →
  `fail("미접수 여부 불명확...", 3)`. receipt unknown → exit 3, failed → 2, unsupported → 4,
  retry same-key → 3. unknown과 failed를 exit code로 구분(P0-5 준수).
- **effects 로컬 파일 읽기: symlink/큰 파일** (`effects.ts:28-58`, `effects/context.ts`,
  `effects/submit.ts`): `O_NOFOLLOW`로 링크 미추종(ELOOP → exit 2), `fstat.isFile()`만, whole 읽기는
  size>limit이면 거절, 읽는 중 파일이 커지면 "grew" 거절(/dev/zero 무한 방지), context walk는
  `O_DIRECTORY|O_NOFOLLOW` + `/proc/self/fd` 고정 + nlink!==1 거절로 TOCTOU/hardlink 방어.
- **leaf FFI 인자·errno** (`leaf.ts`): peerCred(비소켓/음수/비정수) → null, getsockopt optlen!==12 →
  null, flock/abstract-name/pidfd 모두 held/contended·taken/failed의 3답(unknown 보존). 추상 이름
  이중 hold는 EADDRINUSE→taken, holder 조회, `abstractNameHeld` 재확인 모두 정상
  (`leaf-probe.mjs`). sdNotify는 NUL/oversize/빈 경로 거절. `livenessFromPoll`의 EINTR는
  8회 재시도 후 failed(무한루프 없음, `leaf-probe.mjs`: `calls=8`).

## 6. 확인하지 못한 것

- G07-01의 실제 도달: 현재 호출자가 항상 `peerPidFd` 결과를 넘기는지 그룹 밖 호출부를 전부 추적하지는
  않았다(broker의 lease/liveness 소비자). 도달하면 Low → High로 재평가 필요.
- G07-03: 문자열 경로와 바이트 경로가 같은 입력에서 다르게 판정하는 구체적 발산 입력을 만들지 못했다.
  strict `decodeUtf8`의 내부(그룹 밖 `domain/utf8.ts`)가 surrogate를 어떻게 다루는지 정밀 확인 안 함.
- Maildir 파일 이름 유일성: `moveToCur`/`publishDelivery`는 messageId 기반 경로를 쓰고 시계/pid 기반
  이름 충돌은 관측되지 않았으나, `mailInboxPathAt`/Maildir suffix 생성(그룹 밖 `storage/paths.ts`)의
  `:2,` 처리와 시계 역행 상호작용은 직접 실행하지 못했다(store/broker 컨텍스트 필요).
- send()의 전체 crash 주입(§5.3 방송 중 SIGKILL)은 Store/broker 인스턴스가 필요해 순수 함수 수준을
  넘어서므로 실제 kill 주입은 실행하지 못했다. immutable no-replace 멱등성 근거로 추론만.
