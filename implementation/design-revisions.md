# 설계 수정 기록 DR1–DR13

상태: **ACCEPTED (사용자 요청, 2026-09-25)**. 이 문서는 **결정 기록**이다([문서 지도](../docs/README.md)).
결함이 코드 한 곳이 아니라 설계의 선택에서 나온 경우를 설계 수준에서 다시 판단한다. 각 항목은 관측, 원인, 결정, 바꾸는 규범,
바꾸지 않는 것을 적는다.

- DR1–DR7은 실제 provider 점검에서 AV9–AV31(`consistency-decisions.md`의 AV 절)을 고치다 나왔고, DR8은 그 수정을 다시 점검하다 나왔다.
- DR9–DR13은 [Priority 0](../PRIORITY-0.md) 파일 단위 점검([priority-0-audit.md](priority-0-audit.md))에서 나왔다.
- 규범 문장의 owner는 `implementation-spec.md`다. `architecture.md`는 N-001이 bytes를 결박하므로 고치지 않고, 어긋나는 architecture 문장은 해당 DR에 적는다.
- wire schema·DB schema·receipt 형식은 바꾸지 않는다. 권한 의미가 바뀌는 것은 DR4 하나다.

| DR | 결정 | 바꾼 규범 |
|---|---|---|
| DR1 | 모델에게 보이는 경로는 그 모델의 view로 말한다 | SB-002-C |
| DR2 | 주기 대조가 있어야 하는 곳에 실제로 있는가 | 없음(판단 기록) |
| DR3 | 실패가 말할 수 있는 사실은 코드별로 닫는다 | ERR-001 |
| DR4 | `code.integrate`는 host가 직접 위임한다 | AUTH-001, CREATE-002, TUI-007 표의 한 행 |
| DR5 | 저장된 메일 형식 | BATCH-002의 index 문장 |
| DR6 | 재전달은 재전달이라고 말한다 | BATCH-002 |
| DR7 | broker의 수명은 supervision 채널에만 묶는다 | 없음(D03·LIFE-006의 구현) |
| DR8 | broker가 붙드는 것은 통합 사실이고, revision은 host의 현재 값이다 | 없음(INT-001·INT-003·CFG-005·TUI-007의 구현) |
| DR9 | 전달 시도는 batch를 만든 시도로 고정하고, 현재 시도는 lease가 말한다 | BATCH-004, RUN-001, DB-007의 두 행, physical-ordering의 runner.open 행 |
| DR10 | accept 전 artifact는 crash 뒤에도 owner가 있다 | 없음(FS-006·MAIL-010·INV05의 구현) |
| DR11 | receipt는 그 session entry가 durable해진 뒤에만 있다 | 없음(BATCH-006의 구현) |
| DR12 | 설정 commit의 owner는 하나다 | 없음(D02·CONFIG-CONTRACT의 writer 순서를 inline에도) |
| DR13 | 모르는 것에는 모른다는 코드를 붙인다 | 없음(CLI-003·ERR-002·INV02의 구현) |

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

## DR9 — 전달 시도는 batch를 만든 시도로 고정하고, 현재 시도는 lease가 말한다

**관측(P0V-01, P0V-02).** run이 열릴 때 prepared batch의 `incarnation`을 새 lease 값으로 다시 썼다
(`reassignPreparedBatches`). 한 칸이 "이 batch가 전달된 시도"(과거 사실)와 "지금 이 batch를 제시할 수 있는
lease"(현재 권한)를 겸했다. 그래서 rollover 뒤에 나타난 이전 시도의 올바른 receipt는 conflicting이 되었고
(V30A가 이 결과를 명시했다), 그 agent는 수동 repair 전까지 run을 열 수 없었다. D01은 정산을 rollover보다 먼저
하는 순서로 이것을 피했지만, 과거 시도를 기록이 아니라 순서가 지켰다.

**원인.** D01이 v1 byte encoding을 유지하면서 "batch의 incarnation은 재할당된다"고 적었다. 재할당은 과거
incarnation을 현재 값으로 덮어쓰는 것, 곧 INV01이 이름으로 짚은 잘못된 해석이다.

