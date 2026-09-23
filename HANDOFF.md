# OMA v2 — consistency plan 실행 인계 (중단 시점)

이 문서는 `oma-v2-consistency-plan-b25961c/` 계획을 적용하던 작업의 중단 시점 인계다. 사용자가 "일단 멈추고 지금까지 한 일과 남은 일을 자세히 적어라"라고 지시해 멈췄다. 현재 결과 수치(test count, LOC, lane PASS 표)는 `implementation/validation.md`가 단일 owner다. 이 문서는 수치를 반복하지 않고, 각 WP의 외부 증거 파일을 가리킨다.

## 1. 한눈에 보는 현재 상태

- 브랜치: `refactor/safety-preserving-architecture`, 중단 시 HEAD `bcbc627` (docs(WP24)). push/PR/merge는 하지 않았다.
- 계획 카드 33장(WP00–WP32) 중
  - **완료 15장**(CODE_COMPLETE / LOCAL_VERIFIED): WP00, WP01, WP02, WP04, WP05, WP06, WP11, WP12, WP17, WP18, WP19, WP20, WP21, WP22, WP24
  - **BLOCKED 1장**: WP03(승인된 disposable-user systemd 환경 필요, 코드 작업도 시작 전)
  - **대기 17장**: WP07, WP08, WP09, WP10, WP13, WP14, WP15, WP16, WP23, WP25, WP26, WP27, WP28, WP29, WP30, WP31, WP32 — 모두 WP03에 직접 또는 간접으로 의존한다.
- "완료"는 모두 local 검증 기준이다. release 자격, 실제 systemd/kernel, VM·storage 전원 차단, 실제 provider, 현재 SHA CI, A-008 architecture review는 어느 WP도 주장하지 않는다.
- 사용자 결정 대기: WP03을 가정 조건으로 두고 일부 카드를 진행할지(§6). 지시가 있기 전에는 진행하지 않는다.

## 2. 반드시 지킬 작업 규칙

- **사용자 변경 보존**: 다음 7개 파일에는 사용자의 formatting-only 수정(HEAD와 AST 동일)이 있다. stage·reset·reformat하지 않는다.
  `test/config-edit-descriptors.test.ts`, `test/config-edit-descriptors.types.ts`, `test/config-editing.test.ts`, `test/config-snapshot.test.ts`, `test/config-validation.test.ts`, `test/delivery-receipt-publication.test.ts`, `test/preaccept-scope.test.ts`.
  이 때문에 WP20 카드가 요구한 `settleByAcceptance` 삭제를 하지 않았다(`test/preaccept-scope.test.ts`가 import한다). 사용자가 이 파일 편집을 허락하면 삭제할 수 있다.
- **계획 디렉터리**: `oma-v2-consistency-plan-b25961c/`는 untracked로 두고 stage·reset하지 않는다. 확인: `cd oma-v2-consistency-plan-b25961c && sha256sum -c SHA256SUMS.txt`.
- **자동으로 하지 않는 것**: 계획에 없는 schema·wire·receipt version·권한 변경, NOT_RUN/BLOCKED를 PASS로 바꾸는 것, 운영 society 생성, 실제 credential·유료 provider, VM 전원 차단, push·PR·merge·branch 보호 설정.
- **commit**: 정확한 경로만 `git add`한다(`git add ... 2>/dev/null`: .gitignore 안내가 exit 1을 내지만 stage는 된다). 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **WP 한 개씩**: 선행 handoff와 ADR(`implementation/consistency-decisions.md`)을 먼저 읽는다. 수정 전 production-linked 시험이 red인지 기준 worktree에서 확인하고, 구현한 뒤, 같은 결함을 다른 caller가 다시 만들 수 있는지 검사한다. 주 검토 파일은 실제로 읽고 KEEP/CHANGE 이유를 남긴다.
- **최종 증거는 clean worktree에서**: `git worktree add --detach <dir> <commit>` 후 `cp -a node_modules <dir>/`로 복사한다(symlink는 T117 sandbox 시험을 깨뜨린다).
- **validation.md와 digest**: `scripts/source-digest.mjs`의 verification input digest는 validation.md의 digest 필드를 정규화한다(64자리 hex 형태만 인식). `HANDOFF.md`는 digest 입력이 아니다. R38 시험은 validation.md가 현재 digest와 LOC를 인용하는지 확인한다. 그래서 fix commit 직후 local 실행에서는 R38 2건이 docs commit 전까지 실패하는 것이 정상이다.
- **shell**: 기본 shell이 fish/zsh 계열이라 `for ...; do` 반복문, `set --`, `echo =====` 같은 구문이 깨질 수 있다. 여러 줄 스크립트는 `bash script.sh`나 python으로 실행한다.

