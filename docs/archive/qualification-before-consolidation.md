# Qualification 기록 — 정리 전 원문

작성 당시의 판단·probe·SP 요구를 보관한다. 현재 규범은 verification-spec, 실행 판정은 validation이 소유한다. 이 기록을 새로운 runtime PASS로 사용하지 않는다.

# OMA Core v1 — 미확정 구현 경계

**MUST [SP-001]** 이 파일은 [구현 계약](../implementation-spec.md)의 일부다. 각 항목은 [DR18](../design-revisions.md)이 판정했다(항목마다 "DR18 판정" 줄). 판정은 v1이 하는 것(증거와 함께)과 하지 않는 것(알려진 미지원 설정으로 거절한다)을 정한다. 하지 않는 것의 MUST 항목은 그 기능을 더할 때의 진입 조건으로 남는다. 이전 primitive 실험이나 문서 열람은 아래 실행 검증을 대신하지 않는다. 이 파일은 runtime state가 아닌 구현 검증 기록이다.

**MUST [SP-002]** 각 spike의 산출물은 `검증한 versions/config`, `실행 가능한 최소 harness`, `명령과 raw 결과`, `fault/negative 결과`, `선택한 좁은 adapter 계약`, `상위 architecture와의 차이 유무`다. 산출물은 tests/검증 문서에 보관한다. 성공한 것처럼 채운 signature·mock·boolean은 통과 증거가 아니다.

**MUST [SP-003]** 실패 시 해당 profile/경로를 차단하고 이유를 반환한다. 아키텍처 변경이 필요한 결과는 제안만 하며 이 spec의 근거 없는 확정으로 바꾸지 않는다. 아래 기재한 후보는 선택이 확정된 설계가 아니다.

## S-01 — Linux / Node / systemd / sandbox substrate

**DR18 판정 — 닫음(v1 기반).** 아래 결정(systemd+bwrap+내장 SQLite+koffi leaf)을 v1의 substrate로 확정한다. pin은 validation의 배포 manifest다(엔진 0.87.1). 같은 UID 외부 writer, kernel project quota, 전체 FD/PID stress는 validation "알려진 한계"에 남기고 gate로 쓰지 않는다. 증거: kernel lane.


**SPIKE [S-01]** 정확한 Node/Pi/Git/systemd/bwrap/SQLite/email codec pin, SO_PEERCRED/cgroup identity binding, READY notify, inherited FD close, rootfs/UID mapping, storage quota enforce 방법을 검증한다. Node에서 필요한 syscall binding을 제공할 library와 최소 native leaf 필요성이 미정이다.

**MUST [SP-01-T]** 일반 user service로 broker+runner+bwrap를 시작해 다음을 실행한다: Pi echo/tool, 동일 UID 타 actor 연결 시도, 직접 admin socket 접근, namespace PID와 host PID 매핑, actor exit 직후 PID 재사용 stress, grandchild process 생성 후 stop, FD enumeration, host home/bus/network 접근, tmp cap 및 persistent workspace/storage cap 초과. race 때문에 identity를 확정할 수 없으면 fail closed 결과가 나와야 한다.

**MUST [SP-01-A]** 해당 incarnation의 실제 cgroup 후손만 actor listener를 사용할 수 있고 타 actor·host arbitrary process·stale run은 거절해야 한다. READY 전 요청은 접수하지 않는다. systemd/bwrap 미지원 환경은 UNSUPPORTED_PROFILE이어야 한다. 최소 native leaf를 쓰면 TS application 경계/LOC에 반영한다. userns-try·UID-only 인증·host network fallback은 금지한다.

**S-01 실험 기록 (2026-09-07, 격리 /tmp/oma-spike-s01에서 실행)** — 검증 versions:
node v26.7.0 · npm 12.0.2 · git 2.55.0 · sqlite 3.53.4 (node:sqlite 내장, `node:sqlite` OK) · bwrap 0.11.2 · systemd 261 (user manager running) · koffi 3.2.1 · host: Arch Linux (cachyos), unprivileged_userns_clone=1, max_user_namespaces=62964. notmuch 미설치.

1. **bwrap userns 격리 (SP-01-T: host home/network/pid)** — 일반 user로 `--unshare-all --new-session --die-with-parent --cap-drop ALL --ro-bind <rootfs> / --proc --dev --size 1MiB --tmpfs /tmp --bind <ws> /workspace --ro-bind <obj> /mail/archive ...` 실행:
   - 내부 `id -u`=1000 (userns), host `/home/user` 비노출 (access denied), `/tmp` 쓰기 가능, `/workspace` bind RW.
   - network namespace 분리: `/sys/class/net` empty (기본 egress 없음). PID namespace 분리: 내부 pid=2, `pid:[4026533184]`. → SB-001/002 mount/namespace primitive 검증 통과.
   - **부정 발견**: `/run/user/1000` 전체를 `--ro-bind`하면 `at-spi` 데스크톱 소켓이 노출됨. → 규범 FS-001/arch처럼 **호스트 runtime 디렉터리 전체를 mount하지 않고 특정 incarnation socket(`R/actors/<actor>/<incarnation>/control.sock`) 하나만 mount**한다는 결정을 실증.
