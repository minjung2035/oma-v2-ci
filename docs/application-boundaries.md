# 코드 구조와 책임 경계

현재 구현은 루트의 통합 시험·개발 도구, `apps/oma`, 기능별 `packages/*`로 나뉜다. DR46/DR47 이후의 실제 경로를 기준으로 안내한다. 동작 계약은 [implementation-spec](implementation-spec.md), 실행 판정은 [validation](implementation/validation.md)이 소유한다.

## 저장소 구조

| 위치 | 책임 |
|---|---|
| [apps/oma/src](../apps/oma/src) | 제품 entry·application 조립·구체 Store와 effect 연결·세션·host/guest use case |
| [packages](../packages) | 기능별 workspace. 각 package가 명시적 exports·직접 의존성·build·test·자산을 소유 |
| [test](../test) | 여러 package와 실제 App을 연결하는 통합·회귀 시험 |
| [scripts](../scripts) | build·검증·inventory·독립 설치·도구 설치 명령 |
| [implementation](../implementation) | requirement/owner/boundary/review map과 생성 evidence |
| [docs](.) | 현재 안내·계약·결정 기록·보관 문서 |

루트 `src/`와 이전 경로 호환 shim은 없다. 제품의 bin은 `apps/oma/dist/entry/oma.js`다. package 사이에서는 상대경로·다른 package의 `src`/`dist`를 직접 참조하지 않고 공개 exports를 사용한다. 루트 App 통합 시험만 `#oma-test/app/*` private import를 사용한다. 이 경로는 제품 공개 API가 아니다.

## 기능별 owner

| workspace | 책임 |
|---|---|
| `@oma/contracts` | 공개 행위·fact·state의 타입 계약. 실행 효과 없음 |
| `@oma/domain` | 식별자·값·정책·권한 판정의 순수 계산 |
| `@oma/protocol` | request/result/session DTO·wire codec·receipt/status 표현 |
| `@oma/native`, `@oma/process` | FD·filesystem containment·lock·PTY / 실제 child 종료·상속 fence·writer 대기 |
| `@oma/storage`, `@oma/config` | SQLite ledger·transaction·파일 게시 / 설정 해석·검증·generation 게시 |
| `@oma/mail`, `@oma/lifecycle` | 메일·batch·정산 / 생성·bootstrap·실행·종료·복구 판정 |
| `@oma/git`, `@oma/review`, `@oma/reconcile` | Git 관측·검사·게시·CAS / review 권한·수락·진행 / pending 효과와 실제 상태 대조 |
| `@oma/broker`, `@oma/client` | 인증·dispatch·run 경계 / 요청·결과·receipt 클라이언트 |
| `@oma/engine` | Pi SDK 연결·Principal/Personal session·interactive UI 연결·SDK adapter |
| `@oma/tui` | Control Panel·메일·설정·화면 표현 |
| `@oma/extension`, `@oma/tool-runtime` | 신뢰된 OMA 확장 / provenance·tool surface·파일/실행 경계 |
| `@oma/tool-lsp`, `@oma/tool-hashline`, `@oma/tool-web`, `@oma/tool-mcp` | 동봉 도구의 검증된 upstream payload와 OMA 연결 |
| `@oma/platform-linux`, `@oma/platform-mac` | systemd·cgroup·bwrap·Linux guest 자산 / VZ·Keychain·bookmark·Mac 파일·Swift helper |
| `@oma/app` | 위 기능의 제품 조립과 물리 효과 연결. 공개 API는 installer assets·admin diagnostics |

정확한 exports는 각 `package.json`, 허용 의존성과 private 경계는 [check-modules.mjs](../scripts/check-modules.mjs), 실제 import graph는 [dependency-graph.json](../implementation/evidence/dependency-graph.json)이 소유한다. 이 표는 OS 이식 가능성이나 독립 설치 PASS를 뜻하지 않는다.

## Society 실행을 읽는 순서

시작점은 [entry/oma.ts](../apps/oma/src/entry/oma.ts), Society 조립은 [entry/oma-society.ts](../apps/oma/src/entry/oma-society.ts)다. 아래 경로는 `apps/oma/src/` 기준이다.

| 단위 | 소유하는 판단 | 맡기는 효과 |
|---|---|---|
| `application/society-bootstrap.ts` | 저장 경로·history identity·project binding·설정과 conversation tree 준비 | HostTenure의 lease, Broker의 quiescence/repair |
| `application/society-runtime.ts` | Broker/Principal 연결·등록·mail delivery·현재 engine callback 판별 | HostTenure의 권한·fence, supervisor 재시작, engine의 실제 종료 |
| `application/society-interaction.ts` | TUI·입력·history·설정·메일 관측 표시 | runtime command, 설정 게시, 하위 관측 |
| `application/society-transition.ts` | 종료·재진입 순서·history admission·미사용 세션 정리 | 실제 outgoing engine 종료 |
| `runtime/host-tenure.ts` | Society 권한·broker generation·상속 descriptor 수명 | 각 process owner의 실제 종료 관측 |
| `entry/broker.ts`, `broker/` | Store·unit·workspace·메일·lifecycle·Git·review·reconcile 조립 | 각 feature의 판정과 원래 transaction/물리 effect owner |

Runtime의 화면 계약은 `application/society-conversation.ts`다. UI에는 data와 좁은 command를 주고 실제 PrincipalSession과 `exited`는 runtime에 둔다. 늦은 callback은 자기 engine과 broker generation을 확인한다. `/new`·`/resume`·모드 전환은 실제 outgoing engine 종료 뒤에 진행한다.

