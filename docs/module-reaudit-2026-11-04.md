# 2026-11-04 현재 코드 재감사와 수정

사용자가 제공한 2026-11-01 재감사 결과를 현재 dirty worktree에서 다시 대조했다. 과거 보고서의 줄 번호나 재현 결과를 현재 코드의 증거로 재사용하지 않았다. 기존 tool-surface 작업은 보존하고, 현재 남은 결함과 그 인접 경계를 수정했다. 사용자의 Codex OAuth 토큰·자격 증명 파일은 열거나 변경하지 않았다.

검토 기준은 `model-collaboration-surface-spec.md`와 하위 records/tools/runtime/validation 계약, Priority 0의 accepted fact 보존·단일 authority·동일 경계 검사·자원 수명·unknown 보존이다. 새 도구나 별도 실행 서비스·durable index는 추가하지 않았다. fresh Society admission closure는 유지한다.

## 과거 항목의 현재 판정

| ID | 현재 판정과 조치 | 실행 근거 |
|---|---|---|
| RC-01 | 수정. config가 durable review identity의 원래 policyRevision 문법을 공유한다. 128 UTF-8 bytes/제어 문자 제한을 기존 decoder에서 추출했으며 과거 identity를 재해석하지 않는다. | config-validation 007 |
| RC-02 | 수정. recovery key는 실제 `recover-first-` prefix까지 request-key bound로 검증한다. 생성 owner도 같은 prefix를 사용한다. | config-validation 008 |
| RC-03 | 수정. initial/recovery brief를 기존 agent.create의 8192-byte bound로 검증한다. | config-validation 009 |
| RC-04 | 수정. 파생 reply 제목은 host byte bound 안에서 Unicode code point를 보존해 줄이고, Re: prefix는 한 번만 붙인다. 명시적인 제목과 원래 저장 메일은 바꾸지 않는다. | f1-reply-boundary 003 |
| RCFG-01 | 수정. agentProfiles key를 operations loader와 같은 role-name 문법으로 검사한다. model profile 이름은 별도 계약을 유지한다. | config-validation 010 |
| RCFG-02 | 수정. check executable/argv/env를 실행 owner의 검증으로 검사하고 duplicate id를 거부한다. | config-validation 011 |
| RCFG-03 | 수정. 아직 inline/manual인 commit pointer 아래 첫 conversion이 남긴 generation도 quiescent collector가 수집한다. | config-generations 016, inline/manual 양쪽 |
| HLN-01/02 | 실제 compiled adapter+vendor+SDK+FS에서 두 escape를 재현한 뒤 수정. 이미지도 admitted descriptor에서 읽은 bytes/MIME를 SDK에 전달한다. 원문 경로를 다시 열지 않는다. | tool-hashline bundle의 @ alias/absolute-path 두 음성 대조 |
| GIT-01 | 실제 SHA-1/SHA-256 repo와 native quarantine에서 재현 후 수정. quarantine에서 exact object type을 검사하고 observation은 tag를 commit으로 peel하지 않는다. | git observation-boundary, quarantine-profile 005, 실제 diagnostic adapter의 exact commit/tag 대조 |
| PROTO-BATCH-PREPARE-REPLY-FRAME | 수정. 실제 response id와 전체 RPC envelope/PreparedBatch를 기준으로 acceptance 전 prefix를 선택한다. 현재 record notice도 같은 budget을 사용한다. 작은 frame의 inbox는 상대 경로와 metadata를 가리키는 명시적 표시 생략을 사용한다. | principal-endpoint 043, 실제 Unix socket, legacy/selected 각각 768B·재전달 |
| CONN-SESSION-DIRS-FRAME-OFF-BY-TWO | 수정. 실제 전송 배열의 괄호 2바이트를 다시 뺀 계산을 제거했다. | session-resume-frames 006, 정확히 정렬된 경계와 실제 InteractiveChannel |
| PROTO-BATCH-COMPLETE-REQUEST-FRAME | 수정. private completion wire는 batch/incarnation/revision만 전송한다. broker는 canonical 위치의 원래 verified receipt를 읽고 그 session/manifest로 완료한다. 기존 full path 인자가 있으면 일치 여부를 계속 검사한다. | principal-endpoint 044, 긴 root·488B client·실제 Unix socket, absent receipt/충돌 path 거부 |
| RAB-01 | 수정. runner control close는 자기 invocation에 해당하는 run만 revoke한다. | principal-endpoint 045, 실제 Broker/RPC/RunRegistry와 비동기 stream close. scope population은 통제 fixture이며 native authentication qualification은 아니다. |
| RT-01 | 현재 구현에서 대체됨. 폐기된 toolset selector는 복원하지 않는다. 현재 direct extension admission은 hidden/deferred를 제외한다. | collaboration-groups, retired-surface |
| RT-02 | 현재 구현에서 대체됨. 사용자 extension selection을 durable group event에 저장하지 않으며 현재 설치된 direct extension을 다시 관측한다. 현재 고정 역할 group의 손상/불완전 event는 계속 거부한다. | collaboration-groups의 extension 제거 후 resume 및 잘못된 group 대조 |
| RT-03 | 현재 group fence에도 남아 있어 수정. immutable canonical metadata snapshot을 비교해 동등한 새 schema 객체는 허용하고 in-place 변조는 잡는다. | collaboration-groups 009 |
| TF-FIFO-BLOCK | 남아 있었음. bounded read만 고쳐져 있었고 일반 read/write/open은 실제 FIFO에서 hang했다. 공통 contained open에 O_NONBLOCK을 적용하고 type guard를 유지했다. | tool-files files 018, 별도 실제 Node 프로세스 6개·실제 FIFO. 수정 전 timeout/SIGKILL, 수정 후 즉시 거부 |
| MAIL-A1 | 수정. receipt 크기를 먼저 검증하고 SDK boundary envelope 전체와 앞 newline이 들어가는 bounded tail을 읽는다. | delivery-receipt-publication의 receipt 크기 경계·3-id 실제 session 파일 |
| MCP-SCRATCH-SHARED-HOME | 수정. 각 engine은 private state 아래 고유 leaf만 생성·제거하고, 기존 shared scratch alias는 경로 조상으로 사용하지 않는다. durable OAuth root는 유지한다. | MCP bundle 027, 동일 agentDir의 별도 Node process 2개에서 실제 adapter/vendor factory를 실행한다(Pi API는 fixture). stdio child 종료 순서는 기존 실제 child 시험도 유지 |
| MCP-EXPOSE-RESOURCES-PIN | 수정. per-server true를 거부하며 URL 설치 등 이후 vendor config merge에서도 OMA policy의 false pin을 적용한다. bare upstream 동작은 유지한다. | MCP bundle 028/029 |
| APP-2 | 수정. settings writer가 같은 reader byte bound를 publication 전에 검사한다. 거부 시 기존 파일과 다음 쓰기 가능 상태를 보존한다. | user-files 007, compact 360KB → pretty 1.26MB |
| LC-01 | 수정. 손상된 provisioning workspace의 shape/HEAD/base는 actor resource conflict다. frozen path/spec/ledger 모순은 여전히 STORE_CORRUPT다. 손상 파일은 덮어쓰지 않는다. | r37-preparation-boundaries 008, 실제 create/Store/mail/workspace 및 무관한 새 acceptance; untrusted-directories |
| ENG-READ-01 | 수정. panel은 bounded UI fragment로 순서대로 전송하고 write completion을 기다린다. receiver는 byte bound 안에서 전체 panel을 조립한 후 반영한다. Unicode/ANSI line을 중간 절단하지 않는다. | panel-terminal-ownership 014, long Unicode/ANSI와 backpressure; 전체 interactive 시험 |
| G-1 | 수정. Git snapshot path/output의 비 UTF-8 bytes를 input refusal로 분류하고 offending record의 제한된 hex를 안내한다. invalid UTF-8 filename을 지원하는 변경은 아니다. | project-snapshot 016, 실제 Git/FS |
| REAUD-TUI-01 | 수정. LSP scratch cleanup은 기존 permission-repair removal owner를 사용한다. | lsp-call-scope의 실제 0555 descendant |
| PROTO-STATUS-VIEW-BOUND-ASYMMETRY | 수정. host-private aggregate status document의 공유 bound를 socket page bound와 분리했다. publisher/production reader가 동일한 document bound를 사용한다. 원래 row는 생략하지 않는다. | status-view 004, 실제 publisher/reader, aggregate >768B |
| REV-RA2-01 | 수정. included request는 vote/cancel/retry/control을 받지 않고 status nextAction=none, acceptingWorkerVotes=false다. | architecture-p3 011, 추가 fact 없음 |
| REV-RA2-02 | 수정. deterministic integration conflict는 requester-revise로 안내하고 같은 conflict에 대한 retry fact를 만들지 않는다. 복구 가능한 notice/환경 실패의 retry는 유지한다. | architecture-p3 009, architecture-p1b/review-faults 대조 |
| EXT-01/02/03 | 과거 model 도구의 subject/log/approval_notice schema는 현재 catalog에 존재하지 않는다. 폐기 API를 재노출하지 않았다. current collaboration 입력과 host byte/recipient owner를 대조했다. | extension/current surface·retired-surface 시험 |
| F-C2 | 수정. legacy compound publication은 파생 key에서 candidate/to뿐 아니라 고정 subject/body/paths도 frozen intent와 비교한다. 다른 caller의 payload를 조용히 재사용하지 않는다. 과거 accepted child key/bytes는 재작성하지 않는다. | client 022, 충돌 cache 후 transport effect 없음 |
| RC-05 | 남아 있었음. process helper는 long timer를 처리했으나 앱의 checkWallTimeMs timer가 overflow했다. 같은 monotonic/chunked deadline owner를 사용한다. | architecture-p2-pipeline 005, 실제 native healthy pipeline, 0x80000001ms. 수정 전 1ms overflow/CHECK_TIMEOUT |
| REAUDIT2-TOOLLSP-001 | 수정. adapter silence timer와 vendor LSP client의 요청/drain/settle timer가 기존 monotonic deadline을 사용한다. 임의의 작은 cap을 추가하지 않았다. | lsp-call-scope와 실제 healthy LSP server long timeout |
| GIT-02 | 수정. recovery의 새 context CAS 전에 현재 Society fence를 Resident에게 검사한다. 이미 적용된 결과의 settlement와 closed Society의 Principal GOAL publication은 유지한다. | r21-context-workflow 007, 실제 Store/Git/SocietyControl. native death는 policy fixture 범위 |
| GIT-03 | 수정. ready 이후 사라진 step cwd는 diagnostic/step-end/pipeline-end를 남기는 CHECK_FAILED다. 이후 새 pipeline 실행이 가능하다. | architecture-p2-pipeline 004, 실제 native sandbox |
| GIT-04 | 수정. Workspace executor의 stale proof는 마지막 preparation의 원래 lease path를 검사한다. 새 actor의 경로로 불확실성을 해제하지 않는다. | r37-preparation-boundaries 009, 실제 held lease + 통제된 sticky uncertainty. product crash schedule을 재현했다는 주장은 아니다. |
| ReAuditToolWeb-01 | 현재 decoder가 이미 음수 fractional timestamp를 floor한다. 변경 없이 원래 규칙을 검증했다. | restic-tar 008, -0.5/-1.000000001 PAX와 exact inventory nanoseconds. 실제 restic 설치/backup 전체 실행과는 별도 |
| APP-1 | 수정. standalone login/pi dispatch가 project execution admission을 요구하지 않는다. 실제 session bootstrap의 overlap fence는 유지한다. | local-package-atomicity 002, HOME cwd·격리된 engine stand-in·실제 CLI. 실제 login/credential/network 호출은 없음 |
| APP-3 | 수정. multi-message operation의 다른 message archive를 이 message의 proof로 세지 않는다. archive가 없는 같은 message의 실제 inbox publication은 계속 corruption이다. | review-faults 018, 실제 두 message publication 사이 fault + 같은 message archive 손실 음성 대조 |
| APP-4 | 수정. IPv6 URL hostname의 bracket을 Node request host에 전달하기 전에 제거한다. | inference-relay 030, 실제 ::1 TLS provider·relay·socket |
| RA2-STORAGE-01 | 수정. exclusive journal owner의 verified live scan을 bounded process cache로 재사용한다. inode/size/mtimeNs/ctimeNs 변경·부분 write/flush 실패는 invalidate하며 durable journal/flush는 그대로다. 32개 inbox/262144개 id의 합계를 넘으면 재스캔한다. durable index나 rotation authority는 추가하지 않았다. | storage arrival-journal 003, warm append/duplicate의 실제 read byte 수와 외부 truncation 후 재스캔; mail-arrival-durability |
| N-R1 | 수정. rootfs directory owner는 stray file/link 대체를 거부한다. 기존 일반 owned-tree repair는 다른 owner의 정책으로 유지한다. | sandbox-environment 032, root 자체·mount target file/link 내용 보존 |
| PL-LINUX-01 | 현재 producer가 --size를 만들 수 있어 실제 조합을 수정했다. 기존 per-mount bound와 workload ceiling 중 작은 값 하나만 출력한다. command argv의 literal은 option으로 재해석하지 않는다. | architecture-p2-resources 003, 기존 --size + workload ceiling + 실제 pinned bwrap/ENOSPC |
| RAR-01/02 | highPeerFloor≥3의 거부는 정당한 body bound이므로 완화하지 않는다. 현재 validator는 두 관련 필드를 안내한다. quarter sizing의 비단조 gap 때문에 단순 'at least' 대신 해당 입력이 맞지 않는다는 사실과 실제 fitting value를 안내한다. | config-limits-floor의 독립 body oracle/최소값 및 경계 검사 |
| DOMAIN-BOUND-01 / REAP-PROC-01 / FD-1 | 기존 철회/보류 근거를 유지한다. 도달하지 않은 spill 계약은 제품 결함으로 추가 집계하지 않고, invalid UTF-8 filename refusal은 요구사항대로 유지한다. | process/filesystem 관련 시험과 G-1의 오류 분류를 구분 |

