# OMA Core v1 — 구현 계약

이 문서는 core 구현 계약의 단일 owner다. physical ordering·Store opening·contract owner·unit renderer 계약을 뒤쪽에 모았다. 기존 요구 ID와 의미는 유지한다. 고정 architecture와 달라진 수용 결정은 [design-revisions](design-revisions.md), 실제 실행 여부는 [validation](implementation/validation.md)이 소유한다. 미채택 merge/review 설계안은 [보관 기록](archive.md)에 분리했다.

문서 상태: **현재 구현 계약**. 최초 작성: 2026-09-07. 열린 spike의 설계 선택은 DR18에서 정했으며, 미지원 경로는 거절한다. 실제 구현·실행·release qualification의 완료 여부는 validation을 따른다.

**MUST [N-001]** 구현의 상위 규범은 [docs/architecture.md](architecture.md)이며, WP01 D01–D06, DR41 모듈 경계 및 DR45의 기존 Mail 표면 변경 대조 후 이 계약의 기준본 SHA-256은 `8de5ea0c6c632fa7e09e8188d7035cf94aa3165fdfeb122631af3f39bee132c7`이다. 구현 시작 및 release 때 기준본 hash를 확인한다. hash 변경 시 이 계약을 자동 적용하지 않고 차이를 검토한다.

DR45 대조는 이전 기준본 `39613e469209210632007e5f8f91293ff288dc2785dcda010b62f55fe7250e88` 이후의 §23.11 변경 한 건이다. 기존 커밋 `d18f62d1`의 society 전체 공개 메일·실제 발신자·파생 자동 공지 표시를 해당 구현과 대조했다. Principal prompt 전달 범위와 durable 사실의 소유권은 유지하며, 이번 수정에서 architecture 원문은 변경하지 않았다.

