# 구현 계약 산출물 및 runtime 검증 기록

최신 작업 검증: 2026-09-10 UTC, `d3a3b98` 위 working-tree 변경. 아래 최신 절이 과거 audit의 '현재' 수치와 상태 설명을 대체한다.

이 문서는 설계 문서의 구현 상태를 기록한다. `architecture.md`와 `implementation-spec.md`는 normative baseline이며, 이 파일의 PASS는 해당 요구 전체가 production release 조건을 충족했다는 뜻이 아니다. OPEN SPIKE와 미실행 test는 PASS로 승격하지 않는다.

## 최신 구현 검증 — 2026-09-10 UTC

- 기준 architecture SHA-256: `177e60f7660d834873e474eec45d1f4ac17c9f02b48110ec11a5e9442edbd6d6`.
- `npm run typecheck`: exit 0. `npm test`: **178 passed, 0 failed, 0 skipped**. [실행 로그](evidence/runtime-tests.txt). [환경 원본](evidence/environment.txt): Node v26.7.0 / systemd 261.2-1-arch / Git 2.55.0 / cloc 2.08.
- `node scripts/loc.mjs`: **9,774 code lines**, cloc **2.08**. [명시적 원본 목록](../production-files.txt), [파일별 집계](../production-loc.json), [원본 hash](../production-loc-hashes.json).
- LOC 목표 초과 사유: 기존 recovery/IPC/Git 경계에 더해 typed Principal mail, frozen runtime resources/model, bootstrap intent/recovery, 실제 unit 관측이 필요하다. 줄 합치기나 파일 누락으로 예산을 회피하지 않는다. 사용자 지시에 따라 이번 기능 작업은 10,000 초과 여부로 중단하지 않는다.

### 구현·회귀 검증한 경로

| 경로 | 수행 시험과 한계 |
|---|---|
| prepared-only wake | phase4 T-create-ready: 실제 systemd에서 new=0/pending=0/prepared=1 → reconcile → 새 invocation, 같은 batch ID/message IDs |
| BATCH-001 handoff | MailModule.prepare가 linkage commit → 실제 rename/양쪽 fsync → atomic manifest/inbox publication을 소유. post-commit view 실패 복구 및 snapshot/cur 이동 직후 실제 SIGKILL·같은 batch 회수 시험 통과. helper 경계 시험이며 실제 Pi/전원장애 전체 증명은 아님 |
| LIFE-007 경쟁 | concurrent same-name/spec create는 staging까지만 선행하고 physical winner만 immutable object 게시. object 하나와 delivery 하나 확인 |
| PR-002 integrity | 공용 moveToCur가 delivery·canonical object·mailbox byte digest/regular file 검증. rogue/corrupt 항목은 실패, relay는 실제 moved 개수 반환 |
| MAIL-011/PR-005 | 실제 systemd cgroup 안 CLI→actor socket→broker→EML 경로에서 exact identity/Unicode·공백 policy 보존과 동일 key 재시도를 확인. identity 변경, 미게시 candidate, Principal 누락, 짧은 OID를 거절. raw socket의 추가 identity field·잘못된 kind·header newline도 INVALID_REQUEST이며 operation 없음. 이는 승인 attestation이 아님 |
| LIFE-008 | modelProfile/resources를 resolved spec과 canonical hash에 고정하고 unit renderer로 전달. startup에서 stale stored format/missing profile을 차단. 실제 migration 및 S-03 이후 Pi 실행 증명은 미완료 |
| LIFE-009 | seed 전체 intent를 원자적으로 고정, 변경된 pending seed 거절, ready registry 재seed 금지. bootstrap 및 일반 create 각각 staging/intent/object/workspace/unit/ready/mail 7개 helper 경계에서 실제 SIGKILL 후 복구. systemd는 실제 사용하되 전체 broker crash matrix와는 구분 |
| UNIT-002/007 | 실제 loaded fragment/drop-in/resource property, path activation state 확인. 실제 systemd에서 공백/%/$/따옴표 경로 실행. failed/partial observation은 성공으로 해석하지 않음 |
| BATCH-006 | 올바른 batch라도 S-03 미확정이면 SPIKE_UNRESOLVED, presented=0. caller receipt/boolean으로 우회하지 않음 |

### 적대적 검토에서 추가 수정한 사항

