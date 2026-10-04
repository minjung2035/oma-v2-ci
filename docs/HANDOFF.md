# OMA v2 — 인계 (handoff)

작성: 2026-10-04 (세 번째 개정). 이 문서는 대화 압축·새 세션에서도 작업을 이어갈 수
있게 **권위 문서 위치, 실행 지침, 현재 상태, 다음 순서**를 한 곳에 모은다.
*(추측)* 표시가 붙은 것은 미확인 추정 — 인계받는 쪽이 먼저 확인한다.

---

## 1. 저장소와 현재 상태 (한눈에)

- 저장소: `/home/dev/oma-v2`, 브랜치 `feat/macos-hidden-vm`. 메인 worktree에서 직접 작업.
- 인계 시점 HEAD: **`20c3e5b`** — P0-8 owned-state 전수 마이그레이션 + 정적 규칙.
  `git log --oneline -8`로 실제 HEAD 확인.
- 스위트 상태: **`npm test` 3559/3559 통과, 실패 0** — 과거 "의도적 stale 실패 5건"
  (V01A·V32A×2·DR27·R38)은 20c3e5b에서 fresh review 후 **재바인딩 완료**. 더 이상
  빨간 상태가 정상이 아니다 — 실패가 나오면 진짜다.
- NOT_RUN 유지: systemd 필수 테스트 파일 9개(audit, audit2, cli, phase4, phase5,
  phase8, crash-boundaries, launch-topology, cgroup-pin), macOS/native, powercut,
  provider, release qualification — **거짓 보고 금지**.
- 벽시계: `npm test` ≈ **4~5분** (최적화 후), `npm run build` cold ~19s / stamp hit ~3s.
- 게이트: `npm run build`, `typecheck`, `check:architecture` 전부 통과 확인됨.
- 오래된 stash `stash@{0}` (6월 작업 백업) — 건드리지 않기로 결정됨, 그대로 둠.

## 2. 무엇을 하는 작업인가

OMA v2(`oma-core-v1`) 적대적 감사 + 경화 + v0.1 선행 작업. 목표 순서:

1. P0 위반·일반 버그·사용자 기대 미충족을 계속 찾아 **테스트와 함께** 수정.
2. 선행 작업 큐(§4) 구현.
3. 코드베이스 전체 13기준 전수 탐색 (사용자 영향 없는 순수 내부 개선은 기록만).
4. 버그 소진 → 테스트 보강 반복 → 보강할 것 없으면 종료.
5. 장부 기준 최종 보고 — **한국어**.

## 3. 권위 문서 지도 (재개 시 이 순서로 읽기)

| 문서 | 역할 |
|---|---|
| `docs/WORKSTREAM.md` | **작업 헌장.** §2=13 판별 기준, §3=P0 불변식, §4=작업 프로토콜, §5=발견/수정 이력 전체(7개 검증 라운드의 상세 기록), §6=선행 작업 큐, §7=bundled extension 스펙, §8=명령 레퍼런스, §9=진행 로그, §10=실행 순서. 상태가 바뀌면 갱신. |
| `docs/user-expectation-ledger.md` | **사용자 기대 장부.** UX-01~30 기록됨. 최종 보고는 이 파일에서 만든다. |
| `docs/PRIORITY-0.md` | **최상위 원칙.** 명제 + P0-1~8 하위 규칙 + 판정 질문 + 문서 적용 표 + 원칙 자체 검증 절차. **P0-8**(소유 상태 접근은 손상 전제)이 이번에 추가된 최신 규칙. |
| `docs/design-revisions.md` | 설계 결정록 DR1~DR32. **DR32** = P0-8 도출 근거(4라운드 같은 원인 반복). DR18(egress), DR25(로컬 패키지), DR29(guest handoff), DR31(confined-only) 참조 빈도 높음. |
| `docs/plan-prereq-and-bundled.md` | 선행 작업 설계서: Pi 1.0.1 마이그레이션 절차·TUI 4건·society 게이트·egress·bundled ext 5종. 초기 계획안 취급(100% 신뢰 금지). |
| `docs/implementation-spec.md` + `implementation/traceability.json` | 스펙·유닛 추적. drift는 `check:spec-inventory`가 감시. |
| `docs/priority-0-audit.md`, `test/audit/` | 1차 전수 감사(AV-01~31, NB-01~28) + oracle 재현 스크립트. |
| `docs/implementation/validation.md` | 검증 기록·입력 digest·레인 상태. |
| `docs/simplification-audit.md` | v0.1 단순화 판정 기록(유지/제거 결정). |
| `implementation/review-ledger.json` 등 `implementation/` | 리뷰 원장·durable 경계·traceability 메타데이터 — 생성물이므로 재생성으로만 갱신. |

