# oma-v2 적대적 검증 최종 보고서

- 기준: branch `feat/macos-hidden-vm`, HEAD `070a52d`(v22 결박), `dist/`는 이 HEAD로 빌드(`npm run build` 성공)
- 일자: 2026-09-28
- 규칙: 코드를 수정하지 않았다(`git status`는 `review/`만 untracked). 결과는 이 디렉터리의 문서와 재현 스크립트뿐이다.
- 최상위 판정 기준: `PRIORITY-0.md`의 명제와 P0-1…P0-7

## 0. 결론

production 273개 파일과 `platform/` 아래 13개 파일을 전부 읽었고, 커버리지 표의 줄 수는 `wc -l`과 일치한다(§1).
최종 판정은 **Critical 0, High 3, Medium 6, Low 27, Info 16**다(§3–§4). High 셋은 모두 재현했다.

| ID | 심각도 | 요약 | 위반 |
|---|---|---|---|
| F-01 | High | Resident seccomp의 vsock 차단이 io_uring `IORING_OP_SOCKET`으로 우회된다. 봉인 플래그 그대로 sandbox 밖 vsock listener에 연결까지 된다 | MAC-205, SB 경계 |
| F-02 | High | macOS archive가 최종 경로에 직접 쓰인다. `existsSync`를 완성의 증거로 써서, 부분·깨진 archive가 같은 key 재시도에서 성공으로 반환된다 | P0-5, P0-4, macos-platform §9(1030–1031) |
| F-03 | High | stream 수신 중 `writeSync` 실패가 socket `data` listener에서 uncaughtException이 된다. omahostd가 죽고, 암호화 전 평문 archive가 디스크에 남는다. guest(guesthost)에도 같은 모양이 있다 | P0-4, MAC-621 |

Linux core의 ledger·게시 순서·시계 역행 방어·transaction 경계·unknown 비승격(P0-5)은 두 번의 독립 감사와 재현에서 견고했다(§6).
결함은 주로 세 곳에 모였다.

1. **봉인의 syscall 경계.** 필터가 deny-list 방식이라, 막으려는 효과를 syscall 번호 두 개로만 막는다.
2. **macOS 플랫폼 층의 파일 게시와 이벤트 콜백.** Linux core의 게시 primitive와 오류 경계를 쓰지 않는다.
3. **untrusted 쪽이 쓸 수 있는 파일에 durable 판단이 걸리는 자리.** 예: session 파일.

## 1. 범위, 방법, 커버리지

**방법.** production 목록(`production-files.txt`, 273개)과 `platform/` 13개를 13개 그룹으로 나눴다(`groups.tsv`, 중복·누락 0을 스크립트로 확인). 그룹마다 독립 감사자가 공통 지침(`AUDIT-BRIEF.md`)으로 파일을 끝까지 읽고 재현 스크립트를 만들었다. 그 뒤 교차 영역 감사 2개(봉인·권한, crash·내구성·시계·자원 패턴)를 돌렸다. Medium 이상은 모두 내가 코드를 다시 읽고 판정했고, High 셋은 직접 재현했다(`repro/verify/`).

**커버리지 증명.** 1차 wave의 G01·G02·G03 보고는 커버리지 표의 줄 수가 실제와 달랐다(46개 파일 중 45개. 예: `src/broker.ts` 보고 344 / 실제 546, `delivery-receipt.ts` 344 / 460). 끝까지 읽었다는 증거가 없으므로 그 세 그룹은 **기각하고 재감사(-r2)**했다. 재감사부터는 `wc -l` 값과 마지막으로 읽은 줄을 적게 했다. 최종 표는 전부 `wc -l`과 일치한다(스크립트로 대조).

| 그룹 | 파일 | 줄 | 보고서 | 표 대조 |
|---|---|---|---|---|
| G01 storage-fs | 17 | 3014 | `groups/G01-storage-fs-r2.md`(1차는 참고) | 17/17 일치 |
| G02 ledger | 16 | 2422 | `groups/G02-ledger-r2.md`(1차는 참고) | 16/16 |
| G03 broker | 14 | 2646 | `groups/G03-broker-r2.md`(1차는 참고) | 14/14 |
| G04 runtime-lifetime | 14 | 3250 | `groups/G04-runtime-lifetime.md` | 14/14 |
| G05 sandbox-units-engine | 22 | 3037 | `groups/G05-sandbox-units-engine.md` | 22/22 |
| G06 git-lifecycle | 20 | 2371 | `groups/G06-git-lifecycle.md` | 20/20 |
| G07 mail-cli-leaf | 31 | 2805 | `groups/G07-mail-cli-leaf.md` | 31/31 |
| G08 config-domain | 25 | 3226 | `groups/G08-config-domain.md` | 25/25 |
| G09 protocol-validate-diagnostics | 23 | 2917 | `groups/G09-protocol-validate-diagnostics.md` | 23/23 |
| G10 extension-process-views | 30 | 2751 | `groups/G10-extension-process-views.md` | 30/30 |
| G11 tui | 23 | 3516 | `groups/G11-tui.md` | 23/23 |
| G12 platform-host(+Swift) | 23 | 2006+351 | `groups/G12-platform-host.md` | 23/23 |
| G13 platform-guest(+C, units) | 28 | 1774+266 | `groups/G13-platform-guest.md` | 28/28 |
| X1 봉인·권한(교차) | 21 | — | `groups/X1-sandbox-authority.md` | 21/21 |
| X2 crash·내구성·시계·자원(교차) | 패턴 7종 | — | `groups/X2-crash-durability-clock.md` | 후보 표 |

