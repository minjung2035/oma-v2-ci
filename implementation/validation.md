# OMA v2 — 현재 검증 상태

이 파일이 현재 검증 판정, 시험 수·LOC 같은 수치, 알려진 한계, 재검증 명령의 단일 owner다. 다른 문서에는 수치나 PASS 표를 적지 않는다([문서 지도](../docs/README.md)).

- **현재 source 판정**: 한 트리에서 실제로 돈 것. `wp-validate`가 다시 쓴다.
- **알려진 한계**: 지금 제품이 하지 않거나 증명하지 않은 것과 보류한 결정.
- **기본 재검증, 환경별 lane**: 다시 돌리는 명령.
- **A-008, release gate, 보존하는 규범**: 열려 있는 gate와 VAL 조항.

무엇을 왜 바꿨는지는 결정 기록(consistency-decisions, design-revisions)과 점검 기록(priority-0-audit)에 있다. 과거의 감사 기록과 중간 실행은 [docs/archive.md](../docs/archive.md)가 가리키는 snapshot에 있다.

## 현재 source 판정

브랜치 `refactor/safety-preserving-architecture`, 통합 검증 트리의 부모 `de98db0`, 실행일 2026-09-26. 이 브랜치의 작업을 한 트리로 결박한 결과다. 작업은 consistency plan(WP00–WP32), 재검토와 적대적 검증(AV1–AV8), 엔진 0.87.1(ENG1), 실제 provider 기능 점검(1–14차, AV9–AV31), 설계 수정(DR1–DR13), Priority 0 파일 단위 점검(P0V-01–P0V-24)이다. 무엇을 왜 바꿨는지는 결정 기록([consistency-decisions](consistency-decisions.md), [design-revisions](design-revisions.md))과 점검 기록([priority-0-audit](priority-0-audit.md))에 있고, 이 절은 이 트리에서 실제로 돈 것만 적는다. 판정: 로컬·kernel·crash lane은 모두 PASS이고, release는 미승인이다(powercut·provider 자동 lane·CI NOT_RUN, A-008 OPEN). wire·DB schema·receipt 형식은 v1 그대로다. receipt의 adapter revision만 ENG1에서 `oma-pi-rpc-v1@0.87.1`이 되었다. 권한 의미가 바뀐 것은 AV18(기본 Principal 프로필이 이미 위임하던 권한을 보유)과 DR4(`code.integrate`를 host가 직접 위임)다. architecture.md는 N-001이 결박한 bytes 그대로이며, 어긋나는 문장은 design-revisions에 있다.

검증 입력: verification input digest `e8c79aad33aaa9d08b655f4755a2e9abb9d9c02bd0846fa4d19359c61b5b4a8b` (619 files). source/test/script/config/manifest/implementation/generated measurement·graph를 결박하며 validation digest field만 정규화한다.

### 실행 결과

#### 종합

| 검사 | 결과와 범위 |
|---|---|
| type/build/package/local and lanes | PASS on engine 0.87.1: fast/durable/property/stress 315/475/34/11, local 1631/1631, package; all fail/cancelled/skipped/todo=0 (`v19-initial-*`, `de98db0`). kernel 64/64과 crash 63/63 PASS on the disposable user manager(T38·SEQ-002 필수). durable은 실제 엔진 AV14(엔진 종료를 기다린 뒤 뒷정리)·V27A(영수증 게시·검증까지)·T116·T117·AV16, pty V28B, 설치 closure V31A, AV9–AV30, DR1·DR3·DR4·DR6·DR7 회귀, Priority 0의 DR9–DR13·P0V 회귀(durable requiredNames 22개)를 포함한다. property는 DR9의 V30A(late는 verified, early는 conflicting), fast는 V29A·V31B·V32A·AV3·AV5 규칙·AV9·AV12·AV31 wiring·runtime-contracts·T118과 P0-7 gate(`check:boundaries`와 그 negative control)를 포함한다. local은 AV31 신호 시험·DR8, P0V-18(Control Panel exit)·P0V-22·P0V-23·P0V-24 회귀를 포함한다. metadata-bound final rerun required |
| Review ledger | production 파일 224개: 변경이 닿은 131개는 그 변경의 회귀 시험(DR·P0 카드 포함), 읽고 바꾸지 않은 93개는 그 모듈을 적재하는 시험(`review-notes.json`), 제거 1개(`src/git/context-mirror.ts`, P0V-17). NOT_REVIEWED 0 |
| Release 판정 | release 미승인: 모든 production 파일 검토 완료(NOT_REVIEWED 0), powercut·실제 provider·CI NOT_RUN(V05C·V30B·V32B) — 모두 사용자 승인 필요 |
| NOT_RUN과 OPEN | provider: 자동 lane NOT_RUN(아래 실제 provider 점검은 수동 기능 증거이며 lane 증거가 아니다); powercut·CI NOT_RUN; A-008 OPEN(아래 "A-008 LOC gate") |

#### 계획 카드(WP00–WP32)

