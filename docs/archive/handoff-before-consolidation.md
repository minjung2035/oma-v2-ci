# 인계 기록 원문 — 2026-10-02 정리 전

아래 내용은 정리 전 작업 트리의 역사적 기록이다. 당시 current/active/PASS/NOT_RUN 표현과 수치가 현재 판정이나 실행 지시를 뜻하지 않는다. 현재 상태와 재개점은 [문서 지도](../README.md)에서 찾는다. 기존 기록을 삭제하지 않고 이곳에 보존했다.

# OMA v2 — 미완료 요청 인계

2026-10-01. 사용자가 이 인계 전체의 순차 구현·검증과 과도하거나 잘못된 구현의 정리를 요청했고, 이후 "끝까지 작업을 모두 완료해. todo를 만들고 차례대로 구현후 테스트 보강"으로 목표를 재개했다. **현재 목표는 active다.** 이전 중단 상태를 현재 실행 금지로 해석하지 않는다.

이 문서는 **사용자가 요청했지만 전체 완료를 확인받지 못한 작업**과 정확한 재개점만 담는다. 과거 완료 작업의 연혁은 다시 나열하지 않는다. 전체 구현·release 완료를 주장하지 않는다.

## 현재 TODO — 아래 A~G 전체가 완료 분모

- [ ] A: 실제 main 통합의 tier/floor/동료 리뷰/Principal 판단과 trusted checks를 끝내고 정상·거절·중단·재시도 증거를 확인한다.
  - 현재 변경: 새 설정은 tiered 기본값, live HIGH floor 최소 2, 정확한 후보 검사 executor와 broker 조립. 이전 저장된 floor=1 사실의 decoder/evaluator는 보존한다.
  - 실제 systemd 검사 실행과 reviewer shortage 예외 probe는 §6의 기존 독립 차단에 해당한다. 코드/fixture 증거와 구분한다.
- [x] B: Principal routine RPC·동적 도구·프로젝트 write/edit를 차단하고 read/mail/review/safety 및 명시적 GOAL mail을 검증한다.
  - 현재 변경: raw actor RPC와 도구 그룹에도 역할 제한 적용, Principal actor start는 자신의 force-stop 해제만 허용. raw RPC·dynamic tool projection과 실제 execution guard의 회귀를 확인했다.
- [x] C: 독립 clone·현재 raw worktree 첫 snapshot·Config 초기 수 영속화·총 생성 수/동시 추론 구분과 활성 수 제한 제거를 대조했다. real Git/ledger와 scripted units 회귀로 확인했으며 native manager proof와 구별한다.
- [x] D: Society close/open/restart/resume의 종료 경계·closed/개별 stopped 보존·enabled Worker reconciliation을 대조했다. actual writer exit와 scripted unit 회귀 범위이며 실제 manager/native VM 검증은 별도다.
- [x] E: Worker 사망/Principal 지연의 기존 수정과 전체 시간값 audit 및 선택한 1-1/3-4/3-5를 검증했다. long selector/egress timer clamp를 수정했고 총 model/tool turn deadline을 추가하지 않았다.
- [x] F1: Mac 첫 프로젝트 확장 seed의 host project/bookmark owner와 locked absent-choice 관측 경로를 구현하고 검증한다.
  - host-record UUID/bookmark/root identity와 async locked seed는 구현됨. bound project의 첫 관측은 이미 실행 중인 app/engine을 요구하며, 이 한계와 native NOT_RUN을 별도로 기록한다.
- [x] F2: Mac Society ↔ Personal history/resume/fork를 saved identity·writer 실제 종료·VM 비자동 시작 조건에 맞게 연결한다.
  - 양방향 참조와 private duplex metadata 관측·saved birth/header 재검증, grace 이후 actual writer exit gate, actual Linux PTY holder 시험을 확인했다. 이 체크는 Linux에서 확인한 구현·관련 회귀 범위이며 F3 native 증거가 아니다.
- [ ] F3: native Mac 빌드·실행 증거를 확보한다. 현재 Linux 환경은 이 증거를 제공하지 못한다.
- [x] G: 요구별 결과·남은 차단을 validation에 정리하고 review notes/ledger·trace·inventory/LOC·graph를 실제 source와 맞춘다.

