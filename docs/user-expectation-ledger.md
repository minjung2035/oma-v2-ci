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
| UX-10 | Society에서 직접 만든 스킬을 넣을 길이 없음 (`oma pi install <local-dir>` 거절, 원격 패키지만 가능) | 1, 2 | 로컬 디렉토리를 package store로 복사 설치 허용 — 기존 store 파이프라인과 Resident ro mount 재사용 | fix/fm `8f0a5a1` | 수정됨 |
| UX-11 | Society에서 로컬 확장을 sideload할 수 없음 | 1, 2 | UX-10과 같은 경로(확장은 sandbox 안에서 실행되므로 경계 유지) | fix/fm `8f0a5a1` | 수정됨 |
| UX-12 | `oma pi` help/list가 패키지에 skills/prompts/themes가 들어있다는 걸 보여주지 않음 | 1 | help 문구 + `oma pi list`에 포함 리소스 표시 | fix/fm `8f0a5a1` | 수정됨 |
| UX-13 | DR25 문서가 "skills/prompts는 로드하지 않는다"고 틀리게 안내 (`docs/design-revisions.md:535`) | 9 | 현재 동작으로 정정 | fix/fm `8f0a5a1` | 수정됨 |
| UX-14 | macOS `oma pi list`가 앱이 꺼져 있으면 실패하고 `--host-only` 대안을 안 알려줌 | 9 | 오류 문구에 `--host-only` 안내 | fix/fm `8f0a5a1` | 수정됨 |
| UX-15 | 확장 토글 저장 시 "Saved"만 나오고 다음 세션부터 적용된다는 걸 안 알려줌 | 9 | 저장 알림에 적용 시점 표기 | fix/fm `8f0a5a1` | 수정됨 |
| UX-16 | 설치한 package store 리소스를 모델 `read`/`ls`/`grep`이 읽지 못함 (guard는 허용, 실행층이 workspace만 허용) | 1 | `readableRoots`를 contained read/ls/grep/find까지 연결(쓰기는 계속 workspace만) | fix/fk — `admittedRoot`가 guard와 contained read가 같은 승인 순서로 root를 고름 | 수정됨 |

## 실패 방식·모델 표면

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-17 | egress 실패 시 조용히 저하되어 왜 안 되는지 모름 (`oma-society.ts:~667`) | 9 | 선택 경로는 알림과 함께 저하, 필수 경로는 명시적 실패 | fix/fh `af3671c` — `egressRequired(env)`+`openSessionEgress()`: OMA_EGRESS_SOCKET 설정 시 BROKER_UNAVAILABLE, 선택 경로는 사용자에게 알림 후 진행 | 수정됨 |
| UX-20b | HOME 미설정 시 요청 캐시가 `/tmp`로 조용히 떨어짐 — 공유 tmp에 사용자 상태 기록 | 9 | 명시적 오류로 fail-closed | fix/fh `1715ae5` — "oma: HOME is not set; the request cache has no root" (exit 4) | 수정됨 |
| UX-18 | Principal 도구 안내문에 Principal이 할 수 없는 Worker 동작("open and review merge requests")이 들어있음 (`review-tools.ts:109`) | 11 | 역할별 안내문 분리 | fix/fm `8f0a5a1` — Principal 스니펫이 자기 surface의 동작만 이름붙임("diff and vote a HIGH merge's approval") | 수정됨 |
| UX-19 | Worker `<oma_tools>`에 Pi 상용구("PI_* env vars…")가 남아 모델 표면을 더럽힘 | 11 | 제거 | fix/fp `8ed4b3c` — `PI_*` 언급 가이드라인 필터링, fail→pass 테스트로 실제 안내는 유지 확인 | 수정됨 |