| 검사 | 결과와 범위 |
|---|---|
| 이 표에 없는 카드 | WP00–WP07, WP11–WP14, WP16–WP22, WP24의 oracle은 `implementation/oracle-map.json`이 담당 시험과 lane에 대응시키고, 위 lane 결과가 결박한다. 카드별 결정과 남긴 한계는 consistency-decisions와 이 문서의 "알려진 한계"에 있다 |
| V08A | Principal의 complete가 영수증 뒤에 실패하면 다음 tick은 엔진 전달 없이 complete만 다시 한다(엔진 전달 1회, complete 2회, 영수증 bytes 불변, backoff 유지). complete 단계의 BATCH_CONFLICT는 backoff하는 실패이고, 세션 claim 경쟁만 backoff 없는 보류다 |
| V08B | busy 세션이나 다른 세션에서도 검증된 영수증은 첫 영수증의 sessionPath로 정산되고 새 턴을 시작하지 않는다. 영수증이 conflicting/unavailable이면 전달도 완료도 없이 증거를 보존한다. 전달 도중 다른 곳에서 먼저 게시된 영수증이 있으면 그 첫 영수증으로 완료한다 |
| WP08 negative controls | mutant 6개 모두 실패: 영수증 확인 없이 전달, unavailable/conflicting을 absent로, 모든 BATCH_CONFLICT를 세션 경쟁으로, busy 세션이 정산도 막음, 새 boundary의 sessionPath로 완료, backoff 제거(시험이 끝나지 않음) |
| V09A | 실제 PrincipalSession과 scripted 엔진: 수락 응답이 없는 전달 명령은 세션을 계속 소유하고, 그동안 입력한 Human prompt는 쓰이지 않고 기다리며, 늦은 수락과 settle 뒤에만 쓰인다 |
| V09B | 엔진 종료(SIGKILL)와 명시적 quit 모두에서 쓰이지 않은 대기 입력 3개가 순서대로 정확히 한 번 돌아오고, 쓰였지만 답이 없던 입력은 unconfirmed로 따로 알려지며 다시 보내지지 않는다. 쓰기 시작 뒤 실패한 전송은 미전송으로 돌려주지 않고 세션을 풀지 않는다. 쓰기 전 거절(실제 전송로가 표시한 것)만 미전송으로 돌려주고 나머지 대기 입력은 계속 간다 |
| V09C | 세션이 끝난 뒤의 settle은 아무것도 시작하지 않는다. 제품은 엔진마다 callback을 그 엔진에 묶는다(한 프로세스는 엔진을 하나만 시작한다) |
| WP09 negative controls | mutant 6개 중 4개 실패: 전달 소유자의 timeout 해제, 종료 때 대기 입력 버림, 수락 불명 입력을 미전송으로, 쓰기 시작 뒤 실패를 미전송으로. 생존 2개는 등가 mutant: 종료 뒤 free 가드와 한 번만 반환 플래그는 종료·close가 이미 대기열과 미응답을 비운 뒤라 관측 차이가 없다 |
| V10A | 실제 subprocess: 이벤트가 계속되는 2.5초 턴은 유휴 한도 1초를 넘어도 끝나고, 정말 조용한 엔진은 유휴 한도에서 유휴로, 턴 한도를 넘는 턴은 턴 시한으로, 응답 없는 명령은 수락 시한으로 각각 다른 결과로 끝난다 |
| V10B | 기존 R37/R17: native 준비 결과가 불명이면 shutdown은 Store와 lock을 풀지 않고 termination을 요구하며, 만료된 handoff는 성공이 아니다(로컬 실제 프로세스). 실제 Resident 안 엔진 descendant 죽음 증명은 WP30 |
| V10C | 40일 budget은 즉시 만료되지 않고 overflow 경고도 없으며 취소는 최종이다. 모든 전달 결과 뒤 timer가 남지 않는다. broker A의 늦은 credential은 broker B 뒤에 엔진에 부여되지 않고, 늦은 거절은 B의 등록을 지우지 않는다 |
| WP10 negative controls | mutant 6개 모두 실패: 유휴 시한 재무장 안 함, 턴 시한을 유휴 시한으로, 종료 시 취소 누락, native timer 하나로 전체 budget, generation 확인 제거, 수락 뒤에도 수락 시한 유지 |
| WP08–WP10 not covered | 실제 Pi 엔진·provider에서의 긴 턴과 수락 지연, Principal 엔진 SIGKILL 뒤 실제 사용자 흐름(WP28 pty), runner stop의 엔진 descendant 종료 증명(WP30) |
| V15A | 관측된 등록부로 bootstrap 상태를 판정하고(관측 없음은 unknown), bootstrap 뒤 seed 필드와 seed 없는 bootstrap profile은 이유와 함께 막히며 writer도 거절하고 아무것도 쓰지 않는다. bootstrap profile 편집은 seed만 바꾸고 agent profile(childProfile 등)은 바꾸지 않는다. 같은 값 저장은 분할 bundle과 inline 모두 쓰지 않고 unchanged로 알린다. 다시 읽기 실패 뒤에는 저장됨·미확인으로 알리고 옛 값을 현재값으로 보이지 않는다 |
| V15B | dashboard는 Principal 모델을 설정값으로, 실행 중 세션이 시작될 때의 값과 구분해 보여 주며 어느 것도 엔진이 실제로 쓰는 모델이라고 표시하지 않는다 |
| WP15 negative controls | mutant 7개 모두 실패: bootstrap 뒤에도 편집 허용, seed 없을 때 필드 숨김, writer가 차단 무시, 같은 값도 쓰기, 설정값을 현재 모델로 표시, 다시 읽기 실패 뒤 옛 값 표시, unknown을 pending으로 |
| WP23.01 measurement | 실제 user manager(systemd 257, 64 agent, 동시 status.get 16 + mail.send 4): 수정 전(`1f6c31e`) 이벤트 루프 최대 정지 10 098 ms(읽기)/10 143 ms(mutation 포함), status.get p50/p95 5 558/10 097 ms, mail.send 최대 639 ms, pending 620개에서 status 한 번 3 886 ms 정지. 수정 뒤 16/38 ms, 267/286 ms, 48 ms, 10 ms. `systemctl show` p50은 1 unit 8.5 ms, 32 unit 59.8 ms, 128 unit 212.9 ms |
| V23A | stress(적합한 비용 모형 6.9 ms + 1.61 ms/unit): 읽기만 할 때 정지 < 50 ms, mutation과 함께 < 100 ms(mail.send 자체의 fsync 20–45 ms 포함), status.get p95 < 1 s, 동시에 실행되는 관측 명령 ≤ 1, 동시 16 호출에 refresh 하나와 follow-up 하나, 동기 systemctl 0 ms. pending 620개에서 정지 < 50 ms. 응답 없는 manager: 답은 2 s budget 안에 unit 필드 null(추측 없음)과 물은 시각으로 오고, 명령은 자기 옆에 다시 시작되지 않으며 manager가 돌아오면 회복한다. 관측 실패: 등록부 행과 pending 수는 그대로 답하고 unit 필드는 null, 게시된 view도 같다 |
| V23B | kernel: 실제 batched 관측이 멈춘 unit a를 inactive로 본 뒤 unit이 실제로 시작된다. 표시는 본 것과 그 시각을 유지하고, confirmDead는 false, manager의 start는 RUN_TERMINATION_UNKNOWN(incarnation 불변), 다음 refresh는 active를 본다. 캐시된 inactive를 죽음 증명으로 쓰는 대조는 살아 있는 run에 대한 행동을 허가했을 것이다 |
| WP23.02/03 unit oracles | fast: 실행 중 refresh 동안의 호출자 10명은 그 뒤에 시작하는 follow-up 하나를 공유하고 답은 질문보다 오래되지 않는다. 멈춘 관측은 각 호출자에게 budget과 timeout을 주고 다시 시작되지 않는다. show 출력은 Id로 unit에 묶이고(순서 불신) 32개씩 나뉘며, 반복·누락·남의·손상 block은 그 agent만 unknown. 전체 사회 projection은 seed 수열 24단계 동안 agent별 pendingWork와 정확히 같고, 손상 5종(manifest 반복·누락, 미래 incarnation, prepared batch 안의 presented delivery, 이중 계산)을 똑같이 거절한다. 이름 projection은 식별자가 아닌 이름을 거절한다 |
| WP23 negative controls | mutant 11개 중 10개 실패: refresh 안의 agent별 동기 show, 호출자마다 refresh, budget 제거(시험이 끝나지 않음), 실행 중 refresh 합류(질문보다 오래된 답), manifest/link 검사 생략, 미래 incarnation 수용, 관측 안 된 unit을 inactive로 표시, status.get을 답한 시각으로 표시, 이름 식별자 검사 생략, 반복 block 신뢰. 생존 1개는 등가: 표시 projection의 이중 계산 guard는 PK·batch 열 하나·manifest decode 때문에 도달할 수 없다 |
| WP23 not covered | storage admission 트리 스캔(admit마다 새로 하는 정확성 검사, D04/WP22 소유)과 mutation마다의 world view 갱신(64 agent에서 4–6 ms)은 바꾸거나 부하 측정하지 않았다. `src/diagnostics/*`는 SCOPE_ONLY. 256 agent 상한은 모형 기준 budget 진술이며 실제 256 unit 측정은 하지 않았다 |
| V25A | kernel: incarnation 1 때 수락되고 확인되지 않은 start와 stop은 incarnation 2가 열린 뒤 reconcile로도 같은 키 재시도로도 효과가 없다(start는 멈춘 unit을 시작하지 않고, stop은 실행 중 run의 InvocationID를 바꾸지 않음). 둘 다 unknown이고 incarnation·desired는 그대로다. 현재 명시적 stop은 성공하고 `confirmDead(a,2)` |
| T36 / WP25.02 | kernel: systemd 257에서 restart 예산 소진은 failed/exit-code로만 남는다. `startLimitStatus`는 NRestarts≥StartLimitBurst로 이를 start_limit으로 보고하고, reset 없는 start는 START_LIMIT으로 거절되며 한도를 풀지 않는다(v2/v3의 kernel 59/60 원인) |
| WP25.03 | fast: 실제 runner entry에 현재 profile과 다른 accepted 자원을 주면 workspace·/tmp·check 한도는 accepted 값이고 모델은 현재 profile 값이다. 자원 env가 없거나 hex가 아니거나 빈 객체·필드 누락·범위 밖·추가 필드·순서가 다른 JSON이면 exit 4로 거절한다. kernel: 설치된 unit의 Environment와 MemoryMax/TasksMax가 현재 profile이 아닌 accepted spec이다 |
| V25B | 기존 oracle로 연결: SEQ-002(runtime-contracts: path·revoke 실패 뒤에도 나머지 stop 단계를 모두 시도하고 결과는 RUN_TERMINATION_UNKNOWN), T38(확인 안 된 stale cgroup은 start를 막고 incarnation 불변), phase4 SEQ-002(옛 run 죽음 불명이면 startup이 메일 정산 전에 멈춤), R37 shutdown(native 결과 불명이면 Store·lock 유지). revoke 뒤 pin은 다음 begin이 비었음을 증명할 때까지 유지 |
| WP25 negative controls | mutant 10개 모두 실패: start-limit 판별 3개(v2 기록 뒤 WP25에서 실행), currentIntent에서 incarnation 제거, reconcile이 옛 plan의 previousIncarnation을 현재 값으로 보정, runner가 workspace 또는 /tmp 한도를 현재 profile에서 읽음, 자원 env 없을 때 현재 profile로 fallback, 비정규 자원 텍스트 수용, unit이 현재 profile을 렌더 |
| WP25 not covered | 실제 Resident 안 엔진 descendant 죽음과 broker 손실·재시작 간격의 전체 kernel 결합(WP30), systemd-managed broker topology의 운영 지원(WP31), WP03 이전에 렌더된 Resident unit의 자동 재렌더(없음; 재생성 필요, WP31 지원표), Principal 세션의 workspace 한도 출처(WP28) |
| WP26 inventory | `implementation/consistency-decisions.md` WP26 절: frame·byte queue·jsonl·channel·response/receipt/request codec·methods·log response·batch view·host channel·credential·run lease·status view·connection·replies·CLI transport/arguments/intent/cache/request service/effects/commands 각각의 신뢰 경계, 예산, 관계, 성공 의미. 권한은 dispatch 때 다시 읽고 await 너머로 저장하지 않으며 resource category는 내부 descriptor에 있다 |
| V26B | R08 조회 시나리오 11개(pending/unknown/terminal/success/SPIKE/명시적 not-found 두 형태만 재전송, 조회 불가·손상 not-found·null·operation 있는 not-found는 재전송 없음)에 더해: 답을 못 받은 `send`는 증명된 REQUEST_NOT_FOUND 뒤에만, 원본 파일이 바뀐 뒤에도 처음 동결한 body로 재전송하고, 수락된 뒤에는 조회만 한다. 정착된 영수증은 뒤늦은 pending 관측으로 바뀌지 않는다. cache가 기록하지 못한 영수증은 영수증과 `--request` key를 보여 주고 영수증의 exit로 끝나며, cache의 이전 관측과 모순되면 exit 3(수정 전 코드에서 실패) |
| V26A/V26C | V26A: R14(모든 header 분할, fatal 뒤 재동기화 없음, 연결 끊김은 dispatch된 작업을 보존하고 대기 요청만 취소, backpressure, half-close), R15 channel generation, P0 malformed frame. V26C: 실제 BrokerChannel에서 요청과 응답 한도는 UTF-8 bytes 기준(문자 수는 맞고 bytes가 넘으면 쓰기 전 거절, 정확히 맞으면 통과), 한도를 넘은 응답은 결과가 아닌 FRAME_TOO_LARGE, 다른 id·모르는 envelope/result 필드는 이 호출의 결과가 아님. R15 response codec, F3/F4, P2 wire golden 유지 |
| WP26 negative controls | mutant 6개 모두 실패: cache가 기록 못 한 영수증에서 CLI 종료(현재 코드로 재실행), 모든 조회 실패를 not-found로, 같은 key 재시도에서 현재 원본으로 재구성, 늦은 pending이 정착 영수증 대체, lock open 실패를 raw 오류로, 요청 예산을 문자 수로 |
| V27A | 실제 엔진 0.85.1, 생성된 rootfs, adapter 자신의 격리 계획, placeholder relay, Anthropic 한 턴을 답하는 TLS 대역: `PiAdapter.deliver`가 경계를 반환하고 세션 파일은 제시된 batch(custom_message oma-mail), `stop`으로 끝난 assistant 메시지, 통지된 entryId와 같은 id의 경계 항목을 그 순서로 가진다. provider는 batch와 실제 key를 봤다. 수정 전 계획(`bwrap`)에서 실패 |
| V27B | 바꿀 문자가 없는 key(서명이 `_-`뿐인 token, 구분자뿐인 key, 긴 구두점 segment)는 즉시 UNSUPPORTED_PROFILE(수정 전 코드는 스택 초과), 제공자가 쓰는 모양은 길이가 같고 key와 다르며 key를 포함하지 않는 placeholder. relay는 provider 답을 오는 대로 넘긴다(첫 bytes가 마지막보다 1초 이상 먼저), T114(키 교체, 경로 제한, 응답 없는 provider는 재전송 없이 504, 동시성 초과는 503, 안전하지 않은 설정 거절) |
| WP27 negative controls | mutant 4개 모두 실패: placeholder 무한 재시도, 격리 계획이 bwrap을 PATH 이름으로, relay가 답 전체를 모은 뒤 전송, 경계 통지가 세션에 없는 항목을 가리킴 |
| WP26/WP27 not covered | 실제 provider와 provider 쪽 재시도·긴 stream(자격 증명 없음, NOT_RUN), 전원 차단 뒤 세션 파일 내구성(WP30), Principal 엔진과 host channel·credential 전체 경로(WP28), 한 key에 대한 동시 CLI 프로세스(`receipt-supersession.test.mjs` 범위 밖). 저장소에 별도 engine lane이 없어 V27A는 durable lane에서 bubblewrap·openssl로 실행된다 |
| V28A | 실제 app과 실제 Maildir: Dashboard는 `N건 Principal 세션에 전달 대기`, 목록은 ●의 뜻과 여는 것이 전달·확인이 아님을 말한다. 관측이 없으면 unknown(이유), 설정 모델은 실행 세션 값과 구분. 메일을 열어도 new/·cur/·mtime 불변 |
| V28B | 실제 pty(python pty + 제품 openTerminal·KeyDecoder): 정상 종료, restore 없는 exit, 터미널 연 뒤 reject 모두 echo·line mode 복원, 복원 뒤 다시 raw·alternate로 들어가지 않음. 코드 포인트 중간에서 쪼개진 입력은 한 key, resize 반영. 이전 코드는 뒤의 두 종료에서 실패 |
| WP28 negative controls | mutant 3개 모두 실패: exit 때 복원 없음, 전달 대기를 unread로, 목록 범례 제거. oma entry의 최상위 catch 정리 순서는 oracle 없음(코드 검토, exit hook이 복원을 보장) |
| V29A | fast: exit 소유 규칙은 직접 호출·참조·element access·destructuring(이름 변경 포함)·globalThis.process·`node:process` named/default import 8가지를 모두 잡고(이전 규칙은 5가지를 놓침), `app.exit()`·`obj.process.exit()`·문자열·주석·`process.env`는 허용한다. set-field recipe에 모르는 method, 없는 field, 배열이 아닌 field를 넣은 실제 TS Program은 각각 컴파일 오류(P22 방식). 기존 P10–P23 oracle 유지 |
| V29B / WP29 scope table | `implementation/consistency-decisions.md` WP29 절: 닫힌 vocabulary(type), brand(type provenance, 이후 관계·일회성·crash 뒤 보장 아님), readonly(type/shallow), decoder(runtime), 권한(효과 시점 runtime), 정적 규칙(source 분석, data flow 밖), owner map·traceability(inventory, 증명 아님), lane requiredNames(실행 증거, 요구사항 포괄 아님), kernel 사실, 전원 차단 내구성(미증명). production-valid config fixture는 실제 loader를 통과하고(V02A), CLI cache 시험은 batch receipt 복구 증거가 아니며, spawn-plan 단위 시험은 argv만 증명한다 |
| WP29 negative controls | 이전 exit 소유 규칙은 V29A alias 사례에서 실패, 느슨한 recipe 타입은 오타를 컴파일한다. 현재 source에는 새 finding 없음 |
| V30A | property: D01 결정표와 DR9로 쓴 독립 모형으로 실제 Store·Mail·영수증·broker 재시작 뒤 `Broker.openRun`을 24 seed × 8 사건에 교차 실행한다. 사건은 7종이다: 게시, 손상, 늦은 이전 시도 영수증(DR9: 재전달 없이 verified), 구간 밖 이른 영수증(conflicting), 가림, 드러냄, 열기. 마지막에 읽을 수 있게 하고 한 번 더 연다(liveness). batch row는 다시 쓰지 않는다. WP30 때의 mutant 3개(읽을 수 없음을 absent로, 충돌을 absent로, 정산 없이 rollover)는 모두 실패했다. DR9 뒤에는 다시 돌리지 않았고, DR9 자체의 변이는 'P0 mutants' 행에 있다 |
| WP30 fault matrix / qualification | FAULT-MATRIX 32행을 oracle에 대응(rollover 뒤 endpoint bind 실패만 commit 실패와 따로 주입되지 않음). node/git-fs·engine·pty·kernel·crash PASS, powercut·실제 provider·CI NOT_RUN. 카드별 mutant 집계는 consistency-decisions WP30 절 |
| V31A | 설치 closure(dist, schema, unit template, package.json, lockfile의 production 모듈)를 새 prefix로 복사하고 원본 트리로의 모듈 해석·파일 읽기를 모두 거절한 채: `check:package` 통과, 자산 해석, 자기 엔진 `--version` 0.85.1, broker·runner·host·CLI entry가 usage 검사까지 로드. 엔진 없는 설치본은 옆에 다른 설치본 엔진이 있어도 UNSUPPORTED_PROFILE(이전 탐색은 그것을 씀) |
| V31B | lockfile 루트의 의존성 종류가 package.json과 같고 production closure에 dev 표시가 없음(이전 lockfile은 실패). package check는 빠진 unit template, 빠진 entry, lock과 다른 의존성 버전을 명시 실패. lockfile 재동기화는 버전 변경 0, 추가·제거 0, dev 표시 160개 해제 |
| V32A | fast: 생성된 review ledger가 현재·기준선 production 파일 모두를 한 번씩 담고, 검토 표시는 작업과 실제 존재하는 시험 oracle을 가진다. 근거 없는 검토 표시, 없는 oracle, 빠진 파일, 손으로 고친 요약은 finding. 미검토 파일이나 NOT_RUN lane이 있으면 승인 거부, 모두 검토·통과일 때만 승인 |
| Oracle closure | V32A: 계획 oracle 73개 모두 자기 ID 시험, 또는 실행 lane(fast/durable/property/stress/kernel/crash)이 요구하는 담당 시험(`implementation/oracle-map.json`), 또는 NOT_RUN(V05C power loss, V30B powercut/provider, V32B CI). 담당이 시험이 아니거나 어떤 lane도 요구하지 않거나 대응이 빠지면 finding |

