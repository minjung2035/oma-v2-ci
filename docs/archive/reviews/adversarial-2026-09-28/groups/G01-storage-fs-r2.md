# G01-storage-fs-r2 적대적 검증 결과 (2차 독립 감사)

검토 대상 HEAD `070a52d` (`feat/macos-hidden-vm`). 코드 수정·`npm build`·`npm test` 실행 없음.
재현 스크립트는 `review/adversarial-2026-09-28/repro/G01-storage-fs-r2/` 아래에서 `dist/src/...`를
import하여 실제 실행했다. 1차 보고(`groups/G01-storage-fs.md`)는 이 감사를 끝낸 뒤에 열어 §7에서 비교했다.

## 1. 커버리지 (증명)

시작 시 `wc -l`로 실제 줄 수를 얻고, 각 파일을 `read` offset/limit로 **마지막 줄까지** 읽었다.
"마지막 줄" 열은 `wc -l` 값이 가리키는 마지막 물리 줄과 그 앞 20자다.

| 파일 | 줄 수(wc -l) | 전부 읽음 | 마지막으로 읽은 줄 N · 내용 앞 20자 |
|---|---|---|---|
| src/durable.ts | 428 | 예 | 428 `        ? "integrate ` (`operationResultRelationCheck` 끝) |
| src/storage/durable-fs.ts | 359 | 예 | 359 `  finally { if (typeo` (`fsyncTree` 끝) |
| src/storage/immutable-file.ts | 216 | 예 | 216 `}` (`publishImmutableFile` finally 끝) |
| src/storage/directory.ts | 95 | 예 | 95 `}` (`removeOwnedFile` 끝) |
| src/storage/contained-fs.ts | 197 | 예 | 197 `}` (`withinDirectory` 끝) |
| src/storage/paths.ts | 119 | 예 | 119 `}` (`isActorSocketPathFor` 끝) |
| src/storage/quota.ts | 139 | 예 | 139 `}` (`StorageAdmission.check` 끝) |
| src/storage/staged-tree.ts | 105 | 예 | 105 `}` (`replaceDerivedSymlink` 끝) |
| src/storage/tree-lease.ts | 98 | 예 | 98 `}` (`collectLeasedTree` finally 끝) |
| src/storage/submit-spool.ts | 161 | 예 | 161 `}` (`requireFrozenBundle` 끝) |
| src/storage/preaccept-artifact.ts | 233 | 예 | 233 `}` (`settleByAcceptance` 끝) |
| src/storage/context-files.ts | 61 | 예 | 61 `}` (`readContextEntry` 끝) |
| src/storage/context-snapshot.ts | 95 | 예 | 95 `}` (`publishContextRevision` 끝) |
| src/storage/context-stream.ts | 210 | 예 | 210 `}` (`prepareContextStream` finally 끝) |
| src/storage/diagnostic-snapshot.ts | 20 | 예 | 20 `  maxRows: 10000, max` (`DIAGNOSTIC_READ_LIMITS`) |
| src/storage/batch-view.ts | 18 | 예 | 18 `}` (`publishBatchView` 끝) |
| src/storage/delivery-receipt.ts | 460 | 예 | 460 `}` (`publishDeliveryReceipt` finally 끝) |

특히 공격 지시된 구간을 모두 읽었다: delivery-receipt.ts 345–460(`deliveryDecision`·
`requireVerifiedReceipt`·`readDeliveryReceipt`·`isBoundaryEntry`·`makeBoundaryDurable`·
`publishDeliveryReceipt`), context-stream.ts 175–210(스트림 loop 종료·EOF 검증·cleanup·finally),
durable.ts 371–428(`operationResultRelationCheck` 후반: submit/integrate/context.publish),
preaccept-artifact.ts 216–233(`settleByAcceptance`), contained-fs.ts 178–197(`withinDirectory`).

의존 파일도 읽음(판정 대상 아님): src/leaf.ts(`lockFileDescriptor`),
src/domain/errors.ts(`unobserved`, `ANSWERED_ERRNO`), src/domain/context-policy.ts
(`ContextTextValidator`), src/domain/identifiers.ts(id 문법), src/runner.ts(`consume`),
src/mail/batches.ts(`settleFromReceipt`), src/broker.ts(`settlePreviousIncarnation`).

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G01r2-01 | Medium | persistence | 확정된 receipt의 의미가 비-receipt 세션 파일의 존재에 매인다(rollover 정산 전 창) | confirmed |
| G01r2-02 | Low | resource | `replaceDerivedSymlink`의 crash 잔재 temporary는 어떤 게시로도 회수되지 않는다 | confirmed |
| G01r2-03 | Info | authority/ownership | receipt 디렉터리 ENOENT의 `present` 승격(같은 UID 삭제, S-06 밖) | high |

