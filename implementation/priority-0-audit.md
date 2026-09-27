# Priority 0 파일 단위 점검 기록

이 문서는 **점검 기록**이다([문서 지도](../docs/README.md)). [PRIORITY-0.md](../PRIORITY-0.md)의 적용 절차가 요구하는 기록이며, 다음 점검도 새 파일을 만들지 않고 이 문서를 갱신한다.
여기의 판정은 각 기준점의 코드에 대한 것이다. 지금의 검증 상태와 수치는 [validation.md](validation.md)가 소유한다.

**상태(2026-09-26).** 코드의 발견 24개(P0V-01–P0V-24)와 문서·식별자의 발견 14개(P0D-01–P0D-14)를 모두 고쳤다. 4차 점검(외부 전수 검토)의 발견
P0V-25–P0V-53 가운데 P0V-44는 의도된 예외(DR14)이고 나머지는 고쳤다. 코드 발견은 상태 열이 수정 commit이다.

| 절 | 내용 | 줄 번호의 기준 |
|---|---|---|
| 발견 요약, 발견의 분류 | P0V-01–P0V-24 한 줄씩과 수정 commit, 같은 원칙을 어긴 모습별 묶음 | 각 행에 적은 commit(1차는 `0cb9757`) |
| 파일별 기록(A–J) | 1차 점검: 215개 파일의 fact·owner·규칙별 판정과 근거 | `0cb9757` |
| P0-7 점검, 수정 계획 | 시험이 durable 경계를 덮는가, 수정 순서와 근거 원칙 | `0cb9757` |
| 2차 점검 | 모든 `catch`와 `existsSync`에 P0-5를 다시 물은 판정, P0V-18–P0V-23 | `7b6c462` |
| 실제 provider 점검(14차) | DR9–DR13을 제품에서 끝까지 확인한 결과, P0V-24 | 14차 빌드(`1b3827c` 이후) |
| 3차 점검: 문서와 식별자 | 문서 25개와 식별자(요구 ID, 수용 번호)의 판정, P0D-01–P0D-14 | `8cb0406` |
| 4차 점검: 외부 전수 검토 | 외부 검토의 N01–N23·F1–F7 판정, P0V-25–P0V-53, 결정이 필요한 것 | `6787211` |
| 수정 검증 | 수정마다 되돌린 변이와 그 결과 | — |

방법: 파일을 하나씩 읽고, 그 파일이 만들거나 해석하는 durable fact와 owner, 하위 규칙 P0-1–P0-7별 판정과 근거(파일:줄)를 적는다. 키워드 검색은 읽은 파일의 호출 관계를 따라갈 때만 쓴다.
판정: **위반**(고칠 규칙과 근거 원칙), **부합**(근거), **의도된 예외**(owner 문서와 이유).

## 1차 점검에서 파일을 읽은 순서

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
| P0V-01 | P0-1 | storage/transitions.ts:174-186, broker.ts:449 | rollover가 준비된 batch의 `incarnation`을 새 lease 값으로 덮어써, 이전 전달 시도(incarnation N)의 receipt가 더는 그 batch를 가리키지 못한다. 한 칸이 DeliveryAttemptIdentity와 RunLeaseIdentity를 겸한다 | 수정 9a13f1b(DR9) |
| P0V-02 | P0-1 | storage/transitions.ts:193,219,225, store.ts:350 | 링크·완료·조회가 "현재 lease == batch incarnation"을 요구해, 과거 시도의 증거로 하는 정산(과거 사실의 기록)을 현재 권한의 조건에 묶는다 | 수정 9a13f1b(DR9) |
| P0V-03 | P0-1 | store.ts:281-295 | `updateAgent`가 생성 뒤 고정인 spec(LIFE-008)을 다시 쓰는 경로와 감소 가능한 incarnation 쓰기를 연다. 제품 호출은 없고 시험 2곳(phase5:187, git-effect-evidence:107)만 쓴다. spec을 다시 쓰면 과거 create operation이 STORE_CORRUPT로 읽힌다(operation-codec.ts:228) | 수정 9a13f1b |
| P0V-04 | P0-1 | storage/ledger-reader.ts:211 | usage row의 유효성이 현재 agent spec의 modelProfile과 같은지에 달려 있다. 과거 예약 사실의 의미가 현재 spec에 기대 있다(P0V-03이 막히면 spec이 바뀌지 않으므로 증상은 없다) | 해소 9a13f1b(P0V-03 수정으로 spec 고정) |
| P0V-05 | P0-4 | mail.ts:88-107,155-170; storage/preaccept-artifact.ts:150-207 | accept 전 artifact(메일 원문 object, `staging/mail-objects/*.tmp`)의 owner가 메모리 속 `PreacceptScope`뿐이다. 그 사이에 프로세스가 죽으면 아무도 찾지 않고, 진단(diagnostics/integrity.ts:86)은 "unknown"으로 보고만 한다. 이름은 operation id에서 파생되므로 재시작한 broker가 "그 operation이 accept되지 않았다"를 확정할 수 있는데도 정리하지 않는다 | 수정 d7c6695, 5c08088(DR10) |
| P0V-06 | P0-2 | broker.ts:465-482; runner.ts:278-297; runtime/principal-delivery.ts:133-144 | "receipt가 있으면 다시 제시하는가"(D01 공통 evidence 판정)를 broker 정산, Resident runner, Principal tick이 각자 switch로 구현한다 | 수정 9a13f1b(`deliveryDecision`) |
| P0V-07 | P0-2 | reconcile.ts:218-221 | 정본 저장소 건강 관측(fsck)이 둘이다: 동기판(218-221, 제품 호출 없음, 시험 phase8.test.ts:343만 사용)과 async판(222-231). git이 끝나지 않으면 동기판은 `runGitText`가 DEADLINE_EXCEEDED/INTERNAL_ERROR를 던지고(process/policies.ts:14-20), async판은 REF_STATE_UNKNOWN이다. 같은 unknown에 코드가 둘이다. (정정: 처음에는 "timeout을 STORE_CORRUPT로 올린다"고 적었으나, `runGitText`는 끝나지 않은 git을 status로 돌려주지 않으므로 사실이 아니다. 두 판 모두 끝까지 실행된 nonzero만 STORE_CORRUPT다.) | 수정 a5321ee(정정됨) |
| P0V-09 | P0-5 | domain/errors.ts:220, cli/exit.ts:38-45 | CLI의 실패 exit code(`errorExit`)가 코드의 범주만 보고 retry 분류를 보지 않는다. accept된 뒤 결과가 불명확한 실패(retry `same-key`, effect possible)가 conflict/input 코드이면 exit 2(확정 실패)로 나간다. 예: accept된 create의 live 경로 POLICY_CHANGED(lifecycle/create.ts:225)는 operation이 pending인 채 exit 2다 | 수정 145d519(DR13) |
| P0V-10 | P0-1, P0-2, P0-3 | lifecycle/create.ts:216-226 | accept된 create의 live 경로만 accept 뒤에 자식 정책을 다시 풀어 다르면 POLICY_CHANGED로 멈춘다. 같은 operation을 복구(`reconcile`, auth 없음)는 고정 spec으로 끝까지 만든다. 뒤의 설정 편집이 접수된 사실을 다시 해석하고, 판정이 둘로 갈린다. CREATE-003은 "accepted 요청은 … 저장된 resolved spec으로 복구"다 | 수정 145d519, 7e2559f |
| P0V-11 | P0-5, P0-2 | units.ts:69-70,83-84,40-41 | systemctl 결과를 모를 때(timeout·signal·spawn 실패, units/execute.ts:16-31)를 `run`은 UNSUPPORTED_PROFILE(플랫폼이 지원하지 않는다는 사실, exit 4, operator review)로, `link`는 INTERNAL_ERROR로, `assertUserManagerReachable`은 UNSUPPORTED_PROFILE로 올린다. 같은 unknown에 코드가 셋이고 어느 것도 unknown이 아니다 | 수정 57731b6(DR13) |
| P0V-08 | P0-5, P0-2 | git/integration.ts:54-70, entry/broker.ts:154-158,165-169, config/operations.ts:417-423 | broker의 host 정책 reader가 현재 설정을 **얻지 못한** 경우(I/O 오류, 편집 중 invalid)를 POLICY_CHANGED로 바꾼다. CAS 직전(integration.ts:181,219,226)에 나면 accept된 통합이 "정책이 바뀜"이라는 terminal failed로 끝나고, 설정을 고쳐도 되살아나지 않는다. loader도 I/O 실패를 INVALID_REQUEST("config unreadable")로 싼다. "설정을 읽고 society를 확인하는" reader가 entry/broker.ts에 두 벌이다 | 수정 f2ff92a(DR13) |
| P0V-12 | P0-3, P0-2, P0-5 | tui/sources/settings.ts:163-182,337-351; entry/oma.ts:270-278 | 설정 쓰기 경로가 둘이다. bundle은 관리형 generation commit(기대 버전 확인, production loader 재현 증명, 결과 불명 상태 기록, config/generations.ts:276-343)이고, inline `config.json`은 `validateConfig` 뒤 파일 교체뿐이다. inline에는 CONFIG-CONTRACT의 기대 버전 확인(lost update 방지)과 loader 재현 증명이 없다. rename 뒤 flush가 실패하면 "저장 안 됨"처럼 오류만 던진다. "같은 의미인가(unchanged)" 판정도 두 벌이다(346-348 대 193-196). 그 결과 TUI에 `saved-unread`("저장됐지만 다시 읽지 못함", oma.ts:273-276)라는 결과 종류가 있다 | 수정 efd5858, 70a6031(DR12). 보완: 기대 버전 확인(`assertCurrent`)이 다시 읽지 못한 파일을 "바뀜"(POLICY_CHANGED)으로 두던 것을 1차 기록(G묶음)은 "P0V-12 수정 때 함께 정리"라고 적었으나 빠뜨렸다. 2차 점검에서 수정(없어진 파일만 바뀜, 읽지 못함은 BROKER_UNAVAILABLE) |
| P0V-13 | P0-1, P0-7 (INV07) | storage/delivery-receipt.ts:129-152,294-364; node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:786-812 | receipt는 fsync와 parent flush로 durable하게 게시되지만, 그것이 가리키는 session entry는 Pi가 `appendFileSync`로만 쓰고 fsync하지 않는다. 게시할 때도 검증할 때도 session 파일이 있는지만 보고, 그 entry가 파일에 있는지는 보지 않는다. 전원이 나가면 "batch가 session S의 entry X에 있다"는 durable fact가 재시작 뒤 거짓이 된다. batch는 완료로 기록되었으므로 다시 전달되지도 않는다 | 수정 36e9928(DR11) |
| P0V-14 | P0-5 | extension/cli-process.ts:131-132, extension/mail-tools.ts:204-215, extension/principal-tools.ts:76-136 | 도구가 CLI를 timeout·abort로 끝내거나 spawn이 실패하면 `code ?? 1`로 1이 되고, 오류 문구는 "CLI exited 1"뿐이다. 도구가 정한 request key는 성공 결과(`details.request`)에만 실린다. 결과를 모르는 mutation이 key 없는 실패로 보이므로, 모델은 같은 요청을 조회할 수 없고 새로 보내면 효과가 중복된다 | 수정 8f7700a(DR13) |
| P0V-15 | P0-5, P0-2 | extension/workspace-guard.ts:38-57 | workspace 크기 계산이 관측 실패를 두 가지로 다룬다. `readdirSync` 실패는 "한도 초과"(거절)이고, `lstatSync` 실패는 ENOENT가 아니어도 0 byte(건너뜀)다. unknown이 zero가 된다(MAINTENANCE §10 "unknown != zero") | 수정 8f7700a |
| P0V-16 | P0-7 | test/crash-boundaries.test.ts, test/durable-fault-matrix.test.ts 외 | durable 경계의 목록이 코드에서 나오지 않고, 경계마다 kill·retry·restart 시험을 요구하는 장치가 없다. 이번에 바뀌는 경계에는 시험이 없거나 옛 의미로 적혀 있다 | 수정 b86d0c3(P0-7 gate) |
| P0V-17 | P0-4, P0-7 | git.ts:`repairContextMirror`, git/context-mirror.ts; runtime/provision.ts `publishBinding` | P0-7 gate를 만들며 찾았다. (가) `repairContextMirror`는 durable 게시 경로인데 제품 코드도 시험도 부르지 않는다. owner 없는 durable 경계다. (나) project binding 게시가 죽으면 `.project-binding.json.<hex>.tmp` 임시 파일의 owner가 없다(P0-4). (다) draining broker의 status view 제거(broker.ts, protocol/status-view.ts)에 시험이 없다 | 수정 b86d0c3((가) 삭제, (나) tenure 보유자의 provisioning이 수집, (다) 시험 추가) |
| P0V-18 | P0-2, P0-5 | (`b86d0c3` 기준) tui/exit.ts:9-21, entry/oma.ts:42,83,152,161,177,181,324 | Control Panel(`oma`)의 exit 판정이 CLI의 `errorExit`와 따로 구현되어 있다. `codeFor`는 UNSUPPORTED_PROFILE·SPIKE_UNRESOLVED만 4, BROKER_UNAVAILABLE·DEADLINE_EXCEEDED만 3이고 나머지는 모두 2다. 그래서 RUN_TERMINATION_UNKNOWN·REF_STATE_UNKNOWN·STORE_CORRUPT·INTERNAL_ERROR 같은 불명이 확정 실패(2)로 나간다. 진입점은 exit을 숫자로 직접 적는다. "잠시 후 다시 실행하세요"(다른 oma가 소유)는 4(지원하지 않음)이고, usage·다른 프로젝트의 바인딩도 4다. 1차 점검은 tui/exit.ts를 묶음 판정에서 부합으로 적었다. 2차 점검에서 바로잡았다 | 수정 7b6c462 |
| P0V-19 | P0-5 | config/operations.ts:352,417 | loader가 읽지 못한 설정(EACCES·EIO)을 내용이 틀린 설정과 같은 INVALID_REQUEST로 쌌다(P0V-08의 빠진 부분). 자세히는 "2차 점검" | 수정 76a6827 |
| P0V-20 | P0-5 | storage/directory.ts:23,47, store.ts:217,331, runtime/resident-rootfs.ts:137, runtime/provision.ts:103,319,345,403 | 관측하지 못한 것을 STORE_CORRUPT로 올려 broker의 sticky fence(domain/admission.ts:9-11)가 society를 멈춘다. 바인딩을 읽지 못한 것을 "다른 바인딩"으로 보고한다 | 수정 76a6827 |
| P0V-21 | P0-5 | runtime/{assets.ts:50, deployment-manifest.ts:131, extension-integrity.ts:51, pi-adapter.ts:118, pi-runtime.ts:49,62} | 관측하지 못한 host 배치·배포·extension·Pi 경로를 UNSUPPORTED_PROFILE로 보고한다 | 수정 76a6827 |
| P0V-22 | P0-5 | config/generations.ts:182, tui/sources/{extensions.ts:65,70, mail.ts:92} | 목록을 얻지 못한 것을 0·빠짐으로 센다(generation 예산, extension 후보, 메일·unread 수) | 수정 76a6827 |
| P0V-23 | P0-5 | tui/app.ts:207 | commit된 뒤 flush만 실패한 설정 저장을 "저장하지 못했습니다"로 표시한다 | 수정 76a6827 |
| P0V-24 | P0-5, P0-1 (INV11) | entry/oma.ts `setField`·`setExtension` | 14차 실제 provider 점검에서 찾았다. Control Panel은 저장에 성공했을 때만 설정을 다시 읽었다. 화면이 읽은 뒤 파일이 바뀌어 편집이 거절되면(DR12의 기대 버전 확인), 화면은 거절된 편집의 원본 snapshot을 계속 현재 값으로 보여 주었고(파일은 5, 화면은 6), 다음 편집도 같은 낡은 snapshot으로 만들어져 계속 거절되었다. 거절 문구는 "다시 읽으라"고 했지만 방법은 재시작뿐이었다. 확장 토글은 저장 뒤 다시 읽기가 실패하면 저장된 토글을 "저장하지 못했습니다"로 보고했다 | 수정 721cfe1 |

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

