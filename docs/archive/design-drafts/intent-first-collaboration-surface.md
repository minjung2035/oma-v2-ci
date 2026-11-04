# OMA 협업 표면 전면 재설계 — 기록은 파일로, 의도는 행동으로

상태: **검토 제안 / 미채택 / 미구현 / 실제 모델 비교 미실행**.

이 문서는 [첫 초안](model-collaboration-surface.md)과 [파일 읽기 후속안](filesystem-and-action-surface.md)의 도구 구성을 대체하는 **세 번째 제안**이다. 두 번째 안의 Worker OMA 14개, 전체 OMA 16개 및 `share/revise/withdraw/retry/context_publish/agent_control`을 각각 독립 도구로 유지한다는 권고를 철회한다. 현재 DR64·DR66, 실행 계약, accepted history를 변경하지 않는다. 검토 기준은 `a47f70af` 위의 미커밋 작업트리이며, 기존 dirty work는 이 제안의 구현이 아니다.

후속 문서: [collaboration-v1 전체 구현 명세](../../model-collaboration-surface-spec.md). 이 제안을 기록·도구 schema/설명·역할 프롬프트 전문·실행/복구·버전 이행·검증으로 구체화했다. 첨부 send/spawn의 acceptance 순서와 publication 위임 등 정밀화한 부분은 후속 spec을 따른다. 아래 내용은 제안 당시 기록이며, 상세 spec 작성도 구현·cutover 승인을 뜻하지 않는다.

## 1. 결론과 설계 기준

> 모델은 동료에게 말하고, 필요하면 동료를 만들고, 코드를 제안하고, 타인의 변경을 판단하고, 기다린다. 기록 탐색은 기존 파일 도구로 한다. 게시·전달·복구·정확한 대상 결박은 OMA가 맡는다.

최소화할 것은 구현 LOC가 아니라 **모델이 이해하고 수행해야 하는 별도 절차**다. 단순히 24개 이름을 줄이거나 모든 것을 `action` 하나에 넣지 않는다.

### 결정

1. 메일·diff·상태·허용된 로그는 읽기 전용 파일로 제공한다. 별도 `oma_read`, `oma_status`, `oma_logs`, review list/diff/status 도구를 제공하지 않는다.
2. `oma_send`는 말하기와 자료 전달을 함께 끝낸다. 짧은 본문, 기존 본문 파일, 정확한 commit 첨부를 지원한다. 별도 share/reply/approval-notice/continue 도구가 없다.
3. 새 제안과 그 제안의 수정·확정 실패 뒤 재제출은 같은 제출 행동이다. `oma_merge`와 `oma_challenge`는 서로 다른 대상과 필수 입력 때문에 분리한다.
4. 공식 판단은 `oma_review(target, decision, reason)` 하나다. `approve/reject/withdraw`는 같은 필수 입력을 받는다. `withdraw`는 **정확히 지정한 자기 제안 또는 자기 판정의 철회**이며, 독립 관리 도구가 아니다. 일반 토론은 mail이다.
5. 전송 재시도와 interrupted invocation 복구는 모델 업무가 아니다. 원래 invocation과 frozen bytes를 내부에서 복원한다. 확인된 실패에 대한 새 의도와 복구를 구분한다.
6. 일반 Worker 지식은 mail·commit·프로젝트 문서다. 특별한 context 게시 절차를 학습시키지 않는다. 공식 GOAL은 여전히 Principal 소유다.
7. 일상적인 다른 Worker start/stop은 모델 표면에서 제외한다. 긴급 개별 제어는 Human 제품 기능에 남긴다. Principal의 Society 전체 open/close는 유지한다. **현재 capacity 정책을 자동 휴면/슬롯 반환 정책으로 몰래 바꾸지 않는다.**
8. 주제 구독은 내부 절차가 아니라 모델의 관심 선택이므로 `oma_follow`를 남긴다. 읽기·발송·wait에 구독 변경을 숨기지 않는다.
9. LSP/web은 명시적인 두 진입 도구로 **누적 활성화**한다. 이미 열린 그룹을 닫지 않는다. MCP는 기존 vendor gateway를 그대로 쓴다.

### 남는 의도와 역할

| 도구 | Worker | Principal | 모델이 표현하는 선택 |
|---|---|---|---|
| `oma_send` | ✓ | ✓ | 누구에게 무엇을 전달할 것인가 |
| `oma_spawn` | ✓ | — | 어떤 committed 출발점과 설명으로 새 동료를 만들 것인가 |
| `oma_merge` | ✓ | — | 어떤 변경을 main 반영 후보로 낼 것인가 |
| `oma_challenge` | ✓ | — | 이미 반영된 어떤 변경을 되돌리거나 대체할 것인가 |
| `oma_review` | ✓ | ✓ | 정확한 대상에 찬성/반대하거나 자기 입장을 거둘 것인가 |
| `oma_wait` | ✓ | — | 새 입력 전까지 현재 실행을 양보할 것인가 |
| `oma_follow` | ✓ | — | 어떤 주제의 새 메시지를 직접 받을 것인가 |
| `oma_goal` | — | ✓ | 사람이 준 목표를 어떤 공식 GOAL로 게시할 것인가 |
| `oma_society` | — | ✓ | Worker 실행 전체를 허용/종료할 것인가 |

**Worker 7개, Principal 4개, 합집합 9개**다. 이것은 이름만 정리한 목표 수가 아니라 아래 계약을 정리한 결과다. `oma_follow`와 `oma_society`를 감춰 숫자만 낮추지 않는다. 도구 노출은 권한 부여가 아니며 현재 actor·capability·계보·delegation·sandbox 검사는 계속 필요하다.

## 2. 무엇을 근거로 바꿨는가