2. **Node SO_PEERCRED 없음** — `net.Server` unix socket에서 `remoteAddress/remoteFamily/remotePort` 모두 undefined, peer/pid/uid 필드 없음. Node 내장으로는 peer identity를 얻을 수 없음 → 최소 native leaf 필요.
3. **koffi FFI로 SO_PEERCRED 획득** — `getsockopt(fd, SOL_SOCKET=1, SO_PEERCRED=17)` 결과 `ret=0 pid=<connector-pid> uid=1000 gid=1000`. fd는 `sock._handle.fd`(비공개 필드)에서 취득. → S-01의 peer identity leaf 경로 실증. (비공개 `_handle.fd` 의존은 SP-02/S-02에서 노출 경계 재검토.)
4. **Node dgram은 AF_UNIX datagram 미지원** — `dgram.createSocket('unix'|'unix_dgram')` → `ERR_SOCKET_BAD_TYPE` (udp4/udp6만).
5. **koffi로 sd_notify (Type=notify READY=1)** — `socket(AF_UNIX,SOCK_DGRAM)`+`connect(NOTIFY_SOCKET)`+`send('READY=1')`: `systemctl --user start oma-spike-notify2.service` exit 0, `Result=success ExecMainStatus=0`. → UNIT-004 broker READY notify 경로 실증.
6. **systemd user service 수명주기** — Type=exec service: start→active, `ControlGroup=/user.slice/.../oma-*.service`에 pid 1개 배정; stop 후 cgroup 디렉터리 제거(후손 종료). start/stop/reset-failed 동작.
7. Pi bundle/소스는 `SO_PEERCRED`/`NOTIFY_SOCKET`/`sd_notify`/`unix_dgram` 미사용 — Pi가 이 leaf를 제공하지 않으므로 OMA leaf가 필요함.

**결정**: systemd+bwrap+sqlite(내장)+git substrate는 사용 가능. SO_PEERCRED와 sd_notify는 **최소 native leaf(koffi FFI)로 충족**. TS 경계는 `sandbox.ts`/`units.ts`/`auth`에 이 leaf를 격리한다.

**현재 기본 runtime 판정**: broker process마다 하나의 `StorageAdmission`이 매 결정마다 owned state tree의 allocated/logical bytes를 새로 관측하고, 여기에 아직 tree에 나타나지 않은 예약을 더해 `quota.storageBytes`와 비교한다(cache 없음). method의 인증·버전·DTO·key·권한 검사가 끝난 뒤 resource category가 `admit`이면 초과를 `QUOTA_EXCEEDED`로 거절한다. `settle`(이미 수락된 일의 정산)은 quota를 넘어서도 기존 `limits.frameBytes`만큼의 headroom 안에서 한 번에 하나만 진행하고, headroom을 넘으면 거절한다. `read`·`safety-control`과 같은 key로 이미 수락된 요청의 조회는 거절하지 않는다. streamed request는 preflight에서 선언 bytes를 예약하고, 실행이 끝나거나 연결이 닫힐 때 한 번만 반납한다. 따라서 streamed request에는 transport copy와 accepted copy를 합친 공간이 필요하다. 시작 시에는 같은 settlement 판정으로 bounded recovery에 들어간다. 이 scan은 hard filesystem quota가 아니다. 같은 UID의 외부 writer와 SQLite/WAL 증가는 사후에 관측될 뿐 막지 못하며, 실제 공간 부족은 `STORAGE_FULL`로 따로 보고한다. trusted Pi extension은 write/edit 전에 role의 `workspaceBytes`를 별도로 집행한다. 따라서 이전의 unconditional S-01 `SPIKE_UNRESOLVED` 시작 차단은 제거한다. 같은 UID의 외부 host writer·filesystem kernel project quota와 full FD/PID stress는 release-hardening 범위로 남으며 기본 기능의 시작 차단으로 사용하지 않는다.

### S-01-CANDIDATE — candidate resource execution primitive

**DR18 판정 — v1에 없음.** v1은 candidate check를 돌리지 않는다. `integration.checks`, `sandbox.candidate`, `git.runCheck`는 `UNSUPPORTED_PROFILE`이다. 아래 MUST는 이 기능을 더할 때의 진입 조건이다. 증거: `DR18 / S-01-CANDIDATE:`.


**SPIKE [S-01-CANDIDATE]** fixed unit set을 변경하지 않고 candidate check의 CPU/memory/tasks/tmp/workspace/staging 한도와 모든 후손 종료를 실제 kernel 경계에서 집행하는 primitive가 필요하다. 현재 구현은 bwrap/systemd cgroup으로 candidate descendant timeout을 검증하지만 workspace/staging quota와 고정 worker 경계 전체를 production profile로 확정하지 않았다.

