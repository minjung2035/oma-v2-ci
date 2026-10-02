# 호환성·승격·rollback 경계

## 변경 분류

| 분류 | 허용 범위 | 기본 처리 |
|---|---|---|
| C0 | internal 타입/함수/오류 원인 보존, 기존 observable 계약 동일 | characterization과 differential oracle 뒤 이관 |
| C1 | 관측 가능한 버그 수정; 기존 무효 동작을 명시적으로 거절 | 사용자 영향·오류 precedence·회귀 fixture 기록 |
| C2 | 설정 파일 배치/세대/적용 시점, 지원 배포 조합의 변경 | ADR 및 compatibility fixture가 먼저. producer/consumer 순서 통제 |
| C3 | wire/DB/schema/receipt version/권한 의미 변경 | 기본 계획에서는 금지. 기존 계약으로 해결 불가함을 입증하고 별도 명시 승인·migration 필요 |

현재 DB는 6개 entity와 `user_version=1`, batch state는 prepared/completed다. 계획의 개념 상태 이름을 DB enum으로 그대로 추가하지 않는다. [S02](SOURCES.md#s02)

## Batch와 receipt

우선 v1을 유지한다. 새 run이 생기기 전에 기존 incarnation과 정확히 일치하는 유효 receipt를 정산하고, 증거 없는 prepared batch만 재할당한다. public complete는 계속 현재 run과 exact receipt relation을 요구한다. broker-owned recovery는 별도의 좁은 진입점으로 구현하고 살아 있는 과거 peer의 권한을 되살리지 않는다. 상세 결정은 D01이다.

이미 과거 코드에서 receipt/batch incarnation이 불일치한 데이터는 자동 삭제하거나 `receipt.incarnation <= current`로 수용하지 않는다. offline snapshot에서 전체 provenance를 검토하는 운영 복구 항목으로 분리한다. provenance가 부족하면 해당 batch는 명시적으로 blocked를 유지한다. “모든 기존 손상 데이터 자동 복구”는 이 계획의 약속이 아니다.

## Config bundle

inline v1, 수동 operations-v1, 신규 관리형 generation을 구분한다. 첫 두 형식은 읽기 호환을 유지한다. 관리형 bundle은 기존 manifest key를 유지하면서 상대 참조를 immutable generation에 둔다. `promptFile`은 role 파일이 아니라 index 디렉터리 기준이라는 계약을 유지한다. symlink pointer는 사용하지 않는다. [S17](SOURCES.md#s17), [S64](SOURCES.md#s64)

수동 bundle→관리형 generation은 파일 key가 같아도 편집/보관 운영 계약이 달라지는 C2 변경이다. 구버전 reader가 읽을 수 있는지 fixture로 확인하며, 구버전 writer가 immutable generation을 제자리 수정하면 안 된다. 운영 승격 뒤 구버전 writer 사용 금지 및 explicit export 경로를 제공한다. 읽기 호환을 쓰기·rollback 호환으로 확대하지 않는다.

## Project identity

새 기본 society 이름 알고리즘은 기존 상태를 임의로 rename하지 않는다. 기존 slug state가 있으면 source binding을 확인하고 explicit selection/migration으로 연결한다. stateRoot 경로가 바뀌면 lease name, accepted plan의 경로, receipt locator가 함께 영향받으므로 단순 디렉터리 이동은 금지한다. 기본은 기존 society를 보존하고 새 프로젝트에 새 identity를 주는 것이다.

## Engine·배포

공개된 Pi API와 실제 pinned version을 먼저 읽는다. dependency upgrade로 이번 결함을 우연히 숨기지 않는다. explicit rootfs='/' 운영 선택이나 비용 상한 미집행은 현재 문서에 적힌 계약이므로 이 계획에서 몰래 없애거나 집행했다고 주장하지 않는다. 필요한 변경은 별도 C2/C3 결정이다. [S64](SOURCES.md#s64)

## Rollback 시나리오

1. C0/C1 코드만 바뀌고 durable encoding이 같으면 이전 code로 revert하되 새로 고친 안전성 결함이 재노출됨을 표시한다.
2. receipt를 생성/정산한 뒤에는 완료 DB나 영수증을 rollback하지 않는다. code rollback은 fact를 되돌리지 않는다.
3. config generation commit 뒤 문제가 있으면 검증된 구세대를 가리키는 **새로운 확정 변경**을 수행한다. accepted plan을 바꾸지 않는다.
4. filesystem rename 이후 parent fsync 실패는 `미변경`이 아니라 outcome uncertain이다. 관측·flush·recovery 없이 예전 내용을 덮어쓰지 않는다.
5. schema 변경을 별도 승인한 경우 WAL/SHM/receipt/Git refs 포함 일관 snapshot과 downgrade 지원 여부를 별도 입증한다. live DB 한 파일 복사로 rollback을 준비하지 않는다.