#### 재검토와 적대적 검증(AV1–AV8)

| 검사 | 결과와 범위 |
|---|---|
| Adversarial mutants (earlier cards) | WP04–WP06, WP11, WP12, WP17–WP22, WP24의 guard를 하나씩 최소 복원한 mutant 30개(일회용 계정): 20개 즉시 실패. 생존 10개 중 9개는 시험 공백, 1개(WP11)는 등가. 공백 9개 중 8개에 oracle 추가(V05A fsync 관측, V06A 디렉터리 EACCES·완료 incarnation/세션, V12B 단일 파일 1 MiB, V12A 완료 전 변경, V18A 교체된 root 보존, V24A 복구 CAS 경합) 뒤 재실행에서 실패. 한 파일 읽기 도중 변경은 결정적 재현 불가 경합으로 코드 검토 근거 |
| Counterexamples | actor socket 연결 폭주: 연결마다 broker socket·pidfd, 상한 없음 → `ACTOR_CONNECTIONS` 16, V26A(400 연결 중 16 이하만 처리, 끝나면 호출 응답; 상한 없는 listener는 실패). relay 유휴 연결 → 동시성 × 4, V27B. 시계를 되돌리면 앞선 날짜의 status view가 현재로 보임 → 새로고침 주기 넘게 앞서면 unknown, T118. 메일·엔진 출력의 터미널 제어 문자 주입은 반증(모든 줄이 displayable을 거침) |
| AV1 | INV04·INV09·CLI-001, durable: CLI가 선언되지 않은 옵션·중복 옵션을 거부하고 옵션 값은 그대로, `--` 뒤는 위치 인자. 확장 도구는 기록된 반례(to에 `--file <host 파일>`, `--kind approval_required` 주입, 임의 reply 경로, 문법 밖 request key)를 CLI 시작 전에 거부하고 broker에는 아무 frame도 가지 않음. 확장 문법 거울이 wire 문법과 같음(INV04 동치 시험) |
| AV2 | INF-007(INF-005 위), durable: placeholder는 authority header(값 전체 또는 `Bearer <p>`)와 `key` query에만 진짜 키로 바뀌고 그 밖(path, 다른 header·query)에 있으면 403. 응답 상태줄·header·본문(청크 경계 포함)에 키가 있으면 sandbox에 닿기 전에 끊김(failed로 한 번 집계), 압축 거부(accept-encoding identity, WebSocket 확장 제거) |
| AV3 | PR-003·PR-004·FS-003·INV04·INV09, fast: Principal 모델 작업공간은 `principal/private/workspace`(provisioning이 만듦, local T114)이고 CLI home도 같은 scratch(FS-003). 작업공간은 세션 이력·엔진 설정/credential 디렉터리·batch view와 어느 방향으로도 겹치지 않고, 작업공간 guard가 세션 파일 read/write/edit를 막음. 겹치는 배치(예전 Principal 배치, credential 디렉터리 포함, Resident 반대 방향)는 엔진 시작 전 UNSUPPORTED_PROFILE |
| AV4 | INV03·FS-005·SB-006, durable: receipt의 session 파일은 세션 디렉터리 아래에서 링크를 따라가지 않는 한 번의 해석으로 찾음(검사 뒤 경로 교체 함정에서 바깥 파일을 받지 않음, 링크 구성요소는 session-invalid). agent가 provisioning을 떠난 뒤(준비 완료가 기록된 사실)의 create 복구는 그 기록을 쓰고 workspace에서 git을 실행하거나 workspace를 걷지 않음 |
| AV5 | FS-005(architecture §4)·INV09, fast/durable: `state-tree-held-parent` 규칙이 src의 경로 기반 fs 변경을 primitive·held parent·descriptor·이유가 적힌 트리 밖 소유자 외에서 거부하고 실제 트리에서 0건. transport spool은 봉인 뒤 staging 경로가 바뀌어도 자기가 해시한 바이트를 읽고 자기 파일만 지움. 잔여: quarantine 스크립트는 private mount namespace 안에서 경로 사용 |
| AV6 | INV02·INV10·INV06, durable: pidfd `poll`의 EINTR은 최대 8회 다시 묻고 끝내 대답이 없으면 failed(exited 아님), POLLNVAL은 failed(EBADF), POLLIN/POLLHUP만 exited. 권한은 대답된 running에서만 유지. fd를 소진해 `/proc`을 읽을 수 없는 프로세스에서 Principal 엔진은 그 순간 응답에서 빠지지만 등록은 retire되지 않고, 엔진이 실제로 죽으면 ended로 retire. 발견 경위: v11 첫 kernel lane 실패 → 부하 반복 재현(약 20회 중 1회) → 거부 순간 EINTR 포착. 수정 뒤 같은 부하 반복 60/60 통과(보조 증거). 잔여: 관측하지 못한 권한의 거부를 CAPABILITY_DENIED로 보고 |
| AV7 | INV02·INV03·arch §23.5, durable: journal 기록이 빠진 커밋은 다음 커밋이 manifest의 직전 generation으로 되써서 수거가 직전 generation을 남김. journal을 읽을 수 없으면 generation을 하나도 지우지 않고 staging만 치움. 현재 generation의 기록이 빠지면 마지막 기록과 기록되지 않은 generation을 남기고 그 이전 기록만 수거. 읽을 수 없는 기존 generation은 '다른 bytes'가 아니라 그 오류(EACCES)로 보고. 볼 수 없는 저장 용량 루트는 BROKER_UNAVAILABLE(0이 아님). 목록을 읽을 수 없는 Principal 메일함은 대시보드에 unknown, 메일 화면에 '일부를 읽지 못함'과 읽은 메일. 잔여: journal이 계속 읽히지 않으면 예산 한도가 재시작으로 풀리지 않음, 기록이 연속 두 번 빠지면 직전 generation을 잃을 수 있음 |
| AV8 | FS-005·INV10·INV12, durable: CLI가 받은 파일(`--file`, `--reply`)은 링크면 따르지 않고 거부, 정규 파일이 아니면(`/dev/zero`) 거부, 요청 frame보다 크면 거부하며 어느 경우도 broker에 frame이 가지 않음. 정규 파일은 본문으로 전송(대조군). WP26 inventory를 코드가 지키는 내용으로 정정 |
| AV mutants | 최소 복원 mutant 41개(일회용 계정): 40개 실패. AV7 9개와 AV8 4개도 모두 실패. AV6 7개(EINTR을 종료로, 다시 묻지 않음, 무한 재시도, POLLNVAL을 종료로, 읽을 수 없는 /proc을 종료로, 모든 /proc 실패를 종료로, 관측 못 한 엔진에 retire) 모두 실패. 생존 1개는 AV1 slot 검증 아래 등가(주소를 `--` 앞에 두어도 같은 파싱). 원칙 재정렬 뒤 AV3·AV4 mutant 6개(범위 검사 제거, 엔진 credential 미보호, CLI home이 scratch 밖, 예전 작업공간, 기록된 준비 완료를 다시 도출, 정산된 workspace를 걸음)를 다시 실행해 모두 실패. 첫 실행의 AV4 함정 오조준과 컴파일 안 되는 mutant 하나는 고쳐 다시 실행해 실패 확인. 단위 회귀가 없는 것: `CreateCoordinator`가 기록된 사실을 `WorkspaceCoordinator.ensure`에 넘기는 연결(kernel lane의 create 복구가 실행) |

