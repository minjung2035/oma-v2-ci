# OMA v2 — 현재 인계 (2026-10-25, 품질 후속 수정)

DR48: 닫힌 Society의 repos/staging/Resident workspace·home를 프로젝트별 Restic 보관소에
중복 제거해 저장·검증한 뒤 회수한다. Broker는 Store open/provision 전에 staged restore를,
drain/native 종료와 Store.close 이후 archive를 소유한다. DB/mail/runner/Principal history는
남긴다. ACL/xattr·special file·nested mount·복원 불가능한 소유권은 원본을 보존하고 회수하지
않는다. 도구·키·checkpoint/closed DB identity가 확인되지 않는 cold 세션은 시작하지 않는다.
setup은 `npm run setup:storage`, Linux x64/arm64 Restic0.19.1 official SHA256 pin이며 현재
dev의 managed tool 설치를 완료했다. 전체 local4184/4184, build/strict typecheck/static gate,
최신 App의 실제 Restic/SQLite 독립 설치 검사를 통과했다. 실행 입력은15681개06811f22…이며
전후 변경0이다. 원시 결과는 `/home/dev/oma-audit-artifacts/session-storage-2026-10-25/`에 있다.
결과를 기록한 뒤의 문서 차이는 별도 input relation에 남긴다. 실제 서비스/cgroup·Mac/VM·
provider·power-loss 검증은 NOT_RUN이다. 자세한 최종 결과는 validation이 소유한다.
과거 snapshot의 자동 forget/prune나 Principal Bash/권한 변경은 포함하지 않는다.

