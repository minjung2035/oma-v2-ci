# OMA v2 유지보수 지침

이 문서는 OMA v2를 앞으로 수정하는 사람과 AI 모델을 위한 **비규범적 유지보수 지침**이다. 새로운 wire method, DB state, role, service, error code 또는 architecture 요구를 정의하지 않는다. 이 문서와 규범 문서가 충돌하면 항상 규범 문서가 우선한다.

OMA v2는 일반 애플리케이션이 아니라 durable operation, Git CAS, Maildir materialization, systemd/cgroup lifecycle, authenticated IPC, crash recovery와 inference accounting을 함께 다루는 correctness-oriented orchestration runtime이다. 따라서 local happy path가 맞는지만 보고 수정하면 안 된다.

## 1. 문서 권위와 읽기 순서

문서의 종류·owner·우선순위·읽기 순서는 [문서 지도](README.md)가 소유한다. PRIORITY-0를 먼저 읽고 HANDOFF의 최신 요청과 validation의 실행 판정을 확인한다. 변경할 주제의 계약과 관련 DR만 이어서 읽는다. owner는 문서 지도의 machine-readable map에서 찾는다.

### 문서 충돌 처리

문서와 코드 또는 두 문서가 충돌하면 편한 쪽을 선택하지 않는다. 다음 중 하나로 분류한다.

- implementation defect
- stale non-normative documentation
- unresolved design decision
- intentionally gated behavior

architecture/spec의 의미를 유지보수 편의를 위해 조용히 바꾸지 않는다. 규범 변경이 필요하면 별도의 architecture/spec 변경으로 다룬다.

## 2. 작업 시작 시 반드시 현재 상태를 다시 고정한다

과거 finding을 현재 버그로 가정하지 않는다. 모든 작업 시작 시 최소한 다음을 확인한다.

```text
repository / branch
current HEAD
working tree 또는 현재 GitHub diff
관련 requirement IDs
관련 OPEN SPIKE
관련 profile/config
현재 validation 상태
실행 가능한 검증 환경
```

과거 `DONE`, 과거 test count, 과거 LOC, 과거 evidence hash는 현재 source의 PASS가 아니다. historical document의 사례는 현재 HEAD에서 재현되거나 현재 source relation으로 다시 확인되기 전에는 snapshot evidence일 뿐이다.

## 3. 유지보수의 핵심 모델: Fact / Relation / Phase

버그와 변경을 다음 세 축으로 먼저 설명한다.

```text
Fact
  무엇이 authoritative한 사실인가?

Relation
  그 사실은 다른 사실과 어떤 관계여야 하는가?

Phase
  언제부터 그 사실을 durable/authoritative하게 믿을 수 있는가?
```

예를 들어 `MessageId` 자체가 유효한 것과 그 ID가 특정 accepted operation에서 정확히 파생된 것은 다른 조건이다. Git ref, workspace path, staging path, result DTO, recipient snapshot, incarnation도 동일하다.

코드를 고치기 전에 이 세 질문에 답할 수 없다면 아직 문제를 충분히 이해하지 못한 것이다.

## 4. 한 의미에는 하나의 authoritative owner를 둔다

Capability, resource/limit field, identifier grammar, method metadata, request identity, derived path/ref, error semantics처럼 같은 의미를 여러 모듈이 독립적으로 정의하지 않는다.

좋은 구조는 다음과 같다.

```text
authoritative definition
        ├─ TypeScript type
        ├─ runtime validator
        ├─ config validation
        ├─ durable validation
        ├─ protocol descriptor
        └─ test/equivalence oracle
```

새 값을 추가할 때 개발자가 여러 목록을 기억해서 동시에 고쳐야 한다면 single source가 아니다. runtime isolation 때문에 직접 import할 수 없는 trusted boundary는 generated copy 또는 equivalence test로 묶는다.

버그를 수정한 뒤에는 반드시 묻는다.

> 같은 종류의 실수를 다른 위치에서 다시 만들 수 있는가?

답이 yes라면 case fix만으로 끝내지 말고 owner/API/schema/static rule/model property를 검토한다.

## 5. Shape validation과 relational validation을 분리한다

