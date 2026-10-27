# X1-sandbox-authority 적대적 검증 결과

교차 영역 감사(봉인 경계·권한·소유권). 코드 수정·npm build/test·systemctl/sudo·네트워크 없이 수행했다.
재현 스크립트는 `review/adversarial-2026-09-28/repro/X1-sandbox-authority/` 아래에만 두었고, 임시 파일은
`/tmp/oma-adv-X1-*`(mkdtemp)에만 만들어 스크립트 끝에서 지웠다. 커널 탐침은 부작용 없이(모듈 로드 없음,
host 파일 변경 없음) 이 머신 안에서만 돌렸다. bwrap 인자는 `src/sandbox.ts`의 `residentArgv`를 그대로
복제했고, seccomp filter는 `dist/src/runtime/vsock-seccomp.js`의 `vsockSeccompFilter()`를 fd 3으로 넘겼다.

## 1. 커버리지

### 읽은 파일 (할당 파일, 처음부터 끝까지)

| 파일 | 줄 수(wc -l) | 전부 읽음 | 비고(마지막으로 읽은 줄) |
|---|---|---|---|
| src/sandbox.ts | 236 | 예 | 236 `}` (SandboxModule.candidate throw로 끝) |
| src/runtime/pi-spawn-plan.ts | 258 | 예 | 258 `...filter: vsockSeccompFilter() };` (planPiSpawn 반환) |
| src/runtime/resident-rootfs.ts | 226 | 예 | 226 `return Object.freeze({ deferred..., corrected... });` |
| src/runtime/pi-adapter.ts | 286 | 예 | 286 `}` (PiAdapter.deliver finally 종료) |
| src/runner.ts | 341 | 예 | 341 `}` (RunnerModule.run finally 종료) |
| src/units.ts | 432 | 예 | 432 `}` (startLimitStatus 종료) |
| src/runtime/egress-forwarder.ts | 170 | 예 | 170 `}` (openPrincipalEgress 반환) |
| src/runtime/inference-relay.ts | 498 | 예 | 498 `}` (InferenceRelay.close 종료) |
| src/extension/batch-view.ts | 191 | 예 | 191 `}` (readBatchView finally 종료) |
| src/extension/cli-process.ts | 158 | 예 | 158 `}` (childStdio 반환) |
| src/extension/contained-files.ts | 151 | 예 | 151 `}` (readdirWithin 종료) |
| src/extension/contained-tools.ts | 59 | 예 | 59 `}` (containWorkspaceTools 종료) |
| src/extension/delivery.ts | 104 | 예 | 104 `}` (registerDelivery 종료) |
| src/extension/inference-bridge.ts | 43 | 예 | 43 `}` (startInferenceBridge 종료) |
| src/extension/mail-tools.ts | 394 | 예 | 394 `}` (registerOmaTools 종료) |
| src/extension/principal-channel.ts | 85 | 예 | 85 `}` (PrincipalChannel 종료) |
| src/extension/principal-tools.ts | 133 | 예 | 133 `}` (registerPrincipalTools 종료) |
| src/extension/shared.ts | 28 | 예 | 28 `}` (requestKeyOf 종료) |
| src/extension/tool-surface.ts | 160 | 예 | 160 `}` (registerToolSurface 종료) |
| src/extension/utf8.ts | 9 | 예 | 9 `}` (decodeUtf8 종료) |
| src/extension/workspace-guard.ts | 119 | 예 | 119 `}` (guardWorkspaceTools 종료) |

호출 경로 확인용으로 그룹 밖 파일도 읽었다(판정 대상 아님): `src/storage/delivery-receipt.ts`,
`src/storage/paths.ts`, `src/broker/peer-authenticator.ts`, `src/platform/host/peer.ts`, `src/authority.ts`,
`implementation-spec.md`(SB-001/SB-004), `implementation/validation.md`(알려진 한계).

### 봉인 경계 목록 (residentArgv, src/sandbox.ts:99–128)

