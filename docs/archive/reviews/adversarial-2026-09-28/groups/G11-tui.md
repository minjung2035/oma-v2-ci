# G11-tui 적대적 검증 결과

검토자 시각: HEAD `070a52d`, branch `feat/macos-hidden-vm`. 코드 수정·빌드·테스트 실행 없음.
`dist/`는 HEAD 빌드본을 그대로 import해 순수 함수를 적대적 입력으로 직접 호출했다.

## 1. 커버리지

| 파일 | 줄 수 | 전부 읽음 | 비고 (마지막으로 읽은 줄 · 앞 20자) |
|---|---|---|---|
| src/tui/app.ts | 257 | 예 | L257 `}` (클래스 `TuiApp` 종료) |
| src/tui/dashboard.ts | 57 | 예 | L57 `}` (`dashboardData` 반환 종료) |
| src/tui/exit.ts | 21 | 예 | L21 `export function done` |
| src/tui/keys.ts | 397 | 예 | L397 `}` (`decodeKeys` 종료) |
| src/tui/limits.ts | 124 | 예 | L124 `});` (`SURFACE_BOUNDS`) |
| src/tui/login.ts | 39 | 예 | L39 `}` (`runEngineLogin` 종료) |
| src/tui/model.ts | 423 | 예 | L423 `}` (`step` 종료) |
| src/tui/prompt.ts | 104 | 예 | L104 `}` (`submitPrompt` 종료) |
| src/tui/screen.ts | 93 | 예 | L93 `}` (`openTerminal` 종료) |
| src/tui/session.ts | 554 | 예 | L554 `}` (`close`/클래스 종료) |
| src/tui/transcript.ts | 93 | 예 | L93 `}` (`push` 종료) |
| src/tui/transport.ts | 77 | 예 | L77 `}` (`status`/클래스 종료) |
| src/tui/words.ts | 40 | 예 | L40 `}` (`humanStream` 종료) |
| src/tui/sources/extensions.ts | 193 | 예 | L193 `}` (`toggleExtension` 종료) |
| src/tui/sources/mail.ts | 219 | 예 | L219 `}` (`readBody` 종료) |
| src/tui/sources/settings.ts | 387 | 예 | L387 `}` (`commitField` 종료) |
| src/tui/view/dashboard.ts | 56 | 예 | L56 `}` (`dashboardRows` 종료) |
| src/tui/view/index.ts | 3 | 예 | L3 `export { mailScroll` |
| src/tui/view/labels.ts | 13 | 예 | L13 `export function applyL` |
| src/tui/view/layout.ts | 13 | 예 | L13 `});` (`LAYOUT_BOUNDS`) |
| src/tui/view/notice.ts | 54 | 예 | L54 `}` (`noticeText` 종료) |
| src/tui/view/screens.ts | 214 | 예 | L214 `}` (`render` 종료) |
| src/tui/view/text.ts | 85 | 예 | L85 `}` (`wrap` 종료) |

호출 경로 확인을 위해 그룹 밖도 읽었다: `src/entry/oma.ts`(login 호출부 L76–108),
`src/config/generations.ts`(`commitInlineConfiguration` L407–421, `commitManagedGeneration` L322–396),
`architecture.md` §23(L1268–), `implementation-spec.md` §18(L642–), `implementation/validation.md`.

## 2. 발견 요약

| ID | 심각도 | 분류 | 제목 | 확신도 |
|---|---|---|---|---|
| G11-tui-01 | Medium | boundary | `displayable()`가 bidi/zero-width/format 제어문자를 걸러내지 않아 신뢰할 수 없는 메일·엔진 출력이 화면 텍스트를 시각적으로 위조 | confirmed |
| G11-tui-02 | Low | boundary | `fit`/`wrap`이 width 0 cluster를 건너뛰어 합성문자 등 정상 grapheme을 표시에서 누락 | confirmed |

High 이상 없음.

## 3. 발견 상세