## 2. 심각도 기준과 재판정 원칙

기준은 `AUDIT-BRIEF.md`의 것이다. Critical은 현실적 조건에서 확정 사실의 의미 변경·데이터 소실·보안 경계 붕괴, High는 crash·restart·timing으로 닿는 P0 위반이나 수리 없이는 안 풀리는 정지다.
그룹 보고의 심각도는 도달 조건과 다른 층의 방어를 확인한 뒤 올리거나 내렸다(§4). 예를 들어 guest의 stream crash는 사전 용량 검사와 `Restart=on-failure`가 있어 Medium으로 내렸다. vsock 우회는 x32 조건부(Medium)였는데, io_uring 경로가 기본 커널에서 재현되어 High로 올렸다.

## 3. High·Medium 상세

### F-01 (High, confirmed) Resident seccomp의 vsock 차단이 io_uring으로 우회된다

- 출처: 직접 발견(재검증 중). 관련: G05-01(x32), X1-02(bpf 등 필터 밖 syscall)
- 코드 경로: `src/runtime/pi-spawn-plan.ts:257`(`filter: vsockSeccompFilter()`) → `src/sandbox.ts:99-102`(`--unshare-all --new-session --die-with-parent --cap-drop ALL --seccomp 3`) → `src/runtime/vsock-seccomp.ts:41-52`(nr가 socket(41)/socketpair(53)일 때만 arg0을 본다. 나머지는 모두 ALLOW)
- 원인: 이 필터는 "AF_VSOCK socket을 만들지 못한다"는 효과를 socket/socketpair **syscall 번호**로만 막는다. 같은 효과를 내는 다른 진입점이 열려 있다.
  1. io_uring `IORING_OP_SOCKET`(Linux ≥ 5.19): io_uring_setup/enter가 허용되고, 커널이 syscall을 거치지 않고 socket을 만든다.
  2. x32 ABI: arch는 `AUDIT_ARCH_X86_64` 그대로이고 nr에 `0x40000000`이 붙어 두 JEQ를 모두 빠져나간다(G05-01). 이 host는 `CONFIG_X86_X32_ABI=y`, `CONFIG_X86_X32_DISABLED=y`라 부팅 인자 `syscall.x32=y`가 있어야 열린다.
  3. `bpf(2)` 등도 필터 밖이다(X1-02).
  파일 주석(`:7-9`)의 "다른 ABI는 모든 call을 거부한다"는 x32에 대해 사실이 아니다.
- 영향: vsock은 network namespace로 봉인되지 않는다(모듈 주석 MAC-205). 봉인된 Resident의 모델이 bash로 실행한 프로그램이 host나 hypervisor의 vsock 서비스에 연결할 수 있다. 이 host에는 `vsock_loopback`, `vmw_vsock_vmci_transport`가 올라와 있다(VMware guest: CID 2는 hypervisor). 클라우드·VM 위의 Linux host에서는 hypervisor 쪽 vsock agent가 대상이다. macOS guest에서는 host가 vsock을 listen하지 않고(`main.swift:119`, MAC-201) guest bridge가 peer CID를 2로 제한하므로(`oma-vsock-bridge.c:54`) 즉시 닿는 서비스는 guest 안 CID 1 listener로 줄어든다. 그래도 문서가 약속한 경계는 깨져 있다. 기존 시험 `test/vsock-seccomp.test.ts`는 python `socket.socket()`만 시험하므로 이 경로를 보지 못한다(INV09: 검증 범위 = 보장 범위).
- 최소 반례: sandbox 안에서 `io_uring_setup(4)` → SQE `{opcode: IORING_OP_SOCKET, fd: AF_VSOCK(40), off: SOCK_STREAM}` → `io_uring_enter` → cqe.res가 fd → `connect({AF_VSOCK, cid, port})`
- 재현: `timeout 60 node review/adversarial-2026-09-28/repro/verify/uring-socket.mjs`(gcc, bwrap, python3 필요. 루프백 CID 1의 자체 listener만 쓴다). 관측:

  ```
  with filter    : socket()=EPERM io_uring=made connected:outside-service
  BYPASS: socket(AF_VSOCK) is refused, but an io_uring IORING_OP_SOCKET vsock socket reached a listener outside the sandbox
  ```

- 개선 방향:
  1. 필터에서 `io_uring_setup`/`io_uring_enter`/`io_uring_register`를 거부한다(EPERM). Docker·systemd의 기본 profile도 그렇게 한다.
  2. x86_64에서는 `nr & 0x40000000`을 먼저 검사해 거부한다.
  3. "허용 syscall 목록"(allow-list)이나, 적어도 커널 객체를 새로 만드는 syscall 계열(bpf, keyctl/add_key, perf_event_open, userfaultfd)을 거부하는 deny 목록으로 바꾸고 그 목록을 규범(SB-001)에 둔다.
  4. MV-20 시험에 io_uring·x32 진입의 negative control을 더한다.

### F-02 (High, confirmed) macOS archive 게시가 원자적이지 않고, 부분 파일이 성공으로 반환된다

