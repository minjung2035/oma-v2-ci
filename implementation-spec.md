# OMA Core v1 — 구현 계약

문서 상태: **규범 초안 / SPIKE 미해결 / production release 불가**. 작성일: 2026-09-07. 정책 확장 반영: 2026-09-09.

**MUST [N-001]** 구현의 상위 규범은 [architecture.md](architecture.md)이며, 이 계약의 기준본 SHA-256은 `7588b31e7518ded1d439f604400ca0984cccd30936428e00eac03b6032f29fab`이다. 구현 시작 및 release 때 기준본 hash를 확인한다. hash 변경 시 이 계약을 자동 적용하지 않고 차이를 검토한다.

이전 기준본은 `177e60f7660d834873e474eec45d1f4ac17c9f02b48110ec11a5e9442edbd6d6`이었다. 그 이후의 차이는 두 가지이며 둘 다 검토했다. 첫째는 `examples/systemd`와 `validation.md`를 현재 경로로 고치는 링크 수정 2줄이고 의미 변경이 없다. 둘째는 2026-09-18에 추가한 architecture §23(제품 표면과 TUI)이며 아래 §18의 TUI 요구가 그 구현 계약이다.

**MUST [N-006]** 2026-09-09 승인된 변경은 목표 `tiered` profile의 integration policy다. [정책 확장 계약](implementation/integration-policy.md)은 이 spec의 일부이며 기존 `base` substrate와 tiered의 완료 범위를 구분한다. 충돌한 기존 선택 approval 서술은 아래 INT/APP와 확장 계약으로 대체한다. S-08/S-10 전 base schema/IPC만 구현한 상태를 tiered production 지원으로 표시하지 않는다.

**MUST [N-002]** 충돌 시 사용자 지시 → 기준 architecture → 이 계약 → 코드/기존 관례 순으로 적용한다. 이 계약의 상세화가 상위 구조와 충돌하면 해당 부분을 `SPIKE`로 올리고 구현을 차단한다. 구현자가 architecture를 코드에 맞춰 수정해서는 안 된다.

**MUST [N-003]** 규범 단어의 의미는 다음 표와 같다. 아래 코드·표·절차는 해당 `MUST` 문장의 구성 요소이며 단순 예제가 아니다. `SHOULD`에서 벗어나면 이유와 검증을 변경 기록에 남긴다. `OPTIONAL`은 명시적으로 활성화하기 전에는 없는 기능이다.

| 표기 | 구현 계약 |
|---|---|
| MUST | 반드시 구현·검증해야 한다. |
| MUST NOT | 금지한다. 편의·일정·기존 코드와의 호환성은 예외 사유가 아니다. |
| SHOULD | 기본 선택이다. 문서화된 구체적 사유가 있을 때만 이탈한다. |
| OPTIONAL | 명시된 확장 경계 안에서만 선택한다. 기본 build에는 활성화하지 않는다. |
| SPIKE | 근거 또는 실험이 필요한 미결정 사항이다. 성공 기준과 결정 기록 없이는 의존 기능을 production으로 표시하지 않는다. |

**MUST [N-004]** 다음 파일을 하나의 계약으로 취급한다. SQL/TypeScript 파일의 선언은 문서와 동등한 상세 규범이고, 서로 불일치하면 조용히 하나를 선택하지 않는다.

| 파일 | 용도 |
|---|---|
| [implementation/schema-v1.sql](implementation/schema-v1.sql) | 여섯 기본 DB entity의 실행 가능한 초기 DDL |
| [implementation/integration-policy.md](implementation/integration-policy.md) | 제안 검토·tiered authority·challenge/floor·Principal packet 계약 |
| [implementation/contracts.ts](implementation/contracts.ts) | 모듈 및 closed IPC 타입 계약. 실행 코드 아님 |
| [implementation/spikes.md](implementation/spikes.md) | 미확정 부분, 실험, release gate |
| [implementation/test-matrix.md](implementation/test-matrix.md) | 기능·장애·격리·수용 시험 |
| [implementation/systemd/](implementation/systemd/) | 설치 renderer에 입력할 unit template |
| [implementation/physical-ordering.md](implementation/physical-ordering.md) | production 호출 경로의 canonical 물리 순서 |
| [implementation/compliance.md](implementation/compliance.md) | requirement→owner→entrypoint→실행 증거 release gate |
| [implementation/loc-budget.md](implementation/loc-budget.md) | 공백/주석 제외 LOC 계산 계약 |
| [implementation/validation.md](implementation/validation.md) | 이번 산출물 검사 결과와 검증하지 않은 범위 |

**MUST NOT [N-005]** 이 문서의 존재, DDL 검사 통과, TypeScript 타입 검사 통과를 runtime 구현·end-to-end 검증·전원 장애 내구성 증명으로 표현하지 않는다.

## 1. 고정된 구조와 구현 권한의 한계

**MUST [A-001; arch §§1–2,8,21]** 단일 Linux host, society당 broker 프로세스 하나, 논리 Resident당 지속 private clone 하나, 활성 Resident당 trusted runner 하나와 sandbox 내부 Pi RPC session 하나를 구현한다. Principal은 기존 Human Pi session에 연결한다. broker 안의 mail/Git/inference/reconcile은 모듈이며 별도 daemon이 아니다.

**MUST [A-002]** Principal은 공유 목표의 해석·어려운 판단·최종 종합을 담당하고, Residents는 조사·구현·검증·동료 협업을 자율적으로 수행할 수 있어야 한다. Principal에게 일상적인 배정·투표 집계·라우팅·통합의 독점 권한을 부여하지 않는다. `code.integrate`는 host 위임에 따라 Resident에게도 부여할 수 있다.

**MUST NOT [A-003]** commons/topic mail, 전체 tool transcript, 모든 submit을 Principal prompt에 자동 주입한다. `principal` 명시 수신, 공유 context, 기존 Human 대화만 해당 경로의 입력으로 사용한다. Principal mailbox가 있다는 이유로 별도 고가 모델 session을 생성하지 않는다.

**MUST NOT [A-004]** Board / Artifact / Focus / Change / Review / Cognition entity, ID 체계, lifecycle, event reducer, repository abstraction을 native-v2에서 가져오거나 이름만 바꾸어 재현한다. `Message`, Git commit, `batch`, `operation`을 task/approval/cognition object로 확장하지 않는다.

**OPTIONAL [A-005]** 기존 코드의 sandbox argv 구성, Git 실행 wrapper, provider transport, Pi bridge 같은 physical leaf만 재사용 후보로 검토한다. 후보는 입력/출력·오류·권한·외부효과를 이 계약에 맞춰 독립 테스트해야 한다. 기존 domain module import, 기존 durable schema 의존, native-v2 workflow callback이 남으면 후보를 거절한다. 재사용은 허용일 뿐 의무가 아니다.

**MUST NOT [A-006]** 다음을 승인된 architecture 변경 없이 추가한다: durable entity/table/sidecar database, task queue, durable outbox, event bus, message acknowledgement workflow, lease service, scheduler model, manager agent, daemon, custom Git server, SMTP/IMAP, distributed consensus, automatic semantic summarizer, autonomous repair LLM, 새로운 model-facing subcommand. `operations`와 `deliveries` 외에 effect queue를 만들지 않는다.

**MUST [A-007]** base의 허용 durable state는 §4의 allowlist와 여섯 DB entity뿐이다. 목표 tiered에는 POL-006의 authenticated attestation/최소 floor metadata만 추가 허용하되 S-08/S-10의 DDL·migration 계약 확정 전 임의로 저장소를 추가하지 않는다. JSON column을 이용해 숨은 task entity나 범용 key/value store를 만들지 않는다. 파일이 작다는 이유로 이 제한에서 제외하지 않는다. 런타임용 process handle, socket map, mutex, FIFO inference waiter, cache는 메모리에만 둘 수 있으며 crash 후 원본에서 재구성한다.

**MUST [A-008]** Core v1 production source LOC 목표는 **8,000 이하**다. **10,000 초과 시 architecture review가 필수**이며, review 완료 전 release하지 않는다. Tests는 budget에서 제외한다. 직접 작성한 TS, SQL, unit template, shell/native glue와 기본 build에 포함한 optional 기능을 포함한다. 컴파일 산출물·lockfile·수정하지 않은 외부 dependency·문서·test fixture는 중복 계산하지 않는다. test helper가 production에 import되면 포함한다.

**MUST [A-009]** LOC는 공백 줄과 comment-only 줄을 제외한 source code line 수다. 코드와 inline comment가 함께 있는 줄은 code 1줄로 센다. production manifest의 모든 원본을 [LOC 계약](implementation/loc-budget.md)의 pinned cloc 방식으로 계산한다. 주석을 포함했던 이전 정의는 폐기한다. minify·한 줄 몰아쓰기·vendor 이동으로 회피하지 않는다. 8,001–10,000은 목표 초과 사유/모듈별 수치를 남기고 10,001부터 architecture review를 요구한다.

## 2. TypeScript 모듈과 의존성

**MUST [M-001]** application/extension/CLI/runner는 TypeScript로 작성하여 고정된 Node.js runtime에서 실행한다. Pi extension도 TypeScript다. Python supervisor, shell 업무 engine, 별도 Go/Rust broker로 대체하지 않는다. syscall에 필요한 최소 native leaf의 필요성·binding은 `S-01`로 검증한다.

**MUST [M-002]** 모듈 경계는 다음 표와 [contracts.ts](implementation/contracts.ts)를 따른다. 같은 책임의 파일 분할은 허용하지만 공개 서비스·권한·durable entity를 늘리지 않는다. 실행 파일 entrypoint는 조립만 하고 로직을 중복하지 않는다.

| 모듈 | 소유 책임·주요 함수 | 의존 가능 경계 | 소유하면 안 되는 것 |
|---|---|---|---|
| `cli.ts` | argv, local file 읽기, stable request, bundle 생성, receipt 출력 | actor IPC, sandbox 안 Git | host DB, systemd bus, 업무 계획 |
| `broker.ts` | socket accept, 인증, method validation, capability, 모듈 조립 | 아래 host 모듈 | LLM task scheduling |
| `store.ts` | 여섯 entity, migration, 동기 transaction, 쿼리 | SQLite adapter | Git·network await, 본문 저장 |
| `mail.ts` | eml encoding, snapshot expansion, materialize, batch handoff | store, filesystem, views, wake hint | mail 의미 평가, 승인 추론 |
| `units.ts` | 고정 unit render/설치/start/stop/show, 사망 확인 | systemd adapter | PID polling supervisor, task state |
| `runner.ts` | 한 sandbox Pi RPC, incarnation, 안전한 batch 전달 | trusted broker channel, sandbox, Pi adapter | 동료 배정, 다른 runner restart |
| `pi-extension.ts` | custom notice, provider adapter, trusted command, Principal attach | Pi SDK, 제한된 channels | host secret을 model tool에 전달 |
| `git.ts` | bundle quarantine, publish, 검사, main/context CAS | store, sandbox, mail | 자동 merge/rebase, workflow review |
| `sandbox.ts` | rootfs/mount/namespace/FD/argv 조합 | host config, bwrap adapter | 업무별 보안 수준 자기선언 |
| `reconcile.ts` | pending 효과와 실제 파일/ref/unit 대조 | 각 물리 모듈 | 범용 event replay, 모델 호출 |
| `views.ts` | START/inbox/agents/topics/status, 제한된 logs | 읽기 store, filesystem, units | 새 원본·새 workflow |
| `approval.ts` | tiered의 deterministic tier/정확한 tuple attestation 평가; base 비활성 | S-08/S-10 gated schema, auth, mail, git | 자연어 승인 추출·업무 scheduler |

**MUST [M-003]** production build는 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 켠다. 외부 JSON·DB JSON·Pi 이벤트를 런타임 schema로 검증하고 unknown field를 거절한다. `as SomeType`을 검증으로 사용하지 않는다. DTO schema와 타입은 동일 정의에서 생성하거나 호환성 검사를 둔다.

**MUST [M-004]** `Store.transaction` callback은 동기식이다. transaction 안에서 await, Git, systemd, fsync, provider 호출을 수행하지 않는다. subprocess는 argv 배열로 실행하고 shell 문자열 보간을 사용하지 않는다. stdout/stderr는 설정된 크기를 넘으면 bounded spool 또는 명시적 실패로 처리하며 메모리에 무한 수집하지 않는다.

**SPIKE [S-01]** Node/Pi/SQLite binding/Git/systemd/bwrap/email library/rootfs의 정확한 version과 배포 방식은 플랫폼 검증 결과로 pin한다. 버전 번호를 이 계약에서 추측하지 않는다. pin 결과는 host 배포 manifest이며 새 운영 상태 DB가 아니다.

## 3. 신원·이름·설정·권한

**MUST [ID-001]** society와 Resident 이름은 ASCII `[a-z][a-z0-9-]{0,31}`이고 topic은 `[a-z][a-z0-9-]{0,63}`이다. `principal`, `commons`, `residents`, `topic`은 Resident 이름으로 금지한다. 이름은 생성 후 바꾸거나 재사용하지 않는다. actor의 role과 capability는 연결 인증에서만 얻는다.

**MUST [ID-002]** operation/batch ID는 prefix `op-`/`b-`와 소문자 UUIDv4이고, message file ID는 `m-<operation UUID>-<ordinal>`이다. ordinal은 0부터이며 한 operation의 message plan에서 고정한다. Message-ID는 `<file-id@society.oma.invalid>`다. request key는 CLI 생성 UUID 또는 `--request`의 `[A-Za-z0-9._-]{1,96}`이고 actor 범위에서 유일하다. ID를 모델이 수동 생성할 필요는 없다.

**MUST [ID-003]** Git OID는 repository의 object format에 맞는 full lowercase hex만 wire에서 받는다. symbolic revision은 CLI가 freeze한 뒤 전송한다. hash 길이를 SHA-1 40자로 고정하지 않는다. wire path는 `/` 구분 상대 경로이고 NUL, `.`/`..` component, 절대 경로를 거절한다.

**MUST [CFG-001]** `config.json`은 host만 수정하며 다음 폐쇄된 정보를 가진다: schemaVersion=1, society, trusted rootfs/install path, pinned deployment manifest digest, agent profile map, 초기 population, society/lineage agent·usage cap, Principal slot/budget reserve, provider credential reference, protected path 목록, candidate check argv/env/resource profile, policy revision, storage/resource/protocol limits, optional notmuch/approval/egress flags. secret 값은 파일에 넣지 않고 host credential reference로 해석한다.

**MUST [CFG-002]** 기본 quota 금액·model ID·provider 가격·기능성 검사 명령은 bootstrap 때 Human host 설정으로 필수 제공한다. missing 값을 무제한·검사 없음·가장 비싼 모델로 채우지 않는다. `requiredChecks: []`는 host가 명시적으로 선택한 경우만 허용한다. quota 계산은 최소 화폐 단위 정수이며 JS에서는 safe integer 검사 또는 bigint/decimal string 경계를 사용한다.

**MUST [CFG-005]** `contracts.ts`의 `HostConfigV1`을 기본 profile의 폐쇄된 설정 schema로 사용한다. 숫자는 유한한 non-negative safe integer이고 slot/size/timeout은 양수다. Principal reserve는 total을 초과하지 않는다. quota는 Core v1 society 수명 누계이며 자동 월별 reset을 추가하지 않는다. 금액 단위·가격 codec은 host deployment manifest에 고정한다. `protectedPaths`는 glob이 아닌 repository 상대 literal path 또는 `/`로 끝나는 subtree prefix다. diff의 추가/수정/삭제 양쪽 path를 모두 검사한다. config 교체 시 새로운 policy revision을 필수로 지정하고 outstanding integrate가 이를 재검사한다.

운영 파일 분리는 별도 authoring 입력 `kind: "oma-operations-v1"`로 제공할 수 있다. host가 명시한 파일만 읽어 기존 폐쇄형 `HostConfigV1`으로 조합·검증하며, role별 prompt/extension metadata는 wire·ledger schema나 실행 권한을 확장하지 않는다. 변경은 재시작 시 새 snapshot으로 읽고 기존 accepted evidence는 다시 쓰지 않는다. 추가 extension 실행에는 기존 PI/deployment 검증 게이트가 그대로 적용된다. 파일 형식과 제한은 [운영 설정 안내](operations/README.md)를 따른다.