### 세션 작업공간 보관

[runtime/session-storage.ts](../apps/oma/src/runtime/session-storage.ts)가 DR48의 보관·복원을 조정한다. Restic child/FD 수명은 `packages/process/src/restic.ts`, tar/inventory 검증은 `packages/storage/src/restic-tar.ts`·`restic-verification.ts`, checkpoint 상태는 App의 `session-storage-state.ts`가 소유한다. 물리 tree 검증은 [storage/cache-trees.ts](../packages/storage/src/cache-trees.ts)가 소유한다.

Broker는 Store open/provision **이전**에 staged restore를 수행하고, drain·native 종료·Resident quiescence·Store.close **이후**에 archive한다. DB·mail·runner·Principal history는 원래 owner에 남긴다. 보관의 성공·원본 회수·cold 선택·복원 성공을 하나의 상태로 축약하지 않는다. 도구 설치는 [install-restic.mjs](../scripts/install-restic.mjs), 운영 방법은 [operations](operations.md#세션-작업공간-보관)를 따른다.

## Native 실행과 OS adapter

App은 platform adapter를 선택하고 기존 25개 workspace의 public API를 조립한다. VM의
host/guest use case·RPC·VZ lifecycle·guest 자산은 제거했다. 과거 시험 원문은
[VM 시험 보관 기록](archive/macos-vm-tests-2026-10-25/README.md)에 있으며 native proof로 사용하지 않는다.

| 위치 | 주요 역할 |
|---|---|
| [process](../packages/process/src) | 공통 start/stop 조정·spawn/FD/출력 수명·restart 정책·Restic 명령 |
| [storage](../packages/storage/src) | owned tree·게시·package staging·tar/inventory 검증 |
| [native](../packages/native/src) | 디렉터리 상대 syscall·pin/reopen·lock·peer/process 관측 primitive |
| [platform-mac](../packages/platform-mac/src) | Darwin credential channel·독립 Keychain primitive. VM runtime 없음 |
| [platform-linux](../packages/platform-linux/src) | Linux unit 명령/관측 reference adapter·bwrap/seccomp·rootfs |

Linux systemd·abstract Society lease 의존 제거와 Darwin sandbox·파일 pin·인증 연결은 진행 중이다.
실제 미해결 gate와 실행 결과는 [전환 기록](implementation/native-transition.md)과
[validation](implementation/validation.md)이 소유한다. interface나 Linux unit 시험으로
실제 Darwin 지원을 주장하지 않는다.

## Review와 transaction 경계

[packages/review/src](../packages/review/src)의 `index.ts`는 caller admission을 연결한다. `authority.ts`는 검증된 사실을 현재 순수 정책 입력으로 만들고, `preparation.ts`는 수락 전 관측·준비를 조정한다. `messages.ts`는 thread·문서·preaccept artifact를, `acceptance.ts`는 원래 captured T 안의 재검사·recipient snapshot·intent/delivery 수락을 소유한다. `advancement.ts`는 accepted 작업의 repair·refresh·통합 요청, `status.ts`는 읽기 projection을 담당한다.

App이 실제 ledger/effect port를 연결한다. authority reader는 Store write나 Git I/O를 하지 않고, acceptance transaction 안에는 await·Git·Maildir I/O가 없다. Integration은 현재 authority 확인 뒤 CAS하며 이미 적용된 사실의 정산은 새 권한 판정과 구분한다. 순수 readiness 의미는 [domain/review-evaluation.ts](../packages/domain/src/review-evaluation.ts)에 있다.

## Pi SDK 경계

[packages/engine/src/interactive.ts](../packages/engine/src/interactive.ts)는 startup/disposal을 연결하며 입력·선택·UI·session event·RPC를 같은 package의 의미별 module에 맡긴다. PrincipalSession은 실제 RPC·credential socket·child 종료를 소유하고, turn 판정은 [domain/turn-admission.ts](../packages/domain/src/turn-admission.ts)가 수행한다.

공개 API가 없는 SDK 접점은 `packages/engine/src/pi-compat/`에 모은다. 정확한 버전·잔여 member·이유는 [contacts.json](../packages/engine/src/pi-compat/contacts.json)이 소유한다. host는 raw private handle을 받지 않는다. 버전·member shape 검사는 접점을 제거했다는 뜻이 아니며, 공개 API 사용과 남아 있는 private 의존을 구분한다.

SDK autocomplete는 공개 provider API를 사용한다. optional 검색 도구 설치가 UI 시작을 막지 않도록 하는 scoped private import와 editor·session·문구 adapter는 위 inventory에 남는다. SDK 버전을 바꿀 때에는 해당 원래 semantic oracle과 실제 설치 동작을 확인한다.

DR49 native 전환에서 start/stop 순서와 관측 판정은 `process/resident-supervisor`가 소유한다.
Linux UnitsModule은 이를 실제 호출하고 unit 문법·manager 명령·cgroup 관측만 제공한다.
이 adapter는 이행 중 reference이며 최종 manager 제거는 아직 남았다. Restic 명령/FD 수명은
process, tar/inventory/tool 파일 검증과 package staging은 storage, 조립은 App이 소유한다.
공통화 때문에 아래 모듈에서 App을 import하거나 workspace 의존 허용 목록을 넓히지 않는다.