이전 기준본 `7588b31e7518ded1d439f604400ca0984cccd30936428e00eac03b6032f29fab`까지의 링크/제품 표면 변경 기록은 Git history에 보존한다. 이번 WP01은 §6 mode별 runtime gate, §7 exact old receipt 정산 순서, §12 no-op과 applied CAS 구별, §23 project binding 및 실제 적용 시점을 [D01–D06 결과](implementation/consistency-decisions.md)와 대조했다. runtime source가 이 변경을 이미 만족한다는 뜻이 아니며 지정 WP의 regression/runtime evidence 전에는 그 차이가 해소되지 않는다.

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
| [packages/storage/src/schema-v4.sql](../packages/storage/src/schema-v4.sql) | 여섯 기본 DB entity의 실행 가능한 초기 DDL |
| [docs/implementation/integration-policy.md](implementation/integration-policy.md) | 제안 검토·tiered authority·challenge/floor·Principal packet 계약 |
| [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) | 모듈 및 closed IPC 타입 계약. 실행 코드 아님 |
| [docs/verification-spec.md](verification-spec.md#qualification-계약) | 미확정 부분, 실험, release gate |
| [docs/verification-spec.md](verification-spec.md#oma-core-v1--검증-계약) | 기능·장애·격리·수용 시험 |
| [unit renderer 계약](implementation-spec.md#unit-renderer-계약) | 설치 renderer에 입력할 unit template |
| [docs/implementation-spec.md](implementation-spec.md#production-physical-effect-ordering) | production 호출 경로의 canonical 물리 순서 |
| [docs/verification-spec.md](verification-spec.md#requirement--production-path--executable-evidence) | requirement→owner→entrypoint→실행 증거 release gate |
| [docs/verification-spec.md](verification-spec.md#production-원본-목록과-loc-측정) | 공백/주석 제외 LOC 계산 계약 |
| [docs/implementation/validation.md](implementation/validation.md) | 이번 산출물 검사 결과와 검증하지 않은 범위 |

**MUST NOT [N-005]** 이 문서의 존재, DDL 검사 통과, TypeScript 타입 검사 통과를 runtime 구현·end-to-end 검증·전원 장애 내구성 증명으로 표현하지 않는다.

## DR49 native 적용 범위

DR49·DR56에서 폐기한 물리 구현의 문장과 ID는 과거 계약의 뜻으로 남긴다. 현재 제품은
[현재 native 계약](macos-platform.md)의 NATIVE-001–023을 적용한다. 고정 architecture의
원문이나 과거 accepted 기록을 새 실행 substrate에 맞춰 재해석하지 않는다.

| 이 문서의 물리 reference | 현재 적용할 계약 |
|---|---|
| A-001의 Linux 전용 배치, M-002의 units.ts, S-01의 systemd pin | NATIVE-001/007/008의 공통 TS 모듈·공개 DAG 및 실제 OS qualification |
| FS-001의 unit path 렌더링, FS-006의 systemd 관측 원본 | NATIVE-003/011/016의 held 파일 capability·관측 journal·진단 spool. 관측은 accepted fact나 현재 권한의 원본이 아님 |
| DB-005/007·CREATE·LIFE의 unit 설치 및 path 활성화 세부사항 | NATIVE-009/013/015/018. 새 version3 native intent, 공통 Resident 슬롯·wake와 실제 scope 사망. 과거 version2 intent는 원래 뜻으로 보존 |
| IPC-011/012·AUTH의 unit/cgroup 인증 수단 | NATIVE-014의 pinned scope·private runner socketpair·per-range sender 판정. 기존 메서드의 폐기 여부는 현재 closed method registry를 따름 |
| CTX-006·UNIT-*·UNIT-TPL-*의 path/service/relay/renderer | NATIVE-009/011–014/018. 아래 역사 unit 절은 현재 설치나 실행의 fallback이 아님 |
| SEQ-002 표의 daemon-reload/LoadState/cgroup/path/service 단계 | NATIVE-018의 native 물리 순서. accepted transaction·receipt 정산·현재 권한 재검사·unknown 보존은 계속 적용 |

## 1. 고정된 구조와 구현 권한의 한계

**MUST [A-001; arch §§1–2,8,21]** 단일 Linux host, society당 broker 프로세스 하나, 논리 Resident당 지속 private clone 하나, 활성 Resident당 trusted runner 하나와 sandbox 내부 Pi RPC session 하나를 구현한다. Principal은 기존 Human Pi session에 연결한다. broker 안의 mail/Git/inference/reconcile은 모듈이며 별도 daemon이 아니다.

**MUST [A-002]** Principal은 공유 목표의 해석·어려운 판단·최종 종합을 담당하고, Residents는 조사·구현·검증·동료 협업을 자율적으로 수행할 수 있어야 한다. Principal에게 일상적인 배정·투표 집계·라우팅·통합의 독점 권한을 부여하지 않는다. `code.integrate`는 host 위임에 따라 Resident에게도 부여할 수 있다.

**MUST NOT [A-003]** commons/topic mail, 전체 tool transcript, 모든 submit을 Principal prompt에 자동 주입한다. `principal` 명시 수신, 공유 context, 기존 Human 대화만 해당 경로의 입력으로 사용한다. Principal mailbox가 있다는 이유로 별도 고가 모델 session을 생성하지 않는다.

**MUST NOT [A-004]** Board / Artifact / Focus / Change / Review / Cognition entity, ID 체계, lifecycle, event reducer, repository abstraction을 native-v2에서 가져오거나 이름만 바꾸어 재현한다. `Message`, Git commit, `batch`, `operation`을 task/approval/cognition object로 확장하지 않는다.

**OPTIONAL [A-005]** 기존 코드의 sandbox argv 구성, Git 실행 wrapper, provider transport, Pi bridge 같은 physical leaf만 재사용 후보로 검토한다. 후보는 입력/출력·오류·권한·외부효과를 이 계약에 맞춰 독립 테스트해야 한다. 기존 domain module import, 기존 durable schema 의존, native-v2 workflow callback이 남으면 후보를 거절한다. 재사용은 허용일 뿐 의무가 아니다.

**MUST NOT [A-006]** 다음을 승인된 architecture 변경 없이 추가한다: durable entity/table/sidecar database, task queue, durable outbox, event bus, message acknowledgement workflow, lease service, scheduler model, manager agent, daemon, custom Git server, SMTP/IMAP, distributed consensus, automatic semantic summarizer, autonomous repair LLM, 새로운 model-facing subcommand. `operations`와 `deliveries` 외에 effect queue를 만들지 않는다.

**MUST [A-007]** base의 허용 durable state는 §4의 allowlist와 여섯 DB entity뿐이다. 목표 tiered에는 POL-006의 authenticated attestation/최소 floor metadata만 추가 허용하되 S-08/S-10의 DDL·migration 계약 확정 전 임의로 저장소를 추가하지 않는다. JSON column을 이용해 숨은 task entity나 범용 key/value store를 만들지 않는다. 파일이 작다는 이유로 이 제한에서 제외하지 않는다. 런타임용 process handle, socket map, mutex, FIFO inference waiter, cache는 메모리에만 둘 수 있으며 crash 후 원본에서 재구성한다.

A-008은 2026-09-28 사용자 결정으로 철회했다([DR20](design-revisions.md#dr20--loc-크기-제한을-폐지하고-측정의-진실성은-유지한다)). production LOC 목표·상한·크기에 따른 architecture review 및 release 차단은 없다. 이 ID를 다른 요구로 재사용하지 않는다. 원본 목록과 측정의 진실성은 A-009와 LOC 계약을 따른다.

**MUST [A-009]** LOC는 공백 줄과 comment-only 줄을 제외한 source code line 수다. 코드와 inline comment가 함께 있는 줄은 code 1줄로 센다. production manifest의 모든 원본을 [LOC 계약](verification-spec.md#production-원본-목록과-loc-측정)의 pinned cloc 방식으로 계산한다. 주석을 포함했던 이전 정의는 폐기한다. minify·한 줄 몰아쓰기·vendor 이동으로 회피하지 않는다. 측정값은 정보이며 크기에 따른 합격·불합격 또는 release 조건이 아니다.

## 2. TypeScript 모듈과 의존성

**MUST [M-001]** application/extension/CLI/runner는 TypeScript로 작성하여 고정된 Node.js runtime에서 실행한다. Pi extension도 TypeScript다. Python supervisor, shell 업무 engine, 별도 Go/Rust broker로 대체하지 않는다. syscall에 필요한 최소 native leaf의 필요성·binding은 `S-01`로 검증한다.

**MUST [M-002]** 모듈 경계는 다음 표와 [contracts.ts](../packages/contracts/src/index.ts)를 따른다. 같은 책임의 파일 분할은 허용하지만 공개 서비스·권한·durable entity를 늘리지 않는다. 실행 파일 entrypoint는 조립만 하고 로직을 중복하지 않는다.

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

**SPIKE [S-01]** Node/Pi/SQLite binding/Git/systemd/bwrap/email library/rootfs의 정확한 version과 배포 방식은 플랫폼 검증 결과로 pin한다. 버전 번호를 이 계약에서 추측하지 않는다. pin 결과는 host 배포 manifest이며 새 운영 상태 DB가 아니다. 판정([DR18](design-revisions.md)): pin은 validation이 기록한 배포 manifest다.

## 3. 신원·이름·설정·권한

**MUST [ID-001]** society와 Resident 이름은 ASCII `[a-z][a-z0-9-]{0,31}`이고 topic은 `[a-z][a-z0-9-]{0,63}`이다. `principal`, `commons`, `residents`, `topic`은 Resident 이름으로 금지한다. 이름은 생성 후 바꾸거나 재사용하지 않는다. actor의 role과 capability는 연결 인증에서만 얻는다.

**MUST [ID-002]** operation/batch ID는 prefix `op-`/`b-`와 소문자 UUIDv4이고, message file ID는 `m-<operation UUID>-<ordinal>`이다. ordinal은 0부터이며 한 operation의 message plan에서 고정한다. Message-ID는 `<file-id@society.oma.invalid>`다. request key는 CLI 생성 UUID 또는 `--request`의 `[A-Za-z0-9._-]{1,96}`이고 actor 범위에서 유일하다. ID를 모델이 수동 생성할 필요는 없다.

**MUST [ID-003]** Git OID는 repository의 object format에 맞는 full lowercase hex만 wire에서 받는다. symbolic revision은 CLI가 freeze한 뒤 전송한다. hash 길이를 SHA-1 40자로 고정하지 않는다. wire path는 `/` 구분 상대 경로이고 NUL, `.`/`..` component, 절대 경로를 거절한다.

**MUST [CFG-001]** DR46: `config.json`은 host가 소유하는 폐쇄된 schema 3 `HostConfig`다. society, trusted rootfs/install path, pinned deployment digest, model/agent profile, 초기 Worker, protected path와 candidate check, policy revision, 실제 protocol 한계를 검증한다. 이전 schema와 삭제된 quota/egress 필드, 미지 profile 필드는 명시적으로 거절하며 자동 변환·덮어쓰기·삭제하지 않는다. secret은 설정에 저장하지 않고 실행 시 엔진/host credential owner가 해석한다.

**MUST [CFG-002]** model과 기능성 검사 명령은 host 설정으로 정하고 전체 validator로 확인한다. 명시한 빈 검사 목록은 허용한다. DR37/DR46: 이 조항의 과거 quota 금액·provider 가격·화폐 계산 요구는 폐기했다. 과금은 엔진과 provider 설정이 소유하고 OMA는 효과 없는 quota 필드를 받지 않는다.

**MUST [CFG-005]** `@oma/contracts/host`의 `HostConfig`와 `@oma/config`의 단일 validator가 현재 설정 schema 3를 소유한다(DR46). 숫자는 유한한 safe integer이고 각 실제 descriptor의 범위를 따른다. `protectedPaths`는 glob이 아닌 repository 상대 literal path 또는 `/`로 끝나는 subtree prefix다. diff의 추가/수정/삭제 양쪽 path를 모두 검사한다. D02: 전체 후보를 loader와 동일한 validator로 검사하고 host/model/role/prompt/extension 선택의 의미가 바뀌면 새 policy revision을 지정하여 outstanding integrate가 재검사하게 한다. 비교에서 revision 자체를 제외하고 공백·동일 의미 재저장은 policy 변경으로 만들지 않는다. generation identity와 policy revision은 별개이며 이미 접수한 bytes와 hash의 의미는 바꾸지 않는다.

운영 파일 분리는 authoring 입력 `kind: "oma-operations-v1"`로 제공한다. host가 명시한 한 manifest snapshot에서 폐쇄형 HostConfig과 source layout을 함께 조합·검증한다. 수동 bundle의 다중 파일 동시 편집은 지원하지 않는다. D02의 관리형 편집은 immutable generation을 완성·flush한 뒤 기존 manifest를 마지막에 replace/parent-fsync하며, expected-version 비교부터 publication까지 한 owner가 직렬화한다. outcome-unconfirmed에서는 재관측 전 overwrite/rollback하지 않는다. role prompt는 index-root 기준이고 metadata는 wire·ledger schema나 실행 권한을 확장하지 않는다. 변경은 다음 해당 역할 engine 시작에 새 snapshot으로 읽고 accepted evidence는 다시 쓰지 않는다. 동일 빌드 reader lease·bounded retention·명시 export는 유지한다. DR46의 journal은 `committed-v2` 하나이며 이전 `committed`가 있으면 startup·edit·collection을 거부한다. 이전 빌드 호환은 제공하지 않으며 실제 지원 여부와 수동 형식의 제한은 [운영 설정 안내](operations.md)에 구분한다. 추가 extension 실행에는 기존 PI/deployment 검증 gate가 그대로 적용된다.

**MUST [CFG-003]** wire resource 기본값은 frame 256 KiB, mail body 256 KiB, subject 512 UTF-8 bytes, logical address 64개, reply reference 64개, context 파일 256개/합계 8 MiB, bundle 256 MiB, logs 1 MiB, accepted connection당 미완료 control request 1개다. host는 명시적으로 낮추거나 높일 수 있고 모든 endpoint에서 같은 값으로 검증한다. 이 값은 전용 preview 기능이나 본문의 자동 절단 규칙이 아니다. 초과 입력은 접수 전에 거절하고 파일/Git 사용을 안내한다.

**MUST [CFG-004]** 프로토콜 timeout 기본값은 frame/stream 무진행 30초, control receipt 기다림 30초다. 결과를 기다리다 timeout이면 해당 effect는 실패로 간주하지 않는다. 대규모 작업은 pending receipt 후 같은 key로 조회한다. inference timeout/output cap/가격 bound는 provider profile에 필수로 둔다.

**MUST [AUTH-001]** 기본 capability 집합은 `mail.send`, `route.follow`, `agent.create`, `agent.manage.self`, `agent.manage.descendants`, `git.submit`, `code.integrate`, `context.publish`로 닫는다. Principal role은 자동 `code.integrate`/Human approval 권한이 아니다. 일반 Resident에게 `context.publish`를 주지 않는다. 자식 권한은 부모의 위임 가능한 부분집합과 host profile의 교집합이다. 단 `code.integrate`는 agent가 위임하지 않고 host가 profile로 직접 준다(A-002, [DR4](design-revisions.md)): 자식 profile에 있으면 부여하고 부모의 보유·delegable은 이 권한에 효과가 없다. 기본 profile은 이 권한을 어디에도 주지 않는다.

**MUST [AUTH-002]** 관리 요청은 self 또는 `created_by` ancestry상의 descendant에만 해당 capability로 허용한다. Principal은 별도의 host 위임 범위 안에서 관리한다. sibling 정지·권한 증폭·자식 생성으로 quota 우회는 거절한다. status와 public operational logs 읽기는 사회 구성원에게 허용하되 host journal/secret은 제외한다. operation.get과 operation.read는 자기 actor의 key만 조회한다.

**MUST [AUTH-003]** per-incarnation pathname listener에 actor를 고정하고 pinned connector, 각 수신 byte range의 실제 kernel sender, 현재 invocation의 pinned execution scope 및 trusted runner ancestry를 검증한다(DR49). Runner 관리 연결은 직접 spawn owner가 인계한 private socket과 immutable grant를 요구한다. 같은 UID, payload actor, 환경 변수, scope처럼 보이는 문자열, 양도받은 socket의 소지만으로 권한을 얻지 못한다. 이전 incarnation 연결을 닫고 이후 요청을 `STALE_RUN`으로 거절한다. 실행 인증과 이미 접수된 broker-owned effect의 복구를 구분한다.

**SPIKE [S-01,S-02]** host PID 재사용을 피하는 peer 확인, Node binding, Principal attach credential 보호와 tool sandbox 검증은 release gate다. 검증 실패 시 UID-only fallback·무격리 fallback을 만들지 않는다. 판정([DR18](design-revisions.md)): peer 확인은 `SO_PEERCRED`와 cgroup identity(kernel lane), credential 보호와 tool 경계는 T114·SCN-B09·SCN-B10이 증거다.

## 4. 파일시스템 계약과 원본

**MUST [FS-001; arch §4]** state root `S=$XDG_DATA_HOME/oma/<society>`를 사용하며 XDG_DATA_HOME이 없으면 `$HOME/.local/share`를 사용한다. runtime root는 `R=$XDG_RUNTIME_DIR/oma/<society>`다. 모델이 보낸 path로 S/R을 바꾸지 않는다. 각 디렉터리는 trusted host가 생성·소유한다. custom XDG path는 unit renderer가 안전한 절대 path로 렌더링한다.

**MUST [FS-002]** 다음 allowlist 밖의 durable 파일을 추가하지 않는다. `<id>`는 위 검증을 통과한 broker 생성 ID, `<actor>`는 등록된 identity다. tmp는 동일 디렉터리/파일시스템에서 atomic publish하고 file fsync 후 parent dir fsync한다.

| Host path | 소유·내용·수명 | model mount |
|---|---|---|
| `S/config.json` | host authority, atomic replace | 없음 |
| `S/project-binding.json` | D05의 host-only full canonical project binding; WP16 C2 gate 전 생성하지 않음 | 없음 |
| `<config-index-root>/.oma-config/generations/<generation>/` | D02의 immutable host/models/roles/prompts; WP13 C2 gate, bounded retention 및 quiescent cleanup | 없음 |
| `S/runtime.sqlite{,-wal,-shm}` | broker 상태, SQLite 관리 | 없음 |
| `S/execution/scopes.jsonl` | DR51 version1 실행 관측 hash-chain; 재생 명령·accepted plan·권한 없음. unknown scope의 복구 fence | 없음 |
| `S/logs/resident/<actor>/<시작-ms>-<invocation>.jsonl` | DR53 version1 trusted stdout/stderr 전체 bytes·운영 metadata. bounded preview와 별도이며 실행/receipt proof가 아님 | Human의 명시적 진단 정리까지 보존 |
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

**MUST [DB-001; arch §14]** base entity는 `agents`, `operations`, `subscriptions`, `deliveries`, `batches`, `attestations` 여섯 개뿐이다. [schema-v4.sql](../packages/storage/src/schema-v4.sql)을 base 초기 migration으로 실행한다. DR46: `user_version=4` 하나만 읽고 쓰며 이전 DB는 쓰기 connection 이전에 거절하고 보존한다. migrations table·변환·자동 삭제는 제공하지 않는다. operation plan은 `{version:2,intent:...}`의 닫힌 envelope이며 원본 bytes를 읽기나 복구에서 보충하지 않는다.

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
| T-batch-prepare | 현재 incarnation, snapshot, batch insert(첫 시도 = 현재 incarnation, DR9) 또는 기존 prepared를 현재 시도로 반환, delivery.batch_id 연결 |
| T-batch-complete | trusted receipt 확인 후 batch completed와 해당 deliveries.presented |
| T-ack | 자기 delivery.acknowledged, op succeeded |
| T-create-intent | 이름/spec conflict 검사, agents provisioning, parent op+initial message plan |
| T-create-ready | 필수 clone/unit 확인 뒤 enabled 또는 stopped, initial mail 공개 조건 확정 |
| T-run-open | 이전 cgroup 사망 및 BATCH-004의 이전 시도 receipt 정산 뒤 agent incarnation만 증가(나머지 prepared batch의 row는 바꾸지 않는다, DR9) |
| T-stop-intent | desired=stopped 및 stop op pending |
| T-submit-accept | durable bundle 검증 후 op+고정 result message plan/deliveries |
| T-integrate-intent | 직렬화된 repo slot 확인, base/candidate/policy pending op |
| T-integrate-done | 실제 main 대조 뒤 op succeeded |
| T-context-accept/done | 고정 commit/notification intent; 실제 ref/snapshot 대조 후 완료 |
| T-usage-reserve | 전체/계통/Principal reserve 검사와 usage reserved insert. INF-001 뒤로는 production 호출자가 없다(usage 표에 쓰는 주체가 없다는 사실은 INF-009대로 validation이 기록한다) |
| T-usage-settle | provider usage와 outcome 원자 갱신 |

**MUST [DB-008]** prepared batch에 포함된 message IDs와 delivery.batch_id의 집합은 같아야 하며 recipient는 batch.agent와 같아야 한다. DB FK만으로 충분하지 않은 교차행 불변식은 store 함수와 integrity test에서 검증한다. completed batch는 변경·확장하지 않는다. 누락 원문, FK 손상, 실제 ref 불일치는 조용히 새 상태로 덮어쓰지 않는다.

**S-03 판정 ([DR18](design-revisions.md)).** v1은 batch를 activation 때 준비해 followUp으로 전달하고, terminal boundary의 receipt로 완료한다. run 도중 도착한 mail은 다음 run의 batch다. run 중 steer는 v1 기능이 아니다: pinned 엔진에서 run 중에 넣은 안내를 batch에 durable하게 귀속시킬 경계가 그 receipt 하나뿐이기 때문이다. 대가는 지연(현재 run의 남은 시간)이고, 순서와 정확히 한 번의 귀속은 지켜진다. 기본 DDL은 새 state를 추가하지 않는다. architecture §7의 steer 문장과의 차이는 DR18이 적는다. steer는 SP-03-T를 진입 조건으로 하는 v2 후보다.

## 6. IPC framing, schema, idempotency

**MUST [IPC-001; arch §13]** actor socket 위 protocol v1은 `uint32 big-endian JSON byte length` + 해당 길이 UTF-8 JSON이다. JSON root는 object, v=1, id는 연결 내 request correlation 문자열이다. public 요청/응답은 `contracts.ts`의 discriminated union과 정확히 일치한다. duplicate JSON key, invalid UTF-8, NaN/Infinity, 안전 범위 밖 integer, unknown field/method/version을 거절한다.

**MUST [IPC-002]** control 연결 하나에는 동시에 요청 하나만 처리한다. git/context body stream은 metadata frame 뒤 descriptor.bytes만큼 raw bytes를 읽고 SHA-256과 길이를 확인한다. raw stream 사이에 JSON notification을 끼우지 않는다. 실제 길이 부족/초과·연결 종료는 preaccept `STREAM_INVALID`다. inference는 별도 연결을 쓰고 control framing parser와 상태를 섞지 않는다.

**MUST [IPC-003]** mail body는 제한 안에서 UTF-8 JSON 문자열로 전송한다. bundle/context content는 descriptor stream을 사용한다. 큰 메일을 자동 절단하거나 숨은 attachment API로 바꾸지 않는다. 응답은 `{v:1,id,ok:true,result}` 또는 `{v:1,id,ok:false,error:{code,message,retry,details?}}`다. HTTP status/임의 exit text를 IPC error contract로 대신하지 않는다.

**MUST [IPC-004]** `MutationRequest`는 DB operations.kind에 있는 모든 durable mutation이며 top-level `request: RequestKey`가 타입과 runtime validator 모두에서 필수다. 누락·빈 key·잘못된 형식은 접수 전에 INVALID_REQUEST로 거절한다. `ReadRequest`는 `operation.get`, `operation.read`, `status.get`, `logs.read`, `git.known`이고 top-level request를 금지한다. `operation.get`의 조회 대상 key는 `params.key`에만 둔다. `EphemeralRequest`는 현재 run의 메모리 intent인 `agent.wait`이며 읽기로 분류하지 않고 top-level request와 durable op 생성을 금지한다. 읽기/ephemeral의 `request?: never`는 키를 허용한다는 뜻이 아니며 명시적 undefined도 strict 타입 검사에서 거절한다. `Request<M>`는 이 세 집합의 method-discriminated union이고 미분류 method는 허용하지 않는다. 요청 actor/incarnation/capability는 wire에 넣지 않고 AuthContext에서 주입한다.

**MUST [IPC-005]** request hash는 method+normalized params+stream descriptor를 key 정렬한 canonical UTF-8 JSON의 SHA-256이다. 배열 순서는 의미 있는 경우 보존하고 to/prerequisite/path 집합은 dedupe+lexical sort한다. body bytes와 subject는 trim하지 않는다. CRLF body는 CLI가 LF로 정규화하고 이후 immutable하게 취급한다. request key, transport id, timestamp, actor supplied claim은 hash 입력이 아니다.

**MUST [IPC-006]** CLI는 effect 요청 이전에 private cache에 key·normalized payload·고정 OID·stream digest를 atomic write한다. 응답 유실 시 같은 key로 operation.get, 미접수면 동일 payload로 retry한다. 동일 actor/key·동일 hash는 기존 receipt, 다른 hash는 `REQUEST_KEY_REUSED`다. 같은 key의 동시 preaccept 파일이 여러 개 생겨도 DB unique winner의 plan만 공개한다.

**MUST NOT [IPC-007]** timeout을 failed로 바꾸거나 새 key를 자동 만들어 동일 효과를 재실행한다. 새 shell invocation에 새 key가 생기는 것은 별도 요청이며 자연어 의미를 dedup하지 않는다. key가 다르면 같은 candidate라도 새 수신자/result mail을 만드는 정상 제출일 수 있다.

**MUST [IPC-008]** operation.get은 새로운 model-facing 명령을 만들지 않고 원래 command의 `--request <key>` 재호출/복구 안내 내부에서 사용한다. CLI가 freeze cache를 찾으면 현재 HEAD를 다시 해석하지 않는다. cache와 사용자 새 인자가 충돌하면 `REQUEST_KEY_REUSED`로 명확히 중단한다. unconfirmed key 복구 안내는 `/inbox.md`에 경로와 원래 command를 짧게 제공한다.

큰 receipt의 조회도 IPC-006/008의 동일 actor/key 규칙을 따른다. `operation.read`는 원본 JSON의 SHA-256·전체 byte 수·offset·base64 조각·다음 offset을 반환하며 각 응답은 frame 안에 든다. 첫 조각 이후 SHA-256이 없거나 관측이 바뀌면 계속하지 않고 offset 0부터 다시 조회한다. CLI는 큰 mutation/operation.get 응답 뒤 효과를 재전송하지 않고 이 읽기로 회수한다. 조립 상한은 64 MiB이고 초과·중간 단절·해시 불일치는 결과 불명확이며 미접수 증거가 아니다. 로컬 cache 예산보다 큰 receipt는 원래 freeze를 보존하고 영수증·key와 기록 불가 경고를 출력한다. `status.get`의 일부 목록은 `next` agent-name cursor를 명시한다. `oma status --after <next>`로 계속 읽으며 각 페이지는 별도 live 관측이다. 운영 full-set 조회는 기존 진단 row/byte 예산을 재사용하고 초과를 `LIMIT_EXCEEDED`로 거절하며 일부 집합을 전체로 사용하지 않는다.

**MUST [IPC-009]** trusted-only method는 actor endpoint에서 dispatch하지 않는다. runner.open/batch.prepare/batch.complete/observe는 runner channel, Principal attach/detach는 보호된 extension channel, host.principalRelay/reconcile은 host channel만 사용한다. batch.read는 trusted OMA extension helper에만 제공한다. 일반 `oma` CLI에 내부 method 호출 escape hatch를 넣지 않는다.

**MUST [IPC-011]** internal channel도 동일한 bounded frame/error 형식을 사용하며 `InternalRequest`/`InternalResponse`로 제한한다. runner.open은 검증된 unit invocation에만 lease를 반환하고, batch.complete의 성공 응답은 DB complete commit 뒤에만 보낸다. runner.observe는 메모리 관측값이며 durable row를 추가하지 않는다. principal.attach의 credential 발급·교환 handshake는 OMA가 소유해 직접 기동한 session에 한해 확정한다. host-only channel은 host가 broker를 spawn할 때 연 socketpair(descriptor 3)이며, host는 그 peer로 식별되므로 secret이 필요 없다. broker는 이 channel이 있을 때만 principal endpoint를 열고, 두 endpoint가 listening된 뒤에 준비를 알린다. host는 자신의 자식인 engine을 등록하고, broker는 그 engine이 실제로 host의 자식인지 확인한 뒤 credential을 channel로 돌려준다. credential과 session handle은 파일에도, 어떤 프로세스의 환경에도, 명령행에도 두지 않는다 — 셋 다 같은 UID의 다른 프로세스가 읽을 수 있기 때문이다. host→engine, trusted extension→CLI로도 socketpair로만 전달하며, pipe와 달리 socket은 `/proc/<pid>/fd`로 다시 열 수 없다. attach는 credential과 handle에 더해 연결한 프로세스가 등록된 engine의 자손일 것을 요구하므로, credential을 얻었어도 engine이 시작하지 않은 프로세스는 Principal이 아니다. attach 이전 요청과 위조·이전 run의 credential은 `AUTH_FAILED`, 다른 session handle은 `ATTACH_CONFLICT`다. 재등록과 broker 재시작은 새 credential을 발급하고 이전 것은 무효다. 권한은 attach 시점에 받은 context가 아니라 현재 등록 세대에 대한 binding이며 모든 요청과 preflight에서 재확인한다. 자손 관계도 attach 때 한 번 보고 마는 것이 아니라 요청마다 `/proc`에서 다시 계산한다 — engine이 죽으면 그 자손은 init으로 reparent되어 더 이상 어떤 engine의 자손도 아니고, attach 때의 판정을 기억해 두면 죽은 engine이 남긴 프로세스가 Principal 권한을 계속 쓰게 된다. engine이 죽었음은 pid가 아니라 pid와 시작 시각의 쌍으로 판정하며, 그 사실이 확인되면 그 session 전체를 은퇴시킨다. 은퇴는 거절을 먼저 쓴 뒤에 일어나므로 요청자는 끊김이 아니라 `AUTH_FAILED`를 받는다. 재등록·broker 교체·endpoint 종료는 이전 세대에 attach된 연결을 그 자리에서 끊으므로, 이미 연결을 들고 있던 engine도 다음 요청을 통과시키지 못한다. host endpoint는 host임을 확인한 뒤 먼저 method 표면을 판정하고(서빙하지 않는 method는 `UNKNOWN_METHOD`), 그 다음에 이 broker의 Principal 등록 유무를 본다 — method의 존재 여부는 등록 여부에 의존하지 않으며 error class가 caller의 재시도를 결정하기 때문이다. host의 channel이 닫히면 broker는 스스로 멈춘다. ptrace가 같은 UID 사이에서 제한되지 않는 host(Yama scope 0)에서는 어떤 user-space 검사도 두 프로세스를 구별하지 못하며, 이는 host의 성질로 적어 둔다. 사용자가 따로 띄운 외부 Pi session에 attach하는 경로는 여전히 확정하지 않으며 S-02의 model-facing tool 통과 기준도 그대로 남는다. host relay/reconcile 응답은 실제 처리된 개수를 반환하고 timeout은 작업 성공으로 꾸미지 않는다. 대량 Principal backlog에서 oneshot timeout/start-limit 반복이 발생하지 않는 처리량·자원 조건은 S-06 필수 시험이다.

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

**MUST [BATCH-002]** batch notice는 최대 6개 metadata 항목과 `/inbox.md` 경로를 포함하고 본문 자동 요약은 하지 않는다. 항목에는 sender, subject, kind, mail 경로, 필요 시 reply/reference만 둔다. index에는 batch의 전체 ID와 직접 읽을 수 있는 경로를 제공하고, 읽기 안내는 저장된 원문이 아니라 본문을 보낸 사람이 쓴 그대로 보여 주는 읽기 도구를 가리킨다. context mail이면 고정 revision 경로와 GOAL 변경 안내를 포함한다. meta limit은 원문 잘림을 뜻하지 않는다. 완료가 확인되지 않은 batch를 다시 전달할 때는 notice 첫 줄에 그 사실을 고정 문장 하나로 밝힌다(D01, [DR5·DR6](design-revisions.md)).

**MUST [BATCH-003]** 일반 batch의 최대 message 수는 host resource 설정 `batchMaxMessages`로 고정하며 초기 reference 값은 24다. direct/question/result/context class와 public-list class 양쪽이 있으면 각각 최소 1개를 포함하고, 남은 자리는 두 class를 교대로 oldest `(created_at_ms,message_id)`부터 선택한다. notice 6개도 이 순서를 사용한다. kind만 바꿔 권한·Principal 강제 개입을 얻을 수 없다.

**MUST [BATCH-004]** D01: prepared batch의 원래 ordered message IDs와 session/evidence identity를 유지한다. DR9: batch의 incarnation은 그 batch를 만든 첫 전달 시도이고 바뀌지 않는다. run이 열리면 나머지 prepared batch는 row를 바꾸지 않고 새 lease가 이어받으므로, batch의 전달 시도는 첫 시도부터 현재 lease까지다. 이전 run 또는 startup quiescence를 증명한 broker(현재 incarnation이 끝나는 run이어야 한다)가 그 구간 안의 시도가 쓴 receipt를 먼저 관측·정산한다. 정산은 현재 lease가 아니라 이 구간과 검증된 receipt에 묶인다. filesystem 관측은 transaction 밖에서 하고 T-batch-complete 안에서 같은 batch/actor/시도 구간/ordered manifest/state를 다시 확인한다. prepared·completed batch의 incarnation과 최초 유효 receipt는 역사적 사실로 남는다. 읽기 불가·손상·구간 밖 incarnation은 재전달 근거가 아니며 원본 보존과 명시적 진단/repair 대상이다. live complete의 현재 peer/run fencing은 그대로 유지하고 recovery 권한을 새 RPC나 stale lease로 발급하지 않는다. 오류·abort·timeout·모델의 완료 문구는 boundary 증거가 아니다.

**MUST [BATCH-006]** 기본 followUp 경로의 production batch.complete는 validation record에 pin된 `oma-pi-rpc-v1@1.0.1` receipt만 허용한다. trusted runner가 소유한 정확한 state-root receipt path, batch ID/incarnation/message manifest, adapter revision, runner session root 안의 sessionPath가 모두 일치해야 completed/presented를 같은 transaction에서 commit한다. session boundary의 내구성은 receipt 게시 전에 확인한다. 게시된 receipt를 정산할 때는 session 파일의 현재 존재·내용·권한을 다시 완료 조건으로 요구하지 않는다(과거 사실은 receipt 자체로 판정, DR19). 타입이나 문자열만 맞춘 evidence, model writable 경로, mock completion, 환경 변수 우회는 거절한다. v1은 followUp만 쓰므로 이 경계가 v1의 유일한 완료 경계다([DR18](design-revisions.md)).

D01 publication은 private same-filesystem temp에 bounded bytes를 쓰고 file fsync → final name no-replace publication → parent directory fsync 후에만 durable receipt를 반환한다. 기존 final name이면 exact batch 관계를 검증해 최초 유효 receipt 자체를 반환하며, 새 boundary의 sessionPath로 바꿔 complete하지 않는다. 0600 mode를 유지하고 final publication 뒤 fsync 불명에서는 final name을 삭제하지 않는다. 이것이 Pi session 자체의 power-loss flush를 증명하지는 않는다.

**MUST [BATCH-005]** session 경계 증거가 불충분하면 같은 batch ID로 재안내할 수 있다. 같은 mail을 다시 안내했다는 사실을 표시하고 기존 operation receipt와 workspace를 대조하게 한다. 이전 shell/tool을 자동 replay하지 않는다. Pi 사고과정·tool cursor·reasoning snapshot용 state를 추가하지 않는다.

위 fairness 규칙은 prepare 대상으로 허용된 시점에 적용한다. v1의 deliveryMode는 언제나 followUp이다([DR18](design-revisions.md)). 현재 batch의 deliveryMode를 새 mail 때문에 바꾸거나 ID를 추가하는 구현은 금지한다.

## 8. Resident·Principal·Pi 경계

**MUST [PI-001; arch §§7–8]** trusted runner가 bwrap 안에서 `pi --mode rpc`를 실행하고 RPC stdin/stdout을 private pipe로 다룬다. Pi extension은 `packages/extension/src/index.ts`의 신뢰된 compiled artifact만 기본 로드한다. agent workspace의 extension/config를 host runner에서 import하지 않는다. Pi의 discovery 차단 옵션은 pinned 버전 실험으로 확인한다.

**MUST [PI-002]** runner는 trusted `oma-deliver` extension command를 RPC prompt로 호출한다. extension은 batch ID의 소유를 확인한 후 다음 형태로 전달한다. Peer content를 Human role prompt로 꾸미지 않는다.

```typescript
pi.sendMessage(
  { customType: 'oma-mail', content: batch.notice,
    display: true, details: { batchId: batch.id } },
  { triggerTurn: true, deliverAs: batch.deliveryMode }
);
```

**MUST [PI-003]** v1은 activation 때 준비된 batch를 followUp으로 전달하고 terminal boundary까지 완료한다. 이미 진행 중인 tool group 사이에 도착한 direct/question/reply/context를 끼워 넣는 steer profile은 v1에 없다([DR18](design-revisions.md)). 새 mail 때문에 준비된 batch의 ID나 mode를 바꾸지 않는다.

**MUST [RUN-001]** activation은 unit/invocation 확인 → 이전 run 사망 확인 → BATCH-004의 이전 시도 receipt 정산 → incarnation 발급(나머지 receipt-absent prepared는 batch를 바꾸지 않고 새 lease가 이어받는다, DR9) → sandbox/Pi resume → batch 안내 → 정상 Pi loop → boundary commit → pending 재검사 → 필요 시 다음 loop 또는 exit 0 순서다. 최초 GOAL 전에는 inference를 시작하지 않는다.

**MUST [RUN-002]** inference slot이 부족하면 runner는 bounded 메모리 waiter로 기다린다. new를 남겨 둔 채 즉시 exit/restart를 반복하지 않는다. systemd·broker 취소를 받아 즉시 waiter에서 빠져야 한다. idle일 때 mail 유무를 모델에게 주기적으로 묻지 않는다.

**MUST [RUN-003]** `oma agent continue --note`는 자기 앞으로 일반 message를 보내는 operation이다. continuation task entity는 없다. `oma agent wait`는 인증된 Resident 자신의 live incarnation에만 메모리 flag를 설정한다. `agent.wait {observe:true}`(`oma agent wait --observe true`)는 같은 run의 flag를 바꾸지 않고 조회한다. Principal·다른 incarnation·revoked run은 사용할 수 없다. 도구 결과가 session에 기록된 awaited `turn_end`에서 조회한 뒤 다음 모델 호출 없이 종료하며, 도구 실행이나 접수된 효과를 중간 취소하지 않는다. 조회 중에는 별도의 유한 통신 예산을 쓰고, 조회 실패는 wait 성공이나 배달 증거가 아닌 unconfirmed다. 정상 wait는 별도 control 통지이며 delivery receipt나 batch.complete를 만들지 않는다. pending mail과 prepared batch는 원본을 유지하고 재활성화 정책을 따른다. wait가 mail을 ACK하거나 desired=stopped로 바꾸지는 않으며, broker 재시작 또는 새 incarnation에 flag를 넘기지 않는다.

**MUST [PR-001]** Principal logical identity는 bootstrap 때 한 번 만들고 Pi UI attach와 독립적으로 유지한다. 동시에 하나의 attach만 허용하고 두 번째는 ATTACH_CONFLICT다. attach는 host-only channel의 비공개 credential로 인증하며 session handle/path는 모델 payload에서 신뢰하지 않는다. 연결 끊김은 new Principal 생성의 trigger가 아니다.

**MUST [PR-002]** D01/D06: principal-relay는 mailbox new 항목마다 durable 수신 기록과 원문을 확인하여 모두 cur로 이동한다. 기존 질문/batch가 pending이어도 새 항목의 인수는 계속한다. relay는 모델을 호출하지 않으며 UI가 없으면 새 batch를 prepare하지 않는다. 재연결한 host가 제한된 pending batch를 인수하고 trusted extension이 custom message로 전달한다.

Live batch.prepare/complete는 이 broker를 시작한 host endpoint에서만 서빙하고 모델 도구에 열지 않는다. host임 외에 현재 Principal 등록과 pid/시작시각으로 확인한 살아 있는 engine을 매 요청 요구한다. host 역시 tenure·살아 있는 broker·그 broker가 이 engine에 발급한 등록·살아 있는 engine 넷이 현재일 때만 전달한다. 등록 거절/응답 대기 중에는 전달하지 않고 이전 broker 등록을 상속하지 않는다. 유효한 기존 receipt 정산은 새 turn이 아니므로 busy와 분리하되 live 등록 계약을 우회하지 않는다. offline 정산은 BATCH-004의 좁은 trusted startup recovery만 사용한다.

새 전달은 idle일 때 session 소유권을 동기적으로 예약한 뒤에만 쓴다. Human prompt도 같은 소유권을 사용한다. 소유권 단위는 prompt가 아닌 engine agent run이며 queue의 continuation까지 소진한 뒤 오는 correlated agent_settled가 정상 종료 경계다. 예약 중 Human prompt는 bounded host queue에 순서대로 보관하고 engine follow-up queue에 섞지 않는다. run 종료 단계에서 다음 Human 입력이 곧바로 소유권을 얻는다. 명시적 수락 전 거절은 예약을 돌려주고 입력과 사유를 사용자에게 알린다. 상한 초과 입력도 조용히 버리지 않고 거절한다. busy 보고는 소유권 이동 자체에서 나온다.

수락 응답 timeout/쓰기 결과 불명만으로 예약을 풀지 않는다. correlated settle, 확정된 미수락 또는 실행 종료 증거 전에는 유지/fence하고 대기 Human 입력을 불명 run에 쓰지 않는다. session 종료 시 미전송 입력은 각각 원문·식별과 함께 반환하고 수락 불명 입력은 자동 replay하지 않는다. retry/compaction 중 실패한 assistant message 하나는 run 실패 증거가 아니다. boundary 없이 확정 종료한 batch는 prepared로 보존하며 BATCH-005의 재안내 정책을 따르되, receipt unreadable/conflicting을 absent로 바꿔 재실행하지 않는다.

**MUST [PR-003]** Principal의 Human context·private memory는 principal/private와 기존 Pi session에 남긴다. context publish는 공유 문서만 전달한다. mailbox urgent alert는 UI 경고일 수 있지만 Human 입력을 위장하거나 현재 깊은 판단을 강제 abort하지 않는다. 모델이 질문에 답하는 데 필요한 peer evidence는 archive/Git에서 선택해서 읽는다.

**MUST [PR-005]** typed Principal mail과 progressive packet은 확장 계약 SEM/PACK을 따른다. 기존 `oma send`의 `--kind approval_required`에 한해 `--candidate <published-oid> --expect <base-oid> --policy-revision <revision>`을 모두 요구하고 CLI가 `approvalFor={repo:project,targetRef:refs/heads/main,expectedBase,candidate,policyRevision}`을 만든다. 그 외 kind에서는 세 flag를 거절한다. 별도 decision/interrupt command 또는 DB를 추가하지 않는다. `critical`은 UI 인지 hint이고 followUp/tool 보존/예산 제한을 우회하지 않는다. `result`는 sender의 결과 보고이며 task/Human 전달 완료의 증거가 아니다. HIGH의 authoritative decision command/record는 여전히 S-08 gate다.

**MUST [PR-004]** Principal host Pi의 모든 model-facing shell/read/write/edit 및 동적으로 등록된 tool 경로를 sandbox-backed 구현으로 제한한다. extension attach credential·Human 원본 session·provider credential을 model tool sandbox에 mount하지 않는다. trusted extension은 session 접근이 필요하지만 model에게 그 권한을 위임하지 않는다.

**SPIKE [S-02,S-03]** Pi hook/command/tool replacement·session flush의 정확한 import와 signature는 pinned SDK로 실행 검증 후 작성한다. provider API는 엔진이 소유하므로(INF-001) OMA가 확정할 signature가 없다. 비슷해 보이는 SDK 함수명이나 `appendEntry` 호출만으로 fsync를 보장한다고 추측하지 않는다. 판정([DR18](design-revisions.md)): import와 signature는 pinned 1.0.1로 실행 검증했고(ENG1 이후 Pi 1.0.1 이식으로 재검증), 완료의 durable 증거는 session flush가 아니라 runner의 host-private receipt다(BATCH-006).

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

**SPIKE [S-05]** quarantine→canonical의 정확한 검증·object import argv/pack flush 조합은 hostile bundle와 prerequisite 실험으로 확정한다. 단순 `cp -r quarantine/objects` 또는 agent repo를 host `git fetch`하는 대안으로 채우지 않는다. 위 command 표는 양 끝의 확정된 계약이다. 판정([DR18](design-revisions.md)): 중간 경로는 `test/s05-hostile-bundles.test.ts`와 GIT-006 시험이 hostile 입력으로 검증했다.

**MUST [GIT-008]** published ref는 `refs/oma/published/<actor>/<operation-id>`이고 immutable이다. 이미 C면 idempotent success, 다른 OID면 PUBLISHED_REF_CONFLICT 후 해당 효과 중단이다. canonical main을 bundle ref에 따라 변경하지 않는다. ref 확인 후 고정 result message를 공개·배달하고 receipt에 C/ref/fetch command/dirty 안내를 반환한다.

**MUST [GIT-009]** submit succeeded는 published ref와 result mail materialization이 완료됐다는 뜻이다. main 통합·review 완료·Principal 판단·agent 종료를 뜻하지 않는다. report/document도 private clone에서 commit하고 published ref+path로 전달할 수 있다. 별도 Artifact repository나 모든 report를 main에 넣는 규칙을 추가하지 않는다.

**MUST [INT-001]** base 및 tiered의 공통 조건으로 integrate는 candidate가 하나 이상의 canonical published ref로 보존됨, code.integrate capability, actual main==expected, expected ancestor of candidate, protected path 조건, 현재 policy를 검사한다. UX-09([DR33](design-revisions.md)): candidate의 **전체** tree에 submodule gitlink(mode `160000`)가 없음도 같은 조건이다 — base에서 변하지 않고 물려받은 gitlink도 거절이며, diff의 changed path 목록으로 대신할 수 없다. gitlink가 관측되면 모든 경로를 `details.paths`에 실은 `UNSUPPORTED_PROFILE`로 거절하고(작성 문장이 아니라 구조화된 경로가 wire에 남는다), 관측이 불확실하면 부재로 읽지 않는다. `git.submit`/quarantine은 transport이므로 허용하고, provisioning은 gitlink를 실은 canonical `main`도 시작은 허용하되 report가 경로와 이어질 거절을 알린다. v1은 fixed host checks를 돌리지 않는다: checks를 적은 설정은 broker 시작 때 `UNSUPPORTED_PROFILE`로 거절한다([DR18](design-revisions.md)). protected path `/`는 모든 변경을 보호한다. protected path는 default profile에서 Resident integrate를 거절한다. candidate==expected면 main은 변경하지 않는 검증된 no-op receipt로 처리할 수 있지만 published/권한 조건을 생략하지 않는다.

**MUST [INT-002]** candidate 검사는 별도 sandbox의 해당 C checkout에서 host 지정 argv/env로 수행한다. 검사의 stdout 'PASS'가 아닌 실제 exit code/timeout을 사용한다. candidate가 수정할 수 있는 검사 script가 존재한다는 사실만으로 trusted 검사 정책을 대체하지 않는다. test sandbox에 actor/admin socket, credential, shared repo RW, workspace 밖 host FS를 노출하지 않는다.

**S-01-CANDIDATE 판정 ([DR18](design-revisions.md)).** v1은 candidate check를 돌리지 않는다. candidate별 kernel 자원 한도가 검증되지 않은 채 host에서 candidate 코드를 돌리는 것은 검사가 없는 것보다 나쁘다. candidate는 만든 곳(그 Resident의 sandbox)에서 시험하고, 사람이 쓰는 CI는 게시된 ref를 그대로 받는다. nonempty `integration.checks`와 `sandbox.candidate`·`git.runCheck`는 `UNSUPPORTED_PROFILE`이다. checks를 자동으로 []로 바꾸어 회피하지 않는다. transient systemd-run/service/scope, userland polling, broker 전체 cgroup 한도만을 candidate별 격리로 취급하는 방식은 뒤에 이 기능을 더할 때도 허용하지 않는다.

**MUST [INT-007]** 실제 spawn의 candidate OID/argv/env는 검증된 check snapshot과 정확히 같아야 한다. builder unit test만 통과하고 production이 다른 cwd/config/default를 쓰는 것을 금지한다. timeout/signal/검사 후손 잔존/관측 불명확은 CHECK_FAILED 또는 대조 전 pending/unknown이며 PASS가 아니다. host check exit 0만으로 아직 살아 있는 background process를 무시하고 종료했다고 기록하지 않는다. 실제 candidate 출처와 sandbox/종료 ownership를 production entrypoint 시험에서 확인한다. UX-09의 setup 거절은 check argv가 상속하지 않는 close-on-exec private descriptor의 폐쇄형 상태로 전달한다(DR49). stdout/stderr의 marker는 분류 근거가 아니다. private setup 성공 후 bare 125는 CHECK_FAILED이며, private 상태 누락·부분 frame은 unknown이다. 거절은 check argv 이전이며 gitlink 경로는 불변 candidate에서 같은 Git owner가 다시 관측한다.

**MUST [INT-003]** project main mutation은 repo별 메모리 mutex와 pending integrate operation 검사로 직렬화한다. 먼저 T-integrate-intent, 그 뒤 검사·Git CAS, 마지막 T-integrate-done다. crash 후 unresolved integrate가 있으면 새로운 main writer를 시작하지 않는다. CAS 바로 전에 main/policy/capability/stop intent를 재검사한다.

**MUST [INT-004]** D06: 복구에서 base!=candidate이고 main==candidate일 때만 이미 ref 효과가 발생한 것으로 대조한다. base profile은 receipt를 완료하고 tiered는 PUB-001/002의 미완료 공개 메일까지 보충한 뒤 succeeded로 완료하며, 과거 CAS를 현재 권한으로 다시 실행하지 않는다. base==candidate no-op은 ref 일치만으로 final authorization을 증명하지 못하므로 INT-001의 eligibility와 현재 policy/stop/authority를 다시 검사하고 기존 error classification으로 정산한다. non-no-op의 main==base도 현재 조건을 재검사하고 진행하거나 증명된 precommit 실패로 끝낸다. 그 외는 REF_STATE_UNKNOWN으로 unknown을 남기고 해당 repo main write를 차단한다. 외부 수동 main 변경을 새로운 정상 base로 수용하지 않는다. CAS 경쟁 패자는 STALE_BASE와 actual main을 받는다.

**MUST NOT [INT-005]** broker가 rebase/merge/cherry-pick/충돌 해결·자동 재승인·새 candidate 생성을 한다. Resident가 자기 clone에서 새 candidate를 만들고 새 request로 제출한다. Principal만 integrate할 수 있는 gate도 추가하지 않는다.

**MUST [INT-006]** 목표 tiered는 확장 계약 TIER/PUB/CHAL의 max-tier, exact approval/OBJECT, HIGH Principal ACCEPT, post-CAS 공개, challenge/re-entry floor를 구현해야 한다. 기존 base의 optional approval만으로 이 요구를 충족했다고 표시하지 않는다. base의 현재 schema/build는 승인 evaluator를 활성화하지 않는다. approve/object/revoke 및 필요한 최소 확장의 closed syntax/schema는 S-08/S-10 완료 시 함께 반영한다.

**MUST [APP-001]** tiered attestation 구현은 actor를 인증하고 append-only fact+mail을 기록하며 동일 actor의 중복 승인은 한 번만 집계한다. object는 명시 revoke 전까지 유효하고 자기 attestation만 취소할 수 있다. branch/base/candidate/policy가 다르면 재사용하지 않는다. Human 승인은 host/UI channel만 발급한다. mail의 approve 문구를 parser로 권한화하지 않는다.

**SPIKE [S-08]** tiered의 MEDIUM 기본 peer floor 1, zero active OBJECT, HIGH의 peer floor+Principal ACCEPT는 채택했다. eligible actor/author provenance·host trust 설정·exact decision/revoke evaluator·최소 DDL/IPC는 아직 검증이 필요하다. S-08은 이제 tiered의 필수 gate이며 S-10의 floor/정책 snapshot 계약과 함께 통과해야 한다. base의 protected-path 거절 구현은 계속 가능하지만 tiered 지원의 대체품은 아니다. 판정([DR18](design-revisions.md)): tiered는 v1에 없다.

## 10. 공유 context 게시

**MUST [CTX-001; arch §8.3]** `oma context publish <directory> --expect <oid|none>`은 기존 문서 구조 `GOAL.md`, `RATIONALE.md`, `decisions/*.md`를 게시한다. GOAL은 필수 UTF-8 regular file이고 비어 있으면 거절한다. symlink/device/hardlink/절대 path/상위 이동을 거절한다. binary/비허용 path는 INVALID_REQUEST다.

**MUST [CTX-002]** CLI는 경로별 sorted manifest `{path,bytes,sha256}`와 그 순서대로 이어붙인 raw content stream을 만든다. descriptor.bytes는 각 bytes 합계다. broker는 staging에서 각 file 길이/hash를 확인한다. tar를 임의 host path에 추출하지 않는다. 파일별 mode는 고정 regular 0644이며 commit에는 실행 권한을 부여하지 않는다.

**MUST [CTX-003]** context.git의 canonical ref는 `refs/heads/main`으로 고정한다. 기존 revision을 parent로 한 commit을 broker trusted identity로 생성하고 op plan에 candidate C를 영속화한다. 첫 publish expected=null은 ref absent를 뜻한다. `git update-ref refs/heads/main C B` 또는 첫 생성의 zero-OID CAS를 사용한다. CAS 실패는 CONTEXT_CONFLICT+actual revision이다.

**MUST [CTX-004]** context CAS 뒤 `world/context/revisions/C`를 immutable 완성·fsync하고 relative current symlink를 atomic 교체한 뒤 고정 residents notification을 공개한다. crash 후 ref==C이면 missing snapshot/symlink/mail을 보충한다. 다음 context mutation 전에 미완료 publication을 대조한다. ref==B이면 현재 조건으로 재시도하고 제3 OID면 unknown으로 멈춘다.

**MUST [CTX-005]** context provenance는 Principal interpretation이다. Human 원문의 전부·private memory를 복사하지 않는다. 기존 인간 승인으로 둔갑시키지 않는다. model startup에는 current GOAL/핵심 제약을 직접 제공하고 상세 rationale은 fixed revision path로 읽는다. 여러 문서를 읽는 동안 `current`를 매번 다시 resolve하지 않는다.

**MUST [CTX-006]** 첫 context publication이 끝나기 전 Resident는 생성만 가능하고 path 활성화/inference를 하지 않는다. 첫 성공 후 enabled Residents의 path를 활성화하고 notification으로 시작한다. 새 Resident는 생성 당시 최신 context와 brief만 받고 부모 전체 session이나 과거 commons backlog를 복사하지 않는다.

## 11. systemd와 lifecycle

DR49로 Linux reference adapter와 systemd assets를 production에서 제거했다. 아래 UNIT-*는
과거 unit 형식과 검토 ID를 보존하는 역사 계약이며 native 실행에 unit 설치를 요구하지 않는다.
현재 실행의 대체 규범은 [NATIVE-011–016](macos-platform.md)이다. start/stop의 hint 차단 →
권한 철회 → 종료 요청 → 독립 후손 사망 판정은 공통 `@oma/process/resident-supervisor`가
소유한다. 완료된 명령이나 로그는 사망 증거가 아니다. Darwin gate와 전체 회귀의 판정은 별도다.

**MUST [UNIT-001; arch §§6,15]** society별 허용 unit은 각 Resident의 service/path와 principal.path/principal-relay.service다. unit 이름은 `oma-<society>-<actor>.service/.path`, `oma-<society>-principal-relay.service`, `oma-<society>-principal.path`다. broker.service와 reconcile.service/timer는 존재하지 않는다 — broker는 제품이 foreground로 직접 실행하고 주기 reconcile은 broker process 안의 sweep이다. 이름 충돌 방지를 위해 Resident 이름 broker, principal-relay, reconcile도 금지한다.

**MUST [UNIT-002]** [systemd templates](implementation-spec.md#unit-renderer-계약)를 고정 renderer로 생성한다. template의 @NODE@/@LIBDIR@/@STATE@/@SOCIETY@/@AGENT@는 host 값에서만 치환한다. unit 이름과 ExecStart argv를 caller 문자열에서 만들지 않는다. `%`/공백/따옴표/newline은 systemd 문법에 맞춰 escape하고 NUL/newline이 들어간 설정은 거절한다. 템플릿은 systemd에 그대로 설치할 파일이 아니다.

**MUST [UNIT-003]** 초기 reference profile은 resident MemoryMax=4G, TasksMax=256, CPUQuota=200%, OOMPolicy=kill, KillMode=control-group, TimeoutStopSec=10s, Restart=on-failure, RestartSec=3s, RestartSteps=4, RestartMaxDelaySec=12s, StartLimitIntervalSec=60s, StartLimitBurst=5다(DR27). systemd의 지수 backoff로 즉시 실패의 재시작 간격을 늘리되 다섯 간격의 합은 60초보다 짧아 연속 즉시 실패가 기존 start-limit을 우회하지 않는다. 실제 host cap은 bootstrap config에 명시하고 renderer가 반영한다. resource profile이 지원되지 않으면 무제한으로 실행하지 않고 UNSUPPORTED_PROFILE이다.

**MUST [UNIT-007]** systemctl effect 성공은 subprocess spawn이 아니라 정상 exit status와 해당 effect의 후속 actual observation으로 판정한다. nonzero/timeout/signal/malformed 결과를 성공으로 바꾸지 않는다. daemon-reload는 정상 exit와 대상 unit의 LoadState=loaded 및 렌더링한 설정 일치, enable/disable은 unit-file 상태, path start/stop은 path 실제 상태, service stop은 inactive와 cgroup 후손 사망을 확인한다. 관측 실패는 succeeded가 아니며 accepted op는 실제 효과를 대조한다. 짧게 실행 후 정상 종료한 Resident start는 동일 InvocationID의 정상 종료와 pending 재검사를 허용하되 전혀 시작 안 된 inactive와 구분한다. 정확한 systemd property/binding 증거는 S-01/S-06에 pin한다.

**MUST [UNIT-004]** D03: broker는 제품이 foreground로 직접 실행하는 프로세스 하나다 — systemd-managed broker.service는 존재하지 않으며 Resident unit도 어떤 broker unit에 After/BindsTo하지 않는다. product-owned foreground broker는 DB/open-operation 복구, 이전 Resident cgroup 정리, socket/인증 준비가 완료된 뒤에만 준비를 알리고, IPC-011/REC-007의 private channel·tenure를 유지하며 존재하지 않는 broker.service에 기대거나 별도 broker service를 몰래 기동하지 않는다. Type=exec runner의 Pi/shell/test 후손은 같은 cgroup에 남으며 runner 한 PID 종료를 전체 사망으로 응답하지 않는다.

**MUST [UNIT-005]** .path는 inbox/new에 DirectoryNotEmpty를 사용한다. enabled+GOAL 조건이 충족될 때만 enable/start한다. prepared batch만 cur에 남은 경우 reconcile과 startup DB 조회로 service를 시작한다. path 상태만으로 pending을 판단하지 않는다. default.target에 enable된 path가 reboot 때 잘못 켜져도 broker 인증은 stopped/GOAL 없는 실행을 거절하고 reconcile이 path를 중지한다.

**MUST [UNIT-006]** start-limit failure는 status에 노출하고 reconcile이 자동 reset-failed를 반복하지 않는다. 현재의 명시적 `failed/Result=start-limit-hit`만 start-limit 확정 근거다. 누적 `NRestarts`, 명령 출력에 등장하는 단어·unit 이름, 관측 timeout은 현재 StartLimitIntervalSec 안의 제한 도달 증거가 아니다. manager가 `exit-code`만 남기면 관측된 실패는 표시하되 제한 원인은 미확인이다. `startLimitStatus`의 null은 제한 없음 증명이 아니며, 뒤늦은 상태 조회가 끝나지 않은 start 명령의 unknown을 확정 실패로 바꾸지 않는다(DR27, P0-5). 명시적 `oma agent start <name>` 또는 host repair만 reset-failed를 수행할 수 있다. stopped actor의 new는 계속 저장하되 path/service를 켜지 않는다.

**MUST [CREATE-001]** model-facing `agent.create`의 `params`는 `AgentCreateInput`으로 고정하고 `name`, CLI가 freeze한 full `from` OID, UTF-8 `brief`만 받는다. `profile`/`capabilities`는 CLI 옵션·wire 입력·request cache의 caller payload에 넣지 않는다. 해당 field가 들어오면 값이 host default와 같더라도 INVALID_REQUEST로 거절하고, 무시하거나 caller 선호로 사용하지 않는다. TypeScript의 `profile?: never`/`capabilities?: never`는 이러한 입력 금지 제약이며 선택 입력이 아니다. 다른 unknown field도 기존 strict validator 규칙으로 거절한다.

**MUST [CREATE-002]** broker만 `ResolvedAgentSpec`의 최종 profile/capabilities/modelProfile를 결정한다. modelProfile 참조는 선택한 자식 host profile에서 복사해 고정한다(DR46). 효과 없는 resource 필드는 삭제되었다. 인증된 부모의 `agents.profile`에 대응하는 host `AgentProfile`을 찾고 그 `childProfile`을 선택한다. null이면 CAPABILITY_DENIED, 참조하는 profile이 없으면 UNSUPPORTED_PROFILE로 접수 전에 거절한다. 자식 capabilities는 `인증된 부모의 현재 유효 capabilities ∩ 부모 profile.delegable ∩ 선택한 자식 profile.capabilities`의 전체 교집합에, 선택한 자식 profile.capabilities가 host가 직접 주는 권한(`code.integrate`, AUTH-001)을 가지면 그것을 더해 중복 제거·사전순 정렬한 값이다. Principal도 동일한 명시적 host 위임을 적용하며 role로 교집합을 확대하지 않는다. CLI/모델이 host 설정을 대신 해석해 resolved spec을 전송하지 않는다. host의 초기 population 설정은 이 actor-facing 입력과 별개다.

**MUST [CREATE-003]** `operations.payload_json`과 request_hash는 정규화한 `AgentCreateInput`만 포함한다. `plan_json.intent.spec` 및 `agents.spec_json`에는 broker가 확정한 `ResolvedAgentSpec`을 저장하고 `spec_hash`는 그 전체 canonical spec의 hash다. 접수 transaction에서 부모 권한과 선택한 host 정책이 resolution 때와 같은지 재검사하고 달라졌으면 접수 전에 다시 계산한다. 같은 key의 accepted 요청은 새 host default를 해석하기 전에 기존 hash/receipt를 조회하고 저장된 resolved spec으로 복구한다. 재시도로 profile/capabilities를 재선택하거나 확대하지 않는다. 다른 key의 stable-name dedup은 최종 resolved spec hash를 비교하므로 host default 변경으로 spec이 달라졌으면 AGENT_CONFLICT다. 현재 권한의 폐기와 run 차단은 기존 AUTH/LIFE 규칙을 계속 적용한다.

**MUST [LIFE-008]** initialResidents는 최초 bootstrap seed만 지정하며 runtime registry가 아니다. ready 이후 모든 actor의 identity/profile/capabilities/modelProfile/from/parent는 agents의 검증된 resolved spec 및 created_by에서 가져온다. `ResolvedAgentSpec`은 생성 시 선택한 host profile의 modelProfile 참조를 포함하고 spec_hash에 포함한다(DR46). unit은 accepted profile/modelProfile을 전달하며 runner가 현재 역할의 modelProfile 참조로 바꾸지 않는다. 고정 참조의 모델 내용은 다음 활성화에 읽는다. runner/unit renderer/authenticator는 `initialResidents.find()`나 seed 부재 시 default profile을 사용하지 않는다. 호스트의 현재 credential/가격/명시적 권한 폐기 정책은 계속 적용하되 persisted 권한과 참조를 조용히 바꾸지 않는다. 저장된 profile/model 참조를 현재 배포가 지원하지 못하면 UNSUPPORTED_PROFILE로 차단하고 임의 대체하지 않는다. DB column name/profile과 spec의 대응 값이 다르면 STORE_CORRUPT다. 부모는 created_by가 원본이며 새 parent registry를 만들지 않는다.

**MUST [LIFE-009]** 최초 bootstrap 중 seed마다 stable-name create intent를 남기고 같은 intent로 중단 복구한다. bootstrap seed가 추가/삭제됐다는 이유로 다음 broker restart 때 agent를 자동 생성/삭제/중지하지 않는다. 최초 GOAL publication 이후는 seed 보충 단계가 아니며 explicit lifecycle 경로만 사용한다. 최초 bootstrap 도중 seed 설정 변경은 지원하지 않는다. 중단 복구는 기존 seed create intent부터 재개하며 host는 원래 seed 설정을 유지해야 한다. 이미 기록된 intent와 현재 seed spec이 다르면 AGENT_CONFLICT로 중단한다. bootstrap 완료/중단은 기존 최초 context ref와 provisioning/create intent로 대조하고 새로운 bootstrap 상태 DB를 만들지 않는다.

**MUST [LIFE-001]** create는 stable name/spec hash와 request key를 동시에 dedup한다. 같은 이름·같은 spec이면 기존 생성 결과로 수렴한다. 다른 spec이면 AGENT_CONFLICT다. lineage quota는 provisioning을 포함해 예약하고 failed provisioning을 멋대로 삭제·이름 재사용하지 않는다. 생성 실패의 자동 재개는 같은 physical intent에 한한다.

**MUST [LIFE-007]** 같은 이름/spec에 다른 request key로 create가 오면 기존 create operation에 연결한 `existingCreation` plan을 만들고 clone/unit/mail을 추가 생성하지 않는다. 새 key의 operation은 기존 provisioning 결과를 대조해 같은 agent 결과로 끝낸다. 이는 create 한 종류의 stable-name dedup이며 범용 dependency/workflow graph가 아니다. provisioning actor에 대한 model start/stop은 AGENT_NOT_READY로 거절한다. already enabled이며 현재 cgroup이 정상인 agent.start는 idempotent no-op이고 incarnation을 증가시키지 않는다.

**MUST [LIFE-002]** create 순서는 T-create-intent → workspace.tmp 독립 clone 및 pinned base 검증 → workspace atomic rename+dir fsync → mailbox/runner/unit 생성 → daemon-reload 결과와 unit LoadState/설정 확인 → T-create-ready → initial mail materialize → GOAL 있으면 path 활성화다. 준비 전 identity는 commons/topic expansion과 status의 ready count에서 제외한다. unit 생성 성공만으로 enabled라고 기록하지 않는다.

**MUST [LIFE-003]** stop은 T-stop-intent → StopUnit(path)/disable activation → endpoint+inference revoke → StopUnit(service) → systemd cgroup 사망 확인 → succeeded다. 종료 확인 불가면 RUN_TERMINATION_UNKNOWN/unknown이고 새 incarnation을 발급하지 않는다. 이미 accepted mail/submit은 broker가 완료한다. 아직 CAS하지 않은 integrate는 CANCELLED_BEFORE_COMMIT, CAS한 것은 실제 ref와 대조해 완료한다. stop receipt에 남은 broker-owned op ID를 포함한다.

**MUST [LIFE-004]** start는 retired를 거절하고, 이전 cgroup 사망 및 GOAL을 확인한 뒤 desired=enabled와 operation을 기록한다. GOAL 없으면 GOAL_REQUIRED로 반환하며 desired/path를 변경하지 않는다. path와 필요 시 cur prepared service를 활성화하고 actual unit result를 receipt/status에 반영한다. start가 새로운 논리 agent/session/workspace를 생성하지 않는다.

**MUST [LIFE-005]** retirement는 이름을 보존하는 host 명시 행위다. 기본 model CLI에 retirement/delete/purge를 추가하지 않는다. host 운영 UI/maintenance 구현 범위가 필요하면 기존 stopped→retired와 미래 routing 제외만 제공하고 repo/mail/session의 자동 삭제를 결합하지 않는다.

**MUST [LIFE-006]** broker restart 시 ephemeral waiter/connection을 복원하지 않는다. old run 권한을 폐기하고 cgroup 사망을 확인한 뒤 pending physical effects를 대조한다. Principal attach는 끊고 인증된 재연결을 기다린다. bootstrap이 불완전하면 stage별 실제 파일/ref/DB로 같은 작업을 이어가되 root checkout은 쓰지 않는다.

## 12. sandbox mount·FD·network 계약

**MUST [SB-001; arch §16]** baseline은 trusted rootfs RO, user/mount/PID/IPC/network/UTS/cgroup namespace 분리, cap drop, private proc/dev, new session, die-with-parent, 그리고 kernel 효과를 제한하는 seccomp filter다(bwrap `--seccomp 3`, filter 전달의 owner는 process/async다; [DR19](design-revisions.md), MAC-205). filter는 native x64·arm64 ABI만 허용하고 x32 및 다른 ABI를 거절한다. `socket()`·`socketpair()`의 `AF_VSOCK`, io_uring setup/enter/register, add_key/request_key/keyctl, bpf, perf_event_open, userfaultfd는 `EPERM`으로 거절한다. 같은 kernel 효과의 우회 진입점을 함께 막으며, 이는 syscall allow-list나 모든 kernel 자원의 격리 보장은 아니다. vsock은 network namespace로 막히지 않는 kernel이 있으므로 namespace에 기대지 않는다. rootfs에는 pinned Node/Pi/Git/shell/rg/library와 empty mount targets만 둔다. host `/` 또는 `/home` 전체를 bind하지 않는다.

**MUST [SB-007; arch §16]** 기본 rootfs는 OMA가 society state root 아래에 만든다. 내용은 빈 mount target과 agent만을 이름으로 갖는 생성된 `/etc/passwd`·`/etc/group`뿐이며 host `/etc`에서 복사하지 않는다. 프로그램과 라이브러리(`SB-001`의 Node/Git/shell/rg/library)는 host 운영체제의 것을 RO bind로 겹쳐 제공하고, 그 대상은 `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc/alternatives`, `/etc/ld.so.cache`, `/etc/resolv.conf`, `/etc/ssl/certs`, `/etc/pki/ca-trust`, `/etc/pki/tls/certs`, `/etc/nsswitch.conf`, `/etc/hosts`, `/etc/localtime`로 닫힌다. DNS/NSS/hosts/timezone 파일과 CA 디렉터리는 존재하는 target만 RO bind하며 absent 또는 깨진 symlink는 제외한다. `/etc` 전체를 bind하지 않으며 이 준비는 network/egress를 열지 않는다([DR31](design-revisions.md)). 이 목록 밖의 host 경로 — `/`, `/home`, state root, runtime directory — 는 받아들이지 않는다. host가 merged-`/usr`로 둔 최상위 link는 rootfs 안에 같은 모양으로 재현하되 `/usr` 밖을 가리키는 link는 따라가지 않는다. Node는 실제 binary 한 파일만 고정 경로에 RO bind한다. rootfs 생성은 idempotent하며, 예상 밖의 항목은 지우지 않고 거절한다.

**MUST [SB-002]** Resident argv builder는 다음 의미의 배열을 생성한다. 옵션 지원 여부와 identity 매핑은 S-01로 검증한다. rootfs 안 mount target은 배포 때 생성하고 actor가 수정하지 못한다. `/tmp` reference cap은 512 MiB이고 host가 더 제한할 수 있다.

```text
bwrap --unshare-all --new-session --die-with-parent --cap-drop ALL --seccomp 3
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
  --ro-bind <workerArchive> /mail/workers
  --ro-bind <ownMailbox> /mail/self
  --ro-bind <ownRunnerViewDir> /run/oma-view
  --ro-bind <worldDir> /world
  --ro-bind <projectGit> /git/project.git
  --ro-bind-try <projectMirror> /git/project-mirror.git
  --ro-bind <ownIncarnationSocket> /run/oma/control.sock
  --symlink /run/oma-view/inbox.md /inbox.md
  --clearenv --setenv HOME /home/agent
  --setenv PATH <pinned-OMA-and-Node>:/home/agent/.local/bin:/usr/bin:/bin
  --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8
  --setenv TZ UTC --setenv TERM xterm-256color --setenv TMPDIR /tmp
  --setenv SHELL /bin/sh --setenv USER agent --setenv LOGNAME agent
  --setenv XDG_DATA_HOME /home/agent/.local/share --setenv XDG_RUNTIME_DIR /home/agent/.run
  <--setenv OMA_* for each core-extension input, then the four the builder owns>
  --chdir /workspace -- /opt/oma-node/node /opt/oma/<engine entry> --mode rpc <verified-extension-options>
```

`/opt/oma`는 OMA 설치 디렉터리의 RO mount다. 동봉 엔진·trusted core extension·model-facing CLI·role extension이 모두 그 아래 있으므로, OMA를 갱신할 때 rootfs를 다시 만들지 않는다. rootfs는 pinned Node/Git/shell/rg/library와 빈 mount target만 갖는다.

`/git/project-mirror.git`은 사람의 project의 bare mirror다. `oma`가 시작할 때마다 project의 `refs/heads/*`를 fetch하고(fsck, file protocol만), actor는 거기서 fetch해 기존 `git.submit`으로 게시한다. mirror가 아직 없으면 mount하지 않는다([DR18](design-revisions.md) D-8).

`/run/oma-sessions`는 엔진이 session을 쓰는 유일한 경로다. SB-006이 이미 그 내용을 model-origin data로 규정하므로 mount를 명시한다.

`--clearenv`가 환경 전체를 지우므로 trusted core extension이 읽는 `OMA_*`는 이 배열에 없으면 sandbox 안에 없다. builder는 caller가 준 이름/값을 검증하고(이름 문법, NUL 금지), `OMA_FRAME_BYTES`/`OMA_BATCH_MAX_MESSAGES`/`OMA_ACTOR`/`OMA_INCARNATION`를 마지막에 스스로 설정해 caller가 검증된 lease의 actor를 덮어쓰지 못하게 한다. host 환경은 상속하지 않는다. 위 최소 base 환경도 caller가 덮어쓰지 못하며 XDG 디렉터리는 confined home 아래에 mode 0700으로 준비한다. locale는 rootfs의 C.UTF-8 지원으로 시험한다.

**MUST [SB-002-C]** argv에 등장하는 host 경로는 위 mount 표를 통해서만 sandbox 경로로 번역한다. 중첩된 host root는 가장 구체적인 mount를 선택하며 RO installation root가 RW session/home/workspace mount를 가리지 못한다. 어느 mount에도 속하지 않는 경로는 그대로 전달하지 않고 거절한다. 그렇지 않으면 host에서 검증된 파일이 sandbox 안에서 조용히 없는 파일이 되고, 설정 오류가 엔진 오류로 둔갑한다. 모델에게 보이는 경로(도구 결과, CLI 출력, 메일 안내)도 그 모델의 view로 보인다: broker는 host의 이름으로 기록·응답하고, 모델의 경계(sandbox 안 CLI는 자기 환경의 mount root, Principal의 도구는 host root)가 번역한다([DR1](design-revisions.md)).

**MUST [SB-002-D]** 엔진의 agent directory(provider credential 보관처)는 Resident mount 계획에 넣지 않는다(PR-004). 따라서 봉인된 Resident는 credential이 없고 `--unshare-all`로 network도 없다. 이 조합에서 Resident가 provider에 닿는 길은 INF-005의 relay 하나다. credential이나 network를 조용히 열어 다른 길을 만들지 않는다. architecture §16에 비용과 선택지를 적는다.

**MUST [SB-002-E]** Society는 confined-only다([DR31](design-revisions.md), [DR60](design-revisions.md), 사용자 확정 U1). HostConfig 4는 Linux 전용 `installation.rootfs`·system mount 목록·caller-selected OS backend를 받지 않는다. 이전 설정 형식은 원본을 변환하지 않고 거절한다. Linux 어댑터가 소유한 state root 아래 `SB-007`의 rootfs와 닫힌 OS mount 목록을 선택하며 private state를 노출하는 system mount는 거절한다. bwrap/user namespace 부재나 spawn 실패는 host 실행으로 대체하지 않는다. macOS native 보장이 미해결이면 실행을 거절한다. Dashboard는 격리가 필수임을 표시하며 관측한 실행으로 승격하지 않는다. Resident 외 `oma login`/`oma pi` 대화형 엔진과 Principal의 contained tools는 각자 기존 계약을 유지한다.

**MUST [SB-003]** stdin/stdout/stderr와 명시적으로 검증한 RPC pipe 외 상속 FD를 닫는다. runner admin FD, provider socket, host credential FD, systemd bus, SSH agent, desktop socket을 전달하지 않는다. OMA actor socket에는 자기 limited API만 존재한다. 다른 actor endpoint는 mount하지 않는다. rootfs의 기존 symlink/mount target이 다른 host path를 노출하지 않는지 검사한다.

**MUST [SB-004]** DR37/DR46: Resident의 네트워크와 실제 OS 용량을 제한하는 OMA 정책은 두지 않는다. project CONNECT proxy는 대상 host와 port 문법을 검증하고 요청 header를 proxy에서 끝내며, 연결·dial·queue 자원은 실제 종료까지 owner가 보유한다. macOS guest의 CONNECT는 host가 발급한 현재 run identity에만 연결하고 lease 종료·boot 변경 뒤 새 연결을 열지 않는다. protocol 7은 guest의 옛 role/allow 선언을 거부한다. provider credential은 별도의 host relay가 소유하며 project tunnel에 넘기지 않는다.

**MUST [SB-005]** candidate-check sandbox는 staged candidate checkout만 RW, trusted check assets RO, tmp cap, private network, no actor/admin/inference socket이다. Git quarantine은 필요한 broker objects만 RO와 자기 staging만 RW다. Principal tools는 public world/mail/Git RO+자기 scratch RW만 갖고 Human session directory는 없다.

**MUST [SB-006]** sandbox의 writable session/CLI files는 model-origin data다. 보안·effect completion의 증거는 trusted runner receipt와 broker ledger가 소유한다. 모델이 session JSON에 완료 문구를 써서 presented/approval을 위조할 수 없어야 한다. 이에 필요한 정확한 Pi receipt 검증은 S-03 gate다.

## 13. inference·quota·취소

**MUST [INF-001; arch §13.3]** inference는 **동봉 엔진이 소유한다.** OMA는 provider relay, credential store, model catalogue, 가격표, 재시도 정책을 따로 구현하지 않는다. 엔진이 이미 갖고 있는 흐름을 그대로 쓰며, 그 상태는 TUI-017의 OMA 소유 agent 디렉터리 안에 있다. macOS 배포본에서는 해석에 쓰이는 상태가 host 한 곳에 있고, credential은 그 안에서 Keychain backend에 있다([DR18](design-revisions.md) D-4, MAC-704).

OMA는 Principal 및 Resident를 시작하기 전에 OMA 소유 agent directory의 엔진 설정을 적용한다: 일시적 API 실패에는 최초 호출 뒤 **최대 5회 재시도**하고, 계속 실패하면 최종 실패로 처리한다. 엔진 바깥 retry loop는 만들지 않는다. 엔진의 agent retry를 활성화하고 provider 내부 retry는 0으로 지정해 중첩 횟수를 방지한다. 기본 backoff는 1·2·4·8·8초이며, 이미 지정한 8초 이하의 유효한 backoff 값은 유지한다. 인증·잔액 부족 등 비일시적 실패, 취소, context overflow의 분류는 엔진이 소유한다. 전달 작업 전체에 합산된 turn deadline은 두지 않는다(DR27). 각 provider 요청의 첫 응답 전 추론과 compaction에는 model silence budget을 적용하고, 활동 중인 도구에는 그 도구 자신의 취소·시간 계약을 적용한다. acceptance·프레임·control 조회·종료 예산은 별개이며 시간 경과를 task 완료나 효과 실패로 해석하지 않는다. Resident의 idle deadline은 엔진이 알린 8초 이하 재시도 대기만큼 유예하되 무기한 중단되지 않는다. TUI에는 재시도 순번과 최종 결과를 표시한다. 봉인된 Resident에는 host credential 디렉터리 대신 자체 home 아래의 별도 엔진 설정 디렉터리만 전달한다(PR-004).

이 조항은 이전 판을 대체한다. 이전 판은 broker가 credential을 붙여 provider에 직접 요청하는 relay를 요구했다. 그 relay는 만들어지지 않았고 구현은 호출 경로 없이 남아 있었다. 문서와 코드가 어긋난 상태를 유지하는 것보다 실제 선택을 규범으로 확정하는 쪽을 택한다. 이 선택으로 provider codec·가격 upper bound·usage 회계를 gate하던 spike는 OMA의 대상이 아니게 되어 제거했다.

**MUST [INF-005; arch §16.1]** 봉인된 Resident의 provider 접근은 **byte relay**를 통한다. 이는 위 조항의 예외가 아니라 그 전제를 지키기 위한 transport다.

봉인된 Resident는 `PR-004`로 credential이 없고 `SB-004`로 network가 없다. 엔진이 inference를 소유하려면 그 둘 중 하나를 열어야 하는데, 여는 대신 credential을 sandbox 밖에 두고 바이트만 통과시킨다.

- host의 relay는 요청을 provider로 **해석 없이 전달**하고 헤더에만 진짜 credential을 끼운다. stream을 parse하지 않고, 응답을 재구성하지 않으며, 가격·token·context를 계산하지 않는다. 그 셋은 계속 엔진의 것이다.
- 목적지는 host가 선언한 model profile이 정한 provider endpoint뿐이다. caller가 URL·header·key를 고르지 못한다는 `INF-002`는 그대로다. 임의 URL proxy를 만들지 않는다.
- `INF-004`는 그대로다. relay는 결과가 불명확한 요청을 스스로 재전송하지 않는다.
- relay는 OMA가 다시 갖는 유일한 chokepoint다. 요청 수·동시성·취소를 관측하고 제한할 수 있으나, 보고되지 않은 비용을 0으로 간주하지 않는다.

**MUST [INF-006]** relay의 sandbox 쪽 끝은 bind-mount된 unix socket이며, network namespace는 계속 `--unshare-all`이다. trusted core extension이 sandbox 안에서 loopback listener를 열어 그 socket으로 넘기고, 엔진에는 그 loopback을 가리키는 provider를 등록한다. host와 sandbox 사이에 새 network 경로·CA·TLS 가로채기를 만들지 않으며, provider와의 TLS는 host쪽 relay가 소유한다.

**MUST [INF-008]** relay가 쓰는 credential은 **엔진이 해석한다.** runner는 동봉 엔진의 공개 SDK로 OMA 소유 agent directory에서 provider를 해석해 origin·key·추가 header를 얻고, 그 값은 한 delivery 동안만 relay에 있다. OMA는 엔진의 저장 형식을 읽지 않고, 해석 결과를 저장하지 않는다. `pi`/`current`는 엔진 설정의 기본 provider/model로 해석하며, 기본이 없거나 credential이 없으면 추측하지 않고 `UNSUPPORTED_PROFILE`로 거절한다. macOS guest에서는 runner가 해석하지 않는다: user manager 환경이 egress service(`OMA_EGRESS_SOCKET`)를 이름하면 run은 host에 자리표시자를 받고 relay 자리에 egress forwarder를 연다([DR18](design-revisions.md) D-10, MAC-710).

sandbox에는 진짜 key와 **같은 모양의 자리표시자**를 준다. provider 코드는 key를 읽는다 — Codex는 OAuth token의 claim에서 계정을 찾고 Anthropic은 key의 접두사로 header 방식을 고른다. 그래서 서명된 token은 header와 claim을 유지하고 서명만 바꾸며, 접두사가 있는 key는 종류를 나타내는 짧은 접두사를 유지하고 나머지를 같은 문자 종류로 바꾼다. 자리표시자는 비밀을 포함하지 않고, 비밀에 포함되지도 않으며, 엔진이 환경 참조나 명령으로 해석할 모양(`$`, `!`, `${`)을 갖지 않는다.

relay는 자리표시자를 provider가 key를 읽는 자리에서만 진짜 key로 바꾼다: 값 전체가 자리표시자이거나 `Bearer <자리표시자>`인 인증 header(`authorization`, `x-api-key`, `api-key`, `x-goog-api-key`)와 값이 자리표시자인 `key` query parameter다. 그 밖(request path, 다른 header·query)에 자리표시자가 있으면 요청을 거절한다 — provider가 되돌려줄 수 있는 자리(경로를 되읊는 404, 되돌려주는 header)에 진짜 key를 넣으면 sandbox 안에 credential이 생기므로 `INF-007` 위반이다. 같은 이유로 relay는 응답의 상태줄·header·본문에 진짜 key의 바이트가 나타나면 그 바이트가 sandbox에 닿기 전에 응답을 끊는다. 이를 위해 압축된 응답을 요청하지 않는다(`accept-encoding: identity`, WebSocket 확장 제거). 이것은 byte 비교이지 stream 해석·재구성이 아니다. body는 model의 내용이지 credential 자리가 아니므로 읽지도 바꾸지도 않는다. 자리표시자를 담지 않은 caller의 인증 header는 버린다. WebSocket upgrade는 handshake에서 한 번 같은 규칙으로 고쳐 쓴 뒤 양방향 바이트로 나른다.

**MUST NOT [INF-007]** 엔진의 agent directory를 Resident mount 계획에 넣지 않는다. sandbox 안에 진짜 credential을 두는 어떤 형태도 — agent별 복사본, society 공용 read-only mount, 환경 변수 — `PR-004` 위반이다. sandbox 안의 provider 설정에 들어가는 key는 relay가 교체할 자리표시자다.

비용 상한을 OMA 계약으로 되돌리려면 relay가 stream을 해석해야 하고, 그것은 codec 소유를 다시 가져오는 별도 architecture 결정이다. 이 조항은 그 결정을 내리지 않는다.

**MUST [INF-002]** 모델·provider 선택은 host가 선언한 model profile 이름으로만 지정한다. caller가 arbitrary provider URL, header, key, 가격을 지정하지 못한다는 제약은 그대로다. 엔진이 profile을 해석하며 OMA는 그 해석을 다시 구현하지 않는다.

**MUST [INF-003]** Human private prompt body를 공개 mail, journal, operations, usage 필드에 기록하지 않는다. 이 금지는 relay 유무와 무관하게 유지된다.

**MUST NOT [INF-004]** OMA relay·broker·adapter가 결과 불명확한 inference를 자체 재전송하거나 재시도를 위해 도구가 실행된 turn 전체를 다시 시작한다. 일시적 provider 실패의 재시도 여부는 INF-001의 동봉 엔진 한 곳에서 판정한다. 연결 단절 시 서버가 이미 처리·과금했을 가능성은 남으므로, 엔진 재시도가 inference의 exactly-once 실행·과금을 보장한다고 주장하지 않는다. 취소가 과금 취소를 보장한다고 가정하지 않는다. 엔진이 보고하지 않은 비용을 0으로 간주하지 않는다.

**MUST [INF-009]** multi-agent 비용 상한은 OMA가 집행하는 값이 아니다. DR46: 효과 없는 quota 선언과 호출 계약을 제거한다. 실제 과금 경계는 엔진과 provider 설정이 소유하며, OMA가 집행하지 않는 것을 집행한다고 표시하지 않는다.

`usage` 표와 여섯 durable entity는 DB-001 그대로 유지한다. persisted v1 schema를 이 변경으로 바꾸지 않는다. 그 표에 쓰는 주체가 없다는 사실은 [validation](implementation/validation.md)에 기록한다.

**MUST [INF-010]** performance 검증은 Astra 단독, cheap society 단독, Principal+society의 동일 task/tool 접근/성공 기준으로 수행한다. 품질·결함·Principal 및 전체 tokens·비용·latency를 각각 기록한다. Principal tokens 감소만으로 전체 비용/품질 우위를 주장하지 않는다. 자동 평가 threshold는 S-09에서 합의한다.

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

**MUST [ERR-001]** 모든 경계는 아래 closed code 또는 contracts.ts의 동일 enum을 사용한다. `INTERNAL_ERROR`로 업무 실패를 모두 덮지 않는다. error message는 설명이며 caller 분기는 code/retry/state로 한다. retry 값이 same-key여도 authority/현재 run을 다시 인증한다. 실패가 caller에게 말하는 사실은 code마다 닫힌 `details` 필드로만 싣는다: STALE_BASE·NOT_DESCENDANT·CONTEXT_CONFLICT의 `actual`, CAPABILITY_DENIED의 `capability`, BROKER_UNAVAILABLE의 `reason`(`busy`|`draining`), UNSUPPORTED_PROFILE의 `paths`(배포가 거절한 gitlink 등 저장소 상대 경로 — UX-09). 그 밖의 code와 필드는 싣지 않고, 예외에서 온 message는 code 그대로다. caller에게 보이는 설명 문장은 code마다 하나인 고정 표에서 온다([DR3](design-revisions.md)).

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
| QUOTA_EXCEEDED, PROVIDER_FAILED, PROVIDER_OUTCOME_UNKNOWN | agent 수·저장 용량 quota 초과 / 엔진이 보고한 제공자 실패 / 제공자 호출 결과 불명확 | 새 접수 거절, 정산은 여유를 기다림(D04) / provider 자동 replay 금지(INF-004) |
| UNSUPPORTED_PROFILE, SPIKE_UNRESOLVED | 플랫폼/검증 gate 미충족 | fail closed; backend 즉흥 추가 금지 |
| INTERNAL_ERROR | 분류되지 않은 구현 결함 | effect 상태 대조 전 retry 금지, 진단 ID만 공개 |

**MUST [ERR-002]** failed는 effect가 발생하지 않았거나 문서화한 terminal 실패가 확정된 경우다. 일부 공개 ref/mail이 생긴 뒤의 일시 장애는 pending으로 남긴다. unknown은 시스템이 effect 여부를 증명할 수 없을 때 사용한다. network timeout을 UNKNOWN Git ref로 단정하지 않고 broker가 실제 ref를 대조한다.

## 16. 복구·내구성·백업

**MUST [REC-001; arch §§17–19]** startup/reconcile은 정렬된 pending/unknown operations, 미materialized deliveries, prepared batches와 실제 filesystem/Git/systemd만 대조한다. 메모리 작업은 lost 가능하고 원본 query로 다시 선택한다. `queue_materialization`이라는 함수명은 새 durable queue를 허용하지 않는다.

**MUST [REC-007]** society broker는 R 아래 고정 lock file에 process-lifetime OS advisory lock을 획득한 뒤 DB를 연다. lock 미획득 시 두 번째 writer를 시작하지 않는다. lock은 config 로드·SQLite·복구보다 먼저 잡고, 얻지 못한 broker는 '시작 실패'와 구별되는 자기 exit status로 끝난다 — host는 그 둘을 다르게 다루어야 하고(앞은 소유 포기, 뒤는 재시작), 같은 status로는 구별할 수 없기 때문이다. 소유는 broker에서 파생하지 않는다. host는 society의 **state tree**를 이름으로 삼는 자기 lease를 직접 잡고 자기 수명 내내 들고 있으며, 그 lease를 잡기 전에는 설정 생성·state 준비·broker 기동 어느 것도 하지 않는다. lease의 이름은 파일 경로가 아니라 abstract AF_UNIX namespace의 이름이며 `uid`와 state root에서 유도한다 — 경로로 이름 붙인 lock은 그 경로만큼만 배타적이어서, 같은 UID의 아무 프로세스나 그 경로를 unlink·rename하고 새 파일을 놓으면 옛 보유자는 옛 inode의 lock을 계속 쥔 채 새 `oma`가 정규 경로의 새 inode를 잡는다. 한 society에 소유자가 둘이 되고 서로를 볼 수 없으며, 잡은 뒤 경로를 다시 확인하는 것은 검사와 사용이 여전히 두 단계이므로 창을 좁힐 뿐이다 — 같은 UID에서 파일의 속성으로 경계를 주장하지 않는다는 FS-005의 규칙을 mode가 아니라 namespace에 적용한 것이다. abstract namespace에는 갈아치울 directory entry가 없고, 두 번째 bind는 `EADDRINUSE`로 거부되며, 이름은 마지막 descriptor가 닫힐 때 커널이 되돌려준다. lease가 run root가 아니라 state tree의 이름인 이유는 두 writer를 가지면 안 되는 것이 tree이기 때문이다: run root는 boot·session마다 달라지는 교체 가능한 좌표이므로, 하나의 state tree를 서로 다른 두 run root로 가리키면 lease 두 개가 각각 자유롭게 잡힌다. 이미 listening 중인 broker가 있으면 그것이 society의 쓰기를 소유한다 — systemd unit이든 손으로 띄운 것이든 host가 사라진 `oma`의 것이든. 그래서 소유의 질문은 양쪽에서 답한다. host 쪽에서는 소유를 잡은 직후, 설정을 쓰기 전에 그 broker를 먼저 찾는다. broker 쪽에서는, 제품이 시작하지 않은 broker가 society lease를 **자기가** 잡고 잡지 못하면 시작하지 않는다 — host의 확인과 그 뒤의 쓰기는 여전히 두 단계이므로, 그 사이에 올라오는 broker는 host의 probe로는 막을 수 없기 때문이다. 제품이 시작한 broker는 그 lease의 descriptor를 이미 물려받았으므로 이름을 다시 잡지 않으며, 자기가 소유자의 것임을 환경의 선언으로 안다. 선언이 있는데 그 descriptor가 lease가 아니면 시작 실패로 답한다 — 쥐지 않은 society를 쥐었다고 믿는 broker가 그대로 society를 서비스하게 되기 때문이다. `broker.lock`은 남는다: 그것이 답하는 것은 '이 프로세스가 society의 단일 SQLite writer인가'이고, lease가 답하는 것은 '이 society에 무엇이든 행위해도 되는가'다. 이 확인이 provision·repair 뒤에 오면 다른 broker가 이미 Resident의 sandbox를 짓고 있는 rootfs의 `/etc/passwd`·`/etc/group`·symlink를 고쳐 놓은 뒤에야 물러나게 된다. 물러날 때는 lease도 함께 내려놓는다 — 행동하지 않기로 한 society를 쥐고 있으면 다음 `oma`만 막는다. broker의 lock은 broker와 함께 죽으므로 재시작 back-off와 한도 소진 이후가 모두 소유의 공백이 되고, 그 공백에 다른 `oma`가 들어올 수 있기 때문이다. lease를 잡지 못함(다른 프로세스가 쥐고 있음)과 lease를 아예 잡을 수 없음(경로를 신뢰할 수 없다, 이름을 평가할 수 없다)은 다른 답이며, 뒤의 것을 앞의 것으로 보고하지 않는다. 경로에 대한 판단은 lease를 잡기 **전에** 끝난다: 신뢰할 수 없는 run root·state root를 가리킨 `oma`가 먼저 소유를 잡고 설정을 쓰고 provision과 repair까지 한 뒤에야 자기가 검사한 곳이 아님을 아는 순서는, 검사하지 않은 것과 같다. 소유가 확정되기 전에 도는 준비 단계는 이미 있는 것을 다시 쓰지 않는다. 같은 바이트를 다시 쓰는 것도 쓰기이며, 경쟁에서 진 프로세스는 소유자의 트리를 inode와 timestamp까지 그대로 둔 채 물러나야 한다. 그래서 준비와 수리는 두 개의 정책이다: 준비는 없는 것만 만들고 있으면서 다른 것은 손대지 않은 채 보고하며, 수리는 그 보고를 받아 되돌리되 lease 보유자만 실행한다. 준비가 만드는 repository는 같은 부모 아래 임시 이름으로 만든 뒤 rename으로 제자리에 놓는다 — 최종 경로에 직접 만들면 동시에 첫 시작하는 두 `oma`가 서로의 반쯤 만들어진 트리를 보고 실패하며, rename이 진 쪽은 이긴 쪽의 repository를 그대로 받아들인다. lease의 유효 범위는 이 프로세스의 수명이 아니라 **lease 덕분에 시작된 모든 프로세스의 수명**이다. 호출 순서로는 이것을 지킬 수 없다 — host가 SIGKILL로 죽으면 실행할 코드가 없고 커널은 lock을 즉시 놓는데 engine은 살아 있으며, `close()`는 죽음이 아니라 신호다. 그러므로 lease는 open file description이 드는 lock이어야 하고, engine·broker와 그것들이 시작한 모든 것이 그 descriptor를 상속해야 한다. 이름은 상속된 descriptor 중 마지막 하나가 닫힐 때 풀리므로 society는 그 전부가 죽기 전에는 다른 host에게 넘어가지 않는다. 상속은 engine에서 끝나지 않는다: engine 안의 trusted extension이 시작하는 model-facing CLI는 `<stateRoot>/principal/private`와 그 아래 request cache를 쓰는 writer이고, engine에 보낸 signal은 그 자식에게 가지 않으므로 host와 engine이 모두 죽은 뒤에도 자기 timeout 전부를 살아서 쓸 수 있다. 그래서 fence는 고정된 descriptor 번호로 내려가고 그 번호를 환경으로 **선언한다** — descriptor 번호는 비밀이 아니므로 선언해도 아무 권한을 주지 않지만, 선언이 없으면 자식은 자기 부모가 어떻게 spawn되었는지를 알아내야만 lease를 다시 물려줄 수 있다. 선언된 fence가 그 자리에 없거나 lease의 종류가 아니면 자식을 fence 없이 시작하지 않고 실패로 답한다. sandbox(bwrap) 안에서 도는 Resident는 이 규칙의 예외다: listening 이름을 confinement 안으로 넣으면 sandbox 안의 프로세스가 society 소유자를 묻는 probe에 답할 수 있게 되므로, 그 경계는 fence가 아니라 커널이 강제하는 descendant 종료(cgroup)로 닫아야 한다. 이 성질의 결과로 lease를 놓는 일은 너무 이를 수 없고 너무 늦을 수만 있으므로, 정상 종료는 engine의 실제 종료를 기다리되 상한을 두고, 상한을 넘겨 놓더라도 society는 여전히 아무에게도 넘어가지 않는다. 수리는 broker의 startup quiescence가 이전 Resident의 종료를 증명한 뒤, broker가 Resident를 깨울 수 있는 어떤 단계(recovery·listen·activate)보다도 먼저 성공해야 한다(DR16): 증명 전에 고치면 이전 broker가 멈추지 못한 Resident가 아직 돌거나 다시 시작해 sandbox를 짓는 rootfs를 고치게 되고, 늦으면 수리되지 않은 rootfs 위에서 Resident가 먼저 깨어난다. 수리에 실패하면 화면에 적는 것으로 끝내지 않는다: broker의 startup이 실패하므로 broker는 준비를 알리지 않고 Principal 권한도 부여하지 않는다. DR35의 private 대화 준비는 별개이며 Society 효과는 등록 전 실행되지 않는다. PID file 숫자를 singleton 증거로 사용하지 않는다. Node lock/peercredential binding은 S-01로 검증한다. bootstrap/maintenance도 기존 broker 경계를 우회하여 DB/Git를 동시에 쓰지 않는다.

**MUST [REC-002]** reconcile sweep은 broker가 자기 수명 동안 in-process `setInterval`로 실행하며 간격은 reference 5초이고 모델을 호출하지 않는다(외부 timer unit은 없다). 한 sweep의 filesystem/provider 장애가 나머지 독립 mailbox 점검을 영구 막지 않도록 bounded work를 수행한다. 동시에 두 sweep을 실행하지 않고 이미 실행 중이면 기존 sweep에 합류/skip한다. no-progress retry는 로그와 다음 sweep으로 제한하고 tight loop를 만들지 않는다.

**MUST [REC-003]** 각 crash 지점의 복구는 [test matrix](verification-spec.md#oma-core-v1--검증-계약)의 oracle을 만족해야 한다. shutdown에서 새 mutation acceptance를 중단하고 진행 중 DB transaction을 마친 뒤 fd를 닫는다. 강제 kill을 피할 수 있다고 가정하지 않는다. SQLite commit과 Git ref update를 한 atomic transaction이라고 기술하지 않는다.

**MUST [REC-004]** process crash 보장과 power-loss 보장을 구분한다. file/dir fsync·SQLite FULL·Git object/ref flush·지원 filesystem/장치 계약을 S-06으로 검증하기 전 '전원 장애에도 유실 없음'이라고 표시하지 않는다. 지원 외 filesystem에서 자동 weak durability로 전환하지 않는다. state는 local kernel file system에 있어야 한다: NFS·SMB/CIFS·FUSE(virtiofs 포함)·9P·Ceph·AFS·Coda·NCP 위의 state root는 시작 때 `UNSUPPORTED_PROFILE`로 거절한다. SQLite WAL은 network file system을 지원하지 않고, 사망 증명은 kernel이 `flock`을 놓는 것에 기대기 때문이다([DR18](design-revisions.md), S-06). process crash 보장은 SIGKILL 시험이 받치고, 전원 장애 보장은 powercut lane(승인된 VM) 전에는 말하지 않는다.

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

**MUST [ORDER-003]** default Core release gate는 S-01~06의 판정([DR18](design-revisions.md))과 그 증거, S-09에 대해서는 성능을 주장하지 않는다는 사실, test matrix의 core cases, package/type/schema 검증, 실제 systemd+bwrap+Pi E2E다. S-07/S-11은 optional feature만 차단한다. 목표 tiered release는 S-08/S-10 및 T78–T90을 추가로 요구한다. base gate 통과만으로 현재 목표 아키텍처가 완료됐다고 표시하지 않는다. v1에 없는 기능의 adapter는 stub success 대신 `UNSUPPORTED_PROFILE`로 명시적으로 실패한다. spike를 다시 여는 것은 설계 수정이며, 그 전에는 `SPIKE_UNRESOLVED`를 던지지 않는다(규칙 `no-open-spike`).

**MUST [ORDER-004]** performance가 목표에 미달하면 수치를 보고하고 모델/profile/배치 resource 설정을 평가한다. Principal의 필수 판단 경로 삭제·숨은 자동 요약 agent·task scheduler 추가로 평가를 통과시키지 않는다. 구조 변경은 별도 architecture 판단이다.

## 18. 제품 표면과 TUI

### 세션 실행 모드 (DR28)

아래 MODE 조항은 [DR28](design-revisions.md)의 사용자 요청을 기록한다. Society의 Principal/Resident·sandbox·mail·project binding 계약은 Society에 그대로 적용된다. Personal은 Principal 역할이 아니며, 이 절의 모드 구분이 Principal의 권한을 넓히지 않는다. 구현·검증 상태는 [validation](implementation/validation.md)이 소유하며 목표 계약을 실행 가능하다는 주장으로 읽지 않는다.

**MUST [MODE-001]** 새 세션의 모드는 `society`(기본값) 또는 `personal`이다. OMA 실행 시 모드 선택창을 띄우지 않으며 TTY·비TTY 모두 생략한 모드는 Society다. `oma --mode society|personal`은 시작 모드를 명시한다. 처음 세션을 열고 아직 대화를 시작하지 않은 idle 상태에서는 `/society`로 Personal·Society를 선택한다. 선택 취소·현재 모드 선택은 세션을 유지하며, 대화·실행 중인 작업이 있으면 전환을 거절한다. Personal과 `--society/--config/--bind-project`의 조합은 효과 전에 거절한다. 지원하지 않는 모드를 조용히 Society로 실행하지 않는다.

**MUST [MODE-002]** 모드는 session identity·시작 cwd·history 위치와 함께 version이 있는 birth descriptor로 시작 효과 전에 no-replace 게시한다. Society는 기존 state root, Personal은 `<data>/oma/.personal/<UUID>/`와 그 `history/`를 사용한다. 저장된 identity·mode·경로는 인자·재시작으로 덮어쓰지 않는다. 손상·알 수 없는 version·잘못된 경로는 다른 모드나 새 세션으로 재해석하지 않는다. 별도 전역 mode DB를 만들지 않는다.

**MUST [MODE-003]** Personal은 동봉 Pi/Open TUI와 기본 read/write/edit/bash·탐색 도구, 사용자가 명시적으로 선택한 확장을 사용한다. 실제 시작 cwd와 일반 사용자 OS 권한으로 프로젝트 밖 사용자 파일을 다루되 권한 상승이나 sandbox 우회를 제공하지 않는다. Society broker·Worker·mail·GOAL·통합·리뷰·quota를 생성하거나 로드하지 않고 Principal prompt·core extension·actor/socket/credential-channel 환경을 가져오지 않는다. Society Principal의 read-only·메일·상위 리뷰 권한은 그대로 유지한다.

**MUST [MODE-004]** Personal 확장 선택은 `<data>/oma/.personal/settings.json`의 독립 revision으로 영속 보존한다. 최초 project 선택에서 Society core를 제외한 명시적 사용자 확장만 이어받고, 이후 변경은 Principal/Worker 설정을 바꾸지 않는다. 동일 OMA package store/index·extension validation/digest 규칙을 재사용하며 설치 코드를 중복하지 않는다. writer lock 아래 최신 설정을 읽어 전체 검증·변환·atomic replacement하고 update/remove 뒤 경로를 reconcile한다. 읽기 실패를 빈 선택이나 전부 삭제로 해석하지 않는다. Personal Config는 model·effort·extensions·고정 mode만 표시한다.

**MUST [MODE-005]** `/resume`는 저장된 모드로 열며 변환하지 않고, fork도 출처 모드를 유지한다. `/new`는 현재 모드의 새 세션을 선택창 없이 연다. 첫 대화 전 idle 세션의 `/society`는 모드 선택을 제공한다. 다른 모드 선택 시 현재 writer의 실제 종료를 관측한 뒤 `oma --mode personal|society`로 재진입해 같은 프로젝트의 세션을 열며, 기존 birth·history를 변환하거나 이어 쓰지 않는다. Personal→Society는 표준 project binding·ownership·provisioning 경로로 같은 프로젝트의 새 Society 세션을 연다. 선택창·before-switch hook 대기 중 세션이 바뀌거나 작업이 시작되면 전환하지 않는다. DR49 native 경로에서는 두 OS가 같은 세션 전환 owner를 쓰며, VM/Host API handoff는 폐기했다. IPC EOF이나 timeout만으로 writer 종료를 인정하지 않는다. legacy Society는 관측된 기존 project binding으로만 식별하며 경로 형태만으로 외부 Pi history를 수입하지 않는다. Society open/close는 협업 상태이며 Personal 시작은 다른 Society나 개별 force-stop 사실을 바꾸지 않는다.

MODE-006은 DR49로 폐기했다. 이 번호의 옛 VM/Host API/guest→host 전환 의미는
[원문 기록](archive/macos-vm-tests-2026-10-25/docs/implementation-spec.md)에 보존한다.
새 native 경계는 [NATIVE-001–007](macos-platform.md)을 따르며 Linux의 파일 containment나
Principal 권한을 완화하지 않는다. 이 ID를 새 native 요구에 재사용하지 않는다.

### Society 표면과 공통 엔진

**MUST [TUI-001; arch §23.1]** OMA의 공개 UX와 명령 namespace는 OMA가 소유하고 Pi는 내부 실행 엔진이다. Pi command를 이름만 바꾼 wrapper를 만들지 않는다. 이 절은 새 durable entity, 새 daemon, 새 effect queue, 새 socket method, 새 model-facing subcommand를 도입하지 않으며 A-006/A-007의 제한을 그대로 받는다. TUI가 표시하는 모든 값은 기존 관측 경로에서, TUI가 일으키는 모든 변경은 기존 mutation 또는 host config 경계에서 나온다.

**MUST [TUI-002; arch §23.2]** `oma`는 두 개의 서로 다른 실행 파일이다. host 설치 PATH의 것은 Human TUI이고, Resident rootfs 안의 것은 CLI-001의 model-facing CLI다. 두 실행 파일은 argv 파서, capability, 연결 소켓, 설정 접근을 공유하지 않는다. 공유 가능한 것은 frame codec과 transport처럼 부작용과 권한이 없는 leaf뿐이다. Human TUI의 terminal decoder는 stdin read를 key 경계로 가정하지 않고 같은 stream에서 분할된 UTF-8 code point와 ESC/CSI report를 다음 read까지 이어서 완성한다. incomplete report의 보유량은 선언된 작은 한도를 가지며 unknown report는 prompt 문자로 누출하지 않는다. 시작하고 끝나지 않은 모든 token(분할 UTF-8, 미완 ESC/CSI, 열린 paste)은 선언된 deadline을 가지며, deadline이 지나면 보유분을 포기한다. deadline이 없으면 Human이 다음에 누르는 key가 미완 report의 마지막 byte로 소비되어 사라진다. 분할 UTF-8의 deadline은 decoder가 스스로 관측 가능해야 한다. 포기한 미완 code point는 U+FFFD로 대체해 prompt에 넣지 않고 그것을 기다리던 decode state와 함께 버리며, terminal이 만든 U+FFFD도 key로 취급하지 않는다. TUI는 terminal의 bracketed paste(DEC 2004)를 화면 취득 시 켜고 반납 시 끄며, 한 paste를 개행마다의 Enter가 아니라 하나의 입력 경계로 받는다. paste는 제출이 아니라 draft 편집이며, 한도를 넘었거나 terminal이 끝내지 않은 paste는 남은 prefix를 전달하지 않고 전체를 거절한다. paste 경계 자체는 host terminal이 DEC 2004를 지킨다는 전제 위에 있으므로(clipboard 안의 `ESC[201~`를 그대로 흘리는 terminal은 그 전제를 깬다), TUI는 그 전제에만 기대지 않는다: paste end marker 뒤 같은 read에 남은 byte는 key로 해석하지 않고 그 paste의 내용으로 흡수하며, paste 종료 후 선언된 짧은 구간 안에 도착한 Enter는 제출이 아니라 그 paste의 개행으로 처리한다. 이 구간은 선언된 한도이고, 그 안의 Enter를 제출로 인정하지 않는 것은 정상 동작이다. 대화 Backspace는 UTF-16 code unit이 아니라 grapheme cluster 하나를 지운다. 표시·paste 경로는 Unicode Cc와 Cf 제어·서식 문자를 제거하되 정상 grapheme 구성을 위한 ZWNJ(U+200C)·ZWJ(U+200D)는 보존한다. paste의 TAB·LF는 편집용으로 보존하며 표시 경로의 TAB은 공백으로 바꾼다. bidi 제어는 표시 순서를 바꿀 수 없어야 하고, 폭 0의 정상 grapheme을 단지 폭이 없다는 이유로 버리지 않는다(DR19).

**MUST NOT [TUI-003]** host TUI의 실행 파일·소스·설정·소켓을 §12의 sandbox mount 목록에 추가한다. 설치 디렉터리를 통째로 mount하는 경우(`SB-002`) 배포 layout이 선언한 product surface 경로(`dist/src/tui`, `dist/src/entry/oma.js`와 그 원본)는 같은 mount 계획 안에서 가려야 하며, 가린 자리는 쓰기 가능한 공간이 되어서도 안 된다. Resident의 `--help`, 도움말 텍스트, 오류 메시지에서 TUI나 Control Panel을 발견할 수 없어야 한다. 모델이 host TUI가 여는 어떤 endpoint에도 연결할 수 없어야 한다.

**MUST [TUI-004; arch §23.3]** Principal Pi session의 실행 권한은 OMA host가 소유한다. DR22에 따라 대화형 화면은 동봉 Pi InteractiveMode와 원본 pi-open-tui가 담당하고, headless adapter와 Resident는 RPC를 사용한다. 대화형 editor의 제출도 부모 PrincipalSession의 admission을 거쳐야 하며 Pi의 steer/follow-up 경로로 우회하지 않는다. PR-001의 단일 attach, PR-003의 private context 보존, PR-004의 model-facing tool 제한은 이 entrypoint가 그대로 진다. Principal의 논리 identity는 bootstrap 때 만들고 TUI 실행 여부와 독립적으로 유지한다. TUI 종료는 새 Principal 생성의 trigger가 아니다. society당 engine은 하나이며 그 하나를 정하는 것은 REC-007의 host lease다. DR35: private 대화 engine은 이 프로세스의 lease·프로젝트 binding·설정·private 경로가 확인되고 broker를 시작한 뒤 준비할 수 있다. Principal 권한은 이 프로세스가 띄운 broker가 복구와 rootfs 수리 뒤 준비를 알리고 같은 engine의 등록에 credential을 발급한 뒤에만 생긴다. engine 생성·broker pid·화면 표시를 Principal 권한이나 Society 준비 완료로 해석하지 않는다. 소유하지 못함이 확정되면(lease를 다른 프로세스가 쥠, 다른 broker가 이미 듣고 있음, broker를 띄우지 못함, 자식이 소유 status로 끝남, 재시작 한도 소진) engine을 시작하지 않는다. 이미 시작한 engine에 대해서도 같다. 소유를 잃는 사건은 통지가 아니라 teardown이다: 그 순간 살아 있던 session을 닫고 전달을 멈춘 **뒤에** lease를 놓는다. 닫았다는 것은 신호를 보냈다는 뜻이고 죽었다는 뜻이 아니므로, 정상 종료는 운영체제가 engine을 거두었음을 확인한 뒤에 lease를 놓는다 — 상한을 두되, REC-007의 상속된 fence가 그 상한을 넘긴 경우까지 덮는다. 소유가 허락하는 모든 것은 한 객체에 묻는다: 시작·전달·설정 쓰기·확장 토글·종료가 각각의 flag가 아니라 같은 tenure에게 묻고, lease를 잡지 못한 Control Panel은 설정과 확장을 포함해 society의 어떤 바이트도 쓰지 못한다. lease를 놓은 다음부터는 다른 `oma`가 society를 가져갈 수 있으므로, 그 경계를 넘어 살아남은 session은 두 번째 engine을 시작하는 것과 같은 위반이다. 소유를 잃은 뒤에 broker가 다시 준비를 알리더라도 engine을 다시 시작하지 않는다. 이 프로세스에는 principal host endpoint와 credential이 없어 그 engine은 society에 요청할 authority가 없으면서 같은 private workspace와 같은 session 기록의 두 번째 writer가 되기 때문이며, 그 경우 제품은 같은 상태를 보는 Control Panel로 남고 그 이유를 화면에 적는다.

**MUST [TUI-005]** Principal의 model 선택 대상은 host가 `HostConfig`에 선언한 model profile 이름뿐이다. caller는 provider, URL, header, credential, 가격, token 상한을 지정하지 못한다. 선택은 host authority를 고쳐 쓰는 것이므로 CFG-005의 policy revision 갱신을 동반하고, **다음 Principal session부터** 적용한다. 진행 중인 session이나 stream의 model을 바꾸지 않는다.

session 경계를 넘지 않는 per-request 전환은 하지 않는다. inference는 동봉 엔진이 소유하므로(INF-001) OMA에는 요청마다 model을 바꾸거나 예산을 검사하는 경로가 없다. `principal.attach`(IPC-011)는 Principal CLI의 credential handshake이지 model 전환 경로가 아니다. 호출 경로 없이 선택 API만 추가해 구현된 것처럼 표시하지 않는다(TRACE-002).

**MUST NOT [TUI-006]** 현재 model 선택, 읽음 상태, UI 위치, 최근 화면 같은 TUI 상태를 여섯 durable entity에 추가하거나 새 표·컬럼·sidecar 파일로 저장한다. 재시작 후에도 유지되어야 하는 선택은 host config의 해당 필드로 표현하고, 그 외 UI 상태는 A-007의 메모리 전용 runtime 상태로 두며 crash 후 원본에서 재구성한다.

**MUST [TUI-007; arch §23.6]** 값 확정 시 저장하고 별도 Save 단계나 dirty state를 두지 않는다. 편집 중 Esc는 확정 전 값으로 되돌린다. 화면은 각 항목의 **적용 시점**을 함께 표시한다.

| 변경 대상 | MUST 반영 시점 | 근거 |
|---|---|---|
| Resident 수 증감 | 즉시 | LIFE-001/003/004의 기존 mutation |
| role의 model profile 내용 | 다음 runner activation | runner가 activation마다 config snapshot을 읽음 |
| Principal model | 다음 Principal session | TUI-005 |
| slot 수, quota cap, pricing, protected path, check argv | broker 재시작 | broker가 시작 시 config를 고정 |
| worker의 `code.integrate` (Worker integrate) | 이후 만드는 worker부터 | AUTH-001, LIFE-008, [DR4](design-revisions.md) |

**MUST [TUI-008]** `initialResidents`에 대응하는 항목은 bootstrap seed로만 표시하고 실행 중 society의 Resident 수를 바꾸는 값으로 제시하지 않는다. LIFE-009에 따라 값 변경이 다음 재시작에 agent를 자동 생성·삭제·중지하지 않는다. 현재 Resident를 늘리거나 줄이는 조작은 설정 항목이 아니라 명시적 lifecycle 행위로 분리해 표시한다.

**MUST [TUI-009]** 이미 생성된 Resident의 `ResolvedAgentSpec.modelProfile` 참조는 LIFE-008에 따라 고정이다. 설정 화면은 참조가 가리키는 profile의 내용만 바꾸고 참조 자체를 바꾸지 않는다. 저장된 참조를 현재 배포가 해석하지 못하면 `UNSUPPORTED_PROFILE`로 차단하고 임의 profile로 대체하지 않는다. config 의미가 바뀌면 CFG-005/D02의 정책에 따라 policy revision을 갱신한다.

**MUST [TUI-010; arch §23.7]** Extensions 화면의 목록 출처는 host가 `installation.libdir` 아래에 이미 배치한 파일과, [DR25](design-revisions.md)에 따라 Human이 `oma pi install`로 oma의 패키지 저장소(`installation.packages`)에 설치한 패키지의 extension 파일뿐이다. 설치는 `oma pi`의 명시 명령으로만 하며 화면에서의 임의 경로 입력, 자동 탐색, 네트워크 설치를 허용하지 않는다. core OMA extension은 항상 첫 항목으로 고정하고 해제할 수 없다. 선택한 항목의 SHA-256을 기록하고 실행 직전에 다시 확인한다. [DR26](design-revisions.md)에 따라 확장 실행 코드는 설정 문서의 1 MiB/합계 8 MiB 제한에 포함하지 않으며, 고정 메모리로 파일을 해시하고 읽기 전후 동일성을 확인한다. 추가 extension은 Pi host process와 동일 권한의 trusted deployment code이며 model tool로 취급하지 않는다. 이 화면은 host 전용이고 모델·workspace·mail 내용이 목록·선택·적용에 영향을 주지 못한다.

**MUST [TUI-011; arch §23.8]** Mail 화면의 읽지 않음 표시는 기존 `deliveries` flag에서 파생한 값이며 새 durable 상태가 아니다. ACK 조작은 MAIL-009의 의미만 갖는다. UI 문구가 `presented=understood`, `ack=approved`, `ack=읽음 완료`를 암시해서는 안 된다(NEG-002). 기본 대상은 공개된 society 전체 메일(Principal 발신 GOAL, Worker 간 메일, 자동 공지 포함)이다. 각 메일은 독립 행으로 표시하고 실제 발신자 이름을 유지한다. 자동 merge 완료 공지는 ledger의 notice 메타데이터로 구분해 OMA / notice로 표시하며 요청 Worker는 상세에 표시한다. 읽지 않음 표시는 Principal 전달 대기만 뜻한다. commons/topic을 Principal prompt에 자동 주입하지 않는 A-003은 그대로 유지한다.

**MUST [TUI-012; arch §23.5]** Dashboard의 모든 수치는 VIEW-002의 관측 규칙을 따른다. 관측 시각을 함께 보유하고, unknown이나 disconnected를 running·0·성공으로 바꾸지 않는다. INF-004의 불확정 비용은 확정분과 구분해 표시하며 하나의 합계나 백분율로 뭉개지 않는다. broker에 연결하지 못하면 cached 값임과 관측 시각을 표시한다.

**MUST [TUI-013; arch §23.9]** 제품 UI는 Resident를 `worker`로 표시할 수 있으나 wire, DB, persisted 표현에는 사용하지 않는다. 표시 용어와 규범 용어의 대응은 한 곳에서 정의하고 계층마다 다시 만들지 않는다.

**MUST [TUI-014; arch §23.10]** DR22에 따라 Pi/Open TUI의 원본 표시·명령·단축키·설정을 그대로 사용한다. OMA는 일반 Human 입력의 목적지만 소유한다: 일반 입력과 follow-up 키는 PrincipalSession의 run 순서로 가고, Pi의 built-in command, extension command, `!` shell, `/settings`, `/open-tui`는 Pi가 처리한다. 사람이 입력한 `/oma-deliver`는 거부하며 이 명령은 OMA의 mail 전달만 보낸다. [DR24](design-revisions.md)에 따라 세션을 엔진 개발자에게 올리는 `/bug`와 다른 곳의 세션 파일을 가져오는 `/import`도 거부하고, 터미널 제목·`/export` 기본 이름과 위치·확장 충돌 안내는 엔진이 아니라 oma와 Human의 프로젝트를 가리킨다. OMA 관리는 Ctrl+X와 `/oma`의 Control Panel이 담당한다. [DR24](design-revisions.md)에 따라 `/new`와 `/resume`(및 엔진의 해당 키)은 OMA 세션을 열고, Config의 Principal model·Worker model 행은 각각 한 줄(`model · effort`)이며 Enter로 엔진의 model 목록과 그 model의 effort 목록을 차례로 연다.

**MUST [TUI-016; arch §23.11]** OMA는 Pi 엔진을 함께 배포하고, 실행할 엔진을 이 설치본이 가져온 것으로만 해석한다. `PATH` 탐색과 `/usr/bin/pi` 같은 대체 경로 fallback을 두지 않는다. 엔진이 없는 설치본은 `UNSUPPORTED_PROFILE`로 실패하며, 어떤 Pi가 실행됐는지 불확실한 상태로 진행하지 않는다. headless/RPC의 운영자 명시적 pin은 허용하되 절대 경로여야 하고 존재하지 않으면 거절한다. DR22 대화형 entry는 동봉 SDK와 원본 확장의 결합만 지원하므로 host-pinned 엔진을 명시적으로 거절하며 다른 엔진으로 조용히 대체하지 않는다. 엔진 entry는 동봉 패키지가 선언한 `bin`에서 읽고 저장소가 경로를 추측하지 않는다.

**MUST [TUI-017]** 실행하는 엔진에는 OMA가 소유한 agent 디렉터리를 지정한다. 지정하지 않으면 엔진이 사용자의 `~/.pi` 설정·extension·session을 공유하므로, 사용자가 별도로 설치한 Pi와 상태가 섞인다. [DR24](design-revisions.md)에 따라 이 디렉터리는 Human 한 명의 엔진 home(`<data>/oma/.engine`)이며 모든 세션이 공유하고 세션(society)마다 따로 두지 않는다. 로그인·기본 model·effort·테마·키 설정은 이 home에서 모든 세션에 유지되고, 대화·mail·Worker·git은 각 세션의 state root에 남아 그 경계에서 backup/restore·삭제된다.

동봉 엔진의 상태는 전적으로 이 디렉터리에 둔다. 사용자의 Pi 상태를 읽거나 쓰지 않으며, 사용자 Pi 설치 여부에 동작이 달라지지 않는다. 자격 증명·모델 선택은 동봉 엔진이 자기 메커니즘으로 이 디렉터리 안에서 처리하므로 OMA가 별도의 인증·모델 관리 표면을 만들지 않는다.

**MUST [TUI-019]** 설정 파일 없이 동작한다. 초기화 명령을 요구하거나 사용자가 `HostConfig`을 작성하게 만들지 않는다. D05: 새 society의 기본 이름은 canonical absolute Linux project path의 digest와 bounded slug에서 유도하고 전체 경로 binding을 mutation 전에 대조한다. 설정이 없으면 실제 설정을 만든다. 기존 slug-only state를 자동 rename/재바인딩하지 않는다. legacy binding 부재는 명시적 operator 검토 전 쓰기를 막고 mismatch는 --society로도 숨기지 않는다. 새 metadata의 형식·권한·backup·구버전 writer 제한은 [D05 결과](implementation/consistency-decisions.md)의 C2 범위를 따른다.

자격 증명·모델 선택·그 기억은 **동봉 엔진이 이미 갖고 있는 흐름**이므로 OMA가 다시 만들지 않는다. 기본 model profile은 엔진의 현재 연결로 해석되는 값이며 OMA는 provider나 credential을 스스로 주장하지 않는다. 남는 것은 society·role capability·multi-agent 예산처럼 엔진에 개념이 없는 OMA 고유 영역이고, 여기에 보수적인 값을 쓴다. 생성값은 bounded하고 디스크에 기록되며 Control Panel에서 수정 가능해야 한다. Resident에게 `code.integrate`를 기본으로 주지 않는다.

**MUST [TUI-020; arch §23.13]** 엔진이 이미 소유한 산술·프로토콜 프리미티브를 다시 구현하지 않는다. 빌려오는 프리미티브마다 소유 모듈을 하나로 두고 그 목록을 실행 가능한 검사로 고정한다. DR22의 대화형 표시는 원본 Pi/Open TUI에 위임한다. OMA는 renderer를 복제하거나 dependency를 patch하지 않으며 입력 안전성과 실행 권한 adapter만 소유한다. Ctrl+X 관리 기능의 데이터·action은 OMA가 소유하고 원본 UI의 custom component로 표시한다. headless/fallback 표시 프리미티브의 소유 경계는 유지한다.

중복을 남기기로 판단한 경우는 근거를 규범에 남긴다. 현재 남긴 것은 byte framing과 유닉스 소켓 클라이언트이며, 이유는 그 위의 OMA 정책 계층이 어차피 존재하고 설치 표면을 늘리지 않기 위해서다.

**MUST [TUI-021]** Dashboard의 broker 유래 값은 broker가 게시하는 **host 전용 status view**에서 읽는다. `status.get`은 agent unit 안의 호출자에게만 답하고 사람이 띄운 터미널은 어떤 unit 안에도 없으므로, 그 method를 부르거나 TUI 전용 socket method를 추가하지 않는다(`IPC-012`). view는 state root 바로 아래의 `0600` 파일이며 `world/`에 두지 않는다. broker는 view를 갱신 시점마다와 짧은 주기로 다시 쓰고, 멈출 때 지운다. view는 관측 시각을 담는 파생물이지 기록이 아니다. 읽는 쪽은 없음·손상·다른 society·주기의 몇 배를 넘은 오래됨을 모두 이유와 시각이 붙은 `unknown`으로 보이고, 부분만 보이거나 0으로 바꾸지 않는다. 형식·경로·주기는 한 모듈이 소유한다.

**MUST [TUI-023; arch §23.6]** 대화 표면의 OMA 소유 메모리 입력은 선언된 한도를 가진다. DR22 대화형 conversation history는 upstream engine이 소유하며 아래 OMA transcript 보유 상한을 충족한다고 주장하지 않는다. OMA fallback transcript는 최근 500 논리 줄, 전체 256 KiB, 한 줄당 1 KiB의 세 한도를 동시에 만족하는 범위만 보유하고 모든 생산자가 하나의 append 경로를 사용한다. 보유량의 단위는 append 호출 수가 아니라 줄과 byte이며, 한 번의 append가 몇 줄이든 그 줄들이 줄 한도에 계산된다. 줄 자르기는 UTF-8 code point 경계에서 수행해 저장된 줄이 깨진 byte로 끝나지 않는다. 작성 중인 Human prompt는 최대 16 KiB의 UTF-8 source bytes만 보유하며, 현재 `frameBytes`가 더 작으면 완전한 Pi prompt command의 JSON envelope까지 직렬화한 크기가 그 frame 안에 드는 더 작은 값까지만 받는다. 문자 수로 byte 한도를 대신하거나 JSON escaping 비용을 누락하지 않는다. 붙여넣기도 같은 경계를 거치고 초과 부분에서 더 자라지 않는다. 어느 부분이든 한도를 넘은 입력은 보관한 bounded prefix를 정상 prompt로 가장해 제출하지 않고 **전체 prompt를 제출하지 않으며** 화면에 한도 초과를 명시적으로 표시한다(문구는 원인별로 다르며, 거절된 paste는 `붙여넣기 한도 초과`로 아무것도 입력되지 않았음을 말한다). Human이 편집해 초과 상태를 해제한 뒤에만 제출할 수 있다. 초과 상태는 그것을 만든 원인(Human이 입력한 문자 / 거절된 paste)을 함께 보유하며, 화면이 안내하는 해제 방법과 실제 편집 동작이 원인별로 일치해야 한다. 거절된 paste는 draft에 아무것도 추가하지 않았으므로 그 뒤의 첫 편집은 draft의 문자를 지우지 않고 초과 상태만 해제한다. 아무것도 추가하지 않은 paste의 해제가 Human이 입력해 둔 마지막 grapheme을 소비해서는 안 된다. 실행 중인 run을 기다리는 Human prompt는 host에서 최대 16개만 보유하며, 초과 입력은 조용히 버리지 않고 접수 전에 거절한다. session이 prompt를 수락했는지는 제출과 같은 step에서 동기적으로 답하며, transcript에는 수락된 prompt만 들어간다. 거절된 prompt는 화면에 보낸 것처럼 남기지 않고 원문 그대로 draft로 되돌리며 거절 사유를 표시한다. 수락된 뒤 전송이 실패한 prompt는 그 prompt를 식별할 수 있게 원문과 함께 보고한다. 수락 시점에 이미 echo된 여러 prompt 가운데 무엇이 전달되지 않았는지 알 수 없는 보고는 이 요구를 만족하지 않는다. 실패한 원문은 transcript에 보존하며, draft가 비어 있으면 draft로 복원하고, 알림은 그 원문이 어디에 남았는지 말한다. 실패 뒤에도 대기 중인 나머지 prompt는 순서대로 계속 전송한다.

**MUST [TUI-022]** `oma`는 society를 실행 디렉터리에서 유도하므로 그 society는 그 프로젝트를 다룬다. canonical `main`은 첫 시작에서 프로젝트의 **커밋된 `HEAD`**로 시작한다. 가져오는 것은 clone이 가져오는 커밋 이력뿐이며 커밋되지 않은 변경과 추적되지 않는 파일은 가져오지 않는다. 가져오기는 trusted Git 환경(hook 없음, 사용자·시스템 설정 없음)에서 하며, 첫 시작 이후에는 디렉터리의 새 커밋이 canonical 이력을 움직이지 않는다 — 그 뒤 canonical 저장소는 OMA의 integration으로만 움직인다. 저장소가 아니거나 커밋이 없는 디렉터리는 빈 root commit으로 시작하고, 어느 쪽이었는지를 사용자에게 한 번 말한다.

**MUST NOT [TUI-018]** 동봉한 엔진을 수정해 제품 동작을 만든다. OMA의 동작은 신뢰된 core extension이 소유한다. 수정하지 않은 동봉 엔진은 upstream 의존이므로 A-009의 production LOC 계산 대상이 아니며, 엔진을 수정하는 순간 LOC-003에 따라 계산 대상이 된다. 측정에서 제외된다는 이유로 엔진 수정 금지가 완화되지는 않는다.

**MUST [TUI-015]** TUI는 릴리스 gate의 예외가 아니다. 이 절의 요구도 TRACE-002에 따라 단일 production owner, 실제 entrypoint에서의 call path, negative executable test, 현재 revision의 실행 증거를 갖는다. TUI 소스도 A-009의 production 원본 목록과 측정 대상에 포함하며 제품 표면이라는 이유로 누락하지 않는다.

## 19. Extension tool 표면 투영

**MUST [TSP-001; arch §23.10]** role의 tool 표면 투영은 `DIRECT`/`DISABLED`/`GROUPED` 세 모드와 group DAG로 닫는다. group member는 `{tool}` 또는 `{group}`의 명시 참조뿐이며 접두사·정규식·의미 기반 매칭을 도입하지 않는다. 다음은 모두 거절한다: 중복 group 이름, 자기 참조, cycle, 알 수 없는 group/root 참조, 한 tool의 중복 소속, disabled tool의 group 소속, 같은 tool의 direct/grouped 동시 지정, group 이름과 tool selector 충돌, 이름 문법 위반.

**MUST [TSP-002]** 투영은 authored 설정 필드가 아니라 runtime plumbing이다. role 파일의 필드 집합은 닫혀 있으므로 `toolSurface` 키가 나타나는 role 파일은 `INVALID_REQUEST`로 config 로드를 실패시킨다(D23). 기존 닫힌 `HostConfig`, wire schema, ledger schema, DB entity를 확장하지 않는다. plan은 `OMA_TOOL_SURFACE` 환경 변수로만 sandbox에 도달하고, resident 안의 trusted extension이 session 시작 때 파싱해 malformed이면 fail closed한다(TSP-007).

**MUST [TSP-003]** 투영은 bounded다. group 32개, group당 member 16개, 중첩 깊이 4, 선언 이름 총 512개, group description 512 bytes를 기본 상한으로 하며 host는 더 낮출 수 있다. 상한 초과는 접수 전에 거절한다.

**MUST [TSP-004]** 검증과 평탄화의 단일 owner는 `packages/domain/src/tool-surface.ts`다. group 해석·cycle 검출·root 유도를 sandbox 안이나 다른 계층에서 다시 구현하지 않는다. sandbox로 전달되는 것은 이미 검증된 평탄한 plan이다.

**MUST [TSP-005]** 활성 tool 집합은 다음 산술로 정한다. `disabled`는 항상 비활성, `grouped`는 소속 group을 열기 전까지 비활성, `direct`는 활성, 그 외 등록된 tool은 `defaultMode`를 따르며, root group은 활성으로 시작한다. `defaultMode`는 `DIRECT`와 `DISABLED`만 허용한다. role이 투영을 선언하지 않으면 등록된 tool을 그대로 보여준다.

**MUST [TSP-006]** group을 여는 것은 **활성화이며 실행이 아니다**. 직계 자식만 기존 활성 집합에 합집합으로 더하고, 같은 group을 다시 열어도 결과가 같아야 한다. 다른 extension이 활성화한 tool을 제거하지 않는다. OMA가 다른 extension의 tool handler를 대신 호출하거나 인자를 재해석하는 경로를 만들지 않는다. 드러난 tool은 Pi의 기존 pipeline이 실행하므로 tool_call/tool_result, 권한·safety 훅, 원본 schema, 실행 모드가 보존된다.

**MUST [TSP-007]** sandbox가 받은 plan을 읽을 수 없거나 형식이 맞지 않으면 fail closed한다. 모르는 값은 무시하고 진행하는 것이 아니라 OMA 자신이 등록한 tool만 남긴다. 투영 적용 실패가 `DISABLED`로 의도한 tool을 노출시키는 결과로 이어져서는 안 된다.

**MUST [TSP-008]** 투영은 OMA가 등록한 mail/status tool을 제거하지 못한다. role 선언이 그 이름을 disabled로 지정해도 활성 상태를 유지한다. 투영이 agent를 자기 협업 수단 없이 남기지 않는다.

**MUST NOT [TSP-009]** 투영을 권한 경계로 표시한다. 실제 권한은 §12의 sandbox mount/FD/network와 AUTH-001의 capability가 정한다. 표면에서 감췄다는 이유로 위험한 tool을 role extension에 추가하거나, PI-001의 신뢰 경계·operations의 SHA-256 재검증을 완화하지 않는다.

**MUST NOT [TSP-010]** 투영을 위해 extension을 동적으로 로드한다. role extension의 로딩과 검증은 기존 operations 계약과 Pi의 `-e` 경로가 소유한다. 임의 경로 import, cwd 기반 설정 탐색, 자동 탐색을 추가하지 않는다. 투영은 이미 등록된 tool의 표면만 다룬다.

## 20. architecture 추적 및 최종 금지 확인

**MUST [TRACE-002]** 모든 적용 runtime MUST/MUST NOT은 release 시 requirement→단일 authoritative production owner→실제 entrypoint/call path→negative executable test→현재 source revision의 실행 evidence를 갖는다. 타입/enum/comment/helper/mock만 존재하면 implemented/proven이 아니다. [compliance 계약](verification-spec.md#requirement--production-path--executable-evidence)의 파일을 release 산출물로 유지하며 runtime durable state로 만들지 않는다.

**MUST [TRACE-003]** spec 위반이 기존 requirement에 이미 금지돼 있으면 동의어 requirement를 더 만들기보다 production-path negative test와 trace를 연결한다. 계약·기계 검증과 production 통과 증거를 분리하고 누락은 unverified/blocked로 표시한다. source/spec/adapter 변경 뒤 옛 evidence를 자동 재사용하지 않는다.

**MUST [REC-008]** bootstrap/create/start/stop/batch/check의 canonical 순서는 [physical-ordering.md](implementation-spec.md#production-physical-effect-ordering)를 따른다. constructor/import에서 DB open 또는 외부 effect를 실행하지 않는다. lock 확보 전 SQLite migration/reconcile을 시작하는 숨은 호출 경로를 금지한다.

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
| §23.3 엔진 동봉/공존 (§18) | TUI-016/017; PI-001, A-009 |
| §23.10 tool 표면 투영 (§19) | TSP; PI-001, CFG-005, SB-003 |

**MUST NOT [NEG-001]** LLM이 sender·thread·ref·mail ID를 join하여 runtime 상태를 복원하게 한다. broker/view가 바로 읽고 실행할 경로를 제공한다. 내부 ID는 debug/명시적 retry에만 필요한 만큼 노출한다.

**MUST NOT [NEG-002]** `presented=understood`, `ack=approved`, `submit=merged`, `agent_end=task_done`, `principal=Human`, `more_agents=independent_reviews`, `timeout=failed`, `same_OID=same_request` 등식을 구현한다.

**MUST NOT [NEG-003]** role label을 업무 ownership lock으로 사용한다. file ownership board·focus lease·작업 수락 단계·모든 변경 mandatory review workflow를 만들지 않는다. 사회의 조정은 공개 mail/상호 요청/Git evidence이고 runtime은 권한 및 물리 조건만 강제한다.

**MUST NOT [NEG-004]** 정확한 turn 재현, 자동 tool replay, 의미적 mail dedup, private peer mail, multi-host failover, external push/deploy, 자동 GC를 Core v1의 숨은 부가 기능으로 넣는다. 필요한 경우 상위 architecture에 별도 요구로 제안하고 이 계약 범위 밖으로 표시한다.

**MUST [NEG-005]** 구현자가 모호함을 발견하면 관련 requirement/source 절, 충돌하는 두 해석, 최소 재현/실험, 차단 범위를 적어 SPIKE에 추가한다. 그 과정 자체가 새 runtime entity나 workflow를 만들 권한은 아니다. 충분히 확정된 나머지 계약은 계속 구현한다.

## Production physical effect ordering

**MUST [SEQ-001]** 아래 표는 기존 규범의 실행 순서를 고정한다. 내부 함수 분리는 허용하지만 새로운 service/state/IPC phase를 추가하지 않는다.

**MUST [SEQ-002]** 이 문서는 REC/LIFE/UNIT/BATCH/INT 요구의 canonical 호출 순서다. 하나의 단계가 실패했을 때 다음 단계로 진행하지 않는다. DB rollback이 이미 발생한 filesystem/systemd/Git 효과까지 취소한다고 가정하지 않는다. 공통 helper를 거쳐도 production entrypoint에서 이 순서가 실행된다는 증거가 필요하다.

| 경로 / production owner | MUST 순서 | MUST 실패·완료 경계 |
|---|---|---|
| broker entry → broker.ts / reconcile.ts | 안전한 runtime dir/lock file 준비 → lifetime OS lock 획득 → config 검증 → D04의 bounded recovery resource preflight → DB open/migration → old run fence/death 확인 → pending physical reconciliation → authenticated endpoint 준비 → READY=1 | lock loser는 DB open/migrate/reconcile/unit effect/READY 금지. 논리 quota 초과는 새 admission을 막되 기존 책임의 bounded recovery를 일괄 금지하지 않는다. 실제 공간 부족은 성공이 아니며 accepted evidence를 보존한다. startup reserve/효과별 admission은 WP22 gate, 소켓 존재는 READY 증거가 아님 |
| actor socket → broker create handler | auth/strict DTO/key 조회 → durable 부모에서 host 정책으로 resolved spec 계산 → T-create-intent → frozen OID clone/verify → workspace rename/fsync → mailbox/runner/unit render → daemon-reload 결과 확인 → unit LoadState/config 검증 → T-create-ready → initial mail materialize → GOAL 확인 → 필요 시 path enable/start/관측 → receipt | initialResidents에서 child를 찾지 않음. clone에서 branch를 재해석하지 않음. provisioning은 READY 아님 |
| actor socket → broker start handler | key/auth/record 조회 → retired/provisioning 거절 → 이미 정상 enabled면 no-op → old cgroup 사망 확인 → GOAL 검증 → desired enabled+op commit → path/service effect → actual 관측 → succeeded | GOAL 없는 실패가 desired/path를 새로 바꾸지 않음. process spawn만으로 성공하지 않음 |
| actor socket → broker stop handler | key/auth → T-stop-intent → path stop/disable 및 관측 → endpoint/inference revoke → service stop → descendants 사망 확인 → pending broker-owned effects 목록 → succeeded | unit effect 실패해도 desired=stopped의 inference 거절은 즉시 유효. catch에서 나머지 revoke/stop 안전 조치를 건너뛰지 않음. 사망 불명확이면 unknown |
| runner → runner.open | unit/cgroup invocation 인증 → durable RuntimeAgentRecord 조회 → desired/GOAL 검사 → 이전 run 사망 → D01·DR9 이전 시도 receipt 관측 및 T-batch-complete → agent incarnation 증가 transaction(나머지 prepared batch row는 그대로, 새 lease가 이어받음) → 제한 endpoint → frozen spec 기반 sandbox/Pi | receipt IO는 T 밖, exact batch/state 재검사는 T 안. unreadable/conflict는 rollover/재전달 금지. completed incarnation 유지, seed/default fallback 금지. endpoint 준비 실패를 live run으로 반환하지 않음 |
| trusted batch.prepare → mail.ts | owner/incarnation 검사 → T-batch-prepare snapshot/연결 commit → new→cur/fsync → inbox view atomic publish → PreparedBatch 응답 | DB commit만 끝났는데 PreparedBatch 성공 응답 금지. post-transaction 실패면 prepared 상태를 남겨 같은 prepare로 복구; batch.stage 없음 |
| trusted batch.complete → mail.ts | auth/fencing → pinned adapter revision/path 확인 → trusted durable receipt 검증 → T-batch-complete/presented commit → completed:true | DTO field·file existence·agent_end boolean은 증거 아님. receipt 불일치·위조는 commit 없이 `SESSION_BOUNDARY_UNCONFIRMED` 또는 `BATCH_CONFLICT` |
| git.integrate → git.ts / sandbox.ts | identity/auth/profile 지원 gate → 조건 검사 → pending intent → exact candidate/check-profile snapshot으로 kernel-bounded 검사 → 실제 종료 결과 → final policy/base/authority 재검사 → CAS → ref 대조 → base receipt 또는 tiered fixed mail 보충 → succeeded | resource primitive 미검증인데 nonempty checks 실행 금지. checks를 []로 대체 금지. test timeout/signal/관측 불명확을 PASS로 변환 금지 |

**MUST [SEQ-003]** lock 전 허용 작업은 argv/path 문법 검사와 lock 획득에 필요한 trusted runtime directory mkdir/open뿐이다. state root 초기화, SQLite constructor/open, migration, Git/systemd effect, reconciliation을 import/constructor의 side effect로 실행하지 않는다. DB 연결 factory는 lock 획득 이후에만 호출한다. 동시 두 broker 시험에서 loser가 DB-open seam에 도달하지 않았음을 검증한다.

**MUST [SEQ-004]** create-ready는 생성 가능한 물리 자원이 준비됐다는 뜻이다. 최초 GOAL 전에는 ready/stopped 또는 enabled-with-GOAL-gate 상태에서 inference 없이 준비될 수 있다. 단, 실패한 explicit start에서 desired를 enabled로 바꾸지는 않는다. bootstrap 복구·일반 start의 성공 의미를 혼동하지 않는다. 위 표가 기존 절과 불일치하면 두 문서를 함께 정정하고 제3의 순서를 코드에 만들지 않는다.

## Current owner lookup — 비규범적 안내

이 문서는 ordering만 소유한다. 현재 구현 owner/call path를 여기 표로 복제하지 않는다.

- requirement/source owner: [source-owners.json](../implementation/source-owners.json)
- durable mutation별 owner/change surface: [mutation-owners.json](../implementation/mutation-owners.json)
- current 실행 상태: [validation.md](implementation/validation.md)

Owner가 이동해도 위 SEQ 규범의 의미가 자동으로 바뀌는 것은 아니다. Ordering 변경이 필요하면 architecture/spec과 이 문서를 함께 검토한다.

## Store opening: compatibility before writer setup

`packages/storage/src/store.ts` owns this boundary. This is a C1 correction, not a schema migration,
a second writer, a new recovery service, or a live-authority decision. Current
verification status belongs exclusively to [validation.md](implementation/validation.md).

## Preconditions and phases

The broker startup composition must already hold its process/society single-writer
fence. File identities and a successful schema observation do not establish that
authority. The no-mutation refusal contract concerns closed/quiescent database
artifacts under that ownership; it is not protection against an independent writer
or same-UID operator concurrently changing the files.

1. **Identify the path and existing evidence.** The Store API takes a filesystem
   path (or the existing `:memory:` special case), not a SQLite URI. Database and
   sidecar leaves must be regular, singly linked files. A different hard-link name
   can hide the original name's WAL; it is not an alternate safe database identity.
   The native reader URI is constructed internally with URL escaping.
2. **Inspect compatibility without writer setup.** Observe the database, `-wal`,
   `-shm`, and `-journal` identities. Missing database plus sidecars is unavailable,
   not a new database. A journal, or an incomplete WAL/SHM pair, is preserved and
   refused rather than recovered, deleted, or treated as absent.
3. **Read the actual SQLite view.** With existing WAL and SHM, use the read-only
   Unix-VFS `readonly_shm=1` path. Never ignore those files with `immutable`.
   Only when all sidecars are absent, under the startup fence, use a read-only
   immutable main-file view to avoid SQLite creating empty WAL/SHM files during
   the compatibility query. Recheck file identities and sidecar absence before
   writer setup. This conditional absence check is not an immutable fallback after
   a failed WAL read, and is not a substitute for the startup fence.
4. **Apply the explicit format boundary.** Read `user_version` through SQLite,
   using the existing readable-version registry and integer decoder. An
   unversioned database is eligible for initialization only when `sqlite_schema`
   is empty. An arbitrary version-zero database with objects is not a fresh OMA
   database. A corrupt header or unavailable native observation does not authorize
   migration. Close the observation connection before opening the writer.
5. **Set up the one writer.** Only after compatibility admission, apply the
   existing foreign-key, WAL, FULL synchronous, and busy-timeout PRAGMAs, then the
   existing v1 migration and reader/transition/journal composition. Supported-v1
   reads still go through the existing relational decoders.
6. **Transfer ownership only on successful construction.** Until then the
   constructor owns the native connection and closes it on every subsequent
   throw. The broker lifetime can retain only a successfully returned Store.

The SQLite option is native-backend behavior, not a portable property of
`readOnly: true`. Runtime qualification must exercise the actual Node/SQLite/VFS
combination, including retained WAL whose committed version differs from the main
header. A pre-existing writable SHM node in the same process is not the closed-file
startup condition: the VFS can reuse that node. The opening helper does not grant
permission to share a live writer or open arbitrary concurrently managed SQLite
connections. The administrator's `readDiagnosticSnapshot` remains a separate,
bounded read-only diagnostic path; it is not a Store writer and does not inherit a
claim that SQLite never touches diagnostic sidecars.

## Failure and resource ownership

Unsupported versions are rejected before writer PRAGMAs, recovery, or DDL. Missing
or ambiguous evidence remains unavailable. Native SQLite errors retain their
native cause; an I/O/locking error is not evidence of absence. Compatibility refusal
does not request repair, deletion, or renaming of a sidecar. After a supported
database is admitted, normal SQLite writer checkpoint/sidecar behavior still
applies, including during cleanup of a later initialization failure.

Migration rollback is attempted only while the native connection still reports a
transaction. Its primary failure and any rollback failure remain in the cause
chain. If constructor cleanup also fails, preserve both initialization and close
failures. A close failure does not prove termination or authorize automatic replay;
retain the artifacts and follow the failed-startup lifetime policy.

A closed JavaScript SQLite handle need not immediately remove every native file
descriptor while another same-process connection holds a POSIX file lock. SQLite
can defer native closes so that closing one connection does not release the other
connection's locks. The resource oracle therefore checks handle closure, an
independent process's inability to acquire the held writer lock, and the descriptor
baseline after the final lock owner closes. Never force-close those descriptors to
make an intermediate count match.

A compatible read-only view does not establish write availability. Permission
denial can be observed during writer setup or at the first write transaction.
POSIX permission-denial fixtures are not read-only-mount/EROFS, storage-power-loss,
or manager-lifetime qualification.

## Transaction and relational boundaries retained

The opening change does not replace `TransactionScope` or create a second mutation
path. Its `AsyncLocalStorage` context, exact Store owner, captured active scope,
and invalidation on exit remain connected to compatibility methods and write
facets. Admission checks and the original-acceptance-only plan rule remain in that
scope. A Promise/thenable result is still refused before commit; rollback cannot
cancel an external effect already started by an invalid asynchronous callback.

`Store.transaction` still checks newly inserted operations through the full reader
and validates pending transitions before COMMIT. `LedgerReader` retains its row,
operation, batch, incarnation, and delivery-link checks. No schema-version refusal
weakens valid-v1 decoding, introduces a header-only trusted row, changes a receipt
format, or grants stale live authority. Normal transaction error handling outside
constructor/migration initialization is unchanged by this work.

The production-linked cases are in `test/store-open.test.ts` (V04A/V04B), alongside
existing `r10-ledger-rows`, `r11-transactions`, `r12-ledger-transitions`,
`r17-lifetime`, and `persisted-format-boundary` regressions. Fixture observations use
physical artifact identities/bytes and native SQLite handles, not an expected
result copied from the production preflight.

## Compatibility and rollback

The v1 DDL, readable/written format registry, wire contract, and live fencing are
unchanged. Ordinary new databases, existing supported-v1 DELETE databases, and
supported-v1 WAL databases retain their normal path. Unknown, corrupt, aliased, or
unavailable inputs are not silently initialized. The sidecar-preserving refusal is
intentionally stricter than allowing SQLite to recover an unknown database first.

Reverting the code is not a rollback of durable database facts. It can restore the
old writer-PRAGMA-before-refusal behavior. Preserve the database and its sidecars
together for an explicit, quiesced recovery decision; do not make an unsupported
input appear supported by deleting evidence, changing `user_version`, or copying
only the main database file. No automatic downgrade or operational recovery action
is authorized by this document.

## Contract owners — P2

`../contracts.ts` remains the compatibility/spec facade. The original P2 surface
is pinned independently of the reviewed additions below. Historical persisted
plans retain their interpretation; additions do not reauthorize old facts.
These files are normative declarations, not new services.

**Reviewed contract change, 2026-09-19 (inference).** `InferenceModule`,
`InferenceStart` and `InferenceEvent` were removed. INF-001 now places inference
with the bundled engine, so OMA declares no relay port and no provider stream
DTOs. The `usage` table and the six durable entities are unchanged; only the
relay's own surface went away.

**Reviewed contract change, 2026-09-19 (direction).** The four frozen reverse dependencies
recorded in `../contract-direction-plan.json` were removed. `Capability`,
`ResourceLimits` and `ProtocolLimits` are now declared here, and the runtime
descriptors in `packages/domain/src/` are bound to them by compile-time exhaustiveness
checks in both directions. The `Transaction` alias was deleted rather than
replaced by a port: `StorePort.transaction` takes a zero-argument callback and
nothing consumed the contract's `Transaction`, so a port would have been an
abstraction with no caller. The golden surface below was regenerated for exactly
these four declarations and nothing else.

**Reviewed contract change, 2026-09-29 (model effort, DR24).** `ModelProfile`
gains one optional field, `thinking?: EffortLevel`, and `host.ts` declares
`EffortLevel`, the engine's seven effort level names. A profile without it
means what it meant before -- the engine's default effort -- so every existing
configuration stays valid; the closed-schema validator accepts only those
names. No wire method, persisted plan or other declaration changes. The golden
surface is not regenerated: the test projects out exactly these two additions,
each of which must occur once, as it does for IPC-008's receipt paging.

**Reviewed contract change, 2026-09-29 (installed packages, DR25).**
`HostConfig.installation` gains one optional field, `packages?: string`,
the absolute directory the packages `oma pi install` installs live in. A
configuration without it means what it meant before; a role's extension entry
that names an installed package (`packages:<path>`) needs it. No wire method,
persisted plan or other declaration changes; the test projects this addition
out as it does the others.

**Reviewed contract change, 2026-10-01 (DR27, implementation in progress).**
Society execution intent and exact-candidate attestations add `society.set` and
`attest.record` wire/plan/result variants. Integration adds Worker-requested tier,
accepted policy/authority snapshots and fixed post-CAS publication; explicit GOAL
mail adds its publication intent and no-op witness. `agent.wait` gains read-only
observation. Historical declarations are still checked against the original golden:
only exact reviewed deltas are projected out. New declarations are compared with
explicit syntax in `test/fixtures/contracts-dr27-additions.json`; missing or changed
additions fail rather than disappearing into the projection. Runtime wire vectors
keep the original examples and add the two methods separately. `TieredPolicy`
belongs to the host configuration owner; `integration.ts` re-exports it for existing
imports and uses it for acceptance evidence, avoiding host ↔ integration cycles.
Neither these contracts nor their tests certify the unfinished trusted candidate
executor. Default profiles still have no `code.integrate` grant.

Dependency direction (arrows mean imports):

```text
public-wire    -> durable, runtime, values, identity, errors, attestation
internal-wire  -> runtime, values, identity, errors
durable        -> host, values, identity, errors, integration, attestation
integration    -> host, values
attestation    -> identity, values
host           -> values, identity
runtime        -> identity
errors, values -> identity
identity       -> owns the closed capability vocabulary
host           -> owns the resource/protocol limit field names
module-contracts -> leaf contracts + existing module ports
compatibility facade -> its explicitly named owners (type-only re-exports)
```

`values.ts` is a deliberate refinement of the proposal: common request/message
value declarations must not force durable -> public-wire -> durable. It owns the
unchanged MailInput/AgentCreateInput/context/blob/candidate values, not policy.
`module-contracts.ts` keeps compatibility module declarations out of wire and
persisted definitions. No new capability vocabulary or runtime schema is copied.

`test/fixtures/contracts-v1-surface.json` pins the original source blob and the
normalized token digest of every original declaration. Import-type paths are
compared by repository-relative identity; all other tokens participate. Token
kinds use symbolic names, not compiler-version-dependent enum numbers. It must
not be regenerated as part of normal builds. An intentional future contract
change needs an explicit reviewed delta or a separate reviewed golden update. `contracts-ownership.test.mjs`
also checks facade names, private helper drift, leaf cycles and the architecture
checker's resolution through re-exported symbols. This syntax/equivalence test
is not a substitute for the full pinned typecheck or runtime wire fixtures.

## Unit renderer 계약

이 절의 UNIT-TPL-*는 DR49 이전의 역사 계약이다. 원래 ID·형식의 의미를 보존하며 새 설치나
native 실행에 적용하지 않는다. 원본 renderer와 시험은 [보관 기록](archive/systemd-reference-2026-10-26/)에 있다.

**MUST [UNIT-TPL-001]** 이 4개 `.in` 파일을 [상위 구현 계약](implementation-spec.md)의 UNIT 요구와 함께 사용한다: Resident당 service/path 한 쌍, Principal relay service와 principal path다. Resident service는 path가 시작하며 독립 enable target은 없다.

**MUST [UNIT-TPL-002]** renderer는 user unit directory의 `oma-<society>-...` 이름으로 atomic 설치하고 `systemctl --user daemon-reload` 후 필요한 unit만 enable/start한다. state root는 config와 일치하는 절대 path다. 입력의 systemd `%` 및 ExecStart 인자 escaping을 검증한다. fixed installation Node executable과 compiled TypeScript entrypoints를 사용한다.

**MUST [UNIT-TPL-003]** template에 없는 task service, inference daemon, Git daemon, mail server, supervisor를 추가하지 않는다. host.js는 기존 broker에 host-only IPC를 호출하고 종료하는 entrypoint다. unit 이름을 model이 임의 제공하지 못한다.

**MUST [UNIT-TPL-004]** 실제 설치 전 rendered units에 `systemd-analyze --user verify` 또는 지원 환경의 동등한 verify를 실행한다. ExecStart를 true로 바꾼 검사본은 문법/dependency 검사일 뿐 runtime 통과가 아니다. Type=notify와 SO_PEERCRED/cgroup/종료 경계는 S-01/S-06 실서비스 검증이 필요하다.
