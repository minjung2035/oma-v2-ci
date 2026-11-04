# 개발·테스트 안내

동작의 기준은 [PRIORITY-0](PRIORITY-0.md)와 해당 spec, 현재 코드 위치는 [책임 경계](application-boundaries.md), 실제 실행 결과는 [검증 상태](implementation/validation.md)에 있다. 과거 인계의 작업 순서와 부분 PASS는 현재 사용자 지시를 대신하지 않는다.

## 실행 환경과 명령

저장소의 Node 26·lockfile·native 의존성을 사용한다. 정확한 명령 정의는 [package.json](../package.json)에 있다.

```sh
# 빌드 후 전체 로컬 테스트
npm test

# 이미 빌드한 같은 입력의 전체 테스트
node scripts/test-local.mjs

# 변경한 파일만 확인하는 예
node --test --test-concurrency=2 dist/test/client.test.js test/verification-policy.test.mjs

# 문서·모듈·실제 복구 경계의 정적 검사
npm run check:documents
npm run check:modules
npm run check:boundaries
```

`test-local.mjs`는 파일 선택 인자를 받지 않는다. 루트의 TS/MJS 테스트와 workspace 소유 테스트를 모두 발견하며, source와 compiled 목록이 다르면 rebuild를 요구한다. 개수는 소스의 `test()` 호출 수가 아니라 실제 실행 summary로 센다. 반복 입력과 하위 테스트 때문에 두 수는 다르다.

## 병렬 실행과 시간

실제 event-loop timing을 검사하는 세 파일은 먼저 단독 실행하고 나머지는 파일별 별도 프로세스로 병렬 실행한다. 기본 동시성은 `min(8, availableParallelism())`이며 `OMA_TEST_CONCURRENCY`로 조절한다. 이 개발 호스트에서는 기본값 4가 적용된다. 6개 실행은 시간이 조금 줄었지만 새로운 timing 실패가 생겨 채택하지 않았다. 측정값은 validation에 있다.

`.scratch/local-test-durations.tsv`는 긴 파일을 먼저 시작하는 데 사용한다. 결과 캐시가 아니며 테스트를 생략하지 않는다. Node compile cache도 `.scratch/test-node-compile-cache`에 둔다. cache가 없는 파일도 실행 대상에 포함된다.

실제 시간을 기다리는 대신 test-only 가상 시계나 배속 fixture를 사용할 수 있다. 실제 OS 종료·I/O·프로세스 수명 검증은 해당 관측을 유지한다. 결과를 빨리 얻기 위해 timeout을 늘리거나 실패 검증을 제거하지 않는다. 배속 테스트의 시간 경계는 정상과 잘못된 구현을 구분해야 한다.

전체 측정 중 source·docs·build 산출물을 바꾸지 않는다. 처음의 timing 검증과 별도 CPU 작업을 겹치지 않는다. 비교할 때 build 시간 포함 여부, 동시성, 실행 환경과 입력을 함께 기록한다.

## 테스트 구성

- 이름은 파일별 `001. 동작 설명` 형식으로 쓴다. 반복 입력은 조건을 이름에 붙인다. 요구 ID는 trace·oracle map에서 연결한다.
- 독립된 실패 원인은 별도 테스트나 이름 있는 하위 테스트로 나눈다. 비싼 공통 준비는 공유하되, 상태를 바꾸는 각 경우는 실패해도 다음 경우를 오염시키지 않도록 복원한다.
- 같은 계약·같은 실행 경로의 중복 검증은 합친다. unit 경로와 실제 조립 경로, preaccept와 accepted recovery, 일반 오류와 손상은 서로 다른 검증이다.
- 폐기된 도구 계약은 현재 spec과 대조한다. 여전히 필요한 byte·권한·복구 검증은 현재 진입 경로로 옮기고, 삭제한 사례는 그 이유와 대체 검증을 기록한다.
- expected를 production 구현에서 그대로 만들어 비교하지 않는다. 부정 사례·독립된 결과·실제 효과를 통해 검증한다.

관련 fixture는 `test/fixtures/`와 해당 package의 `test/fixtures/`에서 재사용한다. 실행되지 않는 과거 감사 JSON은 [보관 기록](archive/test-audits/)에 있다.

## 실패 결과와 플랫폼 범위

전체 runner는 실패·중단·skip/todo·불완전 summary를 성공으로 처리하지 않는다. 원시 TAP 위치를 결과에 출력하고 실패 시 보존한다. 큰 scenario 상태는 artifact 파일로 분리한다. `OMA_TEST_ARTIFACT_DIR`로 그 위치를 지정할 수 있다. 화면의 짧은 진단은 raw 결과를 대체하지 않는다.

Linux의 전체 로컬 테스트에는 실제 Linux native 회귀와 플랫폼 공통 검증이 포함된다. Darwin 전용 실행은 실제 Darwin에서만 등록되며, portable recipe 검사는 macOS 지원 완료의 증거가 아니다. kernel·platform·powercut·provider lane의 실행 조건은 [검증 spec](verification-spec.md)을 따른다. 빠진 환경은 해당 범위의 미실행으로 기록한다.

선택 실행의 PASS와 전체 실행의 FAIL을 합쳐 전체 PASS로 만들지 않는다. 테스트 정리로 사례 수가 달라졌다면 삭제·통합·분리·계약 이행과 실제 동작 수정의 영향을 구분한다.

## 구조 자료와 문서

`npm run evidence:refresh`는 구조 inventory·digest·graph·검토 ledger를 생성하며 `runtimeProof: false`다. 작성 시점이 다른 review·PASS를 새 실행으로 재사용하지 않는다. 제품 코드가 바뀌면 해당 동작 검사와 package/API 검사를 실행하고, 문서만 바뀌면 링크·요구 ID·관련 구조 검사를 실행한다.

현재 결과는 validation 한 곳에 기록하고 과거 상세 실행은 archive로 옮긴다. 원래 요구 ID·수용 번호·저장 사실은 문서 정리로 바꾸지 않는다. 기록의 위치는 [문서 지도](README.md#새-정보를-어디에-적는가)에 정리했다.
