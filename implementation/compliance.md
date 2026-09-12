# Requirement → production path → executable evidence

**MUST [COMP-001]** release trace는 구현 검증 산출물이며 OMA runtime의 DB/queue/state가 아니다. [traceability.json](traceability.json)은 현재 문서 requirement를 추출한 미검증 목록이다. 현재 저장소의 production 코드를 검사한 결과가 아니며 owner/call path/test는 임의로 채우지 않았다. release 전 적용 규범을 모두 분류하고 실제 source에서 근거를 채운다.

**MUST [COMP-002]** 각 항목은 source file+requirement ID+규범 본문 digest로 식별한다. 중복 문서 참조는 같은 ID라고 무조건 합치지 않는다. scope는 runtime/build/document/optional 중 하나로 분류하고 분류 이유를 기록한다. runtime MUST NOT도 적용 대상이며 금지 경로를 직접 시도하는 negative test가 필요하다. 현재 unclassified는 release 통과 상태가 아니다.

**MUST [COMP-003]** 적용 runtime 요구의 증거는 다음 field를 모두 갖는다. owner는 규범을 최종 집행하는 단일 module+symbol이고 호출 사슬의 보조 모듈은 callPath에 기록한다. 제안된 LifecycleModule 같은 새 계층을 만들 필요는 없으며 기존 broker handler/units/store/mail/git 경계에 소유자를 배정한다.

| 필드 | MUST 내용 |
|---|---|
| requirement / source / digest | 실제 현재 규범 위치와 내용 fingerprint |
| applicability / rationale | 적용 profile, 비적용이면 코드·config상 비활성 근거 |
| owner | 실제 production source path+symbol; 선언/interface 이름만 금지 |
| entrypoint / callPath | 설치된 compiled entry 또는 실제 socket method → 인증/dispatch → owner → 효과 경계 |
| negativeTests | 실행 가능한 test file+case; 위반 입력/강제 장애/누락 guard를 검출하는 oracle |
| evidence | 현재 production source revision/content digest, spec digest, build command, test command, exit status, 로그 경로, adapter/환경 pin |
| status | unverified / blocked / proven / not_applicable; blanket passed 금지 |

**MUST [COMP-004]** proven은 실제 production entrypoint를 실행한 결과여야 한다. unit test의 mock adapter만 통과했거나 import 가능한 helper가 있지만 entrypoint에서 호출하지 않으면 unverified다. UI/tool wrapper가 다른 실행 파일을 호출하는 wiring도 검증한다. resource/unit/Pi 관련 요구는 필요한 실제 kernel/systemd/Pi 경계를 쓰고, 네트워크 고장 등 fault만 test adapter로 주입할 수 있다. test double의 범위와 미검증 real boundary를 증거에 표시한다.

**MUST [COMP-005]** release checker는 source inventory의 적용 runtime 요구 수와 trace 수를 대조한다. 누락/분류 없음/실제 owner 없음/현재 revision 불일치/negative test 없음/OPEN SPIKE를 proven 처리한 행이 하나라도 있으면 release gate 실패다. not_applicable은 해당 feature를 실제로 enable할 수 없다는 config/API 거절 시험이 있어야 한다. CI 로그 이름이 requirement 이름과 같다는 것만으로 coverage를 인정하지 않는다.

**MUST [COMP-006]** spec/production owner/entrypoint/dependency/adapter가 바뀌면 영향받은 evidence는 stale이며 다시 실행한다. README에 '완료'라고 적거나 DTO field를 추가해 증거 상태를 올리지 않는다. test-only backdoor·success fallback·mock receipt가 production dependency closure에 있으면 gate 실패다. source line 수 또는 test 개수 자체는 준수 증거가 아니다.

**MUST [COMP-007]** 기존 명확한 요구를 반복 설명하는 대신 다음 priority trace를 먼저 채운다: LIFE-001/007 stable-name dedup, LIFE-008 dynamic identity, REC-007/SEQ-003 singleton-before-DB, UNIT-007 actual effect result, IPC-012 exhaustive internal surface, BATCH-001/006 handoff/gate, INT-007/S-01-CANDIDATE actual candidate resource binding, IPC-004/006 key, AUTH-001/003 capability/fencing.

**MUST [COMP-008]** schema migration과 RuntimeAgentRecord decoder가 stale resolved spec을 받으면 missing resources/modelProfile을 initialResidents/default로 채우지 않는다. 기존 spec draft를 바탕으로 만들어진 DB가 있다면 host가 검토한 migration을 먼저 설계한다. 이 문서 작성은 사용자 DB를 검사·변경하거나 migration을 실행한 것이 아니다. unsupported stored format은 명시적으로 차단한다.

## R39 구현 연결과 현재 상태 — 비규범적 기록

[현재 source 연결](source-owners.json)은 검토한 경계의 명시적 owner/entrypoint/callPath/negativeTests를 담는다. shared loader `scripts/traceability.mjs`는 실제 clause와 연결을 결합하여 effective row를 만든다. 원본 `traceability.json`의 실행 evidence를 추측하여 채우는 과정이 아니며, 미연결 규범은 UNLINKED/unverified로 남는다. 전체 조항의 source 경로 검토 완료나 formal proof를 선언하지 않는다.

`compliance.mjs --inventory`는 동일 fingerprint와 동일 linkage의 record를 보존하고 변경된 owner/entrypoint/callPath/test는 unverified로 무효화한다. 잘못된/중복 link를 추측으로 고치지 않는다. 일반 checker와 report는 missing/stale/extra/duplicate record 또는 import closure 위반을 통과시키지 않는다. source dependency와 새 negative-test 파일도 현재 proof closure에 포함한다. tests를 proof source pin에 포함하는 것과 production LOC에 포함하는 것은 다른 정책이다.

`adversarial-report.mjs`는 report 생성과 trace inventory 갱신을 분리했다. 이 스크립트는 과거 runtime log를 현재 source hash에 연결하거나 historical `audit-source-pins.json`을 덮어쓰지 않는다. structural inventory 결과와 full-clause 실행 증거는 분리되어 있다.

core T01–T77과 tiered target T78–T90은 실제 규범 matrix row를 각각 조사한다. missing/duplicate/empty oracle은 별도로 실패한다. target 계약의 미확정 범위를 core 완료 수치에 숨기거나 분모 상수만 바꾸지 않는다.

이번 GitHub-only 작업에서 inventory/compliance/report/build/test는 모두 **NOT_RUN**이다. 원본 generated trace/report, historical raw logs와 source pins는 새 실행의 증거가 아니다. 현재 판정은 **release 미인증**이며 세부 범위는 [종료 기록](refactoring-closure.md)과 [검증 상태](validation.md)에 기록했다.
