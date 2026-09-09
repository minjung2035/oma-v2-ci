# OMA Core v1 — 미확정 구현 경계

**MUST [SP-001]** 이 파일은 [구현 계약](../implementation-spec.md)의 일부다. 모든 항목의 현재 상태는 `OPEN`이다. 이전 primitive 실험이나 문서 열람은 아래 실행 검증을 대신하지 않는다. 이 파일은 runtime state가 아닌 구현 검증 기록이다.

**MUST [SP-002]** 각 spike의 산출물은 `검증한 versions/config`, `실행 가능한 최소 harness`, `명령과 raw 결과`, `fault/negative 결과`, `선택한 좁은 adapter 계약`, `상위 architecture와의 차이 유무`다. 산출물은 tests/검증 문서에 보관한다. 성공한 것처럼 채운 signature·mock·boolean은 통과 증거가 아니다.

**MUST [SP-003]** 실패 시 해당 profile/경로를 차단하고 이유를 반환한다. 아키텍처 변경이 필요한 결과는 제안만 하며 이 spec의 근거 없는 확정으로 바꾸지 않는다. 아래 기재한 후보는 선택이 확정된 설계가 아니다.

## S-01 — Linux / Node / systemd / sandbox substrate

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

**아직 OPEN (후속 단계 필요)**: 실제 broker+runner를 통한 actor-listener 인증 강제, PID 재사용 stress, READY 전 요청 거절, 저장소 quota 강제(파일시스템 수준), full FD enumeration. 이들은 runtime 구현 단계(phase 2+)에서 재실행한다.

### S-01-CANDIDATE — candidate resource execution primitive

**SPIKE [S-01-CANDIDATE]** fixed unit set을 변경하지 않고 candidate check의 CPU/memory/tasks/tmp/workspace/staging 한도와 모든 후손 종료를 실제 kernel 경계에서 집행하는 primitive가 필요하다. 현재 구현은 bwrap/systemd cgroup으로 candidate descendant timeout을 검증하지만 workspace/staging quota와 고정 worker 경계 전체를 production profile로 확정하지 않았다.

**현재 상태 (2026-09-10)**: T62-resource는 unresolved workspace/staging limit을 candidate 실행 전에 `SPIKE_UNRESOLVED`로 차단하는 것을 확인했고, T61 계열은 candidate descendant 종료를 확인했다. 이것은 S-01-CANDIDATE 전체 통과가 아니다.

**MUST** transient `systemd-run`/새 durable unit, userland polling만으로 candidate 격리를 완성했다고 표시하지 않는다. 허용 primitive와 exact argv/mount/FD/resource observation이 validation 기록에 고정되기 전 non-empty integration checks production profile을 활성화하지 않는다. checks를 자동으로 빈 배열로 바꾸는 fallback도 금지한다.

## S-02 — 기존 Principal Pi의 host/private 경계

**SPIKE [S-02]** 기존 interactive Pi session에 attach하는 정확한 API/credential 전달, 모든 model-facing tool override, trusted extension helper와 model tool의 분리 방식을 검증한다. Principal에게 full Human context를 유지하면서 model tool이 host filesystem/credentials를 읽지 못해야 한다.

**S-02 상태 (2026-09-07)**: 실험 미실행 — 기존 interactive Human Pi session에 attach하는 경로는 사용자 host의 실제 Pi 환경을 건드리지 않아야 하며(작업 지시: 격리 검증 환경 요구), attach 대상이 될 Human session이 격리 환경에 존재하지 않는다. → **OPEN, 실행 불가 환경**. phase 5(principal-relay/extension attach)에서 격리 Human session을 구축할 수 있는지 재평가한다. UID-only/무격리 fallback은 만들지 않는다 (SP-03).

**MUST [SP-02-T]** 기본 shell/read/write/edit, alias, 추가 extension tool, subtool, custom provider hook, 경로 traversal/symlink를 각각 실행한다. model에게 attach credential·session 파일 읽기를 요청해 거절을 확인한다. duplicate attach와 UI 종료/재연결을 반복하고 commons 100개와 principal 질문 1개를 보낸다.

