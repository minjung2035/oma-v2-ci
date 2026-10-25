# OMA v2 — 현재 인계

기준일: 2026-10-25. 활성 목표는 `docs/macos-native-spec.md` P0–P7을 따라 VM을 폐기하고
Linux/macOS 공통 native 실행을 실제 구현·검증하는 것이다. 이전 ‘문서 정리만 수행’ 범위를
사용자 구현 지시가 대체했다. 사용자는 legacy fallback을 남기지 말고, 기존 25개 workspace
의존 경계를 침범하지 말라고 명시했다. master 병합·배포는 하지 않는다.
25개는 고정 개수가 아니다. 기존 책임은 해당 모듈에서 수정하고 새 독립 책임은
25 + α개의 workspace로 분리하며, 공개 API·단방향 DAG·독립 build/test/설치를 유지한다.

## 작업 상태

- 선택 native integration을 strict/noEmitOnError로 컴파일해 단일 고정 입력에서180/180·skip0으로 통과했다. 검증된 통합 변경과 CI 실행 연결을 다음 checkpoint로 push하고 실제 CI 결과를 확인한다. Root 전체 전환은 계속 진행 중이다.
- 작업 브랜치는 `work/macos-native-20261025`다. 최신 push `6d8263eb`의 실제 CI `40239657753`는 공통 Mac26/15·Ubuntu 각54/54, Ubuntu peer3/3·native31/31이다. Darwin 양쪽은 각15개 실제 관측 후 OPEN/BLOCKED다. 원시 zip5개 SHA256과 전후 동일 input을 확인했다. 입력별 결과의 정본은 [validation](implementation/validation.md)이다.
- 후속 작업 트리에서 실제 Native Resident/Broker/Pi 통합25/25와 실제 Resident6개 포함 수명34/34가 고정 입력으로 통과했다. 가짜 unit 관측·수동 runner spawn을 제거하고 자동 생성 첫 실행·현재 incarnation·receipt까지 실제 owner로 검증했다. 공통 Resident close는 diagnostic completion도 join하며 App lifetime이 Store 종료 전에 호출한다.
- 기존 accepted fact/권한71/71, Worker38/38, durable SIGKILL46/46는 각각의 입력에서 통과했다. 과거 systemd 경계 원문은 archive에 보존하고 boot-execution/create-execution 경계는 새 이름으로 검증했다. 서로 다른 부분 PASS를 전체 PASS로 합산하지 않는다.
- 최신 root 전체 strict typecheck는79개 진단으로 FAIL이다. 제거된 unit/host relay API를 쓰는 기존 시험과 실제 물리 시험의 전환, 전체 정적·Linux 회귀·최종 규범 대조가 남았다. 선택 native integration의 strict compile/실행은 root 전체 PASS의 대체가 아니다.
- 새 선택 integration CI는 실제 Linux Native Resident/Pi·권한·receipt·SIGKILL 시험을 실행한다. 후속 변경 push·실제 CI 결과 확인을 계속해야 한다. Mac 공통 정책 시험과 Darwin의 실제 gate 관측은 별도이며, Mac 제품 진입은 효과 전에 차단한다.
- witness 없는 opening, 기존 Linux state의 누락 execution journal, 미완료 historical v2 unit intent는 빈 초기 상태나 native 완료로 자동 전환하지 않는다. Darwin G-PROCESS/G-FILES/G-AUTH도 미해결이다. 재현 근거를 보존하고 독립 구현을 계속한다.
- 프로덕션 VM·systemd/path/journald·host relay fallback은 제거했다. 26번째 SDK-free `@oma/tool-files`를 포함한 공개 API·단방향 runtime/type DAG를 유지한다. 실행 조정은 process, 저장은 storage, 인증·정산은 broker/domain, OS primitive는 native/platform owner에 둔다.
- 최초 HEAD는 `d571645941e621eec6ccd91504cfbdc72389200d`다. 초기 dirty 사본은 `/home/dev/oma-audit-artifacts/native-2026-10-25/{initial.patch,initial-status.txt,initial-untracked/}`에 있다. Root README.md의 원래 사용자 변경은 보존하며 stage하지 않는다. master 병합·배포는 하지 않는다.

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
