# OMA v2 — 현재 인계

작업 브랜치는 `refactor/safety-preserving-architecture`다. 제품 표면(TUI)은 `ee5d12b`에 있고, tool 표면 투영은 그 위에 얹혔다.

## 이 제품이 무엇인지

[PRODUCT.md](PRODUCT.md)가 의도를 소유한다. 한 줄로: **Pi를 의존성으로 삼는 새로운 코딩 에이전트**이며, `npm install` 뒤에 `oma` 한 번으로 바로 쓸 수 있어야 한다. 규범이 아니므로 충돌 시 architecture/spec이 우선한다.

## 현재 판정

**구조 개선 작업은 종료했다.** 남은 아키텍처 부채였던 contract 역의존이 0이 됐고, 이후로는 소규모 기능과 TUI 변경만 수행한다.

- `contract-direction-plan.json`의 네 alias가 모두 사라졌다. `Capability`/`ResourceLimits`/`ProtocolLimits`는 contract가 선언하고 runtime descriptor가 양방향 compile-time 검사로 묶인다. `Transaction`은 소비자가 없어 port로 대체하지 않고 제거했다.
- Architecture checker의 죽은 `frozenContractAliases` allowlist만 제거했다. `contractOwnershipFindings`는 rule module과 중복이 아니라 상호보완(`type-import-cycle`을 추가로 잡음)이라 유지한다.
- Mutation fan-out 구조와 `pi-extension.ts`는 의도적으로 그대로 둔다. LOC 감소 목적의 분해는 하지 않는다.

앞으로의 변경 원칙은 다음과 같다. TUI 변경은 `tui/model`·`render`·`app`·`sources` 안에서 끝낸다. 디자인 변경을 이유로 protocol·durable state·broker·storage 계약을 건드리지 않는다. 변경 범위가 실제로 줄어들지 않는 새 abstraction은 만들지 않는다.


OMA를 Pi 확장이 아니라 단일 제품으로 제시하는 표면을 추가했다. 사용자 진입점은 `oma` 하나이고, 대화 화면에서 `Ctrl+X`로 Dashboard / Config / Mail을 연다.

규범은 architecture.md **§23**과 implementation-spec.md **§18 (TUI-001–019)**가 소유한다. architecture 기준본 hash는 `7588b31e…`이며 N-001에 반영했다.

이번 변경에서 실제 architecture가 바뀐 것은 하나다. **Principal Pi session의 소유권**이 "실행 중인 Human session에 attach"에서 "OMA TUI가 `pi --mode rpc`를 직접 실행"으로 옮겨갔다. 나머지는 기존 경계의 구체화다.

구현한 것은 다음과 같다.

- `src/entry/oma.ts` — host 제품 entrypoint. Resident rootfs의 동명 CLI와 argv 파서·권한·소켓을 공유하지 않는다.
- `src/tui/` — 13개 파일. `model.ts`(상태기계)·`render.ts`(표시)·`keys.ts`(입력)는 순수 모듈이고, 파일/소켓/터미널/프로세스 owner는 각각 하나씩만 둔다.
- 다섯 화면 전부 동작한다. 대화, Dashboard, Config, Mail(목록+상세), Extensions.
- 설정은 확정 즉시 `config.json`에 원자적으로 기록하고 policy revision을 갱신한다. 각 항목이 **언제 적용되는지**를 화면에 함께 표시한다.

기존 모듈 변경은 `src/domain/deployment.ts`와 `src/runtime/assets.ts`의 tui entry 등록 두 곳뿐이다. `scripts/dependency-lattice.mjs`에는 예외가 아니라 `src/tui/`를 **L5-entry** layer로 선언했다.

## Extension tool 표면 투영

별도 저장소 `pi-proxy-`의 설계를 **코드 이식 없이** OMA 계약으로 재구현했다(사용자 선택: C안). Role은 자기 tool을 `DIRECT`/`DISABLED`/`GROUPED`로 투영하고, group DAG를 열면 직계 자식만 추가 활성화된다.