- 실패한 inbox atomic rename 뒤 남은 0444 임시파일이 다음 재시도를 EACCES로 막던 문제를 재현·수정했다.
- canonical/mailbox 검증은 UTF-8 재인코딩이 아닌 원본 bytes를 hash하며 dangling symlink도 거절한다.
- stored create spec과 plan의 canonical digest를 재검증한다.
- stop의 path 실패가 service stop 시도를 건너뛰지 않게 했고 explicit effect 실패는 operation을 unknown으로 남긴다.
- 관측이 없는데 execMainStatus=0 또는 cgroup death=true가 되던 fallback을 제거했다.
- phase4 cleanup의 광범위한 `oma-*` 지정을 해당 테스트 society로 제한했다.
- 기존 연결에 캐시된 capability만으로 durable effect를 허용하지 않고 현재 stored authority도 재검증한다. production create resolver는 intent마다 host config를 다시 읽는다.
- RUN-001에서 이전 cgroup directory FD를 lease에 보존한다. 새 invocation은 그 고정 객체의 populated=0 또는 커널 제거(ENOENT)를 확인하기 전 incarnation을 올리지 않는다. 실제 systemd 재시작은 통과했고, populated kernel cgroup을 이전 lease로 주입한 fault-seam은 handoff를 거절했다. 이것만으로 전체 T12/S-01을 PASS 처리하지 않는다.
- compliance structural checker는 duplicate/stale/extra trace, 잘못된 분류·빈 callPath, owner/test locator 누락, production/dependency/spec/package/test digest 누락·변경을 거절한다. `--inventory`는 같은 fingerprint의 검토 기록을 보존한다. 합성 양성 대조군과 실패 변형을 모두 실행했으며, 이는 real-boundary 증명을 대신하지 않는다.
- 로그가 `.gitignore`의 `*.log` 규칙으로 누락되는 문제를 피하도록 versionable `evidence/runtime-tests.txt`에 실행 결과를 보존했다.

### 아직 완료/출시로 간주하지 않는 범위

