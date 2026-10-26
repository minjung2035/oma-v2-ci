# OMA v2 유지보수 지침

현재 코드를 수정하고 검증하는 절차다. 새로운 wire method·DB state·권한·서비스·오류 코드를 정의하지 않는다. 문서의 권위와 주제별 owner는 [문서 지도](README.md), 최신 요청과 환경 제약은 [HANDOFF](HANDOFF.md)가 소유한다. 정리 전 전문은 [보관 기록](archive/documentation-cleanup-2026-10-25/MAINTENANCE.md)에 있다.

## 작업 시작

[PRIORITY-0](PRIORITY-0.md)를 먼저 읽고 실제 branch·HEAD·working tree, 관련 requirement/DR·profile/config, 현재 검증 입력과 실행 가능한 환경을 확인한다. 과거 finding은 현재 코드에서 다시 확인하며, 과거 DONE·PASS·LOC·reviewed hash를 새 입력의 결과로 재사용하지 않는다.

문서·코드의 불일치는 구현 결함, 오래된 비규범 설명, 미결정 설계, 명시적으로 차단된 동작으로 구분한다. 편한 쪽을 선택하거나 고정 architecture를 코드에 맞춰 바꾸지 않는다. 규범 변경은 별도 결정으로 다룬다. 현재 작업에서 에이전트 위임은 사용하지 않는다.

## 사실·관계·시점을 먼저 확인

| 질문 | 확인할 내용 |
|---|---|
| 무엇이 사실인가 | 어떤 row·bytes·ref·receipt가 원본이고 어떤 파일·화면이 재생성 가능한가 |
| 어떤 관계인가 | actor·incarnation·request·plan·path·message·result가 정확히 연결되는가 |
| 언제 믿는가 | preflight·prepared·accepted·effect observed·terminal 중 어느 시점인가 |
| 누가 효과를 낼 수 있는가 | 과거 사실의 조회와 현재 새 효과의 권한이 분리됐는가 |

유효한 ID라는 shape 검사와 이 operation에서 파생된 ID라는 관계 검사는 다르다. DB에 저장된 값도 새 입력으로 검증한다. closed field·enum·정수·identity·row 관계·frozen plan/result를 확인하며 `JSON.parse(...) as Plan`이나 현재 기본값으로 손상을 숨기지 않는다.

한 의미에는 한 owner를 둔다. 식별자·capability·method·error·derived path/ref를 소비자마다 다시 정의하지 않는다. 타입·runtime validator·config/durable 검사·protocol·oracle은 같은 정의를 사용한다. 격리 때문에 복제가 필요하면 생성 또는 동등성 검사로 묶는다. 기능별 실제 위치는 [책임 경계](application-boundaries.md)를 따른다.

## 수락·효과·복구