다음은 다른 검증이다.

```text
유효한 MessageId인가?
이 operation에서 나와야 하는 MessageId인가?

유효한 path인가?
이 stateRoot/actor/operation에서 정확히 파생된 path인가?

유효한 result DTO인가?
accepted plan과 정확히 일치하는 result인가?
```

외부 입력, persisted row, recovery-time plan 모두 shape뿐 아니라 필요한 relation을 검증한다. persisted DB는 이미 검증된 신뢰 구역이 아니라 새로운 trust boundary다.

## 6. Durable state를 읽을 때 다시 검증한다

DB에 저장되어 있다는 사실만으로 값을 신뢰하지 않는다. 가능한 durable entity는 다음을 닫힌 형태로 검사한다.

- exact/closed fields
- enum과 safe integer range
- identity grammar
- flag/timestamp consistency
- cross-row ownership/reference
- accepted plan/result relation
- actor/incarnation relation
- derived path/ref/message relation

검증되지 않은 `JSON.parse(...) as OperationPlan` 같은 narrowing을 workflow effect로 전달하지 않는다. malformed persisted state를 default/current config로 조용히 보정하지 않는다.

## 7. Operation phase를 항상 의식한다

개념적으로 mutation은 다음 단계를 지난다.

```text
unvalidated
  -> preflight-valid
  -> prepared/frozen
  -> accepted
  -> physical effect in progress
  -> effect observed
  -> terminal
```

새 DB enum을 추가하라는 의미가 아니다. 중요한 것은 각 단계에서 무엇이 반드시 존재하고, 무엇이 immutable하며, 어떤 오류가 가능한지 명확히 하는 것이다.

Acceptance 이후에는 프로세스가 즉시 죽더라도 durable plan/evidence만으로 recovery가 안전한 다음 행동을 결정할 수 있어야 한다.

## 8. DB transaction과 physical effect를 섞지 않는다

SQLite rollback은 이미 수행된 filesystem/Git/systemd/provider effect를 되돌리지 않는다. Store transaction callback 안에는 원칙적으로 다음을 넣지 않는다.

- `await` 또는 Promise 반환
- Git/systemd/provider subprocess
- network I/O
- filesystem publication/fsync effect
- 장시간 blocking preparation

필요한 physical effect ordering은 `docs/implementation-spec.md`를 따른다. 정적 검사와 crash harness가 이 경계를 계속 감시해야 한다.

## 9. Normal execution과 recovery는 다른 decision workflow다

Normal path는 무엇을 하려는지 알고 시작한다. Recovery는 무엇이 실제로 일어났는지부터 관찰한다.

따라서 둘을 generic workflow 하나로 합치지 않는다. 공유할 것은 다음과 같은 observation primitive다.

- current ref/object observation
- ancestry/changed-path parsing
- immutable object integrity
- policy observation
- systemd/cgroup interpretation

Normal과 recovery의 decision tree는 분리한다. Recovery는 원래 요청을 맹목적으로 재실행하는 함수가 아니며, durable plan과 현재 physical evidence를 비교해 terminal 또는 explicit unknown에 수렴해야 한다.

핵심 property는 가능한 범위에서 다음이다.

```text
R(R(state)) == R(state)
```

## 10. Unknown을 다른 상태로 축약하지 않는다

다음 관계를 유지한다.

```text
unknown != absent
unknown != dead
unknown != success
unknown != zero
corruption != retryable
accepted-state corruption != preaccept invalid input
```

정책상 중요한 observation은 가능하면 `present / absent / unknown / corrupt`처럼 사실을 보존하고, decision layer에서 처리한다. boolean 하나가 중요한 불확실성을 잃게 만들지 않는다.

## 11. Error semantics는 phase와 effect knowledge를 함께 본다

Error code 하나만으로 terminal/retry/unknown을 결정하지 않는다. 최소한 다음을 함께 본다.

```text
error code
operation phase
effect knowledge
observation kind
```

예를 들어 preaccept `STREAM_INVALID`와 accepted broker-owned artifact corruption은 같은 의미가 아니다. 새 error code를 추가할 때는 allowed phase, retry, receipt exposure, recovery behavior와 host repair 필요 여부를 함께 정의한다.