#### 엔진 0.87.1(ENG1)

| 검사 | 결과와 범위 |
|---|---|
| ENG1 | 엔진 0.87.1(사용자 요청), durable/local: V27A(동봉 엔진, 제품 격리 계획, 기록된 경계까지 배치 전달), T116(엔진이 OMA 소유 agent 디렉터리에서 credential 해석, 자리표시자에서 진짜 key로 provider 도달), T117(격리된 Resident는 relay로만 provider 도달, trusted extension 적재와 mail custom message), V31A/V31B·package check(설치본이 자기 엔진을 실행, lock과 설치 일치). PI_ADAPTER_REVISION·BATCH-006 `oma-pi-rpc-v1@0.87.1`, BATCH-006 trace 행은 재inventory되어 unverified. 잔여: 0.85.1 adapter의 미정산 영수증은 업그레이드 뒤 conflicting(기존 society는 정산 뒤 업그레이드), 이 변경과 무관한 조항의 기존 trace drift는 그대로 둠 |

#### 실제 provider 기능 점검 1–13차(AV9–AV31)

| 검사 | 결과와 범위 |
|---|---|
| Provider functional runs | 실제 provider(동봉 엔진 0.87.1, gpt-6-luna, 사용자 승인)로 test society 11회: runs 1–5에서 AV9–AV18, 6차 AV20–AV23, 7차 AV24–AV25, 8차 AV26, 9차 AV27–AV30, 12차 AV31, 13차 DR8을 찾았고 각 수정 뒤 재실행으로 확인(`/home/dev/oma-evidence/provider/runs`, 상태는 `archive/`). 이것은 수동 기능 증거이며 provider lane의 자동 실행은 아래 행대로 NOT_RUN |
| AV9–AV19 | unit 없음 관측, 알림 subject·/inbox.md, Principal 도구, reset-failed, sandbox shell, 세션 재개, 표시 이름, sandbox `oma`, 격리 영수증 session 경로(V27A가 영수증 게시·검증까지), 기본 위임 권한 보유, rootfs 경쟁(T115 15/15). 회귀 시험은 lane requiredNames에 있음 |
| AV20–AV23 | REC-002 주기 대조 4개(주기·drain 대기·systemd 모드 제외·timer unit과 같은 간격), runner 재연결(kernel lane), same-key key 안내 2개, 본문 디코드 2개(pinned writer의 두 인코딩에 결박) |
| AV24–AV26 | 도구 실행 중 idle 보류 2개(V10A 불변), 엔진 자신의 edit 도구 입력으로 guard 결박, Human Mail 화면 2개(CRLF 경계·인접 encoded word·본문 디코드, extension mirror 결박) |
| AV27–AV30 | 작업공간 origin 2개(실제 git clone), actual 값 3개(STALE_BASE·CONTEXT_CONFLICT·CLI 표시, 다른 코드는 싣지 않음), context 트리와 actor 주소 1개 |
| AV31 | host 손실 신호(SIGTERM·SIGINT·SIGHUP)마다 drain으로 끝남: 실제 자식 프로세스 3개 신호, entry가 설정 로드보다 먼저 등록(composition). mutant(SIGHUP 제외) 실패. 12차 재실행: 종료 즉시 Resident service 정지, 재시작 시 자동 재개와 batch 재전달 |
| AV20–AV28 mutants | 수정을 되돌린 mutant로 각 회귀 시험이 실패함을 확인: AV20 2(주기 없음, drain 미추적), AV21 1, AV22 1, AV23 1, AV24 1, AV25 1, AV26 1(LF 경계만; TUI 헤더 영역 split만 되돌린 mutant는 본문 소유자가 따로 있어 등가), AV27 1, AV28 2(actual 미적재, 코드 제한 제거). AV9–AV19와 AV29–AV30은 mutant 미실행 |

