# Tools — 설명 전문·입력·결과·오류

[총괄 spec](../model-collaboration-surface-spec.md)의 모델 호출 계약 정본이다. 이 문서의 영어 block과 parameter help는 구현 시 등록할 문구다. 한글 해설은 모델에 자동 주입하지 않는다. 실제 provider wire 변환은 Pi 소유이며 최종 전송 payload를 검증해야 한다.

## MCS-T00 — 공통 schema와 description 규칙

### Input 표현 규칙

아래 signature는 TypeScript **type declaration**이다. 모든 object는 `additionalProperties:false`인 closed JSON object로 변환한다. `?`가 없는 field는 required다. 모델 도구에는 `request`, actor, role, capability, broker method, raw JSON action을 입력받지 않는다.

```ts
type Content = { kind: "text" | "file"; value: string };
type Revision = string;
type Ref = string;
type Address = string;
```

- `Content.kind` help: `Use text for an inline body or file to read a permitted UTF-8 file once.`
- `Content.value` help: `The complete inline text, or the path of the file whose bytes become the body. A file path is not sent to the recipient.`
- file 입력은 actual cwd 기준 상대 경로 또는 허용 절대 경로다. URL, directory, symlink escape, nonregular file, invalid UTF-8, source change during read, byte 초과는 거절한다. snapshot을 처음 freeze한 뒤 replay에서 다시 읽지 않는다.
- Revision은 허용 local Git revision 또는 full OID이며 한 번만 commit으로 resolve한다. uncommitted tree와 raw shell expression을 받지 않는다. Git argv/env containment는 기존 owner를 따른다.
- Ref는 [records의 exact target](records.md)의 **제공된 경로**다. 모델이 digest·tuple을 만들지 않는다.
- 문자열을 숫자/boolean/null에서 coercion하지 않는다. optional-null은 설치된 Pi의 정상화 의미와 동일하게 생략으로 취급하되, `oma_goal.expectedRevision:null`은 required 값으로 보존한다.
- 기본값은 `Object.hasOwn`/presence 기준으로 결정한다. 빈 string을 생략으로 처리하지 않는다. 명시적 빈 값이 허용되는 경우만 아래에 적는다.
- enum은 일반 string enum을 사용한다. top-level anyOf/oneOf 또는 action별 object union에 의존하지 않는다. semantic relation은 runtime guard도 검사한다.
- text/identifier/count/frame/bundle limits는 기존 domain/config의 effective limits를 사용한다. attachments 배열에는 새 lifetime/quota를 만들지 않는다. 전체 input frame·개별 bundle·전체 staging의 기존 제한을 모두 검사한다. 초과분을 자르거나 숨겨 보내지 않는다.
- `oma_send.to`의 `maxItems`와 새 호출의 pre-invocation validator는 host의 같은 effective `addresses` bound를 등록 시 캡처한다. missing/invalid bound는 선택된 표면 등록을 거절하며 암묵적인 64 기본값을 만들지 않는다. 이 current limit를 historical argument/plan/receipt decoder에 소급 적용하지 않는다.
- description은 목적 → 정상 선택 → 중요한 실패/완료 경계 순서다. 각 field의 반복 설명과 전체 내부 state machine을 description에 넣지 않는다.
- `promptSnippet`은 아래 한 줄만 사용한다. OMA `promptGuidelines`는 빈 배열로 하여 description을 system prompt에 다시 복제하지 않는다. vendor 도구의 기존 guidance는 보존한다.

### Result 공통 규칙

`content`의 text와 structured `details`는 같은 사실에서 생성한다. receipt·phase·unknown을 details에만 숨기지 않는다. 짧은 결과에는 사람이 읽는 상태, 새 효과 여부, 핵심 identity, 다음 읽을 경로만 넣는다. 큰 내용은 기존 spool/preview bound(현재 1 MiB)와 full path를 사용한다. attachment/recipient 결과가 잘리면 omitted count와 full receipt를 표시한다.