## 12. Admission과 irreversible-effect authorization은 중복이 아니다

요청을 받아들일 때의 capability/state 검사와, 긴 preparation 뒤 irreversible effect 직전의 current authorization은 의미가 다르다.

중간에 다음이 바뀔 수 있다.

- actor stop/retire
- capability
- policy revision
- main/base ref
- incarnation/run identity
- writer slot

따라서 두 시점의 검사를 DRY라는 이유로 제거하지 않는다. 반대로 이미 accepted된 broker-owned effect recovery에 죽은 과거 peer의 live lease를 요구해서도 안 된다.

## 13. Same-key replay와 새로운 effect authorization을 구분한다

같은 request key의 accepted operation을 찾았다는 사실은 현재 새 physical effect를 수행할 권한과 다르다.

다음을 구분한다.

```text
terminal receipt replay
nonterminal accepted intent recovery
new physical effect execution
```

Terminal receipt는 historical fact로 그대로 반환한다. Nonterminal recovery는 frozen plan과 현재 physical evidence를 사용한다. 새 effect가 필요하면 current authority/state/incarnation을 다시 확인한다.

Accepted plan, request hash, frozen bytes를 현재 상태에 맞춰 rewrite하지 않는다.

특히 old start/stop request가 더 새로운 incarnation에 effect를 발행하지 못해야 한다.

## 14. Run identity는 actor 문자열 하나가 아니다

필요한 boundary에서 runtime identity는 다음 관계로 다룬다.

```text
actor
+ durable incarnation
+ InvocationID
+ pinned cgroup identity
+ current run lease
+ peer liveness/pidfd where required
```

PID 숫자, socket path, actor 이름 하나만으로 current run을 증명하지 않는다. Revocation 후에도 death proof에 필요한 pin의 lifetime을 조기에 끝내지 않는다. Unknown cgroup population을 dead로 처리하지 않는다.

## 15. Derived identity/path의 생성 owner를 하나로 둔다

MessageId, published ref, staging/workspace/mail/context path, unit name 등은 consumer마다 문자열로 다시 조립하지 않는다. authoritative identity에서 canonical derived constructor를 통해 생성한다.

Consumer는 가능하면 이미 검증된 derived value 또는 relation validator를 사용한다.

## 16. Authoritative state와 derived materialization을 구분한다

각 row/file/view에 대해 다음 질문에 답할 수 있어야 한다.

> 이 데이터가 사라졌을 때 authoritative state에서 재구성 가능한가?

Operation plan, immutable accepted evidence, canonical ref처럼 recovery 근거가 되는 것과, inbox/world/view처럼 reconstructable representation을 구분한다. Derived artifact가 있다는 이유만으로 terminal success를 추론하지 않는다.

## 17. Idempotency는 세 층으로 본다

```text
request idempotency
logical operation idempotency
physical effect idempotency
```

Immutable publication은 `same path + same bytes = idempotent`, `same path + different bytes/type = conflict/corruption`이어야 한다. Stable-name same-spec create가 workspace/unit/mail/quota를 두 번 소비하지 않게 한다.

## 18. 모든 외부 I/O와 effect는 bounded여야 한다

다음 축을 각각 확인한다.

- bytes / item count / nesting
- memory / wall-clock time / CPU
- process/FD count
- queue/waiter/pending count
- concurrency / retry count

무제한 child stdout/stderr, 무제한 waiter, 무제한 pending map, tight retry loop를 만들지 않는다. Truncation을 완전한 성공처럼 표시하지 않는다.

## 19. Protocol fatal error 뒤에는 resync하지 않는다

Malformed UTF-8/JSON, duplicate key, oversized frame 등 fatal framing 오류 뒤의 connection은 poisoned/closed라는 단순 계약을 유지한다. 남은 payload를 새 frame으로 재해석하지 않는다. 예외 하나(DR15): 엔진의 JSONL 채널에서 형식이 온전한데 크기만 한도를 넘는 줄은 다음 LF까지 건너뛰고 알린다. JSON 문자열에는 날 LF가 없으므로 그 LF는 추측이 아니라 정확한 경계다. 길이 접두 frame(broker wire)의 초과는 여전히 fatal이다. Connection/session/run 상태는 가능하면 invalid combination을 만들기 어려운 explicit state로 표현한다.