**MUST [SP-02-A]** Human history는 기존 session에 유지되고 commons 자동 주입은 0건, principal 질문은 동일 session에만 전달되어야 한다. UI 부재 동안 Astra 호출은 0건이다. tool 하나라도 host로 우회하면 profile 출시를 막는다. 별도 SOTA worker 생성으로 우회하지 않는다.

## S-03 — Pi 실시간 알림과 durable batch 경계

**SPIKE [S-03]** architecture §§7.1/18.2는 성공 agent_end에서 batch 완료를 기록하고 prepared snapshot을 확장하지 않는다. 동시에 §7은 busy Pi의 현재 tool group 다음 LLM 호출 전에 새 direct mail을 steer하도록 요구한다. 이 둘을 만족하는 pinned Pi의 custom message 귀속·batch prepare 시점·동시 prepared 수는 아직 확정되지 않았다.

**S-03 실험 기록 (2026-09-07, 격리 /tmp/oma-spike-s03에서 실행)** — pi 0.85.1 (설치본, reference commit e687434a60174db1a9c961d973881a7a851a0597과 version 일치). `PI_CODING_AGENT_DIR=<tmp>/agent`로 격리 (사용자 확장 미로드), `pi --mode rpc -e <oma-ext.ts> --no-session`.

1. **extension command 실행**: RPC prompt `{"type":"prompt","message":"/oma-deliver b-123"}` → 등록한 `oma-deliver` handler 실행, `ctx.ui.notify('oma-deliver executed for b-123')` 수신.
2. **custom message + triggerTurn + deliverAs=steer**: handler의 `pi.sendMessage({customType:'oma-mail', content, display:true, details:{batchId}}, {triggerTurn:true, deliverAs:'steer'})` → `turn_start` 후 `message_start{role:'custom',customType:'oma-mail',...}`로 스트림 전달. → **peer content가 Human role로 위장되지 않음**(role='custom' 확증).
3. provider 미설정 격리 프로파일에서 assistant turn은 `Unknown provider: unknown`, `stopReason:'error'`로 종료 — 모델 없는 프로브의 기대 동작이며 S-04(provider codec)가 별도 gate임을 재확인.
4. RPC 계약(rpc.md) 확인: `steer` = 실행 중 assistant turn의 tool call들을 마친 뒤 다음 LLM 호출 전에 전달; `followUp` = agent 종료 후 전달; `set_steering_mode`(all/one-at-a-time) 존재. S-03의 steer/followUp 경로가 pinned Pi에 존재함을 실증.

**결정**: 확장 command + custom message + deliverAs 경로는 pi 0.85.1에서 동작. 준비된 batch를 읽어 steer/followUp으로 안내하는 `pi-extension.ts` adapter 계약의 기반 확보.

**아직 OPEN**: 두 tool 실행 중 steer의 tool-result 보존, batch prepare/completed 귀속 경계, 동시 prepared batch 수, session-boundary 증거(session flush/fsync), 모델의 session JSON 변조 대응 — 이는 runner+Pi adapter 구현(phase 5)과 실provider(S-04)에서 재검증.

**현재 runtime gate (2026-09-10)**: sandboxed Pi custom-message 전달과 provider 오류 시 presented 미확정은 test suite에서 확인했다. 그러나 adapter revision/receipt semantics가 production validation에 pin되지 않았으므로 `batch.complete`가 성공적으로 presented를 commit했다고 해석하지 않는다. 이 gate가 닫히기 전 smoke test는 delivery plumbing 검증일 뿐 batch completion 증명이 아니다.

**MUST [SP-03-T]** tool 두 개가 실행 중인 Pi에 direct 질문을 넣고, 두 tool 결과가 모두 보존된 다음 inference에 custom notice가 포함되는지 확인한다. 별도 public followUp도 넣는다. 첫 batch가 끝나기 전에 두 번째 질문, context update, stop/abort, UI reconnect를 주입한다. batch prepare 전/후, cur 이동 후, custom notice 전/후, tool effect 후, agent_end 직전/직후, session 저장 전/후, DB complete 전/후에 kill한다.

