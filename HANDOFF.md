# OMA v2 — 상세 작업 인계

## 0. 가장 먼저 읽을 결론

이 저장소는 **구현·보강 작업 중이며 release-ready가 아니다.** 많은 실제 결함을 수정했고 회귀 시험은 통과했지만, 운영 Pi/provider 연결과 전체 규범 준수 증명이 끝나지 않았다.

- 올바른 checkout: `/home/user/Documents/GitHub/oma-v2`
- 도구 기본 cwd는 `/home/user/Documents/GitHub/oh-my-multiagent-v2`일 수 있다. 모든 명령 전에 올바른 checkout으로 이동한다.
- 누적 구현의 기준 commit: `d3a3b98c80135de2869c36c801541f75888904c6` (`add docs`).
- 사용자의 후속 요청으로 이 문서와 현재 구현·시험·증거를 함께 **로컬 checkpoint commit**으로 보존한다. 정확한 checkpoint hash는 `git log -1`과 `git log --oneline -- HANDOFF.md`로 확인한다. 자기 commit hash를 문서 안에 예측해서 넣지 않는다.
- 아래 working-tree 목록은 커밋 직전 상태를 기록한 것이다. 기존 사용자 변경과 누적 변경을 보존하는 snapshot이며 모든 줄을 이번 에이전트가 작성했다는 뜻은 아니다. 일괄 reset/checkout/clean으로 정리하지 않는다. 이 checkpoint는 release 승인이 아니며 push하지 않는다.
- 마지막 전체 실행: **178 passed / 0 failed / 0 skipped**, typecheck 통과.
- 그 이후 production 코드 변경 없이 CLI negative oracle를 수정했고, **build 및 해당 실제 unit/socket CLI 시험 1/1**을 다시 통과했다. 마지막 전체 로그는 이 마지막 시험 파일 수정 이전 기록이다.
- production LOC: cloc **2.08**, **9,774 code lines**. 시험 파일 변경과 이 인계 문서는 production LOC 증가가 아니다.
- compliance checker: **FAIL, exit 1**. 258개 labelled clause를 분류했지만 formal proof promotion은 하지 않았다. **0/258 proven은 구현이 0%라는 뜻이 아니다.**
- 정적 import closure finding 0은 semantic backdoor 부재, 실행 경로 완성, release 준수의 증명이 아니다.
- 현재 새로 확인해 두고 미수정 상태로 남긴 특정 버그 목록은 없다. 이것은 버그가 없다는 뜻이 아니라 **미검토 경로와 증거 공백이 남았다**는 뜻이다.

## 1. 사용자 의도와 작업 제약

1. 사용자는 여러 번 “끝까지 진행”을 요청했다. 중간 회귀 통과를 전체 완료처럼 말하지 말 것.
2. 최근 사용자는 Codex 잔여 한도가 약 3%라고 밝혔고 리셋권 사용은 원하지 않았다. 이 인계는 한도를 절약하면서 재개 가능하게 만드는 목적이다. 현재 잔여량 자체는 다시 확인하지 않았다.
3. 실제 provider 검증에 관해 질문했을 때 사용자는 **“남은 로컬 검증부터 계속”**을 선택했다. 실제 유료 provider 호출을 새로 시작하거나 기존 Pi 설정·확장·인증을 변경하지 않는다.
4. **Goal mode는 inactive**다. 과거 goal_id/Goal contract를 재사용하지 않는다.
5. 우선순위: 사용자 지시 → architecture → implementation spec → contracts → code. 현재 코드에 맞추어 규범을 완화하지 않는다.
6. `architecture.md` 기준 SHA-256: `177e60f7660d834873e474eec45d1f4ac17c9f02b48110ec11a5e9442edbd6d6`. 재개 시 실제 파일을 대조하고 사용자 변경이면 임의 복원하지 않는다.
7. 누락된 사용자 문서가 로컬 작업을 막는다고 주장하지 않는다. 로컬 미구현과 외부 실행 증거/SPIKE gate는 구분한다.
8. 실제 Pi consumption/provider codec/attestation 증거를 꾸며내거나 mock을 production 성공 fallback으로 사용하지 않는다.
9. host 전원 종료는 허가되지 않았다. 실제 systemd 시험은 격리 fixture 및 고유 scoped unit만 사용한다.
10. LOC는 명시적 inventory, cloc 2.08, systemd custom language filter, duplicate counting으로 센다. 필요한 기능은 10,000행을 넘어도 된다. 줄 합치기·목록 누락으로 숫자를 낮추지 않는다.
11. 기존 65%, 70%, 정적 잔여 10~20% 발언은 측정된 진척도가 아니었다. **이 비율들을 사실·일정 추정의 근거로 이어받지 않는다.** 실제 변경, 미검토 항목, 실행 근거로 보고한다.

## 2. 읽을 문서와 증거 위치

### 규범

- `architecture.md`
- `implementation-spec.md`
- `implementation/contracts.ts`
- `implementation/physical-ordering.md`
- `implementation/integration-policy.md`
- `implementation/spikes.md`
- `implementation/test-matrix.md`
- `implementation/compliance.md`
- `implementation/loc-budget.md`

### 현재 상태와 검증 산출물