### D. operation·복구

#### src/reconcile.ts (232)
- **위반 P0V-07(P0-2, 정정됨):** 218-221의 동기 fsck와 222-231의 async fsck가 같은 관측을 따로 구현한다. 끝나지 않은 git을 동기판은 DEADLINE_EXCEEDED/INTERNAL_ERROR(`runGitText`, process/policies.ts:14-20)로, async판은 REF_STATE_UNKNOWN으로 둔다. 둘 다 끝까지 실행된 nonzero만 STORE_CORRUPT다. 처음 판정("timeout을 손상으로 올린다")은 `runGitText`를 읽기 전의 추정이어서 틀렸다.
- **부합(P0-5):** 시작할 때 모든 Resident의 정지를 증명하지 못하면 RUN_TERMINATION_UNKNOWN이다(61-77). fsck의 await 뒤에는 사망 관측을 다시 한다(89-90). unit 관측이 unknown이면 시작하지 않는다(183-185, 196). 복구 오류는 코드·phase·effect knowledge·관측 종류로 분류한다(133-144, MAINTENANCE §11).
- **부합:** mail.ack·route.*는 한 transaction에서 효과를 끝낸다. nonterminal row가 있으면 재실행하지 않고 SPIKE_UNRESOLVED(operator review)로 둔다(108-110, 127-128).

#### src/reconcile/operations.ts (97)
- **부합:** 초기 snapshot만 돌고(54), 진전이 없는 항목은 terminal로 바꾸지 않고 다음 timer로 넘긴다(85-90). 사라진 operation은 STORE_CORRUPT다(63, 81).

#### src/request-cache.ts (286)
- **부합(P0-5, INV03):** 관측은 absent/present/corrupt/unavailable 넷이다(23-27). metadata 없는 body는 "원래 payload unknown"이며 재구성하지 않는다(157-168). `updateReceipt`는 settle된 관측을 퇴행시키지 않는다(274-279).
- 보수적 판정(의도된 예외): body만 남은 key는 영구히 corrupt로 남는다. freeze 순서(body → metadata → 전송, 196-200)로 보면 "보내지 않았음"이 확정된다. 그래도 이 cache는 모델이 쓸 수 있는 영역이라(1-2, FS-003) 그 순서를 증거로 삼지 않는다. 모델은 새 key를 쓴다.

#### src/cli/{request-service,request-intent,transport,exit,effects,effects/*}.ts
- **부합(P0-5):** freeze를 전송보다 먼저 한다(request-service.ts:93-108). replay는 명시적 REQUEST_NOT_FOUND일 때만 다시 보낸다(110-130). 전송 실패는 "미접수 여부 불명확"(exit 3)이지 실패가 아니다(114-116, 134-136). same-key 실패에는 새 key 금지 안내가 붙는다(exit.ts:38-45). 명시하지 않은 HEAD/branch는 replay 때 다시 해석하지 않는다(request-intent.ts:200-205).

#### src/broker/connection.ts (265)
- **부합:** 실행 중인 task는 연결이 아니라 task가 body·peer 참조를 가진다(104-108). 연결 종료가 accept된 작업을 지우지 않는다. receipt deadline(88, 232)은 DEADLINE_EXCEEDED이고, 이 코드는 transient·exit 3·same-key다(domain/errors.ts:60). 곧 "실패"가 아니라 "불명확"으로 나간다.

#### src/broker/transport-spool.ts (108)
- **P0V-05 범위:** `staging/rpc-<uuid>.wire`(38)는 연결이나 실행이 가진 transport 복사본이고, 정상 경로에서는 dispose가 지운다(89-107). crash 뒤에는 owner가 없다. transport 복사본은 정의상 accept된 artifact가 아니므로 재시작 때 지울 수 있다.

#### src/broker/internal-dispatcher.ts (248), public-dispatcher.ts (206), peer-authenticator.ts (122), peer-pin.ts (44), composition.ts (151)
- **부합(P0-1, INV06, INV11):** 권한은 요청마다 현재 row·run·cgroup·pidfd에서 다시 얻는다(peer-authenticator.ts:43-66). capability getter도 읽을 때마다 다시 계산한다. 이미 accept된 same-key 조회는 새 소비로 보지 않는다(public-dispatcher.ts:117-124, INV08). pidfd가 "running"이라고 답하지 않으면 권한을 주지 않지만, 그것을 사망 증명으로 쓰지도 않는다(peer-authenticator.ts:36-38).
- `batch.complete`(internal-dispatcher.ts:189-208)는 요청자가 현재 lease이고 그 lease가 evidence의 시도여야 한다. 요청자 권한 검사라 옳다. P0V-01을 고친 뒤에도 "runner는 자기 시도만 완료한다"로 남는다.

### E. Git

#### src/git.ts (171), git/canonical-command.ts (30), git/observe.ts (139)
- **부합(P0-5):** 관측은 present/absent/unknown/corrupt이다. nonzero·timeout·signal·이상한 출력은 absent가 아니다(observe.ts:1-4, 56-79). CAS의 성공은 exit code가 아니라 CAS 뒤의 새 관측으로 판정한다(canonical-command.ts:143-148, observe.ts:128-139). 쓰기 주체는 하나이고, 바쁘면 같은 key로 재시도하게 거절한다(git.ts:73-81, DR3 `reason: busy`).

#### src/git/integration.ts (238), git/integration-policy.ts (118)
- **부합(P0-1, INV08):** CAS가 끝난 사실(main == candidate, base ≠ candidate)은 권한이 바뀌어도 이력으로 정산한다(207-211). CAS 전이면 효과 직전의 현재 권한·정책으로 결정한다(181-183, 219-227, INV06). main이 base도 candidate도 아니면 unknown이다(212). 통합 사실과 현재 revision은 구분한다(DR8, 48-76).
- **판정 보류 P0V-08 후보(P0-5):** `currentPolicy()`(54-70)는 정책을 "읽지 못함"(reader throw, 빈 revision)도 POLICY_CHANGED로 던진다. accept 뒤 CAS 직전의 `verifyCurrentPolicy`(181, 219, 226)에서 나면 `rejectAccepted`가 failed(POLICY_CHANGED)로 끝낸다. 기록되는 사실은 "정책이 바뀜"인데, 실제로 아는 것은 "정책을 읽지 못함"이다. reader 구현은 G묶음에서 확인한다.

#### src/git/submit.ts (182), git/publication.ts (48), git/quarantine.ts (116)
- **부합:** accept 뒤 실패는 accepted failure이고, 관측이 모호하면 unknown이다(165-178). 공개 ref가 다른 값이면 unknown이다(168). 메일 게시 증거는 한 번 쓰는 in-memory 관측 토큰이다(publication.ts:1-48).
- **P0V-05 범위:** `prepareSubmitSpool`은 bundle이 없어도 `staging/submit/<op>/`를 만든다(submit-spool.ts:44-45). 거절된 submit이나 bundle 없는 submit의 빈 디렉터리는 남는다. accept 전 메일 원문도 `PreacceptScope`에만 등록된다(97-126).
- **부합(P0-5):** quarantine의 native 명령이 끝났는지 모르면 staging(`staging/quarantine-ns-*`)을 보존하고 executor를 막는다(158-162). 이 디렉터리는 자식 프로세스가 쓰므로, 재시작 뒤에도 조용해졌다는 증명이 없으면 지우지 않는다(P0V-05 수정의 제외 범위).

#### src/git/context.ts (212), git/context-repository.ts (265), git/context-mirror.ts (63), git/context-publication.ts (37)
- **부합:** 복구는 새 candidate를 준비하지 않는다(1-3). 준비 staging은 native 명령이 조용해졌는지까지 보고 정리한다(128-130, context-repository.ts:113-118). 준비가 불확실하면 정리하지 않는다(context-repository.ts:180-181). 없어진 immutable revision은 조용히 다시 만들지 않는다(context-mirror.ts:22-25).
- **P0V-05 제외 범위:** `staging/context/<op>/commit-work`는 git 자식 프로세스가 쓴다. crash 뒤에는 조용해졌다는 증명이 없으므로 보존한다.

