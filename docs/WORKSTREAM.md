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
- 네트워크: project egress(S-07) — 완료(DR34): `HostConfigV1.egress` allowlist → delivery당
  HTTP CONNECT proxy(`/run/oma/egress.sock` bind + loopback `HTTP(S)_PROXY`), SSRF screen,
  credential header 소멸, macOS는 `egress.connect`(protocol 6)로 host 다이얼. SSH/raw TCP·UDP·
  SOCKS5는 v0.1 밖
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
- 대기: fp(중복 제거), UX-10b, UX-18/19

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
  - 일곱 번째 잔여 — `.engine` 우회 + 전체 감사 스윕 + 정적 규칙 편성:
    (1) `entry/runner.ts`가 `.engine`을 plain `ensureDirectory`로 만들던 것 —
      mode-000 `.engine`이 headless/broker-spawn Resident를 EACCES로 죽이던
      정확히 그 wedge. `ensureOwnedDirectory(agentDir, dirname(stateRoot))`로
      전환(데이터 루트 리프까지 복구, 그 위 사용자 조상은 미침투).
    (2) `.engine/themes`의 더 깊은 tail — `preparePiInteractive`의
      `lockedUserReplace`가 plain `ensureUserDirectory`를 불러 mode-000
      `themes`(또는 `.engine` 자체)에서 wedge. `lockedOwnedReplace(dir,
      ownedFrom, …)` 프리미티브 신설 + `preparePiInteractive` 선두에
      `ensureOwnedUserDirectory(themes, agentDir)` — 잠긴 치환 전에 잎을 복구.
      `OmaSettingsStorage.withLock`도 같은 잠긴 경로.
    (3) 감사 스윕 — OMA-owned tail을 plain fs로 만지던 곳 전부 owned
      프리미티브로: entry/broker·broker의 run root·actor 소켓 디렉토리
      (경계 dirname(runRoot)), transport-spool의 stagingRoot, runner.ts의
      session/home/mail workers, mail.ts의 mail-objects 스테이징,
      batches의 cur 부모, lifecycle create·workspace의 에이전트 루트,
      views의 world, session-mode의 birth 루트, personal-session의
      history·personal-settings의 `.personal`·project-settings의
      `.projects`(경계 dataRoot), login의 `.engine`(경계 dirname(stateRoot))·
      임의 위치에 놓일 수 있는 packages store(경계 store 자체 — 그 위
      조상은 호출자의 것이라 절대 손대지 않음), generations의 `.oma-config`+`generations`(경계
      dirname(root)), request-cache의 `.local/state/oma/requests` — 경계는
      `.local/state/oma`이고 `.local`·`.local/state`는 사용자의 공유 XDG
      이름이라 절대 손대지 않음, storage의 context-stream·context-snapshot·
      submit-spool·delivery-receipt·immutable-file·context-repository·
      quarantine·provision, resident-rootfs(경계 rootfs), preaccept 나열의
      잎 복구, guest의 requests ledger·provision mount·archive 스크래치·
      guest-provision 파트, Mac 측 omahostd 지원 디렉토리 스윕(경계 home)·
      service의 transfer/archives/snapshots·keychain·project fileSink·
      snapshot prune(구조 리뷰만, 이 호스트는 Linux).
      `ensureOwnedDurableDirectory`는 이제 생성된 경로 목록을 돌려주어
      provision의 `created` 보고가 유지되고, `ensureOwnedUserDirectory`는
      durability observer를 받아 Linux의 fault seam을 관통시킨다.
    (4) 정적 규칙 — `owned-state` 아키텍처 규칙 신설(scripts/architecture/
      rules/owned-state-rules.mjs, rule-check에 등록): 경로를 받는 fs 변경과
      plain ensure·replace 헬퍼는 지정된 프리미티브 소유자(storage/directory·
      durable-fs·contained-fs·socket-name·runtime/user-files·locked-files·
      platform/host/files) 밖에서 금지되고, OMA 루트 이름을 인자로 쓰는 관측은
      면제 사유를 문서로 요구한다. 디스크립터 인자·`entryAt`·`new URL`·
      `/proc/self/fd/`는 경로가 아니다. 면제 맵의 각 항목은 그 경로가 왜
      OMA-owned tail이 아닌지(사용자 systemd 디렉토리·커널 /proc·/dev/pts·
      소켓 chmod·거절이 이미 정직한 나열·확장 샌드박스 PI-001)를 말하고,
      필요 없어진 면제는 `owned-state-exemption-stale`이 지운다 — 감사 표가
      조용히 낡지 않는다.
    (5) fail-before(구 dist 76f3293): mode-000 agentDir에서
      `preparePiRetry`가 `BROKER_UNAVAILABLE: cannot be observed now
      (EACCES)`로 죽는 것 재현 → 수정 후 복구·작성 통과. 회귀:
      pi-runtime.test.ts +2종(잎·tail 복구, 경계 위 거절)·architecture-rule-
      modules.test.mjs +4종(허용·거부·사용자 경로·stale 면제).
      통제된 require seam fixture(engine-login·personal-session·owned-
      cleanup·broker-composition)는 새 의존을 명시 목록에 추가하고,
      cli-receipt-replay의 WP26 주입은 이제 사용자 소유 XDG 조상의
      mode-000 — 경계 안의 손상은 복구되는 것이 계약이라 거기서는 더 이상
      실패를 만들 수 없다.
  - 여덟 번째 잔여 4건(같은 wedge 클래스 — 부재로 읽힌 관측 실패·flush되지
    않은 중간 디렉토리·경계 위 사용자 디렉토리 복구·규칙의 이름 매칭 공백)
    수정:
    (1) `writePackageIndex`의 `realpathSync(resource.path)` `catch {
      continue` — EACCES·EIO 따위의 미완료 관측이 부재로 읽혀 엔진이 나열한
      리소스를 뺀 `entries: []`가 커밋됐다(mode-000 `local/`와 같은 퇴화
      진실). ENOENT만 부재이고 나머지는 BROKER_UNAVAILABLE로 거절 — 직후의
      lstat도 같은 절(split 유지: realpath↔lstat 사이에 사라진 이름은
      부재). fail-before(구 dist): 강제 EACCES에 Missing expected rejection
      → 수정 후 거절 + 마지막 정상 인덱스 보존 확인.
    (2) Linux stage publish가 `local/a/b/c` 같은 3+컴포넌트 이름의 중간
      디렉토리를 mkdir로 만들고 fsync하지 않음 — `local`과 최종 부모는
      flush됐지만 `local/a`는 아니라서 rename 직후의 크래시가 `a` 안의
      `b` dirent을 잃을 수 있었다. rename·swap 후 descend가 지나간 모든
      디렉토리를 경로 fsync(fsyncDir — flushDirectoryChain과 같은
      방식; descend가 방금 owner 비트를 복구했으므로 경로 오픈은 거절될 수
      없다). fail-before: fsyncSync 계측에서 `local/deep` 미flush 확인 →
      수정 후 local·deep·inside 전부 flush.
    (3) `generations.ts`의 owned 경계 감사 — `dirname(root)`는 번들을 둔
      사용자 디렉토리여서(`--config`는 임의 경로를 허용) 경계 위 디렉토리의
      mode가 복구됐고 `.oma-config` 슬롯의 사용자 파일이 unlink로 수집될 수
      있었다. 경계는 oma가 만드는 첫 컴포넌트 `.oma-config` 자체(`base`) —
      경계의 부모는 사용자 것이라 거기의 stray는 거절이 답. fail-before:
      mode-0555 부모가 0o755로 바뀌고 슬롯 파일이 지워진 것 재현 → 수정 후
      부모 무손상·슬롯 보존 확인.
    (4) `owned-state` 규칙의 커버리지 — `node:fs/promises`(`open`·`readdir`·
      `lstat`·`rename`·`rm`…)가 세트에 없었고 callee는 철자가 아니라 바인딩
      기준으로만 해석한다고 문서화됐다(동명 로컬 함수·`db.open()`은 fs가
      아님). 관측 팔의 OWNED_ROOT_NAME도 `store`·`generations`·`real`·
      `local`·`destPath`·`staged`·`staging`·`mirror`·`journal`·`dataDir`
      따위의 실제 운반 이름으로 넓혔고, 나머지 한계(`path`·`dir`·`root` 같은
      제네릭 이름 아래로 흐르는 owned tail은 이름 규칙이 못 봄 — 변경 팔은
      파일 전체를 감사)을 헤더에 명문으로 적었다. 새로 걸린 파일들은 소유
      관계로 정리: pi-packages·local-package·generations·packages-apply·
      package-archive는 per-store 소유자로, guest의 staged/mirror·stream의
      statfs·pi-extension의 fail-closed realpath·mail.ts의 `unreadable`
      표면은 사유 있는 면제로.
    fail-before(구 dist·구 규칙): (1) 무거절 커밋·(2) 중간 미flush·
    (3) 사용자 부모 복구·슬롯 unlink·(4) `open` named import·`store`
    인자 미검출 전부 재현 → 수정 후 통과 + `check:architecture` 0 findings.
    회귀: pi-packages.test.ts +2종·config-generations.test.ts +2종·
    architecture-rule-modules.test.mjs +2종(바인딩 인지·에일리어스 이름).
  - 아홉 번째 잔여 4건(같은 라운드의 사각 — 경계가 너무 좁은 쪽·규칙의
    바인딩 잔여·Mac 스테이징 내용 flush·낡은 증거) 수정:
    (1) `commitManagedGeneration`의 경계는 이제 번들을 둔 층이 이름 짓는다.
      여덟 번째 잔여 (3)이 `.oma-config`를 경계로 고정한 것은 외부
      `--config` 번들에는 정확했지만 oma 소유 트리 안의 번들(`<data>/.
      projects/<project>`, 세션의 `<data>/<society>`)에는 너무 좁았다 —
      mode-000 `<project>` 같은 oma 소유 조상이 커밋의 읽기·쓰기 전부를
      wedge시켜도 복구할 경계가 없었다. `ownedFrom` 인자를 commitManaged-
      Generation·commitRoleSet·projectBundle·deriveSessionSettings·
      writeSettings·commitManagedEdit·commitField·toggleExtension까지
      꿰었고 oma가 번들을 둔 층(project-settings·oma-society)은 데이터
      루트를, 외부 번들은 아무것도 넘기지 않아 `.oma-config`가 경계로
      남는다 — 사용자 공간 복구·슬롯 stray unlink 금지는 그대로. 복구는
      확인 flush·assertCurrent보다 먼저 선다: 복구가 닿아야 할 바로 그
      컴포넌트 아래의 읽기가 먼저 wedge되면 복구는 영영 도달하지 못한다.
      fail-before(구 dist, 경계가 호출자 경계를 무시): mode-000 `<demo>`
      아래 번들의 두 번째 커밋이 BROKER_UNAVAILABLE → 수정 후 복구·커밋·
      읽기 일치. 회귀: config-generations.test.ts +1종(in-tree 복구·
      무경계 거절·외부 부모 무손상 재확인).
    (2) owned-state 규칙의 바인딩 잔여 3종 — 같은 호출이 아직 입을 수
      있던 철자들: `import { default as fs } from "node:fs"`는 remote가
      `"default"`라 네임스페이스로 결속되지 않았고, `const f =
      writeFileSync`/`const w = fs.writeFileSync` 같은 멤버·함수 별칭은
      네임스페이스 별칭만 추적하던 2패스를 빠져나갔으며, 콜백 철자
      (`fs.writeFile`·`rm`·`lstat`·`mkdir` — `*Sync`와 같은 효과를
      비동기로 답하는 면)은 해석은 되어도 집합에 없었다. `default as`는
      네임스페이스로, `import fs = require(...)`도 같이 결속하고, 별칭은
      고정점까지 멤버·임포트 둘 다 추적하며, 콜백 표면은 변경/관측 양팔에
      들어갔다 — 동명 로컬 함수·미결속 객체의 멤버·외부 모듈 별칭은 여전히
      fs가 아니다. fail-before(구 규칙): `default-as namespace import
      escaped the rule` → 수정 후 fixture 전부 검출 + `check:architecture`
      0 findings·stale 면제 감시 유지. 회귀: architecture-rule-modules.
      test.mjs +1종(10개 우회 철자 + 무검출 통제군).
    (3) Mac `publishHostStaged`가 rename 뒤 `dirname(dest)`만 fsync하던
      것 — 스테이징 사본의 바이트는 이름만 옮겨져 어느 쪽도 flush하지
      않았으므로 rename 직후 크래시가 인덱스가 가리킬 파일 내용을 잃을 수
      있었다(Linux publish의 fsyncTree가 닫은 같은 창). 이제 도착한 트리의
      정규 파일 전부와 그를 이름 짓는 디렉토리 전부, 대상 부모, 이름이
      있던 스테이징 루트를 같은 순서로 flush한다 — 비정규 잎은 held walk의
      pin이 거절하는 그 손상 그대로 거절. 이 호스트는 Linux라 구조만;
      네이티브 Mac 실행은 NOT_RUN(owned-cleanup의 publish 경로는 Linux에서
      그대로 통과).
    (4) 과정 노트 — 증거 결박: 97c0b62가 바꾼 생산 바이트(local-package·
      pi-packages·generations)를 새 바이트로 재독해 review-notes에 판정을
      기록했고(files·settings·extensions·project-settings·oma-society까지
      이번 변경 파일 전부 byte-bound), `npm run review:ledger`로 원장을
      재생성하고 `node scripts/loc.mjs --source-digests`로 생산 digest를
      다시 맞춘 뒤 validation.md의 검증 입력 digest를 현재 트리로
      재결박했다 — stale digest 2건(V32A)·검증 입력 digest 불일치 1건
      (R38) 해소.
  - 열 번째 잔여 2건(같은 wedge 클래스 — 규칙 자체의 비종료·복구된 가시성
    뒤의 시드 덮어쓰기) 수정:
    (1) owned-state 규칙의 별칭 고정점이 종료하지 않던 것. 바인딩 맵은
      스코프를 모르고 로컬 이름만 키로 삼는데 멤버 별칭 가지는 발견한
      remote와 다르면 매 패스 재기록했으므로, 한 이름을 서로 다른 remote로
      잇는 두 스코프(`const w = writeFileSync`와 `const w = readFileSync`)가
      항목을 번갈아 뒤집어 체크가 영영 답하지 못했다. 모든 가지를
      first-wins로 고정했다 — 일단 결속된 이름은 재결속하지 않는다.
      거부 규칙이 별칭을 어느 remote로 해석하든 둘 다 fs 면을 이름 지으므로
      호출은 어느 쪽으로든 표지된다(부족 검출보다 과다 검출이 안전한 방향).
      방어적으로 `2 * sites + 1` 패스 상한을 두고 넘으면 매달리는 대신
      던진다 — 성장 패스는 매번 바인딩을 하나 더하므로 선언이 허락하는
      만큼만 지날 수 있다. fail-before(구 규칙): 두 함수의 그림자 별칭
      fixture가 15초 timeout에도 미종료 → 수정 후 ~1ms에 종료·두 호출 모두
      owned-state-raw-access로 표지 + 실 트리 `check:architecture`
      0 findings. 회귀: architecture-rule-modules.test.mjs +1종(그림자
      별칭 결정성 — 동기 멤버·네임스페이스 멤버·async 면 3철자).
    (2) `ensureProjectSettings`의 존재 게이트가 복구 이전에 답을 썼던 것.
      mode-000 `.projects` 또는 `.projects/<project>`는 existsSync를
      거짓으로 답하게 했고, ensureOwnedUserDirectory가 조상을 복구해 이미
      커밋된 설정이 보이게 된 뒤에도 코드는 시드·쓰기 분기로 내려가
      커밋된 번들을 새 생성으로 교체했다(커밋된 `quota.societyAgents=4`가
      시드의 5로). 복구는 내용이 아니라 관측 가능성만 돌려놓는다 — 이제
      복구 뒤 경로를 다시 관측하고, 여전히 부재일 때만 시드 분기가 선다.
      시드 후보 프로브도 existsSync에서 lstatSync(throwIfNoEntry)로:
      후보의 조상은 이 ensure의 복구 소관이 아니므로(사회 루트는 자기
      소유자가, `--config`는 Human의 것) ENOENT만 부재로 읽고 관측 실패는
      기본값을 뿌리는 대신 거절한다. `applyPackageChange`의 프로젝트별
      스킵은 같은 사각이었다 — 현재 프로젝트가 아닌 `.projects/<name>`의
      mode-000이 설정 부재로 읽혀 패키지 제거가 커밋된 역할에 닿지 못했던
      것을, 동일하게 복구 먼저·복구 실패는 편집 실패처럼 보고·복구 뒤에도
      부재일 때만 스킵으로 고쳤다. `commitRoleSet` 측은 39ad677가 세운
      ownedFrom 경계로 이미 안전(커밋이 관리 디렉토리를 읽기·쓰기 전에
      복구). existsSync/accessSync/statSync 게이트 전수 감사: 생성·시드
      결정 중 진짜 결함은 위 3처뿐이었고 나머지는 복구가 프로브보다 먼저
      오거나(provision·context-snapshot·packages-apply·service·workspace),
      ENOENT만 부재로 읽고 관측 실패는 던지거나(settings.ts·
      pi-packages `present`·operations·personal-settings·packages-apply),
      관측 실패를 보존 방향으로 해석하거나(pi-packages·listHostStaged),
      fd 기반이라 조상 손상과 무관했다(fstatSync 계열). fail-before(구
      dist): 커밋된 quota가 4→5·관측 불가 시드 후보에 예외 없이 기본값
      생성·숨겨진 프로젝트가 제거 적용에서 스킵 — 전부 재현 후 통과.
      회귀: pi-packages.test.ts +3종.

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

