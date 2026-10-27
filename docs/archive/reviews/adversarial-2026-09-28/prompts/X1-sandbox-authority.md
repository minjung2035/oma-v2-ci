# X1-sandbox-authority (교차 영역 감사)

먼저 `review/adversarial-2026-09-28/AUDIT-BRIEF.md`를 전부 읽고 그 규칙을 절대적으로 따른다(코드 수정 금지, npm build/test 금지, systemctl/sudo 금지, 네트워크 금지, `review/adversarial-2026-09-28/` 밖에 쓰기 금지). 그다음 `PRIORITY-0.md`를 읽는다.

주제: 봉인된 Resident(모델이 조종하는 신뢰할 수 없는 코드)가 자기 권한 밖의 효과를 낼 수 있는가, 그리고 권한·소유권 판정. 파일 단위가 아니라 그룹 경계를 넘어 추적한다.

## 이미 확인된 사실 (다시 보고하지 말고 출발점으로 쓴다)

- (a) `src/runtime/vsock-seccomp.ts`의 필터는 socket()/socketpair() syscall 번호만 본다. 그래서 io_uring `IORING_OP_SOCKET`으로 AF_VSOCK socket을 만들 수 있다. `src/sandbox.ts:99`의 bwrap 플래그(`--unshare-all --new-session --die-with-parent --cap-drop ALL`) 아래에서도 sandbox 밖의 vsock listener에 연결되는 것을 `review/adversarial-2026-09-28/repro/verify/uring-socket.mjs`가 이 host(Linux 6.12, io_uring_disabled=0)에서 재현했다. x32 ABI 우회는 G05-01.
- (b) Resident sandbox는 `/sessions`를 쓰기 가능하게 bind하고(`src/sandbox.ts:114`), 봉인된 Resident에는 bash 도구가 있다(`src/runtime/pi-spawn-plan.ts:182`는 봉인이 없을 때만 bash를 뺀다). 모델이 session 파일을 지우면 durable receipt가 hold(BATCH_CONFLICT)로 바뀐다(G01r2-01).

## 할 일

1. `src/sandbox.ts`, `src/runtime/pi-spawn-plan.ts`, `src/runtime/resident-rootfs.ts`, `src/runtime/pi-adapter.ts`, `src/runner.ts`, `src/units.ts`, `src/runtime/egress-forwarder.ts`, `src/runtime/inference-relay.ts`, `src/extension/*.ts`를 읽고 봉인 경계를 목록으로 만든다: mount와 각 항목의 rw/ro, 상속 FD, env, namespace, seccomp, rlimit/cgroup.
2. rw mount와 상속 FD마다 "Resident 모델이 여기를 이렇게 바꾸면 broker·runner·다른 agent의 판단이 바뀌는가"를 추적한다. 특히 runner나 broker가 sandbox가 쓸 수 있는 디렉터리에서 읽는 모든 파일(session, batch view, workspace, home, 제출 bundle, context 트리, receipt 후보)을 본다. 위조·삭제·교체(symlink, hardlink, FIFO, 거대 파일, 디렉터리로 바꾸기)가 host 쪽 프로세스를 멈추게 하는가(예: FIFO open에서 block)? sandbox 밖 파일을 읽거나 쓰게 하는가? 다른 agent의 사실을 바꾸는가?
3. namespace로 봉인되지 않는 커널 객체를 점검한다: keyring(keyctl/add_key, user keyring이 user namespace로 분리되는가), io_uring의 다른 op, AF_VSOCK 외 AF_*, perf_event_open, userfaultfd, ptrace(pid ns가 막는가), /proc/sys, /dev 목록, cgroup fs 쓰기, systemd user bus나 broker socket이 sandbox에 보이는가, TIOCSTI(--new-session이 막는가).
   가능하면 `review/adversarial-2026-09-28/repro/X1-sandbox-authority/` 아래에서 실제로 확인한다. bwrap 인자는 `dist/src/sandbox.js`의 export로 얻고, 없으면 같은 플래그를 복제한다. 탐침 프로그램(gcc로 컴파일한 C 또는 python3)을 실제로 돌린다. 이 머신 안에서만, 부작용 없이 한다: 커널 모듈 로드를 유발하거나 host 파일을 바꾸는 실험은 하지 않고, 임시 파일은 mkdtemp 아래에만 둔다. 참고용 C 예시는 `review/adversarial-2026-09-28/repro/verify/uring-socket.c`다.
4. broker 쪽 권한 판정(`peer-authenticator`, internal/public dispatcher, `principal-endpoint`, `authority.ts`, `protocol/methods.ts`)에서, Resident가 다른 actor로 행세하거나 Principal 전용 method를 부를 수 있는 경로가 있는지 그룹 경계를 넘어 추적한다.

## 산출물

`review/adversarial-2026-09-28/groups/X1-sandbox-authority.md`(AUDIT-BRIEF 형식). §1 커버리지는 "읽은 파일" 목록과 "경계 목록 표(항목, rw/ro, 누가 읽는가, 공격 결과)"로 대신한다. 최종 응답은 짧게.