## 하드코딩된 제한 (출처: 사용자 실제 피해 보고 + 제한값 전수 감사 진행 중)

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-20 | 패키지 인덱스/settings 문서가 1MiB 하드코딩 상한에 걸려 대규모 패키지 설치·로드 실패 (사용자 보고: 확장 설치 거절) | 1 | 정상 패키지가 들어갈 만한 named limit으로 교체, 거절 메시지에 실제 한도 표기 | fix/fo `578cb55` — `PACKAGE_INDEX_BYTES` 8MiB, `PERSONAL_SETTINGS_BYTES` 17MiB, 초과 시 `LIMIT_EXCEEDED`에 한도 명시 | 수정됨 |
| UX-21 | 압축 작업 실행 중인데 세션이 idle로 전환됨 | 1, 9 | 실행 중인 도구는 세션을 비-idle로 유지 | 기존 커밋 `ab17f7a`가 이미 구현(pi-adapter.ts:239-267, tool_execution_start/end 추적 + idleDeadline.hold, AV24 테스트) — fo가 확인 | 수정됨(기존) |
| UX-23 | `oma pi install <tarball>`이 디렉토리 엔트리(`package/`)를 가진 실제 tar를 전부 거절 + 루트 파일이 `ensure`의 `slice(0,-1)` 버그로 `packag` 같은 잘린 디렉토리를 만듦 | 1 | 디렉토리 엔트리는 후행 `/` 하나만 벗기고 같은 정규화 규칙 적용; 부모 디렉토리 계산은 `lastIndexOf`의 -1을 명시 처리; 경계 검사의 `startsWith("..")`를 컴포넌트 단위로 교정; 크기 상한은 읽기 전 stat으로 선검사 | 직접 수정 — pi-packages 테스트 17/17 + 실제 npm pack/GNU tar 타르볼 설치 확인 | 수정됨 |
| UX-22+ | 하드코딩된 크기·시간 제한 전수 감사 (기준 13 — Pi에도 동일한 값은 제외, 전수 조사는 코드베이스 전체 스캔 때 마무리) | 1, 9, 13 | 사용자가 정상 사용으로 도달 가능한 제한 → 조정/명명/명시적 거절. 결과는 여기에 추가 | 감사는 리밋으로 중단 — 전수는 6단계 스캔에 편입 | 결정 |

## 추가 발견 (감사·검증 진행에 따라 추가)

(오버엔지니어링·Pi 중복 감사 결과와 이후 라운드의 발견을 여기에 추가한다)

