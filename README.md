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
| 역할별 모델·extension·프롬프트 설정 | [운영 설정 분리](operations/README.md) |

**로컬 테스트 통과와 release 인증은 다르다.** OPEN SPIKE와 실제 kernel/systemd/provider/power-loss 검증 상태는 검증 문서를 따른다.

## 운영 설정 분리

기존 host 설정을 모델·역할별 파일로 분리할 수 있다. 원본과 기존 출력은 덮어쓰지 않는다.

```sh
npm run config:split -- /path/to/config.json /path/to/new-operations
```

새 설정 경로를 broker/runner에 함께 적용하고 재시작한다. 기본 production runner는 기존 Pi provider/auth를 사용해 prepared mail batch를 처리하고 pinned durable receipt로 완료한다. 상세 형식은 [operations/README.md](operations/README.md)를 참고한다.

## 로컬 검증

Node 및 환경 요구는 [LOC/build 계약](implementation/loc-budget.md)과 [검증 상태](implementation/validation.md)를 확인한다.
TypeScript와 의존성은 lockfile을 사용한다. 명령의 기준은 [package.json](package.json)이다.

```sh
npm ci --include=dev
npm run typecheck
npm run check:architecture
npm test
```

`npm test`는 build/package 검사 후 **로컬 unit/integration**만 실행한다. systemd-required mixed 파일은 명시적으로 `NOT_RUN`으로 출력하며, 그 테스트를 삭제하거나 skip 성공으로 바꾸지 않는다. 로컬 프로세스는 user-manager 명령을 차단한다. Linux/Git/native filesystem 전제는 여전히 각 테스트에 적용된다.


기본 대화/배치 흐름만 실제 Pi provider로 확인하려면 별도의 **비자격 functional profile**을 사용한다. 이 경로는 임시 상태 저장소에서 mail prepare → Pi RPC turn → durable boundary receipt → batch complete만 실행하며 systemd `READY`, S-01 storage quota, candidate integration을 검증하지 않는다. 따라서 성공해도 release/운영 자격 증거가 아니다. 기본값 `pi/current`는 현재 `~/.pi/agent`에 연결된 provider/model/auth를 그대로 사용한다.

```sh
npm run test:functional-pi
npm run test:functional-pi -- --provider openai-codex --model gpt-5.6-sol
```

실패 상태를 조사해야 할 때만 `--keep`을 추가해 임시 디렉터리를 보존한다. 이 smoke와 별개로 production broker는 `quota.storageBytes` state-tree admission과 role별 workspace 제한을 집행한다.
실제 systemd 시험은 **폐기 가능한 전용 test user/VM**에서만 명시적으로 실행한다. `XDG_CONFIG_HOME`을 바꾸는 것만으로 기존 user manager가 격리되지는 않는다. 이 lane은 정확한 소유 unit 파일을 확인하고 disable/제거 후 manager lookup 부재까지 검증한다. cleanup 실패 시 fixture를 보존하고 실패를 보고하며, 다른 unit을 glob으로 정리하지 않는다.

S-01의 unconditional startup `SPIKE_UNRESOLVED`는 제거됐다. `test:systemd`/`verify:kernel`/`verify:all`은 여전히 명시적 opt-in과 전용 user/VM 환경을 요구하며, 실제 manager/READY/kernel 관측 없이 PASS로 취급하지 않는다. `verify:crash`는 별도 전용 manager 환경이 필요하다.

```sh
OMA_TEST_SYSTEMD=1 npm run test:systemd -- --out /tmp/oma-systemd-new
OMA_TEST_SYSTEMD=1 npm run verify:crash -- --out /tmp/oma-crash-new
OMA_TEST_SYSTEMD=1 npm run verify:all -- --out /tmp/oma-all-new
```

각 output은 아직 존재하지 않는 새 디렉터리여야 한다. opt-in 또는 필수 환경이 없으면 **BLOCKED / NOT_RUN**이지 PASS가 아니다. `verify:all`은 전체 compiled 및 MJS suite를 실행하며 로컬 PASS를 systemd/kernel/release proof로 승격하지 않는다. 환경별 상세 명령은 [검증 색인](validation.md)에 있다.
원래 설계 의미는 문서 정리나 refactor 편의를 위해 변경하지 않는다.
