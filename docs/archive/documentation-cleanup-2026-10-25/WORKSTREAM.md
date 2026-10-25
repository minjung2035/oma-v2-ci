# OMA v2 작업 컨텍스트 (지속 문서)

> 현재 작업: DR46 모듈화 구현(2026-10-24). 최신 재개점은 [HANDOFF](HANDOFF.md),
> 실제 실행 판정은 [validation](implementation/validation.md)이 소유한다.
> 아래의 브랜치·작업 프로토콜·숫자는 작성 당시의 과거 컨텍스트이며 이번 작업의 실행 결과가 아니다.

> 이 문서는 대화 압축·재시작에도 작업 맥락이 유지되도록 현재 상태·기준·프로토콜을 기록한다.
> 갱신: feat/macos-hidden-vm @ `7f12b7c` 기준 작성. 상태가 바뀌면 이 문서도 갱신한다.

## 1. 현재 상태

- 브랜치: `feat/macos-hidden-vm` (메인 worktree `/home/dev/oma-v2`)
- 구현 브랜치 12개 (`impl/w1`~`w12`) 전부 머지 완료, 머지 독립 검증 = **faithful**
- 전체 스위트: **3403/3408** — 유일한 5 실패는 의도적 stale evidence 바인딩
  (review-closure V32A×2, DR27/V32A, production-inventory R38, consistency-decisions V01A)
