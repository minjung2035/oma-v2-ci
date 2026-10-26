# macOS native 전환 명세 — TypeScript 공통 실행부와 최소 OS 경계

상태: **DR49로 구현 채택, 진행 중**. 작성일: 2026-10-25. 초기 조사 HEAD는 `d571645941e621eec6ccd91504cfbdc72389200d`다. 사용자 구현 지시가 이전 문서 정리 범위를 대체했다. VM 구현은 제거하며 fallback으로 남기지 않는다. 채택은 G-PROCESS·G-FILES·G-AUTH 통과나 native 지원 완료를 뜻하지 않는다. 실제 구현·시험 결과는 [전환 기록](implementation/native-transition.md)과 [validation](implementation/validation.md)을 따른다.

요청의 목표는 macOS용 Linux VM을 폐기하고, Linux와 macOS가 같은 TypeScript 제품 실행부를 사용하는 것이다. 개발자는 Mac을 직접 사용할 수 없으므로 macOS 실행 증거는 GitHub Actions에서 얻는다. 구현 순서는 **Linux에서 공통화 → 같은 시험을 macOS CI에서 실행 → 필요한 OS 집행부만 연결**이다.

추천하는 경계는 다음과 같다. **정책·수명 조정·인증 판정·복구·저장 검증은 TypeScript로 통일하고, 커널의 격리·안전한 파일 연산·잠금은 작은 OS primitive로 남긴다.** macOS에 두 번째 broker·supervisor·storage engine을 만들지 않는다. 다만 현재 계약을 유지하면서 네이티브 의존성을 문자 그대로 샌드박스 하나로 줄인다고 약속할 수는 없다. Node에 없는 directory-relative 파일 연산과 kernel lock, 임의 후손의 종료 증명은 별도 문제다.

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

Darwin은 이 명세의 가장 큰 미해결점이다. kqueue `NOTE_EXIT`는 등록한 process를 관측하는 후보일 뿐이다. Apple XNU는 `NOTE_TRACK/NOTE_TRACKERR/NOTE_CHILD` 요청을 `ENOTSUP`로 거절한다. 따라서 FreeBSD식 자동 후손 추적을 구현안으로 쓰지 않는다. launchd job 종료·coalition·libproc scan도 추가 검증 없이 cgroup empty로 취급하지 않는다. [Apple XNU kqueue 구현](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_event.c).

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

CLI 경로는 다음 원칙으로 구현한다. OMA가 직접 실행하는 client에는 명시적 channel을 넘기고, pathname endpoint를 사용하는 manual CLI에는 **같은 run에 속한 실제 process라는 관측**을 추가한다. 기존 Linux peer/pidfd 관측은 adapter로 옮긴다. Darwin은 `getpeereid`·kernel peer PID·process identity/시작 정보·liveness 관측을 작은 native reader로 제공하고 ancestry·현재 grant·authority 판정은 같은 TS owner가 한다. 정확한 공개 API·PID 재사용 방어·소켓 인계 공격은 G-AUTH에서 확정한다.

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

특히 현재 O_PATH가 맡은 **mode-000 entry pin, I/O 전 종류 확인, 같은 inode 수리/재열기**를 Darwin에서도 각각 검증한다. FIFO·device를 먼저 I/O open한 뒤 stat하는 대체는 금지한다. 기존 Mac host `files.ts`의 pathname 기반 helper는 Society의 강한 owned-state API와 동일하다고 승격하지 않는다. `/dev/fd` 문자열 치환도 해결책으로 간주하지 않는다.

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

현재 형식은 HostConfig 3, DB 4, plan envelope v2, managed journal committed-v2다. Linux-only `installation.rootfs`, systemd asset pin, durable host absolute path를 실제로 바꾸면 설정/형식 version을 명시적으로 올린다. 번호는 구현 시 registry에서 한 번 할당하며 무조건 기존 필드를 optional로 풀어 과거 설정을 받아들이지 않는다. OS backend는 caller가 주장하는 권한 설정이 아니라 설치·플랫폼 composition의 선택이다.

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

**G-FILES:** Darwin에서 held-root·directory lock·entry pin·no-follow/beneath·metadata repair·no-replace publication·외부 writer/executable 결박을 만족하는 실제 SDK/API와 반례 결과. `O_RESOLVE_BENEATH` 등은 feature probe로 확인한다. 디렉터리 FD lock과 root 교체 방어를 증명하지 못하면 abstract lease 제거도 보류한다.

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