## 3. 완료한 WP (실행 순서)

각 WP의 상세 증거는 외부 증거 폴더(§8)의 `WPxx-HANDOFF.md`, `WPxx-FILE-REVIEW.md`, `WPxx-TASK-RESULT.json`, `WPxx-evidence.sha256`에 있다.

| 순서 | WP | commits | 바뀐 의미(요약) | 남긴 한계 |
|---|---|---|---|---|
| 1 | WP00 기준선 | (docs) | 기준 SHA·dirty tree·파일 배정·기존 finding 재분류. production 변경 없음 | runtime 증명 아님 |
| 2 | WP01 결정 | `6cefe52`…`53c7087` | `implementation/consistency-decisions.md`에 D01/D02/D04/D05/D06 ACCEPTED, D03은 NEEDS_RUNTIME_EVIDENCE(WP03) | runtime gate는 각 WP 소관 |
| 3 | WP02 fixture | `9272674`…`8669274` | production 경계를 통과한 완전 config fixture, 독립 관측 도구, checkpoint 기반 crash driver | 실제 user-manager 아님 |
| 4 | WP03 (BLOCKED) | `09e8ffe` | launch graph 소스 기록만 함 | §4 참조 |
| 5 | WP04 Store 열기 | `0328ffd`…`a11efff` | schema 호환 사전 검사, sidecar 증거 보존, alias 거절, 실패 시 close | 네이티브 VFS 한계 문서화 |
| 6 | WP11 config 검증 | `e1815be`…`61e41ce` | 전체 후보 검증 뒤에만 쓰기, 닫힌 편집 descriptor | managed generation 없음(WP13) |
| 7 | WP17 preaccept scope | `678f427`…`099334b` | `PreacceptScope` 5개 disposition, inode 고정, primary-first 오류 | — |
| 8 | WP05 영수증 게시 | `58759d6`…`8682214` | private no-replace 게시, parent fsync 후 성공, 첫 사실 반환 | V05C 실제 전원 차단 NOT_RUN |
| 9 | WP12 config snapshot | `346203c`…`af3f6bf` | 한 번의 bounded snapshot | 외부 writer 배제 없음 |
| 10 | WP18 context preaccept | `97bc737`…`29d1e64` | staging root 고정, plan 참조 소유권, native quiescence | `ctx-accepted` crash는 systemd 전용 BLOCKED |
| 11 | WP06 영수증 관측 | `3267632`…`ed30e50` | verified/absent/unavailable/conflicting 닫힌 관측, live/recovery 정산 분리 | kernel V06B BLOCKED, `settleFromReceipt` 호출자는 WP07 |
| 12 | WP19 create/bootstrap | `5b88b54`…`3fa409a` | seed 순차 준비, brief는 plan 참조로 소유 | systemd activation 미검증 |
| 13 | WP20 mail/submit | `c523824`, `b25a1b7`, `20706e8` | `freezeObject`가 자기 link inode만 소유·정리, mail/submit이 한 scope로 정산, `frozenMessageDisposition` 공유, child mail harness는 checkpoint에서 SIGSTOP | `settleByAcceptance` 유지(§2), submit staging 디렉터리 잔여, RequestCache/RPC 연결 끊김·동시 same-key NOT_RUN, spool row-exists mutant 생존(도달 불가) |
| 14 | WP21 action 분류 | `0d3cd3e`, `cda45e5`, `75fa748` | method descriptor에 내부 resource category, quota는 검증 뒤 admit/settle에만, 같은 key 수락 조회 허용, recovery 단계별 gate, 수락 후 실패는 `AcceptedFailure`(retry same-key), startup stop은 전원 시도 | 오류 precedence 변경(quota가 검증 뒤) |
| 15 | WP22 저장 용량 | `a16360e`, `b315f89`, `0f4e026` | `StorageAdmission` 단일 owner(scan+예약), stream 예약은 실행 종료/연결 종료 때 1회 반납, settle은 `limits.frameBytes` headroom 안에서 한 번에 하나, startup은 bounded recovery | hard quota 아님, SQLite/WAL 증가는 측정만(약 180 KiB/32수신자), WP22.05 장기 부하 NOT_RUN, full-FS "완료 기록" mutant 생존(구분 불가) |
| 16 | WP24 Git 증거 | `482e878`, `ab5186a`, `bcbc627` | no-op integrate(`base==candidate`) 복구는 현재 policy·stop·권한을 다시 확인, 적용된 CAS는 역사적으로 정산, third main 보존 | 실행형 check는 gated 유지, context/submit의 no-op 부재는 소스 검토 근거 |

