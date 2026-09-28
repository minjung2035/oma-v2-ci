# OMA v2 — 인계

다음 작업자의 재개점만 적는다. 시험 수·LOC·PASS 표와 알려진 한계는 [implementation/validation.md](implementation/validation.md), 문서의 역할과 우선순위는 [문서 지도](docs/README.md)가 소유한다.

## 1. 현재 판정 (2026-09-28)

- 브랜치 `feat/macos-hidden-vm`(`refactor/safety-preserving-architecture`의 `d4ed8b8`에서 나왔다). origin에는 v21 결박 커밋 `18421f0`까지만 push했다. 그 뒤의 커밋(5차·6차 점검, 시험 보강, macOS 구현, DR18, v22 결박)은 push하지 않았다. PR·merge는 하지 않았다.
- consistency plan의 카드 WP00–WP32와 그 뒤의 작업(재검토와 적대적 검증 AV1–AV8, 엔진 0.87.1 ENG1, 실제 provider 기능 점검 1–14차와 AV9–AV31, 설계 수정 DR1–DR18, Priority 0 점검 P0V-01–P0V-101, 시나리오 시험 SCN, macOS hidden-VM 플랫폼)을 모두 커밋했다. 마지막 통합 검증은 validation.md의 "현재 source 판정"(v22)이다.
- 외부 검토의 판정: 4차 P0V-25–P0V-53(DR14, DR15)은 priority-0-audit "4차 점검", 5차 P0V-56–P0V-73(DR16)은 "5차 점검", 6차 R6-01–R6-20(P0V-74–P0V-95, DR17)은 "6차 점검"에 있다. 시험 보강이 찾은 P0V-96·97도 그 표에, v22 결박의 lane이 찾은 P0V-98–P0V-101은 "v22 결박이 찾은 것"에 있다.
- **DR18(2026-09-27, 사용자가 선택을 맡김)**: 열린 spike S-01–S-11과 결정(macOS D-1·D-4·D-5·D-7·D-8·D-9·D-10, Q1–Q9, topic follow, C2 설치, 비용 상한)을 모두 판정했다. v1에 없다고 정한 것은 `UNSUPPORTED_PROFILE`로 거절하고 `SPIKE_UNRESOLVED`는 던지지 않는다. [macos-platform](implementation/macos-platform.md)은 수용된 규범이다. 판정표는 [design-revisions](implementation/design-revisions.md) DR18과 [spikes](implementation/spikes.md)의 "DR18 판정"에 있다.
- **release 미승인.** 남은 차단 요인은 powercut·실제 provider 자동 lane·CI(NOT_RUN, oracle V05C·V30B·V32B)와 macOS의 mac-* lane(Apple Silicon Mac 필요)이며 모두 사용자 승인이나 장비가 필요하다. A-008 LOC gate도 OPEN이다. 수동 provider 점검은 lane 증거가 아니다. 판정은 다음 명령으로 다시 확인한다.

  ```sh
  node --input-type=module -e 'const m=await import("./scripts/review-closure.mjs"); console.log(m.approval(".", undefined, await m.oracleFindings(".")))'
  ```

- V27A(실제 엔진), V28B(pty), V31A(설치 closure)는 저장소에 `engine`/`pty` lane이 없어 durable lane에서 돈다(bubblewrap·openssl·python3 필요, skip은 PASS가 아니다).

## 2. 지난 작업은 어디에 있는가

| 작업 | 결정과 근거 | 검증 |
|---|---|---|
| consistency plan WP00–WP32 | 카드 정의는 `oma-v2-consistency-plan-b25961c/`, 결정은 [consistency-decisions](implementation/consistency-decisions.md)의 D01–D06과 WP 절 | validation "계획 카드" |
| 재검토, AV1–AV8 | consistency-decisions의 "Re-review", "Whole-codebase adversarial pass" | validation "재검토와 적대적 검증" |
| ENG1 엔진 0.87.1 | consistency-decisions의 ENG1 | validation "엔진 0.87.1" |
| 실제 provider 점검 1–13차, AV9–AV31 | consistency-decisions의 AV 절, 화면 기록 `/home/dev/oma-evidence/provider/runs/` | validation "실제 provider 기능 점검" |
| 설계 수정 DR1–DR18 | [design-revisions](implementation/design-revisions.md) | validation "설계 수정", "Priority 0", "열린 결정과 spike(DR18)" |
| macOS hidden-VM 플랫폼 | [macos-platform](implementation/macos-platform.md)(DR18로 수용) | validation "macOS 플랫폼", `npm run verify:platform` |
| Priority 0, 14차 점검 | [PRIORITY-0](PRIORITY-0.md), [priority-0-audit](implementation/priority-0-audit.md) | validation "Priority 0" |

