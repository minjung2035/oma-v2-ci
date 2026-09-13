# ORDER-002 변경 기록 — 안전성 보존형 아키텍처 개선 (P0~P9)

[ORDER-002](../../implementation-spec.md)가 요구하는 항목을 이 작업 단위 하나로 기록한다. 착수 revision `d13310585c412fef3e32db24ba2b42b7b006b1f5`, 기록 시점 revision `HEAD`(아래 커밋 목록의 마지막), 브랜치 `refactor/safety-preserving-architecture`.

## 1. 변경 requirement IDs

| requirement | 변경 내용 | 종류 |
|---|---|---|
| P1/`operation-exhaustiveness` | `OPERATION_CODECS`: kind→기존 validator binding registry 신설, decode 경계가 이를 사용 | 구조 (의미 불변) |
| MAIL-005 / ID-003 | OMA header metadata 검증 전 RFC 5322 unfold (emit/parse 대칭) | 실제 bug fix |
| ID-003 | `context.publish`의 `expected`를 repository object format으로 먼저 검증(`INVALID_OID`) | 계약 일치 (submit/integrate와 대칭) |
| CTX-001/002/FS-003 | context publish의 입력 검증을 base 비교보다 먼저; 거부된 요청은 소유 staging을 회수 | 물리 순서 (아래 §5) |
| VIEW-002/003 | unit log view를 process owner policy(`runJournal`)로 이전, truncation 의미 보존 | 구조 (의미 불변) |
| FS-001/002/003, MAIL-008, CTX-004 | durability primitive에 test-only observer seam | test-only 추가 |
| REC-005/006/007 | 두 번째 broker 소유 충돌을 `BROKER_UNAVAILABLE`로 보고, recovery 실패 진단 메시지 보존 | 분류 일치 |
| ERR-001 | phase/effect 지식에 따른 terminal 분류는 기존 taxonomy 그대로 사용 (변경 없음) | 변경 없음 |

새 requirement, 새 entity, 새 durable state, 새 wire method를 추가하지 않았다. `implementation/contracts.ts`, `schema-v1.sql`, `implementation-spec.md`, `architecture.md`, `physical-ordering.md`, `compliance.md`, `spikes.md`, `test-matrix.md`, `loc-budget.md`, systemd template은 **수정하지 않았다**.

## 2. LOC 전후 (code lines, `node scripts/loc.mjs`)

| 항목 | 착수 `d133105` | 현재 |
|---|---|---|
| TOTAL production | **12,163** | **12,378** (+215) |
| 파일 수 | 146 | 146 (P8의 `src/domain/persisted-formats.ts` 만 추가, 동일 계층) |
| A-008/A-009 | review required | review required (10,000 초과, release gate FAIL 유지) |

증가의 구성:

| 영역 | 증가 | 성격 |
|---|---|---|
| `src/domain/persisted-formats.ts` | +128 | P8 version/portability metadata (신규 파일) |
| `src/storage/durable-fs.ts` | +109 / −? | P7 fault seam (leaf primitive 한정) |
| `src/storage/immutable-file.ts`, `context-stream.ts`, `batch-view.ts` | +64 | P7 seam 전달 + 소유 staging 회수 |
| `src/git/context.ts`, `context-repository.ts`, `git.ts` | +24 | format 검증, 준비 구간 소유 정리 |
| `src/mail/headers.ts`, `src/process/*`, `src/broker/logs.ts`, `src/git/canonical-command.ts`, `context-mirror.ts` | −27 net | process owner 경유로 이전(중복 spawn 코드 제거) |
| `src/store.ts`, `src/reconcile.ts`, `src/domain/admission.ts`, `src/domain/context-policy.ts`, `src/protocol/run-lease.ts` | +14 | version 경계 상수 사용, 분류/메시지 |

목표(8,000 code lines)와 A-009 상한(10,000)을 넘는 상태는 착수 시점부터 이어졌고 이 작업이 해소하지 못했다. 새 기능 확장이 아니라 **검증/불변식 metadata와 owner 경유 이전**이 증가분의 대부분이다.

## 3. 수행한 tests (현재 revision, 정확한 command)

```sh
npm run inventory && npm run check:inventory && npx tsc -p tsconfig.json --noEmit && npm run build && npm run check:package && npm run check:architecture
# per-file suite: 135 file, 0 nonzero exit (파일별 실행, timeout 400s)
node --test --test-concurrency=1 dist/test/<file>.test.js
node --test --test-concurrency=1 test/*.test.mjs
node scripts/check-state.mjs --state <root> --society demo --mode offline --quiesced   # P6 fresh evidence
node scripts/powercut-lane.mjs --phase prepare ...                                     # guard만: UNSUPPORTED_PROFILE
```

P7/P8/P9의 신규 oracle: `durable-fault-matrix` 9, `persisted-format-boundary` 5, `persisted-state-fuzz` 7, `powercut-lane`(guard) 4, `unit-logs-view` 4, `dependency-lattice` 6. P6 재검증: `integrity-ledger` 10, `integrity-files` 11, `integrity-publications` 3, `diagnostic-admin` 7.

## 4. 남은 SPIKE / 미검증

- S-06 openat2/커널 containment: OPEN (P7 seam은 프로세스 crash 모델일 뿐 power-loss 증명이 아니다).
- S-03 receipt gate, S-08/S-10 tiered attestation: OPEN.
- VM power-cut, ENOSPC, read-only remount, backup/restore: **NOT_RUN**.
- `verify:*` lane runner: **NOT_RUN** (개별 file 실행과 별개).
- live systemd/cgroup integrity 관측: **NOT_RUN**.

