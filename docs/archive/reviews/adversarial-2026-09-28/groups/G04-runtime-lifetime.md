# G04-runtime-lifetime 적대적 검증 결과

저장소 `/home/dev/oma-v2`, branch `feat/macos-hidden-vm`, HEAD `070a52d`. 코드 미수정. 재현 스크립트는
`review/adversarial-2026-09-28/repro/G04-runtime-lifetime/` 아래에만 두었고 `/tmp/oma-adv-G04-*`의 임시
디렉터리를 쓰고 지운다. `dist/`는 HEAD 빌드를 그대로 import했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 |
|---|---|---|---|
| src/runtime/society-lease.ts | 228 | 예 | 호출 helper `src/leaf.ts`(195–360)도 확인 |
| src/runtime/broker-lifetime.ts | 95 | 예 | |
| src/runtime/broker-supervisor.ts | 336 | 예 | `src/process/async.ts`(150–240) 확인 |
| src/runtime/host-tenure.ts | 177 | 예 | |
| src/runtime/process-lock.ts | 72 | 예 | |
| src/runtime/run-registry.ts | 163 | 예 | |
| src/runtime/supervision-channel.ts | 91 | 예 | `src/protocol/host-channel.ts` 확인 |
| src/runtime/principal-delivery.ts | 247 | 예 | |
| src/runtime/inference-relay.ts | 498 | 예 | `src/frame.ts` 확인 |
| src/runtime/engine-auth.ts | 137 | 예 | |
| src/runtime/egress-forwarder.ts | 170 | 예 | |
| src/runner.ts | 341 | 예 | |
| src/entry/runner.ts | 102 | 예 | |
| src/entry/oma.ts | 593 | 예 | |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G04-01 | Low | resource | `disown()`은 `principalEgress`를 닫지 않아 macOS guest에서 forwarder listener/probe가 누수된다 | high |
| G04-02 | Low | resource | `EgressForwarder.listen`의 `existsSync`+`unlinkSync`는 TOCTOU로 ENOENT에 취약(자매 코드 InferenceRelay는 `rmSync{force}`) | high |
| G04-03 | Info | structural | 소켓 정리(`rmSync force` vs `existsSync/unlinkSync` vs `unlink` catch)가 세 곳에서 서로 다르게 구현됨 | high |

High 이상 발견 없음.

## 3. 발견 상세

### G04-01 `disown()`이 `principalEgress`를 닫지 않아 macOS guest에서 forwarder가 누수된다
- 심각도: Low
- 분류: resource
- 위반 규칙: P0-4 (DR14: listener/FD는 생긴 순간부터 끝까지 한 owner가 가지며 owner가 떠나면 끝난다)
- 코드 경로: `src/entry/oma.ts:400`(`openPrincipalEgress`로 `principalEgress` 대입) → `src/entry/oma.ts:508`(`disown`은
  `delivery=null; tenure.end(); session=null`만 하고 `principalEgress`는 건드리지 않음) → 대비: `shutdown`
  `src/entry/oma.ts:343`은 `await principalEgress?.close()`를 부른다.
- 원인: `openPrincipalEgress`(egress-forwarder.ts:150)는 `EgressForwarder.listen`으로 `runRoot/principal-inference.sock`에
  listener를 열고 `freeLoopbackPort`로 loopback probe를 잠깐 연다. 이 자원의 owner는 host 프로세스다. 정상 종료
  경로(`shutdown`)와 크래시 경로(`abandon`, exit가 뒤따르므로 OS가 회수)는 정리하지만, **disown 경로는 프로세스를
  계속 살려둔 채(Control Panel로 전환)** forwarder를 닫지 않는다. `disown`은 tenure만 반납하고 forwarder는 남긴다.
- 영향: macOS guest(`OMA_EGRESS_SOCKET`이 있는 경우)에서만 발생. disown된 뒤 남은 프로세스 수명 동안 unix listener
  1개와 열려 있던 연결이 유지된다. 새 owner oma가 같은 `runRoot`에서 `EgressForwarder.listen`을 부르면
  `existsSync`+`unlinkSync`로 소켓 파일을 지우고 자기 것을 bind하므로, 남은 forwarder는 이름이 사라진 소켓을 계속
  들고 있는 고아가 된다(두 society 소유자 충돌은 아니고 자원 누수). Linux에서는 `principalEgress`가 null이라 무해.
