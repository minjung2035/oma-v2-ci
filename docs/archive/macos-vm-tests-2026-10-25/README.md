# 폐기한 macOS VM 경로의 시험 기록

DR49의 VM 제거 때 보존한 과거 시험 원문이다. native 실행 suite에는 포함하지 않으며,
이 파일들의 과거 성공을 현재 native 지원의 증거로 사용하지 않는다. 혼합 시험 파일의
원문도 남겼고, 그 파일의 공통 파일·인증·소유권 시험은 현재 `test/`에서 계속 실행한다.

VZ/vsock/guest transport/Host API/terminal forwarding/package sync/bookmark/VM archive는
폐기했다. 기존 VM disk/state/archive와 history의 자동 변환·삭제는 하지 않는다.
현재 구현과 차단 조건은 [native 전환 기록](../../implementation/native-transition.md)과
[현재 검증](../../implementation/validation.md)이 소유한다.