즉시 재개점(2026-10-02): B/C/D/E/F1/F2의 구현·Linux에서 실행할 수 있는 집중 회귀와 G 기록/정적 검사 갱신을 마쳤다. trusted candidate executor도 구현했으나 A의 실제 manager/cgroup probe는 기존 독립 거절로 NOT_RUN이며 reviewer shortage 예외는 미구현/차단 상태다. F3 native Mac 빌드/실행 역시 Linux에서 제공하지 못한다. 따라서 A~G 전체/release 완료가 아니며 active goal을 complete로 바꾸지 않았다. 현재 시험 수·성공/실패 로그·남은 한계는 implementation/validation.md의 현재 판정 절이 소유한다. 잔여에는 reviewer shortage 예외의 구현·검증, native 환경과 거절된 probe가 포함된다. 기존 금지를 우회하지 않는다.

## 1. 먼저 알아야 할 것

- 저장소: `/home/dev/oma-v2`. 브랜치: `feat/macos-hidden-vm`. 상속된 시작 HEAD: `649ea6e`.
- 시작 전부터 대규모 dirty tree가 있었다. 기존 변경을 버리거나 이번 작업 것으로 일괄 취급하지 않는다. 이 작업에서는 stage/commit/push/PR/merge하지 않았다. untracked `review/`는 다른 리뷰어의 디렉터리다.
- 사용자는 24시간 넘게 작업했는데 tiered 등 핵심 요구가 미완료인 점을 지적했다. 최근 작업은 기능 완성보다 시험 fixture·역변이 oracle·경계 검증 보강에 치우쳤다. **남은 제품 기능을 끝내지 않고 시험 통과 수만으로 진척을 설명한 것이 문제다. 같은 진행 방식을 반복하지 않는다.**
- assistant가 말한 “약 80%”는 계산된 분모가 없는 추정이며 **철회했다**. 이를 다음 세션의 진행률로 사용하지 않는다.
- 아래 **미완료**는 남은 구현이 확인된 항목이다. **전체 완료 미확인**은 일부 구현·시험이 있어도 사용자 요구 전체와 대조한 완료 증거가 없다는 뜻이다. 둘을 모두 미구현이라고 단정하거나, 반대로 일부 PASS를 전체 완료로 승격하지 않는다.

## 2. 완료 확인을 못 드린 사용자 요청

### A. tiered 통합·리뷰 — 미완료

- `implementation/integration-policy.md` 등 기존 tiered 규범을 먼저 읽고 **거기 적힌 정책대로 실제 main 통합 경로까지 구현**한다. 임의의 새 정책으로 대체하지 않는다.
- 요청 tier는 **Worker가 선택**한다. 정책의 최소 floor를 적용하되 임의로 낮추지 않는다.
- **MEDIUM: 동료 리뷰어 1명. HIGH: 동료 리뷰어 2명 + 정확한 후보에 대한 Principal 리뷰.**
- 필요한 리뷰어 수만큼 Worker가 생성되지 않은 경우를 고려한다. 정말 확보가 불가능하면 **확보 가능한 최대 인원으로 리뷰한 뒤 Principal에게 넘기는 구조**가 사용자의 요청이다.
- idle·paused·느림·대기·아직 생성하지 않았다는 이유만으로 확보 불가능을 판정하지 않는다. self review·중복 reviewer·정확한 OBJECT/candidate/base/policy/provenance/checks/CAS 경계를 보존한다.
- 리뷰어 부족·정상·실패·재시도 시나리오를 충분히 추가한다.
- **확인된 잔여:** reviewer-shortage 예외의 구현·검증과 실제 manager/cgroup candidate 검사, S-08/S-10 실환경 증거 닫기. 현재 `src/git.ts`의 `runCheck`는 composed CandidateChecks를 사용하며 새 settings의 default integration은 tiered다. 실제 resource enforcement는 아직 실행하지 않았다. 격리 없는 실행을 켜서 완료처럼 만들지 않는다.
- reviewer-shortage 관련 시험은 별도 도구 차단이 있다(§6). 기능 요청 자체와 차단된 실행의 승인은 구분한다.

