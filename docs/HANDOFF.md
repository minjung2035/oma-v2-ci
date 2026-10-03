# OMA v2 — 전수 감사 인계

인계 시점: 2026-10-03. 최신 요청은 진행 상황을 파일로 남기는 것이다. 원래 작업은 OMA v2 전체 코드베이스의 버그/P0 위반 감사이며 **미완료**다. 현재 실행 중인 시험·자식 프로세스는 없다. 제품 수정은 시작하지 않았다.

## 기준점과 변경 상태

- 저장소 `/home/dev/oma-v2`, 브랜치 `feat/macos-hidden-vm`.
- 감사 전 사용자 요청으로 만든 기준 커밋: `a75c29911c077a2d2b207a48773268e2e2355ca0` (`chore: checkpoint before adversarial P0 audit`). 당시 clean tree의 checkpoint이며 현재 HEAD도 같다.
- 생산 파일 SHA-256 묶음: `a8cb94866fe228e7d32ca48383e5d1a3f8c11aa86921dbb7f53804d58bdd89cf`. 전수 원장에 등록된 생산·추가 source의 bytes도 인계 직전 모두 그대로임을 확인했다.
- 미커밋 변경은 `docs/HANDOFF.md`, `docs/implementation/validation.md`, `docs/priority-0-audit.md`, `test/audit/`다. 기존 감사 보고서·oracle·evidence와 이번 전수 원장이 들어 있다. 생산 코드 변경, push, PR, 배포는 없다.
- 다른 작업자의 변경을 버리거나 전체 변경을 일괄 stage하지 않는다. 별도의 인계 커밋은 요청받지 않았다.

## 현재 범위와 상태

