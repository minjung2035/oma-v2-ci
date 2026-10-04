# OMA v2 — 인계 (handoff)

작성: 2026-10-04. 이전 인계 파일(2026-10-03 감사 인계)은 시대가 지나 대체한다.
이 문서는 대화 압축·재시작 후에도 작업을 이어갈 수 있게 **권위 문서의 위치,
실행 지침, 현재 상태, 다음 순서**를 한 곳에 모은다.
*(추측)* 표시가 붙은 것은 확인되지 않은 추정이다 — 인계받는 쪽에서 재확인한다.

---

## 1. 저장소와 현재 상태

- 저장소: `/home/dev/oma-v2`, 브랜치 `feat/macos-hidden-vm`. 작업은 이 worktree에서 직접 한다
  (fix 브랜치 시대는 끝났고, 지금은 병합된 메인 브랜치에서 정리 라운드를 진행 중).
- 인계 시점 HEAD: `0cc115a` — 패키지 A(`local/@bare` 보존 + staging 파일 prune) 커밋됨.
  *(추측: 패키지 B가 끝나면 더 올라갈 수 있다 — `git log --oneline -5`로 확인할 것)*.
- 마지막 확인된 스위트 상태: **3482 pass / 5 fail** — 실패 5개 전부 의도적 stale 증거
  (아래 §6). 의도된 실패이므로 고치지 않는다.
- 게이트 통과 확인됨: `npm run build`, `npm run typecheck`, `npm run check:architecture`.
- 실행 중인 작업: 구현 에이전트 `4b6615e0`이 두 패키지를 수행:
  - 패키지 A(완료·커밋 `0cc115a`): `local/@bare` 설정된 복사본 삭제 버그,
    `.staging-local-*` 비-디렉터리의 Linux prune 중단 버그 — 회귀 테스트 포함.
  - 패키지 B(진행 중): 테스트 스위트 최적화 — serial PTY의 `wait:`→`expect` 전환,
    serial 목록 재감사, 감사 스캔 중복 제거, `npm test` 빌드 증분화.
    완료 기준은 전후 벽시계 측정과 TAP 수 유지.

## 2. 무엇을 하는 작업인가 (목표)

OMA v2(`oma-core-v1`)의 적대적 감사+경화. 원래 요청은 P0 위반과 일반 버그를 찾아
수정하는 것이었고, 범위가 확장되어 현재 목표는:

1. P0 위반·일반 버그·사용자 기대 미충족을 계속 찾아 **테스트와 함께** 수정.
2. 선행 작업 큐(§4)를 순서대로 구현.
3. 코드베이스 전체를 13기준으로 전수 탐색 (순수 내부 개선은 기록만).
4. 버그가 소진되면 테스트 보강을 반복.
5. 보강할 것이 없으면 종료하고 장부 기준 최종 보고를 **한국어로** 한다.

## 3. 권위 문서 지도 (먼저 읽을 것)

| 문서 | 역할 |
|---|---|
| `docs/WORKSTREAM.md` | **작업 헌장.** §2 = 13개 판별 기준, §3 = P0 불변식, §4 = 작업 프로토콜, §5 = 발견 이력, §6 = 선행 작업 큐, §7 = bundled extension 스펙, §8 = 명령 레퍼런스, §9 = 진행 로그, §10 = 실행 순서. 상태가 바뀌면 갱신한다. |
| `docs/user-expectation-ledger.md` | **사용자 기대 장부.** 모든 사용자-visible 결함을 UX-NN 번호로 기록 (증상·기준·결정·수정 커밋·테스트·상태). 최종 보고는 이 파일에서 만든다. |
| `docs/plan-prereq-and-bundled.md` | 선행 작업 설계서: Pi 1.0.1 마이그레이션 절차, TUI 4건, society 게이트+execve, egress 프록시(S-07), bundled extension 5종 순서와 원칙. |
| `docs/design-revisions.md` | 설계 결정록 — DR18(egress), DR25/C20(로컬 패키지), S-07/SB-004(project egress 보류→재개 조건) 등 "왜 이렇게 됐는지"의 근거. |
| `docs/implementation-spec.md`, `implementation/traceability.json` | 스펙·유닛 추적 — 문서↔인벤토리 drift는 `npm run check:spec-inventory`가 감시. |
| `docs/priority-0-audit.md`, `test/audit/` | 1차 전수 감사 결과(AV-번호)와 oracle 재현 스크립트. |
| `docs/implementation/validation.md` | 검증 기록 — 입력 digest·레인 상태. |
| `docs/simplification-audit.md` | v0.1 단순화 판정 기록. |
| `docs/HANDOFF.md` | 이 파일. |

