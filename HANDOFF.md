# OMA v2 — 현재 인계

문서 정리 기준: `930053c307785106b0a881975cad596c943e8ac1` (2026-09-14).
작업 브랜치는 `refactor/safety-preserving-architecture`다. 재개할 때 실제 HEAD와 working tree를 먼저 확인한다.

## 현재 판정

- P10–P15 dependency/capability 정제와 적대적 검증·수정은 완료했다.
- 최신 전체 테스트와 fast lane은 통과했다. 정확한 실행 범위·개수·source pin은 **[현재 검증 상태](implementation/validation.md)** 한 곳에서 확인한다.
- 이는 release-ready 선언이 아니다. 실제 환경 검증과 OPEN SPIKE, LOC 승인 조건은 남아 있다.
- 과거 인계의 “P5/P7 미완료”, “phase5 smoke 실패”, “pinned typecheck 미실행”은 현재 재개 작업이 아니다.

## 이번에 고정한 경계

- `scripts/dependency-graph.mjs`: production TypeScript Program의 source/edge 공용 owner.
- `scripts/kernel-zones.mjs`: L1 kernel의 파일별 semantic zone과 방향 정책.
- `src/broker/public-dispatcher.ts`, `internal-dispatcher.ts`: exhaustive method–params dispatch와 consumer-owned capability.
- `src/broker.ts`: 필요한 함수만 전달하는 composition projection.
- `src/module-ports.ts`: 선언만 소유. 실제 class conformance는 `src/entry/module-conformance.ts`에서 검사.
- `test/architecture-oracles.test.mjs`, `test/p11-p12-dispatch.test.mjs`: 독립 SCC·syntax mutation·실제 handler/capability 음성 대조군.

상세 변경과 근거는 [P10–P15 보고서](docs/architecture-improvement/p10-p15-adversarial-review.md), 단계별 탐색은 [진행 색인](docs/architecture-improvement/progress.md)을 따른다.

## 다음 작업

1. 새 변경을 시작하기 전에 현재 branch/HEAD, working tree, 요구사항과 OPEN gate를 확인한다.
2. release 검증을 진행한다면 필요한 host/VM/profile을 준비하고 미실행 lane과 실제 환경 evidence를 별도로 수집한다. 구체적인 남은 범위는 [검증 상태](implementation/validation.md#3-남은-검증과-release-게이트)에 있다.
3. production LOC가 기준을 초과한다. 구조 검토 보고서가 있다는 이유만으로 A-008/A-009 승인을 완료 처리하지 않는다.
4. 이미 끝난 P5/P7이나 contract migration을 오래된 일지에 따라 다시 구현하지 않는다.

기본 재개 확인:

```sh
git status --short
git branch --show-current
git rev-parse HEAD
npm run typecheck
npm run check:architecture
```

추가 검증 명령과 fresh output directory 규칙은 [검증 색인](validation.md)에 있다. master 자동 병합·force push는 하지 않는다.

## 유지할 계약

단일 broker/SQLite writer, 동기 transaction, immutable accepted v1 evidence, explicit unknown,
normal/recovery 판단 분리, effect 직전의 current-authority/incarnation 재검증, bounded effect를 유지한다.
Wire/DB/persisted v1 계약과 OPEN SPIKE를 문서 정리로 바꾸지 않는다.
동결 계약 디렉터리의 formatter 비활성화는 formatting만 막으며 타입·계약 검사를 면제하지 않는다.
전체 수정 원칙은 [MAINTENANCE.md](MAINTENANCE.md), 규범 문서 지도는 [implementation/README.md](implementation/README.md)에 있다.

## 과거 기록

이전 장문의 인계는 [930053c의 HANDOFF snapshot](https://github.com/minjung2035/oma-v2/blob/930053c307785106b0a881975cad596c943e8ac1/HANDOFF.md)에 보존한다.
단계별 보고서와 원문 제안서는 [문서 전체 색인](docs/README.md)에서 찾는다. 과거의 현재/미완료/PASS 표기는 그 기록 시점에만 적용된다.