## 4. BLOCKED: WP03

- 무엇: 실제 clean user systemd에서 product/systemd 두 topology의 argv·config·root·profile, `LoadState/FragmentPath/DropInPaths`, 사망·재시작 fencing을 관찰한 뒤 launch/config locator를 고치고 지원 범위를 정한다(WP03.01–05).
- 한 일: WP03.01 소스 기반 launch graph와 주 검토 파일 읽기만(`09e8ffe`, 외부 `WP03-BLOCKED-HANDOFF.md`). 코드·템플릿·시험 변경 없음.
- 확인된 소스 결함 후보: N02 — 외부 config 경로가 렌더링된 Resident argv에 전달되지 않고, custom XDG root가 manager 환경과 다를 수 있다(runtime 재현 전). H04(product child와 fixed unit 의존 관계)는 UNCERTAIN.
- 막힌 이유: `requireSystemdTestManager`가 `OMA_TEST_SYSTEMD=1`과 disposable test user를 요구한다(`wp03-v03b-preflight.log`). 이 환경에는 승인된 일회용 사용자·user manager가 없다.
- 재개 조건: 깨끗한 일회용 사용자(또는 VM), fixture 소유 unit만 설치·정지할 권한, 동작하는 `systemd --user`, 시작 전 잔존 OMA broker unit이 없음을 확인. 그 뒤 WP03.01 관찰부터 시작한다.

## 5. 남은 카드 17장 (모두 WP03 경로에 걸림)

| 카드 | 직접 선행 | WP03과의 결합 | lane | 이전 handoff가 남긴 구체 과제 |
|---|---|---|---|---|
| WP07 resident 정산→rollover | WP03, WP06 | runner 재시작 topology | durable, kernel | `openRun`에서 `begin` 뒤·incarnation T 전에 `settleFromReceipt` 호출, `absent` batch만 재할당, startup 권한 정의(WP06) |
| WP08 Principal 재전달 분리 | WP06, WP07 | 간접 | durable | Principal 재전달 전에 영수증 관측(WP06) |
| WP09 Principal run 소유권 | WP02, WP08 | 간접 | durable, property | D06.acceptance-unknown: timeout은 claim 해제가 아님 |
| WP10 deadline·종료·generation | WP03, WP09 | process 사망/리스 | durable, kernel, property | close/exit/cgroup death 구분 |
| WP13 managed config generation | WP12, WP03 | config locator(N02)와 겹침 | durable, stress | 재작업 위험 큼 |
| WP14 extension 편집 owner | WP12, WP13 | 간접 | durable | — |
| WP15 설정 적용 시점 | WP11, WP13, WP14 | 간접 | durable, fast | — |
| WP16 project identity·provisioning | WP03, WP04, WP13 | first-run/locator | durable | — |
| WP25 lifecycle·unit·run pin | WP03, WP07, WP10, WP19 | WP03 launch contract를 모든 unit에 적용 | kernel only | WP03 없이는 불가 |
| WP23 관측 snapshot | WP21, WP22, WP25 | WP25 경유 | stress, kernel | WP22가 남긴 비동기 bounded scan |
| WP26 protocol·CLI·cache | WP02, WP06, WP21, WP25 | WP25 경유 | durable, fast | WP20의 RequestCache/RPC 연결 끊김 V20A 부분 |
| WP27 엔진·extension·relay | WP03, WP08, WP10, WP14, WP25, WP26 | 직접 | engine, durable | 실행형 Git check 지원 여부(D06.unsupported) |
| WP28 TUI | WP09, WP15, WP23, WP26, WP27 | 간접 | durable, pty | — |
| WP29 architecture gate | WP11, WP12, WP20, WP26 | WP26 경유 | fast | manifest 누락 9건 |
| WP30 crash matrix | WP07, WP08, WP10, WP13, WP16, WP20, WP22–WP29 | 간접 | property, kernel | 실제 crash/powercut lane |
| WP31 패키징·지원표 | WP03, WP13, WP27, WP29 | 직접 | durable, fast | 의존성 분류, artifact-only install |
| WP32 최종 closure | WP30, WP31 | 간접 | fast | 전체 문서 정합성, A-008 |

## 6. 사용자 결정 대기: WP03 조건부 진행안

