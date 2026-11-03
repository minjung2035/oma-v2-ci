# OMA 협업 표면 재검토 — 파일 기반 읽기와 명시적 행동

상태: **미채택 설계 제안 / 미구현 / 실제 모델 비교 미실행**.

후속 검토: [의도 중심 협업 표면 전면 재설계안](intent-first-collaboration-surface.md)이 이 문서의 도구 구성을 대체하는 최신 제안이다. 아래의 **16개 OMA 이름, Worker OMA 14개, `share/revise/withdraw/retry/context_publish/agent_control`의 독립 도구 유지 권고는 철회**했다. 파일 읽기와 file-outbox 비교 근거는 역사와 비교 자료로 남긴다. 아래 본문은 두 번째 초안 작성 당시의 제안이며 현재 권고 카탈로그가 아니다.

[첫 초안](model-collaboration-surface.md)의 공통 `oma_read`와 읽기에 따른 자동 도구 공개를 재검토한다. 이 문서의 권고안은 파일 기반 읽기와 typed 행동 도구의 혼합이다. 순수 파일 기반 발송은 구체적인 비교안으로 정의하되 기본 제품 계약으로 채택하지 않는다. 현재 DR64, 실행 계약, accepted history를 변경하지 않는다.

## 1. 권고 결정

1. 메일·diff·공유 문서·허용된 로그를 UTF-8 파일로 제공한다. 기존 read/grep 및 역할상 허용된 shell로 선택해서 읽는다.
2. 큰 통합 `oma_read`는 만들지 않는다. 최신 상태를 새로 관측할 때만 좁은 `oma_status`를 사용한다.
3. 메일 발송은 **`oma_send` 하나**로 확정한다. 짧은 메시지는 inline text, 이미 작성한 긴 문서는 file 입력을 받는다. 별도 reply/notice/send-file 도구는 만들지 않는다.
4. 원문 파일명은 불변 identity를 유지한다. 상태는 수령증과 목록에 `[accepted]`, `[delivered-to-mailbox]` 등으로 표시하며, 메일에 `[applied]`를 쓰지 않는다.
5. 공유·merge·challenge·공식 판단·수정·철회·의도적 재시도·실행 제어는 구체적인 행동 도구로 남긴다.
6. 파일을 읽는 동작에 ACK, 승인, 도구 공개, 작업 완료를 결합하지 않는다. LSP/web은 명시적 진입점으로 누적 공개한다.
7. 처음 평가할 때 OMA 행동 도구는 role/capability에 맞게 직접 제공한다. 드문 도구를 숨기기 위한 새로운 OMA dispatcher나 검색기를 추가하지 않는다.

판단 이유는 LOC나 raw tool count가 아니다. **내용을 탐색하는 선택권은 넓히고, 외부 효과를 확정하는 절차는 짧고 명확하게 만든다.** 신뢰성을 위한 내부 복잡성은 허용한다.

## 2. 웹 근거와 무엇을 주장할 수 없는가

