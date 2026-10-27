# macOS native 전환 명세 — TypeScript 공통 실행부와 최소 OS 경계

상태: **DR49로 구현 채택, 진행 중**. 작성일: 2026-10-25. 초기 조사 HEAD는 `d571645941e621eec6ccd91504cfbdc72389200d`다. 사용자 구현 지시가 이전 문서 정리 범위를 대체했다. VM 구현은 제거하며 fallback으로 남기지 않는다. 채택은 G-PROCESS·G-FILES·G-AUTH 통과나 native 지원 완료를 뜻하지 않는다. 실제 구현·시험 결과는 [전환 기록](implementation/native-transition.md)과 [validation](implementation/validation.md)을 따른다.

요청의 목표는 macOS용 Linux VM을 폐기하고, Linux와 macOS가 같은 TypeScript 제품 실행부를 사용하는 것이다. 개발자는 Mac을 직접 사용할 수 없으므로 macOS 실행 증거는 GitHub Actions에서 얻는다. 구현 순서는 **Linux에서 공통화 → 같은 시험을 macOS CI에서 실행 → 필요한 OS 집행부만 연결**이다.

추천하는 경계는 다음과 같다. **정책·수명 조정·인증 판정·복구·저장 검증은 TypeScript로 통일하고, 커널의 격리·안전한 파일 연산·잠금은 작은 OS primitive로 남긴다.** macOS에 두 번째 broker·supervisor·storage engine을 만들지 않는다. 다만 현재 계약을 유지하면서 네이티브 의존성을 문자 그대로 샌드박스 하나로 줄인다고 약속할 수는 없다. Node에 없는 directory-relative 파일 연산과 kernel lock, 임의 후손의 종료 증명은 별도 문제다.

**2026-10-28 구현 계약 정정.** 기존 OS 실행 관리자인 launchd의 per-execution user job과 audit session은 제품의 두 번째 supervisor가 아니라 Darwin process containment primitive로 사용한다. Mach message별 kernel audit token과 그 session identity는 manual CLI의 실제 sender/current-run 관측에 사용한다. 반대로 Unix socket의 original-connector credential은 per-message origin 증거로 승격하지 않는다. 파일의 exact pin/reopen은 검증된 descriptor 계약으로 제공하지만, public API로 permission-independent pin이나 exact repair를 만들 수 없는 entry(특히 mode-000)는 투명 복구 대상이 아니라 `unknown`으로 거절한다. pathname chmod나 다른 inode의 부분 효과를 대신 사용하지 않으며, 관측 실패를 absent/dead/success로 바꾸지 않는다.

## 1. 조사 범위와 현재 구조

프로덕션 범위는 [production-manifest.json](../production-manifest.json)과 [production-files.txt](../production-files.txt)로 확인한다. 25개 workspace의 작성 코드·package manifest를 파일별로 읽어 의존성과 호출 표면을 전수 추출하고, OS·파일·권한·수명과 연결되는 구현을 상세 검토했다. vendor payload는 전체 목록·bytes와 OMA의 적재·무결성·실행 접점을 확인하는 범위다. 모든 vendored dependency의 모든 구현 행에 대한 수동 보안 감사나 플랫폼 실행 검증을 했다는 뜻은 아니다.

필수 기준은 [PRIORITY-0](PRIORITY-0.md), [PRODUCT](PRODUCT.md), [MAINTENANCE](MAINTENANCE.md), [HANDOFF](HANDOFF.md), [책임 경계](application-boundaries.md), [운영 안내](operations.md), [구현 계약](implementation-spec.md), [기존 macOS 계약](macos-platform.md), [검증 계약](verification-spec.md), [현재 검증](implementation/validation.md)이다. 고정 [architecture](architecture.md), [결정 기록](design-revisions.md), [consistency decisions](implementation/consistency-decisions.md), [integration policy](implementation/integration-policy.md)는 현재 동작과 규범 변경점을 대조하는 기준으로 사용한다.

현재 동작의 중심은 다음과 같다.

- `oma`가 Society 소유권을 얻고 broker와 Principal 엔진을 실행한다. broker는 SQLite의 단일 writer이며 mail·lifecycle·Git·review·reconcile의 물리 효과를 조립한다.
- Worker는 persistent private clone을 갖고, trusted runner가 batch별 Pi를 sandbox 안에서 실행한다. actor/incarnation과 과거 batch receipt는 별개다.
- Principal은 Human 대화·읽기·판단 경로다. Personal은 별도 세션 모드다. 이번 전환으로 Principal Bash나 쓰기 권한을 추가하지 않는다.
- macOS Society 진입점은 현재 `oma-mac.ts → Host API → omahostd → Swift VZ helper → Linux guest`다. Personal도 bundle의 Keychain helper에 연결된다. 설치 가능한 앱·guest image와 현재 source에 결박된 native Mac 실행 증거는 없다.
- DR48은 단순 압축이 아니다. 종료된 workspace를 Restic에 보관하고 검증한 뒤 원본을 회수한다. SQLite·receipt·대화는 원래 owner에 남으며, cold 선택과 실제 복원 성공은 구분한다.

### 1.1 Linux 의존성의 실제 범위

| 영역 | 확인한 소스 | 현재 의존성과 전환 방향 |
|---|---|---|
| Worker sandbox | `platform-linux/src/sandbox.ts`, `sandbox-seccomp.ts`, `resident-rootfs.ts` | bwrap·namespace·seccomp·고정 mount 경로. Linux 집행부에 남기고 공통 정책 입력을 받는다 |
| 실행·깨우기·로그 | `platform-linux/src/units.ts`, `systemd/*`, `broker/src/logs.ts` | systemctl·path unit·InvocationID·cgroup·journald. 조정·wake·backoff·로그 조회는 공통 TS로 옮긴다 |
| 연결 인증·run 수명 | `broker/src/peer-authenticator.ts`, `run-registry.ts`, `principal-endpoint.ts`, `process-ancestry.ts` | SO_PEERCRED·SO_PEERPIDFD·pidfd·`/proc/<pid>/{stat,cgroup}`·cgroup pin. 인증 판정과 관측 primitive를 분리한다. Darwin process probe는 현재 blind다 |
| Society 소유권 | `apps/oma/src/runtime/society-lease.ts`, `host-tenure.ts`, `native/src/process-lock.ts` | abstract Unix socket과 상속 FD, 별도 broker flock. pathname socket으로 단순 치환할 수 없다 |
| 파일·게시·회수 | `native/src/files.ts`, `storage/src/{directory,durable-fs,immutable-file,staged-tree,tree-lease}.ts` | openat2·O_PATH·proc-fd·linkat·flock가 상위 저장 로직 전체로 전파됐다. 정책은 TS, directory capability 연산은 최소 native로 모은다 |
| 설정·package | `config/src/generations.ts`, `apps/oma/src/runtime/packages/store.ts`, `application/local-packages.ts`, `platform/package-staging.ts` | proc-fd 열거·reader lock·Linux/Mac staging 중복. 공통 owned-files API로 통합한다 |
| 도구의 파일 접근 | `tool-runtime/src/contained-files.ts`, `contained-search.ts`, tool-lsp/hashline/MCP 연결 | `contained-files.ts`에도 `/proc/self/fd`와 no-follow descriptor walk 의존이 있다. sandbox만 바꿔서는 Personal·Principal 파일 도구도 이식되지 않는다 |
| Git snapshot·context | `git/src/{linux-project-preparation,context-repository,project-snapshot,workspace}.ts`, App `cli/effects/context.ts` | proc-fd cwd·파일 인계·tree lease. `snapshot-reader.ts`에는 이미 Darwin openat 구현 일부가 있지만 Society storage 전체의 대체품은 아니다 |
| hostile Git bundle | `git/src/quarantine.ts` | unshare·mount/remount·tmpfs·`/proc/self/fd/3`·`dd iflag=fullblock`. 검증 절차를 TS로 옮기고 sandbox를 별도 연결한다 |
| candidate check | `apps/oma/src/runtime/candidate-checks.ts` | systemd-run·ExitType=cgroup·KillMode·bwrap·shell checkout. Worker와 같은 실행 경계를 사용한다 |
| 일반 child·terminal | `process/src/{async,preparation,fence}.ts`, `native/src/pty.ts` | processGroup의 Linux guard, `/usr/bin/setsid`, Linux PTY ioctl, socket 모양에 묶인 fence. foreground native 경로에서는 기존 터미널을 사용한다 |
| 세션 보관 | App `runtime/{restic,restic-verification,session-storage}.ts`, `storage/src/cache-trees.ts`, `scripts/install-restic.mjs` | Linux-only 설치 pin, proc-fd 실행·password·파일목록, GNU tar 비교, Linux xattr 조회. Restic 자체는 macOS binary를 제공한다 |
| 설치·검증 | `domain/src/deployment.ts`, App `runtime/{assets,deployment-manifest}.ts`, `scripts/{build,verify-lane,verification-lanes}.mjs`, `.github/workflows/architecture-verification.yml` | systemd 자산이 필수 설치 계약에 포함되고 현재 CI는 Ubuntu뿐이다. Darwin import·설치·실행까지 검사해야 한다 |
| VM 전용 | App `platform/{host,guest}/*`, `platform-mac/src/{vz-driver,image,record,vmhelper}*`, Linux `guest/*` | VZ·vsock·image·guest provision·sync·VM snapshot·control. native 경로에서 제거한다 |

사용자 표의 여섯 항목은 모두 실제 이식 대상이다. 다만 `flock`은 Linux 전용이 아니고, Restic도 Linux 전용 프로그램이 아니다. **현재 OMA의 adapter와 실행 방법**이 Linux 전용이다. 반대로 TypeScript 파일이라는 사실만으로 OS 독립이라고 판단하지 않는다.

## 2. 채택을 제안하는 결정

| 주제 | 추천안 |
|---|---|
| 제품 실행 | Linux·Mac 모두 foreground `oma`에서 같은 Society/Personal application을 시작한다 |
| 공통 언어 | 기존 TypeScript·Node·Pi 유지. 업무 로직을 Swift/Rust/Go로 옮기지 않는다 |
| supervisor | broker 안의 TS 실행 조정 모듈. 별도 daemon·DB·durable task queue를 만들지 않는다 |
| OS 경계 | sandbox 실행/관측, POSIX 파일·잠금, 필요한 peer/process 관측만 좁은 adapter에 둔다 |
| macOS sandbox | Seatbelt adapter를 우선 검증한다. `sandbox-exec`/SBPL의 비공식·deprecated 성격을 전제하고 OS별 CI로 지원 범위를 결정한다 |
| systemd | 우선 기존 Linux adapter로 공통 계약을 검증한 뒤, path unit·journald·restart 정책을 TS로 대체한다. 최종 기본 실행은 user manager를 요구하지 않는다 |
| credential | 기존 Pi credential 해석과 relay 유지. Keychain은 VM helper에서 분리한 작은 선택 adapter로 보존하며, 기존 Keychain 설정 실패를 평문 저장으로 바꾸지 않는다 |
| terminal | foreground CLI는 Node TTY와 상속 stdio 사용. VM terminal transport·guest PTY·takeover는 제거 대상이다 |
| 배포 첫 목표 | Apple Silicon·macOS 26의 GitHub-hosted runner에서 native CLI를 검증한다. macOS 15는 호환성 probe, Intel은 후속 범위다 |