- 출처: G12-01(내가 재현과 코드로 확인)
- 코드 경로: `src/platform/host/archive-crypto.ts:36-59`(`encryptArchive`: 최종 `outPath`를 `O_WRONLY|O_CREAT|O_EXCL`로 열고 chunk마다 `writeSync`. 실패해도 `finally`는 close만 하고 지우지 않는다) → `src/platform/host/service.ts:136-141`(`:139` `if (!existsSync(target)) encryptArchive(plain, target, …)` 뒤 `:141` `{ ...made, path: target }` 반환)
- 원인: 파일의 **존재**를 게시 완료의 증거로 쓴다. temp → fsync → no-replace rename → dir fsync 순서가 없다.
- 영향: 최종 경로에 부분 파일이 남는 경우는 둘이다. 암호화 중 host가 죽는 경우(SIGKILL, 전원, F-03), 그리고 crash 없이 디스크가 차서 `writeSync`가 ENOSPC를 던지는 경우다. archive는 society 전체 크기이고, 공간이 모자랄 때는 MAC-623의 자동 archive가 실제로 도는 조건이기도 하다. 그 뒤 같은 key로 재시도하면 `existsSync(target)`이 참이라 암호화를 건너뛰고, 복호화할 수 없는 파일의 경로를 성공으로 준다. unknown·부분 효과가 완료 사실로 승격된다(P0-5). 규범 `implementation/macos-platform.md:1030-1031`("host 쪽 단계…는 결과 파일의 이름을 마지막에 원자적으로 publish한다")을 어긴다. Time Machine이 담는 OMA 데이터는 archive뿐이다(MAC-623). 사용자는 백업이 있다고 믿지만 복원(R3)에서 처음 실패를 알게 된다.
- 최소 반례: `archive.create(key=K)` → 암호화 중 ENOSPC(또는 kill) → 같은 K로 재시도 → `{ path: <부분 파일> }` 성공
- 재현: `timeout 60 node review/adversarial-2026-09-28/repro/G12-platform-host/archive-publish-gap.mjs` →

  ```
  PASS partial file exists at final path
  PASS service guard SKIPS re-encryption (bug)
  PASS partial archive fails to decrypt (yet reported as success)
  ```

- 개선 방향: archivesDir 안의 temp 이름으로 암호화 → fsync(F_FULLFSYNC 고려) → `renamex_np(RENAME_EXCL)`로 no-replace publish → dir fsync. 실패하면 temp를 지운다. 이미 있는 target은 존재가 아니라 "완결 검증"(마지막 chunk의 last 플래그와 tag 검증, 또는 게시 때 적는 sidecar digest)으로만 완료로 본다. Linux 쪽 `src/storage/immutable-file.ts`의 계약을 macOS host에도 적용한다(P0-2).

### F-03 (High, confirmed) stream 수신의 `writeSync` 실패가 daemon을 죽인다: 평문 archive가 남는다

- 출처: X2-01(host), G13-01(guest). 같은 모양의 두 자리를 한 결함으로 묶는다(P0-6).
- 코드 경로:
  - host: `src/platform/host/project.ts:100-110`(`getStream`의 `take`가 `socket.on("data", take)` 안에서 `writeSync`) ← `src/platform/host/service.ts:137`(archive), `:125`(export). 진입 `src/entry/omahostd.ts`에 uncaughtException 처리가 없다(전체 entry 중 처리는 `src/entry/oma.ts:361` 하나).
  - guest: `src/platform/guest/stream.ts:102-107`(`onData` 안 `writeSync`) ← `src/entry/guesthost.ts:66-67`(`void serveStream(...)`)
- 원인: 동기 syscall이 이벤트 콜백 안에서 던진다. 그 예외는 감싼 Promise의 `reject`가 아니라 프로세스의 uncaughtException으로 간다. 그래서 `finally`(fd close, 평문 삭제)도 돌지 않는다.
- 영향:
  - host: omahostd 전체(Host API, VM supervision, egress)가 죽는다. archive 경로에서는 `service.ts:140`의 `rmSync(plain)`이 돌지 않아 **society state 전체의 평문 tar**(`~/Library/Application Support/OMA/run/transfer/<sha>.archive.tar`)가 디스크에 남는다. 이는 MAC-621("암호화하지 않은 archive를 디스크에 쓰지 않는다")의 직접 위반이다. 다음 시작 때 이 파일을 지우는 코드는 없다(`service.ts:90-91`은 mkdir만 한다). host 쪽 archive 경로에는 수신 전 여유 공간 검사가 없다.
  - guest: guesthost가 죽으면 모든 society channel, terminal attach, egress pool 연결이 끊긴다. `stream.ts:54-55`의 statfs 사전검사(1 GiB 여유)와 `oma-guesthost.service`의 `Restart=on-failure`가 있어 guest 쪽 몫은 Medium으로 본다. 같은 디스크를 쓰는 Resident들이 동시에 채우거나 EIO·EDQUOT가 나면 도달한다.
- 최소 반례: Mac 디스크가 거의 찬 상태에서 유휴 정지의 자동 archive(MAC-623) → 수신 중 ENOSPC → omahostd 종료, 평문 tar 잔존
- 재현: `timeout 60 node review/adversarial-2026-09-28/repro/verify/archive-plaintext-left.mjs`(실제 `dist/src/platform/host/project.js`의 `getStream`, writeSync에 ENOSPC 주입) →

  ```
  host process died with an uncaught ENOSPC; finally ran: false
  plain archive left: /transfer/k.archive.tar (130937 bytes, mode 600), begins "PRIVATE-CONTEXT "
  CONFIRMED: unencrypted archive bytes remain on disk after the host process died (MAC-621)
  ```

  guest는 `repro/G13-platform-guest/stream-writesync.mjs`(`UNCAUGHT EXCEPTION escaped: ENOSPC`). 메커니즘 일반형은 `repro/X2-crash-durability-clock/ondata-throw-uncaught.mjs`.
