# 검증 기록 원문 — 2026-10-02 정리 전

아래 내용은 정리 전 작업 트리의 역사적 기록이다. 당시 current/active/PASS/NOT_RUN 표현과 수치가 현재 판정이나 실행 지시를 뜻하지 않는다. 현재 상태와 재개점은 [문서 지도](../README.md)에서 찾는다. 기존 기록을 삭제하지 않고 이곳에 보존했다.

# OMA v2 — 현재 검증 상태

이 파일이 현재 검증 판정, 시험 수·LOC 같은 수치, 알려진 한계, 재검증 명령의 단일 owner다. 다른 문서에는 수치나 PASS 표를 적지 않는다([문서 지도](../README.md)).

- **현재 source 판정**: 현재 작업 트리의 검증 입력 결박과 실행 상태. 과거 v22 증거는 별도로 구분한다.
- **알려진 한계**: 지금 제품이 하지 않거나 증명하지 않은 것과 보류한 결정.
- **기본 재검증, 환경별 lane**: 다시 돌리는 명령.
- **LOC 측정, release gate, 보존하는 규범**: 크기 제한 폐지와 남은 환경 검증·VAL 조항.

무엇을 왜 바꿨는지는 결정 기록(consistency-decisions, design-revisions)과 점검 기록(priority-0-audit)에 있다. 과거의 감사 기록과 중간 실행은 [docs/archive.md](../archive.md)가 가리키는 snapshot에 있다.

## 현재 source 판정

2026-10-02, **DR27/28/29 IN PROGRESS / release-blocked**. 현재 source는 A/B의 trusted candidate executor·tiered defaults·Principal raw RPC/동적 도구 제한, F1 host project/bookmark identity와 locked Personal first seed, F2 양방향 saved-history bridge를 포함한다. 전체 구현·현재 전체 suite·native macOS 완료를 주장하지 않는다. 아래 과거 전체 시험은 당시 source의 증거다.

| 요구 | 실제 구현과 정상/실패 oracle | 현재 판정·남은 것 |
|---|---|---|
| A tier/floor/checks | `runtime/candidate-checks`, GitModule callback와 broker 조립; candidate-checks·tiered-integration·tier-evaluator·integration-revalidation | 코드/fixture 검증. reviewer shortage 예외는 미구현/별도 거절에 따른 차단 상태. 실제 manager/cgroup candidate 검사도 별도 거절로 NOT_RUN. mutation/실환경 proof 미완료 |
| B Principal | `principalRequestAllowed`, PublicDispatcher, tool-surface와 workspace-guard; principal-stop-fence·tool-surface·실제 Pi의 loopback functional scenario | 제한적 source/runtime 회귀 통과. 다른 도구의 권한은 Principal routine 권한으로 승격하지 않음 |
| C 독립 clone/최초 snapshot/Config/수량 | `lifecycle/workspace`의 `clone --no-local`, raw worktree snapshot, Initial workers commit, 생성 quota와 inference slots; project-snapshot·worker-autonomy·settings-apply-time | SHA1/SHA256/dirty bytes·손상 거절·설정 0 및 재시작 회귀 확인. unit 설치는 scripted; manager proof 아님 |
| D closed/개별 stopped | `lifecycle/society`, actions와 reconcile activation gate; society-control·worker-autonomy·r25-lifecycle-owners | closed 재열기와 terminal replay·개별 stopped·현재 incarnation 회귀 확인. fake units를 실제 manager 증거로 취급하지 않음 |
| E 시간값·선택 mail | PiAdapter/PrincipalDelivery, selector alarm, egress placeholder alarm; delivery-deadlines·egress-observation-deadlines·r25-lifecycle-owners·f3-log-frame | 전체 TypeScript native timer/phase-budget call sites 분류. model/tool 전체 실행 deadline 없음. 긴 selector/egress waits의 native clamp 수정. 종료 grace는 writer exit proof가 아님 |
| F1 Mac seed | host-record project UUID/bookmark/root, bundled Git/helper, existing settings writer의 async seed; mac-project-seed·personal-settings·platform-host-service | absent binding은 빈 seed, unknown은 거절. bound project의 첫 seed에는 이미 실행 중인 app/guest가 필요함. Swift bookmark helper NOT_BUILT/NOT_RUN |
| F2 history | guest/host canonical identity·read-only paged preview·one private duplex channel·actual outgoing exit·post-cleanup host reread; host-history·guest-history·actual local PTY holder·composition/ownership | Linux의 로컬 실제 file/socket/PTY와 controlled process 경계 회귀 확인. remote 검색은 title/첫 메시지 preview 범위. native Mac/actual systemd holder 시작은 NOT_RUN |
| G 기록 | source owners, stale byte-review 철회, LOC/graph/ledger/trace/current digest | current owner/ledger/trace/LOC/graph 갱신 완료. static gate PASS; inventory/ledger 생성은 runtime proof와 독립 검증이 아님 |

최근 로그(서로 겹치는 범위이며 합산한 고유 시험 수가 아님):
- `/tmp/oma-handoff-core-v3-20261001.log`: 217 PASS; A/B source·integration/권한 중심, 후속 F1/F2 이전 source.
- `/tmp/oma-handoff-pi-scenarios-20261001.log`: 9 PASS; 실제 Pi + fake loopback provider의 tool/goal/society control.
- `/tmp/oma-handoff-f1-v2-20261002.log`: 165 PASS; F1·Personal settings·host composition/프로젝트 관측.
- `/tmp/oma-handoff-f2-v4-20261002.log`: 148 PASS; F2 첫 방향과 F1/selector 최신 빌드의 집중 실행.
- `/tmp/oma-handoff-reverse-tests-v2-20261002.log`: 176 PASS; 양방향 private-history·strict handoff·controlled host/guest ownership.
- `/tmp/oma-handoff-reverse-tests-v3-20261002.log`: 283 중 282 PASS / 1 FAIL. directory reply의 기존 동기성 fixture 실패이며 성공으로 취급하지 않음.
- `/tmp/oma-handoff-reverse-tests-v4-20261002.log`: 116 PASS; 위 fixture 수정, actual source의 grace 이후 writer exit/거절, selector, egress long-deadline/cleanup.
- `/tmp/oma-handoff-f2-cde-20261002.log`: 77 PASS; actual local holder↔host history·real Git snapshot·closed/Worker 설정·선택 mail 회귀.
- `/tmp/oma-handoff-layer-tests-20261002.log`: 142 PASS; guest settings 상향 UI import 제거 뒤 project identity/seed, sync·async settings, contract declarations, parent/selector/engine ownership 회귀.
- `/tmp/oma-handoff-static-v5-20261002.log`: source inventory, rule modules, measured architecture, transactions, durable boundaries, document integrity 모두 PASS. 이전 static-v2/v3/v4 실패 로그는 보존한다. Shared Personal commit boundary의 등록을 실제 publication owner로 옮겼으며 기존 retry/contended writer 및 새 failed async observation oracle를 연결했다.
- LOC: cloc 2.08, production 354 files / 35,832 code lines (`/tmp/oma-handoff-loc-v4-20261002.log`). LOC는 상한·runtime proof가 아니다. graph: `/tmp/oma-handoff-graph-v4-20261002.log`.
- review ledger 생성: `/tmp/oma-handoff-ledger-v2-20261002.log`, NOT_REVIEWED 213 / READ_UNCHANGED 41 / CHANGED_WITH_ORACLE 100 / REMOVED 1. Stale byte-bound review 3건을 철회했고 실제 전체를 읽고 관련 oracle를 확인한 작은 owner 8개만 DR29 author review로 결박했다. 이 수치는 독립 리뷰 완료가 아니다.
- trace inventory: `/tmp/oma-handoff-trace-v3-20261002.log`, 371 normative clauses, 현재 모두 unverified. 동일 fingerprint와 동일 owner만 종전 record를 유지했고 새/변경 owner는 unverified로 남겼다. hash 갱신을 새 source proof로 바꾸지 않았다.

시간 감사 범위: RPC·UI/metadata는 phase/observation budget, Pi model/compaction은 progress가 있는 silence budget, announced tool은 자체 수명, Principal mail은 acceptance/retry spacing이며 총 turn 상한이 아니다. native command builder는 timer-safe validation, Git preparation은 고정 process budget, cgroup candidate는 frozen check runtime+manager stop/drain, status snapshot은 timeout≠empty truth, broker retry/UI keys/poll은 고정 owner timer다. VM phase의 fixed handshake/health/drain와 guest freeze의 ceiling은 model deadline이 아니다. `HostTenure.end`의 bounded quit은 상속된 fence를 보존하지만 새 history 전환은 outgoing `PrincipalSession.exited`를 별도로 기다린다. Swift/C helper에는 별도 model timeout을 추가하지 않았다.

미실행: native Mac VZ/Keychain/APFS 및 Swift build; 기존 거절의 실제 systemd service probe·중단 VM ownership retry·reviewer shortage exception probe·실제 isolated-HOME/unshare Kiro. 거절된 파일/aggregate suite를 우회해 실행하지 않았다. 전체 npm test와 kernel/powercut lane도 실행하지 않았다. native 환경과 기존 독립 거절을 제외한 검증 범위를 완료한 뒤에도 전체 release 판정은 별도로 남는다.

### DR22/24/25 당시 실행 기록 (현재 DR27 아님)

2026-09-29, DR22(원본 Pi InteractiveMode + pi-open-tui), DR24(시작마다 새 세션, `/new`·`/resume`, 사용자 전체 엔진 home, 프로젝트 설정, 한 줄 model·effort 선택)와 DR25(`oma pi install`로 설치한 Pi 패키지를 역할별로 선택·영구 저장) 작업 트리다. DR23의 다음-society 분리는 DR24로 대체됐다. DR21 자체 renderer는 원복했고 아래 DR21 결과는 폐기된 구현의 역사적 증거일 뿐이다. release는 미승인이다.

집중 회귀(sessions·config-screen·model-effort·interactive-input·engine-inference-chain·config·tui·open-tui·pi-runtime 등)와 구성 정책 29/29 PASS, 새 시나리오 SCN-X02(Worker가 엔진 목록에서 고른 model·effort `scripted-thinking`·`high`가 다음 activation 요청에 실림)와 SCN-X01 PASS, 구조 gate(inventory·rules·architecture·transactions·boundaries·documents)·package·ledger·traceability PASS. 새 역변이 9개(`--thinking` 누락, runner의 effort 누락, Worker transform의 effort 누락·이전 effort 유지, effort 목록 규칙, 엔진 기본 effort 누락, effort 검증 제거, Dashboard 엔진 모델 행)는 모두 KILLED다. 설치된 `oma`를 실제 PTY와 로컬 가짜 provider로 실행해 Config의 Principal model 한 줄에서 model 목록→effort 목록을 한 번에 고르고(엔진 기본값 `fake/scripted-2`·`high` 저장, 다음 요청이 그 model·effort로 나감), Worker model에서 "Same as the Principal"/직접 선택을 저장하고, 새 시작에서 둘 다 유지되며 `~/.pi`가 생기지 않음을 확인했다. 실제 provider·전원 차단·CI·macOS는 실행하지 않았다.

이어서 oma가 엔진(Pi)의 제품처럼 보이거나 따로 설치된 Pi와 얽히지 않게 했다(DR24 "Not the engine's product"): 터미널 제목 `oma[ - 세션 이름] - 프로젝트`, `/export` 기본 `oma-session-<id>.html`을 Human 프로젝트에 저장(상대 경로도 프로젝트 기준), 확장 충돌 안내는 Ctrl+X > Config > Extensions, `/bug`(세션을 엔진 개발자에게 업로드)와 `/import`(다른 곳의 세션 파일을 대화로 가져옴) 거부. 새 시험은 엔진 자신의 경로 parser와 충돌 안내 문구에 맞춰 검사하고, 역변이 6개는 모두 KILLED다. 설치된 `oma` PTY에서 제목 OSC가 `oma - project`, `oma - Alpha - project`뿐이고 `π`가 없음, 명령 목록에 `/bug`·`/import`가 없고 입력하면 oma 안내가 나옴, `/export` 파일이 프로젝트에 생김, `/resume`의 현재/전체 범위 모두 이 프로젝트의 oma 세션만 보이고 격리 HOME의 `~/.pi` 기록과 엔진 home 기본 세션 폴더에 심은 기록은 보이지 않음을 확인했다.

DR25: `oma pi install|remove|update|list`는 동봉 엔진의 package manager를 oma 패키지 저장소(`<data>/oma/.packages`)에 실행하고, 설치한 패키지의 extension은 Config > Extensions의 Principal/Workers 열로 선택해 프로젝트 설정(관리 bundle)에 영구 저장한다. 새 시험: pi-packages(명령 차단 규칙, 로더의 `packages:` 항목과 저장소 밖·link 거절, 엔진 resolver 기반 index와 재작성, 역할 참조 재조정, inline→bundle 변환이 모든 durability 지점의 crash에서 완전한 이전/새 설정만 남김, 세션 파생과 영구 저장, 사라진 파일은 세션에서 빼고 보고, 사용자 Pi 환경 변수 차단), pi-packages-cli(127.0.0.1 registry로 설치·자동 켜기·list·remove·`-l` 거절, `~/.pi` 미생성), resident-confinement(저장소 읽기 전용 mount와 엔진 경로, 선언 없으면 거절), SCN-X03(Worker 엔진이 확장을 불러와 그 tool이 모델 요청에 DIRECT로 실림), SCN-C10(bwrap sandbox Worker가 `/opt/oma-packages`에서 확장을 불러오고, 저장소는 읽기 전용이며 엔진 home은 mount되지 않음). 역변이 21개 모두 KILLED. 설치된 `oma` PTY에서 `oma pi install` 후 `/hello-ext`가 동작하고 Principal 모델 요청에 `hello_ext` tool이 실림, Extensions 화면에 `npm:oma-hello-ext · extensions/hello.ts` [x][x], Workers 끔이 다음 시작에도 유지, `oma pi remove` 뒤 행과 역할 참조가 사라짐을 확인했다. macOS(2026-09-30): Mac의 `oma pi install … [--project <id>]`가 Human의 terminal에서 동봉 엔진 package manager를 Mac 저장소(`~/Library/Application Support/OMA/packages`)에 돌리고, `omahostd`가 Host API `packages.sync`로 저장소 전체를 닫힌 형식(디렉터리·일반 파일만)으로 선언된 stream에 실어 guest에 보내며, guest의 `packages.replace`가 선언과 같은지 확인한 뒤 Linux와 같은 `oma pi` 코드로 저장소를 새 generation(현재 link)으로 바꾸고 모든 project 역할을 맞춘다. 새 시험 platform-packages(archive 내용과 9가지 거절, 실제 host service·guest 서비스를 통한 `packages.sync`와 같은 key 재요청, generation 보존·수거, 선언과 다른 stage 거절, link 저장소의 고정 경로·mount, 네 단계 각각에서 멈춘 뒤 재실행이 중단 없는 실행과 같은 끝, 127.0.0.1 registry로 Mac `oma pi install --project` 전 과정)와 link 저장소의 SCN-C10. 맥 쪽 역변이 11개 모두 KILLED. 실제 Mac(Virtualization.framework, app bundle의 Node·npm)에서는 실행하지 않았다.

전체 `npm test` 첫 실행은 2,019/2,021 PASS, 2 FAIL(exit 1, 792,703 ms; 로그 `full-dr24.log`)이었다. 두 실패는 모두 P2 계약 고정 시험이었다: DR24가 `ModelProfile`에 선택 필드 `thinking?: EffortLevel`과 `EffortLevel`을 더했는데 검토된 계약 변경으로 기록하지 않았다. contracts README에 검토된 변경으로 기록하고, IPC-008과 같은 방식으로 시험이 정확히 이 두 추가만 투영해 제외하게 했다(golden은 재생성하지 않음). 투영 뒤에도 `host.ts`의 다른 변경(필드 선택화, `thinking` 필수화, 수준 이름 변경)은 모두 KILLED다. 재실행은 2,021/2,021 PASS(exit 0, 794,995 ms; 로그 `full-dr24-2.log`)였다. 위 엔진 정체성 변경 뒤 전체 실행은 2,024/2,024 PASS(exit 0, 794,174 ms; 로그 `full-dr24-3.log`)였다. DR25 뒤 첫 전체 실행은 2,034/2,036 PASS, 2 FAIL(exit 1, 810,686 ms; 로그 `full-dr25.log`)이었다. 두 실패는 고정된 내부 포트 선언(P17/P23, P2)이 `SandboxHost`에 더한 `packages?`를 모른 것이며, DR18 D-8이 `SandboxDirectories`에 한 것처럼 그 선언 하나와 그 파일의 digest 하나만 지금 선언대로 갱신했다(두 줄). 재실행은 2,036/2,036 PASS(exit 0, 810,552 ms; 로그 `full-dr25-2.log`)였다. macOS 작업 뒤 전체 실행 **2,044/2,044 PASS**(exit 0, fail/cancelled/skipped/todo 0, 820,249 ms; 로그 `full-mac.log`). 실행 전후 검증 입력 751개 파일의 SHA-256이 모두 같았다(`mac-tested-inputs.json`). 아래 digest는 그 시험한 트리에 이 결과 문장만 더해 다시 결박한 것이며, 마지막 문서 bytes에서 전체 실행을 다시 돌렸다고 주장하지 않는다. fast/durable lane은 이번에 실행하지 않았다.

현재 입력 결박은 실행 전 갱신하며 그 자체는 PASS 증거가 아니다. verification input digest `a680c5d855ec94d139d01a6e3392973874a5a5f2732b14bd595a49cd5303896f` (883 files). 최종 결과는 검증 완료 후 갱신한다. 로그: 세션 scratchpad의 `full-dr24.log`, `full-dr24-2.log`, `focused.log`, `verify-models.out`, `mutant.log`, `cmut.log`.

## DR21 철회된 구현의 과거 증거

다음 결과와 digest는 원복 이전 자체 renderer에만 해당한다.

2026-09-29, branch `feat/macos-hidden-vm`, HEAD `649ea6e` + 미커밋 작업 트리. DR21 TUI 재설계를 구현했다. 대화·Ctrl+X 관리 화면 공통 테마, 구조화 transcript, compact tool/stream, thinking 내용 제외·활동 표시, 기존 engine RPC의 모델·사용량·컨텍스트 관측, 오프라인 preview와 시나리오/PTY 회귀를 추가했다. 전체 `npm test` **2,002/2,002 PASS**(773757.332563 ms), fast **328/328 PASS**, durable **654/654 PASS**다. 모두 exit 0, fail/cancelled/skipped/todo 0이다. build/package·typecheck·architecture·transaction·durable-boundary·document gate도 통과했다. 실제 provider·power-loss·CI·macOS 검증은 보류하며 release 미승인이다.

실행 입력은 `c4e739dbb79c31f0de7424ab3eccfe33fa5f4ab3c4d27f52f66121d915c5d6f3`(727 files)이며 전체·fast·durable 실행 전후 파일별 SHA-256이 모두 같았다. 아래 결과를 기록하면서 이 validation 문서만 변경한 뒤 현재 digest를 재결박하고 기록·구조 검사를 재실행한다. 마지막 문서 bytes에서 전체 lane을 다시 돌렸다고 주장하지 않는다.

집중 회귀 **190/190 PASS**: 실제 PrincipalSession/engine과 fake provider를 사용해 text delta·최종 snapshot, thinking의 활동 표시와 중간 프레임/기록 본문 비노출, tool 성공·실패, 추가 5회 재시도 후 복구·소진을 검사했다. 조회 직렬화·중복/늦은 응답·시간 초과·compaction·쓰기 전 종료의 정확히 한 번 미전송 반환, 한글/emoji·ANSI 주입·좁은 화면·history anchor·NO_COLOR와 실제 앱 PTY의 입력·resize·복원도 포함한다. thinking 필터 제거, 도구 실패의 성공 승격, ANSI sanitize 생략, tool update를 append로 바꾸는 네 역변이는 모두 assertion-KILLED다. 생산 renderer의 오프라인 conversation/config 프레임을 이미지로 변환해 시각 점검했다(실제 터미널 스크린샷이나 macOS 증거가 아님).

초기 실패도 보존한다. 실제 엔진 시나리오가 동시 RPC write 충돌과 Pi 0.87.1 JSON 스트림에서 message 필드가 생략되는 차이를 찾아 session의 단일 write 경계와 assistantMessageEvent allowlist로 고쳤다. 첫 전체 실행은 2,000 PASS / 2 FAIL(2002 tests, 774767.724745 ms, exit 1)이었으며 새 End 동작을 반영하지 않은 SS3 기대값과 실행 전 validation digest 미갱신이 원인이었다. 관련 회귀를 먼저 통과시킨 뒤 위 전체·lane을 재실행했다. 첫 실행 전후에도 입력 bytes 변경은 없었다.

로그는 세션 scratchpad `/tmp/claude-1001/-home-dev-oma-v2/9ba58572-1708-4d64-b456-477ff9f48f38/scratchpad`의 `tui-r2-full.log`, `tui-r2-tested-inputs.json`, `tui-r2-{fast,durable}/result.json`, `tui-regression.log`, `tui-r2-focused.log`, `tui-mutants.json`, `tui-mutant-*.log`다. 첫 전체 실패는 `tui-full.log`와 `tui-tested-inputs.json`에 남아 있다. 결과 기록 뒤 검사는 `tui-record-gates.log`, `tui-record-tests.log`에 남긴다.

DR21 당시 기록 digest(현재 아님): `39c5d533165817cc5a4a87083928d5eb53604b883da839b1c2111d81f8bd42ec` (727 files).

## DR20 로컬 실행 증거

2026-09-28, branch `feat/macos-hidden-vm`, HEAD `649ea6e` + 미커밋 작업 트리. DR20으로 LOC 크기 제한을 폐지했고 더미 중단·복구 시험을 정식 local/durable에 연결했다. 변경 후 전체 `npm test` **1,985/1,985 PASS**(762575.875717 ms), durable **646/646 PASS**, 별도 `verify:powercut:simulation` **9/9 PASS**다. 모두 exit 0이고 fail/cancelled/skipped/todo는 0이다. build/package도 통과했다. 집중 회귀 47/47과 typecheck·architecture·transaction·durable-boundary·document gate도 통과했다. 실제 provider·power-loss·CI·macOS 환경 검증은 보류하고 release는 미승인으로 유지한다.

더미 시험은 임시 SQLite의 accepted mail, immutable bytes, 생산 MailModule의 복구 및 같은 key 재호출을 검사한다. fixture 연결을 닫고 다시 여는 논리적 중단이므로 갑작스러운 프로세스 종료나 저장 장치의 전원 상실을 증명하지 않는다. 실제 SIGKILL은 기존 crash lane의 별도 증거다. UNKNOWN 승격·recovery 실패 무시·simulation을 powerLossProven으로 승격하는 세 변이는 모두 assertion-KILLED였다. 일반 CLI 거부 시험은 OMA_POWERCUT_ACK를 비워 host/VM 재부팅을 승인하지 않는다.

