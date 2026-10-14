# G06-git-lifecycle 적대적 검증 결과

검토자 수칙 준수: 코드 미수정, `npm build/test`·`npm ci` 미실행, `systemctl`/`sudo`/네트워크 미사용,
쓰기는 `review/adversarial-2026-09-28/` 밖으로 나가지 않음. 재현은 `dist/src/...`를 import 하고
`mkdtemp`(`/tmp/oma-adv-G06-*`) 아래 실제 git repo에 대해 실행하고 정리함.

## 1. 커버리지

`wc -l`은 시작 시 실측값. 각 파일을 offset/limit로 마지막 줄까지 읽음.

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막으로 읽은 줄 N: 내용 앞 20자) |
|---|---|---|---|
| src/git.ts | 167 | 예 | 167: `}` (GitModule 닫힘) |
| src/git/canonical-command.ts | 41 | 예 | 41: `  return { after, cr` |
| src/git/context-publication.ts | 37 | 예 | 37: `}` (consumeContextP 닫힘) |
| src/git/context-repository.ts | 269 | 예 | 269: `}` (ContextRepositor 닫힘) |
| src/git/context.ts | 208 | 예 | 208: `}` (ContextCoordinat 닫힘) |
| src/git/integration-policy.ts | 122 | 예 | 122: `}` (assertSameIntegr 닫힘) |
| src/git/integration.ts | 243 | 예 | 243: `}` (IntegrationCoord 닫힘) |
| src/git/observe.ts | 140 | 예 | 140: `}` (classifyRefAfter 닫힘) |
| src/git/paths.ts | 17 | 예 | 17: `export interface Ch` |
| src/git/publication.ts | 48 | 예 | 48: `}` (consumeSubmissio 닫힘) |
| src/git/quarantine.ts | 133 | 예 | 133: `}` (QuarantineImport 닫힘) |
| src/git/submit.ts | 178 | 예 | 178: `}` (SubmitCoordinato 닫힘) |
| src/lifecycle.ts | 39 | 예 | 39: `}` (LifecycleModule 닫힘) |
| src/lifecycle/actions.ts | 156 | 예 | 156: `}` (LifecycleActions 닫힘) |
| src/lifecycle/contracts.ts | 23 | 예 | 23: `export type LinkedC` |
| src/lifecycle/create-publication.ts | 61 | 예 | 61: `}` (consumeCreationP 닫힘) |
| src/lifecycle/create.ts | 260 | 예 | 260: `}` (CreateCoordinato 닫힘) |
| src/lifecycle/policy.ts | 44 | 예 | 44: `}` (LifecyclePolicy 닫힘) |
| src/lifecycle/registry-operations.ts | 64 | 예 | 64: `}` (RegistryOperatio 닫힘) |
| src/lifecycle/workspace.ts | 121 | 예 | 121: `}` (WorkspaceCoordin 닫힘) |

호출자·피호출자로 그룹 밖에서 읽은 것: `src/domain/identifiers.ts`(isValidFullOid/isValidWirePath/
isValidRequestKey), `src/domain/derived.ts`(publishedRefFor/exportRefForRequestKey/isExportRef),
`src/domain/errors.ts`(classifyError/acceptedFailurePolicy), `src/validate.ts`(checkExportRef).

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G06-01 | Low | boundary | 잘못된 인자(`-` 접두 candidate/ref)가 CAS에서 오류가 아니라 `expected`/`third`로 관측됨 | confirmed |
| G06-02 | Info | structural | CAS 인자 위생이 상위 OID/ref 검증에만 의존(방어 다층 부재) | high |

High 이상 발견 없음. 우선 공격 벡터 (1)–(7)은 모두 상위 검증·knowledge 모델·CAS 재관측으로 막혀 있음(§5).

## 3. 발견 상세

### G06-01 잘못된 인자가 CAS에서 오류가 아니라 정상 관측 종류로 보고됨
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음 (P0-5 인접이나 위반 아님)
- 코드 경로: `src/git/canonical-command.ts:33`(`compareAndSwapCanonicalRef` → `update-ref ref candidate expected??""`)
  → `src/git/observe.ts:126`(`classifyRefAfterCas`)
