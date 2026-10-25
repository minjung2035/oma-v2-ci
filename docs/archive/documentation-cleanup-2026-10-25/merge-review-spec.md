# 메일 기반 merge·review·challenge 구현 명세

작성 기준: 2026-10-02 사용자 대화와 작업 트리의 구현. **구현용 설계안**이며 기존 규범의 활성 정책이나 검증 판정을 변경하지 않는다. 이 문서는 다음 구현의 목표 동작과 수용 조건을 소유한다. 구현 채택 시 §12의 규범·contract 전환 절차를 따른다. 최상위 기준은 [PRIORITY-0](PRIORITY-0.md)이다.

## 1. 확정 요구와 설계 기본값

### 확정된 merge 요구

Worker는 `oma_merge` 하나로 등급 선택, 합병 요청, diff 조회, 리뷰, 투표, 승인 현황 조회를 수행한다. Principal도 같은 이름의 도구를 사용하지만 diff 조회와 승인/거절만 허용한다. 승인 여부는 인증된 도구 호출로 기록하고 실제 main 변경을 제어한다. 일반 메일 본문에 “승인”이라고 쓰는 것은 투표가 아니다.

| 등급 | 필요한 다른 Worker 승인 | Principal | 진행 중 리뷰 메일 |
|---|---:|---|---|
| LOW | 0 | 사전 승인 없음 | 리뷰 요청 없음 |
| MEDIUM | 1 | 요청을 받지 않고 Worker용 리뷰 메일을 볼 수 없음 | Worker 전체 |
| HIGH | 2 | 두 Worker의 승인 후 새로 전송된 메일을 보고 승인/거절 | 처음에는 Worker 전체, 조건 충족 후 Principal에게 별도 전송 |

모든 등급에서 요청자가 **merge 사유**를 작성한다. 요청 메일에는 사유와 도구 사용 안내를 넣고 diff는 넣지 않는다. 리뷰는 같은 요청 밑에 추가하며 갱신된 요청은 새로 도착한 메일처럼 처리한다. HIGH의 Principal 승인 요청에는 merge 사유와 승인한 두 Worker의 리뷰를 넣는다. Principal은 도구로 diff를 읽는다.

실제 merge 후에는 Principal과 Worker 전체에 자동 완료 메일을 보낸다. 완료 메일에는 요청자의 원래 사유, 다른 Worker의 리뷰, 실제 적용된 diff를 포함한다. LOW에도 사유와 diff가 들어가며 리뷰는 없다.

### 이 명세에서 선택한 권장 기본값

다음은 앞선 대화의 제안이나 구현을 위해 추가로 정한 값이다. 확정된 요구와 구분해 검토할 수 있게 표시한다.

| 항목 | 권장 기본값 |
|---|---|
| Challenge 도구 | 별도 `oma_challenge`. Worker가 제기·리뷰·투표하고 Principal은 HIGH의 diff 조회·투표만 수행 |
| Challenge 등급 | LOW는 다른 Worker 2명, HIGH는 다른 Worker 2명 후 Principal 승인 |
| 원래 HIGH merge의 challenge | 최소 HIGH. Principal 승인 변경을 Worker 표만으로 되돌리지 않음 |
| Challenge 대상 | 실제 merge가 확인된 요청. 승인만 되었고 아직 적용되지 않은 요청은 취소 대상 |
| 요청 취소 | 작성자가 실제 적용 전 자신의 요청을 취소. 적용 후에는 challenge |
| Worker 반대표 | 같은 후보의 적용을 막음. 해당 Worker가 새 승인표를 기록하거나 후보를 수정해야 함 |
| Principal 거절 | 그 요청을 종료. 수정한 후보로 새 요청 필요 |
| 변경된 후보 | 기존 요청을 취소하고 새 요청. 리뷰와 승인을 이월하지 않음 |
| 등급 결정 | 새 정책의 기본값은 Worker가 명시한 등급. 기존 protected path·필수 검사·권한 제한은 별도로 유지 |

Challenge를 별도 도구로 채택하면 Principal 최소 도구 목록에도 `oma_challenge`가 하나 추가된다. 이 추가는 HIGH challenge의 승인용이며 제기나 현황 조회 권한을 주지 않는다. Challenge 도구 분리와 이 기본값들은 구현 전 검토 대상이다.

## 2. 역할별 모델 도구

### Principal

| 도구 | 허용 범위 |
|---|---|
| `read`, `grep`, `find`, `ls` | 프로젝트 전체 읽기. 리뷰 유무에 관계없이 항상 제공 |
| `oma_agent_lifecycle` | 기존 Worker 강제 정지·해제 범위 |
| `oma_society` | 기존 society 실행 열기·닫기 범위 |
| `oma_mail_read`, `oma_mail_send` | 자신의 읽기 가능한 메일과 일반 발송 |
| `oma_merge` | `diff`, `vote` |
| `oma_challenge` | 권장안 채택 시 `diff`, `vote` |

프로젝트 write/edit, shell 실행, 직접 Git 변경 권한은 제공하지 않는다. 별도 `oma_git`, `oma_review_decide`, `oma_attestation_revoke`, `oma_challenge_finding`, `oma_challenge_scope`는 새 모델 표면에서 제거한다. `oma_review_decide`의 승인/거절 기능은 `oma_merge.vote`로 이동한다.

`oma_merge`는 같은 도구 이름을 쓰되 Principal의 schema에는 `diff|vote`만 들어간다. 유효한 승인 요청이 없을 때도 프로젝트 읽기 도구는 유지한다. 투표는 Principal에게 실제 전송된 유효한 HIGH 요청이 있어야 접수한다. 동적 도구 그룹, raw RPC, CLI 경유 호출에서도 동일하게 제한한다. 도구를 숨기는 것만으로 권한 제어를 대신하지 않는다.

