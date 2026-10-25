# OMA v2 — 현재 검증 상태

최신 코드 기준은 `d571645941e621eec6ccd91504cfbdc72389200d`다. 아래 코드 검증은 문서 정리 **이전 입력의 실행 기록**이다. 이번 변경은 문서만 정리하며, 이전 PASS를 정리 후 입력의 전체 runtime 실행으로 표시하지 않는다.

## 최신 코드 검증: DR48 (2026-10-25)

| 검사 | 실제 결과와 범위 |
|---|---|
| 전체 local suite | **4184/4184 PASS**. serial9 + parallel4175, fail/cancel/skip/todo0, status0/signal null, 951.28초 |
| 실행 입력 | 15681개, `06811f22e03c6e8eca2e088c1780579a2c3f3525124ec1b3f4b48b4ee77a1c13`. 실행 전후 변경0 |
| build·strict typecheck·전체 정적 gate | PASS. architecture·transaction·durable-boundary·document·spec 검사를 포함 |
| 최신 App 독립 설치 | PASS. 실제 Restic/SQLite close→read-only→reopen, 공개 entry·자체 declaration·설치 runtime |
| Domain·Native·Storage 독립 설치 | PASS. 이후 해당 package 소스 변경 없음 |
| 설치 확인 | 설치된 `oma --help`, managed Restic 0.19.1 확인 |
| review | 새/변경 코드 NOT_REVIEWED. 과거 authored review를 갱신하지 않음 |

원시 결과의 소유자:
`/home/dev/oma-audit-artifacts/session-storage-2026-10-25/verification-result.json`.
같은 디렉터리의 `local-full-accepted.log`, `*-before.json`, `*-after.json`, `*-status.json`이 실제 입력과 종료 상태를 보존한다. 실행 뒤 결과·운영 안내·인계를 기록한 차이는 `post-runtime-input-relation.json`에 있다.

DR48은 Git index·local refs·staged/unstaged·untracked/ignored 파일, mode·소유권·nanomtime·symlink·내부 hardlink의 보관/복원과 삭제·게시 후 실패 재시도를 검사했다. 두 세션의 동일한 random 4MiB 파일은 source 합계 8,388,608 bytes에 대해 unique stored data 4,235,172 bytes였다. 이 fixture 결과를 제품 전체 절감률로 사용하지 않는다.

초기 손상 시험에서 Restic tree cache가 repository 손상을 가린 실패를 보존했다. `--no-cache` 수정 후 실제 손상 pack과 원본 보존을 검증했다. SQLite read-only 조회가 만든 빈 WAL 때문에 복원이 막히던 결함도 회귀로 확인했다. 첫 전체 실행은 수정 전에 SIGTERM으로 중단했으며 PASS로 계산하지 않는다. 자세한 실패·수리 과정은 [정리 전 검증 전문](../archive/documentation-cleanup-2026-10-25/validation.md)에 있다.

## 기동 시간의 마지막 측정 (2026-10-25)

같은 설치·프로젝트에서 통제한 전후 각 3회 중앙값이다.

| 측정 지점 | 이전 → 개선 후 | 측정 경계 |
|---|---|---|
| 대화 화면 | 4.50 → 4.27초 | 실제 entry·PTY·SDK·Open TUI, local scripted provider, systemd 조작 차단 |
| 첫 provider 요청 | 4.77 → 4.54초 | 위와 같은 통제 환경. 실제 외부 provider 응답 시간 아님 |
| 저장소 준비 | 12.69 → 9.67초 | 별도의 실제 Git 준비 측정. Workers 최종 준비 시간 아님 |

