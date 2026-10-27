# 현재 인계 — native spec 기준 구현 재개

## 사용자 지시

최신 지시는 **개정 spec을 따라 작업을 시작하는 것**이다. 앞선 spec 작성 후 중단 지시는 재개 요청으로 대체됐다. tool-files의 directory-relative 연산 전환부터 실제 검증하며, work branch만 사용하고 merge/deploy하지 않는다. 에이전트 위임은 사용하지 않는다.

[개정 명세](macos-native-spec.md)는 제품 보장·확정 결정·복수 후보·결정 절차·검증 순서를 간결하게 구분한다. DR61/NATIVE-024·025는 파일 capability와 좁은 native leaf 사용을 명시하지만 Darwin 실행 backend를 채택하거나 보안/복구 계약을 낮추지 않는다. 개정 전 전문은 [spec](archive/macos-native-spec-2026-10-28-pre-redesign.md)과 [인계](archive/native-handoff-2026-10-28-pre-redesign.md)에 원문으로 보존했다.

## 작업 입력과 보존

| 항목 | 마지막 확인 사실 |
|---|---|
| 주 작업트리 | `/home/dev/oma-v2`, `work/macos-native-20261025`, HEAD `eb63b6f245b7ac6ed7589782a20beffac6948ffa` + dirty WIP |
| 공개 CI mirror | `/home/dev/oma-v2-ci`, 같은 branch, 공개 입력 `3272a0618d54bfd14184b0c77c32d839eca0f279` |
| 현재 변경 | 기존 WIP와 사용자 변경 보존. 아래 Linux 수리·fixture 변경 및 이번 문서 개정은 새 commit/push하지 않음 |
| 금지 | merge/deploy, reset/clean으로 WIP 정리, 고정 architecture·과거 authored review 재승인 |
| 환경 | Linux 개발 장비; 실제 Mac은 GitHub CI. LSP 미설정. API/gh 인증 불가였고 SSH push는 가능 |
| CI 주의 | 현재 native workflow는 push로 Mac job이 실행될 수 있음. 재개 시 workflow 조건부터 확인 |

이 표는 작업 중 확인한 입력이지 재개 시점의 HEAD를 보증하지 않는다. 상세 변경 목록·이전 Keychain 작업은 보관 인계와 실제 worktree를 대조한다.

## 이번 구현에서 확인한 것

- `broker-composition.ts`: 이미 `{pid,startTime}`인 scopeRoot를 tagged witness로 다시 읽던 회귀를 제거. 실제 private-fd `runner.open`의 AUTH_FAILED가 성공으로 바뀌었고 400-socket flood 시험 1/1 PASS.
- `native/descriptor-path.ts`, `tool-files/descriptor-files.ts`: Linux `/proc/fd`를 `/proc/self/fd`로 수리. 실제 rename/replacement 뒤 held bytes 읽기와 tool write/read smoke PASS.
- Mac metadata fixture의 temp root를 canonicalize하고, workflow 문구를 고정하던 incidental test를 제거. 관련 Linux 선택 시험 60/60 PASS; 해당 Mac 수정의 재실행은 NOT_RUN.
- 위 입력에서 build PASS. 일반 사용자 permission 증거와 root-mapped namespace smoke는 구분한다. throwaway smoke 파일은 제거했다.

실행 기록은 [native-transition](implementation/native-transition.md), 전체 상태는 [validation](implementation/validation.md)가 소유한다. 이 선택 결과는 현재 source 전체 회귀나 Darwin qualification이 아니다.

## 재사용할 원시 근거

[공개 run 40548845744 artifact](https://nightly.link/minjung2035/oma-v2-ci/actions/runs/40548845744) 접근은 성공했다. 같은 run의 auth-only API/log URL을 반복 시도하지 않는다.

- 추출 위치: `/home/dev/oma-audit-artifacts/native-2026-10-28-recovered-ci/macos15-gates/`, `macos15-runtime/`.
- Mac15 gate: SETUP_FAILED, 세 gate OPEN. process-group 탈출 후손 생존, mode-000 event pin EACCES, `/dev/fd` shared cursor, descriptor exec errno13을 관측했다.
- Mac15 runtime: 218/247 PASS·29 FAIL. 주요 원인은 strict root에서 `/var` alias fixture, `/dev/fd/<directory>/<name>` 사용, stale workflow assertion. fixture/assertion만 수리했고 Darwin tool directory 연산은 아직 미구현이다.
- Seatbelt kept-FD 실제 오류는 `Seatbelt target exec: Bad file descriptor`; 다른 helper/worker/setup 실패도 별도다. generic timeout으로 합치지 않는다.
- 파일 후보 배제 근거: `/home/dev/oma-audit-artifacts/native-2026-10-27-file-binding-feasibility/audit.json`. 새 CI 관측은 그 당시 NOT_RUN 표기보다 최신이다.

## 재개 요청을 받으면

1. 위 입력과 현재 변경을 대조한다. docs-only 개정과 기존 구현 WIP를 섞어 새 PASS로 기록하지 않는다.
2. [명세 §3–6](macos-native-spec.md)의 후보/판정 절차를 따른다. Darwin full-scope와 exact executable binding, expected-Broker producer는 미해결이다. launchd/coalition/audit-session을 확정 해법으로 읽지 않는다.
3. tool-files의 directory FD pathname은 독립 `@oma/file-descriptors`로 교체했다(DR62). 기존 primitive/caller를 이관했고 실제 Linux smoke·관련55/55·contained-tools30/30·boundary36/36·독립 설치27/27을 확인했다. U+FEFF filename 반례는 손실 재현 후 수리·재빌드하여1/1 PASS다. 실제 Darwin 전환 검증은 아직 NOT_RUN이다.
4. `audit-session.ts` scan→empty, `execution-runtime.ts` saved witness→fresh identity, `execution-launch.ts` throw-only 경로를 production proof로 쓰지 않는다. launchd FFI의 소유권·array ABI·argv/stdio도 미검증이다.
5. 실제 primitive 반례를 먼저 닫고 execution journal/auth/caller를 연결한다. 이후 전체 제품·Linux 회귀·packed install·Mac CI·복잡도 검토가 남는다. stop/receipt/archive 보장은 그대로다.

상세 파일별 위치와 이전 조사 전문은 보관 인계에 있다. 이미 실패한 전제를 반복 조사하지 말고 달라진 입력 또는 새로운 반례 질문을 명시한다.