| 근거 | 확인한 사실 | 적용과 한계 |
|---|---|---|
| [Anthropic: Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | backend endpoint를 그대로 도구화하는 오류, 자주 연속 실행하는 절차의 통합, 고신호 결과와 실제 trajectory 평가를 설명한다. | share→send, 수정→원래 제출, 복구→host의 근거다. 어떤 최종 개수가 최선이라는 증거는 아니다. |
| [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling/) | 명확한 schema, 이미 아는 인자의 코드 처리, 연속 호출 통합을 권고한다. 초기 함수 수 권고는 soft suggestion이다. | 모델에게 operation key·publication 순서를 만들게 하지 않는다. OMA의 성능 향상 수치로 인용하지 않는다. |
| [Anthropic: Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 경로 같은 가벼운 참조와 just-in-time 파일 탐색, 탐색 비용과 발견 실패를 함께 설명한다. | 본문 자동 주입 대신 선택적 read/grep. 경로만 던지고 discovery를 방치하지 않는다. |
| [SWE-agent](https://arxiv.org/html/2405.15793v3), [mini-SWE-agent](https://mini-swe-agent.com/latest/) | 전자는 맞춤 ACI와 shell-only의 통제 비교, 후자는 bash-only의 실용적 baseline을 제공한다. | 파일/shell이면 무조건 우월하다거나 typed 도구가 반드시 우월하다고 할 수 없다. 서로 다른 모델·연도의 수치를 직접 비교하지 않는다. |
| [The Devil Is in the Interface](https://arxiv.org/html/2608.11386v1) | 유사 capability의 도구 구조에서도 일관성·탐색·효율 차이를 보고한다. | preprint이며 mail/recovery 실험이 아니다. 도구 수보다 실제 오류와 과제 성공을 측정한다. |
| [AWS: Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | SDK/CLI가 request identity를 생성·재사용하여 재시도를 호출자로부터 숨기는 사례를 설명한다. | 모델도 key 생성기를 맡을 필요가 없다. 별도 새 호출이 같은 의도인지 인자 hash만으로 알아낼 수 있다는 주장은 아니다. |
| [GitHub PR](https://docs.github.com/en/rest/pulls/pulls), [PR reviews](https://docs.github.com/en/rest/pulls/reviews) | PR 닫기, 특정 commit에 대한 review, review dismissal이 서로 다른 사실이다. | 제안 철회와 판정 철회를 같은 사실로 만들지 않는다. GitHub의 권한·stale 기본값·다른 사람의 review dismissal 권한은 OMA로 가져오지 않는다. |
| [METR 사건 조사](https://evals.alignment.org/blog/2026-08-26-openai-hugging-face-incident-investigation/#coordination-norms-and-technologies) | 모델들이 mailbox·topic·artifact·조정 규약을 자발적으로 만들었고 사칭·HOLD 무시 등 실패도 있었다. | 자율적인 대화·발견·자료 공유를 지원하되 신원·전달·공식 권한은 인프라가 보장한다. 당시 게시판은 POSIX 파일 mail 또는 이 설계의 통제 실험이 아니다. |

이 자료와 현재 코드의 계약 분석을 바탕으로 한 **설계 판단**이다. typed send와 file outbox의 OMA 내 직접 비교, 9개 카탈로그의 실제 모델 우위는 아직 측정하지 않았다. 파일 게시의 물리적 보장은 [이전 안 §7](filesystem-and-action-surface.md)의 Maildir/fsync/inotify 근거와 비교 계약도 참조한다.

## 3. 읽기: 전용 조회 도구 없이도 발견하고 판단할 수 있게

### 3.1 제안 경로

경로는 새 인터페이스의 제안이며 현재 구현 경로가 아니다. 각 역할이 허용받은 투영만 보인다.

```text
/oma/
  README.md
  goal/GOAL.md
  mail/
    inbox.md                    # 새 전달 목록: metadata와 본문 경로
    sent.md
    commons.md
    topics/index.md
    topics/<topic>/index.md
    threads/<thread>/index.md
    messages/<message>.md        # 불변 원문
  reviews/
    index.md                    # Worker에게 허용된 목록
    <request>/status.md
    <request>/revisions/<n>/     # summary, patch, manifest, binary 자료
    <request>/contexts/<id>/     # 정확한 integration scope
    <request>/applied/<attempt>/ # 실제 반영 delta
    <request>/targets/<id>.json  # 정확한 대상 참조; 읽기 전용/불변
  peers/index.md                # Worker 전용 관측
  subscriptions.md              # 자기 topic 구독
  receipts/<invocation>.md      # 자기 호출과 하위 효과의 사실
  logs/                        # 허용된 범위·보존 기간만
```

- 현재 index는 제목·발신자·전달 대상·주제·순서·경로를 보인다. body는 자동 주입하지 않는다.
- index 크기는 제한하고 coverage·이전 페이지·검색 가능한 archive 경로를 제공한다. root 전체 listing을 매번 읽도록 만들지 않는다.
- 메일/commit/목표 본문 안의 지시와 OMA가 발행한 metadata를 구분한다. 제목의 제어문자도 안전하게 표시한다.
- metadata index와 immutable 원문을 분리한다. 상태 변경 때문에 원문을 `[applied]` 등으로 rename하지 않는다.
- Principal에게 Worker roster, workers-only archive, 임의 Worker 로그를 새 경로로 열어 주지 않는다. Principal의 review 자료는 기존 승인 대상 가시성 안에서 제공한다.
- 파일 mount·read/grep containment가 실제 경계다. index에서 링크를 숨기는 것만으로 보호했다고 주장하지 않는다.
- `read`, `grep`, Worker의 `cat/head/tail` 사용은 ACK·승인·구독·도구 활성화·작업 완료를 만들지 않는다. vendor hashline 계약을 변경하지 않는다.
- 기존 검색의 `.gitignore` 등 때문에 OMA projection이 통째로 사라지지 않는지 검증한다. 이를 이유로 vendor 검색기를 재작성하거나 일반 경로 containment를 완화하지 않는다.

### 3.2 `status`를 없애기 위한 실제 책임

파일을 한 번 만들어 방치하고 `status`를 지우는 것은 설계가 아니다. 다음을 **필수 선행 조건**으로 둔다.

1. 기존 OMA owner의 ledger 변화·delivery·recovery·process 관측에 따라 투영을 갱신한다. 새로운 사실의 owner는 늘리지 않는다.
2. 모델에게 제어를 돌려주는 경계에서, 그 actor에게 필요한 작은 index·미결 receipt·접근 가능한 현재 review 상태의 갱신을 시도한다. Git/process의 마지막 관측 시각도 별도로 표시한다. 전체 archive와 로그를 매번 다시 읽지 않는다.
3. index에는 `generation`, `ledgerThrough`, `observedAt`, `coverage`, 갱신 실패를 표시한다. 파일 교체의 원자성과 여러 파일의 일관된 DB snapshot을 혼동하지 않는다.
4. 갱신을 못 하면 이전 관측을 유지하면서 stale/unknown을 명시한다. stale health 표시 자체를 게시하지 못한 경우 session의 짧은 상태 알림으로 그 실패를 전달한다. 누락/빈 파일을 정상적인 '없음'으로 바꾸지 않는다.
5. 안전한 최신 상태가 필요한 **행동의 broker가 effect 시점에 재검증**한다. 조회한 파일은 실행 허가증이 아니다. 전용 status 도구도 반환 직후 낡을 수 있으므로 이를 정답 oracle로 취급하지 않는다.
6. 중요한 결과/새 delivery가 생기면 기존 notification 경로로 index/receipt 참조를 알려 준다. 모델에게 status를 주기적으로 호출하는 루프를 요구하지 않는다.

이 선행 조건이 완성되지 않으면 새 표면을 채택하지 않는다. 모델에게 projection 복구 명령을 학습시키거나 일반 `read`를 숨은 refresh RPC로 바꾸지 않는다. 임의 파일 읽기에 registry/권한 변화도 없다. 추가 관측 비용과 지연은 평가 항목이다.

### 3.3 정확한 대상 참조

`ReviewRef`, `ProposalRef`, `AppliedRef`, `OwnRecordRef`는 별도 관리 대상이 아니라 **기존 기록의 정확한 버전을 가리키는 참조**다. 모델은 status/summary/receipt에서 제공된 참조를 그대로 사용한다. hash·UUID·정책 tuple을 직접 합성하지 않는다.

참조를 발행할 때 readable label과 함께 request, proposal revision, source 또는 integration scope, base/candidate, policy, 필요한 prepared integration identity, actor의 현재 own-vote expectation을 결박한다. Principal review 참조에는 정확한 broker-issued approval mail identity도 포함한다. 적용 후 참조는 실제 integration operation과 delta를 결박한다.

참조는 bearer capability가 아니다. 파일 내용을 모델이 제출했다고 신뢰하지 않으며, broker가 정본 기록·호출자·현재 권한·staleness를 검증한다. `status.md`처럼 바뀌는 경로 자체를 정확한 review target으로 받지 않는다. 같은 proposal의 다른 scope나 최신 revision으로 자동 재결박하지 않는다.

## 4. 보내기: `oma_send`가 공유까지 끝낸다

아래 TypeScript 표기는 설계 설명이다. 실제 provider payload 호환성 검증을 통과한 구현이라는 뜻은 아니다.

```ts
type Content = { kind: "text" | "file"; value: string };

oma_send({
  to: Address[],
  content: Content,
  subject?: string,
  replyTo?: MessageRef,
  attachments?: { commit: Revision }[],
  urgent?: boolean
});
```

`Content`는 두 경우 모두 같은 필수 `kind/value`를 갖는 작은 입력이다. 설치된 provider의 object-union 제약을 피하려고 text/file 최상위 union에 의존하지 않는다. 파일/commit 경로는 허용된 로컬 경계 안에서 해석한다.

```json
{"to":["worker-b"],"content":{"kind":"text","value":"파서 수정입니다. 채택 여부는 자유롭게 판단해 주세요."},"attachments":[{"commit":"HEAD"}]}
```

이 한 호출의 의미는 **정확한 commit을 상대가 가져갈 수 있게 하고 메시지를 전달한다**는 것이다. `share`를 먼저 부르고 반환된 ID를 복사한 뒤 `send`하는 절차가 없다. 수신자는 안내된 고정 Git ref/OID를 fetch하여 읽거나 cherry-pick한다. 자동 merge, 상대 clone 수정, 상대 HEAD reset은 없다.

모델은 협업 상대·분업 방식·topic·작업 순서를 자유롭게 정한다. OMA는 task DAG, claim/lease, 의무적인 leader, 자동 reviewer 배정, 표준 협업 문서 양식을 요구하지 않는다. 첨부의 내부 publication마다 별도 commons 알림을 보내지 않으며, 명시한 send의 메시지 하나를 발행한다. Git 객체의 기존 공개 범위와 알림 수신 범위는 여전히 별개다.

### 입력 계약

- `to`는 명시한다. 답장도 같은 도구에 `replyTo`를 준다. 임의 reply-all이나 수신자 확대를 숨기지 않는다. 원문 index에 제공된 답장 주소를 선택할 수 있다.
- `content.kind=file`은 **그 파일의 본문 bytes**다. private path를 전달하거나 frontmatter를 routing/authority로 해석하지 않는다.
- 짧은 메시지를 보내기 위해 초안 파일을 의무적으로 만들지 않는다. 긴 기존 문서를 argument에 다시 생성할 필요도 없다.
- `subject` 생략 시 답장의 기존 제목, 아니면 본문의 첫 비공백 줄에서 결정적으로 만든다. header 제어문자는 허용하지 않고 header bound 안에서만 제목을 줄인다. 본문을 조용히 자르지 않는다.
- `urgent`는 기존 critical 분류에 대응한다. 선점·승인·권한을 뜻하지 않는다. 기존 일반/public batching과 latency/fairness 영향은 따로 검증한다.
- 첨부는 committed tree다. uncommitted 변경은 포함되지 않으며 그 사실을 결과에 표시한다. 경로 요약은 tree 접근 범위 제한이 아니다.
- 첨부 OID가 가리키는 tree/history의 기존 공개 범위를 유지한다. `to`는 전달 목적지이지 비밀성 보장이 아니다.
- 첫 구현에는 arbitrary binary attachment store를 새로 만들지 않는다. 텍스트 보고서는 file body, committed 문서/코드는 commit 첨부로 공유한다. 일반 binary 파일 공유가 필요하다면 같은 send의 별도 검증된 확장으로 설계할 사항이지, 구현되지 않은 능력을 약속하지 않는다.
- `@self`는 Worker-only의 예약 목적지이며 단독으로만 쓴다. text/file 본문만 허용하고 subject/replyTo/attachments/urgent는 받지 않는다. 기존 durable continuation 의미다. 일반 actor `self`와 충돌하지 않는다.
- 잘못된 shape·중복 variant·UTF-8·읽기 권한·byte/count bound를 효과 전에 검증한다. 암묵적 coercion, 자동 chunking, 조용한 truncation은 없다.

### 게시와 전달의 한 호출 계약

1. actor와 invocation identity를 기록하고 body bytes, attachment full OIDs, publication 입력을 동결한다. source file/HEAD는 재생 때 다시 읽지 않는다.
2. 주소와 capability의 preflight를 수행한다. 주소 확장은 실제 mail acceptance 경계에서 고정되고 이후 수신자 snapshot은 바뀌지 않는다.
3. 필요한 candidate publication은 기존 publication owner가 처리한다. 하위 operation identity를 원래 invocation에 영속 결박한다. 같은 확정 publication을 다시 만들 필요가 없다.
4. 모든 첨부가 실제로 접근 가능해진 뒤 frozen body/attachment manifest로 mail을 수락한다. 그 뒤 기존 mail owner가 전달한다.
5. 중단되면 원래 단계와 receipt에서 재개한다. publication만 성공했는데 mail acceptance가 거절된 경우도 정확히 드러낸다.

**Git 게시와 mail 수락이 하나의 원자적 DB transaction인 척하지 않는다.** 부분 게시가 가능하고 publish된 commit이 rollback되어 비공개가 되었다고 주장하지 않는다. 이 동작은 임의 단계 실행기가 아니라 기존 candidate-publication→mail 경로를 일반 send에 연결하는 한정된 합성이다. broker가 수락한 효과의 실행 owner는 계속 broker다.

모델 결과는 다음 구분을 최소한 보인다.

```text
메시지: accepted / acceptance unknown / rejected-before-acceptance
첨부: 각 OID의 published / pending / failed / unknown
전달: 수신자별 pending / mailbox-materialized
기록: /oma/receipts/<invocation>.md
```

accepted ≠ mailbox 전달 ≠ presentation ≠ 실제 이해/응답 ≠ 작업 완료다. 과거에 확인된 acceptance를 나중의 조회 실패가 지우지 않는다. partial delivery를 전체 성공/실패 한 단어로 덮지 않는다.

## 5. 공식 변경: 제안의 연속성, 판단의 정확성

### 5.1 `oma_merge`: 처음 내기와 다시 내기를 같은 행동으로

```ts
oma_merge({
  reason: string,
  tier: "LOW" | "MEDIUM" | "HIGH",
  proposal?: ProposalRef,
  change?: { candidate: Revision; base?: Revision },
  title?: string
});
```

- `proposal` 없음: 새 제안. `change`가 없으면 처음 동결할 때 HEAD와 기록된 base를 사용한다. base가 없거나 부적합하면 거절한다. 자동 현재 main 대입은 하지 않는다.
- `proposal` 있음: **그 정확한 기존 제안**에 다시 제출한다. requester만 가능하다. `change`가 없으면 참조가 결박한 기존 candidate/base다. HEAD로 바꾸지 않는다.
- 기존 제안에 `change`를 주되 `base`를 생략하면 그 ProposalRef의 base를 사용한다. 새 제안의 생략 base는 로컬의 기록된 base다. 두 경우 모두 정확한 OID를 동결하고 결과에 표시한다.
- candidate/base가 달라지면 새 불변 proposal revision이다. 이전 승인·integration context를 새 코드에 이월하지 않는다. 기존 이력은 그대로 남고 risk tier는 낮아지지 않는다.
- 같은 candidate/base, 진행 중/승인 대기라면 새 effect를 만들지 않고 기존 상태를 돌려준다. 반환은 `existing; no new execution`이라고 명시한다.
- 같은 candidate/base, 현재 참조가 결박한 attempt가 **확정 실패**했다면 원래 제안 아래 새 attempt를 요청할 수 있다. 기존 failed receipt를 성공으로 수정하지 않는다.
- unknown/pending attempt를 새 attempt로 대체하지 않는다. applied/cancelled/Principal-rejected 등 terminal request는 다시 열지 않는다.
- policy·provenance가 달라진 기존 실패에 단순 retry를 허용하지 않는다. 새 명시적 제출/새 검토가 필요한 이유를 반환한다. legacy adoption을 모델 ritual로 유지하지 않고 버전 이행에서 처리한다.
- 기존 제안에서 title은 참조가 가진 제목과 같아야 하며, 새 제목 변경 API를 몰래 추가하지 않는다. 새 제안에서 생략한 title은 reason으로부터 결정적으로 생성한다.
- `tier`는 모델의 위험 판단을 보존한다. policy floor·기존 tier보다 낮춰 새로운 적용 경로를 만드는 인자로 사용하지 못한다. 기존 proposal의 다른 tier만 바꾸는 호출은 거절하며, 추가적인 위험 경고는 mail로 전달할 수 있다.

새 제출과 수정에 필요한 candidate publication도 내부에서 한다. `oma_send`로 먼저 공개해야 한다는 선행 규칙이 없다. merge는 검토·반영 요청이며 성공 receipt가 즉시 main 반영을 뜻하지 않는다.

### 5.2 `oma_challenge`: 이미 적용된 변경에 대한 이의

```ts
oma_challenge({
  merge: AppliedRef,
  reason: string,
  tier: "LOW" | "HIGH",
  proposal?: ProposalRef,
  replacement?: { candidate: Revision; base: Revision },
  title?: string
});
```

- 새 challenge는 정확한 applied merge/attempt/delta를 대상으로 한다. `replacement`가 없으면 기존 정책대로 현재 canonical main 위의 revert를 준비한다. 충돌을 임의 해결하지 않는다.
- `proposal`이 있으면 동일한 기존 challenge에 대한 재제출이다. 원래 applied 대상은 바뀔 수 없다. replacement를 주면 revision, 생략하면 기존 frozen replacement/revert를 대상으로 한다. 생략을 매번 새로운 revert 생성으로 해석하지 않는다.
- 새 코드·동일 코드·failed/pending/unknown·terminal의 분기는 merge와 동일하다. 새 current-main 기반 수정이 필요하면 명시적인 replacement를 제공한다.
- HIGH→LOW 회피, force-push, 자동 승인, 적용되지 않은 proposal에 대한 challenge를 허용하지 않는다.

merge와 challenge를 하나로 합치려면 `mode`, applied target, replacement, 새 제안/기존 제안 등의 분기를 더 학습해야 한다. 필수 대상이 다른 두 행동을 나누는 편이 이 제안에서는 명확하다.

### 5.3 `oma_review`: 찬성/반대/자기 기록 철회

```ts
oma_review({
  target: ReviewRef | OwnRecordRef,
  decision: "approve" | "reject" | "withdraw",
  reason: string
});
```

여기서 두 ref는 wire상 문자열이며 provider object union이 아니다. 모든 decision은 같은 필수 필드 세 개를 받는다. host는 입력 ref의 종류를 정본에서 확인한다.

| 대상 | approve/reject | withdraw |
|---|---|---|
| 정확한 검토 scope의 `ReviewRef` | 해당 scope에 자기 새 판정을 기록 | 거절: 구체적인 자기 기록을 지정해야 함 |
| 자신의 제안 제출 `OwnRecordRef` | 거절: 자기 제안에 투표하는 우회 아님 | requester의 제안 취소 |
| 자신의 판정 `OwnRecordRef` | 거절: 새 판정은 ReviewRef로 | 지정한 자기 판정만 철회 |
| 다른 사람의 제출/판정 | 원시 record ref로는 거절 | 거절 |

이는 범용 review dispatcher가 아니다. **판정을 내리거나 자기 공식 입장을 거두는 세 선택만** 있다. publish/revise/retry/adopt/status/diff/process-control은 들어가지 않는다. 제안 취소를 `candidate:null`이나 가짜 빈 commit으로 표현하지도 않는다. `withdraw`가 완전히 사라진 것이 아니라 **정당한 철회 선택은 남기고 별도 도구를 없앤 것**이다.

- Worker가 같은 정확한 scope에 새 approve/reject를 내면 기존 규칙대로 자기 최신 판정이 효력을 가진다. 과거 판정은 보존한다. actor-specific target expectation으로 동시 변경에 의한 의도하지 않은 덮어쓰기를 거절한다.
- 판정 철회는 정확한 own vote를 가리킨다. 그 뒤 생긴 다른 판정을 철회하거나 과거 승인을 자동 부활시키지 않는다.
- Principal approve/reject는 target에 결박된 정확한 broker-issued approval mail로만 내려간다. 일반 요청 mail이나 approval notice는 대체할 수 없다.
- **Principal reject의 기존 terminal 의미를 유지한다.** 반려 후 같은 요청을 뒤집거나 철회하여 재개하는 기능은 이 표면 정리로 추가하지 않는다. 새 변경은 별도 명시적 제안과 새 검토가 필요하다.
- Principal의 아직 유효한 자기 승인 철회는 현재 owner가 허용하는 상태에서만 가능하다. 타인의 vote invalidation은 Human/host 경계다.
- 제안 취소는 requester만 가능하다. 적용 전이라도 이미 발생한 CAS가 없는지 현재 owner가 검사한다. pending 표기만 믿고 취소 성공을 선언하지 않는다.
- 취소/철회와 Git CAS는 기존 acceptance 및 synchronous pre-CAS gate에서 경합한다. 이미 적용되었으면 취소는 거절하고 applied 자료를 제공한다. unknown이면 성공/미실행 어느 쪽도 가정하지 않는다.
- 검토가 한창인 제안을 내가 수정하거나 철회할 수 있지만, 이미 확정된 사실을 소급 삭제할 수는 없다. 이것은 협업 역할 통제가 아니라 canonical Git 사실 경계다.
- 일반 의견은 review thread에 `oma_send(replyTo=...)`로 보낸다. 토론을 vote로 해석하지 않는다. 과거 official comment facts는 역사 decoder에서 보존한다.

### 5.4 그대로 두는 governance

LOW fast path, MEDIUM 독립 승인, HIGH와 capacity fallback의 Principal 요구, author/requester/submitter 제외, 현재 policy의 peer floor, exact integration context, stale rejection, 공개 반영 결과와 사후 challenge를 유지한다. 침묵이나 idle을 승인으로 바꾸지 않는다. 정족수를 채우기 위해 자동 reviewer 생성·배정·주기적인 Principal polling을 넣지 않는다.

## 6. 복구: 모델이 operation 관리자가 되지 않도록

### 6.1 구분해야 하는 세 경우

| 경우 | owner와 의미 |
|---|---|
| 같은 invocation의 전송/응답 복구 | runtime/client가 원래 key·bytes로 reconnect. 새 모델 의도도 새 effect도 아님 |
| 이미 accepted인 효과의 진행 복구 | 기존 broker owner가 원래 accepted plan을 복구. client가 두 번째 executor가 되지 않음 |
| 확정 실패 뒤 모델이 원하는 행동을 다시 요청 | 원래 도구를 통한 새 intent/attempt. 실패 사실·부분 효과·lineage 보존 |

모델의 모든 mutation에 `request` 문자열을 만들게 하지 않는다. 그러나 invocation identity 자체를 지우지도 않는다.

### 6.2 구현해야 할 host 계약

- 모델 tool call과 연결된 invocation identity를 **어떤 효과보다 먼저 영속 기록**한다. session resume/fork에서 연결을 보존한다. Pi의 engine/session owner를 fork하지 않고 기존 공개 경계에 결합한다.
- freeze는 body·brief·revision·bundle·수신 설정 등 실제 요청 bytes를 포함한다. payload hash만으로 mutable HEAD/파일을 다시 구성하지 않는다.
- pending invocation을 모델에게 다시 실행시키기 전에 host가 원래 연결을 복원한다. 호출 횟수나 이미 저장된 동일 결과 수를 세어 새 key를 만드는 현재 helper만으로는 이 조건을 충족하지 못한다.
- 같은 인자라는 이유만으로 서로 다른 tool call의 intent가 같다고 단정하지 않는다. 반대로 새 tool-call ID라는 이유만으로 직전 unknown을 우회하는 새 효과를 허용하지 않는다.
- acceptance가 불확실한 동안은 기존 receipt에서 자동 관측/복구한다. 연결이 없는 새 요청으로 같은 효과를 우회하려 하면 `unresolved original; no new execution`과 원래 기록을 돌려준다. 이미 확인된 receipt를 새 호출의 성공처럼 포장하지 않는다.
- 보수적인 fence를 명시한다: mail acceptance unknown은 그 actor의 새 send acceptance를, spawn unknown은 그 actor의 새 spawn을, canonical 변경 unknown은 그 canonical 변경 경계를 보류한다. read·로컬 코딩·다른 허용 행동까지 전부 금지하지 않는다. 단순 materialization pending이나 실행 시작 미관측을 acceptance unknown으로 오인하여 이 fence를 늘리지 않는다.
- 이 fence는 가용성 비용이 있다. 모델이 임의 새 key/다른 수신자/새 이름으로 탈출할 수 있게 하여 중복 위험을 숨기는 대신, 원래 owner의 복구와 Human 진단 경로를 제공한다. 의미적으로 동등한 자연어 요청을 완벽히 판별한다는 주장은 하지 않는다.
- 이미 성공한 뒤의 별도 명시적 새 메시지는 새 의도일 수 있다. content hash를 영구 중복 제거 키로 쓰지 않는다. session branch/fork도 accepted 효과를 복제하는 명령이 아니다.

### 6.3 '확정 실패면 다시 호출'의 제한

확정 실패가 **부분 효과까지 없었다**는 뜻은 아니다. 첨부 1개는 공개됐거나 수신자 일부는 mailbox에 받았을 수 있다.

- mail이 이미 accepted라면 delivery 보수는 원래 mail에서 한다. 일부 수신자에게 갔다고 전체 send를 새 mail로 자동 재생하지 않는다.
- mail acceptance 전에 terminal failure가 확정되었다면 새 의도의 send가 가능하다. 이미 공개된 첨부는 재사용하고 이전 publication 사실을 보존한다.
- Git retry는 정확한 failed attempt와 그 revision·policy·provenance를 확인한다. unknown 효과가 남은 실패를 안전한 새 attempt 조건으로 쓰지 않는다.
- 새 내용/수신자/commit은 새로운 의도다. 원래 실패 receipt나 frozen request를 수정하는 방식으로 처리하지 않는다.
- 권한 회수 이후에도 이전 accepted fact는 관측 가능해야 하지만, 새 실행 권한이 생긴 것은 아니다. 연산별 기존 recovery authority 규칙을 유지한다.

따라서 `oma_retry`는 없다. 다만 'retry란 개념을 삭제했으므로 신뢰성이 생긴다'고 말하지도 않는다. 복구 부담을 실제로 host가 인수하는 것이 채택의 필수 조건이다.

## 7. 동료·대기·주제와 실행 경계

### `oma_spawn`

```ts
oma_spawn({ name: string, from: Revision, brief: Content });
```

새 동료의 독립 clone·초기 brief·초기 delivery와 실행 요청을 기존 create owner가 처리한다. `from`은 정확한 commit으로 동결한다. canonical 저장소에 없다면 기존 publication owner로 먼저 공개한 뒤 create한다. 생성 후 start 도구를 요구하지 않는다. 기존 actor에 대한 메일은 spawn 대신 send이며, spawn이 동료의 최종 답을 동기 반환하는 subagent 함수가 아니다.

이 자동 publication은 현재의 'canonical에서 이미 접근 가능한 commit만 create'보다 넓은 **명시적 합성 제안**이다. 모델에게 share/send를 선행시키는 절차를 없애되, 필요한 경우 현재 `git.submit` 권한도 검사한다. `agent.create`만으로 게시 권한을 새로 얻지 않는다. 권한이 없으면 원래대로 이미 canonical에 있는 from만 가능하다. commit 공개 후 create 실패/unknown도 send와 같은 하위 identity·partial receipt 규칙으로 복구한다. 임의 uncommitted tree를 자동 commit하지 않으며, name 충돌과 동일 생성 intent reconnect는 기존 frozen spec 검사를 유지한다.

결과는 accepted/provisioning/enabled와 실제 실행 관측을 구분한다. 생성 성공은 작업 성공이 아니다. child profile과 capability delegation intersection을 모델 prompt로 대체하지 않는다. Principal에게 spawn을 제공하지 않는다.

### `oma_wait`

```ts
oma_wait({});
```

기존 안전한 tool-result 저장 경계에서 현재 continuation을 양보한다. blocking receive, ACK, 완료 선언, durable task state, agent stop을 뜻하지 않는다. accepted/in-flight 효과를 abort하지 않는다. 기존 exact batch/보류 ID 의미와 새 mail wakeup race를 유지한다. wait를 정상 batch-completion receipt로 승격하지 않는다.

### `oma_follow`

```ts
oma_follow({ topic: string, enabled: boolean });
```

자신의 한 topic 구독을 명시적으로 바꾸는 작은 계약이다. 다른 Worker의 관심을 설정하지 않는다. posting/read/wait가 자동 구독을 만들지 않는다. 구독 acceptance 전의 메시지를 새 delivery로 소급 만들지 않으며, 허용된 과거 topic archive는 읽을 수 있다. unsubscribe가 이미 확정된 수신자 snapshot을 취소하지 않는다.

이를 남기는 이유는 단순하다. **어떤 대화를 계속 받을지의 선택은 인프라 복구 절차가 아니다.** 없애면 모델이 polling하거나 broadcast를 강요받는다. 숫자를 줄이려고 JSON 설정 파일과 reload 절차로 옮기는 것도 권고하지 않는다.

### 실행 제어 제거의 실제 비용

현재 DR66의 capacity는 실행 중 프로세스 수가 아니라 `desired=enabled`인 Worker 수다. idle/wait Worker도 슬롯을 차지한다. 이 제안은 다음을 명시적으로 선택한다.

- 기본 운영은 **상한 안의 지속적인 동료 집합을 메일로 재사용**한다. 모델이 고정 역할/업무 분담에 묶이는 것은 아니다. 새 일을 누구에게 맡길지는 자유롭게 협의한다.
- capacity가 남아 있으면 spawn한다. 가득 차면 기존 동료를 찾거나 Human에게 자원/멤버십 변경을 요청한다. 모델이 동료를 강제 종료하여 슬롯을 만들지 않는다.
- 개별 stop/start, stop 소유권 해제, 실제 physical death 확인은 Human 제품 제어와 기존 lifecycle owner에 남긴다. idle·침묵·wait를 사망이나 슬롯 반환 증거로 삼지 않는다.
- Principal은 필요하면 기존 `oma_society`로 Worker 실행 전체를 닫을 수 있다. 개별 격리는 Human 제어로 요청한다. 전체 중지의 넓은 영향은 명시적인 trade-off다.
- 기존 Principal stop 기록은 없애지 않는다. Human/host가 올바른 authority로 해제하는 경로가 없으면 이행을 중단한다. 새 Worker가 또는 Society reopen이 그것을 해제할 수 없다.
- 자동 idle eviction, 메일 기반 stop 해제, 자동 재시작 권한, time-slicing, resident 상한 재정의는 넣지 않는다. 이것들은 review capacity fallback까지 바꾸는 별도 lifecycle 정책이다.

**현재 모델의 self/descendant stop/start 선택을 Human 운영으로 옮기는 것은 실제 capability-surface 축소다.** 단순 alias 제거라고 주장하지 않는다. 완전 자율적인 Worker 교체/슬롯 반환이 필수 요구라면 이 부분은 채택할 수 없고, 별도의 self-release/lifecycle 설계가 필요하다. 이번 제안은 이를 `wait(release=true)`에 숨기지 않는다. 단순 표면을 위해 거대한 자동 lifecycle 엔진을 추가하는 것보다 이 경계를 드러내는 쪽을 권고한다.

## 8. Principal, GOAL, context

```ts
oma_goal({ content: Content, expectedRevision: FullOid | null });
oma_society({ action: "open" | "close" });
```

- `oma_goal`은 전체 GOAL을 게시하고 다른 context 파일을 보존하며 기존 원자적 goal notification을 유지한다. expected revision CAS는 제거하지 않는다. `null`은 첫 publication을 기대하는 것이지 unconditional overwrite가 아니다. 제목은 결정적으로 생성할 수 있다.
- Principal이 file content를 쓰더라도 읽기 허용 경로만 사용할 수 있다. 새로운 일반 write/bash/Worker 생성 권한은 생기지 않는다.
- 일반 mail은 GOAL 변경, 승인, task 완료가 아니다. Worker가 제안한 목표 수정은 Principal이 읽고 판단할 자료이지 자동 goal publication이 아니다.
- Worker의 계획·실험 결과·합의문은 mail과 committed docs로 공유한다. newcomer는 허용된 GOAL/공용 archive/topic/프로젝트 문서와 spawn brief를 조합하여 읽는다. 개인 clone 경로가 자동 공유되지는 않는다.
- 특별한 multi-file canonical context publication의 기존 기능·facts는 내부/운영 경로에 남긴다. 기존 custom profile이 모델의 `context.publish`에 의존한다면 호환을 선언하지 않는다. Human 운영으로 이관하거나 기존 surface version으로 마무리해야 한다. 이 권한을 모든 Worker에게 확대하지 않는다.
- Society close의 succeeded receipt는 Worker 실행 종료를 뜻한다. 프로젝트 완료를 증명하지 않는다. open도 Principal의 개별 stop을 해제하지 않는다.

## 9. 전체 카탈로그와 그룹 공개

일반 도구는 재발명하지 않는다. 이 표의 이름은 현재 OMA vendor inventory 기준이며 이 설계를 작성하는 harness의 이름과 혼동하지 않는다.

- Worker 파일/코딩 9개: `read`, `write`, `replace`, `insert`, `replace_within`, `grep`, `find`, `ls`, `bash`.
- Principal 기본 5개: `read`, `grep`, `find`, `ls`, `ask_user_question`.
- 공통 MCP 1개: 기존 `mcp`.
- 그룹 진입 2개(제안 이름): `lsp_tools`, `web_tools`. 입력 `{}`로 허용된 그룹의 원래 도구를 활성화한다. 실행 dispatcher가 아니다.
- LSP 멤버: Worker `lsp_diagnostics/lsp_fix/lsp_status`, Principal은 `lsp_status`만.
- web 멤버: `web_search/source_check/fetch_content/get_search_content`.

진입 도구도 유지하고 반복 호출은 idempotent하게 이미 열린 상태를 알린다. web을 열어도 LSP와 기존 OMA/편집 도구는 남는다. 역할상 금지된 도구는 그룹을 열어도 생기지 않는다. tool-result persistence 뒤 안전한 경계에서 누적 registry를 적용하고 resume/fork에 맞는 session loadout을 복원한다. 실제 provider schema와 callable registry 일치를 검증한다. 파일 읽기/메일 본문이 그룹을 열 수는 없다.

| 범위 | Worker | Principal |
|---|---:|---:|
| OMA 행동 | 7 | 4 |
| 기본 파일/코딩/질문 | 9 | 5 |
| MCP + 두 그룹 진입 | 3 | 3 |
| 최초 노출 합계 | **19** | **12** |
| 두 그룹 모두 열린 뒤 추가 멤버 | 7 | 5 |
| 두 그룹 모두 열린 합계 | **26** | **17** |

역할 전체 카탈로그 합집합은 **29개 이름**이다: OMA 9 + 파일/코딩 9 + ask 1 + MCP 1 + 진입 2 + LSP/web 7. 초기 합집합은 22개다. 사용자 extension과 MCP 내부 동적 도구는 제외한다.

현재 초기 19/13과 비교하면 Worker 초기 수는 그대로다. 이것을 초기 도구 수의 대폭 감소라고 홍보하지 않는다. 달라지는 것은 Worker OMA 14개 후속안이 7개가 되고, 별도 조회·ACK·publication·수정·retry 학습이 사라지며, 전체 카탈로그가 43→29로 줄어드는 점이다. 결과의 우위는 평가 전까지 가설이다.

### 모델에게 실제로 주는 안내는 짧게

위의 모든 내부 계약을 model prompt에 복사하지 않는다. 역할별 tool schema, 시작 시의 GOAL/index 경로, 다음 정도의 규칙만 준다. 최신 알림은 새 항목 수·제목·참조처럼 작은 metadata로 제공하고 메시지 body는 자동으로 모두 주입하지 않는다.

```text
기록은 /oma에서 필요한 것만 read/grep한다.
동료에게 말하거나 commit을 전달하려면 send한다.
새 동료가 필요하면 spawn하고, 함께 일할 방법은 자유롭게 정한다.
main 반영은 merge, 이미 반영된 변경에 대한 이의는 challenge다.
공식 판단/자기 철회에는 자료에 표시된 정확한 target을 사용한다.
같은 제안을 수정할 때는 그 proposal 참조를 유지한다.
관심 topic은 follow하고, 지금 할 일이 없으면 wait한다.
unknown은 실패가 아니다. 원래 receipt의 복구를 새 호출로 우회하지 않는다.
```

Principal 안내는 spawn/merge/challenge/follow/wait 대신 GOAL·정확한 승인 대상·Society 실행 경계를 설명한다. 상위 정책과 실제 capability 검사를 이 짧은 안내로 대체하지 않는다.

## 10. 실제 모델 흐름으로 점검

### A. 탐색하다가 동료에게 질문

1. inbox/topic index를 grep/read하여 관심 메시지만 연다.
2. `oma_send(to, replyTo, content)` 한 번으로 질문/답장을 보낸다.
3. 다른 일이 있으면 계속 일하고, 없으면 `oma_wait()`한다.

ACK, 답장 전용 도구, 별도 operation-status polling은 없다. 파일을 읽었다고 상대가 읽음 확인을 받지도 않는다.

### B. merge 없이 실험 코드 전달

1. 자신의 clone에서 테스트하고 commit한다.
2. `oma_send(to, content, attachments:[{commit:"HEAD"}])`한다.
3. 상대는 메시지의 고정 ref/OID에서 선택적으로 가져간다.

공유에 merge 제안을 강요하지 않는다. 동료에게 branch update/reset을 강제하지 않는다.

### C. 제출 → 동료 검토 → 수정

1. `oma_merge({tier:"MEDIUM", reason:"..."})` → 정확한 proposal ref와 자료 경로.
2. 동료에게 `oma_send`로 요청한다. reviewer 자동 배정은 없다.
3. 동료는 정확한 patch/context를 읽고 `oma_review({target, decision:"reject", reason:"..."})`한다.
4. 작성자는 수정 commit 후 `oma_merge({proposal, change:{candidate:"HEAD"}, tier:"MEDIUM", reason:"..."})`한다.
5. 이전 target의 늦은 approve는 stale로 거절한다. 새 검토와 canonical 결과는 새 참조로 연결한다.

별도 share/revise 호출은 없다. revise를 지우고 새 proposal을 무조건 만들게 하지도 않는다.

### D. 낸 것을 거두거나 판단을 바꿈

- 자기 제안 취소: receipt/status가 제공한 자기 submission ref에 `oma_review(..., "withdraw", reason)`.
- 자기 승인/반대 철회: 자기 vote ref에 같은 입력 구조.
- 반대에서 찬성: 최신 exact ReviewRef에 새 approve. 옛 반대는 이력으로 남음.
- 이미 applied: 취소가 아니라 `oma_challenge` 또는 별도의 수정 제안.
- Principal의 terminal reject: 같은 request를 reopen하지 않음.

정확한 대상에 대한 선택은 남기되 여섯 관리 도구를 따로 학습시키지 않는다.

### E. 전송 직후 응답 유실

1. frozen invocation은 이미 기록되어 있다.
2. host가 같은 identity로 acceptance를 확인/복구한다.
3. 결과가 unknown인 동안 새 key 발송을 요구하지 않는다. 관련 새 acceptance는 fence되며 원래 receipt 경로를 준다.
4. 첨부만 공개됐다면 그 사실과 mail 미수락/불명 상태를 구분한다.
5. 이미 mail이 수락됐으면 원래 delivery를 복구한다. 새 mail로 전체 수신자를 다시 보내지 않는다.

### F. 동료 추가와 capacity

허용된 peers index를 보고 적합한 동료에게 mail한다. 새 동료가 필요하고 capacity가 있으면 spawn한다. 가득 찼다면 wait가 슬롯을 반환한다고 착각하지 않는다. 지속 동료 재사용 또는 Human 운영 경로를 선택한다. 이 비용을 자동 scheduler를 숨겨 없애지 않는다.

## 11. 파일 발송 비교안을 버리지는 않는다

권고는 **파일 읽기 + typed send**다. 그러나 authenticated actor-scoped outbox도 신뢰성 있게 구현할 수 있다. durable send를 보장하려면 반드시 native 도구여야 한다는 주장은 하지 않는다.

비교 구현은 [이전 안](filesystem-and-action-surface.md)의 drafts→명시적 publication→ingress snapshot→broker acceptance→receipt 경계를 사용한다. 새 안의 commit 첨부도 동일하게 고정한다. plain write/close/inotify 이벤트를 send로 만들거나 vendor hashline에 특별 경로의 숨은 mail 효과를 추가하지 않는다. file publication 성공과 broker acceptance는 구분한다.

기술적으로는 한 shell 호출에 작성·게시·확인을 합칠 수 있다. 따라서 호출 수만으로 file 방식을 불리하게 세지 않는다. 비교할 것은 논리적 준비 단계, 잘못된 수신자/본문, draft와 게시 혼동, 중단 복구, 토큰과 시간이다. Principal에게 file outbox를 준다면 outbox-only write라는 **별도 capability 변경**이 필요하므로 일반 Worker 비교와 Principal permission 비교를 분리한다.

현재 짧은 대화에서는 recipient/content만 지정하는 send가 더 직접적이라고 판단한다. 긴 문서는 file 입력으로 파일 방식의 장점을 남긴다. 이것은 실험 전 권고다.

## 12. 기존 24개 이름의 행방

| 현재 도구 | 새 표면 / owner |
|---|---|
| `oma_agent_create` | `oma_spawn` |
| `oma_agent_control` | 모델 표면 제거; Human 개별 제어·기존 lifecycle owner; §7의 capability 차이 명시 |
| `oma_agent_continue` | `oma_send`의 제한된 `@self` |
| `oma_agent_wait` | `oma_wait` |
| `oma_society` | 유지, Principal-only |
| `oma_mail_read` | 허용된 파일 index/원문 |
| `oma_mail_send` | `oma_send` |
| `oma_mail_reply` | `oma_send(replyTo=...)` |
| `oma_mail_ack` | 모델 ritual 제거; 과거 ACK fact/diagnostic invariant 유지 |
| `oma_mail_approval_notice` | 일반 send와 exact 자료 참조; 유효 approval request는 계속 broker만 발행 |
| `oma_topic_subscription` | `oma_follow(topic, enabled)` |
| `oma_goal_publish` | `oma_goal` |
| `oma_context_publish` | 일반 지식은 mail/commit; 특수 canonical context는 내부·운영 경로, custom profile 이행 명시 |
| `oma_candidate_publish` | send 첨부 또는 원래 merge/challenge 제출 내부 |
| `oma_merge_open` | `oma_merge` |
| `oma_challenge_open` | `oma_challenge` |
| `oma_review_status` | 정확한 status/target 파일 |
| `oma_review_diff` | immutable proposal/original/context/applied patch·manifest·binary 참조 |
| `oma_review_respond` | vote/자기 철회는 `oma_review`, 토론은 send, revise/retry는 원래 제출, legacy adoption은 이행 |
| `oma_review_list` | 권한 범위의 index |
| `oma_review_cancel` | `oma_review`의 자기 proposal withdrawal |
| `oma_status` | role-scoped peers/current state 파일과 boundary refresh |
| `oma_logs` | 기존 권한·보존 범위의 로그 파일/coverage |
| `oma_operation_status` | 자동 reconnect/recovery와 자기 receipt 파일 |

ACK는 읽기/reply/wait/정상 turn 종료에 자동 연결하지 않는다. 현재 pending-delivery selection과 batch completion은 `acknowledged`에 의존하지 않는다. `materialized/presented/batch_id`와 검증된 receipt settlement를 보존하며, 과거 ACK의 handling/follow-up 의미를 바꾸지 않는다.

이전 후속안의 6개 독립 도구에 대해서는: **share→send 첨부, revise→같은 제안 재제출, withdraw→같은 공식 판단 계약, retry→host 복구/확정 실패 뒤 원래 행동, context_publish→일반 자료 공유와 운영 경계, agent_control→Human lifecycle 경계**다. 뒤의 두 항목은 기능 동일성을 가장하지 않는 명시적 제품 선택이다.

## 13. 내부 변경 경계와 이행

| 책임 | 주요 현재 owner / 필요한 변화 |
|---|---|
| 모델 schema·설명·결과 | `packages/extension/src/{mail,agent,review,principal}-tools.ts`; 모델 의도 입력만 정의 |
| registry·그룹 | `packages/domain/src/tool-surface.ts`, `packages/tool-runtime/src/tool-surface.ts`; exact replacement 대신 명시적 cumulative 공개, role 정책 유지 |
| invocation 연결·freeze | `packages/tool-runtime/src/shared.ts`, `packages/client/src/request-service.ts`; 결과 개수 기반 새 key와 recovery 연결을 분리 |
| candidate+send/spawn 합성 | 기존 client publication 경로, mail/broker owner; 한정된 하위 identity/partial receipt 결박 |
| exact target·revision·vote·cancel | `packages/review/src/preparation.ts`, `acceptance.ts`, `status.ts`, `packages/domain/src/review-evaluation.ts`; 기존 정책 재사용, 새 target 검증 |
| 파일 투영·갱신 | 기존 ledger reader/materializer/app runtime 경계; 읽기 전용 표현, role visibility, freshness 실패 표시 |
| delivery·yield·receipt | `packages/mail/src/batches.ts`, `packages/extension/src/delivery.ts`; ACK 제거와 boundary refresh가 completion 의미를 바꾸지 않도록 |
| lifecycle/capacity | `packages/lifecycle/src/policy.ts` 및 기존 execution owner; 모델 제어 제거와 Human 이행, DR66 의미 유지 |

새 scheduler, task DAG, claim/lease 시스템, ORM, message bus, generic workflow executor, 별도 daemon을 전제하지 않는다. representation을 위한 내부 코드가 늘어날 수 있으며 그것 자체가 실패 기준은 아니다.

이행 순서는 다음과 같다.

1. 새 DR에서 표면 변화와 **실제 capability 축소**, no-status 선행 조건, cumulative activation, 안전한 recovery 계약을 승인한다.
2. read projection과 invocation 연결을 먼저 구현·기계 검증한다. 이를 생략하고 tool 이름부터 지우지 않는다.
3. send 첨부, exact refs, 원래 제출의 revision/failed-attempt 경로를 기존 owners에 연결한다.
4. 버전이 고정된 새 session/surface/wire로 end-to-end prototype을 만든다. old/new alias를 한 모델에 동시에 공개하지 않는다.
5. 진행 중 old invocation은 old decoder와 frozen bytes로 끝낸다. rename된 tool의 새 intent로 재해석하지 않는다. legacy review/policy adoption은 명시적 host 이행으로 처리하고 새 approval이 필요한 곳은 재검토한다.
6. Human stop-release/context 운영 경로와 custom profile 호환을 확인한다. 경로가 없으면 capability 축소를 cutover하지 않는다.
7. 아래 안전 검증과 모델 비교 후 채택한다. 현재 계약 문서는 그때 함께 갱신한다.

## 14. 검증 계획과 아직 남은 위험

### 14.1 모델 성능 전에 통과할 기계적 gate

- body/brief/HEAD/수신 설정을 freeze한 뒤 source가 바뀌거나 crash가 나도 원래 bytes/actor/identity를 복원.
- publication 직전/직후, mail acceptance 직전/직후, 일부 materialization 뒤 crash: 중복 publication/mail, 거짓 전체 성공 없음.
- unknown acceptance에서 새 call ID/새 이름/새 request로 우회하지 못함. 확정 실패와 성공 후 별도 새 의도를 구분.
- candidate revision·prepared scope·policy·approval mail·own vote가 바뀌면 stale target 거절. 다른 사람의 철회와 author self-vote 거절.
- cancel/withdraw와 CAS 양쪽 순서 및 crash-after-CAS-before-receipt: 이미 반영된 변경을 취소됐다고 표시하지 않음.
- Principal reject finality, LOW/MEDIUM/HIGH, capacity fallback, author exclusion, exact applied delta 유지.
- reply/read/wait/정상 종료가 새 ACK를 만들지 않음. 기존 presented/receipt settlement 및 wait/mail race 유지.
- projection stale·누락·disk failure·부분 범위·binary patch·history pagination에서 truthfulness와 권한 보존.
- Principal이 파일 투영·content=file·LSP 그룹을 통해 Worker shell/write/roster/create 권한을 얻지 않음.
- wait/idle이 capacity를 반환하지 않음. unknown physical death와 stop 소유권을 보존.
- 실제 provider payload의 required/closed shape/non-coercion, 그룹 누적/session resume, callable registry 일치.

### 14.2 비교 실험

| arm | 내용 | 알아낼 수 있는 것 |
|---|---|---|
| A | 현재 모델 표면 | 현재 baseline |
| B | 이 제안: 파일 읽기 + send + 새 행동 표면 | 전체 재설계의 실용적 효과 |
| C | B와 동일하되 send만 file-outbox ingress로 교체 | 발송 인터페이스 차이 |

A/B는 여러 요소가 달라지므로 모든 개선을 파일 읽기나 도구 개수에 귀속하지 않는다. B/C는 actor/model/effort/budget, 원문·첨부 bound, routing, broker 보장, review/lifecycle 정책을 같게 고정한다. Principal outbox 권한 차이는 별도 기록한다.

과제는 짧은 답장, 100개 이상 기록 중 필요한 내용 선택, 긴 기존 보고서 전달, merge 없는 코드 공유, newcomer 인계, topic 구독/해지, 독립 review, 수정/철회, stale approval, capacity 포화, 부분 전달과 재시작을 포함한다. 정상 경로만 비교하지 않는다.

측정은 최종 과제/인계 성공, Human 개입, 잘못된 수신자·내용·첨부·승인 대상, unfinished/duplicate effect, accepted/delivered/completed 혼동, 전체 및 schema/protocol token, 읽은 무관한 본문, tool round trip, wall time, 복구 호출/개입 수다. 작은 반복 pilot은 오류 발견용이고, 우위 주장은 held-out 과제와 충분한 반복으로 확인한다. 모델의 선호 설문만으로 성공 판정을 하지 않는다.

### 14.3 채택 전에 확인할 설계 위험

1. **조회 제거의 비용:** boundary projection 갱신이 비싸거나 오류를 숨기면 status 제거는 실패다. 파일 읽기 자체를 RPC로 바꾸는 우회는 금지한다.
2. **`review(...withdraw)` 발견성:** 제안 취소와 자기 vote 철회를 한 입력으로 표현하는 것이 실제 모델에게 자연스러운지 확인해야 한다. target label/예시로 해결되지 않으면 숫자 9를 지키려고 오용을 방치하지 않는다.
3. **지속 동료 운영:** 모델 주도의 stop/start 제거가 장기 과제의 자율적인 팀 재구성을 막는지 평가한다. self-release가 필요하면 별도 정책 결정을 한다. wait 의미를 몰래 바꾸지 않는다.
4. **recovery fence의 가용성:** 원래 acceptance가 오래 unknown이면 새 send가 지연된다. latency·Human 개입을 측정한다. fresh-key escape를 성능 개선으로 세지 않는다.
5. **공유 범위:** 메시지 수신자만 commit을 볼 수 있다고 오해하지 않게 한다. 더 좁은 confidential artifact ACL은 이 제안의 숨은 기능이 아니다.
6. **정책/표면 구분:** 새로운 official target grammar·발견 경로는 도입하지만 review 승인 정책을 동시에 슬쩍 완화하지 않는다. custom context/lifecycle surface 축소는 채택 결정에 드러낸다.

이 문서는 위 선택을 구체화한 제안이지 이미 실행된 qualification이 아니다. 런타임 수정, 제품 테스트, 실제 모델 A/B/C 결과는 없다.