새 공통 presentation fields는 `disposition`, `acceptance`, `execution`, `invocation`, `operation`, `observedAt`, `records`, `error`다. null은 관측되지 않았거나 해당 없음을 field별로 구분한다. 이것은 broker Receipt를 덮어쓰는 새 ledger schema가 아니다. per-tool results에는 아래 최소 의미 필드를 더한다.

`disposition=existing`은 이번 호출이 새 effect를 실행하지 않았다는 뜻이다. `replayed`는 host가 원래 invocation을 복원한 경우다. 이미 성공한 과거 receipt를 새 호출 성공으로 표시하지 않는다. ephemeral wait/group에는 durable acceptance를 만들지 않고 별도 `requested/active` 표현을 쓴다.

## MCS-T01 — oma_send

역할: Worker/Principal. label: `Send a message or committed work`.

**description**

```text
Send a durable message with inline text or the contents of a file. Add commit attachments to share code or documents without requesting a merge; OMA freezes and publishes the exact commits as needed. Use replyTo to continue a thread, and choose recipients explicitly. Recipients select delivery, not a new confidentiality boundary. Acceptance, attachment publication, mailbox delivery, and recipient action are different outcomes. If acceptance is unknown, OMA reconnects the original invocation; do not resend to escape uncertainty. Workers may use @self alone for a continuation note, without subject, replyTo, attachments, or urgent.
```

**promptSnippet**

```text
Send messages, file contents, or exact commit attachments through one delivery action.
```

```ts
type SendInput = {
  to: Address[];
  content: Content;
  subject?: string;
  replyTo?: string;
  attachments?: { commit: Revision }[];
  urgent?: boolean;
};
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| to | required; nonempty | `Explicit recipients: a Worker, principal, commons/residents, topic/<name>, or a displayed project address. Use @self alone only for a Worker continuation note.` |
| content | required | `The message body, supplied inline or from an existing file. The body never supplies routing or authority.` |
| subject | absent: inherit reply subject, else derive from body | `Optional single-line subject. Omit to inherit the reply subject or derive one from the first nonblank body line.` |
| replyTo | absent: new thread | `Existing message ID or displayed message reference. This links the thread; it does not choose or expand recipients.` |
| attachments | absent/[]: none | `Committed project trees to share. Uncommitted edits are excluded; a path summary would not limit access to the published tree.` |
| attachments[].commit | required | `Local commit revision or full commit OID, resolved once for this invocation.` |
| urgent | absent: false | `Use true for time-sensitive coordination. This does not grant authority or guarantee preemption.` |

Principal schema의 `to` help에는 @self 문장을 넣지 않는다. Principal의 description 전문은 다음으로 대체한다.

```text
Send a durable message with inline text or the contents of a permitted file. Reference already accessible published commits to share supporting work; the Principal cannot publish a new local candidate. Use replyTo to continue a thread and choose recipients explicitly. Recipients select delivery, not a new confidentiality boundary. Acceptance, mailbox delivery, and recipient action are different outcomes. If acceptance is unknown, OMA reconnects the original invocation; do not resend to escape uncertainty. Ordinary mail does not publish a GOAL or record an approval.
```

Principal의 `attachments[].commit` help는 `Full commit OID of an already accessible published commit, copied from a permitted record.`다. 이 역할에서는 local `HEAD`·branch·filesystem-derived revision을 resolve하지 않고, full OID와 허용된 published/canonical 관계만 검사한다. Git 관측은 기존 host read owner가 수행하며 Principal에게 shell 권한을 주지 않는다.

검증/기본값:

1. to 정규화·기존 주소 문법·중복 제거를 수행한다. unknown 주소, recipient expansion failure는 effect 전에 거절한다. address가 실제 role 가시성 밖이면 허용 정보만 반환한다.
2. 일반 content는 기존 mail body의 empty 허용 규칙을 따른다. attachments-only이면 empty text도 가능하다. @self는 nonblank note가 필요하다.
3. subject 명시 empty는 허용한다. 생략 시 reply subject를 우선하고, 비어 있는 본문+첨부이면 `Shared committed work`, 모두 비어 있으면 `Message`다. body에서 유도한 제목의 control chars는 space로 바꾸고 UTF-8 header byte bound의 codepoint 경계에서 자른다. 명시 subject에 newline/control char가 있으면 거절한다. body를 자르지 않는다.
4. reply의 audience를 확장하는 우회는 허용하지 않는다. reply target의 존재/가시성과 membership 관계를 확인한다. to를 상속하지 않는다.
5. @self는 단독이고 나머지 optional field는 **presence 자체를 금지**한다. `urgent:false`, `attachments:[]`도 함께 보내지 않는다. optional-null 정상화 뒤 판단한다. 기존 continuation 권한/의미를 사용한다.
6. urgent=false/absent는 기존 ordinary message, true는 critical에 대응한다. actor가 broker approval/review metadata를 작성할 필드는 없다.
7. commit 중복은 resolved OID 기준으로 한 첨부로 정리하되 result에 해당 OID를 보여 준다. 기존 trusted published object를 참조하는 것만으로 새 submitter provenance를 추가하지 않는다.

결과: frozen message identity·body hash와 게시 완료된 경우의 body path·수신자 snapshot 요약·각 OID/publication state·recipient materialization·receipt path. `accepted`일 때 attachment 미완료를 반드시 표시한다. 실행 절차는 runtime MCS-X03을 따른다.

```json
{"to":["worker-b"],"content":{"kind":"text","value":"Please test the parser change against the legacy fixtures."},"attachments":[{"commit":"HEAD"}]}
```

```json
{"to":["principal"],"replyTo":"<message-id>","content":{"kind":"file","value":"reports/integration-evidence.md"}}
```

```text
Accepted message <id>; attachments are still being published.
Mailbox delivery has not completed. No recipient action is implied.
Receipt: <record-root>/receipts/<invocation>.md
```

## MCS-T02 — oma_spawn

역할: Worker. label: `Create an independent Worker`.

**description**

```text
Create an autonomous Worker with its own clone at an exact commit and a self-contained brief. OMA publishes the committed starting point if needed and authorized, then provisions the Worker and delivers the brief. Use an existing peer when that avoids unnecessary setup, but choose collaboration freely. Creation requires a delegable child profile and available enabled-Worker capacity; idle or waiting Workers still occupy slots. An accepted or enabled Worker is not proof of execution or task completion. Do not create another name to bypass an unresolved creation.
```

**promptSnippet**

```text
Create an independent colleague from a committed starting point and a useful brief.
```

```ts
type SpawnInput = { name: string; from: Revision; brief: Content };
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| name | required | `New unique Worker name. This names a colleague, not a task or a disposable retry attempt.` |
| from | required | `Commit revision for the new clone. OMA freezes it once and publishes it if necessary and permitted; uncommitted work is excluded.` |
| brief | required, nonblank decoded body | `Inline text or a file describing the outcome, relevant context, interfaces, evidence, and how to report results. This is a brief, not a shell command.` |

