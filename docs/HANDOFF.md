# 현재 인계 — native spec 기준 구현 재개

## 사용자 지시

최신 지시는 **개정 spec을 따라 작업을 시작하는 것**이다. 앞선 spec 작성 후 중단 지시는 재개 요청으로 대체됐다. tool-files의 directory-relative 연산 전환부터 실제 검증하며, work branch만 사용하고 merge/deploy하지 않는다. 에이전트 위임은 사용하지 않는다.

[개정 명세](macos-native-spec.md)는 제품 보장·확정 결정·복수 후보·결정 절차·검증 순서를 간결하게 구분한다. DR61/NATIVE-024·025는 파일 capability와 좁은 native leaf 사용을 명시하지만 Darwin 실행 backend를 채택하거나 보안/복구 계약을 낮추지 않는다. 개정 전 전문은 [spec](archive/macos-native-spec-2026-10-28-pre-redesign.md)과 [인계](archive/native-handoff-2026-10-28-pre-redesign.md)에 원문으로 보존했다.

## 작업 입력과 보존

| 항목 | 마지막 확인 사실 |
|---|---|
| 주 작업트리 | `/home/dev/oma-v2`, `work/macos-native-20261025`, checkpoint parent `c4705861` + split launchd/Git forwarding probe WIP |
| 공개 CI mirror | `/home/dev/oma-v2-ci`, 같은 branch, 최신 제출 `daa85be204`; 원시 회수 입력은3d9ed7493 |
| 현재 변경 | Personal 독립 진입·Linux 실제 TUI/installed tools를 확인하고 Mac CI에 제출했다. launchd bootstrap5와 일반 Git spawn 성공을 회수해 다음 관측을 분리했다. README·WATCHDOG.yml은 사용자 변경으로 제외·보존한다 |
| 금지 | merge/deploy, reset/clean으로 WIP 정리, 고정 architecture·과거 authored review 재승인 |
| 환경 | Linux, 실제 Mac은 GitHub CI. LSP 미설정. gh 인증은 없지만 공개 API metadata 조회와 SSH push는 가능. Node26은 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin` |
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

직접 회수한 최신 Native run은 `40609391051`(3d9ed7493), full regression이 확인된 Architecture는 `40601095851`(87cc9c92e)이다.
후자는 full native-all과 baseline/lane을 실제 실행해 통과했지만 Mac 세 product gate는 OPEN이다.
file/Git/Worker의 남은 실패와 source별 수치는 [진행 기록](implementation/native-transition.md)이 소유한다.
원시는 `/home/dev/oma-audit-artifacts/native-2026-10-28-descriptor-leaf/`에 보존했다.
immutable artifact ZIP의 SHA256은 공개 API digest와 일치했다.
validation binding은 clean committed bytes를 가리키므로 dirty README 입력과 구분한다.

## 재개 요청을 받으면

1. 위 입력과 현재 변경을 대조한다. docs-only 개정과 기존 구현 WIP를 섞어 새 PASS로 기록하지 않는다.
2. [명세 §3–6](macos-native-spec.md)의 후보/판정 절차를 따른다. Darwin full-scope와 exact executable binding, expected-Broker producer는 미해결이다. launchd/coalition/audit-session을 확정 해법으로 읽지 않는다.
3. 독립 descriptor의 실제 Mac file/snapshot/cursor/hashline·tool-files 설치와 C target의 FD pruning·same-PID handoff는 확인했다. SDK libproc는 private·변경 가능하므로 지원 OS별 실제 회귀를 유지한다.
4. DR63 storage cutover는 미커밋 dist가 없는 checkout에서 실제 재빌드·status 회귀로 확인했다. metadata getattrlist도 실제 Mac에서 통과했다. Git packed smoke의 UNSUPPORTED_PROFILE은 실제 shared Linux-only preparation guard이며 기대값을 낮추지 않는다.
5. Node startup·file fence의 두 Mac 실제 반례는 닫았다. fresh 동일 SBPL signal은 EPERM이라 recovery reaper에서 배제했다. launchd는 SIP-disabled runner에서 constraint A의 bootstrap5로 실패했으므로 constraint 없는 job과 image 조건을 별도로 관측한다. Git 일반 async/sync는 성공했으며 다음은 stderrFd2이다. Personal은 실제 Linux TUI/installed tools를 통과했고 Mac 결과는 미회수다.
   `audit-session.ts`의 scan→empty·32-byte coalition buffer(XNU 정의40), saved witness→fresh identity와 throw-only launch는 production proof가 아니다. full-scope·exact exec binding·expected-Broker는 여전히 미해결이다.
6. 실제 primitive 반례를 먼저 닫고 execution journal/auth/caller를 연결한다. 이후 전체 제품·Linux 회귀·packed install·Mac CI·복잡도 검토가 남는다. stop/receipt/archive 보장은 그대로다.

상세 파일별 위치와 이전 조사 전문은 보관 인계에 있다. 이미 실패한 전제를 반복 조사하지 말고 달라진 입력 또는 새로운 반례 질문을 명시한다.
