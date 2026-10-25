# Tiered integration policy — 규범 확장과 검토 결정

최초 채택: 2026-09-09. 이 문서는 기존 tiered 정책의 규범 owner다. 아래 OPEN·출시 차단 서술은 해당 조항을 채택한 당시의 경계를 나타낸다. 현재 구현·검증 판정은 [validation](validation.md)이 소유한다. 미채택 도구·메일 흐름 설계는 [보관 기록](../archive.md)에 분리했다.

현재 구현 결정은 [DR27/DR29](../design-revisions.md)의 schema·평가 snapshot·HIGH 최소 동료 수·candidate 검사 경로를 함께 적용한다. 아래 base-only/S-08/S-10 선행 차단 문구는 초기 규범의 판정이며, 사용자의 문서 충돌 override로 구현을 계속했다. 기존 accepted fact의 의미와 독립 runtime probe 차단은 유지한다. 실제 gate 완료 여부는 [validation](validation.md)이 소유한다.

**MUST [POL-001]** 이 문서는 [docs/architecture.md](../architecture.md) §§8.5–8.6,12.5–12.8과 [구현 계약](../implementation-spec.md)의 규범 확장이다. 새 목표 profile의 이름은 `tiered`다. 기존 여섯 entity/기본 IPC를 가진 substrate를 `base`라 부른다. base의 동작만 구현하고 tiered 오류 교정 요구까지 충족했다고 표시하지 않는다. Core v1이라는 구현 이름과 사용자가 말한 v2 아키텍처 세대는 DB schema version을 자동 변경하는 근거가 아니다.

**MUST [POL-002]** tiered는 Git authority boundary의 조건 검사다. task DAG, 업무 state machine, 중앙 allocator, 고정 Critic/Supervisor, reviewer scheduler, 정기 Principal polling을 추가하지 않는다. 조건 미충족은 명시적인 거절/부족 조건 안내이며, reviewer가 나타날 때까지 Git mutex·DB transaction·integration worker를 점유하는 workflow를 만들지 않는다.

## 1. 제안의 채택 범위와 기존 충돌

**MUST [POL-003]** 다음 검토 결정을 적용한다. 채택은 성능 향상을 입증했다는 뜻이 아니다.

| 제안 | 결정 | 기존 충돌 또는 한계 | 반영 위치 |
|---|---|---|---|
| LOW/MEDIUM/HIGH | tiered의 필수 integration policy로 채택 | 기존 approval OPTIONAL/default peer convention과 구분 필요 | architecture §12.5, spec INT/APP, 이 문서 §2 |
| 통합 공개·사후 challenge | 채택 | 기존 integrate에는 post-CAS result mail 계약 없음 | architecture §12.6, 이 문서 §§3–4 |
| persistent re-entry floor | 요구 채택, 식별/저장/판정권은 S-10 | 기존 여섯 tables로 저장 위치 미확정; ancestry는 의미 lineage 아님 | architecture §12.6, 이 문서 §4 |
| Principal semantic kind | 기존 message/question/result/alert/context 유지하고 approval_required/critical 추가 | kind를 authority로 쓰지 않는 기존 불변식 유지 | architecture §8.5, spec MAIL/PR, contracts.ts |
| clean-room verifier | OPTIONAL 요구 채택, S-11까지 비활성 | 현재 public archive/world/clone/history mount와 충돌 | architecture §12.7, 이 문서 §6 |
| progressive packet | 채택 | 고정 read order·전체 본문 주입·사고과정 강제는 제외 | architecture §8.6, 이 문서 §5 |
| 자동 revert·Git로 의미 lineage 추정 | 채택하지 않음 | 새 candidate/CAS 불변식 및 lineage 정확성 위반 | 이 문서 §4 |
| tier 자체가 성능 우위 보장 | 주장하지 않음 | rule miss, 비용, 대기, correlated error를 실험해야 함 | S-09 및 이 문서 §7 |

**MUST [POL-004]** “MEDIUM의 독립 reviewer”는 최소한 distinct logical Resident라는 authority 조건이다. 서로 다른 프로세스/새 cognition을 별도 표로 세지 않는다. 다른 이름·다른 모델 호출·같은 계통의 자식이라는 사실만으로 인지적 독립성이 증명됐다고 표현하지 않는다. verifier evidence도 vote가 아니다.

## 2. deterministic tier와 통합 조건

**MUST [TIER-001]** tier 순서는 LOW < MEDIUM < HIGH이고 다음 순수 max 연산으로 결정한다. 누락된 floor 또는 조회 실패를 LOW로 취급하지 않는다. 새로운 tier를 임의 추가하지 않는다.

