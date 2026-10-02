# 과거 기록과 문서 이동

현재 지침과 과거 기록을 구분한다. 작성 당시의 current/active/OPEN/PASS와 수치는 현재 상태나 실행 지시가 아니다. 현재 재개점은 [HANDOFF](HANDOFF.md), 실행 판정은 [validation](implementation/validation.md)이 소유한다.

## 저장소 안에 보관한 기록

| 위치 | 보관 내용 | 용도 |
|---|---|---|
| [validation-before-consolidation](archive/validation-before-consolidation.md) | 문서 통합 전 검증 기록 전체 | 당시 로그·source binding·실행 범위·실패 이력 조사 |
| [handoff-before-consolidation](archive/handoff-before-consolidation.md) | 통합 전 긴 인계 기록 | 이전 A~G 요청과 과거 재개 지시의 맥락 |
| [qualification-before-consolidation](archive/qualification-before-consolidation.md) | 기존 spike 실험·채택과 운영 문서의 WP31 지원 기록 | SP 요구와 과거 환경 검증의 맥락 |
| [traceability-before-consolidation](archive/traceability-before-consolidation.json) | 통합 전 fingerprint inventory | 이전 문서 위치·digest·evidence 사실 보존. 현재 trace가 아님 |
| [원래 consistency plan](archive/oma-v2-consistency-plan-b25961c/) | 고정된 입력 계획 전체와 SHA256SUMS | 원문 checksum을 유지한 입력 |
| [외부 리뷰 원문](archive/reviews/) | 외부 리뷰어의 자료 전체 | 원문 bytes를 유지한 과거 점검 |

계획과 외부 리뷰 원문은 부모 디렉터리만 이동했다. 파일 내용을 편집하지 않았다. 현재 clause owner·시험·source locator를 판단할 때는 문서 지도와 기계 판독 map을 따른다. 보관 원문의 오래된 파일 이름은 아래 이동표와 해당 시점의 Git source로 해석한다.

## 문서 위치와 통합

| 이전 위치 | 현재 owner |
|---|---|
| 루트 PRODUCT / PRIORITY-0 / MAINTENANCE / HANDOFF | `docs/`의 같은 이름. HANDOFF는 최신 요청으로 정리하고 이전 전문은 archive |
| 루트 architecture | [고정 기준본](architecture.md). bytes와 N-001 hash 유지 |
| 루트 implementation-spec, implementation/physical-ordering, store-opening, contracts/README, systemd/README | [implementation-spec](implementation-spec.md). 기존 요구 ID·의미 유지 |
| implementation/test-matrix, compliance, loc-budget, spikes, test/fixtures/README 및 validation의 VAL 조항 | [verification-spec](verification-spec.md). 기존 수용 번호와 규범 ID 유지 |
| implementation/validation | [현재 검증 상태](implementation/validation.md). 긴 이전 전문은 archive |
| implementation/integration-policy, consistency-decisions | `docs/implementation/`의 같은 이름. 고정 architecture의 상대 참조 유지 |
| implementation/design-revisions, priority-0-audit | `docs/`의 같은 이름. 작성 당시의 결정·발견 기록 |
| implementation/macos-platform, platform/host/vmhelper/README | [macos-platform](macos-platform.md) |
| implementation/merge-review-spec | [merge-review-spec](merge-review-spec.md). 본문 유지, 이동한 상대 링크만 수정 |
| operations/README | [운영 안내](operations.md). 루트 README의 설치 안내도 여기로 통합 |
| implementation/README, 이전 docs/README의 병렬 색인 | [문서 지도](README.md) 하나로 통합 |
| 루트 consistency plan / review | `docs/archive/`의 입력 원본·리뷰 디렉터리 |

## 이전 Git snapshot

다음 위치는 그 commit 안에서의 경로다. 현재 경로로 바꿔서 `git show`하지 않는다.

| snapshot | 기록 | 당시 위치 |
|---|---|---|
| `5a612c2` | WP00–WP32·AV·ENG1·Priority 0 카드 이력, 첫~열네 번째 감사, 중간 verification | `HANDOFF.md`, `implementation/validation.md` |
| `11b3ae1` | 초기 architecture refinement·proposal·follow-up·closure·과거 raw evidence | `docs/architecture-improvement/`, `docs/proposals/`, `implementation/`의 당시 기록 |

```sh
git show 5a612c2:HANDOFF.md
git show 5a612c2:implementation/validation.md
git show 11b3ae1:implementation/validation.md
git show 11b3ae1:implementation/refactoring-closure.md
git ls-tree -r --name-only 11b3ae1 docs/architecture-improvement
```

과거 finding은 현재 source에서 재현 여부를 새로 판단한다. 과거 PASS·LOC·reviewed hash를 새 source의 증거로 재결박하지 않는다. 새 긴 실행 기록을 현재 지침에 덧붙이지 말고 현재 판정과 해당 시점의 보관 기록을 나눈다.
