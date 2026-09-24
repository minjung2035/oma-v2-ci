# OMA v2

Principal과 Resident가 Unix 메일링 리스트·Git을 통해 협업하는 orchestration runtime이다. 단일 broker/SQLite writer, durable operation intent, immutable evidence, explicit unknown, crash recovery를 핵심 경계로 유지한다.

## 실행

사용자 진입점은 `oma` 하나다. Pi는 내부 실행 엔진이며 사용자가 Pi 명령 체계를 알 필요는 없다.

```sh
node <설치 디렉터리>/dist/src/entry/oma.js
```

설치 단위는 빌드된 트리다(`npm ci && npm run build`; `npm run check:package`가 그 트리를 설치본으로 검사한다). 이 package는 `bin`이나 전역 설치 명령을 선언하지 않으므로 `oma`라는 명령이 PATH에 생기지 않는다. 짧게 부르려면 운영자가 위 entry를 가리키는 alias나 wrapper를 둔다. 이 문서에서 `oma`는 이 entry를 뜻한다([지원 범위](operations/README.md#지원-범위-wp31)).

설정 파일을 쓰거나 초기화 명령을 실행할 필요는 없다. 프로젝트 디렉터리에서 그냥 실행하면 society 이름을 프로젝트의 실제 경로에서 유도하고(이름 slug + 경로 digest), 그 society를 이 프로젝트에 묶은 뒤 보수적인 기본 설정을 만들고 시작한다. 다른 society를 쓰려면 `--society <name>`을 주되, 다른 프로젝트에 묶인 society는 열리지 않는다([운영 설정](operations/README.md#프로젝트-식별과-바인딩-d05-wp16)).

로그인·모델 선택은 **동봉 엔진이 이미 가진 흐름**을 그대로 쓴다. OMA가 별도의 인증·모델 관리 화면을 만들지 않는다.

Pi를 따로 설치할 필요는 없다. OMA는 자기 Pi 엔진을 함께 배포하고 그것만 실행하며, `PATH`의 Pi를 찾지 않는다. 사용자가 이미 Pi를 쓰고 있어도 서로 간섭하지 않는다. OMA가 띄우는 엔진은 자기 복사본이고, 설정·extension·session도 society state root 아래의 별도 디렉터리를 쓰기 때문에 사용자의 `~/.pi`를 읽지도 쓰지도 않는다.

대화 화면이 기본이고 `Ctrl+X`로 Dashboard / Config / Mail 관리 화면을 연다. 설정은 값을 확정하는 즉시 저장되며 각 항목이 언제 적용되는지 화면에 표시한다. 자세한 계약은 [architecture.md](architecture.md) §23과 [implementation-spec.md](implementation-spec.md) §18에 있다.

`oma`라는 이름은 두 곳에서 쓰인다. host에 설치되는 위 실행 파일은 사람이 쓰는 TUI이고, Resident sandbox 안의 동명 실행 파일은 모델이 쓰는 `send`/`submit`/`agent`/`status` CLI다. 서로 다른 바이너리이며 argv 파서·권한·소켓을 공유하지 않는다.

## 문서 읽기 순서

| 목적 | 문서 |
|---|---|
| 무엇을 만들고 있는지 | [PRODUCT.md](PRODUCT.md) |
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