## 4. 다음 실행 순서 (WORKSTREAM §10 기준 현재 위치)

- [~] 병합 트리 정리 라운드 — 검증 에이전트가 찾은 것을 구현 에이전트가 고치는 1↔1 루프 진행 중
- [ ] 패키지 A 완료 확인 + 패키지 B(테스트 최적화) 완료 → 검증 에이전트로 확인
- [ ] UX-09: submodule 있는 프로젝트가 통합 단계에서 불투명한 exit 125 → 명시적 거절 메시지+문서화 (장부에 결정 기록됨, 미구현)
- [ ] 선행 작업 큐 (`plan-prereq-and-bundled.md` 순서대로, 각 단계 뒤 검증):
  1. Pi 0.87.1 → 1.0.1 + open-tui 0.3.11 + pi-tui 1.0.1 원자 bump
  2. TUI 4건: compact 도구 메시지(Principal OMA 도구만), `/thinking show|hide`,
     미전송 큐 표시, 메일 역할명(worker1/2·principal)+Worker 메일 제목 지시
  3. society-off 재설계 (게이트+execve — 확정된 방향, §6-3/§C)
  4. egress 프록시(S-07 재개): host egress를 범용 HTTP CONNECT 프록시로 —
     allowlist·SSRF 차단·credential 비노출·`--unshare-all` 유지 (UX-08의 해결책)
  5. bundled extension: lsp → ask → hashline → web → mcp (WORKSTREAM §7 스펙)
- [ ] 코드베이스 전체 13기준 전수 탐색 — **하드코딩 숫자 제한 감사 포함** (기준 13:
  사용자 도달 가능한 무이름 제한 → named limit/거절 메시지; Pi 동일값은 제외)
- [ ] 버그 소진 후 테스트 보강 반복
- [ ] 마무리: stale 증거 fresh review 후 재바인딩(V01A·V32A×2·DR27·R38),
  validation digest 재생성, NOT_RUN 레인 정직 표기, 장부 기준 최종 한국어 보고

## 5. 실행 지침 (사용자가 정한 프로토콜 — WORKSTREAM §4의 최신 판)

- **서브에이전트는 동시에 1개뿐** (rate limit 학습 — 과거 5개 병렬이 주간 한도를 태웠다).
- 오케스트레이터(인계받는 쪽)는 읽기·조정·diff 리뷰·디스패치가 본분. 다만 사소하거나
  정확성이 중요한 수정의 직접 수정은 실제로 허용됐다(인계자가 local-package/service/
  테스트 리그를 직접 고쳤고 사용자가 이의 없이 진행을 지켜봤다 — *추측: 묵시 허용으로 읽힘*).
- 루프: 구현 에이전트 1개 → 검증 에이전트 1개(다른 리뷰어) → 발견 있으면 구현으로 회귀.
- **모든 버그 수정에는 회귀 테스트** (fail→pass). 검증 에이전트는 테스트 존재도 확인한다.
- 보류·spike로 남기지 않는다 — 실험하거나 추론으로 결정하고 결정+근거를 기록한다.
- 판정 규칙: 사용자가 겪는 문제는 내부 원인이어도 **구현**; 사용자에게 영향 없는
  순수 기술개선은 **기록만, 구현하지 않음**.
- 장부(`user-expectation-ledger.md`)는 발견 즉시 갱신 — 상태: 발견→결정→구현 중→수정됨→검증됨.
- 구현 에이전트 지시서에는 항상: 브랜치/HEAD 명시, 수정 금지 영역, 회귀 테스트 요구,
  완료 기준(빌드+타입체크+아키텍처+대상 테스트), 항목별 보고 형식을 담는다.

## 6. 테스트·빌드·검증 레퍼런스

```sh
npm run build                 # tsc → dist/ (테스트 전 필수; build가 dist를 지우므로 동시 실행 금지)
npm run typecheck
npm run check:architecture    # inventory+rules+lattice+transactions+boundaries+documents+spec-inventory
npm test                      # 전체 스위트 — 이 머신(8코어)에서 ~11.5분 벽시계
node --test dist/test/x.test.js          # 컴파일된 테스트 하나
node --test test/x.test.mjs              # mjs 테스트 하나
node scripts/loc.mjs --source-digests    # 소스 digest 재생성 (src 변경 후 필수)
npm run evidence:graph                   # dependency-graph.json 재생성
```

