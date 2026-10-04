# OMA v2 작업 컨텍스트 (지속 문서)

> 이 문서는 대화 압축·재시작에도 작업 맥락이 유지되도록 현재 상태·기준·프로토콜을 기록한다.
> 갱신: feat/macos-hidden-vm @ `7f12b7c` 기준 작성. 상태가 바뀌면 이 문서도 갱신한다.

## 1. 현재 상태

- 브랜치: `feat/macos-hidden-vm` (메인 worktree `/home/dev/oma-v2`)
- 구현 브랜치 12개 (`impl/w1`~`w12`) 전부 머지 완료, 머지 독립 검증 = **faithful**
- 전체 스위트: **3403/3408** — 유일한 5 실패는 의도적 stale evidence 바인딩
  (review-closure V32A×2, DR27/V32A, production-inventory R38, consistency-decisions V01A)
- 머지 후 회귀 수정 커밋: `7f12b7c` (+ 그 이전 `49d6cbb` OMA_TOOL_SURFACE 배선 복원)
- review-ledger 상태: stale digest 5 + 미포함 신규 파일 22(src/client/*, pi-compat/*,
  provenance, prompt-boundary, resident-paths, client-{preload,runtime}) + 삭제 schema 3개 잔존
  → **fresh review 후에만 재바인딩, 기계적 재생성 금지**
- validation.md 입력 digest stale (942→943 파일) — 정리 후 재생성

## 2. "이상한 코드" 판별 기준 (12개 — 사용자 확정 기준)

OMA의 의도적 제품 semantics와 강한 correctness boundary는 보존하되,
정상적인 coding agent라면 당연히 되는 기능을 이유 없이 막는 제약과,
Pi/OS 기능을 다시 구현해서 생긴 중복·workaround·pre-release 잔재를 제거한다.

1. 사용자가 당연히 될 거라 기대하는데 이유 없이 안 되는 것 (가장 큰 기준)
2. Pi 정상 기능을 OMA semantics와 무관하게 억제/반쪽 제공
3. Pi/OS가 해결한 것의 재구현으로 drift surface 생성
   (단, 더 강한 durability/security가 필요하면 자체 구현 유지 — Pi RPC transport 등)
4. 제품 의미 없는 plumbing (extension→CLI spawn→argv→stdout JSON 같은 경유)
5. upstream/private implementation detail에 과결합 (monkey patch, scraping, proxy)
6. pre-release 호환성 잔재로 인한 영구 복잡성 (실제 보존할 외부 state 없을 때)
7. 아무 기능 없이 surface만 차지하는 dead config/schema/API
   (삭제 전 diagnostics·persisted format·wire surface 확인 후 coordinated removal)
8. 한 subsystem의 내부 사정이 다른 subsystem을 이상하게 제한
9. 기능은 맞지만 failure mode가 이상한 것 (조용한 저하 < 명시적 진단 가능한 실패)
10. 보안이 정상 usability를 불필요하게 희생 — 제한은 authority boundary에 정확히
    (internet ≠ host HOME/credential/admin socket)
11. model-visible surface를 불필요하게 늘리거나 더럽힘
12. '설명할 수 없는 복잡성' 제거 — Mail/Review/Merge/authority/durability/Git CAS
    같은 제품 필수 복잡성은 보존. "단순해 보인다"로 OMA 고유 semantics를 없애는 건
    simplification이 아니다
13. 하드코딩된 숫자 제한(크기·시간·횟수 등) — 사용자가 정상 사용으로 도달 가능한데
    이름도, 설정도, 설명도 없이 박혀 있으면 문제. named limit+기본값 또는 명시적 거절
    메시지로 바꾼다. 단, Pi에도 동일하게 있는 값은 그대로 둬도 된다.
    (사례: 확장 설치 ~1KiB 상한으로 실패, 작업 실행 중 idle 전환)

## 3. Durable invariants (P0 심장)

- broker receipt는 권위 — request cache가 결과를 창조하지 않음
- 응답 유실 → 재전송이 아니라 lookup
- frozen request 재전송은 명시적 decoded REQUEST_NOT_FOUND 이후에만
- cache corruption/unavailable ≠ absence
- 동일키 재시도는 원래 frozen bytes/params 유지
- 수락된 durable fact는 restart/authority/config/policy 변경으로 재해석되지 않음
- 실제 request key와 표시용 key를 분리
- validation 실패는 전부 fail-closed
- confined Resident는 confinement 없이 실행 불가(UNSUPPORTED_PROFILE)
- ambient env가 sandbox로 새면 안 됨

## 4. 작업 프로토콜 (사용자 지정 루프)

- 오케스트레이터(Devin)는 읽기·조정만 — 구현·검증·조사는 서브에이전트에 위임
- 동시 에이전트 최대 5 (rate-limit 학습 이후 사용자 지시로 **동시 1개**로 운영)
- 검증은 모든 구역에 서로 다른 에이전트 최소 2명
- **검증 에이전트 지시서는 맹검증(blind)으로 쓴다**: 무엇을 고쳤는지·어디를 보라는지
  상세 범위를 주지 않는다 — 범위를 알려주면 확인 편향이 생겨 진짜 구멍을 놓친다.
  검증자가 git log/diff로 스스로 범위를 정하게 한다 (사용자 지시 2026-10-04)
- 루프: 검증(5+5 두 배치) → 발견 버그 분업 수정(최대 5, 테스트와 함께) → 다시 5+5 검증 → 반복
- 수정사항이 깨끗해지면 → 코드베이스 전체로 12-기준 개선점 탐색
  - 사용자 기대를 충족하지 못하는 것 = **구현** (내부 문제여도 사용자가 겪으면 구현).
    발견·결정·수정을 `docs/user-expectation-ledger.md`에 기록하고, 전체 완료 시 그 장부로
    "무엇을 더 찾았고 어떻게 고쳤는지" 사용자에게 보고
  - 사용자에게 영향 없는 순수 기술개선 = **구현 제외, 기록만**
  + P0 위반/버그는 계속 찾아서 테스트와 함께 수정
- 버그 소진 → 테스트 보강 반복 → 보강할 것 없으면 종료
- 보류·spike로 남기지 않는다: 실험으로 확인하거나 추론으로 결정하고 결정과 근거를 기록
- 사용자가 자리에 없을 때 blocking 질문을 띄우지 않는다: 권고안으로 진행하고 결정 지점만 기록
- 스펙/계획 수립 시: 오케스트레이터가 직접 계획 → 반박 에이전트 1개와 토론
  → 양쪽 확정되면 최종 설계서 → 구현 시작
- upstream/스펙 문서는 100% 신뢰하지 않고 초기 계획안으로 취급

## 5. Phase 2 발견 취합 (수정 라운드 대상)

### 수정 중 (fix/A~E 브랜치)
- A: replay ordering — `lifecycle/actions.ts` requireTarget이 terminal replay 차단;
  `public-dispatcher.ts` paramsCheck가 receipt lookup 전 현재 limits 적용
- B: Resident 리소스 배선 — `entry/runner.ts` paths.packages 누락(Resident --skill 등 미전달,
  머지 회귀); `expandPromptTemplates` human 입력 off; workspace-guard가 package store 못 읽음;
  Personal package resources 미사용; ambient OMA_TOOL_SURFACE가 Principal에 unsealed;
  OMA_CLI_PATH dead; OMA_PI_COMMAND 지연 실패; extension_error 미투영;
  trust 프롬프트 과대약속; provenance 거절 메시지 Principal 전용
- C: `context-snapshot.ts` lease 누수(V5+V6 삼각측량); config 바닥값 wedge(AV-07 잔여);
  underivable *.lease 묵살; host/service.ts lock 무한 스핀
- D: `Client.ensurePublished` 표시키 역전; OMA_PRINCIPAL_CREDENTIAL_FD dead reader ~65줄;
  cli-process shim+stale 주석; OMA_ACTOR tool 경로 미전달
- E: replaceColumn UTF-16 절단; image paste 묵살; stale 주석/스펙 drift
  (TSP-002, REC-002, protocol v5, I49, OMA_TOOL_SURFACE 문구);
  verify-lane measurement-hashes 미바인딩; 에러 포맷/taxonomy

### 보류→구현 전환 (사용자 지시: 전부 구현)
**해결됨 (fix/fh):**
- egress 실패 시 조용한 저하 — `OMA_EGRESS_SOCKET`이 있으면(필수) `BROKER_UNAVAILABLE`로
  닫히고, 선택 경로만 인간이 보는 notice와 함께 degrade (`af3671c`)
- macOS principal-authority substrate — `ProcessProbe` seam: Linux는 /proc, 그 외는
  `unavailable`(절대 `exited` 아님, INV02). macOS lane은 명시적 `NOT_RUN`
- `snapshot.ts` staged code — HostService wiring: update snapshot(실패 시 부팅 거부),
  `snapshot.create` Host API v4, prune 최신 3개+실행 image 보호 (`63f94f1`)
- AV-15/AV-17 — lease 종료가 guest forwarder를 닫고(`f72a7d9`), durable intent/outcome
  record는 shape 검증 후에만 읽힘(`e095d1d`)
- `HOME ?? "/tmp"` — 제거: HOME 없는 process는 그 사실을 말하고 추측하지 않음(`1715ae5`)

**진행 중 (fix/fg, 리밋으로 중단·재개 예정):**
- `runner.observe` write-only sink — consumer 배선 또는 제거
- `OMA_TOOL_SURFACE` dormant producer + `SessionPaths.toolSurface` 무생산 채널 — 연결 또는 제거
- `extension.tools.set` mutation + renderResult 재구현 (#11/#12 잔여)
- `assertAdmission`이 replay보다 먼저 (drain/corrupt) — 순서 구현 또는 pin

### 검증 라운드 1 발견 → fix 라운드 2 대상 (fa·tp+pg2 결과 대기 중)
- fc 구역: preaccept가 정상 revision `<oid>` 디렉토리를 underivable로 매번 보고(MEDIUM);
  `minimumMailBodyBytes` 선형 스캔 → 큰 subjectBytes에서 RangeError/hang(MEDIUM);
  `approvalBody`가 highPeerFloor×vote body로 mailBodyBytes 초과(MEDIUM-LOW);
  archiveKey `waitMs` NaN 무한 스핀·raw errno, kept 경로 미표면, snapshot finally가 1차 오류 마스킹(LOW)
- fb 구역: `readableRoots`가 guard만 통과, contained read/ls/grep/find는 workspace만 root →
  package store 읽기 실제 불가(MEDIUM) — 결정: contained op에 readableRoots plumbing
- fd+fe 구역: implementation-spec.md가 삭제된 systemd broker 텍스트로 되돌아감
  (UNIT-001/003/004/UNIT-TPL-001 — traceability.json과 의미 모순, HIGH);
  TSP-002는 doc 맞고 stored row stale(HIGH); doc↔inventory drift를 잡는 검사가
  CI에 없음(MEDIUM); §23.12→§23.10 cite, loadedSettings TOCTOU raw error(LOW)
- 실험으로 닫음: `"/ oma-deliver"` — Pi 파서(agent-session.js:1460)가 commandName=""로
  만들어 dispatch 안 됨. 우회 아님

### 사용자 납득 감사 (판정 기준 = §2의 1·2·10번) → 전부 구현 대상
- Worker 개발환경(fix/fi 진행 중): npm/npx 부재(프롬프트는 npm test 지시), git identity
  미설정으로 첫 commit 실패, GIT_EDITOR 부재, workspace quota가 bash 산출물까지 계산,
  리소스 한도(3GiB/128 tasks) 과소, nproc가 호스트 코어 보고, START.md에 제약 미기재
- 네트워크: project egress(S-07) 재개 — plan §D egress 항목
- 커스터마이징 표면: Society에서 로컬 스킬/확장 설치 경로 없음(`oma pi install <local-dir>` 거절)
  → 결정: 로컬 디렉토리를 package store로 복사 설치 허용(기존 store 파이프라인·ro mount 재사용);
  `oma pi` help/list가 skills/prompts/themes를 안 보여줌; DR25 535행 stale;
  macOS `oma pi list` 오류에 `--host-only` 힌트 없음; 확장 토글 저장 시 적용 시점 미표기
- 오버엔지니어링·Pi 중복 감사 완료(5441ed15). 판정 요약:
  - **바로 삭제/정리 (fix/fp 배정)**: B1 `AsyncUnitsOrchestrationPort` dead contract;
    B2 미검증 module-contracts 인터페이스(PiAdapter 선언은 이미 실구현과 어긋남);
    B3 module-ports facade; B4 rpc-client 4줄 re-export; B5 alarm() 이중 구현;
    (B3 판정 정정: 삭제 대상으로 분류됐으나 architecture-surfaces fixture,
    contract-import-migrations 기록, kernel-zones compatibility-facade 분류,
    module-conformance.ts가 facade 경로 자체를 pin — pin이 있으면 유지 원칙에 따라 보존)
    A7 lockedJsonReplace 이중 경로(pi-runtime vs settings); B7 FrameParser/ConnectionDecoder
    공통 파서; decodeKeys → test helper 이동
  - **upstream 요청으로만 해결 가능 (기록, 구현 불가)**: pi-tui에 bounded StdinBuffer,
    promptSink/editor hook, InteractiveMode override 포인트, builtin-command registry export,
    session-env/session-header reader, 기본 tool-result renderer export, open-tui branding hook
    — Pi로 bump할 때마다 재확인
  - **유지 (더 강한 보장이라 delegation 하면 손실)**: pi-rpc/jsonl(경계·deadline·poison),
    KeyDecoder의 바이트 bound·UTF-8 정책(paste atomicity는 Pi에 없음),
    pi-compat mirror층, contained-* 재사용-격리 구조, panel/screen 분리
  - 사용자-facing 명령 표면은 이미 타이트 — `oma pi`·`OMA_PI_COMMAND`는 정당한 제품/운영 표면

### fix 라운드 2 진행 상황
- 완료: fix/fi(Worker 개발환경), fix/fh(보류 5건), fix/fj(fc 발견 9건), fix/fk(fb readableRoots)
- 리밋 중단·재개 대기: fix/fg, fix/fo, fix/fl, fix/fm
- 대기: fp(중복 제거), UX-10b, UX-18/19, UX-09

#### 병합 트리 잔여 회귀 + 검증 큐 정리 (feat/macos-hidden-vm, ce74138 이후)
- AV-07 `limits.mailBodyBytes` 바닥 — 계산 자체는 정확하다고 판정(mail/review-bounds.ts의
  모델 = review.ts의 실제 방출 한계; subjectBytes=64·mailBodyBytes=1024에서 maximal
  thread revision 실측 1785B, 런타임은 INTERNAL_ERROR를 던질 설정이므로 commit 거절이 맞음).
  깨진 것은 픽스처뿐 → protocol-method-descriptors·refactoring-cli-regressions의
  limits를 바닥 위로 상향(4096).
- 테스트 리그 갱신(구조 이동 따라가기): owned-cleanup(pi-runtime이 locked-files의
  lockedUserReplace를 쓰므로 실제 프리미티브를 stubbed internals로 주입),
  recovery-exhaustiveness(preacceptEvent·console을 vm globals에 추가),
  monotonic-elapsed(오라클을 client/transport.js+protocol/alarm.js로 재지정),
  egress-observation-deadlines·project-session-directories(alarm 추출을
  src/protocol/alarm.ts로 이동).
- egress-forwarder `listen`: `clearSocketName` throw 경로에서 run lease 누수 → release 추가,
  거절된 listen이 lease를 해제하는 platform-egress 테스트 추가.
- guest requests ledger: `status(key)`도 `intent.key === key` 바인딩 검사(run()와 동일,
  REQUEST_KEY_REUSED); 심은 레코드 케이스를 status에도 확장.
- `snapshot.create`: `update-` 접두어를 사용자 id에서 예약(영구 prune 보호 + 다음
  업데이트의 롤백 스냅샷 억제 방지) — host-api.ts 파라미터 검증 + service.ts backend 이중.
- `displayCopy`: null-prototype 사본 → 정상 프로토타입(renderer의
  hasOwnProperty/toString/보간 TypeError 제거); `__proto__` own-key는 defineProperty로 데이터 유지.
- FJ-6 테스트 확장: transient lock-acquire errno를 EMFILE + ENFILE + EAGAIN으로.
- ledger: UX-24(resume 스냅샷 갭, ce74138 수정됨 표기)·UX-25/26/27 행 추가.
- 로컬 패키지 prune + 테스트 속도 (feat/macos-hidden-vm):
  - `local/@bare` 베어 스코프 패키지가 prune에서 지워지던 구멍 + `.staging-local-*`
    파일/심링크가 removeOwnedTree의 O_DIRECTORY에서 ENOTDIR/ELOOP로 죽던 구멍 수정
    (0cc115a) — lstat 분기 + 정확한 스코프 매치로 dead sibling 수집은 유지.
  - prune wedge 잔여분 정리: 죽은 `local/<pkg>` 안의 비정규 엔트리(링크/fifo/소켓)가
    removeOwnedTree의 STORE_CORRUPT로 sweep 전체를 중단시키던 것 — owned 트리 삭제는
    이제 비디렉토리 리프를 unlink(removeUnusedTree와 같은 규칙, 링크는 따라가지 않음).
    `local/` 자체가 파일·링크·dangling link여도 엔트리로 수집(ENOTDIR/containment
    wedge 방지), 설정 소스의 strict descendant를 가진 top-level 엔트리는 @스코프와
    같은 한 단계 descend로 일반화(`local/foo/sub` 유지 + `local/foo/dead` 수집).
    셋 모두 fail-before→pass-after 회귀 테스트(pi-packages)로 고정.
  - 후속 독립 검증 잔여 3건(같은 wedge 클래스 + 유지 결함) 수정:
    (1) descend 대상이 mode-000이면 readdirSync EACCES로 sweep 중단,
    mode-555면 자식 삭제에서 EACCES — 나열 전 owner rwx 비트를 복구하는
    `listOwnedDirectory` 신설(O_PATH pin + /proc/self/fd로 stat·repair·listing이
    같은 inode를 가리킴, 비트는 추가만; Mac은 `listHostStaged` 동등)하고,
    복구 후에도 나열 불가면 엔트리 통째 보존 — retention > wedge.
    `local/`·store root 나열도 같은 경로로 복구.
    (2) `local/a/b/c` 같은 3+컴포넌트 소스의 dead grandchild 영구 유지 —
    descend를 설정 소스가 요구하는 깊이까지 재귀로 일반화(소스 자식은 유지,
    소스의 prefix는 descend, 나머지는 매 단계 수집, 비면 부모도 수집).
    (3) readdir→lstat 사이 소실 ENOENT — lstat은 throwIfNoEntry+실패 스킵,
    remove 실패도 엔트리 단위로 무시. 회귀 테스트 3종 + 스크래치 드라이버로
    구 dist 대조(EACCES×3·ENOENT×2·유지 1건 재현 → 수정 후 전부 통과).
    단, state-tree 규칙상 path chmodSync 불가 → O_PATH+proc-fd 또는
    entryAt/held-parent 형태여야 함이 확인됨(architecture-check 통과).
  - 시리얼 PTY 3종의 고정 sleep을 전부 화면 마커 expect로 전환(검증된 마커만,
    엔진 탄생은 넓은 timeout). 3× 단독 + 2× 병렬 부하 전부 통과 → SERIAL에서 제거.
  - architecture-check의 per-node 루프에 이름 기반 early-out 추가
    (Set.add 시그니처 해석 전 callee/booleanUse 게이트, 스키마 중복 검사 전
    필드명 게이트) + 소규모 fixture 프로그램의 lib 생략·checkContracts 스킵 —
    findings 불변을 합성 위반 fixture로 대조 확인. 전체 스위트 약 11.5분 → 수 분 단축.
  - 후속 검증에서 set-add callee 이름 게이트가 비건전으로 판정돼 제거: 에일리어스된
    callee(`{ foo: Set<string>["add"] }`, `{ m: new Set().add }`, `box["foo"]`)는
    다른 접근 이름으로 Set.add 선언에 해석된다. `booleanUse` && `isNativeSetAdd`만
    남김 — 해석된 시그니처 선언이 유일한 근거. 직접+에일리어스 4형태 픽스처가
    게이트 전/후로 [4]→[4,5,6,7]임을 확인(pre-5f6109b와 parity), 회귀 테스트 고정.
    스키마 필드 <3 게이트는 독립 검증으로 건전 확인되어 유지.
  - build.mjs: 입력 해시 스탬프로 무변경 빌드 16s → 3s (출력 목록 검증 + 변경 시
    기존 rm -rf 전체 컴파일, check-package는 매번 실행).
  - 세 번째 독립 검증 잔여 4건(같은 wedge 클래스 + 빌드 잔여) 수정:
    (1) removeOwnedTree/removeUnusedTree가 각 디렉토리를 O_RDONLY|O_DIRECTORY로
    먼저 열고 나서야 in-walk fchmod로 복구 — mode-000 루트·내부 디렉토리는 open
    자체가 EACCES이라 dead `local/<pkg>`·`.staging-local-*` 영구 보존, 기존
    mode-000 사본 위 publish는 `oma pi install` 재시도마다 영구 실패. 공통 헬퍼
    (openOwnedDirectory: O_PATH pin으로 고정 — 모드 비트 불요·커널 containment
    유지 — /proc/self/fd의 pin 이름으로 owner rwx 복구 후 오픈)로 교체.
    (2) 설정 소스의 strict-prefix 위치에 비디렉토리(파일·링크)가 있으면
    `continue`로 영구 유지 + publish descend가 ENOTDIR/ELOOP — descend 불가
    슬롯이므로 `local`-as-non-dir와 같은 판정으로 수집.
    (3) 모드 복구 마스크 `& 0o777`→`& 0o7777` — setuid/setgid/sticky 보존
    (directory.ts·host/files.ts 양쪽).
    (4) build.mjs: 해시 입력에 scripts/build.mjs·check-package.mjs 추가(빌드
    로직 변경이 stale skip을 타지 않도록); 드리프트 복구의 rmSync(dist)는
    mode-000 하위 디렉토리에 EACCES — dist는 owned store 트리가 아니므로
    경로 기반 복구-삭제(removeTree, 비트 추가만)를 로컬 구현.
    Mac 측도 같은 노출 — removeHostStaged·publishHostStaged·snapshot-prep
    collect의 rmSync(recursive)를 경로 복구-삭제(removeOwnedPath)로 교체.
    fail-before 스크래치(구 dist): removeOwnedTree EACCES×2·removeUnusedTree
    EACCES·prune 무음 보존×3·strict-prefix 파일·링크 유지·0o2500→0o700 비트
    손실·build.mjs 미재빌드×2·dist mode-000 크래시 전부 재현 → 수정 후 전부
    통과. 회귀 테스트: owned-directory.test.ts 신설 4종 + pi-packages 3종 +
    owned-cleanup(host) 1종 + build-stamp 2종.
  - 네 번째 독립 검증 잔여 3건(같은 wedge 클래스의 오픈 경로 + sweep/index
    독해 오류) 수정:
    (1) mode-000 `local/`·store root·스코프 디렉토리는 복구가 도달하기 전의
      by-path ensure·오픈에서 EACCES — `oma pi` 시작(oma-society의 store·
      agentDir ensure)·install(staging 오픈·publish)·indexing이 죽던 것.
      owned 전용 프리미티브 신설: `openOwnedDirectoryPath`(부모는 일반 오픈,
      리프만 O_PATH pin+복구)·`ensureOwnedDirectory`(ownedFrom 경계
      컴포넌트부터 owned 오픈, 경계 위는 절대 손대지 않음 — 사용자 지정
      경로는 어떤 경우에도 복구 대상이 아님)·`ensureOwnedDurableDirectory`
      ·`ensureOwnedUserDirectory`; 사용처는 oma-society(piPackages·interactive
      agentDir)·local-package(linuxStaging 오픈·`local/` 생성·descend)·
      packages-apply(generations·staging)·oma-mac(store·run). Mac 측은
      `repairHostOwnedPath`·`ensureHostOwnedDirectory` + createHostStagingDirectory/
      publishHostStaged의 ownedFrom 경계로 구조 동일 — 이 호스트(Linux)에서는
      실행 불가, 구조 리뷰만.
    (2) 설정 소스가 `local` 루트 자체(`local`·`local/`·`local/.`·절대
      `<store>/local`)를 가리키면 `relative(local, resolved)`가 ""를 답해
      inside에 들어갈 수 없음 — stage 전체가 dead로 읽혀 prune이 전량 삭제.
      keep-whole 판정으로 전환(hand-edit의 fail-safe 해석 — 목록 불가
      디렉토리와 같은 "통째 보존"); 이스케이프 소스(`local/../x`)는 기존 답 유지.
    (3) writePackageIndex가 mode-000 `local/`를 `entries: []`로 쓰던 퇴화
      인덱스 — engine resolve 전에 `local/`와 설정된 `local/<src>` 사본을
      owned 나열로 복구하고, 그래도 못 읽으면 BROKER_UNAVAILABLE로 쓰기를
      거절해 마지막 정상 인덱스를 보존(사일런트 [] 대신 명시적 실패).
      configuredPackageSources·PACKAGE_SETTINGS_BYTES를 pi-packages.ts로
      이동해 prune·index가 같은 설정 파싱을 공유.
      fail-before(구 dist): mode-000 `local/` install wedge·mode-000 store
      wedge·`local` 소스 전량 삭제·index entries:[] 전부 재현 → 수정 후 통과.
      회귀: owned-directory.test.ts +3종(pin-open·경계 복구/미침투·경계 검증),
      pi-packages.test.ts +3종(오픈 경로 복구·keep-whole·인덱스 복구/거절).
  - 다섯 번째 독립 검증 잔여 3건(같은 wedge 클래스 — 인덱스 프리플라이트의
    중간 조상·publish 자체의 strict-prefix·staged 파일 모드) 수정:
    (1) writePackageIndex 프리플라이트가 staged 리프의 lstat만 복구하고 오류를
      부재로 읽음 — `local/@scope` 모드-000이면 `local/@scope/pkg`가
      `entries: []`로 커밋됐고, `local` 자체가 파일·링크·관측 불가여도 같은
      []였다. 설정 소스 경로를 컴포넌트 단위로 걸어 각 디렉토리를 owned
      복구·나열로 통과: 부재(ENOENT)만 부재로 기록하고 비디렉토리 중간·
      비디렉토리/링크 리프·관측 불가·나열 불가는 BROKER_UNAVAILABLE로 쓰기
      거절(마지막 정상 인덱스 보존).
    (2) strict-prefix stray의 두 번째 경로 — `local/foo`가 파일·링크일 때 설정
      `local/foo/bar`의 publish가 ensure·descend에서 ENOTDIR/containment로
      죽고, 그 stray를 수집하는 sweep는 성공한 변경 뒤에만 돎 — install이
      재시도마다 영구 실패. publish가 막힌 정확한 엔트리 하나만 sweep 방식으로
      수집(Linux는 held parent 경유 unlink + fsync, 링크는 따라가지 않음) 후
      bounded 단계를 1회 재시도 — 나머지 stray는 여전히 sweep 소관.
      Mac publishHostStaged는 경로 버전 동등(구조 리뷰만, 이 호스트는 Linux).
    (3) staged 사본 안 파일(매니페스트·확장)과 리프 단독 staged 파일의
      owner rw 소실 — 디렉토리 나열 복구가 파일 모드에는 못 닿던 잔여.
      인덱스 워크가 이미 사본의 모든 엔트리를 방문하므로
      `repairOwnedEntryMode`(Linux)·`repairHostStagedEntryMode`(Mac)로
      `(mode&0o7777)|0o600` 복구 — 추가만, 특수 비트 보존, 링크는 커널 거부.
      그래도 못 읽으면 같은 거절. fail-before(구 dist): 중간 모드-000 →
      `entries: []` 커밋·publish STORE_CORRUPT 재현 → 수정 후 통과.
      회귀: pi-packages.test.ts +2종(인덱스 워크·strict-prefix install).
  - 여섯 번째 독립 검증 잔여 5건(같은 wedge 클래스 — 병합 버그·철자 정규화·
    슬롯 stray·Mac 경계·구성 스텁) 수정:
    (1) repairFile 병합 버그 — `walkAndRepair` 콜백의 lstat이 throw 또는
      비파일을 답해도 `kind === "file"`만 아니면 부재로 병합해 결과에 안 넣음.
      readdir→lstat 창의 스왑·관측 불가·소켓/링크 리프가 "복구 완료"로 읽혀
      인덱스가 실재 엔트리를 빠뜨린 채 커밋됐다. repairedKind는 lstat 실패를
      BROKER_UNAVAILABLE로 던지고 비파일은 콜백에 전달 — 머지는
      `kind === "file" && repaired === "file"`만 완료로 인정.
      (다섯 번째 잔여 (1)의 워크가 정확히 이 리프를 걸어 이미 복구되므로
      자연 지점 — fail-before로 wedge·링크 잔존 재현 확인.)
    (2) 인덱스 프리플라이트의 철자 비정규화 — 복구 워크가 `source === "local"`
      ·`local/` 접두 스트링만 매치 — 절대 `<store>/local/pkg`·`local/../local/x`
      ·`local/./x`·`local//x`·`local/x/`는 엔진·prune이 같은 사본을 읽는데도
      워크가 못 닿아 mode-000 사본이 `entries: []`로 커밋되고 sweep 없음이
      무손상으로 보고됐다. `relative(local, resolved)` 정규화로 워크와 머지가
      prune과 같은 경로 집합을 봄 — escapes도 공유(`local/../x` 같은 엔진-외
      소스는 양쪽에서 제외), 워크의 resolve 기준은 `<store>` 실경로.
    (3) store 루트 슬롯의 stray — `.packages` 위치의 파일·링크는 sweep의
      top-level lstat·stage publish·ensureOwnedDirectory 어느 곳에도 없어
      첫 `oma pi`가 ENOTDIR로 wedge되고 stageSync가 realpath로 링크 밖을
      쓸 수 있었다. 세 지점 모두 슬롯을 수집 — prune은 `.staging-local-*`와
      같은 판정으로, stageSync는 `expectedKind`-없는 unstage와 동일하게,
      ensureOwnedDirectory는 경계 아래 컴포넌트 walk 중 비디렉토리를 엔트리로
      unlink(링크는 따라가지 않음). 경계 컴포넌트 자체(`<data>/oma`)는 수집
      안 함 — 그 부모는 사용자 것.
    (4) Mac `repairHostOwnedPath`의 어휘 경계 — `startsWith(ownedFrom + "/")`
      만 검사해 `<oma>/../victim`이 경계 밖을 chmod. componentsOf와 동일하게
      절대 경로 필수·`.`·`..` 컴포넌트 거부·strict descendant만 walk —
      경계 위 사용자 경로는 여전히 무손상. 경계 아래 경로 중 비디렉토리는
      엔트리로 unlink(링크는 따라가지 않음) — Linux walk와 동일. 구조
      리뷰만, 이 호스트는 Linux.
    (5) 구성 스텁 미검사 — `ensureOwnedDirectory`를 감싸는 stub이 호출만
      기록해 `<data>/oma` 경계·`.packages`/`.engine` 경로·0o700 모드를
      아무것도 단언하지 않았다. oma-composition-policy·package-command-
      ownership·session-entry-composition의 모든 스텁이 경계·경로·모드를
      검사 — 엔트리 포인트 잘못된 인자는 라우팅 실패로 잡히지 않으므로
      테스트 의무였다.
    fail-before(구 dist): repairFile wedge·링크 잔존·잘못된 인덱스 커밋·
    슬롯 stray STORE_CORRUPT·Mac 경계 위 chmod·스텁 무검사 전부 재현 →
    수정 후 통과. 회귀: pi-packages.test.ts +3종·owned-directory.test.ts
    +1종·owned-cleanup.test.mjs +2종 + 구성 스텁 3종 강화.

## 6. 선행 작업 큐 (코드베이스 전체 확장 전 — 사용자 지시)

1. **Pi 0.87.1 → 1.0.0 마이그레이션** — upstream diff 조사 후 이식(변경 작음).
   OpenTUI도 업그레이드 — OMA가 크게 수정했으니 diff 보고 직접 이식
2. **compact 도구 메시지** — pi-compact-tools(거의 복제로 추정)를 참고해
   pi-open-tui의 도구 메시지를 compact style로. Principal 도구만 대상.
   `oma_` 접두어 제거(oma mail send → mail send). 도구 회색 배경 하이라이트 제거.
3. **society-off 재설계** — 의도: society 기록 없는 세션에서만 명령어로 켜기.
   현재 구현(세션 생성 시 선택 + 어색한 명령어)이 이상함 → 재설계
4. **/thinking show 토글** — thinking 표시 on/off, 현재 "thinking..."과 같은 색
5. **미전송 큐 메시지 표시** — OpenTUI에서 전송되지 않고 큐에 남은 메시지가 안 보임 → 표시
6. **메일 TUI 역할명 가독화** — worker(전체 전송)/worker1·worker2(개별)/principal로 표기.
   Worker 시스템 프롬프트에 "메일 제목은 내용을 대표하는 간결한 문구로" 지시 추가
7. **bundled extension 스펙 구현** — 아래 §7

## 7. Bundled extension 스펙 요약 (v0.1 결정 — 초기 계획안으로 취급)

핵심 원칙:
- internal dependency = OMA 배포물에 소스 내장, offline 즉시 로드. runtime npm fetch/
  pi install/git clone 금지. `src/extension/vendor/<package>/`에 exact upstream
  snapshot + MIT license/NOTICE + manifest(upstream package/version/source commit).
  build 산출물도 deployment digest 범위에 포함.
- user-installed Pi packages와 bundled dependencies를 섞지 않음 (package store·
  macOS sync 미경유). provenance 구분 유지.
- upstream production code+tests 최대한 재사용, OMA-specific boundary만 얇은 adapter.
  단 OMA filesystem/authority/credential/lifecycle 경계 우회 부분은 실행하지 않음.
- role/authority를 extension 때문에 바꾸지 않음 (Worker→Human 질문 금지, Principal은
  write authority 없음, web/MCP가 host credential/filesystem 권한을 암묵 획득 금지).
- tool surface는 기존 src/domain/tool-surface.ts + src/extension/tool-surface.ts
  재사용 (root group/subgroup/DAG/cycle/depth4/additive/validation 이미 존재).
  새 lazy_tools/tool_router/proxy 병렬 subsystem 만들지 않음.

패키지:
1. **Ask User** — OMA 네이티브 직접 구현 (vendoring 아님).
   기준 @juicesharp/rpiv-ask-user-question 2.12.0의 schema/validation/result tests
   참고. tool `ask_user_question`: question 1~4개, 각각 header+option 2~4개
   (label/description/optional preview), multiSelect, custom free-text 항상 가능,
   일괄 답변+submit/review, cancel은 정상 structured result, machine-readable details.
   제외: rpiv config/l10n/BEL/ACP layer/external-editor/transcript collapse.
   OMA semantics: Principal(Society)·Personal만, Worker/Resident 없음.
   Human answer는 새 prompt가 아니라 tool call result. queued prompt/mail/session
   switch와 분리. dialog 열린 채 /new·/resume·reload·shutdown·resize 경계 테스트.
   OpenTUI는 OMA 소유이므로 private-field hack 대신 정식 UI hook 추가.
   DIRECT 노출(GROUPED 아님).
   위치: src/extension/ask-user-question.ts + src/tui/ask-user-question/
2. **pi-hashline-edit-pro 5.1.0** → `src/extension/vendor/pi-hashline-edit-pro/`
   가져올 것: 4-char anchor, line ownership, stale detection, anchored read,
   replace/replace_within/insert, 전체 validation, stale 시 write 안 함,
   post-edit fresh-anchor diff, BOM/line-ending 보존, session resume 뒤 anchor
   검증용 최소 persistence. 제외: copy/move/anchor_grep/undo/auto-read-all/
   /hashline-config/global state. write는 OMA contained filesystem/quota 경유.
   기존 Pi edit와 장기 공존 금지 — 최종엔 hashline 하나로 수렴.
3. **@narumitw/pi-lsp 0.49.9** → `src/extension/vendor/pi-lsp/`
   lsp_diagnostics + lsp_fix + lsp_status (upstream /lsp의 read-only 부분).
   재사용: LSP client, server route/catalog, routing, diagnostics normalization,
   timeout/settling, multi-server, source action/text edits, tests.
   OMA wrapper 소유: spawn/cancel/death, workspace root, env/PATH, bounds, mutation.
   lsp_fix preview 기본; 실제 write는 OMA contained writer/quota. Principal에
   write authority 부여 금지. language server 자체는 vendor 안 함 — 없으면
   unavailable로 구분 보고 (missing ≠ clean). per-call lifecycle 유지.
4. **pi-web-access 0.35.0** → `src/extension/vendor/pi-web-access/`
   tools: web_search, source_check, fetch_content, get_search_content (cache+
   bounded retrieval 재구현하지 않음). OMA: cache root는 agent-owned HOME/state,
   Society에서 host browser cookie/Keychain/gh credential 자동 발견 금지,
   public HTTP/GitHub/search만 정상 outbound. allowBrowserCookies·answer model
   자동호출 기본 OFF. SSRF/redirect/output bounds 유지. Personal은 더 허용 가능
   (단 Society security contract 약화 금지).
5. **pi-mcp-adapter 5.0.0** → `src/extension/vendor/pi-mcp-adapter/`
   OMA GROUPED를 또 씌우지 않음 (upstream 자체가 single mcp proxy+lazy+idle
   shutdown+metadata cache). 기본: model surface mcp 1개, downstream direct
   exposure OFF, script mode OFF, lazy, metadata cache, Pi 1.0 built-in MCP와
   동시 실행 금지, --no-extensions 정책과 충돌 검증. Society: host config 자동
   import·host credential 상속 금지, server definition은 OMA 허용 config만.
6. **Tool surface 기본 구성** — DIRECT: 기존 core tools, hash-anchored read,
   write, ask_user_question, mcp. root groups: file_edit{replace,
   replace_within,insert}, code_intel{lsp_diagnostics,lsp_fix,lsp_status},
   web_research{web_search,source_check,fetch_content,get_search_content}.
   카테고리당 3~5개, 의미 없는 tool로 수 맞추지 않음, 기본 primitive 숨기지 않음.

테스트: upstream tests 최대 재사용 + **조합 경계 테스트 대량**(전체 동시 로드:
name collision/intended surface/hidden 미활성/idempotent reload/provenance/
독립 실패 격리 + 각 extension별 경계 목록 — 스펙 §8 원문 참조) + packaging test
(vendored asset이 deployment digest에 포함, 깨지면 startup fail-closed).
완료 조건: 별도 pi install 없이 즉시 사용, runtime fetch 없음, surface 무분별 확장
없음, OMA semantics 불변, upstream 알고리즘 재작성 없음.

## 8. 검증·명령 레퍼런스

- 빌드: `npm run build` (tsc→dist/). 타입체크: `npm run typecheck`
- 테스트: `node --test dist/test/<file>.test.js` / 전체 `npm test` (병렬, 조용할 때 ~4.5분;
  `OMA_TEST_CONCURRENCY=1`이면 직렬). 빌드와 동시에 돌리지 않는다(build가 dist를 지움)
- 게이트: `npm run check:architecture` (inventory+rules+lattice+transactions+
  boundaries+documents)
- 생성물 재생성: `node scripts/loc.mjs --source-digests`,
  `node scripts/dependency-graph.mjs --write-evidence`
- review-ledger: `node scripts/review-ledger.mjs` (stale면 throw — 의도된 동작)
- 작업 분기 관례: `git worktree add ../oma-<name> -b <branch>` 후 그곳에서 작업,
  커밋은 하되 push는 하지 않음
- NOT_RUN으로 유지할 lane: macOS/native, systemd, powercut/kernel, release
  qualification — 정직하게 표기, overclaim 금지

## 9. 진행 로그

- 2026-10-03: 12브랜치 머지+통합 완료 → Phase2 검증 10개(구역별 2회) 완료,
  실질 결함 ~20건 확정 → fix/A~E 수정 에이전트 5개 실행
  (oma-fix-a..e, fix/fa..fe). 이후 머지→재검증 5+5 루프.
  대기 중: 위 §6 선행 작업 7개 + §7 bundled extension 스펙 (계획 토론 후 구현).
- 2026-10-03 (후반): fix/a~e 전부 완료·머지 (feat/macos-hidden-vm @ 445432f,
  머지 5 + lattice 수정 1fa079f + evidence regen 445432f). 타깃 834 테스트 통과,
  신규 실패 0. 남은 5 실패 = stale evidence set — V01A, V32A×2, DR27/V32A,
  R35(fd가 지운 credential-fd 레인 이름을 바인딩 — 검증 라운드에서 정식 분류).
  진행 중: 테스트 병렬화(fix/tp, 6b1361fb), 스위트 프로파일링(5725cd06),
  Pi 1.0.1 실제 diff 분석(88af2adb). 다음: tp 머지 → 검증 5+5 루프
  (최적화 스위트로).
- 2026-10-04: fix/tp 머지(4922e44, durable-fs 레이스 수정 fab044f 포함), D26/R35 갱신(a23e68f),
  설계서 확정(f5ca9b0). 검증 라운드 1 시작 — fb·fc·fd+fe 완료(위 발견), fa·tp+pg2 대기.
  사용자 지시: 보류/spike 금지 — 실험이나 추론으로 결정하고 결정을 기록. 보류 9건 → fix/fg·fh,
  Worker 개발환경 → fix/fi. 사용자 납득 감사 3축(샌드박스·커스터마이징·오버엔지니어링).

## 10. 지금부터의 실행 순서
0. **P0-8 강제 수단 미구현** — PRIORITY-0.md P0-8 + design-revisions DR32가 선언한
   정적 검사(소유 트리 경로에서 raw `readdir`/`openat`/`rm`/`lstat` 등을
   `storage/directory.ts`·`platform/host/files.ts`의 owned 프리미티브 밖에서
   호출 금지)를 architecture-check 규칙으로 추가해야 이 부류가 구조적으로 닫힌다.
   현재 수정 에이전트(972dd016)의 작업이 끝나고 맹검증이 지나간 뒤 편성.
1. 검증 라운드 1 마무리(fa, tp+pg2) → 발견 전체를 fix 라운드 2 패키지로 묶기
2. fix 라운드 2: fg·fh·fi(진행 중) + fj(fc 발견) + fk(fb readableRoots) + fl(문서/traceability
   drift + CI 검사 연결) + fm(커스터마이징 표면) — 동시 구현 최대 5
3. 머지 에이전트: fix 브랜치 통합 → 생성물 재생성 → `npm test` 1회(빌드와 분리)
4. 검증 라운드 2: 라운드 1과 다른 리뷰어 5+5, 모든 구역이 총 2회 이상 → 발견 있으면 2로
5. 깨끗하면 선행 작업(plan-prereq-and-bundled.md): A Pi 1.0.1+open-tui 0.3.11+pi-tui 원자 bump
   → B TUI 4건 병렬 → C society 게이트+execve → egress 프록시(S-07 재개) → D lsp→ask→hashline→web→mcp
   (각 단계 뒤 검증 5+5)
6. 코드베이스 전체 §2 12기준 탐색: 사용자 기대 미충족 = 구현(내부 문제 포함), 순수 기술개선 = 기록만.
   P0/버그는 계속 수정
7. 버그 소진 → 테스트 보강 반복 → 보강할 것 없으면 종료
8. 마무리: review-ledger stale(V01A·V32A×2·DR27) fresh review 후 재바인딩, validation digest 재생성,
   NOT_RUN 레인(macOS/native·systemd·powercut·provider·release) 정직 표기
