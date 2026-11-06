# Runtime — 수락·효과·복구와 실행 경계

[총괄 spec](../model-collaboration-surface-spec.md)의 내부 실행 계약이다. 기계적 절차는 이 문서의 owner가 수행하며 모델에게 새로운 retry/status/publish 도구를 요구하지 않는다.

## MCS-X01 — owner와 versioned 경계

| 책임 | owner | 금지되는 중복 구현 |
|---|---|---|
| tool shape·설명·result rendering | extension/tool-runtime | broker authority/quorum 재계산 |
| model call ↔ frozen invocation 연결 | 기존 host request/session adapter | content hash만의 intent 추론, 두 번째 engine session |
| source snapshot·bundle staging | 기존 client runtime + owned-file/Git primitives | replay 때 mutable HEAD 재해석 |
| mail acceptance/recipient snapshot | mail/broker owner | client-side delivery queue |
| candidate object/ref publication | Git owner와 broker adapter | 일반 mail writer의 raw git subprocess |
| review fact·정족수·integration gate | review/domain owner | tool 설명/프롬프트로만 제약 |
| exact expected-old CAS | canonical Git owner | recovery에서 임의 rebase/force-push |
| provisioning·execution·death proof | lifecycle/execution owner | mail/read/wait에서 숨은 start/stop |
| 파일 표현 | 기존 view/materializer owner | projection을 새 정본으로 사용 |
| 모델 추론·provider retry·compaction | Pi engine | OMA provider/agent loop fork |

새 surface는 `collaboration-v1`로 session에 결박한다. 새 broker payload는 기존 method와 구분되는 명시적 contract discriminator를 사용한다. 제안 문법은 `contract:"collaboration-v1"`이며 old payload에는 이 필드가 없다. dispatcher는 두 closed decoder 중 하나만 선택한다. 기존 input hash·plan bytes를 새 decoder의 defaults로 바꾸지 않는다. 실제 method별 descriptor와 plan decoder 확장은 해당 owner에 한 번만 정의한다.