## 14. 구현 세션 인계 — 2026-10-26

이 절은 구현 상태와 재개 지점이며 완료 판정이나 과거 시험의 재결박이 아니다. 사용자 최신
지시는 **남은 레거시도 전부 제거**하는 것이다. 현재 작업량 추정은 약80%이며 지원율이 아니다.
macOS native 제품 실행·레거시 제거·최종 검증은 아직 완료되지 않았다.

### 14.1 재개 전에 반드시 확인할 입력

- 작업 디렉터리 `/home/dev/oma-v2`, 브랜치 `work/macos-native-20261025`.
- 최신 local/push HEAD `9116bb6b667edb0e3a4a31d05e4fa1bb20bb6b1e`. 아래 후속 변경은 **미commit·미push**다.
- 기존 dirty root `README.md`는 최초 사용자 변경이다. 그대로 보존하며 stage/commit하지 않는다.
  그 외 현재 dirty source·시험·문서와 새 `docs/implementation/native-reference-review.md`도 보존한다.
- 필수 문서는 §1의 전체 목록과 `docs/application-boundaries.md`, 현재 owner map·verification map을
  전부 읽는다. `production-manifest.json`·`production-files.txt`가 가리키는 **모든 프로덕션 코드**를
  실제로 읽어 현 상태를 확인한다. 이 기록이나 이전 PASS로 그 읽기를 대체하지 않는다.
- PRIORITY-0, accepted plan/receipt/DB·권한 의미 보존,26개 workspace의 공개 API·runtime/type DAG와
  독립 build/test/install 경계를 유지한다. 새 책임은 좁은 독립 모듈로 둔다.
- 고정 `docs/architecture.md`, `implementation/review-notes.json`, 과거 authored review/audit는 변경하지 않는다.
  변경 코드의 과거 review를 자동 재결박하지 않는다. master 병합·배포는 금지다.
- Node 실행 PATH는 `/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin:$PATH`.
- 원시 증거는 `/home/dev/oma-audit-artifacts/native-2026-10-25/`에 있다. `initial.patch`,
  `initial-status.txt`, `initial-untracked/`, `protected.json`이 최초 변경 보존 근거다.

### 14.2 구현한 범위와 단계별 현재 한계

| 단계 | 실제 구현/연결과 남은 조건 |
|---|---|
| P0 | DR49–58·NATIVE-001–021·현재 규범·source owner/traceability·인벤토리·의존 그래프 갱신. 고정 architecture와 과거 review 보존. 전체 수동 production review 완료를 주장하지 않음 |
| P1 | 실제 Linux kernel 시험과 Mac26/15 SDK/kernel probe·raw artifact 수집. G-PROCESS/G-FILES/G-AUTH 세 gate는 모두 OPEN |
| P2 | 공통 TS owned-files/publication/config/package/tool-file 정책과 최소 POSIX leaf 연결. `@oma/tool-files`를26번째 workspace로 분리. Linux 실제 회귀/독립 설치 검증. Darwin의 permission-independent pin·exact reopen/execution 결박 등은 미완성 |
| P3 | 공통 ExecutionCoordinator/journal, ResidentRuntime/Supervisor, wake/backoff/log/drain, kernel scope pin 기반 RunRegistry 구현. opening→witness 영속→fresh authority→release와 unknown fence·복구 순서 연결 |
| P4 | Linux bwrap PID namespace/pidfd 및 메시지별 kernel sender 증거로 실제 Worker/Pi·trusted runner·broker 실행 연결. systemd manager를 요구하지 않음. **Darwin production Seatbelt/process/auth backend는 미완성**이며 후보 harness를 구현 완료로 세지 않음 |
| P5 | actual candidate checkout/status/release gate, Git quarantine RO검증→scope 사망→RW import, Restic pin/공통 stream verifier·archive/restore 연결. 기존 accepted bytes와 같은 inode의 독립 cursor·현재 권한 재검사 유지. Mac 실제 end-to-end는 미완료 |
| P6 | 공통 oma 진입·Society/Personal 조립, standalone get/put Keychain primitive, 실제 설치 prefix Personal PTY 검증. VZ/vsock/guest/systemd의 주요 실행 구현·자산 제거. 아래 잔존 VM 정책/API는 아직 제거하지 못함. Mac 제품은 모든 효과 전에 명시적으로 거절 |
| P7 | 현재 운영 안내·책임 경계·규범·owner·시험/CI 증거를 함께 갱신. 최종 지원 대조·레거시 잔존 제거·현재 입력의 실제 Darwin qualification은 남음 |