**현재 상태 (2026-09-10)**: T62-resource는 unresolved workspace/staging limit을 candidate 실행 전에 `SPIKE_UNRESOLVED`로 차단하는 것을 확인했고, T61 계열은 candidate descendant 종료를 확인했다. 이것은 S-01-CANDIDATE 전체 통과가 아니다.

**MUST** transient `systemd-run`/새 durable unit, userland polling만으로 candidate 격리를 완성했다고 표시하지 않는다. 허용 primitive와 exact argv/mount/FD/resource observation이 validation 기록에 고정되기 전 non-empty integration checks production profile을 활성화하지 않는다. checks를 자동으로 빈 배열로 바꾸는 fallback도 금지한다.

## S-02 — 기존 Principal Pi의 host/private 경계

**DR18 판정 — 닫음.** OMA가 session을 띄우므로 외부 session attach는 범위 밖이다. SP-02-T/A의 기준 가운데 credential 비노출은 T114와 SCN-B09(모델이 도구로 엔진 credential을 어떤 경로 표기로도 읽지 못하고 society state를 나열하지 못한다), commons 자동 주입 0건과 질문의 한 번 전달은 SCN-B10(commons 100통 + 질문 1통), duplicate attach 거절은 T114가 실제 프로세스로 보인다. 실제 모델로 도는 점검은 validation의 provider 점검 기록이다.


**SPIKE [S-02]** 기존 interactive Pi session에 attach하는 정확한 API/credential 전달, 모든 model-facing tool override, trusted extension helper와 model tool의 분리 방식을 검증한다. Principal에게 full Human context를 유지하면서 model tool이 host filesystem/credentials를 읽지 못해야 한다.

**S-02 상태 (2026-09-07)**: 실험 미실행 — 기존 interactive Human Pi session에 attach하는 경로는 사용자 host의 실제 Pi 환경을 건드리지 않아야 하며(작업 지시: 격리 검증 환경 요구), attach 대상이 될 Human session이 격리 환경에 존재하지 않는다. → **OPEN, 실행 불가 환경**. phase 5(principal-relay/extension attach)에서 격리 Human session을 구축할 수 있는지 재평가한다. UID-only/무격리 fallback은 만들지 않는다 (SP-03).

**S-02 범위 재평가 (2026-09-18)**: architecture §23.3과 TUI-004가 Principal session의 소유권을 바꿨다. OMA TUI가 `pi --mode rpc`를 직접 실행하므로 attach 대상이 되는 session이 OMA 배포 안에 존재한다. 따라서 "실행 불가 환경"이라는 차단 사유는 해소되며, S-02는 **OPEN이되 실행 가능**으로 바뀐다.

**S-02 부분 확정 (2026-09-19)**: IPC-011이 미루고 있던 것은 "남이 띄운 Pi session에 어떻게 붙는가"였다. OMA가 session을 직접 기동하므로 그 질문 자체가 사라졌고, credential 발급·교환 handshake는 IPC-011에서 확정했다. broker가 run마다 credential을 만들어 run directory에만 게시하고, host가 자신이 띄운 session에만 넘기며, attach 이전 요청과 두 번째 session의 attach를 거절하는 경로는 `test/principal-endpoint.test.ts`(T114)에서 실제 socket과 실제 CLI로 검증한다. 외부 session attach는 여전히 범위 밖이다.

바뀌지 않는 것은 통과 기준이다. SP-02-T/SP-02-A의 tool override, credential 비노출, UI 종료/재연결, commons 자동 주입 0건은 그대로 요구하며, 이 중 duplicate attach 거절과, credential 비노출 가운데 host 쪽 경로(파일·환경·명령행·`/proc` 재열기 없음, 비자손 프로세스의 attach 거절)는 T114가 실제 프로세스로 검증한다. model이 도구로 credential을 읽으려 하는 시험과 나머지 기준은 실제 모델이 도는 환경을 요구하므로 S-02는 OPEN이다. 검증 대상이 "사용자가 띄운 Pi"에서 "OMA가 띄운 Pi"로 바뀌었을 뿐이며, 소유권이 OMA에 있다는 사실이 PR-004의 model-facing tool 제한을 면제하지 않는다. TUI가 존재한다는 것만으로 S-02를 닫지 않는다.

**MUST [SP-02-T]** 기본 shell/read/write/edit, alias, 추가 extension tool, subtool, custom provider hook, 경로 traversal/symlink를 각각 실행한다. model에게 attach credential·session 파일 읽기를 요청해 거절을 확인한다. duplicate attach와 UI 종료/재연결을 반복하고 commons 100개와 principal 질문 1개를 보낸다.

**MUST [SP-02-A]** Human history는 기존 session에 유지되고 commons 자동 주입은 0건, principal 질문은 동일 session에만 전달되어야 한다. UI 부재 동안 Astra 호출은 0건이다. tool 하나라도 host로 우회하면 profile 출시를 막는다. 별도 SOTA worker 생성으로 우회하지 않는다.