전체·durable·별도 simulation 실행 입력은 `6d76e1772127b011325d3bc89a872ae0258bc79fcc2bd449a0df0b6e22d9b738`(720개 파일)이며 세 실행 전후 파일별 SHA-256이 모두 같았다. 이전 전체 시험과 비교하면 검증 입력 18개가 바뀌었고 production `src/` 변경은 없다. 목록은 scratchpad의 `dr20-input-delta.json`에 있다. 이전 kernel/crash 결과는 아래 별도 입력의 증거이며 이번 문서·검증 도구 변경까지 재실행했다고 주장하지 않는다. 결과 기록 이후에는 이 validation 문서만 검증 입력에서 달라지며 digest를 재결박하고 관련 기록 회귀와 구조 gate를 재실행한다.

실행 로그는 위 세션 scratchpad의 `dr20-full-test.log`, `dr20-tested-inputs.json`, `dr20-durable/result.json`, `dr20-simulation.log`, `dr20-focused.log`, `dr20-mutant-{unknown-promoted,recovery-ignored,simulation-promoted}.log`다. 더미 시험 최초 실행의 fixture inbox 경로 오류(8 PASS/1 FAIL)는 실제 fixture의 inbox parent를 사용하도록 고친 뒤 통과했다. LOC 회귀는 실제 pinned cloc로 10,000행 초과 fixture도 SOURCE_BOUND가 되는 것과 일관되게 위조한 수치도 거절되는 것을 함께 검사한다.

당시 기록 digest: `2edaeef9eaf8bcac0cf6e695a3a129ceda4bb65f824b0f5b1fdb6d72b39f7aed` (720 files). 현재 TUI 변경의 증거가 아니다.

## DR20 이전 로컬·환경 실행 증거

2026-09-28, branch `feat/macos-hidden-vm`, HEAD `649ea6e` + 미커밋 작업 트리. 전체 `npm test`는 **1,979/1,979 PASS**, fail/cancelled/skipped/todo 모두 0, exit 0, duration 758713.548074 ms였다. build/package 검사도 같은 명령에서 통과했다. release는 미승인이다.

전체 실행 입력 해시는 `7b8a4148b1c33bb01a2ec79ce0916f6ff3ff1d057b7c9d2d72db209692edef21`(720개 파일)이며 실행 전후 파일별 SHA-256이 모두 같았다. 결과를 기록한 `validation.md`만 달라진 입력 `17b07602ac58453b6c7782d139f642b36e3b7cc5c11fe214fe1a6a806728ff21`에서 fast·durable·property·stress·platform과 일회용 omatest 사본의 kernel·crash를 실행했다. kernel 첫 실행이 찾은 stale oracle은 격리 사본의 `test/phase4.test.ts`만 수정하여 kernel 전체 재실행과 역변이로 검증한 뒤 원본에 같은 bytes로 반영했다. 해당 시험 SHA-256은 `3cef76d1abeeea11928ee96fd47d64517a1253261baee5a5712e786365ca9b64`다. kernel 재실행 입력은 `d39095dba8d65671a2b7c43b3beee902e012835e82a8ebd0dbf09b994d6c2612`이며 최초 kernel 입력과 이 시험 하나만 다르다.

당시 기록 digest는 `cbb7be17daebdb3aeb6d9afeb3ad371dad060dc5b9a2b190ef6e7aa574ef7bda`였다. DR20 이전 기록 시점에는 전체 `npm test` 이후 검증 입력 변경이 `validation.md`와 로컬 suite에서 제외되는 systemd 전용 `test/phase4.test.ts`뿐이다. production·script·설정·generated artifact는 바꾸지 않았다. 최종 시험 반영 뒤 build·typecheck·architecture gate는 PASS(exit 0), production-inventory/document-integrity/review-closure 시험은 18/18 PASS(exit 0, fail/cancelled/skipped/todo 0)였다. 이 결과 문구를 기록한 뒤 digest를 다시 결박하고 같은 구조·문서 검사를 재실행했다. 모든 lane을 마지막 문서 bytes에서 재실행했다고 주장하지 않는다.

실행 로그: 세션 scratchpad `/tmp/claude-1001/-home-dev-oma-v2/9ba58572-1708-4d64-b456-477ff9f48f38/scratchpad`의 `final-full-test.log`, `final-tested-inputs.json`, `final-{fast,durable,property,stress,platform}/result.json`, `final-record-{gates,tests}.log`와 `final-closure-{gates,tests}.log`. systemd 증거는 `/home/omatest/oma-evidence/adversarial-final-649ea6e-20260928/`의 `kernel`, `crash`, `kernel-r2` 및 `kernel-incarnation-mutant.log`다. 사본은 credential/data/review 없이 새 디렉터리에 만들었고 기존 omatest 트리는 덮어쓰지 않았다. focused/변이 결과는 「7차 검토 수정 검증」에 기록했다. 현재 digest 자체는 PASS나 환경 lane의 실행 증거가 아니다.

위 실행은 DR20의 문서·도구·시험 변경 이전 증거다. 현재 입력 결박은 이 문서 첫 절이 소유한다.

## 과거 v22 통합 증거

아래 v22 증거는 리뷰 기준점 `070a52d`까지의 과거 트리다. P0V-102–P0V-127 수정 및 DR19가 들어간 현재 트리에 그 PASS를 승계하지 않는다.


브랜치 `feat/macos-hidden-vm`, 통합 검증 트리의 부모 `db4f558`, 실행일 2026-09-28. 이 브랜치의 작업을 한 트리로 결박한 결과다. 작업은 consistency plan(WP00–WP32), 재검토와 적대적 검증(AV1–AV8), 엔진 0.87.1(ENG1), 실제 provider 기능 점검(1–14차, AV9–AV31), 설계 수정(DR1–DR18), Priority 0 점검(코드 P0V-01–P0V-101, 문서·식별자 P0D-01–P0D-14), 모델만 대본인 시나리오 시험(SCN), macOS hidden-VM 플랫폼(macos-platform, DR18로 수용)이다. 무엇을 왜 바꿨는지는 결정 기록([consistency-decisions](../implementation/consistency-decisions.md), [design-revisions](../design-revisions.md))과 점검 기록([priority-0-audit](../priority-0-audit.md))에 있고, 이 절은 이 트리에서 실제로 돈 것만 적는다. 판정: 로컬·platform·kernel·crash lane은 모두 PASS이고, release는 미승인이다(powercut·provider 자동 lane·CI·mac-* lane NOT_RUN, A-008 OPEN). wire·DB schema·receipt 형식은 v1 그대로다. receipt의 adapter revision만 ENG1에서 `oma-pi-rpc-v1@0.87.1`이 되었다. 권한 의미가 바뀐 것은 AV18과 DR4다. 엔진 이벤트 framing의 예외 하나(DR15)가 있다. architecture.md는 N-001이 결박한 bytes 그대로이며, 어긋나는 문장은 design-revisions에 있다.

당시 입력 해시: `8e7ccfc61a2a9ac58b97626c59a1947c39b800d39cefff1161482109ac88bd7e`, 당시 708개 파일. 현재 입력 결박과 혼동하지 않는다.

### 실행 결과

#### 종합

| 검사 | 결과와 범위 |
|---|---|
| type/build/package/local and lanes | PASS on engine 0.87.1: fast/durable/property/stress/platform 326/626/34/12/82, local 1910/1910, package; all fail/cancelled/skipped/todo=0 (`v22-initial`, `db4f558`). kernel 64/64과 crash 63/63 PASS on the disposable user manager(T38·SEQ-002 필수). durable은 실제 엔진 AV14(엔진 종료를 기다린 뒤 뒷정리)·V27A(영수증 게시·검증까지)·T116·T117·AV16, pty V28B, 설치 closure V31A, AV9–AV30, DR1·DR3·DR4·DR6·DR7 회귀, Priority 0의 DR9–DR13·P0V 회귀(durable requiredNames 22개), 4차 점검 회귀 `p0-review4`(requiredNames 3개), 모델만 대본인 시나리오 시험 54개(requiredNames 11개)를 포함한다. property는 DR9의 V30A(late는 verified, early는 conflicting), fast는 문서 무결성(`check:documents`와 negative control 셋)·V29A·V31B·V32A·AV3·AV5 규칙·AV9·AV12·AV31 wiring·runtime-contracts·T118과 P0-7 gate(`check:boundaries`와 그 negative control)를 포함한다. local은 AV31 신호 시험·DR8, P0V-18(Control Panel exit)·P0V-22·P0V-23·P0V-24 회귀를 포함한다. metadata-bound final rerun required v22에서 더한 것: durable에 6차 점검 회귀 `p0-review6`·crash-kill 경계(P0V-96·97)·S-05 hostile bundle·DR18 판정 시험, platform lane(macOS 배포본의 Node 코드, vsock loopback의 bridge 포함). |
| Review ledger | production 파일 224개: 변경이 닿은 141개는 그 변경의 회귀 시험(DR·P0V 카드 포함), 읽고 바꾸지 않은 83개는 그 모듈을 적재하는 시험(`review-notes.json`), 제거 1개(`src/git/context-mirror.ts`, P0V-17). NOT_REVIEWED 0. P0V만 붙은 커밋이 바꾼 파일도 변경으로 센다(원장 도구가 P0V ID와 범위를 읽는다) |
| Release 판정 | release 미승인: 모든 production 파일 검토 완료(NOT_REVIEWED 0), powercut·실제 provider·CI NOT_RUN(V05C·V30B·V32B) — 모두 사용자 승인 필요 |
| NOT_RUN과 OPEN | provider: 자동 lane NOT_RUN(아래 실제 provider 점검은 수동 기능 증거이며 lane 증거가 아니다); powercut·CI NOT_RUN; A-008 당시 OPEN(현재는 DR20으로 크기 제한 폐지) |

#### 계획 카드(WP00–WP32)

| 검사 | 결과와 범위 |
|---|---|
| 이 표에 없는 카드 | WP00–WP07, WP11–WP14, WP16–WP22, WP24의 oracle은 `implementation/oracle-map.json`이 담당 시험과 lane에 대응시키고, 위 lane 결과가 결박한다. 카드별 결정과 남긴 한계는 consistency-decisions와 이 문서의 "알려진 한계"에 있다 |
| V08A | Principal의 complete가 영수증 뒤에 실패하면 다음 tick은 엔진 전달 없이 complete만 다시 한다(엔진 전달 1회, complete 2회, 영수증 bytes 불변, backoff 유지). complete 단계의 BATCH_CONFLICT는 backoff하는 실패이고, 세션 claim 경쟁만 backoff 없는 보류다 |
| V08B | busy 세션이나 다른 세션에서도 검증된 영수증은 첫 영수증의 sessionPath로 정산되고 새 턴을 시작하지 않는다. 영수증이 conflicting/unavailable이면 전달도 완료도 없이 증거를 보존한다. 전달 도중 다른 곳에서 먼저 게시된 영수증이 있으면 그 첫 영수증으로 완료한다 |
| WP08 negative controls | mutant 6개 모두 실패: 영수증 확인 없이 전달, unavailable/conflicting을 absent로, 모든 BATCH_CONFLICT를 세션 경쟁으로, busy 세션이 정산도 막음, 새 boundary의 sessionPath로 완료, backoff 제거(시험이 끝나지 않음) |
| V09A | 실제 PrincipalSession과 scripted 엔진: 수락 응답이 없는 전달 명령은 세션을 계속 소유하고, 그동안 입력한 Human prompt는 쓰이지 않고 기다리며, 늦은 수락과 settle 뒤에만 쓰인다 |
| V09B | 엔진 종료(SIGKILL)와 명시적 quit 모두에서 쓰이지 않은 대기 입력 3개가 순서대로 정확히 한 번 돌아오고, 쓰였지만 답이 없던 입력은 unconfirmed로 따로 알려지며 다시 보내지지 않는다. 쓰기 시작 뒤 실패한 전송은 미전송으로 돌려주지 않고 세션을 풀지 않는다. 쓰기 전 거절(실제 전송로가 표시한 것)만 미전송으로 돌려주고 나머지 대기 입력은 계속 간다 |
| V09C | 세션이 끝난 뒤의 settle은 아무것도 시작하지 않는다. 제품은 엔진마다 callback을 그 엔진에 묶는다(한 프로세스는 엔진을 하나만 시작한다) |
| WP09 negative controls | mutant 6개 중 4개 실패: 전달 소유자의 timeout 해제, 종료 때 대기 입력 버림, 수락 불명 입력을 미전송으로, 쓰기 시작 뒤 실패를 미전송으로. 생존 2개는 등가 mutant: 종료 뒤 free 가드와 한 번만 반환 플래그는 종료·close가 이미 대기열과 미응답을 비운 뒤라 관측 차이가 없다 |
| V10A | 실제 subprocess: 이벤트가 계속되는 2.5초 턴은 유휴 한도 1초를 넘어도 끝나고, 정말 조용한 엔진은 유휴 한도에서 유휴로, 턴 한도를 넘는 턴은 턴 시한으로, 응답 없는 명령은 수락 시한으로 각각 다른 결과로 끝난다 |
| V10B | 기존 R37/R17: native 준비 결과가 불명이면 shutdown은 Store와 lock을 풀지 않고 termination을 요구하며, 만료된 handoff는 성공이 아니다(로컬 실제 프로세스). 실제 Resident 안 엔진 descendant 죽음 증명은 WP30 |
| V10C | 40일 budget은 즉시 만료되지 않고 overflow 경고도 없으며 취소는 최종이다. 모든 전달 결과 뒤 timer가 남지 않는다. broker A의 늦은 credential은 broker B 뒤에 엔진에 부여되지 않고, 늦은 거절은 B의 등록을 지우지 않는다 |
| WP10 negative controls | mutant 6개 모두 실패: 유휴 시한 재무장 안 함, 턴 시한을 유휴 시한으로, 종료 시 취소 누락, native timer 하나로 전체 budget, generation 확인 제거, 수락 뒤에도 수락 시한 유지 |
| WP08–WP10 not covered | 실제 Pi 엔진·provider에서의 긴 턴과 수락 지연, Principal 엔진 SIGKILL 뒤 실제 사용자 흐름(WP28 pty), runner stop의 엔진 descendant 종료 증명(WP30) |
| V15A | 관측된 등록부로 bootstrap 상태를 판정하고(관측 없음은 unknown), bootstrap 뒤 seed 필드와 seed 없는 bootstrap profile은 이유와 함께 막히며 writer도 거절하고 아무것도 쓰지 않는다. bootstrap profile 편집은 seed만 바꾸고 agent profile(childProfile 등)은 바꾸지 않는다. 같은 값 저장은 분할 bundle과 inline 모두 쓰지 않고 unchanged로 알린다. 다시 읽기 실패 뒤에는 저장됨·미확인으로 알리고 옛 값을 현재값으로 보이지 않는다 |
| V15B | dashboard는 Principal 모델을 설정값으로, 실행 중 세션이 시작될 때의 값과 구분해 보여 주며 어느 것도 엔진이 실제로 쓰는 모델이라고 표시하지 않는다 |
| WP15 negative controls | mutant 7개 모두 실패: bootstrap 뒤에도 편집 허용, seed 없을 때 필드 숨김, writer가 차단 무시, 같은 값도 쓰기, 설정값을 현재 모델로 표시, 다시 읽기 실패 뒤 옛 값 표시, unknown을 pending으로 |
| WP23.01 measurement | 실제 user manager(systemd 257, 64 agent, 동시 status.get 16 + mail.send 4): 수정 전(`1f6c31e`) 이벤트 루프 최대 정지 10 098 ms(읽기)/10 143 ms(mutation 포함), status.get p50/p95 5 558/10 097 ms, mail.send 최대 639 ms, pending 620개에서 status 한 번 3 886 ms 정지. 수정 뒤 16/38 ms, 267/286 ms, 48 ms, 10 ms. `systemctl show` p50은 1 unit 8.5 ms, 32 unit 59.8 ms, 128 unit 212.9 ms |
| V23A | stress(적합한 비용 모형 6.9 ms + 1.61 ms/unit): 읽기만 할 때 정지 < 50 ms, mutation과 함께 < 100 ms(mail.send 자체의 fsync 20–45 ms 포함), status.get p95 < 1 s, 동시에 실행되는 관측 명령 ≤ 1, 동시 16 호출에 refresh 하나와 follow-up 하나, 동기 systemctl 0 ms. pending 620개에서 정지 < 50 ms. 응답 없는 manager: 답은 2 s budget 안에 unit 필드 null(추측 없음)과 물은 시각으로 오고, 명령은 자기 옆에 다시 시작되지 않으며 manager가 돌아오면 회복한다. 관측 실패: 등록부 행과 pending 수는 그대로 답하고 unit 필드는 null, 게시된 view도 같다 |
| V23B | kernel: 실제 batched 관측이 멈춘 unit a를 inactive로 본 뒤 unit이 실제로 시작된다. 표시는 본 것과 그 시각을 유지하고, confirmDead는 false, manager의 start는 RUN_TERMINATION_UNKNOWN(incarnation 불변), 다음 refresh는 active를 본다. 캐시된 inactive를 죽음 증명으로 쓰는 대조는 살아 있는 run에 대한 행동을 허가했을 것이다 |
| WP23.02/03 unit oracles | fast: 실행 중 refresh 동안의 호출자 10명은 그 뒤에 시작하는 follow-up 하나를 공유하고 답은 질문보다 오래되지 않는다. 멈춘 관측은 각 호출자에게 budget과 timeout을 주고 다시 시작되지 않는다. show 출력은 Id로 unit에 묶이고(순서 불신) 32개씩 나뉘며, 반복·누락·남의·손상 block은 그 agent만 unknown. 전체 사회 projection은 seed 수열 24단계 동안 agent별 pendingWork와 정확히 같고, 손상 5종(manifest 반복·누락, 미래 incarnation, prepared batch 안의 presented delivery, 이중 계산)을 똑같이 거절한다. 이름 projection은 식별자가 아닌 이름을 거절한다 |
| WP23 negative controls | mutant 11개 중 10개 실패: refresh 안의 agent별 동기 show, 호출자마다 refresh, budget 제거(시험이 끝나지 않음), 실행 중 refresh 합류(질문보다 오래된 답), manifest/link 검사 생략, 미래 incarnation 수용, 관측 안 된 unit을 inactive로 표시, status.get을 답한 시각으로 표시, 이름 식별자 검사 생략, 반복 block 신뢰. 생존 1개는 등가: 표시 projection의 이중 계산 guard는 PK·batch 열 하나·manifest decode 때문에 도달할 수 없다 |
| WP23 not covered | storage admission 트리 스캔(admit마다 새로 하는 정확성 검사, D04/WP22 소유)과 mutation마다의 world view 갱신(64 agent에서 4–6 ms)은 바꾸거나 부하 측정하지 않았다. `src/diagnostics/*`는 SCOPE_ONLY. 256 agent 상한은 모형 기준 budget 진술이며 실제 256 unit 측정은 하지 않았다 |
| V25A | kernel: incarnation 1 때 수락되고 확인되지 않은 start와 stop은 incarnation 2가 열린 뒤 reconcile로도 같은 키 재시도로도 효과가 없다(start는 멈춘 unit을 시작하지 않고, stop은 실행 중 run의 InvocationID를 바꾸지 않음). 둘 다 unknown이고 incarnation·desired는 그대로다. 현재 명시적 stop은 성공하고 `confirmDead(a,2)` |
| WP25.02 (T36, historical; classification superseded by DR27/P0-5) | 당시 kernel: systemd 257에서 restart 예산 소진은 failed/exit-code로만 남는다. `startLimitStatus`는 NRestarts≥StartLimitBurst로 이를 start_limit으로 보고하고, reset 없는 start는 START_LIMIT으로 거절되며 한도를 풀지 않는다(v2/v3의 kernel 59/60 원인) |
| WP25.03 | fast: 실제 runner entry에 현재 profile과 다른 accepted 자원을 주면 workspace·/tmp·check 한도는 accepted 값이고 모델은 현재 profile 값이다. 자원 env가 없거나 hex가 아니거나 빈 객체·필드 누락·범위 밖·추가 필드·순서가 다른 JSON이면 exit 4로 거절한다. kernel: 설치된 unit의 Environment와 MemoryMax/TasksMax가 현재 profile이 아닌 accepted spec이다 |
| V25B | 기존 oracle로 연결: SEQ-002(runtime-contracts: path·revoke 실패 뒤에도 나머지 stop 단계를 모두 시도하고 결과는 RUN_TERMINATION_UNKNOWN), T38(확인 안 된 stale cgroup은 start를 막고 incarnation 불변), phase4 SEQ-002(옛 run 죽음 불명이면 startup이 메일 정산 전에 멈춤), R37 shutdown(native 결과 불명이면 Store·lock 유지). revoke 뒤 pin은 다음 begin이 비었음을 증명할 때까지 유지 |
| WP25 negative controls | mutant 10개 모두 실패: start-limit 판별 3개(v2 기록 뒤 WP25에서 실행), currentIntent에서 incarnation 제거, reconcile이 옛 plan의 previousIncarnation을 현재 값으로 보정, runner가 workspace 또는 /tmp 한도를 현재 profile에서 읽음, 자원 env 없을 때 현재 profile로 fallback, 비정규 자원 텍스트 수용, unit이 현재 profile을 렌더 |
| WP25 not covered | 실제 Resident 안 엔진 descendant 죽음과 broker 손실·재시작 간격의 전체 kernel 결합(WP30), systemd-managed broker topology의 운영 지원(WP31), WP03 이전에 렌더된 Resident unit의 자동 재렌더(없음; 재생성 필요, WP31 지원표), Principal 세션의 workspace 한도 출처(WP28) |
| WP26 inventory | `implementation/consistency-decisions.md` WP26 절: frame·byte queue·jsonl·channel·response/receipt/request codec·methods·log response·batch view·host channel·credential·run lease·status view·connection·replies·CLI transport/arguments/intent/cache/request service/effects/commands 각각의 신뢰 경계, 예산, 관계, 성공 의미. 권한은 dispatch 때 다시 읽고 await 너머로 저장하지 않으며 resource category는 내부 descriptor에 있다 |
| V26B | R08 조회 시나리오 11개(pending/unknown/terminal/success/SPIKE/명시적 not-found 두 형태만 재전송, 조회 불가·손상 not-found·null·operation 있는 not-found는 재전송 없음)에 더해: 답을 못 받은 `send`는 증명된 REQUEST_NOT_FOUND 뒤에만, 원본 파일이 바뀐 뒤에도 처음 동결한 body로 재전송하고, 수락된 뒤에는 조회만 한다. 정착된 영수증은 뒤늦은 pending 관측으로 바뀌지 않는다. cache가 기록하지 못한 영수증은 영수증과 `--request` key를 보여 주고 영수증의 exit로 끝나며, cache의 이전 관측과 모순되면 exit 3(수정 전 코드에서 실패) |
| V26A/V26C | V26A: R14(모든 header 분할, fatal 뒤 재동기화 없음, 연결 끊김은 dispatch된 작업을 보존하고 대기 요청만 취소, backpressure, half-close), R15 channel generation, P0 malformed frame. V26C: 실제 BrokerChannel에서 요청과 응답 한도는 UTF-8 bytes 기준(문자 수는 맞고 bytes가 넘으면 쓰기 전 거절, 정확히 맞으면 통과), 한도를 넘은 응답은 결과가 아닌 FRAME_TOO_LARGE, 다른 id·모르는 envelope/result 필드는 이 호출의 결과가 아님. R15 response codec, F3/F4, P2 wire golden 유지 |
| WP26 negative controls | mutant 6개 모두 실패: cache가 기록 못 한 영수증에서 CLI 종료(현재 코드로 재실행), 모든 조회 실패를 not-found로, 같은 key 재시도에서 현재 원본으로 재구성, 늦은 pending이 정착 영수증 대체, lock open 실패를 raw 오류로, 요청 예산을 문자 수로 |
| V27A | 실제 동봉 엔진(지금 0.87.1, ENG1), 생성된 rootfs, adapter 자신의 격리 계획, placeholder relay, Anthropic 한 턴을 답하는 TLS 대역: `PiAdapter.deliver`가 경계를 반환하고 세션 파일은 제시된 batch(custom_message oma-mail), `stop`으로 끝난 assistant 메시지, 통지된 entryId와 같은 id의 경계 항목을 그 순서로 가진다. provider는 batch와 실제 key를 봤다. 수정 전 계획(`bwrap`)에서 실패 |
| V27B | 바꿀 문자가 없는 key(서명이 `_-`뿐인 token, 구분자뿐인 key, 긴 구두점 segment)는 즉시 UNSUPPORTED_PROFILE(수정 전 코드는 스택 초과), 제공자가 쓰는 모양은 길이가 같고 key와 다르며 key를 포함하지 않는 placeholder. relay는 provider 답을 오는 대로 넘긴다(첫 bytes가 마지막보다 1초 이상 먼저), T114(키 교체, 경로 제한, 응답 없는 provider는 재전송 없이 504, 동시성 초과는 503, 안전하지 않은 설정 거절) |
| WP27 negative controls | mutant 4개 모두 실패: placeholder 무한 재시도, 격리 계획이 bwrap을 PATH 이름으로, relay가 답 전체를 모은 뒤 전송, 경계 통지가 세션에 없는 항목을 가리킴 |
| WP26/WP27 not covered | 실제 provider 자동 lane(NOT_RUN; 수동 기능 점검은 1–14차에서 함). provider 쪽 재시도·긴 stream은 엔진이 소유한다(INF-001), 전원 차단 뒤 세션 파일 내구성(WP30), Principal 엔진과 host channel·credential 전체 경로(WP28), 한 key에 대한 동시 CLI 프로세스(`receipt-supersession.test.mjs` 범위 밖). 저장소에 별도 engine lane이 없어 V27A는 durable lane에서 bubblewrap·openssl로 실행된다 |
| V28A | 실제 app과 실제 Maildir: Dashboard는 `N건 Principal 세션에 전달 대기`, 목록은 ●의 뜻과 여는 것이 전달·확인이 아님을 말한다. 관측이 없으면 unknown(이유), 설정 모델은 실행 세션 값과 구분. 메일을 열어도 new/·cur/·mtime 불변 |
| V28B | 실제 pty(python pty + 제품 openTerminal·KeyDecoder): 정상 종료, restore 없는 exit, 터미널 연 뒤 reject 모두 echo·line mode 복원, 복원 뒤 다시 raw·alternate로 들어가지 않음. 코드 포인트 중간에서 쪼개진 입력은 한 key, resize 반영. 이전 코드는 뒤의 두 종료에서 실패 |
| WP28 negative controls | mutant 3개 모두 실패: exit 때 복원 없음, 전달 대기를 unread로, 목록 범례 제거. oma entry의 최상위 catch 정리 순서는 oracle 없음(코드 검토, exit hook이 복원을 보장) |
| V29A | fast: exit 소유 규칙은 직접 호출·참조·element access·destructuring(이름 변경 포함)·globalThis.process·`node:process` named/default import 8가지를 모두 잡고(이전 규칙은 5가지를 놓침), `app.exit()`·`obj.process.exit()`·문자열·주석·`process.env`는 허용한다. set-field recipe에 모르는 method, 없는 field, 배열이 아닌 field를 넣은 실제 TS Program은 각각 컴파일 오류(P22 방식). 기존 P10–P23 oracle 유지 |
| V29B / WP29 scope table | `implementation/consistency-decisions.md` WP29 절: 닫힌 vocabulary(type), brand(type provenance, 이후 관계·일회성·crash 뒤 보장 아님), readonly(type/shallow), decoder(runtime), 권한(효과 시점 runtime), 정적 규칙(source 분석, data flow 밖), owner map·traceability(inventory, 증명 아님), lane requiredNames(실행 증거, 요구사항 포괄 아님), kernel 사실, 전원 차단 내구성(미증명). production-valid config fixture는 실제 loader를 통과하고(V02A), CLI cache 시험은 batch receipt 복구 증거가 아니며, spawn-plan 단위 시험은 argv만 증명한다 |
| WP29 negative controls | 이전 exit 소유 규칙은 V29A alias 사례에서 실패, 느슨한 recipe 타입은 오타를 컴파일한다. 현재 source에는 새 finding 없음 |
| V30A | property: D01 결정표와 DR9로 쓴 독립 모형으로 실제 Store·Mail·영수증·broker 재시작 뒤 `Broker.openRun`을 24 seed × 8 사건에 교차 실행한다. 사건은 7종이다: 게시, 손상, 늦은 이전 시도 영수증(DR9: 재전달 없이 verified), 구간 밖 이른 영수증(conflicting), 가림, 드러냄, 열기. 마지막에 읽을 수 있게 하고 한 번 더 연다(liveness). batch row는 다시 쓰지 않는다. WP30 때의 mutant 3개(읽을 수 없음을 absent로, 충돌을 absent로, 정산 없이 rollover)는 모두 실패했다. DR9 뒤에는 다시 돌리지 않았고, DR9 자체의 변이는 'P0 mutants' 행에 있다 |
| WP30 fault matrix / qualification | FAULT-MATRIX 32행을 oracle에 대응(rollover 뒤 endpoint bind 실패만 commit 실패와 따로 주입되지 않음). node/git-fs·engine·pty·kernel·crash PASS, powercut·실제 provider·CI NOT_RUN. 카드별 mutant 집계는 consistency-decisions WP30 절 |
| V31A | 설치 closure(dist, schema, unit template, package.json, lockfile의 production 모듈)를 새 prefix로 복사하고 원본 트리로의 모듈 해석·파일 읽기를 모두 거절한 채: `check:package` 통과, 자산 해석, 자기 엔진 `--version`(지금 0.87.1, ENG1), broker·runner·host·CLI entry가 usage 검사까지 로드. 엔진 없는 설치본은 옆에 다른 설치본 엔진이 있어도 UNSUPPORTED_PROFILE(이전 탐색은 그것을 씀) |
| V31B | lockfile 루트의 의존성 종류가 package.json과 같고 production closure에 dev 표시가 없음(이전 lockfile은 실패). package check는 빠진 unit template, 빠진 entry, lock과 다른 의존성 버전을 명시 실패. lockfile 재동기화는 버전 변경 0, 추가·제거 0, dev 표시 160개 해제 |
| V32A | fast: 생성된 review ledger가 현재·기준선 production 파일 모두를 한 번씩 담고, 검토 표시는 작업과 실제 존재하는 시험 oracle을 가진다. 근거 없는 검토 표시, 없는 oracle, 빠진 파일, 손으로 고친 요약은 finding. 미검토 파일이나 NOT_RUN lane이 있으면 승인 거부, 모두 검토·통과일 때만 승인 |
| Oracle closure | V32A: 계획 oracle 73개 모두 자기 ID 시험, 또는 실행 lane(fast/durable/property/stress/kernel/crash)이 요구하는 담당 시험(`implementation/oracle-map.json`), 또는 NOT_RUN(V05C power loss, V30B powercut/provider, V32B CI). 담당이 시험이 아니거나 어떤 lane도 요구하지 않거나 대응이 빠지면 finding |