미push 후속에는 Broker의 완료된 mutation 뒤 event-loop turn 반환(DR58/NATIVE-021),
accepted plan/result 보존 회귀2개, START의 host network 표기와 해당 기대값 수정,
policy fixture의 실제 Node timer 연결, Chromium 방식의 Mach rendezvous 후보가 포함된다.
Broker status publication의 CoalescedWake/Store close 이전 drain 수정은 앞선 commit에 있다.

### 14.3 실제 시험 결과 — 입력과 범위를 구분

| 실행/입력 | 실제 결과 |
|---|---|
| `5e369b30` Architecture40316751983 | baseline 전체3777/3777 및 native-all3777/3777 PASS, skip/cancel/todo0. fast795/795·durable871/871·property34/34·stress13/13·platform29/29 PASS. source/input과 ZIP SHA 검증. raw `ci-5e369b30/architecture-baseline-summary.json` 및 각 artifact |
| 같은 commit Native40316752088 | Mac26/15와 Ubuntu 공통각74/74, Linux peer3/3·native37/37·선택430/430 PASS. `ci-5e369b30/verified-summary.json`. Mac gate는 baseline15개 OBSERVED와 옛 Mach6개 receive timeout/SETUP_FAILED이며 지원 PASS가 아님 |
| 앞선 전체 CI 실패 | e997 native-all의 mkdirAt EAGAIN1건, e37 stress의 mixed lag100ms 실패를 원문 보존. 이후 PASS가 이 실패를 지우지 않음. mkdirat/owned mkdirAt 각각20만 회·자식25개 관측은 EAGAIN 미재현이며 원인 미확정 |
| 독립 설치 최신 기존 증거 | `native-status-mach-packed-install*`: Linux26/26 PASS·269.430초, input a3b7fb252b39a2ca6a6fafb1d587c4bfb58785c9e9b7b601950ee0ce20ed8c0b 전후 동일. authored declaration 오류0과 외부 SDK 진단44는 구분. 현재 미push Broker 변경 뒤의26개 재검증은 남음 |
| 새 reply-turn 회귀 | 새2개 수정 전2 FAIL, 수정 뒤 기존6개와8/8 PASS. `native-dispatch-yield-{before,after}-fix*`. 이후 관련 START/role/status/public-validation33/33 PASS·skip/cancel/todo0,18.495초·input ce9b96e02382976921f01f69b0ae67fe4c1471efd9c3dbba6d37fd4b65fdfd56 전후 동일 |
| 미push 후속 첫 전체 | `native-reference-yield-whole*`: 3762/3779 PASS·17 FAIL, skip/cancel/todo0·940.027초·input bc7e189f79ebed11044bd9697a3ed987bbb9904781b93b083585e00a78b02a18 전후 동일. 실패는 START의 옛 기대값1건과 fixture의 새 timer import 미연결16건. 정확한 문구와 실제 Node timer module로 수정 후 관련33/33 PASS |
| 수정 뒤 현재 입력 | typecheck13.771초·전체 정적 gate40.796초 PASS. `native-reference-final-{typecheck,architecture}*`, input ea01a620c2ca543ec7756e675985df712b9f6918d8528e5482579d748211458a 전후 동일. **전체 재실행 결과는 아래 인계 시점 기록을 따른다** |

### 14.4 인계 직전 진행 중이던 실행

`native-reference-fixtures-whole` 전체 npm test를 실제 bwrap wrapper 안에서 시작했다.
시작 시각2026-10-26 13:16 UTC, 입력 ea01a620c2ca543ec7756e675985df712b9f6918d8528e5482579d748211458a,
기존 tool session27092다. 관측 timeout만으로 살아 있는 실행을 재시작하지 않는다.
원시 `<label>.log`, `-before.json`, `-after.json`, `-status.json`으로 종료·입력 불변·정확한
PASS/FAIL/skip/cancel/todo를 확인한다. 새 세션에서 tool session이 보이지 않아도 프로세스와
원시 파일을 먼저 확인하며, 실행 중에는 그 입력을 편집하거나 metadata를 생성하지 않는다.