- `implementation/validation.md`: 최신 metrics, 추가 경계 감사, oracle 수정의 범위
- `validation.md`: 최신 요약 + 과거 기록. 과거 수치를 최신으로 오인하지 않는다.
- `implementation/adversarial-review.md`: 규범 분류와 정적 연결 점검. 자동 생성이며 proof promotion 아님.
- `implementation/traceability.json`: labelled clause, owner/entrypoint/callPath/negativeTests와 미검증 상태
- `implementation/evidence/runtime-tests.txt`: 마지막 178-test 전체 실행
- `implementation/evidence/cli-oracle-tests.txt`: 마지막 oracle 수정 후 실제 CLI 시험 1/1
- `implementation/evidence/environment.txt`: 환경 관측
- `implementation/evidence/dependency-audit.json`: 최근 production dependency audit 결과, 실행 exit 0
- `implementation/evidence/compliance.txt`: 최신 의도적 release FAIL
- `implementation/evidence/audit-source-pins.json`: audit source pins
- `production-files.txt`, `production-loc.json`, `production-loc-hashes.json`: 명시적 production inventory/count/hash

`HANDOFF.md`는 인계 문서이지 compliance evidence의 자동 승인 문서가 아니다. 실행 로그가 말하는 범위를 이 문서의 설명보다 우선 확인한다.

## 3. 구현·수정한 주요 내용

아래는 누적 작업 요약이다. 각 항목은 전체 조항 proven 선언이 아니다.

### 3.1 Lifecycle / bootstrap / frozen authority

- resolved model/resource/spec hash를 freeze하고 현재 설정의 이름만으로 과거 권한을 재해석하지 않도록 보강했다.
- durable parent authority, ancestry, stable-name conflict 처리를 보강했다.
- frozen brief/OID로 checkout하고 bootstrap seed intent를 원자적으로 남긴다.
- incomplete seed의 입력 변경을 거절하고 완료 registry를 다시 seed하지 않는다.
- prepared batch 소유권과 GOAL 존재 전 activation 금지를 보강했다.
- ordinary create와 bootstrap의 kill boundary recovery 시험을 추가했다.
- create mail publication을 transaction 밖으로 옮기고 committed winner의 `finishCreate`/`publishCreateInitial` 경로에서만 공개하도록 수정했다.
- closed resolved spec 검증으로 malformed/extended resource/model 값에서 capability를 얻지 못하게 했다.

### 3.2 인증 / process identity / run lease

관련 파일: `src/broker.ts`, `src/leaf.ts`, `src/authority.ts`, `src/units.ts`.

- 실제 cgroup FD를 pin하고 invocation 및 cgroup dev/ino를 검증한다.
- old invocation 사망 확인 전 lease 교체/복구 진행을 제한한다.
- revocation은 socket을 닫고 in-flight capability도 무효화한다. nullable lease를 실패 fence로 사용한다.
- Linux `SO_PEERPIDFD=77`로 **원래 connector**를 pin한다. 숫자 PID fallback을 사용하지 않는다.
- `peerPidAlive`는 libc poll로 liveness를 관측한다. 상속 socket을 자식이 유지해도 원래 connector 사망을 감지한다.
- `BoundPeer`, `Broker.bindPeer`, actor/internal handler, `trustedContext`에서 bound identity를 전달하고 관측 후 liveness를 다시 확인한다.
- 닫힌 binding이 FD 재사용으로 되살아나지 않도록 했다.
- 실제 fork/inherited-socket 시험, FD 회수 반복 시험, live lease/incarnation/invocation/inode mismatch fault seam을 통과했다.
- **전체 PID-wrap, hostile process, S-01 profile 증명은 아직 아니다.**

### 3.3 입력 / frame / config / client

관련 파일: `src/frame.ts`, `src/config.ts`, `src/validate.ts`, `src/cli.ts`, `src/rpc-client.ts`.

- frame과 config에서 공유 strict JSON object parser를 사용한다.
- fatal UTF-8, decoded duplicate key, escaped duplicate key, unsafe/nonfinite number, surrogate, object root 조건을 검증한다.
- unknown field, inherited property, frame byte limit 등 trust boundary를 보강했다.
- profile lookup은 own-property/null-prototype 기반이다.
- `BrokerChannel`은 EOF/error/malformed/oversize/timeout/close에서 pending call을 정리한다.
- stream 길이/hash/timeout 실패는 preaccept로 유지한다.
- 실제 CLI body 파일의 잘못된 UTF-8을 exit 2로 거절한다.

### 3.4 Mail acceptance / immutable publication / reply

관련 파일: `src/mail.ts`, `src/git.ts`, `src/cli.ts`.