#### 재검토와 적대적 검증(AV1–AV8)

| 검사 | 결과와 범위 |
|---|---|
| Adversarial mutants (earlier cards) | WP04–WP06, WP11, WP12, WP17–WP22, WP24의 guard를 하나씩 최소 복원한 mutant 30개(일회용 계정): 20개 즉시 실패. 생존 10개 중 9개는 시험 공백, 1개(WP11)는 등가. 공백 9개 중 8개에 oracle 추가(V05A fsync 관측, V06A 디렉터리 EACCES·완료 incarnation/세션, V12B 단일 파일 1 MiB, V12A 완료 전 변경, V18A 교체된 root 보존, V24A 복구 CAS 경합) 뒤 재실행에서 실패. 한 파일 읽기 도중 변경은 결정적 재현 불가 경합으로 코드 검토 근거 |
| Counterexamples | actor socket 연결 폭주: 연결마다 broker socket·pidfd, 상한 없음 → `ACTOR_CONNECTIONS` 16, V26A(400 연결 중 16 이하만 처리, 끝나면 호출 응답; 상한 없는 listener는 실패). relay 유휴 연결 → 동시성 × 4, V27B. 시계를 되돌리면 앞선 날짜의 status view가 현재로 보임 → 새로고침 주기 넘게 앞서면 unknown, T118. 메일·엔진 출력의 터미널 제어 문자 주입은 반증(모든 줄이 displayable을 거침) |
| AV1 | INV04·INV09·CLI-001, durable: CLI가 선언되지 않은 옵션·중복 옵션을 거부하고 옵션 값은 그대로, `--` 뒤는 위치 인자. 확장 도구는 기록된 반례(to에 `--file <host 파일>`, `--kind approval_required` 주입, 임의 reply 경로, 문법 밖 request key)를 CLI 시작 전에 거부하고 broker에는 아무 frame도 가지 않음. 확장 문법 거울이 wire 문법과 같음(INV04 동치 시험) |
| AV2 | INF-007(INF-005 위), durable: placeholder는 authority header(값 전체 또는 `Bearer <p>`)와 `key` query에만 진짜 키로 바뀌고 그 밖(path, 다른 header·query)에 있으면 403. 응답 상태줄·header·본문(청크 경계 포함)에 키가 있으면 sandbox에 닿기 전에 끊김(failed로 한 번 집계), 압축 거부(accept-encoding identity, WebSocket 확장 제거) |
| AV3 | PR-003·PR-004·FS-003·INV04·INV09, fast: Principal 모델 작업공간은 `principal/private/workspace`(provisioning이 만듦, local T114)이고 CLI home도 같은 scratch(FS-003). 작업공간은 세션 이력·엔진 설정/credential 디렉터리·batch view와 어느 방향으로도 겹치지 않고, 작업공간 guard가 세션 파일 read/write/edit를 막음. 겹치는 배치(예전 Principal 배치, credential 디렉터리 포함, Resident 반대 방향)는 엔진 시작 전 UNSUPPORTED_PROFILE |
| AV4 | INV03·FS-005·SB-006, durable: receipt의 session 파일은 세션 디렉터리 아래에서 링크를 따라가지 않는 한 번의 해석으로 찾음(검사 뒤 경로 교체 함정에서 바깥 파일을 받지 않음, 링크 구성요소는 session-invalid). agent가 provisioning을 떠난 뒤(준비 완료가 기록된 사실)의 create 복구는 그 기록을 쓰고 workspace에서 git을 실행하거나 workspace를 걷지 않음 |
| AV5 | FS-005(architecture §4)·INV09, fast/durable: `state-tree-held-parent` 규칙이 src의 경로 기반 fs 변경을 primitive·held parent·descriptor·이유가 적힌 트리 밖 소유자 외에서 거부하고 실제 트리에서 0건. transport spool은 봉인 뒤 staging 경로가 바뀌어도 자기가 해시한 바이트를 읽고 자기 파일만 지움. 잔여: quarantine 스크립트는 private mount namespace 안에서 경로 사용 |
| AV6 | INV02·INV10·INV06, durable: pidfd `poll`의 EINTR은 최대 8회 다시 묻고 끝내 대답이 없으면 failed(exited 아님), POLLNVAL은 failed(EBADF), POLLIN/POLLHUP만 exited. 권한은 대답된 running에서만 유지. fd를 소진해 `/proc`을 읽을 수 없는 프로세스에서 Principal 엔진은 그 순간 응답에서 빠지지만 등록은 retire되지 않고, 엔진이 실제로 죽으면 ended로 retire. 발견 경위: v11 첫 kernel lane 실패 → 부하 반복 재현(약 20회 중 1회) → 거부 순간 EINTR 포착. 수정 뒤 같은 부하 반복 60/60 통과(보조 증거). 잔여: 관측하지 못한 권한의 거부를 CAPABILITY_DENIED로 보고 |
| AV7 | INV02·INV03·arch §23.5, durable: journal 기록이 빠진 커밋은 다음 커밋이 manifest의 직전 generation으로 되써서 수거가 직전 generation을 남김. journal을 읽을 수 없으면 generation을 하나도 지우지 않고 staging만 치움. 현재 generation의 기록이 빠지면 마지막 기록과 기록되지 않은 generation을 남기고 그 이전 기록만 수거. 읽을 수 없는 기존 generation은 '다른 bytes'가 아니라 그 오류(EACCES)로 보고. 볼 수 없는 저장 용량 루트는 BROKER_UNAVAILABLE(0이 아님). 목록을 읽을 수 없는 Principal 메일함은 대시보드에 unknown, 메일 화면에 '일부를 읽지 못함'과 읽은 메일. 잔여: journal이 계속 읽히지 않으면 예산 한도가 재시작으로 풀리지 않음, 기록이 연속 두 번 빠지면 직전 generation을 잃을 수 있음 |
| AV8 | FS-005·INV10·INV12, durable: CLI가 받은 파일(`--file`, `--reply`)은 링크면 따르지 않고 거부, 정규 파일이 아니면(`/dev/zero`) 거부, 요청 frame보다 크면 거부하며 어느 경우도 broker에 frame이 가지 않음. 정규 파일은 본문으로 전송(대조군). WP26 inventory를 코드가 지키는 내용으로 정정 |
| AV mutants | 최소 복원 mutant 41개(일회용 계정): 40개 실패. AV7 9개와 AV8 4개도 모두 실패. AV6 7개(EINTR을 종료로, 다시 묻지 않음, 무한 재시도, POLLNVAL을 종료로, 읽을 수 없는 /proc을 종료로, 모든 /proc 실패를 종료로, 관측 못 한 엔진에 retire) 모두 실패. 생존 1개는 AV1 slot 검증 아래 등가(주소를 `--` 앞에 두어도 같은 파싱). 원칙 재정렬 뒤 AV3·AV4 mutant 6개(범위 검사 제거, 엔진 credential 미보호, CLI home이 scratch 밖, 예전 작업공간, 기록된 준비 완료를 다시 도출, 정산된 workspace를 걸음)를 다시 실행해 모두 실패. 첫 실행의 AV4 함정 오조준과 컴파일 안 되는 mutant 하나는 고쳐 다시 실행해 실패 확인. 단위 회귀가 없는 것: `CreateCoordinator`가 기록된 사실을 `WorkspaceCoordinator.ensure`에 넘기는 연결(kernel lane의 create 복구가 실행) |

#### 엔진 0.87.1(ENG1)

| 검사 | 결과와 범위 |
|---|---|
| ENG1 | 엔진 0.87.1(사용자 요청), durable/local: V27A(동봉 엔진, 제품 격리 계획, 기록된 경계까지 배치 전달), T116(엔진이 OMA 소유 agent 디렉터리에서 credential 해석, 자리표시자에서 진짜 key로 provider 도달), T117(격리된 Resident는 relay로만 provider 도달, trusted extension 적재와 mail custom message), V31A/V31B·package check(설치본이 자기 엔진을 실행, lock과 설치 일치). PI_ADAPTER_REVISION·BATCH-006 `oma-pi-rpc-v1@0.87.1`, BATCH-006 trace 행은 재inventory되어 unverified. 잔여: 0.85.1 adapter의 미정산 영수증은 업그레이드 뒤 conflicting(기존 society는 정산 뒤 업그레이드), 이 변경과 무관한 조항의 기존 trace drift는 그대로 둠 |

#### 실제 provider 기능 점검 1–13차(AV9–AV31)

| 검사 | 결과와 범위 |
|---|---|
| Provider functional runs | 실제 provider(동봉 엔진 0.87.1, gpt-6-luna, 사용자 승인)로 test society 11회: runs 1–5에서 AV9–AV18, 6차 AV20–AV23, 7차 AV24–AV25, 8차 AV26, 9차 AV27–AV30, 12차 AV31, 13차 DR8을 찾았고 각 수정 뒤 재실행으로 확인(`/home/dev/oma-evidence/provider/runs`, 상태는 `archive/`). 이것은 수동 기능 증거이며 provider lane의 자동 실행은 아래 행대로 NOT_RUN |
| AV9–AV19 | unit 없음 관측, 알림 subject·/inbox.md, Principal 도구, reset-failed, sandbox shell, 세션 재개, 표시 이름, sandbox `oma`, 격리 영수증 session 경로(V27A가 영수증 게시·검증까지), 기본 위임 권한 보유, rootfs 경쟁(T115 15/15). 회귀 시험은 lane requiredNames에 있음 |
| AV20–AV23 | REC-002 주기 대조 4개(주기·drain 대기·systemd 모드 제외·timer unit과 같은 간격), runner 재연결(kernel lane), same-key key 안내 2개, 본문 디코드 2개(pinned writer의 두 인코딩에 결박) |
| AV24–AV26 | 도구 실행 중 idle 보류 2개(V10A 불변), 엔진 자신의 edit 도구 입력으로 guard 결박, Human Mail 화면 2개(CRLF 경계·인접 encoded word·본문 디코드, extension mirror 결박) |
| AV27–AV30 | 작업공간 origin 2개(실제 git clone), actual 값 3개(STALE_BASE·CONTEXT_CONFLICT·CLI 표시, 다른 코드는 싣지 않음), context 트리와 actor 주소 1개 |
| AV31 | host 손실 신호(SIGTERM·SIGINT·SIGHUP)마다 drain으로 끝남: 실제 자식 프로세스 3개 신호, entry가 설정 로드보다 먼저 등록(composition). mutant(SIGHUP 제외) 실패. 12차 재실행: 종료 즉시 Resident service 정지, 재시작 시 자동 재개와 batch 재전달 |
| AV20–AV28 mutants | 수정을 되돌린 mutant로 각 회귀 시험이 실패함을 확인: AV20 2(주기 없음, drain 미추적), AV21 1, AV22 1, AV23 1, AV24 1, AV25 1, AV26 1(LF 경계만; TUI 헤더 영역 split만 되돌린 mutant는 본문 소유자가 따로 있어 등가), AV27 1, AV28 2(actual 미적재, 코드 제한 제거). AV9–AV19와 AV29–AV30은 mutant 미실행 |

#### 설계 수정 DR1–DR8

| 검사 | 결과와 범위 |
|---|---|
| DR1–DR8 | DR1 archivePath의 caller view 2개, DR3 details·설명 표 3개(접수 뒤 실패 포함), DR4 host가 주는 code.integrate와 Worker integrate 2개, DR6 재전달 알림·index 1개, DR7 독립 세션 1개, DR8 편집 뒤 integrate(phase7; T62는 접수와 CAS 사이 변경, R19는 사실 변경). 수정을 되돌린 mutant 6개(DR1 view 번역 제거, DR3 details 제거, DR4 host 부여 제거, DR6 재전달 줄 제거, DR7 독립 세션 제거, DR8 시작 시점 정책으로 접수) 모두 해당 시험 실패. 13차 실제 점검에서 DR1·DR3·DR4·DR6·DR7·DR8 확인 |

#### Priority 0(P0V-01–P0V-24, DR9–DR13)

| 검사 | 결과와 범위 |
|---|---|
| Priority 0 audit | 1차: 215개 파일을 묶음 A–J 순서로 읽고 fact·owner·P0-1–P0-7 판정과 근거를 적음. 2차: catch 359곳과 `existsSync` 13곳을 파일 순서로 다시 판정. 발견 P0V-01–P0V-24(P0V-24는 14차 실제 provider 점검)와 수정 commit은 `implementation/priority-0-audit.md`에 있음 |
| DR9 | durable: 이전 시도의 receipt가 새 run이 열린 뒤에 나타나도 재전달 없이 정산(rollover-settlement), batch incarnation 불변(crash-boundaries, r12), receipt 구간 검증(receipt-observation). property: V30A의 late receipt는 verified, 구간 밖 early는 conflicting. updateAgent는 고정 spec을 다시 쓰지 않고 lease는 증가만 |
| DR10–DR11 | durable: accept되지 않은 op의 artifact는 startup이 수집하고 accept된 plan이 가리키는 것은 보존, 수집은 quiesce 뒤·prepare 전(recovery-exhaustiveness). session 파일에 없는 boundary로는 receipt가 없고, session flush 뒤·receipt 전 crash는 receipt를 남기지 않음 |
| DR12 | durable: 오래된 snapshot의 inline 편집 거절, commit point 전 crash는 변경 없음·뒤는 loader가 읽음, flush 실패는 unconfirmed이고 다음 편집이 먼저 flush, 첫 설정은 no-replace. 읽지 못한 설정 파일은 바뀜이 아님 |
| DR13 | durable/local: 읽지 못한 host 정책은 BROKER_UNAVAILABLE(accept된 통합은 pending), CLI는 same-key 실패를 exit 3, 끝나지 않은 unit 명령은 DEADLINE_EXCEEDED, 도구가 멈춘 CLI는 결과 불명과 key, 관측 못 한 workspace 항목은 거절, Control Panel exit은 CLI의 판정, `unobserved`(loader·extension·state root·host 배치·디렉터리), 실행되지 못한 ledger 조회는 손상이 아님, 영속성 불명 저장은 저장됨, 읽지 못한 메시지·extension 디렉터리는 목록을 일부로 표시. local: 거절된 Config 저장 뒤 Control Panel이 설정을 다시 읽어 파일 값을 보이고 다음 편집이 그 값에서 만들어짐(P0V-24, oma-composition-policy) |
| P0-7 gate | fast: `check:boundaries`가 durable primitive 호출 owner 58개 전부에 등록된 kill·retry·restart 시험이 있음을 확인, 등록부에서 빠진 경계·없는 시험은 finding(negative control). 추가 시험: draining broker의 status view 제거, project binding 게시 crash |
| P0 mutants | 수정을 되돌린 변이 25개(작업 트리에서 빌드·해당 시험, 빌드되지 않은 변이는 다시 써서 실행): 24개 실패. 생존 1개는 DR12의 앞선 버전 확인만 제거한 것으로, rename 직전 재확인이 같은 코드로 막는 등가 변이(둘 다 제거하면 실패) |
| Provider run 14 | 수동 기능 점검(lane 증거 아님, 사용자 승인, `/home/dev/oma-evidence/provider/runs/run14-*`, `priority-0-audit.md` "실제 provider 점검(14차)"): DR10 시작 수집 removed 2·kept 0(넣은 흔적만), broker SIGKILL 뒤 batch 두 개가 뒤 시도의 receipt로 정산되고 행 불변(DR9), boundary 8/8(DR11), 재전달 알림, Mail 화면의 일부 읽기 실패 표시(DR13), Config 저장·lost update 거절(DR12), P0V-24 수정 뒤 거절 다음 값 표시와 저장 재확인, 종료 코드 0 |
| 문서와 식별자(P0D) | fast: `check:documents`(`check:architecture`에 포함)가 이 트리에서 요구 ID 유일성, 수용 행의 위치와 대역(TEST-008), 링크·anchor를 확인하고, negative control 셋(두 조항에 붙은 ID, matrix 밖의 수용 행과 제품 대역의 빈 번호, 없는 파일·제목을 가리키는 링크)이 finding이 된다. 요구 ID INF-005·006의 중복은 INF-009·010으로, 수용 번호 T115–T117·T122의 두 뜻은 T124–T127로 풀었다 |