인계 시점 확인: 위 실행은 **정상 종료·3779/3779 PASS**(serial13/13·parallel3766/3766),
fail/skip/cancel/todo0·exit0·signal null·943.025초다. before/after 입력은 위 ea01a620…로
동일하다. 현재 살아 있는 이 실행은 없다. 이 절을 추가하기 전 입력의 실제 전체 결과이며,
문서 추가 뒤 입력을 같은 runtime 검증으로 재결박하지 않는다. 잔존 레거시 제거 뒤에는 다시
검증해야 한다. 현재 미push 변경 뒤 독립 packed install26개와 실제 새 Darwin CI는 미실행이다.

### 14.5 새로 확인한 잔존 레거시 — 아직 미수정

사용자가 다시 “레거시 다 지우라”고 지시한 뒤 아래를 실제 source에서 찾았다.
따라서 이전의 주요 VM runtime 제거를 **레거시 완전 제거**로 보고해서는 안 된다.

1. `apps/oma/src/runtime/session-catalog.ts`: Darwin Society birth/resume 거절 및 Society 목록의
   Darwin 조기 반환. “Mac Society histories live in the guest” 전제를 제거하고 같은 birth/binding
   owner로 검증한다. 제품의 미해결 gate guard와 옛 VM routing을 혼동하지 않는다.
2. `packages/tui/src/words.ts`, `packages/domain/src/product-text.ts`:
   `OMA_PRODUCT_TEXT`·productSurface·Linux 용어 숨김·guest log/stdout 라우팅이 남아 있다.
   사용하지 않는 환경변수 호환 경로·dead codec/export·bound·architecture 예외까지 제거하고
   native CLI의 공통 오류 표시로 직접 연결한다. noop compatibility wrapper로 남기지 않는다.
   `test/dr18-product-words.test.ts` 등 현재 시험과 규범도 실제 최종 구현으로 교체한다.
3. `apps/oma/src/runtime/inference-relay.ts`: VM egress handoff용 `InferenceRelay.detached/accept`의
   사용처와 owner를 전수 대조해 남은 미사용 API를 제거한다. 다른 책임의 동일 이름 API는
   근거 없이 삭제하지 않는다.
4. `packages/domain/src/errors.ts`의 START_LIMIT 설명은 아직 “Systemd start limit”이다.
   현재 공통 breaker 의미로 바로잡고 wire code·accepted receipt 의미는 보존한다.
5. native runner가 `INVOCATION_ID`라는 systemd 환경변수 이름을 여전히 사용한다.
   실제 identity는 공통 실행 owner가 발급한다. runner/native-residents/관련 fixture의 전달을
   현재 소유 계약으로 정리하고 ambient systemd 환경에 기대는 경로를 제거한다.
6. protocol/principal-credential, status-view, lifetime, client, diagnostics 등 source comment와
   현재 운영 문서에 guest/systemd/cgroup 설명이 남아 있다. 실제 코드와 대조해 현재 설명으로
   고친다. 현재 Linux sandbox의 AF_VSOCK 금지, 기존 데이터·메일 표준의 의미, 고정 architecture와
   과거 검토 기록은 단어 검색만으로 삭제·변경하지 않는다.

검색 원문은 외부 `legacy-current-inventory.txt`다. 이 목록은 모든 production code의 최종
전수 검토가 아니며, 새 세션에서 전체 코드를 읽고 코드·설정·자산·exports·시험까지 다시 확인한다.
`check:legacy`의 기존 PASS만으로 이 잔존 정책이 없다고 판단하지 않는다.

### 14.6 Darwin과 CI의 실제 차단 조건

- G-PROCESS OPEN: NOTE_TRACK은 실제 ENOTSUP, setsid 후손은 group kill 뒤 생존했다.
  public API의 임의 후손 fence·전체 사망·broker 사망/재시작 복구 증거가 필요하다.
- G-FILES OPEN: 실제 mode-000 O_EVTONLY pin은 EACCES였고 exact reopen/metadata repair 및
  executable 결박이 미증명이다. XNU의 별도 O_EVTONLY I/O policy는 Apple private entitlement를
  요구한다. 이를 숨은 의존성으로 도입하지 않았다.
