# G12-platform-host 적대적 검증 결과

저장소 `/home/dev/oma-v2`, branch `feat/macos-hidden-vm`. macOS가 아니므로 Swift/VZ(main.swift, Package.swift, entitlements)는 추론으로 두고, TypeScript 순수 부분은 `review/adversarial-2026-09-28/repro/G12-platform-host/` 아래 `.mjs`로 `dist/src/...`를 import해 실제 실행했다. 코드는 수정하지 않았다.

## 1. 커버리지

`wc -l` 값은 시작 시 실측했다. 각 파일을 offset/limit로 마지막 줄까지 읽었다.

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막 읽은 줄 · 앞 20자) |
|---|---|---|---|
| src/platform/rpc.ts | 245 | 예 | 245 `  }` (readLeadingFrame 끝 닫는 괄호) |
| src/platform/product-text.ts | 25 | 예 | 25 `}` (productText 끝) |
| src/platform/terminal-modes.ts | 38 | 예 | 38 `}` (TerminalModes 끝) |
| src/platform/host/archive-crypto.ts | 90 | 예 | 90 `}` (decryptArchive 끝) |
| src/platform/host/attach-client.ts | 122 | 예 | 122 `}` (attachTerminal 끝) |
| src/platform/host/egress.ts | 136 | 예 | 136 `}` (EgressHost 끝) |
| src/platform/host/guest-link.ts | 78 | 예 | 78 `}` (GuestLink.bytes 끝) |
| src/platform/host/host-api.ts | 165 | 예 | 165 `}` (serve 끝) |
| src/platform/host/image.ts | 80 | 예 | 80 `}` (bootableWith 끝) |
| src/platform/host/keychain.ts | 70 | 예 | 70 `}` (keychainCredentials 끝) |
| src/platform/host/lifecycle.ts | 200 | 예 | 200 `}` (afterCrash 끝) |
| src/platform/host/peer.ts | 21 | 예 | 21 `}` (peerUid 끝) |
| src/platform/host/project.ts | 116 | 예 | 116 `}` (getStream 끝) |
| src/platform/host/record.ts | 66 | 예 | 66 `}` (writeHostRecord 끝) |
| src/platform/host/resolver.ts | 18 | 예 | 18 `}` (hostResolver 끝) |
| src/platform/host/service.ts | 155 | 예 | 155 `}` (HostService 끝) |
| src/platform/host/snapshot.ts | 90 | 예 | 90 `}` (pruneSnapshots 끝) |
| src/platform/host/vz-driver.ts | 132 | 예 | 132 `close(): void { ...` (VzDriver.close) |
| src/entry/oma-mac.ts | 72 | 예 | 72 `});` (main().catch 끝) |
| src/entry/omahostd.ts | 87 | 예 | 87 `main().catch(...)` |
| platform/host/vmhelper/Sources/oma-vmhelper/main.swift | 322 | 예 | 322 `RunLoop.main.run()` |
| platform/host/vmhelper/Package.swift | 14 | 예 | 14 `)` (Package 끝) |
| platform/host/vmhelper/oma-vmhelper.entitlements | 14 | 예 | 14 `</plist>` |

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G12-01 | High | persistence | archive 게시가 원자적이지 않다: crash 뒤 부분 파일이 `existsSync`로 완성본 취급 | confirmed |
| G12-02 | Medium | persistence | snapshot `publish`가 partial의 fsync·디렉터리 fsync 없이 rename | high |
| G12-03 | Medium | authority/ownership | omahostd에 host 단일화 lock이 없어 두 프로세스가 같은 state.img를 잡을 수 있다 | medium |
| G12-04 | Low | recovery | `pruneSnapshots`가 mtime(벽시계)으로만 정렬해 동률·역행에 취약 | medium |
| G12-05 | Low | boundary | attach 종료 시 alternate/paste/cursor 외 DEC 모드(마우스 추적 등)는 복구되지 않는다 | high |
| G12-06 | Info | boundary | archive nonce의 chunk index가 UInt32라 2^32 chunk에서 GCM nonce 재사용 | low |
| G12-07 | Info | structural | 모든 byte 채널이 `portOf`에서 society 포트(701)로 접힌다 | high |

## 3. 발견 상세