## 인접 감사에서 추가 수정한 결함

- Hashline의 host opener가 sandboxed adapter 등록 뒤에도 process-global 상태에 남았다. sandboxed 등록에서 기존 opener를 명시적으로 해제했다. host/image 회귀와 sandbox inbox 회귀를 같은 프로세스에서 함께 실행했다.
- Tool definition을 reference로 보유하면 같은 parameters 객체의 in-place 변조를 감지하지 못했다. RT-03의 immutable semantic snapshot이 동등 객체 refresh와 변조를 각각 검사한다.
- Private tool-state key의 final name을 O_EXCL로 먼저 만들면 다른 engine이 빈 key를 보거나 crash 뒤 빈 final이 남았다. 같은 held directory의 complete temporary를 fsync한 후 exclusive rename으로 공개한다. 기존 final은 덮어쓰지 않고 winner를 검증한다. 실제 두 Node process 사이에서 첫 writer를 write 전 정지시켜 동일한 완성 key를 얻는지 검사했다. 시험 key는 임시 디렉터리에만 생성했다.
- 작은 frame의 selected batch에서 record index의 한 행이 커져 prepare가 실패했다. 현재 compact inbox는 모든 manifest row·generation·coverage·source 참조를 유지하고, 표시 문자열만 metadata 참조와 함께 줄인다. 원래 body/metadata는 그대로다.
- 추가 전체 소스 검사 중 MCP의 requestTimeoutMs overflow를 확인했다. 실제 manager가 만든 request options와 pinned SDK Client를 사용한 25ms 응답 transport에서 3000ms는 연결되고 2147483649ms는 약 3ms 만에 실패했다(Node가 1ms timer로 바꿈). OMA 설정과 runtime manager 양쪽에서 SDK timer의 최대값 2147483647ms를 넘는 요청을 명시적으로 거부한다. 동작하던 timeout 값은 유지하며 clamp하지 않는다. MCP bundle 030은 settings/server 두 경계, raw runtime 설정, 거부 뒤 기존 default 보존, 최대 지원 timeout의 실제 SDK 연결, bare upstream 불변을 검증한다. transport는 통제 fixture이며 외부 MCP 서비스 실행 증거는 아니다.