```text
effectiveTier = max(
  deterministicRiskTier,
  repositoryPolicyFloor,
  challengeReentryFloor,
  residentRequestedTier
)
```

**MUST [TIER-002]** host의 versioned policy가 관측 가능한 입력과 rule을 정한다. broker는 exact base/candidate의 변경 파일·모드·허용된 deterministic checker 결과를 사용한다. protected path는 기존 hard deny를 유지하며 HIGH 승인이 이를 자동 해제하지 않는다. authentication/schema/concurrency 같은 분류는 host가 정한 path/checker rule로 신호화한다. runtime이 자연어로 semantic risk를 추론하거나 “rule에 걸리지 않음=안전”이라고 보장하지 않는다.

**MUST [TIER-003]** Resident의 tier 요청은 상향 hint이며 다른 floor를 낮출 수 없다. 생략은 계산식에서 LOW와 같을 뿐 LOW 판정의 근거가 아니다. required checker 실행 실패/unknown, policy snapshot 누락은 통합 거절이다. 등급을 올리는 것과 code.integrate/Principal 승인 권한을 받는 것은 별개다.

**MUST [TIER-004]** 모든 tier는 published candidate, full exact identity, 현재 base, descendant, hard-deny, trusted checks, capability, stop fencing, Git CAS를 공통으로 요구한다. tier 계산/approval snapshot은 CAS 직전에 재검사한다. pending integration의 recovery도 동일 조건을 적용하며 main==candidate이면 이미 발생한 효과부터 정산한다.

| tier | MUST 사전 authority 조건 | MUST 통합 이후 |
|---|---|---|
| LOW | deterministic common checks; peer APPROVE는 필수 아님 | fixed integration mail을 commons에 공개; challenge 가능 |
| MEDIUM | self가 아닌 eligible Resident ≥1의 exact APPROVE, zero active OBJECT, common checks | 같은 공개·challenge 계약 |
| HIGH | MEDIUM 이상의 host peer floor, zero active OBJECT, exact Principal ACCEPT, common checks | 같은 공개·challenge 계약 |

**MUST [TIER-005]** LOW에서 peer approval을 요구하지 않는다는 뜻은 명시적인 active OBJECT를 무시해도 된다는 뜻이 아니다. 활성 exact OBJECT는 LOW도 차단한다. 이 조건은 사전 mandatory reviewer 배정 없이 이미 발견된 반대 증거를 존중하는 보완이다. OBJECT를 무시하고 싶은 경우 새 candidate 또는 정당한 revoke/판정 정책이 필요하며, Principal 역할만으로 삭제하지 않는다.

**MUST [TIER-006]** HIGH의 `ACCEPT`, `REQUEST_REVISION`, `REJECT`는 인증된 exact-candidate attestation의 결정 의미다. mail body 문자열은 authority가 아니다. REQUEST_REVISION/REJECT는 승인 부재이며 Resident 작업/session을 종료하거나 부정적인 task state를 만들지 않는다. 새 candidate에는 새 review/ACCEPT가 필요하다. Principal은 Human이 위임한 authority만 사용한다. 위임이 없거나 UI가 꺼져 있으면 HIGH를 통합하지 않고 보존한다.

**MUST [TIER-007]** peer object나 disagreement 때문에 HIGH의 형식적 승인 요청 조건이 안 되었더라도 ordinary question/critical을 Principal에게 보낼 수 있다. 심각한 불확실성을 질문하려고 먼저 peer quorum을 채울 필요는 없다. Principal의 조언으로 OBJECT가 자동 revoke되지는 않는다.

**MUST [TIER-008]** authority identity는 `(repo,target_ref,expected_base,candidate,policy_revision)`다. approval validity를 바꾸는 tier rule/repository floor/re-entry floor/요청 상향 변경은 policy 평가 snapshot에 반영되어야 한다. 오래된 LOW snapshot 또는 낮은 tier 승인으로 HIGH를 통과하지 않는다. 정확한 policy revision 구성과 race 원자성은 S-08/S-10에서 확정하며 새 durable epoch table을 임의로 만들지 않는다.

**SPIKE [S-08]** 기존 승인 옵션 spike의 범위를 tiered의 필수 attestation 구현 gate로 승격한다. 기본 peer floor 1, zero OBJECT, HIGH Principal ACCEPT는 여기서 확정한다. 다만 eligible peer/author provenance·계통 신뢰 설정, append-only fact와 revoke의 정확한 DDL/closed IPC/CLI, 순서가 엇갈린 Principal 결정의 유효성, policy snapshot 저장은 검증 후 확정한다. Git Author 문자열을 인증 identity로 사용하거나 republish로 self-review 제한을 우회하지 못해야 한다.