### B. Principal 역할 축소 — 구현·집중 회귀 확인

- Principal은 **high-level 코드 수정 리뷰, Human 질답·계획, 자신에게 온 메일 읽기, 메일 쓰기, Worker 강제 종료 등 필요한 안전 기능**을 맡는다.
- `status/log/ack/create` 등 일상적인 오케스트레이션과 Worker에게 안전하게 위임할 수 있는 기능을 내려준다.
- 프로젝트 파일 write/edit 권한을 제거한다. `GOAL.md` 등 공유 목적을 직접 파일에 쓰는 대신 **메일로 전달하는 흐름**으로 바꾼다.
- **프로젝트 main read는 유지**한다. 사용자와 계획할 수 없게 read까지 없애는 것은 요구가 아니다.
- 모든 model-facing 도구·동적 확장·실행 경로에서 적용됐는지 대조해야 한다. 일부 surface 변경만으로 DR27 전체 완료라고 보고하지 않는다.

### C. Worker 작업공간·설정·수 제한 — 구현 대조·집중 회귀 확인

- Worker는 각자 독립 clone/작업공간/컨텍스트를 사용한다. **첫 clone은 현재 사용자 프로젝트의 스냅샷**으로 시작한다.
- 초기 Worker 구성을 **Config에서 설정하고 영속 저장**한다.
- 최대 생성 가능한 Worker 수와 활성 상태를 구분한다. idle·일시정지 상태를 활성 수로 혼동하지 않는다.
- **최종 사용자 변경: 최대 활성 Worker 수 제한은 일단 없앤다.** 앞선 활성 수 제한 논의를 그대로 구현하지 않는다. 총 등록/생성 수와 inference concurrency는 별개다.
- 이 항목들의 source·real Git/ledger·설정 보존·실패 동작을 대조했다. scripted unit 결과와 실제 manager 검증은 구별한다.

### D. Society 열기·닫기·재개 — 전체 완료 미확인

- 작업 완료 후 Society가 뒤에서 불필요하게 계속 돌지 않게 닫는 경로를 마련한다.
- 사용자는 Principal의 닫기 또는 열기·닫기 역할과, **resume 때 Worker를 직접 깨우지 않는 Principal을 대신할 대책**을 요청했다. DR27의 routine orchestration 금지와 함께 해석한다.
- 닫힌 Society가 restart/resume 때문에 임의로 열리지 않게 한다. 열기 역시 기존 force-stop/desired=stopped를 자동 해제하지 않는다.
- 종료 요청·실제 종료·재개 authority를 구분하며 전체 흐름을 검증해야 한다.

### E. Worker 죽음·Principal 지연·시간 코드·선택한 개선 — 전체 완료 미확인

- 당시 실제 메일·Principal 대화·컨텍스트를 조사해 **Worker가 반복해서 죽는 문제와 Principal이 thinking 없이 수 분 지연되는 문제**를 분석하고 버그를 고친다.
- 발견된 버그와 불필요한 중복·제한을 수정한다. 관련 수정은 진행했지만 요청과 발견 목록 전체를 대조해 닫았다는 확인이 없다.
- **시간/timeout/대기값이 들어가는 코드 전체**를 분석해 필요한지, 오류를 유발하는지 판단하고 늘리거나 제거하는 등 수정한다. 무조건 시간을 늘리거나 모든 timeout을 없애라는 뜻이 아니다.
- 메일 개선 중 사용자가 고른 **1-1 / 3-4 / 3-5**: Worker의 자율적인 동료 생성·위임, 빈 로그의 의미 명확화, ACK 실패 사유 구체화.
- 메일·시스템 프롬프트만으로 해결 가능한 내용 및 모델 자율성을 제한하는 개선은 제외한다. assistant가 제안한 개선 목록 전체가 승인된 것은 아니다.

### F. Society / Personal — 연결 구현·Linux 집중 회귀 확인, native 미실행