### G11-tui-01 displayable()가 bidi/format 제어문자를 통과시켜 화면 텍스트를 위조할 수 있다
- 심각도: Medium
- 분류: boundary
- 위반 규칙: 없음 (spec은 "C0/C1 제어 byte"만 텍스트 처리로 규정; arch §23.6/TUI-002는 `\u0000-\u001f\u007f-\u009f`만 언급). P0-5의 "신뢰할 수 없는 입력" 정신에는 어긋난다.
- 코드 경로: `src/tui/view/text.ts:39` (`displayable`의 정규식 `/[\u0000-\u001f\u007f-\u009f]/g`) → `fit`(L52), `wrap`(L70), `pad`(L47) → `src/tui/view/screens.ts`의 `frame`(L60)·`mailDetailParts`(L155) → mail 본문/헤더(`src/tui/sources/mail.ts:parseMessage` L45의 subject/body)와 엔진 출력(`src/tui/session.ts:projectEvent`)이 모두 이 경로로 그려진다.
- 원인: `displayable`는 C0(0x00–0x1f), DEL/C1(0x7f–0x9f)만 제거한다. ESC(0x1b)와 C1은 확실히 제거되어 커서 이동·화면 지우기·OSC 52 clipboard·OSC 8 hyperlink 주입은 막힌다(repro로 확인). 그러나 다음 유니코드 format/bidi 제어는 그대로 통과한다: U+202A–202E(특히 RLO U+202E), U+2066–2069(isolates), U+200B/200C/200D/200E/200F(zero-width·방향표시).
- 영향: 악성 메일 발신자나 손상된 엔진 출력이 화면에 보이는 파일명·주소·본문을 실제 bytes와 다르게 렌더시킬 수 있다. 예: 메일 subject `evil\u202Eexe.txt`는 화면에 `evil txt.exe`처럼 뒤집혀 보여 Human이 첨부/명령을 오판할 수 있다. zero-width 문자로 토큰을 숨기거나 두 발신자 이름을 시각적으로 동일하게 만들 수 있다. 이것은 사실을 바꾸지 않는 관측 계층의 시각 위조이므로 Critical/High은 아니지만, "모델이나 메일이 쓴 escape sequence가 화면을 조작하지 못한다"(arch §23.6)는 보장이 bidi에는 적용되지 않는다.
- 최소 반례: subject = `important\u202Etxt.exe`, body = `Body\u202Ereversed`.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G11-tui/text-bidi.mjs` 및 `.../mail.mjs`.
  관측: `RLO_U+202E: format_survived=true out="userevil.txt" out_hex=... e2 80 ae ...`,
  `body_display_ESC: false -> hex: ... 63 6c 65 61 72 65 64 e2 80 ae 72 ...` (ESC는 사라지고 U+202E=`e2 80 ae`는 남음).
- 확신도: confirmed
- 개선 방향: `displayable`의 제거 집합에 bidi/format 제어(U+202A–202E, U+2066–2069, U+200B–200F, 필요하면 U+FEFF·U+061C)를 추가하거나, 최소한 방향성 문자를 무력화(예: 각 논리 줄을 LTR isolate로 감싸기)하는 것을 한 owner(`view/text.ts`)에서 정한다. 규범(arch §23.6, TUI-002)의 "C0/C1" 문구도 실제 위협 범위에 맞춰 넓힐지 결정 기록에 남긴다.

### G11-tui-02 width 0 cluster를 건너뛰어 정상 grapheme이 표시에서 사라진다
- 심각도: Low
- 분류: boundary
- 위반 규칙: 없음
- 코드 경로: `src/tui/view/text.ts:57` (`fit`의 `if (size === 0) continue;`), `:77` (`wrap`의 동일 분기).
- 원인: `cellWidth`(엔진 `visibleWidth`)가 0을 돌려주는 cluster를 건너뛴다. 주석은 이것을 "제어문자가 0폭이라 건너뛴다"의 근거로 삼지만(L21–28), 이제 제어문자는 `displayable`이 먼저 제거하므로 이 분기가 실제로 버리는 것은 앞 문자에 결합하지 못하고 혼자 남은 합성문자(예: cluster 선두의 U+0301)나 기타 0폭 grapheme이다.
- 영향: 표시 충실도 저하. 사실이나 편집 draft에는 영향 없다(draft는 `prompt.ts`가 grapheme 단위로 별도 관리). 잘못된 잘림/겹침으로 이어지지는 않으나, 화면에 보이는 본문이 저장된 본문과 미세하게 다를 수 있다.
- 최소 반례: `fit("a\u0301\u0301\u0301b", 10)` → `"á́́b"`가 유지되는 경우도 있으나(선행 문자에 결합), 선두 결합문자만 있는 cluster는 사라진다. repro에서 `width(comb)=0` 확인.
- 재현 방법: `node review/adversarial-2026-09-28/repro/G11-tui/text-bidi.mjs` 마지막 줄 `combining fit: ...`.
- 확신도: confirmed
- 개선 방향: 0폭 cluster를 무조건 건너뛰지 말고, 제어문자 제거를 `displayable`이 이미 한다는 사실 위에서 "폭 0이지만 비어 있지 않은 cluster는 폭 계산에는 0으로 두되 문자열에는 유지"로 분리한다.

## 4. 리팩터링 필요 지점

- `displayable`(view/text.ts), `pastedText`(keys.ts:59)가 각자 다른 제어문자 정규식을 들고 있다. keys는 전송용(제어 제거+개행 정규화), text는 표시용(제어 제거)으로 목적이 다르지만, "무엇이 위험한 제어문자인가"의 문자 클래스가 두 곳에서 독립적으로 정의된다(P0-6의 이름 없는 중복 후보). bidi를 고칠 때 한 곳에서 클래스를 정의하고 둘이 참조하도록 하는 편이 drift를 막는다.

## 5. 점검했고 문제없다고 판단한 것 (근거 줄 번호)

- **settings.ts P0-3 (transform→전체검증→generation commit).** `commitField`(L360–386)는 blocked 확인 → `descriptor.transform` → `validateConfig`(전체) → snapshot null 거절 → `commitInlineEdit`/`commitManagedEdit` 한 경로. 필드별 부분 저장 없음. `revised`(L179)가 정책 revision을 내용 해시에서 파생(L134–142)해 의미가 바뀔 때만 새 revision. 부합.
- **저장 실패를 '저장됨'으로 표시하지 않음 (P0-5/INV11).** `commitInlineConfiguration`/`commitManagedGeneration`(generations.ts L322–421)은 fsync 실패 시 `publishedUnconfirmed`(details.publication)로 throw하고, `app.ts:run` catch(L219–228)가 이를 `saved-unconfirmed`("디스크에 남았는지 아직 확인되지 않음")로, 그 외는 `save-failed`("저장하지 못했습니다")로 매핑한다. `notice.ts` worded(L6–47)도 세 경우를 구분. "saved"는 commit이 `committed`를 반환할 때만. 부합.
- **두 TUI 동시 편집 lost update.** 쓰기는 lease 보유자만(oma.ts login/main의 `HostTenure.take` null 거절; arch §23.4/TUI-004). commit은 `assertCurrent(snapshot)`(generations.ts L417, L332)로 읽은 세대와 다르면 거절(CAS). 부합.
- **적용 시점 표시(TUI-007).** `EDITABLE_FIELD_DESCRIPTORS`(settings.ts L275–392)의 `apply` 값이 spec 표(§18 TUI-007)와 일치: principal-model=next-session, worker-model=next-activation, worker-limit=restart, initial/profile=bootstrap-only, integrate=new-agents. `notice.ts`가 `applyLabel`로 문구화. 부합.
- **extensions.ts toggle 원자성.** `toggleExtension`(L166–192)은 검증 후 `commitManagedEdit`로 한 generation 게시. core는 index 0 고정·해제 불가(L48–52, L167). repair 모드에서 없는 선언만 끄기 허용. 부합.
- **mail 읽기 실패를 0/읽음으로 표시하지 않음.** `listDir`(L108–113)·`entriesIn`(L128–147)·`readBounded`(L82–103)가 ENOENT만 "없음", 그 외는 `unreadable`/`unobserved`로 분리. `unreadCount`(L200–203)는 관측 실패 시 null. 큰 메일함은 `mailListRows=200` 예산 후 `omitted` 카운트(P0V-43, known-limitation). 부합.
- **메일 터미널 escape 주입(ESC/OSC/CSI/C1).** repro `mail.mjs`·`text-bidi.mjs`: subject/from/body의 ESC(0x1b)·C1이 `displayable`에서 제거됨(`ESC_out=false`, `C1_out=false`). OSC 52/OSC 8도 ESC 제거로 무력화. (bidi만 예외 → G11-tui-01).
- **keys.ts 입력 경계.** repro `keys.mjs`: (1) paste 안의 `\x03`·`\x1b[A`가 명령이 아니라 텍스트("[A")로 남음, (2) clipboard가 실은 `ESC[201~`+newline 주입 시 같은 read에서 흡수, (3) burst 창 내 Enter는 개행으로, (4) 미종료 paste는 truncated 거절, (5) 16KiB 초과 paste 통째 거절, (6) 분할 UTF-8은 deadline과 함께 보류 후 완성, (7) 비 UTF-8 바이트 드롭, (8) overlong CSI 폐기. 모두 방어됨.
- **session.ts 수명·소유권(P0-4).** owner 클레임이 write 전 동기적(L336–356 submit, L306–319 deliver), `agent_settled`가 run 종료(observe L272), `exited`가 OS reap을 기다림(생성자 L233–246), spawn 실패는 pid undefined로 terminal 처리. fence descriptor 상속(sessionEnv L212). handBack이 미전송 prompt만 반환, unanswered는 unconfirmed로 별도(L288–296). 부합.
- **transport.ts broker 관측 실패 표시(TUI-021).** `read`(L38–61) O_NOFOLLOW·크기 상한, `status`(L63–77)가 absent/malformed/다른 society/stale/시계 역행을 모두 이유+시각 붙은 `unknown`으로. 0/ready로 승격 안 함. 부합.
- **login.ts 실행 중 로그인 차단.** login.ts는 순수 spawn이고 가드는 호출부(oma.ts L94 `HostTenure.take` null → "이 society가 실행 중입니다" 거절)에 있음(P0-2 owner 일원화). agentDir 0o700(L36). 부합.
- **screen.ts raw mode 복구.** `process.once("exit", restore)`(L60), restore가 setRawMode(false)+PASTE_OFF+CURSOR_ON+ALT_OFF(L81–89). SIGKILL/abort는 프로세스가 못 보므로 fence+shell reset에 맡김(주석 L1–8). draw는 변경 시에만 write(L64). resize는 columns/rows getter로 즉시 반영, 별도 상태 없음(폭주 무해). 부합.
- **model.ts 경계값.** `cursorOf`(L232–236) clamp, `move`(L245–251) 빈 목록 시 no-op, `commitEdit`(L281–299) 범위 밖은 revert(클램프 안 함), number draft `^\d{1,9}$`. 음수 인덱스·빈 목록 안전. 부합.
- **transcript.ts 무제한 방지(TUI-023).** 500줄·256KiB·줄당 1KiB 세 한도를 `push`(L82–92)가 도착마다 트림, `storedLines`가 code point 경계로 자름. 부합.

## 6. 확인하지 못한 것

- 실제 터미널에서 bidi 렌더가 어떻게 보이는지는 터미널 에뮬레이터 의존이라 hex 증거로만 확인했다(문자가 출력 스트림에 남는다는 사실은 confirmed, 시각적 결과는 환경 의존).
- `app.ts feed`의 pendingTimer deadline 동작은 `setTimeout`+`unref` 실제 타이밍을 재현하지 않고 `KeyDecoder.pendingDelayMs`/`flushPending`의 순수 동작만 확인했다(값이 옳고 flush가 옳음은 확인, 타이머 스케줄링 자체는 추론).
- session/screen/exit의 실제 프로세스 crash·SIGTERM/SIGHUP 주입은 환경(엔진 spawn) 필요라 실행하지 못했다. 코드 경로만 따라 판정했다.
- `screen.ts`의 alternate-screen 이중 진입/resize 폭주는 실제 TTY 없이는 재현 불가; 로직상 무해로 추론.