- RUN-001 이전 invocation 전체 cgroup 사망 증명, T12 old connection 전체 oracle 및 S-01 raw pin은 미완료다.
- S-01–S-06/S-09 및 tiered S-08/S-10, optional S-11의 기존 OPEN 상태를 유지한다. 새 승인/challenge/floor schema·command는 임의 추가하지 않았다.
- nonempty candidate checks production profile은 S-01-CANDIDATE 때문에 startup에서 SPIKE_UNRESOLVED다.
- 후속 IPC 검증: escaped duplicate JSON keys, 비유한/unsafe 숫자, malformed UTF-8, unknown fields, UTF-8 byte 한도를 거절한다. runner/host channel은 EOF·오류·timeout·close에서 pending 호출을 정리한다.
- 실제 systemd Resident에서 endpoint revoke 후 기존 연결 종료·동일 invocation 재open 및 batch.prepare 거절·populated cgroup FD 유지를 확인했다. endpoint 디렉터리의 실제 파일 충돌 실패 뒤에도 같은 invocation은 재발급되지 않으며, 종료 후 incarnation 6까지 같은 prepared batch로 복구했다.
- startup은 old-run death 및 canonical fsck를 recovery 전에 확인하고 READY 이전 activation을 보류한다. D1/D2는 실제 user bus와 유효한 identity fixture를 사용하며 D2는 정확히 missing-object 실패를 확인한다.
- 파생 world view 실패가 이미 durable한 성공/재시도 receipt를 덮어쓰지 않음을 fault seam으로 확인했다. socket 길이 한도와 inherited profile-name 우회도 검사한다.
- [전체 범위 점검표](adversarial-review.md)는 **258개 labelled 규범 절과 T01–T77 전 행**을 포함한다. 이전 221개 목록에서 빠진 test-matrix/spikes/validation와 SHOULD/OPTIONAL을 추가했다. scope는 분류했지만 full-clause owner/실행 증거는 완료하지 않았으며 [compliance 결과](evidence/compliance.txt)는 **0/258, exit 1**이다.
- `test/crash-boundaries.test.ts`는 mail/cross-FS 9개, Git submit/integrate/context 12개, bootstrap/create 14개 시점에서 실제 SIGKILL했다. 합계 35개 kill point는 test worker의 filesystem/transaction/subprocess 경계이며 CLI/broker 전체 crash matrix나 전원단절 증거가 아니다.
- staging 및 archive fsync 전 ENOSPC/후 EIO를 주입하고 recovery 재실패 후 동일 operation으로 수렴함을 확인했다. 실제 디스크 고갈 시험과 구분한다.
- create/bootstrap의 transaction 내부 object fsync를 제거했다. durable winner의 recovery 경로가 frozen staging/object를 게시한다. stored spec의 model/resources가 불완전하면 capability도 거절한다.
- SHA-256 bootstrap/quarantine/context/CAS를 실제 Git으로 검증했다. SHA-1 고정 zero OID를 제거하고 repository와 다른 길이의 OID는 stream 소비·acceptance 전에 거절한다. context의 absent ref와 관측 실패를 구분하여 최초 publication 복구도 검증했다.
- Git/context staging을 request key가 아닌 operation ID로 격리했다. 다른 actor의 같은 key 제출·malformed bundle이 accepted upload를 덮어쓰지 않는다. 동일 bytes의 symlink/hardlink staging도 복구에서 거절한다.
- CTX-001/002: `.git/config` 등 비허용 경로, 중복/역순 manifest, 잘못된 UTF-8·binary·빈 GOAL을 acceptance 전에 거절한다. CLI는 고정 directory FD와 nofollow file open으로 symlink/hardlink를 거절한다. 정상 CLI → 실제 unit/인증 socket → broker/Git publication·동일 key 재시도 및 raw invalid context frame을 검증했고 Git tree의 regular 100644 mode도 확인했다.
- context staging은 파일/하위 디렉터리→상위 디렉터리 fsync 후 접수하며 umask 0077에서도 0644다. host Git/clone/CLI Git에 core.fsync=all, core.fsyncMethod=fsync를 명시했다. SIGKILL은 VM power-loss 증명을 대체하지 않는다.
- AUTH-003: mail.send/continue, git.submit/integrate, context.publish, agent.create의 acceptance transaction에서 현재 role/incarnation/desired/capability를 재검사한다. async render/upload/serialization 대기 중 변경 시험 5개가 통과했다. 이 시험은 domain 경계이며 실제 socket stop race 전체를 대신하지 않는다.
- actor 연결 인증도 live RunLease, 실제 관측 invocation, pinned cgroup FD의 dev/inode를 대조한다. lease revoke는 이미 render/upload 대기 중인 AuthContext의 권한도 무효화한다. real CLI 회귀와 native cgroup FD를 쓰는 fault-seam 시험을 통과했지만 PID 재사용 stress·전체 S-01 증명은 별개다.
- INF-002/003: 대기 취소·개별 timeout이 실제로 완료되며 eligible FIFO와 Principal reserved slot/budget을 보존한다. 전체 society 및 ancestor 비용을 예약과 같은 transaction에서 확인하고, 확정 비용/unknown reservation을 구분한다.
- INF-004/005/006: 미확인 provider 비용은 0이 아닌 unknown, 명시적 null transport만 cancelled/0으로 기록한다. 중도 종료·취소 비용을 보존하고, slot 대기 중 나타난 기존 request winner를 재전송·재정산하지 않는다. 현재 incarnation/frozen model도 접수 직전에 검사한다. fence는 해당 incarnation의 waiter와 협조적 transport signal을 취소한다. 이들 검증은 mock/domain 범위이며 S-04나 production 연결 완료를 뜻하지 않는다.
- UNIT-004 native leaf: sd_notify socket을 성공/실패 모두 닫고 CLOEXEC 및 주소 길이/NUL 검증을 추가했다. 실제 Unix datagram READY 수신과 반복 실패 전후 FD 개수 불변을 검증했다. native availability도 실제 FFI symbol loading을 수행하며 잘못된 fd의 즉시 반환을 검증으로 오인하지 않는다.
- 기존 phase3–8 fixture의 빈 spec/불일치 incarnation/누락 mail capability를 실제 계약에 맞췄다. mail kill harness의 이미 발생한 exit 재대기와 무효 timeout도 고쳐 경계 도달 및 실제 SIGKILL을 모두 확인한다.
- cross-FS에서 canonical 목적지에 직접 copy하던 결함을 수정했다. destination-side exclusive 임시 copy→fsync/hash→atomic link이며 기존 파일·symlink·손상은 검증한다. `/dev/shm`과 다른 실제 filesystem 간 복사와 partial copy SIGKILL 후 미공개/재시도를 확인했다.
- internal method/channel key 집합을 계약과 타입 검사로 연결했다. runner.pending은 현재 lease를 검증하며 observe는 S-03 gate로 거절한다. 실제 runner socket의 unknown/추가 field/extension-channel 우회도 거절했다. protected extension channel과 inference production 연결은 여전히 미완료다.
- source import closure에서 literal 상대 import의 test/manifest 탈출은 0건이다. 이것은 inline fault seam·reflection·SDK wiring의 무결성 증명이 아니다. `npm audit --omit=dev`는 [보고된 취약점 0건](evidence/dependency-audit.json)이며 전역 Pi 배포 검증을 대신하지 않는다.
- 전체 bootstrap/Git/context/CAS kill matrix, VM power-cut, 실제 Pi/Principal/provider 및 benchmark oracle, 개별 규범의 증거 확정은 미완료다. qemu/virsh 및 /dev/kvm 부재는 [환경 기록](evidence/environment.txt)에 남겼으며 사용자 host의 강제 종료로 대신하지 않았다.
- 따라서 **178/178은 suite 결과일 뿐이며 전체 적대적 검증 완료 또는 release 통과가 아니다**.

### 추가 경계 감사 — 178-test checkpoint