Principal의 요청별 `diff`는 자신에게 전송된 HIGH 승인 대상 또는 전체 완료 공지로 공개된 적용 결과만 조회한다. 아직 Worker에게만 있는 요청 이름을 추측해 미공개 요청 metadata나 revert 후보를 읽지 못한다. 이 제한은 프로젝트의 일반 파일 읽기와 별개다.

### Worker

기존 코드 읽기·쓰기·실행, 일반 협업·메일 도구는 유지한다. merge와 challenge의 새 표면은 다음과 같다.

| 도구 | action |
|---|---|
| `oma_merge` | `open`, `diff`, `review`, `vote`, `status`, `cancel` |
| `oma_challenge` | 권장안 채택 시 `open`, `diff`, `review`, `vote`, `status`, `cancel` |

별도 `oma_tiered`, `oma_merge_status`는 만들지 않는다. 새 정책의 모델 경로에서 일반 `git integrate`, 구형 approve/object/revoke CLI로 새 승인을 우회하지 못하게 한다. Git 작업공간 도구로 후보를 만드는 것과 canonical main을 갱신하는 권한은 구분한다.

## 3. 요청과 승인 대상

### 식별과 고정

요청에는 시스템이 부여한 안정적인 이름(`merge-…`, `challenge-…`)과 immutable ID가 있다. 메일과 도구 결과는 모두 이 이름으로 동일 요청을 지목한다. 사람이 적은 제목은 식별자가 아니며 중복 제목으로 대상을 선택하지 않는다.

merge 요청 접수 시 다음을 고정한다.

```text
request identity: id, name, kind, requester, title, reason, requestedTier
candidate identity: repo, targetRef=main, expectedBase, candidate, policyRevision
evidence: authenticated submit provenance, candidate/diff locator and digest
delivery identity: threadId, mailRevision, messageId, recipient snapshot
```

작업공간의 변경 사항은 먼저 commit된 후보여야 한다. `open`은 기존 trusted submit 경로를 내부에서 사용해 후보를 게시하고 고정한다. 별도 submit 메일을 작성하게 하지 않는다. dirty/uncommitted 내용, 이동 가능한 branch 이름, 모델이 제공한 Git Author 문자열을 승인 대상으로 쓰지 않는다.

`base`를 생략하면 작업공간에 기록된 명시적인 기준 commit을 사용한다. 현재 main으로 기준을 조용히 교체하지 않는다. 기준을 관측할 수 없으면 명시적으로 거절한다. 접수 시 main과 기준이 다르면 최신 main을 확인하고 새 후보를 만들도록 안내한다.

reason은 문제와 수정 이유를 설명하는 필수 Markdown 문자열이다. LOW에서도 공백만 있는 reason은 거절한다. 시스템은 reason의 비어 있지 않음과 크기만 검증하고 의미의 타당성을 대신 판정하지 않는다.

### 어떤 변경에 새 승인이 필요한가

base, candidate, tier, policyRevision, challenge의 revert 후보가 바뀌면 새 요청을 만든다. 기존 reason을 고쳐 다른 승인을 유도하는 것도 기존 요청을 덮어쓰는 방식으로 하지 않는다. 종료 전 기존 요청의 취소를 먼저 확정하고 새 요청에 이전 요청 이름을 참조할 수 있다.

리뷰·투표가 추가되는 메일 갱신은 후보 변경이 아니다. 같은 후보에 세 번째 리뷰가 붙었다고 앞선 두 표를 없애지 않는다. 요청 이름만 바꾸거나 같은 retry를 여러 번 보내는 것으로 승인·거절 기록을 초기화하지 않는다. 동일 kind/base/candidate/tier/policy의 중복 진행 요청은 기존 요청으로 연결한다.

모든 수정 호출은 기존 request-key/idempotency 경로를 따른다. 같은 key와 같은 입력은 같은 결과를 조회하고, 같은 key의 다른 입력은 거절한다. 연결 종료나 timeout 뒤 새 key로 효과를 무조건 다시 만들지 않는다.

## 4. 도구 입력과 결과

다음 표는 모델 API의 목표 schema다. wire method 이름이나 DB DDL을 이미 구현했다고 뜻하지 않는다. actor·role·repo·targetRef는 실행 context에서 결정하며 모델이 지정하지 않는다. Principal schema에는 허용하지 않은 action과 입력 필드가 존재하지 않는다.

### `oma_merge`

| action | 입력 | 결과와 효과 |
|---|---|---|
| `open` | `tier: LOW|MEDIUM|HIGH`, `title`, `reason`, 선택 `candidate`, `base`, `request` | Worker 전용. 후보 기본값은 고정 시점의 작업공간 HEAD. 요청과 메일 계획을 접수. LOW는 바로 적용 조건 검사, 나머지는 리뷰 대기 |
| `diff` | `name`, 선택 `path`, `cursor` | 정확한 base→candidate diff. 조회한 identity·digest·다음 cursor 반환. 상태 변경 없음 |
| `review` | `name`, `body`, 선택 `request` | Worker 전용. 같은 요청 아래 리뷰 추가·Worker 전체에 갱신 전달. 승인 수를 늘리지 않음 |
| `vote` | `name`, `verdict: approve|reject`, `body`, Principal 전용 필수 `approval`, 선택 `request` | 인증된 표와 리뷰/판단 근거를 append. 조건 충족 시 적용 진행. Principal은 전송된 HIGH만 가능 |
| `status` | 선택 `name` | Worker 전용. 지정 요청의 승인·반대·Principal 상태·부족 조건 또는 읽기 가능한 요청 목록과 canonical main 관측 |
| `cancel` | `name`, `reason`, 선택 `request` | 작성자인 Worker 전용. 아직 적용되지 않은 자기 요청 취소 |

