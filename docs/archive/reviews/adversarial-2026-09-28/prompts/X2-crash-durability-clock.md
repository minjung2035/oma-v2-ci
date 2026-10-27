# X2-crash-durability-clock (교차 영역 감사)

먼저 `review/adversarial-2026-09-28/AUDIT-BRIEF.md`를 전부 읽고 규칙을 절대적으로 따른다(코드 수정 금지, npm build/test 금지, systemctl/sudo 금지, `review/adversarial-2026-09-28/` 밖에 쓰기 금지). 그다음 `PRIORITY-0.md`와 `implementation/durable-boundaries.json`을 읽는다.

주제: 파일 단위가 아니라 패턴 단위로 `src/` 전체를 훑는다. 패턴으로 후보를 찾은 뒤, 후보마다 그 함수 전체와 호출자를 읽고 판정한다. grep 결과만으로는 판정하지 않는다.

## 출발점 (확인된 것. 다시 보고하지 말고, 같은 모양의 다른 자리를 찾는다)

- (a) `src/platform/host/archive-crypto.ts:38` encryptArchive는 최종 경로에 O_EXCL로 직접 쓰고, 실패해도 파일을 지우지 않는다. `service.ts:143`은 `existsSync(target)`를 완성 증거로 쓴다. 그래서 crash나 ENOSPC 뒤의 부분 파일이 성공으로 반환된다(G12-01).
- (b) `src/platform/guest/stream.ts:103-104`: socket data listener 안의 writeSync가 던지면 uncaughtException이 되어 guesthost가 죽는다(G13-01).
- (c) `src/storage/staged-tree.ts:84`: symlink temporary가 회수되지 않는다(G01r2-02).
- (d) `src/broker.ts:459-475` openRun: incarnation commit 뒤 transaction 밖에서 listenActor를 부른다(G03-r2-01).

## 패턴

1. **존재를 완성의 증거로 쓰는 곳.** `existsSync`/`statSync`/`lstat`/`access` 결과로 "이미 있다·이미 했다"를 판정해 효과를 건너뛰는 자리. 그 파일이 부분 상태로 존재할 수 있는가?
2. **최종 경로에 직접 쓰는 곳.** `writeFileSync`, `openSync(w|O_CREAT)`, `createWriteStream`, `copyFileSync`, replace하는 `renameSync`, `appendFileSync`가 `src/storage/durable-fs.ts`·`immutable-file.ts`의 primitive(temp → fsync → no-replace publish → dir fsync)를 거치지 않는 자리를 모두 나열한다. 각각이 durable fact인지, 파생·캐시인지 판정한다.
3. **이벤트 콜백 안의 동기 throw.** `.on("data"|"end"|"close"|"message"|"exit")`, `setTimeout`/`setInterval`, `process.nextTick`, stream transform 콜백 안에서 잡히지 않고 던질 수 있는 syscall(writeSync, fsyncSync, renameSync, JSON.parse)이 있어 프로세스를 죽이는 곳. 각 entry(`src/entry/*.ts`)에 uncaughtException/unhandledRejection 처리가 있는지와 그 정책도 본다.
4. **fire-and-forget promise.** `void promise`, `.catch` 없는 async 호출, `.then(a)`만 있고 거부 처리가 없는 곳. 그 실패가 unknown을 삼키는가?
5. **여러 단계 효과 중간의 실패.** DB commit → 파일 게시 → 뷰 갱신 → 응답처럼 단계가 이어지는 모든 mutation 경로(`src/broker/public-dispatcher.ts`, `internal-dispatcher.ts`, `src/lifecycle/*`, `src/git/*`, `src/mail/*`, `src/config/generations.ts`, `src/runtime/provision.ts`). 두 번째 단계가 실패하면 첫 단계의 사실이 어떻게 해석되는가(P0-4, P0-5)? 복구 경로가 그 중간 상태를 찾아내는가?
6. **시계.** `Date.now()`, `new Date()`, `mtime`, `performance.now()`, `process.hrtime`를 쓰는 모든 자리를 분류한다: 기록용 / 순서·정렬 판단 / 기한·만료·backoff / id 생성. 순서와 기한에 벽시계를 쓰는 곳에서 시계 역행·점프(NTP, suspend, VM 복원 — macOS hidden VM은 suspend/resume이 흔하다)가 무엇을 망가뜨리는가? `setTimeout`에 음수·NaN·2^31 초과 값이 들어갈 수 있는가(Node는 2147483647ms를 넘으면 1ms로 바꾼다)?
7. **자원 고갈.** EMFILE·ENOSPC·EAGAIN이 났을 때 FD와 자식 프로세스, 임시 파일이 반납되는가? 무한 성장하는 Map·Set·배열·listener가 있는가(connection별, request별, agent별로 등록만 하고 지우지 않는 곳)? 재시도 루프에 상한이 있는가?

가능한 것은 `review/adversarial-2026-09-28/repro/X2-crash-durability-clock/` 아래 .mjs로 `dist/src/...`를 import해 실제로 재현한다(fault는 monkeypatch, 시계는 `Date.now` monkeypatch, 임시 파일은 mkdtemp). 이미 다른 그룹 보고서(`review/adversarial-2026-09-28/groups/*.md`)에 같은 코드 경로가 있으면 새 ID를 만들지 말고 "기존 ID와 같음"이라고 적는다.

## 산출물

`review/adversarial-2026-09-28/groups/X2-crash-durability-clock.md`(AUDIT-BRIEF 형식). §1 커버리지는 "패턴별 후보 목록 표(파일:줄, 판정, 근거)"로 대신한다. 후보를 빠짐없이 표에 넣는다. 최종 응답은 짧게.