- MAIL-001 수신자 membership은 비동기 렌더링 전이 아니라 **winner가 transaction에서 claim한 acceptance 시점**에 재계산·freeze한다.
- concurrent retry loser가 winner recipient set을 덮어쓰지 않게 했다.
- typed approval mail은 closed hash-bound `approvalFor`, published candidate, broker-authored metadata를 검증한다. mail body의 주장으로 권한을 부여하지 않는다.
- `messagePlanCheck`, `operationMessage`, `messageHeaders`로 plan 종류, operation/message association, canonical path, unique recipients, bytes/hash/Message-ID를 검증한다.
- accepted original이 아닌 orphan object만으로 reply authority를 얻지 못하게 한다.
- `publishDelivery`를 ordinary/gated 경로에서 공유한다. 기존 new/cur의 corrupt bytes, symlink, dangling link도 materialized 성공으로 처리하지 않는다.
- archive는 frozen hash로 공개하고, batch prepare는 notice/original 검증을 prepared row 삽입보다 먼저 수행한다.
- new/cur가 동일 inode의 hardlink이면 rename이 no-op인 문제를 수정해 중복 new link를 제거한다.
- reserved aliases를 `<alias>@<society>.oma.invalid`로 wire encode한다.
- direct reply 기본 Reply-To는 sender, list reply는 원래 list 집합이다. Git result/context notification에도 일관되게 적용했다.
- `send --reply <eml>`은 pathname이 아니라 원문의 Message-ID를 전송한다. fresh request를 freeze할 때만 파일을 읽어 same-key replay는 원문 파일 없이 가능하다.
- From, Message-ID, In-Reply-To, References를 포함한 실제 header 값에 CR/LF guard를 적용했다. 정상 CRLF body는 허용한다.
- References cap에서 root를 잃던 문제를 수정했다. cap 3으로 연속 reply를 생성해 root + recent suffix를 확인했다. cap 1 등 다른 경계까지 새로 전부 검증했다고 확대하지 않는다.

### 3.5 Git / context / durable staging

- SHA-1/SHA-256 native object format을 지원하고 mismatch width는 stream acceptance 전에 INVALID_OID로 거절한다.
- `currentContext(): Oid | null`에서 confirmed absent와 observation failure를 구분한다.
- `canonicalHas`는 bounded `git cat-file --batch-check=%(objecttype)`을 사용한다: 10초, 64KiB. 명시적 missing만 false, 접근 실패/불명확 출력은 REF_STATE_UNKNOWN으로 pending을 보존한다.
- SHA-1/SHA-256 각각 실제 canonical repository 경로를 잠시 격리해 accepted op가 pending으로 남고 복원 후 같은 operation ID로 reconcile되는지 시험했다.
- operation-ID 기반 private exclusive staging으로 actor 간 request-key 충돌을 막는다.
- recovery bundle symlink/hardlink를 거절하고 child file/dir fsync → parent dir fsync → acceptance 순서를 보강했다.
- Git/clone/CLI에 `core.fsync=all`, `core.fsyncMethod=fsync`를 명시했다.
- context는 `GOAL.md`, `RATIONALE.md`, direct `decisions/*.md`만 허용한다. empty GOAL, 잘못된 UTF-8/control, metadata/traversal/unsupported directory를 거절한다.
- CLI context directory FD pin, lstat/O_NOFOLLOW, symlink/hardlink 거절을 보강했다.
- context staging 0644를 명시해 umask 0077에서도 canonical tree가 100644로 유지되도록 했다.
- 실제 인증 CLI 경로에서 context ref, world GOAL, exact paths/modes를 확인했다.

### 3.6 Inference / runner / native leaf

- eligible FIFO 슬롯, cancellation/timeout, actor release, Principal reserve, ancestor/society budget, atomic reservation을 보강했다.
- 대기 후 current frozen model/incarnation/capability 및 duplicate request를 다시 확인한다.
- AbortController/provider cooperation과 incarnation fencing을 추가했다.
- unknown/interrupted/post-contact 비용을 임의의 0으로 처리하지 않는다. 명시적 null transport의 no-contact cancellation만 cancelled/0으로 처리한다.
- **mock inference 시험은 실제 provider codec/과금 증거가 아니다.**
- production Pi 연동이 없는 prepared batch는 runner가 성공하는 척하지 않고 SPIKE_UNRESOLVED로 실패하며 batch를 유지한다. 실제 unit에서 no automatic restart를 확인했다.
- sdNotifyReady의 socket close/CLOEXEC/address 검증, native symbol 실제 load, SO_PEERCRED size/byte order를 보강했다.

## 4. 특히 마지막에 발견한 두 가지 검증 문제

### 4.1 Production fault hook 제거 — COMP-006

기존 `src/mail.ts`에 `MailStopPoint`, `StopSignal`, `stopAfter` parameter/field가 있었고 `src/broker.ts`에도 해당 예외 특별 처리가 있었다. IPC에서 직접 노출되지 않는다는 이유로 production closure 안의 시험용 경로를 정당화하지 않았다.

수정:

- production type/class/field/parameter/branch 제거
- `MailModule.send`의 internal `requestContext`가 이제 네 번째 인자다. 과거 `undefined` stop-point placeholder를 넣던 caller도 수정했다.
- 장애 주입은 `test/fixtures/mail-faults.ts`로 이동
- 실제 `fsyncSync` 실행 **후** 경계 및 transaction commit **후**를 fixture에서 intercept
- built-in fs binding은 `syncBuiltinESMExports()`로 갱신하고 finally에서 복구
- stage는 file fsync 경계다. 처음 directory fsync로 잘못 지정해 T18이 실패했고, 실제 `writeFsynced` 흐름을 읽어 수정한 후 통과했다.
- postaccept I/O fault가 production에서 정상적으로 pending으로 반환되면 fixture가 관측한 경계를 StopSignal로 부모 harness에 전달한다. production에 special catch를 되살리지 않는다.
- export/instance field 부재 assertion 및 기존 T18–T22 kill/recovery를 재실행했다. 그 이후 전체 178/178도 통과했다.

