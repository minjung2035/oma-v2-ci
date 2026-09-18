# OMA v2 — 현재 인계

작업 브랜치는 `refactor/safety-preserving-architecture`다. 검토 기준 HEAD는 `fd58193ebe38022f175d260735711e315f02e8d8`이며, working tree에는 최근 CLI refactor에 맞춘 회귀 test 수정과 재생성 evidence가 있다.

## 현재 판정

현재 우선순위는 새 architecture를 추가하는 것이 아니라 **AI가 기존 설계를 적은 문맥으로 안전하게 수정할 수 있게 하는 것**이다.

최근 code-changing 작업에서 다음을 반영했다.

- CLI entrypoint를 얇게 만들고 command, argument parsing, request freeze/replay, transport, exit, local effect preparation을 분리했다.
- durable mutation별 owner/change surface를 `implementation/mutation-owners.json`에 machine-readable하게 기록했다.
- `npm run mutation:locality -- <mutation>`으로 central registry symbol, runtime owner, direct tests, unique file surface를 조회할 수 있다.
- architecture checker에 import / transaction / ownership / schema duplication / contract direction / effect ownership rule module을 추가했다.
- contract → implementation 역의존 4개를 0으로 줄이기 위한 순서를 `implementation/contract-direction-plan.json`에 고정했다.
- broker lifecycle 추가 분리는 locality가 실제로 좋아지는 증거가 생길 때까지 보류했다. 기준은 `implementation/broker-lifecycle-review.json`에 있다.
- `src/durable.ts`, `src/validate.ts`, `src/protocol/methods.ts`는 중앙 registry 성격을 유지하며 무조건 분해하지 않는다.

## 현재 검증 상태

최근 10개 commit 검토와 fresh local verification을 분리 worktree에서 수행했다. 발견한 1건은 production 결함이 아니라 CLI mail-header leaf owner 이동 후 남은 stale regression assertion이었고, 실제 owner인 `src/cli/effects/mail.ts`를 검사하도록 수정했다.

명령과 수치, 환경 한계는 [implementation/validation.md](implementation/validation.md)가 소유한다. 기본 local suite는 현재 PASS지만 live systemd/kernel/provider/VM qualification으로 확대해 해석하지 않는다.

GitHub Actions/CI는 이번 작업 범위에서 수정하거나 qualification 근거로 사용하지 않았다.

다음 code 변경 전에도 최소한 다음 로컬 루프를 실행한다.

```sh
npm run typecheck
npm run check:architecture
npm test
```

dependency/import surface가 바뀌었다면 `npm run evidence:graph`로 current evidence를 재생성한 뒤 architecture gate를 다시 실행한다.

## 작업할 때 먼저 볼 것

mutation을 수정한다면 검색부터 하지 말고 다음 순서로 시작한다.

```sh
npm run mutation:locality -- git.submit
```

그 결과가 가리키는 `implementation/mutation-owners.json`의 symbol/path를 읽고 필요한 owner만 연다. 중앙 registry 전체를 임의로 분해하지 않는다.

contract cleanup을 진행한다면 `implementation/contract-direction-plan.json`의 순서를 따른다. broker lifecycle은 `implementation/broker-lifecycle-review.json`의 split trigger가 실제로 충족될 때만 추가 추출한다.

## 문서 규율

현재 문서 지도는 [docs/README.md](docs/README.md) 하나에서 시작한다. 과거 P0–P24, proposal, audit/closure, 누적 verification log는 active tree에서 제거했으며 [docs/archive.md](docs/archive.md)의 정리 직전 Git snapshot에서 조회한다.

장문의 commit 목록, 과거 test count, 당시 LOC를 HANDOFF에 다시 누적하지 않는다. 영구 규율은 `MAINTENANCE.md`, 실행 결과는 `implementation/validation.md`, architecture 의미는 `architecture.md` / `implementation-spec.md`가 각각 소유한다.

## 변경하지 않는 기본 계약

단일 broker/SQLite writer, synchronous transaction, immutable accepted v1 evidence, explicit unknown, normal/recovery 판단 분리, effect 직전 current authority/incarnation 재검증, bounded effect를 유지한다.

문서 정리나 refactor 편의를 이유로 wire/DB/persisted v1 의미 또는 OPEN release gate를 바꾸지 않는다.