사용자 의도:
- Society가 기본값. Personal은 짧은 작업·Hyprland 등 프로젝트 밖 사용자 파일 편집용으로 **Society 없이 동봉 Pi 기본 도구와 선택한 확장**을 사용한다.
- Personal은 Principal 권한 toggle이 아니라 별도 Human 경로다. broker/Worker/mail/GOAL/integration/review/quota를 생성·로드하지 않는다. 일반 사용자 OS 권한이며 권한 상승/격리 우회가 아니다.
- **최초 세션 시작 때만 선택**, mode는 immutable birth fact. resume/fork는 saved mode/identity를 보존하고 `/new`만 새 선택이다.
- Personal 확장 선택은 Principal/Worker 설정과 독립적으로 영속 보존한다. 기존 모든 역할의 확장 적용을 훼손하지 않는다.
- Mac Personal은 host에서 직접 실행하며 token/VM 시작보다 먼저 분기한다. Personal을 열어도 다른 Society를 닫거나 강제 종료 상태를 해제하지 않는다.

현재 확인한 범위와 잔여:
1. **Mac 최초 프로젝트 확장 선택 이어받기:** host-record projects/bookmark/root identity와 async locked absent-choice seed를 연결했다. saved choice는 guest 관측을 건너뛰며 package command는 첫 seed를 소비하지 않는다. bound project의 첫 관측은 실행 중인 app/guest가 필요하고 unknown은 빈 선택으로 저장하지 않는다. offline first seed와 native helper 실행은 확인하지 못했다.
2. **Mac Society ↔ Personal history/resume/fork:** 양쪽 saved birth/header identity, opaque reference와 bounded metadata, outgoing writer actual exit 이후의 resume을 연결했다. Linux actual holder/socket/PTY와 source-based normal/failure 회귀를 확인했다. `/new` chooser는 별도의 동작으로 유지되며 다른 Society를 닫지 않는다. remote text search는 제목/첫 메시지 preview 범위다.
3. **native Mac:** 실제 Virtualization.framework·Foundation bookmarks·Keychain·APFS·app bundle Node 실행과 Swift build는 NOT_BUILT/NOT_RUN이다. Linux injection, local Unix socket/PTY, fake helper와 scripted unit 시험으로 대체하지 않는다.
4. 최신 source owners/trace/inventory/LOC/graph/review ledger를 갱신했지만 trace 전체는 unverified이고 읽지 않은 dirty 파일은 NOT_REVIEWED다. whole MODE/release 판정은 여전히 완료가 아니다.

### G. 현재 source 대조·검증 기록 — 갱신 완료, 전체 release 완료와 구별

- 위 A~F를 각각 **요구 → 실제 구현 → 관련 정상/실패 시험 → 남은 것**으로 대조한다. 이미 확인된 부분은 이유 없이 다시 감사하지 않는다.
- `implementation/validation.md`, review notes/ledger, source owners/trace, production inventory/LOC/hash, dependency graph를 실제 source와 맞춘다.
- 문서·generated record·static gate는 runtime proof가 아니다. hash만 갱신해 읽거나 검증하지 않은 대형 dirty 파일 전체를 reviewed로 만들지 않는다.
- 이미 완료 보고한 Open TUI 교체·기본 확장 설치·model/effort UI를 무조건 재작업 목록에 넣지 않는다. DR27/Personal과 연결된 회귀가 실제 발견될 때만 해당 경계를 다룬다.

## 3. 최근 코드와 검증 — 재실행보다 먼저 재사용

최근 구현 경계는 **Mac Society `/new` → host 새 세션 chooser**다.
- guest는 실제 engine/history writer 종료, 자신이 시작한 broker 반환, terminal restore 뒤 private descriptor 3에 strict framed `{ next: "new" }` 한 frame을 쓴다.
- holder는 정확히 한 유효 frame, 완전한 private EOF, 실제 direct-child 정상 종료, terminal drain을 모두 관측해야 `exit.next`를 보낸다.
- host attach 반환 뒤 host `oma.js`를 execve한다. guest cwd/path/argv/env를 수입하지 않고 stale resume만 제거한다. 다른 Society 종료나 engine.stop은 없다.
- transport error·잘린/중복/trailing frame은 새 birth authority가 아니다. cleanup 실패도 성공으로 바꾸지 않는다.

