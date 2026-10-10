# OMA v2 — 현재 검증 상태

## 모듈 독립성 (2026-10-10, DR41)

기준 `babe732`에서 TUI 효과·Principal 수명·설정과 package/Platform 책임을 분리했다.
TUI는 Application/Runtime 저장·프로세스 구현을 import하지 않는다. 두 독립 빌드가 전체 Runtime·
Application·Broker·Store 없이 컴파일·로드되고 Extension의 검증된 vendor와 Pi manifest를 포함한다.
서브에이전트는 사용하지 않았다. 이전 배치의 suite·native 증거를 이번 변경의 실행으로 재사용하지 않는다.

집중 MJS 첫 실행 123 PASS / 173 FAIL은 이동한 소스의 controlled import 경로와 owner oracle의
경로가 이전 위치를 가리킨 실패다. 실제 새 owner에 연결하고 Application의 기존 surface 검사 범위도
보존한 재실행은 296/296 PASS다. 독립 산출물 build/load·vendor 변조·기존 출력 교체 거절은 2/2 PASS다.
TS 집중 첫 실행은 165 PASS / 1 FAIL이었다. Principal child의 기록을 50ms 뒤에 가정한 fixture를
실제 첫 기록 관측 뒤 검사하도록 정정했다. receipt unknown·busy·Human 입력 순서의 assertion은 유지한다.
첫 build/typecheck는 shebang 앞에 import가 놓여 실패했고 첫 structure 검사 5건은 private import 경로가
남아 실패했다. shebang과 공개 import를 수정한 build/typecheck·rule check는 통과했다.

정정 뒤 Principal·package·Society port·실제 Resident sandbox 집중 검증은 58/58 PASS,
최종 모듈·독립 산출물·입력 identity·surface gate oracle은 33/33 PASS다. 첫 전체 architecture gate의
문서 링크 6건은 이동 전 파일을 가리켜 거절됐다. 현재 owner로 링크를 갱신했다.
첫 전체 local suite는 3,961 PASS / 29 FAIL이다(414 files; serial 9 PASS + parallel 3,952 PASS).
15,433개 입력의 실행 전후 변경은 0건이다. 27건은 entry 함수만 추출한 package ownership fixture에
새 directory port가 빠져 실패했다. port를 공급하고 index 호출이 그 port를 받는지 검증한다.
2건은 consistency owner 경로와 N-001 architecture hash가 이전 값을 가리킨 실패다. Human이 지정한
DR41 경계 변경을 대조하고 현재 규범 hash·traceability 및 owner 경로를 갱신한다.
첫 실행의 실패를 최종 PASS로 바꾸지 않는다. 정정 뒤 고정한 최종 runtime 입력 sha256는 `5539955a6f8dd31eac0858934acb9d82d3ee87019c0046cb0afdefc56ba8097f`다.

| 최종 실행 | 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,990/3,990 | serial 9 + parallel 3,981; fail/cancel/skip/todo 0; 414 files, parallel 412, concurrency 8 |
| actual crash lane | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP·부모 SIGKILL·재시작·반복 복구; VM power loss/entrypoint crash 증거는 아님 |
| 독립 TUI·Extension | BUILD+LOAD PASS | manifest·declaration·공개 API 전체 로딩·vendor copy 검증·변조 및 기존 출력 교체 거절 |
| build/typecheck/architecture | PASS | inventory·rules·dependencies·transactions·durable boundaries·documents·spec inventory |

전체 suite와 crash의 15,433개 입력 bytes는 동일하고 전후 변경은 0건이다. 결과 기록과 evidence는
이 실행 후 작성한 입력이다. 코드 bytes는 바꾸지 않았으며 후속 기록에는 structure/문서/input 검사를
별도로 적용한다. 직접 검토한 변경 생산 delta는 49개, 전체 변경 생산 경로는 55개다. 상속된
미검토 50개를 유지한다. 이동된 211개 named declaration의 emitted representation을 비교하고,
바뀐 runtime body 세 곳의 wording/directory port 주입을 직접 검토했다. type-only 선언은 emit에서
지워지므로 이 비교를 타입 계약 검증으로 대신하지 않는다. source graph는 430 files / 1,802 runtime
edges / 471 type-only edges / runtime cycles 0이며 Store type-only SCC 한 묶음은 남는다.
단일 feature의 변경 비용 감소나 평점은 추정하지 않고 전체 changeset과 기존 owner inventory를
구분한다. 원시 로그와 최종 독립 산출물은 `/home/dev/oma-audit-artifacts/modules-2026-10-10`에 보존하고
명령·로그 hash·공통 입력 map은 [DR41 evidence](../../test/audit/modules-2026-10-10.evidence.json)에 기록했다.
검증의 현재 digest field는 전체 local gate 입력을 결박한다. runtime 뒤 작성한 결과 기록의 bytes까지
이미 실행했다고 주장하지 않는다. macOS native·VM power loss·paid provider·release qualification은
Linux 배치에서 NOT_RUN이다. 기존 시작 시간 목표는 이 배치에서 측정·개선하지 않았다.

## 추가 아키텍처 감사 (2026-10-10, DR40)

기준 `3b9bcea`에서 Human이 지정한 A-01~A-11을 구현했다. 계약·effect·capability의
소유권을 유지하면서 내부 간접 참조와 수동 동기화를 줄였다. 서브에이전트는 사용하지 않았다.
설정과 nested RPC 응답, transaction scope, 실제 Pi/LSP/MCP 및 아키텍처 negative control을 검증한다.
전체 local suite와 actual primitive crash 결과를 이 구간과
[바이트 증거](../../test/audit/architecture-2026-10-10.evidence.json)에 기록했다.

집중 첫 실행 83/83, 아키텍처 oracle·실제 Git changeset·원자 설정 view 59/59가 통과했다.
첫 Pi/LSP/MCP 집중 실행은 109 PASS / 38 FAIL이었다. 새 UI owner가 fixture의 controlled
import 목록에 없어서 interactive owner 38건이 거절됐으며 실제 helper를 fixture에 연결한
재실행은 38/38 PASS다. structure gate의 첫 7건 거절은 이동한 scratch/staging owner 선언을
정정한 뒤 0 findings다. 이동한 staging의 durable boundary 등록 경로도 정정했다.
그 검사 중 시작한 suite는 coordinator만 TERM으로 종료하고 해당 child가 종료할 때까지 기다렸으며
이 부분 실행을 전체 suite의 성공으로 표시하지 않는다. 실패 실행을 최종 PASS로 바꾸지 않는다.
첫 전체 실행은 3,966 PASS / 17 FAIL이다. 16건은 테스트 PATH에 설치된 oma 링크가
빠진 ENOENT였고, 1건은 이전 verification input digest가 남은 기록 오류였다.
입력은 15,419개이며 실행 전후 변경은 0건이다.
환경·기록을 정정한 두 번째 전체 실행은 3,982 PASS / 1 FAIL이다. Personal PTY 16건은
모두 통과했다. 남은 build-stamp fixture는 삭제한 inode가 재할당되지 않는다고 가정해
실패했다. 이전 출력의 descriptor를 재빌드 assertion까지 고정해 물리적인 교체 증거를
유지하도록 수정했고, 해당 파일 6/6이 통과했다. 두 번째 입력도 전후 변경 0건이다.
제품 build 구현은 변경하지 않았다. 고정한 최종 입력으로 전체 suite와 crash lane을 재검증했다.

| 최종 실행 | 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,983/3,983 | serial 9 + parallel 3,974; fail/cancel/skip/todo 0; 411 files, parallel 409, concurrency 8, TMPDIR=/var/tmp |
| actual crash lane | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP·부모 SIGKILL·재시작·반복 복구; VM power loss/entrypoint crash 증거는 아님 |
| build / typecheck / architecture | PASS | inventory·rules·dependencies·transactions·durable boundaries·documents·spec inventory; runtime cycles 0 |
| 전체 MCP vendor re-emit | PASS: BUNDLE_CURRENT 2,727 files | 기존 cross-spawn type 선언 관련 emit 진단은 남으며 baseline/current 모두 동일한 emitted set을 검증함 |

최종 runtime 입력 sha256는 `3b6620ac1d073e1be23979d38613a690afa8f7c3692d16a3b01a5ac6362085c3`다.
전체 suite와 crash lane의 15,419개 입력 bytes는 동일하며 실행 전후 변경은 0건이다.
이 결과 문서와 evidence는 실행 후 작성한 입력이다. 마지막 diff 검사에서 staging/tar 소스
두 파일의 끝 빈 줄도 제거했다. 재빌드한 15,150개 emitted file은 이전 실행 bytes와 모두
동일하다(build input identity stamp 제외). 이 후속 소스·기록 bytes까지 기존 runtime suite가
실행했다고 주장하지 않으며 architecture gate와 validation input 검사를 별도로 실행한다.
변경 생산 파일 21개의 delta와 영향 owner를 직접 검토하고 현재 SHA·DR40 oracle에 결박했다.
상속된 미검토 50개와 과거 native 검증은 재승인하지 않는다. 생성된 dependency graph는
423 files / 1,786 runtime edges / 454 type-only edges / runtime cycles 0이다.
Store 중심 type-only SCC 한 묶음은 남는다. LOC를 새로 측정한 주장은 하지 않는다.
실제 changeset은 이 11개 항목 전체의 55개 경로(source 21, tests 15, tools 9, metadata 10)다.
public mutation 13개의 관련 owner inventory 평균 14.46개와 구분하며, 한 feature의 변경 비용이
줄었다고 추정하지 않는다. 상세 명령·로그 SHA·input map은 evidence에 있고 원시 로그는
`/home/dev/oma-audit-artifacts/architecture-2026-10-10`에 보존했다.

SDK metadata 검사와 전체 vendor re-emit 검사를 구분한다. 첫 전체 re-emit은 생성기에
TypeScript import를 추가한 문자열 치환이 기존 divergence 템플릿까지 변경해 실패했다.
baseline 재실행은 통과했으며 템플릿의 원문을 복원해 생성기 회귀를 수정했다. 목록만
검사한 결과를 전체 vendor 재생성 성공으로 표시하지 않는다. 기존 private Pi hook·Store type-only 순환·복잡한
보안 데이터 흐름 검사는 남는다. 평점이나 단일 feature 변경 파일 수 개선을 추정하지 않는다.
macOS native·VM power loss·paid provider·release qualification은 이번 실행에서 NOT_RUN이다.
시작 시간 목표는 이번 아키텍처 배치에서 개선하지 않았다.

## 아키텍처 변경 책임 분리 (2026-10-09, DR39)

DR38 여섯 결함 수정·푸시 완료 뒤 승인받은 구조 개선을 구현했다.
Society settings/panel, Review documents/status, VM/Keychain API의 변경 책임을 분리하고
codec key와 paramsCheck owner symbol의 중복 선언 두 개를 실제 메서드에서 도출한다.
현재 진입점 1020→879줄, Review 1281→1126줄이다. 파일 크기는 구조적 완료의 증명이 아니다.
Broker·Store·acceptance·recovery 소유권은 유지한다. 서브에이전트는 사용하지 않았다.

추출 단계에서 build/typecheck와 structure gate 0 findings, 집중 회귀 216/216, settings composition
62/62가 통과했다. 첫 전체 local suite는 serial 9 PASS, parallel 3,959 PASS / 3 FAIL이었다. 새로운 파일이 inventory에 게시되기 전에
시작한 structure 검사 2건은 manifest 누락으로 실패했고, 생성 완료 후 재실행은 통과했다.
최초 settings 추출은 raw stat owned-state 규칙에 거절되어 기존 inode-checked pointer reader로
수정했다. 이 실패들을 최종 PASS로 바꾸지 않는다.

실제 PTY 기준은 화면 3.028초 / broker 15.054초 / 첫 도구 15.779초이며 SQLite mutation이
정확히 한 번 succeeded다. 5초 예산 실패로 harness exit 1이다. BPF-filtered process trace의
clone 8.568초 / pack-objects 7.202초 / strict fsck 2.983초는 trace 실행 값이다.
Git transport 옵션의 별도 실험은 개선이 부족해 적용하지 않았다. 전체 ptrace 실행은
화면 지연·응답 timeout 후 종료되어 성능 기준으로 쓰지 않는다. 시작 목표는 미달이다.

설정 pointer의 같은 크기/mtime 교체와 unobservable read 재확인, review history 20,000건의
newest suffix, UTF-8 notice 분할과 경계 newline을 집중 검사했다. VM credential API는 별도
surface로 검사했다. Swift stop 오류 무시를 수정했지만 native Swift 컴파일·실행은 NOT_RUN이다.
[Apple stop API](https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop%28completionhandler%3A%29)의 오류가 nil일 때만 stop 성공이라는 계약에 따라 구현했으며 이 문서 확인은
실행 증거가 아니다. macOS native, paid provider, VM power loss와 release qualification도 미실행이다.

기존 입력 digest에서 빠졌던 `platform/`과 `.gitignore`도 현재 source closure에 포함했다.
Swift·guest unit·source publication 규칙의 변경을 바이트로 추적하며 native 실행 PASS를 뜻하지 않는다.
첫 전체 suite의 15,403 입력은 `92bae4d455f2cb420b43feade3ee843821e3d7cfcbd86ba7b093b8c387a540d6`이고
전후 byte 변경은 0건이다. TMPDIR=/var/tmp의 disk filesystem에서 directory allocation이
4096-byte fixture target을 넘는 오류와 preaccept inode 재사용·publication create/flock 수거
경쟁의 실제 결함을 발견했다. 이 첫 실행은 실패이며 최종 PASS로 바꾸지 않는다.
수정 후 affected owners 113/113가 통과했다. 새 collector-before-flock 회귀는 baseline에서
실패, 현재 코드에서 통과했다. inode pin은 acceptance/discard/refusal에서 실제 닫힘을 검사했다.
수정한 15,404 입력을 다시 고정해 전체 local suite, actual crash와 PTY를 실행했다.
최종 runtime 입력 sha256는 `fc4796d0cc73aa62d3627bf32909d9837b03801b160ac5f2dacaeec9ef20332f`다.
실행 전후 15,404개 source bytes의 변경은 0건이다. 이 결과 기록과 evidence는 실행 후 입력이다.
그 미래 바이트까지 runtime suite가 실행한 것으로 주장하지 않는다. 기록 후 구조 검사를 재실행한다.

| 최종 실행 | 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,973/3,973 | serial 9 + parallel 3,964; fail/cancel/skip/todo 0; 407 files, parallel 405, concurrency 8, TMPDIR=/var/tmp |
| actual crash lane | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP·부모 SIGKILL·반복 복구; VM power loss/entrypoint crash 증거는 아님 |
| build / typecheck / architecture | PASS | source inventory·rules·dependencies·transactions·boundaries·documents·spec inventory; runtime cycles 0 |
| 최종 Society PTY 3회 | 화면 2.96~3.07초, broker 15.06~15.37초, 첫 도구 15.83~16.21초 | 새 HOME/data, installed OMA와 bundled Pi, 실제 systemd broker, provider만 로컬 시험 응답; 3회 모두 mutation succeeded 정확히 한 행과 child exit 0 |

시작 예산 5초는 **FAIL**이며 PTY harness exit 1을 성공으로 바꾸지 않는다. 1초 목표도 미달이다.
이 배치에서 Git pack 실험을 제품에 넣지 않았고 시작 시간 개선을 달성한 주장은 하지 않는다.
preaccept pin은 정산까지 파일당 descriptor 하나를 사용한다. 실제 OS descriptor/I/O 한계는
명시적 오류로 보존하며 새 OMA quota를 만들지 않는다. pre-lock 준비 중 죽은 plain temporary는
살아 있는 writer의 죽음을 입증하지 못하므로 보존한다.
이번 review ledger는 수정과 새 owner 15개를 현재 bytes와 oracle에 결박했다. 상속된 미검토
50개나 과거 native 환경 PASS를 재승인하지 않는다. 상세 명령·로그 SHA·source SHA·중간 실패는
[DR39 evidence](../../test/audit/architecture-2026-10-09.evidence.json)에 기록했다.
원시 로그는 `/tmp/oma-architecture-2026-10-09`, 별도 Git trace2 실험은
`/home/dev/oma-audit-artifacts/architecture/git-transport-2026-10-09`에 보존했다.
결과 기록의 미래 바이트는 그 runtime 실행의 입력으로 주장하지 않는다.

## 이전 실행 결과: host·guest 소유권·종료·ready 수정 (2026-10-09, DR38)

Human이 제시한 6건을 수정했다. 중복 maintenance lease와 외부 해제 거절,
host state-disk 작업 직렬화, 같은 society의 open/resume/close 직렬화, running project binding,
필수 ready record publication, 실패를 보존하는 종료와 API/lock 정리를 구현했다.
HostService의 project/session/snapshot/transfer 조정을 4개 concrete owner로 분리했다.
네트워크는 DR37의 unrestricted host 정책을 유지하며 guest role/allow를 권한 증거로 쓰지 않는다.
변경 생산 파일 12개의 수정과 영향 owner를 직접 검토하고 SHA-256·named DR38 oracle에 결박했다.
서브에이전트는 사용하지 않았다. 당시 추가 아키텍처 개선은 수정 완료 뒤 계획만 작성하는 범위였다.
이후 진행 승인이 DR39의 구현 범위를 추가했다.

수정 전 회귀에서 8개의 동작 실패를 재현했다. 기존 shutdown 실패가 API listener를 남겨
검사 worker가 종료되지 않아 해당 검사 소유 worker 하나를 TERM으로 정리했다. 이 실행을
정상 종료한 suite로 표시하지 않는다. 수정 후 platform 5개 파일 집중 검사 80/80,
실제 daemon entry의 controlled native boundary 검사 4/4가 통과했다.
entry 첫 실행의 1건 실패는 assert.match에 문자열을 전달한 테스트 오류였으며 수정 후 4 PASS다.

