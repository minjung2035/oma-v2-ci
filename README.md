# OMA v2

Principal과 Resident가 Unix 메일링 리스트·Git을 통해 협업하는 orchestration runtime이다. 단일 broker/SQLite writer, durable operation intent, immutable evidence, explicit unknown, crash recovery를 핵심 경계로 유지한다.

## 실행

사용자 진입점은 `oma` 하나다. Pi는 내부 실행 엔진이며 사용자가 Pi 명령 체계를 알 필요는 없다.

```sh
oma --society <name>
```

대화 화면이 기본이고 `Ctrl+X`로 Dashboard / Config / Mail 관리 화면을 연다. 설정은 값을 확정하는 즉시 저장되며 각 항목이 언제 적용되는지 화면에 표시한다. 자세한 계약은 [architecture.md](architecture.md) §23과 [implementation-spec.md](implementation-spec.md) §19에 있다.

`oma`라는 이름은 두 곳에서 쓰인다. host에 설치되는 위 실행 파일은 사람이 쓰는 TUI이고, Resident sandbox 안의 동명 실행 파일은 모델이 쓰는 `send`/`submit`/`agent`/`status` CLI다. 서로 다른 바이너리이며 argv 파서·권한·소켓을 공유하지 않는다.

## 문서 읽기 순서

| 목적 | 문서 |
|---|---|
| 수정 전에 지켜야 할 작업 규율 | [MAINTENANCE.md](MAINTENANCE.md) |
| 최상위 아키텍처 계약 | [architecture.md](architecture.md) |
| 구현 MUST/MUST NOT 계약 | [implementation-spec.md](implementation-spec.md) |
| 현재 implementation 계약·machine-readable map | [implementation/README.md](implementation/README.md) |
| 현재 브랜치의 재개점 | [HANDOFF.md](HANDOFF.md) |
| 현재 검증 상태와 실행 명령 | [implementation/validation.md](implementation/validation.md) |
| 운영 설정 | [operations/README.md](operations/README.md) |
| 과거 phase/audit/proposal 조회 | [docs/archive.md](docs/archive.md) |

현재 tree의 README/HANDOFF에는 과거 PASS 수, 당시 LOC, phase별 완료 보고서를 반복하지 않는다. 과거 기록은 Git history에 보존하며 현재 판단에는 current source와 fresh verification만 사용한다.

## 개발 루프

명령 정의의 기준은 [package.json](package.json)이다.

```sh
npm ci --include=dev
npm run typecheck
npm run check:architecture
npm test
```

mutation 작업은 검색으로 owner를 추론하기 전에 machine-readable map을 먼저 본다.

```sh
npm run mutation:locality -- git.submit
```

`check:architecture`는 modular rule checker와 기존 architecture/transaction gate를 함께 실행한다. Generated inventory, LOC, dependency evidence를 사람이 새 측정처럼 손으로 맞추지 않는다.

환경이 필요한 kernel/systemd/crash/provider 검증은 로컬 unit test와 별개다. 필요한 환경이 없으면 PASS가 아니라 `BLOCKED` 또는 `NOT_RUN`이며, 정확한 현재 판정은 [implementation/validation.md](implementation/validation.md)에만 기록한다.

## 운영 설정

역할별 model, prompt, extension, resource 정책은 [operations/README.md](operations/README.md)의 분리 설정 형식을 따른다. Wire/DB/persisted v1 의미를 운영 편의나 문서 정리를 이유로 바꾸지 않는다.
