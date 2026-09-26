# 과거 기록

현재 tree는 과거 시점의 기록을 두지 않는다([문서 지도](README.md)). 현재 tree에서 뺀 기록은 뺀 직전의 commit에 그대로 있다.
그 기록에 적힌 당시 HEAD, PASS/FAIL 수, LOC, owner, TODO, `current` 표현은 지금의 사실이 아니다.

## snapshot

| snapshot | 뺀 기록 | 위치 |
|---|---|---|
| `5a612c2` (2026-09-26, 문서 정리 직전) | 카드별 commit·바뀐 의미·남긴 한계 표(WP00–WP32, AV1–AV8, ENG1, 재검토, Priority 0) | `HANDOFF.md` §5–§6a |
| | 첫~열네 번째 감사와 "TUI/Tool Surface 정합성 개선안 R1"의 기록("기존 검토 맥락 — 현재 source 실행 증거 아님") | `implementation/validation.md` 106–1024행 |
| | 통합 검증 중간 회차의 행(v3–v17)과 카드별 행의 v18 배치 | `implementation/validation.md` "현재 source 판정" |
| `11b3ae1` (첫 문서 정리 직전) | P0–P24/P2.5/F1–F4/audit architecture improvement 기록 | `docs/architecture-improvement/` |
| | 원 architecture/refinement 제안서 | `docs/proposals/` |
| | C01–C07 follow-up | `implementation/conformance-followup.md` |
| | R37–R39 refactoring closure | `implementation/refactoring-closure.md` |
| | generated adversarial review | `implementation/adversarial-review.md` |
| | 과거 raw implementation evidence | `implementation/evidence/` |
| | 장문의 누적 verification history | `implementation/validation.md` |

두 snapshot 모두 브랜치 `refactor/safety-preserving-architecture`에 있다. 지금 남아 있는 한계는 과거 기록이 아니라 [validation.md](../implementation/validation.md)의 "알려진 한계"가 소유한다.

## 조회

```sh
git show 5a612c2:HANDOFF.md
git show 5a612c2:implementation/validation.md | sed -n '106,1024p'
git show 11b3ae1:implementation/validation.md
git show 11b3ae1:implementation/refactoring-closure.md
git ls-tree -r --name-only 11b3ae1 docs/architecture-improvement
```

GitHub에서는 `11b3ae1`의 기록을 직접 열 수 있다(`5a612c2`는 push하지 않았다).

- https://github.com/minjung2035/oma-v2/tree/11b3ae1eedbfd381d14e14a62a32d5afe41b875e/docs/architecture-improvement
- https://github.com/minjung2035/oma-v2/tree/11b3ae1eedbfd381d14e14a62a32d5afe41b875e/docs/proposals
- https://github.com/minjung2035/oma-v2/blob/11b3ae1eedbfd381d14e14a62a32d5afe41b875e/implementation/validation.md

## 쓰는 법

과거 기록은 설계 결정의 배경이나 회귀의 원인을 조사할 때만 쓴다. 과거 finding이 다시 필요하면 그 snapshot의 source를 확인한 뒤 현재 HEAD에서 재현 여부를 새로 판단한다.
