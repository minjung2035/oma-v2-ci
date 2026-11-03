# OMA 프로젝트 통합 결함 감사

상태: 감사·재현 당시 결과와 후속 수정의 구분 기록. 최초 감사 판정은 아래에 보존하며, 현재 수정·제외 판정은 [후속 수정](#후속-수정--2026-11-01)을 따른다. 전체 제품 qualification이나 출시 승인을 뜻하지 않는다.

이 문서는 판정·발생 조건·관측·한계를 자체 포함한다. `local://`, `agent://`, `history://` 식별자는 감사 세션 전용 근거이며 저장소 파일이나 공개 URL이 아니다. 원시 로그와 재현 스크립트는 해당 세션에 보존했고 이 Markdown에 별도 파일로 동봉하지 않았다.

## 감사 당시 판정 — 후속 정정 이전

26개 에이전트의 원문 보고서를 통합했다. 최초 33개 결함 주장을 중복 제거해 29개 유형으로 분류했다. 실행으로 실패 동작을 확인한 유형은 16개다. 그중 P1은 3개, P2는 6개, P3는 7개다. 실행 확인은 아래에 적은 API·제어된 경쟁·PTY 범위를 뜻하며, 16개 모두 전체 제품 end-to-end 실행을 했다는 뜻이 아니다.

| 감사 당시 분류 | 유형 수 |
|---|---:|
| 실행으로 실패 동작 확인 | 16 |
| 정적 근거만 확인 — 동적 미검증 | 5 |
| 추가 판단이 필요한 후보 | 3 |
| 설계·문서 계약 충돌 | 1 |
| 오탐 또는 제품 결함 집계에서 제외 | 4 |

## 범위와 방식

- packages/* 26개와 apps/oma 1개 중 platform-mac을 제외한 26개 workspace. 공통 모듈의 macOS 전용 구현도 제외했다.
- 각 workspace에 전담 1명과 다른 담당자의 독립 교차 검토 1회를 배정했다. 주력 모듈은 직접 의존·소비자와 App이 주입한 ledger/effect/port/callback 연결까지 추적하도록 했다.
- vendor 내부를 검증하지 않았다. OMA wrapper와 vendor의 입력·결과·오류·자원 수명 접점은 검토했다.
- 원문과 정적 결과를 그대로 승인하지 않았다. 중요 항목은 실제 생산 코드와 Store/Mail/Git, 실제 파일 I/O, 설치된 SDK·PTY로 재현했고 오탐을 제거했다.
- 일부 원문은 reviewer의 PR 관점으로 신규 변경만 결함으로 걸렀거나 secondary에서 일부 파일만 깊게 읽었다. 이 보고서는 그런 항목을 포함해 현재 tree의 발견 사항을 통합하지만, 모든 행/경로의 전수 검증이나 무결함을 주장하지 않는다.
- 감사·재현 단계에서는 제품 소스·시험·기존 문서·설정을 수정하지 않았다. 의존성 설치와 컴파일 산출물 생성, 격리된 임시 상태 및 감사 산출물만 사용했다. 이후 사용자의 요청으로 이 결과 보존 문서를 추가했다.

## 우선 수정할 P1

1. **AUD-01: 리뷰 도중 adopt 경쟁의 정상 상태를 STORE_CORRUPT로 처리한다.** 실제 데이터베이스와 Git에서 두 경로를 확인했다. attempt가 바뀐 뒤 오래된 key로 조회하면 현재 key에 pending integration이 존재해도 없다고 판정한다. 정책 revision adopt에서는 retry가 만든 v2 identity가 현재 검증 계약과 어긋나는 별도 경로도 있다. record는 성공 receipt를 주면서 내부 observer가 admission을 차단할 수 있다. 단순히 applyKey를 loop 안으로 옮기는 것만으로 두 번째 경로까지 해결됐다고 보면 안 된다.
2. **AUD-02: replyReferences=1에서 workers-only 답장 체인의 정상 입력이 손상으로 오분류된다.** 최대 1개의 References를 thread root로 덮어써 immediate parent가 사라지는 반면 validator는 parent 포함을 요구한다. transaction은 롤백하므로 영구 원장 오염은 없지만, broker observer가 건강한 Store의 새 acceptance를 차단한다. 재시작 전까지 정상 입력도 거절된다.
3. **AUD-03: 실제 interactive Principal 경로가 미시작 delivery 통지를 버린다.** SDK·PTY에서 통지는 터미널에만 나타나고 host RPC에 도달하지 않았다. delivery claim은 busy로 남고 두 번째 delivery는 BATCH_CONFLICT, Human 입력은 queue에 남았다. RPC 모드 대조군은 통지를 전달하고 claim을 반환했다. agent_start 누락은 별도로 정적 확인했으며 실제 모델 run으로 검증하지는 않았다.

## 전체 발견·판정 목록

### 실행으로 실패 동작 확인

#### AUD-01 — P1 — 리뷰 도중 adopt 경쟁으로 정상 원장을 손상으로 판정하고 admission 차단

- 위치: `packages/review/src/advancement.ts:187-263`, `packages/review/src/acceptance.ts:150-174`, `packages/protocol/src/operation-codec.ts:401-404`
- 발생 조건: 완료 공지 준비 중 revise/adopt로 attemptNumber가 증가하는 경쟁
- 판정·관측·한계: 실제 Store/Mail/Git/Review에서 두 경로 재현: (a) 현재 attempt2 row를 옛 attempt1 key로 조회하여 accepted merge integration missing, 실제 모듈의 observer가 gate를 corrupt로 전환; (b) policy-revision adopt 뒤 stale v2 integration identity가 validator와 어긋나 STORE_CORRUPT. 단순 applyKey 수정만으로 두 번째 경로까지 해결된다고 주장하면 안 됨. 실제 Git apply는 성공 가능한 정상 row임도 확인.
- 원문 담당: AuditReview, AuditLifecycle
- 실행 근거: module-audit-verification-AuditReview.md — `local://module-audit-verification-AuditReview.md`

#### AUD-02 — P1 — 합법적인 replyReferences=1 답장을 STORE_CORRUPT로 거절하고 전체 admission을 차단

- 위치: `packages/mail/src/index.ts:99-106`, `packages/domain/src/validation.ts:273-277`
- 발생 조건: workers-only 메일에 대한 답장의 답장, replyReferences=1
- 판정·관측·한계: 원문 보고서의 영구적인 원장 오염 주장은 반증됨. transaction은 롤백되며 정상 원장에 대한 프로세스 수명의 fence가 실제 문제.
- 원문 담당: AuditDomain
- 실행 근거: module-audit-verification-AuditDomain.md — `local://module-audit-verification-AuditDomain.md`

#### AUD-03 — P1 — interactive Principal이 미시작 delivery 통지를 전달하지 않아 메일과 Human 입력이 정체

- 위치: `packages/engine/src/interactive-extension.ts:96-104`, `packages/engine/src/interactive-events.ts:14-21`, `packages/engine/src/principal-session.ts:195-197`
- 발생 조건: Principal interactive 실행에서 /oma-deliver가 agent run 시작 전에 unavailable/invalid-batch로 반환
- 판정·관측·한계: 실제 SDK와 PTY에서 busy 유지, 두 번째 deliver의 BATCH_CONFLICT, Human 입력 정체를 확인. broker prepare/complete는 제어된 port; 실제 모델 추론은 미실행. agent_start 누락은 정적 동반 결함.
- 원문 담당: AuditEngine, AuditExtension, AuditHashline
- 실행 근거: module-audit-verification-AuditEngine.md — `local://module-audit-verification-AuditEngine.md`

#### AUD-05 — P2 — 심볼릭 링크 경로를 쓰면 project/state 물리적 중첩 검사가 우회됨

- 위치: `apps/oma/src/runtime/provision.ts:290-298`, `packages/domain/src/paths.ts:58-64`
- 발생 조건: HOME/XDG_DATA_HOME 등 stateRoot 상위 경로에 symlink가 있고 실제 state가 Git project 내부에 존재
- 판정·관측·한계: 동일 물리 경로의 canonical 표기는 UNSUPPORTED_PROFILE, alias 표기는 통과. 실제 개인 상태 유출을 별도로 실행한 것은 아님.
- 원문 담당: AuditDescriptors
- 실행 근거: module-audit-smoke-project-state-symlink.json — `local://module-audit-smoke-project-state-symlink.json`

#### AUD-06 — P2 — MCP private scratch의 권한 손상이 정리 작업을 중단시킴

- 위치: `packages/tool-files/src/private-state.ts:62-79`, `packages/tool-mcp/src/index.ts:336-342`
- 발생 조건: scratch 하위에 내용이 있는 0555 디렉터리 또는 0000 디렉터리
- 판정·관측·한계: 실제 removePrivateStateTree에서 EACCES와 부분 정리/잔류를 확인. 전체 engine 부팅 실패까지는 실행하지 않음.
- 원문 담당: AuditToolFiles
- 실행 근거: module-audit-verification-AuditStorage.md — `local://module-audit-verification-AuditStorage.md`

#### AUD-07 — P2 — oma-results에 이름이 유효한 디렉터리가 있으면 시작 수거가 EISDIR로 중단

- 위치: `packages/storage/src/preaccept-collection.ts:91-100`
- 발생 조건: 미수락 <uuid>.result 이름이 일반 파일 대신 디렉터리
- 판정·관측·한계: 실제 Store와 collector에서 EISDIR; 일반 파일 대조군은 정상 수거. broker startup 전파는 코드 경로로 확인.
- 원문 담당: AuditStorage
- 실행 근거: module-audit-verification-AuditStorage.md — `local://module-audit-verification-AuditStorage.md`

#### AUD-08 — P2 — 설정 검증을 통과한 작은 frameBytes로 정상 메일 배치가 전달 불가

- 위치: `packages/config/src/index.ts:278-299`, `packages/mail/src/batches.ts:99-105`, `packages/protocol/src/batch-view.ts:64-65`
- 발생 조건: 검증 가능한 frameBytes=768, mailBodyBytes=16384, subjectBytes=512와 일반 메일 6건
- 판정·관측·한계: 실제 메일 6건을 수락한 뒤 prepare가 INVALID_REQUEST; pending=6, preparedBatches=0. 원문 예시의 mailBodyBytes=8192는 설정 검증에서 거절되어 수정함.
- 원문 담당: AuditMail
- 실행 근거: module-audit-smoke-batch-notice-real-mail.json — `local://module-audit-smoke-batch-notice-real-mail.json`

#### AUD-09 — P2 — roster가 반환한 principal 커서를 같은 API가 거절

- 위치: `packages/protocol/src/status-page.ts:18-24`, `packages/domain/src/validation.ts:481-484`, `packages/tool-runtime/src/shared.ts:25-27`
- 발생 조건: status 페이지 마지막 행이 principal
- 판정·관측·한계: 유효 설정에서 next=principal 반환, 응답 decoder는 수락하지만 후속 after와 도구 actor guard는 거절.
- 원문 담당: AuditProtocol
- 실행 근거: module-audit-smoke-status-valid-config-cursor.json — `local://module-audit-smoke-status-valid-config-cursor.json`

#### AUD-10 — P3 — 조건부 파일 쓰기가 검증 중 추가된 바이트를 조용히 제거

- 위치: `packages/tool-files/src/index.ts:168-182`
- 발생 조건: text expectation 검증의 read와 truncate 사이에 다른 writer가 append
- 판정·관측·한계: 실제 파일 I/O에 제어된 interleaving을 넣어 abc→abc!→new, 거절 없음 확인. 무작위 동시성 빈도나 원자적 CAS 보장을 주장하지 않음.
- 원문 담당: AuditToolFiles
- 실행 근거: module-audit-smoke-conditional-write-append.json — `local://module-audit-smoke-conditional-write-append.json`

#### AUD-11 — P3 — 결과 페이지가 검증된 SHA-256과 다른 내용을 반환할 수 있음

- 위치: `packages/tool-files/src/results.ts:73-81`
- 발생 조건: 전체 파일 hash/fstat 검증 직후 페이지 read 전에 동일 inode 내용 변경
- 판정·관측·한계: 실제 파일 교체 I/O의 제어된 interleaving에서 원본 digest와 MUTATED! 페이지가 함께 반환됨. 동일 UID/동시 writer 조건.
- 원문 담당: AuditToolFiles
- 실행 근거: module-audit-smoke-result-page-integrity.json — `local://module-audit-smoke-result-page-integrity.json`

#### AUD-12 — P3 — 누적 session 목록이 /resume 제어 프레임을 넘으면 채널이 종료

- 위치: `apps/oma/src/runtime/session-catalog.ts:31-48`, `apps/oma/src/application/society-interaction.ts:90-99`, `packages/engine/src/interactive-channel.ts:29-38`
- 발생 조건: 개인 세션 기록이 많이 누적된 data root에서 session_dirs 전송
- 판정·관측·한계: 유효 birth 3200개로 275254-byte 이벤트 생성, 실제 TCP socket 기반 InteractiveChannel이 262144-byte 한도에서 종료. 전체 /resume UI는 미실행.
- 원문 담당: AuditTui
- 실행 근거: module-audit-smoke-session-resume-frame.json — `local://module-audit-smoke-session-resume-frame.json`

#### AUD-13 — 감사 당시 P2 — 후속 계약 대조에서 제품 결함 집계 제외

- 위치: `packages/review/src/preparation.ts:261-263`, `packages/review/src/acceptance.ts:69-70`, `packages/broker/src/peer-authenticator.ts:89`
- 발생 조건: Principal이 다른 reviewer의 vote를 invalidate하려 함
- 판정·관측·한계: 실제 ReviewModule에서 정상 actor 인증은 CAPABILITY_DENIED, 제어된 host 인증은 succeeded. 제품의 host endpoint는 배치 메서드만 제공한다는 경로는 정적 확인. 보안 우회가 아닌 기능 미연결.
- 후속 정정: 일반 Principal actor의 거절은 DR67과 모델 도구 표면 명세의 Host-only invalidation 계약에 맞다. Host 관리 표면이 없다는 사실을 일반 Principal에 권한을 부여할 근거로 사용할 수 없다. 역할만으로 허용하려던 수정은 반영하지 않았으며, Host-only 제한을 유지하는 회귀를 추가했다.
- 원문 담당: AuditContracts
- 실행 근거: module-audit-smoke-host-review-invalidation.json — `local://module-audit-smoke-host-review-invalidation.json`

#### AUD-14 — P3 — 90~96자 revise request에서 파생 .submit key가 CACHE_CORRUPT로 오분류

- 위치: `packages/client/src/index.ts:224-238`, `packages/client/src/index.ts:307-313`
- 발생 조건: 미게시 candidate에 review.revise, 90~96자 허용 request key
- 판정·관측·한계: 실제 Client/RequestCache, 제어된 git.known 응답으로 CACHE_CORRUPT/exit3 재현. 원장 손상이 아님.
- 원문 담당: AuditClient, AuditEngine
- 실행 근거: module-audit-smoke-long-revise-key.json — `local://module-audit-smoke-long-revise-key.json`

#### AUD-15 — P3 — Reconcile lane의 실패가 뒤늦은 join에서 유실됨

- 위치: `packages/reconcile/src/lane.ts:13-19`
- 발생 조건: failure callback도 throw하고 lane이 join보다 먼저 settle
- 판정·관측·한계: 실제 ReconcileLane에서 failure=1인데 join은 resolved. 전체 broker 로그 경로는 미실행; corruption fence 자체는 유지됨.
- 원문 담당: AuditReconcile
- 실행 근거: module-audit-smoke-reconcile-lost-join.json — `local://module-audit-smoke-reconcile-lost-join.json`

#### AUD-16 — P3 — 패키지 rollback이 기록한 파일 mode를 umask 때문에 정확히 복원하지 못함

- 위치: `packages/storage/src/package-replacement.ts:108`, `packages/storage/src/durable-fs.ts:160-165`
- 발생 조건: 0644 preimage를 umask 077 아래 rollback
- 판정·관측·한계: 실제 rollback에서 bytes는 같고 mode는 0600. umask 022 대조군은 mode도 동일.
- 원문 담당: AuditReconcile
- 실행 근거: module-audit-verification-AuditStorage.md — `local://module-audit-verification-AuditStorage.md`

#### AUD-17 — P3 — 실행 불가능한 첫 PATH 후보가 뒤의 정상 실행 파일을 가리고 Node를 abort

- 위치: `packages/process/src/replace.ts:14-25`, `packages/git/src/candidate-check.ts:106`
- 발생 조건: 첫 PATH 디렉터리에 명령과 같은 이름의 디렉터리 등 X_OK이지만 exec 불가능한 항목
- 판정·관측·한계: Node26 실제 execve에서 beforeExec 뒤 SIGABRT/EACCES, 뒤 정상 echo는 실행되지 않음. 원문 raw JS throw 주장은 실제 관측으로 수정; try/catch만으로 고칠 수 있다고 주장하지 않음.
- 원문 담당: AuditProcess
- 실행 근거: module-audit-smoke-path-candidate-exec.json — `local://module-audit-smoke-path-candidate-exec.json`

### 정적 근거만 확인 — 동적 미검증

#### AUD-18 — P3 — MCP shutdown scratch 정리가 stdio child 종료보다 먼저 등록됨

- 위치: `packages/tool-mcp/src/index.ts:402-409`
- 발생 조건: stdio MCP 서버가 연결된 session shutdown
- 판정·관측·한계: 등록 순서와 SDK의 순차 dispatch 계약을 대조. 실제 살아 있는 MCP child와 ENOTEMPTY/재생성 경쟁은 미재현.
- 원문 담당: AuditMcp
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-19 — P3 — 동시 bundle import의 busy 상태를 RUN_TERMINATION_UNKNOWN으로 표현

- 위치: `packages/git/src/quarantine.ts:49-80`, `packages/process/src/owned-execution.ts:155-210`
- 발생 조건: 서로 다른 accepted git.submit이 같은 quarantine native slot을 동시에 사용
- 판정·관측·한계: 예상 결과는 retry-same-key transient busy여야 한다는 오류 의미 불일치. 실제 confined import 병렬 실행은 미실행.
- 원문 담당: AuditGit
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-20 — P3 — execution recovery가 lock 관측 실패를 live owner로 단정

- 위치: `packages/storage/src/execution-recovery.ts:100-101`
- 발생 조건: flock 결과가 contended가 아닌 failed (ENOLCK/EINTR 등)
- 판정·관측·한계: kind !== held 분기에서 관측 실패와 소유권 점유를 합침. 실제 lock 실패를 유도하지 않았으며 거절은 fail-closed로 유지됨.
- 원문 담당: AuditToolFiles
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-21 — P3 — vendor 무결성 실패의 원인이 먼저 실행되는 tool-surface 거절에 가려짐

- 위치: `packages/tool-web/src/index.ts:140-147`, `packages/extension/src/index.ts:61-108`
- 발생 조건: tool surface가 활성인 엔진에서 web bundle 검증 실패
- 판정·관측·한계: 세션 시작 handler 순서상 integrity reason 전 process.exit 가능. 보안 fail-closed는 유지; 실제 변조 bundle로 엔진 실행은 미실행.
- 원문 담당: AuditWeb
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-29 — P3 — principal.detach가 registry의 noParams 검사를 호출하지 않음

- 위치: `packages/broker/src/principal-endpoint.ts:296-303`, `packages/protocol/src/methods.ts:386-392`
- 발생 조건: 이미 attach된 Principal이 detach params에 추가 필드 전달
- 판정·관측·한계: 코드상 envelope만 검사. 자신의 연결만 detach할 수 있어 영향 제한; 실제 endpoint frame smoke는 미실행.
- 원문 담당: AuditContracts
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

### 추가 판단이 필요한 후보

#### AUD-22 — P3 — inline installation.libdir가 operations bundle보다 느슨하게 검증됨

- 위치: `packages/config/src/index.ts:200-205`, `packages/config/src/operations.ts:337-340`
- 발생 조건: 상대/비정규화 libdir가 들어간 inline 설정
- 판정·관측·한계: validator 수락은 확인했지만 실제 세션 파생 설정이 libdir를 덮어쓰므로 제품 장애까지 입증되지 않음. 확정 기능 결함 수에서 제외.
- 원문 담당: AuditConfig
- 실행 근거: module-audit-smoke-inline-libdir.json — `local://module-audit-smoke-inline-libdir.json`

#### AUD-23 — P3 — 같은 의미의 설정 generation에 대한 bytes identity 재검사 공백 의심

- 위치: `packages/config/src/generations.ts:333-455`
- 발생 조건: 설정 lock을 무시하는 동일 UID writer가 게시된 generation을 manifest commit 전에 변경
- 판정·관측·한계: 의미가 같은 추가 파일/경로 별칭의 소비자 피해가 입증되지 않음. 고유 generation bytes 계약과 실제 영향 추가 판단 필요.
- 원문 담당: AuditConfig
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-24 — P2 — openat2 BENEATH race의 EAGAIN 재시도가 현재 tree에 없음

- 위치: `packages/native/src/files.ts:118-124`
- 발생 조건: 실제 kernel path resolution 중 동시 rename race
- 판정·관측·한계: 현재 코드는 fail-closed. 다른 checkout에 수정이 있다는 보고만으로 이 tree의 재현/계약을 확정하지 않음; 기존 알려진 native 한계로 보존.
- 원문 담당: AuditNative
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

### 설계·문서 계약 충돌

#### AUD-25 — P3 — /society slot gate의 미사용 코드와 DR28/MODE-005 사이 계약 충돌

- 위치: `apps/oma/src/runtime/society-slot.ts:36-63`, `apps/oma/src/entry/personal-host.ts:76-86`
- 발생 조건: Personal에서 /society 전환
- 판정·관측·한계: DR28 addendum은 고정 slot gate, 현 MODE-005는 새 society 재진입을 요구. 현 코드가 어떤 계약을 따라야 할지 결정되지 않아 실행 결함으로 단정하지 않음.
- 원문 담당: AuditApp
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

### 오탐 또는 제품 결함 집계에서 제외

#### AUD-04 — P2 — 일시적인 review 준비 경쟁을 durable preparation-failed로 확정

- 위치: `packages/review/src/advancement.ts:345-368`
- 발생 조건: broker-derived 준비 fact의 await 중 다른 리뷰 사실이 수락되어 BROKER_UNAVAILABLE 발생
- 판정·관측·한계: 두 스케줄의 실제 실행에서 BROKER_UNAVAILABLE로 반환되고 preparation-failed 행은 없음; 다음 advance는 정상 통합. failure fact 자체도 assertUnchanged에 거절되어 원문 주장은 반증됨. provenance가 실제로 바뀐 비일시적 INTEGRATION_CONDITIONS는 의도된 실패로 구분.
- 원문 담당: AuditLifecycle
- 실행 근거: module-audit-verification-AuditReview.md — `local://module-audit-verification-AuditReview.md`

#### AUD-26 — P3 — web 등록 순서를 runtime에서 비교하지 않음

- 위치: `packages/tool-web/src/index.ts:168-176`
- 발생 조건: vendor가 동일 4개 도구의 등록 순서만 바꿈
- 판정·관측·한계: 현재 사용자 관측 피해가 없고 근거가 구현 주석/우연한 순서뿐. 기능 결함에서 제외.
- 원문 담당: AuditTui
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-27 — P3 — webFacadeDropped가 항상 빈 배열

- 위치: `packages/tool-web/src/index.ts:77-80`
- 발생 조건: 진단 export/테스트 단언 검토
- 판정·관측·한계: 현재 commands/shortcuts forwarding은 의도된 기능이고 진단 배열은 실 소비자 없음. dead-code/test 품질 항목이지 제품 결함으로 집계하지 않음.
- 원문 담당: AuditTui
- 실행 근거: 없음. 이 항목은 위 분류대로 정적 근거/후보/설계 충돌/제외이며 실행 확정 결함으로 세지 않았다.

#### AUD-28 — P2 — grep context separator가 출력과 limit를 깨뜨린다는 주장

- 위치: `packages/tool-runtime/src/contained-search.ts:168-203`
- 발생 조건: context=1의 떨어진 match 그룹, limit=1 또는 2
- 판정·관측·한계: 실제 searchWorkspace에서 올바른 줄/그룹과 limitReached=true. emitHeader(end>=0)가 완결된 -- 줄을 flush하므로 원문 추론이 틀림.
- 원문 담당: AuditToolRuntime
- 실행 근거: module-audit-smoke-grep-context-limit.json — `local://module-audit-smoke-grep-context-limit.json`

## 모듈별 전담·교차 검토 인덱스

원문은 독립 검토 당시 내용을 보존한 세션 전용 JSON을 기준으로 식별한다. `agent://` 주소는 후속 재현 보고서로 바뀔 수 있으므로 원본과 후속을 구분한다. 아래 표는 전담·교차 배정과 보고서 반환을 기록하며 runtime qualification 완료를 뜻하지 않는다.

| 주력 workspace | 교차 workspace | 담당 | 원문 |
|---|---|---|---|
| app | contracts | AuditApp | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditApp&raw=true` |
| storage | tool-files | AuditStorage | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditStorage&raw=true` |
| domain | lifecycle | AuditDomain | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditDomain&raw=true` |
| engine | client | AuditEngine | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditEngine&raw=true` |
| git | reconcile | AuditGit | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditGit&raw=true` |
| tui | tool-web | AuditTui | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditTui&raw=true` |
| protocol | tool-mcp | AuditProtocol | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditProtocol&raw=true` |
| broker | mail | AuditBroker | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditBroker&raw=true` |
| native | file-descriptors | AuditNative | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditNative&raw=true` |
| review | tool-hashline | AuditReview | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditReview&raw=true` |
| process | tool-lsp | AuditProcess | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditProcess&raw=true` |
| config | tool-runtime | AuditConfig | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditConfig&raw=true` |
| extension | platform-linux | AuditExtension | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditExtension&raw=true` |
| mail | config | AuditMail | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditMail&raw=true` |
| tool-runtime | extension | AuditToolRuntime | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditToolRuntime&raw=true` |
| lifecycle | review | AuditLifecycle | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditLifecycle&raw=true` |
| platform-linux | process | AuditLinux | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditLinux&raw=true` |
| client | tui | AuditClient | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditClient&raw=true` |
| contracts | broker | AuditContracts | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditContracts&raw=true` |
| tool-files | native | AuditToolFiles | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditToolFiles&raw=true` |
| tool-lsp | git | AuditLsp | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditLsp&raw=true` |
| tool-hashline | engine | AuditHashline | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditHashline&raw=true` |
| tool-mcp | domain | AuditMcp | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditMcp&raw=true` |
| reconcile | storage | AuditReconcile | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditReconcile&raw=true` |
| tool-web | app | AuditWeb | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditWeb&raw=true` |
| file-descriptors | protocol | AuditDescriptors | 정적 보고서 — `local://module-audit-original-reports.json?q=.AuditDescriptors&raw=true` |

## 실행 근거와 보존 파일

- 원문 보고서 26개 — `local://module-audit-original-reports.json`
- 29개 유형의 구조화된 판정 — `local://module-audit-issue-registry.json`
- parent smoke 소스·stdout·stderr·종료 상태 — `local://module-audit-parent-smoke-evidence.json`
- 후속 재현 스크립트·PTY 및 기타 원시 로그 — `local://module-audit-reproduction-artifacts.json`
- Review 재현/반증 — `local://module-audit-verification-AuditReview.md`
- Mail 재현/원문 수정 — `local://module-audit-verification-AuditDomain.md`
- 실제 interactive SDK·PTY 재현 — `local://module-audit-verification-AuditEngine.md`
- Storage/정리/권한 재현 — `local://module-audit-verification-AuditStorage.md`
- protocol의 최초 본문은 최신 보충 보고서와 별도로 이력 890–936행 — `history://AuditProtocol:890-936:raw`에 보존되어 있다.

## 검증 범위와 제외

- Node v26.0.0. `node scripts/build-workspaces.mjs @oma/app`: 27/27 workspace 재컴파일 성공. 빌드에 platform-mac이 포함된 것은 공통 의존성 컴파일이며 macOS 검증이 아니다.
- `node node_modules/typescript/bin/tsc -p tsconfig.build.json`: exit 0, root fixture JS emit 성공. 시험 파일을 컴파일했지만 전체 시험 suite를 실행한 것은 아니다.
- 실제 `oma --help`: exit 0 및 usage 출력 확인. 첫 사전 실행은 dist 미생성으로 MODULE_NOT_FOUND였고, 빌드 후 실제 entrypoint를 실행했다. 이것을 제품 결함으로 집계하지 않았다.
- 전체 test suite/전체 architecture qualification/native confined Worker launch/host 재부팅/제품의 실제 provider 추론은 실행하지 않았다. macOS·vendor 내부는 요청대로 제외했다.
- PTY 검증은 실제 SDK/engine/PrincipalSession/PrincipalDelivery를 사용했지만 broker prepare/complete port는 제어했고 실제 provider run은 하지 않았다.
- 파일 race 두 항목은 실제 파일에 대한 syscall 사이의 제어된 interleaving으로 검증했다. 임의 부하에서의 빈도 또는 모든 writer에 대한 원자적 CAS 보장을 측정한 것이 아니다.
- 원문 감사의 모든 주장을 자동으로 승인하지 않았다. AUD-04/RV-02와 AUD-28/grep는 실행 반증; AUD-26/27은 현재 소비자 피해가 없는 순서·진단 배열 주장으로 제외했다.

## 입력 일치

최초 감사 입력과 재현 당시 입력은 15764개 파일에서 동일했다. SHA-256 기반 검증 입력 digest: `eb1fec60f5f6e731d91623f2a77370d82ccfe46e489d1f3b9e7bd89528ededbd`. 해당 시점의 변경 입력 목록은 `[]`이며, 이 문서 자체의 추가는 그 이후의 문서 변경이다. 입력 결박 근거 — `local://module-audit-source-binding.json`. 입력 동일성은 runtime 전체 통과를 뜻하지 않는다.

## 수정 순서 제안

이 절은 감사 당시의 우선순위 제안이다. P1 세 유형의 정상 상태/오류/claim 의미부터 수정하고 두 경쟁 및 interactive 경로로 재검증한다. AUD-13의 일반 Principal 호출 기대는 후속 계약 대조에서 제외했으므로 권한을 넓혀 해결하지 않는다. 실제 반영 결과는 다음 절을 따른다.

## 후속 수정 — 2026-11-01

사용자 승인 후 14개 River DeepSeek V4.1 Flash/max 수정 담당과 parent 통합으로
19개 workspace의 코드를 수정했다. 실제 응답 provider/model과 max 설정을 기록에서
확인했으며 모델 설정만으로 실행 모델을 추정하지 않았다. macOS 구현과 vendor
바이트는 수정하지 않았다. 기존 사용자 WIP는 보존했다.

현재 판정은 **23개 결함 수정, 1개 설계 충돌의 obsolete 경로 제거, 5개 제외**다.
아래는 구현·동작별 근거 인덱스이며 전체 suite나 native qualification을 뜻하지 않는다.
최신 명령·수치·입력·미실행 범위는 [validation](implementation/validation.md)이 소유한다.

### 수정 반영

| ID | 주 소유 모듈 | 반영한 동작과 회귀 |
|---|---|---|
| AUD-01 | review | `createIntegration`이 같은 iteration의 attempt로 key를 접수·조회한다. 바뀐 scope에 무효한 v2 plan을 만들지 않고 v3 준비로 넘긴다. 실제 Store/Git의 provenance·policy adopt 경쟁, 새 수락과 admission 유지 회귀를 보강했다. |
| AUD-02 | mail | References 한 칸에서는 immediate parent를, 두 칸 이상에서는 root와 최신 suffix를 보존한다. workers-only 답장의 답장과 후속 수락을 실제 Store에서 확인한다. validator는 약화하지 않았다. |
| AUD-03 | engine | delivery protocol notice와 `agent_start`가 실제 interactive host 채널로 간다. 실제 SDK·PTY에서 claim 반환, queued Human 진행, 다음 delivery 허용, 완료 receipt 미생성을 관측했다. |
| AUD-05 | app | project/state 검사가 symlink를 푼 physical path와 미생성 leaf의 실제 조상을 함께 본다. alias·양방향 중첩·dangling link 거절과 쓰기 전 차단을 확인한다. |
| AUD-06 | tool-files | private scratch 삭제가 held capability 안의 소유 directory 권한을 복구한다. 0000/0555 등의 mode, 외부 symlink target·조상 보존, 반복 정리를 검사한다. Darwin의 별도 한계는 확대 검증하지 않았다. |
| AUD-07 | storage | `<uuid>.result`가 일반 파일인지 먼저 확인한다. directory·symlink는 이유와 함께 보존하고 전체 수거를 계속하며 정상 파일은 수거한다. 실제 Store·collector로 검사한다. |
| AUD-08 | mail / protocol / config | complete escaped view의 최초·재안내가 모두 frame에 들도록 manifest를 page하고 notice metadata 생략을 표시한다. 원문·index·manifest는 자르지 않는다. codec floor와 작은 frame의 실제 메일 전달·재안내·두 class fairness를 검사한다. |
| AUD-09 | domain / tool-runtime / extension | status의 row selector와 cursor만 Principal row를 허용한다. 실제 Store/Views/dispatcher와 등록 도구에서 다음 page를 소비하며 Worker 전용 control/log 거절은 유지한다. |
| AUD-10 | tool-files | text expectation의 read 전후와 truncate 직전 descriptor sample을 대조한다. 검증 중 append는 거절하고 `abc!`를 보존한다. 마지막 sample 이후 비협조 writer에 대한 원자적 CAS를 주장하지 않는다. |
| AUD-11 | tool-files | hash를 계산한 동일 read에서 page bytes를 보관한다. 실제 interleaving에서 racer가 파일을 바꿔도 반환 page는 검증한 원본과 같은 digest다. |
| AUD-12 | app / engine | 동일 request id의 bounded `session_dirs` frame들을 `more`가 끝날 때까지 누적한다. 각 frame의 로컬 write 완료를 기다려 느린 수신자의 queued-byte bound도 지킨다. 단순 event-loop yield만으로는 10만 경로·일시 정지 TCP 수신자에서 채널 종료가 재현되어 백프레셔 대기로 보강했다. 실제 birth 3200개·compiled producer/consumer·TCP의 전체 수신과 oversized-entry의 명시적 오류도 검사한다. |
| AUD-14 | client / app | 긴 원래 key의 publication key를 유효 길이로 결정적으로 파생하고 receipt가 그 정확한 key를 사용한다. 96자·prefix 공유·same-key retry와 실제 Git candidate/Client/cache 시나리오를 확인한다. 해시 충돌 불가능이 아니라 collision resistance다. |
| AUD-15 | reconcile | 완료된 lane의 최신 결과를 late join/close까지 유지한다. shutdown은 모든 join을 기다리고 Resident 종료도 시도하며 최초 오류와 cleanup 오류를 보존한다. |
| AUD-16 | storage | rollback이 열린 복원 파일에 기록된 mode를 fsync 전에 적용한다. 별도 child의 umask 077에서 bytes/mode를 복원하고 일반 생성의 umask 동작은 유지한다. |
| AUD-17 | process | PATH 후보가 regular file이며 X_OK인지 확인한 뒤 한 번만 release/exec한다. 실제 Node26 child에서 directory shadow 다음 명령이 실행되고 SIGABRT가 없음을 관측했다. kernel 실행 형식을 흉내 내는 parser는 채택하지 않았다. |
| AUD-18 | tool-mcp | scratch 정리를 adapter shutdown hook 뒤에 등록한다. 실제 stdio child의 정상 close 뒤 정리되고 late-write 잔류가 없음을 관측했다. vendor의 SIGKILL fallback은 별도 미확인 종료 경계다. |
| AUD-19 | git / process / app | 실행 slot을 dead/busy/unknown으로 구분한다. 알려진 concurrent owner만 busy/same-key이며 미확인 종료와 unretired reservation의 fence·staging 보존은 유지한다. |
| AUD-20 | storage | flock의 failed와 contended를 구분한다. 관측 실패는 소유권 사실을 만들지 않고, 실제 contention만 기존 structured busy 사유를 제공한다. 둘 다 ticket 없이 fail-closed하며 journal bytes를 보존한다. |
| AUD-21 | tool-web / extension | 거절된 bundle의 원인 진단을 surface 거절에 가리지 않게 하고 bundle startup hook을 먼저 등록한다. 변조 copy에서 exit·미평가·도구 미등록, 정상 bundle에서 기존 표면을 검사한다. vendor 바이트는 바꾸지 않았다. |
| AUD-22 | config | authored inline libdir를 runtime과 같은 normalized absolute 규칙으로 쓰기 전에 검증한다. 실제 project settings seed가 잘못된 설정 파일을 남기지 않음을 관측했다. 정상 trailing slash는 유지한다. |
| AUD-23 | config | manifest rename 직전에 게시된 generation의 전체 tree/bytes identity를 다시 확인한다. extra file·의미가 같은 role bytes 변경은 이전 manifest를 유지한 채 거절하고 정상 후속 commit·collection은 유지한다. |
| AUD-24 | native | Linux openat2의 EAGAIN만 동일 held root/name/containment flags로 유한 재시도한다. 지속 실패·다른 errno·symlink/escape는 계속 거절한다. 제어된 syscall 주입과 실제 kernel path를 구분하며 기존 CI 실패의 정확한 race 원인은 추정으로 남긴다. |
| AUD-29 | broker | `principal.detach`가 registry의 noParams 검사도 호출한다. 추가 params 거절 후에도 attach가 유지되고 정상 detach는 성공하는 회귀를 보강했다. |

### 설계 충돌과 제외의 최종 처리

- **AUD-25:** MODE-005의 fresh-mode 재진입이 현재 계약이다. 사용하지 않는
  `society-slot.ts`, 죽은 `society` handoff와 그 우연한 구현을 고정한 시험을 제거했다.
  DR28의 역사 기록을 현재 코드에 맞춰 다시 쓰지 않았다.
- **AUD-13:** 일반 Principal actor의 invalidation은 DR67상 의도적으로 거절한다.
  Host-only 권한을 role-only로 바꾸지 않았고 새 Host RPC나 모델 action도 추가하지 않았다.
  실제 Host 관리 UI/CLI를 새로 제공할지는 별도 명시적 설계 결정이다.
- **AUD-04 / AUD-28:** 원래 실행 반증을 유지한다.
- **AUD-26 / AUD-27:** 등록 순서·빈 진단 배열의 구현 취향을 제품 결함으로 되살리지 않았다.

### 검증 해석과 남는 한계

- 부모 통합 검증은 새로 빌드한 코드로 수행한다. 에이전트의 이전 `/tmp` transpile·suite copy·
  시뮬레이션은 source-level 보조 근거이며 rebuilt-product 실행 증거로 합산하지 않는다.
- 첫 통합 선택 실행은 일부 새 시험의 VM realm 비교와 loader 경로 때문에 실패했다.
  realm prototype을 제품 계약으로 고정하지 않고 소비자 값을 검사하도록 수정했다.
  단순 전달/mock echo 시험 두 개는 재고정하지 않고 제거했으며, 실제 claim/queue
  상태 전이 회귀와 SDK·PTY 스모크를 유지했다.
- 실제 confined Worker/Git launch는 `/usr/bin/bwrap` 부재로 미실행이고 cloc 측정 도구도
  없다. 이 제약을 skip/통과로 숨기거나 전체 suite PASS로 표시하지 않는다.
- 실제 provider 추론, macOS qualification, 호스트 재부팅 및 power-loss 검증은 수행하지 않았다.
  MCP upstream 강제 kill의 종료 대기와 Node execve의 kernel-owned format/mount/TOCTOU
  거절은 이번 수정의 증명 범위가 아니다.
- 이 문서의 앞부분 line reference와 최초 input digest는 감사 당시 snapshot에 대한 것이다.
  수정 후 소스의 line 번호나 전체 검증 digest로 재사용하지 않는다.

