# OMA 레거시 제거와 독립 모듈 전환 명세

상태: 25개 workspace 소스 전환·로컬 검증 완료, 필수 실제 환경 qualification 미완료. 출시 전 호환성 미유지와 Priority 0 준수는 사용자 확정 사항이다. 작성일: 2026-10-23. [DR46](design-revisions.md#dr46--출시-전-레거시-제거와-workspace-분리)이 첫 전환의 결정 범위를 기록한다.

OMA의 현재 기능과 정확성 보장을 유지하면서, 과거 구현을 위한 호환 경로를 제거하고 기능별 코드를 독립된 workspace 패키지로 전환한다. 완료의 기준은 파일 수나 주관적인 품질 점수가 아니라, 제거된 불필요한 동작·독립된 의존성·명확한 변경 범위·실행으로 확인한 기존 기능이다.

## 구현 진행 범위

명세의 24개 기능 패키지와 `apps/oma`의 실제 소스를 모두 workspace로 분리했다. 루트의
실행 소스 `src`와 과거 경로 shim은 없으며, 루트는 통합 시험·개발 명령·하나의 lockfile을
소유한다. 각 workspace는 명시적 exports, 직접 의존성, 자기 빌드·테스트·배포 자산을 가진다.
제품 조립과 실제 Store/물리 효과 연결은 App이 담당한다. 현재 실행 판정과 원본 반영 기록은
[검증 상태](implementation/validation.md), 다음 실행 단계는 [인계](HANDOFF.md)가 소유한다.

Contracts는 선언, Domain은 순수 판정, Protocol은 wire/error 의미를 각각 소유한다. Native는
FD·containment·PTY·flock, Process는 실제 child 종료·상속 fence·writer 대기를 소유한다.
Storage의 ledger와 파일 API는 공개 진입점을 분리하며 파일 소비자에게 ledger 권한을 주지 않는다.
Lifecycle/Git/Review/Mail/Broker/Reconcile는 각 사실과 권한의 원래 owner 및 synchronous
transaction 경계를 유지한다. 구체 Store를 Pick하거나 재수출해 경계를 대신하지 않는다.

Engine은 SDK host·RPC/session·settings 변환·private adapter·Open TUI 문구 wrapping을 소유한다.
App은 실제 설정 lock/read/replace, integrity, sandbox, history, presentation을 연결한다.
Linux는 systemd/sandbox/rootfs와 guest C/service 자산, Mac은 파일/archive/Keychain/native
channel과 Swift helper 입력을 소유한다. Mac의 Git 의존은 두 명명된 host API에 한정한다.
App은 guest의 현재 권한·horizon 검증과 제품 시작점을 소유한다.

HostConfig3·DB4·plan2·journal committed-v2·host/guest7·현재 SDK session header만 지원한다.
패키지 index는 kind가 있는 현재 envelope와 필수 resource 배열만 허용하고, Personal 설정은
v2, package before-image는 명시적인 현재 kind를 사용한다. 옛 uninstall 별칭과 수기 ambient
lockfile 선언도 제거했다. 지원하지 않는 bytes는 거부하며 자동 변환·재작성·삭제하지 않는다.
같은 빌드에서 accepted bytes·terminal·pending/unknown·receipt를 복구하는 경로는 유지한다.

이 소스 전환을 실제 플랫폼 qualification의 완료로 표시하지 않는다. 필수 실제 환경 검사의
`NOT_RUN`, 원시 실패와 수정 후 실행, 측정값·외부 SDK 진단은 검증 상태에서 구분한다.

## 목적과 적용 범위

이번 개편은 다음 두 결과를 만든다.

1. 현재 제품에서 의미가 없는 설정, 정책, 형식, 별칭, API, 호출 경로와 그 유지를 위한 테스트를 제거한다.
2. 각 기능이 공개 API, 직접 의존성, 빌드, 테스트, 배포 자산을 소유하는 모듈 구조를 만든다.

대상은 Personal과 Society, Principal과 Worker, 메일·리뷰·Git·context·lifecycle·복구, TUI, 확장 도구, Linux 실행 환경, macOS host와 guest, 그리고 이를 빌드하고 검증하는 코드다. 소스 파일 이동에 영향을 받는 SQL, systemd template, native helper, vendor manifest와 배포 manifest도 포함한다.

새로운 에이전트 역할, 협업 방식, 서비스 분리, 네트워크 제한, 실행 자원 quota, 독립 패키지 출시 체계는 추가하지 않는다. Pi private API 의존을 좁은 adapter 안에 모으되, 이번 작업의 완료를 위해 외부 엔진을 새로 구현하거나 upstream 변경을 기다릴 필요는 없다.

구현 시 현재 제품의 규범 문서와 기계 판독 지도를 새 구조에 맞게 함께 갱신한다. 기존 문서에 적힌 경로 보존 조건만을 이유로 호환 facade를 남기지 않는다. 이 명세를 기존 상태의 자동 삭제 근거로 사용하지 않는다.

## 호환성을 유지하지 않는 범위

출시 전 개발 과정에서 생긴 다음 항목은 보존하지 않는다.

| 대상 | 개편 후 규칙 |
|---|---|
| 과거 DB schema와 operation plan/result 형식 | 현재 빌드가 사용하는 단일 형식만 읽고 쓴다. 이전 형식의 decoder와 migration은 제공하지 않는다. |
| 과거 config 필드·생략 규칙·sentinel 값 | 현재 의미가 있는 닫힌 형식만 허용한다. 삭제된 필드를 조용히 무시하지 않는다. |
| 과거 세션·이름·캐시·journal 형식 | 새 형식 하나만 지원한다. 파일 위치나 내용으로 과거 정체성을 추측하는 fallback을 제거한다. |
| 옛 내부 import 경로와 재수출 facade | 소비자를 새 공개 API로 변경하고 기존 경로를 삭제한다. |
| 과거 개발용 wire 형식·alias·확장 배치 | 제품의 모든 실행 요소를 함께 갱신한다. 신구 빌드의 상호 통신은 보장하지 않는다. |
| 삭제된 동작만 검증하는 fixture와 테스트 | 삭제하거나 현재 입력에 대한 명시적 거부 테스트로 바꾼다. |

지원하지 않는 상태는 새 상태로 재해석하거나 자동으로 덮어쓰지 않는다. 시작 전에 명확한 형식 불일치로 거부하고 새 개발 상태 디렉터리를 사용하는 방법을 알린다. 기존 사용자 디렉터리나 프로젝트를 자동 삭제하지 않는다. reset 기능이 필요하면 OMA 소유 경계를 검증하는 별도 명시 명령으로 다룬다.

형식이 바뀌면 해당 schema 또는 protocol 식별값도 바꾼다. 다른 형식에 같은 버전을 재사용하지 않는다. readable 목록에 여러 과거 버전을 추가하는 방식으로 개편을 우회하지 않는다.

**이전 빌드와의 호환성 제거와 동일 빌드의 복구는 다르다.** 새 형식으로 접수한 요청의 원본 바이트, terminal 결과, 전달 영수증과 권한 관계는 그 빌드의 재시작 뒤에도 유지한다. 동일 빌드의 pending/unknown을 처리하는 코드를 legacy라는 이유로 삭제하지 않는다.

## 현재 코드에서 시작할 정리 대상

아래 경로는 현재 구현을 찾기 위한 위치이며 이동 후 API로 보존할 경로가 아니다. 각 삭제는 실제 호출·현재 생성자·관찰 가능한 효과를 확인한 뒤 관련 타입과 테스트까지 함께 처리한다. `legacy`라는 단어의 존재만으로 삭제 대상을 정하지 않는다.

| 현재 위치 | 확인되는 정리 대상 | 목표 |
|---|---|---|
| `src/storage/quota.ts` (제거됨) | 모든 요청을 통과시키는 `StorageAdmission`, 효과 없는 quota admission | class, 인자, reserve/release 전달, 관련 설정과 테스트를 함께 제거한다. 실제 저장 공간 관찰이 사용된다면 별도 관찰 API만 남긴다. |
| [lifecycle/policy.ts](../packages/lifecycle/src/policy.ts) | 빈 `enforceQuota`, `assertSeedCount`와 quota 전달 | 호출과 계약을 제거한다. 생성 권한·계보·canonical base 검사는 유지한다. |
| [domain/egress.ts](../packages/domain/src/egress.ts) | 허용 목록을 읽지만 항상 허용하는 정책 | 과거 allowlist 설정·판정 API를 없앤다. 현재 네트워크 접근, target parsing, relay credential 경계와 연결 수명은 유지한다. |
| [config/defaults.ts](../packages/config/src/defaults.ts), `domain/resources.ts`(DR46에서 삭제됨) | 현재 실행에 적용되지 않는 resource/quota 필드와 옛 디렉터리 이름 파생 | 사용하지 않는 필드와 파생 경로를 제거한다. 실제로 사용하는 관찰 시간·전송 형식 제한과 혼동하지 않는다. |
| `src/module-ports.ts`, `implementation/contracts/module-contracts.ts` (제거됨; 현재 owner는 [ledger port](../apps/oma/src/ports/ledger.ts)와 [runtime port](../apps/oma/src/ports/runtime.ts)) | 옛 내부 경로를 유지하는 facade와 구현 파일을 향한 타입 별칭 | 소비자 쪽 port와 실제 공개 contract로 치환하고 옛 파일을 삭제한다. |
| [domain/identifiers.ts](../packages/domain/src/identifiers.ts), [domain/attestation.ts](../packages/domain/src/attestation.ts), [git/integration.ts](../packages/git/src/integration.ts) | 과거 요청 이름, attestation, integration plan의 별도 해석 | 현재 생성되지 않는 형식·분기·타입을 제거한다. 현재 merge/challenge 정책과 실제 사용 중인 직접 integration 기능을 구분한다. |
| [runtime/session-catalog.ts](../apps/oma/src/runtime/session-catalog.ts), [config/generations.ts](../packages/config/src/generations.ts) | birth 기록 없는 이력 해석과 옛 journal 읽기 | 새 birth/journal 형식만 허용하고 추정·묵시적 승계 경로를 제거한다. 현재 reader lease와 crash 후 정리는 유지한다. |
| [pi-compat](../packages/engine/src/pi-compat), [entry/pi-interactive-host.ts](../packages/engine/src/interactive.ts) | 외부 엔진 내부 멤버와 표시 문자열에 대한 분산 의존 | 엔진 adapter에 모으고 공개 hook이 있는 경로는 교체한다. private 사용 목록과 검증을 한곳에서 관리한다. |

빈 함수처럼 보여도 의미가 있는 release, 취소, 권한 fence와 생존 증거는 삭제하지 않는다. 기능이 제거된 자원 quota와 현재 필요한 integrity/admission gate를 따로 분류한다.

삭제 기록은 대상, 실제 소비자, 삭제 근거, 함께 바뀐 설정·계약·테스트를 짧게 남긴다. 이 기록을 위해 runtime registry나 새로운 호환 계층을 만들지 않는다. 소스와 체크 파일에 과거 경로를 재수출하는 완료 형태는 허용하지 않는다.

## 모듈 단위와 저장소 배치

하나의 npm workspace 저장소와 하나의 lockfile을 사용한다. 루트는 개발 명령과 전체 검증을 조정하고, 제품 실행 조립은 `apps/oma`가 담당한다. 패키지는 같은 제품 버전으로 함께 배포하며, 독립 버전 출시나 네트워크 서비스로 전환하지 않는다.

기능 모듈은 아래 책임 단위로 나눈다. 단순 재수출이나 함수 하나만을 위한 패키지를 추가하지 않는다. 각 패키지 안에서는 필요한 만큼 파일을 나누며 파일 길이·패키지 개수 자체를 목표 지표로 사용하지 않는다.

| workspace | 소유 범위 | 주요 외부 의존성 또는 효과 |
|---|---|---|
| `@oma/contracts` | 공통 식별 타입, 현재 공개 DTO, operation·receipt·fact의 타입 | 실행 효과 없음. 구현 모듈 참조 없음 |
| `@oma/domain` | 순수 권한·계보·리뷰·식별자·오류·요청 정체성 규칙 | 파일·네트워크·프로세스·환경 읽기 없음 |
| `@oma/protocol` | 현재 wire codec, method descriptor, frame과 stream 형식 | DTO 변환과 검증. 소켓 소유 없음 |
| `@oma/broker` | 연결·peer 인증·run lease·요청 admission·dispatch·drain | native/process와 주입받은 ledger·기능 port. 구체 Store나 기능 구현을 생성하지 않음 |
| `@oma/native` | FD, peer credential, pidfd, flock, containment 등 OS primitive | `koffi`. 플랫폼별 entry를 분리 |
| `@oma/process` | subprocess 실행·종료 관찰·취소·deadline·cleanup | Node 프로세스 API와 필요한 native primitive |
| `@oma/storage` | SQLite, 트랜잭션, 장부, immutable file, journal·receipt 저장 | `node:sqlite`, filesystem, 필요한 native primitive |
| `@oma/config` | 현재 설정 로드·검증·generation 게시·적용 시점 | storage의 파일 API. DB 쓰기 소유 없음 |
| `@oma/mail` | 주소 라우팅, 메일 문서와 MIME, 배달·batch use case | `nodemailer`. DB·파일 효과는 주입받은 port 사용 |
| `@oma/git` | 제출·context·integration use case와 Git adapter | Git 명령, process, storage의 공개 파일 API. review 구현 import 없음 |
| `@oma/review` | open/review/vote/cancel/challenge, 정족수 입력·진행·상태 | 메일 기능과 주입받은 Git·ledger port |
| `@oma/lifecycle` | bootstrap·create·start·stop·society 실행 제어 | 메일 기능과 주입받은 workspace·unit·ledger port |
| `@oma/reconcile` | 시작·주기 복구의 순서와 현재 실행 상태 조정 | 주입받은 기능 port. 구체 Store·엔진 구현 import 없음 |
| `@oma/client` | 요청 고정·조회·전송·결과 표시, CLI 공통 client | Node 통신 API. 저장 구현은 port로 연결 |
| `@oma/engine` | Pi 실행·세션·이벤트·인증 relay·interactive adapter | Pi AI·coding-agent·Open TUI와 client/process |
| `@oma/tui` | 화면 모델·키 입력·렌더링·질문 UI·도구 표시 | Pi TUI primitive. 엔진 생성·DB·VM 접근 없음 |
| `@oma/tool-runtime` | 도구 등록 공통 계약·provenance·vendor 검증·contained writer | Node API, `typebox`, 필요한 엔진 확장 타입 |
| `@oma/tool-lsp` | LSP 도구와 해당 vendor payload | 해당 LSP 구현과 의존성 |
| `@oma/tool-hashline` | 앵커 읽기·편집과 해당 vendor payload | 해당 편집기 구현과 의존성 |
| `@oma/tool-web` | 웹 조사 도구와 해당 vendor payload | 해당 웹 구현과 의존성 |
| `@oma/tool-mcp` | MCP proxy와 해당 vendor payload | 해당 MCP SDK·transport 의존성 |
| `@oma/extension` | Society 핵심 도구·delivery와 도구 묶음의 조립 | client, tool-runtime, 도구 패키지. engine host·DB·TUI 구현 접근 없음 |
| `@oma/platform-linux` | systemd·bubblewrap·sandbox·guest OS adapter | native/process, systemd template와 C bridge 자산 |
| `@oma/platform-mac` | VM·Keychain·bookmark·host/guest 연결·project sync adapter | native/process, Git host API, Swift helper 자산 |
| `@oma/app` (`apps/oma`) | 실행 진입점, Broker와 host/guest use case 조립, 제품 설정 연결 | 필요한 모듈을 구체 구현에 연결하는 composition root |

`@oma/git` 내부의 workflow와 Git command adapter는 명시적인 subpath로 나눈다. 공용 entry를 import했다는 이유로 모든 명령 실행 코드를 평가하지 않는다. `@oma/storage`도 `/ledger`, `/files`, 플랫폼별 파일 adapter를 구분한다. 파일 유틸리티를 사용하는 것만으로 SQLite 연결을 열거나 Linux native 초기화를 수행하지 않는다.

각 패키지는 `package.json`, 명시적 `exports`, TypeScript 설정, `src`, 기능 테스트, 필요한 runtime 자산을 소유한다. 패키지 설명은 중앙 모듈 표와 기존 문서 체계에 연결한다. 기존 문서 정책에 반하는 복제 README를 패키지마다 만들지 않는다.

패키지 경로는 기본적으로 `packages/<이름>`을 사용한다. 패키지 로컬 테스트는 각 패키지에 두고, 여러 기능의 실제 연결과 설치물을 검증하는 테스트는 루트의 통합 테스트 영역에 둔다. 예를 들면 다음과 같다.

```text
apps/oma/                 제품 진입점과 조립
packages/client/          package.json, src, test, TypeScript 설정
packages/mail/            메일 기능과 그 테스트
packages/storage/         장부 구현과 schema 자산
packages/platform-linux/  Linux adapter, systemd template, C bridge 자산
test/                     여러 패키지와 최종 제품을 연결하는 검증
```

이동은 기존 디렉터리와 패키지의 일대일 대응을 전제하지 않는다. 현재 `GitModule`의 review 조립, platform 내부의 host/guest use case, engine 내부의 TUI 표현처럼 섞여 있는 책임은 먼저 실제 소비자와 effect owner를 기준으로 나눈다. 각 production 파일과 runtime 자산은 정확히 한 workspace에 속해야 하며, root `src`나 `implementation`에 기존 실행 구현을 병행해 남기지 않는다. `implementation`의 검증 지도·검토 기록은 실행 구현과 구분해 유지한다.

## 의존 방향과 공개 API

모든 패키지 간 의존은 명시한 공개 API를 통한다. type-only import도 의존 그래프에 포함한다. 같은 의미의 타입을 각 패키지에서 복사해서 순환을 숨기지 않는다.

| 소비자 | 허용하는 내부 의존 |
|---|---|
| contracts | 없음 |
| domain | contracts |
| protocol | contracts, domain |
| native | contracts, domain |
| process | contracts, domain, native |
| broker | contracts, domain, protocol, native, process |
| storage | contracts, domain, protocol, native, process |
| config | contracts, domain, protocol, native의 containment primitive, storage의 공개 파일 API |
| client | contracts, domain, protocol |
| mail | contracts, domain, protocol |
| git | contracts, domain, protocol, process, native, storage의 공개 파일 API |
| review, lifecycle | contracts, domain, protocol, mail |
| reconcile | contracts, domain, protocol |
| engine | contracts, domain, protocol, client, process |
| tui | contracts, domain, protocol |
| tool-runtime | contracts, domain, protocol, client |
| 개별 tool | contracts, domain, protocol, tool-runtime |
| extension | contracts, domain, protocol, client, tool-runtime, 개별 tool |
| platform-linux | contracts, domain, protocol, native, process, storage의 공개 파일 API |
| platform-mac | contracts, domain, protocol, native, process, git의 host API |
| app | 제품 조립에 필요한 위 패키지 |

외부 의존성은 실제 import하는 패키지의 manifest에 선언한다. 공통 개발 도구는 루트가 소유할 수 있다. Pi TUI를 쓰는 TUI 패키지는 Pi TUI를 직접 선언하고, runtime에서 Pi API를 사용하는 tool-runtime은 해당 runtime 의존을 직접 선언한다. 타입만 사용하는 외부 패키지는 declaration 소비 방식에 맞춰 의존 종류를 정하고 설치 검증으로 확인한다.

외부 dependency를 루트에 올려 두거나 다른 패키지의 transitive dependency를 직접 import하지 않는다. 정적 import뿐 아니라 literal dynamic import, `require`, `createRequire`, package-relative 자산 읽기도 검사한다. 해석할 수 없는 dynamic import는 실제 대상과 허용 범위를 명시하고 설치 artifact에서 검증한다.

`exports`에는 소비자가 실제로 사용하는 entry만 열고, 내부 모든 파일을 자동 공개하는 wildcard를 기본값으로 사용하지 않는다. 필수 runtime 의존, 외부 타입 노출, 선택 가능한 tool과 native 플랫폼 의존을 구별해 `dependencies`·`peerDependencies`·`optionalDependencies`를 정한다. peer 또는 optional 선언으로 필수 의존을 숨기지 않는다. 한 제품 안의 패키지 버전은 함께 맞추며 별도의 수동 버전 관리 절차를 만들지 않는다.

다음 우회는 허용하지 않는다.

- 다른 workspace의 `src` 또는 비공개 `dist`를 가리키는 상대 import.
- TypeScript `paths`, `NODE_PATH`, 루트 `node_modules` 또는 현재 작업 디렉터리에 기대는 숨은 해석.
- 모든 패키지를 다시 내보내는 공용 `core`, `common`, `utils` 패키지.
- 주입 컨테이너나 전역 registry에 구체 Store·Broker·엔진을 넣어 의존 검사를 피하는 방식.
- 공개 API가 `any`, 무제한 객체 bag, 임의의 SQL/명령 실행 callback을 받아 내부 권한 전체를 넘기는 방식.

순환 의존은 runtime과 type 그래프 모두 허용하지 않는다. 전이 의존을 포함한 실제 모듈 그래프를 검사한다. 위 표를 바꿀 때는 기능상 필요한 이유와 설치 범위의 변화를 기록하고 그래프·테스트를 함께 갱신한다.

### Port의 소유와 상호 호출

외부 효과를 요구하는 모듈이 필요한 최소 port를 소유한다. `Store` 전체를 주입하는 대신 조회·acceptance·게시·현재 권한 등 실제 필요한 행위를 노출한다. adapter는 app에서 연결하며, port 정의에 concrete class 타입을 끌어오지 않는다.

현재 review와 Git의 상호작용은 다음처럼 분리한다.

```text
review: 현재 리뷰 사실로 적용 가능 여부를 판정
git: 자신이 요구하는 synchronous authority port를 통해 마지막 판정 확인
app: review의 읽기 기능을 해당 port에 연결
git: 판정 직후 canonical CAS 수행
```

Git이 ReviewModule을 import하고 ReviewModule이 GitModule을 다시 import하는 구조는 만들지 않는다. 현재의 synchronous pre-CAS authority 의미를 유지한다. 반대로 같은 DTO를 다른 이름으로 포장해서 넘기는 데 그치는 adapter는 만들지 않는다.

## 저장과 실행 권한을 유지하는 조건

패키지 분리는 DB나 실행 프로세스의 수를 늘리지 않는다. Society당 브로커의 단일 쓰기 권한과 그 수명을 유지한다. `@oma/storage`는 검증된 쓰기 primitive를 제공하고, 각 use case의 acceptance 순서는 한 coordinator가 소유한다.

다음 조건은 개편 뒤에도 성립해야 한다.

1. 하나의 acceptance는 필요한 operation·agent·delivery·review 사실을 같은 동기 transaction에서 기록한다. 모듈별로 나눠 commit하지 않는다.
2. transaction 안에 Git, systemd, network, fsync, `await`를 넣지 않는다. transaction 객체를 범위 밖에서 다시 사용할 수 없다.
3. 같은 actor/key/payload는 원래 결과를 가리킨다. 같은 key의 다른 payload는 거부한다. 응답 유실 후 조회와 고정된 요청 재전송 규칙을 유지한다.
4. terminal 결과와 접수된 원본 바이트를 현재 설정으로 다시 만들지 않는다. unknown을 실패·부재·성공으로 축약하지 않는다.
5. Worker 실행은 실제 peer·현재 incarnation·run lease·cgroup·권한에 묶인다. Principal credential과 모델 credential 경계를 유지한다.
6. stop 요청과 실제 종료 증거를 구분한다. 이전 실행이 끝났다는 증거 없이 새 실행에 권한을 주지 않는다.
7. 메일의 준비·표시·확인 상태와 실제 작업 성공을 구분한다. 불확실한 배치는 재전달될 수 있으며, 완료에는 현재 형식의 정확한 영수증이 필요하다.
8. merge/challenge의 자기 승인 금지, 현재 승인 ID, 정책 revision, 기준/후보 커밋 결박과 CAS를 유지한다. `git.submit`과 직접 `code.integrate` 권한도 구별한다.
9. GOAL 게시·context snapshot·메일 공개와 Worker 활성화의 관계를 유지한다.
10. 모든 파일·socket·helper는 실제 소유 범위와 배포 경로에서 해석한다. 패키지 이동을 이유로 fallback 검색이나 ambient credential 상속을 추가하지 않는다.

## 엔진과 도구의 분리 조건

Pi와 관련한 private 멤버 접근, 명령 가로채기, Open TUI wrapping, 특정 버전과 문자열에 대한 의존은 `@oma/engine` 안에 둔다. app·domain·mail·review·lifecycle·reconcile이 Pi 내부 타입이나 필드에 직접 의존하지 않는다. TUI는 필요한 터미널 primitive와 데이터 계약만 사용한다.

엔진 adapter는 세션 시작·입력 접수·이벤트·delivery·취소·실제 종료를 구별하는 API를 제공한다. `close()` 호출을 프로세스 종료 완료로 반환하지 않는다. 버전 불일치와 실제 준비 실패는 명확히 드러낸다.

각 tool 패키지는 자기 vendor manifest, payload, dependency closure, 등록 도구 목록과 테스트를 소유한다. 도구 등록 전 무결성 검증, provenance, workspace 접근과 writer 직렬화를 유지한다. 다른 tool의 내부 파일을 import하지 않는다.

전체 제품의 기본 도구 구성은 유지한다. 개별 패키지의 build/test/install을 위해 다른 tool payload가 필요한 구조는 제거한다. 제품에서 어떤 tool을 선택하는가는 조립 지점에서 명시하고, 그 구성으로 tool surface를 만든다. 선택하지 않은 tool을 필수 registry에 남기거나, 선택했지만 로드에 실패한 tool을 조용히 빼지 않는다.

핵심 extension의 model-facing 경계는 유지한다. 공개 contracts/domain/protocol/client/tool-runtime 사용은 허용하되, engine host·app·SQLite writer·관리용 플랫폼 API를 전이 import하지 않는다. 독립성은 이름 목록뿐 아니라 실제 runtime closure로 확인한다.

## 빌드와 배포

빌드는 TypeScript project reference 또는 같은 효과의 명시적 dependency 순서로 수행한다. 패키지 빌드는 자신의 입력과 필요한 의존 closure만 사용한다. 다른 workspace의 소스를 자기 output에 몰래 함께 emit하지 않는다.

각 runtime 패키지는 빌드 artifact와 명시된 자산만으로 로드할 수 있어야 한다. 소스 checkout, 개발용 TypeScript loader, rootDir의 우연한 파일 배치가 필요하지 않아야 한다. 엔진이 TypeScript 확장 entry를 요구하는 자산은 예외 경로와 실행 의존을 manifest에 명시한다.

제품 조립은 하나의 배포 manifest를 생성한다. 이 manifest가 다음 경로의 기준이다.

- CLI·Broker·Runner·Personal·Principal·host·guest 진입점.
- schema, systemd template, sandbox 내부 CLI wrapper와 mount 대상.
- engine entry, core extension, 사용자 질문 extension과 개별 tool payload.
- Linux C bridge와 macOS Swift helper, 이미지·서명 관련 자산.

개편 후 `dist/src/...` 같은 옛 경로를 여러 곳에서 추측하지 않는다. systemd 렌더러, engine launch, sandbox path translation, native helper launch와 package verifier가 같은 manifest의 경로를 사용한다.

배포 해시와 vendor 해시는 실제 설치 artifact의 바이트와 자산 집합에 연결한다. 일반 npm workspace symlink는 개발 환경에서 사용할 수 있지만, 신뢰 경계를 검증하는 최종 배포물에는 기존 정책에 맞는 실제 파일 또는 명시적으로 검증되는 해석만 허용한다. 해시 검사를 꺼서 경로 전환을 통과시키지 않는다.

Personal은 시작 시 Society의 DB·브로커·Worker 실행 코드를 평가하지 않는다. Mac의 Personal도 VM 서비스와 token 읽기 없이 기존 로컬 실행 경로를 유지한다. 이 조건은 app의 동적 분기와 실제 로드 모듈을 관찰해 확인한다.

## 작업 순서와 단계별 결과

| 단계 | 수행 내용 | 다음 단계로 넘어가는 결과 |
|---|---|---|
| 기준 확인 | 현재 작업 트리, 실행 경로, 기능 시나리오, 의존 그래프, 기존 실패와 실행 가능한 환경 기록 | 현재 바이트에 결박된 기준. 이전 실행 기록의 숫자를 재사용하지 않음 |
| 레거시 제거 | 효과 없는 정책, 과거 형식, 별칭, facade, 불필요한 fallback과 전용 테스트를 함께 삭제 | 현재 동작만 설명하는 설정·타입·주석. 새 상태로 기능·복구 테스트 수행 |
| 기반 분리 | contracts/domain/protocol/native/process/storage/client/config를 나누고 공개 API 확정 | 순환·숨은 의존 검사와 패키지별 typecheck/build/test |
| 화면과 엔진 분리 | TUI, engine, tool-runtime, tool들, extension 분리 | 각 패키지 독립 설치와 tool 구성별 실행. private 접근이 engine에만 존재 |
| 업무 기능 분리 | mail/git/review/lifecycle/reconcile와 broker를 consumer port로 분리 | 하나의 acceptance와 기존 fault 시나리오 유지. 상호 callback으로 순환을 숨기지 않음 |
| 플랫폼과 제품 조립 | Linux/Mac adapter와 app 조립, runtime 자산과 manifest 갱신 | 설치 artifact에서 Personal/Society 및 host/guest 실행 |
| 이전 구조 제거 | 이전 src entry·import alias·build shim·중복 검사와 fixture 제거, 문서·CI·evidence 연결 갱신 | 새 경로만으로 전체 검증. compatibility 목록과 양쪽 구현이 남지 않음 |

단계 사이에 잠시 존재하는 내부 adapter에는 제거 단계와 소비자를 명시한다. 과도기 adapter는 최종 acceptance를 통과할 수 없다. 전체 구현을 복제해 신구 경로를 장기간 유지하지 않는다. 각 단계가 끝나면 실제 실행 경로가 어느 쪽인지 하나로 정리한다.

기존 작업 트리의 무관한 수정은 보존한다. 특히 개편과 별개인 화면 문구나 사용자 기능 변경을 예전 값으로 되돌리지 않는다. 구현 단계에서 형식 불일치 검증에 사용하는 이전 상태는 격리 fixture로 만든다.

## 검증과 완료 기준

다음 검사는 새 구조의 완료 조건이다. 아래 제안 명령은 구현 시 추가할 인터페이스이며 현재 존재하거나 통과했다는 뜻이 아니다. 기존 `check:*`·verification lane은 필요한 의미를 유지하며 새 패키지와 자산 경로로 갱신한다.

| 검사 | 통과 조건 |
|---|---|
| `npm ci`와 전체 `build`, `typecheck` | clean checkout과 lockfile로 재현된다. 이전 output 없이 현재 패키지만 빌드된다. |
| `npm run check:modules` | manifest 누락 의존, 비공개 import, 역방향 의존, runtime/type 순환이 없다. |
| `npm run check:legacy` | 승인된 제거 대상의 실행 코드·필드·alias·fallback·전용 유지 테스트가 없다. 합법적인 같은 빌드 이력과 복구를 금지하는 단어 검색으로 대체하지 않는다. |
| 패키지별 `build`, `typecheck`, `test` | 명시된 의존 closure만 준비한 환경에서 수행된다. 테스트가 다른 패키지의 private 구현을 import하지 않는다. |
| `npm run check:package-isolation` | workspace를 pack해 외부 임시 디렉터리에 설치한 뒤 공개 API와 자산을 검증한다. checkout, 상위 node_modules, NODE_PATH, 개발 loader 없이 통과한다. |
| `npm run check:package` | 최종 제품의 entry·schema·template·native helper·vendor payload·manifest·해시가 일치한다. |
| 기능 시나리오 | Personal 시작/재개, Society 시작/GOAL, 메일 왕복, Worker 생성/재개/정지, 코드 제출, LOW/MEDIUM/HIGH merge, challenge, 새 세션과 설정 적용이 유지된다. |
| 실패 시나리오 | 동일 key 재시도·다른 payload 거부, 응답 유실, 준비/접수/게시/CAS/결과 기록 사이 강제 종료, 늦은 영수증, 권한 취소와 실제 종료 확인이 유지된다. |
| 실제 플랫폼 실행 | Linux systemd·cgroup·bubblewrap, 터미널 복구, Mac VM 시작/attach/종료, project import/export, credential relay를 해당 실제 환경에서 검증한다. mock 또는 scripted provider 결과와 구별한다. |
| 문서와 검증 입력 | 경로·규범 owner·생산 파일·배포·의존 그래프·시험 목록이 현재 구조를 가리킨다. 실제 실행하지 않은 결과를 새 PASS로 만들지 않는다. |

격리 설치 검사는 패키지의 현재 npm manifest와 lockfile이 만드는 실제 배포 closure를 사용한다. workspace 의존은 해당 버전의 packed artifact로 연결한다. 단순 root workspace 실행 성공은 독립 설치 증거로 세지 않는다.

의존성 검사의 negative fixture는 최소한 숨은 transitive import, type-only 순환, dynamic import를 통한 내부 파일 접근, 누락된 자산, TUI에서 SQLite writer 로드, extension에서 host 관리 코드 로드를 실제로 거부해야 한다. package manifest만 읽어 이 검사를 통과시킬 수 없다.

현재 의미가 사라진 옛 경로 문자열 검사·compatibility fixture는 제거한다. 현재 API의 오류·권한·복구 동작을 검증하는 테스트는 단지 소스 이동 때문에 제거하지 않는다. source-text 검사가 필요한 구조 규칙은 AST 또는 실제 모듈 해석으로 확인하고, 동작 검증을 문자열 일치로 대체하지 않는다.

플랫폼이 없어서 실행하지 못한 검사는 `NOT_RUN`과 이유를 보고한다. skip, 미실행, 과거 evidence를 PASS에 포함하지 않는다. 구조 검사 통과와 runtime 검증 통과를 별도로 보고한다. 필수 실제 플랫폼 검사가 남아 있으면 개편 전체를 완료로 표시하지 않는다.

## 변경 범위와 비용의 확인

개편 전후 같은 시나리오로 아래 항목을 기록한다. 절대적인 파일 수·LOC 감축률이나 새로 측정하지 않은 속도 향상을 완료 조건으로 만들지 않는다.

- 웹 도구만 변경했을 때 영향받는 package build/test closure.
- TUI 문구·렌더링만 변경했을 때 필요한 검증과 실제 로드 모듈.
- 리뷰 정족수 규칙 변경 시 수정하는 의미 owner와 재검증 범위.
- 전체 clean build, 패키지 한 개 변경 후 build/test, Personal/Society 시작의 시간과 환경.
- 삭제한 runtime 호환 경로, 사용하지 않는 config 필드, 외부 엔진 private 접점과 직접 의존 목록.

웹 도구 변경에 무관한 SQLite·lifecycle 단위 검증이 패키지 로컬 작업의 필수 조건이 되거나, TUI 패키지 검증에 브로커·VM이 필요하면 경계가 잘못된 것이다. 전체 배포와 통합 검증은 별도로 계속 수행한다. runtime entry별 actual import closure로 불필요한 로드가 추가되지 않았는지 확인한다.

## 최종 산출물

- 과거 개발 형식을 읽는 코드와 옛 import 경로가 없는 현재 구현.
- 패키지별 공개 API, 직접 의존, 빌드·테스트와 자산을 가진 workspace.
- app에 집중된 제품 조립과 한 Society의 일관된 저장·실행 권한.
- 실제 설치물로 확인한 runtime entry·vendor/native 자산·배포 manifest.
- 바뀐 구조를 반영한 문서·CI·검증 지도와 현재 바이트에 대한 실행 결과.
- 삭제 항목과 남은 private engine 접점, 실제 측정값과 `NOT_RUN`을 구분한 최종 보고.

패키지 개수나 예상 품질 점수는 이 결과를 대신하지 않는다. 새로운 기능 없이도 필요한 변경을 더 적은 코드와 명시된 의존만으로 수행할 수 있고, 기존 정확성·복구 검증이 유지되는 상태를 완료로 판단한다.