High 이상 발견 없음.

## 3. 발견 상세

### G01r2-01 확정된 receipt의 의미가 비-receipt 세션 파일에 매인다
- 심각도: Medium
- 분류: persistence
- 위반 규칙: P0-1(확정된 사실을 나중 관측이 다르게 해석), P0-5(관측 실패/부재를 hold로 두는 것은
  맞으나, receipt는 이미 durable한 사실인데 그 판정이 별도 파일에 의존)
- 코드 경로: `src/storage/delivery-receipt.ts:144`(`sessionPathCheck`; :152
  `return fstatSync(fd).size > 0 ? null : bad;`, :159 ENOENT→`session-absent`/`conflicting`) →
  `checkReceipt`(:165, :185에서 `sessionPathCheck` 호출) → `observeDeliveryReceipt`(:247) →
  `deliveryDecision`(:306, `conflicting`→`hold`/BATCH_CONFLICT) →
  `src/mail/batches.ts:137`(`row.state === "completed"` 조기 반환) / :143-145(미완료 시 재관측)
- 원인: receipt는 `publishDeliveryReceipt`가 no-replace로 게시하고 부모를 flush한 **durable
  fact**다. 그런데 그 receipt를 다시 읽을 때 `checkReceipt`가 receipt가 이름하는 세션 `.jsonl`
  파일이 지금도 존재하고 `size > 0`인지 검사한다. receipt 게시와 `completeBatch` 트랜잭션 사이에서
  프로세스가 죽고(정상 crash 경계), 그 사이 엔진이 세션 파일을 회전/삭제하면, 다음 rollover의
  `settleFromReceipt`가 batch를 아직 `completed`로 못 봤으므로 receipt를 재관측한다 →
  `session-absent`→`conflicting`→`hold`(BATCH_CONFLICT). batch는 `prepared`로 영구히 남고,
  이후 모든 rollover가 같은 BATCH_CONFLICT를 던진다(운영자 수리 전까지 정지). receipt bytes는
  그대로지만 그것을 읽는 규칙이 "나중의 세션 파일 상태"에 기대어 다른 결론을 낸다 —— 명제 위반의
  전형.
- 영향: 이미 durable하게 확정된 delivery boundary가, OMA가 boundary flush 이후 수명을 소유한다고
  보증하지 않는 별도 파일(엔진 세션)이 사라졌다는 이유로 정산 불가 상태가 된다. `completeBatch`가
  성공한 뒤(batch `completed`)에는 :137의 조기 반환이 재관측을 건너뛰므로 안전하다. 위험 창은
  "receipt durable + batch 미완료"의 crash 사이다.
- 최소 반례: incarnation=3 batch에 대해 `completeSession`으로 세션+boundary 작성 →
  `publishDeliveryReceipt` 성공 → (completeBatch 전 crash 모사) 세션 `.jsonl` `unlink` →
  attempts {first:3,last:4}로 재관측.
- 재현 방법: `repro/G01-storage-fs-r2/session-gone-downgrade.mjs`.
  관측 출력: `before rotation: settle` / `after rotation: hold BATCH_CONFLICT` /
  `CONFIRMED: a durable receipt flips verified->hold(BATCH_CONFLICT) when the session file is gone`.
- 확신도: confirmed
- 개선 방향(코드 수정 아님): 두 가지 중 하나를 owner 결정으로 명시. (a) receipt가 durable해진
  순간부터 세션 파일의 지속을 OMA가 소유한다고 명문화하고(DR11/BATCH-006이 boundary flush를
  하므로 근거 있음) `validation.md` "알려진 한계"에 "세션 파일 삭제 시 receipt는 conflicting으로
  보존"을 0.85.1 adapter 항목과 나란히 적는다. (b) 이미 durable한 receipt의 재판정은 세션 파일
  재검사에서 분리해, 세션 부재를 conflicting이 아니라 "이미 확정된 boundary, 세션은 관측 대상
  아님"으로 두는 판정을 `deliveryDecision` owner에 둔다. 현재는 이 결정이 코드에만 있고
  "알려진 한계"에 명시적으로 없어 P0-5의 "OMA가 소유하지 않는 사실을 gate로 쓰지 않는다"와
  경계가 모호하다.