카드별 commit은 Git history에서 찾는다(예: `git log --oneline --grep 'WP13'`). 정리 전 이 문서에 있던 카드별 commit·한계 표는 [docs/archive.md](docs/archive.md)의 snapshot에 있고, 그 한계 가운데 지금도 유효한 것은 validation "알려진 한계"로 옮겼다.

## 3. 환경 (이 머신에 한정)

- 새 clone(`/home/dev/oma-v2`)이다. 이전 세션의 `/tmp` 증거·worktree와 사용자 formatting 변경은 이 clone에 없다.
- 일회용 systemd 계정 `omatest`(uid 1002, linger on, bubblewrap 설치, node 사본 `/opt/oma-test-node`)가 있고, `dev`는 `sudo -n -u omatest`만 비밀번호 없이 쓸 수 있다(`/etc/sudoers.d/oma-test`). 되돌리기: `loginctl disable-linger omatest; userdel -r omatest; rm /etc/sudoers.d/oma-test; rm -rf /opt/oma-test-node`.
- `cloc` 2.08은 `~/.local/bin/cloc`(공식 릴리스 perl 스크립트).
- 이 host의 차이: systemd 257, Linux 6.12(제거된 cgroup fd의 nlink가 2로 남음), util-linux 2.41(`unshare --forward-signals` 없음), `/usr/bin/node` 없음, ripgrep 없음(봉인된 Resident의 `rg`도 없음, SB-007).
- 실제 provider 점검 환경 `/home/dev/oma-evidence/provider/`: `data/oma/provtest/`가 test society state다. 그 `pi/auth.json`은 사용자가 이 컴퓨터의 Pi에서 직접 복사한 OAuth credential이며 내용은 읽지 않았다. society는 기본 설정에서 Control Panel로 Worker integrate를 켜고 Worker limit을 7로 둔 상태다(14차의 lost update 점검에서 운영자가 손으로 두 번 바꿨고, 마지막 값 7은 Control Panel이 저장했다). 13차 state는 `archive/run13-state`(credential 없음). 사용자 user manager에 `oma-provtest-*` unit이 남아 있다.

## 4. 도구와 검증 절차

증거는 `/home/dev/oma-evidence/`(재부팅에도 남는 위치)에 있다.

- `tools/sync-omatest.sh`: dev 트리(HEAD+작업 트리)를 `~omatest/oma-v2`로 복제.
- `tools/as-omatest.sh '<cmd>'`: omatest의 user manager 환경에서 명령 실행.
- `tools/run-lanes.sh <dir> <label> [kernel] [crash]` (`BASE=<commit>`, `SKIP_LOCAL=1` 선택): `BASE`(기본 HEAD)의 clean worktree + dev의 `validation.md`로 fast/durable/property/stress/platform/package/local을 돌리고, 같은 bytes로 omatest에서 kernel/crash를 돌린다. `<label>-summary.txt`, `<label>-digest.json`을 남긴다.
- `tools/wp-validate.py <repo> <spec.json>`: `validation.md`의 "현재 source 판정" 절(다음 `##` 제목까지)과 A-008 수치를 다시 쓰고 digest를 결박한다. 브랜치 이름은 spec의 `branch` 또는 현재 브랜치다. spec의 `groups`는 주제별 표가 된다. 회차별 spec은 `v<N>/validation-spec.json`(v22는 `v22/build-spec.py <parent> <label>`이 v21의 것에서 만든다).
- `tools/mutants.py <spec.json> <out.json>`: omatest의 복사본에서 mutant마다 한 곳을 바꿔 build·시험. `INVALID`(적용/빌드 실패)와 `SURVIVED`를 구분한다.
- `v1/`–`v22/`: 통합 검증 회차별 initial/final lane 산출물. `wp*/`: 카드별 red·baseline·mutant 결과. `adversarial*/`: 적대적 검증 산출물.
- `provider/`: 실제 provider 점검. `drive.py`(pty에서 `oma --society provtest` 실행, 입력은 `tty.in` FIFO, 화면은 `tty.log`), `monitor.mjs`(society 읽기 전용 요약, credential은 읽지 않음), `prompt*.txt`(회차별 지시), `runs/`(회차별 화면 기록), `archive/`(회차별 state). 다시 빌드한 뒤에는 CFG-001에 따라 운영자로서 config의 `deploymentDigest`를 다시 고정한 뒤 실행한다.