VM을 포함한 전체 Society 시작 시간은 측정하지 못했다. 서로 다른 측정값을 더해 전체 시간으로 표시하지 않는다. 원시 입력·로그·실패·검증 판정은
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/verification-result.json`에 있다.

## 실제 환경 검증과 알려진 한계

| 항목 | 현재 판정 |
|---|---|
| 현재 코드의 실제 Linux 서비스/cgroup qualification | NOT_RUN. local runner에서 별도 제외한 suite이며 private bwrap overlay로 대체하지 않음 |
| native macOS·Swift helper·VM·Keychain·APFS | NOT_RUN. 이 저장소에 설치 가능한 OMA.app/guest image 배포물 없음 |
| 현재 코드의 실제 provider turn·release qualification | NOT_RUN. scripted/loopback 검사는 외부 서비스 증거가 아님 |
| 실제 power-loss 내구성 | NOT_RUN. SIGKILL·in-process fault 결과와 구분 |
| 실제 manager/cgroup candidate 검사·reviewer shortage 예외 | 기존 독립 거절의 영향이 남음. fixture 성공으로 실행 지원을 주장하지 않음 |
| 선택적 notmuch·reflink·fresh verifier 및 모델 품질/비용 우위 | 활성 구현이나 비교 실험이 확인된 기능으로 표시하지 않음 |

DR48은 ACL/xattr·special file·nested mount·읽을 수 없는 파일·복원할 수 없는 소유권이 있으면 회수를 거부하고 원본을 남긴다. 도구·키·checkpoint·closed DB identity가 확인되지 않는 cold 세션은 시작하지 않는다. Restic의 과거 snapshot을 자동 prune하지 않으므로 고유 데이터의 누적은 남는다. 상세 사용법은 [operations](../operations.md)가 소유한다.

과거 kernel/crash·provider 실행 기록은 해당 당시의 입력에 대한 기록이다. 현재 입력의 미실행 범위를 그 기록으로 닫지 않는다. 측정용 임시 VM은 제거됐고 전체 VM+Society 시간 결과는 없다.

## 문서 정리의 검증 (2026-10-25)

| 검사 | 결과 |
|---|---|
| 전체 정적 gate `npm run check:architecture` | PASS. workspace·legacy·source inventory·architecture rule·transaction·durable boundary·문서·spec 검사 위반0 |
| 문서·trace·inventory·decision·review closure·verification policy 회귀 | **77/77 PASS**. fail/cancel/skip/todo0 |
| 위 두 실행의 입력 | 15674개, `2f870978ea6dbbb62e8b666d0d8bb29b9ce9a496ef4efda8ac66bb6ac3a1e8b6`. 각각 실행 전후 변경0 |
| 보존 확인 | 원문 사본13개·기존 archive·architecture·PRIORITY-0·review-notes bytes 일치. 규범 조항375개 fingerprint 동일 |
| 변경 범위 | 문서만 변경. production code·schema·설정·권한·기계 판독 map 변경 없음. 전체 runtime suite 재실행은 NOT_RUN |

결과를 기록하기 전 입력의 원시 로그와 상태는
`/home/dev/oma-audit-artifacts/documentation-cleanup-2026-10-25/`의 `architecture.log`, `documentation-tests.log`, 각 `*-before.json`/`*-after.json`/`*-status.json`이 소유한다. `preservation.json`은 문서 원문·규범·보호 파일·코드 입력의 보존을 확인한다. 이 결과를 인계·validation에 기록한 뒤의 입력 차이와 재검사는 같은 디렉터리의 `post-check-input-relation.json`, `final-documentation-checks.log`, `verification-result.json`에 구분한다. 정적 검사는 실제 플랫폼 qualification이 아니다.

정리 전 인계·검증·감사·계획 원문은 [보관 색인](../archive/documentation-cleanup-2026-10-25/README.md)에 있다. 문서를 옮겨도 요구 ID·수용 번호·과거 실패·검토 판정은 유지한다.

## 검증 입력과 LOC

아래 값은 **구조 검사의 현재 입력 identity**다. digest 생성은 runtime PASS를 만들지 않는다.

verification input digest `e7dddddce2d3aa9209b5ffe9e623c85b74201771f1d216b58986d19c771c1486` (15674 files).

현재 source 목록은 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. `npm run check:inventory`는 cloc 없이 source bytes를 확인한다. `npm run evidence:refresh`의 구조 재생성과 실제 runtime 실행은 별도다.

이전 기록의 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 문서 정리로 새 측정치를 만들지 않는다. DR46 마지막 LOC 시도는 같은-source 반복 결과 불일치로 UNRELIABLE이다. 유효한 최종 LOC·감소율은 주장하지 않는다.

현재 LOC 측정의 경로는 `node scripts/loc.mjs --out <evidence-directory>`가 생성·검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`이다. 생성기는 committed source digest를 먼저 확인하며, source/tool/report의 불일치를 손으로 고치지 않는다. 크기 상한은 없다.

## 재검증 명령

명령의 실제 정의는 [package.json](../../package.json), 요구 범위는 [verification-spec](../verification-spec.md)이 소유한다.

```sh
npm run check:documents
npm run check:spec-inventory
npm run check:inventory
npm run check:architecture
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs test/production-inventory.test.mjs
```

코드 변경이 있으면 해당 lane을 추가한다. 실제 환경이 필요한 suite는 지원·허용 환경에서 실행하고, 미실행은 NOT_RUN으로 기록한다.