이식하지 않은 것이 중요하다. 원본의 자식 extension 로더·host facade·registry capture·자식 handler 직접 실행은 전부 뺐다. OMA는 이미 operations 계약과 Pi의 `-e`로 extension을 로드하므로 그 계층이 불필요하고, 그대로 가져왔다면 PI-001과 TUI-010의 자동 탐색·임의 경로 금지를 위반했을 것이다. 원본 1,367 LOC 중 실제로 필요한 것은 검증·평탄화와 집합 산술뿐이었고 증가량은 368 LOC다.

- 규범: architecture.md **§23.10**, spec **§19 (TSP-001–010)**, test-matrix **T99–T103**.
- 검증·평탄화의 단일 owner는 `src/domain/tool-surface.ts`다. cycle·중복 소속·미지 참조·한도는 **config 로드 시점에** 거절하고 sandbox로 넘기지 않는다.
- sandbox 쪽 `src/pi-extension.ts`는 검증된 plan에 대한 집합 연산만 한다. group을 여는 것은 활성화이지 실행이 아니며, 다른 extension의 handler를 대신 호출하는 경로는 없다.
- 설정은 operations role 파일의 선택적 `toolSurface` 블록이다. `HostConfigV1`·wire·ledger·DB entity를 확장하지 않는다.

## Extension digest 재검증

`operations/README`와 TUI-010이 요구하던 "spawn 직전 SHA-256 재확인"이 미구현이었다. digest가 config 로드 후 버려지고 있었다. `src/runtime/extension-integrity.ts`를 단일 owner로 두고 Resident·Principal 양쪽 spawn 경로에서 재검증하며, 불일치·삭제·정규 파일 아님을 모두 기동 거절한다.

범위는 config 로드와 spawn 사이의 창뿐이다. 검증 후 Pi가 파일을 여는 사이의 same-UID 경합은 막지 못하고 deployment manifest digest를 대신하지도 않는다.

## 설정 없이 실행

`oma`를 프로젝트 디렉터리에서 그냥 실행하면 된다. 초기화 명령도, 손으로 쓴 `HostConfigV1`도 없다. society는 디렉터리에서 유도하고 설정은 `src/config/defaults.ts`가 만들어 파일로 남긴다.

로그인·모델 선택은 동봉 엔진의 기존 흐름을 쓴다. OMA가 인증·모델 관리 표면을 따로 만들지 않는다. 한때 사용자의 `~/.pi`에서 credential을 상속하게 만들었다가 되돌렸다 — 개인 상태를 건드리고 "Pi 없이도 동작한다"는 전제를 깨기 때문이다.

## Pi 엔진 동봉

OMA가 Pi를 함께 배포하고 자기 것만 실행한다. 사용자가 Pi를 따로 설치할 필요가 없고, 이미 설치해 둔 Pi가 있어도 섞이지 않는다. Pi는 수정하지 않으므로 LOC 계산 대상이 아니다(TUI-018).

`src/runtime/pi-runtime.ts`가 단일 owner다. `PATH`를 보지 않고 fallback도 없으며, 엔진에 `PI_CODING_AGENT_DIR`로 OMA 소유 디렉터리를 준다. 이 머신에 사용자 Pi가 설치돼 있는데도 OMA가 자기 복사본을 실행하는 것을 실제로 관측했다.

남은 것은 sandbox rootfs 안에서의 엔진 bind(`SandboxHost`가 아직 외부 공급)와, node/git까지 포함한 OS별 배포본이다.

## 현재 검증 상태

수치와 명령은 [implementation/validation.md](implementation/validation.md)가 소유한다. `npm test` 996/996 PASS, `check:architecture` 0 findings, 실제 entrypoint를 임시 state root에서 직접 실행해 다섯 화면과 설정 쓰기를 관측했다.