`vote.body`는 필수다. 별도 `review`를 먼저 호출하지 않아도 이 본문이 그 표에 연결된 리뷰가 된다. HIGH를 Principal에게 보낼 때 이 두 승인표의 리뷰를 사용한다. 별도 `review`로 새 의견만 남기는 것은 기존 표의 변경이 아니다. 표의 판단 근거를 바꾸려면 새 `vote`를 기록한다.

Principal은 `review`를 호출하지 않지만 `vote.body`로 승인/거절 근거를 남긴다. 이 판단은 Worker용 원래 요청에도 반영한다.

Worker의 merge `review/vote`는 MEDIUM/HIGH 요청에만 허용한다. LOW는 사전 리뷰 없이 적용하며 문제 제기는 적용 후 challenge를 사용한다. `diff/status`는 읽기 가능한 LOW에도 사용할 수 있다.

Principal의 `approval`은 받은 승인 요청 메일에 명시된 승인 요청 ID다. 고정 candidate와 전달된 두 review fact에 연결하며 최신 유효 승인 요청인지 broker가 검사한다. 요청 이름만 받아 현재 승인을 임의 선택하지 않는다. 따라서 오래된 메일을 보고 누른 승인이 나중에 도착한 다른 검토 묶음의 승인으로 변환되지 않는다.

### `oma_challenge` — 권장안

공통 `diff/review/vote/status/cancel`의 입력·재시도·리뷰 갱신 규칙은 `oma_merge`와 같다. 단, `diff`는 **현재 main을 기준으로 준비한 revert 후보 diff**를 반환한다. 원래 merge의 diff도 별도 항목으로 조회할 수 있게 `view: revert|original`을 제공한다.

`open` 입력은 `merge`(대상 merge 요청 이름), `tier: LOW|HIGH`, `title`, `reason`, 선택 `candidate`, `base`, `request`다. Worker 전용이며 merge 도구의 challenge action은 만들지 않는다. 대상 이름은 실제 integration receipt로 해석해 고정한다. 이유만 접수하고 나중에 승인과 다른 diff를 적용하지 않는다.

### 공통 결과

변경 호출은 요청 이름, 고정 후보 identity, durable 접수 여부, 기록한 vote/review ID, 메일 revision, 현재 부족 조건, integration operation/receipt locator를 반환한다. “메일 전달됨”, “승인 접수됨”, “main에 적용됨”을 구분한다.

`status`는 관측 결과이며 승인 권한을 만들지 않는다. 승인 현황에는 서로 다른 승인자의 이름, 필요한 수, 반대자, Principal 요청 발송 여부, Principal 결정, main 관측 commit과 시점을 포함한다. 관측 실패를 승인 0명이나 main 부재로 표시하지 않는다.

제한된 호출, stale base/policy, terminal 요청, 자기 승인, quota 부족, 관측 unknown은 구분해 반환한다. 실제 error code는 기존 closed error contract에 명시적으로 추가하거나 기존 의미에 대응시키고 문자열 catch 분기로 판정하지 않는다.

## 5. 리뷰·투표와 실제 적용

### Peer 자격

표는 인증된 logical Worker identity로 센다. 같은 Worker의 두 호출, 재시작, 다른 process incarnation은 두 명이 아니다. 요청자와 해당 후보의 인증된 submit author는 자기 변경의 승인 수에 포함되지 않는다. Git Author/이메일을 자격 증거로 쓰지 않는다.

현재 reviewer 자격을 잃으면 현재 quorum 계산에서 제외될 수 있지만 과거에 제출한 리뷰·표 자체를 삭제하거나 실패로 다시 해석하지 않는다. 최신 표는 durable 접수 순서로 결정한다. 새 `approve`가 같은 actor의 `reject`를 대체할 때도 두 기록 모두 보존한다. 반대표는 actor 퇴장 때문에 자동 소멸하지 않는다.

Worker의 `review`는 의견이고 `vote`는 제어다. 최신 유효 Worker 표가 reject면 그 정확한 후보의 적용을 막는다. Principal은 peer 반대를 삭제할 수 없다. Principal reject 이후 과거 approve를 되살려 적용하지 않는다.

### 등급별 실행

1. LOW: reason과 후보를 접수하고 공통 검사 후 main CAS를 진행한다. 기다리는 peer 리뷰 요청이나 Principal 승인 요청을 만들지 않는다.
2. MEDIUM: Worker 요청 메일을 보내고 다른 Worker 1명의 approve를 기다린다. 유효한 반대표가 없고 공통 조건을 통과하면 자동으로 적용한다.
3. HIGH: Worker 요청 메일을 보내고 다른 Worker 2명의 approve를 기다린다. 이 조건과 zero reject를 확인한 후 Principal에게 새 승인 요청을 발송한다. Principal approve와 나머지 조건을 충족하면 자동으로 적용한다.

승인 조건이 충족된 뒤 요청자가 다시 `merge` action이나 일반 `oma_mail_send`를 호출하게 하지 않는다. 기존 broker/Git owner가 접수된 intent를 실행한다. 기다리는 동안 transaction, Git lock, check process를 점유하지 않으며 reviewer 배정·자동 생성·정기 Principal polling을 추가하지 않는다. reviewer 부족 시 부족 수를 안내하고 요청을 보존한다.

### 공통 적용 조건과 권한

모든 등급은 published candidate, exact base/candidate, ancestry, protected path, trusted check, 현재 효과 권한, society/stop fence, serialized Git CAS를 통과한다. HIGH 승인이 hard deny나 검사 실패를 해제하지 않는다. CAS 직전 같은 판정 owner로 승인과 권한을 다시 검사한다.

