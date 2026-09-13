# OMA v2 — 코드 이행 감사 C01–C07 후속 인계

## 0. 현재 결론

사용자가 첨부한 `01_CODE_CONFORMANCE_REPORT.md`와 `02_CARD_CONFORMANCE.md`를 기준으로 확인된 source 반례와 통합 불일치를 다시 대조하고 수정했다. **코드·시험·검사기 수정은 master에 반영했지만, 원본 41개 카드의 완전한 이행·검증을 승인하지 않는다.**

C01/C02의 old action replay fence, 확인한 C03 phase2/phase4 정상 fixture, C04 actual owner 정책, C07 actual lifecycle sequence를 수정·추가했다. C05는 inventory 생성/검사 도구를 보강했으나 실제 generated list/LOC/hash는 여전히 STALE다. C06의 전체 실행 및 성능·설치·새 source-bound evidence는 NOT_RUN이다. 다른 legacy fixture 전체와 모든 AST/runtime 경로는 이번에 전수 감사하지 않았다.

현재 상세 기준은 [C01–C07 후속 기록](implementation/conformance-followup.md)과 [검증 상태](implementation/validation.md)다. 기존 41개 카드 marker, R37/R39 상세 commit 및 이전 인계는 [감사 기준 SHA의 HANDOFF](https://github.com/minjung2035/oma-v2/blob/2a00fa20dae8f68d8f489401ba821c16d3c35fc4/HANDOFF.md)에 보존했다. 과거 DONE은 재개 위치이며 이번 finding의 해소 또는 runtime PASS를 뜻하지 않는다.

## 1. source 기준과 작업 방식

- 저장소/브랜치: `minjung2035/oma-v2`, 기존 `master`.
- 첨부 감사 및 이번 수정 시작 SHA: `2a00fa20dae8f68d8f489401ba821c16d3c35fc4`.
- 원본 계획 분석 SHA: `5b4ffe1238af00aac4a569a5c4d7d9e71092dea0`.
- 마지막 source/test 변경 확인 commit: `b9c7267d7b9764fd6f2608b22d32f4e11a1be751`.
- 최종 인계 commit: 이 파일을 갱신한 R39 DONE_WITH_BLOCKED_SUBSTEPS commit. 자기 SHA를 예측하지 않는다.
- 저장소 읽기/쓰기/commit은 GitHub plugin으로 수행했다. 로컬 checkout 편집, branch/PR 생성, history rewind 또는 실제 운영 DB/Git/unit 조작은 하지 않았다.

R00은 계속 NO_CODE_CHANGE다. 기존 카드 순서를 다시 계산하거나 R01부터 재시작하지 않았다. 보고서가 지목한 미충족 경계를 중심으로 작업했다.

## 2. finding별 재개 상태

| finding | 수정한 범위 | 미완료 또는 미확인 |
|---|---|---|
| C01 / R25 | accepted desired/previousIncarnation과 현재 target의 exact 관계를 before-effect에서 검사. 최신 stopped 의도를 old start가 덮지 않음 | 실제 회귀 실행 및 native start/stop 경합 |
| C02 / R25/R16 | stop은 frozen epoch만 사용. 현재 enabled incarnation 2에 old epoch 1 stop을 재발행하지 않음 | kernel/cgroup 증거. 역사적 효과를 증명할 수 없는 요청은 unknown으로 보존 |
| C03 / R32 | phase4 canonical seed/auth/hash/epoch/cleanup, phase2 actual Mail/Store/batch 정상 fixture 이관 | 다른 legacy phase/audit 전역 이관, expanded 실행 개수·도달성 비교 |
| C04 / R34 | exact protocol transport 및 named process owner 정책. Units와 CLI 중복 native spawn 제거. forbidden neighbor/type-only 대조군 | 전체 compiler/AST/SCC gate 실행. 미검토 finding이 없다고 단정하지 않음 |
| C05 / R38 | recursive inventory와 stale-list gate, inventory-only/full-cloc 분리 | actual production-files/LOC/hash 재생성과 installed closure. 현재 산출물은 STALE |
| C06 / R35/R37/R39 | 새 필수 oracle의 기존 lane 연결과 명시적 검증 상태 | typecheck/build/full lanes/native/package/performance/source-bound proof NOT_RUN |
| C07 / R36 | actual public dispatch → lifecycle → actions를 호출하는 seeded retry corpus/sequence와 minimizer | 실행·축소 결과, actual kernel/SIGKILL과는 별도 범위 |

normal/recovery를 무조건 같은 재실행 함수로 합치지 않았다. 공통화한 것은 frozen intent/current state 관계 검사다. terminal plan/result bytes, 현재 권한 검사, 원래 key를 보존한다. target desired나 accepted plan을 최신 상태로 고쳐 false success를 만들지 않는다.

## 3. 시험 범위

`test/r25-action-replay.test.ts`는 pending/unknown × normal/recovery에서 desired 단독, incarnation 단독, 둘 다 변경된 경우를 구분한다. C02의 정확한 조합인 old stop epoch 1 / current enabled epoch 2 / controlled active unit도 포함한다. unchanged 대조군, terminal replay bytes, stale/revoked caller, GOAL, provisioning/retired 및 unknown death를 함께 둔다.

`test/r36-lifecycle-sequences.test.ts`는 실패한 실제 action 접수 뒤 새 start/stop 의도를 실제 dispatcher로 실행한다. 새 epoch 발급만 명시적인 외부 runner event로 표현하며 start/stop을 DB write로 대체하지 않는다. 현재 enabled 새 epoch를 유지하는 C02 corpus와 동일 desired의 epoch 변경 대조군을 별도로 보존한다. 입력 seed·scenarioRevision·PRNG와 실패 축소 artifact는 실제 test 실행 시 기록한다.

두 시험 모두 actual Store/codec/authority/lifecycle를 사용하지만 **Units는 명시적인 포트 대역**이다. 이것을 actual authenticated Unix socket, systemd start/stop, cgroup death 또는 SIGKILL evidence로 보고하지 않는다.

phase2/phase4의 기존 시험 제목과 핵심 음성 조건은 유지하는 방향으로 수정했다. production decoder를 완화하거나 기존 kernel/crash lane을 삭제하지 않았다. 전체 실행 개수 보존과 모든 negative oracle 도달성을 확인한 것은 아니다.

## 4. commit 색인

주요 source/test/tooling commit 17개는 [후속 기록 §8](implementation/conformance-followup.md)에 있다. 이후의 추가 변경은 다음과 같다.

| commit | 내용 |
|---|---|
| `8bfc9aca7b1e22780cb9f3666ebe72bc1580165a` | C01–C07 source/evidence 상태 및 주요 commit 기록 |
| `29b5ee3ff75c38434bd55cce2cd922d951b1f3a0` | 현재 validation과 기존 VAL 규범 보존 |
| `c2371902ddba59c13f11b0a0cdbafdab8eb1151f` | root validation 색인 갱신 |
| `c0ae67851ae00faaaeb0395c0dae540b042c31a3` | exact enabled-new-incarnation C02 및 독립 조건 회귀 보강 |
| `b9c7267d7b9764fd6f2608b22d32f4e11a1be751` | actual lifecycle sequence의 exact C02 corpus 보강 |
| 이 파일의 commit | R39 후속 인계 종료 및 미충족 범위 기록 |

## 5. 실제 재검증의 시작점

현재 `production-files.txt`는 옛 source list다. 실제 source root에서 `npm run inventory`를 실행해 생성하고 `npm run check:inventory`로 대조해야 한다. 새 생성 모드는 목록만 쓰고 LOC/hash를 측정했다고 주장하지 않는다. full `node scripts/loc.mjs`는 cloc 2.08과 기존 systemd filter를 요구한다. 이전 목록·LOC/hash를 직접 고쳐 새 측정처럼 표시하지 않는다.

그 뒤 pinned TypeScript/lockfile 및 실제 Node/native 지원을 확인하여 typecheck → build → package → architecture/transactions → 해당 verification lane을 실행한다. lane마다 `--out <존재하지 않는 새 디렉터리>`가 필요하다. 전체 명령 예시는 후속 기록 §7에 있다. runtime failure를 product/setup/environment/미도달 oracle로 구분하고 skip/todo/삭제로 PASS를 만들지 않는다.

이 순서는 이번에 실행했다는 뜻이 아니다. 현재 `check:inventory`는 stale list를 거절하도록 연결돼 있으며, 그 실패를 우회하여 architecture가 통과했다고 기록하지 않는다.

## 6. 유지한 제한과 위험

- typecheck/build/test/package/architecture/transaction gate, 모든 verification lane, LOC/trace/report generator: NOT_RUN.
- C05 generated source inventory/LOC/pins: STALE, 실제 재생성 필요.
- 전역 normal fixture 이관과 전체 source compliance: 미확인. 일부 수정이 전체 해소의 증거가 아님.
- OPEN kernel/Pi/provider/S-03/S-04/S-01-CANDIDATE 및 tiered/clean-room gate 유지. 유료 provider, host reboot, VM power cut 미실행.
- wire v1, 기존 methods/errors, schema/DDL, accepted identity, fixed service 이름을 변경하지 않음. 새로운 daemon/queue/approval workflow를 만들지 않음.
- 과거 raw logs와 source pins는 역사적 증거로 보존. 이번 source에 재결합하지 않음.

최종 상태는 **확인된 코드 불일치에 대한 수정 및 회귀 작성 + 명시적으로 남은 C05/C06·전역 미검증 범위**다. 실행 검증된 배포본 또는 감사 전체 승인으로 취급하지 않는다.
