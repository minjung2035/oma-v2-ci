# OMA v2 — 현재 인계

기준일: 2026-10-25. 활성 목표는 `docs/macos-native-spec.md` P0–P7을 따라 VM을 폐기하고
Linux/macOS 공통 native 실행을 실제 구현·검증하는 것이다. 이전 ‘문서 정리만 수행’ 범위를
사용자 구현 지시가 대체했다. 사용자는 legacy fallback을 남기지 말고, 기존 25개 workspace
의존 경계를 침범하지 말라고 명시했다. master 병합·배포는 하지 않는다.

## 작업 상태

- 작업 브랜치: `work/macos-native-20261025`. 최초 기준 `d5716459`, 첫 Darwin probe
  `d80035f7`, 공통 primitive·Restic 초기 연결 `adf20331`, VM 제거 `de0c8212`, 파일 capability `762c1604`, 공통 Resident 조정 `13d60492`를 push했다.
- 시작 시 dirty 문서 변경은 보존·commit했고 원본 patch/untracked 사본도
  `/home/dev/oma-audit-artifacts/native-2026-10-25/`에 보존했다.
- VM 전용 App host/guest·entry·VZ·Swift VM helper·guest 자산·protocol은 실행 소스에서 제거했다.
  과거 VM 시험 원문은 `docs/archive/macos-vm-tests-2026-10-25/`에 보존하며 native PASS에 합산하지 않는다.
- 실행/출력 수명은 process, 저장·tar/inventory 검증·package staging은 storage,
  인증/정산은 broker/domain, OS primitive는 native/platform-*가 맡는다. 아래 모듈이 App을
  import하지 않는다. App은 API를 조립한다. 의존 허용 목록을 넓히지 않는다.
- G-PROCESS/G-FILES/G-AUTH는 OPEN이다. Darwin에서 NOTE_TRACK ENOTSUP(45), setsid
  후손 생존, mode-000 event pin EACCES(13)을 실제 CI에서 확인했다. static 지원 거절과
  일부 primitive 성공을 gate 통과로 처리하지 않는다.
- 실제 CI `40202613809`: Mac 26/15 common-runtime 각각 20/20, Ubuntu 19/19. 별도 gate job은 BLOCKED다.
- `0d471551`의 CI `40202936879`에서도 위 공통 결과를 재현했다. 실제 SCM_RIGHTS 인계 뒤
  connector 생존·종료 모두 kernel peer PID는 holder를 가리켰으나 G-AUTH 전체 증명은 아니다.
- 첫 전체 local은 FAIL52·SKIP70, 입력 변경0으로 끝났고 원시 실패를 보존했다. 유지되는
  회귀의 native fault/모듈 연결과 실제 bwrap 환경을 수리했다. 부분 시험 성공을 전체 PASS로
  표시하지 않으며 새 입력을 고정한 전체 재실행이 필요하다.
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