새 기본 정책에서는 Worker의 merge intent에 후보 제출·정책 조건부 통합 권한을 위임하고 HIGH 판단은 Principal에 위임한다. 이는 host의 versioned policy로 선언한다. 기존 저장된 capability나 위임을 도구 등록만으로 넓히지 않는다. Principal vote가 요청자의 직접 Git 실행 권한으로 변환되지도 않는다.

요청자가 일반 turn을 마쳤다는 이유로 접수된 요청을 취소하지 않는다. 후속 효과는 broker의 접수된 intent와 현재 host 위임으로 실행하며, 종료된 actor의 RunLease를 위조해 재사용하지 않는다. society close나 명시적 stop fence가 새 효과를 금지하면 CAS를 진행하지 않는다. 이미 발생한 CAS와 메일의 정산은 계속 보존한다.

main이 바뀌면 `stale base`를 반환하고 새 후보를 요구한다. 자동 rebase, 기존 승인 재사용, “비슷한 diff” 판정은 하지 않는다. policy 변경도 과거 접수의 revision을 다시 쓰지 않는다. 기존 accepted 효과의 정산과 새 정책 아래의 재접수는 별개다.

## 6. 메일의 내용·공개 범위·갱신

### 전송 표

| 사건 | Worker 전체 | Principal | 본문 diff |
|---|---|---|---|
| LOW 접수 | 리뷰 요청 없음 | 없음 | 해당 없음 |
| MEDIUM/HIGH merge 요청 | 새 요청 메일 | 없음 | 없음 |
| Worker review/vote | 같은 요청의 갱신 메일 | 원칙적으로 없음 | 없음 |
| HIGH에서 두 peer 승인 충족 | 같은 요청의 승인 요청 발송 표시 | **그 시점에 새 승인 요청 전송** | 없음 |
| Principal vote | 같은 요청의 갱신 | 자신의 판단 결과 | 없음 |
| 대기 요청 cancel·stale | 같은 요청의 갱신 | 이미 HIGH 요청을 받은 경우 무효화 갱신 전송 | 없음 |
| 모든 merge 완료 | 새 완료 공지 | 새 완료 공지 | **실제 적용 diff** |
| Challenge 개시 | 원래 merge와 별개의 새 challenge 메일 | HIGH quorum 전에는 없음 | 없음 |
| Challenge review/vote | 같은 challenge 메일의 갱신 | HIGH quorum 후에는 승인 요청 규칙 적용 | 없음 |
| 승인된 revert 완료 | 새 전체 완료 공지 | 새 전체 완료 공지 | **실제 revert diff** |

“Worker 전체”는 발송 시점의 수신 가능한 logical Worker 집합이다. 요청자도 포함하고, 개별 stopped Worker의 메일도 보존한다. 완료 공지는 명시적으로 Principal 수신자를 추가한다. 기존 Worker 전용 commons 주소만 사용해 전체 공지라고 표시하지 않는다. 수신자 집합은 발송 intent에 고정하며 retry마다 다시 계산하지 않는다. 새로 생긴 Worker는 권한에 맞는 archive를 읽을 수 있다.

### 요청 메일 형식

Worker용 요청의 본문은 다음 정보를 가진다.

```text
요청 이름 / 제목 / 등급 / 요청자
문제와 merge 사유 — 요청자가 작성한 원문
고정 base와 candidate / 현재 판단 현황
도구 안내: oma_merge diff(name), review(name, body), vote(name, verdict, body)
리뷰와 투표 — 작성자별 원문, 결정, 순서
```

Principal용 HIGH 요청은 요청 이름·제목·등급·요청자, merge 사유, **승인한 두 Worker의 리뷰 원문과 이름**, `diff/vote` 안내를 가진다. 이 두 리뷰는 승인표에 연결된 고정 본문이다. quorum을 처음 만든 유효 승인표를 접수 순서로 선택하고 어떤 fact ID를 전달했는지 기록한다. Principal 수신 시점을 Worker 최초 요청 시점으로 설정하지 않는다.

이 메일에는 `approval` ID도 포함한다. 진행 메일은 기존 일반 mail kind, Principal 승인 요청은 `approval_required`, 완료 공지는 `result` 의미를 사용한다. kind·제목·본문은 승인 증거가 아니며 새 thread/approval metadata는 version된 closed contract로 검증한다.

Principal용 challenge 요청도 같은 형식이며 merge 사유 대신 challenge 사유와 대상 merge 이름을 넣는다. 실제로 적용할 revert diff는 도구로 읽는다.

### 같은 요청 아래 리뷰 추가, 갱신은 새 도착

한 요청은 하나의 logical thread다. `review/vote`가 접수되면 그 thread의 본문에 새 항목을 append한 새 `mailRevision`을 만든다. 기존 EML bytes를 덮어쓰지 않는다. 각 revision은 별도 immutable Message-ID와 durable delivery를 가진다. Mail 목록은 같은 thread를 접어 보여 주고 마지막 갱신 도착 순서로 올린다.

새 revision을 이전 revision의 읽음/ACK로 확인 처리하지 않는다. 이전 읽음 뒤 새 갱신은 새 전달 대상으로 남는다. 과거 revision은 감사와 명시적인 history 조회로 읽을 수 있다. 단순 파일 mtime 수정, 기존 delivery 재사용, Worker용 메일의 수신자 변경으로 이 동작을 흉내내지 않는다.

HIGH의 peer quorum 형성과 Principal 승인 요청 생성 intent는 한 owner가 durable하게 결합한다. Principal session이 꺼져 있으면 새 메일을 먼저 접수하고 기존 전달 경로로 나중에 전달한다. 모델을 임의로 새로 실행하거나 Human turn을 끊지 않는다.

