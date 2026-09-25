# 설계 수정 기록 DR1–DR8 (실제 provider 기능 점검 뒤)

상태: **ACCEPTED (사용자 요청, 2026-09-25)**. AV9–AV31(`consistency-decisions.md`의 AV 절)을
고치는 동안 결함이 코드 한 곳이 아니라 설계의 선택에서 나온 경우가 있었다. 이 문서는 그중
일곱 가지를 설계 수준에서 다시 판단하고, 그 수정을 다시 점검하며 드러난 여덟 번째(DR8)를 더한다. 각 항목은 관측, 원인이 된 설계, 결정, 바꾸는 규범,
바꾸지 않는 것, 위험을 적는다. `architecture.md`는 N-001이 bytes를 결박하므로 고치지 않는다.
이 문서와 어긋나는 architecture 문장은 여기에 적고, 규범의 owner는 `implementation-spec.md`다.
wire schema·DB schema·receipt version은 바꾸지 않는다. 바뀌는 권한 의미는 DR4 하나다.

## DR1 — 모델에게 보이는 경로는 그 모델의 view로 말한다

**관측.** 같은 파일을 host 경로와 sandbox 경로 두 좌표로 부르는데, 번역이 경계마다 따로
있었다. 같은 종류의 결함이 세 번 나왔다: 격리 영수증이 sandbox 경로를 적었다(AV17), 작업공간
`origin`이 host 경로였다(AV27), `/inbox.md`가 host에는 없는 파일이었다(AV10). 남은 사례로
`oma send`의 결과 `archivePath`가 sandbox 안의 Resident에게 host 경로로 보인다.

**원인.** SB-002-C는 argv의 host 경로만 mount 표로 번역하라고 했고, 모델이 *보는* 값(도구
결과, CLI 출력, 메일 안내)에는 규칙이 없었다.

**결정.** broker는 host의 이름으로 기록하고 답한다(영속 결과의 `archivePath`는 그대로 host
경로다, durable 검증이 그것을 요구한다). 모델에게 보이는 값은 그 모델의 경계가 자기 view로
렌더링한다: sandbox 안의 CLI는 SB-002가 준 환경(`OMA_MAIL_ARCHIVE` 등)의 root로, Principal의
도구는 host root로. 경계는 CLI 출력과 extension 도구 두 곳뿐이고, extension이 띄우는 CLI에도 같은
환경을 넘긴다.

**바꾸는 규범.** SB-002-C에 "모델에게 보이는 경로도 같은 규칙" 문장을 더한다.

**바꾸지 않는 것.** broker 응답과 영속 결과의 bytes, receipt 형식.

## DR2 — 주기 대조가 있어야 하는 곳에 실제로 있는가

**관측.** 거절하고 intent만 남기는 패턴(동시 create, writer busy)의 liveness가 reconcile timer에
기대는데, 그 timer는 systemd unit으로만 설계되었고 제품의 foreground 모드에는 없었다(AV20).

**결정.** 원칙("no retained waiting chain", 거절 뒤 같은 key 재시도)은 유지한다. AV20이 foreground
broker의 수명 동안 같은 sweep을 돌리게 했다. systemd-managed 모드의 timer unit은 그 profile의
runtime gate(NOT_RUN)로 남긴다: 그 모드는 제품이 설치하지 않는다(`ensureBroker`에도 호출자가 없다).

**바꾸는 규범.** 없음(REC-002는 이미 주기 대조를 요구한다). 이 문서가 판단을 기록한다.

## DR3 — 실패가 말할 수 있는 사실은 코드별로 닫는다

**관측.** `publicFailure`가 message를 코드와 같게 만들어 `BROKER_UNAVAILABLE: BROKER_UNAVAILABLE`
같은 출력만 남았다. 내부 누출을 막는 목적은 옳았지만, spec이 요구한 정보(STALE_BASE의 actual OID,
AV28)와 모델이 다음 행동을 고를 정보(어떤 권한이 없는지, 왜 지금 안 되는지)까지 지워졌다.

**원인.** "무엇을 말해도 되는가"를 값마다가 아니라 전부 막는 방식으로만 정했다.