## 4. 다음 실행 순서 (현재 위치 기준)

**방금 닫힌 것**: P0-8 owned-state wedge 부류 — 6라운드 맹검증·수정으로 수렴,
`owned-state` 정적 규칙이 재발을 정적으로 차단. 자세한 이력은 WORKSTREAM §5.

남은 큐:

- [ ] **방금 배치의 맹검증** — `20c3e5b`(+그 직전 `76f3293`, `7f9f02a`)은 구현
  에이전트의 자체 검증만 거쳤고 아직 독립 맹검증이 안 지나감 *(추측: 3559/3559라
  큰 문제는 없을 가능성이 높지만 규칙상 확인 필요)*.
- [ ] **UX-09** — submodule 있는 프로젝트가 통합 단계에서 불투명한 exit 125
  → 명시적 거절 메시지 + 문서화 (장부에 결정 기록됨, 미구현).
- [ ] 선행 작업 큐 (`plan-prereq-and-bundled.md` 순서, 각 단계 뒤 맹검증):
  1. Pi 0.87.1 → **1.0.1** + open-tui 0.3.11 + pi-tui 1.0.1 원자 bump
  2. TUI 4건: compact 도구 메시지(Principal OMA 도구만·표시명만), `/thinking show|hide`,
     미전송 큐 표시, 메일 역할명(worker1/2·principal)+Worker 메일 제목 지시
  3. society-off 재설계 — 확정: 게이트+execve (plan §C)
  4. **egress 프록시**(S-07 재개): host egress를 범용 HTTP CONNECT 프록시 —
     allowlist·SSRF 차단·credential 비노출·`--unshare-all` 유지 (UX-08 해결책)
  5. bundled extension: lsp → ask → hashline → web → mcp (WORKSTREAM §7 스펙,
     vendor 원칙: 소스 내장·offline 즉시 로드·runtime fetch 금지·경계 어댑터만 얇게)
- [ ] 코드베이스 전체 **13기준 전수 탐색** — 하드코딩 숫자 제한 감사 포함
  (기준 13: 사용자 도달 가능한 무이름 제한 → named limit/거절 메시지; Pi 동일값 제외)
- [ ] 버그 소진 후 테스트 보강 반복
- [ ] 마무리: darwin 구조 리뷰 잔여(§6), validation digest는 이번에 갱신됨,
  NOT_RUN 레인 정직 표기, 장부 기준 최종 한국어 보고

## 5. 실행 지침 (사용자가 정한 프로토콜 — WORKSTREAM §4 판)

- **서브에이전트 동시 1개** (rate-limit 학습 — 5개 병렬이 주간 한도를 태움).
- 오케스트레이터는 읽기·조정·diff 리뷰·디스패치가 본분. 사소하거나 정확성이
  중요한 수정의 직접 수정은 실제로 해왔다 *(추측: 묵시 허용)*.