### F. lifecycle·unit

#### src/lifecycle/create.ts (255), lifecycle/policy.ts (44), lifecycle/contracts.ts (23), src/lifecycle.ts (39)
- **위반 P0V-10:** `finishAccepted`의 `assertCurrent`(216-227)는 auth가 있을 때만(=live 경로) 정책을 다시 풀고, 다르면 POLICY_CHANGED다. 이 오류는 accepted failure로 나가지만 operation은 pending으로 남는다(163-165). 뒤에 `reconcile`(168-173)이 auth 없이 같은 plan을 끝까지 만든다. 결과는 바뀌지 않고, 호출자만 실패를 본다. accept 때 권한과 정책은 접수 transaction 안에서 다시 검사한다(112-115, 135-137, CREATE-003). accept 뒤의 사실은 고정 spec이다(LIFE-008).
- **위반 P0V-09(증상):** 위 accepted failure는 `acceptedFailure`(165)의 기본 effect knowledge "possible"로 retry same-key가 되지만, CLI exit은 POLICY_CHANGED의 cliExit 2다.
- **부합:** 대상 agent의 identity(specHash·incarnation)는 준비 동안 바뀌지 않았는지 본다(216-219). 관계 검사이므로 옳다. 연결된(linked) create는 원래 operation의 terminal을 따른다(175-191).

#### src/lifecycle/actions.ts (156), lifecycle/registry-operations.ts (59)
- **부합(P0-5):** 과거 intent는 나중의 desired·incarnation으로 새 효과를 얻지 않는다. 물리 증거가 없으면 failed가 아니라 unknown이다(12-17, 138-155). stop은 사망이 확인되지 않으면 unknown이다(104-106, 129-131). 재시도 경로는 과거 plan의 `previousIncarnation`을 쓴다(85).

#### src/lifecycle/workspace.ts (108), lifecycle/create-publication.ts (61)
- **부합:** readiness는 provisioning을 벗어날 때 한 번 증명되는 사실이고, 그 뒤에는 현재 workspace에서 다시 유도하지 않는다(INV03, 43-48, create-publication.ts:136-147). clone 준비의 결과가 불명확하면 REF_STATE_UNKNOWN이고 executor를 막는다(29, 55).

#### src/units.ts (302), units/{execute,observe,render}.ts
- **위반 P0V-11:** `run`(67-74)은 `outcome.kind === "unknown"`을 UNSUPPORTED_PROFILE로 던진다. `install`의 `link`(82-84)는 unknown을 INTERNAL_ERROR로, `assertUserManagerReachable`(38-42)은 succeeded가 아닌 모든 결과(unknown 포함)를 UNSUPPORTED_PROFILE로 둔다. spec 오류 표에서 UNSUPPORTED_PROFILE은 "플랫폼/검증 gate 미충족"이고, 끝나지 않은 명령은 DEADLINE_EXCEEDED("일시 경합/연결/기다림 종료", same-key)의 범주다.
- **부합(P0-5):** 관측이 불완전하면 unknownObservation이고(observe.ts:1-40), 사망 증명은 incarnation 결박과 두 번의 같은 관측을 요구한다(266-285). 비활성 관측을 사망 증명으로 쓰지 않는다(215-224). 시작 결과는 관측으로 판정한다(170-174).

#### src/runtime/provision.ts (396), runtime/resident-rootfs.ts (225), src/sandbox.ts (225)
- **부합:** 만들기만 하고, 있는 것을 고치는 일(`repairSociety`)은 society lease를 가진 뒤에만 한다(18-22, 272-282, 현재 권한). 경쟁에서 진 시작은 이긴 쪽의 결과를 받아들인다. git이 끝까지 실행되어 nonzero로 답한 것을 "관측할 수 없음(STORE_CORRUPT)"으로 적는 것은 관측 결과다. 끝나지 않은 git은 `runGitText`가 DEADLINE_EXCEEDED/INTERNAL_ERROR로 따로 던진다(process/policies.ts:14-20).
- **부합:** receipt 디렉터리(`agents/<a>/runner/receipts`, domain/derived.ts:78-80)는 sandbox에 mount되지 않는다(sandbox.ts:105-113). receipt를 쓰는 것은 신뢰 코드뿐이다. 모델이 쓸 수 있는 session 디렉터리는 receipt 검증에서 "경로가 실제로 있는가"로만 쓴다(delivery-receipt.ts:125-152).

### G. 설정

#### src/config.ts (236), config/defaults.ts (158)
- **부합:** 설정 검증의 owner는 `validateConfig` 하나다(150-236). 결과는 깊게 얼린 snapshot이고 brand는 이 경계만 준다(50-97).

#### src/config/generations.ts (440)
- **부합(P0-3의 모델):** 관리형 편집은 전체 후보를 검증한 뒤 immutable generation을 쓴다. 그다음 manifest 임시 파일을 production loader로 다시 읽어 후보와 같다는 것을 증명하고(`assertReproduces`, 251-269), 기대 버전을 다시 확인한 뒤(`assertCurrent`, 321), manifest를 rename한다(commit point). rename 뒤 flush가 실패하면 "게시됐지만 영속성 불명"으로 보고하고 다음 편집 전에 다시 flush한다(332-339, CONFIG-CONTRACT의 outcome-unconfirmed). 수집은 quiescent일 때만 하고, journal을 믿을 수 없으면 generation을 지우지 않는다(385-440, INV02).
- 경계: `assertCurrent`(162-173)는 파일을 다시 읽지 못한 경우도 POLICY_CHANGED("changed since it was read")로 둔다. commit 전 거절이고 아무것도 기록하지 않으므로, 결과는 "이번 편집은 하지 않음"으로 같다. 문구만 부정확하다. P0V-12 수정 때 같은 owner에서 함께 정리한다.

#### src/tui/sources/settings.ts (355)
- **위반 P0V-12:** inline 경로 `writeValidatedSettings`(170-177)는 기대 버전 확인도 loader 재현 증명도 없이 `replaceDerivedFile`로 교체한다. `commitField`(337-355)의 inline "unchanged" 판정(346-348)은 `integration` 전체를 빼고 비교하고, 관리형 판정(193-196)은 `policyRevision`만 뺀다.
- **부합:** 필드 하나를 바꿀 때도 전체 설정을 변환한 뒤 전체를 검증한다(344). 부분 쓰기는 없다. descriptor 하나가 입력·변환·적용 시점·거절 사유를 모두 가진다(213-325, CONFIG-CONTRACT "Edit descriptor의 닫힌 집합").

#### src/config/operations.ts (424), config/policy.ts (52)
- **위반 P0V-08(일부):** `readSource`(372-424)는 StoreError가 아닌 모든 실패(I/O 포함)를 INVALID_REQUEST("config unreadable")로 싼다. 읽지 못한 것과 내용이 틀린 것이 같은 코드가 된다.
- **부합:** 자식 정책 resolver는 refresh에 실패하면 이전 snapshot으로 허가하지 않는다(40-46). 접수 transaction 안에서 revision을 다시 비교한다(lifecycle/policy.ts:97-99).

### H. runtime·process

#### src/runtime/society-lease.ts (228), runtime/process-lock.ts (70), runtime/host-tenure.ts (177), runtime/supervision-channel.ts (91)
- **부합(P0-5, INV02):** "다른 주인이 있음"과 "평가할 수 없음"을 다른 답으로 둔다(process-lock.ts:24-39, society-lease.ts:105-131). 권한은 kernel fence(열린 file description)에 걸려 있어 호출 순서가 아닌 죽음이 넘김의 조건이다. host의 등록 권한은 broker generation으로 나누어, 늦게 온 답은 아무것도 바꾸지 않는다(host-tenure.ts:113-117).
- 사실(P0V-05 수정의 근거): broker lock descriptor는 preparation 자식에게 넘어가지 않는다(process/async.ts:31-45). 그러니 broker crash 뒤에 자식(git, quarantine)이 조용해졌다는 것은 다음 broker의 lock으로 증명되지 않는다. 자식이 쓰던 staging은 재시작 뒤에도 보존해야 한다.

#### src/runtime/broker-lifetime.ts (88), runtime/broker-supervisor.ts (330)
- **부합:** 시작 순서는 recover → listen → notify → activate다(63-68). 복구 단계에는 처리 중인 요청이 없다. 끝나지 않은 native 준비가 있으면 grace 안에 끝나야 하고, 아니면 writer 자원을 쥔 채 프로세스 종료에 맡긴다(15-30). broker 재시작은 자식 종료라는 확정 사실에 근거하고, 횟수를 제한한다.

#### src/runtime/pi-adapter.ts (275), runtime/pi-rpc.ts (294)
- **부합(P0-5):** 네 개의 deadline이 네 가지 뜻을 가진다(165-179). boundary를 받은 뒤에도 엔진이 끝나지 않으면 receipt를 쓰지 않는다(252-266). 제시했지만 turn이 끝났는지 모르는 batch는 재전달 정책(D01, DR6)으로 간다.
- **위반 P0V-13:** 엔진 종료는 write가 커널에 넘어갔다는 증거일 뿐, 디스크에 있다는 증거가 아니다. Principal 경로(principal-delivery.ts:231-236)는 엔진이 끝나지 않으므로 그 증거조차 없이 receipt를 게시한다. 두 경로 모두 session 파일을 fsync하지 않고 entry의 존재를 확인하지 않는다.

#### src/runtime/inference-relay.ts (457), runtime/{pi-runtime,pi-spawn-plan,engine-auth,extension-integrity,assets,deployment-manifest}.ts
- durable fact를 만들지 않는다. relay는 한 delivery 동안의 전송 proxy이고, usage를 기록하지 않는다. `usage` 표는 제품 코드에서 예약·정산하는 곳이 없다(ledger API와 시험만 있음). spawn 전 무결성 검사(extension digest, deployment digest)는 현재 권한 검사다(INV06).

#### src/process/{async,run,command,preparation,policies}.ts
- **부합(P0-5):** 프로세스 관측은 exited/signalled/timed-out/output-limited/unobserved로 닫혀 있다(run.ts:27, async.ts:115). 직접 자식의 종료를 자손 전체의 사망 증명으로 쓰지 않는다(preparation.ts:18-20). 준비 결과가 불명확하면 executor는 재시작 때까지 막힌다(sticky, 5-16, 44). `runGitText`는 끝나지 않은 git을 DEADLINE_EXCEEDED/INTERNAL_ERROR로 던진다(policies.ts:14-20).

### I. domain·protocol

#### src/domain/child-policy.ts (41), src/authority.ts (54), domain/capabilities.ts (40)
- **부합(P0-6):** `code.integrate`를 host가 직접 준다는 특수처리는 DR4의 `HOST_GRANTED` 한 곳에, 이름을 가진 개념으로 있다(19-22, 34-36). 같은 종류의 두 번째 분기는 없다(`"code.integrate"`를 직접 다루는 곳은 method 표 protocol/methods.ts:212, 통합의 효과 시점 검사 git/integration.ts:103,109, Config 화면 descriptor tui/sources/settings.ts:306-323뿐이다).
- **부합(P0-1, INV06):** 권한은 효과 결정 시점에 row와 live lease 양쪽에서 다시 읽는다(authority.ts:77-85). 손상은 빈 권한 집합이 아니다(62-65).

#### src/domain/persisted-formats.ts (128)
- **설계 충돌(P0V-01 수정 전 기록 필요):** "읽을 수 있는 schema 버전은 1뿐, 밖이면 fail closed, migration 없음, v1→v2 upgrade 경로 없음"(49-57, P8). DeliveryAttemptIdentity를 schema에 두려면 이 규칙과 D01("새 DB table/column을 먼저 만들지 않는다")을 설계 수정으로 바꿔야 한다(PRIORITY-0 "원칙 자체도 공격적으로 검증한다", D01 "결정 변경을 기록한다").
- **부합:** host 경로를 담은 plan field는 "옮길 수 없음"으로 분류하고 보고만 한다(59-65, 123-156). state root 이동을 지원하지 않는다는 전제의 근거다(A묶음 durable.ts 항목).