## S-03 — Pi 실시간 알림과 durable batch 경계

**DR18 판정 — 닫음(followUp만).** v1은 batch를 activation 때 준비해 followUp으로 전달하고 `agent_settled` 경계의 host-private receipt로 완료한다. run 중에 도착한 mail은 다음 run의 batch다. run 중 steer는 v1 기능이 아니다(PI-003). 모델이 writable session을 바꿔 완료를 위조하지 못한다: 완료의 증거는 runner가 쓰는 host-private receipt다(BATCH-006). 증거: `S-03: only the pinned durable Pi boundary receipt completes a prepared batch`, T31-neg, SCN-S03, SCN-F16, crash-kill의 receipt 경계. 아래 SP-03-T/A/D는 steer를 더할 때의 진입 조건이다.


**SPIKE [S-03]** architecture §§7.1/18.2는 성공 agent_end에서 batch 완료를 기록하고 prepared snapshot을 확장하지 않는다. 동시에 §7은 busy Pi의 현재 tool group 다음 LLM 호출 전에 새 direct mail을 steer하도록 요구한다. 이 둘을 만족하는 pinned Pi의 custom message 귀속·batch prepare 시점·동시 prepared 수는 아직 확정되지 않았다.

**S-03 실험 기록 (2026-09-07, 격리 /tmp/oma-spike-s03에서 실행)** — pi 0.85.1 (설치본, reference commit e687434a60174db1a9c961d973881a7a851a0597과 version 일치). `PI_CODING_AGENT_DIR=<tmp>/agent`로 격리 (사용자 확장 미로드), `pi --mode rpc -e <oma-ext.ts> --no-session`.

1. **extension command 실행**: RPC prompt `{"type":"prompt","message":"/oma-deliver b-123"}` → 등록한 `oma-deliver` handler 실행, `ctx.ui.notify('oma-deliver executed for b-123')` 수신.
2. **custom message + triggerTurn + deliverAs=steer**: handler의 `pi.sendMessage({customType:'oma-mail', content, display:true, details:{batchId}}, {triggerTurn:true, deliverAs:'steer'})` → `turn_start` 후 `message_start{role:'custom',customType:'oma-mail',...}`로 스트림 전달. → **peer content가 Human role로 위장되지 않음**(role='custom' 확증).
3. provider 미설정 격리 프로파일에서 assistant turn은 `Unknown provider: unknown`, `stopReason:'error'`로 종료 — 모델 없는 프로브의 기대 동작이다. provider 해석은 동봉 엔진이 소유하므로(INF-001) OMA 쪽 gate는 없다.
4. RPC 계약(rpc.md) 확인: `steer` = 실행 중 assistant turn의 tool call들을 마친 뒤 다음 LLM 호출 전에 전달; `followUp` = agent 종료 후 전달; `set_steering_mode`(all/one-at-a-time) 존재. S-03의 steer/followUp 경로가 pinned Pi에 존재함을 실증.

5. **run과 settle의 단위 (2026-09-20, 동봉 pi 0.85.1 원문 확인)**: `docs/rpc.md`는 `agent_end`를 "retry, compaction 또는 queued continuation이 뒤따를 수 있는 한 번의 낮은 수준 agent run 완료"로, `agent_settled`를 "full session-level run이 settle되어 자동 retry·compaction retry·queued follow-up이 남지 않은 시점"으로 구분한다. 구현(`dist/core/agent-session.js`)의 `_runAgentPrompt`는 `agent.prompt()` 뒤에 queue가 빌 때까지 `agent.continue()`를 돌리고 `finally`에서 `_emitAgentSettled()`를 한 번 호출한다. `prompt`의 `streamingBehavior`는 `isStreaming`일 때만 해석되고, 아니면 무시되어 새 run이 시작된다. → **queue에 든 prompt 수와 `agent_settled` 수는 같지 않다.** Principal session 소유권의 단위를 turn이 아니라 run으로 잡고, 대기 중인 Human prompt를 engine queue가 아니라 host에서 들고 있는 근거다.

**결정**: 확장 command + custom message + deliverAs 경로는 pi 0.85.1에서 동작. 준비된 batch를 읽어 steer/followUp으로 안내하는 `pi-extension.ts` adapter 계약의 기반 확보.

**후속 검증 필요**: 기본 followUp completion 경계는 아래와 같이 구현했지만, 두 tool 실행 중 steer의 tool-result 보존, 동시 prepared/두 번째 batch 귀속, 전체 kill-point matrix는 S-03 전체 판정을 위해 남아 있다.