## 20. OPEN SPIKE를 guessed implementation으로 닫지 않는다

`docs/verification-spec.md`의 각 spike는 DR18이 판정했다: v1이 하는 것은 증거와 함께 닫았고, 하지 않는 것은 알려진 미지원 설정으로 거절한다. 판정을 바꾸거나 v1에 없는 기능을 더하는 것은 설계 수정이며, 실제 harness evidence로만 한다. 현재 helper, mock, interface, test file이 존재한다는 사실만으로 gate를 닫지 않는다.

지원되지 않는 경로는 `UNSUPPORTED_PROFILE`로 fail closed한다. 열린 spike가 없으므로 `SPIKE_UNRESOLVED`는 던지지 않는다(규칙 `no-open-spike`; 저장된 receipt의 code로는 계속 읽는다). SDK signature, Pi session-boundary evidence, candidate kernel enforcement를 추측하지 않는다. provider codec·가격·재시도는 동봉 엔진의 것이며(INF-001) OMA가 추측하거나 다시 만들 대상이 아니다.

## 21. 버그 수정 절차

모든 중요한 버그는 다음 순서를 기본으로 한다.

```text
1. current HEAD에서 재현
2. 직접 원인 확인
3. Fact / Relation / Phase 정리
4. root-cause class 분류
5. authoritative owner 확인
6. 가능하면 failing regression/invariant oracle 작성
7. 최소 안전 수정
8. 같은 class의 다른 독립 구현 static audit
9. relevant verification lane 실행
10. evidence와 HANDOFF 갱신
```

Root-cause class 예:

- relational invariant
- duplicated ownership / representation drift
- phase/order/TOCTOU
- observation/error classification
- identity/incarnation/fencing
- physical idempotency
- resource boundedness
- protocol state machine
- invalid test fixture/oracle
- stale verification evidence
- intentional OPEN gate

Case guard 하나만 추가했을 경우 다른 caller가 같은 실수를 할 수 없는지 반드시 확인한다.

## 22. Lifecycle 수정 시 특별 체크

### start

- target provisioning/retired 여부
- GOAL과 activation gate
- accepted plan의 desired/previousIncarnation
- 현재 desired/incarnation과 frozen plan의 relation
- old cgroup death proof
- 더 최근 stop intent 존재 여부
- same-key replay가 새 run을 임의로 시작하지 않는지

### stop

- frozen stop target incarnation
- 현재 더 새 incarnation 여부
- old stop replay가 새 incarnation을 죽이지 않는지
- path stop/disable 실패 후에도 revoke/service-stop/death-check safety action이 이어지는지
- unknown death를 succeeded로 바꾸지 않는지

### create

- same-name/same-spec logical replay와 physical winner 분리
- quota/workspace/unit/initial mail 중복 소비 금지
- accepted frozen spec/path/unit/message relation
- workspace 준비와 ready/activation/terminal의 phase 구분

## 23. Git 수정 시 특별 체크

- shell interpolation 금지, trusted env, bounded process
- actual object format과 full OID
- published ref immutable
- main update는 expected-old CAS
- protected-path external format parser 정확성
- normal/recovery observation primitive 공유
- third OID overwrite 금지
- submit candidate/prerequisite가 broker의 실제 object possession과 일치
- accepted bundle/candidate를 retry에서 재생성하지 않음
- integrate CAS 직전 base/policy/capability/stop 재검사

## 24. Mail/filesystem 수정 시 특별 체크

Logical address, frozen recipient snapshot, Delivery row, RFC header는 관련되지만 동일 representation이 아니다. EML bytes가 소유하는 Date/Message-ID/hash/length를 다른 계층이 독립 생성하지 않는다.

Immutable publication과 mutable derived-view replacement를 같은 semantics로 합치지 않는다. Cross-filesystem publication은 destination-side temp/write/fsync/verify/atomic publication/dir-fsync 순서를 보존한다.