- 가능 범위: WP03을 가정 조건으로 두면 WP07, WP13, WP08, WP09, WP14, WP10, WP15, WP16(8장)의 코드와 local lane(durable/fast/property/stress)은 이 환경에서 진행할 수 있다. WP07·WP10의 kernel lane은 NOT_RUN으로 남는다.
- 불가 범위: WP25(자체가 WP03 계약 적용이며 kernel lane만 있음)와 그 뒤 WP23, WP26–WP32(9장)는 여전히 진행할 수 없다.
- 위험: WP13·WP16은 WP03이 확인할 config locator(N02)와 겹쳐 재작업 가능성이 있다. 이렇게 진행한 카드는 "WP03 조건부"로만 기록하고 계획상 완료로 표시하지 않는다. 계획의 의존 관계는 수정하지 않는다.
- 선택지: (a) 8장 조건부 진행, (b) WP03과 덜 겹치는 WP07→WP08→WP09→WP10만 진행, (c) WP03 환경을 준비할 때까지 정지. 현재 (c) 상태다.

## 7. 공통 미검증·열린 gate

- 실제 systemd/kernel(V03, V06B, V07/V10 kernel, `ctx-accepted` crash 등): BLOCKED.
- VM/storage 전원 차단(V05C 등), 실제 provider, 설치된 runtime: NOT_RUN.
- 현재 SHA CI: 성공 run 없음. A-008(production LOC가 10,000행 기준 초과) architecture review: OPEN.
- WP29: manifest 누락 9건. WP31: 의존성 분류와 artifact-only install.
- SCOPE_ONLY로 배정된 파일 가운데 이번에 읽지 않은 부분은 검토 완료로 주장하지 않는다.
- 유지할 계약: v1 schema/wire/receipt/live fencing, WP05 private no-replace 영수증, WP17 disposition, WP11 전체 후보 검증, WP12 단일 snapshot, WP18 context scope, WP19 순차 seed, WP20 링크 inode 소유, WP21 category admission과 `AcceptedFailure`, WP22 `StorageAdmission`, WP24 no-op 규칙, WP06 영수증 관측 union(`settleFromReceipt`는 WP07 호출 대기).

## 8. 증거와 재현 방법

- 외부 증거 폴더: `/tmp/oma-consistency-evidence-Vc66uK`(약 2.8 GB, 대부분 worktree의 `node_modules` 사본). **`/tmp`라서 재부팅 시 사라질 수 있다.** 최소한 `WP*-HANDOFF.md`, `WP*-FILE-REVIEW.md`, `WP*-TASK-RESULT.json`, `WP*-evidence.sha256`, `wp*.patch`, `run-wp*.py`, `wp*-close.py`, `wp*-closure.sh`, `wp*-validation.py`, `wp*-mutants.py`는 보존할 가치가 있다.
- worktree: `git worktree list`에 30개(`wpNN-baseline`/`-controls`/`-final` 등)와 이전 세션의 `/tmp/oma-master-check`가 등록되어 있다. 정리하려면 `git worktree remove --force <path>` 후 `git worktree prune`. 증거가 필요 없을 때만 한다.
- WP 한 장을 끝내는 절차(WP20–WP24에서 쓴 방식):
  1. 기준 worktree(`wpNN-baseline`)에 새 시험만 복사해 red를 기록(`run-wpNN.py <cwd> <label> <timeout> <cmd...>`는 argv·cwd·HEAD·digest·exit·log hash를 JSON으로 남기고 같은 label 덮어쓰기를 거부한다).
  2. 본 트리에서 구현, `npx tsc -p tsconfig.json --noEmit`, `npm run build`, 관련 시험, `node scripts/loc.mjs`, `npm run evidence:graph`, `npm run check:architecture`, 전체 `npm test`(R38 2건만 실패하는 것이 정상).
  3. fix commit → control worktree에서 positive control과 semantic mutant(`wpNN-mutants.py`) → policy 시험 red → `scripts/verification-lanes.mjs`·`test/fixtures/README.md` 등록 → green → lanes commit.
  4. clean worktree `wpNN-final`에서 `wpNN-validation.py`로 validation.md v1(digest 자체 결박) → initial lanes/package/local → v2(결과 반영) → final 실행(모두 같은 digest) → validation.md를 본 트리로 복사 → docs commit(HANDOFF 포함).
  5. `wpNN-closure.sh`로 commit된 트리의 digest가 final과 같은지 확인하고, `wpNN-close.py`로 patch·TASK-RESULT·manifest를 만든다.
- lane 명령: `npm run verify:{fast,durable,property,stress} -- --out <dir>`, `npm run check:package`, `npm test`.
