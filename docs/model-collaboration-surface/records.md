# Records — 파일 읽기·상태 투영·정확한 대상

상태와 범위는 [총괄 spec](../model-collaboration-surface-spec.md)을 따른다. 이 문서는 모델에게 보여 주는 파일의 계약이다. runtime DB schema 자체를 새로 정의하지 않는다.

## MCS-R01 — 정본과 투영

| 자료 | 정본 | 모델에게 보이는 표현 |
|---|---|---|
| mail | accepted mail plan·immutable archive·delivery facts | decoded body, 검증된 header metadata, index |
| proposal/vote | versioned review facts | revision summary, exact target, current status |
| applied delta | 실제 integration operation의 저장된 diff·identity | immutable applied 디렉터리 |
| agent/capacity | registry + 별도의 실행 관측 | peers index와 generation/time |
| invocation | frozen request 연결·원래 broker receipt | 자기 receipt 파일 |
| GOAL | canonical context revision·goal notification | GOAL bytes + context revision metadata |

파일이 있다고 acceptance/권한이 새로 생기지 않는다. 원문 body·Git author 문자열·모델 서명으로 authenticated sender를 결정하지 않는다. 재생성 가능한 파일 손상은 정본 ledger 손상과 구분한다.

## MCS-R02 — 경로와 역할별 노출

`/oma`는 모델에게 공개하는 논리적 root다. Worker에서는 read-only mount로 제공한다. Principal에서도 **그 역할에 허용된 실제 projection root**를 일반 read/grep의 containment 안에 제공한다. 플랫폼상 `/oma` alias가 불가능하면 environment의 `record_root`에 실제 절대 경로를 제공하고 모든 반환 경로를 동일하게 렌더한다. 일반 도구에 숨은 path-to-RPC 동작을 추가하지 않는다. 아래 `/oma`는 그 root를 뜻한다.

```text
/oma/README.md
/oma/health.md
/oma/goal/GOAL.md
/oma/goal/status.json
/oma/mail/inbox.md
/oma/mail/inbox/pages/<generation>-<page>.md
/oma/mail/sent.md
/oma/mail/commons.md
/oma/mail/topics/index.md
/oma/mail/topics/<topic>/index.md
/oma/mail/threads/<thread>/index.md
/oma/mail/messages/<message>.md
/oma/mail/metadata/<message>.json
/oma/reviews/index.md
/oma/reviews/<request>/status.md
/oma/reviews/<request>/revisions/<revision>/summary.md
/oma/reviews/<request>/revisions/<revision>/proposal.patch
/oma/reviews/<request>/revisions/<revision>/manifest.json
/oma/reviews/<request>/contexts/<preparation>/...
/oma/reviews/<request>/applied/<attempt>/...
/oma/reviews/<request>/targets/<kind>-<sha256>.json
/oma/peers/index.md
/oma/subscriptions.md
/oma/receipts/index.md
/oma/receipts/<invocation>.md
/oma/logs/index.md
/oma/logs/<permitted-agent>/<segment>.log
```

- Worker: public record, 자기 delivery, 기존 workers audience, 자기 receipt, 허용된 roster/log를 제공한다. 기존 audience owner의 판정을 재사용한다.
- Principal: public/Principal delivery, 자기 receipt, 기존 approval 관련의 제한된 review projection, GOAL을 제공한다. Worker roster·workers-only thread·임의 Worker log는 제공하지 않는다.

**목록에서 숨기는 것만으로는 부족하다.** 비허용 파일은 Principal root에 materialize/mount하지 않고, 경로 추측·symlink·parent traversal·grep recursion도 containment가 거절해야 한다. full patch만 숨기고 title/target/author metadata를 누설하는 것도 금지한다.

