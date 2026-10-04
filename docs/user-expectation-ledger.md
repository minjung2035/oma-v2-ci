# 사용자 기대 미충족 장부

> 사용자가 당연히 될 거라 기대하는데 안 되는 것(WORKSTREAM §2 기준 1·2·9·10·11 중심)을
> 발견 → 결정 → 수정 순으로 기록한다. 내부 원인이어도 사용자가 겪으면 여기 올리고 구현한다.
> 사용자에게 영향 없는 순수 기술개선은 여기 올리지 않는다(WORKSTREAM에 기록만).
> 전체 작업이 끝나면 이 장부로 사용자에게 "무엇을 더 찾았고 어떻게 고쳤는지" 보고한다.

상태: `발견` → `결정` → `구현 중(브랜치)` → `수정됨(커밋, 테스트)` → `검증됨`

## Worker 개발환경 (출처: 샌드박스 사용성 감사)

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-01 | Worker에서 `npm`/`npx`가 없음. 프롬프트는 `npm test`를 시킴 (Node가 단일 파일로만 마운트, `src/sandbox.ts:86`) | 1 | Node 배포의 npm/npx/corepack을 함께 제공하고 툴체인 계약을 테스트로 고정 | fix/fi `51712a6`,`89422c2` — pin된 Node의 lib/node_modules/{npm,corepack} ro-bind + /opt/oma-node 심볼릭, image manifest에 항목 추가, 실제 bwrap에서 `npm --version` 확인 | 수정됨 |
| UX-02 | 첫 `git commit`이 "tell me who you are"로 실패 (identity 미설정) | 1 | `GIT_AUTHOR_*`/`GIT_COMMITTER_*`를 `<actor>@<society>.oma.invalid`로 주입 | fix/fi `51712a6` — residentHints()로 actor별 주입, 실제 sandbox에서 commit/amend/rebase/merge 확인 | 수정됨 |
| UX-03 | `git merge`/`rebase`/`commit`(메시지 없이)이 편집기를 못 띄워 실패 | 1 | `GIT_EDITOR=:` 등 + `GIT_TERMINAL_PROMPT=0` | fix/fi `51712a6` — RESIDENT_ENVIRONMENT에 주입 | 수정됨 |
| UX-04 | `npm install` 뒤 workspace quota(2GiB)가 산출물까지 세어 write/edit가 전부 거절됨 | 1, 9 | quota 목적(에이전트가 만든 손상 제한)에 맞게 VCS·의존성·빌드 산출물 계산 방식 수정 | fix/fi `fc541dc` — `.git`/`node_modules`/`.venv`/`target`/`dist`/`build` 디렉토리를 계산에서 제외 | 수정됨 |
| UX-05 | 중간 규모 빌드가 3GiB/128 tasks 한도에서 OOM → 턴 전체 손실 | 1 | 개발 작업 기준으로 기본값 상향, 값은 테스트로 고정 | fix/fi `f784e3b` — MemoryMax 4GiB, TasksMax 256 (spec/traceability 갱신 포함) | 수정됨 |
| UX-06 | `nproc`가 호스트 코어를 보고해 `make -j`·jest가 과구독 | 1 | 실제 CPU 한도 힌트 제공 + START.md 안내 | fix/fi `51712a6` — `OMA_CPUS`/`OMA_MEMORY_BYTES`/`OMA_TASKS` env 힌트 | 수정됨 |
| UX-07 | 네트워크·push·`/tmp` 휘발·docker·서비스 수명·submodule 제약을 Worker가 모른 채 턴을 낭비 | 1, 9 | START.md/Worker 프롬프트에 현재 제약을 간결히 명시 | fix/fi `917d621` — START.md `## Sandbox` 절 + Worker 프롬프트 bullet | 수정됨 |
| UX-08 | Worker에서 `npm install`·`git clone https`·pip 등 인터넷이 전부 불가 | 1, 10 | S-07 project egress 재개: host egress를 범용 HTTP CONNECT 프록시로 확장(allowlist·SSRF 차단·credential 비노출, `--unshare-all` 유지) | 선행작업 egress 단계 | 결정 |
| UX-09 | submodule이 있는 프로젝트는 통합 단계에서 불투명한 exit 125로 실패 | 9 | v0.1: gitlink 경로를 밝히는 명시적 거절 메시지 + 문서화(통합 CAS가 gitlink 객체를 검증할 수 없음) | 배정 예정 | 결정 |
| UX-10b | society 수준 StorageAdmission의 `observedStorageBytes`도 workspace 안의 node_modules 등을 세어 큰 프로젝트에서 broker admission이 막힐 수 있음 (fix/fi 발견) | 1, 9 | workspace quota와 같은 배제 정책 적용 | 다음 fix 패키지에 편성 | 결정 |