- 루프: 구현 에이전트 1개 → **맹검증** 에이전트 1개 → 발견 있으면 다시 구현.
- **맹검증 규칙(중요)**: 검증 지시서에 무엇을 고쳤는지·어디를 보라는지 상세 범위를
  주지 않는다 — 확인 편향이 생긴다. "최근 커밋 ~6개를 git log/diff로 스스로 정해
  검증하라" 수준으로만 쓴다 (사용자 지시 2026-10-04, WORKSTREAM §4·커밋 458b385).
- **모든 버그 수정에는 회귀 테스트** (fail→pass 증거). 검증자는 테스트 존재도 확인.
- 보류·spike로 남기지 않는다 — 실험하거나 추론으로 결정하고 결정+근거 기록.
- 판정: 사용자가 겪는 문제는 내부 원인이어도 **구현**; 사용자에게 영향 없는
  순수 기술개선은 **기록만**.
- 장부(`user-expectation-ledger.md`)는 발견 즉시 갱신.
- **같은 부류가 반복되면 원칙을 의심** — P0-6/원칙 검증 절차대로 하위 규칙을
  PRIORITY-0에 먼저 추가하고 코드를 도출한다 (P0-8이 그 사례).
- 구현 에이전트 지시서에는: 브랜치/HEAD, 수정 금지 영역, 회귀 테스트 요구,
  완료 기준(build+typecheck+check:architecture+대상 테스트), 보고 형식.

## 6. 이번 세션의 큰 작업 — P0-8 wedge 부류 (완료)

**배경**: `local-package`/stage prune의 `local/@bare` 삭제 버그에서 시작해,
맹검증 6라운드가 같은 원인을 계속 찾아냄 — **OMA 소유 트리의 메타데이터
(권한 비트·엔트리 종류·존재)를 정상 가정**하는 코드가 목록→삭제→게시→index
경로에서 순서대로 뚫림 (같은 UID stray/interrupted writer가 mode-000 등을
남길 수 있다는 전제).

**해결**: 원칙 먼저 추가 (사용자 제안):
- `PRIORITY-0.md` **P0-8** — 소유 경로 접근은 수리 내재 단일 프리미티브로만,
  수리는 경계 안·비트 추가만, 실패 후엔 absent가 아니라 unknown→거절,
  한 엔트리가 전체 작업을 멈추지 않음, 정적 검사로 강제.
- `design-revisions.md` **DR32** — 도출 근거.
- 프리미티브: `src/storage/directory.ts` (`openOwnedDirectory`,
  `listOwnedDirectory`, `ensureOwnedDirectory`, `repairOwnerBits`,
  `repairOwnedEntryMode`) + `src/platform/host/files.ts` Mac 대응군 +
  `src/runtime/locked-files.ts` `lockedOwnedReplace`.
- ~40개 파일 전수 마이그레이션 (`20c3e5b`, +1914/−1450).
- **정적 규칙**: `scripts/architecture/rules/owned-state-rules.mjs` —
  소유 경로의 raw fs 호출을 프리미티브 소유자 밖에서 금지, 면제는 사유 있는 맵,
  stale 면제 자동 감지(`owned-state-exemption-stale`). 재도입 증명으로 발동 확인됨.
- 장부 UX-30에 전체 이력이 누적 기록됨.

**잔여(정직한 미해결)**:
- **darwin/Mac 경로는 구조 리뷰만** — 이 호스트는 Linux. `ensureHostOwnedDirectory`,
  `repairHostOwnedPath`, `collectHostStageStray` 등은 코드 동형이지만 Mac 미실행.
- `oma-mac`의 `reconcilePersonalSettings` 등 일부 경로는 plain ensure 잔여
  (에이전트 보고 — 정적 규칙 통과 범위 내 잔존으로 추정, 재확인 필요).
- 스위트는 3559/3559 통과하지만 systemd 9개 파일은 NOT_RUN 유지.

## 7. 테스트·빌드·검증 레퍼런스