**현재 runtime 상태 (기본 production followUp)**: `PiAdapter`가 prepared batch ID를 RPC command로 전달하고, trusted core extension은 terminal `stop`의 `agent_settled` handler에서 `oma-delivery-boundary` session entry를 append한 뒤 작은 boundary notification을 낸다. Runner는 Pi 종료 뒤 host-private receipt를 exclusive write+fsync하고, broker는 exact adapter revision/batch manifest/incarnation/session root/receipt path를 재검증한 뒤 같은 transaction에서 `batches.session_path`, completed, presented를 기록한다. Receipt가 먼저 durable해진 crash는 다음 run에서 같은 batch ID로 complete를 재시도한다. Fake owned RPC child + receipt negative/replay tests와 실제 연결된 Pi provider에서 이 좁은 경로를 확인했으며, production Runner/Mail의 별도 `SPIKE_UNRESOLVED` gate는 두지 않는다.

**여전히 OPEN인 S-03 범위**: 두 tool 실행 중 `steer`, 동시 두 번째 batch, 각 kill point와 writable-session 공격 전체 matrix는 아직 미실행이다. 기본 activation/followUp completion을 사용할 수 있다는 판정만 고정하며 S-03 전체, storage/systemd 또는 release qualification 통과로 확대하지 않는다.

**MUST [SP-03-T]** tool 두 개가 실행 중인 Pi에 direct 질문을 넣고, 두 tool 결과가 모두 보존된 다음 inference에 custom notice가 포함되는지 확인한다. 별도 public followUp도 넣는다. 첫 batch가 끝나기 전에 두 번째 질문, context update, stop/abort, UI reconnect를 주입한다. batch prepare 전/후, cur 이동 후, custom notice 전/후, tool effect 후, agent_end 직전/직후, session 저장 전/후, DB complete 전/후에 kill한다.

**MUST [SP-03-A]** 각 notice의 immutable message ID snapshot과 정상 boundary 귀속을 증명하고, 미확정은 동일 ID로 재안내한다. tool result 유실·자동 tool replay·미완료 mail 영구 누락은 0건이어야 한다. 모델이 writable session JSON을 바꿔 trusted completion을 위조하지 못해야 한다. 오래된 incarnation의 complete는 거절해야 한다.

**MUST [SP-03-D]** 통과 결과로 PiAdapter의 실제 import/signature, prepared batch 동시성, 클래스 분리, completion receipt 필드/flush 순서, FIFO와 fairness의 적용 시점을 확정한다. 여섯 entity와 prepared/completed 의미 안에서 증명이 안 되면 상위 architecture 검토로 올린다. 임의로 `active/queued/thinking/reviewing` state, notice event log, cognitive checkpoint를 추가하지 않는다. 모든 busy mail을 agent_end까지 미루는 타협도 조용히 확정하지 않는다.

## S-05 — hostile bundle / canonical object import

**DR18 판정 — 닫음.** 손상 pack, `fsck --strict`가 거절하는 object, 추가 ref가 든 bundle은 거절하고 canonical을 바꾸지 않는다. 압축이 큰 blob은 압축된 채 저장되므로 quarantine과 canonical은 pack 크기만큼 자란다. bundle 크기는 CLI의 `OMA_BUNDLE_BYTES`가, quarantine의 CPU·memory·tasks·시간은 `QUARANTINE_RESOURCES`가 묶는다. 증거: `S-05:` 세 시험(`test/s05-hostile-bundles.test.ts`), GIT-006 시험, durable-boundaries의 git 경계.


**SPIKE [S-05]** 검증된 quarantine에서 canonical object store로 옮길 정확한 pack/import/flush recipe와 resource limit을 결정한다. Resident clone의 objects hardlink/mutable alternate는 후보가 아니다.

**MUST [SP-05-T]** prerequisite 있는 작은 incremental bundle과 full bundle을 만들고 exact C peer fetch를 확인한다. 누락 prerequisite, 추가 main ref, exported C 불일치, malformed pack, object hash 손상, excessive expansion/depth, symlink staging, hook/config injection, interrupted import, published ref 충돌을 주입한다. quarantine은 network 없는 제한 sandbox로 실행한다.

**MUST [SP-05-A]** invalid input은 canonical ref를 바꾸지 않으며 검증된 reachable C만 게시할 수 있어야 한다. canonical objects를 읽는 quarantine은 RO이고 Resident는 canonical objects에 쓰지 못한다. publish 후 crash에도 object/ref 연결성이 유지되어야 한다. 사용한 Git versions/object formats별 정확한 argv/env·fsync 설정을 기록한다.


**S-05 실험 기록 (2026-09-07, 격리 /tmp/oma-spike-s05에서 실행)** — git 2.55.0, `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_NO_REPLACE_OBJECTS=1`, branch `main` 명시 생성.