- 2026-10-06 (LOC 재생성 고정 — vendored 비코드 파일의 cloc 분류):
  vendored 번들 유입 후 `node scripts/loc.mjs`가 `cloc omitted or
  misclassified src/extension/vendor/pi-hashline-edit-pro/LICENSE`로
  결정적 실패하던 문제 — cloc은 LICENSE·NOTICE·`.map`·dotfile·빈 파일·
  바이너리(전체 1,620개)를 세지 않는다. `measureWithCloc`이 `--ignored`의
  per-file 판정을 report의 `nonCode` 블록에 접어 기록하고, 공유 규칙
  `clocCoverage`가 인벤토리 전 파일을 "code row 또는 인정된 non-code
  verdict"로 계정 — LOC-001..007의 무침묵누락 불변식 유지: 미계정·
  인벤토리 밖 분류·row/분류 중복·미인정 verdict는 여전히 실패.
  `assertMeasurementCurrent`는 n_files/SUM.nFiles를 code-row 집합과
  대조하고 재측정 시 분류 자체도 비교한다. `.txt`는 cloc의 Text 언어로
  계속 카운트됨을 테스트가 결박. 루트의 gitignored
  `production-loc.json`/`production-measurement-hashes.json`은 stale
  잔재(이전 commit의 부분 산출물)로 확인 — `loc: CI_ARTIFACT_ONLY`
  posture 유지, 커밋하지 않는다.
- 2026-10-06 (BL5 맹검증 정산 후속 — underlay 오라클·win32 trailing-dot):
  BL5 잔여 2건. (1) `SDK_STDIO_ENV_UNDERLAY`가 vendored SDK의
  `DEFAULT_INHERITED_ENV_VARS`를 수동 미러해 vendor bump가 이름을
  추가하면 ambient-env leak이 조용히 재개될 수 있던 오라클 공백 —
  `mcp-bundle.test.ts`에 drift oracle 추가: 검증된 ESM+CJS 번들 바이트에서
  두 플랫폼 리스트를 정적 파싱해 live export와 결박하고, 모든 이름이
  tombstone·child-env sanction 중 하나의 disposition을 갖는지 단언
  (주입명 `OMA_DRIFT_PROBE` 대조군으로 oracle 자체의 실패 경로도 고정).
  (2) command basename admission이 shim 확장자를 1회만 제거해 win32의
  trailing dot/space 해석(`npx.`·`npx.cmd.`·`npx..` → npx(.cmd))을
  우회할 수 있던 문제 — `[.\s]+$` 제거와 shim strip을 fixpoint까지
  반복해 비교; ` npx `·`xnpm.cmd.`·`npm-helper.` 등 허가 집합 불변.
