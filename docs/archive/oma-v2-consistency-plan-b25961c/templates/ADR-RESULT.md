# ADR 결과 양식

결정 ID / 관련 WP:

상태: PROPOSED / ACCEPTED / NEEDS_RUNTIME_EVIDENCE / REJECTED / SUPERSEDED

기준 source commit:

기존 architecture/spec requirement:

## 선택한 기본안

단일 선택과 적용 범위를 적는다. 여러 선택지 중 구현 AI가 매번 다르게 고르도록 남기지 않는다.

## 무엇이 바뀌며 무엇이 유지되는가

wire/DB/receipt/config file layout/권한/지원 deployment/API별로 적는다.

## 대안과 기각 이유

구체적 invariant·호환성·검증 비용으로 비교한다. 단순한 패턴 선호는 이유가 아니다.

## 실행 근거와 게이트

local static/actual process/kernel/powercut 중 어떤 증거가 필요한가:

아직 없어서 보류한 결론:

관련 Vxx 시험과 approval:

## Migration·rollout·revert

reader-first 순서, 구버전 writer 금지 여부, 원본 보존, uncertain commit 처리:

C3가 필요하다면 별도 승인 요청과 blocker:
