# Priority 0 감사 기록

2026-11-04의 이전 감사 항목별 현재 판정·수정·실행 근거와 macOS 미완료는 [재감사 기록](module-reaudit-2026-11-04.md)을 따른다.

파일별 발견·P0V/P0D/AV/NB ID·재현·당시 수정 및 미해결 범위의 전문은 [보관된 감사 기록](archive/documentation-cleanup-2026-10-25/priority-0-audit.md)에 있다. 원문 bytes를 보존했다.

이 경로는 [PRIORITY-0](PRIORITY-0.md)와 기존 참조의 진입점으로 유지한다. 과거의 진행 중 표시·수정 계획·PASS를 현재 작업 지시나 검증 결과로 읽지 않는다. 현재 실행 판정은 [validation](implementation/validation.md), 설계 변경의 이유는 [design-revisions](design-revisions.md)이 소유한다.

## MCS-AUD-18 — 존재하지 않는 로컬 candidate를 ancestry unknown으로 표시

- 실제 Terra Principal/Luna Worker 실행에서 Worker가 commit hash를 잘못 옮겨 적었다. `sourceRevision`은 이미 알려진 canonical object의 full OID도 허용하므로 형식만으로 로컬 존재를 강제하지 않는다. 그러나 broker에도 없는 candidate의 local bundle 준비가 ancestry 조회까지 진행해 `REF_STATE_UNKNOWN`으로 남았다. acceptance/integration은 발생하지 않았고 Principal도 완료로 보고하지 않았다.
- 수정: 기존 `runtime/input-effects/submit.ts`가 broker에 없는 candidate에 대해서만 local commit 관측을 먼저 수행한다. 명확한 부재는 `SOURCE_UNREADABLE`로 기존 protected preaccept closure를 사용한다. 관측 오류는 unknown으로 유지하며 export ref·bundle·accepted 사실을 만들지 않는다. 별도 Git workflow/재시도 owner나 full OID의 전역 로컬 제한을 만들지 않는다(P0-2/P0-5/P0-8).
- 회귀: 실제 Client/Unix RPC/Store/Git에서 full OID 오타의 rejection, 같은 original의 반복 관측·무효과, 후속 object 손상의 unknown 및 원래 거절 기록 보존을 검사한다. 실제 provider와 native Worker의 새 격리 실행에서는 정상 committed revision을 사용해 LOW merge 및 canonical 테스트가 통과했다. 첫 실패와 후속 harness 오류를 지우지 않았으며 전체 재검증과 격리 실행의 범위는 [validation](implementation/validation.md)이 소유한다.

## MCS-AUD-17 — test guard의 이중 설치가 실제 cgroup 검증을 차단

- 판정: P0-5의 검증 환경 불일치다. 직접 CLI 실행은 통과했으나 전체 runner의 programmatic phase에서 file/data URL의 동일 guard가 두 번 설치되었다. 첫 wrapper의 portable guard 환경을 둘째 wrapper가 임의 환경으로 오인해 고정 placement launcher를 거부했다. 마지막 전체 실행의 단일 FAIL을 실제 cgroup 동작 PASS로 숨기지 않았다.
- 수정: guard를 process당 한 번만 설치한다. 기존 exact script·빈 환경·실제 전달 FD 검사와 arbitrary shell/manager 거절은 완화하지 않는다.
- 회귀: `test/native-test-policy.test.mjs`의 file+portable 이중 import가 수정 전 실패한다. 소유 marker를 쓰는 launcher shape 검사는 kernel placement 증거가 아니다. 전체와 동일한 `test-local-phase`·위임 scope에서 실제 CPU/memory/pids cgroup 검사를 별도로 실행한다. 원시 결과와 전체 재실행은 validation이 소유한다.

## MCS-AUD-16 — fixed OMA catalog가 검증된 사용자 확장의 direct exposure를 소거

- 판정: MCS-S06의 별도 사용자 확장 admission과 기존 Linux 기능 보존을 위반했다. 기존 source provenance는 허용했으나 `collaboration-groups`가 fixed catalog와 그룹만 active registry로 투영했다.
- 수정: 같은 registry에서 검증된 외부 extension의 SDK direct exposure를 보존한다. OMA catalog·누적 그룹·원래 committed exposure event는 바꾸지 않고 별도 selector/실행 owner를 만들지 않는다. 현재 provenance와 등록 definition의 동일성을 매 경계에서 검사한다.
- 회귀: 양 역할의 direct/hidden/deferred/unverified, group 누적·resume/reload, revoke·late shadow를 검사한다. 실제 native Worker가 설치된 extension을 호출하는 directory/link package store와 다음 activation 시나리오를 유지한다. 이 scripted 실행을 외부 provider qualification으로 세지 않는다.

## MCS-AUD-15 — reload 정리가 폐기된 SDK context에서 자원 owner를 다시 조회

- `packages/tool-lsp/src/index.ts`: 실제 Pi 1.2.0의 reload에서 `session_shutdown`의 `ctx.sessionManager` 접근이 stale-context 오류를 냈다. P0-4에 따라 유효한 실행 시점에 얻은 LSP scope를 extension owner가 보유하고, 종료 시 그 scope를 직접 닫는다. 정리에 실패하면 owner 참조를 유지하고, 새 session의 owner를 뒤늦은 정리가 지우지 않는다.
- `packages/tool-hashline/src/index.ts`: 같은 수명 경계의 `sessionKeyFor(ctx)` 재조회는 오류를 catch하고 registry release를 건너뛰었다. 유효한 session 시작 경계에서 얻은 원래 key만 release하며 성공한 정리는 반복하지 않는다. vendor bytes·원래 sidecar·anchor 의미는 변경하지 않는다.
- 검증: 원래 LSP 실제 fix/server 검사에서 shutdown에 revoked getter를 공급하고, 실제 hashline read 뒤 revoked context로 두 번 shutdown한다. Open TUI의 실제 reload와 종료·터미널 복원을 함께 재실행한다. fixture context 거부가 실제 OS 후손 종료나 live-provider qualification을 뜻하지 않는다.

