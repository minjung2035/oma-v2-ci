# OMA v2 — 현재 인계

기준일: 2026-10-25. 활성 목표는 `docs/macos-native-spec.md` P0–P7을 따라 VM을 폐기하고
Linux/macOS 공통 native 실행을 실제 구현·검증하는 것이다. 이전 ‘문서 정리만 수행’ 범위를
사용자 구현 지시가 대체했다. 사용자는 legacy fallback을 남기지 말고, 기존 25개 workspace
의존 경계를 침범하지 말라고 명시했다. master 병합·배포는 하지 않는다.
25개는 고정 개수가 아니다. 기존 책임은 해당 모듈에서 수정하고 새 독립 책임은
25 + α개의 workspace로 분리하며, 공개 API·단방향 DAG·독립 build/test/설치를 유지한다.

## 작업 상태

- 2026-10-26 실제 경로 연결: 공통 ExecutionCoordinator + hash-chain journal + blocked
  namespace gate를 Resident·candidate·quarantine에 연결했다. systemd/path/journald와
  host relay production 경로를 제거했으며 Worker private argv의 owner는 Linux adapter다.
  lifecycle/reconcile는 실제 async 효과와 마지막 authority 확인을 기다린다. 새 create는 v3이며
  v2의 역사 plan·receipt를 native 완료로 다시 읽지 않는다. 로그 full spool은 별도 storage owner다.
- 새 관련 시험은 Linux 실제 kernel/bwrap에서 33/33 PASS·skip0·입력 변경0이다.
  `native-connected-fixed-{before,after}.json`과 `native-connected-fixed-real.log`에 원시 결과를
  보존했다. 전체 회귀 PASS가 아니다. 제거된 systemd API를 참조하는 root/type/module 시험의
  전환이 남았으며 root strict typecheck 첫 실행은 실패했다. 독립 workspace build는 26개가 성공했다.
- 실제 SIGKILL 시험에서 witness 게시 뒤 gate가 닫힌 init이 살아 남는 결함을 재현했다.
  DR54로 새 pidfd를 취득해 전체 identity 비교 후 종료하도록 수정했고 같은 지점의 실 프로세스
  생존→종료→journal 정산을 확인했다. witness 없는 opening은 여전히 unknown으로 보존·차단한다.
- 다음 작업: 실제 Resident/Broker 통합·backoff·로그 저장 회귀, 기존 시험의 native 전환,
  전체 정적/독립 설치/전체 Linux 회귀, source 고정 push 및 실제 Darwin CI 결과 확인.
  Darwin G-PROCESS/G-FILES/G-AUTH는 계속 OPEN이며 현재 Mac 제품 실행을 허용하지 않는다.
- 작업 브랜치: `work/macos-native-20261025`. 최초 기준 `d5716459`, 첫 Darwin probe
  `d80035f7`, 공통 primitive·Restic 초기 연결 `adf20331`, VM 제거 `de0c8212`, 파일 capability `762c1604`, 공통 Resident 조정 `13d60492`를 push했다.
- 시작 시 dirty 문서 변경은 보존·commit했고 원본 patch/untracked 사본도
  `/home/dev/oma-audit-artifacts/native-2026-10-25/`에 보존했다.
- VM 전용 App host/guest·entry·VZ·Swift VM helper·guest 자산·protocol은 실행 소스에서 제거했다.
  과거 VM 시험 원문은 `docs/archive/macos-vm-tests-2026-10-25/`에 보존하며 native PASS에 합산하지 않는다.
- 실행/출력 수명은 process, 저장·tar/inventory 검증·package staging은 storage,
  인증/정산은 broker/domain, OS primitive는 native/platform-*가 맡는다. 아래 모듈이 App을
  import하지 않는다. App은 API를 조립한다. 책임 없이 의존 허용 목록만 넓혀 통과시키지 않는다.
- G-PROCESS/G-FILES/G-AUTH는 OPEN이다. Darwin에서 NOTE_TRACK ENOTSUP(45), setsid
  후손 생존, mode-000 event pin EACCES(13)을 실제 CI에서 확인했다. static 지원 거절과
  일부 primitive 성공을 gate 통과로 처리하지 않는다.
- 실제 CI `40202613809`: Mac 26/15 common-runtime 각각 20/20, Ubuntu 19/19. 별도 gate job은 BLOCKED다.
- `0d471551`의 CI `40202936879`에서도 위 공통 결과를 재현했다. 실제 SCM_RIGHTS 인계 뒤
  connector 생존·종료 모두 kernel peer PID는 holder를 가리켰으나 G-AUTH 전체 증명은 아니다.