| 검사 | 이번 실행 결과 | 범위 |
|---|---|---|
| 전체 local suite | PASS: 3,962/3,962 | serial 9 + parallel 3,953; fail/cancel/skip/todo 0. 405개 파일, parallel 403개 concurrency 8 |
| build / typecheck | PASS | 이번 최종 생산 코드와 테스트 입력 |
| architecture aggregate | PASS: 0 findings | inventory·rules·architecture·transactions·boundaries·documents·spec inventory; runtime cycle 0 |

첫 구조 검사는 새 coordinator의 raw directory listing 2곳과 archive existence probe 1곳을
거절했다. 기존 host-owned listing/permission repair를 사용하고 관측 불가·archive 비정상 entry를
refuse하도록 수정해 통과했다. 이 실패 로그도 보존했다. review ledger 첫 시도는 inventory
생성 완료 전에 실행해 새 파일을 거절했으며 inventory 완료 뒤 재실행했다.

전체 local suite의 입력은 15,382 files, sha256
`0ee898bf2cbcd92d73b89c35a00719df16db9796a471d0d96149b9de92b1fe05`다.
suite 전후 전체 입력의 바이트를 대조해 변경 0건을 확인했다. 아래 현재 구조 입력 field와
이 결과 문서·[DR38 evidence](../../test/audit/host-ownership-2026-10-09.evidence.json)는 실행 후
기록이다. 그 미래 바이트까지 runtime suite가 실행한 것으로 다루지 않는다. 기록 뒤 구조 검사를
별도로 실행한다. 명령·로그 SHA·변경 생산 파일 SHA와 미실행 범위는 evidence에 있다.

이 Linux 실행은 LocalDriver·guest services·Host API Unix socket·copyFileSync clone 및
controlled macOS entry 경계를 검증한다. Virtualization.framework/APFS/Keychain/AF_VSOCK
native·macOS VM boot·power loss는 미실행이다. 이전 kernel/crash PASS는 DR37 당시 결과다.
이번 수정은 앞선 시작 시간의 새 측정이 아니며 최초 Society의 전체 준비 5초 예산은 여전히
충족했다고 주장할 수 없다. raw log는 `/tmp/oma-host-ownership-2026-10-09`에 보존한다.

현재 구조 검사의 입력 identity(생성 자체는 runtime PASS가 아니다):
verification input digest `25d9be7d9750b9188adfecd9c7a63a6ba60681bb382b3a1e1f5922e187f32ad4` (15433 files).

## 이전 실행 결과: 지정한 제한 제거·기능 복구 (2026-10-09, DR37)

사용자가 지정한 SC-01/02/03/04/05/20/23/26/30/31/32, 총 11개 항목을 구현하고 검증했다.
SC-01~05/20/31의 OMA 네트워크·실행 자원·인원·저장 quota를 제거하고,
SC-23/26의 MCP·웹 기능, SC-30의 reader 소유 패키지 GC, SC-32의 비동기 fd 자동완성을 복구했다.
문서와 실제 실행 측정부터 진행했고 서브에이전트는 사용하지 않았다.
45개 변경 생산 파일과 영향 owner를 직접 검토하고 현재 SHA-256와 named oracle에 결박했다.
상속된 미검토 파일이나 과거 환경 PASS를 metadata 생성으로 재승인하지 않는다.

| 검사 | 이번 최종 실행 결과 | 범위 |
|---|---|---|
| `node scripts/test-local.mjs` (별도 build 후) | PASS: 3,946/3,946 | serial 9 + parallel 3,937. fail/cancel/skip/todo 0. 404개 파일: serial 2 + parallel 402, concurrency 8 |
| `verify-lane.mjs kernel` | EXECUTED+PASS: 68/68 | 실제 user systemd/cgroup/bwrap/socket, checker와 MCP/web native 추가 3건 포함 |
| `verify-lane.mjs crash` | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP/부모 SIGKILL·반복 복구; VM power loss는 미실행 |
| build / typecheck / architecture aggregate | PASS | inventory·rules·architecture·transactions·durable registry·documents·spec inventory |
| `npm audit --json` | PASS: 알려진 취약점 0건 | 이번 변경에서 의존성 버전을 바꾸지 않음 |

실제 두 confined Worker의 TCP·UDP, private HTTP의 목적지 인증 보존·proxy 인증 제거,
12개 CONNECT 동시 연결을 관측했다. checker는 인터넷을 사용하며 과거 1초 제한을 넘어
정상 완료하고, owner 취소 시 남은 자식까지 전체 cgroup을 종료한다. MCP credential helper의
실제 명령 실행과 웹 configured/per-call proxy의 실제 요청도 통과했다.

패키지 reader 회귀는 production client-preload를 실행한다. reader SIGKILL 전에는 세대를
보존하고 종료 뒤 회수한다. collector가 rename 후 marker를 지운 다음 SIGKILL되어도
`.collecting-*` tombstone을 재시작에서 회수한다. metadata index의 단기 lease는 즉시 닫으며,
상주 publisher에서 실제 `packages.sync` 3회 후 옛 세대가 회수된다. fd는 Pi installer로
백그라운드 설치하며 기존 autocomplete provider가 설치 뒤 재귀 결과를 내는 회귀가 통과했다.

첫 kernel 실행은 67 PASS·1 FAIL이었다. `TasksMax`를 생략해도 systemd 기본값 38,426이
실제 적용되는 결함을 발견했다. Resident/checker에 `TasksMax=infinity`를 명시하고 manager에서
무한 값을 관측하는 회귀를 추가해 최종 68 PASS를 얻었다. 전체 세 번째 실행의 serial 9 PASS /
parallel 3,879 PASS·56 FAIL과 네 번째의 serial 9 PASS / parallel 3,936 PASS·1 FAIL 로그는
보존했다. 제거한 heartbeat의 남은 호출을 수정하고 stale 환경·surface oracle 및 reader lease가
없는 역사적 extension fixture를 정산했다. 이 중간 실행들을 최종 PASS로 바꾸지 않는다.

시작 측정은 전체 검사 종료 뒤 Personal·Society 즉시 도구·Society 일반 대화를 각각 3회씩
순서대로 실행했다. 새로운 HOME/data와 현재 checkout, 실제 OMA entry·bundled Pi·PTY를
사용하며 모델만 로컬 대본이다. OS page cache는 비우지 않았고 모든 child exit는 0이다.

| 실제 관측 | 최종 3회 범위 | 요청한 예산 판정 |
|---|---|---|
| Personal 화면 / 첫 응답 | 1.23~1.25초 / 1.54~1.56초 | 5초 이내; 1초 목표 미달 |
| Society 화면 / 일반 대화 첫 응답 | 2.95~3.08초 / 3.22~3.35초 | 대화는 5초 이내; 1초 목표 미달 |
| 최초 Society broker 준비 | 14.76~14.97초 | 전체 준비 5초 목표 **FAIL** |
| 시작 직후 첫 Society tool 완료 | 15.49~15.72초 | 3회 모두 SQLite의 `society.set` succeeded 정확히 한 행; 5초 목표 **FAIL** |

변경 전 실제 1회는 화면 2.931초·broker 14.561초·첫 도구 15.262초였다.
`--wait-broker --early-tool` 명령의 exit 1은 예산 미달이다. 도구 실행 실패와 혼동하거나
PASS로 바꾸지 않는다. 처음부터 요청한 도구가 준비를 기다리는 시간은 화면 표시와 별개다.

```sh
npm run build
node scripts/test-local.mjs
npm run typecheck
npm run check:architecture
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs kernel --out <new-directory>
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs crash --out <another-new-directory>
python3 scripts/benchmark-startup.py --node <node24> --mode personal --runs 3
python3 scripts/benchmark-startup.py --node <node24> --runs 3 --wait-broker --early-tool
python3 scripts/benchmark-startup.py --node <node24> --runs 3
npm audit --json
```

Node v24.21.0, Linux UID 1001, user systemd 257.13, bwrap 0.12.0, cgroup v2에서 실행했다.
local suite는 `OMA_TEST_SYSTEMD=0`과 local-test-guard, 존재하지 않는 user bus를 쓰며,
native lane은 실제 `/run/user/1001/bus`에서 guard 없이 실행한다. PATH에는 cloc 2.08과
현재 dist를 가리키는 임시 `oma` 링크를 포함한다. 명령·raw log SHA·실측·변경 실행 파일 SHA는
[DR37 evidence](../../test/audit/unrestricted-2026-10-09.evidence.json)에 있다.
원시 로그는 `/tmp/oma-unrestricted-2026-10-09`에 보존했다.

runtime 입력은 15,376 files, sha256 `8cb5c9c1b0bf0f760205ab88dfd4401cbc3cb1f1bf5cde631ac9c314fd667cca`였다.
local/kernel/crash와 최종 시작 측정 뒤 15,376개 파일의 바이트를 고정 map과 대조해 변경 0건을
확인했다. 이 결과 문서와 evidence는 실행 이후 기록이다. 그 미래 바이트까지 runtime suite가
실행했다는 뜻이 아니며, 기록 후 구조 검사를 별도로 재실행한다.

미실행: macOS Virtualization.framework/APFS/Keychain/AF_VSOCK native·VM 부팅,
실제 유료 provider, VM power loss, host reboot, 전체 release qualification.
새 NAT NIC의 guest DHCP/DNS 계약은 [macOS 플랫폼](../macos-platform.md)과 DR37을 따른다.
외부 signed guest image가 network unit·virtio_net·networkd/resolved·resolv.conf 연결을 포함해야
한다. 이 저장소에는 image builder가 없어 image packaging/부팅을 수행하지 않았다.
legacy reader marker 없는 package 세대는 기존 독자 종료를 증명할 수 없어 보존한다.
프로토콜 payload 문법/바이트 검증과 P0 권한·파일·종료 소유는 유지한다.

## 이전 실행 결과: 적대적 감사 발견 수정·재검증 (2026-10-09, DR36)

사용자의 전체 수정·푸시 지시에 따라 수정과 현재 입력의 검사를 실행했다. 아래 기록 전용 감사와 이전 suite 수는
해당 시점의 기록이다. 최초 13건의 수정 상태는 [audit](../priority-0-audit.md), 추가로 조사한
인터넷·skills·MCP 등의 32개 제한은 [장부](../user-expectation-ledger.md)에 있다.
서브에이전트 없이 직접 수정·검증했다. 역사적 결함 oracle의 exit 0은 수정 성공으로 바꾸지 않는다.

| 검사 | 당시 실행 결과 | 범위 |
|---|---|---|
| `npm test` | PASS: 3,938/3,938 | serial 9 + parallel 3,929. fail/cancel/skip/todo 0. 403개 파일; systemd 필수 9개 파일은 별도 lane |
| `verify-lane.mjs kernel` | EXECUTED+PASS: 65/65 | 실제 user systemd/cgroup/bwrap/Unix socket. broker 재시작 포함 |
| `verify-lane.mjs crash` | EXECUTED+PASS: 63/63 | 실제 primitive SIGSTOP/부모 SIGKILL·반복 복구. VM power loss 증거는 아님 |
| native candidate 대조 | PASS: 4건 | baseline, memory cap +1 byte, stdout/stderr 각각 1 MiB 초과 정상 완료, 검증된 2,147,484초 timeout 실제 실행 |
| build / typecheck / architecture aggregate | PASS | inventory, rules, architecture, transactions, durable registry, documents, spec inventory 포함. registry strongest-injection 숫자는 이번 실제 kill 수가 아님 |
| `npm audit --json` | PASS: 알려진 취약점 0건 | nodemailer 10.0.16 고정; 일반 SMTP 원격 공격의 OMA 재현 주장은 없음 |

집중 검사에는 read-only 봉인·owned traversal·quota 26 PASS, 수리·MIME·production C 24 PASS,
준비/수리 13 PASS, 이력 격리/숫자/Principal fixture 정산 24 PASS, 공개 Pi API와 process owner 대역
110 PASS가 있다. 이전 전체 시도의 95개 실패는 보존했으며 원인은
stale API 대역·비동기 권한 재검사 횟수·sync timeout 거절 타입·PATH의 cloc 부재·입력 digest였다.
첫 진단 실행은 Git 비공개 객체 유입과 오래된 숫자 oracle를 발견했고, 등록되지 않은 가짜
Principal 대기 때문에 중단했다. 당시 Personal PTY의 `spawn oma ENOENT`는 임시 설치 링크를
빠뜨린 검사 환경 문제였다. 새 fixture는 실제 grant/attach와 설치 명령을 제공한다.

kernel 첫 실행은 64 PASS/1 FAIL이었다. 새 quota 관측이 immutable context directory를
0555에서 0755로 바꾸어 다음 broker가 STORE_CORRUPT로 거절하는 실제 제품 결함이었다.
관측에 read/search만 수리하도록 고치고 기존 strict validator를 유지했다. 봉인 보존 회귀와
새 kernel lane 65 PASS가 이를 검증한다. 첫 실패 로그는 보존했다.

최종 시작 측정은 빌드·테스트와 겹치지 않게 3회씩 순서대로 실행했다. 각 회는 새로운
HOME/data와 같은 현재 checkout, 실제 OMA entry·bundled Pi·PTY를 쓴다. 모델만 로컬 대본이며
OS page cache는 비우지 않았다. 모든 child exit 0이다.

| 실제 관측 | 3회 범위 | 요청한 예산 판정 |
|---|---|---|
| Personal 화면 / 첫 응답 | 1.22~1.24초 / 1.51~1.53초 | 5초 이내; 1초 목표 미달 |
| Society 화면 / 일반 대화 첫 응답 | 2.93~2.99초 / 3.22~3.27초 | 대화는 5초 이내; 1초 목표 미달 |
| 최초 Society broker 준비 | 14.47~14.67초 | 전체 준비 5초 목표 **FAIL** |
| 시작 직후 첫 Society tool 완료 | 15.19~15.38초 | 모두 SQLite에서 `society.set` succeeded 정확히 한 행; 5초 목표 **FAIL** |

`--wait-broker --early-tool` 측정 명령은 예산 미달로 exit 1을 반환했다. 이를 도구 실패나 PASS로
바꾸지 않는다. 부하가 겹친 이전 측정과 Human private 객체를 잘못 복사했던 약 9초 측정은
현재 성능 판정에서 제외한다. Human protocol clone의 별도 단독 대조는 약 6.4초였고
`pack.window=0`도 유의미하게 개선하지 않아 적용하지 않았다. 개인정보 경계·strict history 검증을
건너뛴 시간을 목표 달성으로 다루지 않는다.

```sh
npm test
npm run typecheck
npm run check:architecture
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs kernel --out <new-directory>
OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs crash --out <another-new-directory>
node test/audit/repairs-2026-10-09/native-checks.mjs
python3 scripts/benchmark-startup.py --node <node24> --runs 3 --wait-broker --early-tool
python3 scripts/benchmark-startup.py --node <node24> --mode personal --runs 3
python3 scripts/benchmark-startup.py --node <node24> --runs 3
npm audit --json
```

이 호스트는 Node `/opt/oma-test-node/bin/node` v24.21.0, UID 1001,
`XDG_RUNTIME_DIR=/run/user/1001`이다. local suite의 PATH에는 cloc 2.08과 설치된 `oma` 명령이
필요하다. 이번에는 `/tmp/oma-repair-2026-10-09/bin/oma`가 현재 빌드 entry를 가리키게 했다.
raw 로그는 그 `/tmp` 아래 남겼다. portable 판정·명령·source/log 해시는
[DR36 수정 evidence](../../test/audit/repairs-2026-10-09.evidence.json)에 있다.

전체 suite 실행 시 입력 closure는 sha256 `924ba992c8f836bffc9a8f550ce4acc82a3151bc444b488262f212b5de9ae822`
(15,374 files)였다. 이후 바뀐 것은 결과 문서·evidence이며 실행 코드·테스트·설정 바이트는
실행 시작 시 고정한 해시와 대조한다. kernel 실행 중 생성된 review/LOC metadata와 기록 문서도
당시 capture 이후 변경으로 별도 표시했다; 그 lane의 실행 코드·테스트는 일치한다.
위 DR37 구조 identity는 이후 기록까지 포함한다. 과거 suite가 미래의 자기 결과 문서까지
검증했다는 뜻이 아니다. 각 작업의 기록 후 구조 검사는 별도로 실행한다.

미실행: macOS Virtualization.framework/APFS/Keychain/AF_VSOCK native, 실제 유료 provider,
VM power loss, host reboot, 전체 release qualification. 이전 패키지 세대 보유에 따른 디스크 증가와
정적 provenance의 dynamic-call 한계도 남는다. 58개 변경 생산 파일과 영향 owner를 직접 검토한 것이며,
상속된 미검토 파일을 metadata 재생성만으로 승인하지 않는다.

## 과거 작업: 추가 적대적 감사·기록만 (2026-10-08–09)

이 절의 판정은 수정 지시 이전 기록이다. 아래 checkpoint·전수 원장·suite 수는 해당 시점의 기록이다.
기준 HEAD `0364e99c`와 DR35의 미커밋 시작 수정이 있는 worktree를 함께 고정하고 감사했다.
서브에이전트 없이 문서·실행 먼저 진행했다. production 수정과 기존 테스트 수정은 없다.

발견 13건 중 10건은 실행 재현, 2건은 정적 근거, 1건은 내부 중복으로 분류했고 모두 OPEN이다.
의미·심각도·수정 방향은 [audit](../priority-0-audit.md)의 AV-20261008-01–13이 소유한다.
원시 관측값·양성 대조·source/compiled/Pi 바이트·검사 결과·마지막 대조는
[evidence](../../test/audit/adversarial-2026-10-08.evidence.json), 영역별 검토와 미실행 범위는
[coverage](../../test/audit/adversarial-2026-10-08.coverage.json)에 있다.

이번 oracle는 결함을 재현하면 exit 0이다. 이를 제품 수정 PASS로 읽지 않는다.
confined check는 실제 user manager/cgroup/bwrap에서 대조 검사까지 실행했다.
설정은 실제 두 writer, 패키지는 실제 archive/apply/index와 import된 확장 reader,
C는 production relay의 Unix socketpair 경계, 시작은 실제 PTY와 bundled Pi(모델만 대본)이다.
이 범위를 실제 Mac VM·AF_VSOCK·유료 provider·powercut·전체 release 증거로 확대하지 않는다.
앞선 3,919-suite PASS를 이번 입력의 fresh whole-suite PASS로 재결박하지 않았다.