- 최소 반례: macOS guest에서 `oma` 실행 → egress forwarder 열림 → 다른 `oma`가 society를 가로채 broker가
  `SOCIETY_OWNED_EXIT`/disown을 유발 → 첫 프로세스가 `disown`을 타지만 `principal-inference.sock` listener는 남는다.
- 재현 방법: 추론만. macOS guest 환경(`OMA_EGRESS_SOCKET`)과 두 oma race가 필요해 이 환경에서 직접 재현하지 않았다.
  코드 경로는 `disown`(oma.ts:508–518)에 `principalEgress` 참조가 전혀 없음을 읽어 확인했다.
- 확신도: high
- 개선 방향: `disown`에서도 `shutdown`과 같이 `principalEgress`를 닫고 null로 두어, forwarder의 수명을 tenure/owner
  전환에 묶는다(P0-4). 정리 지점을 한 곳(예: `endHostResources`)에 모아 세 경로가 같은 함수를 부르게 하면 재발을 막는다.

### G04-02 `EgressForwarder.listen`의 소켓 선행 삭제가 TOCTOU에 취약하다
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음(견고성)
- 코드 경로: `src/runtime/egress-forwarder.ts:87` `if (existsSync(socketPath)) unlinkSync(socketPath);`
- 원인: `existsSync`로 존재를 본 뒤 `unlinkSync`로 지우는 두 단계 사이에 파일이 사라지면(다른 정리, 경쟁 프로세스)
  `unlinkSync`가 ENOENT을 던지고 `listen`이 실패한다. 같은 목적의 InferenceRelay.open은
  `rmSync(socketPath,{force:true})`(inference-relay.ts:171)로 한 단계·멱등이다.
- 영향: 드문 경쟁에서 forwarder 시작이 조용히 실패하지 않고 예외로 죽는다. run-root는 incarnation별이라 실질 경쟁은
  좁지만, "없으면 무시"가 아니라 "없으면 오류"가 되는 것은 P0-5의 관측/사실 구분과 결이 다르다.
- 최소 반례: `socketPath` 존재 확인 직후 그 파일이 unlink되는 순간.
- 재현 방법: 추론만(타이밍 창이 좁아 결정적 재현 스크립트를 만들지 않았다). 두 구현의 차이는 dist에서도 확인
  (`dist/src/runtime/egress-forwarder.js:87`의 `existsSync(socketPath)`).
- 확신도: high
- 개선 방향: `rmSync(socketPath,{force:true})`로 통일한다(G04-03과 함께).

### G04-03 소켓 파일 정리가 세 곳에서 서로 다르게 구현됨
- 심각도: Info
- 분류: structural
- 위반 규칙: P0-6(같은 결정의 중복 구현·drift)
- 코드 경로: `inference-relay.ts:171`(`rmSync force` 선행), `inference-relay.ts:495`(close시 `rmSync force`),
  `egress-forwarder.ts:87`(`existsSync`+`unlinkSync` 선행), `egress-forwarder.ts:158`(close시 `unlinkSync` in try/catch).
- 원인: "이 incarnation의 소켓 파일을 만들기 전에 지우고, 끝에 지운다"는 한 결정이 세 표현으로 흩어져 있다.
- 영향: 기능 결함은 아니나 G04-02 같은 미세 차이가 반복될 여지. 한 helper로 모으면 재발 방지.
- 확신도: high
- 개선 방향: "run-root 소켓 게시/회수" helper 하나로 통일.

## 4. 리팩터링 필요 지점
- host 자원 정리(tenure.end / broker.stop / principalEgress.close / terminal.restore)가 `shutdown`, `abandon`,
  `disown` 세 경로에 손으로 나뉘어 있고 각기 다른 부분집합을 정리한다(G04-01의 근본 원인). `entry/oma.ts`의 이
  세 경로는 "이 프로세스가 society를 위해 시작한 모든 것"을 한 owner 객체로 모아 한 번에 반납하도록 하면
  P0-4를 구조로 지킨다. 현재는 `HostTenure`가 engine/lease만 소유하고 broker·egress·terminal은 밖에 있다.