**MUST [TIER-009]** 추가 model command를 개발자가 만들어 넣지 않는다. 기존 approve/object/revoke를 재사용할 수 있는 정확한 문법과 Principal 결정 표현은 S-08 산출물로 추가한다. Resident requested tier의 wire 위치·stable-key hash 포함 방식도 그 산출물에서 고정한다. 현재 base IPC의 git.integrate에 unknown `tier` field를 보내도 조용히 수용하지 않는다.

## 3. 통합 공개와 crash/idempotency

**MUST [PUB-001]** tiered의 성공한 integrate는 submit mail과 별도로 실제 통합 사실을 commons에 공개한다. full identity, previous/current main, effective tier와 rule 근거, broker 검증/승인 evidence locator를 포함한다. Principal에게 모든 LOW/MEDIUM 통합을 자동 전달하지 않는다. tiered integrate의 succeeded receipt는 CAS 성공과 fixed public integration mail의 materialization을 모두 확인한 뒤 반환한다.

**MUST [PUB-002]** 통합 전 durable operation plan에 fixed mail ID/body/수신자 snapshot을 예약하되, main 변경 전에는 archive/inbox에 공개하지 않는다. 실패한 CAS는 통합 완료 메일을 만들지 않는다. CAS 뒤 mail 실패는 pending이고 같은 op/message ID로 보충한다. 이미 main이 바뀌었다고 메일을 다시 만들기 위해 CAS를 재실행하지 않는다. 다음 canonical write 전에 unresolved integration을 대조하는 기존 규칙을 유지한다.

**SPIKE [S-10]** tiered의 OperationPlan/result/schema가 아직 base DDL과 동일하다고 가정하지 않는다. integration mail plan, challenge attestation, floor persistence를 함께 설계·검증한 closed contract가 나오기 전 tiered enabled config를 허용하지 않는다. 새 outbox/message table 없이 기존 operations/deliveries를 사용한다.

## 4. post-merge challenge와 durable floor

**MUST [CHAL-001]** 어떤 Resident든 실제 integration receipt의 exact identity와 evidence를 지목해 공개 challenge를 제기할 수 있어야 한다. evidence는 ordinary mail과 immutable Git reference로 표현한다. challenge 접수는 문제의 사실성·심각도·floor 적용을 자동 확정하지 않는다. submit만 되었고 통합되지 않은 candidate는 post-merge 대상으로 주장할 수 없다.

**MUST [CHAL-002]** 구조는 `authenticated report → public investigation → authorized finding → corrective/revert candidate 및 필요한 floor`다. 이 순서는 의미 구분이며 pending/reviewing/appealed 등의 runtime workflow state를 추가하는 허가가 아니다. 판정은 최소 append-only authenticated fact로 표현하는 방향만 허용하고 저장 schema는 S-10에서 확정한다.

**MUST [CHAL-003]** revert는 Resident가 현재 main을 base로 새 commit을 만들고 submit→동일 integrate boundary를 통과하는 변경이다. broker는 자동 reset/force-push/history rewind/revert conflict resolution을 하지 않는다. rollback/revert commit도 현재 expected base와 checks·policy를 만족해야 한다. 즉시 피해 대응이 필요하면 critical을 보내고 host의 기존 명시 권한을 사용한다. 숨은 emergency bypass를 추가하지 않는다.

**MUST [CHAL-004]** 유효하다고 판정된 LOW 결함의 동일/직접 후속 변경은 최소 MEDIUM, host policy상 중대한 architecture/security/data-loss 판정은 HIGH floor를 적용할 수 있어야 한다. floor는 session 종료·broker restart·revert·재게시로 사라지지 않는다. challenge를 접수한 actor 자신이 본문에 HIGH라고 적은 것만으로 authoritative floor를 만들 수 없다.

**MUST [CHAL-005]** Git commit ancestry만으로 semantic lineage를 식별하지 않는다. LOW 결함 commit을 ancestor로 가진다는 이유로 이후 모든 main commit에 floor를 전파하지 않는다. 반대로 cherry-pick/rebase/파일명 변경/변형한 patch/새 branch나 새 request ID만으로 기존 floor를 우회할 수 있는 매핑을 완전한 구현이라고 부르지 않는다. patch hash나 Resident의 자기 lineage 선언 단독으로 의미적 동일성을 보장하지 않는다.