```sh
npm run build                 # tsc → dist/ (stamp hit 시 ~3s, 변경 시 ~19s)
npm run typecheck
npm run check:architecture    # inventory+rules+gate+transactions+boundaries+documents+spec-inventory
npm test                      # 전체 스위트 ~4-5분 (8코어 병렬)
node --test dist/test/x.test.js          # 컴파일된 테스트 하나
node --test test/x.test.mjs              # mjs 테스트 하나
node scripts/loc.mjs --source-digests    # 소스 digest 재생성 (src 변경 후 필수)
npm run evidence:graph                   # dependency-graph.json 재생성
```

- 러너 `scripts/test-local.mjs`: serial 2개(status-responsiveness, scenario-agent-wait —
  호스트 전역 타이밍이 대상이라 정직하게 serial 유지) 후 병렬 min(8,코어).
  PTY 테스트는 `expect:` 마커 주도로 병렬 복귀됨.
- 생성물(`production-files.txt`, `production-loc-hashes.json`,
  `implementation/evidence/*`, `implementation/review-ledger.json`)은 손편집 금지.
- 빌드 스탬프: dist 출력 내용 해시+파일·디렉터리 집합을 전수 검증 — 손패치·
  심링크 스왑·잉여 파일도 재빌드 유발. `build.mjs`·`check-package.mjs` 자체도 해시 입력.
- systemd 억제 환경은 runner가 자체 설정 — `node --test`를 직접 돌릴 땐
  `OMA_TEST_SYSTEMD=0` + guard import + 가짜 DBUS 필요할 수 있음.

## 8. 지금까지의 결과 요약

- fix 브랜치 9개 병합 완료 (fi/fh/fj/fo/fl/fg/fm/fk/fp — WORKSTREAM §5 상세).
- 정리 라운드: tar 디렉터리 엔트리, `slice(0,-1)`, resume 스냅샷, `update-` 스쿼팅,
  egress lease, ledger status 키, displayCopy, `..foo`, `+` 버전 스냅샷, 워크플로우 clock.
- 테스트 최적화: 11.5분 → ~4.5분 (PTY 마커화, 감사 dedup, 빌드 스탬프).
- P0-8 부류: 6라운드 수정 → 원칙 추가 → 전수 마이그레이션 → 정적 규칙.
- 장부: UX-01~07,10~21,23~29 수정됨·UX-30(wedge 부류) 수정됨·UX-22+는 전수 스캔 편입.
  미해결: **UX-08**(egress — 선행 작업), **UX-09**(submodule 거절 메시지).
- 버그 아님 판정들: mailBodyBytes 바닥 거절(정상), `"/ oma-deliver"`(Pi 파서 실험으로 닫음).

## 9. 실행 제약

- push, PR, 배포 없음. 커밋만 로컬에.
- 보안 게이트·설정을 CI 통과 목적으로 바꾸지 않는다.
- 사용자가 직접 고친 파일을 되돌리지 않는다.
- 실제 사용자 OMA/VM·인증·유료 provider 사용 금지 — fixture/loopback만.
- 생성물은 재생성으로만 갱신.
- macOS/native·systemd·powercut·provider·release는 실행하지 않고 NOT_RUN으로 표기.
- 불확실하면 실험·추론으로 닫고 기록 — 미결로 두지 않는다.
- 최종 보고는 장부 기준 "무엇을 더 찾았고 어떻게 고쳤는지" 한국어.

## 10. 재개 체크리스트

1. `git log --oneline -8`, `git status` — 실제 HEAD(기대 `20c3e5b` 이후)와 미커밋 확인.
2. `docs/WORKSTREAM.md` §5·§9·§10, `docs/user-expectation-ledger.md` 끝까지 읽기.
3. `20c3e5b` 배치의 맹검증(§4 첫 항목)을 아직 안 했으면 그것부터 — 이후 큐 순서.
4. 실패가 나오면: 과거엔 stale 증거가 정상 실패였으나 **이제는 전부 재바인딩됨 —
   실패는 진짜다**.
5. 모르면 실험. 추측으로 둔 채 진행하지 않는다.