### G12-01 archive 게시가 원자적이지 않다: crash 뒤 부분 파일이 완성본으로 취급
- 심각도: High
- 분류: persistence
- 위반 규칙: P0-5(불완전=unknown을 success로 승격), P0-4(accept 전 artifact ownership)
- 코드 경로: `src/platform/host/archive-crypto.ts:38`(`openSync(outPath, O_WRONLY|O_CREAT|O_EXCL)` — 최종 경로에 직접 쓰고 fsync만, temp+rename 없음) → `src/platform/host/service.ts:143`(`if (!existsSync(target)) encryptArchive(plain, target, ...)`)
- 원인: `encryptArchive`는 임시 파일에 쓴 뒤 rename하지 않고 최종 `target`(`<society>-<sha16>.omaarchive`)에 O_EXCL로 직접 기록한다. `writeSync` 루프 중 SIGKILL/ENOSPC가 오면 `target`에는 매직·일부 chunk만 있는 **잘린 파일**이 남는다. `service.ts`의 archive 경로는 같은 key로 재시도될 때 `existsSync(target)`가 true면 암호화를 건너뛰고 `{ ...made, path: target }`을 **성공**으로 돌려준다. 즉 durability가 unknown인 부분 산출물이 완성된 archive로 승격된다.
- 영향: Human이 성공으로 받은 archive가 복호화되지 않는다(MAC-621의 "at rest 암호화 archive"가 실제로는 열리지 않음). 부분 파일은 accept 전에 정리되지 않고(P0-4) 이후 재시도의 no-op fence가 되어 영구히 깨진 상태로 고정된다.
- 최소 반례: `archive.create(key=K, society=S)` 실행 중 `encryptArchive`의 두 번째 `writeSync` 직후 프로세스가 죽는다 → `target` 존재하나 잘림. 다음 `archive.create(key=K, society=S)` → `existsSync(target)=true` → 암호화 skip → 성공 반환. `decryptArchive(target)`는 `STREAM_INVALID`("the archive is damaged").
- 재현 방법: `node review/adversarial-2026-09-28/repro/G12-platform-host/archive-publish-gap.mjs`. 관측: `PASS partial file exists at final path` / `PASS service guard SKIPS re-encryption (bug)` / `PASS partial archive fails to decrypt (yet reported as success)`.
- 확신도: confirmed(부분 파일→existsSync skip→복호화 실패를 실행으로 확인). 실제 SIGKILL 대신 truncate로 crash 산출물을 모사했다.
- 개선 방향: record.ts처럼 temp(`.partial`)에 쓰고 fsync → rename → 디렉터리 fsync로 게시하거나, 게시 완료 여부를 파일 존재가 아니라 검증된 완결(끝 chunk의 last=true tag 확인)로 판정한다. `existsSync` 건너뛰기는 "완성 확인" owner 하나로 대체한다.

### G12-02 snapshot `publish`가 fsync 없이 rename
- 심각도: Medium
- 분류: persistence
- 위반 규칙: P0-7(durable 경계 직후 kill 내구성), P0-4
- 코드 경로: `src/platform/host/snapshot.ts:36-42`(`publish`: `renameSync(partial, final)` 앞에 partial fsync 없음, rename 뒤 디렉터리 fsync 없음)
- 원인: `record.ts:writeHostRecord`는 fd fsync + 디렉터리 fsync를 하지만, snapshot의 `publish`는 clone(`copyFileSync FICLONE`) 뒤 곧바로 `renameSync`만 한다. clone 데이터나 rename 방향 엔트리가 물리적으로 내려가기 전 전원 차단 시, `<id>.img`가 존재하지만 내용/링크가 durable하지 않을 수 있다.
- 영향: 각 snapshot은 고유 `<id>.img`라 **이전 snapshot을 덮지 않으므로** "이전 스냅샷 손실"은 일어나지 않는다(그 벡터는 막혀 있다, §5). 그러나 방금 만든 snapshot 자체는 crash 뒤 소리 없이 사라지거나 부분 상태로 남을 수 있고, 그 파일을 나중에 복원원본으로 믿으면 위험하다. APFS FICLONE의 메타데이터 내구성은 파일시스템 특성에 의존한다.
- 최소 반례: `snapshotStopped(store, id)` → clone → rename 성공 직후, 디스크 캐시 flush 전 전원 차단. 재부팅 후 `<id>.img`가 0바이트/부분이거나 부재.
- 재현 방법: 추론만(전원 차단·fsync 순서는 Linux unit로 재현 불가, macOS APFS clonefile 필요). 코드 상 fsync 부재는 snapshot.ts:36-42 대 record.ts:60-64 대조로 확정.
- 확신도: high(코드 대조로 fsync 부재 확정, 물리 효과는 미실행)
- 개선 방향: `publish`에서 partial(및 clone 대상) fsync 후 rename, rename 뒤 `store.dir` 디렉터리 fsync. record.ts의 게시 절차를 공통 owner로 뽑아 재사용(P0-2).

