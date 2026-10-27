# native 플랫폼 전환 계약 — DR49

2026-10-25 사용자 구현 지시로 VM 지원을 폐기했다. 이 문서는 현재 전환 계약을 소유한다.
과거 MAC/MV/T 번호의 원문과 의미는 [VM 계약·시험 기록](archive/macos-vm-tests-2026-10-25/README.md)에
보존하며 native 수용 번호로 재사용하지 않는다. [전환 명세](macos-native-spec.md)의 P0–P7을 따른다.
구현 존재와 지원 완료를 구분하고, 실제 상태는 [validation](implementation/validation.md)이 소유한다.

2026-10-28 DR61의 NATIVE-024/025가 아래 지정한 구현 가정과 파일 leaf 경계를 대체한다.
기존 ID의 의미와 실행·권한·데이터 보장은 보존하며, 상세 후보/판정은 전환 명세가 소유한다.

## 실행·소유권

**MUST [NATIVE-001]** 제품은 공통 `oma` 진입점과 25개 workspace의 동일한 TypeScript 실행부를
사용한다. VZ/vsock/omahostd/guest/terminal forwarding/VM snapshot과 그 자산·entry를 실행 경로에
남기거나 fallback으로 사용하지 않는다. CLI는 폐기한 attach/open/bind/stop 등의 문법을 새 파괴적
효과로 재해석하지 않고 종료 안내로 거절한다. GUI/background/remote attach는 native v1 범위가 아니다.

**MUST [NATIVE-002]** G-PROCESS·G-FILES·G-AUTH는 별도 선행 조건이다. 해당 경계의 held scope
관측과 현재 실행 권한을 확인하지 못하면 새 실행·incarnation·batch 재전달·workspace 재사용·회수로
진행하지 않는다. 과거 receipt 정산은 원래 owner와 증명된 quiescence를 사용하며 현재 grant로 그
사실을 재해석하지 않는다. EOF, direct child close, group kill 전송, heartbeat, 빈 ps 목록을 전체 후손 종료로 읽지 않는다.
필요 primitive가 없으면 효과 전에 UNSUPPORTED_PROFILE로 거절하며 이전 VM으로 우회하지 않는다.

## 모듈과 파일

**MUST [NATIVE-003]** 파일 게시·검증·복구 정책은 storage/config의 공통 TS owner가 소유한다.
OS leaf는 directory-relative open/mkdir/unlink/rename/link, pin/lock/metadata 관측만 제공한다.
permission-independent pin, 같은 inode repair/reopen, no-follow/beneath, no-replace publish와 parent flush를
pathname 재검사나 /dev/fd 문자열 치환으로 대체하지 않는다. unknown 관측은 부재·죽음·성공이 아니다.

**MUST [NATIVE-004]** Restic은 고정 upstream binary를 사용하고 command/child/descriptor 수명은
process가, inventory·tar 검증은 storage가, 제품 종료·Store.close와의 연결은 App 조립이 소유한다.
검증은 실제 repository 읽기·전체 dump stream·file hash·link·PAX·entry coverage·완전한 EOF와
exit 0/actual close, 정확한 inventory metadata·원본 재관측을 모두 요구한다. GNU tar/inline child
검증을 쓰지 않는다. source quiescence → backup → 검증 → immutable checkpoint → cold commit →
회수 및 staged restore 순서는 DR48대로 유지한다. metadata가 보존되지 않으면 hot 원본을 남긴다.

**MUST [NATIVE-005]** 기존 VM disk/state/archive·native Personal history·accepted plan·receipt의
bytes와 의미를 자동 변환·덮어쓰기·삭제하지 않는다. Mac native v1은 별도의 새 state root에서 시작한다.
HostConfig·DB·plan 형식을 변경할 때는 registry에서 새 version을 할당하고, 과거 형식의 optional
완화나 현재 값으로의 재해석을 migration으로 취급하지 않는다. Keychain 실패는 파일 credential
fallback의 권한이 아니며, 실제 서명·access group·잠김/거절의 release 검증은 CI scripted credential과 다르다.