## 모듈 범위와 근거

앱과 26개 패키지의 입력·권한·publication·복구·자원/표시 bound 경계를 대조했다. contracts/domain/config/protocol은 문법과 owner bound, storage/mail은 durable bytes와 receipt/arrival, git/review/lifecycle/reconcile은 accepted plan·현재 authority·CAS/종결 상태, broker/client/engine/extension/app은 실제 wire·dispatch·session boundary, native/platform-linux/platform-mac은 descriptor·scope·launch 경계, tui와 다섯 tool adapter 및 tool-runtime은 노출·metadata·contained I/O·scratch/child 수명을 확인했다. third-party vendor 내부를 전 파일 수작업 감사했다는 뜻은 아니다. vendor 변경은 선언된 splice에서 재생성하고 upstream snapshot과 bundle integrity 검사를 유지했다.

추가로 앱과 26개 패키지의 authored production 587개 파일 전체를 목록화하고, 552개 TypeScript와 28개 JSON을 parse하여 export·effect 경계·호출 owner를 분류했다. 나머지는 C/SQL/Swift/header/entitlements다. 전체 70,969줄에서 2,456개 경계 호출 위치를 추출한 시점의 per-file SHA-256과 분류는 `/tmp/oma-reaudit-2026-11-04/owned-review-index.json`에 보존한다. 이는 전체 소스의 정적 분류와 주요 경계 수동 검토이며, 모든 파일을 한 줄씩 수동 검토한 전수감사 완료 주장은 아니다. 의존성/vendor 내부, 실제 외부 모델 qualification, 실제 Mac 실행은 별도 범위다.

