# G01-storage-fs 적대적 검증 결과

검토 대상 HEAD `070a52d` (`feat/macos-hidden-vm`). 코드 수정·build·test 실행 없음.
재현 스크립트는 `review/adversarial-2026-09-28/repro/G01-storage-fs/` 아래에서 `dist/src/...`를
import하여 실제 실행했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 |
|---|---|---|---|
| src/durable.ts | 371 | 예 | schema-only 검사기, 물리 효과 없음 |
| src/storage/durable-fs.ts | 366 | 예 | 게시 순서·fault seam·temporary 소유 핵심 |
| src/storage/immutable-file.ts | 235 | 예 | EXDEV 복사 경로 포함 |
| src/storage/directory.ts | 100 | 예 | mkdir/removeOwnedTree |
| src/storage/contained-fs.ts | 178 | 예 | openat2 RESOLVE_BENEATH/NO_SYMLINKS |
| src/storage/paths.ts | 133 | 예 | 어휘 식별만, 봉쇄 아님 |
| src/storage/quota.ts | 138 | 예 | 예약·경계값·오버플로 |
| src/storage/staged-tree.ts | 116 | 예 | rename no-replace, 심볼릭 링크 교체 |
| src/storage/tree-lease.ts | 108 | 예 | flock 임대, quiescence 판정 |
| src/storage/submit-spool.ts | 156 | 예 | bundle 준비·검증 |
| src/storage/preaccept-artifact.ts | 216 | 예 | preaccept 소유·정산 scope |
| src/storage/context-files.ts | 62 | 예 | frozen 길이 읽기 |
| src/storage/context-snapshot.ts | 96 | 예 | revision seal·publish |
| src/storage/context-stream.ts | 175 | 예 | 스트리밍 준비, UTF-8 경계 |
| src/storage/diagnostic-snapshot.ts | 22 | 예 | 상수·타입만 |
| src/storage/batch-view.ts | 21 | 예 | 재생성 가능 파생 뷰 |
| src/storage/delivery-receipt.ts | 344 | 예 | receipt 관측·게시·boundary durable |

의존 파일도 읽음(판정 대상 아님): src/leaf.ts(`lockFileDescriptor`),
src/domain/errors.ts(`unobserved`, `ANSWERED_ERRNO`), src/domain/admission.ts(`releaseOnce`),
src/domain/context-policy.ts(`ContextTextValidator`), src/domain/derived.ts, src/domain/identifiers.ts,
src/runtime/provision.ts(`fsyncTree` 호출부).

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G01-01 | Low | resource | 같은 이름의 후속 게시가 없으면 crash 잔재 temporary가 영구히 남고 quota에 계상된다 | confirmed |
| G01-02 | Info | structural | receipt 디렉터리 삭제(같은 UID) 시 `absent`→`present` 승격; 문서화된 S-06 밖 한계 | high |
| G01-03 | Info | boundary | `fsyncTree` 기본 정책이 모든 심볼릭 링크를 STORE_CORRUPT로 판정 | high |

High 이상 발견 없음.

## 3. 발견 상세