이 fixture는 해당 경계의 시험 도구이지 모든 syscall ordering, power loss, production-entrypoint 통합 증거가 아니다.

### 4.2 마지막 CLI negative oracle 수정

`test/cli.test.ts`의 forged From / subject CRLF 공격 frame이 `requestKey`를 사용했다. 실제 protocol field는 **`request`**이며 broker envelope는 unknown field를 거절한다. 따라서 이전 시험은 공격 parameter 검사가 아니라 앞선 envelope 검사 때문에 통과했다.

수정:

- 두 frame 모두 `request`로 수정
- 같은 경로에 `valid-mail-control` 정상 frame 추가
- 공격 frame의 INVALID_REQUEST 및 미수락 확인
- 정상 frame의 exit 0 및 실제 succeeded operation 확인
- `npm run build` 및 `node --test dist/test/cli.test.js`: **1/1 통과**
- 별도 로그: `implementation/evidence/cli-oracle-tests.txt`

**교훈:** 오류 code만 같다고 intended guard를 시험한 것은 아니다. 나머지 negative tests도 valid baseline, 단일 invalid dimension, acceptance 부재, 정상 대조군을 확인할 필요가 있다. 현재 추가로 확정해 놓은 같은 종류의 결함은 없다.

## 5. 시험 범위와 과대 주장 금지

### 실제 실행된 범위

- 실제 systemd user unit/socket/cgroup 인증 CLI 시험
- 실제 native pidfd/connector exit/inherited socket/FD cleanup 시험
- 실제 Git SHA-1/SHA-256 repository 및 repository-path fault/reconcile
- 35 primitive SIGKILL checkpoints: mail/cross-FS 9, Git submit/integrate/context 12, bootstrap 7, ordinary create 7
- filesystem/source/destination corruption, symlink/dangling/hardlink negative tests
- M-004 guard: Store.transaction callback 중 fsync/subprocess가 실행되면 crash worker가 실패하도록 했다.
- synthetic ENOSPC-before/EIO-after fsync seam에서 동일 operation/delivery identity와 retry를 확인했다.

### 아직 증명하지 못한 것

- SIGKILL은 VM power-cut이나 host power-loss가 아니다.
- synthetic ENOSPC는 실제 디스크 고갈이 아니다.
- unit/socket CLI fixture는 전체 production sandbox/Pi execution을 증명하지 않는다.
- native FD seam은 full PID-wrap/S-01 hostile corpus가 아니다.
- 35 primitive checkpoints는 전체 broker-entrypoint crash/ordering matrix가 아니다.
- static import closure는 runtime effect reachability 및 semantic backdoor 전체 부재의 증명이 아니다.
- provider mock은 실제 provider 이벤트/과금/가격 revision/취소 settlement 증명이 아니다.
- tests/LOC/DTO 추가만으로 trace status를 proven으로 올리지 않는다.

## 6. 남은 작업 — 로컬과 외부 gate 구분

### A. 현재 사용자 선택 아래 계속할 로컬/정적 작업

1. 미검토 규범을 enforcing owner까지 읽고 실제 entrypoint/call path를 대조한다.
2. 특히 시험이 의도한 guard에 도달하는지 확인한다. 잘못된 envelope, stale auth, 누락 capability, 불완전 fixture 때문에 더 앞에서 거절되어도 동일 error code가 나올 수 있다.
3. accepted → physical publication → materialized/succeeded → recovery 경계를 구분하고, failure/uncertainty가 잘못 terminal/absent/success로 바뀌는 경로를 확인한다.
4. stop/revocation, filesystem race/device, resource isolation 시험의 미검증 범위를 좁힌다. 한도/환경이 허용하는 scoped 시험만 추가한다.
5. `traceability.json`의 owner/entrypoint/callPath/negativeTests를 실제 읽은 코드와 실제 존재하는 test title에 연결한다. 빈 칸을 추정으로 채우지 않는다.
6. 검증 산출물과 source pin freshness를 맞추고 인계/commit 범위를 정리한다.

마지막 정적 탐색은 MAIL-007/008/009 부근을 읽는 중이었다. MAIL-007은 new/cur canonical path + hash + publication/fsync/T 순서, MAIL-008은 partial fanout recovery와 모델 mailbox mutation 금지, MAIL-009는 자기 delivery ACK만 다룬다. **MAIL-009의 실제 handler 본문까지 이번 마지막 탐색에서 확인하지 못했다.** `src/mail.ts`에 ack 함수가 있다고 가정하지 말고 `src/broker.ts`/store의 실제 dispatch 경로를 찾을 것.

MAIL-005와 AUTH-003의 partial trace 경로/근거를 갱신했지만 unverified 상태를 유지했다. COMP-006에도 제거한 시험 hook의 범위와 잔여 의무를 rationale로 남겼다.

### B. 로컬 미구현/운영 연결과 SPIKE gate

- production runner → lease → sandbox/Pi 실제 실행
- protected extension transport와 실제 Pi consumption 관측
- inference production wiring 및 provider codec
- Human Pi attach
- full isolation/resource supported profile

관련 OPEN gate: S-01 전체 범위, S-02, S-03, S-04. S-08/S-10 attestation/floor, S-09 evaluation, optional S-11도 임의 구현·완료 처리하지 않는다.