**MUST [NATIVE-006]** macOS 26 arm64의 실제 Darwin CI가 filesystem/process/peer/sandbox/CLI를
검증한다. macOS 15는 별도 호환성 probe다. mock·skip·timeout·SETUP_FAILED·BLOCKED를 PASS로
계산하지 않는다. source SHA·input digest·OS/image/SDK·Node/Pi/SQLite/Koffi/Git/Restic version·raw
exit/stdio와 잔존 관측을 보존한다. 서명된 Keychain·TCC·실제 sleep/wake·power loss는 별도 미검증이다.

**MUST [NATIVE-007]** 25개 workspace 사이의 기존 의존 방향을 유지한다. App은 조립과 제품
lifecycle을 맡고, process는 실행 수명, broker/domain은 인증·권한 판정, storage는 저장·검증·복구,
Git은 Git 검증, native/platform-*는 OS primitive를 맡는다. 아래 모듈이 App을 참조하거나 같은
정책을 OS별로 복제하지 않는다. 공통화를 위해 의존 허용 목록을 넓히거나 순환을 허용하지 않는다.

**MUST [NATIVE-008]** DR50은 NATIVE-001/007의 모듈 수·의존 허용 목록에 관한 부분을
다음 기준으로 대체한다. 25개는 출발점이며 고정 개수가 아니다. 기존 책임은 해당 모듈에서
수정하고 새 독립 책임은 새 workspace로 분리할 수 있다. 각 모듈은 공개 API·직접 의존성·
단방향 runtime/type DAG·독립 build/test/설치를 유지한다. 책임에 따른 새 공개 의존성은
manifest·owner map·경계 검사·negative control과 함께 갱신한다. 허용 목록만 넓혀 private
접근이나 책임 침범을 숨기지 않는다. 나머지 NATIVE-001/007 계약과 원래 ID의 기록은 보존한다.

**MUST [NATIVE-010]** engine-hosted 파일 도구의 containment·regular-file·hard-link·동일 inode
판정과 search snapshot 수명은 SDK 없는 `@oma/tool-files`가 소유한다. tool-runtime·hashline·LSP는
공개 API로 연결하고 tool-files는 Node built-in과 자신의 파일만 참조한다. OS descriptor 경로는
작은 private primitive에 모은다. 미검증 플랫폼은 파일 효과 전에 거절하며, 이를 G-FILES 통과로
계산하지 않는다. 기존 도구의 symlink 거절·check/effect 동일 해석·snapshot 선언 전 생성 금지와
실제 inode 검증을 pathname 재검사나 legacy 구현으로 대체하지 않는다.

**MUST [NATIVE-009]** materialization의 0→1 전이가 commit된 뒤에만 내부 wake hint를
보낸다. hint는 accepted 작업·새 queue·실행 권한·후손 종료 증명이 아니다. process의 공통
coalescer는 활성 callback 하나와 pending hint 하나를 유지하고 요청자의 transaction/recovery
async context를 빌리지 않는다. broker 종료는 pending hint를 취소하고 활성 작업을 drain한다.
재시작·sweep은 원래 ledger와 Maildir, 현재 desired/incarnation/GOAL을 다시 읽으며, 새 실행
직전에는 이전 scope의 독립적인 종료 관측을 요구한다. unknown은 새 실행의 근거가 아니다.

## 현재 구현의 한계

**MUST [NATIVE-011]** DR51의 직접 실행은 storage의 version1 journal에 opening을 먼저
기록하고, blocked scope의 실제 kernel witness를 flush한 뒤 현재 권한을 확인해 gate를 연다.
공통 process owner가 결과·drain·독립 scope 사망·journal retire를 조정한다. EOF·직접 child
close·성공한 kill은 전체 사망 증명이 아니다. unknown scope의 live pin과 journal을 유지하며
재시작은 이전 witness 관측 없이 READY·새 실행·workspace 재사용·회수를 허용하지 않는다.
관측 journal은 명령·accepted plan·receipt·credential·재생 queue가 아니며, 누락·손상·부분
frame을 빈 scope 목록으로 읽지 않는다. 기록의 PID만으로 복구 중 신호를 보내지 않는다.
초기 journal 게시 직후의 process crash와 재초기화도 기존 bytes를 교체하지 못한다.