### G01-01 같은 이름의 후속 게시가 없으면 crash 잔재 temporary가 영구히 남는다
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음(P0-4 소유 모델의 의도된 결과이나, 회수 시점이 "같은 이름의 다음 게시"에만 묶임)
- 코드 경로: `src/storage/durable-fs.ts:210`(`collectDeadTemporaries`가 `TEMPORARY.exec(entry)?.[1] !== name`으로 정확히 같은 leaf 이름만 회수) → `publishNoReplace`/`replaceDerivedFile`/`publishImmutableFile`/`publishDeliveryReceipt`가 각자 게시 시작 시에만 호출
- 원인: crash(또는 주입된 durability fault)로 write→fsync 사이에서 죽으면 `.<name>.<uuid>.tmp`가 free-lock 상태로 남는다. 이 잔재는 **정확히 같은 leaf 이름을 다시 게시할 때만** 회수된다. 그 이름을 다시 게시하지 않는 경우(예: 그 operation이 결국 거절되어 같은 receipt/bundle을 다시 만들 일이 없는 경우) 잔재는 남는다.
- 영향: `observedStorageBytes`가 이 잔재를 계상하므로 quota를 조금씩 잠식한다. 사실의 의미는 바뀌지 않고(no-replace라 최종 이름은 오염되지 않음), 손상 판정도 없다. 시작 시 staging 전면 정리(다른 그룹 소유)와 `removeOwnedTree`가 상위에서 덮으면 실효 영향은 더 작다.
- 최소 반례: `publishNoReplace(t2, ...)`를 file-fsync ambiguous에서 crash 주입 → `.t2.<uuid>.tmp` 잔존. 이후 `t2`를 다시 게시하지 않음.
- 재현 방법: `repro/G01-storage-fs/publish-noreplace.mjs`. 관측 출력: `entries after crash sim (may hold .obj2..tmp): [ '.obj2.0ca86ae7-...tmp' ]`. lock은 프로세스 종료로 free가 되므로 다음 동명 게시가 회수함을 코드로 확인.
- 확신도: confirmed
- 개선 방향: 회수 owner를 "같은 이름의 다음 게시"뿐 아니라 시작 시 staging 스캔(이름 무관하게 free-lock temporary 회수)에도 명시적으로 두는지 상위 복구 경로에서 재확인. (코드 수정 아님, 회수 시점의 owner 문서화 검토.)

### G01-02 receipt 디렉터리 부재의 `present` 승격은 같은 UID 삭제로 도달 가능
- 심각도: Info
- 분류: authority/ownership
- 위반 규칙: 없음(문서화된 S-06/같은-UID 한계)
- 코드 경로: `src/storage/delivery-receipt.ts` `observeDeliveryReceipt` — receipts 디렉터리 open이 ENOENT이고 runner root가 존재하면 `{ kind: "absent", missing: "receipt-directory" }` → `deliveryDecision`에서 `present`(다시 제시)
- 원인: receipt 디렉터리는 첫 receipt 게시 때 durable하게 생기고 부모가 flush된다. 그 뒤 같은 UID의 적대 프로세스가 디렉터리를 지우면 관측이 `absent`가 되어 이미 전달된 batch를 "다시 제시" 판정으로 돌린다. 단 `openFailure`가 ENOENT 외(EACCES/EIO 등)는 모두 `unavailable`로 두므로, 승격은 **진짜 부재(ENOENT)** 에서만 일어난다.
- 영향: 확정된 delivery boundary의 의미가 바뀔 수 있으나, 오직 같은 UID의 파일 삭제(제품 봉쇄 모델 밖)에서만 도달. openat2 봉쇄는 경로 탐색만 막고 같은 UID in-place 삭제는 막지 않음을 각 파일 헤더가 명시한다(FS-005/S-06 비보장).
- 최소 반례: 정상 receipt 게시 후 `rm -rf agents/<a>/runner/receipts` → 관측 `absent`.
- 재현 방법: `repro/G01-storage-fs/receipt-observe.mjs`가 EACCES(디렉터리 봉인)는 `unavailable`(승격 아님)로 나옴을 확인. ENOENT 삭제 승격은 추론(모델상 명백, 별도 실행 생략).
- 확신도: high
- 개선 방향: 없음(S-06/같은-UID는 명시적 비보장). `validation.md` "알려진 한계"와 일치하는지만 확인 권장.

