# OMA for macOS — hidden Linux VM 플랫폼 규격

상태: **ACCEPTED ([DR18](design-revisions.md), 2026-09-27: 사용자가 열린 결정의 선택을 맡겼다).** 이 문서는 [implementation-spec](implementation-spec.md)을
macOS에 적용하는 규범 문서다. [traceability](../scripts/traceability.mjs)의 `normativeSources`에 들어 있다. §12의 설계 수정과 §13의
결정은 DR18이 기록한다. MV oracle은 그 ID로 남고, [test-matrix](verification-spec.md#oma-core-v1--검증-계약)의 "macOS 플랫폼" 절이 lane과 시험에 잇는다.

[DR28](design-revisions.md)의 Personal 모드는 [MODE-006](implementation-spec.md)의 별도 host 실행이며 이 문서의 Society hidden-VM 계약과 구별한다. Mac entry의 token/VM 이전 Personal 분기는 구현됐지만, Linux에서 플랫폼을 주입한 시험은 native Mac 실행 증거가 아니다. native 빌드·Keychain·package/guest history 연결의 현재 검증 범위는 [validation](implementation/validation.md)이 소유하며 아래 기존 Society 플랫폼 판정이 Personal 지원 완료를 뜻하지 않는다.

구현: `feat/macos-hidden-vm` 브랜치. 이 문서는 그 구현과 맞춘다. 구현에서 설계가 바뀐 곳(pty attach, socket activation과 bridge,
Node `omahostd`와 Swift helper)은 본문을 그렇게 고쳤다.

### 구현 현황(2026-09-27, `feat/macos-hidden-vm`)

아래 표는 설계와 source owner를 연결하는 참조다. 작성 당시의 실행·미구현 설명을 최신 지원 판정으로 사용하지 않는다. 현재 검증과 남은 한계는 [validation](implementation/validation.md)을 따른다.

Linux에서 시험한 것(`test/platform-*.test.ts`, `test/sandbox-seccomp.test.ts`; 규칙마다 되돌리면 실패하는 변이를 확인했다):

| 영역 | 코드 | 조항 |
|---|---|---|
| host↔guest protocol, 연결, hello | `packages/protocol/src/host-guest.ts`, `packages/client/src/connection.ts`, `src/platform/rpc.ts`, `packages/domain/src/product-text.ts` | MAC-210/211/230/231/241/250 |
| guest 연결 경계 | `platform/guest/bridge/oma-vsock-bridge.c`, `platform/guest/systemd/*`, `platform/guest/sysusers.d/oma.conf`, `src/platform/guest/server.ts` | MAC-202(CID와 `SO_PEERCRED`) |
| guestctl | `src/platform/guest/control.ts`, `linux-system.ts`, `src/entry/guestctl.ts` | §4.4, MAC-320, MAC-620 |
| 첫 설치 | `src/platform/guest/provision.ts`, `src/entry/guest-provision.ts`, `oma-provision.service` | MAC-303 |
| terminal session과 guesthost | `src/platform/guest/{pty,session,host,systemd-launcher}.ts`, `src/entry/{guest-session,guesthost}.ts`, TUI의 Ctrl-L | §4.5, §4.6, MAC-220..222, MAC-412 |
| egress | `src/platform/guest/egress.ts`, `src/platform/host/egress.ts`, `InferenceRelay.detached` | MAC-225, MAC-710..712 |
| request 원장과 stream | `src/platform/guest/{requests,stream}.ts`, `src/platform/stream-source.ts`, `src/platform/stream-receive.ts` | MAC-240/241, §4.8, P0-7 등록 |
| project identity와 sync | `src/platform/guest/project.ts`, `src/platform/host/{record,bookmark,bundle,project,project-sync}.ts`, `src/platform/host/personal-seed.ts` | §6, MAC-401/403/404, MAC-411/412, MAC-420 |
| saved history 관측·모드 재개 | `packages/protocol/src/{guest-history,host-history}.ts`, `src/platform/guest/histories.ts`, `src/platform/host/{guest-histories,personal-histories,session-gateway}.ts`, `src/runtime/host-history-channel.ts` | MODE-005/006, MAC-220..222/230/250 |
| host 수명과 조립 | `src/platform/host/{guest-link,lifecycle,service,record}.ts` | MAC-301, MAC-320, MAC-330, MAC-331, MAC-601 |
| Host API와 Mac 명령 | `packages/protocol/src/host-api.ts`, `src/platform/host/{host-api,peer,attach-client}.ts`, `src/entry/oma-mac.ts` | MAC-020/021/222/251 |
| credential | `src/platform/host/{keychain,resolver}.ts`, `resolveEngineAuth`의 선택 저장소 | MAC-701/702/704 |
| image | `src/platform/host/image.ts`, `scripts/platform/sign-image.mjs` | MAC-601, MAC-611 |
| VM helper 규약(Node 쪽) | `src/platform/host/vz-driver.ts` | §2.1, §9.1, §9.3, MAC-701/702(Keychain을 helper에게 묻는 channel) |
| 백업·package/archive 전송 | `src/platform/host/{snapshot,snapshot-coordinator,archive-crypto,transfers}.ts`, `src/platform/guest/archive.ts` | REC-005, MAC-619..623, MAC-661 |
| 시계 | `principal-delivery`, `broker-supervisor`, CLI transport | MAC-650(D-7) |
| sandbox filter | `src/runtime/sandbox-seccomp.ts`, `src/sandbox.ts`의 `--seccomp 3`, `src/runtime/pi-adapter.ts`의 filter channel | MAC-205(D-5) |
| guest의 provider 길 | `src/runtime/egress-forwarder.ts`, `platform/guest/environment.d/60-oma-egress.conf`, runner의 `openRelay` | MAC-710(D-10, D-4) |
| 가져온 commit을 actor가 쓰는 길 | `src/runtime/provision.ts`의 `refreshProjectMirror`, `src/sandbox.ts`의 mirror mount | MAC-411(D-8) |
| 로그인 | `packages/tui/src/login.ts`, `oma login` | MAC-704(D-9) |
| 제품 문구 | `packages/tui/src/words.ts`, guest session의 `OMA_PRODUCT_TEXT` | MAC-022(D-1) |

**NOT_BUILT**(Mac에서만 빌드·시험한다): `platform/host/vmhelper`(Swift), `src/entry/omahostd.ts`와 `src/entry/oma-mac.ts`의 실제 실행.

아직 없는 것: OMA.app(SwiftUI), guest image build(mkosi, kernel 설정), archive 복원(R3)과 복구 모드(R1), 진단 묶음(`diag.collect`),
`society.status`, OMA.app의 로그인 메뉴(host에서 D-9의 흐름을 여는 것), mac-* lane. `platform` lane은 `npm run verify:platform`이다.

조항 ID: 요구는 `MAC-###`, 검증 oracle은 `MV-##`다. 기존 spec 조항은 그 ID로 인용한다. 이 문서는 기존 조항을 바꾸지 않는다.
바꿔야 하는 것은 §12에 모았다.

---

## 0. 요약

macOS용 OMA는 두 부분으로 나뉜다.

- **host(macOS)**: 사람이 쓰는 창과 Mac의 자원을 가진다. native UI, Terminal의 `oma` 명령, Mac 프로젝트, Keychain, VM 제어가 여기 있다.
- **guest(Linux VM)**: OMA가 Linux에 기대는 실행부를 가진다. broker, durable state, systemd, cgroup, pidfd, openat2, bubblewrap, 그리고
  society마다 도는 기존 `oma`(TUI 포함)가 여기 있다. guest는 Apple Virtualization.framework로 띄우는 hidden VM이다.
- Mac의 화면은 guest의 `oma`가 쓰는 terminal에 attach한다. tmux·ssh와 같은 모델이다. 그래서 Linux의 `oma`가 지키는 규범은
  guest에서 코드 그대로 지켜지고, host는 그 판단을 다시 만들지 않는다.

사용자는 VM이 있다는 것을 알 필요가 없다. host와 guest는 vsock 위의 비공개 RPC로만 말한다. 이 RPC는 제품 어휘만 쓰고
Linux 경로·unit 이름·errno를 보이지 않는다. durable state는 guest의 Linux disk에 있다. Mac 프로젝트는 명시적인 import/export로만
guest와 오간다. provider credential은 Keychain을 떠나지 않는다. guest의 엔진은 자리표시자만 가지고, 진짜 key는 host의 relay가
선언된 자리에 넣는다.

설계의 뼈대는 이미 있는 원칙을 경계 하나 더에 적용한 것이다.

| 기존 원칙 | macOS에서의 적용 |
|---|---|
| INF-005/INF-007: sandbox 안에는 credential이 없고, relay가 선언된 자리에만 key를 넣는다 | VM 전체를 그 sandbox처럼 다룬다. relay의 key 교체는 host에서 한다 |
| PR-001: Principal attach는 host-only channel의 credential로 인증한다 | 바뀌지 않는다. guest의 `oma`와 broker 사이의 channel 그대로다. vsock은 그 `oma`의 terminal을 나를 뿐이다 |
| REC-007: society lease를 쥔 host만 society에 행위한다 | 바뀌지 않는다. lease는 guest에서 도는 `oma`가 쥔다. Mac의 화면은 그 terminal에 attach한다(§4.6) |
| P0-5: 확인하지 않은 것을 사실로 말하지 않는다 | VM 재시작·절전·연결 끊김 뒤 결과를 모르는 요청은 같은 key로 조회한다. 다시 보내지 않는다 |
| REC-004: 전원 장애 보장은 S-06 증거가 있을 때만 말한다 | host 프로세스가 죽으면 guest에는 전원 장애다. 그래서 guest disk는 동기화 모드 `full`로 붙이고, VM kill을 S-06 증거로 쓴다 |

---

## 1. 목표와 비목표

### 1.1 목표

**MUST [MAC-001]** 사용자에게 보이는 모든 표면(native UI, TUI, 알림, 오류 문구, 설정 화면)은 VM의 존재와 Linux 구현을 드러내지
않는다. 보이지 않아야 하는 것은 이렇다: Linux 경로(`/var/lib/...`, `/run/...`), systemd unit 이름, cgroup, errno 이름, kernel·
distribution 이름, VM의 CPU·memory 수치. 예외는 둘뿐이다. 하나는 사용자가 명시적으로 만드는 진단 묶음이다(§8.6). 다른 하나는
"고급" 설정의 VM 자원 한도다(§5.2). 이 한도는 "OMA 엔진 자원"이라는 제품 어휘로 보인다.

**MUST [MAC-002]** Linux 의존 실행부는 모두 guest에서 돈다. 여기에 속하는 것: broker, runner, society마다 도는 `oma`(기존
entry 그대로: host 역할과 TUI), Principal·Resident 엔진, Store(SQLite), Git canonical repository, Maildir, systemd unit, bwrap sandbox. host는 이 가운데
어느 것도 흉내 내지 않는다. host에 Linux 호환 계층을 만들지 않는다.

**MUST [MAC-003]** durable state의 유일한 저장소는 guest의 state disk다(§5.3). host는 state를 사본으로 들고 있지 않다. 예외는 셋이다:
백업(§8.4), project sync의 전송 중 bundle(§6), host 자신의 기록(§2.3의 `host-record`).

**MUST [MAC-004]** provider credential은 Keychain에 두고 guest로 보내지 않는다(§7). 형태를 가리지 않는다: 파일, 환경 변수, RPC payload,
guest memory 어디에도 없다. guest에 있는 것은 자리표시자뿐이다.

**MUST [MAC-005]** Mac 파일 시스템은 guest에 공유되지 않는다. VirtioFS·shared directory·9p를 붙이지 않는다. Mac 프로젝트는 host가
만든 Git bundle로만 guest에 들어가고, guest가 만든 bundle로만 Mac에 돌아온다(§6).

### 1.2 비목표(v1)

- Intel Mac. §11에 조건을 적었다.
- guest의 network. guest는 MAC-203의 Virtio NAT를 통해 인터넷과 사설망에 접근한다.
- 여러 macOS 사용자가 하나의 VM을 나누는 것. VM과 state disk는 macOS 사용자마다 따로 있다.
- Mac 사이의 state 동기화, iCloud.
- 엔진(Pi)을 macOS에서 native로 돌리는 것. 엔진은 guest에서 돈다. 예외는 host의 credential 해석뿐이다(§7.3).
- App Store 배포. v1은 Developer ID와 notarization으로 배포한다(§11.3).

---

## 2. 구성 요소

### 2.1 배치

| 구성 요소 | 위치 | 언어·실행 | 소유하는 것 |
|---|---|---|---|
| **OMA.app** | host | Swift/SwiftUI, 로그인한 사용자 | native UI(창, menu bar extra, 알림)와 terminal view(§2.4). Host API의 client |
| **`oma` (Terminal)** | host | 동봉 Node, 작은 attach client | Host API로 society의 terminal에 attach한다. 화면을 그리지 않고 byte를 나른다(§2.4) |
| **OMA Host Service (`omahostd`)** | host | 동봉 Node, `SMAppService`로 등록한 LaunchAgent | VM 수명 state machine, guest와의 연결, Host API server, project 기록, 백업, image 관리. Credential Resolver와 Egress Relay를 자기 안에서 돌린다 |
| **`oma-vmhelper`** | host | Swift, `omahostd`의 자식, 서명된 binary 하나 | Virtualization.framework(VM 구성·시작·정지), vsock 연결을 `omahostd`의 unix socket으로 잇기(vfkit과 같은 방식), Keychain get/put, 절전·깨어남 알림. VM은 이 프로세스 안에서 돈다 |
| **Credential Resolver** | host | 동봉 Node + 동봉 엔진 SDK, `omahostd` 안 | 엔진 SDK로 credential을 해석하고 갱신한다(§7.3). 저장소는 `oma-vmhelper`를 거치는 Keychain backend다 |
| **Egress Relay** | host | 동봉 Node, 기존 `inference-relay` 그대로, `omahostd` 안 | guest의 provider 요청에 진짜 key를 선언된 자리에만 넣고 provider로 보낸다(§7.4) |
| **동봉 git** | host | 고정 버전 git binary(arm64) | Mac repo의 bundle 생성·검증·fetch(§6). `/usr/bin/git`(Xcode CLT shim)에 기대지 않는다 |
| **socket unit과 vsock bridge** | guest | systemd `oma-control.socket`(vsock 700)·`oma-society.socket`(vsock 701), `Accept=yes`. 연결마다 C로 된 `oma-vsock-bridge` 하나가 `oma-bridge` 사용자로 돈다 | reserved port의 bind(systemd만 한다), peer CID 검사, 서비스 unix socket으로의 relay(MAC-202) |
| **guestctl** | guest | Node, `oma-guestctl.service`, root. capability는 `CAP_SYS_TIME`·`CAP_SYS_ADMIN`·`CAP_SYS_BOOT`뿐 | control channel. 시각, freeze/thaw, disk 확장, 전원 |
| **guesthost** | guest | Node, `oma-guesthost.service`, `User=oma`, capability 없음 | society channel: society 목록·열기·멈추기, terminal attach, egress pool, project mirror, archive의 guest 쪽 |
| **society session** | guest | society마다 `oma` 사용자의 user unit 하나. 작은 session holder가 pty를 쥐고 그 위에서 기존 `oma` entry를 그대로 돌린다 | HostTenure(REC-007), 감독되는 foreground broker(D03), PrincipalSession(TUI-004), PrincipalDelivery(PR-002), TUI. Linux에서 사람이 terminal로 `oma`를 실행한 것과 같은 프로세스다 |
| broker·runner·unit·bwrap | guest | 기존 코드 그대로 | 기존 규범 그대로 |
| **egress bridge** | guest | Node, runner와 `oma` 안 | 엔진이 말하는 unix socket을 egress pool의 연결로 잇는 byte pipe. key를 모른다 |

guest 쪽 구성은 알려진 방식을 그대로 쓴다. port는 systemd socket activation으로 받는다(sshd의 `Accept=yes`와 같다). Node는 AF_VSOCK
descriptor를 socket으로 감쌀 수 없으므로(`ERR_INVALID_FD_TYPE`) vsock을 아는 부분은 bridge 하나로 모았다. terminal의 유지는
dtach·tmux의 모델이다: session holder가 pty를 쥐고, 화면은 붙었다 떨어진다.

### 2.2 기존 규범의 역할 대응

guest에서 도는 `oma`는 Linux의 `oma`와 같은 코드다. 그래서 역할 대응은 거의 없다.

| 기존 규범의 역할 | macOS |
|---|---|
| REC-007의 host(society lease 보유자) | 바뀌지 않는다. guest의 `oma`가 쥔다. lease는 guest kernel의 abstract namespace에 있다 |
| TUI-004의 "Principal session을 소유하는 TUI" | 바뀌지 않는다. guest의 `oma`가 소유한다. Mac의 화면은 그 terminal에 attach한다(§4.6) |
| PR-001의 host-only channel | 바뀌지 않는다. guest 안의 `oma`와 broker 사이의 channel이다 |
| PR-002의 "UI가 없으면 prepare하지 않는다" | 바뀌지 않는다. UI는 guest의 `oma`다. Mac의 화면이 detach해도 `oma`는 돈다. Linux에서 `oma`를 tmux 안에서 돌리고 detach한 것과 같다. detach한 뒤에도 돌게 둘지는 사용자가 정한다(§13 Q1) |
| INF-001의 "OMA 소유 agent 디렉터리" | 해석에 쓰이는 상태(credential, `models.json`, 기본 model의 `settings.json`): host 한 곳(MAC-704). credential은 그 안에서도 Keychain backend다. 엔진의 나머지 상태(session 기록 등): guest. §12 D-4 |
| D03의 product-owned foreground broker | 바뀌지 않는다. guest의 `oma`가 감독한다 |
| D05의 project binding(`canonicalProjectPath`) | 바뀌지 않는다. guest의 project mirror 경로(`/var/lib/oma/projects/<projectId>`)가 그 값이다. Mac 경로는 guest에 없다(MAC-402) |

**MUST [MAC-010]** guest 안의 모든 규범은 Linux에서와 같다. 위 표의 역할 대응 말고는 guest에 macOS 전용 예외를 두지 않는다.
guest의 OMA 코드는 Linux 배포본과 같은 source digest에서 만든다(§8.1).

### 2.3 host의 파일 배치

모두 `~/Library/Application Support/OMA/` 아래에 둔다. 디렉터리는 0700, 파일은 0600이다.

| 경로(상대) | 내용 | Time Machine |
|---|---|---|
| `host-record.json` | host 자신의 기록: installation ID, VM instance ID, state disk UUID, 마지막으로 부팅한 image 버전, 쓴 적 있는 최대 state schema, project 기록(§6.1) | 포함 |
| `vm/state.img` | guest state disk(raw sparse, APFS) | **제외**(`com.apple.metadata:com_apple_backup_excludeItem`). 살아 있는 disk를 Time Machine이 복사하면 일관되지 않다 |
| `vm/efi-vars` 등 VM 부속 | 부트 보조 | 제외 |
| `images/<version>/` | 검증된 guest image(§8.1). 현재와 직전 둘만 둔다 | 제외(app에서 다시 얻는다) |
| `snapshots/<id>.img` | state disk의 APFS clone(§8.4) | 제외 |
| `archives/<id>.omaarchive` | 암호화한 논리 백업(§8.4) | 포함 |
| `logs/` | host 로그와 guest console 로그(크기 한도, 회전) | 제외 |
| `engine/` | 해석에 쓰이는 엔진 상태: `models.json`, `settings.json`(MAC-704). credential은 여기가 아니라 Keychain에 있다 | 포함 |
| `packages/` | [DR25](design-revisions.md): `oma pi install`이 설치한 Pi 패키지(엔진 package manager의 `settings.json`, `npm/`, `git/`). credential 없음. engine에는 통째로 옮겨진다(§4.5 `packages.replace`) | 포함 |
| `run/hostapi.sock` | Host API socket | — |
| `run/vm/` | `oma-vmhelper`가 vsock 연결을 넘기는 unix socket들 | — |

**MUST [MAC-011]** host는 이 트리 밖에 쓰지 않는다. 예외는 사용자가 연결한 Mac 프로젝트의 `refs/remotes/oma/*`와 그 object뿐이다(§6.4).

### 2.4 host UI의 구조

**MUST [MAC-020]** native UI와 `oma` 명령은 같은 Host API를 쓴다. 둘 다 guest와 직접 말하지 않는다. guest와의 연결은 `omahostd`만 연다.

society의 화면은 guest의 `oma`가 그린다. host UI는 그 terminal에 attach한다.

- Terminal의 `oma` 명령: Mac terminal을 raw mode로 두고, Host API의 `terminal.attach`로 받은 연결에 입력 byte와 창 크기를 보내고
  출력 byte를 그대로 쓴다. 떠날 때(detach, 연결 끊김, `oma`의 종료) Mac terminal을 원래대로 돌린다: alternate screen을 나오고,
  bracketed paste를 끄고, cursor를 보인다. tmux client와 같은 책임이다.
- OMA.app: 창 안의 terminal view(SwiftTerm 같은 terminal emulator)가 같은 일을 한다. 그 밖의 native 화면(society 목록, menu bar의
  상태, 알림)은 Host API의 `society.list`·`society.status`로 채운다.

TUI의 관측 규칙(TUI-011·TUI-012: unknown을 0으로 바꾸지 않는다, 관측 시각을 보인다)은 guest의 TUI가 코드 그대로 지킨다. native 화면은
`society.status`의 값을 그대로 보이고, 없는 값을 채우지 않는다.

**MUST [MAC-021]** Host API server는 두 조건을 모두 만족하는 연결만 받는다. 연결 peer의 uid(`getpeereid`)가 `omahostd`와 같아야 한다.
그리고 hello에서 `run/` 아래 0600 파일의 login token을 제시해야 한다. token은 `omahostd`가 시작할 때마다 새로 만든다. 같은 사용자의
다른 프로세스가 token을 읽을 수 있다는 점은 경계가 아니다(§3.4 A4). credential의 보호는 Keychain이 맡는다(MAC-701).

**MUST [MAC-022]** guest의 `oma`가 화면에 쓰는 문구는 MAC-001을 지킨다. 지금 TUI의 오류 문구 가운데 host 경로나 errno 이름을 담는 곳은
제품 문구와 코드로 바꾸고, 원문은 guest 로그에 남긴다. 오류의 말은 `packages/tui/src/words.ts` 한 곳에서 읽는다. guest의 terminal session이
`OMA_PRODUCT_TEXT=1`을 주고 프로그램의 stderr를 자기 것(journal)으로 둔다. Linux 배포본에서는 그 말이 사람 자신의 경로와 이름이므로 그대로
보인다(D-1, DR18). 모델과 도구가 transcript에 쓰는 내용은 작업의 내용이며 이 조항 밖이다: guest의 작업공간 경로가 거기 보일 수 있다.
(v2 후보: guest의 project를 Mac의 경로와 같은 곳에 두는 것. Lima와 Docker Desktop이 home을 같은 경로로 mount하는 방식이다.)

---

## 3. 신뢰 경계와 위협 모형

### 3.1 자산

| 자산 | 있는 곳 | 보호 수단 |
|---|---|---|
| A1 provider credential(API key, OAuth token) | host Keychain, 해석하는 동안 Resolver·Relay의 memory | data protection keychain과 access group(MAC-701), guest로 보내지 않음 |
| A2 Human의 private context(Principal session, `principal/private`) | guest state disk | guest의 FS-005, PR-003·PR-004 |
| A3 project source | Mac repo, guest canonical repo | 명시적 sync(§6) |
| A4 durable society state(Store, Maildir, receipt, 설정 세대) | guest state disk | Priority 0, disk 동기화 모드 `full` |
| A5 Mac 파일 시스템 | host | 공유하지 않음(MAC-005) |
| A6 guest image의 무결성 | host `images/`, 부팅한 guest | 서명과 dm-verity(§8.1) |

### 3.2 경계

| 경계 | 이쪽 | 저쪽 | 규칙 |
|---|---|---|---|
| B1 | Human | host UI | 기존 TUI 규범(TUI-*)의 문구 규칙 |
| B2 | host UI | `omahostd` | Host API, MAC-021 |
| B3 | `omahostd` | guest | vsock RPC(§4). host가 연결을 연다. guest가 보낸 모든 값은 신뢰하지 않는 입력이다 |
| B4 | guest의 OMA 프로세스 | 모델이 움직이는 코드(Principal tool, Resident) | 기존 PR-004, SB-*, 그리고 AF_VSOCK 금지(MAC-205) |
| B5 | `omahostd`·Relay | provider | TLS 검증. 목적지는 엔진이 해석한 origin뿐이다 |
| B6 | host | image 공급자 | 서명 검증(MAC-601) |

### 3.3 guest를 얼마나 믿는가

guest는 **OMA의 durable 사실에 대해서는 신뢰한다.** 원장, 권한 판단, 전달, 통합은 guest의 broker가 정한다. 이 판단을 host가 다시 하지
않는다. 두 번 판정하면 P0-2가 깨진다.

guest는 **host의 자원과 credential에 대해서는 신뢰하지 않는다.** guest root가 탈취되면 할 수 있는 것과 할 수 없는 것은 이렇다.

| 탈취된 guest가 할 수 있는 것 | 할 수 없는 것 |
|---|---|
| host가 바인딩한 credential로 provider를 호출한다(비용이 든다). 기존 봉인 Resident의 relay와 같은 잔여 위험이다 | credential을 읽는다. key는 host의 Relay가 선언된 자리에만 넣고, 응답에 key가 섞이면 끊는다(INF-007 tripwire) |
| 자기 state를 망가뜨린다 | 다른 origin으로 key를 보낸다. 목적지는 host의 Resolver가 정한다 |
| host UI에 거짓 상태를 보이게 한다 | Mac 파일을 읽거나 쓴다. 공유된 것이 없다. export bundle은 host가 검증하고 `refs/remotes/oma/*`에만 넣는다 |
| | host에 연결을 연다. host는 vsock을 listen하지 않는다(MAC-201) |
| | host에서 명령을 실행한다. RPC에 그런 method가 없다. guest가 보낸 경로·명령은 host에서 해석하지 않는다 |

### 3.4 공격자와 대응

| 공격자 | 대응 |
|---|---|
| A1 Resident나 Principal tool 안의 모델이 만든 코드 | 기존 bwrap 경계. 여기에 seccomp로 `socket(AF_VSOCK, …)`을 막는다(MAC-205). guest는 NAT NIC를 공유한다. vsock loopback transport를 빼고 build한다(MAC-204) |
| A2 guest 안의 `oma` 사용자 프로세스(sandbox 밖의 엔진 포함) | reserved port는 systemd만 bind한다. bridge는 peer CID가 host(2)인 연결만 잇는다. guestctl·guesthost는 bridge의 uid(`oma-bridge`)에서 온 연결만 받는다(`SO_PEERCRED`). 그래서 `oma`의 프로세스는 서비스의 unix socket을 열어도 host 행세를 할 수 없다(MAC-202) |
| A3 탈취된 guest root | §3.3의 잔여 위험. host는 guest 입력을 schema·한도로 검사한다(MAC-230) |
| A4 같은 macOS 사용자의 다른 프로세스 | Host API를 부를 수 있다. 사용자가 `oma`를 실행하는 것과 같은 권한이다. Keychain item은 access group을 가진 서명된 `oma-vmhelper`만 읽는다. bundle 안의 JS를 바꿔 Resolver를 가로채는 것은 bundle 봉인과 App Management 보호가 막는다(MAC-701의 조건과 잔여 위험) |
| A5 다른 macOS 사용자 | 0700 디렉터리. VM도 사용자마다 따로다 |
| A6 provider 경로의 network 공격자 | Relay가 TLS를 검증한다(시스템 trust store). 인증서 pin은 하지 않는다(provider가 인증서를 바꾸기 때문) |
| A7 악성 update image | 서명 검증. 서명되지 않았거나 manifest와 다른 image로는 부팅하지 않는다(MAC-601) |

---

## 4. host↔guest RPC

### 4.1 transport

**MUST [MAC-201]** 연결은 항상 host가 연다. host는 어떤 vsock port도 listen하지 않는다(`VZVirtioSocketDevice.setSocketListener`를 부르지
않는다). guest에서 host로 가는 요청(provider egress)은 host가 미리 열어 둔 연결 위에서만 간다(§4.7).

**MUST [MAC-202]** guest는 reserved port(1024 미만) 두 개를 systemd socket unit으로 listen한다.

- `700` control: `oma-control.socket` → guestctl(root)
- `701` society: `oma-society.socket` → guesthost(`oma` 사용자)

bind는 systemd(pid 1)만 한다. guestctl과 guesthost는 bind capability를 갖지 않는다. 두 socket unit은 `Accept=yes`다. 연결마다 systemd가
`oma-vsock-bridge` instance 하나를 `oma-bridge` 사용자로 띄운다. bridge는 이렇게 한다.

1. 자기가 systemd가 연결을 넘긴 그 instance인지 확인한다(`LISTEN_FDS=1`, `LISTEN_PID`가 자기 pid). 아니면 끝난다.
2. `getpeername`의 `svm_cid`가 `VMADDR_CID_HOST (2)`인지 본다. 다른 CID거나 peer를 알 수 없으면 한 byte도 읽지 않고 닫는다.
3. 서비스의 unix socket에 연결하고 양쪽 byte를 그대로 잇는다. 한쪽의 close를 다른 쪽에 half-close로 넘긴다.

서비스의 unix socket은 서비스 사용자와 `oma-bridge` group의 0660이다. 서비스는 연결마다 `SO_PEERCRED`의 uid가 `oma-bridge`인지 보고,
아니면 읽지 않고 닫는다. guesthost는 `oma` 사용자로 돌기 때문에, 같은 사용자의 다른 프로세스는 그 socket 파일을 열 수 있다. 같은 uid
안에서는 파일의 mode가 경계가 아니다(FS-005). 그래서 누가 연결했는지는 커널에게 묻는다(AUTH-003과 같은 원칙). `oma-bridge`로 도는
것은 bridge instance뿐이다.

**MUST [MAC-203]** DR37에 따라 guest VM에는 Virtio NAT network device를 둔다.
`platform/guest/network/80-oma.network`를 image의 `/etc/systemd/network/`에 설치하고,
virtio_net 및 systemd-networkd/resolved와 DHCP DNS용 resolv.conf를 제공한다.
Worker와 checker는 공유 network에서 TCP·UDP·사설망에 접근한다.

**MUST [MAC-204]** guest kernel은 `CONFIG_VSOCKETS_LOOPBACK=n`으로 build한다. 이렇게 하면 guest 안의 프로세스가 guest의 listener에
vsock으로 닿을 수 없다. MAC-202의 CID 검사가 이에 대한 두 번째 방어다.

**MUST [MAC-205]** Resident sandbox(bwrap)는 seccomp filter로 `socket()`과 `socketpair()`의 domain `AF_VSOCK(40)`을 `EPERM`으로
거절한다. SB-001·DR19의 같은 filter는 io_uring, kernel keyring, bpf, perf_event_open, userfaultfd와 x32·다른 ABI 진입도 거절한다. vsock은 network namespace로 격리되지 않는 kernel이 있으므로(`--unshare-net`로는 막히지 않는다), namespace에 기대지 않는다.
filter는 bwrap의 `--seccomp 3`으로 넘긴다. 몇 개의 명령으로 된 고정 classic BPF(arch 확인, syscall 번호, 첫 인자)를 runner가 만들어
fd 3의 channel에 쓴다(`sandboxSeccompFilter`). 모든 Resident sandbox가, Linux 배포본에서도 이것을 싣는다(SB-001, D-5).

Principal에는 bwrap sandbox가 없다. Linux의 Principal은 extension이 shell tool을 거절하고 파일 tool의 경로를 workspace 안으로 좁힌다
(PR-004, `workspace-guard`). 모델이 임의의 코드를 실행할 길이 없으므로 socket을 만들 길도 없다. Principal의 엔진 프로세스와 그 extension은
신뢰하는 코드이고, §3.4의 A2에 속한다. 그리고 guest 안의 어느 프로세스든 vsock으로 닿을 곳이 없다: guest에는 loopback이 없고(MAC-204)
host는 listen하지 않는다(MAC-201). seccomp는 이 둘 위의 세 번째 방어다.

### 4.2 framing

**MUST [MAC-210]** JSON channel(control, society)의 message는 기존 OMA frame 형식을 쓴다: 4바이트 big-endian 길이 + UTF-8 JSON.
parser도 broker의 것을 그대로 쓴다. 한도는 `PLATFORM_FRAME_BYTES`(256 KiB)다. byte channel(egress, stream)은 hello 뒤 첫 message로
무엇을 싣는지 선언하고, 이어서 byte를 그대로 보낸다. stream은 `{bytes, sha256}`을 선언하고, 받는 쪽은 선언한 길이와 hash를 확인한
뒤에만 그 stream을 사실로 쓴다(기존 transport-spool과 같은 규칙). terminal channel의 frame은 §4.6에 있다.

message의 모양:

```
request   { v: 1, id: string, method: string, params: object, key?: RequestKey }
response  { v: 1, id: string, ok: true, result: object } | { v: 1, id: string, ok: false, error: Failure }
```

`Failure`는 `{ code, message, retry }`다. `code`는 기존 `ErrorCode`와 host·VM 코드 넷(§4.9)이다. 한 연결의 요청은 guest가 받은
순서대로 하나씩 처리한다.

### 4.3 연결 종류와 handshake

한 연결은 한 용도다. 연결을 연 직후 host가 `hello`를 보낸다. host는 hello의 답을 받기 전에는 아무것도 더 보내지 않는다. byte channel은
그 뒤부터 byte다.

```
hello   { v: 1, id, method: "hello", params: {
          channel: "control" | "society" | "terminal" | "egress" | "stream",
          protocol: { min: uint, max: uint },
          hostVersion: string, installationId: uuid, instanceId: uuid,
          expectImage: string,           // host가 부팅시킨 image 버전
          society?: SocietyId,           // terminal만, 그리고 terminal은 반드시
          takeover?: true } }            // terminal만(MAC-220)
hello→  { ok: true, result: { protocol: uint, guestImage: string, bootId: uuid,
          stateSchema: { written: uint, readable: uint[] }, capabilities: string[] } }
```

control은 port 700, 나머지는 모두 port 701이다. hello의 field는 정확히 이것이다. 모르는 field가 있으면 거절한다(MAC-230).

byte channel(terminal, egress, stream)에서 guest는 hello에 답한 바로 뒤에 byte를 보낼 수 있다(예: terminal의 `refused`). 그래서 host는 그
연결의 답을 frame **하나**로만 읽고, 같은 read에 뒤따라 온 byte는 channel의 것으로 넘긴다. JSON channel의 parser로 읽으면 그 byte를
frame으로 잘못 읽는다.

**MUST [MAC-211]** guest는 두 경우 모두 `hello`를 거절하고 연결을 닫는다. 하나는 `instanceId`가 state disk에 기록된 VM instance와
다를 때다(다른 사용자의 disk나 잘못 붙은 disk). 다른 하나는 host의 protocol 범위와 겹치지 않을 때다. 거절은 답을 먼저 보내고 그것이
나간 뒤에 닫는다. host는 `bootId`가 바뀌면 guest가 재부팅된 것으로 안다. 그러면 그 전 부팅에 보낸 요청 가운데 결과를 모르는 것을
모두 key로 다시 조회한다(MAC-241).

### 4.4 control channel(port 700, guestctl)

| method | params | result | 멱등 | 설명 |
|---|---|---|---|---|
| `time.set` | `{ wallMs }` | `{ steppedByMs }` | 예 | guest의 `CLOCK_REALTIME`을 host 시각으로 step한다(§9.2). 기한은 monotonic clock으로 재므로 step의 영향을 받지 않는다(MAC-650) |
| `health.get` | `{}` | `{ uptimeMs, load, memory: { totalBytes, availableBytes }, disk: { totalBytes, freeBytes }, failedUnits, frozen }` | 예 | watchdog과 UI의 "엔진 상태". `failedUnits`는 셀 수 없으면 `null`이다. 0으로 채우지 않는다 |
| `fs.freeze` | `{ deadlineMs }` | `{ frozenAt, deadlineMs }` | 아니요 | §8.4. 답의 `deadlineMs`는 실제로 건 deadline이다(MAC-620). 이미 얼어 있으면 `BATCH_CONFLICT` |
| `fs.thaw` | `{}` | `{ thawed }` | 예 | `thawed: false`는 이미 풀려 있었다는 뜻이다. deadline이 먼저 풀었을 수 있다. host가 할 일은 §8.4 |
| `disk.grow` | `{}` | `{ filesystemBytes }` | 예 | host는 VM이 멈춰 있을 때만 `state.img`를 늘리고(§9.6), 다음 부팅 뒤 이것을 부른다. guest는 `resize2fs`로 mount된 파일 시스템을 device 크기까지 늘린다. ext4의 online resize는 `CAP_SYS_RESOURCE`가 있어야 하므로 guestctl의 bounding set에 있다 |
| `power.off` | `{}` | `{ accepted }` | 예 | 얼어 있으면 먼저 풀고 `systemctl poweroff`를 한 번 요청한다. drain은 host가 먼저 끝낸다(MAC-320) |
| `diag.collect` | `{ include: string[] }` | stream | 예 | §8.6. 사용자가 요청할 때만(아직 구현 안 됨) |

guestctl이 control channel로 내보내는 거절 문구는 MAC-231을 거친다. Linux 경로·unit 이름·errno가 들어 있으면 문구 없이 code만 보낸다.

### 4.5 society channel(port 701, guesthost)

| method | params | result | 멱등 | 설명 |
|---|---|---|---|---|
| `society.list` | `{}` | `{ societies: SocietySummary[] }` | 예 | state root가 있는 society와 그 session이 떠 있는지 |
| `society.open` | `{ society, projectId }` | `{ state: "running" }` | 예 | session이 없으면 society session을 띄운다(§4.6). 있으면 그대로 답한다. mirror에 가져온 이력이 없으면 거절한다(MAC-412). 이미 있는 society는 그것이 묶인 project로만 연다(D05) |
| `society.close` | `{ society, mode: "keep-running" \| "stop" }` | `{ state }` | 예 | `stop`은 `oma`에 종료를 요청하고(SIGTERM, 기존 종료 경로) 그 session이 끝날 때까지 기다린다. 끝은 session holder가 본 `oma`의 종료다 |
| `society.status` | `{ society }` | `StatusView` | 예 | 기존 status view(관측 시각 포함)를 제품 field만 남겨 보낸다(MAC-231) |
| `project.import` | `{ key, projectId, displayName, bundle: {bytes, sha256}, branch }` | `Receipt` | key | §6.3. bundle은 따로 연 stream 연결로 온다 |
| `project.export` | `{ key, society, since?: Oid }` | stream + `{ head, bundleSha256 }` | key | §6.4 |
| `archive.create` | `{ key, society }` | stream | key | §8.4. society가 멈춰 있을 때만 |
| `archive.restore` | `{ key, into }` | `Receipt` | key | §8.5 |
| `maintenance.begin` / `maintenance.end` | `{ key }` | `{ societies }` | key | §8.4. 동안에는 `society.open`을 거절한다 |
| `request.status` | `{ key }` | `Receipt` 또는 `REQUEST_NOT_FOUND` | 예 | 결과를 모르는 요청의 조회(MAC-241) |
| `packages.replace` | `{ key, archive: {bytes, sha256}, projectId?, activate? }` | `{ added, said, ok }` | key | [DR25](design-revisions.md). Mac의 `packages/` 전체가 따로 연 stream으로 온다(§4.8). guest는 선언과 같은지 확인한 뒤 Linux와 같은 `oma pi` 코드(`guest-packages` entry)로 engine의 저장소를 새 generation으로 바꾸고 모든 project의 역할을 맞춘다. `projectId`가 있으면 그 project의 Principal·Workers에 켠다 |

DR29 saved history methods: `session.list {projectId, society, after?}`는 해당 bound Society의 paginated identity·생성/수정 시각·message count·160자 이하 이름/첫 메시지만 읽는다. `session.inspect {projectId, society, file, sessionId}`는 실제 saved birth와 private engine cwd/header를 검증하고 `{mode: "society", sessionId}`만 반환한다. `session.resume`는 같은 identity를 다시 검증한 뒤 guest 내부에서만 file 경로를 만들고 이미 열린 writer를 `ATTACH_CONFLICT`로 거절한다. Host API의 list는 host projectId에서 Society를 결정하며 inspect/resume은 opaque guest identity를 받는다. 읽기·seed/list/inspect는 이미 실행 중인 guest만 관측한다. Human의 명시적 resume만 engine 시작을 요청할 수 있다. 이 method들은 replay key나 새 durable request queue를 갖지 않는다.

mail·설정·확장은 society channel에 없다. 그것은 guest의 TUI가 terminal 안에서 한다(기존 Control Panel 그대로). 예외는 engine이 스스로 받을 수 없는 확장 패키지의 파일뿐이다: Mac이 설치한 공통 패키지는 `packages.replace`로 옮긴다. 켜고 끄는 것은 여전히 guest의 Ctrl+X Extensions에서 한다.

### 4.6 terminal channel

society의 화면과 입력은 guest의 `oma`가 쓰는 terminal을 그대로 나른다.

**session.** society session은 society마다 `oma` 사용자의 user unit 하나다. 그 안의 작은 session holder가 pseudo-terminal을 열고, 그
slave를 controlling terminal로 하는 새 session에서 기존 `oma`를 실행한다(cwd는 project mirror, §6). holder는 guesthost와 떨어진
unit이라서, guesthost가 다시 시작해도 society는 계속 돈다(dtach·abduco의 모델). guesthost는 holder의 unix socket(0600)에 연결해 attach를
중계한다. holder는 누가 attach해 있든 없든 pty 출력을 계속 읽는다. 그래서 `oma`는 화면이 없다고 막히지 않는다.

**frame.** hello 뒤 양쪽은 `uint32 BE 길이 + 1바이트 종류 + payload` frame을 보낸다(한도 64 KiB).

| 방향 | 종류 | payload |
|---|---|---|
| host→guest | `input` | 입력 byte |
| host→guest | `resize` | `cols: uint16, rows: uint16` |
| guest→host | `output` | 출력 byte |
| guest→host | `exit` | `{ code, signal, next?: "new" }`(JSON). `oma`가 끝났다. 연결은 이어서 닫힌다. protocol 3 / Host API 2의 `next`는 아래 DR28 전환이며 code 0·signal null에서만 유효하다 |
| guest→host | `detached` | `{ reason: "taken-over" }`(JSON). 다른 attach가 가져갔다 |
| guest→host | `refused` | `{ code, message }`(JSON). attach를 받지 않았다: `ATTACH_CONFLICT`(MAC-220), 또는 society가 열려 있지 않다 |
| guesthost→holder | `attach` | `{ takeover?: true }`(JSON). holder 연결의 첫 frame이자 한 번뿐이다. guesthost가 hello에서 옮긴다. 이것으로 시작하지 않는 연결은 holder가 읽지 않고 닫는다 |

**DR28 새 세션 전환 (MODE-005/006, P0-4/5).** Mac Society의 `/new`는 guest에서 Personal을 실행하지 않는다. guest `oma`는 현재 engine/history writer의 실제 종료와 자신이 시작한 broker의 반환 뒤, holder가 물려준 별도 descriptor 3에 기존 length-prefixed strict JSON `{ next: "new" }` 한 frame을 쓰고 정상 종료한다. 이 descriptor는 terminal 출력이나 model-facing channel이 아니며 원본 Pi 엔진에 전달하지 않는다. holder는 정확히 한 유효 frame·완전한 EOF와 direct child의 실제 정상 종료를 모두 관측해야 `exit.next`를 보낸다. frame만 도착했거나 child가 실패·signal로 끝났거나 private stream이 잘리거나 중복·손상되면 전환하지 않는다. private stream EOF와 terminal drain timeout은 child 종료의 증거가 아니다. host는 `next`가 있는 엄격한 정상 exit를 받은 뒤 attach 자원·raw mode를 반환하고 host `oma`를 새 세션으로 재실행하여 MODE-001 선택창을 연다. guest 경로·cwd·임의 argv/env는 전달하지 않고, host의 기존 cwd를 유지하며 stale resume 선택만 제거한다. 다른 Society를 닫거나 engine.stop을 호출하지 않는다. 이는 transient UI 요청이지 새 durable 상태·자동 재시도 queue·Host API method가 아니다. guest history↔host Personal 재개와 첫 프로젝트 확장 seed는 별도 경계다.

DR29 `/resume`: host Personal history는 `oma-host-history:` 참조(birth UUID·basename·실제 header ID)이고 guest Society history는 `oma-guest-history:` 참조(project UUID·Society·basename·실제 header ID)다. guest Human parent의 private descriptor 3은 한 owner의 duplex socket으로 host metadata를 관측한다. terminal의 guest→host `historyQuery`와 host→guest `histories`는 엄격한 request ID에 결박되며 화면 교체·취소·timeout·late reply는 다른 선택기를 채우지 않는다. host는 native Personal saved birth/header를 읽고 bounded page를 답하며 guest path/cwd/argv/env를 받지 않는다. title/first-message preview 검색은 전체 conversation 검색이 아니다.

선택된 host 이력은 outgoing writer를 종료하기 전에 관측한다. outgoing engine의 실제 exit(ordinary quit의 bounded tenure grace와 구별), owned broker 반환 뒤 한 번의 strict `{next: "resume", history: <opaque reference>}`와 private EOF를 보낸다. holder는 child의 정상 실제 종료와 terminal drain도 확인한 뒤 exit를 내보낸다. host attach cleanup 뒤 Personal birth/header/cwd를 다시 확인하고 기존 Personal writer lock을 통해 재개한다. guest Society의 다른 saved history로 옮길 때도 host에 참조를 반환한다. guest execve는 private descriptor를 보존하지 않으므로 새 holder가 새 채널을 소유한다. 실패·손상·관측 불명확은 새 birth/resume 권한이 아니다. `/new`의 기존 선택창 의미와 Linux 직접 실행의 로컬 resume은 유지된다. native macOS 실행 증거는 아직 없다.

DR28에서 이 전환은 guest protocol 3 / Host API 2로 도입됐다. DR29의 project binding·설정 관측 추가가 guest protocol을 4로 올렸고, `egress.placeholder`의 `hold` 필드(AV-15)가 5였다(MAC-250/251). `egress.connect`(DR34, UX-08)가 6을 도입했고 DR46의 현재 protocol은 **7**이다. Host API는 **3**이다. 현재 형식에서 `next` 없는 exit는 종료이며 새 전환으로 추정하지 않는다. 이전 guest protocol과의 상호 통신은 지원하지 않는다. Linux 직접 실행에는 이 holder descriptor가 없으므로 기존 execve 경로를 유지한다.

**attach.** attach는 `resize`로 시작한다. holder는 이렇게 한다.

1. pty의 창 크기를 그 값으로 둔다(`TIOCSWINSZ`). 크기가 바뀌었으면 커널이 `oma`에게 `SIGWINCH`를 준다.
2. `oma`가 켜 둔 terminal mode(alternate screen, bracketed paste, cursor 숨김)를 새 화면에 다시 보낸다. holder는 출력에서 이 mode만
   따라 둔다. 화면 내용은 흉내 내지 않는다.
3. `oma`에게 전체를 다시 그리라고 한다. 기존 TUI의 Ctrl-L이다(dtach의 redraw 방식). TUI는 Ctrl-L에 화면을 지우고 전부 다시 그린다.

**MUST [MAC-220]** attach는 society당 하나다(PR-001의 뜻을 화면에도 적용한다). 두 번째 attach는 `ATTACH_CONFLICT`로 거절한다. host UI가
명시적으로 "여기서 계속"을 고르면 hello에 `takeover: true`를 넣는다. 그러면 holder는 앞 연결에 `detached`를 보내고 닫은 뒤 새 연결을
attach한다.

**MUST [MAC-221]** 연결이 끊겨도 `oma`에는 아무 일도 없다. 그때 보낸 입력 byte가 도착했는지는 host가 알 수 없다. host는 입력을 다시
보내지 않는다. 그 입력이 prompt였다면 그 결과는 guest의 TUI가 기존 WP09 규칙으로 보인다: 쓰지 못한 prompt는 "보내지 못한 입력"으로
돌려주고, 쓰고 답을 받지 못한 prompt는 "확인하지 못했습니다(자동으로 다시 보내지 않음)"로 남긴다. 다시 attach하면 그 화면이 보인다.

**MUST [MAC-222]** host UI는 떠날 때 Mac terminal의 mode를 원래대로 돌린다(§2.4). 화면이 떠나도 `oma`의 mode 상태는 바뀌지 않는다.

prompt·설정·확장은 terminal 안의 TUI가 한다. 그래서 prompt에는 RPC가 없고 request key도 없다. MAC-240·MAC-241은 prompt에 적용되지
않는다. prompt의 disposition은 WP09가 정한다.

### 4.7 egress channel과 pool

**MUST [MAC-225]** guest 엔진의 provider 인증 경로는 host Relay를 사용한다(MAC-201). 일반 도구와 패키지는 MAC-203의 NAT network에 직접 접근한다.

- `omahostd`는 guest가 떠 있는 동안 egress 연결을 pool로 열어 둔다. 개수는 `min(2 + 4 × 진행 중인 run 수, 32)`다. 4는 기존
  relay가 run 하나에 허락하는 동시 요청 수(`concurrent: 4`)다. run은 `egress.placeholder`로 시작하고 run의 끝이나 `bootId`의 변화로
  끝난다.
- guest의 egress bridge는 엔진이 연 연결 하나를 pool의 egress 연결 하나에 잇는다. 둘은 엔진의 연결이 끝날 때까지 짝이다. keep-alive로
  같은 연결에 오는 요청 여럿과 WebSocket upgrade가 모두 그 짝 위로 간다. host는 그 연결을 기존 `InferenceRelay`의 HTTP server에 그대로
  넘긴다. keep-alive, 요청마다의 교체, upgrade tunnel, tripwire는 모두 기존 relay가 한다.
- 동시 요청의 한도는 기존 relay의 규칙 그대로다. 자리표시자(= run)마다 `concurrent: 4`의 작업 집합이고, 넘는 요청은
  거절이 아니라 FIFO로 기다린다 — 앞 요청이 끝나 자리가 나면 다음 것이 진행된다. 기다리는 요청은 provider 호출도
  자리도 갖지 않고, 클라이언트가 끊어지면 그 차례는 철회된다. 침묵 창·provider 실패·프로토콜 거절은 기존 그대로다.
- pool이 비어 있으면 egress bridge는 엔진의 연결을 기다리게 한다 — 다음에 주차되는 host 연결이 그 클라이언트의
  몫이다. 기다리는 동안 엔진이 끊어지면 클레임은 철회되고, pool 자체가 닫히면 기다리던 연결은 연결 실패로 끝난다.
- `quota`에 inference slot 필드는 없다 — 제거되었다. 동시성의 기준은 relay의 `concurrent: 4`이며, 이 판단은 guest의
  broker가 한다(MAC-713). host는 따르지 않는다.

egress 연결의 첫 message(guest→host)는 다음 셋 가운데 하나다.

```
egress.placeholder { v: 1, id, method: "egress.placeholder", params: { credentialRef, provider, model, run: { society, actor, incarnation }, inferenceSeconds } }
  → { v: 1, id, ok: true, result: { placeholderId, placeholder, provider, model } }   // 엔진을 띄우기 전, run마다 한 번. MAC-704

egress.open { v: 1, id, method: "egress.open", params: { placeholderId, society, actor, incarnation, modelProfile } }

egress.connect { v: 1, id, method: "egress.connect", params: { placeholderId, run: { society, actor, incarnation }, host, port } }
  → { v: 1, id, ok: true, result: {} }   // ok 뒤 같은 연결이 raw tunnel이 된다 (protocol 7, DR34/DR46)
```

세 message는 요청 envelope를 쓴다(§4.2). guest 안의 client(runner, `oma`)는 guesthost의 egress socket(`$XDG_RUNTIME_DIR/oma-egress.sock`)에
같은 message를 보내고, guesthost가 pool의 연결 하나에 그대로 옮긴다. host는 `egress.open`의 run(society, actor, incarnation)이 그
자리표시자를 받은 run과 같을 때만 연결한다. guest의 엔진은 INF-006의 bridge로 provider를 등록하고, 그 provider 이름과 자리표시자는 `egress.placeholder`의 답이다(D-10).
`egress.placeholder`는 protocol 7에서 명시한 `inferenceSeconds`와 현재 run identity를 필수로 보낸다.
성공한 연결은 항상 run의 열린 lease다. forwarder가 닫히면 lease도 닫히고 host는 그 끝을 run의
끝으로 읽는다. 옛 optional `hold`와 host timeout 대체 형식은 받지 않는다(DR46).
`egress.open` 뒤에는 엔진이 쓴 HTTP/1.1 byte가 그대로 흐르고, 응답 byte가 반대로 흐른다(INF-005). host의 Relay는 `placeholderId`로
그 run의 자리표시자와 credential을 찾는다. 자리표시자는 run의 lease가 끊어지거나 `bootId`가 바뀌면 버린다. host 쪽 규칙은 §7.4에 있다.

`egress.connect`(현재 protocol 7, DR37/DR46)는 run의 CONNECT tunnel 하나를 연다. guest의 runner가 세운 per-delivery CONNECT proxy가
Resident의 `HTTPS_PROXY` 요청을 받으면 이 message로 host에 다이얼을 청한다. host의 현재 네트워크 정책은 목적지·포트 제한 없이
연결하는 것이다. 사설 주소와 literal도 연결한다. `role`/`allow`는 제거한 이전 guest 선언으로, 현재 decoder가 거부한다.
사용자가 승인한 host 정책이나 검증된 role의 증거로 사용하지 않는다. host가 발급한 자리표시자와 run의
society·actor·incarnation 일치는 계속 검사한다. run이 낸 tunnel은 run과 함께 끝난다(`release`/`forgetBoot`).
provider credential은 기존 relay에서 관리한다. CONNECT 대상이나 guest의 role 선언으로 credential 목적지를 변경하지 않는다.
ok 응답 뒤의 byte는 터널의 byte다. 거절은 framed error다.

### 4.8 stream channel

bundle·archive·진단처럼 큰 byte stream은 `stream` 연결을 따로 연다. 한 연결은 stream 하나를 싣는다. 선언한 `bytes`와 `sha256`이
맞지 않으면 받는 쪽은 그 stream을 버리고 `STREAM_INVALID`로 답한다. 크기 한도는 종류마다 정한다. bundle은 `bundleBytes`(기본
256 MiB)다. archive는 host의 빈 공간에서 여유분을 뺀 값이다(§9.6).

### 4.9 오류와 결과를 모르는 요청

**MUST [MAC-230]** host는 guest가 보낸 모든 message를 신뢰하지 않는 입력으로 읽는다.

- 기존 response codec의 schema로 검사한다. 모르는 field나 한도를 넘는 값은 거절한다.
- 문자열은 제어 문자를 지운 뒤에만 보인다.
- guest가 보낸 경로는 host 파일 시스템에서 해석하지 않는다.
- guest가 보낸 URL은 열지 않는다. 링크로 보일 때는 사용자가 누를 때 확인을 받는다.

**MUST [MAC-231]** guest는 host로 보내는 값에서 Linux 구현 세부를 뺀다. unit 이름, cgroup 경로, state root 경로, errno 이름이
해당한다. 기존 status view의 `reason`처럼 이런 것을 담을 수 있는 field는 제품 어휘의 코드로 바꿔 보낸다. 예: `NO_UNIT_REASON`은
`"no-run"`이 된다. 원문은 guest 로그와 진단 묶음에만 남는다.

기존 `ErrorCode`에 더하는 host·VM 코드:

| 코드 | 뜻 | retry | 사용자 문구(예) |
|---|---|---|---|
| `ENGINE_UNAVAILABLE` | VM이 떠 있지 않거나 handshake 전이다 | same-key | "OMA 엔진을 준비하는 중입니다" |
| `ENGINE_VERSION_SKEW` | protocol 범위가 겹치지 않는다 | never | "OMA를 다시 시작해야 합니다" |
| `STATE_NEWER_THAN_APP` | state schema가 이 app의 image가 읽을 수 없는 것이다 | never | "새 버전의 OMA가 만든 데이터입니다. OMA를 업데이트하세요" |
| `HOST_STORAGE_LOW` | Mac의 빈 공간이 한도 아래다 | after-repair | "Mac의 저장 공간이 부족합니다" |

**MUST [MAC-240]** RPC로 state를 바꾸는 요청은 모두 request key를 가진다. 대상은 project import·export, archive·restore,
maintenance다. guesthost는 key마다 효과 **전에** intent를, 끝난 뒤 결과를 자기 원장(`/var/lib/oma/requests/`)에 기존 durable 쓰기
primitive로 publish한다. society의 원장(broker의 Store)에는 쓰지 않는다. 그것의 writer는 broker 하나다(REC-007). prompt·설정·확장은
RPC가 아니라 guest의 TUI가 하므로 이 조항 밖이다(§4.6).

**MUST [MAC-241]** 요청 뒤 연결이 끊겼거나 `bootId`가 바뀌어 결과를 모르면, host는 그 요청을 다시 보내지 않는다. 같은 key로
조회한다(`request.status`). 결과가 없다고 증명되면(`REQUEST_NOT_FOUND`: 그 key의 intent가 원장에 없다) 그때만 다시 보낸다. intent만
있고 결과가 없으면 guesthost가 효과를 관측해 판정할 때까지 unknown이다. 기존 CLI의 V26B 규칙과 같다.
결과를 모르는 동안 UI는 "결과를 확인하는 중"이라고 말한다. "실패"라고 말하지 않는다(P0-5).

DR42에서 request key의 멱등성 owner와 별도로 project mirror의 mutation owner를 완성했다.
Import와 session startup, bound society archive는 같은 project별 queue를 통과하며, maintenance는
진행·대기 중인 project/society 작업이 끝난 뒤에만 시작한다. maintenance 소유권이 유지되는 동안
새 import와 startup도 거절한다. same-key outcome의 역사적 의미와 canonical main writer는 유지한다.
Archive의 endpoint 부재는 stopped의 증거가 아니며 launcher의 명시적 stop/manager 관측을 요구한다.
세대별 egress recovery와 Keychain contention budget도 [DR42](design-revisions.md#dr42--native-transportproject-writeregress-복구archive-종료-증명)를 따른다.

### 4.10 protocol 버전

**MUST [MAC-250]** protocol 버전은 정수 하나다. 메시지 모양이나 뜻이 바뀌면 올린다. host는 두 버전을 모두 말한다. 하나는 자기가
동봉한 image의 protocol이다. 다른 하나는 직전 image의 protocol이다. update가 실패해 직전 image로 되돌아가 부팅할 때 필요하다(§8.3의
rollback). guest는 자기 버전 하나만 말한다. 메시지 schema의 원본은 `packages/protocol/src/host-guest.ts`(순수 codec, K1)다. host와 guest가 모두
Node이므로 양쪽은 같은 codec을 쓴다. Swift helper가 말하는 것은 VM 제어와 Keychain뿐이고 이 protocol을 말하지 않는다.

**MUST [MAC-251]** Host API(`omahostd` ↔ OMA.app·`oma` 명령)도 정수 버전 하나를 가진다. host UI는 자기 버전과 직전 버전을 말한다.
`omahostd`는 자기 버전 하나만 말한다. app을 update하면 새 UI가 아직 다시 시작하지 않은 옛 `omahostd`와 말하게 되기 때문이다(§8.3,
§9.4). 겹치지 않으면 UI는 "OMA를 다시 시작해야 합니다"와 다시 시작 버튼만 보인다. 다시 시작은 MAC-320의 정지를 거친다.

---

## 5. VM 수명

### 5.1 상태

| 상태 | 뜻 | 들어가는 조건 | 나가는 곳 |
|---|---|---|---|
| `absent` | state disk가 없다 | 첫 설치 | `provisioning` |
| `provisioning` | disk를 만들고 첫 부팅으로 초기화한다 | 사용자가 처음 society를 열 때 | `ready`, `failed` |
| `stopped` | disk가 있고 VM은 꺼져 있다 | 정상 정지 | `booting` |
| `booting` | image 검증, VM start, kernel boot | UI나 예약된 일이 엔진을 요구함 | `handshaking`, `failed` |
| `handshaking` | control·society port hello | kernel이 떴다 | `ready`, `failed` |
| `ready` | RPC 가능 | handshake 성공 | `draining`, `failed`, `crashed` |
| `draining` | society drain과 poweroff 요청 중 | 유휴 정책, 앱 종료, update | `stopped`, `forced` |
| `forced` | drain deadline을 넘겨 VM을 강제로 끔 | draining 시간 초과 | `stopped` |
| `crashed` | guest가 스스로 멈춤(panic 등) | `guestDidStop` 또는 `didStopWithError` | `booting`(backoff), `failed` |
| `failed` | 자동으로 회복하지 않음 | backoff 한도, image·disk 검증 실패 | `repair`, `booting`(사용자) |
| `repair` | 유지보수 부팅(§8.5) | 사용자가 "복구" | `stopped` |

**MUST [MAC-301]** 상태 전이는 `omahostd`의 state machine 하나가 소유한다. UI는 전이를 요청할 수만 있다. 상태는 사용자 문구로만
보인다: "준비 중", "실행 중", "멈춤", "복구 필요". VM이라는 말은 쓰지 않는다.

### 5.2 VM 구성(Virtualization.framework)

| 항목 | 값 | 이유 |
|---|---|---|
| platform | `VZGenericPlatformConfiguration`, arm64 | Apple Silicon 우선(§11) |
| boot | `VZLinuxBootLoader`(kernel, initrd, cmdline). kernel과 initrd는 서명된 image에서 온다 | 부팅 전에 검증한다(MAC-601) |
| CPU | 기본 `min(4, 물리 코어 − 2)`, 설정 2–8 | |
| memory | 기본 4 GiB, 설정 2–16 GiB. `VZVirtioTraditionalMemoryBalloonDeviceConfiguration` | 유휴 때 host에 돌려준다 |
| disk 1 | system image(erofs + verity), `readOnly: true` | |
| disk 2 | `state.img`, `VZDiskImageStorageDeviceAttachment(url:readOnly:false, cachingMode: .uncached, synchronizationMode: .full)` | guest의 flush가 F_FULLFSYNC까지 간다. MAC-302 |
| vsock | `VZVirtioSocketDeviceConfiguration` 하나 | §4 |
| entropy | `VZVirtioEntropyDeviceConfiguration` | |
| console | `VZVirtioConsoleDeviceSerialPortConfiguration` → `logs/guest-console.log`(크기 한도) | 부팅 실패 진단 |
| network | Virtio NAT, DHCP, TCP·UDP | MAC-203 |
| shared directory | 없음 | MAC-005 |

**MUST [MAC-302]** state disk는 `synchronizationMode: .full`로만 붙인다. `.fsync`나 `.none`으로 붙이지 않는다. `.fsync`는 APFS에서
drive cache를 비우지 않는다. 그러면 guest의 fsync가 전원 장애를 넘지 못하고, REC-004가 요구하는 증거가 성립하지 않는다.
macOS 버전이 이 모드를 주지 못하면 시작을 거절한다.

### 5.3 guest 파일 시스템

| 위치(guest) | 내용 |
|---|---|
| `/` | system image(erofs, 읽기 전용, dm-verity) |
| `/var/lib/oma` | state disk(ext4, `errors=remount-ro`, `data=ordered`, journal 켬) |
| `/var/lib/oma/instance.json` | VM instance ID(`kind: "oma-guest-instance-v1"`), 만든 시각, 쓴 적 있는 최대 state schema |
| `/var/lib/oma/data/oma/<society>` | society state root(기존 layout, `config.json` 포함). guest의 `oma`에게 `XDG_DATA_HOME=/var/lib/oma/data`를 주면 기존 `hostLaunchLocation`이 이 경로를 낸다 |
| `/var/lib/oma/projects/<projectId>` | project mirror(§6). guest의 `oma`가 이 디렉터리에서 돈다 |
| `/var/lib/oma/requests/` | guesthost의 request 원장(MAC-240) |
| `/var/lib/oma/home` | `oma` 사용자의 home. 엔진의 해석 상태(credential·`models.json`·기본 model)는 여기에 없다(MAC-704) |
| `/var/log/journal` | journald persistent. `SystemMaxUse=256M` |
| `/run/user/1000/oma/<society>` | run root(tmpfs, 기존 `XDG_RUNTIME_DIR/oma/<society>`) |
| `/run/oma-guestctl/`, `/run/oma-guesthost/` | 서비스의 unix socket(MAC-202) |

계정은 image의 sysusers 설정이 만든다. `oma`(uid 1000)는 state disk를 소유하고 모든 society를 돌린다. `oma-bridge`는 bridge instance만
돌린다. `oma` 사용자에게는 linger를 켠다(`loginctl enable-linger oma`). 그래야 user manager가 로그인 없이 돌고, society session과
Resident unit이 그 아래에서 돈다.

### 5.4 첫 설치

1. `omahostd`가 image를 검증한다(MAC-601). `state.img`를 sparse file로 만든다(기본 64 GiB, 실제 사용분만 차지). VM instance ID를
   만들어 `host-record.json`에 쓴다.
2. kernel cmdline에 `oma.provision=<instanceId>`를 넣어 부팅한다.

**MUST [MAC-303]** 포맷은 한 번뿐이고, 한 번도 쓰이지 않은 disk에만 한다. "ext4 signature가 없다"는 기준으로 쓰지 않는다. superblock이
손상된 disk도 signature가 없어 보이기 때문이다. 조건은 셋이 모두 참인 것이다.

- `host-record`의 VM instance가 `provisioning` 상태다(provisioning이 끝났다는 기록이 없다).
- host가 보기에 `state.img`에 할당된 block이 0이다(`st_blocks == 0`). APFS sparse file에서 이것은 파일 전체가 0이라는 뜻이다. host는
  이때만 cmdline에 `oma.provision`을 넣는다.
- guest가 보기에 device의 처음 1 MiB가 모두 0이다.

하나라도 아니면 포맷하지 않는다. `instance.json`이 없거나 ID가 다르거나 파일 시스템을 mount할 수 없으면 `failed`("데이터를 확인해야
합니다")로 멈추고 §8.5의 복구로 간다. 남의 데이터나 손상된 데이터를 지우지 않는다.
3. `instance.json`을 쓰고 flush한다. 그 뒤에야 handshake에 답한다(`instance.json`을 읽지 못하는 guest는 모든 hello를 거절한다).

### 5.5 유휴 정책

**MUST [MAC-310]** 아래 가운데 하나라도 참이면 VM은 `ready`에 머문다.

- host UI가 떠 있다. society terminal이 attach돼 있거나 OMA.app의 창이 열려 있다는 뜻이다. menu bar extra는 늘 떠 있으므로 치지 않는다.
- `keep-running`으로 닫은 society가 있고 그 society에 pending 작업이나 active Resident가 있다(status view로 관측).
- sync·백업·update가 진행 중이다.

아무것도 참이 아닌 상태가 `idleStopSeconds`(기본 600초) 이어지면 `draining`으로 간다. 관측이 unknown이면 유휴로 보지 않는다(P0-5).

**MUST [MAC-312]** 위 관측(society의 pending 작업·active Resident, guesthost의 답)이 `idleStopSeconds` 넘게 계속 unknown이면
`omahostd`는 그것을 UI에 올린다. menu bar와 창에 "엔진 상태를 확인하지 못하고 있습니다"를 보이고, "진단 내보내기"와 "다시 시작"을 준다.
VM은 그대로 둔다. unknown을 유휴로도, 멈춤으로도 바꾸지 않는다. 사용자가 "다시 시작"을 고르면 MAC-320으로 멈춘 뒤 다시 부팅한다.
unknown이 풀리면 알림도 내린다.

**SHOULD [MAC-311]** Resident가 일하는 동안에는 `IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleSystemSleep)`로 유휴 절전을
막는다. 사용자가 끌 수 있다. 덮개를 닫거나 사용자가 요청한 절전은 막지 않는다(§9.1).

### 5.6 정지

**MUST [MAC-320]** 정지 순서는 이렇다.

1. `omahostd`가 guesthost에 `maintenance.begin`을 보낸다. 그 뒤로 새 `society.open`은 거절된다.
2. 떠 있는 society마다 `society.close { mode: "stop" }`를 보낸다. guest의 `oma`가 기존 종료 경로를 탄다: Principal 엔진 종료, broker
   drain(DR16의 종료 증명 포함), Resident 정지, lease 반납. 모든 session이 끝나거나(성공이든 실패든 결과가 나오면) 기한이 지나면 3으로
   간다.
3. `omahostd`가 guestctl에 `power.off`를 보낸다. guestctl은 얼어 있으면 먼저 풀고 `systemctl poweroff`를 한 번 요청한다.
4. host는 `drainDeadlineSeconds`(기본 60초, 1–2단계 포함) 안에 `guestDidStop`을 기다린다. 넘으면 `VZVirtualMachine.stop()`으로
   끈다(`forced`).

drain을 guestctl이 아니라 host가 하는 이유: drain의 대상(society session)은 guesthost가 알고, guestctl은 root의 몇 가지 효과만 가진다.
power-off 전에 무엇이 끝났는지는 host가 society마다 답으로 받는다.

`forced`는 guest에게 전원 장애다. 다음 부팅은 fsck와 OMA의 crash 복구를 거친다. host는 이 사실을 `host-record`에 남긴다. 다음
실행 때 UI는 "지난번에 정상적으로 멈추지 못해 복구했습니다"라고 한 줄 보인다.

**MUST [MAC-321]** VM의 주인은 `omahostd`(LaunchAgent)다. 로그아웃·재시작·종료 때의 정지는 두 경로가 함께 맡는다.

- **OMA.app이 떠 있을 때**: `applicationShouldTerminate`에서 `.terminateLater`를 돌려주고 `omahostd`에 MAC-320을 요청한다. 정지가
  끝났다는 답을 받은 뒤 `replyToApplicationShouldTerminate(true)`를 한다. 로그아웃에서 app이 에이전트보다 먼저 종료 요청을 받는다면 이
  경로가 drain에 쓸 시간을 더 얻는다. 그 순서와 시간은 MV-43이 잰다.
- **`omahostd` 자신**: launchd가 보내는 SIGTERM에 MAC-320을 시작한다. launchd는 SIGTERM 뒤 `ExitTimeOut`이 지나면 SIGKILL을 보낸다.
  기본값은 시스템이 정한다(대략 20초로 알려져 있으나 확인이 필요하다). 그래서 LaunchAgent plist에 `ExitTimeOut`을 둔다(90초). 로그아웃과
  시스템 종료 때 이 값이 실제로 얼마나 지켜지는지는 MV-43이 잰다. drain 기한은 `min(drainDeadlineSeconds, 받은 시간 − 10초)`이고, 기한을
  넘기면 SIGKILL 전에 `VZVirtualMachine.stop()`으로 끈다(`forced`). SIGKILL로 VM이 같이 죽는 것보다 낫지는 않지만, host가 `forced`를
  기록할 수 있다.

로그아웃마다 `forced`가 되는지는 MV-43의 결과로 정한다. 된다면 그 사실을 문서에 적고, 로그아웃 전에 "OMA를 멈추는 중" 알림을 보인다.
결과가 어느 쪽이든 복구 경로가 불변식을 지킨다(MV-30·MV-31).

### 5.7 감시

**MUST [MAC-330]** `omahostd`는 `ready`에서 10초마다 `health.get`을 보낸다. 30초 동안 답이 없으면 VM을 hung으로 보고 `forced` 정지 뒤
`crashed`로 다룬다. 답이 늦는 것과 VM이 죽은 것은 구별한다. hung 판정 전에는 VM을 끄지 않는다.

**MUST [MAC-331]** `crashed`의 자동 재부팅은 10분에 세 번까지다. 그 뒤는 `failed`다. UI는 "복구"와 "진단 내보내기"를 준다.

---

## 6. project identity와 sync

### 6.1 project identity

**MUST [MAC-401]** project는 host가 기록한다. 기록은 `host-record.json`의 `projects[]`다.

```
ProjectRecord {
  projectId: uuid,                    // host가 만든다. guest가 아는 것은 이것뿐이다
  displayName: string,                // UI와 guest에 보이는 이름
  bookmark: base64,                   // security-scoped가 아닌 app bookmark(NSURL bookmarkData). 이동·이름 변경을 따라간다
  gitCommonDir: string,               // bind 때의 realpath. 검증에만 쓴다
  objectFormat: "sha1" | "sha256",
  rootCommits: Oid[],                 // bind 때 HEAD에서 닿는 root commit들
  society: SocietyId,
  lastImport?: { head: Oid, at: ms }, lastExport?: { head: Oid, at: ms }
}
```

**MUST [MAC-402]** guest는 Mac 경로를 받지 않는다. guest가 아는 것은 `projectId`와 `displayName`뿐이다. guest의 `oma`는 project
mirror(`/var/lib/oma/projects/<projectId>`)에서 돈다. 그래서 기존 project binding(D05)의 `canonicalProjectPath`는 그 mirror 경로가
되고, 규범은 바뀌지 않는다.

**MUST [MAC-403]** host는 import·export 전마다 bookmark를 해석한다. 그리고 그 디렉터리의 repo가 기록과 같은 project인지 확인한다.
확인하는 것은 셋이다: `objectFormat`이 같다, `rootCommits` 가운데 하나 이상이 여전히 닿는다, `git rev-parse --git-common-dir`이 존재한다.
bookmark가 해석되지 않거나 다른 repo면 "프로젝트를 찾을 수 없음"으로 멈춘다. 다른 repo에 쓰지 않는다. 사용자가 새 위치를 고르면
다시 확인한 뒤 bookmark만 바꾼다.

DR29 구현: `oma bind <society>`와 Host API `project.bind { macRepo, society }`는
host record의 기존 writer에서 binding을 게시하고 `{ projectId, displayName, society }`를
답한다. VM을 시작하지 않는다. 동일 Society의 반복 bind는 UUID를 보존하고, 다른 repo로
바꾸는 요청은 거절한다. 이동한 위치를 명시적으로 bind할 때도 위 identity 검사를 적용한다.
import/export의 기존 `macRepo` 입력은 bookmark가 해석한 위치와 일치해야 한다.
Foundation helper는 security scope·UI·mount·VM 없이 bookmark만 생성/해석하는 별도
one-shot 경로다. 이 Swift 경로의 native build/이동 검증은 아직 NOT_RUN이다.

Host API·guest의 `project.extensions { projectId }`는 저장된 Principal 확장 선택을
`{ extensions }`로 관측한다. host는 이미 ready인 guest에만 요청하고 VM이나 Society를
열지 않는다. guest는 imported mirror의 project 설정을 읽으며 설정을 만들지 않는다.
Personal 첫 선택 writer가 이 관측을 호출하고, 저장된 Personal 선택이 있으면 호출하지 않는다.
bound project의 첫 관측에 앱/engine이 없거나 읽기에 실패하면 선택을 저장하지 않고 거절한다.
이는 별도 host settings DB나 offline guest 설정 동기화를 제공하는 경로가 아니다.

**MUST [MAC-404]** host가 Mac repo에서 부르는 동봉 git은 사용자 repo의 hook·설정·transport를 믿지 않는다. GIT-001이 broker의 git에 거는
조건을 그대로 쓴다: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_REPLACE_OBJECTS=1`, 빈
hooks 디렉터리(`-c core.hooksPath=<빈 디렉터리>`), 환경의 `GIT_*`는 허용 목록 밖을 지운다. repo 자신의 `.git/config`는 읽히므로, 실행을
부르는 설정을 명령줄에서 덮는다: `core.fsmonitor=false`, `core.pager=cat`, `credential.helper=`, `protocol.allow=never`와
`protocol.file.allow=always`(bundle 파일만), `uploadpack.packObjectsHook`는 쓰지 않는 명령만 부른다. 부르는 명령은 `bundle create`,
`bundle verify`, `fetch <bundle>`, `rev-parse`, `rev-list`뿐이다. 작업 트리를 건드리는 명령(checkout, merge, status)은 부르지 않는다.

### 6.2 경계의 원칙

**MUST [MAC-410]** sync는 **commit된 Git 이력만** 옮긴다. 작업 트리, index, stash, 무시된 파일, `.git/config`, hook은 옮기지 않는다.
sync는 사용자가 누를 때만 일어난다. 백그라운드 자동 sync는 없다. host는 Mac repo의 작업 트리와 branch를 바꾸지 않는다.

### 6.3 import(Mac → guest)

import는 Mac의 commit을 guest의 **project mirror**로 옮긴다. canonical repository는 import가 바꾸지 않는다. mirror는 Linux에서 사람이
`oma`를 실행하는 project checkout에 해당한다. 아무도 그 안에서 일하지 않는다. guesthost만 쓴다.

1. 사용자가 "Mac에서 가져오기"를 누른다. 기본값은 현재 branch이고 다른 branch를 고를 수 있다.
2. host가 동봉 git으로 `git bundle create - <branch> ^<lastImport.head>`를 만든다(MAC-404). 첫 import는 전체 이력이다. bundle은 파일로
   두지 않고 stream 연결로 바로 흘린다.
3. guesthost는 stream을 staging 파일에 받는다. 선언한 길이와 hash가 맞아야 쓴다. 크기의 한도는 `bundleBytes`가 아니다. 그것은 actor가
   submit하는 bundle의 한도다(GIT-006). import의 한도는 guest disk의 빈 공간이다(D04의 admission과 같은 기준): 선언한 `bytes`를 받고도
   admission 여유가 남을 때만 받는다. Linux의 seed(`clone --bare`)에 크기 한도가 없는 것과 같은 자리다.
4. mirror가 없으면 bundle의 object format(bundle v3의 `@object-format`, 없으면 sha1)으로 빈 repository를 만든다. 그다음 기존 quarantine
   규칙과 같은 조건(object format 검사, `fsck`, prerequisite 확인, 빈 hooks, 신뢰하는 config)으로
   `git fetch <bundle> <branch>:refs/remotes/mac/<branch>`를 한다. mirror의 HEAD는 그 ref로 detach한다. mirror에서 바뀌는 것은
   `refs/remotes/mac/*`와 HEAD뿐이다.
5. 결과를 원장에 쓰고(MAC-240) 답한다. submodule은 gitlink만, LFS는 pointer만 온다. 둘 다 결과에 "옮기지 않은 것"으로 적는다. 조용히
   빠뜨리지 않는다. gitlink의 저장소 경로를 이름으로 적는다(UX-09): 같은 경로를 canonical 저장소의 integration gate이
   `UNSUPPORTED_PROFILE`로 거절하므로, 옮겨진 이력이 gitlink를 지니면 society 시작 notice가 그 거절까지 함께 알린다.
   첫 import의 snapshot은 작업 트리만 구체화하므로, 등록만 되고 체크아웃되지 않은 submodule은 mirror까지 도달하지 못하고
   `.gitmodules` 선언만으로 "submodule contents"로 보고된다; incremental bundle은 실제 객체를 옮기므로 그 경로는 이름이 붙는다
   ([DR33](design-revisions.md)).

**MUST [MAC-412]** project에 묶인 society는 **첫 import 뒤에만** 만들 수 있다. guest의 `oma`는 society를 처음 열 때 mirror의 HEAD로
canonical을 시작한다(아래 MAC-411). mirror가 비어 있을 때 열면 기존 provision은 빈 seed로 `oma: canonical root` commit을 만들고,
object format도 그때 정해진다. 그 뒤로 Mac의 이력은 그 commit의 후손이 아니므로(NOT_DESCENDANT) 어떤 경로로도 main이 될 수 없고,
다시 seed하는 것은 기존 binding 규칙(D05, V16B)이 막는다. 그래서 guesthost는 mirror에 HEAD가 없는 project의 `society.open`을
거절한다("먼저 Mac에서 가져오세요"). host UI는 project를 고른 society를 만들 때 가져오기를 먼저 하고, 그것이 끝난 뒤에 연다.

**MUST [MAC-411]** canonical에 들어가는 길은 기존 규범의 것뿐이다.

- **society를 처음 열 때**: guest의 `oma`가 mirror에서 society를 준비한다. 기존 provision이 mirror의 HEAD로 canonical `main`을 시작한다
  (GIT-003: 초기 main은 사람이 고른 commit이다. 여기서는 사람이 가져오기에서 고른 branch다). object format도 Mac repo의 것이 된다.
- **그 뒤의 import**: mirror만 새로워진다. canonical에 넣으려면 actor가 기존 경로를 탄다. `git.submit`으로 `refs/oma/published/<actor>/<operation>`에
  게시하고(GIT-006·GIT-008), `code.integrate`를 host profile로 받은 actor가 integrate한다(AUTH-001, INT-001). host나 guesthost는 actor가
  아니므로 submit·integrate하지 않는다. `refs/oma/import/*` 같은 새 ref 체계도 만들지 않는다.

지금 Linux에도 사람의 새 commit을 이미 있는 society의 canonical에 넣는 제품 경로는 없다. macOS도 v1에서는 같다. 사람이 import한 commit을
actor가 쓰는 길은 D-8로 정했다: mirror를 Resident sandbox에 `/git/project-mirror.git`으로 읽기 전용 bind한다. actor는 거기서 fetch하고
기존 `git.submit`으로 게시한다. 권한과 wire는 바뀌지 않는다. Linux에서는 `oma`가 시작할 때마다 사람의 project에서 mirror를 채운다.

### 6.4 export(guest → Mac)

1. 사용자가 "Mac으로 내보내기"를 누른다. 기본은 canonical `main`이다.
2. guest가 `git bundle create`로 `main ^<lastExport.head>`를 만들고 `project.export`의 stream으로 보낸다.
3. host가 Mac repo에서 `git bundle verify`를 돌린다. prerequisite가 Mac repo에 없으면 첫 export처럼 전체 bundle을 다시 요청한다.
4. host가 `git fetch <bundle> main:refs/remotes/oma/main`을 한다. object와 이 ref 하나만 더한다.
5. UI는 "OMA의 결과를 `oma/main`으로 가져왔습니다"라고 말한다. merge·checkout·push는 사용자가 자기 도구로 한다.

**MUST [MAC-420]** host가 Mac repo에서 바꾸는 ref는 `refs/remotes/oma/*`뿐이다. `refs/heads/*`, HEAD, index, 작업 트리는 바꾸지 않는다.
"branch에 적용" 같은 편의 기능을 더하더라도 조건은 셋이다: checkout되지 않은 branch만 대상이다, fast-forward만 한다, 사용자가 확인한다.

### 6.5 guest에 project가 없을 때

society를 만들 때 project를 고르지 않을 수 있다. 그러면 canonical repo는 기존 빈 seed(`seedSource: "empty"`, `oma: canonical root`)로
시작한다. 이 society는 나중에 Mac project를 base로 삼을 수 없다(MAC-412의 이유). UI는 만들 때 그렇게 말한다: "프로젝트 없이 시작합니다.
나중에 Mac 프로젝트를 이 작업의 기준으로 가져올 수 없습니다."

---

## 7. credential

### 7.1 원칙

**MUST [MAC-701]** provider credential은 Keychain의 generic password item으로만 저장한다. 조건은 이렇다.

- **data protection keychain만 쓴다**: 모든 호출에 `kSecUseDataProtectionKeychain = true`. 옛 파일 기반 keychain에서는
  `kSecAttrAccessible`과 access group이 효력이 없고 ACL(신뢰 app 목록)이 대신하므로, 거기에는 item을 두지 않는다.
- item: `kSecAttrService = "io.github.minjung2035.oma.provider"`, `kSecAttrAccount = <credentialRef>`,
  `kSecAttrAccessible = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, `kSecAttrSynchronizable = false`,
  `kSecAttrAccessGroup = "<TeamID>.io.github.minjung2035.oma"`.
- **누가 읽는가**: `keychain-access-groups` entitlement에 그 group을 가진 binary뿐이다. macOS에서 이 entitlement는 app에 embed한
  provisioning profile(Developer ID용)이 허가해야 효력이 있다. OMA에서 이 entitlement와 profile을 가진 binary는 `oma-vmhelper` 하나다.
  Keychain을 부르는 코드는 그 Swift binary에만 있다.
- **서명과 packaging**: `oma-vmhelper`, 동봉 `node`, `omahostd`의 launcher는 모두 app bundle 안에서 Developer ID로 서명하고 hardened
  runtime을 켠다. `omahostd`의 JS(Resolver·Relay 포함)는 `Contents/Resources` 아래에 두고 bundle 서명의 봉인에 포함한다.
  `omahostd`는 bundle 기준의 고정 경로에 있는 이 파일들만 실행한다.

**MUST [MAC-703]** Resolver와 Relay는 JS이고 진짜 key를 memory에 가진다. 그 무결성은 코드 서명의 실행 시 검사가 아니라 다음에 기댄다.
이것을 스펙에 적고, 이보다 강하게 말하지 않는다.

- bundle 봉인: 첫 실행 때 Gatekeeper가 bundle 전체(Resources 포함)의 서명을 확인한다. 그 뒤의 실행마다 JS를 다시 확인하지는 않는다.
- macOS 13 이상의 App Management 보호: 다른 app이 서명된 app bundle을 바꾸는 것을 막는다. 사용자가 그 권한을 준 프로세스는 예외다.
- 잔여 위험: 같은 macOS 사용자로 돌면서 App Management 권한이나 관리자 권한을 받은 프로세스는 Resolver를 바꿀 수 있다. 이것은 §3.4의 A4를
  넘는 공격자이며, OMA는 이를 막는다고 말하지 않는다.

item의 값은 엔진이 쓰는 credential blob이고, OMA는 그 형식을 읽지 않는다(engine-auth의 원칙). guest로 가는 경로는 없다(MAC-004).

### 7.2 엔진 SDK의 저장소

동봉 엔진 SDK의 `ModelRuntime.create`는 credential 저장소를 `credentials`(`CredentialStore`: `read`·`list`·`modify`·`delete`)로
받는다. SDK는 `AuthStorage`를 공개하지 않으므로, host는 이 공개 계약을 Keychain 위에 직접 구현한다(`keychainCredentials`). 기존
`resolveEngineAuth`는 이 저장소를 선택 인자로 받고, 받으면 agent 디렉터리의 credential 파일 대신 그것을 쓴다. 나머지(`models.json`,
`settings.json`)는 여전히 디렉터리에서 읽는다(MAC-704). Linux의 호출은 바뀌지 않는다.

- item 하나에 엔진의 credential blob 전체(agent 디렉터리의 파일과 같은 JSON)를 둔다. account는 `credentialRef`다.
- `modify`와 `delete`는 item마다 `omahostd` 안에서 직렬화한다. item을 쓰는 곳은 이 프로세스 하나다. 각 쓰기는 앞의 쓰기를 본다.
- Keychain을 읽을 수 없으면(잠김 등) 오류가 그대로 올라가 해석이 실패한다. 환경 변수 같은 다른 credential로 대신하지 않는다(MAC-702).
- Resolver는 Keychain을 직접 부르지 않는다. `omahostd`가 `oma-vmhelper`와의 channel로 `get`/`put`을 요청한다. Keychain을 만지는
  코드는 서명된 Swift binary 하나뿐이다(MAC-701).

이렇게 하면 INF-001이 지켜진다. credential 흐름(OAuth 로그인, token 갱신, 형식)은 여전히 엔진이 소유한다. 바뀌는 것은 blob이 놓이는
곳뿐이다. D-4(DR18)가 INF-001의 "agent 디렉터리" 문장을 이렇게 넓혔다.

**MUST [MAC-704]** 해석에 쓰이는 엔진 상태는 한 곳, host에 있다. 기존 `resolveEngineAuth`는 한 agent 디렉터리의 세 파일을 함께 읽는다:
`auth.json`(credential), `models.json`(provider와 model의 정의, 그리고 origin이 되는 `baseUrl`), `settings.json`(`pi/current`가 가리키는
기본 provider·model). 이 셋을 host와 guest로 나누면 두 가지가 깨진다. host는 기본 profile(`pi/current`)을 해석하지 못하고, host가 guest의
`models.json`을 읽으면 origin을 guest가 정하게 된다(§3.3). 그래서:

- host의 엔진 상태 디렉터리 `~/Library/Application Support/OMA/engine/`에 `models.json`과 `settings.json`을 둔다. `auth.json`의 자리는
  Keychain backend다(MAC-701). 이 셋이 해석의 유일한 입력이다.
- credentialRef `engine-managed`(기본 profile의 값)는 Keychain item 하나에 대응한다: `kSecAttrAccount = "engine-managed"`, 값은 엔진의
  auth 저장소 blob 전체다. 다른 credentialRef는 v1에서 `UNSUPPORTED_PROFILE`로 거절한다.
- guest는 해석에 쓰이는 파일을 갖지 않는다. `egress.placeholder`에는 society의 model profile 그대로(`provider`, `model`, 예:
  `pi/current`)를 보낸다. host가 자기 상태로 해석해 `{ placeholderId, placeholder, provider, model, model 정의 }`를 답한다. model 정의는
  엔진이 그 model과 말하는 데 필요한 것(API 종류, context 크기, 입력 종류 등)이고, `baseUrl`과 header·key는 뺀다. guest의 runner는 이것으로
  엔진을 설정하고 `baseUrl`은 egress bridge로 둔다. Linux의 runner가 relay 앞의 Resident 엔진을 설정하는 것과 같다.
- 그래서 guest가 바꿀 수 있는 것은 **어느** model을 쓸지(host가 아는 것 가운데)뿐이다. 그 model의 origin은 host의 정의가 정한다. host가
  모르는 provider·model은 거절한다.

### 7.3 로그인과 해석

- **로그인과 model 선택**: provider 로그인은 host browser에서 하고 guest는 placeholder를 통해 host Relay에 요청한다. 흐름은 엔진이 이미 가진 것을
  쓴다(README·PRODUCT: OMA는 인증·model 관리 화면을 따로 만들지 않는다). 다만 PRODUCT는 엔진을 RPC 모드로만 돌려 엔진의 대화형
  화면이 없게 하라고도 한다. 엔진의 로그인 흐름을 어느 표면으로 보일지는 Linux에서도 아직 열려 있는 문제다(PRODUCT의 첫 줄, "아직
  아닌 것"). 그래서 macOS가 따로 정하지 않고 D-9로 한 번에 정했다: `oma login`이 엔진 자신의 대화형 모드를 엔진 디렉터리 위에서 연다.
  society의 session은 계속 RPC 모드로만 돈다. macOS에서는 host가 같은 흐름을 host의 엔진 상태(MAC-704) 위에서 연다. 흐름은 그곳에 결과를 쓴다. OAuth
  browser는 Mac의 기본 browser다. guest의 엔진은 로그인하지 않는다.
- **해석**: `egress.placeholder`마다 Resolver가 `(credentialRef, provider, model)`을 host의 엔진 상태로 해석한다(MAC-704). 답은
  `{ origin, key, headers }`다(기존 `engine-auth`의 해석과 같다). 해석한 값은 그 run의 Relay가 끝날 때까지만 memory에 있다. 저장하지 않는다.
- **갱신**: token 갱신은 엔진 SDK가 해석 중에 한다. 결과는 `withLock`으로 Keychain에 돌아간다.

**MUST [MAC-702]** Keychain이 잠겼거나 item을 읽을 수 없으면 해석은 실패한다. Relay는 그 egress를 provider에 보내지 않고 연결 실패로
끝낸다. 엔진은 자기 재시도 정책을 따른다. host UI는 "자격 증명을 읽을 수 없습니다"라고 알린다. 다른 credential로 대신하지 않는다.

### 7.4 guest의 엔진이 provider에 닿는 길

```
guest 엔진(자리표시자 key) --HTTP/1.1 평문--> egress bridge(unix socket)
   --pool의 vsock 연결(oma-vmhelper가 omahostd의 unix socket으로 이음)--> omahostd 안의 Egress Relay(진짜 key를 자리에 넣음)
   --TLS--> provider origin(Resolver가 정함)
```

**MUST [MAC-710]** guest 안의 모든 엔진은 자리표시자 key와 egress bridge를 쓴다. 여기에는 Principal의 엔진도 들어간다. 지금 Linux의
Principal 엔진은 자기 agent 디렉터리의 credential을 직접 쓰지만, guest에는 credential이 없으므로 Resident와 같은 relay 경로를 탄다
(D-4). 자리표시자는 기존 `engine-auth`의 규칙으로 만든다(진짜 key와 모양이 같다). 다만 모양의 원본인 진짜 key가 host에
있으므로, 자리표시자는 host의 Resolver가 만든다. guest는 run을 시작할 때(엔진을 띄우기 전) `egress.placeholder`로 한 번 받는다(§4.7).
이 값은 진짜 key를 포함하지 않는다(서명·비밀 부분이 무작위로 바뀐다).

**MUST [MAC-711]** host의 Relay는 기존 `inference-relay`의 규칙을 그대로 가진다.

- 자리표시자는 선언된 자리(authority header의 값 전체나 `Bearer <p>`, `key` query)에서만 교체한다. 다른 곳에 있으면 거절한다.
- caller가 넣은 authority header는 버린다.
- 압축은 거절한다.
- 응답에 key가 섞이면 끊는다.
- 결과를 모르는 요청은 다시 보내지 않는다(INF-004).

**MUST [MAC-712]** Relay는 `egress.open`의 `placeholderId`가 host가 이번 `bootId`에서 발급한 자리표시자이고, 그 자리표시자의
`credentialRef`가 host에 바인딩된 credential일 때만 연결한다. 목적지는 Resolver가 해석한 origin 하나다. guest가 목적지를 정할 수 없다.
동시 요청 수는 자리표시자(run)마다 기존 relay의 작업 집합(`concurrent: 4`)이고, 넘는 요청은 503이 아니라 FIFO로
기다린다(§4.7) — 클라이언트가 끊어진 대기 요청은 철회된다. `quota`에 inference slot 필드는 없다(제거되었다).

**MUST [MAC-713]** 누가 어떤 profile을 쓸 수 있는지(`actor`, `incarnation`, `modelProfile`)는 guest의 broker가 판단한다. 판단 근거는
run lease와 spec의 model profile이다. host는 이 판단을 다시 하지 않는다. `egress.open`의 attribution은 로그와 비용 표시에만 쓴다.
탈취된 guest가 attribution을 꾸미는 것은 §3.3의 잔여 위험이다.

---

## 8. image, update, backup, repair

### 8.1 guest image

**MUST [MAC-601]** guest image는 다섯 부분이다: `kernel`, `initrd`, `system.erofs`, `system.verity`(dm-verity hash tree), `manifest.json`.
`manifest.json`에 적는 것:

- image 버전, protocol 버전, 읽을 수 있는 state schema 집합, 쓰는 state schema
- 각 파일의 sha256, verity root hash
- OMA source digest(`scripts/source-digest.mjs`의 verification input digest)와 deployment digest
- 포함한 package의 고정 버전: Debian snapshot 날짜, kernel, systemd, bubblewrap, Node와 그 toolchain(npm/npx/corepack), git, 동봉 엔진

`manifest.json`은 release key(Ed25519)로 서명한다. 공개 key는 app binary에 들어 있다. host는 부팅 전마다 다음을 확인한다: 서명,
각 파일의 sha256, manifest의 protocol이 자기가 말하는 범위 안에 있는지. verity root hash는 kernel cmdline(`roothash=`)으로 넘긴다.
root는 dm-verity 아래에서만 mount한다. 확인이 하나라도 실패하면 부팅하지 않고 직전 image로 돌아간다(§8.3).

**MUST [MAC-602]** image는 재현 가능하게 build한다(mkosi, 고정 Debian snapshot, `SOURCE_DATE_EPOCH`). 같은 입력으로 build한 image의
sha256이 같아야 한다(MV-40). guest의 OMA는 production closure(`production-manifest.json`)만 담는다. 기존 `assertDeploymentDigest`가
부팅 때 이를 확인한다.

기준 배포판은 Debian 13 arm64와 systemd 257이다. 지금 kernel·crash lane이 도는 환경과 같다. 그래서 guest가 기존 lane의 결과를 물려받을
수 있다(§10.1).

### 8.2 host가 image를 가지는 방식

image는 app bundle에 들어간다(`OMA.app/Contents/Resources/guest/<version>/`). 첫 실행과 update 뒤에 `images/<version>/`로 복사하고
검증한다. host는 현재 image와 직전 image 둘만 남긴다.

### 8.3 update

**MUST [MAC-610]** update 순서는 이렇다.

1. 새 app이 설치돼도 떠 있는 `omahostd`(옛 binary)와 VM은 그대로 돈다. VM은 `omahostd`의 자식(`oma-vmhelper`) 안에서 돌기 때문에,
   `omahostd`를 바꾸면 VM도 멈춘다(§9.3). 그래서 새 app의 UI는 옛 `omahostd`와 Host API의 직전 버전으로 말한다(MAC-251). 새 image의
   검증은 새 `omahostd`가 시작할 때 한다.
2. 유휴 정책이 VM을 멈추거나 사용자가 "지금 적용"을 누르면 update를 시작한다. 옛 `omahostd`가 MAC-320으로 VM을 멈추고 끝난다. launchd가
   새 binary의 `omahostd`를 띄운다. 진행 중인 작업을 끊지 않는다(정지는 drain을 거친다).
3. 새 `omahostd`는 부팅 전에 **update 전 snapshot**을 만든다: `state.img`의 APFS clone(`clonefile`). VM이 멈춰 있으므로 quiescent다.
4. 새 image로 부팅한다. guest는 broker를 띄우기 전에 state migration을 한다. migration은 앞으로만 간다. 기존 Store의
   `SCHEMA_USER_VERSION_READABLE` 규칙대로, 모르는 버전은 열지 않는다.
5. handshake와 health가 성공하면 update는 끝난다. 실패하면 **rollback**한다: 부분적으로 migration한 disk를 쓰지 않는다. `state.img`를
   3의 snapshot으로 되돌리고 직전 image로 부팅한다. 이때 새 `omahostd`는 직전 image의 protocol로 말한다(MAC-250). UI는 "업데이트를 적용하지 못해 이전 상태로 돌렸습니다"와 진단 내보내기를 준다.
6. update 전 snapshot은 새 image로 세 번 정상 부팅하거나 7일이 지날 때까지 남긴다.

**MUST [MAC-611]** host는 state를 옛 image로 내리지 않는다. `host-record`의 "쓴 적 있는 최대 state schema"가 부팅하려는 image의 읽을 수
있는 집합에 없으면, 그 image로 부팅하지 않는다(`STATE_NEWER_THAN_APP`). 사용자가 옛 app을 설치한 경우도 같다. 이때 UI가 주는 선택은
"OMA 업데이트"와 "그 이전의 백업으로 복원" 둘이다.

### 8.4 백업

두 종류를 둔다. 둘 다 REC-005의 quiescent 조건을 지킨다: 백업하는 society에서는 mutation 접수와 inference dispatch가 멈춰 있고, active
cgroup이 끝났음이 확인돼 있으며, DB·Maildir·Git·context·staging·receipt·session·설정이 같은 시점의 것이다. 이 조건은 새로 만드는 것이
아니라 기존 society 정지(`society.close { mode: "stop" }`)가 이미 주는 것이다: Principal 엔진 종료, broker drain(DR16의 종료 증명),
Resident 정지. broker가 멈춰 있으므로 DB를 쓰는 프로세스가 없다.

**MUST [MAC-619]** 백업은 broker 밖에서 DB를 열지 않는다. checkpoint(`wal_checkpoint`)도, `VACUUM INTO`도 하지 않는다. DB의 writer는
broker 하나다(REC-007). WAL 파일이 남아 있어도 같은 시점의 파일로 함께 복사되므로 사본은 그대로 열린다. WAL을 합치는 것은 그 사본을
다음에 여는 broker가 한다.

**snapshot(로컬·빠름·같은 Mac 전용)**

- **자동 snapshot**은 VM이 멈춰 있을 때만 만든다: 유휴 정지 뒤, update 전(§8.3), 사용자가 요청했는데 VM이 멈춰 있을 때. `state.img`의
  `clonefile`이다. freeze가 필요 없다.
- **떠 있는 VM의 snapshot**(사용자 요청)은 이렇게 한다.
  1. `maintenance.begin`: 새 `society.open`을 막는다.
  2. 떠 있는 society를 모두 `stop`으로 닫는다. 하나라도 결과가 unknown이면 snapshot을 만들지 않고 멈춘다.
  3. `fs.freeze`로 `/var/lib/oma`를 얼린다. 답의 `deadlineMs`가 실제 deadline이다.
  4. host가 `clonefile(state.img, snapshots/<id>.partial)`을 한다. APFS copy-on-write라 곧 끝난다.
  5. `fs.thaw`. 답이 `thawed: true`일 때만 `<id>.partial`을 `<id>.img`로 publish한다.
  6. `maintenance.end`. 사용자가 계속 돌게 두었던 society를 다시 연다.

**MUST [MAC-620]** freeze가 thaw 없이 남는 일은 없어야 한다. guestctl은 freeze마다 deadline timer를 건다. host의 연결이 끊겨도 deadline에
thaw한다. deadline은 host가 요청한 값과, guest의 society 설정에 실제로 있는 가장 짧은 `limits.receiptWaitSeconds`에서 여유(500 ms)를 뺀
값 가운데 작은 것이다. society가 없으면 10초다. 어느 society의 설정을 읽을 수 없으면 그 한도를 모르는 것이므로 freeze하지 않는다(P0-5).
위의 절차에서는 broker가 멈춰 있어 기다리는 receipt가 없지만, 이 한도는 절차가 깨졌을 때의 방어로 남긴다.
deadline timer는 guestctl 프로세스 안에 있으므로 guestctl이 죽으면 함께 사라진다. 그래서 guestctl보다 오래 사는 것이 thaw한다.
unit의 `ExecStopPost`가 멈춤마다(crash·SIGKILL 포함) `guestctl --thaw`를 돌리고, 시작할 때마다 앞의 것이 남긴 freeze를 풀며,
guestctl은 자기가 보는 모든 끝(exit, 종료 신호)에서 제 freeze를 푼다(P0V-82).

**MUST [MAC-622]** `fs.thaw`가 `thawed: false`로 답하면(deadline이 먼저 풀었다) clone이 언 동안에 끝났다는 보장이 없다. host는
`<id>.partial`을 지우고 snapshot을 만들지 않은 것으로 끝낸다. UI는 "백업을 만들지 못했습니다. 다시 시도하세요"라고 말한다. 일관성을 모르는
사본을 snapshot으로 남기지 않는다. `fs.thaw`의 답을 받지 못해도(연결 끊김) 같다.

보존: 최근 3개와 update 전 snapshot. 개수보다 공간이 먼저다(MAC-661).

**archive(논리·이식 가능·Time Machine용)**

society 하나를 멈춘 상태에서 만든다. 절차는 떠 있는 VM의 snapshot 1–2와 같고, 그 society만 멈춘다.

- guesthost가 그 society의 state root를 tar로 stream한다. DB와 WAL 파일, Maildir, archive, receipt, session 기록, 설정 세대, world
  context, canonical·context repository(state root 안에 있다)가 모두 같은 시점의 파일이다. `run/`과 cache는 뺀다.
- 각 항목의 sha256을 담은 manifest를 끝에 붙인다.
- 만드는 동안 그 society의 `society.open`은 거절된다. 끝나면 사용자가 연다.

host는 이 stream을 AES-256-GCM(64 KiB chunk마다 nonce와 tag)으로 암호화해 `archives/<id>.omaarchive`로 쓴다. key는 Keychain의
`io.github.minjung2035.oma.archive` item이고 이 기기에만 있다. 이 key를 잃으면 archive를 열 수 없다. 그래서 첫 archive 때 UI는 복구 key를 보이고
사용자가 저장했는지 확인한다(§13 결정 Q3).

**MUST [MAC-621]** archive는 Human의 private context(A2)를 담는다. 암호화하지 않은 archive를 디스크에 쓰지 않는다.

**MUST [MAC-623]** archive는 사용자가 만들지 않아도 생긴다. Time Machine이 담는 OMA의 데이터는 archive뿐이기 때문이다(`state.img`는
제외한다). 유휴 정지(MAC-310) 때 society는 이미 모두 멈춰 있으므로, 그 society의 마지막 archive가 7일보다 오래됐으면 `power.off` 전에
archive를 만든다. 공간이 첫 한도 아래면 만들지 않고 알린다(MAC-660). society마다 최근 4개를 남긴다. UI는 society마다 마지막 archive의
시각을 보인다. 사용자는 주기를 바꾸거나 끌 수 있다.

### 8.5 복구(repair)와 복원(restore)

| 단계 | 언제 | 하는 일 | 데이터를 지우는가 |
|---|---|---|---|
| R0 자동 | 모든 부팅 | systemd-fsck(`-p`, preen), OMA startup 복구(quiescence, DR10 수집, 원장 대조) | 아니요 |
| R1 복구 모드 | `failed`에서 사용자가 "복구" | cmdline `oma.mode=maintenance`로 부팅한다. broker는 띄우지 않는다. `e2fsck -n`으로 보고한다. society마다 기존 무결성 진단을 돌린다. 보고서를 UI에 보인다 | 아니요 |
| R1' 파일 시스템 고치기 | R1 보고서가 필요하다고 할 때 사용자가 확인 | 먼저 snapshot을 만들고 `e2fsck -fy`를 한다 | 파일 시스템이 판단한 만큼. 앞의 snapshot으로 되돌릴 수 있다 |
| R2 snapshot 복원 | 사용자 | VM 정지, 현재 `state.img`를 `snapshots/pre-restore-<ts>.img`로 옮김, 고른 snapshot의 clone으로 교체, 부팅 | 아니요(현재 상태를 보관) |
| R3 archive 복원 | 사용자, 다른 Mac 포함 | 새 society root에 archive를 풀고 digest를 확인한다. 무결성 진단을 통과해야 society를 연다 | 아니요(새 root) |
| R4 내보내고 초기화 | 사용자가 명시적으로 | 읽을 수 있는 Maildir·session·repo를 archive로 내보낸 뒤 society를 지운다 | 예. 두 번 확인한다 |

**MUST [MAC-630]** 어떤 복구도 사용자의 확인 없이 데이터를 지우지 않는다. 자동 경로(R0)는 파일 시스템의 preen과 OMA의 기존 복구만
한다.

### 8.6 진단 묶음

사용자가 "진단 내보내기"를 누르면 host가 만든다. 담는 것: host 로그, guest console 로그, `diag.collect`의 결과(journal, unit 상태, 무결성
진단 보고, image manifest), `host-record`에서 경로를 가린 사본.

**MUST [MAC-641]** 진단 묶음은 사용자가 저장하는 파일로만 만든다. OMA는 그것을 어디에도 자동으로 보내지 않는다. 받는 곳(지원 창구)은
이 저장소의 GitHub issue다(§13 Q7). UI는 그 창구를 안내만 한다. 앱 안의 진단 화면은 journal 뷰어가 아니다. 제품 어휘의 상태 요약만 보인다:
엔진 상태, 마지막 정지가 정상이었는지, 마지막 health 시각, Mac과 엔진의 저장 공간, image 버전, 최근 자동 재시작 횟수. Linux 세부는 묶음
안에만 있다(MAC-640).

**MUST [MAC-640]** 진단 묶음에는 다음이 들어가지 않는다: credential, Keychain item, mail 본문, session 기록 내용, project source. 넣기 전에
사용자에게 무엇이 들어가는지 보인다. Linux 세부가 보이는 곳은 이 묶음뿐이다(MAC-001의 예외).

---

## 9. 장애와 복구

### 9.1 절전과 깨어남

- macOS가 잠들면 VM의 vCPU도 멈춘다. guest의 monotonic clock은 멈춘 동안 흐르지 않는다. wall clock은 뒤처진다.
- `NSWorkspace.didWakeNotification`을 받으면 host는 `time.set`을 보낸다(§9.2). 그다음 `health.get`으로 살아 있는지 본다.
- 잠든 동안 provider와의 연결은 대개 끊긴다. Relay는 그 요청을 연결 실패로 끝낸다. 엔진은 자기 정책대로 재시도한다(INF-001).
  결과를 모르는 요청을 Relay가 다시 보내지 않는다(INF-004).
- 절전 중에 막 update·snapshot을 하던 중이었다면, 깨어난 뒤 해당 단계를 처음부터 다시 판정한다. freeze는 MAC-620의 deadline이 지킨다.

**MUST [MAC-650]** guest 코드가 경과 시간을 잴 때는 monotonic clock을 쓴다. 기한(idle, turn, receipt wait, retry backoff)을 wall clock
차로 재지 않는다. 깨어난 뒤 wall clock이 몇 시간 앞으로 뛰면, wall clock으로 잰 기한은 한꺼번에 만료된다. 뒤로 가면 기한이 오지 않는다.
`Date.now()`의 차로 경과 시간을 재던 곳은 셋이었고, 모두 고쳤다(D-7).

- `runtime/principal-delivery.ts`: accept 기한과 실패 뒤 재시도 간격.
- `runtime/broker-supervisor.ts`: broker 재시작 한도의 창. 시계가 뒤로 가면 오래된 재시작 기록이 창에서 빠지지 않아, broker를 포기할 까닭이
  없는데 포기한다.
- `cli/transport.ts`: Principal credential을 기다리는 기한. 시계가 앞으로 뛰면 곧바로 `AUTH_FAILED`가 된다.

`Date.now()`의 나머지 쓰임(Store·operation의 시각, mail의 Date, 관측 시각)은 경과 시간이 아니라 기록하는 사건 시각이므로 그대로 둔다.
저장하는 사건 시각은 wall clock을 쓴다.
시계가 뒤로 가도 기존 하한 규칙(P0V-30, P0V-56)이 지킨다.

### 9.2 시계

부팅·복귀의 시각 동기화는 guestctl이 소유한다. guestctl은 부팅 때와 깨어날 때 `time.set`으로 `CLOCK_REALTIME`을 host 시각에 맞춘다. 앞으로 뛰는 것과
뒤로 가는 것 모두 step한다. 저장하는 시각은 P0V-56의 하한 규칙이 인과를 지킨다. guest의 timezone은 UTC다. host UI가 local time으로 보인다.

### 9.3 장애 표

| 장애 | guest에게 어떻게 보이나 | 복구 | 사용자에게 |
|---|---|---|---|
| `omahostd` crash | VM이 같이 죽는다(VM은 `omahostd`의 자식 `oma-vmhelper` 안에서 돈다. helper는 부모가 죽으면 VM을 멈추고 끝난다). 전원 장애와 같다 | launchd가 `omahostd`를 다시 띄운다. 다음 부팅의 R0 | "비정상 종료 뒤 복구했습니다" 한 줄 |
| `oma-vmhelper` crash | 위와 같다 | `omahostd`가 `crashed`로 다룬다(MAC-331) | "엔진을 다시 시작했습니다" |
| OMA.app·`oma` 명령 crash | 영향 없음. society session은 guest에서 계속 돈다 | 다시 열면 attach한다. 결과를 모르는 RPC는 key로 조회한다. terminal 입력은 다시 보내지 않는다(MAC-221) | 없음 |
| guest kernel panic | — | `crashed`, backoff 재부팅(MAC-331) | "엔진을 다시 시작했습니다" |
| guestctl·guesthost crash | systemd가 다시 띄운다. society session은 따로 된 unit이라 계속 돈다(§4.6) | host가 다시 연결한다. `bootId`는 같다. 진행 중이던 요청은 key로 조회한다 | 없음(길어지면 "연결 중") |
| guest의 `oma` crash | broker는 supervision channel이 끊겨 drain한다(기존). 엔진은 상속한 lease로 society를 쥔 채 끝난다(REC-007) | session holder가 끝을 알리고 끝난다. 사용자가 다시 열면 새 session이 lease를 다시 잡는다 | "society가 멈췄습니다. 다시 열 수 있습니다" |
| VM hung | health 무응답 | MAC-330 | "엔진이 응답하지 않아 다시 시작했습니다" |
| Mac 디스크 부족 | virtio-blk 쓰기 오류가 guest ext4 오류로 이어진다 | §9.6 | "저장 공간이 부족합니다" |
| image 손상 | — | 부팅 전 검증에서 걸린다. 직전 image로 부팅한다(MAC-601) | "업데이트 파일이 손상되어 이전 버전으로 실행합니다" |
| state disk 손상 | fsck가 preen으로 못 고친다 | `failed`, 그다음 R1–R3 | "데이터를 확인해야 합니다" |
| project repo가 사라짐 | — | MAC-403 | "프로젝트를 찾을 수 없음" |

### 9.4 version skew

guest protocol(MAC-250):

| `omahostd` | 도는 image | state schema | 동작 |
|---|---|---|---|
| N | N | ≤ N | 정상 |
| N | N−1(update가 실패해 rollback한 뒤) | ≤ N−1 | 정상. host가 N−1 protocol을 말한다. 다음 update 시도는 사용자가 한다 |
| N−1 | N−1(app은 N으로 update됐지만 `omahostd`는 아직 옛 것) | ≤ N−1 | 정상. 옛 `omahostd`와 옛 VM이 함께 돈다. 새 UI와의 관계는 아래 Host API 표 |
| N | N−2 이하 | — | 이 image로 부팅하지 않는다. N image로 부팅한다(host는 두 image만 가진다) |
| N−1(사용자가 되돌림) | N−1 | N | MAC-611: 부팅 거절, `STATE_NEWER_THAN_APP` |
| N | N | N+1(다른 Mac의 archive 복원) | archive 복원이 거절한다. 읽을 수 있는 schema가 아니다 |

Host API(MAC-251):

| host UI(OMA.app·`oma` 명령) | 떠 있는 `omahostd` | 동작 |
|---|---|---|
| N | N | 정상 |
| N | N−1(app update 뒤 아직 다시 시작하지 않음) | UI가 N−1 Host API로 말한다. N에만 있는 기능은 보이지 않는다. 유휴 정지나 "지금 적용" 뒤 `omahostd`가 N으로 다시 시작한다(§8.3) |
| N | N−2 이하 | 말하지 않는다. "OMA를 다시 시작해야 합니다"와 다시 시작 버튼. 다시 시작은 MAC-320을 거친다 |
| N−1(사용자가 app을 되돌림) | N | 겹치지 않는다. 위와 같이 다시 시작을 제안한다. 다시 시작한 `omahostd`는 설치된 N−1 binary다. state schema는 MAC-611이 지킨다 |

### 9.5 진행 중이던 작업

OMA의 작업은 모두 기존 durable 경계를 가진다: operation 원장, receipt, batch 정산. 그래서 VM이 어느 순간 멈춰도 기존 crash 복구가
결과를 정한다. macOS에서 새로 생기는 경계는 셋이다: host의 import/export, archive, update. 셋 모두 request key와 guest의 원장 기록을
가진다(MAC-240). host 쪽 단계(bundle을 Mac repo에 fetch, archive 파일 쓰기)는 결과 파일의 이름을 마지막에 원자적으로 publish한다.
fetch는 ref 하나의 갱신이다.

### 9.6 저장 공간

guest의 ext4가 보는 빈 공간은 가상 disk(기본 64 GiB)의 빈 공간이다. Mac에 실제로 남은 공간이 아니다. 그래서 guest의 기존 storage
admission(D04)만으로는 Mac이 가득 차는 것을 막지 못한다. Mac의 공간은 host가 본다.

**MUST [MAC-660]** `omahostd`는 Mac 볼륨의 빈 공간을 1분마다 본다. 한도는 둘이다.

- `max(5 GiB, state disk 실제 크기의 10%)` 아래: 새 society·import·snapshot·archive를 거절하고 경고한다. 먼저 MAC-661로 공간을 되찾는다.
- 1 GiB 아래: guest에 admission을 닫으라고 한다(`HOST_STORAGE_LOW`). 이미 accept된 작업의 정산은 계속한다(D04와 같은 구분).

**MUST [MAC-661]** host가 쓰는 공간은 되찾을 수 있어야 한다.

- snapshot: APFS clone은 처음에는 공간을 쓰지 않지만, `state.img`에 쓰기가 쌓일수록 원본과 갈라진 만큼 공간을 차지한다. 그래서
  snapshot은 개수(최근 3개)보다 공간이 먼저다. 첫 한도 아래로 내려가면 가장 오래된 snapshot부터 지운다. update 전 snapshot은 update가
  확정될 때까지 지우지 않는다. 지운 것을 UI에 적는다.
- state disk: sparse file은 guest가 파일을 지워도 스스로 줄지 않는다. guest는 state 파일 시스템에 주기적으로 `fstrim`을 한다
  (`fstrim.timer`, 주 1회, 그리고 society를 지운 뒤). Virtualization.framework가 discard를 `state.img`의 hole로 바꾸는지는 확인이
  필요하다(MV-62). 바꾸지 않는다면 VM이 멈춰 있을 때 host가 줄인다: guest가 빈 block을 0으로 채운 기록을 남기고, host가 0인 영역에
  hole을 뚫는다(`F_PUNCHHOLE`).
- disk를 늘리는 것은 VM이 멈춰 있을 때만 한다(`truncate`로 `state.img`를 늘리고, 다음 부팅 뒤 `disk.grow`). 실행 중인 disk의 크기
  변경을 guest에 알리는 API에 기대지 않는다.

---

## 10. 검증 전략

### 10.1 원칙

- 기존 lane(fast, durable, property, stress, kernel, crash)은 guest에서 그대로 돈다. **실제 image를 실제 Virtualization.framework
  위에 띄워서** 돌린다. guest는 기존 lane이 도는 환경(Debian 13, systemd 257)과 같다. 다른 점은 arm64와 macOS 아래의 disk뿐이다.
  그 차이가 결과를 바꾸지 않는다는 것을 이 lane들이 증명한다.
- 시험이 skip되면 통과가 아니다(기존 규칙: `unrunTests`). 그래서 guest에서 원리적으로 돌 수 없는 시험은 skip으로 남기지 않고 lane의 목록에서
  뺀 뒤, 그 증거를 어디서 얻는지 적는다. vsock bridge 시험(`platform-vsock-bridge`)은 vsock loopback이 있어야 도는데, guest kernel에는
  loopback이 없다(MAC-204). 그래서 이 시험은 `platform` lane(loopback이 있는 Linux)에서 돌고 guest-lanes에는 들지 않는다. 실제 VM에서의
  MAC-202 증거는 MV-21이다.
- macOS 쪽은 새 lane을 더한다. 각 oracle은 기존 규율을 따른다: 고친 곳을 되돌리면 실패해야 하고(negative control), 결과는 source
  digest와 image manifest digest에 결박한다.
- GitHub가 제공하는 macOS runner에서 Virtualization.framework로 VM을 띄우는 것에는 기댈 수 없다. runner 자체가 VM이고, nested
  virtualization은 M3 이상 host와 macOS 15 이상에서만 제한적으로 된다. 그래서 VM이 필요한 lane은 **self-hosted Apple Silicon Mac**
  (Mac mini)에서 돈다. VM이 필요 없는 lane(Swift 단위 시험, codec conformance)은 hosted runner에서
  돌 수 있다.

### 10.2 lane

| lane | 어디서 | 무엇을 |
|---|---|---|
| `guest-lanes` | self-hosted Mac, 실제 VM | 기존 fast·durable·property·stress를 guest에서. kernel·crash는 guest의 disposable `omatest` 사용자로 |
| `platform` | Linux(기존 CI), `npm run verify:platform` | host와 guest의 Node 코드: protocol codec, guest 서버·control·terminal session, `omahostd`의 state machine·Host API·pool·relay를 LocalDriver(VM 대신 같은 host의 guest 서비스)로. bridge는 vsock loopback으로 |
| `mac-unit` | hosted macOS | Swift helper 단위: VZ 구성, vsock→unix 이음, Keychain backend(시험 keychain), 절전 알림 |
| `mac-contract` | hosted macOS | `omahostd`와 `oma-vmhelper` 사이의 channel이 같은 vector를 같은 결과로 읽는가 |
| `mac-vm` | self-hosted Mac | 부팅·handshake·정지·강제 정지·crash 재부팅·절전과 깨어남·version skew·update와 rollback·disk full |
| `mac-security` | self-hosted Mac | §10.3의 경계 oracle |
| `mac-powercut` | self-hosted Mac | host 프로세스 kill로 guest 전원 장애를 만들고 불변식을 확인한다. S-06의 VM 부분 |
| `mac-e2e` | self-hosted Mac | 시나리오 층(scripted provider)을 host Relay 뒤에 두고 사용자 흐름 전체를 돈다. native UI는 XCUITest, TUI는 pty |

### 10.3 oracle

| ID | lane | 증명하는 것 | negative control |
|---|---|---|---|
| MV-01 | mac-vm | `absent → provisioning → ready → draining → stopped`. 전이마다 UI 문구에 "VM", "Linux"가 없다 | 문구에 내부 용어를 넣으면 실패 |
| MV-02 | mac-vm | 정지가 drain deadline 안에 `guestDidStop`으로 끝난다. deadline을 넘기면 `forced`로 끝나고 `host-record`에 남는다 | deadline을 없애면 hang으로 실패 |
| MV-03 | mac-vm | guest panic(`echo c > /proc/sysrq-trigger`) 뒤 backoff 재부팅, 10분 세 번 뒤 `failed` | 재부팅 한도를 없애면 실패 |
| MV-04 | mac-vm | 깨어난 뒤 guest의 wall clock이 host와 1초 안으로 맞고, monotonic으로 잰 기한이 잠든 시간 때문에 만료되지 않는다 | 기한을 wall clock으로 재면 실패 |
| MV-05 | mac-vm | 절전 동안 진행하던 provider 요청은 다시 보내지 않는다(scripted provider가 받은 요청 수) | Relay가 재전송하면 실패 |
| MV-10 | platform | 모든 RPC message의 conformance vector(정상과 거절)를 codec이 판정한다. host와 guest는 같은 codec을 쓴다 | schema에서 field 하나를 빼면 실패 |
| MV-06 | platform | MAC-650의 세 곳이 wall clock의 앞뒤 step에 영향받지 않는다: 시계를 몇 시간 앞으로 옮겨도 credential 대기가 곧바로 끝나지 않고, 뒤로 옮겨도 broker 재시작 창의 기록이 빠진다 | `Date.now()`로 되돌리면 실패 |
| MV-13 | platform | MAC-704: `pi/current`는 host의 `settings.json`으로 해석된다. guest가 보낸 provider·model이 host의 정의에 없으면 거절한다. 답의 model 정의에 `baseUrl`·header·key가 없다. origin은 host의 `models.json`이 정한다 | guest가 origin을 정하게 하면 실패 |
| MV-11 | mac-vm | `bootId`가 바뀐 뒤 결과를 모르는 요청을 다시 보내지 않고 key로 조회한다. `REQUEST_NOT_FOUND`일 때만 다시 보낸다 | 다시 보내게 하면 guest 원장에 두 번 남아 실패 |
| MV-12 | platform, mac-vm | terminal: detach한 뒤에도 `oma`가 돈다. 다시 attach하면 mode가 다시 오고 화면 전체가 다시 그려진다. 두 번째 attach는 `ATTACH_CONFLICT`, takeover는 앞 attach에 `detached`를 준다. 끊긴 연결의 입력을 다시 보내지 않는다 | 다시 그리기를 빼면 빈 화면으로 실패 |
| MV-20 | mac-security | sandbox 안에서 `socket(AF_VSOCK)`이 `EPERM`이다 | seccomp filter를 빼면 실패 |
| MV-21 | platform, mac-security | bridge가 CID 2가 아닌 연결을 읽지 않고 닫는다(platform에서는 vsock loopback의 CID 1로). guestctl·guesthost가 `oma-bridge`가 아닌 uid의 연결을 읽지 않고 닫는다. guest의 `oma` 사용자 프로세스가 서비스 socket을 직접 열어도 host 행세를 하지 못한다 | CID 검사나 `SO_PEERCRED` 검사를 빼면 실패 |
| MV-22 | mac-security | host가 vsock을 listen하지 않는다. guest에서 CID 2의 모든 port로의 connect가 실패한다 | host listener를 하나 열면 실패 |
| MV-23 | mac-security | 시나리오를 돌린 뒤 `state.img`, guest memory dump, guest journal 어디에도 진짜 key의 바이트가 없다 | 엔진 환경에 key를 넣으면 실패 |
| MV-24 | mac-security | 응답에 key를 되돌려 주는 scripted provider에 Relay가 연결을 끊는다(INF-007 tripwire가 host에서도 성립) | tripwire를 끄면 실패 |
| MV-25 | mac-security | guest가 `egress.open`에 바인딩되지 않은 `credentialRef`나 다른 목적지를 요구하면 거절한다 | 검사를 빼면 실패 |
| MV-26 | mac-security | 서명이 틀린 image, sha256이 다른 `system.erofs`, verity가 깨진 블록으로는 부팅하지 않는다 | 검증을 건너뛰면 실패 |
| MV-30 | mac-powercut | 쓰기 부하(mail 전달, 설정 commit, git 통합, receipt 게시) 중 임의 시점에 `omahostd`를 SIGKILL한 뒤 다음 부팅에서 확인한다: 확정된 사실이 그대로다, 원장 decode가 손상을 말하지 않는다, 결과를 모르는 operation은 unknown이다. 100회 이상 | `synchronizationMode: .fsync`로 바꾸면 이 lane은 전원 장애 증거로 인정하지 않는다(MAC-302) |
| MV-31 | mac-powercut | 같은 시험을 `forced` 정지로도 한다 | — |
| MV-32 | platform, mac-vm | freeze의 deadline이 guest 설정의 가장 짧은 `receiptWaitSeconds`보다 짧다. 설정을 읽지 못하면 freeze하지 않는다. `thawed: false`면 host가 사본을 버린다. 떠 있는 VM의 snapshot은 모든 society를 멈춘 뒤에만 만든다 | 한도를 고정값으로 되돌리면, 또는 `thawed: false`의 사본을 남기면 실패 |
| MV-34 | platform, mac-vm | MAC-303: 할당된 block이 있는 `state.img`, 처음 1 MiB가 0이 아닌 device, provisioning이 끝난 기록 가운데 하나만 있어도 포맷하지 않는다. superblock을 지운 disk로 부팅하면 `failed`로 멈춘다 | signature 기준으로 되돌리면 손상 disk를 포맷해 실패 |
| MV-33 | mac-vm | archive 왕복: 만들고, 다른 VM instance에서 복원하고, 무결성 진단이 통과한다. 1바이트를 바꾸면 복원을 거절한다 | digest 검사를 빼면 실패 |
| MV-35 | mac-vm | MAC-623: 유휴 정지 때 7일이 지난 society의 archive가 생기고, society마다 4개만 남는다. 공간이 한도 아래면 만들지 않고 알린다 | 주기를 빼면 실패 |
| MV-40 | CI | image를 두 번 build하면 sha256이 같다 | — |
| MV-41 | mac-vm | update 성공, migration 실패 주입 뒤 rollback이 update 전 snapshot으로 돌아간다. 옛 app으로 새 state를 열지 않는다 | rollback이 부분 migration disk를 쓰면 실패 |
| MV-42 | mac-vm | 표 §9.4의 모든 칸 | — |
| MV-43 | mac-vm | MAC-321: 로그아웃·재시작·시스템 종료 때 OMA.app이 떠 있는 경우와 없는 경우 각각, `omahostd`가 받은 시간과 결과(`stopped` 또는 `forced`)를 기록한다. 결과가 무엇이든 다음 부팅의 불변식이 지켜진다 | — (측정) |
| MV-50 | mac-e2e | import(작은 repo, 큰 repo, sha256 object format, submodule·LFS가 있는 repo) 뒤 mirror의 `refs/remotes/mac/<branch>`에 정확한 commit이 있다. 첫 society의 canonical `main`은 그 commit이다. 두 번째 import는 canonical을 바꾸지 않는다. 옮기지 않은 것을 보고한다 | submodule 보고를 빼면, 또는 import가 canonical을 바꾸면 실패 |
| MV-53 | platform, mac-e2e | MAC-412: mirror가 비어 있는 project의 `society.open`은 거절된다. 첫 import 뒤에 연 society의 canonical `main`과 object format은 Mac repo의 것이다(sha256 repo 포함). 256 MiB를 넘는 첫 import가 공간이 있으면 된다 | 빈 mirror로 열게 하면 canonical root commit이 생겨 실패 |
| MV-54 | platform | MAC-404: `core.fsmonitor`·hook·`core.pager`·`credential.helper`를 실행 파일로 둔 Mac repo에서 import·export를 해도 그 어느 것도 실행되지 않는다 | 명령줄 덮기를 빼면 실행 흔적이 남아 실패 |
| MV-51 | mac-e2e | export 뒤 Mac repo에서 `refs/remotes/oma/main`만 바뀌었다. 작업 트리·index·`refs/heads/*`가 바이트 그대로다 | branch를 갱신하면 실패 |
| MV-52 | mac-e2e | project를 옮기거나 이름을 바꾸면 bookmark가 따라간다. 다른 repo로 바꿔치기하면 멈춘다 | root commit 검사를 빼면 실패 |
| MV-60 | platform, mac-e2e | 시나리오 층의 Principal 루프(SCN-L01 모양): host의 terminal attach로 guest의 `oma`를 움직여 위임, 답장, 읽기, 확인까지. provider는 host Relay 뒤의 scripted provider다 | — |
| MV-62 | mac-vm | MAC-661: guest에서 큰 파일을 지우고 `fstrim`한 뒤 `state.img`의 할당 크기가 준다(아니면 멈춘 뒤의 hole 뚫기로 준다). snapshot이 공간 한도에서 오래된 것부터 지워진다 | 되찾기를 빼면 할당 크기가 그대로라 실패 |
| MV-61 | mac-vm | Mac 디스크가 부족하면 새 작업을 거절하고 정산은 계속한다(작은 APFS sparsebundle 볼륨에서) | 한도 검사를 빼면 guest ext4 오류로 실패 |

### 10.4 증거와 판정

- 결과는 validation과 같은 방식으로 결박한다: OMA source digest, host app의 code signing digest, image manifest의 sha256.
- `mac-powercut`은 guest 수준의 전원 장애 증거다. **Mac 자체의 전원 차단**(APFS·NVMe·F_FULLFSYNC 경로)은 이 lane이 증명하지 않는다.
  그 증거가 없는 동안 macOS 배포본도 REC-004에 따라 "전원 장애에도 유실 없음"을 말하지 않는다. 물리 전원 차단 시험은 별도 장비에서
  한다(NOT_RUN으로 시작).

---

## 11. rollout(Apple Silicon 우선)

### 11.1 지원 범위

- Apple Silicon(M1 이상), macOS 14 Sonoma 이상.
- 14를 고른 이유: macOS 12부터 disk attachment의 `synchronizationMode`가 있지만, 14에서 VM 저장·복원 API와 여러 안정화가 들어왔다.
  저장·복원은 v1에서 쓰지 않지만 v2 후보다.
- Intel Mac: v1 밖이다. 나중에 하려면 조건이 셋이다. x86_64 guest image를 따로 build하고 검증한다. Intel self-hosted runner가 있어야 한다.
  사용자 수요가 비용을 넘어야 한다.

### 11.2 단계

| 단계 | 범위 | 나가는 조건 |
|---|---|---|
| M0 spike | VZ로 Debian 13 arm64 부팅, vsock 왕복, `synchronizationMode: .full` 위의 fsync 지연 측정, MV-30 시제품 | 부팅 3초 안, vsock 왕복 1 ms 안, MV-30 100회 통과 |
| M1 내부 alpha | `omahostd`, guestctl, guesthost, society 하나, Principal만, import/export, TUI | MV-01·02·10·11·12·20–26·50·51 통과 |
| M2 내부 beta | Resident와 bwrap, egress pool, native UI, snapshot·archive, update·rollback | 모든 MV와 guest-lanes 통과 |
| M3 공개 beta | Developer ID 서명, notarization, 자동 update | 2주간 crash-free session 99.5% 이상, 데이터 손실 보고 0 |
| M4 GA | Apple Silicon | 물리 전원 차단 시험 결과 기록(통과가 아니어도 된다. 그 경우 REC-004의 문구를 따른다) |

### 11.3 배포

- Developer ID 서명과 hardened runtime을 쓴다. entitlement는 `com.apple.security.virtualization`이다. VM의 NAT device와 host Relay의 네트워크 요구를 배포 entitlement에 반영한다.
- 동봉하는 Node, git, `oma-vmhelper`는 app bundle 안에서 서명한다. `omahostd`·Resolver·Relay의 JS는 bundle 봉인에 들어간다. `omahostd`는
  bundle 안의 이 파일들만 실행한다(경로를 bundle 기준으로 고정한다). Keychain의 조건은 MAC-701·MAC-703이다.
- update는 Sparkle(EdDSA 서명)로 한다. guest image는 app update에 함께 들어간다(lockstep). image만 따로 update하지 않는다.
- v2 후보: image만 따로 update하기. 전제는 셋을 바꾸는 것이다. MAC-250(host가 자기 image와 직전 image의 protocol만 말한다. 따로 온 새
  image는 host가 모르는 protocol일 수 있다), MAC-601(부팅 전에 manifest의 protocol이 host의 범위 안인지 확인한다), §8.2(image는 app
  bundle 안에 있고 host는 둘만 둔다).

---

## 12. 기존 규범과의 관계(DR18로 기록했다)

| 항목 | 바뀌는 규범 | 결정 |
|---|---|---|
| D-1 | TUI-* 문구 규칙 | 오류의 말은 `packages/tui/src/words.ts` 한 곳에서 읽는다. guest의 terminal session 아래에서는 Linux 경로·unit 이름·errno 이름이 든 말을 오류 코드로 바꾸고 원문을 guest 로그에 남긴다(MAC-022). Linux에서는 사람 자신의 말이므로 그대로 보인다 |
| D-4 | INF-001, INF-007, T116 | credential 저장소는 엔진의 agent 디렉터리가 아니라 host Keychain backend다. Principal의 엔진도 자리표시자와 relay를 쓴다(`openPrincipalEgress`) |
| D-5 | SB-001 | sandbox baseline에 `AF_VSOCK` socket 금지 seccomp를 더했다(Linux 배포본에도. 해가 없고 vsock이 있는 host에서 필요하다) |
| D-7 | WP10, `principal-delivery`, `broker-supervisor`, CLI transport | 경과 시간은 monotonic clock으로 잰다(MAC-650의 세 곳, 구현했다). Linux에도 같은 이유가 있다(시계 조정) |
| D-10 | runner의 inference 준비, Principal 엔진의 credential(INF-001·INF-007·INF-008, TUI-004) | guest에서 runner와 `oma`는 §4.7의 egress를 쓴다. 배포본의 표지는 guest image가 user manager 환경에 두는 `OMA_EGRESS_SOCKET`(`environment.d`)이다. 설정 field·unit 인자·manifest를 늘리지 않는다. 그 이름이 있으면 run은 host에 자리표시자를 받고 같은 socket 경로에 egress forwarder를 연다. Principal 엔진도 같은 길을 탄다(D-4) |
| D-9 | README·PRODUCT의 로그인 문장, INF-001 | `oma login`이 동봉 엔진의 대화형 모드를 이 society의 엔진 디렉터리 위에서 연다. 사람은 엔진 자신의 로그인·model 선택을 쓴다. OMA는 인증 화면을 만들지 않고 society의 session은 RPC 모드로만 돈다. 로그인은 society lease를 쥔다. macOS에서는 host가 같은 흐름을 host의 엔진 상태(MAC-704) 위에서 연다 |
| D-8 | GIT-006·GIT-008, AUTH-001, SB-002 | mirror를 Resident sandbox에 `/git/project-mirror.git`으로 읽기 전용 보이고(`--ro-bind-try`), actor가 기존 `git.submit`으로 게시한다. 권한·wire 변화가 없다. 사람 권한의 게시는 하지 않는다 |

이전 초안의 D-2(REC-007의 host를 society host로), D-3(D03의 foreground mode 강제), D-6(project binding의 projectId)은 없어졌다. guest에서
기존 `oma`를 그대로 돌리므로 lease·broker mode·binding이 코드 그대로 지켜진다. D-1은 뜻이 바뀌었다(Principal session의 소유자는 바뀌지
않는다). REC-005(백업의 quiescence)는 §8.4가 society 정지 위에서만 백업하므로 DR이 필요 없다.

---

## 13. 정한 것([DR18](design-revisions.md))

사용자가 2026-09-27에 선택을 맡겼다. 기본 제안을 채택했고, Q4와 Q7은 값을 정했다.

| 질문 | 결정 | 이유 |
|---|---|---|
| Q1 창을 닫은 society를 백그라운드에서 계속 돌릴 것인가 | 예(`keep-running`), menu bar에서 멈출 수 있음 | Resident의 긴 작업이 창을 닫았다고 멈추면 놀랍다 |
| Q2 유휴 절전을 막을 것인가 | Resident가 일할 때만, 끌 수 있음(MAC-311) | 배터리와 진행의 균형 |
| Q3 archive key를 잃었을 때의 복구 | 첫 archive 때 복구 key를 보이고 확인받음 | Keychain만으로는 Mac을 잃으면 archive도 잃는다 |
| Q4 vendor 식별자(Keychain service, bundle ID) | `io.github.minjung2035.oma`(Keychain service는 `.provider`·`.archive`를 붙인다). Team ID는 서명하는 주체의 것이다 | 도메인이 없는 프로젝트의 역DNS 관례(Flatpak의 `io.github.<user>.<app>`) |
| Q5 guest image의 크기 목표 | 압축 후 600 MB 이하 | 첫 설치 download 크기 |
| Q6 guest disk 기본 크기 | 64 GiB sparse | 실제 사용분만 차지한다 |
| Q7 진단 묶음을 받는 곳 | 이 저장소의 GitHub issue. 사람이 직접 붙인다. OMA는 자동으로 보내지 않는다(MAC-641) | 받는 곳이 정해져야 UI가 안내할 수 있다 |
| Q8 D-8(가져온 commit을 actor가 쓰는 길) | mirror의 읽기 전용 노출(권한·wire 변화 없음) | 사람 권한의 게시는 새 actor 종류라 계획이 필요하다 |
| Q9 D-9(로그인 흐름의 표면) | 두 배포본에 같은 답(`oma login`) | Linux의 첫 줄("아직 아닌 것")과 같은 문제다 |


### 7차 검토 반영 (DR19)

host의 record·archive·snapshot 게시는 `src/platform/host/files.ts`가 소유한다. 같은 디렉터리 temporary에
완성한 bytes를 fsync하고 no-replace link(새 파일) 또는 rename(record 교체)한 뒤 부모를 fsync한다.
`omahostd.lock`을 먼저 확보한 단일 owner가 시작 시 자신이 쓰는 형식의 `.partial`을 회수한다.
이 순서는 process crash·쓰기 오류 시험의 범위이며, APFS·VZ·실제 전원 차단의 증거를 대신하지 않는다.
archive는 수신 청크를 바로 암호화하여 temporary에 쓴다. 평문 archive를 host disk에 staging하지 않으며,
쓰기·완결 오류는 공통 stream receiver가 reject하고 fd·temporary를 반납한다. GCM chunk 번호는 UInt32 상한을 넘기 전에 거절한다.
MAC-660의 여유 공간 검사는 수신 전 수행하며, 이후 ENOSPC도 같은 실패 경로로 처리한다.
snapshot은 `<sequence>-<id>.img` 이름의 순서로 보존·제거하고, 벽시계 mtime으로 새 snapshot을 지우지 않는다.

guest `stream.get`의 크기·hash·전송은 한 번 연 descriptor를 대상으로 한다. bundle capability는
64 KiB 상한 안에서 읽고 상한에 걸린 불완전 헤더를 sha1로 추정하지 않는다. instance record는 no-replace로 게시한다.
society open은 society별로 직렬화하고, session launcher의 이전 동명 unit은 stop/reset 후 재사용한다.
실제 user-manager 재기동과 macOS native 동작은 해당 환경 lane에서 별도로 검증한다.

DR26: `packages.sync`와 `packages.replace`의 선택적 `activate`는 명시적 install이 재선택한 package source다. update는 이 값을 보내지 않는다. 결과의 `ok`는 모든 project 설정 적용 성공 여부이며, CLI는 false를 성공 종료로 표시하지 않는다.

DR28: `oma pi ... --host-only`는 같은 host `packages/`와 index를 갱신하고 이미 저장된 Personal 선택만 reconcile한다. 앱·token·VM을 요구하지 않으며 guest에 `packages.sync/replace`를 보내거나 Principal/Worker 설정을 바꾸지 않는다. 설치만으로 Personal 확장을 선택하거나 최초 project seed를 소비하지 않는다. 이 명시적 선택은 session mode가 아니고 Pi argv에서 제거하며 `--project`와의 조합은 효과 전에 거절한다. flag가 없으면 DR25/DR26의 guest 동기화·실패 의미를 그대로 유지한다. token/API 관측 실패는 host-only 실행의 권한이 아니다. Host API·guest protocol version과 method shape는 바뀌지 않는다. native Mac 증거 및 잔여 범위는 [validation](implementation/validation.md)을 본다.

## oma-vmhelper

상태: **NOT_BUILT.** 이 source는 Linux 개발 host에서 빌드하거나 실행하지 않았다. Mac(Apple Silicon, macOS 14 이상)에서 `swift build -c release`로
빌드하고, Developer ID로 서명하고(hardened runtime, `oma-vmhelper.entitlements`), mac-unit·mac-vm lane에서 시험하기 전까지는 동작한다고 말하지 않는다.

하는 일(macos-platform §2.1): Virtualization.framework로 guest VM을 구성·시작·정지하고, guest의 vsock port를 unix socket으로 잇고(vfkit의
connect mode), Keychain item을 읽고 쓰고(MAC-701), 절전·깨어남을 알린다.

`omahostd`와의 규약은 descriptor 3의 JSON 줄이다. Node 쪽 구현과 그 시험이 규약의 원본이다: `src/platform/host/vz-driver.ts`,
`test/platform-vz-driver.test.ts`, 같은 규약을 말하는 시험용 helper `test/fixtures/fake-vmhelper.mjs`.

| 방향 | message |
|---|---|
| → | `{ op: "start", id, config: { kernel, initrd, cmdline, disks: [{ path, readOnly }], cpus, memoryBytes, consoleLog, ports, socketDir } }` |
| → | `{ op: "forceStop", id }` |
| → | `{ op: "keychain.get", id, account }`, `{ op: "keychain.put", id, account, value }` |
| ← | `{ id, ok: true, ... }` 또는 `{ id, ok: false, error }` |
| ← | `{ event: "stopped", cause: "guest" \| "error", message? }`, `{ event: "sleep" }`, `{ event: "wake" }` |

descriptor 3이 닫히면(부모가 끝남) VM을 멈추고 끝난다(§9.3).

환경: `OMA_KEYCHAIN_SERVICE`(기본 `io.github.minjung2035.oma.provider`), `OMA_KEYCHAIN_GROUP`(access group 전체 이름). 식별자는 §13 Q4로 정했다. Team ID는
서명하는 주체의 것이다.