#### Priority 0 4차 점검(P0V-25–P0V-53, DR14)

| 검사 | 결과와 범위 |
|---|---|
| P0V-25–P0V-53 | 외부 전수 검토(N01–N23, F1–F7)를 코드와 대조했다(기준점 `6787211`). 위반 28개를 고쳤고(P0V-25–P0V-43, P0V-45–P0V-53), N21(P0V-44)은 DR14의 의도된 예외, N10은 부합으로 판정했다. 회귀 시험은 `p0-review4`(durable, requiredNames P0V-25·P0V-28·P0V-49)와 각 owner의 시험(storage-reservation, generation-retention, r12-ledger-transitions, principal-endpoint, delivery-notice, audit-cli-submit, cli-request-intent, broker-composition-policy, inference-relay)이며, 위 durable·local 결과가 결박한다 |
| P0V 4차 대조 | 고친 소스 파일만 기준점으로 되돌려 빌드하면 해당 시험이 모두 실패했다. P0V-26·P0V-42·P0V-43은 되돌린 코드에 새 함수·필드가 없어 실패한 것이라 대조가 약하다. P0V-34의 tunnel 시험은 옛 코드에서도 통과한다(회귀 방지, 재현되지 않음) |
| DR14 | P0-4를 런타임 자원(FD·자식 프로세스·저장 예약·provider 호출·listener)에도 적용한다. P0V-44의 결과 크기는 v1 수용 한계다(256 KiB frame에서 status agent 1052개, stop의 미해결 operation 6235개; "알려진 한계"). P0V-26의 unit 이름은 UNIT-001 그대로 두고, 다른 소유자의 이름과 겹치면 교체하지 않고 거절한다 |

#### 시나리오 시험(SCN, P0V-54–P0V-55, DR15)

| 검사 | 결과와 범위 |
|---|---|
| Scenario layer | 모델만 대본이고(OpenAI 호환 scripted provider를 엔진의 models.json으로 연결) 동봉 엔진 0.87.1·확장·CLI·broker·ledger·Maildir·runner(격리는 bwrap과 생성된 rootfs)는 제품 그대로인 시험 54개: Principal 루프 33개(P01–P10, F01–F17, L01–L04), Resident와 society 14개(R01–R08, S01–S03, L05, L06, X01), 격리 Resident와 Git 7개(C01–C07). 모두 durable lane이며 11개를 이름으로 요구한다(SCN-P03·L01·F06·F08·F13·R01·R05·S01·C01·C02·C04). provider 증거가 아니다(P0-5, INF-001) |
| P0V-54 | 주소 존재를 params 검사와 라우팅 owner가 따로 판정했다. params 검사는 문법만 보고, 존재는 라우팅 owner가 접수 전에 ADDRESS_NOT_FOUND·AGENT_NOT_READY·AGENT_RETIRED로 답한다(SCN-F04, 옛 코드에서 실패) |
| P0V-55 / DR15 | frame보다 큰 올바른 엔진 이벤트 한 줄은 다음 LF까지 통째로 건너뛰고 `oma_event_skipped`로 알린다. 형식이 틀린 입력은 여전히 전송을 중독시킨다(SCN-F13·F17·R06, 옛 코드에서 실패; jsonl·pi-rpc 단위 시험) |

#### Priority 0 5차 점검(P0V-56–P0V-73, DR16)

| 검사 | 결과와 범위 |
|---|---|
| P0V-56–P0V-73 | v21 결박 커밋 `18421f0`을 본 외부 재검토 두 건(R01–R13, F1–F6)을 코드와 대조해 18개를 고쳤다. rootfs 수리는 이전 Resident의 종료가 증명된 뒤 broker startup 안에서 한다(DR16). 회귀 시험은 `p0-review5`(durable, requiredNames 3개)와 각 owner의 시험이며 위 durable·local 결과가 결박한다. 수정마다 되돌린 변이가 실패했다(priority-0-audit "5차 점검") |

#### Priority 0 6차 점검(P0V-74–P0V-95, DR17)

| 검사 | 결과와 범위 |
|---|---|
| P0V-74–P0V-95 | 외부 검토 R6-01–R6-20을 판정했다(위반 19, 의도된 한계 1: R6-19). 검증하다 찾은 P0V-80·82·84·85를 함께 고쳤다. 종료 신호는 SIGTERM·SIGINT·SIGHUP·SIGQUIT 전부이고 drain이 있는 모든 프로세스가 그 목록으로 끝난다(DR17). 회귀 시험은 `p0-review6`(durable, requiredNames 6개), 규칙 `host-loss-signals`·`utf8-decoder-owner`·`ledger-order-clock`이다. 모든 변이 KILLED(priority-0-audit "6차 점검") |

#### 시험 보강(P0V-96–P0V-97, SCN-B)

| 검사 | 결과와 범위 |
|---|---|
| crash-kill 경계 | `test/crash-kill-boundaries.test.ts`: 설정 managed/inline commit, receipt, derived file, immutable EXDEV, request freeze와 project binding을 fsync마다 SIGKILL한다. 이 시험이 publication 임시 파일이 남는 것(P0V-96·97)을 찾았고, 시작할 때 죽은 임시 파일을 거두게 고쳤다. P0-7 registry: durable 경계 64개 가운데 SIGKILL 44, in-process fault 10, logical 10 |
| SCN-B01–B10 | 모델만 대본인 경계 시나리오 10개(`test/scenario-boundaries.test.ts`): 작업공간 quota, contained tool, credential 읽기 시도(B09), commons 100통 + 질문 1통(B10) 등 |
| V28B | pty harness가 `ready`를 기다리고 끝을 시계로 기다린다(고정 시간 대기 제거) |

#### v22 결박이 찾은 것(P0V-98–P0V-101)

| 검사 | 결과와 범위 |
|---|---|
| P0V-98–P0V-101 | v21 뒤로 처음 돈 kernel·crash·durable lane과 DR18 뒤의 전체 시험이 찾았다(priority-0-audit "v22 결박이 찾은 것"). P0V-98: 첫 Resident 설치가 unit 디렉터리를 만들지 않아 ENOENT(P0V-59의 회귀, 제품). P0V-99: kernel lane의 손으로 쓴 unit에 소유 줄이 없음(시험). P0V-100: durable lane이 이름이 바뀐 AV7 시험을 옛 이름으로 요구(lane, fast lane에 정적 검사 추가). P0V-101: D-5 뒤 bwrap을 직접 띄우는 primitive가 filter를 주지 않음(제품). 고치기 전 initial은 durable(필수 이름)·kernel 55/64·crash 49/63으로 실패했고(`v22/failed-initial-1/`), 고친 뒤 kernel 64/64·crash 63/63 |

#### macOS 플랫폼(macos-platform, DR18)

| 검사 | 결과와 범위 |
|---|---|
| platform lane | `npm run verify:platform`: 82/82. host↔guest protocol, guest 서비스·control·terminal session, host의 수명·Host API·egress·image·archive를 VM 대신 같은 host의 guest 서비스로, bridge는 vsock loopback으로 시험한다. Swift helper와 Keychain, Virtualization.framework, mac-* lane은 Mac이 필요하고 NOT_BUILT/NOT_RUN이다. MV oracle과 시험의 대응은 test-matrix의 macOS 절에 있다 |
| D-1·D-5·D-8·D-9·D-10 | 제품 문구(`src/tui/words.ts`, 규칙 `error-words-owner`), 모든 Resident sandbox의 vsock seccomp(SCN-C08), 읽기 전용 project mirror(SCN-C09), `oma login`, guest의 egress forwarder. 각 수정을 되돌린 변이가 실패했다 |

#### 열린 결정과 spike(DR18)

| 검사 | 결과와 범위 |
|---|---|
| DR18 | S-01–S-11과 macOS D·Q, topic follow, C2(`bin`), 비용 상한을 판정했다(design-revisions DR18, spikes의 "DR18 판정"). v1에 없다고 정한 설정은 `UNSUPPORTED_PROFILE`이고 `SPIKE_UNRESOLVED`는 던지지 않는다(규칙 `no-open-spike`). state root는 local kernel file system이어야 한다(규칙 `state-root-judgement`, `DR18 / S-06:`). macos-platform.md를 수용해 traceability가 MAC 조항 68개를 inventory한다(전체 367, 모두 unverified) |

#### 중간 실행에서 멈춘 것

| 검사 | 결과와 범위 |
|---|---|
| PASS로 바꾸지 않은 실패 | v3(`9f7f551`) kernel 59/60: 실패는 WP25가 고친 `T36`. v4(`6611644`) kernel 61/62: WP25 뒤 갱신되지 않은 `systemd-analyze verify` fixture(`1f6c31e`에서 수정). v11 첫 initial(`0325450`) kernel 62/63: 부하에서 살아 있는 Resident가 CAPABILITY_DENIED(AV6의 발견 경위), 두 번째 initial(`83f1b04`)은 AV7을 고치려 local 도중 중단. v17 final(`140eed8`) durable 474/475: AV14 시험의 뒷정리 경쟁(`4dd80cc`에서 수정). 각각 원인을 고친 뒤 다음 회차가 대체했다 |
| v22 initial 두 번 | 첫 initial(`v22/failed-initial-1/`): durable은 이름이 바뀐 AV7 시험 둘을 옛 이름으로 요구해 실패(P0V-100), kernel 55/64·crash 49/63은 첫 Resident 설치의 ENOENT(P0V-98)와 소유 줄 없는 시험 unit(P0V-99). 두 번째(`v22/failed-initial-2/`, 중단): durable 625/626, P0V-98의 새 시험이 lane guard 아래에서 다른 오류로 멈춤(시험만 고침). 각각 고친 뒤 세 번째 initial이 이 절의 결과다 |
| 중간 증거 | v1–v21의 initial·final 산출물은 결박되지 않은 중간 증거로 `/home/dev/oma-evidence/v1`–`v21`에 있다. 현재 판정은 이 절의 트리만 말한다 |

Raw evidence: `/home/dev/oma-evidence/v22/`.

Final PASS condition: `v22-final-fast`, `v22-final-durable`, `v22-final-property`, `v22-final-stress`, `v22-final-platform`, `v22-final-package`, `v22-final-local`, `v22-final-kernel`, `v22-final-crash` must bind one digest with exit 0 and zero unrun tests.

## 알려진 한계

현재 제품이 하지 않거나, 현재 트리가 증명하지 않은 것이다. 각 항목의 근거는 괄호 안의 카드·결정 기록에 있다. 검증하지 않은 환경(powercut·provider 자동 lane·CI)은 아래 "남아 있는 release gate"에 있다.

**설치와 배포**
- package는 `bin`으로 `oma` 명령을 선언한다(C2, [DR18](../design-revisions.md)). checkout에서 `npm install -g .`로 설치한다. npm registry에는 게시하지 않았다(WP31).
- node·git·bwrap은 host에 있어야 한다. 봉인에는 `bwrap`과 `/usr`가 필요하고, 없는 host에서 T117은 이유를 적고 skip되며 그 skip은 `npm test` 실패다. OS별 배포본은 없고 다른 Node·배포판은 NOT_RUN이다(WP31).
- 동봉 엔진을 바꾸기 전에 기존 society의 미정산 batch를 모두 정산한다. 0.85.1 adapter의 receipt는 conflicting으로 보존된다(ENG1).

**운영 형태**
- systemd가 broker를 fixed unit으로 실행하는 형태는 렌더링만 검증했고 지원 목록에 올리지 않는다. 그 형태의 reconcile timer unit은 설치되지 않는다(WP03, AV20).
- `oma`가 broker를 시작하지 않은 society에서는 Principal 대화 세션을 열지 않고 Control Panel로 남는다. 대화는 broker를 소유한 `oma`에서 이어간다.
- WP03 전에 렌더된 Resident unit은 자동으로 다시 렌더되지 않는다. 다시 만들어야 한다(WP25).
- 바인딩된 state root를 옮기려면 migration이 필요하다(WP16).

**보안 경계**
- Yama ptrace scope 0인 host에서는 같은 UID의 프로세스가 engine을 trace할 수 있어 Principal 권한 경계가 성립하지 않는다.
- quarantine 스크립트는 private mount namespace 안에서 경로를 쓴다. WebSocket frame header가 key 바이트를 가르면 응답 tripwire가 보지 못한다. 관측하지 못한 권한은 거부하되 CAPABILITY_DENIED로 보고한다(바꾸면 정산 분류가 달라진다)(AV1–AV5).
- 추가 role extension은 core extension의 제한 밖에서 도는 trusted code가 될 수 있어 운영자가 따로 검토한다(operations).

**동시성과 내구성**
- S-03: v1은 batch를 followUp으로만 전달한다([DR18](../design-revisions.md)). run 중에 도착한 mail은 다음 run의 batch가 되므로, Resident의 긴 run과 Human의 긴 turn 동안 전달이 기다린다(Principal delivery는 idle session에만 전달한다).
- state root는 local kernel file system에 있어야 한다. NFS·SMB/CIFS·FUSE(virtiofs 포함)·9P·Ceph·AFS·Coda·NCP 위에서는 시작하지 않는다(REC-004, [DR18](../design-revisions.md) S-06). 시험한 file system은 ext4와 tmpfs다.
- 설정 편집은 비협조적인 same-UID writer와의 동시 편집을 지원하지 않는다. 전원 차단 뒤의 순서는 증명하지 않았다(WP12, WP13).
- 설정 journal이 계속 읽히지 않으면 generation 예산에서 편집 거절이 재시작으로 풀리지 않는다(AV7). journal 기록이 연속 두 번 빠지면 직전 generation을 잃던 한계는 P0V-61이 닫았다: 기록은 commit point 전에 쓰이고, 기록하지 못한 commit은 하지 않는다.
- 저장 용량은 kernel hard quota가 아니다. SQLite·WAL 증가는 측정만 했다(WP22).
- accept되어 성공한 submit·context의 staging 디렉터리는 남는다(WP20. 14차 실제 점검에서도 보존을 확인).
- 한 key에 대한 동시 CLI 프로세스는 검증 범위 밖이다(WP26).
- v1 코드가 이미 재할당한 prepared batch는 저장된 값을 첫 시도로 읽는다. 그보다 이른 시도의 receipt는 전처럼 conflicting이다(DR9).
- Mail 화면의 갱신은 헤더를 최근 `mailListRows`통만 읽지만, 순서를 정하려고 메일함의 모든 이름을 lstat한다(P0V-43).
- 시나리오 시험(`scenario-principal`·`scenario-society`·`scenario-confined`, durable lane)은 모델만 대본이다. 실제 provider의 스트림·오류·재시도는 엔진 몫이라 증거가 아니다(P0-5, INF-001). systemd unit과 journal은 대역(`ScenarioUnits`)이고, runner가 시험 프로세스의 cgroup을 함께 쓰므로 한 broker 수명에서 Resident마다 한 번만 깨운다(test/fixtures/README).
- 엔진 이벤트 한 줄이 frame보다 크면 그 이벤트는 건너뛰고 알린다(DR15). 그 이벤트의 내용(모델의 긴 답이나 큰 도구 인자)은 Principal 화면에 보이지 않는다.
- broker의 ledger 연결은 동기 node:sqlite다. 다른 연결이 쓰기 잠금을 쥐고 있으면 `busy_timeout`(5초)까지 broker의 event loop가 멈추고, 그동안 IPC 응답과 timer가 늦는다. 쓰는 연결은 broker 하나이므로 잠금을 쥐는 것은 운영자의 외부 writer나 checkpoint 경합이다. 기한(alarm)은 단조 시계로 다시 걸려 이 멈춤이 거짓 만료를 만들지 않는다(D-7, P0V-76). watchdog은 없고, 두게 되면 이 상한이 그 주기보다 짧아야 한다(6차 점검 R6-19).

**비용과 추적**
- v1에는 비용 상한이 없다([DR18](../design-revisions.md), INF-009). relay가 요청 수·동시성을 쥐지만 stream을 해석하지 않는다. 비용의 경계는 provider 계정의 한도다.
- `usage` 표와 그 transaction(T-usage-reserve)은 schema v1 그대로 남아 있지만 쓰는 주체가 없다. INF-001이 inference와 사용량 회계를 엔진에 넘기면서 OMA의 예약·정산 경로를 없앴기 때문이다(INF-009가 이 사실을 여기에 기록하도록 요구한다).
- 수용 시험 T48–T51(inference 예약·provider 정산)은 TEST-006에 따라 표에 남지만, INF-001 뒤로는 이를 이행할 OMA 경로가 없다. adversarial report(`scripts/adversarial-report.mjs`)는 이 행들을 NOT_RUN으로 두고 그 이유를 적는다.
- traceability의 requirement는 모두 `unverified`다. owner·callPath·negative test가 연결된 것도 compliance 기록 절차를 거치지 않았다.

**보류한 결정과 검증 공백**
- [DR18](../design-revisions.md)이 열린 spike(S-01–S-11)와 결정(macOS D-1·D-4·D-5·D-7·D-8·D-9·D-10, Q1–Q9, topic follow, C2, 비용 상한)을 닫았다. v1에 없다고 정한 것: run 중 steer, 통합 검사(`integration.checks`), tiered integration·attestation·verifier, notmuch·reflink·project egress, 비용 상한, 성능 주장. 이 설정들은 `UNSUPPORTED_PROFILE`로 거절된다.
- macOS에서 transcript(모델과 도구가 쓰는 내용)에는 guest의 작업공간 경로가 보일 수 있다. MAC-022는 OMA의 말만 제품 문구로 바꾼다(D-1).
- WP03 이전 Resident unit의 재생성 절차.
- 전체 `oma` entry의 pty 시험(최상위 catch의 정리 순서), rollover 뒤 endpoint bind 실패의 별도 주입(WP30).
- 결과 크기와 frame(P0V-44, DR14/19): dispatch 후 frame 초과는 미실행 증거가 아니며 FRAME_TOO_LARGE·same-key다. 현재 CLI는 operation.read로 동일 actor/key receipt를 digest·offset 검증하며 최대 64 MiB, 최초 요청부터 전체 60초 안에서 회수한다. 이 예산 초과·버전 변경·단절은 결과 불명이다. 모델 도구 CLI의 출력은 별도 1 MiB라 큰 terminal receipt가 곧 모델에 전량 전달된다는 보장은 없다. status 응답은 next cursor를 제공하지만 페이지 사이 변동은 live 관측이며 snapshot 일관성을 보장하지 않는다. 운영 full-set 조회는 10,000행/32 MiB 예산 초과를 LIMIT_EXCEEDED로 거절한다. 일부 집합을 전체로 쓰지 않으며 DB 전체에 대한 무제한 처리·SQL 시간 상한·중첩 조회 전체의 단일 합산 예산을 보장하지 않는다.
- unit 이름(P0V-26, DR14): 두 소유자에게 같은 이름이 되는 unit은 교체하지 않고 AGENT_CONFLICT로 거절한다. 그런 이름의 agent는 만들 수 없다. 이름 체계(UNIT-001)는 그대로다.

## 기본 재검증