- `8c9ef61d`는 P2 관련 회귀192/192·독립 workspace 설치25/25 PASS다. CI `40207646347`의
  공통 runtime은 Mac 26/15 각각21/21·Ubuntu20/20, 세 OS input digest가 동일하다. 별도 gate는
  BLOCKED이며, queue한 connector 바이트를 읽기 전후 LOCAL_PEERPID가 holder인 반례를 보존했다.
  이후 CLI context의 held descriptor 연결은 별도 진행·검증한다.
- P3에서 COMMIT 뒤 materialization hint→Broker.hintWork→process CoalescedWake→Reconcile
  경로를 실제 연결했다. 활성 하나/pending 하나·owner async context·close/drain과 이전 scope
  confirmDead를 지킨다. 실제 직접 scope·공통 로그·Resident backoff 전체 연결은 여전히 남았다.
- 최신 `663adda3` CI는 Mac26/15 각각28/28·Ubuntu27/27, 독립 설치25/25 PASS다. 같은 입력의
  전체 local은3655개 중4개 fault/checkpoint 미도달로 실패했고 입력 변경0이다. 해당 실제
  native 경계로 옮긴 관련35/35만 별도 통과했으며 전체 PASS로 합성하지 않는다.
- 다음 P2 변경은 SDK 없는 파일 정책을 `@oma/tool-files`로 분리해 workspace를26개로 확장한다.
  tool-runtime·hashline·LSP는 새 공개 API로 연결하고 이전 contained-files export는 제거한다.
  Darwin 파일 primitive는 계속 미검증이며 효과 전에 거절한다. Linux 관련189/189·별도 SIGKILL17/17과
  독립 설치26/26을 입력 변경0으로 통과했다. 전체 local·Darwin 제품 지원 완료로 계산하지 않는다.
- `f042b159`는 전체 local3660/3660·skip0·입력 변경0, 실제 Mac26/15·Ubuntu 공통 CI 각각30/30을
  통과했다. 각 CI build26/26·동일 input이며 gate는 BLOCKED다. 사용자의 추가 지시로 OS 시험을
  확대한다. 새 실제 OS 경계11개와 독립 Darwin15개 관측의 검증은 위 전체 PASS와 별도다.
- 첫 전체 local은 FAIL52·SKIP70, 입력 변경0으로 끝났고 원시 실패를 보존했다. 유지되는
  회귀의 native fault/모듈 연결과 실제 bwrap 환경을 수리했다. 부분 시험 성공을 전체 PASS로
  표시하지 않는다. `982658de`의 수리 후 전체 local은 3640/3640 PASS, skip0·입력 변경0이다.
  이후 파일 handle 공통화 변경은 이 실행에 포함되지 않으며 별도 검증한다.
- 현재 Mac 제품 진입은 효과 전에 차단한다. Linux의 Resident wake/log·직접 실행·systemd/journald
  제거, sandbox scope proof, candidate/quarantine 연결, Darwin 파일 pin/auth, OS별 설치와
  최종 owner/규범/회귀 대조가 남았다. native 지원 완료가 아니다.

## 보존할 원칙

PRIORITY-0가 최상위다. accepted bytes/plan/terminal/receipt, captured T와 동일 Store gate,
현재 권한, unknown과 부재·죽음, 실제 FD/child/lock 수명을 구분한다. 기존 VM 데이터·native
history는 자동 변환·삭제하지 않는다. `docs/architecture.md`와 `implementation/review-notes.json`,
과거 검토 기록을 변경하지 않는다. 새/변경 코드는 NOT_REVIEWED다. 에이전트 위임은 사용하지 않는다.

## 환경과 증거

Node 경로는 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin`이다.
Mac 실기기는 없으며 `.github/workflows/native-runtime.yml`의 실제 macOS 26/15 runner를 쓴다.
로컬 개발 계정은 disposable service qualification 계정이 아니다. Linux 공통 회귀를 실제
service/cgroup·Darwin·provider·power-loss proof로 승격하지 않는다.

최근 실제 결과와 source/artifact 관계는 [validation](implementation/validation.md), 변경된 owner와
현재 단계는 [전환 기록](implementation/native-transition.md)이 소유한다. 재개 시 실제 working tree,
실행 중인 cell/session, CI job을 먼저 확인한다. 활성 목표를 작은 부분 작업으로 재정의하지 않는다.
