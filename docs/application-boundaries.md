# Application 조립과 책임 경계

[DR43](design-revisions.md#dr43--society-조립-수명-단위와-플랫폼-책임-경계)의 구현 안내다.
기존 [architecture](architecture.md), [implementation-spec](implementation-spec.md),
[macOS 규격](macos-platform.md)의 ownership·권한·복구 계약을 변경하지 않는다.

## Society 실행을 읽는 순서

`entry/oma-society.ts`는 command를 선택하고 아래 단위를 연결하며 process signal을 배선한다.

| 단위 | 소유하는 판단과 조정 | 아래 owner에 맡기는 것 |
|---|---|---|
| `application/society-bootstrap.ts` | 저장 경로·history identity·binding admission, 설정과 conversation tree 준비 | HostTenure의 lease 취득, broker의 rootfs quiescence/repair |
| `application/society-runtime.ts` | Broker/Principal 조립, 등록 결과와 mail delivery 연결, 현재 engine callback 판별 | HostTenure의 권한·fence·broker generation, supervisor의 재시작, OS의 engine 종료 |
| `application/society-interaction.ts` | TUI 조립, 입력·engine UI event·history page·설정/메일 관측 표시 | runtime command, settings commit/read-back, mail/transport 관측 |
| `application/society-transition.ts` | 종료·재진입 순서, history admission, unused session 정리 | runtime 종료 command와 실제 engine exit observation |

Runtime이 보는 화면 API는 `SocietyConversationView`다. Interaction은 현재 conversation 관측과
submit/deliver/shutdown/relaunch command만 받는다. 연결은 entry에서 이루어지며 TUI 자체에는
process 실행이나 설정 저장 구현이 들어가지 않는다. Runtime의 current session/finish/owner는
외부에서 읽을 수 있지만 직접 갱신할 수 없다.

HostTenure 하나가 Society 권한과 inherited descriptor를 소유한다. Application의 `finished`는
새 작업을 시작하지 않겠다는 process transition 표시다. engine의 종료 증거는 `exited`이며,
broker 준비·등록과 delivery 허용은 HostTenure가 판단한다. Application에 별도의 lease나
broker/VM state machine을 만들지 않는다. `/new`와 `/resume`은 outgoing engine의 실제 종료를
기다린 후에만 execve 또는 host history handoff를 수행한다.

## Platform 디렉터리의 두 역할

`platform/`은 배포 위치이며 추상화 수준 하나를 뜻하지 않는다. 다음 역할을 구분한다.

| 역할 | 현재 owner | 변경 이유 |
|---|---|---|
| Host application coordination | HostService, ProjectSyncCoordinator, SessionGateway, SnapshotCoordinator, HostTransfers | project/session/backup use case의 순서와 성공·실패·unknown 처리 |
| Guest application coordination | GuestHost, GuestControl, GuestProjects/Archives/Packages | guest command admission, ledger 결과, mutation/maintenance fence |
| OS·외부 서비스 adapter | VzDriver, NativeChannel, KeychainClient, SystemdSessionLauncher, file/bookmark/bundle 구현, socket/vsock bridge | native API·OS·전송·파일 효과의 구현 |
| 공통 전송 | FramedPeer, RPC server dispatcher, stream source/receive | frame/correlation/response/channel 수명 |

Coordinator는 adapter의 반환 관측을 사용한다. adapter는 Society 선택, project policy,
UI 또는 상위 use case의 실행 순서를 소유하지 않는다. 새 native 기능은 adapter에,
새 project/session 시나리오는 해당 coordinator에 추가한다.

## 세 process lifetime의 연결

| owner | command와 observation 경계 |
|---|---|
| macOS Host / VmLifecycle | VM boot/stop command → native helper·guest handshake·health observation |
| Linux Guest / GuestHost | project-bound society open/close command → session holder endpoint·systemd 종료 observation |
| Society / HostTenure·Broker | Principal/Worker 실행 command → OS exit·broker registration·durable reconcile observation |

Society open의 흐름은 Host SessionGateway의 identity admission → typed guest request →
GuestHost의 project/society fence → launcher start → holder 관측이다. holder 안에서 Society
bootstrap이 binding/tenure를 확인하고 runtime이 broker와 Principal을 조립한다. Host의 running
응답은 guest가 관측한 session 상태이며 VM ready나 endpoint 하나가 Principal의 등록·Worker의
종료·backup quiescence까지 증명하지 않는다. 종료와 backup도 각 owner의 관측 결과를 넘긴다.

## 계약을 둘 위치와 의존 방향

| 위치 | 역할 | 참조 규칙 |
|---|---|---|
| `implementation/contracts/` | Core 공개 행위·fact·state 계약 | 구현 파일을 참조하지 않음 |
| `src/domain/` | 식별자·값의 의미·순수 정책 | transport/adapter/application을 모름 |
| `src/protocol/` | request/result/session DTO와 wire codec | protocol shape를 검증하며 실행 효과를 소유하지 않음 |
| `src/ports/` | 내부 capability 계약 | 필요한 행위만 노출하며 concrete owner를 가져오지 않음 |
| `src/application/` | use case와 product interaction 조정 | 계약과 하위 owner를 연결; TUI에 data와 좁은 command를 전달 |
| `src/platform/` adapter | OS·외부 서비스 효과 | 계약을 구현하며 product/Application으로 역참조하지 않음 |

공개 행위의 의미는 Core 계약, wire 표현은 protocol, 내부 effect capability는 port가 각각
원본이다. use case 입력이 기존 계약과 같으면 그 타입을 재사용한다. 단지 폴더가 다르다는
이유로 같은 DTO를 다시 정의하지 않는다. adapter 결과를 교차 계층에 전달할 때는 이미 검증된
request/result 계약을 사용한다. 단순 import 규칙과 보안 효과 검사는 기존 lattice/surface/
owned-state 검사로 유지하며 이 안내를 위한 별도 registry나 checker를 추가하지 않는다.
