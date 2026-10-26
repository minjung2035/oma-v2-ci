# OMA v2 — 현재 인계

현재 목표는 `docs/macos-native-spec.md` P0–P7의 실제 native 구현·검증이다. 사용자 구현
지시가 이전 ‘문서 정리만’ 범위를 대체했다. VM/systemd 실행 fallback을 남기지 않는다.
기존25개는 고정 개수가 아니며 현재26개 workspace의 공개 API·단방향 runtime/type DAG·
독립 build/test/설치를 유지한다. master 병합·배포와 에이전트 위임은 하지 않는다.

## 현재 코드와 시험

- 작업 브랜치 `work/macos-native-20261025`, 원시 CI 결과를 확인한 push `159c66c88540dcd4dcfa6dfcd0d388da2196632d`. 후속 수정은 이 기록 뒤 작업 브랜치에 push하여 실제 CI를 다시 확인한다. 재개할 때 실제 HEAD와 최신 workflow부터 조회한다. 기존 Root README.md의 원래 dirty는 절대 stage하지 않는다.
- 공통 TS ExecutionCoordinator/ResidentRuntime/Supervisor·journal·저장/복구/인증 판정을 실제 Linux namespace/pidfd/private runner/byte sender와 연결했다. Native Worker/Pi·candidate·quarantine·entry/CLI가 실제로 실행된다. systemd/path/journald/host relay·미사용 cgroup parser/export의 production fallback은 제거했다.
- EOF poison 재진입·진단 close 경합을 수리했고 Principal/실행 이력 없는 empty Resident를 exit0 실행으로 표시하지 않는다. accepted bytes/plan/receipt/권한의 뜻은 보존한다. 역사 v2 unit intent reader는 의미 보존용이며 실행 fallback이 아니다.
- 고정 input `e05e5a95...`에서 선택42개 파일359/359·실제 Linux35/35·공통58/58·독립 packed install26/26 PASS, 각 전후 동일·skip0. 26개 workspace build도 PASS다. 실제 결과의 정본은 validation이며 서로 다른 부분 PASS를 전체 PASS로 합산하지 않는다.
- 후속 audit/phase4 전환 뒤 root 전체 strict 진단0·모듈 경계0건 PASS. 실제 native/CLI/entry/lifecycle30/30도 PASS. 작은 manifest child를 direct Node argv로 바꾼 뒤 phase5도11/11 PASS. 현재 선택 CI는44개 파일로 확대했으며 실제 CI의 전체 숫자는 후속 결과에서 확인해야 한다.

## 실제 CI와 재현

실제 `159c66c8` CI `40252199462`에서 Mac26/15·Ubuntu 공통 각58/58, Ubuntu peer3/3·
실제 native35/35 PASS. 확대 integration은355/359 FAIL·skip0이다. 세 OS input
`b9cada156294180f8e44963308ae06f8a7bd2bbf1c93f290f98b4f8d0e4781a0` 전후 동일.
Darwin 양쪽 각15개 실제 관측의 G-PROCESS/G-FILES/G-AUTH는 계속 OPEN/BLOCKED다.
원시 zip5개 SHA256·source/input을 확인했고 `ci-159c66c8/verified-summary.json`에 보존했다.

후속 수정은 실제 rg/fd-find/Corepack0.34.0 설치·버전/SHA 기록과 Python mail header의
RFC folding 공백 해석이다. rg 부재→실제 거절, 실제 rg 추가→같은 질의 성공을 재현했다.
fd 원인 가정은 재현되지 않았고 그 실패도 보존했다. 시험 제외·mock·보장 완화로 고치지 않는다.
현재 후속 변경의 branch push·실제 Mac/Linux CI 재실행·원시 결과 확인이 바로 다음 작업이다.

## 아직 남은 독립 작업

1. `verification-lanes.mjs`, `verify-lane.mjs`, `test-local.mjs`, `local-test-guard.mjs`와 systemd-test-policy/verification-policy·옛 systemd fixture/cleanup 시험을 현재 native 범위로 전환한다. 옛 systemd 전용 제외/opt-in/lane/requiredNames가 남아 전체 회귀가 아직 끝나지 않았다. manager 거절 guard를 풀거나 보장을 낮추지 않는다.
2. native가 연결된 root 전체 build·정적 architecture/trace·Linux 전체 회귀와 설치를 현재 입력에 대조한다. 현재 선택359/359나 root strict PASS는 전체 runtime PASS가 아니다.
3. source inventory/owner/trace/review ledger를 실제 source로 갱신하고 후속 작업 브랜치를 push하여 실제 CI를 확인한다. 새/변경 코드는 NOT_REVIEWED다.
4. witness 없는 opening, 기존 Linux state의 누락 execution journal, 미완료 historical v2 unit intent를 빈 상태나 native 완료로 자동 전환하지 않는다. Darwin 세 gate도 독립적으로 미해결이며 Mac 제품 진입은 효과 전에 차단한다.

## 보존·환경·원시 증거

PRIORITY-0가 최상위다. 과거 accepted fact와 현재 권한, 관측과 unknown/부재/죽음,
실제 FD/child/lock completion을 구분한다. `docs/architecture.md`, `implementation/review-notes.json`,
과거 authored review는 변경하지 않는다. 보호 SHA와 원래 README patch 일치를 다시 확인했다.

Node PATH는 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin`이다.
로컬 `/usr/bin/bwrap`은 없으므로 실제 pinned0.12 binary를 private overlay mount로 배치해
실제 Linux 시험을 실행한다. wrapper를 뺀 첫 확대 실행 FAIL/NOT_RUN도 원시 로그로 보존했다.
이 로컬 배치를 실제 service/cgroup·Darwin·provider·power-loss qualification으로 승격하지 않는다.
Mac 실기기는 없으며 GitHub macOS26/15를 실제로 검증한다.

최초 HEAD는 `d571645941e621eec6ccd91504cfbdc72389200d`이고 초기 dirty 사본은
`/home/dev/oma-audit-artifacts/native-2026-10-25/{initial.patch,initial-status.txt,initial-untracked/}`다.
원시 시험·CI·재현·현재 입력 관계도 같은 audit root에 있다. [validation](implementation/validation.md)과
[전환 기록](implementation/native-transition.md)이 구현·실행 범위의 정본이다. 재개 시 실제
working tree·실행 중 cell/session·최신 CI를 먼저 확인하고 활성 목표를 작은 부분 작업으로 줄이지 않는다.
