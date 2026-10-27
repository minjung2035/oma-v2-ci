# 현재 인계 — native spec 기준 구현 재개

## 사용자 지시

최신 지시는 **개정 spec을 따라 작업을 시작하는 것**이다. 앞선 spec 작성 후 중단 지시는 재개 요청으로 대체됐다. tool-files의 directory-relative 연산 전환부터 실제 검증하며, work branch만 사용하고 merge/deploy하지 않는다. 에이전트 위임은 사용하지 않는다.

[개정 명세](macos-native-spec.md)는 제품 보장·확정 결정·복수 후보·결정 절차·검증 순서를 간결하게 구분한다. DR61/NATIVE-024·025는 파일 capability와 좁은 native leaf 사용을 명시하지만 Darwin 실행 backend를 채택하거나 보안/복구 계약을 낮추지 않는다. 개정 전 전문은 [spec](archive/macos-native-spec-2026-10-28-pre-redesign.md)과 [인계](archive/native-handoff-2026-10-28-pre-redesign.md)에 원문으로 보존했다.

## 작업 입력과 보존

| 항목 | 마지막 확인 사실 |
|---|---|
| 주 작업트리 | `/home/dev/oma-v2`, `work/macos-native-20261025`, HEAD `62b47bf3` + 후속 WIP |
| 공개 CI mirror | `/home/dev/oma-v2-ci`, 같은 branch, 공개 입력 `562548397db43a42bfac6be433af19e95a634a64` |
| 현재 변경 | descriptor 분리와 첫 CI/launcher 수리를 work branch에 commit했다. README·WATCHDOG.yml 사용자 변경은 제외·보존했다. BigInt diagnostic 수리·crash report 수집·독립 설치의 실패 집계는 후속 WIP |
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

후속 run은 Native `40577594097`, Architecture `40577594148`다. 이전 Native `40573702445`의 결과를 덮지 않는다. 원시는
`/home/dev/oma-audit-artifacts/native-2026-10-28-descriptor-leaf/`가 소유한다.
nightly.link의 run/name 경로가 cached404이면 같은 URL을 반복하지 않고 공개 GitHub
`actions/runs/<run>/artifacts`의 ID·digest를 얻어 `nightly.link/.../actions/artifacts/<id>.zip`로 받는다.
회수한 Mac26 runtime/gates·Mac15 runtime·Ubuntu ZIP의 SHA256은 API digest와 일치했다.

## 재개 요청을 받으면

1. 위 입력과 현재 변경을 대조한다. docs-only 개정과 기존 구현 WIP를 섞어 새 PASS로 기록하지 않는다.
2. [명세 §3–6](macos-native-spec.md)의 후보/판정 절차를 따른다. Darwin full-scope와 exact executable binding, expected-Broker producer는 미해결이다. launchd/coalition/audit-session을 확정 해법으로 읽지 않는다.
3. descriptor 분리는 실제 Mac26/15의 file/snapshot/cursor/hashline 경로에서도 통과했다. 첫 공통 suite는 각각247/248이며 빈 ACL의 상속 방지 flag 관측 한 건이 실패했다. 후속 Mac26은 진단의 BigInt JSON 직렬화 오류로245/248이며, 이 진단 오류만 먼저 고쳤다. Mac packed install은 실행됐지만 Broker smoke의 Linux 전용 credential 준비에서 중단됐다. 검사기는 다른 workspace도 실행한 뒤 실패를 합산하도록 바꾼다. Linux 선택55/55·contained-tools30/30·boundary36/36·독립 설치27/27 및 target Node26 선택30/30은 각각의 입력 결과다.
4. 다음 수리는 metadata persistence/observation 구분, Seatbelt 대상의 SIGABRT, status pending620의74ms 지연이다. 새 공개 FD inventory+직접 exec는 실제 SDK의 독립 C control에서 same-PID·stdio·FD64/낮춘 hard limit·명시 채널 검사를 통과했다. Seatbelt 적용 후 C actor와 Node는 여전히 SIGABRT이므로 end-to-end 성공이 아니다. `audit-session.ts`의 scan→empty와32-byte coalition buffer(XNU 정의는40), saved witness→fresh identity와 throw-only launch는 production proof가 아니다. full-scope·exec binding·expected-Broker는 여전히 미해결이다.
5. 실제 primitive 반례를 먼저 닫고 execution journal/auth/caller를 연결한다. 이후 전체 제품·Linux 회귀·packed install·Mac CI·복잡도 검토가 남는다. stop/receipt/archive 보장은 그대로다.

상세 파일별 위치와 이전 조사 전문은 보관 인계에 있다. 이미 실패한 전제를 반복 조사하지 말고 달라진 입력 또는 새로운 반례 질문을 명시한다.