- 원인: `compareAndSwapCanonicalRef`는 `update-ref`의 exit status를 버리고(설계상 "effect exit status is
  never CAS proof", `canonical-command.ts:1`) 오직 `observations.ref`로 재관측한다. candidate가 `--stdin`
  처럼 `-`로 시작하면 `update-ref`가 그 인자를 옵션으로 먹거나 무시해 ref를 만들지 않고, 재관측은 ref
  부재(oid=null)를 보고 `oid === expected(null)` → `kind:"expected"`를 돌려준다. 즉 "잘못된 값"이 "이미
  기대값이었다"로 관측된다.
- 영향: 실사용 경로에서는 CAS에 도달하는 candidate/expected가 이미 `isValidFullOid`(40/64 hex,
  `objectFormat`/`verifyObjectFormat`, `integration.ts:210`·`git.ts:104`)로, ref는 리터럴 또는
  `publishedRefFor`/`isExportRef`(`derived.ts:22,38`)로 검증되어 `-`가 절대 도달하지 못한다. 따라서 실제
  durable fact가 뒤바뀌지는 않는다. 순수히 방어 다층/진단 품질 문제다. 재관측 자체는 P0V-85 주석대로
  올바르게 "ref가 지금 무엇을 들고 있는가"만 사실로 말한다.
- 최소 반례: 검증을 우회해 `compareAndSwapCanonicalRef(obs, repo, "refs/heads/inj", "--stdin", null)`을
  직접 부르면 `kind:"expected"`가 나오고 `refs/heads/inj`는 생성되지 않음. ref 이름 `"--bad"`도 동일하게
  `expected`(주입 없음).
- 재현 방법: `node review/adversarial-2026-09-28/repro/G06-git-lifecycle/cas-boundary.mjs`
  관측: `F candidate='--stdin' outcome: returned:expected inj exists: false` / `G ref='--bad' outcome: returned:expected`
- 확신도: confirmed
- 개선 방향: (코드 수정 아님, 방향만) CAS 진입에서 `candidate`/`expected`/`ref`가 `-`로 시작하지 않음을
  단정하거나 `update-ref` 인자에 `--` 종결자를 넣어, 잘못된 입력이 조용한 `expected`가 아니라 명시적
  `INVALID_OID`/`INVALID_REQUEST`로 드러나게 한다. 현재는 상위 owner의 위생에만 의존한다.

### G06-02 CAS 인자 위생이 상위 계층에만 존재
- 심각도: Info
- 분류: structural
- 위반 규칙: 없음
- 코드 경로: `src/git.ts:104`(`objectFormat`), `src/git/integration.ts:210`, `src/git/context.ts:151`,
  `src/git/submit.ts:79`(`verifyObjectFormat`) → `src/git/canonical-command.ts:31-34`
- 원인: G06-01의 구조적 배경. adapter(`canonical-command.ts`)는 인자 위생 책임을 지지 않고 관측자·코디네이터가
  OID/ref 형식을 보장한다. P0-2 관점에서 "OID는 이 repo 형식에 맞아야 한다"는 판정은 `objectFormat`·
  `verifyObjectFormat` 한 곳으로 모여 있어 중복 구현은 아니다.
- 영향: 없음(현행 정상). 새 CAS 호출자가 추가될 때 위생을 잊으면 G06-01류 조용한 오관측이 재발할 수 있는
  잠재적 리팩터링 지점.
- 최소 반례: 해당 없음(잠재).
- 재현 방법: 추론만. 위 cas-boundary.mjs가 adapter 단독 호출 시의 무방비를 보인다.
- 확신도: high
- 개선 방향: adapter 경계에 `-` 접두 거부(또는 `--` 종결자) 같은 최소 불변식을 두어, 위생이 상위에서
  누락돼도 durable ref가 조용히 오관측되지 않게 한다.

## 4. 리팩터링 필요 지점

- `canonical-command.ts`의 CAS/create adapter: 인자 위생 불변식을 adapter 경계로 내리면(§G06-02), CAS
  호출자가 늘어도 "OID 형식/`-` 접두"라는 전제를 각자 기억할 필요가 없어진다(PRINCIPLES 추상화 수용 기준의
  "호출자가 기억할 전제 수"를 줄임). 다만 현재도 위반은 아니므로 우선순위는 낮다.
- `observed()`/`present()` 헬퍼가 `git.ts:19`, `integration.ts:23`, `context-repository.ts:47`,
  `context.ts` 등에 각각 재정의되어 있다. 세 곳 모두 `present→value`, `corrupt→STORE_CORRUPT`,
  그 외→`REF_STATE_UNKNOWN`로 동일 규칙이다. 같은 판정의 반복 구현이지만 규칙이 완전히 동일해 drift 위험만
  있고 현재 버그는 아니다(P0-2 경계선, Info).

## 5. 점검했고 문제없다고 판단한 것 (공격했지만 막혀 있던 경로)

**(1) Git ref CAS**
- update-ref old-oid 검증: `compareAndSwapCanonicalRef`(`canonical-command.ts:31`)는 exit status를 신뢰하지
  않고 `classifyRefAfterCas`(`observe.ts:126-131`)로 재관측한다. 재현(cas-boundary.mjs)에서 stale expected는
  `third`(B), 정상 CAS는 `candidate`(C), 빈 old-oid로 기존 ref 덮어쓰기 시도는 `third`이고 ref는 불변(E)로
  확인. 빈 문자열 old-oid(`expected ?? ""`)는 git의 "ref must not exist" 의미로 create-only가 강제됨(A,E).
- CAS 실패 vs '이미 적용됨' 구분: candidate가 이미 값이고 expected가 stale인 재시도(D)는 `candidate`로 관측
  되어 멱등하게 성공 처리된다. `stale`은 `third`(B). 둘이 코드에서 구분됨(`observe.ts:129-130`).
- CAS 성공 뒤 crash: `classifyError`(`errors.ts:170-177`)에서 `effectKnowledge`가 `possible`/`applied`이면
  terminal은 절대 `failed`가 아니라 `unknown`(또는 corrupt→repair)이다. `integration.ts:222,229`,
  `context.ts:190,199`, `submit.ts:158`에서 CAS 직전 `knowledge="possible"`로 올리므로 P0-5 준수(§P0-5).
- 같은 request key 재시도 두 번 적용: `claimKey`가 `retry`/`reused`를 반환하고(`integration.ts:167`,
  `submit.ts:80`, `context.ts:113`), 재시도는 `retriedOperation`으로 기존 receipt를 돌려준다. CAS 자체도
  같은 candidate면 `candidate`(멱등)이라 두 번 적용이 아니다(P0-7).

**(2) submit 경로**
- 악성 bundle: 검증이 격리 namespace(`quarantine.ts` SCRIPT) 안에서 `bundle verify`→`list-heads`(정확히 1
  head이고 `= export_ref`)→`fetch export_ref:refs/oma/input`→`rev-parse == candidate`→`fsck --strict`로
  이뤄진다. 경로 탈출/`.git`/대소문자 충돌/symlink/gitlink는 fsck 및 project로의 `fetch`가 객체만 가져오고
  (refmap 비움, `--no-write-fetch-head`), 최종 `canonicalHas(candidate)`로 확인한다(`quarantine.ts:124`).
  bundle은 read-only bind mount로 넣고(`mount -o remount,bind,ro`) tmpfs 크기 제한이 걸린다.
- quarantine 우회: isolation 실패 시 host fallback 파서가 없다("No host fallback", `quarantine.ts:1`).
  namespace 실패는 `UNSUPPORTED_PROFILE`/`REF_STATE_UNKNOWN`이지 성공이 아니다(`quarantine.ts:118-122`).
- git 설정 주입: `prlimit`+`env -i`로 환경을 비우고 `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_SYSTEM=/dev/null`, `core.hooksPath=/dev/null`을 강제(`quarantine.ts:97-104`). `GIT_ENV`
  (`process/policies.ts`)가 상속 GIT_* 를 대체. safe.directory/protocol.ext/uploadpack.packObjectsHook는
  격리 bare repo + bundle 파일 전송이라 도달 표면이 없음.
- canonical-command 인자 주입(`-` 접두 ref/oid): §G06-01. 실경로에서는 상위 OID/ref 검증으로 차단.
  exportRef는 `isExportRef`가 `refs/oma/export/`+request-key 알파벳을 강제(`derived.ts:38`)해 `-` 불가.

**(3) integration**
- exact candidate와 다른 merge 후보(TOCTOU): `requireEligible`(published 포함, ancestry, protected paths)를
  CAS 직전 두 번 재검하고(`integration.ts:196-203`), `stillAtBase`로 main==base 재확인, CAS는 정확히
  `compareAndSwap(plan.base, plan.candidate)`로 base를 old-oid로 걸어 다른 후보가 끼면 `third`→unknown.
- 과거 접수에 현재 revision 적용(P0-1/P0-3): 접수 시 `policyRevision`을 plan에 결박(`integration.ts:204`),
  CAS 직전 `verifyCurrentPolicy`로 revision 불변 확인(`integration.ts:100-103`), 사실(protected/checks)은
  `assertSameIntegrationPolicy`로 identity 동일 요구(`integration-policy.ts:114`). DR8 준수.
- crash 대조 복구(§12.4): `reconcile`(`integration.ts:207`)는 no-op와 applied를 구분하고, applied CAS는
  새 권한 없이 정산, 미적용은 자격·권한·정책 재검 후에만 CAS. 관측 실패는 unknown 유지.

**(4) context repository/publication**
- 게시 순서: candidate 준비→CAS→snapshot 게시→mail gated→terminal(`context.ts:184-193`,
  `context-repository.ts:publishSnapshot`). 각 단계가 자기 토큰을 소비하고 mail은 게시 후 새 ref 관측 필요
  (`context-publication.ts:consumeContextPublication`).
- 부분/동시 게시: `requireWriterSlot`(`context.ts:82`)이 미완 context publish 존재 시 다른 writer를 막고,
  `GitModule.withWriter`(`git.ts:74`)가 직렬화. `preparationQuiescent`로 native 정지 증명 요구.

**(5) observe**
- git 명령 실패를 '없음'으로 승격: `uncertain`(error/signal/status===null)과 `diagnostic`(stderr 비어있지
  않음)을 unknown으로 판정(`observe.ts:64-73`). ref 부재는 오직 `status===1 && stdout===""`일 때만 absent
  (`observe.ts:79`). ancestry는 status 0/1만 사실, 그 외 unknown(`observe.ts:104`). 권한/IO/timeout이
  absent/false로 새지 않음. P0-5·DR13 준수. `published`/`changedPaths`도 status!==0을 unknown으로.

**(6) lifecycle**
- 생성 중 crash 조합: physical create는 acceptOperation 트랜잭션에서 agent 행 insert가 원자적이고
  (`create.ts:229-234`), workspace/unit는 accept 뒤 `finish`에서 만들며 실패는 accepted-knowledge로 unknown
  처리. `finishAccepted`가 plan.workspacePath/unitNames identity를 재검(`create.ts:200-206`).
- 이름 충돌: `getAgent` 재확인 + `assertResidentNamesFree`(`create.ts:120,128`), 트랜잭션 안에서 raced 재검.
- 은퇴 이름 재사용: 은퇴는 행을 지우지 않고 `desired="retired"`로 둔다(`store.ts:395` 전이 종점, 재사용
  불가). create의 `getAgent(name)`이 그 행을 보고 specHash 일치면 기존 physical create에 link, 불일치면
  `AGENT_CONFLICT`(`create.ts:104-118`). 새 agent가 과거 receipt/batch를 상속하는 경로 없음. P0-1 준수.
- stop 중 in-flight run: stop은 `units.stop`+`confirmDead(incarnation)` 확인 후에만 succeeded, 미확인은
  unknown(`actions.ts:112-116`). incarnation을 plan.previousIncarnation으로 결박.
- incarnation 증가 시점/workspace 정리: `ensure(readinessProven)`는 이미 준비된 workspace를 관측만 하고
  reset/checkout 안 함(`workspace.ts:71-83`). accept 여부 unknown이면 PreacceptScope가 보존(P0-4,
  `create.ts:172` 주석). create-publication은 provisioning→enabled 전이 트랜잭션이 유일한 준비 확정
  (`create-publication.ts:39-51`).
- registry-operations 동시성: ack/follow 모두 단일 트랜잭션 안에서 classifyKey→accept→effect→succeed, 외부
  효과 없음(`registry-operations.ts:1`).

**(7) paths 경계값**
- `GitPaths`는 broker 제공 값이며 wire 입력이 아님(`paths.ts:1` 주석). agent 이름/topic 같은 사용자 입력은
  `workspacePathAt`/`residentUnitsFor`/`publishedRefFor`가 `parseActor`/`isWorkspacePathFor`로 검증한 뒤에만
  경로가 되고, quarantine root는 `randomUUID`로 생성(`quarantine.ts:89`)해 사용자 입력이 경로에 직접 들어가지
  않는다. `isValidWirePath`(`identifiers.ts:73`)가 `..`/`//`/선행 `/`/NUL/4096 초과를 거부.

## 6. 확인하지 못한 것

- quarantine namespace 실제 실행 경로(`unshare --user --map-root-user --mount --pid --net`, `prlimit`)는
  본 검토 규칙상 `sudo`/특권/커널 의존이라 실행하지 못함. SCRIPT의 mount 순서·`--kill-child` 정지 보장은
  정적 독해로만 판정(악성 bundle을 실제 namespace에 통과시키는 재현은 미실행). 확신도 medium로 §5(2)에 서술.
- `reconcile.ts`/§12.4 integration crash 대조의 상위 오케스트레이션(할당 밖)은 호출 계약만 확인했고 전체
  복구 시퀀스의 kill·retry 주입 시험은 돌리지 못함(빌드/시험 실행 금지). `classifyError`의 terminal 분기는
  정적으로 P0-5 준수 확인.
- `store.claimKey`/`acceptOperation`의 동시성(두 broker, 같은 UID 적대 프로세스)은 store 그룹 소관이라
  본 그룹에서는 계약(retry/reused/inserted)만 신뢰하고 내부는 검증하지 않음.