**SPIKE [S-10]** 다음을 미결정으로 남긴다: challenge 유효성 판정권과 evidence 기준; canonical integrated-operation 연결; floor의 정확한 적용 범위(명시 scope/rule/인증된 후속 연결 등); 우회·과잉 전파를 막는 mapping; durable 저장 및 revoke/lower 권한; 복구 중 floor와 CAS 경합; corrective/revert 자체에 대한 floor; 최소 schema/IPC/CLI와 migration. 별도 Change graph·lineage workflow를 즉흥적으로 만들지 않는다. 임시 Git notes/config JSON/새 테이블을 원본으로 골라 구현하지 않는다.

**MUST [CHAL-006]** LOW optimistic 운영의 필수 조건은 public integration mail과 검증된 challenge/floor 경로다. S-10이 OPEN이면 `tiered` 또는 “LOW+지속적 오류교정 production 지원”을 선언하지 않는다. base 보호 경계가 동작한다는 설명과 새 성능 아키텍처의 완료를 구분한다.

## 5. Principal mail과 progressive packet

**MUST [SEM-001]** canonical mail kind는 기존 `message`, `question`, `result`, `alert`, `context`에 `approval_required`, `critical`을 추가한다. proposal의 normal은 기존 message 의미에 대응하며 normal/대문자 semantic 별칭을 새 wire 값으로 추가하지 않는다. result는 sender가 결과/종합 후보를 전달한다는 뜻이고 Human에게 실제 전달 완료됐다는 뜻이 아니다. idle/agent_end/mailbox silence에서 result를 합성하지 않는다.

**MUST [SEM-002]** approval_required는 `approvalFor`에 full exact identity를 가진 Principal 승인 요청 hint다. 명시적 수신자에 principal이 포함되어야 한다. broker는 identity 형식과 published C를 확인하되 kind 자체로 실제 HIGH·peer approval 충족·Principal ACCEPT를 인증하지 않는다. base에서도 요청 의미를 저장할 수 있으나 authoritative approval 지원을 암시하는 성공 receipt를 반환하지 않는다. tiered의 formal HIGH 승인은 S-08 evaluator에서만 인정한다.

**MUST [SEM-003]** critical은 심각한 회귀/손상/불확실성의 명시적인 긴급 인지 요청이다. 기존 mail/usage quota와 identity 검사를 우회하지 않는다. Principal 수신이면 UI에 경고할 수 있으나 forced tool abort·고가 worker spawn·예산 우회는 하지 않는다. 모델 본문 내용으로 자동 critical 승격하지 않는다. 일반 mail은 기존 followUp 정책과 최대 6 metadata 항목을 유지한다.

**MUST [PACK-001]** question/approval_required 발신자는 일반 Markdown body 또는 immutable Git 문서로 다음 packet을 준비한다. 이는 읽기 문서 형식이지 새 DecisionPacket DB/entity가 아니다. broker는 의미의 충실성이나 추천의 옳음을 판정하지 않는다.

```text
QUESTION                 정확히 결정할 질문
MINIMUM CONTEXT          필요한 요구사항/동작 배경
OPTIONS                  가능한 선택지
RECOMMENDATION           발신자의 추천; 결정과 분리
TRADEOFFS                behavior/architecture/compatibility/security/performance/migration
EVIDENCE                 exact Git/mail/test 원자료 locator
UNCERTAINTY              미검증 부분/반대 증거/확신의 한계
```

**MUST [PACK-002]** HIGH 요청은 `EXACT CANDIDATE`(policy revision 포함), `RISK REASON`, `PEER STATE`(반대/미해결 포함), `VERIFICATION`(실제 검사의 대상과 출처), `CHANGED SURFACE`를 추가한다. sender의 “검사 통과/peer 승인” 서술은 주장이고, broker가 확인한 attestation/check receipt와 구분한다. Principal은 원자료를 직접 확인할 수 있어야 한다.

**SHOULD [PACK-003]** 첫 읽기의 decision overview를 8 KiB UTF-8 이내로 작성하고 더 긴 diff/log는 Git locator로 분리한다. 이는 prompt attention용 작성 기준이고 새 hard preview 제한이 아니다. transport는 기존 256 KiB body 상한을 유지하며 내용을 자동 잘라 버리지 않는다. 자동 notice는 overview 전문도 주입하지 않고 metadata+경로만 제공한다.

**SHOULD [PACK-004]** Principal은 질문/semantic summary → architecture/behavior → risk/disagreement → evidence → changed files → substantive diff → 필요 시 full diff/source/mail/log 순으로 살펴본다. 고정된 read workflow나 모든 단계 완료 checkbox는 만들지 않는다. 중요 uncertainty 또는 evidence 불일치를 해결하지 않고 작은 packet이라는 이유로 ACCEPT하지 않는다. test PASS/peer APPROVE/verifier 결과만으로 자동 ACCEPT하지 않는다.