`name`는 기존 actor grammar다. 기존 name+동일 frozen create intent는 기존 결과에 연결하고, 다른 spec/brief/from이면 name conflict다. stopped 기존 name을 start하는 별칭으로 쓰지 않는다. child model/profile/effort는 기존 delegation policy가 정하고 모델 입력이 그 권한을 override하지 않는다.

새 publication이 필요하면 `git.submit`도 검사한다. `agent.create`만으로 게시할 수 없다. preflight capacity가 꽉 찼다면 fresh acceptance를 거절한다. 이미 수락한 create가 activation race에서 밀리면 provisioning/pending 상태로 기존 recovery가 처리한다. 새 versioned create plan이 source dependency와 frozen child spec을 결박한다.

결과: actor, resolved from, source publication state, creation acceptance, provisioning/desired, 실제 execution observation+시각, 초기 brief message ref, receipt. user task result를 동기 반환하지 않는다.

```json
{"name":"parser-tests","from":"HEAD","brief":{"kind":"text","value":"Check parser compatibility with the old fixture format. Reuse the shared failing cases, add focused tests if needed, and send exact commits and command results. Choose your approach independently."}}
```

## MCS-T03 — oma_merge

역할: Worker. label: `Submit a change for integration`.

**description**

```text
Submit committed code for integration, or resubmit your existing proposal. For a new proposal, omitted change uses HEAD and the recorded base. With proposal, omitted change keeps that proposal's frozen commits; it never means your current HEAD. Supplying changed commits creates a new revision and invalidates approvals that do not bind that revision. Repeating unchanged code observes an active proposal, or requests a new attempt only after its exact attempt has definitively failed. OMA publishes missing commits. A submission receipt is not proof that main changed. Read the returned status and exact review records; do not create a fresh proposal to escape an unknown integration.
```