세 번째 peer 리뷰만으로 Principal 승인 요청을 반복 발송하지 않는다. 이미 Principal에게 전송한 두 표 중 하나의 결정·근거가 새 표로 대체되거나 해당 reviewer가 quorum 자격을 잃거나 새 유효 반대표가 생기면 최신 무효화 갱신을 실제로 보낸다. 다른 두 표 또는 갱신된 두 표로 zero reject를 포함한 조건을 충족하면 새 `approval` ID로 유효 승인 요청을 전송한다. 이전 Principal 표는 과거 fact로 보존하며 새 승인 요청의 approve로 계산하지 않는다. 새로운 두 리뷰 묶음에는 새로운 Principal 판단이 필요하다.

### 읽기 범위

Principal에게 보내지 않은 Worker용 리뷰 revision은 Principal의 `oma_mail_read`, 목록, archive 경로, 일반 파일 읽기/검색을 통해 노출하지 않는다. 역할별 메일 view·mount·archive resolver에서 같은 audience 규칙을 적용한다. Principal이 모든 Worker archive를 mount한 상태에서 inbox만 빼는 방식은 부적합하다.

이 제한은 **Worker용 진행 메일**의 audience 계약이다. Principal의 프로젝트 전체 읽기 기능을 리뷰 존재 여부에 따라 껐다 켜지 않는다. 프로젝트 코드, 이미 공개된 완료 공지, Worker가 일반 메일로 별도 전달한 내용은 각각 기존 읽기 계약을 따른다. 완료 시 원래 Worker용 요청 revision을 Principal에게 공개하는 것이 아니라 공개 가능한 새 완료 공지를 만든다. Human 운영 화면의 조회 권한은 Principal 모델 권한과 구분한다.

### 완료 공지

완료 공지는 요청 이름, 실제 operation/receipt, 이전/새 main, tier, 원래 reason, 다른 Worker의 리뷰·표 원문, Principal 판단(있는 경우), **이전 main→실제 새 main의 diff**를 포함한다. LOW는 리뷰 없음으로 표시한다. 단순 candidate 위치나 diff 도구 링크로 본문 diff를 대체하지 않는다.

diff가 단일 메일 한도를 넘으면 같은 완료 공지 ID에 속한 순서 있는 부분 메일로 자동 분할한다. 모든 부분을 Principal과 Worker에게 보내고 part 번호·총수·전체 digest를 명시한다. 메일 읽기로 전체 diff를 복원할 수 있어야 하며 생략·조용한 잘라내기를 하지 않는다. binary 변경은 binary patch와 경로·모드 변화를 포함한 고정 diff 형식으로 표현한다. 총 artifact 용량과 분할 계획을 CAS 전에 검증·예약한다.

자동 메일은 Worker가 별도로 `oma_mail_send`를 호출하는 방식으로 구현하지 않는다. 일반 mail.send는 자동 리뷰/투표 mail의 인증 metadata를 위조할 수 없다. 메일의 tool 안내나 인용된 내용 자체에 제어 권한을 주지 않는다.

## 7. 취소와 challenge에 의한 revert

### 아직 적용되지 않은 요청 취소 — 권장안

작성자는 `cancel`로 자기 pending 요청을 취소할 수 있다. 이미 거절·취소된 요청에는 기존 terminal fact를 반환하며 다른 terminal로 덮어쓰지 않는다. 새 표와 효과 접수를 막고 취소 사실을 thread에 append한다. HIGH 승인을 Principal에게 이미 보냈다면 새 취소 갱신을 Principal에게도 보낸다. 기존 mail/review/vote/receipt를 삭제하지 않는다.

취소와 실제 CAS는 같은 canonical effect owner가 직렬화한다. 취소가 먼저 확정되면 CAS를 하지 않는다. CAS가 먼저 일어나면 “취소 완료”라고 하지 않고 실제 적용 사실과 challenge 경로를 반환한다. CAS 여부가 unknown이면 판정을 보류하고 관측·정산한다. Principal reject는 요청 거절이며 Worker 실행 종료나 society close가 아니다.

### 이미 적용된 merge에 대한 challenge — 권장안

Challenge는 대상 merge 요청 이름과 challenge 사유를 지정해 제기한다. 시스템은 이름을 **성공한 실제 merge receipt**로 해석하고 고정한다. 원래 merge thread에는 참조를 추가할 수 있지만 challenge 본문·리뷰·투표의 owner는 별개의 challenge thread다.

리뷰 대상은 신고 문장만이 아니라 실제 revert 후보다. 후보가 제공되면 기존 trusted submit 경로로 게시한다. 생략했을 때에는 명시적으로 요청된 `open`의 일부로 trusted Git helper가 현재 main에서 역변경 후보를 준비할 수 있다. 준비 전 artifact ownership을 등록하고 hooks·filters·외부 diff 등 임의 실행을 차단한다. 준비는 canonical main을 바꾸지 않는다.

충돌이나 이미 달라진 내용 때문에 후보를 만들 수 없으면 문제와 부분 artifact의 disposition을 반환한다. 승인 가능한 요청은 만들지 않고 Worker가 수정한 commit으로 다시 개시하게 한다. 승인 후 시스템이 임의로 충돌을 해결하거나 미리 보여 주지 않은 코드를 추가하지 않는다.

원래 merge가 여러 commit을 포함했다면 receipt의 원래 base→applied candidate 전체 변경이 대상이다. 특정 마지막 commit 하나만 되돌리고 요청 전체를 취소했다고 표시하지 않는다. 역변경 준비 중 현재 main의 관련 변경과 충돌하면 자동 덮어쓰지 않는다.