이 경계는 OMA가 제공하는 projection/mount와 일반 파일 도구의 계약이다. [DR71](../design-revisions.md#dr71--기존-mcp-기능을-새-collaboration-역할-제한으로-추가-차단하지-않는다)에 따라 기존 configured MCP 서버의 허용 기능을 새로 차단하거나 서버 전체의 추가 filesystem 격리를 요구하지 않는다. 기존 MCP 계약은 보존하며 OMA RPC의 인증·현재 effect authority를 대신하지 않는다.

`/world/START.md`, `/world/agents.tsv`, 기존 archive는 old-surface sessions에 한해 기존 경로로 유지한다. 새 session에 상충하는 두 startup map을 제공하지 않는다. canonical Git read-only mount와 `/workspace`는 유지하며 `/oma`가 새 shared writable repository가 되는 것은 아니다.

## MCS-R03 — 본문과 metadata를 분리한다

`messages/<message>.md`의 내용은 transport decoding이 완료된 **sender body bytes**다. UTF-8을 검증하되 원문 body의 BOM·공백·개행을 의미 없이 정규화하지 않는다. Markdown rendering을 위해 내용을 수정하지 않는다. trusted header를 body에 이어 붙여 경계를 위조할 기회를 만들지 않는다.

metadata JSON은 다음 필드를 갖는다. 전체 JSON object는 closed다. optional로 표시한 값도 저장 표현에서는 명시적 null을 사용한다.

```json
{
  "version": "collaboration-v1",
  "message": "<message-id>",
  "sender": "<authenticated-actor>",
  "subject": "<subject>",
  "to": ["<logical-address>"],
  "recipients": ["<frozen-delivery-recipient>"],
  "audience": "<existing-audience-kind>",
  "replyTo": null,
  "thread": "<root-message-id>",
  "acceptedSequence": 101,
  "bodyPath": "/oma/mail/messages/<message-id>.md",
  "bodyBytes": 123,
  "bodySha256": "<sha256>",
  "attachments": [],
  "source": "actor"
}
```

`source`는 `actor` 또는 `broker`다. broker-generated approval 메일의 검증된 review metadata는 기존 typed decoder 결과를 별도 `review` 필드로 추가한 명시적 variant로 제공한다. sender가 body에 같은 JSON을 썼다고 그 variant가 되지 않는다. Principal root의 metadata는 기존 audience에 따라 필터링하며, 전달 대상 전체 노출도 현행 가시성보다 넓히지 않는다. 비허용 필드는 null로 가짜 존재를 암시하지 않고 해당 역할의 versioned projection schema에서 제외한다.

thread는 검증된 `replyTo` 관계를 따라 최초 원문까지 연결한다. subject 유사성으로 합치지 않는다. 부모가 가시성 밖이면 `parentUnavailable`을 표시하고 권한 밖 메시지를 읽으러 가지 않는다. topic index는 acceptance 시 사용한 논리 topic 주소를 기준으로 한다. 제목의 `#topic` 문자열을 routing으로 해석하지 않는다.

commit 첨부 metadata는 `oid`, `objectFormat`, `publishedRef`, `repository`, `availability`, `publishedTreeScope`를 포함한다. 파일명 목록이 공개 tree를 제한한다고 표시하지 않는다. uncommitted 파일은 없다는 사실을 발신 결과에서 알린다. 메일을 전달받은 것만으로 commit ACL을 새로 얻지는 않는다.

경로 component는 기존 derived identifier owner의 안전한 mail/request/thread ID를 사용한다. raw RFC Message-ID, subject, actor 본문, URL을 그대로 basename으로 붙이지 않는다. 표시용 Message-ID와 저장 component의 매핑은 metadata에 명시하며 검증된 관계를 따른다.

## MCS-R04 — index의 최소 정보와 크기

모든 index header는 다음을 갖는다.

```text
# Inbox
Generation: <generation>
Ledger through: <sequence>
Observed at: <RFC3339 UTC>
Refresh: complete | partial | unavailable
Coverage: <scope and sequence range>
Rows: <included>; More: <next-page-path or none>

Order | Sender | Subject | Destination | State | Body | Metadata
```

- index 행은 trusted metadata에서 만든다. 탭·개행·`|`·C0/C1/DEL·ANSI escape를 안전하게 escape한다. body 첫 문장을 sender/subject로 추정하지 않는다.
- 새 index page의 **표시 budget 기본값은 64 KiB UTF-8**다. 이는 새 presentation 기본값이지 message/agent 저장 quota가 아니다. 기존 configured frame bound보다 크면 더 작은 값으로 제한한다. 한 행도 담을 수 없으면 명시적인 view-size failure다.
- 다음 페이지는 generation에 결박된 immutable page path다. 모든 page가 동일 ledger snapshot이라고 자동 주장하지 않는다. snapshot이 실제로 같지 않으면 각 page의 coverage/observedAt를 독립 표시한다.
- `inbox.md`는 현재 batch와 아직 필요한 delivery 참조의 작은 진입점이다. 전체 허용 history는 public/topic/thread index로 찾는다. 새 Worker를 위해 옛 delivery row의 recipient를 추가하지 않는다.
- `sent.md`는 발신 acceptance와 recipient별 materialization을 요약한다. `delivered`를 실제 읽음으로 표시하지 않는다. presented가 필요한 경우 trusted presentation fact를 별도 표시한다.
- 반복 grep가 전체 파일군을 탐색할 수 있도록 page와 immutable body를 일반 파일로 제공한다. 대규모 history는 디렉터리 분할과 page 링크로 탐색할 수 있어야 한다. 새로운 semantic search 서비스를 요구하지 않는다.
- `ledgerThrough`는 해당 coverage의 acceptance/order cursor이며, 기존 row의 모든 update를 포착하는 전역 변경 번호라고 주장하지 않는다. mutable receipt/review/execution state는 별도 observation과 dirty/reconciliation으로 갱신한다. restart에서 cursor가 같아도 current records를 다시 관측한다. 실제 transactional change sequence가 없는 구현이 local generation만으로 완전한 change stream을 가장해서는 안 된다.
- projection 밖에 있다는 사실은 '원장에 없음'이 아니다. coverage와 실제 조회 실패를 구분한다.

## MCS-R05 — status·peers·로그의 내용

Review `status.md`에는 최소한 request kind/name/requester, current revision·scope, source base/candidate, policy, tier, normal/required peer 수, capacityFallback, principalRequired, integration outcome, explicit missing conditions, 정확한 자료 경로와 사용 가능한 target 참조가 있어야 한다.

Worker의 reviewer 후보는 현재 status owner의 authors·exclusions·latest vote 계산을 재사용한다. `remainingApprovals=0`을 적용 완료로 표시하지 않는다. Principal status는 기존의 좁은 projection만 제공한다.

`peers/index.md`는 이름·profile·desired·incarnation·마지막 process/runner observation·현재 creation capability/child profile·workerCount/maxWorkers를 담는다. 실행 관측 시각과 registry 관측 시각을 분리한다. `idle`, `unknown`, `no-unit`, `stopped`를 합치지 않는다. pending mail 수를 unfinished task 수라고 부르지 않는다. peer suitability는 모델이 판단하며 runtime이 task를 배정하지 않는다.

로그는 기존 권한·보존 기간 안에서 segment로 투영한다. 각 segment는 source agent/incarnation/time range/byte range와 truncation·수집 실패를 표시한다. read/grep는 후속 refresh를 일으키지 않는다. live process tail 관측은 기존 실행 owner가 한다. 없어진 로그를 '오류 없음'으로 표시하지 않는다. credential·host-private 파일을 projection에 복사하지 않는다.

## MCS-R06 — immutable review 자료

각 revision/context/applied 디렉터리의 manifest는 다음을 결박한다.

- source request, proposal revision, scope kind, preparation/attempt identity.
- repository/object format, full base OID, full candidate OID, policy revision.
- 저장된 complete patch의 byte length와 sha256.
- changed paths manifest와 각 binary 자료의 exact bytes/digest/reference.
- source/proposal/original/context/applied의 명확한 구분.

`proposal.patch`는 텍스트 diff이며 binary를 text loss로 표시하지 않는다. 원래 complete diff에 임의 bytes가 있으면 exact binary artifact로도 보존하고 text preview의 coverage를 표시한다. 한 파일·hunk·preview가 전체 scope라는 인상을 주지 않는다. 원래 challenge의 대상 delta는 `original` 링크로 실제 applied 디렉터리를 가리킨다.

Directory 이름이 immutable이어도 내용이 정본과 다르면 읽기를 성공으로 포장하지 않는다. 동일 identity/다른 bytes는 projection conflict 또는 정본 corruption으로 owner가 판정한다. 기존 patch를 현재 HEAD에서 다시 계산하여 같은 경로에 덮어쓰지 않는다.

## MCS-R07 — exact target의 문법과 검증

모델 입력 `Ref`는 `/oma/reviews/<request>/targets/<kind>-<sha256>.json`의 **제공된 절대 경로 문자열**이다. kind는 `proposal`, `review`, `submission`, `vote`, `applied`다. 이것을 사용하기 위해 새 token 발급 도구를 호출하지 않는다. status/summary/receipt가 적절한 경로를 이미 제공한다.

Descriptor는 canonical JSON으로 serialize하고 sha256을 path에 사용한다. descriptor schema version은 `collaboration-v1`이다. 사람이 읽는 label은 side summary에 두어 label 변경으로 identity를 바꾸지 않는다. 데이터가 동일하면 같은 ref를 재사용하며 관측 timestamp를 digest payload에 넣지 않는다.

Canonical encoding은 이 projection version에서 고정한다: closed descriptor의 object keys를 모든 깊이에서 Unicode codepoint 오름차순으로 정렬하고, array 순서는 보존하며, JSON string escaping과 UTF-8을 사용해 공백·trailing newline 없이 serialize한다. 문자열의 Unicode normalization은 하지 않는다. number는 domain에서 허용한 safe integer만 사용하며 nonfinite/negative-zero/undefined는 거절한다. digest는 이 exact bytes의 lowercase SHA-256이다. 파일 bytes도 이 canonical encoding이어야 하고 identity에 영향을 주지 않는 rendering metadata는 다른 파일에 둔다. 기존 domain serializer가 이 규칙과 다르면 versioned projection encoder 하나를 추가하고 source/schema/tests가 함께 쓰게 한다.

공통 필드: `version`, `kind`, `societyBirth`, `request`, `requestName`, `revision`, `policyRevision`.

| kind | 추가 필수 결박 |
|---|---|
| proposal | requester, source base/candidate, tier, current attempt number, expected attempt operation 또는 null, settledFailure(kind·exact failure operation·immutable failure evidence digest) 또는 null |
| review | exact source/integration scope, base/candidate, preparation identity 또는 null, actor, expected own-current vote ID 또는 null, Principal일 때 approval message ID |
| submission | requester, exact submission/revision fact ID, source identity, expected attempt identity |
| vote | actor, exact vote operation, its revision/scope/approval identity, expected current own vote |
| applied | succeeded integration operation, actual expectedBase/candidate, exact applied manifest digest, source proposal revision |

모든 optional null의 의미는 schema에 명시한다. `null`은 latest/any가 아니다. scoped descriptor를 조회할 때 role-specific fields를 빼서 다른 뜻의 같은 ref로 만들지 않는다. Principal에 필요한 target은 별도 descriptor이며 Worker-only 정보를 포함하지 않는다.

`proposal.settledFailure`는 `null` 또는 `{kind:"integration"|"preparation", operation:<exact-id>, evidenceSha256:<digest>}`다. integration이면 원래 terminal failure receipt, preparation이면 저장된 preparation-failure fact의 canonical bytes를 결박한다. projection이 새 실패 사실을 만들지 않는다. null은 이 target을 만들 때 확인된 settled failure가 없었다는 expectation이지 어떤 실패든 허용한다는 뜻이 아니다. pending 때 얻은 ProposalRef로 나중에 confirmed failure의 새 attempt를 몰래 시작하지 않는다. failure가 확정되면 그 원래 immutable evidence에 결박한 새 ProposalRef를 게시한다. retry 입력은 그 ref를 사용해야 하며 T에서 같은 실패·revision·attempt·policy/provenance를 다시 확인한다.

Host는 다음 순서로 검사한다.

1. caller에 허용된 projection root인지 no-follow/contained open으로 확인한다. 상대 경로·URL·mutable `status.md`·임의 workspace JSON은 거절한다.
2. descriptor closed shape·version·path kind·digest와 request 관계를 확인한다.
3. ledger의 원래 facts에서 tuple을 재도출한다. descriptor가 스스로 주장한 authority는 신뢰하지 않는다.
4. actor·현재 capability·author exclusion·approval delegation·현재 revision/scope/own-vote expectation을 acceptance에서 재검증한다.
5. stale이면 effect 없이 거절한다. 새 status/target 경로를 안내하되 새 target으로 자동 재호출하지 않는다.

검증 항목은 target kind에 맞게 적용한다. `applied`는 과거 succeeded attempt와 실제 delta를 결박하므로 이후 main/policy가 이동했다고 그 과거 fact를 최신 값으로 바꾸지 않는다. `proposal`은 입력이 기대한 현재 revision/attempt/failure와 비교하고, `review`는 정확한 결정 scope·자기 vote·필요한 approval identity와 비교한다. 현재 effect policy 검사는 별도로 수행한다. 모든 descriptor에 현재 main이나 현재 policy OID 일치를 일률적으로 요구해서 역사 applied 참조를 사용할 수 없게 만들지 않는다.

Descriptor는 재생성 가능한 **정확한 사실의 주소**이고 bearer token이나 새로운 approval fact가 아니다. 쓰기 불가능한 root만 믿지 않고 정본 관계를 검사한다. target 파일 유실은 필요한 exact facts로 재생성할 수 있으나, 알 수 없는 tuple을 'latest'로 복원하지 않는다. broker가 해당 자료를 관측하지 못하면 unknown이다.

## MCS-R08 — 파일 갱신 알고리즘

1. acceptance/delivery/review/process 변화는 기존 owner에서 projection dirty 신호를 보낸다. 이 신호는 사실 자체가 아니며 유실돼도 정본에서 재생성할 수 있어야 한다.
2. startup/reconnect와 모델에게 제어를 주는 안전한 경계에서 allowed roots의 작은 index·자기 미결 receipt·현재 접근 가능한 review 상태를 갱신한다. 전체 archive/log/patch를 매번 재생성하지 않는다.
3. durable source의 bounded read를 끝내고 immutable 자료를 먼저 게시한다. 그 자료를 가리키는 index는 마지막에 atomic replace한다. 완료되지 않은 파일을 current index에서 완성본처럼 가리키지 않는다.
4. ledger snapshot이 필요한 최소 다중 조회는 실제 reader transaction/snapshot API로 묶는다. collection memoization을 DB snapshot으로 간주하지 않는다. OS/Git 관측은 별도 timestamp다.
5. view generation과 ledgerThrough는 마지막 성공 지점을 나타낸다. 실패 후 이전 파일을 유지하고 health에 실패 사실을 게시한다.
6. health조차 게시할 수 없으면 다음 model boundary의 trusted 작은 runtime event에 실패를 알린다. 새 모델 session 시작에 필수 identity/GOAL/경로를 제공하지 못하면 activation을 준비 완료로 표시하지 않는다.
7. read/grep는 이 알고리즘을 실행하지 않는다. 재시도는 기존 reconcile cadence와 backoff owner를 사용하며 새 polling daemon을 추가하지 않는다.

현재 readonly projection을 주기적으로 읽는 모델이 순환 갱신을 유발해서는 안 된다. 반복 read는 ACK·receipt settlement·마지막 읽음 timestamp를 만들지 않는다. freshness budget과 실제 지연은 관측 항목이며, timeout을 넘겼다고 unknown source를 absent로 바꾸지 않는다.

## MCS-R09 — 보존·GC·검색 경계

- immutable 원문/revision/receipt는 기존 retention/archive 정책에 결박한다. 새 spec 때문에 과거 사실을 삭제하지 않는다.
- current index/page는 rebuild 가능하지만 모델 session·in-flight invocation이 사용하는 exact target/자료는 도달 가능성을 유지한다. 오래된 참조는 필요 시 정본에서 재생성하거나 명시적 unavailable을 반환한다.
- GC는 actor의 읽음/ACK 추측을 기준으로 하지 않는다. accepted 또는 acceptance-unknown artifact는 보존한다.
- materialized search tree는 민감한 source와 다른 role을 혼합하지 않는다. `.gitignore` 상속으로 projection 전체가 사라지지 않는지 explicit-path 검색과 directory 검색을 모두 시험한다.
- body content를 trusted environment/system instruction으로 렌더하지 않는다. 파일을 markdown으로 읽는 것은 sender 주장에 instruction authority를 주지 않는다.

## MCS-R10 — receipt의 표현

`receipts/<invocation>.md`는 mutable 관측 view다. 원래 broker receipt와 effect facts를 덮어쓰는 저장소가 아니다. 다음을 분리해서 표시한다.

```text
Invocation: <id>                    # host가 정함; 모델 입력이 아님
Disposition: new | existing | replayed | refused
Original operation: <id or none>
Acceptance: not-submitted | accepted | rejected | unknown
Execution: pending | succeeded | failed | unknown | not-applicable
Observed at: <time>
Attachments: <per-commit publication facts>
Delivery: <per-recipient materialization facts>
Review: <proposal/revision/scope/attempt/application>
Record paths: <exact accessible references>
Next: <legal action or host recovery notice>
```

`Execution:succeeded`는 해당 operation의 의미에 한정된다. merge-open 성공을 main 적용 완료로 표시하지 않는다. 단계가 없는 경우 `not-applicable`이지 가짜 성공이 아니다. observation unavailable가 과거 accepted/succeeded fact를 지우지 않는다. 상세 key·원래 error·하위 plan identity는 보존하지만 일반 모델 입력으로 복사하도록 요구하지 않는다.