**MUST [NATIVE-012]** DR54 복구는 현재 tenure와 journal의 배타 소유 하에서만 수행한다.
저장 PID에 신호를 보내지 않고, 새로 얻은 namespace-init capability의 전체 identity가
저장 witness와 일치하는지 공통 owner가 확인한 뒤 그 capability로만 종료한다. 실제 전체
종료 관측 전에는 journal을 retire하지 않는다. pin 획득 실패·identity 변경·unknown과
witness 없는 opening은 새 효과나 빈 초기 상태를 허가하지 않는다.

**MUST [NATIVE-013]** foreground broker의 공통 Resident owner가 accepted profile/model 참조,
현재 incarnation, wake·재시작·중지·로그 수명을 조정한다. slot별 실행 하나와 메모리 backoff를
유지하며 timer는 hint만 보낸다. Linux systemd/path/journald 및 host relay fallback을 두지 않는다.
Resident owner의 close는 새 start를 영구 차단하고 모든 slot의 정리를 시도한다.
실행 이력이 없는 recovered empty slot과 Principal에는 Resident의 exit 0을 표시하지 않는다.
빈 scope의 긍정적인 복구 관측과 unobserved는 구분한다. 중지와
close는 실제 scope 종료와 별도로 diagnostic flush·FD 반환의 completion도 기다리며,
application은 이 owner와 execution journal owner를 모두 정리한 뒤 Store를 닫는다.
실제 scope owner는 Resident·candidate·quarantine 모두에서 같은 journal/gate/death 정책을
사용한다. 검증과 import는 별도 sandbox scope이며 첫 scope의 전체 종료 뒤에만 canonical RW를
허용한다. 읽기 전용 canonical mount·held directory FD 결박·exact checkout을 pathname 재검사나
shell script로 대체하지 않는다.
quarantine은 빌린 accepted bundle FD의 inode를 유지하면서 독립적인 읽기 cursor를 얻고
사용 뒤 반환한다. consumer가 caller의 cursor를 소비하거나 재시도가 pathname을 다시 따라가
다른 bundle을 읽어서는 안 된다.

**MUST [NATIVE-014]** Linux의 공개 socket은 SO_PASSCRED가 listener READY 전에 활성화되고,
recvmsg의 각 byte range가 still-pinned original connector의 PID/UID/GID에서 왔는지 공통 broker
owner가 판정한다. SCM_RIGHTS 등 추가 ancillary는 전달된 FD를 모두 닫은 뒤 거절한다. Runner의
관리 연결은 spawn owner가 private socketpair와 실제 trusted child pin을 인계한 경우만 허용한다.
Darwin의 endpoint peer PID나 holder 관측을 이 per-range sender 증거의 대체로 사용하지 않는다.

**MUST [NATIVE-015]** 새 create plan은 version3의 `execution: "native"`를 기록한다(DR52).
version2 plan 및 terminal receipt는 원래 의미와 bytes로 읽으며, historical unit installation을
요구하는 미완료 version2 intent를 native 실행 완료로 정산하지 않는다. 실행 journal과 로그를
accepted plan·receipt·권한의 원본으로 사용하지 않는다.

**MUST [NATIVE-016]** DR53의 full diagnostic spool과 bounded public log view는 분리한다.
actor·invocation·현재 incarnation·stream·시각과 원본 byte를 저장하고, 서로 다른 incarnation의
UTF-8 조각을 합치지 않는다. 부분 frame·UTF-8 tail·읽기 실패를 성공한 빈 로그로 표시하지 않는다.
저장 owner는 append 전후와 close 때 held regular inode의 단일 link와 알려진 길이를 확인한다.
중간 alias·unlink·외부 쓰기·부분 기록은 poison되며 bytes를 지우거나 성공으로 마감하지 않는다.

**MUST [NATIVE-017]** DR55 candidate setup은 exact checkout 뒤 check argv를 exec하기 전에
private 준비 상태를 보낸다. host가 현재 authority·취소 상태를 다시 확인하고 별도 private gate에
release byte를 써야만 exec할 수 있다. EOF·준비 상태·로그만으로 gate를 열지 않는다. 상태 FD는
close-on-exec이고 release FD는 exec 전에 닫으며, check가 setup 상태를 위조할 수 없게 한다.
첫 protocol·권한 오류와 불완전한 EOF는 poison되어 후속 frame이나 재호출로 성공을 만들지 못한다.
UTF-8 decoding은 공통 domain owner를 사용하며 BOM을 지워 닫힌 JSON 문법을 통과시키지 않는다.