실제 SDK/Unix socket/Git/FS/native sandbox 시험, policy fixture, source-only candidate를 표에서 구분했다. Linux 전체 실행의 정확한 입력 identity와 최종 결과는 [validation](implementation/validation.md)에 기록한다. 테스트 통과를 모든 가능한 버그 부재나 외부 모델 qualification으로 확대하지 않는다.

## 전체 실행에서 확인한 기존 시험과의 통합

첫 전체 실행은 4,646개 중 74개 실패, 0 skip이며 실행 전후 15,822개 input bytes가 동일했다. 그중 65개는 새 status bound를 받지 못한 composition fixture, 1개는 검토한 내부 prepare/completion port hash, 2개는 명시적 큰 host subject bound가 없던 MIME fixture, 5개는 compact completion wire에서도 sessionPath 전송을 기대한 oracle이었다. 각 시험의 원래 encoding·frozen replay·원래 receipt 검증은 유지했다.

나머지 1개는 실제 MCP 회귀였다. shared scratch가 symlink일 때 새 per-engine 하위 경로도 거부됐다. 새 leaf를 private state의 직접 자식으로 두어 기존 shared alias를 조상으로 쓰거나 제거하지 않게 수정했다. 별도 adapter process 2개 시험에 legacy alias 대조도 추가했다. 최종 전체 재실행의 결과와 identity는 validation에 별도로 기록한다. 첫 실패 실행은 `/tmp/oma-reaudit-2026-11-04/full-1-run.json`과 `full-1.log`에 보존한다.

