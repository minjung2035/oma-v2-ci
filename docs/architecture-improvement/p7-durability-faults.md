# P7 — deterministic durable-FS fault seam과 fault matrix

제안서 §12와 HANDOFF §5.3의 P7 결과다. seam은 **low-level durability primitive에만** 있고 workflow coordinator나 Mail/Git/Lifecycle constructor로 전달되지 않는다. production 호출자는 아무것도 넘기지 않으므로 기본 경로는 기존 syscall ordering 그대로다(각 fault point마다 null 검사 1회만 추가된다).

## 1. seam의 위치와 모양

| owner | fault point |
|---|---|
| `src/storage/durable-fs.ts` | `file-create`(before/after-visible), `file-write`(before/ambiguous), `file-fsync`(ambiguous/after-visible), `derived-rename`(before/after-visible), `directory-fsync`(ambiguous/after-visible), `temporary-cleanup`(after-visible) |
| `src/storage/immutable-file.ts` | `publication-link`(before/after-visible), `destination-validate`(before/after-visible), EXDEV 임시 파일의 create/write/fsync, `directory-fsync`, `temporary-cleanup` |
| `src/storage/context-stream.ts` | entry `file-create`/`file-write`/`file-fsync`, `fsyncTree`/staging `directory-fsync` |
| `src/storage/batch-view.ts` | `replaceDerivedFile` 경유 point 전달(derived view + inbox index) |

```ts
export type DurabilityPhase = "before" | "after-visible" | "ambiguous";
export type DurabilityObserver = (fault: DurabilityFault) => void;   // test-only
```

- **before**: 효과가 아직 일어나지 않았다.
- **after-visible**: 다른 관측자가 볼 수 있다.
- **ambiguous**: 이 프로세스는 효과 발생 여부를 단정할 수 없다(예: rename 뒤 parent flush 전).

fault는 **crash simulation**이다. observer가 `DurabilityFaultError`를 던지면 primitive는 그 자리에서 멈추고 **cleanup을 수행하지 않는다**. 실제 crash는 rollback 경로를 실행할 수 없기 때문이다. 실제 syscall 실패와 구분하기 위해 전용 error class를 쓴다(`isDurabilityFault`). production에는 install/reset 가능한 global injector가 없고, 판단 근거는 [MAINTENANCE](../../MAINTENANCE.md) §8·§21, [test-matrix MUST [TEST-002]](../../implementation/test-matrix.md)(fault injection은 test-only boundary hook 또는 외부 kill harness)이다.

## 2. oracle

`test/durable-fault-matrix.test.ts`가 accepted operation을 준비한 뒤 targeted low-level effect에 fault를 주입하고 다음 순서를 실행한다.

```text
accepted intent 준비
→ targeted low-level effect (fault 주입)
→ restart equivalent (Store 재open)
→ read-only integrity (P6 inspectIntegrity, mode=offline)
→ reconcile (materialize)
→ read-only integrity
→ reconcile 반복
→ convergence
```

각 case에서 확인하는 것:

- **false success 없음**: fault가 발생한 호출은 성공으로 반환되지 않는다.
- **immutable bytes 변경 없음**: accepted object와 archive의 sha256이 처음 값과 같다.
- **duplicate effect 없음**: archive cur 항목이 정확히 하나다.
- **UNKNOWN 임의 승격 없음**: `before`/`ambiguous` fault 뒤에도 operation은 물리 증거가 확인된 뒤에만 `materialized=1`로 간다.
- **operation identity 유지**: id, `plan_json` bytes, terminal result bytes가 재개 뒤에도 동일하다.
- **repeated reconcile 수렴**: 반복 reconcile이 같은 terminal 상태/같은 디렉터리 목록으로 수렴한다.

## 3. fault matrix (실행 결과)

publication matrix (accepted mail object publication):

| fault point | phase | 결과 |
|---|---|---|
| `publication-link` | before | PASS — 이름이 생성되지 않았고, 재개 후 정확히 한 번 게시 |
| `publication-link` | after-visible | PASS — 게시된 bytes는 immutable object와 동일, 중복 없음 |
| `destination-validate` | before | PASS |
| `destination-validate` | after-visible | PASS |
| `directory-fsync` | ambiguous | PASS — ref/디렉터리 관측으로 수렴 |
| `directory-fsync` | after-visible | PASS |

primitive matrix:

| case | 결과 |
|---|---|
| accepted staging write에서 `file-fsync` ambiguous | PASS — crash가 소유한 staging 이름을 남기고(무음 absence 아님), accepted row는 그것을 참조하지 않으며, 같은 bytes로 완료된 재시도가 중복 게시를 만들지 않는다 |
| derived view `derived-rename` before | PASS — target 미생성, accepted source bytes는 rename 대상이 되지 않는다 |
| derived view post-rename `directory-fsync` ambiguous | PASS — post-rename fault는 replacement 실패의 증거가 아니다. crash가 소유한 temporary를 남기고, owner가 그 exact name을 지운 뒤 재시도가 수렴한다 |
| staging `file-write` ambiguous | PASS — crash가 소유 이름을 남기며 UNKNOWN을 absence로 축소하지 않는다 |

`node --test dist/test/durable-fault-matrix.test.js`: **9 tests / 9 PASS / 0 fail**.

## 4. 남은 경계

- P7은 **power-loss proof가 아니다**. SIGKILL/VM 전원 단절 확대는 P9 범위이며, 여기서 만든 seam은 프로세스 crash semantics만 모델링한다.
- `fsyncTree`는 tree 단위 flush이며 S-06의 openat2/커널 containment 증명이 아니다(기존 문구 유지).
- fault observer는 파일 단위 정밀도만 갖는다. 커널 page cache나 디바이스 write cache의 재정렬은 모델링하지 않는다.