| Challenge 등급 | 적용 조건 |
|---|---|
| LOW | 작성자/후보 author가 아닌 Worker 2명 approve, zero reject, 공통 검사 |
| HIGH | 같은 peer 조건 후 Principal에게 새 메일 전송, Principal approve, 공통 검사 |

원래 HIGH merge의 challenge는 HIGH보다 낮출 수 없다. 원래 LOW/MEDIUM merge에는 LOW 또는 HIGH를 선택한다. Challenge 접수만으로 원래 merge의 사실성, 결함의 확정, 미래 모든 후보의 floor를 바꾸지 않는다. 새 기본 정책에서는 별도의 finding/scope/re-entry floor 판정 도구를 두지 않는다.

승인된 challenge는 **그 고정 revert 후보**의 적용 권한이다. `oma_merge`를 다시 열어 같은 변경에 이중 승인을 요구하지 않는다. 기존 Git effect boundary의 검사·권한·CAS·receipt·완료 공지를 재사용한다. revert는 main 위의 새 commit이며 reset, force-push, 기존 성공 receipt 삭제를 하지 않는다.

동일 merge에 대한 여러 challenge는 각각 검토할 수 있지만 같은 역변경 효과는 중복 실행하지 않는다. 이미 정산된 성공 revert를 발견하면 그 효과를 반환한다. 다른 변경 뒤 추가 되돌리기가 필요하면 새 main과 새 후보를 검토한다. unknown 상태에서 다른 key로 두 번째 revert를 실행하지 않는다.

## 8. Worker가 canonical main을 보는 방법

Worker의 작업공간은 독립 clone이다. 다른 Worker의 merge가 자기 worktree를 자동 checkout/reset/rebase하지 않는다. Worker는 읽기 가능한 canonical origin을 조회한다.

```sh
git fetch origin main
git log --oneline FETCH_HEAD
git diff HEAD FETCH_HEAD
```

현재 sandbox의 canonical repository 경로 `/git/project.git`는 read-only로 유지한다. `oma_merge.status`도 canonical main의 관측 commit·시점을 반환하지만 작업공간 HEAD와 같은 것으로 표시하지 않는다. main 조회 실패는 unknown이다.

모델은 완료 메일에서 실제 main 변경과 diff를 읽고 필요하면 fetch한다. 다음 후보를 최신 main 위에서 준비하는 것은 Worker의 코드 작업이다. fetch만으로 이미 접수된 요청의 base/candidate를 교체하지 않는다.

Principal은 프로젝트 전체 읽기와 요청의 `diff`로 판단한다. `oma_git` 제거 후에도 backend의 안전한 Git 조회 helper는 `oma_merge.diff` 내부에서 재사용할 수 있다. Principal에게 shell을 되돌려 주는 방식으로 기존 조회 기능을 보완하지 않는다.

## 9. 상태 표현과 Priority 0

요청 본문, 리뷰, 표, 취소, Git effect, 전달 fact는 각자의 durable 의미를 가진다. 화면 상태는 이 사실에서 파생한다. 표시를 편하게 만들려고 과거 사실을 덮어쓰는 중앙 업무 state machine을 추가하지 않는다.

| 표시 상태 | 뜻 |
|---|---|
| peer 부족 | 요청은 접수됐고 필요한 유효 표가 아직 없음 |
| Principal 대기 | HIGH의 peer 조건 충족 및 새 승인 요청이 접수됨. Principal 승인은 아직 없음 |
| 적용 대기 | 승인 조건은 충족됐으나 검사·권한·효과·공지 정산이 남음 |
| stale/blocked | base/policy 변경, 반대, 검사 실패, 현재 권한 등 명시된 적용 장애 |
| 거절/취소 | 해당 terminal fact가 확정됐고 적용되지 않은 요청 |
| 적용 완료 | 실제 CAS 및 고정 완료 공지 정산이 확인됨 |
| unknown | 효과나 정산 관측이 끝나지 않음. 실패·미실행으로 대체하지 않음 |

실제 main 적용과 완료 메일 전달의 관측은 분리한다. CAS 뒤 공지 생성/접수가 아직 완료되지 않으면 main 변경 사실을 보여 주고 공지 정산 대기라고 표시한다. 수신 모델이 읽고 이해했다는 사실까지 성공 receipt의 뜻에 포함시키지 않는다.

### Durable 경계

1. 요청·candidate/diff·메일 artifact를 만드는 즉시 accept 전 owner에 등록한다. accept unknown이면 보존한다.
2. 리뷰/표와 해당 mail revision·전달 intent는 원자적으로 접수하거나 한 owner의 재실행 가능한 고정 plan으로 결합한다. 표만 살아남고 필수 메일을 영구히 잃지 않는다.
3. quorum과 Principal 발송 intent를 고정한다. 두 번째 승인 직후 crash해도 Principal 요청을 보충한다. 중복 vote retry로 두 번째 표를 합성하지 않는다.
4. Git CAS 전 완료 메일의 ID·내용·수신자·diff artifact를 예약한다. 성공 전에는 완료 공지를 공개하지 않는다.
5. CAS 뒤 crash하면 실제 ref/기존 effect evidence를 대조하고 같은 operation/message ID로 공지를 보충한다. 메일을 만들기 위해 CAS를 다시 하지 않는다.
6. receipt·메일 원문·delivery attempt는 각 owner가 정산한다. read/ACK/추론 완료는 승인과 서로 다른 사실이다.

현재 authority와 과거 승인/접수 fact는 분리한다. stop/restart, Principal session 교체, 설정 변경으로 기존 성공을 실패나 미실행으로 만들지 않는다. 아직 효과를 내지 않은 요청은 효과 직전 현재 권한을 확인한다. 한 판정은 한 owner에서만 수행하고 extension/UI/CLI가 별도 quorum 계산을 만들지 않는다.

