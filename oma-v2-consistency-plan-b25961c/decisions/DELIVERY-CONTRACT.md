# Delivery 구현 계약 — D01의 구체화

읽는 순서: [D01](D01.md) → [WP05](../workpackages/WP05.md) → [WP06](../workpackages/WP06.md) → [WP07](../workpackages/WP07.md) → [WP08](../workpackages/WP08.md). 아래 이름은 **제안 API**이며 기존 source에 있다고 가정하지 않는다.

## 1. Evidence snapshot에 반드시 보존할 관계

`actor`, `batchId`, **순서를 포함한 exact messageIds**, `incarnation`, `adapterRevision`, `sessionPath`, `entryId`가 기존 receipt와 expected batch에서 일치해야 한다. shape 검증을 통과한 object와 이 관계까지 검증된 receipt는 구별한다. 검증된 객체는 외부 코드가 직접 만들 수 없는 좁은 factory에서 반환하며, factory의 실제 runtime 검사가 타입 브랜드의 근거다.

단순히 `Readonly<Receipt>`로 바꾸거나 `as ValidatedReceipt`를 workflow에 추가하지 않는다. 모든 branded snapshot은 읽은 특정 batch와 proof scope를 식별한다. 절대 최신이라는 의미를 타입에 부여하지 않는다.

## 2. Observation 결과의 최소 구별

| 결과 | 의미 | 다음 단계 |
|---|---|---|
| exact | 예상 batch/기존 incarnation과 일치하는 기록을 읽고 검증했다 | 정산 가능성을 현재 owner가 판단 |
| absent | 신뢰된 parent 아래 exact receipt name의 부재를 관측했다 | 기존 안내 중복 정책과 tool receipt를 고려 |
| unavailable | 읽기 실패 또는 coherent snapshot을 확보하지 못했다 | 새 전달·삭제·완료 금지; 재관측 |
| conflicting | 존재하지만 schema/identity/batch relation이 맞지 않는다 | 원본 보존·repair 진단 |

부모 디렉터리 전체 부재, session target 부재, final receipt 부재를 같은 ENOENT 하나로 축약하면 안 된다. 어떤 대상이 없는지 adapter가 확인한다. 검증된 batch가 요구하는 기존 authoritative path가 사라진 경우는 단순한 신규 전달 근거가 아니다.

## 3. Live complete와 trusted recovery complete

Live complete는 기존 protocol의 peer, actor, current lease, exact incarnation 검사를 그대로 수행한다. Trusted recovery는 외부 RPC method를 추가하지 않는 broker-internal 경로다. 두 경로가 공유할 수 있는 것은 receipt decoding, batch equality, final ledger transition이다. **권한의 근거는 공유하지 않는다.**

Recovery 호출자가 보유해야 할 근거는 singleton writer lifetime, batch snapshot, old-run quiescence 또는 기존 startup quiescence다. receipt 관측 자체가 old process death를 대신하지 않는다. 새로운 현재 runner의 cgroup 상태를 이전 실행의 종료 증거로 쓰지 않는다.

## 4. Rollover와 실패 원자성

확인한 old receipt를 old incarnation의 current durable agent 상태에서 먼저 정산한다. 이때 completed batch의 incarnation은 역사적 identity로 남겨둔다. 그다음 남은 prepared만 기존 규범대로 재할당한다. 이미 completed된 batch를 reassign하지 않는다.

정산 transaction은 `batch.id + actor + old incarnation + ordered manifest + prepared/completed state`를 다시 확인한다. event loop에 다른 operation이 들어갈 수 있는 await를 추가했다면 snapshot freshness를 다시 검증한다. SQL transaction 안에 filesystem IO를 넣지 않는다.

batch 정산 뒤 incarnation 증가 전에 죽어도 재실행은 completed state를 읽어 진행한다. incarnation 증가 뒤 endpoint 준비가 실패해도 새 run 권한을 임의 발행하지 않는다. RunRegistry opening/failed bind의 기존 처리와 충돌하면 해당 부분을 WP07에서 보정하고 같은 invocation 재진입 시험을 추가한다.

## 5. Receipt 게시

private parent 아래 unpredictable exclusive temporary를 만들고 bounded bytes를 쓴다. 파일 fsync 이후 최종 이름에 no-replace publication을 수행한다. 기존 checked descriptor/link primitive를 우선 재사용하되 현재 immutable mail API의 mode 0444는 receipt에 적용하지 않는다. receipt mode는 0600을 유지한다. parent fsync가 성공하기 전 `durable receipt` 결과를 반환하지 않는다.

최종 이름이 이미 존재하면 기존 receipt를 검증해 사용한다. 일반적인 idempotent 재관측의 경우 새 entryId를 기준으로 기존 receipt를 덮지 않고 **최초 유효 receipt**를 정산 기준으로 삼는다. batch/id/manifest가 다르면 conflict다. 기존 영수증과 새 경계의 sessionPath 차이를 무시한 채 새 경로로 complete하지 않는다.

임시 파일과 최종 파일이 같은 파일시스템에 있다는 조건, publication 후 temp 제거 및 parent flush 순서를 명시한다. 최종 이름 게시 뒤 flush 실패에서는 최종 이름을 삭제하지 않고 ambiguous 결과를 남긴다. 단순 `rename`의 overwrite 의미를 immutable publication에 사용하지 않는다.

## 6. 안전성과 진행성의 별도 완료 조건

유효 receipt가 있으면 새 엔진 전달 없이 정산할 수 있어야 한다. receipt가 없는 unresolved effect에는 domain별 중복 허용/관측 정책이 필요하다. conflicting receipt는 자동 복구하지 못할 수 있으며, 이 상태를 명시 blocked로 보존하는 것은 정상적인 안전 정책이다. 모든 상태가 결국 success가 된다는 보장은 하지 않는다.

Principal이 busy여도 settlement-only는 새 turn이 아니므로 별도로 진행할 수 있다. 단 등록된 host session이 있어야 한다는 현재 endpoint 계약을 무시하지 않는다. offline 정산은 startup trusted recovery에서 다루며 일반 caller에게 우회 권한을 주지 않는다.

## 7. 한 batch의 active presenter

receipt read의 부재 판정 자체는 새 presenter의 독점권이 아니다. Resident의 current run fencing과 Principal의 turn claim/inFlight를 실제 await 경계에서 유지한다. 기존 owner가 살아 있거나 상태가 불명인 동안 다른 caller가 같은 batch를 새로 실행하지 않게 한다. 별도 전역 lock 서비스를 만들지 않고 기존 책임 경계가 이 성질을 집행하는지 duplicate prepare/open/tick 시험으로 확인한다.