**promptSnippet**

```text
Submit a coherent commit, or update the same proposal with an exact proposal reference.
```

```ts
type MergeInput = {
  reason: string;
  tier: "LOW" | "MEDIUM" | "HIGH";
  proposal?: Ref;
  change?: { candidate: Revision; base?: Revision };
  title?: string;
};
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| reason | required/nonblank | `Purpose, verification evidence, and remaining risks of this submission or resubmission.` |
| tier | required | `Risk tier for a new proposal. For an existing proposal, supply its recorded tier; policy may raise the resulting revision's tier.` |
| proposal | absent: new | `Exact proposal reference returned by OMA for your existing merge. Omit only when creating a new proposal.` |
| change | absent: context-specific frozen defaults | `Committed change to submit. Omit for HEAD on a new proposal, or to retain the frozen change on an existing proposal.` |
| change.candidate | required if change present | `Commit revision to freeze as the proposed candidate. Uncommitted edits are excluded.` |
| change.base | absent: recorded base or proposal base | `Base commit. Omit to use the recorded workspace base for a new proposal, or the referenced proposal's base for an update.` |
| title | absent: generated/new, unchanged/existing | `Optional short title for a new proposal. When resubmitting, omit it or repeat the existing title.` |

신규/기존 분기는 runtime MCS-X05의 표를 정본으로 사용한다. 입력의 `proposal`이 challenge ref면 거절한다. 현재 policy floor보다 낮은 새 tier를 조용히 승인하지 않는다. title-only/tier-only 변경 API는 없다. 본문 reason은 새 action의 rationale이고 원래 fact를 수정하지 않는다.

새 merge/challenge title을 생략하면 reason의 첫 비공백 줄에서 생성한다. control chars를 space로 바꾸고 기존 review subject/title byte bound의 UTF-8 codepoint 경계에서 제한한다. 명시 title은 nonblank이고 bound를 넘으면 거절한다. 기존 제안에서 title을 주면 원래 title과 정확히 일치해야 한다.

결과: disposition(new/existing/replayed), request, revision, source OIDs, resulting tier, scope, attempt identity/outcome, required/missing 조건, proposal/submission/review ref, status/manifest path. LOW가 즉시 적용되더라도 원래 submission receipt와 applied outcome을 별개로 표시한다.

```json
{"tier":"MEDIUM","reason":"Fix parser compatibility. Unit cases and the CLI consumer path passed; unusual encodings remain untested."}
```

```json
{"proposal":"<exact-proposal-ref>","change":{"candidate":"HEAD"},"tier":"MEDIUM","reason":"Address the review finding with a bounded parser and regression cases."}
```

## MCS-T04 — oma_challenge

역할: Worker. label: `Propose a correction to an applied merge`.

**description**

```text
Challenge an exact applied merge with evidence and a proposed correction. For a new challenge, omit replacement to request OMA's prepared revert, or provide both replacement commits. With proposal, resubmit that same challenge; omitted replacement retains its frozen correction instead of generating another revert. A HIGH merge cannot be challenged at LOW. Challenges require the broker's recorded review conditions, including LOW challenges. Opening or approving a challenge is not proof that the correction was applied.
```

**promptSnippet**

```text
Propose an evidence-based revert or replacement of an exact applied merge.
```