- 2026-10-09 (bundled #5 — pi-mcp-adapter 맹검증 정산): BL5 vendored
  어댑터에 대한 맹검증 잔여 발견 F1–F6 전부 구현·검증. F1 — vendored
  SDK의 `StdioClientTransport`가 env를
  `{...getDefaultEnvironment(), ...serverParams.env}` 순으로 합치므로
  OMA scrub이 빼낸 이름(SHELL·APPDATA·HOMEDRIVE·… )이 SDK 자체
  underlay에서 되살아날 수 있던 문제. `mcp-tools.ts`에 SDK underlay
  이름 목록을 두고 `childEnvFinish`가 scrub 결과 위에 `undefined`
  tombstone을 씌우게 해 Node spawn이 그 pair를 버리게 만든다(dependency
  바이트는 그대로, OMA 쪽에서 제거). 실제 vendored `stdio.mjs` transport로
  child를 띄워 `process.env`를 직렬화해 검증 — tombstone 없는 대조군은
  SHELL이 재유입됨을 확인. F2 — UI-session 리소스 경로가 host `who`
  probe·`orca` subprocess·`npm root -g`·host-global `glimpseui` 동적
  import에 도달할 수 있던 문제. `OmaMcpPolicy`에 `ui-session` permit을
  deny-by-default로 추가하고 `direct-tools.js`·`proxy-modes.js`에
  경로 진입 전 구조화된 `ui_session_refused` 거절을, `ui-session.js`·
  `glimpse-ui.js`에 방어심층 게이트를 splice — OMA 정책 미설치 시
  upstream 의미 그대로. F3 — config/state의 `existsSync` 기반 부재 판정이
  EACCES를 "없음"과 구분 못 해 접근 불가 파일을 빈 config로 취급·oauth
  key를 침묵 재발급할 수 있던 문제. `statSync`의 ENOENT만 부재로 보고
  나머지 에러는 전파, 비-정규 파일은 별도 `[E_OMA_MCP_CONFIG]` 경계
  에러, malformed JSON과는 구분. F4 — `npx`/`npm` 거절이 정확일치라
  `/usr/bin/npx`·`C:\Tools\npm.cmd` 등 path-qualified 우회가 가능했던
  문제. command basename을 `/`·`\` 양쪽 separator로 자르고
  `.cmd/.exe/.bat/.ps1` shim suffix와 대소문자를 정규화해 비교 —
  `npm-helper`·`npx-serve`·`srv.CMD`는 계속 허가. F5 — 죽은
  `omaStateDir()` 헬퍼와 잘못된 `{stateDir:"",durable:false}` 폴백 제거.
  F6 — `mcp-bundle.test.ts`의 upstream-tests 검증에서 두 번째
  disjunct가 직전에 이미 assert된 조건이라 `A || B`가 아무것도 묶지
  않던 tautological assert를 vitest config·test-runner 존재와
  suite 규모(>=150 test files)의 실체 검증으로 교체.
  `pi.events`는 facade로 그대로 전달되고
  `pi-mcp-adapter:runtime-register` 이벤트는 `normalizeOmaMcpConfig`
  비경유 runtime 등록을 허용하지만 in-process 전용이며 다른 OMA 확장
  표면이 없으므로 posture로 기록(런타임 거절은 등록된 서버에도 적용).
  manifest·runtime은 `vendor-pi-mcp-adapter --write` 산출물로 재생성·
  `--check` BUNDLE_CURRENT, review-notes BL5 오라클·ledger·
  source-digests 재바인딩. `mcp-bundle.test.ts`는 14→18종으로 확장
  (tombstone 실spawn·UI 거절 E2E·ENOENT-only·basename 거절).
  NOT_RUN: 이전 라운드와 동일(macOS native·systemd·kernel/powercut·
  provider credential·release qualification·upstream-tests 자체
  하네스·live MCP 세션).
- 2026-10-09 (bundled #5 — pi-mcp-adapter): §7 순서의 다섯 번째(마지막)
  확장. `pi-mcp-adapter@5.0.0`을 `src/extension/vendor/pi-mcp-adapter/`에
  byte-pinned vendor — `upstream/`은 npm 타르볼(shasum
  `6c20461d658ec7d7b7e303b067e2ff13a7846d00`, SRI
  `sha512-/3vWQLSXwud+VX1vV/dFfKpp6I40guCeqiaP/XMdXIyon+frIm+sPXGArLlmvY5PIwL2ChJ3AhELIusroGA8Ng==`)
  의 무수정 스냅샷(252 files), `upstream-tests/`는 source commit
  `5783e5eacfe820829b18be5d4de91e5f46e79dbb`의 테스트 트리(207
  entries — npm tarball에는 테스트가 없어 git에서 가져옴),
  `runtime/`은 upstream 루트 `.ts` 전 모듈의 tsc 산출물(상대 `.ts`
  지정자를 `.js`로 재작성 후 컴파일, 비-ts 페이로드는 verbatim 복사)에
  `vendor-pi-mcp-adapter.mjs`의 OMA_DIVERGENCES만 입힌 생성물,
  `node_modules/`는 DEPENDENCIES 핀 테이블 42개 패키지의 npm tarball
  바이트 그대로인 의존 클로저(2,086 files). `manifest.json`은
  `oma-vendored-bundle-v1` — 현재 2,727 파일. 어댑터
  (`src/extension/mcp-tools.ts`)는 verify→정책 설치→수명주기 훅→
  facade→upstream `createMcpAdapter` 순서를 지키고 정확히 `mcp` 1개
  도구만 등록한다 — upstream 자체가 single lazy proxy라 OMA GROUPED를
  얹지 않고 surface plan은 `mcp`를 DIRECT로 이름 붙인다(두 role 공통).
  facade는 `registerTool`을 pinned 이름으로만 통과시키고
  `registerCommand`/`registerFlag`/`registerShortcut`은 drop 기록,
  `pi.exec`(browser/path open의 유일 호출지)는
  `[E_OMA_SUBPROCESS]` 거절, `registerMcpServer`/`getMcpServers`는
  facade에 없으므로 `piSupportsMcp(pi)`가 vendored 코드 안에서 false —
  Pi built-in MCP는 공존 불가고 `mcp_servers_change` 미러 경로는 arm되지
  않는다. config는 OMA 소유 하나뿐: 엔진의 agent dir 아래
  `mcp-adapter.json`(upstream 자체 adapter-config 이름 — Pi built-in의
  `mcp.json`과 의도적으로 구분되므로 그 파일로 오인될 수 없다; 없으면
  빈 config, malformed이면 fail-closed) 또는 테스트의
  `config` 옵션을 `normalizeOmaMcpConfig`가 검증해 programmatic
  `McpConfig`로 만든다 — `configPath`는 upstream에 절대 넘기지 않아
  host/global/project discovery·plugin loader·argv flag 경로 전부 소등.
  `imports`·`claudePlugins`·허용 부분집합 밖 settings 키·surface를 바꾸는
  설정(directTools·namespaceProxyTools·scriptMode·autoAuth·
  allowInstall·hostConfigDiscovery·disableProxyTool·
  ancestorConfigRoots·agentPluginPaths·projectServers)은 클램프가
  아니라 거절. server 항목은 `npx`/`npm` command(connect 시 패키지
  fetch)·비-http(s) url·상대 socket·`caFile`·`requestHeadersCommand`·
  `pluginDataDir`·`literalEnv`·per-server `directTools`·`!`-command
  secret sink를 경계에서 거절하고 vendored splice가 런타임에도 같은
  sink를 막는다(defense in depth). 정책 seam(`runtime/utils.js`의
  `omaInstallMcpPolicy`): deny-by-default permits(browser-open·
  os-keyring 미부여), 빈 ambient-env 뷰(MCP_DIRECT_TOOLS·MCP_OAUTH_*·
  NPM_CONFIG_CACHE·BROWSER·Jev/SystemOne·PI_MCP_ADAPTER_* selector가
  vendored 코드에 닿지 않음), OMA 소유 agent dir·scratch root, stdio
  child env scrub, pinned credential store. egress는 OMA 프록시 결선이
  있을 때만 `http://127.0.0.1:<port>` pin을 vendored undici ProxyAgent로
  설치하고 loopback은 direct 유지; 결선이 없으면 pin도 dispatcher도
  없는 upstream direct-fetch 의미 그대로. credential은 durable 상태면
  OMA 생성 키의 encrypted-file store, ephemeral이면 memory store로 핀 —
  OS keyring·`@napi-rs/keyring`·keyctl 경로는 도달 불가. 수명주기는
  upstream의 session_start/session_shutdown 소유자를 facade로 그대로
  전달하고 OMA scratch는 session_start에 rotate·session_shutdown에
  삭제한다. 경계 적응(번들 밖, 전부 기록됨): ① 공유 child-env
  술어를 `src/extension/child-env.ts`로 추출해 LSP와 MCP가 같이 쓰게
  함(deny-by-default allowlist, OMA pin과 정확히 일치하는 proxy 값만
  통과, HOME/XDG/tmp는 미상속·per-session scratch redirect, 거절 값은
  빈 문자열이 아니라 부재). ② `state-tree-rules.mjs`·
  `owned-state-rules.mjs`의 raw fs-mutation 면제 표에 `mcp-tools.ts`
  추가 — lsp-tools와 같은 사유: Pi extension 경계라 extension closure가
  저장소 primitive import를 막고, state는 engine agent dir 아래거나
  휘발성 OS temp다. ③ BL1/BL3/BL4 surface 테스트의 등록 집합에 `mcp`
  추가(두 role 공통 DIRECT). ④ `tool-surface.ts`에
  `MCP_PROXY_TOOL_NAME` 도메인 상수 추가 — PI-001이 extension의 domain
  import를 막으므로 `mcp-tools.ts`의 `MCP_TOOL_NAMES`와 테스트가
  결박한다. ⑤ confined Resident argv의 `--no-extensions`는 `-e` 명시
  경로(core extension)와 양립하는 기존 방식 그대로 — vendored 등록은
  core extension 안에서 일어나므로 정책 충돌 없음을 pi-spawn-plan으로
  확인. 검증: build·typecheck·`vendor-pi-mcp-adapter --check`
  (BUNDLE_CURRENT, 2,727 files)·check:architecture·check-package·
  `mcp-bundle.test.ts` 14종 + 갱신된 lsp/hashline/web surface 테스트
  전부 PASS — vendor 스크립트는 upstream `npx-resolver.ts`의 implicit
  any와 cross-spawn 선언 부재에 대한 비치명 tsc 진단을 stderr에
  남기는데, 발방출 집합이 일치하면 성공하는 BL4의 기존 관례와 동일.
  NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
  release qualification 레인, upstream-tests 자체 하네스(vitest·
  네트워크 fixture — provenance용 vendored), 실제 MCP server와의 live
  세션(경계 시험까지만).
- 2026-10-08 (bundled #4 — pi-web-access): §7 순서의 네 번째 확장.
  `pi-web-access@0.35.0`를 `src/extension/vendor/pi-web-access/`에
  byte-pinned vendor — `upstream/`은 npm 타르볼(shasum
  `a807f0d5c6dfa6893f24e00320774a55425f864b`, SRI
  `sha512-D1GMJMNDG2omAkL1ztmO6ZEwEyW7LoFpTcckKh2yXjLyAgDFuhpTQrs2jQPAlVtGb3rjAeIXRZrkhFcwSWdGSg==`)
  의 무수정 스냅샷, `upstream-tests/`는 source commit
  `72c6e67787d67d8a7d01bf0abf30c072a6112de6`의 테스트 트리(104 entries —
  102 `.test.mjs` + fixture 2개, npm tarball에는 테스트가 없어 git에서
  가져옴), `runtime/`은 upstream `.ts` 전 모듈의 tsc 산출물(.ts 상대
  지정자는 `.js`로 재작성 후 컴파일)에 `vendor-pi-web-access.mjs`의
  OMA_DIVERGENCES만 입힌 생성물, `node_modules/`는 DEPENDENCIES 핀 테이블의
  npm tarball 바이트 그대로인 의존 클로저. host API(`@earendil-works/*`,
  typebox)는 vendoring하지 않고 OMA 설치본으로 해석한다(peer 의미 —
  `check-package.mjs`가 vendored runtime의 host API import를 설치본 존재
  확인으로 허용하도록 확장). `manifest.json`은
  `oma-vendored-bundle-v1`(파일별 sha256 + 정렬된 path\0sha256\n
  레코드의 번들 다이제스트 + 패키지/의존/divergence 메타) — 현재 11,020
  파일. 어댑터(`src/extension/web-tools.ts`)는 verify→정책 설치→
  facade→팩토리 순서를 지킨다: `verifyVendorBundle`이 먼저라 tampered
  번들은 어떤 vendored 바이트도 평가되기 전에 세션 거절(등록 0 +
  session_start refusal); 정책은 Society 계약 하나뿐 —
  `{ egressPinned }`만 설치되고 credentialCommands·browserCookies·
  ghCli·gitClone·geminiAdc·nativeMedia·localFileFetch·workflows는 전부
  미설정(deny-by-default)이라 `!command` credential은 서브프로세스 전에
  `[E_OMA_COMMAND_CREDENTIAL]`로, 나머지 ambient 발견 경로도 모두
  닫힌다. egress는 `OMA_EGRESS_PROXY_SOCKET`+`PORT`가 있을 때만
  loopback pin을 유도하고 그때만 vendored undici의
  `EnvHttpProxyAgent`를 global dispatcher로 설치 — pin이 없으면
  비어있지 않은 어떤 proxy 값도 `[E_OMA_PROXY_PINNED]`(도구 인자든
  web-search.json이든), 있으면 pin 외의 값이 같은 거절을 받는다.
  SSRF preflight는 pin 존재 시 upstream의 remote-DNS proxy 신뢰와
  동일하게 local-DNS 우회(splice로 선언). facade는 upstream의
  `registerTool`만 정확한 4개 이름(`web_search`, `source_check`,
  `fetch_content`, `get_search_content` — upstream 등록 순서 그대로
  1회씩)로 통과시키고 command·shortcut은 drop 기록, `pi.exec`
  (browser-open 유일 호출지)는 `[E_OMA_SUBPROCESS]`로 거절; init-config
  overlay divergence가 eager 등록·고정 도구명·커맨드 4종 비활성·
  answer 모드 제거·workflow "none"을 upstream config 위에 강제한다.
  경계 적응(번들 밖, 전부 기록됨): ① `deployment-manifest.ts`의
  MAX_ENTRIES를 4096→32768로 — vendored 번들은 전체 의존 클로저라
  dist 배포물이 ~12k 파일을 넘고, 매니페스트는 여전히 모든 멤버를
  개별 해시하며 "absurd inventory" 거절만이 bound의 역할이다.
  ② 아키텍처 runtime-closure 해석기는 `node_modules/`로 resolve되는
  상대 지정자를 거절하므로(외부로 취급) vendored undici를 직접
  import하는 대신 `utils.js`/`utils.d.ts` divergence가
  `EnvHttpProxyAgent`·`setGlobalDispatcher`를 re-export — 어댑터의
  모든 동적 지정자가 runtime/ 안에 머문다. ③ DR27 대기-관측
  시나리오의 `idleStreamSeconds`를 2→6초, fixture 관측 지연을
  3.5→10초로 — 번들 검증(~0.5s)+평가(~0.8s)가 엔진 기동을 2초 예산
  밖으로 밀어내 DEADLINE_EXCEEDED로 deterministic하게 죽던 것을
  관측(진단 출력으로 확인)하고 예산만 상향, 시나리오 의미(관측이
  제어-idle 예산을 outlive)는 유지. ④ BL1/BL3 surface 테스트의
  등록 집합·그룹 목록에 `web_research` 추가. 검증: build·typecheck·
  `vendor-pi-web-access --check`(BUNDLE_CURRENT)·check:architecture·
  check-package·review-ledger/closure 전부 PASS; `web-bundle.test.ts`
  12종 + 갱신된 lsp/hashline/DR27/패키지/pty/게이트 파일 전부 PASS.
  NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
  release qualification 레인.
- 2026-10-07 (bundled #3 — pi-hashline-edit-pro 맹검증 정산): BL3 맹검증
  결과 CLEAN + LOW 4건 — 1·4는 수정, 2·3은 upstream 형상 관찰로 기록.
  ① commit seam의 silent fallback 잠재 홀: `omaWriteCommit`/`omaReadFileText`
  가 채널 미설치 시 upstream `writeAtomic`/`readFile`로 조용히 떨어졌다
  (오늘은 도달 불가 — 설치는 검증 후·등록 전에 무조건이지만, 미래의 등록
  변경이 containment를 묵시 우회할 수 있었다). fail-closed로 전환: 채널
  부재 시 `[E_OMA_NO_COMMIT_CHANNEL]` throw. `writeAtomic` 자체는 살려
  두되 번들 자체 state 디렉터리로 국한 — `config.js:195`의 `configPath()`
  쓰기(`configDir()`=`PI_HASHLINE_DIR` 아래, OMA가 소유하는 별도
  ownership domain)만 계속 통하고, 그 외 직접 호출은
  `[E_OMA_STATE_DOMAIN]`로 거절한다. 열거 결과: `replace-undo.js:181`의
  직접 `writeAtomic` 호출은 seam을 타지 않으므로 seam-throw만으로는
  잡히지 않고, domain gate 덕분에 `regUndo`가 등록돼도 그 undo write는
  throw — 의도된 fail-closed 신호. 단, 같은 함수의 pre-write read는
  raw `open()`(`replace-undo.js:154`)으로 여전히 양 seam 밖이라, 등록이
  필요해지면 그 모듈 전용 splice가 별도로 필요함을 기록한다. splice는
  `vendor-pi-hashline.mjs`의 OMA_DIVERGENCES로만 — vendored 파일 손수정
  없음, `readFile` import splice는 fallback 소멸로 제거(emit이 upstream
  원문으로 복원), manifest `generated.divergences` 재기록 + `--check`
  BUNDLE_CURRENT. ④ inode 번역 단언 강화: 기존
  `/E_PATH_CHANGED|changed|different file/i`는 미번역 FILE_CHANGED_REFUSAL
  ("…a different file than…")에도 통과했다 — 번역이 사라져도 지나가는
  비결합 단언. `E_PATH_CHANGED` 필수 + raw refusal 부재 단언으로 교체.
  fail→pass 증거: baseline은 채널 없이 `omaWriteCommit`이 대상 파일을
  실제로 기록하고 직접 `writeAtomic`도 임의 경로에 기록 성공 → 수정 후
  seam throw·state-dir 쓰기만 성공·mutation 경로 거절·설치 시 채널 라우팅;
  번역 분기를 제거한 dist 패치에서 새 단언이 정확히 실패(구 loose regex는
  통과했을 것)함을 확인. 기록된 upstream 형상 관찰(수정 없음): ② read의
  image 분기 — seam-admitted sniff(`openForRead`)이 kind=image를 반환하면
  vendored read는 `createReadTool(ctx.cwd)`로 새로 만든 builtin read에
  위임해 payload를 다시 연다 — admission된 sniff와 builtin의 자체 open
  사이에 inode 교체 창(TOCTOU)이 있고 payload read는 seam을 타지 않는다.
  upstream의 위임 설계 그대로; seam이 sniff 단계의 admission gate로 남아
  있어 비승인 경로에서는 분기 자체에 도달하지 못한다. ③ 비승인 경로의
  metadata oracle — `valAccess`(raw fsAccess)와 `loadFileKindAndText`의
  선행 `fsStat`이 seam의 `openForRead`보다 먼저라, 거절되는 경로에 대해서도
  존재/유형(directory·too_large의 크기 임계 통과 여부)이 답으로 관측된다.
  content 자체는 여전히 seam이 한 바이트도 열기 전에 거절한다 — 노출은
  existence/type/size의 메타데이터에 한정, upstream shape 유지로 기록.
  NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·release
  qualification 레인.
- 2026-10-07 (bundled #2 — ask_user_question, OMA 네이티브): §7 순서
  (lsp→ask→hashline→web→mcp)의 두 번째 확장 — vendoring 아닌 직접 구현.
  오라클은 `@juicesharp/rpiv-ask-user-question@2.12.0` 타르볼: bound
  (question 1-4·option 2-4·header ≤16·label ≤60), 예약 라벨
  (Other/Type something./Next), 검증 순서(개수→중복 질문→옵션 개수→
  reserved가 duplicate보다 선행), 결과 변형(option/custom/multi,
  `answer: string | null` — multi와 빈 custom은 null + selected, 빈
  문자열 아님), 봉투 문구("User has answered…"/"User declined…",
  `(no input)` placeholder)까지 대응. OMA 추가 검증(`missing_fields`,
  `too_many_options`, `no_presenter`)은 upstream이 TypeBox 스키마에
  위임한 부분을 fail-closed validator가 커버하는 것 — 공유 검사의
  순서는 그대로. 의도적 차이(문서화): upstream extras(notes/global
  note editor·config 파일·l10n·BEL/ACP·external editor·transcript
  collapse) 미이식; 단일 질문에서도 uniform Submit/review 탭
  (upstream은 단일 질문 자동 제출); 생명주기 경계 정책은 OMA 소유 —
  /new·/resume(session_before_switch)·reload·shutdown
  (session_shutdown)·abort·선 abort 모두 구조화된 cancel 결과로
  정산하고 큐잉된 요청도 drain — pending call이 걸리거나 답변이
  조작되지 않음. 경계: `src/extension/ask-user-question.ts`는 검증→
  `oma.ask.request` emit→동기 claim 확인(no presenter면
  `no_presenter` 구조 거절, 채팅으로 물으라는 지시 포함)→bus 응답
  대기 — 답변은 prompt 큐·mail·session switch와 무관하게 tool call
  result로만 귀착. `executionMode: "sequential"`로 다이얼로그 겹침
  불가. UI seam은 공개 `ctx.ui.custom(factory, {overlay…})` —
  `src/tui/ask-user-question/`(presenter + component), factory가
  `ctx.ui.custom` 안에서 동기 호출돼 cancelDialog가 mount 전에
  설정됨(dist의 showExtensionCustom 확인); presenter는 경계가
  마지막으로 건넨 live context를 요청 시점에 읽고(`context: () =>
  context` 지연 바인딩 — stale context 캡처 회피), context 소멸 시
  open/queued 모두 구조 cancel로 정산. 역할: `pi-extension.ts`가
  `channel.attached`일 때만 등록(Principal), Personal은 자체 `-e`
  경로(DEPLOYMENT_LAYOUT.extensionAsk), Resident/Worker 플랜에는
  이름 자체가 없고 DIRECT만(GROUPED 아님). 테스트 29개: schema/
  bound/검증 순서/envelope/details parity, 단일·다중 선택·custom
  입력·checkbox·tab·Esc, resize(폭 의존 stateless 재렌더), /new·
  /resume·reload·quit·abort·선 abort 경계, 큐 drain·malformed bus
  payload·idempotent 등록, no_ui/no_presenter 거절, 답변이 prompt가
  아닌 tool result로 도착(경로 터치 시 throw하는 fake),
  Principal DIRECT/Resident 부재. NOT_RUN: macOS native·systemd·
  kernel/powercut·provider credential·release qualification 레인,
  실제 터미널 수동 구동(컴포넌트는 fake context로만 구동).
- 2026-10-06 (bundled #1 — LSP 자식 env 이름-charset 잔여 정산): 맹검증
  잔여 — `admittedChildEnv`가 VALUE만 guard하고 KEY charset은
  미검증이었다. adapter env `{"LC_ALL=/etc/evil-locale": "C"}`는
  lowercase 후 `lc_` prefix에 걸려 통과하고 spawn 직렬화 결과
  `LC_ALL=/etc/evil-locale=C`가 됨 — path-shaped 값이 KEY를 타고
  `tokenValueAllowed`를 우회. NUL 이름도 같은 class(spawn의
  ERR_INVALID_ARG_VALUE — fail-closed지만 unhandled). `lc_` prefix
  class + admin이 제어하는 adapter env에서만 도달 가능했으나 선언된
  predicate 불변식은 깨진 상태였다. 수정: `CHILD_ENV_KEY_CHARSET
  = /^[A-Za-z0-9_]+$/`를 RAW key에 fold 전 적용 — U+212A(KELVIN
  SIGN)가 `k`로 fold되는 unicode 세탁도 차단. `admittedChildEnv`는
  단일 predicate라 inherited(process.env)·adapter(pi-lsp.json env)
  양 채널이 동시에 닫히고, scratch tier는 컴파일 상수라 우회가
  정합적. `=`·NUL 이름은 POSIX environ이 표현 불가(엔트리 자체가
  `name=value` C 문자열)라 adapter 채널 전용, `..`·non-ASCII 이름은
  양 채널을 탄다. proxy-pin은 proxy 이름이 exact-match라 key 속임으로는
  애초 도달 불가 — charset gate로 구조 봉인 + forge 케이스 추가.
  오라클 `sanctionedChildName`이 같은 gap을 공유하고 있어 동일
  charset으로 정합. 기록 정정: 이전 항목의 "155명"은 실측 오기 —
  해당 커밋의 corpus는 275명이었다(아래 항목 수정). 이번 추가로
  corpus 279(양 채널 plantable) + adapter-only hostileKeys 7 = 286명.
  fail→pass: baseline은 `LC_..EVIL`·`LC_ÄLL`·`LC_KETCHUP`(양 채널),
  `LC_ALL=/etc/evil-locale`·`LC_ALL\0EVIL`(adapter)을 admit —
  post-fix 0/286 생존. NOT_RUN: 실제 언어 서버 바이너리
  e2e(픽스처만), macOS·systemd 레인.
- 2026-10-06 (bundled #1 — LSP 자식 env deny-by-default): 규칙-테이블
  denylist의 근본적 불수렴 정산 — 맹검증 코퍼스(161명)에서 84명이
  살아남았고 전부 toolchain/로더 주입 채널이었다. 언어 서버는
  하위 toolchain을 shell out하므로 생존한 채널 하나하나가 실
  code-execution/supply-chain 표면 → denylist 확장이 아니라
  allowlist(deny-by-default)로 전환. `lsp-tools.ts`에
  `OMA_LSP_CHILD_ENV_ALLOW`(path·lang/language/tz/term/no_color·
  user/logname/username·Windows plumbing + `lc_` prefix 하나)와
  `admittedChildEnv`를 신설하고 `hardenedAdapter`가 자식의 환경 전체를
  구성하도록 교체 — inherited → adapter 선언(동일 predicate) →
  per-call scratch HOME/XDG/TMP 순 계층. 거절 이름은 빈 문자열
  tombstone이 아니라 부재(loader는 빈 path-list 요소를 현재
  디렉터리로 해석). token형 이름은 `/`·`\`·NUL·`..` 값을 거부
  (LC_*/TERM/LANG이 file-resolve 채널), `tz`는 Area/City만 허용.
  proxy는 4개 이름(http/https/all/no_proxy)만 + 값이
  OMA_EGRESS_PROXY_SOCKET+PORT로 재계산한 sandbox loopback pin과
  byte-일치할 때만 통과 — 호스트 엔진/부분 wiring은 pin이 없어
  모든 proxy 부재. vendored `mergeEnvironment`가
  `{...process.env}`로 seed하던 것을 OMA divergence(command.js
  1 edit)로 `{}` 교체 — vendor 스크립트 경유, --check PASS.
  테스트: 코퍼스 전체(275명 — 이전 기록의 155는 실측 오기, 위 잔여
  정산 항목에서 정정)를 inherited+adapter 양 채널에서
  부재 단언, allowlist 생존자·path-shaped 값 거부·proxy pin·
  scratch 우위 단언, 실제 spawn된 자식 안 env-probe(pid-echo로
  per-call 프로세스 증명 — PI_LSP_TEST_* 채널이 deny되어 wire
  프로토콜로 증명하도록 재설계). NOT_RUN: 실제 언어 서버 바이너리
  e2e(픽스처만), macOS·systemd 레인.
- 2026-10-06 (bundled #1 — pi-lsp 맹검증 정산 2라운드): BL1 잔여 맹검증 발견
  F1–F6 정산. F1(누적 워크스페이스 편집 무제한 + 동기 O(n²) 중첩 검사):
  `text-edits.js`에 `OMA_MAX_WORKSPACE_EDITS=2048`·
  `OMA_MAX_WORKSPACE_EDIT_BYTES=4MiB` 신설 — `collectWorkspaceEdits`가
  documentChanges/changes 양 형태를 수집 중간에 거절(flatMap 전체
  구체화 없음), `runner.js`의 runFix는 선택된 모든 action 합산으로
  count·newText 바이트를 bound(per-list 상한 × 256 actions 허점 제거),
  `hasOverlappingTextEdits`는 start-정렬 스윕으로 교체(판정 동치 —
  교체는 이전-열린 구간·동일-start 형제, 삽입은 이전 구간 내부만
  충돌), `applyTextEdits`는 오름차순 단일 패스(동일 위치 삽입은 리스트
  순서 보존). F2(env denylist 원칙화): 이름 나열을 규칙 테이블
  (`CHILD_ENV_DENY_RULES`)로 교체 — 자격증명 단어 위치 무관 탐지,
  database/pg/mysql/mongo/redis·aws_/azure_/gcloud/kube 설정 채널,
  npm_config/yarn/pnpm 레지스트리 채널(`//host/:_authtoken` 포함),
  git_ 전체 프리픽스(CONFIG_PARAMETERS·EXEC_PATH·SSL_CAINFO), CA/TLS
  override(_ca_/cert/ssl·NODE_EXTRA_CA_CERTS·SSLKEYLOGFILE), 로더/
  런타임 채널(dyld·gem·python·java 등), docker/dbus/display/xdg_
  (scratch-redirect 3개만 `XDG_REDIRECTED_ENV_KEYS` 면제), `*_proxy`
  전 계열. F3(stderr 정확 경계): 길이만 보던 검사를 `{sample,dropped}`
  명시 상태의 `appendStderrSample`(exported)로 교체 — cap 정확 도달은
  미표시, 이후 바이트 도착 시 표시+거절; 픽스처의 stderr flood는 write
  콜백+drain으로 결정론적 flush 뒤 실패/종료(150ms sleep 레이스 제거).
  F4(post-spawn error 고아): 영구 `child.on("error")` 핸들러가 ref를
  지우기 전 `kill("SIGKILL")` — 기존엔 shutdown()이 early return해
  프로세스가 고아가 됐다. F5(manifest 메타데이터): `vendor-pi-lsp.mjs
  --check`가 `manifestMetadataProblems`(exported)로
  `generated.divergences`를 OMA_DIVERGENCES와(reason·edit 수 포함),
  `package.*`를 pin된 upstream 신원과 비교 — 파일 바이트·번들
  다이제스트만 보던 허점 정산. F6(전 extension verify-before-import):
  컴파일 스캔을 `src/extension/` 전 모듈로 확장 + `surface-rules.mjs`의
  extension-dynamic-load가 extension 멤버의 정적 vendored import/
  re-export를 적발(type-only은 컴파일 소거라 허용). 테스트: 적대
  픽스처에 edits-flood·edits-documentchanges-flood·edit-bytes-flood·
  edits-at-bound 추가 — baseline fail(9+2+rule 1) → post-fix
  lsp-upstream/lsp-bundle/surface-rules 전부 pass. `vendor-pi-lsp.mjs
  --write` 재생성·`--check` PASS, manifest divergences 8/7/2/4 edits로
  정직 기록, source digests·review-notes(byte-bound 재결박)·
  review-ledger·validation digest 재바인딩. NOT_RUN: 실제 언어 서버
  바이너리 e2e(픽스처만), macOS·systemd 레인.
- 2026-10-06 (bundled #1 — pi-lsp 맹검증 정산): BL1에 대한 맹검증 발견 F1–F7
  정산 + F8 저비용 bound 반영. F1(server→engine 무제한): vendored
  `lsp-client.js`에 stderr 64KiB bounded sample(truncated 마커), 인바운드
  프레임 버퍼 4MiB(미완성 프레임·초과 Content-Length 선언 모두 호출 실패+
  서버 kill), pushed diagnostics 바운드(1024/파일·8KiB/메시지·4096 URI),
  code-action 256 상한으로 순차 resolve 루프 bound, 자식+stdin/stdout/stderr
  영구 `'error'` 리스너(기존 once('error')는 첫 실패만 커버 — 이후는
  unhandled로 엔진 사망 가능). `runner.js`: admission stat과 read 사이 성장을
  잡는 read-후 1MiB 재검사 + pull 응답에 push와 같은 진단 바운드.
  `files.js`: collectPath 깊이 256. 어댑터 측 호출당 aggregate deadline
  (기본 300s, `callDeadlineMs` seam) — route 수와 무관하게 호출 전체를 묶는다.
  F2(자식 파일시스템 권한): clangd의 프로젝트-로컬 `.cache` 관측에서 보듯
  env 리다이렉트만으로는 서버의 옆파일 쓰기를 막을 수 없음 — 계층 방어로
  HOME/XDG/TMP를 호출당 mkdtemp scratch로 리다이렉트+종료 시 삭제하고
  읽기전용 역할(Principal)은 spawn 가능 도구(`lsp_diagnostics`·`lsp_fix`)를
  실행 전 거절(`lsp_status`는 spawn 없이 유지); LSP 두 도구의 read 경로는
  workspace-only로 고정. F3(verify-before-import): `lsp-tools.ts`의 정적
  vendored import 전부 제거 — `verifyVendorBundle` 통과 후에만
  `await import()`로 runtime 로드(타입 import는 컴파일 소거라 무해),
  `lspChildEnvironment`도 직접 호출 경로에서 verify+lazy import로 불변식
  유지; `surface-rules.mjs`의 dynamic-load 규칙은 `src/extension/vendor/`
  하위 리터럴 import만 허용하도록 좁혔다(계산된 지정자·경로 이탈·require
  는 여전히 금지). F4(env denylist): 상속 env와 어댑터 override 양쪽에
  대소문자 무시 denylist — `OMA_*` 프리픽스 + 프리로드/로더 채널
  (NODE_OPTIONS·LD_PRELOAD·DYLD_INSERT_LIBRARIES·PYTHONSTARTUP·RUBYOPT
  등) + 자격증명 형태 이름(TOKEN/SECRET/PASSWORD/CREDENTIAL/AUTH/API_KEY
  계열) + 프록시 + agent-dir 포인터. F5: runner의 `OMA_TOOL_SURFACE_HEX`는
  이제 canonical hex+UTF-8 round-trip으로 검증(absent·빈 문자열·비hex·0x
  프리픽스·홀수 길이·invalid UTF-8·절단 payload 전부 exit 4), 죽은
  `toolSurface === null` 분기 제거. F6: operations.md의 "tool-surface
  프로듀서 없음" 기술 정정 — oma-society/unit 렌더링 프로듀서 활성.
  F7: review-notes·review-ledger(도구 재생성)·validation digest·source
  digests·dependency-graph evidence 재바인딩. 테스트: 적대 서버 픽스처
  `test/fixtures/lsp-hostile-server.mjs`(stderr flood·프레임 폭탄/drip·
  pull/push 진단 폭탄·action 폭탄·env echo)로 baseline fail→post-fix pass
  증거 확보(baseline 16건 실패 → 수정 후 lsp-bundle+lsp-upstream 38/38);
  runner 음성 케이스·surface-rule 케이스 보강. NOT_RUN: 실제 언어 서버
  바이너리 e2e(픽스처로만), macOS·systemd 레인.
- 2026-10-05 (bundled #1 — pi-lsp): §7 순서(lsp→ask→hashline→web→mcp)의 첫
  확장 구현. `@narumitw/pi-lsp@0.49.9`를 `src/extension/vendor/pi-lsp/`에
  byte-pinned vendor — `upstream/`은 npm 타르볼(shasum
  `6643cec0b716…`, SRI `sha512-YQ49sPiz…` — 레지스트리 메타와 직접 해시가
  일치함을 재확인)의 무수정 스냅샷, `upstream-tests/`는 source commit
  `55d78470`의 테스트, `runtime/`은 upstream 소스의 tsc 산출물 48파일,
  `manifest.json`이 파일별 SHA-256+번들 다이제스트로 바인딩.
  `vendor-bundle.ts`가 등록 전 정확-집합 검증(변경·누락·미기재·매니페스트
  손상·다이제스트 불일치는 전부 같은 거절)하고 실패 시 세션을 거절한다.
  어댑터(`lsp-tools.ts`)는 정확히 `lsp_diagnostics`·`lsp_fix`·`lsp_status`
  3개만 노출하고 upstream runner의 per-call 라이프사이클(spawn→
  initialize→작업→shutdown→종료, abort→client.close,
  `LspSessionScope`의 session start/shutdown 계약)을 그대로 유지한다.
  OMA가 소유하는 경계: workspace root=엔진 realpath 워크스페이스 고정
  (root 인자 비공개, 심링크 이스케이프는 vendored realpath 벽이 재거절),
  자식 env에서 `OMA_*`·`NODE_OPTIONS` 제거(PATH 유지), 서버 수·경로 수·
  파일 수·바이트·timeout 클램프, 미설치 명령은 clean이 아니라
  `unavailable`로 보고하고 적용 가능 경로가 전부 unavailable이면 호출을
  명시 실패. `lsp_fix`는 기본 preview — `write:true`가 유일한 mutation이고
  OMA `createContainedWriter`(직렬화+quota)만 통한다. upstream의 직접
  writeFileSync 분기는 비활성 유지. guard는 `lsp_fix`를 조건부 write로
  등록해 Principal의 write:true를 실행 전 차단하고 `paths[]`의 모든 항목을
  검사한다. tool surface는 `code_intel` 그룹 하나로 Resident/Principal 플랜
  모두에 선언 — 플랜은 도메인에서 인코딩, Resident는 유닛의
  `OMA_TOOL_SURFACE_HEX`→runner 디코딩, Principal은 oma-society/session
  경로로 전달, 확장 측 투영은 미등록 도구 참조·그룹↔도구 충돌·섀도잉·
  손상 입력에서 fail-closed. 테스트: lsp-bundle 18(번들 무결성·fail-closed
  등록·surface·guard·unavailable·preview/write·quota·심링크·per-call
  프로세스·취소·env 스크럽) + lsp-upstream 3(vendored client/runner/route
  직접). 문서-무결성 스캔은 vendor 트리를 authored 문서 범위에서 제외
  (바이트 핀 페이로드이므로). NOT_RUN: 실제 언어 서버 바이너리가 설치된
  상태의 e2e(픽스처 서버로만 검증), macOS·systemd 레인.
- 2026-10-07 (egress 후반 3차 — 잔여 부류 기록): 3라운드 수정으로 egress 시리즈
  수렴(366d257 CLEAN). 맹검증이 남긴 **전신성 부류 — 13기준 전수 스캔에서 다룰 것**:
  post-listen `server`에 영구 `'error'` 리스너가 없음(`server.once("error",
  reject)`를 listen 성공 후 `.off`로 해제하는 패턴 — accept 계열 에러 EMFILE/
  ENFILE이 오면 리스너 0개의 'error' 이벤트 → EventEmitter throw →
  uncaughtException → 프로세스 사망). 노드: `connect-proxy.ts:398`,
  `egress-forwarder.ts:195`, `guest/egress.ts:77`, `inference-relay.ts:193` 등
  트리 전반 동일 패턴 — 조각 수정이 아니라 전수 스캔에서 전체 열거 후 영구
  리스너(best-effort journal + close) 방향 또는 "의도된 crash-acceptable" 판정을
  내린다. 미세 관찰 2건도 스캔 입력으로: `rpc.ts:298` `new FrameParser`가 'data'
  emit 안 try 밖(오설정 시에만 도달), `egress-bridge.ts:41` 영구 'error' 리스너
  안 `process.stderr.write`(stderr 사망+bind 실패 동시 시 emit 탈출).
- 2026-10-07 (egress 후반 3차): DR34 맹검증 잔여 1건 정산 — CONNECT proxy의
  동기 `request`/`upgrade` 리스너가 emit 안에서 `audit()`를 직접 호출해
  journal throw(stderr EPIPE 등)가 `server.emit`을 escape → uncaughtException
  → runner 사망(delivery의 tunnel/relay 전부 동반)하던 결함. host/egress의
  dispatch boundary("journal이 record를 거절" 모델)를 거울해 이 경계들의
  journal은 best-effort — sink throw가 거절을 거부하거나 프로세스에 닿지
  못하고, 리스너 안의 다른 실패는 연결만 끝낸다. 같은 클래스 sweep:
  host/egress의 audit 8곳은 `connectTunnel`의 `.catch` boundary 안(안전),
  egress-forwarder·guest/egress는 audit 호출 자체가 없음(해당 없음). fail→pass
  회귀(throwing sink + GET/upgrade/refused CONNECT → 405 유지·소켓 파괴·
  listener 생존) 추가. NOT_RUN: macOS native·systemd·kernel/powercut·
  provider credential·release qualification 레인(로컬 환경 없음).
- 2026-10-07 (egress 후반 2차): DR34 맹검증 2라운드 — paused-socket seam의
  수명주기 결함 7건을 fail→pass 회귀로 정산. ① CONNECT proxy의 upstream close가
  client로 전파되지 않아 `tunnels` 슬롯이 idle budget까지 묶이던 것 — 양방향
  close 전파로 즉시 해제. ② forwarder placeholder lease가 `oneFrame` 반환 뒤
  paused로 남아 나중 세그먼트의 post-answer bytes를 못 듣던 것 — 리스너 설치 후
  `socket.resume()`. ③ `egress.open` dispatch가 동기 `connect()` throw를 잡지
  않아 void-dispatched reader의 unhandled rejection이 되던 것 — try/catch로
  socket 종료. ④ Teredo는 embedded v4 두 필드(screen 불가, 도달이 tunnel 상태
  의존)라 unwrap 대신 `2001:0000::/32`를 통째로 거절로 결정 — deprecated carrier.
  ⑤ guest `egress.connect`가 `answer.rest`를 거절하던 것 — rest는 tunnel의 첫
  payload라 client로 relay(`asked.rest`는 host로) — forwarder의 rest 의미와
  대칭. ⑥ host held lease가 resume 없이 `first.rest`도 버리던 것 — rest 있는
  요청은 unanswered로 종료, 리스너 뒤 resume. ⑦ guest held lease 쌍이 paused+
  data-리스너 없음이라 speech 뒤 clean FIN을 놓치던 것 — 양쪽에 data/end 리스너+
  resume. 계약 기록: `readLeadingFrame`/`oneFrame`은 paused로 반환 — 이어지는
  소유자가 리스너와 함께 resume할 책임; `receiveDeclared`·`egress.open`·
  `requestEgressConnect`는 이미 준수. DR34 addendum 2라운드에 pause/resume·
  Teredo·rest 결정 기록. NOT_RUN: macOS native·systemd·kernel/powercut·
  provider credential·release qualification 레인(로컬 환경 없음).
- 2026-10-06 (egress): UX-08/S-07 재개 — DR34 project egress. `HostConfigV1.egress`
  (baseline `allow` + `roles.<role>`)가 유일한 Human 표면이고, 절이 없으면 socket도
  변수도 없다. runner가 delivery당 CONNECT proxy(`src/runtime/connect-proxy.ts`)를
  `/run/oma/egress.sock`로 `--ro-bind`하고 extension bridge(`egress-bridge.ts`)가
  loopback 8318로 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`를 세운다. 정책은 순수 모듈
  `src/domain/egress.ts`(이름/`*.suffix` 문법, authority parse, role 해석). 프록시는
  CONNECT·authority-form·443만 받고 요청 header는 거기서 끝난다. 다이얼은 이름을 한 번
  resolve하고 모든 answer를 private/loopback/link-local/CGNAT/docs/reserved/multicast·
  인코딩(v4-mapped/NAT64/Teredo/6to4) 대역으로 screen한 뒤 literal을 pin한다. macOS는
  `egress.connect`(host↔guest protocol 6)가 같은 pool 위에서 host 다이얼을 청한다 —
  선언된 allowlist를 싣고 host가 문법+목록+SSRF를 다시 집행. Linux는 같은 screen의
  직접 다이얼. CONNECT마다 actor/role/target/verdict 한 줄 journal. 신규
  `test/egress-connect.test.ts` 17 + `platform-egress` connect e2e.
- 2026-10-06 (egress 후반): DR34 맹검증 9건 정산 — 전부 fail→pass 증거付
  회귀 테스트로 고정. ① run의 tunnel 단위는 pooled connection 하나(client만
  count), check+예약을 dial 전 동기 단계로 합쳐 burst overshoot 제거 —
  4개 standing + 5번째 BROKER_UNAVAILABLE + close가 slot 반환을 e2e로 확인.
  ② v6 screen을 denylist에서 fail-closed allowlist(`2000::/3` − 특수용도,
  embedded-v4 carrier는 unwrap 뒤 IPv4 규칙)로 재작성 — `64:ff9b:1::/48`·
  `::/8`·`2001::/23`·`5f00::/16`·`3fff::/20` 등 목록 전부 거절 확인.
  ③ 거절된 비-CONNECT/upgrade socket이 linger하던 것 — `Connection: close`+
  destroy, pipelined CONNECT는 dead socket에서 dial되지 않음. ④ audit target을
  raw request slice에서 정규화된 `host:port`/`(request-target redacted)`로 —
  userinfo·query·credential이 journal에 닿지 않음을 직렬화 단언. ⑤ proxy
  socket `chmod 0600` + 실패 시 listener·name 회수(P0-4/AV-20261003-28 패턴).
  ⑥ wire 256-entry bound를 commit에서 resolved list(baseline+role)에 집행
  (`EGRESS_ALLOW_MAX` 공유 상수). ⑦ dial 중 run 종료 경로에 "fail" audit 한 줄
  추가 — silent drop 없음. ⑧ INVALID_REQUEST(dial screen 포함)는 `"refuse"`,
  운영 실패만 `"fail"` — host↔proxy 라벨 정렬. ⑨ `oneFrame`이 응답 frame 뒤의
  raw bytes를 parser에 재공급하던 것 — `{frame, rest}` 반환으로 바꿔 tunnel
  payload 보존 + lease의 post-answer bytes 감지 유지; audit sink throw는
  dispatch boundary에서 catch해 host 생존 + upstream 회수. DR34 addendum에
  v6 모델·audit·bound 결정 기록. NOT_RUN: macOS native·systemd·kernel/
  powercut·provider credential·release qualification 레인(로컬 환경 없음).
- 2026-10-05 (C): plan §C society-off 재설계 구현 — Personal 세션의 `/society`가
  프로젝트 자신의 Society 슬롯(`<data>/<projectSociety(cwd)>`)을 읽기 전용으로
  게이트하고(bound·unreadable·unavailable·binding 없는 기록·다른 birth record·
  legacy slug는 그 기록을 이유로 거절), free면 writer의 실제 종료를 관측한 뒤
  host가 `oma --society <project>`로 execve 재진입 — `RESUME_SESSION_ENV` 없는
  새 Society birth. 게이트↔재진입 사이는 아무 기록도 쓰지 않아 kill/powercut이
  다음 `/society`의 재관측으로 끝나고, binding 게시 뒤 재시작은 born으로 인식.
  신규 `src/runtime/society-slot.ts`, wire `{type:"switch", society}`,
  pi-personal boundary 명령, personal-host execve 분기. 라이더:
  `Indicator.drawnAt` 제거. UX-35. macOS Personal은 전환 없이 거절.
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
- 2026-10-05: UX-09 구현 — candidate 전체 트리의 gitlink(mode 160000)를 관측해
  integration·review admission·sandbox checker의 세 경계에서 `UNSUPPORTED_PROFILE`+
  `details.paths`로 거절(DR33, INT-001/INT-007/ERR-001 갱신). transport·provisioning은
  허용 유지, provisioning notice·Mac import notCarried·START.md가 경로를 알림.
  fail-before: 구 소스는 merge open을 받은 뒤 통합에서 `CHECK_FAILED`(bare 125)로만
  실패하거나 gitlink main을 조용히 통합했다. review-notes 재바인딩·ledger·digest 갱신.
- 2026-10-05 (후반): UX-09 맹검증 잔여 3건 — 거절 마커를 stderr 전체-행 앵커로
  좁히고(더 긴 행 안의 같은 바이트는 CHECK_FAILED 유지), 전체 트리 열거가 공유
  4MiB를 쓰던 것을 `GITLINKS_OBSERVATION_BYTES`(256MiB, ~1M leaf 기준)라는
  이름 있는 bound로 분리 — 초과는 여전히 output-limited→unknown이며 잘린
  "gitlink 없음"은 아님(DR33에 사유 기록). `parseGitlinksZ` 적대 입력 시험과
  prepared-revert 게이트 직접 시험을 보강했다.
- 2026-10-05 (꼬리): UX-09 거절-정직 잔여 닫힘 — 마커는 "봐 달라"는 주장일
  뿐, 호스트 재관측의 종류가 그대로 정산한다(unknown·absent→REF_STATE_UNKNOWN,
  corrupt→STORE_CORRUPT, refused→INVALID_REQUEST, present+경로만 거절).
  present:[]는 마커가 스스로 거짓임을 증명한 것이므로 plain CHECK_FAILED로
  떨어진다. quarantine의 `OMA_ERROR=` 분류도 같은 전체-행 앵커를 따른다
  (해당 stderr는 user argv가 닿지 못하지만 같은 종류). DR33에 판정 기록.
- 2026-10-05 (심야): 선행 작업 A 완료 — Pi 0.87.1→1.0.1 + pi-tui 1.0.1 +
  pi-open-tui 0.3.9→0.3.11 원자 bump. 1.0.1 전용 API(`registerToolRenderer`,
  `ToolExposure`)는 확보됐고 이후 단계(B compact tools 등)가 그 위에 놓인다.
  실제 이식 변경은 두 곳뿐: RPC `prompt` 응답이 `data.disposition`을 싣고
  `preflightResult` 콜백이 disposition을 받는 계약(수용=성공, 거절=promise
  reject, `input_result.queued` 의미론 불변), `quietStartup`이 `boolean|"header"`
  로 넓어져 `"header"` literal을 통과시킨다. 나머지는 pin 재바인딩 — private
  member 12개 전원 존재, 내장 명령 집합 동일, open-tui의 wheel-scroll 삭제는
  Pi `fullscreenWheelScrollLines`+pi-tui 네이티브가 소유(OMA shim 없음),
  header/peek/state/runtime은 byte-identical이라 brand 래핑 anchor 그대로.
  `PI_ADAPTER_REVISION`→`oma-pi-rpc-v1@1.0.1`(spec·traceability 동반, 미정산
  영수증은 업그레이드 후 conflicting — 정산 뒤 올리는 기존 절차 유지).
  상세는 plan-prereq-and-bundled.md §A 실행 결과. npm ls로 pi-tui 단일 설치
  확인, 타겟+full suite 전부 PASS.
- 2026-10-05 (B 라운드): TUI 표면 4건 전부 구현·커밋 분리 — B1 compact 도구
  행(88ea1be, `registerToolRenderer` 공개 seam + `renderShell:"self"` + 인디케이터/
  컨트롤 행, `oma_` 접두어는 표시만 제거), B2 `/thinking show|hide` 정확 일치
  인터셉트(c1e6f10, `hideThinkingBlock` 읽고 상태 다를 때만 Pi private toggle),
  B3 미전송 큐 표시(f72bc6f, `waiting[]`→`queued_prompts`→`setWidget` aboveEditor,
  빈 큐 제거·문장 불변), B4 메일 역할명(617dce1, roster 이름순 `worker<N>`·
  전체전송 `worker`·`principal`·`topic/<x>`, 상세 `To:` 행, 미관측 roster는
  원문 유지). fixture 보수 6c91bef(B1/B3 seam 선언 누락). 표시만 변경 —
  wire 이름·durable mail facts·reply 라우팅 불변. 상세는
  plan-prereq-and-bundled.md §B 실행 결과.
- 2026-10-07 (전신성 부류 — post-listen 'error' 전수 스캔 정산): DR34 후반에서
  미뤄 둔 "listen 성공 후 `.off`로 유일한 'error' 리스너를 해제"하는 패턴을
  프로덕션 경계 전체로 스캔해 6곳 전수 정산. `server.once("error", reject)`
  + `listen` 콜백 안 `server.off` 패턴은 성공 직후 리스너 0개를 남기고, 그
  뒤 accept 계열 에러(EMFILE/ENFILE)는 emit을 탈출해 호스트 프로세스를
  죽인다 — runner는 delivery의 tunnel·relay·forwarder 전부, oma-society는
  세션, guest unit은 그 boot의 채널 전부와 함께. 정산 모델은 6곳 공통으로
  **영구 리스너 → 보호된 best-effort journal + socket bound 유지**:
  커널이 accept를 재시도하는데 close는 client가 계속 다이얼하는 이름을
  끊고, crash는 이미 살아있는 채널 전부를 떨군다. journal 싱크는 프로세스별
  기존 관례 — runner·guest·host unit은 stderr(console.error),
  connect-proxy는 기존 audit 채널(`(listener)` 타겟), EgressForwarder는
  새 `onError` 심(runner 기본값 stderr / oma-society는 화면 notice로
  연결, tenancy 명시). startup bind 에러는 여전히 once-listener가 reject
  한다 — 영구 리스너는 대체가 아니라 병존이며, 오히려 startup 실패도
  정직하게 기록한다.
  - 노드: `runtime/inference-relay.ts`(생성자), `runtime/connect-proxy.ts`
    (server 생성 직후), `runtime/egress-forwarder.ts`(listen, `onError`
    파라미터 + `openPrincipalEgress`→`adoptPrincipalEgress`→oma-society
    `notice` 연결), `platform/guest/server.ts`(guesthost·guestctl 공유
    경계), `platform/guest/egress.ts`, `platform/host/host-api.ts`
    (omahostd 경유).
  - 전수 스캔 방법: `\.once\(\s*"error"`·`\.on\(\s*"error"`·`\.off\(\s*"error"`
    를 src 전체에 치고, `createServer|\.listen\(`를 든 모든 server 객체를
    열거 — 나머지 후보는 `test/p0-review7` 가짜 server(fixture, 해당 없음),
    `extension/egress-bridge.ts`·`extension/inference-bridge.ts`(이미 영구
    리스너 — journal·register·retry가 무가드, 잔여로 정산), vendored
    `pi-web-access/runtime/curator-server.js`(같은 once+off 패턴 —
    byte-pinned 페이로드라 OMA_DIVERGENCES splice로 영구 리스너 + 보호된
    journal, 설치된 표면은 workflow pin이 "none"이라 도달 불가 — 미설치
    평가 대비 defense in depth), runner/broker의 자식 프로세스·소켓
    'error'는 이미 리스너가 있거나 개별 소켓 계약(죽을 수 있는 연결 —
    리스너 유지가 수명)이라 대상 아님. `upstream/`·`node_modules` 안의
    동일 패턴은 byte-exact npm 스냅샷이라 OMA가 수정하지 않는다.
  - 동일 emit-탈출 잔여 3건: `platform/rpc.ts` `new FrameParser(frameBytes)`
    가 'data' emit 안 try 밖(NaN·비정수·무한 limit는 길이 비교를 전부
    false로 만들어 생성자까지 도달 — emit 탈출로 호스트 사망이 되던 것을
    try 안으로 옮겨 이 읽기의 거절로), `extension/egress-bridge.ts` 영구
    'error' 리스너 안 `process.stderr.write`를 보호된 기록으로(stderr
    사망 + bind 실패 동시 시 write throw가 다시 emit을 탈출),
    `extension/inference-bridge.ts` 영구 'error' 리스너의 본문 전체를
    비던짐으로(write·재등록·retry listen이 emit 안에서 던질 수 있었음 —
    재등록 거절은 첫 bind가 남긴 안전 상태 그대로, retry 실패는
    unreachable override 유지).
  - LOC 계정 무결성 잔여(production-inventory.mjs, 두 파일의 같은 라인):
    `report[file]`/`classified[file]` 무가드 접근이 `constructor`·
    `hasOwnProperty` 같은 이름의 실제 인벤토리 파일을 Object.prototype
    상속 멤버로 오독해 "계정됨"으로 잘못 판정하던 것을 `Object.hasOwn`
    기반 `rowAt` 조회로 수정(위치는 그대로 — `production-inventory.mjs:114·121·123`
    계보). CLOC_NON_CODE_REASON 화이트리스트에 `temporary editor file`
    (`~` 백업 — `implementation/vendor/*~`가 실제로 도달 가능한 판정)
    만 추가 — `file size ... exceeds max file size`·`not file, not
    directory`·`cannot read`·`unable to associate with a language` 같은
    관측 이상 verdict는 여전히 분류가 아니라 게이트 실패로 남긴다.
    `verification-spec.md` LOC-004 문구를 구현 계약(명시 계정·인정
    verdict 목록·관측 이상은 실패)으로 동기화 + traceability 재지문.
  - 회귀: `test/post-listen-error.test.ts` 신설 — 9오라클 전부
    `server.emit("error", EMFILE)` 직접 주입(emit은 동기라 결정론적,
    리스너 0개면 그 자리에서 throw). 각 사이트에서 ①리스너가 정확히 영구
    1개만, ②journal에 도달, ③listening 유지, ④이름이 여전히 연결을
    받음을 검증; journal이 던지는 케이스(죽은 audit sink·죽은 onError)도
    emit을 탈출하지 않음. `platform-rpc.test.ts`에 NaN frameBytes 주입
    (생성자 throw가 emit 탈출·uncaughtException 대신 읽기 거절 + escaped=0),
    `egress-degradation.test.ts`에 onError가 adoption을 통과해 tenancy에
    도달하는 스모크, `extension-bridges.test.ts` 신설(실제 EADDRINUSE +
    죽은 stderr — 두 bridge 모두 wedge 없이 degraded resolve, inference
    bridge는 fallback retry가 실제 포트에 도달).
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification 레인(로컬 환경 없음). guest·omahostd 단위의
    in-situ 동작은 프로덕션 경계 리스너 + 단위 테스트 오라클로, 실제 fd
    소진 실험은 환경 의존이라 비결정론적이라 의도적으로 제외.

## 10. 지금부터의 실행 순서
0. ~~P0-8 강제 수단 미구현~~ — 구현됨: `owned-state` 아키텍처 규칙
   (scripts/architecture/rules/owned-state-rules.mjs)이 경로 기반 raw fs
   변경·plain ensure 헬퍼·OMA 루트 인자 관측을 프리미티브 소유자 밖에서
   금지하고, 면제는 사유가 적힌 맵 + stale 감지로 유지된다. §5 일곱 번째
   잔여 참조. Mac(ensureHostOwnedDirectory 경로)은 이 호스트가 Linux라
   실행 검증은 없고 구조 리뷰만.
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
