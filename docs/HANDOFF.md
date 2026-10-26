# OMA v2 — 현재 인계

기준일: 2026-10-25. 활성 목표는 `docs/macos-native-spec.md` P0–P7을 따라 VM을 폐기하고
Linux/macOS 공통 native 실행을 실제 구현·검증하는 것이다. 이전 ‘문서 정리만 수행’ 범위를
사용자 구현 지시가 대체했다. 사용자는 legacy fallback을 남기지 말고, 기존 25개 workspace
의존 경계를 침범하지 말라고 명시했다. master 병합·배포는 하지 않는다.
25개는 고정 개수가 아니다. 기존 책임은 해당 모듈에서 수정하고 새 독립 책임은
25 + α개의 workspace로 분리하며, 공개 API·단방향 DAG·독립 build/test/설치를 유지한다.

## 작업 상태

- 선택 native integration은 strict/noEmitOnError의42개 시험 파일로 확대했고 Linux359/359·skip0을 확인했다. 마지막 push의22개 목록은 실제 Linux CI197/197·skip0이었다. Root 전체 전환은 계속 진행 중이다.
- 작업 브랜치는 `work/macos-native-20261025`다. 최신 push `65233ca4`의 실제 CI `40244936163`에서 공통 Mac26/15·Ubuntu 각56/56, Ubuntu peer3/3·native33/33·integration197/197이 통과했다. 실제 ENOSPC까지 검증했고 원시 zip5개 SHA256·동일 input을 확인했다. Darwin 양쪽 각15개 관측은 계속 OPEN/BLOCKED다. 입력별 정본은 [validation](implementation/validation.md)이다.
- 후속 작업 트리에서 실제 Native Resident/Broker/Pi 통합25/25와 실제 Resident6개 포함 수명34/34가 고정 입력으로 통과했다. 가짜 unit 관측·수동 runner spawn을 제거하고 자동 생성 첫 실행·현재 incarnation·receipt까지 실제 owner로 검증했다. 공통 Resident close는 diagnostic completion도 join하며 App lifetime이 Store 종료 전에 호출한다.
- 기존 accepted fact/권한71/71, Worker38/38, durable SIGKILL46/46는 각각의 입력에서 통과했다. 과거 systemd 경계 원문은 archive에 보존하고 boot-execution/create-execution 경계는 새 이름으로 검증했다. 서로 다른 부분 PASS를 전체 PASS로 합산하지 않는다.
- 최신 root 전체 strict typecheck는8개 진단으로 FAIL이다(`native-root-after-expanded.log`). 모듈 검사도 audit/phase4 시험2개 파일의 삭제 import3건 FAIL이다. 후속 RPC/역사 plan25/25 시험 전환은 작업 트리에 있으며 아직 push하지 않았다. 독립 모듈 설치는26/26을 재검증했다. 제거된 unit/host relay API를 쓰는 기존 시험과 실제 물리 시험의 전환, 전체 정적·Linux 회귀·최종 규범 대조가 남았다. 선택 native integration의 strict compile/실행은 root 전체 PASS의 대체가 아니다.
- 새 선택 integration CI는 실제 Linux Native Resident/Pi·권한·receipt·SIGKILL 시험을 실행한다. 남은 root 시험 전환 뒤 후속 변경 push·실제 CI 결과 확인을 계속해야 한다. Mac 공통 정책 시험과 Darwin의 실제 gate 관측은 별도이며, Mac 제품 진입은 효과 전에 차단한다.
- 다음은 남은 unit 물리 시험을 archive/실제 native oracle로 전환하고 root type/module 전체 검사를 복구하는 일이다. 미사용 cgroup parser/export는 소비자 전환과 함께 제거했다. 역사 v2 plan 검증에 필요한 unit-name reader는 실행 fallback과 구분해 보존한다.
- witness 없는 opening, 기존 Linux state의 누락 execution journal, 미완료 historical v2 unit intent는 빈 초기 상태나 native 완료로 자동 전환하지 않는다. Darwin G-PROCESS/G-FILES/G-AUTH도 미해결이다. 재현 근거를 보존하고 독립 구현을 계속한다.
- 프로덕션 VM·systemd/path/journald·host relay fallback은 제거했다. 26번째 SDK-free `@oma/tool-files`를 포함한 공개 API·단방향 runtime/type DAG를 유지한다. 실행 조정은 process, 저장은 storage, 인증·정산은 broker/domain, OS primitive는 native/platform owner에 둔다.
- 최초 HEAD는 `d571645941e621eec6ccd91504cfbdc72389200d`다. 초기 dirty 사본은 `/home/dev/oma-audit-artifacts/native-2026-10-25/{initial.patch,initial-status.txt,initial-untracked/}`에 있다. Root README.md의 원래 사용자 변경은 보존하며 stage하지 않는다. master 병합·배포는 하지 않는다.

## 후속 작업 트리 검증과 바로 다음 작업

- P0/실제 격리56/56, 별도 P0/data66/66, 실제 CLI/동시 stream3/3, phase5 candidate·capability·batch11/11을 각각 입력 고정으로 확인했다. 원시 파일과 관계는 validation이 소유한다. 별도 입력의 PASS 합산은 금지한다.
- CandidateSetupStatus의 불완전 EOF 후 재호출 권한 개방을 수리했다. Principal·실행 이력 없는 recovered empty Resident를 exit0으로 표시하지 않는 projection도 공통 process/App 각 owner에서 수리했다. 후자 추가 뒤에도 선택359/359·실제 Linux35/35·공통58/58을 같은 고정 입력으로 재검증했다.
- 26개 workspace build와 독립 packed install26/26은 새 production 상태 표시 변경을 포함해 통과했다(7개 재컴파일). Frozen architecture/review-notes SHA256과 Root README 원래 dirty를 다시 확인했다.
- 확장42개 목록 첫 로컬 실행은 wrapper 없이 `/usr/bin/bwrap`을 찾지 못해 실제 OS FAIL/NOT_RUN이었다. 이 로그는 `native-expanded-integration-without-local-bwrap.log`에 보존했다. 그 뒤 실제 bwrap overlay mount에서 전체42개359/359·skip0을 확인했다. mock/skip/보장 완화로 통과시키지 않는다.
- audit.test.ts와 phase4.test.ts의 옛 manager 실행 경로가 아직 남았다. phase5/CLI/audit2는 현재 native 또는 명시적 정책 전용 fixture로 전환했다. Native script fixture는 실제 namespace/PID2/private socket을 쓰며 제품 Worker/Pi qualification은 별도 시나리오가 한다.
- source inventory/owner/trace/review-ledger를 갱신했고 확장 시험과 독립 설치도 같은 입력으로 확인했다. 후속 branch push/CI/raw artifact 확인과 audit/phase4 전환·전체 회귀를 계속하라. master 병합/배포는 하지 않는다. 에이전트 위임 금지.

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
