# DR49 native 전환의 구현·검증 경계

2026-10-25 사용자 구현 지시는 이전 문서 정리 범위를 대체한다. 구현 순서는
[명세 P0–P7](../macos-native-spec.md#13-구현-순서와-완료-조건)이다.
VM 지원은 폐기하며 새 구현의 fallback으로 남기지 않는다. architecture 원문과 과거
검토 기록은 변경하지 않는다. accepted plan, receipt, DB 4, HostConfig 3의 뜻을 유지한다.

## 선행 시험

`scripts/verify-native.mjs`가 실제 OS/SDK/Node와 source SHA를 기록한다. Darwin probe는
실제 SDK로 빌드한 작은 syscall 시험이며 production 정책의 대체 구현이 아니다.
G-PROCESS/G-FILES/G-AUTH는 각각 독립된 미해결 조건이다. 일부 syscall 성공으로 전체
gate를 닫지 않는다. OPEN은 exit 1, setup 실패는 exit 2다. CI artifact는 실패 때도 보존한다.

- G-PROCESS: kqueue 자동 후손 추적 지원과 setsid/FD 폐기 후 group kill의 반례.
- G-FILES: held directory flock, mode-000 event pin/repair, FIFO 종류 관측,
  no-follow/beneath, rename 후 held root, directory flush, no-replace publication.
  exact executable 결박까지 증명되기 전에는 gate가 OPEN이다.
- G-AUTH: Unix peer PID와 endpoint 상속/인계의 차이. peer PID를 현재 socket holder로
  해석하지 않는다. UID·PID·token만으로 새 권한을 부여하지 않는다.

## 진행 기록

기존 변경은 `/home/dev/oma-audit-artifacts/native-2026-10-25/initial.patch`와
`initial-untracked/`에 보존했다. 작업 브랜치는 `work/macos-native-20261025`이며
master 병합·배포는 하지 않는다. 실제 실행 결과의 정본은 validation이다.