**결정.** wire의 `message`는 지금처럼 코드다(바꾸면 wire golden과 기존 기록의 의미가 흔들린다).
실패가 싣는 사실은 `details`에, 코드마다 닫힌 필드로만 싣는다(`ERROR_DETAILS`, domain/errors.ts):

| code | details |
|---|---|
| STALE_BASE, NOT_DESCENDANT, CONTEXT_CONFLICT | `actual` (full OID 또는 null) |
| CAPABILITY_DENIED | `capability` (AUTH-001의 닫힌 이름) |
| BROKER_UNAVAILABLE | `reason`: `busy` 또는 `draining` |

다른 코드와 다른 필드는 싣지 않는다. 설명 문장은 code마다 하나인 고정 표(`ERROR_DESCRIPTIONS`,
같은 owner)에서 오고, CLI가 code·설명·details를 함께 보인다. 모델의 분기는 여전히 code/retry/state다
(ERR-001).

**바꾸는 규범.** ERR-001에 details 규칙을 더한다.

**재실행에서 고친 것.** 13차 점검에서 접수 뒤 실패(`acceptedFailure`)가 details를 옮기지 않아
BROKER_UNAVAILABLE의 `reason`이 빠졌다. 접수 뒤 실패도 같은 details를 싣는다.

## DR4 — `code.integrate`는 host가 직접 위임한다

**관측.** 기본 상태에서 누구도 integrate할 수 없었다. Principal은 자동으로 갖지 않고(AUTH-001),
Resident도 기본으로 받지 않으며(TUI-019), 자식은 부모가 보유한 것만 받고(CREATE-002), 한 번 만든
spec은 고정이고(LIFE-008), Control Panel에는 권한 편집이 없었다. 그래서 submit→integrate라는 제품의
중심 흐름을 쓰려면 bootstrap 전에 설정 파일을 손으로 고쳐야 했고, 이미 만든 society에서는 방법이
없었다.

**원인.** A-002는 "code.integrate는 host 위임에 따라 Resident에게도 부여할 수 있다"고 했지만,
CREATE-002의 교집합이 그 위임을 부모(Principal)의 보유에 묶었다. host의 위임과 agent의 위임이
구분되지 않았다.

**결정.** `code.integrate`는 agent가 위임하는 권한이 아니라 host가 profile로 직접 주는 권한이다.
자식의 capability는 기존 교집합에, 자식 profile이 `code.integrate`를 가지면 그것을 더한 값이다.
부모의 보유·delegable은 이 한 권한에는 효과가 없다. 나머지 권한의 교집합 규칙과 "role로 확대하지
않는다"는 그대로다. 기본값도 그대로다: 어떤 profile도 `code.integrate`를 갖지 않는다.
Human은 Control Panel의 "Worker integrate"로 worker profile에 이 권한을 켜고 끈다(TUI-019가 이미
요구한 role capability 편집의 이 한 항목). 적용 시점은 "이후 만드는 worker부터"다: 이미 만든
agent의 spec은 LIFE-008대로 고정이다.

**위험.** host가 worker profile에 권한을 켜면 Principal이 만든 Resident도 main에 통합할 수 있다.
그것이 A-002가 말한 host의 결정이고, 켜는 행위가 명시적이며 끄면 이후 Resident에게는 주지 않는다.
Principal 자신은 여전히 기본으로 integrate하지 않는다(AUTH-001). protected path·check·policy
조건(INT-001)은 그대로 모든 통합에 적용된다.

**바꾸는 규범.** AUTH-001의 마지막 문장, CREATE-002의 교집합 문장, TUI-007 표의 행 하나.

## DR5 — 저장된 메일 형식

**관측.** architecture §5.1은 본문을 8bit UTF-8로 보여 주고 index는 "cat으로 읽으라"고 했지만,
고정된 MIME writer(MAIL-003, nodemailer)는 text 본문에 non-ASCII나 긴 줄이 있으면 base64나
quoted-printable로만 쓴다. 읽는 쪽 세 곳이 디코더를 가져야 했다(AV23, AV26).