- Actor/internal socket은 SO_PEERPIDFD로 원래 연결자를 pin한다. 자식이 상속 socket을 유지한 채 원래 연결자가 종료되는 실제 프로세스 시험과 반복 연결의 FD 회수 시험을 통과했다. 전체 PID-wrap/S-01 스트레스 증명은 아니다.
- config와 wire frame은 같은 strict JSON decoder를 사용하며 잘못된 UTF-8, 중복 key, 비정상 수치, unpaired surrogate를 거절한다.
- mail/submit의 수신자는 acceptance transaction 안에서 확정된다. 동시 same-key loser는 winner의 snapshot을 유지한다.
- frozen MessagePlan subtree를 검사하고 object·기존 new/cur의 hash/type을 검증한 뒤 materialized를 기록한다. 손상 원문은 reply와 batch prepare를 막으며 동일 inode의 new/cur 중복은 new를 제거한다. 기존 축약 recovery fixture는 실제 accepted mail로 교체했다.
- direct Reply-To는 sender, list Reply-To는 list 집합으로 생성한다. reserved alias를 wire 주소로 인코딩하고 Git/context 알림에도 적용했다. actual From/Message-ID/ancestry header injection은 거절하되 정상 CRLF 본문은 허용한다.
- 실제 systemd invocation → CLI → authenticated actor socket으로 `send --reply <eml>`을 실행했다. CLI가 path 대신 원문의 message ID를 전송하고, 같은 key 재시도는 원문 파일 없이 frozen request를 재사용한다. Python email parser로 Reply-To/In-Reply-To를 독립 확인했다. 잘못된 UTF-8 파일, forged From, subject CRLF는 미수락이다.
- canonical commit 조회는 bounded `git cat-file --batch-check`의 명시적 missing만 부재로 취급한다. 저장소 접근 실패/불명확 출력은 REF_STATE_UNKNOWN으로 pending을 보존한다. SHA-1/SHA-256 각각 실제 저장소 경로를 일시 격리한 fault seam에서 같은 operation ID로 복구됨을 검증했다.
- COMP-006 재검토로 production의 MailStopPoint/StopSignal/stopAfter와 broker 예외 분기를 제거했다. 장애 주입은 test/fixtures/mail-faults.ts의 실제 fsync 이후/transaction 이후 interception으로 옮겼으며 기존 T18–T22 kill/recovery 시험과 전체 suite를 재실행했다. 이는 모든 semantic backdoor 부재의 증명으로 확대하지 않는다.
- 후속 oracle 감사: CLI forged From/header injection 시험의 잘못된 `requestKey` envelope를 `request`로 수정하고 정상 frame 대조군의 실제 수락도 확인했다. 이전 시험은 envelope 거절까지만 입증했으므로 해당 입력 검사 증거로 충분하지 않았다. 수정 후 build와 실제 unit/socket CLI 시험 1/1을 재실행했다([별도 로그](evidence/cli-oracle-tests.txt)). production 코드는 바뀌지 않았으며 178/178 로그는 이전 전체 실행 기록이다.
- MAIL-005 References cap은 최초 root와 최신 suffix를 보존하도록 수정했다. 제한 3으로 연속 reply를 생성하여 root 유지와 최신 ancestry를 확인했다.
- 위 회귀 결과는 관련 실행 경계에 한정한다. S-02/S-03/S-04와 production runner/extension/inference 연결, 전체 clause 증거 확정은 여전히 미완료다.

### Production 연결 재검토 — 미구현과 gate 구분

- `src/entry/runner.ts` → `RunnerModule.run/open/prepareBatch`: 실제 경로는 runner.open과 batch.prepare까지만 실행한다. batch가 있으면 `SPIKE_UNRESOLVED`로 실패하며 prepared 상태를 유지한다(조용한 exit 0 제거). RunLease를 sandbox/Pi 실행에 연결하지 않는다. 실제 unit의 실패 상태와 명시적 idle-unit fixture 이후 같은 batch 재시도를 확인했지만, 이는 Pi consumption 증명이 아니다.
- `src/broker.ts#INTERNAL_CHANNEL`은 extension용 batch.read/principal.attach/detach를 분류하지만 이 분류 자체가 보호된 extension transport의 구현은 아니다. 현재 runner/host 채널의 거절 시험은 음성 경계 증거에 한정된다.
- `src/inference.ts#InferenceModule`은 broker entry의 호출 경로에 연결되지 않았다. provider/취소/계량 helper의 회귀 성공을 실제 broker inference 동작으로 간주하지 않는다. 연결 구현과 S-04 codec 증거가 모두 남아 있다.
- S-03의 미검증 상태를 해제하거나 guest가 제공한 완료 flag로 대체하지 않았다. 이 목록은 실질적인 연결 누락의 확인이며 전체 규범 owner/evidence 검토 완료가 아니다.

## 과거 검증 기록 — 아래 수치는 해당 checkpoint에 한정


**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