- 개선 방향:
  1. 콜백 안의 효과를 try/catch로 감싸 `reject`(guest는 `finish(error)`)로 넘긴다.
  2. 평문 staging은 시작 시 정리하는 owner를 둔다(P0-4: 만든 순간 owner에 등록). 가능하면 평문 파일 없이 수신 stream을 곧바로 암호화한다(MAC-621을 구조로 지킨다).
  3. host archive 앞에 선언 bytes + 여유분 검사를 둔다(MAC-660).
  4. 각 daemon entry의 uncaughtException 정책을 한 곳에서 정한다(기록, 정리, 종료 코드).

### F-04 (Medium, confirmed) 모델이 지울 수 있는 session 파일의 존재가 durable receipt의 정산을 좌우한다

- 출처: G01r2-01(내가 코드와 봉인 mount로 확인)
- 코드 경로: `src/storage/delivery-receipt.ts:144-164`(`sessionPathCheck`: ENOENT → `conflicting/session-absent`) → `:313-314`(conflicting → hold `BATCH_CONFLICT`) → `src/mail/batches.ts:129-150`(`settleFromReceipt`) → `src/broker.ts:465, 489-500`(`openRun` → `settlePreviousIncarnation`: hold면 throw). 봉인: `src/sandbox.ts:114`(`--bind dirs.sessions /sessions`, rw), `src/runtime/pi-spawn-plan.ts:182`(봉인일 때 bash를 빼지 않는다)
- 원인: receipt는 게시 때 session boundary가 durable하다는 것을 확인하고 쓰였다(`:353-384`). 정산 때는 그 **현재** 존재를 다시 요구한다. 과거 사실(receipt)의 의미가 나중에 바뀔 수 있는 파일, 그것도 untrusted 모델이 쓸 수 있는 파일에 매여 있다(P0-1의 "읽는 규칙이 나중의 상태에 기대어 다른 결론").
- 영향: receipt가 게시된 뒤 batch 정산 전에 session `.jsonl`이 사라지면 그 batch는 prepared로 hold된다. 사라지는 경로는 셋이다: 모델이 bash로 `rm`, 다른 agent의 메일을 통한 prompt injection, 엔진의 session 정리. 이 agent의 이후 모든 `openRun`이 throw하므로 운영자가 수리할 때까지 agent가 멈춘다. 중복 전달이나 소실은 없다(보수적). `validation.md` "알려진 한계"에는 없다.
- 최소 반례: batch 전달 → receipt 게시 → (정산 전) 모델이 `rm /sessions/<file>.jsonl` → runner 종료 → 다음 activation의 openRun이 `BATCH_CONFLICT`
- 재현: `timeout 60 node review/adversarial-2026-09-28/repro/G01-storage-fs-r2/session-gone-downgrade.mjs` → `before rotation: settle` / `after rotation: hold BATCH_CONFLICT`
- 개선 방향: receipt가 게시 때 확인한 boundary의 증거(session 파일 identity, boundary entry의 hash)를 스스로 들고, 정산은 receipt 자신의 증거만으로 판정한다. 또는 게시 때 broker 소유 위치에 boundary 사본을 남긴다. 적어도 이 결정(hold)과 수리 절차를 규범과 "알려진 한계"에 적는다.

### F-05 (Medium, confirmed) 봉인 Resident가 per-uid 커널 keyring quota를 소진한다

- 출처: X1-01
- 코드 경로: `src/sandbox.ts:99-101` → `src/runtime/vsock-seccomp.ts:41-52`(keyctl·add_key·request_key를 보지 않는다). 규범 SB-001(`implementation-spec.md:447`)의 baseline 열거에 keyring이 없다.
- 원인: 커널 keyring quota는 kuid 단위다. bwrap의 user namespace는 같은 kuid로 매핑되므로 host 사용자와 quota를 공유한다.
- 영향: 한 Resident가 host 사용자 uid의 key 200개와 20000 B를 다 쓸 수 있다. 그동안 같은 uid의 모든 프로세스(다른 Resident, host 도구)의 `add_key`가 EDQUOT로 실패한다. revoke된 key도 `gc_delay`(300 s)까지 quota를 잡는다.
- 재현: `timeout 90 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/keyring-quota.mjs` → `added=193 stopped_errno=122 (Disk quota exceeded)`. **주의:** 실행하면 이 사용자의 key quota가 약 5분 동안 가득 찬다(이번 검증에서도 그랬고, 이후 `/proc/key-users`가 4/200으로 돌아온 것을 확인했다).
- 개선 방향: seccomp에서 `add_key`/`request_key`/`keyctl`을 EPERM으로 거부한다(F-01의 목록과 함께). SB-001에 keyring을 넣는다.

### F-06 (Medium, confirmed) TUI가 bidi·zero-width 서식 문자를 걸러내지 않는다