**결정.** `batches.incarnation`은 batch를 만든 시도(첫 전달 시도)이고 바뀌지 않는다. run이 열리면 prepared
batch는 모두 새 lease로 넘어간다(열기 전에 모든 prepared batch가 직전 lease에 있어야 한다). 그러니 batch B의
전달 시도는 `B.incarnation ≤ N ≤ agents.incarnation`인 모든 N이다. 현재 시도는 agent의 현재 incarnation이
말하고, rollover는 agent incarnation만 올린다. receipt의 시도 N이 이 구간 안이면 그 receipt는 언제든 B의
증거다. 정산(이미 일어난 제시의 기록, INV08)은 현재 lease가 아니라 이 구간과 검증된 receipt에 묶인다. 새
제시(링크, prepare가 돌려주는 시도)는 여전히 현재 lease가 권한이다(INV06). 요청자 권한(runner·host가 자기
시도를 완료함)은 RPC 경계가 본다.

정산 권한은 끝나는 run의 사망 증명(또는 startup quiescence)에서 오고, 정산하는 broker는 agent의 현재
incarnation이 바로 그 끝나는 run이어야 한다(run-registry의 opening 단계, `settleFromReceipt`).

**바꾸는 규범.** BATCH-004의 "재할당" 문장, RUN-001의 "회수", DB-007의 T-run-open·T-batch-prepare 행.

**앞의 거절과 무엇이 다른가.** consistency-decisions.md의 D01 절은 "`receipt.incarnation <= current`를
받아들이는 것"을 증거를 지우거나 권한을 느슨하게 한다며 거절했다. 그 안은 하한이 없어서, batch가 한 번도
전달된 적 없는 시도(batch가 생기기 전의 run)의 receipt도 받아들일 수 있었다. 게다가 재할당 아래에서는 batch의
원래 시도가 지워지므로 하한을 둘 곳도 없었다. DR9의 하한은 batch의 첫 시도라는 durable fact다. run은 모든
prepared batch를 이어받으므로, 구간 안의 모든 N은 이 batch가 실제로 있었던 시도다. receipt는 여전히 같은
batch id·ordered manifest·session·adapter를 요구한다(`checkReceipt`). 정산은 새 효과의 권한이 아니라 과거 제시의
기록이다. 새 제시의 권한(현재 lease)은 느슨해지지 않는다.

**architecture와 어긋나는 문장.** architecture.md D01(409행)의 "그 뒤 receipt 최종 이름의 부재가 확인된 나머지
prepared만 T-run-open에서 재할당한다"와 "기존 incarnation과 exact ordered manifest에 맞는 유효 receipt부터
정산한다"의 "기존 incarnation". 이 결정이 우선한다. "completed batch의 역사적 incarnation과 최초 유효 receipt는
바꾸지 않는다"는 prepared batch에도 그대로 넓혀 적용한다.

**바꾸지 않는 것.** DB schema와 여섯 entity, `PreparedBatch.incarnation`의 뜻(현재 시도 = lease), receipt 형식
`oma-pi-rpc-v1@0.87.1`. 기존 데이터: v1이 이미 재할당한 batch는 저장된 값을 첫 시도로 읽는다. 그보다 이른
시도의 receipt는 전처럼 conflicting이다. 불충분한 역사에서 새 사실을 복원하지 않는다(D01 "기존 불일치 데이터").

## DR10 — accept 전 artifact는 crash 뒤에도 owner가 있다

**관측(P0V-05).** accept 전에 만든 메일 원문(`mail/objects/<id>.eml`), 그 staging 임시 파일, submit bundle
staging, transport 복사본(`staging/rpc-*.wire`)의 owner는 프로세스 메모리의 `PreacceptScope`뿐이었다. 그 사이에
broker가 죽으면 아무도 찾지 않았고, 진단은 "unknown"으로 보고만 했다.

