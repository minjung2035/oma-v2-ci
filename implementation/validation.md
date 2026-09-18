# OMA v2 — 현재 검증 상태

이 파일이 current verification status와 검증 명령의 단일 owner다. README/HANDOFF에는 test count, LOC, PASS 표를 중복 기록하지 않는다.

## 현재 source 판정

브랜치 `refactor/safety-preserving-architecture`, 기준 HEAD `42e6e8d`, 실행일 2026-09-19. 날짜별 누적 기록은 두지 않는다. 지난 판정은 Git history에서 조회하고, 아래는 현재 tree의 사실만 적는다(MAINTENANCE §29).

### 실행 결과

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:package` | PASS. entries 4개(broker/runner/host/tui), runtime dependency 4개 pin |
| `npm run check:architecture` | PASS, 0 findings |
| `npm test` | **978/978 PASS**, fail/cancelled/skipped/todo=0 |
| `node scripts/loc.mjs` | **187 files / 17,931 code LOC** |

### 현재 범위

이 tree는 Core 위에 세 가지를 얹은 상태다.

- **제품 표면(TUI)** — `oma` 단일 진입점, 대화 화면과 `Ctrl+X` Control Panel(Dashboard/Config/Mail). 규범은 architecture §23, spec의 TUI 요구, test-matrix T91–T106.
- **Extension tool 표면 투영** — role별 DIRECT/DISABLED/GROUPED 투영. 규범은 architecture §23.10, spec의 TSP 요구, test-matrix T99–T103.
- **엔진 동봉** — Pi를 함께 배포하고 자기 것만 실행하며, 설정 파일 없이 기동한다. 규범은 architecture §23.3, spec의 TUI-016–019, test-matrix T105–T106.

### 엔진과의 중복 정리

- **inference relay 제거.** `INF-001`이 broker relay를 요구했지만 S-04는 relay를 만들지 않기로 기록했고, 코드에는 호출 경로 없는 355줄이 남아 있었다. 규범을 실제 선택으로 확정하고 `src/inference*`·`domain/usage-budget.ts`를 제거했다. 대가로 OMA는 multi-agent 비용 상한을 집행하지 않으며 그 사실을 §13.3에 적었다. `usage` 표와 여섯 durable entity는 그대로 두었다.
- **터미널 폭 측정**을 엔진의 grapheme 기반 계산으로 교체했다. 직접 만든 표는 12개 표본 중 4개(ZWJ 가족, 결합 문자, 넓은 이모지, 피부색 시퀀스)에서 틀렸다.
- **키 식별**을 엔진 어휘로 위임했다. 청크 분할은 제품이 계속 소유한다.
- **남긴 중복**: byte framing과 유닉스 소켓 클라이언트. 그 위의 OMA 정책 계층이 어차피 남고 설치 표면을 늘리지 않기 위한 판단이며 근거를 §23.13과 TUI-020에 남겼다.
- **중복이 아닌 것으로 확인**: 경로 봉쇄(커널 수준), START 화면(자동 탐색 금지), 파일 가드(role별 quota), canonical JSON, git bundle/CAS.

### 관측한 것

- 임시 state root에서 `dist/src/entry/oma.js`를 직접 실행해 다섯 화면(대화/Dashboard/Config/Mail 목록·상세/Extensions)이 렌더링되고 종료 코드 0임을 확인했다.
- Config에서 값을 바꾸면 해당 설정 파일에 기록되고 policy revision이 갱신된다. split bundle에서는 role 파일과 host 파일이 각각 갱신되고 index는 manifest로 남는다.
- 사용자 Pi가 `/usr/bin/pi`에 설치된 머신에서도 OMA는 자기 복사본을 실행하고 `PI_CODING_AGENT_DIR`로 자기 디렉터리를 넘긴다.
- 설정이 없는 빈 디렉터리에서 인자 없이 기동하면 society를 디렉터리에서 유도하고 설정 파일을 생성한 뒤 시작한다.

이 관측은 production entrypoint가 동작함을 보인 것이지 COMP-004의 `proven`이 아니다. 실제 Pi provider 연결, TTY raw mode, broker `status.get` 왕복은 포함하지 않았다.

### 미검증으로 남은 것

- `principal.attach` credential handshake 미구현(IPC-011, S-02). Dashboard의 broker 유래 값은 항상 `unknown`이다.
- TUI/TSP requirement의 trace 상태는 `unverified`다. owner/callPath/negative test는 연결돼 있으나 실제 경계 실행 증거가 없다.
- Resident sandbox rootfs 안에서의 엔진 bind는 `SandboxHost`가 외부 공급이라 범위 밖이다.
- node/git을 포함한 OS별 배포본은 별도 작업이다.

### A-008 LOC gate — OPEN

현재 수치는 A-008의 10,000행 기준을 넘으므로 **architecture review가 필수이고 release는 차단 상태**다. 기록만 하고 기능 작업을 중단하지 않기로 했으며 review는 별도 작업이다. 동봉 엔진은 수정하지 않은 upstream 의존이라 LOC-003에 따라 계산 대상이 아니며, 엔진을 수정하면 계산 대상이 된다(TUI-018).

## 기본 재검증

실제 명령 정의는 [package.json](../package.json)이 기준이다.

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

source/import graph가 바뀌었다면 current dependency evidence를 재생성한다.

```sh
npm run evidence:graph
npm run check:architecture
```

dependency evidence의 current path는 `implementation/evidence/dependency-graph.json`이다. Generated list, LOC/hash, dependency evidence를 사람이 새 실행처럼 수동 보정하지 않는다.

mutation 하나만 수정할 때는 먼저 관련 surface를 좁힌다.

```sh
npm run mutation:locality -- git.submit
```

focused test를 실행하더라도 전체 invariant/release 의미로 승격하지 않는다.

## 환경별 verification lane

각 output directory는 기존 artifact를 덮지 않는 새 경로를 사용한다.

```sh
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
```

필요한 systemd/kernel/provider/VM 환경이 없으면 PASS가 아니라 `BLOCKED` 또는 `NOT_RUN`으로 기록한다. 일반 개발 host의 SIGKILL/process fixture를 VM power-loss proof로 취급하지 않는다.

## A-008 LOC gate — 현재 OPEN

`node scripts/loc.mjs`의 현재 source-bound 결과는 **190 files / 18,208 code LOC**이며 A-008의 10,000행 기준을 넘는다. 따라서 **architecture review가 필수이고 release는 차단 상태**다. 이 판정은 기록만 하고 기능 작업을 중단하지 않기로 했으며, review 자체는 별도 작업으로 분리한다.

이 gate가 열려 있다는 사실을 기능 추가의 승인으로 해석하지 않는다. TUI 및 제품 표면 source도 TUI-015/LOC-003에 따라 같은 manifest와 같은 budget으로 계산하며, 별도 manifest로 분리해 Core 수치에서 제외하지 않는다.

## 남아 있는 release gate

- `spikes.md`의 OPEN qualification 조건은 fresh harness evidence 없이 닫지 않는다.
- live systemd/cgroup/READY, provider failure/usage/cancel, hostile import, filesystem/kernel containment, VM power-cut/ENOSPC/read-only/restore 등 environment-specific proof는 별도다.
- S-08/S-10 tiered attestation/floor와 S-11 clean-room, S-09 품질·비용·latency 평가는 해당 profile 계약을 따른다.
- LOC/A-008/A-009 판정은 `node scripts/loc.mjs`의 current source-bound 결과로만 갱신한다.
- requirement별 release proof는 [compliance.md](compliance.md)를 따른다.

과거 상세 실행 로그와 단계별 PASS 기록은 [docs/archive.md](../docs/archive.md)의 pre-cleanup snapshot에서 조회한다.

## 보존하는 verification 규범

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