- G-AUTH OPEN: Unix peer PID/token은 queued byte별 sender를 증명하지 않았다. Chromium의
  bootstrap rendezvous·kernel audit trailer 흐름으로 새 mach-self/rendezvous-live/rendezvous-exit
  후보를 구성했지만 실제 Mac에서는 NOT_RUN이다. live pin·PID 재사용·scope membership과
  production transport 연결도 남았다.
- `9116bb6b` Native40318575316/Architecture40318575321은 모든 job이 스텝/로그 없이 시작 전
  failure였다. compiler/runtime 실패나 성공으로 세지 않는다. 연결 도구의 annotation 조회
  한계와 local gh 미로그인으로 사유 미확정이다. 사용자에게 run 화면 Errors/Annotations 문구를
  이미 요청했다. 사유 없이 같은 입력을 반복 실행하지 않는다.
- Mac 실기기는 없다. 실제 Darwin 판정은 GitHub macos-26/15 job과 raw artifact로만 한다.
  signed release Keychain·TCC·sleep/wake·power loss는 별도 미검증이다.
- 외부 구현은 sandbox-runtime·Codex·Gemini CLI·Chromium·OpenClaw fs-safe의 고정 source를
  대조했다. [참고 기록](implementation/native-reference-review.md)의 근거와 채택 범위를 따른다.
  다른 제품의 group kill/pgrep snapshot·협조적 writer 계약을 OMA 보장으로 완화하지 않는다.

### 14.7 다음 세션의 작업 순서

1. 이 명세와 필수 문서 전체·모든 프로덕션 코드를 읽고 현재 dirty tree와 위 실행의 종료 상태를
   확인한다. 이미 끝난 시험·살아 있는 프로세스를 중복 실행하거나 기존 변경을 되돌리지 않는다.
2. §14.5의 잔존 레거시부터 실제 owner에서 제거한다.26개+α workspace의 공개 의존 경계를
   지키고 source·규범·owner map·현재 시험을 함께 수정한다. 기존 accepted 사실을 새 실행 권한으로
   바꾸거나 불명 결과를 성공/실패/부재로 단정하지 않는다.
3. P0–P7의 남은 구현을 계속한다. Darwin 실제 primitive 후보·전체 수명·파일·인증 proof를
   해결하고 OS backend를 연결한다. 막힌 gate의 재현 근거를 남기며 독립 구현은 계속한다.
4. 최신 입력을 고정해 Linux 전체·관련 실제 kernel/crash/scenario·독립 packed install26개와
   정적/타입 검사를 수행한다. metadata 생성도 순차 수행하며 authored review를 새 PASS로 만들지 않는다.
5. concrete 변경을 작업 브랜치에 commit/push하고 필요한 workflow 실행·결과·raw artifact SHA와
   source/input을 확인한다. master 병합·배포는 하지 않는다. Mac CI가 시작되지 않으면 외부
   차단으로 기록하고 mock/skip/보장 완화로 통과시키지 않는다.
6. 구현 범위·실제 시험 결과·남은 차단 조건을 구분해 보고한다. 미완성 Mac backend나 잔존
   레거시를 숨긴 채 “구현 완료”, “완전 제거”, “100% 지원”이라고 보고하지 않는다.

### 14.8 재개 후 구현 — 2026-10-27

§14.7의 사전 읽기를 완료했다. 필수 문서·owner/traceability/durable map과 자체 작성 production
523개를 모두 읽고, vendor는 §1에 따라 네 bundle의 정확한 파일/byte manifest와 OMA 접점을
대조했다. third-party 전체 행의 수동 audit나 runtime qualification을 주장하지 않는다.

§14.5의 VM 오류 표시·Darwin history routing·미사용 relay handoff·ambient runner identity를
제거했다. 추가로 미사용 Society 선택·VM package generation 수집과 reader lease·옛
`egress.connect` 전용 grammar를 제거했다. 현재 로컬 패키지 경계와 index reader, 과거 데이터,
accepted plan/receipt와 historical version2 reader는 유지한다. DR59/NATIVE-022–023을 따른다.

