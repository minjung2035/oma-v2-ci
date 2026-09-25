# Priority 0 파일 단위 점검 기록

기준: [PRIORITY-0.md](../PRIORITY-0.md). 이 문서 하나를 계속 갱신한다(새 audit 파일을 만들지 않는다).
시작 기준점: `0cb9757` (v15 결박). 방법: 파일을 하나씩 읽고, 그 파일이 만들거나 해석하는 durable
fact와 owner, 하위 규칙 P0-1–P0-7별 판정과 근거(파일:줄)를 적는다. 키워드 검색은 읽은 파일의 호출
관계를 따라갈 때만 쓴다.

판정: **위반**(고칠 규칙과 근거 원칙), **부합**(근거), **의도된 예외**(owner 문서와 이유).
줄 번호는 점검 시점(기준점)의 번호다. 수정 뒤에는 "수정" 열의 commit이 기준이다.

진행: A·B·C 기록 완료, D부터 진행 중.

## 읽는 순서

| 묶음 | 파일 | 이유 |
|---|---|---|
| A durable schema·store | schema-v1.sql, store.ts, storage/{transaction,transitions,operation-transitions,operation-journal,operation-codec,rows,facets,ledger-reader,quota}.ts, durable.ts, validate.ts | durable fact를 쓰는 유일한 경로 |
| B 파일 게시 | storage/{durable-fs,immutable-file,directory,contained-fs,preaccept-artifact,submit-spool,staged-tree,paths,delivery-receipt,receipt-projector,batch-view,context-*,diagnostic-snapshot}.ts | 파일 형태의 durable fact와 accept 전 artifact |
| C 전달 | mail.ts, mail/*, protocol/{receipts,receipt-codec,run-lease,batch-view}.ts, broker.ts, runner.ts, runtime/{principal-delivery,run-registry}.ts, extension/{delivery,batch-view}.ts | receipt·incarnation·재전달 |
| D operation·복구 | reconcile.ts, reconcile/*, request-cache.ts, cli/*, broker/* | unknown 처리, same-key, 정산 |
| E Git | git.ts, git/* | CAS와 통합 사실 |
| F lifecycle·unit | lifecycle*, units*, runtime/{provision,resident-rootfs}.ts, sandbox.ts | 만들기·멈추기의 unknown |
| G 설정 | config.ts, config/*, tui/sources/settings.ts | generation commit |
| H runtime·process | runtime/*, process/* | 권한(lease·tenure)과 관측 |
| I domain·protocol | domain/*, protocol/* 나머지 | 사실의 정의 |
| J 경계·표시 | extension/*, tui/*, views*, diagnostics/*, entry/*, 나머지 | 관측이 권한을 만들지 않는가 |

## 발견 요약

| ID | 규칙 | 파일:줄 | 요약 | 상태 |
|---|---|---|---|---|
| P0V-01 | P0-1 | storage/transitions.ts:174-186, broker.ts:449 | rollover가 준비된 batch의 `incarnation`을 새 lease 값으로 덮어써, 이전 전달 시도(incarnation N)의 receipt가 더는 그 batch를 가리키지 못한다. 한 칸이 DeliveryAttemptIdentity와 RunLeaseIdentity를 겸한다 | 확인 |
| P0V-02 | P0-1 | storage/transitions.ts:193,219,225, store.ts:350 | 링크·완료·조회가 "현재 lease == batch incarnation"을 요구해, 과거 시도의 증거로 하는 정산(과거 사실의 기록)을 현재 권한의 조건에 묶는다 | 확인 |
| P0V-03 | P0-1 | store.ts:281-295 | `updateAgent`가 생성 뒤 고정인 spec(LIFE-008)을 다시 쓰는 경로와 감소 가능한 incarnation 쓰기를 연다. 제품 호출은 없고 시험 2곳(phase5:187, git-effect-evidence:107)만 쓴다. spec을 다시 쓰면 과거 create operation이 STORE_CORRUPT로 읽힌다(operation-codec.ts:228) | 확인 |
| P0V-04 | P0-1 | storage/ledger-reader.ts:211 | usage row의 유효성이 현재 agent spec의 modelProfile과 같은지에 달려 있다. 과거 예약 사실의 의미가 현재 spec에 기대 있다(P0V-03이 막히면 spec이 바뀌지 않으므로 증상은 없다) | 확인(P0V-03에 종속) |
| P0V-05 | P0-4 | mail.ts:88-107,155-170; storage/preaccept-artifact.ts:150-207 | accept 전 artifact(메일 원문 object, `staging/mail-objects/*.tmp`)의 owner가 메모리 속 `PreacceptScope`뿐이다. 그 사이에 프로세스가 죽으면 아무도 찾지 않고, 진단(diagnostics/integrity.ts:86)은 "unknown"으로 보고만 한다. 이름은 operation id에서 파생되므로 재시작한 broker가 "그 operation이 accept되지 않았다"를 확정할 수 있는데도 정리하지 않는다 | 확인(submit·context는 D·E묶음에서 확인) |
| P0V-06 | P0-2 | broker.ts:465-482; runner.ts:278-297; runtime/principal-delivery.ts:133-144 | "receipt가 있으면 다시 제시하는가"(D01 공통 evidence 판정)를 broker 정산, Resident runner, Principal tick이 각자 switch로 구현한다 | 확인 |

## 파일별 기록

### A. durable schema·store

#### implementation/schema-v1.sql (108)
- **fact:** agents(현재 권한 `incarnation`, 고정 spec), operations(accepted intent·terminal), deliveries(수신 사실과 materialized/presented/acknowledged 시각), batches(manifest·`incarnation`·state), usage(예약 사실, 예약 당시 `incarnation`), subscriptions.
- **P0-1 위반(P0V-01의 근거):** `batches.incarnation`(52)은 칸이 하나뿐이다. D01은 이 칸을 "재할당되는 batch incarnation"으로, receipt의 incarnation을 "최초 전달 시점에 고정"으로 적었다. 과거 시도의 identity를 담을 곳이 schema에 없다. 재할당하면 시도의 역사가 사라지고, receipt 말고는 그 시도를 기록한 durable fact가 남지 않는다.
- **부합:** `usage.incarnation`(85)은 insert 뒤 바뀌지 않는다(transitions.ts:265-267은 outcome만 바꾼다). deliveries의 시각은 첫 사실 시각을 보존한다(transitions.ts:139,149).
- **참고:** DB-001은 "새 DB에만 적용"이고 store.ts:209-231에 migration이 없다. schema를 바꾸려면 user_version 2와 한 transaction 안의 v1→v2 upgrade가 필요하다(D01 "기존 contract가 v1 해결을 허용하지 않으면 … 결정 변경을 기록한다").

#### src/store.ts (364)
- **P0-1 위반 P0V-03:** `updateAgent`(281-295)는 `specHash`/`specJson`을 아무 때나 바꾸고, `incarnation`을 이전보다 작은 값으로도 쓴다. 제품의 호출은 세 곳이다: broker.ts:449(incarnation), lifecycle/actions.ts:53,95와 create-publication.ts:46(desired). spec 쓰기는 시험(phase5.test.ts:187 "durable capability revocation", git-effect-evidence.test.ts:107)만 쓴다. spec은 LIFE-008대로 고정이고, 권한 폐기는 "호스트의 현재 … 명시적 권한 폐기 정책"(LIFE-008)이다. 곧 현재 권한 쪽의 일이지 과거 사실을 다시 쓰는 일이 아니다. incarnation을 되돌리면 과거 receipt·usage의 incarnation이 새 lease의 것과 섞인다.
- **P0-1 위반 P0V-02(일부):** `pendingBatchesFor`(350)는 준비된 batch를 `batch.incarnation === incarnation`으로 고른다. P0V-01의 칸을 현재 lease로 읽는 곳이다.
- **부합:** `migrate`(209-231)는 읽을 수 있는 version만 열고 나머지는 고치지 않은 채 거절한다. `preflightDatabase`(43-93)는 WAL/journal 증거를 보존하고 BROKER_UNAVAILABLE(unknown)로 멈춘다. unknown을 absent로 바꾸지 않는다(P0-5). `validDesiredTransition`(357-365)은 retired를 되돌리지 않는다.

#### src/storage/transaction.ts (71)
- **부합:** 한 root transaction만 쓰기 권한을 가진다(56-70). accepted plan은 원래 acceptance transaction 밖에서 바꿀 수 없다(52-55, INV03). 비동기 효과는 transaction 안에서 거절한다(25-31).

#### src/storage/transitions.ts (199)
- **P0-1 위반 P0V-01:** `reassignPreparedBatches`(174-186)가 `UPDATE batches SET incarnation=?`로 과거 시도의 incarnation을 새 lease 값으로 바꾼다. 바뀐 뒤 `completeBatch`(214-238)는 `batch.incarnation !== expectedIncarnation`(219)이면 BATCH_CONFLICT다. 그래서 시도 N의 receipt가 늦게 관측되면 정산할 수 없고, 같은 batch가 다시 전달된다(DR6가 알린 중복 전달).
- **P0-1 위반 P0V-02:** `linkDeliveriesToBatch`(193)와 `completeBatch`(225)가 "현재 agent incarnation == batch incarnation"을 요구한다. 새 효과(링크: 이 lease가 전달할 batch를 정함)에는 현재 권한 검사가 옳다. 반면 완료는 과거에 이미 일어난 제시를 기록하는 정산(INV08)이라, 현재 lease가 아니라 그 시도의 identity와 증거에 묶여야 한다.
- **부합:** `insertDeliveries`(120-134)는 기존 key의 다른 사실을 거절한다. `markMaterialized`/`markAcknowledged`는 첫 시각을 보존한다. `completeBatch`의 exact replay(220-223)는 첫 terminal 사실을 보존한다. `settleUsage`(256-269)는 reserved에서만 바뀌고 unknown을 completed로 올리지 않는다(261-262, P0-5).
- `reserveUsage`(250)는 현재 lease를 요구한다. 새 효과(추론 예약)라서 옳다(P0-1 부합).

#### src/storage/rows.ts (187)
- **부합:** 모든 row decoder는 전체 열을 닫힌 형태로 검사하고 보정하지 않는다(47-53, 136-141 순서 보존). 과거 사실의 해석에 현재 설정을 쓰지 않는다.

#### src/storage/facets.ts (71)
- 이름만 바꾸는 view. 쓰기 facet 목록(212-226)에 `batches.reassign`, `agents.update`가 있다. P0V-01/P0V-03을 고치면 여기도 바뀐다.

#### src/storage/ledger-reader.ts (221)
- **P0-1 위반 P0V-04:** `usageRow`(211)는 `row.profile !== 현재 spec.modelProfile`이면 STORE_CORRUPT다. spec이 고정이면(P0V-03 수정 뒤) 문제가 없다. 그래도 관계의 근거는 "예약 당시 spec"이어야 하고, 고정 spec이 그 값을 보장한다.
- **부합:** `batchMembership`(84-93)와 `batchRow`(171-184)는 "batch incarnation이 현재 lease보다 크지 않다"만 요구한다(미래 사실 금지). `recoverableIds`(134-136)는 pending과 unknown을 함께 복구 대상으로 둔다. unknown을 terminal로 취급하지 않는다.

#### src/storage/operation-journal.ts (59)
- **부합:** same key/hash는 조회일 뿐 재실행 권한이 아니다(259-273, INV03).

#### src/storage/operation-transitions.ts (75)
- **부합:** terminal은 바뀌지 않는다(329-345). plan은 원래 acceptance 안에서만 바뀐다(315-321).
- **호출처 점검 필요:** `fail`(337-346)과 `succeed`(322-336)는 `unknown`에서 terminal로 가는 전이를 허용한다. 그 전이가 새 관측·repair에 근거하는지는 복구 쪽(D묶음)에서 판정한다(P0-5).

#### src/storage/operation-codec.ts (264)
- **부합:** 저장된 payload는 구조 한도(`structuralLimits`, protocol/request-codec.ts:11-18)로 읽는다. 뒤에 설정 한도를 낮춰도 과거 operation이 손상으로 읽히지 않는다(P0-3). create는 고정 spec과 plan이 같아야 한다(223-238). 이 관계가 P0V-03의 증상 근거다.

#### src/storage/quota.ts (139)
- **부합:** 관측할 수 없는 root는 0이 아니라 BROKER_UNAVAILABLE이다(281-304, INV02). 정산과 새 수락의 자원 정책이 다르다(381-395, D04/INV08).

#### src/durable.ts (428), src/validate.ts (428)
- **부합:** 결과는 accepted plan과 비교하고 현재 기본값과 비교하지 않는다(351-428). 경로 관계는 `stateRoot`에서 파생한다. 전제: state root 위치는 society의 identity이며 옮기는 것을 지원하지 않는다. 옮기면 fail closed(STORE_CORRUPT)가 되지만 다른 뜻으로 읽히지는 않는다.

### B. 파일 게시

#### src/storage/durable-fs.ts (231), directory.ts (92), contained-fs.ts (184)
- **부합:** 배타 생성 → 쓰기 → fsync의 순서를 지키고, 실패하면 이 호출이 만든 이름만 지운다(118-156). 파생 교체의 rename 뒤 실패는 "교체 안 됨"으로 내리지 않는다(158-199). crash fault는 정리 경로를 타지 않는다(42-49). 이 fault seam(20-49)은 P0-7의 파일 경계 주입 도구다.
- `removeOwnedTree`/`removeOwnedFile`(directory.ts:288-323)은 "accept되지 않았음"을 호출자가 확정한 뒤에만 쓴다는 전제가 있다. 호출처는 파일별로 판정한다.

#### src/storage/immutable-file.ts (227)
- **부합(P0-5):** 관측은 present/absent/unavailable/corrupt 넷이고, absent는 ENOENT일 때만이다(81-108). accept된 증거가 없으면 absent가 아니라 STORE_CORRUPT다(110-122). 같은 이름·다른 bytes는 손상이다(124-130).
- EXDEV 경로의 임시 파일(161-181)은 crash 뒤에 대상 디렉터리에 남는다. 이름이 `.<name>.<uuid>.tmp`라 사실로 읽히지 않고, P0V-05의 정리 범위에 넣을 수 있다.

#### src/storage/preaccept-artifact.ts (233)
- **부합:** 한 프로세스 수명 안의 owner는 명시적이다. accept되었거나 불명확하면 보존하고(183-184), 관측이 실패하면 outcome-unknown이다(172-176). identity가 다르면 지우지 않는다(95-97).
- **위반 P0V-05:** owner 기록이 메모리에만 있다. `settle`이 불리기 전에 프로세스가 죽으면 registration이 사라진다. P0-4의 판정 질문("직후에 죽으면 누가 찾는가")에 답이 없다.
- `settleByAcceptance`(209-233)는 제품 호출이 없는 호환 facade다(주석 211-214).

#### src/storage/submit-spool.ts (161), staged-tree.ts (105)
- **부합:** accept된 bundle이 없으면 STORE_CORRUPT이고(151,160), 열 수 없으면 REF_STATE_UNKNOWN이다(152,159). absent로 바꾸지 않는다. 기존 대상은 검증 뒤 "existing"이고, rename 뒤 오류는 덮어쓸 권한이 아니다(180-190).
- **P0V-05 범위:** `prepareSubmitSpool`(36-97)은 `staging/submit/<op>/upload.bundle`을 accept 전에 만든다. crash 뒤의 owner는 E묶음(git/submit.ts)에서 확인한다.

#### src/storage/paths.ts (114), src/ids.ts (27)
- operation id와 batch id는 무작위이고(131-140), accept 전 artifact 이름은 operation id에서 파생된다(65-73). 그래서 crash 뒤의 재시도가 이전 artifact와 충돌하지 않고, 재시작한 broker는 이름에서 operation을 찾아 accept 여부를 확정할 수 있다(P0V-05 수정의 근거).

#### src/storage/delivery-receipt.ts (364)
- **위반 P0V-01(증상):** receipt의 이름은 batch마다 하나다(237, 310). `checkReceipt`는 `value.incarnation !== expected.incarnation`이면 conflicting이다(175). `expected`는 현재 batch row이므로 rollover 뒤에는 시도 N의 올바른 receipt가 "identity-differs"로 읽힌다. 과거 receipt의 의미가 새 incarnation 때문에 바뀐다.
- **부합(P0-5):** 관측은 verified/absent/unavailable/conflicting이고, absent는 게시가 만드는 디렉터리 아래의 ENOENT일 때만이다(227-269). 게시는 임시 파일 → fsync → no-replace link → 재검증 → parent flush 순서다(294-363, D01 "영수증 publication의 보장").
- `requireVerifiedReceipt`(270-286)는 "정산할 수 없는 관측 → 오류"의 한 mapping이다. 다만 "다시 제시해도 되는가"는 이 파일이 아니라 세 호출자가 정한다(P0V-06).

#### src/storage/receipt-projector.ts (36), src/storage/batch-view.ts (18), src/protocol/receipts.ts (31), src/protocol/run-lease.ts (81)
- **부합:** receipt projection은 decode한 snapshot만 쓴다. batch view는 다시 만들 수 있는 파생물이고 "제시됨"을 표시하지 않는다(156-159). run lease는 전송 identity일 뿐 생존 증명이 아니다(52-54).

### C. 전달

#### src/broker.ts (523)
- **위반 P0V-01:** `openRun`(417-456)이 한 transaction에서 `updateAgent({incarnation: next})`와 `reassignPreparedBatches(actor, next)`를 함께 한다(449).
- **부합(P0-5):** `settlePreviousIncarnation`(465-482)은 unavailable이면 BROKER_UNAVAILABLE, conflicting이면 BATCH_CONFLICT로 run을 열지 않는다. unknown을 absent로 올려 재할당하지 않는다. 다만 이것은 **순서**(rollover 전에 정산)로 과거 receipt를 보호할 뿐이다. 모델(schema)에는 과거 시도가 남지 않는다(P0V-01).
- **위반 P0V-06:** 474-478의 switch가 D01 판정표의 broker 쪽 구현이다.
- 469: 준비된 batch가 이전 incarnation이 아니면 BATCH_CONFLICT다. 재할당이 모든 prepared batch를 한꺼번에 옮기므로 지금은 성립하지만, 사실이 아니라 전이 순서에 기댄 관계다.
- **부합:** 정산 권한은 이전 run의 사망 증명에서 온다(466, run-registry.ts:141-155). 새 run이 active라는 것으로 이전 run이 죽었다고 추측하지 않는다(run-registry.ts:127-128, RUN_TERMINATION_UNKNOWN).

#### src/mail.ts (178)
- **위반 P0V-05:** `send`는 accept 전에 `freezeObject`로 `mail/objects/<id>.eml`을 게시하고, 그 전에 `staging/mail-objects/<id>.<uuid>.tmp`를 쓴다(155-170). owner는 `PreacceptScope`(88-107)뿐이다.
- **부합:** 수신자는 accept transaction 안에서 다시 계산해 고정한다(99). accept 뒤 실패는 accepted failure이고(109-119), materialize 실패는 pending으로 남겨 복구에 맡긴다(113-115, P0-5).

#### src/mail/batches.ts (188)
- **위반 P0V-01/02:** `prepare`는 기존 prepared batch를 `row.incarnation`(재할당된 값)으로 돌려준다(78-86). `complete`는 `batch.incarnation !== evidence.incarnation`이면 BATCH_CONFLICT다(104). `settleFromReceipt`는 `row.incarnation !== quiescence.incarnation`이면 BATCH_CONFLICT다(124). 셋 다 한 칸을 시도 identity이자 현재 lease로 읽는다.
- **부합:** 재전달 알림(DR6, 50-53, 179)은 "이 batch가 전에 준비되었고 완료가 확인되지 않았다"는 사실을 말한다. 그 사실은 prepared row에서 나오고 참이다. Principal의 재제시(같은 incarnation)에도 참이다.
- **부합:** `moveToCur`(134-170)는 관측 실패를 BROKER_UNAVAILABLE로 두고, new 이름을 지우기 전에 cur 이름을 영속화한다.

#### src/runner.ts (320)
- **위반 P0V-06:** `consume`(271-308)이 receipt 관측을 직접 보고 "absent이면 제시, 아니면 verified 요구"를 정한다(278-297).
- **부합:** prepared batch가 현재 lease의 것이 아니면 STALE_RUN이다(131-141, 현재 권한 검사). 연결은 호출마다 다시 연다(99-107).

#### src/runtime/principal-delivery.ts (244)
- **위반 P0V-06:** `tick`(120-160)이 같은 판정표를 세 번째로 구현한다(133-144).
- **부합(P0-5):** 응답이 없거나 settle되지 않은 전달은 session claim을 놓지 않는다(237-241, D06/WP09). timeout을 "실행 안 됨"으로 바꾸지 않는다. 다만 claim이 영영 풀리지 않으면 session이 끝날 때까지 Principal 전달이 멈춘다. liveness 비용이며 의도된 선택이다.
- Principal의 `incarnation`은 0으로 고정이다(lifecycle/create.ts:82, 증가하는 경로 없음). Principal의 현재 권한은 broker 메모리의 registration generation이다(principal-endpoint.ts:98-108, 196-211). Principal batch는 재할당되지 않으므로 P0V-01이 없다. 재제시 시도는 durable하게 구분되지 않지만 과거 사실을 다시 쓰지도 않는다.

#### src/broker/principal-endpoint.ts (388)
- **부합(P0-1, INV06, INV11):** 권한(등록, engine 자손 여부)을 요청마다 /proc에서 다시 얻는다(254-280). 관측할 수 없는 engine은 retire하지 않는다(233-241, INV02).

#### src/extension/delivery.ts (104)
- 사실: batch는 `sendMessage`(45-57)로 세션에 들어가지만, receipt의 근거인 boundary entry는 turn이 `stop`으로 끝났을 때만 생긴다(73). 그러니 "receipt 없음"은 "제시 안 됨"이 아니다. 현재 정책(D01 표 "receipt 부재 → 중복 안내 정책", DR6)은 재제시하면서 그 불확실성을 알린다. 부합.

#### src/runtime/run-registry.ts (163)
- **부합(P0-5):** 이전 invocation의 cgroup이 empty/removed로 증명되지 않으면 RUN_TERMINATION_UNKNOWN이다(127-128). 정산 권한은 opening 단계에만 있고, publish·revoke·교체와 함께 끝난다(141-155).

#### src/mail/materializer.ts (130), mail/reconcile.ts (54), mail/{facts,routing,addresses,headers,serialize,display}.ts
- **부합:** 저장된 메시지의 header를 accept된 plan과 대조한다(44-78). archive 부재는 복구가 materialize할 일이지 repair가 아니다(reconcile.ts:155-160). 관측 실패는 BROKER_UNAVAILABLE이다. 주소 해석은 현재 agent 이름을 쓰지만 agent는 지워지지 않으므로(retired 유지) 과거 주소의 해석은 바뀌지 않는다.
