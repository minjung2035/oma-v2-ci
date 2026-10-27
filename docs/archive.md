# 과거 기록과 미채택 계획

현재 지침은 [문서 지도](README.md), 재개점은 [HANDOFF](HANDOFF.md), 실행 판정은 [validation](implementation/validation.md)이 소유한다. 이 문서에서 연결한 기록의 current·active·OPEN·PASS·브랜치·명령은 해당 시점의 내용이다. 현재 작업 지시나 새 입력의 검증으로 사용하지 않는다.

## 최근 정리에서 분리한 기록

[2026-10-25 보관 색인](archive/documentation-cleanup-2026-10-25/README.md)에 정리 전 원문과 원래 경로를 모았다.

| 기록 | 내용 |
|---|---|
| [native spec 개정 전](archive/macos-native-spec-2026-10-28-pre-redesign.md), [native 인계 개정 전](archive/native-handoff-2026-10-28-pre-redesign.md) | 2026-10-28 전면 개정 직전 원문. 원래 경로는 각각 docs/macos-native-spec.md, docs/HANDOFF.md이며 당시 링크와 중단 지시는 역사 자료 |
| [이전 HANDOFF](archive/documentation-cleanup-2026-10-25/HANDOFF.md), [이전 validation](archive/documentation-cleanup-2026-10-25/validation.md) | DR46–DR48 전환·중간 실패·과거 실행 입력·재개 지시 전문 |
| [WORKSTREAM](archive/documentation-cleanup-2026-10-25/WORKSTREAM.md) | 이전 브랜치·작업 프로토콜·긴 작업 일지 |
| [merge/review 설계안](archive/documentation-cleanup-2026-10-25/merge-review-spec.md) | 당시 제안한 다음 정책. 현재 활성 계약으로 채택하지 않음 |
| [Pi·bundled extension 계획](archive/documentation-cleanup-2026-10-25/plan-prereq-and-bundled.md) | 이식·TUI·모드·확장 작업의 초안과 당시 실행 결과 |
| [DR46 모듈화 명세](archive/documentation-cleanup-2026-10-25/modularization-spec.md), [DR47 품질 명세](archive/documentation-cleanup-2026-10-25/code-quality-improvement-spec.md) | 승인된 구현 범위와 수용 기준 기록. 현재 source 구조와 실행 결과는 각각 책임 경계·validation을 따름 |
| [간소화 감사](archive/documentation-cleanup-2026-10-25/simplification-audit.md), [사용자 기대 장부](archive/documentation-cleanup-2026-10-25/user-expectation-ledger.md) | 당시 제약·개선 분류·backlog |
| [Priority 0 감사](archive/documentation-cleanup-2026-10-25/priority-0-audit.md) | 발견 ID·재현·수정·미해결 범위 원문 |
| [숫자 제한 장부](archive/documentation-cleanup-2026-10-25/limit-bounds.md) | UX-38/DR37/DR39 당시 값과 source 경로 |
| [이전 유지보수 지침](archive/documentation-cleanup-2026-10-25/MAINTENANCE.md), [이전 Mac 문서](archive/documentation-cleanup-2026-10-25/macos-platform.md) | 정리 전 지침·source 안내·rollout 구상 |

원문 bytes는 유지했다. archive 안의 상대 링크와 source locator는 보관 색인의 원래 경로 및 당시 Git source 기준으로 해석한다. 현재 source owner나 새 작업을 판단할 때는 현재 문서와 기계 판독 map을 사용한다.

## 이전부터 보관한 입력

| 위치 | 내용 |
|---|---|
| [validation-before-consolidation](archive/validation-before-consolidation.md) | 첫 문서 통합 전 검증·입력·실패 이력 |
| [handoff-before-consolidation](archive/handoff-before-consolidation.md) | 첫 통합 전 요청과 인계 전문 |
| [qualification-before-consolidation](archive/qualification-before-consolidation.md) | spike 실험·채택·WP31 당시 환경 기록 |
| [traceability-before-consolidation](archive/traceability-before-consolidation.json) | 이전 위치·fingerprint·evidence 입력. 현재 trace 아님 |
| [원래 consistency plan](archive/oma-v2-consistency-plan-b25961c/) | SHA256SUMS가 결박한 고정 계획 원문 |
| [외부 리뷰](archive/reviews/) | 외부 리뷰어의 원문 자료 |
| `archive/handoff-before-dr39.md`부터 `handoff-before-dr46.md`까지 저장된 파일 | 각 변경 전 인계. 빠진 번호를 새 문서가 있다고 해석하지 않음 |

고정 계획과 외부 리뷰의 본문·checksum은 변경하지 않는다. 과거 검증의 근거 파일·요구 ID·수용 번호·검토 상태도 재승인하지 않는다.

## 현재 위치를 찾는 방법

루트에 있던 제품·원칙·유지보수·인계 문서는 `docs/`로 모았다. Core와 physical ordering·Store·unit renderer 계약은 [implementation-spec](implementation-spec.md), 시험·qualification·LOC·fixture 계약은 [verification-spec](verification-spec.md)이 소유한다. 고정 [architecture](architecture.md)의 상대 참조를 위해 `docs/implementation/` 문서와 [unit 계약 안내](implementation/systemd/README.md)는 유지한다.

실행 가능한 계약·SQL·자산은 현재 workspace 안에 있다. 실제 위치는 [책임 경계](application-boundaries.md)와 source-owner map으로 확인한다. 이전 루트 `src` 경로는 현재 runtime API가 아니다.

## Git snapshot 조회

아래 경로는 해당 commit 안에서의 위치다. 현재 경로로 바꿔 `git show`하지 않는다.

```sh
git show 5a612c2:HANDOFF.md
git show 5a612c2:implementation/validation.md
git show 11b3ae1:implementation/validation.md
git show 11b3ae1:implementation/refactoring-closure.md
git ls-tree -r --name-only 11b3ae1 docs/architecture-improvement
```

과거 finding은 현재 코드에서 재현 여부를 다시 판단한다. 과거 PASS·LOC·reviewed hash는 새 source의 결과가 아니다.