판정·실행 수치의 owner는 [validation](implementation/validation.md#전수-감사-인계-시점)이다. 개별 파일의 상태와 SHA, fact/owner/P0-1~7 근거는 [전수 원장](../test/audit/full-2026-10-03.review.json)에 있다.

현재 고정 범위는 production manifest의 356개와 추가 source 74개, 총 430개다. 추가 범위는 manifest 밖 계약 모듈, native VM helper/bridge, guest 배포 파일, build/verification scripts와 toolchain 설정이다. 의존성, 생성된 `dist`, 과거 evidence, 기존 모든 시험 본문을 전체 파일 정적 검토 대상으로 포함한 것은 아니다. 관련 시험은 경계별로 따로 선택한다.

인계 상태는 **판정 저장 전수 완료 430개(생산 356 + 추가 74)**다. 첫 위임 pass에서 whole-read 미확정으로 남긴 38개는 두 번째 위임 pass(비P0 일반버그 렌즈, B1~B7)에서 B2가 비TUI 9개·B1이 TUI 28개를 whole-read로 닫았다. 읽은 것만으로 완료 상태를 주지 않았으며, B-pass도 같은 whole-read 근거로만 기록했다. 앞선 선택 경계 감사·전수 pass·첫 위임 pass와 구분해 NB(비P0 일반 버그) 시리즈로 별도 번호를 둔다.

2026-10-03 위임 pass: 사용자 승인 아래 7개 백그라운드 에이전트가 부분 중복 분업으로 파일별 전체 읽기를 수행했다. 부모 에이전트가 모든 발견을 교차 확인하고 상위 세 건을 required-behavior oracle로 재현했다. 에이전트는 원장·oracle·생산 코드를 쓰지 않았고 취합·판정 기록은 부모가 했다.

### 판정 저장 영역

- **전수 pass 직접 판정 50개**: `implementation/contracts.ts`, schema v1/v2/v3 + migration 2개, `implementation/contracts/` 11개, `src/{store,durable,validate}.ts`, `src/storage/` 27개, `src/domain/context-policy.ts`, `src/process/cleanup.ts`, `src/reconcile/preaccept.ts`.
- **위임 pass 판정 342개**: RPJ 38개(domain 나머지, ids/hash/authority/leaf/module-ports/review/ports/storage-paths/socket-name/response-codec) + entry 17 + runtime 38 + broker 12 + mail 12 + git 11(4개 제외) + lifecycle 9 + process 6 + units 4 + sandbox/runner/reconcile/request-cache + platform 46 + units·extension 15 + protocol 21(3개 제외) + cli 전체 + config 7 + views/diagnostics + tui 4 + systemd 7 + scripts 47 + native 5 + package/tsconfig 3.
- **PENDING 0개** — 전수 판정 완료. 신규 발견: P0 계열은 quarantine NB-01/02만 추가(저~중), 나머지는 일반 버그 NB-01~NB-28(최고 심각도 NB-23: `record()` throw가 timer/socket 콜백에서 탈출 → omahostd 죽음 또는 orphan VM). NB 시리즈 상세는 `docs/priority-0-audit.md`의 '일반 버그 pass' 표.

이 판정은 해당 파일의 전체 정적 검토 기록이다. 연결된 모든 실행 경로·native 환경·powercut 검증의 완료나 결함 부재를 뜻하지 않는다. 파일별 한계와 기존 AV 연결은 원장 행을 따른다. 위임 보고의 세부 파일별 메모 일부는 대화 요약에서 절단되어, 그룹 단위 합의와 부모의 헤더/호출자 재검증으로 기록했다.

## 확정 발견과 재현 위치

발견·근거·수정 방향의 owner는 [감사 기록](priority-0-audit.md#2026-10-03-적대적-검증--기준-커밋-a75c299)이다. `AV-20261003-01..31`은 모두 미수정이며 현재 합계는 제품 27건 + 검증 도구/artifact 4건이다.

- AV-01..08: quota gate 우회, request name 충돌, historical replay 선행 조건, 다중 freeze 실패 시 미접수 artifact 누수, diff UTF-8 손실, notice snapshot drift, 작은 body limit, inventory/LOC/hash 불일치.
- AV-09..12: 관측한 corruption의 foreground fence 누락, workers archive 답장 경로, arrival 시간 해석, long-thread anchor의 무제한 증가.
- AV-13..17: relay open 실패 시 listener 누수, 늦은 resolver의 폐기된 run 재생성, guest 종료의 host release 누락, detached 연결 상한 우회, guest request ledger의 unchecked truthiness.
- [AV-18](priority-0-audit.md#av-20261003-18--context-준비-실패가-이미-획득한-lease를-반환하지-않음-p2): `src/storage/context-stream.ts`의 `acquireStagingRoot`가 TreeLease 획득 뒤 부모 open을 cleanup try 밖에서 수행한다. 임시 fixture에 `EMFILE` 하나를 주입하니 reject 뒤 fd 1개와 `active` flock이 남았다. 시험이 직접 fd를 닫고 fixture를 정리했다.
- [AV-19](priority-0-audit.md#av-20261003-19--prepare--context-revision-임시-tree의-소유자수거자-부재): `.prepare-*` revision 임시 tree에 lease/수거자가 없고 `observedStorageBytes`가 영구 계상. oracle이 `collectUnacceptedArtifacts`의 `removed`/`kept` 모두 잔재를 못 봄을 재현했다.
- [AV-20](priority-0-audit.md#av-20261003-20--startup-복구가-비-mail-operation의-실패를-격리하지-않음): pending 비-mail op의 지속 unknown이 startup을 죽여 broker 기동을 영구 차단. 같은 op를 `sweep()`은 격리하는 비대칭을 oracle이 재현했다.
- AV-21/22/23(macOS NOT_RUN): `VzDriver.get` malformed→absent 격하로 archive key 덮어쓰기; `archiveKey` get→put TOCTOU; guesthost maintenance lease의 owner 사망 후 잔류.
- [AV-24](priority-0-audit.md#av-20261003-24--workerstatus의-unbounded-entries-projection): `workerStatus` detail이 frame 예산을 받지 않아 `entries` 전체를 직렬화 — 그 요청은 영구 FRAME_TOO_LARGE.
- [AV-25](priority-0-audit.md#av-20261003-25--unrepresentable-candidate-이름이-store_corrupt로-분류--society-fence): 비UTF-8/lone-surrogate 이름이 `parseNameStatusZ` strict decode에서 `STORE_CORRUPT`로 분류 → society 전체 fence. oracle이 raw `0xff` 파일명 diff에서 `kind:"corrupt"`를 재현했다.
- AV-26(macOS NOT_RUN): Swift helper의 `PortBridge` 부분 생성 후 throw로 listener/VM 잔재.
- AV-27: `actions.ts`의 GOAL 게이트가 same-key terminal receipt 반환보다 먼저 throw (AV-03 계열 다른 자리).
- AV-28: `chmodSync` in listen 콜백 4개 추가 자리 — egress-forwarder, startHostApi, guest-session, startEgressService (AV-13 계열).
- AV-29..31(검증 도구): AST/registry 게이트의 spelling 수준 우회; READ_UNCHANGED/status의 byte-binding 부재와 lane digest roots의 production-*.json 누락; test-guard `exec` 미차단·script 자식 누수·sign-image 비원자성.

재현 파일은 `test/audit/adversarial-2026-10-03.mjs`, `-second.mjs`, `-third.mjs`, `-full.mjs`다. 첫 세 evidence JSON과 당시 [coverage](../test/audit/adversarial-2026-10-03.coverage.json)는 역사적 snapshot으로 보존한다. 이번 full oracle에는 AV-18/19/20/25 네 개가 들어 있으며 required-behavior assertion이 모두 실패한다. 이것을 회귀 PASS로 세지 않는다.

## 해결된 미확정 후보

직전 인계의 세 후보는 위임 pass에서 모두 해결됐다.

1. `.prepare-*` 임시 tree → **AV-19 확정**(수거 경로 부재 + quota 계상, oracle 재현).
2. `workerStatus` frame 초과 → **AV-24 확정**(detail 분기가 `frameBytes`를 받지 않음, AV-12와 별개 읽기 경로 결함).
3. `isValidWirePath` surrogate → **AV-25 확정**(비UTF-8 이름이 `STORE_CORRUPT` → society fence; wire surrogate는 frame.ts:73이 차단하지만 Trigger B(git 제출 비UTF-8 이름)는 확실히 도달; oracle 재현).

기각한 의심(유지): `attestationInputProblem`의 refresh shape 허용은 `reviewInputProblem`이 caller refresh를 거절하므로 결함 아님. 위임 pass에서 추가로 기각된 후보: review.status list cursor(없음이 정상), oversized answer 후 connection teardown(설계된 accepted-failure 의미), `reconcile.ts`의 admit 획득-즉시-해제(동기 호출이라 in-flight 불가), `hasCommittedContext`의 보수적 false(올바른 방향), refreshViews fence(STORE_CORRUPT만 래치하므로 정상), session-handoff writeSync 무제한(도달 불가), principalStatus의 entries 부재(구조적 bounded).

## 재개 순서와 도구

1. [PRIORITY-0](PRIORITY-0.md), [문서 지도](README.md), 최신 validation과 전수 원장을 확인한다. P0는 영속적 사실의 의미 보존이며, 현재 권한과 과거 사실 분리·해석 owner 단일화·설정 generation·자원 반환·unknown 보존·모델 재검토·kill/retry/restart의 7개 규칙을 따른다.
2. HEAD/source SHA를 원장과 대조한다. 완료 430개를 처음부터 다시 읽거나 위임 보고의 그룹 판정을 그대로 신뢰하지 않는다 — 필요한 파일은 재검증한다.
3. 새 결함은 `-full.mjs`에 독립 required-behavior oracle로 추가하고, 실패 이유·fixture cleanup·한계를 감사 기록에 남긴다. AV-32 이후 번호는 아직 사용하지 않았다.
4. 전수 판정은 완료됐다. 남은 것은: source/oracle/compiled fixture/log/review hashes 결박의 full evidence 마감, 확정 defect의 수정 여부 결정(별도 승인 필요 — 현재는 감사만), B4 동시성 스위프의 잔여 보고 반영. 생산 source를 수정하지 않는 감사 작업을 이어가고 실제 환경의 NOT_RUN을 보존한다.
5. source/oracle/compiled fixture/log/review hashes를 결박할 full evidence 마감이 남아 있다. `/tmp/oma-full-record.mjs`는 수동 판정을 원장에 저장하는 임시 helper이며 committed/repository tool이 아니다. 다음 환경에 없으면 원장 schema를 따라 다시 만들면 된다. evidence 없이 파일 열람만으로 `REVIEWED_STATIC`을 자동 생성하지 않는다.

로컬 Node는 기본 PATH에 없다. 아래 환경을 사용한다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03-full.mjs
```

현재 `-full.mjs`의 AV-18/19/20/25 네 oracle은 모두 의도적으로 fail한다(4 fail / 0 pass). 이전 선택 회귀 361 PASS와 새 결함 검출 실패는 다른 판정이다. 최신 oracle 로그는 `/tmp/oma-full-oracles-2.log`; 이전 실행 로그·source/fixture/oracle SHA는 validation과 해당 evidence를 따른다. 임시 로그 자체는 release evidence가 아니다.

## 유지할 실행 제약

- 실제 사용자 OMA/VM·저장된 인증 정보·유료 provider를 fixture 확인에 사용하지 않는다. disposable SQLite/Git/files/Unix sockets, fake units/engines, loopback provider stand-in으로 재현한다.
- inherited exclusions: 실제 systemd service probe, 중단 VM ownership probe, reviewer shortage 예외 probe, 실제 isolated-HOME/unshare Kiro를 대체 경로로 재시도하지 않는다.
- `test/platform-lifecycle-ownership.test.mjs`, `test/platform-vz-ownership.test.mjs`, `dist/test/platform-lifecycle.test.js`와 이를 포함한 aggregate suite를 실행하지 않는다. 전체 `npm test`를 자동 선택하지 않는다.
- native macOS는 Linux fixture로 대체 판정하지 않는다. 실제 manager/VM, native Mac, 전체 release·powercut lane은 NOT_RUN이다. 이전 disposable ledger의 두 SIGKILL은 그 경계에만 해당한다.
- architecture·설계 원본·과거 receipt/review fact의 뜻과 기존 시험 ID를 바꾸지 않는다. [merge-review-spec](merge-review-spec.md)은 아직 설계안이며 이번 감사가 활성 규범 전환을 뜻하지 않는다.
- subagent 위임은 2026-10-03 사용자가 명시 승인해 7개를 실행했다(부분 중복 분업). 추가 위임은 다시 승인을 받는다. 에이전트는 읽기 전용이었고 원장·oracle·생산 코드 기록은 부모가 취합해 수행했다.
