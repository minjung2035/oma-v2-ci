# P1-3 — public validation 단일 구현과 시간적 권한 재검증

## 변경 내용

`PublicDispatcher.validatePublicRequest(auth, envelope, phase, hasStream)`가 envelope/version/method/key/current authority/capability/params/stream/admission 규칙을 소유한다. `preflight`는 검증 후 결과를 보관하지 않고, `dispatch`는 같은 구현을 다시 호출해 current actor, incarnation, desired, capability, params와 admission을 읽는다.

검사 구현을 공유하는 것과 검사 결과를 재사용하는 것을 분리했다. `earlyAuthority`는 dispatch 호출 한 번 안에서만 쓰이는 지역값이다. connection 간 또는 preflight와 dispatch 사이에 cache, token, authority result를 보관하지 않는다.

Expected validation failure는 기존처럼 preflight에서 StoreError, dispatch에서 retry=never의 error envelope가 된다. Store 관찰/decoder/admission이 던진 예외는 기존 failureAnswer 경로로 전달한다. Unknown observation을 absence/false/권한 부여로 바꾸지 않는다.

## D05 — 의미 보존과 추가 보강 고시

원본 두 경로의 오류 우선순위는 다르다. Dispatch는 shape 검사 후 stale actor를 version/method/key보다 먼저 거절한다. Stream preflight는 shape/version/stream method/key를 먼저 거절한다. 이를 무조건 같은 순서로 바꾸지 않고 phase로 명시하여 기존 오류 code/message/우선순위를 유지했다.

Optional bundle의 stream policy를 양쪽에 적용했다. `git.submit`에서 명시적 stream preflight를 요청했지만 bundle descriptor가 없다면 body 수신 전 INVALID_REQUEST다. 기존에는 그 조건을 dispatch에서만 확인했다. 이는 공통 규칙 적용에 따른 조기 거절 보강이다.

실제 `RpcConnection.descriptor`는 bundle/content가 없으면 preflight를 호출하지 않고 null body로 dispatch한다. 따라서 bundle을 생략한 정상 no-stream submission은 계속 허용된다. 이 경로도 별도 테스트로 고정했다. Connection/frame/spool 구현은 변경하지 않았다.

Effect dispatch switch와 그 이후 helpers는 원본과 byte-identical하다. 해당 suffix SHA-256은 `f7433b3361ccc56cf568e29763a58ecf4e8ecdb13365335cca704453b2dd3df5`다. 새 wire method, DB enum/schema, accepted plan format, recovery workflow, OPEN gate 변경은 없다.

## Fact / Relation / Phase

- Fact: 현재 actor 상태/권한은 Store와 기존 capability owner가 관찰한다.
- Relation: 인증 시점 capability와 현재 durable capability 양쪽이 권한을 허용해야 하며 현재 incarnation/desired가 유효해야 한다.
- Phase: preflight는 큰 body 수신 전, dispatch는 body 수신 뒤 효과 실행 전 각각 새 사실을 확인한다. 두 시점 사이에 stop/revoke/admission 변화가 발생하면 거절한다.

## 실제 검사와 한계

`test/public-validation-policy.test.mjs`는 실제 dispatcher와 reply constructor를 transpile하여 제어된 module boundary에서 실행한다. Method metadata, params decoder, authority representation, physical effects는 controlled fixture다. 따라서 실제 wire schema, production typecheck, transport/SQLite/systemd/kernel/crash 적합성 증거가 아니다.

Node v22.16.0 / TypeScript 5.8.3에서 원본 dispatcher + 최종 테스트는 **14 tests / 12 PASS / 2 FAIL**, 수정본은 **14 tests / 14 PASS / 0 FAIL / 0 SKIP**이다. 한 version rule만 변형해도 양쪽이 영향을 받는 mutation test와 bundle 없는 stream preflight test가 원본의 두 실패를 재현한다.

기타 regression은 preflight 이후 stop, incarnation 증가, actor 제거, capability 회수, params policy 변경, admission 차단, current-state 관찰 오류, read/ephemeral request-key 금지와 draining admission, fresh read/decode 2회 및 effect 1회를 확인한다. 이들은 실제 body/socket lifecycle 시험이 아닌 dispatcher 경계 시험이다.

P1 전체 세 파일의 최종 동시 실행은 **25 PASS / 0 FAIL / 0 SKIP**이다. 기존 `evaluateExecution`에 P1 required oracle 이름을 지정하여 raw TAP의 합계와 누락/skip 여부를 확인했다. `fast`와 `all`의 sourceFiles/requiredNames에 세 테스트가 연결됐고 중복이 없음을 별도 확인했다. 두 lane 자체를 실행한 것은 아니다.

## 식별값

- 원본 dispatcher Git blob: `514d242df8bc2399cb87126a1d1176ba38804ac8`.
- 변경 dispatcher Git blob: `ba19f3de7ecae1b477ee1a6ae0194f1959a83bf9`.
- 변경 dispatcher SHA-256: `7b789e81a51047a8df9e974bad5ae963e416cc1ba2f018697129542cfc807ddd`.
- test Git blob: `5aa74d43377b5c30b58bf7e427fafdeb8668702f`.
- test SHA-256: `ef42a6255e2f937fe7bb961eee6c27083aeb3681fc1e9b25f164b82f3a992968`.
- before raw TAP SHA-256: `7f49ad802d0416d4fef62f5ceba1ca8255e172a46203b4d6e84660084058530f`.
- after raw TAP SHA-256: `32d602a0c1db6d730f7b9bf2f81616c67da7588898f174f5897fa7b1a488ae1b`.
- [최종 combined raw TAP](evidence/p1-combined.tap) SHA-256: `0d86407250954c3a6a327cbfd153720436cdd7655e200f89a9fe9c07cf36b1d3`.

P0 통합 baseline과 repo pinned TypeScript 5.9.3 검증은 여전히 BLOCKED/NOT_RUN이다.