## MCS-AUD-14 — 결과 read adapter가 원래 선택 인자를 필수로 승격

- `packages/tool-runtime/src/result-read.ts`: vendor의 JSON schema properties로 새 `Type.Object`를 만들면서 다른 TypeBox 표현의 optional marker를 잃었다. 실제 provider payload에서 `read`의 `offset`/`limit`이 필수가 되어, 설명대로 path만 주는 읽기와 `oma-result` 페이지 읽기가 SDK validator에서 거절됐다. MCS-R02/R06·INV09의 provider schema/실행 일치 누락이다.
- 교정: 원래 schema의 `required` 배열과 properties를 보존하고 새 byte/line 인자는 선택 필드로 추가한다. source opener·hashline·immutable result hash/range 검증·권한에는 변경이 없다. 새 serializer/reader나 RPC를 만들지 않는다.
- 검증: 실제 Pi functional smoke의 resumed anchored read는 path만 전달한다. 실제 Principal 전달 시나리오는 긴 UTF-8 본문을 contained grep 결과의 제공된 immutable reference에서 일반 read로 끝까지 읽는다. 직접 execute-only 검사를 provider roundtrip 증거로 올리지 않는다. scripted provider는 실제 외부 provider 수용 증거가 아니다.

## MCS-AUD-13 — peer/subscription index에 표시 budget과 후속 경로가 없음

- `apps/oma/src/views/collaboration-state.ts`: roster와 구독 목록을 크기 제한 없이 mutable 파일 하나에 썼다. MCS-R04에 맞춰 UTF-8 64KiB/유효 frame budget의 작은 쪽으로 나누고 generation에 결박한 immutable page를 모두 게시한 뒤 discovery를 교체한다. registry/routing의 관측 시각과 acceptance cursor를 구분하며 cursor를 변경 stream으로 주장하지 않는다.
- `apps/oma/src/views/collaboration-mail.ts`: 기존 inbox partition 함수를 같은 owner에서 추출해 세 index가 같은 budget 판정을 사용한다(P0-2). 저장 quota·새 authority·별도 서비스는 추가하지 않는다. 한 행/헤더도 못 담으면 해당 family를 unavailable로 표시하고 이전 discovery를 보존한다(P0-5/P0-8).
- `test/collaboration-state-records.test.ts`: 182명 roster 및 161개 route의 모든 페이지와 중복/누락·byte bound·Principal 비노출을 검사한다. 실제 page/discovery write 후 실패를 주입하고 fresh view owner의 두 번 복구와 원래 accepted Mail receipt 보존을 검사한다. `implementation/durable-boundaries.json`에 원래 durable primitive 사용을 등록했다. in-process fault injection을 SIGKILL/power-loss로 세지 않는다(P0-7).

## MCS-AUD-12 — contained grep가 파일명의 숫자를 행 metadata로 오인

`test/collaboration-mail-read-bounds.test.ts`의 256KiB emoji 본문에서 actual contained grep → immutable result → paged read를 실행하자, mail UUID 안의 `-숫자-`를 행 번호 구분자로 읽어 파일명 중간에 공백을 삽입하고 실제 `:1:` 뒤 공백은 누락했다. 본문이 짧은 selected PASS로는 보이지 않았던 실제 renderer 결함이다. 별도 deterministic ASCII hyphen/colon 및 한글·emoji 파일명 × context0/1의6개 negative oracle이 모두 FAIL한 로그를 보존했다.

교정: pinned ripgrep가 filename을 NUL로 끝내도록 하고, 단일 stream owner가 그 다음 ASCII 행 번호/separator만 해석한다. pathname LF도 NUL 전에는 row 경계로 보지 않는다. context의 unframed group separator는 생성하지 않되 모든 선택된 match/context 행은 유지한다. body는 원래 Buffer 그대로 streaming하며 full-result/line accumulator를 추가하지 않는다. 기존 결과 파일·receipt·mail bytes를 repair하거나 다시 쓰는 경로가 아니다.

| 파일 | 원칙별 판단과 경계 |
|---|---|
| `packages/tool-runtime/src/contained-search.ts` | P0-2: 실제 native search metadata의 단일 renderer에서 filename과 row 관계를 분리. P0-4: 기존 snapshot/walker/result ownership을 그대로 사용. P0-5: preview를 원문으로 간주하지 않고 기존 complete/limitReached를 유지. 신규 durable boundary 없음 |
| `packages/tool-hashline/src/index.ts` | read-only 안내가 upstream oversized-line marker를 본문으로 오인하거나 shell을 요구하지 않도록, 기존 contained grep/oma-result 페이지 읽기를 설명. vendor 구현·active catalog·authority·stored history는 변경하지 않음 |
| `test/contained-search-header.test.ts` | real native rg로 exact path/header/payload/context를 독립 문자열과 대조. hyphen/colon 숫자, UTF-8, filename LF. fixture의 close를 기다린 다음 root 정리; provider/kernel/service 전체 qualification이 아님 |
| `test/collaboration-mail-read-bounds.test.ts` | actual Mail/Store publication와 SessionManager를 사용하는 현재 read/contained grep/result-page 도구 조합. 16KiB/256KiB의 equals/한글/emoji/다행 본문, engine stored-byte declarations, 원본 EML·accepted operations·delivery 보존과 archive/alias 거부. 직접 tool execute인 부분을 실제 SDK provider roundtrip으로 주장하지 않음 |
| `test/p0-review4.test.ts` | retired `oma_mail_read`/raw alias positive 두 개의 원래 의미·본문·관측 FAIL은 [archive](archive/retired-mail-reader-oracles.md)에 보존. no-tool PASS로 재명명하지 않음. 별도 current positive의 scope 차이를 공개 |
| `test/contained-tools.test.ts` | controlled walker는 actual `--null` metadata를 내보내도록 입력만 정정. 원래 progress/stall/death/cleanup 계약은 유지. synthetic walker 시험은 real-native header8개의 대체물이 아님 |
| `test/collaboration-scenario-review.test.ts` | arbitrary `r01.submit` key/raw Resident dispatch 대신 실제 SDK write/bash/oma_merge, native Worker run, 공개 status의 exact review target, typed oma_review로 HIGH/MEDIUM/LOW actual Git CAS와 Principal finality를 검사. original SCN-R01–09는 그대로 FAIL 조사 대상으로 남기며 이4개를 그9개 PASS로 대체하지 않음. scripted provider/trusted fixture auth이며 실제 provider·서비스 peer qualification이 아님 |

