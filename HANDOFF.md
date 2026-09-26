# OMA v2 — consistency plan 실행 인계

이 문서는 `oma-v2-consistency-plan-b25961c/` 계획(WP00–WP32) 적용 작업의 인계다. 현재 결과 수치(test count, LOC, lane PASS 표)는 `implementation/validation.md`가 단일 owner다. 이 문서는 진행 상태와 재현 방법만 적는다.

## 1. 현재 상태 (2026-09-25)

- 브랜치 `refactor/safety-preserving-architecture`. push·PR·merge는 이 작업에서 하지 않는다.
- **WP00–WP32 전부 커밋 완료, 재검토·적대적 검증, 이어서 전체 코드베이스 적대적 검증(AV1–AV5)과 v11 검증 중 발견한 AV6, 그 뒤 INV02 재점검 AV7, INV10·기록 약속 재점검 AV8 완료.** AV1–AV5는 카드별 새 원칙이 아니라 프로젝트 불변식(INV01–INV12)·spec MUST를 기존 owner가 적용한 것으로 재정렬했다(`implementation/consistency-decisions.md`의 AV 절). 이어서 사용자 요청으로 동봉 엔진을 0.87.1로 올렸다(ENG1). 그 뒤 사용자가 승인한 실제 provider 기능 점검(gpt-6-luna, test society `provtest`, 12회: 12차는 작업 도중 종료·재시작 복구)에서 AV9–AV31을 찾아 기존 원칙에서 파생해 고치고 각각 재실행으로 확인했다(`implementation/consistency-decisions.md`의 AV 절, 의도된 동작으로 둔 발견 포함). 이어서 사용자 요청으로 설계 수준의 수정 DR1–DR8을 했다(`implementation/design-revisions.md`: 모델 view의 경로, 실패의 닫힌 details와 설명 표, host가 주는 `code.integrate`와 Control Panel의 Worker integrate, 재전달 알림, broker의 독립 세션, 통합 사실과 현재 revision의 분리 등; 바뀐 spec 조항과 이유 포함). 13차 점검이 그 수정을 실제로 확인했다. 그 뒤 사용자 결정으로 [Priority 0](PRIORITY-0.md)("durable하게 확정된 사실의 의미는 이후의 권한·재시작·복구가 바꾸지 못한다")을 최상위 원칙으로 두고, production 파일을 하나씩 점검했다(1차: 215개 파일, 2차: 모든 catch와 `existsSync`). 발견 23개(P0V-01–P0V-23)를 기존 원칙에서 도출해 고쳤고, 이어서 사용자 승인으로 한 실제 provider 점검(14차)에서 DR9–DR13을 끝까지 확인하며 P0V-24를 더 찾아 고쳤다. 설계 판단은 DR9–DR13, 근거·수정 commit·변이 결과·14차 기록은 `implementation/priority-0-audit.md`에 있다. 마지막 통합 검증은 `implementation/validation.md`의 v18이다(v17 final은 시험의 뒷정리 경쟁으로 멈췄고 고친 뒤 v18이 대체). v3–v17은 중간 증거로 `/home/dev/oma-evidence/v3..v17/`에 있다.
- 판정: **release 미승인**. `node --input-type=module -e 'const m=await import("./scripts/review-closure.mjs"); console.log(m.approval(".", undefined, await m.oracleFindings(".")))'`로 확인한다. production 파일 224개 전부 검토 완료(NOT_REVIEWED 0, `src/git/context-mirror.ts` 제거·`src/reconcile/preaccept.ts` 추가 뒤). 남은 차단 요인은 powercut·실제 provider(자동 lane)·CI NOT_RUN(oracle V05C·V30B·V32B)뿐이며 모두 사용자 승인이 필요하다. 수동 provider 기능 점검은 lane 증거가 아니다.
- lane 성격: V27A(실제 엔진), V28B(pty), V31A(설치 closure)는 저장소에 `engine`/`pty` lane이 없어 durable lane에서 돈다(bubblewrap·openssl·python3 필요, skip은 PASS 아님).