- 테스트 러너: `node scripts/test-local.mjs` — serial 5개 파일 후 병렬(기본 min(8,코어),
  `OMA_TEST_CONCURRENCY`로 조정). 인수를 받지 않는다(거절됨).
- 생성물(`production-files.txt`, `production-loc-hashes.json`,
  `implementation/evidence/dependency-graph.json`)은 손편집 금지 — 스크립트로 재생성.
- **의도적 stale 실패 5건** (fresh review+재바인딩 전까지 실패가 정상):
  `test/consistency-decisions.test.mjs` V01A,
  `test/review-closure.test.mjs` V32A×2 + DR27/V32A,
  `test/production-inventory.test.mjs` R38.
  `dist/test/scenario-agent-wait.test.js`의 DR27도 같은 묶음.
- NOT_RUN으로 유지할 레인(거짓 보고 금지): macOS/native, systemd(커널·crash·all),
  powercut, provider, release qualification.
- systemd 레인을 억제하는 환경은 runner가 자체 설정(`OMA_TEST_SYSTEMD=0`, guard import,
  가짜 DBUS 주소) — `npm test` 밖에서 직접 node --test를 돌릴 땐 이 세팅이 필요할 수 있다.

## 7. 지금까지의 결과 요약 (상세는 장부와 WORKSTREAM)

- fix 브랜치 9개 병합 완료: fi(Worker 개발환경: npm/git/quota/리소스),
  fh(보류 5건: egress·HOME·snapshot·probe·AV-15/17), fj(storage bounds),
  fo(제한값: PACKAGE_INDEX_BYTES 8MiB 등), fl(spec↔traceability+CI 검사),
  fg(dormant surfaces: toolSurface 선언 경로·registry wrap·replay fence),
  fm(로컬 패키지 설치+발견성), fk(readableRoots), fp(중복 제거+UX-10b+UX-19).
- 정리 라운드에서 추가로 잡혀 수정된 것: tar 디렉터리 엔트리 거절(실제 npm pack 불가),
  `ensure`의 `slice(0,-1)` 잘린 디렉터리, session.resume 스냅샷 누락,
  `update-` 마커 스쿼팅(접두사+파싱된 id 이중 방어), egress lease 누수,
  `RequestLedger.status` 키 바인딩, displayCopy null 프로토타입, `..foo`/prune 컴포넌트 판정,
  `+` 버전 스냅샷 부팅 거절, 워크플로우 job clock(210→240분).
- 사용자 기대 장부 상태: UX-01~07, 10~21, 23~29 전부 수정됨.
  미해결: UX-08(egress — 선행 작업), UX-09(submodule), UX-10b는 fp가 처리했다고 기록됨(검증 대상),
  UX-22+ (전수 숫자 감사 — 13기준 스캔에 편입).
- `"/ oma-deliver"`는 Pi 파서로 실험 확인해 닫음 — 공백 변형은 dispatch되지 않는다.
- mailBodyBytes 거절은 **버그 아님** 판정 (AV-07 바닥이 정확 — 픽스처만 상향).

## 8. 실행 제약

- push, PR, 배포 없음. 커밋만 로컬에.
- 보안 게이트·설정(minimumReleaseAge, 브랜치 보호 등)을 CI 통과 목적으로 바꾸지 않는다.
- 사용자가 직접 고친 파일(최근: validation.md digest, implementation-spec.md,
  resident-confinement.test.ts, WORKSTREAM.md, kernel-zones.mjs, dependency-lattice.mjs,
  settings.ts, pi-runtime.ts, tool-schema-golden.test.ts 등)을 되돌리지 않는다.
- 실제 사용자 OMA/VM·인증·유료 provider를 테스트에 쓰지 않는다 — fixture/loopback만.
- 생성물은 재생성으로만 갱신.
- 불확실하면 실험·추론으로 닫고 기록 — 미결 상태로 두지 않는다.
- 최종 보고는 장부 기준으로 "무엇을 더 찾았고 어떻게 고쳤는지"를 한국어로.

## 9. 재개 체크리스트

1. `git log --oneline -8`, `git status` — 실제 HEAD와 미커밋 상태 확인.
2. `docs/WORKSTREAM.md` §5·§9·§10과 `docs/user-expectation-ledger.md` 끝까지 읽기.
3. 실행 중이던 에이전트(4b6615e0)의 결과가 이미 커밋됐는지 확인 — 패키지 A/B 완료 여부.
4. 패키지 B 결과가 있으면 검증 에이전트 1개로 확인 → 그다음 §4 큐 순서대로 진행.
5. 모르면 실험. 추측으로 둔 채 진행하지 않는다.