현재 config는 optional features (`notmuch`, `reflinkSeed`, `formalApproval`, `egress`)를 모두 false로 요구한다. 이는 gate를 닫은 구현이지 optional 기능을 구현했다는 뜻이 아니다.

모든 미구현이 외부 blocker라는 뜻은 아니다. existing contracts로 지원되는 로컬 wiring은 검토할 수 있지만, 관측되지 않은 Pi/provider protocol을 추측해서 성공 경로로 배포하지 않는다.

### C. 실행 환경 제한

기존 관측에서는 qemu/virsh 및 `/dev/kvm`이 없었다. 이 환경 관측을 영구적 불가능의 증명으로 확대하지 말되, 현재 VM power-cut 증거가 없다는 사실은 유지한다. host shutdown으로 대신하지 않는다.

실제 provider 호출은 사용자가 보류를 선택했다. 필요해지면 격리된 허용 프로파일과 비용 상한을 먼저 합의한다. 비밀키를 채팅/문서에 복사하지 않는다.

## 7. 재개 명령과 확인 순서

```bash
cd /home/user/Documents/GitHub/oma-v2
pwd
git rev-parse HEAD
git status --short
git diff --stat
sha256sum architecture.md
```

변경 전 관련 코드/규범/시험 본문을 읽고, 사용자의 작업을 보존한다. 모든 미커밋 diff가 이번 에이전트의 소유라고 가정하지 않는다.

### 타입 / build / scoped tests

```bash
npm run typecheck
npm run build
node --test dist/test/cli.test.js
node --test --test-concurrency=1 dist/test/phase3.test.js dist/test/mail-integrity.test.js dist/test/mail-reply.test.js
```

Pi-lens가 있으면 build 전에 올바른 checkout의 fresh LSP를 확인한다. LSP만으로 build를 대체하지 않는다. 마지막 oracle 수정 후 build/CLI는 통과했지만 전체 suite 재실행은 하지 않았다.

### 전체 시험 — source 변경이나 최종 checkpoint에 필요할 때

```bash
npm test > /tmp/oma-next-runtime-tests.txt 2>&1
```

`npm test`는 build 후 `node --test --test-concurrency=1 dist/test/*.test.js`를 실행한다. 성공 여부와 pass/fail/skip을 확인한 뒤 evidence로 복사한다. 실패 로그를 최신 성공 증거로 덮어쓰지 않는다.

실제 systemd 시험에는 실제 `XDG_RUNTIME_DIR`/user bus가 필요하다. 가짜 디렉터리로 bus를 대체하지 않는다. 개별 test file에 process-global fs interception이 있으므로 임의 병렬화를 추가하지 않는다.

### LOC / audit / compliance

```bash
node scripts/loc.mjs
node scripts/adversarial-report.mjs
node scripts/compliance.mjs > implementation/evidence/compliance.txt
# 현재는 exit 1이 예상됨. 실패를 성공으로 해석하거나 요구를 약화하지 말 것.
git diff --check
```

- `npm run loc` script는 없다.
- production 코드가 바뀌면 LOC/hash를 재생성한다.
- report는 classification이며 no proof promotion이다.
- compliance failure와 script 자체 crash를 구분한다. 자동화에서 무조건 `|| true`로 둘을 숨기지 않는다.
- 문서·시험·source 변경 후 affected evidence freshness를 다시 판단한다. source pin 생성만으로 과거 실행을 새 실행으로 만들지 않는다.

### dependency audit

최근 `npm audit --omit=dev --json`은 exit 0이었다. 네트워크 registry 조회 결과이지 영구 보안 보증이 아니다. provider 호출과는 별개지만 한도 절약이 필요하면 매번 반복하지 않는다.

## 8. 도구와 이전 실패에서 배운 주의점

- 파일은 `read`/anchor grep으로 읽고 fresh anchor로 편집한다. 기본 cwd 혼동이 가장 쉬운 실수다.
- 과거 `read_symbol`이 tree-sitter 초기화 오류로 실패했다. 이때 read/anchor grep으로 좁혀 읽었다.
- 과거 lens cache가 `src/git.ts`의 stale `candidateArgv` TS2552를 보고했지만 correct-checkout fresh LSP/tsc는 clean이었다. 최신 source와 실제 build를 기준으로 판단한다.
- 마지막 lens cache 조회는 해당 파일의 cached entry가 없다고 보고했다. 이것을 active scan clean으로 포장하지 않는다. 마지막 CLI 파일 fresh LSP는 clean, build는 실제 통과했다.
- MailModule.prepare는 `(auth: AuthContext)` 하나의 인자다. `(actor, incarnation)`이 아니다.
- DeliveryRow.materialized는 numeric 0/1이다.
- optional bundle은 `null` 대신 생략해야 하는 경로가 있다. 이전에 build가 이 실수를 잡았다.
- node child cleanup은 `exit`뿐 아니라 stdio `close`도 기다려야 FD 회수 시험이 안정적이었다.
- `rename(new, cur)`는 두 이름이 같은 inode를 가리키면 no-op이다. 이미 해결한 duplicate hardlink drain을 퇴행시키지 않는다.
- 원본 검증을 강화한 뒤 깨진 recovery fixture는 실제 accepted-before-materialize 흐름으로 수정했다. malformed fabricated plan/EML을 통과시키려고 production guard를 약화하지 않는다.