- 출처: G11-tui-01
- 코드 경로: `src/tui/view/text.ts:39`(`displayable`: `/[\u0000-\u001f\u007f-\u009f]/g`만 제거) → `fit`/`wrap`/`pad` → `src/tui/view/screens.ts`(`frame`, `mailDetailParts`) ← 메일 subject·body(`src/tui/sources/mail.ts`)와 엔진 출력
- 원인: TUI-002는 C0/C1만 규정한다(규범 공백). U+202E(RLO), U+2066–2069(isolate), U+200B–200F가 그대로 통과한다.
- 영향: 신뢰할 수 없는 Resident 메일이나 엔진 출력이 Human 화면의 글자 순서를 시각적으로 뒤집는다. 예: 파일명·주소·"승인" 문맥의 위조. Human의 판단 표면(§8.2 판단 요청)에 닿는다. ESC·OSC·C1은 제대로 제거된다.
- 재현: `node review/adversarial-2026-09-28/repro/G11-tui/text-bidi.mjs` → `RLO_U+202E: format_survived=true … out_hex=75 73 65 72 e2 80 ae …`
- 개선 방향: Unicode `Cf`(format) 범주와 bidi 제어를 제거하거나 보이는 기호로 바꾼다. TUI-002에 이 범주를 넣는다.

### F-07 (Medium, medium) 도구 request key가 도구 호출보다 오래 남지 않는다

- 출처: G10-01(도달 조건을 내가 다시 판정)
- 코드 경로: `src/extension/shared.ts:26-29`(`requestKeyOf`: 모델이 key를 주지 않으면 매 실행 `pi-${randomUUID()}`) ← `src/extension/mail-tools.ts:323,357`, `src/extension/principal-tools.ts:75,96,118`(`execute(_id, …)`: tool call id를 쓰지 않는다)
- 원인과 방어: timeout·중단 경로는 막혀 있다. `mail-tools.ts:240-247`의 `cliFailure`가 "결과 불명확, 같은 request로 다시 호출"이라며 key를 모델에게 알린다. 남는 것은 key가 **모델에게 전달되기 전에** 엔진이나 extension 프로세스가 죽는 경우다. broker가 accept한 뒤 Principal engine이 죽으면 key는 메모리에만 있다가 사라진다. 재개된 모델은 결과를 모르고 새 key로 다시 보낸다.
- 영향: 같은 메일·agent 생성·context publish의 durable 효과가 중복된다. 모델의 선택이지만 시스템이 "증거 없음 → 새 효과"를 막을 수단을 주지 않는다(P0-5 둘째 문장).
- 재현: 추론만(엔진 crash와 재개 semantics 필요). 코드 경로는 위 줄 번호로 확인했다.
- 개선 방향: key를 (session id, toolCallId)에서 결정적으로 유도해, 같은 호출의 재실행을 멱등으로 만든다. 실행 전에 key를 agent home의 journal에 적고, 재개 때 "결과 미확인 request 목록"을 모델에게 보인다.

### F-08 (Medium, high) macOS snapshot 게시에 fsync가 없고, 남은 `.partial`을 치우지 않는다

- 출처: G12-02(+ G12-04)
- 코드 경로: `src/platform/host/snapshot.ts:26-34`(`publish`: partial fsync와 dir fsync 없이 `renameSync`. 기존 이름을 덮어쓴다), `:78-90`(`pruneSnapshots`는 `.img`만 보고 벽시계 mtime으로 정렬한다)
- 영향: 전원 차단 뒤 update rollback이 기대는 snapshot(MAC-661 "update의 own snapshot")이 없을 수 있다. crash로 남은 `.partial`은 영원히 남는다. APFS clone이라 처음에는 공간을 거의 쓰지 않지만, state.img가 바뀌면 블록이 갈라져 실제 공간을 먹는다. 정렬이 mtime이라 시계가 역행하면 새 snapshot이 먼저 지워질 수 있다.
- 재현: 추론만(APFS clonefile, 전원 차단 필요). fsync 부재는 `record.ts:60-64`와 대조해 확인했다.
- 개선 방향: `record.ts`와 같은 순서(F_FULLFSYNC 포함)로 publish하고, no-replace로 바꾼다. 시작 시 `.partial`을 치운다. 순서는 id의 단조 번호나 record의 기록으로 정한다.

### F-09 (Medium, medium) omahostd에 단일 인스턴스 lock이 없다

- 출처: G12-03
- 코드 경로: `src/entry/omahostd.ts:36-86`(run dir에 flock이나 singleton이 없다). 대조: Linux broker는 `src/runtime/process-lock.ts`, `src/entry/broker.ts`에서 lock을 잡는다.
- 영향: launchd가 아닌 경로(수동 실행, 업데이트 중 겹침)로 두 인스턴스가 뜨면, 같은 `state.img`를 쓰기 모드로 attach하고 같은 `hostapi.sock`·token을 서로 덮어쓸 수 있다. 결과는 guest 파일시스템 손상이다.
- 재현: 추론만(macOS·VZ 필요).
- 개선 방향: run dir에 `process-lock`과 같은 flock을 잡고, 잡지 못하면 시작하지 않는다(P0-4: VM의 owner는 하나).

## 4. 재판정 표 (그룹 보고 → 최종)