Seatbelt는 실제로 TS 기반 공개 sandbox runtime에서도 사용된다. 이는 구현 선례이지 OMA의 격리·종료 보장을 대신하는 증거는 아니다. Apple은 custom SBPL을 지원하는 공개 API로 보장하지 않는다. 이 선택의 변경 영향은 `platform-mac`에 한정해야 한다. [Apple 설명](https://developer.apple.com/forums/thread/661939), [Anthropic 구현](https://github.com/anthropics/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts).

## 3. 목표 구조와 owner

```text
oma (공통 TS 진입점, terminal owner, Society tenure)
  ├─ Principal / Personal: 동봉 Pi + 기존 OMA extension
  └─ broker (기존 단일 writer)
       ├─ mail / Git / review / lifecycle / reconcile
       └─ 공통 TS 실행 조정
            ├─ trusted runner → Worker Pi
            ├─ candidate check
            └─ Git quarantine
                 └─ OS containment adapter
                      ├─ Linux: bwrap + namespace + seccomp
                      └─ Darwin: Seatbelt + 검증된 수명 관측

storage / config / tool-runtime
  └─ 공통 TS owned-files·publication 정책
       └─ 작은 POSIX/native primitive
```

### 3.1 package 변경

| owner | 맡길 변경 |
|---|---|
| `@oma/contracts` | OS 이름 없는 process scope·실행 계획·관측 계약. DB DTO와 live handle을 섞지 않는다 |
| `@oma/domain` | 기존 authority·incarnation·policy 유지. 고정 Linux 경로와 실제 engine 경로의 매핑을 데이터로 받는다 |
| `@oma/process` | spawn·cancel·close·wake·backoff·runner 수명·로그 정책의 공통 구현. sandbox grammar와 seccomp FD 처리는 Linux adapter로 이동 |
| `@oma/native` | `posix-files`, `locks`, 필요시 `peer/process`의 primitive. `identity.ts`의 UUID와 cleanup은 OS 비의존이며 native라는 이름 때문에 재구현하지 않는다 |
| `@oma/storage`, `@oma/config` | 같은 publication/transaction/recovery 코드를 양 OS에서 사용. proc-fd 경로를 만들지 않는다 |
| `@oma/engine` | Pi argv·path view·extension 검증은 공통. bwrap 이름을 확인하거나 seccomp bytes를 직접 요구하지 않는다 |
| `@oma/platform-linux` | Linux sandbox와 그 수명·파일 관측 세부사항. systemd adapter는 이행 중에만 유지 |
| `@oma/platform-mac` | Seatbelt 계획/실행과 Darwin primitive 연결. VM lifecycle·project sync를 새 native supervisor로 이름만 바꿔 남기지 않는다 |
| `@oma/app` | 플랫폼 adapter를 한 번 선택해 주입. domain·mail·review에 `process.platform` 분기를 퍼뜨리지 않는다 |

현재 25개 workspace는 고정 개수가 아니다. 기존 책임은 해당 owner에서 수정하고, 새 독립
책임은 목적이 좁은 workspace로 분리해 25 + α개로 확장할 수 있다. runtime/type 의존 DAG와
공개 exports·독립 build/test/설치를 유지한다. 여러 책임을 담는 `platform-common` 만능
package나 private 구현 역참조로 경계를 우회하지 않는다.

### 3.2 최소 실행 계약

다음은 방향을 설명하는 내부 타입 초안이다. wire·DB schema 선언이 아니다.

```ts
type Population = "populated" | "empty" | "unknown";
type RunIdentity = Readonly<{
  actor: string;
  incarnation: number;
  invocationId: string; // broker가 발급하는 일회성 실행 식별자
}>;

interface OwnedScope {
  readonly identity: RunIdentity;
  readonly directChildClosed: Promise<void>;
  revoke(): void;                       // 현재 권한 철회
  stop(): Promise<Population>;           // 종료 요청 + 실제 범위 관측
  population(): Promise<Population>;     // 임의 후손을 포함하는 별도 증거
  close(): void;                         // unknown 증거를 성공으로 바꾸지 않음
}
```

`RunRegistry`의 opening/live/revoked-awaiting-death/closed 구분은 유지한다. systemd InvocationID 대신 내부 invocation identity를 쓰되, 호출자가 보낸 UUID를 실행 권한으로 믿지 않는다. `cgroupIdentity`는 generic contract에서 제거하고 Linux proof 안에 둔다. `removed`를 공통 `empty`로 변환할 수 있는지는 해당 OS adapter만 판단한다.

## 4. 공통 TypeScript 실행 관리

### 4.1 시작·깨우기·재시작

기존 `UnitsModule`에서 다음을 분리한다.

1. desired·Society open·GOAL·현재 incarnation 확인은 기존 lifecycle/domain이 소유한다.
2. spawn·runner readiness·backoff·중복 activation 방지는 `@oma/process`의 메모리 객체가 소유한다.
3. 임의 코드가 실행되는 실제 범위의 격리·종료 관측은 OS adapter가 소유한다.

메일 수락·materialization 후 broker가 같은 프로세스 안에서 깨우기 hint를 보낸다. 시작·재시작·sweep에서는 원래 ledger와 Maildir를 다시 읽는다. `fs.watch`를 추가하더라도 hint로만 사용하며 유실·중복·합쳐진 이벤트가 배달의 정본이 되지 않는다. 활성 runner당 wake 하나만 합치고 별도 durable queue나 무제한 waiter 배열을 만들지 않는다.

기존 60초/5회 start breaker와 backoff의 의미를 TS clock으로 옮기며 monotonic 시간을 사용한다. runtime timer는 영속 상태가 아니다. broker 재시작을 넘는 과거 systemd start-limit 누적 보장과 완전히 같다고 주장하지 않는다. 먼저 모든 이전 실행을 정지·관측하고, 그 후 새 broker tenure에서 새 window를 시작한다. 이 변경은 UNIT 계약에 명시한다.

실행 시작·긴 준비 후·새 효과 직전에 현재 authority를 확인한다. stop은 `desired` intent commit → wake 차단 → endpoint/provider revoke → scope stop → 전체 범위 종료 관측 → receipt 순서다. 순서의 공통 owner는 기존 lifecycle/reconcile이며 새 scheduler가 아니다.

### 4.2 종료는 TypeScript API만으로 해결되지 않는다

`ChildProcess.close`, RPC EOF, heartbeat 소실, `kill(-pgid)`, `ps` 빈 목록은 서로 다른 관측이다. `setsid`, double fork, FD 닫기, stdio 분리로 빠진 후손을 모두 종료했다는 증거가 되지 않는다. Node도 child kill이 그 자식들을 자동 종료한다고 보장하지 않는다. [Node 26 child_process](https://nodejs.org/download/release/v26.0.0/docs/api/child_process.html).

Linux에서는 기존 cgroup adapter를 reference로 유지한 채 bwrap PID namespace의 init 종료와 전체 범위 종료 관측을 검증한다. PID namespace init이 종료되면 kernel이 namespace의 프로세스에 SIGKILL을 보내는 성질은 사용할 수 있지만, bwrap client의 exit 하나가 모든 후손의 실제 소멸 관측과 같다고 가정하지 않는다. 증거·reaping·아직 종료 중인 process를 포함해 검증한 뒤 cgroup 의무를 제거한다. [bubblewrap 소스](https://github.com/containers/bubblewrap/blob/main/bubblewrap.c), [Linux PID namespace 계약](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).

Darwin은 기존 OS 실행 관리자인 launchd에 execution별 user job을 등록하고 `SessionCreate`로 새 audit session을 요구한다. kqueue `NOTE_EXIT`는 leader 관측에만 사용하고 `NOTE_TRACK`은 사용하지 않는다. 후손은 fork·setsid·FD close와 무관하게 session membership을 상속하며, adapter는 public `libproc`으로 실제 member와 audit token을 다시 관측하고 token-addressed termination을 수행한다. launchd job 종료나 한 번의 빈 process 목록은 complete death로 취급하지 않는다. session 재사용·관측 누락·owner death/restart는 durable witness와 반례 시험으로 검증한다. [Apple XNU kqueue 구현](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_event.c).

**G-PROCESS의 산출물은 작동한다고 가정한 helper가 아니라, 특정 Darwin OS/실행 profile에서 성립하는 종료 보장의 설계와 반례 시험이다.** 작은 helper만 추가하면 해결된다고 전제하지 않는다. public API만으로 필요한 임의 후손 보장을 만들지 못하면 macOS Society의 완전 지원은 차단된 상태로 남는다. 이때 가능한 작업은 공통 TS 이식과 Personal 검증까지이며, 불완전한 stop을 성공으로 만드는 기능 축소를 자동 채택하지 않는다. root daemon·EndpointSecurity entitlement·private coalition 제어·VM 복귀를 숨은 의존성으로 추가하지 않는다.

unknown scope가 남으면 해당 workspace 재사용, 새 incarnation 실행, batch 재전달/정산, archive/reclaim을 막는다. 프로세스가 죽은 경우에도 적용되는 ownership 수단이 없으면 단순한 메모리 flag로 이 fence를 구현했다고 보지 않는다. 다음 broker도 이전 실행을 다시 관측하기 전에는 READY가 되지 않는다.

### 4.3 로그

trusted runner의 stdout/stderr를 공통 TS owner가 drain하고 actor·incarnation·invocation·시각을 붙여 기존 운영 로그 표면으로 제공한다. 모델 transcript나 provider secret을 함께 저장하지 않는다. 전체 출력·진단 preview·truncated를 구분하며 기존 spool/backpressure 계약을 사용한다. journalctl은 Linux 기본 실행 의존에서 제거한다. 재생성 가능한 로그 파일을 추가한다면 위치·형식·retention·새 durable allowlist 변경을 먼저 규범에 적는다. 로그가 없다는 사실은 실행하지 않았다는 증거가 아니다.

## 5. 인증을 공통화하는 범위

### 5.1 spawn 시 넘긴 채널을 기본 권한 경로로 사용

host↔broker, broker↔trusted runner, host↔Principal의 내부 제어는 spawn 시 연결한 전용 IPC/socket을 사용한다. 부모가 가진 실제 `ChildProcess`와 소유 채널에서 actor·incarnation·broker generation을 결박한다. env의 `actor`, PID, socket path, caller UUID는 신원 근거가 아니다. Node IPC와 handle 전달은 양 OS에서 사용할 수 있다. [Node IPC 계약](https://nodejs.org/download/release/v26.0.0/docs/api/child_process.html#subprocesssendmessage-sendhandle-options-callback).

기존 `Client`·`RuntimePort`에 stream transport를 연결하여 OMA extension의 in-process 호출은 이 채널을 재사용한다. request key·codec·stream descriptor·receipt chunk·capability 검사는 그대로다. trusted runner 제어와 model actor 요청은 별도 채널로 두어 actor 채널에서 `batch.complete` 같은 trusted method를 호출할 수 없게 한다.

재접속을 허용할 경우 broker가 만든 일회성 random credential과 정확한 generation에 결박하고, grant는 메모리와 전용 channel로만 전달한다. argv·env·설정·workspace·로그에 쓰지 않는다. channel EOF는 즉시 권한 철회의 근거지만 전체 scope 사망의 근거는 아니다. broker 교체 후에는 새 등록이 필요하며 이전 grant는 살아나지 않는다.

### 5.2 수동 CLI의 별도 경계

Worker shell에서 실행하는 기존 `oma` CLI도 지원 대상이다. 이것까지 모두 parent IPC라는 이유로 저절로 해결되지는 않는다. 기본 Node spawn은 추가 FD를 임의 후손에게 자동 전달하지 않으며 임의 프로그램은 FD를 닫을 수 있다. Pi나 shell이 특정 FD를 보존할 것이라고 추측하지 않는다.

CLI 경로는 다음 원칙으로 구현한다. OMA가 직접 실행하는 client에는 명시적 channel을 넘기고, Darwin manual CLI에는 Mach message별 kernel audit token과 그 audit session의 현재 run 일치·PID version/liveness를 요구한다. receive right는 expected Broker가 소유하고 launch data에 등록한다. inherited send right를 다른 session으로 옮긴 holder는 session 불일치로 거절하며, body PID·UID·caller UUID·endpoint name은 대체 증거가 아니다. Unix socket의 `LOCAL_PEERPID`/`LOCAL_PEERTOKEN`은 original connector를 가리키므로 per-message origin에 사용하지 않는다. ancestry·현재 grant·authority 판정은 같은 TS owner가 한다.

`getpeereid`의 UID만 확인하거나 credential만 제시한 다른 desktop process를 Principal로 허용하지 않는다. 현재 Principal의 credential+session+descent 보장을 제거하려면 별도 권한 결정이 필요하다. `process-ancestry.ts`의 Darwin blind probe를 빈 `/proc` 읽기나 `kill(pid, 0)`으로 바꾸지 않는다. 이 경로를 보존할 수 없다면 manual CLI를 몰래 제외하지 않고 지원 차단을 보고한다.

## 6. Society 소유권과 안전한 파일 접근

### 6.1 공통 잠금: expiry가 없는 kernel lock

Society tenure, broker 단일 writer, settings/package reader, staging/tree lease는 역할이 다르다. 하나의 일반 lock으로 합치지 않는다. 공통 TS owner가 lifetime을 조정하고, 실제 lock은 양 OS의 `flock` primitive를 사용한다. 현재 `native/linux.ts`도 Darwin의 EWOULDBLOCK을 이미 분기한다.

abstract socket의 기본 대체 후보는 **held state directory capability와 그 inode의 kernel lock**이다. lock 파일 하나를 pathname으로 열고 검사하는 안은 제거·재생성으로 다른 inode를 잠글 수 있으므로 채택하지 않는다. directory lock 자체의 OS 지원과 아래 전체 접근 모델을 G-FILES에서 먼저 증명한다. [Apple flock 계약](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html).

- 초기 bootstrapping에는 ownership을 얻기 위한 빈 state-root skeleton만 만들 수 있게 SEQ-003의 예외를 좁게 정의한다. DB·config·binding·workspace 생성은 그 뒤다.
- ownership identity는 held root의 실제 filesystem identity다. alias·case folding·renamed root·서로 다른 runtime root가 같은 물리 상태의 두 writer를 만들지 않아야 한다.
- 모든 owned-state 접근과 외부 writer를 held root에 결박한다. root pathname을 새로 해석하는 접근이 하나라도 남아 있으면 directory lock 설계를 완료했다고 보지 않는다.
- Git/SQLite처럼 pathname API를 쓰는 writer는 held directory를 기준으로 한 cwd/relative path 또는 검증된 native launch primitive를 사용한다. pathname 확인 뒤 실행하는 경합을 동일 inode 보장으로 표시하지 않는다.
- Society fence는 trusted host·broker·Principal의 실제 수명에 결박한다. Worker에 host state directory FD를 넘기면 containment 밖 접근이 가능하므로 넘기지 않는다. Worker scope와 fence의 수명 연결은 trusted owner가 유지하며 G-PROCESS를 통과해야 한다.
- broker writer lock과 tree reader lock도 상속·마지막 close·unknown을 검증한다. TTL·heartbeat 만료로 다른 owner의 lock을 빼앗지 않는다.

`proper-lockfile`은 기존 engine settings 용도를 유지할 수 있지만 Society fence의 대체품으로 삼지 않는다. 그 라이브러리는 mtime 기반 stale 회수와 제거 경합의 한계를 문서화한다. pathname Unix socket, PID 파일, deterministic TCP port 역시 기존 보장과 동등하다는 증거가 없는 한 대체품이 아니다. [proper-lockfile의 동작과 한계](https://github.com/moxystudio/node-proper-lockfile#compromised).

### 6.2 공통 owned-files API

`entryAt(fd, name)`처럼 proc-fd 문자열을 반환하는 API를 제거한다. storage·config·Git·tool-runtime의 caller는 `DirHandle`과 leaf/relative name을 받는다. TS가 소유할 부분은 path 문법, 허용 tree, 파일 종류, 동일 bytes 판정, 권한 비트 수리 정책, publication 순서, cleanup과 오류 분류다.

native에는 다음의 실제 syscall 동작만 둔다: directory-relative open/stat/list/readlink/mkdir/link/rename/unlink, entry pin·fchmod, descriptor duplicate/close·flock, 필요한 metadata 관측. 일반 FD read/write/hash·JSON·stream·비교는 Node API를 쓴다. libc 구조체·상수·errno 차이는 이 leaf 바깥으로 내보내지 않는다. 기존 Koffi를 우선 재사용하고 새로운 대형 native runtime은 추가하지 않는다.

`tool-runtime`의 PI-001 격리도 함께 지킨다. extension에 broker/storage 모듈을 import시켜 재사용하지 않는다. engine bootstrap이 검증한 좁은 file-operations port를 주입하거나, leaf만 허용하는 package 경계를 명시적으로 채택한다. sandbox 안에 넘기는 handle은 그 Worker의 권한 범위뿐이며 host state root capability를 노출하지 않는다. 현재 복제된 proc-fd helper를 OS별로 다시 복제하지 않는다.

Linux adapter는 openat2의 no-symlink/beneath 보장을 유지하되 procfs 사용을 내부에 감출 수 있다. Darwin은 공개 SDK의 openat·`O_NOFOLLOW_ANY` 등 실제 지원 primitive를 검증한다. Apple 최신 공개 XNU header에는 `O_RESOLVE_BENEATH`도 있지만 **소스에 상수가 있다는 사실은 목표 macOS/SDK에서 작동한다는 증거가 아니다**. 지원 여부·무시되는 flag·rename 경합을 CI로 검사하고 실패 시 거절한다. per-component openat+O_NOFOLLOW를 검증 없이 openat2와 동등하다고 쓰지 않는다. [Apple fcntl header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h), [POSIX openat 계약](https://pubs.opengroup.org/onlinepubs/9799919799/functions/open.html).

Darwin에서는 no-follow/beneath `fstatat`로 I/O 전 종류를 확인하고, accessible entry는 `O_EVTONLY` pin·descriptor `fchmod`·identity-checked reopen으로 같은 inode 수리/재열기를 제공한다. FIFO·device를 content I/O로 먼저 여는 대체는 금지한다. `O_EVTONLY`가 거절하는 mode-000 등 public API로 permission-independent pin을 만들 수 없는 entry는 투명 복구하지 않고 `unknown`으로 거절한다. metadata 조회 뒤 pathname chmod/open은 exact capability가 아니며, 기존 Mac host `files.ts`를 강한 owned-state API와 동일하다고 승격하지 않는다. `/dev/fd`는 실제 inode·cursor·exec counterexample에서만 선택한다.

publication은 temp→write-all→file flush→검증→no-replace publish 또는 derived replace→parent flush를 유지한다. 새 immutable bytes와 다른 existing bytes는 충돌이다. P0-8의 경계 내부 repair·한 entry 실패 후 나머지 cleanup·unknown 보존을 양 OS에서 같은 시험으로 확인한다.

## 7. sandbox 정책과 경로

### 7.1 공통 policy, 서로 다른 집행

공통 TS policy는 최소한 writable/read-only/denied roots, executable/toolchain roots, 허용 IPC endpoint, 환경 allowlist, scope identity를 가진다. 권한을 가진 broker가 만들며 모델·extension 설정이 격리 완화를 선택하지 못한다. Worker, candidate checker, Git quarantine는 같은 adapter를 사용하되 **목적별로 다른 최소 권한 policy**를 받는다.

Linux의 mount, PID/user/IPC 격리, seccomp는 유지한다. Darwin Seatbelt는 rootfs나 PID namespace를 만들지 않는다. 허용된 host 절대 경로를 사용하고 `HOME`, `TMPDIR`, engine/session/package path를 OMA가 만든 private directory로 지정한다. `/private/var`·`/var`, `/tmp`의 실제 경로, 공백·비ASCII·symlink alias, Homebrew Node/도구 경로를 CI fixture로 검증한다.

`(allow default)`에 몇 개의 deny만 추가한 profile을 채택하지 않는다. 원칙은 deny default이며 Node·dyld·기본 도구에 필요한 OS read/exec/IPC만 좁게 허용한다. 설정이나 dependency가 필요하다는 이유로 Human home·Keychain·전체 Mach lookup·전체 state root read를 허용하지 않는다. profile parameter escaping과 profile 전달 파일의 ownership도 검증한다. 정책이 너무 길면 inline argv 한도에 기대지 않고 owned profile input으로 넘긴다.

### 7.2 path view와 메타데이터

`/workspace`, `/inbox.md`, `/mail/*`, `/git/*`, `/opt/oma`는 Linux mount 경로다. Seatbelt는 그 위치에 파일을 나타나게 하지 못한다. `PathView`를 공통 계약으로 두고 argv/env·도구 결과·session path 검증을 한 매핑에서 만든다. 기존 `/inbox.md` 제품 입력은 논리 별칭으로 해석해 실제 batch view를 읽고, Mac의 `/` 아래에 링크를 만들지 않는다.

runner receipt는 실제 engine session path와 논리 식별 관계를 owner에서 검증한다. mount 전용 `hostSessionPath`·`confinedPath`, `PreparedBatch.indexPath`의 literal 타입, display path, role prompt, package resource path를 함께 바꾼다. Linux의 옛 가상 경로를 Mac에서 실제 경로인 것처럼 저장하지 않는다. durable schema/plan에 들어가는 path 변경은 §11의 호환성 경계로 다룬다.

APFS의 case-insensitive/case-sensitive 차이와 Unicode 이름 충돌도 별도 filesystem capability다. `A`/`a`처럼 동시에 표현할 수 없는 tree를 checkout/restore하며 덮어쓰지 않는다. 필요하면 case-sensitive APFS volume의 state root를 명시적 profile로 요구하되 자동 image mount를 추가하지 않는다. 지원 filesystem과 충돌 거절을 CI fixture로 확정한다.

### 7.3 지킬 보안 경계

Worker는 자기 workspace/home와 명시한 writable session 영역만 쓸 수 있다. canonical/context Git, 공유 mail/world, 다른 Worker state, Human project·home·설정, trusted runner receipt, broker DB, 설치 code는 쓰지 못한다. 읽기 허용도 기존 표면을 따른다. host credential·다른 actor endpoint는 읽거나 사용할 수 없어야 한다. symlink·hardlink·rename·상속된 FD·process inspection·signal·Mach/XPC 우회도 negative probe에 넣는다. hardlink의 inode 공유가 read-only root를 writable alias로 노출하는지도 확인한다.

macOS는 VM을 제거하므로 **host kernel을 Worker와 공유**한다. Seatbelt를 VM과 같은 격리라고 표현하지 않는다. 같은 UID의 임의 비sandbox process나 운영자가 마음대로 쓰는 전체 호스트를 막는 VFS 경계를 새로 주장하지 않는다. 현재 파일 namespace 방어와 Principal 사칭 방어는 별도로 보존한다.

DR37/DR46의 일반 network 공유·egress allowlist 없음·실행 quota 없음은 유지한다. 전환 편의로 domain allowlist나 resource cap을 되살리지 않는다. provider key는 기존 relay에서만 사용하며 Worker는 placeholder만 받는다. Mac의 실제 Keychain·engine auth directory·SSH agent socket·개발자 credential helper에 접근해 우회하지 못하는지는 credential 격리 시험으로 확인한다.

## 8. Git quarantine와 candidate checks

현재 shell/mount 절차를 다음 TS 단계로 분해한다.

1. broker가 frozen bundle FD·hash·export ref·candidate·prerequisite를 확정한다.
2. 독립 quarantine 안에서 object format 확인, bundle verify/list-heads/fetch, fsck와 prerequisite 확인을 한다. Git config/hooks/filter/replace object를 scrub한다.
3. candidate checker는 exact commit을 별도 checkout해 host가 고정한 argv를 실행한다. `.gitattributes`의 export-ignore/subst로 검증 대상 bytes를 빼지 않는다. gitlink 거절을 유지한다.
4. 전체 scope 종료를 관측한 뒤 검증된 object를 기존 canonical owner가 반입하고, publication/CAS·최종 authority/base/policy 확인은 원래 coordinator가 한다.

검증 중인 Git process에 canonical write 권한을 주지 않는다. 현 `quarantine.ts`의 remount-rw 이후 반입을 그대로 모사하지 말고 untrusted parse와 trusted publication을 분리한다. accepted artifact는 같은 key에 같은 bytes로 재사용하고 검증 실패를 새 key 자동 재시도로 바꾸지 않는다.

Worker만 Seatbelt로 감싸고 hostile Git parser나 candidate script를 host에서 직접 실행하는 구현은 미완료다. checks가 지원되지 않을 때 빈 목록으로 바꾸거나 nonempty checks를 통과한 것으로 기록하지 않는다. scope unknown이면 `REF_STATE_UNKNOWN`/기존 오류 정책을 따르고 CAS하지 않는다.

## 9. Restic의 공통화

Restic은 유지한다. 암호화·중복 제거·repository format을 TypeScript로 재구현하지 않는다. 설치 분기와 실행·검증 조정만 공통화한다. 현재 고정 버전은 `RESTIC_RELEASE`의 0.19.1이며 Darwin arm64의 압축본과 binary checksum을 공식 release에서 검증해 같은 owner에 추가한다. Node/Pi 업그레이드를 이 전환과 묶지 않는다. [Restic 공식 release](https://github.com/restic/restic/releases/tag/v0.19.1), [설치 문서](https://restic.readthedocs.io/en/stable/020_installation.html).

### 9.1 proc-fd와 GNU tar 제거

- 실행은 설치 시 검증한 고정 tool과 owned tool directory capability에 결박한다. hash 확인 뒤 같은 pathname을 다시 실행하는 TOCTOU가 기존 FD 실행과 같다고 주장하지 않는다. Linux fd-exec는 leaf 내부에 남길 수 있다. Darwin의 exact executable 선택/실행 보장은 G-FILES에 포함한다.
- password는 argv/env에 넣지 않는다. `--password-file /dev/stdin`에 private stdin으로 제공하는 후보를 pinned Restic으로 검증한다. 파일 목록은 broker가 소유·잠금·검증한 stage의 일반 파일로 넘기며 root capability와 writer fence를 유지한다. `/dev/fd/N`이 모든 Go 실행 경로에서 같은 descriptor 의미라는 가정은 하지 않는다.
- GNU tar `--compare --quoting-style=c`와 비교용 inline child script를 제거한다. `restic dump <snapshot> /`의 tar bytes를 TS에서 streaming 검증하고 source FD의 bytes·hash·link 관계와 비교한다. Restic은 directory dump를 tar stream으로 제공한다. [Restic dump 계약](https://restic.readthedocs.io/en/v0.19.1/050_restore.html).
- 기존 package tar decoder는 regular file/dir 전용 extractor다. 그것을 그대로 Restic verifier로 쓰지 않는다. 작은 공통 header codec만 공유할 수 있으며, 검증기는 PAX 긴 path·mtime·hardlink·symlink·정확한 size·두 zero block·truncated stream·중복/누락 entry를 별도로 검사한다. header/metadata는 bounded, file content는 streaming이다.
- Restic process exit 0, 전체 stream 소비, tar 검증 완료, JSON inventory metadata 일치, source 재관측이 모두 필요하다. 정상 tar EOF만으로 child exit를 대체하지 않는다. `--no-cache`와 repository 실제 읽기를 유지한다.

### 9.2 DR48 보존과 macOS metadata

순서는 기존과 같다: 새 수락 중단 → 모든 writer/scope 종료 관측 → Store.close → source digest → Restic backup → repository에서 읽어 검증 → immutable checkpoint 게시 → cold pointer commit → 원본 회수. restore는 Store/provision 이전에 stage로 복원·digest·ledger identity·scope quiescence를 확인한 후 게시한다. snapshot 성공·cold 선택·회수·재개 성공을 하나로 축약하지 않는다.

Linux `llistxattr`/proc-fd 조회를 metadata leaf로 옮긴다. Darwin의 xattr, ACL, BSD flags, resource fork, hardlink group과 nanosecond mtime를 관측한다. v1에서는 완전 보존이 검증되지 않은 metadata가 있으면 **보관 회수만 거절하고 hot 원본을 유지**한다. APFS 파일에 흔히 붙는 attribute도 조용히 버리지 않는다. 이것이 일부 Mac 세션의 회수율을 낮출 수 있음을 명시한다.

단순 local backup round trip은 되지만 source 불변성·후손 종료·권한/metadata 보장이 없으면 reclamation은 활성화하지 않는다. cold 세션은 필요한 tool·key·metadata·checkpoint가 확인되지 않으면 열지 않는다. 주기적 prune나 저장 quota는 추가하지 않는다.

## 10. VM 제거와 native 제품 경로

### 10.1 제거 대상과 재사용 대상

| 처리 | 대상 |
|---|---|
| 제거 | VzDriver·VM image 서명/검사·boot·vsock bridge·guest provisioning·guest power/clock/freeze·VM disk snapshot |
| 제거 | `omahostd`의 VM state machine·Host API token·terminal forwarding·guest project/package sync·guest archive protocol |
| 제거 | guest systemd/socket/sysusers/network 자산, guest entrypoints, VM 전용 Swift imports·virtualization entitlement |
| 공통화 | host/guest 양쪽의 project snapshot·package staging·stream validation 중 native 경로에서도 필요한 의미. 기존 owner 하나로 합친다 |
| 유지 | Native Pi·TUI, mail·ledger·Git·review·batch receipt·모드/history·inference relay |
| 분리 유지 | 선택 Keychain backend. `oma-vmhelper`에서 Keychain get/put만 추출하고 VM/AppKit/event loop를 요구하지 않는다 |
| 별도 명시 | 기존 VM image 백업과 DR48 Restic 세션 보관은 다른 기능이다. 하나를 다른 것의 migration으로 취급하지 않는다 |

기존 `oma`의 Darwin 분기를 공통 application 경로로 바꾼다. host-only package 설치도 공통 local store를 사용한다. VM을 조작하던 `attach/open/stop --project` 등의 문법은 의미를 조사해 명시적으로 종료 안내하며, 같은 이름으로 다른 파괴적 효과를 실행하지 않는다. Linux와 공통인 명령은 공통 parser가 소유한다.

v1은 terminal CLI 제품이다. native 창·menu bar·로그인 상주 서비스·창을 닫아도 keep-running·원격 attach/takeover·절전 방지 UI를 유지한다고 약속하지 않는다. 이는 DR18의 제품 범위 변경이므로 채택 결정에서 명시한다. 나중에 attach가 필요하면 TS terminal holder와 작은 PTY adapter로 별도 설계한다. 현재 Linux-only PTY를 native 기본 경로에 끌고 오지 않는다.

### 10.2 credential와 설치

Mac의 credential 해석은 Pi가 소유하고, 기존 `KeychainStore` port를 유지한다. Keychain profile을 선택한 배포는 서명된 작은 helper를 요구한다. signing identity·access group·잠긴 Keychain·권한 거절은 credential 부재와 구분한다. 기존 Keychain item을 삭제하거나 CLI에서 `/usr/bin/security ... -w <secret>`처럼 secret을 argv로 넘기지 않는다.

CLI 개발/CI profile은 Pi의 기존 OMA 전용 credential 저장소를 **명시적으로** 선택할 수 있다. CI는 scripted provider와 가짜 credential만 쓰며 release Keychain PASS로 승격하지 않는다. 기존 Keychain 사용자의 암묵적 파일 저장 fallback은 없다. 이 선택은 MAC-004/701 계열의 규범 변경 목록에 포함한다.

일반 설치는 Node와 같은 플랫폼의 runtime payload, 검증한 Git·bwrap(Linux)·Restic(보관 기능)을 사용한다. Mac에서 `/usr/bin/git`은 CLT shim일 수 있으므로 실제 tool resolution과 version/capability를 확인하고 고정한 executable을 사용한다. 설치 때 확인하지 못한 도구를 종료 중 다운로드하지 않는다. GUI·VM bundle 경로를 기본 asset 계약에서 제거하며 OS별 package tarball을 독립 설치한다.

## 11. durable 형식·기존 데이터와 규범 변경

이 전환은 새 협업 entity·authority·업무 queue를 도입하지 않는다. mail IDs·request key·accepted plan·terminal receipt·Git ref·batch attempt 의미는 유지한다. 공통 supervisor의 handle·timer·invocation mapping은 메모리에만 둔다.

현재 형식은 HostConfig 4, DB 4, plan envelope v3(v2 읽기 보존), managed journal committed-v2다([DR60](design-revisions.md)). Linux-only `installation.rootfs`, systemd asset pin, durable host absolute path를 실제로 바꾸면 설정/형식 version을 명시적으로 올린다. 번호는 구현 시 registry에서 한 번 할당하며 무조건 기존 필드를 optional로 풀어 과거 설정을 받아들이지 않는다. OS backend는 caller가 주장하는 권한 설정이 아니라 설치·플랫폼 composition의 선택이다.

기존 VM의 guest absolute path와 UID를 가진 state, pending operation, Pi history를 Mac 경로로 문자열 치환하지 않는다. [planPortability](../packages/protocol/src/persisted-formats.ts)가 이미 구분하는 host-intent path와 역사적 결과를 보존한다. native v1은 **별도 새 state root**에서 시작한다. 기존 VM state/disk/archive는 read-only 보존하며 자동 mount·삭제·변환하지 않는다. 기존 native Personal history도 덮어쓰지 않는다. 장기적으로 필요한 데이터 이동은 quiescent export/import로 별도 설계하고 old receipt를 다시 해석하지 않는다.

채택 시 수정할 규범의 범위는 다음과 같다. 지금은 이 문서만 제안으로 두고 기존 요구 ID·fingerprint를 수정하지 않는다.

| 현재 계약 | 필요한 결정 |
|---|---|
| A-001, M-002, UNIT/LIFE/RUN, SEQ | Linux/systemd 고정 역할을 공통 supervisor와 OS proof로 치환. 시작/종료 순서와 실제 death 조건 보존 |
| AUTH-003, PR-001, S-01/S-02 | inherited channel과 manual CLI peer 관측의 정확한 권한 모델·PID 재사용·사칭 방어 |
| FS/REC-007, SEQ-003 | root capability ownership과 bootstrap 예외, inherited fence·single writer·unknown |
| SB 및 path 관련 DTO | Linux mount 주소와 native path view 분리. Seatbelt 보장 범위·credential 접근 |
| CFG/deployment/package 계약 | Linux 자산 필수 조건 제거·필요 version 증가·OS별 payload |
| MAC/DR18·DR19·DR28 | VM·background/attach·project sync·Keychain/bundle 계약의 대체/폐기 범위 |
| DR48·REC·검증 계약 | TS stream verifier, Darwin metadata, archive/restore 종료 조건과 새로운 CI oracle |

`architecture.md` 원문과 과거 DR/MAC/MV/T 번호의 뜻은 보존한다. 채택 후 새 design revision·현재 구현 계약·traceability·source/mutation owner·durable boundary를 함께 갱신한다. 이전 VM test는 역사적 계약 검증으로 보존/이동하고 native 지원 통과 수에 합산하지 않는다.

## 12. Mac 없이 개발하는 CI 계약

### 12.1 실행 행렬

아래 job 이름은 제안이다. 새 명령이 이미 구현돼 있다는 뜻이 아니다. 현재 `verify-lane.mjs`의 Linux-only guard를 지우는 작업만으로 Mac lane을 만들지 않는다.

| job | 환경 | 필수 범위 |
|---|---|---|
| `portable` | Ubuntu 24.04, 고정 Node | 순수 정책·protocol·authority·supervisor state 전이·fake clock·실패 주입. OS adapter 없이 실행 |
| `linux-runtime` | Ubuntu 24.04, bwrap/user namespace | 실제 shared TS runtime·sandbox·filesystem·scope·CLI·scenario·Restic. user systemd 없이 실행 |
| `mac-native` | `macos-26` arm64, 같은 고정 Node | 실제 Darwin filesystem/Seatbelt/IPC/CLI/Pi scripted scenario/Restic·설치 tarball. native v1의 필수 status |
| `mac-compat-probe` | `macos-15` arm64 | SDK/flag/FFI·기본 실행 지원 가능성 관측. 통과 전까지 macOS 15 지원 주장을 하지 않음 |
| `mac-security-stress` | 같은 Mac runner, 정기·수동 | fork/setsid·동시 시작·path swap·kill/restart·reclaim 불변식의 반복 시험 |
| `mac-release` | 서명 자격을 가진 보호된 환경 | 서명된 artifact·Keychain access·배포 검증. 일반 PR job과 분리 |

GitHub는 `macos-26` arm64와 Intel 전용 label을 구분한다. `macos-latest`는 가변이므로 지원 기준으로 사용하지 않는다. runner label 자체도 image bytes 고정은 아니므로 실제 image/OS/SDK version을 증거에 기록한다. private repo의 macOS 사용 가능 시간/동시성에 맞춰 scope 영향 없는 순수 코드 수정은 portable에서 먼저 검증하되, Mac 영향 변경은 `mac-native` 성공 전에 합치지 않는다. [GitHub runner 표](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

### 12.2 공통 suite를 실제 backend에 연결

| oracle | 반드시 확인할 실패/반례 |
|---|---|
| ownership | 동시에 두 host/두 broker, broker만 crash, host SIGKILL, Principal 생존, runtime root 변경, root alias/rename/교체, forged inherited FD |
| authority | 다른 actor·old incarnation·old broker grant, same-UID 무관 process, 연결 FD 인계, runner method를 actor channel로 호출, 준비 중 stop |
| sandbox | 허용된 Node/Git/npm 정상 실행 + 금지 파일 read/write + symlink/hardlink/FD 우회 + credential/Keychain/다른 Worker 접근 |
| process scope | root child exit 후 background child 생존, double fork, setsid/setpgid, close-all-fds, parent/runner/broker kill, fork burst, 관측 누락과 PID 재사용 |
| owned-files | final/ancestor symlink swap, root rename, mode-000 directory/file, FIFO/device, hardlink, duplicate FD close, unlink/rename 경합, 비ASCII·긴 이름 |
| publication | write/file flush/publish/parent flush 각 경계의 kill·같은 key retry·restart, existing 같은 bytes/다른 bytes, ENOSPC/I/O failure |
| SQLite | WAL/SHM가 남은 cold open, 지원하지 않는 version 거절, sidecar 보존, 단일 writer, 실제 동봉 Node/SQLite/VFS의 readonly_shm 동작 |
| delivery | receipt 게시 전/후 kill, old receipt 정산과 새 run grant 분리, reconnect·same-key replay, unknown scope에서 재전달 차단 |
| Git/checks | hostile/corrupt/prerequisite 없는 bundle, SHA-1/SHA-256, hooks/filter 차단, exact candidate, checker 후손 잔존, CAS 전 policy/stop 변경 |
| Restic | 실제 pinned binary backup/dump/restore, staged/unstaged/untracked/ignored, symlink/hardlink·mtime·mode·빈/큰 파일, 경로 특수문자, pack 손상·중간 stream 종료·metadata 거절 후 원본 유지 |
| 설치·UI | OS별 tarball만 설치, VM/systemd import 없음, default Society·Personal·/new·/resume·모드 전환·raw mode 복구·package/extension 적재 |

주된 oracle은 실제 file bytes·inode·ledger·receipt·ref·scope population이다. 문자열에 `sandbox-exec`가 있다는 시험, Linux에서 `process.platform`을 주입한 시험, 성공 fake adapter만으로 gate를 닫지 않는다. mock/fake clock은 공통 TS 판단을 검증하고 실제 kernel suite는 해당 primitive를 검증한다.

각 실패는 source SHA/input digest·Node/Pi/SQLite/Koffi/Git/Restic version·OS/image/SDK·policy digest·seed·phase·exit/stdio·잔존 자원 관측을 artifact에 남긴다. native profile에 없는 sandbox/flag/후손 관측은 skip/PASS가 아니라 SETUP_FAILED 또는 BLOCKED다. job cancellation/timeout/partial rerun도 구분한다. 테스트 harness는 자기 token·자격증명과 분리된 임시 디렉터리에서 돌리고, 외부 provider secret 없이 scripted provider를 사용한다.

Mac job은 GNU `timeout`, `sha256sum`, `readlink -f`, Linux 전용 `cp` flag가 있다고 가정하지 않는다. 기존 bounded-script/process 실행 owner와 Node crypto/path를 사용해 CI 조정도 TS/JS로 공유한다. Linux용 정적 금지 규칙·설치 검사의 systemd/rootfs 필수 조건은 실제 adapter 경계에 맞게 변경하며, 단순 전체 허용 목록이나 검사 삭제로 통과시키지 않는다.

### 12.3 CI로 주장할 수 있는 지원 범위

GitHub-hosted Mac은 native Darwin 코드를 실제 실행하는 유효한 시험 환경이다. 그러나 사용자의 sleep/wake·TCC 대화상자·잠긴 login Keychain·특정 APFS 장치·실제 power loss·터미널 앱별 동작을 전부 대표하지 않는다. 따라서 v1 지원 표기는 **검증된 OS/arch/CLI profile + process-crash 범위**다. power-loss 보장은 별도 미검증으로 남긴다.

Node 26의 libuv는 Darwin fsync에서 F_FULLFSYNC를 시도하지만 fallback도 한다. `fsyncSync()` 성공을 F_FULLFSYNC 성공이나 실제 전원 장애 proof로 기록하지 않는다. directory flush도 실제 target filesystem에서 검사한다. [Node 26에 동봉된 libuv 소스](https://github.com/nodejs/node/blob/v26.0.0/deps/uv/src/unix/fs.c).

## 13. 구현 순서와 완료 조건

| 단계 | 구체 작업 | 다음 단계 조건 |
|---|---|---|
| P0: 현재 기준과 변경 계약 고정 | production/import/native 호출 목록과 Linux oracle 기록. 구현할 규범 변경은 새 DR·대상 spec·traceability로 먼저 명시 | 기존 의미와 변경할 의미, gate probe의 범위를 시험 목록으로 확인 |
| P1: 가장 어려운 primitive 검증 | CI에 작은 Darwin probe 추가. G-PROCESS·G-FILES·G-AUTH 실행 | 통과한 보장과 미해결점을 확정. 이 단계에서 불가능한 종료 보장을 먼저 드러냄 |
| P2: 파일 owner 공통화 | proc-fd를 handle API로 대체, POSIX locks·publication·tool files·settings/package 통합 | Linux 회귀 + Mac filesystem suite 통과. 경합 방어 완화 없음 |
| P3: 실행 관리 공통화 | TS supervisor·wake·backoff·로그·generic RunRegistry. 우선 Linux systemd adapter로 의미 비교 | stop/start/recovery·same-key·old receipt oracle 유지 |
| P4: 직접 OS 실행 | Linux bwrap scope로 manager 의존 제거, Darwin Seatbelt/path view/peer 연결 | 양 OS에서 실제 scope와 auth oracle 통과. G-PROCESS 미해결이면 Mac Society 지원 차단 |
| P5: 나머지 실행 경로 | candidate checks·quarantine·Restic stream verifier·설치/credential 연결 | nonempty checks, hostile bundle, archive/restore 실제 round trip 통과 |
| P6: native 진입점 완성 | 공통 oma 경로·Society/Personal·login/packages/history, VM-only runtime와 자산 제거 | clean install에서 VM·systemd 없이 두 OS scenario 통과 |
| P7: 지원 기록과 최종 대조 | 채택한 DR·규범·traceability·owner·verification map과 최종 구현 대조, OS별 artifact 고정 | source에 결박한 결과와 제한을 validation에 기록. 과거 review 자동 재결박 없음 |

### 13.1 선행 gate의 산출물

**G-PROCESS:** Mac의 임의 후손 집합을 누락 없이 묶거나, 필요한 범위에서 새 후손 생성을 fence하고 실제 종료를 관측할 수 있는 구체적 수단. 정상 종료뿐 아니라 runner/host SIGKILL·setsid·FD 폐기·재시작 후에도 성립해야 한다. 구현 수단이 없으면 gate는 OPEN이다. 지금의 조사만으로 이 gate가 해결됐다고 쓰지 않는다.

**G-FILES:** Darwin에서 held-root·directory lock·accessible entry pin·no-follow/beneath·identity-checked metadata repair/reopen·no-replace publication·외부 writer/executable 결박을 만족하는 실제 SDK/API와 반례 결과. permission-independent pin을 제공할 수 없는 mode-000 entry는 명시적 unknown으로 거절하고, pathname 대체 효과나 성공 보고를 하지 않는다. `O_RESOLVE_BENEATH` 등은 feature probe로 확인한다. 디렉터리 FD lock과 root 교체 방어를 증명하지 못하면 abstract lease 제거도 보류한다.

**G-AUTH:** inherited control channel의 nonforgeability, manual CLI/Principal의 kernel peer/process identity와 PID 재사용·socket 인계 방어. name·UID·bearer token만으로 현재보다 넓은 실행 권한을 주지 않는다는 결과. 모든 판정 정책은 공유 TS owner에 둔다.

이 세 gate는 Mac 실기기를 요구하는 수동 승인 단계가 아니다. GitHub Mac job에서 재현 가능한 probe·harness·raw artifact로 해결한다. 단, CI가 관측하지 못한 성질을 성공으로 보충하지 않는다.

### 13.2 최종 수용 조건

1. Linux와 Darwin의 broker·runner·Pi client·mail·Git·review·storage 판단 경로가 같은 TS 구현을 사용한다.
2. 기본 Society 경로는 Linux VM, VZ, vsock, user systemd, journald를 요구하지 않는다. 남은 OS API는 지정한 leaf와 installer/qualification에만 있다.
3. macOS의 새 native 업무 구현은 없다. Seatbelt와 필요한 최소 syscall/credential adapter만 있고, 파일 게시·재시작·정산·Restic verifier를 Swift로 중복 구현하지 않는다.
4. Worker뿐 아니라 candidate checker·Git quarantine·도구 subprocess도 격리와 실제 수명 계약을 통과한다.
5. 소유권 불명·후손 종료 불명·metadata 보존 불명에서 새 writer/rollover/reclaim을 시작하지 않는다.
6. Mac 개발 장비 없이 CI artifact만으로 정상 동작과 실패를 재현·판정할 수 있다. 실제 미실행인 release Keychain·TCC·power-loss는 별도로 남는다.
7. 기존 state·accepted bytes·receipt·권한을 임의 변환하거나 삭제하지 않는다. 프로덕션 전환과 데이터 migration을 혼동하지 않는다.

이번 문서 작성은 위 gate나 native 실행을 수행한 결과가 아니다. **바로 진행할 수 있는 부분은 공통 TS 분리와 CI probe이며, Mac Society 완전 지원을 가르는 핵심은 임의 후손 종료·파일 capability·CLI 인증의 실제 증거다.**


## 14. 다음 모델 인계

[사실] 이 절은 **2026-10-27 사용자 중단 요청 직후** 확인한 현재 상태다. 기존 §14.1–14.23의
누적 인계 대신 읽는다. §1–13의 설계·보장·완료 조건은 이번 인계에서 수정하지 않았다.
이전 인계 원문과 미완성 작업의 패치는 §14.3의 snapshot에 보존했다.

### 14.1 정보의 종류와 현재 작업 상태

| 표기 | 의미 |
|---|---|
| `[사실]` | 현재 파일·Git 상태·종료된 실행 결과 또는 지정한 과거 증거로 확인한 내용 |
| `[사용자 지시]` | 사용자가 정한 목표·우선순위·금지 사항. 임의로 완화하지 않는다 |
| `[사용자 제공 상황]` | 사용자가 설명한 외부 상황. 이 모델의 계정/API 직접 확인과 구분한다 |
| `[미구현]` | 필수 실행 코드·producer·caller 연결이 아직 없다. 실행 시험만 남았다는 뜻이 아니다 |
| `[미검증]` | 작성된 코드·시험이 있더라도 해당 OS/입력에서 실행하거나 확인하지 않은 내용 |
| `[추측]` | 성립이 증명되지 않은 가설·작업량 추정. 구현 완료나 지원 보장이 아니다 |
| `[제안]` | 다음 모델이 실제 상태를 확인한 뒤 선택할 후속 작업. 이미 수행한 일이 아니다 |

[사실] 장기 목표 `할수있는 모든걸 끝내놓기`는 사용자 요청으로 **paused**다.
목표 완료·기술적 blocked 판정이 아니라 명시적인 작업 중단이다. 사용자의 재개 지시 전까지
구현·검사·CI 실행·commit/push를 계속하지 않는다. 이번 후속 작업은 인계 문서 작성뿐이다.

[사실] 마지막 관측한 검사 session87309는 이미 exit0으로 종료했다. 관련 Python 검사
프로세스도 남아 있지 않다. 이 번호나 과거 checkpoint의 session 번호를 살아 있는 작업으로
간주하지 않는다. 새 모델은 실제 handle/process를 확인하며 관측 timeout만으로 재실행하지 않는다.

### 14.2 사용자 목표와 최신 CI 지시

[사용자 지시] **현재 CI를 사용할 수 없더라도 구현 자체와 테스트 구성을 최대한 완성해 둔다.**
CI 복구 후에는 실제 OS에서 검증하고 발견된 문제를 수정해 빠르게 마무리할 수 있어야 한다.
CI가 없다는 이유로 adapter 구현, 실제 caller 연결, 실패·복구 경로, helper 빌드, 설치 경로,
테스트 fixture·assertion·workflow 준비를 미루거나 TODO/항상 거절하는 껍데기로 끝내지 않는다.
“실행 검증하지 못함”과 “구현하지 않음”을 별도로 표시한다.

[사용자 지시] 구현은 최대한 우아하고 꼼꼼하게 작성한다. 경우마다 if를 덧붙이거나 상관된
boolean, 중복 policy, 임시 wrapper로 예외를 누적하지 않는다. 책임·소유권·상태 전이를 먼저
정리하고 실제 owner 하나에서 처리한다. 기존 TypeScript·Node·Pi를 최대한 재사용하며 OS
의존은 sandbox·kernel/file/credential primitive처럼 대체할 수 없는 작은 경계에 둔다.

[사용자 지시] **현재 하던 native 구현과 CI용 테스트 준비를 모두 끝낸 뒤**, 전체 코드에서
불필요한 복잡성·분기·중복·얽힌 소유권을 찾아 수정한다. 이 전체 검토는 아직 미착수이며
최종 목표에 포함된다. native 일부와 작은 시험만 통과한 상태를 전체 완료로 축소하지 않는다.

[사용자 지시] 모르는 API·동작은 혼자 추정하지 말고 인터넷의 실제 구현 사례와 공식 소스를
찾아 대조한다. 다른 제품의 약한 계약을 OMA의 보장으로 옮기지 않으며, 소스에 상수가 있다는
것과 목표 OS에서 그 보장이 성립한다는 것을 구분한다.

[사용자 제공 상황] CI는 현재 사용할 수 없다. 앞서 사용자는 Mac CI가 10배 소모되어
200분 예산을 모두 사용했다고 설명했고, 이후 현재 CI 불가 상황을 다시 명시했다.
이는 사용자 제공 상황이며 새 모델이 계정 잔량을 조회해 확정한 숫자가 아니다.

[사용자 지시] CI 복구 전 새 CI dispatch·retry·과금되는 Mac 실행을 시작하지 않는다.
이미 알려진 동일 실패 입력을 반복 실행하지 않는다. 현재 workflow의 유료 Mac 기본값 OFF를
유지한다. CI가 복구되어 사용할 수 있는 때까지 구현·테스트 작성과 가능한 로컬 검증을 진행한다.

[사용자 지시] PRIORITY-0, accepted bytes·plan·receipt·DB·권한 의미,26개 workspace의
공개 API와 runtime/type DAG·독립 build/test/install 경계를 보존한다. VM/systemd fallback,
숨은 root daemon·EndpointSecurity entitlement·private coalition 제어, 두 번째 업무 runtime을
몰래 추가하지 않는다. master 병합·배포는 하지 않는다. 재개 후 작업 브랜치 commit/push는
기존에 허용됐지만 현재 중단 요청을 자동으로 해제하는 권한은 아니다.

### 14.3 Git·작업 폴더·복구 자료

[사실] 마지막으로 commit·push 완료와 원격 ref를 확인한 구현 HEAD는
`eb63b6f245b7ac6ed7589782a20beffac6948ffa`다. 이 인계 시점의 main HEAD와 local
`origin/work/macos-native-20261025`도 이 값이다. 이후 Keychain 변경은 **미commit·미push**다.
이는 과거 확인 시점의 원격 상태이며 이후 다른 작업자의 push까지 부정하는 정보가 아니다.

| 구분 | 위치·상태 |
|---|---|
| `[사실]` 메인 작업 폴더 | `/home/dev/oma-v2`, 브랜치 `work/macos-native-20261025`. 제품 코드는 마지막 push 상태. 원래 사용자 README와 owned validation binding 변경을 보존 |
| `[사실]` 구현 중인 linked worktree | `/tmp/oma-native-resume-20261026/verification-input-clean`, detached HEAD. 이름과 달리 지금은 clean이 아님. Keychain 후속 구현은 여기에 있음 |
| `[사실]` 공통 Git 저장소 | `/home/dev/oma-v2/.git`. 위 폴더는 독립 clone이 아니라 같은 object store의 linked worktree |
| `[사실]` 이 인계 문서 | 메인과 linked worktree의 `docs/macos-native-spec.md`에 동일한 §14를 기록. `docs/HANDOFF.md`도 최신 인계로 안내 |
| `[사실]` 로컬 복구 snapshot | `/home/dev/oma-v2/.scratch/native-handoff-20261027/`. Git에서 무시되는 경로이며 다음 모델이 직접 열어볼 수 있음 |
| `[사실]` 외부 인계 보존 | `/home/dev/oma-audit-artifacts/native-2026-10-27-handoff-paused/` |
| `[사실]` 누적 checkpoint | `/tmp/oma-native-resume-20261026/review-progress.json`. 과거 키에는 당시 상태가 남아 있으므로 최신 handoff snapshot·실제 파일을 우선 |

[사실] snapshot의 `snapshot.json`은 기준 HEAD, 인계 전 dirty 파일10개·untracked1개,
각 파일 SHA와 보호 파일 SHA를 기록한다. `implementation.patch`는 인계 전 구현 변경을
보존하며 **owned validation digest binding은 제외**한다. 새 파일은
`untracked/test/keychain-helper.test.mjs`에 별도로 보존했다. `full-before-docs.patch`는
binding까지 포함한 진단용 원문이다. 이전 두 문서 원문은 `*.before.txt`다.

[제안] linked worktree가 그대로 있으면 그 작업을 이어받는다. 폴더가 없어졌을 때에만
snapshot으로 복구한다. 이미 dirty인 메인에 patch 전체를 무작정 적용하지 않는다.
기존 구현과 SHA를 비교하고 새 테스트 파일도 함께 보존한다. `reset --hard`, 광범위한
`restore/clean`, 원래 README 덮어쓰기를 복구 수단으로 사용하지 않는다.

[사실] 보호 파일의 메인 SHA256은 다음과 같다. clean worktree의 README는 원래 commit
버전이라 메인 사용자 변경본과 다르며, 이를 맞춘다고 덮어쓰면 안 된다.

| 파일 | SHA256 |
|---|---|
| `README.md` | `87284651b50b700e1b14fa0efd3ee33c1c9b925cda36294ed13302cbf73430f7` |
| `docs/architecture.md` | `8de5ea0c6c632fa7e09e8188d7035cf94aa3165fdfeb122631af3f39bee132c7` |
| `implementation/review-notes.json` | `5e930f79435bbe3b4399657f883d87ac5e52bbedbd4c08d252855bf294d7900c` |
| `test/fixtures/architecture-surfaces.json` | `bc36c5aa6adb62679866634cf1a80df99c809c4eed9b6e9dad7f50d398aa30e4` |

### 14.4 완료한 구현과 전체 목표의 현재 한계

[사실] 아래는 현재 구현 범위이며 P0–P7 전체 완료 선언이 아니다. 세 Darwin 핵심 gate는
OPEN이고 제품 진입점은 실제로 거절한다. 코드 작성·정적 SDK 결과·Linux 성공을 Mac 지원으로
승격하지 않는다. 실제 증거와 입력은 [validation](implementation/validation.md)을 따른다.

| 영역 | `[사실]` 구현·반영한 범위 | 남은 구현·검증 |
|---|---|---|
| 공통 구조·형식 |26개 workspace, 공통 TS 실행/저장/인증 판단, HostConfig4와 Linux 전용 rootfs 소유권 분리. DB4·plan v3/v2 reader·managed committed-v2 보존 | 전체 P0–P7·모든 현재 코드 수동 검토·최종 OS qualification 완료 아님 |
| 파일·metadata | directory-relative POSIX effects, 공통 publication·repair policy. Darwin xattr·ACL 존재·전체 BSD flags의 작은 C helper, 보존 못하는 metadata의 회수 거절 | `[미구현]` Darwin mode000 pin·종류 확인 전 I/O 방지·동일 inode repair/reopen·정확한 실행 선택 |
| 수명·실행 관리 | 공통 ExecutionCoordinator/journal, Resident supervisor/wake/backoff/log/drain, Linux namespace/pidfd 기반 실제 실행·복구 | `[미구현]` Darwin 임의 후손 집합·전체 사망 관측·모든 trusted owner 사망 뒤 fence·복구 producer |
| Mac 조립 | Seatbelt, physical PathView·논리 inbox, 목적별 Worker/Git/candidate recipe, developer tool 관측, Mach byte transport와 공통 auth 연결 표면 | `[미구현]` 실제 Mac scope·현재 run·expected Broker 권한 producer와 제품 backend 연결 |
| 인증 자원 | audit-origin은 이미 Koffi async 경로이며 반환된 CF 객체를 추적·반환. 메시지별 sender·live pin 소유 경계 구성 | generic Node 이미지·이름·UID·호출자 nonce만으로 Broker/Principal을 승인할 수 없음 |
| Restic | 실제 pinned tool 설치·backup/dump/restore, 공통 TS tar/inventory 검증. 설치 FD를 검증부터 실행까지 유지. hardlink 자기/앞/순환 참조의 데이터 없는 검증 통과 수정 | `[미구현]` Mac exact exec·filesystem·scope 연결. `[미검증]` Mac archive/restore·reclaim qualification |
| CLI·배포 | VM/VZ/vsock/guest/systemd의 주요 runtime·자산 제거, 공통 CLI와 Linux 실행 연결 | Mac의 help 이외 제품 경로, clean install·Society/Personal/history의 실제 Mac 검증. source만 보고 전체 legacy 잔존0을 확정하지 않음 |
| Keychain | standalone credential-only Swift 소스와 TS client·수명/채널 구현. 아래 미완성 빌드 연결 추가 중 | `[미구현]` release signing 연결. `[미검증]` Mac 컴파일·프로토콜 실행, 서명된 helper의 접근 권한·잠금·거절·release qualification |
| 전체 코드 품질 | 사용자의 요구 범위와 우선순위를 기록 | native 구현·CI 준비 뒤 수행할 전체 복잡도 검토/수정은 **NOT_STARTED** |

### 14.5 중단 직전 Keychain 작업 — 미commit 구현

[사실] 전체 잔여 작업을 대조하다가 독립적인 P5/P6 누락을 찾았다.
`personal-models.ts`는 `KeychainClient.launch(libdir)`를 호출하고 client는
`packages/platform-mac/dist/keychain/oma-keychain`을 실행하지만, 기존 빌드는 Swift 소스만
복사하고 이 바이너리를 생성하지 않았다. 이 누락을 재현한 portable 시험은 수정 전 실패했다.

[사실] 다음 변경을 linked worktree에 작성했다. 메인 제품 코드와 원격에는 아직 없다.

| 파일 | 작성한 내용 |
|---|---|
| `scripts/workspace-executables.mjs` | reviewed recipe에 Keychain Swift helper 추가. `compilerArguments`/`linkArguments`로 C·Swift의 고정 argv를 표현하고 옛 `libraries` 형태를 제거 |
| `scripts/build-workspaces.mjs` | 별도 helper별 if 없이 같은 recipe로 `/usr/bin/xcrun` 컴파일. 기존 cache·output owner가 실제 산출물을 기록 |
| `packages/platform-mac/package.json` | `oma.darwinExecutables`에 `keychain/oma-keychain` 선언 |
| `packages/platform-mac/test/installed-runtime.mjs` | 실제 Darwin 설치에서는 helper가 regular executable로 포함됐는지 확인 |
| `test/keychain-helper.test.mjs` — **untracked** | 모든 host의 recipe/client 실행 경로 일치 시험1개. 실제 Darwin에서만 등록하는 compiled helper 프로토콜 시험6개 |
| `test/workspace-boundaries.test.mjs` | Swift recipe에도 owner/output/declared source 경계를 같은 방식으로 확인 |
| `scripts/verification-lanes.mjs` | portable build oracle을 platform/full 필수 항목에 추가. Darwin 전용 helper oracle6개는 별도 export |
| `.github/workflows/native-runtime.yml` | SDK·Swift version, runtime 산출물 digest 전후 기록, TAP/no-skip 검사, 실제 Darwin helper oracle 요구, Mac packed 설치 검사 준비. Mac 기본 OFF 유지 |
| `production-loc-hashes.json`, `implementation/review-ledger.json` | 변경 source digest와 stale derived review 상태 갱신. authored review 재인증 아님 |
| `docs/implementation/validation.md` | 당시 verification input digest binding만 갱신. 최종 성공 결과를 추가하지 않음 |

[사실] 새 helper 시험은 실제 child·FD3 socket·종료를 사용하는 설계다. 정상 unknown control의
fragmented UTF-8, supervision EOF, malformed JSON, partial EOF, invalid UTF-8,
credential request의 추가 field 거절을 검사한다. 이 fixture는 **Keychain get/put을 실행하지
않으며 실제 credential 접근·코드 서명 성공을 검증하지 않는다**. Linux에서는 portable 시험만
등록된다. Darwin을 가짜로 주입해 성공한 결과는 없다.

[사실] 중단 시 로컬 OS는 Linux이고 `dist/keychain/oma-keychain`은 없다. Darwin에서만
컴파일하는 recipe이므로 Linux build 성공이 Swift binary 생성 성공을 뜻하지 않는다.
Swift 본문과 entitlement 원문은 이 변경에서 수정하지 않았다.

[미구현] 현재 recipe는 컴파일 연결이며 release signing pipeline을 완성한 것이 아니다.
`oma-keychain.entitlements`의 `$(TeamIdentifierPrefix)` 해석, signing identity/access group,
서명 검증·잠긴 Keychain·권한 거절과 실제 항목 get/put은 따로 확인해야 한다. Keychain 실패를
Pi 파일 저장소로 암묵적으로 우회하지 않는다. `personal-models.ts`의 명시 profile 연결도
현재 소스와 규범을 다시 대조해야 한다.

### 14.6 실제로 끝난 검사와 아직 하지 않은 검사

[사실] 아래 WIP 기록의 정본은
`/home/dev/oma-audit-artifacts/native-2026-10-27-keychain-build/`다. 아직 **닫지 않은 audit**이며
최종 `checks/summary.json`, `candidate-result.json`, `integrity-index.json`은 없다.

| `[사실]` 실행 | 결과·범위 |
|---|---|
| `red.log`, `red-status.json` | 누락된 helper producer를 재현. portable1개 실패·exit1 |
| `green-initial.log`, `green-initial-status.json` | helper portable1개 + workspace boundary13개, **14/14 PASS**. 실제 Mac6개는 등록되지 않았으며 NOT_RUN |
| `metadata-build/summary.json` | source-digests·dependency-graph·stale-review invalidate·binding·build·root strict **6단계 모두 exit0** |
| 같은 build | 실제 Linux `npm run build`68.779초, root `tsc --noEmit`10.417초. 실제 Swift 컴파일 증거가 아님 |
| 당시 binding | `38658a8f4c60d5be680cc624b09d30a376b09cadef6d1c4511d1a66eda812696`,15671 files, `runtimeProof:false` |

[미검증] 새 workflow의 literal common TAP 실행, actual-OS oracle 판정, 관련 policy·전체 구조
검사와 새 manifest의 packed26/26은 아직 수행하지 않았다. Mac helper6개·Mac packed 설치·서명된
Keychain·G-PROCESS/G-FILES/G-AUTH 실제 실행도 NOT_RUN이다.

[사실] `run-checks.py`, `commit-candidate.py`, `close-audit.py`는 이 Keychain audit에
아직 작성하지 않았다.

[사실] 이전 commit의 독립적인 완료 증거는 다음과 같다. 이 성공을 현재 Keychain WIP나
인계 문서 변경 뒤의 입력에 재결박하지 않는다.

| commit·audit | 그 입력에서 확인한 결과 |
|---|---|
| `5647f4b6` · `native-2026-10-27-metadata-acl-flags/` | common235, policy35, boundary/owner17, storage15, architecture·packed26, build·strict 통과. C helper/fixture SDK 정적 compile8·stub-link8. 실제 Mac NOT_RUN |
| `41de811c` · `native-2026-10-27-restic-setup-exec/` | 실제 Linux 설치 실행 경합8/8, common235, policy35, boundary17, storage15, 구조·build·strict 통과. 동일 oracle이 격리한 수정 전 installer를 거절 |
| `eb63b6f2` · `native-2026-10-27-restic-hardlink-proof/` | parser7/7, 이를 포함한 common238/238, policy35, boundary17, storage15, architecture·packed26, build·strict 통과. 동일 oracle이 수정 전 compiled verifier를 거절 |
| Config4의 과거 전체 Linux | `f68dcf7688b61455d90f61b3b0f4b4cf96f3f353531c84288206776dd72fd2d1`에서3896/3896 PASS. 이후 구현/WIP의 전체 suite 성공을 뜻하지 않음 |

[사실] 마지막 published Restic hardlink runtime 입력은
`100f081eb9fbe7b1012572725a0370fc4eabf019adf031acbcf633ccc0d8403e`(15670개),
별도 문서 입력은 `47199a44b0cfe469d5b9df4b7043a3bc6b96d9db3d8e0b712f432f22f64216a3`다.
그때26개 workspace 산출물15405개의 digest는
`1e1e888b6d416f94346e8106567ad9bfd82c5564cdf0cca7f668649b9512a6dc`였다.
packed 검사에 보고된 외부 SDK declaration 진단은 authored declaration 성공과 별개다.

[사실] **이번 인계 문서 편집 후에는 verification input이 다시 달라진다.** binding을 자동으로
새 성공에 맞춘다고 과거 runtime 결과가 현재 성공이 되지 않는다. 이번에는 문서 편집 확인만
하며 새 구현 시험·구조 검사·commit/push를 실행하지 않는다.

### 14.7 남은 핵심과 지금까지 배제한 후보

[사실] 현재 제품 guard는 `apps/oma/src/runtime/native-support.ts`에 있고 Darwin 제품 실행을
효과 전에 거절한다. `execution-runtime.ts`의 backend와 storage journal의 완전한 kernel witness는
Linux namespace 기반이다. `native/files.ts`의 Darwin O_PATH pin과 `descriptor-path.ts`의
Darwin exact execute도 미구현으로 거절한다. 이들은 단순히 CI 결과만 기다리는 완성 구현이 아니다.

| 핵심 | `[사실]` 필요한 보장·아직 없는 구현 |
|---|---|
| G-PROCESS | fork/setsid/FD close를 포함한 임의 후손 집합, 종료·실제 empty 관측, 모든 host/runner/broker 사망 후 ownership fence·새 broker 복구 |
| G-FILES | mode000의 permission-independent pin, 종류 확인 전 FIFO/device I/O 방지, 동일 inode 권한 수리·정확한 재열기, 외부 writer/cwd/executable 결박 |
| G-AUTH | 현재 run/scope와 expected Broker의 신뢰 가능한 kernel 근거 producer. generic Node 서명·이름·UID·저장 PID·호출자 UUID는 이를 대신하지 않음 |

[사실] 조사한 후보와 한계를 다음처럼 인계한다. 닫힌 audit에는 더 쓰지 않는다.

- `[사실]` `native-2026-10-27-audit-session-scope/`, `native-2026-10-27-launchd-cohort-feasibility/`:
  SessionCreate의 권한 경로, session join 중 이전 session END 가능성, 이벤트 유실,
  ASID 재사용·세대 증거·all-owner-death 복구를 대조했다. launchd job exit나 ASID 하나를
  임의 후손 empty로 사용할 수 있는 설계는 확보하지 못했다.
- `[사실]` `native-2026-10-27-cohort-generation-lock-owner/`:
  session flags에 임의 세대 nonce를 넣을 수 없으며 ordinary OFD lock의 owner는-1이다.
  kernel이 명확한 owner를 기록하는 confined 기능은 검토한 public SDK에 없는
  `F_SETCONFINED`/`FD_CLOFORK`에 의존한다. POSIX record lock은 현재 inherited flock과
  의미가 다르고 expected Broker producer를 저절로 만들어 주지 않는다.
- `[사실]` `native-2026-10-27-file-binding-feasibility/`:
  과거 실제 Mac26/15·Node26·UID501의 O_EVTONLY mode000 open은 EACCES였다.
  `SYS_openbyid_np` 번호는 public header에 있지만 kernel은 platform binary 또는
  `com.apple.private.vfs.open-by-id` entitlement를 요구한다. 루트 UID만 확인하는 경로가 아니다.
  O_ACCMODE3은 EINVAL이며 metadata 조회 후 경로 chmod/open은 동일 inode 결박이 아니다.
- `[사실]` `native-2026-10-27-file-descriptors/`:
  inode·cursor·실제 exec marker를 따로 검사하는 oracle과 Mac fixture를 준비했다.
  fileport는 이미 열린 FD를 필요로 하며 duplicate·`/dev/fd` 문자열만으로 reopen/exec를
  가정하지 않는다. 해당 최신 실제 Darwin descriptor 실행은 NOT_RUN이다.
- `[사실]` Apple의 launch/spawn constraint는 검토했지만 현재의 일반 entry pin·same-inode
  repair/reopen 전체를 대체하는 구현으로 채택하지 않았다. source 위치와 원문은 위 audit을 따른다.

[추측] 현재 public primitive 조합으로 세 핵심 보장을 모두 만족시키기 어려울 수 있다.
그러나 위 후보 배제는 **가능한 모든 설계가 불가능하다는 증명은 아니다**. 다음 모델은 이전
모델의 미해결 판단을 API 부재의 증명으로 받아들이거나 CI 부재와 혼동하지 않는다.

[사용자 지시] 실제 구현 수단을 조사·구현하고 모든 caller·실패·복구 경로를 연결하는 것이 목표다.
CI가 없다는 이유로 현재 guard만 남겨 놓고 native 구현을 끝냈다고 보고하지 않는다.
보장을 낮추거나 불명 상태를 성공으로 만드는 코드는 완성 구현이 아니다.

### 14.8 재개 후 권장 순서

[제안] 다음은 아직 수행하지 않은 작업 순서다. 사용자 재개 지시 후 실제 source·프로세스·Git
상태를 확인해 적용한다. 현재 paused 상태에서 이 목록만 보고 자동 재개하지 않는다.

1. `[제안]` §14.3의 두 작업 폴더·미commit 파일·snapshot을 먼저 비교한다. 현재 Keychain
   WIP를 잃거나 메인 HEAD만 보고 구현이 없다고 판단하지 않는다. 필수 규범은 §1의 목록과
   PRIORITY-0, 현재 owner/verification/durable-format map을 실제로 읽는다.
2. `[제안]` Keychain WIP의 compiler argv·캐시/출력 소유·설치 경로와 FD/child cleanup을
   먼저 검토한다. signed release 생성 흐름은 별도 남은 구현인지 확인한다. 새 helper를
   두 번째 auth/business runtime으로 키우지 않는다.
3. `[제안]` 필요한 로컬 시험을 고정 입력에서 수행한다. 바뀐 common 명령은 **TAP**이므로
   옛 `ℹ pass` 전용 집계 script를 그대로 복사하지 않는다. 실제 Linux TAP에 Mac oracle6개를
   요구하면 거절되는지도 확인해 Linux portable1개가 Mac 성공으로 표시되지 않게 한다.
   실제 Mac helper6개와 signing 접근은 실행 전까지 NOT_RUN으로 남긴다.
4. `[제안]` source·derived inventory/review 상태·문서의 입력을 일관되게 고정하고 관련
   정책/경계·전체 구조·독립 packed26 및 필요한 회귀를 확인한다. root build·strict는 이미
   끝났으므로 입력 변경이나 실패 이유 없이 큰 시험을 반복하지 않는다. authored review를
   자동 재인증하지 않는다. 현재 문서 편집 때문에 달라진 입력과 이전 PASS를 구분한다.
5. `[제안]` 이후 세 native 핵심의 구체 수단과 producer·journal 복구·authority 조립을
   완성한다. 모르는 동작은 고정된 공식 구현/SDK와 반례로 대조한다. 설계 후보를 검증용
   predicate만 있는 미사용 module이나 항상 unknown인 backend로 추가해 작업량을 채우지 않는다.
   검토가 같은 제약만 반복하면 그 사실을 보고하고, 독립적으로 구현할 누락이 있는지도 확인한다.
6. `[제안]` native 구현·CI fixture 준비를 마친 다음 전체 코드 복잡도 검토를 수행한다.
   이미 본 후보는 MachListener의 started/closing/closed와 audit-peer의 closing/matched/taken
   상태다. 이 두 곳만 고치는 것이 전체 검토는 아니다. 전체 inventory에서 실제 owner·필요한
   상태·정책 중복·불필요한 추상화·case별 분기를 확인하고 의미 있는 회귀와 함께 고친다.
7. `[제안]` CI 복구 후에는 source/input·Node/Pi/SQLite/Koffi/Git/Restic·OS/SDK/Swift·정책
   digest를 기록하고 먼저 핵심 primitive/실행 경로를 확인한다. 알려진 실패를240분짜리 Mac
   전체 job으로 반복하지 않는다. 이어 실제 Mac scenario·독립 설치·archive/restore·부정 사례와
   전체 Linux 회귀를 수행한다. 부분 시험을 전체 qualification으로 승격하지 않는다.
8. `[제안]` commit/push 전에 현재 dirty 인계 문서를 포함한 보존 대상을 검토한다. 과거
   `finish-main.py`는 메인의 README/validation 두 dirty 파일만 허용하도록 작성돼 있으므로
   **이번 인계 문서까지 수정된 상태에 그대로 실행하면 안 된다**. 문서·사용자 변경을 보존하고
   work branch에서만 정상 commit/push하며 master 병합·배포는 하지 않는다.

[사실] 로컬 Node 경로는
`/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin:/usr/bin:/bin`이다.
실제 Linux kernel 시험에는 고정 bwrap
`/home/dev/.local/share/oma-toolchain/bubblewrap-0.12.0/usr/bin/bwrap`를 사용했다.
시스템 bwrap을 덮어쓰지 않고 필요 시 기존 audit의 `/usr/bin` overlay 실행 방식을 따른다.
SDK snapshot은 `/home/dev/.local/share/oma-toolchain/macos-sdk-snapshot-896cd40df984`이며
Linux에서의 cross compile/stub link는 실제 Mac 실행 증거가 아니다.

### 14.9 작업량 전망과 종료 판단

[추측] 사용자는 정확한 시간이 아니어도 대략적인 남은 시간 답변을 원한다. 마지막 전망은
**추가12–24 작업시간**: native 구현·CI 시험 준비8–16시간, 이후 전체 코드 정리4–8시간이었다.
실제 Mac CI 대기/실행은 제외했고, **막힌 핵심 구현 수단이 확보된다는 전제의 낮은 확신
추정**이다. 완료 약속·검증된 속도·시간 상한이 아니다. 과거2–3시간/약80% 전망은 잘못됐다고
이미 정정했다. 다음 모델은 숫자를 기계적으로 이어받지 말고 현재 남은 구현으로 다시 추정한다.

[사실] 목표는 아직 달성되지 않았다. 현재 Keychain WIP도 최종 검증·commit/push가 남았다.
세 native 핵심 구현, 실제 Mac qualification, 이후 전체 코드 복잡도 정리가 미완료다.
이번에는 사용자의 명시적 중단에 따라 구현을 멈추고 인계만 작성했다.