사용자는 macOS의 실제 테스트를 제외하고 코드 대조·타입/정적 검사를 통한 구현 범위의 견적을
요청했다. 앞선 세션에서 이를 실행 시험 보류로 해석했으나, 견적 조건은 원래 목표의 실제 Mac CI
요구를 대체하지 않는다. 원래 목표에 따른 검증도 계속한다. 제시한8–12시간은
작업 견적이며 세 gate 해결·지원 검증을 보장하는 완료 시간이 아니다. Darwin 세 gate는 OPEN이다.
이번 수정 후 runtime 회귀와 packed install은 NOT_RUN이며, 과거 PASS를 현재 입력에 재결박하지 않는다.

후속으로 Broker의 OS peer pin·message identity·listener 생성·endpoint 길이 검사를 필수 port로
분리했다. 공통 코드는 Duplex와 listener 수명 계약을 사용하며 현재 Linux adapter가 실제
SO_PEERCRED/SO_PEERPIDFD/SCM_CREDENTIALS를 제공한다. Mac audit leaf는 공개 BSM accessor를
사용한다. sender provenance는 kernel receive가 발급한 객체로 제한한다. preparation 실패 뒤
실제 listener close를 기다리지 않던 경로도 수정했다. Mac transport의 실제 조립은 아직 남았다.

현재 공개 bootstrap header와 Chromium/launchd 구현의 anonymous check-in 차이도 확인했다.
동적 rendezvous의 성공을 가정하거나 다른 runtime의 registered-port slot을 덮어쓰지 않는다.
source의 정확한 근거와 채택 범위는 [참고 기록](implementation/native-reference-review.md)을 따른다.

### 14.9 Mach byte connector의 source 조립 — 2026-10-27

`343d4f85` checkpoint 뒤 공통 PacketStream과 Mac rendezvous/byte transport를 추가했다.
App이 Client/Broker에 OS connector를 주입하고 shared generation·frame/stream/receipt·현재 권한
owner를 재사용한다. raw Mach message의 수신 reply reference와 timeout pseudo-receive 반환을
명시적으로 소유하며 data/EOF 각각 kernel sender 대조를 거친다. 이름 hash·nonce·서비스 발견은
권한이 아니다. native close 실패와 stream close도 별개로 보존한다.

이것은 source 조립이며 실제 Mac 실행이나 세 gate 통과가 아니다. ordinary dynamic bootstrap
check-in, actual cross-process byte stream/인계/큐 포화/사망/PID 재사용은 여전히 미검증이다.
Security image validation의 sync disk 작업은 async/tracked owner로 옮겨야 하며 WP23 실제 예산도
확인해야 한다. Mac process/file backend의 미해결 보장은 이 connector로 대체하지 않는다.

기존 public/durable DTO golden은 바꾸지 않았다. 현재 native consumer-port golden만 explicit
peer/listener interface와 runner-peer 이름의 의도한 변화로 갱신했으며 mutation guard는 유지한다.
shared-flow 회귀와 Unix dial generation fixture를 수정했고, 실행 여부와 결과는 validation의 실제
입력별 기록으로 구분한다. 견적에서 테스트를 제외한 것과 최종 목표의 실제 검증 완료는 다르다.

실제 Mac adapter 관측용 `darwin-mach-stream.mjs`를 추가했다. production Node adapter의
cross-process 왕복·인증 EOF·자원 반환, queued sender exit 뒤 binding 거절, live connector의
정상 바이트를 받은 뒤 독립 holder의 send-right 인계를 거절하는 세 경우다. 기존 C probe와 함께
각각3회 실행하며 원시 실패를 독립 보존한다. 이 추가도 실제 Mac CI 전에는 NOT_RUN이다.

### 14.10 실제 push·검증과 다음 경계 — 2026-10-27

`343d4f85`와 `7ebb7268`을 작업 브랜치에 push했다. source byte stream은 peer의 destination
receive right 손실을 보기 전에 이미 queue된 마지막 reply/EOF를 먼저 drain한다. 그 bytes와 EOF의
sender 검증은 유지한다. build/types/전체 정적·공통81/81·generation9/9 및 후속26/26 독립 설치의
정확한 입력·원시 로그는 validation을 따른다. 전체 Linux/Mac PASS로 합산하지 않는다.

새 Native40380089004/Architecture40380089190의7개 job은 모두 스텝 시작 전 failure다.
연결 도구가 annotation 본문을 거절하여 원인은 미확정이며 새 실제 Mac 관측은 NOT_RUN이다.
원본 응답은 `/home/dev/oma-audit-artifacts/native-2026-10-27-mach-connector/ci-7ebb7268.json`에 있다.

