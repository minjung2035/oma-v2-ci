# OMA v2 검증 색인

현재 실행 결과·source pin·미검증 범위는 **[implementation/validation.md](implementation/validation.md)**가 기준이다.
이 파일은 명령과 관련 문서를 안내하며, 별도의 현재 결과표를 유지하지 않는다.

## 관련 문서

| 목적 | 문서 |
|---|---|
| 실제 실행 결과·NOT_RUN·release 게이트 | [현재 검증 상태](implementation/validation.md) |
| 현재 재개점 | [HANDOFF.md](HANDOFF.md) |
| 상태 어휘·evidence 관리 원칙 | [MAINTENANCE.md §26](MAINTENANCE.md#26-검증-상태와-증거) |
| requirement별 release evidence 계약 | [compliance.md](implementation/compliance.md) |
| acceptance oracle·OPEN 구현 gate | [test-matrix.md](implementation/test-matrix.md) · [spikes.md](implementation/spikes.md) |
| P10–P15 변경·적대적 검증 | [실행 보고서](docs/architecture-improvement/p10-p15-adversarial-review.md) |
| 과거 검증·단계별 기록 | [문서 전체 색인](docs/README.md) |

Source 수정, test 작성, static review, test 실행, 실제 systemd/kernel 검증, release proof는 서로 다르다.
과거 PASS나 generated artifact를 current source의 실행 증거로 자동 승격하지 않는다.

## 재검증 entry

실제 명령 정의는 [package.json](package.json)이 기준이다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
node scripts/loc.mjs
```

`inventory`는 source list만 생성한다. LOC/hash는 pinned cloc를 사용하는 `node scripts/loc.mjs`로 재측정한다.
Dependency source/edge가 바뀌었다면 `npm run evidence:graph`로 evidence를 재생성하고 diff를 검토한 뒤 architecture gate를 다시 실행한다.
Generated list·LOC·hash·evidence를 손으로 맞추지 않는다.

## 환경별 lane

```sh
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
```

각 `<new-dir>`는 기존 artifact를 덮지 않는 서로 다른 새 directory로 지정한다.
필요한 환경이 없으면 PASS가 아니라 BLOCKED/NOT_RUN으로 기록한다.
VM power-cut은 일반 개발 host에서 실행하지 않으며 [P9 기록](docs/architecture-improvement/p9-powercut-fuzz.md)의 disposable-VM guard와 실행 절차를 먼저 확인한다.