| 검사 | 실제 수행 결과 | 한계 |
|---|---|---|
| architecture hash | `2a2e74c1e6b4986145a7ac54b37a9f50c297363a9c134a360f75bbba3db4a404` 유지 | 현재 runtime은 이 baseline을 구현하며, 후속 설계 확장은 별도 문서에서 승인 전까지 활성화하지 않음 |
| TypeScript declarations | TypeScript 5.9.3, ES2022, nodenext, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes, noEmit 통과 | 구현 및 runtime schema validator 아님; 배포 Pi/Node version 선택 아님 |
| 두 정합성 수정의 타입 회귀 검사 | [contracts.type-test.ts](tests/contracts.type-test.ts)를 같은 strict 옵션으로 검사 통과; mutation key 필수·read/wait key 금지·create authority 입력 금지·resolved spec 변수의 wire 전달 거절 확인 | compile-only 검사; runtime validator 구현을 뜻하지 않음 |
| mutation 집합 대조 | SQL operations.kind 11개와 TypeScript MutationMethod 집합 일치; public method 분류 누락/중복 없음 | 새 method 추가 때 재검사 필요 |
| 초기 SQL | 임시 SQLite 3.53.4 DB에서 적용, 정확히 여섯 table, user_version=1, FK/integrity 통과 | production binding·WAL power loss 검증 아님 |
| SQL negative check | materialized/batch 없이 presented 설정 시 제약 거절 | 전체 acceptance test 구현·통과를 뜻하지 않음 |
| systemd templates | 임시 renderer 결과 7개를 systemd-analyze verify로 문법/의존성 검사 통과 | ExecStart 실행 파일은 검사본에서 true로 대체; 설치·시작하지 않음 |
| 문서 구조 | local links, code fences, 본문 requirement ID 중복 검사 통과 | 설계의 runtime correctness 증명 아님 |
| bwrap CLI | 로컬 --help에서 argv primitive 및 --size 지원 확인 | 실제 namespace isolation/Principal tools 검증 아님 |

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.

## Phase 0-9 구현 중 실행된 검증 기록 (2026-09-07)

| 검사 | 실제 수행 결과 |
|---|---|
| 기준 hash | `2a2e74c1e6b4986145a7ac54b37a9f50c297363a9c134a360f75bbba3db4a404` 유지 (N-001) |
| 타입 검사 | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noEmit 통과; `tsc -p tsconfig.build.json` 전체 83개 테스트 빌드 통과 |
| 전체 테스트 | `npm test` → **83/83 pass, 0 fail, 0 skipped** (실 systemd 검사는 user-manager 경합 방지를 위해 file concurrency 1) |
| DDL | 정확히 6개 테이블; user_version=1; FK/integrity ok; negative CHECK (presented w/o materialized+batch) 거절 |
| process-kill | T18-T22 mail 경계를 외부 kill harness(SIGKILL)로 실제 실행 후 외부 가시 상태(파일 hash/DB rows) 대조 |
| systemd 실서비스 | T36 start-limit(자동 reset 없음), T37 stop 중 mail 도착(cgroup 후손 0), T38 cgroup 미확인 시 RUN_TERMINATION_UNKNOWN, REC-007 broker lock |
| sandbox E2E | bwrap(SB-001 rootfs + 시스템 오버레이) → sandboxed Pi 0.85.1 → 신뢰 확장 로드 → custom message role='custom' 전달; provider 없음 → stopReason=error → batch 미완료(위조 증거 없음) |
| git 실저장소 | bundle quarantine(RO alternate)+수입+published ref+peer exact fetch, CAS 경쟁/보호 경로/재개, context commit+CAS+스냅샷 (git 2.55.0) |
| NEG 스캔 | Board/Artifact/Focus/Change/Review 엔티티, task queue/outbox/event bus/workflow, 자동 복구/요약 에이전트 → src/ 전역 검색 0건 |
| LOC | 9,900 (non-empty physical lines from `node scripts/loc.mjs`; A-008 target is 8,000). The documented A-009 allowance applies; 10,000-line review gate is not crossed. |
| release gate | **미달** — S-01–S-06 및 S-09는 raw spike evidence 전까지 OPEN; S-03-dependent Pi completion은 fail-closed이며 미실행 항목은 PASS로 계산하지 않음 |

## Normative test coverage map (T01–T77) — runtime audit 2026-09-08

결과 구분: ✅ 실행(해당 executable test가 suite에서 통과) / ◐ 부분(핵심 일부만, 나머지 미실행) / ❌ 미실행(unresolved/blocker). suite 명령: `npm test` (`83/83`).