TUI-001–014는 owner/callPath/negative test가 연결됐고 상태는 **unverified**다. 실제 Pi provider 연결과 TTY raw mode는 관측하지 않았으므로 COMP-004의 `proven`이 아니다.

**A-008 LOC gate가 열려 있다.** 187 files / 17,946 code LOC로 10,000행 기준을 넘는다. 기록만 하고 진행하기로 했으며 review는 별도 작업이다.

## 다음에 할 일

TUI에서 아직 닫히지 않은 의존성은 하나로 좁혀져 있다.

**`principal.attach` credential handshake는 구현되었고 실제 tool 경로로 검증됐다**(IPC-011, PR-001). host가 broker를 시작하기 전에 session handle을 등록하고, broker는 등록이 있을 때만 endpoint를 열며, credential은 등록한 host만 가진 descriptor로 한 번 간다(파일 없음). model-facing CLI가 매 연결의 첫 frame으로 제시하고, trusted extension의 `cliEnvironment()`가 `env -i` 너머로 그것을 전달한다. 세 곳이 다시 어긋나면 `principal-session-env` 규칙이 architecture gate를 실패시킨다. Dashboard는 별개로 host-private status view(TUI-021)를 읽는다.

**다음 작업은 PR-002의 후반부다**: pending을 Principal에게 실제로 전달하는 경로. 자세한 범위와 왜 절반만 지으면 안 되는지는 [validation.md](implementation/validation.md)의 "남은 것"에 적었다.

S-02는 여전히 **OPEN**이다. handshake와 duplicate attach 거절은 닫혔지만, SP-02-T/A의 model-facing tool override와 credential 비노출 기준은 실제 모델이 도는 환경을 요구한다. PR-004의 제한은 새 entrypoint가 그대로 진다.

session 경계를 넘지 않는 Principal model per-request 전환은 TUI-005가 명시적으로 범위 밖에 둔다. 하려면 `src/inference.ts`의 frozen authority 검사를 함께 개정해야 하며, 호출 경로 없이 API만 먼저 만들지 않는다.

## 작업할 때 먼저 볼 것

mutation을 수정한다면 검색부터 하지 말고 다음으로 시작한다.

```sh
npm run mutation:locality -- git.submit
```

contract cleanup은 `implementation/contract-direction-plan.json`의 순서를 따른다. broker lifecycle은 `implementation/broker-lifecycle-review.json`의 split trigger가 실제로 충족될 때만 추가 추출한다.

code 변경 전 최소 루프는 다음과 같다.

```sh
npm run typecheck
npm run check:architecture
npm test
```

dependency/import surface가 바뀌었다면 `npm run evidence:graph`로 재생성한 뒤 architecture gate를 다시 실행한다. production source가 늘거나 줄면 `npm run inventory`와 `node scripts/loc.mjs`도 함께 돌린다.

## 문서 규율

현재 문서 지도는 [docs/README.md](docs/README.md) 하나에서 시작한다. 과거 P0–P24, proposal, audit/closure, 누적 verification log는 [docs/archive.md](docs/archive.md)의 Git snapshot에서 조회한다.

장문의 commit 목록, 과거 test count, 당시 LOC를 HANDOFF에 누적하지 않는다. 영구 규율은 `MAINTENANCE.md`, 실행 결과는 `implementation/validation.md`, architecture 의미는 `architecture.md` / `implementation-spec.md`가 각각 소유한다.

## 변경하지 않은 계약

단일 broker/SQLite writer, 동기 transaction, 여섯 durable entity, immutable accepted v1 evidence, explicit unknown, normal/recovery 판단 분리, effect 직전 current authority/incarnation 재검증, bounded effect를 유지한다.

TUI는 새 daemon·durable entity·effect queue·socket method·model-facing subcommand가 아니다. public/internal method key set은 그대로이며 `test/tui-boundary.test.ts`가 이를 고정한다. 제품 표면을 이유로 wire/DB/persisted v1 의미 또는 OPEN release gate를 바꾸지 않는다.