### G01-03 `fsyncTree` 기본 정책이 심볼릭 링크를 손상으로 판정
- 심각도: Info
- 분류: boundary
- 코드 경로: `src/storage/durable-fs.ts:338` `fsyncTree` 기본 정책 `"regular-files"` → 심볼릭 링크 entry에 `openRegularBeneath`(O_NOFOLLOW/RESOLVE_NO_SYMLINKS) → 봉쇄 거부 → `STORE_CORRUPT`
- 원인: `workspace-links` 정책만 심볼릭 링크를 건너뛴다. 기본 정책 트리에 심볼릭 링크가 있으면 손상으로 판정한다.
- 영향: 현재 호출부(provision.ts의 `git init --bare` staging, context-single-link, git objects)는 심볼릭 링크를 만들지 않으므로 도달하지 않는다. 새 호출부가 심볼릭 링크를 포함한 트리를 기본 정책으로 flush하면 정상 트리를 손상으로 오판한다.
- 재현 방법: 추론만(현 호출부는 안전). test/context-publication-durability.test.ts:80이 심볼릭 링크 포함 트리에 기본 정책이 corrupt를 던짐을 이미 검증.
- 확신도: high
- 개선 방향: 새 flush 호출부 추가 시 정책 인자를 트리 내용에 맞춰 명시하도록 owner 표에 유지.

## 4. 리팩터링 필요 지점

없음. 이 층은 P0-2(한 owner) 관점에서 특히 잘 정리되어 있다: 파일 게시 순서는
`durable-fs.ts`의 소수 primitive에만 있고(`writeExclusiveFsyncedFile`/`publishNoReplace`/
`replaceDerivedFile`/`publishImmutableFile`), receipt 해석은 `deliveryDecision` 한 함수가
모든 소비자에게 같은 판정을 준다. preaccept 소유는 `PreacceptScope` 한 곳으로 통합.

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **게시 순서 (공격 1).** `writeExclusiveFsyncedEntry`(durable-fs.ts:181)와 `publishOnce`(:274)는
  create(O_EXCL|O_NOFOLLOW) → write → file fsync → link(no-replace) → temporary unlink → parent
  fsync 순서를 지킨다. rename 계열(`replaceDerivedFile`:305, `staged-tree` rename:70)은 fsync(file)
  → rename → parent fsync. 주입된 fault는 정리 경로를 절대 타지 않는다(`isDurabilityFault` 분기,
  durable-fs.ts:198, 289, 322). rename 성공 뒤 parent fsync 실패는 각 함수 주석이 명시하듯
  `publishedUnconfirmed`로 두고 다운그레이드하지 않는다(immutable-file.ts:97 주석, staged-tree.ts:26).
  `publish-noreplace.mjs`로 no-replace가 기존 bytes를 덮지 않고(AAAA 유지) 성공 시 잔재가 없음을 확인.
- **unobserved 판정 (공격 4, DR13).** `errors.ts` `ANSWERED_ERRNO`={ENOENT,ENOTDIR,ELOOP,EISDIR,
  ENAMETOOLONG}만 사실로 말하고 EACCES/EIO/ENOMEM/EMFILE/ENOSPC은 `unobserved`→BROKER_UNAVAILABLE.
  `quota.ts:28`(lstat ENOENT만 continue, 그 외 BROKER_UNAVAILABLE), `immutable-file.ts:99`
  `failedObservation`(ENOENT만 absent), `submit-spool.ts` `observeFrozenBundle`,
  `preaccept-artifact.ts` `observePublished`, `delivery-receipt.ts` `openFailure`/`errnoOf` 모두
  ENOENT만 absent로 두고 나머지는 unavailable/conflicting. `quota-observe.mjs`에서 봉인 디렉터리가
  BROKER_UNAVAILABLE(0 아님), `receipt-observe.mjs`에서 EACCES가 unavailable(absent 아님) 확인.
- **quota (공격 5).** `reserve`/`admit`는 음수·비안전정수 거부(quota.ts:106,120), 오버플로 시
  QUOTA_EXCEEDED(:135), 하드링크는 `dev:ino` Set으로 1회만 계상(:41), 심볼릭 링크는 미추적(lstat),
  release는 `releaseOnce`로 이중 반납 방지(admission.ts:31), headroom `overCapSettlements`도 동일.
  `quota-observe.mjs`로 하드링크 1회 계상·심볼릭 미추적·MAX/음수 경계 확인.