| 그룹 ID | 그룹 판정 | 최종 | 근거 |
|---|---|---|---|
| G05-01 x32 seccomp | Medium | F-01(High)에 합침 | 기본 커널에서 io_uring 경로가 재현됐다. x32는 이 host에서 `CONFIG_X86_X32_DISABLED=y` |
| X1-02 필터 밖 syscall | Low | F-01에 합침 | 같은 원인(deny-list 구조) |
| G12-01 | High | F-02 High | 재현. ENOSPC만으로도 도달(그룹 보고의 `service.ts:143`은 실제 `:139`) |
| X2-01 | High | F-03 High | 재현. 평문 잔존을 내가 추가로 확인 |
| G13-01 | High | F-03의 guest 몫(Medium) | statfs 사전검사(`stream.ts:54-55`)와 `Restart=on-failure` |
| G01r2-01 | Medium | F-04 Medium | 봉인 mount `/sessions` rw와 bash 존재를 확인해 도달성 high |
| G02-ledger-r2-01 무제한 목록 | Medium | Low | `pendingDeliveries`/`pendingWorkRows`는 미처리 backlog에 묶이고, agents는 P0V-44 known, usage 표는 쓰는 주체가 없다(validation "비용과 추적") |
| G03-broker-01 / r2-02 FRAME_TOO_LARGE after commit | Medium / Low | Low (known-limitation 범위 정정) | P0V-44/DR14의 경로를 넓힌 것. 실제 mutation 응답은 codec이 제한한다. 문서가 "두 필드"라 적은 것을 "commit 뒤 직렬화 전체"로 정정할 것 |
| G03-broker-r2-01 openRun incarnation burn | Medium | Low | DR9의 attempt 범위(`batches.ts:143`)가 빈 incarnation을 덮는다. 새 invocation에서 회복한다. 다만 listenActor가 계속 실패하면 `StartLimitBurst=5`로 unit이 failed에 머문다 |
| G08-01 / G09-01 깊은 중첩 | Medium / Low | Low (합침) | admission에서 frame reviver와 checkObject가 막는다(G09 재현). 안전이 이름 없는 호출자별 방어에 달린 구조(P0-6) |
| G10-01 | Medium | F-07 Medium | timeout 경로는 방어된다. 남는 것은 key 전달 전 crash |
| G12-02 / G12-04 | Medium / Low | F-08 Medium(합침) | |

## 5. Low·Info 목록

상세(코드 경로, 반례, 재현)는 각 그룹 보고서에 있다.

