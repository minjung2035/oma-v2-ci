# OMA v2 — 핵심 원칙 일관성 구현 계획

**33개 독립 작업서 · 166개 구현 소작업 · 73개 회귀 시험 명세 · 6개 설계 결정**

대상은 `minjung2035/oma-v2`의 `refactor/safety-preserving-architecture`, 기준 HEAD는 `b25961cc46532f5e30ff60cc381fed51c59d13ab`다. 작성일은 2026-09-22 (Asia/Seoul). HEAD는 GitHub에서 다시 확인했고 이번에 읽은 source와 이전 동일 SHA 검토 근거를 구분했다.

> 이 패키지는 실행 가능한 순서와 완료 조건을 갖는 **구현 계획**이다. 코드 변경과 제품 테스트는 아직 하지 않았다. 모든 WP는 NOT_STARTED, 모든 Vxx 시험은 NOT_RUN에서 시작한다. 계획의 구조 검사 PASS가 제품의 검증 PASS가 아니다.

## 1. 지금 읽을 문서

| 목적 | 문서 |
|---|---|
| 분석 결과와 기존 판단의 수정 | [현재 상태 분석](guide/ASSESSMENT.md) |
| 구현 AI가 따라야 할 실행 규율 | [AI-EXECUTION](guide/AI-EXECUTION.md) |
| 단일 철학의 구체적인 불변식 | [PRINCIPLES](guide/PRINCIPLES.md) |
| 실제 작업 순서·선행 조건 | [DEPENDENCIES](guide/DEPENDENCIES.md) |
| 호환성/운영 변화/롤백 금지선 | [COMPATIBILITY](guide/COMPATIBILITY.md) |
| 모든 production 파일의 담당과 실제 검토 범위 | [REVIEW-COVERAGE](guide/REVIEW-COVERAGE.md) |
| 고정 source·공식 기술 자료 | [SOURCES](guide/SOURCES.md) |
| 실행할 회귀 시험 목록 | [TEST-CATALOG](verification/TEST-CATALOG.md) |
| 명령과 환경별 증거 규율 | [RUNBOOK](verification/RUNBOOK.md) |
| 실패·재시작 경계 | [FAULT-MATRIX](verification/FAULT-MATRIX.md) |
| 최종 승인 조건 | [EXIT-CRITERIA](verification/EXIT-CRITERIA.md) |

## 2. 이 계획의 중심

**다음 상태 전이는 명시적인 사실, 관계, 현재 권한을 근거로 결정한다. 연결 종료·재시작·설정 편집 때문에 이미 확정된 사실의 의미가 바뀌어서는 안 된다.**

이것은 모든 코드를 한 state machine이나 manager로 모으라는 뜻이 아니다. normal execution과 recovery는 다른 판단 경로를 유지하고, shared evidence/policy의 의미만 일치시킨다. 이미 좋은 transaction capability, checked operation decoding, immutable publication, frozen request replay, pinned run fencing은 보존한다.

## 3. 작업 묶음

| 묶음 | 문서 | 끝내야 할 것 |
|---|---|---|
| 기준·계약·시험 기반 | WP00–WP02 | source 고정, ADR, production-valid fixture와 독립 oracle |
| 배포·DB·전달·세션 | WP03–WP10 | 실제 config 전달, 비변경 DB 검사, durable receipt, rollover와 settlement-only retry, session claim |
| 설정·프로젝트 identity | WP11–WP16 | 전체 후보 검증, coherent snapshot, generation commit, extension 편집, 정확한 적용 시점, legacy 보존 |
| 준비 자원·메일·quota | WP17–WP22 | 책임 등록, partial preparation 정리, read/admit/settle 구별, reservation 수명 |
| 횡단 검토·runtime·표면 | WP23–WP29 | 비동기 진단, Git/lifecycle/protocol 보존, engine/extension 검증, 사실에 맞는 TUI와 정적 보장 |
| 결합·배포·최종 승인 | WP30–WP32 | 실제 실패 matrix, artifact-only 실행, 파일 전수 closure와 source-bound evidence |

번호가 순서를 완전히 뜻하지는 않는다. 예를 들어 WP23은 WP25를 기다린다. machine-readable graph와 [권장 순서](guide/DEPENDENCIES.md)를 사용한다.

## 4. 설계 결정