## 10. 구현 경계와 제거 범위

새 코드는 기존 owner에 연결한다. 별도 reviewer scheduler, task DAG, approval daemon, 복제된 Git executor, 메일을 원본 DB로 파싱하는 제어 계층을 추가하지 않는다. 최소 요청 metadata와 immutable review/vote 관계는 필요하며 실제 durable 선언·migration으로 표현한다.

| 책임 | 우선 활용할 현재 경로 | 구현 결과 |
|---|---|---|
| 후보 게시·main CAS·효과 정산 | `src/git/submit.ts`, `src/git/integration.ts`, `src/review/authority.ts` | 합병과 revert가 같은 physical boundary 사용 |
| 리뷰/표 판정 | `packages/domain/src/review-evaluation.ts`, `src/review.ts` | 현재 mail review의 단일 판정 owner. DR46에서 이전 attestation decoder 제거 |
| 자동 메일·artifact·수신자 | `src/mail.ts`, `src/mail/routing.ts`, `src/mail/materializer.ts` | audience별 immutable revision, 고정 완료 공지 |
| 새 도착·읽음·thread view | `src/mail/batches.ts`, `src/extension/delivery.ts`, `src/runtime/principal-delivery.ts`, `packages/tui/src/sources/mail.ts` | 갱신마다 새 delivery, 같은 logical thread로 표시 |
| 모델 schema·역할 제한 | `src/extension/principal-tools.ts`, `src/extension/mail-tools.ts`, `src/pi-extension.ts`, `packages/protocol/src/methods.ts`, `packages/tool-runtime/src/workspace-guard.ts` | 역할별 action과 raw 호출의 동일 제한 |
| diff 조회·프로젝트 읽기 | `src/cli/effects/code.ts`, `packages/tool-runtime/src/contained-tools.ts` | 정확한 후보 diff, Principal 전체 프로젝트 읽기 유지 |
| durable/wire 선언·설정 | `packages/contracts/src/`, 기존 schema·generation owner | 새 version의 closed 계약, atomic 활성화 |

제거 범위는 **새 live 모델 경로의** 구형 Principal git/decision/revoke/finding/scope 도구, 중복 승인 우회, finding/scope 기반 새 live floor 평가다. 더 이상 쓰지 않는 wrapper·정책 분기는 제거한다. DR46은 이전 빌드의 fact decoder를 제거한다. 현재 빌드에서 수락한 receipt·pending/unknown 작업의 정산 경로와 exact bytes는 유지한다. legacy 호환을 명목으로 모델에 구형 제어 경로를 함께 노출하지 않는다.

Worker/Principal 시스템 프롬프트와 도구 설명도 같은 contract에서 맞춘다. Worker는 필요한 이유를 작성하고 메일을 보고 diff/review/vote를 수행한다. Principal은 전달된 HIGH를 판단하며 peer 리뷰를 배정하거나 모든 요청을 polling하지 않는다. LOW/MEDIUM 완료 공지는 자동으로 받는다. 프롬프트 지시문만으로 금지 action이나 메일 audience를 제어하지 않는다.

## 11. 수용 조건