| T# | 상태 | 증명 executable test | 비고 |
|---|---|---|---|
| T01 | ✅ | phase-0 기재(hash/import/schema inventory) + production-manifest/loc.mjs | NEG 스캔은 T74 |
| T02 | ✅ | phase2 "T02: fresh DDL…" | |
| T03 | ✅ | phase2 "T03: invalid enum…" | |
| T04 | ✅ | phase2 "T04: frame reconstruction…" + audit A1/A3 | |
| T05 | ✅ | phase2 "T05: malicious frames…" + audit B1(UNKNOWN_METHOD framed) | |
| T06 | ✅ | audit A4(decoder) + audit2 실 socket exact/short/EOF/N+1/N+2/N+3/excess-garbage/hash-mismatch/timeout/coalesced/split | 모든 stream failure는 STREAM_INVALID preaccept; mutation 미성공 |
| T05 | ✅ | phase2 + audit B1 + audit2 neg-* (unknown field/OID/version/read-request) | |
| T73 | ✅ | cli.test (실 systemd 유닛 + 실 socket) | + P1-4/5/6: submit/context frozen-first, agent create --from HEAD, submit --to 다중/기본 |
| T07 | ✅ | phase2 + audit2 real actor-socket git/mail same-key same-payload (serial + concurrent) | same operation/receipt, delivery 1 |
| T08 | ✅ | phase2 + audit2 real actor-socket mail/git same-key different body/recipient/candidate (serial + concurrent mail race) | REQUEST_KEY_REUSED; winner delivery 1 |
| T09 | ◐ | cli 시나리오 6+7(dead socket → operation.get miss → replay) | "accepted 뒤 response kill" 정확 재현 아님 |
| T10 | ✅ | phase2 "T10: different keys…" | |
| T11 | ✅ | phase5 "T11-neg…" | |
| T12 | ❌ | — | old-incarnation socket 재연결 거절 테스트 없음 |
| T13 | ✅ | phase4 "T13: capability escape…" | |
| T14–T22 | ✅ | phase3 (T18–T22 외부 kill harness) | TEST-004 kill 지점 실행됨 |
| T23 | ❌ | — | cross-FS/hardlink fixture 미실행 |
| T24 | ❌ | — | forged approval/ack 테스트 없음 |
| T25 | ◐ | phase5 "T25 deterministic core…" + manifest compatibility | 40개 두 class의 cap/fairness/notice와 frozen manifest는 실행; full-index/original-byte oracle은 미실행 |
| T26 | ✅ | phase5 T25 test의 prepare 뒤 late-mail 재prepare | 기존 prepared IDs 불변 |
| T27 | ❌ | — | batch prepare/cur kill 지점 미실행 |
| T28 | ❌ | — | Pi steer 귀속은 S-03 gate |
| T29–T30 | ◐ | phase5 "deliver smoke" (provider error → complete 미발생, presented 0) | T30 kill 지점 미실행 |
| T31 | ✅ | phase5 "T31-neg…" | |
| T32 | ✅ | phase3 "T32: path-based views…" | |
| T33–T35 | ❌ | — | path enable/timer 재발견/slot 대기 미실행 |
| T36–T38 | ✅ | phase4 (실 systemd user) | |
| T39 | ◐ | phase4 "T39/LIFE-007…" | same-spec 수렴은 실행; 각 durable 경계 process-kill 미실행 |
| T40 | ✅ | phase4 "T40/LIFE-001…" + CREATE-003 policy recheck | changed resolved spec은 AGENT_CONFLICT, 기존 workspace 보존 |
| T41 | ◐ | phase4 "T41/CTX-006…" + dynamic Resident fenced runner | pre-GOAL 무활성/GOAL 후 runner.open은 실행; reboot/provider-call oracle 일부 미실행 |
| T42 | ✅ | phase5 "T42…" | |
| T43–T44 | ❌ | — | S-02 gate (격리 Human session 없음) |
| T45–T47 | ◐ | phase5 "deliver smoke" (sandboxed Pi 로드, host home 미노출 일부) | sandbox escape 항목 다수 미실행 |
| T48–T51 | ✅ | phase6 (mock provider; T50/T51 settle/unknown) | 실제 provider codec은 S-04 gate |
| T52 | ❌ | — | sentinel secret 로그 누출 검사 없음 |
| T53–T55 | ✅ | phase7 | |
| T56 | ◐ | S-05 namespace run + phase7 GIT-006 extra-ref rejection and T55/T59 ref conflict | malformed/pack-corrupt bundle and full hostile prerequisite corpus remain unexecuted |
| T57–T58 | ❌ | — | TEST-004 git kill 지점 미실행 |
| T59 | ✅ | phase7 T55/T59 + phase8 T68b | |
| T60–T61 | ✅ | phase7 | |
| T62 | ◐ | phase7 T62 policy-reread race + malformed-policy + resource-boundary tests; phase5 descendant-timeout/sandbox negatives | policy change during actual candidate execution and quota-backed workspace/staging enforcement remain SPIKE_UNRESOLVED |
| T63–T64 | ◐ | phase7 `INT-003` stop-before-CAS + phase8 reconcile fixtures | SIGKILL during candidate/CAS and full REF_STATE_UNKNOWN recovery harness remain unexecuted |
| T65/T67 | ✅ | phase7 | |
| T66 | ◐ | phase7 `CTX-004: pending context publication after CAS is completed by reconcile` | crash-equivalent mail failure recovery; actual SIGKILL/전원장애 지점은 미실행 |
| T68 | ✅ | phase8 T68a/b/c + audit D1/D2 (READY ordering) | |
| T69 | ◐ | audit D2(손상 상태 → exit 1/STORE_CORRUPT), phase8 T68c(fsck) | hash 손상/빈 DB 재초기화 미실행 |
| T70 | ❌ | — | ENOSPC 주입은 S-06 gate |
| T71 | ❌ | — | backup restore 미실행 |
| T72 | ❌ | — | S-06 gate (VM 부재) |
| T73 | ✅ | cli.test (실 systemd 유닛 + 실 socket CLI acceptance) | 본 audit에서 신규 실행 |
| T74 | ✅ | phase9 NEG 스캔 + loc.mjs | |
| T75/T76 | — | default core 비활성(notmuch/approval false) | optional 활성 시 필수 |
| T77 | ❌ | — | S-09 gate (평가 corpus 없음) |