| ID | 심각도 | 요약 | 경로 |
|---|---|---|---|
| G01r2-02 | Low | `replaceDerivedSymlink`의 crash 잔재 temp를 어떤 경로도 회수하지 않는다 | `src/storage/staged-tree.ts:84` |
| G01-01 | Low | 같은 leaf의 후속 게시가 없으면 crash 잔재 temporary가 남아 quota에 계상된다 | `src/storage/durable-fs.ts` |
| G02-ledger-r2-01 | Low | 운영 목록 쿼리에 페이징이 없다(backlog 크기만큼 한 번에 디코딩) | `src/storage/ledger-reader.ts:65-81,142,169,205-213` |
| G02-ledger-r2-02 | Low | RequestCache 메타데이터 읽기에 바이트 상한이 없다(body와 비대칭) | `src/request-cache.ts` |
| G03-broker-01 | Low | 효과 commit 뒤 응답이 frame을 넘으면 `FRAME_TOO_LARGE`(retry never) | `src/broker/connection.ts:241-242` |
| G03-broker-r2-01 | Low | incarnation commit 뒤 listenActor 실패 → incarnation 소모, 그 invocation은 재개할 수 없다 | `src/broker.ts:459-475` |
| G03-broker-02 | Low | `git.known` 응답을 자르면서 표시가 없다 | `src/broker/public-dispatcher.ts:171-180` |
| G03-broker-03 | Low | len=0 frame이 INVALID_REQUEST로 poison된다 | `src/frame.ts` |
| G04-01 | Low | `disown()`이 principalEgress를 닫지 않는다(macOS forwarder 누수) | `src/runtime/broker-supervisor.ts` |
| G04-02 | Low | `existsSync`+`unlinkSync` TOCTOU | `src/runtime/egress-forwarder.ts` |
| G05-02 | Low | renderUnit이 ExecStart 값의 `$`를 이중화하지 않는다(상류 식별자 검증에 의존) | `src/units/render.ts` |
| G06-01 | Low | `-` 접두 인자가 CAS에서 오류가 아니라 `expected`/`third`로 관측된다 | `src/git/canonical-command.ts:33` → `src/git/observe.ts:126` |
| G07-01 | Low | `pidfdLiveness`가 pidfd가 아닌 fd를 exited로 판정한다 | `src/leaf.ts` |
| G07-02 | Low | `buildEml`이 비문자열 subject에 raw TypeError를 던진다 | `src/mail/serialize.ts` |
| G08-01/G09-01 | Low | 무제한 재귀 codec의 RangeError. 안전이 호출자별 방어에 달려 있다 | `src/domain/canonical-json.ts:16,58`, `src/domain/request-identity.ts` |
| G08-02 | Low (known) | unit 이름 파생 충돌(P0V-26/DR14와 일치) | `src/domain/derived.ts:150` |
| G10-02 | Low | grep/find는 경로 사전검사뿐이다(fd 격리 없음) | `src/extension/workspace-guard.ts:26-40` |
| G10-03 | Low | quota 사전검사가 경로 기반 TOCTOU다(효과는 fd 격리) | `src/extension/workspace-guard.ts:67-90` |
| G10-04 | Low | listen 성공 전에 provider를 등록한다 | `src/extension/inference-bridge.ts:27-42` |
| G10-05 | Low | runJournal이 종료 상태 검사 전에 truncated 결과를 반환한다 | `src/process/command.ts:38-50` |
| G11-tui-02 | Low | width 0 cluster를 표시에서 뺀다 | `src/tui/view/text.ts:57,77` |
| G12-05 | Low | attach 종료 시 마우스 추적 등 DEC 모드를 복구하지 않는다 | `src/platform/terminal-modes.ts:20-24` |
| G13-02 | Low | bundle 헤더를 4096 B만 읽는다(git verify가 뒤에서 막는다) | `src/platform/guest/project.ts` |
| G13-03 | Low | stream.get이 source를 두 번 연다(host sha256이 뒤에서 막는다) | `src/platform/guest/stream.ts` |
| G13-04 | Low | `--unit=` 재사용: 남은 unit이 재시작을 막는다 | `src/platform/guest/systemd-launcher.ts` |
| X2-02 | Low | F-03 crash 때 목적지 fd를 반납하지 않는다 | `src/platform/host/project.ts:96,121` |
| X2-03 | Low | data disk instance record를 temp+rename 없이 쓴다(첫 provisioning 중 전원 차단 → STORE_CORRUPT) | `src/platform/guest/provision.ts:100-105` |
| G01-02/G01r2-03 | Info | receipt 디렉터리 ENOENT → present(같은 UID 삭제, S-06 밖) | `src/storage/delivery-receipt.ts` |
| G01-03 | Info | fsyncTree 기본 정책이 symlink를 STORE_CORRUPT로 본다(현재 호출부 미도달) | `src/storage/durable-fs.ts` |
| G02-ledger-r2-03 | Info | 시계 소스 이원화(주입 가능 vs `Date.now()` 직접) | `src/store.ts`, `src/storage/operation-transitions.ts` |
| G03-broker-04 | Info (known) | Yama ptrace scope 0에서 Principal 경계가 무너진다 | `src/broker/process-ancestry.ts` |
| G03-broker-05 | Info | 소켓 unlink TOCTOU(lock으로 봉인됨) | `src/broker.ts` |
| G03-broker-r2-04 | Info | cgroup 판정이 4회 반복된다(P0-2 drift 위험) | `src/broker/peer-authenticator.ts` |
| G04-03 | Info | 소켓 정리가 세 방식으로 흩어져 있다 | runtime 3곳 |
| G05-03 | Info | seccomp fd3 쓰기가 두 곳에 독립 구현돼 있다(P0-2) | `src/sandbox.ts`, `src/runtime/pi-adapter.ts` |
| G05-04 | Info | foreign unit 관측을 사망 확정으로 쓴다(P0-5 경계) | `src/units.ts` |
| G06-02 | Info | CAS 인자 위생이 상위 계층에만 있다 | `src/git/*` |
| G07-03/G07-04 | Info | headerBlock 이중 경로, readBounded 선할당 | `src/mail/headers.ts`, `src/cli/effects.ts` |
| G08-03 | Info | 숫자 정규화가 명세가 아니라 런타임 일치에 기댄다 | `src/domain/canonical-json.ts` |
| G09-02 | Info | 선언된 throw 타입과 실제 throw 타입이 다르다 | `src/storage/operation-codec.ts` |
| G12-06/G12-07 | Info | GCM chunk index UInt32, byte 채널 포트 접힘 | `archive-crypto.ts`, `protocol/host-guest.ts` |

## 6. 공격했지만 막혀 있던 주요 경로

각 그룹 보고서 §5에 줄 번호 근거가 있다.

- **시계 역행:** 모든 `*_at_ms` 갱신이 `MAX(?, created_at_ms)`로 clamp되어 schema CHECK를 깨지 않는다. UPDATE·INSERT 전수를 두 감사가 독립으로 확인했고 repro가 있다. 순서는 rowid로 정한다. 기한은 단조 시계(`performance.now`)이고 `setTimeout`은 `0x7fffffff`로 clamp된다. broker 재시작 window도 단조 시계다.
- **transaction:** BEGIN IMMEDIATE와 DB_BUSY 처리, 동기 콜백 강제, 중첩 거부, DB-001 schema의 원자성, user_version fail-closed(repro)
- **operation state machine:** terminal 퇴행을 거부한다. same-key·다른 hash를 판정하고, frozen payload를 다시 해석하지 않는다. reconcile은 unknown을 failed로 승격하지 않는다.
- **게시 primitive**(Linux core): no-replace publish, openat2 `RESOLVE_BENEATH|NO_SYMLINKS`, DR13 `unobserved`(EACCES·EIO → unavailable), quota 경계, tree-lease flock
- **설정 generation(P0-3):** 여섯 durable 경계의 crash 뒤 다음 load가 성공한다. 쓰는 검증과 읽는 검증의 owner가 같다. 동시 편집은 `POLICY_CHANGED`로 막는다(repro).
- **Git:** CAS를 재관측으로 판정한다(stale=third, 멱등=candidate). quarantine(env -i, GIT_CONFIG_*, prlimit), 은퇴한 이름의 재사용 거부(P0-1)
- **메일:** CRLF·헤더 주입, From 사칭, References 위조, RFC 2047 우회, 수신자 중복을 막는다. CLI exit code가 unknown과 failed를 구분한다.
- **broker:** frame 경계값·부분 read·poison sticky, SO_PEERPIDFD pin(pid 재사용), peer-pin의 매 read 재검사, internal/public 채널 분리, accept 뒤 끊김에도 효과가 보존된다.
- **봉인:** broker socket, user bus, admin.sock은 sandbox에 보이지 않는다. TIOCSTI는 `--new-session`이 막는다. relay credential은 슬롯별로 격리되고 청크로 나뉜 secret도 tripwire가 막는다.
- **macOS:** AEAD 변조 7종 모두 거부(평문 미유출), RPC timeout·close → same-key `ENGINE_UNAVAILABLE`(P0-5), host-api의 peer uid와 `timingSafeEqual` token, record 게시 순서, git branch 정규식