두 번째 전체 실행은 4,646 PASS / 0 FAIL / 0 SKIP / 0 cancel / 0 todo로 끝났다(1177.555초). 15,822개 입력의 전후 digest는 모두 `c74a32792c912fa69c5cbf15ee356d588d2eea47d3395bfd561671029cf60c19`이고 변경 파일은 0이다. `/tmp/oma-reaudit-2026-11-04/full-2-run.json`과 `full-2.log`에 보존한다. 이 실행 중 별도 재현으로 발견한 MCP timeout 수정은 이 PASS 이후 변경이므로 수정본 전체 재실행이 추가로 필요했다.

추가 MCP 수정 뒤 수행한 최종 전체 실행은 **4,647 PASS / 0 FAIL / 0 SKIP / 0 cancel / 0 todo**다(1174.305초, 555개 파일). 15,822개 입력의 실행 전후 digest는 모두 `447603abcf1856f6cf097d9fa0bf60c078e15c04a2a7430af6f89217fec27089`이며 changed=[]다. `/tmp/oma-reaudit-2026-11-04/full-3-run.json`, `full-3.log`, `full-3-before-inputs.json`, `full-3-after-inputs.json`에 고정 입력의 검증을 보존한다. 이 결과 문단과 validation 갱신은 실행 뒤 보고 출력이며 runtime/test source 변경은 아니다. 관련 선택 실행과 빌드·타입·패키지·vendor·구조 검사도 통과했다. 최종 집계와 제한은 validation에 연결한다.

## 추가 요청 — 경계 테스트 강화

기존 시험을 유지하고 7개 영역에 85개 사례를 추가했다. 단순 성공 여부에 더해 거부 전후 원래 bytes·외부 inode 내용·committed event 보존, 재시도·lock 반환·child 종료·실제 frame 크기를 확인한다.