## 2. 환경 (이 머신에 한정)

- 새 clone(`/home/dev/oma-v2`)이다. 이전 세션의 `/tmp` 증거·worktree와 사용자 formatting 변경은 이 clone에 없다.
- 일회용 systemd 계정 `omatest`(uid 1002, linger on, bubblewrap 설치, node 사본 `/opt/oma-test-node`)가 있고, `dev`는 `sudo -n -u omatest`만 비밀번호 없이 쓸 수 있다(`/etc/sudoers.d/oma-test`). 되돌리기: `loginctl disable-linger omatest; userdel -r omatest; rm /etc/sudoers.d/oma-test; rm -rf /opt/oma-test-node`.
- `cloc` 2.08은 `~/.local/bin/cloc`(공식 릴리스 perl 스크립트).
- 이 host의 차이: systemd 257, Linux 6.12(제거된 cgroup fd의 nlink가 2로 남음), util-linux 2.41(`unshare --forward-signals` 없음), `/usr/bin/node` 없음, ripgrep 없음(봉인된 Resident의 `rg`도 없음, SB-007).
- 실제 provider 기능 점검 환경 `/home/dev/oma-evidence/provider/`: `data/oma/provtest/`가 test society state이고, 그 `pi/auth.json`은 사용자가 이 컴퓨터의 Pi에서 직접 복사한 OAuth credential이다(내용은 읽지 않았다). 현재 society(14차 뒤)는 기본 설정에서 Control Panel로 Worker integrate를 켜고 Worker limit을 7로 둔 상태다. 14차의 lost update 점검에서 운영자가 Worker limit을 손으로 두 번 바꿨고, 마지막 값 7은 Control Panel이 저장했다. 13차 state는 `archive/run13-state`(credential 없음). 사용자 user manager에 `oma-provtest-*` unit이 남아 있다. 점검을 끝내면 정리: `for u in $(ls ~/.config/systemd/user | grep '^oma-provtest-'); do systemctl --user stop "$u"; rm -f ~/.config/systemd/user/"$u"; done; systemctl --user daemon-reload; rm -rf /home/dev/oma-evidence/provider/data` (credential 사본 포함).

## 3. 도구와 증거

증거는 `/home/dev/oma-evidence/`(재부팅에도 남는 위치)에 있다.

- `tools/sync-omatest.sh`: dev 트리(HEAD+작업 트리)를 `~omatest/oma-v2`로 복제.
- `tools/as-omatest.sh '<cmd>'`: omatest의 user manager 환경에서 명령 실행.
- `tools/run-lanes.sh <dir> <label> [kernel] [crash]` (`BASE=<commit>`, `SKIP_LOCAL=1` 선택): `BASE`(기본 HEAD)의 clean worktree + dev의 `validation.md`로 fast/durable/property/stress/package/local을 돌리고, 같은 bytes로 omatest에서 kernel/crash를 돌린다. `<label>-summary.txt`, `<label>-digest.json`을 남긴다.
- `tools/wp-validate.py <repo> <spec.json>`: `validation.md`의 현재 판정 절과 A-008 LOC 문구를 다시 쓰고 digest를 결박한다.
- `tools/mutants.py <spec.json> <out.json>`: omatest의 복사본에서 mutant마다 한 곳을 바꿔 build·시험. `INVALID`(적용/빌드 실패)와 `SURVIVED`를 구분한다.
- 카드별 폴더: `wp03/`(수정 전 red, V03 baseline, 탐침), `wp07/`, `wp08/`, `wp13/`, `wp14/`, `wp16/`(mutant 정의·결과), `v1/`, `v2/`(통합 검증의 initial/final lane 산출물).
- `provider/`: 실제 provider 기능 점검. `drive.py`(pty에서 `oma --society provtest` 실행, 입력은 `tty.in` FIFO, 화면은 `tty.log`), `monitor.mjs`(society 읽기 전용 요약, credential은 읽지 않음), `prompt*.txt`(회차별 지시), `runs/`(회차별 화면 기록), `archive/`(회차별 state). 재빌드 뒤에는 CFG-001에 따라 운영자로서 config의 `deploymentDigest`를 다시 고정한 뒤 실행한다.