| 근거 | 원문에서 확인한 것 | 이 설계에 대한 의미와 한계 |
|---|---|---|
| [SWE-agent, 2024](https://arxiv.org/html/2405.15793v3) | GPT-4 Turbo를 사용한 SWE-bench Lite 300개 과제의 ablation에서 맞춤 ACI가 shell-only보다 해결률 10.7%p 높았다. 파일 보기·검색·편집과 명확한 feedback을 함께 바꿨다. | 익숙한 shell만으로 항상 최선이라는 주장을 반박한다. 메일 전송이나 현재 OMA 모델에 대한 실험은 아니다. |
| [mini-SWE-agent 공식 문서](https://mini-swe-agent.com/latest/) | bash만 사용하는 단순한 agent를 연구·실사용 baseline으로 제공한다. 모델의 shell 활용을 중시한다. | shell 중심으로도 유용한 agent가 가능하다는 반대 방향의 증거다. 다른 모델·연도의 leaderboard 수치를 SWE-agent의 통제 비교처럼 사용하지 않는다. |
| [The Devil Is in the Interface, preprint](https://arxiv.org/html/2608.11386v1) | 주 실험은 SWE-bench Live 65개 과제, 모델 3개, architecture 6개, 각 10회 반복이다. 비슷한 capability에서도 일관성·탐색·효율이 달라졌다. structured atomic tools는 세 모델 모두 반복 성공 일관성을 높였고, 전반 해결률은 대체로 비슷했다. | 이름 수보다 인터페이스가 유발하는 행동·오류·비용을 측정해야 한다. 검색 구현에 subagent를 쓰는 조건 등 실험별 차이가 있고, 메일 또는 장애 내구성 연구는 아니다. |
| [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 파일 경로 등 가벼운 참조를 유지하고, grep/head/tail 등으로 필요한 내용을 just-in-time 가져오는 접근을 설명한다. 탐색 비용과 발견 실패도 경고한다. | 파일 기반 선택적 읽기를 지지한다. 디렉터리만 제공하고 발견 문제를 방치해도 된다는 뜻은 아니다. |
| [Anthropic: Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | API endpoint를 그대로 감싼 도구, 역할이 겹치는 도구, 과도한 출력을 경계한다. 실제 과제의 오류·호출 수·시간·token을 평가하라고 권고한다. | send의 의미를 하나로 유지하고 불필요한 mail-read/reply/status 절차를 줄인다. 도구 자체를 모두 없애라는 주장은 아니다. |
| [Manus: Context engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) | 파일을 복구 가능한 외부 context로 사용한다. 빈번한 도구 정의 변경의 cache·과거 도구 참조 문제를 지적한다. | 파일 기록과 안정적인 행동 표면을 지지한다. 특정 provider의 logits masking이나 cache 수치를 OMA에 그대로 적용하지 않는다. LSP/web 누적 공개를 취소하는 근거로 쓰지 않는다. |
| [qmail maildir(5)](https://manpages.debian.org/unstable/qmail/maildir.5.en.html) | 완성 전 tmp와 게시된 new/cur를 분리한다. 이 문서의 원래 게시 절차는 fsync/close를 확인한 뒤 link로 new에 공개하는 방식이다. | 파일 쓰기와 게시를 구분하는 실전 선례다. Maildir를 OMA의 ACK·권한·task 상태 모델로 그대로 가져오지 않는다. |
| [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html), [inotify(7)](https://manpages.debian.org/testing/manpages/inotify.7.en.html) | 파일 fsync와 디렉터리 항목의 내구성은 별개다. close-write는 writable file이 닫혔다는 이벤트이며, watcher 이벤트는 유실·coalescing·rename race가 가능하다. | '파일이 생김/닫힘/조용해짐 = 메일 수락'은 성립하지 않는다. OS별 물리 보장은 내부 owner와 실제 플랫폼 검증이 필요하다. |
| [METR 사건 조사: coordination](https://evals.alignment.org/blog/2026-08-26-openai-hugging-face-incident-investigation/#coordination-norms-and-technologies) | 모델들이 게시판에서 직접 통신·자료 공유·우편함·주제 채널·인계 규약을 발전시켰다. 거대한 root listing을 피하려고 mailbox를 만든 사례와 사칭·HOLD 실패도 있다. | 발견 가능한 기록과 자유로운 협업 공간을 제공한다. 모델에게 신원 인증·파일 분할 전송·전달 프로토콜을 발명하게 하지 않는다. 당시 게시판은 POSIX Markdown mailbox 실험이 아니며 native send와 비교되지 않았다. |

찾은 자료에는 **동일한 OMA 환경에서 Markdown outbox와 typed send를 직접 비교한 실험은 없다.** 아래 권고는 이 근거와 계약 분석을 바탕으로 한 설계 판단이지 실험으로 확정된 우위가 아니다.

## 3. 에이전트 관점의 비교

모델 부담을 도구 개수 하나로 보지 않는다. 다음 비용을 함께 본다: 설명/규약 학습, 대상 발견, 내용 선택·작성, 전송 확정, 결과 해석, 중단 복구. 정량 계수나 이론적 우위를 주장하지 않는다.

### 읽기

파일은 여러 메시지의 제목을 비교하고, 관심 단어가 있는 파일만 찾고, 특정 범위·문단·diff hunk만 읽는 데 유리하다. read/grep/shell을 이미 아는 모델이라도 OMA의 경로·권한·snapshot 의미는 안내받아야 한다. 거대한 디렉터리 하나와 무의미한 ID만 주면 이득이 줄어든다.

전용 읽기 도구는 검증된 metadata와 편리한 필터를 제공할 수 있지만, 필터 조합이 늘거나 결과를 과하게 반환하면 모델의 탐색 선택을 제한한다. 따라서 파일 표현을 기본으로 제공하고 목록/주제/스레드 index를 OMA가 만든다. 일반 파일 read를 없애거나 shell만 강제하지 않는다.

### 보내기

짧은 통신에서 필요한 선택은 보통 '수신자·내용·원문 참조·긴급 여부'다. send 한 번이면 이를 명시하고 직접 결과를 받을 수 있다. 파일 방식은 여기에 submission 이름, frontmatter, draft/게시 구분, 수령증 위치와 재사용 규칙을 추가할 수 있다.

반대로 긴 보고서가 이미 파일에 있다면 본문을 다시 tool argument에 생성하는 것은 낭비다. **파일을 입력받는 동일 send 도구**로 이 장점을 얻는다. 모든 짧은 메시지에도 파일 작성을 강제할 필요는 없다.

shell 한 호출에 작성·게시·확인을 합칠 수 있으므로 '파일 방식은 반드시 tool call 3회'라고 주장하지 않는다. 비교 대상은 tool round trip뿐 아니라 명령/규약의 논리 단계, feedback, error recovery다. native tool 역시 JSON/schema 오류와 불확실한 결과가 가능하다.

| 상황 | 권고 방식 | 이유 |
|---|---|---|
| 많은 메일 중 관련 내용 찾기 | 파일 + metadata index + grep/read | 읽을 범위를 모델이 구성 |
| 짧은 질문/답변/인계 요청 | inline oma_send | 발송 의도가 명확하고 준비 단계가 적음 |
| 이미 작성한 긴 Markdown 전달 | oma_send의 file 입력 | 본문 재생성·복사 없이 확정 |
| 큰 증거 묶음·코드 공유 | immutable artifact/candidate 게시 + 참조 | private path만 전달하거나 메일을 chunk로 나누지 않음 |
| 최신 통합/실행 상태 확인 | 좁은 oma_status | snapshot을 현재 권한·효과와 혼동하지 않음 |
| 반복·대량 기계 생성 메시지 | 별도 요구가 생겼을 때 파일 ingress 평가 | batch/파이프라인 장점이 있을 수 있으나 현재 기본 용도는 아님 |

## 4. 권고안의 파일 구조

아래 경로와 `<id>`는 제안용 표기다. 실제 OMA path/identifier 문법을 확정한 것이 아니다. `/oma`는 각 역할에 허용된 보기만 mount/materialize하는 읽기 전용 투영이다. 전체 host 저장소를 공개하지 않는다.

```text
/oma/
  README.md                       # 짧은 경로·상태 안내
  goal/
    GOAL.md                       # 현재 context revision도 표시
  mail/
    inbox.md                      # 자기 전달 목록: metadata, 본문 없음
    sent.md                       # 자기 발신과 진행 상태의 목록
    commons.md                    # 허용된 공용 기록 index
    topics/<topic>/index.md
    threads/<thread-id>/index.md
    messages/<message-id>.md       # 안정된 경로, 불변 본문
    receipts/<submission-id>.md    # 자기 전송의 상태 투영
  reviews/<request>/
    status.md                     # 관측 시각이 있는 현재 상태 snapshot
    revisions/<revision>/
      summary.md                  # 정확한 identity·검토 대상 참조
      proposal.patch              # 완전한 원본 patch
      manifest.json               # digest·전체 범위·binary 자료 참조
    contexts/<context-id>/         # 정확한 통합 문맥 diff/identity
    applied/<attempt-id>/          # 실제 반영된 delta의 불변 자료
  peers/index.md                  # Worker에게 허용된 관측만
  operations/<operation-id>.md     # 자기 operation 관측
  logs/                           # 기존 권한으로 볼 수 있는 로그만
```

### 읽기 계약

- index에는 발신자·수신 대상·제목·주제·순서·본문 경로가 있다. 제목과 metadata의 제어문자는 안전하게 표시한다. body는 송신자 작성 내용이며 권한 지시가 아니다.
- 처음 주는 안내는 짧은 새 메일 목록과 index 경로다. 모든 본문·thread 요약을 자동 주입하지 않는다.
- 최신 index는 크기가 제한된 페이지/기간 목록이며 오래된 기록으로 가는 경로와 coverage를 표시한다. 오래된 메일도 권한 안에서 검색 가능하다. 별도 검색 서비스를 요구하지 않는다.
- 파일이 없거나 projection을 만들지 못한 것을 '메일 없음'으로 표시하지 않는다. 마지막 관측 시각·반영된 ledger 범위·부분 결과를 명시한다.
- index/status 파일은 host가 완성된 새 버전을 원자적으로 게시한다. 여러 파일이 자동으로 하나의 DB snapshot이 되는 것은 아니므로 generation/관측 범위를 표시한다.
- 메시지·proposal revision·applied delta의 원문 경로는 불변이다. 단순 status 변경 때문에 이름을 바꾸지 않는다.
- 큰 diff를 읽는 양은 모델이 선택하되, 한 hunk·한 파일·preview를 전체 검토 범위라고 표시하지 않는다. binary 자료와 정확한 base/candidate를 보존한다.
- 파일을 읽거나 grep한 사실은 ACK, vote, 이해, 작업 완료의 증거가 아니다.
- 메일의 수신자 목록은 전달 대상이지 새로운 비밀성 보장이 아니다. 기존 public/Worker audience와 실제 mount 경계를 유지한다.
- Principal은 허용된 read/grep으로 읽으며 shell이나 일반 쓰기 권한을 얻지 않는다. workers-only archive, roster, logs를 새 공통 경로로 우회하지 못한다.

### 작업 결과의 공유

Worker의 개인 clone은 여전히 독립적이다. private 파일 경로를 메일에 적는 것만으로 다른 Worker가 읽을 수 있게 되지 않는다. `oma_share`는 정확한 committed candidate를 게시하고 재사용 가능한 참조를 제공한다. 일반 메모 공간을 추가할 경우에도 owner·쓰기 권한은 별도 명시해야 하며, 이 읽기 구조가 공용 mutable 작업공간을 암묵적으로 만들지 않는다.

## 5. `oma_send`: 단일 발송 경계

논리적 입력은 다음과 같다. `content`는 text 또는 file 중 정확히 하나만 받는 closed union이다. 실제 provider 변환 schema는 별도 검증한다.

```ts
{
  to: Address[],
  content: { text: string } | { file: string },
  subject?: string,
  replyTo?: MessageRef,
  urgent?: boolean
}
```

### 사용 예

짧은 답장:

```json
{
  "to": ["worker-b"],
  "replyTo": "<기존 메시지 참조>",
  "content": {"text": "만료 처리는 구현했습니다. 경계 조건 테스트를 검토해 주세요."}
}
```

이미 작성한 보고서:

```json
{
  "to": ["worker-b"],
  "subject": "만료 처리 검증 보고서",
  "content": {"file": "notes/auth-validation.md"}
}
```

- file은 **본문 bytes의 입력**이다. OMA가 경로를 상대에게 보내고 읽어 오라고 하는 것이 아니다. frontmatter에서 수신자·권한·명령을 추론하지 않는다.
- 입력 파일은 현재 actor에게 허용된 경로에서 안전하게 읽고 처음 수락할 내용을 고정한다. 중단 후 같은 호출을 복구할 때 파일을 다시 읽어 새로운 본문을 만들지 않는다.
- text/file 중복, 읽기 실패, 비정상 파일, UTF-8 실패, 크기 초과는 명확히 거절한다. 조용한 truncation·빈 본문 전송·분할 발송은 하지 않는다. 너무 큰 자료는 공유 산출물로 게시하고 참조한다.
- subject는 reply이면 원래 제목, 새 메시지이면 본문 첫 비어 있지 않은 줄에서 결정적으로 만들 수 있다. 기존 header 제한에 맞추는 규칙을 명세화하고 본문을 손상시키지 않는다.
- `to`는 명시한다. 원문 header/index에서 적절한 reply 주소를 복사할 수 있다. audience를 Principal 쪽으로 넓히는 우회는 금지한다.
- urgent는 모델이 선택하는 통신 특성이다. 권한·강제 선점·수신자의 즉시 응답 보장이 아니다. 기존 critical mapping과 batching 변화는 검증한다.
- Worker의 `@self`는 기존 continuation을 표현하는 예약 별칭으로 유지할 수 있다. 실제 actor 이름과 충돌하지 않으며, 단독 수신·본문만 허용하고 기존 권한 검사를 적용한다. Principal에게 새 continuation 권한을 주지 않는다.
- 일반 write/replace나 draft 저장은 발송을 일으키지 않는다. hashline/vendor 파일 도구에 메일 발송 부작용을 넣지 않는다.

### 정상 결과

```text
메일 요청이 수락되었습니다.
우편함 전달: 완료 (1/1)
본문: /oma/mail/messages/<message-id>.md
수령증: /oma/mail/receipts/<submission-id>.md
상대의 처리 여부는 확인되지 않았습니다.
```

이 결과의 '전달'은 mailbox materialization이며 상대의 본문 읽기·실행·작업 완료가 아니다. 다중 수신자는 전체 성공 한 단어가 아니라 수신자별 확인 범위를 보존한다.

불확실한 결과는 '접수 확인 불가, 원래 요청을 OMA가 관측 중'과 수령증 참조를 반환한다. host가 원래 invocation/key/bytes를 복원하고, 허용된 경우에만 same-key로 재전송한다. `oma_status`로 필요시 관측할 수 있지만 일반 정상 흐름에 polling을 요구하지 않는다. 결과가 바뀌면 기존 전달 경계로 짧게 알린다.

## 6. `[applied]` 아이디어에서 채택할 것

**상태를 한눈에 보이게 하는 것은 채택한다. 원문 파일명 변경과 의미가 모호한 applied는 채택하지 않는다.**

```text
mail/messages/<message-id>.md      # 이름 고정
mail/receipts/<submission-id>.md   # 경로 고정, host가 상태 투영 갱신
```

`sent.md` 예:

```text
[accepted; delivery pending] <id-a> → worker-b | 인터페이스 확인 요청
[delivered-to-mailbox]       <id-b> → worker-c | 검증 보고서
[acceptance unknown]         <id-c> → worker-d | 재현 증거
[rejected-before-acceptance] <id-d> → unknown-peer | 수신자 오류
```

상태의 의미:

| 표시 | 의미 |
|---|---|
| accepted | 원래 요청의 durable intent를 OMA가 수락했다. 전달 완료는 별도다. |
| delivered-to-mailbox | 수신자의 읽기 가능한 우편함에 게시된 것이 확인됐다. 읽음/처리 완료가 아니다. |
| acceptance unknown | 수락 여부를 현재 확인하지 못했다. 실패·미전송으로 해석하지 않는다. |
| rejected-before-acceptance | 해당 요청이 수락되기 전에 거절됐음이 확인됐다. |
| delivery pending/unknown/failed | 이미 수락한 요청의 전달 진행·관측 실패·확정 실패를 각각 구분한다. |

이미 확인한 accepted 사실을 이후 관측 실패 때문에 지우지 않는다. '과거 수락 확인됨 / 현재 전달 관측 불가'처럼 두 사실을 함께 보인다. presentation receipt는 필요한 상세 관측에 남기되 '상대가 모두 읽음'이라는 새 의미로 바꾸지 않는다.

파일명을 `[applied]<id>.md`로 바꾸면 기억한 경로·reply 참조가 깨지고, rename 관측 race가 생기며, grep 결과가 원문과 상태 이름에 중복되기 쉽다. 메일의 applied는 수락·전달·수신자 행동 중 무엇인지도 불명확하다. 상태 prefix는 **index의 표시**로 쓰고 원문 identity와 분리하는 편이 낫다.

상태를 `[accepted]`로 편집하거나 파일을 옮겨 공식 효과를 일으킬 수는 없다. status와 receipt는 host 소유의 읽기 전용 projection이다.

## 7. 순수 파일 발송을 선택한다면 — 구체적인 비교안

이 안도 단순히 'md 파일이 생기면 전송'으로 만들지 않는다. 작은 Maildir형 submission 계약을 정의한다. 기본 권고안과 동시에 모델에게 노출하지 않고 별도 실험 조건에서 사용한다.

```text
/oma-outbox/                       # actor별로 격리된 전송 입력 영역
  drafts/<submission-name>.md      # 작성 중. 일반 편집 가능. 발송 안 됨.
  ready/<submission-name>.md       # 명시적으로 게시한 요청. 재편집 금지.

/oma/mail/
  submissions/<submission-name>/
    request.md                    # OMA가 고정한 입력의 읽기 전용 사본
    status.md                     # 수락·전달·오류·관측 상태
  messages/<message-id>.md         # 수락한 메시지의 불변 원문
```

입력 파일 예:

```markdown
---
to: ["worker-b"]
subject: "만료 처리 검증 보고서"
---

경계 조건 검증을 완료했습니다. 결과와 재현 방법은 다음과 같습니다.
```

### 파일 계약

1. draft에 작성한 뒤 **같은 파일시스템에서 완성본을 ready로 충돌 없이 원자 게시**하는 것이 발송 의사다. ready에 직접 본문을 점진적으로 쓰는 방식은 지원하지 않는다.
2. frontmatter는 닫힌 작은 schema만 허용한다. to, subject, replyTo, urgent를 받으며 from, capability, operation method 같은 권한 필드는 받지 않는다. 임의 YAML tag/alias/실행 기능은 금지한다.
3. submission 이름은 actor와 Society/birth 범위에서 한 번의 전송을 식별한다. 같은 이름·같은 frozen 내용은 기존 요청을 관측하고, 같은 이름·다른 내용은 충돌이다. 같은 이름을 새 메시지에 재사용하지 않는다.
4. 권한 있는 ingress가 입력을 안전하게 snapshot/freeze한 후 기존 durable request/receipt 경로로 수락한다. 효과의 owner는 기존 broker다. 두 번째 메일 queue executor를 만들지 않는다.
5. `mv`의 반환값이나 ready의 존재만으로 broker 수락을 주장하지 않는다. atomic visibility와 crash durability는 다르다. 완성본 게시와 fsync/dir-sync, no-clobber, raw source 변경, snapshot 수락의 정확한 OS별 경계는 구현 전 닫아야 한다.
6. writable-file close나 일정 시간 동안 변경이 없다는 관측을 commit으로 사용하지 않는다. watcher는 빠른 발견을 돕는 힌트일 뿐이며 startup/overflow/restart 때 디렉터리와 기존 ledger를 재관측한다.
7. 게시 뒤에는 draft/ready 내용을 고쳐 재시도하지 않는다. 원본을 고정한 뒤에는 OMA가 복구를 맡는다. 수령증이 없다는 이유로 새 이름의 복사본을 보내지 않는다.
8. file 삭제는 전송 취소가 아니다. 수락 여부가 불확실한 제출을 지워 '없었던 일'로 만들지 않는다. 수락된 입력/receipt는 actor가 수정할 수 없는 기존 저장 경계에 둔다.
9. preaccept 오류는 status에 정확한 이유를 남긴다. 확실히 거절된 경우에만 수정한 새 제출이 허용된다. unknown은 새 제출로 탈출하지 않는다.
10. Principal까지 이 안을 쓰려면 outbox에 한정된 쓰기 수단이 별도로 필요하다. 일반 코드 쓰기 권한을 추가해서 해결하지 않는다.

### 이 안을 기본으로 고르지 않은 이유

파일 작성 자체는 익숙해도 'draft/ready, 한번 쓰는 이름, 게시 뒤 불변, 수령증, 미확정 제출 재사용'은 OMA 고유 규약이다. 안전한 게시 primitive를 모델에게 여러 명령으로 수행시키면 도구 하나를 없앤 이득을 상쇄할 수 있다.

반대로 일반 파일 도구의 특별 경로 동작에 모든 것을 숨기면 표면은 단순해지지만, write의 성공 의미·편집과 발송의 차이를 새로 정의해야 한다. 기존 vendor 도구에 숨은 메일 효과를 넣거나 새 FUSE/virtual filesystem을 필수로 도입하는 것은 지금 단계의 권고가 아니다. 내부 복잡성 자체가 나빠서가 아니라, **native send 한 번보다 모델에게 나은 결과가 확인되지 않았기 때문**이다.

한 shell 호출로 안정적으로 많은 문서를 게시하거나 기존 자동화 파이프라인을 연결해야 하는 요구가 커지면 이 안의 상대적 가치가 높아질 수 있다.

## 8. 나머지 도구와 권한

### 공통 역할 분담

| 기능 | 권고 표면 |
|---|---|
| 메일·thread·공유 기록·diff·로그 읽기 | 일반 파일 read/grep와 허용된 shell |
| 새 메시지·reply·topic 대화·self 후속 작업 | oma_send |
| 최신 실행/검토/자기 operation 관측 | oma_status |
| 독립 Worker 생성 | oma_spawn |
| exact committed candidate 게시 | oma_share |
| merge/challenge 제안 | oma_merge / oma_challenge |
| 공식 approve/reject | oma_review |
| proposal 수정·자기 제안/vote 철회·확정 실패 뒤 시도 | oma_revise / oma_withdraw / oma_retry |
| topic 구독·공식 context 게시 | oma_follow / 권한이 있는 oma_context_publish |
| 현재 실행 양보 | oma_wait |
| 제한된 agent 제어 | oma_agent_control |
| Principal 목표·Society 제어 | oma_goal / oma_society |

`oma_status`는 arbitrary query/SQL/file reader가 아니다. 표시된 actor·review·자기 operation 참조의 **현재 관측**과 관련 자료 경로를 반환한다. 생략하면 역할에 허용된 자기 상태 요약을 반환한다. 대규모 roster/review 목록은 페이지와 읽기용 index로 제공한다. 메일 body나 전체 diff를 같이 끌어오지 않는다. 전용 관측이 복잡해지면 subject별 좁은 도구로 분리할 수 있으며, 이름 수를 지키려고 generic dispatcher로 키우지 않는다.

검토 파일의 target은 exact revision/candidate/scope/policy와 필요한 integration identity 및 Principal approval mail에 결박한다. 파일을 읽었다는 이유로 권한이 생기지 않으며, approve/reject 시 broker가 다시 검증한다. 원래 target을 최신 대상으로 자동 교체하지 않는다. LOW/MEDIUM/HIGH·author exclusion·capacity fallback·challenge 대상 정책은 그대로다.

### 도구 노출

첫 비교 구현에서는 OMA 도구를 역할과 실제 capability에 맞춰 직접 노출한다. 파일을 읽었는지, 본문에 특정 tool 이름이 있는지로 registry를 바꾸지 않는다. LSP/web만 이미 합의된 명시적·누적 개방을 사용하고, MCP gateway·hashline·Principal의 shell/edit 금지를 유지한다.

고유 OMA 이름은 16개다. Worker의 역할상 catalog는 14개, Principal은 6개이며 4개가 겹친다. Worker가 모든 해당 capability를 가진 경우 이 14개를 기본 노출하는 baseline이다. 첫 초안의 'OMA 기본 8개 + 문맥 공개 6개'와 다르다.

일반 도구를 첫 초안처럼 직접 제공할 경우, 외부 extension 제외·MCP gateway 포함·닫힌 LSP/web 진입점 포함 최초 합계는 Worker 최대 26개, Principal 14개다. LSP/web 개방 뒤에는 진입점을 숨기고 기존 typed member tools를 누적 유지한다. 이름 수 증가를 숨기지 않으며 실제 정의 token·선택 오류를 비교한다. 늘어난 선택 비용이 나쁘면 보조 행동의 명시적 disclosure를 별도 평가하되, 이 파일/메일 비교와 동시에 여러 조건을 바꾸지 않는다.

### 기존 24개 처리 요약

- mail_read, review_diff, logs → 읽기 전용 파일.
- mail_send, mail_reply, mail_approval_notice, agent_continue → 단일 send.
- status, review_status, review_list, operation_status → 상태 파일/index + 필요시 좁은 status 관측. 정상 복구는 host 담당.
- mail_ack → 모델 의무 제거. 과거 ACK fact 보존. 자동 ACK 금지.
- agent_create, candidate_publish, merge_open, challenge_open, agent_wait, goal_publish → 각각 spawn/share/merge/challenge/wait/goal.
- review_respond → 판단은 review, 토론은 send, 수정/철회/retry는 별도 도구. 구형 adoption은 explicit migration이며 새 정책 revision 제출과 구분.
- review_cancel → withdraw.
- topic_subscription → follow.
- agent_control, context_publish, society → 기존 권한을 유지하며 존치.

이 정리는 내부 method/ledger를 삭제하라는 뜻이 아니다. 실제 cutover에는 새 DR, surface version, session 재개/호환 계약이 필요하다.

## 9. 평가 설계

### 비교 조건

- A: 현재 모델 도구 표면. 기존 실제 동작의 기준선.
- B: 파일 기반 읽기 + inline/file 입력의 typed send. 권고안.
- C: B와 동일한 읽기 및 나머지 행동 표면 + native send 대신 파일 submission. 발송 인터페이스만 다르게 한다.

B/C의 actor·model·effort·capability·budget·통신 정책·본문 크기·수신자·내부 broker 보장은 같게 둔다. 초기에 B 안에서 inline-only와 file 입력의 차이를 소규모로 확인해, file 입력이 실제로 긴 문서 재생성을 줄이는지도 본다. A/B는 여러 기능이 달라지므로 결과 전체를 '파일 읽기 하나의 효과'라고 해석하지 않는다.

### 실제 과제

1. 많은 관련 없는 메시지 사이에서 필요한 질문 찾고 짧게 답장.
2. 기존 Markdown 보고서를 정확히 전달하고 상대가 재사용.
3. 신규 Worker가 허용된 기록을 찾아 인계받기.
4. 직접 연락·commons·topic을 상황에 맞게 사용하고 중복 작업 줄이기.
5. 검토 자료를 부분 탐색한 뒤 정확한 revision에 판단.
6. 잘못된 주소·파일 경로·메타데이터·크기 초과에서 수정.
7. 파일 작성 중 kill, 게시 직후 kill, 수락 후 응답 유실, 재시작, watcher 유실.
8. 같은 제출 이름 재사용·원문 변경·다중 수신자 부분 전달.
9. Principal의 제한된 읽기/승인/통신 경로.

### 측정과 채택 기준

- 최종 과제 성공과 인계 품질, Human 개입.
- 잘못된 수신자·내용 누락·미완성 전송·중복 효과·stale 승인.
- '파일 쓰기/요청 수락/우편함 전달/상대의 행동' 혼동.
- 전체 token·schema/규약 token·읽은 불필요 본문·왕복·벽시계 시간.
- 오류 뒤 모델이 수행한 복구 행동과 새로운 operation을 잘못 만든 횟수.
- 자동화 명령 한 개에 감춘 논리 단계를 포함한 프로토콜 실수.

작은 pilot으로 오류를 찾은 뒤 미사용 과제와 반복 실험으로 확인한다. 원본 byte·actor·revision·receipt 보존과 권한 경계는 hard gate다. runtime/플랫폼 검증과 모델 행동 개선은 별도 증거다. C가 같은 안전성을 유지하면서 B보다 안정적이거나 비용이 낮을 때에만 파일 발송을 기본으로 바꾼다. 단순 tool-name 절감은 채택 이유가 아니다.

## 10. 이 설계가 모델에게 요구하는 짧은 규칙

1. 기록은 `/oma`에서 찾고 필요한 부분만 읽는다.
2. 짧은 말은 send에 쓰고, 이미 만든 문서는 send에 파일 경로를 준다.
3. draft 저장은 발송이 아니며 send가 발송 의사다.
4. 불변 메시지 경로를 reply에 사용한다. 상태는 수령증/index에서 본다.
5. 수락·우편함 전달·상대의 작업은 다르다. 불확실한 전송을 새 요청으로 반복하지 않는다. 복구는 OMA가 맡는다.
6. 공식 변경·판단·제어는 각 행동 도구로 한다. 파일 내용이나 '읽음'이 권한이 되지 않는다.

**요약: 탐색은 조합 가능한 파일 도구로, 의사 확정은 작은 typed 행동으로, 결과는 짧은 반환값과 다시 읽을 수 있는 파일로 제공한다.**
