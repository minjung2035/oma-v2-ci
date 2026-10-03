# 구현 요구사항 (필독)

모든 수정/삭제/신규 동작은 엄격한 테스트를 동반해야 한다:

1. 각 fixed item마다 최소 1개의 실패→성공 재현 테스트를 test/ 아래 영구화한다. 결함이 있던 구체 시나리오(lease 미반환, prepare 중 crash, non-UTF8 이름, chmod 실패, wedged channel, replay 순서 등)를 oracle로 남긴다.
2. 삭제한 legacy 경로는 "남은 동작이 올바르다"를 검증하는 테스트로 대체한다.
3. 엣지 커버리지: 경계값, 재시작/리플레이, 동시 요청, 실패-중간-재개. 가능하면 property-style.
4. 기존 test/*.test.ts, test/*.test.mjs 컨벤션을 따른다. test/audit/*.mjs oracle은 수정 금지 — pass 전환만 관측.
5. 완료 report에 추가된 테스트 파일 목록과 각 테스트가 잡는 결함을 명시한다.