검증 절차: 코드 커밋 → spec 작성 → `wp-validate.py`로 v1 결박 → `run-lanes.sh … initial kernel crash` → 결과를 spec에 넣고 v2 결박 → `… final kernel crash` → 커밋될 트리의 digest가 final과 같은지 확인 → validation.md(+HANDOFF) docs commit.

## 4. 작업 규칙

- 계획 디렉터리는 수정하지 않는다(`sha256sum -c SHA256SUMS.txt`).
- 계획에 없는 schema·wire·receipt version·권한 변경, NOT_RUN/BLOCKED를 PASS로 바꾸기, 실제 credential·유료 provider, VM 전원 차단, push/PR/merge는 하지 않는다.
- 커밋은 정확한 경로만 `git add`하고, 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `src/mail/`은 gitignore의 `mail`에 걸리므로 그 아래 새 파일은 `git add -f`로 따로 추가한다.
- 새 production 파일은 `scripts/kernel-zones.mjs`에 zone을 등록하고, 순수 kernel 파일은 `node:crypto` 같은 효과 capability를 import하지 않는다.
- 소스 변경 뒤에는 `npm run evidence:graph && node scripts/loc.mjs && npm run check:architecture`를 커밋 전에 돌린다.
- 전체 `npm test`를 도는 중에는 같은 트리에서 `npm run build`를 하지 않는다(dist가 바뀌어 대량 실패).

## 5. 이번 세션에서 완료한 카드