**MUST [SP-03-A]** 각 notice의 immutable message ID snapshot과 정상 boundary 귀속을 증명하고, 미확정은 동일 ID로 재안내한다. tool result 유실·자동 tool replay·미완료 mail 영구 누락은 0건이어야 한다. 모델이 writable session JSON을 바꿔 trusted completion을 위조하지 못해야 한다. 오래된 incarnation의 complete는 거절해야 한다.

**MUST [SP-03-D]** 통과 결과로 PiAdapter의 실제 import/signature, prepared batch 동시성, 클래스 분리, completion receipt 필드/flush 순서, FIFO와 fairness의 적용 시점을 확정한다. 여섯 entity와 prepared/completed 의미 안에서 증명이 안 되면 상위 architecture 검토로 올린다. 임의로 `active/queued/thinking/reviewing` state, notice event log, cognitive checkpoint를 추가하지 않는다. 모든 busy mail을 agent_end까지 미루는 타협도 조용히 확정하지 않는다.

## S-04 — Pi provider codec / usage upper bound

**SPIKE [S-04]** pinned Pi의 model/provider registration과 streaming data codec, abort/error/finish event mapping, provider input/output/cache/reasoning token 회계, request 최대비용 upper bound를 검증한다. 특정 model 이름만으로 가격이나 context limit을 추정하지 않는다.

**S-04 상태 (2026-09-07)**: 실험 미실행 — 격리 프로파일에 provider credential/model profile이 없어 실제 stream codec/usage 상한을 시험할 수 없다 (`Unknown provider: unknown`로 확인). → **OPEN, credential 부재**. mock provider 기반 concurrent reservation/lineage 경계 테스트(T48-T51)는 phase 6(inference module)에서 실행 가능하며 그때 기록한다. provider relay를 임의 URL proxy로 구현하지 않는다 (SP-04-A).

**현재 runtime 상태 (2026-09-10)**: T48–T51 mock provider/usage semantics는 `npm test`에서 통과한다. 이는 실제 provider codec, 가격 upper bound, provider cancellation 과금 의미를 확정하지 않는다. 실제 provider pin과 raw stream evidence 전까지 S-04는 OPEN이다.

**MUST [SP-04-T]** 실제 허용된 cheap/Principal profile에서 stream 성공·429·5xx·중간 끊김·초기 연결 실패·취소·provider가 응답 직전 broker kill을 시험한다. mock provider로 concurrent reservation/lineage/reserve 경계를 대량 검사하고 실제 provider로 codec 호환을 확인한다. raw Human payload가 journal/mail/DB에 없는지 검색한다.

**MUST [SP-04-A]** 정확한 request/event schema와 codec revision이 확정되고 Pi tool loop가 정상 작동해야 한다. uncertain charge는 unknown reservation으로 남고 새 request 자동 replay는 없어야 한다. 최대 과금 bound를 증명할 수 없는 profile은 quota enforced production profile로 지원하지 않는다. provider relay를 임의 URL proxy로 만들지 않는다.

## S-05 — hostile bundle / canonical object import

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

**SPIKE [S-06]** SQLite FULL+WAL, eml/object/link/rename, Git object/ref, directory fsync와 지원 filesystem의 전원 장애 보장을 검증한다. systemd .path 재활성화 및 cgroup death 확인도 실서비스에서 검증한다.

**S-06 상태 (2026-09-07)**: 전원 장애(abrupt power loss)·VM fault 시험은 전용 disposable VM/fault-injection harness가 없어 **미실행, OPEN (환경 부재)** — SIGKILL/sudo 불가 환경이므로 host를 위험에 빠뜨리지 않는다 (작업 지시: VM 없으면 S-06 결과를 unresolved로 남긴다). process-kill 지점(T18-T22/T27/T30/T39/T57/T58/T63/T66)은 실제 subprocess kill로 실행 가능하며 구현 단계(phase 3 mail, phase 7 git)에서 실행해 별도 기록한다. systemd `.path` 재활성화·cgroup death는 phase 4(units)에서 실서비스로 재검증한다. SIGKILL 통과만으로 power-loss passed로 표시하지 않는다 (SP-06-A).