**MUST [CFG-003]** wire resource 기본값은 frame 256 KiB, mail body 256 KiB, subject 512 UTF-8 bytes, logical address 64개, reply reference 64개, context 파일 256개/합계 8 MiB, bundle 256 MiB, logs 1 MiB, accepted connection당 미완료 control request 1개다. host는 명시적으로 낮추거나 높일 수 있고 모든 endpoint에서 같은 값으로 검증한다. 이 값은 전용 preview 기능이나 본문의 자동 절단 규칙이 아니다. 초과 입력은 접수 전에 거절하고 파일/Git 사용을 안내한다.

**MUST [CFG-004]** 프로토콜 timeout 기본값은 frame/stream 무진행 30초, control receipt 기다림 30초다. 결과를 기다리다 timeout이면 해당 effect는 실패로 간주하지 않는다. 대규모 작업은 pending receipt 후 같은 key로 조회한다. inference timeout/output cap/가격 bound는 provider profile에 필수로 둔다.

**MUST [AUTH-001]** 기본 capability 집합은 `mail.send`, `route.follow`, `agent.create`, `agent.manage.self`, `agent.manage.descendants`, `git.submit`, `code.integrate`, `context.publish`로 닫는다. Principal role은 자동 `code.integrate`/Human approval 권한이 아니다. 일반 Resident에게 `context.publish`를 주지 않는다. 자식 권한은 부모의 위임 가능한 부분집합과 host profile의 교집합이다.

**MUST [AUTH-002]** 관리 요청은 self 또는 `created_by` ancestry상의 descendant에만 해당 capability로 허용한다. Principal은 별도의 host 위임 범위 안에서 관리한다. sibling 정지·권한 증폭·자식 생성으로 quota 우회는 거절한다. status와 public operational logs 읽기는 사회 구성원에게 허용하되 host journal/secret은 제외한다. operation.get은 자기 actor의 key만 조회한다.

**MUST [AUTH-003]** per-incarnation pathname listener에 actor를 고정하고 SO_PEERCRED 및 실제 systemd cgroup을 검증한다. 같은 UID, payload actor, 환경 변수, unit처럼 보이는 문자열은 증명이 아니다. 이전 incarnation 연결을 닫고 이후 요청을 `STALE_RUN`으로 거절한다. 실행 인증과 이미 접수된 broker-owned effect의 복구를 구분한다.

**SPIKE [S-01,S-02]** host PID 재사용을 피하는 peer 확인, Node binding, Principal attach credential 보호와 tool sandbox 검증은 release gate다. 검증 실패 시 UID-only fallback·무격리 fallback을 만들지 않는다.

## 4. 파일시스템 계약과 원본

**MUST [FS-001; arch §4]** state root `S=$XDG_DATA_HOME/oma/<society>`를 사용하며 XDG_DATA_HOME이 없으면 `$HOME/.local/share`를 사용한다. runtime root는 `R=$XDG_RUNTIME_DIR/oma/<society>`다. 모델이 보낸 path로 S/R을 바꾸지 않는다. 각 디렉터리는 trusted host가 생성·소유한다. custom XDG path는 unit renderer가 안전한 절대 path로 렌더링한다.

**MUST [FS-002]** 다음 allowlist 밖의 durable 파일을 추가하지 않는다. `<id>`는 위 검증을 통과한 broker 생성 ID, `<actor>`는 등록된 identity다. tmp는 동일 디렉터리/파일시스템에서 atomic publish하고 file fsync 후 parent dir fsync한다.

| Host path | 소유·내용·수명 | model mount |
|---|---|---|
| `S/config.json` | host authority, atomic replace | 없음 |
| `S/runtime.sqlite{,-wal,-shm}` | broker 상태, SQLite 관리 | 없음 |
| `S/repos/project.git/` | 코드·게시 ref 원본, broker writer | `/git/project.git` RO |
| `S/repos/context.git/` | 공유 의도 Git 원본 | 없음; snapshot만 공개 |
| `S/seed/` | OPTIONAL 고정 reflink 원본 | 없음 |
| `S/mail/objects/<id>.eml` | immutable accepted 원문; 미참조 preaccept orphan 가능 | 없음 |
| `S/mail/archive/{tmp,new,cur}/` | 공개 link/copy, 기본 `cur/<id>:2,` | `/mail/archive` RO |
| `S/mail/inboxes/<actor>/{tmp,new,cur}/` | 배달 link/copy | 자기 것만 `/mail/self` RO |
| `S/agents/<actor>/workspace/` | persistent independent clone | `/workspace` RW |
| `S/agents/<actor>/workspace.tmp/` | provisioning 중 clone, operation에 연결 | 없음 |
| `S/agents/<actor>/home/` | Pi session, 개인 notes, CLI local request cache | `/home/agent` RW |
| `S/agents/<actor>/runner/view/` | 재생성 inbox index | `/run/oma-view` RO |
| `S/agents/<actor>/runner/receipts/<batch>.json` | trusted session-boundary 증거, S-03 형식 | 없음 |
| `S/principal/private/` | Human session handle/extension metadata와 private scratch | scratch 하위만 Principal tools |
| `S/world/{START.md,agents.tsv,topics.tsv}` | 파생 목록 | `/world` RO |
| `S/world/context/revisions/<oid>/` | context commit의 immutable export | `/world` RO |
| `S/world/context/current` | `revisions/<oid>` 상대 symlink | 부모 `/world` RO |
| `S/index/notmuch/` | OPTIONAL 재생성 index | `/mail/index` RO |
| `S/staging/<operation-or-preaccept-id>/` | body/bundle/context/quarantine/check 임시 파일, allowed operation에 연결 | 원칙 없음; check 전용 mount만 |
| `R/actors/<actor>/<incarnation>/control.sock` | ephemeral actor listener | `/run/oma/control.sock` |
| `R/admin.sock` | host/runner 관리 채널, S-01 인증 | 없음 |
| `R/` 안의 process-local lock/socket/tmp | 재시작 시 검증 후 재생성 | 없음 |

**MUST [FS-003]** CLI cache는 `/home/agent/.local/state/oma/requests/<key>.json`이며 freeze된 request, body/bundle digest, 마지막 receipt만 저장한다. broker 원본이 아니고 모델이 변조할 수 있다. broker는 항상 다시 검증한다. Principal CLI의 대응 cache는 자기 private scratch 안에 둔다. 여기서 별도 queue/자동 replay engine을 만들지 않는다.

**MUST [FS-004]** `/inbox.md`는 `/run/oma-view/inbox.md` symlink다. index를 교체할 때 부모 mount를 유지한다. world/mailbox도 부모 directory를 mount한다. 기존 파일 inode의 단일 bind로 live view를 구현하지 않는다. mailbox rename은 broker만 수행한다.

**MUST [FS-005]** state root/DB/private/runner receipt는 기본 host mode 0700 directory, 0600 file이다. 공개 원문은 host 0444이고 모델 mount는 RO다. 같은 host UID에서 파일 mode만으로 sandbox 경계를 주장하지 않는다. staging path에는 no-follow/exclusive-create를 사용하고 agent symlink를 따라 host file을 열지 않는다.

**MUST [FS-006]** 원본은 eml(본문/header), SQLite(접수·수신자·handoff·usage), Git(코드/공유 의도), systemd(실행 관측), Pi session(대화)으로 제한한다. inbox/agents/topics/notmuch를 삭제해도 원본 의미를 잃지 않아야 한다. topic 목록은 accepted operation의 logical topic 주소 및 subscriptions에서 유도하며 topics table을 추가하지 않는다.

**MUST [FS-007]** 게시 refs·accepted messages·완료 operation·usage를 Core v1에서 자동 삭제하지 않는다. orphan staging/object는 DB 참조 없음, active writer 없음, quiescence가 확인될 때만 host maintenance로 정리한다. GC TTL을 추측해서 추가하지 않는다. disk full 뒤에도 accepted effect의 pending 상태를 유지한다.

## 5. DB schema, transaction, 허용 상태

**MUST [DB-001; arch §14]** base entity는 `agents`, `operations`, `subscriptions`, `deliveries`, `batches`, `usage` 여섯 개뿐이다. [schema-v1.sql](implementation/schema-v1.sql)을 base 초기 migration으로 실행한다. tiered persistence는 POL-006/S-08/S-10의 후속 계약 전 지원하지 않는다. migration version은 SQLite `user_version`을 사용하고 migrations table을 추가하지 않는다. 기존 native-v2 DB를 변환·공유하지 않는다.

**MUST [DB-002]** broker만 DB를 쓴다. 연결마다 foreign_keys=ON, synchronous=FULL, busy_timeout=5000, WAL을 확인한다. 일반 mutation은 `BEGIN IMMEDIATE`; schema migration은 `BEGIN EXCLUSIVE`다. commit 성공 전에 accepted/succeeded를 반환하지 않는다. DB_BUSY는 같은 key retry, DB 손상은 mutation 중단으로 처리한다.

**MUST [DB-003]** 아래 상태는 물리 효과에만 적용한다. business/workflow 상태로 확장하지 않는다.

| 대상 | 허용 값·전이 |
|---|---|
| agent.desired | provisioning → enabled 또는 stopped; enabled ↔ stopped; enabled/stopped → retired; retired terminal |
| operation.state | pending → succeeded/failed/unknown; unknown → 실제 효과 대조 후 succeeded 또는 증명된 실패; terminal 결과는 변경 금지 |
| batch.state | prepared → completed; prepared의 incarnation 소유만 검증된 복구 때 변경 |
| delivery flags | materialized/presented/acknowledged 각각 0→1; presented가 이해·완료·승인이라는 뜻은 아님 |
| usage.outcome | reserved → completed/cancelled/unknown; unknown은 provider의 확정 증거 있을 때만 정산 |

**MUST [DB-004]** `operations.payload_json`은 normalized caller request, `plan_json`은 broker가 확정한 물리 plan, `result_json`은 receipt 결과만 담는다. `plan_json`의 허용 variant는 다음 표다. operation kind와 일치하지 않는 field를 거절한다. 다른 workflow 상태를 JSON 안에 감추지 않는다.

| kind | plan의 허용 데이터 |
|---|---|
| mail.send / agent.continue | 고정 message ID, object 상대 path/hash/bytes/date, logical to, expanded recipients, reply headers, kind, context revision |
| mail.ack | 자기 recipient와 message ID |
| route.follow/unfollow | topic, 자기 actor |
| agent.create | 고정 spec/hash/from OID, 이름, 부모, 초기 message plan, workspace/unit 상대 경로 |
| agent.start/stop | 대상, 변경 전 incarnation, 요청한 desired; stop의 remaining operation IDs |
| git.submit | candidate/exportRef/prerequisites, staging bundle path/hash/bytes 또는 no-bundle, publishedRef, result message plan |
| git.integrate | repo=project,target=main,base,candidate,policyRevision,고정 check profile digest |
| context.publish | base 또는 null,candidate,context branch,입력 manifest/staging,notification message plan |

**MUST [DB-005]** message plan은 operation 접수 transaction에서 수신자를 고정한다. 여러 단계의 submit/context/create도 동일한 ID·수신자 snapshot을 사용하고 effect 완료 후 그 plan의 공개를 수행한다. 중간 membership 변경으로 수신자를 다시 선택하지 않는다. 아직 공개할 준비가 안 된 Git result/context/create initial mail은 materializer가 effect 조건을 확인하기 전 노출하지 않는다.

**MUST [DB-009]** `plan_json`은 `contracts.ts`의 `OperationPlan` union과 operation kind가 일치해야 한다. 성공 결과는 `OperationResult`의 해당 kind만 허용한다. message plan의 eml bytes는 accepted 전에 broker-only object에 완성하며, Git/context/create 후속 메일도 아직 공개하지 않은 object를 먼저 고정할 수 있다. 이때 ID/ref/date/subject/body/hash를 이후 새로 계산하지 않는다. effect가 준비된 뒤 archive/inbox 공개만 수행한다. byte/hash를 아직 모르는 값을 null/0 placeholder로 accepted하지 않는다.

**MUST [DB-006]** 직접 send는 eml을 먼저 완성한 후 transaction에서 operation+delivery를 함께 insert한다. submit/context/create의 후속 mail도 같은 parent operation의 plan/delivery를 사용한다. 별도 child-operation 체인·outbox table을 만들지 않는다. 실패한 parent가 공개하지 않은 message는 pending 읽기/batch 대상에서 제외한다.

**MUST [DB-007]** DB write transaction 경계는 다음과 같이 고정한다. 파일/Git/systemd 효과는 경계 밖에서 실행하고 재진입 시 실제 결과를 대조한다.

| 경계 | 같은 transaction에 포함할 것 |
|---|---|
| T-send | 권한/중복 재검사, 주소 snapshot, op insert, deliveries insert |
| T-route | 중복 op, subscription 변경, op succeeded |
| T-batch-prepare | 현재 incarnation, snapshot, batch insert/회수, delivery.batch_id 연결 |
| T-batch-complete | trusted receipt 확인 후 batch completed와 해당 deliveries.presented |
| T-ack | 자기 delivery.acknowledged, op succeeded |
| T-create-intent | 이름/spec conflict 검사, agents provisioning, parent op+initial message plan |
| T-create-ready | 필수 clone/unit 확인 뒤 enabled 또는 stopped, initial mail 공개 조건 확정 |
| T-run-open | 이전 cgroup 사망 확인 뒤 incarnation 증가, recoverable batch 소유 변경 |
| T-stop-intent | desired=stopped 및 stop op pending |
| T-submit-accept | durable bundle 검증 후 op+고정 result message plan/deliveries |
| T-integrate-intent | 직렬화된 repo slot 확인, base/candidate/policy pending op |
| T-integrate-done | 실제 main 대조 뒤 op succeeded |
| T-context-accept/done | 고정 commit/notification intent; 실제 ref/snapshot 대조 후 완료 |
| T-usage-reserve | 전체/계통/Principal reserve 검사와 usage reserved insert |
| T-usage-settle | provider usage와 outcome 원자 갱신 |

**MUST [DB-008]** prepared batch에 포함된 message IDs와 delivery.batch_id의 집합은 같아야 하며 recipient는 batch.agent와 같아야 한다. DB FK만으로 충분하지 않은 교차행 불변식은 store 함수와 integrity test에서 검증한다. completed batch는 변경·확장하지 않는다. 누락 원문, FK 손상, 실제 ref 불일치는 조용히 새 상태로 덮어쓰지 않는다.

**SPIKE [S-03]** 진행 중 steer batch와 agent_end 완료 경계의 동시성은 기준 architecture에 남은 미결정이다. 기본 DDL은 새로운 state를 추가하지 않으며, prepared batch의 동시 허용 수/선택 알고리즘을 spike 결과 없이 추측하지 않는다. 단일 batch로 잠그고 모든 실시간 안내를 agent_end까지 미루는 것도 상위 요구를 만족한 구현으로 간주하지 않는다.

## 6. IPC framing, schema, idempotency

**MUST [IPC-001; arch §13]** actor socket 위 protocol v1은 `uint32 big-endian JSON byte length` + 해당 길이 UTF-8 JSON이다. JSON root는 object, v=1, id는 연결 내 request correlation 문자열이다. public 요청/응답은 `contracts.ts`의 discriminated union과 정확히 일치한다. duplicate JSON key, invalid UTF-8, NaN/Infinity, 안전 범위 밖 integer, unknown field/method/version을 거절한다.

**MUST [IPC-002]** control 연결 하나에는 동시에 요청 하나만 처리한다. git/context body stream은 metadata frame 뒤 descriptor.bytes만큼 raw bytes를 읽고 SHA-256과 길이를 확인한다. raw stream 사이에 JSON notification을 끼우지 않는다. 실제 길이 부족/초과·연결 종료는 preaccept `STREAM_INVALID`다. inference는 별도 연결을 쓰고 control framing parser와 상태를 섞지 않는다.

**MUST [IPC-003]** mail body는 제한 안에서 UTF-8 JSON 문자열로 전송한다. bundle/context content는 descriptor stream을 사용한다. 큰 메일을 자동 절단하거나 숨은 attachment API로 바꾸지 않는다. 응답은 `{v:1,id,ok:true,result}` 또는 `{v:1,id,ok:false,error:{code,message,retry,details?}}`다. HTTP status/임의 exit text를 IPC error contract로 대신하지 않는다.