### G01r2-02 `replaceDerivedSymlink`의 crash 잔재 temporary는 회수되지 않는다
- 심각도: Low
- 분류: resource
- 위반 규칙: 없음(P0-4 소유 모델의 공백)
- 코드 경로: `src/storage/staged-tree.ts:90`(`.${name}.${randomUUID()}.tmp`로 temporary symlink
  생성) → `symlinkSync`(:91) → `renameSync`(:94). `collectDeadTemporaries`(durable-fs.ts) 호출
  없음, flock 없음.
- 원인: 이 함수의 temporary 이름 문법은 `durable-fs.ts`의 `TEMPORARY` 정규식과 같지만,
  `publishNoReplace`/`replaceDerivedFile`/`publishImmutableFile`/`publishDeliveryReceipt`와 달리
  (1) temporary를 flock으로 잠그지 않고 (2) 게시 시작 시 `collectDeadTemporaries`를 부르지 않는다.
  `symlinkSync`와 `renameSync` 사이에서 죽으면 `.<name>.<uuid>.tmp` symlink가 영구히 남는다.
  같은 이름을 다시 게시하는 경로 역시 `replaceDerivedSymlink`(collect 없음)이므로 절대 회수되지
  않는다. 설령 그 이름을 `replaceDerivedFile`이 게시하더라도 그 함수의 `collectDeadTemporaries`는
  잔재를 `O_NOFOLLOW`로 열다 ELOOP로 건너뛴다(회수 대상은 regular file temporary 전제).
- 영향: 대상은 context `current` 포인터(고정 단일 이름) 하나뿐이고 잔재는 작은 symlink라 실효
  영향은 미미. 사실의 의미는 바뀌지 않는다(current는 rename no-replace가 아니라 파생 교체이고 최종
  이름은 오염되지 않음). crash당 잔재 1개 누적, 회수 owner 부재.
- 최소 반례: crash 후 상태(`.current.<uuid>.tmp` symlink 잔존)를 직접 만들고 같은 디렉터리에서
  후속 게시가 회수하지 못함을 관측.
- 재현 방법: `repro/G01-storage-fs-r2/symlink-temp-leak.mjs`.
  관측 출력: `orphan temp before: [ '.current.<uuid>.tmp' ]` / `... after publish of same name:
  [ '.current.<uuid>.tmp' ]` / `CONFIRMED: orphan temp symlink ... never collected`.
- 확신도: confirmed
- 개선 방향(코드 수정 아님): `replaceDerivedSymlink`도 다른 파생 교체처럼 시작 시 잔재 회수 owner를
  갖는지, 아니면 이 포인터의 잔재를 시작 복구가 이름별로 지우는지 상위 복구 경로에서 재확인.

### G01r2-03 receipt 디렉터리 ENOENT의 `present` 승격
- 심각도: Info
- 분류: authority/ownership
- 위반 규칙: 없음(문서화된 S-06/같은-UID 비보장)
- 코드 경로: `src/storage/delivery-receipt.ts:264-272`(receipts 디렉터리 open이 ENOENT이고
  runner root(`dirname(dirname(path))`)가 열리면 `{ kind:"absent", missing:"receipt-directory" }`)
  → `deliveryDecision`(:308) `present`(다시 제시).
- 원인/영향: receipt 디렉터리는 첫 receipt 게시 때 durable하게 생긴다. 그 뒤 같은 UID 프로세스가
  디렉터리를 지우면 관측이 `absent`가 되어 이미 전달된 batch가 재제시 판정을 받는다. 단
  `openFailure`(:103)가 ENOENT 외 errno(EACCES/EIO 등)는 모두 `unavailable`로 두므로 승격은 진짜
  ENOENT에서만 일어난다. 같은 UID in-place 삭제는 openat2 봉쇄(경로 탐색만) 밖이며 각 파일 헤더가
  명시.
- 재현 방법: 추론만. `repro/.../session-gone-downgrade.mjs`가 동일 관측 함수의 정상/충돌 분기를
  실행해 판정 경로가 살아있음을 보인다.