#### src/domain/admission.ts (38), domain/errors.ts (220)
- **부합:** 손상을 본 뒤에는 새 accept만 막고, 읽기와 이미 accept된 정산은 막지 않는다(3-18, INV08). 오류 분류는 code·phase·effect knowledge·관측 종류를 함께 본다(errors.ts:97-120, MAINTENANCE §11).
- **위반 P0V-09:** `errorExit`(220)는 code만 본다. `publicFailure`가 계산한 retry 분류(143-156)와 따로 논다.

#### src/domain/{lineage,request-identity,derived,context-policy,tool-surface,resources,limits,integer-fields,identifiers,mail-values,spec-identity,deployment,canonical-json,exhaustive}.ts
- 순수 정의다. 현재 상태(시계, 환경, 파일, store)를 읽지 않는다. 파생 이름(derived.ts)은 identity에서만 나오므로, crash 뒤 이름으로 owner operation을 찾는 근거가 된다(P0V-05).

#### src/protocol/*.ts
- **부합:** 요청 cache의 receipt 대체 순서는 terminal을 퇴행시키지 않고, 두 terminal이 다르면 contradiction이다(receipt-codec.ts:72-76, INV03). 저장된 payload는 구조 한도로 읽는다(request-codec.ts:11-18). run lease는 전송 identity일 뿐 생존 증명이 아니다(run-lease.ts:52-54). 나머지(channel, host-channel, jsonl, byte-queue, log-response, status-view, batch-view, response-codec, operation-results, principal-credential, methods)는 형식과 전송이고 durable fact를 해석하지 않는다.

### J. 경계·표시

#### src/extension/cli-process.ts (145), extension/mail-tools.ts (362), extension/principal-tools.ts (150), extension/shared.ts (28)
- **위반 P0V-14:** `runCliProcess`는 signal로 끝난 CLI를 `code ?? 1`로 1로 만든다(131-132). 도구의 `runCli`(mail-tools.ts:204-215)는 0이 아니면 stderr·stdout 또는 "CLI exited N"을 오류로 던진다. CLI가 스스로 끝나면 결과 불명 안내와 key를 출력하지만(cli/exit.ts:38-45), 도구가 CLI를 죽인 경우(120초 timeout, 모델 turn의 abort)에는 아무것도 출력되지 않는다. key는 성공 결과에만 있다(principal-tools.ts:81,98,114,136, mail-tools.ts:302-308).
- **부합:** 환경을 명시한 것만 넘기고, 자격 증명은 전용 descriptor로 준다. CLI는 society lease를 물려받아 host보다 오래 살 수 없다(1-40).

#### src/extension/workspace-guard.ts (111)
- **위반 P0V-15:** 38-57. 경로 검사 `allowedWorkspacePath`(22-37)는 관측 실패를 거절로 둔다. 부합한다.

#### src/extension/{delivery,batch-view,principal-channel,inference-bridge,tool-surface}.ts, src/pi-extension.ts
- **부합:** boundary는 turn이 `stop`으로 끝났을 때만 생긴다(delivery.ts:72-99, C묶음 참고). batch view의 decoder는 닫힌 형식이다. 자격 증명 선은 형식이 맞지 않으면 버린다.

#### src/tui/session.ts (543), tui/{app,keys,model,prompt,screen,transcript,transport,limits,dashboard,exit}.ts, tui/view/*, tui/sources/{mail,extensions}.ts
- **정정(2차 점검):** 아래 "부합"은 tui/exit.ts에는 맞지 않는다. exit 판정이 CLI와 따로 있고 불명을 2로 보고한다(P0V-18).
- **부합(P0-5):** 부분 쓰기 뒤의 명령 수락은 unknown으로 두고, 쓰지 않은 것이 증명될 때만 claim을 돌려준다(session.ts:442-448, 478-499). 화면은 관측과 저장 결과를 표시만 한다. 확장 토글은 관리형 generation으로만 쓴다(extensions.ts:185).
- **위반 P0V-12의 증상:** `entry/oma.ts:270-278`의 `saved-unread`.

#### src/views.ts (118), views/{pending-work,status-refresh}.ts
- **부합(INV11):** 게시하는 view는 파생물이고 권한이 아니다. 관측하지 못한 unit은 unknown이고(pending-work.ts:100-107), 시간 안에 답하지 않은 관측은 unknown snapshot이다(status-refresh.ts:45-62).

#### src/diagnostics/{integrity,files,ledger,mail}.ts
- **부합:** 읽기 전용이다. 효과를 허가하지 않고, operation을 올리지 않고, 사망을 증명하지 않는다(integrity.ts:24-26). 관측 실패는 unknown이다(34-37). accept 전 고아 메일 원문은 "unknown"으로 보고하고 고치지 않는다(86). P0V-05를 고친 뒤에도 실행 중에 보이는 accept 전 원문은 unknown이 맞다(처리 중인 요청일 수 있다).

#### src/entry/{oma,broker,runner,host,module-conformance}.ts, src/{leaf,frame,hash,cli,module-ports,rpc-client}.ts, src/ports/*, src/cli/commands/*
- **위반 P0V-08(일부):** entry/broker.ts:154-158과 165-169는 같은 "설정을 읽고 society를 확인하는" reader를 두 번 쓴다.
- **부합:** runner는 실패하면 exit 2로 끝나 systemd 재시작(새 시도)에 맡긴다(entry/runner.ts:84-100). 나머지는 조립·명령 해석·native helper다.

## 발견의 분류

같은 원칙을 어긴 서로 다른 모습으로 묶는다(PRIORITY-0 명제).

| 모습 | ID | 공통 원인 |
|---|---|---|
| 과거 사실을 현재 권한의 값으로 다시 씀 | P0V-01, P0V-02, P0V-03, P0V-04 | 전달 시도·고정 spec이라는 사실과 lease·권한이 같은 칸이나 같은 API에 있음 |
| 한 결정에 owner가 여럿 | P0V-06, P0V-07, P0V-12, P0V-08(reader 두 벌), P0V-11(unknown 코드 셋), P0V-18(exit 판정 두 벌) | 같은 판정을 호출자마다 다시 씀 |
| unknown을 사실로 승격 | P0V-08, P0V-09, P0V-11, P0V-14, P0V-15, P0V-18, P0V-19, P0V-20, P0V-21, P0V-22, P0V-23, P0V-24(확장 토글) |
| 관측을 현재 사실처럼 표시 | P0V-24 | 낡은 snapshot을 거절 뒤에도 현재 값으로 둠(INV11) | 관측 실패·결과 불명에 확정 사실의 코드나 값을 붙임 |
| accept 전 artifact의 owner가 crash에서 사라짐 | P0V-05, P0V-17(나) | owner 기록이 메모리에만 있음 |
| 나중의 설정이 접수된 사실을 다시 해석 | P0V-10, P0V-08 | accept 뒤 효과 시점 검사와 사실의 재해석을 구분하지 않음 |
| durable fact가 durable하지 않은 근거를 가리킴 | P0V-13 | receipt와 session entry의 영속 단위가 다름(INV07) |
| durable 경계에 시험·호출자가 없음 | P0V-16, P0V-17(가)(다) | 경계 목록이 코드에서 나오지 않음 |

## P0-7 점검: 시험이 durable 경계를 덮는가

- 있는 것: 파일 primitive의 fault seam(storage/durable-fs.ts:14-49)과 그것을 쓰는 matrix(test/durable-fault-matrix.test.ts), 경계 이름별 SIGKILL 시험(test/crash-boundaries.test.ts: 메일 8지점, submit/integrate/context 14지점, bootstrap/create 7지점, ENOSPC/EIO 4지점), 전달 증거 모델(test/delivery-state-model.test.ts V30A), rollover 정산(test/rollover-settlement.test.ts), 설정 generation fault(test/config-generations.test.ts). crash·fault를 다루는 시험 파일은 70개다.
- **위반 P0V-16(P0-7):** 경계 목록이 코드에서 나오지 않는다. 시험마다 지점 이름을 손으로 적은 배열이 있고, 새 durable 경계(`store.transaction`, 파일 게시, CAS, 설정 commit, receipt 게시)가 생겨도 그것을 덮는 시험이 있는지 묻는 장치가 없다. 이번 점검에서 바뀌는 경계(run open, receipt 게시, accept 전 수집, inline 설정 commit)도 kill·restart 시험이 없거나 옛 의미로 적혀 있다(V30A의 "late receipt → conflicting").

## 수정 계획

설계 판단은 [design-revisions.md](design-revisions.md)의 DR9–DR13에 적고, 코드는 그 결정에서 도출한다. 발견마다 negative control 시험을 둔다.

| 순서 | 수정 | 발견 | 근거 원칙 |
|---|---|---|---|
| 1 | `updateAgent`는 desired와 **증가하는** incarnation만 쓴다. 고정 spec을 다시 쓰는 경로를 없앤다. 시험의 "권한 폐기"는 처음부터 권한이 없는 spec이나 lease 쪽 권한으로 만든다 | P0V-03, P0V-04 | P0-1, LIFE-008 |
| 2 | DR9: `batches.incarnation`은 첫 전달 시도로 고정. rollover는 batch를 바꾸지 않는다. receipt의 시도는 `첫 시도 ≤ N ≤ 현재 lease`로 검증하고, 정산은 현재 lease가 아니라 그 구간과 증거에 묶는다 | P0V-01, P0V-02 | P0-1, INV01, INV08 |
| 3 | receipt 관측 → 행동(제시/정산/보류)의 판정을 `storage/delivery-receipt.ts` 한 함수가 소유하고, broker·runner·Principal은 그것을 부른다 | P0V-06 | P0-2, D01 판정표 |
| 4 | DR11: receipt는 그 session entry가 파일에 있고 fsync된 뒤에만 게시한다(게시 owner 한 곳) | P0V-13 | P0-1, INV07, BATCH-006 "durable session file" |
| 5 | DR10: broker 시작 복구(요청 수락 전)에서 broker 자신이 쓴 accept 전 artifact를 이름→operation으로 판정해 정리한다. 자식 프로세스가 쓰던 staging은 보존한다 | P0V-05 | P0-4, P0-5 |
| 6 | 동기 fsck를 없애고 관측 owner를 하나로 둔다 | P0V-07 | P0-2 |
| 7 | DR13: host 정책 reader를 하나로 두고, 현재 정책을 얻지 못하면 BROKER_UNAVAILABLE(accept된 통합은 pending 유지)이다. 읽을 수 있고 다른 정책만 POLICY_CHANGED다 | P0V-08 | P0-5, P0-2 |
| 8 | DR13: CLI exit은 retry 분류에서 도출한다(same-key/after-repair → 3) | P0V-09 | P0-5, CLI-003 |
| 9 | accept된 create의 live 경로에서 accept 뒤 정책 재해석을 없앤다. 요청자의 현재 권한 재확인(unit 설치 직전, INV06)은 과거 사실의 재해석이 아니라 새 효과 앞의 권한 검사이므로 남긴다(`7e2559f`: 첫 수정이 둘을 함께 지웠고 R37이 잡았다) | P0V-10 | P0-1, P0-3, CREATE-003, INV06 |
| 10 | DR13: unit 명령의 unknown은 한 곳에서 DEADLINE_EXCEEDED로 둔다 | P0V-11 | P0-5, P0-2 |
| 11 | DR12: inline·bundle 설정 commit을 한 owner로 모은다(기대 버전 확인, loader 재현 증명, 결과 불명 기록, 하나의 unchanged 판정) | P0V-12 | P0-3, D02, CONFIG-CONTRACT |
| 12 | DR13: 도구가 끝낸 CLI는 결과 불명이고, 실패 문구에 request key를 싣는다 | P0V-14 | P0-5 |
| 13 | workspace 크기 관측 실패는 거절이다 | P0V-15 | P0-5 |
| 14 | durable 경계 목록을 코드에서 뽑고 경계마다 kill·restart 시험을 요구하는 gate를 둔다. 바뀐 경계의 시험을 새로 쓴다 | P0V-16 | P0-7, INV12 |
| 15 | spec·traceability·결정 기록을 갱신하고 전체 검증으로 결박한다 | 전체 | PRIORITY-0 적용 절차 5 |