#### 설계 수정 DR1–DR8

| 검사 | 결과와 범위 |
|---|---|
| DR1–DR8 | DR1 archivePath의 caller view 2개, DR3 details·설명 표 3개(접수 뒤 실패 포함), DR4 host가 주는 code.integrate와 Worker integrate 2개, DR6 재전달 알림·index 1개, DR7 독립 세션 1개, DR8 편집 뒤 integrate(phase7; T62는 접수와 CAS 사이 변경, R19는 사실 변경). 수정을 되돌린 mutant 6개(DR1 view 번역 제거, DR3 details 제거, DR4 host 부여 제거, DR6 재전달 줄 제거, DR7 독립 세션 제거, DR8 시작 시점 정책으로 접수) 모두 해당 시험 실패. 13차 실제 점검에서 DR1·DR3·DR4·DR6·DR7·DR8 확인 |

#### Priority 0(P0V-01–P0V-24, DR9–DR13)

| 검사 | 결과와 범위 |
|---|---|
| Priority 0 audit | 1차: 215개 파일을 묶음 A–J 순서로 읽고 fact·owner·P0-1–P0-7 판정과 근거를 적음. 2차: catch 359곳과 `existsSync` 13곳을 파일 순서로 다시 판정. 발견 P0V-01–P0V-24(P0V-24는 14차 실제 provider 점검)와 수정 commit은 `implementation/priority-0-audit.md`에 있음 |
| DR9 | durable: 이전 시도의 receipt가 새 run이 열린 뒤에 나타나도 재전달 없이 정산(rollover-settlement), batch incarnation 불변(crash-boundaries, r12), receipt 구간 검증(receipt-observation). property: V30A의 late receipt는 verified, 구간 밖 early는 conflicting. updateAgent는 고정 spec을 다시 쓰지 않고 lease는 증가만 |
| DR10–DR11 | durable: accept되지 않은 op의 artifact는 startup이 수집하고 accept된 plan이 가리키는 것은 보존, 수집은 quiesce 뒤·prepare 전(recovery-exhaustiveness). session 파일에 없는 boundary로는 receipt가 없고, session flush 뒤·receipt 전 crash는 receipt를 남기지 않음 |
| DR12 | durable: 오래된 snapshot의 inline 편집 거절, commit point 전 crash는 변경 없음·뒤는 loader가 읽음, flush 실패는 unconfirmed이고 다음 편집이 먼저 flush, 첫 설정은 no-replace. 읽지 못한 설정 파일은 바뀜이 아님 |
| DR13 | durable/local: 읽지 못한 host 정책은 BROKER_UNAVAILABLE(accept된 통합은 pending), CLI는 same-key 실패를 exit 3, 끝나지 않은 unit 명령은 DEADLINE_EXCEEDED, 도구가 멈춘 CLI는 결과 불명과 key, 관측 못 한 workspace 항목은 거절, Control Panel exit은 CLI의 판정, `unobserved`(loader·extension·state root·host 배치·디렉터리), 실행되지 못한 ledger 조회는 손상이 아님, 영속성 불명 저장은 저장됨, 읽지 못한 메시지·extension 디렉터리는 목록을 일부로 표시. local: 거절된 Config 저장 뒤 Control Panel이 설정을 다시 읽어 파일 값을 보이고 다음 편집이 그 값에서 만들어짐(P0V-24, oma-composition-policy) |
| P0-7 gate | fast: `check:boundaries`가 durable primitive 호출 owner 58개 전부에 등록된 kill·retry·restart 시험이 있음을 확인, 등록부에서 빠진 경계·없는 시험은 finding(negative control). 추가 시험: draining broker의 status view 제거, project binding 게시 crash |
| P0 mutants | 수정을 되돌린 변이 25개(작업 트리에서 빌드·해당 시험, 빌드되지 않은 변이는 다시 써서 실행): 24개 실패. 생존 1개는 DR12의 앞선 버전 확인만 제거한 것으로, rename 직전 재확인이 같은 코드로 막는 등가 변이(둘 다 제거하면 실패) |
| Provider run 14 | 수동 기능 점검(lane 증거 아님, 사용자 승인, `/home/dev/oma-evidence/provider/runs/run14-*`, `priority-0-audit.md` "실제 provider 점검(14차)"): DR10 시작 수집 removed 2·kept 0(넣은 흔적만), broker SIGKILL 뒤 batch 두 개가 뒤 시도의 receipt로 정산되고 행 불변(DR9), boundary 8/8(DR11), 재전달 알림, Mail 화면의 일부 읽기 실패 표시(DR13), Config 저장·lost update 거절(DR12), P0V-24 수정 뒤 거절 다음 값 표시와 저장 재확인, 종료 코드 0 |