**결정.** 이름이 곧 등록이다. accept 전 artifact의 이름은 무작위 operation id에서 파생되므로(`domain/derived.ts`),
ledger에 그 operation이 없거나 그 plan이 이 artifact를 가리키지 않으면 accept되지 않은 것이 확정된다. broker는
**시작 복구에서, 요청을 받기 전에**(broker-lifetime의 recover 단계) broker 자신이 직접 쓴 artifact만 이렇게 판정해
정리한다. 자식 프로세스가 쓰던 staging(quarantine namespace, context commit-work, workspace clone)은 broker lock이
자식의 죽음을 증명하지 않으므로 보존한다(P0-4 "불명확이면 보존"). 실행 중에는 수집하지 않는다(처리 중인 요청의
artifact일 수 있다).

**바꾸는 규범.** 없음(FS-006, MAIL-010, INV05의 구현). 이 문서가 판단을 기록한다.

## DR11 — receipt는 그 session entry가 durable해진 뒤에만 있다

**관측(P0V-13).** receipt는 fsync와 parent flush로 게시되지만, 그것이 가리키는 session entry는 Pi가
`appendFileSync`로만 쓰고 fsync하지 않는다. 게시와 검증은 session 파일이 있는지만 보았다. 전원이 나가면 "batch가
session S의 entry X에 있다"는 durable fact가 재시작 뒤 거짓이 되고, batch는 완료되었으므로 다시 전달되지 않는다.
BATCH-006은 이미 "durable session file"을 요구한다.

**결정.** receipt 게시의 owner(`publishDeliveryReceipt`, Resident runner와 Principal host가 함께 쓴다)가 최종
이름을 만들기 전에, session 디렉터리 아래에서 링크를 따르지 않고 session 파일을 열어 끝의 bounded 구간에서
boundary entry(entry id, batch id, 시도, customType)를 찾고, 파일과 디렉터리를 fsync한다. 찾지 못하면 receipt를
만들지 않는다(SESSION_BOUNDARY_UNCONFIRMED → 재전달 정책). 관측 쪽(나중의 정산)은 session이 그 뒤로 길어질 수
있으므로 파일의 존재만 본다. entry의 영속은 게시가 이미 증명했다.

**바꾸는 규범.** 없음(BATCH-006의 구현). S-03의 나머지(steer 동시성, 전체 kill matrix)는 여전히 OPEN이다.

## DR12 — 설정 commit의 owner는 하나다

**관측(P0V-12).** 설정 쓰기 경로가 둘이었다. bundle은 관리형 generation commit(기대 버전 확인, production
loader 재현 증명, 결과 불명 기록)이었고, inline `config.json`은 검증 뒤 파일 교체뿐이었다. inline에는 lost update
방지도 loader 재현 증명도 없었고, rename 뒤 flush가 실패하면 "저장 안 됨"처럼 보고했다. "같은 의미" 판정도 두 벌이었다.

**결정.** D02가 inline에 대해 정한 "validate → 같은 파일 durable replace"는 유지하되, 그 교체를 관리형과 같은
owner가 같은 순서로 한다: 읽은 snapshot의 기대 버전 확인 → 전체 검증 → 임시 파일 → production loader로 임시 파일을
다시 읽어 후보와 같음을 증명 → 기대 버전 재확인 → rename(commit point) → parent flush, 실패하면 결과 불명으로 기록하고
다음 편집 전에 다시 flush한다. "같은 의미"는 한 함수가 정한다(policy revision만 뺀 전체 설정과 role). 처음 만드는
설정은 no-replace로 게시하고, 이미 있으면 그것을 읽는다. 성공한 설정은 언제나 다시 로드된다(P0-3).

읽는 쪽도 같은 규칙을 따른다(P0V-24, 14차 실제 provider 점검): Control Panel은 저장을 시도할 때마다(commit, 거절, 영속성 불명) 설정을 다시 읽는다. 그래서 "읽은 뒤 바뀜"으로 거절된 뒤에는 파일이 지금 가진 값을 보여 주고, 다음 편집을 그 값에서 만든다.

**바꾸는 규범.** 없음(D02·CONFIG-CONTRACT의 writer 순서를 inline에도 적용한다).

## DR13 — 모르는 것에는 모른다는 코드를 붙인다