후속 whole-local은 source-bound 실행 자체를 완료했지만 parallel201 FAIL/1 SKIP였다. 그 중 G10-02의 두 controlled-walker fixture가 새 native `--null` 출력 대신 과거 `path:line:` 입력을 내보내고 있었다. `test/contained-tools.test.ts`에서 실제 호출의 NUL pathname delimiter만 맞췄다. 1.5s 지연,400ms drip, heartbeat-only ceiling, exact 성공 문자열, 실제 child 종료/cleanup oracle은 변경하지 않았다. 후속 원래 contained-tools 전체와 reader/header/native/P0의5개 파일67개가 PASS했지만, 그 결과로 whole-local의201 FAIL을 소급 감산하지 않는다.

실행별 raw 로그·exit와 한계는 [validation](implementation/validation.md)의 deadline reader/native checkpoint에 둔다. 기존 원칙을 수정할 필요는 발견하지 않았다. whole-spec/whole-source authored approval, every durable kill window, 원래9개 scenario의 모든 보장, whole-local 및 mandatory/platform/provider/A/B/C qualification은 이 항목으로 성립하지 않는다.

## MCS-AUD-11 — accepted 구형 integration plan을 current scope로 실행

- 판정: fresh legacy integration factory를 제거한 뒤에도 `IntegrationCoordinator.applyMerge`/`reconcile`은 저장된 `merge.version` 1/2를 current review scope/vote와 결합해 실행했다. `requireMergeEligible`의 원래 fallback과 publication의 version 분기가 alternate executor였다. MCS-S13/DR72·P0-1/2/5 위반이며, 이전 MCS-AUD-09/10 교정을 accepted-plan 전수 qualification으로 읽으면 안 된다.
- 독립 재현: 실제 Store/Mail/Git에서 current original v3 scope와 실제 qualified vote를 만들고, vote의 owned materialization 직전에 보류했다. original Store acceptance/closed decoder로 명시적 historical v1/v2 plan corpus를 넣었다. pending/unknown × main=base/candidate의8개 모두 실제 owner 호출이 거절되지 않았다. base에서는 실제 main CAS가 일어났고8개 row가 모두 succeeded가 됐다. bytes를 파싱했다는 사실만으로 실행 권한을 얻어서는 안 된다. 실제 authenticated caller/broker 침투를 입증한 것은 아니며 historical corpus에 notice는 빈 배열이다.
- 교정: Git integration owner의 단일 `currentMerge` 판정은 original reviewed application version3만 허용한다. nonterminal old plan은 canonical observation/publication/settlement 및 accepted-failure 변환 전에 `UNSUPPORTED_PROFILE`로 거절한다. source-policy eligibility fallback과 old version의 실행/publication 분기는 제거한다. raw plan/payload/hash/key/receipt·pending/unknown을 바꾸지 않고 원래 release/owner의 진단/drain을 요구한다. terminal replay와 unrelated non-reviewed Human operating path는 새 실행으로 합치지 않는다.

| 파일 | 변경 경계와 P0 판정 근거 (전체 파일 authored approval 아님) |
|---|---|
| `packages/git/src/integration.ts` | `applyMerge`/recovery가 같은 current-plan gate를 호출한다. refusal은 accepted-failure catch 밖에 있어 release incompatibility를 original failed/unknown/succeeded fact로 바꾸지 않는다. eligibility와 publication도 같은 판정을 공유하며 기존 current preparation/source checks·final authority·writer barrier·CAS 순서는 유지한다(P0-1/2/4/5/7). fresh direct refusal은 은퇴한 도구를 안내하지 않는다. |
| `test/collaboration-retired-integration.test.ts` | actual qualified vote의 materialization owner를 settle한 뒤 정리한다. original raw JSON/hash/row·all refs 보존, current vote continuation의 무효과, 두 번 Store reopen/same-key receipt, 별도 fresh Node의 actual Git composition/reconcile refusal을 각각 검사한다. third main도 원래 pending/unknown을 바꾸지 않는다. terminal original result/failure는 unavailable current policy 아래 그대로 관측한다(P0-1/2/4/5/7). direct component AuthContext/explicit stored corpus는 peer/provider/original-release drain qualification이 아니다. |