실제 명령 정의는 [package.json](../../package.json)이 기준이다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
node scripts/loc.mjs
```

source/import graph가 바뀌었다면 current dependency evidence를 재생성한다.

```sh
npm run evidence:graph
npm run check:architecture
```

dependency evidence의 current path는 `implementation/evidence/dependency-graph.json`이다. Generated list, LOC/hash, dependency evidence를 사람이 새 실행처럼 수동 보정하지 않는다.

mutation 하나만 수정할 때는 먼저 관련 surface를 좁힌다.

```sh
npm run mutation:locality -- git.submit
```

focused test를 실행하더라도 전체 invariant/release 의미로 승격하지 않는다.

## 환경별 verification lane

각 output directory는 기존 artifact를 덮지 않는 새 경로를 사용한다.

```sh
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
```

필요한 systemd/kernel/provider/VM 환경이 없으면 PASS가 아니라 `BLOCKED` 또는 `NOT_RUN`으로 기록한다. 일반 개발 host의 SIGKILL/process fixture를 VM power-loss proof로 취급하지 않는다.

## LOC 측정 — 크기 제한 폐지

2026-09-28 사용자 결정 [DR20](../design-revisions.md#dr20--loc-크기-제한을-폐지하고-측정의-진실성은-유지한다)으로 A-008·LOC-001의 크기 목표·상한 및 초과 시 review/release 차단을 폐지했다. 과거 v22의 A-008 OPEN은 당시 기록일 뿐 현재 gate가 아니다.

`node scripts/loc.mjs`의 현재 source-bound 결과는 **323 files / 33,151 code LOC**다. 수치는 정보이고 합격 기준이 아니다. 원본 목록·측정·hash의 일치 검사는 유지하며 파일 누락이나 위조는 여전히 실패다. 수정하지 않은 upstream 엔진은 LOC-003에 따라 제외하고 TUI·제품 표면은 같은 manifest에 포함한다. 구조·권한·내구성에 대한 독립적인 review와 다른 release 조건은 폐지하지 않았다.

## 남아 있는 release gate

- `spikes.md`의 각 spike는 [DR18](../design-revisions.md)이 판정했다. S-06의 전원 장애 부분은 아래 VM power-cut이 남은 gate다. v1에 없다고 정한 기능의 조건은 그 기능을 더할 때 fresh harness evidence로만 닫는다.
- live systemd/cgroup/READY, hostile import, filesystem/kernel containment, VM power-cut/ENOSPC/read-only/restore 등 environment-specific proof는 별도다.
- 실제 provider: 제공자 호출·재시도·오류·사용량·취소는 동봉 엔진이 소유하므로(INF-001) OMA의 release 증거가 아니다. OMA 쪽 증거는 봉인된 Resident의 byte relay와 credential 경계(INF-005–INF-008), 엔진이 보고한 결과를 OMA가 읽는 방식(INF-004, 시한)이 실제 provider와 함께 끝까지 도는지다. 지금은 수동 기능 점검(1–14차)뿐이며 자동 lane은 NOT_RUN이다.
- S-08/S-10 tiered attestation/floor와 S-11 clean-room은 v1에 없다. S-09의 품질·비용·latency 평가는 성능을 주장할 때의 조건이며 v1은 주장하지 않는다([DR18](../design-revisions.md)).
- macOS: mac-vm·mac-security·mac-powercut·mac-e2e lane은 Apple Silicon Mac이 필요하고 NOT_RUN이다. `platform` lane은 Linux에서 돈다([test-matrix](../verification-spec.md#oma-core-v1--검증-계약)의 macOS 절).
- LOC/A-009 측정은 `node scripts/loc.mjs`의 current source-bound 결과로만 갱신한다. A-008 크기 gate는 DR20으로 폐지했다.
- CI는 2026-09-28 사용자 보고에 따라 저장소 GitHub CI 장애로 보류한다. Mac native 검증은 사용자에게 시험 장비가 없어 보류한다. 이를 PASS로 표시하지 않는다.
- 사용자 지시로 더미 상태의 중단·복구 시뮬레이션을 정식 `npm test`와 durable lane에 추가했다. 편의 명령은 `npm run verify:powercut:simulation`이다. 실제 임시 ledger·파일·생산 mail 복구를 사용하지만 `powerLossProven`은 false다. 기존 guarded `verify:powercut`의 SysRq-b는 guest 즉시 재부팅이며 외부 VM/물리 전원 차단 증거가 아니다. 현재 host에는 QEMU/libvirt 및 /dev/kvm이 없어 실제 VM 시험은 미실행이다.
- requirement별 release proof는 [compliance.md](../verification-spec.md#requirement--production-path--executable-evidence)를 따른다.

과거 상세 실행 로그, 감사 기록, 단계별 PASS 기록은 [docs/archive.md](../archive.md)가 가리키는 snapshot에서 조회한다.

## 보존하는 verification 규범

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

**MUST [VAL-002]** 구현 시작 시 [spikes.md](../verification-spec.md#oma-core-v1--미확정-구현-경계)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](../verification-spec.md#oma-core-v1--검증-계약)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.


## 7차 검토 수정 검증 (2026-09-28)

- 범위: `070a52d` 이후 P0V-102–P0V-127, DR19. 전체 항목 판정은 priority-0-audit의 7차 점검 표다.
- 후속 focused 시험: p0-review5·p0-review7·engine-inference-chain·model-scope **35/35 PASS**, skip 0.
- 후속 변이: foreign unit을 inactive로 되돌림, listen 전 계획한 포트 등록 복구 → 각각 **KILLED**.
- 소스 gate: LOC inventory/measurement·dependency graph·architecture·transaction·durable boundaries·document integrity PASS, exit 0.
- 초기 전체 `npm test` 시도(과거): **FAIL** — 1,948개 중 1,942 PASS, 6 FAIL, skip 0, exit 1.
  실패는 diagnostic 인자 관측 1건, stale AV25 이름 1건, 검증 digest/LOC 2건, review ledger 2건이었다.
  원인 수정과 oracle 보강 후 전체 재실행은 **1,979/1,979 PASS**, fail/cancelled/skipped/todo 모두 0, exit 0.
  정확한 입력 해시·문서 기록 이후의 재검증 범위는 위 「현재 source 판정」에 구분했다.
- 현재 후속 lane 결과(각 exit 0, fail/cancelled/skipped/todo 모두 0; lane 간 시험은 중복되므로 합산하지 않는다):

  | lane | 실제 실행 결과 | 경계 |
  |---|---|---|
  | fast | 327/327 PASS | 타입·계약·정적 구조 및 로컬 fixture |
  | durable | 637/637 PASS | 실제 SQLite/Git/파일·엔진 및 fake-provider 시나리오 |
  | property | 34/34 PASS | 고정 seed 모델·parser·재시도 속성 |
  | stress | 12/12 PASS | bounded transport·자원·무진행·응답성 |
  | platform | 94/94 PASS | Linux의 host/guest Node 코드; 실제 Mac VM 아님 |
  | kernel-r2 | 64/64 PASS | omatest의 실제 systemd/cgroup/pidfd·runner |
  | crash | 63/63 PASS | process crash/restart; VM 전원 차단 아님 |

- kernel 첫 실행은 64개 중 63 PASS/1 FAIL(exit 1)이었다. `T-create-ready`가 endpoint 실패에도 incarnation을 소비한다는 옛 기대값을 유지했다. production을 되돌리지 않고 실패 시 incarnation 유지·revoked-awaiting-death·lease 없음·살아 있는 pin·죽음 확인 후 새 invocation을 검증하도록 시험을 고쳤다. 수정 시험으로 kernel 전체가 통과했고 commit-before-endpoint 옛 순서 변이는 같은 실제 systemd 시험에서 **assertion-KILLED**였다. 일반 host에서 환경 부족으로 BLOCKED된 과거 phase5 실행은 이 결과에 합산하지 않는다.
- macOS native/APFS/VZ/launchd와 실제 provider·VM powercut·CI는 **NOT_RUN**. 장비·사용자 승인이 필요한 release 증거이며 로컬 PASS로 대체하지 않는다. push·PR·merge도 실행하지 않았다.

### 7차 검토 후속 수정과 수용 경계

- G10-02: grep/find는 fd-relative O_NOFOLLOW로 승인한 single-link regular file의 private 복사본만 검색한다.
  기본/context=0/context>0, regex/glob/ignore, root 교체와 link 거절, 취소·부모 사망·SIGTERM 무시 walker 정리를 시험했다.
  부모 EOF 처리 제거와 process-group 종료 제거 변이 모두 assertion-KILLED다. 복사 단계의 짧은 정상 종료만 보는 최초 EOF 변이는 SURVIVED였고,
  종료하지 않는 walker 반례로 oracle을 보강한 뒤 KILLED를 확인했다. snapshot owner 자체 SIGKILL·OS crash 뒤 잔재 회수와
  동시에 수정되는 원본 파일의 원자적 내용 snapshot은 보장하지 않는다. source root 조상의 신뢰 전제는 그대로다.
- G02-ledger-r2-01: full-set 및 조상 체인은 기존 row/byte 예산 안에서 수집하고 초과는 LIMIT_EXCEEDED다.
  batch 후보는 128행 keyset page, upper rowid 고정, direct/public 각 maximum 보유로 순회한다. 늦은 accept는 다음 순회에 속한다.
  status next/after는 response paging이다. full-set을 부분 성공으로 바꾸지 않았으며 무한 backlog 처리를 보장하지 않는다.
- G03-broker-r2-01: listening await 뒤 admission·drain·run identity·invocation/cgroup을 재확인하고 commit한다.
  실제 Server listen error 및 실제 drain 중 거절을 시험했다. 이미 commit된 사실의 롤백이나 같은 invocation fence 완화는 없다.
- G03-broker-01/r2-02: actor/key와 receipt digest에 묶인 operation.read 및 CLI 재조립을 추가했다.
  실제 Store/Lifecycle/Broker/RpcConnection/CLI의 stop 효과 1회 → 중간 chunk 단절 → broker/ledger 재시작 → 동일 영수증 회수와
  같은 key replay·타 actor 거절을 시험했다. 인증 fixture는 kernel peer-auth 증거가 아니다. 수용 상한은 위 알려진 한계에 적었다.
- API 단절: pinned engine retry owner를 enabled/maxRetries=5, provider SDK retries=0으로 고정한다.
  최초 1회 + 추가 최대 5회이며 transient 실패 후 복구·소진, fatal 인증 오류, backoff 중 세션 종료와 도구 효과 비반복을 fake provider로 시험했다.
  재시도 횟수 축소, SDK 중첩 재시도 복구, Principal/Resident 설정 호출 제거, backoff 유휴 시한 보정 제거의 다섯 변이는 모두 assertion-KILLED였다.
  실제 유료 provider나 별도 사용자 abort 명령 구현을 주장하지 않는다.
- focused 검색·receipt·status·운영 예산: 22/22 PASS, skip 0. 이후 keyset 추가 검증은 별도 재실행했다.
  systemd 전용 phase5를 일반 host에서 실행한 조합은 8 PASS/1 FAIL(exit 1): 실패 이유는 OMA_TEST_SYSTEMD·일회용 user manager 미설정(BLOCKED)이다.
- 최신 operational/receipt/batch/model focused 재실행: 14/14 PASS, skip 0, exit 0. 계약 surface/검토 원장: 12/12 PASS, skip 0, exit 0.
- 추가 변이: collector row 상한 +1, keyset upper bound 제거, receipt 전체 digest 검사 제거, status continuation 제거 모두 assertion-KILLED.
  최초 digest 제거 변이는 SURVIVED였다. 각 chunk가 같은 잘못된 digest를 주장하는 반례를 추가하여 전체 hash 검사가 제거되면 실패함을 확인했다.
- macOS 게시·stream·snapshot·lock의 로컬 fault 시험은 실제 APFS 전원 내구성이나 VZ 다중 attach 시험을 대신하지 않는다.


### 2026-09-30 — DR26 extension installation and follow-up audit

- Executable extension assets no longer share configuration-document byte budgets. Document limits remain; extension containment, source closure, generation currency and pre-spawn digest verification remain.
- Focused package/configuration/UI suites: 40/40, subsequent package/transport coverage 17/17 and 23/23 PASS. Follow-up Principal-only installation and request-ledger tests: 15/15 PASS; numeric UI/settings tests: 36/36 PASS. These overlapping runs are not summed as unique tests.
- Installed `oma` PTY, isolated HOME and local fake provider/registry: valid 6 MiB extension installed, command and DIRECT tool exposed, Worker disabled choice survived restart, remove cleared selections, terminal echo/canonical restored. No real Kiro execution, credentials, paid provider or native macOS VM verification is claimed.
- Independent compiled-copy mutants: document-cap, spawn-digest, commit-digest, corrupt-empty, false-activation, no-retry, archive-flag: 7/7 KILLED. Follow-up principal-only, number-digits, ledger-depth: 3/3 KILLED. Earlier mutation harness setup failures are not counted as kills.
- Typecheck, build/static package check, production inventory, dependency graph and architecture/transaction/boundary/document gates PASS after follow-up code changes.
- First whole local suite attempt was interrupted at its 600-second execution deadline during storage-reservation.test.js. This is NOT a whole-suite PASS; a longer run is required. Systemd/kernel and power-cut lanes were not run.
- Repository-wide audit is not complete. Remaining candidates are not reported as confirmed fixes.

- Whole local rerun completed: 2049 tests, 2044 PASS, 5 FAIL, no skips. One export regression came from replacing the legacy digest encoder, which represents explicit undefined fields; restored the compatible encoder with the shared nesting bound. Export and ledger focused rerun: 11/11 PASS, including replay of a pre-existing undefined-field intent. Four other failures were stale validation inputs/figures and a missing review-ledger entry; these are being regenerated, not waived. The earlier ledger-depth mutant tested the superseded implementation; the revised nesting guard requires a fresh mutation run.

- Revised legacy-compatible ledger nesting guard mutant: KILLED. Regenerated review ledger and validation figures/input binding; production-inventory and review-closure focused tests: 15/15 PASS. Architecture/transaction/boundary/document gates PASS. Whole-suite rerun pending.

- Final local rerun (`full-fix-r3.log`): exit 0; 2050/2050 PASS, failures/cancelled/skipped/todo all 0, duration 824762 ms. Tested input binding before this result-only record update: `db04112b74df81604a309d05b273cefb923aa4e3581612686e395c22bf32cb3f`. No source/test/build changes occurred during this run. This proves the local suite, not completion of the repository-wide audit or native macOS/systemd/kernel/power-cut verification. The binding below is refreshed for the result record; metadata/document tests are rerun after it.


### 2026-09-30 — DR27 live-run wait and time-boundary follow-up (partial)

- RUN-003 is implemented as exact live-incarnation memory, with authenticated keyless
  observation and Pi's awaited persisted-tool boundary. Wait does not ACK, change
  desired, publish a delivery receipt or complete a prepared batch. Explicit ACK and
  already published delivery evidence retain their independent meanings.
- Confined local fake-provider scenarios use the real broker/CLI/runner/Pi. They
  verify tool work after `oma agent wait`, persisted tool results, no next inference,
  explicit ACK both ways, prepared mail retention and no inherited wait after broker
  restart/new incarnation. User-manager observations are a fixture, not kernel proof.
- Initial focused run: 38/40 PASS, two stale expectations failed (public-method count
  and unbatched-only pending-delivery query); corrected to the current closed method
  set and actual prepared delivery relation. Rerun with Worker autonomy: 42/42 PASS.
  Separate boundary/deadline/receipt/engine set: 60/60 PASS. Later registry/boundary/
  runner baseline: 29/29 PASS. These overlapping sets are not summed.
- Independent compiled-copy mutation baseline initially failed because schema files
  were missing; that setup failure is not a kill. With schemas present, baseline
  29/29 PASS; 11/11 assertion-KILLED: missing wait, mutating observation, inherited
  wait, stale incarnation, revoked run, missing abort, wait-as-delivery,
  unknown-as-delivery, premature observation, stale notice and publication after wait.
- Follow-up found control-idle expiry competing with the longer wait CLI observation.
  Announced exact begin/end/failed phases now have a separate absolute observation
  deadline, retain normal control idleness after completion, and never become receipt
  evidence. Actual confined scenarios delayed replies 3.5 seconds past a 2-second
  runner idle budget: continue, wait and failure preserve their distinct outcomes.
  This is scaled timing proof, not an actual 180-second wait.
- Follow-up first run: 28/29 PASS. The failed assertion expected detailed text from
  the runner, which intentionally reports the error code. Corrected to its existing
  SESSION_BOUNDARY_UNCONFIRMED contract; scenario/boundary/receipt/process rerun:
  35/35 PASS, no failed/cancelled/skipped/todo tests. Decoder and fake-Pi tests also
  cover stale phase notices, post-query idle rearming and EOF-before-child-close.
  `receipt-chunks` now derives its synthetic clock from the shared CLI budget instead
  of the old 60-second literal. The unused host-editor subprocess policy was removed.
- Updated independent compiled-copy wait mutants: 15/15 assertion-KILLED, with
  29-test registry/boundary/runner and selected observation/EOF baselines passing.
  The preceding v3 attempt timed out on the stale-observation fixture; that timeout
  was not counted as a kill. The finite stale fixture then produced an assertion
  failure under the mutant and passed unchanged production in v4.
- Platform time audit follow-up reproduced missing FIN/error/already-ended handling
  in the common leading-frame reader and the JSON hello/request budget mismatch:
  before fixes 3/18 PASS, 15 FAIL; after fixes 18/18 PASS. The reader now ends its
  observation and removes its listeners while retaining the caller's socket owner;
  explicit Infinity is for idle pools only, invalid native timer budgets are refused.
  Response observations share envelope/ID/refusal validation: unread, malformed and
  mismatched answers remain unknown/same-key, not proof of a refused effect.
- Mac CLI/attach/helper connection attempts use one finite owner; CLI errors always
  release the socket. Stream put now releases it on local as well as remote failure,
  observes backpressure/close with pipeline, pins one source FD for declaration and
  bytes, and validates the returned size/hash. A half-closed host pool slot is freed
  and replaced. No request is automatically resent on these paths.
- Platform focused sets: 51/51 PASS (RPC/lifecycle/Host API/project/egress/helper),
  then 45/45 PASS (expanded RPC/stream/package/host-service), no skips or cancelled
  tests. These sets overlap. Two test-only TypeScript errors in the added pool and
  byte fixtures were corrected before the latter run. Native macOS/VM behavior is
  not established by these Linux fixtures. Independent compiled-copy platform
  baseline: 28/28 PASS; 11/11 assertion-KILLED (FIN, error, prior EOF, bad timer,
  hello budget, response ID, unknown classification, connection owner, upload owner,
  receipt binding and source pathname replacement).
- systemd template assertions and prior static `systemd-analyze verify` pass, but the
  attempted runtime-service backoff probe was denied and NOT_RUN. It is not retried
  through another path. The later DR27 start-limit follow-up below replaces the
  historical cumulative-counter classifier with current explicit evidence. Real
  systemd-257 behavior is still NOT_RUN for the current implementation.
- Full current-tree suite, all gates, installed PTY, native macOS, actual systemd
  backoff and trusted candidate checks remain incomplete. No actual provider,
  credential file, user OMA process, VM powercut, commit or push was used here.

### 2026-09-30 — DR27 platform ownership and observation follow-up (partial)

- File-source fault injection first reproduced three defects (36/39 PASS): primary
  read and remote-refusal meaning overwritten by close failure, and a second JSON
  response appended after raw-byte declaration. One borrowed-FD return owner and
  the declaration boundary fixed them. Focused rerun: 56/56 PASS.
- Endpoint observation fixture first failed all 10 tests: EACCES/EMFILE/EIO/timeout
  collapsed into absence, and absence was treated as stopped. Common cancellable
  connection ownership, unknown-preserving probes and explicit launcher stop passed
  64/64 focused tests; expanded cancellation/late-error tests passed 56/56. These
  overlapping sets are not summed. No manager service or user OMA was touched.
- Independent platform mutants v2: 16/17 assertion-KILLED; pathname replacement
  failed with StoreError rather than an assertion and was NOT_KILLED by the harness.
  The normal-path fixture now explicitly asserts successful receipt. Fresh v3:
  baseline 56/56 PASS, 21/21 assertion-KILLED. Later common failure classification
  passed 65/65; that source change was not covered by the earlier v3 result.
- Cross-channel/ledger follow-up reproduced 10 failures (71/81 PASS): transient or
  ambiguous errors became durable refusals and storage exhaustion became permanent
  refusal. After shared classification: 104/104 PASS. Further read/aggregate tests
  reproduced four failures (12/16 PASS): unavailable reads became corruption and a
  nested upstream refusal became a new local outcome. Corrected shared primary
  decoding and read/parse separation: 108/108 focused tests PASS, no skips/cancels.
- Fresh compiled-copy platform mutants v4 on that source: baseline 102/102 PASS;
  33/33 assertion-KILLED. The 21 prior controls plus channel retry, storage repair,
  ambiguous outcome, remote retry, nested primary, product text, pending ledger,
  upstream refusal, read observation and legacy-result preservation all failed by
  assertion when reversed. The repository's source and dist were not mutated.
  Logs/results are session scratchpad `platform-mutants-v4/`,
  `platform-classification-before.log`, `platform-classification-green.log`,
  `platform-ledger-read-before.log`, and `platform-ledger-green.log`.
- Fresh build/package check and broader platform/wait/deadline/error/receipt/
  host-tenure/bringup rerun: 297/297 PASS across 31 compiled files, no skips/cancels.
  These are Linux/local fake fixtures, not installed OMA PTY, native Mac, VM powercut
  or actual systemd/cgroup closure. Full current-tree suite and trusted candidate
  checks remain incomplete.
- Structure follow-up: nine architecture findings were fixed by reusing the
  existing isolated full-OID mirror and registering exact semantic owners (pure
  facts, codecs, mechanisms and acceptance coordination). No broad exemptions.
  Host/extension full-OID corpus and real local SHA-1/SHA-256 GOAL preparation:
  12/12 PASS. Outdated BROKER_UNAVAILABLE expectations now assert unknown acceptance,
  one same-key lookup and no automatic resend, not a permanent effect refusal.
- The next gate exposed six durable-registry findings. The renamed mail acceptance
  owner retains its prior tests. New local child SIGKILL tests cover Society open/
  close acceptance, settlement, unknown and superseded commits, plus snapshot
  preparation/release/collection. Failed preparation handoff checks descriptor and
  tree cleanup. Combined relevant tests: 45/45 PASS. These use fake units and do
  not prove real cgroup death. Full architecture chain now PASS: inventory, rules,
  architecture analysis, transactions, durable boundaries and document integrity.
- Metadata tests then exposed stale schema fixtures, verification digest/LOC and
  review inventory. A new negative oracle also reproduced history being used to
  certify changed working-tree bytes. The review generator now leaves any unbound
  changed/new production source NOT_REVIEWED rather than relabeling old proof;
  existing explicit SHA-bound reviews must still match. Metadata rerun: 28/28 PASS.
- Independent Git-history fixture now covers unchanged/history, unstaged/staged,
  untracked/ignored, explicit byte-bound review and a subsequent stale review.
  Initial mutation attempts exposed an inadequate new-file counterexample; the
  fixture now supplies both the declared clause and its real oracle.
- Host startup registered its failure owner only after configuration, provisioning
  and extension reads. Five injected earlier failures retained the tenure. Ownership
  cleanup is now registered immediately after acquisition, and immediate failure
  exits go through it too. Controlled real-entry/real-tenure composition plus the
  independent review fixture: 39/39 PASS. No real provider, manager or user OMA ran.
- Fresh independent-copy boundary mutants v3: all six group baselines PASS;
  25/25 assertion-KILLED (startup owner/immediate exit, GOAL grammar, review
  dirty/new/digest binding, exact layers, Society replay/supersession/death/fence,
  snapshot release/collection/handoff/active lease). Earlier v1/v2 had one surviving
  new-file guard mutation and are not counted as passing runs. Repository source
  and dist were never mutated. Logs: `dr27-boundary-mutants-v3/`,
  `host-startup-before.log`, `host-startup-green.log`, `review-fixture-green.log`.

### 2026-09-30 — DR27 child-close, start-limit and guest concurrency follow-up (partial)

- Direct-child cleanup observes close on delivery failure as well as success, bounds
  its stop observation, retains the original failure first and releases its timer
  and listener. Independent close mutants initially killed 6/7; the successful-close
  fixture was strengthened without mutating repository source/dist. Fresh v2 killed
  7/7 by assertion. A long TMPDIR socket fixture and a symlink alias failed setup;
  they are not passing evidence. Default-path eight-file rerun: 60/60 PASS, no
  failed/cancelled/skipped/todo tests (`delivery-scenarios-native-fixture.log`).
  Post-spawn setup failure and arbitrary descendant closure are not proven here.
- UNIT-006 counter/prose/timeout counterexamples first passed 8/14 and failed 6.
  Only current failed/Result=start-limit-hit now establishes the diagnosis. Generic
  command failure stays generic; an unanswered start stays DEADLINE_EXCEEDED even
  if a later observation reports a limit. No reset or automatic retry was added.
  Status observation rerun: 22/22 PASS; independent baseline PASS and 8/8
  assertion-KILLED (`start-limit-mutants/`). T36 was updated but NOT_RUN: the earlier
  runtime-service denial remains in force. Historical WP25 proof is not current proof.
- A RequestLedger instance now acquires one active key before calling the effect
  and returns it in finally. Same-key overlap/reentry refuses without another effect
  or a new waiting queue; other keys remain independent. Original terminal results
  replay unchanged; unknown results stay pending and can retry after owner return.
  Four new counterexamples first all failed. Broader seven-file rerun: 72/72 PASS,
  no skipped/cancelled tests (`ledger-unit-scenarios.log`). This run preceded the
  GuestHost fence changes; the counts are not added to later overlapping sets.
- GuestHost archive acquires only its own operation fence. An overlapping refusal
  cannot release another archive's fence. Opening, maintenance and archive guards
  now check both directions before asynchronous work. Three counterexamples first
  all failed. The first combined rerun was 27/29: two fixtures incorrectly expected
  transport ENGINE_UNAVAILABLE rather than explicit BROKER_UNAVAILABLE. Correcting
  that expectation passed 29/29; adding failure-path owner return passed 30/30
  (`guest-fence-green-v3.log`). Production wire classification was not weakened.
- Independent guest mutants v1 killed 8/10 by assertion; two unexpected exceptions
  were NOT_KILLED by the harness. Successful owner return is now explicitly asserted
  with doesNotReject/doesNotThrow. Fresh v2: both baselines PASS and 10/10
  assertion-KILLED (`guest-owner-mutants-v2/`). These are process-local owners, not
  multi-process ledger exclusion, snapshot quiescence or systemd descendant proof.
- Actual elapsed-time fake-Pi probe passed with no skips/cancels: progress work
  610,676ms, silent announced tool 610,039ms, silent inference 31,042ms and compaction
  31,039ms. The single parallel test took 610,678ms, with idle/model/accept budgets
  of 30/60/5 seconds. It used an independent compiled copy and local fake children,
  not paid providers or actual manager units (`long-delivery-probe/result.log`).
  Actual 180-second CLI observation, installed OMA PTY, native macOS, trusted candidate
  checks and the full current-tree suite remain incomplete. No credentials, user OMA,
  denied process kill/service probe, commit or push was used for this follow-up.

### 2026-09-30 — DR27 Pi construction ownership follow-up (partial)

- Nine injected setup/return counterexamples first failed 9/9: delivery/Principal
  event registration, partially registered RPC input/output/error streams and UI
  setup/returned listeners. Setup now falls under the same resource owner as the
  running session. Original setup errors retain identity; delivery awaits direct
  child close; synchronous Principal refusal requests stop and returns private
  channels but is not OS-death evidence.
- Focused setup rerun: 9/9 PASS. Expanded tests for sandbox private descriptor 5/3
  transfer, failure while returning a stream, and existing failure-close scenarios:
  17/17 PASS. Interactive Principal failure also verifies startup/exit timer return,
  all private sockets and no normal onEnd callback from an unconstructed session.
- Full six-file delivery/RPC/UI/Principal/async-process/control set: 69/69 PASS,
  no failed/cancelled/skipped/todo tests (`pi-setup-scenarios.log`). A mistyped
  seventh filename matched no test; it provided no sandbox-argument coverage.
  The real `sandbox-arguments` test was then explicitly run with control/Principal:
  15/15 PASS (`pi-setup-v2-green.log`). That uses local bubblewrap children, not
  a manager, user OMA, paid provider or credential file.
- Independent setup mutants v1: 12/13 assertion-KILLED. Omitting explicit Principal
  RPC close survived because later OS stream closure eventually cleaned the reader;
  the test now asserts synchronous listener return before constructor handoff.
  The latest focused Principal/bubblewrap/control result above includes that
  stronger assertion. Fresh independent-copy v2: six group baselines PASS and
  13/13 assertion-KILLED (`pi-setup-mutants-v2/`), exit 0.
- Logs are in the session scratchpad: `pi-setup-before.log`, `pi-setup-green.log`,
  `pi-setup-expanded.log`, `pi-setup-scenarios.log`, `pi-setup-mutants/`. A test-only
  union-method TypeScript error was fixed before the red run. No source/dist mutant
  was applied to the repository. Whole-cgroup closure, synchronous failed-start
  handoff at the host and full current-tree release verification remain open.

- Current metadata regeneration: inventory/LOC/hash, dependency graph and review
  ledger refreshed. Unreviewed changed production bytes remain NOT_REVIEWED (186),
  not relabeled from historical commits. Architecture chain (inventory, rules,
  architecture, transactions, durable boundaries, documents) PASS, zero findings.
  This is structural verification, not runtime isolation/death proof.

### 2026-09-30 — DR27 frozen full-suite and real-time CLI observation (partial)

- 전체 로컬 `npm test`: **FAIL**, 2,394 tests / 2,361 pass / 33 fail /
  cancelled·skipped·todo 0, 969,396.983291ms, exit 1. 실행 입력
  `5a540ea20e2458e02defd24ce4da1e10abb61ae2deb2a660fedf2f3f1f04508f`
  (807 files)의 전후 파일 집합·SHA-256 변화는 **0**. systemd-required 9개
  파일은 로컬 lane 대상이 아니며 NOT_RUN. 실패를 통과나 환경 미실행으로
  바꾸지 않는다. 주된 실패 경계는 MIME 보존 표현, Principal 권한 축소,
  schema/operation/wire 추가에 뒤처진 fixture, 새 Society recovery owner,
  그리고 실제 host↔integration contract 의존성 순환이다. 수정 후 새 검증이 필요하다.
- 독립 compiled copy의 실제 CLI + local socket peer: **3/3 PASS**.
  125,016ms 지연 응답은 mutation 한 번으로 성공. 응답을 받지 못한
  180,008ms 경우에는 동일 key의 `operation.get` 한 번으로 receipt를 관측해
  성공. 180,005ms 경우에는 lookup도 REQUEST_NOT_FOUND여서 exit 3과
  acceptance-unknown 안내를 반환하고 mutation을 재전송하지 않았다.
  셋 모두 transport 전에 request freeze를 확인했으며 성공 receipt는 cache에
  보존됐다. 실제 provider·credentials·user manager는 사용하지 않았다.
  이는 CLI의 관측 시한이지 backend 작업 완료·취소나 실제 manager 증명이 아니다.


### 2026-10-01 — DR27 contract, failed-start ownership and wait timers (partial)

- 이전 전체 33 FAIL의 경계를 수정했다. MIME 시험은 base64 표현에서 본문을
  복원해 exact UTF-8 bytes를 검증하며, physical-effect oracle은 production
  decoder를 쓰지 않는다. legacy quoted-printable coverage와 historical contract/
  wire golden은 보존했다. Principal credential 시험은 허용된 mail 도구로 수행하고
  제거된 orchestration 도구의 부재도 확인한다. schema v3/migrations, Society와
  attestation recovery owner, default bootstrap 및 lane의 실제 시험 연결을 갱신했다.
- `TieredPolicy`를 host owner에 두고 기존 integration 경로에서 재수출해 실제
  contract cycle을 제거했다. 새 선언은 explicit syntax fixture와 negative controls,
  기존 선언은 정확한 DR27 delta projection으로 검증한다. contracts 6/6 PASS.
  architecture projection 첫 재시험은 48/49 PASS였고 historical waitRun/integrate
  shape의 두 누락을 보정한 뒤 전체 architecture-evolution 6/6 PASS
  (`dr27-architecture-recheck.log`). 현재 전체 suite의 재실행 결과는 아직 없다.
- 새 production 경계: public composition은 내부 owner가 아니라 attestation record
  함수만 전달한다. Principal constructor는 fallible RPC/UI setup 전에 직접 자식을
  HostTenure에 인계하고, failed start의 terminal/재시작 슬롯은 실제 exit 뒤에만
  회수한다. HostTenure grace와 PrincipalDelivery observation의 losing timer는
  wait가 끝날 때 취소한다. 새 수치 제한이나 작업 전체 시한은 추가하지 않았다.
- 회귀 RED는 실제 획득 전 setup, 남은 grace timer, 남은 delivery timer 3개를
  검출했다. 새 callback 거부 시 child 반환, 실제 진입점의 delayed terminal reclaim/
  restart/broker readiness까지 포함한 최신 집중 검증 **75/75 PASS**, fail/
  cancelled/skipped/todo 0 (`dr27-current-ownership.log`). typecheck와 build/package
  static 검사 PASS. installed PTY 및 임의 descendant/cgroup proof는 아니다.
- 독립 복사본 역변이 첫 실행은 8/9 assertion-KILLED. concrete owner 누출은 의도한
  assertion에서 실패했지만 함수 포함 객체의 진단 직렬화 때문에 AssertionError가
  출력되지 않아 NOT_KILLED로 남겼다. 동일 object identity를 boolean으로 비교해
  진단을 안정화한 뒤 새 복사본 v2는 baseline 다섯 그룹 PASS, **9/9 assertion-KILLED**
  (`dr27-tenure-mutants-v2/results.json`). repository의 source/dist에 역변이를
  적용하지 않았다. cleanup 실패/timeout/단순 crash를 KILLED로 세지 않았다.
- 다음 전체 실행은 입력 집합·SHA-256을 고정한다. 이전 전체 FAIL 결과는 위에
  그대로 보존한다. 실제 provider/credential/user OMA/manager/VM power cut을
  사용하지 않았고 commit/push하지 않았다. trusted candidate checks, 전수 시간
  감사, 최신 설치 PTY, native macOS 및 manager/cgroup 증명은 여전히 미완료다.

- 이번 metadata 재생성 뒤 byte-bound review가 없는 변경 소스 187개는 NOT_REVIEWED로
  유지했다. 과거 commit review를 현재 dirty bytes의 검토로 승격하지 않는다.
- 현재 구조 chain(inventory/rules/architecture/transactions/boundaries/documents)은
  PASS, 0 findings (`dr27-next-architecture.log`). 계약·composition·inventory와
  기록 결박 집중 검사는 17/17 PASS (`dr27-next-meta-tests.log`). 함께 지정했던
  `verification-lanes.test.mjs` 경로는 이 트리의 시험 파일이 아니므로 이 실행을
  lane-registry 재검증이라고 세지 않는다. 전체 로컬 runner는 실제 파일을 열거한다.

### 2026-10-01 — DR27 frozen full rerun (before VM time-owner fixes)

- `dr27-full-r2.log`: **2,402/2,402 PASS**, fail/cancelled/skipped/todo 0,
  exit 0, 969436.102215 ms. The 808 inputs bound to
  `d3079f55093b024e84ce7ff2c88f3c39f28c78346c80da36f242e58722a35f35`
  were byte-identical before and after (`dr27-full-r2-input-delta.json`: `[]`).
  This paragraph and the subsequent VM fixes are later bytes, not that run's input.
- While those inputs were frozen, isolated source-transpile probes reproduced six
  VM lifecycle counterexamples (baseline 1 PASS / 6 assertion FAIL) and a VzDriver
  EOF-as-death counterexample (baseline 1 PASS / 1 assertion FAIL). These probes
  were outside that full suite. They used fake peers, drivers and clocks; no VM,
  credentials, provider or user manager. Native Swift stop-result handling was
  inspected, not executed. DR27 remains IN PROGRESS / release-blocked.


### 2026-10-01 — DR27 total-created Worker count (partial)

- No active-Worker cap was added. Config's persistent `quota.societyAgents` now
  reads "Max created workers". Dashboard uses the same registered Resident
  population as CREATE-003, including provisioning/stopped/retired rows, excluding
  Principal. Actual active count remains a separate observation; unknown stays
  unknown. The duplicate Worker-model projection was removed.
- Typecheck and build/package static check PASS. Four focused files
  (`tui-sources`, `config-editing`, `config-generations`, `config-screen`) are
  **42/42 PASS**, fail/cancelled/skipped/todo 0, exit 0. Ten added scenarios cover
  persistent meaning, all desired/activity combinations and unknown observation.
  Logs: `dr27-quota-typecheck.log`, `dr27-quota-build.log`, `dr27-quota-tests.log`.
- Independent compiled-source copies: baseline PASS; **6/6 assertion-KILLED**
  (`dr27-quota-mutants/results.json`). Mutants drop retired/stopped slots, count
  Principal, confuse inference slots with creation quota, confuse activity with
  creation, or turn unknown into zero. Repository source/dist were not mutated.
- MEDIUM/HIGH maximum-peer-then-Principal fallback implementation was blocked by
  tool permission. Incomplete authority edits from this step were removed rather
  than leaving missing imports or an unsupported durable/wire extension. The first
  cleanup script stopped on an ambiguous anchor; exact cleanup completed, followed
  by the successful typecheck/build/focused run above. The exception remains NOT
  IMPLEMENTED, not a tested approval path.
- VM ownership test rerun remains separately permission-blocked. No VM tests or
  full suite were run in this step. The earlier 2,402-test PASS predates these
  bytes. Installed OMA PTY, native macOS, trusted candidate checks, current-byte
  architecture/inventory/review metadata and overall DR27 closure remain open.
  No provider, credentials, user manager, actual VM, commit or push was used.


### 2026-10-01 — DR27 terminal lifetime and partial acquisition (partial)

- Actual source over fake streams/manual timers reproduced 7 lifecycle assertions
  (2 baseline PASS), then 13 partial-acquisition/cleanup assertions (9 prior PASS).
  The first setup probe used an unsafe diagnostic on an absent output; the final
  RED uses 13 `ERR_ASSERTION` failures, not that harness TypeError. Timers/listeners
  are returned with their owner; final restore is idempotent and setup failure
  returns already-acquired modes. A cleanup failure cannot stop other returns or
  erase the primary failure. Existing P0-4 applies; no new task-wide deadline.
- Latest typecheck and build/package static check PASS. Source ownership,
  composition, UI channel and local terminal PTY suite **72/72 PASS**, plus T112
  **2/2 PASS** and P0V-79 **2/2 PASS** (total **76/76**, no skips or cancellations).
  The ownership file itself is **22/22 PASS**. Logs: `dr27-panel-typecheck.log`,
  `dr27-panel-build.log`, `dr27-panel-adjacent.log`, `dr27-panel-surface.log`,
  `dr27-panel-cursor.log`, `dr27-panel-setup-red.log`, `dr27-panel-setup-green.log`.
- Independent source-copy mutants: baseline PASS, **15/15 assertion-KILLED**
  (`dr27-panel-mutants/results.json`). The first run found one surviving timer-
  retention mutant: suppressing its callback was not proof of returning the timer.
  The test now asserts immediate timer removal as well as fencing a late callback.
  No source/dist mutation, timeout or mere process crash was counted as KILLED.
- PTY results cover production screen/key handling, split UTF-8, resize, normal
  quit, abrupt process exit and rejection, with echo/canonical mode restored. They
  are NOT an installed-OMA product-screen check or real-provider validation.
- After the Human asked to continue, the normal VM-test retry was denied again:
  the tool did not accept the general policy-override request as specific renewed
  permission. `dr27-vm-resumed.log` is not a test result: the command did not run.
  No alternative route was attempted. Reviewer-shortage exception implementation
  remains unimplemented; this terminal evidence makes no claim about it. Overall
  DR27, latest full suite, time audit, trusted checks, metadata and native proof
  remain open. No user OMA, credential, paid provider, VM power cut, commit or push.


### 2026-10-01 — DR27 project session queries and broker stop ownership (partial)

- The former singleton session-directory callback reproduced three assertion
  failures: an old timeout discards a newer query, an old answer settles a successor,
  and failed send retains its timer (`dr27-session-dirs-red.log`). Per-query ownership
  now passes **15/15** source scenarios plus the parent composition ID-echo scenario.
  Independent source-copy mutants: baseline PASS, **10/10 assertion-KILLED**
  (`dr27-session-dirs-mutants/results.json`). Initial incomplete-Promise mutant runs
  were invalid, not kills; bounded microtask assertions removed that harness gap.
- Typecheck/build and combined UI regression **96/96 PASS** preceded the broker
  change. Actual pinned Pi/Open TUI, temporary HOME and loopback scripted inference:
  normal conversation and `/resume` return **2/2 PTY PASS**, including terminal-mode
  restoration. This is not installed-user-OMA or native macOS proof; no real credential,
  paid provider, user manager or VM was used.
- Broker fake-child/manual-clock source scenarios initially yielded 2 PASS / 3
  assertion FAIL (`dr27-broker-owner-red.log`); current expanded ownership suite is
  **8/8 PASS**. It checks actual exit versus stop request, concurrent stops, timer
  return, late callbacks, registration write failure and generation correlation.
  Typecheck and build/package static check PASS after the production broker change.
  Source/composition/socket observation regression is **65/65 PASS**
  (`dr27-broker-adjacent.log`), fail/cancelled/skipped/todo 0.
- Independent broker source copies: baseline PASS, **10/10 assertion-KILLED**
  (`dr27-broker-mutants/results.json`). An ambiguous replacement stopped the first
  script before a verdict. A subsequent generation-fence mutant survived because
  registration refusal alone did not check a stale readiness notification; asserting
  the actual notification closed that test gap. No timeout or crash counts as a kill.
- Stand-in broker processes over the real private socket/codec pass **12/12**
  selected T115 channel, refusal, restart and stop cases (`dr27-broker-channel.log`).
  The tests use temporary local children, not a real society or service manager.
- Reviewer-shortage exception and VM ownership rerun remain permission-blocked and
  were not attempted here. No full suite ran: the historical 2,402-test result is
  not evidence for these bytes. Complete time audit, trusted candidate execution,
  inventory/review metadata, installed UI and native proof remain open. No commit
  or push. DR27 remains IN PROGRESS / release-blocked.


### 2026-10-01 — DR27 guest terminal exit and app input closure (partial)

- Guest session source over fake PTY/child/manual time: **1 PASS / 8 assertion
  FAIL** before the fix (`dr27-guest-session-red.log`), **9/9 PASS** after. Signal
  failure and live-child error do not become an end; no-pid spawn failure waits
  for close; drain timers are returned and exited children are not signalled.
  **9/9 independent source-copy mutants assertion-KILLED**
  (`dr27-guest-session-mutants/results.json`). An initially surviving redundant-
  timer mutant prompted an assertion on acquisition count, not merely final absence.
- Selected actual Linux PTY session-holder cases **9/9 PASS**
  (`dr27-guest-session-pty.log`): attach/takeover, disconnect/reconnect, final output
  before exit and catchable stop signals. No VM, VM lifecycle test, native Mac,
  actual service manager, user OMA or provider was involved.
- TUI partial-input ownership reproduced **3/3 assertion FAIL**
  (`dr27-app-red.log`): no final return, old callback consuming new partial input,
  and same-read input after quit. App/entry now close input before async shutdown,
  relaunch or crash; the decoder and timer are returned together. App+composition
  **74/74 PASS** (`dr27-app-green.log`). Source-copy mutants **7/7 assertion-KILLED**
  (`dr27-app-mutants/results.json`), including missing decoder return.
- Latest typecheck and build/package static check PASS. Actual Pi/Open TUI normal
  and `/resume` return, temporary HOME and loopback scripted provider, **2/2 PASS**
  (`dr27-app-open-tui.log`). This is real engine/UI with fake inference, not an
  installed-user-OMA end-to-end proof. The preceding combined owner regression was
  **111/111 PASS** (`dr27-owner-combined.log`) before the subsequent app change.
- A lexical time-use inventory found 199 matching lines in 65 source files
  (`dr27-time-inventory.txt`). This is navigation, NOT a completed time audit;
  injected clocks, native timers and semantic ownership still need review.
  Guest partial-construction cleanup and interactive selector/deferred-callback
  lifetime are not covered by the fixes above. Previous reviewer/VM permission
  boundaries remain in force. No full suite, commit or push; DR27 is not closed.

### 2026-10-01 — DR27 display poll and interactive UI generations (partial)

- Display poll callbacks and in-flight/initial status replies are fenced by final
  app closure. Shutdown, crash and relaunch return the interval immediately;
  a disowned host still keeps its observation-only display until the Human quits.
  Source composition suite expanded to 49 cases. The initial test that equated
  disowning with app closure was corrected to preserve TUI-004's Control Panel.
- Interactive host source over fake engine/UI boundaries: original 1 PASS / 8
  assertion FAIL; `/resume` stale selections added 2 assertion failures. Current
  29 cases pass, including model/effort for both roles, quit/resume/new/fork/reload,
  replacement UI generations, consumed timers and channel loss during init.
  These fences do not cancel or roll back an engine `setModel` already invoked.
- Latest source-copy mutation run: interactive UI 15/15 and display poll 6/6
  assertion-KILLED, both baselines PASS (`dr27-ui-mutants/results.json`). A late
  Worker model mutant initially survived because its fixture had no reasoning
  choices; a reasoning-capable late model now exposes the forbidden effort UI.
- Typecheck/build PASS (`dr27-ui-final-build.log`). Actual Pi/Open TUI with local
  scripted inference, normal and resume PTY: 2/2 PASS (`dr27-ui-pty.log`). No real
  provider, user OMA, VM or user manager involved. New Personal mode is not yet
  implemented by this evidence. Full suite, native platform proof and remaining
  DR27 work stay open; no commit or push.

### 2026-10-01 — DR28 session-mode foundations (historical checkpoint; execution then blocked)

This is the initial, pre-authorization checkpoint, not the current implementation
status. The later DR28 execution checkpoint below supersedes its availability claims
without promoting these foundation tests to integrated execution evidence.

**At this checkpoint, not a usable Personal mode.** The independent chooser, immutable birth record,
Personal extension preferences and platform metadata composition exist; real startup,
Personal engine/Config, resume/new/fork, legacy project-binding validation, history
writer lifetime and Mac entry wiring do not. The Linux entry explicitly rejects
`--mode personal` with exit 4 before data/engine/Society preparation. The chooser PTY
is the actual standalone chooser, not an installed Personal engine E2E.

- Birth publication keeps the first mode/id/cwd/history bytes. Corrupt/unknown/linked
  records never select another mode. History layout locates a record but is not
  evidence that a legacy Society exists or that its project binding is valid.
- Personal preferences use a separate locked read/validate/transform/atomic replace,
  preserving role settings. Existing package reconciliation and extension digest
  validation are reused. Package removal, disabled choices, missing/changed assets,
  corrupt documents and lock contention have focused normal/failure coverage.
- Selection owns raw terminal, decoder, pending timer and listeners until completion.
  Stream close without end, partial acquisition, cleanup errors, resize failure,
  paste and same-read late keys are exercised. Real PTY checks confirm Enter defaults
  to Society, Down/Enter selects Personal, Escape/Ctrl+C cancel and terminal echo,
  canonical input and alternate screen return. Selecting Personal here only returns
  a value to the test fixture; no agent is started.
- User metadata composition lives in `src/runtime/user-files.ts`, not the kernel
  storage layer. Linux still uses held-directory primitives. Darwin reuses host file
  publication plus `ensureHostUserDirectory`; Linux-hosted injected-platform tests
  are not native Mac durability proof. The chooser's pure rendering uses the view
  seam; only the app and pre-session chooser may cross it. UUID v4 reuses the canonical
  domain grammar. Initial static gate findings for layout access, path-taking mkdir
  and duplicate UUID grammar were fixed rather than disabling the checks.


- A focused platform-injected settings run first reproduced a Darwin-only missing
  hardlink refusal (12/13 passed; `mode-platform-settings-red.log`). Existing Linux
  retry tests already required this refusal. `prepareEngineFile` now has one locked
  read/transform/replace flow through user-files rather than a second platform parser.
  Its `singleName` request is checked on the opened inode. That restriction is not
  imposed on immutable birth publications: a crash between link and temporary removal
  can legitimately leave two names for the same published fact (P0-2/P0-3/P0-4).
- `test/pi-settings-platform.test.mjs` has 18 Linux/Darwin cases: defaults, preserved
  choices, malformed/oversize/invalid UTF-8 input, both link kinds, every interactive
  settings file, lock contention, read IO, pre-replacement and visible-then-error
  retries. It starts no engine. Two additional metadata cases assert that the
  immutable hardlink remains readable while a mutable single-name read refuses it
  and returns its descriptor. These 20 cases are included in 219, not added again.
  Injected errors after an ordinary replacement are logical retry evidence, not a
  failed-fsync or power-loss proof.

Latest focused evidence (after the ownership moves, UUID deduplication and engine-settings unification):

| Gate | Result | Scope |
|---|---|---|
| `npm run typecheck`, `npm run build` | PASS | package static check included; `mode-build-8.log` |
| Focused Node tests | **219/219 PASS**, no skip | `mode-focused-9.log`; exact files below |
| Standalone chooser actual PTY | **4/4 PASS** within 219 | no credential, model, broker or VM |
| Source-copy mutations | **22/22 assertion-KILLED**; 5 baselines PASS | `mode-mutants-9.log`, `mode-mutants/results.json` |
| `npm run check:architecture` | PASS | inventory, rule modules, DAG, transactions, boundaries, document links; `mode-static-8.log` |
| Production measurement | 330 files, 33,790 code lines | pinned cloc 2.08, `mode-loc-8.log`; informational, not runtime proof |
| `npm run review:ledger` | regenerated, no review promotion | `mode-review-ledger-9.log`; 197 NOT_REVIEWED, 42 READ_UNCHANGED, 91 CHANGED_WITH_ORACLE, 1 REMOVED |
| `git diff --check` | PASS | whitespace only |

The focused command, following a successful build, was:

```sh
node --import ./scripts/local-test-guard.mjs --test \
  dist/test/session-mode-record.test.js dist/test/personal-settings.test.js \
  dist/test/host-arguments.test.js dist/test/pi-runtime.test.js \
  dist/test/pi-packages.test.js dist/test/session-mode-pty.test.js \
  test/session-mode-selection.test.mjs test/user-files.test.mjs \
  test/pi-settings-platform.test.mjs \
  test/terminal-ownership.test.mjs test/oma-composition-policy.test.mjs \
  test/surface-rules.test.mjs test/architecture-rule-modules.test.mjs \
  test/durable-boundaries.test.mjs