**관측(P0V-08, P0V-09, P0V-11, P0V-14, P0V-15, P0V-18–P0V-23, P0V-12 보완).** 관측 실패나 결과 불명에 확정 사실의 코드나 값을 붙이는 곳이
있었다: 설정을 읽지 못한 것을 POLICY_CHANGED로(accept된 통합이 영구 실패), accept 뒤 결과가 불명확한 실패를 CLI
exit 2로, 끝나지 않은 systemctl을 UNSUPPORTED_PROFILE로, 도구가 끝낸 CLI를 key 없는 실패로, 관측하지 못한
workspace 파일을 0 byte로, Control Panel의 불명 코드를 exit 2로, 다시 읽지 못한 설정 파일을 "바뀜"으로.

**결정.** 각 경계에서 한 owner가 "모름"을 한 가지로 표현한다.

| 경계 | 모를 때 | 아는 사실일 때 |
|---|---|---|
| host 정책 reader(통합, 자식 spec) | BROKER_UNAVAILABLE. accept된 통합은 pending으로 남아 복구가 다시 본다 | 읽었고 다르면 POLICY_CHANGED |
| CLI 실패의 exit(CLI-003) | retry가 same-key·after-repair면 3 | retry never면 코드의 exit(2 또는 4) |
| Control Panel(`oma`)의 exit | 같은 `errorExit`. 코드가 없는 실패는 INTERNAL_ERROR(3), "잠시 후 다시"는 BROKER_UNAVAILABLE(3), 보증할 수 없는 바인딩은 STORE_CORRUPT(3) | usage·다른 society/프로젝트의 바인딩은 INVALID_REQUEST(2) |
| 설정 편집의 기대 버전 확인 | 파일을 지금 읽지 못함: BROKER_UNAVAILABLE, 쓰지 않음 | 없어졌거나 bytes가 다름: POLICY_CHANGED |
| unit 명령(systemctl) | DEADLINE_EXCEEDED(명령이 끝나지 않음) | 끝나서 실패하면 INTERNAL_ERROR/START_LIMIT, 불러올 수 없는 unit은 UNSUPPORTED_PROFILE |
| extension 도구가 부른 CLI | 결과 불명, 실패 문구에 request key | CLI가 스스로 낸 출력 |
| workspace 크기 관측 | 한도 초과로 보고 거절 | ENOENT는 없음(0) |

**일반 규칙(2차 점검, P0-6).** 위 표는 경계마다 규칙을 적었다. 2차 점검에서 같은 모습이 스무 곳 넘게 다시 나왔다. 관측하지 못한 디렉터리를 손상으로, 배포 파일을 지원 안 함으로, 목록을 0으로, 영속성 불명 저장을 저장 실패로 적은 곳들이다. 그래서 경계별 규칙이 아니라 모델 하나로 바꾼다.

- 로컬 관측이 errno로 실패했을 때, 그 errno가 이름 자체에 대한 답(ENOENT·ENOTDIR·ELOOP·EISDIR·ENAMETOOLONG)이면 호출자가 그 사실의 뜻(없음, 종류가 다름, 설정이 가리키는 파일이 없음)을 말한다.
- 그 밖의 errno(EACCES·EIO·EMFILE 등)는 관측이 답하지 않은 것이다. `unobserved`(domain/errors.ts) 한 함수가 이것을 BROKER_UNAVAILABLE("cannot be observed now", transient, exit 3)로 읽는다. 바뀜·잘못됨·손상·지원 안 함으로 읽지 않는다. 목록이면 0이나 빠짐이 아니라 "일부만 봄"이다.
- commit point를 지났고 영속성만 불명인 게시는 `publishedUnconfirmed` 한 함수가 읽는다. 어느 표시도 이것을 "저장 안 됨"으로 말하지 않는다.
- STORE_CORRUPT는 broker의 sticky fence를 닫는다(domain/admission.ts). 그러므로 읽은 내용이나 답한 errno가 손상을 말할 때만 쓴다.

**바꾸는 규범.** 없음(CLI-003, ERR-002, INV02의 구현).