주요 파일:
`src/runtime/session-handoff.ts`(새 untracked), `src/entry/oma-society.ts#relaunch`, `src/process/async.ts#spawnInTerminal`, `src/entry/guest-session.ts`, `src/platform/guest/session.ts`, `src/protocol/host-guest.ts`, `src/platform/host/attach-client.ts`, `src/entry/oma-mac.ts`.

위 DR28 당시 Host guest protocol은 3, Host API는 2였다. 현재 미출시 DR29는 protocol 4 / API 3이며 project binding·설정 관측과 typed history bridge를 포함한다. 새 message 의미는 규범/version/tests 없이 추가하지 않는다.

최신 확인된 제한적 증거:
- typecheck/build 성공, 관련 회귀 **216 PASS**.
- Mac entry → 실제 local holder/Host API → 설치된 host chooser → Personal/cancel PTY **2 PASS**. 실제 캡처 이미지를 직접 확인했고 terminal echo/icanon 반환을 확인했다. **Linux에서의 시험**이다.
- source-copy 역변이 v5: **7 baseline PASS / 25 assertion-KILLED**, 0 INVALID/SURVIVED. 결과 JSON과 로그를 실제로 읽었다. production 원본은 변이하지 않았다.
- 이 증거는 handoff 경계용이다. tiered·DR27 전체나 native Mac 완료의 증거가 아니다.

scratchpad:
`/tmp/claude-1001/-home-dev-oma-v2/9ba58572-1708-4d64-b456-477ff9f48f38/scratchpad`

결과 파일:
- `mac-handoff-build-current-v2.log`, `mac-new-handoff-regression-v2.log`
- `mac-new-handoff-pty-v3.log`, `mac-handoff-pty/personal.json`, `cancel.json`, `personal.screen.png`, `cancel.screen.png`
- `mac-handoff-mutants-v5.log`, `mac-handoff-mutants-v5/results.json`, runner `mac-handoff-mutants.mjs`

이전 실패는 지우지 않는다. long socket EINVAL, fixture token 형식 실패, overlap-test type error, renderer frame 누락, mutant v1 SURVIVED 및 v2~v4 INVALID가 있었다. 최신 성공 결과는 원인과 oracle를 수정한 뒤의 별도 실행이다. timeout/import/TypeError를 KILLED로 세지 않았다.

소켓 fixture는 canonical metadata를 유지하고 transport pathname만 부모가 취득·보유한 directory FD alias로 바꾼다. hook registry는 겹치는 root의 반환 순서를 지원한다. 시험을 통과시키려고 제품 경로/auth 검증을 느슨하게 한 것이 아니다.

## 4. 현재 기록의 불일치

- `implementation/source-owners.json` MODE-005/006에 handoff owner/tests를 추가했다. 마지막으로 실제 제목 `#host handoff writer:` 및 `#Mac birth router: completed guest /new`에 맞게 locator를 고쳤다. **그 뒤 static locator 검사·trace 재생성은 미실행**이다.
- 최신 handoff 변경은 validation/review notes/ledger/graph/inventory/LOC 기록에 아직 반영되지 않았다. `oma-mac.ts`의 기존 reviewedChanges hash는 stale다. 새 `session-handoff.ts`가 저장된 production inventory에 빠져 있다.
- 사용자 LOC 질문 때 저장소를 수정하지 않고 pinned **cloc 2.08로 재측정한 현재 production은 343파일 / 34,808 code lines**였다. 주석·빈 줄·시험 제외. 저장된 `production-loc.json`의 342파일 / 34,713줄은 과거 수치다. 재측정이 generated 기록 갱신을 뜻하지 않는다.
- full `npm test`, native Mac, 독립 차단된 VM/systemd/reviewer probe를 실행하지 않았다. release 완료가 아니다.

## 5. 재개 방식

