# 2026-10-25 문서 정리 전 기록

현재 안내에서 분리한 문서와 정리 전 원문이다. 파일 본문은 정리 시작 시 bytes 그대로 보존했다. 문서 안의 브랜치·경로·현재/OPEN/PASS·명령·계획은 작성 당시의 내용이며, 지금의 실행 지시나 지원 판정이 아니다.

현재 문서는 [문서 지도](../../README.md), 재개점은 [HANDOFF](../../HANDOFF.md), 실제 검증은 [validation](../../implementation/validation.md)을 따른다. macOS 네이티브 전환이나 새 플랫폼 개편 계획은 이 정리에서 채택·구현하지 않았다.

| 원래 경로 (`docs/` 기준) | 보관 원문 | 성격 |
|---|---|---|
| `HANDOFF.md` | [HANDOFF](HANDOFF.md) | 이전 요청·전환 과정·중간 재개 지시 |
| `implementation/validation.md` | [validation](validation.md) | DR48까지 누적된 실행·실패·입력·한계 전문 |
| `WORKSTREAM.md` | [WORKSTREAM](WORKSTREAM.md) | 오래된 브랜치·병렬 작업 프로토콜·작업 일지 |
| `merge-review-spec.md` | [merge-review-spec](merge-review-spec.md) | 채택 전 merge/review/challenge 설계안 |
| `plan-prereq-and-bundled.md` | [plan-prereq-and-bundled](plan-prereq-and-bundled.md) | Pi 이식·TUI·모드·확장 계획과 당시 실행 기록 |
| `modularization-spec.md` | [modularization-spec](modularization-spec.md) | DR46 구현 명세 기록. 실제 코드 전환과 플랫폼 qualification은 구분 |
| `code-quality-improvement-spec.md` | [code-quality-improvement-spec](code-quality-improvement-spec.md) | DR47 품질 보완의 범위와 수용 기준 기록 |
| `simplification-audit.md` | [simplification-audit](simplification-audit.md) | 2026-10-03 간소화 감사·backlog 당시 판정 |
| `user-expectation-ledger.md` | [user-expectation-ledger](user-expectation-ledger.md) | 제약 조사와 변경 이력 |
| `priority-0-audit.md` | [priority-0-audit](priority-0-audit.md) | 파일별 감사·발견 ID·재현·수정 근거 |
| `limit-bounds.md` | [limit-bounds](limit-bounds.md) | UX-38/DR37/DR39 숫자 제한 조사 원문 |
| `MAINTENANCE.md` | [MAINTENANCE](MAINTENANCE.md) | 정리 전 유지보수 지침 |
| `macos-platform.md` | [macos-platform](macos-platform.md) | 정리 전 VM 플랫폼 문서와 당시 rollout 구상 |

원문의 상대 링크와 source locator는 위 원래 위치 및 당시 Git source 기준으로 해석한다. 링크를 고치기 위해 과거 실행·승인 bytes를 재작성하지 않는다. 현재 source owner는 현재 계약과 기계 판독 map으로 확인한다. 고정 architecture와 원래 consistency plan·외부 리뷰 원문은 이번 정리에서 바꾸지 않았다.