## 7. 리팩터링 필요 지점

1. **효과를 막는 필터를 효과 기준 목록으로(F-01, F-05, X1-02).** 지금 필터는 "socket syscall 번호 두 개"만 본다. 막으려는 효과(vsock 연결, 커널 객체 생성)를 규범에 목록으로 두고, 필터는 그 목록에서 생성한다. 시험은 효과마다 모든 진입점(syscall, io_uring, x32)의 negative control을 둔다.
2. **macOS host의 파일 게시와 오류 경계를 core primitive로 통일(F-02, F-03, F-08, X2-03).** host·guest 플랫폼 코드는 `immutable-file`/`durable-fs`의 게시 계약과 DR13 판정을 쓰지 않고 자리마다 다시 구현했다. 같은 결정의 독립 구현이다(P0-2). 이벤트 콜백 안 동기 효과의 규칙("콜백은 던지지 않고 reject로 넘긴다")을 architecture rule(`scripts/architecture/rules`)로 검사할 수 있다.
3. **untrusted가 쓸 수 있는 경로의 판단을 목록으로(F-04).** runner·broker가 sandbox의 rw mount에서 읽고 durable 판단에 쓰는 파일을 목록으로 두고, 각각을 "게시 때 한 번 검증한 뒤 broker 소유 증거로 복사"하거나 "진단용"으로 분류한다.
4. **request key의 수명(F-07).** key는 도구 호출과 같이 태어나 결과가 모델에게 전달된 뒤에야 버려져야 한다. key journal을 두어 P0-4의 "만든 순간 owner 등록"을 key에도 적용한다.
5. **무제한 재귀 codec(G08-01/G09-01).** depth 상한을 codec 안에 두고 StoreError로 답한다. 호출자별 방어를 이름 있는 개념 하나로 합친다(P0-6).

## 8. 확인하지 못한 것

- macOS에서만 도는 부분(Swift helper, VZ, APFS clonefile, launchd, Keychain)은 코드 읽기와 추론뿐이다. F-02·F-03의 host 재현은 Linux에서 실제 TypeScript 모듈로 했다.
- systemd·kernel lane, 실제 전원 차단, 실제 provider는 규칙에 따라 실행하지 않았다(`sudo`, `systemctl` 금지).
- F-07의 도달성은 Pi 엔진의 재개 semantics(dangling tool call 처리)에 달려 있다. 엔진 코드는 따라가지 않았다.
- F-01에서 vsock으로 실제로 닿는 서비스는 배포 환경에 달려 있다. 이 host에서는 루프백 자체 listener로만 확인했다.
- 1차 wave G01·G02·G03 보고는 커버리지가 증명되지 않아 판정에서 빼고 -r2만 썼다. 1차의 발견은 -r2가 다시 판정했다.

## 9. 재현 스크립트

모두 저장소 루트에서 `timeout 60 node <경로>`로 실행한다. `dist/src`를 import하고, 임시 파일은 `/tmp/oma-adv-*` 아래에 만들어 스스로 지운다(검증 후 `/tmp`에 잔재가 없음을 확인했다). C 탐침은 실행할 때 gcc로 컴파일한다.

| 스크립트 | 확인하는 것 |
|---|---|
| `repro/verify/uring-socket.mjs` (+ `.c`) | F-01 io_uring vsock 우회와 sandbox 밖 연결 |
| `repro/G05-sandbox-units-engine/seccomp-x32.mjs` | F-01 x32 분기(BPF 디코드) |
| `repro/G12-platform-host/archive-publish-gap.mjs` | F-02 |
| `repro/verify/archive-plaintext-left.mjs` | F-03 host(daemon 종료와 평문 잔존) |
| `repro/G13-platform-guest/stream-writesync.mjs`, `repro/X2-crash-durability-clock/ondata-throw-uncaught.mjs` | F-03 guest와 일반형 |
| `repro/G01-storage-fs-r2/session-gone-downgrade.mjs` | F-04 |
| `repro/X1-sandbox-authority/keyring-quota.mjs` | F-05(실행하면 약 5분간 key quota가 찬다) |
| `repro/G11-tui/text-bidi.mjs` | F-06 |
| `repro/G03-broker-r2/openrun-postcommit.mjs` | G03-broker-r2-01 |
| 그 밖의 `repro/<그룹>/` | 각 그룹 보고서의 재현 절 |

작업 기록: `AUDIT-BRIEF.md`(감사 공통 지침), `groups.tsv`(파일 분할), `prompts/`(교차 감사 지시), `groups/`(그룹별 보고서).
