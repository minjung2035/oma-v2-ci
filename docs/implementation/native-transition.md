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

### 실제 연결된 공통 코드

- P2: `native/posix-files.ts`의 mkdirat/unlinkat/renameat/linkat를 기존 storage 게시,
  config generation 게시, package staging/수거 owner가 사용한다. 정책과 flush 순서는
  원래 TS owner에 남긴다. Darwin의 openat beneath/no-follow는 실제 kernel이 받는
  flags를 사용하며, 검증되지 않은 permission-independent pin/reopen은 효과 전에 거절한다.
- P3: broker의 ancestry/reuse 판정은 하나이며 `/proc`와 libproc 관측만 native leaf로
  분리했다. broker supervisor의 기존 monotonic window·backoff를 process package의
  RestartPolicy가 담당한다. 이 자체로 systemd 실행 관리의 전환이 끝난 것은 아니다.
- P5의 독립 작업: Restic dump는 App의 기존 세션 보관 owner가 streaming hash·PAX·link·
  entry coverage·EOF를 검증한다. GNU tar와 inline child script를 제거한다. JSON inventory가
  정확한 nanosecond metadata와 원본 inode 관계를 별도로 검증하며 source 재관측,
  checkpoint 게시, cold commit, 회수, restore 순서는 유지한다. 관측용 content hash/link/inode는
  메모리에만 추가하며 durable checkpoint 형식·digest 정의는 바꾸지 않는다.

P4의 Darwin 실행과 P6 제품 지원은 gate가 해결되기 전 완료로 판정하지 않는다.
P2의 entry pin/reopen, P3의 Resident supervisor, P5의 quarantine/checker/설치, P6의 VM 제거,
P7의 최종 owner/규범 대조는 별도 잔여 작업이다. 공통 코드의 시험 성공을 해당 전체 단계의
완료로 승격하지 않는다.

### 최초 Darwin 실행

원본 `d80035f701227bca5ee884b0a83f1dea14a403aa`,
[CI 40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898).
macOS 26 arm64(SDK 26.5)와 macOS 15 arm64(SDK 15.5), Node 26.0.0에서 실제 실행했다.
양 OS 모두 NOTE_TRACK=ENOTSUP(45), setsid 후손이 group kill 후 생존,
mode-000 event pin=EACCES(13)을 관측했다. directory flock·directory fsync·linkat
no-replace는 성공했으나 G-FILES 전체 통과가 아니다. peer PID의 fork 상속 관측은
연결/현재 소유자의 구분을 추가 검증할 입력이며 socket transfer 방어의 증명이 아니다.
gate job은 exit 1/BLOCKED이고 artifact를 보존했다. 최초 held-root probe는 mode-000
실패가 뒤 관측에 영향을 줬으므로 다음 실행에서 namespace 관측과 분리한다.