#### 중간 실행에서 멈춘 것

| 검사 | 결과와 범위 |
|---|---|
| PASS로 바꾸지 않은 실패 | v3(`9f7f551`) kernel 59/60: 실패는 WP25가 고친 `T36`. v4(`6611644`) kernel 61/62: WP25 뒤 갱신되지 않은 `systemd-analyze verify` fixture(`1f6c31e`에서 수정). v11 첫 initial(`0325450`) kernel 62/63: 부하에서 살아 있는 Resident가 CAPABILITY_DENIED(AV6의 발견 경위), 두 번째 initial(`83f1b04`)은 AV7을 고치려 local 도중 중단. v17 final(`140eed8`) durable 474/475: AV14 시험의 뒷정리 경쟁(`4dd80cc`에서 수정). 각각 원인을 고친 뒤 다음 회차가 대체했다 |
| 중간 증거 | v1–v18의 initial·final 산출물은 결박되지 않은 중간 증거로 `/home/dev/oma-evidence/v1`–`v18`에 있다. 현재 판정은 이 절의 트리만 말한다 |

Raw evidence: `/home/dev/oma-evidence/v19/`.

Final PASS condition: `v19-fast-final`, `v19-durable-final`, `v19-property-final`, `v19-stress-final`, `v19-package-final`, `v19-local-final`, `v19-kernel-final`, `v19-crash-final` must bind one digest with exit 0 and zero unrun tests.