```ts
type ChallengeInput = {
  merge: Ref;
  reason: string;
  tier: "LOW" | "HIGH";
  proposal?: Ref;
  replacement?: { candidate: Revision; base: Revision };
  title?: string;
};
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| merge | required | `Exact applied-merge reference from OMA, including the actual integration attempt and delta.` |
| reason | required/nonblank | `Defect evidence, impact, and why the revert or replacement is appropriate.` |
| tier | required | `Challenge risk tier under policy. HIGH is required when challenging a HIGH merge. For a resubmission, use its recorded tier.` |
| proposal | absent: new | `Exact reference to your existing challenge. Its original applied-merge target cannot be changed.` |
| replacement | absent: new prepared revert / existing frozen correction | `Optional committed correction. Both candidate and base are required. Omission only prepares a revert when creating a new challenge.` |
| replacement.candidate | required in replacement | `Exact replacement commit revision to freeze.` |
| replacement.base | required in replacement | `Exact base commit revision for the replacement.` |
| title | absent: generate/retain | `Optional short title for a new challenge. For an existing challenge, omit it or repeat its title.` |

Already-applied target를 request name만으로 추측하지 않는다. merge reference의 실제 attempt/delta가 기준이다. revert conflict는 explicit preparation failure이며 자동 해결하지 않는다. existing challenge에 replacement 없이 호출했다고 current main 위에 새 revert를 만들지 않는다. 같은 applied target의 기존 duplication 규칙은 유지한다.

결과는 merge와 동일한 구조에 original applied ref/delta path와 correction manifest를 추가한다.

```json
{"merge":"<exact-applied-ref>","tier":"HIGH","reason":"The applied change bypasses the required authorization check. The supplied reproduction reaches the protected path."}
```

## MCS-T05 — oma_review

역할: Worker/Principal. label: `Record a decision or withdraw your own record`.

**Worker description**

```text
Record approve or reject for the exact review target you inspected, or withdraw a specific proposal or vote that you own. Use a review target for a verdict, a submission target to cancel your proposal, and a vote target to withdraw your vote. Authors cannot supply independent votes for their own change. A newer verdict preserves the earlier history. Ordinary discussion belongs in mail. Stale targets are refused rather than rebound to the latest code. Withdrawal cannot undo an applied Git change; use a challenge for that.
```

**Principal description**

```text
Approve or reject the exact broker-issued approval target you inspected, or withdraw your own still-retractable approval using its vote target. The target includes the current approval-message identity; ordinary mail cannot authorize a decision. A Principal rejection permanently closes that request. You cannot cancel Worker proposals, withdraw another actor's vote, or use withdrawal to reopen a rejected or applied request. Approval is not proof of integration. Stale targets must be reviewed again, not overridden.
```

**promptSnippet**

```text
Record an evidence-based verdict or retract an exact record you own.
```

```ts
type ReviewInput = {
  target: Ref;
  decision: "approve" | "reject" | "withdraw";
  reason: string;
};
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| target | required | `Exact OMA target path: review for approve/reject, your submission or vote for withdrawal. Do not use a mutable status path or construct a target yourself.` |
| decision | required | `approve or reject records a verdict; withdraw retracts only the exact owned record named by target.` |
| reason | required/nonblank | `Reasoned findings and relevant evidence for this exact target, including material uncertainty.` |

Principal target help의 `your submission or vote`는 `your still-retractable approval vote`로 교체한다. schema enum 자체는 같고 role-specific relation guard가 다르다. read-time tuple과 effect-time tuple의 mismatch는 stale다. unrelated peer activity만으로 target을 무조건 무효화하지 않고, source/scope/policy/approval/자기 latest vote 등 결정에 필요한 필드만 검사한다.

| target kind | approve/reject | withdraw |
|---|---|---|
| review | 해당 scope의 새 자기 verdict | 거절 |
| submission | 거절 | Worker requester의 정확한 proposal cancel |
| vote | 거절 | actor 자신의 정확한 vote 철회 |
| proposal/applied/다른 raw record | 거절 | 거절 |

새 verdict는 현재 자기 vote expectation에 CAS처럼 결박한다. 다른 session에서 더 최신 자기 vote가 생겼으면 거절한다. withdrawal이 옛 승인을 부활시키지 않는다. Principal terminal reject는 현재 그대로 terminal이다.

결과: bound request/revision/scope, recorded fact ID, vote 또는 cancelled/withdrawn 의미, 자기 vote ref(있으면), 현재 요구와 status path. control acceptance 후 notice 발송이 pending이어도 fact는 이미 확정되었다고 표시한다.