실행과 중간 FAIL의 원시 로그는 [validation](implementation/validation.md#accepted-legacy-integration의-실행과-원래-사실-분리-checkpoint)이 소유한다. 새 durable boundary를 추가하지 않았으며 fresh Node component reopen은 full broker/engine kill·power loss나 original-release drain proof가 아니다. 다른 stored envelope/accepted-plan owner·historical scope의 모든 recovery 분기·Views/profile·전체 whole-local/mandatory qualification은 여전히 미완료다.

## MCS-AUD-10 — current 완료 notice가 은퇴한 reader와 direct diff 실행을 유지

- 판정: `ReviewAdvancement.createIntegration`은 current accepted preparation이 있어도 owned `prepareDiff`가 빠지면 direct `mergeDiff`로 실행을 이어 갔다. 새 full/compact 완료 notice는 제거된 `oma_review_diff`와 cursor 사용을 안내했다. MCS-S13/DR72의 fallback 제거, MCS-R02/R05/R06의 일반 파일 discovery 및 역할 경계와 불일치다. P0-1/2의 현재 실행 계약과 원래 frozen 사실을 분리해야 한다. authenticated broker 권한 우회가 입증됐다는 주장은 아니다.
- 독립 재현: 실제 Git/Store/Mail로 current preparation을 수락·완료한 다음, integration allocation 직전 test-only runtime hook에서 진행을 보류했다. original context/ready 상태를 확인하고 owned diff primitive만 없는 composition에서 advance하면 direct diff callback이 실제 Git을 읽었다. full/compact 새 메일에도 retired tool 호출이 남았다. fixture가 실제 shell 실패를 성공으로 대체하지 않는다. 실행 수치·중간 실패는 validation이 소유한다.
- 교정: current integration은 owned diff 준비 primitive 부재를 새 operation/artifact allocation 전에 `UNSUPPORTED_PROFILE`로 거절한다. 직접 diff fallback과 그 Review/Git repository port·기존 canonical notice 함수 export를 제거한다. full/compact 생성은 같은 role-neutral `record_root`의 해당 request status discovery를 안내하며, Principal에 Worker patch 노출을 약속하지 않는다. original accepted plan/message를 새 문구로 재생성하거나 unknown을 terminal로 정산하지 않는다.

| 파일 | 변경 경계와 P0 판정 근거 (전체 파일 authored approval 아님) |
|---|---|
| `packages/review/src/advancement.ts` | 원래 v3 preparation 아래에서도 direct diff로 우회하지 않는다. original complete patch/preview coverage와 preaccept owner 등록, synchronous T 전 message freeze·T 후 execution 순서는 그대로다. 새 안내만 records를 사용하며 original receipt/accepted mail은 재작성하지 않는다(P0-1/2/4/5/7). |
| `packages/review/src/types.ts` | obsolete `mergeDiff` 실행 port를 제거한다. read projection의 optional preparation과 실제 실행의 필수 primitive를 구분한다(P0-1/2). |
| `packages/git/src/repository-port.ts` | repository composition의 같은 obsolete 실행 port를 제거하고 current owned preparation/accepted patch read owner는 유지한다(P0-2/4). |
| `packages/git/src/repository.ts` | obsolete callback wiring을 제거한다. owned `ReviewArtifacts`/`IntegrationPreparation`과 frozen patch bytes·exact source observation을 새 adapter로 대체하지 않는다(P0-2/4/5). |
| `packages/git/src/canonical-command.ts` | direct completion-notice diff 함수 export와 그 stale 주석을 제거한다. canonical 관측/CAS/revert primitive와 그 권한/실패 의미는 바꾸지 않는다(P0-1/2/5). |
| `test/merge-review.test.ts` | 실제 settled context를 보존한 unsupported advance/sweep/reopen, same-key receipt의 무효과와 원래 current owner를 다시 공급한 명시적 advance의 exact context/real CAS를 각각 검사한다. hostile extra callback은 negative input이지 지원 API가 아니다(P0-1/2/5/7). oversize 회귀도 current owned diff primitive를 실제 실행하며 반복 fact 생성을 거절한다. |
| `test/collaboration-review-records.test.ts` | 새 full/compact notice에서 실제 request status→material child pages→exact applied attempt→complete patch를 따라 독립 Git output과 대조한다. Principal은 자기 status만 읽고 Worker patch/raw archive는 containment가 거절한다. read/publication/reopen 후 accepted rows·원래 EML 불변을 검사한다(P0-1/2/5/7). Worker `/oma`→physical directory mapping은 fixture-only이며 mounted/authenticated Worker qualification이 아니다. |
| `test/architecture-p1c.test.ts` | IMP-R11의 large patch 전체 bytes·pagination/reopen oracle을 유지한다. 삭제한 production fallback을 expected 계산에 재사용하지 않고 별도 Git CLI 관측과 exact byte equality로 검사한다(P0-2/7). |
| `packages/git/test/installed-runtime.mjs` | 원래 packed-install smoke의 실제 published-ref/CAS/fsck oracle을 유지하면서 obsolete `mergeDiff` port와 `canonicalMergeDiff` export 부재를 검사한다. workspace probe를 독립 설치 검증으로 승격하지 않는다(P0-1/2/7). |

- 새 discovery 시험의 첫 후속 실패는 root index가 항상 child page를 가리킨다는 기존 계약을 간과한 fixture 오류다. producer를 단일 page로 바꾸지 않고 실제 child graph를 모두 읽게 교정했다. 이후 TS7022 build 실패는 local string/optional-string annotation으로 교정했으며 production 타입을 넓히지 않았다. 원시 실패는 그대로 보존한다.
- 이 교정은 모든 legacy public payload/accepted-plan execution·Views/default 제거, 실제 original-release drain, 전체 process-death/provider/platform qualification을 완료했다는 뜻이 아니다. 남은 구형 error guidance와 scenario의 실제 caller/role·public method 거절도 별도 점검 대상이다.
- 후속 scenario caller 점검: `test/fixtures/scenario.ts`의 default Resident spec과 직접 AuthContext에는 `git.submit`이 있지만 `residentPushes`는 `r01.submit` 같은 임의 key로 public mutation을 보낸다. `composition.ts`는 실제 Submit owner 전에 `HostInvocations.guardMutation`을 호출하며 selected model session의 새 key는 원래 Pi invocation 및 `inv1-<hash>.submit` child 관계를 요구한다. 현재 첫 CAPABILITY_DENIED는 이 fence와 부합하며 capability 확대/selection 우회로 고치지 않는다. 이어지는 retired tool·Principal patch reader·caller-chosen request 기대는 아직 그 oracle에 도달하지 못한 별도 계약 점검이며,9개 전체를 단순 fixture drift로 결론내리지 않는다.

## MCS-AUD-09 — fresh review adoption과 저장된 adoption fact의 혼용

- 근거: MCS-S13/DR72의 실행 제거와 MCS-X05의 no-adopt 계약에 반해, `ReviewPreparation.prepareControl`은 current host policy/provenance로 `review.adopt` fact를 새로 만들고 Client/public input grammar도 그 실행을 제공한다. 저장된 adoption fact를 해석하는 것은 별개다. P0-1/P0-2의 fresh authority와 historical fact 분리 문제이며, 기존 rows·hash·plan·mail bytes를 삭제/재작성해서 해결하지 않는다.
- 교정 경계: fresh wire/action/client/preparation에서 adoption 생성·선택을 제거한다. historical payload/fact decoding은 효과 없는 read owner로 분리해 원래 receipt와 상태 관측을 보존한다. historical decoder를 새 실행 factory로 연결하거나 current defaults로 원본을 보정하지 않는다.
- 호환 판정: old review/adopted scope는 current execution으로 자동 승격하지 않고 original release/owner의 drain·진단을 요구한다. 이미 기록된 terminal receipt의 관측은 새 실행이 아니다. current policy가 바뀌면 원래 scope를 보존하며 합법적인 cancel/fresh proposal 또는 명시적 운영 복구가 필요하다.
- 기존 시험의 충돌: `IMP-R19`와 `AUD-01`의 fresh adoption 호출은 제거 결정 이전의 실행 계약이다. [원래 positive oracle 원문](archive/retired-review-adoption-oracles.md)과 그 거절 FAIL을 보존하고 current no-adopt PASS로 재명명하지 않는다. 새 DR72 시험은 같은 실 Mail publication 지연 경계에서 no-stale-CAS/no-corruption, 원래 accepted vote/receipt 보존, 합법적 cancel 뒤 별도 proposal·fresh vote·prepared context, explicit authenticated host retry를 각각 검사한다. historical adoption corpus는 read-only evidence이며 새 adoption factory나 original-release drain proof가 아니다.
- 후속 독립 재현: 새 adoption 생성을 닫은 뒤에도 저장된 adoption scope는 `record`와 `advance`에 의해 current 권한을 얻었다. 처음 사용한 bare check exception의 pending 결과는 fixture 오류로 분리하고 원래 `CHECK_FAILED` 계약으로 재현했다. current policy와 qualified votes가 모두 맞는 historical scope도 이 release의 실행 허가가 아니다.
- 교정: `ReviewAuthorityReader.assertExecutable`가 original open v3/no-adoption 관계를 한 번 정의한다. fresh targeted record, acceptance 재검사, sweep/advance, 최종 CAS gate가 이를 공유한다. old/new advancement 분기·old-policy 기본값 승격·direct version2 integration plan 생성은 제거하고 current accepted prepared context만 쓴다. 기존 facts의 표시와 current execution의 blocked 원인을 구분하며 terminal/pending/unknown receipt를 바꾸지 않는다.
- packed Review smoke의 원래 version1 execution-positive 계약도 current gate와 충돌했다. 원문과 observed FAIL은 [별도 보관](archive/retired-review-installed-scope-oracle.md)에 남긴다. current smoke는 별도 current original scope/qualified vote와 historical read-only/refusal을 함께 검사하며, old scope의 실행이나 old unqualified vote의 live-roster 의미가 성공했다고 바꾸지 않는다. DR66의 accepted qualification과 현재 eligible roster는 다른 관측이다.

| 파일 | 변경 경계와 P0 판정 근거 (전체 파일 authored approval 아님) |
|---|---|
| `packages/contracts/src/attestation.ts` | fresh `ReviewInput`에서 adoption을 제거하고 효과 없는 `StoredAttestationInput`을 분리한다. 원래 v2/v3 fact 타입은 역사적 의미를 유지한다(P0-1/2). |
| `packages/domain/src/attestation.ts` | fresh closed grammar와 `storedAttestationInputProblem`의 read-only payload grammar를 분리한다. stored 데이터도 unknown field를 거절하며 현재 값으로 보정하지 않는다(P0-1/2/5). |
| `packages/domain/src/validation.ts` | live `attest.record` registry는 fresh grammar만 사용한다. stored reader를 live decoder로 노출하지 않는다(P0-1/2). |
| `packages/protocol/src/request-codec.ts` | 원래 frozen payload를 current caller DTO로 거짓 typing하지 않는다. 복구 cache/ledger 읽기의 구조 검사이며 효과·재전송 허가가 아니다(P0-1/2). |
| `packages/protocol/src/operation-codec.ts` | payload는 저장 타입이고 hash·plan/fact/request·acceptance sequence 관계 판정은 원래 read owner에 남는다. original JSON 문자열을 재작성하지 않는다(P0-1/2/5). |
| `packages/client/src/index.ts` | `controlReview`의 새 adoption 선택/타입을 제거한다. 원래 request key/receipt 관측을 새 실행으로 바꾸지 않는다(P0-1/2). |
| `packages/review/src/preparation.ts` | adoption factory와 old review를 adopt 후 retry하라는 branch를 제거한다. withdraw/invalidate의 원래 actor/host/pending-integration 경계는 유지한다(P0-1/2). |
| `packages/review/src/authority.ts` | historical scope의 실행 불가와 fresh/current CAS 허가를 분리한다. read projection이 이미 가진 entries를 검사해 새 per-request ledger 재스캔을 강요하지 않는다. current T 재검사에도 같은 gate를 사용한다(P0-1/2/5). |
| `packages/review/src/index.ts` | original same-key receipt lookup은 fresh grammar/policy/scope 판단보다 앞에 남고, 새 targeted mutation만 current execution gate를 거친다(P0-1/2/4). |
| `packages/review/src/advancement.ts` | old/adopted scope를 modern 실행으로 승격하는 선택과 legacy advancement를 제거한다. unsupported sweep은 원래 row를 지우거나 terminal로 정산하지 않는다(P0-1/2/5). |
| `packages/review/src/acceptance.ts` | 새 integration은 원래 accepted prepared context와 version3 plan만 생성한다. 원래 captured synchronous T·delivery 수락·materialize 순서를 유지한다(P0-1/2/4/7). |
| `packages/review/src/status.ts` | policy 변경 때 adoption 실행을 안내하지 않는다. read-only historical 표시와 current blocked 이유를 구분하며 projection을 현재 허가로 승격하지 않는다(P0-1/2/5). |
| `packages/review/test/installed-runtime.mjs` | production spec/fact validators로 별도 current fixture를 구성한다. qualified vote 불변, live roster의 새 관측/이전 snapshot 불변, cancel/missing-request 거절과 historical scope의 별도 실행 거절을 검사한다. narrow readonly ledger stand-in이며 실제 Store/peer/Git CAS/provider qualification이 아니다(P0-1/2/5/7). |
| `docs/archive/retired-review-installed-scope-oracle.md` | 원래 smoke 원문·기대 의미와 old-scope gate에서 실제 관측된 FAIL을 보존한다. archive는 executable compatibility나 current no-execution PASS가 아니다(P0 문서 식별자/검증 이력 보존). |

- 실행·source binding과 아직 제거하지 못한 경로의 판정은 [validation](implementation/validation.md)이 소유한다. 저장 reader가 남았다는 이유로 old execution이 제거됐다고 미리 선언하지 않는다.

## MCS-AUD-08 — private 대화 준비를 broker 권한 부여와 다시 합침

- 판정: `apps/oma/src/application/society-runtime.ts`의 ready-only `startSessionOnce`는 기존 사용자 결정 [DR35](design-revisions.md#dr35--the-private-conversation-starts-alongside-society-preparation)와 충돌한다. P0-1/P0-2의 private engine lifetime과 Society authority 분리 위반이다. MCS-S13의 old birth/plan 실행 거절은 current birth의 private 대화도 broker 준비에 묶으라는 결정이 아니다. 기존 DR35 oracle을 구현에 맞춰 낮추지 않는다.
- 재현: current birth의 production constructor와 누락된 controlled import를 공급한 원래 composition 시험에서 `PrincipalSession.start`가 broker ready 전 발생하지 않았다. 별도 broker wiring18개는 통과하여 이 회귀를 old-session 거절과 구분했다. 같은 실행의 다른35개 실패에는 TUI stand-in의 누락된 `resetInput`도 있으므로 모두 이 제품 결함으로 돌리지 않는다.
- 교정 계약: 원래 lease/birth/설정/private path admission 뒤 current plan의 private engine만 먼저 연다. host provisioning은 허용된 record **디렉터리만** 준비하고 health/index/receipt/empty ledger fact를 만들지 않는다. broker가 정본 records를 갱신한 뒤에만 credential을 발급하며, 그 이전 Society 도구·delivery는 계속 닫힌다. private conversation은 old tool/decoder/compatibility runtime을 사용하지 않는다.
- 수명 계약: 실패한 engine setup은 실제 child exit 전 slot/terminal을 풀지 않고 자동 재시작하지 않는다. explicit restart와 broker generation/ownership 재검사, late registration refusal, Human의 private control editor hold를 보존한다. broker를 잃은 뒤의 후속 engine 생성은 기존 ready gate를 유지한다.
- 파일별 판정: `society-runtime.ts`는 engine 생성/credential·delivery의 phase를 분리하며 새 durable operation/credential 저장을 만들지 않는다(P0-1/P0-2). `host-tenure.ts`는 lease/engine death/initial permission을 한 owner에서 판정하고 broker loss 뒤 initial permission의 재사용을 막는다(P0-4/P0-5). `provision.ts`의 새 artifact는 permitted container뿐이고 owner는 원래 state tree와 owned durable primitive다; 정본 fact/index를 게시하지 않는다(P0-4/P0-8). 원래 storage helper와 durability barrier를 복제하거나 바꾸지 않았다.
- fixture 오류의 별도 판정: 새 record-root symlink 시험의 `throws`/link 보존 기대는 P0-8과 `ensureOwnedDirectory`의 기존 stray-slot 수리 계약에 어긋났다. 이 helper는 held parent에서 링크 **자체만** unlink하고 container를 만들며 target을 따라가지 않는다. 제품 helper를 바꾸지 않고 이 새 시험을 원래 수리 계약으로 바로잡는다. 독립 oracle은 target inode/mode/bytes와 birth bytes 불변, 새 container에 target file·가짜 ledger/index가 없음이다. 이 실패도 원시 결과에 남긴다.
- 실행 결과·source binding·실제 범위와 미검증 항목의 owner는 [validation](implementation/validation.md)이다. controlled composition과 isolated provisioning child의 죽음을 실제 App/SDK/provider/peer 인증 또는 전체 product process-death qualification으로 확장하지 않는다.

## MCS-AUD-07 — child policy의 구형 기본 분기가 current profile 검사를 생략

- 판정: **MCS-S13/MCS-X04/X09의 live legacy/default 잔존**, P0-1/P0-2에 따라 fresh child preparation과 accepted spec 관측을 분리한다. `packages/config/src/policy.ts#createChildSpecResolver`는 세 번째 인자 생략 또는 `"legacy"` 선택 때 `resolve`/`observe`의 current capability 검사를 하지 않았다. production broker는 당시 current 값을 명시하여 이 경로를 피했으므로 authenticated broker의 권한 우회라고 주장하지 않는다.
- 재현: 독립 resolver 회귀는 `context.publish`가 실제 위임 교집합에 남는 입력의 resolve/observe 두 경계를 모두 검사한다. 별도 실제 Lifecycle/Store/Mail/Git canonical-base fixture에서도 생략/retired selector로 새 생성이 거절되지 않음을 수정 전에 확인했다. 처음 Git base/source owner가 빠진 fixture 실패는 정상화된 재현과 구분한다.
- 수정: selector 인자와 구형 기본값·조건 분기를 제거하고 새 resolved spec/child observation에는 같은 current capability owner를 항상 적용한다. production broker와 scenario caller의 selector 전달도 제거했다. host-only `code.integrate` grant, parent/frozen authority/delegable 교집합, policy refresh의 transaction 밖 I/O 및 failed-refresh fence는 유지한다.
- 보존: Lifecycle의 same-key receipt 관측과 accepted source/spec recovery 순서는 변경하지 않았다. 회귀는 current selected creation을 실제 수락한 뒤 현재 policy read를 실패시키고 Store를 reopen해도 원래 planJson/payloadJson/requestHash/agent/receipt 및 비-DB 파일 bytes가 유지되고 새 effect가 생기지 않음을 확인한다. 이 reopen은 같은 process이며 historical unsupported profile drain·fresh-process/power-loss·authenticated Worker/provider qualification을 대신하지 않는다.
- 실행 결과와 raw log/input binding은 [validation](implementation/validation.md)이 소유한다. 이 제거는 나머지 old payload/accepted-plan 실행·adoption·Views·운영/drain의 완료가 아니다.

## MCS-AUD-06 — custom-message run을 ordinary prompt와 같은 초기화로 가정

- 판정: **MCS-P01/T10의 실제 실행 경로 누락**. OMA `packages/extension/src/prompt-boundary.ts`는 `before_agent_start`의 normalized options로 role/authority/environment/guidance를 준비한다. 그러나 pinned SDK 1.0.1 `sendCustomMessage`의 idle `triggerTurn` 분기는 `_runAgentPrompt`를 바로 호출해 그 준비를 건너뛴다. `packages/extension/src/delivery.ts`의 실제 전달은 이 public API를 사용한다. correct tool list만으로 prompt 계약이 충족됐다고 볼 수 없다.
- 재현: `test/scenario-tool-surface.test.ts`의 실제 native Worker 전달에서 네 provider 요청과 누적 catalog는 생성됐지만 최초 요청은 leading system message가 없었고 후속 요청에도 `oma_tools`가 없었다. ordinary Principal prompt와 이미 prompt를 거친 Principal 전달은 통과하여 cold Worker 경계를 대체하지 못함을 확인했다. 과거 receipt/accepted fact의 의미 변조나 authority 우회를 재현했다고 주장하지 않는다.
- 교정: 사용자 [DR73](design-revisions.md#dr73--custom-message-전달의-공개-prompt-계약을-위해-공식-sdk-120을-고정한다) 승인에 따라 공식 SDK 1.2.0을 사용한다. 실제 배포본의 source/types/docs에서 custom `messageType`, 공통 run preparation, 최초 system patch와 run options 보존을 확인했다. vendor/private state 패치, provider codec 복제, `prompt()` 우회, guarded oracle 완화는 하지 않았다. OMA의 policy owner와 custom mail 출처는 그대로다.
- 회귀: 실제 Worker/Principal 전달과 ordinary Principal의 최초·후속 role/authority/environment/tools payload, real persisted member result/exposure ordering을 검사한다. 별도 실제 SDK cold custom-message 시험은 두 역할의 discovered context/provenance·append suppression·task-context 귀속·same-batch refusal·cumulative repeat·resume 및 기존 journal prefix bytes 보존을 검사한다. 후자의 non-group tools는 inert fixture이며 broker 인증·sealed rootfs 증거가 아니다.
- 기존 UI adapter의 exact version/member·cleanup·Personal 동작은 원래 oracle로 재검증한다. dependency 갱신으로 private 접점이 사라졌다고 주장하지 않는다. delivery protocol revision/원래 저장 bytes는 변경하지 않는다. 전체 qualification 및 실제 모델 비교 완료를 뜻하지 않으며 실행 결과·입력·미실행은 validation이 소유한다.

## MCS-AUD-01 — related challenge를 원래 merge의 source revision으로 오인

- 판정: **P0-2/P0-5 위반**, `apps/oma/src/views/collaboration-reviews.ts`의 `publishRequest`.
  원래 review ledger는 `challenge.open`을 challenge 자신의 opening이면서 대상 merge의 related entry로도 제공한다.
  renderer가 관련 entry를 모두 해당 request의 source revision으로 게시하여, merge의 immutable `revisions/0`에
  challenge의 다른 source를 다시 게시하려 했다. immutable conflict 자체는 정상 거절되지만 원래 applied merge의
  refresh/discovery를 `BROKER_UNAVAILABLE`로 만들어, 실제 applied fact의 가시성이 관련 challenge 때문에 손상됐다.
- 수정: fact history 게시를 유지하고, opening-source 게시만 `entry.operation === record.request` 관계에 결박한다.
  challenge 자신의 별도 source·original applied delta는 기존 owner로 게시한다. ledger·Git ref·target bytes·과거
  accepted fact를 고치지 않고 immutable conflict 처리를 완화하지 않는다. 새 authority/상태/서비스는 없다.
- 재현/회귀: `test/collaboration-client-review-actions.test.ts`의 MCS-A40/A41.
  실제 Client/RPC/Host/Review/native Git으로 LOW merge를 적용하고 broker-prepared challenge를 연 뒤,
  fresh publisher에서 원래 merge의 discovery 실패를 수정 전에 재현했다. 이후 main 이동·existing challenge의
  omitted replacement 보존과 원래 merge source bytes/applied target의 보존을 함께 검사한다.
  이 실행의 판정·명령·raw log·한계는 [현재 validation](implementation/validation.md)의 독립 재검증 절이 소유한다.

## MCS-AUD-02 — persisted exposure의 부분 그룹을 정상 loadout으로 복원

- 판정: **P0-2/P0-5 위반**, `packages/tool-runtime/src/collaboration-groups.ts`의 `restored`.
  writer는 그룹 전체를 cumulative union으로 저장하지만 reader는 role별 이름 membership/중복만 검사했다.
  개별 이름이 유효해도 그 집합이 확정 가능한 group exposure인 것은 아니다. 손상된 event의 일부 web/LSP
  member만 활성화하여 저장 사실을 정상적인 마지막 loadout으로 해석했다.
- 수정: 원래 reader에서 허용된 각 그룹은 전부 포함되거나 전부 빠져야 함을 검사한다. 부분 집합은
  기존 refusal 경로가 callable tools를 닫는다. 원래 event/branch/source bytes를 보정하거나 삭제하지 않고,
  누락된 도구를 자동 추가하여 과거 선택을 새 선택으로 바꾸지 않는다. 새 durable boundary/authority는 없다.
- 재현/회귀: `packages/tool-runtime/test/collaboration-groups.test.mjs`는 두 역할의 각 member 누락을 검사한다.
  `test/collaboration-groups-engine.test.ts`는 실제 Pi로 web exposure/result를 저장한 뒤 명시적 corruption fixture로
  event 일부만 남기고 SDK journal을 다시 열어 refusal·빈 callable loadout·원본 bytes 보존을 확인한다.
  정상 양방향 union·same-batch·resume과 함께 실행한다. fixture의 fatal 포착은 실제 process exit proof가 아니며
  HTTP scripted provider를 live provider로 주장하지 않는다. 결과와 raw log는 [validation](implementation/validation.md)이 소유한다.

## MCS-AUD-03 — 확장 startup 거부보다 먼저 SDK가 기존 journal에 metadata를 추가

- 판정: **MCS-S13의 원본 불변 거부 경계 누락**, P0-2/P0-4/P0-7에 따라 launch owner에서 admission 시점을 구분한다.
  확장의 `session_start` refusal은 SDK session 생성보다 늦다. 실제 Pi에 과거 unresolved `toolset` call과
  custom selection을 담은 journal을 열면, 거부되어도 SDK가 `thinking_level_change`를 먼저 append했다.
  과거 operation의 의미나 terminal 상태가 바뀐 재현은 아니며, SDK 자체의 metadata 동작을 결함으로 단정하지 않는다.
- 수정: `packages/domain/src/collaboration-surface.ts`가 current surface parsing/role requirement를 단독 소유한다.
  `packages/engine/src/principal-launch.ts`, `principal-session.ts`, `interactive-configuration.ts`와
  `pi-spawn-plan.ts`/`pi-adapter.ts`는 SDK/child/settings write 이전에 이 검사를 호출한다. legacy/absent를
  선택된 v3로 바꾸지 않는다. 확장의 reload/provider/tool refusal hooks는 추가 방어이며 앞선 admission의 대체물이 아니다.
- 회귀: `test/collaboration-retired-session.test.ts`의 fresh child에서 원래 launch builder를 먼저 호출하여
  v2/absent/malformed를 거절한다. 실제 Store/Mail로 이미 수락한 operation/receipt/archive/delivery와
  unresolved Pi journal의 전체 bytes/파일 목록을 보존하고 provider request가 없음을 확인한다.
  명시적인 **시험 전용 late-guard 대조군**은 builder를 건너뛰어 같은 SDK append를 계속 재현한다.
  이 시험은 actual authenticated Principal child/Worker 또는 전체 broker/crash/old-birth 이행 qualification이 아니다.

## MCS-AUD-04 — collaboration recipient bound가 provider schema/초기 validator에 전달되지 않음

- 판정: **INV09/MCS-T00의 effective limit 전달 누락**. 기존 host/broker bound는 유지되어 권한 우회나 과거
  acceptance 변경은 재현하지 않았다. selected `oma_send` schema는 host addresses=64/7에도 `maxItems`가 없었다.
- 수정: 원래 `collaboration-inputs.ts` owner가 같은 명시 bound를 schema와 pre-invocation input validator에 적용한다.
  `mail-tools.ts`는 host의 유효한 positive-safe-integer bound를 요구하며 임의 64 fallback을 만들지 않는다.
  `collaboration-tools.ts`는 이를 등록 때 캡처한다. generic historical argument decoding과 saved plan/hash/key/receipt에
  새 current bound를 소급 적용하지 않는다. broker의 실제 effect-time authority/bound 검사는 그대로다.
- 회귀: `test/delivery-notice.test.ts`의 selected schema 비교가 수정 전에 실패했다.
  `packages/extension/test/collaboration-registration.test.mjs`는 두 역할과1/7/64/128에서 exact max/허용 경계/초과
  입력을 검사하고, missing/invalid host bound의 등록을 거절한다. 이 schema/등록 fixture를 live provider나
  authenticated broker effect의 증거로 읽지 않는다. 실행 결과·명령·원시 로그는 validation이 소유한다.

## MCS-AUD-05 — 현재 plan 주입이 구형 Society birth를 Worker opt-in으로 승격

- 판정: **MCS-S13의 birth/실행 admission 관계 누락**, P0-1/P0-2/P0-5에 따라 birth 관측과 실행 선택을 분리한다.
  `apps/oma/src/runtime/native-residents.ts`는 명시적인 current Worker plan이 주어지면 old/missing birth에서도
  collaboration record/실행 owner를 구성했다. 실제 before regression의 두 경우가 `Missing expected exception`으로
  실패했다. 이 재현은 owner 조립까지이며 실제 provider/Worker 효과나 과거 receipt 의미 변경을 주장하지 않는다.
- 같은 시작 경계 점검: `application/society-bootstrap.ts`는 old/default의 tenure·execution recovery와 설정 준비에
  도달했고, `entry/broker.ts`는 birth incompatibility 판단 전에 run-root/lock 준비와 config load를 수행했다.
  fresh omitted 선택도 구형 birth 준비를 시도했다. 이전 explicit fresh closure 자체는 정상 대조군이다.
  initial fixture의 project/state overlap과 project binding 누락은 바로잡고 valid-fixture before log를 별도로 남겼다.
- 수정: 원래 `runtime/session-mode.ts`의 `requireCollaborationSociety`가 명시된 original birth/mode/Society 관계를
  execution admission으로 검사한다. 진단·history routing·Personal의 birth reader는 유지하며 구형 실행 decoder가 아니다.
  CLI bootstrap과 standalone broker는 tenure/lock/Store/restore/recovery/provision/SDK 쓰기 전에 호출한다.
  Native Residents도 같은 검사를 수행하여 explicit current plan으로 우회할 수 없다. production 시작의 v2 emitter
  fallback과 Principal의 readiness 이전/legacy 시작 분기를 제거했다. 구형을 v3로 쓰거나 defaults를 활성화하지 않는다.
- 회귀: `test/collaboration-society-admission.test.ts`는 실제 CLI/broker의 두 fresh-process 재시도, 원래 pending operation,
  succeeded Mail/receipt/archive/delivery, unresolved SDK journal, 실제 Git main/object와 전체 파일 bytes 보존을 검사한다.
  current birth의 owner 조립 positive control, malformed/unreadable birth의 오류/unknown 보존, invalid/타 역할 plan 거절,
  fresh admission closure와 Personal birth 보존을 분리한다. config는 의도적으로 이 release가 실행할 수 없는 보존 fixture이며
  original-release drain·authenticated Worker/provider·whole-broker crash/power loss·모든 구형 payload/plan qualification은 아니다.
  결과·원시 로그와 미완료 범위는 [validation](implementation/validation.md)이 소유한다.