```

TMPDIR and logs were in this session's scratchpad:
`/tmp/claude-1001/-home-dev-oma-v2/9ba58572-1708-4d64-b456-477ff9f48f38/scratchpad`.
The existing Pi retry scenario uses only its local scripted provider. No user's
running OMA, real credentials, paid provider, user manager or VM was used.

Mutation subjects and exact SHA-256 bytes:

| Subject | SHA-256 | Mutants |
|---|---|---|
| `src/tui/session-mode.ts` | `ee9c005a49eeefecb89dd2102e8104f1bc18ee1c833ae8527e090eb9474b5b5d` | timer not returned, close ignored, terminal not restored, wrong default, late same-read work |
| `src/runtime/session-mode.ts` | `da7e00e341a72d7a6e39a5d6f5f4d598b3ce9b6d1de973c44a79f699f5095bf1` | override allowed, conflict ignored, foreign history accepted, birth overwritten |
| `src/runtime/personal-settings.ts` | `073841742c5e326bc7a4c8fb9063fab992ca3a6eecd63d8461ac9252e87e0e09` | lost selection, no reconciliation, core copied in seed, settings not saved |
| `src/runtime/user-files.ts` | `50ec1d1a735be14a23c1351940867011b191eff14988c0fb562fb9c24d29fab2` | single-name check omitted, immutable hardlink refused, IO treated as absence, existing destination not flushed |
| `src/runtime/pi-runtime.ts` | `3d35454b99728b25b8d6eae7f9c43d7444722821a3aa960c969da2ae5bbc347c` | single-name request omitted, choices lost, settings not saved, lock retained, unchanged bytes rewritten |

The initial late-key mutant survived because terminal.draw itself ignored work after
restore; the test now observes forbidden geometry reads too. Core seed copying
initially raised an unasserted STORE_CORRUPT; an explicit successful-seeding assertion
now kills it. Neither initial result was counted as assertion-KILLED. Mutants ran
against source copies; production files were never replaced by mutated versions.

At the foundation checkpoint MODE-001..006 were **unverified / NOT_RUN for integrated
execution** in traceability, and MODE-002/004 linked only preparatory library
entrypoints. New durable registry entries attested logical retry/restart coverage,
not SIGKILL, power loss or complete crash recovery. Review-ledger lane PASS labels
were historical inputs, not new full-lane runs.

Personal source creation was then blocked pending explicit authorization for builtin
shell/file tools without a separate sandbox or per-action approval gate. The denied
files had not been written at that checkpoint. The subsequent explicit Personal
implementation approval did not authorize denied reviewer-shortage/VM/service work,
real credentials or paid providers. Full npm test, native macOS, history-writer
concurrency and release remained open. These in-process settings tests did not prove
all host temporary cleanup/close failures or crash durability.

### 2026-10-01 — DR28 connected Linux execution (partial; native Mac and lifetime proof open)

Following the Human's explicit Personal implementation approval, the birth router
selects Society or Personal before startup. Linux Personal launches its own host and
bundled Pi/Open TUI, builtin file/shell tools and explicitly selected extensions.
The Society Principal remains read-only. Personal preferences and engine settings
are independent of role preferences; resume admits the stored birth and Pi header,
new returns to the chooser, and same-birth fork stays in the same mode.

The connected checkpoint after the shared host-loss owner, chooser/view separation
and runtime product-boundary extractor changes (superseded by the owner verification
below):

| Gate | Result | Scope |
|---|---|---|
| `npm run typecheck`, `npm run build` | PASS | static package check; no native/service attestation |
| Focused Node regression | **234/234 PASS**, no skips | `mode-current-regression.log`; exact files below |
| Installed Personal actual PTY | **9/9 PASS** within 234 | tools, Config, empty extensions, extension reload, new, resume, fork, retry, cancel |
| Standalone chooser actual PTY | **4/4 PASS** within 234 | Enter, Down/Enter, Escape, Ctrl+C; terminal restoration |
| Isolated installation closure | **3/3 PASS** within 234 | no module/file resolution into the source tree |
| Durable-boundary registry | PASS, 0 findings; **4/4 policy tests** within 234 | D05 publication owner moved to `src/entry/oma-society.ts#main`, existing crash-test links retained |
| Surface rule controls | **19/19 PASS** within 234 | dynamic import/require, erased type exports, standalone product roots, CLI/Resident separation |
| `npm run check:architecture:rules` | PASS, 0 findings | static source rules only |
| Production source inventory | 340 files generated | measurement/hash refresh is separate; inventory generation is not runtime proof |