순서 1–14는 끝났다(상태 열의 commit). 순서 15의 규범·traceability 갱신은 `1b3827c`이고, 결박은 [validation.md](validation.md)의 현재 판정이 한다.

## 2차 점검

1차 점검은 여러 파일을 한 항목으로 묶어 판정한 곳이 있었다. 그 묶음에서 P0V-18을 놓쳤고, G묶음에 적은 후속 수정 하나(P0V-12 보완)와 P0V-08의 loader 부분(P0V-19)을 빠뜨렸다. 그래서 판정 질문 하나를 모든 production 파일에 다시 물었다. **P0-5: 관측 실패나 결과 불명을 받는 자리가 그것을 확정 사실의 코드·값(바뀜·잘못됨·손상·지원 안 함·없음·0)으로 바꾸는가.** 받는 자리는 `catch`와 실패를 삼키는 API(`existsSync`)다.

기준점: `7b6c462`. 215개 파일 가운데 catch가 있는 107개 파일의 359곳과 `existsSync` 13곳을 파일 순서대로 앞뒤 맥락과 함께 읽었다(2026-09-25). 줄 번호는 기준점의 번호다.

판정 약어:
- **정리**: 정리·close·보고의 실패. 주 효과의 의미는 바꾸지 않는다.
- **재던짐**: 관측한 뒤 그대로 올리거나 accepted failure로 싼다.
- **관측종류**: absent·unavailable·unknown·corrupt 가운데 하나로 돌려준다. ENOENT만 absent다.
- **내용**: 읽은 bytes를 거절한다. 입력이면 INVALID_REQUEST, accept된 증거면 STORE_CORRUPT, 파생물이면 null이다.
- **불명유지**: 결과를 모르면 pending·unconfirmed·exit 3으로 둔다.
- **거절**: 권한이나 생존을 관측하지 못하면 권한을 주지 않는다. 그것을 사망 증명으로 쓰지도 않는다.

### 새 발견

| ID | 규칙 | 파일:줄 | 요약 |
|---|---|---|---|
| P0V-19 | P0-5 | config/operations.ts:352,417 | loader가 읽지 못한 것(EACCES·EIO)과 내용이 틀린 것을 같은 INVALID_REQUEST(확정, exit 2)로 쌌다. P0V-08 기록에 "loader도 I/O 실패를 INVALID_REQUEST로 싼다"고 적었으나, `f2ff92a`는 broker reader만 고쳤다 |
| P0V-20 | P0-5 | storage/directory.ts:23,47; store.ts:217,331; runtime/resident-rootfs.ts:137; runtime/provision.ts:103,345,319,403 | 열지 못한 디렉터리·파일과 실행되지 못한 ledger 조회를 STORE_CORRUPT("종류가 다름", "손상")로 올렸다. broker의 `AdmissionGate`(domain/admission.ts:9-11)는 STORE_CORRUPT를 한 번 보면 프로세스가 끝날 때까지 새 수락을 모두 막는다. 그래서 일시적인 EACCES·EIO 하나가 society를 멈춘다. 바인딩을 지금 읽지 못한 것은 "읽을 수 없는 바인딩"으로, 경쟁에서 진 뒤 읽지 못한 것은 "다른 바인딩이 게시됨"(POLICY_CHANGED)으로 보고했다 |
| P0V-21 | P0-5 | runtime/assets.ts:50; runtime/deployment-manifest.ts:131; runtime/extension-integrity.ts:51; runtime/pi-adapter.ts:118; runtime/pi-runtime.ts:49,62 | host 배치·배포 목록·extension·Pi 경로를 관측하지 못한 것을 UNSUPPORTED_PROFILE("지원하지 않음", exit 4)로 보고했다. P0V-11과 같은 모습이다 |
| P0V-22 | P0-5 | config/generations.ts:182; tui/sources/extensions.ts:65,70; tui/sources/mail.ts:92 | 목록을 얻지 못한 것을 비었다고 셌다. generation 예산은 0 byte·0개로, extension 후보 목록은 빠짐으로, 메일 목록·unread 수는 메시지 없음으로 셌다. P0V-15와 같은 모습이다 |
| P0V-23 | P0-5 | tui/app.ts:207, tui/view/notice.ts:20 | commit point를 지났고 flush만 실패한 설정 저장(CONFIG-CONTRACT outcome-unconfirmed)을 "저장하지 못했습니다"로 표시했다 |

**모델로 다시 본다(P0-6).** P0V-19–P0V-22는 DR13이 경계마다 적은 규칙과 같은 모습이다. 스무 곳 넘게 다시 나왔으므로 경계별 규칙이 모델을 대신하지 못한다고 판단했다. 그래서 규칙을 하나로 바꾼다(DR13 "일반 규칙"). 관측이 답하지 않은 errno는 모름이고, `unobserved`(domain/errors.ts) 한 함수가 그것을 BROKER_UNAVAILABLE로 읽는다. 답한 errno(ENOENT·ENOTDIR·ELOOP·EISDIR·ENAMETOOLONG)와 읽은 내용의 뜻만 호출자가 사실로 말한다. P0V-23의 "게시됨·영속성 불명"도 `publishedUnconfirmed` 한 함수가 읽는다.

### 파일별 판정

| 파일 | catch 줄 | 판정 |
|---|---|---|
| broker.ts | 157,169,172,233,243,263,290,308,309,326,327,340,341,357,365,384,453,454,487,494,500,511,513 | 정리·재던짐. 243은 admission이 닫혔으면 sweep을 건너뛴다(거절). 453-454는 run 게시 실패 뒤 record를 revoke한다. 이미 커밋된 lease 증가는 그대로 사실이다 |
| broker/connection.ts | 78,94,95,145,154,165,184,203,230,234,245,246,247,263 | 정리·재던짐. 연결 종료는 task가 가진 accept된 작업을 지우지 않는다 |
| broker/internal-dispatcher.ts, public-dispatcher.ts | 244; 119,134,198 | 재던짐(`failureAnswer`). 119: 거절된 자원 admission은 이미 accept된 same-key 조회만 허용한다 |
| broker/peer-authenticator.ts, peer-pin.ts | 21,40; 22 | 거절. 관측하지 못한 peer·pidfd는 권한이 없다. 사망 증명으로 쓰지 않는다 |
| broker/principal-endpoint.ts | 136,141,164,171,185 | 재던짐·정리 |
| broker/process-ancestry.ts | 44 | 관측종류(ENOENT·ESRCH만 exited, 나머지 unavailable) |
| broker/transport-spool.ts | 42,94,98,103,104 | 정리 |
| cli.ts, cli/commands/{logs,status}.ts | 41; 25; 12 | 불명유지(단계를 모르는 실패와 전송 실패는 exit 3) |
| cli/cache-codec.ts | 32,39 | 내용(corrupt cache는 재전송하지 않는다) |
| cli/effects.ts, cli/effects/mail.ts | 19,46; 20 | 내용. 보내기 전 로컬 입력의 거절이라 이 호출의 결과(보내지 않음)는 확정이다(exit 2) |
| cli/request-service.ts | 51,100,114,134 | 불명유지(114,134는 "미접수 여부 불명확", exit 3) |
| cli/transport.ts | 83,95 | 거절(credential 없음은 AUTH_FAILED, 보내기 전) |
| config.ts | 158 | DR13(현재 정책을 얻지 못함은 BROKER_UNAVAILABLE) |
| config/generations.ts | 168,182,204,289,330,333,338,366,397,402,403,407,454,492 | 168: P0V-12 보완(`7b6c462`). **182: P0V-22.** 204: 읽지 못한 generation은 "다른 bytes"가 아니라 그대로 올린다(INV02). 289·366: 영속성 불명 기록을 먼저 flush한다. 330-338·397-410: commit point 전에는 정리, 뒤에는 불명유지. 454: journal 기록이 실패해도 commit은 선다. journal을 믿을 수 없으면 수집하지 않는다(492) |
| config/operations.ts | 236,352,417 | 236: 관측하지 못한 extension asset은 refused(쓰지 않음). **352·417: P0V-19** |
| diagnostics/{files,integrity,ledger}.ts | 44,73,116,119,130,164; 36,103; 110 | 관측종류(unknown과 corrupt를 나눈다) |
| domain/{context-policy,resources}.ts | 98,104; 46 | 내용 |
| entry/broker.ts, host.ts, runner.ts | 46,58,202,206; 19,32; 34 | 재던짐. 시작 실패는 systemd가 새 시도로 다시 한다. 58: cgroup을 읽지 못하면 unit 이름이 없다(권한 없음) |
| entry/oma.ts | 51,83,111,115,165,174,203,205,212,275,454,527 | P0V-18(`7b6c462`)로 exit을 `codeFor`에서 얻는다. 51·174: 설정 파일을 만들 때는 no-replace라 모름이 덮어쓰기가 되지 않는다. 212: 수집 실패는 역사를 남길 뿐이다. 275: 다시 읽기 실패는 saved-unread다(저장은 사실) |
| extension/{batch-view,cli-process,mail-tools,principal-channel,tool-surface}.ts | 147,187; 61; 87; 47; 40,110,136,151 | 내용·거절. 채널이 없으면 열지 않는다 |
| extension/workspace-guard.ts | 34,49,58,71 | 34: 경계 안임을 증명하지 못하면 밖이다(거절). 49·58: P0V-15(`8f7700a`). 71: 관측하지 못한 기존 파일은 새 파일로 쳐서 증가분을 크게 잡는다(보수적) |
| frame.ts, protocol/{batch-view,receipt-codec,status-view,jsonl}.ts | 29,57,67,97,129,143,187; 96; 23; 55; 35,45 | 내용. jsonl 35: Pi RPC의 형식 위반은 그 출력의 사실이고, 전달 결과는 receipt가 따로 판정한다 |
| protocol/channel.ts | 59,80,147,172 | 불명유지(연결 실패는 unavailable) |
| git/{context-repository,observe,quarantine}.ts | 41; 31,54; 102 | 내용·불명유지(끝까지 실행된 Git의 출력만 사실, UTF-8이 아니면 손상 또는 REF_STATE_UNKNOWN) |
| git/{context,integration,submit}.ts | 98,165,185,210; 66,76,202,245; 83,125,132,157,180 | 재던짐(accept 뒤는 effect knowledge와 함께 accepted failure). integration 66·76: DR13 |
| leaf.ts | 76,91,149,174,210,249,291,315,375,395 | 관측종류·거절(native 호출 실패는 failed·unknown·unreadable. 395는 native 모듈이 없음, 곧 지원하지 않는 host) |
| lifecycle/{actions,create,workspace}.ts | 64,67,106,110,132; 92,160,165; 31 | 불명유지(unit 효과를 모르면 unconfirmed, accept 뒤는 accepted failure, workspace Git 출력이 이상하면 REF_STATE_UNKNOWN) |
| mail.ts, mail/{batches,display,headers,materializer,reconcile}.ts | 106,114,119,163,164,168; 104,195; 33; 52,72,87; 49; 44 | 114: materialize를 끝내지 못하면 pending으로 남는다(불명유지). batches 104: BATCH_CONFLICT면 이번에는 준비하지 않는다(rollback, 기록 없음). 나머지는 내용·정리 |
| process/{async,policies,run}.ts | 46,84,87,121; 19; 45 | 관측종류(spawn-failed·unobserved·INTERNAL_ERROR exit 3) |
| reconcile.ts, reconcile/{operations,preaccept}.ts | 75,114,125,166,211; 73,76,94; 34 | 불명유지(진전이 없으면 다음 timer, 손상만 fence) |
| request-cache.ts | 72,77,90,91,111,154,164,187,228,248,282 | 관측종류(absent·present·corrupt·unavailable) |
| runtime/assets.ts, deployment-manifest.ts, extension-integrity.ts, pi-adapter.ts, pi-runtime.ts | 50; 131; 51; 39,69,118; 49,62 | **P0V-21.** pi-adapter 39·69는 정리·내용이다 |
| runtime/{broker-supervisor,host-tenure,society-lease,supervision-channel,process-lock}.ts | 193,315; 153,174; 142; 38; 43 | 정리·거절 |
| runtime/inference-relay.ts | 89,141,317 | 내용(설정의 URL, 경로 밖이면 403) |
| runtime/pi-rpc.ts | 147,166,204,240,286 | 재던짐·정리(204: 인코딩할 수 없는 명령은 쓰지 않았음이 확정이다) |
| runtime/principal-delivery.ts | 149 | 불명유지(session 경쟁에서 진 것은 실패가 아니다) |
| runtime/provision.ts | 103,156,313,319,335,345,385,403 | **103·345·319·403: P0V-20.** 156: 진 경쟁만 채택하고 나머지는 올린다. 313·385: ENOENT만 없음 |
| runtime/resident-rootfs.ts | 90,124,137,159 | **137: P0V-20.** 90: 답한 "디렉터리 아님"은 손상이다. 124·159는 진 경쟁이다 |
| runtime/run-registry.ts | 53,57,71,75,138,159 | 관측종류(cgroup을 읽지 못하면 unknown, 사망 증명이 아니다) |
| storage/{context-files,context-stream}.ts | 42; 58,81,99,168,174,189 | 42: 답한 errno만 손상이고 나머지는 올린다. 나머지는 정리 |
| storage/delivery-receipt.ts | 120,154,264,267,273,282,342,428,441,449 | 관측종류(verified·absent·unavailable·conflicting, `deliveryDecision`) |
| storage/directory.ts | 23,44,47,63,89 | **23·47: P0V-20.** 44·63·89: EEXIST·ENOENT만 삼킨다 |
| storage/{durable-fs,immutable-file,staged-tree}.ts | 106,114,147,153,195,196; 92,103,157,185,205; 47,65,100 | 정리(자기가 만든 이름만 지운다). immutable-file 92·103: 관측종류 |
| storage/{operation-codec,operation-journal,operation-transitions,rows,paths}.ts | 110,210; 45; 30,46; 78; 87 | 내용(저장된 row의 형식 위반은 손상, key 재사용은 조회) |
| storage/preaccept-artifact.ts | 44,63,72,176,188,200,221 | 관측종류·불명유지(판정하지 못하면 outcome-unknown, 지우지 않음) |
| storage/{quota,submit-spool,transaction}.ts | 27,52,123; 59,64,88,92,129,136,149; 28,68 | 관측종류(관측하지 못한 root는 BROKER_UNAVAILABLE, bundle은 absent·corrupt·unavailable) |
| store.ts | 84,86,190,192,217,219,223,238,263,264,331 | **217·331: P0V-20.** 나머지는 정리·재던짐(`normalizeStorageFailure`) |
| tui/app.ts | 207 | **P0V-23** |
| tui/{screen,session,transport}.ts | 67; 417,445,485; 53 | 불명유지(쓰지 않았음이 증명될 때만 claim을 놓는다, status view는 ENOENT만 "관측 없음") |
| tui/sources/extensions.ts | 65,70,103,109 | **65·70: P0V-22.** 103·109: 읽지 못한 설정은 편집하지 않는다고 표시한다 |
| tui/sources/mail.ts | 92,101 | **92: P0V-22.** 101: 목록을 얻지 못한 디렉터리는 unreadable이다 |
| units.ts, units/execute.ts | 178,206,276,290,298; 31,48 | 불명유지(P0V-11 `57731b6`, cgroup을 읽지 못하면 RUN_TERMINATION_UNKNOWN·사망 미증명) |
| views.ts, views/status-refresh.ts | 102; 60 | 관측종류(관측 실패는 running·exit 0의 증명이 아니다) |