1. **증분 bundle vs full bundle**: 256KiB base + 1줄 수정 commit C. `bundle create ... refs/oma/export/req1 ^<BASE>` = 389B, full `... refs/oma/export/req1` = 779B. → prerequisite 제외 증분 경로 실증.
2. **quarantine + RO alternate (GIT-007)**: fresh bare quarantine에 `objects/info/alternates`로 canonical `objects/` RO 참조 추가. `bundle verify` 통과(sha1), `fetch --no-tags <bundle> refs/oma/export/req1:refs/oma/input` → input=C, `fsck --strict --no-reflogs` 0 issues.
3. **canonical 객체 수입 + published ref**: quarantine에서 canonical으로 `fetch --no-tags <quarantine> refs/oma/input:refs/oma/input` → canonical에 C object 존재(`cat-file -t C`=commit). `update-ref refs/oma/published/a/op-1 C <zero>` 성공.
4. **peer fetch exact candidate**: B가 `fetch --no-tags origin refs/oma/published/a/op-1` → `FETCH_HEAD=C`, `show FETCH_HEAD:fix.txt`=`fix` (정확한 candidate/path).
5. **CAS 경쟁 (INT-003)**: 같은 base에서 A의 C로 `update-ref refs/heads/main C BASE` 성공 → main=C. 이후 B의 C2(같은 base)로 stale `update-ref ... C2 BASE` → `exit 128`, actual main=C 유지. → 첫 승자만 성공, 패자는 stale-base 실패.
6. **hostile bundle (GIT-006)**: export ref + `main`을 함께 담은 bundle의 `list-heads`가 `refs/oma/export/req1` + `refs/heads/main`을 노출 → 요청 export ref 하나만 허용 규칙으로 BUNDLE_INVALID 거절 대상임을 확인.
7. 이 환경의 git 기본 브랜치는 `master`(main 아님) — 규범 canonical `main`은 init 시 명시 생성 필요. git default branch config는 host 배포 manifest에서 고정.

**결정**: bundle+RO alternate quarantine+canonical 수입+published ref+peer fetch+CAS race의 실제 argv/env recipe가 동작. S-05의 순수 git substrate는 검증됨.

**아직 OPEN (후속 단계 필요)**: quarantine resource limit(CPU/mem/pid/tmp), excessive expansion/depth, symlink staging, hook/config injection, interrupted import의 crash 내구성, pack flush 세부 — runtime harness(phase 7)에서 재실행.

**현재 runtime 상태 (2026-09-10)**: published ref/peer exact fetch/CAS race/extra-ref rejection 및 private quarantine 경로는 test suite에서 실행됐다. hostile malformed pack, interrupted import, 전체 resource exhaustion corpus가 남아 있으므로 S-05 전체를 완료로 표시하지 않는다.
## S-06 — durability / systemd races / storage qualification

**DR18 판정 — process crash는 닫음, 전원 장애는 release gate.** durable 경계 64개 가운데 44개가 SIGKILL로 시험된다(P0-7 registry). state는 local kernel file system에 있어야 한다: NFS·SMB/CIFS·FUSE(virtiofs 포함)·9P·Ceph·AFS·Coda·NCP는 시작 때 `UNSUPPORTED_PROFILE`이다(REC-004, `DR18 / S-06:`). 시험한 file system은 ext4와 tmpfs다. 전원 장애·ENOSPC·read-only remount는 powercut lane(승인된 VM)의 몫이며 그 전에는 "전원 장애에도 유실 없음"을 말하지 않는다.


**SPIKE [S-06]** SQLite FULL+WAL, eml/object/link/rename, Git object/ref, directory fsync와 지원 filesystem의 전원 장애 보장을 검증한다. systemd .path 재활성화 및 cgroup death 확인도 실서비스에서 검증한다.

**S-06 상태 (2026-09-07)**: 전원 장애(abrupt power loss)·VM fault 시험은 전용 disposable VM/fault-injection harness가 없어 **미실행, OPEN (환경 부재)** — SIGKILL/sudo 불가 환경이므로 host를 위험에 빠뜨리지 않는다 (작업 지시: VM 없으면 S-06 결과를 unresolved로 남긴다). process-kill 지점(T18-T22/T27/T30/T39/T57/T58/T63/T66)은 실제 subprocess kill로 실행 가능하며 구현 단계(phase 3 mail, phase 7 git)에서 실행해 별도 기록한다. systemd `.path` 재활성화·cgroup death는 phase 4(units)에서 실서비스로 재검증한다. SIGKILL 통과만으로 power-loss passed로 표시하지 않는다 (SP-06-A).

**MUST [SP-06-T]** test matrix의 process kill 지점을 실제 subprocess kill로 실행하고, 별도 VM/지원 fault 환경에서 write ordering·abrupt power loss·ENOSPC·read-only remount를 시험한다. accepted receipt를 외부 harness에 기록한 뒤 reboot 결과와 대조한다. stop 중 mail 도착, 마지막 idle check 뒤 mail 도착, start-limit, broker crash, principal offline backlog를 실서비스로 반복한다.

