# Native 전환 자료 안내

플랫폼 요구와 완료 조건은 [macOS 플랫폼 계약](../macos-platform.md)과 [native 명세](../macos-native-spec.md)에 있다. 최신 실행 결과는 [검증 상태](validation.md)를 따른다.

Linux에서 실행하는 공통 코드·Darwin recipe 검사는 실제 macOS 실행 검증과 다르다. 실제 Darwin helper 시험은 Darwin에서만 등록된다. macOS 지원 완료와 kernel·process·filesystem·인증 검증은 이번 Linux 테스트 정리로 입증하지 않았다.

[2026-10-25~28 전환·실험 기록](../archive/cleanup-2026-11-03/implementation/native-transition.md)에 당시 입력, 중간 실패, 조사 후보와 결과를 원문 그대로 보관했다. 과거의 진행 순서나 중단 문구는 현재 작업 지시가 아니다.

[macOS 브랜치의 후속 관측 기록](../archive/macos-native-2026-11-04/implementation/native-transition.md)은 커밋 `88abfea5`의 원문이다. launchd service 반례, bootstrap 분리·DNS·exact Unix socket 관측은 해당 입력과 실제 Mac 환경의 근거이며, 병합된 코드의 전체 실행 검증과 구분한다.