**MUST [IPC-004]** `MutationRequest`는 DB operations.kind에 있는 모든 durable mutation이며 top-level `request: RequestKey`가 타입과 runtime validator 모두에서 필수다. 누락·빈 key·잘못된 형식은 접수 전에 INVALID_REQUEST로 거절한다. `ReadRequest`는 `operation.get`, `status.get`, `logs.read`, `git.known`이고 top-level request를 금지한다. `operation.get`의 조회 대상 key는 `params.key`에만 둔다. `EphemeralRequest`는 현재 run의 메모리 intent인 `agent.wait`이며 읽기로 분류하지 않고 top-level request와 durable op 생성을 금지한다. 읽기/ephemeral의 `request?: never`는 키를 허용한다는 뜻이 아니며 명시적 undefined도 strict 타입 검사에서 거절한다. `Request<M>`는 이 세 집합의 method-discriminated union이고 미분류 method는 허용하지 않는다. 요청 actor/incarnation/capability는 wire에 넣지 않고 AuthContext에서 주입한다.

**MUST [IPC-005]** request hash는 method+normalized params+stream descriptor를 key 정렬한 canonical UTF-8 JSON의 SHA-256이다. 배열 순서는 의미 있는 경우 보존하고 to/prerequisite/path 집합은 dedupe+lexical sort한다. body bytes와 subject는 trim하지 않는다. CRLF body는 CLI가 LF로 정규화하고 이후 immutable하게 취급한다. request key, transport id, timestamp, actor supplied claim은 hash 입력이 아니다.

**MUST [IPC-006]** CLI는 effect 요청 이전에 private cache에 key·normalized payload·고정 OID·stream digest를 atomic write한다. 응답 유실 시 같은 key로 operation.get, 미접수면 동일 payload로 retry한다. 동일 actor/key·동일 hash는 기존 receipt, 다른 hash는 `REQUEST_KEY_REUSED`다. 같은 key의 동시 preaccept 파일이 여러 개 생겨도 DB unique winner의 plan만 공개한다.

**MUST NOT [IPC-007]** timeout을 failed로 바꾸거나 새 key를 자동 만들어 동일 효과를 재실행한다. 새 shell invocation에 새 key가 생기는 것은 별도 요청이며 자연어 의미를 dedup하지 않는다. key가 다르면 같은 candidate라도 새 수신자/result mail을 만드는 정상 제출일 수 있다.

**MUST [IPC-008]** operation.get은 새로운 model-facing 명령을 만들지 않고 원래 command의 `--request <key>` 재호출/복구 안내 내부에서 사용한다. CLI가 freeze cache를 찾으면 현재 HEAD를 다시 해석하지 않는다. cache와 사용자 새 인자가 충돌하면 `REQUEST_KEY_REUSED`로 명확히 중단한다. unconfirmed key 복구 안내는 `/inbox.md`에 경로와 원래 command를 짧게 제공한다.

**MUST [IPC-009]** trusted-only method는 actor endpoint에서 dispatch하지 않는다. runner.open/batch.prepare/batch.complete/observe는 runner channel, Principal attach/detach는 보호된 extension channel, host.principalRelay/reconcile은 host channel만 사용한다. batch.read는 trusted OMA extension helper에만 제공한다. 일반 `oma` CLI에 내부 method 호출 escape hatch를 넣지 않는다.

**MUST [IPC-011]** internal channel도 동일한 bounded frame/error 형식을 사용하며 `InternalRequest`/`InternalResponse`로 제한한다. runner.open은 검증된 unit invocation에만 lease를 반환하고, batch.complete의 성공 응답은 DB complete commit 뒤에만 보낸다. runner.observe는 메모리 관측값이며 durable row를 추가하지 않는다. principal.attach의 credential 발급·교환 handshake는 OMA가 소유해 직접 기동한 session에 한해 확정한다. host-only channel은 host가 broker를 spawn할 때 연 socketpair(descriptor 3)이며, host는 그 peer로 식별되므로 secret이 필요 없다. broker는 이 channel이 있을 때만 principal endpoint를 열고, 두 endpoint가 listening된 뒤에 준비를 알린다. host는 자신의 자식인 engine을 등록하고, broker는 그 engine이 실제로 host의 자식인지 확인한 뒤 credential을 channel로 돌려준다. credential과 session handle은 파일에도, 어떤 프로세스의 환경에도, 명령행에도 두지 않는다 — 셋 다 같은 UID의 다른 프로세스가 읽을 수 있기 때문이다. host→engine, trusted extension→CLI로도 socketpair로만 전달하며, pipe와 달리 socket은 `/proc/<pid>/fd`로 다시 열 수 없다. attach는 credential과 handle에 더해 연결한 프로세스가 등록된 engine의 자손일 것을 요구하므로, credential을 얻었어도 engine이 시작하지 않은 프로세스는 Principal이 아니다. attach 이전 요청과 위조·이전 run의 credential은 `AUTH_FAILED`, 다른 session handle은 `ATTACH_CONFLICT`다. 재등록과 broker 재시작은 새 credential을 발급하고 이전 것은 무효다. host의 channel이 닫히면 broker는 스스로 멈춘다. ptrace가 같은 UID 사이에서 제한되지 않는 host(Yama scope 0)에서는 어떤 user-space 검사도 두 프로세스를 구별하지 못하며, 이는 host의 성질로 적어 둔다. 사용자가 따로 띄운 외부 Pi session에 attach하는 경로는 여전히 확정하지 않으며 S-02의 model-facing tool 통과 기준도 그대로 남는다. host relay/reconcile 응답은 실제 처리된 개수를 반환하고 timeout은 작업 성공으로 꾸미지 않는다. 대량 Principal backlog에서 oneshot timeout/start-limit 반복이 발생하지 않는 처리량·자원 조건은 S-06 필수 시험이다.

**MUST [IPC-012]** InternalMethods의 key set은 exhaustive socket surface다. 내부 helper는 분리할 수 있지만 batch.stage 등 새 socket method/phase를 추가하지 않는다. batch.prepare는 transaction뿐 아니라 BATCH-001의 rename/fsync/view publish까지 소유한다. post-transaction 실패를 별도 stage RPC로 모델/runner가 수습하게 하지 않는다. unknown method는 side effect 전에 UNKNOWN_METHOD다.

**MUST [IPC-010]** `mail_available`는 데이터 없는 힌트이며 durable queue가 아니다. 힌트 수신·재연결·안전한 Pi 경계·idle 직전에 pending 원본을 다시 읽는다. 유실 시 path/timer가 복구한다. sequence gap 복원용 새 event log를 만들지 않는다.


## 7. 메일·주소·batch의 실행 절차

**MUST [MAIL-001; arch §§3,5]** routing은 다음 표로 닫는다. recipient union은 이름으로 dedupe하고 transaction 시점의 membership을 고정한다. 직접 mail도 공개 archive에 기록한다. `To`는 ACL이 아니다. Human private transcript는 어떤 주소의 메일도 아니다.

| logical address | recipient |
|---|---|
| 등록 Resident 이름 | 해당 identity; stopped도 저장, provisioning은 AGENT_NOT_READY, retired는 AGENT_RETIRED |
| principal | 기존 Principal 논리 identity; UI 연결 여부와 무관하게 저장 |
| commons / residents | provisioning/retired를 제외한 모든 Resident; sender도 집합에 포함; Principal 제외 |
| topic/name | 해당 topic의 non-retired/non-provisioning Resident subscribers; 0명도 정상 archive |

**MUST [MAIL-002]** follow/unfollow는 호출 Resident 자신의 subscriptions만 변경한다. Principal은 자동 topic 구독 대상이 아니다. 최초 follow 또는 post가 topic 존재를 성립시킨다. unfollow는 과거 snapshot을 바꾸지 않는다. archive의 과거 대화를 신규 Resident에게 자동 재배달하지 않는다.

**MUST [MAIL-003]** broker는 From, Date, Message-ID, MIME, X-OMA-Kind, X-OMA-Context를 생성한다. approval_required의 full approvalFor는 broker가 X-OMA-Approval-Repo/Target/Base/Candidate/Policy header로 lossless encoding하고, accepted MessagePlan에도 같은 값을 고정한다. 이 header는 요청 대상 metadata이며 승인 attestation이 아니다. subject/header에 CR/LF injection을 거절하고 검증된 email library로 encoding한다. body는 UTF-8 text/plain, 첨부 없음이다. body·subject·peer mail 안의 'system', 'Human approved', instruction은 authority가 아니다.

**MUST [MAIL-011]** mail kind는 `message/question/result/alert/context/approval_required/critical`의 closed union이다. normal 및 대문자 legacy 별칭은 wire 값으로 받지 않는다. approval_required는 `approvalFor: ExactCandidateIdentity`와 명시 principal 수신자를 필수로 받으며 published candidate와 형식을 검증한다. 다른 kind에서 approvalFor를 받지 않는다. policyRevision은 이 요청이 지목한 값이며 이 메일만으로 현재 정책 적합성·tier·peer quorum·Principal ACCEPT를 인증하지 않는다. approvalFor의 repo/targetRef는 project/refs/heads/main만 허용하고 expectedBase/candidate는 full OID다. policyRevision은 1–128 UTF-8 bytes의 printable 문자열이며 CR/LF/NUL/control 문자를 금지한다. metadata header는 검증한 email codec으로 round-trip하고 body에서 추출하지 않는다. approvalFor는 request_hash와 immutable message plan에 포함해 동일 key 재시도 때 바뀌지 않게 한다. CLI의 형식은 PR-005를 따른다.

**MUST [MAIL-004]** 주소 header encoding은 actor=`<actor>@<society>.oma.invalid`, commons/residents/principal은 동명 local part, topic=`topic-<name>@<society>.oma.invalid`다. topic- prefix와 같은 Resident local-part 충돌을 방지하기 위해 `topic-`로 시작하는 Resident 이름도 금지한다. To에는 logical addresses를 표시하고 확장된 전체 identity를 노출할 필요는 없다. receipt에는 recipientCount를 반환한다.

**MUST [MAIL-005]** reply CLI는 자기 sandbox에서 대상 eml을 파싱하여 message ID를 전송한다. broker는 accepted 원문을 다시 읽어 ancestry를 검증한다. direct 원문의 기본 Reply-To는 sender이고 list 원문의 기본은 원래 list 주소다. 여러 list에 보낸 원문은 list 주소 집합을 Reply-To로 사용한다. 명시 `to`가 있으면 이 기본값을 대체한다. In-Reply-To는 직전 Message-ID, References는 기존 ancestry+직전 ID이며 최대치 초과 시 최초 root와 최신 suffix를 유지한다. header에 없는 authority를 추가하지 않는다.

**MUST [MAIL-006]** send 순서는 ① 인증/제한/중복 조회 ② immutable eml stage+fsync ③ broker-only object publish+dir fsync ④ T-send ⑤ accepted pending receipt ⑥ archive/recipient materialize ⑦ operation succeeded다. 수신자가 0명이어도 archive publish 후 succeeded다. 성공은 delivery 완료이고 presentation/답변을 기다리지 않는다.

**MUST [MAIL-010]** materializer의 공개 조건은 direct send/continue의 accepted op, submit의 publishedRef==candidate 및 객체 검증 완료, context의 canonical ref/snapshot/current==candidate, create의 workspace/unit 준비와 provisioning 종료다. 기본 parent가 failed인 미공개 mail은 배달하지 않는다. message metadata/body는 공개 전 object로 이미 고정돼 있으므로 새 template 렌더링으로 복구하지 않는다. 조건과 실제 대상이 불일치하면 pending/unknown으로 대조하며 새 effect-ready table/flag를 추가하지 않는다.

**MUST [MAIL-007]** archive target은 `cur/<id>:2,`, inbox의 최초 target은 `new/<id>`다. 배달 전에 new와 cur의 canonical path를 모두 확인한다. 같은 FS이면 immutable object hardlink, 다른 FS이면 tmp copy+hash 확인+fsync+atomic publish를 사용한다. 이미 존재하면 원문 hash를 확인하고 동일할 때만 성공으로 취급한다. file publish+directory fsync 후 T에서 materialized=1로 기록한다.

**MUST [MAIL-008]** archive와 각 mailbox의 publish는 별개 효과다. A/B 성공 후 C 실패 시 재시작은 C만 보충한다. cur에 이미 있는 A를 new로 되돌리지 않는다. 원문 참조가 존재하는데 실제 object가 없거나 hash가 다르면 `STORE_CORRUPT`로 mutation을 중단한다. 모델이 cur flags를 편집하거나 mail을 삭제할 권한은 없다.

**MUST [MAIL-009]** `mail.ack`는 자기 delivery.acknowledged만 1로 만든다. body를 실제 읽었는지 추적하지 않는다. ACK는 권한/승인/업무 완료 조건이 아니고 기본 mail마다 요구하지 않는다.

**MUST [BATCH-001; arch §§7,18]** batch 선택 대상은 공개 가능한 parent effect의 materialized=1,presented=0인 자기 deliveries다. 이미 prepared batch에 묶인 ID를 새 batch로 복사하지 않는다. prepare transaction이 ID snapshot과 batch 연결을 먼저 commit하고 그 뒤 new→cur rename, directory fsync, inbox view atomic publish를 수행한다. snapshot을 진행 중 새 메일로 확장하지 않는다.

**MUST [BATCH-002]** batch notice는 최대 6개 metadata 항목과 `/inbox.md` 경로를 포함하고 본문 자동 요약은 하지 않는다. 항목에는 sender, subject, kind, mail 경로, 필요 시 reply/reference만 둔다. index에는 batch의 전체 ID와 직접 읽을 수 있는 경로를 제공한다. context mail이면 고정 revision 경로와 GOAL 변경 안내를 포함한다. meta limit은 원문 잘림을 뜻하지 않는다.

**MUST [BATCH-003]** 일반 batch의 최대 message 수는 host resource 설정 `batchMaxMessages`로 고정하며 초기 reference 값은 24다. direct/question/result/context class와 public-list class 양쪽이 있으면 각각 최소 1개를 포함하고, 남은 자리는 두 class를 교대로 oldest `(created_at_ms,message_id)`부터 선택한다. notice 6개도 이 순서를 사용한다. kind만 바꿔 권한·Principal 강제 개입을 얻을 수 없다.

**MUST [BATCH-004]** prepared batch 복구 시 원래 message IDs와 session을 유지한다. 이전 run 사망 확인과 현재 incarnation fencing 후 transaction에서 소유만 바꾼다. 성공 agent_end 및 `S-03`의 trusted session-boundary 증거가 확인된 batch만 completed/presented로 만든다. 오류·abort·timeout·모델의 '완료했습니다'는 증거가 아니다.

**MUST [BATCH-006]** 기본 followUp 경로의 production batch.complete는 validation record에 pin된 `oma-pi-rpc-v1@0.85.1` receipt만 허용한다. trusted runner가 소유한 정확한 state-root receipt path, batch ID/incarnation/message manifest, adapter revision, runner session root와 durable session file이 모두 일치해야 completed/presented를 같은 transaction에서 commit한다. 타입이나 문자열만 맞춘 evidence, model writable 경로, mock completion, 환경 변수 우회는 거절한다. 이 qualification은 진행 중 steer/concurrency 또는 전체 S-03 kill matrix를 통과했다는 뜻이 아니다.

**MUST [BATCH-005]** session 경계 증거가 불충분하면 같은 batch ID로 재안내할 수 있다. 같은 mail을 다시 안내했다는 사실을 표시하고 기존 operation receipt와 workspace를 대조하게 한다. 이전 shell/tool을 자동 replay하지 않는다. Pi 사고과정·tool cursor·reasoning snapshot용 state를 추가하지 않는다.

**SPIKE [S-03]** 위 fairness 규칙은 prepare 대상으로 허용된 시점에 적용한다. 진행 중 direct steer와 public followUp의 batch 분리/완료 귀속은 검증 전 미정이다. 현재 batch의 deliveryMode를 새 mail 때문에 바꾸거나 ID를 추가하는 구현은 금지한다.

## 8. Resident·Principal·Pi 경계

**MUST [PI-001; arch §§7–8]** trusted runner가 bwrap 안에서 `pi --mode rpc`를 실행하고 RPC stdin/stdout을 private pipe로 다룬다. Pi extension은 `src/pi-extension.ts`의 신뢰된 compiled artifact만 기본 로드한다. agent workspace의 extension/config를 host runner에서 import하지 않는다. Pi의 discovery 차단 옵션은 pinned 버전 실험으로 확인한다.

**MUST [PI-002]** runner는 trusted `oma-deliver` extension command를 RPC prompt로 호출한다. extension은 batch ID의 소유를 확인한 후 다음 형태로 전달한다. Peer content를 Human role prompt로 꾸미지 않는다.

```typescript
pi.sendMessage(
  { customType: 'oma-mail', content: batch.notice,
    display: true, details: { batchId: batch.id } },
  { triggerTurn: true, deliverAs: batch.deliveryMode }
);
```