## 알려진 한계

현재 제품이 하지 않거나, 현재 트리가 증명하지 않은 것이다. 각 항목의 근거는 괄호 안의 카드·결정 기록에 있다. 검증하지 않은 환경(powercut·provider 자동 lane·CI)은 아래 "남아 있는 release gate"에 있다.

**설치와 배포**
- package가 `bin`이나 설치 명령을 선언하지 않는다. `oma`는 빌드된 entry를 가리키는 alias나 wrapper다(WP31, C2 결정 보류).
- node·git·bwrap은 host에 있어야 한다. 봉인에는 `bwrap`과 `/usr`가 필요하고, 없는 host에서 T117은 이유를 적고 skip되며 그 skip은 `npm test` 실패다. OS별 배포본은 없고 다른 Node·배포판은 NOT_RUN이다(WP31).
- 동봉 엔진을 바꾸기 전에 기존 society의 미정산 batch를 모두 정산한다. 0.85.1 adapter의 receipt는 conflicting으로 보존된다(ENG1).

**운영 형태**
- systemd가 broker를 fixed unit으로 실행하는 형태는 렌더링만 검증했고 지원 목록에 올리지 않는다. 그 형태의 reconcile timer unit은 설치되지 않는다(WP03, AV20).
- `oma`가 broker를 시작하지 않은 society에서는 Principal 대화 세션을 열지 않고 Control Panel로 남는다. 대화는 broker를 소유한 `oma`에서 이어간다.
- WP03 전에 렌더된 Resident unit은 자동으로 다시 렌더되지 않는다. 다시 만들어야 한다(WP25).
- 바인딩된 state root를 옮기려면 migration이 필요하다(WP16).

