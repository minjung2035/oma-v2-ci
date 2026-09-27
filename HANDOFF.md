# OMA v2 — 인계

다음 작업자의 재개점만 적는다. 시험 수·LOC·PASS 표와 알려진 한계는 [implementation/validation.md](implementation/validation.md), 문서의 역할과 우선순위는 [문서 지도](docs/README.md)가 소유한다.

## 1. 현재 판정 (2026-09-26)

- 브랜치 `refactor/safety-preserving-architecture`. 사용자 승인으로 origin에 push했다(2026-09-26). PR·merge는 하지 않았다.
- consistency plan의 카드 WP00–WP32와 그 뒤의 작업(재검토와 적대적 검증 AV1–AV8, 엔진 0.87.1 ENG1, 실제 provider 기능 점검 1–14차와 AV9–AV31, 설계 수정 DR1–DR13, Priority 0 파일 단위 점검 P0V-01–P0V-24)을 모두 커밋했다. 마지막 통합 검증은 validation.md의 "현재 source 판정"(v20)이다. v20은 initial lane 8개가 모두 PASS였고, final은 사용자 요청으로 끝나기 전에 멈췄다.
- 그 뒤 외부 전수 검토(기준 `6787211`)를 판정한 4차 점검 P0V-25–P0V-53을 고쳤다(`37cbeee`–`c980611`, 기록은 priority-0-audit "4차 점검"). 관련 시험 묶음만 돌렸고 **검증 cycle로 결박하지 않았다**. 그래서 지금 트리에서는 fast lane의 R38 시험이 실패한다. 결박(v21)은 몇 시간 걸리므로 사용자에게 먼저 묻는다.
- **release 미승인.** 남은 차단 요인은 powercut·실제 provider 자동 lane·CI(NOT_RUN, oracle V05C·V30B·V32B)이며 모두 사용자 승인이 필요하다. A-008 LOC gate도 OPEN이다. 수동 provider 점검은 lane 증거가 아니다. 판정은 다음 명령으로 다시 확인한다.

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
| 설계 수정 DR1–DR14 | [design-revisions](implementation/design-revisions.md) | validation "설계 수정", "Priority 0" |
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
- `tools/run-lanes.sh <dir> <label> [kernel] [crash]` (`BASE=<commit>`, `SKIP_LOCAL=1` 선택): `BASE`(기본 HEAD)의 clean worktree + dev의 `validation.md`로 fast/durable/property/stress/package/local을 돌리고, 같은 bytes로 omatest에서 kernel/crash를 돌린다. `<label>-summary.txt`, `<label>-digest.json`을 남긴다.
- `tools/wp-validate.py <repo> <spec.json>`: `validation.md`의 "현재 source 판정" 절(다음 `##` 제목까지)과 A-008 수치를 다시 쓰고 digest를 결박한다. spec의 `groups`는 주제별 표가 된다. 회차별 spec은 `v<N>/validation-spec.json`.
- `tools/mutants.py <spec.json> <out.json>`: omatest의 복사본에서 mutant마다 한 곳을 바꿔 build·시험. `INVALID`(적용/빌드 실패)와 `SURVIVED`를 구분한다.
- `v1/`–`v19/`: 통합 검증 회차별 initial/final lane 산출물. `wp*/`: 카드별 red·baseline·mutant 결과. `adversarial*/`: 적대적 검증 산출물.
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

1. **release gate**: 승인된 VM에서 powercut(V05C·V30B), 승인된 credential로 실제 provider 자동 lane(사용자 승인 필요). CI(V32B)는 push했으므로 GitHub Actions 결과를 확인해 기록한다.
2. **보류한 결정과 검증 공백**: validation "알려진 한계"의 마지막 항목이 목록을 소유한다. 4차 점검이 남긴 세 판단은 DR14로 정했다(P0-4 적용 범위, 결과 크기는 v1 한계, unit 이름 유지).
3. **4차 점검의 결박(v21)**: 위 §1. 사용자 승인 뒤 §4의 검증 절차로 한다.
4. **가짜 provider 시나리오 시험 (사용자 지시, 구조개선 다음)**: 번들 엔진·확장·broker는 진짜로 두고, provider 경계에 결정적 대본을 두는 시험을 기능별·루프별로, 정상과 장애(kill·재시작·재시도·끊김) 경우 모두 크게 늘린다. 실제 provider 증거로 기록하지 않는다(P0-5).
5. **provtest 정리 (사용자 결정)**: 점검을 끝내면 `for u in $(ls ~/.config/systemd/user | grep '^oma-provtest-'); do systemctl --user stop "$u"; rm -f ~/.config/systemd/user/"$u"; done; systemctl --user daemon-reload; rm -rf /home/dev/oma-evidence/provider/data`(credential 사본 포함).

## 7. 바꾸지 않은 것

architecture.md(N-001), 계획 디렉터리, wire·DB schema·receipt 형식(receipt의 adapter revision만 ENG1에서 `oma-pi-rpc-v1@0.87.1`), 여섯 durable entity.