The focused command, following a successful typecheck/build, was:

```sh
node --test \
  test/session-mode-selection.test.mjs test/session-entry-composition.test.mjs \
  test/surface-rules.test.mjs test/durable-boundaries.test.mjs \
  test/oma-composition-policy.test.mjs test/personal-models-composition.test.mjs \
  test/user-files.test.mjs dist/test/session-mode-record.test.js \
  dist/test/session-history.test.js dist/test/personal-settings.test.js \
  dist/test/session-mode-pty.test.js dist/test/personal-pty.test.js \
  dist/test/deployment-artifact.test.js
```

Environment: Node 24.21.0, TypeScript 5.9.3, bundled Pi and Pi TUI 0.87.1,
pi-open-tui 0.3.9, Linux 6.12.107+deb13-amd64. TMPDIR and logs use the scratchpad
listed in the foundation checkpoint. Installed `oma --mode personal` runs in a
fixture HOME/data/run/project with a loopback scripted provider. Its builtin
read → write → edit → bash plus a selected local extension produce the expected
`monitor=edited\nshell=done\n` in a temporary user-directory `hyprland.conf`
outside the fixture project. Requests contain no Society prompt/core tools, and
only `.engine`, `.packages` and `.personal` appear in its data root. Config and
extension reload assertions inspect the saved settings and subsequent requests.
The fork case calls upstream `ctx.fork` from a fixture command; it is not evidence
for the original fork selector UI. PTYs verify echo/canonical input and alternate
screen return. Router composition injects effect boundaries, including Darwin;
it does not start a real broker, service or VM.

The split Society entry retains D05 publication ownership; the birth-only router
has no fake drain. Product closure rules share the dependency graph extractor for
literal `import()`/`require()` and runtime re-exports, and start from every declared
host entry even when no router edge reaches it. Two new controls failed before the
rule change and passed afterwards. No arbitrary nonliteral import resolution is
claimed. The registered crash injection counts are static test-link classifications,
not actual SIGKILL executions in this run.

Source-owner links name actual launched entry paths. At that checkpoint MODE clauses
remained **unverified** as whole contracts: the focused Linux results did not discharge
concurrent history opening, parent-death/inherited-lock proof, partial process
acquisition, all engine shutdown/reload races, Mac package/guest history bridging
or native Mac build/Keychain/entitlement execution. The historical 22 foundation
mutants and old LOC/hash/lane records are not current-byte proof for later changes.
Full npm test, independent denied reviewer/VM/service outcomes, DR27/S-08/S-10 and
release remain open. No real credentials, paid provider, running user OMA, user
manager or VM was used. No commit or push. architecture.md remains at N-001's
`ae9b2d026e62f77e0c9ff3f5ca0a3b6efea5b8582f0a6acaf2ecd30b325a5905`.

### 2026-10-01 — DR28 process/history and engine owner verification (partial)

P0-4/P0-5 and MODE-003/005 derive these fixes. The initial main architecture check
refused raw `child_process` in `src/runtime/personal-session.ts`. It now delegates
to `src/process/async.ts#spawnSessionInteractive`, an existing concrete subprocess
owner. That mechanism validates direct-spawn inputs, uses `shell: false`, inherits
the Human terminal at FD0/1/2 and the history lock at FD3, and reserves FD4 for IPC.
Its registered fence reason is a separate Human session with no Society role/state/
lease; Personal was not added as another raw-spawn owner and no gate was disabled.

The history owner rechecks the pinned inode immediately before spawn. It keeps the
lock through exit, IPC disconnect, child error and signal forwarding, and returns it
only on actual close. Nonzero/signal/unobserved close cannot authorize a queued next
session. Partial message/signal listener acquisition requests cleanup but retains
the lock until close; cleanup attempts all listeners and preserves primary errors.
A forwarded signal that throws or returns false is not treated as a dead child, and
an already exited child's PID is never signalled again.

Upstream InteractiveMode disposes its runtime before directly calling process.exit.
Personal therefore owns an idempotent runtime disposal handoff, not merely a finally
after run: it attempts active-turn abort, SDK disposal and awaited credential-helper
close, retaining failures. Initialization/constructor/run/stop/disposal failures
still attempt every acquired owner. The temporary stdout hint writer preserves its
receiver, encoding/callback arguments and backpressure and is restored on returning
paths. Package version comes from the installed manifest. New/resume requests carry
the outgoing UI epoch, serialize replacement admission and recheck at the effect
boundary; late admission/before-switch results and old selectors cannot act on a
replacement. Redundant checks at both the hook result and transition initially made
two individual mutants equivalent; the redundant hook check was removed, retaining
one current-epoch transition decision. All remaining named mutants are killed.

| Verification | Result | Boundary of the claim |
|---|---|---|
| `npm run typecheck`, `npm run build` | PASS | static package check, not native attestation |
| Connected related regression | **336/336 PASS**, no skips | `personal-current-regression.log`; command below; before the second real-process case was added |
| Installed Personal / chooser / installation closure | **9/9**, **4/4**, **3/3 PASS** within 336 | loopback scripted provider and temporary HOME/data/project; original fork selector still not tested |
| Additional owner regression | **78/78 PASS**, no skips | 2 real Linux history/process cases + 21 Personal engine composition + 26 controlled Keychain client + 29 Society interactive UI owner cases |
| Process/product-boundary source-copy mutations | **21/21 assertion-KILLED**, baseline PASS | no timeout/import/syntax failure counted as KILLED |
| Personal engine source-copy mutations | **13/13 assertion-KILLED**, baseline PASS | disposal/helper handoff, error preservation, stdout, stale/concurrent transitions and version owner |
| graph / LOC / hashes / inventory | PASS; **340 files, 34,522 code lines** | `SOURCE_LIST_CURRENT`, `SOURCE_BOUND`, `runtimeProof: false` |
| architecture rules and main gate / transactions / durable registry / documents / package / diff | PASS | zero findings; registry injection counts are links, not newly executed crash coverage |
| trace owner inventory | 371 clauses inventoried | MODE-003/005 point to launched entries, process mechanism and new negative tests; whole MODE contracts remain unverified |
| review ledger regeneration | completed | 210 NOT_REVIEWED, 42 READ_UNCHANGED, 88 CHANGED_WITH_ORACLE, 1 REMOVED; historical lanes are not current-byte certification |

The connected command after successful typecheck/build was:

```sh
node --test \
  test/session-mode-selection.test.mjs test/session-entry-composition.test.mjs \
  test/surface-rules.test.mjs test/durable-boundaries.test.mjs \
  test/oma-composition-policy.test.mjs test/personal-models-composition.test.mjs \
  test/user-files.test.mjs test/personal-session-ownership.test.mjs \
  test/session-process-owner.test.mjs test/personal-engine-ownership.test.mjs \
  test/traceability-policy.test.mjs test/architecture-rule-modules.test.mjs \
  test/r34-owner-policy.test.mjs dist/test/session-mode-record.test.js \
  dist/test/session-history.test.js dist/test/personal-settings.test.js \
  dist/test/session-mode-pty.test.js dist/test/personal-pty.test.js \
  dist/test/deployment-artifact.test.js dist/test/r37-async-process.test.js \
  dist/test/personal-history-lifetime.test.js
```

The later additional owner command was:

```sh
node --test dist/test/personal-history-lifetime.test.js \
  test/personal-engine-ownership.test.mjs test/keychain-client-ownership.test.mjs \
  test/interactive-host-ownership.test.mjs
```

The real-process history fixture confirms FD3's device/inode, concurrent admission
refusal and no handoff before direct-child close. The second case starts a fixture
parent through the production Personal launcher; that parent deliberately exits
without running finally. The live child retains the lock, a new admission is
refused, and the lock becomes available only after that fixture writer exits. This
is actual Linux parent-exit/descriptor inheritance, not SIGKILL, power loss,
descendant cleanup or native Mac proof. These cases do not execute Pi or a provider.
The async-process suite starts/cleans only its own fixture children; no running user
OMA/VM or previously denied process was touched.

Exact current mutation subject SHA-256 values:

| Subject | SHA-256 | Mutants |
|---|---|---|
| `src/runtime/personal-session.ts` | `5e0c2a0409c7798b3965eff4171ca2628a5fd75c2a092b0761dda6ff9cb7df94` | 10 history/environment/lifecycle controls |
| `src/process/async.ts` | `e18e310a4b21eb59d2bf773bc088ef478031b6e815498dfd1ab4adc2c199fda8` | 4 descriptor/validation/shell controls |
| `scripts/architecture/rules/surface-rules.mjs` | `388c6694e2cfdc5d0461570c85400aab85c40ae6568ab1ed83a606272f0a8ba0` | 7 runtime closure/product surface controls |
| `src/entry/pi-personal.ts` | `6ad205beb07fa4ddfbc98aed1598ffc06552faf20b1c09ebe66198567c68ab35` | 13 engine ownership/transition controls |

Reports, mutation logs and runner copies are in the session scratchpad named above:
`personal-owner-mutants.json`, `personal-engine-mutants.json`, `personal-mutant-*.log`
and `personal-engine-mutant-*.log`. Production sources were never mutated. The first
process-mutant run had 19 KILLED and 2 INVALID; the fixture was corrected to emit
actual exit then close and to close an unexpected lock-admission child before the
assertion. Only the subsequent 21 assertion-KILLED results count. The initial engine
run's two SURVIVED redundant checks are not represented as KILLED.

Still open: first close-listener acquisition failure, all reload/resource-creation/
fork/init/emergency-crash paths, descendant cleanup, cross-platform package/history
bridging and native Swift/Keychain/entitlements. Controlled helper close composition
is not actual Mac helper execution. Full npm test and independently denied reviewer/
VM/service outcomes remain unrun; DR27/S-08/S-10 and release remain incomplete. No
real credential, paid provider, user runtime, commit or push was used. MODE clauses
remain unverified as whole contracts rather than promoted from these partial passes.

### 2026-10-01 package/mode/extension connected checkpoint (partial, DR25/DR28)

Scope: MODE-001/003/004/005/006, the existing DR25 package store and P0-2/3/4/5.
This checkpoint preserves the earlier records; overlapping suites are not summed
as unique coverage. It does not certify whole MODE clauses or a release.

Latest `npm run typecheck` and `npm run build`: **PASS**. Build reports
`STATIC_PACKAGE_CHECKED`; it does not start the listed entries or attest native
systemd/kernel/rootfs/Swift/Pi deployment pins.

The latest built-entry/source-composition connection: **170 PASS**, fail/cancelled/
skipped/todo all zero, duration 12,547.737298 ms:

```sh
node --test --test-reporter=tap \
  test/engine-login-ownership.test.mjs \
  test/package-command-ownership.test.mjs \
  test/session-entry-composition.test.mjs \
  test/oma-composition-policy.test.mjs \
  dist/test/personal-settings.test.js \
  dist/test/pi-packages-cli.test.js dist/test/pi-packages.test.js \
  dist/test/platform-packages.test.js dist/test/socket-names-fixture.test.js \
  dist/test/extension-modules.test.js
```

This is 12 engine-launcher, 26 package-owner, 38 birth-router, 57 Society-composition,
9 Personal-settings, 12 Linux-package, 7 Mac-package, 2 socket-fixture and 7 actual
bundled-loader/native-ESM-cache cases. Effects use temporary fixture stores, the
loopback npm registry and owned local child/services; no real VM or provider.
Malformed Mac Society observations (including actual undefined, duplicate identity
and valid-prefix/malformed-tail) cannot become an empty list, partial display or
attach decision. Display and selection use the same observation owner.

Installed-entry PTY checkpoint: **25 PASS**, fail/cancelled/skipped/todo zero,
duration 100,854.856712 ms. Personal 13 cases cover tools/outside-fixture-file editing,
Config, empty/selected extensions, new/resume/fork/fork UI/fork cancel, successful and
failed reload, retry and cancellation. Society 8 cover normal/resume/kill/mail/retry
recovery/retry exhaustion/successful and failed reload. Four birth-chooser cases
cover Enter default Society, Down+Enter Personal, Esc and Ctrl-C. These ran with
isolated HOME/data/project and a loopback fake provider before the Mac observation
helper change; they are unchanged Linux UI evidence, not native Mac proof.

Source-copy mutation checkpoints (production sources not mutated):

| Subject | SHA-256 | Result |
|---|---|---|
| `src/tui/login.ts` | `b3d457d07663ee405f332cd4082a311e95d84088fa3bc78b4f2ce333310349af` | baseline PASS; 10 assertion-KILLED |
| `src/entry/oma-mac.ts` | `1d422edbe2a7544901a7090bda24fecb63aa6894ef402ef33030f1ca2160d6a9` | baseline PASS; 6 assertion-KILLED |

Engine controls cover finish-on-exit/error, forgotten error, null/signal/nonzero
close interpreted as success, wrong store, omitted package arguments, foreign
engine environment and omitted caller fence. The first finish-on-exit run was
INVALID (incomplete TAP); only the subsequent direct early-return assertion run
counts as KILLED. Mac controls remove identity uniqueness/shape, running shape,
turn failed observation into empty, or bypass the owner in display/selection. All
counted mutants ended nonzero with ERR_ASSERTION and no cancelled tests; timeout,
signal, syntax/import/runtime harness errors are not KILLED.

The earlier package-owner report has 20 named assertion-KILLED controls, not 20
independent defect types: Darwin sync-before-personal deleted the Personal line
rather than inverting the effects and duplicates skip-personal semantically.

Artifacts remain in
`/tmp/claude-1001/-home-dev-oma-v2/9ba58572-1708-4d64-b456-477ff9f48f38/scratchpad`:
`package-mac-connected-current.log`, `modes-installed-current.log`,
`engine-login-mutants/results.json`, `mac-observation-mutants/results.json`,
`engine-login-mutants.mjs`, `mac-observation-mutants.mjs` and their per-mutation logs.
They are session-local evidence, not durable release artifacts.

Pinned cloc 2.08 measurement and required fresh remeasurement: **SOURCE_BOUND**,
**341 production files / 34,659 code lines** (prior partial checkpoint: 340 / 34,522).
The new inventory includes `src/runtime/extension-modules.ts`; exact source/report
hashes were generated, not inferred from inventory-only. Current module code lines:

| Module | Code lines at HEAD 649ea6e | Current code lines |
|---|---:|---:|
| `src/entry/oma-mac.ts` | 59 | 133 |
| `src/entry/oma-society.ts` | 0 (not at HEAD) | 639 |
| `src/tui/login.ts` | 22 | 26 |
| `src/runtime/extension-modules.ts` | 0 (not at HEAD) | 37 |
| `src/runtime/personal-settings.ts` | 0 (not at HEAD) | 99 |
| `src/entry/pi-personal.ts` | 0 (not at HEAD) | 269 |
| `src/entry/pi-interactive-host.ts` | 0 (not at HEAD) | 505 |

HEAD comparison includes inherited working-tree changes and is not this checkpoint's
edit count. Source measurement integrity has `runtimeProof: false`. Owner links
include package reconciliation/actual engine close/extension-generation ownership
and the shared Mac observation owner; changed links invalidate trace evidence rather
than promoting it. Byte-bound file reviews are recorded only for files read in full,
with explicit limits; historical lanes do not certify these current bytes. Review
ledger regeneration initially refused an oracle written as `engine login` because
the declared test name is templated; the input now names the existing `engine`
prefix. The gate was rerun, not treated as a successful first run.