## Native 물리 순서와 credential 경계

**MUST [NATIVE-018]** DR56의 아래 native 물리 순서는 SEQ-002의 폐기된 unit/cgroup 실행
단계를 대체한다. 아래 순서를 거꾸로 수행하거나, 실패·unknown인 단계를 성공으로 읽고
다음 효과를 시작하지 않는다. accepted DB/plan/receipt의 logical 순서와 과거 형식의 뜻은 유지한다.

| 경로 | 현재 순서와 완료 경계 |
|---|---|
| broker 시작 | 지원 gate → 안전한 runtime root와 broker lock → Society tenure → config/deployment 확인 → journal recovery/전체 scope 사망 확인 → restore/preparation → Store → pending reconciliation → 인증 listener → READY → 활성화. lock loser·미완료 recovery는 writer/READY/활성화를 얻지 못함 |
| agent.create | 현재 권한·strict 입력·same-key → frozen spec/from/brief를 담은 native intent commit → immutable initial mail과 exact workspace 준비 → 실행 owner의 frozen 참조 등록 → create-ready commit → gated mail 공개 → GOAL/현재 권한 재검사 뒤 활성화 → receipt. 역사 version2 unit intent는 자동 완성 금지 |
| agent.start/stop | accepted epoch를 바꾸지 않는 current-intent 대조 → start는 이전 scope 종료/GOAL/현재 권한, stop은 hint 차단·권한 철회·종료 시도 → 실제 사망과 진단 close 확인 → accepted operation 정산. terminal same-key receipt는 현재 설정으로 다시 만들지 않음 |
| runner.open | 소유 private channel과 실제 child/scope pin → 현재 registry/desired/GOAL → 이전 run의 quiescence → 과거 receipt 정산 → incarnation commit → 현재 scope·endpoint 확정. 연결 소유나 로그만으로 새 grant를 만들지 않음 |
| 종료 | admission/활성화 차단 → 소유 실행 모두 종료·completion/FD/log drain → journal owner close → broker task/Store close → singleton 반환. 종료 불명은 writer 자원 해제 성공이 아님 |

**MUST [NATIVE-019]** standalone Keychain 채널은 get/put만 전송하고 VM operation/event나
느슨한 응답 모드를 제공하지 않는다. bounded raw byte를 공통 strict JSON/UTF-8 owner로 판정한다.
malformed UTF-8·JSON BOM·중복 key·알 수 없는 correlation/field·잘못된 값·부분 EOF·timeout은
채널을 poison하고 모든 pending 요청을 거절한다. 후속 valid frame은 채널을 되살리지 못한다.
값 내부의 정상 BOM은 원래 bytes의 뜻을 보존한다. EOF와 pending 거절은 helper의 실제 종료
증명이 아니며 child owner의 close 관측을 별도로 기다린다. 이 통신 시험은 signed Keychain·TCC
검증이나 G-AUTH 통과의 대체가 아니다.

**MUST [NATIVE-020]** 파생 status 게시 hint는 accepted 작업이나 실행 권한이 아니다. 공통
coalescer가 활성 게시 하나와 pending hint 하나만 유지하며, 관측이 끝난 뒤 현재 ledger를 읽어
게시한다. 같은 관측 Promise에 붙은 호출자마다 동일 파일을 재게시하지 않는다. 종료는 새 hint와
pending 게시를 취소하고 활성 게시 작업을 drain한 뒤 Store를 닫는다. 종료 이후 status 파일을
되살리지 않는다. WP23의 조회/혼합 부하 지연 예산과 unknown 표시는 그대로 유지한다.

**MUST [NATIVE-021]** 공통 public mutation dispatch는 효과와 view 갱신이 끝난 뒤 답변 전에
event loop에 한 turn을 반환한다. 연속 완료된 요청의 Promise continuation이 timer/다른 연결을
계속 밀어내지 않는다. 이 대기는 SQLite transaction 안이나 새로운 효과의 권한 확인을 대신하는
위치에 두지 않는다. 그 사이 admission·현재 run 권한이 바뀌어도 이미 확정된 plan·receipt·
accepted result를 새 실패로 재해석하지 않는다. 종료 owner는 답변 작업의 수명도 기다린다.

