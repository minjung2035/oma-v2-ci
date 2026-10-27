# 재분석 요약 — 원칙은 있으나 적용 범위가 서로 다르다

## 기준과 한계

2026-09-22 Asia/Seoul에 GitHub connector로 refactor HEAD를 다시 조회했고 기준은 b25961cc46532f5e30ff60cc381fed51c59d13ab이다. 변경되지 않은 이전 source 검토와 이번 추가 검토를 명시적으로 구분한다. 모든 production 행을 이번에 다시 읽었다거나 전체 suite를 실행했다고 주장하지 않는다. 상세 읽기 범위는 SOURCES, 전체 production 파일 배정은 REVIEW-COVERAGE다.

## 무엇이 일관되고 무엇이 아닌가

TransactionScope는 현재 scope/owner/active를 runtime에서 검사하며 operation codec은 payload/plan/result/cross-row 관계를 검증한다. CLI request-service는 cache 관측 실패와 부재를 구별하고 explicit not-found일 때만 frozen request를 다시 보낸다. 이 부분들은 새 패턴으로 교체할 대상이 아니라 유지할 기준이다. [S03](SOURCES.md#s03), [S04](SOURCES.md#s04), [S49](SOURCES.md#s49)

반면 delivery의 evidence를 재사용할지 여부는 Resident와 Principal이 독립 결정하고, batch incarnation은 current authority와 historical evidence를 동시에 표현한다. config reader는 전체 관계를 검사하지만 writer는 부분 field update를 저장한다. prepared resource의 정리 helper는 있지만 모든 실패 구간의 등록이 강제되지 않는다. [S06](SOURCES.md#s06), [S07](SOURCES.md#s07), [S08](SOURCES.md#s08), [S10](SOURCES.md#s10), [S11](SOURCES.md#s11), [S15](SOURCES.md#s15), [S16](SOURCES.md#s16), [S22](SOURCES.md#s22), [S23](SOURCES.md#s23)

따라서 이번 계획은 “파일을 더 나눈다”보다 “정책 결정의 owner와 상태 전이의 단위를 맞춘다”에 집중한다.

## 판정 원장

| ID | source로 확인한 사항 | 분류 | 실행 계획 |
|---|---|---|---|
| F01 | batch 재할당 뒤 기존 receipt incarnation과 충돌 | 관계/복구 결함 후보를 동일 SHA에서 유지; production 반례 필수 | WP06–07 |
| F02 | Principal은 durable receipt 우선 재사용 없이 재전달부터 시작 | 재시도 정책 분산 | WP08 |
| F03 | Config writer가 loader의 교차 제약 전에 저장 가능 | confirmed static logic mismatch | WP11 |
| F04 | basename 기반 society가 서로 다른 path에 충돌 | confirmed pure identity mismatch | WP16 |
| F05 | outer quota guard가 read/settle/reconcile까지 포괄 | 정책 범위 불일치 | WP21–22 |
| F06 | split 파일·revision을 개별 교체 | 기존 수동 형식의 명시적 제한; managed edit 일관성 개선(C2) | WP12–13 |
| F07 | Worker profile이 seed만 바꾸고 seed=0에 선택 미보존 | UI 의미/적용 시점 불일치 | WP15 |
| F08 | UI와 loader의 extension path 규칙이 다름 | 독립 정책 drift | WP14 |
| F09 | context/create 준비 실패의 자원 책임이 흩어짐 | cleanup scope 결함 후보 | WP17–20 |
| F10 | session 종료 시 waiting prompt의 개별 반환 누락 | 입력 수명 불일치 | WP09/28 |
| F11 | Store schema 거절 이전 WAL PRAGMA | 호환성 refusal의 쓰기 부작용 | WP04 |
| F12 | 동기 tree scan/systemctl 관측이 broker에 누적 | 성능·boundedness 구조 부채; 측정 필수 | WP23 |
| N01 | receipt publisher가 file fsync helper 뒤 최종 parent flush를 명시 호출하지 않음 | 새로 확인한 source-level durability gap; powercut 미실행 | WP05 |
| N02 | custom configPath를 broker는 읽지만 resident.service의 ExecStart에는 전달하지 않음 | 새로 확인한 launch contract drift | WP03 |
| H01 | accept timeout 뒤 delivery claim을 반환할 수 있음 | 실제 Pi event 순서 반례 필요 | WP09–10 |
| H02 | Git no-op recovery의 final authorization 의미 | 설계 결정 필요; 실행형 check 우회 주장은 제외 | WP24/D06 |
| H03 | Resident 전체 turn에 idleStreamSeconds 절대 deadline 사용 | 의도와 구현 대조 필요 | WP10 |
| H04 | foreground broker와 BindsTo broker.service의 조합 | 새 topology 가설; user-systemd 실험 전 실패 단정 금지 | WP03/D03 |
| H05 | EngineAuth placeholder fallback가 재귀이고 명시 상한 없음 | shape-dependent boundedness 점검; 정상 provider에서 발생 단정 금지 | WP27 |
| Q01 | PLACEMENT의 Record<string,...>는 field 완전성을 강제하지 않음 | 타입 보장과 주석 불일치 | WP11/29 |
| Q02 | bundle reader fixture 시험은 전체 HostConfig loader 증거가 아님 | proof scope 구분 | WP02/29 |

N01의 근거: publishDeliveryReceipt는 ensureDurableDirectory→writeExclusiveFsyncedFile→read를 호출한다. writeExclusiveFsyncedFile은 정상 경로에서 parent flush를 하지 않으며 caller 책임을 명시한다. final receipt name의 durable publication이 별도 primitive로 보장돼야 한다. 기존 immutable publisher는 그 경계를 갖지만 mode=0444이므로 receipt=0600에 무작정 사용하면 안 된다. [S08](SOURCES.md#s08), [S46](SOURCES.md#s46), [S47](SOURCES.md#s47)

N02/H04의 근거는 entry broker, supervisor, Resident unit template을 함께 읽은 것이다. 코드에서 누락된 locator는 확인했지만 실제 machine에서 unit이 설치되어 있었는지 또는 어떤 경로가 활성화됐는지는 이번에 실행하지 않았다. [S39](SOURCES.md#s39), [S40](SOURCES.md#s40), [S42](SOURCES.md#s42)

## 이전 설명 중 수정하는 내용

“DurableReceipt 타입이 있으면 execute를 다시 호출할 수 없다”는 타입 자체의 보장이 아니다. “한 원칙이면 모든 workflow를 하나로 합친다”도 잘못이다. “split 원자성이 반드시 기존 계약”이라는 전제 역시 operations README와 맞지 않는다. 이번 계획은 이를 각각 runtime+영속 상태 검증, normal/recovery 분리, 명시적 C2 변경으로 정정했다.

## 완료를 막을 수 있는 실제 제약

계획서의 존재만으로 systemd/Pi persistence/power loss 가설이 닫히지 않는다. 필요한 환경이 없으면 해당 WP는 BLOCKED다. 그 상태를 회피하기 위해 test를 mock-only로 바꾸거나 OPEN gate를 제거하지 않는다. 대신 독립된 로컬 WP를 진행하고 미검증 지원 조합을 명시한다.