아래는 **실행할 시험의 목표**이며 시험 통과 기록이 아니다. 정식 acceptance 번호는 [test-matrix](verification-spec.md#oma-core-v1--검증-계약)가 소유한다. 구현 시 그곳에 새 번호로 등록하며 기존 ID의 뜻을 바꾸지 않는다.

| 시나리오 | 관측해야 할 결과 |
|---|---|
| LOW 성공 / reason 누락 | 성공에는 사유·diff 전체 공지, 누락은 접수 거절. 리뷰 요청 없음 |
| MEDIUM 정상 | 타 Worker 1명 approve 후 실제 main 변경. Principal에는 요청/리뷰가 없고 완료 공지만 도착 |
| HIGH 0·1·2명 | 2명 전 Principal 발송 없음. 2명 후 새 Message-ID·새 도착 순서로 승인 요청 전송 |
| HIGH Principal approve/reject | approve는 공통 조건 충족 시 적용. reject는 main을 그대로 두고 실제 요청 종료 |
| Principal 받은 본문 | 사유·두 approving review 원문·도구 안내. inline diff 없음 |
| 리뷰 후 갱신 | 같은 logical thread 아래 추가되고 최신 도착으로 이동. 이전 ACK가 새 revision을 확인하지 않음 |
| 두 번째 vote 중복 retry | 한 표·한 발송 intent. 같은 Worker를 두 명으로 세지 않음 |
| 자기 승인·인증 위조 | 요청자/submit author 제외. 일반 메일·Git Author·역할 위조로 승인 불가 |
| 반대·quorum 상실 | 적용 차단. 이미 요청 받은 Principal에게 실제 무효화 갱신. 오래된 승인으로 우회 불가 |
| Quorum 복구·오래된 Principal 응답 | 새 approval ID로 재전송. 이전 메일의 approval ID나 이전 approve는 새 리뷰 묶음에 적용되지 않음 |
| 후보/base/policy 변경 | 과거 리뷰/표는 보존되지만 새 diff의 승인이 되지 않음 |
| Principal 도구 표면 | 항상 read/grep/find/ls. merge는 diff/vote만, raw/group 경유 금지 action과 미공개 요청 조회도 거절 |
| Worker 전용 메일 접근 | Principal의 inbox뿐 아니라 mail ID·archive 경로·일반 파일 검색에서도 미노출 |
| 완료 공지 | LOW/MEDIUM/HIGH 모두 Principal+Worker에 사유·리뷰·실제 diff. 큰 diff도 메일만으로 전체 복원 |
| 요청 취소와 CAS 경합 | 취소가 이기면 효과 없음. CAS가 이기면 성공 사실 보존 및 challenge 안내. unknown은 보류 |
| Challenge LOW/HIGH | 별도 thread. LOW는 다른 Worker 2명, HIGH는 그 뒤 새 Principal 요청·승인 |
| HIGH merge에 LOW challenge | 거절/상향 안내. Principal 승인 우회 불가 |
| Revert diff와 충돌 | 표가 준비된 후보에만 묶임. 충돌은 새 후보 요청, 자동 코드 덮어쓰기 없음 |
| Revert 성공·중복 | 새 commit·전체 공지, 원래 성공 fact 유지. 같은 효과를 두 번 적용하지 않음 |
| Worker main 조회 | fetch/status는 canonical commit을 보여 주고 다른 worktree를 자동 변경하지 않음 |
| 닫힘·정지·session 종료 | 새 효과의 현재 fence 준수. 접수 fact/메일·이미 발생한 효과의 정산 보존 |
| Legacy 재시작·정책 전환 | 과거 승인/receipt의 뜻 유지, 새 tool/메일 version으로 재해석하지 않음 |

§9의 요청 접수, vote/review 접수, Principal 발송 intent, immutable EML 게시, delivery 접수, Git CAS, 완료 공지, receipt 게시, 설정 generation 경계에 kill·retry·restart를 주입한다. 특히 **두 번째 peer vote→Principal 전송**, **CAS→완료 공지**, **cancel→CAS**를 실제 durable 경계에서 검증한다. fixture·domain 시험과 실제 Git/메일/엔진 전달 시험의 증명 범위를 구분하고 실행할 수 없는 환경은 NOT_RUN으로 기록한다.

## 12. 기존 규정과의 차이·전환 순서

### 차이가 나는 규정

| 현재 문서/경로 | 이 설계의 변경 |
|---|---|
| [architecture](architecture.md) §§12.5–12.6, [integration-policy](implementation/integration-policy.md)의 TIER-001~003·008 | 새 정책은 명시한 tier를 기본 등급으로 사용. finding/scope/re-entry floor 파이프라인 제거. protected path·공통 검사는 유지 |
| integration-policy TIER-009, 현재 Principal tool registry | 기존 approve/object/revoke 및 여러 전용 도구에서 merge/challenge action API로 이동 |
| integration-policy PUB-001 | LOW/MEDIUM도 완료 공지를 Principal에 자동 전송. 본문 사유·리뷰·실제 diff 필수 |
| integration-policy CHAL-002~006 | 신고→finding→scope→미래 floor 대신 고정 revert 후보의 peer/Principal 승인 흐름 |
| architecture §12.6, integration-policy CHAL-003 | 권장안은 명시적 challenge 개시에서 revert 후보 준비를 허용. 실제 적용은 승인 후 같은 Git boundary, history rewind 없음 |
| 현재 mail archive/read 구현, integration-policy SEM-002 | 역할별 진행 메일 audience와 HIGH quorum 뒤 실제 신규 발송. 메일 kind만으로 승인하지 않음 |
| 현재 HANDOFF A의 기존 정책 구현 지시 | 새 흐름 채택 시 A의 목표를 이 설계와 활성화된 규범으로 갱신 |

이 차이는 사용자 요청에 따라 설계안에 먼저 기록했다. 기존 규정과의 차이를 이유로 spec 작성을 중단하지 않았다. [architecture](architecture.md)는 N-001 결박을 보존한다. 이 초안 자체가 과거 TIER/CHAL/PUB 조항의 의미나 accepted fact를 바꾸지 않는다.

### 구현 순서

1. **규범과 version**: 이 설계를 새 live 정책의 규범 owner에 반영하고 새 requirement ID를 부여한다. 기존 규범은 legacy version의 의미로 보존한다. spec→traceability→design revision→결박을 갱신하며 architecture와의 차이는 DR에 기록한다. 권장 기본값을 채택하는 범위도 이때 명시한다.
2. **Closed contract와 최소 persistence**: 요청·후보·review/vote·thread revision·audience·발송 intent의 owner와 version, migration·reader를 정한다. 기존 operation/mail/attestation owner를 우선 확장한다. 별도 범용 event store·scheduler를 만들지 않는다.
3. **자동 merge와 challenge 효과**: exact 후보 판정, peer/Principal 제어, cancel 경합, trusted revert 준비를 기존 submit/check/CAS/receipt 경계에 연결한다.
4. **자동 메일과 갱신 전달**: Worker thread, 새 HIGH Principal 전송, audience enforcement, 모든 등급의 완전한 완료 공지를 구현한다.
5. **모델 표면과 프롬프트**: 역할별 schema와 raw 실행 제한을 연결하고 구형 도구·새 live finding/scope 경로를 제거한다. 프로젝트 읽기와 Worker 코드 작업 도구를 유지한다.
6. **검증과 전환**: §11과 crash 경계를 실행하고 [validation](implementation/validation.md)에 결과를 기록한다. 새 정책은 전체 설정 검증 후 generation commit으로 활성화한다. 새 원문·wire·설정이 reader와 일치하기 전에 부분 활성화하지 않는다.

전환 중 이미 accepted된 구형 작업은 당시 frozen policy와 decoder로 정산한다. 구형 pending 메일을 새 승인 요청으로 자동 변환하거나 기존 vote를 새 요청에 옮기지 않는다. 새로 review를 시작해야 하는 미적용 변경은 명시적인 새 요청으로 접수한다. 새 정책이 완성되기 전에 도구 이름만 바꾸고 기존 분산 workflow를 뒤에 그대로 숨겨 완료로 표시하지 않는다.
