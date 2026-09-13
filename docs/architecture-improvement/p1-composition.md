# P1-2 — broker composition temporal coupling 제거

## 변경

`src/entry/broker.ts`에서 GitModule을 먼저 구성한 다음 `const hasGoal = () => git.hasCommittedContext()`를 Lifecycle, Reconcile, Broker에 전달한다. nullable `contextOwner`와 후속 대입을 제거했다. 새 port/interface, cached boolean, 임의 false fallback은 추가하지 않았다.

GitModule constructor는 Store/Mail/paths/integration만 필요하고 Lifecycle을 요구하지 않는 것을 확인했다. Lifecycle constructor의 repository identity binding과 incarnation reader binding은 그대로 두었다. `lifetime.start`의 recovery/listen/notify/activate callback 내용은 수정하지 않았다.

## Fact / Relation / Phase

- Fact: context evidence는 GitModule의 `hasCommittedContext`가 읽는다.
- Relation: 세 consumer는 동일한 live reader를 받고 매 호출마다 Git owner를 조회한다. 관찰 실패를 false로 변환하지 않는다.
- Phase: Git 인스턴스가 존재한 후 Lifecycle에 reader가 제공된다. Recovery completion 이전 activation을 허용하는 변경은 없다.

## 실제 실행

`node --test --test-concurrency=1 --test-reporter=tap test/broker-composition-policy.test.mjs`

Node v22.16.0 / TypeScript 5.8.3. 원본 source에 새 테스트 적용 시 3 tests 중 2 PASS / 1 FAIL, 변경 후 3 PASS / 0 FAIL / 0 SKIP.

테스트는 실제 entry source를 transpile한 뒤 controlled module boundaries에서 실행한다. 기존 main 호출의 Promise를 관찰하기 위해 void만 제거하며 main을 재호출하지 않는다. 실제 filesystem/SQLite/systemd/process effect는 실행하지 않는다. 따라서 이는 composition/phase wiring 증거이지 native startup, recovery, crash proof가 아니다. 기존 통합 tests는 삭제하거나 완화하지 않았고 전체 실행은 P0 차단으로 NOT_RUN이다.

검사 내용: Lifecycle 생성 시 reader 준비, 세 consumer의 callback identity 및 동적 값/오류 전달, recover→bootstrap→listen→notify→activate→refresh wiring, Store 생성 1회.

## 소스와 로그 식별

- 원본 entry Git blob: `63e8efbf3a2b81c13515131cef01a0d93b607a32`.
- 변경 entry Git blob: `5ddfc7322944bedad54ba98ff61e7f3b11cb05d0`.
- 변경 entry SHA-256: `0dc06dd61e79d704b40706e14f4f1e6679f9a753cb37f513310d25f1b13c9f4d`.
- test SHA-256: `fba9b7cd6e410dd6e9e3387a36a1f2a3574f33d3407d9cf55da7f61bfd7333cc`.
- before raw TAP SHA-256: `cf319b0977aa8c5e45383cb2db2674d0e2324242e1718c8ce9cdcdc7a3fdf8fa`.
- [after raw TAP](evidence/p1-composition.tap) SHA-256: `aa91baa690f45d879aab6c82bfc982b4ed4fd312e56f64d74b172d5b9c5b55d2`.

Production inventory/LOC/hash 산출물은 수작업 갱신하지 않았다. 변경 후의 fresh generated evidence는 여전히 필요하다.