namespace: `--unshare-all`(user/mount/PID/IPC/network/UTS/cgroup) + `--new-session` + `--die-with-parent`.
cap: `--cap-drop ALL`. seccomp: fd3의 vsock filter(socket/socketpair의 AF_VSOCK만 EPERM). env: `--clearenv`
뒤 argv가 전체 환경. 상속 FD: `[0,1,2,3]`(3 = seccomp filter channel, SandboxModule.resident). rlimit/cgroup:
argv에 없음 — 자원 상한은 systemd unit(units.ts, MemoryMax/TasksMax/CPUQuota)이 준다.

| 항목(host→sandbox) | rw/ro | 누가 읽는가(host측) | 위조·삭제·교체 시 공격 결과 |
|---|---|---|---|
| rootfs → `/` | ro | 엔진 | 읽기전용. 변경 불가 |
| systemBinds(/usr,/bin,…) | ro | 엔진 | 읽기전용 |
| node → /opt/oma-node/node | ro | 엔진 | 읽기전용 |
| libdir → /opt/oma | ro | 엔진 | 읽기전용. hidden mask는 tmpfs+remount-ro / ro-bind /dev/null |
| /proc, /dev | proc/dev | 엔진 | 최소 devtmpfs(§3에서 확인: kmsg/mem/kvm/tun 없음) |
| /tmp | tmpfs(--size) | 엔진 | 크기 제한 있음 |
| workspace → /workspace | **rw** | runner(quota만), 다른 read 없음 | 모델 파일 효과. workspace-guard/contained-files가 host측 tool도 봉인 |
| home → /home/agent | **rw** | 엔진 자신 | 엔진 설정. broker/runner가 신뢰하는 durable fact 없음 |
| **sessions → /run/oma-sessions** | **rw** | **runner: makeBoundaryDurable / sessionPathCheck가 내용을 읽음** | 삭제→BATCH_CONFLICT(hold), 위조는 §5-A 참조(막힘) |
| archive → /mail/archive | ro | — | 읽기전용 |
| selfMail → /mail/self | ro | — | 읽기전용 |
| view → /run/oma-view | ro | — | 읽기전용. batch manifest 원천 |
| world → /world | ro | — | 읽기전용 |
| projectGit → /git/project.git | ro | — | 읽기전용 |
| projectMirror → /git/project-mirror.git | ro(-try) | — | 읽기전용 |
| lease socket → /run/oma/control.sock | ro-bind(소켓) | broker(peer 인증) | broker admin.sock은 **미마운트**(§5-D) |
| inference.sock → /run/oma/inference.sock | ro-bind(소켓) | relay(host) | credential은 sandbox 밖. relay가 chokepoint |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| X1-01 | Medium | boundary/resource | 봉인 Resident가 uid namespace로 분리되지 않는 per-uid 커널 keyring(`_uid.NNNN`)에 key를 만들고 quota(200개/20000B)를 소진할 수 있다 | confirmed |
| X1-02 | Low | boundary | vsock seccomp filter가 socket/socketpair만 보므로 `bpf(2)`·`io_uring`·다른 syscall 계열은 필터 밖이다(bpf는 EPERM이 아니라 EINVAL로 도달) | confirmed |

Critical: 0, High: 0, Medium: 1, Low: 1, Info: 0.

## 3. 발견 상세

### X1-01 봉인 Resident가 공유 per-uid 커널 keyring을 만들고 소진한다