unresolved 요약: T12,T23,T24,T27,T28,T33–T35,T39,T41,T43,T44,T46,T47,T52,T57,T58,T62–T64,T66,T70–T72,T77은 환경 또는 실제 kill/corpus harness가 남아 있다. T66은 crash-equivalent recovery만 실행했다. TEST-004 kill 지점(T27/T30/T39/T57/T58/T63/T66)은 실제 process/power-cut harness 전까지 PASS로 계산하지 않는다.

## 2nd runtime-correctness audit (2026-09-08) — P0-1/2/3 + P1-4..9

실 socket E2E(test/audit2.test.ts, cgroup-authenticated actor 채널)로 확정·수정:
- **P0-1** IPC-002 per-connection 직렬화: `serveFrames`가 이전 handle()이 settle되기 전에 resumeParsing으로 다음 요청을 dispatch하던 것 수정 → connection-local FIFO 유닛 큐(이전 요청 완료 후에만 다음 dispatch). `serialize`/`stream-then-next` 시나리오가 slow first 요청 뒤 fast 요청이 늦게 응답함을 증명.
- **P0-2** exact raw stream 길이/초과: decoder가 descriptor.bytes만 소비하고 초과를 queue에 남겨 mutation 성공 후 재해석 → `excessStatus()` 추가, stream 완료 시 excess면 STREAM_INVALID pre-dispatch(테스트: excess-garbage는 STREAM_INVALID + op 미생성).
- **P0-3** audit A5는 decoder byte 보존 테스트(규범적)로 유지; 브로커는 serialized dispatch로 다음 요청을 이전 완료 후에만 처리.
- **P1-4** CLI `--request` frozen-first: submit/context가 복구 시 HEAD/파일을 재해석 → `effect()`(frozen params + persisted body 사용), 직접 비교 가능한 명시 인자 충돌만 REQUEST_KEY_REUSED. stream 바이트는 `<key>.body`로 영속.
- **P1-5** `agent create --from HEAD`: 로컬 git rev를 전체 OID로 resolve 후 freeze, 전체 OID만 전송. HEAD 이동 후 복구는 frozen OID 유지.
- **P1-6** `submit --to`: positional 파서에서 `--to` 누락 버그 → multiOpt, `--to a --to b` 및 기본 commons 테스트.
- **P1-7** `status <agent>`: checkParams가 agent를 버리던 것 + dispatch `undefined` 하드코딩 수정 → 요청한 Resident만 반환(a/b 서로 다름 테스트).
- **P1-8** closed runtime schemas: status.get/git.known/git.submit/git.integrate/context.publish/logs.read unknown-field·OID·safe-int·nested entries 검증 + envelope `v===1`(UNSUPPORTED_VERSION) + read/ephemeral top-level `request` 금지. audit2 neg-* 테스트.
- **P1-9** FrameParser의 substring `NaN`/`Infinity` 거절 제거 → 문자열 값 허용, invalid numeric literal은 JSON.parse로 거절(phase2 P1-9 테스트).

## 3rd consolidation/correctness pass (2026-09-08) — P0-A..D + durability

실행·수정·검증:
- **P0-A AUTH**: `src/authority.ts`가 persisted `agents.spec_json`의 닫힌 resolved spec만 수용하고 unknown/malformed capability는 empty set으로 fail-closed; actor entrypoint와 runner auth가 이 단일 근거를 사용한다. `authority.test.ts`, CREATE-002, AUTH-002 및 real actor-socket capability gate 통과.
- **P0-B INT/GIT**: HostConfig integration policy is broker-owned and authoritative policy is reread immediately before CAS; malformed/unreadable/race fails `POLICY_CHANGED`. Main-writer intent is durably recorded before candidate checks, stop/capability rechecked before CAS, and pending integrate operations recover as success/unknown/fail. Git child environments use fixed HOME/PATH/config/hooks; bundle import runs in a private unshare namespace with bounded CPU/address-space/PID/tmp limits and RO canonical objects. Candidate-check workspace/staging quota and fixed worker boundary remain `SPIKE_UNRESOLVED` (no transient `systemd-run`, per UNIT-001).
- **P0-C IPC/DB**: broker/store canonical request hash 및 DB unique winner를 유지하고 real actor socket에서 git/mail same-key same/different payload, concurrent same-key races, delivery 단일성을 확인했다.
- **P0-D STREAM**: N+1/N+2/N+3, malformed excess, short EOF, hash mismatch, idle timeout 및 accepted key의 bad-stream retry를 real Unix socket에서 확인했다. 모두 preaccept `STREAM_INVALID`이며 operation이 없다.
- **FS-003/IPC-008**: RequestCache가 unknown field/digest/receipt/key를 reject하고 file fsync → rename → parent-directory fsync를 수행한다. body bytes와 0600 mode round-trip test를 추가했다.
- **CTX-003/004**: context commit이 expected revision을 parent로 기록하고 candidate를 CAS 전에 plan에 영속화한다. CAS 후 snapshot/current/mail 단계가 중단돼도 `GitModule.reconcile`/`ReconcileModule`이 ref==candidate를 보충하고, 제3 ref는 unknown으로 유지한다. crash-equivalent CTX-004 회귀 테스트 통과.