**MUST [SP-06-A]** 지원 profile의 accepted message/operation은 복구 가능하고 false-success가 없어야 한다. cur에 있는 미완료 mail이 유실되지 않고 stopped agent가 inference하지 않아야 한다. resource cap·fsync의 보장 범위와 미지원 filesystem을 명시한다. SIGKILL test만으로 power-loss passed라고 표시하지 않는다.

**현재 runtime 상태 (2026-09-10)**: process-level mail kill 지점, systemd stop/start-limit/stale cgroup, broker singleton lock, Git/context crash-equivalent reconcile이 실행됐다. VM 전원 장애, ENOSPC, read-only remount, backup/restore는 미실행이며 S-06 release gate는 OPEN이다.

## S-07 — OPTIONAL notmuch / reflink / egress

**DR18 판정 — v1에 없음.** notmuch·reflink·project egress는 꺼 둔다. provider로 가는 길은 relay(INF-005)와 macOS의 egress channel(macos-platform §4.7)뿐이다. 아래 SP-07-A는 각 기능을 더할 때의 조건이다.


**SPIKE [S-07]** 각 optional 기능은 독립 gate다. notmuch의 database.path/mail_root와 indexer/model mount mapping, reflink의 inode/object 독립성, egress proxy allowlist와 credential 비노출을 검증한다.

**MUST [SP-07-A]** notmuch rebuild/손상/old index 후에도 archive path가 직접 열리고 routing에는 영향이 없어야 한다. reflink 불가면 독립 clone으로 fallback하며 hardlink하지 않는다. egress는 Human 설정 endpoint 외 연결을 거절한다. 기능별 결과가 없으면 각각 꺼 둔다. 새 index daemon은 기본으로 추가하지 않고 기존 reconcile이 제한된 index subprocess를 요청한다.

## S-08 — base optional / tiered required attestation gate

**DR18 판정 — v1에 없음.** tiered integration과 attestation은 v1 밖이다. base profile의 보호 경로 거절이 그대로 남고 approve/object/revoke는 노출하지 않는다.


**SPIKE [S-08]** Human이 신뢰 주체/quorum/보호 경로/Principal 위임을 선택한 뒤 최소 append-only attestation DDL, revoke relation, tuple evaluation을 확정한다. 이 계약은 quorum 수나 'agent 2명=독립 2표'를 결정하지 않는다.

**MUST [SP-08-A]** 동일 actor 중복/자식 생성/다른 base/candidate/policy 재사용/자연어 위조/Human channel 위조를 거절해야 한다. 필요한 추가 entity는 architecture에 이미 허용된 attestation 범위만 사용한다. 결과가 없으면 기본 profile의 protected path 거절을 유지하고 approve/object/revoke를 노출하지 않는다.

Tiered profile에서 S-08은 [`integration-policy.md`](../implementation/integration-policy.md)의 authenticated exact-candidate attestation 계약을 충족하기 전까지 `OPEN`이다. base에서 optional이라는 이유로 tiered에서 생략하거나 approval DB/API를 추측 구현해서는 안 된다.

## S-09 — 성능 목표와 모델 사용성 수용 기준

**DR18 판정 — v1은 성능 주장을 하지 않는다.** 문서는 Principal token 감소나 품질을 달성한 것으로 말하지 않고, release gate에 성능 threshold가 없다. 아래 protocol은 성능을 주장할 때의 조건이다.


**SPIKE [S-09]** 동일 task 집합·예산/시간 cap·반복 수·통계 및 품질 비열등성 margin은 실험 전에 고정한다. Principal tokens 감소와 Astra 단독 수준 이상 품질이라는 목표의 실제 달성 여부는 아직 미검증이다.

**MUST [SP-09-T]** strong 단독/cheap 단독/hybrid에 같은 repository snapshot과 tools를 제공하고 반복한다. quality/defect/omission, Principal 및 전체 tokens/cost, latency, commons의 Principal 유입 건수, 경로/ID lookup 실패, 첫 유용한 행동까지 tool 수, Principal 재검증 비용을 기록한다.

**MUST [SP-09-A]** 값은 task별·반복별로 남기고 목표 미달도 공개한다. production runtime correctness gate와 '성능 목표 달성' 주장을 구분한다. S-09 gate는 평가 protocol과 결과 제출을 필수로 요구하며, 미달 결과를 성공으로 바꿀 권한은 없다. 성능 목표를 release acceptance로 삼을 정확한 threshold는 사용자 합의 전까지 미정이다.

## S-10 — tiered challenge + persistent floor

**DR18 판정 — v1에 없음.** tiered integration과 함께 v1 밖이다.


**SPIKE [S-10]** canonical 범위와 성공 기준은 [`integration-policy.md`](../implementation/integration-policy.md)의 challenge/floor 계약이다. authenticated challenge와 persistent floor의 DDL/migration/recovery 의미가 실행 증거로 고정되기 전에는 challenge mutation API나 durable floor state를 추가하지 않는다. 현재 상태는 `OPEN`이다.

