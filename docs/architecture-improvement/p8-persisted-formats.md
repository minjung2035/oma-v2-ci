# P8 — persisted format inventory, version boundary와 portability 정책

제안서 §13의 P8 결과다. 이번 작업은 **v1 writer format을 바꾸지 않는다**. 대신 (a) 모든 persisted field를 분류한 inventory, (b) 명시적이고 테스트 가능한 version boundary, (c) host-derived locator의 portability 정책을 코드와 테스트로 고정했다.

## 1. persisted surface inventory

| 저장 위치 | field | 분류 |
|---|---|---|
| `operations` | `id`, `actor`, `request_key` | intrinsic identity |
| `operations` | `payload_json` | immutable logical fact (정규화된 caller 요청) |
| `operations` | `plan_json.message.id` | intrinsic identity |
| `operations` | `plan_json.message.{to,recipients,kind,contextRevision,replyHeaders,sha256,bytes,dateMs}` | immutable logical fact |
| `operations` | `plan_json.message.objectPath` | derived durable identity (state root에 대한 상대 경로) |
| `operations` | `plan_json.{spec,specHash,unitNames}` | immutable logical fact / derived durable identity |
| `operations` | `plan_json.workspacePath` | **host-derived physical locator** |
| `operations` | `plan_json.bundle.path` | **host-derived physical locator** |
| `operations` | `plan_json.stagingPath` | **host-derived physical locator** |
| `operations` | `plan_json.publishedRef`, `plan_json.candidate` | derived durable identity |
| `operations` | `result_json` | historical result |
| `agents` | `spec_json`, `spec_hash` | immutable logical fact / derived durable identity |
| `agents` | `desired`, `incarnation` | current durable state (mutable, versioned by row) |
| `deliveries`, `batches`, `subscriptions`, `usage` | row flags/ids | derived durable identity 또는 current durable state |
| `mail/objects/<id>.eml` | bytes | immutable evidence |
| `mail/archive`, `mail/inboxes` | link/copy, `cur/<id>:2,` 이름 | reconstructable presentation |
| `world/context/revisions/<oid>/` | manifest/tree bytes | immutable evidence |
| `world/context/current` | 상대 symlink | reconstructable presentation |
| `agents/<actor>/runner/view/batch-*.json`, `inbox.md` | view | reconstructable presentation |
| `agents/<actor>/runner/receipts/*` | S-03 receipt | immutable evidence (OPEN gate) |
| `config.json` | host authority | host-owned, persisted가 아니라 입력 |
| CLI request cache | freeze cache | model-origin 재구성 가능 값 |

분류표는 `src/domain/persisted-formats.ts`의 `V1_PLAN_FIELDS`로 코드에 있고, `test/persisted-format-boundary.test.ts`가 closed surface임을 검사한다. host-derived locator는 `HOST_DERIVED_PLAN_FIELDS` = `workspacePath`, `bundle.path`, `stagingPath` 세 개다.

## 2. version boundary

| 대상 | 현재 | 정책 |
|---|---|---|
| SQLite schema | `PRAGMA user_version = 1` | 이 build는 1을 읽고 쓴다(`SCHEMA_USER_VERSION_READABLE = [1]`). 그 밖의 값은 **migration 시도 없이** `STORE_CORRUPT`로 fail closed. 진단 read 경로도 같은 집합을 쓴다 |
| wire protocol | `v: 1` | 변경 없음 |
| persisted plan | version field 없음(v1) | `classifyPersistedPlan`이 shape로 v1/unknown을 분류한다. `version` field가 있거나 kind가 closed set 밖이면 unknown → fail closed |
| v2 | 설계만 | **writer 없음**. 자동 upgrade 경로 없음 |

검증된 동작(`test/persisted-format-boundary.test.ts`):

- fresh DB는 `user_version=1`이다.
- `user_version=2`로 조작한 DB는 open이 거부되고 **파일 bytes가 그대로**이며 version도 2로 남는다.
- `version:"v2"`를 가진 plan, closed set 밖 kind, locator가 빠진 v1 plan은 `unknown`으로 분류된다.
- v1 plan은 open/read/복구를 거쳐도 `plan_json` bytes가 동일하다.
- 다른 state root로 복사한 tree는 여전히 v1 bytes를 읽을 수 있지만, locator가 원래 root에 속하므로 read가 fail closed하고 `planLocatorsBelongTo(plan, newRoot) === false`다. 어떤 경로도 locator를 현재 root 기준으로 **재생성하지 않는다**.

## 3. migration / no-migration policy

- **v1 row는 절대 rewrite하지 않는다.** accepted plan/result/payload bytes는 open, read, materialize, reconcile을 거쳐도 동일하다.
- **현재 stateRoot 기반 accepted plan 재생성 금지**: host-derived locator는 원래 root에 묶인 evidence로 남고, 다른 root에서는 read가 fail closed한다.
- **legacy plan 자동 upgrade 금지**: unknown/legacy shape는 decoding 단계에서 거부되며 migration을 시도하지 않는다.
- 실제 v2 도입 시 필요한 것은 `SCHEMA_USER_VERSION_WRITTEN`/`PLAN_FORMAT_WRITTEN`을 올리고, (i) v1 read 호환, (ii) v1 recovery 호환, (iii) host-derived locator의 portability 처리, (iv) old binary가 v2 row를 만났을 때의 fail-closed 동작을 함께 정의하는 **별도의 명시적 migration**이다. 이번 작업은 그 boundary만 세웠고 v2 writer는 만들지 않았다.

## 4. backup / restore portability

- `agents`, `operations`, `deliveries`, `subscriptions`, `batches`, `usage`, `mail/objects`, `world/context/revisions`, runner receipts가 authoritative다.
- `world/context/current`, inbox/archive view, batch view, `inbox.md`, index는 재생성 가능하다.
- host-derived locator 3종은 **복원 경로에 따라 달라진다**. 복원은 quiescent 상태에서 DB checkpoint + 참조 파일을 함께 옮기고, 새 root에서는 locator가 원래 root를 가리키므로 pending operation을 read 단계에서 fail closed로 만난다. 이때 자동 재생성/수정은 하지 않고 host가 판단한다(REC-005/006과 동일한 경계).
- `planPortability()`는 어느 accepted plan이 non-portable locator를 갖는지 read-only로 보고한다. repair는 하지 않는다.

## 5. 검증

```sh
node --test dist/test/persisted-format-boundary.test.js   # 5 tests / 5 PASS
```

주의: 이 문서는 S-06/S-08/S-10의 DDL·migration 계약을 확정하지 않는다. tiered attestation/floor를 위한 persistence는 여전히 OPEN gate다.