| WP | commits | 바뀐 의미 | 남긴 한계 |
|---|---|---|---|
| WP03 | `7fb4444`…`fab8a8d`, `608f6ed` | host가 정한 launch location(config·state·run root)을 unit ExecStart로 전달, runner/host는 환경 fallback 없음. broker 의존성은 실제 존재할 때만(BindsTo), 제품 모드 broker는 drain 때 Resident 정지. path 설정은 C escape하지 않음. 실효 ExecStart 대조. user manager에 닿지 않는 환경은 Store 전 거절 | systemd-managed broker는 렌더만 검증, 지원표에 올리지 않음 |
| WP13 | `38cd69a`, `dda8388`, `209ccca`, `ef136c5` | 분할 bundle 편집은 불변 generation + manifest 마지막 교체, 버전 충돌 거절, 16개/256MiB 한도, 시작 시 정지 상태 수집, export | 다른 프로세스의 독립 writer, 전원 차단 순서 |
| WP07 | `754d225`, `9cb9988`, `2b448a6` | cgroup 제거는 pin의 `cgroup.events` 부재로 증명, open 시 이전 incarnation 영수증 정산 후 absent만 rollover | 실제 엔진 kill 경계는 WP27/30 |
| WP14 | `c601592`, `b532f6a` | extension 참조 단일 규칙(loader), 사라진 optional 선언의 제한 복구, 순서 보존, bounded scan | — |
| WP16 | `b6230ca`, `82580e5`, `ec5127d` | 기본 society = slug+경로 digest, `project-binding.json`, `--bind-project`, provisioning의 없음/읽을 수 없음 구분 | 바인딩된 state root 이동은 migration 필요 |
| WP08 | `a5c6a41` | Principal 정산: 영수증을 먼저 관측, 검증된 영수증이면 엔진 전달 없이 complete만 재시도, `phase`로 실패 단계 구분 | 실제 엔진 kill 경계는 WP30 |
| WP15 | `21b1f13` | 설정 필드가 적용 시점·차단 사유를 소유, bootstrap 뒤 seed 필드 차단, 같은 값 저장은 unchanged, 다시 읽기 실패는 saved-unread, dashboard는 설정값/세션 시작값 구분 | — |
| WP09 | `b2300f7` | Principal run 소유는 settle·거절·확실한 미전송·세션 종료에서만 끝남, 미전송 입력은 한 번 순서대로 반환, 수락 불명은 따로 알리고 재전송 안 함 | 전체 pty 흐름은 WP28 범위 밖 |
| WP10 | `b6a14cf` | 수락·유휴(재무장)·턴·종료 시한 분리, overflow 없는 alarm, broker generation이 바뀐 뒤의 등록 응답 무시 | 실제 provider 긴 턴 NOT_RUN |
| WP25 | `4a4287d`…`6611644`, `1f6c31e` | systemd 257 start limit(NRestarts≥burst) 판별, 옛 incarnation의 start/stop 무효(V25A), Resident unit이 accepted 자원 전체(`OMA_RESOURCES_HEX`)를 싣고 runner는 그것만 사용 | WP03 이전 unit 재렌더 없음(재생성 필요) |
| WP23 | `3f626d7`…`4cd7673` | status 관측을 single-flight 비동기 batch로(이벤트 루프 정지 10.1 s→16 ms), pending 수는 전체 사회 한 번 읽기(620건에서 3.9 s→10 ms), 권한 경로는 여전히 즉시 관측 | admission 트리 스캔·refreshWorld 부하 미측정 |
| WP26 | `a09869d`…`437003a` | CLI가 cache에 기록 못 한 영수증도 영수증과 `--request` key를 먼저 보임(무작위 key 유실로 인한 중복 효과 방지), wire 바이트 한도·재전송 규칙 oracle | 동시 CLI 프로세스 범위 |
| WP27 | `c7d1cbd`…`88d7173` | 격리 Resident가 실제로 배치를 전달하도록 계획이 `/usr/bin/bwrap`을 명시(이전엔 모든 격리 전달 실패), placeholder 생성 총함수화(무한 재귀 제거), relay 스트리밍 oracle, 실제 엔진 0.85.1 전체 전달 V27A | 실제 provider, 세션 내구성(WP30) |
| WP29 | `76b95fa`…`f4f2bf9` | 보장 종류별 성립 위치 표, exit 소유 규칙이 alias 우회를 잡음, request-hash set-field recipe를 compile-time 닫힌 registry로 | 정적 규칙은 data flow 밖 |
| WP28 | `7c3c31d`, `f6b8372`, `9b689b9`, `658617c` | 터미널을 연 뒤의 실패도 터미널을 복원하고 이유를 사람 화면에 씀(V28B 실제 pty), 메일 수·●를 "Principal 세션 전달 대기"로(V28A) | 전체 `oma` entry의 pty 실행 없음 |
| WP31 | `1906cf3`, `7123719`, `f666a0c`, `bf87132` | lockfile이 엔진을 개발 의존성으로 둬 production 설치에서 빠지던 결함 수정(버전 변경 0), 엔진 탐색을 설치 루트로 한정, README 설치 주장 정정, 지원표 | `bin` 없음(C2 결정 보류), 다른 Node·배포판 NOT_RUN |
| WP30 | `38944fb`, `6da019a`, `094e3b9` | D01 독립 모형을 실제 구성 요소에 교차 실행(V30A), FAULT-MATRIX 대응표, 환경별 판정 | endpoint bind 실패 별도 주입 없음, powercut·provider NOT_RUN |
| WP32 | `40d339a`, `48e961b`, `736fd15` | review ledger와 승인 판정기(V32A), 불변식 12개 대조표, release 미승인 판정 | 139개 파일 미검토 |
| 전체 적대적 AV1–AV5 | `9cff8c5`…`fd69dd7`, 원칙 재정렬 `abf54bb`…`0325450` | 발견마다 위반한 INV·MUST와 기존 owner로 고침: AV1 CLI-001 문법 owner 둘(INV04)·모델 값이 slot 밖으로(INV09) → `parseArguments` 하나, AV2 INF-005 교체가 provider가 되읊는 자리에 진짜 key를 넣음(INF-007) → slot 한정 + 응답 tripwire, AV3 PR-003/PR-004·FS-003 → Principal scratch `principal/private/workspace`(provisioning이 만들고 CLI home도 여기)와 시작 시 `assertModelScope`, AV4 INV03 → 준비 완료는 provisioning을 떠나며 기록된 사실로 쓰고 다시 도출하지 않음, FS-005·SB-006 → 세션 파일 한 번의 해석, AV5 FS-005(architecture §4) → state tree 변경을 storage primitive로 일원화하고 규칙으로 강제. mutant 21개 중 20개 실패, 1개 등가 | quarantine 스크립트는 private mount namespace 안에서 경로 사용(잔여), WebSocket frame header가 key 바이트를 가르는 경우 tripwire가 못 봄(잔여), 관측하지 못한 권한은 거부하되 CAPABILITY_DENIED로 보고(잔여, 바꾸면 정산 분류가 달라짐), architecture.md는 N-001 결박 그대로 |
| AV6 (v11 kernel lane에서 발견) | `8fd3094`…`83f1b04` | INV02: 살아 있는 Resident가 부하에서 CAPABILITY_DENIED를 받음 — pidfd `poll`의 EINTR(보류 중인 SIGCHLD)을 종료로 읽음(거부 순간 EINTR 포착). 같은 원칙으로 `/proc` 읽기 실패를 엔진 종료로 읽어 Principal 등록을 retire하던 곳도 수정. `pidfdLiveness`(running/exited/failed, EINTR은 최대 8회 재질문)와 `processEnded`(/proc가 종료라고 말할 때만 ended) 하나씩으로. mutant 7개 모두 실패, 부하 반복 60/60 통과 | 부하 반복은 보조 증거(이전 빈도에서 우연 통과 가능) |
| AV7 (AV6 뒤 INV02 재점검) | `b6e902f`…`6b92785` | 관측 실패를 값으로 삼키는 곳 전수 재점검: 설정 수거가 읽지 못한 journal을 빈 이력으로 읽어 generation을 지우고, 기록이 빠진 실제 직전 generation을 지우던 것(커밋 시 manifest 사실로 journal 보정, journal이 보증할 때만 삭제), 읽지 못한 generation을 STORE_CORRUPT로 보고, 저장 용량 루트를 못 보면 0, 대시보드·메일 화면이 읽지 못한 메일함을 0/없음으로 표시(arch §23.5). mutant 9개 모두 실패 | journal이 계속 읽히지 않으면 예산 한도에서 편집 거절이 재시작으로 풀리지 않음, journal 기록이 연속 두 번 빠지면 직전 generation을 잃을 수 있음 |
| AV8 (INV10·기록 약속 재점검) | `31eb193`…`8f096b7` | WP26이 CLI 효과를 "no-follow reads"로 기록했지만 `--file`·`--reply`는 링크를 따라가고 한도 없이 읽음(`/dev/zero`는 메모리가 찰 때까지). `readLocalFile` 하나로: O_NOFOLLOW, 정규 파일만, CLI frame(`cliFrameBytes`, transport와 공유) 이하. mutant 4개 모두 실패 | Principal은 bash가 없어 모델 경로로는 도달 불가였음(사람의 CLI나 Human이 설치한 도구만) |
| ENG1 엔진 0.87.1 (사용자 요청) | `cd389a1`…`157472b` | WP31의 별도 review/risk/test 항목으로 처리: 0.86.0–0.87.1 변경 기록을 WP27 inventory와 대조, `typebox`를 엔진 버전(1.3.27)에 맞춤, `PI_ADAPTER_REVISION`·BATCH-006을 `oma-pi-rpc-v1@0.87.1`로(영수증이 검증된 엔진을 말하게). V27A·T116·T117·V31A/B·package·전체 lane 통과 | 기존 society는 미정산 배치를 모두 정산한 뒤 업그레이드(0.85.1 adapter 영수증은 conflicting으로 보존), 무관한 조항의 기존 trace drift는 그대로 |
| 재검토·적대적 | `f11c302`…`dea19b8` | 계획 oracle 73개의 담당·lane 필수 검사(`oracle-map.json`), 이전 카드 guard mutant 30개 중 생존 10개(공백 9·동치 1), 공백 8개에 oracle 추가, actor socket·relay 연결 수 상한, 시계보다 앞선 status view를 unknown으로 | 한 파일 읽기 도중 변경(WP12)은 결정적 재현 불가 |
| Priority 0 (사용자 결정) | 문서 `93f4a81`, `1704308`; 수정 `9a13f1b`…`76a6827`; 규범 `1b3827c` | DR9: batch incarnation은 첫 전달 시도로 고정, rollover는 agent incarnation만 올리고, 이전 시도의 receipt는 새 run 뒤에도 재전달 없이 정산. receipt 판정 owner `deliveryDecision` 하나. `updateAgent`는 고정 spec을 다시 쓰지 않고 lease는 증가만. DR10: startup이 accept되지 않은 op의 artifact를 수집. DR11: receipt는 session entry를 찾고 fsync한 뒤에만. DR12: inline·bundle 설정 commit owner 하나. DR13: 모름에는 모름의 코드(`unobserved`, `publishedUnconfirmed`, CLI·Control Panel exit은 `errorExit` 하나). P0-7: durable 경계 58개를 코드에서 뽑고 경계마다 kill·retry·restart 시험을 요구하는 `check:boundaries`. P0V-24(14차 점검): Control Panel은 저장 시도마다 설정을 다시 읽음. 변이 25개 중 24개 실패, 1개 등가 | 기존 society에서 v1이 이미 재할당한 batch는 저장된 값을 첫 시도로 읽는다(그보다 이른 시도의 receipt는 전처럼 conflicting). 14차 실제 provider 점검(수동, lane 증거 아님)이 DR9·DR10·DR11·DR12·DR13과 재전달 알림을 확인 |