```json
{"target":"<exact-review-ref>","decision":"approve","reason":"Reviewed the full source diff and the affected caller; focused regression cases passed."}
```

```json
{"target":"<own-submission-ref>","decision":"withdraw","reason":"The approach is obsolete; no replacement should be integrated from this proposal."}
```

## MCS-T06 — oma_wait

역할: Worker. label: `Yield this activation`.

**description**

```text
Yield the current activation at a safe boundary after this tool batch is recorded. Use when progress depends on new input and no useful independent work remains. This is not a blocking receive, acknowledgment, task completion, Worker stop, or capacity release. Accepted operations continue under their existing owners. Processes and temporary files do not survive the activation; preserve needed results before yielding.
```

**promptSnippet**

```text
Yield when new input is needed and no useful independent work remains.
```

```ts
type WaitInput = {};
```

추가 property는 거절한다. timeout/topics/release/complete/ack 옵션을 넣지 않는다. 기존 current live-run wait 권한을 사용한다. 같은 run에서 반복하면 기존 intent와 동일하며 exact held-message 범위를 넓히지 않는다.

결과 문구:

```text
Yield requested for this activation. The run ends at the next safe tool boundary.
This does not acknowledge mail, complete work, or release Worker capacity.
```

tool batch의 다른 작업 결과를 저장하기 전에 중단하지 않는다. 그 결과 wait가 아니라 정상 terminal stop으로 표시되지 않도록 delivery owner를 연결한다.

## MCS-T07 — oma_follow

역할: Worker. label: `Choose topic delivery`.

**description**

```text
Enable or disable delivery of future messages for one topic to yourself. This changes your subscription, not another Worker's. Reading or posting to a topic does not subscribe you. Following does not create deliveries for old messages; permitted history remains readable in the topic index. Unfollowing does not cancel deliveries whose recipient snapshots were already accepted.
```

**promptSnippet**

```text
Choose which topic conversations deliver future messages to you.
```

```ts
type FollowInput = { topic: string; enabled: boolean };
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| topic | required | `Topic name without the topic/ prefix, using the project's topic-name syntax.` |
| enabled | required | `true subscribes you to future topic delivery; false removes your subscription.` |

동일 desired subscription은 기존 route owner의 idempotent 의미를 유지한다. fresh acceptance와 duplicate invocation replay를 혼동하지 않는다. 결과에는 subscribed state, routing effective acceptance 순서, subscriptions/topic index path를 제공한다.

```json
{"topic":"parser-compatibility","enabled":true}
```

## MCS-T08 — oma_goal

역할: Principal. label: `Publish the shared goal`.

**description**

```text
Publish the complete shared GOAL and its notification while preserving other context files. Use the Human's objective, constraints, priorities, and observable completion criteria. expectedRevision compares the current context commit; null means no context is expected, not unconditional overwrite. A mismatch is refused. Ordinary mail does not publish or replace the GOAL. File content is read only from paths the Principal is allowed to inspect.
```

**promptSnippet**

```text
Publish the complete shared objective with an exact context-revision check.
```

```ts
type GoalInput = { content: Content; expectedRevision: string | null };
```

| Field | Required/default | Exact parameter help |
|---|---|---|
| content | required/nonblank | `The complete new GOAL text, inline or from a readable file. This replaces GOAL.md, not the other context files.` |
| expectedRevision | required, nullable | `Full current context commit OID from goal/status.json. Use null only to assert that no context has been published.` |

subject 입력은 없고 `GOAL updated`라는 고정 notice 제목을 사용한다. 기존 full context CAS·preserve-other-files·goalMail 원자적 의미를 유지한다. 파일을 읽는 경로는 Principal 가시성 안에서만 허용한다. `null`이나 full OID 이외를 현재 값으로 보정하지 않는다.

결과: old expected revision, accepted new context revision, GOAL path, notification identity/materialization, receipt. goal publication 성공은 Worker 실행/완료 증거가 아니다.