**MUST [SP-06-T]** test matrix의 process kill 지점을 실제 subprocess kill로 실행하고, 별도 VM/지원 fault 환경에서 write ordering·abrupt power loss·ENOSPC·read-only remount를 시험한다. accepted receipt를 외부 harness에 기록한 뒤 reboot 결과와 대조한다. stop 중 mail 도착, 마지막 idle check 뒤 mail 도착, start-limit, broker crash, principal offline backlog를 실서비스로 반복한다.

**MUST [SP-06-A]** 지원 profile의 accepted message/operation은 복구 가능하고 false-success가 없어야 한다. cur에 있는 미완료 mail이 유실되지 않고 stopped agent가 inference하지 않아야 한다. resource cap·fsync의 보장 범위와 미지원 filesystem을 명시한다. SIGKILL test만으로 power-loss passed라고 표시하지 않는다.

**현재 runtime 상태 (2026-09-10)**: process-level mail kill 지점, systemd stop/start-limit/stale cgroup, broker singleton lock, Git/context crash-equivalent reconcile이 실행됐다. VM 전원 장애, ENOSPC, read-only remount, backup/restore는 미실행이며 S-06 release gate는 OPEN이다.

## S-07 — OPTIONAL notmuch / reflink / egress

**SPIKE [S-07]** 각 optional 기능은 독립 gate다. notmuch의 database.path/mail_root와 indexer/model mount mapping, reflink의 inode/object 독립성, egress proxy allowlist와 credential 비노출을 검증한다.

**MUST [SP-07-A]** notmuch rebuild/손상/old index 후에도 archive path가 직접 열리고 routing에는 영향이 없어야 한다. reflink 불가면 독립 clone으로 fallback하며 hardlink하지 않는다. egress는 Human 설정 endpoint 외 연결을 거절한다. 기능별 결과가 없으면 각각 꺼 둔다. 새 index daemon은 기본으로 추가하지 않고 기존 reconcile이 제한된 index subprocess를 요청한다.

## S-08 — OPTIONAL formal approval policy

**SPIKE [S-08]** Human이 신뢰 주체/quorum/보호 경로/Principal 위임을 선택한 뒤 최소 append-only attestation DDL, revoke relation, tuple evaluation을 확정한다. 이 계약은 quorum 수나 'agent 2명=독립 2표'를 결정하지 않는다.

**MUST [SP-08-A]** 동일 actor 중복/자식 생성/다른 base/candidate/policy 재사용/자연어 위조/Human channel 위조를 거절해야 한다. 필요한 추가 entity는 architecture에 이미 허용된 attestation 범위만 사용한다. 결과가 없으면 기본 profile의 protected path 거절을 유지하고 approve/object/revoke를 노출하지 않는다.

## S-09 — 성능 목표와 모델 사용성 수용 기준

**SPIKE [S-09]** 동일 task 집합·예산/시간 cap·반복 수·통계 및 품질 비열등성 margin은 실험 전에 고정한다. Principal tokens 감소와 Astra 단독 수준 이상 품질이라는 목표의 실제 달성 여부는 아직 미검증이다.

**MUST [SP-09-T]** strong 단독/cheap 단독/hybrid에 같은 repository snapshot과 tools를 제공하고 반복한다. quality/defect/omission, Principal 및 전체 tokens/cost, latency, commons의 Principal 유입 건수, 경로/ID lookup 실패, 첫 유용한 행동까지 tool 수, Principal 재검증 비용을 기록한다.

**MUST [SP-09-A]** 값은 task별·반복별로 남기고 목표 미달도 공개한다. production runtime correctness gate와 '성능 목표 달성' 주장을 구분한다. S-09 gate는 평가 protocol과 결과 제출을 필수로 요구하며, 미달 결과를 성공으로 바꿀 권한은 없다. 성능 목표를 release acceptance로 삼을 정확한 threshold는 사용자 합의 전까지 미정이다.