- 확신도: high
- 개선 방향: 없음(S-06/같은-UID 명시적 비보장). `validation.md` 서술과 일치 확인 권장.

## 4. 리팩터링 필요 지점

없음. 이 층은 P0-2(한 owner) 관점에서 잘 정리되어 있다: 파일 게시 순서는 `durable-fs.ts`의 소수
primitive에만 있고, receipt 해석은 `deliveryDecision` 한 함수가 모든 소비자(runner.consume,
principal-delivery, batches.settleFromReceipt)에게 같은 판정을 준다. 다만 G01r2-01·G01r2-02는
"receipt의 세션 의존"과 "파생 symlink 교체의 회수 owner"라는 두 결정이 코드에만 있고 문서 owner에
명시되지 않은 지점이다(리팩터링이 아니라 결정 명문화).

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **게시 순서 모든 단계 사이 SIGKILL (durable-fs.ts).** `writeExclusiveFsyncedEntry`(:137)와
  `publishOnce`(:226)는 create(O_CREAT|O_EXCL|O_NOFOLLOW) → write → file fsync → link(no-replace)
  → temp unlink → parent fsync. 주입 fault는 `isDurabilityFault` 분기로 정리
  경로를 절대 타지 않는다(진짜 crash처럼). link EEXIST는 "existing"으로 흡수, ENOENT는
  collector가 가져간 것으로 보고 "restart". `publishNoReplace`(:159)는 최대 3회 재시도 후
  INTERNAL_ERROR.