후속 사용자 결정 [MCS-S13](../model-collaboration-surface-spec.md#mcs-s13--최종-코드의-레거시-제거와-저장-사실의-명시적-비호환)/DR72에 따라, 위의 두 live decoder와 X09의 old-surface 유지는 최종 코드에 남기는 계약이 아니다. 최종 release는 구형 입력/세션을 실행하지 않고 사전 drain 또는 원본 불변의 명시적 비호환으로 처리한다. 이 변경은 원래 accepted bytes·hash·receipt를 새 defaults로 변환하는 허가가 아니다.

지원 surface/role 검사는 확장의 `session_start`만으로 늦지 않게 한다. SDK session 생성은 그 hook보다 먼저 기존
journal에 metadata를 append할 수 있으므로 launch owner가 SDK/history open·child spawn·settings write 전에
같은 current-contract owner의 검사를 수행한다. 확장-only hook은 reload/tool/provider 방어이며, 원본 불변
비호환 이행을 보장하는 launch admission의 대체물이 아니다. 원래 journal의 unresolved call을 보정하지 않는다.

Society birth와 tool plan은 별도의 관계다. 명시된 current plan만으로 old/missing birth를 새 opt-in으로 승격하지 않는다.
원래 birth owner의 execution admission을 CLI bootstrap·standalone broker·Worker 조립에서 공유하며, tenure/lock 생성,
Store open·restore·execution recovery·provision·SDK/history 쓰기 전에 거절한다. malformed/unreadable birth를 absent로
바꾸지 않는다. 구형 birth의 진단/history 관측과 Personal은 유지한다. 새 Society는 collaboration-v1으로 태어나며 구형 birth를 승격하지 않는다(DR74).

[DR35](../design-revisions.md#dr35--the-private-conversation-starts-alongside-society-preparation)의 private 대화 준비와 Principal 권한 부여는 계속 분리한다. current birth·lease·설정·private 경로 admission 뒤 private engine은 broker 준비와 함께 열 수 있다. 허용된 record container를 만드는 것은 projection 갱신·빈 ledger 관측·Society activation 준비 완료가 아니다. 정본 records 갱신과 같은 engine/current broker generation의 registration을 마친 뒤에만 credential/delivery를 연다. 이 분리는 old plan/runtime fallback을 허용하지 않는다.

Custom mail 전달은 SDK의 public `sendMessage(..., { triggerTurn: true })`를 유지한다. [DR73](../design-revisions.md#dr73--custom-message-전달의-공개-prompt-계약을-위해-공식-sdk-120을-고정한다)의 SDK run preparation이 최초 system state와 role policy를 준비하며, 새 도구 공개는 기존 persisted-result/turn 경계 뒤 provider 요청에 반영한다. delivery boundary의 protocol revision은 SDK package version과 별개인 저장 evidence 형식이다. dependency 갱신만으로 과거 boundary/receipt bytes를 바꾸거나 pending 전달을 완료로 해석하지 않는다.

필요한 새 의미는 다음으로 제한한다.

- mail.send: frozen body + attachment manifests + publication dependencies를 하나의 accepted intent로 표현.
- agent.create: frozen child spec/from/brief + 필요 source publication dependency.
- review 입력: exact target tuple와 operation 종류, 기존 fact 의미.
- invocation 연결과 surface/session exposure version.

임의 operation 리스트를 입력받는 composite method 또는 범용 workflow DSL은 없다. 내부 wire에 모델의 로컬 path만 보내 서버가 임의 읽게 하지 않는다. client는 안전하게 고정한 bytes/tuple을 보내고 broker는 정본 관계를 검증한다.

## MCS-X02 — invocation의 수명

### 저장 정보

기존 request cache와 host session adapter를 확장하여 최소 다음을 보존한다.

- society birth, authenticated actor, session/branch lineage, original engine tool-call identity.
- surface version, tool name, non-coerced original arguments, normalized intent digest.
- host invocation identity, original broker request key, effect/child identity derivation version.
- source bytes/digests, resolved OIDs, frozen descriptors, staging ownership.
- transport send 여부에 대한 known/unknown 관측, 원래 receipt, 마지막 확인 sequence.

권한 credential을 그대로 영속 저장하여 다음 run에 재사용하지 않는다. lookup과 새 effect의 인증/authority는 현재 연산 계약대로 각각 수행한다. invocation file은 Worker가 일반 write로 수정할 수 없는 host-owned 경계에 있다. 사용자의 workspace 파일과 섞지 않는다.

### 순서

1. closed input shape와 role 가능성을 검사한다. 효과 없는 오류는 즉시 반환한다.
2. original tool-call binding을 host-owned record에 영속화한다. 같은 호출을 resume하면 이 binding을 재사용한다.
3. 소스를 안전하게 읽고 bytes/OID/descriptor를 freeze한다. 부분 freeze는 completion marker 없이 전송하지 않는다. 생성 즉시 stage owner를 등록한다.
4. send intent marker를 영속화한 뒤 요청을 전송한다. crash로 실제 전송 여부가 불명이어도 원래 key만 조회한다.
5. broker가 명시적으로 원래 요청의 absence를 답하고 원래 frozen input이 온전하며 현재 fresh authority가 허용될 때만 같은 key로 resend한다. no reply·timeout·cache miss를 absence로 쓰지 않는다.
6. accepted면 broker가 효과를 소유한다. tool result의 저장 실패가 그 fact를 취소하지 않는다.
7. model continuation 전에 pending binding을 관측/복구하고 확인된 결과 또는 정확한 unknown을 session에 연결한다. 원래 결과와 다른 새 성공을 만들어 tool-call hole을 채우지 않는다.

### 상태별 허용 동작

| 관측 | 허용 | 금지 |
|---|---|---|
| shape 오류·전송 전 source failure | 고친 입력의 새 호출 | 가짜 broker receipt |
| incomplete local freeze, 전송 안 함이 증명됨 | 원래 invocation의 준비 재개 또는 명시적 preaccept 거절 | 부분 bytes 전송 |
| 전송 가능성 있음, acceptance unknown | 원래 key 조회·보존 | 새 key/다른 payload로 자동 탈출 |
| accepted pending | 원래 broker recovery | client가 별도 executor로 단계 실행 |
| accepted succeeded | 원래 결과 재관측 | transport replay를 새 effect 성공으로 표시 |
| terminal failed, 일부 효과 있음 | effect별 사실을 보존하고 해당 owner가 합법적 후속을 판단 | 전부 미실행이라고 간주 |
| corrupt/unavailable frozen evidence | lookup 가능한 원래 receipt 관측, operator repair | 현재 HEAD/파일로 원본 재구성 |

### 반복 호출·병렬 호출

같은 인자가 같은 의도를 뜻한다고 일반화하지 않는다. 성공 후 같은 문장을 다시 보내는 새 의도는 가능하다. 반대로 새 tool-call ID가 무조건 새 실행 허가도 아니다.

- actor별 OMA effect admission은 원래 tool batch의 순서로 직렬화한다. local read/grep 및 독립적인 다른 actor의 작업을 전역 직렬화하지 않는다.
- 동일한 원래 tool-call binding은 replay다. 별도 호출이어도 같은 exact proposal/name의 기존 fact를 명시한 경우 domain의 existing/conflict 규칙을 따른다.
- 직전 미결 invocation과 동일한 raw intent를 반복 제출한 경우 새 실행하지 않고 원래 기록과 `No new execution`을 반환한다. 이 transient ambiguity 검사는 전송 중인 원래 호출이 끝날 때까지만 유지하며 영구 content deduplication으로 쓰지 않는다.
- mail acceptance unknown은 그 actor의 새 send admission을, create acceptance unknown은 그 actor의 새 spawn admission을 막는다. canonical integration unknown은 해당 canonical 경계의 기존 fence를 유지한다.
- 이미 acceptance가 확정된 mail의 materialization pending만으로 다른 유용한 메시지를 막지 않는다. 서로 다른 새 의도는 원래 owner의 권한 안에서 가능하다.
- 자연어를 바꾸거나 다른 이름을 선택한 요청의 심리적 의도를 완벽히 판별한다고 주장하지 않는다. mechanical guarantee는 원래 invocation 연결, exact-object duplication, 불확실한 acceptance의 fence다. prompt와 평가에서는 deliberate duplicate를 추가로 관찰한다.
- unknown fence가 오래 지속되면 operator 경로를 제공한다. 모델은 read·local coding·다른 허용 행동을 계속할 수 있다. 새 key로 풀지 않는다.

## MCS-X03 — send + commit attachment

### Preaccept

1. caller identity, mail.send, audience, reply relation과 input bounds를 검사한다.
2. source file/text를 고정한다. commit은 full OID/object format으로 고정한다. arbitrary path filter로 publication tree를 축소하지 않는다.
3. 이미 trusted published/canonical인 commit은 그 exact ref/OID를 재사용하고 필요한 retention을 확보한다. 단순 전달이 새 submitter provenance가 되지 않는다.
4. 새 local candidate는 git.submit 권한으로 bundle/object closure를 검증·stage한다. preaccept object quarantine은 다른 Worker에게 공개하지 않는다.
5. operation ID와 child publication identities, body/attachment manifest, mail ID·Date·routing input을 원래 freeze에 결박한다. 여러 bundle이 필요하면 같은 bounded ingress의 순서 있는 manifest로 전송하고 각각 digest를 확인한다. 모델은 chunk/stream을 관리하지 않는다.

### Acceptance T

현재 authority·sender incarnation·reply/audience·staging integrity·publication 권한을 재검증한다. 주소를 확장해 수신자 snapshot을 고정한다. **하나의 동기 root transaction**에서 versioned mail plan과 delivery rows 및 publication dependency 관계를 기록한다. 물리 Git/file/network를 transaction 안에서 실행하지 않는다. 빈 topic recipient 집합의 처리도 기존 routing owner의 계약을 유지하고 결과에 실제 recipient 수를 표시한다.

메일 plan에는 각 첨부에 대해 기존 published ref 또는 새 publication의 exact OID/immutable ref/owner/staged bundle digest가 들어간다. owner 이동은 T를 기준으로 명시한다. T 이후 sender engine의 종료가 이 plan을 버리게 하지 않는다.

**수락된 publication의 authority:** collaboration-v1의 mail/create acceptance는 정확히 검증한 OID·immutable ref·source provenance의 publication을 broker에 위임하는 versioned intent다. 후속 게시에는 현재 broker tenure/writer ownership, accepted plan 관계, quarantine/object integrity가 필요하며 원래 Worker process의 생존은 필요하지 않다. 원래 actor의 stop이나 이후 capability 변경이 그 수락 사실을 소급 취소하지 않는다. 이 위임은 새 canonical merge, 다른 OID, 새 recipient, 추가 child 생성을 허가하지 않는다. standalone legacy candidate publication의 authority 규칙은 바꾸지 않는다. 새 plan의 이 좁은 위임은 기존 구현에 이미 있다고 가정할 수 없으며 별도 DR·wire/plan version·effect-owner 검증의 필수 항목이다. 모델 입력으로 broker/host authority witness를 만들거나 `auth:null`을 제출하게 하지 않는다.

### T 이후

1. Git owner가 수락된 첨부의 immutable ref를 게시한다. absent→exact OID 또는 이미 같은 OID만 성공이다. 다른 OID는 conflict/corruption이며 덮어쓰지 않는다.
2. 모든 첨부 접근성이 확인되면 frozen mail을 archive/mailbox로 materialize한다. 별도의 첨부별 commons 알림을 만들지 않는다. body에는 경로를 몰래 삽입하지 않고 attachment manifest는 metadata에 둔다.
3. recipient별 materialized 사실을 기록하고 기존 batch delivery/verified receipt 경로로 넘긴다.
4. stage 회수는 accepted owner와 실제 보존 요구가 결정한다. 게시된 Git 객체를 mail 실패의 보상으로 삭제하지 않는다.

### 실패·중단

| 중단 지점 | 복구 |
|---|---|
| freeze 완료 전 | 전송 증거와 completion marker 확인; partial source를 발송하지 않음 |
| T 전 stage 후 | nonacceptance가 확정되면 cleanup; unknown이면 보존 |
| T 직후 | accepted plan에서 Git publication부터 재개 |
| 첨부 일부 ref 게시 후 | 게시된 ref 확인, 남은 것만 기존 identity로 진행 |
| 모든 첨부 게시 후 mail file 전 | 같은 frozen mail bytes로 materialize |
| 일부 수신자 materialize 후 | 기존 message ID의 나머지 delivery만 진행 |
| 결과 반환/저장 전 | 원래 receipt를 session에 reconnect |

`accepted; attachments pending`은 유효한 결과다. 일부 publication이 실패했다고 mail acceptance를 없애지 않는다. corruption은 fresh admission을 fence하고 operator repair를 요구한다. terminal 실패가 있더라도 이미 공개된 OID/전달된 recipient를 보존한다. sender의 stop/capability 변화가 accepted mail의 의미를 바꾸지 않으며, 실제 recovery effect의 허용은 기존 연산별 authority 규칙을 유지한다.

일반 text-only send는 빈 publication dependency의 동일 mail 경로다. @self는 기존 continuation 방법/권한으로 연결하며 일반 recipient expansion과 attach 기능을 섞지 않는다.

## MCS-X04 — spawn + source publication

Fresh child spec과 creation observation은 구형/default surface selector를 갖지 않는다. 원래 child-policy owner가 위임 교집합과 host-only grant를 계산한 뒤 current Worker capability 지원 여부를 같은 함수로 검증한다. 이 검사는 새 preparation의 admission이며 accepted creation의 frozen spec·hash·payload·receipt를 현재 설정으로 재검증하거나 보정하는 이행이 아니다.

spawn은 synchronous subagent 호출이 아니다. accepted create plan과 이후 activation이다.

1. name grammar, agent.create, current parent/lineage/child policy를 검증한다. resolved child spec·profile/capabilities·from·brief를 동결한다.
2. from이 canonical에서 접근 불가능하면 git.submit을 추가 검사하고 X03과 같은 quarantine/publication dependency를 준비한다.
3. fresh create는 현재 capacity를 검사하여 full이면 T 전 거절한다. name collision/동일 original intent replay는 현재 lifecycle owner가 판정한다.
4. T에서 child spec과 source publication dependency 및 초기 brief intent를 같은 create plan에 결박한다. client 후속 호출이 생존해야만 create가 완성되는 설계는 금지한다.
5. publication→workspace/provisioning→capacity 재검사→enabled promotion→기존 execution 요청을 수행한다. stage/물리작업은 T 밖이다.
6. accepted creation이 activation race에서 밀리면 pending/provisioning으로 유지한다. 논리 공간이 있어도 기존 stopped/retired scope의 death가 unknown이면 unsafe reuse를 허용하지 않는다.
7. 초기 brief는 정확히 기존 create plan의 message identity로 전달한다. bootstrap/create retry가 다른 brief로 바뀌거나 두 번 전달되는 새 message를 만들지 않는다.

receipt는 accepted/provisioned/enabled와 실제 execution observation을 구분한다. `from`이 parent commit이라는 이유로 child가 자동 author/reviewer 자격을 얻거나 잃지 않는다. submitter provenance와 author exclusion은 Git/review owner가 facts로 판단한다.

## MCS-X05 — merge/challenge 재제출의 상태표

exact ProposalRef 검증은 candidate 준비 전에 수행하고 T에서도 재검증한다. old target이면 최신 상태로 자동 바꾸지 않는다.

| 입력/현재 상태 | 결과 |
|---|---|
| proposal 없음 + valid candidate | 새 request; 기존 duplicate-source 검사를 수행 |
| proposal 있음 + 다른 requester/kind | 거절 |
| proposal 있음 + revision/attempt expectation stale | 거절; 현재 status 경로만 안내 |
| 동일 source + active review, integration 없음, preparation failure 없음 | existing; 새 fact/attempt 없음 |
| 동일 source + pending/unknown integration | existing original/unknown; 새 attempt 없음 |
| 동일 source + settledFailure가 결박한 exact confirmed failed attempt 또는 preparation failure | 기존 retry preconditions 충족 시 새 attempt fact |
| 다른 source + nonterminal, integration 없음 또는 confirmed failed | 새 revision, 새 attempt number; 코드에 결박되지 않은 기존 승인 효력 제거 |
| 다른 source + pending/unknown integration | 거절; 원래 attempt를 먼저 settle |
| applied/included/cancelled/Principal rejected/stale-terminal | 거절; terminal을 reopen하지 않음 |
| retry인데 policy/provenance가 달라짐 | 거절; fresh review/명시적 새 제안 필요 |

policy 변경을 처리하기 위해 모델에게 `adopt` action을 다시 주지 않는다. legacy adoption은 host migration이고 current policy/provenance 변경으로 같은 코드를 새 정책 아래 검토해야 하면, 합법적으로 취소 가능한 old request를 철회하고 새 explicit proposal을 낸다. 이는 unknown을 피하기 위한 중복 제출과 다르며 old terminal/state를 확인해야 한다. 새로운 automatic adoption fact를 암묵적으로 만들지 않는다.

후속 MCS-S13/DR72의 최종 제거 계약에서 위의 legacy host-adoption 이행 가정은 live compatibility를 남기는 허가가 아니다. fresh `review.adopt`와 old/adopted scope의 current 승격·direct legacy integration 생성은 거절한다. 원래 payload/fact/hash/plan/receipt의 read-only 해석과 pending/unknown 관측은 보존하되 실행·재전송을 허가하지 않는다. 원래 release/owner의 사전 drain 또는 원본 불변의 명시적 비호환이 필요하며, old request에 current policy를 덮어쓰거나 unknown을 terminal로 바꾸지 않는다.

새 current completion notice는 owned complete-diff 준비 primitive를 요구하며 direct diff fallback으로 계속하지 않는다. full/compact 안내는 선언된 `record_root` 안의 해당 request `status.md`와 그 역할에 허용된 exact material 경로를 사용한다. Principal에 Worker patch 접근을 약속하지 않으며, recovery가 원래 accepted message/plan bytes를 새 문구로 재생성하지 않는다. 이 생성 계약의 제거는 과거 accepted plan의 실행 qualification이나 전체 drain 완료를 뜻하지 않는다.

원래 accepted reviewed integration의 `merge.version` 1/2는 read-only historical data다. current scope/policy/qualified vote가 맞거나 canonical main이 candidate와 같아도 이 release의 execution/reconcile은 canonical effect observation·notice publication·terminal settlement 전에 `UNSUPPORTED_PROFILE`로 거절한다. 원래 payload/plan/hash/key와 pending/unknown을 유지하며 original release/owner가 진단·drain해야 한다. original terminal receipt의 same-key 관측은 현재 policy를 읽어 새 의미로 바꾸지 않는다. 이는 모든 historical envelope/accepted-plan family의 qualification 완료를 뜻하지 않는다.

**Revision:** `max(previous tier, current repository floor, deterministic change tier)`를 기존 owner에서 계산한다. 과거 vote는 삭제하지 않으며 새 scope로 이월하지 않는다. expectedRevision·source/current scope·authors·policy·current authority를 T에서 확인한다.

**Retry:** 원래 exact failed attempt와 same candidate/base/policy/provenance를 확인한다. failed receipt는 유지하고 별도 attempt lineage를 추가한다. 같은 bytes를 보냈다는 이유로 과거 failed receipt를 succeeded로 바꾸지 않는다.

**Challenge:** exact applied target은 immutable이다. 새 proposal의 replacement 생략에만 broker-prepared revert가 허용된다. existing proposal에서 생략은 기존 frozen correction 유지다. 충돌을 자동 해결하지 않고 original delta와 correction을 별도 자료로 제공한다. HIGH→LOW escape는 금지다.

**Submission publication의 확정 순서:** merge와 caller-supplied challenge/revision은 현재와 같이 candidate publication을 먼저 완료하고 그다음 review intent를 수락한다. send/spawn과 달리 이 둘을 새 하나의 accepted transaction으로 묶지 않는다. host invocation은 시작할 때 publication child key와 이후 review input의 source OIDs·reason·tier·target을 함께 freeze한다. publication은 기존 accepted publication owner가 복구한다. 그다음 아직 수락되지 않은 review 단계는 현재 caller authority가 유효할 때만 원래 frozen key/input으로 제출한다. Worker 실행이 끝나 그 권한이 없으면 `publication succeeded; review not accepted; continuation requires an authorized activation`을 보존하고 합법적인 다음 activation에서 연결한다. published OID를 삭제하거나 현재 HEAD로 후속 input을 교체하지 않는다. broker-prepared challenge revert는 기존처럼 준비된 object와 accepted challenge fact의 publication 경로를 쓴다. 이 비대칭은 원래 authority 소유권을 보존하기 위한 것이며 host가 임의의 새 review executor가 되어서는 안 된다.

## MCS-X06 — vote·철회·Git CAS

1. review target의 source/integration scope와 actor의 expected own vote를 정본에서 검증한다. Principal은 exact current broker-issued approval identity와 delegation을 확인한다.
2. independent vote의 author exclusion, qualification, scope/state를 기존 review owner에서 검사한다. LOW merge의 advance vote 허용 여부도 기존 정책을 따른다.
3. acceptance 직전에 같은 의미 필드를 다시 확인한다. 긴 file/bundle 준비 중 변경된 scope를 freeze 당시 상태로 강제 덮어쓰지 않는다.
4. 새 vote는 append-only fact다. 같은 actor/scope의 latest vote 의미, revoke/invalidation, Principal reject finality를 기존 evaluator로 계산한다.
5. withdrawal은 own submission 또는 own vote의 exact fact만 대상으로 한다. 타인의 fact는 host-only invalidation과 혼동하지 않는다. 이전 승인 자동 부활은 없다.
6. pending integration의 cancel/withdraw는 canonical main을 T 직전 관측하고 기존 synchronous pre-CAS gate에 accepted control을 전달한다. pending DB 표기만 믿지 않는다.

| 실제 canonical 관측 | cancel/withdraw 처리 |
|---|---|
| 적용 전 expected base, 기존 gate가 control을 먼저 수락 | 그 action의 기존 허용 state에 따라 수락; 이후 CAS 차단 |
| exact candidate로 이미 CAS됨 | already applied; 취소 성공 아님 |
| 제3의 ref/관측 실패 | unknown/stale 원인에 따른 거절·복구; absent로 추측하지 않음 |
| accepted control 후 notice materialization 실패 | control fact는 유지, notice만 기존 owner가 복구 |

현재 control 준비의 비대칭도 유지한다. 자기 vote withdrawal은 nonterminal request에서 integration이 없거나 pending인 경우에만 준비하고, pending은 T 직전 관측/pre-CAS gate를 추가로 통과해야 한다. failed/unknown/succeeded integration이나 terminal request는 vote withdrawal을 허용하지 않는다. proposal cancellation은 requester-only이며 confirmed failed integration을 포함한 기존 cancel 허용 상태를 따르되, unknown/applied에서는 성공하지 않는다. Principal의 새 표면은 이 자기 vote 경로만 노출하고 Worker proposal cancel 경로를 열지 않는다.

source review와 prepared integration-context review를 합치지 않는다. main 이동 뒤 별도 integration scope가 생기면 그 exact diff/target을 발행하고 기존 정책대로 필요한 review를 받는다. 모델에게 전체 tuple 계산을 맡기지 않는다.

## MCS-X07 — delivery·ACK·wait

새 send는 mail과 delivery의 기존 owner를 사용한다. pending 선택의 `materialized=1`, `presented=0`, `batch_id IS NULL` 의미를 유지한다. ACK 조건을 새로 넣지 않는다.

- mail body/read/grep/reply/normal turn end/wait 중 어느 것도 `mail.ack` fact를 새로 만들지 않는다.
- 과거 succeeded `mail.ack`와 acknowledged delivery의 invariant는 유지한다. diagnostic을 삭제해 과거 의미를 잃지 않는다.
- presentation은 broker-prepared batch를 custom OMA message로 전달한다. Human 메시지로 위장하지 않는다.
- normal terminal stop의 검증된 session boundary receipt와 wait 결과를 구분한다. wait가 정상 batch completion을 생성하지 않는다.
- wait intent는 현재 live run과 정확한 교부 batch/이전 held IDs에만 적용한다. 아직 교부하지 않은 mail과 다음 activation을 삼키지 않는다.
- wait와 send가 같은 tool batch에 있으면 제출된 호출의 결과를 모두 persist한 뒤 yield한다. accepted mail/spawn/review effect는 run 종료로 abort하지 않는다.
- late batch preparation/old incarnation 응답은 새 run에 붙이지 않는다. unknown wait observation은 completed로 처리하지 않는다.

urgent 축약은 새로운 ordinary/critical 입력으로만 적용한다. 기존 kind가 있는 역사 mail의 batch class를 재해석하지 않는다. direct/public fairness와 starvation regression을 검사한다.

## MCS-X08 — lifecycle·Human 제어·capacity

활성 수는 `resident && desired=enabled`다. idle/wait 포함, Principal/provisioning/stopped/retired 제외라는 DR66 의미를 유지한다. stopped/retired의 logical entitlement 해제와 physical scope death proof는 별개다.

새 모델에는 개별 control 도구가 없지만 내부 start/stop 방법, original stop ownership, accepted control recovery를 제거하지 않는다. Human 제품 경로는 다음 기능을 기존 authenticated host owner로 제공해야 한다.

- actor와 현재 desired/incarnation, 미결 control receipt, 실제 종료 관측 확인.
- 개별 emergency stop과 올바른 주체의 stop 해제.
- Society 전체 gate, capacity 설정의 기존 restart 정책.
- legacy Principal-owned stop을 보존하고 안전하게 해제할 수 있는 명시적 운영 경로.

UI의 클릭/성공 문구만으로 physical termination을 주장하지 않는다. Human release가 새로운 actor/session의 이름만 보고 unrelated stop을 풀지 않는다. 이 제품 경로가 없으면 모델 control 삭제를 cutover하지 않는다.

capacity full일 때 자동 peer stop/eviction 또는 wait에 숨어 있는 release는 없다. 모델의 장기적인 팀 재구성에 대한 제약은 총괄 S10의 제품 승인 대상이다. 기존 authorSlots/capacity fallback을 새 process 동시성 상한으로 바꾸지 않는다.

## MCS-X09 — GOAL·특수 context

goal publication은 full-context expected OID CAS, 다른 context bytes 보존, goal notification의 기존 의미를 유지한다. 새 `Content` file 경로를 추가해도 Principal read boundary를 넘지 않는다. accepted GOAL 뒤 notice delivery 실패는 goal fact를 취소하지 않는다.

Worker의 일반 문서는 send/committed repository docs다. 기존 특수 context capability에 의존하는 custom profile은 자동 호환되지 않는다. host 운영 publication으로 이관하거나 old-surface session을 유지한다. user-provided context body의 GOAL 헤더·서명이 Principal 권한을 만들지 않는다.

## MCS-X10 — 누적 tool group

새 surface plan은 role별 `direct`, finite group members, provenance와 surface version을 가진다. unknown/중복/다른 역할 이름을 공개하지 않는다. 그룹 요청의 입력은 `{}`뿐이며 raw tool arguments를 받지 않는다.

```text
initial active = direct
request(group) -> pending additions
safe persisted-result boundary:
  next active = current active UNION permitted(group members)
  persist session exposure event
  publish the corresponding definitions and snippets together
```

두 그룹을 같은 batch에서 요청하면 union한다. 이후 web activation이 LSP를 제거하지 않는다. repeat는 no-op/이미 활성화 결과다. 진입 도구는 남는다. provider 요청 직전에 실제 callable registry와 보낸 정의를 대조한다. 실패 시 조용히 도구를 누락하고 계속하지 않는다.

- session resume: 마지막 확정 exposure를 복원한다. pending request와 committed event를 구분한다.
  복원 값은 허용된 complete group들의 union이어야 한다. 개별 member 이름이 유효하더라도 일부만 남은
  event는 손상된 exposure로 거절하며, 누락 member를 조용히 보충하거나 event bytes를 다시 쓰지 않는다.
- branch/fork: 부모의 확정 loadout을 상속하되 원래 accepted invocation을 복제하지 않는다.
- extension reload: provenance/capability 변동으로 금지된 도구를 유지하지 않는다. 정상 그룹 선택에 의한 제거와 보안상 revoke는 구분한다.
- group 미지원/actual role member 없음은 unavailable라고 명시하며 다른 권한의 member를 대체 공개하지 않는다.
- OMA mail/read/grep의 내용은 exposure event를 만들지 않는다. MCP search/call은 기존 gateway에서만 한다.

## MCS-X11 — 취소·종료·관측 비용

Provider/model request 취소와 accepted broker effect 취소는 다르다. UI abort나 engine turn 종료는 현재 tool transport를 끊을 수 있지만 accepted plan을 삭제하지 않는다. 취소된 local source preparation의 artifact는 nonacceptance가 확인된 후 정리한다.

Projection 갱신은 모델 boundary를 무한히 막지 않아야 한다. 기존 observation deadline을 적용하고 실패/partial을 표시한다. 모든 old history를 매번 scan하지 않고 dirty/current records를 우선한다. 누적 backlog는 기존 recovery owner의 단위별 진행을 통해 소진한다. 특정 파일 손상 하나로 모든 index를 영구 중단하지 않는다.

내부 비용을 줄이기 위해 unknown을 success로 처리하거나 safety gate를 prompt 경고로 대체하지 않는다. 동시에 core reliable primitives가 제공하는 결과를 새 owner가 다시 판정하는 중복 상태 machine을 만들지 않는다. 구체적인 물리 kill/restart gate와 source owner는 validation 문서에서 연결한다.