### G12-03 omahostd 단일화 lock 부재
- 심각도: Medium
- 분류: authority/ownership
- 위반 규칙: P0-4(자원 owner 유일성), P0-2
- 코드 경로: `src/entry/omahostd.ts:39-86`(디렉터리 생성·record·VzDriver.launch·HostService.start 어디에도 run dir flock/singleton 없음). 대조: Linux broker는 `runtime/process-lock.ts`·`entry/broker.ts:65`에서 society singleton lock을 잡는다.
- 원인: 같은 `OMA_HOST_HOME`을 가리키는 두 번째 `omahostd`를 막는 프로세스 lock이 없다. launchd가 LaunchAgent를 세션당 하나로 유지한다는 가정에만 의존한다. 코드로 강제되지 않는다(테스트·수동 실행·다른 세션에서 두 개 기동 가능).
- 영향: 두 omahostd가 각자 VzDriver 헬퍼를 띄우고 같은 `vm/state.img`를 `readOnly:false`로 붙이면 두 VM이 한 디스크를 동시에 쓴다(state 손상). 또한 두 헬퍼가 같은 `run/vm/port-<n>.sock`에 `unlink` 후 bind(main.swift PortBridge init:`unlink(path)`)하므로 나중 프로세스가 앞 프로세스의 소켓을 가로챈다. host-record의 `record()`(service.ts:82-85, omahostd.ts:78-81)는 read-modify-write에 lock이 없어 lost update가 난다.
- 최소 반례: 같은 HOME으로 `omahostd --bundle A` 두 번 실행(예: launchd 밖에서). 둘 다 state.img를 쓰기 모드로 attach.
- 재현 방법: 추론만(VM/헬퍼는 macOS 전용, Swift NOT_BUILT). 코드에서 lock 획득 지점 부재를 grep(`flock|process-lock`)으로 확인 — omahostd/host는 결과에 없음.
- 확신도: medium(단일화가 순수 launchd 가정이라 코드 경계로는 열려 있음. macOS 실기동 미확인)
- 개선 방향: run dir에 `process-lock.ts`류 flock을 omahostd 시작 초입에 잡고, 잡지 못하면 거절. state.img/포트 소켓/record write를 그 lock 아래로 둔다.

### G12-04 pruneSnapshots가 벽시계 mtime으로만 정렬
- 심각도: Low
- 분류: recovery
- 위반 규칙: 없음(견고성)
- 코드 경로: `src/platform/host/snapshot.ts:77-78`(`statSync(...).mtimeMs`로 내림차순 정렬)
- 원인: "newest keep 유지"를 mtime으로 판단한다. APFS clonefile이 원본 mtime을 물려주거나 같은 초에 두 snapshot이 생기면 동률이 되어 정렬이 불안정하고, 시스템 시계 역행 시 새 snapshot이 "오래된" 것으로 분류될 수 있다.
- 영향: 보존해야 할 최신 snapshot이 지워지고 오래된 것이 남는 오분류. `protect` 집합 밖에서만 지우므로 update 중 snapshot은 안전하나, 일반 keep 정책이 어긋난다.
- 최소 반례: 같은 mtimeMs를 가진 두 `.img`, keep=1 → 어느 쪽이 남는지 미정의.
- 재현 방법: 추론만(정렬 근거 줄 확인). 
- 확신도: medium
- 개선 방향: id에 단조 증가 순번/생성 시각을 담아 이름으로 정렬하거나, 게시 순서를 durable하게 기록해 mtime에 의존하지 않는다.

### G12-05 attach 종료 시 일부 DEC private 모드 미복구
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음(MAC-222 범위, DR18 수용)
- 코드 경로: `src/platform/terminal-modes.ts:20-24`(`feed`가 1049/1047/47·2004·25만 추적) → `attach-client.ts:118`(`output.write(modes.undo())`)
- 원인: guest 세션이 마우스 추적(`?1000/1002/1003/1006h`), bracketed 외 모드, 동기 출력(`?2026h`) 등을 켜두고 detach되면 `undo()`가 이를 되돌리지 않는다. 문서상 "화면 내용은 프로그램이 다시 그린다"로 범위를 좁혔다(주석 terminal-modes.ts:8).
- 영향: detach 후 Mac 터미널에 마우스 추적 등이 남아 클릭이 escape 시퀀스로 보이는 등 사용성 저하. 보안 경계는 아니다.
- 최소 반례: 세션이 `\u001b[?1000h` 출력 후 사용자가 detach → 셸로 돌아와도 마우스 클릭이 깨진 입력으로 들어온다.
- 재현 방법: 추론만(pty 필요). productText/terminal-modes 파서 동작은 repro로 확인했으나 이 항목은 모드 목록 범위의 문제다.
- 확신도: high(추적 모드 목록이 terminal-modes.ts:20-24에 한정됨을 확인)
- 개선 방향: 복구가 필요한 DEC 모드 목록을 넓히거나, 세션이 남긴 모드 전체를 소프트 리셋(`\u001b[!p`)·`\u001b[?1000l` 등으로 정리한다. spec(MAC-222) 범위 결정이면 문서에 명시.

