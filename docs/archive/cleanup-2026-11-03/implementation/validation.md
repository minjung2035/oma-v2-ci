# OMA v2 — 현재 검증 상태

DR64의 과거 typed tool 표면 전환 기록과 후속 collaboration-v1 작업은 구분한다. collaboration-v1 fresh admission·cutover는 닫혀 있다.
실제 Sol medium 비교와 native Darwin qualification은 미완료다.
아래 실행 결과는 각각 고정된 당시 입력의 기록이다. 현재 변경의 최종 결과는 첫 절에 둔다.

## Deadline reader/native checkpoint — MCS-AUD-12

90분 제한 실행 시작은 `2026-11-03T05:05:07Z`, 마감은 `06:35:07Z`이다. **전체 PARTIAL / source NOT_REVIEWED**를 유지한다. [MCS-AUD-12](../priority-0-audit.md#mcs-aud-12--contained-grep가-파일명의-숫자를-행-metadata로-오인)는 fresh search metadata renderer의 actual defect 교정과 별도 current reader/native positive를 설명한다. 원래9개 `SCN-R01–09`의 FAIL을 네 개의 새 PASS로 지우지 않는다. archived P0V-36/37의 본문·의미·관측 FAIL도 보존했다.

로그는 `/tmp/oma-goal-mvzejzp1/`에 보존했다. 아래 실행들은 각각 당시 입력이며 합산하지 않고 후속 canonical prebinding도 소급하지 않는다.

| 실행 | 결과/범위 |
|---|---|
| `deadline-reader-typed-build.log`, `deadline-reader-typed.log`, `.exit` | build0; body-bound2개 중1 FAIL. 실제256KiB emoji case의 contained grep가 UUID 내부 숫자에 header 공백을 삽입하는 차이를 관측. 초기 fixture/type 오류와 oversized-line 진단 로그도 `deadline-reader-*`로 별도 보존 |
| `deadline-search-before-build.log`, `deadline-search-before.log`, `.exit` | 새 deterministic header6개 모두 FAIL, 796.280868ms, exit1. 원래 형식의 파일명/구분자 훼손 재현. 원시 로그를 덮어쓰지 않음 |
| `deadline-search-current-build.log`, `deadline-search-current.log`, `.exit` | build0; header/reader/hashline bundle 선택 exit0. 후속 filename-LF 강화와 native4개 전 입력 |
| `deadline-native-review-before-build.log`, `.exit` | build2: 새 fixture가 current open의 candidate를 identity 밖으로 읽은 타입 오류; 실행 증거 없음 |
| `deadline-native-review-fixture-build.log`, `deadline-native-review-fixture.log`, `.exit` | build0;24개 중23 PASS/1 FAIL,16550.472783ms. Native Worker의 read schema가 요구하는 explicit offset/limit를 fixture가 생략. P0 파일의 나머지23개는 PASS지만 전체 FAIL 유지 |
| `deadline-native-review-read-build.log`, `deadline-native-review-read.log`, `.exit` | build0; native HIGH1개 FAIL,18452.864082ms. 실제 Principal status가 `review target`을 게시하는데 fixture가 `approval target`으로 추측한 오류. actual status와 반대되는 product 변경 없음 |
| `deadline-native-review-target-build.log`, `deadline-native-review-target.log`, `.exit` | actual published target로 HIGH1개 PASS, exit0. native Worker write/bash/oma_merge와 두 Worker exact review, Principal exact review, actual CAS. scripted provider/trusted fixture auth 한계 유지 |
| `deadline-reader-native-build.log`, `.exit` | build2: new fixture row는 `key`가 아니라 `request_key`; 실행 증거 없음 |
| `deadline-reader-native-current-build.log`, `deadline-reader-native-current.log`, `.exit` | build0; 네 파일(header8, body-bound2, native4, P0 잔여23)37개 PASS, fail/cancel/skip/todo0, exit0. LF filename/context·16KiB/256KiB 본문·current LOW/MEDIUM/HIGH CAS 및 Principal final rejection. 전체 fixed-source/whole-local/packed-install/actual provider qualification 아님 |
| `deadline-final-{build,inventory,source-digests,source-graph,typecheck,package,architecture}.log`, 각 `.exit` | whole-local 전 build/generators/static 모두 exit0, frozen architecture SHA-256 확인. generated evidence는 authored/runtime approval이 아님 |
| `deadline-final-inputs.sha256`, `deadline-final-whole-local.log`, `.exit`, `deadline-final-whole-local-inputs-check.log`, `.exit` | canonical+SDK+세 archive+원래 명령15857개를 고정. 원래 `npm test` 전체 실행 `05:54:43Z–06:15:42Z`, exit1. **serial14/14**, fail/cancel/skip/todo0,134115.920931ms. **parallel4530개:4328 PASS/201 FAIL/1 SKIP**, cancel/todo0,1111934.483728ms. bounded reporter가 전체 결과를 읽었고 입력 check0. 외부 timeout 발동은 없었으며 raw639518633 bytes는 그대로 보존 |
| `deadline-final-whole-local-projection.log` |639518633 bytes/9228 lines를 전부 scan한 진단 projection. 각 행 최대1800 characters,48개 긴 행 preview truncation 공개. failure locator는 원인·qualification이 아니며 raw의 대체물이 아님 |
| original runner raw TAP | `/var/tmp/oma-test-summary-vasd24` 보존. missing delegated cgroup v2 cpu/memory/pids에 따른 IMP-B01/B02 SKIP와 unrun directive를 reporter가 NOT A PASS로 처리. unreadable/RangeError를 PASS로 바꾸지 않음 |
| `deadline-final-isolation.log`, `.exit`, `deadline-final-isolation-inputs-check.log`, `.exit` | original packed install checker27개 모두 exit0, source15857 입력 check0. 일부 Pi closure의 foreign declaration diagnostics44는 별도이며 authored declarations/installed runtime 범위만 PASS. 후속 test-fixture-only NUL 입력 정정 전 source이고, 새 생산 parser 및 MCS-AUD-11 gate에 대한 패키지 실행이지만 provider/kernel/full qualification은 아님 |
| `deadline-search-progress-build.log`, `.exit`, `deadline-search-progress-inputs.sha256`, `deadline-search-progress.log`, `.exit`, `deadline-search-progress-inputs-check.log`, `.exit` | whole-local의 G10-02 두 fixture가 native `--null` 대신 old metadata를 출력하던 입력만 정정. 원래 delay/heartbeat/death/cleanup/output oracle 보존. build0; 위5개 파일67/67, fail/cancel/skip/todo0,129152.461454ms, exit0; 실행 중15857 입력 check0. 이전 whole-local201 FAIL에서 임의로 두 개를 빼지 않으며 전체 재실행 아님 |

마감 전 관측: `06:28:42Z` dirty status407 entries. 이전401/406과의 차이를 inherited/new work의 원인별 count로 해석하지 않는다. 해당 시각 `oma-scn/testlocal/native/local-test` 및 runner/isolation command와 일치하는 잔존 프로세스는 관측되지 않았지만 모든 kernel owner/process-death qualification을 주장하지 않는다. roots/raw를 일괄 삭제하지 않았다. 후속 결과 보고·trace·생성물은 이전 whole-local/packed/selected manifest의 실행 당시 bytes와 구분한다.


fresh admission·기본 노출·cutover·배포·commit/push/merge 없음. full spec/source authored review, original9개 scenario 보장, 나머지 실패 families, full verify/kill/platform/provider/held-out A/B/C와 운영 qualification은 미완료다.

## Accepted legacy integration의 실행과 원래 사실 분리 checkpoint

입력: `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` + 보존된 dirty WIP, SDK1.2.0. **전체 PARTIAL / source NOT_REVIEWED / 마지막 whole-local FAIL**. [MCS-AUD-11](../priority-0-audit.md#mcs-aud-11--accepted-구형-integration-plan을-current-scope로-실행)의 범위는 original reviewed integration plan v1/v2의 actual owner 실행을 제거하고 원래 사실을 보존하는 것이다. fresh admission·activation·cutover·배포·commit/push/merge 없음.

- before 재현은 current original v3 review와 actual accepted qualified vote가 있어도 old prepared-context 없는 plan이 실행됨을 확인했다. real main=base인4개는 실제 candidate로 이동했고, main이 이미 candidate인4개를 포함한8개 pending/unknown 모두 succeeded가 됐다. 이 관측은 별도 bounded JSON diagnostic으로 원시 로그에 남았다. authenticated peer 공격이나 notice publication qualification은 아니며 explicit original stored corpus의 notice는 빈 배열이다.
- 교정은 integration owner에서 canonical observation/notice/settlement와 failure-state 변환 전에 명시적 비호환을 반환한다. 기존 raw JSON·hash·key·original state를 보존하고 eligibility/direct publication의 legacy version 분기를 제거했다. terminal receipt replay를 현재 실행 허가로 바꾸지 않는다.
- 후속17개 회귀는 old version × pending/unknown × base/candidate/third main, 실제 current vote continuation, 두 번 Store reopen/same-key receipt, 다른 PID의 fresh Node 실제 Git composition/reconcile, unavailable current policy 아래 original succeeded/failed receipt, obsolete-tool 없는 새 refusal을 검사한다. current-context 실제 CAS·challenge/race/records/fault/large-patch 회귀는 별도 정상 controls다. 이전 positive oracle의 이름을 no-execution PASS로 바꾼 것이 아니다.

로그는 `/tmp/oma-goal-mvzejzp1/`에 보존했다. 실행들은 합산하지 않으며 아래 local 선택에 canonical 전체 prebinding을 소급하지 않는다.

| 실행 | 결과와 범위 |
|---|---|
| `review-plan-retirement-before-build.log`, `review-plan-retirement-before.log`, 각 `.exit` | build0; 새 refusal oracle8개 모두 FAIL, cancel/skip/todo0,2349.388588ms, exit1. current stored decoder를 통과한 actual owner에 expected rejection 없음 |
| `review-plan-retirement-observed-before-build.log`, `review-plan-retirement-observed-before.log`, 각 `.exit` | build0; 같은8개 모두 FAIL, cancel/skip/todo0,2381.277922ms, exit1. 각 case의 original/observed main·state로 실제 CAS/terminalization 확인. 첫 FAIL을 덮어쓰지 않음 |
| `review-plan-retirement-current-build.log`, `review-plan-retirement-current.log`, 각 `.exit` | build0; native guarded serial8개 파일93/93, fail/cancel/skip/todo0,59583.075996ms, exit0. 최초 교정과 fresh refusal9개를 포함한 선택; 이후 third-main/terminal/fresh-process 강화 전 입력 |
| `review-plan-retirement-fresh-build.log`, `review-plan-retirement-fresh.log`, 각 `.exit` | build0; 같은8개 파일의 강화된 단일 실행101/101, fail/cancel/skip/todo0,63912.665476ms, exit0. 새17개를 포함하며 fresh Node에서 original payload/plan/hash/state와 parent의 refs/facts 보존을 대조. 이 보고 전 입력이고 전체 fixed-source/whole-local/kill/provider 증거는 아님 |
| `review-plan-retirement-bound-{build,inventory,source-digests,source-graph,typecheck,package,architecture,scoped-diff}.log`, 각 `.exit` | 후속 문서/trace를 포함한 build/generators/static/scoped diff 모두 exit0. frozen architecture hash OK. generated evidence는 runtime/authored approval이 아님 |
| `review-plan-retirement-bound-inputs.sha256`, `review-plan-retirement-bound-test-files.log`, `review-plan-retirement-bound-regressions.log`, `.exit`, `review-plan-retirement-bound-inputs-check.log`, `.exit` | canonical+SDK+두 archive+선택 목록15853개 입력을 고정하고 원래34개 파일에 새 regression1개를 더한35개 파일 실행: **385개 중374 PASS/11 FAIL**, cancel/skip/todo0,156486.116797ms, exit1. 전후 입력 check0. P0V-36/37의 retired-reader2개와 scenario9개가 여전히 FAIL. 이전368/357/11이나 부분101 PASS와 합산하지 않음; whole-local/packed-install 재실행이 아님 |

나머지 원래 확대 선택11 FAIL 및 마지막 whole-local FAIL은 위 부분 PASS로 상쇄하지 않는다. 모든 old envelope/accepted-plan execution·historical scope recovery·Views/profile·운영/drain 판정, changed durable boundary의 kill/retry/full restart, 실제 platform/kernel/peer/provider/serializer qualification, Client/scenario 전체 변형, authored review·mandatory verify·held-out A/B/C와 새 whole-local은 남아 있다. production admission/default exposure는 닫힌 상태다.

## Current completion notice와 owned diff 실행 분리 checkpoint

입력: 동일 HEAD와 보존한 dirty WIP, SDK1.2.0. **전체 PARTIAL / source NOT_REVIEWED / 마지막 whole-local FAIL**. [MCS-AUD-10](../priority-0-audit.md#mcs-aud-10--current-완료-notice가-은퇴한-reader와-direct-diff-실행을-유지)은 current 준비 뒤 남은 direct diff fallback과 새 완료 메일의 retired reader 안내를 독립 재현·제거한 범위다. activation·cutover·배포·commit/push/merge 없음.

- current integration은 원래 accepted prepared context와 owned diff primitive를 요구한다. obsolete 실행 port/export를 제거했고 full/compact notice는 같은 role-neutral records guide를 사용한다. 새 authority·durable entity·protocol을 추가하지 않았다. original accepted receipt/plan/EML은 재생성하지 않는다.
- negative control은 actual settled context/ready 상태에서 primitive 누락을 검사한다. 원래 facts/refs·pending work를 그대로 보존하며 unsupported refusal 뒤 sweep, Store reopen, same-key receipt가 새 효과를 만들지 않는다. 마지막에 원래 current owner로 명시적 advance하면 같은 context로 real Git CAS가 성공한다. test-only allocation hook/extra callback은 fault input이며 supported legacy API 또는 실제 broker crash proof가 아니다.
- full/compact actual EML에서 실제 request status와 published child material graph를 따라 complete applied patch를 일반 contained reader로 읽고 독립 Git CLI bytes와 대조한다. Principal에게는 Worker patch를 만들지 않고 다른 역할 root/raw archive는 읽기 거절한다. accepted rows와 frozen archive는 read/reopen/reconcile 뒤에도 그대로다. Worker mount path mapping은 fixture-only라 actual mounted/authenticated Worker·full Pi/hashline qualification으로 승격하지 않는다.
- 앞선 oversize fixture는 removed direct-diff seam 대신 원래 current GitRepository preparation/attachment owner를 사용하며 no-recompute/no-repeated-fact/no-ref-change를 검사한다. stored refresh 시험은 historical decoder에서만 수락하고 live grammar에서는 거절함을 함께 검사한다. P0 supervision fixture는 explicit isolated current birth 뒤 invalid channel에 도달하도록 했으며 missing-birth production fence를 낮추지 않았다.
- 확대 선택의 scenario9개는 아직 old caller 경로에 있다. default Resident의 actual spec/AuthContext는 git.submit을 갖지만 fixture의 임의 `rXX.submit` key는 selected model session의 original Pi invocation fence를 통과하지 못한다. 실제 composition→HostInvocations 순서를 대조했으며 이 거절을 없애기 위해 capability·admission·selection을 느슨하게 하지 않는다. 이후 old tool/Principal patch/caller request-key 기대는 별도 미도달 계약이므로9개 전부를 fixture 탓으로 분류하거나11개를 전체 남은 일로 세지 않는다.

로그는 `/tmp/oma-goal-mvzejzp1/`에 보존했다. 아래 결과는 서로 다른 당시 입력의 개별 실행이며 합산하지 않는다.

| 실행/입력 | 결과와 범위 |
|---|---|
| `review-preparation-fixture-build.log`, `review-preparation-fixture.log`, `.exit` | build PASS; native guarded serial56/56, fail/cancel/skip/todo0,26001.301694ms, exit0. original expanded FAIL 뒤 stored refresh/current oversize fixture 교정. canonical 전체 prebinding은 이 실행에 소급하지 않음 |
| `review-boundary-fixture-build.log`, `review-boundary-fixture.log`, `.exit` | build PASS;81개 중79 PASS/2 FAIL, cancel/skip/todo0,29649.88486ms, exit1. supervision은 실제 channel refusal에 도달했지만 P0V-36/37의 은퇴한 mail reader 호출이 여전히 FAIL. 이를 삭제·skip·단순 no-tool PASS로 바꾸지 않음 |
| `review-notice-before-build.log`, `review-notice-before.log`, `.exit` | build PASS;42개 중38 PASS/4 FAIL(부모 subtest failure 포함), cancel/skip/todo0,28198.109748ms, exit1. actual context 뒤 direct diff callback1회와 full/compact retired tool 안내를 독립 재현 |
| `review-notice-current-build.log`, `review-notice-current.log`, `.exit` | build PASS;72개 중69 PASS/3 FAIL(부모 포함), cancel/skip/todo0,35640.345223ms, exit1. fallback/control·historical receipts·large exact patch는 통과했으나 새 discovery 시험이 root index에 leaf를 기대한 오류; 기존 child-page 계약을 따라 읽게 교정 |
| `review-notice-pagination-build.log`, `review-notice-pagination.exit` | build exit2/TS7022, native test 미실행. local prefix/material annotation 후 재실행; runtime FAIL을 fixture 오류로 덮어쓴 기록이 아님 |
| `review-notice-discovery-build.log`, `review-notice-discovery.log`, `.exit` | build PASS; native guarded serial72/72, fail/cancel/skip/todo0,35474.99095ms, exit0. 위5개 파일의 단일 새 실행이며 이 보고/추가 export-absence assertions 전 입력. canonical 전체 binding과 final 확대 실행은 후속 별도 결과로 기록 |
| `review-owned-final-{build,inventory,source-digests,source-graph,typecheck,package,architecture,scoped-diff}.log`, `.exit` | build/generators/static/scoped diff 모두 exit0, frozen architecture hash OK. export-absence assertions를 포함한 당시 입력이며 authored approval/runtime qualification은 아님 |
| `review-owned-final-inputs.sha256`, `review-owned-final-test-files.log`, `review-owned-final-regressions.log`, `.exit`, `review-owned-final-inputs-check.log`, `.exit` | canonical+installed SDK+original adoption archive의15850개 입력을 고정하고34개 파일을 native guarded serial 실행: **368개 중357 PASS/11 FAIL**, cancel/skip/todo0,152433.573409ms, exit1. 전 입력 unchanged check exit0. P0V-36/37의 retired reader2개와 scenario9개가 여전히 실패했다. 이후 packed-smoke/doc 변경의 결과나 whole-local PASS로 재사용하지 않음 |
| `review-owned-package-isolation-before.log`, `.exit`, `review-owned-isolation-inputs-check.log`, `.exit` | 원래 tarball checker **26/27 PASS,1 package FAIL**, exit1; 위15850개 입력 unchanged check exit0. Review smoke의 original v1 scope 실행 기대가 `UNSUPPORTED_PROFILE` 대 `INTEGRATION_CONDITIONS`에서 실패. original body/의미는 별도 archive로 보존하며 current no-execution PASS로 재명명하지 않음 |
| `review-owned-current-smoke-probe.log`, `.exit` | workspace-only Review probe exit0. historical read/refusal과 별도 current qualified scope/live roster/cancel/missing-request 관측; 설치·Store·peer·CAS/provider qualification 아님 |
| `review-owned-installed-current-inputs.sha256`, `review-owned-package-isolation-current.log`, `.exit`, `review-owned-installed-inputs-check.log`, `.exit` | 원래 tarball checker **27/27 PASS**, exit0, canonical+SDK+두 archive15851개 입력 unchanged check exit0. packed Git에서 retired port/export 부재도 실제 검사했다. Pi 의존7개 closure의 foreign declaration diagnostics44는 그대로 별도 보고하며 authored declarations는 통과. 이후 Review normal spec fixture를 production validators로 강화했으므로 그 후 source의 설치 결과로 자동 상속하지 않음 |
| `review-owned-qualified-smoke-probe.log`, `.exit` | 위 후속 normal spec/fact fixture 강화 뒤 workspace-only probe exit0. 아직 이 probe만으로 최신 tarball 설치 또는 whole-local 성공을 주장하지 않음 |
| `review-owned-qualified-final-{build,inventory,source-digests,source-graph,typecheck,package,architecture,scoped-diff}.log`, 각 `.exit` | normal resolved-spec qualification fixture 강화 뒤 build/generators/static/scoped diff 모두 exit0, frozen architecture hash OK. 후속 MCS-AUD-11 production 교정 전 입력의 기록이며 현재 source에 상속하지 않음 |
| `review-owned-qualified-final-inputs.sha256`, `review-owned-qualified-final-isolation.log`, `.exit`, `review-owned-qualified-final-inputs-check.log`, `.exit` | 강화한 spec fixture를 포함한15851개 canonical+SDK+두 archive 입력에서 원래 packed-install checker27/27 PASS, exit0; 전후 입력 check0. foreign Pi declaration diagnostics44는 별도 유지. 이 결과 역시 후속 integration execution gate 전 입력이며 whole-local/current 전체 install qualification이 아님 |

남은 범위: original-release drain/명시적 비호환의 전수 실행, obsolete public payload·accepted-plan execution·Views/profile/error guidance·old caller scenario, 모든 Client variant, 실제 broker/engine crash·power loss·인증/OS/provider/serializer qualification, authored source review·mandatory verify·A/B/C 및 새 whole-local. 이전 넓은 선택 FAIL과 마지막 whole-local FAIL은 이 부분 PASS로 상쇄하지 않는다.

## DR72 review adoption 제거와 original scope 실행 분리 checkpoint

입력: 동일 HEAD `a47f70af146791370d3b8e68aad88813654eaf12`와 보존한 dirty WIP, SDK1.2.0. **전체 PARTIAL / source NOT_REVIEWED / 마지막 whole-local FAIL**. [MCS-AUD-09](../priority-0-audit.md#mcs-aud-09--fresh-review-adoption과-저장된-adoption-fact의-혼용)은 새 adoption 생성과 historical scope의 current 실행 승격을 구분해 독립 재현·교정한 범위다. fresh admission·activation·cutover·배포·commit/push/merge 없음.

- fresh caller/Client/preparation에서 `review.adopt`를 제거했다. original frozen payload/fact를 읽는 closed grammar와 타입은 live admission과 분리했으며 original JSON·hash·plan·receipt를 재작성하지 않는다.
- original open v3/no-adoption gate를 fresh targeted record, T 재검사, sweep/advance와 최종 CAS에서 공유한다. old/new advancement 선택과 direct version2 integration 생성은 제거했다. current 통합은 원래 accepted prepared context를 요구한다.
- original v1/v2 open, v2/v3 adoption fact의 read와 pending/unknown/succeeded receipt 관측을 fresh execution으로 승격하지 않는다. historical corpus는 명시적 fixture이며 real original-release drain·마이그레이션 승인·새 authority를 증명하지 않는다.
- 원래 `IMP-R19`와 `AUD-01` adoption-positive 시험의 의미와 원문은 [보관 기록](../archive/retired-review-adoption-oracles.md)에 남겼다. 실제 거절 FAIL도 아래처럼 보존한다. current no-adopt 시험은 새 DR72 이름으로 합법적 cancel/fresh proposal·새 vote/context, 실제 publication 지연 경계의 no-stale-CAS/no-corruption·original vote/receipt 불변과 explicit host retry를 검증하며 옛 acceptance가 PASS했다고 재분류하지 않는다.
- `runCheck`는 원래 fixture의 controlled port다. bare exception을 confirmed failure로 가정한 새 fixture 오류를 원래 `CHECK_FAILED` 계약으로 바로잡았으며 실제 shell 실패를 mock 성공으로 바꾸지 않았다. Direct Review auth는 명시적 fixture이지 kernel peer 인증 증거가 아니다.

원시 로그는 `/tmp/oma-goal-mvzejzp1/`에 보존했다. 아래 중간 결과는 각각 당시 입력이며 이후 source에 자동 상속하지 않는다.

| 실행 | 결과와 판정 |
|---|---|
| `review-retirement-before-build.log`, `review-retirement-before.log`, `.exit` | build PASS;5개 중2 PASS/3 FAIL, cancel/skip/todo0,781.165777ms, exit1. current caller grammar가 adoption을 허용하고 requester/host의 새 adoption이 거절되지 않음을 재현 |
| `review-retirement-first-build.log`, `review-retirement-second-build.log` | build exit2: stored payload를 fresh DTO로 잘못 typing한 관계와 제거된 caller kind를 사용한 옛 adoption-positive 계약 충돌. production 타입을 넓혀 통과시키지 않음 |
| `review-retirement-current.log`, `.exit` |23개 중20 PASS/3 FAIL, cancel/skip/todo0,14051.498764ms, exit1. original IMP-R19/AUD-01의 fresh adoption 기대가 `INVALID_REQUEST: unknown attestation kind`로 거절됨; 이후 archive/새 DR72 oracle로 적용 계약을 명시적으로 구분 |
| `review-retirement-race-build.log` | build exit2, 새 current-context 시험의 optional preparation ID 미확인. 실제 존재 assertion 뒤에만 원래 context를 조회하도록 교정 |
| `review-retirement-history-build.log`, `review-retirement-history.log`, `.exit` | build PASS;26/26, fail/cancel/skip/todo0,17022.133412ms, exit0. fresh no-adopt와 historical states의 Store reopen/original receipt·mail bytes·Git 보존 및 current cancel/fresh proposal/host retry; 뒤의 historical execution gate와 새 process read 시험 이전 입력 |
| `review-history-execution-before-build.log`, `review-history-execution-before.log`, `.exit` | build PASS;10개 중8 PASS/2 FAIL, cancel/skip/todo0,1875.761599ms, exit1. 새 fixture의 bare check exception은 `INTERNAL_ERROR`/pending이지 confirmed failed가 아니어서 후속 adoption execution 재현에 아직 도달하지 못함 |
| `review-history-execution-valid-before-build.log`, `review-history-execution-valid-before.log`, `.exit` | build PASS;10개 중8 PASS/2 FAIL, cancel/skip/todo0,2271.408199ms, exit1. 원래 `CHECK_FAILED` fixture로 교정 후 current-policy/qualified-vote를 갖춘 historical adoption scope에 `record`/`advance`가 거절되지 않음. source/effect의 전수 qualification 주장은 아님 |
| `review-current-scope-build.log`, `review-current-scope.log`, `.exit` | build PASS;30/30, fail/cancel/skip/todo0,18326.097202ms, exit0. old/adopted scope의 current record/advance/sweep/CAS 거절과 v1/v2 original open 관측을 추가. 이후 literal receipt oracle·별도 process Store read 추가 이전 입력이며 canonical 전체 binding을 이 실행에 소급하지 않음 |
| `review-final-{build,inventory,source-digests,source-graph,typecheck,package,architecture}.log`, `.exit` | 당시 static chain 모두 exit0, frozen architecture hash OK. authored source approval/runtime qualification이 아님 |
| `review-final-inputs.sha256`, `review-final-test-files.log`, `review-final-regressions.log`, `.exit`, `review-final-inputs-check.log` | 당시 canonical+installed SDK15849개 입력을 먼저 고정하고33개 파일을 native guarded serial로 실행:360개 중346 PASS/14 FAIL, cancel/skip/todo0,143400.562963ms, exit1. 전 입력 unchanged check exit0. literal historical receipt/별도 process Store read는 이 실행에서 통과했지만 전체 선택 실행은 FAIL. oversize/stored refresh, P04의3개, scenario9개 실패를 전부 fixture 오류로 분류하지 않음. 이후 fixture/notice 교정 결과는 다음 checkpoint의 별도 입력이며 이 FAIL은 그대로 유지 |

남은 범위: old public payload/accepted-plan 실행·Views/profile 기본 branch·운영/drain/rollback 전수, 실제 Client/인증·broker/engine crash·전원 장애·실 platform/provider qualification, 전체 source review·mandatory verify·A/B/C 및 새 whole-local. 아래 이전314/94/768 선택 성공도 현재 전체 완료 근거가 아니다. 변경한 durable acceptance 경계의 원래 kill/retry/restart 시험과 현재 source-bound 확대 실행 결과는 후속 행으로 남긴다.

## DR35 private 대화와 Principal 권한 분리 후속 checkpoint

입력: 동일 HEAD와 보존한 dirty WIP, SDK1.2.0. **전체 PARTIAL / source NOT_REVIEWED / 마지막 whole-local FAIL**. [MCS-AUD-08](../priority-0-audit.md#mcs-aud-08--private-대화-준비를-broker-권한-부여와-다시-합침)은 current birth의 private engine까지 broker ready/record RPC 뒤로 미룬 실제 회귀다. 기존 DR35 oracle을 ready-only 동작에 맞춰 낮추지 않았다. activation·cutover·배포·commit/push/merge 없음.

- `society-runtime.ts`는 current-plan private engine을 lease/private-path admission 뒤 한 번 연다. 정본 records refresh는 여전히 credential registration 전이다. readiness/engine/handle/generation을 async observation 뒤 재검사하고 stale refresh/registration은 권한을 주지 않는다. startup setup 실패는 자동 재시작하지 않고 explicit restart와 실제 child exit를 요구한다.
- `HostTenure`가 initial private preparation과 후속 engine의 ready gate를 소유한다. broker loss 뒤에는 initial permission을 successor 시작에 재사용할 수 없다. Human private control editor가 terminal을 보유하면 initial/ready event 둘 다 기다리고, local release 뒤에만 engine을 연다.
- `provisionSociety`는 허용된 record **container만** 준비한다. 실제 filesystem 시험에서 empty ledger/health/index를 만들지 않고 기존 health와 birth bytes를 보존한다. 기존 owned primitive가 stray symlink 자체를 교체해도 target inode/mode/bytes는 바꾸거나 projection으로 복사하지 않는다. 이는 accepted ledger/receipt의 GC나 SDK/provider/peer-authentication 증거가 아니다.
- 후속 isolated provisioning child의 before/after-call 실제 SIGKILL·fresh-process retry를 추가했다. scope는 directory 준비와 원래 birth bytes이며, accepted operations나 SDK/broker/provider를 흉내 낸 검증이 아니다. 각 child의 close 관측 전에는 fixture root를 지우지 않는다.
- composition fixture에는 실제 birth admission/human-controls owner와 current Worker surface·record binding을 공급했다. current birth seed는 격리 fixture이며 fresh admission·old birth 승격·peer 인증이 아니다. 기존 credential 거절·generation·exit/lease·signal·큰 catalog·프로젝트 observation·Personal 전환 oracle을 유지한다.
- one-engine positive control은 각 broker generation의 registration까지 settle한 뒤 다음 readiness를 보낸다. 세 registration/한 engine oracle은 그대로다. 별도 overlapping refresh negative control은 이전 generation이 늦게 풀려도 broker registration effect에 도달하지 않음을 검사한다.
- 후속 P18/DR46 두 fixture drift는 current source에서 별도로7개 중5 PASS/2 FAIL로 재현했다. readonly shared-reachability port, async Society control와 optional review expectation, 현재 status projection과 constructor의 invocation-reader binding을 반영했다. exact projected-key/no concrete owner/live query oracle은 유지하고 shared-read failure를 false로 바꾸지 않는 부정 oracle을 추가했다. 원래 Store 손상이 startup effect를 막는 검증과 실제 incarnation COMMIT 전/후 SIGKILL·earlier receipt 불변 oracle도 유지한다.

원시 로그는 `/tmp/oma-goal-mvzejzp1/`에 보존했다.

| 실행/입력 | 결과와 한계 |
|---|---|
| `composition-current-fixture-before.log`, `.exit` | 독립 재현79개 중44 PASS/35 FAIL, cancel/skip/todo0, exit1,15529.146683ms. DR35의 missing engine과 별도 TUI stand-in `resetInput` 누락을 구분; 모든35개를 제품 결함으로 단정하지 않음 |
| `private-conversation-build.log`, `private-conversation-first.log`, `.exit` | build PASS;110개 중109 PASS/1 FAIL, cancel/skip/todo0, exit1,15181.812664ms. 새 async records-before-registration 때문에 겹친 generation의 stale registration을 거절한 one-engine positive fixture의 순서 가정을 별도 교정 |
| `private-conversation-current-build.log`, `private-conversation-current.log`, `.exit` | build PASS;135개 중134 PASS/1 FAIL, cancel/skip/todo0, exit1,23647.524781ms. 새 symlink 시험이 기존 owned stray repair에도 `throws`/link 보존을 기대한 fixture 오류; helper를 느슨하게 하지 않고 원래 수리 계약과 독립 outside-bytes oracle을 검사 |
| `private-conversation-final-build.log`, `private-conversation-expanded.log`, `.exit` | build PASS; native guarded serial **228/228**, fail/cancel/skip/todo0, exit0,42219.196636ms. App/broker composition·tenure/Principal ownership·실제 record container·old/missing birth refusal 및 실제 SDK cold custom/groups·interactive control/host ownership/current launch regressions. controlled source composition과 SDK/scripted-provider 시험을 함께 돌렸다는 뜻이며 실제 App 전체 PTY·1/5초 latency·native Darwin/live inference·전체 source review/whole-local/full verify는 아님; 이 실행 전 canonical 전체 hash binding은 수행하지 않음 |
| `private-conversation-inventory.log`, `private-conversation-source-digests.log`, `private-conversation-source-graph.log`, `private-conversation-typecheck.log`, `private-conversation-package.log`, `private-conversation-architecture.log`, `private-conversation-scoped-diff.log` | 원래 generator/static chain 모두 exit0. generated runtimeProof:false이며 authored source approval/runtime qualification이 아님 |
| `private-conversation-bound-inputs.sha256`, `private-conversation-bound-regressions.log`, `.exit`, `private-conversation-bound-inputs-check.log` | canonical verification traversal+installed SDK6 manifest/session source의 **15847개 hash**를 먼저 고정한 뒤 위11개 파일을 새 단일 실행: native guarded serial **228/228**, fail/cancel/skip/todo0, exit0,42103.336871ms. 전 입력 unchanged check exit0. 이전 선택 실행을 합산하지 않았으며 whole-local/full verify 아님. 이후 추가한 이 보고 행과의 차이는 별도 검사 |
| `private-record-kill-build.log`, `private-record-kill.log`, `.exit` | 후속 test-only fixture 추가 뒤 build PASS; native guarded serial21/21, fail/cancel/skip/todo0, exit0,1583.204613ms. 실제 provisioning 직전/전체 호출 반환 직후의 별도 Node child를 SIGKILL하고 close(signal=SIGKILL)를 확인한 뒤 **다른 새 process**로 retry한다. birth bytes 불변, empty permitted container/0700, Git/ledger observation 생성 없음; child owner가 모두 닫힌 뒤에만 root 정리. direct-Node guard 전파/explicit-env·shell/manager refusal17개도 함께 유지. 이것은 개별 mkdir/fsync 사이 모든 지점·broker/engine crash·power-loss qualification이 아니며, 앞228개 hash binding 이후의 추가 시험 입력이다 |
| `broker-boundary-current-before.log`, `.exit` | 독립 실행7개 중5 PASS/2 FAIL, cancel/skip/todo0, exit1,1019.745586ms. P18 exact port catalog drift와 DR46 stand-in의 invocation-reader binder 누락을 source와 대조; 제품 admission/Store gate를 느슨하게 하지 않음 |
| `broker-boundary-current.log`, `.exit` | native guarded serial71/71, fail/cancel/skip/todo0, exit0,35734.684264ms. 위 boundary7개·provisioning4개와 실제 Client create/review 및 host invocation/mail record 회귀. narrow-port fixture는 auth/provider qualification이 아니며 선택 성공으로 whole-local을 재계산하지 않음 |
| `composition-final-{build,inventory,source-digests,source-graph,typecheck,package,architecture}.log` | 후속 fixtures를 포함한 원래 build/generator/static chain 모두 exit0. generated runtimeProof:false이며 authored review·운영 qualification을 대신하지 않음 |
| `composition-final-inputs.sha256`, `composition-final-regressions.log`, `.exit`, `composition-final-inputs-check.log` | canonical traversal+installed SDK6 manifest/session source의 **15848개 hash**를 실행 전에 고정하고 위18개 파일을 함께 새로 실행: native guarded serial **314/314**, fail/cancel/skip/todo0, exit0,78549.861501ms. 전 입력 unchanged check exit0. 이전228·21·71을 합산한 결과가 아니라 중복 없이 실행한 단일 새 결과이며 whole-local/full verify 아님. 이 두 보고 행 이후의 차이는 validation 문서와 별도 대조 |

기존 whole-local의 App61/broker17 loader cluster를 단순히 전부 fixture 오류로 분류하지 않는다. current source에서 wiring fixture drift와 DR35 제품 회귀를 분리했고 선택 시험을 새로 실행했다. 원래 whole-local FAIL/1 SKIP은 그대로이며 전체 재실행과 나머지307개 실패 family의 개별 점검, legacy payload/plan/adoption/Views 제거, 운영/drain·mandatory qualification·A/B/C가 남아 있다.

## Whole-local 실패 분류와 wait/summary/process-owner 후속 checkpoint

입력: 동일 HEAD와 보존한 dirty WIP, SDK1.2.0. **전체 PARTIAL / source NOT_REVIEWED / 마지막 whole-local FAIL**이다. 아래 후속 선택 실행은 이전 serial5 FAIL·parallel307 FAIL/1 SKIP을 과거 PASS로 바꾸거나 전체 성공으로 합성하지 않는다. activation·cutover·배포는 하지 않았다.

- `scenario-agent-wait`의5개 실패는 퇴역 도구 이름/입력 때문에 실제 send·wait에 도달하지 못한 fixture drift였다. current `oma_send`/`oma_wait`로 교정했다. ACK action은 되살리지 않고 명시적 과거 terminal ACK fixture를 넣어 원래 plan/payload/hash/receipt가 wait·재시작·성공 delivery 뒤에도 그대로인지 검사한다. 원래 실제 bash sibling 결과의 history persistence, wait 뒤 continuation 없음, delivery/ACK 분리, delayed observation과 재시작 oracle을 유지한다. 이것은 새 ACK 실행·original-release drain 검증이 아니다.
- `scripts/local-test-summary.mjs`는 전체 TAP 문자열 또는 무제한 한 행 대신 bounded chunk/행 preview로 **모든 bytes**를 스캔한다. 원래 unrun count owner를 호출하고 missing/nonzero counts·읽기 오류를 PASS로 바꾸지 않는다. 개별 SKIP/TODO가 zero summary와 모순되어도 실패한다. 진단 preview는 생략 수/잘림을 표시하며 원본 TAP을 바꾸지 않는다. `test-local.mjs`는 실패·signal·불완전 결과의 raw TAP을 보존한다.
- 독립 회귀는 chunk edge의 SKIPPER false positive, chunk/UTF-8 경계의 실제 directives, preview 밖의 marker,205개 directive의 전체 count, missing/count/CRLF/EOF, 실제 CLI의 FAIL/SKIP/TODO/cancellation을 검사한다. V8 문자열 한도보다 큰 sparse diagnostic fixture에서 구형 whole-file UTF-8 읽기의 동일 RangeError를 재현한 뒤32MiB heap의 새 scanner가 끝까지 읽고 unrun을 거절함을 확인한다. sparse NUL body는 scanner stress fixture이지 valid TAP/provider/kernel qualification 주장이 아니다.
- 기존 R35의 첫 후속 실행은34개 중33 PASS/1 FAIL이었다. durable lane이 이미 이행된 display/index reader의 옛 title3개를 가리킨 selector drift로 구분했다. 현재 contained record/index·canonical display 회귀의 실제 title로 locator만 맞췄고 해당 시험/원래 bytes·pagination oracle은 지우지 않았다. 옛 `/inbox.md` alias나 extension reader를 다시 실행했다는 뜻이 아니다.
- `principal-session-ownership`은 current plan·원래 Principal workspace/session scope·effective bounds를 명시하고, `session-process-owner`의 controlled loader는 원래 native cleanup owner를 공급한다. 입출력/queue/unknown-delivery/실제 child exit·descriptor 분리·pre-spawn refusal oracle은 유지한다. scripted engine/controlled spawn이며 actual SDK/provider/전체 UI qualification은 아니다.

로그는 `/tmp/oma-goal-mvzejzp1/`에 있다.

| 실행/입력 | 결과와 한계 |
|---|---|
| `wait-current-build.log`, `wait-current-serial.log` | build PASS; native guarded 원래 serial 두 파일14/14, fail/cancel/skip/todo0, exit0,119058.914073ms. 이전 whole-local serial 실패를 소급 변경하지 않음 |
| `session-owner-before.log`, `.exit` | current source의 독립 재현27개 중2 PASS/25 FAIL, no unrun, exit1.13개 current launch scope 누락과12개 controlled import 누락을 확인 |
| `local-summary-first.log` | scanner/runner 회귀는 통과했으나34개 중33 PASS/1 stale required-name FAIL; 전체 PASS 아님 |
| `local-summary-current.log`, `.exit` | scanner/runner/R35와 실제 display/index 회귀52/52, no unrun, exit0,8378.399117ms. 그 뒤 cancellation 독립 case를 추가했으므로 최종 입력의 결과로 재사용하지 않음 |
| `session-owner-current-build.log`, `session-owner-summary-current.log`, `.exit` | build PASS 뒤62개 중61 PASS/1 FAIL, no unrun, exit1. 새 cancellation fixture의 무기한 Promise가 test IPC와 남아60s timeout; reporter 자체의 성공으로 표시하지 않음 |
| `cancelled-fixture-descendants.log` | 위 실패에서 남은 원래 두 fixture process의 cwd를 확인하고 pidfd로 pin한 뒤 종료/사망을 관측했다. partial raw TAP은 남겼다. 새 fixture는 명시적 test cancellation timeout을 사용하고 owner 미정산 시 root를 삭제하지 않음; 제품 process-death qualification은 아님 |
| `wait-summary-owner-inputs.sha256`, `wait-summary-owner-inputs-check.log`, `session-owner-summary-final.log`, `.exit` | 후속11개 명시 입력 unchanged, native guarded80/80, fail/cancel/skip/todo0, exit0,12211.551206ms. process-owner27개·reporting/policy35개·display18개.11개는 제한된 checkpoint binding이지 canonical 전체 closure binding이나 whole-local 결과가 아님 |
| `wait-summary-owner-inventory.log`, `wait-summary-owner-source-digests.log`, `wait-summary-owner-source-graph.log`, `wait-summary-owner-typecheck.log`, `wait-summary-owner-package.log`, `wait-summary-owner-architecture.log`, `wait-summary-owner-scoped-diff.log` | 원래 generator/static chain 모두 exit0. generated runtimeProof:false이며 source approval/runtime qualification 아님. 이 행과94개 결과 행을 더하기 전의 입력 |
| `wait-summary-owner-bound-inputs.sha256`, `wait-summary-owner-bound-regressions.log`, `.exit`, `wait-summary-owner-bound-inputs-check.log` | canonical verification traversal+installed SDK6 manifest/session source의15846개 hash를 실행 전에 고정. 원래 serial 두 파일과 위 owner/reporting/display를 함께 native guarded serial로 실행하여 **94/94**, fail/cancel/skip/todo0, exit0,131071.231768ms; 전 입력 unchanged check exit0. 이전14·80을 합성한 값이 아니라 새 단일 실행이며 whole-local/full verify 아님. 이후 이 validation 보고 행만 추가했으므로 실행 manifest와의 차이는 따로 검사 |
| `whole-local-case-index.log`, `whole-local-raw.sha256` | 원래584848224-byte raw log의312개 failure case를56개 파일로 indexing: serial5/parallel307과 일치.11776행을 bounded projection으로 읽고 raw SHA-256 unchanged 확인. 각 case locator/첫 diagnostic은 원인 판정이 아닌 조사 단서 |

원래 whole-local의 유일 SKIP은 `IMP-B01/B02`의 **delegated cgroup v2 cpu/memory/pids parent 부재**였다. bwrap/native namespace 실행 불가와 혼동하지 않는다. 실제 cgroup lane은 아직 NOT_RUN/BLOCKED이며 SKIP을 지워 전체 PASS를 만들지 않는다. parallel 전체307개를 fixture 탓으로 단정하지 않는다. index에서61개 App composition과17개 broker composition의 loader dependency drift가 보이지만 각 oracle/실제 source와의 대조는 남아 있다. 다른 launch/admission·obsolete tools·provider/PTY·stored journal·static inventory/review 실패도 별개다. 현재 whole-local 재실행 및 full verify/legacy 제거/원래 저장 사실의 drain·거절/전체 authored source review/실제 provider·Darwin·A/B/C는 여전히 미완료다.

## Child policy retirement와 Personal PTY native workload 후속 checkpoint

입력: 동일 HEAD의 보존한 dirty WIP, pinned SDK cohort1.2.0. **전체 PARTIAL / source NOT_REVIEWED / activation·cutover·배포 없음**. 아래745개 실행은 당시 입력의744 PASS/1 FAIL로 그대로 남으며 이번 교정의 전체 PASS로 바꾸지 않는다.

- [MCS-AUD-07](../priority-0-audit.md#mcs-aud-07--child-policy의-구형-기본-분기가-current-profile-검사를-생략): `packages/config/src/policy.ts`의 legacy/default selector를 제거했다. fresh resolution/observation에는 항상 current Worker capability 검사를 적용하고 production/scenario caller의 selector도 삭제했다. accepted plan/receipt recovery owner를 현재 config validator로 바꾸지 않았다.
- `test/collaboration-child-policy.test.ts`: pure current/refusal·transaction 안 host read 없음·원본 config/input 불변과 실제 Lifecycle의 수락 전 refusal을 검사한다. 실제 selected create 뒤 current policy observation failure·Store reopen에도 원래 plan/payload/hash/agent/receipt/비-DB 파일 bytes·effect 수가 유지된다. in-process reopen과 controlled execution port이며 original-release drain·fresh-process crash·power-loss·authenticated Worker/provider 증거는 아니다.
- Personal PTY는 SDK shell 자체가 아니라 **host-shell을 금지하는 local backstop과 원래 unconfined PTY harness의 계약 불일치**였다. `scripts/local-test-guard.mjs`의 거절/전파 조건은 변경하지 않고 `test/fixtures/personal-native.ts`에서 기존 ExecutionRuntime/Journal로 PTY 전체를 소유한다. native workload는 명시 clean env, read-only host/install tree, fixture-only regular-file 쓰기, private `/tmp`·`/var/tmp`·`/run`, 분리된 PID/mount/network namespace와 manager executable mask를 사용한다. 이 workload 안에는 JS backstop을 주입하지 않으며, actual SDK shell은 물리 경계 안에서 원래 명령을 실행한다. 이를 guard 없는 원래 host-shell 실행이나 production Personal sandbox/전체 OMA containment qualification으로 표시하지 않는다.
- 원래 `shell=done`, installed-only module/data guard, provider request/tool/result, config/history/UI, exit와 terminal restoration oracle은 유지한다. `tools`는 부모와 다른 실제 namespace identity, installation write의 `EROFS`, manager exec의 `EACCES`, 원래 canary bytes도 확인한다. 원래 owner가 scope 전체 사망과 journal retirement를 확인한 뒤에만 반환하며 cleanup 불명에서는 fixture/install과 원래 journal을 보존한다. 이 추가 harness는 Linux qualification이며 Darwin은 NOT_RUN이다.

작업 로그는 `/tmp/oma-goal-mvzejzp1/`에 있다(배포 evidence bundle 아님).

| 실행/입력 | 결과와 한계 |
|---|---|
| `child-policy-before-build.log`, `child-policy-before.log` | build PASS 뒤8개 중1 PASS/7 FAIL. resolver4개는 우회 재현; actual-path3개는 canonical base/source owner 누락 fixture 실패로 구분 |
| `child-policy-valid-before-build.log`, `child-policy-valid-before.log` | valid fixture로 정상화 후8개 중2 PASS/6 FAIL, cancel/skip/todo0, exit1. resolve/observe4개는 Missing expected exception, actual create2개는 Missing expected rejection; accepted replay positive control은 PASS |
| `child-policy-current-build.log`, `child-policy-current.log` | selector 제거 후 build PASS, native guarded serial34/34, fail/cancel/skip/todo0, exit0,25674.989409ms. 새8개와 authority lineage·creation observations·Worker autonomy·selected create boundaries/Client recovery/capacity 포함; whole-local 아님 |
| `personal-native-build.log`, `personal-native-first.log` | build PASS 뒤40개 중24 PASS/16 FAIL, exit1. 새 helper가 닫힌 execution slot 어휘 밖의 `personal-pty`를 사용하여 pre-exec 거절; product slot 어휘를 늘리지 않고 기존 `preparation`으로 교정 |
| `personal-native-slot-build.log`, `personal-native-slot.log` | build PASS 뒤40개 중24 PASS/16 FAIL, exit1. 별도 ipc/uts 옵션이 원래 pinned sandbox grammar에서 미지원; parser를 완화하지 않고 기존 `--unshare-all` plan을 사용 |
| `personal-native-profile-build.log`, `personal-native-profile.log` | build PASS, native guarded serial40/40, fail/cancel/skip/todo0, exit0,72808.40318ms. 원래 Personal PTY16개와 host-shell/manager refusal·explicit-env descendant backstop 등 guard24개; live inference/Darwin/power-loss qualification 아님 |
| `child-policy-owner-inventory.log`, `child-policy-source-digests.log`, `child-policy-source-graph.log` | 원래 generator로 owner inventory/source digests/dependency graph 갱신, 모두 exit0; runtimeProof:false이며 authored source review/qualification 아님 |
| `child-policy-typecheck.log`, `child-policy-package.log`, `child-policy-architecture.log`, `child-policy-scoped-diff.log` | root typecheck/static package/full architecture/scoped diff 검사 모두 exit0. 이 static chain은 아래 report 추가 전 입력이며 report 뒤 document/architecture 재검사는 별도 기록 |
| `child-policy-native-inputs.sha256`, `child-policy-native-regressions.log`, `child-policy-native-regressions.exit`, `child-policy-native-inputs-check.log` | canonical verification traversal+installed SDK6개 manifest/실제 inspected session implementation의15844개 hash를 실행 전 고정. native guarded serial **768/768**, fail/cancel/skip/todo0, exit0,341705.74994ms. 실행 뒤 모든 입력 unchanged 확인 exit0. 이전745 FAIL을 변경하거나 합산한 결과가 아니며 전체 local/모든 verify lane 아님 |
| `child-policy-package-isolation.log`, `child-policy-package-isolation.exit`, `child-policy-after-isolation-inputs-check.log` | 원래 tarball checker27/27 workspace install/export/assets/authored declaration/선언된 installed runtime smoke PASS, exit0. 입력15844개 unchanged 확인 exit0. Pi 의존7개 closure의 foreign declaration diagnostics44는 그대로 별도 보고하며 vendor declaration 전체 clean·provider/platform proof가 아님 |
| `child-policy-whole-local.log`, `child-policy-whole-local.exit`, `child-policy-after-whole-local-inputs-check.log` | 원래 `npm test` 전체 실행 **FAIL, exit1**, canonical15844개 입력은 전부 unchanged, check exit0. 원래 runner는549 files, parallel547개/concurrency4, serial2개를 보고. spec stdout의 serial14개는9 PASS/5 FAIL, parallel4478개는4170 PASS/307 FAIL/1 SKIP, 두 단계 cancel/todo0. 전체 PASS가 아니며 선택768 성공으로 덮지 않음 |
| `child-policy-whole-local-diagnostics.log` | 원시 whole-local log가100MB를 넘어 도구의 text-read 한계를 초과하여 raw11776개 행에서 diagnostic projection을 생성. 각 diagnostic 행은1800자까지만 표시하고 원본은 별도 보존; 이것을 전체 raw evidence로 대체하지 않음. runner도 커진 TAP summary를 문자열 한도 때문에 읽지 못해 `NOT A PASS: ... summary unreadable: Cannot create a string longer than 0x1fffffe8 characters`를 보고. 이 reporter 결함과307개 parallel FAIL/실제 SKIP은 별도이며 다음 교정 대상 |

**현재 전체 local은 FAIL**이다. serial wait/delivery5개를 먼저 현재 도구/원래 accepted·delivery 사실과 대조하고, parallel 실패를 fixture·계약 drift·실제 결함으로 개별 분류한다. 모든 실패가 fixture 탓이라는 주장을 하지 않는다. old broker/client payload·accepted-plan 실행·review.adopt·Views/default·운영/drain 전수 제거, 전체 source review, full verify, 실제 platform/provider·A/B/C도 계속 남아 있다. 이 보고 추가 뒤에는 validation 문서 bytes만 execution manifest와 달라지며 아래 report 후 검사는 별도다.

## SDK custom-message prompt 경계와 domain retirement 후속 checkpoint

입력: 동일 HEAD와 보존한 dirty WIP, 사용자 [DR73](../design-revisions.md#dr73--custom-message-전달의-공개-prompt-계약을-위해-공식-sdk-120을-고정한다) 승인 뒤 official SDK cohort 1.2.0. **전체 PARTIAL / source NOT_REVIEWED / activation·cutover·배포 없음**. 아래 이전379/309 및 static PASS는 새 source/dependency 검증으로 재사용하지 않는다.

[MCS-AUD-06](../priority-0-audit.md#mcs-aud-06--custom-message-run을-ordinary-prompt와-같은-초기화로-가정)은 실제 native Worker 전달에서 correct cumulative catalog와 policy payload가 다를 수 있음을 재현했다. official 1.2.0 public custom-message run preparation을 사용하고, OMA delivery·prompt owner 및 저장 delivery protocol bytes는 유지한다. vendor/private state 패치·provider codec 복제·ordinary `prompt()` 우회·guard 완화는 하지 않았다.

구형 domain `packages/domain/src/tool-surface.ts`와 export는 삭제했고 실제 test/harness 소비자를 current catalog 또는 명시 거절로 이행했다. 이는 구형 broker/client payload/accepted-plan 실행·review.adopt·profile/views·운영/drain 전수 제거의 완료가 아니다. 삭제된 owner와 stale test locator를 원래 source map/document owner에서 정리했다. historical exact-selection TSP-001/003/006은 text/fingerprint를 보존하고 owner/evidence를 비워 unverified로 유지하며, cumulative group PASS를 과거 계약의 완료로 재분류하지 않는다. generic registry invariant의 current owner 변경도 기존 generator가 evidence를 무효화한다. 전체 architecture·규범 적용성 심사가 완료됐다는 뜻이 아니다.

원시 로그는 `/tmp/oma-goal-mvzejzp1/`에 있다(작업 환경 로그; 배포 evidence bundle 아님).

| 실행/입력 | 결과와 한계 |
|---|---|
| `domain-retirement-focused.log` | 새 domain/harness focused155개 중152 PASS/3 FAIL, exit1. 이후 개별 성공으로 이 실행을 PASS로 바꾸지 않음 |
| `sdk-delivery-before-inputs.sha256`, `sdk-delivery-before-build.log`, `sdk-delivery-before.log` | pinned1.0.1에서 build PASS 뒤9개 중8 PASS/1 Worker leading-system FAIL, exit1; ordinary/warm Principal은 negative 대체물이 아님 |
| `sdk-1.2.0-pack.log` | official coding-agent1.2.0 tarball 확인; SHA-256 `1dfed308f46a69aec06bf9dc20700ddc6fe2370b1898f01334b7898397541e66`; source/types/docs 검토는 runtime/provider qualification 아님 |
| `sdk-1.2.0-install.log`, `sdk-1.2.0-tree.log` | original npm lock owner로 설치, coding-agent/AI/TUI/agent-core/codemode/MCP1.2.0 고정; vendor asset bytes를 수정하지 않음 |
| `sdk-1.2.0-first-build.log`, `sdk-1.2.0-delivery-first.log` | 동일9개 regression9/9, exit0; actual Worker/Principal 전달과 ordinary Principal의 최초·후속 payload 및 durable member result/exposure ordering |
| `sdk-1.2.0-compat-before-admission.log` |23개 중20 PASS/3 FAIL. exact old UI version fence 두 건과 explicit-current plan 없는 옛 fixture 한 건; production fence를 완화하지 않고 원래 version inventory 및 fixture를 수정 |
| `sdk-1.2.0-compat-current.log` |108개 중62 PASS/46 FAIL. host UI fixture가 새 domain admission owner를 제공하지 않아 `requireCollaborationSurface is not a function`; 실제 validator/current plan을 fixture에 연결, product validator를 stub으로 바꾸지 않음 |
| `sdk-1.2.0-expanded-build.log`, `sdk-1.2.0-expanded-current.log` | build PASS 및 native-namespace guarded serial176/176, fail/cancel/skip/todo0, exit0,21211.229433ms. cold custom-message 두 역할·discovered context/provenance·append suppression·mail task-context 귀속·same-batch refusal·resume/원래 journal prefix bytes 보존 및 기존 Engine UI/Personal owner 회귀 포함 |
| `sdk-1.2.0-typecheck.log`, `sdk-1.2.0-package.log`, `sdk-1.2.0-functional-surface.log` | root typecheck/static package/functional surface smoke 모두 exit0. smoke는 deterministic assistant stream이며 live provider/broker/crash qualification 아님 |
| `sdk-1.2.0-package-isolation.log` | 실제 tarball install27개 중26 통과/extension1 FAIL, exit1. 설치 시험이 제거된 `oma_mail_read`를 호출함; 구형 등록을 복구하지 않고 current catalog/contained record read/invalid action/원본 archive 보존 시험으로 이행 |
| `sdk-1.2.0-extension-composition-probe.log` | 이행한 extension smoke의 workspace probe exit0; 이 자체는 isolated tarball 설치 PASS가 아님 |
| `sdk-1.2.0-broad-regressions.log` | native guarded serial721개 중711 PASS/10 FAIL, cancel/skip/todo0,321702.528724ms. 8개는 current Principal launch scope/원래 effective byte bounds가 없는 기존 UI fixture; Personal shell1 및 LSP live-child env1은 별도 조사. 이 실행을 아래 부분 재실행으로 전체 PASS로 만들지 않음 |
| `sdk-1.2.0-package-isolation-current.log` | 확장 회귀+설치를 한 command에 연달아 넣은 실행이600초 한도에 도달.26개 workspace의 stage PASS가 있어도 마지막 App 및 종료를 완료로 주장하지 않음; 전체 command는 timeout |
| `guard-environment-before.log`, `guard-environment-current.log` | 원래 guard가 direct Node child의 명시 env에 `NODE_OPTIONS`를 뒤에서 주입해 LSP oracle을 오염시킴. 새 environment/propagation oracle6개가 모두 먼저 FAIL(17개 중11 PASS/6 FAIL). 같은 backstop을 direct Node argv/fork execArgv로 운반한 뒤 원래 manager/shell 거절·명시 env:{} descendant 거절·새 env 보존을 합쳐24/24, skip0, exit0. 거절 조건은 완화하지 않았고 non-Node launcher는 원래 env 전파를 유지 |
| `sdk-1.2.0-fixture-current.log` |51개 중43 PASS/8 FAIL, skip0, exit1. 원래 LSP deny-by-default 전체43개는 guard를 켠 채 통과. UI fixture의 current scope 교정 뒤 effective bounds가 없다는 거절을 추가로 확인 |
| `sdk-1.2.0-ui-control-build.log`, `sdk-1.2.0-ui-control-current.log` | current host scope·원래 byte bounds를 UI fixture에 명시한 뒤 build PASS/원래8개 UI/control regression8/8, skip0, exit0. product admission을 바꾸지 않음 |
| `sdk-1.2.0-package-isolation-final.log` | 원래 설치 checker를 단독 재실행:27/27 workspace의 tarball install/export/asset/authored declaration 및 선언된 installed runtime smoke PASS, exit0.7개 Pi 의존 closure는 기존 checker가 foreign declaration diagnostics44개를 각각 별도 보고; authored diagnostics0이지 vendor 전체 declaration clean이나 live-provider/platform qualification이 아님 |
| `sdk-1.2.0-owner-inventory.log`, `sdk-1.2.0-source-digests.log`, `sdk-1.2.0-source-graph.log` | 원래 owner generator로 trace links·14368개 production source digests·dependency graph 재생성, 모두 exit0. normative text/fingerprint와 과거 authored review를 새 PASS로 바꾸지 않음; runtimeProof:false |
| `sdk-1.2.0-typecheck-current.log`, `sdk-1.2.0-package-current.log`, `sdk-1.2.0-architecture-current.log` | 새로운 typecheck/static package/full architecture chain 모두 exit0. source list·rule·transaction·boundary·document·spec inventory 검사는 runtime/source review/전체 legacy 제거 증거가 아님 |
| `sdk-1.2.0-source-bound-inputs.sha256`, `sdk-1.2.0-source-bound-regressions.log`, `sdk-1.2.0-source-bound-regressions.exit`, `sdk-1.2.0-source-bound-inputs-check.log` | 원래 canonical verification-input traversal에 installed SDK cohort6개 manifest와 inspected `agent-session.js`를 더한15842개 input hash. 실행 전 고정→native guarded serial745개 실행→동일 input 전부 재검사 exit0. **744 PASS/1 Personal shell FAIL**, cancel/skip/todo0, exit1,321537.38077ms. 기존 retired-session/birth admission/Client/review/receipt/death/SDK/UI 및 guard 새 oracle을 함께 재실행. whole-local/필수 verify lane 전체가 아니며 아래 보고문 추가 뒤에는 validation 문서 bytes만 달라짐 |

**이 checkpoint 당시 잔여 FAIL:** guarded Personal installed PTY의 `tools` case는 실제 SDK bash 실행을 test-only backstop이 거절하여 `shell=done` effect oracle이 실패했다. SDK bash나 oracle을 mock/skip으로 바꾸거나 guard를 끄지 않았다. 지원되는 격리 실행과 guard 계약의 정합성은 미완료이며 이 lane과 전체 목표는 완료가 아니다. live provider·Darwin·power-loss·original-release drain·실제 모델 A/B/C 및 whole-local도 여전히 미완료다.

176개 실행 명령은 Node26와 기존 native-host namespace에서 다음 선택을 한 번 serial로 실행했다. fixture SDK 도구의 일부는 inert catalog이고 HTTP endpoint의 답변은 scripted model이다. 실제 native Worker 전달과 이 fixture의 보장 범위를 합쳐 live-provider·모든 플랫폼·전체 action·power-loss·source review·A/B/C를 완료한 것으로 읽지 않는다.

```sh
bash /tmp/oma-native-host.njsfv3/run.sh \
  /home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin/node \
  --import ./scripts/local-test-guard.mjs --test --test-concurrency=1 \
  dist/test/pi-compat.test.js dist/test/interactive-startup.test.js \
  dist/test/collaboration-groups-engine.test.js dist/test/scenario-tool-surface.test.js \
  packages/engine/test/interactive-*.test.mjs \
  packages/engine/test/personal-engine-ownership.test.mjs \
  packages/extension/test/prompt-boundary.test.mjs
```

## Society birth admission과 production fallback 제거 checkpoint

입력: 동일 HEAD의 보존한 dirty WIP. **전체 PARTIAL / source NOT_REVIEWED / activation·cutover·배포 없음**.
아래309회귀와 static PASS는 이 후속 product/source 변경 전 별도 checkpoint이며 재사용하지 않는다.

- [MCS-AUD-05](../priority-0-audit.md#mcs-aud-05--현재-plan-주입이-구형-society-birth를-worker-opt-in으로-승격):
  old/missing birth에 explicit current plan을 공급하면 Native Worker owner가 구성되는 결함을 수정 전에 재현했다.
  원래 birth owner에서 execution admission을 검사하고 CLI bootstrap·standalone broker·Worker 조립이 이를 공유한다.
- 구형 birth reader는 진단/history routing·Personal에 필요하여 보존하되 새 실행 권한이 아니다. old/versionless birth는
  current plan/CLI 옵션으로 승격하지 않고 원본 release/owner의 diagnosis/drain을 요구한다. malformed/unreadable은
  absent/지원 불가 사실로 바꾸지 않는다. CLI와 standalone broker는 tenure/run-lock·config·Store·restore·recovery 쓰기 전에 거절한다.
- production Native/Principal 시작의 v2 emitter fallback, Principal의 legacy/pre-readiness 시작 분기를 제거했다.
  CLI의 `--surface legacy` 선택도 제거했다. fresh omitted/explicit current admission은 모두 닫혀 있으며 새 birth를 만들지 않는다.
  domain v2 builder/export·broker/client old payload/plan·review.adopt·profile/views·운영/drain 전수 제거는 아직 남아 있다.
- 새 실제 경로 회귀는 원래 pending operation/accepted Mail·receipt·delivery, unresolved SDK journal, 실제 Git repository와
  전체 파일 목록/bytes를 두 fresh-process retry 뒤 비교한다. Native owner positive control은 실행을 시작하지 않으며,
  보존 config는 이 release에서 실행할 수 없는 fixture다. 실제 original-release drain·authenticated Worker/provider·
  whole-broker crash/power loss·모든 migration/rollback qualification을 대신하지 않는다.

원시 로그: `/tmp/oma-goal-mvzejzp1/` (작업 환경 로그, deployment evidence bundle 아님).

| 실행 | 결과와 한계 |
|---|---|
| `society-admission-before-build.log` | 첫 test fixture의 env 타입 누락으로 build FAIL 후 명시 `NodeJS.ProcessEnv`로 수정; product 결함 수에 포함하지 않음 |
| `society-admission-before.log` | 초기12개 중2 PASS/10 FAIL; fresh case의 project/state overlap과 기존 project binding 누락은 fixture 교정 필요 |
| `society-admission-valid-fixture-before.log` | production-valid binding/분리 경로로 수정 뒤12개 중3 PASS/9 FAIL; native old/missing 두 경우 `Missing expected exception`, 기존 explicit fresh closure와 current/Personal positive control은 PASS |
| `society-admission-build.log` / `society-admission-current.log` | 교정 뒤 build PASS 및12/12, fail/cancel/skip/todo0, exit0. 전체 migration/qualification PASS 아님 |
| `society-admission-expanded-current.log` | 후속 corrupt/unreadable·wrong-role·Personal/history 포함70개 중69 PASS/1 FAIL. malformed CLI의 기존 STORE_CORRUPT exit3을2로 기대한 oracle 오류이며 product classifier는 바꾸지 않음 |
| `society-admission-final-build.log` / `society-admission-typecheck.log` / `society-admission-package.log` | current build·root typecheck·static package 모두 PASS, exit0 |
| `society-admission-source-digests.log` / `society-admission-source-graph.log` | 원래 generator로14369개 production inventory/digest와 dependency graph 갱신; runtimeProof:false, authored review 아님 |
| `society-admission-architecture.log` | full architecture chain PASS, finding0; static durable-boundary 목록의 sigkill79/in-process30/logical21은 전수 fresh execution 증거 아님 |
| `society-admission-expanded-final.log` | **한 native-namespace serial379/379, fail/cancel/skip/todo0, exit0**,144202.919589ms; 이전12/70/309와 합산한 값이 아니고 whole-local 아님 |
| `society-admission-inputs.sha256` / `society-admission-inputs-check.log` | 실행 전 캡처한30개 product/test source 입력의 실행 직후 `sha256sum --check` PASS, exit0; 전체 transitive runtime/provider qualification 아님 |

재현/회귀의 Node는 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin/node`다.
위 final379의 명령은 다음과 같다(전체 local을 filter한 결과라고 부르지 않는다).

```sh
bash /tmp/oma-native-host.njsfv3/run.sh \
  /home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin/node \
  --import ./scripts/local-test-guard.mjs --test --test-concurrency=1 \
  dist/test/collaboration-*.test.js \
  dist/test/merge-review.test.js dist/test/challenge-review.test.js \
  dist/test/review-advance-races.test.js dist/test/review-concurrency.test.js \
  dist/test/review-active-capacity.test.js dist/test/git-review-acceptance-kill.test.js \
  dist/test/delivery-notice.test.js dist/test/mail-facts-boundary.test.js \
  dist/test/run-view-contracts.test.js dist/test/host-arguments.test.js \
  dist/test/session-mode-record.test.js dist/test/session-history.test.js \
  packages/tool-runtime/test/collaboration-groups.test.mjs \
  packages/tool-runtime/test/retired-surface.test.mjs \
  packages/domain/test/collaboration-inputs.test.mjs \
  packages/domain/test/collaboration-targets.test.mjs \
  packages/domain/test/collaboration-prompts.test.mjs \
  packages/extension/test/prompt-boundary.test.mjs \
  packages/extension/test/collaboration-registration.test.mjs \
  packages/extension/test/startup-integrity.test.mjs
```

scoped `git diff --check` PASS. 이후 결과 표만 추가한 문서 편집은 tested product/test source를 바꾸지 않는다.
독립 설치·whole-local·필수 verify lanes·실제 source review·platform/kernel/provider/service·original-release drain·
운영/rollback 전수·모델 A/B/C는 미완료다. required FAIL/BLOCKED/NOT_RUN을 전체 완료로 올리지 않는다.

## 레거시 표면 제거 checkpoint — launch admission과 effective recipient bound

입력은 동일 branch/HEAD의 보존한 WIP다. **전체 PARTIAL / source NOT_REVIEWED / collaboration-v1 활성화·배포 없음**.
아래257회귀와 architecture PASS는 이 후속 변경 이전의 별도 source checkpoint다.

- 실제 제거: tool-runtime의 v2 실행 decoder·exact-set `toolset` selector와 extension의
  `agent-tools.ts`, `review-tools.ts`, `principal-tools.ts`, 해당 package export, raw mail/reply alias 등록을 제거했다.
  새 adapter 이름 아래 구형 handler를 호출하지 않는다. Personal/vendor MCP/Human individual control은 제거하지 않았다.
- Domain의 current surface parser/role requirement를 engine launch와 extension이 공유한다. Principal launch의
  legacy prompt/roots fallback과 Worker spawn의 legacy prompt branch를 제거하고, absent/legacy는 명시적으로 거절한다.
  기존 birth를 v3로 승격하거나 default emitter를 v3로 바꾸지 않았다. 기존 domain v2 emitters·birth/payload/plan
  compatibility·review adoption·운영 이행은 여전히 남아 있어 S13 전체 완료가 아니다.
- [MCS-AUD-03](../priority-0-audit.md#mcs-aud-03--확장-startup-거부보다-먼저-sdk가-기존-journal에-metadata를-추가):
  late extension refusal 이전에 actual SDK가 old journal에 metadata를 append함을 재현했다. launch 검사로 SDK
  진입 전에 거절하며 actual DB/Mail accepted fact·receipt·archive/delivery·old pending journal bytes를 보존한다.
  대조군은 late-only 경로의 append를 계속 증명한다. actual launch builder + SDK child fixture이지 authenticated
  product Principal/Worker·whole-broker·power-loss·모든 birth/profile/payload의 이행 검증은 아니다.
- [MCS-AUD-04](../priority-0-audit.md#mcs-aud-04--collaboration-recipient-bound가-provider-schema초기-validator에-전달되지-않음):
  selected send schema의 missing maxItems를 독립 비교로 재현했다. effective host bound를 schema와 새 호출의
  validator에 연결하고 missing/invalid는 등록 거절한다. historical args/plan/hash/receipt는 다시 해석하지 않는다.
- `delivery-notice.test.ts`의5개 obsolete helper 호출은4개 ordinary contained-file/record read 사례와 selected schema
  사례로 이행했다. complete index의3000개 row를 paged read로 모두 비교하고, actual accepted Mail의 decoded body,
  archive/delivery 불변, 다른 record root/raw Worker archive의 Principal refusal을 검사한다. contained reader fixture는
  전체 Pi/hashline/physical role proof가 아니다. audience publication의 원래 회귀도 별도로 유지한다.

원시 로그는 `/tmp/oma-goal-mvzejzp1/` 아래다(배포 qualification bundle이 아님).

| 실행 | 결과/한계 |
|---|---|
| `retired-surface-valid-fixture-before-removal.log` | v2 지원을 기대하지 않는5개 negative oracle이 제거 전에 모두 FAIL |
| `retired-session-first.log` | late-only refusal에서 old journal metadata append3건 FAIL, intact/tampered/legacy/absent composition4건 PASS |
| `retired-preflight-focused.log` | build 후 한 serial47/47, fail/cancel/skip/todo0, exit0; SDK/group/Mail/registration/composition/retirement |
| `retired-expanded-regressions.log` | 한 native-namespace serial300개 중295 PASS/5 FAIL, skip0. 실패는 폐기 mail helper 호출; 전체 PASS로 표시하지 않음 |
| `collaboration-recipient-schema-before.log` | current selected send의 maxItems가64가 아닌 undefined여서1 FAIL |
| `retired-reader-schema-before.log` |16 PASS/2 FAIL: schema 결함 + reader continuation footer를 잘못 금지한 fixture. 후자는 전체 row 비교를 유지하여 바로잡음 |
| `recipient-bounds-build.log` / `recipient-bounds-current.log` | build PASS, 이행 reader/schema/역할별 bound/SDK-retirement/composition/Domain을 한 serial52/52, fail/cancel/skip/todo0, exit0.300개 전체 재실행을 대신하지 않음 |
| `retired-preflight-typecheck.log` | 후속 bound 변경 전 root typecheck PASS; 최종 typecheck는 다시 필요 |
| `retired-preflight-architecture-first.log` | 삭제한 export를 직접 import하는 negative test가 module gate FAIL; manifest/export 부재 검사로 수정, gate 예외 추가 없음 |
| `retired-preflight-architecture-second.log` | modules/기존 legacy 목록 PASS 뒤 stale production inventory의 삭제3개 source 때문에 FAIL. 원래 generator 갱신 및 full chain 재실행 필요 |
| `retirement-expanded-final.log` | 같은 native namespace 명령의 전체 선택 집합을 재실행: **309/309, fail/cancel/skip/todo0, exit0**,128596.576696ms.52/257/300을 합산한 값이 아니며 whole-local은 아님 |
| `retirement-typecheck.log` | recipient-bound 교정을 포함한 최종 root typecheck PASS |
| `retirement-source-digests.log` / `retirement-source-graph.log` | 원래 generator로 삭제3개를 반영한14369개 inventory/digest 및 graph 갱신; `runtimeProof:false`, authored review 갱신 아님 |
| `retirement-architecture.log` | 갱신된 source에서 documents의 삭제된2개 source link가 FAIL. 과거 DR64 계약을 숨기지 않고 DR72 후속 제거 주석과 현재 owner 링크로 수정 |
| `retirement-architecture-after-links.log` | full architecture chain PASS: modules·기존 completed-legacy 목록·inventory·rules/gate·transactions·boundaries·documents·spec-inventory, finding0. S13 전수 제거나 boundary 전수 재실행 증거는 아님 |

정확한 serial 명령은 위300-case 파일 집합과 동일하며9개의 bound 회귀를 추가했다. Node26·`bash /tmp/oma-native-host.njsfv3/run.sh`로
`node --import ./scripts/local-test-guard.mjs --test --test-concurrency=1`를 실행했다. `retirement-inputs.sha256`는
제품/시험19개 source 입력을 기록한다. 후속 문서의 결과 표 추가는 tested product/test source를 바꾸지 않았다.
scoped `git diff --check`도 통과했다. full-tree inherited whitespace를 전수 수정했다고 주장하지 않는다.

최초 reader fixture의 `publishRecords` 반환형 오용은 build에서 실패했고 `views.rootFor`로 수정했다.
실제 source review·whole-local/필수 lane·독립 설치·kernel/provider/Darwin·Human/drain/rollback·A/B/C는 미완료다.

## 독립 재검증 — Client review/state 경로와 MCS-AUD-01

기준: HEAD `a47f70af146791370d3b8e68aad88813654eaf12` + 시작 시점의 tracked dirty232/untracked99를 보존한 WIP.
이전 절/trace/handoff의 PASS는 이 재검증의 근거가 아니다. **전체 PARTIAL, activation/cutover 미승인·미실행**.
이 절 아래의 이전 실행·완료 주장과 이번 실제 수정/실행을 구분한다. 이 절의257 source checkpoint에서는
production 기본 legacy 경로와 old/new 호환층이 남아 있었다. 후속 부분 제거는 위 checkpoint를 따른다.

- 실제 제품 수정: `apps/oma/src/views/collaboration-reviews.ts`의 opening-source/request 관계 검사.
  [MCS-AUD-01](../priority-0-audit.md#mcs-aud-01--related-challenge를-원래-merge의-source-revision으로-오인)은
  Client challenge 뒤 원래 applied merge의 source artifact 충돌과 discovery unavailable을 수정 전에 재현했다.
  원래 fact/bytes/immutable collision guard를 보존하며 관련 challenge를 merge의 새 source로 재해석하지 않는다.
- 새 시험: `test/collaboration-client-review-actions.test.ts`, `test/collaboration-client-state-actions.test.ts`,
  공통 fixture `test/fixtures/collaboration-client.ts`. 실제 SDK journal/Client/RequestService/Unix socket/
  RpcConnection/production dispatcher/HostInvocations/원래 Review·Mail·Lifecycle·Git·Store를 연결한다.
  stale own-vote/revision/control, unrelated peer non-staleness, forged tuple/self-review,
  Principal reject finality, broker-prepared applied-delta challenge와 omitted replacement,
  follow recipient snapshot/replay, GOAL full-context CAS/BOM·CRLF 보존, Society close의 native scope death를 검사한다.
- fixture의 auth/selected policy와 view/physical source-root mapping은 명시적 입력이다.
  native scope는 trusted keepalive 시험 프로세스이며 product Worker/provider 실행 증거가 아니다.
  provider·peer authentication·whole-broker crash·power loss/macOS/A/B/C와 최종 source review는 미완료다.
- 새 fixture 초기 실패(TS 타입/API, 허용되지 않은 context README 경로, 부모 lineage 누락, 거부문구 기대)는
  실제 계약에 맞춰 바로잡았다. production 권한/오라클을 완화하거나 이들을 제품 결함으로 세지 않는다.
  첫 native launcher 호출126과 잘못 계산한 Node 경로127도 실제 시험 실행 전의 명령 오류다.

원시는 `/tmp/oma-goal-mvzejzp1/`에 보존했다(작업 환경 로그이며 배포 evidence bundle이 아님).
- `expanded-build.log` 및 `expanded-collaboration-regressions.log`: source/discovery assertion 보강과
  A25/A29/A31을 포함한 **한 serial 216/216, fail/skip/cancel/todo0, exit0**.
  private Linux native namespace에서 `node --import ./scripts/local-test-guard.mjs --test --test-concurrency=1`
  `dist/test/collaboration-*.test.js dist/test/merge-review.test.js dist/test/challenge-review.test.js`
  `dist/test/review-advance-races.test.js dist/test/review-concurrency.test.js dist/test/review-active-capacity.test.js`
  `dist/test/git-review-acceptance-kill.test.js`를 실행했다. `review-inputs.sha256`의 renderer/새 test/fixture
  다섯 입력은 후속 `sha256sum --check`도 통과했다. 전체 source review·whole-local·physical/live provider proof가 아니다.
- 이전 `review-actions-fixed.log`의17/17은 중간 입력의 별도 실행이며216과 합산하지 않는다.
  수정 전 challenge 실패는 `review-challenge-failure.log`, state fixture 실패는 `state-actions-initial.log`에 남겼다.
- 후속 MCS-AUD-02: `packages/tool-runtime/src/collaboration-groups.ts`가 저장 exposure를 읽을 때
  개별 이름 membership만 보고 그룹 전체의 closure를 확인하지 않았다. group 일부만 남긴 event가 정상 loadout으로
  복원됨을 unit 두 건 및 실제 SDK journal reopen 두 건으로 수정 전에 재현했다.
  원래 restore owner에 complete-group union 검사를 추가하고, 손상된 journal bytes는 수정하지 않고 거절한다.
  `groups-closure-negative.log`와 `groups-sdk-negative.log`는 각각9 PASS/2 FAIL,
  수정 뒤 `groups-current-build.log`와 `groups-current.log`는 build PASS 및 **22/22, fail/skip/cancel/todo0, exit0**다.
  실제 Pi1.0.1·HTTP scripted provider로 정상 union/두 역할 prompt/containment와 손상 journal reopen을 확인했다.
  non-group action은 inert catalog fixture이고 fatal은 SDK error로 포착한다. process-exit·live-provider·broker action
  qualification을 이 결과로 주장하지 않는다. source는 NOT_REVIEWED이며 legacy 제거 완료도 아니다.
- 후속 `review-typecheck.log`는 root typecheck PASS다. `review-architecture.log`는 renderer source digest가
  stale하여 inventory에서 FAIL(exit1)했다. generated digest 갱신은 runtime/authored-review 증거가 아니며
  이 실패를 과거 architecture PASS로 덮지 않는다.
- 최신 source checkpoint: 위 두 제품 교정과 새 회귀를 모두 포함한 `current-collaboration-regressions.log`는
  **한 serial 257/257, fail/skip/cancel/todo0, exit0**다(약116초). 위216의 동일 compiled file 집합에
  `packages/tool-runtime/test/collaboration-groups.test.mjs`, Domain의 `collaboration-{inputs,targets,prompts}.test.mjs`,
  `packages/extension/test/prompt-boundary.test.mjs`를 함께 실행했다.22/216과 합산한 값이 아니며 whole-local은 아니다.
  `groups-current-build.log`/`current-typecheck.log`/`current-package.log`는 build·root typecheck·static package PASS다.
  `groups-architecture.log`는 source digests/graph를 원래 generator로 갱신한 뒤 전체 architecture chain PASS였다.
  `groups-source-{digests,graph}.log`는 구조 측정만 기록하며 `runtimeProof:false`, authored review는 NOT_REVIEWED다.
  `check:legacy`의0 findings는 기존 제거 목록에 대한 결과이지 MCS-S13의 전수 제거 증거가 아니다.
- [MCS-S13](../model-collaboration-surface-spec.md#mcs-s13--최종-코드의-레거시-제거와-저장-사실의-명시적-비호환)/DR72는
  사용자 최종 제거 방침과 기존 X01/X09/V04의 병행 보존 계획 충돌을 명시했다. 최종 legacy 제거·명시적 비호환/운영
  검증은 아직 미완료이며, 이 문서 기록을 코드 제거·activation/cutover 승인으로 세지 않는다.

## collaboration-v1 — 원래 owner 교정과 현재 미완료

입력: `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` + 보존한 dirty WIP. **전체 PARTIAL, 검증 milestone 1/8**이며 구현률이 아니다. 아래는 후속 source checkpoint다. 이후의 과거 절과 그 PASS·reviewed hash를 현재 전체 source의 증거로 합성하지 않는다. legacy는 기본값이며 fresh selected bootstrap은 계속 closed다. source는 NOT_REVIEWED다.

### 현재 구현과 확인한 결함

- 원래 Mail/RequestCache/RequestService/HostInvocations/Review owner에서 selected Mail root/whole-second Date freeze와 accepted-plan 전달, terminal receipt fact 충돌 검사, absent-only ordinary-cache handoff, 원래 `.submit`의 canonical 성공에 한정한 metadata-only Review handoff를 보강했다. metadata copy는 parent acceptance·body 재구성·새 binding·재전송 권한을 만들지 않는다. 실제 canonical child 성공 이후 parent continuation은 아래 격리 Linux native profile에서 통과했으며 모든 failure/concurrency/platform 범위의 완료는 아니다.
- 보호된 freeze의 `createdAtMs`와 원래 binding 날짜 관계가 빠져 있던 결함을 고쳤다. key/method/date/frozen hash 관계는 `invocationFreezeMatches` 하나로 검사하고, historical request/freeze hash는 바꾸지 않는다. 원래 cache hook도 `freezeInvocation`으로 binding 날짜를 사용한다. 실제 Client/broker·Store 재개에서 날짜만 바꾼 protected metadata의 resend와 absent-cache handoff를 거절하며, 이미 accepted된 canonical receipt 조회는 그대로 허용한다. 수정 전 두 replay 사례는 **Missing expected rejection**으로 실패했다.
- metadata handoff의 existing 경로가 읽기 전 flush만으로 경쟁 writer의 새 link를 durable하다고 반환하던 결함도 고쳤다. ordinary replay의 기존 flush를 `replayBarrier`로 공용화하여 metadata를 관측한 뒤 flush한다. 실제 child를 reader의 사전 flush 이후 link/parent-flush 이전에 SIGKILL한 negative control은 **Missing expected exception**으로 실패했고, 수정 뒤 post-observation EIO를 보고한 후 같은 key/fresh owner로 복구한다. 이 barrier는 acceptance나 source ownership을 만들지 않는다.
- diagnostics 내부의 unavailable 결과·enumeration catch·frame/projection catch가 normalized `STORE_CORRUPT`를 삼켜 원래 fence를 닫지 않던 세 경로를 `observeStoreFailure`에 연결했다. 새 gate나 error classifier는 만들지 않았다. 실제 Store/Mail/ResidentLogStore를 사용하되 wrapped source error는 주입한 회귀이며 디스크의 SQLite corruption을 재현한 것은 아니다. accepted Mail replay와 정상 Alice log bytes는 유지하고 fresh Mail만 원래 gate가 거절한다. ordinary EIO는 corruption으로 승격하지 않는다. 수정 전 세 경우의 gate는 잘못 `healthy`로 남았다. diagnostic T guard도 identity SQL read보다 앞에 옮겼으며 Principal은 T 밖에서도 enumeration 전에 거절한다.
- Mail/Review/State records는 optional family와 개별 request 실패를 unavailable로 격리하되 independent facts를 계속 게시한다. failed request의 retained status를 current로 링크하지 않는다. root discovery failure는 실제 실패다. wrapped `STORE_CORRUPT`는 원래 gate를 닫으며 accepted Mail receipt는 보존되고 fresh acceptance는 거절된다. historical original patch와 recorded-OID endpoint의 새 관측은 별도 companion이다.
- R10 receipt renderer가 before-send closure를 허용 disposition `refused` 대신 `rejected`로 표시하던 불일치를 negative control로 재현·수정했다. 원래 protected binding의 phase `rejected`, 원래 failure·proof·no receipt/no operation은 그대로이며 view의 표시만 바로잡았다. receipt observation/status와 diagnostic bytes/manifest/source-status/discovery의 여섯 parent-flush 직후 실제 publication child를 SIGKILL하고, 매 경우 같은 원래 key와 소스에서 두 fresh child가 재개했다. 원래 accepted operation/delivery/binding/freeze 및 production ResidentLogStore로 쓴 fixture frames·BOM/CRLF bytes가 불변이며 ACK/presentation을 만들지 않는다. fixture의 authentication/selection은 SDK/kernel qualification이 아니고 parent broker 전체 종료·power loss 증거도 아니다.
- State/receipt/Mail/batch/history/Review/material 게시는 원래 Store의 T에서 I/O 전에 거절한다. empty history뿐 아니라 Review materials의 verified cache도 해당한다. material guard만 제거한 negative control은 실제 warmed-cache 경로에서 **Missing expected exception**으로 실패했다. guard 복원 뒤 같은 회귀가 통과했다. cache의 존재는 transaction I/O 허가가 아니다.
- Engine의 직접 Native dependency를 제거했다. Process가 원래 Native cleanup 구현을 재사용하며 module checker 예외는 추가하지 않았다. 실제 child negative control로 Principal closing input의 중복 `onEnd`, RPC cleanup 실패에 의한 original completion 누락을 재현·수정했다. primary/cleanup cause를 보존하고 independent owners를 모두 반환하며 transport completion과 실제 OS exit는 계속 분리한다.
- Principal 최종 session 환경은 ambient record/world/Worker archive roots를 제거한다. selected record root는 원래 launch 검증 뒤에만 공급한다. static environment 분석도 `principalEnvironment`와 `sessionEnv` 양쪽 실제 hop을 추적하고 Worker-only root의 Principal producer 등록을 거절한다. 임의 root 전달이나 role 권한 확대를 허용 목록으로 덮지 않았다. 해당 static negative/positive controls는 **22/22 PASS**다.
- Git recorded-source의 private scratch 생성·cleanup은 기존 held-parent/native/storage directory primitives를 사용한다. 실제 canonical Git의 BOM/CRLF·binary blob bytes/hash, scoped consumer 종료/오류 뒤 spool 소멸, expired consumer 거절, refs/accepted operation 불변을 확인했다. 후속 actual child SIGKILL은 실제 fsync 뒤 partial-collection/after-collection 두 지점에서 실행했다. Store 재개·새 exact-OID child에서 accepted facts/refs/source bytes가 같고 다른 관측의 retained scratch bytes를 고치거나 수집하지 않음을 확인했다. 이는 newly observed endpoint 자료이며 originally stored patch로 바꾸지 않는다. power-loss/filesystem/kernel containment qualification은 아니다.
- State projection의 L4 session-mode import를 제거하고 composition이 원래 Society birth를 결박한 Review read callback을 제공한다. birth 계산·Review 관측을 재구현하지 않았다. 새 여섯 pure target/transport codec은 exact K1 membership으로 분류했으며 ledger/effect ownership을 부여하지 않았다.

### 현재 실행 판정

| 검사 | 실제 결과와 한계 |
|---|---|
| 최신 build / root typecheck | 둘 다 PASS: `/tmp/mcs-create-matrix-final-{build,typecheck}.log`. original Lifecycle diagnostic-count owner 교정과 관련 fixture 입력을 포함. authority/qualification의 대체 증거는 아님 |
| 직전 확장 guarded serial | **334/334 PASS, fail/skip/cancel0**: 한 격리 Linux serial 명령으로 이전270과 추가64를 실행. prior selected source, status/lifecycle, legacy registry/locators/surface, Review fanout와 receipt scope refusal 포함. whole-local 전체 PASS로 합성하지 않음 |
| 현재 native create 관련 serial | **43/43 PASS, fail/skip/cancel0**: selected create5, attachment6, Client compound2, Lifecycle observation4, phase4 및 original Mail submit/settlement 관련 회귀. `/tmp/mcs-selected-create-final-regressions.log`. 아래 scope/fixture 실패 이력을 보존하며 이전334와 합성하지 않음 |
| 원래 compound publication 복구 | **PASS (Host/Git/Review 경로; 전체 Client transport continuation 완료를 뜻하지 않음)**. 실제 original native quarantine→canonical `.submit` 성공→Store reopen→obsolete protected bundle 삭제→exact metadata-only handoff→parent 미접수/main 불변→현재 caps 거절→authorized original Review 수락. LOW 정책의 원래 v3 preparation/`git.integrate`까지 exact key·kind·request/source/preparation 관계로 검사하며 replacement invocation 없음 |
| 실제 Client compound transport | **2/2 PASS**: `test/collaboration-client-review-recovery.test.ts`. real SDK JSONL→Client source preparation/RequestService/Transport/BrokerChannel→Unix socket→RpcConnection/TransportSpool→production broker dispatcher→original native Git/Mail/Review. parent acceptance 전/후 socket loss와 lookup loss 뒤 Store/host 재개, obsolete protected/local bundle과 local metadata 삭제, caller repository 제거 상태에서 같은 원래 호출을 복구. child 재전송/새 source build 없음. 미접수 parent는 현재 caps 거절 뒤 원래 권한으로만 수락; 이미 accepted인 parent는 effect 재전송 없이 원래 receipt 조회. LOW v3 preparation/integration의 exact membership/관계 검사. auth/selected launch는 fixture input이며 kernel scope/whole-broker crash/live provider 증거는 아님 |
| accepted attachment / collection | **6/6 PASS**: `test/collaboration-attachment-boundaries.test.ts`. SHA-1/SHA-256 각각 original native import scope 종료 뒤 quarantine tree-parent flush·lease-parent flush 및 original Mail publication CAS 직후 실제 child SIGKILL. 두 Store 재개/same-key retry가 원래 accepted Mail root/request hash/plan bytes/bundle/EML/recipient snapshot을 유지하고 sender retirement 뒤 materialization을 완료. attachment-only body는 빈 문자열 그대로, ACK/presentation/별도 submit/중복 CAS 없음. tree-only kill의 retained lease bytes를 새 importer가 수집하지 않는다. process SIGKILL이지 power-loss/macOS/전체 kernel containment proof가 아님 |
| 이전 23 미실행 | 격리 Linux test-host에서는 **23건 모두 실행·PASS**(delivery/native 22 + scripted-provider Resident retry 1). 전역 `/usr/bin/bwrap`는 여전히 없고 일반 host 실행의 과거 FAIL/NOT_RUN을 지우지 않는다. live provider/macOS/physical qualification으로 올리지 않음 |
| 현재 static chain | **전체 architecture chain PASS**: `/tmp/mcs-create-matrix-final-architecture.log`. current source digests/graph도 재생성했다. inventory14372 files, `runtimeProof:false`, LOC `CI_ARTIFACT_ONLY`; authored review나 runtime completion이 아님 |
| boundary 검사 | **PASS, 0 findings**: strongest injection sigkill79/in-process-fault30/logical21. 마지막 두 owner의 실제 실행을 등록했다. `ViewsModule.publishCollaborationDelivery`는 batch JSON·delivery index 교체와 parent flush 뒤 SIGKILL, `CollaborationReviewMaterials.publish`는 patch·blob·manifest 게시/parent flush 뒤 SIGKILL. 각 두 fresh-process 재개가 원래 batch/accepted facts·exact bytes를 보존. 이 registry 통과가 전체 product/physical qualification은 아님 |
| package static / isolation | static check PASS: `/tmp/mcs-create-matrix-final-package.log`. **현재27 workspace packed install·authored declaration/installed runtime 검사 PASS**: `/tmp/mcs-create-matrix-reclaimed-isolation.log`. 일부 Engine/extension/tool Pi 접점의 external declaration diagnostics44는 유지하며 dependency-wide type clean을 주장하지 않음 |
| authored review·물리 qualification·평가 | source NOT_REVIEWED, mandatory physical/native macOS/live provider·A/B/C NOT_RUN/BLOCKED. packed install의 authored declaration 검사는 authored source review가 아님 |
| source collection / Review focused | **8/8 PASS**, actual process SIGKILL 두 지점·fresh child와 Store reopen·retained bytes 보존·cold/warm material T guard 포함. compound publication의 native owner 검증과는 별도 범위 |
| metadata handoff boundary | 실제 metadata-file flush 뒤, publication parent flush 뒤, 경쟁 writer의 link 뒤/parent flush 전 SIGKILL과 fresh-process same-key restart를 통과했다. original metadata/binding bytes·없어진 bundle·no new binding/receipt/acceptance를 검사한다. 추가 EIO와 다른 날짜/손상/읽기 불가/body-only orphan 보존도 통과. 이 cache-only 시험만으로 host canonical child 성공 조건을 증명하지 않으며 위 실제 compound 시험과 구별함 |
| diagnostic original-gate focused | **6/6 PASS**. unavailable result·enumeration·frame read의 wrapped corruption은 원래 gate를 닫고 independent exact log/accepted Mail을 보존한다. ordinary EIO는 gate를 닫지 않으며 early-T와 Principal pre-enumeration refusal도 확인. source-error injection이므로 physical corruption/containment proof는 아님 |
| receipt/diagnostic publication focused | **7/7 PASS**. original Store/Mail/protected binding source의 R10 refusal 1건과 actual SIGKILL 6지점. 각 지점마다 두 fresh publication child/Store가 같은 key로 재개한다. canonical accepted/protected facts와 ResidentLogStore fixture frames/bytes를 보존하며 ACK/presentation을 만들지 않는다. process publication/recovery의 한정된 증거이며 SDK/kernel containment·entire broker restart·power-loss proof가 아님 |
| actual submit / Mail settlement | 추가 격리 Linux guarded serial **12/12 PASS**, skip 0: `/tmp/mcs-native-unprivileged-submit-settlement.log`. 과거 ENOENT로 기대한 `injected loss after publication`에 도달하지 못하던 V20A도 이제 원래 injection·same-key/no-new-bundle·publication once oracle 그대로 통과 |
| whitespace | 이번 수정 경로 scoped check PASS. 전체 check는 기존 WIP 세 파일의 EOF blank로 FAIL: `docs/design-revisions.md`, `docs/implementation/architecture-improvements.md`, `packages/engine/test/interactive-host-ownership.test.mjs`. 무관한 WIP는 지우지 않음 |

최신 원시는 `/tmp/mcs-creation-observation-current-{build,typecheck,focused,regressions,isolation,digests,graph,architecture,package}.log`다(334/334, focused4/4, 현재 packed27, full static chain PASS/boundary0). 실제 source 교정은 `packages/lifecycle/src/policy.ts`의 diagnostic count 재사용과 original Store hint 결박이며, fresh admission·T·원래 rows를 유지한다. 그 밖의 기존 실패 교정은 아래 fixture/oracle 수정과 구분한다. 이전270/source-link,265/Client-attachment,245/native checkpoint와 current 전체 PASS를 합성하지 않는다.

후속 입력: `test/collaboration-create-boundaries.test.ts`와 두 기존 native fixture의 명시적 journal 재개/원래 execution-owner 공유. production source는 위 Lifecycle 비용 교정 뒤 변경하지 않았다. `/tmp/mcs-selected-create-final-{build,typecheck,regressions}.log`에서 build/typecheck와 관련43/43(fail/skip/cancel0)를 실행했다. 새 create5건은 original native CAS·workspace publication/parent fsync·ready COMMIT·initial brief materialization 뒤 실제 child SIGKILL4건, full enabled capacity의 pre-ingress refusal1건이다. sender retirement 뒤 두 Store/runtime-owner 재개가 같은 root/request hash/frozen spec/from/BOM·CRLF brief/bundle bytes와 단일 operation/delivery를 보존한다. stale broker signal은 effects를 거절하지만 accepted receipt 관측을 거절하지 않고, 현재 broker owner만 복구한다. publication CAS를 반복하지 않으며 main·ACK·presentation·incarnation0을 바꾸지 않는다. Worker/Pi 실행을 활성화하지 않았으므로 full Client spawn/activation·peer-auth·power-loss/macOS proof가 아니다. 앞선334 serial을 새 fixture 입력으로 다시 실행했다고 주장하지 않는다.

create fixture의 최초 build TS2322/TS7022는 `mcs-selected-create-first-build.log`에 남겼다. 최초4건은 서로 다른 ExecutionRuntime으로 같은 journal을 열려던 fixture가 원래 exclusive-owner fence에 거절된 기록(`first-focused.log`)이다. 원래 broker처럼 Lifecycle와 quarantine에 같은 execution owner를 전달했으며 owner/cleanup 권한은 옮기지 않았다. 그 뒤 actual kill은 도달했지만 재개 Store의 trusted society binding 누락으로 decode가 거절된 기록은 `owner-focused.log`; original composition과 같은 identity를 결박한 `identity-focused.log`에서 통과했다. decoder/journal fence를 완화하지 않았으며 production 결함 negative-control로 세지 않는다. 이후 stale tenure와 capacity 검사를 추가한 위 final43 결과와 구분한다.

실제 Client 생성 경로: `test/collaboration-client-create-recovery.test.ts`, `/tmp/mcs-client-create-authority-{build,focused}.log`의2/2 PASS. SDK JSONL의 원래 `from: HEAD`·file brief 호출을 Client/RequestService/Unix RPC/production dispatcher/Host와 original native quarantine/Lifecycle/workspace/Mail까지 실행했다. acceptance 전/후 response+lookup loss 뒤 caller repository·brief·일반 cache를 제거하고 Store/execution owner를 재개해 같은 key/root/spec/from/brief를 복구한다. 미접수 original은 현재 capabilities 거절 뒤 원래 권한으로만 수락한다. accepted original은 protected body까지 없어지고 capabilities가 없어도 현재 authenticated actor가 receipt만 관측하며 create를 재전송하지 않는다. builder1회, 단일 accepted create/initial brief, no preliminary submit/다른 Worker/ACK/presentation/main movement를 검사한다. 이 fixture는 auth/selection/child policy를 제공하고 Worker/Pi를 활성화하지 않는다. root transport tasks가 정산된 뒤 Store를 재개하므로 whole-broker crash proof가 아니다.

Client 최초 build의 unknown wire capture TS2322는 `mcs-client-create-first-build.log`에 보존했다. 최초 focused1 PASS/1 FAIL(`first-focused.log`)은 retired actor가 기존 actor channel을 계속 사용할 수 있다고 잘못 가정한 fixture였다. 원래 AUTH-003의 STALE_RUN refusal을 바꾸지 않고, 현재 authenticated actor의 capability 없는 receipt observation으로 수정했다. sender retirement 뒤 accepted delegation 완료는 앞선 원래 host-owner create boundary에서 따로 검사한다. production 권한 완화/새 Principal MCP 차단은 없다.

후속 whole-local: `/tmp/mcs-client-create-full-local.log`,540 files/concurrency4/600초 limit, **FAIL+TIMEOUT**. serial14/14 PASS(fail/skip/cancel0), parallel의 final summary는 없다. 관측된 실패3건은 기존 두 guarded shell fixture와 C1 concurrent submit의 오래된 error-kind oracle이다. TAP 원본 `/tmp/oma-test-summary-tC9lBS/summary-parallel.tap`의 C1은 이미 exact accepted submit을 확인한 다음 `BROKER_UNAVAILABLE`/`retry: same-key`를 거절했다. original quarantine owner contention은 acceptance를 취소하지 않으므로 same-key broker refusal도 허용하되 exact accepted ID/requestHash/planJson와 두 source/ref/recipient의 재개·비혼선을 추가 검사한다. 이것을 product 변경으로 세지 않는다. 수정 전 isolated audit13/13, scenario-confined11/11도 별도 로그에 보존했다. timeout 뒤 남은 test-local/Node test/fixture/native child는 관측되지 않았다. whole-local 전체를 PASS로 합성하지 않는다.

위 C1 교정과 두 Client 생성 case를 포함한 `/tmp/mcs-client-create-current-{build,typecheck,regressions}.log`는 build/typecheck PASS, 한 guarded serial69/69(fail/skip/cancel0)다. 앞선43/334와 합산하지 않는다. 마지막 후속은 reopen 전에 original connection tasks 정산을 명시한 fixture 보강이다. `/tmp/mcs-client-create-final-{build,typecheck,focused}.log`에서 build/typecheck PASS와 Client2/2를 다시 확인했다. 현재 native sibling-contention4파일 병렬 재실행도 PASS: `/tmp/mcs-client-create-contention-regressions.log`. source digests/graph/full architecture/package static 원시는 `/tmp/mcs-client-create-final-{digests,graph,architecture,package}.log`이며 모두 PASS(boundary0)다. 이들은 whole-local/지원 플랫폼/실제 provider·A/B/C의 대체 판정이 아니다.

추가 create authority/capacity matrix: `test/collaboration-client-create-recovery.test.ts`는 실제 Domain `resolveChildSpec`/`resolveChildPolicy`를 사용한다. `agent.create`만 가진 현재 actor의 local unpublished source는 broker의 정확한 `CAPABILITY_DENIED`/`git.submit`로 거절되고 accepted operation/child/publication이 없다. 이미 canonical인 full OID는 같은 권한으로 독립 clone·정확한 brief와 하나의 create만 완료하며, child authority는 기존 intersection과 host-granted `code.integrate`다. 두 경우 모두 preliminary submit·ACK·presentation·main 이동은 없다. 최초3/4는 정상 거절을 optional `ClientError.code`에서만 찾은 fixture 오류였고, 원래 RequestService가 반환한 structured JSON failure를 그대로 검사하도록 수정했다. production 오류 계약이나 권한을 바꾸지 않았다. 원시: `/tmp/mcs-client-create-publication-authority-{first,current}-{build,focused}.log`.

`test/collaboration-create-capacity.test.ts`는 같은 original Lifecycle completion이 잠시 점유된 사이 두 canonical-source create가 실제로 accepted되는 경합을 실행한다. 남은 enabled slot 하나만 첫 child가 차지하고, 둘째는 같은 ID/hash/plan/brief의 pending/provisioning으로 남는다. full 상태의 세 번째 fresh create는 효과 전에 거절된다. 원래 runtime/Store owner 재개 후에도 둘째가 pending이며 첫 child를 eviction/death/idle로 재분류하지 않는다. 명시적 host capacity 증가를 반영하는 별도 재개 뒤에만 원래 둘째가 완료한다. 실제 workspace/Mail/Store를 사용하며 initial brief의 materialized와 presented/acknowledged를 구분한다. activation/provider·physical proof나 새 scheduler가 아니다. 최초 build의 fixture API 오용(TS2554/TS2339)은 `/tmp/mcs-create-capacity-first-build.log`에 남겼고 `/tmp/mcs-create-capacity-current-{build,focused}.log`는 build PASS, 집중5/5 PASS다. tenure-return 보강을 포함한 후속 판정은 아래 current 입력 로그를 따른다.

현재 입력 checkpoint: `/tmp/mcs-create-matrix-final-{build,typecheck,regressions,digests,graph,architecture,package}.log` 모두 PASS. 원래 guard/private native lane의 한 serial72/72(fail/skip/cancel0)에 authority2와 capacity1을 포함했고, 앞선69/334와 합산하지 않는다. full architecture chain의 boundary findings는0이다. scoped whitespace PASS; 새 파일의 no-index diff exit1은 추가를 나타내며 whitespace 진단이 없다. `docs/architecture.md`·기존 MCP vendor/policy·activation·accepted history는 바꾸지 않았다. whole-local과 물리/native macOS/live-provider/A/B/C 미완료는 그대로다.

Package isolation 재실행 이력도 보존한다. `/tmp/mcs-create-matrix-final-isolation.log`는240초 timeout 후24 workspace 보고까지만 있고 final PASS가 아니다. 다음 `/tmp/mcs-create-matrix-complete-isolation.log`는23 PASS/4 FAIL: `npm ci`가 `/tmp` tmpfs의 ENOSPC로 실패했다. 첫 timeout의 이 실행 소유 임시 설치본 `/tmp/oma-package-isolation-fPjrRD`(birth2026-11-02 23:21:22+0900,1.7GiB)만 원래 disposable owner의 cleanup으로 정리했다. 이전 `/tmp/oma-package-isolation-UMH82u` 및 product/retained scratch는 보존했다. `TMPDIR=/var/tmp`에서 같은 원래 verifier를 실행한 `/tmp/mcs-create-matrix-reclaimed-isolation.log`는27/27 packed install·authored declarations·installed runtime PASS(exit0); 외부 declaration44는 그대로다. shell guard·오라클·제품 권한을 완화한 결과가 아니다. 최신 documents/spec-inventory/scoped-whitespace도 PASS이며 각각 `/tmp/mcs-create-matrix-final-{documents,spec-inventory,scoped-whitespace}.log`에 기록했다.
새 publication-crash focused **5/5 PASS**: `test/collaboration-projection-boundaries.test.ts`. 전달 notice는 원래 batch id/incarnation/session/mode/모든 message IDs를 유지하며 body/ACK/approval/completion을 만들지 않는다. 재개 시 새로 관측한 inbox generation을 정확하게 링크하고 과거 immutable generation bytes를 바꾸지 않는다. Review의 새 endpoint manifest·patch·binary-NUL blob와 accepted Review/source/ref는 불변이며 fresh observation이 이전 owner의 retained scratch를 수집하지 않는다. 첫 focused는3 PASS/2 FAIL: `/tmp/mcs-final-projection-boundaries-first-{build,focused}.log`. 실패는 서로 다른 시각의 refresh가 같은 generation hash를 가져야 한다고 가정한 fixture oracle이었다. 현재 generation의 정확한 링크와 이전 generation 불변을 검사하도록 고쳤으며 production을 변경하지 않았다. process SIGKILL·fixture auth가 physical/kernel/provider/whole-broker proof는 아니다.

전체 local 시도는 **FAIL + TIMEOUT, 전체 결과 미완성**이다. `OMA_TEST_CONCURRENCY=1`과 같은 private native helper로 `npm test`(537 files)를 시작했으나 1200초 tool limit에서 종료됐다. serial phase는14 중13 PASS/1 FAIL (`V23A`: event-loop61ms); 뒤 phase는 완료 summary가 없다. 원시 출력의 추가 실패는 Principal 1.8MB result paging, copied-root evidence, Personal PTY, MCP command credentials, mutation-registry inventory, surface-plan environment, Mail notice recovery 두 건, V07B receipt evidence다. 원인/현재 source와의 귀속은 아직 판정하지 않았고 삭제·skip·oracle 완화·부분 rerun 합성으로 통과 처리하지 않는다. timeout 뒤 `ps`에서 test-local/Node test/fixture/native children이 남지 않음을 확인했다. 방금의 whole-local 실행은 선택270 PASS나 architecture PASS로 대체하지 않는다.

후속 분류/교정: 원시 재현은 `/tmp/mcs-whole-local-failure-status.log`(V23A read63ms), `/tmp/mcs-whole-local-failures-focused.log`에 보존했다. V23A는 concurrent status가 caller마다 Lifecycle의 전체 agent rows를 다시 검증하던 실제 비용 결함이었다. original Store의 total_changes/data_version stamp와 transaction 상태로 성공한 diagnostic count만 재사용하며 fresh capacity admission은 매번 full read, T-local rows는 uncached, 실패한 stamp/row validation은 성공으로 숨기지 않는다. `test/lifecycle-creation-observation.test.ts`의 scan/admission/T/rollback/external edit/spec-hash corruption/failure/fallback 네 회귀를 통과했다. 수정 전 deterministic3 중1 PASS/2 FAIL은 `/tmp/mcs-creation-observation-negative-{valid-build,tests}.log`; 첫 fixture TS2554는 `negative-build.log`에 따로 남겼다. 추가 guard 계약의 실패를 기존 제품에서 실제로 삼키던 stamp 오류라고 주장하지 않는다. 원래50ms read/100ms mixed oracle을 유지한 current334에서 read32ms/mixed35ms, pending620 관측13ms이며 이 특정 fixture 밖의 일반 throughput/A/B 우위를 주장하지 않는다.

나머지7건은 코드 권한/효과를 완화하지 않고 원래 계약에 fixture를 정렬했다: unavailable old goal-help wording, 새 host-derived attachment/create locator 목록, public invocation2를 ephemeral로 분리하면서 mutation13 유지 및 host.control internal-only, 실제 closed v2 surface fixture와 malformed refusal, live namespace의 busy와 unproven death 구분, per-delivery flag exception 뒤 independent fanout 계속을 process-kill prefix와 혼동한 두 Review oracle. 모든 later link/flag/archive와 original CAS/receipt 재개를 계속 검사한다. in-process exception을 actual SIGKILL 증거로 올리지 않는다. 이 파일들+status/new lifecycle focused는63/63, corruption 보강 뒤 최신334 한 명령에 모두 포함했다.

두 실제 shell fixture(`Personal installed PTY: tools…`, `DR37: MCP command credentials…`)는 local-test-guard의 shell refusal로 여전히 FAIL이며 해당 effect는 미실행이다. 실제 original namespace owner를 사용한 MCP fixture조차 child의 backstop이 shell을 거절한다. test guard·oracle을 삭제/완화하거나 skip하지 않고 안전한 실행 lane 문제로 분리했다. MCP 기존 기능을 추가 제한하라는 product 요구나 DR71의 승인과 혼동하지 않는다. 전체 local의 나머지 미완성 phase는 여전히 전체 PASS가 아니다.

후속 fixture 교정/집중 로그: Client 최초 build의 TS2367과 bare fixture의 unborn HEAD로 인한 `NOT_DESCENDANT`는 `/tmp/mcs-client-compound-wire-{first-build,current-focused}.log`에 남겼다. clone 후 원래 full base OID를 checkout하여 실제 descendant를 만들었으며 validator를 완화하지 않았다. caps-denial/전체 exact-effect oracle의 focused 2/2는 `/tmp/mcs-client-compound-wire-authority-{build,focused}.log`. attachment 초기 TS 및 잘못된 빈 resolutions manifest는 `/tmp/mcs-attachment-native-boundaries-{first-build,current-build,typed-build,typed-focused}.log`, 원래 first-occurrence OID 관계를 채운 뒤 실제 6/6은 `/tmp/mcs-attachment-native-boundaries-manifest-{build,focused}.log`다. production 결함 수정이나 negative-control 성공으로 세지 않는다.
receipt negative control: `/tmp/mcs-receipt-publication-negative-{build,regressions}.log`: build PASS, 3건 중 SIGKILL 2건 PASS/잘못된 `Disposition: rejected` 1건 FAIL. 첫 owner 교정의 241건·boundary 7 findings는 `/tmp/mcs-receipt-publication-current-{build,focused,regressions,typecheck,digests,graph,architecture}.log`에 보존한다. diagnostic child 추가 시 최초 잘못된 Process import의 TS2305는 `/tmp/mcs-receipt-diagnostic-publication-build.log`, 원래 Storage owner import 교정 뒤의 build/focused는 같은 prefix의 `current-{build,focused}.log`다. source-frame 비교를 보강한 뒤 위 final 245건을 새로 실행했다. 직전 diagnostic gate 238건 checkpoint는 `/tmp/mcs-diagnostics-owner-current-{build,typecheck,regressions,architecture,documents,spec-inventory}.log`와 구분한다.
diagnostic negative control: `/tmp/mcs-diagnostics-gate-negative-{build,regressions}.log`: build PASS, 5건 중 1 PASS/4 FAIL. corruption 세 경로는 actual `healthy`/expected `corrupt`, early-T는 원래 identity SQL read가 먼저 실행됨을 재현했다. 정상 EIO의 healthy control은 수정 전후 통과했다. 직전 229건과 metadata-boundary/current static 원시는 `/tmp/mcs-original-metadata-current-{build,regressions}.log`, `/tmp/mcs-original-metadata-current-final-{typecheck,architecture,documents,spec-inventory}.log`에 보존한다.
후속 negative controls: `/tmp/mcs-freeze-date-negative-{build,regressions}.log`(3건 중 2 FAIL), `/tmp/mcs-metadata-barrier-negative-{build,regression}.log`(1 FAIL). 초기 owner 교정 중 public diagnostic code 기대와 첫 cache lookup fixture를 원래 계약에 맞춰 교정한 실행은 `/tmp/mcs-freeze-date-owner-{build,regressions}.log`에 보존했다. 실제 metadata-kill 집중 실행은 `/tmp/mcs-metadata-handoff-real-kill-{build,regressions}.log`(40건 중 native 1 FAIL), 그 뒤의 229건 checkpoint와 구분한다. 첫 root typecheck의 두 stale wire inventory 실패는 `/tmp/mcs-original-metadata-current-typecheck.log`, registry point literal 불일치는 `/tmp/mcs-original-metadata-current-architecture.log`에 남긴다.
원시 로그: `/tmp/mcs-review-material-original-store-{final-build,expanded-regressions,digests,graph,architecture}.log`; negative control `/tmp/mcs-review-material-cache-negative-{build,regression}.log`; 이전 current-owner 확장 `/tmp/mcs-current-original-owners-expanded-regressions.log`(207건); environment/rule `/tmp/mcs-principal-environment-owner-rules-tests.log`, `/tmp/mcs-private-source-principal-root-rules.log`; focused Mail T guard `/tmp/mcs-mail-publication-T-owner-{build,regressions}.log`(44/44). 뒤 source 변경은 각 checkpoint의 범위와 구별한다.

### 격리 Linux native test-host와 한계

전역 설치나 production launcher/backend 변경 없이 `/tmp/oma-native-host.njsfv3/run.sh`가 user/mount namespace에서 `/usr/bin`에 private overlay를 만들었다. `unshare --user --map-current-user --mount --keep-caps --fork`로 mount만 준비한 뒤 `setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all`로 원래 UID1000과 비특권 실행을 유지한다. helper 인수는 원래 guarded Node 명령 그대로다. namespace가 끝나면 mount도 끝나고 global `/usr/bin/bwrap`는 계속 absent다. 임의 execution backend·mock·skip·oracle 완화·production activation은 없다. 이것은 특정 Linux fixture/runtime profile의 실제 native 실행 증거이며 전체 kernel containment나 power loss/macOS/live-provider/A/B/C 검증이 아니다.

Debian apt에서 받은 `bubblewrap 0.12.0-1~deb13u1 amd64`: deb SHA256 `70aca4fa8daeacb677ec00e8063eb586f08ae3d94b1f11e684370b5524c43431`, launcher SHA256 `573236e5328ac2ebb08f59ae3a9805b4f8d12bdef14be8af4450d5463294985f`, test-host helper SHA256 `8948cf1f649de7421c9fa35153aff44fb2805b0681fd0f565b3cc6456fdb0681`. 재실행: `bash /tmp/oma-native-host.njsfv3/run.sh node --import ./scripts/local-test-guard.mjs --test --test-concurrency=1 <same compiled test files>`; Node26 PATH와 기존 DBUS guard를 유지한다. private artifact/helper는 재현용으로 남겼다.

첫 root-mapped overlay의 `/tmp/mcs-native-overlay-{original-compound,current-compound,current-regressions}.log`는 FAIL 기록이다. compound의 최초 count2 기대는 원래 LOW Review의 v3 preparation/integration을 빠뜨렸으므로 두 원래 호출 외의 exact broker-derived key·kind·source·request·preparation 관계와 전체 membership을 추가 검사하도록 교정했다. baseline만 보정한 중간 기대와 legacy refresh-kind 기대의 실패도 `/tmp/mcs-native-{overlay-current,unprivileged-current}-compound.log`에 남긴다. 자동 LOW 통합을 없애거나 accepted 역사를 지우지 않았다. root/capability probe의 permission-denial/child 실패를 native product PASS로 합성하지 않고 UID 유지·capabilities 제거 환경에서 전체 245건을 새로 실행했다. 새 product source fix로 주장하지 않는다. 앞선 일반-host 245건 221 PASS/1 ENOENT FAIL/23 NOT_RUN은 `/tmp/mcs-receipt-diagnostic-publication-final-regressions.log`의 과거 입력/환경 기록이다.

### 남은 gate

[DR71](../design-revisions.md#dr71--기존-mcp-기능을-새-collaboration-역할-제한으로-추가-차단하지-않는다)은 사용자의 기존 MCP 기능 보존 정정을 반영한다. 새 MCP 차단/추가 서버 격리는 미완료 필수 항목에서 철회하며 MCP 자체의 기존 회귀는 면제하지 않는다. OMA가 제공하는 role projection·mutation RPC 인증/현재 권한과 Human authority는 그대로다. 남은 original invocation corruption/unknown/concurrency/restart·actions/accepted create/Review·delivery/Human OS-exit/private editor·readiness/credentials·closure/migration/rollback을 완성해야 한다. 필수 physical crash/filesystem/kernel/native macOS/live provider·동일 조건 실제 A/B 및 reliable typed-send/file-outbox B/C, 미결정 authority/wire/persisted/publication/lifecycle/context gate도 별도로 남는다. 활성화·commit·push·merge·배포하지 않았다.

## collaboration-v1 — 원래 invocation 연결 owner 확장

입력: `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` 위의 보존된 dirty WIP. I2는 **PARTIAL**이며 새 모델 액션이나 production session cutover를 완료한 것이 아니다.

- 기존 `RequestCache`에 원래 Society birth/actor/session/assistant entry/tool-call과 tool·원본 인자를 결박하는 versioned 연결을 추가했다. key는 호출 identity에서 파생하며 인자·tool 변경은 같은 key에서 충돌한다. 성공한 동일 문장의 후속 호출은 별도 의도로 허용한다. 일반 caller cache는 여전히 model-mutable이며 authority가 아니다. 새 API는 별도로 선택한 model-writable mount 밖의 host home을 요구하지만 **그 production home 선택·session 인증 연결은 아직 미완료**다.
- 기존 `RequestService`/typed `Client.requestReceipt`에 opt-in preparation/send/verified-receipt hooks를 연결했다. mutable source 전에 binding을 보존하고, 완료된 freeze가 사라지면 builder와 metadata 재구성을 거절한다. may-have-sent marker는 실제 전송이나 acceptance의 증거로 해석하지 않는다. 원래 key의 명시적 broker absence에서만 원래 freeze를 resend한다.
- pending send는 새 key/달라진 문구의 send를 fence한다. canonical receipt가 확인되면 같은 원래 operation을 재관측하며 permanent content deduplication을 만들지 않는다. frozen bytes의 변조는 resend를 막지만 원래 receipt의 독립적인 canonical 관측은 허용한다. receipt contradiction은 성공으로 표시하지 않고 원래 관측을 보존한다.
- 실제 app runtime/RequestCache/RequestService와 실제 Store/Mail/filesystem을 조합한 invocation 회귀 **10 PASS / 0 FAIL / 0 SKIP**. binding/freeze/send-marker/receipt-link 파일 fsync의 실제 EIO 후 fresh-owner retry, 전송 후 응답 손실, unknown fence, BOM/CRLF 원문 및 read의 delivery 불변을 확인했다. 후속 cache/CLI receipt/mail/review/state 관련 guarded serial 회귀는 **104 PASS / 0 FAIL / 0 SKIP**다. transport callback은 테스트 port이며 실제 broker listener·Pi continuation·OS crash의 증거가 아니다. 별도 client package regression **1 PASS**, `npm run build`, static package check, **27개 workspace packed-install isolation/지정 smoke**, module/legacy/inventory/lattice/kernel/transaction/boundary/documents/spec-inventory를 포함한 전체 architecture chain이 현재 입력에서 PASS했다.

원시 로그: `/tmp/mcs-invocation-{build,tests,client-tests,package}.log`. 보호된 host root의 실제 선택, authenticated Pi session/branch lineage와 연결, source/bundle staging 및 child identities, pending 결과의 다음 model request 이전 재연결, 모든 9개 액션과 receipt/log records, 대형 receipt의 완전한 영속 표시까지 아직 남았다. 현재 hook/API만으로 I2 완료라고 하지 않는다. 기존 tool/wire/session의 기본 동작은 유지한다.

확장 mail 회귀의 publication counter 실패도 다시 조사했다. 약한 `assert.rejects`를 **의도한 publication 이후 fault의 code/message까지 확인**하도록 강화하니 실제로는 그 지점 전에 `namespace launcher could not start (ENOENT)`가 발생했다. 해당 namespace owner는 고정 `/usr/bin/bwrap`만 허용하며 그 실행 파일 부재를 재확인했다. 이 lane은 여전히 FAIL/BLOCKED이지 PASS가 아니다(`/tmp/mcs-submit-current.log`). 초기 architecture 실패의 새 pure codec/role-value 파일 분류를 기존 exact kernel registry에 추가하고, prompt의 `node:path`는 path grammar에 한정한 file-scoped 허용으로 등록했다. 이후 document scanner가 기존 gitignore 대상인 root `.pi`의 machine goal state를 project document로 세던 결함을 고쳤다. nested `notes/.pi`의 authored markdown은 여전히 거절하는 negative control을 포함한 document 회귀도 PASS다. 최종 원시 로그: `/tmp/mcs-invocation-{regressions,isolation,architecture,doc-tests,inventory,digests,graph}.log`. 첫 isolation timeout/부분 결과는 완료로 세지 않고 전체를 재실행했다. 이러한 inventory/static/package 통과는 runtime qualification이 아니며 source는 NOT_REVIEWED, native platform/provider/A/B/C는 NOT_RUN을 유지한다.

## collaboration-v1 — mail 비용 결함 교정과 Worker 경계 연결

입력: `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` 위의 기존 dirty WIP. 전체 I0–I6 완료나 cutover가 아니다. 앞선 구현의 미완성 review import로 실패하던 app build를 실제 publisher로 복구했다.

- Mail history는 변경된 membership/index/acceptance partition만 다시 게시하고, 내용이 같은 immutable page를 재사용한다. 32 acceptance bucket은 layout partition이며 retention/quota가 아니다. `Child:` 링크는 서로 겹치지 않는 immutable subtree를 가리킨다. 현재 관측 시각/범위는 health가 소유한다. 아직 R04의 모든 per-page header 요구를 최종 qualification한 것은 아니다.
- History cache는 indexing metadata와 행만 보유한다. 완전한 body/MailRecordFacts를 유지하지 않는다. 검증된 complete message/thread 관계만 actor+role별로 재사용한다. absent parent는 성공/영구 부재로 cache하지 않고 재관측한다.
- 사용자의 원본 `/tmp/oma-collaboration-review-probe.mjs`는 보존했다. 복사본은 제거된 `body` 필드의 계측만 `body ?? ''`로 바꾸었다. 현재 build/실제 Store/Mail/filesystem 재실행: idle 1 write/0 page, unchanged dirty **1 write/0 page/1 source read**, unrelated append **9 writes/3 pages/1 source read**, 21×16KiB 원문 중 history cache의 body **0 bytes**, 12 ancestors 아래 reply **1 source read**. 사용자 이전 재현의 dirty 53/25, append 55/26, body 336KiB, ancestry 14와 구분한다. 이 값은 process 전체 heap/CPU 복잡도/production throughput 증거가 아니다.
- Worker mail body/metadata/page links는 host 저장 경로가 아니라 실제 read-only mount의 `/oma`로 렌더한다. Principal은 허용된 실제 host root를 유지한다. 일반 read에 RPC/ACK 동작을 추가하지 않는다.
- `collaboration-reviews.ts`는 기존 ReviewStatus owner의 policy/quorum/status를 재사용하고 Worker accepted facts·저장된 frozen context/applied patches를 게시한다. Principal에는 기존 approval/applied visibility와 좁은 status/own-vote만 제공하며 Worker facts/contexts/patches를 게시하지 않는다. source revision 전체 patch·binary blob·exact targets는 아직 불완전하다. patch cache에는 digest만 보유한다.
- Native Resident의 고정 host tool-surface 선택을 실제 broker `batch.prepare`의 record refresh와 결박했다. startup/reconnect/후속 delivery에서 같은 prepare owner를 쓰며, 실패하면 model activation에 batch를 반환하지 않고 원래 prepared batch를 보존한다. 기본 legacy selection에서는 이 refresh를 실행하지 않는다. Principal production refresh와 tool-boundary dirty/failure events는 아직 남았다.

현재 실행: `npm run build` **PASS**, guarded serial mail/review/state/Pi/legacy read-budget **53 PASS / 0 FAIL / 0 SKIP**. 실제 Store/Mail/Git/frozen files 및 실제 Pi/loopback을 사용하되, delivery composition fixture의 execution/process-lock은 제한된 test ports다. kernel mount·OS endpoint·live provider 검증이 아니다. immutable/status/index/health 실제 EIO 후 same/fresh owner retry에서 receipt/delivery/ACK 불변을 검사했다. 과정의 잘못된 fixture(adopt no-op, Principal approval 전 준비 기대, 미지정 batch frame)는 실제 owner에 맞춰 수정했으며 validator/권한을 느슨하게 하지 않았다.

원시 로그: `/tmp/mcs-records-current-{build,tests,probe,boundaries}.log`, `/tmp/mcs-boundary-tests-{2,3,4,5}.log`, `/tmp/mcs-mail-cost-tests-final.log`. 별도 확장 회귀는 **50 중 49 PASS / 1 FAIL**이며 `mail-submit-scope`의 publication counter 기대 `1`, 실제 `0`을 단독 재실행에서도 확인했다. 이 미해결 실패를 53건 PASS로 덮지 않는다. repository-wide whitespace check는 기존 다른 WIP 3파일의 EOF blank를 보고했으며 이번 범위로 지우지 않았다. architecture/inventory/boundary의 최종 현재-input 판정은 아래 후속 기록 전까지 UNVERIFIED다. 전체 filesystem/crash/native macOS/provider/A/B/C는 종전 미완료 범위를 유지한다. source는 NOT_REVIEWED다.

## collaboration-v1 — 누적 groups·전체 역할 text·메일 이력 확장

입력: `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` 위의 보존된 dirty WIP. 아래 첫 mail-record slice 이후의 변경이며 과거 PASS를 재사용하지 않는다. goal `mvxckk79-eaf42n`은 전체 I0–I6 구현을 요구한다. **전체 완료·cutover·실제 모델 비교가 아니다.**

### 현재 source와 실제 실행 범위

69개 요구 절과 64개 시나리오의 현재 구현/증거/미완료 연결은 [요구사항 추적표](collaboration-v1-trace.md)가 소유한다. 이 표의 PARTIAL을 전체 시나리오 PASS로 해석하지 않는다.

- `packages/domain/src/collaboration-surface.ts`와 `packages/tool-runtime/src/collaboration-groups.ts`: old v2 exact selection과 분리된 role-bound v3 catalog, closed entry schemas, 누적 union, persisted-result 관계와 branch restore 검증. v3는 host role 없이 catalog만 제공하면 거절한다. failed result·위조 result ID·discarded boundary draft·late shadow·숨긴 registration·cross-role 상태는 exposure를 만들지 못한다.
- `test/collaboration-groups-engine.test.ts`: pinned Pi **1.0.1**의 실제 SDK·persistent SessionManager·loopback scripted HTTP provider로 result JSONL이 exposure event보다 먼저 저장되고 다음 요청의 definitions와 callable registry가 일치함을 검사한다. 두 역할·두 순서·same batch·resume·invalid args를 포함한다. non-group catalog는 inert fixture이며 broker actions나 live provider를 검증한 것은 아니다.
- `packages/domain/src/collaboration-prompts.ts`: 명세의 **Worker/Principal 전문과 공통/role authority 전문**을 별도 export로 구현했다. 실제 host 값만 environment에 serialize하고 angle brackets를 escape한다. `packages/extension/src/prompt-boundary.ts`는 **명시적 host scope가 있을 때만** 새 role/authority/environment를 조립한다. scope가 없는 기존 production caller는 기존 prompt 계약을 유지한다. custom authored role은 host authority를 대체하지 않는다. 다음 요청에서 active-tool guidance만 필요한 만큼 갱신하고 역사 message는 고치지 않는다.
- `packages/storage/src/ledger-reader.ts`의 `acceptedOperationPage`는 decoded accepted operations를 bounded SELECT page와 고정 high-water 범위로 제공한다. 새 mutation cursor나 schema가 아니며 cross-page snapshot을 주장하지 않는다. `apps/oma/src/views/collaboration-history.ts`는 permitted history/sent/commons/topics/threads·generation pages·mail-only health를 투영한다. 새 Worker의 과거 delivery row를 만들지 않으며 Principal workers-only 자료는 materialize하지 않는다. 새/미게시/명시적 dirty operation만 source를 다시 관측하고, mutable delivery freshness를 acceptance cursor로 가장하지 않는다.
- `test/collaboration-mail-records.test.ts`: 132건 history·late reader·topic/thread·pending archive와 acceptance-order 불변, 실제 body/metadata/page/index/health write의 EIO 뒤 fresh-owner rebuild를 추가했다. injection은 **in-process fault**이며 process kill/power loss가 아니다. 새 durable owners는 `implementation/durable-boundaries.json`에 연결한다.

### 실행 판정

| 검사 | 결과·범위 |
|---|---|
| `npm run build` | 최신 prompt/domain/extension source workspace·root compilation 및 27개 workspace static package check PASS. 후속 fixture snippet 추가는 다음 root compile에 포함 |
| domain prompt + extension prompt boundary + tool-runtime selected unit regressions | **26 PASS / 0 FAIL / 0 SKIP** |
| guarded records/history | **20 PASS / 0 FAIL / 0 SKIP**; 전체 repository suite가 아님 |
| 실제 Pi group/prompt HTTP regression | 최신 root compile 뒤 **8 PASS / 0 FAIL / 0 SKIP**. 전문/default/custom role·host sections·누적 guidance를 실제 request에서 확인 |
| 처음 확장한 Pi prompt regression | **26 PASS / 2 FAIL**(records/history 포함 28건). inert fixture의 snippet 부재를 고쳐 다시 실행. 실패한 assertion을 삭제하거나 완화하지 않음 |
| 새 source architecture/isolation/full runtime/native/provider qualification | 아래 새 입력으로 다시 실행하기 전에는 UNVERIFIED/NOT_RUN. 이전 slice PASS를 전용하지 않음 |

원시 로그: `/tmp/mcs-history-build.log`, `/tmp/mcs-history-tests.log`, `/tmp/mcs-prompts-build.log`, `/tmp/mcs-prompts-tests.log`, `/tmp/mcs-engine-history-tests.log`(첫 2 FAIL 포함), `/tmp/mcs-engine-prompts-tests.log`(8 PASS). 처음 취소됐던 build는 성공으로 집계하지 않으며, 이후 실제 build를 재실행했다. LSP 도구/skill의 현재 설치가 확인되지 않아 compiler와 bounded source reads를 사용했으며 LSP-clean으로 기록하지 않는다.

### 미완료와 명시적 gate

새 host prompt API와 mail history는 아직 authenticated production session selection·record mounts/containment·safe-boundary dirty notification에 연결되지 않았다. GOAL/receipts/peers/logs/subscriptions·review immutable artifacts/exact targets와 I2 invocation linkage, I3 actions/versioned accepted publication, I4 전체 등록, I5 Human controls/compatibility/rollback, I6 실제 모델 비교가 남았다. old tools/query/wire/session은 유지하며 alias를 함께 노출하지 않았다. 변경 source는 NOT_REVIEWED다.

별도 DR가 필요한 lifecycle/context 축소, Principal approval withdrawal 범위, 새 send/spawn acceptance/authority, exact refs의 채택을 구현 명령만으로 소급 승인하지 않는다. 실제 full-filesystem 시험은 `/usr/bin/bwrap` 부재와 비대화형 sudo 불가로 BLOCKED인 별도 실패를 유지한다. macOS native·live provider·모델 A/B/C는 NOT_RUN이다. 막히지 않은 구현과 검증을 계속한다.

## collaboration-v1 — mail records 첫 구현

사용자의 `작업시작` 지시에 따라 I1의 첫 slice를 구현했다. 기준은 `work/model-surface-cleanup`, HEAD `a47f70af146791370d3b8e68aad88813654eaf12` 위의 기존 dirty worktree다. 이전 모듈 감사 수정·삭제·untracked 작업을 이 구현으로 집계하지 않는다. 현행 DR64/DR66과 old session/tool/wire는 유지한다. 이 절은 전체 [새 spec](../model-collaboration-surface-spec.md)의 채택이나 cutover 승인 기록이 아니다.

### 구현과 실제 연결 범위

- `packages/mail/src/records.ts`: accepted operation·message ownership·기존 archive 검증을 사용하는 읽기 전용 관측. sender와 Society를 원래 사실에 대조하고, workers-only mail은 Principal에게 거절하며 Principal의 recipient roster를 제외한다. 원본 객체가 frozen됐다는 것만으로 archive publication을 주장하지 않는다. 확정된 archive 부재와 관측 불능을 구분한다.
- `packages/mail/src/display.ts`: strict record-body decoding을 추가했다. UTF-8/BOM·공백·개행을 보존하고 malformed/noncanonical Base64·불량 UTF-8 등을 거절한다. 기존 display fallback은 유지하며 Base64 primitive만 공유한다. vendor reader나 hashline 계약은 바꾸지 않았다.
- `packages/storage/src/ledger-reader.ts` 및 Store의 작은 facade: fully decoded operation의 실제 acceptance row order를 조회한다. 새 table·state·transaction·전역 change sequence를 만들지 않는다.
- `apps/oma/src/views/collaboration-mail.ts`: **명시적 host API로만** 한 prepared batch의 body/role metadata·generation-bound pages·작은 inbox index·partial health를 게시한다. 본문 dependency를 먼저 게시하고 index를 마지막에 교체한다. 64 KiB와 configured frame 중 작은 표시 budget을 사용하며 history/body quota가 아니다. 실제 symlink repair는 기존 held-directory owner가 링크 자체를 교체하며 외부 대상은 따라가지 않는다.
- 회귀는 실제 Store·Mail·accepted bytes·archive·delivery·filesystem을 사용한다. body의 가짜 sender/frontmatter를 metadata로 승격하지 않음, verified reply ancestry, 페이지 누락 부재, Principal physical projection의 workers-only ID/subject/body 부재, source/projection 손상 후 이전 index 보존, ACK/presentation/receipt 불변을 확인한다.

**아직 production `batch.prepare`, 새 mount, Principal ordinary read/grep containment에 연결하지 않았다.** 모델이 실제로 `/oma`를 읽는 기능·전체 history·topic/sent index·GOAL/receipt/peers/log·review artifacts/exact targets·boundary refresh/notification은 미완료다. 이 slice의 metadata는 최초 구현이며 전체 role-specific closed schema와 이행 qualification의 완료를 주장하지 않는다. 기존 query 도구는 삭제하지 않았다. I1 전체 및 I2–I6는 미완료이며 새 send/spawn acceptance나 lifecycle capability 변경도 없다. 새/변경 source는 NOT_REVIEWED다.

### 실행 결과와 한계

Node `v26.0.0`을 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin`에서 사용했다. 아래 결과는 이 첫 slice의 실행 범위이지 전체 repository/native/provider 지원 판정이 아니다.

| 검사 | 실제 결과 |
|---|---|
| `npm run build` | workspace/root compile 및 static package check PASS |
| `npm run typecheck` | PASS |
| guarded serial 선택 회귀 | mail package tests와 새 records·기존 mail integrity/reply/typed/recovery/facts tests: **50 PASS / 0 FAIL / 0 SKIP**. 새 case는 body 17개 + records 13개(게시 EIO 후 새 owner 재시도 2개 포함) |
| `npm run check:package-isolation` | 27개 workspace packed install·public imports·authored declarations PASS. 지정된 installed runtime smoke도 PASS이며 Mail의 새 strict body decoder를 포함 |
| `npm run check:architecture` | module·legacy·source inventory·rule·architecture·transaction·durable boundary·document·spec inventory 모두 PASS. 새 경계 두 개는 실제 in-process EIO/retry 시험으로 등록했으며 SIGKILL proof가 아님 |
| source inventory/digests | 기존 생성 script로 새 source 두 파일을 포함해 갱신. `runtimeProof:false`, LOC 재측정이나 authored review 승인이 아님 |
| active LSP probe | 9개 파일에서 error 0개, 2개 clean 확인·7개 inconclusive. 9개 모두 clean으로 표현하지 않음. 최종 test 3파일 재조회도 error 0개·모두 inconclusive |

별도의 더 넓은 첫 선택 실행은 **50건 중 49 PASS / 1 FAIL**이었다. 실패는 `test/mail-settlement-storage.test.ts`의 실제 full-filesystem child이며 `/usr/bin/bwrap`가 이 환경에 없어 시작하지 못했다. 해당 시험을 skip하거나 synthetic quota로 바꾸지 않았다. 이 범위는 BLOCKED이며 후속의 다른 선택 50건 PASS로 전체 PASS를 합성하지 않는다. 초기 새 fixture의 configured batch-view limits 누락과 기존 owned-directory의 안전한 symlink repair를 거절로 기대한 assertion도 실제 실패 뒤 fixture/oracle을 수정했다. 제품 validator를 느슨하게 하거나 시험을 제거하지 않았다. 정적 gate의 최초 graph source mismatch는 기존 graph generator로 갱신했고, 누락된 새 durable boundary 두 개는 별도 EIO/retry 회귀를 추가한 뒤 등록했다. gate를 제외하거나 과거 kill test를 새 owner의 실행 증거로 전용하지 않았다.

Packed isolation은 disk-backed `TMPDIR=/home/dev/.cache/oma-mcs-validation`에서 실행했다. 일부 SDK 의존 workspace의 external declaration diagnostics는 44개이며 authored declaration PASS와 구분한다. Linux 실행이므로 `platform-mac`의 공통 packaging smoke를 macOS native qualification으로 읽지 않는다. 실제 provider/model 비교·mount/containment·process/power-loss crash qualification·전체 runtime suite는 NOT_RUN이다.

원시 로그: `/tmp/oma-mcs-complete-build.log`, `/tmp/oma-mcs-complete-tests.log`, `/tmp/oma-mcs-complete-architecture.log`, `/tmp/oma-mcs-regression.log`(full-filesystem 실패 포함), `/tmp/oma-mcs-isolation.log`, `/tmp/oma-mcs-final-typecheck.log`. 앞선 실패·중간 실행 로그도 같은 prefix 아래 남겼다. 마지막 compile/회귀 이후 production source 변경 없이 검증 기록을 보강했으며, 이 문서 자체의 변경을 앞선 runtime 실행 입력으로 소급하지 않는다.

## 모듈 감사 후속 수정 — 2026-11-01

이 절의 `AUD-*`는 아래의 과거 29항목 backlog와 다른
[모듈 감사](../module-audit-2026-10-31.md)의 식별자다.
23개 결함을 수정하고 AUD-25의 죽은 경로를 제거했다. 14개 River Flash/max 작업자가
연결된 소유권 단위로 나누어 수정했으며, 부모가 19개 workspace의 변경과 회귀를 통합했다.
macOS 구현과 vendor 내부는 수정하지 않았다.
[DR70](../design-revisions.md#dr70--모듈-감사의-경쟁경계-결함을-기존-권한-안에서-수정한다)이
현재 계약과 수정 경계를 기록한다.

### 실행한 gate

| 검사 | 관측 결과와 범위 |
|---|---|
| `node scripts/build.mjs` | workspace와 root test 계약 빌드, static package check PASS |
| `tsc -p tsconfig.json --noEmit` | 최종 workspace 선언을 사용하는 root typecheck PASS |
| `npm run check:architecture` | module·legacy·source inventory·rule·architecture·transaction·durable boundary·document·spec inventory 전부 PASS |
| `node scripts/functional-surface.mjs` | 실제 SDK의 도구 선택·교체·재개·reset 및 anchored edit/refusal PASS; 결정적 local stream |
| `node scripts/check-package-isolation.mjs` | disk-backed TMPDIR에서 27개 workspace의 packed install·public import·authored 선언 검사 PASS; 지정된 installed runtime smoke도 PASS |
| 최종 guarded 선택 회귀 | 66개 파일, 744 PASS / 0 FAIL / 0 CANCEL / 0 SKIP |

격리 checker는 authored 선언 오류와 external 선언 진단을 구분한다. SDK에 의존하는
일부 workspace는 external 진단 44개를 출력했다. 이 결과를 모든 외부 선언의 무오류로
표현하지 않는다. App의 dependency closure를 확인하는 공통 패키징 검사에는
`platform-mac`도 포함됐지만 모든 실행은 Linux였고 macOS native qualification은 아니다.

최종 선택 회귀는 Node 26과 `scripts/local-test-guard.mjs`, test concurrency 4로 실행했다.
전후 15,775개 입력의 digest는
`686870ae59bd6074a58590318f4343dad8c06b28fc0081ec45cbd18b927191b8`로 같았고
`inputChanges: []`였다. 이후 결과를 덧붙인 문서와 최종 구조 binding은 이 실행 당시
입력과 구분한다. 전체 repository/native suite PASS가 아니라 명시한 선택 범위의 결과다.


### 실제 실행에서 관측한 동작

- 실제 Store·Mail·Git에서 adopt/revise 중 바뀐 provenance의 후속 attempt가 성공하고
  main이 candidate를 가리키며 admission이 healthy로 남았다. 과거 terminal receipt는
  바꾸지 않았다. 실제 Git candidate와 Client/cache의 96자 key 재시도는 `git.submit`
  한 번만 수행했다.
- frameBytes=768의 실제 메일 6건은 준비에 성공했고 pending은 0이었다. codec floor에서
  direct/public-list 두 class와 최대 Worker 이름을 함께 선택해 최초·재안내가 모두
  수용됨을 별도 실제 메일 시나리오로 확인했다.
- 실제 개인 세션 birth 15,000개를 만들고 compiled `SocietyInteraction.onUi` 자체를
  실제 파일과 TCP에 연결해 모두 수신했다. application ports를 제어했으며 terminal
  renderer·broker는 구성하지 않았다. copied sender loop가 아니라 변경한 App handler의
  write 완료 대기를 실행한 증거이고, 전체 `/resume` 화면 렌더링 qualification은 아니다.
- 별도 10만 경로·일시 정지 TCP 수신자에서는 단순 yield 구현이
  15번째 frame에서 buffer-limit 종료를 일으켰다. write 완료 대기로 보강한 실행은
  22개 frame으로 10만 경로를 전부 전달했다. 최대 JSON frame은 262104 bytes였고,
  cork 상태와 수신 정지 상태의 pending write는 각각 262105 bytes로 한 frame 이내였다.
  후자는 실제 birth 10만 개를 만든 시험이 아니라 유효 경로 catalog의 flow-control
  시험이다. 로컬 write 완료를 peer 처리나 durable receipt로 해석하지 않는다.
  작은 pending write도 Socket high-water mark에 못 미친다는 이유로 deadline이 빠지지
  않는다. 실제 Socket에서 완료된 write는 deadline 뒤에도 살아 있었고, 계속 막힌 write는
  deadline에 닫히며 대기자에게 `ERR_STREAM_DESTROYED`를 반환했다.
- 실제 Principal SDK+PTY에서 전달 거절이 host까지 도달하고 해당 claim이 반환됐으며,
  completion은 생성되지 않고 다음 전달이 접수됐다. 큐의 Human prompt도 engine에
  도달했지만 선택 모델의 API key가 없어 명시적으로 거절됐다. 모델 turn 완료나
  provider 추론 성공을 주장하지 않는다.
- `scripts/functional-surface.mjs`는 실제 SDK/session에서 core → selected → replaced →
  resumed → reset을 실행했다. anchored replace/replace_within/insert, 제거된 도구의
  거절을 확인했다. assistant stream은 결정적 local stream이며 inference는 금지했다.
- 조건부 write 중 실제 append는 거절됐고 `abc!`가 보존됐다. 결과 파일의 실제 교체
  interleaving에서는 page와 보고된 digest가 같은 원본 bytes를 가리켰다.
- 실제 UID 1000에서 mode 0000 하위 scratch를 제거하고 ancestor와 외부 링크 대상의
  bytes/mode를 보존했다. 별도로 강제 O_PATH pin 뒤 이름을 바꿔 수리해도 held inode만
  변경되고 그 이름에 새로 놓인 directory의 mode는 유지됐다.
- 실제 PATH의 앞선 directory 후보를 건너뛴 후 뒤의 실행 파일이 실행됐고 exit 0이었다.
  실제 state 경로와 symlink alias는 쓰기 전에 거절됐다. 잘못된 authored relative libdir는
  validation/load/project seed 모두 거절됐고 project 설정 파일은 생성되지 않았다.
- 실제 vendored MCP stdio transport의 정상 close에서 writer exit가 scratch 제거보다
  먼저 관측됐고, 남은 child·scratch·late-write는 없었다. 별도 late lane join은 이미
  실패한 작업의 원래 오류를 반환했다. 실제 CLI의 `--help`도 exit 0이었다.

### 통합 과정에서 보존한 실패와 판정

최초 선택 실행의 6개 실패는 VM realm 비교·loader 경로·전달-only 시험 문제였다.
realm의 prototype 대신 소비자 값을 검사하고 loader 경로를 바로잡았다. 단순 mock echo
시험 두 개는 재고정하지 않고 제거했다. 이후의 통합 실행과 실제 SDK·PTY 관측은 구분한다.
큰 catalog 수정 중에는 Socket high-water mark보다 작은 pending write에 deadline이
없어 새 회귀가 3초 timeout으로 취소됐다. 이 실패를 보존하고 작은 queued write에도
기존 write deadline을 적용했다. 정적 gate가 잡은 owned-tree chmod도 예외를 추가하지
않고 기존 `tool-files/descriptor-files`의 held-inode primitive로 옮겼다.

첫 package-isolation 실행은 26개 workspace를 통과한 뒤 App의 `npm ci`가 `ENOSPC`로
실패했다. `/tmp`는 3.8GB tmpfs였고, 중단한 이전 검사에서 남은 1.3GB를 정리했다.
실패 로그를 보존했으며 동일 검사기의 assertion·범위는 바꾸지 않았다.

AUD-13은 Host-only invalidation을 일반 Principal에게 개방하는 결함 수정으로 세지 않는다.
Worker·Worker+host·일반 Principal의 거절과 인증된 host Principal의 허용을 회귀로 유지한다.
AUD-04·28의 실행 반증과 AUD-26·27의 제외도 유지한다. AUD-25는 MODE-005의 fresh-mode
전환을 보존하는 obsolete-path 제거이지 옛 DR28 slot 동작의 복원이 아니다.

### 증거와 qualification 한계

세션 artifact의 `module-repair-*-smoke-evidence.json`,
`module-repair-catalog-backpressure-{before,after}.json`,
`module-repair-principal-pty-final-{result.json,transcript.log}`에 실행 소스·관측을 보관한다.
정확한 argv·선택 경로·전후 source map은 `local://module-repair-final-verification.json`,
완전한 TAP은 `local://module-repair-final-tests.tap`에 있다. 실제 App handler의 별도
관측은 `local://module-repair-actual-catalog-handler-smoke.json`에 보관한다.
에이전트의 이전 transpile·suite copy·simulated probe를 rebuilt-product PASS에 합치지 않는다.
production source digest·dependency graph 생성은 구조 갱신일 뿐 runtime proof나
authored review 재승인이 아니다. 변경된 normative clause도 inventory 갱신만으로
검증 완료로 승격하지 않는다.

`bwrap` 부재로 실제 confined Worker/Git launch와 전체 local suite는 qualification하지
않았다. cloc 측정, macOS native, 실제 호스트 reboot/power-loss, live provider 추론도
미실행이다. MCP vendor의 SIGKILL fallback은 death/reaping을 기다리지 않아 정상
stdio close와 같은 증거로 취급하지 않는다. execve의 kernel-owned format/noexec/TOCTOU
거절과 조건부 write의 마지막 sample 이후 비협조 writer에 대한 원자적 CAS도 범위 밖이다.
openat2의 제어된 EAGAIN 회귀와 실제 kernel 관측은 원래 CI 실패의 정확한 race 원인
증명이 아니다. Web 무결성 원인 진단은 engine stderr에서 확인했으며 App의 사용자 화면
표시까지 검증했다고 주장하지 않는다. commit·push·merge·배포는 수행하지 않았다.


## 2514385f 기준 29항목 backlog — 남은 구현 완료

허용된 29항목의 구현과 회귀를 반영했다. 이전 checkpoint에서 남았던 #14·#17·#27도
아래 방식으로 처리했다. **구현 완료와 전체/native qualification 완료는 다르다.**
macOS, 지정 제외 6개 및 별도 active Worker-cap 변경은 계속 제외하며,
역할 prompt·화면 공유 시험 앱·과거 archive는 수정하지 않았다.

- **#14:** 실제 CLI 재현의 `packageBytesUnchanged: false`를 수정했다. store lease 아래
  기존 leaf/tree와 settings/index의 정확한 preimage를 durable하게 보관하고, engine/index
  실패는 rollback한다. 새 owner는 index를 읽기 전에 미완료 교체를 복구한다. 일반 runtime은
  미완료 교체를 `BROKER_UNAVAILABLE`로 거절해 새 bytes를 몰래 사용하지 않는다.
  실제 첫 install → 실패 재설치, 부분 settings/index 쓰기, host/engine SIGKILL과 상속 lease,
  새 owner의 복원 및 성공 재설치를 시험했다. 별도 10개 syscall/phase SIGKILL 회귀도 있다.
  복구 record의 malformed UTF-8은 대체 문자 경로로 정규화하지 않고 효과 전에 거절한다.
- **#17:** Human-only `oma recover-execution --society <name> --prepare|--apply`를 추가했다.
  Society lease/broker lock, 원본 보관본·digest, 원래 root와 OS host identity를 검사한다.
  준비 후 journal admission은 닫히며 **다른 Linux kernel boot가 확인되어야만** 적용한다.
  같은 boot, 변경된 원본/보관본/ticket, 링크와 살아 있는 owner는 계속 거절한다.
  실제 CLI에서 pending accepted operation의 id/planJson/state와 DB bytes 보존을 시험했다.
  changed-boot와 reset 중단 재개는 제어된 kernel observation 시험이며 실제 호스트 재부팅
  qualification은 아니다. [운영 절차](execution-recovery.md)를 따른다.
- **#27:** 실제 SDK에서 invalid `/oma-deliver`가 `success: true`, disposition `handled`를
  반환하지만 `agent_start`는 0개인 경로를 재현했다. trusted extension은 `sendMessage` 전,
  pending delivery가 없고 engine이 idle인 경우만 correlated never-started 관측을 보낸다.
  해당 claim만 반환하며 실제 시작·잘못된 batch·불명확한 send·무응답은 반환하지 않는다.
  receipt/완료를 만들지 않고 같은 prepared batch를 유지한다. 정상 장시간 turn에 deadline을
  추가하지 않았다. 실제 SDK/session/PrincipalDelivery 및 queued Human handoff 회귀를 포함한다.
  preflight 파일의 close 오류도 원래 오류를 유지하며 미시작 관측을 전달한다.

최종 source-bound 선택 gate의 실행·입력 digest·경로 변경 목록은
`/tmp/oma-29-complete-checkpoint.json`과 그 job별 log에 기록한다.
새 회귀/관련 owner, 기존 backlog 선택, 전체 architecture, package-isolation을 구분하고,
전체 local suite의 시도와 native NOT_RUN도 PASS에 합치지 않는다.
LSP primary 진단과 보조 style/static finding, 제어된 syscall/kernel 관측 및 실제 native
qualification 역시 같은 것으로 취급하지 않는다. commit·push·배포는 수행하지 않았다.

확대 검증의 실패도 보존한다:

- 중간 소스에서 `scripts/test-local.mjs` 전체를 실행했다. serial phase **14개: 8 PASS /
  1 FAIL / 5 SKIP**, parallel phase **4,127개: 3,831 PASS / 222 FAIL / 74 SKIP**였다.
  `/tmp/oma-29-full-attempt.{json,log}`에 고정된 15,764개 입력의 동일한 전후 digest와
  `sourceChanges: []`를 기록했다. 이후 보완한 최종 소스의 full-suite PASS 증거가 아니다.
- 실패에는 없는 `/usr/bin/bwrap`, `cloc`, native mount/delegation 의존성, 50 ms status
  oracle의 67 ms 관측, 새 recovery capability가 빠진 composition fixture, inherited guard와
  installed checkout 금지 검사의 충돌이 포함된다. 모든 실패를 한 원인으로 몰지 않는다.
- composition fixture에는 새 capability를 명시하고 평상시 startup에서 호출하면 실패하는
  trap을 뒀다. local backstop은 같은 자체 포함 코드를 data URL로 상속하므로 installed
  runtime에서 checkout 모듈을 허용하는 예외가 필요 없다. fork/명시적 `env:{}` 상속과
  credential 비상속은 유지한다. 경계/의존성 policy와 설치 검사의 oracle은 완화하지 않았다.
- 보완 후 전역 backstop 아래 관련 130개를 재실행한 결과 **129 PASS / 1 FAIL**이다
  (`/tmp/oma-remaining-guarded8b.tap`). 남은 Personal `tools` 실패는 실제 `bash` 호출이
  **`BLOCKED: local tests require direct argv`**로 거절된 관측이다. 이 positive oracle을
  성공으로 바꾸거나 guard를 우회해 전체 suite green이라고 표시하지 않는다. guard 없는
  installed PTY 양성 실행은 별도 범위이며 전체 guarded-local qualification을 대신하지 않는다.
- 새 `replaceDerivedEntry`도 durable publication primitive로 검사하며, workflow owner 여섯 곳에
  실제 SIGKILL/restart 회귀를 등록했다. execution archive 발행·ticket 발행·reset 및 package
  collection 중단도 시험한다. 제어된 changed-boot 관측을 실제 재부팅으로 부르지 않는다.

## 이전 부분 구현 checkpoint — 2514385f 기준 29항목 backlog

**이 절은 #14·#17·#27 구현 전의 기록이다. 당시 #14 재현은 실패했으며 현재 결과는 위 절을 따른다.**
macOS, 지정 제외 6개 및 별도 진행 중인 active Worker-cap 수정은 범위에서 제외했다.
역할 prompt와 시험 workload인 화면 공유 앱은 바꾸지 않았다.

- #1–13, #28–29: 구현과 선택 회귀를 반영했다. #28은 별도 Society collector의
  publication 중 진입을 재현했고 공통 configuration-owned lock으로 막았다.
  #29는 project/state 동일·양방향 포함·같은 Git top-level 아래 분리 경로를
  쓰기 전에 거절하며, 문자열 prefix만 같은 독립 sibling은 허용한다.
- #15·16·18: 각각 approval 물리 발행에 따른 읽기 가시성, ACK 설명,
  두 Principal endpoint가 공유하는 preauth 16-socket 방어를 보완했다.
  approval 가시성 결함을 권한 우회로, socket 시험을 OS FD 고갈 재현으로 부르지 않는다.
- #19–26: fence AST 참조, 검증 전후 source 동일성, valid-envelope semantic corruption,
  fuzz 양성/음성 control, fork를 포함한 guard 상속, delivery 중복·grapheme·FD oracle을
  강화했다. lexical fence 확인은 descriptor lifetime 증명이 아니다.
- MCP 상태 파일 처리는 `tool-runtime/private-state`를 통해 SDK 비의존 `tool-files`가
  담당한다. native/storage 의존성 허용 변경은 되돌렸으며 기존 workspace/extension
  경계를 완화하지 않았다. no-follow 디렉터리 순회, exclusive key 생성·재사용,
  파일/부모 fsync, hardlink 거절 및 링크를 따라가지 않는 cleanup을 시험했다.
  유효한 API mock에서 실제 adapter 등록을 확인하는 positive control도 추가했다.
  disposable scratch 링크는 링크 자체를 제거해 복구하고, credential/state 링크는 거절한다.
- UI 내부 회귀는 `packages/engine/test/interactive-input-backlog.test.mjs`로 옮겼다.
  root 테스트가 다른 workspace의 private dist를 직접 가져오는 예외는 만들지 않았다.
  새 project/state 검사 때문에 빠져 있던 composition fixture의 capability도 보완했다.

현재 선택 실행 결과:

- `npm run build`, `npm run typecheck`, 전체 `npm run check:architecture`,
  source inventory/digest 갱신 및 `git diff --check`: PASS.
  새 파일은 K2 file mechanism으로 명시 분류하고 dependency graph 증거를 재생성했다.
- `/tmp/oma-29-combined3.tap`: **332 PASS / 0 FAIL / 0 SKIP**.
  runtime·UI·mail·configuration·review·codec/fuzz·receipt·verification runner 및
  composition/workspace 회귀 선택이다. 전체 repository suite는 아니다.
- `/tmp/oma-29-owners-and-surface.tap`: **90개 중 86 PASS / 0 FAIL / 4 SKIP**.
  Principal 실제 engine guidance/endpoint, writer recovery, inbox 및 launcher 오류 경계를
  포함한다. 4개 Resident surface 시험은 `/usr/bin/bwrap` 부재로 NOT_RUN했다.
  직접 probe도 status null/ENOENT이며 native 격리의 PASS가 아니다.
- 초기 확대 실행 `/tmp/oma-29-combined.tap`의 **237 PASS / 55 FAIL**은 보존했다.
  55개 실패는 composition mock 누락에 모였으며 보완 후 선택 재실행에서 통과했다.
  architecture 초기 실패 6개도 허용 규칙 완화가 아니라 파일 owner/테스트 배치로 해결했다.
- LSP는 일부 push-only/silent-on-clean 결과가 불확정이다. 무진단 응답 전체를 clean으로
  해석하지 않는다. tool-mcp의 기존 double-cast에는 보조 정적 검사 finding도 남아 있다.

당시 남은 항목과 실패 증거:

1. **#14 local package 교체 실패 원자성 — 미수정.** 실제 CLI로 첫 local install을
   성공시킨 뒤, 설정을 쓰기 전에 exit 7 하는 제어된 host engine으로 재설치했다.
   `settingsUnchanged: true`, `packageBytesUnchanged: false`가 관측됐다.
   `/tmp/oma-29-local-replacement-before2.log`의 실패 assertion은 수정 전 결함 증거이며
   위 green 선택 실행에 포함되지 않았다. 최초 reproduction의 cleanup EACCES는 fixture를
   고쳐 별도 재실행했고, 최종 red는 package bytes 비교에서 발생한다.
2. **#17 손상 execution journal의 운영 복구 — 미구현.** unsafe/unknown fence를
   완화하지 않으며 direct-child exit·identity 부재를 scope death로 바꾸지 않았다.
3. **#27 accepted Principal delivery의 실제 run 미시작 — 재현 후보 유지.** 정상적으로
   오래 실행 중인 mail turn과 구분하는 실패 재현이 없으므로 임의 timeout을 추가하지 않았다.

전체 suite, 실제 provider, 과거 배포 재현, live 배포·commit·push는 수행하지 않았다.
아래 280건 및 4,007건 결과는 각 당시 입력의 기록이며 이 backlog 전체의 완료 증거가 아니다.

## Society runtime 후속 결함 수정 및 검증 — 2026-10-30

아래 writer 정체 수정에 이어 OMA의 읽기·실행 실패 경계를 보완했다.
시험 workload인 화면 공유 앱, 역할 prompt 및 wait/redelivery 구현은 바꾸지 않았다.

- `packages/extension/src/mail-tools.ts`: 첫 batch view가 발행되기 전 `/inbox.md`
  읽기의 ENOENT만 index 미발행으로 돌려준다. mailbox가 비었다고 말하지 않으며,
  파일을 만들거나 알려진 message id/archive 읽기를 막지 않는다. EACCES/EIO,
  symlink·비정규 파일·크기 초과·잘못된 UTF-8은 계속 실패한다.
  `delivery-index-absence`는 수정 전 missing-index 2개 실패, 수정 후 8/8 PASS다.
- `packages/platform-linux/src/namespace-execution.ts`: launcher의 실제 spawn 실패를
  JSON 파싱 오류로 노출하지 않고 BROKER_UNAVAILABLE과 원래 errno로 보존한다.
  launcher가 시작된 뒤 identity가 없거나 잘못되면 RUN_TERMINATION_UNKNOWN을 유지한다.
  direct-child close만으로 scope death나 미실행을 선언하지 않는다.
  `namespace-launch-failure`는 수정 전 1 PASS / 6 FAIL, 수정 후 7/7 PASS다.
  이 시험은 launcher를 제어된 direct argv로 대체한 오류 경계 검사이며 native 격리 PASS가 아니다.

이전 runtime 패치 시점의 입력 검증(29항목 변경 전체의 증거가 아님):

- `npm run build`, `npm run check:architecture`, `git diff --check`: PASS.
- recovery/review·mail read·Principal settlement/ownership·receipt·process 관련 선택 실행:
  **280개 중 258 PASS / 0 FAIL / 22 SKIP**, cancel/todo 0. 새 회귀 25개가 포함된다.
  22개는 `/usr/bin/bwrap` 부재로 기존 Resident 시험이 NOT_RUN한 것이며 PASS가 아니다.
- 별도 native 의존 확대 실행은 160개 중 131 PASS / 7 FAIL / 22 SKIP였다.
  해당 3개 파일만 최종 재실행해도 10개 중 3 PASS / 7 FAIL이다.
  delivery-state model 및 rollover는 launcher 시작에서 막히고, full-filesystem 시험도
  bwrap child를 시작하지 못한다. 이 호스트의 고정 `/usr/bin/bwrap --version`은 ENOENT다.
  실패를 skip으로 바꾸거나 namespace·receipt 검증을 우회하지 않았다.
- 최종 선택 실행: `/tmp/oma-runtime-fixes-final.tap`; native 차단 재실행:
  `/tmp/oma-runtime-fixes-native-blocked.tap`; build/architecture 결과:
  `/tmp/oma-runtime-fixes-build-final.log`, `/tmp/oma-runtime-fixes-architecture-final.log`.
- 전체 repository suite·실제 provider·과거 배포 runtime 재현은 수행하지 않았다.
  archive 배포 digest와 현재 source의 대응 및 과거 재전달 정체의 인과관계는 여전히 미확정이다.

## Accepted integration recovery writer 정체 수정 — 2026-10-30

review advancement가 operation recovery보다 먼저 project writer를 획득하여,
accepted 통합이 매 sweep마다 busy로 밀리는 현재 소스 결함을 수정했다.
project의 pending/unknown `git.submit`·`git.integrate`가 있으면 writer 획득 전에
기존 BROKER_UNAVAILABLE/busy 계약으로 review advancement를 양보한다.
동일 accepted plan·request key를 복구하며 새 통합이나 성공 receipt를 합성하지 않는다.

- 수정 전 real Git/Store/Mail 회귀 2개: 반영 전 pending, CAS 후 통지 실패 모두 정체 재현.
- 수정 후 새 회귀 10/10 PASS. pending/unknown·terminal·별도 context/mail/lifecycle 및 corruption 검사.
- 기존 merge/review·challenge·독립 wake·wait·periodic recovery 관련 101/101 PASS.
- 전체 `npm run build` PASS. 전체 제품 suite나 실제 provider 실행은 아직 수행하지 않았다.
- 과거 archive 배포 digest와 현재 source의 대응은 미확정이므로, 과거 장애 원인까지 확정하지 않는다.

## Architecture improvement P1–P4 final verification — 2026-10-30

P1a/P1b/P1c, P2, P3, P4a/P4b/P4c의 구현이 이 작업 트리에 있다.
항목별 owner와 검증 범위는 [구현 계약](architecture-improvements.md)에 연결한다.
기존 accepted bytes와 terminal receipts, unknown 및 requester 권한을 유지한다.

- 최초 전체 실행: 4,000개 중 3,866 PASS / 134 FAIL / skip 0.
- 첫 수리 검증: 449개 중 441 PASS / 8 FAIL / skip 0.
- 둘째 수리 검증: 84개 중 83 PASS / 1 FAIL / skip 0.
- 추가 검증: 81개 중 77 PASS / 4 FAIL / skip 0. Linux scripted scenarios,
  실제 CAS 전후 SIGKILL, binary rename 및 native pipeline은 통과했다.
  남은 네 실패는 공통 Worker 환경에 추가된 Linux NODE_PATH 때문이므로
  그 추가를 제거했다. Darwin 구현 확장이나 native qualification을 뜻하지 않는다.
- 위 실패 로그를 삭제하거나 PASS로 바꾸지 않았다. 최종 전체 재실행은 별도 기록한다.
- 둘째 전체 실행: 4,003개 중 4,001 PASS / 2 FAIL / skip 0. 두 실패는
  broker/TUI provisioning의 mkdir 경계에서 발생한 EAGAIN이었다. 같은 입력의
  해당 두 시험은 별도 재실행에서 2/2 PASS였으며, 근본 원인은 확정하지 않았다.
- mkdir의 불확실한 결과 뒤 실제 held directory 관측이 성공하는 경우만 기존
  디렉터리 요구를 충족하도록 보완했다. 없는 경로·링크·권한 거절은 계속 실패한다.
  새 회귀는 수정 전 1/4 PASS, 수정 후 4/4 PASS였다. 실제 broker/TUI와 기존
  directory/preparation을 포함한 후속 검증 30/30 PASS, skip 0.

최종 전체 실행 상태: **PASS — 4,007/4,007**, fail/cancel/skip/todo 0.
직렬 14개와 병렬 3,993개가 모두 통과했다. `npm run build` 및 전체 architecture,
transaction, durable-boundary, document, spec-inventory 검사도 통과했다.
이 실행의 고정 입력은 `4367b38229507b1d5ed93af7d83edbe8e217a838c2a759b18062e0be2cf3a8d2`
(15,733개)이며 실행 전후 동일했다. 별도 기록한 변경 입력 192개 SHA도 모두 같았다.
이후 변경은 결과 문서와 증거·변경 경로 목록뿐이며, runtime PASS를 후속 문서 입력의
새 실행으로 재해석하지 않는다. 간헐적 EAGAIN의 native 원인 자체는 미확정이다.

호스트 기본 cloc2.10 및 Corepack 누락 대신 CI와 같은 cloc2.08/Corepack0.34.0을
ignored `.scratch/verify-toolchain`에 설치했다. Node는 호스트 실행 파일의 byte-identical
복사다. npm의 호스트 배포판 의존성도 복사본 내부에 포함해 격리 환경에서 ambient
NODE_PATH 없이 실행되도록 했다. 전역 설치·인증 정보는 바꾸지 않았다. 실제 provider/model 요청,
SWE-Milestone benchmark, push/merge는 실행하지 않았다. 독립 authored review,
전원 차단 전수 조합 및 host 전체 3+3 자원 판정은 이 로컬 시험의 범위가 아니다.

[최초 전체 로그](../../implementation/evidence/architecture-improvements/full.log),
[첫 수리](../../implementation/evidence/architecture-improvements/repair1.log),
[둘째 수리](../../implementation/evidence/architecture-improvements/repair2.log),
[추가 검증](../../implementation/evidence/architecture-improvements/final-targeted.log).
[둘째 전체 로그](../../implementation/evidence/architecture-improvements/full2.log),
[디렉터리 경계 검증](../../implementation/evidence/architecture-improvements/directory-regression.log).

[최종 전체 로그](../../implementation/evidence/architecture-improvements/full3.log),
[고정 입력](../../implementation/evidence/architecture-improvements/full3-inputs.json),
[실행 전후 확인](../../implementation/evidence/architecture-improvements/full3-result.json),
[최종 빌드](../../implementation/evidence/architecture-improvements/full3-build.log),
[최종 구조 검사](../../implementation/evidence/architecture-improvements/full3-architecture.log),
[전체 변경 경로](../../implementation/evidence/architecture-improvements/changed-paths.txt).

## Architecture improvement P1/P2 checkpoint — 2026-10-30

이 기록은 구현 중인 작업 트리의 단계별 시험이다. 전체 명세 완료나 전체 suite PASS를
뜻하지 않으며, P3/P4와 최종 architecture inventory 검사는 아직 남아 있다.

- `npm run build`: PASS.
- P1a/P1b/P1c, 실제 Linux resource limits, 기존 merge/Worker/reconcile,
  execution recovery와 새 pipeline/cache를 묶어 80 tests PASS, fail 0, skip 0.
- 실제 cgroup CPU throttling, 128 MiB 범위의 OOM, 24-task ceiling,
  자식 포함 및 제어 프로세스 제외를 관측했다. host 전체 고갈 시험은 하지 않았다.
- 실제 격리 pipeline에서 setup 산출물/HOME 공유, fresh retry, 별도 로그,
  candidate JSON의 비신뢰 처리, tracked code generation, timeout 뒤 scope death,
  검증 cache를 이용한 offline npm ci와 후속 check를 실행했다.
- native recovery의 SIGKILL 경계도 실행했다. opening witness가 없는 경우는
  unknown으로 유지했으며, 이를 성공한 종료 증거로 바꾸지 않았다.
- [고정 명령과 원시 로그](../../implementation/evidence/architecture-improvements/p1-p2.log).
  이 로그의 PASS는 이 시점 입력에만 해당한다. 이후 수정은 새 실행으로 구분한다.

실제 provider/model 호출, SWE-Milestone benchmark, push/merge는 실행하지 않았다.
캐시 구현은 npm의 [cache integrity 계약](https://docs.npmjs.com/cli/cache/)과 설치된
cacache 구현을 사용한다. P1/P2의 모든 수용 조합을 이 80개가 망라한다고 주장하지 않는다.

## wait 직전 도착한 미전달 메일 재활성화 — 2026-10-30

기존 wait는 당시 pending 전체를 보류해, 현재 batch 밖에서 도착한 메일까지 다음
자동 실행에서 제외했다. broker가 live run에 교부한 정확한 batch를 기록하고,
그 메시지와 동일 automatic invocation이 이어받은 이전 보류 메시지만 제외하도록 수정했다.
wait는 ACK·delivery 완료를 만들지 않으며 explicit start·broker 복구의 재전달은 유지한다.

- 수정 전: `benchmark-reliability`의 before-wait·before-prepare(batch 한도 초과)
  회귀 2개가 실제로 실패했고 기존 3개는 통과했다.
- 수정 후: 해당 회귀, run identity·handoff, wait boundary, periodic reconcile,
  recovery accounting, mail settlement 관련 29개 PASS·skip0.
- 실제 Linux 격리 runner/engine의 `scenario-agent-wait` 5개 PASS·skip0.
  ACK 유무, tool 결과 저장, 지연된 wait 관측, 복구 시 재전달을 검사했다.
- 전체 build와 architecture/transaction/boundary/document/spec inventory 검사 PASS.
- 실제 일반 OMA: Principal `gpt-6-astra`/xhigh, Worker 3명 `gpt-6.1-sol`/medium.
  GOAL 뒤 commons에 질문을 한 번만 보냈다. 세 Worker 모두 질문이 첫 batch에 없고
  첫 wait 전에 도착했음을 ledger·session 기록으로 확인했다. 추가 독촉 없이 두 번째
  batch로 처리하여 42·43·44를 각각 회신했고 Principal이 세 답변을 수신했다.

이는 해당 wait 경계의 회귀·실행 검증이며 SWE-Milestone 본 실행이나 전체 suite 결과는 아니다.

## toolset의 OpenAI schema 호환성

`packages/tool-runtime/src/tool-surface.ts`에서 `select` 배열의 `uniqueItems: true`만
제거했다. 허용 이름 enum과 런타임 중복 거절, 선택 집합 교체·저장 경계는 유지한다.

- tool-runtime workspace build PASS. 기존 tool-surface 회귀10/10 PASS·skip0.
- 실제 Pi SDK의 Principal·Worker session에서 등록된 toolset을 설치된 OpenAI
  Responses converter에 전달했다. strict는 유지되고 `uniqueItems`는 없으며 enum은 보존됐다.
- 양쪽의 실제 tool definition을 실행해 정상 선택·빈 선택 성공, 런타임 집합 검사의
  중복 선택 거절, 현재 batch의 active set 보존을 확인했다.

외부 API 요청이나 provider 추론은 실행하지 않았다. 실제 서버 수용을 검증한 결과는 아니다.
임시 smoke는 파일로 남기지 않았고 새 영구 테스트는 추가하지 않았다.

## Pi 자동 업데이트 안내 숨김

공통 pinned interactive adapter에서 자동 changelog 계산과 새 Pi 버전 안내의 표시
hook 두 개만 교체했다. Society·Personal 모두 mode 초기화 전에 적용한다.
버전·hook 존재 검증과 private contact 목록을 함께 갱신했으며 SDK/vendor 바이트,
설정 파일의 changelog 확인 버전, 업데이트 기능과 명시적 `/changelog`는 변경하지 않았다.

- 전체 build PASS. compatibility/private-contact/Society·Personal lifetime/settings/
  pi-compat/adapter-boundary 기존 회귀114/114 PASS·skip0.
- 실제 fullscreen Pi TUI를 두 PTY에서 Society·Personal adapter 경로로 실행했다.
  changelog 확인 버전을 `0.0.1`로 둔 초기화와 새 버전 표시 이벤트에서 자동 변경
  내역·업데이트 banner가 없음을 관측했다. 원래 확인 버전은 그대로였고 일반 경고,
  mail read·mail receive는 보였다.
- 양쪽에서 실제 `/changelog` 키 입력 뒤 SDK의 변경 내역이 표시되는 것을 확인했다.
  업데이트 서버 응답은 실제 네트워크 조회가 아니라 표시 이벤트 입력으로 검증했다.

이는 실제 SDK 화면·표시 정책의 검증이며 provider 추론·업데이트 설치 실행·전체 제품
회귀·새 packed install의 증거가 아니다. 별도 문구 고정 테스트는 추가하지 않았다.

## Worker 공유 기본값·Principal reject 설명

`packages/domain/src/role-prompts.ts`의 Worker communication 절에 메일의 공유 기억 목적과
commons/개별 메일 수신 범위를 모았다. 이전의 “relevant peers or commons” 선택 문구는
제거했다. 공유는 기본 습관이며 발송 절차·단계별 보고 의무를 추가하지 않는다.
`packages/extension/src/review-tools.ts`는 Principal의 `oma_review_respond` description
한 곳에만 reject가 해당 요청의 영구 종료이며 수정 요청이 아니라는 설명을 추가했다.
모델용 문구는 영어이고 실행 코드·schema·승인 절차·custom prompt는 바꾸지 않았다.

- `npm run build`: PASS.
- 기존 tool-surface/prompt-boundary 회귀: 17/17 PASS·skip0.
- 임시 smoke에서 실제 Pi SDK session·prompt composition·review tool 등록을 실행했다.
  provider 입력 경계에서 Worker의 새 공유 안내와 이전 수신 선택 문구 부재,
  Principal의 새 reject 설명, Worker 설명에는 해당 영구 종료 문구가 없는 것을 확인했다.
  외부 provider와 broker는 호출하지 않았으며 응답 stream은 deterministic fixture다.
  실제 모델의 발송 습관 변화나 새로운 승인 동작을 검증했다고 주장하지 않는다.
- 문구 고정용 영구 테스트나 임시 script 파일은 추가하지 않았다.

## Principal 자동 도착 메일의 컴팩트 표시

메일 도착 때 대화에 삽입되는 `oma-mail` custom message에만 공개 message renderer를
등록했다. `mail send`와 같은 dot·제목·rail을 사용하고 기본 접힘/기존 펼침 키를 따른다.
실제 tool call이나 성공 receipt를 합성하지 않는다. `oma_mail_read`, 모델 입력, 저장된
notice와 details, ACK 및 batch 완료 판정은 변경하지 않았다.

- 수정 전 호환성: build, compact/tool surface/Principal 경계/렌더 복사/delivery37개
  모두 PASS·skip0. 실제 Pi의 Worker core19/전체40, Principal core13/전체21 등록과
  제거 도구 부재를 확인했다. functional surface의 선택·교체·재개·anchored 편집도 PASS.
- 수정 후 build와 root 타입 검사 PASS. 관련 기존 회귀81/81 PASS·skip0 및
  functional surface PASS. 새 UI 동작 확인용 임시 검사는 제거했고 문구 고정 테스트는 추가하지 않았다.
- 실제 fullscreen Pi TUI를 PTY에서 실행해 production theme·presentation renderer와
  실제 `oma_mail_read`를 사용했다. 도착 블록은 `mail receive 2 messages`/
  `Received · 5 lines`로 접혔고 `Ctrl+O` 입력 뒤 원래 전달 안내가 rail 아래 펼쳐졌다.
  원래 `oma-mail` label과 custom-message 배경색은 없었으며 tool row는 유지됐다.
  session의 원본 notice 보존을 확인했고 `Ctrl+D`로 exit0 종료했다.

터미널 검증은 실제 SDK 화면과 production 표시 함수의 실행이다. assistant 응답은
deterministic stream이고 메일 도착 입력은 fixture다. 실제 provider 추론·broker 배달·
Resident 활성화·전체 제품 회귀나 새 packed install을 검증했다고 주장하지 않는다.

## Benchmark-essential Linux fixes and active Worker capacity

Scope is the six requested findings (4, 5, 9, 18, 23, 26), plus the user's
subsequent correction of `maxWorkers` from lifetime registrations to active
Workers. Other findings remain deferred. No macOS implementation was changed.

Implemented behavior:
- Review acceptance refuses stale authenticated submitter provenance after
  asynchronous preparation; replacement challenges obey deterministic tier floors.
- Scoped grep/find no longer depend on unrelated sibling traversal.
- Interrupted plain HTTP responses abort downstream without hanging or
  fabricating successful completion, and release their owned connections.
- The functional-surface owner regression exercises the installed SDK instead
  of the deleted RPC seam; valid zero-peer approval grammar remains accepted.
- Worker publication and reactivation enforce active capacity atomically.
  Historical registrations release slots after stop/retirement; provisioning
  races remain pending and recover after release. Unknown physical termination
  stays fenced. Review capacity subtracts active authors while excluding all
  historical authors from voting, and invalidates changed approval requirements.

| Executed verification | Observed result |
|---|---|
| `npm run build` | PASS; 25/27 workspaces recompiled, root typecheck/test emit and static installation checks passed. Static package validation did not start product entrypoints. |
| `npm run check:transactions` | PASS with the active-capacity admission implementation; physical observations remain outside SQLite transactions. |
| `npm run check:architecture:rules` | PASS; zero findings. This is not the entire architecture qualification lane. |
| Affected regression coverage | 265 current tests PASS across staged runs: 232 unchanged passing tests plus the final 33/33 rerun of both corrected test files. No skips. |
| Expanded regression run before test-only corrections | 267 tests: 264 PASS, 3 FAIL. Two new fixtures attempted the forbidden stopped-to-provisioning transition; those impossible cases were removed. An old assertion pinned the deleted `code_intel` group name; it was deleted without replacing it with another wording assertion. Actual runner input refusal/acceptance coverage remains. |
| Final corrected-file verification | Root typecheck and test emit PASS; `review-active-capacity.test.js` and `operations-config.test.js` PASS. No product source changed after the full build. |
| Standalone review scenarios | Fresh merge/challenge provenance races refuse and retry; HIGH replacements respect Principal delegation; zero-peer requests apply only after current Principal approval. |
| Standalone scoped-search scenario | Real registered grep/find with an unreadable sibling, ancestor ignores, explicit files, root controls, link refusal, abort and private-snapshot cleanup PASS. Executed as uid 1000. |
| Standalone HTTP scenario | Actual local TCP upstream and Unix downstream: truncated Content-Length and chunked responses close as incomplete; a subsequent healthy response returns its full body. Owned tunnel count returns to zero. |
| Standalone functional gate | Installed SDK production gate PASS: selection/replacement, persisted resume/reset, anchored tools and genuine removed-tool refusal; gate-owned workspace removed. |
| Standalone lifecycle scenario | Seven historical Worker registrations with cap two retain exactly two active Workers. Stop/new-name reuse, fresh full-cap refusal, start/publication race, pending replay, idempotent start and restart recovery PASS. |
| Standalone active-author review scenario | Cap two with one active author still requires an independent peer despite an inactive historical coauthor; the peer's actual vote applies main. Cap one with an active requester requires explicit zero-peer Principal approval before main changes. |
| Actual Config renderer | Production defaults and descriptors display `Initial workers 3`, `Active Worker capacity 6`, and `After restart`. This was renderer execution, not a full interactive session. |

Earlier search/proxy/functional verification fixtures also required corrections
to setup, owner-close observation and persisted SDK-result observation. The
passing results above follow those corrections, not the failing attempts.

An additional `review-closure.test.mjs` qualification check failed with stale
authored review digests for `apps/oma/src/broker/broker-composition.ts`,
`packages/broker/src/index.ts` and `packages/tool-files/src/index.ts`. Its review
ledger was not regenerated or approved, and that extra qualification was not
repeated after further source edits. No full-suite or release approval is claimed.

Lifecycle/review scenarios use real Store, Mail, Git, Lifecycle and Reconcile
owners with an explicitly controlled execution port. The SDK surface gate uses
a deterministic assistant stream. Native confined Worker launch, real provider
inference, benchmark execution, packed-install qualification and macOS runtime
verification were NOT_RUN. Missing bubblewrap was not bypassed.

Owned throwaway programs and their private state were removed after execution.
Shared runtime artifacts retain the commands, initial failures, corrected
results and smoke source; they are not a substitute for a committed review or
benchmark result.

## DR66 initial implementation — historical verification

The following evidence belongs to the initial DR66 implementation, which counted
registered Workers. The user's later correction changes the limit to active
Workers; current verification is recorded separately below. These historical
results do not certify the current source tree.

| 실제 실행 | 관측 결과와 한계 |
|---|---|
| 최종 `npm run build` | PASS. workspace와 전체 test caller 타입 검사·설치 자산 정적 검사 포함. 중간 실행은 declaration 파일 재생성 중 `ENOENT`로 실패했고, 파일이 다시 존재하는 것을 확인한 뒤 최종 전체 build가 통과했다 |
| 첫 관련 회귀 | 100개 중96 PASS/4 FAIL. 초기3명으로 늘어난 bootstrap fixture의 미완료 seed와 동일 값 저장 기대2건, open 시 0-peer 승인 메일을 거절하던 durable grammar2건을 발견·수정했다 |
| 최종 영향 범위 회귀 | 15개 파일93/93 PASS·skip0. Worker cap/fallback15개, config snapshot/validation/edit/apply-time, status wire, operation kind matrix, authority, Config source, 실제 SIGKILL/TTY owner, integration identity와 Mac command-policy parser 포함. Mac kernel 실행 증거는 아니다 |
| 별도 생성·설정 smoke | 실제 config writer/readback과 Config renderer에서 초기3·최대6·After restart 표시. cap3에서 새 operation 없이 `LIMIT_EXCEEDED`; 수정 뒤 기존 resolver는 `POLICY_CHANGED`; 새 resolver에서 cap4로 실제 Git workspace 생성 후 HEAD 일치·workerCount4 확인 |
| 별도 0-peer merge/challenge smoke | 실제 Store·review/mail·canonical Git 경로로 MEDIUM open → 현재 Principal 승인 → main 적용 → LOW challenge → Principal 승인 → 원래 tree 복구. Worker/Principal status를 실제 wire codec으로 decode했고 restart 뒤 approval id도 유지했다 |
| 발견한 Principal 가시성 회귀 | 최초 직접 실행에서 Worker는 `principal-pending`인데 Principal named status가 `CAPABILITY_DENIED`였다. open의 승인 메일도 가시성과 `principal.sent`에 포함하도록 수정했고 위 smoke·최종 회귀에서 확인했다 |

smoke의 unit 설치/기동 경계는 scripted fixture다. 신규 실제 Resident activation, 실제 모델 추론,
전체 regression/packed install/Darwin qualification을 이번 결과로 통과 처리하지 않는다.
Config는 실제 renderer 출력과 설정 저장을 확인했으며 제품의 대화형 전체 세션을 새로 실행한
증거는 아니다. 영구 regression은 0-peer/1-peer, 다중 작성자, 반대표·중지, stale 승인,
Principal 미위임, 동시 마지막 슬롯, replay·연결과 재시작을 다룬다.

## DR65 영어 prompt·tool 안내 재작성 — 이번 실행

Codex CLI의 고정 revision과 채택 범위는 [모델 도구 표면 명세 §6](../model-tool-surface-spec.md#6-prompt와-예시)에
기록했다. 기본 역할·생성 안내·자동 mail·전체 도구 metadata를 영어로 바꿨다.
사용자 custom prompt와 동봉 vendor 실행 바이트는 덮어쓰지 않았다.

| 실제 실행 | 관측 결과와 한계 |
|---|---|
| build·타입 검사 | `npm run build` PASS. 이후 merge의 optional 입력 복구는 `npm run build:extension`, 최종 test caller는 `tsc -p tsconfig.build.json` PASS |
| 실제 Pi 등록·prompt 조합 | Worker core19/전체40, Principal core13/전체21 유지. 양 역할의 `before_agent_start` 이후 구성과 활성 guidance를 관측. Principal의 편집 guidance, 비노출 hashline 도구 안내 제거 확인 |
| 전체 입력 계약·provider serializer | 재작성 전후 모든 도구의 required·type·enum·bounds·nested 구조 일치. 비교에서 발견한 `oma_merge_open` candidate/base 필수화 회귀를 고쳤다. Responses는 양 역할61개, Anthropic은 Worker40개 schema를 전송 전 관측; 네트워크·추론 없음 |
| `node scripts/functional-surface.mjs` | 실제 Pi session의 core19→선택21→교체20→resume20→reset19, anchored replace/replace_within/insert, 제거 도구 거절 PASS. deterministic assistant stream |
| 실제 Pi shell smoke | 설정한 shell executable과 prefix가 실제 실행 결과에 반영됨. 명시적 background launch 후 독립 명령을 수행하고 최종 로그 `completed`·exit7을 회수. host의 실제 Pi tool pipeline이며 Resident activation 수명 시험은 아님 |
| 관련 선택 회귀 | prompt boundary·delivery·tool runtime·review documents·contained files/search·confinement·tool surface·Principal·merge/challenge·vendor bundle·mail bounds135개 중 최초132 PASS/3 FAIL. 폐기 CLI PATH/전체 exclude flag 기대와 새 shell test의 불완전 context를 수정. 후속 confinement/Principal27개 및 tool-runtime4개 모두 PASS·skip0. 별도 run을 하나의135/135 실행으로 합산하지 않음 |
| 실제 Worker typed-tool 시나리오 | default HEAD/base LOW merge·자동 broadcast, MEDIUM peer vote, exact diff paging, HIGH cancel, self-review 거절, HIGH challenge/Principal, same-key replay, Worker-only thread8/8 PASS·skip0. host prerequisite 부재에서는 publication8개가 INTERNAL_ERROR로 실패했고, 임시 bubblewrap0.12.0의 private `/dev`·`/usr/bin` namespace 환경에서 통과. host 설치나 제품 sandbox 우회 없음 |
| 구조 규칙 회귀 | surface-rule22/22 PASS·skip0. `check:architecture:rules` finding0. 고정 bash registration adapter 이외 임의 handler dispatch는 계속 거절 |

실제 모델이 이 문구를 받아 더 효율적으로 협업하는지는 **NOT_RUN**이다. 기존에 확인한 OMA 인증·
정확한 Sol model/effort 부재는 그대로이며 scripted 성공을 모델 행동 비교로 대신하지 않는다.
이번 검증은 현재 source 전체 회귀·새 packed install·Darwin qualification을 주장하지 않는다.

## DR64 모델 도구 표면 — 이번 실행

기준 HEAD `74eadb6fd34c258393a231930fcdf0c85e601af6`, 작업트리
`/home/dev/oma-v2-model-surface-cleanup`. 모델용 CLI·libexec·구 tool/group을 제거하고
typed client·core/optional·reviewer/생성 관측·prompt/START·caller·배포 계약을 함께 전환했다.
Human용 CLI·broker authority·request freeze/replay·receipt·정족수·CAS는 유지한다.
이 절은 [모델 표면 명세](../model-tool-surface-spec.md)의 실행 범위이며 Darwin 지원 증거가 아니다.

| 실제 실행 | 관측 결과와 한계 |
|---|---|
| `npm run build` | 전체 build와 설치 자산 정적 검사 PASS, workspace27개 closure. entrypoint 실행은 별도 |
| 실제 Pi 등록·provider payload probe | Worker core19/전체40, Principal core13/전체21. 설치된 Responses/Anthropic serializer에서 전체 schema 전달을 확인. OMA·toolset의 Responses strict 변환, 필수 필드·enum·nested replacement 보존. 일부 vendor 도구 non-strict와 Anthropic 최상위 closure 생략은 local guard와 구분. 네트워크·실제 inference 미실행 |
| `node scripts/functional-surface.mjs` | 실제 Pi session에서 core19→선택21→교체20→resume20→reset19; hashline replace/replace_within/insert 및 제거된 도구 거절 PASS. deterministic assistant stream이며 실제 모델 선택·provider transport·sandbox 증거 아님 |
| typed client·review·surface 확대 회귀 | private native 환경에서 401개 중398 PASS·3 FAIL·skip0. 옛 status 응답 fixture·approval 안내 문구·mail context-kind 거절 기대를 수정. 후속8개 파일66/66 PASS·skip0으로 세 실패와 status/codec/delivery 경계를 확인. 두 실행을 새 전체401/401 결과로 합산하지 않음 |
| 실제 설치물 및 composition/document 경계 | `deployment-artifact`와 client/broker composition·review document 검사12/12 PASS·skip0. GOAL 수정 후 최종 설치물의 source-tree 없는 entry/engine/자산·typed Client import·모델 CLI 부재도 별도1/1 PASS |
| `npm run check:package-isolation` | GOAL 원문 보존 수정 전 입력에서27/27 packed install·public import·authored declaration PASS, 지정 installed-runtime smoke17개 PASS. 외부 SDK declaration 진단44개는 관련 workspace에 반복 보고되며 자체 declaration 오류는0. 후속 GOAL 수정의 실제 실행은 별도 |
| architecture/문서/소유권 검사 | 최종 production source에서 `npm run check:architecture` 전체 PASS: workspace·legacy·source inventory/digest·architecture rules/gate·transaction·durable boundary·document·spec inventory finding0. 별도 mutation locality PASS·surface/architecture-rule 회귀59/59 PASS. 후속 검증 결과 문서 binding은 구조 기록이지 runtime 재승인이 아님 |
| workspace 계약 suite | 최초467개 중464 PASS·3 FAIL·skip0. status pagination fixture에 creation 관측을 추가하고, LSP abort의 단어 고정 대신 deadline 내 거절을 확인하도록 수정. 실패한 두 workspace의 후속79/79 PASS·skip0 |
| confined scenario 확대 실행 | 600초 deadline까지99 PASS·11 FAIL, 전체 run은 TIMEOUT. 생성/초기 brief·협업 reply·candidate/LOW merge·HIGH 승인/challenge·same-key·mail delivery 실제 경로가 실행됨. 옛 optional 노출/GOAL 호출·wait startup 예산·응답 fixture를 수정했고, 후속7/7 PASS·skip0으로 실제 shell/typed Client·설치 extension 선택·양 역할 full/reset·quota 없는 생성 경계를 확인 |
| GOAL 수정 후 실제 runtime | full build PASS 뒤7개 파일62개 중59 PASS·3 FAIL·skip0. CRLF/BOM 원문·oversize 거절·restart/stale CAS, 실제 Principal core에서 HIGH/challenge9개, Worker 협업/receipt·client 회귀가 통과. 나머지는 delayed-wait fixture가 runner budget뿐 아니라 broker의 독립30초 deadline도 넘긴 경우 |
| delayed-wait 최종 확인 | runner control-idle20초 < 실제 관측21초 < broker deadline30초로 서로 다른 경계를 분리. 같은 continue/wait/unobserved3개 모두 PASS·skip0. tool 결과가 durable하게 기록된 뒤 continue·yield·unknown을 구분하고 prepared batch/미확정 receipt 의미를 유지 |
| 실제 Sol medium A/B/C | **BLOCKED/NOT_RUN**. 확인한 OMA engine auth provider 목록은 비어 있고 default provider/model/effort는 미설정, 배포 profile은 `pi/current`. 정확한 Sol provider/model/medium 및 사용할 인증 없이 다른 모델로 대체하지 않음 |

최초 선택292개는279 PASS·13 FAIL이었다. enum/receipt/diagnostic의 옛 기대와 native upload
실패를 구분했다. host `/usr/bin/bwrap` 부재와 sudo 암호 요구를 확인한 뒤 Debian bubblewrap
0.12.0 패키지를 임시 디렉터리에 풀어, 비특권 outer namespace의 `/usr/bin` overlay와 private
`/dev`에서 실제 제품 sandbox를 실행했다. UID1000을 유지했고 host 설치·제품 sandbox 우회·
mock 대체는 없었다. 이후 SHA-1/SHA-256 incremental/self-contained upload가 통과했다.

GOAL 원문 보존 반례는 실제 Principal engine→typed tool→broker 경로에서 CRLF가 LF로 바뀌어
FAIL했다. 일반 mail의 정규화가 context publication에 섞이지 않도록 Client.publishGoal의
frame-byte bound는 유지하고 원문을 기존 context 준비 owner에 전달했다. 동일 반례의 수정 후
PASS는 위62개 실행에 포함하며 최초 실패를 덮지 않는다.

기존 authored review를 재승인하지 않는다. stale/relocated review는 원문을 보존하고 현재
derived ledger에서 NOT_REVIEWED로 무효화하며, 구조 digest 재생성을 runtime PASS로 표시하지 않는다.
이번에 발견한 실패는 위 후속 선택 실행으로 확인했다. 현재 source의 전체 회귀 suite,
전체 confined run의 정상 완주와 실제 Sol 비교까지 통과했다고 합산하지 않는다.

## DR61 명세 개정 — 구현 재개 (2026-10-28)

[native spec](../macos-native-spec.md)를 목표·불변식·확정 결정·미결정 후보·판정 절차·실행 순서로
다시 구성했다. NATIVE-024/025가 후보 검증과 파일 capability/좁은 native leaf 경계를 명시한다.
개정 전 spec·인계 원문은 archive에 보존했다. 이 단계에서는 production source를 바꾸거나
Mac backend를 채택하지 않았다. 문서 개정은 G-PROCESS/G-FILES/G-AUTH의 통과 근거가 아니다.

앞선 Linux Runner·descriptor 수리 및 회수한 Mac15 원시 artifact는
[전환 기록](native-transition.md)과 [현재 인계](../HANDOFF.md)를 따른다.
실제 Mac native 지원·현재 source 전체 회귀·독립 설치·최종 복잡도 검토는 여전히 미완료다.

## DR49 native 전환 — 진행 중 (2026-10-25)

작업 브랜치는 `work/macos-native-20261025`이며 master 병합·배포는 하지 않았다.
현재 G-PROCESS/G-FILES/G-AUTH는 OPEN이고 Mac 제품 진입은 효과 전에 거절한다.
이 거절 시험이나 부분 primitive 성공을 native Society 지원으로 표시하지 않는다.

2026-10-27 재개: 필수 문서·machine map과 자체 작성 production523개를 전체 읽은 뒤 DR59의
잔존 VM 정책/API를 제거했다. 수정 후 workspace26개와 root strict typecheck가 통과했다.
Mac 인증의 새 Mach audit 수신·단일 process event·public Security audit-token 대조 leaf 및
OS identity adapter도26개 workspace/root typecheck를 통과했다. 실제 Darwin 실행은 **NOT_RUN**이다.
첫 정적 검사에서 제거한 package collector를 가리키던 durable map 한 건을 찾아 제거했고,
durable map·문서·규범 fingerprint 검사는 통과했다. 마지막 source의 전체 정적 재검사는 별도다.
과거 authored review는 보존하고 변경 bytes의 review ledger는 NOT_REVIEWED로 무효화했다.
당시에는 테스트를 제외한 구현 견적 질문을 구현 우선 순서로 해석해 runtime·packed install·CI를
보류했다. 이는 최종 목표의 실제 검증 요구를 없애지 않으며, 이후 실행은 입력별 증거로 구분한다.
이 checkpoint 당시 primitive·identity adapter는 production broker transport에 미연결이었다.
후속 source 조립 상태는 아래 기록을 따르며 세 gate는 계속 OPEN이다.

후속으로 Broker의 Linux native credential 타입·listener 생성·endpoint 길이 검사를 OS port로
분리했다. common reference/authority owner를 유지하고 BSM by-value accessor로 opaque token을
해석한다. bind 뒤 preparation 실패·불명 close 수명과 Mach body 정렬/oversized queue도 source에서
수정했다. 26개 workspace와 root strict 검사는 통과했으며, 이 후속 입력의 전체 구조 검사는
`/tmp/oma-native-resume-20261026/transport-static-*`의 입력 전후 identity와 단계별 원시 로그로
구분한다. 새 listener 회귀와 변경 Linux sender/새 Mac FFI 실행은 **NOT_RUN**이다.

후속 Mach connector는 App Client/Broker의 OS 선택에 source로 연결했다. common PacketStream,
인증 EOF, byte length/padding, dial readiness generation과 native port return 상태를 구현했다.
현재 native consumer interface golden만 의도한 세 interface 추가/두 port 변경으로 갱신했으며
public/durable DTO·과거 golden은 그대로다. 타입 검사 중 새 unit fixture의 literal 타입 오류를
수정했고 후속 전체 workspace/root 검사는 통과했다. 새 shared-flow와 실제 Darwin 실행 결과는
아직 이 기록에서 PASS로 주장하지 않는다. 세 gate와 product profile 차단은 유지한다.

| 실제 입력·실행 | 결과와 범위 |
|---|---|
| Mac check·quarantine staging/recipe·scope 소유자 연결 | App은 physical candidate workspace/tmp·quarantine bundle copy/phase repo/tmp를 사용하며 common CandidateStaging.run이 lease·전체 scope 확인·실패 보존·재시도/회수를 소유. accepted 원본 FD/cursor/bytes를 유지한다. setup은 기존 CommandSpec.input→framed stdin→sandbox_init→/dev/null, Worker FD3/RPC는 유지. selected Xcode/CLT 관측도 필수 async execute port로 같은 scope/authority/lease를 사용한다. check/Worker는 자기 writable roots의 실행을 허용하고, check의 compiler 경로는 selected Developer usr/bin·XcodeDefault toolchain bin으로 좁힌다. framework 전체 exec·broad /Applications·unowned spawn fallback은 없다. 실제 Linux ff8ffcd1…(15643개) 및 후속 0fe7fbab…(15643개) 고정 입력 전후·보호4개 동일에서 각각 관련 **177/177·contract mutation7/7 PASS**. 추가 digest 소비자 a5018208…(15641개)는 **133/133 PASS**. 각 전체 digest/command/종료는 staging-final-runtime·owned-tools-final-runtime·digest-consumers-green/summary.json이 소유하며 서로 다른 입력을 합치지 않는다. C18 old mount 문구 단언·raw temporary realpath 규칙 위반·collection 중단/재시도 registry 누락을 수리했고, 실제 duplicate journal owner를 거절한 첫 fixture도 부모 초기화만 하도록 수리했다. 공통 staging의 live scope/free flock 보존·경계 소유자 SIGKILL 뒤 재시작·mode000/external symlink 원본 보존3개를 실제 Linux에서 검증·등록했다. 후속 writable exec 권한의 최종 입력·관련/구조 결과는 이후 admission-runtime/summary.json·admission-final-summary.json이 구분한다. Mac은 script/C compile/output·channel identity·stdin framing/EOF/keep-FD까지 **30×3=90회 준비·모두 NOT_RUN**. paid CI 실행 없음. generic mode000/exact pin/reopen/repair 우회·새 fence 예외·durable/public/accepted 데이터 변경 없음. 세 gate OPEN·native guard/Mac scope 거절 유지. Worker full bootstrap/Git toolchain·§11 형식 version과 양 OS qualification은 미완료. raw native-2026-10-27-setup-recipes/가 source별 실패·수리와 build/type/정적 상태를 보존한다.  최종 ownership 보강은 새 container admission 뒤 내부 lease/tree를 만들며 기존 root에 표시를 남기거나 회수하지 않는다. 실제 delete/marker 두 negative control은 같은 probe SHA에서 실패하고 보강된 owner는 통과했다(ownership-controls.json). 실제 staging4회귀 PASS; disposable nonce만 고정하고 kernel/namespace/PID 사실은 대체하지 않았다. source별 최종 기록은 admission-runtime/summary.json·admission-final-summary.json을 따른다. |
| Git 명시 view·setup FD 전달 기반 | shared candidate/quarantine의 고정 Linux 경로를 제거하고 명시 closed view의 Git/project/workspace/root/bundle/tmp를 사용. Linux producer도 같은 private payload를 만들며 legacy/open/invalid/overlap/UTF-8 손실을 거절한다. 실제 scoped thin bundle의 canonical alias(Unicode/quote/LF) prerequisite 실패를7/8로 재현하고 Git C-quoted UTF-8 octal alternates로 같은 test SHA의8/8을 확인. accepted FD/cursor/refs와 두 단계 scope/권한 순서는 유지. Seatbelt는 기본 extra-FD 전체 close, explicit setup slot만 허용하며 production C header의 real POSIX 동작을 Linux에서 검증: FD64 open→soft limit16 뒤6/8만 유지·CLOEXEC 해제·나머지 close, 음성 대조는 누출 검출·잘못된/없는 FD는125 거절. actual Darwin helper/SDK 실행은 NOT_RUN이고 kept-FD kernel case 추가로27×3=81회 required·모두 미실행. input `1c17ce3c51f070220fd9c9fc3702492cdf76cca0686b749e439e328c9978f122`(15636개) 전후와 보호4개 SHA 동일에서 실제 Linux scope/Worker/Git 실행·phase5·정책/오류/FD/기록을 포함한 관련 **158/158**, contract mutation **7/7 PASS**·fail/cancel/skip/todo0. Linux full build·root strict types·module PASS. 초기 stale graph finding은 generator와 병행한 중간 입력으로 별도 보존하고 최종 전체 구조는 후속 문서 입력에서 확인한다. public/durable/golden/과거 review/accepted bytes는 수정하지 않았고 scope/fence 예외도 추가하지 않음. raw는 native-2026-10-27-git-views/의 view-red/green.log·test SHA·fixed/summary.json·각 build/type/source 기록이 소유. Mac 물리 staging/조립과 전체 scope/file/auth·형식 경계는 미완료 |
| 공통 Worker 정책·Mac recipe 조립 | protocol의 공통 actor/root/lease/설치 grammar와 domain directory access 표를 Linux bind·Mac Seatbelt·PathView가 함께 사용. 모델용 oma는 명시한 OMA_NODE/OMA_CLI를 literal argv로 실행하며 env 기본값도 같은 view에서 계산. Mac recipe는 자기 workspace/home/session write·나머지 declared roots read·hidden deny·exact Mach/Unix IPC·명시 env만 사용하며 App residentPlan/spawn에 연결했으나 기존 native spawn guard는 유지. 읽기 전용 설치의 정확한 client preload만 승인하고 native loader/NODE_PATH/ambient secret은 거절. input `1ee75abc2ea88ed73a7fc3dec5d4c8d77a36df12df6aea05ea684a5012c34e3c`(15631개) 전후와 보호4개 SHA 동일에서 관련 **111/111**, contract mutation **7/7 PASS**·모두 fail/cancel/skip/todo0. 실제 UID1000/CapEff0·pinned bwrap0.12/private /dev와 /usr/bin overlay의 Worker 환경·격리·scope/setsid 후손 종료를 포함하며 Mac 실행 증거가 아님. full build·root strict types·workspace/module·중간 architecture PASS. 최종 결과 문서 입력의 구조 검사는 별도. 초기 타입 widening compile 실패·실제 Node ESM 백슬래시 entry 거절·semantic owner 미분류 finding을 보존하고 전용 경로 거절/정확한 K1 owner를 추가했으며 새로운 fence 예외는 없음. Mac CI에는 trusted preload의 host-read 거절을 추가해26×3=78회 required·모두 NOT_RUN. raw는 native-2026-10-27-worker-recipe/의 fixed/summary.json·raw와 source별 build/type/구조 로그가 소유. historical review/public·durable DTO·accepted bytes는 보존했고 check/quarantine Mac 조립·G-PROCESS/G-FILES/G-AUTH와 형식 경계는 미완료 |
| 실제 Darwin CI 시험 준비 후속 | macos-26/15 각각25개 case×3회=75회 required manifest. 기존 kernel/Mach/Seatbelt 대용량 관측에 framing8종·argv/env/stdin·실제 inherited canary FD 양성/음성·허용/외부 Unix socket을 독립 추가. missing/duplicate/program/observation 귀속·비정상 종료/signal·NOT_RUN·정리/기록 실패를 성공으로 세지 않음. 실제 build output bytes/mode/증분 상태/workspace set과 source identity를 전후 대조하고 개별 raw·SDK/OS/Node/git/package versions·compiled probe SHA를 보존. Linux에서 실제 Darwin driver 거절/75개 NOT_RUN 기록, 실제 C FD oracle의 상속/미상속 대조와 filesystem mutation을 포함한 관련 **109/109 PASS**·fail/cancel/skip/todo0; input `0b599442ae6a60d6f65f50e3fc924d4885d9b6647b18728471c6b613573e5aae`(15625개). full build PASS. 초기 refresh는 역사적 stale review를 거절했고 원문은 보존한 채 명시 invalidate-stale로 현재 derived ledger만 생성했다. 해당 source의 전체 구조 검사는 후속으로 구분. 실제 Darwin75회는 NOT_RUN·세 gate OPEN이며 관측이 완료되어도 driver는 제품 qualification BLOCKED/exit1을 유지. 사용자 설명상 Mac CI 할당량이 소진돼 복구를 나중으로 미뤘으며, push는 Linux만·수동 run_darwin=true일 때만 Mac을 선택하고 지금 dispatch하지 않음. 직전 a1cc3f9c CI7개 job은 steps/logs null·artifact 없음. raw는 native-2026-10-27-ci-readiness/가 소유 |
| 공통 PathView·논리 inbox 후속 | 같은 root/endpoint 표의 mounted/host layout으로 Pi argv/env·relay·entry·session 역변환을 연결. caller dirs 변경 반례를 snapshot으로 거절하고 exact /inbox.md를 검증된 hashline read의 public prepareArguments에 전달해 anchors·offset/limit을 유지. public/durable/receipt와 vendor bytes는 바꾸지 않고 native golden에 transient interface2개만 추가(기존 fingerprint 전부 동일). 정책/실제 일반 read **29/29 PASS**·skip/cancel/todo0·strict types PASS이며 실제 Mac kernel proof가 아님. raw native-2026-10-27-path-view와 source별 후속 실행 기록을 따름. 입력 `e55935e4e63868bba3922a30ad68ea3f16eb59019327a7b9ab20049d8026557c`(15619개) 전후 및 보호4개 SHA 동일에서 실제 UID1000/CapEff0·pinned bwrap0.12/private /dev의 관련 Linux **70/70**, 별도 contract mutation **7/7 PASS**·모두 fail/cancel/skip/todo0. full build와 전체 구조 검사도 통과. 실제 kernel scope8개를 포함하며 전체 Linux 회귀/Mac 지원 결과는 아님. 초기 assertion 문구와 TS fixture 직접 실행 오류, extension 직접 execute 위임을 거절한 구조 finding을 raw에 보존하고 최종은 Pi public prepareArguments를 사용. PathView 내부와 spawn→session return의 변동2개 반례도 실패시킨 뒤 고정 문자열 view로 수리했으며 grant/peer/scope는 cache하지 않음. 최종 결과 문서 입력과 purpose별 조립·actual Mac 검증은 별도 |
| 후속 Mac flag·공통 ancestry 수리 | XNU가 거절하는 NOFOLLOW_ANY+NOFOLLOW 조합을 native leaf에서 제거하되 ANY/BENEATH/CLOEXEC를 유지. 정상 open·중간/최종 symlink 거절의 실제 kernel 회귀를 추가하고 platform lane의 필수 이름으로 결박함. 공통 ancestry의 변동 관측4개 반례는 수정 전5/9 PASS·4 FAIL, 같은 시험 파일 SHA `6d7b7d45...`로 수정 뒤 관련 **51/51 PASS**·fail/cancel/skip/todo0. 실제 Linux file/process 관측과 supplied-reader TS 정책 증거이며 Darwin raw-EINVAL branch/세 gate는 NOT_RUN·OPEN. 첫 full build는 분리 작업트리의 외부 third-party symlink를 설치 경계 검사에서 거절했으며 raw를 보존했다. 기존 의존성 view를 보존하고 locked npm ci를 실제 독립 설치한 뒤 full build PASS. `/home/dev/oma-audit-artifacts/native-2026-10-27-nofollow/`가 원문·실패·수정 source/test SHA·build/선택 결과를 소유하며 전체 후속 회귀는 별도 |
| 후속 SnapshotReader·Darwin metadata·Seatbelt 구현 | SnapshotReader의 O_SYMLINK+O_NOFOLLOW 충돌을 제거하고 전체 parent를 openBeneath로 해석. statAt은 Darwin64 fstatat/AT_SYMLINK_NOFOLLOW·numeric/BigInt/ns와 최초 실제 Node layout 대조, 실제 SDK scalar/offset assert를 구현. Seatbelt는 TS deny-default renderer·환경 검사·정확한 IPC 허용·private pipe와 최소 public sandbox_init/execve C launcher를 구현하고 Darwin workspace build와 실제 driver의6개 추가 case에 연결했다. 실제 Mac 총42개 시도는 NOT_RUN이며 목적별 PathView·scope·pin/exact reopen/실행 결박·인증 qualification과 제품 guard는 별도다. input `1b53992cf75eaa4cd40394f032babb8c729dd816f23a41bc6989b59a8b7c0669`(15617개) 전후 동일에서 full build·전체 architecture/transaction/durable/document/spec PASS와 관련 **95/95 PASS**·fail/cancel/skip/todo0. root types도 후속 구조 입력에서 확인한다. 새 generated helper의 엄격한 asset owner와 source 존재를 검사하며 처음 asset/path/무fence spawn 거절도 보존. platform은 직접 spawn하지 않고 framed recipe를 반환해 기존 process owner를 사용하며 fence exemption을 추가하지 않았다. nofollow audit root의 `recipe-final-{build,architecture,smoke}.log`·`recipe-final-summary.json`이 원본을 소유. 이후 결과 문서 입력과 actual Darwin qualification은 별도이며 이전51/51을 새 source 증거로 재사용하지 않는다 |
| `29938a42` 최신 source 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정 installed-runtime smoke **16/16 PASS**·자체 declaration 오류0. 외부 SDK declaration 진단44개는 별도 분류하며 workspace별 반복을 합산한 새 오류 수로 표시하지 않음. exit0·263.254초·input `ae96e9f67c48f58c95020eaa7beb989ef467baaed258f4e43b24bb8770f84ba9`(15613개) 및 보호 README/architecture/과거 review/golden SHA 전후 동일. 현재 사용자 README가 포함된 입력이며 clean commit의 구조 binding과 구분. `/home/dev/oma-audit-artifacts/native-2026-10-27-qualification/packed-20261026T210501Z/`가 실제 명령·source HEAD·원시 출력·종료·workspace별 합계를 소유. 이후 결과 문서 입력과 실제 Darwin qualification은 별도 |
| `29938a42` 실제 CI와 완료 대조 | Native40400373660·Architecture40400373613의7개 job 모두 terminal failure·steps/logs null·artifact 없음. check-run output의 title/summary/text도 null이고 annotation 본문은 연결 도구가 제공하지 않아 원인은 미확정. 실제 Darwin36개 case는 NOT_RUN. P0–P7와 §13.2의7개 최종 조건을 다시 대조했으며 Darwin scope·pin/exact reopen·실행 대상 결박과 실제 인증/격리/수명 qualification이 미완료다. Linux/설치 통과를 전체 완료로 승격하지 않는다. native spec §14.14와 qualification root의 `p0-p7-audit-29938a42.json`, async audit root의 `ci-29938a42.json`·`ci-29938a42-check-runs-20261027.json`이 범위를 소유 |
| `bd2049c8` 수리 후 전체 Linux 회귀 | **3787/3787 PASS**(serial13/13, parallel3774/3774), fail/cancel/skip/todo0·exit0·973.149초. 실제 UID1000·CapEff0·Node26·pinned bwrap0.12의 private /dev와 /usr/bin overlay에서457개 file·parallel concurrency4·native execution 필수6개를 포함했다. input `9241f47e6aae491e07541aafba2995bf016a8a5b6a5256f1addfef83b2cdd8b9`(15612개)와 보호 README/architecture/과거 review/golden SHA가 전후 동일하며 관측 중 수동 개입은 없었다. 이는 이후 P7 문서-closure 변경 전의 실제 Linux 결과이며 actual Mac/CI 지원 증거가 아님. async audit root의 `full-linux-dev-20261026T203916Z/`가 명령·profile·상태·원시 로그·phase별 실제 합계를 소유 |
| `bd2049c8` 실제 CI | Native40397569660·Architecture40397569605의7개 job 모두 terminal failure·steps/logs null·artifact 없음. 실제36개 Darwin case는 NOT_RUN이고 원인은 미확정이다. async audit root의 `ci-bd2049c8.json`·`ci-bd2049c8-artifacts.json`이 원본을 소유하며 같은 입력의 무의미한 재실행으로 덮지 않음 |
| P7 후속 정적/문서 검사 | 분리 작업트리의 input `950cf5e29804acfc02dc7ef66f7bdd4fcf3fb425f520f2bbc01ed27597de9f06`(15613개) 전후 동일에서 전체 architecture/transaction/durable/document/spec PASS·문서/입력/workflow **32/32 PASS**·fail/cancel/skip/todo0. 첫 architecture 실행은 공유 node_modules 링크가 @oma를 원래 작업트리 밖으로 해석해51개 finding으로 실패했으며 raw를 보존했다.26개 workspace를 실제 분리 작업트리로 연결하고 같은 compiled output을 복사한 뒤 같은 입력의 architecture를 다시 통과했다. gate 규칙은 바꾸지 않았고 production source 변경도 없다. raw `document-closure-static-*`, `document-closure-architecture-*`, `closure-worktree-dependencies.json` |
| P7 문서 입력 누락 수리 | 문서 gate가 실제 읽는 루트 README와 목록 밖 신규 Markdown이 기존 digest에 없었다. 별도 fixture에서 README의 깨진 링크/새 문서의 배치 오류가 결과를 바꿔도 identity가 같았고, 새 반례2개가 수정 전 모두 FAIL했다. README를 필수 입력으로 추가하고 문서 gate의 discovery owner가 발견하는 현재 Markdown도 같은 source/symlink 검사로 결박한다. 반례 본문은 전후 동일하며, 분리 작업트리의 input `9774a54ce1ebd3feab7fed66656dcdb70865b3a1d294966b83999ca107b361c4`(15613개) 전후 동일·문서/입력 목록 **17/17 PASS**·fail/cancel/skip/todo0. 이전15612개 결과의 누락은 보호 README의 별도 SHA 증거로만 한정하며 완전한 입력 closure였다고 승격하지 않음. raw `document-closure-{red,green}-*`와 `readme-closure-red.json`은 async audit root가 소유. commit의 README와 최초 사용자 변경 README는 서로 다른 실제 입력이며, 전자를 쓰는 CI binding과 후자의 로컬 재생성 binding을 섞지 않음 |
| `c2745daa` 전체 Linux 회귀의 실패 보존 | 전체 **3772/3784 PASS·12 FAIL**(serial13/13, parallel3759/3771), fail12·cancel/skip/todo0·exit1. input `ee6bdd0688e7a7a33d81bb9d8e270adcb657a181927eebe93316e806c46459ac`(15612개)와 보호 파일 SHA는 전후 동일. 마지막 peer-pid 시험의 uncaught `this.pinPeer is not a function` 뒤 정리가 열린 socket을 기다려, 나머지 file 완료를 확인하고 해당 소유 test PID만 SIGTERM했다. 원래 오류와 개입을 `peer-pid-cleanup-intervention.json`에 보존하며 정상 완료/PASS로 계산하지 않음. 첫 outer bwrap의 /dev/null EACCES는 시험 시작 전 SETUP_FAILED/NOT_RUN으로 별도 보존. private /dev와 /usr/bin overlay 수정 후 실제 UID1000·CapEff0·bwrap0.12/Node26에서 실행. raw 소유자는 async audit root의 `full-linux-dev-20261026T193211Z/` |
| 위12건의 수정 후 선택 회귀 | UUID/실제 pin·endpoint 주입 fixture를 연결하고 find 완료 경로가 실제 `fdfind`도 사용하도록 수정. 원래 기대값을 유지하고 **26/26 +55/55 PASS**, input `970ceccf70ba1d2eeaa79d0574d0b69db8be7f260032b26f4db9b0b83e3576a7` 전후 동일·skip/cancel/todo0. source HEAD 전의 실제 private fdfind-only probe는 ENOENT, 수정 후1100/1100 경로 반환. 이후 find0/grep fractional-limit 반례2개를 추가해 수정 전29/31 PASS·2 FAIL, 수정 뒤 **31/31 PASS**·input `652fc93dd8586a1a9d67fa0db33164394c70cb6efe0c33e12f27fcc64559644c` 전후 동일·skip/cancel/todo0. 이는 서로 다른 선택 입력이며 전체 후속 PASS가 아님. 원시 로그/실패/SDK source SHA/probe는 async audit root의 `full-repair-focused-*`, `fd-alias-probe-*`, `search-limits-{red,green}-*` |
| `c2745daa` 비동기 audit 후속 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정된 installed-runtime smoke PASS. exit0·279.368초·input `f353d0157c995f17ace4ff1108308989df94fc3709c76efa73dae52ccededef0`(15612개) 전후 동일. 외부 SDK declaration 진단44개는 별도 분류. async audit root의 `packed-20261026T191736Z/`가 source HEAD·실제 명령·로그·종료·identity 소유. native callback/CF 실제 Darwin 실행 증거는 아님 |
| `c2745daa` 새 CI | 작업 브랜치 push 성공. Native40385385778·Architecture40385385695의7개 job 모두 스텝 없이 failure. 마지막 queued Mac15 job도 같은 handle로 재조회해 terminal을 확인했으며 steps/artifact 없음. 실제 Darwin36개 C/Node case는 **NOT_RUN**. annotation 본문은 connector 지원 범위 밖이며 근본 원인은 미확정이다. async audit root의 `ci-c2745daa.json`에 초기/최종 원본 응답을 보존함 |
| 비동기 audit/stream 반환 source 연결 후 | 고정 input `f6eaeca119f2e2df41c40fcc91122b1b14862cb1e8bd94e7e8d7d0269851b148`(15612개) 전후 동일. build·26 workspace/root strict·전체 architecture/transaction/durable/document/spec 검사 PASS. 관련 shared-flow/lifetime **52/52**, generation **9/9**, native consumer-port mutation **7/7 PASS**·fail/cancel/skip/todo0. 새 비동기 PacketStream4개 회귀는 수정 전 모두 FAIL·기존4개 PASS, 수정 뒤8/8. 원시 실패·수리 로그/상태는 `/home/dev/oma-audit-artifacts/native-2026-10-27-async-audit/` 소유. actual Darwin Security/Mach 실행과 WP23·expected Broker identity·세 gate proof가 아님. 이후 결과 문서는 별도 입력 |
| `7ebb7268` 현재 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정된 installed-runtime smoke PASS. exit0·271.606초·input `2e277fbabcb6bf967ce59d99ba0a42184783ec4c337f24625e67589a1625454b`(15612개) 전후 동일. 외부 SDK declaration 진단44개는 원시 로그에 별도 분류하며 자체 오류로 숨기지 않음. 새 audit root의 `packed-install-20261026T184226Z/`가 실제 명령·로그·종료·identity 소유자이며 실제 Darwin qualification이 아님 |
| `7ebb7268` 새 CI 시작 실패 | 작업 브랜치 push 성공. Native40380089004·Architecture40380089190의7개 job 모두4–5초 뒤 스텝 없이 failure. job steps/실행 로그/artifact 없음. check annotation1/2건은 있으나 본문 URL이 connector allowlist400으로 거절됨. 근본 원인 미확정이며 SDK·코드 실패로 추정하지 않음. 새 Node adapter3개 case와 C probe의 이 입력 실행은 **NOT_RUN**. 새 audit root의 `ci-7ebb7268.json`이 원본 응답을 보존함 |
| Mach connector·실제 Darwin Node probe 연결 후 정적/공통 검사 | build·26 workspace/root strict typecheck·전체 architecture/transaction/durable/document/spec 검사 PASS. CI 공통 목록15개 파일 **81/81**, channel generation **9/9 PASS**·fail/skip/cancel/todo0. 각 input `7736cda4f8f874ac9b48ca6b0c8cc1e54c82b0feb359f895e035d758961eb441`(15612개) 전후 동일. 원시 명령/로그/종료 상태는 새 audit root의 `mach-ci-checks-20261026T183534Z/`. 이후 Node fixture의 관측/cleanup deadline과 job ceiling 및 결과 문서는 별도 입력이며 재결박으로 이 PASS를 갱신하지 않음. 실제 Mac Node 세 경우는 CI 실행 전 NOT_RUN이며 세 gate는 OPEN |
| Mach source 연결 뒤 shared/Linux 선택 회귀 | 공통 packet/listener/generation·실제 Linux recvmsg/descriptor 인계 **21/21**, 변경 error/history/package/runner API **41/41**, native consumer-port positive/negative mutation **7/7 PASS**. 각 실행 input `f86efa4eb30d1ebd8af2bd11a59982b73833b0efa87725b25329531d721ddb8f`(15611개) 전후 동일, fail/cancel/skip/todo0. 서로 다른 세 선택 실행이며 전체 suite나 Mac qualification이 아님. 격리 시험은 pinned bwrap0.12.0을 임시 /usr/bin overlay에서 실행했고 UID1000·CapEff0·binary SHA를 보존했다. host /usr/bin은 변경하지 않았다. 원시 로그/상태/단계 명령/전후 identity와 SHA는 `/home/dev/oma-audit-artifacts/native-2026-10-27-mach-connector/`가 소유함 |
| 위 후속의 최초 실패 보존 | 첫 선택 실행 **20/21 PASS·1 FAIL**: missing-directory bind의 ENOENT 기대에 실제 EACCES가 반환됨. 실제 점유된 주소의 EADDRINUSE 및 기존 listener 보존으로 강화 후21/21 확인. 별도 첫 확대 실행 **37/38 PASS·1 FAIL**은 원본 TS를 잘못 실행해 compiled fixture를 찾지 못한 명령 오류. 올바른 compiled JS와 실제 bwrap view에서41/41 확인. 최초 로그도 같은 새 audit root에 보존하며 지우거나 전체 PASS로 덮지 않음 |
| START/public-validation fixture 수정 후 관련 회귀 | **33/33 PASS**, skip/cancel/todo0·18.495초·input `ce9b96e02382976921f01f69b0ae67fe4c1471efd9c3dbba6d37fd4b65fdfd56` 전후 동일. `native-reference-fixtures-focused*`. 실제 Node timer를 사용하며 기존 latency budget과 accepted fact 판정 유지. 첫 전체17 FAIL을 전체 PASS로 대체하지 않음 |
| 외부 구현 대조·reply turn 후속 첫 전체 local | **3762/3779 PASS·17 FAIL**, skip/cancel/todo0·940.027초·input `bc7e189f79ebed11044bd9697a3ed987bbb9904781b93b083585e00a78b02a18` 전후 동일. `native-reference-yield-whole*`. 실패는 START의 옛 host/guest 기대값1건과 public-validation fixture의 새 Node timer import 미연결16건. 문구를 정확히 갱신하고 실제 timer module을 fixture에 연결한 후 정책16/16 PASS·skip0. 전체 재실행 결과와 구분 |
| `5e369b30` 전체 Architecture CI40316751983 | baseline/native-all 모두 **3777/3777 PASS**, skip/cancel/todo0. baseline fast795/795·durable871/871·property34/34·stress13/13·platform29/29 PASS. standalone kernel/crash wrapper는 NOT_RUN이며 native-all의 실제 파일/필수 이름으로 실행. ZIP `12649820624` SHA256 `2a225f1a198ad8e1eb9d389bf93abb0d517c859885f75cd0edbe27cfaa4a9113`, native-all `12648632520` SHA256 `bced406a8587ffe6f8cca335edde624d0ab216128bfdb0d425adbbe85476116c`; source/input 별도 검증. 이후 변경의 결과가 아님 |
| 앞선 전체 CI의 실패 보존 | `e997fe37` baseline3777/3777 PASS, native-all3776/3777·mkdirAt EAGAIN1. `e37ad5e0` 전체3777/3777 및 native-all3777/3777 PASS, stress12/13·mixed lag100ms 실패. raw SHA 확인 후 각 ci 폴더에 보존. 후속 성공으로 실패를 덮지 않음. 실제 mkdirat/owned mkdirAt 각각20만 회·자식25개는 EEXIST만 관측했고 EAGAIN 원인은 미확정 |
| mutation reply turn 회귀 | 새2개는 수정 전2 FAIL, 기존6개 PASS. 공통 PublicDispatcher에서 효과/view 갱신 뒤 turn을 반환한 뒤 **8/8 PASS**, skip/cancel/todo0·16.814초·input `4596344b5a0f10da87f296a04dd9911db91841705c9eddf82ddcb6821e41656d` 전후 동일. admission 철회 뒤 accepted plan/result 보존 포함, 기존50/100ms 지연 기준 유지. `native-dispatch-yield-{before,after}-fix*`; 전체 후속 검증과 별도 |
| `9116bb6b` 새 CI 시작 실패 | Native40318575316/Architecture40318575321의 모든 job은 스텝·실행 로그 없이 시작 전에 failure. 새 Mac self/등록 포트 후보는 **NOT_RUN**이며 compiler/runtime 결과가 아니다. annotation 상세는 현재 조회 도구에서 미확인. 이후 외부 구현 대조와 Chromium rendezvous 후보 반영도 실제 Mac 재실행 전 |
| `e997fe37` 실제 Mac26/15 Mach 후보 SDK 실패 | 기존15개 관측은 각각 OBSERVED. 새 후보는 deprecated mach_port_destroy에 -Werror compile 실패,6개 case 미실행/SETUP_FAILED. 원시 ZIP2개 SHA256/source 확인·`ci-e997fe37/` 보존. 경고 억제 없이 send/receive 권리별 반환으로 수정 후 실제 CI 재실행 필요. 세 gate OPEN이며 전체 workflow PASS가 아님 |
| status owner·Darwin 후보 추가 뒤 독립 설치/정적 | **26/26 packed install/public API/authored declaration/해당 installed runtime PASS**,269.430초. input `a3b7fb252b39a2ca6a6fafb1d587c4bfb58785c9e9b7b601950ee0ce20ed8c0b` 전후 동일. 전체 정적 gate41.075초·정책7/7·inventory18/18 PASS. 외부 SDK declaration44개는 별도이며 authored 오류0. `native-status-mach-*`. 이후 유지보수/결과 문서는 별도 입력이고 실제 Darwin C 실행은 아직 NOT_RUN |
| status owner 후속 Linux 선택46개 파일 | **430/430 PASS**, fail/skip/cancel/todo0·466.084초·input `66ab51c0afa08c39760f8c1e27837113c230e0625564eca6635084724b2d3896` 전후 동일. `native-status-owner-integration*`. read20/mixed39/pending620 lag19ms, 기존 budget50/100/50ms 유지. 같은 입력 전체 정적 gate·정책7/7 PASS. 이후 운영 문서·Darwin 후보 추가는 이 실행의 입력이 아니며 전체/CI 결과로 승격하지 않음 |
| `db68c111` 최신 전체 local | **3773/3775 PASS·2 FAIL**, skip/cancel/todo0·894.612초·input `ec7ee8fc1481ed838594ebe5d4cdf40639d421681b166c671d39b78baf4292bf` 전후 동일. `native-whole-db68c111*`. prompt의 host/guest 기대값과 cgroup 제거의 새 native golden hash가 실패했고 정확한 기대값으로 수정 후 부분 재검증 PASS. production이나 과거 golden을 되돌리지 않음 |
| `db68c111` 실제 Native CI40284241937 | Linux/Mac15/Mac26 공통각 **74/74**, Linux peer3/3·native37/37·선택386/386 PASS·skip/cancel/todo0. input ec7ee8fc… 전후 동일. raw zip5개 SHA/source/input 검증, `ci-db68c111/verified-summary.json`. 양 Darwin SDK compile0·각15개 실제 관측·세 gate OPEN/BLOCKED. peer token도 읽기 전후 동일32bytes이며 per-message origin 미증명 |
| `db68c111` 독립 packed install | **26/26 PASS**, authored declaration 오류0(외부 SDK 진단44는 별도), input ec7ee8fc… 전후 동일·276.137초. `native-post-regression-packed-install*`. 이후 broker 상태 게시 수명 변경은 재검증 대상 |
| `db68c111` Architecture CI40284241877 | **FAIL**. native-all **3772/3775 FAIL3**(prompt/golden/Principal restart delivery), fast794/795 FAIL1. durable871/871·property34/34·stress11/11·platform29/29 PASS·skip0. baseline local serial7/9 FAIL2(지연 예산), parallel3762/3766 FAIL4(prompt/golden/Worker autonomy2). 원시 architecture artifact2개 SHA 검증. 부분 lane PASS를 전체 PASS로 합산하지 않음 |
| CI 후속 상태 게시·동시 실행 수리 | 실제 네 hint가 동일 status를4회 영속 게시한 반례를 보존. 기존 coalescer 재사용·publication task drain, 실제 peer 완료/accepted bytes 대조, Principal actual close 대기로 수정. 관련 **9/9 PASS**·skip/cancel/todo0·47.051초·input `c88fe60f81dbafa4bc638db5999a75916306c5a9e7469fa1308f9e6ac049b361` 전후 동일. `native-status-and-scenario-ownership*`. read19/mixed43/pending12ms; 원래 budget50/100/50ms 유지. 후속 전체/실제 CI는 별도 필요 |
| 전체 Linux 후속 회귀 | **3759/3760 PASS·1 FAIL**, skip/cancel/todo0, 934.673초. input `91909d2aef50ba0583eba51b63f9a1a8b99c0692c707ed9200952d0b1c3d6844` 전후 동일. 유일한 실패는 동적 Runner 제목과 durable registry의 참조2건이며 명시적 시험명으로 수정. `native-whole-current-repaired*`. 이 입력의 Personal PTY는 ambient oma를 사용했으므로 현재 설치 proof로 제외. 이후 실제 설치·통신 변경은 다음 별도 결과 |
| 현재 checkout의 실제 설치·Keychain·Runner·경계 | **70/70 PASS**, skip/cancel/todo0·input `d3892c6bbb1a34dcf9eacb7a676584ce54dcf44127c1831633cd2408ac6c7dae` 전후 동일·64.659초. `native-keychain-install-source-fenced*`. Personal PTY16건은 runtime-only prefix의 exact bin과 checkout module/data 거절 guard를 사용. 실제 socket15건은 fatal UTF-8/BOM/중복 key/unknown correlation·field·type/oversize/EOF/timeout과 poison을 검증. Keychain ownership 정책·Runner 통신·durable registry 포함. signed Keychain/TCC/G-AUTH나 독립 packed install의 대체가 아님. 첫69/70 fixture 실패와54/70 guard setup 실패도 보존 |
| `3f0f6151` 실제 Native CI `40259190478` | Mac15/26·Ubuntu 공통 각 **59/59**, Ubuntu peer **3/3**·native **37/37**·선택 integration **386/386 PASS**, skip/cancel/todo0. 세 OS input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d` 전후 동일. 원시 zip5개 SHA256·source 확인, `ci-3f0f6151/verified-summary.json`. Darwin 각15개 관측/세 gate는 OPEN/BLOCKED이며 workflow 전체 PASS가 아님 |
| 같은 commit의 Architecture CI `40259190470` | **FAIL**. native-all/fast는 installer의 외부 bubblewrap 문서7건이 저장소 `.scratch`에 남아 document-integrity에서 **PRECHECK_FAILED/NOT_RUN**. durable **843/871 FAIL28**, property **28/34 FAIL6**, stress **8/11 FAIL3**, platform **29/29 PASS**·각 skip/cancel/todo0. SHA256 확인한 baseline/all zip과 `architecture-results-summary.json` 보존. 준비 도구의 source/build/bin을 RUNNER_TEMP로 옮겼으며 문서 검사 예외를 추가하지 않음. 후속 실제 CI 검증 필요 |
| `3f0f6151` 전체 Linux local | **3607/3759 FAIL152**, skip/cancel/todo0, 454개 파일·881.448초. input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d` 전후 동일. `native-whole-local-3f0f6151{.log,-status.json}`, 실패 상세 `*-failure-progress.json`. 실패33개 파일의 당시 원문은 `docs/archive/native-full-regressions-2026-10-26/` 보존 |
| 전체 실패 후속 부분 수리 | 실제 candidate SIGKILL cleanup의 의도한 ABORT_ERR 중복 경합은 실제 close join을 유지해 수정 후 **7/7 PASS**. 공통 workspace asset 검증은 Swift source와 원래 entitlements를 모두 요구. 후속 부분 **173/187 FAIL14**의14건은 broker harness의 retainNative 소유·drain 순서 수정 후 **17/17 PASS**. 서로 다른 입력의 부분 결과를 전체 PASS로 합산하지 않음 |
| native receipt·transport 후속 | 실제 namespace의 receipt/lifecycle **16/16**, 실제 connection flood+receipt policy **18/18**, 실제 private socket idle/EOF **4/4**, 설치된 MCP credential adapter의 실제 owned namespace 실행 **1/1 PASS**·각 skip/cancel/todo0·각 input 전후 동일. `native-receipt-real-scopes`, `native-flood-and-receipt-policy`, `native-runner-private-channel-fixed`, `native-mcp-owned-credential-fixed` 원시 log/status. policy stubs는 OS/auth proof가 아니며 MCP host shell guard는 유지. 최신 전체 회귀/CI/packed 설치는 별도 필요 |
| native publication/cursor 수리의 실제 재검증 | **72/72 PASS**, fail/cancel/skip/todo0·input `8e4e28b76f65cee4fb01fdcc9ea181cbba9ecc84b61410e18f20e0a4936f083a` 전후 동일. 초기 journal 게시 뒤 실제 SIGKILL/재초기화·candidate checkout 뒤 SIGKILL/재시도·같은 bundle FD의 진행한 cursor와 교체 pathname·accepted 원본 bytes·canonical refs를 검증했다. UTF-8/owner rule negative controls도 포함. `native-canonical-scope-fixed{.log,-status.json}`. 전체 root runtime과 후속 CI는 별도 |
| native publication 경계 후속 | durable 등록 불일치5건을 실제 owner/checkpoint로 갱신. 관련 최초 실행 **70/72 FAIL2**, skip/cancel/todo0·input `205d2f05143971f0426f0e991d15c4c3019acaa7534a4c6fb5d0661c1649fafc` 전후 동일. 초기 publication 시점에는 아직 journal writer lock을 획득하지 않았으며, quarantine의 bwrap data 소비가 borrowed FD cursor를 EOF로 만들어 동일 FD 재시도를 거절했다. 시험의 시점 구분·공통 Git의 exact-inode 독립 cursor 소유를 수정 중. 원시 `native-canonical-scope-regressions{.log,-status.json}` 보존. 후속 결과는 별도 기록 |
| 후속 전체 build·정적 발견 | 전체 build PASS. 첫 전체 정적 검사는 남은 빈 legacy 디렉터리2개, private UTF-8 decoder3곳, 옮겨진 Worker spawn owner와 옛 exemption을 발견했다. 빈 디렉터리 제거·공개 domain decoder 연결·정확한 owner relocation과 private-input helper 검사 후 rule0건 PASS. candidate의 BOM이 실제로 ready/허가1을 만들던 반례(`native-candidate-bom-before-fix.log`)를 보존하고 거절/poison/허가0 회귀와 parser corpus를 추가. 전체 architecture/runtime/CI 결과는 이후 고정 입력에서 별도 확인 |
| `dd8d7a96` 실제 CI `40254390815` | Mac26/15·Ubuntu 공통 각각 **58/58**, Ubuntu peer3/3·native35/35·확대44개 파일 **386/386 PASS**, skip/cancel/todo0. 세 OS input `4927bdabbfd9b9aba3e478158a2a473174d33c7cfb22d1f6b4a1e89601904ace`·전후 동일. 실제 prerequisites-before에는 rg/fd/fdfind가 없고 Corepack0.36.0은 ambient PATH에만 있었다. Node prefix에0.34.0 설치 후 Worker 실제 명령도 통과. 양 Darwin 각15개 관측/세 gate는 OPEN/BLOCKED이며 전체 workflow PASS가 아님. zip5개 SHA256·source 확인, `ci-dd8d7a96/verified-summary.json` 보존 |
| 전체 검증 도구의 native 전환 작업 트리 | local에서 native execution 시험 제외를 없애고 kernel/all/durable은 pinned0.12.0 preflight를 요구한다. manager opt-in/fixture/cleanup 경로를 제거하되 direct argv/manager 거절 guard는 유지한다. 현재 selection/clock/source-binding 정책 **42/42 PASS**·skip0(`native-verification-all-policy.log`); 이 정책 단위 시험은 새 shared CI installer나 전체 Linux runtime의 PASS가 아니다. installer/전체 native-all job·root 전체 회귀의 실제 실행은 다음 검증 대상 |
| `159c66c8` 실제 CI `40252199462` | Mac26/15·Ubuntu 공통 각각 **58/58**, Ubuntu peer3/3·native35/35 PASS. 확대 integration은 **355/359 FAIL**, skip0: Python message-id header의 선행 folding 공백, 검색 도구, Node26에 없는 Corepack 및 그 실제 실행4건. 세 OS input `b9cada156294180f8e44963308ae06f8a7bd2bbf1c93f290f98b4f8d0e4781a0`·전후 동일. Darwin 양쪽 실제15개 관측의 세 gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 `ci-159c66c8/verified-summary.json`에 보존. 전체 workflow FAIL을 PASS로 표시하지 않음 |
| 남은 audit/phase4 native 전환 작업 트리 | 실제 scope와 원래 accepted/data 단언을 함께 검증한 **30/30 PASS**, strict/noEmitOnError 컴파일 PASS. root 전체 strict 진단0·모듈 경계0건 PASS(`native-root-final-reference-removal.log`, `native-modules-final-reference-removal.log`). 기존 C1은 실제 동시 quarantine의 RUN_TERMINATION_UNKNOWN도 unknown으로 보존하고 exact plan/ref/receipt의 수렴을 요구한다. 최초 실패 로그는 `native-audit-{first-failure,concurrent-scope-failure}.log`에 보존. 이후 작은 manifest child의 shell 제거·CI44개 목록과 prerequisite 수정은 후속 검증 필요 |
| 검색 도구 설치 차이 재현 | isolated PATH에서 실제 rg 부재는 같은 contained-search 거절을 재현하고 실제 rg를 추가하면 같은 파일/질의가 성공했다. 원본 bytes 보존. `native-ripgrep-prerequisite-repro.log`. fd 부재를 원인으로 가정한 첫 대조는 재현되지 않았으며 `native-fd-prerequisite-repro.log`를 그대로 보존. CI는 rg/fd-find/Corepack0.34.0의 실제 설치·버전/SHA를 남기도록 수정 중이며 실패를 skip하지 않음 |
| 확장 native 회귀 및 모듈 독립 설치 — 현재 production 변경 포함 | strict42개 시험 파일에서 **359/359 PASS**, 별도 실제 Linux kernel/sender/namespace **35/35**, 공통 **58/58**, 독립 packed install **26/26 PASS**. 모든 실행 input `e05e5a9542bdda8c50baa8c7d3591251f747418a0bee2872fe63291a699f238e`(15595개)·전후 동일, skip/cancel/todo0. authored declaration 오류0이며 외부 SDK 진단44개는 별도. `native-expanded-{integration,kernel,common}.log`, `native-expanded-independent-install.log`, 각 전후 identity 보존. build26개(7개 재컴파일)·document integrity·production inventory도 PASS. root 전체 strict는 audit/phase4의 제거 API/옛 Promise 처리8개 진단 FAIL, 모듈 검사는 같은2개 시험 파일의 삭제 import3건 FAIL. 전체 root/최종 qualification으로 승격하지 않음 |
| 전체 회귀 전환 후속 — P0·격리·CLI·candidate | 고정된 각 입력에서 strict 컴파일 후 **56/56**, 별도 **66/66**, 실제 CLI/동시 stream **3/3**, candidate·capability·batch **11/11 PASS**·각 skip0. 입력별 `native-p0-ownership-*`, `native-p0-six-seven-*`, `native-cli-stream-*`, `native-phase5-*`가 원시 로그/전후 identity를 소유한다. 서로 다른 입력의 합계를 전체 PASS로 표시하지 않음 |
| parser/view/entry/quarantine 후속 전환 | 각 입력에서 parser/view/native **56/56**, 실제 broker entry **2/2**, 상태 projection **10/10**, 실제 quarantine **4/4**, phase8+durable crash **50/50 PASS**·각 skip0. 원시 `native-parser-views-*`, `native-topology-entry-*`, `native-status-projection-*`, `native-quarantine-*`, `native-phase8-*` 보존. 이후 production 상태 표시 변경은 이 과거 실행의 입력이 아니며 확장 integration/후속 CI로 다시 검증 |
| 확대 integration 최초 로컬 실행 설정 실패 | strict42개 컴파일은 통과했지만 로컬 `/usr/bin/bwrap` mount wrapper를 빼고 실행하여 실제 OS 시험 FAIL/NOT_RUN. `native-expanded-integration-without-local-bwrap.log`를 보존하며 통과로 세지 않음. 실제 pinned bwrap이 보이는 로컬 mount에서 같은42개 전체를 재실행하고 CI에서도 다시 확인해야 함 |
| `65233ca4` 실제 CI `40244936163` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33·선택 integration **197/197 PASS**·skip0. 실제4MiB tmpfs의 ENOSPC, STORAGE_FULL 및 accepted 원본 보존을 확인. 세 OS input `705cae1ca48ba59b776dc6f4b9acac9c7c26314b43e8c4f63235b2bb2cfeab5c`·전후 동일. 양 Darwin gate는 각15개 실제 관측 후 계속 OPEN/BLOCKED이며 workflow 전체 성공으로 표시하지 않음. zip5개 SHA256 확인·`ci-65233ca4/verified-summary.json`과 원시 artifact 보존 |
| 후속 RPC·역사 plan 시험 전환 | 삭제된 host relay를 registry에서 거절하고 현재 internal response를 closed schema로 검증. 역사 v2가 v3 의미를 얻지 못하는 guard·runner 관측·큰 ledger 조회를 유지. strict 부분 컴파일 뒤 **25/25 PASS**·입력 변경0. `native-root-ports-fixed-{before,after}.json`, `native-root-ports-fixed-real.log`. 최초24/25 실패는 옛 internal method 수9 기대값이며, 현재8개 이름의 정확한 닫힌 목록으로 갱신. 이 후속 변경은 아직 작업 트리에 있음 |
| `d5d65ed4` 실제 CI `40243911993` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33 PASS. Linux 선택 integration은 **179/180 FAIL**: 실제 full-filesystem child의 옛 unshare가 uid_map 권한 거절로 미실행. 세 OS input `218696cec4ea5d1dee5cac3969d2a85e526d4114828aa6952004a9e9b5ceaded`·전후 동일. 양 Darwin gate는 계속 OPEN/BLOCKED·각15개 실제 관측. zip5개 SHA256 확인·원시 `ci-d5d65ed4/` 보존. 전체 workflow 성공으로 표시하지 않음 |
| full-filesystem의 native primitive 전환 | 옛 unshare+shell mount를 pinned bwrap의 실제4MiB tmpfs로 대체. 실제 ENOSPC·STORAGE_FULL·accepted mail 원본/게시 검증을 모두 유지했고 global userns 설정을 바꾸지 않음. 추가 native asset/준비 시험과 함께 **21/21 PASS**·skip0, input `5e5793b5df95997edbcf014f55ed8cd7fec98b41908b10921ae40c42d419c39a`(15597개)·전후 동일. `native-full-fs-replacement-*` 보존. 후속 CI 재실행 필요 |
| `d5d65ed4` 이후 독립 모듈 설치 재검증 | **26/26 PASS**. 각 tarball을 선언한 dependency closure만으로 설치하고 public entries·authored declarations·해당 installed runtime을 검증. 외부 SDK declaration44개는 별도 진단이며 authored 오류0개. input `d05e9255f5df7f17f61bc83469997e6bd296362d475ab6c630ee50c805b222c5`·전후 동일. `native-d5-independent-install.log` 보존 |
| 선택 native integration의 단일 고정 입력 실행 | strict/noEmitOnError로19개 시험 파일을 컴파일하고 **180/180 PASS**·skip/cancel/todo0. input `8dcd2c2ec5c10709a5f73d5502db7061097281864c39c677293d9b88405663fe`(15597개)·전후 동일. `native-selected-integration-{before,after}.json`, `native-selected-integration-real.log`. 실제 Native/Pi·권한·receipt·Worker·durable SIGKILL을 같은 실행에서 검증. 전체 root type/module 검사는 여전히 별도 FAIL이며 Mac 제품 qualification이 아님 |
| `6d8263eb` 실제 CI `40239657753` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native **31/31 PASS**·skip0. 세 OS input `2c2cdee2d33c5cf83392cf626a988748c0aff5f492ef84735e9dd34d7de723fb`·전후 동일. Darwin 양쪽 각15개 실제 관측 후 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 결과와 요약을 `ci-6d8263eb/`에 보존 |
| 실제 Native Resident/Broker/Pi 통합과 종료 수리 | **25/25 시나리오**, 실제 Resident6개를 포함한 공통 수명·shutdown **34/34 PASS**·skip0. input `b6a41d6ce65c8964788337a8b91fc19067fffe9343fc537aa72858b123a5a577`(15594개)·전후 동일. 자동 생성 첫 실행·현재 grant·provider 실패·SIGKILL·broker 교체·receipt·tool plan 거절을 실제 Pi/sandbox로 확인. `native-resident-drain-{scenarios,policies}.log` 보존. root 전체 PASS가 아님 |
| systemd 시험의 실제 native 전환 | strict 부분 컴파일 후 정책·권한·accepted fact **71/71 PASS**, input `db9e3ef267d7076bdc3ff1fb0f44a798e5e449f98711a686e8493a65ca370dfe`. 별도 입력 `62abb6d454cbe99a3dfec064faa4ddab4b73c81f5e92e1d5188b1b626286f392`에서 Worker/sandbox **38/38**, 실제 durable SIGKILL **46/46 PASS**·각 전후 동일·skip0. `native-policy-71-real.log`, `native-connected-{worker,crash}-regressions-real.log` 보존. 당시 시나리오25개 중1개 실패도 보존했으며 위 수리 후25/25와 합산하지 않음 |
| 전환 중 재현한 통합 실패 | 첫18개 시나리오 중2개 실패: 자동 시작으로 초기 mail이 cur로 이동하는 fixture 차이, 종료된 Store 재접근. 이후25개 중1개 실패: runner.open 뒤 옛 incarnation으로 stop하고 diagnostic close가 teardown 뒤 도착함. 실패·전후 input과 원시 로그를 보존했으며 skip·죽음 보장 완화로 해결하지 않음 |
| 최신 root 전체 strict typecheck | 후속 audit/phase4 전환 뒤 **PASS, 진단0**·모듈 경계0건 PASS. `native-root-final-reference-removal.log`, `native-modules-final-reference-removal.log`. 이전8개는 `native-root-after-expanded.log`와 옛 시험2개 파일의 삭제 import3건이다(`native-modules-after-expanded.log`). 이전17개는 `native-root-after-cli-stream.log`. 이전54개는 `native-root-after-rpc.log`. 이전61개는 `native-root-after-layout.log`, 이전79개 진단은 `native-root-after-connected.log`에 보존했다. 제거된 unit/host relay API와 기존 물리 시험의 전환이 남았다. 선택 native integration의 PASS를 root 전체 PASS로 표시하지 않음 |
| `64cb2cad` 실제 CI `40237516208` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native 실행·SIGKILL·sender·Git·Resident **24/24 PASS**. build26/26·세 OS 동일 input `d568e62424b4c30f0d9729fb94436c0ffedcbaf93ff3bca5b3a08aadfb5caf10`(15591개), 각 전후 동일. Ubuntu bwrap 한정 AppArmor profile을 명시했고 전역 제한1은 그대로다. Darwin gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 artifact는 `ci-64cb2cad/` |
| 위 CI 이전의 Ubuntu 실제 실패 | `e62881f3`·`ffcb1140`에서 init pin 이전 종료를 재현. 추가 launcher 관측에서 실제 exit1·`bwrap: setting up uid map: Permission denied` 확인. unknown journal을 빈 목록으로 치환하지 않았고 실패 archive도 보존. OS의 application별 userns 권한을 설정한 뒤 동일 scope/격리/권한 시험을 실행해 위 결과를 얻음 |
| 후속 FD·로그·runtime 수정의 Linux 실행 | 옵션처럼 생긴 env 값 오분류, log open 뒤 hard link 도입 시 쓰기, diagnostic 실패 후 stop의 stale active 상태를 재현·수정. 실제 OS 및 공통 정책 **57/57**, 별도 strict 부분 컴파일 후 기존 권한·accepted fact·mail/storage/reconcile **37/37 PASS**·skip0. input `6a69b12e11d829ef9fda6268dca2ca2ba3a8f88af58b6d639096bb6df531ba20`(15594개), 두 실행 전후 동일. 원시 `native-log-and-runtime-fixed-*`, `native-policy-after-runtime-fixes.log` 보존. root 전체 strict typecheck는 여전히 FAIL |
| `7707de9d` 실제 CI `40235030613` | Mac26/15·Ubuntu 공통 시험 각각 **54/54 PASS**·build26/26·세 OS 동일 input `df788571bb8a51a39e945d8262c5484a630ade3c22f4f5841432d4a5adf6cbd6`(15590개), 각 전후 동일. Darwin 두 gate job은 BLOCKED·각 15개 실제 관측·Keychain SDK typecheck PASS. Ubuntu 후속 native-leaf는 제거된 sd_notify import로 2 PASS/1 FAIL이며 새 Linux execution step은 미실행. 전체 workflow 성공이 아님. artifact 5개 zip SHA256 확인·원시 로그를 `ci-7707de9d/`에 보존 |
| 직접 경로의 workspace·독립 설치 | workspace 시험 **421/421 PASS**·skip0. 첫 독립 설치 실행은 lifecycle smoke의 동기 assertion 때문에 실패했으며 async assertion 전환 뒤 **26/26 packed install/public declaration/import/해당 runtime smoke PASS**. 외부 SDK 선언 진단과 authored declaration 결과는 원시 로그에서 구분한다. `native-connected-workspace-tests.log`, `native-connected-isolation{,-fixed}.log` 보존. 전체 root 회귀는 별도 미완료 |
| 후속 native 회귀 | 제거된 notify 시험을 보관한 실제 peer/leaf **3/3 PASS**. 공통 ResidentRuntime과 실제 Linux scope/journal의 동시 시작·옛 incarnation 중지 거절·geometric backoff·5/60s start-limit·권한 거절 **3/3 PASS**. `native-legacy-leaf-fixed.log`, `native-resident-first-real.log` 보존. 후속 source의 Ubuntu CI는 재실행 필요 |
| 직접 native 경로와 공통 OS/정책의 확대 실행 | **80/80 PASS**, fail/skip/cancel/todo0. Linux 실제 namespace·sender·Git sandbox와 공통 FD/파일/로그/종료 정책·protocol·Restic dump oracle을 함께 실행. input `84b40cf23b96c72a8f0f5da5d570bf6c9cd4393862adf64a5778d53d75a0d19f`(15590개), 전후 동일. `native-connected-current-linux.log`와 before/after JSON 보존. 전체 local 및 Darwin qualification 아님 |
| 2026-10-26 직접 native 경로의 실제 관련 시험 | **33/33 PASS**, fail/skip/cancel/todo0. Linux 실제 bwrap0.12·kernel namespace/pidfd·SIGKILL 5개 경계·setsid double fork/FD 폐기·SCM_RIGHTS transfer와 64 FD 반환 반복·credential 위조 거절·candidate checkout/exec·quarantine 검증/import·POSIX FD·로그 정책·shutdown fence. 일부 policy 단위 시험도 포함하며 G-*나 전체 Linux/Mac 제품 qualification으로 승격하지 않음. input `f6ee85ab6055581bf7f400bbf47b452652bb7f15feab63cc7a91852e6c9b44db`(15590개), 전후 동일. 원시 `native-connected-fixed-real.log`와 before/after JSON 보존 |
| 위 실제 경로의 발견·수정 | 취소 후 gate release, pre-gate 부모 SIGKILL 후 init 생존, quarantine mount target 누락, private argv NUL 검증 누락을 실제 재현 후 수정. 첫 실패 로그를 삭제하지 않음. witness 없는 opening은 unknown으로 보존하며 이 사례의 기대된 거절을 복구 완료로 세지 않음 |
| 직접 경로 연결 뒤 전체 root 회귀 | strict typecheck 첫 실행 FAIL(제거된 units/cgroup API, async lifecycle 및 create v3 시험 전환 필요). 전체 local 미완료, 새 source의 전체 PASS 없음. workspace production build는 26개 성공. 최종 architecture/owner/독립 설치와 Darwin CI는 별도 재검증 필요 |
| `adf20331`: Linux 실제 Restic round trip·손상·죽음 불명·복구 | 19/19 PASS. 이전 source의 독립 결과이며 이후 모듈 이동에 대한 전체 재검증 아님 |
| VM 제거·Restic 모듈 이동 후 Linux 회귀 | durable fault·Restic round trip 27/27, 공통 파일/metadata/소유권 73/73 PASS. artifact 로그에 각 실행 범위를 보존 |
| `762c1604` 변경을 위한 Linux 실행 | 정식 build·typecheck PASS. config/generation/native/tar 30/30, package/세션 소유권 108/108 PASS. 전체 local은 미실행 |
| `aea22ec0`: 실제 macOS 26/15 common-runtime | 25개 workspace build 성공. 양 OS 9/10 PASS·1 FAIL. 파일 생성 뒤 EACCES: Darwin arm64 openat 가변 인자 ABI 결함을 발견. 실패를 보존하고 수정 |
| `762c1604`: 실제 macOS 26/15 common-runtime | build 성공, directory FFI 초기화가 없는 `readdir$INODE64` symbol을 요구해 실패. 수정 후 실제 OS 재실행 대기. Linux 성공으로 덮지 않음 |
| `13d60492`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. build 25/25. 별도 Darwin gate는 계속 OPEN/BLOCKED |
| `0d471551`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. 실제 SCM_RIGHTS 인계 뒤 peer PID는 connector 생존·종료 모두 holder를 가리켰다. PID 재사용·동시 메시지 인증 증명은 아니며 G-AUTH는 OPEN |
| VM 제거 후 첫 고정 입력 전체 local | FAIL. serial 9개 중 PASS4·SKIP5, parallel 3644개 중 PASS3527·FAIL52·SKIP65. exit1, signal null, 입력 변경0. 전체 통과로 합산하지 않음 |
| 위 실패 수리 후 부분 회귀 | strict typecheck·build·정적 gate PASS. 실제 bwrap 실행 16/16, Restic 복구/fault 12/12, 모듈/소유권 62/62, mjs 회귀 42/42, 구조/결박 8/8 PASS. 당시 부분 범위이며 아래 전체 재실행과 구분 |
| `982658de`: 수리 후 고정 입력 전체 local | **3640/3640 PASS**. serial9·parallel3631, fail/cancel/skip/todo0. exit0·signal null, 실행 전후 입력 변경0 |
| `982658de`: 실제 macOS 26/15·Ubuntu CI | Mac 각각 20/20, Ubuntu 19/19 PASS. 별도 Darwin gate는 BLOCKED. artifact zip SHA-256 확인 후 원본 보존 |
| P2 handle 연결 후 Linux 부분 회귀 | strict typecheck·build·정적 gate PASS. 관련 192개 중 191 PASS·1 FAIL은 옛 renameSync fault가 호출되지 않은 시험이었다. 실제 renameat 게시 후 flush에 fault를 옮긴 저장 회귀 12/12, 모듈/문서/trace 28/28 PASS. 전체 재실행 결과로 합성하지 않음 |
| `8c9ef61d`: P2 관련 고정 입력 회귀 | **192/192 PASS**, fail/cancel/skip/todo0·exit0·signal null·입력 변경0. 원본 `p2-handles-fixed{.log,-before.json,-after.json,-status.json}` |
| `8c9ef61d`: workspace 독립 설치 | **25/25 PASS**. tarball을 선언한 의존 closure만으로 설치하고 공개 entry·자체 declaration·해당 installed-runtime smoke 확인. 외부 SDK declaration 진단44개는 원시 로그에 별도 남음 |
| `8c9ef61d`: 실제 Mac 26/15·Ubuntu CI | Mac 각각 21/21, Ubuntu 20/20 PASS. 세 OS의 input digest가 `ab24d1368aea45d3e95aee4c0417bd6e65c7404dbeed44685213dd59447111f8`(15556개)로 동일. gate job은 계속 BLOCKED |
| P3 wake·CLI handle 연결 후 Linux 회귀 | build·strict typecheck·transaction 검사 PASS. captured T·wake·drain·현재 authority·CLI 입력 관련127/127, 실제 Mail→살아 있는 Broker hint 연결·same-key·rollback 관련30/30 PASS. 서로 다른 부분 실행이며 전체 PASS로 합성하지 않음 |
| `663adda3`: 실제 Mac 26/15·Ubuntu CI와 독립 설치 | Mac 각각28/28·Ubuntu27/27, workspace 독립 설치25/25 PASS. 공통 CI 세 OS의 input digest `f7750bfd598ef32554bc06176af265645a69c2a2735a66393abcf847aaaa3292`(15558개) 동일. 별도 Darwin gate는 BLOCKED |
| `663adda3`: 고정 입력 전체 local | FAIL. serial9 PASS, parallel3646 중 PASS3642·FAIL4. skip/cancel/todo0·exit1·signal null·입력 변경0. `local-p3{.log,-before.json,-after.json,-status.json}` 보존 |
| 위 4개 fault/checkpoint 연결 수리 | 관련35/35 PASS·skip0·입력 변경0. input `046211bd0c8ecb72fb29129d4200559d680d5460495893dde6bb921f0575cc95`(15558개). `p3-fault-repairs{.log,-before.json,-after.json,-status.json}` 보존. 전체 PASS로 합성하지 않음 |
| 26번째 tool-files workspace 분리 후 Linux 검증 | 정식 build·strict typecheck·정적 architecture PASS. 관련189/189, 별도 실제 SIGKILL·복구17/17, 독립 설치26/26 PASS. input `df4f5b65796e6429afcf52ccbb88c61b050132bb406ecd0964b01ae28e199135`(15564개), 세 실행 모두 입력 변경0. 전체 local PASS로 합산하지 않음 |
| 위 변경의 시험·빌드 실행 오류 | 최초 빌드는 도중 package.json 표기 편집을 입력 고정 검사가 거절했다. 최초 부분 시험160/163은 TS 원본 직접 실행으로 세 상대 경로가 어긋났다. 입력을 고정한 정식 빌드와 컴파일된 시험으로 위 결과를 얻었으며 최초 실패 로그도 보존 |
| `f042b159`: 고정 입력 전체 local·실제 CI | 전체3660/3660 PASS(serial9·parallel3651), skip/cancel/todo0·exit0·입력 변경0. 실제 Mac26/15·Ubuntu 공통 CI 각각30/30·build26/26. 세 OS와 local input `57327bddba87ce9a33f9e266e03d856c355d7a050c55d456b966753c6f26be65`(15564개) 동일. 별도 Darwin gate는 OPEN/BLOCKED |
| OS 경계 확대의 Linux 실행 | 새 실제 OS11개·기존 primitive4개·Linux pidfd/Unix credential5개, 합계20/20 PASS. input `a0143e84c5482b632f25e55cd83450d18b6cbe43c56b2b6d41f3fa7835927be2`(15566개), 입력 변경0. `os-boundaries-linux{.log,-before.json,-after.json,-status.json}` 보존. 새 Darwin 독립 사례는 실제 CI로 별도 판정 |
| 실제 macOS 26/15 Keychain | 독립 Swift primitive SDK typecheck PASS. signed Keychain·release 실행·TCC는 미실행 |
| 현재 source의 전체 local·최종 architecture/trace qualification | 미완료. 일부 이전 실행 PASS를 합산하지 않음 |

실제 workflow: [40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898),
[40197183201](https://github.com/minjung2035/oma-v2/actions/runs/40197183201),
[40200893255](https://github.com/minjung2035/oma-v2/actions/runs/40200893255),
[40201140402](https://github.com/minjung2035/oma-v2/actions/runs/40201140402),
[40201962210](https://github.com/minjung2035/oma-v2/actions/runs/40201962210),
[40202613809](https://github.com/minjung2035/oma-v2/actions/runs/40202613809),
[40202936879](https://github.com/minjung2035/oma-v2/actions/runs/40202936879),
[40205394437](https://github.com/minjung2035/oma-v2/actions/runs/40205394437),
[40207646347](https://github.com/minjung2035/oma-v2/actions/runs/40207646347),
[40210726412](https://github.com/minjung2035/oma-v2/actions/runs/40210726412),
[40216022510](https://github.com/minjung2035/oma-v2/actions/runs/40216022510).
모든 실패 artifact를 보존한다. 원시 local 로그는
`/home/dev/oma-audit-artifacts/native-2026-10-25/`에 있다. 새/변경 source는 NOT_REVIEWED이며
고정 architecture·authored review·과거 검토 기록은 변경하지 않는다.

첫 전체 실행의 입력은 `bcb1b03b01d3605ef0155d0d14d201d35eea9747797109ccd42b8932f67359f2`
(15564개)이며 실행 전후 동일하다. 원시 결과는 위 artifact 디렉터리의
`local-frozen.log`, `local-frozen-before.json`, `local-frozen-after.json`,
`local-frozen-status.json`이 소유한다. 실제 bwrap을 private mount로 배치한 부분 시험은
실제 service/cgroup 또는 manager 없는 제품 실행의 증거가 아니다.

수리 후 전체 실행은 2026-10-25 15:06:43.852–15:21:40.916 UTC에 실행했다.
입력 `7c71573c808ff941dd9849690bf895ccb8e8fe0907ad9616a9c73250dc559d4c`(15556개)는
전후 동일하다. 원본은 `local-repaired.log`, `local-repaired-before.json`,
`local-repaired-after.json`, `local-repaired-status.json`이다. 실행 뒤의 파일 handle 변경은
이 전체 PASS의 입력이 아니다. 이 입력에서도 local runner가 별도로 제외한 service/cgroup
suite 9개는 NOT_RUN이며 Darwin 세 gate의 proof로 합산하지 않는다.

`8c9ef61d`의 실제 Mac 26/15에서 connector가 인계 전에 queue한 첫 바이트를 읽기 전·후
모두 LOCAL_PEERPID는 holder를 가리켰다. 두 process는 살아 있었다. 현재 endpoint의 마지막
PID를 각 요청의 발신자로 간주할 수 없다는 반례이며 G-AUTH를 OPEN으로 유지한다.
SHA-256을 확인한 원본 zip·probe·SDK·시험·input artifact는 `ci-8c9ef61d/`에 보존했다.
그 뒤 CLI context의 held descriptor 연결은 위 runtime/설치 결과의 입력에 포함되지 않는다.

남은 구현은 [전환 기록](native-transition.md)을 따른다. 직접 실행 scope·auth·owned 파일
pin/reopen·quarantine/checker·설치와 P7 최종 대조가 남아 있으며 full support 완료가 아니다.

## 이전 입력의 코드 검증: DR48 (2026-10-25)

| 검사 | 실제 결과와 범위 |
|---|---|
| 전체 local suite | **4184/4184 PASS**. serial9 + parallel4175, fail/cancel/skip/todo0, status0/signal null, 951.28초 |
| 실행 입력 | 15681개, `06811f22e03c6e8eca2e088c1780579a2c3f3525124ec1b3f4b48b4ee77a1c13`. 실행 전후 변경0 |
| build·strict typecheck·전체 정적 gate | PASS. architecture·transaction·durable-boundary·document·spec 검사를 포함 |
| 최신 App 독립 설치 | PASS. 실제 Restic/SQLite close→read-only→reopen, 공개 entry·자체 declaration·설치 runtime |
| Domain·Native·Storage 독립 설치 | PASS. 이후 해당 package 소스 변경 없음 |
| 설치 확인 | 설치된 `oma --help`, managed Restic 0.19.1 확인 |
| review | 새/변경 코드 NOT_REVIEWED. 과거 authored review를 갱신하지 않음 |

원시 결과의 소유자:
`/home/dev/oma-audit-artifacts/session-storage-2026-10-25/verification-result.json`.
같은 디렉터리의 `local-full-accepted.log`, `*-before.json`, `*-after.json`, `*-status.json`이 실제 입력과 종료 상태를 보존한다. 실행 뒤 결과·운영 안내·인계를 기록한 차이는 `post-runtime-input-relation.json`에 있다.

DR48은 Git index·local refs·staged/unstaged·untracked/ignored 파일, mode·소유권·nanomtime·symlink·내부 hardlink의 보관/복원과 삭제·게시 후 실패 재시도를 검사했다. 두 세션의 동일한 random 4MiB 파일은 source 합계 8,388,608 bytes에 대해 unique stored data 4,235,172 bytes였다. 이 fixture 결과를 제품 전체 절감률로 사용하지 않는다.

초기 손상 시험에서 Restic tree cache가 repository 손상을 가린 실패를 보존했다. `--no-cache` 수정 후 실제 손상 pack과 원본 보존을 검증했다. SQLite read-only 조회가 만든 빈 WAL 때문에 복원이 막히던 결함도 회귀로 확인했다. 첫 전체 실행은 수정 전에 SIGTERM으로 중단했으며 PASS로 계산하지 않는다. 자세한 실패·수리 과정은 [정리 전 검증 전문](../archive/documentation-cleanup-2026-10-25/validation.md)에 있다.

## 기동 시간의 마지막 측정 (2026-10-25)

같은 설치·프로젝트에서 통제한 전후 각 3회 중앙값이다.

| 측정 지점 | 이전 → 개선 후 | 측정 경계 |
|---|---|---|
| 대화 화면 | 4.50 → 4.27초 | 실제 entry·PTY·SDK·Open TUI, local scripted provider, systemd 조작 차단 |
| 첫 provider 요청 | 4.77 → 4.54초 | 위와 같은 통제 환경. 실제 외부 provider 응답 시간 아님 |
| 저장소 준비 | 12.69 → 9.67초 | 별도의 실제 Git 준비 측정. Workers 최종 준비 시간 아님 |

VM을 포함한 전체 Society 시작 시간은 측정하지 못했다. 서로 다른 측정값을 더해 전체 시간으로 표시하지 않는다. 원시 입력·로그·실패·검증 판정은
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/verification-result.json`에 있다.

## DR48 입력의 실제 환경 검증과 당시 한계

| 항목 | 현재 판정 |
|---|---|
| 현재 코드의 실제 Linux 서비스/cgroup qualification | NOT_RUN. local runner에서 별도 제외한 suite이며 private bwrap overlay로 대체하지 않음 |
| native macOS·Swift helper·VM·Keychain·APFS | NOT_RUN. 이 저장소에 설치 가능한 OMA.app/guest image 배포물 없음 |
| 현재 코드의 실제 provider turn·release qualification | NOT_RUN. scripted/loopback 검사는 외부 서비스 증거가 아님 |
| 실제 power-loss 내구성 | NOT_RUN. SIGKILL·in-process fault 결과와 구분 |
| 실제 manager/cgroup candidate 검사·reviewer shortage 예외 | 기존 독립 거절의 영향이 남음. fixture 성공으로 실행 지원을 주장하지 않음 |
| 선택적 notmuch·reflink·fresh verifier 및 모델 품질/비용 우위 | 활성 구현이나 비교 실험이 확인된 기능으로 표시하지 않음 |

DR48은 ACL/xattr·special file·nested mount·읽을 수 없는 파일·복원할 수 없는 소유권이 있으면 회수를 거부하고 원본을 남긴다. 도구·키·checkpoint·closed DB identity가 확인되지 않는 cold 세션은 시작하지 않는다. Restic의 과거 snapshot을 자동 prune하지 않으므로 고유 데이터의 누적은 남는다. 상세 사용법은 [operations](../operations.md)가 소유한다.

과거 kernel/crash·provider 실행 기록은 해당 당시의 입력에 대한 기록이다. 현재 입력의 미실행 범위를 그 기록으로 닫지 않는다. 측정용 임시 VM은 제거됐고 전체 VM+Society 시간 결과는 없다.

## 문서 정리의 검증 (2026-10-25)

| 검사 | 결과 |
|---|---|
| 전체 정적 gate `npm run check:architecture` | PASS. workspace·legacy·source inventory·architecture rule·transaction·durable boundary·문서·spec 검사 위반0 |
| 문서·trace·inventory·decision·review closure·verification policy 회귀 | **77/77 PASS**. fail/cancel/skip/todo0 |
| 위 두 실행의 입력 | 15674개, `2f870978ea6dbbb62e8b666d0d8bb29b9ce9a496ef4efda8ac66bb6ac3a1e8b6`. 각각 실행 전후 변경0 |
| 보존 확인 | 원문 사본13개·기존 archive·architecture·PRIORITY-0·review-notes bytes 일치. 규범 조항375개 fingerprint 동일 |
| 변경 범위 | 문서만 변경. production code·schema·설정·권한·기계 판독 map 변경 없음. 전체 runtime suite 재실행은 NOT_RUN |

결과를 기록하기 전 입력의 원시 로그와 상태는
`/home/dev/oma-audit-artifacts/documentation-cleanup-2026-10-25/`의 `architecture.log`, `documentation-tests.log`, 각 `*-before.json`/`*-after.json`/`*-status.json`이 소유한다. `preservation.json`은 문서 원문·규범·보호 파일·코드 입력의 보존을 확인한다. 이 결과를 인계·validation에 기록한 뒤의 입력 차이와 재검사는 같은 디렉터리의 `post-check-input-relation.json`, `final-documentation-checks.log`, `verification-result.json`에 구분한다. 정적 검사는 실제 플랫폼 qualification이 아니다.

정리 전 인계·검증·감사·계획 원문은 [보관 색인](../archive/documentation-cleanup-2026-10-25/README.md)에 있다. 문서를 옮겨도 요구 ID·수용 번호·과거 실패·검토 판정은 유지한다.

## Worker 조립 후속 — 2026-10-27

공통 ExecutionStaging·closed developer launch codec·Mac Worker effects 주입과 explicit Broker→
Runner 전달을 구현했다. 실제 Linux App launch factory 회귀2개와 required Darwin Worker
bootstrap/tools fixture를 추가했다. Mac32종×3회, OS별96회는 모두 NOT_RUN이다. 현재 production
preload의 native guard를 우회하지 않으며 이 거절은 성공한 부팅으로 계산하지 않는다.

첫 입력695ec0dd…(15646개)의85/86 실패는 private staging 목적을 durable slot으로 잘못 사용한
반례다. 기존 preparation slot을 사용하는 source 수정 뒤79eae61b…의86/86·root strict가 통과했고
각 입력 전후와 보호4개가 같다. 원시 checks-1/·checks-2/를 보존한다.

후속 fixed-worker 입력 `ffad23c9cfdbcf30abfc478907474089e36b17704017821df112dfcedacc552d`
(15648개)에서 관련189/189·contract mutation7/7, root strict·전체 구조 검사가 통과했다. 전후 입력과
보호4개 SHA가 같으며 skip/cancel/todo/fail0이다. 이 입력은 아래 추가 겹침 수리 전의 결과다.

최종 검토에서 private state 안쪽의 readonly 형제 경로를 installation/package/Node/developer로
선택하는 네 반례를 추가했다. 기존 policy의5/9·실패4를 private-state-overlap-red.log에 보존하고
양방향 겹침 거절로 source를 수리했다. 후속 실행과 최종 구조 결과는 같은 audit 디렉터리에 입력별로
남긴다. raw root는 /home/dev/oma-audit-artifacts/native-2026-10-27-worker-bootstrap/이다.
CI의 workspace-only build 뒤에 root test fixture를 참조하는 불일치도 확인했다. 실제 root dist를
보관해 없는 상태에서 두 consumer의 module-not-found 실패를 보존했고, common CI가 전체
installation/test graph를 빌드하도록 수리했다. root dist가 없는 상태의 실제 build와 workflow에
적힌 그대로의 Node test 명령을 별도로 검증한다. Mac helper job은 workspace build를 유지한다.

이 기록은 전체 Linux suite·현재 packed install·Darwin kernel·power-loss·제품 지원의 PASS가 아니다.


겹침과 CI build prerequisite 수리 뒤 최종 고정 입력 `f370df2f90d8fc5662cc2eb488f0e186a6151b261edfe7357b3989627d47f7d1`
(15648개)에서 관련194/194·contract mutation7/7·root strict·전체 구조 검사 PASS를 확인했다.
같은 입력에서 workflow에 적힌 그대로의 Node 명령은 공통194/194·Linux native leaf3/3·실제
Linux execution46/46 PASS다. 서로 다른 실행을 합산하지 않으며 모두 fail/skip/cancel/todo0이다.
입력 전후와 보호4개 SHA가 같고 fixed-worker-final/summary.json·final-runtime-counts.json이 소유한다.
root dist가 없는 상태의 실제 full build도 exit0이며 겹침 반례는 동일 test SHA로5/9→9/9다.
마지막 문서 결과 기록 이후 입력은 구조 검사로만 별도 결박하며 runtime 결과를 재결박하지 않는다.

## HostConfig 4 형식 전환 — 2026-10-27

[DR60](../design-revisions.md)은 HostConfig 4에서 Linux 전용 rootfs/mount/backend 설정을
제거하는 명시적 형식 경계다. SandboxHost·RunnerConfinement·GitPaths도 같은 공통 설치
계약을 사용하고 Linux adapter가 trusted state root 아래 rootfs와 별도 OS mount를 선택한다.
현재 native interface golden은 SandboxHost 한 항목만 의도적으로 바꿨다. 역사적 golden·
architecture·authored review는 보존하고 accepted plan/receipt·DB·managed journal bytes는
변환하지 않았다. 실제 이전 설정의 loader/editing/project reader 거절 전후 bytes·inode·
mode·size·mtime·ctime와 sidecar/primary 보존을 검사한다.

초기 관련 입력 ce163b42…(15651개)의247/250·기대 불일치3개를 보존했다. version/error/
Dashboard 정책 기대를 수리한 입력
`abbe06b7b1e67b6c52113e4c4109304f0aaf28004f56596d979f5dc042058c5c`에서250/250 PASS,
skip/cancel/todo/fail0·전후 입력 동일이다. 이것은 부분 관련 실행의 결과다.

첫 전체 입력 `44bcdcbca8ecdadc043b99712165184834bf6dd0402e839be5052c7fd840d42b`
(15651개)은 root strict·전체 구조 검사 PASS였지만 local serial13/13·parallel3859/3883,
실패24개로 전체 exit1이었다. 이전 rootfs shorthand가 남은 audit fixture5개, 새 developer-tools
의존성이 빠진 Broker 조립 fixture17개, 의도한 SandboxHost 기준값1개, required AV27 이름1개다.
같은 입력의 독립 tarball 설치는26/26·자체 선언/import와 지정 runtime smoke PASS다.
외부 SDK declaration 진단은 일부 closure에서44개이며 자체 선언 오류와 구분한다.
이 packed 결과를 이후 입력으로 재결박하지 않는다.

수리 중 입력3b000ef2…의관련81/82·실패1도 보존한다. 조립 fixture의 가상 host PID를 없애는
과정에서 전달값 단언을 누락했고 실제 process.pid의 데이터 전달로 수리했다. 이는 credential·
host identity·scope 사망 증명이 아니다. f68dcf76…의Broker 조립18/18 PASS 뒤 전체를 재실행했다.
실행하지 않는 physical port는 throw하고 실제 process.platform을 사용하며 성공 no-op 후보
checker 중복 fixture를 제거했다. required 이름과 강한 원래 단언은 유지했다.

최종 runtime 입력 `f68dcf7688b61455d90f61b3b0f4b4cf96f3f353531c84288206776dd72fd2d1`(15651개)에서
root strict·전체 구조 검사와 전체 LOCAL **3896/3896 PASS**를 확인했다.
serial13/13·parallel3883/3883, fail/cancel/skip/todo0이며 전후 입력과 보호4개 SHA가
같다. 전체 discovery는473개 파일로 유지했다. 실제 Linux UID1000·CapEff0·pinned bwrap0.12.0/
Node26의 /usr/bin overlay profile이며 OS/PID/kernel 사실을 대체하지 않았다.
raw root는 `/home/dev/oma-audit-artifacts/native-2026-10-27-config-format/`다.
`broad-initial/`, `contract-repairs/`, `contract-repairs-final/`, `broad-repaired/`와
`whole-runtime-counts.json`이 각 실패·수리·범위와 정확한 command/종료/입력을 소유한다.

결과 기록 뒤의 문서 입력은 final-documentation/에서 별도 구조 검사로 결박한다.
이 Linux local/packed 결과는 실제 Darwin·service·paid provider·power-loss qualification의
PASS가 아니다. Darwin32종×3회, OS별96회는 NOT_RUN이고 세 native gate와 Mac 제품 guard는
유지한다. 유료 Mac CI 실행과 master 병합·배포는 하지 않았다.

## FD capability의 실제 관측 준비 — 2026-10-27

Darwin baseline에 file-descriptors case를 추가했다. `/dev/fd` open과 public fileport를 독립
cursor 재열기·정확한 exec로 가정하지 않고 inode·flags·원본/복제 cursor·errno·미시도 값을
관측한다. 실제 private image와 교체 image는 서로 다른 표식을 reply pipe로 보내고 자식은
waitpid로 회수한다. linked/rename/unlink 상태의 FD alias 실행과 이름 교체 대조군을 구분한다.
SDK header/API 부재를 성공으로 채우지 않으며 exit0 하나를 원래 image의 실행으로 해석하지 않는다.

소비자 조립 후 runtime 입력 `76483eecaa1990b0562c2cd21b86567b4aaeaa694d0a218eb7b084d0ccb3f05b`(15656개)에서
CI에 적힌 그대로의 공통 Node 명령225/225·검증 정책35/35·전체 구조 검사 PASS다.
각 실행은 fail/cancel/skip/todo0이며 입력·26 workspace의빌드 산출물15400개와 보호4개 SHA가
전후 같다. 실제 Linux UID1000·CapEff0·Node26·pinned bwrap overlay다. C helper의Linux 관측은
Darwin 실행으로 집계하지 않는다. 실제 common log에 inode/flags/offset/exec 표식 원문을 남겼다.
처음3b2d281b…의225/225·35/35 결과도 별도로 보존하며 합산하지 않는다.

실제 disposable C source 변형3개를 컴파일·실행했다. FD alias를 교체된 이름으로 바꾸는 변형과
독립 open을 dup으로 바꾸는 변형은 producer가0으로 끝나도 실제 CI와 같은 oracle consumer가
거절했다. 표식 없이0으로 끝나는 image는 native positive control에서 거절했고 partial record도
consumer가 거절했다. 동일 canonical header SHA의positive 실행과 mutant SHA/원시 exit/stdio를
negative-controls/에 보존한다. OS/PID/scope 사실은 대체하지 않았다.

원시 root는 `/home/dev/oma-audit-artifacts/native-2026-10-27-file-descriptors/`다.
checks-final/summary.json·final-runtime-counts.json과 negative-controls/consumer-results.json이
각 입력·실행·반례의 범위를 소유한다. 결과 기록 뒤 문서 입력은 final-documentation/의별도
구조 검사로 결박한다. authored production은 이 변경에서 바꾸지 않았으며 이전 전체 Linux
3896/3896·packed26/26을 새 검증 입력에 재결박하지 않는다.

required Darwin은33종×3회·OS별99회, 전부 NOT_RUN이다. 기존240분 budget은 유지했고
유료 Mac CI 실행·master 병합·배포는 하지 않았다. G-PROCESS/G-FILES/G-AUTH는 계속 OPEN,
product guard는 그대로다. 이는 Mac implementation/qualification 완료가 아니다.

게시 전 공백 검사에서 새 테스트 EOF의추가 LF 한 개를 제거했다. 본문은 동일하며 거절 원문과
bytes 관계는 candidate-guard-failure.json에 보존한다. 최종 runtime 입력
`ead1b9960c28b0a8ef0bd2eaf8bead7f883763099aa28d6c57dcd71fea3c099e`(15656개)의공통225/225·정책35/35·전체 구조 검사도
PASS, 전후 입력/빌드 산출물/보호4개 동일이다. checks-post-format/과 post-format-runtime-counts.json이
소유하며 최종 문서 구조 입력은 final-documentation-post-format/에서 별도로 검사한다.

## Darwin 실행기의 공개 FD 상속 API 수정 — 2026-10-27

Linux에서 Darwin 대상으로 컴파일하는 동안 production Seatbelt의 `closefrom` 호출이
SDK15.5·26.5의 ARM64·x64 네 조합에서 모두 선언 부재로 실패했다. 기존 Linux 실행 시험은
glibc의 동명 함수를 사용했으므로 이 Darwin 빌드 오류를 발견하지 못했다. 최초20개 object의
16개 성공·4개 실패와 linker sysroot 설정 실패 원문을 별도로 보존했다.

실행 leaf는 공개 `posix_spawn`의 `POSIX_SPAWN_SETEXEC | POSIX_SPAWN_CLOEXEC_DEFAULT`와
`posix_spawn_file_actions_addinherit_np`로 바꿨다. 표준 stream과 명시한 kept FD만 전달하며
실패 시125로 끝낸다. 일반 exec로 되돌아가는 경로는 없다. 같은 PID의 image 교체와 kernel의
FD 상속 처리는 [Apple XNU 구현](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c),
CLOEXEC_DEFAULT·inherit 사용은 [libuv 구현](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/process.c)과 대조했다.
이 source 대조는 실제 Darwin 실행 결과가 아니다.

Zig0.17.0/LLVM22.1.8과 pinned SDK mirror snapshot의15.5·26.5를 사용한 ARM64·x64
교차 컴파일28/28·SDK stub library 링크28/28이 성공했다. production 실행기와 실제 Darwin용
FD 대조 프로그램을 포함한다. compiler/SDK는 저장소 밖 보조 도구이며 제품 의존성에 추가하지
않았다. 이는 Linux host에서 만든 Mach-O의 정적 검증으로, Apple runner의 실제 SDK·kernel
실행·release 서명 또는 Homebrew dylib qualification을 증명하지 않는다.

공통 시험은 production kept-list의 문법만 독립 검사한다. Darwin 시험에는 동일 PID 확인,
soft/hard FD 한도를16으로 낮추기 전에 연 FD64의 제거, CLOEXEC가 설정된 표준 stream·FD6/8
유지, 빈 keep-list, 없는 channel·target의 실패를 추가했다. 기존 실제 leak 대조군은
CLOEXEC_DEFAULT를 제거한 private helper로 갱신했다. 필수 관측 값이 빠진 record를 거절하는
새 회귀는 수정 전28/29·수정 후29/29였고, 별도 parser와 함께30/30이다. record 문법용
입력은 kernel 관측으로 사용하지 않는다. 새 Darwin 실행 대조군 자체는 NOT_RUN이다.

runtime 입력 `6570c49e25e84d04517d9fc7102e65f4d7db7eca6d7c8654702d024e6e2f13a6`(15657개)에서
CI의 공통 명령226/226·검증 정책35/35·전체 구조 검사 PASS다. fail/cancel/skip/todo0이고
입력·26 workspace의 빌드 산출물15400개·보호4개 SHA가 전후 같다. full build와 strict typecheck도
성공했다. 과거 전체 Linux3896/3896·packed26/26을 이 입력의 결과로 다시 표시하지 않는다.

원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-darwin-crosscompile/`의
sdk-objects-initial/·sdk-objects-repaired/·sdk-linked/·metadata-build/·checks/가 소유한다.
문서 기록은 별도 입력의 구조 검사로 결박한다. Mac33종×3회·OS별99회는 NOT_RUN이고
G-PROCESS/G-FILES/G-AUTH와 제품 진입 guard는 그대로다. 유료 Mac CI는 실행하지 않았다.

## Node POSIX 프로세스 그룹 실행 leaf — 2026-10-27

`startProcess`의 processGroup 옵션이 Linux만 허용하던 부분을 Linux·Darwin 지원 표로
연결했다. Node26의 [detached 계약](https://nodejs.org/download/release/v26.0.0/docs/api/child_process.html#optionsdetached)과
[내장 libuv 구현](https://github.com/nodejs/node/blob/v26.0.0/deps/uv/src/unix/process.c)을 대조했다.
Darwin의 POSIX_SPAWN_SETSID 경로를 그대로 사용하며 제품용 native helper를 추가하지 않았다.
기존 실행 수명·결과 분류·FD 전달 owner를 사용한다.

실제 POSIX C 관측 프로그램은 자손을 만들지 않고 자기 PID·group·session과 받은 FD3의
inode를 출력한다. 공통 CI와 kernel/platform lane에 정상 실행, 취소 뒤 실제 child/stdio close,
deadline 뒤 close, 명시 FD의 동일 inode 네 시험과 required name을 넣었다. 일반 실행의 group
상속도 대조한다. 현재 Linux UID1000·CapEff0·Node26·pinned bwrap overlay에서 실제로 실행했고,
Node의 detached 설정만 끈 disposable JS 변형은 같은 첫 시험에서 실패했다. canonical JS와
시험 bytes는 바꾸지 않았다. 변형 실행의 이름 필터로 제외된 시험은 성공으로 세지 않는다.

입력 `f2afe6609fb3297d68499aae8c6cfbbfdc66b47ecbdfb480ca0d00da909a5264`(15659개)에서
CI의 공통 명령230/230·기존 async/stdio 회귀24/24·검증 정책35/35·전체 구조 검사 PASS다.
각 정상 실행은 fail/cancel/skip/todo0이며 입력·26 workspace 산출물15400개·보호4개 SHA는
전후 동일하다. full build와 strict typecheck도 성공했다. 새 C 관측 프로그램의 SDK15.5·26.5,
ARM64·x64 교차 컴파일·stub 링크4/4는 별도의 정적 결과이며 실제 Darwin Node 실행이 아니다.

원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-posix-process-groups/`의
metadata-build/·sdk-fixture/·checks/·negative-control/가 소유한다. 문서 기록 뒤에는 별도 입력의
구조 검사로 결박한다. 과거 전체 Linux3896/3896·packed26/26을 새 입력에 재결박하지 않는다.

프로세스 그룹은 임의 후손 fence나 전체 사망 증명이 아니다. PreparationExecutor의 Linux
제한과 App의 Darwin 실행 차단은 그대로이며, 이 leaf로 그 조건을 우회하지 않는다.
G-PROCESS/G-FILES/G-AUTH는 계속 OPEN이고 Mac99회/OS 및 새 공통 시험의 실제 Darwin 실행은
NOT_RUN이다. 유료 Mac CI는 실행하지 않았다. 저장소 전체 복잡도 점검은 사용자 지시에 따라
native 구현을 모두 마친 뒤 진행하며 이번 변경에 포함하지 않았다.

### Darwin 디렉터리 기준 확장 속성 관측

Darwin의 assertNoExtendedAttributesAt을 구현했다. 보유한 directory FD를 고정된 metadata
helper에 명시 전달하고, helper 안에서만 public fchdir 후 한 entry를 listxattr로 관측한다.
최종 symlink를 따르지 않고 compression 속성도 조회한다. Node host의 cwd는 바뀌지 않으며
대상 파일을 내용 I/O로 열거나 경로를 재구성하지 않는다. private pthread cwd SPI는 쓰지 않는다.
공개 계약은 Apple의 [fchdir](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/chdir.2)와
[listxattr](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/listxattr.2)를 대조했다.

빈 속성 목록만 허용하는 판정은 공통 TypeScript가 소유한다. helper 오류·signal·잘못된 출력은
빈 관측이 아니다. Linux leaf의 기존 ENOTSUP 처리는 유지하고 Darwin 오류를 같은 성공으로
확대하지 않았다. 고정 helper와 기존 Seatbelt 실행기는 같은 reviewed recipe 표에서 소유자·
source asset·출력·library를 선택하며 빌드 cache와 package URL 검사도 같은 표를 사용한다.

실제 host 시험은 zero-length 속성이 있는 파일의 보관, 빈 entry, parent rename과 원래 경로
교체, 속성이 있는 바깥 대상을 가리키는 symlink와 dangling symlink, 조회 실패를 검사한다.
실제 Linux에서 private reader를 symlink를 따라가도록 바꾼 변형은 같은 symlink 시험에서
실패했고 canonical 시험·built JS SHA는 동일했다. 이름 필터의 미선택 시험은 PASS로 세지 않는다.

입력 `44ce3f3a55b6a761bb771d8609df150d8804d9c37af6c81d0417aceb30c82018`(15666개)에서 공통 CI235/235,
정책35/35, 경계·spawn owner17/17, 전체 구조 검사와 packed26/26이 통과했다. 각 패키지의
public import·authored declaration을 확인했고 설치 후 실행 smoke 17개도 통과했다.
외부 SDK declaration 진단은 authored declaration 실패와 별도로 남긴다. 실제 Linux 시험은
UID1000·CapEff0·pinned bwrap overlay에서 실행했으며 입력·26 workspace 산출물
15405개·보호4개 SHA는 전후 동일했다. full build와 strict types도 통과했다.

처음 구조 검사는 신규 TS 파일 두 개의 semantic zone 누락을 거부했다. 그 실패 입력과
runtime 결과는 checks/에 보존하고, codec K1·OS mechanism K2 분류를 추가한 뒤 독립된
checks-final/ 입력으로 재검증했다. 오류 기록을 새 PASS로 덮어쓰지 않았다.

helper의 SDK15.5·26.5 × ARM64·x64 컴파일4/4와 stub 링크4/4는 Linux host의 정적 결과다.
실제 Darwin helper·새 host 시험은 NOT_RUN이며 유료 Mac CI는 실행하지 않았다. 원문은
`/home/dev/oma-audit-artifacts/native-2026-10-27-directory-xattrs/`가 소유한다. 문서 기록 뒤
별도 구조 입력을 결박하며 과거 전체 Linux3896/3896을 이번 입력으로 재결박하지 않는다.

이 구현은 한 entry의 metadata 관측이다. mode-000 pin·동일 inode 재열기·수리·실행 결박이나
G-PROCESS/G-FILES/G-AUTH 완료가 아니며 PreparationExecutor와 App의 Darwin guard는 유지한다.
전체 코드 복잡도 점검은 native 구현을 모두 마친 뒤에 진행한다.

### Darwin ACL·BSD flags와 보관 회수 거절

Spec §9.2의 ACL·BSD flags 관측을 metadata helper에 연결했다. inherited directory FD에서
child만 cwd를 바꾸고 public lstatx_np로 symlink 자체의 stat·security를 읽는다.
filesec_query_property(FILESEC_ACL)는 성공한 no-ACL 관측과 실패를 구분하며, entry가 없는
명시적 ACL과 그 flags도 보관 대상으로 남긴다. ACL entry 순회 실패의 EINVAL을 빈 ACL로
오해하지 않는다. 모든 BSD flag bit를 관측하고 xattr 조회에는 no-follow·show-compression을
유지한다. 대상의 content I/O open이나 경로 복원은 추가하지 않았다.

공개 SDK 선언과 Apple Libc `71bbe350ab79eef58113991d817ccc6165061a64`의
[lstatx_np](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/sys/statx_np.c)·
[filesec](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/gen/filesec.c)를
대조했다. private opaque ACL layout이나 추측한 syscall ABI를 사용하지 않는다.

보존하지 못하는 metadata가 있으면 공통 TS의 assertNoUnpreservedMetadataAt이 회수를 거절한다.
Linux는 기존 no-follow xattr 관측을 유지하고 Darwin-only 사실은 null로 구분한다. session cache
walker가 새 API를 직접 사용하며 이전 xattr-only 함수·helper 경로·decoder는 alias 없이 제거했다.
검증된 cold metadata DTO·hash·receipt·DB 형식은 바꾸지 않았다.

Darwin actual-host 시험 네 개를 공통 CI에 준비했다: BSD flag, extended ACL, flags가 있는 빈
ACL, 실제 resource fork다. 첫 세 경우에는 바깥 metadata 대상을 향한 symlink를 따라가지
않는지도 검사한다. C fixture는 실제 public API로 metadata를 만들고 관측자는 제품 helper다.
이 네 경우는 Darwin에서만 등록되며 이번 Linux 성공 수에 포함되지 않는다. 실제 Mac 실행은
NOT_RUN이다. Linux에서는 동일한 실제 symlink oracle이 private follow 변형을 거부했다.

입력 `41f1ea2c7d3b99e57694e47e72abf95f3996eea9ec6effdfb27d93177fbe9fa0`(15667개)에서 공통 CI235/235,
정책35/35, boundary·spawn owner17/17, session storage15/15, 전체 구조 검사와 packed26/26이
통과했다. hot 원본 보존·archive/restore·snapshot metadata 회귀를 실제 Linux에서 확인했다.
각 시험은 fail/cancel/skip/todo0이며 입력·26 workspace 산출물15405개·
보호4개 SHA는 전후 동일했다. full build·strict types도 통과했다. installed smoke는
17개 통과했고 기존 외부 SDK declaration44 진단은 authored 타입 성공과 구분한다.

제품 helper와 metadata setup C fixture 두 source를 SDK15.5·26.5 × ARM64·x64로 각각
컴파일·stub 링크했다(8/8·8/8). 이는 Linux host의 정적 결과이며 실제 ACL/flag 지원 PASS가
아니다. 원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-metadata-acl-flags/`가 소유한다.
문서 기록은 별도 구조 입력으로 확인하며 이전 단계 runtime PASS를 새 입력에 재결박하지 않는다.

GUARD_CLOSE의 후손 witness 가능성도 대조했으나 XNU의 API는 PRIVATE이고 guard가
close-on-fork를 강제하므로 채택하지 않았다. 해당 primary source는 rejected-guarded/에 남긴다.
G-PROCESS/G-FILES/G-AUTH, mode-000 pin·exact reopen/repair·실행 결박은 계속 미완료다.
App·PreparationExecutor의 Darwin guard를 해제하지 않았고 유료 Mac CI도 실행하지 않았다.
전체 코드 복잡도 검토는 native 구현·CI 준비를 모두 끝낸 뒤에 진행한다.

### Restic 설치 검증과 실행의 FD 결박

Spec §9.1에 따라 설치 스크립트의 checksum 검증 후 경로 재실행을 제거했다.
기존 설치와 신규 publication을 같은 FD 검증 경로에 모으고, 검증한 파일을 child FD3로
명시적으로 넘겨 기존 native execute leaf를 통해 실행한다. version 확인의 성공·실패 뒤
소유 FD를 닫으며 새 publication도 실제로 연 파일의 checksum을 다시 확인한다.
이 결박은 경로 교체·삭제의 실행 대상을 고정하며 파일 내용의 불변성을 주장하지 않는다.

[Node26의 FD 상속 계약](https://github.com/nodejs/node/blob/v26.0.0/doc/api/child_process.md#optionsstdio)과
[Linux의 검증 후 실행 경합 설명](https://man7.org/linux/man-pages/man3/fexecve.3.html)을 대조했다.
새 OS adapter나 경로 fallback을 추가하지 않았다. Darwin exact execute는 계속 미해결이며
이 Linux 결과를 Mac 지원·실행 검증으로 해석하지 않는다.

실제 pinned Restic과 구별되는 C 실행 파일을 사용한 Linux oracle8/8이 통과했다.
기존·신규 설치의 실행 직전 교체, link count0의 실제 unlink, publication 직후 교체의
checksum 거절, 기존 불일치 파일 보존, mode000 복구, 실제 EACCES 뒤 FD 반환,
불일치 archive 거절을 확인했다. 다운로드 fixture는 실제 pinned archive와 byte-for-byte
같은 bzip2 재압축 bytes를 제공하며 kernel·프로세스 결과는 대체하지 않는다.
동일한 최종 oracle은 격리한 수정 전 installer의 경로 실행을 실제로 거절했다(6실패·2통과).
Linux kernel/full lane의 필수 실행 이름과 Linux native CI에 연결했다.

입력 `d5f1bce12e2f39ffd182f3e9dc0afe25ab46897222c0dc6ea7f33251f4169589`(15670개)에서 위8/8,
공통 CI235/235, 정책35/35, boundary·owner17/17, session storage15/15 및 전체 구조 검사가
통과했다. build·strict types도 통과했다. 입력·workspace 산출물15405개·
보호4개 SHA가 전후 같고 inventory·dependency graph·authored review 상태는 바뀌지 않았다.
이 변경은 root installer·test·CI 범위라 workspace packed26 재시험은 하지 않았으며 이전
packed PASS를 새 입력의 결과로 재결박하지 않는다. 문서 기록은 별도 입력으로 구조 확인한다.
원문은 `/home/dev/oma-audit-artifacts/native-2026-10-27-restic-setup-exec/`가 소유한다.

유료 Mac CI는 실행하지 않았다. G-PROCESS/G-FILES/G-AUTH와 Darwin 제품 guard는 유지한다.
전체 코드 복잡도 정리는 native 구현·CI 준비를 모두 마친 뒤에 진행하며 아직 착수하지 않았다.

### Restic dump hardlink의 실제 데이터 근거

Spec §9.1의 hardlink 검증에서 source metadata 일치만으로 수락하던 구멍을 수정했다.
자기 자신·아직 나오지 않은 파일·데이터가 없는 순환 link는 검증된 payload를 대신할 수
없다. 현재 header는 종류·metadata·link를 검증한 뒤 seen에 넣고, hardlink는 앞서 수락한
파일만 참조하게 했다. 다음 header에 도달하기 전에 앞 파일의 payload hash가 확인되므로
추가 graph나 상태 없이 정상 link chain의 데이터 근거가 이어진다. 빈 파일도 같은 규칙이다.

고정 [Restic0.19.1 dump writer](https://github.com/restic/restic/blob/6aa3a516ce654808a1f28f9fa21e9b7c8e6e90bf/internal/dump/tar.go)를
대조했다. 이 writer는 file node마다 regular payload를 출력하므로, 실제 dump가 tar hardlink
header를 만든다고 주장하지 않는다. 기존 OMA의 hardlink grammar에는 정상 이전 참조를
유지하면서 데이터가 없는 그래프와 PAX linkpath의 자기 참조를 거절하는 독립 반례를 추가했다.
일곱 parser 사례는 다양한 chunk 경계, 정상·빈 payload chain과 malformed tar bytes를
검사한다. 동일한 최종 oracle은 격리한 수정 전 compiled verifier에서 실제로 실패했다
(2실패·5통과). 이는 parser 반례이며 Darwin kernel 관측을 흉내 낸 시험이 아니다.

입력 `100f081eb9fbe7b1012572725a0370fc4eabf019adf031acbcf633ccc0d8403e`(15670개)에서 parser7/7,
이를 포함한 공통 CI238/238, 정책35/35, boundary·owner17/17, 실제 pinned Restic의
Linux session archive/restore15/15, 전체 구조 검사, packed 설치26/26이 통과했다.
build·strict types도 통과했다. 각 시험의 fail/cancel/skip/todo는0이며 입력·현재 workspace
산출물15405개·보호4개 SHA는 시험 전후 같았다. parser 구현이 바뀌었으므로
이전 workspace output PASS를 새 결과로 재사용하지 않았다. installed runtime smoke는
17개가 통과했고 외부 dependency declaration 진단은 authored 타입 검사와 구분했다.

platform/full lane은 세 새 oracle 이름을 필수로 요구한다. G-PROCESS/G-FILES/G-AUTH는 미해결이며 제품 Darwin guard를 유지한다. 현재 실제 Darwin은
NOT_RUN이며 유료 Mac CI도 실행하지 않았다. 원문은
`/home/dev/oma-audit-artifacts/native-2026-10-27-restic-hardlink-proof/`가 소유한다.
문서 기록은 별도 입력으로 구조 확인하며 위 runtime PASS를 문서 입력에 재결박하지 않는다.
전체 코드 복잡도 정리는 native 구현·CI 준비를 모두 끝낸 뒤에 진행하며 아직 미착수다.

## 검증 입력과 LOC

아래 값은 **구조 검사의 현재 입력 identity**다. digest 생성은 runtime PASS를 만들지 않는다.

verification input digest `02b978713b8a956c4c24d7c701581889c5fc66f7a1e2af7525628beacb2bbab5` (15775 files).

현재 source 목록은 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. `npm run check:inventory`는 cloc 없이 source bytes를 확인한다. `npm run evidence:refresh`의 구조 재생성과 실제 runtime 실행은 별도다.

이전 기록의 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 문서 정리로 새 측정치를 만들지 않는다. DR46 마지막 LOC 시도는 같은-source 반복 결과 불일치로 UNRELIABLE이다. 유효한 최종 LOC·감소율은 주장하지 않는다.

현재 LOC 측정의 경로는 `node scripts/loc.mjs --out <evidence-directory>`가 생성·검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`이다. 생성기는 committed source digest를 먼저 확인하며, source/tool/report의 불일치를 손으로 고치지 않는다. 크기 상한은 없다.

## 재검증 명령

명령의 실제 정의는 [package.json](../../package.json), 요구 범위는 [verification-spec](../verification-spec.md)이 소유한다.

```sh
npm run check:documents
npm run check:spec-inventory
npm run check:inventory
npm run check:architecture
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs test/production-inventory.test.mjs
```

코드 변경이 있으면 해당 lane을 추가한다. 실제 환경이 필요한 suite는 지원·허용 환경에서 실행하고, 미실행은 NOT_RUN으로 기록한다.