## 5. schema / method / state / service 변경 유무

**없음.** 근거:

- schema: `PRAGMA user_version`은 1 그대로이며 readable set을 명시적으로 좁히기만 했다(DDL·table·column 변경 0). `implementation/schema-v1.sql` diff 0.
- method: `src/protocol/methods.ts`의 public/internal method 목록 변경 0. `OPERATION_CODECS`는 기존 kind에 validator를 binding할 뿐 새 method를 만들지 않는다.
- state: 새 durable entity/table/queue/파일 종류를 추가하지 않았다. `persisted-formats.ts`는 persisted metadata(코드 상수)이며 durable state가 아니다.
- service: systemd unit/template/socket 변경 0.

## 6. 물리 순서 변경 (별도 판단 기록)

`context.publish`에서 base conflict 비교 위치를 좁게 조정했다.

```text
이전: base 비교 → stream 준비(검증+staging) → candidate 준비 → authority/base 재확인 → mail → accept
현재: format 검증 → stream 준비 → base 비교 → candidate 준비 → authority/base 재확인 → mail → accept
```

- 근거: ERR-001이 `INVALID_REQUEST`를 "입력 수정"으로, conflict를 "다시 읽고 재시도"로 분류한다. 둘 다 참일 때 conflict를 먼저 보고하면 caller가 같은 malformed 입력을 반복한다.
- 보존: 검증 항목 자체는 동일하며, `physical-ordering.md`의 MUST("candidate 준비·mail 렌더 대기 뒤 expected/current authority 재확인")는 그대로 유지된다(준비 뒤 재확인 2회 유지).
- 부작용 제거: 준비와 acceptance 사이에서 거부되는 요청은 이 호출이 만든 staging만 정확히 회수한다(`discardContextPreparation`, 소유 파일만 unlink, 비정규 entry는 거부). accepted operation의 staging은 recovery가 사용하므로 남긴다. oracle: `test/context-security.test.ts`의 "a rejected context publish leaves no staging artifact".
- 규범 문서 변경이 필요하지 않다고 판단한 이유: 이 MUST는 "준비 뒤 재확인"을 요구할 뿐 "준비 전 비교 금지"를 두지 않는다. 반대로 MUST를 바꾸는 변경(예: 준비 순서 자체 변경)이었다면 별도 architecture/spec 변경으로 처리해야 한다.

## 7. 이번 기록에서 제외한 것

- `docs/architecture-improvement/*`: 이 작업의 실행/판정 기록이며 규범이 아니다. `implementation/README.md` §D에 따라 historical 취급된다.
- `production-files.txt`, `production-loc.json`, `production-loc-hashes.json`, `docs/architecture-improvement/evidence/p5-dependency-graph.json`: generator 산출물이며 손으로 고치지 않았다.

## 8. 자체 감사(규범 위반/부족한 수정 점검)에서 찾아 고친 것

| 발견 | 성격 | 조치 |
|---|---|---|
| `readUnitLogs` 이전이 stderr overflow를 명령 종료로 바꿈(이전 구현은 stderr cap만 하고 계속 읽음) | **의미 회귀** | `runJournal`에 `stderrOverflow: "discard"` + stdout truncation만 성공으로 처리, VIEW-002 의미 복원. `test/unit-logs-view.test.ts` 4 PASS로 고정 |
| `context.publish` 재정렬이 거부된 요청에 staging artifact를 남김 | **부작용** | 준비~acceptance 구간 소유 staging 회수(`discardContextPreparation`), oracle 추가 |
| `phase8` 이동된 published ref 복구를 `unknown`/`failed` 둘 다 허용 | **oracle 완화** | owner가 `GitPublicationObserver`에서 명시적으로 `REF_STATE_UNKNOWN`을 던진다는 사실을 확인하고 `unknown`+`errorCode=null`+`resultJson=null` 단일 결과로 고정 |
| `phase4` extension 거부 코드를 두 개 허용 | **oracle 완화** | 실제 결과가 `AUTH_FAILED`로 결정적임을 확인하고 단일 코드로 고정 |
| `identifierMirrors`가 파일 전체 예외였음 | **checker 예외 범위** | 예외를 조건부로 변경: mirror는 owner의 regex와 **동일한 literal만** 허용, id grammar 추정 literal이 다르면 finding. 음성 fixture 2건 추가. extension의 template grammar는 `id-contracts`의 host/extension 동등성 corpus로 고정(ordinal 표기 포함) |
| `mail-integrity`의 plan arm이 durable `materialized` 플래그 검증을 잃음 | **oracle 약화** | raw flag read helper 추가로 원래 속성 복원 |
| `p0-hardening`의 malformed frame에서 transport close 검증이 사라짐 | **oracle 약화** | 짧은 alarm deadline + bounded poll로 close 속성 복원 |
| `OPERATION_CODECS` binding 오류를 탐지하는 oracle 부재 | **미흡한 검증** | 11 kind 전체에 대해 자기 plan/result만 수용하는지 확인하는 test 추가 |
| ORDER-002 변경 기록 부재 | **규범 누락** | 이 문서 |
| phase5 smoke 실패 원인 오진(빈 stderr) | **진단 누락** | 원인은 host control socket 미생성. fixture가 실제 listening socket 생성, promise를 close에서 resolve, 메시지에 exit code/signal 포함 |

감사 후 전수 재실행: 135 file / 0 nonzero exit, `check:architecture` PASS. LOC는 12,378 code lines로 A-008/A-009 review 조건 초과는 그대로 남는다.