**MUST [PI-003]** 현재 qualified 기본 profile은 activation 때 준비된 batch를 followUp으로 전달하고 terminal boundary까지 완료한다. 이미 진행 중인 tool group 사이에 도착한 direct/question/reply/context를 끼워 넣는 steer profile은 도구 결과 보존·취소·동시 batch 귀속이 검증될 때까지 지원한다고 주장하지 않는다. 새 mail 때문에 준비된 batch의 ID나 mode를 바꾸지 않는다.

**MUST [RUN-001]** activation은 unit/invocation 확인 → 이전 run 사망 확인 → incarnation 발급 → pending/prepared 회수 → sandbox/Pi resume → batch 안내 → 정상 Pi loop → boundary commit → pending 재검사 → 필요 시 다음 loop 또는 exit 0 순서다. 최초 GOAL 전에는 inference를 시작하지 않는다.

**MUST [RUN-002]** inference slot이 부족하면 runner는 bounded 메모리 waiter로 기다린다. new를 남겨 둔 채 즉시 exit/restart를 반복하지 않는다. systemd·broker 취소를 받아 즉시 waiter에서 빠져야 한다. idle일 때 mail 유무를 모델에게 주기적으로 묻지 않는다.

**MUST [RUN-003]** `oma agent continue --note`는 자기 앞으로 일반 message를 보내는 operation이다. continuation task entity는 없다. `oma agent wait`는 현재 run의 메모리 flag를 설정하고 해당 tool 반환 뒤 안전한 경계에서 종료를 요청한다. pending mail이 있으면 원본을 유지하고 재활성화 정책을 따른다. wait가 mail을 ACK하거나 desired=stopped로 바꾸지는 않는다.

**MUST [PR-001]** Principal logical identity는 bootstrap 때 한 번 만들고 Pi UI attach와 독립적으로 유지한다. 동시에 하나의 attach만 허용하고 두 번째는 ATTACH_CONFLICT다. attach는 host-only channel의 비공개 credential로 인증하며 session handle/path는 모델 payload에서 신뢰하지 않는다. 연결 끊김은 new Principal 생성의 trigger가 아니다.

**MUST [PR-002]** principal-relay는 mailbox new 항목마다 deliveries의 durable 수신 기록과 원문을 확인하고 모두 cur로 이동한다. 기존 질문/batch가 pending이어도 새 항목을 계속 인수한다. UI가 없으면 batch를 새로 prepare하지 않는다. UI reconnect 시 host가 pending을 조회하여 제한된 batch를 인수하고, trusted extension이 그것을 session에 custom message로 제시한다. batch 준비와 완료는 host endpoint에서 그 broker를 시작한 host에게만 서빙하므로 model이 실행하는 어떤 것도 자기 mail을 전달된 것으로 표시할 수 없다. 전달은 session이 idle일 때만 하며, 실행 중인 turn 안에서의 boundary 귀속(S-03)에 의존하지 않는다. idle 관측과 run 시작은 한 단계여야 한다: session의 소유권은 engine이 turn_start를 보고하기 전에, 무엇을 쓰기 전에 동기적으로 예약하며, Human prompt와 delivery가 같은 소유권을 쓴다. 소유권의 단위는 engine의 agent run이다. Pi는 queue에 든 continuation까지 모두 소진한 뒤 run마다 `agent_settled`를 한 번 보내므로, prompt 하나에 settle 하나를 기대해서는 안 된다. Human은 mail 때문에 기다리지 않고 다시 입력할 필요도 없다 — session이 이미 예약돼 있으면 prompt는 host가 순서대로 들고 있다가 run이 끝나는 그 단계에서 곧바로 쓴다. engine 자신의 follow-up queue에는 넣지 않는다: 그렇게 넣은 prompt는 진행 중인 delivery의 run 안에서 실행되고, 그 run에 대해 extension이 기록하는 boundary가 Human의 turn까지 덮게 된다. engine이 prompt를 수락 전에 거절하면 어떤 run도 시작·종료하지 않으므로, 그 응답을 읽어 예약을 돌려주고 사용자에게 알린다. settle되지 않고 끝난 delivery도 예약을 돌려준다. delivery의 실패는 assistant message 하나가 아니라 run이 settle될 때 판정한다 — Pi는 retry와 compaction으로 실패한 message 뒤에도 같은 run을 계속하기 때문이다. boundary 없이 끝난 turn의 batch는 prepared로 남아 back-off 뒤 다시 전달된다. relay는 Pi model call을 하지 않는다.

**MUST [PR-003]** Principal의 Human context·private memory는 principal/private와 기존 Pi session에 남긴다. context publish는 공유 문서만 전달한다. mailbox urgent alert는 UI 경고일 수 있지만 Human 입력을 위장하거나 현재 깊은 판단을 강제 abort하지 않는다. 모델이 질문에 답하는 데 필요한 peer evidence는 archive/Git에서 선택해서 읽는다.

**MUST [PR-005]** typed Principal mail과 progressive packet은 확장 계약 SEM/PACK을 따른다. 기존 `oma send`의 `--kind approval_required`에 한해 `--candidate <published-oid> --expect <base-oid> --policy-revision <revision>`을 모두 요구하고 CLI가 `approvalFor={repo:project,targetRef:refs/heads/main,expectedBase,candidate,policyRevision}`을 만든다. 그 외 kind에서는 세 flag를 거절한다. 별도 decision/interrupt command 또는 DB를 추가하지 않는다. `critical`은 UI 인지 hint이고 followUp/tool 보존/예산 제한을 우회하지 않는다. `result`는 sender의 결과 보고이며 task/Human 전달 완료의 증거가 아니다. HIGH의 authoritative decision command/record는 여전히 S-08 gate다.

**MUST [PR-004]** Principal host Pi의 모든 model-facing shell/read/write/edit 및 동적으로 등록된 tool 경로를 sandbox-backed 구현으로 제한한다. extension attach credential·Human 원본 session·provider credential을 model tool sandbox에 mount하지 않는다. trusted extension은 session 접근이 필요하지만 model에게 그 권한을 위임하지 않는다.

**SPIKE [S-02,S-03]** Pi hook/command/tool replacement·session flush의 정확한 import와 signature는 pinned SDK로 실행 검증 후 작성한다. provider API는 엔진이 소유하므로(INF-001) OMA가 확정할 signature가 없다. 비슷해 보이는 SDK 함수명이나 `appendEntry` 호출만으로 fsync를 보장한다고 추측하지 않는다.

## 9. Git command 계약