**MUST [SP-10-A]** S-10이 닫히기 전 tiered integration을 활성화하지 않는다. challenge 또는 floor를 process-local cache, caller boolean, 자연어 mail, 임의 DB column으로 대체하지 않는다.

## S-11 — OPTIONAL fresh clean-room verifier

**DR18 판정 — v1에 없음.** verifier state와 API를 두지 않는다.


**SPIKE [S-11]** canonical 범위와 성공 기준은 [`integration-policy.md`](../implementation/integration-policy.md)의 fresh-context verifier 계약이다. 선택 기능이며 exact verifier input/output, isolation, revision pin과 negative evidence가 별도로 고정되기 전에는 구현 또는 활성화하지 않는다. 현재 상태는 `OPEN`이다.

**MUST [SP-11-A]** S-11을 선택하지 않은 base/tiered profile에 verifier state/API를 추가하지 않는다. 선택하는 profile은 fresh verifier가 기존 writable session이나 caller-supplied verdict를 authority로 받아들이지 못함을 증명해야 한다.


---

## 운영 문서의 WP31 지원 checkpoint

다음은 문서 통합 직전 `operations/README.md`에 있던 기록이다. 작성 당시의 검증 조합과 남은 점이며 현재 지원 판정은 validation을 따른다.

## 지원 범위 (WP31)

검증한 조합과 검증하지 않은 것을 구분한다. 적히지 않은 조합은 지원한다고 가정하지 않는다.

| 항목 | 검증한 값 | 근거 / 남은 것 |
|---|---|---|
| Node | 24.21.0 (host와 일회용 계정 모두) | `node:sqlite` `DatabaseSync` 사용. `package.json`에 `engines`가 없고 다른 Node는 NOT_RUN |
| OS / kernel | Debian 13, Linux 6.12.107, cgroup v2 | 제거된 cgroup 디렉터리의 fd는 nlink가 그대로여서 `cgroup.events` 부재로 판정(WP07) |
| systemd user manager | 257.13 | WP25에서는 `failed/exit-code`에 누적 `NRestarts ≥ StartLimitBurst`를 결합했으나 현재 interval의 증거가 아니므로 DR27에서 제거. 명시적 `failed/start-limit-hit`만 제한 확정이며 `exit-code`는 실패 원인 미확인으로 남음. 최신 실제 manager 회귀는 NOT_RUN. path 설정은 C escape를 풀지 않음, ExecStart는 풂(WP03) |
| util-linux | 2.41.5 | `unshare --forward-signals` 없음 → quarantine은 SIGKILL만 사용(`608f6ed`) |
| bubblewrap | 0.12.0, `/usr/bin/bwrap` 고정 | 봉인 Resident는 이 경로로 시작(WP27). bwrap 없는 host는 `installation.rootfs = "/"`(비봉인)만 가능 |
| 엔진 | `@earendil-works/pi-coding-agent`·`pi-ai`·`pi-agent-core`·`pi-tui` 0.87.1 | 설치본의 `node_modules`에 있는 것만 사용하고 상위 디렉터리나 PATH의 엔진으로 물러서지 않음(WP31). 0.85.1에서 올림(ENG1). 실제 provider는 수동 기능 점검만 했고 자동 lane은 NOT_RUN |
| native 모듈 | `koffi` 3.2.1 | `check:package`가 로드만 확인. pidfd·SO_PEERPIDFD·cgroup 능력은 kernel lane이 확인 |
| 기타 런타임 의존성 | `nodemailer` 10.0.1, `typebox` 1.3.27(엔진과 같은 버전, ENG1) | lockfile의 production 분류와 `check:package`의 버전 대조 |
| 설치 방식 | 빌드된 트리를 `installation.libdir`로 사용 | `npm pack`은 `dist`를 싣지 않으므로 npm 패키지는 실행 가능한 산출물이 아니다. 빌드한 checkout에서 `npm install -g .`가 `bin`의 `oma` 명령을 설치한다(C2, DR18) |
| systemd-managed broker | 렌더와 `systemd-analyze verify`만 | 운영 lifecycle은 NOT_RUN, 지원한다고 표시하지 않음 |

호환성: WP03 이전에 렌더된 Resident unit은 launch location이 없고, WP25 이전 unit은 accepted 자원(`OMA_RESOURCES_HEX`)이 없어 runner가 시작을 거절한다. 기존 unit을 다시 렌더하는 경로는 없으므로 그런 society의 Resident는 다시 만들어야 한다. 관리형 설정 generation(WP13)은 이전 버전 writer가 알지 못하므로, 이전 바이너리로 같은 설정을 편집하지 않는다.

lockfile: 2026-09-19 `package.json`이 엔진과 `pi-tui`를 `dependencies`로 옮겼지만 `package-lock.json`은 둘을 개발 의존성으로 남겨 두어 `npm ci --omit=dev` 설치에서 엔진이 빠졌다. WP31에서 버전 변경 없이(0건) 분류만 맞췄다.