## 6. OPTIONAL fresh-context verifier

**OPTIONAL [VERIFY-001]** fresh-context evidence-only 검증은 필요할 때 선택한다. 고정 Critic 직책·의무 quota·자동 승인·replacement patch 소유권은 없다. 동일 actor의 verifier invocation이 새 approval identity를 얻지 못한다. 결과는 ordinary mail/Git evidence로 사회에 공개할 수 있다.

**MUST [VERIFY-002]** 엄격한 clean-room 지원을 주장하려면 fresh session, 정확히 허용한 goal/acceptance/constraints/candidate/diff/check evidence/risk signals만 초기 입력으로 제공하고, peer discussion/author private reasoning/이전 session·reviewer 결론/hidden gold를 접근 가능한 경로에서도 차단해야 한다. prompt에서 “읽지 마라”고 하는 것만으로는 충분하지 않다.

**MUST [VERIFY-003]** 기본 Resident는 public archive와 world·Git history에 접근하므로 일반 `agent.create`를 strict clean-room primitive라고 부르지 않는다. `/mail/archive` 하나를 빼도 repository reports/commit messages/context decisions에 peer 결론이 남을 수 있다. verification에 필요한 정보를 유지하면서 어떤 경로를 제한할지 명시해야 한다.

**SPIKE [S-11]** 선택 invocation의 소유 identity/프로세스 lifecycle·quota, precise input export/mount manifest, Pi history/extension 차단, candidate 안의 embedded framing 한계, evidence 반환과 crash handling을 검증한다. 기본 society의 public 읽기 계약을 조용히 변경하거나 reviewer service/role/cognition table을 추가하지 않는다. SDK/primitive가 미정인 동안 새 `oma verify` command를 만들지 않는다.

## 7. 모듈·저장·구현 순서·평가

**MUST [POL-005]** 계산은 기존 `approval.ts`/`git.ts`, mail은 `mail.ts`/`pi-extension.ts`, 저장은 `store.ts`/기존 operations/deliveries가 담당한다. deterministic tier evaluator는 입력 snapshot→결과의 순수 함수로 분리할 수 있으나 service가 아니다. 새로운 module도 production 원본 목록과 측정에 포함한다. LOC 크기 목표·상한·release 차단은 DR20으로 폐지했으며 측정의 진실성 계약은 유지한다.

**MUST [POL-006]** tiered에 필요한 authenticated attestation과 최소 floor metadata는 상위 architecture가 허용한 제한된 확장 범위다. 현재 SQL 여섯 entity에 몰래 넣지 않는다. S-08/S-10 종료 시 최소 DDL·migration·transaction·closed DTO·error code·CLI·recovery를 한 변경으로 review한다. 그 전 `HostConfigV1`은 base만 허용하고 tiered config/API를 unknown-field 또는 UNSUPPORTED_PROFILE로 거절한다. new durable table의 개수/형식은 이 문서에서 추측하지 않는다.

**MUST [POL-007]** 이번 변경으로 즉시 고정하는 타입은 RiskTier, ExactCandidateIdentity, mail kind/approvalFor다. 미래 tier 계산 입력은 runtime command가 아닌 설계 타입으로만 선언한다. 실제 approval/challenge/floor mutation을 PublicMethods/operations.kind에 넣으려면 S-08/S-10의 동시 schema 계약 변경이 선행되어야 한다. 앞서 확정한 mutation request key 필수와 create input/ResolvedAgentSpec 분리를 유지한다.

**MUST [POL-008]** 구현 순서는 기존 physical substrate → S-08/S-10 정책 spike → deterministic evaluator+attestation → post-CAS integration mail+challenge/floor recovery → HIGH Principal 연결 → optional S-11 → long-task benchmark다. HIGH approver가 없거나 evidence가 부족하면 독립적인 사회 작업은 계속할 수 있지만 해당 main mutation은 진행하지 않는다. 정책 대기로 agent lifecycle을 중앙에서 배정하지 않는다.

**MUST [POL-009]** S-09에 tier-enabled/disabled 비교를 추가한다. false LOW/불필요한 HIGH, peer 오류 탐지율, 유효 challenge 후 반복 결함, Principal queue/latency/token, 전체 비용과 품질을 각각 기록한다. clean-room optional ablation도 지원할 경우 분리한다. tier policy가 attention을 더 잘 배분한다는 것은 검증할 가설이며 new governance feature를 더 쌓기 전에 long-task 결과를 확인한다.