- Acceptance 뒤에는 즉시 죽어도 frozen plan/evidence와 실제 관측으로 다음 행동을 판단할 수 있어야 한다. accepted bytes·request hash·terminal receipt를 현재 설정에 맞춰 고치지 않는다.
- SQLite transaction은 동기 callback과 원래 Store/gate를 유지한다. 안에 await·Promise/thenable·Git/실행 adapter/provider·network·파일 게시/fsync를 넣지 않는다. 물리 순서는 [구현 계약](implementation-spec.md#production-physical-effect-ordering)을 따른다.
- Normal은 의도에서 시작하고 recovery는 실제 발생한 효과를 관찰한다. decision workflow를 하나로 합치지 않는다. ref/object·immutable bytes·policy·execution scope 같은 관측 primitive를 공유한다. 반복 복구가 새 효과나 상태 drift를 만들지 않아야 한다.
- Terminal receipt replay, accepted nonterminal recovery, 새 physical effect 실행을 구분한다. 과거 peer의 죽음을 receipt 조회 거절 사유로 삼거나 과거 receipt를 새 효과의 권한으로 삼지 않는다.
- Admission과 긴 준비 뒤 효과 직전의 권한 검사는 시점이 다르다. stop·retire·policy·base·incarnation·writer가 바뀔 수 있으므로 중복이라고 제거하지 않는다.

`unknown`은 absent·dead·success·zero가 아니다. corruption도 retryable과 다르다. 오류는 code뿐 아니라 operation phase·effect knowledge·observation kind를 함께 처리한다. preaccept 입력 거절과 accepted broker-owned artifact 손상을 구분하고 최초 오류를 cleanup 오류로 덮어쓰지 않는다.

Immutable publication은 같은 path/같은 bytes일 때만 idempotent하다. 다른 bytes·type은 충돌/손상이며, mutable view 교체와 같은 helper 의미로 합치지 않는다. 재시도에 새 key를 만들어 동일 효과를 다시 내지 않는다.

## 물리 자원과 파일

FD·child·listener·timer·lock·stage는 취득 순간부터 한 owner가 실제 반환/종료까지 소유한다. 모든 cleanup을 시도하고 오류를 보존하되, 실패한 close를 재시도해 재사용된 FD를 닫지 않는다. timeout·signal 전송·직접 child close만으로 모든 후손의 죽음을 추정하지 않는다.

Run은 actor 문자열이나 PID 하나가 아니다. 필요한 경계에서 incarnation·invocation ID·pinned kernel scope·run lease·peer liveness와 각 요청의 실제 sender를 함께 확인한다. revoke 뒤에도 death proof에 필요한 pin을 유지하며 unknown population을 dead로 처리하지 않는다. DR49의 현재 scope 계약을 과거 cgroup 경로 문자열이나 saved PID로 대신하지 않는다.

소유 파일도 mode·type·symlink·inode·상위 경로가 손상될 수 있다. held parent·no-follow·동일 inode 관측과 게시 순서를 유지한다. Cross-filesystem 게시는 destination temp→write→fsync→verify→publish→parent fsync를 따른다. preaccept artifact는 생성 전에 cleanup 책임을 등록하고, 수락이 불명이면 원본을 지우지 않는다.

출력·대기·큐는 해당 계약의 spool·backpressure·관측 정책을 사용한다. preview/partial/truncated와 전체 결과를 구분한다. DR37/DR46에서 제거한 실행·저장·agent quota를 새 방어 규칙처럼 복구하지 않는다. 제한의 종류와 실제 owner는 [limit-bounds](limit-bounds.md)를 따른다.

## 변경별 확인

| 변경 | 확인할 경계 |
|---|---|
| Lifecycle | provisioning/retired·GOAL·activation·desired/incarnation·새 stop intent·old run death. 오래된 start/stop replay가 후속 incarnation에 효과를 내지 않아야 함 |
| Git | shell interpolation 없는 argv/env·object format/full OID·immutable published ref·expected-old CAS·현재 권한/정책/stop. accepted candidate/bundle을 재생성하거나 third OID를 덮어쓰지 않음 |
| Mail | logical address·recipient snapshot·Delivery row·EML header 관계. Date/Message-ID/hash/length를 다른 계층이 독립 생성하지 않음 |
| 설정 | expected-version·전체 closure·generation flush·manifest commit·parent flush. 게시됐지만 영속 불명인 결과를 단순 실패나 저장 완료로 축약하지 않음 |
| UI·Pi | 한 engine/UI epoch·입력 순서·prompt 귀속·reload/취소·실제 child exit·history 수명. private SDK 접점은 Engine의 검증 adapter와 inventory에만 둠 |
| 세션 보관 | Store open 전 restore, drain/native/Resident 종료와 Store.close 뒤 archive. cold pointer·checkpoint·원본 회수·복원 성공을 구분하고 실패 원본을 보존 |
| Protocol | closed shape·관계·correlation. fatal framing 뒤 poison/close. JSONL의 온전한 oversized line만 DR15에 따라 LF까지 건너뜀 |

지원되지 않는 profile은 `UNSUPPORTED_PROFILE`로 거절한다. stub/mock/interface 존재로 qualification gate를 닫지 않는다. DR18의 spike 결정과 미지원 선택을 바꾸려면 실제 harness evidence가 필요하다. provider codec·가격·retry는 동봉 엔진의 것이며 OMA가 추정해 재구현하지 않는다.

## 버그 수정과 시험

중요한 버그는 현재 코드의 재현→직접 원인→사실/관계/시점→owner 확인→의미 있는 회귀→수정→같은 결함류 점검→관련 lane 실행 순서로 처리한다. 정상 fixture는 production-valid constructor를 사용하고 corruption test만 명시적으로 raw 입력을 만든다. Validator가 강화됐다고 production을 느슨하게 만들기 전에 fixture를 확인한다.

Oracle은 실제 계약을 검사한다. 계산한 expected를 production planner에서 다시 얻거나 helper 이름·임시 경로만 고정하지 않는다. durable bytes·crash ordering·scope/ref 관계에는 실제 물리 관측을 사용한다.

모델→도구→CLI→broker→원장/메일→다음 전달을 바꾸면 기존 `test/scenario-*.test.ts`와 scripted-provider/scenario fixture로 정상·provider 실패·끊김·kill/restart·같은 key retry를 확인한다. 화면만 보지 않고 ledger·mailbox·receipt·session으로 판정한다. scripted provider는 실제 provider의 증거가 아니다.

현재 scripts가 명령의 정본이다.

```sh
npm run build
npm run typecheck
npm run check:package
npm run check:architecture
npm test
```

변경 범위에 맞는 검사를 실행한다. 문서만 바뀌면 문서·spec·inventory·관련 경계 검사로 확인하고 전체 runtime를 실행했다고 기록하지 않는다. 독립 package API/자산/선언을 바꾸면 기존 tarball 설치 검사를 사용한다. 실제 kernel·crash·platform·powercut·provider lane은 필요한 지원·허용 환경을 먼저 확인한다.

전체 local을 실행할 때는 입력을 고정하고 source/docs/build/install을 병행해 바꾸지 않는다. 첫 serial 검사의 timing oracle과 CPU 작업을 겹치지 않는다. 실패·중단·미실행 이유와 전후 입력을 원시 로그에 남기고, 부분 재실행을 전체 PASS로 합성하지 않는다.

## 정적 검사와 증거

새 정적 규칙은 기존 계약·owner·dependency/capability·source/evidence 일치의 실제 위반을 잡을 때 추가한다. TypeScript나 기존 검사로 확인되는 의미를 두 번째 parser/registry로 만들지 않는다. 정상·직접 위반·alias/간접 우회·false-positive control을 함께 확인한다. LOC나 naming 취향 때문에 파일 분할과 gate를 추가하지 않는다.

Runtime DAG와 type coupling은 구분한다. DR44의 runtime/type union SCC를 허용 목록이나 gate 삭제로 우회하지 않는다. 실제 source owner가 옮겨졌으면 checker의 분석 대상과 negative control을 맞춘다.

| 판정 | 의미 |
|---|---|
| NOT_RUN | 실행하지 않음 |
| BLOCKED | 필요한 환경이나 gate가 없음 |
| UNVERIFIED | 소스·시험이 있어도 현재 source-bound proof가 없음 |
| PARTIAL | 일부 lane/범위만 실행 |
| PROVEN | requirement의 entry/call path/negative oracle/fresh evidence가 현재 source에 결합됨 |

현재 실행 판정은 [validation](implementation/validation.md)에 기록한다. `npm run evidence:refresh`는 구조만 생성하며 `runtimeProof: false`다. authored review·규범 fingerprint·effect owner·durable boundary는 자동 승인 대상이 아니다. 새/변경 코드는 NOT_REVIEWED로 유지하고 과거 PASS·reviewed hash를 새 source로 바꾸지 않는다.

## 문서와 인계

새 정보의 위치는 [문서 지도](README.md#새-정보를-어디에-적는가) 하나가 정한다. HANDOFF에는 현재 요청·코드 기준·제약·환경·재개점만 남기고, 긴 실행 기록·중간 요청·계획은 archive로 분리한다. 계약의 요구 ID와 수용 번호는 위치가 바뀌어도 뜻을 유지한다.

작업 결과에는 무엇을 바꿨는지, 어느 입력을 실제 검사했는지, 미실행과 한계를 적는다. 문서를 기록한 뒤 입력이 달라졌으면 실행 입력과 기록 후 입력의 관계를 남긴다. 실제 source 목록·hash·graph·LOC를 새 측정처럼 손으로 보정하지 않는다.

## 금지 사항

사용자 history를 destructive reset으로 정리하거나 DB 삭제/초기화로 손상을 해결했다고 보고하지 않는다. accepted plan·bytes·receipt를 현재 state로 재작성하지 않는다. recovery에서 자동 rewind/rebase/merge/cherry-pick, unknown의 성공 승격, 새 key 자동 재실행, stub 성공, test 삭제/skip/todo로 PASS 생성, mock의 실환경 승격을 하지 않는다. 편의상 durable entity·queue·daemon·IPC phase를 추가하지 않는다.