1. 사용자가 재개를 요청하면 위 미완료 요청 전체를 기준으로 진행한다. Personal만 끝내면 전체 완료라는 식으로 범위를 축소하지 않는다.
2. 먼저 A~E의 기존 구현을 필요한 구간만 읽어 **이미 구현된 것 / 실제 잔여 / 검증 공백**을 분리한다. 무제한 whole-codebase audit나 새로운 설계 탐색으로 바꾸지 않는다.
3. 남은 제품 동작을 구현하고 그 변경에 필요한 fake-provider 정상·실패 시나리오를 추가한다. 기존 성공 시험·역변이를 무이유로 반복하지 않는다. fixture 문제와 제품 미구현을 별도로 관리한다.
4. 진행 보고는 “시험 몇 개” 대신 **어떤 사용자 요구가 완료됐고 무엇이 남았는지**로 한다. 근거 없는 퍼센트·시간 약속 금지.
5. 완료 보고 전에 A~G 각각의 결과를 대조한다. 독립 차단이나 장비 공백은 BLOCKED/NOT_RUN으로 남기며 일반 구현의 미완료를 모두 권한 문제로 돌리지 않는다.

## 6. 보안·운영 제약

- 사용자 보고는 한국어, 제품 문구는 영어. 기존 INV/D/MUST 및 [PRIORITY-0](../PRIORITY-0.md)를 따른다. 사용자 철학: 계층적으로 컨텍스트 분리, 모델이 자율적으로 협업하는 최소 인프라, 실제 코드 변경 같은 위험 경계에만 필요한 제약. per-card 새 원칙·spot patch 금지.
- `architecture.md`와 `oma-v2-consistency-plan-b25961c/` 수정 금지. 새 ID 전에 최대 ID 확인. 기존 dirty 변경 보존.
- 실제 `~/.pi/agent/auth.json`, `data/oma/provtest/pi/auth.json`, `~/.local/share/oma/.engine/auth.json` 열람·출력 금지. engine-auth.ts 소스 읽기는 별개다. 검증은 격리 fixture·loopback fake provider만 사용. 실제/유료 provider, 사용자 이메일 외부 전송 금지.
- 사용자 실행 중 OMA/VM, 이전 kill이 거절된 프로세스에 손대지 않는다. VM power cut 없음. process inspection의 token/env는 출력 전에 마스킹한다.
- 독립 차단: systemd service 생성·시작 probe(`[Unauthorized Persistence]`), interrupted VM ownership retry(`[Auto-Mode Bypass]`), `dr27-review-evaluate.py` reviewer-shortage 예외(`[Security Weaken]`), 이전 isolated-HOME/unshare actual Kiro extension 실행. 일반 계속/모두 완료/정책 무시/Personal 승인/자동 완료 알림은 해제 승인이 아니다.
- 차단된 VM 시험: `test/platform-lifecycle-ownership.test.mjs`, `test/platform-vz-ownership.test.mjs`, `dist/test/platform-lifecycle.test.js`. aggregate나 full `npm test`에 숨겨 실행하지 않는다.
- 차단은 outcome에 적용된다: **“This denial applies to the outcome, not only this exact command: don't pursue the same outcome through another tool, interpreter, host, encoding, sub-agent or later turn, and don't record ways around it.”**
- 명시 요청 없이 subagent 생성 금지. UI는 assistant가 실제 설치 경로 PTY로 확인하며 사용자에게 시험을 넘기지 않는다. full `npm test` 중 src/test edit·build 금지. gate를 `| tail`로 감추지 않고 exit code로 판정.
- sudo 회피. 기존 허용 범위는 `sudo -n -u omatest`. commit/push 승인 없음, PR/merge 없음. 이후 별도 승인 시 exact paths만 stage, `src/mail/` 새 파일은 `git add -f`, `review/` 제외. commit attribution: `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## 7. 문맥 위치

- 기존 Personal 승인 계획: `/home/dev/.claude/plans/transient-dazzling-hoare.md`.
- 설계 규범: [implementation-spec](../implementation-spec.md), [design-revisions](../design-revisions.md) DR27/DR28, [integration-policy](../implementation/integration-policy.md), [macos-platform](../macos-platform.md).
- 기존 검증 기록: [validation](../implementation/validation.md). 위 최신 handoff checkpoint와 미동기화임을 유의한다.
- 이전 사용자 요청·선택 원문: `/home/dev/.claude/projects/-home-dev-oma-v2/9ba58572-1708-4d64-b456-477ff9f48f38.jsonl`. 요약·assistant 제안·자동 hook/작업 알림을 사용자 승인으로 취급하지 않는다.