**MUST [NATIVE-022]** native CLI/TUI의 로컬 예외 문구는 공통 error owner가 읽고, CLI 실패는
stderr에 쓴다. 폐기한 VM 환경변수로 Linux 경로·errno·용어를 숨기거나 출력 채널을 바꾸지 않는다.
터미널 제어문자 제거·화면 폭 처리는 현재 presentation owner에 유지한다. Society history는
OS 분기 없이 birth·project binding·engine cwd를 검증한다. 폐기한 VM relay handoff·Society
선택·패키지 세대 수집 API는 export나 무효 호환 wrapper로 남기지 않으며 과거 데이터는 보존한다.

**MUST [NATIVE-023]** runner 실행 identity는 공통 execution owner가 발급한 UUID를 명시적인
launch 인자로 전달한다. runner entry는 누락·중복·잘못된 identity를 거절하고, 검증한 값을
RunnerModule에 전달한다. ambient service-manager 환경변수에서 identity를 읽거나 대체하지 않는다.
기존 runner.open·로그의 invocationId는 같은 UUID의32자리 hex이며 broker의 현재 scope binding과
일치해야 한다. accepted plan·receipt·incarnation·권한의 의미는 바꾸지 않는다.

## 제품 보장과 구현 선택 — DR61

**MUST [NATIVE-024]** native 구현은 확인된 사실·채택 결정·미검증 후보를 구분한다. 미결정
경계는 기존 구현·복수 후보·원본 source/SDK·배포 조건·결정적 반례를 대조한 뒤 실제 실행으로
채택한다. launchd session·PID scan·group kill을 complete-scope proof로 미리 가정하지 않는다.
이는 NATIVE-002의 해당 효과별 gate를 유지하되 독립 작업까지 일괄 중단하는 해석을 대체한다.
기능 제외·보안/복구 완화·privileged 서비스·restricted entitlement·지원 OS 변경은 별도 사용자
결정이 필요하다. 같은 실패는 전제나 입력 또는 관측 질문이 바뀐 경우에만 다시 실행한다.

**MUST [NATIVE-025]** NATIVE-003의 permission-independent pin 보편 제공 전제와
NATIVE-010의 Node-only 제한을 다음으로 대체한다. 공통 TS가 파일 정책을 소유하고 caller는
directory handle·metadata observation·entry pin·I/O FD·independent cursor·executable selection을
구분한다. 안전하게 얻지 못한 capability는 unknown/unsupported이며 pathname repair나 다른 inode로
대체하지 않는다. tool-files의 private descriptor adapter는 `@oma/native/files`와
`@oma/native/posix-files`의 공개 leaf 또는 주입된 좁은 port를 사용할 수 있다. 다른 tool caller의
native 접근이나 SDK/broker/storage 의존을 허용하지 않는다. manifest·경계 검사·negative control·
독립 설치를 함께 갱신하며, 기존 containment·동일 inode·publication·archive 계약은 유지한다.

**MUST [NATIVE-026]** DR62는 NATIVE-025의 구체 native leaf 선택을 대체한다. tool-files의
private descriptor adapter는 업무 의존성이 없는 `@oma/file-descriptors`의 공개 API만 사용할 수
있다. 이 leaf는 자기 파일·Node built-in·Koffi만 참조한다. 검사와 독립 설치는 직접 import뿐 아니라
relative import/re-export와 runtime closure도 확인하며 broad native 모듈을 예외 처리하지 않는다.
기존 descriptor primitive와 caller를 한 번에 이관하고 obsolete export·복제 구현을 남기지 않는다.
OS filename은 malformed UTF-8을 거절하고 선두 U+FEFF를 보존한다. 기존 파일 정책·권한·복구
계약과 NATIVE-025의 나머지 조항은 유지한다.

Darwin CI에서 NOTE_TRACK 거절과 setsid 후손 생존, mode-000 event pin 거절을 실제로 관측했다.
따라서 Mac native 제품 실행은 차단돼 있다. Linux의 실제 경로 연결과 Darwin primitive 연결,
전체 회귀·owner/규범 결박의 완료를 구분한다. 세부 구현·실패와
재개점은 [전환 기록](implementation/native-transition.md)과 [인계](HANDOFF.md)를 따른다.