- 심각도: Medium
- 분류: boundary/resource
- 위반 규칙: 없음(SB-001이 열거한 경계 밖의 커널 객체다. P0 위반은 아니나 SB의 봉인 의도와 어긋난다)
- 코드 경로: `src/sandbox.ts:99-101`(`--unshare-all --cap-drop ALL --seccomp 3`) → `src/runtime/vsock-seccomp.ts:41-52`(filter는 keyring syscall을 보지 않는다). 규범: `implementation-spec.md:447`(SB-001 baseline 열거에 keyring 없음), `implementation-spec.md:496`(SB-004는 network만).
- 원인: bwrap의 user namespace는 커널 keyring을 분리하지 않는다. `add_key(2)`/`keyctl(2)`는 filter 밖이고 CAP_DROP과도 무관하다(자기 uid의 keyring 조작에 capability가 필요치 않다). 그래서 봉인 안의 모델 조종 코드(bash 도구 또는 gcc로 만든 프로그램)가 `KEY_SPEC_USER_KEYRING`(host의 `_uid.NNNN`)에 key를 넣을 수 있다. 이 keyring은 같은 uid의 broker·runner·Principal·다른 Resident가 공유하며, 넣은 key는 host `/proc/keys`에 실재로 나타난다.
- 영향: (1) 봉인 경계가 의도한 "namespace로 분리되지 않는 커널 객체는 syscall로 막는다"는 원칙(vsock을 D-5에서 그렇게 다뤘다)이 keyring에는 적용되지 않아, sandbox와 host가 커널 객체를 공유한다. (2) 자원 고갈: 한 Resident가 per-uid quota(이 host `maxkeys=200`, `maxbytes=20000`)를 가득 채우면, 이후 같은 uid의 어떤 프로세스든 `add_key`가 EDQUOT로 거절된다 — OMA 자신은 keyring을 쓰지 않지만(grep 확인), 같은 uid에서 도는 credential 라이브러리(libsecret/kernel keyring backend 등)나 다른 Resident가 영향받는다. key를 revoke하지 않으면 keyring 수명(재부팅 전까지) 동안 유지된다. OMA가 keyring을 durable fact로 쓰지 않으므로 P0(확정 사실의 의미 변화)에는 닿지 않아 Medium으로 둔다.
- 최소 반례: 봉인 flag 아래에서 `add_key("user", name_i, "x", 1, KEY_SPEC_USER_KEYRING)`를 EDQUOT까지 반복. 이 host에서 193개째에 EDQUOT(errno 122).
- 재현 방법:
  - 도달성+host 가시성: `timeout 60 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/kernel-surface.mjs` → `keyring_add_user: OK`, `keyring_describe_user_session: OK`. `.../keyring-hostvis.mjs` → `host /proc/keys sees the sandbox key serial: true`, `HOST-VISIBLE`.
  - quota 소진(self-cleaning): `timeout 60 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/keyring-quota.mjs` → `per-uid maxkeys = 200` / `added=193 stopped_errno=122 (Disk quota exceeded)` / `revoked=193` / `EXHAUSTIBLE …`. 스크립트가 넣은 key는 같은 프로세스에서 전부 revoke하고, 실행 뒤 `/proc/keys`가 baseline(4)으로 복귀함을 확인했다.
  - 참고: 별 sandbox 사이 KEYCTL_SEARCH는 possession 기반이라 NOTFOUND이지만(`keyring-share.mjs`), key 객체 자체는 공유 `_uid` keyring에 실재하며 quota를 함께 쓴다(hostvis가 이를 보인다).
- 확신도: confirmed(재현됨, Linux 6.12.107, bwrap 0.12.0)
- 개선 방향(코드 수정 아님, 방향만): vsock을 syscall로 막은 것과 같은 논리로, filter에 `add_key`/`request_key`/`keyctl`을 EPERM으로 더하거나, bwrap이 지원하면 새 keyring을 소유하는 방법을 검토한다. 또는 이 노출을 SB의 알려진 한계로 명시하고(현재 validation.md "보안 경계"에 없음) per-uid keyring quota가 공유됨을 운영 문서에 적는다.

### X1-02 vsock filter가 socket/socketpair만 보므로 bpf·io_uring 등 다른 syscall 계열은 필터 밖이다

- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음
- 코드 경로: `src/runtime/vsock-seccomp.ts:41-52`(nr가 socket/socketpair일 때만 arg0=AF_VSOCK를 검사, 그 외 전부 ALLOW).
- 원인: filter는 AF_VSOCK 봉쇄라는 한 가지 목적만 가지며 `socket`/`socketpair` 번호에만 걸린다. 그래서 `bpf(2)`는 EINVAL(=인자 오류, 호출 자체는 허용됨)로 도달하고, io_uring은 `io_uring_setup`이 성공한다. io_uring의 `IORING_OP_SOCKET`으로 AF_VSOCK socket을 만드는 우회는 이미 확인된 사실(a)(= G05/X-01)이며 `repro/verify/uring-socket.mjs`로 이 host에서 재확인했다(`with filter: socket()=EPERM io_uring=made connected:outside-service`).
- 영향: filter는 vsock 우회를 완전히 막지 못하고(io_uring 경로는 열림), bpf 등 넓은 커널 표면이 cap-drop과 seccomp 밖에 남는다. bpf는 EINVAL로 도달만 확인했고 실제 map/prog 생성 성공은 확인하지 못했다(§6). Resident가 EPERM이 아닌 커널 코드 경로에 닿는다는 표면 사실이므로 Low.
- 최소 반례: 봉인 flag 아래 `syscall(SYS_bpf, 0, NULL, 0)` → errno 22(EINVAL). `io_uring_setup(8, &p)` → fd 반환.
- 재현 방법: `timeout 60 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/kernel-surface.mjs`(WITH filter 블록: `bpf_call: errno=22`, `io_uring_setup: OK`). vsock 우회: `timeout 60 node review/adversarial-2026-09-28/repro/verify/uring-socket.mjs`.
- 확신도: confirmed
- 개선 방향: filter를 "AF_VSOCK 봉쇄" 대신 "명시 allowlist" 또는 seccomp notify로 넓히는 방향, 혹은 io_uring op 자체를 거절하는 방향(kernel의 `io_uring_disabled`에 기대지 않는다). 방향만.

## 4. 리팩터링 필요 지점

- G05-03(이미 보고됨)와 일치: seccomp filter 바이트를 fd3에 넘기는 결정이 `SandboxModule.resident`(inheritedFds), `pi-adapter.deliver`(channel.end(filter)), `pi-spawn-plan`(filter 필드) 세 곳에 나뉘어 있다. 한 owner가 아니면 표류할 수 있다(P0-2). 새 발견은 아니고 X1 범위에서 재확인만.
- X1-01/X1-02는 모두 "namespace로 분리되지 않는 커널 객체를 syscall로 막는다"는 한 개념(D-5의 vsock 처리)의 불완전한 적용이다. keyring·io_uring·bpf를 같은 개념 아래 한 자리에서 다루면 P0-6("이름 없는 예외가 두 곳") 위험이 준다.

## 5. 점검했고 문제없다고 판단한 것 (공격했지만 막혀 있던 경로)