## 25. Test fixture와 oracle 원칙

Validator 강화 후 test가 깨지면 production validator를 완화하기 전에 fixture를 검사한다.

정상 fixture는 production-valid constructor를 사용한다. Corruption test만 명시적인 raw/corruption helper로 validator를 우회한다.

Test oracle은 실제 contract를 검사해야 한다. 우연한 casing, helper 이름, temporary path 같은 구현 세부를 불필요하게 고정하지 않는다. 반대로 crash ordering, immutable bytes, cgroup/ref relation처럼 contract 자체가 물리적이면 실제 physical oracle을 사용한다.

사용자 흐름(모델 → 도구 → CLI → broker → 원장·메일 → 다음 전달)을 바꾸거나 고치면 시나리오 시험(`test/scenario-*.test.ts`, fixture는 `scripted-provider.ts`와 `scenario.ts`)을 함께 쓴다. 모델만 대본이고 나머지는 제품이다. 정상 경우와 장애 경우(provider 오류·끊김·멈춤, 엔진·broker·runner kill과 재시작, 같은 key 재시도)를 모두 두고, 판정은 화면이 아니라 원장·메일함·receipt·session 기록으로 한다. 단위 시험이 놓친 결함 여럿이 이 층에서만 드러났다(P0V-54, P0V-55). 이 층은 실제 provider의 증거가 아니다(P0-5, INF-001).

## 26. 검증 상태와 증거

다음 상태를 구분한다.

- `NOT_RUN`: 실행하지 않음.
- `BLOCKED`: 필요한 environment/gate가 없음.
- `UNVERIFIED`: source나 test가 있어도 현재 source-bound proof 없음.
- `PARTIAL`: 일부 lane/범위만 실행.
- `PROVEN`: 해당 requirement의 production entry/call path/negative oracle/fresh evidence가 현재 source에 결합됨.

Commit marker, source 존재, test 작성, mock PASS는 `PROVEN`이 아니다.

