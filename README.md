# OMA v2

Principal과 Resident가 Unix 메일링 리스트·Git을 통해 협업하는 orchestration runtime이다.
단일 broker/SQLite writer, durable operation intent, immutable evidence, 명시적 unknown과 crash recovery를 핵심 경계로 유지한다.

## 어디서 시작할까

| 목적 | 문서 |
|---|---|
| 현재 작업 상태·다음 재개점 | [HANDOFF.md](HANDOFF.md) |
| 실제 실행 결과·미검증 범위 | [implementation/validation.md](implementation/validation.md) |
| 모든 문서와 변경 이력 탐색 | [docs/README.md](docs/README.md) |
| 수정·리뷰 원칙 | [MAINTENANCE.md](MAINTENANCE.md) |
| 아키텍처 계약 | [architecture.md](architecture.md) · [implementation-spec.md](implementation-spec.md) |
| 구현 계약·배포 템플릿 지도 | [implementation/README.md](implementation/README.md) |

**로컬 테스트 통과와 release 인증은 다르다.** OPEN SPIKE와 실제 kernel/systemd/provider/power-loss 검증 상태는 검증 문서를 따른다.

## 로컬 검증

Node 및 환경 요구는 [LOC/build 계약](implementation/loc-budget.md)과 [검증 상태](implementation/validation.md)를 확인한다.
TypeScript와 의존성은 lockfile을 사용한다. 명령의 기준은 [package.json](package.json)이다.

```sh
npm ci --include=dev
npm run typecheck
npm run check:architecture
npm test
```

`npm test`는 build/package 검사 후 전체 테스트를 실행한다. 환경별 verification lane과 evidence 생성 명령은 [검증 색인](validation.md)에 있다.
원래 설계 의미는 문서 정리나 refactor 편의를 위해 변경하지 않는다.
