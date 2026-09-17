# OMA v2 — 현재 인계

현행 범위: EML/CLI 및 운영 설정 분리에 이어 S-01 기본 storage admission과 S-03 production Pi followUp 경로를 활성화했다. 기준 HEAD는 `5c94e59c913bf1b6bd96f02307a99882e776077f`다.
작업 브랜치는 `refactor/safety-preserving-architecture`다. 재개할 때 실제 HEAD와 working tree를 먼저 확인한다.

## 현재 판정

- P10–P23 구조·계약 경계를 유지하며 선택한 staging/파일 handoff에 openat2/dirfd와 검증 fd 전달을 적용했다. 전체 same-UID filesystem/SQLite VFS 방어를 완료했다는 뜻은 아니다.
- F1의 입력 오류와 실제 `STORE_CORRUPT` 차단을 분리했다. F2의 누락된 request 값은 준비 전 거절하고, F3의 log frame 예산과 F4의 host/CLI 공통 한도를 적용했다.
- 공용 EML 사전 검증과 긴 subject 인코딩, broker-known 기반 bundle과 private 임시 파일 정리, 파일 본문 CRLF 정규화 및 원문 reply 제목을 적용했다. 계약·회귀·비보장 범위는 [이번 감사 후속](docs/architecture-improvement/audit-eml-cli-remediation.md)에 있다.
- 모델·role 정책·prompt·extension 목록은 [분리 운영 설정](operations/README.md)으로 관리한다. Production runner는 기존 Pi provider/auth로 prepared batch를 전달하고 exact trusted receipt가 있어야 presented를 commit한다. 별도 S-03 `SPIKE_UNRESOLVED` gate는 제거했다.
- `npm run test:functional-pi`는 실제 `pi/current` → `openai-codex/gpt-5.6-luna`, `oma_mail_read` 1회, session persist, presented=1을 확인했다. 이 경로는 임시 state의 **UNQUALIFIED functional profile**이며 production READY/storage/systemd 증거가 아니다.
- 실제 실행 판정·정확한 범위·source pin은 **[현재 검증 상태](implementation/validation.md)** 한 곳에서 확인하고 현재 working tree와 대조한다.
- 이는 release-ready 선언이 아니다. 실제 환경 검증과 OPEN SPIKE, LOC 승인 조건은 남아 있다.
- Broker는 positive `quota.storageBytes`에서 시작하며 state-tree admission, streamed request reservation, role별 workspace 제한으로 초과를 거절한다. 이전의 unconditional S-01 startup `SPIKE_UNRESOLVED`는 제거했다.
- 과거 인계의 “P5/P7 미완료”, “phase5 smoke 실패”, “pinned typecheck 미실행”은 현재 재개 작업이 아니다.

## 유지하는 구조 경계

- `scripts/dependency-graph.mjs`: production TypeScript Program의 source/edge 공용 owner.
- `scripts/kernel-zones.mjs`: L1 kernel의 파일별 semantic zone과 방향 정책.
- `src/broker/public-dispatcher.ts`, `internal-dispatcher.ts`: exhaustive method–params dispatch와 consumer-owned capability.
- `src/broker/composition.ts`: 필요한 함수·agent view만 새 객체로 전달하며 Broker의 auth/lifetime callback은 유지.
- `src/ports/ledger.ts`, `runtime.ts`: erased internal contracts. `module-ports.ts`는 호환 facade, class conformance는 `entry/module-conformance.ts`.
- `src/storage/receipt-projector.ts`: validated ledger → wire receipt projection. `ValidatedPlan` 발급은 K3에 유지.
- `test/architecture-oracles.test.mjs`, `p11-p12-dispatch.test.mjs`, `architecture-evolution.test.mjs`: 독립 oracle과 실제 production 변경 누락 검증.

F1–F4의 계약 해석·테스트·비보장 범위는 [후속 수정 기록](docs/architecture-improvement/f1-f4-remediation.md)에 있다. sandbox 밖 CLI도 비기본 host와 같은 `OMA_FRAME_BYTES`를 전달해야 한다.

앞선 deployment digest codec·비보장 범위는 [P24 감사 후속](docs/architecture-improvement/p24-remediation.md)과 [filesystem 기록](docs/architecture-improvement/p24-filesystem-containment.md), 기존 소유권과 좁은 v1 호환 예외는 [P23 기록](docs/architecture-improvement/p23-contract-ownership.md)을 따른다. 이전 경계는 [P16–P22 기록](docs/architecture-improvement/p16-p22-refinement.md)과 [P10–P15 보고서](docs/architecture-improvement/p10-p15-adversarial-review.md), 단계별 탐색은 [진행 색인](docs/architecture-improvement/progress.md)에 있다.

## 다음 작업

1. 새 변경을 시작하기 전에 현재 branch/HEAD, working tree, 요구사항과 OPEN gate를 확인한다.
2. release 검증을 진행한다면 필요한 host/VM/profile을 준비하고 미실행 lane과 실제 환경 evidence를 별도로 수집한다. 구체적인 남은 범위는 [검증 상태](implementation/validation.md#3-남은-검증과-release-게이트)에 있다.
3. production LOC가 기준을 초과한다. 구조 검토 보고서가 있다는 이유만으로 A-008/A-009 승인을 완료 처리하지 않는다.
4. 이미 끝난 P5/P7이나 contract migration을 오래된 일지에 따라 다시 구현하지 않는다.
5. 별도 구조적 필요가 확인되기 전 internal contract 영역의 추가 refactoring은 진행하지 않는다.

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