- 머지 후 회귀 수정 커밋: `7f12b7c` (+ 그 이전 `49d6cbb` OMA_TOOL_SURFACE 배선 복원)
- review-ledger 상태: stale digest 5 + 미포함 신규 파일 22(packages/client/src/*, pi-compat/*,
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
  packages/protocol/src/alarm.ts로 이동).
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
- tool surface는 기존 packages/domain/src/tool-surface.ts + src/extension/tool-surface.ts
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
   위치: src/extension/ask-user-question.ts + packages/tui/src/ask-user-question/
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
  102 `.test.mjs` + 보조 파일 2개(`isolate-env.mjs` 테스트-환경
  프리로드·`pdf-fixture.mjs` PDF 생성 헬퍼; fixture는 후자 하나),
  npm tarball에는 테스트가 없어 git에서 가져옴), `runtime/`은 upstream `.ts` 전 모듈의 tsc 산출물(.ts 상대
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
  `packages/tui/src/ask-user-question/`(presenter + component), factory가
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
  `packages/domain/src/egress.ts`(이름/`*.suffix` 문법, authority parse, role 해석). 프록시는
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

- 2026-10-07 (전신성 부류 — post-listen 스캔 맹검증 잔여 정산): 직전 전수
  스캔의 맹검증이 지목한 네 잔여를 정산. ①누락된 vendored listen 경계 —
  `ui-server.js`(host server의 후보별 once-listener 재무장+성공 시 해제,
  sandbox proxy의 동일 once+off)와 `mcp-callback-server.js`(once-listener가
  성공 후에도 제거되지 않아 첫 post-listen 에러는 settled reject가 삼키고
  두 번째는 emit을 탈출)를 `OMA_DIVERGENCES` splice로 영구 리스너 +
  보호된 journal로 정산 — callback은 named `onStartupError`로 startup
  reject 계약을 유지하며 성공 시점에 정확히 그 리스너만 해제. runtime·
  manifest는 script 재생성물, `--check` → BUNDLE_CURRENT. ②`broker.ts`
  `cleanupError`의 `console.error`가 `listen`의 영구 리스너와
  `listenActor`의 run-revoke 경로 양쪽에서 동기 'error' emit 안에 도달
  — 죽은 stderr가 다시 emit을 탈출하던 것을 보호된 best-effort write로.
  ③cloc 계정(`production-inventory.mjs`): 루트 파일명 `header`/`SUM`/
  `nonCode`가 report 구조 멤버와 충돌해 구조체를 파일 row로 오독하던
  슬롯을 `CLOC_REPORT_STRUCTURE_KEYS`로 배제 — 모호 슬롯은 행이 아니고,
  실제 행은 `./`-철자 또는 nonCode verdict만으로 정직하게 계정된다.
  ④동기 emit 경계 잔여 — `inference-bridge.ts`의 'listening' emit 안
  재등록 가드(거절은 pre-listen이 설치한 unreachable provider 유지 +
  best-effort journal, unref·resolve는 도달), `inference-relay.ts`의
  `request`/`upgrade` 핸들러에 connect-proxy와 같은 emit 경계(non-Refusal
  재던짐이 `server.emit`을 통째로 탈출하지 않고 그 연결만 파괴·실패로
  계수 — 정책 거절과 구분).
  - 회귀: `mcp-bundle.test.ts`에 vendored emit 주입 오라클 2종(콜백 서버
    두 연속 에러 전부 journal 도달·listening 유지·uncaughtException 0,
    host+proxy 각각 흡수 — `Server.prototype.listen` 캡처로 클로저 내부
    server에 도달), `post-listen-error.test.ts`에 broker 죽은-저널 오라클
    (emit이 저널 자체 실패를 흡수 + 공유 싱크 직접 호출),
    `inventory-evidence-split.test.mjs`에 구조키 충돌 fail-closed 오라클
    (구조 멤버가 파일 row로 통과하지 않음 — 미수정 시 phantom 계정으로
    조용히 통과되던 방향이 실패로 바뀜), `extension-bridges.test.ts`에
    'listening' emit 안 거절된 재등록이 unreachable provider 유지 +
    resolve 도달 + journal 기록, `inference-relay.test.ts`에 non-Refusal
    재던짐이 연결만 파괴·failed 계수·escaped=[] — 전부 fail→pass 확인
    (수정 전 되돌림에서 각각 실패/탈출/phantom 계정).
  - NOT_RUN: 직전 항목과 동일 레인 — macOS native·systemd·
    kernel/powercut·provider credential·release qualification·실제 fd
    소진 주입(환경 의존 비결정론 — 동기 emit 주입이 결정론 오라클).

- 2026-10-07 (UX-37 — 운영 읽기가 진단 예산을 공유 차지하던 결함 정산):
  `LedgerReader.all`이 행마다 `DIAGNOSTIC_READ_LIMITS`(10,000행/32MiB)를
  과금해 운영 흐름(상태 표시·runner 대기열·principal relay·recovery)이
  society의 행 수만으로 `LIMIT_EXCEEDED`로 거절되던 결함(§2 1·9·13)을
  정산. 진단 스냅샷 상한은 유지 — `readDiagnosticSnapshot`이 같은 상한으로
  계속 거절함을 대조군으로 고정.
  - 변환: 카운트는 집계(`pendingDeliveryCount` → `COUNT(*)`), 대량 열거는
    rowid keyset 스트림(`pendingDeliveryRows` — `MAX(rowid)` 동결 상한·
    128행 닫힌 페이지·yield 후 진행 — 다음 수용은 다음 순회로 귀속),
    나머지 운영 열거(`agents`·`subscriptions`·`submissions`·`attestations`·
    `recoverableIds`·`operationDeliveries`·`pendingWorkRows`·`preparedBatches`·
    batch 링크드 목록)는 예산 없이 완전 수집 — 디코딩·관계 검증
    (소유자·리니지·매니페스트↔배치 멤버·수신자 스냅샷)은 행마다 유지.
    `runner.pending`·status·relay는 카운트 경로로 전환해 목록을 만들지 않음.
    조회 실패는 빈 답이 아니라 STORE_CORRUPT로 전파 — 어떤 경로도 `[]`로
    승격하지 않음. 같은 컬렉션 안 재읽기는 `ReadScope` 메모이즈로 동기
    창 일관 유지.
  - 회귀: `operational-read-budget.test.ts` 신규 G02-ledger-r2 3종 —
    ①10,001 구독·10,300 운영(10,000 unbatched + 300 준비 배치 링크)·
    10,500 배달 fixture를 shipped DDL+shipped INSERT로 시딩해 운영 읽기
    전수(count·수령인·rowid 순서·복구 id·pendingWork·principal relay
    목록·runner.pending 집계·배치 상세/링크드)가 완전·일관함을 단언하고
    같은 상태의 diagnostic snapshot은 `LIMIT_EXCEEDED`로 거절(음성 대조).
    ②준비 실패 DB에서 5개 읽기 진입점이 전부 throw(빈 답 없음).
    ③keyset 의미론 — 순회 중 새 수용은 이번 순회에 나타나지 않고
    삭제분은 재방문하지 않으며 다음 순회가 새 행을 봄.
    fail→pass 증거: 직전 커밋(HEAD)을 별도 worktree에서 tsc로 빌드해 같은
    시드(10,001 구독·10,001 배달)를 넣으면 `allSubscriptions`·
    `pendingDeliveries`·`recoverableOperations`·`pendingWorkRows` 전부가
    `LIMIT_EXCEEDED`로 throw — 수정 후 같은 fixture의 ①이 완전 결과로 통과.
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.

- 2026-10-07 (UX-38 — 툴 표면의 숫자 상한·고정 마감이 유효 처리를 크기/시간만으로
  차단하던 부류 정산): client/extension 경계의 남은 용량·시간 상한을 전수 정산
  (§2 1·9·13). 원칙: 크기 거절은 완전 보존+명시된 프리뷰(spool-to-disk)나
  파생 bound로, 고정 경과 마감은 진행-리셋 정체 감지로 — protocol wire bound와
  무결성·정체성 검사는 유지.
  - 변환 6종: ①`packages/client/src/index.ts`의 OUTPUT_BYTES=1MiB 응답 거절 제거 —
    완전 인코딩 후 inline 경계 이하는 그대로, 초과는 `packages/storage/src/output-spool.ts`
    (신규: caller의 OMA state 하 `output-<sha256>.txt` digest명 publishNoReplace,
    동명 타 bytes는 덮지 않고 unique fallback)에 통째 보존하고 `[preview]`+
    바이트 수+경로+request key 회답; 스풀 실패 시에도 프리뷰+실패 사유 명시.
    `client/runtime.ts` 포트 + `runtime/client-runtime.ts` 결선.
    ②`packages/client/src/transport.ts` 영수증 청크 — 매 `operation.read`가 새
    관측 창을 열어(청크마다 `performance.now()+observationSeconds`) 성공 수신이
    진행으로 리셋; 느린 링크의 다청크 영수증은 완료, 멈춘 broker만 종료.
    ③`src/extension/mail-tools.ts` — 저장 메시지 bound(`storedMailBound`)와
    `/inbox.md` 파생 인덱스 bound(헤더+행+리비전 경로 항으로 선형 산출) 분리;
    send 스키마 수신자는 `OMA_MAIL_ADDRESSES`(설정값=wire 실제 64)로 — 32
    고정 제거. 생산자 `pi-spawn-plan.ts`·`tui/session.ts`에 env 결선+limits
    pick에 `addresses` 추가, golden 32→64.
    ④`src/extension/contained-search.ts` — 결과 1MiB 거절과 60s 마감 제거.
    자식이 라인 프레임(`{p:"d"}` 스냅샷명 선언·`{p:"c"}` 복사 진행·
    `{p:"s"}` heartbeat — worker 스레드 발신이라 engine 번들의 동기
    require나 긴 readSync가 main을 막는 동안에도 생존 증명; SIGSTOP 등
    프로세스 정지는 heartbeat도 정지하므로 침묵은 여전히 stall)을 내고,
    부모는 수신 바이트마다 관측 창을 리셋 — 침묵만이 grace 후 process-group
    kill+선언된 스냅샷 부모 sweep로 귀결. upstream 렌더러 숨은 상한(50KiB
    출력·500자 줄·caller 미요청 기본 match/result 수)은 감지 시 같은 frozen
    snapshot에 완전 재렌더(`completeSearchText` — caller의 `limit` 의미는
    유지). 완전 답이 inline 경계를 넘으면 `oma-search-result-<uuid>.txt`에
    통째 기록+경로·바이트 명시.
    ⑤`src/extension/contained-files.ts` — 128단계 깊이 거절 제거.
    소스는 레벨당 descriptor 보유(fstat 기준 inode 추적, 경로 재지정 불가),
    목적지는 사설 mkdtemp 경로 쓰기 — 깊이가 fd 수도 소모하지 않음.
    quota·nlink==1·`.git` 제외·abort 검사·cleanup 유지, 항목/청크마다
    progress 콜백.
    ⑥`OMA_WORKSPACE_BYTES` — Resident(`pi-spawn-plan`)·Principal
    (`tui/session`) 생산 경로 둘 다 결선 확인; 미설정 시 fail-closed는
    유지(quota 없이 쓰면 quota가 부정직 — `contained-tools.ts` 주석).
  - 구조 정산: surface 규칙상 engine `import()`/`tool.execute`는 child `-e`
    스크립트 경계에 유지(모듈 AST에 두지 않음 — `searchChildBody`는 스냅샷
    수명주기+프레임, `finishSearchResult`는 숨은-상한 감지·완전 재렌더·
    스풀 — 둘 다 단위 시험 가능), `fenceExemptSpawnOwners`에
    `completeSearchText` 등록, `OUTSIDE_STATE_TREE`·`OWNED_STATE_EXEMPTIONS`에
    사설 tmp 트리 사유 등록, `kernel-zones`에 `packages/storage/src/output-spool.ts`
    (K2), `durable-boundaries.json`에 `#spoolOutput` 경계 등록(sigkill publish
    행렬+logical 재생 참조).
  - 회귀: `client.test.ts` — 스풀 프리뷰+스풀 실패 보고+digest명 중복/변조
    파일 오라클+영수증 청크 진행 리셋(50ms 창·40ms 청크 4개+ 완료).
    `delivery-notice.test.ts` — 저장 bound 초과 본문·파생 bound 넘는 인덱스·
    `OMA_MAIL_ADDRESSES` 기본 64/설정 7. `contained-tools.test.ts` — 숨은
    walker 기본(150 match)·숨은 result 상한(1,100 path)·긴 줄+대출력 완전
    렌더·1.3MiB 결과 스풀 명명·SIGSTOP 자식 그룹+스냅샷 sweep·1.5s heartbeat
    자식 완료·180단계 복사. `tool-schema-golden` 64 재결박. fixture 한도
    객체에 `addresses:64` 추가(model-scope·p0-review4/6·resident-confinement·
    resident-sandbox-live·session-resume·tui-integration-defects·
    fixtures/resident).
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.

- 2026-10-07 (UX-38 맹검증 정산 — 직전 커밋의 변환이 정직성·소유권·도달성을
  어기던 잔여 6건): 위 정산을 맹검증한 결과, 크기·시간 상한의 변환 자체가
  새로운 거절·묵살·무소유를 만들어 낸 결함 6건(F1–F6)을 정산(§2 1·9·13,
  P0-4). 원칙 재확인: 유효한 사용자 작업을 막을 수 있는 상한은
  거절·절단하지 않되, 변환은 정확성·정직성·소유권을 보존한다.
  - F1 완전 결과 도달성 — `oma-search-result-*.txt`가 `os.tmpdir()`에 쓰여
    host/밀봉 engine의 contained read/grep/find/ls가 도달할 수 없고
    `details.complete`에 소비자가 없어 완전 답이 사실상 프리뷰로 잘렸다.
    이제 완전 답은 result envelope로 pipe를 건너 부모가 직렬화된
    contained writer(quota 판정·직렬화·guard 승인 동일)로
    `<workspace>/.oma/search-results/oma-search-result-<uuid>.txt`에
    통째 기록하고 `details.complete={path,bytes}`와 `[preview]` 마커가
    승인된 경로를 명시한다. 스풀이 못 받으면(quota·read-only 표면)
    절단 없이 완전 답이 사유와 함께 inline으로 회귀한다.
  - F2 heartbeat≠진행 — 임의 수신 바이트가 유일한 정체 창을 리셋해
    worker 스레드의 `{p:"s"}`가 멈춘 main 스레드를 무한히 살려 두었다.
    이제 관측은 두 창: 임의 바이트가 리셋하는 침묵 창(정지·사망·출력
    차단은 한 창 안에 회수)과 비-heartbeat 프레임·비프레임 바이트만이
    리셋하는 진행 창(`HEARTBEAT_ONLY_WINDOWS=10` × stall 창 — 왕성하지만
    유한). 자식은 `{p:"r"}` 완전-렌더 진행과 engine `onUpdate`의
    `{p:"w"}`를 새로 보낸다. heartbeat만의 자식은 경계 안에 회수되고,
    성긴 실진행은 경계를 넘어 생존한다. 헤더의 "heartbeat만으로
    D-state 감지" 주장도 제거.
  - F3 외부 kill 스냅샷 잔여 — 선언된 스냅샷 sweep이 `stop()`의 지연
    killer에만 달려 외부 SIGKILL/OOM `close`가 `oma-search-*` 사본을
    남겼다. 이제 `close` 핸들러가 무조건 sweep한다(정상 종료·killer
    경로와 멱등).
  - F4 스풀 소유·보존 정책 — workspace 검색 스풀은 workspace 소유자의
    보통 파일(quota 과금·guard 승인, OMA가 자동 sweep하지 않음 — 결과가
    이름을 명시하고 모델·사용자가 지울 수 있음), client 출력 스풀은
    caller 소유(OMA는 caller가 아직 필요로 하는지 알 인덱스를 갖지
    않으므로 GC 없음 — caller가 비울 수 있고 durable request·ledger
    사실에 무영향). `output-spool.ts` 헤더가 둘의 정책을 명시한다.
  - F5 목적지 fd 좁히기 — 목적지 복사가 `join(parent,name)` 경로 문자열을
    써서 `O_NOFOLLOW`가 leaf만 지켰고 같은-uid 경주가 중간 목적지
    디렉터리를 symlink로 교체할 수 있었다. 이제 목적지도 레벨마다 보유한
    디스크립터에 `entryAt(parent_fd,name)`으로 생성·개방하고
    EMFILE/ENFILE은 명시된 workspace 거절로 변환한다 — OS 디스크립터
    테이블이 유일한 깊이 bound.
  - F6 잔여 — heartbeat worker에 명시적 `error` 리스너 장착;
    `spoolOutput`의 동기 write/fsync가 의도(표시 경로의 내구성 약속,
    비동기는 같은 I/O를 옮길 뿐)임을 헤더에 명시.
  - 구조 정산: `state-tree-rules`·`owned-state-rules`·`architecture-owners`
    면제·소유자 문구를 새 동작으로 갱신 — F5로 목적지마저 보유
    디스크립터로 쓰면서 `contained-files.ts`의 owned-state 면제 자체가
    stale이 되어 제거(규칙이 다시 파일을 지킴).
  - 회귀·fail→pass: `contained-tools.test.ts`에 6종 추가·2종 갱신 —
    스풀 경로가 guard 판정(read/grep/find/ls 전부 승인)·실제 tool
    호출(ls·find·read·grep)·quota 과금으로 증명되고, quota 거절 시
    완전 답이 사유와 함께 inline; heartbeat-only 자식이 경계 안에
    회수(컴파일 산출물을 heartbeat=진행 구 동작으로 되돌리면 30s
    타임아웃 실패로 대조); 400ms 간격 성긴 진행이 경계를 넘어 생존;
    외부 SIGKILL 자식의 선언 스냅샷이 sweep(구 동작 되돌림 시
    `oma-search-*` 잔여로 실패 대조); 목적지 디렉터리 중간 교체 경주에서
    보유 fd가 실 디렉터리를 계속 쓰고 심은 link를 넘지 않음(구 경로
    기반 되돌림 시 1,991 파일이 link를 넘어 실패 대조).
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.

- 2026-10-07 (UX-38 맹검증 2라운드 잔여 — contained-search 스풀/스톨 정산의
  잔여 결함 2건): 직전 UX-38 정산을 맹검증한 결과 남은 결함 2건(F-1·F-2)을
  정산(§2 1·9·13, P0-4·정직성).
  - F-1 선언-전-생성 — `withSearchSnapshot`가 `mkdtempSync`로 만들고 나서
    `named?.()`가 `{p:"d"}`를 `process.stdout.write`(비동기 버퍼)로 보냈기
    때문에, mkdir과 첫 yield 사이에 SIGKILL/SIGSTOP된 자식은 아무도 이름을
    모르는 `oma-search-*`를 남겼다(실제 suite flake 관측 — CPU 포화
    상태에서 `oma-search-FFrmEK` 잔여). 이제 헬퍼가 각 후보 이름을
    `oma-search-<uuid>`로 생성해 `named?.(baseName)`를 mkdirSync **전에**
    호출하고, EEXIST는 새 이름을 다시 선언한다 — 자식 쪽 `named`는 동기
    `writeSync(1, …)`라 선언 바이트가 mkdir 전에 이미 파이프에 들어가므로
    "존재 ⇒ 선언됨"이 성립한다(pipe 바이트는 'close' 전에 'data'로 보장
    전달). 선언이 실패하면 생성 전에 스냅샷이 실패한다 — 선언 안 된
    사본은 존재할 수 없다. 부모 쪽 `close` sweep은 선언된 이름을 그대로
    소비한다. `named`는 "통지"가 아니라 "선언"으로 계약이 바뀌었다 —
    throw는 실패 폐쇄, swallow 없음.
  - F-2 EMFILE/ENFILE 정직성 — `descriptorRefusal`이 목적지 open만 감싸고
    `readdirSync`·소스 `openSync`·`openDirectoryWithin`의 EMFILE/ENFILE은
    raw로 새어나가 "contained search failed; no workspace result was
    returned"로 평탄화됐다(실측: `ulimit -n 200`+300단계에서 raw
    `EMFILE: … scandir '/proc/self/fd/198'`이 사유 없이 통과). 이제
    `withSearchSnapshot` 본문을 `searchSnapshot`으로 옮기고 공개 경계에서
    module-scope `descriptorRefusal`로 EMFILE/ENFILE →
    `WorkspaceRefusal("search snapshot ran out of file descriptors")`로
    변환한다 — 거절 자체는 이미 fail-closed였고, 사유가 정직해졌다.
  - 구조 정산: `state-tree-rules`의 contained-files 면제 문구를
    "mkdtemp 트리"에서 "생성 전에 이름이 선언되는 `oma-search-*`
    디렉터리"로 갱신(면제는 계속 유효 — 모든 변경이 `entryAt`/held
    descriptor 경유). `randomUUID`/`writeSync` 추가는 owned-state·
    surface 규칙의 raw-path 금지에 걸리지 않음(entryAt 인자·fd 쓰기).
  - 회귀·fail→pass: `contained-tools.test.ts`에 5종 — 선언-전-생성 계약
    (구 코드에서는 생성 뒤 통지 + announce 실패 swallow로 실패),
    EEXIST 재선언(첫 선언명을 선점시켜 두 번째 새 이름으로 착지 확인),
    최초 관측 시점 SIGKILL sweep(동기 폴링으로 첫 관측 즉시 kill — 구
    산출물 되돌림 시 `oma-search-*` 잔여로 3/3 실패 대조), wire 선언이
    fs 효과보다 먼저 도달(실제 `searchChildBody`를 파이프 위에서 구동해
    관측된 디렉터리는 항상 이미 선언됨), fd 고갈 깊이 트리가
    "file descriptors" 거절 문구로 거절(ulimit -n 96 + 400단계; 구
    산출물에서는 평탄화된 generic 실패로 실패 대조).
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.
- 2026-10-07 (UX-38 잔여 — bundled pi-lsp 표면의 숫자 상한·고정 마감 변환):
  같은 결함류(§2 1·9·13)가 code_intel LSP 표면에 남아 있어 정산했다.
  원칙은 같다 — 유효한 처리를 크기/시간만으로 거절·묵살하는 숫자 bound는
  제거하거나 비차단 메커니즘으로 바꾸고, 엔진 보호상 bound가 필요하면
  정직하게 보이고 한 서버의 초과가 다른 요청·프로세스를 죽이지 않는다.
  - 어댑터(`src/extension/lsp-tools.ts`): `LSP_FILE_BYTES`(1MiB)·
    `LSP_MAX_FILES`(100)·`LSP_MAX_PATHS`(64)·`LSP_MAX_SERVERS`(64)·
    `LSP_MAX_DIAGNOSTICS_*` 거절과 호출당 300s aggregate deadline 전부
    제거. caller `limit`는 그대로 caller 선택으로 존중하고, 미지정이면
    수집된 전체 파일 집합이 답이다(파일 수는 항상 결과 details에 명시).
    `timeout`은 1s floor만 남기고 120s 상한을 제거 — caller가 고른
    예산은 caller의 것. aggregate deadline은 진행-리셋 stall 창으로
    교체: vendored client가 inbound 프레임 청크마다 `omaOnInboundFrame`
    싱크를 호출하고, 이 호출이 소유한 hardened adapter의 프레임만이 창을
    리셋한다 — 아직 말하는 서버는 호출 길이와 무관하게 생존하고, 침묵만이
    회수된다. 창은 호출의 per-request timeout보다 절대 좁지 않다
    (caller가 고른 더 긴 요청 예산을 깎지 않음).
  - vendored divergence(`scripts/vendor-pi-lsp.mjs` → `runtime/`):
    oversized inbound frame은 헤더 파싱 시점에 그 프레임이 답하는 요청만
    거절(sniffed id, 없으면 유일 pending 요청)하고 본문은 bounded
    discarder로 버린 뒤 wire를 프레임 끝에서 재정렬 — `#fail`·서버 kill
    없음. 구분되지 않는 프레임(notification·id 미상)은 drop 카운터만
    올려 나중 에러 꼬리에 `oma bounds:`로 명시. 프레임 경계 자체가 없는
    garbage 누적도 버퍼를 비우고 pending 거절로 끝낸다 — 서버는 산다.
    shutdown은 discard 진행 중엔 handshake를 건너뛰고 close(믿을 수
    없는 wire의 handshake 금지), discard 완료 뒤엔 upstream handshake
    그대로. push 진단은 per-file 개수·메시지 길이 bound가 throw 대신
    `omaFlaggedDiagnostics` 절단+marker(`[oma: N more diagnostic(s)…]`,
    `code:"oma/truncation"`) — tail marker 재인식으로 pull 경로의 이중
    flag가 drop 수를 거짓 보고하지 않고, 메시지 절단 tail 패턴으로
    재절단이 원본 길이를 훼손하지 않는다. tracked-URI bound 초과는 새
    문서 publication만 drop+count하고 해소 리스트에 marker로 명시.
    code-action 개수 상한(256)은 제거 — resolve 루프는 요청당 timeout과
    진행-리셋 창이 이미 묶는다. workspace-edit 수집(count·newText 바이트)
    거절은 유지: 절단된 edit 목록은 오염된 fix를 날조하고 무제한
    materialization은 엔진 OOM — 둘 다 거절보다 나쁘다. 그 거절도 그
    요청 하나만, 서버·다른 요청은 생존. `collectPath` 재귀+깊이 bound는
    명시 스택 반복으로 — 깊은 트리도 통째 수집, overflow 없음. stderr는
    64KiB bounded sample+truncation marker 유지.
  - B2 잔여 동승: `contained-files.ts`에 `errnoCode` 가드+공개
    `isDescriptorOverrun` — 비객체 throw(null·string·number)에서 `.code`
    읽기 자체가 TypeError가 되던 경로를 닫고 EMFILE/ENFILE 분류 일관화.
    `contained-search.ts`가 스냅샷 경계와 엔진 walker 양쪽의 디스크립터
    고갈을 같은 `search snapshot ran out of file descriptors` 명시
    거절로 매핑(재수출)하고, 선언명 선점-EEXIST-자식 사망 조합의 남은
    sweep 대상 모서리를 헤더 주석으로 기록(코드로 닫지 않고 사유 명시).
    `contained-tools.test.ts`의 EEXIST 교체 경주 테스트는 cleanup 등록을
    await보다 앞으로 옮겨 planted `oma-search-*`가 실패 후에도 잔여하지
    않게 한다.
  - 회귀·fail→pass: `lsp-bundle.test.ts` + `lsp-upstream.test.ts` 총
    61종 — hostile fixture `lsp-hostile-server.mjs`에 `push-uri-flood`·
    `slow-stages`·`oversized-then-serve` 시나리오 추가. 증거: push/pull
    진단 홍수·초대형 메시지는 marker+count로 절단된 채 해소(976 dropped
    명시), 4097 문서 publication은 5 drop을 marker로 명시, oversized
    frame은 요청만 거절하고 같은 client의 후속 요청이 정상 응답(wire
    재정렬·서버 생존), 미완성 본문도 빠른 종료, 300 code-action 전부
    resolve, `slow-stages`(요청당 ~600ms×3 → ~1.9s)가 1200ms stall 창을
    넘어 완료(진행 리셋 증명), 침묵 서버는 ~1s 안에 timeout/stall로 회수,
    121파일 무제한 수집·80개 paths·71개 configured server 전수 보고,
    1.2MiB 파일 `lsp_fix` 통과.
  - 정직 기록: `timeout`의 120s 상한 제거는 시간상 직접 관측 불가(130s
    대기 금지) — caller 선택 timeout <120s의 정확한 효력과 floor(1s)만
    회귀로 묶고 상한 제거 자체는 코드에서 입증. stall 창은 설계상
    per-request timeout보다 좁아지지 않으므로 요청 pending 중 침묵은
    항상 request timeout이 먼저 잡는다 — stall은 비-요청 침묵의
    backstop이며 그 사실을 테스트 명칭과 코드 주석에 그대로 남겼다.
  - vendor `--check` BUNDLE_CURRENT (48 files, sha256 `82a5999a…42fa`), build·
    typecheck·architecture gates·focused contained/lsp suite PASS.
    manifest `generated.divergences`와 번들 다이제스트는 재생성 산출물.
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.
- 2026-10-07 (UX-38 잔여 2차 — pi-lsp 런타임의 비차단·정직성 정산 F-4·F-5·
  F-1·F-2·F-3·F-6): 맹검증 잔여로 남은 bounded-but-dishonest 경로 6건을
  정산했다. 전부 `OMA_DIVERGENCES` 스플라이스로만 `runtime/`을 재생성
  (scripts/vendor-pi-lsp.mjs), `--check` BUNDLE_CURRENT 유지.
  - F-4 didOpen backpressure — `didOpen`/`notify`/`#send`가
    `stdin.write()`의 반환을 돌려주고, runner의 open 루프가 `false`일 때
    `didDrain()`을 await — 큰 코퍼스가 서버가 읽는 속도보다 빠를 때
    프로세스 메모리에 통째로 쌓이지 않는다. `didDrain()`은
    'drain'에 resolve, stdin 'error'/'close'에 reject(`close()`가 자식을
    죽이므로 caller abort도 settle), 그리고 요청 예산(`#timeoutMs`)으로
    타임아웃 — drain 안 되는 서버는 정직한 bounded 실패지 행이 아니다.
    drain/write 실패는 runner가 `throwIfAborted`로 caller abort로
    재보고한다.
  - F-5 per-file settled — diagnostics 팬아웃이 `Promise.all` 대신
    `Promise.allSettled`: 한 파일의 timeout/실패는 그 파일의 `oma/error`
    marker(`diagnostics failed for this file: …`)로 강등되고 답한 파일은
    결과를 지킨다. 전체 호출 거절은 오직 caller abort뿐. 어댑터 측
    route 루프도 같은 규칙 — 한 route의 실패는 그 route 절의 명명된
    오류로 강등, 모든 route가 실패하면 여전히 거절.
  - F-1 marker 회계 — `omaFlaggedDiagnostics`가 꼬리의 **모든** oma/
    marker를 벗겨 세기 — [truncation, URI-drop] 두 marker가 붙은 리스트를
    다시 flag할 때 첫 marker를 실진단으로 새어 "1 more" 허위 drop을
    만들고 진짜 marker 둘을 잘라내는 버그 제거; 갱신 절단은 기존 marker를
    꼬리에 보존해 카운트가 사라지지 않는다.
  - F-2 URI-drop 가시성 — `#withDroppedUriFlag`가 settle 경로뿐 아니라
    pull early return에도 적용되고, publish waiter timeout 에러가
    `#formatDropped`로 drop 수를 꼬리에 단다 — drop이 더 이상 빈 응답/
    타임아웃 경로에서 사라지지 않는다.
  - F-3 oversized 프레임 귀속 — id 스니핑이 실패한 프레임을 유일 pending
    요청 탓으로 돌리는 fallback 제거: sniffed id가 실제 pending과 매치될
    때만 그 요청을 거절하고, 불일치 프레임은 drop+카운트만 — 대형
    notification이 진행 중인 요청을 죽이지 않는다. 요청 자체의
    timeout/error 꼬리에 drop 수가 여전히 보고된다.
  - F-6 문서 정직성 — validation.md가 주장하던 marker 비전달·이중 flag
    회귀를 실제 테스트로 추가(`marker-context` fixture가 codeAction
    context의 진단 수를 resolve 편집으로 되돌려 증명 — marker 제외
    확인), pull-uri-flood·push-flood-uri-flood·uri-flood-timeout·
    oversized-notification·partial-answers·slow-drain·stdin-stall
    시나리오 신설.
  - 회귀·fail→pass: `lsp-upstream.test.ts` 30/30·`lsp-bundle.test.ts`
    전종 PASS — 신규 오라클 17종 중 14종은 구 런타임/구 어댑터에서 실패
    확인 후 통과(backpressure reject→abort 보고·never-drain
    bounded·drain 완주·per-file degrade·route degrade·all-fail 거절
    유지·이중 marker·pull/timeout drop 카운트·notification 귀속);
    나머지 3종은 구 동작 자체가 없어 대조할 fail-before가 없는 회귀
    가드(marker-context 등 신규 시나리오)다.
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.

- 2026-10-08 (UX-38 잔여 3차 — 네트워크/프로세스 표면의 용량 거절·고정 마감
  변환): 같은 결함류(§2 1·9·13)를 런타임 네트워크 경계와 프로세스
  실행층에 적용했다. 원칙은 같다 — 용량만으로 유효 요청을 거절하는
  bound는 FIFO 대기(backpressure)로 바꾸고, 총 경과 마감은 진행이
  관측되는 곳에서는 진행-리셋 침묵 창으로, 관측이 불가능한 곳(비동기
  runner 외부·VM handshake/drain·프레임 소스 바이트 부재)에는 관대한
  상한+정직한 실패로 둔다.
  - 용량→FIFO 작업 집합 5곳: ①`connect-proxy.ts` — `CONNECT_TUNNELS`(4)
    초과 CONNECT는 503 대신 대기열에 들어가고 활성 터널이 닫히면 순서대로
    grant; 대기 중 클라이언트 close(이미 닫힌 소켓 포함)는 클레임 철회,
    shutdown은 대기·활성 전부 소멸. ②`inference-relay.ts` — placeholder당
    `concurrent` 초과 요청은 `observe().queued`로 노출되는 큐에 서고
    `accepted`/`inFlight`는 grant 시점에만 계수; 대기 중 close는 철회.
    ③`host/egress.ts` — run당 터널 작업 집합이 차면 `egress.connect`
    요청을 프레임까지 읽어 큐에 두고, 터널 close·run release·service stop이
    대기·활성을 정직히 회수(BROKER_UNAVAILABLE). ④`guest/egress.ts` —
    빈 pool은 더는 연결 실패가 아니라 `EgressPool.wait(client)`로 기다리고
    다음 주차 연결이 그 클레임을 채움; 클라이언트 close·pool close는
    대기자를 정직히 끝낸다. ⑤`egress-forwarder.ts` — engine 연결도 같은
    규칙(작업 집합 초과 시 FIFO, 떠난 engine의 클레임 철회).
  - 진행-리셋 침묵: `platform/rpc.ts`의 `readLeadingFrame`은 수신 바이트마다
    관측 창을 재장전(총 경과 아님 — 느린 발신은 완주하고 침묵만 회수),
    `process/command.ts`에 `silenceMs`·stdout/stderrSpool 추가·
    `async.ts`는 stdout/stderr 데이터마다 침묵 타이머 리셋 + 무출력 창
    만료는 `"stalled"` 관측(`policies.ts`가 DEADLINE_EXCEEDED로 매핑 —
    timeout·spawn failure와 구분). sync runner는 진행을 관측할 수 없어
    `silenceMs`를 TypeError로 명시 거절(정직성), spool은
    `O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW` 직결 fd로 스트림을 우회하지
    않고 통째 보존. relay의 provider 창도 업로드/다운로드/응답 진행으로
    리셋한다.
  - 대출력 spill: `project-snapshot.ts`·`host/project.ts`의 git 실행은
    stdout/stderr를 per-call 임시 스풀 파일에 통째 쓰고 메모리에는 bounded
    head만 유지 — 저장소 크기 출력이 in-memory 상한을 넘어도 거절되지
    않음. `canonical-command.ts`의 GITLINKS_OBSERVATION_BYTES는
    256MiB로 상향+문서화. `guest/archive.ts`의 tar는 `--checkpoint=1024`
    진행 로그를 stderr로 내고 침묵 창(10분)·native-timer 상한(0x7fffffff)
    조합 — 진행하는 archive는 완주하고 침묵만 회수.
  - 의도적 유지: handshake/drain/health/hung/restart 상한(host
    lifecycle·service의 MAC-320/330/331 자원 안전 bound — 진행을 관측할
    수 없는 VM 상태의 경계), CONNECT authority-form/443·allowlist·
    공인주소 screen·pin·audit·frame byte bound·tripwire·INF-004/007 전부.
  - 회귀·fail→pass: `r37-async-process.test.ts`에 침묵 리셋·stalled
    분류·async spill 통째 보존·spill+침묵·sync silence 거절·sync
    descriptor-direct spill 6종 추가. `egress-connect.test.ts` —
    tunnels=1에서 두 번째·세 번째 요청 큐잉·닫힌 클라이언트 철회·slot
    해제 시 grant. `inference-relay.test.ts` — observe().queued 노출,
    한도 초과 요청이 앞 요청 완료 뒤 성공, 대기 클라이언트 close 시
    provider 호출 0. `platform-egress.test.ts` — run 터널 4 활성+5번째
    큐잉→close grant→burst 5개 전부 성공, run release가 대기 요청을
    BROKER_UNAVAILABLE로 회수, 빈 pool 대기→fill 충족·waiter close 철회,
    forwarder 작업 집합 큐잉+떠난 engine 철회+grant. `egress-observation-
    deadlines.test.mjs` — readLeadingFrame이 청크 단위 진행으로 리셋됨을
    대조. 구 오라클은 용량 503/BROKER_UNAVAILABLE 거절을 기대하던 부분이
    있어 큐잉 의미로 갱신했다.
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.
- 2026-10-09 (UX-38 맹검증 정산 — 프로세스 스풀 fd 누수·동일 스풀 경로 거절·
  LSP 오라클 결정화):
  - F-1 `runProcessSync` 부분 실패 fd 누수: 두 spool open이 invoke의
    try/finally 밖에 있어 두 번째 open(ENOENT/EACCES/ELOOP/EMFILE) 실패 시
    첫 fd가 영구 누수됐다(재현: 실패 호출당 fd +1). 두 번째 open을 전용
    try로 감싸 실패 시 첫 fd를 닫고 open 자신의 오류를 재던지는 방식으로
    수정 — open 실패를 spawn-failed 관측으로 접지 않아 호출자 조건 오류의
    신원(path·syscall)을 보존한다. 회귀: 유효 stdoutSpool+ENOENT
    stderrSpool을 반복 호출해 /proc/self/fd 증가 없음을 단언(수정 전 16회
    호출에 fd 23→39).
  - F-2 `stdoutSpool === stderrSpool` 미거절: 같은 경로를 두 스트림이
    열면 나중 O_TRUNC이 먼저 쓴 스트림을 지우고 두 관측이 같은 파일을
    가리켜 무소음 손실+허위 durable fact가 됐다(재현: sync stdout 64B가
    stderr 64B로 덮여 소실). `validateCommand`가 동일 문자열을 TypeError로
    거절 — 두 runner 모두를 관통한다. 다른 철자의 동일 파일(alias:
    `..`·경로 중간 링크)은 순수 계약이 path-module 능력을 갖지 않으므로
    호출자 책임으로 문서화했다 — realpath 비교는 순수성 위배+TOCTOU라
    채택하지 않음.
  - O5 `lsp-upstream.test.ts` "both markers survive" 불안정 오라클:
    부모 `3f735a0b`에서도 5/8 실패하던 선재 flake. 근본 원인 —
    `push-flood-uri-flood`가 didOpen에 ~930KB/4,102 프레임을 한 번에
    쏟는데 클라이언트의 settle 타이머(diagnosticsSettleMs 30ms)는 같은
    키 발행에서만 재장전되므로, flood 도착·파싱이 30ms를 넘으면 두 번째
    발행 전에 settle이 발화해 drop 계수 완료 전 리스트를 resolve한다
    (관측: 1025 vs 1026 — URI-drop 마커 누락 또는 부분 카운트). 변동
    자체는 "도착한 만큼만 정직히 보고"하는 올바른 동작이지만 검증 대상은
    완료 상태의 마커 회계이므로 fixture를 결정화: 시나리오를 pull 가능하게
    전환(PULL_SCENARIOS 진입 + 진단 요청에 `items: []` 응답)해 pull
    응답을 FIFO 장벽으로 사용 — 응답이 처리될 때 모든 push 프레임이 이미
    저장·계수됨이 wire 순서로 보장되고, `pullDiagnosticsGraceMs`로 빈 응답이
    published-diagnostics 대기로 이어져 settle이 완료 상태를 합성한다.
    `push-uri-flood`도 같은 부류의 경합(100ms grace 창)을 갖고 있어 같은
    장벽으로 전환했다. 증거: 대상 테스트 8/8 + 병렬 경쟁 12/12 + 파일
    전체 30/30 × 6회 전부 PASS.
  - O5 후속 — 같은 flake의 두 번째 표면(`lsp-bundle.test.ts`): 전체 suite
    최초 실행에서 BL1/F-1이 URI-drop 마커만 보고해 실패(파일 절단 마커
    부재). bundle 표면의 `hostileWorld` 호출이 grace를 넘기지 않아 pull
    응답이 flood 처리 전에 돌아오는 같은 경합이었다 — 두 hostile 시나리오
    호출(`push-uri-flood`·`push-flood-uri-flood`)에
    `pullDiagnosticsGraceMs: 250`을 결박해 upstream 표면과 같은 장벽을
    공유하게 했다.
  - O5 연장 — `lsp-bundle.test.ts` "truly silent server"의 resolve-or-reject
    경합: `lifecycle-hang-textDocument/diagnostic`은 pull 요청을 hang하는데,
    요청 타임아웃(바닥 1000ms)이 stall 창(`max(callStallMs, timeoutMs)` =
    같은 1000ms)보다 먼저 발화하면 `Promise.allSettled`가 그 거절을
    파일별 oma/error 마커로 강등해 호출이 **resolve**된다 — stall이 이기면
    reject, 지면 resolve인 타이머 경합(12회 중 3회 resolve 관측). 두
    타이머는 설계상 같은 폭이라 어느 쪽이 이길지는 spawn 지연 대 이벤트 루프
    지연의 우연이었다. `lifecycle-hang-initialize`로 옮겨 hang된 대상을
    initialize로 바꿈 — initialize 타임아웃은 파일별 강등 없이 route 전체를
    reject하고 stall 선행도 reject라 **두 순서 모두 거절**로 수렴,
    오라클이 결정적이 됐다(이후 파일 전체 48/48 × 10회 PASS).
  - 메타데이터: source digests 재생성, run.ts·command.ts의 byte-bound
    review 항목을 fresh re-read 후 새 sha256으로 재결박, review-ledger
    재생성, validation.md input digest 재결박.
  - NOT_RUN: macOS native·systemd·kernel/powercut·provider credential·
    release qualification — 로컬 환경 부재.
- 2026-10-12 (UX-38 batch 5 — durable-capacity 변환: 격리/관측/워크스페이스/
  패키지/브로커/계보의 크기·시간 거절을 비차단 기구로):
  - quarantine: namespaced import 스크립트가 OMA_PHASE 마커·dd/fsck/fetch
    자체 진행 출력·15s heartbeat로 진행을 내보내고 `timeoutSeconds`는
    작업 마감이 아니라 generous ceiling(24h) — `silenceSeconds`가 멈춘
    import만 끝낸다. heartbeat 자식의 계승 stdout을 `>&-`로 닫지 않으면
    스크립트의 command substitution 파이프가 heartbeat 수명만큼 열려
    테스트가 정확히 30s 멈추는 결함이 있어 닫았다. `PreparationExecutor`의
    영구 전역 중독은 executor별 `unprovenPreparations` 추적으로 —
    `reverifyStale`은 임차 트리의 fresh `quiescent` 관측에서만 풀리고
    `active`/`unknown`은 계속 막으며, 수용된 번들 증거는 cleanup 불확실성으로
    버려지지 않는다. `GitPaths.quarantineResources`에 `silenceSeconds` 추가.
  - canonical Git: `ls-tree -r -z --full-tree`(gitlink)와 `merge-tree` 출력은
    `os.tmpdir()` 아래 fresh mkdtemp 스풀로 통째 흘려보내고 레코드 단위
    점증 파싱 — `GITLINKS_OBSERVATION_BYTES` 제거, merge-tree는 merged-tree
    행+conflict 경로 접두만 읽는다. grammar 거절·unterminated=unknown은
    불변.
  - workspace Git: `WorkspaceCoordinator.prepareGit`이 clone/fetch/checkout을
    PreparationExecutor로 — 24h ceiling + 120s 진행-리셋 침묵 창(git에
    `--progress`), 두 스트림은 staged 트리 옆 스풀 파일. 소 plumbing은
    bounded sync 유지. `runWorkspaceGit`(dead code·구 120s/4MiB 정책) 제거.
    canonical fsck도 같은 형태(health executor + `--progress` + 진단 스풀의
    owned 수거 — `T68d` 신규).
  - 설정 소스: `CONFIGURATION_SOURCE_LIMITS`는 작업-집합 한도로 재명명
    (4096 파일/64 MiB 집계 — 소스 파일당 identity 행 1개, asset 바이트는
    `fileDigest`로 스트리밍돼 메모리에 없음). 통째 읽는 문서/프롬프트만
    `CONFIGURATION_DOCUMENT_BYTES` 16 MiB — 구 256/8 MiB/1 MiB 폐기.
  - 패키지 아카이브: 읽기·쓰기 전부 64 KiB/1 MiB 청크 스트리밍, 구
    200k-entry/2 GiB-total/256 MiB-file 페이로드 상한 폐기 — entries는
    8M working-set 한도로, `pathBytes`(16-bit wire)·`componentBytes`
    (NAME_MAX)는 포맷 한도로 유지. local `stageArchive`는 .tgz를 스토어
    아래 `.staging-local-*` 스풀에 chunk로 inflate해 ustar 헤더 단위로
    파싱 — 멤버 바이트는 staged 파일로 스트리밍.
  - 브로커 쿼터: `StorageAdmission.startupState()` 신설 — 같은 fresh scan이
    QUOTA_EXCEEDED면 "degraded"로 기동(신규 admission은 요청당 거절)하고
    비-쿼터 관측 실패는 여전히 throw. `D04` 테스트가 세 분기 모두 결박.
  - 프로세스 계보: 고정 깊이 16 폐기 — 조상 발견(start-time 일치)·init/root
    도달·PID 반복(Set 사이클)·관측 불가/exit까지 임의 깊이로 걷는다.
    depth-64 체인·사이클·PID 재사용 불일치 회귀.
  - 워크스페이스 쿼터 결선: `OMA_WORKSPACE_BYTES`가 Resident spawn plan→
    adapter(양의 safe-integer 검증·fail-closed)→runner→broker-rendered
    resources→Principal env→interactive `sessionEnv`(ambient 제거하면서
    보존)→trusted extension 공유 직렬화 writer까지 일관 — 미설정 시 쓰기
    거절(`PR-004` E2E 신규).
  - architecture-gate 정산: `state-tree`/`owned-state` 규칙 위반 정리 —
    canonical-command의 tmpdir 스풀과 local-package의 Mac host-staging 경로는
    문서화 면제로, store 아래 tar 스풀은 held-parent(`entryAt`/`openBeneath`
    O_EXCL|O_NOFOLLOW)+async-generator 싱크+`removeOwnedTree`로 전환,
    workspace/reconcile 진단 스풀은 `removeOwnedFile`로. 신규 collection
    경계 2개(`ReconcileModule.assertCanonicalHealthyAsync`·
    `local-package#stageArchive`)를 `durable-boundaries.json`에 T68d·
    pi-packages 오라클로 등록.
  - 테스트 정산: `broker-composition-policy` StorageAdmission mock에
    `startupState` 추가, `verification-lanes`의 durable 레인 필수명을
    새 V12B 제목으로 갱신, `preaccept-ownership` V18A를 신계약(잔여
    unknown은 fresh quiescence로만 풀림)으로 재작성 — mock의 sleep 치환이
    silenceMs≤timeoutMs 검증을 어기지 않게 silenceMs:50.
  - 메타데이터: source digests·dependency-graph evidence 재생성,
    review-notes byte-bound 항목 11개 fresh re-read 후 새 sha256·신규 항목
    등록(`process-ancestry`·`paths`는 readUnchanged→reviewedChanges 이동),
    review-ledger 재생성, `design-revisions.md` gitlink 스풀 단락 반영.
  - NOT_RUN: macOS native·kernel/powercut·provider credential·release
    qualification·guest lanes — 로컬 환경 부재. systemd 게이트는
    `OMA_TEST_SYSTEMD=1` 하에 phase8 수동 실행으로 부분 커버
    (test-local.mjs 목록에서는 여전히 NOT_RUN).
- 2026-10-12 (macOS 스트리밍 아카이브 회귀 정산 — F1/F2 수정 + phase4 드리프트
  정직 평가, feat/macos-hidden-vm @ e85bc587 이후):
  - F1 (macOS 사용자-facing 회귀 — `oma pi install <path>.tgz/.tar`이 Darwin에서
    영구 실패): UX-38 batch 5가 `stageArchive`를 스트리밍 스풀로 전환하면서
    `openOwnedDirectoryPath`/`entryAt`/`withinDirectory`/`removeOwnedTree` —
    전부 Linux openat2·/proc/self/fd 프리미티브 — 를 무조건 호출하게 됐고,
    Mac은 `contained-fs`의 UNSUPPORTED_PROFILE로 매 설치가 죽었다. 스풀 생성·
    inflate 대상 오픈·제거를 `staging()`/`pruneLocalStage`가 이미 지키는 같은
    플랫폼 분기로 옮겼다: Darwin은 `createHostStagingDirectory`(호스트 파일
    소유자의 path 방식 + owned-boundary 복구)·`openSync(O_EXCL|O_NOFOLLOW)`·
    `removeHostStaged`; Linux는 그대로 held-descriptor. 정직성 문구를 헤더에
    명기 — Mac의 open(2)은 같은 leaf O_NOFOLLOW 보장을 유지하지만 그 경로까지의
    워크는 path 기반이며 커널의 RESOLVE_BENEATH 디스크립터 격리가 아니다;
    경계는 호스트 lock 아래 oma 소유 스토어 트리다.
    `test/local-package-platform.test.mjs` 신설 — `process.platform` 스텁으로
    Darwin 분기를 Linux에서 수행하고 contained-fs/directory를 호스트의 실제
    UNSUPPORTED_PROFILE 거절로 교체해, 실제 .tgz·.tar이 끝까지 스테이지되고
    `.staging-local-*` 잔재가 없음을 결박(user-files.test.mjs의 seam 패턴).
    사전 소스(`git show HEAD:`) 대조군은 두 플랫폼 거절 모두 재현.
  - F2 (canonical ls-tree 스크래치 누수): `createCanonicalObserver`의
    mkdtemp 성공과 `runProcessSync`의 동기 stdout-spool 오픈 사이 창에서
    실패가 그대로 throw되며 `oma-ls-tree-*` 디렉터리를 남겼다. 실패는 이제
    scratch를 `rmSync`로 회수한 뒤 unmade-scratch 분기와 같은 typed evidence
    (`status/signal/stdout/stderr=null`+`error`)로 응답한다.
    `test/canonical-command.test.mjs` 신설 — runner를 EMFILE로 스텁해
    starvation을 재현하고 완료 런의 dispose도 결박.
  - F3 + phase4 드리프트 정직 평가 (systemd 레인, OMA_TEST_SYSTEMD=1,
    21/21 PASS): (1) `rendered templates pass systemd-analyze --user verify`의
    `renderUnit` 호출이 `@TOOL_SURFACE_HEX@`를 빠뜨려 UNSUPPORTED_PROFILE —
    `encodedResidentToolSurface()` hex를 units.ts:245와 같은 생산 결선으로
    추가. (2) SEQ-002 — `quiesceResidents`는 Resident마다 stop을 시도하고
    복수 실패를 AggregateError cause로 묶는 것이 현재 의도된 의미이므로
    프로덕션 불변, assert를 외측 StoreError(RUN_TERMINATION_UNKNOWN)의
    cause 체인 검증으로 갱신. (3) T-create-ready — `R/actors/dynamic/5`의
    stray 파일 주입은 P0-8 owned-directory 복구가 합법적으로 수집하는
    결함이므로 더 이상 실패를 유발하지 않음; open의 실패 주입을 settlement로
    옮겨 still-prepared 배치와 충돌하는 영수증(BATCH_CONFLICT hold — P0-2의
    실제 생산 경로)으로 교체, incarnation 미소비·revoked-awaiting-death·
    재시도 STALE_RUN·사망 증명 후 같은 prepared 배치로 재기동 성공
    계약은 불변.
  - audit.test.ts `rootfs` 정산 (실제 결함 확인): `minimalConfig`의
    `rootfs: "/rootfs"`는 `requireResidentRootfs`의 순수 형태 규칙은 통과하지만
    `broker.ts`의 `assertHostDirectoryLayout(rootfs)`(allowMissing=false)는
    이 호스트에 존재하지 않는 `/rootfs`를 거절 — 실제 broker를 spawn하는
    LIFE-009 entry·D1·D2가 `UNSUPPORTED_PROFILE`로 기동 불가였다
    (HEAD 동일 — systemd 레인 비실행으로 잠복). `minimalConfig(society, rootfs)`
    시그니처를 추가하고 spawn 쪽 세 테스트는 `join(dir, "rootfs")`를 만들어
    전달(SB-007의 "OMA가 state root 아래에 만드는 rootfs" 모양과 같은,
    테스트가 소유한 실제 디렉터리); 디코드 전용 호출부는 형태만 보는
    기본값 유지. 수정 후 audit.test.js 13/13 PASS.
  - 메타데이터: production-loc-hashes 재생성, review-notes의 두 파일 항목을
    fresh re-read 후 새 sha256·oracles로 재결박, review-ledger 재생성,
    validation.md의 verification input digest 재결박.
  - NOT_RUN: macOS native(실기)·kernel/powercut·provider credential·release·
    guest lanes — 로컬 환경 부재. systemd는 이 환경에서 실행 가능:
    `OMA_TEST_SYSTEMD=1`로 systemd-required 9파일 전부 실행 —
    phase4 21/21·audit 13/13·나머지 7파일(audit2·cli·phase5·phase8·
    crash-boundaries·launch-topology·cgroup-pin) 68/68 PASS.
- 2026-10-12 (UX-38 잔여 bound 전수 조사 + 정산 — bound 장부·세 잔여
  자의적 거절 제거·문서 정밀 수정, feat/macos-hidden-vm @ f19232d9 이후):
  - 배치 1–5 뒤 남은 숫자 bound를 전수 조사해 `docs/limit-bounds.md`로
    정리했다(§1 PROTOCOL/WIRE-MANDATED 29·§2 FORMAT-MANDATED 13·
    §3 SECURITY/INTEGRITY 11·§4 RESOURCE-PROTECTION 26·
    §5 QUIESCENT/JITTER 25·§6 TEST-ONLY 1 — 105행 인벤토리). 각 bound는
    위치·값·분류·근거를 가지고, wire bound는 피어 계약과 oversized-payload
    대체 채널의 유무를 명시한다. 방어적이지만 자의적인 값은 §4가
    "defensive-but-arbitrary"로 정직하게 분류한다 — 프로토콜 요구인 척하지
    않는다.
  - 추가 스윕에서 남은 사용자-facing 거절 셋을 고쳤다:
    (a) `src/cli/effects/code.ts` — production `merge-diff` 캡처 bound가
    고정 768 KiB라 wire의 문서 bound(`bundleBytes`, 기본 256 MiB)보다 좁은
    자의적 거절이었고 오류 문구는 `cliBundleBytes()`를 명명해 불일치했다.
    이제 `bundleBytes()+1`로 정렬 — 통과할 수 있는 diff를 거절하지 않고
    +1이 "정확히 수용"과 "초과"를 구별한다. 같은 파일의 revision 해석
    관측(ref/published/ancestry)도 고유 768 KiB에서
    `CANONICAL_PROCESS_LIMITS.maxBuffer`(4 MiB)로 정렬 — broker의
    canonical observer가 같은 명령에 두는 bound와 같아져 큰 발행 이력의
    저장소가 code view에서만 거절되는 비대칭을 없앴다. 고정 MAXIMUM은
    production이 도달하지 않는 show/diff/log/ls-tree/grep 뷰의 TEST-ONLY
    bound로만 남겼다(주석 명기). (b) `src/cli/effects.ts` —
    `workspaceDirty()`가 `runGitText`(256 KiB maxBuffer)로 porcelain을
    읽어 정직하게 dirty한 큰 워크스페이스가 LIMIT_EXCEEDED로 죽을 수
    있었다. 불리언 관측이므로 어떤 stdout이라도 잡히면 dirty — 절단된
    목록도 증거이고, 성공적으로 빈 목록만 clean이다. timeout/stalled/spawn
    실패는 requireTextExit로 계속 전파돼 clean으로 오독되지 않는다.
  - 문서 정밀 수정: LSP 신규 오라클 서술을 "17 fail-before"에서
    "14 fail-before + 3 회귀 가드"(구 동작이 없어 대조 불가)로
    WORKSTREAM·validation.md 양쪽에 정정; B1 fixture 문구를
    "102 .test.mjs + helper 2종(isolate-env preload·pdf-fixture)"로
    정밀화; `packages/storage/src/ledger-reader.ts`의 ReadScope 주석이
    스냅샷 보장을 과대 주장한 것을 컬렉션-로컬 memoization 기술로 교정.
  - 메타데이터: production-loc-hashes 재생성, review-notes의
    effects.ts·effects/code.ts 신규 byte-bound 리뷰 + ledger-reader.ts
    재결박(전부 fresh re-read 후 새 sha256), review-ledger 재생성,
    dependency-graph evidence·validation.md의 verification input digest
    재결박.
  - 게이트: build·typecheck·check:architecture(인벤토리·rules·lattice·
    transactions·boundaries·documents·spec-inventory) 전부 PASS;
    집중 회귀 principal-code-view·merge-cli·operational-read-budget
    16/16, effect-observation·git-effect-evidence·merge-review 38/38,
    scenario-merge-review 9/9 PASS.
  - 전체 `node scripts/test-local.mjs`: 399 files → 3,900 tests, 3,898
    PASS. 실패 2건 — SCN-L02는 8-way 병렬에서만 재현되는 기존 타이밍
    flake(파일 단독 재실행 40/40 PASS), R38은 정산 산출물 반영 전의
    stale digest로 재결박으로 소거. 이전 한 실행은 정산 중 dist 재생성이
    suite와 경주해 wedge됐고 관련 파일 4종(scenario-confined·
    scenario-society·scenario-principal·society-bringup) 단독 재실행
    96/96 PASS로 확인됐다.
  - NOT_RUN: macOS native(실기)·kernel/powercut·provider credential·
    release·systemd-required lanes — 로컬 환경 부재.
- 2026-10-12 (UX-38 bound survey 맹검증 잔여 정산 — workspaceDirty 거절
  관측 정직성·stale NOT_RUN 표기 교정, feat/macos-hidden-vm @ 182a6031
  이후):
  - F-2 `src/cli/effects.ts` — `workspaceDirty()`가 `git status`의
    exited-nonzero + 빈 stdout을 clean으로 읽었다: 깨진 index·git이
    거절하는 ownership 등 워크스페이스가 있으나 관측이 거절된 경우까지
    clean으로 축소(구 코드도 같은 의미 — 회귀가 아니라 잔존 결함의 정산).
    이제 비영 종료 중 `not a git repository`/`must be run in a work
    tree`만 유일한 사실상 부정(관측할 워크스페이스 부재)이고, 나머지
    거절은 `StoreError(INTERNAL_ERROR)`로 전파 — 주변 관측 경계
    (effects/submit·effects/code·journalView)의 refuse-on-nonzero
    관례와 일치. 명시 full-OID `merge open`/`challenge open`의 비저장소
    cwd 호출(`resolveOid`의 full-OID 단축 경로)은 보존된다.
  - fail→pass: `test/merge-cli.test.ts`에 손상 `.git/index` 거절 재현 —
    open이 exit 3·`git status: fatal:`로 명시 실패하고 요청을 보내지
    않는다(구 dist에서는 무경고 진행으로 실패 확인). 비저장소 명시-OID
    open은 경고 없이 완료되는 회귀 가드도 추가.
  - F-1 stale 표기 교정: validation.md의 systemd-required "환경 부재"
    NOT_RUN은 stale — 이 호스트는 user systemd 257.13·bwrap 0.12.0·
    cgroup v2·user bus를 갖춘다. `OMA_TEST_SYSTEMD=1` 실측:
    `verify-lane.mjs kernel` 12파일 65/65·`crash` 2파일 63/63
    EXECUTED+PASS — systemd-required 9파일 전종이 실제 user
    manager에서 초록.
  - 메타데이터: production-loc-hashes·dependency-graph evidence 재생성,
    review-notes의 effects.ts 항목 fresh re-read 후 새 sha256 재결박,
    review-ledger 재생성(14065/59/50/8), validation.md의 verification
    input digest 재결박.
  - 게이트: build·typecheck·check:architecture 전부 PASS; 집중 회귀
    merge-cli 12/12 포함 88/88; test-local 399 files → 3,902 tests
    3,902 PASS·0 실패(첫 실행은 정산 산출물 반영 전 stale digest의 R38
    1건 — 재결박 뒤 재실행이 전종 초록).
  - NOT_RUN: macOS native(실기)·powercut·provider credential·release —
    로컬 환경 부재.
- 2026-10-12 (UX-38 잔여 정산 후속 — workspaceDirty not-a-repo 사실상
  부정의 상호확인, feat/macos-hidden-vm @ e3fd0ee9 이후):
  - `src/cli/effects.ts` — 직전 정산이 남긴 LOW 잔여: `git status`의
    `not a git repository` 거절 문자열을 그대로 믿으면, 손상된 `.git`
    (깨진 HEAD·읽을 수 없거나 끊어진 `.git` 엔트리·허공을 가리키는
    gitdir 포인터·마운트 경계 너머의 주장)도 부재로 축소돼 `merge
    open`/`challenge open`이 미커밋 경고 없이 진행됐다. 이제 그
    carve-out은 관측 디렉터리와 그 조상을 `.git` 엔트리로 걷는
    `workspaceClaimPresent`의 상호확인을 거친다 — 디렉터리든 gitdir
    포인터 파일이든 엔트리가 있으면 워크스페이스 주장이므로 거절을
    `StoreError(INTERNAL_ERROR)` + git stderr로 전파하고, 어느 단계도
    엔트리를 못 찾을 때만(ENOENT/ENOTDIR; 관측 불가한 stat은
    실패-폐쇄) false가 정직한 사실상 부정이다.
  - bare repo 판정: `.git`이 어디에도 없는 `must be run in a work
    tree`는 git이 저장소를 열어 work tree 부재를 직접 확인한 완전한
    관측이고, bare repo에는 uncommitted work가 있을 곳 자체가 없다 —
    vacuous한 사실상 부정으로 false를 유지한다. 같은 문구라도 `.git`이
    있으면(잘못 설정된 core.bare, gitdir 내부의 cwd) 미관측 작업이 숨을
    수 있어 전파한다. 전부 거절이면 전파라는 더 보수적 대안을 두고,
    거절이 관측 디렉터리의 미커밋 작업을 숨길 수 있는지를 기준으로
    결정했다.
  - fail→pass: `test/merge-cli.test.ts` 신규 2종 — 손상 `.git/HEAD`로
    not-a-repo 거절을 재현한 명시-OID `merge open`이 이제 exit 3 +
    `git status: fatal: not a git repository`로 명시 실패하고 요청을
    보내지 않는다(HEAD dist 재실행에서는 거절이 clean으로 읽혀
    transport까지 진행·실패 확인). bare repo cwd의 명시-OID open은
    경고 없이 완료해 vacuous 부정 결정을 고정하고, 기존 비저장소
    명시-OID 회귀 가드는 그대로 유지된다. 대면 검증 9종(깨진 HEAD·
    댕글링 링크·`.git` 파일 포인터·gitdir 내부 cwd·core.bare 오설정
    전부 전파; bare·진짜 부재는 false; clean/dirty 유지) 확인.
  - 메타데이터: production-loc-hashes 재생성, review-notes의
    effects.ts 항목 fresh re-read 후 새 sha256 재결박,
    dependency-graph evidence·review-ledger 재생성(14065/59/50/8),
    validation.md의 verification input digest 재결박.
  - 게이트: build·typecheck·check:architecture 전부 PASS; 집중 회귀
    merge-cli 14/14; `node scripts/test-local.mjs` 전체 lane 결과는
    아래 validation.md 정산 절에 기록한다.
  - NOT_RUN: macOS native(실기)·powercut·provider credential·release —
    로컬 환경 부재.

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