- **delivery-receipt 해석 (공격 6, P0-1/DR9).** `checkReceipt`(delivery-receipt.ts)는 incarnation을
  attempt range [first,last]로만 허용하고, schemaVersion/adapterRevision/batchId/actor/messageIds를
  frozen batch와 정확히 비교. 0바이트·잘린 JSON·mode≠0600·wrong messageId·범위 밖 incarnation은
  모두 `conflicting`(hold)로, 관측 실패는 `unavailable`(hold)로, 진짜 ENOENT만 `absent`(present).
  현재 권한(현재 lease)이 아니라 batch의 attempt range로 판정하므로 새 incarnation이 과거 receipt
  의미를 바꾸지 않음. `receipt-observe.mjs`로 8개 경계 전부 확인.
- **TOCTOU/symlink (공격 3).** `contained-fs.ts` `openBeneath`가 openat2 RESOLVE_BENEATH|
  RESOLVE_NO_SYMLINKS(0x0c)로 커널 봉쇄, `withinDirectory`가 부모를 한 번만 resolve하고 held fd로만
  entry 지정. link/rename/unlink는 모두 `entryAt(parent,...)`=procfs fd 경로. openat2 부재 시
  UNSUPPORTED_PROFILE로 fail-closed(:79). 같은 UID in-place 쓰기·삭제는 명시적 비보장(각 헤더).
- **context-stream 경계 (공격 7).** `ContextTextValidator`(context-policy.ts)가 fatal UTF-8 decoder를
  stream 모드로 써 chunk 경계의 불완전 code point를 보존하고 finish()에서 flush 시 throw로 비UTF-8
  거부. 제어문자 blacklist, 매우 긴 줄은 총 bytes 한계로 bound(별도 줄 길이 제한 없음이 정책).
  `prepareContextStream`이 chunk당 declared bytes 초과·EOF 조기·aggregate digest 불일치를 STREAM_INVALID로.
- **tree-lease (공격 8).** `TreeLease`는 flock(LOCK_EX|LOCK_NB)으로 open file description에 락을 걸어
  프로세스·자식 전부 종료 시에만 free(leaf.ts:204). pid에 의존하지 않으므로 pid 재사용 무관, 시계 무관.
  `treeQuiescence`/`collectLeasedTree`가 contended→active, failed→unknown, ENOENT(리스 없음)→unknown으로
  분류(tree-lease.ts). 잔재 tree는 lock이 free일 때만(=makers 전부 사망) 제거.
- **preaccept 소유 (공격 2, P0-4).** `PreacceptArtifact.discardUnaccepted`는 identity==null이고
  knownAbsent 아니면 REF_STATE_UNKNOWN(삭제 안 함), identity-mismatch면 retain. `PreacceptScope.settle`은
  outcome-unknown이면 retainForOperation. `PreparedContextTree`는 lease가 free일 때만 tree 제거.
  DB 불확실은 삭제를 authorize하지 않음(settleByAcceptance catch).

## 6. 확인하지 못한 것

- G01-02(receipt 디렉터리 ENOENT 승격)의 실제 삭제 재현은 실행하지 않고 추론으로 둠. 같은 UID 삭제는
  제품 봉쇄 모델 밖이라 실행 가치가 낮다고 판단.
- G01-03의 새 호출부 오판은 현재 도달 불가라 실행하지 않음(기존 test가 corrupt 판정 자체는 검증).
- `openBeneath`의 openat2 native(koffi) 경로는 x64/arm64 Linux에서만 동작. 실행 환경에서는 동작 확인됨
  (repro 3종 모두 정상 실행). 다른 커널/아키텍처의 fail-closed는 코드상 확인(UNSUPPORTED_PROFILE)만 함.
- 게시 순서의 실제 SIGKILL(프로세스 강제 종료) 주입은 durability fault seam(모의 crash)으로 대체 확인.
  실제 kernel-level SIGKILL 시험은 P0-7 소관이며 이 검토 범위 밖(build/test 금지).