## 9. 현재 working tree의 주요 변경 범위

인계 작성 직전 `git status --short` 기준. 정확한 최종 목록은 git status를 다시 확인할 것.

### tracked 수정

- `implementation/contracts.ts`, `implementation/validation.md`, `validation.md`
- `scripts/loc.mjs`
- `src/authority.ts`, `src/broker.ts`, `src/cli.ts`, `src/config.ts`
- `src/entry/broker.ts`, `src/entry/host.ts`, `src/entry/runner.ts`
- `src/frame.ts`, `src/git.ts`, `src/hash.ts`, `src/inference.ts`, `src/leaf.ts`
- `src/lifecycle.ts`, `src/mail.ts`, `src/reconcile.ts`, `src/runner.ts`, `src/units.ts`, `src/validate.ts`, `src/views.ts`
- `test/audit.test.ts`, `test/audit2.test.ts`, `test/authority.test.ts`, `test/cli.test.ts`
- `test/fixtures/mail-harness.ts`, `test/fixtures/spec.ts`
- `test/phase2.test.ts` ~ `test/phase8.test.ts`

### untracked 신규 산출물/시험

- `implementation/adversarial-review.md`, `implementation/traceability.json`, `implementation/evidence/`
- `implementation/cloc-systemd.lang`, `implementation/tests/loc-fixtures/`
- `production-files.txt`, `production-loc.json`, `production-loc-hashes.json`
- `scripts/adversarial-report.mjs`, `scripts/compliance.mjs`
- `test/acceptance-auth.test.ts`, `test/compliance.test.ts`, `test/context-security.test.ts`, `test/crash-boundaries.test.ts`
- `test/git-format.test.ts`, `test/host-entry.test.ts`, `test/inference-slot.test.ts`
- `test/mail-integrity.test.ts`, `test/mail-reply.test.ts`, `test/native-leaf.test.ts`, `test/peer-pid.test.ts`
- `test/runner-channel.test.ts`, `test/runtime-contracts.test.ts`, `test/typed-mail.test.ts`
- `test/fixtures/crash-worker.ts`, `test/fixtures/git-crash.ts`, `test/fixtures/lifecycle-crash.ts`, `test/fixtures/mail-faults.ts`
- 이 `HANDOFF.md`

archive나 인계 저장 시 **untracked 파일도 포함해야 한다.** `git diff`만 저장하면 신규 시험과 증거를 잃는다. generated `dist/`는 git status에 안 보일 수 있으므로 source와 혼동하지 않는다.

## 10. 재개용 짧은 프롬프트

> `/home/user/Documents/GitHub/oma-v2/HANDOFF.md`를 읽고 올바른 checkout에서 남은 로컬 정적/규범 검증을 이어가라. Goal mode는 inactive이며 실제 provider 호출은 보류다. 사용자 Pi 설정과 기존 변경을 보존하라. 마지막 전체 178/178과 후속 CLI oracle 1/1의 실행 범위를 구분하라. 새로운 결함을 발견하면 실제 원인과 callers를 읽고 최소 수정 및 유효한 negative oracle로 확인하라. 규범을 코드에 맞추지 말고, proof가 없는 항목은 unverified로 유지하라. 근거 없는 퍼센트와 release 완료 주장을 하지 말라.

## 11. 기능별 재개 지도 — 먼저 읽을 구현과 시험

아래 표는 탐색 시작점이다. 시험 파일 이름이 해당 규범 전체의 proof라는 뜻은 아니다. 구체적인 test title과 assertion은 파일을 읽어 확인한다.