| 영역 | 추가 사례 | 판정 근거 |
|---|---:|---|
| [설정 publication](../test/config-byte-boundaries.test.ts) | 30 | policyRevision 128B·bootstrap/recovery brief 8192B의 -1/정확/+1, ASCII·Hangul·emoji·combining 문자열, recovery key 0/1/81/82/83/96. 실제 설정 owner/loader, 거부 시 이전 bytes·directory 보존. 정책 revision만의 편집은 의미 변경이 아니므로 기존 revision을 보존하며, authored revision의 정확한 문자열은 import/reopen에서 확인한다. |
| [Session catalog frame](../test/session-resume-frames.test.mjs) | 14 | 9개는 실제 InteractiveChannel/socket에서 ASCII·UTF-8·JSON escape의 frame -1/정확/+1을 검사하고, 5개는 production frame producer의 빈 catalog 고정 header와 마지막 suffix를 직접 검사한다. 전체 JSON bytes·continuation·전체 directory 보존·거부 후 channel 생존을 검사한다. |
| [Engine settings](../test/user-files.test.mjs) | 6 | 실제 locked writer/reader에서 ASCII·UTF-8의 상한 -1/정확/+1, 이전 파일 보존 및 후속 lock 획득 |
| [Contained file](../packages/tool-files/test/files.test.mjs) | 16 | bounded UTF-8 read의 -1/정확/+1, append/truncate/관측 가능한 same-size rewrite, ancestor 교체 뒤 held inode 유지, timestamp가 같을 때 실제 hardlink 추가, conditional write의 read 전/후 alias 추가, inode 조건의 마지막 관측 전 alias 추가, text/inode 조건의 unlink/replace와 외부·대체 파일 내용 보존 |
| [Private key publication](../packages/tool-files/test/private-state.test.mjs) | 2 | 실제 Node child를 write 전/file fsync 직후에 SIGKILL. partial final 부재, 새 engine의 완성 key 생성·재사용·nlink=1, 다른 writer의 temporary와 외부 파일 보존 |
| [Arrival journal](../packages/storage/test/arrival-journal.test.mjs) | 7 | 같은 mtime의 same-size rewrite·inode 교체·외부 append·partial tail, write/file fsync/directory fsync 실패 뒤 원래 record 재관측과 flush·중복 방지. 실제 FS와 in-process fault callback이며 power loss 시험은 아니다. |
| [Tool metadata](../packages/tool-runtime/test/collaboration-groups.test.mjs) | 10 | Principal/Resident 각각 committed group의 description·nested schema·source kind/path·exposure 교체. 다음 provider 경계 거부, callable 비우기와 원래 event bytes 보존. 통제된 Pi context이며 live provider 시험은 아니다. |

추가 테스트가 다음 현재 결함을 재현해 수정했다.

- **BND-01:** 마지막 frame에도 continuation overhead를 적용해 실제 frame에 맞는 catalog와 suffix를 거부했다. 각 entry 크기를 한 번 계산하고 남은 suffix가 final envelope에 맞는지 판정한다. 기존 선형 partition owner를 유지한다.
- **BND-02:** 빈 catalog는 고정 header 크기를 검사하지 않아 긴 current 경로에서 frame 초과 응답을 만들었다. header도 실제 final JSON bytes로 검사해 bounded error를 반환한다. BND-01/02의 수정 전 새 사례는 14개 중 9개 FAIL이다.
- **BND-03:** bounded read/conditional write의 마지막 inode sample에 nlink가 없어, 새 hardlink와 기존 sample의 timestamp가 같은 경우 조건부 쓰기가 공유 inode에 적용됐다. 실제 compiled writer+FS에서 timestamp 관측만 통제한 별도 재현은 outside alias까지 `changed`가 됐다. 기존 sample에 nlink를 포함해 처음과 마지막에 단일 이름 조건을 유지하는지 검사한다. inode 조건 분기는 마지막 stat도 기존 ownedFile owner를 통해 검사하고, 이미 unlink된 nlink=0도 거부한다. 수정 전 read 1개·text conditional write 전/후 2개, inode conditional write의 alias 2개·unlink/replace 2개가 FAIL이다. 동일 timestamp의 모든 content race를 배제한다거나 마지막 관측 이후 외부 writer를 차단한다는 보장은 추가하지 않는다.