`existsSync` 13곳: broker.ts:175,223,276(소켓을 정리한 뒤 listen이 실패하면 오류), broker.ts:425(production은 ledger의 `hasCommittedContext`를 쓰고 이 대체값은 시험 조립용), cli/effects/context.ts:58(보내기 전 입력 거절), cli/transport.ts:18(연결 실패는 exit 3), entry/oma.ts:52,177(no-replace 생성이라 덮어쓰지 않음), extension/workspace-guard.ts:27(조상 탐색, 실제 쓰기는 같은 권한으로 실패), lifecycle/workspace.ts:84(clone 실패는 오류), runtime/provision.ts:142,240,249(no-replace rename과 이긴 쪽 채택, 관측 실패는 git이 답한다). 모두 **부합**이다. 모름이 사실로 기록되거나 덮어쓰기가 되는 경로가 없다.

## 실제 provider 점검(14차)

사용자 승인으로 v16 뒤의 빌드를 test society `provtest`(동봉 엔진 0.87.1, gpt-6-luna)에서 돌렸다. 기록은
`/home/dev/oma-evidence/provider/runs/run14-*`에 있다. 13차 state는 credential 없이 `archive/run13-state`에 보관했다.

| 확인 | 방법 | 결과 |
|---|---|---|
| DR10 | 시작 전에 죽은 broker가 남긴 것처럼 `staging/rpc-<uuid>.wire`와 `mail/objects/.<name>.<uuid>.tmp`를 넣었다 | 시작 수집 로그 `{"removed":2,"kept":0}`. 넣은 두 개만 지웠다. accept되어 성공한 operation의 staging 네 개(context 1, submit 3)는 보존했다 |
| DR9 | 두 Resident가 `sleep 120` 도구를 실행하는 중에 broker를 SIGKILL했다(Control Panel은 켜진 채, supervisor가 다시 띄움) | 준비된 batch 두 개가 다음 시도에서 완료됐다. builder `b-d1fcc137…`는 첫 시도 9·receipt 10, integrator `b-6554ccb3…`는 첫 시도 20·receipt 21이다. 두 batch 모두 행의 incarnation은 바뀌지 않았다. Principal에게 전달 중이던 batch도 재전달 알림과 함께 다시 들어와 완료됐다 |
| DR11 | 이번 회차에 완료된 batch 8개의 receipt가 가리키는 boundary entry를 session 파일에서 찾았다(읽기 전용 스크립트) | 8/8이 session 파일에 있고, 시도는 모두 구간 안이다. 문제 0 |
| DR6 알림 | Resident session의 알림 원문 | 두 Resident 모두 첫 줄이 "재전달: 이 batch는 이전에 준비되었지만 완료가 확인되지 않아 다시 전달됩니다…"이다. integrator가 "재개 알림을 못 봤다"고 보고한 것은 모델이 따로 된 알림을 찾은 판단이다 |
| DR13 | Principal 메일함의 메시지 한 통을 잠시 0000으로 두고 Mail 화면을 열었다 | "메일함 일부를 읽지 못함 (… cannot be observed now (EACCES))"를 밝히고 나머지 20통을 보여 줬다. 권한을 되돌렸다 |
| DR12 | Control Panel에서 Worker limit 7→6 | "저장됨 · 재시작 후"이고, 파일은 0600, 임시 파일은 없으며 loader가 6을 읽는다 |
| DR12 lost update | 화면이 읽은 뒤 운영자가 파일을 손으로 5로 바꾸고 화면에서 7로 편집했다 | "저장하지 못했습니다: configuration changed since it was read"이고, 파일은 5로 남았다. **이때 화면이 계속 6을 보여 주고 다음 편집도 거절돼 P0V-24를 찾았다** |

엔진이 중단된 도구 호출에 붙이는 "No result provided."를 모델은 결과 불명으로 다뤘다(작업을 이어서 끝냄). 이것은 엔진의 표현이다.

**검증 중 드러난 시험의 경쟁(v17 final).** v17 final의 durable lane에서 AV14 시험 하나가 실패했다(474/475). 단정은 통과했고, 뒷정리
`rmSync`가 ENOTEMPTY였다. 시험 helper가 엔진에 SIGTERM만 보내고 종료를 기다리지 않아서, 엔진이 아직 파일을 쓰는 동안 디렉터리를
지운 것이다. 신호를 죽음으로 본 것이니 INV02·P0-5를 시험 쪽에서 어긴 셈이다. helper가 종료를 확인한 뒤 돌아가게 고쳤다(5초 뒤
SIGKILL). 드문 경쟁이라 이전 코드에서 일부러 재현하지는 않았고, 원인은 코드를 읽어 확인했다. 같은 모습(살아 있으며 파일을 쓰는
자식을 죽이고 기다리지 않은 채 지움)은 다른 시험에 없다. 다른 `kill()`은 스스로 끝난 자식의 안전장치이거나, 파일을 쓰지 않는
lock holder다. v17 final은 이 실패에서 멈췄고 v18이 대체한다.

## 3차 점검: 문서와 식별자

기준점 `8cb0406`. 기준은 PRIORITY-0의 "문서와 식별자에도 같은 원칙"이다. commit된 문서의 문장과 식별자도 durable fact로 보고,
하위 규칙(식별자의 뜻 불변, 한 사실 한 owner, 규범 변경의 한 경로, 기록 위치의 보존, 모름을 사실로 올리지 않음)을 물었다.
문서 25개를 파일 순서로 읽었다. architecture.md와 계획 디렉터리는 읽기만 했다. 결정·점검 기록은 작성 시점이 밝혀져 있으므로,
당시 사실을 적은 문장은 고치지 않았다.

### 발견