**결정.** 저장 형식은 바꾸지 않는다. 원문은 불변 증거이고(FS-006, MAIL-010), writer를 바꾸면 이미
쌓인 archive와 새 archive가 다른 형식이 되며, nodemailer로는 8bit text 본문을 쓸 수 없다. 대신
독자가 메시지를 만나는 방식에 owner 하나를 두었고(`src/mail/display.ts`, AV26), index의 읽기 안내를
그 방식(도구)으로 바꾼다: `cat`은 저장된 원문을 보여 줄 뿐이다.

**바꾸는 규범.** BATCH-002의 index 문장(DR6과 함께).

## DR6 — 재전달은 재전달이라고 말한다

**관측.** 작업 도중 중단된 batch는 D01대로 다시 전달되고 세션도 이어졌지만(12차 점검), 두 모델
모두 같은 Message-ID를 보고 "이미 처리했다"고 판단해 중단된 작업을 버렸다. BATCH-002가 알림
항목을 닫아 두어 그것이 복구라는 사실을 알릴 수 없었다.

**결정.** 완료가 확인되지 않은 batch를 다시 전달할 때(`prepare`가 이미 준비된 batch를 돌려줄 때,
곧 D01의 rollover) 알림 첫 줄에 그 사실을 고정 문장 하나로 밝힌다. 이미 받았을 수 있으며 이전
작업이 세션에 남아 있다는 것, 끝나지 않은 일은 이어서 하라는 것. 새 batch에는 붙이지 않는다.
항목 목록(최대 6개)과 그 필드는 그대로다.

**바꾸는 규범.** BATCH-002.

## DR7 — broker의 수명은 supervision 채널에만 묶는다

**관측.** foreground broker가 TUI의 자식이자 같은 프로세스 그룹이어서, 터미널이 닫히거나
세션 리더인 `oma`가 끝나면 SIGHUP으로 drain 도중 죽었다(AV31). AV31은 SIGHUP을 drain으로 받게 했다.

**결정.** broker를 자기 세션으로 띄운다. 그러면 터미널의 hangup과 작업 제어 신호가 닿지 않고,
broker의 수명은 설계가 말한 대로 host와의 supervision 채널(닫히면 drain해 멈춤)과 명시적 stop
신호에만 묶인다. AV31의 신호 처리는 방어선으로 남긴다.

**바꾸는 규범.** 없음(D03·LIFE-006의 구현). 이 문서가 판단을 기록한다.

## DR8 — broker가 붙드는 것은 통합 사실이고, revision은 host의 현재 값이다

**관측.** 13차 점검에서 Human이 Config 화면으로 Worker integrate를 켠 뒤, 새로 만든 Resident의
integrate가 모두 `POLICY_CHANGED`로 거절되었다. Config 화면의 어떤 저장이든 CFG-005대로 새 policy
revision을 매기는데, broker는 시작 때의 정책 스냅샷(revision 포함)으로 새 integrate를 접수하고
CAS 직전에 현재 설정과 revision까지 같아야 통과시켰다. 편집 한 번이면 재시작 전까지 통합이 막혔다.

**원인.** 두 규범의 대상이 섞였다. TUI-007은 보호 경로·check argv 같은 통합 *사실*을 broker 시작 때
고정하고, CFG-005/D02는 의미가 바뀌면 새 *revision*으로 "outstanding integrate가 재검사하게" 한다.
구현은 revision도 시작 때 고정했고, 같은 파일의 비교는 revision만 달라도 "facts changed"라고 했다.

**결정.** broker가 수명 동안 붙드는 것은 통합 사실이고(TUI-007), revision은 host의 현재 값이다
(CFG-005, INT-001의 "현재 policy"). 새 integrate는 현재 revision으로 접수하고, 현재 사실이 붙든
사실과 다르면 접수 전에 거절한다(다음 broker 시작에 적용). CAS 직전(INT-003)과 복구에서는 접수 때의
revision이 여전히 host의 것인지 다시 보고, 다르면 거절한다(D02의 재검사).

**바꾸는 규범.** 없음: INT-001·INT-003·CFG-005·TUI-007이 이미 이렇게 말한다. 구현과 그 시험
(T62는 접수와 CAS 사이의 변경으로, R19는 사실의 변경으로)을 규범에 맞췄다.