- **rename 성공 뒤 parent fsync 실패.** `replaceDerivedFile`(:285)은 rename 성공(`renamed=true`)
  뒤 fsync가 실패해도 `cleanupAfterFailure`를 부르지 않고(`if (!renamed)` 가드) 에러를 그대로
  던진다 —— 다운그레이드 없음. `durable-fs.ts:282` 주석("A post-rename flush failure does not
  prove that")과 `staged-tree.ts:23-24` 주석이 "post-rename error is ambiguous, never permission
  to overwrite"를 명시.
- **EXDEV 복사 경로 (immutable-file.ts:150-176).** direct link가 EXDEV면 locked temporary에
  original.bytes를 쓰고 fsync·hash 재검증 후 link. link EEXIST는 흡수(idempotent), 성공 후
  finally에서 temporary만 unlink(이중 unlink 없음, `crashed` 가드 :202). destination은 항상
  `checkedBytes(published, original.hash)`로 재검증(:180).
- **부분 쓰기(0바이트/잘린 파일)를 absent/corrupt로 승격하는가.** receipt: `readBoundedFd`가
  `size < 1`을 `conflicting/receipt-not-private-regular`(:109)로 —— absent 아님. immutable:
  `checkedBytes`가 truncated를 STORE_CORRUPT(:66), grew를 STORE_CORRUPT(:71). context-files:
  `readFrozenLength`가 조기 EOF를 truncated STORE_CORRUPT(:29). 0바이트는 "손상"이지 "없음"이 아님
  —— P0-5 부합.
- **unknown→사실 승격 (DR13, errors.ts).** `ANSWERED_ERRNO`={ENOENT,ENOTDIR,ELOOP,EISDIR,
  ENAMETOOLONG}만 사실. EACCES/EIO/ENOSPC/EMFILE는 `unobserved`→BROKER_UNAVAILABLE. 확인한 자리:
  quota.ts:24(ENOENT만 continue), immutable-file.ts:96(ENOENT만 absent), delivery-receipt.ts:97
  (`openFailure` ENOENT 외 unavailable), submit-spool.ts `observeFrozenBundle`,
  preaccept-artifact.ts `observePublished`. `quota-observe`류 없이도 코드 경로로 확인.
- **receipt의 현재 incarnation 의존 (P0-1, DR9).** `checkReceipt`는 incarnation을 attempt range
  [first,last]로만 허용(:186-190)하고, 현재 lease가 아니라 batch의 range로 판정. `attemptsOf`(:66)가
  range를 안전정수·순서쌍으로 강제. 새 incarnation이 과거 receipt 의미를 바꾸지 않음 —— `settleFromReceipt`가
  range {first: row.incarnation, last: quiescence.incarnation}로 준다(batches.ts:145).
- **여러 receipt 충돌(conflicting) 보존.** conflicting/unavailable은 `hold`이고 receipt를 지우지
  않는다. `publishNoReplace`/receipt link는 EEXIST를 흡수하되 기존 bytes를 덮지 않는다(no-replace).
  `deliveryDecision` 주석(:296)이 "conflicting -> hold: preserve the evidence for repair" 명시.
- **EACCES/EIO/ENOSPC absent 승격 (DR13).** 위 unobserved 확인과 동일. receipt EACCES→unavailable
  (1차 test `receipt-observation.test.ts`도 검증).
- **openat2 미지원 fallback fail-open? (contained-fs.ts).** `syscalls()`(:36)가 non-Linux/비 x64,arm64는
  UNSUPPORTED_PROFILE. `checked`(:63)가 errno 38(ENOSYS)/22(EINVAL)를 UNSUPPORTED_PROFILE로 —— fail-CLOSED.
  `openBeneath`가 RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS(0x0c, :100)로 커널 봉쇄, 18/20/40(EXDEV/ENOTDIR/ELOOP)를
  STORE_CORRUPT. fallback으로 lstat/open 재시도 없음(헤더 명시).
- **TOCTOU(symlink/hardlink/디렉터리 교체).** `withinDirectory`(:180)가 부모를 한 번 resolve하고
  held fd로만 entry 지정, link/rename/unlink 전부 `entryAt(parent,...)`=procfs fd 경로. 두 번째
  resolution 없음. context-files `readContextEntry`(:33)는 open 전후 nlink=1·dev·ino·size·mtime·ctime
  재검사. submit-spool `openVerifiedBundle`도 동일. 같은 UID in-place 쓰기는 명시적 비보장.
- **quota 예약/반납 후불·이중반납 (quota.ts).** `reserve`(:104)는 음수·비안전정수 거부, `releaseOnce`로
  단일 반납(admission.ts). `admit("settle")`의 headroom은 `overCapSettlements`를 1개로 제한(:130) 후
  `releaseOnce`로 감소. 오버플로 시 QUOTA_EXCEEDED(:135). 하드링크는 `dev:ino` Set으로 1회 계상(:40),
  symlink는 lstat로 미추적.
- **tree-lease flock 의미 (tree-lease.ts).** flock(LOCK_EX|LOCK_NB)은 open file description에 락 →
  프로세스·상속 자식 전부 종료 시에만 free(leaf.ts:204). pid 무관, 시계 무관, SIGKILL·전원차단 포함.
  `take` contended→REF_STATE_UNKNOWN(:53), failed→BROKER_UNAVAILABLE(:55). `collectLeasedTree`는
  contended→active(제거 안 함), failed→unknown, held(free)일 때만 tree+lease 제거(:94).
- **context-stream 경계 (context-stream.ts).** `ContextTextValidator`(context-policy.ts:84)가 fatal
  UTF-8 decoder를 stream 모드로 써 chunk 경계의 잘린 멀티바이트를 보존하고 finish()의 flush에서 throw로
  거부. 제어문자 blacklist. 매우 긴 줄은 별도 제한 없이 총 content.bytes 한계로만 bound(정책). chunk당
  declared bytes 초과(:186)·EOF 조기(:194)·aggregate digest 불일치(:196)를 STREAM_INVALID. 스트림 도중
  실패 시 owned 파일을 역순으로 정확 inode만 삭제(:200)하고 identity mismatch면 보존(:206).
  주입 fault면 정리 없이 재던짐(:198, crash 모사).
- **시계 의존.** receipt/immutable/context/bundle의 mtime·ctime 비교는 TOCTOU 감지용이며 durable fact
  판정을 시계에 걸지 않는다. tree-lease·flock은 시계 무관. 이 그룹에 Date.now() 사용 없음(grep 확인).

## 6. 확인하지 못한 것

- G01r2-01의 위험 창(receipt durable + batch 미완료 + 세션 삭제)을 실제 broker rollover 전체 경로로
  구동하지 않고, `observeDeliveryReceipt`/`deliveryDecision` 단위로 재현했다. `settleFromReceipt`의
  `row.state === "completed"` 조기 반환(batches.ts:137)을 코드로 확인했으나 실제 crash-사이-회전 타이밍의
  end-to-end 재현은 build/test 금지로 대체.
- G01r2-03의 실제 디렉터리 삭제 재현은 실행하지 않고 추론으로 둠(같은 UID 삭제는 봉쇄 모델 밖).
- 실제 kernel-level SIGKILL 주입은 P0-7 소관이며 build/test 금지로 durability fault seam(모의 crash)
  으로 대체. `dist/`의 native openat2(koffi)는 이 실행 환경(Linux x64)에서 repro 2종이 정상 동작함으로
  확인.

## 7. 1차 보고와의 차이

### 7.1 커버리지 표: 1차의 줄 수가 17개 파일 전부 틀렸다(확정)

1차 보고 `groups/G01-storage-fs.md` §1의 "줄 수"는 실제 `wc -l`과 모두 다르다. 아래는 (1차 값 → 실제):

| 파일 | 1차 보고 | 실제 wc -l | 차이 |
|---|---|---|---|
| durable.ts | 371 | 428 | −57 |
| durable-fs.ts | 366 | 359 | +7 |
| immutable-file.ts | 235 | 216 | +19 |
| directory.ts | 100 | 95 | +5 |
| contained-fs.ts | 178 | 197 | −19 |
| paths.ts | 133 | 119 | +14 |
| quota.ts | 138 | 139 | −1 |
| staged-tree.ts | 116 | 105 | +11 |
| tree-lease.ts | 108 | 98 | +10 |
| submit-spool.ts | 156 | 161 | −5 |
| preaccept-artifact.ts | 216 | 233 | −17 |
| context-files.ts | 62 | 61 | +1 |
| context-snapshot.ts | 96 | 95 | +1 |
| context-stream.ts | 175 | 210 | −35 |
| diagnostic-snapshot.ts | 22 | 20 | +2 |
| batch-view.ts | 21 | 18 | +3 |
| delivery-receipt.ts | 344 | 460 | −116 |

특히 `delivery-receipt.ts`는 1차가 344로 적었으나 실제 460으로, 게시 순서 핵심인
`makeBoundaryDurable`(388–415)과 `publishDeliveryReceipt`(416–460)를 포함한 116줄을 표에서
누락했다. `context-stream.ts`도 35줄, `durable.ts`도 57줄 차이다. 1차의 "전부 읽음: 예"는 이
표와 모순되며, 커버리지 증명 규칙(AUDIT-BRIEF "읽는 방법") 미준수다.

### 7.2 1차가 놓친 발견

- **G01r2-01(Medium, receipt의 세션 파일 의존).** 1차는 delivery-receipt.ts를 344줄로 보고 게시·
  boundary durable 구간(345–460)을 표에서 누락했고, `sessionPathCheck`가 durable한 receipt의
  재판정을 비-durable 세션 파일에 매는 P0-1 관점의 결정을 발견으로 올리지 않았다. 이 감사는
  `session-gone-downgrade.mjs`로 verified→hold(BATCH_CONFLICT) 전이를 confirmed로 재현했다.
- **G01r2-02(Low, `replaceDerivedSymlink` 잔재 미회수).** 1차 G01-01은 `collectDeadTemporaries`가
  "같은 이름의 다음 게시"에만 묶임을 지적했으나, `replaceDerivedSymlink`가 애초에 collect도 flock도
  하지 않아 잔재가 **어떤 경로로도 회수되지 않는** 더 강한 경우(context current 포인터)는 놓쳤다.
  `symlink-temp-leak.mjs`로 confirmed.

### 7.3 1차 주장 중 재확인·수정

- 1차 G01-02(receipt 디렉터리 ENOENT `present` 승격)와 G01-03(`fsyncTree` 기본 정책이 symlink를
  STORE_CORRUPT로)의 방향은 옳다. 본 감사에서 각각 G01r2-03으로 재확인하고(코드 줄 delivery-receipt.ts
  264–272), G01-03은 현 호출부에서 도달 불가(§5 "context-stream 경계"·fsyncTree 정책 확인)로 같은
  Info 판정에 동의한다.
- 1차 §5의 "게시 순서·unobserved·quota·TOCTOU·tree-lease·preaccept" 판정은 코드 줄 근거가 대체로
  정확하며 본 감사와 일치한다(단, 인용한 줄 번호는 1차의 틀린 파일 길이에 기반해 실제와 어긋난다.
  예: 1차가 "durable-fs.ts:210 collectDeadTemporaries"라 했으나 실제 파일에서 해당 함수는
  다른 줄이다). 즉 1차는 결론은 맞히되 줄 번호 근거가 실제 파일과 어긋나는 항목이 있다.
