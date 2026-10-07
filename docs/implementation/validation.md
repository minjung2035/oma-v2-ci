# OMA v2 — 현재 검증 상태

기준: 2026-10-03 적대적 검증, 생산 source checkpoint `a75c29911c077a2d2b207a48773268e2e2355ca0`. 이 문서는 현재 판정·실행 결과·수치·로그·한계의 단일 owner다. 검증 요구는 [verification-spec](../verification-spec.md), 과거 실행은 [archive](../archive.md)가 소유한다.

## 현재 source 판정

전수 감사는 **진행 중**이다. 현재 production 356개와 추가 실행·계약·native·build/verification source 74개를
[파일별 원장](../../test/audit/full-2026-10-03.review.json)에 고정했다. 원장의 개별 상태·P0 근거가 진행 판정이며,
아래 세 차례의 선택 경계 coverage는 당시 snapshot으로 보존한다. 전수 정적 검토와 실제 release/플랫폼 실행은 별개다.

**Release-blocked.** 최근 mail-v1 merge/review/challenge의 코드와 집중 회귀는 존재한다. 앞선 세 차례 탐색의 제품 결함 16건과 검증 artifact 불일치 1건에 이번 전수 pass의 제품 결함 1건을 더해, 현재 제품 17건 + 검증 artifact 1건이 모두 미수정이다. 전체 구현, 현재 입력의 전체 suite, native macOS 완료를 주장하지 않는다. merge-review spec의 설계안 지위나 활성 규범을 이번 감사로 변경하지 않는다. 아래 2026-10-02 문서 통합과 마지막 기능 checkpoint는 각각 당시 실행 범위를 보존한 기록이다.

## 전수 감사 인계 시점