| ID | 사용자가 겪는 것 | 기준 | 결정 | 수정 | 상태 |
|---|---|---|---|---|---|
| UX-24 | 업데이트 후 첫 상호작용이 `session.resume`이면 pre-update rollback 스냅샷 없이 부팅됨 — `engine.start`만 `*-update-<image>.img`를 만들었음 | 1 | resume의 부팅도 같은 `updateSnapshot()`을 거침 | `ce74138` — sessions()의 session.resume이 lifecycle.start 전에 updateSnapshot | 수정됨 |
| UX-25 | `snapshot.create id=update-<image>`가 update 마커 네임스페이스를 점유 — 사용자 스냅샷이 영구 prune 보호를 얻고, 다음 업데이트의 실제 롤백 스냅샷이 "이미 있음"으로 건너뛰어짐 | 1, 9 | `update-` 접두어는 서비스 전용으로 예약; 마커 판정은 발행 파일명 꼬리(endsWith)가 아닌 파싱된 스냅샷 id로 강제 — `x-update-<image>` 같은 접미 일치는 어떤 사용자 id로도 성립하지 않음 | Host API 파라미터 검증 거절 + service.ts backend 방어(이중)는 사용자용 안내로 유지하고, updateProtection/updateSnapshot 양쪽 모두 `snapshotIdOf(name) === updateId`로 판정하도록 수정; 후행 일치 점유 회귀 테스트 추가 | 수정됨 |
| UX-26 | guest forwarder가 소켓 이름 정리(`clearSocketName`) 실패로 listen을 거절하면 run lease가 해제되지 않음 — host에 run·credential이 계속 살아있음 | 9 | 거절 경로에서도 `lease.release()` (유효성 거절과 동일하게) | `EgressForwarder.listen`의 clearSocketName throw 경로에 release 추가; platform-egress 테스트로 고정 | 수정됨 |
| UX-27 | 도구 렌더링이 TypeError로 깨질 수 있음 — `displayCopy`가 null-prototype 사본을 만들어 renderer의 `hasOwnProperty`/`toString`/템플릿 보간이 throw | 1 | 정상 프로토타입 사본으로 교체; `__proto__` own-key는 defineProperty로 데이터 유지 | interactive-display.ts; 프로토타입·`__proto__` 데이터 보존 테스트 추가 | 수정됨 |
| UX-28 | 설정된 `local/..foo` 소스의 스테이징 복사본이 `oma pi` 변경 시 pruneLocalStage에 삭제됨 — settings.json이 가리키는 복사본을 `startsWith("..")` 접두 판정이 `local/` 탈출로 오독 | 1 | `..` 판정을 컴포넌트 단위로 — checkStoreBoundary의 `escapes()`와 같은 규칙 | `escapes()`를 모듈 스코프로 올려 pruneLocalStage가 재사용(`rel === ".." \|\| rel.startsWith("../")`); `local/..foo` 유지 + 진짜 탈출 소스는 계속 제외되는 회귀 테스트 | 수정됨 |
| UX-29 | `+build` 접미를 가진 이미지 버전은 업데이트 후 첫 부팅이 영원히 거절됨 — manifest 버전 알파벳은 `+`를 허용하는데 스냅샷 id 알파벳이 못 받아 `update-<version>` 마커 생성이 INVALID_REQUEST | 1 | 스냅샷 id 규칙을 버전 알파벳을 포함하도록 확장(`+` 허용 — 파일명 안전); 러닝 스냅샷의 유지보수 래치 키는 id를 sha256으로 주입적으로 인코딩(request key 알파벳이 더 좁음) | `SNAPSHOT_ID` 공유 상수 도입(snapshot.ts — publish·snapshotIdOf·host-api.ts 와이어 검증이 같은 규칙), snapshotRunning의 래치 키를 `snapshot-<sha256(id)>`로; `+` 버전 부팅·`+` 사용자 id·id 파싱 회귀 테스트 | 수정됨 |
| UX-30 | 죽은 `local/<pkg>` 디렉토리 안에 심링크·fifo 같은 비정규 엔트리가 하나만 있어도 prune이 중간에 abort — 이후 모든 `oma pi` 변경이 같은 STORE_CORRUPT로 끝나는 영구 wedge (staging이 만드는 사본은 링크를 안 가지므로 손상 경로이지만, 손상이 sweep를 마비시킴) | 1, 9 | 삭제되는 OMA 소유 트리 안의 비정규 리프는 엔트리로서 unlink — unlink는 링크를 따라가지 않으므로 안전; 거절은 지워지는 대상을 보호하지 못하고 sweep만 wedge | `removeOwnedTree`가 removeUnusedTree처럼 non-directory 리프를 unlink; `local/` 자체가 비디렉토리(파일·링크·dangling link)여도 엔트리로 수집해 ENOTDIR/containment wedge 방지; dead-dir-with-link·비디렉토리 local 회귀 테스트 | 수정됨 |

*판정 메모 — 사용자 결함 아님으로 기록만:* 병합 후 회귀로 보인 `limits.mailBodyBytes` 거절은
버그가 아니라 AV-07 바닥의 정상 동작이다. 바닥 계산(mail/review-bounds.ts)을 실측으로
검증했을 때 subjectBytes=64·mailBodyBytes=1024 픽스처는 maximal thread revision이 1785B로
실제 서빙 불가 — 런타임이 INTERNAL_ERROR를 던질 설정이므로 commit 시 거절이 맞고,
깨진 것은 테스트 픽스처뿐이었다(2543B 이상으로 상향).

*판정 메모 — 내부 도구 결함:* architecture-check의 set-add-membership 이름 게이트
(5f6109b)는 비건전했다 — `{ foo: Set<string>["add"] }`처럼 다른 이름으로 해석되는
에일리어스 callee를 건너뛰었다. 접근 이름이 아니라 해석된 시그니처 선언만이 근거이므로
이름 게이트는 제거하고 booleanUse(checker 무쿼리)만 앞에 둔다. 분석기 자체 품질 문제이지
사용자 동작 결함은 아님 — aliased 직접 호출 픽스처로 fail-before/pass-after 확인.

*판정 메모 — 경미한 잔존물:* 설정 소스 `local/foo/sub`가 `local/foo` 전체를 유지시키던
prune 비대칭(스코프 규칙의 일반화 누락) — 설치된 동안 죽은 sibling이 수집되지 않아 스토어에
잔류했다. 사용자-facing wedge는 아니고 제거 시점엔 전체가 수집됐으므로 UX 행 대신 여기에
기록; top-level 엔트리 하위에 설정된 strict descendant가 있으면 동일하게 한 단계 descend로
일반화하고 회귀 테스트 추가.