```json
{"content":{"kind":"text","value":"Implement the parser compatibility fix. Preserve the public CLI contract and demonstrate the legacy fixture path with regression tests."},"expectedRevision":null}
```

## MCS-T09 — oma_society

역할: Principal. label: `Open or close Worker execution`.

**description**

```text
Open or close Worker execution for this Society. Close for a justified execution stop, including after verified project completion; it does not itself prove the project is complete. Only a succeeded close receipt confirms Worker execution has ended. Opening preserves mail, sessions, and individual stop ownership; it does not release a separate Principal-imposed stop. This is not routine task scheduling or individual Worker control.
```

**promptSnippet**

```text
Control the Society execution gate without treating it as project-completion evidence.
```

```ts
type SocietyInput = { action: "open" | "close" };
```

`action` help: `open permits Worker execution; close requests its termination while preserving durable state.`

현재 Society authority·physical termination owner를 사용한다. close requested/accepted/succeeded를 구분한다. known desired=closed만으로 succeeded를 반환하지 않는다. runtime source에 old request key가 필요하면 host가 내부 공급한다.

## MCS-T10 — lsp_tools / web_tools

역할: 둘 다 Worker/Principal. label: `Enable LSP tools` / `Enable web tools`.

**lsp_tools description — Worker**

```text
Expose the permitted LSP tools for the next model call: lsp_diagnostics, lsp_fix, and lsp_status. This only enables their original tool definitions; it does not run an analysis or grant new permissions. Activation is cumulative and does not remove web or other active tools. Repeated calls keep the same group active.
```

Principal description 전문:

```text
Expose lsp_status for the next model call. This only enables its original tool definition; it does not run an analysis, edit files, or grant new permissions. Activation is cumulative and does not remove web or other active tools. Repeated calls keep the group active.
```

**web_tools description**

```text
Expose web_search, source_check, fetch_content, and get_search_content for the next model call. Call those tools directly after activation. This tool does not run a search, change permissions, or remove already active tools. Repeated calls keep the same group active. MCP discovery and calls remain with the existing mcp gateway.
```

promptSnippet: `Enable the permitted LSP group cumulatively.` / `Enable the web research group cumulatively.`

```ts
type LspToolsInput = {};
type WebToolsInput = {};
```

결과: requested group, actually permitted members, newly added names, already active names, next active count, `effective: next-model-call-after-result-persistence`. 동일 batch에서 아직 provider에 공개되지 않은 member 호출을 유효한 활성화처럼 처리하지 않는다. 다음 boundary를 기다린다.

```text
Web tools enabled for the next model call: web_search, source_check, fetch_content, get_search_content.
Previously active tools remain active.
```

## MCS-T11 — 일반 도구와 metadata 조립

read/write/replace/insert/replace_within/grep/find/ls/bash와 LSP/web/MCP의 설명·schema는 **현재 vendored/bundled metadata가 정본**이다. 이를 Codex의 apply_patch/exec_command schema로 치환하지 않는다. OMA는 capability·path containment·provenance admission을 연결한다.

OMA projection의 root를 read/grep가 실제로 접근할 수 있도록 containment와 startup facts를 맞춘다. 제품에 없는 `write_stdin`, shell session ID, `update_plan`, permission escalation, semantic tool-search 호출을 프롬프트나 오류가 제시하지 않아야 한다. optional member definitions가 열렸으면 원래 이름으로 직접 호출한다.

## MCS-T12 — 오류·부분 결과의 모델 문구

아래는 새 surface diagnostic `reason`과 정확한 권고 문구다. 원래 broker `code/message/retry/details`와 확인된 receipt는 함께 보존한다. 이 reason을 기존 durable error code의 의미 변경으로 사용하지 않는다. detail이 비허용 actor 정보를 포함하면 기존 visibility owner로 축소한다.

