# OMA 모델 협업 도구 표면 — 설계 초안

상태: **검토용 제안 / 미채택 / 미구현**. 이 문서는 현재 실행 계약, DR64의 exact-selection 정책, 과거 accepted fact 또는 검증 결과를 변경하지 않는다. 검토 입력은 `a47f70af`와 그 위의 미커밋 작업트리다. 런타임 구현은 하지 않았다.

후속 검토: [파일 기반 읽기와 명시적 행동 재설계안](filesystem-and-action-surface.md)이 공통 `oma_read`와 읽기에 따른 자동 도구 공개를 재검토했고, [의도 중심 협업 표면 전면 재설계안](intent-first-collaboration-surface.md)이 두 초안의 도구 구성을 대체하는 최신 제안이다. 아래 본문은 첫 초안의 기록으로 남기며, 세 안 모두 미채택이다.

## 1. 결론

> OMA는 독립 저장소, 신뢰할 수 있는 통신과 공유, 공식 변경과 이의 제기 수단을 제공한다. 모델은 프로젝트에 맞는 일을 하고 협업 방식을 정한다. 전달·실행·복구의 기계적 절차는 OMA가 맡는다.

권고안은 **공통 읽기 + 구체적인 행동 도구 + 문맥에 따른 추가 도구 공개**다.

- Worker의 기본 OMA 도구는 8개: `oma_read`, `oma_send`, `oma_spawn`, `oma_share`, `oma_merge`, `oma_challenge`, `oma_review`, `oma_wait`.
- Principal의 기본 OMA 도구는 6개: `oma_read`, `oma_send`, `oma_review`, `oma_goal`, `oma_agent_control`, `oma_society`.
- 수정·철회·의도적 재실행·구독·특수 context 게시는 필요할 때 원래 typed 도구를 공개한다. 실행 dispatcher를 만들지 않는다.
- request key, operation polling, delivery ACK, legacy adoption을 일반 협업의 필수 지식에서 제거한다. 기존 사실을 자동 ACK나 성공으로 바꾸지 않는다.
- LSP/web은 그룹 진입 도구로 누적 활성화한다. MCP는 기존 gateway를 그대로 사용한다. hashline 구현과 입력 계약은 재설계하지 않는다.
- LOC 감축, OS 지원 축소, 내구성 약화는 이 설계의 목표가 아니다. 내부 구현이 더 필요할 수도 있다.

## 2. 근거와 적용 한계

### 2.1 외부 근거