## 커스터마이징 표면 (출처: 커스터마이징 감사)

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-10 | Society에서 직접 만든 스킬을 넣을 길이 없음 (`oma pi install <local-dir>` 거절, 원격 패키지만 가능) | 1, 2 | 로컬 디렉토리를 package store로 복사 설치 허용 — 기존 store 파이프라인과 Resident ro mount 재사용 | fix/fm 예정 | 결정 |
| UX-11 | Society에서 로컬 확장을 sideload할 수 없음 | 1, 2 | UX-10과 같은 경로(확장은 sandbox 안에서 실행되므로 경계 유지) | fix/fm 예정 | 결정 |
| UX-12 | `oma pi` help/list가 패키지에 skills/prompts/themes가 들어있다는 걸 보여주지 않음 | 1 | help 문구 + `oma pi list`에 포함 리소스 표시 | fix/fm 예정 | 결정 |
| UX-13 | DR25 문서가 "skills/prompts는 로드하지 않는다"고 틀리게 안내 (`docs/design-revisions.md:535`) | 9 | 현재 동작으로 정정 | fix/fm 예정 | 결정 |
| UX-14 | macOS `oma pi list`가 앱이 꺼져 있으면 실패하고 `--host-only` 대안을 안 알려줌 | 9 | 오류 문구에 `--host-only` 안내 | fix/fm 예정 | 결정 |
| UX-15 | 확장 토글 저장 시 "Saved"만 나오고 다음 세션부터 적용된다는 걸 안 알려줌 | 9 | 저장 알림에 적용 시점 표기 | fix/fm 예정 | 결정 |
| UX-16 | 설치한 package store 리소스를 모델 `read`/`ls`/`grep`이 읽지 못함 (guard는 허용, 실행층이 workspace만 허용) | 1 | `readableRoots`를 contained read/ls/grep/find까지 연결(쓰기는 계속 workspace만) | fix/fk 예정 | 결정 |

## 실패 방식·모델 표면

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-17 | egress 실패 시 조용히 저하되어 왜 안 되는지 모름 (`oma-society.ts:~667`) | 9 | 선택 경로는 알림과 함께 저하, 필수 경로는 명시적 실패 | fix/fh `af3671c` — `egressRequired(env)`+`openSessionEgress()`: OMA_EGRESS_SOCKET 설정 시 BROKER_UNAVAILABLE, 선택 경로는 사용자에게 알림 후 진행 | 수정됨 |
| UX-20b | HOME 미설정 시 요청 캐시가 `/tmp`로 조용히 떨어짐 — 공유 tmp에 사용자 상태 기록 | 9 | 명시적 오류로 fail-closed | fix/fh `1715ae5` — "oma: HOME is not set; the request cache has no root" (exit 4) | 수정됨 |
| UX-18 | Principal 도구 안내문에 Principal이 할 수 없는 Worker 동작("open and review merge requests")이 들어있음 (`review-tools.ts:109`) | 11 | 역할별 안내문 분리 | 배정 예정 | 결정 |
| UX-19 | Worker `<oma_tools>`에 Pi 상용구("PI_* env vars…")가 남아 모델 표면을 더럽힘 | 11 | 제거 | 배정 예정 | 결정 |

## 하드코딩된 제한 (출처: 사용자 실제 피해 보고 + 제한값 전수 감사 진행 중)

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-20 | 확장/패키지 설치가 ~1KiB 크기 제한에 걸려 실패 | 1 | 정상 패키지가 들어갈 만한 named limit으로 교체, 거절 메시지에 실제 한도 표기 | fix/fo (f9347ad1) | 구현 중 |
| UX-21 | 압축 작업 실행 중인데 세션이 idle로 전환됨 — 무응답 타임아웃이 "도구 실행 중"과 "모델 침묵"을 구분 못함 | 1, 9 | 실행 중인 도구는 세션을 비-idle로 유지. 침묵 예산은 모델 침묵에만 적용 | fix/fo (f9347ad1) | 구현 중 |
| UX-22+ | 하드코딩된 크기·시간 제한 전수 감사 (기준 13 — Pi에도 동일한 값은 제외, 전수 조사는 코드베이스 전체 스캔 때 마무리) | 1, 9, 13 | 사용자가 정상 사용으로 도달 가능한 제한 → 조정/명명/명시적 거절. 결과는 여기에 추가 | 감사 95516b31 | 조사 중 |

## 추가 발견 (감사·검증 진행에 따라 추가)

(오버엔지니어링·Pi 중복 감사 결과와 이후 라운드의 발견을 여기에 추가한다)
