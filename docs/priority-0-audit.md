# Priority 0 파일 단위 점검 기록

이 문서는 **점검 기록**이다([문서 지도](README.md)). [PRIORITY-0.md](PRIORITY-0.md)의 적용 절차가 요구하는 기록이며, 다음 점검도 새 파일을 만들지 않고 이 문서를 갱신한다.
여기의 판정은 각 기준점의 코드에 대한 것이다. 지금의 검증 상태와 수치는 [validation.md](implementation/validation.md)가 소유한다.

## DR46-F05 — arrival 부분 쓰기의 배달 완료 승격 (2026-10-24)

수정 전 실제 owner: `src/mail/materializer.ts#MailMaterializer.recordArrival`의 단일 writeSync가
반환한 byte 수를 확인하지 않았다. 실제 send가 부분 arrival을 남기고 succeeded/materialized=1로
끝나는 것을 재현했다. 0-byte 쓰기도 성공으로 승격됐다(P0-5/7). 부분 append에서 실제 SIGKILL한
뒤 복구하면 미완성 숫자 tail과 새 timestamp가 붙어 유효한 arrival을 만들지 못했다.
`mail-arrival-short-write-reproduction.log`와 수정 전 `mail-arrival-before-final.log`의
정상1 PASS/음성3 FAIL이 원시 근거다. 입력15,530개 `8f56c06b…`, 변화0.
첫 시험 초안의 timestamp oracle는 safe integer를 검사하지 않아 kill 사례를 놓쳤다. 그 원시
`mail-arrival-before.log`(1 PASS/2 FAIL)도 보존하고 oracle를 실제 reader의 숫자 조건으로 강화했다.
수정 결정은 DR46이며 현재 실행 판정은 validation이 소유한다.

수정 owner는 storage/arrival-journal의 appendMailArrival이다. pinned regular append 파일을
소유 primitive로 열어 owner bits만 더하고, 부분 쓰기는 계속하며0-byte는 거절한다. 미완성
tail 뒤에는 newline을 먼저 두고 file/parent를 flush한다. 수정 후130개 집중 중 실제4개
arrival/복구와4개 owned inode 거절·수리 시험이 통과했다. 범위와 입력은 validation이 소유한다.

## DR46-F02 — vendor 검증 대상과 실제 load 대상 불일치 (2026-10-24)

상태: **REPRODUCED_LOCAL**, 수정 전 기록. 임시로 복사한 실제 LSP registration API에서
`bundleDir`로 정상 probe를 검증하게 하고 owner 내부 command.js를 변조했다.
실제 owner를 직접 검증하면 거절됐지만 registerLspTools는 변조 모듈을 평가하고 세 도구를
등록했다. 단순 파일 존재나 코드 추측이 아닌 실제 entry 실행이다. 의존은 명시적으로 현재
제품 설치에 연결했고 systemd/provider 실행은 아니다.
원시 근거 `vendor-owner-mismatch-repro.json`과 `reproduce-vendor-owner-mismatch.mjs`는
외부 modularization-2026-10-23 디렉터리에 보존한다. 재현 entry SHA는
`84c268ce6a00d4e998b33e2d4070a3d397a14eba1aede064537c5040e68299e1`이다.
추가 실제 등록 오라클 `vendor-owner-binding-before.log`는 네 tool 모두에서 변조 모듈 평가와
도구 등록을 재현했다(0 PASS / 4 FAIL, 입력 `aa989840…`, 변화 0). 수정 뒤 같은 오라클이
거절을 확인해야 한다. 과거 실패 근거는 보존한다.

판정: 한 디렉터리를 검증한 관측을 다른 디렉터리의 바이트가 검증된 사실로 사용했다(P0-1/2/5).
현재 제품이 쓰지 않는 bundleDir override를 제거하고, registration은 실제 import하는
owner-local bundle만 검증한다. 테스트 전용 override를 다른 이름으로 남기지 않는다.
실제 owner 파일을 변조하고 별도의 정상 probe를 제공해도 모듈 평가·도구 등록 이전에
거절하는 negative oracle를 네 tool 모두에 추가한다. 이전 양성 설치 검증을 수정 후의
증거로 승격하지 않으며 현재 판정은 validation이 기록한다.

수정 오라클: bundleDir override와 빈 WebToolsOptions를 제거한 뒤 같은 실제 owner 시험 네 건이
모두 거절을 확인했다. `vendor-owner-final.log`의 219/219 중 이 네 건은
payload 평가 false·등록 0·거절 exit 1이다. 현재 실행 범위와 입력 identity는 validation이 소유한다.

## 수정 재검증 — 2026-10-09 (DR36)

사용자가 전체 수정·검증·푸시를 지시했다. 아래 2026-10-08의 13개 OPEN과 결함 재현 evidence는
당시 바이트의 역사적 기록으로 보존한다. 현재 수정은 [DR36](design-revisions.md), 예상 밖 제한은
[user expectation ledger](user-expectation-ledger.md), fresh 실행 결과는
[validation](implementation/validation.md)이 소유한다. 이번 수정도 서브에이전트 없이 직접 수행했다.
현재 local suite 3,938 PASS, native kernel 65 PASS, SIGKILL·재시작 복구 63 PASS다.
입력 바이트·명령·실행 범위는 [수정 evidence](../test/audit/repairs-2026-10-09.evidence.json)에 있다.
Society 화면은 2.93~2.99초지만 최초 실제 권한 준비는 14.47~14.67초여서 전체 5초 목표는
여전히 미달이다. 이 목표를 아래 결함 수정 상태와 별개로 남긴다.

| 발견 | 수정과 재검증 | 현재 판정 |
|---|---|---|
| AV-20261008-01 | FD에 고정한 owned 순회에서 read/search만 수리하며 0555 봉인 보존, hardlink 중복 과금 방지; close 실패·재시작 회귀 | FIXED |
| AV-20261008-02 | 공개 Pi storage/factory로 OMA-owned lock 통일; trusted 프로젝트에는 Pi의 공개 file lock; 실제 CLI 경쟁 회귀 | FIXED |
| AV-20261008-03 | 교체 횟수만으로 살아 있는 reader의 세대를 삭제하는 GC 제거; 실제 import reader의 자원 보존 | FIXED; 디스크 보유 증가 명시 |
| AV-20261008-04 | 출력 보관량과 실행 중단 분리, 초과 stdout/stderr도 배출하며 정상 완료 확인 | FIXED |
| AV-20261008-05 | 실제 kernel page size에 따라 내려간 memory.max 비교; native cgroup 검사 | FIXED |
| AV-20261008-06 | 단일 monotonic timer로 native interval 분할; 설정 파생까지 안전 정수 검사 | FIXED |
| AV-20261008-07 | 등록을 기다린 뒤 freeze/send, 종료·취소 시 회수; 실제 첫 tool이 정확히 한 번 성공 | acceptance unknown 결함 FIXED; 전체 5초 목표 미달 |
| AV-20261008-08 | 종료된 read fd를 poll에서 제외; production C의 실제 socketpair idle·정상 종료 검사 | FIXED; native VZ 미실행 |
| AV-20261008-09 | preparation의 독립 120초 총량 제거; 상위 취소와 실제 close·상속 lease로 수명 관리 | FIXED |
| AV-20261008-10 | 진행 중 scan만 공유하고 entry마다 event loop 양보; 실제 30,000개 파일과 동시 예약 회귀 | FIXED |
| AV-20261008-11 | 문자열 경로 provenance를 symbol alias와 local callee까지 추적; 이름만 다른 positive/negative 회귀 | FIXED within static scope; dynamic call 증명 한계 명시 |
| AV-20261008-12 | 공개 Pi getSupportedThinkingLevels 사용 | FIXED |
| AV-20261008-13 | 효과 전에 shared index codec·세대 이름·before-image 검증; 손상 입력의 zero-effect 회귀 | FIXED |

추가 발견: **AV-20261009-01** — 직접 의존한 nodemailer 10.0.1에 addressparser의 알려진
quadratic DoS가 포함되어 있었다. [upstream advisory](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-prgh-xp8r-p3m5),
[별도 fallback advisory](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-v53p-9fqp-m79j)를 확인해
10.0.16으로 고정했다. OMA의 stream transport와 주소 생성 경로를 검토했으며, 일반 SMTP/외부
mailparser 공격을 OMA에서 실제 재현한 것으로 확대하지 않는다. 기존 MIME/frozen-fact 회귀
24개(수정 회귀 포함) PASS, 패치 후 npm audit 알려진 취약점 0건이다.

수정 중에도 두 결함을 실제 검사에서 발견했다. Human Git의 local clone이 private index/stash
객체까지 복사하는 문제는 protocol clone과 packed private object 부재 회귀로 수정했다.
새 quota 관측이 0555 context revision을 0755로 바꿔 다음 broker 시작을 STORE_CORRUPT로
막는 문제는 native kernel lane의 첫 실행에서 확인했다. 관측은 read/search만 수리하도록
수정했으며, 첫 실패 기록을 보존하고 봉인 보존·native 재시작을 새 입력에서 재검증했다.

## 추가 적대적 감사 — 2026-10-08 시작, 2026-10-09 재현·기록

**당시 요청은 전체 감사와 기록만이었다.** P0, 내부 구현의 중복·과잉 설계·비효율, 숫자의 타당성,
이해되지 않는 로직에 중점을 두되 데이터 유실, 동시성, 권한·격리, 복구, 성능, 사용자 흐름,
플랫폼 통신, 검증 사각지대도 함께 살폈다. 문서를 먼저 읽고 실행을 측정했으며 서브에이전트는 사용하지 않았다.
이 pass에서는 production 코드와 기존 테스트를 수정하지 않았다. 아래 13건은 모두 **OPEN**이다.
10건은 실행으로 재현했고 2건은 정적 근거, 1건은 현재 동작 결함과 구별한 내부 중복이다.
여기서 P0-번호는 원칙이며, 심각도 P1/P2/P3와 다른 축이다.

기준은 HEAD `0364e99cbbb07726097da2b923a03d185c8fcd73`과 시작 시간 수정이 들어 있는 미커밋 worktree다.
HEAD만으로 이번 판정을 재현할 수 없다. 실제 source·compiled owner·Pi 의존 바이트, 관측 결과와 범위는
[evidence](../test/audit/adversarial-2026-10-08.evidence.json), 수평 조사 범위는
[coverage](../test/audit/adversarial-2026-10-08.coverage.json)에 고정했다.
과거의 "수정됨", suite PASS, bound 문서의 분류는 현재의 안전성을 대신하지 않는다.

| ID | 심각도 | 근거 종류 | 문제 / 주요 축 |
|---|---|---|---|
| AV-20261008-01 | P1 | 실제 UID·filesystem | 손상된 owned 하위 디렉터리 하나가 quota 관측·broker 기동·새 admission을 막음 / P0-8 |
| AV-20261008-02 | P1 | 실제 OMA·Pi writer 교차 실행 | 서로 다른 설정 잠금으로 저장된 모델 선택 유실 / P0-2·동시성·중복 owner |
| AV-20261008-03 | P1 | 실제 archive/apply·로드된 확장 | 두 번의 패키지 교체가 살아 있는 reader의 세대를 삭제 / P0-4·자료 수명 |
| AV-20261008-04 | P1 | 실제 systemd/cgroup/bwrap check | 성공하도록 작성한 검사도 stdout 1 MiB를 넘으면 중단·unknown / 숫자·통합 가용성 |
| AV-20261008-05 | P2 | 실제 systemd/cgroup/bwrap check | 메모리 값에 1 byte를 더하면 커널 정렬 때문에 검사 실행 전 exit 125 / 숫자·오류 분류 |
| AV-20261008-06 | P2 | 실제 config validator·지원 검사 | 검증된 check deadline을 broker 지원 검사가 거부 / 검증 경계·숫자 |
| AV-20261008-07 | P1 | 실제 PTY·bundled Pi·scripted model | 5초 안의 대화에서 첫 Society tool은 acceptance unknown / 시작 수용 기준·사용자 흐름 |
| AV-20261008-08 | P2 | production C relay·socketpair | 한 peer 종료 후 반대편이 열려 있으면 유휴 CPU spin / 통신·종료 로직 |
| AV-20261008-09 | P2 | 정적 호출 관계 | 준비 child의 고정 120초가 내부 Git의 600초 허용을 자름 / 숫자·가용성 |
| AV-20261008-10 | P2 | 실제 quota owner·30,000파일 | 매 admission의 전체 동기 walk가 broker event loop를 막음 / 내부 효율·성능 |
| AV-20261008-11 | P2 | 정적 규칙·실제 gate 실행 | owned-state 이름 휴리스틱이 위반을 놓쳐도 architecture rule PASS / P0-7·검증 사각지대 |
| AV-20261008-12 | P3 | 현재 pinned Pi source 비교 | 공개된 thinking-level 계산을 내부에서 다시 구현 / 내부 중복; 현재 오동작 주장은 아님 |
| AV-20261008-13 | P1 | 손상 기록·실제 archive/apply | 복구 snapshot 검증 전에 세대 게시·선택·삭제 후 TypeError / P0-3·저장 경계 |

### AV-20261008-01 — quota walk가 owned 손상을 복구하지 않는다