빌드된 owner가 필요한 재현 명령(빌드는 현재 source에서 준비되어 있어야 함):

```sh
node test/audit/adversarial-2026-10-08/settings-race.mjs
node test/audit/adversarial-2026-10-08/quota-probe.mjs
node test/audit/adversarial-2026-10-08/package-generation.mjs
XDG_RUNTIME_DIR=/run/user/1001 node test/audit/adversarial-2026-10-08/native-checks.mjs
cc -O2 -Wall -Wextra -o /tmp/oma-audit-relay test/audit/adversarial-2026-10-08/relay-probe.c
/tmp/oma-audit-relay
python3 test/audit/adversarial-2026-10-08/early-tool-benchmark.py --node /opt/oma-test-node/bin/node --runs 1
```

실행 환경은 Node v24.21.0, Linux UID 1001, 현재 checkout의 pinned Pi 1.0.1이다.
다른 UID의 `XDG_RUNTIME_DIR`와 Node 경로는 해당 환경에 맞춘다. script의 임시 상태는 자체 소유한 경로에만
만들며 PTY 원시 artifact는 `/tmp`에 남긴다. metadata 손상 시험은 root 권한의 통과를 허용하지 않는다.
architecture rule의 fresh 실행은 PASS/0 findings였지만 실제 AV-01을 놓쳤다. 구조 검사의 한계를 audit에 기록했다.
문서/기록 검사와 최종 생산 바이트 대조의 정확한 판정은 evidence의 `checks`/`finalByteComparison`에 기록한다.
감사 기록 추가로 검증 입력이 바뀌는 것을 기존 release/whole-source PASS의 자동 재승인으로 다루지 않는다.

기준: 2026-10-03 적대적 검증, 생산 source checkpoint `a75c29911c077a2d2b207a48773268e2e2355ca0`. 이 문서는 현재 판정·실행 결과·수치·로그·한계의 단일 owner다. 검증 요구는 [verification-spec](../verification-spec.md), 과거 실행은 [archive](../archive.md)가 소유한다.

## 과거 source 판정 (2026-10-03)

전수 감사는 **진행 중**이다. 현재 production 356개와 추가 실행·계약·native·build/verification source 74개를
[파일별 원장](../../test/audit/full-2026-10-03.review.json)에 고정했다. 원장의 개별 상태·P0 근거가 진행 판정이며,
아래 세 차례의 선택 경계 coverage는 당시 snapshot으로 보존한다. 전수 정적 검토와 실제 release/플랫폼 실행은 별개다.

**Release-blocked.** 최근 mail-v1 merge/review/challenge의 코드와 집중 회귀는 존재한다. 앞선 세 차례 탐색의 제품 결함 16건과 검증 artifact 불일치 1건에 이번 전수 pass의 제품 결함 1건을 더해, 현재 제품 17건 + 검증 artifact 1건이 모두 미수정이다. 전체 구현, 현재 입력의 전체 suite, native macOS 완료를 주장하지 않는다. merge-review spec의 설계안 지위나 활성 규범을 이번 감사로 변경하지 않는다. 아래 2026-10-02 문서 통합과 마지막 기능 checkpoint는 각각 당시 실행 범위를 보존한 기록이다.

## 전수 감사 인계 시점