현재 검증 명령은 `package.json`의 scripts를 authoritative entry로 사용한다. 대표 순서는 다음과 같다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
node scripts/loc.mjs
```

환경이 없어 필수 kernel/systemd lane을 실행하지 못하면 PASS가 아니라 BLOCKED/NOT_RUN이다. 이전 source의 raw log나 숫자를 새 source 결과로 재사용하지 않는다.

## 27. 정적 규칙은 계약 위반의 재발을 검증한다

새 규칙은 규범 위반, authoritative owner의 불일치, 명시적으로 정한 dependency/capability 경계 또는 evidence/source 불일치를 다룰 때 추가한다. naming·취향·추정 설계 냄새만으로 실패시키지 않는다. TypeScript의 closed mapped type, 기존 helper/rule 또는 좁은 회귀 테스트가 같은 오류를 잡으면 먼저 재사용한다.

예:

- `Set.add()` membership 오용
- canonical ID/schema의 독립 재정의
- public/internal method descriptor 누락
- operation kind validator 누락
- transaction 내부 effect
- production이 test/fault source에 의존
- 실제 process/SQLite owner 밖의 raw effect

Static checker도 코드다. Architecture가 이동했으면 broad exception을 추가하지 말고 실제 owner와 음성 대조군에 맞춰 checker를 갱신한다.

규칙 수용 시 함께 남길 최소 증거:

1. 정상 positive fixture.
2. 직접 위반 negative fixture.
3. alias/import/간접 호출 등 해당 분석의 우회 negative fixture.
4. 겉모양은 비슷하지만 허용되어야 하는 false-positive control.
5. 어떤 기존 계약/semantic owner를 보호하며 naming heuristic이 아닌지 설명.

Runtime DAG와 type coupling은 별도다. Type-only 상향 edge는 먼저 생성 evidence에서 관측하고 실제 의미를 검토한다. 실제 부적절한 coupling이 재현되고, legitimate representation/contract 관계가 분류되며, false-positive control이 준비된 뒤에만 방향 gate를 검토한다. DR44부터 runtime/type union SCC는 같은 계층 안에서도 거절한다. capability는 concrete composition으로 돌아가지 않고 기존 decoder의 provenance 타입을 참조한다. cycle gate를 없애거나 edge별 whitelist로 우회하지 않는다.

Checker 파일 분리는 책임·source universe·분석 재사용이 분명해질 때만 한다. LOC 목표를 맞추기 위한 분할, TypeScript/기존 helper와 중복되는 parser·registry·evidence 체계는 추가하지 않는다. 현재 수용 사례는 `test/architecture-rule-modules.test.mjs`와 `test/architecture-oracles.test.mjs`의 positive/negative/false-positive fixture를 기준으로 확인한다.

## 28. 금지 사항

유지보수 작업에서 다음을 하지 않는다.

- 사용자 repository/history를 `reset --hard` 또는 destructive rewind로 정리
- DB 삭제/초기화로 corruption을 해결했다고 보고
- accepted plan/request hash/frozen bytes/terminal receipt를 현재 state에 맞춰 재작성
- recovery에서 ref 자동 rewind/rebase/merge/cherry-pick
- unknown을 success/absence/dead/zero로 변환
- 새 key를 만들어 동일 effect 자동 재실행
- OPEN SPIKE를 stub success로 처리
- 테스트 삭제/skip/todo로 PASS 생성
- 과거 PASS/LOC/evidence를 현재 source에 재사용
- mock/domain test를 actual kernel/systemd/provider proof로 승격
- 편의상 새 DB entity/queue/daemon/IPC phase를 추가

## 29. 문서 관리 규칙

문서의 owner·권위·새 정보를 적는 곳은 [문서 지도](README.md#새-정보를-어디에-적는가) 하나가 정한다. 병렬 색인이나 같은 정책의 두 번째 설명을 만들지 않는다. 실제 wire/durable 선언과 기계 판독 map은 코드 입력으로 구분한다.

현재 실행 판정은 validation, 재개점은 HANDOFF에 기록한다. 긴 과거 실행·인계·입력 원본은 [archive](archive.md)로 구분하고 작성 시점의 사실을 보존한다. Generated trace/report/inventory/evidence는 생성 도구와 입력 bytes에 결박한다. 문서 통합 때문에 과거 검증이나 승인 fact의 뜻을 바꾸지 않는다.

`npm run evidence:refresh`로 import graph·production inventory/source digests·review ledger·
structural input binding을 재생성한다. stale review claim을 자동 rehash하거나 과거 PASS를 갱신하지
않는다. 규범 fingerprint, effect owner와 durable boundary, 실제로 검토한 delta의 review-notes는
사람의 판단을 기록하는 입력이다. 파일 이동 시 의미 owner만 수정하고 파생 파일 목록·digest·
graph를 각각 손으로 동기화하지 않는다. 입력 binding 갱신과 runtime execution 기록은 별개다.

## 30. 인계 작성 템플릿

`docs/HANDOFF.md`는 장문의 작업 일지가 아니라 다음 재개점만 유지한다.

```text
현재 판정
current source/evidence status
이번에 바뀐 authoritative owner
남아 있는 BLOCKED / NOT_RUN / UNVERIFIED
가장 먼저 실행할 명령 또는 재현
변경하지 않은 normative surface
historical detail 링크
```

Commit 목록, 과거 test count, 장문의 diff 설명은 historical follow-up 또는 Git history에 둔다.

## 31. 최종 판단 기준

좋은 유지보수는 "몇 개의 버그를 고쳤는가"보다 다음으로 평가한다.

- 같은 의미의 독립 구현이 줄었는가?
- 관계 검증이 authoritative boundary에 모였는가?
- invalid state를 만들기 어려워졌는가?
- unknown/effect phase 정보를 잃지 않는가?
- static review에서 확인해야 하는 위치 수가 줄었는가?
- 기존 crash/recovery/security semantics를 보존하는가?
- 발견한 bug class가 다시 생기기 어려워졌는가?

몇 시간의 정적 감사를 해도 새로운 semantic duplication, normal/recovery drift, unknown-to-absence 축약이 거의 나오지 않는 상태가 장기적인 성숙 지표다.