| 검토 주제 | 구현 시작점 | 관련 시험 | 아직 확대하면 안 되는 주장 |
|---|---|---|---|
| frozen/current authority | `src/authority.ts`, `src/config.ts`, `src/validate.ts` | `test/authority.test.ts`, `test/runtime-contracts.test.ts`, `test/acceptance-auth.test.ts` | 모든 관리/위임 경로가 검토됐다는 주장 |
| actor socket와 peer lifetime | `src/broker.ts`, `src/leaf.ts` | `test/peer-pid.test.ts`, `test/phase5.test.ts` | full PID-wrap/namespace 탈출 부재 |
| internal channel 분류 | `src/broker.ts`, `src/runner.ts` | `test/runner-channel.test.ts`, `test/runtime-contracts.test.ts` | SPIKE_UNRESOLVED가 실제 Pi 실행이라는 주장 |
| JSON/config trust boundary | `src/frame.ts`, `src/config.ts`, `src/validate.ts` | `test/phase2.test.ts`, `test/audit.test.ts` | 모듈 parser 통과만으로 실제 모든 socket path 검증 완료 |
| mail acceptance winner | `src/mail.ts`, `src/git.ts`, `src/authority.ts` | `test/acceptance-auth.test.ts` | helper race가 모든 broker-entrypoint race를 재현 |
| immutable mail/배달 복구 | `src/mail.ts` | `test/mail-integrity.test.ts`, `test/phase3.test.ts`, `test/crash-boundaries.test.ts` | source/destination mutation race와 power-cut 전부 검증 |
| reply/header/CLI cache | `src/mail.ts`, `src/cli.ts`, `src/request-cache.ts` | `test/mail-reply.test.ts`, `test/cli.test.ts` | host unit CLI가 실제 production sandbox/Pi 전체 경로 |
| typed approval mail | `src/validate.ts`, `src/mail.ts`, `src/git.ts` | `test/typed-mail.test.ts`, `test/cli.test.ts` | typed metadata가 S-08/S-10 attestation 구현 |
| Git object format/불명확 관측 | `src/git.ts` | `test/git-format.test.ts`, `test/phase4.test.ts` | 모든 Git subprocess 실패 분류가 확인됨 |
| context 파일/stream 경계 | `src/cli.ts`, `src/git.ts`, `src/validate.ts` | `test/context-security.test.ts`, `test/cli.test.ts` | 모든 파일시스템 race/device corpus 완료 |
| create/bootstrap/fsync 순서 | `src/lifecycle.ts`, `src/entry/host.ts`, `src/reconcile.ts` | `test/host-entry.test.ts`, `test/crash-boundaries.test.ts`, `test/phase6.test.ts` | primitive checkpoint가 전체 실제 startup crash matrix |
| unit 관측/stop/revoke | `src/units.ts`, `src/broker.ts`, `src/reconcile.ts` | `test/phase5.test.ts`, `test/phase6.test.ts`, `test/audit.test.ts` | 실제 모든 resource/isolation profile 승인 |
| inference slot/비용 | `src/inference.ts`, `src/store.ts`, `src/authority.ts` | `test/inference-slot.test.ts`, `test/phase7.test.ts` | mock transport가 실제 provider 비용 검증 |
| native readiness/FD | `src/leaf.ts`, `src/entry/broker.ts` | `test/native-leaf.test.ts`, `test/peer-pid.test.ts` | 현재 Linux 외 ABI/platform 지원 |
| evidence/LOC gate | `scripts/loc.mjs`, `scripts/compliance.mjs`, `scripts/adversarial-report.mjs` | `test/compliance.test.ts`, `implementation/tests/loc-fixtures/` | checker의 통과/실패 자체가 runtime 요구 구현 |

### 권장 첫 작업: MAIL-009 ACK 경로 완주

가장 마지막 탐색에서 중단한 좁은 항목부터 이어갈 수 있다. 다음은 **확인할 질문**이지 이미 발견한 버그 목록이 아니다.

1. `mail.ack`의 schema, mutation request key, authenticated actor가 어디서 확정되는지 읽는다.
2. 실제 dispatch branch와 store update를 따라가서 recipient 조건이 caller actor에 묶이는지 확인한다.
3. 다른 actor의 delivery, 없는 message, 같은 key replay, payload 변경, stale incarnation에서 무엇이 일어나는지 기존 시험을 찾는다.
4. ACK가 다른 상태(승인, 권한, operation 성공, prepared batch 소비 완료)를 부당하게 바꾸는지 모든 관련 reader를 확인한다.
5. 빈 시험이 있으면 정상 ACK 대조군을 먼저 확인한 뒤 한 가지 조건만 잘못된 negative case를 추가한다.
6. 해당 경로를 읽고 시험한 범위만 trace에 남긴다. 실제 sandbox/Pi 증거가 없으면 전체 clause proven으로 올리지 않는다.

## 12. Negative oracle 감사 절차

최근 잘못된 `requestKey` 시험처럼 검증이 겉으로만 통과하는 상황을 줄이기 위한 체크리스트다.

- **정상 기준 요청:** 동일한 actor/channel/profile/envelope로 정상 요청이 수락되어야 한다.
- **한 가지 차이:** 공격 사례에는 목적한 invalid dimension만 넣는다. envelope와 payload를 동시에 망가뜨리지 않는다.
- **정확한 경계:** INVALID_REQUEST/AUTH_FAILED처럼 여러 guard가 공유하는 code만 보지 않는다. 입력 구성, 정상 대조군, 가능한 경우 상세 결과로 intended path를 좁힌다.
- **durable 부재:** 거절 시 해당 operation, child, delivery, ref 변경이 없는지 확인한다. CLI exit code 하나로 끝내지 않는다.
- **winner identity:** 재시도 시험은 count뿐 아니라 operation ID, Message-ID, byte hash, OID가 같은지 확인한다.
- **independent decoding:** MIME round-trip은 production parser 하나의 자기 일관성만 보지 않고 Python email parser 등 독립 reader와 비교한다.
- **timeout/EOF:** timeout이 났다는 이유로 미수락이라고 단정하지 않는다. acceptance 전인지 후인지 durable 상태로 판단한다.
- **fault 도달 확인:** child가 boundary를 보고하기 전에 죽었다면 올바른 crash 시험이 아니다. parent는 exit/close/timeout을 함께 관측한다.
- **fixture 계약:** closed resolved spec/current incarnation/capability를 갖춘 정상 fixture인지 확인한다. fixture가 잘못됐다고 production 검증을 느슨하게 하지 않는다.
- **catch 오해 금지:** postaccept publication fault가 pending으로 반환되는 것은 의도된 동작일 수 있다. 무조건 throw를 기대하지 않는다.
- **회복 후 확인:** pending만 확인하지 말고 원인을 제거한 뒤 reconcile 및 같은-key retry가 같은 winner를 완성하는지 확인한다.
- **범위 표기:** direct method 호출, native syscall seam, real socket, real unit, real sandbox, real Pi/provider를 각각 구분해 기록한다.