Society 기동 후속으로 새 strict protocol clone 직후의 중복 전체 검사를 줄이고,
스냅샷을 단일 Git 입력 스트림으로 전달한다. Linux의 상위 경로 검증은 held root
아래 한 번의 openat2 walk로 수행하며 매 파일마다 현재 경로를 다시 확인한다.
Host와 엔진 preload에는 실패 시 source로 돌아가는 private Node compile cache를
적용했다. 기존 mirror의 재검증, raw bytes·SHA-1/SHA-256·source 재확인, fence와 실제
child close, canonical CAS 및 Principal authority 부여 시점은 유지한다.
같은 프로젝트의 통제된 전후 각3회 중앙값은 화면4.50→4.27초,
저장소 준비12.69→9.67초다. 후자는 Workers 최종 준비 시간이 아니다.
실제 서비스 manager 동작은 차단한 PTY/local provider와 별도의 실제 Git 준비 측정이다.
실행 입력·원시 로그·최종 검증 상태의 소유자는
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/verification-result.json`이다.
아래 품질 후속 검증 수치는 이전 입력의 결과다.

현재 브랜치는 `work/code-quality-improvements-20261025`이며 첫 체크포인트
`df713512`를 origin에 push했다. 원격 master의 별도 변경은 합치거나 덮어쓰지 않았다.
후속으로 rollback 실패 연결의 재사용 차단, immutable 관찰·게시의 최초 손상 보존,
bridge 양방향 backpressure를 수정했다. Personal의 설정/히스토리와 operation decode의
관계 검증을 분리했고, SDK title은 공개 Terminal 주입을 사용한다. 잔여 private
13 methods/1 field는 기존 검증 adapter가 소유한다. workspace build는 컴파일러의
읽기·부재·탐색 입력과 assets, 출력 bytes/mode/tsbuildinfo를 확인한 경우에만 재사용한다.
원칙 문서는 변경하지 않았다. 새/변경 코드는 NOT_REVIEWED다.

이 후속 입력의 실행 결과·입력 동일성은
`/home/dev/oma-audit-artifacts/quality-followup-2026-10-25/verification-result.json`과
그 옆 원시 로그가 소유한다. 아래 DR47의 PASS 수치는 이전 입력의 결과다.

## 이전 DR47 입력의 수용 기록

최신 사용자 요청은 [품질 보완 명세](code-quality-improvement-spec.md)의 다섯 항목 전체 구현이다.
다섯 항목을 모두 구현했다. 전체 local4126/4126, 전체 build/strict typecheck/static gate,
변경5개 package의 독립 설치가 PASS다. 실행 입력은15663개 4afed4b8…이며 전후 변경0이다.
App API140→4, interactive575→94줄, host 직접 private 접근0이다. SDK 잔여13 methods/1 field는
단일 검증 adapter에 남는다. 실제 플랫폼 qualification은 NOT_RUN이다.
현재 raw 근거는 /home/dev/oma-audit-artifacts/quality-improvement-2026-10-25/이며,
기록 뒤 문서3개 차이·현재 binding 관계는 completion-evidence.json과 validation을 본다.
아래 DR46 PASS와 이전 raw 근거는 이전 입력의 결과다.

사용자는 [전체 모듈화 명세](modularization-spec.md)의 구현을 승인했고,
[Priority 0](PRIORITY-0.md)가 최우선이다. 출시 전 과거 빌드 호환성은 유지하지 않는다.
현재 원본 `/home/dev/oma-v2`에 **25개 workspace의 소스 전환을 반영했다**. 원본의 새
설치·빌드·typecheck·정적 검사와 전체 local4108/4108 검증을 통과했다. 실제 플랫폼 qualification은 남아 있으며 전체 완료로 표시하지 않는다.
master HEAD는 `dc21c13e`, 변경은 미커밋이다. TUI 문구는 `Your ideas, in motion`이다.

독립 사본 `/home/dev/oma-audit-worktrees/resource-v4`의 마지막 Linux/Mac/App 전환808개 파일을
충돌0으로 반영했다(`final25-transfer-result.json`). 변경 직전 원본 working-tree bytes는
`final25-root-before.tar.gz`에 보관했다. `.git`, node_modules, dist를 공유하거나 복사하지 않았다.
옛 root src/dist/src는 제거했다. 이후 원본의 DR46-F08은 status page의 누적 재직렬화를 선형 계산으로 고쳤다.
이 후속 수정과 최종 검증의 기준은 현재 원본이며 독립 사본은 전환 당시의 증거다.
현재 bin은 `apps/oma/dist/entry/oma.js`이고 모델 command도 App이 소유한다.

Priority 0: accepted bytes와 terminal의 의미, 과거 증거와 현재 권한, captured T/동일 Store gate,
unknown과 부재·죽음의 구분, 실제 FD/child/lock 수명과 owned 상태 수리를 유지한다.
`docs/architecture.md`와 `implementation/review-notes.json`은 수정하지 않는다. 새 코드는
NOT_REVIEWED이며 과거 review를 갱신·자동 승인하지 않는다. 에이전트 위임은 사용하지 않는다.

실행 결과·각 입력 identity·원시 실패·미실행 이유는 [validation](implementation/validation.md)이
소유한다. DR46 외부 원시 근거는 `/home/dev/oma-audit-artifacts/modularization-2026-10-23/`에 있다.
최종 전체 local과 최신 Protocol/Broker/App 설치는 같은15645개 입력 2d8ca17f…에서 PASS,
전후 변경0이다. 원시 실패·중단 기록도 보존했다. 실행 중 source/docs/build/install을 바꾸지 않았고
첫 serial9개 동안 다른 CPU 작업을 병행하지 않았다. 기록 후의 차이는 별도 input relation이 소유한다.

현재 도구는 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin`의 Node26과 cloc2.08이다.
실제 `/usr/bin/bwrap`은 없다. 로컬 시험은 private bwrap namespace의 `/usr/bin` overlay와
`--dev-bind /dev /dev`로 실행하며 systemd manager의 자식이 이 overlay를 상속한다고 주장하지 않는다.
현재 user manager는 running이지만 dev 계정은 disposable qualification 계정이 아니다.
실제 Linux 서비스/cgroup, macOS/VM/Keychain, real provider, power-loss는 로컬 scripted/물리
자원 검사와 구별하여 NOT_RUN으로 둔다.