### G12-06 archive chunk index UInt32 한계
- 심각도: Info
- 분류: boundary
- 위반 규칙: 없음
- 코드 경로: `archive-crypto.ts:16-20`(`nonce`가 `writeUInt32BE(index,8)`), `:26`(aad index도 UInt32)
- 원인: nonce = fileId(8B 랜덤) ‖ index(4B). index가 2^32을 넘으면 랩되어 같은 fileId에서 nonce가 재사용된다(GCM 치명). 2^32 chunk × 64KiB = 256 PiB 단일 archive라 실무 도달 불가.
- 영향: 사실상 없음. 경계 문서화 목적.
- 재현 방법: 추론만.
- 확신도: low
- 개선 방향: 위험 없음. index 폭을 늘리거나 상한을 명시적으로 거절해도 된다.

### G12-07 모든 byte 채널이 society 포트로 접힘
- 심각도: Info
- 분류: structural
- 위반 규칙: 없음(설계상 guest가 hello.channel로 라우팅)
- 코드 경로: `src/protocol/host-guest.ts:36-37`(`portOf`는 control이 아니면 무조건 society) ← `guest-link.ts:59,70`(control/society/terminal/egress/stream 모두 `portOf(channel)`로 연결)
- 원인: 포트는 700(control)/701(그 외) 둘뿐이고 terminal·egress·stream·society는 모두 701로 붙은 뒤 hello의 `channel` 필드로 guest가 구분한다. 호스트 측 결함은 아니다.
- 영향: 없음. 채널 구분이 포트가 아니라 hello에 의존한다는 사실을 남긴다(guest 측 라우팅 신뢰가 전제).
- 재현 방법: grep/코드 확인.
- 확신도: high
- 개선 방향: 없음. 문서화만.

## 4. 리팩터링 필요 지점

- **게시(publication)의 단일 owner.** `record.ts`(temp→fsync→rename→dir fsync)는 올바르고, `snapshot.ts`(fsync 없는 rename)와 `archive-crypto.ts`(temp/rename 자체가 없음)는 각자 다르게 게시한다. 같은 "durable하게 파일을 게시한다" 결정이 세 곳에 서로 다른 강도로 구현돼 있다(P0-2 representation drift). 한 게시 유틸로 통일하면 G12-01·G12-02가 함께 닫힌다.
- **완결 판정을 파일 존재로 대신하는 곳.** service.ts의 archive는 `existsSync(target)`를 "이미 완성됨"으로 읽는다. 완결은 존재가 아니라 검증(끝 chunk 인증)으로 판정하는 owner가 있어야 한다(P0-5).
- **host 프로세스 단일화.** Linux는 process-lock이 있고 macOS host는 없다. 같은 자원(state.img·포트·record) owner 유일성을 코드로 강제하는 지점이 빠져 있다(P0-4).

## 5. 점검했고 문제없다고 판단한 것 (막혀 있던 경로)

