# 협업 표면의 구현·검증 위치

[총괄 명세](../model-collaboration-surface-spec.md)와 하위 문서의 요구 ID·수용 시나리오를 유지한다. 아래 표는 코드를 찾는 안내이며 요구별 완료 판정이 아니다. 최신 전체 실행 결과와 한계는 [검증 상태](validation.md)에 있다.

| 영역 | 주요 구현 | 검증 위치 |
|---|---|---|
| 역할별 행동·도구 그룹 | `packages/domain/src/collaboration-surface.ts`, `packages/extension/src/collaboration-tools.ts`, `packages/tool-runtime/src/tool-surface.ts` | `packages/extension/test/collaboration-registration.test.mjs`, `packages/tool-runtime/test/collaboration-groups.test.mjs`, `test/tool-surface.test.ts` |
| 원래 호출·재접속·재실행 | `packages/client/src/request-service.ts`, `apps/oma/src/runtime/host-invocations.ts` | `test/collaboration-invocations.test.ts`, `test/collaboration-client-create-recovery.test.ts`, `test/collaboration-client-review-recovery.test.ts` |
| 역할별 기록·일반 파일 읽기 | `apps/oma/src/views`, `packages/mail/src/records.ts` | `test/collaboration-mail-read-bounds.test.ts`, `test/collaboration-review-records.test.ts`, `test/delivery-index-absence.test.ts` |
| Mail·Git·Review 효과와 복구 | `packages/mail`, `packages/git`, `packages/review` | `test/collaboration-attachment-boundaries.test.ts`, `test/collaboration-projection-boundaries.test.ts`, `test/collaboration-scenario-review.test.ts` |
| 생성·수명·용량·Human 제어 | `packages/lifecycle`, `apps/oma/src/runtime/human-controls.ts` | `test/collaboration-create-boundaries.test.ts`, `test/collaboration-client-state-actions.test.ts`, `test/worker-capacity.test.ts` |
| 손상·권한·과거 사실 | 기존 Store·domain validator·accepted plan owner | `test/context-recovery-corruption-oracle.test.ts`, `test/collaboration-retired-integration.test.ts`, `test/scenario-agent-wait.test.ts` |

테스트 이름은 파일 안에서 `001. 동작 설명` 형식이다. 반복 입력은 이름에 조건을 붙이며, 요구 ID와 연결은 `implementation/source-owners.json`, `implementation/durable-boundaries.json`, `implementation/oracle-map.json`에서 관리한다. 이름의 번호는 요구 ID나 전역 실행 순번이 아니다.

[정리 전 요구별 추적표](../archive/cleanup-2026-11-03/implementation/collaboration-v1-trace.md)의 PARTIAL·NOT_RUN은 당시 입력의 기록이다. 현재 전체 테스트가 실패하는 동안 이 표를 구현 완료나 플랫폼·provider 검증 완료로 읽지 않는다.