| ID | 규칙 | 파일:줄(`8cb0406`) | 요약 |
|---|---|---|---|
| P0D-01 | 명제, P0-1 | implementation-spec.md:505,514,532,536 | 요구 ID INF-005와 INF-006이 각각 두 조항에 붙어 있다(relay / 비용 상한, relay socket / 성능 검증). 2026-09-19에 두 커밋이 같은 번호에 다른 조항을 붙였다. architecture.md:1016과 코드·시험 여덟 곳은 relay 뜻으로 인용한다 |
| P0D-02 | 명제, P0-1 | implementation/test-matrix.md:132-134,149-151 | 수용 번호 T115·T116·T117을 시험이 먼저 쓴 뜻(broker 감독, 봉인된 Resident의 provider 경로, 봉인. 8256269·34c8db3)이 있는데, 표는 나중에(1794bac·7249eb7) 같은 번호를 Mail 화면·CI 정직성·측정 증거에 붙였다. T116·T117에는 먼저 쓴 뜻의 행이 없었다. T122는 한 커밋에서 두 뜻(state tree 경합 / 다른 society의 lease)을 받았다. 대역 표에는 T120–T123이 없었다 |
| P0D-03 | P0-2 | scripts/traceability.mjs `inventoryAcceptance`, scripts/adversarial-report.mjs | 도구가 수용 범위를 T01–T90으로 따로 들고 있어 TEST-008이 정한 제품 대역(T91부터)을 "범위 밖"으로 보고, 범위 규칙에 TUI·TSP 계열이 없어 report가 생성되지 않았다(`Unreviewed scope: TUI-001`). T78–T90은 한 번도 쓰인 적 없는 예약 대역이며, 이를 MISSING으로 보고하는 것은 설계대로다 |
| P0D-04 | P0-2 | implementation/validation.md:56 | 판정 표의 행 이름 "T36 / WP25.02"가 수용 행 문법과 같아 도구가 T36을 두 번 센다 |
| P0D-05 | P0-5, P0-2 | implementation/validation.md:240, 68 | release gate가 "provider failure/usage/cancel" 증명을 요구하고, WP26/WP27 행은 "provider 쪽 재시도·긴 stream(자격 증명 없음)"을 검증 공백으로 든다. INF-001에 따르면 이것은 엔진이 소유하는 사실이고, 실제 provider 점검은 이미 14회 했다 |
| P0D-06 | P0-4 | implementation/validation.md(`de98db0` 정리) | 문서 정리 때 "usage 표에 쓰는 주체가 없다"(spec의 비용 조항이 validation에 기록하라고 정한 사실)와 "T48–T51을 이행할 OMA 경로가 없다"를 과거 기록과 함께 archive로 보냈다. 규범이 정한 기록 위치를 잃었다 |
| P0D-07 | P0-1 | implementation/validation.md:65,77 | 현재 판정의 V27A·V31A 행이 엔진 0.85.1을 현재처럼 말한다(ENG1 뒤 0.87.1) |
| P0D-08 | P0-5 | operations/README.md:94,196,198 | relay가 "header와 path에서만" 진짜 key로 바꾼다고 적었다. 실제(INF-008, AV2)는 인증 header와 `key` query에서만 바꾸고 path의 자리표시자는 거절한다. 지원 범위 표의 엔진 0.85.1·typebox 1.3.7·"실제 provider NOT_RUN"은 ENG1과 수동 점검 이전 상태다. model의 codec·pricing을 운영자가 "검토"한다는 문장은 OMA가 그 값을 쓰는 것처럼 읽힌다 |
| P0D-09 | P0-5 | implementation-spec.md:651, 210, 592 | TUI-005 뒤 문단이 지운 `src/inference.ts`와 "INF-002/003의 예약 검사"를 전제한다. DB-007의 T-usage-reserve와 오류 표의 "reserve 보존"은 production 호출자가 없는 예약 경로를 현재처럼 적었다 |
| P0D-10 | P0-5, P0-2 | MAINTENANCE.md §20 | "provider codec"을 OMA가 추측하지 말 OPEN gate로 든다. INF-001이 그 spike를 제거했다 |
| P0D-11 | P0-5, P0-2 | PRODUCT.md:11-16, 94 | `npm install -g oma` 두 줄이 지금 되는 것처럼 읽힌다(`bin` 없음, C2 보류). release가 막힌 이유로 LOC만 든다(owner는 validation) |
| P0D-12 | P0-2 | implementation/README.md:16, docs/README.md 범위 표 | "수용 oracle T01–T90"이 있는 것처럼 적었다. 실제로는 T01–T77, T91–T127이고 T78–T90은 예약 대역이다 |
| P0D-13 | P0-2 | HANDOFF.md §6 | 보류한 결정 목록을 validation의 알려진 한계와 중복해 적었다 |
| P0D-14 | P0-6(원칙 재검증) | PRIORITY-0.md | 명제와 용어가 durable fact를 런타임 기록으로만 들어, 문서와 식별자에 같은 원칙이 적용된다는 말이 없었다. P0D-01·P0D-02가 그 공백에서 났다 |

부합으로 판정한 것: README(절 번호·설치 서술), MAINTENANCE의 나머지 절, systemd/README(7개 template과 일치), contracts/README(내보내는 이름 63개, 비공개 envelope 포함 64개), store-opening, spikes·test-matrix의 날짜가 붙은 실험 기록, 결정 기록 안의 0.85.1(작성 시점의 사실).

### 수정

- P0D-01: 먼저 번호를 가진 기록을 붙든 relay가 INF-005·INF-006을 지키고, 비용 상한은 INF-009, 성능 검증은 INF-010이 된다. traceability는 두 행의 ID·digest·문구만 갱신했다.
- P0D-02: T115–T117은 먼저 쓴 뜻을 지키고 T116·T117에 그 행을 썼다. 뒤에 붙었던 뜻은 T124(Mail)·T125(CI)·T126(측정)으로, T122의 다른 뜻은 T127로 옮겼다. 시험 이름을 새 번호로 바꿨다(Mail 1개, CI 15개). 대역 표에 T120–T127을 적었다.
- P0D-03: 수용 범위에 TEST-008의 제품 대역을 넣었다. 그 대역의 빈 번호와 빈 oracle은 finding이고, 한 뜻의 행 여럿(T119, T122)은 목록에만 올린다. report의 범위 규칙에 TUI·TSP를 runtime으로 넣었다. report는 이제 생성되고, T78–T90을 MISSING으로 보고하며 종료 코드 1을 낸다.
- P0D-04–P0D-07: validation의 행 이름·버전·provider 문장을 고쳤고, 잃었던 두 사실을 "알려진 한계"에 되살렸다.
- P0D-08–P0D-13: 각 문서의 문장을 owner의 사실에 맞췄다.
- P0D-14: PRIORITY-0에 "문서와 식별자에도 같은 원칙"을 적었고, 문서 지도의 규칙이 그 절에서 나온다고 밝혔다.
- P0-7: `scripts/document-integrity.mjs`(`check:documents`, `check:architecture`에 포함)가 요구 ID의 유일성, 수용 행의 위치와 대역, 링크와 anchor를 검사한다. `test/document-integrity.test.mjs`가 이 트리의 통과와 세 가지 negative control을 확인한다(fast lane 필수).

작업 중 실수 하나: P0D-02를 처음 고칠 때 이미 쓰이던 T120–T122로 옮겨 새 충돌을 만들었다. HEAD의 최대 번호(T123)를 확인하고 되돌린 뒤 T124부터 다시 매겼다.

## 4차 점검: 외부 전수 검토

기준점 `6787211`. 사용자가 전달한 외부 전수 검토 묶음(224개 생산 파일, 신규 지적 N01–N23, 앞선 묶음의 F1–F7, 구조 개선 원장
S01–S12)을 받아, 지적마다 코드와 대조해 판정했다. 묶음의 원문 사본 6개는 기준점의 Git blob과 바이트가 같았다. 판정 기준은 다른 점검과
같다: 위반이면 고칠 하위 규칙을 적고 같은 종류가 있는 곳을 함께 고친다. S01–S12는 지적이 아니라 개선 제안이므로 판정 대상에서 뺐다.

### 판정과 수정

| ID | 외부 | 규칙 | 파일(`6787211`) | 요약 | 상태 |
|---|---|---|---|---|---|
| P0V-25 | N01 | P0-4 | cli/transport.ts `presentedGrant` | Principal CLI가 요청마다 credential FD를 읽어, 같은 프로세스의 두 번째 요청(조회 뒤 재전송)이 AUTH_FAILED가 되고 결과가 "불명확"으로 끝났다. `submit`은 Principal 도구가 부르지 않아 해당하지 않는다 | 수정 37cbeee |
| P0V-26 | N02 | P0-1 | domain/derived.ts `unitNameFor`, units.ts `install` | UNIT-001의 이름(`oma-<society>-<actor>`)은 두 부분이 모두 `-`를 가질 수 있어 두 소유자에게 같은 이름이 된다. 설치는 그 이름의 파일을 그대로 교체했다 | 수정 c980611(교체 거절·접수 전 거절). 이름 자체는 그대로(아래 "결정이 필요한 것") |
| P0V-27 | N03 | P0-4 | runtime/broker-supervisor.ts `start` | spawn이 실패하면 pid 없는 child를 돌려주고 나중에 `error`를 낸다. supervisor는 그 리스너를 달기 전에 반환해 host가 처리되지 않은 error로 끝났다. 같은 순서가 extension CLI 자식과 Pi RPC client에도 있었다 | 수정 37cbeee |
| P0V-28 | N04 | P0-5 | entry/broker.ts, runtime/supervision-channel.ts | 감독 채널이 선언됐는데 성립하지 않으면(host가 먼저 죽음 등) 선언이 없을 때처럼 계속 돌아 society lock을 쥐었다 | 수정 74c9203 |
| P0V-29 | N05 | P0-2 | entry/broker.ts, git/quarantine.ts | bundle 가져오기 전체의 기한이 integration check 기한의 최댓값이었다. check가 없는 기본 설정에서 1초였다 | 수정 74c9203(quarantine profile이 기한을 소유, canonical Git 기한 120초) |
| P0V-30 | N06 | P0-5 | store.ts, storage/transitions.ts, storage/operation-transitions.ts | 뒤 단계 시각을 벽시계 그대로 써서, 시계가 뒤로 가면 CHECK가 갱신을 거절하거나 delivery가 STORE_CORRUPT(수락 차단)로 읽혔다 | 수정 7efa4d8(`MAX(?, created_at_ms)`, 형식·schema 불변) |
| P0V-31 | N07 | P0-2 | domain/tool-surface.ts `assertAcyclic` | 순환 검사의 방문 표시를 깊이 계산에도 써서, 선언 순서에 따라 깊이 5가 허용됐다(120개 중 90개) | 수정 64cc237 |
| P0V-32 | N08 | P0-2 | broker/principal-endpoint.ts, internal-dispatcher.ts | 내부 봉투 검사가 internal dispatcher에만 있고 Principal attach·detach와 host 전달 endpoint에는 없었다. detach 응답도 선언된 형식(`{ detached: true }`)과 달랐다 | 수정 9b18c34 |
| P0V-33 | N09 | P0-1 | domain/errors.ts `normalizeStorageFailure`, broker.ts `fail` | 정리 실패가 함께 묶인 오류를 다시 만들면서 details와 AcceptedFailure 종류를 잃었고, 중첩된 AggregateError를 풀지 않았다. broker의 재구성도 details를 버렸고, "draining" 사실이 네 곳 중 한 곳에서만 사유를 실었다 | 수정 64cc237 |
| P0V-34 | N11 | P0-4 | runtime/inference-relay.ts `forward`, `tunnel` | 응답을 기다리던 엔진이 떠나도 provider 호출을 끊지 않아, provider가 아무도 없는 곳에 계속 흘려보내고 slot이 idle timeout까지 남았다 | 수정 4f38e85. tunnel 쪽은 재현되지 않았다(아래) |
| P0V-35 | N12 | P0-2 | extension/cli-process.ts `collect` | CLI 출력을 청크마다 UTF-8로 디코딩해 pipe가 자른 문자가 깨졌다 | 수정 37cbeee |
| P0V-36 | N13 | P0-2 | runtime/pi-spawn-plan.ts, tui/session.ts, extension/mail-tools.ts | 저장된 메일(EML)의 읽기 한도로 본문 한도를 넘겼다. 저장된 메일은 인코딩 뒤 본문과 헤더라서 본문의 최대 3.12배(quoted-printable), 한글 base64는 1.37배다. 256 KiB 한도에서 한글 본문 약 190 KB부터 읽지 못했다 | 수정 d2505c9(`storedMailBytes` 한 곳) |
| P0V-37 | N14 | P0-2 | extension/mail-tools.ts `mailId` | Principal의 CLI 결과는 host archive 경로를 보이는데(DR1), 메일 도구는 `/mail/archive/cur`만 되돌려 읽었다 | 수정 9b18c34 |
| P0V-38 | N15 | P0-5 | cli/request-service.ts | 같은 key의 재시도가 조회보다 동결된 본문을 먼저 읽어, 본문이 없으면 broker의 영수증을 보지 못했다 | 수정 74c9203 |
| P0V-39 | N16 | P0-5 | tui/dashboard.ts `activeCount` | 관측하지 못한 unit(`activeState: null`)을 세지 않아 Active 0, observed로 보였다 | 수정 74c9203 |
| P0V-40 | N17 | — | tui/view/screens.ts, tui/model.ts | 목록을 늘 위에서부터 그려 작은 화면에서 선택이 사라지고, 본문은 스크롤할 수 없었다(↑/↓가 다른 메일을 열었다) | 수정 d2505c9 |
| P0V-41 | N18 | P0-1 | tui/model.ts, tui/app.ts | 연 메일을 줄 번호로 기억해 갱신이 목록을 다시 정렬하면 다른 메일이 열렸다 | 수정 d2505c9(Maildir 이름의 identity) |
| P0V-42 | N19 | P0-5 | tui/sources/mail.ts `readBody` | 한도에서 잘린 본문을 전체처럼 보였다 | 수정 d2505c9 |
| P0V-43 | N20 | — | tui/sources/mail.ts | 갱신마다 메일함의 모든 메시지를 동기로 열고 읽었다 | 수정 d2505c9(lstat로 정렬, 헤더는 최근 `mailListRows`개만) |
| P0V-44 | N21 | P0-5 | lifecycle/actions.ts, views.ts | stop 결과의 `remainingOperations`와 status 결과의 크기가 frame 상한과 묶이지 않았다 | 의도된 예외(DR14): v1 receipt 안의 수용 한계로 둠. 256 KiB frame에서 status agent 1052개, stop의 미해결 operation 6235개 |
| P0V-45 | N22 | P0-2 | mail/display.ts, extension/mail-tools.ts `readableMail` | 본문 앞의 U+FEFF를 지웠고, 머리 끝을 CRLF에서만 찾아 LF 메일을 인코딩된 채 보였다(`headerEnd`는 LF도 받음) | 수정 9b18c34 |
| P0V-46 | N23 | P0-2 | tui/keys.ts | 일반 입력은 입력한 U+FFFD까지 지우고, 붙여넣기는 깨진 바이트에서 생긴 U+FFFD를 넣었다. 같은 사실을 두 경로가 반대로 읽었다 | 수정 260a760 |
| P0V-47 | F1 | P0-3 | config/generations.ts `recordCommitted`, `journalTail` | 줄바꿈 전에 끊긴 journal 기록에 다음 기록이 붙어 둘 다 사라지고, 수집이 실제 직전 세대(rollback의 기준)를 지웠다 | 수정 64cc237 |
| P0V-48 | F2 | P0-5 | runtime/pi-rpc.ts `onData` | 한 청크가 줄 A를 끝내고 줄 B를 시작하면 A의 기한이 B에 이어졌다 | 수정 64cc237 |
| P0V-49 | F3 | P0-4 | storage/durable-fs.ts `replaceDerivedFile` 외 2곳 | 닫은 FD를 뒤의 실패에서 다시 닫았다. directory와 process-lock은 `closeSync`가 실패하면 같은 번호를 다시 닫았다(Linux는 실패해도 번호를 반납한다) | 수정 d48eb09 |
| P0V-50 | F4 | P0-4 | broker.ts `serveFrames` | 실행으로 넘긴 요청의 저장 예약을 연결 종료가 돌려줬다 | 수정 d48eb09 |
| P0V-51 | F5 | P0-1 | tui/sources/settings.ts, extensions.ts | Principal만 있는 설정에서 Worker 편집과 Extensions의 Worker 열이 Principal profile을 바꿨다 | 수정 74c9203 |
| P0V-52 | F6 | P0-4 | broker.ts `closeListener` | 끝난 listener close를 배열에 계속 보관했다 | 수정 d48eb09 |
| P0V-53 | F7 | P0-2 | views/status-refresh.ts `request` | 실행이 끝나고 이어지는 실행이 시작되기 전 틈에 새 요청이 두 번째 관측을 시작했다 | 수정 d48eb09 |