- **archive AEAD 변조.** ciphertext/tag/magic/fileId 비트 플립, 길이 필드 위조(0xffffffff), chunk 중간 truncation, "가짜 last"로의 truncation을 모두 넣어 실행 — 전부 `STREAM_INVALID`로 거부되고 평문이 반환되지 않았다. `decipher.final()` 전에 평문을 쓰지 않으며, AAD가 index·last·fileId를 묶어 재정렬·중복·절단을 잡는다(archive-crypto.ts:74-82). 근거: `repro/.../archive-crypto.mjs` 7/7 PASS.
- **nonce 재사용.** fileId는 파일마다 randomBytes(8), index는 파일 내 유일 → GAM nonce 유일(2^32 chunk 한계는 G12-06). 키는 32바이트 강제(archive-crypto.ts:36).
- **키 비교 상수시간.** host-api 토큰 비교는 길이 확인 후 `timingSafeEqual`(host-api.ts:70-72). archive 키는 비교하지 않고 복호화 실패로만 판정.
- **rpc unknown 미승격(P0-5).** timeout·연결 종료·malformed answer는 전부 `ENGINE_UNAVAILABLE` `retry:"same-key"`로, refusal이 아니다(rpc.ts:22-24,109-116,128-134). frame parser는 poison 후 resync하지 않고 닫는다. 근거: `repro/.../rpc-framing.mjs` 7/7 PASS.
- **frame 경계·버퍼 상한.** `send`가 frameBytes 초과를 write 전에 FRAME_TOO_LARGE로 거부(rpc.ts:120-122). `readLeadingFrame`는 length>frameBytes를 즉시 거부(rpc.ts:225). VzDriver의 라인 버퍼는 1MiB 초과 시 채널 파괴(vz-driver.ts:88, main.swift received.count>1MiB→exit).
- **host-api 인증.** peer uid 불일치 시 즉시 destroy(host-api.ts:76, peer.ts). 토큰 불일치는 AUTH_FAILED. uid를 알 수 없으면 null→거부(peer.ts는 추측하지 않음).
- **git 인자 주입.** BRANCH 정규식이 선행 `-`, `..`, `//`, 절대경로, 개행/공백/제어/`;`/`:`/`\`/`^{}`/`.lock`/과길이를 모두 거부(project.ts:35). `since`는 host-api에서 hex-only(host-api.ts:132). DISTRUST 옵션이 hooks/pager/ssh/credential/protocol을 차단(project.ts:24-30). 근거: `repro/.../branch-regex.mjs` 19/19.
- **guest 산출물 경로 노출(MAC-022/231).** productText가 Linux 경로·unit·errno·machinery 단어·제어문자·과길이를 거부(product-text.ts). 근거: `repro/.../product-text.mjs` 16/16.
- **record 부분 쓰기/손상.** temp→fsync→rename→dir fsync, 0600, 손상 record는 새로 쓰지 않고 STORE_CORRUPT(record.ts:41-56), ENOENT만 null. `__proto__` 오염 없음. 근거: `repro/.../record.mjs` 7/7.
- **egress placeholder 위조.** 다른 boot/미발급 placeholder는 아무 것도 열지 못하고(egress.ts:118-125), society/actor/incarnation 불일치 시 destroy. reboot 시 `forgetBoot`로 전량 release.
- **이전 snapshot 손실.** snapshot id마다 고유 `<id>.img`라 rename이 기존 것을 덮지 않는다(snapshot.ts:31-35) — "crash 뒤 이전 스냅샷 손실" 벡터는 막혀 있다(새 것의 내구성은 G12-02).
- **helper 프로세스 누수(startup 실패).** omahostd가 일찍 죽어도 fd3 socketpair가 닫히면 Swift 헬퍼가 EOF를 보고 VM 정지·exit(main.swift readabilityHandler chunk.isEmpty). detached child지만 fd3로 부모 수명에 묶임(async.ts CHANNEL_FD 주석). 단 이 보증은 Swift 측 미검증 → §6.
- **snapshotRunning P0-5.** stop이 "stopped"가 아니면(불명 포함) throw하여 backup을 만들지 않고, thaw가 freeze가 유지됐음을 확인해야만 게시(snapshot.ts:56-73).

## 6. 확인하지 못한 것

- **Swift/VZ 전체(main.swift, Package.swift, entitlements):** macOS·Virtualization.framework 없이는 빌드·실행 불가(NOT_BUILT). PortBridge의 `unlink`+bind가 second-process에 소켓을 넘기는지(G12-03), keychain get/put의 오류 매핑, relay의 half-close, guestDidStop 경로는 추론만. entitlements는 `com.apple.security.virtualization`과 keychain-access-group 하나로 과다 권한은 보이지 않으나 서명·프로파일 실검증 불가.
- **G12-02 전원 차단 순서:** APFS clonefile + rename의 내구성은 실제 macOS·전원 차단 lane 필요. Linux unit로 재현 못 함.
- **G12-03 두 omahostd 실기동:** launchd가 실제로 세션당 1개를 강제하는지, 강제 밖(다른 세션/수동)에서 두 개가 같은 state.img를 붙일 때의 결과는 macOS 실기동 필요.
- **lifecycle 상태기계의 타이밍 주입:** now/after 주입으로 단위 시험 가능하나 이번엔 실행하지 않았다(기존 `test/platform-*`에 커버). watchdog·restart backoff·drain deadline의 경계 kill은 추론으로만 P0-5 준수 확인.
- **helper EOF 정리 보증:** fd3 닫힘→Swift exit 경로가 실제로 VM을 반드시 정지시키는지는 Swift 미검증(§5의 helper 누수 판정은 이 가정에 의존).