| 자료 | 확인한 내용 | OMA에 채택하는 것 / 채택하지 않는 것 |
|---|---|---|
| [METR 사건 조사 — collaboration](https://evals.alignment.org/blog/2026-08-26-openai-hugging-face-incident-investigation/#collaboration-on-the-message-board) | 공유 게시판에서 질문·답변·파일 전달·인계·조정이 생겼고, 규모가 커지자 우편함과 주제별 통신 규약이 발전했다. HOLD/VETO의 실패와 사칭 문제도 있었다. | 발견·직접 통신·접근 가능한 산출물을 기본 제공한다. 모델에게 통신 프로토콜이나 인증 체계를 발명하게 하지 않는다. 사건의 목적·권한 위반·무응답을 승인으로 간주하는 관행은 가져오지 않는다. |
| [Anthropic: Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | 기존 API endpoint를 일대일로 노출하는 것은 흔한 실패다. 도구는 명확한 목적을 가지며, 관련 정보를 묶어 반환하고 실제 과제로 평가해야 한다. | broker method 수와 모델 도구 수를 분리한다. 설명만 고치거나 action enum에 전부 넣는 방식은 피한다. |
| [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling/) | 이미 아는 인자를 모델에게 다시 채우게 하지 말고, 항상 연속 호출하는 기능은 결합하라고 권고한다. 초기 20개 미만은 soft suggestion이다. | request identity와 기계적 준비는 host가 담당한다. 숫자 20을 합격 기준으로 삼거나 필요한 판단을 숨기지 않는다. |
| [Anthropic: Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) | 도구 정의의 점진적 공개는 큰 카탈로그에서 유용하지만 탐색 지연과 구현 비용도 있다. | 작은 고정 그룹과 문맥 기반 공개를 쓴다. OMA용 의미 검색기·code-execution dispatcher는 추가하지 않는다. 특정 provider의 cache/성능 수치를 OMA의 성능으로 주장하지 않는다. |
| [Anthropic: Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | 별도 context와 직접 공유하는 산출물이 유용하다. 지속 실행에는 checkpoint와 복구가 필요하며, 코딩은 연구보다 병렬화할 수 있는 부분이 적을 수 있다. | 독립 clone과 직접 산출물 공유를 유지한다. 항상 병렬화하거나 중앙 orchestrator를 필수로 만들지 않는다. |
| [OpenAI Agents SDK: orchestration](https://openai.github.io/openai-agents-python/multi_agent/) | agents-as-tools와 handoff는 서로 다른 제어 구조다. | OMA Worker를 동기 함수 호출이나 대화 제어권 이전으로 바꾸지 않는다. 기존 독립 실행·메일 기반 동료 협업을 유지한다. |

이 자료들은 설계 근거이지, 이 초안이 현재 OMA의 모델·과제에서 더 낫다는 실험 증거는 아니다.

### 2.2 이번에 확인한 현재 코드의 사실

- `packages/domain/src/tool-surface.ts`: 현재 OMA 이름 24개. Worker OMA core 11개, Principal OMA core 7개.
- `packages/extension/src/review-tools.ts`: `oma_review_respond`에 토론·투표·철회·수정·재시도·legacy adoption이 섞여 있다.
- `packages/client/src/request-service.ts`: frozen request와 receipt 관측이 이미 존재한다. 없어지는 것은 모델의 수동 관리 의무이지 이 기반이 아니다.
- `packages/storage/src/ledger-reader.ts`: pending delivery 선택은 `materialized`, `presented`, `batch_id`로 결정되며 `acknowledged`에 의존하지 않는다.
- `packages/storage/src/transitions.ts`, `packages/mail/src/batches.ts`: presentation은 검증된 batch receipt로 정산되고, ACK는 별도 사실이다.
- `packages/extension/src/delivery.ts`: wait는 정상 delivery completion receipt를 만들지 않는다.
- `packages/review/src/status.ts`: Principal의 review 가시성과 Worker의 reviewer 관측은 다르다. 공통 읽기가 이를 넓히면 안 된다.

## 3. 모델에게 제공하는 기본 질서

### 3.1 환경과 권한

- 각 Worker는 독립 clone·index·worktree를 가진다. 다른 Worker의 merge로 자동 reset되지 않는다.
- 일반 읽기·편집·Git·빌드·시험은 기존 코딩 도구를 쓴다. OMA shell CLI를 다시 학습시키지 않는다.
- 공동 기록에는 안정된 작성자와 출처가 있다. 메일 본문이 신원·승인·완료 사실을 만들지 않는다.
- 공유 목표, 메일, 후보 commit, 공식 통합은 서로 구분한다. 대화나 문서 공유로 GOAL 또는 main을 변경할 수 없다.
- Principal은 사용자 의도·중요 판단·권한 있는 승인을 담당한다. shell·파일 쓰기·Worker 생성 권한을 새로 주지 않는다.
- 모델은 담당 선언, 요청, 제안, 인계, 임시 조정자 역할을 자유롭게 정한다. 이를 위한 task DAG, 강제 claim/lease, 중앙 reviewer 배정, 새로운 조직도 DB를 만들지 않는다.
- 시작 안내에는 목표, 자기 작업공간, 동료 발견, 메일 읽기, 코드 공유와 merge/challenge의 차이만 간결하게 설명한다. 내부 복구 매뉴얼을 넣지 않는다.

### 3.2 협업의 유연한 기본 습관

관련 기록을 확인하고, 중복 작업이 우려될 때만 담당 범위·인터페이스를 알린다. 받은 작업에는 필요한 맥락과 결과 증거를 돌려준다. 좋은 기존 동료가 있으면 재사용하되 필요한 독립 작업에는 새 Worker를 만들 수 있다. 기다리는 동안 유용한 독립 작업이 있으면 하고, 없으면 기다린다. 모든 읽기·수정·시험마다 보고하도록 강제하지 않는다.

## 4. Worker 기본 도구 8개

아래는 논리적 입력 계약이다. `?`는 생략 가능을 뜻한다. 실제 JSON Schema는 현재 provider 변환기의 지원 범위에서 별도 검증한다. 명시적 `request` 인자는 모델 schema에 두지 않는다.

| 도구 | 논리적 입력 | 한 가지 주된 의미 |
|---|---|---|
| `oma_read` | `{ref?, query?, cursor?}` | OMA 기록과 현재 관측을 읽는다. 생략하면 자기 역할의 시작 화면이다. |
| `oma_send` | `{to: Address[], body, subject?, replyTo?, urgent?}` | 사람/동료/commons/topic과 대화한다. replyTo로 기존 논의에 연결한다. |
| `oma_spawn` | `{name, brief, from?}` | 독립적으로 실행할 Worker를 만든다. |
| `oma_share` | `{title, body, candidate?, to?}` | committed 결과를 동료가 가져다 쓸 수 있도록 게시한다. main에는 반영하지 않는다. |
| `oma_merge` | `{title, reason, tier, candidate?, base?}` | committed 변경을 공식 통합 대상으로 제안한다. |
| `oma_challenge` | `{merge, title, reason, tier, replacement?}` | 실제 반영된 변경의 결함에 대해 revert 또는 replacement를 제안한다. |
| `oma_review` | `{target, decision: approve/reject, reason}` | 특정 검토 대상에 대한 독립 판단을 공식 기록한다. |
| `oma_wait` | `{note?}` | 필요한 후속 맥락을 남기고 현재 실행을 안전하게 양보한다. |

### 4.1 `oma_read`: 하나의 읽기 방식, 여러 실제 자료

파일 `read`를 바꾸지 않는다. `oma_read`는 현재 `oma_mail_read`와 분산된 OMA 조회를 대체한다. 임의 method나 SQL을 받지 않는 읽기 전용 탐색 표면이다.

기본 화면은 다음을 짧게 제공한다.

- 현재 GOAL의 revision과 읽기 참조.
- 새 전달 안내와 받은 메일의 참조.
- 자기 요청의 의미 있는 진행 변화·불확실한 결과.
- Worker에게는 동료 목록, commons, topic, review 목록으로 가는 참조.
- 자신의 생성 가능 여부와 사용 가능한 기존 동료에 관한 관측. 자원·권한 계산을 모델에게 시키지 않는다.
- 추가 기능을 찾는 짧은 안내. 모든 optional schema와 내부 operation 목록을 출력하지 않는다.

읽을 수 있는 자료는 mail, thread, inbox, commons/topic archive, 허용된 roster/agent 관측, goal/context, candidate, review와 diff, 자기 operation, 허용된 diagnostic이다. 모든 자료는 기존 audience·actor·role 검사를 통과한다. Principal은 이 도구를 통해 workers-only archive, Worker 전용 reviewer 목록 또는 현재 금지된 roster/log endpoint를 얻지 않는다.

**수신자 목록은 전달 대상이지 비밀성 경계가 아니다.** 현재 public/Worker archive와 audience의 읽기 범위를 그대로 따른다. 개인 inbox는 자기 전달 기록을 찾는 보기일 뿐 다른 Worker가 해당 archive 원문을 읽지 못한다는 보장이 아니다. reply의 수신자를 바꾸더라도 workers-only audience를 Principal에게 넓힐 수 없다. 새로운 비밀 DM 제품은 이 초안에 포함하지 않는다.

`ref`는 기존 message/request/actor/commit/operation identity를 가리키는 versioned 참조다. 모델은 출력에서 복사한다. 새 전역 object registry나 별도 사실 DB를 만들지 않는다. 정적 시작 참조와 표시 제목 외의 ID를 추측하게 하지 않는다. 아래 예시의 `<...Ref>`는 문법을 생략한 설명용 자리표시자이며 실행 가능한 축약 ID가 아니다.

`query`는 inbox/thread/commons/topic 같은 collection에서 제목·본문을 찾는 선택적 단순 문자열 검색이다. SQL·DSL·LLM 의미 판정을 받지 않는다. 지원하지 않는 단일 자료의 query는 명시적으로 거절한다. 검색은 보이는 원문을 대상으로 하고, 검색 실패를 결과 0건으로 표시하지 않는다. 기존 immutable archive와 안전한 읽기 경계를 재사용하는 새 조회 projection이며, 현재 typed mail-search API가 이미 있다는 뜻은 아니다. 별도 검색 서비스는 만들지 않는다.

목록에는 수신자·발신자·제목·순서·출처가 있고, 요약은 원문을 대체하지 않는다. snapshot/cursor를 제공하여 새 메시지가 추가돼도 페이지 간 누락·중복 여부를 설명할 수 있어야 한다. 늦게 생성된 Worker도 권한이 있는 commons 기록을 읽을 수 있지만, 과거 메시지의 수신자 snapshot이나 delivery row는 소급 변경하지 않는다.

### 4.2 review를 읽으면 검토에 필요한 정보가 함께 나온다

review 카드에는 제목·목적, 정확한 base/candidate, proposal revision, 검토 scope, 검사 결과의 출처, 필요한 승인과 작성자 제외, 적용 여부, 다음 자료 참조를 함께 제공한다.

작은 diff는 같은 답에 포함한다. 큰 diff는 명시적 preview와 전체 크기·digest·다음 페이지를 제공한다. proposal/original/applied/context는 카드가 내놓는 각 자료 ref로 선택한다. 일부 파일/한 페이지를 전체 변경으로 표시하지 않는다. 바이너리 변경도 누락을 알리고 정확한 bytes 참조를 유지한다.

읽기 결과는 `target`이라는 **검토 대상 참조**를 제공한다. 이것은 권한 token이나 '읽고 이해했다'는 증명이 아니다. 기존 request identity에 proposal revision·scope·policy·필요한 prepared integration identity를 결박하며, Principal인 경우 현재 broker-issued approval mail identity도 연결한다. 실제 승인 수락 시 broker가 모두 다시 확인한다. client에서 확인한 뒤 단순 request name만 보내는 것으로 끝내면 TOCTOU 문제가 남는다.

Principal의 승인을 최신 approval mail에 자동으로 다시 붙이지 않는다. 읽은 대상이 바뀌면 stale을 반환하고 새 변경을 읽고 판단하게 한다. 실제 추가 wire/plan 필드가 필요하면 새 형식으로 버전 관리한다. 과거 vote 의미를 고치지 않는다.

### 4.3 `oma_send`: 대화는 대화로

`to`는 항상 명시한다. 답장 카드에 reply 대상 주소를 제공하므로 모델이 주소 규칙을 추측하지 않는다. `subject`는 생략 시 reply 대상의 제목, 새 대화에서는 본문 첫 비어 있지 않은 줄에서 결정적으로 만든다. `replyTo`는 정확한 메시지 참조이며 thread audience를 넓히지 못한다.

question/result/assignment/comment를 별도 tool/action으로 나누지 않는다. 본문은 모델이 작성한다. 전송은 승인·GOAL 게시·task 완료를 뜻하지 않는다. `urgent`는 생략 시 false이고 일반 message로 보내며, true이면 기존 critical 분류로 보낸다. 긴급 여부는 실제 모델 판단이므로 남기되 question/result/context 등의 일반 분류 선택은 요구하지 않는다. 긴급 표시는 우선 처리에 참고하는 통신 정보이지 권한 상승·실행 선점·즉시 전달 보장이 아니다. host는 본문에서 'critical' 같은 단어를 찾아 이 값을 추측하지 않는다. 현재 `packages/mail/src/batches.ts`는 공개 주소만 받는 message와 그 밖의 메일을 다른 batch class로 취급하므로, 이 단순화의 전달 지연·공정성 변화도 검증한다. broker가 만드는 승인·검사·통합 결과의 확정 메타데이터는 계속 broker가 소유한다.

자기 후속 작업은 Worker가 `to: ["@self"]`와 `body`로 표현한다. `@self`는 실제 actor 이름과 충돌하지 않는 모델 표면의 별칭이고, host가 기존 `agent.continue` 경로로 변환한다. 이 경우 수신자는 하나여야 하며 subject/replyTo/urgent는 받지 않는다. Principal에는 이 별칭을 제공하지 않는다. 일반 메일의 실제 자기 주소를 쓰는 동작과도 구분한다. 원래 continuation의 현재 권한 검사를 그대로 적용하고, 원본 note를 고정해 다음 실행의 입력으로 남긴다. 자기 메모를 보냈다고 현재 작업이 완료되거나 곧바로 종료되지는 않는다.

review에 관한 토론은 해당 review의 통신 참조에 reply로 보낸다. binding vote만 `oma_review`를 사용한다. 기존 comment attestation은 과거 기록으로 계속 읽힌다. 새로운 일반 댓글을 기존 공식 판단으로 둔갑시키지 않는다.

### 4.4 `oma_spawn`: 동기 하위 함수가 아닌 동료 생성

`brief`에는 목표·경계·필요한 맥락·결과 증거를 담는다. 고정된 manager/implementer/reviewer enum을 추가하지 않는다. `from` 생략 시 최초 준비 시점의 canonical main을 정확한 commit으로 고정하며, 재시작 때 최신 main으로 바꾸지 않는다. published candidate를 시작점으로 지정하는 기존 능력도 유지한다.

현재 delegation·profile·maxWorkers·물리 종료 확인 규칙을 유지한다. 결과는 '생성 접수', '활성화', '실행 관측', '작업 결과'를 구분한다. 생성 완료를 기다리느라 호출자 모델을 막거나 작업 종료까지 하나의 tool call에 매달리지 않는다. Principal에게는 제공하지 않는다.

### 4.5 `oma_share`: 통합과 공유를 구분한다

`candidate` 기본값은 최초 호출 때 고정한 HEAD다. committed 코드·문서·검증 보고서를 기존 Git publication으로 게시한다. uncommitted 파일은 포함하지 않는다. `to` 기본값은 commons다.

수신자 제한은 알림의 수신자를 정할 뿐, 공개된 Git tree의 일부만 공유하거나 새로운 비밀 저장소를 만드는 것이 아니다. 결과에 정확한 commit·가져올 수 있는 ref·원문/증거 위치를 제공한다. 상대의 private workspace path만 주고 인계가 끝났다고 하지 않는다.

`oma_merge`는 필요한 게시를 자동으로 하므로 일반 통합 전에 share를 반드시 호출하지 않는다. share는 재사용·검토 전 협력·인계를 위한 독립 기능이다. 공식 GOAL/context를 바꾸지 않는다.

### 4.6 merge/challenge/review의 정책은 약화하지 않는다

`oma_merge`는 현재 tier 입력, 자동 candidate publication, base/candidate freeze, 작성자 provenance, 독립 승인, 검증과 CAS를 유지한다. 접수 결과에는 현재 관측과 review/diff 참조를 함께 반환해 즉시 status를 다시 부르는 일을 줄인다. 정상 진행과 실제 적용/차단/실패는 기존 이벤트·메일로 알린다.

`oma_challenge`는 적용된 merge만 받는다. replacement를 생략하면 현재 지원하는 broker-prepared revert, 있으면 candidate/base가 둘 다 필수다. HIGH를 LOW로 내리는 경로, 자동 승인, 자동 force-push, 자동 충돌 해결을 추가하지 않는다. challenge가 다루는 실제 applied delta와 원래 proposal을 구분한다.

LOW fast path, MEDIUM의 독립 승인, HIGH와 capacity fallback의 Principal 요구 등은 기존 정책을 따른다. eligible peer는 관측으로 제시할 뿐 자동 배정하거나 자동 생성하지 않는다. 모델들이 메일로 검토를 부탁하고 자발적으로 검토한다.

`oma_review`에는 approve/reject만 둔다. 검토 근거는 필수다. 자기 기여를 승인하지 못하며, 반대를 단순 reviewer 부족으로 처리하지 않는다. Principal reject의 영구 종료 의미도 바꾸지 않는다. 수정 요청은 토론으로 전달할 수 있지만 거절·철회 기록을 자동으로 지우지는 않는다.

### 4.7 `oma_wait`: 기다린다는 의도를 숨기지 않는다

wait는 모델의 실제 판단이므로 남긴다. polling loop, sleep duration, 배치 ID, ACK 목록을 입력받지 않는다. note가 있으면 기존 session의 영속 경계에 보존한 뒤 양보한다. note는 새 self-mail이 아니므로 자기 자신을 즉시 깨우지 않는다.

새 메일과 실제 상태 변화는 안전한 실행 경계에서 전달한다. 이미 기다리기로 한 batch가 즉시 반복 활성화되는 루프를 막되, 아직 교부하지 않은 메일은 누락하지 않는다. `wait`는 지금처럼 정상 batch completion을 만들어내지 않는다. 정상 응답 종료의 presentation receipt와 작업 완료 주장도 구분한다.

## 5. Principal의 추가 도구

| 도구 | 입력·의미 |
|---|---|
| `oma_goal` | `{body, expectedRevision, subject?}`. 현재 goal revision을 읽고 명시적 CAS로 전체 GOAL을 게시한다. `null`은 최초 게시이며 unconditional overwrite가 아니다. 다른 context 파일과 변경 알림을 보존한다. |
| `oma_agent_control` | 현재 start/stop과 name 계약을 유지한다. Principal stop과 그 해제는 안전 제어이지 일상 task 배정이 아니다. |
| `oma_society` | 현재 open/close 계약을 유지한다. close 성공은 실행 종료의 증거이지 프로젝트 완료의 증거가 아니다. |

Principal은 공통 read/send/review와 이 세 도구를 가진다. `ask_user_question`은 일반 사용자 대화 도구로 별도 유지한다. 판단 권한이 코드 쓰기나 Worker 생성 권한으로 확대되지 않는다.

## 6. 추가 행동은 필요할 때 typed 도구로 공개한다

핵심 도구의 거대한 action enum에 넣지 않는다. 처음부터 드문 복구·변경 schema를 모두 배우게 하지도 않는다.

| 추가 도구 | 입력 초안 | 발견 경로 |
|---|---|---|
| `oma_revise` | `{target, candidate, reason, base?}` | 자기 미적용 proposal 카드를 읽으면 공개 |
| `oma_withdraw` | `{target, reason}` | 자기 proposal 또는 자기 vote를 읽으면 공개 |
| `oma_retry` | `{attempt, reason}` | 자기 요청의 확정된 실패/재시도 가능한 준비 실패를 읽으면 공개 |
| `oma_follow` | `{topic, following: boolean}` | topic/구독 자료를 읽으면 공개 |
| `oma_context_publish` | 기존 `{directory, expectedRevision}` | 명시적 context.publish capability가 있는 Worker가 context 자료를 읽으면 공개 |
| `oma_agent_control` | 기존 `{action: start/stop, name}` | Worker가 자신 또는 제어 가능한 후손의 자료를 읽으면 공개. Principal에는 기본 제공 |

공개는 trusted projection의 고정 resource kind와 role/catalog 규칙으로 결정한다. 메일 본문·웹 페이지·MCP 설명의 tool 이름을 실행하거나 등록하지 않는다. 카드 결과는 '다음 모델 요청부터 어떤 도구를 쓸 수 있는지' 명시한다. 도구 결과가 영속화된 안전 경계 뒤 실제 schema가 추가된다. 공개된 도구는 해당 branch에서 누적 유지한다. 이후 상태가 바뀌면 호출 시 권한·전제 검사가 거절할 수 있다.

표면 공개는 효과를 실행하거나 권한을 부여하는 것이 아니다. `oma_read`의 업무 효과는 읽기뿐이며, 이 부가적인 도구 발견 동작은 설명에 명시한다. 알림만으로도 필요한 도구의 존재와 해당 카드를 알 수 있어야 한다. 이를 모르는 모델이 수정/철회에 도달하지 못하면 이 안은 실패다. 그 경우 해당 도구를 core로 승격하는 것이 대안이며, raw action dispatcher는 대안이 아니다.

`oma_withdraw`의 target은 자신의 proposal 또는 자신의 정확한 vote를 지목한다. 입력 형태는 같지만 결과는 proposal 취소와 vote 철회를 명확히 구분한다. 반영된 merge는 취소하지 못한다. 이를 구분하지 못하는 행동이 실험에서 반복되면 두 typed 도구로 분리한다.

`oma_retry`는 **확정된 실패 뒤 새 시도를 하겠다는 모델 판단**이다. transport 재전송과 다르다. unknown/pending attempt 카드에서는 retry 대상 참조를 제공하지 않는다. 다른 실패를 읽어 이미 도구가 공개됐더라도, unknown/pending을 대상으로 호출하면 효과 시점에 거절한다. retry 대상에는 request·proposal revision·정확한 실패 attempt를 결박한다. preparation failure는 실패한 준비 관측과 당시 revision을 구분해 결박한다. 기존 실패 receipt를 보존하며 승인이나 정책을 우회하지 않는다.

`oma_revise`는 읽은 proposal revision을 기대값으로 사용한다. 정책 변경 후 새 정책 아래 제안을 다시 제출하는 경우도 그 정책과 초기화되는 승인 범위를 카드에 명시하고, 새 revision으로 수락한다. 과거 기록의 암묵적 재해석은 금지한다. 구형 request 형식의 adoption은 이 경로에서 추측하지 않고 Human의 명시적 이행으로 남긴다. 현재 revise/adopt 경계와 달라지는 부분은 구현 전 별도 versioned 계약과 검증이 필요하다.

## 7. 모델에게서 제거하는 내부 운영 절차

### 7.1 ACK는 자동화하지 않고 일반 표면에서 제거한다

현재 pending selection과 completion은 ACK를 요구하지 않는다. 따라서 다음을 권고한다.

1. 새 모델 표면에서 `oma_mail_ack`와 ACK 지침을 제거한다.
2. 읽기·reply·wait·정상 turn 종료를 ACK로 변환하지 않는다.
3. 과거 `mail.ack` operation과 `acknowledged` fact는 원래 뜻으로 보존한다. 기존 요청의 조회·정산 경로도 유지한다.
4. '받았고 내가 처리하겠다'는 협업 의사는 일반 메일로 말한다. 이를 task 완료의 기계적 증거로 쓰지 않는다.
5. batch completion은 기존 trusted receipt 경로가 계속 담당한다.

이것은 새 ACK 자동화 시스템을 만드는 것보다 작고, 기존 사실의 의미도 더 잘 보존한다. 전체 runtime·UI 소비자에 ACK 필수 의존이 없는지 최종 확인하는 것이 제거 gate다.

### 7.2 request key와 transport recovery는 host/client가 소유한다

현재 `requestKeyOf`는 기록된 동일 호출 결과 수에 따라 새 key를 만들 수 있다. 따라서 schema에서 `request`만 지우는 것으로는 충분하지 않다.

- 최초 호출은 tool-call origin, actor, branch와 연결된 invocation identity를 **효과 전에** 기존 request-cache/session 경계에 보존한다. 인자·HEAD·bundle·본문은 처음 준비한 bytes로 고정한다.
- 중단 뒤에는 모델이 다시 호출하기 전에 미확정 invocation을 복원한다. receipt를 확인하고 원래 호출의 결과를 현재 관측으로 안내한다. 과거 transcript/receipt를 재작성하지 않는다.
- transport 재전송은 기존 same-key와 원본 bytes만 사용한다. 접수 부재가 명시적으로 확인되고 현재 계약이 허용할 때만 수행한다. '답을 못 받음'을 '안 보냈음'으로 바꾸지 않는다.
- 이미 accepted인 작업의 진행은 기존 broker recovery owner가 담당한다. client에 두 번째 effect executor를 만들지 않는다.
- 후보 게시→merge open 같은 복합 도구는 고정된 parent/child identity와 각 단계의 효과를 보존한다. 게시만 성공한 상태를 전체 merge 요청 성공으로 표시하지 않는다. 새 범용 workflow engine은 만들지 않는다.
- 같은 actor/scope에서 정확히 같은 입력의 미확정 호출이 있는데 새 모델 호출이 들어오면 새 key로 실행하지 않고, '새 실행은 시작하지 않음'과 기존 결과 참조를 돌려준다. 기존 receipt를 새 호출의 성공으로 표시하지 않는다. 단순 자연어 유사도로 서로 다른 의도를 합치지 않는다. 이 보장은 단일 invocation의 중복 방지이며 모든 의미적으로 유사한 모델 행동의 exactly-once 보장이 아니다.
- 결과가 확정되지 않으면 '접수/적용 여부 미확인, 조회 가능한 참조, 현재 가능한 다음 행동'을 보여준다. 무기한 모델 호출을 막지 않는다. 손상이나 원본 유실로 자동 진행이 불가능하면 Human 복구가 필요하다고 명시한다.

`oma_operation_status`는 사라지지만 자기 operation은 `oma_read(resultRef)`로 볼 수 있다. 정상 진행에는 의미 있는 상태 변화만 통지한다. 매 turn의 polling·새로운 완료 task queue·주기적인 LLM 호출은 만들지 않는다.

**출시 gate:** 이 재연결과 불확실성 처리가 검증되기 전에는 명시적 key 경로를 제거하지 않는다. old/new schema를 한 모델에게 동시에 내놓는 임시 상태도 피한다.

### 7.3 없어지는 모델 전용 절차

- `oma_mail_reply`: send의 replyTo와 표시된 주소/제목으로 대체.
- `oma_mail_approval_notice`: 일반 send와 정확한 후보 참조로 대체. 실제 Principal 승인 요청은 계속 broker만 발행.
- `oma_agent_continue`: self 통신으로 표현하며 기존 continuation 효과를 내부에서 보존.
- `oma_logs`: 허용된 진단 ref로 읽는다. Human 운영 진단 기능 자체를 없애지 않는다.
- legacy review adoption: 일상 Worker 업무에서 제거. 기록은 보존하고 explicit Human migration으로 취급.

## 8. 결과 표현과 알림

성공이라는 한 단어로 다음 사실을 합치지 않는다.

| 행위 | 구분해서 알려야 하는 것 |
|---|---|
| send | 접수 / 실제 전달 / 상대의 응답·작업은 아직 모름 |
| spawn | 접수 / 활성화 / 실행 관측 / 결과는 별도 |
| share | 정확한 commit 게시 / 알림 전달 / main 미변경 |
| merge/challenge | 요청 수락 / 검토 조건 / 검사·준비 / 실제 반영 / 통지 상태 |
| review | 내 판단 기록 / 전체 조건 충족 여부 / 실제 통합 여부 |
| wait | 양보 요청 / 후속 맥락 보존 / delivery·task 완료를 주장하지 않음 |

일상 결과는 간결한 텍스트와 자료 ref를 제공한다. 상세 operation ID와 원래 error code는 숨겨 없애지 않고 해당 자료에서 볼 수 있게 한다. 관측 시각·source revision·partial/unknown은 텍스트에도 표시한다. 중요한 내용을 모델에 전달되지 않는 details에만 넣지 않는다.

예시:

```text
변경 제안: 로그인 만료 처리 수정
요청: 기록됨
통합: 아직 안 됨 — 독립 승인 1개 필요
검토 가능한 동료: worker-b, worker-c (현재 관측)
검토/정확한 diff: <reviewRef>

이 결과는 승인이나 코드 반영을 뜻하지 않습니다.
```

직접 요청과 필요한 결과는 관련 수신자에게 전달하고, 일반 commons 정보는 현재 batching 정책을 따른다. 모든 본문·모든 상태 전이를 매번 전체 모델 문맥에 주입하지 않는다. coalescing은 원본 기록을 삭제하지 않으며 도착 순서·중단 후 복구를 보존한다. 남은 일이나 작업 완료 여부는 모델의 판단과 증거이지 unread/pending 숫자의 별명이 아니다.

## 9. LSP/web/MCP/hashline와 전체 노출

### 9.1 LSP/web 누적 개방

- 최초에는 `code_intel({})`, `web_research({})`만 보인다.
- 호출하면 기존 typed member tools를 다음 안전 경계에서 추가한다. 다른 그룹이나 이미 공개된 OMA 도구는 제거하지 않는다.
- `code_intel`은 Worker에서 현재 지원하는 diagnostics/fix/status, Principal에서 허용된 status만 연다. 새 IDE 기능을 지원한다고 주장하지 않는다.
- `web_research`는 기존 web_search/source_check/fetch_content/get_search_content를 연다.
- 개방된 그룹의 진입 도구는 다음 경계에서 숨긴다. 같은 batch에서의 반복 개방 요청은 idempotent하다. 원래 member tools는 누적 유지한다.
- 확정된 개방 상태는 현재 Pi branch/session 기록에 버전 관리하여 보존한다. 같은 branch의 resume와 Worker engine 재기동에서는 복원하고, 새 Worker/새 Society는 기본값에서 시작한다. role·provenance가 바뀌면 다시 검증한다.
- pending 공개와 확정 공개를 구분한다. 한 tool batch 안에서 registry를 바꾸지 않는다. 실제 provider 요청의 정의와 callable registry가 일치해야 한다.
- 기존 exact-selection `toolset`은 이 새 surface에서는 사용하지 않는다. 현재 DR64와의 충돌은 새 결정으로 명시한다.

### 9.2 나머지 도구

- `mcp`는 기존 단일 gateway로 제공한다. OMA가 MCP 서버 도구를 다시 group하거나 최상위로 중복 등록하지 않는다.
- read/write/replace/insert/replace_within/grep/find/ls/bash는 원래 계약으로 Worker에게 직접 제공한다. hashline 내부나 stale anchor 보장은 바꾸지 않는다.
- Principal은 기존 read/grep/find/ls와 ask_user_question만 가진다. shell·편집은 없다.
- 사용자가 역할에 명시적으로 켠 검증된 외부 extension 도구는 해당 역할의 별도 선택으로 직접 제공한다. 이것은 현재 optional 정책에서 달라지는 제안이며 admission·provenance·실제 권한은 유지한다. 새 extension 검색 서비스를 이 초안의 필수 구성으로 추가하지 않는다. 외부 도구가 많아질 경우 별도 측정 후 disclosure를 확장한다.

### 9.3 숫자를 정직하게 비교한다

OMA 고유 이름은 24개에서 **16개**로 제안한다. Worker는 기본 8개, 추가 6개(제어 가능한 경우의 agent_control 포함); Principal은 기본 6개다. Worker와 Principal의 4개 공유 이름을 중복 계산하지 않는다.

위 일반 도구를 모두 포함하고 외부 extension을 제외한 계산:

| 표면 | Worker | Principal |
|---|---:|---:|
| OMA 기본 | 8 | 6 |
| 일반 파일·코딩 / 파일·사용자 질문 | 9 | 5 |
| MCP | 1 | 1 |
| 닫힌 LSP/web 진입점 | 2 | 2 |
| **최초 합계** | **20** | **14** |
| LSP/web 모두 개방, 추가 OMA 미개방 | 25 | 17 |
| 허용 가능한 추가 OMA까지 모두 개방 | 31 | 17 |

기본 카탈로그의 W/P 고유 이름 합집합은 진입 도구까지 포함해 36개다. 외부 extension/MCP 내부 도구는 별도다. 두 그룹을 연 뒤 진입 도구가 숨겨진 상태의 전체 합집합은 34개다.

**현재 19/13보다 최초 총 이름 수가 오히려 하나씩 많다.** 이는 일반 편집 도구·MCP·두 진입점을 직접 제공하기 때문이다. 이 초안의 핵심 개선은 '초기 숫자 최저화'가 아니라 OMA core 11/7→8/6, 내부 운영 개념 제거, 복잡한 respond schema 해체, 반복 조회 감소다. token과 행동 비용이 실제로 줄지 않으면 성공으로 보지 않는다.

## 10. 실제 협업 흐름

### 10.1 동료와 나눠 구현하기

1. `oma_read()`로 GOAL·새 요청·동료·공유 기록을 확인한다.
2. `oma_send`로 관련 동료에게 범위·인터페이스를 알리거나 도움을 요청한다. 이미 적합한 동료가 있으면 사용한다.
3. 독립 작업이 필요한 경우 `oma_spawn`으로 self-contained brief를 가진 동료를 만든다. 생성이 작업 완료를 뜻하지 않는다.
4. 각자 일반 코딩 도구로 독립 clone에서 구현·시험·commit한다.
5. 중간 산출물을 재사용할 필요가 있으면 `oma_share`, 바로 반영을 제안하면 `oma_merge`를 사용한다.

### 10.2 검토와 수정

1. 검토자는 메일의 reviewRef를 `oma_read`로 읽고 필요한 exact diff·코드·증거를 확인한다.
2. 질문과 개선 제안은 `oma_send`, 공식 판단은 `oma_review`로 한다.
3. 작성자는 자기 proposal을 읽고 공개된 `oma_revise`로 수정한다. 읽은 revision과 달라졌으면 다시 확인한다.
4. 필요한 승인이 충족되면 기존 broker가 진행한다. 작성자가 별도 'apply'를 호출하거나 모든 상태를 polling하지 않는다.
5. 실제 반영 결과를 통지받는다. 결함을 발견하면 `oma_challenge`를 연다.

### 10.3 중단과 불확실성

1. merge 호출 후 연결이 끊겼다.
2. host는 다음 모델 실행 전에 원래 invocation과 frozen candidate를 복원하고 receipt를 관측한다.
3. 확인되면 그 결과를 보여주고, 아직 불확실하면 그대로 표시한다. 모델이 새 key를 만들 필요가 없다.
4. 다른 독립 작업을 하거나 `oma_wait`한다. 복구 불가능한 손상은 Human에게 알린다.
5. 검사 실패가 확정됐고 재실행할 이유가 있으면 그때만 `oma_retry`로 새 시도를 요청한다.

## 11. 기존 24개 도구의 처리표

| 현재 | 초안 |
|---|---|
| oma_agent_create | oma_spawn |
| oma_agent_control | Principal 기본 / Worker 문맥 공개, 기존 권한 유지 |
| oma_agent_continue | oma_send의 self-continuation 경로 |
| oma_agent_wait | oma_wait |
| oma_society | Principal 기본 유지 |
| oma_mail_read | oma_read |
| oma_mail_send | oma_send |
| oma_mail_reply | oma_send.replyTo, 별도 이름 제거 |
| oma_mail_ack | 모델 표면 제거, 과거 사실 보존, 자동 ACK 금지 |
| oma_mail_approval_notice | 일반 send로 대체, 실제 승인 요청은 broker만 발행 |
| oma_topic_subscription | 문맥 공개 oma_follow |
| oma_goal_publish | Principal oma_goal |
| oma_context_publish | capability가 있는 Worker에게 문맥 공개 |
| oma_candidate_publish | 기본 oma_share |
| oma_merge_open | oma_merge |
| oma_challenge_open | oma_challenge |
| oma_review_status | oma_read의 review 카드 |
| oma_review_diff | oma_read의 exact diff 자료 |
| oma_review_respond | 판단은 oma_review, 토론은 send, revise/withdraw/retry는 문맥 공개, legacy adopt는 Human 이행 |
| oma_review_list | oma_read의 review 목록 |
| oma_review_cancel | oma_withdraw의 자기 proposal 대상 |
| oma_status | oma_read의 허용된 roster/agent 관측 |
| oma_logs | oma_read의 허용된 diagnostic ref |
| oma_operation_status | host 관측 + oma_read의 자기 결과 ref |

이 표는 내부 method/DB fact를 삭제하라는 지시가 아니다. 모델 API와 내부 계약의 수명을 분리한다.

## 12. 채택하지 않은 대안

- **oma(action, payload) 하나:** 이름만 줄고 입력·상태 조합은 늘어난다.
- **기존 24개를 그룹 안에 그대로 보관:** 발견 비용만 바꾸고 모델의 운영 책임은 그대로다.
- **메일 본문의 '승인'을 자동 vote로 해석:** 토론·권한·정확한 변경 identity를 혼동한다.
- **모든 읽기를 일반 파일 read로 대체:** 원문 읽기에는 좋지만 최신 관측·역할 가시성·정확한 review target을 모델이 조립하게 만든다. 파일 read는 병행 사용하고 OMA 조회 계약은 별도로 둔다.
- **공유 상태를 전부 mutable Markdown으로 관리:** 기록·결정·현재 권한의 owner를 흐린다. 프로젝트 관행과 노트는 문서로, 공식 효과는 OMA로 구분한다.
- **자동 reviewer 생성·자동 업무 배정:** 모델 조직을 플랫폼 정책으로 고정한다.
- **wait 제거 후 주기적 '할 일 있니' 호출:** 실제 판단을 없애는 대신 낭비와 숨은 scheduler를 만든다.
- **실패한 검사 자동 재실행, 새 key로 unknown 탈출:** 실패 사실과 모델의 의도를 바꾼다.
- **숫자에 맞추기 위해 share/challenge를 숨기거나 제거:** 자발적 협업과 오류 교정이라는 핵심 affordance를 약화한다.

## 13. 구현 경계와 이행 순서

채택된다면 현재 문서를 덮어쓰지 않고 새 DR과 관련 owner 계약을 함께 변경한다.

1. **기준 측정:** 현재 tool schema/prompt token, 정상 협업 호출 수, polling/ACK/recovery 호출, 오류와 완료 품질을 기록한다.
2. **읽기와 결과:** 현재 ledger/domain owner를 재사용하여 공통 read projection과 exact target 검증을 만든다. 새 사실 owner나 범용 resource framework를 만들지 않는다.
3. **내부 복구:** invocation↔frozen request 재연결과 복합 도구 중단 복구를 먼저 검증한다. 그 전에는 모델 request-key 경로를 삭제하지 않는다.
4. **표면 교체:** 새 session/surface version에서 8/6 기본 도구와 추가 도구 공개를 적용한다. 같은 모델 요청에 old/new alias를 모두 올리지 않는다.
5. **전달 지침:** ACK 요구를 제거하되 batch/receipt/wait 의미를 유지하고, self-continuation을 검증한다.
6. **누적 공개:** LSP/web·OMA 문맥 공개를 같은 host surface owner와 안전 경계에 연결한다. 외부 extension admission도 새 정책으로 명시한다.
7. **실제 모델 비교:** 고정된 provider/model/effort와 과제에서 비교한 뒤 채택한다. 실패하면 필요한 행동 도구를 core에 더하는 것도 허용한다.

owner 후보: model schema/presentation은 extension, 읽기 자료의 의미는 각 기존 mail/review/lifecycle owner, frozen invocation은 client/request cache와 engine boundary, 공개 상태는 tool-runtime, effect authority는 broker/domain, 실행·전달의 실제 수명은 기존 App/engine/mail owner다. 이를 위한 별도 daemon·task scheduler·ORM·메시지 bus는 추가하지 않는다.

과거 session은 자기 surface version과 accepted history를 보존한다. 진행 중인 old tool call을 새 의미로 재실행하지 않는다. 안전한 session 경계에서 명시적으로 전환하고, 필요한 과거 조회/decoder는 모델에게 중복 이름을 노출하지 않는 내부 호환 경로로 유지한다.

## 14. 검증과 성공 기준

### 14.1 기계적 회귀 — 예외 없이 보존

- tool 결과 저장 전후 kill, receipt 유실, 재시작, 같은 호출 복구에서 중복 effect가 없는가.
- accepted/unknown에서 현재 HEAD·본문으로 원래 요청을 다시 만들지 않는가.
- 후보 게시 성공/merge open 미접수 같은 부분 진행을 정확히 복구하는가.
- read와 approve 사이 proposal·policy·integration context·approval mail이 바뀌면 stale을 거절하는가.
- 새 읽기 표면에서 workers-only 메일·Principal 제한·다른 actor의 operation을 누설하지 않는가.
- read/send/wait가 ACK·투표·작업 완료를 자동 생성하지 않는가.
- wait 직전/직후 새 mail과 아직 교부하지 않은 mail이 유실되거나 반복 실행 루프를 만들지 않는가.
- known failed retry는 새 시도이고 unknown retry는 거절되는가.
- LOW/MEDIUM/HIGH, author exclusion, capacity fallback, challenge 적용 대상과 실제 delta가 유지되는가.
- disclosure 결과 영속화 전후의 crash/resume, 동시 그룹 개방, role 변경, vendor/extension shadowing에서 callable registry와 provider schema가 일치하는가.
- 실제 provider에 전달되는 required/enum/null/closed-object가 의도와 일치하는가.

### 14.2 행동 비교

비교군 A는 현재 도구, B는 이 초안, C는 B에서 revise/withdraw 등 추가 도구를 처음부터 공개한 버전으로 둔다. C로 문맥 공개의 비용과 이점을 분리한다. 최소 3회 반복의 작은 pilot으로 오류를 찾고, 미사용 과제와 충분한 반복으로 결과를 확인한다. 작은 pilot의 차이를 통계적으로 확정된 우위라고 하지 않는다.

과제에는 단독 수정, 서로 독립적인 병렬 작업, 긴밀하게 결합된 변경, 기존 동료 재사용, merge 없는 산출물 인계, reviewer 반대와 수정, HIGH/정원 fallback, 사후 challenge, 긴 메일 기록 검색, 신규 Worker의 맥락 회수, 강제 중단 복구를 포함한다.

평가는 최종 코드·시험·권한·정확한 기록으로 한다. 정해진 호출 순서를 따랐는지나 투표 개수로 성공을 정의하지 않는다.

측정 항목:

- 목표 달성·회귀·인계 성공·실제 통합 품질, Human 개입.
- 잘못된 도구 선택/인자/상태 해석, stale 승인과 중복 효과.
- 도구 정의·결과 token, 전체 token·비용·벽시계 시간.
- 불필요한 ACK·operation polling·중복 status 조회·복구 수동 호출.
- 적절한 동료 발견·직접 협업·공유 결과 재사용.
- 공개된 추가 도구를 발견하지 못한 비율과 공개로 추가된 모델 왕복.

권고하는 채택 조건은 안전성 회귀가 없고, 결과 품질을 유지하면서 모델의 관리용 호출/혼동이 줄어드는 것이다. 총 도구 개수·LOC·메시지 개수만 줄어든 것은 성공이 아니다.

## 15. 최종 설계 판단

이 초안에서 가장 중요한 선택은 여덟이라는 숫자나 이름 변경이 아니다.

1. **읽기 표면은 하나로 정리하되, 의미가 다른 행동을 generic dispatcher에 넣지 않는다.**
2. **공유·merge·challenge·판단은 직접적인 도구로 남긴다.**
3. **ACK를 자동화하지 않고 불필요한 모델 의무에서 제외한다.**
4. **transport 복구는 내부화하지만 수정·철회·확정 실패 뒤 재시도는 모델의 명시적 선택으로 남긴다.**
5. **추가 기능은 발견 가능하게 제공하고 이미 열린 도구를 다른 그룹 개방 때문에 빼지 않는다.**
6. **안정성을 유지하기 위한 내부 복잡성은 허용한다. 그 복잡성을 모델의 일상 업무로 넘기지 않는다.**