2026-10-03 사용자 요청으로 [HANDOFF](../HANDOFF.md)에 완료·남은 영역과 직전 작업을 기록했다.
현재 source 범위와 개별 판정은 [전수 원장](../../test/audit/full-2026-10-03.review.json),
신규 결함은 [AV-18](../priority-0-audit.md#av-20261003-18--context-준비-실패가-이미-획득한-lease를-반환하지-않음-p2)을 따른다.

| 항목 | 인계 시점 판정 |
|---|---|
| 고정 전체 정적 범위 | production 356 + 추가 source 74 = 430개. 원장 줄 수는 개행으로 센 참고치이며 cloc 측정이 아님 |
| 전체 읽기와 파일별 P0 판정 저장 | `REVIEWED_STATIC` 430개: production 356 + 추가 74 — 전수 완료. 직접 판정 50 + 위임 pass 취합 342 + B-pass(비P0 일반버그 wave) 잔여 38 |
| 위임 pass | 7개 백그라운드 에이전트 부분 중복 분업(사용자 명시 승인), 부모가 발견 교차 확인·기록. 에이전트는 읽기 전용 |
| 판정 미완료 잔여 | 없음 — B2가 잔여 비TUI 9개, B1이 TUI 28개를 whole-read로 확정해 430/430. 일반 버그 pass로 NB-01..NB-28 추가 기록 |
| source bytes | UNCHANGED: 원장의 production/추가 430개 SHA-256 모두 재대조. HEAD `a75c299` 유지 |
| 신규 required-behavior oracle | DEFECTS REPRODUCED: 4 tests, fail 4, pass/skip/cancel 0 — AV-18(lease fd 잔류), AV-19(`.prepare-*` 잔재 수거 불가), AV-20(startup 비-mail 격리 부재: sweep은 격리·startup은 reject), AV-25(비UTF-8 파일명 → `kind:"corrupt"`) |
| 기존 선택 회귀 | 앞선 세 pass의 361 PASS 기록 보존. 이번 인계 작업에서 다시 실행한 것은 아님 |
| 현재 발견 | AV-01..31 총 31건: 제품 27 + 검증 도구/artifact 4, 모두 미수정 |
| 해결된 후보 | 직전 3개 후보 모두 확정: 임시 tree 잔재(AV-19), workerStatus frame(AV-24), surrogate/비UTF-8 이름(AV-25) |
| full evidence 마감 | NOT_COMPLETE: 새 source/oracle/log/compiled/report 결박 evidence를 마감해야 함. 첫 세 evidence는 역사적 snapshot 그대로 유지 |
| 전체 정적 감사 / 실제 플랫폼·release | INCOMPLETE / NOT_RUN. macOS/native·systemd·powercut·전체 release lane은 여전히 NOT_RUN |

[full oracle](../../test/audit/adversarial-2026-10-03-full.mjs)의 AV-18/19/20/25 실행 로그는 `/tmp/oma-full-oracles-2.log`다.
실제 사용자 상태, manager/VM, provider는 사용하지 않았다. 문서 검사 로그는 `/tmp/oma-full-handoff-documents.log`다.

## 2026-10-03 적대적 검증

사용자 요청으로 clean tree에 기준 커밋 `a75c299`를 만든 뒤 빌드한 생산 코드에 검증을 실행했다.
생산 코드 수정은 없으며, 발견·근거·수정 방향은 [감사 기록](../priority-0-audit.md#2026-10-03-적대적-검증--기준-커밋-a75c299)이 소유한다.
재현 artifact는 [adversarial-2026-10-03.mjs](../../test/audit/adversarial-2026-10-03.mjs)다.
source/fixture/oracle SHA-256과 실행 summary는 [감사 evidence](../../test/audit/adversarial-2026-10-03.evidence.json)에 결박했다.
이 파일도 release qualification을 뜻하지 않는다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| build / typecheck | PASS | `/opt/oma-test-node/bin`의 Node 24.21.0. 생산 코드와 TypeScript 시험을 현재 source로 빌드 |
| merge/review/challenge 집중 회귀 | PASS | 6개 파일, 79 tests, fail/skip/cancel 0 |
| grammar/evaluator fuzz/mail facts/P0/confinement 회귀 | PASS | 6개 파일, 75 tests, fail/skip/cancel 0. fuzz는 3 seeds × 170 ledgers |
| 신규 적대적 oracle | DEFECTS REPRODUCED | 8 tests, fail 8, skip/cancel 0. 제품이 지켜야 할 동작을 assert하며 AV-01..07을 검출. AV-03은 mode/bounds 두 조건 |
| check:architecture | FAIL | 첫 check:inventory에서 source list/LOC hashes 불일치. 이후 chain 단계는 이 aggregate 호출에서 NOT_RUN |
| check:architecture:rules | PASS | 독립 실행, 0 findings |
| check:boundaries | PASS | 구조 검사, 0 findings. registry strongest-injection counts는 이번 실행의 실제 kill 수가 아님 |
| check:documents / git diff --check | PASS | 감사 문서 저장 후에도 문서 구조·링크 검사 0 findings, whitespace 오류 없음 |

집중 회귀 명령과 standalone 재현 명령은 다음과 같다. `NODE_OPTIONS`의 guard 경로는 child가 cwd를
바꾸어도 해석되도록 절대 경로로 지정했다. 상대 guard 경로로 시작한 첫 시도는 CLI child import 실패여서
제품 실패나 위 표의 실행 결과로 세지 않고, 절대 경로로 다시 실행한 결과를 사용했다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
npm run build
npm run typecheck
node --test --test-concurrency=1 \
  dist/test/merge-review.test.js dist/test/challenge-review.test.js \
  dist/test/review-faults.test.js dist/test/review-concurrency.test.js \
  dist/test/review-evaluation.test.js dist/test/merge-cli.test.js
node --test --test-concurrency=1 \
  dist/test/review-grammar.test.js dist/test/review-evaluation-fuzz.test.js \
  dist/test/mail-facts-boundary.test.js dist/test/priority-0.test.js \
  dist/test/p0-review7.test.js dist/test/resident-confinement.test.js
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03.mjs
```

standalone 재현은 현재 결함이 있는 source에서 exit 1이 정상적인 **검출 결과**다. suite PASS로 승격하지 않는다.
독립 재현은 root-level normal suite에 자동 편입되지 않으며, 수정과 함께 정상 회귀로 옮길 수 있다.
위 명령은 전체 `npm test`, 환경 lane, SIGKILL/powercut 검증을 실행하지 않는다.
실제 사용자 OMA/VM·인증 정보·유료 provider는 사용하지 않았다. inherited execution exclusions는 HANDOFF에 유지한다.

로그는 `/tmp/oma-adversarial-{build,typecheck,baseline,extended,reproductions,architecture,rules,boundaries,documents}.log`다.
임시 로그는 release evidence로 등록하지 않았다. 이번 source에 과거 LOC/trace evidence를 자동 재사용하거나
measurement 파일을 손으로 수정하지 않았다.

### 2차 경계 확장

같은 `a75c299` 생산 source에서 메일 read/reply/arrival, corruption fence, config generation,
lifecycle authority와 IPC 자원 수명으로 범위를 넓혔다. 파일별 선택 경계·한계는
[감사 기록의 2차 검증](../priority-0-audit.md#2차-검증--메일권한설정ipc-경계-확장)에 기록했다.
새 [oracle](../../test/audit/adversarial-2026-10-03-second.mjs)과
[evidence](../../test/audit/adversarial-2026-10-03-second.evidence.json)는 이 실행을 별도로 결박한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| config/mail/IPC/run/registry/TUI/contained-tools 회귀 | PASS | 아래 11개 파일, 106 tests, fail/skip/cancel 0. 1차 154개와 합해 선택 회귀 260개 |
| 추가 적대적 oracle | DEFECTS REPRODUCED | 4 tests, fail 4, skip/cancel 0. AV-09..12 각각 required behavior assertion 실패 |
| 초기 long-thread 탐색 | INCONCLUSIVE | 8192-byte fixture의 350-entry 시도: 3 defect assertions fail, history test 1 cancelled(timeout). history 자체는 이 결과로 확정하지 않음 |
| 축소 long-thread 재현 | DEFECT REPRODUCED | 2048-byte supported config, 정상 접수 40개 이후 short vote와 cancel 거절, reopen 뒤 cancel도 거절. 최종 4-oracle 실행에 포함 |
| 생산 source 변경 여부 | UNCHANGED | 같은 source digest와 HEAD. 생산 코드 수정 없음 |
| 문서·whitespace 검사 | PASS | 추가 발견·범위·한계 저장 뒤 독립 실행 |

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test \
  dist/test/config-generations.test.js dist/test/config-snapshot.test.js \
  dist/test/operations-config.test.js dist/test/mail-integrity.test.js \
  dist/test/mail-recovery-integrity.test.js dist/test/mail-reply.test.js \
  dist/test/r14-connection-lifecycle.test.js dist/test/r16-run-registry.test.js \
  dist/test/r25-lifecycle-owners.test.js dist/test/tui-sources.test.js \
  dist/test/contained-tools.test.js
node --test test/audit/adversarial-2026-10-03-second.mjs
```

2차 로그: `/tmp/oma-adversarial-second-baseline.log`,
`/tmp/oma-adversarial-second-reproductions.log`(초기 timeout 포함),
`/tmp/oma-adversarial-thread-boundary.log`(축소 독립 재현),
`/tmp/oma-adversarial-second-final.log`(최종 4개 oracle),
`/tmp/oma-adversarial-second-documents.log`.
log/source/oracle SHA-256은 2차 evidence를 따른다. initial timeout을 PASS나 새로운 결함으로 승격하지 않는다.
직접 만든 Unix socket endpoint는 tool→CLI 재현의 로컬 fixture이며 native actor 인증 검증을 대신하지 않는다.
실제 manager/VM/provider, 전체 suite, SIGKILL/powercut lane은 계속 NOT_RUN이다.

### 3차 범위 확장과 coverage 공개

같은 생산 source에서 inference relay construction/connection bounds, host/guest run 종료, late resolver와
platform request ledger를 추가 검증했다. source는 checkpoint와 동일하고 제품 수정은 없다.
새 [oracle](../../test/audit/adversarial-2026-10-03-third.mjs)과
[evidence](../../test/audit/adversarial-2026-10-03-third.evidence.json)는 이 실행을 결박한다.
발견과 파일별 경계 판정은 [감사 기록의 3차 검증](../priority-0-audit.md#3차-검증--추론-연결실행-종료영속-원장)을 따른다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| relay/egress/tenure/history/delivery-deadlines 회귀 | PASS | 아래 5개 파일, 81 tests, fail/skip/cancel 0 |
| guest request ledger 회귀 | PASS | 별도 1개 파일, 20 tests, fail/skip/cancel 0. 3차 총 101개, 누적 선택 회귀 361개. 임시 원장 전용 child의 during-effect/after-outcome SIGKILL 2개 포함 |
| 추가 적대적 oracle | DEFECTS REPRODUCED | 5 tests, fail 5, skip/cancel 0. AV-13..17 required behavior 실패. 총 발견 17개 가운데 제품 16/검증 artifact 1 |
| source와 compiled artifact 결박 | UNCHANGED / BOUND | production manifest의 현재 356 files를 1차 source hashes와 대조. 3차 oracle이 import한 compiled file과 회귀 fixture hashes도 기록 |
| 전체 파일 review coverage | INCOMPLETE | production 356개 중 전체 파일 읽기+선택 경계 판정 19개, 선택 함수 판정 36개, 이번 감사의 경계 판정 기록 없음 301개 |
| 문서·whitespace 검사 | PASS | 추가 발견과 범위 목록 저장 뒤 독립 실행 |

coverage는 [파일별 JSON](../../test/audit/adversarial-2026-10-03.coverage.json)의 356개 행에서 계산했다.
전체 파일을 읽었다고 모든 branch/규칙을 검증한 것은 아니다. 55개 파일의 선택 경계 기록도 전수 감사를 뜻하지 않는다.
“기록 없음”은 이번 감사에서 개별 경계 판정을 남기지 않았다는 뜻이며, 예전 commit의 검토나 회귀 실행만으로 상태를 올리지 않는다.
이 목록은 production source의 범위다. 시험·문서·생성 artifact는 해당 실행·hash 목록에서 별도로 다루며
전체 repository의 모든 파일을 감사 완료했다고 주장하지 않는다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test \
  dist/test/inference-relay.test.js dist/test/platform-egress.test.js \
  dist/test/host-tenure.test.js dist/test/session-history.test.js \
  dist/test/delivery-deadlines.test.js
node --test dist/test/platform-request-ledger.test.js
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03-third.mjs
```

3차 로그: `/tmp/oma-adversarial-third-regressions.log`, `/tmp/oma-adversarial-third-ledger-regressions.log`, `/tmp/oma-adversarial-third-oracles.log`,
`/tmp/oma-adversarial-third-documents.log`. source/oracle/coverage/report/log hashes는 3차 evidence를 따른다.
앞선 두 evidence의 report hashes는 당시 저장된 report snapshot이며 3차 실행 판정으로 승격하지 않는다.
3차 fixture는 실제 임시 Unix sockets·product pool/service/parser·synthetic credential만 사용한다.
AV-14/15의 provider 응답 대조는 endpoint 밖 경로의 relay HTTP 403이고 upstream 요청은 없다.
기존 relay 회귀는 loopback의 self-signed TLS provider stand-in을 사용한다. 외부·유료 provider는 사용하지 않는다.
host/guest byte channel의 hello는 fixture가 공급하므로 native VM/bridge/authentication proof를 대신하지 않는다.
임시 ledger의 두 SIGKILL 시험을 다른 durable 경계나 전원 손실 proof로 일반화하지 않는다.
실제 manager/VM, 전체 suite, 전체 SIGKILL/powercut lane은 계속 NOT_RUN이다.

### 마지막 기능 checkpoint

다음은 문서 통합 전 마지막 기능 변경의 checkpoint다. 상세 로그와 당시 source binding은 [정리 전 검증 기록](../archive/validation-before-consolidation.md)에 보존했다. 과거 전체 실행을 현재 PASS로 사용하지 않는다.

| 요구 | 실제 구현과 정상/실패 oracle | 현재 판정·남은 것 |
|---|---|---|
| A tier/floor/checks | `runtime/candidate-checks`, GitModule callback와 broker 조립; candidate-checks·tiered-integration·tier-evaluator·integration-revalidation | 코드/fixture 검증. reviewer shortage 예외는 미구현/별도 거절에 따른 차단 상태. 실제 manager/cgroup candidate 검사도 별도 거절로 NOT_RUN. mutation/실환경 proof 미완료 |
| B Principal | `principalRequestAllowed`, PublicDispatcher, tool-surface와 workspace-guard; principal-stop-fence·tool-surface·실제 Pi의 loopback functional scenario | 제한적 source/runtime 회귀 통과. 다른 도구의 권한은 Principal routine 권한으로 승격하지 않음 |
| C 독립 clone/최초 snapshot/Config/수량 | `lifecycle/workspace`의 `clone --no-local`, raw worktree snapshot, Initial workers commit, 생성 quota와 inference slots; project-snapshot·worker-autonomy·settings-apply-time | SHA1/SHA256/dirty bytes·손상 거절·설정 0 및 재시작 회귀 확인. unit 설치는 scripted; manager proof 아님 |
| D closed/개별 stopped | `lifecycle/society`, actions와 reconcile activation gate; society-control·worker-autonomy·r25-lifecycle-owners | closed 재열기와 terminal replay·개별 stopped·현재 incarnation 회귀 확인. fake units를 실제 manager 증거로 취급하지 않음 |
| E 시간값·선택 mail | PiAdapter/PrincipalDelivery, selector alarm, egress placeholder alarm; delivery-deadlines·egress-observation-deadlines·r25-lifecycle-owners·f3-log-frame | 전체 TypeScript native timer/phase-budget call sites 분류. model/tool 전체 실행 deadline 없음. 긴 selector/egress waits의 native clamp 수정. 종료 grace는 writer exit proof가 아님 |
| F1 Mac seed | host-record project UUID/bookmark/root, bundled Git/helper, existing settings writer의 async seed; mac-project-seed·personal-settings·platform-host-service | absent binding은 빈 seed, unknown은 거절. bound project의 첫 seed에는 이미 실행 중인 app/guest가 필요함. Swift bookmark helper NOT_BUILT/NOT_RUN |
| F2 history | guest/host canonical identity·read-only paged preview·one private duplex channel·actual outgoing exit·post-cleanup host reread; host-history·guest-history·actual local PTY holder·composition/ownership | Linux의 로컬 실제 file/socket/PTY와 controlled process 경계 회귀 확인. remote 검색은 title/첫 메시지 preview 범위. native Mac/actual systemd holder 시작은 NOT_RUN |
| G 기록 | source owners, stale byte-review 철회, LOC/graph/ledger/trace/current digest | 정리 전 checkpoint는 archive에 보존. 이번 reference/trace 결박·구조 검사는 별도로 갱신하며 과거 static PASS를 새 입력에 재사용하지 않음 |

## 이번 문서 통합의 검증

문서 경로·owner·규범 fingerprint 구조 확인은 runtime/systemd/provider proof와 구분한다. 아래는 Node 24.21.0을 사용한 이번 문서 통합의 실행 결과다.

| 검사 | 판정 | 범위 |
|---|---|---|
| 문서 배치·링크·ID/수용 번호 | PASS | 새 파일·이동 파일 포함, 링크/ID/owner 검사 0 findings. 기존 규범 375개 ID와 수용 124행의 번호·내용 유지. 규범 내용은 경로·링크를 제외하고 동일 |
| 고정 architecture·계획·외부 리뷰 bytes | PASS | 정리 전 156개 파일의 SHA-256과 대조. 원문 bytes 동일 |
| 새 merge-review spec 본문 | PASS | 상대 Markdown 링크를 제외한 원문 동일성 확인. 설계·본문 보존 |
| document/trace/compliance/verification/review 경로 회귀 | PASS | 관련 8개 파일의 44 tests, fail/skip/cancel 0. 실제 서비스 실행 제외 |
| build / typecheck / check:architecture | PASS | 패키지 정적 검사·production inventory·규칙·의존 방향·transaction·durable boundary·문서 검사 |
| trace inventory / review ledger 생성 | GENERATED | 실제 owner 경로로 생성. 규범 375개 모두 unverified, stale/extra 0. 기존 UNIT-TPL-001..004의 inventory 누락도 복구. 생성은 검증 승격이 아님 |
| pinned cloc 재측정 | PASS | production 목록·원본 hash·측정 artifact 결박. 크기 상한 없음 |

실행 로그는 `/tmp/oma-doc-cleanup-build.log`, `/tmp/oma-doc-cleanup-typecheck.log`, `/tmp/oma-doc-cleanup-architecture.log`, `/tmp/oma-doc-cleanup-regressions.log`, `/tmp/oma-doc-cleanup-loc.log`, `/tmp/oma-doc-cleanup-review-ledger.log`에 있다. 임시 로그는 release evidence로 등록하지 않았다.

집중 회귀의 실행 명령:

```sh
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs \
  test/review-ledger.test.mjs test/consistency-decisions.test.mjs \
  test/review-closure.test.mjs test/durable-boundaries.test.mjs \
  test/production-inventory.test.mjs dist/test/compliance.test.js
```

## 선행 작업 A: Pi 0.87.1 → 1.0.1 이식 검증 (2026-10-05)

동봉 엔진을 `@earendil-works/pi-coding-agent@0.87.1`→`1.0.1`, `@earendil-works/pi-tui@0.87.1`→`1.0.1`,
`pi-open-tui@0.3.9`→`0.3.11`로 원자적으로 올렸다(package.json + package-lock 한 커밋). 이식 내용과
upstream delta 판정은 [plan §A 실행 결과](../plan-prereq-and-bundled.md#a-실행-결과-1010311-이식-완료)가 소유한다.
`PI_ADAPTER_REVISION`은 ENG1 관례대로 검증한 엔진을 이름에 박아 `oma-pi-rpc-v1@1.0.1`이 되었고
BATCH-006의 규범 본문과 trace 행도 같은 문자열로 재결박했다. 0.87.1 adapter의 미정산 영수증은
업그레이드 뒤 conflicting이다 — 기존 society는 정산 뒤 올린다(ENG1과 같은 절차).

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| package-lock / 설치 closure | PASS | `npm install` 재생성, `npm ls @earendil-works/pi-tui` 단일 1.0.1(dedupe, 중첩 사본 없음). pi-agent-core/pi-ai는 `^1.0.1` 범위로 1.0.3 |
| build / typecheck | PASS | Node 24.21.0(`/opt/oma-test-node/bin`), `npm run build` + `tsc --noEmit` 0 오류 |
| pi-compat 오라클 | PASS | `test/pi-compat.test.ts` 전부 — 환경 스트립 목록·resume hint·private member 12개 존재를 설치본 1.0.1에서 실측 대조. `quietStartup "header"` literal 보존 회귀 추가 |
| wire/명령·호환 경계 | PASS | interactive-input 내장 명령 미러, `pi-ui-channel-spike`의 1.0.1 UI RPC 메서드 목록, `prompt-boundary` 경계 시험 |
| 실제 엔진 PTY 회귀 | PASS | `open-tui-pty`(8 ending) + `personal-pty`(15 ending): 실제 1.0.1 InteractiveMode + open-tui 0.3.11 extension + ownedEditor proxy로 /new·/resume·/fork·/reload·kill·retry·restore |
| delivery/authority 시나리오 | PASS | 전체 `npm test`의 SCN-*/DR27/broker/authority/receipt/frame-boundary 그룹 포함 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane — 아래 NOT_RUN 제외, 총수·실패수는 실행 로그가 소유 |
| check:architecture | PASS | inventory·rules·architecture-check·transactions·boundaries·documents·spec-inventory 0 findings |
| review-ledger / review-closure | GENERATED | 변경 production 파일은 `review-notes.json`의 byte-bound reviewedChange로 결박 후 재생성 |
| systemd-required suite | NOT_RUN | test-local이 명시한 9개 파일(audit/audit2/cli/phase4/phase5/phase8/crash-boundaries/launch-topology/cgroup-pin) — 이 Linux 호스트에 user bus/systemd 없음 |
| kernel/rootfs/deployment attestation | NOT_RUN | 빌드 스크립트가 "entrypoints not started, systemd/kernel/rootfs/Pi pins not attested, deploymentDigest 미합성"으로 보고 — 로컬 한계 그대로 |
| powercut / provider / CI / macOS native | NOT_RUN | 승인된 VM·credential·CI가 없어 이전과 같은 제외. V27A·V31A의 과거 PASS는 이 엔진/이 source로 승격하지 않는다 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업 C: `/society` 게이트 + execve 재진입 검증 (2026-10-05)

기록 없는 Personal 세션의 Society 전환을 구현했다 — `/society` → 프로젝트 자신의 슬롯(`<data>/<project>`)
읽기 전용 게이트 → `session_before_switch` → writer 실제 종료 → host가 `oma --society <project>`로
execve. 계약은 MODE-005, 설계 판정·명령명 확정·내구 경계 선택은 [plan §C 실행 결과](../plan-prereq-and-bundled.md)가
소유한다. 내구 경계는 슬롯의 `publishProjectBinding`: 게이트↔재진입 구간은 무기록이므로 그 사이의
kill/powercut은 다음 `/society`의 재관측으로 끝나고, binding 게시 뒤 재시작은 그 Society를 born으로
인식한다. 미확정 게시는 성공으로 승격하지 않는다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| 게이트 실파일 오라클 | PASS | `test/society-slot.test.ts` 8종 — free·슬롯 무생성, binding 게시→거절 전환(내구 경계), 다른 프로젝트/다른 society 바인딩, 손상 바인딩(unreadable), EACCES 관측 불가(unavailable→거절, 부재 승격 없음), binding 없는 Society 기록, 동일 birth 잔여=재개·다른 birth=거절, legacy slug 슬롯 |
| wire 문법 | PASS | `personal-session-ownership` — `{type:"switch", society}` 수락, session+society 혼합·미스트링·추가 키 거절, 실패 종료(≠0)에는 handoff 없음, 첫 유효 메시지만 |
| host 합성 | PASS | `personal-host-composition` — 자식 실제 종료 전 execve 없음, argv `[oma.js --society <project>]`, `OMA_RESUME_SESSION` 미설정, birth cwd로 chdir(resume된 창과 다를 수 있음), 이름 불일치 INVALID_REQUEST, execve 부재 UNSUPPORTED_PROFILE |
| 엔진 합성 | PASS | `personal-engine-ownership` — `society` 명령 등록, free 슬롯 → before-switch → send → shutdown 순서, 거절·관측 실패 통지 후 세션 유지, darwin 무전환 거절(게이트 미호출), before-switch cancel, 전환 중 이중 진입 불가, IPC send 실패 시 재시도 가능 |
| 실제 PTY 거절 | PASS | `personal-pty` `society-bound` — 설치본 Personal에서 바인딩된 슬롯에 `/society` 입력 시 이름 있는 거절이 화면에 보이고 세션은 계속 살아 응답 |
| 실제 전환 e2e (Linux) | PARTIAL — 환경 한계 | `/society`가 real TUI에서 gate→종료→execve `oma --society <project>`까지 수행됨을 pty-harness로 관측; 재진입 프로세스가 `project-binding.json`(canonical path)+`session-mode.json`(mode society)+provisioning 트리를 실제로 기록하고 Society Control Panel까지 도달. broker 시작은 `UNSUPPORTED_PROFILE: systemd user manager`로 정직 실패 — 이 호스트에 user bus 없음(기존 systemd NOT_RUN lane과 동일). TUI 단계 이후 정상 동작·Worker는 미검증 |
| 내구 경계 회귀 | PASS | `crash-kill-boundaries`의 D05/P0-7 binding SIGKILL 전 지점 absent-or-whole + 임시파일 수거 — `/society`가 의존하는 게시물의 기존 경계 시험 재확인 |
| 인접 회귀 | PASS | `project-binding`, `session-mode-record`, `session-resume`, `session-entry-composition`, `oma-composition-policy`, `session-handoff-owner`, `interactive-input`, `compact-tools`, `society-crash`, `session-mode-pty`, `personal-pty` 전 종 |
| check:architecture·inventory·ledger | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; `production-files.txt`/`production-loc-hashes.json`/`traceability.json`/`review-ledger.json` 재생성, `review-notes.json`에 신규·변경 파일의 byte-bound reviewedChange 결박 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3635 tests → 3634 PASS; 유일 실패 1건은 이 변경이 추가한 두 파일까지 반영하지 않은 stale verification-input digest로, digest를 이 트리의 것으로 갱신 후 `production-inventory` 재실행 10/10 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd broker 완주 / powercut·provider·CI | NOT_RUN | 승인된 환경 없음 — `/society`의 darwin 분기는 주입 시험만으로 구조 검증됐고 native 증거를 주장하지 않는다 |

## 선행 작업: bundled extension #4 — pi-web-access 검증 (2026-10-08)

§7 순서(lsp→ask→hashline→web→mcp)의 네 번째 확장. `pi-web-access@0.35.0`을
`src/extension/vendor/pi-web-access/`에 byte-pinned vendor하고 `src/extension/web-tools.ts`
어댑터가 verify→Society 정책 설치→facade→upstream 팩토리 순서로 정확히 4개
web_research 도구만 등록한다. 구현 내용과 divergence 목록은 WORKSTREAM §9 로그와
`src/extension/vendor/pi-web-access/NOTICE`가 소유한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| upstream 정체성 | PASS | npm tarball shasum `a807f0d5c6dfa6893f24e00320774a55425f864b`·SRI `sha512-D1GMJMNDG2omAkL1ztmO6ZEwEyW7LoFpTcckKh2yXjLyAgDFuhpTQrs2jQPAlVtGb3rjAeIXRZrkhFcwSWdGSg==`·source commit `72c6e67787d67d8a7d01bf0abf30c072a6112de6` — `manifest.json` package 필드와 생성기 EXPECTED_PACKAGE가 결박 |
| 번들 생성·재생성 | PASS | `node scripts/vendor-pi-web-access.mjs --check` → `BUNDLE_CURRENT` (11,020 files): staged 소스 재작성→tsc 재방출→divergence 재적용→발방출 집합 비교→매니페스트 메타(package·dependencies·divergences) 재검증 |
| 번들 무결성 경계 | PASS | `test/web-bundle.test.ts` 12종 — source/dist 번들 검증, 변경·누락·미기재·손상 멤버 fail-closed, upstream-tests 트리 보존(104 entries), 정확한 4개 도구·facade 전달만·검증 실패 시 등록 0+세션 거절, 역할 surface 정합(Principal·Resident 모두 web_research 그룹), ambient discovery deny-by-default(`!command` credential·browser cookies·gh/git clone·host ADC·native media·local file·curator workflows), egress 미결선 시 비어있지 않은 proxy 전면 거절·결선 시 pin 외 값 `[E_OMA_PROXY_PINNED]`, SSRF/내부 대상 사전 거절, 매니페스트 메타 결박 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings — 어댑터의 동적 import는 전부 검증된 번들 안 runtime/ 경로(undici dispatcher는 utils.js divergence의 re-export를 경유; runtime-closure 해석기는 node_modules 해결 지정자를 거절하므로) |
| check:package | PASS | vendored runtime의 host API(`@earendil-works/*`, typebox) import는 설치본 존재를 확인하는 host peer 의미로만 허용 — 사용자 설치 Pi 패키지 해석과 무관 |
| 인접 회귀 | PASS | `lsp-bundle`(BL1)·`hashline-bundle`(BL3)의 surface 테스트에 web_research 등록 집합·그룹 추가 후 전 종 PASS; `platform-packages`·`pi-packages-cli`·`p24-deployment-gates`·`personal-pty` 전 종 PASS — `deployment-manifest.ts`의 MAX_ENTRIES를 4096→32768로 상향(vendored 클로저 ~11k 파일이 deployment inventory walk의 해시 대상; bound는 여전히 absurd inventory 거절) |
| DR27 대기-관측 시나리오 | PASS | `scenario-agent-wait` 5/5 — `idleStreamSeconds` 2→6초·fixture 관측 지연 3.5→10초: 번들 검증(~0.5s)+모듈 평가(~0.8s)이 엔진 기동을 2초 예산 밖으로 밀어 DEADLINE_EXCEEDED로 deterministic 실패하던 것을 예산 상향으로 정정(관측이 제어-idle 예산을 outlive한다는 시나리오 의미 보존) |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3794 tests → 3790 PASS, 실패 4건의 내역: web-bundle/dist 1건과 R38 2건은 이 절 작성 시점의 미재생성 산출물(NOTICE 문구 갱신 후 dist·digest 미동기)로, 재빌드·digest 재결박 후 단독 재실행 전부 PASS; SCN-L02 1건은 8-way 병렬 aggregate에서만 재현되는 타이밍 flake로 단독 재실행 40/40 PASS — systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 | NOT_RUN | `upstream-tests/`는 provenance/포팅용으로 vendored — upstream 자체 하네스 의존(vitest·네트워크 fixture)이라 npm test에 연결하지 않음 |
| macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 승인된 환경 없음 — 이전과 같은 제외. vendored egress dispatcher의 실제 CONNECT forwarder 통과는 Linux 루프백 경계 시험까지만 확인 |

**정정 (후속 맹검증)**: 위 `npm test` 기록("3794 tests → 3790 PASS, 실패 4건")은 deterministic 실패 1건을 누락했다. 이 트리에서 `test/review-closure.test.mjs`의 "DR27/V32A: historical review cannot certify unbound working-tree changes"가 `git ls-tree -r --name-only -z HEAD`의 출력(1,064,186 bytes — vendored 번들이 HEAD tree listing을 Node `execFileSync` 기본 maxBuffer 1 MiB 위로 밀어 올림)이 default bound를 초과해 ENOBUFS로 실패하고, `node scripts/review-ledger.mjs`(`npm run review:ledger`)도 같은 call에서 ENOBUFS로 exit 1이었다. 기록된 4건의 열거에는 이 실패가 없으므로 당시 실행의 실제 실패 수는 최소 5건이었거나, 이 실패가 같은 실행에서 발생했다면 기록이 누락된 것이다. 수정: verification tooling의 모든 동기 git plumbing 호출(`review-ledger.mjs`의 `ls-tree`/`diff --name-only`/`log`, `review-closure.test.mjs`의 동일 두 call)에 canonical bound를 적용했다 — `scripts/review-closure.mjs`의 `GIT_PLUMBING_LIMITS`가 `CANONICAL_PROCESS_LIMITS`(src/git/canonical-command.ts)와 동일 값으로 test에서 결박되고, 회귀 test "V32A: verification git plumbing runs under the canonical process bound"가 generator의 모든 `execFileSync` call site가 bound를 통과함을 pin한다. 수정 후 `node scripts/review-ledger.mjs` exit 0, 해당 suite 파일 8/8 PASS.

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업: bundled extension #5 — pi-mcp-adapter 검증 (2026-10-09)

§7 순서의 마지막 확장. `pi-mcp-adapter@5.0.0`을
`src/extension/vendor/pi-mcp-adapter/`에 byte-pinned vendor하고
`src/extension/mcp-tools.ts` 어댑터가 verify→정책 설치→수명주기 훅→
facade→upstream `createMcpAdapter` 순서로 정확히 `mcp` 1개 도구만
등록한다 — upstream 자체가 lazy 단일 프록시라 OMA grouping을 얹지 않고
surface plan이 `mcp`를 DIRECT로 이름 붙인다. 구현 내용과 divergence
목록은 WORKSTREAM §9 로그와 `src/extension/vendor/pi-mcp-adapter/NOTICE`가
소유한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| upstream 정체성 | PASS | npm tarball shasum `6c20461d658ec7d7b7e303b067e2ff13a7846d00`·SRI `sha512-/3vWQLSXwud+VX1vV/dFfKpp6I40guCeqiaP/XMdXIyon+frIm+sPXGArLlmvY5PIwL2ChJ3AhELIusroGA8Ng==`·source commit `5783e5eacfe820829b18be5d4de91e5f46e79dbb` — `manifest.json` package 필드와 생성기 EXPECTED_PACKAGE가 결박 |
| 번들 생성·재생성 | PASS | `node scripts/vendor-pi-mcp-adapter.mjs --check` → `BUNDLE_CURRENT` (2,727 files): staged 소스 재작성→tsc 재방출→27파일 divergence 재적용→발방출 집합 비교→매니페스트 메타(package·dependencies·divergences) 재검증. upstream `npx-resolver.ts`의 implicit any·cross-spawn 선언 부재에 대한 비치명 tsc 진단은 stderr에 기록되나 발방출 집합 일치 시 성공(BL4 관례) |
| 의존 클로저 | PASS | DEPENDENCIES 핀 테이블 42개 패키지(`@modelcontextprotocol/client`·`core`·`ext-tasks`, `undici`, `zod`, `ajv` 계열, `open` 계열, `@napi-rs/keyring`, `recheck`, `quickjs-wasi` 등)가 `node_modules/` 아래 npm tarball 바이트 그대로(2,086 files); 사용자 설치 패키지는 어떤 vendored import도 충족하지 못한다 — 번들 자체 node_modules walk만 허용 |
| 번들 무결성 경계 | PASS | `test/mcp-bundle.test.ts` 14종 — source/dist 번들 검증, 변경·누락·미기재·링크·손상 멤버 fail-closed, upstream-tests 트리 보존(207 entries), 정확한 `mcp` 1개 도구·facade 전달만(command·flag·shortcut drop 기록)·검증 실패 시 등록 0+세션 거절, `registerMcpServer`/`getMcpServers` 부재로 Pi built-in MCP 공존 경로 소등(`piSupportsMcp` false), 두 role surface plan이 `mcp`를 DIRECT로 명명·그룹 없음, config 검증이 `imports`·`claudePlugins`·surface-변경 설정·`npx`/`npm` command·비-http(s) url·`!`-command secret sink를 거절, OMA 소유 `mcp-adapter.json`(Pi built-in `mcp.json`과 구분되는 upstream adapter-config 이름)만 읽고 malformed fail-closed, OMA state의 credential key·scratch 수명주기(shutdown에 삭제), 공유 child-env scrub(allowlist·proxy pin 일치만·scratch redirect), 정책 설치가 vendored runtime 안에서 live, egress pin·loopback bypass·무결선 no-proxy fallback, 매니페스트 메타 결박 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings — `mcp-tools.ts`의 raw fs mutation은 Pi extension 경계 면제 표(`state-tree-rules.mjs`·`owned-state-rules.mjs`, lsp-tools와 같은 사유)에 명시 등록; `production-files.txt`·`production-loc-hashes.json`·`dependency-graph.json` 재생성 |
| check:package | PASS | vendored runtime의 host API import는 BL4와 같은 host peer 의미로만 허용 |
| `--no-extensions` 정합 | PASS | `pi-spawn-plan.ts`·`pi-interactive-host.ts`·`pi-personal.ts`의 세 엔진 경로 전부 `--no-extensions`(discovery 소등)와 명시 `-e` core extension 경로를 양립 사용 — vendored 등록은 core extension 안에서 일어나므로 정책 충돌 없음 |
| 인접 회귀 | PASS | `lsp-bundle`(BL1)·`hashline-bundle`(BL3)·`web-bundle`(BL4)의 surface 테스트 등록 집합에 `mcp` 추가 후 전 종 PASS — 공유 `child-env.ts` 추출로 LSP의 child env 의미 변경 없음을 lsp suite가 재확인 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane — 재결박 전 첫 실행은 3809 tests → 3803 PASS·6 실패로, 6건 전부가 이 절 작성 시점의 미재생성 산출물(BL1/BL3/BL4 surface 집합 미갱신 3건, review-closure의 ledger 결박 2건, R38 verification-input digest 1건)이었다; 수정·재생성 후 해당 파일 단독 재실행 전부 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 | NOT_RUN | `upstream-tests/`는 provenance/포팅용으로 vendored — upstream 자체 하네스(vitest·네트워크 fixture) 의존이라 npm test에 연결하지 않음 |
| 실제 MCP server live 세션 / macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 승인된 환경·자격 없음 — 경계 시험은 fakePi·정책 프로브·loopback 경계까지, 실제 downstream MCP 서버와의 end-to-end 세션 증거는 주장하지 않는다 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업: bundled extension #5 — pi-mcp-adapter 맹검증 정산 검증 (2026-10-09)

BL5 vendored 어댑터에 대한 맹검증 잔여 발견 F1–F6의 정산. 구현 내용은
WORKSTREAM §9의 해당 로그가 소유한다; 이 절은 검증 범위만 기록한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| F1 SDK child-env union | PASS | `mcp-tools.ts`의 `childEnvFinish`가 scrub 결과 위에 vendored SDK `getDefaultEnvironment` underlay 이름의 `undefined` tombstone을 씌운다 — vendored `node_modules/.../stdio.mjs`의 실제 `StdioClientTransport`로 child를 spawn해 `process.env`를 직렬화, scrub이 거절한 `SHELL`과 win32 underlay 이름(APPDATA·HOMEDRIVE·HOMEPATH·LOCALAPPDATA·SYSTEMROOT·TEMP·USERNAME·USERPROFILE·PROGRAMFILES·LOGNAME·TERM·USER)이 child에서 부재·`HOME`/`LANG`/`PATH`는 OMA 값으로 존재를 확인; tombstone을 뺀 대조군에서는 `SHELL`이 SDK underlay에서 재유입됨을 같이 관측해 결함 재현. dependency 바이트 변경 없이 OMA 소유 코드에서 해결 |
| F2 UI-session escape | PASS | `OmaMcpPolicy`에 deny-by-default `ui-session` permit 추가; `direct-tools.js`·`proxy-modes.js`는 UI-resource 호출을 구조화된 `ui_session_refused`로 조기 거절하고 `ui-session.js`·`glimpse-ui.js`는 방어심층 게이트로 `who`/`orca` subprocess·`npm root -g`·host-global `glimpseui` 동적 import·browser open에 도달하기 전에 거절 — fakePi로 실 vendored stdio server를 띄운 E2E 포함, 정책 미설치 시 upstream 동작 보존 |
| F3 부재 판정 | PASS | `existsSync` 대신 `statSync` ENOENT-only catch — chmod 000 config는 `EACCES`로 propagate(빈 config로 오인 금지)·비-정규 경로는 `[E_OMA_MCP_CONFIG]` 경계 에러·malformed JSON과 구분; `oauth-file-key` 읽기 실패도 ENOENT만 "없음"이고 나머지는 재throw해 침묵 키 재발급 차단 |
| F4 command admission | PASS | `npx`/`npm` 거절이 basename 정규화(`/`, `\`, `.cmd/.exe/.bat/.ps1` shim, 대소문자) 후 비교 — `/usr/bin/npx`·`./node_modules/.bin/npx`·`C:\Tools\npm.cmd`·`C:\Program Files\nodejs\npx.EXE`·`npm.ps1`·`npx.bat`·`NPM` 전부 거절, `npm-helper`·`npx-serve`·`srv.CMD`·`/usr/local/bin/server-bin` 허가 유지 |
| F5 dead code | PASS | 미사용 `omaStateDir()` 헬퍼와 `{stateDir:"",durable:false}` 폴백 제거 — typecheck이 참조 부재를 입증 |
| F6 tautological assert | PASS | `mcp-bundle.test.ts`의 upstream-tests 검증에서 직전에 assert된 조건을 반복하던 `A || B` 분기를 vitest config·test-runner 존재와 suite 규모(>=150 test files)의 실체 검증으로 교체 — vendored 트리가 테스트를 침묵 상실하면 실패 |
| 번들 재생성 | PASS | `node scripts/vendor-pi-mcp-adapter.mjs --write`로 runtime·manifest 재생성 후 `--check` → `BUNDLE_CURRENT` (2,727 files); 의미 변경은 전부 `OMA_DIVERGENCES` 표 기술분, dependency 바이트 무수정 |
| `pi.events` posture | PASS(기록) | facade가 `pi.events`를 그대로 전달하고 `pi-mcp-adapter:runtime-register`는 `normalizeOmaMcpConfig`를 우회해 runtime 서버를 등록할 수 있다 — in-process 전용이고 다른 OMA 확장이 발행할 수 없으며 런타임 거절은 등록 서버에도 적용됨을 모듈 주석·review-notes에 기록; 완전히 닫힌 경계가 아니라 문서화된 posture |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture / check:package | PASS | inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; host API peer import 정책 변경 없음 |
| `test/mcp-bundle.test.ts` | PASS | 18종 전 종 PASS (기존 14종 + tombstone 실spawn·UI 거절 E2E·ENOENT-only 부재·basename 거절 확장) |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3813 tests → 3812 PASS; 유일 실패 1건은 이 절 추가·정산 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 10/10 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 / live MCP 세션 / macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 이전 절과 동일 — 승인된 환경·자격 없음, 경계 시험까지만 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: post-listen 'error' 전수 스캔 검증 (2026-10-07)

DR34 후반에서 미뤄 둔 "listen 성공 후 `.off`로 유일한 'error' 리스너를 해제" 부류의 6곳 전수 정산과 동일 emit-탈출 잔여(rpc FrameParser·egress-bridge stderr·cloc 계정 own-key)의 로컬 검증. 결정론 오라클은 `server.emit("error", EMFILE)`의 동기 주입 — 리스너가 없으면 그 자리에서 throw이고, 있으면 영구 리스너가 journal만 하고 흡수한다.

| 절차 | 결과 | 근거 |
|---|---|---|
| post-listen 'error' 흡수 — 6곳 | PASS | `test/post-listen-error.test.ts` 9 오라클: `server.emit("error", EMFILE)` 직접 주입 뒤 ①영구 리스너 정확히 1개, ②journal 도달(console.error 캡처·audit `(listener)`/`fail`·`onError` 콜백), ③`server.listening` 유지, ④같은 소켓 이름이 여전히 연결을 받음. 죽은 journal 싱크(throwing audit·throwing onError)도 emit을 탈출하지 않음 |
| oma-society 저널 심 | PASS | `EgressForwarder.listen`의 새 `onError`가 `openPrincipalEgress`→`adoptPrincipalEgress`→`notice`로 연결; `egress degradation` 스모크가 adoption 경유 옵션 통과 확인. HostTenure 소유·hold/abandon 계약 불변 — 영구 리스너는 bound 유지라 close/lease 수명에 손대지 않음 |
| rpc FrameParser emit 경계 | PASS | NaN frameBytes 주입 시 생성자 throw이 'data' emit 탈출·uncaughtException 대신 읽기의 RangeError 거절이 되고 `escaped=[]` (platform-rpc.test.ts DR27 신설) |
| egress-bridge·inference-bridge 리스너 가드 | PASS | 실제 EADDRINUSE + `stderr.write`가 던지는 상태에서 두 bridge 모두 wedge 없이 degraded resolve, uncaughtException 0건; inference bridge는 guard 아래 fallback retry가 실제 바인드 포트의 provider URL을 등록 (extension-bridges.test.ts 신설) |
| vendored curator-server | PASS | `runtime/curator-server.js`에 OMA_DIVERGENCES splice로 영구 리스너 + 보호된 journal 적용 — `node scripts/vendor-pi-web-access.mjs --check` → BUNDLE_CURRENT(11,020 files); 설치된 표면은 workflow pin이 "none"이라 도달 불가, 미설치 평가 대비 defense in depth |
| cloc 계정 own-key | PASS | `Object.hasOwn` 기반 `rowAt`으로 `constructor`/`hasOwnProperty` 이름의 인벤토리 멤버가 prototype 상속 멤버로 오계정되지 않음을 inventory-evidence-split 신규 오라클로 고정; `temporary editor file` verdict 인정 추가, 관측 이상 verdict(file size·not-file·cannot read·unable to associate)는 여전히 게이트 실패 |
| startup reject 계약 유지 | PASS | bind 실패는 여전히 `once("error", reject/failed)`가 거절 — 영구 리스너는 대체가 아니라 병존(기존 startup-failure 테스트 전부 PASS로 간접 입증) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; LOC-004 재지문 drift 없음 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3829 tests, 3828 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification / 실제 fd 소진 주입 | NOT_RUN | 로컬 환경 부재 — 게스트·omahostd 단위의 in-situ 관측과 실제 EMFILE 유도(프로세스 fd 한도 소진)는 환경 의존이라 비결정론적이라 의도적으로 제외, 동기 emit 주입으로 같은 경계를 결정론적으로 커버 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: post-listen 'error' 잔여 — vendored listen 경계·emit 안 저널·emit 안 재등록 검증 (2026-10-07)

직전 전수 스캔(위 절)이 고친 부류의 맹검증 잔여 4건 정산. 같은 모델 — 동기 emit 안에서 던지면 emit을 탈출해 프로세스가 죽는다 — 을 vendored listen 경계, 공유 저널, 'listening' emit, request/upgrade emit에 적용했다.

| 절차 | 결과 | 근거 |
|---|---|---|
| vendored pi-mcp-adapter listen 경계 3곳 | PASS | `OMA_DIVERGENCES` splice만으로 정산(생성 runtime 직접 수정 없음): `runtime/ui-server.js` host server(후보별 once-listener 재무장+성공 시 해제)·sandbox proxy(동일 once+off)와 `runtime/mcp-callback-server.js`(once-listener가 성공 후에도 제거되지 않아 첫 post-listen 에러는 settled reject가 삼키고 둘째는 emit을 탈출하던 전이 결함) — 셋 다 영구 리스너 + 보호된 journal, callback은 named `onStartupError`를 listen 성공 시점에 정확히 해제해 "삼킴→무가드" 전이 제거. callback 서버는 허용된 auth:"oauth" 경로로 실도달(mcp-auth-flow → ensureCallbackServer). runtime·manifest는 스크립트 재생성물, `node scripts/vendor-pi-mcp-adapter.mjs --check` → BUNDLE_CURRENT(2,727 files) |
| vendored emit 주입 오라클 | PASS | `mcp-bundle.test.ts` 신규 2종: `Server.prototype.listen` 캡처로 클로저 내부 server에 도달 — 콜백 서버는 연속 2회 `emit("error", EMFILE)` 전부 journal 도달·`listenerCount("error")===1`(startup once 해제)·listening 유지·같은 포트 계속 connect·uncaughtException 0; ui-server는 host+proxy 각각 흡수 |
| broker cleanup 저널 | PASS | `cleanupError`의 `console.error`를 보호된 best-effort write로 — `listen`의 영구 리스너와 `listenActor`의 run-revoke 경로가 모두 동기 'error' emit 안에서 이 싱크에 도달하고, 죽은 stderr의 throw는 emit을 다시 탈출하던 것. `post-listen-error.test.ts` 신규 오라클: 던지는 console.error 아래 실제 `server.emit("error")` 흡수(listening 유지) + 공유 싱크 직접 호출 무탈출 |
| cloc 구조 키 충돌 | PASS | `rowAt`이 `header`/`SUM`/`nonCode` 구조 멤버를 파일 row로 읽지 않도록 `CLOC_REPORT_STRUCTURE_KEYS`로 배제 — 루트에 같은 이름의 파일이 있으면 구조 값이 그 파일의 row로 오독돼 phantom 계정되던 슬롯. 실제 행은 `./`-철자 키(구조 키·prototype 멤버와 충돌 불가) 또는 nonCode verdict만 계정. `inventory-evidence-split.test.mjs` 신규 오라클: 구조만 있는 세 이름 각각이 `cloc omitted or misclassified`로 실패 + `./`행·nonCode verdict는 정상 계정 — 실패 방향 고정 |
| inference-bridge 'listening' emit | PASS | 'listening'도 같은 동기 emit 경계 — emit 안 `registerProvider` 재등록을 가드. 거절은 pre-listen이 설치한 unreachable provider를 그대로 유지(안전한 degraded: relay는 unused로 listen하고 engine이 우회하지 않음), journal은 best-effort, unref·resolve는 도달. `extension-bridges.test.ts` 오라클: 실제 EADDRINUSE fallback + 재등록을 거절하는 registerProvider → wedge 없이 resolve·uncaughtException 0·등록은 unreachable만·저널 기록 |
| inference-relay request/upgrade emit 경계 | PASS | `forward`/`tunnel` 호출을 emit 경계 try/catch로 감쌈 — `admit`이 Refusal이 아닌 실패를 재던지면 unguarded는 `server.emit`을 통째로 탈출해 runner 사망이 되던 것을 그 연결 destroy+`failed` 계수로(정책 거절 refused와 구분, connect-proxy가 같은 부류에 두는 경계). `inference-relay.test.ts` 오라클: `server.emit("request"/"upgrade")` 직접 주입(읽을 수 없는 headers로 admit 안 비Refusal throw 유도) → 연결만 파괴·failed=2·refused=0·escaped=[]·listening 유지. 평가하고 범위 밖으로 둔 잔여: provider 쪽 `upstream` ClientRequest의 'upgrade'/'response'/'error' 리스너 — 본문의 socket write/end/writeHead는 이 Node(destroyed socket도 동기 throw 대신 비동기 'error')에서 emit을 탈출하는 동기 throw 경로가 없고, `accept()`의 `server.emit("connection")`는 http 내부 리스너 대상이라 같은 판정 |
| startup reject 계약 유지 | PASS | vendored 경계 모두 startup bind 실패는 여전히 once-listener가 reject — 영구 리스너는 대체가 아니라 병존이고 callback은 named listener 해제가 listen 성공에만 묶임(기존 startup-failure 테스트 PASS로 간접 입증) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,835 tests, 3,834 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification / 실제 fd 소진 주입 | NOT_RUN | 직전 절과 동일 — 로컬 환경 부재, 동기 emit 주입이 같은 경계의 결정론 오라클 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: 운영 읽기의 진단 예산 공유 결함 (UX-37, 2026-10-07)

`LedgerReader.all`이 행마다 `DIAGNOSTIC_READ_LIMITS`(10,000행/32MiB)를 과금해 운영 흐름(상태 표시·runner 대기열·principal relay·recovery)이 society의 행 수만으로 `LIMIT_EXCEEDED`로 거절되던 결함을 정산했다. 관리자 진단 스냅샷의 유한 상한은 유지한다 — 같은 상태에서 `readDiagnosticSnapshot`만 계속 `LIMIT_EXCEEDED`로 거절함을 대조군으로 고정.

| 절차 | 결과 | 근거 |
|---|---|---|
| 운영 카운트는 SQL 집계 | PASS | `LedgerReader.pendingDeliveryCount`는 `COUNT(*)`; `broker/composition.ts`의 dispatcher port가 이를 직접 바인딩해 `runner.pending`·principal relay가 목록을 물질화하지 않는다. 카운트는 읽기를 줄일 뿐 숨기지 않는다 — 실제 순회 경로는 여전히 행마다 디코딩·검증 |
| 대량 운영 열거는 keyset 스트림 | PASS | `pendingDeliveryRows`는 `MAX(rowid)`를 순회 시작에 동결하고 128행 닫힌 페이지를 `rowid > after`로 진행 — yield 사이에 열린 커서가 없고, 순회 중 새 수용은 이번 순회가 아닌 다음 순회에 귀속. `pendingDeliveries`는 이 스트림의 완전 수집 |
| 나머지 운영 열거는 예산 없는 완전 수집 | PASS | `agents`·`subscriptions`·`submissions`·`attestations`·`recoverableIds`·`operationDeliveries`·`pendingWorkRows`·`preparedBatches`·배치 링크드 목록이 더 이상 행/바이트 상한을 과금하지 않는다. 리니지·소유자·매니페스트↔멤버·수신자 스냅샷 등 행별 검증은 유지. 같은 컬렉션 안 반복 관측은 `ReadScope`로 동기 창 일관 보장 |
| 실패는 빈 답으로 승격하지 않음 | PASS | 어떤 운영 읽기도 query 실패를 `[]`로 변환하지 않는다 — `prepare` 실패는 그대로 throw. `G02-ledger-r2` ②: `prepare`가 throw하는 DB에서 `agentNames`·`recoverableIds`·`pendingDeliveries`·`pendingDeliveryCount`·`pendingWorkRows` 전부 throw |
| 10,000행 초과 완전성 회귀 | PASS | `operational-read-budget.test.ts` ①: shipped DDL+INSERT로 10,001 구독·10,300 운영(10,000 unbatched+300 준비 배치)·10,500 배달 시딩 → 카운트·수령인·rowid 순서·복구 id·`pendingWorkRows`·principal relay 목록·`runner.pending` 집계·배치 상세·링크드 전수 일치; 같은 상태에서 `readDiagnosticSnapshot`은 `LIMIT_EXCEEDED`(음성 대조). ③keyset: 순회 중 삽입분 제외·삭제분 미재방문·다음 순회 재관측 |
| fail→pass 대조 | PASS | 직전 커밋을 별도 worktree에서 tsc로 빌드해 동일 시드(10,001 구독·10,001 배달) 주입 → `allSubscriptions`·`pendingDeliveries`·`recoverableOperations`·`pendingWorkRows` 전부 `LIMIT_EXCEEDED` throw; 수정 후 동일 fixture는 완전 결과 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| 전체 `npm test` | PASS | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,834 tests, 3,834 PASS; systemd-required 9 파일은 환경 부재로 NOT_RUN 분리. 첫 실행의 3건은 정산됨 — P18 경계 스텁을 새 카운트 계약으로 갱신, R38 digest 재결박, SCN-L02는 병렬 부하 타이밍 flake(단독·재실행 모두 PASS) |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice(dependency-graph 재생성 후 PASS)·transactions·boundaries·documents·spec-inventory 0 findings |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 — 결정론 오라클(시드+keyset 시나리오+실패 주입)이 같은 경계를 묶는다 |

## 정산: UX-38 맹검증 잔여 — 변환의 정직성·소유권·도달성 6건 (2026-10-07)

직전 UX-38 커밋(크기·시간 상한의 거절 제거)을 맹검증했을 때, 변환 자체가 새 결함을 만든 6건(F1–F6)을 정산했다. 원칙: 유효한 사용자 작업을 막는 상한은 거절·절단하지 않되 변환은 정확성·정직성·소유권을 보존한다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F1 완전 결과는 모델의 tool이 읽는 경로에 | PASS | 완전 답은 result envelope로 pipe를 건너 부모가 직렬화 contained writer로 `<workspace>/.oma/search-results/`에 통째 기록 — quota 판정·직렬화·guard 승인이 다른 workspace 쓰기와 동일. 회귀: 스풀 경로가 `guardWorkspaceTools` 판정에서 read/grep/find/ls 전부 승인, 실제 `ls`·`find`·`read`·`grep` 호출이 도달, `workspaceUsage`가 바이트를 계정, `details.complete={path,bytes}`가 같은 경로를 명시 |
| F1 스풀이 못 받으면 절단 없이 inline | PASS | quota가 스풀을 담지 못할 때 완전 답 전문이 "could not be written to the workspace spool (…)" 사유와 함께 inline 회귀 — 프리뷰로 묵살하지 않음 |
| F2 heartbeat는 liveness이지 진행이 아님 | PASS | 침묵 창은 임의 바이트가, 진행 창은 비-heartbeat 프레임·비프레임 바이트만이 리셋. `{p:"s"}`만 나오는 자식은 `HEARTBEAT_ONLY_WINDOWS`(10)×stall 창 안에 그룹 kill+스냅샷 sweep — wedged main은 유한 경계 안에 회수 |
| F2 성긴 실진행은 경계를 넘어 생존 | PASS | 400ms 간격으로 match를 drip하는 완전-렌더 pass가 3s heartbeat-only 경계를 넘는 4s+ 동안 `{p:"r"}` 프레임으로 진행 리셋 — 답이 완전 도달 |
| F3 외부 kill의 선언 스냅샷 sweep | PASS | 부모가 살아 있는 채 자식만 외부 SIGKILL → `close` 핸들러가 선언된 `oma-search-*`를 무조건 제거 — 잔여 없음 |
| F5 목적지도 보유 디스크립터 체인 | PASS | 목적지 디렉터리를 rename하고 link를 심는 중간 교체 경주에서, 보유 fd가 옮겨진 실 디렉터리에 계속 쓰고 심은 link 너머로는 한 바이트도 도달하지 않음 |
| F4/F6 소유권·정직성 문서 | PASS | 검색 스풀은 workspace 소유자의 보통 파일(OMA 자동 sweep 없음), client 출력 스풀은 caller 소유(caller가 제거할 때까지 보존 — OMA에 GC 없음); `output-spool.ts` 헤더가 정책과 동기 write/fsync의 의도를 명시, heartbeat worker에 명시적 `error` 리스너 |
| fail→pass 대조 | PASS | 컴파일 산출물을 구 동작으로 되돌려 대조 — /tmp 스풀은 "workspace 안이 아님"으로, heartbeat=진행 리셋은 30s 타임아웃으로, close-sweep 제거는 `oma-search-*` 잔여로, 경로 기반 목적지 쓰기는 1,991 파일의 link 넘김으로 실패; 수정 산출물은 전부 PASS |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules(0 findings — `contained-files.ts`의 owned-state 면제가 F5로 stale되어 제거, 규칙이 다시 파일을 지킴)·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| 집중 회귀 | PASS | `node --test dist/test/contained-tools.test.js` 31/31 PASS — 신규 6종(스풀 도달성+quota·quota 거절 inline·heartbeat-only 회수·성긴 진행 생존·외부 SIGKILL sweep·목적지 경주) + 갱신 2종(1.5s heartbeat 자식 생존 코멘트·stall 인자) 포함 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,851 tests, 3,850 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 단독 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 맹검증 2라운드 잔여 — 선언-전-생성·디스크립터 고갈 정직성 2건 (2026-10-07)

직전 UX-38 정산을 다시 맹검증했을 때 남은 결함 2건(F-1·F-2)을 정산했다. F-1은 실제 suite flake(부하 상태에서 `oma-search-*` 잔여)로 관측된 순서 결함이고, F-2는 사유 평탄화 결함이다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F-1 선언-전-생성 "존재 ⇒ 선언됨" | PASS | `withSearchSnapshot`이 `oma-search-<uuid>` 후보를 생성해 `named?.(baseName)`를 `mkdirSync` 전에 호출하고 EEXIST는 새 이름을 다시 선언. 자식 측 `named`는 `writeSync(1, …)`로 프레임 바이트를 파이프에 박는다 — mkdir 시점에 선언이 이미 pipe 안. 선언 실패는 throw로 생성 전 실패 폐쇄. 부모 `close` sweep은 선언된 이름을 그대로 소비 |
| F-1 fail→pass 대조 | PASS | 컴파일 산출물의 `named` 호출을 mkdirSync 뒤로 되돌린 구 동작에서 최초-관측-시점 kill 테스트가 `oma-search-*` 잔여로 3/3 실패; 수정 산출물은 잔여 없음 |
| F-2 EMFILE/ENFILE 명시 거절 | PASS | `withSearchSnapshot` 본문을 `searchSnapshot`으로 내리고 공개 경계에서 module-scope `descriptorRefusal`이 EMFILE/ENFILE → `WorkspaceRefusal("search snapshot ran out of file descriptors")`로 변환 — `readdirSync`·소스 `openSync`·`openDirectoryWithin`·목적지 open 전수 포괄, 다른 에러 의미 불변 |
| F-2 fd 고갈 거절 문구 | PASS | `ulimit -n 96` + 400단계 트리에서 자식이 완료하고 출력이 "file descriptors"를 명시 — 구 산출물에서는 raw EMFILE이 "contained search failed"로 평탄화되어 실패 대조 |
| wire 선언이 fs 효과에 선행 | PASS | 실제 `searchChildBody`를 파이프 위에서 구동해 관측된 스냅샷 디렉터리가 최대 한 번의 drain 안에 `{p:"d"}`로 선언됐음을 검증 — 선언 바이트는 mkdir 전에 파이프에 들어가므로 "존재하는 디렉터리가 영원히 미선언"은 없다(기술 수정: 관측과 선언 사이에 한 번의 폴링-drain 유예를 두는 것이 오라클의 실제 계약이며, 이전 표기 "매 관측 시점에 이미 선언"은 그 유예를 넘어선 주장이었다) |
| EEXIST 재선언 | PASS | 첫 선언명을 호스트가 선점시켜 헬퍼가 두 번째 새 이름으로 착지 — 두 이름 모두 선언됐고 실제 생성된 것은 둘째 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules(0 findings — `state-tree-rules`의 contained-files 면제 문구를 "생성 전에 이름이 선언되는 `oma-search-*` 디렉터리"로 갱신)·lattice·transactions·boundaries·documents·spec-inventory 0 findings; `node:crypto` import로 stale된 `implementation/evidence/dependency-graph.json`은 `npm run evidence:graph`로 재생성 |
| 집중 회귀 | PASS | `node --test dist/test/contained-tools.test.js` 36/36 PASS — 신규 5종(선언-전-생성 계약·EEXIST 재선언·최초관측 SIGKILL sweep·wire 선언-선행·fd 고갈 거절 문구) + 기존 외부 SIGKILL close-sweep 유지 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,856 tests 전부 PASS; 이 절의 최초 실행에서 보인 2건은 정산됨 — fd-고갈 테스트의 `bash -c ulimit` 래퍼가 local lane의 shell 금지(local-test-guard)에 걸려 `prlimit --nofile=96:96` direct argv로 교체(liveness-observation의 기존 패턴과 동일, 단독 재실행 PASS), 다른 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로 이 트리의 digest로 재결박. systemd-required 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 잔여 — bundled pi-lsp 표면의 숫자 상한·고정 마감 변환 (2026-10-07)

같은 결함류(유효한 처리를 크기/시간만으로 거절·묵살하는 숫자 bound)가 code_intel LSP 표면에 남아 있어 정산했다. 원칙은 UX-38 본편과 같다 — bound를 제거하거나 비차단으로 바꾸고, 엔진 보호상 남는 bound는 정직하게 보이며 한 서버의 초과가 프로세스나 다른 요청을 죽이지 않는다.

| 절차 | 결과 | 근거 |
|---|---|---|
| 어댑터 bound 제거 | PASS | `lsp-tools.ts`: `LSP_FILE_BYTES`(1MiB)·`LSP_MAX_FILES`(100)·`LSP_MAX_PATHS`(64)·`LSP_MAX_SERVERS`(64) 거절 상수 삭제 — `liveFiles`는 비regular/소실 파일만 걸러 크기는 didOpen이 그대로 운반, caller `limit`는 그대로 존중하고 미지정이면 수집 전체가 답(`details.summary.files`에 수 명시), status는 configured catalog 전수 보고 |
| timeout 상한 제거 | PASS | `clampTimeout`이 1s floor만 적용 — 120s 상한 제거. caller 선택 <120s의 정확한 효력과 floor는 회귀로 묶음; >120s 관측은 시간상 NOT_RUN(코드에서 입증) |
| aggregate deadline → 진행-리셋 stall | PASS | 호출당 `LSP_CALL_STALL_MS` 창이 vendored client의 `omaOnInboundFrame` 싱크가 이 호출 소유 hardened adapter를 보고할 때만 리셋 — `slow-stages` fixture(요청당 ~600ms × initialize+didOpen+diagnostics ≈1.9s)가 1200ms 창을 넘어 완료; 침묵 서버는 ~1s 안에 회수. 창은 호출의 per-request timeout보다 좁아지지 않음 — stall은 비-요청 침묵의 backstop이라는 설계 사실을 테스트 명칭·주석에 명시 |
| oversized inbound frame | PASS | 헤더 파싱 시점에 그 프레임이 답하는 요청만 거절(sniffed id가 실제 pending과 매치될 때만 — F-3에서 유일-pending fallback 제거, 미식별 프레임은 drop+카운트만), 본문은 `#discardRemaining` bounded discard로 버린 뒤 wire가 프레임 끝에서 재정렬 — `oversized-then-serve`에서 같은 client의 후속 요청이 정상 응답, 서버 생존. 미완성 본문도 빠른 종료. 프레임 경계 없는 garbage 누적은 버퍼 비움+pending 거절, 미식별 프레임은 drop 카운터가 에러 꼬리 `oma bounds:`로 명시. discard 중 shutdown은 handshake 생략하고 close |
| 진단 절단 정직성 | PASS | `omaFlaggedDiagnostics`가 push store·pull 경로 공용 — 첫 bound까지 유지+`[oma: N more diagnostic(s)…]` marker(`code:"oma/truncation"`), 메시지는 원본 길이 명시 절단. 재flag 멱등(꼬리 marker 재카운트 안 함·`OMA_MESSAGE_TRUNCATION_TAIL`이 재절단 방지) — push 홍수가 pull 소비에서 drop 수를 거짓 보고하지 않고, OMA marker는 codeAction context에서 서버로 가지 않음. tracked-URI 초과는 publication drop+count가 해소 리스트 marker로 명시 |
| code-action·workspace-edit | PASS | action 목록의 256 상한 제거 — 300개 fixture 전수 resolve(각 요청은 per-request timeout과 stall 창이 묶음). workspace-edit 누적 count/bytes 거절은 유지 — 절단 edit은 오염 fix·무제한 materialization은 엔진 OOM이라 둘 다 거절보다 나쁘며, 거절은 그 요청만 |
| 파일 수집 | PASS | `collectPath` 재귀+깊이 bound → 명시 스택(역순 push로 재귀의 depth-first 순서 보존) — 깊은 트리 통째 수집·overflow 없음 |
| B2 rider | PASS | `contained-files.ts` `errnoCode` 가드(비객체 throw의 `.code` 읽기 TypeError 경로 차단)+공개 `isDescriptorOverrun`; `contained-search.ts`가 스냅샷 경계·엔진 walker 양쪽의 EMFILE/ENFILE을 같은 "search snapshot ran out of file descriptors"로 매핑; EEXIST 테스트의 cleanup 등록을 await보다 전으로; 선언명 선점-EEXIST-자식 사망 모서리는 헤더 주석으로 기록 |
| vendor bundle | PASS | `node scripts/vendor-pi-lsp.mjs` → `BUNDLE_CURRENT`; upstream/ byte-exact 유지, divergence anchor 전부 exact-once, manifest `generated.divergences` 동기, 번들 sha256 `82a5999ac583aca062cbaca28af04e7b2340d83a83cf8aac6940e1c715d942fa` |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules(0 findings)·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| review ledger | PASS | 변경된 7개 production 파일의 byte-bound 리뷰 클레임을 재판독 후 새 바이트에 재결박(묵은 갱신 아닌 fresh read 동반, notes `about`에 명시), `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14062·NOT_REVIEWED 61·READ_UNCHANGED 51·REMOVED 8, `review-closure` findings 없음 |
| 집중 회귀 | PASS | `node --test dist/test/lsp-bundle.test.js dist/test/lsp-upstream.test.js` 61/61 PASS — fail→pass 신규: oversized-then-serve·미완성 oversized·push/pull 진단 홍수+초대형 메시지 marker 절단·URI drop marker·300 code-action·slow-stages 진행 리셋·침묵 회수·1.2MiB 파일·80 paths·121 파일 무제한 수집·71 server status·marker 비재전송·이중flag 방지; `dist/test/contained-tools.test.js` 36/36 PASS |
| 전체 `npm test` | PASS | `OMA_TEST_CONCURRENCY=1 npm test` 로컬 lane — build + 397 files serial 실행: serial phase 9/9 PASS, parallel phase 3,864/3,864 PASS·0 fail·0 cancelled·0 skipped(duration 1,639,995ms), runner unrun-check 통과. 직전 실행은 이 절·산출물 변경분이 반영되지 않은 stale digest로 R38 1건만 실패했고, 이 트리의 digest로 재결박 뒤의 이 실행은 R38 포함 전부 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

정직 기록: 이 절의 wire-선언-선행 행은 직전 절의 표기를 수정했다 — 오라클의 실제 계약은 "관측된 디렉터리가 최대 한 번의 drain 안에 선언됨"이며 "매 관측 시점에 이미 선언"은 그 유예를 넘어선 주장이었다.

## 정산: UX-38 잔여 2차 — pi-lsp 런타임의 비차단·정직성 정산 F-4·F-5·F-1·F-2·F-3·F-6 (2026-10-07)

직전 pi-lsp 정산의 맹검증 잔여 — bound가 남아 있되 그 행위가 무성하거나 잘못 귀속된 6건을 정산했다. 전부 `scripts/vendor-pi-lsp.mjs`의 `OMA_DIVERGENCES` 스플라이스로만 `runtime/`을 재생성했고 upstream/ byte-pin은 유지된다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F-4 didOpen backpressure | PASS | `didOpen`→`notify`→`#send`가 `stdin.write()` 반환을 전파하고 runner open 루프가 `false`면 `didDrain()` await — 코퍼스가 서버 읽기보다 빠를 때 자식쪽 메모리에 통째로 쌓이지 않음. `didDrain()`은 drain resolve·stdin error/close reject·`#timeoutMs` 타임아웃·리스너/타이머 settle-정리. `lsp-upstream` 443·469·484·499행 4종: backpressured write 보고+drain settle·slow reader(`slow-drain`) 완주·`stdin-stall` bounded 실패·mid-drain abort가 abort로 보고 |
| F-5 per-file settled | PASS | `runDiagnostics` 팬아웃 `Promise.all`→`Promise.allSettled` — 개별 실패는 그 파일의 `oma/error` marker("diagnostics failed for this file: …")로 강등, 답한 파일은 보존, 전체 거절은 caller abort뿐. 어댑터도 route별 실패를 그 route 절의 명명된 오류로 강등+`details.summary.failedRoutes` 명시, 전 route 실패 시에만 거절 유지. `partial-answers` fixture+lsp-upstream 511·lsp-bundle 834·853·882행 4종 |
| F-1 marker 회계 | PASS | `omaFlaggedDiagnostics`가 꼬리의 모든 `oma/` marker를 벗겨 실진단 수를 셈 — [truncation, URI-drop] 이중 marker 리스트 재flag 시 첫 marker를 실진단으로 새고 진짜 marker를 자르던 버그 제거, 갱신 절단은 기존 marker를 꼬리에 보존. `push-flood-uri-flood` fixture+lsp-upstream 566행 |
| F-2 URI-drop 가시성 | PASS | `#withDroppedUriFlag`를 pull diagnostics early return에도 적용, publish waiter timeout 에러가 `#formatDropped` 꼬리로 drop 수 명시. `pull-uri-flood`·`uri-flood-timeout` fixture+lsp-upstream 587·602행 |
| F-3 oversized 귀속 | PASS | id 스니핑 실패 시 유일 pending에 귀속하던 fallback 제거 — sniffed id가 실제 pending과 매치될 때만 그 요청 거절, 불일치는 drop+카운트(타임아웃 에러 꼬리에 보고). `oversized-notification` fixture+lsp-upstream 537행 |
| F-6 문서 정직성 | PASS | 직전 절이 주장하던 "OMA marker는 codeAction context에서 서버로 가지 않음" 회귀를 실제 테스트로 추가 — `marker-context` fixture가 context 진단 수를 codeAction resolve 편집으로 되돌려 marker 필터링을 증명(lsp-upstream 616행). 이중 marker 재flag도 위 F-1 오라클로 커버 |
| vendor bundle | PASS | `node scripts/vendor-pi-lsp.mjs --check` → `BUNDLE_CURRENT` (48 files), manifest `generated.divergences` 동기, 번들 sha256 `59a572cb4c0226c3e073bb9d9ee3254977cf3ec78c1adf809103c2263fe4227a` |
| 집중 회귀 | PASS | `node --test dist/test/lsp-upstream.test.js` 30/30·`dist/test/lsp-bundle.test.js` 전종 PASS — 신규 오라클 17종 중 14종은 구 런타임/구 어댑터에서 실패 확인 후 통과; 나머지 3종(marker-context 등)은 구 동작이 없어 대조 불가한 회귀 가드 |
| 전체 `npm test` | PASS | `OMA_TEST_CONCURRENCY=1 npm test` 로컬 lane — build + 397 files serial 실행: serial 2/2·parallel 3,881/3,881 PASS·0 fail·0 cancelled·0 skipped(duration 1,599,229ms); R38 digest 결박 테스트 포함 전종. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| review ledger | PASS | 변경 5개 production 파일(lsp-tools.ts·runtime/lsp-client.js·lsp-client.d.ts·runner.js·manifest.json)의 byte-bound 리뷰를 fresh read 후 새 SHA-256에 재결박, `npm run review:ledger` — CHANGED_WITH_ORACLE 14062·NOT_REVIEWED 61·READ_UNCHANGED 51·REMOVED 8 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 잔여 bound 전수 조사 + 남은 자의적 거절 제거 (2026-10-12)

배치 1–5가 변환한 뒤 남은 숫자 bound를 전수 조사·분류하고, 스윕에서 발견한 잔여 사용자-facing 자의적 거절을 제거했다. 결과 장부는 [limit-bounds.md](../limit-bounds.md) — §1 PROTOCOL/WIRE-MANDATED 29·§2 FORMAT-MANDATED 13·§3 SECURITY/INTEGRITY 11·§4 RESOURCE-PROTECTION(의도적 유지) 26·§5 QUIESCENT/JITTER 25·§6 TEST-ONLY 1, 총 105행. §4는 방어적이지만 자의적인 값을 정직하게 그렇게 분류하고, §7은 수치 기반 사용자-facing 거절 26종을 하나씩 판정한다 — wire 계약·포맷·무결성·의도적 자원 보호가 필요한 것만 남았고, 그 외의 용량/시간 거절은 남지 않았다.

| 절차 | 결과 | 근거 |
|---|---|---|
| merge-diff 뷰 bound 정렬 | PASS | `src/cli/effects/code.ts` — production merge-diff의 캡처 bound를 고정 768 KiB에서 `bundleBytes()+1`로 교체. 이전 값은 wire가 선언한 완료-notice 문서 bound(기본 256 MiB)보다 좁은 자의적 거절이었고 `commands/merge.ts`의 오류 문구(`cliBundleBytes()` 명명)와 불일치했다. `+1`은 "정확히 수용"과 "1바이트 초과"를 구별한다. revision 해석(ref/published/ancestry 관측)의 출력 bound도 고유 768 KiB에서 `CANONICAL_PROCESS_LIMITS.maxBuffer`(4 MiB)로 정렬 — broker의 canonical observer와 같은 명령 같은 bound. 고정 MAXIMUM(768 KiB)은 production이 도달하지 않는 show/diff/log/ls-tree/grep 뷰만 묶는 TEST-ONLY bound로 주석과 함께 남았다 |
| workspaceDirty 불리언 관측 | PASS | `src/cli/effects.ts` — `git status --porcelain`을 더는 텍스트 maxBuffer로 읽지 않고 직접 관측한다: 캡처된 stdout이 1바이트라도 있으면 dirty(절단된 목록도 증거), 성공적으로 빈 목록만 clean. 이전에는 256 KiB를 넘는 정직한 dirty 워크스페이스가 `merge open`에서 LIMIT_EXCEEDED로 죽을 수 있었다. timed-out/stalled/spawn-failed는 `requireTextExit`가 계속 던진다 — 실패를 clean으로 읽지 않는다 |
| ReadScope 주석 교정 | PASS | `src/storage/ledger-reader.ts` — "fresh read/snapshot" 인상을 주던 주석을 정확한 기술로 교체: memoized 항목은 그 컬렉션 안에서 키로 처음 읽은 row bytes의 디코딩이며 DB 스냅샷이 아니고, 컬렉션 도중 다른 writer가 바꾼 row는 재관측되지 않는다(새 바이트가 필요하면 새 scope). 동작 변경 없음 |
| 문서 정밀 수정 | PASS | LSP 오라클 서술을 "17 fail-before"에서 "14 fail-before + 3 회귀 가드(구 동작 부재로 대조 불가)"로 이 파일과 WORKSTREAM 양쪽 정정; WORKSTREAM의 B1 fixture 문구를 102 `.test.mjs` + 보조 2종(`isolate-env.mjs` 프리로드·`pdf-fixture.mjs` 헬퍼, fixture는 후자 하나)으로 정밀화 |
| 잔여 거절 판정 | PASS | limit-bounds §7의 26종 전부가 wire/format/integrity/의도적 자원 보호/jitter 중 하나로 귀결 — 스윕에서 변환 가능한데 남은 거절은 셋이었고 전부 제거(merge-diff 뷰 bound·workspaceDirty porcelain 캡·code view published-ref 캡 비대칭). 대표 잔여: merge-diff>bundleBytes(PROTOCOL), 로컬 파일>1요청 프레임(PROTOCOL, 대체 채널 없음), LSP workspace-edit 2048/4 MiB(INTEGRITY — 절단 fix=오염), human prompt 16 KiB+frame(PROTOCOL+RESOURCE), 설정/패키지 문서 bound(RESOURCE, 방어적·자의적으로 명시), 진단 스냅샷(RESOURCE, 운영 읽기와 무관) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules 0·lattice(dependency-graph evidence 재생성)·transactions·boundaries·documents·spec-inventory 전부 0 findings |
| review ledger | PASS | `src/cli/effects.ts`·`src/cli/effects/code.ts` 신규 byte-bound 리뷰 + `src/storage/ledger-reader.ts` 재결박(모두 fresh re-read 후 새 sha256), `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14065·NOT_REVIEWED 59·READ_UNCHANGED 50·REMOVED 8 |
| 집중 회귀 | PASS | `node --test dist/test/principal-code-view.test.js dist/test/merge-cli.test.js dist/test/operational-read-budget.test.js` 16/16 · `dist/test/effect-observation.test.js dist/test/git-effect-evidence.test.js dist/test/merge-review.test.js` 38/38 · `dist/test/scenario-merge-review.test.js` 9/9 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 399 files → 3,900 tests, 3,898 PASS; 실패 2건의 정직한 내역: (a) SCN-L02는 8-way 병렬 aggregate에서만 재현되는 기존 타이밍 flake로 해당 파일 단독 재실행 40/40 PASS(이전 절들에도 같은 양상이 기록됨); (b) R38은 이 절과 신규 문서(limit-bounds.md)가 반영되기 전의 stale verification-input digest로, 이 트리의 digest로 재결박 후 `production-inventory` 재실행 확인. 한 차례 이전 실행은 정산 중 dist 재생성이 suite와 경주한 환경 간섭으로 wedge됐고(SCN-C09/C10·R04–R07·S01·society-bringup), 관련 파일 4종 단독 재실행 96/96 PASS 후의 실행이 위 결과다. systemd-required 9 파일은 test-local이 `OMA_TEST_SYSTEMD=0` 고정으로 설계상 분리 — "환경 부재"는 stale한 오기였고, 실제 lane 실행 결과는 다음 절에 기록한다 |
| systemd-required 9 파일 (verify-lane kernel·crash) | EXECUTED+PASS | 다음 절의 실기록 — `verify-lane.mjs kernel` 12파일 65/65·`crash` 2파일 63/63, 이 호스트의 실제 user systemd에서 전종 초록 |
| macOS native / powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 bound survey 맹검증 잔여 — workspaceDirty 거절 관측 정직성 + systemd lane 실기록 (2026-10-12)

위 절의 맹검증 잔여 2건을 정산했다. F-1: 위 절은 systemd-required lane을 "환경 부재"로 NOT_RUN 표기했으나 이 호스트에는 user systemd 257.13·bwrap 0.12.0·cgroup v2·user bus가 있고 lane은 실제로 실행된다 — stale한 표기를 실측으로 교체했다. F-2: `workspaceDirty()`가 `git status`의 exited-nonzero + 빈 stdout을 clean으로 읽던 잔여를 고쳤다 — 거절된 관측이 absent로 축소되는 결함류 그 자체이며, 구 코드도 같은 의미였으므로 회귀가 아니라 잔존 결함의 정산이다.

| 절차 | 결과 | 근거 |
|---|---|---|
| F-2 workspaceDirty 거절 관측 | PASS | `src/cli/effects.ts` — 비영 종료는 git이 답을 거절한 것이지 빈 목록이 아니다. stderr의 `not a git repository`/`this operation must be run in a work tree`만 유일한 사실상 부정(관측할 워크스페이스 자체가 없음)으로 남기고, 그 외 거절 — 깨진 index, git이 거절하는 ownership 등 — 은 `StoreError(INTERNAL_ERROR)`로 전파한다. `effects/submit.ts`·`effects/code.ts`·`journalView` 등 주변 관측 경계의 refuse-on-nonzero 관례와 일치하고, 명시 full-OID `merge open`/`challenge open`의 비저장소 cwd 호출(`resolveOid`의 full-OID 단축이 만들어 둔 정상 경로)은 보존된다. timed-out·stalled·output-limited·spawn-failed는 종전대로 `requireTextExit`가 던진다 |
| F-2 fail→pass | PASS | `test/merge-cli.test.ts` 신규 2종 — 손상된 `.git/index`로 거절을 재현한 `merge open`이 exit 3 + `oma: INTERNAL_ERROR: git status: fatal:`로 명시 실패하며 요청을 보내지 않는다(구 dist로 재실행하면 무경고 진행·실패를 확인); 비저장소 cwd의 명시-OID open은 경고 없이 완료되는 회귀 가드. 파일 12/12 PASS |
| F-1 systemd lane 실기록 | PASS | `OMA_TEST_SYSTEMD=1 node scripts/verify-lane.mjs kernel` → EXECUTED+PASS 65/65(12 파일 — systemd-required 8종 + peer-pid·native-leaf·runner-channel·compliance), `crash` → EXECUTED+PASS 63/63(crash-boundaries·global-invariants) — systemd-required 9파일 전종이 실제 user systemd에서 초록. artifacts=/tmp/oma-lane-kernel·/tmp/oma-lane-crash |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice(dependency-graph evidence 재생성)·transactions·boundaries·documents·spec-inventory 전부 0 findings |
| review ledger | PASS | `src/cli/effects.ts` 항목을 fresh re-read 후 새 sha256으로 재결박, `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14065·NOT_REVIEWED 59·READ_UNCHANGED 50·REMOVED 8 |
| 집중 회귀 | PASS | `node --test dist/test/merge-cli.test.js dist/test/effect-observation.test.js dist/test/git-effect-evidence.test.js dist/test/merge-review.test.js dist/test/scenario-merge-review.test.js dist/test/principal-code-view.test.js dist/test/operational-read-budget.test.js dist/test/client.test.js` 88/88 |
| 전체 `npm test` | PASS | `node scripts/test-local.mjs` 로컬 lane 399 files → 3,902 tests, 3,902 PASS·0 fail·0 cancelled·0 skipped(duration 284,386ms). 이 절 작성 중의 첫 실행은 변경분이 반영되기 전의 stale digest로 R38 1건만 실패했고, 재결박 뒤의 위 실행은 R38 포함 전종 PASS — 단독 재실행 `production-inventory`·`document-integrity`·`traceability-policy` 23/23 확인. systemd-required 9 파일은 test-local이 설계상 분리하며 실제 실행은 위 kernel·crash lane 기록 |
| macOS native / powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |

## 정산: UX-38 잔여 정산 후속 — workspaceDirty not-a-repo 사실상 부정의 상호확인 (2026-10-12)

직전 정산의 맹검증 LOW 잔여 1건을 정산했다. `workspaceDirty()`는 `git status`의 `not a git repository`/`must be run in a work tree` 거절 문자열을 그대로 사실상 부정으로 믿었다 — 그런데 git은 진짜 부재뿐 아니라 존재하나 손상된 `.git`(깨진 HEAD, chmod 000, 삭제된 objects, 끊어진 심링크, 허공을 가리키는 gitdir 포인터, 마운트 경계 너머의 `.git`)에도 같은 문자열로 128을 낸다. 문자열이 아니라 관측 부재를 상호확인하도록 고쳤다.

| 절차 | 결과 | 근거 |
|---|---|---|
| not-a-repo 상호확인 | PASS | `src/cli/effects.ts` — `workspaceClaimPresent`가 관측 디렉터리와 그 조상을 `.git` 엔트리로 걷는다: 디렉터리·gitdir 포인터 파일·끊어진 심링크 전부 워크스페이스 주장이고, lstat이 못 읽는 단계(EACCES 등)도 주장을 배제할 수 없어 실패-폐쇄한다. ENOENT/ENOTDIR만으로 끝까지 걸었을 때만 부재가 확정돼 false. `.git`이 있으면 거절은 존재하는 워크스페이스에 대한 것이므로 `StoreError(INTERNAL_ERROR)` + git stderr로 전파 — corrupt index 등 기존 전파 경로와 같은 판정 |
| 대면 검증 (컴파일된 모듈 직접 호출) | PASS | 9종 — 깨진 `.git/HEAD`·댕글링 `.git` 심링크·`.git` 파일 gitdir 포인터·실제 repo의 `.git` 내부 cwd·`core.bare=true` 오설정 → 전부 INTERNAL_ERROR 전파; bare repo cwd·진짜 비저장소 → false; clean repo false·dirty repo true 유지 |
| bare repo 판정 | PASS | `.git` 부재 + work-tree 거절은 git이 저장소를 읽고 bare임을 확인한 완전한 관측 — bare repo에는 uncommitted work가 있을 곳이 없어 vacuous 부정(false). `.git` 존재 시 같은 거절은 미관측 작업을 숨길 수 있어 전파한다. "거절이면 무조건 전파" 대안보다, 거절이 관측 디렉터리의 미커밋 작업을 숨기는지를 기준으로 선택 |
| fail→pass | PASS | `test/merge-cli.test.ts` 신규 2종 — 손상 `.git/HEAD`로 not-a-repo를 재현한 명시-OID `merge open`: HEAD dist에서는 거절이 clean으로 읽혀 transport까지 진행해 exit 3 불일치로 실패, 수정 dist에서는 exit 3 + `git status: fatal: not a git repository` + 요청 0건으로 명시 실패. bare repo cwd 명시-OID open은 경고 없이 완료 — vacuous 부정 결정 고정. 기존 비저장소 명시-OID 가드(KN)도 유지 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice(dependency-graph evidence 재생성)·transactions·boundaries·documents·spec-inventory 전부 0 findings |
| review ledger | PASS | `src/cli/effects.ts` 항목을 fresh re-read 후 새 sha256으로 재결박, `npm run review:ledger` 재생성 — CHANGED_WITH_ORACLE 14065·NOT_REVIEWED 59·READ_UNCHANGED 50·REMOVED 8 |
| 집중 회귀 | PASS | `node --test dist/test/merge-cli.test.js` 14/14 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 399 files → 3,904 tests, 3,903 PASS·0 cancelled·0 skipped(duration 284,892ms). 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 단독 재실행 PASS 확인. systemd-required 9 파일은 test-local이 `OMA_TEST_SYSTEMD=0`으로 설계상 분리 |
| macOS native / powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 |


## DR35: 시작 시간 실행 측정과 수정 (2026-10-08)

사용자가 문서와 실제 실행 측정을 먼저 요구했다. 서브에이전트 없이 기준 HEAD
`0364e99c`의 clean worktree에서 시작했고, 현재 변경은 미커밋이다. 이 절은 시작 경로와
같은 부류의 코드 병목을 수정한 범위의 증거이며 기존 전수 감사나 release의 완료를 뜻하지 않는다.

| 관측 | 실제 결과 | 범위 |
|---|---|---|
| 수정 전 실제 Society 시작 | 최초 출력/실패 146.673초; CPU profiler의 spawnSync 구간 누적 136.459초(호출 벽시계; child CPU 사용량 아님) | raw PTY `/tmp/oma-startup-nhj_86s8`; source snapshot 중 directory 변경을 감지해 exit 3. 정상 시작 성공으로 세지 않음 |
| 동기 Git 원인 확인 | 15,519 선택 파일; trace 중 8,688개의 `hash-object` child | `/tmp/oma-startup-xtxy7bj1`, strace 자체가 시간을 늘리므로 200초 trace 값을 일반 시작 수치로 쓰지 않음 |
| batch Git 적용 뒤 정상 시작 | 대화창 36.49초 | `/tmp/oma-startup-2tmyjkt3`, 원본 보존·authority gate 유지 |
| 대화 실제 입력→모델 요청 | Society 3.131/3.146/3.130초; Personal 1.490/1.481/1.434초 | 독립 HOME/data 3회씩, 실제 OMA+Pi+OpenTUI+PTY, 모델만 로컬 scripted provider. setup 시간은 launch 전에 끝내며 child spawn부터 Node monotonic clock으로 측정 |
| 화면 입력 준비 | Society 2.879~2.893초; Personal 1.213~1.235초 | 같은 3회 측정, 렌더링만으로 모델 입력 준비를 추정하지 않고 이어서 실제 모델 요청을 확인 |
| 첫 모델 응답 | Society 3.153~3.171초; Personal 1.495~1.532초 | 모델 서버 응답은 시험용이므로 실제 유료 provider 속도를 증명하지 않음 |
| 준비 중 종료 | 0.11~0.15초, 모든 회차 exit 0 | Ctrl-D → 실제 host exit, preparation 취소와 자식 회수 포함 |
| Society 전체 준비 | admin socket 연결 30.121초, 이후 종료 0.727초 | `/tmp/oma-startup-benchmark-rq0iokw1`; 단순 UI marker가 아닌 실제 broker endpoint 관측. 첫 모델 요청 3.139초와 구별 |
| 실제 준비 완료 뒤 권한 연결 | PASS, 첫 모델 요청 3.171초 → admin socket 30.010초 → Principal 도구 30.835초 | `/tmp/oma-startup-benchmark-wq3mkkpe`. 실제 모델→`oma_society`→client→broker 흐름으로 시험 Society를 닫음. 종료 뒤 read-only SQLite에서 같은 actor/request key의 `society.set`이 정확히 1행·succeeded인 것을 확인. 준비 중 private engine이 준비 완료 뒤 실제 grant를 받아 쓰는 경로를 UI 문구로 추정하지 않음 |
| 추가 Git 압축 실험 | 기존 fetch 6.455초, pack window/depth/compression 0은 6.406초, bytes 동일 | 복제된 측정용 bare repository만 사용. 유의한 개선이 없어 생산 코드에 적용하지 않음 |
| 공통 runtime import | 0.718초 → 0.029초 | interactive setter의 SDK 의존을 엔진 presentation owner로 옮김. 호스트 import 금지 회귀와 기존 설정 의미론 유지 |
| build / typecheck / package / architecture | PASS | 최종 빌드·타입 검사, package closure, inventory/rules/lattice/transactions/boundaries/documents/spec inventory |
| SDK 분리·설정·엔진 소유권 집중 회귀 | PASS 130/130 | 원래 Pi manager·locked writer, 경계 손상/권한/byte 보존, Linux/Darwin platform-injected 설정, host SDK import 금지. Native Darwin PASS로 확대하지 않음 |
| 시작·취소·history·scratch 집중 회귀 | PASS 7/7 | 실제 inherited lease + native descendant cancellation, raw project 준비, 원래 Pi installer 보존, Personal history inode lifetime, 병렬 scratch 격리 |
| 전체 local suite | PASS 3,919/3,919 (serial 9 + parallel 3,910), fail/cancel/skip 0 | 첫 실행은 9+3,909 tests, 병렬 23 실패. 16건은 이 shell의 `oma` PATH 부재, 2건은 새 preload를 빼먹은 fake install, 1건은 다른 test의 `/tmp` scratch를 비교한 race, 나머지는 architecture/ledger/validation 산출물 미결박. 원인별 수정 후 전체 PASS, SDK 분리 뒤 전체 재실행도 PASS. 최종 parallel 240,892ms + serial 78,574ms; 로그 `/tmp/oma-final-full-suite.log`. systemd-required 9 파일은 test-local 설계상 NOT_RUN 분리 |
| native macOS / real provider / powercut / release qualification | NOT_RUN | Linux 시작·로컬 시험 모델 증거를 해당 레인의 PASS로 확대하지 않음 |

**대화 시작의 5초 한도는 충족했고 1초 목표는 미달이다. Society authority·Worker 준비 전체가
5초 안에 완료됐다고 주장하지 않는다.** 준비 중에는 그 사실을 화면에 표시하며, credential과
mail delivery는 broker 준비·registration 뒤에만 허용한다. 원본 index/refs/filters·상속 lease·
child 실제 종료·rootfs quiescence와 모든 설치 바이트 검증은 유지했다.

대화 6회·broker 준비 1회 측정, 별도 실제 권한 연결 1회와 생산 변경의 SHA-256은 [startup evidence](../../test/audit/startup-2026-10-08.evidence.json)에 고정했다.
재현은 [benchmark](../../scripts/benchmark-startup.py), 결정은 [DR35](../design-revisions.md),
사용자 상태는 UX-39가 소유한다. raw logs는 `/tmp/oma-startup-final-{society,personal,broker}.log`,
최종 검사 로그는 `/tmp/oma-final-{build,typecheck,architecture,startup-tests}.log`이다.

## 현재 알려진 한계와 남은 검증

- 실제 manager/cgroup candidate 검사와 reviewer shortage 예외는 기존 독립 거절의 영향을 받는다. fixture 성공을 실제 서비스 증거로 사용하지 않는다.
- native Mac VZ·Keychain·APFS·Swift build와 실제 host↔guest lifecycle 증거는 이 Linux 환경에서 NOT_RUN이다.
- 이전 systemd/VM ownership/isolated-HOME probe 거절과 aggregate suite 금지는 [HANDOFF](../HANDOFF.md)에 유지한다. 문서 이동은 실행 허가가 아니다.
- F1의 bound project 첫 관측에는 이미 실행 중인 app/guest를 요구했던 한계가 남아 있다.
- F2의 Linux file/socket/PTY 및 controlled ownership 회귀는 remote/native 실행 증거의 대체가 아니다.
- kernel·crash systemd lane은 이 호스트의 user systemd에서 EXECUTED+PASS로 기록됐다(위 정산 절). powercut lane과 native 환경 lane은 이 작업에서 실행하지 않으며, release 판정은 필요한 환경과 전체 검증이 갖춰진 뒤 별도로 갱신한다.
- optional verifier·notmuch·reflink·비용 상한·성능 우위는 구현과 실험 증거 없이 활성 기능으로 표시하지 않는다. 현재 unsupported 정책과 후속 구현의 구분은 해당 contract/DR을 따른다.

## 검증 입력과 측정 artifact

아래 binding은 구조 검사의 입력 identity다. digest 생성 자체가 runtime PASS를 뜻하지 않는다.

과거 구조 입력 sha256 `273e7a8b329b1178f3068066e59c0e6d96e03cfa9878578a9091e8f022c471bf` (15355 files)..

당시 기록한 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 기존 artifact와의 불일치를 여기서 수리했다고 주장하지 않는다. 크기 제한은 없으며 값은 release proof가 아니다.

K63: 현재 source list는 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. 기존 digest 파일명은 최소 변경을 위해 유지하지만 내용은 `oma-production-source-digests-v1`이며 LOC/tool/report digest를 포함하지 않는다. `node scripts/loc.mjs --source-digests`로 명시적으로 갱신하고 `npm run check:inventory`는 cloc 없이 source bytes를 검증한다. `--inventory-only`는 계속 목록만 갱신한다.

현재 LOC는 `node scripts/loc.mjs --out <evidence-directory>`가 cloc 2.08로 생성·재검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`에만 있다. 생성기는 committed source digest를 먼저 검증하며 이를 재작성하지 않는다. CI는 검증한 commit 아래 report·report digest·source digest·tool version을 함께 업로드한다. committed LOC claim과 측정치의 결박은 더 이상 제공하지 않으며, source digest 결박은 유지한다. 아래 구조 입력 identity는 DR34(UX-08 CONNECT egress) 2차 맹검증 변경분(paused-socket 수명주기·Teredo 거절·rest 의미)과 BL1(bundled extension #1 pi-lsp — vendor 페이로드·verifyVendorBundle·lsp-tools 어댑터·tool-surface 플랜·workspace-guard 확장), BL2(bundled extension #2 ask_user_question — OMA 네이티브 구현: client contract/model/envelope/protocol, extension 등록, TUI presenter/component, role surface·deployment·두 host 경계 결선), BL3(bundled extension #3 pi-hashline-edit-pro — vendor 페이로드+의존 closure·commit/read seam divergence·hashline-tools 어댑터·file_edit surface·contained writer identity seam), BL4(bundled extension #4 pi-web-access — vendor 페이로드+의존 closure·OMA 정책/egress divergence·web-tools 어댑터·web_research surface·deployment-manifest 엔트리 bound 상향), BL5(bundled extension #5 pi-mcp-adapter — vendor 페이로드+42패키지 의존 closure·27파일 OMA 정책 divergence·mcp-tools 어댑터·공유 child-env 추출·`mcp` DIRECT surface), BL5 맹검증 정산(F1 SDK child-env underlay tombstone·F2 UI-session deny-by-default permit과 direct/proxy/ui-session/glimpse-ui 거절 게이트·F3 ENOENT-only 부재 판정·F4 command basename 정규화 거절·F5 dead `omaStateDir` 제거·F6 tautological assert 교체·`pi.events` runtime-register posture 기록·runtime/manifest 재생성·`mcp-bundle.test.ts` 18종), BL5 정산 후속(SDK underlay 이름의 disposition을 검증된 번들 바이트에서 파싱해 결박하는 drift oracle·win32 trailing-dot/shim fixpoint command admission), LOC 재생성 고정(cloc --ignored 판정을 report의 nonCode 블록에 접는 비코드 분류·clocCoverage 공유 계정 규칙 — vendored LICENSE/NOTICE/.map/dotfile/빈 파일/바이너리 1,620개를 명시 분류, 미계정·미인정 verdict는 여전히 실패), post-listen 'error' 전수 스캔 정산(6곳 listen 경계의 영구 'error' 리스너 + 보호된 best-effort journal, `egress-forwarder`의 `onError` 심과 oma-society `notice` 연결, `rpc.ts` FrameParser 생성자의 'data' emit 내부화, `egress-bridge` stderr.write 가드, cloc 계정의 `Object.hasOwn` own-key 조회와 `temporary editor file` verdict 인정·LOC-004 문구 동기화), post-listen 스캔 맹검증 잔여 정산(vendored pi-mcp-adapter `ui-server` host/proxy·`mcp-callback-server` listen 경계의 OMA_DIVERGENCES 영구 리스너와 runtime·manifest 재생성, broker `cleanupError` 보호된 저널, cloc `rowAt` 구조 키 배제, inference-bridge 'listening' 재등록 가드, inference-relay request/upgrade emit 경계), UX-37 운영 읽기의 진단 예산 분리(`LedgerReader.all`의 per-row 과금 제거·`pendingDeliveryRows` keyset 스트림·`pendingDeliveryCount` SQL 집계·dispatcher 카운트 바인딩·`G02-ledger-r2` 회귀 3종), UX-38 툴 표면 상한·마감 변환(client 출력 digest spool·영수증 청크 진행-리셋 관측·mail 저장/인덱스 bound 분리·수신자 64·contained-search 프레임 관측+완전 재렌더+결과 스풀·contained-files 깊이 거절 제거·`durable-boundaries` `#spoolOutput` 등록)와 그 맹검증 잔여 정산 F1–F6(완전 결과를 직렬화 contained writer로 workspace `.oma/search-results/`에 기록+guard 도달·침묵/진행 이중 창+heartbeat-only 경계·`close` 무조건 스냅샷 sweep·스풀 소유권 명시·목적지 보유-fd 체인+EMFILE 명시 거절·worker `error` 리스너·`contained-files.ts` owned-state 면제 stale 제거), UX-38 맹검증 2라운드 잔여 정산(F-1 contained-search 선언-전-생성 — `withSearchSnapshot`이 `oma-search-<uuid>`를 생성해 `named`를 mkdirSync 전에 호출·EEXIST 새 이름 재선언·자식 측 동기 writeSync(1)로 "존재 ⇒ 선언됨" 성립, F-2 withSearchSnapshot 경계의 EMFILE/ENFILE → "search snapshot ran out of file descriptors" 명시 거절·state-tree-rules 면제 문구 갱신·contained-tools 회귀 5종), UX-38 잔여 3차 — 네트워크/프로세스 표면의 용량 거절·고정 마감 변환(connect-proxy·inference-relay·host/guest egress·egress-forwarder의 용량→FIFO 작업 집합, readLeadingFrame/oneFrame·프로세스 silenceMs의 진행-리셋 침묵 창과 `stalled` 분류, stdout/stderrSpool 통째 보존과 git/mkfs/패키스 스풀 결선, 회귀: r37-async-process 6종·egress-connect 큐잉·inference-relay 큐잉/철회·platform-egress 작업 집합·session-process-owner node:fs 스텁), UX-38 batch 5 — durable-capacity 변환(quarantine 진행-리셋 침묵 검출+heartbeat·per-executor sticky 정산, gitlink/merge-tree 출력 스풀+점증 파싱과 GITLINKS_OBSERVATION_BYTES 폐기, workspace Git clone/fetch/checkout·canonical fsck의 PreparationExecutor 진행-리셋 전환, 설정 소스 4096 파일/64 MiB·문서 16 MiB 재명명, 패키지 아카이브 스트리밍+8M working-set 한도, 브로커 over-quota degraded 기동+StorageAdmission.startupState, 프로세스 계보 깊이 제한→Set 사이클 검출, OMA_WORKSPACE_BYTES 결선 검증+PR-004/T68d/D04/descent 오라클, runWorkspaceGit 제거, state-tree/owned-state 규칙 면제·held-parent 정산과 durable-boundaries collection 등록 2건) 변경분의 로컬 검증을 위해 다시 결박한 것이고, 이전 runtime PASS를 새 source의 PASS로 승격하지 않는다.

## 재검증

명령은 [package.json](../../package.json), 검증 요구는 verification-spec이 소유한다.

```sh
npm run check:documents
npm run check:inventory
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs
```

바뀐 검사·owner 경로의 관련 회귀를 이어 실행한다. 환경이 필요한 suite는 허용 환경과 기존 거절을 먼저 확인한다. 새 durable 경계에는 의미 있는 negative control과 kill·retry·restart oracle를 연결하고 결과를 여기에 기록한다. 전체 suite 수를 위해 실행 금지를 우회하지 않는다.