검증 절차: 코드 커밋 → spec 작성 → `wp-validate.py`로 1차 결박 → `run-lanes.sh … initial kernel crash` → 결과를 spec에 넣고 2차 결박 → `… final kernel crash` → 커밋될 트리의 digest가 final과 같은지 확인 → validation.md(+HANDOFF) docs commit. `implementation/` 아래 문서를 바꿔도 digest가 바뀌므로 다시 결박한다.

## 5. 작업 규칙

- 계획 디렉터리는 수정하지 않는다(`sha256sum -c SHA256SUMS.txt`). architecture.md도 N-001 결박 때문에 고치지 않는다.
- 계획에 없는 schema·wire·receipt version·권한 변경, NOT_RUN/BLOCKED를 PASS로 바꾸기, 실제 credential·유료 provider 사용(사용자 승인 없이), VM 전원 차단, PR·merge는 하지 않는다. push는 사용자가 승인한 때만 한다.
- 커밋은 정확한 경로만 `git add`하고, 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `src/mail/`은 gitignore의 `mail`에 걸리므로 그 아래 새 파일은 `git add -f`로 따로 추가한다.
- 새 production 파일은 `scripts/kernel-zones.mjs`에 zone을 등록하고, 순수 kernel 파일은 `node:crypto` 같은 효과 capability를 import하지 않는다.
- 소스 변경 뒤에는 `npm run evidence:graph && node scripts/loc.mjs && npm run check:architecture`를 커밋 전에 돌린다. gate는 파이프(`| tail`)로 감추지 말고 종료 코드로 판단한다.
- 전체 `npm test`를 도는 중에는 같은 트리에서 `npm run build`를 하지 않는다(dist가 바뀌어 대량 실패).

## 6. 남은 일

1. **push (사용자 결정)**: v21 뒤의 커밋 전부(5차·6차 점검, 시험 보강, macOS 구현, DR18)를 v22로 결박했다. push할지는 사용자가 정한다.
2. **release gate**: 승인된 VM에서 powercut(V05C·V30B), 승인된 credential로 실제 provider 자동 lane(사용자 승인 필요). CI(V32B): `6787211`과 `18421f0`의 Actions run이 failure였다(두 외부 검토의 관측; `6787211`의 run은 4초 만에 artifact 없이 끝나 checkout 전의 실패로 보인다). 여기서는 로그를 읽을 수 없으니 GitHub에서 원인을 확인해 기록한다.
3. **보류한 결정과 검증 공백**: validation "알려진 한계"의 마지막 항목이 목록을 소유한다. 4차 점검이 남긴 세 판단은 DR14로, 열린 spike와 결정은 DR18로 정했다. 5차 점검의 두 검토가 낸 구조 개선 제안(S01–S14, 둘째 검토 §9)은 지적이 아니라 판정하지 않았다(priority-0-audit "5차 점검").
   macOS: Swift helper(`platform/host/vmhelper`)와 OMA.app, guest image build, mac-* lane은 Apple Silicon Mac에서만 빌드·시험한다(NOT_BUILT/NOT_RUN). Linux에서 도는 부분은 `verify:platform`이다.
4. **시나리오 시험 (사용자 지시)**: 모델만 대본인 시나리오 시험 54개를 만들었다(Principal 33, Resident·society 14, 봉인·git 7; fixture는 test/fixtures/README의 Scenario 층). 이 층이 P0V-54·55를 찾았다. 사용자 방향은 이 유형이 시험의 더 큰 몫이 되는 것이므로, 사용자 흐름을 바꿀 때마다 시나리오를 더한다(MAINTENANCE §25). 아직 없는 것: 설치된 제품 전체를 pty로 도는 시나리오(`oma` 진입점), 여러 Resident의 동시 run(대역 cgroup 한계), 실제 systemd에서의 unit 경로(kernel lane).
5. **provtest 정리 (사용자 결정)**: 점검을 끝내면 `for u in $(ls ~/.config/systemd/user | grep '^oma-provtest-'); do systemctl --user stop "$u"; rm -f ~/.config/systemd/user/"$u"; done; systemctl --user daemon-reload; rm -rf /home/dev/oma-evidence/provider/data`(credential 사본 포함).

## 7. 바꾸지 않은 것

architecture.md(N-001), 계획 디렉터리, wire·DB schema·receipt 형식(receipt의 adapter revision만 ENG1에서 `oma-pi-rpc-v1@0.87.1`), 여섯 durable entity.
