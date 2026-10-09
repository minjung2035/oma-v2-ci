# OMA v2 — 현재 인계 (2026-10-09, DR39)

현재 작업은 DR38의 여섯 host·guest 결함을 수정·푸시한 뒤 승인받은 아키텍처 개선이다.
브랜치는 `feat/macos-hidden-vm`, DR38 기준 커밋은 `463b0d2c`다.
문서 먼저, 시작 문제는 실행 측정 먼저, **서브에이전트 사용 금지**를 유지한다.
사용자는 수정·검증·일반 푸시를 이미 승인했다.

## 이번 변경과 소유권

Society 진입점에서 프로젝트 설정 파생·저장·read-back을 `ProjectSessionSettings`로,
설정·dashboard·mail·extension 화면 동작을 `societyPanelPorts`로 옮겼다.
entry는 tenure·engine·broker·resume의 수명 순서를 계속 소유한다.
Review의 문서 렌더링과 Worker 상태 계산을 순수 모듈로 옮겼다.
acceptance·frozen EML·Git preparation·physical effect·recovery는 기존 ReviewModule 소유다.
codec key와 validator symbol의 중복 목록은 실제 메서드 선언에서 도출한다.
VM API에서 KeychainStore를 분리하되 기존 native helper/IPC 하나를 사용한다.
Broker·Store·host/guest 프로세스 경계와 durable operation 모델은 유지한다.

설정 포인터는 mtime/size 대신 실제 바이트를 비교하며 관측 실패는 다시 확인한다.
notice 분할에서 경계 newline이 byte budget을 1바이트 넘던 결함을 수정했다.
Swift VM stop callback은 오류가 있으면 성공이나 stopped 이벤트를 내지 않는다.
이 Swift 변경은 Linux에서 컴파일·실행하지 않았다.
DR37 이후 사용하지 않는 SSRF/443 분류 코드와 그 과거 테스트를 제거했다.
실제 private/loopback/literal IP·임의 포트 dial을 검사한다. 승인된 제한을 재도입하지 않는다.

## 검증과 남은 작업

최종 전체 local 3,973 PASS, 실제 primitive SIGKILL 복구 63 PASS, build/typecheck/architecture PASS다.
첫 disk local suite의 실제 결함 두 건(inode reuse, create/flock 수거 경쟁)과 allocation fixture를
수정했다. 실행 전후 15,404개 입력 바이트를 대조해 변경 0건을 확인했다.
현재 상세 결과는 [validation](implementation/validation.md)과
[DR39 evidence](../test/audit/architecture-2026-10-09.evidence.json)를 따른다.
현재 source bytes의 검증과 이후 결과 기록의 구조 검증을 구분한다.

최종 실제 PTY 3회는 화면 2.96~3.07초, broker 15.06~15.37초, 첫 도구 15.83~16.21초다.
모든 child는 exit 0이며 mutation은 정확히 한 번 succeeded다. 예산 실패로 harness는 exit 1이다.
프로세스 trace에서 Human history protocol clone 8.568초, pack-objects 7.202초,
strict fsck 2.983초를 관측했다. trace overhead가 있는 값이며 일반 PTY와 구분한다.
별도 Git pack 옵션 실험은 5초 목표를 해결하지 못해 제품에 적용하지 않았다.
**최초 Society 전체 준비·첫 도구 5초 목표와 1초 목표는 아직 미달이다.**
Human index/stash/unreachable objects를 노출하는 `--local` clone이나 검증 생략을 도입하지 않는다.

남은 성능 작업은 실제 비용을 더 줄인 뒤 새 HOME/data의 실제 첫 도구로 검증한다.
macOS VM/Keychain/APFS native 실패 검증, signed guest image 부팅과 전체 release
qualification은 이 Linux 작업의 PASS에 포함되지 않는다.
과거 기록은 [이전 인계](archive/handoff-before-dr39.md)에 그대로 보존했다.