- **A. sessions rw mount로 durable receipt 위조** — 시도: 모델이 `/run/oma-sessions`에 boundary entry를 담은 가짜 session 파일을 써서 receipt를 조기 게시. 막힘: receipt를 게시하는 것은 신뢰 runner(`publishDeliveryReceipt`, delivery-receipt.ts)이며, boundary는 RPC `notify`(신뢰 extension delivery.ts가 `agent_settled`+`terminalStop==="stop"`에서만 emit)에서 `boundaryOf`(pi-adapter.ts:37)로 디코드된다. 모델은 엔진 stdout(RPC stream)을 만들지 못하므로 notify를 위조할 수 없다. 게다가 `makeBoundaryDurable`(delivery-receipt.ts)이 on-disk session에서 `isBoundaryEntry`(entryId·batchId·incarnation·messageIds 일치)를 다시 확인하고, `checkReceipt`가 incarnation을 이 batch의 attempt 범위(DR9)로 가둔다. session 파일 **삭제**는 BATCH_CONFLICT로 hold(관측 실패를 사실로 승격하지 않음, P0-5) — 이미 알려진 사실(b)/G01r2-01.
- **B. cgroup 위조로 다른 actor 행세(broker 인증 우회)** — 시도: 자기 cgroup을 Principal/다른 Resident의 것으로 바꿔 `peer-authenticator.context`/`runnerActor`를 속임. 막힘: broker는 peer PID의 **host측** `/proc/PID/cgroup`(peerCgroup, peer-authenticator.ts:14)을 읽어 unit cgroup과 대조한다. sandbox 안에서는 `/sys/fs/cgroup`이 read-only이고 `/proc/self/cgroup`이 `0::/`로 가상화되어 자기 cgroup을 옮길 수 없다(CAP_SYS_ADMIN 없음). 재현: `bwrap … -- sh -c 'echo test > /sys/fs/cgroup/cgroup.procs'` → `Read-only file system`. 추가로 pidfd liveness(peerPidFd)와 peer uid 검사가 겹친다.
- **C. TIOCSTI로 launcher tty에 키 주입** — 막힘: `--new-session`(setsid)로 controlling tty가 없다. 재현(`tty-probe.mjs`): `dev_tty: no controlling tty`, `tiocsti_stdin: refused`.
- **D. broker admin.sock / systemd user bus가 sandbox에 보이는가** — 막힘: `residentArgv`의 mount 표에 admin.sock(runRoot)도 user bus도 없다. per-incarnation `control.sock`만 ro-bind되고, `--unshare-all`이 IPC/abstract-socket/net namespace를 제거한다. 인증은 그 소켓 위에서 host측 credential(SO_PEERCRED)로 한다.
- **E. inference relay로 credential 유출/임의 목적지** — 막힘: relay(inference-relay.ts)는 목적지를 host가 고정(`parsedOrigin`, `targetPath` canonical 검사), caller authority header를 placeholder slot 밖이면 거절(`outboundHeaders`, 403 OUTSIDE_SLOT), 응답의 key 바이트를 tripwire로 잘라낸다(`CredentialTripwire`). 알려진 한계(WebSocket frame이 key를 가르면 tripwire가 못 봄)는 validation.md에 이미 있어 재보고하지 않는다.
- **F. workspace/home rw mount로 봉인 밖 파일 read/write** — 막힘: host측 도구도 `contained-files.ts`가 openat 기반 O_NOFOLLOW 컴포넌트 walk(symlink/hardlink/비정규 파일 거절)로 workspace 안에 가둔다. sandbox 안에서는 mount 표가 경계다(TSP-009).
- **G. userfaultfd / perf_event_open / /proc/sys write / 추가 /dev / mount(2)** — 막힘(§3 probe): userfaultfd EPERM, perf_event_open 거절, core_pattern write EACCES, kmsg/mem/kvm/tun 부재, mount(2) 실패.
- **H. principal credential이 Resident에 새는가** — 막힘: PrincipalChannel/CLI credential은 fd(socketpair) 위에서만 오가고 Resident 엔진은 그 채널을 부여받지 않는다(`attached`=false). env·argv에 credential 없음(cli-process.ts, mail-tools.cliEnvironment).

## 6. 확인하지 못한 것

- X1-02의 bpf: 호출 도달(EINVAL)만 확인했고, 실제 BPF map/prog 생성 성공 여부와 그로부터의 구체적 악용은 확인하지 못했다. cap-drop 아래 unprivileged bpf가 실효를 갖는지는 커널 설정(`kernel.unprivileged_bpf_disabled`)에 달렸고 이 host 값을 읽지 않았다.
- keyring quota 소진 중 다른 co-uid 프로세스의 add_key가 실제로 EDQUOT를 받는지는, 동시에 keyring을 쓰는 second 프로세스를 띄워 직접 관측하지 않았다(공유 keyring 소진 사실과 quota 공유는 hostvis+quota probe로 확인). systemd·sudo·실제 provider가 필요한 시험은 규칙상 하지 않았다.
- macOS guest 경로(egress-forwarder의 EGRESS_SOCKET, InferenceRelay.detached/accept)는 이 Linux host에서 실행 검증할 수 없어 코드 독해로만 판단했다(추론만).
- 실제 봉인 Resident를 systemd로 띄운 상태의 end-to-end는 규칙(systemctl 금지)상 확인하지 못했다. residentArgv flag 복제로 커널 표면만 확인했다.