## 13. Evidence freshness와 기록 방법

### 현재 실행 시점의 구분

| 기록 | 실제로 말할 수 있는 것 | 말할 수 없는 것 |
|---|---|---|
| `runtime-tests.txt` | 마지막 전체 178/178 실행 | 이후 수정된 CLI oracle도 이 실행에 포함됐다는 주장 |
| `cli-oracle-tests.txt` | 수정된 공격 frame + 정상 대조군을 포함한 실제 CLI 시험 1/1 | 나머지 전체 suite를 그 시점에 재실행했다는 주장 |
| `production-loc-hashes.json` | 명시 inventory의 production source 내용 pin | test/문서/외부 SDK 전체 revision 증명 |
| `audit-source-pins.json` | report가 기록한 source/environment/log pin | 모든 규범 evidence freshness 승인 |
| `dependency-audit.json` | 해당 시점 registry audit 결과 | 모든 runtime dependency가 항상 안전함 |
| `environment.txt` | 당시 관측된 환경 | 다음 세션도 같은 kernel/bus/tool 상태임 |

기존 환경 관측: Node v26.7.0, Git 2.55.0, systemd 261.2-1-arch, cloc 2.08, Linux 7.2.0-1-cachyos-bore x86_64. 파일에 기록된 관측 시각은 2026-09-10 UTC이며 다음 실행 시각으로 바꿔 쓰지 않는다.

### 새 검증 기록에 남길 항목

1. 정확한 checkout 및 기준 commit, 실행 시 dirty source 여부
2. 실행 명령과 exit code
3. pass/fail/skip/cancel 수와 실패가 있다면 원인
4. 실제 entrypoint와 test fixture의 차이
5. failure injection 위치 및 실제 도달 확인
6. 실패 전/후 durable state, 재시도 후 winner identity
7. 원본 로그 경로와 관련 source pin
8. 해당 증거가 덮지 못하는 범위
9. source 변경 후 어떤 증거를 다시 실행했는지, 하지 않았는지

commit 생성은 source를 보존하는 작업이지 시험 재실행이 아니다. commit hash가 생겼다고 오래된 로그의 실행 시점이나 proof status를 바꾸지 않는다. 새 commit에 대해 checker가 stale을 보고하면 그대로 기록하고 필요한 실행을 별도로 수행한다.

## 14. Checkpoint commit의 의도와 재개 시 보호사항

이 checkpoint는 다음을 한 묶음으로 보존한다.

- 기준 docs commit 위의 누적 runtime 구현·보강
- 해당 구현을 검사하는 신규/수정 회귀 시험과 test-only fault fixture
- 명시적 LOC inventory/hash 및 검사 script
- 전체 실행과 후속 scoped 실행을 구분한 evidence
- 아직 FAIL/unverified인 compliance 상태
- 이 상세 인계 기록

완료 표시하지 않는 범위: production Pi/provider 연동, 전체 S-01/S-02/S-03/S-04, gated optional 기능, 모든 labelled clause의 proven 판정, VM power-cut/전체 hostile corpus.

로컬 commit만 요청받았으며 remote push는 하지 않는다. 사용자 Git identity를 임의 설정하거나 실패한 commit hook을 우회하지 않는다. commit 후 `git status --short`와 `git log -1 --stat`로 실제 보존 범위를 확인한다.

재개 시에는 먼저 새 변경이 생겼는지 확인한다. 이 문서에 적힌 baseline과 현재 HEAD가 다르다고 자동으로 이전 상태로 돌아가지 않는다. 다른 작업자의 변경일 수 있다.

### 다른 환경으로 인계할 때

- clone만 할 경우 로컬 checkpoint가 remote에 없으면 전달되지 않는다. 사용자가 원하는 방식으로 commit을 별도 전달하거나 push 승인을 받아야 한다.
- 코드만 복사하고 `test/fixtures/`, evidence, production inventory를 빼면 재현성이 깨진다.
- ignored dependency/build output은 이 checkpoint의 구성요소가 아니다. 기존 lockfile과 프로젝트 설치 정책을 따르고 `npm run build`로 dist를 재생성한다.
- systemd user bus, native FFI, Linux kernel 지원이 없는 환경에서는 관련 시험의 미실행/실패를 숨기지 않는다.
- private runtime SQLite, 사용자 세션, API key, Pi auth/config를 재현 자료로 임의 포함하지 않는다.

## 15. 재개 후 종료 기준

정적 감사의 한 회차가 끝났다고 말하려면 최소한 읽은 조항, 실제 owner/callers, 확인한 negative oracle, 수정 유무와 검사 결과, 남은 공백을 남긴다. 이것은 전체 프로젝트 종료 기준과 다르다.

전체 준수/운영 완료를 말하려면 OPEN gate와 운영 연결, 적용 조항의 enforcing path, required negative tests, 현재 revision의 증거, 실제 지원 환경의 실행이 함께 충족되어야 한다. 지금 이 조건은 충족되지 않았다.

사용자가 한도 절약을 우선하면 한 항목을 좁게 끝내고 문서에 exact frontier를 남긴다. 완료율을 추측하거나 검증되지 않은 영역을 완료로 넘겨서 대화를 끝내지 않는다.