## 5. 점검했고 문제없다고 판단한 것 (근거 줄)
- **society-lease / host-tenure / process-lock**: 소유권 fence를 abstract AF_UNIX name(society-lease.ts:110–160)과
  flock(process-lock.ts:34–46)의 열린 파일 기술자에 묶어, 자식이 상속한 기술자가 살아 있는 한 커널이 lease를
  유지한다. pid 생존·시계에 의존하지 않는다. pathname을 안 쓰므로 같은 UID의 unlink/rename/symlink 교체가
  불가능(leaf.ts 267–299 주석과 코드). stale 판정을 pid로 하지 않는다. 재현: `repro/.../lease.mjs` — 배타성,
  release 후 재획득, 이중 release 안전, inheritedFence가 자기 fence를 `society`로 인식, 이름 안정성 모두 확인
  (`parent holds: true / second acquire none(correct) / after release re-acquire held(correct) / double release safe: true`).
  다른 UID holder는 `tryHoldSociety`(society-lease.ts:138–148)에서 throw로 분기되어 "elsewhere"로 오인하지 않는다.
  "holder unknown"(백로그 참)은 보수적으로 소유됨으로 처리(society-lease.ts:150) — 안전.
- **inherited fence 인식**: 모양("소켓인가")이 아니라 커널에 이름을 물어(leaf.ts:341–381 `abstractNameHeld`,
  `SO_ACCEPTCONN` 확인 포함) 판정. 손으로 만든 socketpair(이름 없음, size<=2)와 pathname bind는 거부.
- **broker-supervisor 재시작**: 창(window)을 `performance.now()`(monotonic)로 계산하고 시계 역행에 견딤
  (broker-supervisor.ts:245–248, 주석이 MAC-650 인용). `maxRestarts`로 유한(무한 재시작 없음). `current` 가드로
  두 broker 공존 없음(exit시 즉시 `current=null`, 지연 재시작은 `stopping`·`current` 재확인). `SOCIETY_OWNED_EXIT`는
  disown이고 재시작 안 함(broker-supervisor.ts:238–242). 자식은 supervision-channel 종료로 부모의 죽음을 배우고
  스스로 종료(supervision-channel.ts, 주석). 자식은 fence 상속으로 부모보다 오래 살아도 society를 넘기지 않음.
- **run-registry / P0-1**: RunLeaseIdentity(actor·incarnation)와 batch identity를 분리. `begin`은 이전 incarnation의
  cgroup이 empty/removed로 **증명**되어야만 진행하며, `population()`의 unknown을 dead로 승격하지 않음
  (run-registry.ts:120–124, P0-5). `settlementQuiescence`는 opening run만 권한으로 인정하고 published/revoked/replaced시
  `confirm`이 throw(run-registry.ts:141–151). runner의 `prepareBatch`는 batch.incarnation != lease.incarnation을
  STALE_RUN으로 거부(runner.ts:150–160). delivery는 첫 receipt의 sessionPath로만 complete(principal-delivery.ts:227–233,
  runner.ts:consume) — 새 incarnation이 과거 receipt 의미를 바꾸지 못함.
- **엔진 exit code 해석(P0-5)**: `entry/runner.ts`는 실패를 exitCode 2로 두지만, 실패시 batch를 complete하지 않고
  durable batch는 prepared로 남는다(runner.ts:run/consume). 즉 exit 2는 운영 신호이지 batch에 대한 durable fact가
  아니므로 unknown→failed 승격은 아니다. 단 exit code를 사실로 읽는 상위 unit 해석은 이 그룹 밖이라 §6에 남긴다.
- **principal-delivery 중복/유실**: `inFlight` 가드로 tick 중복 실행 방지(principal-delivery.ts:150). settled인데
  boundary 없음/accept 안 됨은 `SESSION_BOUNDARY_UNCONFIRMED`/`PROVIDER_FAILED`로 두고 delivered로 승격하지 않음
  (principal-delivery.ts:210–226). 미확정 delivery는 session claim을 놓지 않음(finally 주석, D06/WP09). retry 간격·
  accept 기한은 기본 `performance.now`(principal-delivery.ts:117 주석·148·202) — 벽시계 점프에 견딤.