[D01 — 전달과 incarnation](decisions/D01.md), [D02 — 설정 generation](decisions/D02.md), [D03 — 배포 topology](decisions/D03.md), [D04 — quota/action 분류](decisions/D04.md), [D05 — 사용자 의미와 project identity](decisions/D05.md), [D06 — 증거 수준과 범위](decisions/D06.md).

각 결정은 기본 선택과 금지할 대안을 제시한다. PROPOSED라는 표시는 이미 코드/규범을 변경했다는 오인을 막기 위한 것이다. WP01에서 현재 규범과 대조해 채택하고 runtime-dependent 결론은 실제 evidence를 기다린다. v1을 유지하는 해법을 우선하며 C3 변경은 별도 승인 없이 추가하지 않는다.

구체적인 제안 API·결과 의미는 [DELIVERY-CONTRACT](decisions/DELIVERY-CONTRACT.md)와 [CONFIG-CONTRACT](decisions/CONFIG-CONTRACT.md)에 있다.

## 5. 구현 AI에게 처음 전달할 지시

```text
이 계획 패키지를 작업 기준으로 사용하라. 먼저 README, guide/AI-EXECUTION,
guide/PRINCIPLES와 guide/DEPENDENCIES를 읽고 WP00부터 시작하라.
현재 HEAD/dirty tree를 확인하고 사용자 변경을 보존하라.
한 번에 하나의 WP를 수행하되 WP 내 소작업을 분리해서 커밋하라.
각 WP의 source/ADR/선행 handoff를 읽고 먼저 실패하는 production-linked
회귀 시험을 확보한 뒤 최소 수정하라. 검토 범위의 미조회 파일을 실제로
읽고 유지/변경 이유를 FILE-REVIEW로 남겨라.
readonly/brand/import gate나 mock PASS를 runtime/durability 증거로
확대하지 말라. NOT_RUN/BLOCKED를 PASS로 바꾸지 말라.
C3 schema/wire/receipt/권한 변경과 외부 운영 작업은 자동 실행하지 말라.
작업 종료 시 templates/HANDOFF를 실제 명령과 raw evidence로 채우고
의존성상 다음 가능한 WP만 진행하라.
```

## 6. 검토 범위의 정직한 한계

고정 production inventory **220개 경로 모두에 담당 WP를 배정**했다. 이번에 다시 읽은 범위와 이전 동일 SHA에서 읽은 범위가 합쳐진 근거는 SOURCES에 표시했고, **164개 production 경로는 계획에서 SCOPE_ONLY로 남겼다.** 이들은 문제 없다는 뜻이 아니라 실제 구현 단계에서 직접 읽고 판정해야 한다는 뜻이다.

production manifest 밖의 계약·scripts·tests·CI와 실제 새 파일은 WP00에서 tracked tree로 추가 열거한다. WP32가 미조회/미검증 closure를 마지막에 검사한다. 이 계획만 작성했다고 모든 결함을 찾았다고 주장하지 않는다.

## 7. 도구와 결과 파일

[plan.json](plan.json)은 task dependencies, invariant mapping, test specs, source references, production review assignments를 담는다. [production-inventory.txt](production-inventory.txt)는 고정 inventory 복사본이다.

```sh
# 압축을 풀고 패키지 root에서 실행한다. 제품 코드는 실행하지 않는다.
python3 tools/check_plan.py
```

검사기는 dependency cycle, 누락 참조/문서, test owner, production 파일 배정, 로컬 링크 등을 검사한다. [PLAN-QA.json](PLAN-QA.json)은 계획 작성 시 그 검사 결과다. 제품 회귀 시험 코드는 이 패키지에 구현돼 있지 않으며 각 WP에서 실제 production 경로와 연결해야 한다.

실행 기록은 [HANDOFF](templates/HANDOFF.md), [FILE-REVIEW](templates/FILE-REVIEW.md), [ADR-RESULT](templates/ADR-RESULT.md), [TASK-RESULT](templates/TASK-RESULT.json)을 사용한다.

## 8. 성공의 의미

목표는 10점이라는 주관적인 숫자가 아니라 **각 불변식이 코드·데이터·실패·재시작·UI·검증에서 같은 의미로 성립하는 상태**다. 모든 required WP와 실제 환경 gates를 닫았을 때 그 범위의 일관성을 주장할 수 있다. 미확인 상태를 지우거나 보안을 완화해 모든 시험을 초록색으로 만드는 것은 완료가 아니다.