부합으로 판정한 것: **N10**(Git 관측 실패를 손상으로 단정). workspace 검증에는 Git 실패를 넓게 잡는 `catch`가 없다. timeout·출력 한도·spawn
실패는 `requireTextExit`가 DEADLINE_EXCEEDED·LIMIT_EXCEEDED·INTERNAL_ERROR로 올리고, STORE_CORRUPT는 끝까지 실행된 git이 0이 아닌 값으로
끝났을 때뿐이다(P0V-07의 기준과 같다).

재현되지 않은 것: **N11의 tunnel 쪽**. upgrade가 끝나기 전에 엔진이 떠나는 순서에서, 수정 전 코드도 엔진 쪽 socket이 끝나면 pipe가 provider 쪽을
끝내 provider 연결이 닫혔다. 수정은 그 pipe의 부수 효과 대신 소유를 명시하는 것으로만 두었고, 그 시험은 회귀 방지이지 수정을 증명한 대조가 아니다.

판단을 맡긴 것(DR14, 2026-09-27 사용자가 판단을 맡김):

- **P0V-44(N21)**: 결과의 크기를 frame에 묶으려면 durable receipt(`remainingOperations`)나 status 결과의 형식(페이지·요약)을 바꿔야 한다.
  receipt의 뜻을 바꾸는 일이므로 receipt version 계획으로만 하고, v1에서는 수용 한계(실측)를 validation에 적는다.
- **P0V-26(N02)의 이름**: 이름은 UNIT-001 그대로 두고 겹침은 거절한다. 이름 체계의 변경은 installation 형식 변경과 함께 계획한다.

### 기존 시험의 기대를 바꾼 곳

- `cli-request-intent`의 "본문이 없으면 wire로 보내기 전에 멈춘다": 이 시험이 지키던 것은 "동결된 본문 없이 다시 보내거나 source에서 다시
  만들지 않는다"이고, 조회(operation.get)까지 막는 것이 P0V-38의 결함이었다. 손상된 metadata 부분은 그대로 두고, 본문이 없는 부분은
  "조회에 REQUEST_NOT_FOUND이면 body absent로 멈추고 다시 보내지 않는다"로 나눴다.
- `unread-observations`의 DR13 시험: 읽을 수 없는 메시지 파일이 있으면 대기 수가 "모름"이었다. 대기 수는 이제 이름 관측(lstat)으로 세고,
  lstat은 그 파일이 일반 파일이라고 답한다. DR13의 규칙(이름에 대한 답은 사실로 말한다)에 따라 대기 중인 메시지로 센다. 이름이 답하지 않는
  경우(lstat 실패)는 여전히 "모름"이다.

### 수정 검증

수정마다 시험을 먼저 쓰고, 고친 소스 파일만 기준점의 것으로 되돌려 빌드한 뒤 그 시험이 실패하는지 확인했다(되돌린 코드는 매번 복원하고 다시
빌드했다). 모두 실패했다. 다만 P0V-26, P0V-42, P0V-43은 되돌린 코드에 새 함수·필드가 없어 실패한 것이라 대조가 약하다. P0V-34의 tunnel
시험은 위와 같이 되돌린 코드에서도 통과한다. 시험은 `test/p0-review4.test.ts`와 해당 owner의 시험 파일(storage-reservation,
generation-retention, r12-ledger-transitions, principal-endpoint, delivery-notice, audit-cli-submit, cli-request-intent,
broker-composition-policy, inference-relay)에 있다. 관련 시험 묶음은 커밋마다 다시 돌렸고, 전체 검증 cycle(lane)과 validation 결박은
하지 않았다. 관련 시험을 import로 골랐기 때문에, 소스를 직접 변환해 import를 대역으로 바꾸는 두 조립 시험
(`oma-composition-policy`, `p11-p12-dispatch`)을 빠뜨렸다. 끝에 돌린 로컬 전체 시험에서 이 둘이 새 import(`domain/mail-values`,
`internalEnvelopeProblem`)를 모른다는 이유로 29개 실패해 대역을 맞췄다(봉투 규칙은 복제하지 않고 컴파일된 실제 함수를 넘긴다).

### 원칙에 대한 관찰

P0-4의 문장은 accept 전 artifact(파일·메일·staging·임시 작업공간)의 owner를 말한다. 이번 발견 가운데 여섯(P0V-25, 27, 34, 49, 50, 52)은
같은 모양 -- 자원이 생긴 순간부터 끝날 때까지 한 owner가 있어야 한다 -- 을 런타임 자원(FD, 자식 프로세스, 저장 예약, provider 호출,
listener)에서 보였다. P0-4에 그 적용을 적었다(DR14).

## 수정 검증

수정마다 그 수정을 되돌리는 변이를 넣고, 빌드한 뒤 해당 시험 파일을 돌렸다. 시험이 실패하면 KILLED다. 변이를 넣은 코드는 매번 원래대로 되돌리고 다시 빌드했다.

| 변이 | 바꾼 곳 | 잡은 시험 | 결과 |
|---|---|---|---|
| DR9: receipt 시도를 현재 lease 하나로만 인정 | mail/batches.ts `settleFromReceipt`의 시도 구간 | rollover-settlement | KILLED |
| DR9: run open이 준비된 batch를 이유로 멈춤(옛 재할당 자리) | broker.ts `openRun` | rollover-settlement | KILLED |
| DR10: accept되지 않은 artifact를 지우지 않음 | reconcile/preaccept.ts | priority-0 | KILLED |
| DR11: boundary entry 확인·flush 없이 receipt 게시 | storage/delivery-receipt.ts `publishDeliveryReceipt` | delivery-receipt-publication | KILLED |
| DR12: 앞의 기대 버전 확인만 제거 | config/generations.ts `commitInlineConfiguration` | priority-0 | SURVIVED |
| DR12: 앞의 확인과 rename 직전 재확인을 모두 제거 | config/generations.ts | priority-0 | KILLED |
| DR13: 읽지 못한 정책을 POLICY_CHANGED로 | git/integration.ts `currentPolicy` | phase7 | KILLED |
| DR13: CLI exit을 코드만으로 | domain/errors.ts `errorExit` | cli-receipt-replay | KILLED |
| DR13: 끝나지 않은 unit 명령을 UNSUPPORTED_PROFILE로 | units.ts `unitCommandError` | priority-0 | KILLED |
| DR13: 도구가 멈춘 CLI를 끝난 것으로 | extension/mail-tools.ts `cliFailure` | priority-0 | KILLED |
| P0V-03: incarnation 감소 허용 | store.ts `updateAgent` | r12-ledger-transitions | KILLED |
| P0V-06: receipt 부재를 보류로 | storage/delivery-receipt.ts `deliveryDecision` | receipt-settlement | KILLED |
| P0V-10: accept 뒤 정책 재해석을 되살림 | lifecycle/create.ts | priority-0 | KILLED |
| P0V-15: lstat 실패를 0 byte로 | extension/workspace-guard.ts | priority-0 | KILLED |
| P0V-18: Control Panel exit을 옛 switch로 | tui/exit.ts `codeFor` | priority-0 | KILLED |
| P0V-18: 보증할 수 없는 바인딩을 확정 거절로 | runtime/provision.ts `projectBindingDecision` | priority-0 | KILLED |
| P0V-12 보완: 읽지 못한 설정 파일을 "바뀜"으로 | config/generations.ts `assertCurrent` | priority-0 | KILLED |
| P0V-19–P0V-21: `unobserved`가 아무것도 모름으로 읽지 않음 | domain/errors.ts `unobserved` | priority-0 | KILLED |
| P0V-19: loader의 읽기 실패를 내용 오류로 | config/operations.ts `sourceFailure` | priority-0 | KILLED |
| P0V-20: 열지 못한 디렉터리를 종류 불일치로 | storage/directory.ts `assertDirectory` | priority-0 | KILLED |
| P0V-20: 실행되지 못한 ledger 조회를 손상으로 | store.ts `findSucceededContext` | priority-0 | KILLED |
| P0V-22: extension scan이 관측 실패를 말하지 않음 | tui/sources/extensions.ts | extension-editing | KILLED |
| P0V-22: 읽지 못한 메시지를 메시지 없음으로 | tui/sources/mail.ts | unread-observations | KILLED |
| P0V-23: 영속성 불명 저장을 저장 실패로 | domain/errors.ts `publishedUnconfirmed` | tui-app | KILLED |
| P0V-24: 거절된 저장 뒤 다시 읽지 않음 | entry/oma.ts `setField` | oma-composition-policy | KILLED |

DR12의 SURVIVED는 동등 변이다. 앞의 확인이 없어도 rename 직전 재확인이 같은 lost update를 같은 코드(`POLICY_CHANGED` "configuration changed since it was read")로 막는다. 차이는 임시 파일을 만들기 전에 멈추는가뿐이며, 그 임시 파일은 같은 호출이 지운다. 두 확인을 모두 없애면 잡힌다. 앞의 확인은 쓸데없는 쓰기를 줄이는 것이지 사실을 지키는 것이 아니므로, 시험을 더 만들지 않았다.

P0-7 gate(`check:boundaries`)의 negative control은 test/durable-boundaries.test.mjs에 있다. 등록부에서 경계 하나를 빼거나 없는 시험을 적으면 gate가 실패한다.