- **inference-relay 보안**: 목적지는 host의 origin 고정, 요청은 그 경로를 연장만 가능(targetPath: `..`/`%2e%2e`/
  `//`/`%2f` 모두 canonical 비교로 거부). credential은 authority slot(`x-api-key`, `Bearer <ph>`, `key=` query)에서만
  실키로 치환, 그 밖의 위치의 placeholder는 403(inference-relay.ts:222–260). 응답 헤더/본문이 실키를 나르면
  CredentialTripwire가 청크 경계 넘어 잘라냄. 헤더 주입은 `HEADER_NAME`/`UNSAFE_VALUE`(CRLF·NUL) 검사와 hop-by-hop
  제거로 막음. 동시성 `concurrent` 상한·`maxConnections` 상한·timeout으로 소켓 누수 방지. 응답은 `accept-encoding:
  identity` 강제로 tripwire가 실제 바이트를 봄. 재현: `repro/.../relay-path.mjs`(경로 이탈 불가·slot만 치환·헤더/query
  smuggle 403), `repro/.../relay-tripwire.mjs`(청크 분할 secret도 잘림, `SECRET LEAKED? false`).
- **egress-forwarder(gu(guest 측)**: 허용 목록 로직은 이 모듈에 없다 — 순수 바이트 파이프로, host의 egress
  service(그룹 밖)로만 나간다. `concurrent`(=4) 상한 초과 연결은 destroy(egress-forwarder.ts:120). 양쪽 close 시
  상대 destroy(반쯤 닫힌 소켓 정리). 대소문자/IP/IPv6/CONNECT/DNS rebinding 등 허용목록 우회는 이 파일의 관심사가
  아니며 여기서 판정 불가(§6).
- **engine-auth**: `resolveEngineAuth`는 엔진 SDK에 위임하고 OMA-owned agent dir만 읽음; `allowModelNetwork:false`.
  파일을 직접 쓰지 않아 부분 쓰기/symlink 노출 없음. `placeholderFor`는 실키를 절대 포함/동일하지 않은 placeholder를
  보장하거나 거부. 재현: `repro/.../placeholder.mjs` — 준비된 shape 11종 + 무작위 500종에서 `LEAKS FOUND: 0`.
- **entry/oma.ts 정리 순서·TOCTOU**: `uncaughtException`/최상위 catch가 `abandon()`(tenure.abandon + broker.stop +
  terminal.restore) 후 exit. 프로젝트 경로는 `realpathSync`로 한 번 관측(oma.ts:129, D05/WP16), state root는 lease가
  자기 이름을 그 경로에서 유도하며 사용 전에 검증. broker가 이미 listening이면 아무것도 쓰기 전에 tenure를 반납하고
  물러남(oma.ts:186–191). frame/host-channel 코덱은 크기·grammar·중복 key·prototype key 방어(frame.ts, host-channel.ts).
- **시계**: 이 그룹의 deadline/window는 모두 `performance.now`(monotonic) 또는 커널 fence를 쓰고, 벽시계(Date.now)는
  관측 타임스탬프(oma.ts:288 `observedAtMs`)에만 쓰인다. Date.now를 기한 계산에 쓰는 곳을 찾지 못했다.

## 6. 확인하지 못한 것
- **엔진 exit code의 상위 해석**: `entry/runner.ts`의 exitCode 2를 unit/broker가 어떻게 durable하게 해석하는지는
  이 그룹 밖(units/*, broker). unknown→failed 승격 여부는 그 owner에서 확인해야 한다.
- **egress 허용 목록 우회(대소문자/IP literal/IPv6/포트/CONNECT/DNS rebinding)**: 실제 허용 목록·CONNECT 파싱은
  guest의 egress service(macos-platform §4.7, 그룹 밖)에 있다. 이 그룹의 `egress-forwarder.ts`는 단일 소켓으로의
  순수 파이프이므로 여기서는 판정 불가.
- **G04-01/G04-02의 macOS guest 실경로**: `OMA_EGRESS_SOCKET`이 있는 guest 환경과 두 oma race, systemd/sudo가 필요해
  이 환경에서 실행 재현하지 않았다(브리프 규칙 3). 코드 읽기로만 확인했다.
- **SIGKILL 직후 시퀀스**: society lease가 커널 fence라는 근거로 안전하다고 판단했으나, 실제 SIGKILL 주입
  경계 시험은 systemd 단위가 필요한 부분이 있어 여기서 실행하지 않았다.