source 검토에서 현재 client의 live audit pin과 expected Broker identity는 별개임을 확인했다.
현재 nonce/public service name과 valid code image만으로 후자를 확인하지 않는다. 신뢰한 launch/
held-state owner의 expected identity 결박과 서비스 선점 반례가 필요하다. 이것과 async Security
resource owner, process/file backend의 미해결 보장을 구현한 뒤 실제 Mac에서 검증한다.
현재 product guard와 세 OPEN gate는 유지한다.

### 14.11 비동기 audit binding과 실제 자원 반환 — 2026-10-27

후속 source는 Security guest lookup/validation을 Koffi async worker로 옮겼다. native result와 CF
반환 completion을 나누고, process watcher는 검증 전에 획득한다. `bindMachSender.ready` 뒤
`take` 한 번으로 pin을 넘기며 취소된 acquisition은 실제 callback/CF/unclaimed watch 반환을 기다린다.
Client의 readiness 실패 응답과 stream/native close도 구분한다. listener close는 검증 중인 모든
request까지 join한다. deadline은 monotonic 경과를 다시 확인해 timer callback 지연으로 늘어나지 않는다.

공통 PacketStream의 비동기 반환 regression4개는 수정 전4 FAIL·수정 뒤 기존4개와 합쳐8/8 PASS다.
setup 실패·construction 전 취소도 동일 owner를 사용하며 pending write의 원래 오류와 cleanup 오류를
보존한다. 실제 Mac `mach-audit-async` case를 추가했으며 source compile/shared-flow PASS는 실제
Darwin 실행·WP23 latency·native reference count·expected Broker identity나 세 gate 통과가 아니다.

`c2745daa`를 작업 브랜치에 push한 뒤 같은 source의26/26 독립 설치·공개 API/자체 선언·지정
runtime smoke를 확인했다. input `f353d015...`(15612개) 전후 동일이며 validation이 원본을 소유한다.
새 Native40385385778/Architecture40385385695는7개 job 모두 스텝 실행 없이 failure다. queued였던
마지막 Mac15 job도 같은 handle로 재조회해 terminal을 확인했고 artifact는 없다. 실제36개 Darwin
C/Node case는 NOT_RUN이며 원인은 미확정이다. 이 실패를 source compile/runtime 실패로 바꾸지 않는다.

### 14.12 전체 Linux의 실제 실패와 후속 수리 — 2026-10-27

최신 전체 Linux는3772/3784 PASS·12 FAIL이었다.9건은 명시적 execution UUID의 시험 호출 누락,
2건은 실제 pin/endpoint mechanism을 주입하지 않은 이전 Reflect fixture,1건은 find completion의
실제 fdfind alias 누락이다. peer-pid의 실패 뒤 socket 정리가 기다리던 마지막 test process는 다른
file들의 완료를 확인한 뒤 SIGTERM했으며 개입/원래 실패를 보존했다. 원본·입력·범위는 validation을 따른다.

fixture는 실제 control FD·Linux peer pin/endpoint 효과를 주입하고, 실제 runner argv를 journal의
execution과 정확히 대조한다. ambient identity를 복구하지 않는다. 이름 fallback은 미생성 child의
close 뒤에만 진행하며 이미 실행된 query는 재생하지 않는다. 실제 SDK와 대조해 find0/grep threshold,
buffered excess와 완료 후 truncation metadata도 수리했다. 선택26/26·55/55와 이후31/31을 확인했으며
전체 후속과 실제 Mac qualification은 여전히 별도다. 기존 실패·규범·accepted plan/receipt를 보존한다.

수리 source `bd2049c8`를 push한 뒤 전체 Linux3787/3787·exit0·fail/cancel/skip/todo0을 확인했다.
관측 중 수동 개입 없이 끝났고 입력/보호 파일 SHA는 전후 동일이다. 새 Native40397569660/
Architecture40397569605는 다시7개 job 모두 스텝 실행 전 실패했으며 artifact는 없다. 실제36개
Darwin case는 NOT_RUN이다. 이전 Linux 실패를 지우거나 이 Linux 결과로 Mac gate를 통과시키지 않는다.

