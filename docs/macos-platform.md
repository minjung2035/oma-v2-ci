# native 플랫폼 전환 계약 — DR49

2026-10-25 사용자 구현 지시로 VM 지원을 폐기했다. 이 문서는 현재 전환 계약을 소유한다.
과거 MAC/MV/T 번호의 원문과 의미는 [VM 계약·시험 기록](archive/macos-vm-tests-2026-10-25/README.md)에
보존하며 native 수용 번호로 재사용하지 않는다. [전환 명세](macos-native-spec.md)의 P0–P7을 따른다.
구현 존재와 지원 완료를 구분하고, 실제 상태는 [validation](implementation/validation.md)이 소유한다.

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

Darwin CI에서 NOTE_TRACK 거절과 setsid 후손 생존, mode-000 event pin 거절을 실제로 관측했다.
따라서 Mac native 제품 실행은 차단돼 있다. Linux의 Resident/candidate/systemd 의존 제거와
Darwin primitive 연결을 포함한 잔여 작업을 native 지원 완료로 표시하지 않는다. 세부 구현·실패와
재개점은 [전환 기록](implementation/native-transition.md)과 [인계](HANDOFF.md)를 따른다.