부수 수정: kernel/crash fixture의 systemd 257 호환(`list-unit-files` 무일치 exit 1, stop 후 disable), `/usr/bin/node` 가정 제거, crash hook의 descriptor 기준 rename 해석, 오래된 kernel 시험 기대값 갱신.

## 6. 이전 세션에서 완료한 카드

| 1 | WP00 기준선 | (docs) | 기준 SHA·dirty tree·파일 배정·기존 finding 재분류. production 변경 없음 | runtime 증명 아님 |
| 2 | WP01 결정 | `6cefe52`…`53c7087` | `implementation/consistency-decisions.md`에 D01/D02/D04/D05/D06 ACCEPTED, D03은 NEEDS_RUNTIME_EVIDENCE(WP03) | runtime gate는 각 WP 소관 |
| 3 | WP02 fixture | `9272674`…`8669274` | production 경계를 통과한 완전 config fixture, 독립 관측 도구, checkpoint 기반 crash driver | 실제 user-manager 아님 |
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

## 6a. 실제 provider 기능 점검 (준비 완료, 사용자 승인 대기)

`/home/dev/oma-evidence/provider/`: 샘플 프로젝트 `project/`(notes-cli), 시험 society `provtest`(`data/oma/provtest`, 엔진 설정 openai-codex / gpt-6-luna / high), `drive.py`(pty로 `oma --society provtest --bind-project`를 띄우고 `tty.log`에 화면, `tty.in` FIFO로 입력), `monitor.mjs`(읽기 전용 감시), `prompt.txt`(역할을 무시하고 모든 기능을 점검하라는 사용자 프롬프트). 사용자가 `~/.pi/agent/auth.json`을 `data/oma/provtest/pi/auth.json`(0600)으로 직접 복사하고 시작을 승인해야 한다(에이전트의 자격 증명 접근과 자율 세션 실행은 자동 권한 검사가 막음). 끝나면 oma 종료, unit 정리 확인, 복사한 `auth.json` 삭제.

## 7. 다음에 할 일

모든 카드와 Priority 0 점검·검증은 끝났다. release 승인에 남은 것:

1. 승인된 VM에서 powercut(V05C·V30B), 승인된 credential로 실제 provider, push 뒤 CI(V32B) — 모두 사용자 승인 필요.
2. 보류한 결정: `bin`/설치 명령(C2), WP03 이전 Resident unit의 재생성 절차, 전체 `oma` entry의 pty 시험(최상위 catch 정리 순서), rollover 뒤 endpoint bind 실패의 별도 주입.