| reason / 상황 | Model-facing text |
|---|---|
| INVALID_ARGUMENT / shape | `No request was submitted. Fix the named input field and call the same action again.` |
| SOURCE_UNREADABLE / 아직 freeze 전 | `The source could not be read safely. No request was submitted. Use a readable file or inline text; do not assume the missing file was empty.` |
| SOURCE_CHANGED / snapshot 경합 | `The source changed while it was being frozen. No request was submitted. Inspect the source and submit the intended version.` |
| STALE_TARGET / exact tuple mismatch | `No decision was recorded. This target no longer names the current review scope. Read the current status and exact change before deciding again.` |
| WRONG_TARGET_KIND | `No effect was requested. Use a review target for a verdict, your submission target for proposal withdrawal, or your vote target for vote withdrawal.` |
| ACCEPTANCE_UNKNOWN | `Acceptance is unknown. OMA is observing the original invocation; do not resend or change identities to bypass it. The original record is at <path>.` |
| ORIGINAL_PENDING / existing 제안 | `No new attempt was started. The original proposal or operation is still pending. See <path> for its recorded state.` |
| ALREADY_APPLIED | `The change is already applied. Withdrawal cannot undo it. Inspect <applied-path> and use an evidence-based challenge or a new correction if needed.` |
| TERMINAL_REJECTION | `This request was permanently rejected by the Principal. It cannot be reopened or retried. A materially justified new proposal requires its own review.` |
| CAPACITY_FULL | `No new Worker creation was accepted. Enabled Worker capacity is full; waiting does not release a slot. Reuse a suitable peer or request a Human resource decision.` |
| SOURCE_PUBLISHED_CREATE_PENDING | `The starting commit is published and creation is accepted, but activation is pending. Do not create another name to bypass this operation.` |
| ATTACHMENTS_PENDING | `The message is accepted. Attachment publication is incomplete, so mailbox delivery is still pending. OMA will continue the original operation.` |
| PARTIAL_DELIVERY | `The message was accepted and delivered to some mailboxes. Remaining deliveries belong to the same message. Do not resend the whole message as recovery.` |
| AUTHORITY_DENIED | `The current actor is not authorized for this effect. Tool visibility or a peer message does not grant that permission.` |
| GOAL_REVISION_CHANGED | `No GOAL update was accepted. Read the current GOAL and context revision, reconcile the intended change, and publish with that exact expectation.` |
| PROJECTION_STALE | `These files show the last successful observation, not a confirmed current state. OMA could not refresh <scope>; existing confirmed facts remain valid.` |
| NEEDS_OPERATOR | `The original evidence is preserved, but automatic recovery cannot safely proceed. Continue unrelated permitted work or ask for a Human recovery decision; do not create a replacement operation.` |

이 표의 `No request was submitted`는 정말 preaccept no-send가 증명된 경우만 사용한다. timeout/invalid response/disk error 뒤에는 사용하지 않는다. `No decision was recorded`도 해당 invocation의 nonacceptance가 확인된 경우에 한정한다. 이미 accepted인 action에서 target-staleness가 나중에 관측됐다고 원래 fact가 없었다고 말하지 않는다.

## MCS-T13 — provider schema의 최소 예시와 검증

`oma_review`의 전송 전 정본 schema 예시:

```json
{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "target":{"type":"string","description":"Exact OMA target path: review for approve/reject, your submission or vote for withdrawal. Do not use a mutable status path or construct a target yourself."},
    "decision":{"type":"string","enum":["approve","reject","withdraw"],"description":"approve or reject records a verdict; withdraw retracts only the exact owned record named by target."},
    "reason":{"type":"string","minLength":1,"pattern":"\\S","description":"Reasoned findings and relevant evidence for this exact target, including material uncertainty."}
  },
  "required":["target","decision","reason"]
}
```

Provider strict 변환에서 optional을 nullable-required로 바꾸는 경우에도 원래 의미를 보존해야 한다. enum을 임의 string으로 풀거나 required를 잃거나 non-coercing guard를 우회하면 gate failure다. `target`의 정본 pattern은 공개 경로 문법으로 생성하되 platform actual root 차이를 허용한다. 설명의 예시 문자열을 실제 identifier로 허용하는 test fixture를 만들지 않는다.

모든 field help·description·snippet은 단일 registration metadata에서 production·schema snapshot·문서 검사로 연결한다. 모델 프롬프트와 START에 별도 수기 인자 표를 만들어 drift를 늘리지 않는다.