수정 전 원시 결과는 `/tmp/oma-boundary-tests-2026-11-04/session-before.tap`, `file-link-before.tap`, `hardlink-before.json`에 보존한다. 추가 inode 분기의 수정 전 재현은 `inode-link-before.tap`, `inode-hardlink-before.json`, `unlinked-before.tap`에도 보존한다. 첫 전체 실행 도중 별도 읽기 전용 probe로 이 분기를 확인했으므로 테스트 소유 scope만 중단했고, 중단 전후 입력 bytes는 동일했다. 이 실행은 full-1-aborted-run.json의 ABORTED_SUPERSEDED이며 PASS로 합산하지 않는다. 수정 후 집중/전체 검증 판정은 validation에 기록한다. 사용자의 OAuth 토큰이나 실제 credential 파일을 읽지 않았으며 key 시험은 임시 디렉터리의 test key만 사용했다.

추가 전체 검증의 완료된 두 실행은 각각 4,732개 중 4,731 PASS / 1 FAIL / 0 SKIP였고 입력 bytes는 두 번 모두 동일했다. 첫 실패는 기존 selected-create ready-commit의 목표 SIGKILL 전 native journal 초기화에서 openat2 EAGAIN이 발생한 것이다. 해당 파일의 별도 실행 5개와 기존 contained-open의 제한된 재시도·지속 오류 거부 시험 5개는 모두 통과했고, 다음 전체 실행에서는 그 ready-commit 사례도 통과했다. EAGAIN의 구체적 발생 원인은 확정하지 않았으며 native의 기존 8회 제한·실패 시 거부 정책은 바꾸지 않았다. 원시는 `full-2-failed-run.json`, `full-2-failed.log`, `selected-create-isolated.tap`, `native-open-retry.tap`에 보존한다.

다음 실패는 기존 contained search의 300ms window·3s heartbeat-only ceiling을 실제 child로 검증하는 sparse-progress 사례였다. 같은 fixture를 사용하는 별도 관측 probe는 진행 payload를 모두 반환했지만, 병렬 전체 실행에서는 마지막 payload 전에 결과가 끝났다. CPU 경쟁의 영향은 추론이며 원래 실패에는 상세 result 출력이 없어 확정하지 않는다. 실제 시간을 비교하는 이 파일은 기존 test-local의 host CPU 격리 정책에 따라 단독 실행으로 옮겼다. 300ms/400ms 값과 완료·정리 단언, 전체 556개 파일·native 필수 시험은 유지하며 실패 때 actual result도 출력한다. native-test-policy의 기존 실제 runner fixture가 이 파일의 격리 선언도 검사한다. `full-3-failed-run.json`, `full-3-failed.log`, `progress-under-load.json`에 이전 실패와 probe를 보존한다. 이 조정은 테스트 조건의 격리이며 제품 timeout을 완화하거나 실패한 사례를 제외한 것이 아니다.

최종 격리 구성을 포함한 전체 재실행은 **4,732 PASS / 0 FAIL / 0 SKIP / 0 cancel / 0 todo**다. 556개 파일을 모두 실행했다(단독 3개/44 tests, 병렬 553개/4,688 tests, concurrency 4). 15,823개 입력의 전후 digest는 `386a557f280e7fe3adff5a111ea910d7f08b10b8a27014656543012fe7687dfd`로 동일하며 changed=[]다. 입력 검증 포함 1151.775초였고 원시는 `/tmp/oma-boundary-tests-2026-11-04/full-4-run.json`, `full-4.log`, `full-4-before-inputs.json`, `full-4-after-inputs.json`에 보존한다. 집중 164개·별도 격리/runner 42개도 모두 통과했다. 최종 결과 문단과 validation은 실행 뒤 보고 출력이며 runtime/test/script source 변경은 아니다.

## macOS 별도 미완료

`packages/platform-mac/src/execution-launch.ts`의 `launchBlockedDarwin()`은 native launch-data channel 부재로 항상 UNSUPPORTED_PROFILE이다. 이 경로는 UNIMPLEMENTED다. macOS host가 없어 Mach/launchd/Seatbelt/Keychain 서명·실제 audit-session handoff·Darwin exclusive rename·제품 전체 실행은 NOT_RUN/UNVERIFIED다. 공통 코드와 recipe의 Linux 검사는 Mac 실행 PASS가 아니다. 이번 작업은 fresh admission 또는 외부 모델 A/B/C/cutover gate를 열지 않는다.
