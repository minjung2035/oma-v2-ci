# Historical documentation archive

현재 tree는 point-in-time 문서를 유지하지 않는다. 정리 직전 전체 historical 문서 snapshot은 아래 commit에 보존되어 있다.

- Snapshot: `11b3ae1eedbfd381d14e14a62a32d5afe41b875e`
- Branch at snapshot: `refactor/safety-preserving-architecture`

## 보존된 기록

| 종류 | snapshot 위치 |
|---|---|
| P0–P24/P2.5/F1–F4/audit architecture improvement 기록 | `docs/architecture-improvement/` |
| 원 architecture/refinement 제안서 | `docs/proposals/` |
| C01–C07 follow-up | `implementation/conformance-followup.md` |
| R37–R39 refactoring closure | `implementation/refactoring-closure.md` |
| generated adversarial review | `implementation/adversarial-review.md` |
| 과거 raw implementation evidence | `implementation/evidence/` |
| 장문의 누적 verification history | `implementation/validation.md` |

GitHub에서는 다음 snapshot을 직접 열 수 있다.

- https://github.com/minjung2035/oma-v2/tree/11b3ae1eedbfd381d14e14a62a32d5afe41b875e/docs/architecture-improvement
- https://github.com/minjung2035/oma-v2/tree/11b3ae1eedbfd381d14e14a62a32d5afe41b875e/docs/proposals
- https://github.com/minjung2035/oma-v2/blob/11b3ae1eedbfd381d14e14a62a32d5afe41b875e/implementation/validation.md

로컬에서는 다음처럼 조회한다.

```sh
git show 11b3ae1:implementation/validation.md
git show 11b3ae1:implementation/refactoring-closure.md
git ls-tree -r --name-only 11b3ae1 docs/architecture-improvement
```

## 사용 규칙

Historical 기록은 설계 결정의 배경이나 regression 원인을 조사할 때만 사용한다. 그 문서에 적힌 당시 HEAD, PASS/FAIL 수, LOC, owner, TODO, `current` 표현은 현재 사실이 아니다.

현재 판단은 [docs/README.md](README.md)의 active 문서와 current source를 기준으로 한다. 과거 finding이 다시 필요하면 해당 snapshot의 source를 확인한 뒤 현재 HEAD에서 재현 여부를 새로 판단한다.