Static checkpoint: required source measurement, architecture rule/main gates,
transaction boundaries, durable-boundary inventory, document integrity, static
package check and `git diff --check` all **PASS**. These gates do not execute the
recorded SIGKILL boundaries. Trace inventory has 371 clauses; MODE stays unverified.
Generated review ledger: 208 NOT_REVIEWED, 42 READ_UNCHANGED, 91 CHANGED_WITH_ORACLE,
1 REMOVED. This is not review closure or release approval.

No new DB schema, wire method/state, service or error code was introduced at this
checkpoint. Still open: package/settings cleanup failure beside the primary error,
partial listener acquisition, cross-project reconciliation crash recovery, native
Mac locks/Swift/Keychain/entitlements, Mac first project-extension seed and guest
Society-history/host Personal bridging. Full npm test was not run; independent
reviewer/VM/service blocks were not retried. DR27/S-08/S-10 and release remain
incomplete. No credential file, paid provider, running user OMA/VM, commit or push
was used. Whole MODE clauses remain **unverified / NOT_RUN**.

### 2026-10-01 owned cleanup / current installed UI checkpoint (partial, DR25/DR28)

ORDER-002 scope: MODE-003/004/005/006 and the existing P0-2/3/4/5,
MAC-619..622/701 file/settings owners. The error meaning stays with
`domain/errors.ts#primaryFailure`; `process/cleanup.ts` owns only synchronous and
asynchronous effect/return composition. Both failures are retained in order,
including thrown null/undefined. Async effects settle before cleanup, which is
also awaited. A cleanup-only failure is not success. This is not a new exception
principle, publication retry policy or proof of all cleanup sites.

Specific corrections: ProcessLock returns an acquired descriptor once even if
close fails; contained open returns an untransferred result if its pin/root close
prevents transfer; HostTemporary owns one close and still attempts name removal
after failure. Archive input ownership starts before output acquisition and the
output is returned before the input. Snapshot partial publication, engine/settings
writer locks, user-file readers and controlled Keychain writers retain their
primary beside cleanup. Mac packages own installation-location resolution through
engine/index/Personal reconciliation/guest synchronization and actual return.
Linux packages still use SocietyLease; controlled throwing-release behavior is not
claimed as actual Linux close-error reporting.

Latest typecheck and build: **PASS** (`b1o3bu3hr.output`, entire chain exit 0).
Latest connected runs (`bnop84k65.output`, all stages joined with `&&`, exit 0):

| Suite | Result | Duration |
|---|---|---:|
| Expanded cleanup/files/settings/archive/snapshot/error boundaries | 231 PASS, fail/cancelled/skipped/todo 0 | 3,355.471852 ms |
| Package/mode/extension connection | 177 PASS, fail/cancelled/skipped/todo 0 | 12,695.440448 ms |
| Current installed entry / actual Society UI / birth chooser PTY | 25 PASS, fail/cancelled/skipped/todo 0 | 101,094.617007 ms |

The expanded command was:

```sh
node --test --test-reporter=tap \
  test/owned-cleanup.test.mjs test/user-files.test.mjs \
  test/package-command-ownership.test.mjs test/pi-settings-platform.test.mjs \
  test/session-entry-composition.test.mjs \
  dist/test/personal-settings.test.js dist/test/pi-runtime.test.js \
  dist/test/platform-archive.test.js dist/test/platform-snapshot.test.js \
  dist/test/platform-host-resolver.test.js dist/test/durable-fs-faults.test.js \
  dist/test/project-preparation-boundaries.test.js dist/test/p24-owner-guards.test.js \
  dist/test/error-phase-invariants.test.js dist/test/socket-names-fixture.test.js
```

The package/mode command has the same file list as the prior 170-case checkpoint;
seven Darwin package cleanup-outcome assertions now bring it to 177. Counts overlap
and are not summed as unique coverage. The installed PTY run used
`dist/test/personal-pty.test.js`, `dist/test/open-tui-pty.test.js` and
`dist/test/session-mode-pty.test.js` with session-local TMPDIR and a transparent
Python wrapper preserving the original PTY JSON/ANSI. Personal 13, Society 8,
chooser 4 all ended and restored echo/canonical input. The expected Personal
reload-failure child exit was 1, not success. Saved tools/Config/resume screens were
read: Personal outside-project fixture read/write/edit/bash and selected extension,
fixed-mode Config model→effort and Personal-labelled resume retain upstream UI;
Society header/editor/mail/queued-input/settings and cancelled resume remain.
The empty Society current-folder resume fixture proves cancellation, not a populated
Society selection. Offline fixture warnings for missing fd/rg are not a product
installation or downloaded-tool proof. No real credential/provider was used.

The initial expanded run was **221 PASS / 8 FAIL of 229**, all eight archive/snapshot
fixtures failing `listen EINVAL` from a Unix socket path longer than sun_path.
Existing `holdSocketNames` now holds the canonical fixture root and redirects only
socket transport through its owned `/proc/<parent>/fd/<fd>` alias. Metadata paths,
containment checks and production path policy remain unchanged. Cleanup is
registered before later fixture acquisitions; holder ownership ends after actual
close. The socket fixture's two existing tests raised the run to 231. Linux-only
transport adaptation is not native Mac proof.

Current-source-copy cleanup controls: **9 baseline PASS / 17 assertion-KILLED**.
Production sources were not mutated. Controls cover replaced/truthy/reversed primary,
unawaited effect/cleanup, repeated lock close, untransferred descriptor leak, repeated
temporary close/forgotten removal, omitted replacement discard, archive input leak
and constructor cleanup, snapshot discard, engine parent leak, post-open ENOENT
absence and package-location resolution outside its owner. The constructor control
initially produced a test-oracle TypeError and was **INVALID**; it was not counted.
After an explicit AggregateError assertion and invalid-harness classification were
added, the actual rerun assertion-killed it. Complete TAP, no cancelled/skipped
tests and ERR_ASSERTION are required; timeout/signal/syntax/import/TypeError/RangeError
are not KILLED. Mac observation baseline PASS and six assertion-KILLED controls were
also rerun against current `oma-mac.ts` bytes, not inherited from its earlier hash.

Artifacts in the same session scratchpad: `cleanup-regression-current.log`,
`cleanup-package-mode.log`, `cleanup-installed-pty.log`, `cleanup-pty/*.json`,
`cleanup-pty/*.ansi`, five `*.screen.txt` extracts, `cleanup-mutants.mjs`,
`cleanup-mutants/results.json` and per-control logs,
`mac-observation-mutants-current.log`, `mac-observation-mutants/results.json`,
`cleanup-loc-current.log`, `cleanup-head-loc/results.json`. These are local-session
artifacts, not durable release artifacts.

Pinned cloc 2.08 actual measurement plus required fresh remeasurement:
**SOURCE_BOUND, 342 production files / 34,707 code lines**, `runtimeProof: false`.
Prior checkpoint: 341 / 34,659. Module counts:

| Module | HEAD 649ea6e code lines | Current code lines |
|---|---:|---:|
| `src/process/cleanup.ts` | 0 (not at HEAD) | 24 |
| `src/runtime/process-lock.ts` | 44 | 47 |
| `src/storage/contained-fs.ts` | 152 | 156 |
| `src/platform/host/files.ts` | 61 | 112 |
| `src/platform/host/archive-crypto.ts` | 118 | 124 |
| `src/platform/host/snapshot.ts` | 70 | 71 |
| `src/runtime/pi-runtime.ts` | 65 | 176 |
| `src/runtime/user-files.ts` | 0 (not at HEAD) | 67 |
| `src/runtime/personal-settings.ts` | 0 (not at HEAD) | 100 |
| `src/platform/host/keychain.ts` | 52 | 75 |
| `src/entry/oma-mac.ts` | 59 | 134 |

HEAD comparison includes inherited working-tree edits, not this checkpoint's edit
count. MODE-004 owner links include the cleanup/lock/user-file/settings composition
and actual negative-test prefixes; changed links invalidate rather than promote
trace evidence. Dependency evidence and review ledger were regenerated; byte-bound
notes are limited to files read in full. Generated ledger: 203 NOT_REVIEWED,
42 READ_UNCHANGED, 97 CHANGED_WITH_ORACLE, 1 REMOVED; trace inventory 371 clauses.
Neither a limited file review nor historical lanes certify whole MODE or release.

Fresh allowed static chain (`bnpriyzwk.output`): required measurement remained
SOURCE_BOUND (342 / 34,707); architecture rule modules and architecture gate
**PASS, 0 findings**; transactions completed successfully; durable boundaries
**PASS, 0 findings**; document integrity **PASS, 0 findings**; package status
**STATIC_PACKAGE_CHECKED**; `git diff --check` completed successfully. The stages
were joined with `&&` and the chain exited 0. The boundary report's existing
injection inventory is not a new runtime run. Package entrypoints were not started,
systemd/kernel/rootfs/Pi pins not attested and deploymentDigest not synthesized.
These static results do not promote the runtime or whole-clause evidence.

No DB schema, wire method/state, service or error code changed here. HostTemporary's
internal return type gains its close owner. No immutable consistency plan or
architecture.md changed. Still open: actual Linux SocietyLease close-error reporting,
Mac socket cleanup, running-snapshot maintenance/control/society returns and
clone/thaw error composition, partial listener/hook acquisition, UI aggregate
presentation, publication-visible retry/unknown policy, trusted-extension descendants,
native Mac locks/Swift/Keychain/APFS/entitlements, Mac first project seed and
Society-history/host Personal bridging. Full npm test and independently blocked
reviewer/VM/service probes were not run. DR27/S-08/S-10 and release remain incomplete.
Whole MODE clauses remain **unverified / NOT_RUN**. No credential file, paid provider,
running user OMA/VM, commit or push was used.

## 2026-10-01 — explicit Mac host-only packages / Personal checkpoint

This extends DR28's host Personal route, not Society Principal authority. Explicit
`oma pi install|remove|update|list ... --host-only` uses the existing host package
store/index without the app token, Host API or guest synchronization. The selector
is removed before Pi argv; duplicate/value-like forms, `--project` combinations and
Linux use are refused before effects. Ordinary commands keep DR25/DR26 synchronization:
a failed token observation is not permission to perform a local effect. Installing
locally does not select an extension or create empty Personal preferences that consume
the first-project seed. Existing Personal settings are reconciled by their sole writer.
Store/run/engine metadata preparation calls the existing platform-aware runtime owner;
Linux held-directory containment is not relaxed for Mac support.

### Executed behavior and actual terminal

All logs below are under this session's scratchpad. Linux / Node v24.21.0 / TypeScript
5.9.3, bundled Pi 0.87.1 and Open TUI 0.3.9; isolated fixture HOME/host store, loopback
npm registry and scripted provider only. No native Darwin attestation is claimed.

| Actual run | Result | Scope |
|---|---:|---|
| `npm run typecheck && npm run build`, then `node --test --test-reporter=tap test/engine-login-ownership.test.mjs test/package-command-ownership.test.mjs test/session-entry-composition.test.mjs dist/test/host-arguments.test.js dist/test/mac-host-packages.test.js` | **117 PASS**, 0 fail/cancel/skip, 13,534.76 ms | `mac-host-packages-current.log`; actual parser, metadata/lock/child ownership and actual Mac entry/package/Personal composition |
| Ordinary package/settings regression | **90 PASS**, 0 fail, 12,454.40 ms | `mac-host-packages-regression.log`; LocalDriver/HostService ordinary guest package synchronization and existing settings paths, not native VM/service proof |
| Installed `oma` PTY: `node --test --test-reporter=tap --test-name-pattern='Personal installed PTY: (tools\|config\|resume\|new),' dist/test/personal-pty.test.js` | **4 PASS**, 0 fail/cancel/skip, 32,551.74 ms | `mac-host-packages-installed-pty.log`; actual installed entry, fake provider, outside-project fixture read/write/edit/bash and extension, model→effort, `/new`, `/resume` |

The final typecheck/build/117-test/4-PTY chain (`b5f1ni0g2.output`) exited 0. The Mac
package scenario uses the actual compiled Mac entry and bundled npm manager, and
covers tokenless install/list/update/remove, actual cross-process lock contention,
registry 404, malformed Personal preferences, exact broken-byte preservation,
lock reacquisition, disabled choice preservation, removal reconciliation and absent
Host API/guest state. Its Society settings sentinel alone is not role-configuration
proof; controlled composition and ordinary regressions supply the relevant boundaries.

After an actual package install and explicit Personal selection, a real PTY runs that
Mac entry on Linux and the provider calls `personal_package_fixture`. The provider sees
read/write/edit/bash plus this tool, no `oma_` Society tools, and receives
`INSTALLED_HOST_PACKAGE_TOOL_COMPLETE`; the screen shows the tool and
`HOST_PACKAGE_PERSONAL_COMPLETE`. Birth/cwd and two provider requests are asserted.
The package PTY and four installed-oma PTYs all exit 0 with echo/icanon restored.
Captures in `cleanup-pty/` were directly inspected, including package tool/result,
Personal fixed Config, model then Thinking Level, `[Personal]` resume and `/new`'s
Society-default/Personal chooser. Offline fixtures report missing fd/ripgrep and skip
download; no external provider or download is used for this verification.

The first package PTY run (`btvzvkavp.output`, exit 1) expected the extension's display
label, but original Pi/Open TUI renders its tool name. Tool/result/provider/child
completion had succeeded; this was an assertion failure, not counted as PASS. The
oracle was corrected to the actual upstream tool name and result, and the entire
117-test scenario was rerun successfully; production rendering was not changed.

### Source-copy controls and byte binding

`mac-host-packages-mutants.mjs` ran actual owner/parser/launcher sources in isolated
copies: **5 baselines PASS / 24 assertion-KILLED**, 0 SURVIVED/INVALID. Complete TAP,
nonzero exit, `ERR_ASSERTION`, no cancelled/skipped tests and no harness/import/syntax
errors are required for KILLED. Exit-only launcher control uses its direct early-return
oracle with a matching passing baseline; pending unrelated tests cannot count as kills.
The initial 4-baseline/14-control run was a subset, not another 14 additional controls.
The expanded source-copy/measurement/graph/trace chain (`bflgry469.output`) exited 0.

| Reviewed production owner | SHA-256 | Current code lines |
|---|---|---:|
| `src/entry/oma-mac.ts` | `cb7c34f88c4d46d54295704502b60956af4bc5ffad7f49ba22912442344d2f6d` | 139 |
| `src/runtime/pi-packages.ts` | `aabb51db56ded2acabd0fa5129800687349f722c4c05dfefbb581396211cceab` | 150 |
| `src/tui/login.ts` | `df65171ec8d70fe01a31775cf6f58260629f327db7f26b55a482e7dce9a8c641` | 26 |

Pinned cloc 2.08 measured **342 production files / 34,714 code lines** and fresh required
remeasurement returned **SOURCE_BOUND**, `runtimeProof: false`. Previous owned-cleanup
checkpoint was 342 / 34,707; HEAD comparisons include inherited dirty-tree changes,
not this checkpoint's authored amount. Dependency evidence was regenerated. MODE-004
owner links now include metadata preparation, actual package grammar and negative
entry/scenario tests; changed links invalidate evidence rather than promote it.
Trace inventory remains 371 clauses, whole MODE **unverified / NOT_RUN**. Byte-bound
review notes were refreshed for the fully read current owners; generated ledger:
202 NOT_REVIEWED, 42 READ_UNCHANGED, 98 CHANGED_WITH_ORACLE, 1 REMOVED. Historical
lanes and this limited review do not certify the rest of the dirty tree.

Fresh static chain (`bs8lwa822.output`) exited 0: required measurement SOURCE_BOUND;
architecture rules/gate **PASS, 0 findings**; transactions completed successfully;
durable boundaries **PASS, 0 findings**; document integrity **PASS, 0 findings**;
package **STATIC_PACKAGE_CHECKED**; `git diff --check` successful. Boundary injection
counts are the existing inventory, not new runtime runs. Entry packaging does not
attest systemd/kernel/rootfs/Pi pins or synthesize deploymentDigest.

No Host API/guest protocol method, state, version, DB schema, service or error code
changed here. Native Mac Node/npm/flock/Swift/Keychain/APFS/VZ/entitlements are not
proved; actual Mac first-project extension seed and guest Society-history↔host
Personal handoff remain open. The Linux-hosted Mac entry PTY uses the Linux model
backend, not native Keychain. Actual Linux SocietyLease close reporting, Mac socket
cleanup, partial hook/listener acquisition, arbitrary extension descendants and
whole publication/retry/crash coverage remain separate. Full `npm test`, independently
blocked reviewer-shortage/VM/systemd probes, credentials, running user OMA/VM and
commit/push were not used. Whole MODE, DR27/S-08/S-10 and release remain incomplete.

## Personal initial-choice writer checkpoint (2026-10-01)

P0-2/P0-3: the existing Personal settings writer now queries the initial project
selection only while its locked reread still observes no Personal choice. It does
not reobserve an old project for saved preferences, contention or corrupt saved
settings. An observer failure commits no empty choice; the writer is returned.
This changes no store/schema/revision authority, role preference or package owner.
Actual Personal host composition preserves saved birth/root/cwd and returns the
current child owner before in-place new/resume handoff. Darwin continues to refuse
interpretation of guest project paths as host settings; that guard is not Mac seed
implementation.

### Executed checks and installed terminal

Linux / Node v24.21.0 / TypeScript 5.9.3 / bundled Pi 0.87.1 and Open TUI 0.3.9.
All logs and captures below are this session's scratchpad; isolated test-owned
HOME/data/project/user files and loopback scripted inference only.

| Actual run | Result | Scope |
|---|---:|---|
| `node --test test/personal-host-composition.test.mjs && npm run typecheck && npm run build` | **19 PASS**, typecheck/build successful | Actual production entry transpiled over controlled filesystem/settings/catalogue/child/exec boundaries; undeclared imports refused. Not native syscall/service proof. |
| Current related regression after harness correction | **143 PASS**, 0 fail/cancel/skip, 6,635.36 ms | `personal-seed-regression-current.log`; actual 12 settings tests, history validation/lock lifetime, child/engine ownership, entry and Personal host composition |
| Original installed Personal PTY suite | **13 PASS**, 0 fail/cancel/skip, 100,765.49 ms | `personal-seed-installed-pty.log`; this predates the managed-project fixture additions |
| Installed tools/config/new/resume captured subset | **4 PASS**, 0 fail/cancel/skip, 32,286.43 ms | `personal-seed-screen.log`; actual tools/results, model then Thinking Level, fixed Personal Config, Society-default `/new`, `[Personal]` resume screens directly inspected |
| Final expanded installed Personal PTY suite | **15 PASS**, 0 fail/cancel/skip, 116,981.78 ms | `personal-seed-installed-pty-final-v2.log`, task `bkuotqq9h` exit 0; original cases plus actual managed-project initial seed and corrupt-old-project resume |

The two new cases prepare committed project settings through the existing managed
settings and extension-toggle owners, without prepopulating Personal preferences.
The actual installed `oma` observes that selection; original Pi/Open TUI exposes
`personal_fixture`, and its `EXTENSION_TOOL_COMPLETE` result reaches the provider.
Personal's independent choice contains only the user extension. The first case
asserts exact project-settings bytes unchanged. The second damages only the old
fixture project settings, resumes the same birth/history, and asserts those damaged
bytes are not rewritten. No `oma_` tools or Society/project prompt sentinels reach
inference. Data roots contain only expected fixture-prepared state; Personal does
not provision a Society. Actual captures `personal-project-seed.screen.png` and
`personal-project-seed-resume.screen.png` were directly inspected, including the
extension/result, damaged-project notice, `[Personal]` selection and continued
conversation. Both exit 0 with echo/icanon restored; all 15 cases assert terminal
return. Offline fd/ripgrep absence skips downloads rather than making network calls.

Historical failures are retained: the first two-case run
`personal-project-seed-pty.log` failed both cleanup hooks with EACCES because actual
managed publications have read-only directories. It is not counted as PASS. The
fixture now uses existing test-only `removeTree` ownership, which restores its own
directory modes without following symlink targets; product immutability is unchanged.
The first full rerun `personal-seed-installed-pty-final.log`, task `bsc28cej2`, passed
typecheck/build but was stopped at its background deadline while running the PTY
suite. Its interrupted TAP is not PASS. The longer-deadline complete rerun above
supplies the final result; no user process or running OMA/VM was killed.

### Source-copy controls and review scope

`personal-seed-mutants-v2/results.json`: **2 baselines PASS / 18 assertion-KILLED**,
0 SURVIVED/INVALID. Four controls exercise actual settings-source copies; fourteen
exercise actual Personal-host source copies. Controls cover lock-owned observation,
no repeated/failed/omitted selection, Mac guest-path refusal, saved mode/root/cwd
checks and exact new/resume handoff. Complete TAP, no cancellation/skip, nonzero exit
with `ERR_ASSERTION` and no harness/import/syntax/TypeError errors are required for
KILLED. The first runner's eager-seed host control was **INVALID**: unrelated deferred
handoff setup called an undefined resolver after early rejection. Immediate rejection
handling and a resolver assertion corrected the test oracle; the historical INVALID
was preserved and not promoted. The complete v2 baselines and all 18 controls were
rerun. No production source was mutated.

| Fully read production owner | SHA-256 |
|---|---|
| `src/runtime/personal-settings.ts` | `1c7a7a69ddb20169ee544c57a85d9f2da6203319f399b7bcffe19b62beb2cfad` |
| `src/entry/personal-host.ts` | `d35681b004ba5b2e3c572ada681258212a0276d068e85d397ba13787c693c1d4` |

Byte-bound review notes and MODE-002/004/005/006 negative-test links were updated for
these limited owners. Pinned cloc 2.08 regenerated **342 production files / 34,713
code lines** (settings 101, Personal host 45); required fresh remeasurement returned
**SOURCE_BOUND**, `runtimeProof: false`. Graph and 371-clause trace inventory were
regenerated without promoting any MODE proof. Current byte-bound ledger has
201 NOT_REVIEWED, 42 READ_UNCHANGED, 99 CHANGED_WITH_ORACLE and 1 REMOVED. This is
not review of all inherited dirty-tree changes. Static chain `baiifq9vr.output`
exited 0: architecture rule/gate PASS with 0 findings, transactions successful,
durable boundaries PASS with 0 findings, document integrity PASS with 0 findings,
package STATIC_PACKAGE_CHECKED and `git diff --check` successful. Boundary inventory
counts are not newly executed injections. Generated records and static gates remain
separate from executed behavior; changed links invalidate evidence. The preceding
342-file/34,714-line checkpoint remains historical. Whole MODE is unverified /
NOT_RUN. Native Darwin first-project seed and guest-history handoff are still open:
current HostRecord lacks the declared project/bookmark owner, ordinary forwarding
starts the VM, and no existing read-only guest seed/history or terminal handoff
contract exists. No endpoint/version is silently invented. Full `npm test`, native
Mac execution, independently blocked reviewer/VM/systemd probes, credentials, paid
providers and commit/push were not used. This checkpoint is not release closure.