[quota.ts](design-revisions.md#dr46--출시-전-레거시-제거와-workspace-분리) (당시 quota 경로, DR46에서 제거됨)의 `observedStorageBytes`는 pathname `lstatSync`/`readdirSync`를
직접 사용한다. root 아래 `opaque/fact`를 만든 뒤 `opaque`를 mode 000으로 바꾸면 UID 1001에서
관측·`startupState`·`admit` 모두 `BROKER_UNAVAILABLE`, 원인 `EACCES`이고 mode는 000 그대로다.
양성 대조에서는 같은 tree를 관측하고 startup이 admitted였다. [broker.ts](../apps/oma/src/entry/broker.ts):173의
startup probe 때문에 한 하위 entry의 권한 손상이 전체 broker 기동을 막을 수 있다.
unknown으로 거절하는 P0-5는 지키지만 owned 접근 primitive에 복구가 내장되어야 한다는 P0-8은 지키지 않는다.

재현: [quota-probe.mjs](../test/audit/adversarial-2026-10-08/quota-probe.mjs).
수정 방향은 최초 경로에서 몇 개 directory를 ensure하는 예외가 아니라, walk의 매 owned 접근에
contained repair를 적용하는 것이다. 권한 손상과 실제 quota 초과를 구별해야 한다.

### AV-20261008-02 — OMA와 Pi가 같은 설정을 다른 잠금으로 저장한다

[locked-files.ts](../apps/oma/src/runtime/locked-files.ts):14는 `oma-settings.lock`을 사용한다.
[settings.ts](../packages/engine/src/pi-compat/settings.ts):85는 잠금 안에서 읽은 전체 JSON을 변환해 교체하며,
"동시 writer는 이 잠금을 지나야 한다"고 전제한다. 그러나 실제 두 interactive entry는
`SettingsManager.create`를 사용한다([Society](../packages/engine/src/interactive.ts):576,
[Personal](../apps/oma/src/entry/pi-personal.ts):244). pinned Pi `FileSettingsStorage`의 잠금은 `settings.json.lock`이다.
[piAgentDir](../packages/engine/src/pi-runtime.ts):161은 Society와 Personal에 공통 Human engine home을 준다.
따라서 기존 창이 모델 선택을 저장하는 동안 새 창의 준비가 같은 파일을 교체할 수 있다.

실제 OMA 잠금 hold의 read/replace 사이에 별도 프로세스의 실제 Pi setter+flush를 실행했다.
Pi의 `new-provider/new-model` 저장 완료와 파일 내용까지 확인했지만 OMA commit 뒤에는
`old-provider/old-model`로 되돌아갔다. 제어한 interleaving이며 두 실제 UI 세션의 확률적 race 측정은 아니다.
원인은 저장 owner를 둘로 만든 내부 중복이다. Pi의 수정 필드 merge도 OMA의 전체 snapshot 교체를 막지 못한다.

재현: [settings-race.mjs](../test/audit/adversarial-2026-10-08/settings-race.mjs).
수정 방향: 모든 engine writer가 같은 storage/lock owner를 사용하게 하고, 이전 내용의 전체 교체로
다른 writer가 완료한 변경을 덮어쓰지 않게 한다.

### AV-20261008-03 — "직전 세대까지 보존"은 reader 사망 증거가 아니다

[packages-apply.ts](../apps/oma/src/application/packages-apply.ts):71–73은 현재와 직전 generation만 남기며 나머지를 삭제한다.
그동안 [guest packages](../apps/oma/src/platform/guest/packages.ts) → [guest host](../apps/oma/src/platform/guest/host.ts) →
[host sync](../apps/oma/src/platform/host/service.ts)의 경로에는 기존 세대의 모든 reader가 끝났다는 검사가 없다.
archive의 open race를 막는 `archiving` latch는 packages.replace의 reader 수명 보호가 아니다.

첫 세대의 실제 확장 module을 import하고 상대 경로 asset을 읽었다. 첫 교체 뒤에는 여전히 읽히지만
두 번째 교체 뒤에는 살아 있는 동일 module의 `readAsset()`이 `ENOENT`를 받고 pinned directory도 없다.
실제 archive 생성·검증·Pi package indexing·apply 경로를 사용했다. native VM/Pi UI 세션 전체는 이 oracle의 범위 밖이다.
기존 platform-packages 시험은 세 번째 sync에서 첫 세대 삭제를 기대하지만 reader 종료를 세우지 않는다.

재현: [package-generation.mjs](../test/audit/adversarial-2026-10-08/package-generation.mjs).
수정 방향: generation 수가 아니라 reader lease/death 또는 확인된 quiescence를 수집 조건으로 사용한다.

### AV-20261008-04 — check의 로그 1 MiB가 실행 수명 상한이다

[candidate-checks.ts](../apps/oma/src/runtime/candidate-checks.ts):107은 stdout/stderr 각각 1 MiB이고 spool이 없다.
이 값은 preview 크기가 아니라 overflow 시 프로세스를 중단시키는 값이다.
실제 user systemd·cgroup·bubblewrap 검사에서 `/bin/true`는 성공했고,
`head -c 1048577 /dev/zero; exit 0`은 `output-limited`, exitCode null,
보존 stdout 1048576 bytes, `REF_STATE_UNKNOWN`이 됐다. 즉 정상적으로 더 많은 로그를 내는 검사에
성공 결과 관측을 끝낼 경로가 없다. 같은 조건으로 반복해도 이 한도에서 다시 중단된다.
unknown을 PASS로 바꾸지는 않으므로 그 안전 경계는 유지된다.

재현: [native-checks.mjs](../test/audit/adversarial-2026-10-08/native-checks.mjs).
수정 방향: 실제 종료 관측과 진단 preview를 분리하고 전체 출력은 owner가 있는 spool로 보존한다.
이 oracle는 실제 confined check 경계이며 전체 `git.integrate` receipt/CAS qualification은 아니다.

### AV-20261008-05 — 커널 page 정렬을 설정의 byte 동등성으로 검사한다

[candidate-checks.ts](../apps/oma/src/runtime/candidate-checks.ts):27의 resource gate는 `memory.max`와 요청 bytes의
문자열 동등성을 요구한다. config/resource validator는 page 정렬을 요구하지 않는다.
실제 같은 check의 268435456 bytes는 성공하고 268435457 bytes는 `/bin/true`에 도달하기 전에
exit 125, `CHECK_FAILED`가 된다. 별도 kernel 관측에서 67108865 bytes 요청의 `memory.max`는 67108864였다.
이는 코드 검사 실패가 아니라 커널의 page 단위 표현과 비교 규칙의 불일치다.

재현: 위 native-checks oracle의 `unaligned-memory`.
수정 방향: 지원할 정렬 범위를 설정 검증과 실행 gate가 공유하게 하고, 실제 적용된 kernel bound를
그 범위의 의미로 비교한다. 의도한 자원 보호를 느슨하게 하는 임의 오차 허용은 대안이 아니다.

### AV-20261008-06 — 설정과 executor의 deadline 유효 범위가 다르다

`validateConfig`는 complete check resource의 `checkTimeoutSeconds=2147484`를 받지만,
[integration-policy.ts](../packages/domain/src/integration-policy.ts):108은 ms 변환+60,000이 `0x7fffffff`를 넘으면
`UNSUPPORTED_PROFILE: integration check deadline cannot be enforced`를 던진다.
[broker entry](../apps/oma/src/entry/broker.ts):177은 이 지원 검사를 기동 시 실행한다.
유효성 검증과 실행 지원 판단이 서로 다른 owner의 숫자 범위를 사용한다.

재현: native-checks의 `config-executor-deadline`. 실제 validator와 startup에 쓰이는 지원 함수를 호출했다.
이 설정을 managed commit한 뒤 전체 broker를 부팅한 실험은 아니다. 설정 loader가 unreadable해졌다는 주장도 아니다.
수정 방향: 저장할 runnable config를 검증하는 단계에서 executor의 표현 가능 범위도 동일하게 검증한다.

### AV-20261008-07 — 첫 대화 시간과 Society 기능 준비 시간은 다르다

기존 DR35 측정은 broker 준비 전 plaintext 대화를 5초 안에 가능하게 했으며 전체 준비 약 30.1초도 공개했다.
추가 실제 PTY oracle에서는 첫 모델 응답이 곧바로 `oma_society`를 호출하게 했다.
2026-10-08 관측: 모델 요청 3.198초, 도구 결과 3.238초에 `Acceptance status unknown`과 same-key 복구 안내.
2026-10-09 재현도 요청 3.129초, 도구 결과 3.176초에 같은 결과였다. [oma-society](../apps/oma/src/entry/oma-society.ts)의
engine 선기동과 [transport](../packages/client/src/transport.ts)의 즉시 연결 사이에 Society readiness 대기가 없다.

재현: [early-tool-benchmark.py](../test/audit/adversarial-2026-10-08/early-tool-benchmark.py)와 함께 있는 PTY fixture.
실제 제품·bundled Pi·tool이며 모델만 로컬 대본이다. 준비 전 권한을 발급하거나 성공을 꾸민 것은 아니다.
하지만 첫 화면/모델 요청만으로 "OMA가 최대 5초 안에 켜져 Society 일을 한다"는 요구는 충족되지 않는다.
수정 방향: 기동 수용 기준에 첫 유용한 Society 작업을 포함하고, 준비 중 tool 실행을 명시적으로 다룬다.

### AV-20261008-08 — 끝난 relay 방향의 fd가 poll에서 계속 깨어난다

[oma-vsock-bridge.c](../packages/platform-linux/src/guest/bridge/oma-vsock-bridge.c):86은 끝난 방향도 `events=0`인 fd로 poll에 남긴다.
peer의 완전 종료 후 `POLLHUP`는 계속 반환되지만 `!open` 조건 때문에 처리하지 않는다.
반대편이 아직 열려 있으면 loop가 기다리지 않고 돈다.
정확한 production `relay()`를 C harness에 include해 Unix socketpair로 실행했다.
400ms 동안 정상 유휴 CPU ticks는 0, 한 peer 종료 뒤에는 39/100Hz(약 한 코어 97.5%)였다.

재현: [relay-probe.c](../test/audit/adversarial-2026-10-08/relay-probe.c).
native Linux C relay의 EOF/poll 경계 증거다. AF_VSOCK peer 인증, Swift host bridge, 실제 VM qualification은 아니다.
수정 방향: 종료된 방향의 fd를 poll 대상에서 빼고 종료·half-close·양방향 backpressure를 함께 검증한다.

### AV-20261008-09 — 준비 전체의 120초가 내부 작업의 허용 시간을 무효화한다

[society-preparation.ts](../apps/oma/src/runtime/society-preparation.ts):14의 `timeoutMs:120_000`은 진행과 무관한 전체 마감이다.
child의 [project-snapshot.ts](../packages/git/src/project-snapshot.ts):106은 Git 명령 하나에 `10*60_000`을 허용하고
여러 snapshot/seed/mirror 작업이 순차 실행된다. 큰 source tree나 느린 디스크에서 정상 진행 중인
준비도 바깥 120초에 잘릴 수 있다. 새 마감은 기존 [limit-bounds](limit-bounds.md) 목록에도 없다.

**정적 근거로 OPEN**이다. 정상 프로젝트가 실제로 120초를 넘는 end-to-end 실험은 NOT_RUN이다.
수정 방향: 진행 관측·취소·실제 child 종료를 포함한 하나의 준비 시간 정책을 사용한다.
5초 안의 사용성 요구를 전체 준비를 120초에 죽이는 것으로 충족시킬 수는 없다.

### AV-20261008-10 — quota의 동기 전체 walk가 모든 새 admission의 비용이다

[quota.ts](design-revisions.md#dr46--출시-전-레거시-제거와-workspace-분리) (당시 quota 경로, DR46에서 제거됨)의 `reserve`/`admit`/`check`는 매번 전체 tree를 동기로 관측하며 캐시하지 않는다.
실제 owner의 별도 microbenchmark에서 5,000파일 admission은 19–28ms,
30,000파일은 131–155ms였다. 30,000파일에서 세 번 연속 호출한 동안 zero-delay timer도 431.8ms 지연됐다.
측정값은 machine/workload별 값이며 실제 모든 요청의 latency나 시작 2분의 원인으로 확대하지 않는다.

재현: quota-probe의 `performance`; evidence에는 별도 측정과 재현 값을 모두 남겼다.
고빈도 preflight·정산과 파일 수가 함께 증가하면 stop/authority loss 같은 event-loop 작업도 지연될 수 있다.
수정 방향: 정확한 quota 의미와 외부 writer를 유지하면서 kernel/비동기 관측 owner 또는 admission 방식의
비용을 줄이는 설계를 검토한다. 확인되지 않은 cache를 현재 사용량의 사실로 바꾸는 단순 교체는 금물이다.

### AV-20261008-11 — 정적 gate의 PASS는 owned 접근 전수 준수 증거가 아니다

[owned-state-rules.mjs](../scripts/architecture/rules/owned-state-rules.mjs):165의 `OWNED_ROOT_NAME`은
generic `root`/`path`/`dir`을 제외한다. quota walker는 바로 이 이름을 사용해 실제 owned 관측이 규칙에서 빠진다.
수정 owner allowlist와 사전 ensure를 근거로 한 예외도 접근 때의 손상 복구를 모두 증명하지 않는다.
현 소스에서 `node scripts/architecture/rule-check.mjs`는 **PASS, 0 findings**였지만 AV-01은 실제로 재현됐다.

이 항목은 gate의 coverage 한계다. 이미 고친 과거 alias 규칙을 여전히 미수정이라고 주장하지 않는다.
수정 방향: 소유 경계와 fs 접근의 dataflow를 검사하고, 기존 source의 실제 반례와
damage/kill/retry oracle를 gate 의미에 포함한다. PASS를 runtime/P0 전체 증거로 승격하지 않는다.

### AV-20261008-12 — Pi의 공개 계산을 다시 유지하는 내부 helper

[pi-interactive-host.ts](../packages/engine/src/interactive.ts):40의 `effortLevelsOf`는 pinned Pi AI의
공개 `getSupportedThinkingLevels`와 같은 filtering을 별도로 구현한다. `pi-ai/dist/index.js`는
`models.js`를 공개 export한다. 기존 parity 시험은 drift를 찾지만 같은 의미의 owner를 둘 유지할 필요까지 증명하지 않는다.

**내부 중복/P3**로 기록한다. 현재의 valid model에서 다른 결과를 냈다는 재현은 없으며,
model surface의 풍부함이나 필수 sandbox/fencing 구조를 과잉 설계로 분류한 것이 아니다.
수정 방향: 공개 계산에 위임하고 OMA의 UI mapping만 유지한다. 13개 private InteractiveMode override는
별도의 Pi 호환 비용으로 관찰했으나 각 제품 요구가 있어 개수만으로 제거를 권고하지 않는다.

### AV-20261008-13 — 손상된 package snapshot을 적용 뒤에야 소비한다

[packages-apply.ts](../apps/oma/src/application/packages-apply.ts):50은 `${archive}.before.json`을 `JSON.parse` 뒤 type assertion만 한다.
`publishNoReplace`가 existing을 돌려줘도 기존 내용의 shape/relation을 검증하지 않는다.
`{before:null,previous:null}`을 주입한 실제 archive 적용은 `recorded → published → switched → collected`까지
진행하고 나서 [project-settings.ts](../apps/oma/src/application/project-settings.ts):72의 `before.some`에서 TypeError가 났다.
실패 뒤 선택된 store의 asset은 이미 `generation 4`였으며 이전 세대 수집도 실행됐다.

재현: package-generation oracle의 `damagedRecord`. 실제 owned 기록의 통제된 byte 손상이다.
P0의 persisted boundary에서 shape·관계를 effect 전에 검증하지 않는 결함이며, rollback으로 이미 삭제한
reader 자원을 되돌릴 수 없다. 수정 방향: 기존 snapshot의 완전한 decoder와 request/generation 관계를 먼저
검증하고 손상이면 STORE_CORRUPT로 effect 없이 멈춘다.

### 범위와 남은 불확실성

수평 조사에는 authored `src` TS 394파일의 import/function 구조와 numeric literal 4,628개가 포함된다.
그중 이름·식 문맥으로 추린 limit 관련 후보는 860개다. 숫자 occurrence 수이지 독립 상한 860개라는 뜻은 아니다.
명명된 bound도 정당성 증거로 취급하지 않았으며 실제 거절, kernel 정렬, 시간 표현, reader 수명을 따로 검증했다.
전체 394파일을 모두 줄 단위로 읽었다거나 860후보의 안전성을 모두 증명했다는 주장은 하지 않는다.
영역별 검토 owner와 부족한 실행 증거는 coverage artifact에 명시한다.

검토 중 현재 source에서 유지되는 안전 경계도 확인했다: transaction capability의 scope/owner 확인,
원본 acceptance 밖의 plan 변경 금지, relationally decoded receipt projection, 현재 peer/cgroup 권한 재검사,
check 관측 실패의 unknown 유지, snapshot stop·freeze/thaw·archive/open latch. 확인한 경계의 정적 판단이며
P0 전체의 PASS나 실제 power-loss/manager-death 증거는 아니다.

Swift bridge close 뒤 지연 connect callback/relay thread 수명은 native 실행으로 확인하지 못했다.
실제 macOS VZ/Keychain/APFS, AF_VSOCK transport, 유료 provider, powercut, release qualification은 NOT_RUN이다.
기존 full suite 3,919 PASS는 이전 시작 수정의 기록이며 이번 감사의 fresh whole-suite 결과로 재사용하지 않았다.
실행 판정·재현 명령과 마지막 byte 대조는 validation의 이번 감사 절을 따른다.

## 과거 점검 기록

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
| 시나리오 시험이 찾은 것 | 모델만 대본인 시나리오 시험이 찾은 P0V-54, P0V-55 | `910a3f3` 이전 |
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

순서 1–14는 끝났다(상태 열의 commit). 순서 15의 규범·traceability 갱신은 `1b3827c`이고, 결박은 [validation.md](implementation/validation.md)의 현재 판정이 한다.

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

## 시나리오 시험이 찾은 것

2026-09-27, 사용자 지시로 만든 시나리오 시험(모델만 대본이고 나머지는 제품, `test/scenario-*.test.ts`, MAINTENANCE §25)이
단위 시험이 놓친 결함 두 개를 찾았다. 둘 다 고쳤고, 시나리오가 옛 코드에서 실패함을 확인했다.

| ID | 규칙 | 파일(`910a3f3` 이전) | 요약 | 상태 |
|---|---|---|---|---|
| P0V-54 | P0-2 | validate.ts `checkAddress`, mail/routing.ts `expandAddresses` | 주소가 agent를 가리키는지를 params 검사와 라우팅 owner가 따로 판정했다. params 검사는 "invalid params for mail.send"로 답해 모델은 무엇이, 어느 주소가 잘못인지 알 수 없었고, 오류 표와 라우팅이 정한 ADDRESS_NOT_FOUND(·AGENT_NOT_READY·AGENT_RETIRED)가 가려졌다. SCN-F04 | 수정 910a3f3(params 검사는 문법만, 존재는 접수 전 라우팅이) |
| P0V-55 | P0-5 | protocol/jsonl.ts, runtime/pi-rpc.ts | 모델이 frame보다 큰 파일이나 답을 만들면 엔진 이벤트 한 줄이 reader 한도를 넘어 전송이 중독되고 Principal 세션(또는 Resident run)이 끝났다. SCN-F13, SCN-F17, SCN-R06 | 수정 910a3f3(DR15) |

시나리오 시험이 기대를 고친 곳(제품이 옳았던 것): commons의 수신자에 보낸 Resident 자신도 포함된다(spec MAIL 라우팅 표). Principal은
자기 자손인 Resident만 관리한다(`agent.manage.descendants`). main 통합에는 `code.integrate`가 필요하다(AUTH-001, 기본값 없음).

## 5차 점검: 외부 재검토 두 건

기준점 `18421f0`(v21 결박 커밋). 2026-09-27 사용자가 외부 검토 두 건을 전달했다. 하나는 224개 생산 파일 전수 재검토이고(R01–R13,
이전 30개 재평가, 구조 개선 제안 S01–S14), 다른 하나는 37개 파일의 적대적 검토다(F1–F6. 앞선 묶음의 F1–F7과 다른 번호다). 지적마다
코드와 대조했고, 옛 코드에서 재현되는 것은 재현했다. 두 검토가 같은 결함을 짚은 곳이 하나다(R01 = 둘째 검토 F1). 판정 기준은 다른 점검과
같다: 위반이면 고칠 하위 규칙을 적고, 같은 종류가 있는 곳을 함께 고친다. 구조 개선 제안(S01–S14, 둘째 검토 §9)은 지적이 아니라서
판정하지 않았다.

### 판정과 수정

| ID | 외부 | 규칙 | 파일(`18421f0`) | 요약 | 상태 |
|---|---|---|---|---|---|
| P0V-56 | R01, 둘째 F1 | P0-5 | storage/transitions.ts `completeBatch`, store.ts `insertAgent`, operation-transitions.ts `insert` | presentation 시각의 하한이 생성 시각뿐이라, materialization 뒤 시계가 뒤로 가면 decoder가 batch 완료를 손상으로 거절했다(P0V-30의 잔여). 같은 사건의 시각을 두 번 읽는 삽입이 둘 있었다 | 수정 10343cb, 시각 순서 81가지 property da22def |
| P0V-57 | R02 | P0-2 | broker.ts, broker/internal-dispatcher.ts | 같은 `batch.prepare`·`batch.complete`인데 runner 경로만 손상·drain fence를 거쳤다. 새 batch 행은 트랜잭션 안에서 막혔지만, 이미 준비된 batch는 손상 관측 뒤에도 host 경로로 세션에 전달됐다 | 수정 6f2da6b(`admitInternal` 하나) |
| P0V-58 | R03 | P0-5 | broker.ts `drainAndClose`, entry/oma.ts, entry/broker.ts | drain이 Resident의 종료를 증명하지 못해도 성공으로 끝났고, 다음 host는 broker의 startup quiescence 전에 rootfs를 고쳤다 | 수정 b08cd88(DR16: 수리는 broker startup의 quiescence 뒤, 어떤 Resident도 깨어나기 전) |
| P0V-59 | R04 | P0-1 | units.ts, implementation/systemd/*.in | unit 소유 확인에 state tree가 없어 같은 이름의 두 society가 서로의 unit을 제 것으로 봤고, 확인과 교체가 두 단계였으며, start·stop·관측은 소유를 묻지 않았다 | 수정 ff0a1ba(owner 줄 `X-OMA-Owner`, no-replace 게시, 효과마다 확인) |
| P0V-60 | R05 | P0-2 | broker/peer-authenticator.ts, broker/principal-endpoint.ts | Principal의 AuthContext가 요청을 시작할 때의 등록 세대를 다시 확인하지 않아, await 중에 등록이 바뀐 요청이 accept 때 권한을 가졌다. Resident의 context는 run lease를 매번 다시 본다 | 수정 e62ba8c |
| P0V-61 | R06 | P0-3 | config/generations.ts | 세대 ID는 내용이라 A→B→A가 되풀이되는데, journal 기록은 commit 뒤에 쓰였고 실패해도 넘어갔다. 기록 둘이 사라지면 수집이 실제 직전 세대 B를 지웠다(AV7 뒤 알려진 한계였다) | 수정 3f8bcb3(기록은 "이전 현재" 쌍, commit point 전, 실패하면 commit하지 않음) |
| P0V-62 | R07 | P0-4 | cli/exit.ts, cli.ts | CLI가 pipe·socket에 출력하고 바로 `process.exit`해서 긴 답이 잘렸다. 이 머신(Node 24)에서 262,001바이트가 146,176바이트로 도착했고 종료 코드는 0이었다 | 수정 0b60402(exit owner가 출력을 동기 쓰기로 둠) |
| P0V-63 | R08 | P0-2 | cli/effects.ts, cli/effects/mail.ts | `--reply`가 헤더만 필요한데 저장 메일 전체를 frame 한도로 읽어, 받을 수 있는 큰 메일에 회신하지 못했다 | 수정 c3c1d03 |
| P0V-64 | R09 | P0-2 | domain/errors.ts, git/context.ts·submit.ts·integration.ts 외 | 공개 경계와 accept 뒤 판정이 code는 정규화된 오류에서, phase·details는 원래 예외에서 읽었다. 정리 실패와 묶인 거절은 INTERNAL_ERROR로 판정돼 pending으로 남았다 | 수정 b84c3d2(`acceptedFailurePolicy` 하나) |
| P0V-65 | R10 | P0-4 | broker/transport-spool.ts, 닫기를 차례로 하던 finally 다섯 곳 | spool reader의 FD가 stream에 넘어가기 전 실패에서 owner가 없었고, 첫 close가 실패하면 나머지 close와 `preparing` 해제를 건너뛰었다 | 수정 b5eee34(`closeEvery`) |
| P0V-66 | R11 | P0-5 | tui/view/dashboard.ts, tui/view/screens.ts | 대시보드가 new/만 세어 "세션에 전달 대기"라고 했다. batch 준비는 세션 전달 전에 메일을 cur/로 옮기므로 준비된 메일이 전달된 것으로 보였다 | 수정 9af31fb(원장 pending 관측, ●는 "아직 batch에 담기지 않음") |
| P0V-67 | R12 | P0-2 | tui/keys.ts | 키 디코더가 read마다 새 TextDecoder로 첫 U+FEFF를 BOM으로 지워, read가 잘린 자리에 따라 글자가 달라졌다 | 수정 8e5c644 |
| P0V-68 | R13 | P0-2 | tui/view/screens.ts | 메일 scroll 상한이 알림 줄이 없다고 보고 계산돼, 알림이나 busy 줄이 있으면 마지막 줄에 닿지 못했다 | 수정 a94a168 |
| P0V-69 | 둘째 F2 | P0-5 | domain/errors.ts, domain/admission.ts, store.ts | SQLite의 CORRUPT·NOTADB가 INTERNAL_ERROR로 남아 fence가 닫히지 않았고, 반대로 BEGIN의 I/O 오류는 STORE_CORRUPT로 단정했다 | 수정 d723f46(결과 코드 표를 정규화 한 곳에) |
| P0V-70 | 둘째 F3 | P0-2 | broker.ts `publishStatus` | broker가 잡는 실패 가운데 status 발행만 fence에 가지 않았다. 발행은 원장을 먼저 읽는다 | 수정 d723f46 |
| P0V-71 | 둘째 F4 | P0-3 | storage/durable-fs.ts `ensureDurableDirectory`, request-cache.ts | 영속 디렉터리가 이번 호출이 만든 이름만 flush해, fsync 실패 뒤 재시도는 깊은 조상 이름을 flush하지 않고 성공했다. request cache는 모양만 만드는 `ensureDirectory`를 썼다 | 수정 3850169(leaf부터 root까지 매번) |
| P0V-72 | 둘째 F5 | P0-5 | config/generations.ts `journalTail` | journal tail을 `readSync` 한 번으로 읽고 모자란 읽기를 전체로 믿었다 | 수정 3f8bcb3(끝까지 읽고, 이른 EOF는 모두 보존) |
| P0V-73 | 둘째 F6 | P0-4 | tui/session.ts | spawn이 실패하면 `exit` 없이 `error`·`close`만 오는데 `exited`는 `exit`만 기다렸다. host의 tenure는 자기 기다림에 상한이 있어 멈추지는 않았다 | 수정 8ec694c |

원칙에 따라 함께 고친 곳: P0V-64는 원래 예외에서 code를 읽던 sweep·reconcile·runner 로그도 고쳤다. P0V-65는 같은 모양의 finally 다섯 곳을 모두
고쳤다. P0V-59는 no-replace 게시를 request cache 전용에서 durable-fs의 primitive 하나로 옮겼다. 그리고 P0-7 gate가 별칭으로 import된
primitive를 보지 못해 request cache의 receipt 경계가 등록 없이 빠져 있던 것을 고쳤다(별칭 해석, 경계 두 개 등록). P0V-61은 validation의
알려진 한계("기록이 연속 두 번 빠지면 직전 세대를 잃을 수 있다")를 닫았다.

재현한 것: R07(Node 24, 위 수치), 둘째 F2(실제 node:sqlite가 NOTADB에 `errcode: 26`을 냄), 둘째 F6(없는 실행 파일, spawn 실패). 나머지는
시험이 옛 코드에서 실패하는 것으로 확인했다.

판정을 바꾼 곳: R02는 "새 batch 행이 생긴다"는 부분이 과장이었다. `insertPreparedBatch`는 트랜잭션 안에서 fence를 확인한다. 결함은 이미
준비된 batch의 전달과 같은 method의 두 규칙이다. R03의 순서 부분은 규범(REC-007)끼리의 충돌이라 DR16으로 정했다.

판정하지 않은 것: 두 검토의 구조 개선 제안(S01–S14, 둘째 §9: validated graph, SQLite 대기 시간 예산, ROLLBACK 실패 관측, 단조 시계).
첫 검토의 재평가 가운데 N20(부분 수정: 목록의 lstat 전수와 이중 관측)과 N21(미해결)은 각각 개선 제안, DR14의 의도된 예외로 둔다.

CI: 두 검토 모두 `18421f0`의 Actions run 36290090020이 failure라고 관측했고 원인은 모른다고 적었다. 여기서는 로그를 읽을 수 없다.
직전 `6787211`의 run은 4초 만에 artifact 0개로 끝났다(첫 검토 묶음의 ci-observation). 그러니 checkout 전에 job이 끝났다. 코드 시험의
실패라기보다 job 할당이나 계정 단계의 실패로 보이지만, 확인하지 못했다. workflow가 고정한 action SHA 셋은 공개 태그와 같다.

### 기존 시험의 기대를 바꾼 곳

- `generation-retention`: journal 기록이 "이전 현재" 쌍이 되어, 기록을 적은 시험(AV7, P0V-47)은 새 형식으로 같은 뜻을 확인한다. "현재 세대의
  기록이 빠지면 마지막 기록과 기록되지 않은 세대를 남긴다"는 이제 "현재 세대를 만든 commit의 기록이 없으면 모두 남긴다"다.
- `tui-sources`, `tui-facts`(V28A), `unread-observations`(AV7): Mail 행과 ● 범례가 원장 관측과 new/의 실제 뜻을 말한다. 목록을 읽지 못한
  메일함은 여전히 0건이 아니라 unknown이다. `unread-observations`는 P0V-66을 고칠 때 import로 고른 시험 묶음에서 빠져, 로컬 전체 시험에서 찾았다.
- `oma-composition-policy`: host가 rootfs를 수리한다는 세 기대는 broker 조립 시험의 DR16 순서로 옮겼다.
- `broker-composition-policy`: startup 순서에 수리(`repair`)가 recovery의 quiescence 뒤, bootstrap 앞에 들어간다.

### 수정 검증

수정마다 시험을 먼저 쓰고, 고친 파일만 기준점의 것으로 되돌려 빌드한 뒤 해당 시험이 실패하는지 확인했다. 서명이 바뀌어 되돌리면
빌드가 깨지는 곳(P0V-60, P0V-64의 공유 판정 함수, P0V-65의 `closeEvery`, P0V-72의 읽기 loop)은 판정만 지우는 변이로 확인했다. 모두
실패했다(KILLED). 처음 쓴 두 시험은 대조에서 살아남아 고쳤다: `closeEvery` 시험은 닫은 FD 번호가 재사용돼 두 FD가 같은 번호였고,
spool 시험은 주입한 fstat 실패를 `openRegularBeneath` 안의 fstat이 먼저 소비했다. P0V-71의 request cache 시험은 옛
`ensureDurableDirectory`에서도 통과한다(첫 호출은 만든 이름을 모두 flush한다). 재시도의 차이는 durable-fs 시험이 잡는다. 처음 쓴
P0V-59의 배타 생성(`O_EXCL`로 이름에 바로 쓰기)은 crash에서 반쯤 찬 unit을 남길 수 있어 no-replace 게시로 바꿨다. P0V-58의 첫 수정은
실패한 drain 뒤에도 lock을 풀어 R37(결과를 모르는 native 준비가 있으면 프로세스가 사는 동안 lock을 풀지 않는다)을 깼다. 그래서
lifetime은 그대로 두었다. 회귀 시험은 `test/p0-review5.test.ts`(durable lane, requiredNames 3개)와 각 owner의 시험 파일에 있다.

## 6차 점검: 외부 검토 R6-01–R6-20

기준점 `712eb53`와 그때의 작업 트리. 2026-09-27 사용자가 외부 검토 보고서(`/home/dev/oma-evidence/review6/REPORT.md`, 저장소 밖)를
전달했다. 발견 20개(S2 하나, S3 다섯, S4 열넷)와 재현 스크립트(`repro/`)가 있다. 발견마다 코드와 대조해 위반·부합·의도된 한계로 판정했고,
재현 스크립트는 빌드 뒤 돌려 옛 코드에서 재현되는 것을 확인했다. 수정은 사용자 지시대로 `feat/macos-hidden-vm`에 했다(`refactor` 브런치는
`d4ed8b8` 그대로). 판정 기준은 다른 점검과 같다: 위반이면 고칠 원칙을 적고 같은 종류가 있는 곳을 함께 고친다. 검증하다 찾은 것(P0V-80,
P0V-82, P0V-84, P0V-85)도 같은 표에 적는다.

### 판정

| 발견 | 판정 | 원칙 | P0V |
|---|---|---|---|
| R6-01 (S2) dangling symlink가 봉인하지 않은 host의 workspace guard를 지난다 | 위반 | 확인과 효과는 한 해석(architecture §4) | 74 |
| R6-02 (S3) 2^53을 넘는 INTEGER가 INTERNAL_ERROR | 위반 | P0-5, 저장소 오류 정규화 한 곳 | 75 |
| R6-03 (S3) 상대 기한이 벽시계로 잰다 | 위반(키 디코더 한 곳). status-refresh·tui/transport·storage/transitions의 `Date.now`는 프로세스 사이에 기록·비교되는 시각이라 부합 | D-7 단조 시계 | 76 |
| R6-04 (S3) native 자식이 일한 트리에 수거자가 없다 | 위반 | P0-4, P0-5(죽음을 증명할 수 있어야 보존이 영구 보존이 되지 않음) | 77 |
| R6-05 (S3) CLI가 로컬 입력을 상한 없이 읽는다 | 위반. 상한은 frame이 아니라 stream(context·bundle)의 것 | INV10, CFG-003 | 78 |
| R6-06 (S3) SS3를 escape와 문자로 푼다 | 위반 | TUI-002 | 79 |
| R6-07 (S4) 신호 종료에서 터미널 복원이 돌지 않는다 | 위반. 같은 종류 다섯 곳 | AV31 목록 하나(DR17) | 81 |
| R6-08 (S4) P0-7 gate가 주입을 확인하지 않는다 | 위반 | P0-7 | 83–85 |
| R6-09 (S4) BOM 정책이 decoder마다 다르다 | 위반 | P0-2, IPC-001, decoder owner 하나 | 86 |
| R6-10 (S4) 벽시계가 순서의 1차 키 | 위반 | 뜻 있는 순서는 단조 원천(rowid) | 87 |
| R6-11 (S4) sweep이 실패를 두 번 관측 | 위반(지금은 멱등이라 해 없음) | 관측은 한 번 | 88 |
| R6-12 (S4) `planLocatorsBelongTo`를 부르는 곳이 없다 | 위반(쓰이지 않는 약한 중복). 실제 owner는 plan decoder | 이름 없는 검사를 지움 | 89 |
| R6-13 (S4) generation 재사용이 여분 파일을 보지 않는다 | 위반(지금은 loader가 manifest만 읽어 해 없음) | P0-3, 이름은 트리 전체 | 90 |
| R6-14 (S4) `specHash`가 선택 인자 | 위반 | 검증을 건너뛸 수 없는 타입 | 91 |
| R6-15 (S4) `getAgentIdentity(agent)!` | 위반. 같은 모양 `getOperation(…)!` 열다섯 곳 | 이름 있는 가드 | 92 |
| R6-16 (S4) `hasGoal` fallback이 EACCES를 "GOAL 없음"으로 | 위반(제품은 닿지 않음). reconcile의 "있음" fallback도 같은 종류 | P0-5, owner 하나 | 93 |
| R6-17 (S4) TSV view가 구분자만 escape | 위반(지금은 입력 문법이 막음) | 파생 view가 스스로 escape | 94 |
| R6-18 (S4) workspace quota가 검사와 쓰기가 떨어진 soft quota | 위반. R6-01과 같은 owner로 고침 | 예약은 효과의 owner가 | 74 |
| R6-19 (S4) 동기 SQLite와 `busy_timeout=5000` | 의도된 한계. 상한을 문서에 적음 | — | — |
| R6-20 (S4) owner 줄 없는 옛 unit을 Description으로 판정 | 위반 | P0-1, P0-5 | 95 |

### 수정

| ID | 발견 | 파일 | 요약 | 상태 |
|---|---|---|---|---|
| P0V-74 | R6-01, R6-18 | extension/contained-files.ts·contained-tools.ts, workspace-guard.ts, pi-extension.ts | 모델에게 보이는 파일 효과(write·edit, 봉인하지 않으면 read·ls도)를 containment 하나로 옮겼다. 경로 구성요소마다 `O_NOFOLLOW`로 `/proc/self/fd`를 따라 열고, 확인과 효과가 같은 fd를 쓴다. 쓰기 quota는 그 owner가 직렬화한 쓰기 안에서 정한다 | 수정 489f1f9 |
| P0V-75 | R6-02 | domain/errors.ts | node:sqlite의 `ERR_OUT_OF_RANGE`(정수를 JS 값으로 넘길 수 없음)를 STORE_CORRUPT로. 같은 코드의 Buffer 오류는 저장소가 아니다 | 수정 cc5c46e |
| P0V-76 | R6-03 | tui/keys.ts | paste burst를 단조 시계로 잰다 | 수정 a847bf8 |
| P0V-77 | R6-04 | storage/tree-lease.ts, git/quarantine.ts, storage/context-stream.ts, git/context-repository.ts, runtime/provision.ts, reconcile/preaccept.ts, lifecycle/workspace.ts | 자식이 일하는 트리 옆에 flock한 lease를 두고 자식에게 물려준다. 잠금이 풀려 있으면 만든 자가 모두 죽었다는 증명이라 수거하고, 쥐어 있으면 남긴다 | 수정 882ef85 |
| P0V-78 | R6-05 | cli/effects.ts·effects/context.ts·effects/submit.ts, cli/transport.ts, 환경 셋 | CLI의 로컬 입력은 `readBounded` 하나로 읽는다. 크기는 할당 전에 그 입력이 가는 stream의 상한(`OMA_CONTEXT_BYTES`·`OMA_BUNDLE_BYTES`, host가 frame 상한 옆에 넣음)과 비교한다. 두 번째 복사를 없앴다 | 수정 5a4771f |
| P0V-79 | R6-06 | tui/keys.ts, tui/screen.ts | `ESC O`를 `ESC [`처럼 토큰으로 모으고, 모르는 것은 버린다. 시작과 repaint에서 DECCKM을 끈다 | 수정 effbcc4 |
| P0V-80 | 검증 중 발견 | platform/guest/pty.ts | `posix_openpt`에 O_CLOEXEC가 없어 society의 프로그램이 자기 터미널의 master를 물려받았다. holder가 죽어도 hangup이 없어 고아로 남았다(전체 시험 한 번에 fake-tui 63개) | 수정 71bf92f |
| P0V-81 | R6-07 | runtime/broker-lifetime.ts, entry/oma.ts·runner.ts·omahostd.ts·guest-session.ts, platform/host/attach-client.ts, tui/screen.ts | `HOST_LOSS_SIGNALS`를 잡을 수 있는 종료 신호 전부(SIGQUIT 추가)로 정의하고, drain이 있는 모든 프로세스가 그 목록으로 drain을 밟는다. 규칙 `host-loss-signals` | 수정 90088b8(DR17) |
| P0V-82 | R6-07의 같은 종류 | entry/guestctl.ts, platform/guest/control.ts, oma-guestctl.service | guestctl이 언 채로 죽으면 deadline timer도 사라져 freeze가 남았다(MAC-620). `ExecStopPost`의 `--thaw`, 시작할 때의 thaw, 종료마다의 release | 수정 302bcf1 |
| P0V-83 | R6-08 | scripts/durable-boundaries.mjs, durable-boundaries.json | 등록한 시험마다 주입 종류(sigkill·in-process-fault·logical)를 적고, gate가 AST로 제목을 확인하고 시험이 닿는 코드가 그 주입을 보이는지 본다. 요약은 경계별 가장 강한 주입을 말한다 | 수정 e270d75 |
| P0V-84 | R6-08 작업 중 발견 | storage/durable-fs.ts `publishNoReplace` | 다른 게시 primitive와 같은 durability 지점. 게시 도중 죽은 writer의 임시 파일에 owner가 없었다: 임시 파일에 flock을 걸어 두고 같은 이름의 다음 게시가 풀린 것만 거둔다 | 수정 e270d75 |
| P0V-85 | R6-08 | runtime/provision.ts, git/canonical-command.ts | canonical `main`을 child git의 fetch·update-ref가 직접 쓰던 것을 생성 전용 CAS(`createCanonicalRef`)로. gate가 보는 경계가 되고 SIGKILL 시험을 등록했다 | 수정 e270d75 |
| P0V-86 | R6-09 | domain/utf8.ts, extension/utf8.ts, decoder 열다섯 곳 | UTF-8 읽기 owner 하나: 잘못된 바이트는 거절하고 U+FEFF는 글자로 남긴다. strict JSON은 BOM을 다른 글자처럼 거절한다. 빈 문서 판정은 context 정책의 것이다. 규칙 `utf8-decoder-owner` | 수정 2762903 |
| P0V-87 | R6-10 | storage/ledger-reader.ts, store.ts | 뜻 있는 순서를 rowid로. 규칙 `ledger-order-clock` | 수정 53409b8 |
| P0V-88 | R6-11 | reconcile/operations.ts | 관측자의 판정을 다시 관측자에게 넘기지 않는다 | 수정 53409b8 |
| P0V-89 | R6-12 | domain/persisted-formats.ts | 쓰이지 않는 약한 중복 검사를 지우고, 시험은 owner(plan decoder)를 본다 | 수정 53409b8 |
| P0V-90 | R6-13 | config/generations.ts | 재사용은 트리 전체가 같을 때만 | 수정 53409b8 |
| P0V-91 | R6-14 | authority.ts | `specHash` 필수 | 수정 53409b8 |
| P0V-92 | R6-15 | broker/internal-dispatcher.ts, store.ts `retriedOperation`, lifecycle/create.ts 외 | 이름 없는 `!` 열일곱 곳을 이름 있는 가드로 | 수정 53409b8 |
| P0V-93 | R6-16 | broker.ts, reconcile.ts | `hasGoal` 필수, fallback 둘 제거 | 수정 53409b8 |
| P0V-94 | R6-17 | views.ts `fieldEscape` | 제어 문자 전부를 되돌릴 수 있게 escape | 수정 53409b8 |
| P0V-95 | R6-20 | units.ts | owner를 알 수 없는 unit은 교체하지 않는다. `systemctl show` 형식 가정은 `effectiveExecArgv` 한 곳 | 수정 53409b8 |
| P0V-96 | 시험 보강 중 발견(R6-08의 남은 것) | storage/durable-fs.ts, delivery-receipt.ts, immutable-file.ts | 설정 commit과 receipt를 실제 SIGKILL로 끊는 시험이 찾았다: receipt 게시, 파생 파일 교체, immutable 복사(EXDEV)가 죽은 writer의 임시 파일을 영구히 남겼다. P0V-84의 규칙(임시 파일은 writer의 죽음 증명을 지니고, 같은 이름의 다음 게시가 풀린 것만 거둔다)을 공유 helper(`createLockedTemporary`, `collectDeadTemporaries`)로 옮겨 세 곳에 둔다. immutable 게시는 목적지가 이미 있으면 link가 EEXIST를 먼저 내 복사 경로에 닿지 않으므로 수거를 게시 시작에 둔다 | 수정 e4f4f74 |
| P0V-97 | 같은 시험 | config/generations.ts `collectManagedGenerations` | 첫 managed commit이 commit point 전에 죽으면 bundle은 아직 manual이라 현재 세대가 없고, 수거가 그 경우 일찍 돌아가 manifest 임시본을 남겼다 | 수정 e4f4f74 |

원칙에 따라 함께 고친 곳: P0V-77은 quarantine·context 준비·workspace clone·provision staging 네 곳에 같은 lease를 두었다. P0V-81은 broker
밖의 draining 프로세스 다섯 곳을 같은 목록으로 옮겼고, 그 탐색에서 P0V-82를 찾았다. P0V-86은 decoder 열다섯 곳을 모두 owner로 옮겼다.
P0V-92는 R6-15의 두 자리와 같은 모양(`claim === "retry"` 뒤의 `getOperation(…)!`) 열다섯 곳과 create의 `getAgent(…)!`를 함께 고쳤다.
P0V-93은 reconcile의 반대 방향 fallback도 지웠다.

재현한 것: 보고서 §8의 스크립트를 빌드 뒤 돌려 옛 코드에서 모두 재현했고, 수정 뒤에는 R6-01 `guard: blocked`, G07 `context is larger than a
request can carry (8388608 bytes)`, G06 BOM frame 거절, G07-sweep `failureCalls: 1`을 확인했다.

판정을 바꾼 곳: R6-05의 상한은 보고서가 적은 frame(256 KiB)이 아니다. context와 bundle은 frame 뒤의 raw stream이라 society의
`contextBytes`·`bundleBytes`가 상한이다. R6-09의 "문서 시작과 stream 중간을 구분하는 decoder"는 두지 않았다. decoder는 그것을 알 수 없고,
구분이 필요한 곳(빈 GOAL.md)은 그 규칙의 owner(context 정책)가 정한다.

R6-08의 "설정 commit과 receipt에도 crash-worker 방식"은 시험 보강에서 했다: `test/crash-kill-boundaries`가 managed·inline 설정 commit,
receipt 게시, 파생 파일 교체, 파일시스템을 건너는 immutable 게시를 durability 지점마다 실제 SIGKILL로 끊고, 남은 것을 제품의 loader와
정산 판정으로 읽는다. 그 시험이 P0V-96·P0V-97을 찾았다. 관측 seam이 없는 요청 cache freeze와 project binding은 flush마다 앞뒤로 끊는다.
gate의 경계별 가장 강한 주입은 sigkill 44, in-process-fault 10, logical 10이다.
남긴 것: symlink 임시본(`replaceDerivedSymlink`)은 flock을 걸 수 없어 죽음 증명이 없다(broker 하나가 쓰는 context 포인터이고 창은
symlink와 rename 사이뿐이다). crash lane(`crash-boundaries`)은 일회용 user manager가 있어야 돌아 이 환경에서 돌리지 않았다.

### 기존 시험의 기대를 바꾼 곳

- `context-security`, `preaccept-ownership`, `r21-context-*`: P0V-77의 lease 파일을 트리와 따로 센다. 거절된 요청의 lease는 트리와 함께 간다.
- `audit-cli-submit`: bundle 읽기 실패 주입이 이제 bundle이 실제로 지나는 `readSync`를 겨냥한다(P0V-78).
- `r17-lifetime`, `oma-composition-policy`(T119): `HOST_LOSS_SIGNALS`에 SIGQUIT이 있다. T119 harness가 그 목록 모듈을 준다(DR17).
- `r30-views`: CR은 지우지 않고 `\r`로 escape한다(P0V-94).
- `persisted-format-boundary`: locator 소유 확인은 plan decoder가 한다(P0V-89).
- `domain-policy`, `runtime-contracts`: `resolvedSpecOf`에 digest를 준다(P0V-91).
- Broker·ReconcileModule을 조립하는 시험 열여섯 곳: `hasGoal`을 명시한다. 값은 예전 fallback과 같다(`fixtures/goal.ts`, P0V-93).
- PiAdapter·principalEnvironment에 한도를 주는 시험 일곱 곳: `contextBytes`·`bundleBytes`가 더해졌다(P0V-78).
- `durable-fault-matrix`(P7 derived rename): in-process 충돌의 임시본은 같은 이름의 다음 교체가 거둔다(P0V-96). "임시본 하나가 남는다"는
  기대는 "다음 교체 뒤에는 남지 않는다"가 되었다.
- `p0-review4`(P0V-26): owner 줄도 state tree도 없는 unit을 Description만으로 제 것이라 하던 기대는 R6-20이 지적한 판정 그 자체였다.
  이제 owner 줄이 있어야 제 것이고, 없는 것은 교체하지 않는다(P0V-95). 전체 시험에서 찾았다.

### 수정 검증

수정마다 시험을 먼저 쓰고, 고친 판정만 되돌리는 변이를 넣어 해당 시험이 실패하는지 확인했다(`scratchpad/mutate.sh`: 빌드된 파일에 변이를
넣고 그 시험만 돌린 뒤 되돌린다). 모두 KILLED다. 처음 쓴 시험 둘이 살아남아 고쳤다: P0V-76과 P0V-87의 시험은 대상 객체가 만들어질 때
`Date.now`를 잡아 두므로, 시계를 객체보다 먼저 쥐도록 했다. 규칙(`host-loss-signals`, `utf8-decoder-owner`, `ledger-order-clock`,
`principal-session-env`의 새 이름)은 accept·reject·near-miss fixture와, 실제 트리에서 되돌린 변이로 확인했다. 회귀 시험은
`test/p0-review6.test.ts`(durable lane, requiredNames 6개)와 각 owner의 시험 파일에 있다. 전체 `npm test`의 실패는 기록 결박(R38 둘, V32A
둘: 새 production 파일이 validation과 review ledger에 없음)뿐이다.


## v22 결박이 찾은 것

2026-09-28, DR18 뒤에 v21 이후의 커밋 전부를 한 트리로 결박하려고 전체 시험과 lane을 돌렸다. v21 뒤로 kernel·crash·durable lane을
돌린 적이 없었으므로(5차·6차 점검과 DR18은 관련 시험 묶음과 전체 `npm test`로 검증했다) lane이 넷을 찾았다. 모두 고쳤고, 고친 뒤
같은 lane이 통과했다. 제품 결함은 P0V-98과 P0V-101이고, 나머지는 시험·lane이 규칙을 따라오지 못한 것이다.

| ID | 발견 | 파일 | 요약 | 상태 |
|---|---|---|---|---|
| P0V-98 | v22 kernel·crash lane(LIFE-009, CLI acceptance, T39 부팅·생성 경계 14개) | units.ts `install` | P0V-59가 unit 설치를 no-replace 게시로 바꾸면서, 교체 경로(`replaceDerivedFile`)가 하던 unit 디렉터리 생성을 잃었다. 그 사용자의 첫 Resident 설치가 ENOENT로 실패했다(unit 디렉터리가 아직 없는 user manager). 설치는 게시 전에 unit 디렉터리를 durable하게 만든다. 시험: `P0V-98 / P0V-59, P0-3:`(가짜 systemctl) | 수정 |
| P0V-99 | 같은 kernel lane(T36, T38, REC-001, T-create-ready, T41, V25A, V23B) | test/phase4.test.ts | Resident unit 자리에 시험이 손으로 쓴 unit이 P0V-59의 소유 줄(Description, X-OMA-Owner)을 갖지 않아 다른 소유자의 unit으로 판정됐다(runner 인증 실패, 관측이 unit 없음). 시험 unit은 rendered unit과 같은 소유 줄을 쓴다(`ownedBy`). 제품의 판정은 옳았다 | 수정 |
| P0V-100 | v22 durable lane(critical oracle not executed) | scripts/verification-lanes.mjs | P0V-61이 이름을 바꾼 AV7 시험 둘을 durable lane이 옛 이름으로 요구했다. lane은 지금 이름을 요구하고, fast lane의 `R35 every required name of every lane is the start of a test in this tree`가 lane이 아무 시험도 싣지 않는 이름을 요구하면 그 rename에서 실패한다 | 수정 |
| P0V-101 | DR18 뒤 전체 `npm test`(T117 셋, AV16) | process/async.ts `spawnSandboxed`, test/resident-sandbox-live.test.ts | D-5가 모든 Resident argv에 `--seccomp 3`을 넣었지만 bwrap을 직접 띄우는 primitive와 시험 probe는 fd 3을 주지 않아 bwrap이 거절했다. `spawnSandboxed`가 plan의 filter를 fd 3으로 넘기고, filter와 `--seccomp`가 짝이 아니면 거절한다. 같은 전체 실행이 D-8의 고정 port 표면(P17/P23)과 broker 조립 시험의 `assertStateRoot` stub, CI가 platform lane을 돌리지 않는 것(T125)도 찾았다 | 수정 dea7f03 |

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


## 7차 점검 — 2026-09-28 적대적 검토

기준점은 `070a52d`이고, 입력은 로컬 `review/adversarial-2026-09-28/REPORT.md` 및 그룹 보고서다.
원본 review 디렉터리는 수정·커밋하지 않는다. 아래는 중복 발견을 원인별로 묶은 판정이며,
보고서의 발견 개수와 P0V 번호는 일대일이 아니다. 규범 판단은 DR19, 현재 검증 상태는 validation이 소유한다.

### 수정한 원인과 대응

| 회귀 항목 | 보고서 항목 | 수정·같은 원인의 관련 위치 | 근거·commit |
|---|---|---|---|
| P0V-102 | F-01/F-05, G05-01/03, X1-01/02 | AF_VSOCK·io_uring·x32·keyring·bpf·perf·userfaultfd 차단, 두 spawn의 filter 전달 통합 | SB-001, P0-2/6; `fcdc67e` |
| P0V-103–106 | F-02/03/08/09, G12-01–04/06, G13-01–04, X2-01–03 | host 원자적 게시·singleton, 직접 stream 암호화·오류 반납, snapshot sequence·잔재 회수, guest 한 fd 전송·instance 게시·bundle capability 상한·동명 session 재시작 | P0-4/5; `f5a3237` |
| P0V-107 | F-04, G01r2-01 | 게시된 receipt의 정산에서 mutable session 파일의 현재 상태를 제거 | P0-1, BATCH-006; `19dbd8d` |
| P0V-108/109 | F-06, G11-tui-01/02, G12-05 | 표시·paste Cc/Cf 규칙 통합, 폭 0 cluster 보존, DEC mode 복구 | TUI-002, P0-2/4; `909c613` |
| P0V-110 | F-07, G10-01 | session branch에 근거한 재시도 key; 실제 엔진 모양의 fixture | P0-4/5; `a78b40c`, `455abbd` |
| P0V-111 | G01-01, G01r2-02 | 같은 디렉터리의 dead held temporary 회수, derived link 잔재 회수 | P0-4; `e179ec7` |
| P0V-112 | G02-ledger-r2-02 | RequestCache metadata를 명시 byte 상한 안에서 읽음 | P0-6; `e179ec7` |
| P0V-113 | G03-broker-r2-01 | 실제 listening을 await한 후 admission·run·invocation을 재검증하고 incarnation commit. 비동기 bind 실패·대기 중 revoke/drain·transaction 실패 시 endpoint 반납과 동일 invocation fence 유지 | P0-4; `e8c82c3` |
| P0V-114 | G04-01/02/03, G03-broker-05 | HostTenure가 egress까지 소유. startup socket 이름 청소 통합. close 뒤 수동 unlink 제거 | P0-2/4; `e8c82c3` |
| P0V-115 | G05-02 | template에서 실제 사용하는 society/actor 이름을 기존 grammar로 검증 | P0-6; `e8c82c3` |
| P0V-116 | G06-01/02 | git 관측과 CAS 효과 모두 같은 ref/OID argument 검증 | P0-2/5; `e8c82c3` |
| P0V-117 | G07-01 | fd가 실제 pidfd인지 확인한 뒤 liveness 판정 | P0-5; `bf95ce2` |
| P0V-118 | G07-02/03 | mail DTO 타입 거절, string/bytes header의 공통 검증 | P0-2/6; `bf95ce2` |
| P0V-119 | G08-01/03, G09-01/02 | JSON nesting 단일 상한과 frame 선검사, throw 계약 정정. 숫자는 명세 기반임을 확인하고 golden vector 추가 | P0-6; `fe25164` |
| P0V-120 | G10-04 | 충돌 포트 fallback에 더해 extension factory가 listen을 기다리도록 보강. 처음부터 남의 포트를 등록하지 않음 | P0-5; `cc7d437` 및 후속 수정 |
| P0V-121 | G10-05 | truncated journal이라도 signal/abort/unknown/spawn failure를 성공으로 만들지 않음 | P0-5; `cc7d437` |
| P0V-122 | G10-02/03 | quota 판정 owner를 serialized write 하나로 통합. fd로 승인한 single-link 파일만 private snapshot에 복사하여 grep/find가 검색(context=0 포함). 자식 owner가 부모 종료·취소 때 snapshot과 walker group을 정리 | P0-2/6; `cc7d437` |
| P0V-123 | G03-broker-01/r2-02 | dispatch 후 frame 초과는 possible effect·same-key. git.known의 prerequisites는 complete 목록이 아닌 bounded subset임을 명시(G03-broker-02) | P0-5; `649ea6e` |
| P0V-124 | G03-broker-r2-04 | 다섯 인증 경로가 cgroup 경계 판정 하나를 공유 | P0-2; `649ea6e` |
| P0V-125 | G02-ledger-r2-01 | 불필요한 매 요청 전체 조회 제거. full-set/조상 체인은 유한 row/byte collector로 거절 경계 보유. batch 후보는 upper-rowid keyset page와 class별 bounded 선택. status 응답에 명시적 continuation — **full-set 유한 collector 부분은 2026-10-07 UX-37로 폐기됨(아래 비해당 표 G02-ledger-r2-01 행의 폐기 주석 참조)** | P0-2/6; `649ea6e` |
| P0V-126 | G02-ledger-r2-03 | agent·ledger·operation writer에 Store의 같은 clock 주입, 기존 clamp 유지 | P0-2; `649ea6e` |
| P0V-127 | G05-04 | foreign unit은 observe/observeAsync에서 unknown. confirmDead·cgroupProcs가 죽음·빈 목록으로 승격하지 않음. stop은 자기 권한만 revoke하고 foreign unit에는 효과 없이 RUN_TERMINATION_UNKNOWN | P0-1/5; 후속 수정 |

### 비해당·기존 한계 및 미해결 부분

| 보고서 항목 | 판정과 근거 |
|---|---|
| G03-broker-03 | 변경 불필요. len=0은 유효 JSON 요청이 아니며 INVALID_REQUEST와 sticky poison이 frame 계약에 부합한다. keepalive로 새 의미를 주지 않는다 |
| G01-02/G01r2-03 | 기존 위협 모델 밖: 같은 UID의 비협조 프로세스가 receipt 디렉터리 자체를 삭제하는 것은 S-06의 process-crash 증거가 아니다. 삭제를 정상 운영 복구라고 보장하지 않는다 |
| G01-03 | 변경 불필요. fsyncTree가 symlink를 거절하는 보수적 기본 정책이며 현재 caller는 해당 link를 만들지 않는다. 미래 caller가 link를 필요로 하면 별도 근거가 필요하다 |
| G08-02 | DR14의 기존 한계. unit 이름은 유지하고 서로 다른 owner의 충돌을 AGENT_CONFLICT로 거절한다 |
| G03-broker-04/r2-03 | 기존 환경 한계. Yama scope 0의 같은 UID ptrace 공격에 Principal 경계를 주장하지 않는다 |
| G07-04 | 변경 불필요. allocation 전에 whole size를 limit과 비교하고 head는 min(size, limit)+1만 할당한다. 제한 내 선할당은 자원 고갈 우회가 아니다 |
| G08-03 | 원 보고의 전제 정정. Number::toString은 ECMA-262 명세 알고리즘이다. 숫자 wire 의미를 바꾸지 않고 golden vector로 결박했다 |
| G12-07 | 변경 불필요. control 700, 나머지 701 뒤 hello.channel dispatch는 의도된 protocol이다. 포트만으로 권한을 부여하지 않는다 |
| G10-02 | 검색 입력을 fd-승인 복사본으로 제한하여 수정. pinned grep/find의 regex/glob/ignore, 기본/context=0, link 및 root 교체 반례, 취소·부모 사망·비협조 walker 정리를 검증했다. snapshot owner 자체의 SIGKILL과 OS crash까지 정리를 보장하지 않는다 |
| G02-ledger-r2-01 | 무제한 물질화를 bounded iterator/collector로 수정. batch는 128행 keyset page이며 class별 선택 상한을 유지한다. full-set 경로는 10,000행/32 MiB 초과를 LIMIT_EXCEEDED로 거절한다. status는 응답 pagination이지 DB 전체 snapshot paging이 아니며 무한 backlog 지원을 주장하지 않는다. **[2026-10-07 폐기·대체 — UX-37]** 당시 "full-set 경로는 유한 collector로 거절" 판정은 운영 읽기에 관리자 진단 예산을 공유시켜 정상 사용이 크기만으로 거절되는 결함이었다(사용자 기준 1·9·13). 현재 계약: 운영 읽기는 크기로 거절하지 않고 완전 결과를 카운트 집계·keyset 스트림·완전 수집으로 답하며, LIMIT_EXCEEDED는 관리자의 `readDiagnosticSnapshot`에만 남는다. `docs/user-expectation-ledger.md` UX-37과 WORKSTREAM §9 2026-10-07 항목이 현재 판정을 소유한다 |
| G03-broker-r2-01 | listening 준비 완료 후 재검증·commit으로 수정. 실제 비동기 listen error와 drain 중 거절을 시험했다. commit 이후 이미 성립한 incarnation은 되돌리지 않고 동일 invocation fence를 유지한다 |
| G03-broker-01/r2-02 | operation.read의 actor/key·digest·offset 조각과 CLI 재조립으로 수정. 실제 stop 효과 1회, chunk 단절, broker/ledger 재시작, 같은 key 회수, 다른 actor 거절을 시험했다. 64 MiB/전체 deadline 초과와 모델 도구의 별도 1 MiB 출력 상한은 결과 불명으로 남기며 재실행하지 않는다 |

### 검증의 범위

회귀 시험은 `p0-review7` 및 각 owner 시험(sandbox-seccomp, platform-stream-publication,
platform-host-service, platform-snapshot, receipt-observation, contained-tools, resident-confinement,
engine-inference-chain 등)에 있다. 이번 후속의 foreign 관측과 listen 전 포트 등록 변이는
각각 반례 시험이 실패함을 확인했다. 앞선 수정별 변이·focused 시험 결과는 해당 작업의 실행 로그에 있다.
새 fork·실제 credential·유료 provider·VM 전원 차단을 사용하지 않았다. fake provider와 실제 pinned engine의
로컬 통합 시험은 유료 provider 증거가 아니다. 전체 시험·환경 lane의 최종 상태는 validation에 적는다.

## 원칙 문서의 과거 점검 요약 — 2026-10-02 정리 전

작성 당시 원칙 문서에 섞여 있던 점검 결과를 이 기록 owner로 옮겼다. 현재 검증 판정은 validation이 소유한다.

점검: 215개 production 파일의 1차 점검과 받는 자리 전부의 2차 점검을 마쳤고, 발견 23개(P0V-01–P0V-23)를
고쳤다. 실제 provider 점검(14차)에서 하나(P0V-24)를 더 찾아 고쳤다. 외부 전수 검토를 받아 판정한 4차 점검의 발견
P0V-25–P0V-53은 하나(P0V-44, v1 receipt 형식 안의 한계로 둔 의도된 예외, DR14)를 빼고 고쳤다. 모델만 대본인
시나리오 시험이 두 개(P0V-54, P0V-55)를 더 찾았고 고쳤다(DR15). 외부 재검토 두 건의 5차 점검에서 찾은
P0V-56–P0V-73을 모두 고쳤다(rootfs 수리 순서는 DR16). 6차 점검(외부 검토 R6-01–R6-20)과 그 검증에서 찾은
P0V-74–P0V-95를 고쳤다(R6-19는 의도된 한계로 문서화, 종료 신호 목록은 DR17). 그 뒤의 시험 보강(실제 SIGKILL로 끊는 경계 시험)이 P0V-96·P0V-97을, v22 결박의 lane이 P0V-98–P0V-101을 찾았고 고쳤다. 열린 spike와 결정은 DR18이 닫았다. 7차 적대적 검토의 수정은 P0V-102–P0V-127과 DR19에 기록한다. 부분 수정과 미해결 경계는 감사 기록에서 별도로 표시하며 전부 완료로 세지 않는다. 근거와 수정 commit은 [`docs/priority-0-audit.md`](priority-0-audit.md)에,
설계 판단은 DR9–DR13에 있다. 지금의 검증 판정은 `docs/implementation/validation.md`가 소유한다.

## 2026-10-03 적대적 검증 — 기준 커밋 a75c299

사용자 요청으로 현재 상태를 먼저 `a75c29911c077a2d2b207a48773268e2e2355ca0`에 고정했다.
생산 코드는 수정하지 않았다. 최근 mail-v1 merge/review/challenge의 acceptance, 복구, 이름 해석,
메일 준비와 Git diff 경계를 집중 검증했다. 저장소 전체 파일을 전수 감사했다는 판정은 아니다.
여기서 P0는 [PRIORITY-0](PRIORITY-0.md)의 원칙이며, 아래 P1/P2 수정 우선순위와 구분한다.
과거 P0V 번호의 의미를 재사용하지 않도록 이번 발견은 `AV-20261003-*`로 식별한다.
현재 실행 판정과 명령·로그는 [validation](implementation/validation.md#2026-10-03-적대적-검증)을 따른다.

### 확정 발견

| ID | 우선순위 | 발견 | 원칙·계약 | 상태 |
|---|---|---|---|---|
| AV-20261003-01 | P1 | 복구 sweep이 storage admission 없이 새 integration과 완료 메일을 접수하고 main CAS까지 수행 | P0-4, D04, merge-review §5/6 | 재현, 미수정 |
| AV-20261003-02 | P1 | 서로 다른 UUID의 8자리 prefix가 같으면 다른 요청의 이름으로 첫 요청에 투표하고 합병 | identity/relation, merge-review §3 | 재현, 미수정 |
| AV-20261003-03 | P1 | review mode 또는 입력 한도가 바뀌면 terminal same-key receipt replay가 현재 설정으로 거절됨 | P0-1/3, INV03, merge-review §3 | 재시작 포함 두 조건 재현, 미수정 |
| AV-20261003-04 | P1 | 두 번째 emission freeze 실패가 이미 게시한 첫 번째 미접수 메일 object를 남김 | P0-4 | 재현, 미수정 |
| AV-20261003-05 | P1 | non-UTF-8 text blob의 diff bytes가 완료 메일에서 U+FFFD로 치환됨. 같은 후보의 diff 조회는 실패 | P0-2/5, immutable evidence, merge-review §6 | 재현, 미수정 |
| AV-20261003-06 | P1 | 완료 메일 freeze 대기 중 접수된 새 투표·리뷰가 실제 적용의 완료 공지에서 누락 | Fact/Relation/Phase, merge-review §6 | 비동기 경계 재현, 미수정 |
| AV-20261003-07 | P2 | validator가 허용한 `mailBodyBytes=4096`에서 작은 LOW 요청도 영구 `applying`으로 남음 | configuration/runtime bounds, merge-review §5/6 | validator와 반복 sweep 재현, 미수정 |
| AV-20261003-08 | P2 | production inventory와 LOC/hash artifact가 다른 source를 가리켜 architecture gate 실패 | P0-7, TRACE-002/003, 검증 evidence | 실제 명령 실패, 미수정 |
| AV-20261003-09 | P1 | challenge ref의 확인된 손상을 foreground 경로가 삼켜 새 acceptance fence가 열려 있음 | P0-2/5, STORE_CORRUPT fence | 실제 ref 충돌과 recovery 대조 재현, 미수정 |
| AV-20261003-10 | P2 | Worker용 archive에서 읽은 메일에 `oma_mail_send`로 답장하면 공개 archive를 잘못 찾아 실패 | P0-2, audience resolver, MAIL-004 | 실제 extension→CLI 재현, 미수정 |
| AV-20261003-11 | P2 | 복구로 늦게 도착한 메일을 실제 도착보다 먼저 생성된 inode mtime으로 정렬 | P0-5, TUI arrival observation, merge-review §6 | 실제 immutable hardlink와 recovery 재현, 미수정 |
| AV-20261003-12 | P2 | 긴 thread의 omission anchor가 한도를 채우면 새 vote와 cancel 모두 불가능하고 재시작해도 지속 | bounded history/action availability, P0-6, merge-review §3 | 40개 정상 접수와 재시작 재현, 미수정 |
| AV-20261003-13 | P2 | relay listen 이후 chmod 실패가 소켓 이름과 실행 중 listener를 반환하지 않음 | P0-4, construction ownership | 실제 Unix socket + EIO 주입, 미수정 |
| AV-20261003-14 | P1 | boot 폐기·stop 완료 뒤 이전 credential resolve가 run/relay 권한을 다시 생성 | P0-1/4, MAC-211/712 | 비동기 경계와 실제 relay 응답 재현, 미수정 |
| AV-20261003-15 | P1 | guest run 종료가 host run/credential 해제로 전달되지 않아 실행마다 누적 | P0-4, MAC-225 | 정상 close 3회와 명시적 release 대조 재현, 미수정 |
| AV-20261003-16 | P2 | detached relay의 `emit(connection)` 경로가 일반 listener의 idle 연결 수 제한을 적용하지 않음 | resource boundedness, WP27, MAINTENANCE §21 | 일반 4 / detached 6 연결 대조 재현, 미수정 |
| AV-20261003-17 | P2 | guest 요청 원장이 잘못된 타입의 durable outcome을 truthiness로 해석해 거절을 done으로 표시 | P0-2/5, MAC-240/241 | 정상 거절 기록·손상·reopen·same-key replay 재현, 미수정 |

### AV-20261003-01 — 복구에서 새 효과의 quota admission 누락

위치: [reconcile.ts](../packages/reconcile/src/index.ts) `startup`의 112–117행, `sweep`의 157–160행;
[review.ts](../packages/review/src/index.ts) `advanceAll`, `createIntegration`의 939–1009행.

Fact는 이미 접수된 MEDIUM open과 승인표다. 하지만 그 표에 따른 integration은 아직 접수되지 않았고,
새 완료 메일 object·operation·delivery·CAS는 새 소비다. 기존 operation 복구는 `resourceGate`를 호출하지만,
그 뒤의 `reviews.advanceAll()`은 gate나 notice 용량 예약 없이 이 새 소비를 만든다.

실제 Git writer를 잠시 점유한 동안 승인표를 접수해 자동 advance를 연기한다. writer를 해제한 뒤,
fixture state tree에 대한 **실제 `StorageAdmission(root, 1, 0)`**이 `QUOTA_EXCEEDED`를 반환함을 확인한다.
이 admission owner를 연결한 실제 `ReconcileModule.sweep()`은 gate 호출 0회로 integration을 succeeded로 만들고
main을 candidate로 바꾼다. Units 관측만 로컬 stub이며 실제 manager는 사용하지 않는다.

수정 방향: 새 integration과 refresh의 admission·artifact 예약을 effect owner에 전달하고,
이미 확정된 CAS/메일의 정산과 새로운 artifact 소비를 구분한다. caller record와 startup/sweep에 같은 owner를 적용한다.

### AV-20261003-02 — 요청 이름의 충돌이 다른 candidate를 적용

위치: [identifiers.ts](../packages/domain/src/identifiers.ts) `reviewRequestNameFor`의 88–90행;
[review.ts](../packages/review/src/index.ts) `requestByName`의 127–131행과 open acceptance.

이름은 UUID의 앞 8자리, 즉 32 bit만 사용한다. acceptance는 동일 이름의 다른 immutable ID를 검사하지 않고,
조회는 이름이 처음 일치하는 row를 고른다. duplicate scan은 candidate/base/tier/policy만 검사하므로 이 충돌을 막지 못한다.

서로 다른 정상 UUID `12345678-1111-4111-8111-111111111111`과
`12345678-2222-4222-8222-222222222222`를 UUID generator 경계에 주입한다.
다른 candidate 두 개의 open이 모두 `merge-12345678`을 반환한다. 두 번째 open의 반환 이름으로 승인하면
첫 번째 candidate가 실제 main에 적용되고 두 번째 integration은 없다. DB row를 변조한 재현이 아니다.
실제 호출자가 UUID를 선택할 수 있다고 주장하지 않으며, 정상 random UUID에도 가능한 prefix 충돌을 고정한 시험이다.

수정 방향: 이름→immutable ID의 유일성을 acceptance owner에서 강제하고, 충돌이면 새 ID로 준비하거나
효과 없이 명시적으로 거절한다. merge와 challenge, status/diff/vote/cancel/target lookup 모두 같은 관계를 사용한다.

### AV-20261003-03 — 과거 same-key lookup 앞의 현재 정책·한도 검사

위치: [review.ts](../packages/review/src/index.ts) `record`의 168–179행;
`src/attestation.ts` `record`의 34–47행(당시 경로; DR46에서 삭제됨).

600-byte reason을 가진 open을 succeeded로 접수하고 Store를 닫았다 다시 연다. 같은 입력·key를 새 GitModule로 보내면,
`review: mail-v1`을 없앤 경우 `UNSUPPORTED_PROFILE`, `mailBodyBytes`를 2000으로 낮춘 경우
`INVALID_REQUEST`가 나온다. `claimKey`와 terminal receipt 반환 전에 현재 mode/한도를 적용하기 때문이다.
legacy→mail-v1 전환의 legacy attestation gate도 같은 순서다.

**DB의 succeeded fact 자체는 바뀌지 않고 `operation.get` 조회는 가능하다.** 발견 범위는 동일 mutation key의
historical replay가 현재 정책으로 거절되는 API 계약 위반이며, terminal row가 failed로 덮였다는 뜻은 아니다.
수정 방향: 구조·identity/hash 확인과 historical lookup을 새 소비의 정책·입력 한도 판단과 분리한다.

### AV-20261003-04 — 여러 파일 준비의 부분 실패에 수명 owner가 없음

위치: [review.ts](../packages/review/src/index.ts) `freeze`의 811–817행,
`accept`의 203–206행, `acceptPrepared`의 216–223행; `createIntegration`도 같은 `freeze`를 사용한다.

HIGH의 두 번째 peer approve는 worker thread와 Principal approval 두 emission을 준비한다.
첫 emission을 실제로 freeze한 뒤 두 번째 호출에 `BROKER_UNAVAILABLE`을 주입하면,
vote operation은 접수되지 않았지만 첫 `.eml` object는 남는다. scope는 모든 freeze가 끝난 후에 만들어지므로
이 거절 경로는 앞서 만들어진 artifact를 반납하지 않는다. 같은 key retry마다 다른 operation UUID로 새 잔재가 생길 수 있다.

시작 복구의 `collectUnacceptedArtifacts`는 이런 잔재를 회수할 수 있다. 문제는 살아 있는 broker의 확정된
preaccept 실패마다 파일이 쌓이고, 다음 시작 전까지 quota를 소비한다는 것이다. 영구 복구 불능이라고 분류하지 않는다.
수정 방향: 파일이 생긴 순간 scope에 등록하고 준비 루프의 부분 실패에서도 같은 scope를 정산한다.

### AV-20261003-05 — raw diff와 완료 evidence의 encoding drift

위치: [canonical-command.ts](../packages/git/src/canonical-command.ts) `canonicalMergeDiff`의 78–79행;
[code.ts](../apps/oma/src/cli/effects/code.ts) `readCode`와 공통 `runGitText` text decoder.

`ff 0a` 두 bytes로 된 text blob은 Git의 binary 판정에 걸리지 않아 `git diff --binary --full-index`도
patch 본문에 raw `ff`를 출력한다. `Buffer.toString('utf8')`는 예외를 던지지 않고 이를 `ef bf bd`로 치환한다.
따라서 catch는 검증이 되지 않는다. 실제 LOW merge는 succeeded이고 완료 메일도 이 치환된 diff를 게시한다.
동일 후보의 `oma_merge diff`가 사용하는 `readCode`는 공통 strict decoder 때문에 `INTERNAL_ERROR`로 거절한다.

원본 Git blob이나 main commit이 변조되는 것은 아니다. **실제 적용 diff라고 게시한 evidence bytes가 달라지고**
리뷰와 완료 공지의 판정 owner가 다르다는 문제다. 수정 방향: diff의 raw bytes와 메일 표현을 한 owner에서 처리하고,
가역 encoding 또는 실제 binary patch를 쓰거나 CAS 전에 명시적으로 거절한다. 조용한 치환은 허용하지 않는다.

### AV-20261003-06 — frozen 공지와 acceptance 시점 리뷰 상태가 다름

위치: [review.ts](../packages/review/src/index.ts) `createIntegration`의 952–964행과 974–981행.

MEDIUM을 승인한 Bob의 첫 vote로 만든 완료 notice의 freeze를 await 경계에서 멈춘다.
그 사이 Bob의 새로운 approve와 `UPDATED review must appear` 본문을 정상 접수한 뒤 freeze를 재개한다.
실제 CAS와 integration은 succeeded이며 latest vote는 새 본문이지만 완료 공지에는 그 표가 없다.

acceptance는 `fresh.ready`만 검사한다. readiness가 계속 true면, 공지를 만든 리뷰 snapshot과 fresh ledger의 차이를
검사하지 않고 오래된 document를 확정한다. `acceptPrepared`에는 `sameDecision`이 있지만 integration 준비에는 없다.
수정 방향: 공지에 결박한 리뷰 snapshot을 T에서 검증하고 drift 시 기존 미접수 artifact를 정리한 뒤 새 공지를 준비한다.

### AV-20261003-07 — 지원되는 설정과 notice part 최소 크기 불일치

위치: [limits.ts](../packages/domain/src/limits.ts) `PROTOCOL_LIMIT_FIELDS.mailBodyBytes`의 7행;
[review.ts](../packages/review/src/index.ts) `splitNotice`의 1166–1169행과 `record`의 195–197행.

전체 `validateConfig(defaultHostConfig(...))`는 `mailBodyBytes=4096`을 허용한다.
그 설정의 작은 LOW open은 succeeded로 접수되지만 notice budget이 `mailBodyBytes - 4096 = 0`이 되어
매번 `INTERNAL_ERROR`가 난다. 반복 sweep 후에도 integration은 없고 main은 base이며 status는 `applying`이다.
validator가 지원한다고 표시한 범위에 대한 기능 결함이다. 설정의 committed bytes가 손상되거나 다시 로드되지 않는 문제는 아니다.
수정 방향: 실제 part overhead와 분할 budget의 관계를 동일 bounds owner에서 검증하고, 불가능한 설정은 commit 전에 거절한다.

### AV-20261003-08 — stale production 측정과 현재 문서 판정

위치: [production-files.txt](../production-files.txt), [production-loc-hashes.json](../production-loc-hashes.json),
[검증 상태](implementation/validation.md)의 2026-10-02 기록.

`npm run check:architecture`는 첫 `check:inventory`에서
`production-loc-hashes.json was taken from a different file list`로 exit 1이다.
실제 production inventory는 356 files, hash 기록은 355 files다.
`packages/config/src/role-prompts.ts`가 빠졌으며 defaults, pi-interactive-host, mail-tools, principal-tools, review-tools,
pi-spawn-plan, tui/session, views의 source hashes도 다르다. 현재 production 코드를 검증한 artifact로 사용할 수 없다.

기존 HANDOFF/validation의 “새 merge-review는 다음 구현 설계”도 최신 구현 commit과 다르다.
문서·측정의 예전 PASS를 현재 source PASS로 올리지 않는다. 이번 감사는 측정값을 손으로 보정하지 않았으며
기존 runtime의 release-blocked 판정을 유지한다. 수정 방향은 생성 도구로 재측정·source binding을 갱신하는 것이다.

### 재현 artifact와 감사의 범위

[독립 재현 코드](../test/audit/adversarial-2026-10-03.mjs)는 제품이 지켜야 할 동작을 assert한다.
현재 결함을 성공으로 기대하는 시험이 아니며, 기준 생산 코드에서 8개 oracle이 각각 해당 발견 때문에 실패한다.
`03a/03b`는 하나의 원인을 두 조건으로 검증한다. root-level normal suite inventory에는 포함하지 않았다.
수정 시 이 oracle을 정상 회귀로 편입하고 필요한 crash/retry/restart coverage를 이어 연결할 수 있다.
실행 source와 oracle의 bytes는 [감사 evidence](../test/audit/adversarial-2026-10-03.evidence.json)에 결박했다.

임시 SQLite/Git/file fixture와 quota scan, UUID 충돌 주입, file freeze 부분 실패, notice 준비 대기를 사용했다.
이번 주입은 실제 SIGKILL이나 kernel durability proof가 아니며, systemd/VM/native Mac/provider 검증을 대신하지 않는다.
1차 thread history 탐색은 취소가 불가능하다는 가설을 확인하지 못했다. 그 당시에는 확정 발견에서 제외했다.
아래 2차 탐색은 다른 지원 한도에서 이를 독립 재현한 후 AV-20261003-12로 기록했다.

### 2차 검증 — 메일·권한·설정·IPC 경계 확장

사용자의 “이게 끝인가” 질문 뒤 같은 기준 생산 source에서 범위를 넓혔다. 제품 결함 4건을 추가 확인했다.
확정 합계는 제품 결함 11건과 검증 artifact 불일치 1건이며, 추가 생산 코드 수정은 없다.
이는 전수 검증 완료나 남은 결함 부재의 증명이 아니다. 선택한 경계와 파일의 판정을 기록한다.
새 [독립 oracle](../test/audit/adversarial-2026-10-03-second.mjs)과
[2차 evidence](../test/audit/adversarial-2026-10-03-second.evidence.json)가 실제 실행과 source를 결박한다.

### AV-20261003-09 — foreground가 손상 관측을 fence에 전달하지 않음

위치: [review.ts](../packages/review/src/index.ts) `record`의 193–198행과 `acceptPrepared`의 253–258행;
[admission.ts](../packages/domain/src/admission.ts) `AdmissionGate.observe`, `observeStoreFailure`;
[reconcile.ts](../packages/reconcile/src/index.ts) `retainRecoveryFailure`의 138–147행.

LOW merge를 적용한 뒤 HIGH prepared challenge를 연다. 로컬 physical corruption fault로 해당 challenge의
`refs/oma/published/bob/<operation>`을 revert candidate와 다른 정상 commit으로 만든다. DB row는 변조하지 않는다.
실제 `ensureChallengePublished`가 이를 `STORE_CORRUPT`로 판단한 로그가 publish와 자동 advance에서 두 번 나온다.
그러나 두 catch 모두 오류를 로그로만 남겨 challenge는 succeeded, 연결한 실제 AdmissionGate는 healthy이며,
뒤따른 일반 mail.send도 succeeded로 접수된다.

같은 Store/ref를 실제 ReconcileModule.sweep에 넘기면 같은 충돌이 전파되고 동일 gate가 corrupt가 된다.
이 대조는 손상 판정의 의미가 foreground와 recovery에서 다름을 증명한다. 아직 실행되지 않은 효과가 unknown인 경우와
이미 확인한 durable 손상을 구분해야 한다. 최대 다음 정기 sweep까지라도 손상 상태의 새 접수 창이 존재한다.
수정 방향: 이미 접수된 challenge/vote의 receipt를 보존하면서 확인된 corruption을 공통 fence owner에 전달한다.
receipt 보존을 이유로 STORE_CORRUPT 관측까지 삼키지 않는다.

### AV-20261003-10 — Worker archive reply resolver 누락

위치: 당시 `src/extension/mail-tools.ts` `readBoundedMail`의 69–87행
([현재 owner](../packages/extension/src/mail-tools.ts)),
`oma_mail_send.execute`의 365–366행;
[mail.ts](../apps/oma/src/cli/effects/mail.ts) `prepareReplyEffects`.

MEDIUM open의 worker-only thread를 실제 oma_mail_read로 읽으면 성공한다. CLI의 공통 reply reader에 실제 worker
archive path를 직접 주어도 정상 Message-ID를 반환한다. 그러나 같은 path를 oma_mail_send.replyTo에 주면 extension이
ID만 남긴 뒤 `mail/archive/cur/<id>:2,`로 다시 조립한다. CLI는 존재하지 않는 공개 archive 파일을 찾아 exit 2이다.
명시적인 worker archive path와 ID 모두 이 resolver를 거치므로 같은 결함이다.

재현은 실제 compiled extension과 CLI child를 사용하고, 임시 Unix socket의 fixture endpoint까지 준비한다.
실제 실패에서는 송신 frame 0개, reply operation 없음이다. Principal에게 worker mail이 노출된다는 주장은 아니다.
수정 방향: 읽기와 reply source resolution에 같은 역할별 archive owner를 적용하고, Worker archive fallback도 동일하게 처리한다.

### AV-20261003-11 — freeze timestamp를 arrival로 표시

위치: [mail.ts](../apps/oma/src/application/mail.ts) `readBounded`의 100행, `entriesIn`, `foldThreads`, `byArrival`;
[materializer.ts](../packages/mail/src/materializer.ts) `publishDelivery`의 141–148행.

첫 mail.send를 실제 접수한 뒤 post-accept materialization만 일시 실패시켜 pending으로 둔다.
15 ms 뒤 두 번째 mail.send는 접수·전달이 완료된다. 그다음 실제 reconcilePending이 첫 메일을 새 inbox entry로 전달한다.
도착 순서는 두 번째→첫 번째지만 TUI의 newest-first 순서는 두 번째→첫 번째다. 가장 늦게 도착한 첫 메일이 올라오지 않는다.

inbox entry는 frozen object와 inode·mtime이 같은 hardlink다. 재현에서 mtime이나 immutable bytes를 수정하지 않았다.
`stat.mtimeMs`는 object를 freeze한 시각을 관측한 답이며, 아직 일어나지 않은 delivery의 시각을 증명하지 않는다.
unread 상태나 durable delivery 자체가 사라지는 문제는 아니고, 표시·thread 정렬의 시간 의미가 잘못된 문제다.
수정 방향: delivery/arrival ordering의 근거를 한 owner에서 정의하여 view가 읽게 한다. 공유 immutable inode의 mtime을
덮어쓰는 방식으로 고치면 object와 다른 recipients의 metadata까지 바뀐다.

### AV-20261003-12 — bounded thread가 기존 요청의 종료 경로를 막음

위치: [review.ts](../packages/review/src/index.ts) `threadBody`의 749–790행,
`finishEntry`와 `entryEmissions`의 643–697행; [attestation.ts](../packages/domain/src/attestation.ts) `reviewInputProblem`.

전체 validator가 지원하는 `mailBodyBytes=2048`에서 MEDIUM open을 접수한다. 각각 입력 한도 안의 500-byte review들을
먼저 넣어 omission 경계를 실행하고, 짧은 review들로 남은 공간을 채운다. 정상 접수한 review는 총 40개다.
이후 short review, Carol의 `approve/body=ok`, requester의 `cancel/reason=withdrawn`이 모두
`INTERNAL_ERROR: mail bounds cannot hold a thread revision`으로 접수 전에 거절된다. Store를 다시 연 뒤 같은 cancel도
실패하며 status는 peer-needed다. 임시 fixture 밖의 burst/flood나 서비스 부하 시험은 아니다.

각 생략 항목의 Message-ID를 모두 현재 mail 본문에 넣는 `anchor` 목록은 history 길이와 함께 무한히 커진다.
따라서 오래된 본문을 생략해도 bounded mail이라는 전제가 깨진다. 새 vote/cancel의 접수가 이 rendering 성공에 묶여 있어
과거 history가 현재의 종료 경로까지 막는다. AV-07의 notice part 최소 크기와 달리, 이번 실패는 **integration 준비에
도달하기 전 thread 생성**이며 cancel에도 발생한다. 모든 지원 크기를 실행한 증명은 아니고 2048-byte 조건을 확정했다.

수정 방향: 현재 revision의 history pointer/index도 한도 안에 들어오도록 모델을 정하고, 전부 열거해야 한다는 설계 문장과
실제 bounded representation을 함께 정리한다. 이미 접수한 request를 종료할 수 있는지 별도 검증한다. 한도 숫자만 높이면
같은 history 성장 문제를 뒤로 미루므로 P0-6의 모델 검토 대상이다.

### 추가 경계의 점검 범위

| 파일 | 읽은 owner/경계와 확인 | 판정 한계 |
|---|---|---|
| `packages/config/src/generations.ts` | generation identity, source 재검사, loader reproduce, pointer commit | 선택 함수 검토와 V13 fixture PASS. 실제 process kill/powercut 미실행 |
| `packages/config/src/operations.ts` | source closure·extension asset reader | snapshot/operations config fixture PASS. 전체 경로 무결함 판정 아님 |
| `packages/config/src/policy.ts` | refresh 실패 시 이전 authority 제거, T 밖의 host read | 코드 검토, 별도 신규 위반 미확정 |
| `src/authority.ts` | identity/current capability 분리 | 선택 authority/registry fixture PASS |
| `src/lifecycle/actions.ts` | currentIntent, start/stop normal/recovery 비대칭 | 코드 검토. 실제 unit effect 미실행 |
| `src/lifecycle/registry-operations.ts` | identity-only replay와 fresh ack/follow acceptance | R25 fixture PASS |
| `src/lifecycle/society.ts` | execution fence, quiescence, reopening authority | 코드 검토. native cgroup 사망 증명 미실행 |
| `src/runtime/run-registry.ts` | pin/opening/live/revoked 수명과 quiescent settlement | R16 fake-pin fixture PASS. kernel lifetime proof 아님 |
| `src/runtime/principal-delivery.ts` | receipt-first settlement, session claim, boundary 관측 | 코드 검토. 실제 engine/provider 미실행 |
| `src/runtime/session-handoff.ts` | private descriptor의 write/close 수명 | 코드 검토, 별도 신규 위반 미확정 |
| `src/runtime/engine-auth.ts` | placeholder·SDK authority resolution | 코드 검토. 저장된 인증 정보 접근·provider 실행 없음 |
| `src/broker/public-dispatcher.ts` | current authority, params/current limits, resource admission, historical lookup | 선택 경계 검토. 현재 params 선검사는 AV-03과 같은 replay 계열이며 별도 중복 계수하지 않음 |
| `src/broker/peer-authenticator.ts` | live capability getter, run/registration 재검사 | 코드 검토. 선택 capability 누락 가설은 실제 getter가 전부/없음 grant를 반환하므로 새 위반으로 세지 않음 |
| `src/broker/connection.ts` | execution/body/peer ownership과 disconnect | R14 in-process socket/alarms fixture PASS |
| `src/broker/peer-pin.ts` | connection/execution reference 단일 반납 | R14 fixture PASS |
| `src/broker/transport-spool.ts` | held directory, seal/handoff/single-use disposal | R14 fixture PASS. 실제 process crash 미실행 |
| `src/mail.ts` | reply headers, ordinary freeze ownership, acceptance/materialization | 메일 선택 회귀 PASS. hidden reply metadata 가설은 body 유출로 확인되지 않아 제외 |
| `src/mail/materializer.ts` | named message/recipient metadata 검증, audience publication, inbox hardlink | mail integrity/recovery fixture PASS; AV-11 확인 |
| `src/cli/effects/mail.ts` | reply source의 bounded header read | 실제 worker file reader 성공; AV-10의 실패는 extension resolver |
| `src/extension/mail-tools.ts` | 역할별 read/send resolver | AV-10 확인 |
| `src/extension/contained-files.ts` | descriptor containment, search snapshot | selected contained-tools fixture PASS |
| `src/extension/contained-tools.ts` | serialized write quota와 contained effect | selected contained-tools fixture PASS |
| `src/extension/workspace-guard.ts` | scope와 actual write quota owner 분리 | selected contained-tools fixture PASS |
| `src/tui/sources/mail.ts` | mailbox read/fold/arrival observation | TUI fixture PASS; AV-11 확인 |

일부 파일은 선택 함수만 읽었고 표의 범위 밖 branch는 미검증이다. 기존 회귀 106개 PASS와 새 oracle 4개 실패를
구분한다. 초기 8192-byte/350-entry history 탐색은 timeout/cancel로 끝났고 발견 근거로 쓰지 않았다.
2048-byte fixture로 경계를 줄인 후 재시작까지 완결한 결과가 AV-12의 근거다.

### 3차 검증 — 추론 연결·실행 종료·영속 원장

사용자가 전체 범위와 검증 깊이를 지적하여, 최근 merge/review 밖의 resource construction, host/guest run lifetime,
session identity, storage transitions와 platform request ledger를 읽고 독립 oracle을 추가했다.
전체 파일을 읽은 경우에도 **선택한 경계의 판정**이며, 모든 분기·규칙의 전수 검증으로 승격하지 않는다.
이번 감사의 모든 production 파일에는 [범위 목록](../test/audit/adversarial-2026-10-03.coverage.json)의 개별 행을 부여했다.
기존 회귀 PASS, 과거 다른 commit의 전수 검토 기록, source hash 수집만으로 review 상태를 올리지 않았다.
현재 수치·명령·로그는 [validation의 3차 실행](implementation/validation.md#3차-범위-확장과-coverage-공개)이 소유한다.

### AV-20261003-13 — 실패한 relay opener가 listener를 잃음

위치: [inference-relay.ts](../apps/oma/src/runtime/inference-relay.ts)의 `open`, 182–192행.

실제 임시 Unix socket에서 `listen`이 성공한 다음 해당 socket의 `chmodSync`에만 EIO를 주입한다.
`open`은 EIO로 reject되지만 HTTP server의 `listening`은 true이고 socket 이름도 남는다.
호출자는 relay를 받지 못했으므로 자신의 finally에서 이를 닫을 수 없다. 생성자 내부에도 반환 실패를 닫는 scope가 없다.
이는 성공한 자원을 인계하기 전까지 opener가 소유해야 한다는 P0-4 위반이다.

수정 방향: listener 생성부터 권한 설정·결과 인계까지 실패 경로를 소유하고, reject 전에 socket/listener를 닫는다.
`egress-forwarder.listen`, `startEgressService`, `startHostApi`의 listen callback에도 보호 없이 chmod하는 관련 분기가 있다.
이들 callback의 process 종료는 이번 oracle로 별도 재현하지 않았으며 독립 발견으로 세지 않는다.
`startGuestServer`는 같은 권한 설정 실패에서 server를 닫고 reject하는 대조 경로다.

### AV-20261003-14 — revoke 뒤 늦게 끝난 resolver가 권한을 재생성

위치: [host/egress.ts](../apps/oma/src/platform/host/egress.ts)의 `placeholder`, 89–97행과 `forgetBoot`/`stop`, 124–131행.
호출 경계: [host/service.ts](../apps/oma/src/platform/host/service.ts)의 `link.onReboot`와 `shutdown`.

실제 guest service의 정상 placeholder 요청을 host resolver의 await에서 멈춘다.
`forgetBoot` 또는 `stop`이 완료되어 `activeRuns=0`인 것을 확인한 뒤 이전 resolver를 재개한다.
두 경우 모두 새 run이 등록되고 성공 답변이 나온다. `forgetBoot` 조건에서는 그 placeholder로 다시 연결하면
해당 relay의 HTTP 403 응답도 도착한다. 사용한 경로는 provider endpoint 밖이어서 upstream 요청은 전혀 발생하지 않는다.

`forgetBoot`는 호출 당시 map의 run만 해제한다. resolving 작업의 generation을 폐기하지 않고,
`placeholder`는 await 뒤 boot generation·stopped·connection lifetime을 다시 확인하지 않는다.
과거의 작업이 새 runtime 권한을 만드는 P0-1/4 문제다. 가짜 boot 경계로 주입한 동일 코드의 로컬 결과이며
실제 VM 재부팅의 관측·socket 종료 시점까지 검증했다는 뜻은 아니다.

수정 방향: resolving 작업을 생성 순간부터 host owner에 등록하고, 폐기 generation 뒤에는 run/relay를 인계하지 않는다.
종료된 호출의 late completion은 정리하며 boot 폐기를 새 발급의 경계와 함께 처리한다.

### AV-20261003-15 — guest run 끝과 host run 끝이 연결되지 않음

위치: [egress-forwarder.ts](../apps/oma/src/runtime/egress-forwarder.ts)의 `close`, 119–126행;
[runner.ts](../apps/oma/src/runner.ts)의 `openRelay`/`consume`, 168–172행과 314–317행;
[host/egress.ts](../apps/oma/src/platform/host/egress.ts)의 `release`/`forgetBoot`, 115–125행.

MAC-225는 run이 끝나면 placeholder를 폐기한다. 그러나 runner의 실제 delivery finally가 호출하는 forwarder close는
guest socket과 forwarding connection만 닫는다. host에 run 끝을 알리는 경로가 없으며 host의 `release` 호출자는 boot 폐기뿐이다.
Principal의 egress close에도 같은 연결 누락이 있다.

정상 placeholder 발급과 실제 forwarder close를 세 번 수행하면 host의 잔여 run 수는 1, 2, 3으로 증가한다.
이미 끝난 첫 run의 placeholder에도 relay 응답이 온다. 대조로 host의 `release`를 명시적으로 호출하면
잔여가 0이고 같은 placeholder 연결은 닫힌다. release 구현의 실패가 아니라 정상 run lifecycle의 누락이다.
같은 actor/incarnation의 서로 다른 delivery도 매번 새 placeholder를 받으므로 incarnation 변화만으로 수집할 수 없다.

수정 방향: 현재 한 번 요청하고 닫는 placeholder channel에 run lifetime을 표현할 근거가 없다.
guest의 실제 run owner와 host relay owner 사이의 종료 전달·끊긴 연결의 unknown 처리·실패한 engine setup의 반환을
명세와 함께 정한다. guest attribution을 host가 독자적으로 권한 판정하는 방식은 MAC-713의 책임 분리와 맞지 않는다.
실제 engine/VM의 실행 종료를 직접 돌린 결과는 아니며, 제품이 사용하는 동일 teardown 객체의 로컬 재현이다.

### AV-20261003-16 — detached 경로에서 idle 연결 제한이 사라짐

위치: [inference-relay.ts](../apps/oma/src/runtime/inference-relay.ts)의 constructor 172–174행과 `accept`, 207–211행.

일반 relay는 `server.maxConnections=4×concurrent`를 설정한다. detached relay는 socket을
`server.emit("connection", socket)`으로 직접 넘기므로 net.Server의 listen acceptance 제한이 실행되지 않는다.
`concurrent=1`로 실제 소켓 여섯 개에 짧은 미완성 HTTP header를 보내면 일반 relay는 네 개만 유지하지만 detached는 여섯 개 모두 유지한다.
host pool의 `maxPool`은 **대기 중 연결 수**이고 넘긴 active 연결 수의 제한이 아니므로 같은 역할을 대신하지 않는다.

완성된 provider 요청의 `inFlight` 제한은 별도로 남아 있다. 이번 발견은 그 요청 수 제한의 실패나 실제 자원 고갈을
주장하지 않고, 이미 선언한 idle connection bound가 detached 경로에서 사라지는 것을 확인한다.
수정 방향: 직접 넘겨받은 socket의 생성·close 수명에도 하나의 connection admission owner를 적용하고 반환을 검증한다.

### AV-20261003-17 — durable outcome의 타입을 검증하지 않는 원장

위치: [guest/requests.ts](../apps/oma/src/platform/guest/requests.ts)의 `read`, `answer`와 `status`.

정상 effect의 `INVALID_REQUEST`로 `{ok:false,error:...}` outcome을 durable하게 기록하고 `refused` 관측을 확인한다.
임시 파일의 `ok`만 문자열 `"false"`로 바꾸는 physical corruption fault를 주입한 다음 RequestLedger를 새로 연다.
관측은 `done`으로 바뀌고, same-key replay promise는 오류 없이 `undefined`로 resolve된다. 원래 거절 error는 파일 안에 그대로 있다.
새 effect 실행은 없다. `read<T>`의 type assertion과 `if(outcome.ok)`가 잘못된 JSON shape를 성공 branch로 해석한 결과다.

외부 caller가 정상 wire를 통해 outcome 파일을 바꿀 수 있다는 주장이 아니다. 알려진 durable 증거 손상에서
`STORE_CORRUPT`를 반환해야 하는 decoder 계약이 없다는 P0-2/5 문제다. 이 재현의 성공 관측은 원장 API의 결과이며,
undefined 결과가 정상 RPC 성공 receipt로 검증된다는 주장까지 하지 않는다.
수정 방향: intent/outcome의 exact shape, boolean discriminator, result/error 의미를 원장 decoder 한 곳에서 검사하고
run replay와 status가 같은 판정을 사용한다. 깨진 기록은 REQUEST_NOT_FOUND나 성공으로 해석하지 않는다.

### 3차 파일별 경계 기록

아래 파일은 전체 source를 읽되 적힌 경계를 선택 검토했다. “추가 미확정”은 해당 경계에서 새 발견을 확정하지 않았다는 뜻이다.

| 파일 | 읽은 fact/owner와 경계 | 판정·한계 |
|---|---|---|
| `src/storage/quota.ts` | fresh allocation scan, stream reservation, settlement headroom | 추가 미확정. 외부 writer/SQLite growth의 hard quota는 의도적으로 보장하지 않음 |
| `packages/storage/src/transitions.ts` | immutable batch/delivery identity, touched rows, usage settlement | 추가 미확정. INF-009에 따라 unit cap의 production 호출 부재는 의도된 예외 |
| `src/domain/lineage.ts` | copied snapshot, duplicate/cycle, descendant capacity | 추가 미확정. deep/random graph campaign 없음 |
| `src/runtime/inference-relay.ts` | construction failure, detached socket, forward/tunnel close, byte guard | AV-13/16. upstream setup throw와 split-secret prefix 가설은 미확정이며 발견으로 세지 않음 |
| `src/runtime/egress-forwarder.ts` | placeholder·socket·upstream handover와 close | AV-15. 관련 chmod callback 실패는 별도 재현하지 않음 |
| `src/runtime/host-tenure.ts` | engine/registration/holding, await와 lease 반환 | 선택 fake-engine 회귀 PASS. holding-close-error 가설은 미확정 |
| `src/runtime/interactive-channel.ts` | listener ownership, bounded output, serial close | 추가 미확정. 실제 engine 사용 없음 |
| `src/runtime/host-history-channel.ts` | pending query release, abort, pagination, handoff | 추가 미확정. inherited private descriptor의 전체 경로 미실행 |
| `src/runtime/session-catalog.ts` | birth/history identity와 project binding | 선택 local history 회귀 PASS |
| `src/runtime/session-history.ts` | bounded header identity, engine migration 전 검사 | 선택 local history 회귀 PASS. 실제 migration 미실행 |
| `src/runtime/session-mode.ts` | immutable birth publication와 mode/layout 판정 | 선택 local history 회귀 PASS |
| `src/runtime/user-files.ts` | held regular-file read, bounded metadata와 immutable publication | 추가 미확정. Darwin branch 미실행 |
| `src/platform/host/egress.ts` | resolving/pool/run 수명, stop·boot 폐기 | AV-14/15. 실제 VM 재부팅 proof 아님 |
| `src/platform/guest/egress.ts` | waiting pool handover, forwarding close | AV-15 호출 경계. 실제 guest service/manager 미실행 |
| `src/platform/stream-receive.ts` | declared length/hash, sink complete/abandon | 추가 미확정. 신규 kill/powercut 주입 없음 |
| `src/platform/stream-source.ts` | borrowed FD 반환, primary/cleanup 오류 보존 | 추가 미확정. 신규 native close 실패 campaign 없음 |
| `src/protocol/host-history.ts` | canonical reference, strict page/cursor 판정 | pagination loop 가설은 checked page cursor가 막으므로 제외 |
| `src/platform/guest/requests.ts` | immutable intent/outcome, same-key, status decoder | AV-17. 기존 임시 ledger 회귀 20개 PASS, local child SIGKILL 2개 포함. 실제 guest ledger 사용 없음 |
| `src/process/cleanup.ts` | effect 종료 후 resource 반환과 paired failure | 추가 미확정. 모든 caller 검토 완료 아님 |

다음 파일은 선택 함수만 읽었다.

| 파일 | 경계 | 판정·한계 |
|---|---|---|
| `src/platform/host/host-api.ts` | socket listener construction | AV-13 관련 callback 분기, 추가 재현 없음. native UID/RPC 전체 미검증 |
| `src/platform/guest/server.ts` | 권한 설정 실패 뒤 close | AV-13과 다른 cleanup 대조. native guest 인증 proof 아님 |
| `src/platform/host/service.ts` | reboot hook·shutdown의 egress owner | AV-14/15 호출 경계. 실제 서비스/VM 실행 없음 |
| `src/platform/rpc.ts` | error/unknown 의미와 phase budget | 추가 미확정. 나머지 함수 전수 검토 아님 |
| `src/runner.ts` | guest relay 생성과 delivery finally | AV-15. 실제 engine/receipt/runner 실행 없음 |

재현은 [3차 oracle](../test/audit/adversarial-2026-10-03-third.mjs), source와 결과 결박은
[3차 evidence](../test/audit/adversarial-2026-10-03-third.evidence.json)를 따른다. 전체 source 무결함이나
실제 환경의 lifecycle·durability 완료를 뜻하지 않는다.

## 2026-10-03 전수 감사 — 진행 중

production manifest 356개와 추가 계약·native·배포·build/verification source 74개를
[파일별 원장](../test/audit/full-2026-10-03.review.json)에 고정했다. 각 행은 source SHA-256,
영속적 사실, 해석 owner, P0-1~7 근거와 한계를 가진다. `PENDING`은 미완료이며,
전체 정적 검토도 모든 실행 환경이나 결함 부재의 증명을 뜻하지 않는다.
기존 AV-01..17 및 세 차례 evidence는 당시 snapshot으로 보존한다.

### AV-20261003-18 — context 준비 실패가 이미 획득한 lease를 반환하지 않음 (P2)

근거: [context-stream.ts](../packages/storage/src/context-stream.ts)의 `acquireStagingRoot`.
`TreeLease.take(staging)` 다음 `openDirectory(dirname(staging))`가 `try` 밖에 있어,
이 디렉터리 열기가 실패하면 `lease.release()`까지 도달하지 않는다. 호출자는
준비 객체를 받지 못하므로 반환할 owner도 없다. P0-4의 생성 즉시 소유권·실패 시 반환 위반이다.

[전수 감사 oracle](../test/audit/adversarial-2026-10-03-full.mjs)은 임시 context의 정상 descriptor에
부모 open의 `EMFILE` 실패 하나를 주입했다. 결과는 요청 reject 뒤 **lease fd 1개 잔류,
quiescence `active`**다. 요구 동작인 fd 0개와 `quiescent` assertion이 실패했다.
시험이 남은 fd를 직접 닫고 임시 디렉터리를 정리한다. 실제 사용자 상태나 외부 서비스는 쓰지 않는다.
같은 실패가 반복되면 broker 생존 동안 fd와 잠금이 누적될 수 있다. 영속 operation의 의미 변경을
재현한 것은 아니며, 해당 생성 경계의 반환 누락을 확인했다. 미수정.

수정 방향: lease 획득 직후 정리 범위를 시작하고 부모 fd 획득도 그 범위에 넣는다.

### 위임 pass (7 에이전트) — 신규 발견 요약

파일별 전체 읽기를 7개 에이전트에 부분 중복으로 분업하고, 부모 에이전트가 모든 발견을 교차 확인했다.
재현 가능한 상위 결함 세 건(AV-19/20/25)은 [전수 감사 oracle](../test/audit/adversarial-2026-10-03-full.mjs)에
required-behavior oracle로 등록했으며 현재 실패한다. 나머지는 정적 추적으로 확정했고 macOS/native lane은
`NOT_RUN`으로 보존한다.

| ID | 심각도 | 발견 | 규칙 | 상태 |
|---|---|---|---|---|
| AV-20261003-19 | P1 | `.prepare-*` context revision 임시 tree에 lease/수거자가 없고 quota에 영구 계상 | P0-4 | oracle 재현, 미수정 |
| AV-20261003-20 | P1 | startup 복구가 비-mail op의 복구 실패를 격리하지 않아 영구 부팅 wedge | P0-5/6 | oracle 재현, 미수정 |
| AV-20261003-21 | P2 | `VzDriver.get`이 malformed Keychain 응답을 absent로 격하 → archive key 덮어쓰기 | P0-5/3 | 정적 확정, NOT_RUN |
| AV-20261003-22 | P2 | `archiveKey` get→put TOCTOU: 패자 key의 archive가 영구 미개방 | P0-2/4 | 정적 확정, NOT_RUN |
| AV-20261003-23 | P2 | guesthost maintenance lease가 owner 연결 사망 후 잔류 → `society.open` 영구 거부 | P0-4 | 정적 확정, NOT_RUN |
| AV-20261003-24 | P2 | `workerStatus`가 unbounded `entries`를 무검사 직렬화 → 그 요청은 영구 FRAME_TOO_LARGE | P0-6 | 정적 확정, 미수정 |
| AV-20261003-25 | P1 | 비UTF-8/lone-surrogate candidate 이름이 `STORE_CORRUPT`로 분류 → society 전체 fence | P0-5/2 | oracle 재현, 미수정 |
| AV-20261003-26 | P2 | Swift helper: `PortBridge` 부분 생성 후 throw → listener/VM 잔재 | P0-4 | 정적 확정, NOT_RUN |
| AV-20261003-27 | P3 | `actions.ts`의 GOAL 게이트가 same-key terminal receipt 반환보다 먼저 throw | P0-1 | 정적 확정, 미수정 |
| AV-20261003-28 | P3 | `chmodSync` in listen 콜백 4개 추가 자리 (AV-13 동일 계열) | P0-4 | 정적 확정, 미수정 |
| AV-20261003-29 | P2 | AST/registry 게이트의 spelling 수준 under-approximation (indirection 우회) | P0-2/6 | 정적 확정, 미수정 |
| AV-20261003-30 | P2 | 리뷰·evidence의 byte-binding 비대칭: READ_UNCHANGED/status 무바운드 | P0-3/6 | 정적 확정, 미수정 |
| AV-20261003-31 | P3 | 실행 경계 틈: test-guard `exec`/`execSync` 미차단, script 자식 누수, sign-image 비원자성 | P0-4/7 | 정적 확정, 미수정 |

### AV-20261003-19 — `.prepare-*` context revision 임시 tree의 소유자·수거자 부재

근거: [context-snapshot.ts](../packages/storage/src/context-snapshot.ts)의 `publishContextRevision`, 70–95행.
`.prepare-${candidate}-${operationId}`를 만들고 파일을 쓴 뒤 `sealRevision`·`publishStagedDirectory`로
게시하고, 삭제는 `finally { removeOwnedTree(temporary) }`뿐이다. `TreeLease.take`도 소유권 기록도 없다.
생성~`finally` 사이의 kill/power-loss는 `stateRoot/world/context/revisions` 아래에 완성된 context tree를 남긴다.

수거자가 없다: `collectUnacceptedArtifacts`([preaccept.ts](../packages/storage/src/preaccept-collection.ts) 40–104행)는
mail objects·staging만 스캔하고, `collectRepositoryStaging`([provision.ts](../apps/oma/src/runtime/provision.ts)
391–400행)은 `stateRoot/repos`만 본다. [quota.ts](design-revisions.md#dr46--출시-전-레거시-제거와-workspace-분리) (당시 quota 경로, DR46에서 제거됨) 14–60행의
`observedStorageBytes(stateRoot)`는 state root 전체를 재귀하므로 잔재가 영구히 쿼터에 계상된다.
lease가 없으므로 미래의 수거자조차 `collectLeasedTree`의 quiescence 증명(`unknown`)을 통과할 수 없다.

[전수 감사 oracle](../test/audit/adversarial-2026-10-03-full.mjs)은 `world/context/revisions`에
`.prepare-*` 잔재를 만들고 `collectUnacceptedArtifacts`를 호출했다. `removed`와 `kept` 모두 잔재를
포함하지 않아 "startup 수거가 잔재를 봐야 한다"는 assertion이 실패했다. 실제 kill 주입은 아니며
수거 경로 부재를 재현했다. 반복 crash 시 잔재 누적 → QUOTA_EXCEEDED로 신규 작업이 차단되고
(AV-20과 합성되면) pending `context.publish` 복구가 실패해 부팅 wedge가 된다. 미수정.

수정 방향: 준비 tree를 생성 순간부터 lease로 소유하거나 `world/context/revisions/.prepare-*`를
startup 수거 범위에 포함하고, quiescence를 증명할 수 없는 잔재는 보존하되 보고한다.

### AV-20261003-20 — startup 복구가 비-mail operation의 실패를 격리하지 않음

근거: [reconcile.ts](../packages/reconcile/src/index.ts) 103–105행. `startup()`은 mail 계열이 아닌 pending/unknown
operation에 대해 `await this.recover(...)`를 지역 catch 없이 호출한다. 실패는 startup의 바깥 catch로
전파되어 `observeStoreFailure` 후 프로세스를 죽인다. 대조로 mail 경로는 `retainRecoveryFailure`로
격리하고, 주기 `sweep()`은 `OperationRecovery.perform`이 op마다 같은 격리를 한다
([reconcile/operations.ts](../packages/reconcile/src/operations.ts)).

[전수 감사 oracle](../test/audit/adversarial-2026-10-03-full.mjs)은 pending `agent.start` operation을
만들고 `reconcileAction`이 지속 `REF_STATE_UNKNOWN`을 던지게 했다. 같은 op에 대해 `sweep()`은
격리되어 resolve하지만 `startup()`은 거절된다. 지속 unknown을 가진 비-mail op 하나가 broker 기동을
영구 차단하며, 재시도 가능한 sweep 격리와 정책이 모순된다. 미수정.

수정 방향: startup의 비-mail 분기도 sweep와 같은 per-op 격리(`retainRecoveryFailure`)를 적용하고,
store-scope 손상만 치명으로 유지한다.

### AV-20261003-21 — `VzDriver.get`이 malformed Keychain 응답을 absent로 격하

근거: [vz-driver.ts](../packages/platform-mac/src/vz-driver.ts) 128–131행. `typeof answer.value === "string" ? answer.value : undefined`로, `ok:true`이지만 value가 비문자열이면 `undefined`를 반환한다 — "item not found"와 구분 불가. 형제 구현 `KeychainClient.get`([keychain-client.ts](../packages/platform-mac/src/keychain-client.ts) 101–107행)는 같은 상황에서 채널을 실패시킨다.

결과: [service.ts](../apps/oma/src/platform/host/service.ts) 71–77행 `archiveKey()`는 `get → undefined → randomBytes(32) → put`을 직렬화 없이 실행한다. mangled 응답 하나가 새 임의 key로 저장된 archive key를 덮어써, 이전에 게시한 모든 `.omaarchive`를 복호화 불가로 만든다. durable fact가 나중 관측으로 재해석되는 P0-5/3 위반. macOS lane `NOT_RUN` — 정적 확정. 미수정.

수정 방향: `KeychainClient`와 같은 strict 응답 검증으로 malformed을 absent와 구분하고,
`archiveKey`를 `keychainCredentials`와 같은 직렬화 create-if-absent 패턴으로 옮긴다.

### AV-20261003-22 — `archiveKey` get→put TOCTOU

근거: [service.ts](../apps/oma/src/platform/host/service.ts) `archiveKey`. `get` 결과 없음 → `put`까지
직렬화·프로세스 락이 없다([keychain.ts](../apps/oma/src/runtime/keychain-credentials.ts)가 가진 `withWriter` 패턴 부재).
두 프로세스/시점이 동시에 absent를 관측하면 나중 `put`이 이기고, 패자가 방금 쓴 archive는
승자 key로만 열린다. durable secret의 생성-owner가 둘 이상이 되는 P0-2/4 위반. `NOT_RUN`. 미수정.

수정 방향: `keychainCredentials`가 이미 해결한 process lock + reread-before-write 패턴을 적용한다.

### AV-20261003-23 — guesthost maintenance lease의 owner 사망 후 잔류

근거: [guest/host.ts](../apps/oma/src/platform/guest/host.ts) 61, 128, 161–171행. `maintenance`는 request key를
키로 하는 `Set`이고 해제는 두 번째 요청(`maintenance.end`)뿐이다. 연결 소유자가 죽으면 key가 잔류하고
`maintenance.size > 0`이면 `society.open`이 `BROKER_UNAVAILABLE`로 영구 거부된다. 대조로
`archiving`/`opening`은 자기 정리 경로가 있다. lease 해제가 별도 요청인 자원에 peer-close sweep이 없는
P0-4 위반. `NOT_RUN`. 미수정.

수정 방향: maintenance lease를 연결 수명에 묶고 peer close 시 sweep한다.

### AV-20261003-24 — `workerStatus`의 unbounded `entries` projection

근거: [review.ts](../packages/review/src/index.ts) 1052–1083행 `status()`는 list 분기만 probe/shrink로 frame 예산을
적용하고, 1085–1131행 `workerStatus`는 `frameBytes`를 받지 않아 `entries` 전체를 직렬화한다.
`public-dispatcher.ts` 216–219행은 `frameBytes`를 정상 전달하므로 예산은 `status()` 안에서만 유실된다.
caller review/vote/cancel은 entry당 ~90–130B로 무한 누적되어(기본 256KiB에서 ~2,400–3,200 entries),
임계를 넘으면 `encodeFrame`은 성공하지만 `frame.length > frameBytes`로 `FRAME_TOO_LARGE`
accepted-failure가 된다. 그 요청의 `oma merge status/diff`·`oma challenge status/diff`·extension 조회는
재시작·재연결 후에도 영구 실패한다. list는 정직하게 자르는데 detail은 안 하는 비대칭 — P0-6 위반.
정적 확정(전 경로 추적). 미수정.

수정 방향: detail 분기도 list처럼 frame 예산 내 probe/shrink 또는 `omitted` 표기를 적용한다.

### AV-20261003-25 — unrepresentable candidate 이름이 `STORE_CORRUPT`로 분류 → society fence

근거: [git/observe.ts](../packages/git/src/observe.ts) `parseNameStatusZ` 154행 → `corrupt` → `observed()` →
`StoreError("STORE_CORRUPT")` → `AdmissionGate.observe`([admission.ts](../packages/domain/src/admission.ts))
→ society 전체 admission fence.

Trigger A(latent): [identifiers.ts](../packages/domain/src/identifiers.ts) `isValidWirePath` 114–121행이 `\p{Cs}`를
거부하지 않아 lone surrogate가 context path가 되고, native 인코딩(WTF-8) 후 strict decode에서
`STORE_CORRUPT`가 된다. wire 경계(frame.ts:73)는 surrogate를 거부하므로 현재 wire 트리거는 차단되지만
`context-policy`·`protectedPaths`·`submit.paths` 등 비프레임 진입에 문법 구멍이 남는다.

Trigger B(확정): Resident가 일반 git 도구로 비UTF-8 파일명(Latin-1/GBK)의 candidate를 만들면
`git.submit`의 quarantine import는 이름을 디코드하지 않고 발표하고, `merge.open`/`challenge.open`/
`git.integrate`/`revalidateTier`가 `changedPaths`에서 `STORE_CORRUPT`를 얻는다.

[전수 감사 oracle](../test/audit/adversarial-2026-10-03-full.mjs)은 disposable git repo에 raw `0xff`
바이트 파일명을 만들고 `changedPaths`를 호출해 `{"kind":"corrupt","reason":"name-status output is not
UTF-8"}`을 재현했다. durable 상태가 아니라 candidate 입력 하나가 표현 불가인데 store-scope 손상으로
승격되어 fence를 영구 폐쇄하는 P0-5/2 위반. pending op로 남으면 재시작마다 재중독된다. 미수정.

수정 방향: (a) `isValidWirePath`가 `\p{Cs}`를 거부해 저장 text·attestation 문법과 정렬하고,
(b) "candidate가 관측 문법 밖"을 store 아래 scope(입력 거절/repository-scope)로 분류해
unrepresentable 입력이 durable 손상으로 읽히지 않게 한다. strict decode는 유지한다.

### AV-20261003-26 — Swift helper의 `PortBridge` 부분 생성 누수

근거: [main.swift](../packages/platform-mac/src/vmhelper/Sources/oma-vmhelper/main.swift) `vm.start` 180–202행.
`machine = vm` 배정 뒤 `config.ports.map { try PortBridge(...) }`에서 후속 bridge 생성이 throw하면
이미 만든 bridge들이 폐기된다 — `stopBridges` 미호출, listener FD·accept thread·`.sock` 잔재,
`machine`은 running VM을 보유. 거절된 start가 자원을 남기고 재시도는 `ADDRESS_ALREADY_IN_USE`만 돌려준다.
`VZVirtualMachine`에는 있는 생성 전 guard 패턴을 bridge에 적용하지 않은 P0-4 위반. `NOT_RUN`. 미수정.

수정 방향: bridge 배열을 local에 만들고 throw 시 이미 만든 bridge를 모두 stop한 뒤 `machine`/`bridges` 배정.

### AV-20261003-27 — GOAL 게이트가 same-key terminal receipt 반환보다 먼저 throw

근거: [lifecycle/actions.ts](../packages/lifecycle/src/actions.ts) start/stop 경로. GOAL 게이트가 같은
request-key의 기존 terminal receipt 반환보다 먼저 throw하므로, 과거에 접수된 same-key 요청도 현재
GOAL 상태로 거절되고 receipt가 분실된다. AV-03과 동일한 "현재 검사가 과거 receipt보다 먼저" 패턴의
다른 자리 — P0-1 위반. 정적 확정. 미수정.

수정 방향: same-key lookup/terminal receipt 반환을 현재 정책 검사보다 먼저 수행한다.

### AV-20261003-28 — listen 콜백 안의 `chmodSync` 4개 추가 자리 (AV-13 계열)

근거: AV-13과 같은 mechanism — `listen` 성공 뒤 콜백에서 `chmodSync`가 실패하면 bound socket과
실행 중 listener가 owner 없이 남는다. 추가 자리: [egress-forwarder.ts](../apps/oma/src/runtime/egress-forwarder.ts)
~110–115행, [host-api.ts](../apps/oma/src/platform/host/host-api.ts) `startHostApi`, [guest-session.ts](../apps/oma/src/entry/guest-session.ts)
~52행, `startEgressService`. `startGuestServer`는 같은 실패에서 server를 닫는 대조 경로다.
P0-4 위반. 개별 재현은 하지 않았고 정적 일치로 묶는다. 미수정.

수정 방향: AV-13과 동일하게 listener 생성부터 권한 설정·인계까지 하나의 실패 소유 범위로 묶는다.

### AV-20261003-29 — AST/registry 게이트의 spelling 수준 under-approximation

근거: [durable-boundaries.mjs](../scripts/durable-boundaries.mjs), [transaction-check.mjs](../scripts/transaction-check.mjs),
[fence-rules.mjs](../scripts/architecture/rules/fence-rules.mjs), [state-tree-rules.mjs](../scripts/architecture/rules/state-tree-rules.mjs),
[transaction-rules.mjs](../scripts/architecture/rules/transaction-rules.mjs) 등이 callee의 마지막 식별자명,
`/fd$/` 변수명 휴리스틱, 인쇄 텍스트 `/fence/i`, 부분 문자열 제목 매칭, Sync 전용 이름 집합으로 규칙을
판정한다. `alias`, `bind`, computed access, namespace rename, `fs.promises` 같은 간접 호출은
registry 규칙을 우회한다 — durable boundary, transaction effect, state-tree, fence 규칙이 실제 위반을
놓칠 수 있다. 검증 게이트가 규칙을 문자열 수준으로 근사하는 P0-2/6 위반. 정적 확정. 미수정.

수정 방향: architecture-check.mjs:167–196가 이미 쓰는 typechecker 경로로 callee 심볼을 선언까지 해석하고,
oracle 제목은 exact/token 매칭으로 전환한다.

### AV-20261003-30 — 리뷰·evidence의 byte-binding 비대칭

근거: `CHANGED_WITH_ORACLE`은 sha256-bound로 check 시 재검증되지만 `READ_UNCHANGED`와 원장 status는
byte-binding되지 않는다([review-ledger.mjs](../scripts/review-ledger.mjs)). 또 `verify-import-runtime.mjs`의
closure roots는 5개 entry로 고정이고 `verify-lane.mjs`의 digest roots는 `production-*.json` artifact를
제외해 lane PASS가 측정 artifact를 바인딩하지 않는다. evidence가 서술한 바이트와 바인딩되지 않는
P0-3/6 위반. 정적 확정. 미수정.

수정 방향: status 계열에도 oracle과 같은 digest 바인딩을 적용하고 lane digest roots에 측정 artifact를 포함한다.

### AV-20261003-31 — 실행 경계 틈 (test-guard·script 자식·sign-image)

근거: [local-test-guard.mjs](../scripts/local-test-guard.mjs) 5–13행은 spawn 계열만 패치해
`exec`/`execSync`(shell)와 `/bin/sh -c` 우회를 차단하지 못한다. [functional-surface.mjs](../scripts/functional-surface.mjs)/
[functional-pi-smoke.mjs](../scripts/functional-pi-smoke.mjs)는 실패 경로의 자식 수명이 불완전하고,
[sign-image.mjs](../scripts/platform/sign-image.mjs)의 산출물 쓰기가 비원자적이다. 검증 도구의
실행 경계 규칙이 선언과 다른 P0-4/7 위반. 정적 확정. 미수정.

수정 방향: exec 계열도 차단 목록에 넣거나 shell 금지를 선언하고, 자식 수명과 원자적 rename-last 패턴을 통일한다.

### 위임 pass 커버리지와 한계

7개 백그라운드 에이전트가 다음을 전체 읽기로 커버했다(중복 할당 포함): A1=runtime 38+entry 17+lifecycle+process+runner/reconcile/request-cache/sandbox, A2=platform 46+native+systemd+extension+process/lifecycle 중복, A3=mail+git+storage+reconcile+broker+lifecycle, A4=cli+protocol+extension+config+broker 중복, A5=RPJ 38+domain+후보 #3 추적, A6=scripts 44+systemd+build/config, A7=전체 PENDING 수평 패턴 스위프. 부모 에이전트가 모든 발견을 교차 확인하고 oracle 3건을 재현했다.

원장 결과: main 356개 중 319개 `REVIEWED_STATIC`, supplemental 74개 중 73개 `REVIEWED_STATIC`.
미기록 잔여 38개: `src/attestation.ts`, `src/git/{integration-policy,integration-publication,quarantine,submit}.ts`,
`src/protocol/{log-response,principal-credential,status-view}.ts`, `src/tui/*` 29개(부분 중복 4개만 기록),
`platform/guest/environment.d/60-oma-egress.conf` — 위임 보고에서 whole-read가 확인되지 않아 PENDING으로 둔다.

한계: 모든 판정은 정적 읽기 기반이며, macOS/native VM·systemd·powercut·전체 release lane은 계속 `NOT_RUN`이다.
정적 완료는 결함 부재의 증명이 아니다. A1/A4/A6/A7의 일부 세부 파일별 메모는 대화 요약 단계에서
절단되어, 해당 판정은 그룹 단위 합의와 부모의 doc-comment/헤더 검증으로 기록했다.
실패 시 각 fd/lease를 한 번씩 반환하고 최초 실패와 반환 실패를 함께 보존한다.

## 일반 버그 pass (NB-*, 2026-10-03 두 번째 위임 wave)

P0 불변식과 무관한 일반 결함(로직·표시·동시성·경계값·에러 처리)을 별도 렌즈로 7개 에이전트가 탐색했다.
NB 번호는 durable 의미 위반이 아니라 동작 결함을 뜻한다. 모두 미수정; macOS 항목은 정적 확정 + `NOT_RUN`.

| ID | 심각도 | 위치 | 요약 |
|---|---|---|---|
| NB-01 | 중 | src/git/quarantine.ts:42,54-65 | 격리 tmpfs가 `bundleBytes` 크기인데 input.bundle + index-pack repo(~2배)를 담아야 함 → 유효한 ~bundleBytes/2+ 번들이 BUNDLE_INVALID/UNSUPPORTED_PROFILE로 파이프라인 중간 사망. 실효 상한이 명세의 절반 |
| NB-02 | 저 | src/git/quarantine.ts:68 | `fsck --strict`가 alternates를 탐색 → canonical 측 기존 손상이 유효 번들의 BUNDLE_INVALID로 오분류 |
| NB-03 | 저 | src/protocol/log-response.ts:49-70 | 바이너리 탐색이 전체 텍스트를 `truncated:true`로 표기 가능(프레임이 정확히 1바이트 초과 시) — 미용적이며 보수적 방향 |
| NB-04 | 저 | src/tui/app.ts:263 | mail detail이 열린 동안 draw마다 본문을 동기 재읽기 — 키 입력·스크롤·refresh당 fs I/O |
| NB-05 | 저 | src/tui/dashboard.ts:45 | `pending` 합계는 principal 포함, `created`/`active`는 제외 — 같은 화면에서 행 의미 불일치(이중 보고) |
| NB-06 | 저 | src/tui/exit.ts:17-18 | `write` 직후 `process.exit` — 파이프/리다이렉트 시 실패 메시지 유실 가능 |
| NB-07 | 중 | src/tui/keys.ts:131-134 | typed 입력은 P0V-108 sanitize를 우회 — C1(U+0080-9F)·Cf(ZWSP, U+FEFF, bidi) 문자가 화면엔 안 보이지만 draft에 들어가 전송됨. paste는 차단하는데 typed는 통과해 파일 자체 불변식("화면에 안 보이는 것은 보내지 않는다") 위반 |
| NB-08 | 저 | src/tui/keys.ts:260 | `ESC [[ A-E`(Linux 콘솔 F1-F5)가 3바이트에서 조기 종료 → 다음 문자가 typed로 누수 |
| NB-09 | 저 | src/tui/login.ts:25-33 | `new Promise` 이전의 동기 throw가 Promise<number> 계약을 우회 — 현재 호출처는 방어하지만 시그니처가 기만적 |
| NB-10 | 저 | src/tui/model.ts:450-454 | control panel이 열린 동안 char/paste가 조용히 폐기 — 공지도 draft 삽입도 없는 silent drop |
| NB-11 | 저 | src/tui/open-tui-brand.ts:69-71 | swapText 절단이 UTF-16 단위 — flag emoji 등 서로게이트 페어 분할 가능 |
| NB-12 | 저 | src/tui/open-tui-brand.ts:144-151 | brandFooter가 가장 넓은 gap만 고려 — `~` 뒤 적합 gap이 있어도 브랜딩 누락 |
| NB-13 | 저 | src/tui/view/screens.ts:229-232 | 최소 geometry에서 fixed rows가 footer/notice를 화면 밖으로 밀어냄 |
| NB-14 | 저 | src/tui/view/text.ts:73-76 | wrap()이 width 초과 cluster 직전에 빈 줄 하나를 추가로 내보냄 |
| NB-15 | 저 | src/tui/screen.ts:69, app.ts:273 | draw()의 `output.write`가 파괴된 stream에서 동기 throw → data 리스너 경유 uncaughtException |
| NB-16 | 중 | src/cli/effects/submit.ts:54-56, effects/goal.ts:21,31, commands/context.ts:21 | builder 내부 StoreError(LIMIT_EXCEEDED/INVALID_OID/REF_STATE_UNKNOWN)가 fatal→exit 3 — 결정적 입력 오류인데 ERROR_METADATA의 cliExit=2와 불일치; "re-run a permanent failure" 유도 |
| NB-17 | 중하 | src/cli/commands/merge.ts:51 | `ensurePublished`/`finishReceipt`가 회수 힌트로 파생 submitKey(`<K>.submit`)를 출력 → 그대로 따라 하면 신규 open이 다른 키로 동결되고 원본 replay 안 됨. 올바른 힌트는 `<K>` |
| NB-18 | 중하 | src/cli/effects.ts:56-65 | `readBounded`가 읽는 도중 축소된 파일을 조용히 허용 — strict prefix만 전송/사용됨(grow는 거부하는데 shrink는 무시). diagnostics는 FILE_CHANGED_DURING_READ로 보고하는데 CLI는 침묵 |
| NB-19 | 저 | src/cli/commands/send.ts:99 | `oma ack m-<id>:2,`(bare maildir 이름)를 literal id로 취급해 거절 — `basename`+suffix 제거가 path 입력에만 적용됨. `.eml`도 동일 |
| NB-20 | 저 | src/broker/public-dispatcher.ts:153-158 | `status.get`이 없는 agent에 ADDRESS_NOT_FOUND 대신 빈 목록+exit 0 — logs.read와 불일치 |
| NB-21 | 저 | src/cli/commands/logs.ts:33 | `oma logs`가 unit 로그 원문을 터미널에 무이스케이프 출력 — 제어 문자 중화를 하는 views.ts와 비대칭(의도 가능성 있음) |
| NB-22 | 저 | src/platform/host/service.ts:227-229,242-243 | 게스트 응답 `result.head` 등을 검증 없이 durable 기록 → 손상/비정상 게스트 응답이 host-record를 STORE_CORRUPT로 오염시키고 omahostd 기동을 막음(AV-17 계열 truthiness/검증 부재) |
| NB-23 | 고 | src/platform/host/service.ts:93-118 + lifecycle.ts:183,202,252-255,292 | `record()` 동기 throw가 timer/socket 콜백과 boot catch에서 탈출 → omahostd에 uncaughtException 핸들러가 없어 데몬 사망, 또는 `force()` 생략으로 사망 상태의 VM이 orphan으로 생존 |
| NB-24 | 중 | src/platform/guest/control.ts:104-111 | `end()`가 `this.frozen=null`과 deadline 취소를 thaw 이전에 수행 → thaw 실패 시 FS는 얼어붙은 채 `thawed:false`가 아닌 "not frozen"으로 보고되고 재시도 불가(EBUSY) — deadline backstop까지 취소됨 |
| NB-25 | 중 | src/entry/oma-mac.ts:192-195 | Mac CLI가 INVALID_REQUEST 외 모든 실패를 exit 1로 평탄화 — `errorExit` 계약(retryable=3, unsupported/gate=4)과 불일치, 스크립트가 재시도 가능/불가를 구분 못함 |
| NB-26 | 중하 | src/platform/host/service.ts:121, lifecycle.ts:190-196 | wake 시 `time.set` 실패가 `.catch(()=>undefined)`로 침묵 — §9.1 clock-step 불변식이 보이지 않게 깨짐 |
| NB-27 | 중하 | src/platform/host/snapshot.ts:91 | `maintenance.end` 실패를 삼킴 → maintenance latch가 잔류해 `society.open`이 계속 거부됨(현재 호출처 없는 staged 코드) |
| NB-28 | 저 | src/cli/exit.ts:29, diagnostics/files.ts:112-114, entry/oma-mac.ts:140 vs 143, commands/send.ts, commands/agent.ts:14 | 소소한 항목 묶음: receipt error 누락 시 `Failed:?` 폴백, header-budget 구간 unknown 오분류, `oma status`가 stderr로 출력(`oma list`는 stdout), `--file`/`--reply`가 replay 비교 projection에 미포함, 서브커맨드 위치 고정 silent-gotcha |
| NB-29 | 중상 | src/platform/host/vz-driver.ts:112-122, lifecycle.ts:249-285,300, service.ts:288-293 | `VzDriver.ask`에 deadline이 없음 — wedged한 `oma-vmhelper`가 reply 없이 살아있으면 force-stop·shutdown·engine recovery가 영구 정지. `driver.close()`(유일한 SIGTERM 탈출)가 shutdown() 해소 뒤에 있어 자기봉인 deadlock. keychain 요청도 같은 채널에서 누적 |
| NB-30 | 중 | src/platform/host/keychain-client.ts:94-98,109-113 | `KeychainClient.ask`/`close()`도 deadline 없음 — wedged writer child가 credential op과 `withWriter` cleanup을 영구 정지(F1과 동일 결함 클래스: helper 채널의 deadline 없는 pending map) |

**확정 부재**: B3(수치·경계값 전수 스위프)와 B7(mail/git/review 도메인 로직 심층)은 확정 결함 0. B4(동시성/async)는 NB-29/30과 미확정 7건(api.close half-open socket 대기, setWindowSize 동기 throw, pi-interactive-host 외부 API hang, tui/session.ts unhandled rejection 경로, half-open listenerCloses 누적, drain post-stop force 미기록 — 대부분 도달성 낮음)를 보고.
B7 잔여 hardening 노트(결함 아님): `canonicalMergeDiff` argv에 `gitOidArgument` 미적용(도달 불가),
succeeded 제출물의 absent ref가 `REF_STATE_UNKNOWN`(보수적이지만 review wedge), `workerStatus` kind 캐스트가
선언 union보다 좁음, `batchMaxMessages=1`에서 양 클래스 pending 시 `UNSUPPORTED_PROFILE` config 위험,
`describeEntry`가 challenge.open 항목을 빈 텍스트로 표기.

NB-23/NB-29가 이번 pass 최고 심각도다 — 정상 VM 정지 경로에서도 손상된 host-record.json 하나로 데몬 죽음 +
orphan VM이 재현된다. 전부 정적 확정이며 macOS lane은 `NOT_RUN`.

## DR46 추가 관측 (2026-10-24)

**DR46-F01 — FIXED_LOCAL / systemd activation NOT_RUN: Resident의 frozen modelProfile 참조가 현재 역할 설정으로 바뀐다.**
발견 당시(10 workspace 입력 `d6089338…`): P0-1/P0-3, LIFE-008/TUI-009. [`ResolvedAgentSpec`](../packages/contracts/src/host.ts)의
modelProfile은 수락된 spec/hash에 들어가지만 [`UnitsModule.ensureResident`](../packages/platform-linux/src/units.ts)는
profile과 resource만 unit에 전달하고, [`runner entry`](../apps/oma/src/entry/runner.ts)는 현재
agentProfiles[profile].modelProfile을 다시 선택한다. 실제 runner entry를 실행하고 엔진 실행만
capture한 재현에서 frozen `review` / `model-b`가 역할 참조 편집 뒤 `standard` / `model-a`로
바뀌었다. source 계약과 entry 해석에 대한 재현이며 실제 systemd activation/provider 증거는 아니다.
원시 근거는 외부 `frozen-model-reference-repro.json`이다. 수락된 참조 전달과 현재 모델 내용의
적용 시점을 분리했다. 현재 unit은 수락된 profile/modelProfile 참조를 명시적으로 전달하며, runner는 고정 참조의 모델 내용만 다음 활성화에 읽는다. Worker 편집도 기존 참조 내용을 수정하며 Principal과 공유된 참조의 역할 단독 편집은 거절한다. `resource-current-repairs.log`의 실제 runner entry capture 및 Worker 편집 회귀가 통과했다(214/214 집중 집합, 입력 `6a1297d3…`, 변화 0). `resource-current-focused.log`의 실제 confined Worker SCN-X01/X02도 모델/effort 적용을 확인했다(입력 `377306c7…`). real systemd activation/provider/power-loss 증명으로 확대하지 않는다.

**DR46-F03 — FIXED_LOCAL: 분리 checkout의 preload owner 경로 회귀.**
`src/runtime/pi-spawn-plan.ts`의 dirname(coreExtension) 계산은 extension 이동 후 실제
app/runtime preload 대신 존재하지 않는 extension 하위 파일을 가리킨다. P0-4/P0-7: engine보다
먼저 package generation lease/client runtime 초기화를 수행하는 실제 owner를 경로 추정으로
잃지 않아야 한다. `test/preload-owner.test.mjs`가 실제 installation asset 존재와 plan API의
NODE_OPTIONS를 비교해 1 FAIL을 확인했다. 입력 15,524개 `849f6731…`, 변화0.
원시 로그 `preload-owner-before.log`는 유지하며 현재 root 14 workspace의 실패로 소급하지 않는다.

**DR46-F04 — FIXED_LOCAL: 현재 제품과 다른 namespace fixture의 네트워크 보장 과장.**
P0-5/P0-7/INV09. `test/resident-sandbox-live.test.ts`의 rootfs probe는 직접 --unshare-all을
실행하며 현재 production recipe의 --share-net을 쓰지 않았다. root 14 전체 실행에서 해당
fixture가 PASS여도 현재 제품의 네트워크 차단 증거가 아니다. 실제 recipe 기반 로컬 marker
교환과 namespace 음성 제어로 교체하며 파일/credential containment 검사는 유지한다.

DR46-F03/F04 수정 후 실행: `extension-current-final.log` **162/162 PASS**, skip/cancel/todo0.
입력 15,525개 `bb62e0249cdd300a9b672a5b4fe3d34bc69f2a440a3a48b94539d70d64fbb792`, 변화0.
실제 preload asset 존재/plan 경로, 실제 bundled Pi의 confined delivery/receipt·installed CLI와
production recipe의 host-loopback marker 교환·unshared 음성 제어·host 파일 비가시성을 확인했다.
이는 local Linux 증거이며 systemd activation/native Mac/VM/provider/power-loss 증거가 아니다.


DR46 Reconcile 이동의 현재 링크는 복구 workflow와 Storage collection의 실제 owner를
가리킨다. 위 과거 행 번호·판정·검토 범위는 새 소스의 검토 완료를 뜻하지 않는다.