**보안 경계**
- Yama ptrace scope 0인 host에서는 같은 UID의 프로세스가 engine을 trace할 수 있어 Principal 권한 경계가 성립하지 않는다.
- quarantine 스크립트는 private mount namespace 안에서 경로를 쓴다. WebSocket frame header가 key 바이트를 가르면 응답 tripwire가 보지 못한다. 관측하지 못한 권한은 거부하되 CAPABILITY_DENIED로 보고한다(바꾸면 정산 분류가 달라진다)(AV1–AV5).
- 추가 role extension은 core extension의 제한 밖에서 도는 trusted code가 될 수 있어 운영자가 따로 검토한다(operations).

**동시성과 내구성**
- S-03: 실행 중인 turn 안의 delivery boundary 귀속은 미결이다. Principal delivery는 idle session에만 전달하므로 Human의 긴 turn 동안 전달이 기다린다.
- 설정 편집은 비협조적인 same-UID writer와의 동시 편집을 지원하지 않는다. 전원 차단 뒤의 순서는 증명하지 않았다(WP12, WP13).
- 설정 journal이 계속 읽히지 않으면 generation 예산에서 편집 거절이 재시작으로 풀리지 않는다. journal 기록이 연속 두 번 빠지면 직전 generation을 잃을 수 있다(AV7).
- 저장 용량은 kernel hard quota가 아니다. SQLite·WAL 증가는 측정만 했다(WP22).
- accept되어 성공한 submit·context의 staging 디렉터리는 남는다(WP20. 14차 실제 점검에서도 보존을 확인).
- 한 key에 대한 동시 CLI 프로세스는 검증 범위 밖이다(WP26).
- v1 코드가 이미 재할당한 prepared batch는 저장된 값을 첫 시도로 읽는다. 그보다 이른 시도의 receipt는 전처럼 conflicting이다(DR9).

**비용과 추적**
- 비용 상한은 OMA 계약이 아니다. relay가 요청 수·동시성을 쥐지만 stream을 해석하지 않는다(INF-005).
- traceability의 requirement는 모두 `unverified`다. owner·callPath·negative test가 연결된 것도 compliance 기록 절차를 거치지 않았다.

**보류한 결정과 검증 공백**
- `bin`·설치 명령(C2), WP03 이전 Resident unit의 재생성 절차.
- 전체 `oma` entry의 pty 시험(최상위 catch의 정리 순서), rollover 뒤 endpoint bind 실패의 별도 주입(WP30).

## 기본 재검증

실제 명령 정의는 [package.json](../package.json)이 기준이다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
node scripts/loc.mjs
```

source/import graph가 바뀌었다면 current dependency evidence를 재생성한다.

```sh
npm run evidence:graph
npm run check:architecture
```

dependency evidence의 current path는 `implementation/evidence/dependency-graph.json`이다. Generated list, LOC/hash, dependency evidence를 사람이 새 실행처럼 수동 보정하지 않는다.

mutation 하나만 수정할 때는 먼저 관련 surface를 좁힌다.

```sh
npm run mutation:locality -- git.submit
```

focused test를 실행하더라도 전체 invariant/release 의미로 승격하지 않는다.

## 환경별 verification lane

각 output directory는 기존 artifact를 덮지 않는 새 경로를 사용한다.

```sh
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
```

필요한 systemd/kernel/provider/VM 환경이 없으면 PASS가 아니라 `BLOCKED` 또는 `NOT_RUN`으로 기록한다. 일반 개발 host의 SIGKILL/process fixture를 VM power-loss proof로 취급하지 않는다.

## A-008 LOC gate — 현재 OPEN

`node scripts/loc.mjs`의 현재 source-bound 결과는 **224 files / 23,763 code LOC**이며 A-008 기준을 넘는다. 이 브랜치의 변경 뒤 LOC/hash와 dependency graph를 다시 만들었지만 review/release gate는 OPEN이다. 기능 작업은 멈추지 않기로 했고 architecture review는 별도 작업이다. 동봉 엔진은 수정하지 않은 upstream 의존이라 LOC-003에 따라 계산 대상이 아니며, 엔진을 수정하면 계산 대상이 된다(TUI-018).

이 gate가 열려 있다는 사실을 기능 추가의 승인으로 해석하지 않는다. TUI 및 제품 표면 source도 TUI-015/LOC-003에 따라 같은 manifest와 같은 budget으로 계산하며, 별도 manifest로 분리해 Core 수치에서 제외하지 않는다.

## 남아 있는 release gate

- `spikes.md`의 OPEN qualification 조건은 fresh harness evidence 없이 닫지 않는다.
- live systemd/cgroup/READY, provider failure/usage/cancel, hostile import, filesystem/kernel containment, VM power-cut/ENOSPC/read-only/restore 등 environment-specific proof는 별도다.
- S-08/S-10 tiered attestation/floor와 S-11 clean-room, S-09 품질·비용·latency 평가는 해당 profile 계약을 따른다.
- LOC/A-008/A-009 판정은 `node scripts/loc.mjs`의 current source-bound 결과로만 갱신한다.
- requirement별 release proof는 [compliance.md](compliance.md)를 따른다.

과거 상세 실행 로그, 감사 기록, 단계별 PASS 기록은 [docs/archive.md](../docs/archive.md)가 가리키는 snapshot에서 조회한다.

## 보존하는 verification 규범

**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

**MUST [VAL-002]** 구현 시작 시 [spikes.md](spikes.md)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](test-matrix.md)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