### 14.13 P7 검증 입력의 문서 누락 수리 — 2026-10-27

문서 검사는 루트 README와 root 밖의 새 Markdown도 발견하지만 기존 verification digest는 이를
모두 담지 않았다. 실제 finding이 바뀌어도 같은 identity였던 반례2개를 먼저 실패시킨 뒤 README를
필수 입력으로 추가하고 기존 문서 discovery owner의 현재 Markdown을 source closure에 결박했다.
새 문서도 symlink이면 거절하며 archive/runtime output의 기존 구분과 과거 결과는 유지한다.
분리 작업트리의15613개 고정 입력에서 문서/목록17/17을 확인했다. validation이 정확한 입력을 소유한다.

최초 사용자 변경 README는 수정하거나 commit하지 않는다. 커밋된 README를 쓰는 CI 입력과 사용자
README를 포함한 작업트리 입력은 다른 digest를 가진다. 로컬 `bindVerificationInputs` 재생성은
현재 실제 bytes의 구조 기록일 뿐이며, 커밋의 검증이나 이전 runtime 결과를 다시 결박하지 않는다.

### 14.14 최신 설치 검증과 P0–P7 완료 대조 — 2026-10-27

`29938a42` source의 독립 설치26/26·공개 import/자체 선언과 지정 runtime smoke16/16을 확인했다.
자체 declaration 오류0이며 외부 SDK44개 진단은 구분한다. input `ae96e9f6...`(15613개)와 보호 파일
SHA는 전후 동일이다. 이 입력은 원래 사용자 README를 포함하며 clean commit binding과 다르다.
정확한 원본은 validation과 `/home/dev/oma-audit-artifacts/native-2026-10-27-qualification/`이 소유한다.

| 단계 | 실제 확인한 범위와 미완료 조건 |
|---|---|
| P0 | 필수 문서/초기523개 authored source 읽기, 현재532개 source·14313개 production inventory·329개 clause와 모듈 경계 검사. 고정 원문/과거 review/golden·원래 README 보존 |
| P1 | 기존 실제 kernel 반례를 보존. 최신36개 Darwin 관측은 CI 시작 실패로 NOT_RUN이며 세 gate는 OPEN |
| P2 | 공통 handle/file owner와 Linux 회귀. Darwin permission-independent pin·exact reopen/repair·파일 경합/실행 대상 결박은 미완료 |
| P3 | 공통 TS supervisor/wake/backoff/log/registry와 Linux 회귀. Darwin 임의 후손/owner-loss 종료 증거는 미완료 |
| P4 | 실제 Linux namespace 실행과 공통 인증 정책. Darwin scope/Seatbelt/path view·실제 scope membership/권한 검증은 미완료 |
| P5 | Linux hostile bundle/quarantine/Restic 회귀와 현재26개 독립 설치. Darwin 같은 실행 경로의 수명/격리/정확한 실행 결박은 미완료 |
| P6 | VM runtime 폐기·과거 accepted bytes/receipt 의미 보존과 Linux 회귀. Mac native 진입은 gate guard로 거절하며 양 OS clean scenario 완료가 아님 |
| P7 | 현재 source/문서/owner와 입력 누락 수리를 대조하고 원시 증거를 고정. 남은 Darwin 구현 뒤 최종 규범별 runtime 증명이 필요 |

`execution-runtime.ts`의 non-Linux backend 거절과 native `files.ts`의 Darwin pin/reopen/repair
거절은 실제 미구현 경계다. transport source 연결이나 지원 전 거절을 지원 완료로 세지 않는다.
§13.2의1·4·6은 실제 양 OS 실행 증거가 없고,2·3의 정적 구조와5의 거절/unknown 방어만으로 이를
대체하지 않는다.7의 과거 bytes/권한 보존을 위해 자동 migration·accepted plan 재작성도 하지 않는다.

Native40400373660·Architecture40400373613의7개 job 모두 terminal failure·steps/logs null·artifact
없음이다. check-run output 본문도 null이며 annotation 원인은 미확정이다. 같은 source를 맹목적으로
재실행하지 않는다. 공개 API 조건을 충족하는 전체 후손/파일 capability 수단과 실제 Mac CI 증거가
없으면 목표는 미완료이며 private entitlement/root/private coalition/VM이나 기능 축소로 통과시키지 않는다.
