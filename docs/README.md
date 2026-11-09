# 문서 지도

구현 기준, 사용법, 현재 실행 결과를 구분한다. 과거 작업자의 지시나 부분 PASS는 현재 사용자 요청과 실제 코드 검증을 대신하지 않는다.

## 시작점

| 목적 | 문서 |
|---|---|
| 최상위 불변 원칙 | [PRIORITY-0](PRIORITY-0.md) |
| 협업 표면 변경의 요구 | [model-collaboration-surface-spec](model-collaboration-surface-spec.md)과 연결된 하위 spec |
| 설치·실행·설정 | [운영 안내](operations.md) |
| 코드 위치 | [책임 경계](application-boundaries.md), [협업 표면 구현·검증 위치](implementation/collaboration-v1-trace.md) |
| 테스트 명령·병렬 실행·실패 확인 | [유지보수 안내](MAINTENANCE.md) |
| 전체 실행 수치·실패·미검증 범위 | [현재 검증 상태](implementation/validation.md) |
| 2026-11-09 코드 감사·사용 제약·보류 구조 개선 | [프로젝트 감사](implementation/project-audit-2026-11-09.md) |
| 과거 실행·감사·작업 일지 | [보관 색인](archive.md) |

## 구현·검증 기준

| 문서 | 범위 |
|---|---|
| [architecture](architecture.md) | hash로 고정된 기준본. 원문 유지 |
| [implementation-spec](implementation-spec.md) | 신원·권한·IPC·Mail·Git·수명·복구·물리 순서 |
| [verification-spec](verification-spec.md) | 수용 번호·시험·증거·qualification 요구 |
| [협업 표면 spec](model-collaboration-surface-spec.md) | 기록 파일·9개 행동·역할·호출 복구·이행·수용 시나리오 |
| [기존 모델 도구 전환 spec](model-tool-surface-spec.md) | 이전 표면 전환의 계약. 후속 변경은 협업 표면 spec과 [설계 결정](design-revisions.md)에서 확인 |
| [macOS 플랫폼](macos-platform.md), [native spec](macos-native-spec.md) | 플랫폼 요구·미완성 범위·완료 조건 |
| [아키텍처 개선 spec](architecture-improvement-spec.md), [구현 계약](implementation/architecture-improvements.md) | 진행·통합·자원 관리 변경의 기준 |
| [integration-policy](implementation/integration-policy.md) | 통합 정책 |
| [consistency-decisions](implementation/consistency-decisions.md) | 기존 결정과 고정 계획의 근거 |
| [design-revisions](design-revisions.md) | 수용된 변경의 이유와 요구 ID |

spec의 존재는 구현이나 검증 완료를 뜻하지 않는다. 최신 실행 판정은 검증 상태 문서 한 곳에서 확인한다. 모델 도구 이름 변경과 backend method·저장 사실의 변경도 구분한다.

## 제품과 보조 자료

[제품 목적](PRODUCT.md), [프롬프트 교정 배경](prompt-calibration-context.md), [제한값의 정의 위치](limit-bounds.md), [Priority 0 감사 기록](priority-0-audit.md)을 제공한다. Native 조사와 모듈 감사의 원문은 보관 색인에 있다. [HANDOFF](HANDOFF.md)는 현재 문서로 연결하는 안내만 유지한다.

## 새 정보를 어디에 적는가

- 요구·동작 계약은 해당 spec, 설계 변경 이유는 design-revisions에 기록한다.
- 현재 실행 결과·입력·한계는 validation에 기록한다. 이전 실행 상세는 archive에 보관한다.
- 사용법은 operations, 코드 위치는 application-boundaries, 테스트 사용법은 MAINTENANCE에 기록한다.
- 인계 문서에 규범·현재 수치·다음 작업 지시를 중복해서 쌓지 않는다.

## 기계 판독 입력

`implementation/source-owners.json`과 `traceability.json`은 요구와 코드·시험을 연결한다. `durable-boundaries.json`은 실제 fault/retry/restart 경계, `oracle-map.json`은 고정 계획의 요구와 읽기 쉬운 테스트 이름을 연결한다. `review-notes.json`과 `review-ledger.json`은 과거 입력에 결박된 검토 기록이다.

`npm run evidence:refresh`는 구조 자료를 생성하며 `runtimeProof: false`다. 과거 PASS나 검토 사실을 새 입력의 승인으로 바꾸지 않는다.