**MUST [GIT-001; arch §§10–12]** Git child process는 shell interpolation 없이 argv 배열로 실행한다. host Git은 agent의 cwd/config/hooks를 읽지 않는다. trusted HOME, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_REPLACE_OBJECTS=1`, empty hooks directory를 사용하고 환경의 `GIT_*`를 allowlist 외 제거한다. hook/filter/credential helper/remote URL은 caller가 지정하지 못한다.

**MUST [GIT-002]** 아래 command에서 `<...>`는 검증된 값의 argv 한 항목이다. 숫자 OID·ref를 문자열 shell에 삽입하지 않는다. 예시 path는 §4에서 broker가 계산한 값이다. Git stderr는 bounded하게 수집하고 내부 host secret/path를 response에 그대로 노출하지 않는다.

| 목적 | argv 의미 |
|---|---|
| OMA own 초기 bare clone | `git clone --bare --no-local <host-authorized-root> <S/repos/project.git>` |
| Resident 최초 clone | `git clone --no-local --single-branch --branch main /git/project.git /workspace` |
| object format | `git --git-dir=<repo> rev-parse --show-object-format` |
| CLI candidate freeze | `git -C /workspace rev-parse --verify <revision>^{commit}`; 결과 full OID 검사 |
| CLI export pin | `git -C /workspace update-ref refs/oma/export/<request-hash> <C>` |
| incremental bundle | `git -C /workspace bundle create <local.tmp.bundle> refs/oma/export/<request-hash> ^<P1> ...` |
| bundle prerequisite 검사 | `git --git-dir=<quarantine> bundle verify <bundle>` |
| bundle refs 검사 | `git --git-dir=<quarantine> bundle list-heads <bundle>` |
| quarantine 수입 | `git --git-dir=<quarantine> fetch --no-tags <bundle> <export-ref>:refs/oma/input` |
| 객체 검사 | `git --git-dir=<quarantine> fsck --strict --no-reflogs` 및 candidate commit/ancestry 검증 |
| published ref 최초 생성 | `git --git-dir=<project> update-ref <published-ref> <C> <zero-OID>` |
| peer fetch | `git -C /workspace fetch --no-tags origin <published-ref>`; 이후 `git show FETCH_HEAD` |
| descendant | `git --git-dir=<project> merge-base --is-ancestor <B> <C>` |
| protected path diff | `git --git-dir=<project> diff-tree --no-commit-id --name-status -r -z --no-renames <B> <C>` |
| main CAS | `git --git-dir=<project> update-ref refs/heads/main <C> <B>` |

**MUST [GIT-003]** 최초 host root clone은 원 개발자 checkout을 수정하거나 push하지 않는다. 초기 main은 Human이 지정한 commit으로 고정한다. root repo의 symlink/config/transport 신뢰 범위는 host bootstrap validation으로 제한한다. Resident clone의 origin fetch refspec은 main만 유지한다. published refs는 필요할 때 명시 fetch한다.

**MUST [GIT-004]** `git.known`은 현재 main 및 immutable published refs 중 broker가 실제 보유한 OID의 bounded 목록을 반환한다. 목록에서 로컬에 존재하고 candidate ancestry에 적합한 OID만 prerequisite으로 선택한다. 목록은 최적화 정보이지 권한 증거가 아니다. 없으면 self-contained bundle을 허용하고, candidate가 이미 broker에 존재하면 bundle을 생략한다.

**MUST [GIT-005]** submit은 candidate를 처음 한 번 freeze한다. `.git` dirty 변경을 자동 commit/추가하지 않는다. CLI는 dirty 여부를 표시하되 지정 commit 제출은 허용한다. cache의 candidate/hash를 유지하고 HEAD 이동 뒤 같은 key로 다른 bytes를 보내지 않는다. export ref는 accepted 결과와 재시도에 필요하므로 terminal receipt 후 같은 C를 가리키는지 확인해서 제거할 수 있다.

**MUST [GIT-006]** complete bundle bytes+digest를 staging에 fsync한 뒤 T-submit-accept한다. quarantine은 broker-owned disposable repo, private network namespace, bounded CPU/memory/PID/tmp, trusted config, empty hooks를 사용한다. 입력 bundle에는 정확히 요청 export ref 하나만 허용한다. 불필요한 main/ref를 포함하면 BUNDLE_INVALID로 거절한다. 요청 C가 실제 exported commit인지 확인한다.

**MUST [GIT-007]** quarantine prerequisite은 broker의 read-only project objects에서만 해소한다. temporary quarantine의 RO alternate는 이 검사 동안만 허용되며 Resident persistent clone에는 mutable alternate를 절대 두지 않는다. 검증한 pack/object만 canonical repository에 반입하고 ref 생성 전에 객체 durable write를 확인한다. unvalidated pack을 host 권한으로 파싱하는 지름길은 금지한다.

**SPIKE [S-05]** quarantine→canonical의 정확한 검증·object import argv/pack flush 조합은 hostile bundle와 prerequisite 실험으로 확정한다. 단순 `cp -r quarantine/objects` 또는 agent repo를 host `git fetch`하는 대안으로 채우지 않는다. 위 command 표는 양 끝의 확정된 계약이며 이 중간 경로의 검증 완료를 뜻하지 않는다.

**MUST [GIT-008]** published ref는 `refs/oma/published/<actor>/<operation-id>`이고 immutable이다. 이미 C면 idempotent success, 다른 OID면 PUBLISHED_REF_CONFLICT 후 해당 효과 중단이다. canonical main을 bundle ref에 따라 변경하지 않는다. ref 확인 후 고정 result message를 공개·배달하고 receipt에 C/ref/fetch command/dirty 안내를 반환한다.

**MUST [GIT-009]** submit succeeded는 published ref와 result mail materialization이 완료됐다는 뜻이다. main 통합·review 완료·Principal 판단·agent 종료를 뜻하지 않는다. report/document도 private clone에서 commit하고 published ref+path로 전달할 수 있다. 별도 Artifact repository나 모든 report를 main에 넣는 규칙을 추가하지 않는다.

**MUST [INT-001]** base 및 tiered의 공통 조건으로 integrate는 candidate가 하나 이상의 canonical published ref로 보존됨, code.integrate capability, actual main==expected, expected ancestor of candidate, protected path 조건, fixed host checks, 현재 policy를 검사한다. protected path는 default profile에서 Resident integrate를 거절한다. candidate==expected면 main은 변경하지 않는 검증된 no-op receipt로 처리할 수 있지만 published/권한 조건을 생략하지 않는다.

**MUST [INT-002]** candidate 검사는 별도 sandbox의 해당 C checkout에서 host 지정 argv/env로 수행한다. 검사의 stdout 'PASS'가 아닌 실제 exit code/timeout을 사용한다. candidate가 수정할 수 있는 검사 script가 존재한다는 사실만으로 trusted 검사 정책을 대체하지 않는다. test sandbox에 actor/admin socket, credential, shared repo RW, workspace 밖 host FS를 노출하지 않는다.

**SPIKE [S-01-CANDIDATE]** 허용 fixed unit 집합 안에서 candidate check의 CPU/memory/tasks/tmp/workspace/staging 한도와 모든 후손 종료를 kernel-enforced 하는 정확한 실행 primitive는 미확정이다. transient systemd-run/service/scope, userland polling, broker 전체 cgroup 한도만을 candidate별 격리로 취급하는 방식, 무제한 fallback을 허용하지 않는다. 증거가 pin되기 전 nonempty integration.checks를 가진 production profile의 활성화 및 실제 검사 요청은 SPIKE_UNRESOLVED로 차단한다. checks를 자동으로 []로 바꾸어 회피하지 않는다. host가 원래 명시적으로 선택한 checks=[] base profile만 이 sub-gate의 비적용 범위다.

**MUST [INT-007]** 실제 spawn의 candidate OID/argv/env/resources는 검증된 check snapshot과 정확히 같아야 한다. builder unit test만 통과하고 production이 다른 cwd/config/default를 쓰는 것을 금지한다. timeout/signal/검사 후손 잔존/관측 불명확은 CHECK_FAILED 또는 대조 전 pending/unknown이며 PASS가 아니다. host check exit 0만으로 아직 살아 있는 background process를 무시하고 종료했다고 기록하지 않는다. 실제 candidate 출처와 kernel limits를 production entrypoint 시험에서 확인한다.

**MUST [INT-003]** project main mutation은 repo별 메모리 mutex와 pending integrate operation 검사로 직렬화한다. 먼저 T-integrate-intent, 그 뒤 검사·Git CAS, 마지막 T-integrate-done다. crash 후 unresolved integrate가 있으면 새로운 main writer를 시작하지 않는다. CAS 바로 전에 main/policy/capability/stop intent를 재검사한다.

**MUST [INT-004]** 복구에서 main==candidate는 이미 ref 효과가 발생한 것으로 대조한다. base는 receipt를 완료하고 tiered는 PUB-001/002의 미완료 공개 메일까지 보충한 뒤 succeeded로 완료한다. main==base면 현재 조건을 다시 검사하고 진행하거나 증명된 precommit 실패로 끝낸다. 그 외는 REF_STATE_UNKNOWN으로 unknown을 남기고 해당 repo main write를 차단한다. 외부 수동 main 변경을 새로운 정상 base로 수용하지 않는다. CAS 경쟁 패자는 STALE_BASE와 actual main을 받는다.

**MUST NOT [INT-005]** broker가 rebase/merge/cherry-pick/충돌 해결·자동 재승인·새 candidate 생성을 한다. Resident가 자기 clone에서 새 candidate를 만들고 새 request로 제출한다. Principal만 integrate할 수 있는 gate도 추가하지 않는다.

**MUST [INT-006]** 목표 tiered는 확장 계약 TIER/PUB/CHAL의 max-tier, exact approval/OBJECT, HIGH Principal ACCEPT, post-CAS 공개, challenge/re-entry floor를 구현해야 한다. 기존 base의 optional approval만으로 이 요구를 충족했다고 표시하지 않는다. base의 현재 schema/build는 승인 evaluator를 활성화하지 않는다. approve/object/revoke 및 필요한 최소 확장의 closed syntax/schema는 S-08/S-10 완료 시 함께 반영한다.

**MUST [APP-001]** tiered attestation 구현은 actor를 인증하고 append-only fact+mail을 기록하며 동일 actor의 중복 승인은 한 번만 집계한다. object는 명시 revoke 전까지 유효하고 자기 attestation만 취소할 수 있다. branch/base/candidate/policy가 다르면 재사용하지 않는다. Human 승인은 host/UI channel만 발급한다. mail의 approve 문구를 parser로 권한화하지 않는다.

**SPIKE [S-08]** tiered의 MEDIUM 기본 peer floor 1, zero active OBJECT, HIGH의 peer floor+Principal ACCEPT는 채택했다. eligible actor/author provenance·host trust 설정·exact decision/revoke evaluator·최소 DDL/IPC는 아직 검증이 필요하다. S-08은 이제 tiered의 필수 gate이며 S-10의 floor/정책 snapshot 계약과 함께 통과해야 한다. base의 protected-path 거절 구현은 계속 가능하지만 tiered 지원의 대체품은 아니다.

## 10. 공유 context 게시

**MUST [CTX-001; arch §8.3]** `oma context publish <directory> --expect <oid|none>`은 기존 문서 구조 `GOAL.md`, `RATIONALE.md`, `decisions/*.md`를 게시한다. GOAL은 필수 UTF-8 regular file이고 비어 있으면 거절한다. symlink/device/hardlink/절대 path/상위 이동을 거절한다. binary/비허용 path는 INVALID_REQUEST다.

**MUST [CTX-002]** CLI는 경로별 sorted manifest `{path,bytes,sha256}`와 그 순서대로 이어붙인 raw content stream을 만든다. descriptor.bytes는 각 bytes 합계다. broker는 staging에서 각 file 길이/hash를 확인한다. tar를 임의 host path에 추출하지 않는다. 파일별 mode는 고정 regular 0644이며 commit에는 실행 권한을 부여하지 않는다.

**MUST [CTX-003]** context.git의 canonical ref는 `refs/heads/main`으로 고정한다. 기존 revision을 parent로 한 commit을 broker trusted identity로 생성하고 op plan에 candidate C를 영속화한다. 첫 publish expected=null은 ref absent를 뜻한다. `git update-ref refs/heads/main C B` 또는 첫 생성의 zero-OID CAS를 사용한다. CAS 실패는 CONTEXT_CONFLICT+actual revision이다.

**MUST [CTX-004]** context CAS 뒤 `world/context/revisions/C`를 immutable 완성·fsync하고 relative current symlink를 atomic 교체한 뒤 고정 residents notification을 공개한다. crash 후 ref==C이면 missing snapshot/symlink/mail을 보충한다. 다음 context mutation 전에 미완료 publication을 대조한다. ref==B이면 현재 조건으로 재시도하고 제3 OID면 unknown으로 멈춘다.

**MUST [CTX-005]** context provenance는 Principal interpretation이다. Human 원문의 전부·private memory를 복사하지 않는다. 기존 인간 승인으로 둔갑시키지 않는다. model startup에는 current GOAL/핵심 제약을 직접 제공하고 상세 rationale은 fixed revision path로 읽는다. 여러 문서를 읽는 동안 `current`를 매번 다시 resolve하지 않는다.

**MUST [CTX-006]** 첫 context publication이 끝나기 전 Resident는 생성만 가능하고 path 활성화/inference를 하지 않는다. 첫 성공 후 enabled Residents의 path를 활성화하고 notification으로 시작한다. 새 Resident는 생성 당시 최신 context와 brief만 받고 부모 전체 session이나 과거 commons backlog를 복사하지 않는다.

## 11. systemd와 lifecycle

**MUST [UNIT-001; arch §§6,15]** society별 허용 unit은 broker.service, 각 Resident의 service/path, principal.path/principal-relay.service, reconcile.service/timer다. unit 이름은 `oma-<society>-broker.service`, `oma-<society>-<actor>.service/.path`, `oma-<society>-principal-relay.service`, `oma-<society>-principal.path`, `oma-<society>-reconcile.service/.timer`다. 이름 충돌 방지를 위해 Resident 이름 broker, principal-relay, reconcile도 금지한다.

**MUST [UNIT-002]** [systemd templates](implementation/systemd/)를 고정 renderer로 생성한다. template의 @NODE@/@LIBDIR@/@STATE@/@SOCIETY@/@AGENT@는 host 값에서만 치환한다. unit 이름과 ExecStart argv를 caller 문자열에서 만들지 않는다. `%`/공백/따옴표/newline은 systemd 문법에 맞춰 escape하고 NUL/newline이 들어간 설정은 거절한다. 템플릿은 systemd에 그대로 설치할 파일이 아니다.

**MUST [UNIT-003]** 초기 reference profile은 resident MemoryMax=3G, TasksMax=128, CPUQuota=200%, OOMPolicy=kill, KillMode=control-group, TimeoutStopSec=10s, Restart=on-failure, RestartSec=3s, StartLimitIntervalSec=60s, StartLimitBurst=5다. 실제 host cap은 bootstrap config에 명시하고 renderer가 반영한다. resource profile이 지원되지 않으면 무제한으로 실행하지 않고 UNSUPPORTED_PROFILE이다.

**MUST [UNIT-007]** systemctl effect 성공은 subprocess spawn이 아니라 정상 exit status와 해당 effect의 후속 actual observation으로 판정한다. nonzero/timeout/signal/malformed 결과를 성공으로 바꾸지 않는다. daemon-reload는 정상 exit와 대상 unit의 LoadState=loaded 및 렌더링한 설정 일치, enable/disable은 unit-file 상태, path start/stop은 path 실제 상태, service stop은 inactive와 cgroup 후손 사망을 확인한다. 관측 실패는 succeeded가 아니며 accepted op는 실제 효과를 대조한다. 짧게 실행 후 정상 종료한 Resident start는 동일 InvocationID의 정상 종료와 pending 재검사를 허용하되 전혀 시작 안 된 inactive와 구분한다. 정확한 systemd property/binding 증거는 S-01/S-06에 pin한다.

**MUST [UNIT-004]** broker는 Type=notify이며 DB/open-operation 복구, 이전 Resident cgroup 정리, socket/인증 준비가 완료된 뒤에만 READY=1을 보낸다. Resident는 After+BindsTo broker다. Type=exec인 runner의 모든 Pi/shell/test 후손은 동일 cgroup에 남는다. runner 하나의 PID만 종료하고 완료로 응답하지 않는다.

**MUST [UNIT-005]** .path는 inbox/new에 DirectoryNotEmpty를 사용한다. enabled+GOAL 조건이 충족될 때만 enable/start한다. prepared batch만 cur에 남은 경우 reconcile과 startup DB 조회로 service를 시작한다. path 상태만으로 pending을 판단하지 않는다. default.target에 enable된 path가 reboot 때 잘못 켜져도 broker 인증은 stopped/GOAL 없는 실행을 거절하고 reconcile이 path를 중지한다.

**MUST [UNIT-006]** start-limit failure는 status에 노출하고 reconcile이 자동 reset-failed를 반복하지 않는다. 명시적 `oma agent start <name>` 또는 host repair만 reset-failed를 수행할 수 있다. stopped actor의 new는 계속 저장하되 path/service를 켜지 않는다.

**MUST [CREATE-001]** model-facing `agent.create`의 `params`는 `AgentCreateInput`으로 고정하고 `name`, CLI가 freeze한 full `from` OID, UTF-8 `brief`만 받는다. `profile`/`capabilities`는 CLI 옵션·wire 입력·request cache의 caller payload에 넣지 않는다. 해당 field가 들어오면 값이 host default와 같더라도 INVALID_REQUEST로 거절하고, 무시하거나 caller 선호로 사용하지 않는다. TypeScript의 `profile?: never`/`capabilities?: never`는 이러한 입력 금지 제약이며 선택 입력이 아니다. 다른 unknown field도 기존 strict validator 규칙으로 거절한다.

**MUST [CREATE-002]** broker만 `ResolvedAgentSpec`의 최종 profile/capabilities/modelProfile/resources를 결정한다. modelProfile/resources는 선택한 자식 host profile에서 복사해 고정한다. 인증된 부모의 `agents.profile`에 대응하는 host `AgentProfile`을 찾고 그 `childProfile`을 선택한다. null이면 CAPABILITY_DENIED, 참조하는 profile이 없으면 UNSUPPORTED_PROFILE로 접수 전에 거절한다. 자식 capabilities는 `인증된 부모의 현재 유효 capabilities ∩ 부모 profile.delegable ∩ 선택한 자식 profile.capabilities`의 전체 교집합을 중복 제거·사전순 정렬한 값이다. Principal도 동일한 명시적 host 위임을 적용하며 role로 교집합을 확대하지 않는다. CLI/모델이 host 설정을 대신 해석해 resolved spec을 전송하지 않는다. host의 초기 population 설정은 이 actor-facing 입력과 별개다.

**MUST [CREATE-003]** `operations.payload_json`과 request_hash는 정규화한 `AgentCreateInput`만 포함한다. `plan_json.spec` 및 `agents.spec_json`에는 broker가 확정한 `ResolvedAgentSpec`을 저장하고 `spec_hash`는 그 전체 canonical spec의 hash다. 접수 transaction에서 부모 권한과 선택한 host 정책이 resolution 때와 같은지 재검사하고 달라졌으면 접수 전에 다시 계산한다. 같은 key의 accepted 요청은 새 host default를 해석하기 전에 기존 hash/receipt를 조회하고 저장된 resolved spec으로 복구한다. 재시도로 profile/capabilities를 재선택하거나 확대하지 않는다. 다른 key의 stable-name dedup은 최종 resolved spec hash를 비교하므로 host default 변경으로 spec이 달라졌으면 AGENT_CONFLICT다. 현재 권한의 폐기와 run 차단은 기존 AUTH/LIFE 규칙을 계속 적용한다.

**MUST [LIFE-008]** initialResidents는 최초 bootstrap seed만 지정하며 runtime registry가 아니다. ready 이후 모든 actor의 identity/profile/capabilities/modelProfile/resources/from/parent는 agents의 검증된 resolved spec 및 created_by에서 가져온다. `ResolvedAgentSpec`은 생성 시 선택한 host profile의 modelProfile 참조와 ResourceLimits 전체를 포함하고 spec_hash에 포함한다. runner/unit renderer/authenticator는 `initialResidents.find()`나 seed 부재 시 default profile을 사용하지 않는다. 호스트의 현재 credential/가격/명시적 권한 폐기 정책은 계속 적용하되 persisted 권한·자원 상한을 조용히 확대하지 않는다. 저장된 profile/model 참조를 현재 배포가 지원하지 못하면 UNSUPPORTED_PROFILE로 차단하고 임의 대체하지 않는다. DB column name/profile과 spec의 대응 값이 다르면 STORE_CORRUPT다. 부모는 created_by가 원본이며 새 parent registry를 만들지 않는다.

**MUST [LIFE-009]** 최초 bootstrap 중 seed마다 stable-name create intent를 남기고 같은 intent로 중단 복구한다. bootstrap seed가 추가/삭제됐다는 이유로 다음 broker restart 때 agent를 자동 생성/삭제/중지하지 않는다. 최초 GOAL publication 이후는 seed 보충 단계가 아니며 explicit lifecycle 경로만 사용한다. 최초 bootstrap 도중 seed 설정 변경은 지원하지 않는다. 중단 복구는 기존 seed create intent부터 재개하며 host는 원래 seed 설정을 유지해야 한다. 이미 기록된 intent와 현재 seed spec이 다르면 AGENT_CONFLICT로 중단한다. bootstrap 완료/중단은 기존 최초 context ref와 provisioning/create intent로 대조하고 새로운 bootstrap 상태 DB를 만들지 않는다.

**MUST [LIFE-001]** create는 stable name/spec hash와 request key를 동시에 dedup한다. 같은 이름·같은 spec이면 기존 생성 결과로 수렴한다. 다른 spec이면 AGENT_CONFLICT다. lineage quota는 provisioning을 포함해 예약하고 failed provisioning을 멋대로 삭제·이름 재사용하지 않는다. 생성 실패의 자동 재개는 같은 physical intent에 한한다.

**MUST [LIFE-007]** 같은 이름/spec에 다른 request key로 create가 오면 기존 create operation에 연결한 `existingCreation` plan을 만들고 clone/unit/mail을 추가 생성하지 않는다. 새 key의 operation은 기존 provisioning 결과를 대조해 같은 agent 결과로 끝낸다. 이는 create 한 종류의 stable-name dedup이며 범용 dependency/workflow graph가 아니다. provisioning actor에 대한 model start/stop은 AGENT_NOT_READY로 거절한다. already enabled이며 현재 cgroup이 정상인 agent.start는 idempotent no-op이고 incarnation을 증가시키지 않는다.

**MUST [LIFE-002]** create 순서는 T-create-intent → workspace.tmp 독립 clone 및 pinned base 검증 → workspace atomic rename+dir fsync → mailbox/runner/unit 생성 → daemon-reload 결과와 unit LoadState/설정 확인 → T-create-ready → initial mail materialize → GOAL 있으면 path 활성화다. 준비 전 identity는 commons/topic expansion과 status의 ready count에서 제외한다. unit 생성 성공만으로 enabled라고 기록하지 않는다.

**MUST [LIFE-003]** stop은 T-stop-intent → StopUnit(path)/disable activation → endpoint+inference revoke → StopUnit(service) → systemd cgroup 사망 확인 → succeeded다. 종료 확인 불가면 RUN_TERMINATION_UNKNOWN/unknown이고 새 incarnation을 발급하지 않는다. 이미 accepted mail/submit은 broker가 완료한다. 아직 CAS하지 않은 integrate는 CANCELLED_BEFORE_COMMIT, CAS한 것은 실제 ref와 대조해 완료한다. stop receipt에 남은 broker-owned op ID를 포함한다.

**MUST [LIFE-004]** start는 retired를 거절하고, 이전 cgroup 사망 및 GOAL을 확인한 뒤 desired=enabled와 operation을 기록한다. GOAL 없으면 GOAL_REQUIRED로 반환하며 desired/path를 변경하지 않는다. path와 필요 시 cur prepared service를 활성화하고 actual unit result를 receipt/status에 반영한다. start가 새로운 논리 agent/session/workspace를 생성하지 않는다.

**MUST [LIFE-005]** retirement는 이름을 보존하는 host 명시 행위다. 기본 model CLI에 retirement/delete/purge를 추가하지 않는다. host 운영 UI/maintenance 구현 범위가 필요하면 기존 stopped→retired와 미래 routing 제외만 제공하고 repo/mail/session의 자동 삭제를 결합하지 않는다.

**MUST [LIFE-006]** broker restart 시 ephemeral waiter/connection을 복원하지 않는다. old run 권한을 폐기하고 cgroup 사망을 확인한 뒤 pending physical effects를 대조한다. Principal attach는 끊고 인증된 재연결을 기다린다. bootstrap이 불완전하면 stage별 실제 파일/ref/DB로 같은 작업을 이어가되 root checkout은 쓰지 않는다.

## 12. sandbox mount·FD·network 계약

**MUST [SB-001; arch §16]** baseline은 trusted rootfs RO, user/mount/PID/IPC/network/UTS/cgroup namespace 분리, cap drop, private proc/dev, new session, die-with-parent다. rootfs에는 pinned Node/Pi/Git/shell/rg/library와 empty mount targets만 둔다. host `/` 또는 `/home` 전체를 bind하지 않는다.

**MUST [SB-007; arch §16]** 기본 rootfs는 OMA가 society state root 아래에 만든다. 내용은 빈 mount target과 agent만을 이름으로 갖는 생성된 `/etc/passwd`·`/etc/group`뿐이며 host `/etc`에서 복사하지 않는다. 프로그램과 라이브러리(`SB-001`의 Node/Git/shell/rg/library)는 host 운영체제의 것을 RO bind로 겹쳐 제공하고, 그 대상은 `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc/alternatives`, `/etc/ld.so.cache`로 닫힌다. 이 목록 밖의 host 경로 — `/`, `/home`, state root, runtime directory — 는 받아들이지 않는다. host가 merged-`/usr`로 둔 최상위 link는 rootfs 안에 같은 모양으로 재현하되 `/usr` 밖을 가리키는 link는 따라가지 않는다. Node는 실제 binary 한 파일만 고정 경로에 RO bind한다. rootfs 생성은 idempotent하며, 예상 밖의 항목은 지우지 않고 거절한다.

**MUST [SB-002]** Resident argv builder는 다음 의미의 배열을 생성한다. 옵션 지원 여부와 identity 매핑은 S-01로 검증한다. rootfs 안 mount target은 배포 때 생성하고 actor가 수정하지 못한다. `/tmp` reference cap은 512 MiB이고 host가 더 제한할 수 있다.

```text
bwrap --unshare-all --new-session --die-with-parent --cap-drop ALL
  --ro-bind <rootfs> /
  <--ro-bind <osPath> <osPath> for each SB-007 system path the host has>
  --ro-bind <realNodeBinary> /opt/oma-node/node
  --proc /proc --dev /dev
  --size <tmpBytes> --tmpfs /tmp
  --ro-bind <libdir> /opt/oma
  <--tmpfs /opt/oma/<dir> --remount-ro /opt/oma/<dir> | --ro-bind /dev/null /opt/oma/<file>
     for each installed product-surface path (TUI-003)>
  --bind <ownWorkspace> /workspace
  --bind <ownHome> /home/agent
  --bind <ownRunnerSessionDir> /run/oma-sessions
  --ro-bind <archive> /mail/archive
  --ro-bind <ownMailbox> /mail/self
  --ro-bind <ownRunnerViewDir> /run/oma-view
  --ro-bind <worldDir> /world
  --ro-bind <projectGit> /git/project.git
  --ro-bind <ownIncarnationSocket> /run/oma/control.sock
  --symlink /run/oma-view/inbox.md /inbox.md
  --clearenv --setenv HOME /home/agent
  --setenv PATH <trusted-rootfs-PATH>
  <--setenv OMA_* for each core-extension input, then the four the builder owns>
  --chdir /workspace -- /opt/oma-node/node /opt/oma/<engine entry> --mode rpc <verified-extension-options>
```

`/opt/oma`는 OMA 설치 디렉터리의 RO mount다. 동봉 엔진·trusted core extension·model-facing CLI·role extension이 모두 그 아래 있으므로, OMA를 갱신할 때 rootfs를 다시 만들지 않는다. rootfs는 pinned Node/Git/shell/rg/library와 빈 mount target만 갖는다.

`/run/oma-sessions`는 엔진이 session을 쓰는 유일한 경로다. SB-006이 이미 그 내용을 model-origin data로 규정하므로 mount를 명시한다.

`--clearenv`가 환경 전체를 지우므로 trusted core extension이 읽는 `OMA_*`는 이 배열에 없으면 sandbox 안에 없다. builder는 caller가 준 이름/값을 검증하고(이름 문법, NUL 금지), `OMA_FRAME_BYTES`/`OMA_BATCH_MAX_MESSAGES`/`OMA_ACTOR`/`OMA_INCARNATION`를 마지막에 스스로 설정해 caller가 검증된 lease의 actor를 덮어쓰지 못하게 한다. host 환경은 상속하지 않는다.

**MUST [SB-002-C]** argv에 등장하는 host 경로는 위 mount 표를 통해서만 sandbox 경로로 번역한다. 어느 mount에도 속하지 않는 경로는 그대로 전달하지 않고 거절한다. 그렇지 않으면 host에서 검증된 파일이 sandbox 안에서 조용히 없는 파일이 되고, 설정 오류가 엔진 오류로 둔갑한다.

**MUST [SB-002-D]** 엔진의 agent directory(provider credential 보관처)는 Resident mount 계획에 넣지 않는다(PR-004). 따라서 봉인된 Resident는 credential이 없고 `--unshare-all`로 network도 없다. 이 조합에서 Resident는 provider에 도달하지 못한다. `INF-001`이 inference를 엔진에 넘긴 뒤 그 경로를 이어줄 relay가 없기 때문이며, 이 사실을 숨기고 credential이나 network를 조용히 열지 않는다. architecture §16에 비용과 선택지를 적는다.

**MUST [SB-002-E]** 설정 없이 시작한 society의 `installation.rootfs`는 `SB-007`의 생성된 rootfs다. 즉 기본은 봉인이다. 운영자가 `installation.rootfs`를 `/`로 명시하면 신뢰 rootfs가 없다는 선언이다(SB-001이 host `/` bind를 금지하므로 `/`는 rootfs가 될 수 없다). 그 배포에서 Resident는 봉인 없이 host에서 실행되며, runner는 시작할 때 그 사실을 한 줄로 보고하고 Dashboard가 같은 사실을 보인다. 봉인 부재를 기본값처럼 조용히 넘기지 않는다.

**MUST [SB-003]** stdin/stdout/stderr와 명시적으로 검증한 RPC pipe 외 상속 FD를 닫는다. runner admin FD, provider socket, host credential FD, systemd bus, SSH agent, desktop socket을 전달하지 않는다. OMA actor socket에는 자기 limited API만 존재한다. 다른 actor endpoint는 mount하지 않는다. rootfs의 기존 symlink/mount target이 다른 host path를 노출하지 않는지 검사한다.

**MUST [SB-004]** private network가 기본이다. provider는 actor inference stream→broker만 사용한다. dependency fetch 같은 egress가 필요한 project는 Human-configured proxy/cache profile에 한해 OPTIONAL로 노출하고 별도 S-01 escape 시험을 통과한다. 실패하면 host network 공유로 대체하지 않는다.

**MUST [SB-005]** candidate-check sandbox는 staged candidate checkout만 RW, trusted check assets RO, tmp cap, private network, no actor/admin/inference socket이다. Git quarantine은 필요한 broker objects만 RO와 자기 staging만 RW다. Principal tools는 public world/mail/Git RO+자기 scratch RW만 갖고 Human session directory는 없다.

**MUST [SB-006]** sandbox의 writable session/CLI files는 model-origin data다. 보안·effect completion의 증거는 trusted runner receipt와 broker ledger가 소유한다. 모델이 session JSON에 완료 문구를 써서 presented/approval을 위조할 수 없어야 한다. 이에 필요한 정확한 Pi receipt 검증은 S-03 gate다.

## 13. inference·quota·취소

**MUST [INF-001; arch §13.3]** inference는 **동봉 엔진이 소유한다.** OMA는 provider relay, credential store, model catalogue, 가격표, 재시도 정책을 따로 구현하지 않는다. 엔진이 이미 갖고 있는 흐름을 그대로 쓰며, 그 상태는 TUI-017의 OMA 소유 agent 디렉터리 안에 있다.

이 조항은 이전 판을 대체한다. 이전 판은 broker가 credential을 붙여 provider에 직접 요청하는 relay를 요구했다. 그 relay는 만들어지지 않았고 구현은 호출 경로 없이 남아 있었다. 문서와 코드가 어긋난 상태를 유지하는 것보다 실제 선택을 규범으로 확정하는 쪽을 택한다. 이 선택으로 provider codec·가격 upper bound·usage 회계를 gate하던 spike는 OMA의 대상이 아니게 되어 제거했다.

**MUST [INF-005; arch §16.1]** 봉인된 Resident의 provider 접근은 **byte relay**를 통한다. 이는 위 조항의 예외가 아니라 그 전제를 지키기 위한 transport다.

봉인된 Resident는 `PR-004`로 credential이 없고 `SB-004`로 network가 없다. 엔진이 inference를 소유하려면 그 둘 중 하나를 열어야 하는데, 여는 대신 credential을 sandbox 밖에 두고 바이트만 통과시킨다.

- host의 relay는 요청을 provider로 **해석 없이 전달**하고 헤더에만 진짜 credential을 끼운다. stream을 parse하지 않고, 응답을 재구성하지 않으며, 가격·token·context를 계산하지 않는다. 그 셋은 계속 엔진의 것이다.
- 목적지는 host가 선언한 model profile이 정한 provider endpoint뿐이다. caller가 URL·header·key를 고르지 못한다는 `INF-002`는 그대로다. 임의 URL proxy를 만들지 않는다.
- `INF-004`는 그대로다. relay는 결과가 불명확한 요청을 스스로 재전송하지 않는다.
- relay는 OMA가 다시 갖는 유일한 chokepoint다. 요청 수·동시성·취소를 관측하고 제한할 수 있으나, 보고되지 않은 비용을 0으로 간주하지 않는다.

**MUST [INF-006]** relay의 sandbox 쪽 끝은 bind-mount된 unix socket이며, network namespace는 계속 `--unshare-all`이다. trusted core extension이 sandbox 안에서 loopback listener를 열어 그 socket으로 넘기고, 엔진에는 그 loopback을 가리키는 provider를 등록한다. host와 sandbox 사이에 새 network 경로·CA·TLS 가로채기를 만들지 않으며, provider와의 TLS는 host쪽 relay가 소유한다.

**MUST [INF-008]** relay가 쓰는 credential은 **엔진이 해석한다.** runner는 동봉 엔진의 공개 SDK로 OMA 소유 agent directory에서 provider를 해석해 origin·key·추가 header를 얻고, 그 값은 한 delivery 동안만 relay에 있다. OMA는 엔진의 저장 형식을 읽지 않고, 해석 결과를 저장하지 않는다. `pi`/`current`는 엔진 설정의 기본 provider/model로 해석하며, 기본이 없거나 credential이 없으면 추측하지 않고 `UNSUPPORTED_PROFILE`로 거절한다.

sandbox에는 진짜 key와 **같은 모양의 자리표시자**를 준다. provider 코드는 key를 읽는다 — Codex는 OAuth token의 claim에서 계정을 찾고 Anthropic은 key의 접두사로 header 방식을 고른다. 그래서 서명된 token은 header와 claim을 유지하고 서명만 바꾸며, 접두사가 있는 key는 종류를 나타내는 짧은 접두사를 유지하고 나머지를 같은 문자 종류로 바꾼다. 자리표시자는 비밀을 포함하지 않고, 비밀에 포함되지도 않으며, 엔진이 환경 참조나 명령으로 해석할 모양(`$`, `!`, `${`)을 갖지 않는다.

relay는 자리표시자를 header 값과 request path에서만 진짜 key로 바꾼다. body는 model의 내용이지 credential 자리가 아니므로 읽지도 바꾸지도 않는다. 자리표시자를 담지 않은 caller의 인증 header는 버린다. WebSocket upgrade는 handshake에서 한 번 같은 규칙으로 고쳐 쓴 뒤 양방향 바이트로 나른다.

**MUST NOT [INF-007]** 엔진의 agent directory를 Resident mount 계획에 넣지 않는다. sandbox 안에 진짜 credential을 두는 어떤 형태도 — agent별 복사본, society 공용 read-only mount, 환경 변수 — `PR-004` 위반이다. sandbox 안의 provider 설정에 들어가는 key는 relay가 교체할 자리표시자다.

비용 상한을 OMA 계약으로 되돌리려면 relay가 stream을 해석해야 하고, 그것은 codec 소유를 다시 가져오는 별도 architecture 결정이다. 이 조항은 그 결정을 내리지 않는다.

**MUST [INF-002]** 모델·provider 선택은 host가 선언한 model profile 이름으로만 지정한다. caller가 arbitrary provider URL, header, key, 가격을 지정하지 못한다는 제약은 그대로다. 엔진이 profile을 해석하며 OMA는 그 해석을 다시 구현하지 않는다.

**MUST [INF-003]** Human private prompt body를 공개 mail, journal, operations, usage 필드에 기록하지 않는다. 이 금지는 relay 유무와 무관하게 유지된다.

**MUST NOT [INF-004]** 결과가 불명확한 inference를 자동 재전송한다. 취소가 과금 취소를 보장한다고 가정하지 않는다. 엔진이 보고하지 않은 비용을 0으로 간주하지 않는다.

**MUST [INF-005]** multi-agent 비용 상한은 이제 OMA 계약이 집행하는 값이 아니다. `quota`의 unit 관련 필드는 host가 선언하는 운영 의도로 남지만, 실제 과금 경계는 엔진과 provider 설정이 소유한다. OMA가 집행하지 않는 것을 집행한다고 표시하지 않는다.

`usage` 표와 여섯 durable entity는 DB-001 그대로 유지한다. persisted v1 schema를 이 변경으로 바꾸지 않는다. 그 표에 쓰는 주체가 없다는 사실은 [validation](implementation/validation.md)에 기록한다.

**MUST [INF-006]** performance 검증은 Astra 단독, cheap society 단독, Principal+society의 동일 task/tool 접근/성공 기준으로 수행한다. 품질·결함·Principal 및 전체 tokens·비용·latency를 각각 기록한다. Principal tokens 감소만으로 전체 비용/품질 우위를 주장하지 않는다. 자동 평가 threshold는 S-09에서 합의한다.

## 14. model-facing CLI와 파생 view

**MUST [CLI-001; arch §§9,14,23.2]** base model-facing command allowlist는 다음과 같다. 이 표는 Resident rootfs 안의 `oma` 실행 파일만 규정하며, host의 동명 TUI 실행 파일은 TUI-002가 별도로 규정한다. tiered의 추가 authority 문법은 S-08/S-10 gate이며 현재 허용된 것으로 추정하지 않는다. JSON wire method가 존재해도 새 subcommand를 자동 생성하지 않는다. `--help`는 현재 사용 가능한 명령만 출력하며 TUI나 Control Panel을 노출하지 않는다. Linux의 cat/head/tail/rg/find/git을 대체하는 preview/query language를 만들지 않는다.

| command | 의미·기본값 |
|---|---|
| `oma send <address...> --subject S --file P [--kind K] [--reply P] [--request K]` | default kind=message; approval_required 전용 identity flags는 PR-005; reply가 없고 to가 비면 오류; reply subject 생략 시 원문 Re: |
| `oma ack <mail-path-or-id> [--request K]` | 자기 delivery 명시 ACK |
| `oma follow <topic> [--request K]` / `oma unfollow <topic> [--request K]` | 자기 향후 topic routing |
| `oma agent create <name> --from <rev> --file <brief> [--request K]` | wire는 name/from/brief만; broker가 CREATE-002에 따라 profile/capabilities 확정 |
| `oma agent start <name> [--request K]` / `oma agent stop <name> [--request K]` | 허용 범위의 물리 lifecycle |
| `oma agent continue --note <text> [--request K]` | 자기 mail |
| `oma agent wait` | 현재 run 안전한 종료 요청 |
| `oma submit <revision> [--to address ...] [--subject S] [--file summary] [--path repo-path ...] [--request K]` | to default commons; revision 필수; summary 없으면 commit/ref metadata만 |
| `oma integrate <published-full-oid> --expect <full-oid> [--request K]` | project/main CAS |
| `oma context publish <dir> --expect <oid-or-none> [--request K]` | Principal 공유 의도 |
| `oma status [agent]` | scoped DB+systemd 관측 |
| `oma logs <agent> --since <duration>` | scoped journal text; duration은 양의 정수+s/m/h/d |

**MUST [CLI-002]** send/file/reply/summary 입력은 sandbox local 파일만 읽고 body bytes를 전송한다. host에 그 path를 읽으라고 RPC하지 않는다. summary/path를 생략하면 invent한 report 문서를 만들지 않는다. Git result는 즉시 사용할 published ref와 `git fetch origin <ref>`를 포함한다. 일반 성공 출력에 DB join·UUID 조합·state repair 단계를 요구하지 않는다.

**MUST [CLI-003]** CLI exit는 0=요청 접수 또는 읽기 성공, 2=검증/권한/확정 실패, 3=미접수 여부 또는 효과가 불명확한 통신/unknown, 4=지원 profile/SPIKE 미해결로 실행 불가다. pending을 0으로 반환할 때 첫 줄에 `접수됨 / 아직 완료되지 않음`과 same-key 재조회 안내를 표시한다. exit 0을 task 완료로 해석하지 않는다. JSON 출력 flag가 필요하면 기존 command의 공통 `--json`만 OPTIONAL로 제공하고 별도 command를 만들지 않는다.

**MUST [VIEW-001]** START는 identity/공유 GOAL·제약/자기 workspace/`/inbox.md`/주민·topic 목록 경로/send·submit·agent·status 사용만 기본 주입한다. 전체 schema·IPC·systemd·operation ledger를 prompt에 넣지 않는다. START와 inbox metadata는 숨은 system instruction authority가 아닌 trusted 안내와 untrusted peer metadata를 구분해 표시한다.

**MUST [VIEW-002]** agents.tsv는 `name,role,desired,profile` 열, topics.tsv는 `topic,subscribers` 열을 tab으로 구분하고 LF로 끝낸다. field의 탭/newline은 검증/escape한다. 시작 전 regenerate하고 mutation 후 atomic replace한다. status의 unit 관측에는 observedAtMs를 넣고 unknown/disconnected를 추정 running으로 표시하지 않는다.

**MUST [VIEW-003]** logs는 broker가 계산한 자기 society unit에 대해 `journalctl --user --unit <fixed-unit> --since <validated-time> --no-pager --output=cat`를 호출한다. user supplied raw journal args를 전달하지 않는다. operational log에는 event name/actor/op ID/error code/elapsed/byte count만 기록하고 mail body/Pi RPC stdout/provider payload/Human transcript를 기록하지 않는다. 1 MiB 기본 limit 초과 시 truncated를 표시하고 조용히 완전한 로그처럼 출력하지 않는다.

**OPTIONAL [OPT-INDEX]** notmuch는 archive만 indexing하며 DB의 delivery/batch/ack/approval를 소유하지 않는다. indexer는 같은 `/mail/archive` path mapping과 `/mail/index` RW를 사용하고 모델은 RO다. index 손상/지연은 mail delivery를 차단하지 않는다. index를 영속적인 routing/tag workflow로 사용하지 않는다. 정확한 version/config/atomic rebuild는 S-07 통과 시 활성화한다.

## 15. 오류 코드와 retry 계약

**MUST [ERR-001]** 모든 경계는 아래 closed code 또는 contracts.ts의 동일 enum을 사용한다. `INTERNAL_ERROR`로 업무 실패를 모두 덮지 않는다. error message는 설명이며 caller 분기는 code/retry/state로 한다. retry 값이 same-key여도 authority/현재 run을 다시 인증한다.

| code | 의미 | 자동 처리 범위 |
|---|---|---|
| INVALID_REQUEST, UNSUPPORTED_VERSION, UNKNOWN_METHOD, FRAME_TOO_LARGE, STREAM_INVALID | 형식·경계·stream 불일치 | 입력 수정; STREAM_INVALID preaccept만 동일 key 재전송 |
| AUTH_FAILED, STALE_RUN, CAPABILITY_DENIED | 신원·incarnation·위임 불일치 | 권한 우회/자동 증폭 금지 |
| REQUEST_KEY_REUSED, REQUEST_NOT_FOUND | 같은 key의 다른 payload / 해당 actor에 접수 기록 없음 | reused 거절; not-found면 동일 freeze payload 재접수 가능 |
| ADDRESS_NOT_FOUND, AGENT_CONFLICT, AGENT_NOT_READY, AGENT_RETIRED | routing/identity 문제 | 이름 자동 생성/대체 금지 |
| GOAL_REQUIRED | 공유 GOAL 전 실행 | context 게시 완료까지 대기 |
| LIMIT_EXCEEDED, STORAGE_FULL | resource/input/storage 경계 | 접수 전 실패; 이미 accepted는 pending 유지 |
| DB_BUSY, BROKER_UNAVAILABLE, DEADLINE_EXCEEDED | 일시 경합/연결/기다림 종료 | bounded same-key 조회/재시도; 새 key 금지 |
| STORE_CORRUPT | 원본/DB 무결성 위반 | mutation 중단, host 복구 |
| RUN_TERMINATION_UNKNOWN, START_LIMIT | 사망 확인 불가 / systemd rate limit | 새 run 발급 금지 / 명시 start·repair |
| PRINCIPAL_DISCONNECTED, ATTACH_CONFLICT | frontend 없음 / 중복 attach | mail 저장 유지, 모델 spawn 금지 |
| BATCH_CONFLICT, SESSION_BOUNDARY_UNCONFIRMED | 소유/snapshot 불일치 / receipt 불충분 | fence·재안내; presented 추정 금지 |
| INVALID_OID, CANDIDATE_NOT_PUBLISHED, BUNDLE_INVALID, PREREQUISITE_MISSING | Git 입력·공유 증거 문제 | ref/main 변경 금지 |
| PUBLISHED_REF_CONFLICT, REF_STATE_UNKNOWN | immutable ref 위반 / canonical 불일치 | 해당 mutation 중지, host 대조 |
| STALE_BASE, NOT_DESCENDANT | base 이동 / fast-forward 불가 | actual OID 반환; 모델이 새 후보 작성 |
| PROTECTED_PATH, CHECK_FAILED, POLICY_CHANGED | host 통합 조건 미충족 | workflow 우회/자동 승인 금지 |
| CANCELLED_BEFORE_COMMIT | stop 등으로 CAS 전 취소 확정 | 실패 receipt; 이미 변경된 ref를 되돌리지 않음 |
| CONTEXT_CONFLICT | 공유 의도 expected 불일치 | actual revision 반환; 자동 덮어쓰기 금지 |
| QUOTA_EXCEEDED, PROVIDER_FAILED, PROVIDER_OUTCOME_UNKNOWN | 예산/제공자 실패/비용 불명확 | reserve 보존, provider 자동 replay 금지 |
| UNSUPPORTED_PROFILE, SPIKE_UNRESOLVED | 플랫폼/검증 gate 미충족 | fail closed; backend 즉흥 추가 금지 |
| INTERNAL_ERROR | 분류되지 않은 구현 결함 | effect 상태 대조 전 retry 금지, 진단 ID만 공개 |

**MUST [ERR-002]** failed는 effect가 발생하지 않았거나 문서화한 terminal 실패가 확정된 경우다. 일부 공개 ref/mail이 생긴 뒤의 일시 장애는 pending으로 남긴다. unknown은 시스템이 effect 여부를 증명할 수 없을 때 사용한다. network timeout을 UNKNOWN Git ref로 단정하지 않고 broker가 실제 ref를 대조한다.

## 16. 복구·내구성·백업

**MUST [REC-001; arch §§17–19]** startup/reconcile은 정렬된 pending/unknown operations, 미materialized deliveries, prepared batches와 실제 filesystem/Git/systemd만 대조한다. 메모리 작업은 lost 가능하고 원본 query로 다시 선택한다. `queue_materialization`이라는 함수명은 새 durable queue를 허용하지 않는다.

**MUST [REC-007]** society broker는 R 아래 고정 lock file에 process-lifetime OS advisory lock을 획득한 뒤 DB를 연다. lock 미획득 시 두 번째 writer를 시작하지 않는다. PID file 숫자를 singleton 증거로 사용하지 않는다. Node lock/peercredential binding은 S-01로 검증한다. bootstrap/maintenance도 기존 broker 경계를 우회하여 DB/Git를 동시에 쓰지 않는다.

**MUST [REC-002]** reconcile timer는 reference 5초, AccuracySec=1초이며 모델을 호출하지 않는다. 한 sweep의 filesystem/provider 장애가 나머지 독립 mailbox 점검을 영구 막지 않도록 bounded work를 수행한다. 동시에 두 sweep을 실행하지 않고 이미 실행 중이면 기존 sweep에 합류/skip한다. no-progress retry는 로그와 next timer로 제한하고 tight loop를 만들지 않는다.

**MUST [REC-003]** 각 crash 지점의 복구는 [test matrix](implementation/test-matrix.md)의 oracle을 만족해야 한다. shutdown에서 새 mutation acceptance를 중단하고 진행 중 DB transaction을 마친 뒤 fd를 닫는다. 강제 kill을 피할 수 있다고 가정하지 않는다. SQLite commit과 Git ref update를 한 atomic transaction이라고 기술하지 않는다.

**MUST [REC-004]** process crash 보장과 power-loss 보장을 구분한다. file/dir fsync·SQLite FULL·Git object/ref flush·지원 filesystem/장치 계약을 S-06으로 검증하기 전 '전원 장애에도 유실 없음'이라고 표시하지 않는다. 지원 외 filesystem에서 자동 weak durability로 전환하지 않는다.

**MUST [REC-005]** backup은 host maintenance에서 mutation acceptance와 inference dispatch를 멈추고 active cgroup을 종료/확인한 quiescent 상태에서 수행한다. outstanding usage를 보수적으로 settle/unknown 처리하고 DB checkpoint/SQLite backup을 얻는다. DB와 참조 eml/Git/context/staging/runner receipts/Pi sessions/config를 같은 quiescent 시점으로 복사한다. provider secret은 별도 host credential backup 정책이다.

**MUST [REC-006]** restore는 새 runtime root에서 socket/lease를 재발급하고 systemd 상태를 재관측한다. index/view는 재생성한다. restore 후 main/context ref와 pending operation, mail object hash, FK를 검사하기 전 READY=1을 보내지 않는다. damaged DB를 빈 DB로 바꾸고 기존 mail/Git를 알아서 재발견하는 복구를 만들지 않는다.

## 17. 구현 순서와 merge/release gate

**MUST [ORDER-001]** 다음 순서를 따른다. spike blocker에 의존하지 않는 순수 schema/codec/mail 검증은 병행 작성할 수 있지만 stub 성공을 production 구현으로 merge하지 않는다. 각 단계에서 필요한 test가 통과해야 다음 통합 단계로 간다.

| 순서 | 구현 범위 | 완료 조건 |
|---|---|---|
| 0 | 기준 hash, negative requirements, source LOC manifest | 기존 native-v2 import 없음; 기준 변경 없음 |
| 1 | S-01/02/03/04/05/06 최소 executable spikes | 지원 platform/Pi/provider/flush/import 경계와 미결정 결과 기록 |
| 2 | closed DTO/schema/validator/store/request cache | DDL·FK·idempotency·framing/fuzz 시험 |
| 3 | Maildir/routes/materializer/views | 0/N fanout, cur 복구, public routing, parent effect gate |
| 4 | units/sandbox/run fencing/create/start/stop | systemd 실서비스, cgroup death, stop races, capability escape 시험 |
| 5 | Pi extension/runner/batch/Principal relay | tool result 보존, session-boundary, offline Principal, no auto commons injection |
| 6 | inference quota/provider/cancel | reserved slot, lineage cap, unknown accounting, private payload 비공개 |
| 7 | Git submit/integrate/context | hostile bundle, exact candidate checks, CAS races, ref/mail crash, GOAL activation |
| 8 | reconcile/observability/backup | 전체 fault matrix, clean restore, resource exhaustion |
| 9 | production audit 및 S-09 평가 | 필수 tests+spikes, LOC, packaging, no domain leakage |
| tiered 필수 | S-08/S-10, tier evaluator/attestation, integration mail/challenge/floor, HIGH 경로 | 확장 계약 POL-008과 T78–T90 통과 |
| 선택 | notmuch/reflink/egress/fresh-context verifier | S-07/S-11의 해당 optional gate 통과 |

**MUST [ORDER-002]** 구현 PR에는 변경 requirement IDs, source LOC 전후/모듈별 수치, 수행 tests, 남은 SPIKE, schema/method/state/service 변경 유무를 기록한다. 마지막 항목에 '있음'이면 기존 계약의 허용 확장인지 증명하고 아니면 architecture review를 요청한다. 구현 편의성만으로 새 entity를 승인한 것으로 간주하지 않는다.

**MUST [ORDER-003]** default Core release gate는 S-01~06 및 S-09의 요구 산출물, test matrix의 core cases, package/type/schema 검증, 실제 systemd+bwrap+Pi E2E다. S-07/S-11은 optional feature만 차단한다. 목표 tiered release는 S-08/S-10 및 T78–T90을 추가로 요구한다. base gate 통과만으로 현재 목표 아키텍처가 완료됐다고 표시하지 않는다. unresolved spike가 남은 adapter는 stub success 대신 SPIKE_UNRESOLVED로 명시적으로 실패해야 한다.

**MUST [ORDER-004]** performance가 목표에 미달하면 수치를 보고하고 모델/profile/배치 resource 설정을 평가한다. Principal의 필수 판단 경로 삭제·숨은 자동 요약 agent·task scheduler 추가로 평가를 통과시키지 않는다. 구조 변경은 별도 architecture 판단이다.

## 18. 제품 표면과 TUI

**MUST [TUI-001; arch §23.1]** OMA의 공개 UX와 명령 namespace는 OMA가 소유하고 Pi는 내부 실행 엔진이다. Pi command를 이름만 바꾼 wrapper를 만들지 않는다. 이 절은 새 durable entity, 새 daemon, 새 effect queue, 새 socket method, 새 model-facing subcommand를 도입하지 않으며 A-006/A-007의 제한을 그대로 받는다. TUI가 표시하는 모든 값은 기존 관측 경로에서, TUI가 일으키는 모든 변경은 기존 mutation 또는 host config 경계에서 나온다.

**MUST [TUI-002; arch §23.2]** `oma`는 두 개의 서로 다른 실행 파일이다. host 설치 PATH의 것은 Human TUI이고, Resident rootfs 안의 것은 CLI-001의 model-facing CLI다. 두 실행 파일은 argv 파서, capability, 연결 소켓, 설정 접근을 공유하지 않는다. 공유 가능한 것은 frame codec과 transport처럼 부작용과 권한이 없는 leaf뿐이다.

**MUST NOT [TUI-003]** host TUI의 실행 파일·소스·설정·소켓을 §12의 sandbox mount 목록에 추가한다. 설치 디렉터리를 통째로 mount하는 경우(`SB-002`) 배포 layout이 선언한 product surface 경로(`dist/src/tui`, `dist/src/entry/oma.js`와 그 원본)는 같은 mount 계획 안에서 가려야 하며, 가린 자리는 쓰기 가능한 공간이 되어서도 안 된다. Resident의 `--help`, 도움말 텍스트, 오류 메시지에서 TUI나 Control Panel을 발견할 수 없어야 한다. 모델이 host TUI가 여는 어떤 endpoint에도 연결할 수 없어야 한다.

**MUST [TUI-004; arch §23.3]** Principal Pi session은 OMA TUI가 소유하며 `pi --mode rpc`로 실행한다. Pi의 대화형 모드나 built-in UI를 사용하지 않는다. PR-001의 단일 attach, PR-003의 private context 보존, PR-004의 model-facing tool 제한은 이 entrypoint가 그대로 진다. Principal의 논리 identity는 bootstrap 때 만들고 TUI 실행 여부와 독립적으로 유지한다. TUI 종료는 새 Principal 생성의 trigger가 아니다.

**MUST [TUI-005]** Principal의 model 선택 대상은 host가 `HostConfigV1`에 선언한 model profile 이름뿐이다. caller는 provider, URL, header, credential, 가격, token 상한을 지정하지 못한다. 선택은 host authority를 고쳐 쓰는 것이므로 CFG-005의 policy revision 갱신을 동반하고, **다음 Principal session부터** 적용한다. 진행 중인 session이나 stream의 model을 바꾸지 않는다.

session 경계를 넘지 않는 per-request 전환은 Principal inference가 broker relay를 실제로 경유할 때만 의미가 있다. `principal.attach` handshake는 IPC-011로 확정되었으나 그 경로는 Principal inference의 relay 경유와 `src/inference.ts`의 frozen authority 검사 개정을 함께 요구하므로 현재 구현하지 않는다. 호출 경로 없이 선택 API만 추가해 구현된 것처럼 표시하지 않는다(TRACE-002). 전환이 예산을 넘기면 기존 INF-002/003의 예약 검사가 그대로 거절한다.

**MUST NOT [TUI-006]** 현재 model 선택, 읽음 상태, UI 위치, 최근 화면 같은 TUI 상태를 여섯 durable entity에 추가하거나 새 표·컬럼·sidecar 파일로 저장한다. 재시작 후에도 유지되어야 하는 선택은 host config의 해당 필드로 표현하고, 그 외 UI 상태는 A-007의 메모리 전용 runtime 상태로 두며 crash 후 원본에서 재구성한다.

**MUST [TUI-007; arch §23.6]** 값 확정 시 저장하고 별도 Save 단계나 dirty state를 두지 않는다. 편집 중 Esc는 확정 전 값으로 되돌린다. 화면은 각 항목의 **적용 시점**을 함께 표시한다.

| 변경 대상 | MUST 반영 시점 | 근거 |
|---|---|---|
| Resident 수 증감 | 즉시 | LIFE-001/003/004의 기존 mutation |
| role의 model profile 내용 | 다음 runner activation | runner가 activation마다 config snapshot을 읽음 |
| Principal model | 다음 Principal session | TUI-005 |
| slot 수, quota cap, pricing, protected path, check argv | broker 재시작 | broker가 시작 시 config를 고정 |

**MUST [TUI-008]** `initialResidents`에 대응하는 항목은 bootstrap seed로만 표시하고 실행 중 society의 Resident 수를 바꾸는 값으로 제시하지 않는다. LIFE-009에 따라 값 변경이 다음 재시작에 agent를 자동 생성·삭제·중지하지 않는다. 현재 Resident를 늘리거나 줄이는 조작은 설정 항목이 아니라 명시적 lifecycle 행위로 분리해 표시한다.

**MUST [TUI-009]** 이미 생성된 Resident의 `ResolvedAgentSpec.modelProfile` 참조는 LIFE-008에 따라 고정이다. 설정 화면은 참조가 가리키는 profile의 내용만 바꾸고 참조 자체를 바꾸지 않는다. 저장된 참조를 현재 배포가 해석하지 못하면 `UNSUPPORTED_PROFILE`로 차단하고 임의 profile로 대체하지 않는다. config 본문이 바뀌면 CFG-005의 policy revision을 새 값으로 갱신한다.

**MUST [TUI-010; arch §23.7]** Extensions 화면의 목록 출처는 host가 `installation.libdir` 아래에 이미 배치한 파일뿐이다. 임의 경로 입력, 자동 탐색, 네트워크 설치를 허용하지 않는다. core OMA extension은 항상 첫 항목으로 고정하고 해제할 수 없다. 선택한 항목의 SHA-256을 기록하고 실행 직전에 다시 확인한다. 추가 extension은 Pi host process와 동일 권한의 trusted deployment code이며 model tool로 취급하지 않는다. 이 화면은 host 전용이고 모델·workspace·mail 내용이 목록·선택·적용에 영향을 주지 못한다.

**MUST [TUI-011; arch §23.8]** Mail 화면의 읽지 않음 표시는 기존 `deliveries` flag에서 파생한 값이며 새 durable 상태가 아니다. ACK 조작은 MAIL-009의 의미만 갖는다. UI 문구가 `presented=understood`, `ack=approved`, `ack=읽음 완료`를 암시해서는 안 된다(NEG-002). 기본 대상은 Principal 수신 메일이며 commons/topic을 Principal prompt에 자동 주입하지 않는 A-003은 그대로 유지한다.

**MUST [TUI-012; arch §23.5]** Dashboard의 모든 수치는 VIEW-002의 관측 규칙을 따른다. 관측 시각을 함께 보유하고, unknown이나 disconnected를 running·0·성공으로 바꾸지 않는다. INF-004의 불확정 비용은 확정분과 구분해 표시하며 하나의 합계나 백분율로 뭉개지 않는다. broker에 연결하지 못하면 cached 값임과 관측 시각을 표시한다.

**MUST [TUI-013; arch §23.9]** 제품 UI는 Resident를 `worker`로 표시할 수 있으나 wire, DB, persisted 표현에는 사용하지 않는다. 표시 용어와 규범 용어의 대응은 한 곳에서 정의하고 계층마다 다시 만들지 않는다.

**MUST [TUI-014; arch §23.10]** Pi의 built-in command와 UI가 사용자 표면에 노출되지 않게 한다. 이는 사후 필터가 아니라 RPC-only 실행으로 달성한다. 오류 메시지, 도움말, 표시 경로에서 Pi 고유 명령 체계를 정상 사용 경로로 안내하지 않는다.

**MUST [TUI-016; arch §23.11]** OMA는 Pi 엔진을 함께 배포하고, 실행할 엔진을 이 설치본이 가져온 것으로만 해석한다. `PATH` 탐색과 `/usr/bin/pi` 같은 대체 경로 fallback을 두지 않는다. 엔진이 없는 설치본은 `UNSUPPORTED_PROFILE`로 실패하며, 어떤 Pi가 실행됐는지 불확실한 상태로 진행하지 않는다. 운영자의 명시적 pin은 허용하되 절대 경로여야 하고 존재하지 않으면 거절한다. 엔진 entry는 동봉 패키지가 선언한 `bin`에서 읽고 저장소가 경로를 추측하지 않는다.

**MUST [TUI-017]** 실행하는 엔진에는 OMA가 소유한 agent 디렉터리를 지정한다. 지정하지 않으면 엔진이 사용자의 `~/.pi` 설정·extension·session을 공유하므로, 사용자가 별도로 설치한 Pi와 상태가 섞인다. 이 디렉터리는 society state root 아래에 두어 backup/restore와 삭제가 나머지 OMA 상태와 같은 경계에서 다뤄지게 한다.

동봉 엔진의 상태는 전적으로 이 디렉터리에 둔다. 사용자의 Pi 상태를 읽거나 쓰지 않으며, 사용자 Pi 설치 여부에 동작이 달라지지 않는다. 자격 증명·모델 선택은 동봉 엔진이 자기 메커니즘으로 이 디렉터리 안에서 처리하므로 OMA가 별도의 인증·모델 관리 표면을 만들지 않는다.

**MUST [TUI-019]** 설정 파일 없이 동작한다. 초기화 명령을 요구하거나 사용자가 `HostConfigV1`을 작성하게 만들지 않는다. society 이름이 없으면 실행 디렉터리에서 유도하고, 설정이 없으면 실제 설정 파일을 만든 뒤 계속한다.

자격 증명·모델 선택·그 기억은 **동봉 엔진이 이미 갖고 있는 흐름**이므로 OMA가 다시 만들지 않는다. 기본 model profile은 엔진의 현재 연결로 해석되는 값이며 OMA는 provider나 credential을 스스로 주장하지 않는다. 남는 것은 society·role capability·multi-agent 예산처럼 엔진에 개념이 없는 OMA 고유 영역이고, 여기에 보수적인 값을 쓴다. 생성값은 bounded하고 디스크에 기록되며 Control Panel에서 수정 가능해야 한다. Resident에게 `code.integrate`를 기본으로 주지 않는다.

**MUST [TUI-020; arch §23.13]** 엔진이 이미 소유한 산술·프로토콜 프리미티브를 다시 구현하지 않는다. 빌려오는 프리미티브마다 소유 모듈을 하나로 두고 그 목록을 실행 가능한 검사로 고정한다. 동시에 엔진의 레이아웃·절단·스타일링을 제품 화면에 들여오지 않는다. 표현은 제품이 소유한다.

중복을 남기기로 판단한 경우는 근거를 규범에 남긴다. 현재 남긴 것은 byte framing과 유닉스 소켓 클라이언트이며, 이유는 그 위의 OMA 정책 계층이 어차피 존재하고 설치 표면을 늘리지 않기 위해서다.

**MUST [TUI-021]** Dashboard의 broker 유래 값은 broker가 게시하는 **host 전용 status view**에서 읽는다. `status.get`은 agent unit 안의 호출자에게만 답하고 사람이 띄운 터미널은 어떤 unit 안에도 없으므로, 그 method를 부르거나 TUI 전용 socket method를 추가하지 않는다(`IPC-012`). view는 state root 바로 아래의 `0600` 파일이며 `world/`에 두지 않는다. broker는 view를 갱신 시점마다와 짧은 주기로 다시 쓰고, 멈출 때 지운다. view는 관측 시각을 담는 파생물이지 기록이 아니다. 읽는 쪽은 없음·손상·다른 society·주기의 몇 배를 넘은 오래됨을 모두 이유와 시각이 붙은 `unknown`으로 보이고, 부분만 보이거나 0으로 바꾸지 않는다. 형식·경로·주기는 한 모듈이 소유한다.

**MUST [TUI-022]** `oma`는 society를 실행 디렉터리에서 유도하므로 그 society는 그 프로젝트를 다룬다. canonical `main`은 첫 시작에서 프로젝트의 **커밋된 `HEAD`**로 시작한다. 가져오는 것은 clone이 가져오는 커밋 이력뿐이며 커밋되지 않은 변경과 추적되지 않는 파일은 가져오지 않는다. 가져오기는 trusted Git 환경(hook 없음, 사용자·시스템 설정 없음)에서 하며, 첫 시작 이후에는 디렉터리의 새 커밋이 canonical 이력을 움직이지 않는다 — 그 뒤 canonical 저장소는 OMA의 integration으로만 움직인다. 저장소가 아니거나 커밋이 없는 디렉터리는 빈 root commit으로 시작하고, 어느 쪽이었는지를 사용자에게 한 번 말한다.

**MUST NOT [TUI-018]** 동봉한 엔진을 수정해 제품 동작을 만든다. OMA의 동작은 신뢰된 core extension이 소유한다. 수정하지 않은 동봉 엔진은 upstream 의존이므로 A-008/A-009의 production LOC 계산 대상이 아니며, 엔진을 수정하는 순간 LOC-003에 따라 계산 대상이 되고 A-008 기준을 다시 검토해야 한다.

**MUST [TUI-015]** TUI는 릴리스 gate의 예외가 아니다. 이 절의 요구도 TRACE-002에 따라 단일 production owner, 실제 entrypoint에서의 call path, negative executable test, 현재 revision의 실행 증거를 갖는다. TUI 소스는 A-008/A-009의 production LOC 측정 대상이며 별도 budget으로 분리하지 않는다.

## 19. Extension tool 표면 투영

**MUST [TSP-001; arch §23.12]** role의 tool 표면 투영은 `DIRECT`/`DISABLED`/`GROUPED` 세 모드와 group DAG로 닫는다. group member는 `{tool}` 또는 `{group}`의 명시 참조뿐이며 접두사·정규식·의미 기반 매칭을 도입하지 않는다. 다음은 모두 거절한다: 중복 group 이름, 자기 참조, cycle, 알 수 없는 group/root 참조, 한 tool의 중복 소속, disabled tool의 group 소속, 같은 tool의 direct/grouped 동시 지정, group 이름과 tool selector 충돌, 이름 문법 위반.

**MUST [TSP-002]** 투영 선언은 [operations 설정](operations/README.md)의 role 파일에 둔다. 기존 닫힌 `HostConfigV1`, wire schema, ledger schema, DB entity를 확장하지 않는다. 선언은 **설정을 읽는 시점에** 검증하고, 위반은 `INVALID_REQUEST`로 config 로드를 실패시킨다. 검증되지 않은 선언을 sandbox로 전달하지 않는다.

**MUST [TSP-003]** 투영은 bounded다. group 32개, group당 member 16개, 중첩 깊이 4, 선언 이름 총 512개, group description 512 bytes를 기본 상한으로 하며 host는 더 낮출 수 있다. 상한 초과는 접수 전에 거절한다.

**MUST [TSP-004]** 검증과 평탄화의 단일 owner는 `src/domain/tool-surface.ts`다. group 해석·cycle 검출·root 유도를 sandbox 안이나 다른 계층에서 다시 구현하지 않는다. sandbox로 전달되는 것은 이미 검증된 평탄한 plan이다.

**MUST [TSP-005]** 활성 tool 집합은 다음 산술로 정한다. `disabled`는 항상 비활성, `grouped`는 소속 group을 열기 전까지 비활성, `direct`는 활성, 그 외 등록된 tool은 `defaultMode`를 따르며, root group은 활성으로 시작한다. `defaultMode`는 `DIRECT`와 `DISABLED`만 허용한다. role이 투영을 선언하지 않으면 등록된 tool을 그대로 보여준다.

**MUST [TSP-006]** group을 여는 것은 **활성화이며 실행이 아니다**. 직계 자식만 기존 활성 집합에 합집합으로 더하고, 같은 group을 다시 열어도 결과가 같아야 한다. 다른 extension이 활성화한 tool을 제거하지 않는다. OMA가 다른 extension의 tool handler를 대신 호출하거나 인자를 재해석하는 경로를 만들지 않는다. 드러난 tool은 Pi의 기존 pipeline이 실행하므로 tool_call/tool_result, 권한·safety 훅, 원본 schema, 실행 모드가 보존된다.

**MUST [TSP-007]** sandbox가 받은 plan을 읽을 수 없거나 형식이 맞지 않으면 fail closed한다. 모르는 값은 무시하고 진행하는 것이 아니라 OMA 자신이 등록한 tool만 남긴다. 투영 적용 실패가 `DISABLED`로 의도한 tool을 노출시키는 결과로 이어져서는 안 된다.

**MUST [TSP-008]** 투영은 OMA가 등록한 mail/status tool을 제거하지 못한다. role 선언이 그 이름을 disabled로 지정해도 활성 상태를 유지한다. 투영이 agent를 자기 협업 수단 없이 남기지 않는다.

**MUST NOT [TSP-009]** 투영을 권한 경계로 표시한다. 실제 권한은 §12의 sandbox mount/FD/network와 AUTH-001의 capability가 정한다. 표면에서 감췄다는 이유로 위험한 tool을 role extension에 추가하거나, PI-001의 신뢰 경계·operations의 SHA-256 재검증을 완화하지 않는다.

**MUST NOT [TSP-010]** 투영을 위해 extension을 동적으로 로드한다. role extension의 로딩과 검증은 기존 operations 계약과 Pi의 `-e` 경로가 소유한다. 임의 경로 import, cwd 기반 설정 탐색, 자동 탐색을 추가하지 않는다. 투영은 이미 등록된 tool의 표면만 다룬다.

## 20. architecture 추적 및 최종 금지 확인

**MUST [TRACE-002]** 모든 적용 runtime MUST/MUST NOT은 release 시 requirement→단일 authoritative production owner→실제 entrypoint/call path→negative executable test→현재 source revision의 실행 evidence를 갖는다. 타입/enum/comment/helper/mock만 존재하면 implemented/proven이 아니다. [compliance 계약](implementation/compliance.md)의 파일을 release 산출물로 유지하며 runtime durable state로 만들지 않는다.

**MUST [TRACE-003]** spec 위반이 기존 requirement에 이미 금지돼 있으면 동의어 requirement를 더 만들기보다 production-path negative test와 trace를 연결한다. 계약·기계 검증과 production 통과 증거를 분리하고 누락은 unverified/blocked로 표시한다. source/spec/adapter 변경 뒤 옛 evidence를 자동 재사용하지 않는다.

**MUST [REC-008]** bootstrap/create/start/stop/batch/check의 canonical 순서는 [physical-ordering.md](implementation/physical-ordering.md)를 따른다. constructor/import에서 DB open 또는 외부 effect를 실행하지 않는다. lock 확보 전 SQLite migration/reconcile을 시작하는 숨은 호출 경로를 금지한다.

**MUST [TRACE-001]** 다음 mapping으로 상위 규범 보존을 review한다. 추가 필드·검사·순서는 물리 경계 상세화이며, 새로운 철학/업무 protocol을 도입하는 근거가 아니다.

| architecture | 이 계약 |
|---|---|
| §§1–2 stack/topology | A, M, UNIT, SB |
| §§3–5 주소/파일/배달 | ID, FS, MAIL, DB, IPC |
| §§6–7 lifecycle/Pi | UNIT, LIFE, RUN, PI, BATCH; S-01/03 |
| §§8–9 Principal/attention | PR, CTX, CLI, VIEW |
| §§10–12 Git/review | GIT, INT, APP, 확장 TIER/PUB/CHAL/VERIFY; S-05/08/10/11 |
| §§13–14 auth/usage/DB | AUTH, INF, DB, IPC; S-01/02 |
| §§15–19 recovery/isolation | LIFE, SB, REC, ERR; S-06 |
| §§20–22 implementation/evaluation | ORDER, TRACE, test matrix; S-09 |
| §23 제품 표면/TUI (§18) | TUI; CLI-001 분리, PR-001/004, INF-001, CFG-005; S-02 |
| §23.3 엔진 동봉/공존 (§18) | TUI-016/017; PI-001, A-008 |
| §23.10 tool 표면 투영 (§19) | TSP; PI-001, CFG-005, SB-003 |

**MUST NOT [NEG-001]** LLM이 sender·thread·ref·mail ID를 join하여 runtime 상태를 복원하게 한다. broker/view가 바로 읽고 실행할 경로를 제공한다. 내부 ID는 debug/명시적 retry에만 필요한 만큼 노출한다.

**MUST NOT [NEG-002]** `presented=understood`, `ack=approved`, `submit=merged`, `agent_end=task_done`, `principal=Human`, `more_agents=independent_reviews`, `timeout=failed`, `same_OID=same_request` 등식을 구현한다.

**MUST NOT [NEG-003]** role label을 업무 ownership lock으로 사용한다. file ownership board·focus lease·작업 수락 단계·모든 변경 mandatory review workflow를 만들지 않는다. 사회의 조정은 공개 mail/상호 요청/Git evidence이고 runtime은 권한 및 물리 조건만 강제한다.

**MUST NOT [NEG-004]** 정확한 turn 재현, 자동 tool replay, 의미적 mail dedup, private peer mail, multi-host failover, external push/deploy, 자동 GC를 Core v1의 숨은 부가 기능으로 넣는다. 필요한 경우 상위 architecture에 별도 요구로 제안하고 이 계약 범위 밖으로 표시한다.

**MUST [NEG-005]** 구현자가 모호함을 발견하면 관련 requirement/source 절, 충돌하는 두 해석, 최소 재현/실험, 차단 범위를 적어 SPIKE에 추가한다. 그 과정 자체가 새 runtime entity나 workflow를 만들 권한은 아니다. 충분히 확정된 나머지 계약은 계속 구현한다.