2026-10-03 사용자 요청으로 [HANDOFF](../HANDOFF.md)에 완료·남은 영역과 직전 작업을 기록했다.
현재 source 범위와 개별 판정은 [전수 원장](../../test/audit/full-2026-10-03.review.json),
신규 결함은 [AV-18](../priority-0-audit.md#av-20261003-18--context-준비-실패가-이미-획득한-lease를-반환하지-않음-p2)을 따른다.

| 항목 | 인계 시점 판정 |
|---|---|
| 고정 전체 정적 범위 | production 356 + 추가 source 74 = 430개. 원장 줄 수는 개행으로 센 참고치이며 cloc 측정이 아님 |
| 전체 읽기와 파일별 P0 판정 저장 | `REVIEWED_STATIC` 430개: production 356 + 추가 74 — 전수 완료. 직접 판정 50 + 위임 pass 취합 342 + B-pass(비P0 일반버그 wave) 잔여 38 |
| 위임 pass | 7개 백그라운드 에이전트 부분 중복 분업(사용자 명시 승인), 부모가 발견 교차 확인·기록. 에이전트는 읽기 전용 |
| 판정 미완료 잔여 | 없음 — B2가 잔여 비TUI 9개, B1이 TUI 28개를 whole-read로 확정해 430/430. 일반 버그 pass로 NB-01..NB-28 추가 기록 |
| source bytes | UNCHANGED: 원장의 production/추가 430개 SHA-256 모두 재대조. HEAD `a75c299` 유지 |
| 신규 required-behavior oracle | DEFECTS REPRODUCED: 4 tests, fail 4, pass/skip/cancel 0 — AV-18(lease fd 잔류), AV-19(`.prepare-*` 잔재 수거 불가), AV-20(startup 비-mail 격리 부재: sweep은 격리·startup은 reject), AV-25(비UTF-8 파일명 → `kind:"corrupt"`) |
| 기존 선택 회귀 | 앞선 세 pass의 361 PASS 기록 보존. 이번 인계 작업에서 다시 실행한 것은 아님 |
| 현재 발견 | AV-01..31 총 31건: 제품 27 + 검증 도구/artifact 4, 모두 미수정 |
| 해결된 후보 | 직전 3개 후보 모두 확정: 임시 tree 잔재(AV-19), workerStatus frame(AV-24), surrogate/비UTF-8 이름(AV-25) |
| full evidence 마감 | NOT_COMPLETE: 새 source/oracle/log/compiled/report 결박 evidence를 마감해야 함. 첫 세 evidence는 역사적 snapshot 그대로 유지 |
| 전체 정적 감사 / 실제 플랫폼·release | INCOMPLETE / NOT_RUN. macOS/native·systemd·powercut·전체 release lane은 여전히 NOT_RUN |

[full oracle](../../test/audit/adversarial-2026-10-03-full.mjs)의 AV-18/19/20/25 실행 로그는 `/tmp/oma-full-oracles-2.log`다.
실제 사용자 상태, manager/VM, provider는 사용하지 않았다. 문서 검사 로그는 `/tmp/oma-full-handoff-documents.log`다.

## 2026-10-03 적대적 검증

사용자 요청으로 clean tree에 기준 커밋 `a75c299`를 만든 뒤 빌드한 생산 코드에 검증을 실행했다.
생산 코드 수정은 없으며, 발견·근거·수정 방향은 [감사 기록](../priority-0-audit.md#2026-10-03-적대적-검증--기준-커밋-a75c299)이 소유한다.
재현 artifact는 [adversarial-2026-10-03.mjs](../../test/audit/adversarial-2026-10-03.mjs)다.
source/fixture/oracle SHA-256과 실행 summary는 [감사 evidence](../../test/audit/adversarial-2026-10-03.evidence.json)에 결박했다.
이 파일도 release qualification을 뜻하지 않는다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| build / typecheck | PASS | `/opt/oma-test-node/bin`의 Node 24.21.0. 생산 코드와 TypeScript 시험을 현재 source로 빌드 |
| merge/review/challenge 집중 회귀 | PASS | 6개 파일, 79 tests, fail/skip/cancel 0 |
| grammar/evaluator fuzz/mail facts/P0/confinement 회귀 | PASS | 6개 파일, 75 tests, fail/skip/cancel 0. fuzz는 3 seeds × 170 ledgers |
| 신규 적대적 oracle | DEFECTS REPRODUCED | 8 tests, fail 8, skip/cancel 0. 제품이 지켜야 할 동작을 assert하며 AV-01..07을 검출. AV-03은 mode/bounds 두 조건 |
| check:architecture | FAIL | 첫 check:inventory에서 source list/LOC hashes 불일치. 이후 chain 단계는 이 aggregate 호출에서 NOT_RUN |
| check:architecture:rules | PASS | 독립 실행, 0 findings |
| check:boundaries | PASS | 구조 검사, 0 findings. registry strongest-injection counts는 이번 실행의 실제 kill 수가 아님 |
| check:documents / git diff --check | PASS | 감사 문서 저장 후에도 문서 구조·링크 검사 0 findings, whitespace 오류 없음 |

집중 회귀 명령과 standalone 재현 명령은 다음과 같다. `NODE_OPTIONS`의 guard 경로는 child가 cwd를
바꾸어도 해석되도록 절대 경로로 지정했다. 상대 guard 경로로 시작한 첫 시도는 CLI child import 실패여서
제품 실패나 위 표의 실행 결과로 세지 않고, 절대 경로로 다시 실행한 결과를 사용했다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
npm run build
npm run typecheck
node --test --test-concurrency=1 \
  dist/test/merge-review.test.js dist/test/challenge-review.test.js \
  dist/test/review-faults.test.js dist/test/review-concurrency.test.js \
  dist/test/review-evaluation.test.js dist/test/merge-cli.test.js
node --test --test-concurrency=1 \
  dist/test/review-grammar.test.js dist/test/review-evaluation-fuzz.test.js \
  dist/test/mail-facts-boundary.test.js dist/test/priority-0.test.js \
  dist/test/p0-review7.test.js dist/test/resident-confinement.test.js
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03.mjs
```

standalone 재현은 현재 결함이 있는 source에서 exit 1이 정상적인 **검출 결과**다. suite PASS로 승격하지 않는다.
독립 재현은 root-level normal suite에 자동 편입되지 않으며, 수정과 함께 정상 회귀로 옮길 수 있다.
위 명령은 전체 `npm test`, 환경 lane, SIGKILL/powercut 검증을 실행하지 않는다.
실제 사용자 OMA/VM·인증 정보·유료 provider는 사용하지 않았다. inherited execution exclusions는 HANDOFF에 유지한다.

로그는 `/tmp/oma-adversarial-{build,typecheck,baseline,extended,reproductions,architecture,rules,boundaries,documents}.log`다.
임시 로그는 release evidence로 등록하지 않았다. 이번 source에 과거 LOC/trace evidence를 자동 재사용하거나
measurement 파일을 손으로 수정하지 않았다.

### 2차 경계 확장

같은 `a75c299` 생산 source에서 메일 read/reply/arrival, corruption fence, config generation,
lifecycle authority와 IPC 자원 수명으로 범위를 넓혔다. 파일별 선택 경계·한계는
[감사 기록의 2차 검증](../priority-0-audit.md#2차-검증--메일권한설정ipc-경계-확장)에 기록했다.
새 [oracle](../../test/audit/adversarial-2026-10-03-second.mjs)과
[evidence](../../test/audit/adversarial-2026-10-03-second.evidence.json)는 이 실행을 별도로 결박한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| config/mail/IPC/run/registry/TUI/contained-tools 회귀 | PASS | 아래 11개 파일, 106 tests, fail/skip/cancel 0. 1차 154개와 합해 선택 회귀 260개 |
| 추가 적대적 oracle | DEFECTS REPRODUCED | 4 tests, fail 4, skip/cancel 0. AV-09..12 각각 required behavior assertion 실패 |
| 초기 long-thread 탐색 | INCONCLUSIVE | 8192-byte fixture의 350-entry 시도: 3 defect assertions fail, history test 1 cancelled(timeout). history 자체는 이 결과로 확정하지 않음 |
| 축소 long-thread 재현 | DEFECT REPRODUCED | 2048-byte supported config, 정상 접수 40개 이후 short vote와 cancel 거절, reopen 뒤 cancel도 거절. 최종 4-oracle 실행에 포함 |
| 생산 source 변경 여부 | UNCHANGED | 같은 source digest와 HEAD. 생산 코드 수정 없음 |
| 문서·whitespace 검사 | PASS | 추가 발견·범위·한계 저장 뒤 독립 실행 |

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test \
  dist/test/config-generations.test.js dist/test/config-snapshot.test.js \
  dist/test/operations-config.test.js dist/test/mail-integrity.test.js \
  dist/test/mail-recovery-integrity.test.js dist/test/mail-reply.test.js \
  dist/test/r14-connection-lifecycle.test.js dist/test/r16-run-registry.test.js \
  dist/test/r25-lifecycle-owners.test.js dist/test/tui-sources.test.js \
  dist/test/contained-tools.test.js
node --test test/audit/adversarial-2026-10-03-second.mjs
```

2차 로그: `/tmp/oma-adversarial-second-baseline.log`,
`/tmp/oma-adversarial-second-reproductions.log`(초기 timeout 포함),
`/tmp/oma-adversarial-thread-boundary.log`(축소 독립 재현),
`/tmp/oma-adversarial-second-final.log`(최종 4개 oracle),
`/tmp/oma-adversarial-second-documents.log`.
log/source/oracle SHA-256은 2차 evidence를 따른다. initial timeout을 PASS나 새로운 결함으로 승격하지 않는다.
직접 만든 Unix socket endpoint는 tool→CLI 재현의 로컬 fixture이며 native actor 인증 검증을 대신하지 않는다.
실제 manager/VM/provider, 전체 suite, SIGKILL/powercut lane은 계속 NOT_RUN이다.

### 3차 범위 확장과 coverage 공개

같은 생산 source에서 inference relay construction/connection bounds, host/guest run 종료, late resolver와
platform request ledger를 추가 검증했다. source는 checkpoint와 동일하고 제품 수정은 없다.
새 [oracle](../../test/audit/adversarial-2026-10-03-third.mjs)과
[evidence](../../test/audit/adversarial-2026-10-03-third.evidence.json)는 이 실행을 결박한다.
발견과 파일별 경계 판정은 [감사 기록의 3차 검증](../priority-0-audit.md#3차-검증--추론-연결실행-종료영속-원장)을 따른다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| relay/egress/tenure/history/delivery-deadlines 회귀 | PASS | 아래 5개 파일, 81 tests, fail/skip/cancel 0 |
| guest request ledger 회귀 | PASS | 별도 1개 파일, 20 tests, fail/skip/cancel 0. 3차 총 101개, 누적 선택 회귀 361개. 임시 원장 전용 child의 during-effect/after-outcome SIGKILL 2개 포함 |
| 추가 적대적 oracle | DEFECTS REPRODUCED | 5 tests, fail 5, skip/cancel 0. AV-13..17 required behavior 실패. 총 발견 17개 가운데 제품 16/검증 artifact 1 |
| source와 compiled artifact 결박 | UNCHANGED / BOUND | production manifest의 현재 356 files를 1차 source hashes와 대조. 3차 oracle이 import한 compiled file과 회귀 fixture hashes도 기록 |
| 전체 파일 review coverage | INCOMPLETE | production 356개 중 전체 파일 읽기+선택 경계 판정 19개, 선택 함수 판정 36개, 이번 감사의 경계 판정 기록 없음 301개 |
| 문서·whitespace 검사 | PASS | 추가 발견과 범위 목록 저장 뒤 독립 실행 |

coverage는 [파일별 JSON](../../test/audit/adversarial-2026-10-03.coverage.json)의 356개 행에서 계산했다.
전체 파일을 읽었다고 모든 branch/규칙을 검증한 것은 아니다. 55개 파일의 선택 경계 기록도 전수 감사를 뜻하지 않는다.
“기록 없음”은 이번 감사에서 개별 경계 판정을 남기지 않았다는 뜻이며, 예전 commit의 검토나 회귀 실행만으로 상태를 올리지 않는다.
이 목록은 production source의 범위다. 시험·문서·생성 artifact는 해당 실행·hash 목록에서 별도로 다루며
전체 repository의 모든 파일을 감사 완료했다고 주장하지 않는다.

```sh
export PATH=/opt/oma-test-node/bin:$PATH
export OMA_TEST_SYSTEMD=0
export DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/oma-local-tests-no-user-bus
export NODE_OPTIONS=--import=/home/dev/oma-v2/scripts/local-test-guard.mjs
node --test \
  dist/test/inference-relay.test.js dist/test/platform-egress.test.js \
  dist/test/host-tenure.test.js dist/test/session-history.test.js \
  dist/test/delivery-deadlines.test.js
node --test dist/test/platform-request-ledger.test.js
node --test --test-concurrency=1 test/audit/adversarial-2026-10-03-third.mjs
```

3차 로그: `/tmp/oma-adversarial-third-regressions.log`, `/tmp/oma-adversarial-third-ledger-regressions.log`, `/tmp/oma-adversarial-third-oracles.log`,
`/tmp/oma-adversarial-third-documents.log`. source/oracle/coverage/report/log hashes는 3차 evidence를 따른다.
앞선 두 evidence의 report hashes는 당시 저장된 report snapshot이며 3차 실행 판정으로 승격하지 않는다.
3차 fixture는 실제 임시 Unix sockets·product pool/service/parser·synthetic credential만 사용한다.
AV-14/15의 provider 응답 대조는 endpoint 밖 경로의 relay HTTP 403이고 upstream 요청은 없다.
기존 relay 회귀는 loopback의 self-signed TLS provider stand-in을 사용한다. 외부·유료 provider는 사용하지 않는다.
host/guest byte channel의 hello는 fixture가 공급하므로 native VM/bridge/authentication proof를 대신하지 않는다.
임시 ledger의 두 SIGKILL 시험을 다른 durable 경계나 전원 손실 proof로 일반화하지 않는다.
실제 manager/VM, 전체 suite, 전체 SIGKILL/powercut lane은 계속 NOT_RUN이다.

### 마지막 기능 checkpoint

다음은 문서 통합 전 마지막 기능 변경의 checkpoint다. 상세 로그와 당시 source binding은 [정리 전 검증 기록](../archive/validation-before-consolidation.md)에 보존했다. 과거 전체 실행을 현재 PASS로 사용하지 않는다.

| 요구 | 실제 구현과 정상/실패 oracle | 현재 판정·남은 것 |
|---|---|---|
| A tier/floor/checks | `runtime/candidate-checks`, GitModule callback와 broker 조립; candidate-checks·tiered-integration·tier-evaluator·integration-revalidation | 코드/fixture 검증. reviewer shortage 예외는 미구현/별도 거절에 따른 차단 상태. 실제 manager/cgroup candidate 검사도 별도 거절로 NOT_RUN. mutation/실환경 proof 미완료 |
| B Principal | `principalRequestAllowed`, PublicDispatcher, tool-surface와 workspace-guard; principal-stop-fence·tool-surface·실제 Pi의 loopback functional scenario | 제한적 source/runtime 회귀 통과. 다른 도구의 권한은 Principal routine 권한으로 승격하지 않음 |
| C 독립 clone/최초 snapshot/Config/수량 | `lifecycle/workspace`의 `clone --no-local`, raw worktree snapshot, Initial workers commit, 생성 quota와 inference slots; project-snapshot·worker-autonomy·settings-apply-time | SHA1/SHA256/dirty bytes·손상 거절·설정 0 및 재시작 회귀 확인. unit 설치는 scripted; manager proof 아님 |
| D closed/개별 stopped | `lifecycle/society`, actions와 reconcile activation gate; society-control·worker-autonomy·r25-lifecycle-owners | closed 재열기와 terminal replay·개별 stopped·현재 incarnation 회귀 확인. fake units를 실제 manager 증거로 취급하지 않음 |
| E 시간값·선택 mail | PiAdapter/PrincipalDelivery, selector alarm, egress placeholder alarm; delivery-deadlines·egress-observation-deadlines·r25-lifecycle-owners·f3-log-frame | 전체 TypeScript native timer/phase-budget call sites 분류. model/tool 전체 실행 deadline 없음. 긴 selector/egress waits의 native clamp 수정. 종료 grace는 writer exit proof가 아님 |
| F1 Mac seed | host-record project UUID/bookmark/root, bundled Git/helper, existing settings writer의 async seed; mac-project-seed·personal-settings·platform-host-service | absent binding은 빈 seed, unknown은 거절. bound project의 첫 seed에는 이미 실행 중인 app/guest가 필요함. Swift bookmark helper NOT_BUILT/NOT_RUN |
| F2 history | guest/host canonical identity·read-only paged preview·one private duplex channel·actual outgoing exit·post-cleanup host reread; host-history·guest-history·actual local PTY holder·composition/ownership | Linux의 로컬 실제 file/socket/PTY와 controlled process 경계 회귀 확인. remote 검색은 title/첫 메시지 preview 범위. native Mac/actual systemd holder 시작은 NOT_RUN |
| G 기록 | source owners, stale byte-review 철회, LOC/graph/ledger/trace/current digest | 정리 전 checkpoint는 archive에 보존. 이번 reference/trace 결박·구조 검사는 별도로 갱신하며 과거 static PASS를 새 입력에 재사용하지 않음 |

## 이번 문서 통합의 검증

문서 경로·owner·규범 fingerprint 구조 확인은 runtime/systemd/provider proof와 구분한다. 아래는 Node 24.21.0을 사용한 이번 문서 통합의 실행 결과다.

| 검사 | 판정 | 범위 |
|---|---|---|
| 문서 배치·링크·ID/수용 번호 | PASS | 새 파일·이동 파일 포함, 링크/ID/owner 검사 0 findings. 기존 규범 375개 ID와 수용 124행의 번호·내용 유지. 규범 내용은 경로·링크를 제외하고 동일 |
| 고정 architecture·계획·외부 리뷰 bytes | PASS | 정리 전 156개 파일의 SHA-256과 대조. 원문 bytes 동일 |
| 새 merge-review spec 본문 | PASS | 상대 Markdown 링크를 제외한 원문 동일성 확인. 설계·본문 보존 |
| document/trace/compliance/verification/review 경로 회귀 | PASS | 관련 8개 파일의 44 tests, fail/skip/cancel 0. 실제 서비스 실행 제외 |
| build / typecheck / check:architecture | PASS | 패키지 정적 검사·production inventory·규칙·의존 방향·transaction·durable boundary·문서 검사 |
| trace inventory / review ledger 생성 | GENERATED | 실제 owner 경로로 생성. 규범 375개 모두 unverified, stale/extra 0. 기존 UNIT-TPL-001..004의 inventory 누락도 복구. 생성은 검증 승격이 아님 |
| pinned cloc 재측정 | PASS | production 목록·원본 hash·측정 artifact 결박. 크기 상한 없음 |

실행 로그는 `/tmp/oma-doc-cleanup-build.log`, `/tmp/oma-doc-cleanup-typecheck.log`, `/tmp/oma-doc-cleanup-architecture.log`, `/tmp/oma-doc-cleanup-regressions.log`, `/tmp/oma-doc-cleanup-loc.log`, `/tmp/oma-doc-cleanup-review-ledger.log`에 있다. 임시 로그는 release evidence로 등록하지 않았다.

집중 회귀의 실행 명령:

```sh
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs \
  test/review-ledger.test.mjs test/consistency-decisions.test.mjs \
  test/review-closure.test.mjs test/durable-boundaries.test.mjs \
  test/production-inventory.test.mjs dist/test/compliance.test.js
```

## 선행 작업 A: Pi 0.87.1 → 1.0.1 이식 검증 (2026-10-05)

동봉 엔진을 `@earendil-works/pi-coding-agent@0.87.1`→`1.0.1`, `@earendil-works/pi-tui@0.87.1`→`1.0.1`,
`pi-open-tui@0.3.9`→`0.3.11`로 원자적으로 올렸다(package.json + package-lock 한 커밋). 이식 내용과
upstream delta 판정은 [plan §A 실행 결과](../plan-prereq-and-bundled.md#a-실행-결과-1010311-이식-완료)가 소유한다.
`PI_ADAPTER_REVISION`은 ENG1 관례대로 검증한 엔진을 이름에 박아 `oma-pi-rpc-v1@1.0.1`이 되었고
BATCH-006의 규범 본문과 trace 행도 같은 문자열로 재결박했다. 0.87.1 adapter의 미정산 영수증은
업그레이드 뒤 conflicting이다 — 기존 society는 정산 뒤 올린다(ENG1과 같은 절차).

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| package-lock / 설치 closure | PASS | `npm install` 재생성, `npm ls @earendil-works/pi-tui` 단일 1.0.1(dedupe, 중첩 사본 없음). pi-agent-core/pi-ai는 `^1.0.1` 범위로 1.0.3 |
| build / typecheck | PASS | Node 24.21.0(`/opt/oma-test-node/bin`), `npm run build` + `tsc --noEmit` 0 오류 |
| pi-compat 오라클 | PASS | `test/pi-compat.test.ts` 전부 — 환경 스트립 목록·resume hint·private member 12개 존재를 설치본 1.0.1에서 실측 대조. `quietStartup "header"` literal 보존 회귀 추가 |
| wire/명령·호환 경계 | PASS | interactive-input 내장 명령 미러, `pi-ui-channel-spike`의 1.0.1 UI RPC 메서드 목록, `prompt-boundary` 경계 시험 |
| 실제 엔진 PTY 회귀 | PASS | `open-tui-pty`(8 ending) + `personal-pty`(15 ending): 실제 1.0.1 InteractiveMode + open-tui 0.3.11 extension + ownedEditor proxy로 /new·/resume·/fork·/reload·kill·retry·restore |
| delivery/authority 시나리오 | PASS | 전체 `npm test`의 SCN-*/DR27/broker/authority/receipt/frame-boundary 그룹 포함 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane — 아래 NOT_RUN 제외, 총수·실패수는 실행 로그가 소유 |
| check:architecture | PASS | inventory·rules·architecture-check·transactions·boundaries·documents·spec-inventory 0 findings |
| review-ledger / review-closure | GENERATED | 변경 production 파일은 `review-notes.json`의 byte-bound reviewedChange로 결박 후 재생성 |
| systemd-required suite | NOT_RUN | test-local이 명시한 9개 파일(audit/audit2/cli/phase4/phase5/phase8/crash-boundaries/launch-topology/cgroup-pin) — 이 Linux 호스트에 user bus/systemd 없음 |
| kernel/rootfs/deployment attestation | NOT_RUN | 빌드 스크립트가 "entrypoints not started, systemd/kernel/rootfs/Pi pins not attested, deploymentDigest 미합성"으로 보고 — 로컬 한계 그대로 |
| powercut / provider / CI / macOS native | NOT_RUN | 승인된 VM·credential·CI가 없어 이전과 같은 제외. V27A·V31A의 과거 PASS는 이 엔진/이 source로 승격하지 않는다 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업 C: `/society` 게이트 + execve 재진입 검증 (2026-10-05)

기록 없는 Personal 세션의 Society 전환을 구현했다 — `/society` → 프로젝트 자신의 슬롯(`<data>/<project>`)
읽기 전용 게이트 → `session_before_switch` → writer 실제 종료 → host가 `oma --society <project>`로
execve. 계약은 MODE-005, 설계 판정·명령명 확정·내구 경계 선택은 [plan §C 실행 결과](../plan-prereq-and-bundled.md)가
소유한다. 내구 경계는 슬롯의 `publishProjectBinding`: 게이트↔재진입 구간은 무기록이므로 그 사이의
kill/powercut은 다음 `/society`의 재관측으로 끝나고, binding 게시 뒤 재시작은 그 Society를 born으로
인식한다. 미확정 게시는 성공으로 승격하지 않는다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| 게이트 실파일 오라클 | PASS | `test/society-slot.test.ts` 8종 — free·슬롯 무생성, binding 게시→거절 전환(내구 경계), 다른 프로젝트/다른 society 바인딩, 손상 바인딩(unreadable), EACCES 관측 불가(unavailable→거절, 부재 승격 없음), binding 없는 Society 기록, 동일 birth 잔여=재개·다른 birth=거절, legacy slug 슬롯 |
| wire 문법 | PASS | `personal-session-ownership` — `{type:"switch", society}` 수락, session+society 혼합·미스트링·추가 키 거절, 실패 종료(≠0)에는 handoff 없음, 첫 유효 메시지만 |
| host 합성 | PASS | `personal-host-composition` — 자식 실제 종료 전 execve 없음, argv `[oma.js --society <project>]`, `OMA_RESUME_SESSION` 미설정, birth cwd로 chdir(resume된 창과 다를 수 있음), 이름 불일치 INVALID_REQUEST, execve 부재 UNSUPPORTED_PROFILE |
| 엔진 합성 | PASS | `personal-engine-ownership` — `society` 명령 등록, free 슬롯 → before-switch → send → shutdown 순서, 거절·관측 실패 통지 후 세션 유지, darwin 무전환 거절(게이트 미호출), before-switch cancel, 전환 중 이중 진입 불가, IPC send 실패 시 재시도 가능 |
| 실제 PTY 거절 | PASS | `personal-pty` `society-bound` — 설치본 Personal에서 바인딩된 슬롯에 `/society` 입력 시 이름 있는 거절이 화면에 보이고 세션은 계속 살아 응답 |
| 실제 전환 e2e (Linux) | PARTIAL — 환경 한계 | `/society`가 real TUI에서 gate→종료→execve `oma --society <project>`까지 수행됨을 pty-harness로 관측; 재진입 프로세스가 `project-binding.json`(canonical path)+`session-mode.json`(mode society)+provisioning 트리를 실제로 기록하고 Society Control Panel까지 도달. broker 시작은 `UNSUPPORTED_PROFILE: systemd user manager`로 정직 실패 — 이 호스트에 user bus 없음(기존 systemd NOT_RUN lane과 동일). TUI 단계 이후 정상 동작·Worker는 미검증 |
| 내구 경계 회귀 | PASS | `crash-kill-boundaries`의 D05/P0-7 binding SIGKILL 전 지점 absent-or-whole + 임시파일 수거 — `/society`가 의존하는 게시물의 기존 경계 시험 재확인 |
| 인접 회귀 | PASS | `project-binding`, `session-mode-record`, `session-resume`, `session-entry-composition`, `oma-composition-policy`, `session-handoff-owner`, `interactive-input`, `compact-tools`, `society-crash`, `session-mode-pty`, `personal-pty` 전 종 |
| check:architecture·inventory·ledger | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; `production-files.txt`/`production-loc-hashes.json`/`traceability.json`/`review-ledger.json` 재생성, `review-notes.json`에 신규·변경 파일의 byte-bound reviewedChange 결박 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3635 tests → 3634 PASS; 유일 실패 1건은 이 변경이 추가한 두 파일까지 반영하지 않은 stale verification-input digest로, digest를 이 트리의 것으로 갱신 후 `production-inventory` 재실행 10/10 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd broker 완주 / powercut·provider·CI | NOT_RUN | 승인된 환경 없음 — `/society`의 darwin 분기는 주입 시험만으로 구조 검증됐고 native 증거를 주장하지 않는다 |

## 선행 작업: bundled extension #4 — pi-web-access 검증 (2026-10-08)

§7 순서(lsp→ask→hashline→web→mcp)의 네 번째 확장. `pi-web-access@0.35.0`을
`src/extension/vendor/pi-web-access/`에 byte-pinned vendor하고 `src/extension/web-tools.ts`
어댑터가 verify→Society 정책 설치→facade→upstream 팩토리 순서로 정확히 4개
web_research 도구만 등록한다. 구현 내용과 divergence 목록은 WORKSTREAM §9 로그와
`src/extension/vendor/pi-web-access/NOTICE`가 소유한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| upstream 정체성 | PASS | npm tarball shasum `a807f0d5c6dfa6893f24e00320774a55425f864b`·SRI `sha512-D1GMJMNDG2omAkL1ztmO6ZEwEyW7LoFpTcckKh2yXjLyAgDFuhpTQrs2jQPAlVtGb3rjAeIXRZrkhFcwSWdGSg==`·source commit `72c6e67787d67d8a7d01bf0abf30c072a6112de6` — `manifest.json` package 필드와 생성기 EXPECTED_PACKAGE가 결박 |
| 번들 생성·재생성 | PASS | `node scripts/vendor-pi-web-access.mjs --check` → `BUNDLE_CURRENT` (11,020 files): staged 소스 재작성→tsc 재방출→divergence 재적용→발방출 집합 비교→매니페스트 메타(package·dependencies·divergences) 재검증 |
| 번들 무결성 경계 | PASS | `test/web-bundle.test.ts` 12종 — source/dist 번들 검증, 변경·누락·미기재·손상 멤버 fail-closed, upstream-tests 트리 보존(104 entries), 정확한 4개 도구·facade 전달만·검증 실패 시 등록 0+세션 거절, 역할 surface 정합(Principal·Resident 모두 web_research 그룹), ambient discovery deny-by-default(`!command` credential·browser cookies·gh/git clone·host ADC·native media·local file·curator workflows), egress 미결선 시 비어있지 않은 proxy 전면 거절·결선 시 pin 외 값 `[E_OMA_PROXY_PINNED]`, SSRF/내부 대상 사전 거절, 매니페스트 메타 결박 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings — 어댑터의 동적 import는 전부 검증된 번들 안 runtime/ 경로(undici dispatcher는 utils.js divergence의 re-export를 경유; runtime-closure 해석기는 node_modules 해결 지정자를 거절하므로) |
| check:package | PASS | vendored runtime의 host API(`@earendil-works/*`, typebox) import는 설치본 존재를 확인하는 host peer 의미로만 허용 — 사용자 설치 Pi 패키지 해석과 무관 |
| 인접 회귀 | PASS | `lsp-bundle`(BL1)·`hashline-bundle`(BL3)의 surface 테스트에 web_research 등록 집합·그룹 추가 후 전 종 PASS; `platform-packages`·`pi-packages-cli`·`p24-deployment-gates`·`personal-pty` 전 종 PASS — `deployment-manifest.ts`의 MAX_ENTRIES를 4096→32768로 상향(vendored 클로저 ~11k 파일이 deployment inventory walk의 해시 대상; bound는 여전히 absurd inventory 거절) |
| DR27 대기-관측 시나리오 | PASS | `scenario-agent-wait` 5/5 — `idleStreamSeconds` 2→6초·fixture 관측 지연 3.5→10초: 번들 검증(~0.5s)+모듈 평가(~0.8s)이 엔진 기동을 2초 예산 밖으로 밀어 DEADLINE_EXCEEDED로 deterministic 실패하던 것을 예산 상향으로 정정(관측이 제어-idle 예산을 outlive한다는 시나리오 의미 보존) |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3794 tests → 3790 PASS, 실패 4건의 내역: web-bundle/dist 1건과 R38 2건은 이 절 작성 시점의 미재생성 산출물(NOTICE 문구 갱신 후 dist·digest 미동기)로, 재빌드·digest 재결박 후 단독 재실행 전부 PASS; SCN-L02 1건은 8-way 병렬 aggregate에서만 재현되는 타이밍 flake로 단독 재실행 40/40 PASS — systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 | NOT_RUN | `upstream-tests/`는 provenance/포팅용으로 vendored — upstream 자체 하네스 의존(vitest·네트워크 fixture)이라 npm test에 연결하지 않음 |
| macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 승인된 환경 없음 — 이전과 같은 제외. vendored egress dispatcher의 실제 CONNECT forwarder 통과는 Linux 루프백 경계 시험까지만 확인 |

**정정 (후속 맹검증)**: 위 `npm test` 기록("3794 tests → 3790 PASS, 실패 4건")은 deterministic 실패 1건을 누락했다. 이 트리에서 `test/review-closure.test.mjs`의 "DR27/V32A: historical review cannot certify unbound working-tree changes"가 `git ls-tree -r --name-only -z HEAD`의 출력(1,064,186 bytes — vendored 번들이 HEAD tree listing을 Node `execFileSync` 기본 maxBuffer 1 MiB 위로 밀어 올림)이 default bound를 초과해 ENOBUFS로 실패하고, `node scripts/review-ledger.mjs`(`npm run review:ledger`)도 같은 call에서 ENOBUFS로 exit 1이었다. 기록된 4건의 열거에는 이 실패가 없으므로 당시 실행의 실제 실패 수는 최소 5건이었거나, 이 실패가 같은 실행에서 발생했다면 기록이 누락된 것이다. 수정: verification tooling의 모든 동기 git plumbing 호출(`review-ledger.mjs`의 `ls-tree`/`diff --name-only`/`log`, `review-closure.test.mjs`의 동일 두 call)에 canonical bound를 적용했다 — `scripts/review-closure.mjs`의 `GIT_PLUMBING_LIMITS`가 `CANONICAL_PROCESS_LIMITS`(src/git/canonical-command.ts)와 동일 값으로 test에서 결박되고, 회귀 test "V32A: verification git plumbing runs under the canonical process bound"가 generator의 모든 `execFileSync` call site가 bound를 통과함을 pin한다. 수정 후 `node scripts/review-ledger.mjs` exit 0, 해당 suite 파일 8/8 PASS.

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업: bundled extension #5 — pi-mcp-adapter 검증 (2026-10-09)

§7 순서의 마지막 확장. `pi-mcp-adapter@5.0.0`을
`src/extension/vendor/pi-mcp-adapter/`에 byte-pinned vendor하고
`src/extension/mcp-tools.ts` 어댑터가 verify→정책 설치→수명주기 훅→
facade→upstream `createMcpAdapter` 순서로 정확히 `mcp` 1개 도구만
등록한다 — upstream 자체가 lazy 단일 프록시라 OMA grouping을 얹지 않고
surface plan이 `mcp`를 DIRECT로 이름 붙인다. 구현 내용과 divergence
목록은 WORKSTREAM §9 로그와 `src/extension/vendor/pi-mcp-adapter/NOTICE`가
소유한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| upstream 정체성 | PASS | npm tarball shasum `6c20461d658ec7d7b7e303b067e2ff13a7846d00`·SRI `sha512-/3vWQLSXwud+VX1vV/dFfKpp6I40guCeqiaP/XMdXIyon+frIm+sPXGArLlmvY5PIwL2ChJ3AhELIusroGA8Ng==`·source commit `5783e5eacfe820829b18be5d4de91e5f46e79dbb` — `manifest.json` package 필드와 생성기 EXPECTED_PACKAGE가 결박 |
| 번들 생성·재생성 | PASS | `node scripts/vendor-pi-mcp-adapter.mjs --check` → `BUNDLE_CURRENT` (2,727 files): staged 소스 재작성→tsc 재방출→27파일 divergence 재적용→발방출 집합 비교→매니페스트 메타(package·dependencies·divergences) 재검증. upstream `npx-resolver.ts`의 implicit any·cross-spawn 선언 부재에 대한 비치명 tsc 진단은 stderr에 기록되나 발방출 집합 일치 시 성공(BL4 관례) |
| 의존 클로저 | PASS | DEPENDENCIES 핀 테이블 42개 패키지(`@modelcontextprotocol/client`·`core`·`ext-tasks`, `undici`, `zod`, `ajv` 계열, `open` 계열, `@napi-rs/keyring`, `recheck`, `quickjs-wasi` 등)가 `node_modules/` 아래 npm tarball 바이트 그대로(2,086 files); 사용자 설치 패키지는 어떤 vendored import도 충족하지 못한다 — 번들 자체 node_modules walk만 허용 |
| 번들 무결성 경계 | PASS | `test/mcp-bundle.test.ts` 14종 — source/dist 번들 검증, 변경·누락·미기재·링크·손상 멤버 fail-closed, upstream-tests 트리 보존(207 entries), 정확한 `mcp` 1개 도구·facade 전달만(command·flag·shortcut drop 기록)·검증 실패 시 등록 0+세션 거절, `registerMcpServer`/`getMcpServers` 부재로 Pi built-in MCP 공존 경로 소등(`piSupportsMcp` false), 두 role surface plan이 `mcp`를 DIRECT로 명명·그룹 없음, config 검증이 `imports`·`claudePlugins`·surface-변경 설정·`npx`/`npm` command·비-http(s) url·`!`-command secret sink를 거절, OMA 소유 `mcp-adapter.json`(Pi built-in `mcp.json`과 구분되는 upstream adapter-config 이름)만 읽고 malformed fail-closed, OMA state의 credential key·scratch 수명주기(shutdown에 삭제), 공유 child-env scrub(allowlist·proxy pin 일치만·scratch redirect), 정책 설치가 vendored runtime 안에서 live, egress pin·loopback bypass·무결선 no-proxy fallback, 매니페스트 메타 결박 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings — `mcp-tools.ts`의 raw fs mutation은 Pi extension 경계 면제 표(`state-tree-rules.mjs`·`owned-state-rules.mjs`, lsp-tools와 같은 사유)에 명시 등록; `production-files.txt`·`production-loc-hashes.json`·`dependency-graph.json` 재생성 |
| check:package | PASS | vendored runtime의 host API import는 BL4와 같은 host peer 의미로만 허용 |
| `--no-extensions` 정합 | PASS | `pi-spawn-plan.ts`·`pi-interactive-host.ts`·`pi-personal.ts`의 세 엔진 경로 전부 `--no-extensions`(discovery 소등)와 명시 `-e` core extension 경로를 양립 사용 — vendored 등록은 core extension 안에서 일어나므로 정책 충돌 없음 |
| 인접 회귀 | PASS | `lsp-bundle`(BL1)·`hashline-bundle`(BL3)·`web-bundle`(BL4)의 surface 테스트 등록 집합에 `mcp` 추가 후 전 종 PASS — 공유 `child-env.ts` 추출로 LSP의 child env 의미 변경 없음을 lsp suite가 재확인 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane — 재결박 전 첫 실행은 3809 tests → 3803 PASS·6 실패로, 6건 전부가 이 절 작성 시점의 미재생성 산출물(BL1/BL3/BL4 surface 집합 미갱신 3건, review-closure의 ledger 결박 2건, R38 verification-input digest 1건)이었다; 수정·재생성 후 해당 파일 단독 재실행 전부 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 | NOT_RUN | `upstream-tests/`는 provenance/포팅용으로 vendored — upstream 자체 하네스(vitest·네트워크 fixture) 의존이라 npm test에 연결하지 않음 |
| 실제 MCP server live 세션 / macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 승인된 환경·자격 없음 — 경계 시험은 fakePi·정책 프로브·loopback 경계까지, 실제 downstream MCP 서버와의 end-to-end 세션 증거는 주장하지 않는다 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 선행 작업: bundled extension #5 — pi-mcp-adapter 맹검증 정산 검증 (2026-10-09)

BL5 vendored 어댑터에 대한 맹검증 잔여 발견 F1–F6의 정산. 구현 내용은
WORKSTREAM §9의 해당 로그가 소유한다; 이 절은 검증 범위만 기록한다.

| 검사 | 판정 | 실제 실행 범위 |
|---|---|---|
| F1 SDK child-env union | PASS | `mcp-tools.ts`의 `childEnvFinish`가 scrub 결과 위에 vendored SDK `getDefaultEnvironment` underlay 이름의 `undefined` tombstone을 씌운다 — vendored `node_modules/.../stdio.mjs`의 실제 `StdioClientTransport`로 child를 spawn해 `process.env`를 직렬화, scrub이 거절한 `SHELL`과 win32 underlay 이름(APPDATA·HOMEDRIVE·HOMEPATH·LOCALAPPDATA·SYSTEMROOT·TEMP·USERNAME·USERPROFILE·PROGRAMFILES·LOGNAME·TERM·USER)이 child에서 부재·`HOME`/`LANG`/`PATH`는 OMA 값으로 존재를 확인; tombstone을 뺀 대조군에서는 `SHELL`이 SDK underlay에서 재유입됨을 같이 관측해 결함 재현. dependency 바이트 변경 없이 OMA 소유 코드에서 해결 |
| F2 UI-session escape | PASS | `OmaMcpPolicy`에 deny-by-default `ui-session` permit 추가; `direct-tools.js`·`proxy-modes.js`는 UI-resource 호출을 구조화된 `ui_session_refused`로 조기 거절하고 `ui-session.js`·`glimpse-ui.js`는 방어심층 게이트로 `who`/`orca` subprocess·`npm root -g`·host-global `glimpseui` 동적 import·browser open에 도달하기 전에 거절 — fakePi로 실 vendored stdio server를 띄운 E2E 포함, 정책 미설치 시 upstream 동작 보존 |
| F3 부재 판정 | PASS | `existsSync` 대신 `statSync` ENOENT-only catch — chmod 000 config는 `EACCES`로 propagate(빈 config로 오인 금지)·비-정규 경로는 `[E_OMA_MCP_CONFIG]` 경계 에러·malformed JSON과 구분; `oauth-file-key` 읽기 실패도 ENOENT만 "없음"이고 나머지는 재throw해 침묵 키 재발급 차단 |
| F4 command admission | PASS | `npx`/`npm` 거절이 basename 정규화(`/`, `\`, `.cmd/.exe/.bat/.ps1` shim, 대소문자) 후 비교 — `/usr/bin/npx`·`./node_modules/.bin/npx`·`C:\Tools\npm.cmd`·`C:\Program Files\nodejs\npx.EXE`·`npm.ps1`·`npx.bat`·`NPM` 전부 거절, `npm-helper`·`npx-serve`·`srv.CMD`·`/usr/local/bin/server-bin` 허가 유지 |
| F5 dead code | PASS | 미사용 `omaStateDir()` 헬퍼와 `{stateDir:"",durable:false}` 폴백 제거 — typecheck이 참조 부재를 입증 |
| F6 tautological assert | PASS | `mcp-bundle.test.ts`의 upstream-tests 검증에서 직전에 assert된 조건을 반복하던 `A || B` 분기를 vitest config·test-runner 존재와 suite 규모(>=150 test files)의 실체 검증으로 교체 — vendored 트리가 테스트를 침묵 상실하면 실패 |
| 번들 재생성 | PASS | `node scripts/vendor-pi-mcp-adapter.mjs --write`로 runtime·manifest 재생성 후 `--check` → `BUNDLE_CURRENT` (2,727 files); 의미 변경은 전부 `OMA_DIVERGENCES` 표 기술분, dependency 바이트 무수정 |
| `pi.events` posture | PASS(기록) | facade가 `pi.events`를 그대로 전달하고 `pi-mcp-adapter:runtime-register`는 `normalizeOmaMcpConfig`를 우회해 runtime 서버를 등록할 수 있다 — in-process 전용이고 다른 OMA 확장이 발행할 수 없으며 런타임 거절은 등록 서버에도 적용됨을 모듈 주석·review-notes에 기록; 완전히 닫힌 경계가 아니라 문서화된 posture |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture / check:package | PASS | inventory(SOURCE_DIGESTS_CURRENT)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; host API peer import 정책 변경 없음 |
| `test/mcp-bundle.test.ts` | PASS | 18종 전 종 PASS (기존 14종 + tombstone 실spawn·UI 거절 E2E·ENOENT-only 부재·basename 거절 확장) |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 3813 tests → 3812 PASS; 유일 실패 1건은 이 절 추가·정산 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 10/10 PASS. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| upstream 테스트 이식 / live MCP 세션 / macOS native / systemd / kernel·powercut / provider / CI | NOT_RUN | 이전 절과 동일 — 승인된 환경·자격 없음, 경계 시험까지만 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: post-listen 'error' 전수 스캔 검증 (2026-10-07)

DR34 후반에서 미뤄 둔 "listen 성공 후 `.off`로 유일한 'error' 리스너를 해제" 부류의 6곳 전수 정산과 동일 emit-탈출 잔여(rpc FrameParser·egress-bridge stderr·cloc 계정 own-key)의 로컬 검증. 결정론 오라클은 `server.emit("error", EMFILE)`의 동기 주입 — 리스너가 없으면 그 자리에서 throw이고, 있으면 영구 리스너가 journal만 하고 흡수한다.

| 절차 | 결과 | 근거 |
|---|---|---|
| post-listen 'error' 흡수 — 6곳 | PASS | `test/post-listen-error.test.ts` 9 오라클: `server.emit("error", EMFILE)` 직접 주입 뒤 ①영구 리스너 정확히 1개, ②journal 도달(console.error 캡처·audit `(listener)`/`fail`·`onError` 콜백), ③`server.listening` 유지, ④같은 소켓 이름이 여전히 연결을 받음. 죽은 journal 싱크(throwing audit·throwing onError)도 emit을 탈출하지 않음 |
| oma-society 저널 심 | PASS | `EgressForwarder.listen`의 새 `onError`가 `openPrincipalEgress`→`adoptPrincipalEgress`→`notice`로 연결; `egress degradation` 스모크가 adoption 경유 옵션 통과 확인. HostTenure 소유·hold/abandon 계약 불변 — 영구 리스너는 bound 유지라 close/lease 수명에 손대지 않음 |
| rpc FrameParser emit 경계 | PASS | NaN frameBytes 주입 시 생성자 throw이 'data' emit 탈출·uncaughtException 대신 읽기의 RangeError 거절이 되고 `escaped=[]` (platform-rpc.test.ts DR27 신설) |
| egress-bridge·inference-bridge 리스너 가드 | PASS | 실제 EADDRINUSE + `stderr.write`가 던지는 상태에서 두 bridge 모두 wedge 없이 degraded resolve, uncaughtException 0건; inference bridge는 guard 아래 fallback retry가 실제 바인드 포트의 provider URL을 등록 (extension-bridges.test.ts 신설) |
| vendored curator-server | PASS | `runtime/curator-server.js`에 OMA_DIVERGENCES splice로 영구 리스너 + 보호된 journal 적용 — `node scripts/vendor-pi-web-access.mjs --check` → BUNDLE_CURRENT(11,020 files); 설치된 표면은 workflow pin이 "none"이라 도달 불가, 미설치 평가 대비 defense in depth |
| cloc 계정 own-key | PASS | `Object.hasOwn` 기반 `rowAt`으로 `constructor`/`hasOwnProperty` 이름의 인벤토리 멤버가 prototype 상속 멤버로 오계정되지 않음을 inventory-evidence-split 신규 오라클로 고정; `temporary editor file` verdict 인정 추가, 관측 이상 verdict(file size·not-file·cannot read·unable to associate)는 여전히 게이트 실패 |
| startup reject 계약 유지 | PASS | bind 실패는 여전히 `once("error", reject/failed)`가 거절 — 영구 리스너는 대체가 아니라 병존(기존 startup-failure 테스트 전부 PASS로 간접 입증) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings; LOC-004 재지문 drift 없음 |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3829 tests, 3828 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification / 실제 fd 소진 주입 | NOT_RUN | 로컬 환경 부재 — 게스트·omahostd 단위의 in-situ 관측과 실제 EMFILE 유도(프로세스 fd 한도 소진)는 환경 의존이라 비결정론적이라 의도적으로 제외, 동기 emit 주입으로 같은 경계를 결정론적으로 커버 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: post-listen 'error' 잔여 — vendored listen 경계·emit 안 저널·emit 안 재등록 검증 (2026-10-07)

직전 전수 스캔(위 절)이 고친 부류의 맹검증 잔여 4건 정산. 같은 모델 — 동기 emit 안에서 던지면 emit을 탈출해 프로세스가 죽는다 — 을 vendored listen 경계, 공유 저널, 'listening' emit, request/upgrade emit에 적용했다.

| 절차 | 결과 | 근거 |
|---|---|---|
| vendored pi-mcp-adapter listen 경계 3곳 | PASS | `OMA_DIVERGENCES` splice만으로 정산(생성 runtime 직접 수정 없음): `runtime/ui-server.js` host server(후보별 once-listener 재무장+성공 시 해제)·sandbox proxy(동일 once+off)와 `runtime/mcp-callback-server.js`(once-listener가 성공 후에도 제거되지 않아 첫 post-listen 에러는 settled reject가 삼키고 둘째는 emit을 탈출하던 전이 결함) — 셋 다 영구 리스너 + 보호된 journal, callback은 named `onStartupError`를 listen 성공 시점에 정확히 해제해 "삼킴→무가드" 전이 제거. callback 서버는 허용된 auth:"oauth" 경로로 실도달(mcp-auth-flow → ensureCallbackServer). runtime·manifest는 스크립트 재생성물, `node scripts/vendor-pi-mcp-adapter.mjs --check` → BUNDLE_CURRENT(2,727 files) |
| vendored emit 주입 오라클 | PASS | `mcp-bundle.test.ts` 신규 2종: `Server.prototype.listen` 캡처로 클로저 내부 server에 도달 — 콜백 서버는 연속 2회 `emit("error", EMFILE)` 전부 journal 도달·`listenerCount("error")===1`(startup once 해제)·listening 유지·같은 포트 계속 connect·uncaughtException 0; ui-server는 host+proxy 각각 흡수 |
| broker cleanup 저널 | PASS | `cleanupError`의 `console.error`를 보호된 best-effort write로 — `listen`의 영구 리스너와 `listenActor`의 run-revoke 경로가 모두 동기 'error' emit 안에서 이 싱크에 도달하고, 죽은 stderr의 throw는 emit을 다시 탈출하던 것. `post-listen-error.test.ts` 신규 오라클: 던지는 console.error 아래 실제 `server.emit("error")` 흡수(listening 유지) + 공유 싱크 직접 호출 무탈출 |
| cloc 구조 키 충돌 | PASS | `rowAt`이 `header`/`SUM`/`nonCode` 구조 멤버를 파일 row로 읽지 않도록 `CLOC_REPORT_STRUCTURE_KEYS`로 배제 — 루트에 같은 이름의 파일이 있으면 구조 값이 그 파일의 row로 오독돼 phantom 계정되던 슬롯. 실제 행은 `./`-철자 키(구조 키·prototype 멤버와 충돌 불가) 또는 nonCode verdict만 계정. `inventory-evidence-split.test.mjs` 신규 오라클: 구조만 있는 세 이름 각각이 `cloc omitted or misclassified`로 실패 + `./`행·nonCode verdict는 정상 계정 — 실패 방향 고정 |
| inference-bridge 'listening' emit | PASS | 'listening'도 같은 동기 emit 경계 — emit 안 `registerProvider` 재등록을 가드. 거절은 pre-listen이 설치한 unreachable provider를 그대로 유지(안전한 degraded: relay는 unused로 listen하고 engine이 우회하지 않음), journal은 best-effort, unref·resolve는 도달. `extension-bridges.test.ts` 오라클: 실제 EADDRINUSE fallback + 재등록을 거절하는 registerProvider → wedge 없이 resolve·uncaughtException 0·등록은 unreachable만·저널 기록 |
| inference-relay request/upgrade emit 경계 | PASS | `forward`/`tunnel` 호출을 emit 경계 try/catch로 감쌈 — `admit`이 Refusal이 아닌 실패를 재던지면 unguarded는 `server.emit`을 통째로 탈출해 runner 사망이 되던 것을 그 연결 destroy+`failed` 계수로(정책 거절 refused와 구분, connect-proxy가 같은 부류에 두는 경계). `inference-relay.test.ts` 오라클: `server.emit("request"/"upgrade")` 직접 주입(읽을 수 없는 headers로 admit 안 비Refusal throw 유도) → 연결만 파괴·failed=2·refused=0·escaped=[]·listening 유지. 평가하고 범위 밖으로 둔 잔여: provider 쪽 `upstream` ClientRequest의 'upgrade'/'response'/'error' 리스너 — 본문의 socket write/end/writeHead는 이 Node(destroyed socket도 동기 throw 대신 비동기 'error')에서 emit을 탈출하는 동기 throw 경로가 없고, `accept()`의 `server.emit("connection")`는 http 내부 리스너 대상이라 같은 판정 |
| startup reject 계약 유지 | PASS | vendored 경계 모두 startup bind 실패는 여전히 once-listener가 reject — 영구 리스너는 대체가 아니라 병존이고 callback은 named listener 해제가 listen 성공에만 묶임(기존 startup-failure 테스트 PASS로 간접 입증) |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| check:architecture | PASS | inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice·transactions·boundaries·documents·spec-inventory 0 findings |
| 전체 `npm test` | PASS* | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,835 tests, 3,834 PASS; 유일 실패 1건은 이 절과 결박 산출물 변경분을 아직 반영하지 않은 validation.md 자체의 stale verification-input digest(R38)로, digest를 이 트리의 것으로 재결박 후 `production-inventory` 재실행 PASS 확인. systemd-required 9 파일은 환경 부재로 NOT_RUN 분리 |
| macOS native / systemd / kernel·powercut / provider credential / release qualification / 실제 fd 소진 주입 | NOT_RUN | 직전 절과 동일 — 로컬 환경 부재, 동기 emit 주입이 같은 경계의 결정론 오라클 |

\* 전체 suite의 최종 종료 코드는 이 절을 쓰는 시점의 로그로 확정했다; systemd lane은 위처럼 별도 NOT_RUN이다.

## 정산: 운영 읽기의 진단 예산 공유 결함 (UX-37, 2026-10-07)

`LedgerReader.all`이 행마다 `DIAGNOSTIC_READ_LIMITS`(10,000행/32MiB)를 과금해 운영 흐름(상태 표시·runner 대기열·principal relay·recovery)이 society의 행 수만으로 `LIMIT_EXCEEDED`로 거절되던 결함을 정산했다. 관리자 진단 스냅샷의 유한 상한은 유지한다 — 같은 상태에서 `readDiagnosticSnapshot`만 계속 `LIMIT_EXCEEDED`로 거절함을 대조군으로 고정.

| 절차 | 결과 | 근거 |
|---|---|---|
| 운영 카운트는 SQL 집계 | PASS | `LedgerReader.pendingDeliveryCount`는 `COUNT(*)`; `broker/composition.ts`의 dispatcher port가 이를 직접 바인딩해 `runner.pending`·principal relay가 목록을 물질화하지 않는다. 카운트는 읽기를 줄일 뿐 숨기지 않는다 — 실제 순회 경로는 여전히 행마다 디코딩·검증 |
| 대량 운영 열거는 keyset 스트림 | PASS | `pendingDeliveryRows`는 `MAX(rowid)`를 순회 시작에 동결하고 128행 닫힌 페이지를 `rowid > after`로 진행 — yield 사이에 열린 커서가 없고, 순회 중 새 수용은 이번 순회가 아닌 다음 순회에 귀속. `pendingDeliveries`는 이 스트림의 완전 수집 |
| 나머지 운영 열거는 예산 없는 완전 수집 | PASS | `agents`·`subscriptions`·`submissions`·`attestations`·`recoverableIds`·`operationDeliveries`·`pendingWorkRows`·`preparedBatches`·배치 링크드 목록이 더 이상 행/바이트 상한을 과금하지 않는다. 리니지·소유자·매니페스트↔멤버·수신자 스냅샷 등 행별 검증은 유지. 같은 컬렉션 안 반복 관측은 `ReadScope`로 동기 창 일관 보장 |
| 실패는 빈 답으로 승격하지 않음 | PASS | 어떤 운영 읽기도 query 실패를 `[]`로 변환하지 않는다 — `prepare` 실패는 그대로 throw. `G02-ledger-r2` ②: `prepare`가 throw하는 DB에서 `agentNames`·`recoverableIds`·`pendingDeliveries`·`pendingDeliveryCount`·`pendingWorkRows` 전부 throw |
| 10,000행 초과 완전성 회귀 | PASS | `operational-read-budget.test.ts` ①: shipped DDL+INSERT로 10,001 구독·10,300 운영(10,000 unbatched+300 준비 배치)·10,500 배달 시딩 → 카운트·수령인·rowid 순서·복구 id·`pendingWorkRows`·principal relay 목록·`runner.pending` 집계·배치 상세·링크드 전수 일치; 같은 상태에서 `readDiagnosticSnapshot`은 `LIMIT_EXCEEDED`(음성 대조). ③keyset: 순회 중 삽입분 제외·삭제분 미재방문·다음 순회 재관측 |
| fail→pass 대조 | PASS | 직전 커밋을 별도 worktree에서 tsc로 빌드해 동일 시드(10,001 구독·10,001 배달) 주입 → `allSubscriptions`·`pendingDeliveries`·`recoverableOperations`·`pendingWorkRows` 전부 `LIMIT_EXCEEDED` throw; 수정 후 동일 fixture는 완전 결과 |
| build / typecheck | PASS | `npm run build` + `tsc --noEmit` 0 오류 |
| 전체 `npm test` | PASS | `node scripts/test-local.mjs` 로컬 lane 397 files → 3,834 tests, 3,834 PASS; systemd-required 9 파일은 환경 부재로 NOT_RUN 분리. 첫 실행의 3건은 정산됨 — P18 경계 스텁을 새 카운트 계약으로 갱신, R38 digest 재결박, SCN-L02는 병렬 부하 타이밍 flake(단독·재실행 모두 PASS) |
| architecture gates | PASS | check:inventory(SOURCE_DIGESTS_CURRENT, 14,173 files)·rules·lattice(dependency-graph 재생성 후 PASS)·transactions·boundaries·documents·spec-inventory 0 findings |
| macOS native / systemd / kernel·powercut / provider credential / release qualification | NOT_RUN | 로컬 환경 부재 — 결정론 오라클(시드+keyset 시나리오+실패 주입)이 같은 경계를 묶는다 |

## 현재 알려진 한계와 남은 검증

- 실제 manager/cgroup candidate 검사와 reviewer shortage 예외는 기존 독립 거절의 영향을 받는다. fixture 성공을 실제 서비스 증거로 사용하지 않는다.
- native Mac VZ·Keychain·APFS·Swift build와 실제 host↔guest lifecycle 증거는 이 Linux 환경에서 NOT_RUN이다.
- 이전 systemd/VM ownership/isolated-HOME probe 거절과 aggregate suite 금지는 [HANDOFF](../HANDOFF.md)에 유지한다. 문서 이동은 실행 허가가 아니다.
- F1의 bound project 첫 관측에는 이미 실행 중인 app/guest를 요구했던 한계가 남아 있다.
- F2의 Linux file/socket/PTY 및 controlled ownership 회귀는 remote/native 실행 증거의 대체가 아니다.
- kernel/powercut lane과 native 환경 lane은 이 작업에서 실행하지 않는다. release 판정은 필요한 환경과 전체 검증이 갖춰진 뒤 별도로 갱신한다.
- optional verifier·notmuch·reflink·비용 상한·성능 우위는 구현과 실험 증거 없이 활성 기능으로 표시하지 않는다. 현재 unsupported 정책과 후속 구현의 구분은 해당 contract/DR을 따른다.

## 검증 입력과 측정 artifact

아래 binding은 구조 검사의 입력 identity다. digest 생성 자체가 runtime PASS를 뜻하지 않는다.

verification input digest `dfdb5024570c0849ba38f02d9682390a89079e34a9c5c09a81a2693c2fc3560d` (15339 files).

당시 기록한 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 기존 artifact와의 불일치를 여기서 수리했다고 주장하지 않는다. 크기 제한은 없으며 값은 release proof가 아니다.

K63: 현재 source list는 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. 기존 digest 파일명은 최소 변경을 위해 유지하지만 내용은 `oma-production-source-digests-v1`이며 LOC/tool/report digest를 포함하지 않는다. `node scripts/loc.mjs --source-digests`로 명시적으로 갱신하고 `npm run check:inventory`는 cloc 없이 source bytes를 검증한다. `--inventory-only`는 계속 목록만 갱신한다.

현재 LOC는 `node scripts/loc.mjs --out <evidence-directory>`가 cloc 2.08로 생성·재검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`에만 있다. 생성기는 committed source digest를 먼저 검증하며 이를 재작성하지 않는다. CI는 검증한 commit 아래 report·report digest·source digest·tool version을 함께 업로드한다. committed LOC claim과 측정치의 결박은 더 이상 제공하지 않으며, source digest 결박은 유지한다. 아래 구조 입력 identity는 DR34(UX-08 CONNECT egress) 2차 맹검증 변경분(paused-socket 수명주기·Teredo 거절·rest 의미)과 BL1(bundled extension #1 pi-lsp — vendor 페이로드·verifyVendorBundle·lsp-tools 어댑터·tool-surface 플랜·workspace-guard 확장), BL2(bundled extension #2 ask_user_question — OMA 네이티브 구현: client contract/model/envelope/protocol, extension 등록, TUI presenter/component, role surface·deployment·두 host 경계 결선), BL3(bundled extension #3 pi-hashline-edit-pro — vendor 페이로드+의존 closure·commit/read seam divergence·hashline-tools 어댑터·file_edit surface·contained writer identity seam), BL4(bundled extension #4 pi-web-access — vendor 페이로드+의존 closure·OMA 정책/egress divergence·web-tools 어댑터·web_research surface·deployment-manifest 엔트리 bound 상향), BL5(bundled extension #5 pi-mcp-adapter — vendor 페이로드+42패키지 의존 closure·27파일 OMA 정책 divergence·mcp-tools 어댑터·공유 child-env 추출·`mcp` DIRECT surface), BL5 맹검증 정산(F1 SDK child-env underlay tombstone·F2 UI-session deny-by-default permit과 direct/proxy/ui-session/glimpse-ui 거절 게이트·F3 ENOENT-only 부재 판정·F4 command basename 정규화 거절·F5 dead `omaStateDir` 제거·F6 tautological assert 교체·`pi.events` runtime-register posture 기록·runtime/manifest 재생성·`mcp-bundle.test.ts` 18종), BL5 정산 후속(SDK underlay 이름의 disposition을 검증된 번들 바이트에서 파싱해 결박하는 drift oracle·win32 trailing-dot/shim fixpoint command admission), LOC 재생성 고정(cloc --ignored 판정을 report의 nonCode 블록에 접는 비코드 분류·clocCoverage 공유 계정 규칙 — vendored LICENSE/NOTICE/.map/dotfile/빈 파일/바이너리 1,620개를 명시 분류, 미계정·미인정 verdict는 여전히 실패), post-listen 'error' 전수 스캔 정산(6곳 listen 경계의 영구 'error' 리스너 + 보호된 best-effort journal, `egress-forwarder`의 `onError` 심과 oma-society `notice` 연결, `rpc.ts` FrameParser 생성자의 'data' emit 내부화, `egress-bridge` stderr.write 가드, cloc 계정의 `Object.hasOwn` own-key 조회와 `temporary editor file` verdict 인정·LOC-004 문구 동기화), post-listen 스캔 맹검증 잔여 정산(vendored pi-mcp-adapter `ui-server` host/proxy·`mcp-callback-server` listen 경계의 OMA_DIVERGENCES 영구 리스너와 runtime·manifest 재생성, broker `cleanupError` 보호된 저널, cloc `rowAt` 구조 키 배제, inference-bridge 'listening' 재등록 가드, inference-relay request/upgrade emit 경계), UX-37 운영 읽기의 진단 예산 분리(`LedgerReader.all`의 per-row 과금 제거·`pendingDeliveryRows` keyset 스트림·`pendingDeliveryCount` SQL 집계·dispatcher 카운트 바인딩·`G02-ledger-r2` 회귀 3종) 변경분의 로컬 검증을 위해 다시 결박한 것이고, 이전 runtime PASS를 새 source의 PASS로 승격하지 않는다.

## 재검증

명령은 [package.json](../../package.json), 검증 요구는 verification-spec이 소유한다.

```sh
npm run check:documents
npm run check:inventory
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs
```

바뀐 검사·owner 경로의 관련 회귀를 이어 실행한다. 환경이 필요한 suite는 허용 환경과 기존 거절을 먼저 확인한다. 새 durable 경계에는 의미 있는 negative control과 kill·retry·restart oracle를 연결하고 결과를 여기에 기록한다. 전체 suite 수를 위해 실행 금지를 우회하지 않는다.