현재 runtime suite는 `npm test` **83/83 pass, 0 fail, 0 skipped**다. S-01–S-06/S-09 release gate는 raw evidence 전까지 OPEN이며 coverage의 미실행 항목은 PASS로 계산하지 않는다.

production LOC: 8,299 baseline → **9,900** current (`node scripts/loc.mjs`). The 8,001–10,000 allowance is used for the executable IPC, lifecycle, batch, recovery, quarantine, and validation contracts; no new durable entity/service/framework was added. The 10,001-line architecture-review gate is not crossed.

### A-009 production LOC breakdown (2026-09-08)
`node scripts/loc.mjs` output (non-empty physical lines): git 1,564; broker 1,166; mail 980; store 851; lifecycle 829; cli 749; config 460; inference 402; frame 293; contracts 283; validate 270; units 235; sandbox 199; entry/broker 184; leaf 159; views 159; reconcile 149; request-cache 147; runner 118; hash 114; schema-v1.sql 108; ids 83; entry/host 81; pi-extension 59; rpc-client 59; entry/runner 58; authority 49; systemd templates 92; **total 9,900**.

## Phase 10 runtime audit — 2026-09-10, HEAD `326a1d6`

실행 명령:

```text
npm test
node scripts/loc.mjs
git status --short
```

결과:

| 항목 | 결과 | 해석 |
|---|---|---|
| TypeScript build | 통과 | `tsc -p tsconfig.build.json` |
| runtime test suite | **83 passed, 0 failed, 0 skipped** | Node test concurrency=1; 실제 systemd/user socket/sandbox를 포함한 현재 suite |
| lifecycle/batch closure | 통과한 범위 확인 | dynamic Resident runner open, same-name create convergence/conflict, GOAL gate, singleton broker lock, stop/start/reconcile, deterministic batch notice가 실행됨 |
| candidate checks | 부분 통과 | candidate descendant termination과 fail-closed resource-boundary test가 있음; workspace/staging quota와 고정 worker primitive는 여전히 `SPIKE_UNRESOLVED` |
| Pi delivery | 부분 통과 | sandboxed Pi 0.85.1에서 trusted extension/custom message가 동작; provider 없음 상태에서 boundary evidence가 생성되지 않음 |
| Git/context recovery | 통과한 범위 확인 | bundle quarantine, published ref, CAS race, policy reread, context CAS/reconcile가 실행됨 |
| release gate | **미달** | S-01~S-06/S-09 raw evidence 및 남은 coverage가 해결되지 않음 |

이번 commit에서 문서와 직접 연결되는 구현 변경은 `src/lifecycle.ts`, `src/runner.ts`, `src/reconcile.ts`, `src/broker.ts`, `src/units.ts`, `src/mail.ts`, `src/store.ts`, 관련 entrypoint와 테스트다. 이 기록은 변경을 새 durable entity/service로 해석하지 않는다.

### Current LOC audit

현재 저장소의 `node scripts/loc.mjs` 결과는 **9,900**이다. 이 스크립트는 기존 baseline과의 비교를 위해 non-empty physical lines를 센다.

공백과 comment-only line을 제외한 code-only audit은 cloc 2.08 및 OMA systemd filter로 **9,407 code lines / 493 comment lines / 533 blank lines / 34 source files**였다. 두 수치는 같은 예산 정책을 서로 다르게 계산한 결과이므로 섞지 않는다. 8,000 목표와 10,000 초과 architecture review gate에 대한 release 판단은 normative LOC policy가 고정된 뒤 한 가지 계산기를 canonical로 선택해야 한다.

### 현재 남은 release blockers

- S-03: Pi session flush와 trusted boundary evidence가 고정되기 전 `batch.complete`는 presented를 확정할 수 없다.
- S-04: 실제 provider codec/usage upper bound은 mock inference test만으로 닫히지 않는다.
- S-06: 전원 장애, ENOSPC, backup/restore는 실행되지 않았다.
- candidate check: workspace/staging quota와 fixed worker resource primitive가 확정되지 않았다. transient `systemd-run`을 추가하지 않는다.
- test coverage: T12, T23, T24, T27, T28, T33–T35, T39, T41, T43–T44, T46–T47, T52, T57–T58, T62–T64, T66, T70–T72, T77은 완전한 acceptance evidence가 없다.
- S-09: Principal+society의 품질·비용·토큰 benchmark가 없다.
