# 설계 수정 기록

이 문서는 **결정 기록**이다. 각 상태와 날짜는 작성 당시의 판단이며 현재 실행 판정은 validation이 소유한다([문서 지도](README.md)).
결함이 코드 한 곳이 아니라 설계의 선택에서 나온 경우를 설계 수준에서 다시 판단한다. 각 항목은 관측, 원인, 결정, 바꾸는 규범,
바꾸지 않는 것을 적는다.

- DR1–DR7은 실제 provider 점검에서 AV9–AV31([consistency-decisions](implementation/consistency-decisions.md)의 AV 절)을 고치다 나왔고, DR8은 그 수정을 다시 점검하다 나왔다.
- DR9–DR13은 [Priority 0](PRIORITY-0.md) 파일 단위 점검([priority-0-audit.md](priority-0-audit.md))에서 나왔다. DR14는 그 4차 점검(외부 전수 검토)이 남긴 판단이다. DR15는 시나리오 시험이 찾았다. DR16은 5차 점검(외부 재검토 R03)에서, DR17은 6차 점검(R6-07)에서 나왔다. DR18은 열려 있던 spike와 결정(사용자가 맡긴 선택, 2026-09-27)을 닫은 기록이며 macOS 플랫폼 규격을 수용한다.
- DR19는 2026-09-28 적대적 검토의 경계·게시·수명 결함을 기존 P0 원칙으로 정리한다.
- 규범 문장의 owner는 [문서 지도](README.md)의 주제별 기준을 따른다. `architecture.md`는 N-001이 bytes를 결박하므로 고치지 않고, 어긋나는 architecture 문장은 해당 DR에 적는다.
- 초반 표는 DR1–DR19 당시의 기록이다. 이후 wire·DB·권한 변경은 각 후속 DR을 따른다.

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
| DR14 | P0-4를 실행 중 자원에도 적용하고, 결과 크기(P0V-44)는 v1 receipt 안의 수용 한계로 두며, unit 이름은 그대로 두고 겹침을 거절한다 | PRIORITY-0 P0-4 |
| DR15 | 엔진 이벤트 한 줄이 frame보다 크면 건너뛰고 알린다(형식 오류는 전처럼 중독) | R28 결정, MAINTENANCE §19 |
| DR16 | rootfs 수리는 이전 Resident의 종료가 증명된 뒤, 어떤 Resident도 깨어나기 전에(broker startup 안에서) 한다 | REC-007의 수리 순서 문장 |
| DR17 | 끝나라는 신호는 잡을 수 있는 종료 신호 전부이고, drain이 있는 모든 프로세스가 그 목록 하나로 drain을 밟는다 | AV31의 신호 목록, screen.ts의 "unconditional" 문장 |
| DR18 | 열린 spike와 결정을 닫는다: v1이 하는 것과 하지 않는 것을 정하고, 하지 않는 것은 알려진 미지원 설정으로 거절한다. macOS 플랫폼 규격을 수용한다 | SP-001, S-01-CANDIDATE, S-03, INT-001, PI-003, SB-001, SB-002, SB-004, INF-001, REC-004, PRODUCT·README의 설치·로그인·비용, macos-platform 전체 |

| DR19 | kernel 효과의 모든 진입점, 원자적 게시와 자원 수명, receipt 자체의 완료 증거, unknown의 비승격을 같은 owner에서 판정한다 | SB-001, MAC-205, BATCH-006, TUI-002, IPC-004/006/008; read wire 확장, DB·저장 receipt 유지 |

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

## DR14 — 4차 점검이 남긴 세 판단

**관측(4차 점검, priority-0-audit "4차 점검").** 외부 전수 검토를 판정한 4차 점검은 고치지 않은 발견 하나(P0V-44)와 고친 범위가
좁은 발견 하나(P0V-26), 그리고 원칙 문장에 대한 관찰 하나를 남겼다. 사용자가 판단을 맡겼다(2026-09-27).

**결정 1 — P0-4는 실행 중 자원에도 적용된다.** 4차 점검의 여섯 발견(P0V-25, 27, 34, 49, 50, 52)은 accept 전 artifact가 아니라 FD,
자식 프로세스, 저장 예약, provider 호출, listener에서 같은 모양을 보였다: 자원이 생긴 순간부터 끝날 때까지 한 owner가 있어야 하고,
넘길 때는 소유가 넘어가며, 반납은 한 번이다. P0-4의 문장이 artifact만 말해 이 여섯은 "넓혀 읽어" 분류됐다. PRIORITY-0의 P0-4에
그 적용을 한 항목으로 더한다. P0-4의 뜻(수명의 owner를 명시한다)은 그대로이고 적용 범위를 적은 것이다(P0D-14와 같은 종류).

**결정 2 — 결과 크기는 v1 receipt 형식 안에서 한계로 둔다(P0V-44, N21).** stop receipt의 `remainingOperations`는 그 시점에 미해결인
operation 전부이고, `status.get`은 은퇴한 행까지 모든 agent를 담는다. 둘 다 개수에 상한이 없고, 응답이 frame을 넘으면 효과가 끝난
요청에 FRAME_TOO_LARGE가 답해진다. 기본 frame 256 KiB에서 실제 encoder로 잰 수용량은 status가 agent 1052개, stop receipt가
미해결 operation 6235개다. 고치려면 durable receipt의 뜻(목록의 일부만 담기)이나 wire 형식(페이지)을 바꿔야 하고, 그것은 receipt
version을 올리는 계획으로만 한다(PRIORITY-0 명제: 기록된 receipt의 의미를 바꾸지 않는다). 그래서 v1에서는 바꾸지 않고, 수용량을
validation의 알려진 한계에 수치로 적는다. P0V-44의 판정은 **의도된 예외**이며 owner는 이 결정이다.

**결정 3 — unit 이름은 UNIT-001 그대로 두고, 겹침은 거절한다(P0V-26, N02).** 이름을 단사로 만드는 방법(구분자 바꾸기, tuple digest)은
모두 이미 설치된 unit의 이름을 바꾸므로, 실행 중인 society의 정지·복구를 옮기는 전환 절차가 함께 있어야 한다. 겹침은 두 society가
같은 사용자 아래 서로의 prefix인 이름을 가질 때만 생기고, P0V-26 뒤로는 다른 owner의 unit을 덮지 않고 AGENT_CONFLICT로 거절하며
agent 생성은 접수 전에 거절한다. 이름 체계의 변경은 installation 형식 변경과 함께 계획한다.

**바꾸는 규범.** PRIORITY-0 P0-4(적용 범위 한 항목). spec 조항은 바꾸지 않는다.

## DR15 — 엔진 이벤트 한 줄이 frame보다 크면 건너뛰고 알린다

**관측(시나리오 시험 SCN-F13, SCN-F17, SCN-R06; P0V-55).** 엔진의 RPC 이벤트는 모델이 쓴 것을 담는다. 도구 호출 전체를 담은
`message_end`, 인자를 담은 `tool_execution_start`가 그렇다. 모델이 frame(기본 256 KiB)보다 큰 파일이나 답을 만들면 그 이벤트 한 줄이
reader의 한도를 넘었고, reader는 전송을 중독시켰다. Principal 세션은 오류로 끝났고 Resident의 run도 같은 이유로 끝났다. 큰 파일을 한
번에 쓰는 평범한 작업이 세션을 죽였다.

**원인.** R28의 규칙("크기 초과·형식 오류·끝나지 않은 줄은 재동기화하지 않고 중독")이 두 가지를 한데 묶었다. 형식 오류 뒤에는 다음
경계를 믿을 수 없다. 반면 JSONL에서 크기만 큰 줄은 형식이 온전하다. JSON은 문자열 안의 LF를 모두 escape하므로 다음 LF가 그 줄의 끝이다.
그 줄을 건너뛰는 것은 추측이 아니라 정확한 경계다. 크기 초과를 엔진 고장으로 올린 것은 P0-5 위반이다("큰 이벤트"는 "고장"이 아니다).

**결정.** 엔진 채널의 reader(PiRpcClient)는 한도를 넘는 줄의 바이트를 보관하지 않고 다음 LF까지 건너뛰며, 그 크기를 관찰자들에게 한
이벤트(`oma_event_skipped`)로 알린다. 메모리는 한도 안에 머문다. Principal 화면은 이벤트 하나를 보이지 못했다고 말한다. 전달 판정은
영향을 받지 않는다. 전달 경계와 응답·settle 이벤트는 작고, 건너뛴 `message_end`의 stopReason은 "모름"으로 남아 경계가 없으면
SESSION_BOUNDARY_UNCONFIRMED(재시도 대상)가 된다. 형식 오류(UTF-8·JSON·이벤트 모양)와 끝나지 않은 줄은 전처럼 중독이다. 콜백 없이
만든 reader(다른 용도)는 여전히 크기 초과도 중독이다.

**바꾸는 규범.** R28의 결정(consistency-decisions의 jsonl 행)과 MAINTENANCE §19의 해당 문장. spec 조항은 바꾸지 않는다.

## DR16 — rootfs 수리는 이전 Resident의 종료가 증명된 뒤에 한다

**관측(5차 점검 R03, P0V-58).** foreground broker는 drain에서 Resident를 멈추고 죽음을 증명한다. 증명하지 못해도 그 실패를
로그에만 남기고 성공으로 끝났다. 이 mode의 Resident unit에는 BindsTo 대상이 없고, society lease도 상속하지 않는다(REC-007의
sandbox 예외). 그래서 다음 `oma`는 lease를 잡고, broker가 startup quiescence로 그 Resident를 멈추기 **전에** rootfs를
수리했다. broker가 SIGKILL로 죽어 drain이 아예 없는 경우도 같다.

**원인.** REC-007은 수리를 "broker보다 먼저"라고 적었다. 목적은 수리되지 않은 rootfs 위에서 Resident가 깨어나지 않게 하는
것이었다. 그런데 이 순서는 수리의 다른 전제, 즉 그 rootfs 위에서 아무것도 돌지 않는다는 것을 증명하지 못한다. 증명은 broker의
startup quiescence가 한다. REC-007이 막으려던 경쟁(수리 중인 rootfs 위에 sandbox를 짓는 것)이 이전 Resident의 재시작과 path
unit으로 그대로 남아 있었다.

**결정.** 수리는 broker startup 안에서 한다. quiescence(이전 Resident마다 정지와 죽음 증명)가 끝난 뒤, bootstrap·recovery·listen·
activate보다 먼저다. broker는 host가 시작했든(lease 상속) systemd가 시작했든(lease를 스스로 잡음) lease 보유자이므로 "수리는 lease
보유자만"도 그대로다. 수리한 항목은 broker의 stderr로 나가고, host는 이를 화면에 한 줄씩 보인다. 수리에 실패하면 startup이 실패하고,
broker는 준비를 알리지 않으며, engine도 시작하지 않는다. drain이 Resident의 종료를 증명하지 못하면 Store와 lock을 놓되 그 실패로
끝나고(RUN_TERMINATION_UNKNOWN, entry는 exit 1), 증명되지 않은 것을 성공이라고 말하지 않는다(P0-5). host는 이제 없는 것만 만든다
(provision). 세대 수집은 host에 남긴다. 살아 있는 Resident는 설정 세대를 다시 읽지 않고, broker startup에서 수집하면 이미 떠 있는
Control Panel의 편집과 경쟁한다.

**바꾸는 규범.** implementation-spec REC-007의 수리 순서 문장.

**바꾸지 않는 것.** lease 규칙, provision/repair의 두 정책, UNIT-004의 BindsTo, 수리 대상과 방법.

## DR17 — 끝나라는 신호는 종료 신호 전부이고, drain이 있는 프로세스는 모두 그 목록으로 끝난다

**관측(6차 점검 R6-07, P0V-81).** `oma` TUI는 SIGINT와 SIGTERM만 잡았다. 다른 프로세스가 보낸 SIGHUP·SIGQUIT에서는 Node가
기본 동작으로 끝나 `exit`가 돌지 않았다. raw mode·대체 화면·bracketed paste가 켜진 채 셸로 돌아갔고, TUI-004의 종료 순서(engine을
거둔 뒤 lease 반납)도 밟지 않았다. screen.ts는 복원이 "unconditional"이라고 적었지만 참이 아니었다. 같은 종류를 찾으니 Mac의 attach
client(raw mode를 켠다)는 신호를 하나도 잡지 않았고, Resident runner와 Mac service는 SIGTERM(과 SIGINT)만, guest의 session
holder는 SIGTERM만 잡았다. broker만 AV31의 `stopOnHostLoss`(SIGTERM·SIGINT·SIGHUP)를 썼고, 그 목록에도 SIGQUIT이 없었다.

**원인.** AV31은 "host가 사라지는 모든 길은 drain을 밟는다"를 broker 하나에 적용했다. 목록은 그때 관측한 신호였지, 무엇이 목록에
드는지의 정의가 아니었다. 다른 프로세스는 각자 신호를 골랐다.

**결정.** `HOST_LOSS_SIGNALS`는 프로세스가 잡을 수 있는 종료 신호 전부다(glibc의 "Termination Signals"에서 SIGKILL을 뺀 SIGTERM·
SIGINT·SIGHUP·SIGQUIT). drain이 있는 프로세스 -- broker, Resident runner, `oma` TUI, Mac service와 attach client, guest session
holder -- 는 모두 이 목록 하나로 drain을 밟는다(`stopOnHostLoss`, 또는 목록을 도는 loop). attach client는 신호를 연결이 닫힌 것처럼
받아 같은 복원 경로로 화면을 돌려놓고 `stopped`로 끝난다(session은 계속 돈다). screen.ts의 문장은 "이 프로세스가 보는 모든 끝에서
복원한다. SIGKILL과 치명적 abort는 아무도 보지 못하므로 society는 fence(REC-007)가, 터미널은 셸의 `reset`이 맡는다"로 고친다.
architecture 규칙 `host-loss-signals`가 이것을 붙든다. 목록의 내용, 신호 하나만 따로 다루는 handler(어디서든), drain이 있는 프로세스가
목록을 쓰지 않는 것을 거절한다.

**바꾸는 규범.** consistency-decisions AV31 행의 "(SIGTERM, SIGINT, SIGHUP)"와 적용 범위(broker). TUI-002를 구현한 screen.ts의
"unconditional" 문장.

**바꾸지 않는 것.** 각 프로세스의 drain 내용과 순서(TUI-004, D03, LIFE-006), 두 번째 신호의 뜻(broker는 once, TUI는 같은 종료를
기다림), exit code.

## DR18 — 열린 spike와 결정을 닫는다

**관측.** 6차 점검과 macOS 구현 뒤에도 결정 없이 열린 것이 남아 있었다. [spikes](verification-spec.md#qualification-계약)의 S-01–S-11은 SP-001에 따라 모두
`OPEN`이었다. 코드에는 `SPIKE_UNRESOLVED`로 막힌 경로가 셋 있었다(`integration.checks`, `sandbox.candidate`, `git.runCheck`).
[macOS 규격](macos-platform.md)은 초안이었고 §12의 D-1·D-4·D-5·D-7·D-8·D-9·D-10과 §13의 Q1–Q9가 결정을 기다렸다. 그 밖에 Principal의
topic follow(도구는 있고 규범은 막는다), 설치 명령(C2), 로그인 표면, PRODUCT의 "비용 상한"이 열려 있었다. 사용자는 2026-09-27에 이
선택을 맡겼다("모든 구현 스파이크, 정해지지 않은것을 너가 임의로 잘 선택해서 닫아").

**원인.** 열린 항목은 둘 중 하나로 남아 있었다. 코드가 `SPIKE_UNRESOLVED`로 막거나(그러면 설정한 사람은 무엇이 언제 풀리는지 모른다),
규범끼리 어긋난 채 두 답이 공존했다(topic: MAIL-001/002는 Principal에게 commons를 보내지 않는데 `oma_route`는 follow를 제안했다).
"v1이 하지 않는다"는 결정 자체가 내려지지 않았기 때문이다.

**원칙.** 각 항목을 "v1이 한다(증거와 함께)"와 "v1이 하지 않는다(알려진 미지원 설정으로 거절하고 이유를 말한다)"로 닫는다. 하지 않는
것을 조용히 비우거나(checks를 `[]`로) 약한 보장으로 바꾸지 않는다(SP-003, REC-004). 정할 때는 비슷한 문제의 기존 답을 따른다.

**결정.**

| 항목 | 결정 | 근거(비슷한 답) | 증거 | commit |
|---|---|---|---|---|
| topic follow | Principal은 topic을 follow하지 않는다. `oma_route`를 Principal 도구에서 뺀다. Resident가 아닌 actor의 새 `follow`는 기록 전에 `CAPABILITY_DENIED`로 거절한다(이미 받은 요청의 replay는 그 receipt로 답한다). MAIL-002("호출 Resident 자신의 subscriptions")의 구현이며 규범은 그대로다. 지금까지는 받아들이고 아무것도 배달하지 않는 구독이었다 | MAIL-001/002, SP-02-A(commons 자동 주입 0건), S-09가 재는 "Principal에 들어간 양" | `DR18 / MAIL-001/002:`, principal-tools 시험 | `42b238f` |
| S-01-CANDIDATE, `integration.checks` | v1은 통합 검사를 스스로 돌리지 않는다. candidate는 만든 곳(그 Resident의 sandbox)에서 시험하고, 통합은 CAS와 보호 경로로 결정한다. checks를 적은 설정은 `UNSUPPORTED_PROFILE`("remove integration.checks")로 broker 시작 때 거절하고, `sandbox.candidate`와 `git.runCheck`도 `UNSUPPORTED_PROFILE`이다. `SPIKE_UNRESOLVED` 경로는 없어진다 | candidate별 kernel 자원 한도가 검증되지 않은 채 host에서 candidate 코드를 돌리는 것은 검사가 없는 것보다 나쁘다. 사람이 쓰는 CI는 게시된 ref(`refs/oma/published/*`)를 그대로 받는다 | `DR18 / S-01-CANDIDATE:`, T62, r19·r28 | `42b238f` |
| 보호 경로 `/` | `/`는 트리 전체를 보호한다: candidate의 모든 변경이 `PROTECTED_PATH`다. 막아 둔 표기가 아니다 | 경로 prefix 규칙의 자연스러운 끝 | 같은 시험 | `42b238f` |
| C2 설치 | `package.json`의 `bin`이 `oma`를 `dist/src/entry/oma.js`로 둔다. checkout에서 `npm install -g .`가 `oma` 명령을 설치한다. `check-package`가 bin이 layout의 TUI entry와 같고 entry에 shebang이 있는지 본다 | npm 패키지의 표준 설치 경로 | check-package, T119 | `78658c7` |
| D-9 로그인 | `oma login`이 동봉 엔진의 대화형 모드를 이 society의 엔진 디렉터리 위에서 연다. 사람은 엔진 자신의 로그인·model 선택을 쓴다. OMA는 인증 화면을 만들지 않고, society의 session은 계속 RPC 모드로만 돈다. 로그인은 society lease를 쥔다(돌고 있는 society에는 "이 society가 실행 중입니다"로 거절). macOS에서는 같은 흐름이 host의 엔진 상태(MAC-704) 위에서 돈다 | PRODUCT의 두 요구를 둘 다 지키는 유일한 표면: 엔진의 흐름을 쓰되 session 밖에서 | `DR18 / D-9:`, T119 | `78658c7` |
| D-5 | 모든 Resident sandbox가 `AF_VSOCK` socket을 거절하는 seccomp filter를 싣는다(Linux 포함). bwrap `--seccomp 3`, filter는 fd 3의 channel로 넘긴다 | vsock은 network namespace로 막히지 않는 kernel이 있다(MAC-205). 해가 없다 | SCN-C08(`Seccomp: 2`), MAC-205 시험 | `37293f3` |
| D-10, D-4 | guest의 runner와 Principal 엔진은 guest의 egress service(§4.7)로 provider에 닿는다. 배포본의 표지는 guest image의 user manager 환경(`environment.d`의 `OMA_EGRESS_SOCKET`)이다. 설정 field·unit 인자·manifest를 늘리지 않는다. 그 이름이 있으면 run은 host에 자리표시자를 받고 relay 자리에 forwarder를 연다. INF-001의 "OMA 소유 agent 디렉터리"는 credential 저장소로 host Keychain backend를 포함하도록 넓힌다 | 환경은 systemd가 unit에 주는 기존 경로다. schema·wire 변경이 없다 | `platform-egress` D-10 시험 | `51c5ada` |
| D-8 | 사람의 project를 bare mirror(`repos/project-mirror.git`)로 두고 `oma`가 시작할 때마다 `refs/heads/*`를 fetch한다(fsck, file protocol만). Resident sandbox에 `/git/project-mirror.git`으로 읽기 전용 bind한다(`--ro-bind-try`). actor는 거기서 fetch하고 기존 `git.submit`으로 게시한다. 권한·wire 변화가 없다 | §13 Q8의 기본 제안. 사람 권한의 게시는 새 actor 종류다 | `DR18 / D-8:`, SCN-C09, r28 bind | `83ff797` |
| D-7 | 경과 시간은 monotonic clock으로 잰다(MAC-650의 세 곳). 이미 구현했다 | 시계 조정은 Linux에도 있다 | MV-06 시험 | 이전 커밋 |
| D-1 | 오류의 말은 한 곳(`src/tui/words.ts`)에서 읽는다. Linux에서는 사람 자신의 경로와 이름이므로 그대로 보인다. guest의 terminal session(`OMA_PRODUCT_TEXT=1`) 아래에서는 Linux 경로·unit 이름·errno 이름이 든 말을 오류 코드로 바꾸고 원문을 guest 로그에 한 번 쓴다. 그 프로그램의 stderr는 session holder의 것(journal)이고, 사람에게 가는 실패 문구는 stdout으로 간다. 규칙 `error-words-owner`가 `oma` 프로세스의 다른 파일이 오류의 말을 스스로 읽지 못하게 한다 | MAC-001의 이유(VM을 드러내지 않는다)는 Linux에 없다 | `DR18 D-1:`, `error-words-owner` | `2d45b82` |
| Q1–Q3, Q5–Q7 | §13의 기본 제안을 채택한다. Q7(진단 묶음을 받는 곳)은 이 저장소의 GitHub issue이며, 사람이 직접 붙인다(MAC-641) | — | — | 이 문서 |
| Q4 | Keychain service와 access group은 `io.github.minjung2035.oma`다. Team ID는 서명하는 주체의 것이다 | 도메인이 없는 프로젝트의 역DNS 관례(Flatpak의 `io.github.<user>.<app>`) | — | `2d45b82` |
| Q8, Q9 | D-8, D-9와 같다 | — | — | — |
| S-01 | 결정된 substrate(systemd+bwrap+SQLite+koffi leaf)를 v1 기반으로 확정한다. 같은 UID 외부 writer, kernel project quota, 전체 FD/PID stress는 알려진 한계로 남기고 gate로 쓰지 않는다 | spikes의 S-01 기록 | kernel lane | — |
| S-02 | 닫는다. OMA가 session을 띄우므로 외부 session attach는 범위 밖이다 | IPC-011 | T114, SCN-B09(모델이 credential을 어떤 경로 표기로도 읽지 못한다), SCN-B10(commons 100통 + 질문 1통 → Principal에 1통) | `ac477da` |
| S-03 | v1은 followUp만 쓴다. batch는 activation 때 준비되고 terminal boundary(`agent_settled`)의 receipt로 완료한다. run 도중 도착한 mail은 다음 run의 batch다. run 중 `steer`는 v1 기능이 아니다: pinned 엔진에서 run 중에 넣은 custom message를 batch에 durable하게 귀속시킬 경계가 receipt 하나(`agent_settled`)뿐이기 때문이다. 대가는 지연(현재 run의 남은 시간)이며, 순서와 정확히 한 번의 귀속은 지켜진다. steer는 SP-03-T의 항목을 진입 조건으로 하는 v2 후보다 | architecture §7의 steer 문장은 N-001로 고치지 않는다. 이 DR이 v1과의 차이다 | `S-03: only the pinned durable Pi boundary receipt…`, T31-neg, SCN-S03, SCN-F16, crash-kill의 receipt 경계 | — |
| S-05 | 닫는다. 손상 pack, `fsck --strict`가 거절하는 object, 압축이 큰 blob(object는 압축된 채 저장되므로 저장소는 pack만큼 자란다), 추가 ref가 든 bundle을 거절하거나 한도 안에 둔다. bundle 크기는 CLI의 `OMA_BUNDLE_BYTES`가 묶는다 | git 자체의 quarantine과 fsck | `S-05:` 세 시험, GIT-006 시험, durable-boundaries의 git 경계 | `ac477da` |
| S-06 | process crash는 닫는다: durable 경계 64개 가운데 44개가 SIGKILL로 시험된다. state는 local kernel file system에 있어야 한다. NFS·SMB/CIFS·FUSE(virtiofs 포함)·9P·Ceph·AFS·Coda·NCP는 시작 때 `UNSUPPORTED_PROFILE`로 거절한다(SQLite WAL은 network file system을 지원하지 않고, 사망 증명은 kernel이 `flock`을 놓는 것에 기댄다). 전원 장애·ENOSPC·read-only remount는 release gate로 남고(powercut lane, 승인된 VM 필요), 그 전에는 REC-004대로 "전원 장애에도 유실 없음"을 말하지 않는다 | SQLite 문서의 WAL 조건 | `DR18 / S-06:`, `state-root-judgement`, durable lane | `f4b7276` |
| S-07 | notmuch와 reflink는 v1에 없다(꺼 둔다). project egress(의존성 fetch proxy)도 v1에 없다. provider로 가는 길은 relay(INF-005)와 macOS의 §4.7뿐이다 — project egress 부분은 DR34(UX-08)가 v0.1의 OPTIONAL CONNECT proxy로 supersede한다 | SP-07-A의 "결과가 없으면 꺼 둔다" | — | — |
| S-08, S-10, S-11 | tiered integration, attestation, challenge·floor, fresh verifier는 v1에 없다. base profile의 보호 경로 거절이 그대로 남는다 | integration-policy | 기존 base profile 시험 | — |
| S-09 | v1은 성능 주장을 하지 않는다. 문서는 Principal token 감소나 품질을 달성한 것으로 말하지 않는다. 평가 protocol은 v2의 측정 과제다 | SP-09-A | — | — |
| 비용 상한 | v1에는 없다. OMA는 relay에서 요청 수와 동시성을 쥐지만 돈을 세지 않는다. provider 계정의 한도가 적용된다 | INF-001(해석은 엔진의 것) | — | — |
| macOS 규격 | [macos-platform](macos-platform.md)을 수용한다(상태 ACCEPTED). traceability의 `normativeSources`에 넣는다. MV oracle은 그 ID로 남기고 [test-matrix](verification-spec.md#oma-core-v1--검증-계약)의 platform 절이 lane과 시험에 잇는다. `platform` lane을 등록한다 | 규격 머리의 수용 절차 | `verify:platform` | 이 문서 |

**바꾸는 규범.** SP-001(모든 항목 `OPEN` → 항목별 판정), S-01-CANDIDATE와 INT-001의 "fixed host checks"(v1은 checks를 거절한다),
S-03과 PI-003(followUp만), SB-001(seccomp filter), SB-002(mirror mount), SB-004(project egress는 v1에 없다 — 이후 DR34가 OPTIONAL CONNECT egress로 다시 고쳤다), INF-001(credential
저장소), REC-004(지원 file system), PRODUCT·README의 설치·로그인·비용 문장, macos-platform §12·§13.
architecture §7의 steer 문장과 §16의 candidate 검사 문장은 N-001 때문에 고치지 않고 여기에 차이를 적는다.

**바꾸지 않는 것.** wire·DB schema·receipt 형식, 여섯 durable entity, base profile의 보호 경로 거절, relay의 credential 규칙(INF-005,
INF-007), 권한 표(AUTH-001), MAIL-002(이미 follow를 Resident의 것으로 적는다).


## DR19 — 경계에서 효과·사실·수명을 같은 규칙으로 판정한다

**관측.** 7차 적대적 검토는 syscall의 다른 진입점, host 파일의 부분 게시, 이벤트 콜백의 예외,
모델이 지울 수 있는 session 파일을 통해 기존 P0 명제가 깨지는 경로를 찾았다.
세부 항목과 재현·시험의 대응은 [priority-0-audit](priority-0-audit.md)의 7차 점검이 소유한다.

**원인.** syscall 번호를 효과로, 파일 존재를 완료로, 현재 mutable 파일을 과거 사실의 증거로,
이름의 현재 소유자를 이전 실행의 사망 증거로 취급했다. 수명과 판정의 owner도 일부 경로에서 갈라졌다.
새 카드별 원칙을 만들지 않고 P0-1·P0-2·P0-4·P0-5·P0-6·P0-7을 적용한다.

**결정.**

| 경계 | 적용할 기존 원칙과 결정 |
|---|---|
| sandbox kernel 효과 | SB-001의 AF_VSOCK 차단은 socket 계열뿐 아니라 io_uring 진입도 막는다. native ABI만 허용하고 x32는 거절한다. 공유 kernel 객체(keyring·bpf·perf·userfaultfd)도 목록에 포함한다. filter 전달은 process/async 한 owner다 |
| host 게시·stream | P0-4/5: 완성한 temporary → file flush → no-replace 게시 → parent flush. record 교체도 같은 owner. 오류는 Promise 실패로 전달하고 자원을 반납한다. archive 평문은 disk에 쓰지 않는다. 단일 host lock과 시작 시 temporary 회수가 수명을 닫는다 |
| snapshot 순서 | P0-1: 보존 순서는 이름의 sequence다. 벽시계·clone의 mtime은 생성 순서가 아니다 |
| delivery receipt | P0-1: DR11의 session boundary 확인은 게시 전 조건이다. 게시 후 정산은 receipt bytes·batch 관계·lexical sessionPath로 판정한다. 나중의 session 삭제·권한 변경으로 유효 receipt를 hold로 바꾸지 않는다 |
| tool request | P0-4/5: 명시 key가 없으면 session·tool·canonical args·기록된 같은 호출의 결과 수로 key를 만든다. 결과가 기록되지 않은 같은 호출은 같은 key이며, 결과가 있는 뒤의 새 호출은 새 key다. Pi의 dangling call 처리를 고려하며 의미가 다른 인자까지 자동으로 같은 요청이라 추정하지 않는다 |
| 자원 owner | P0-4: HostTenure가 engine·lease·egress를 같이 반납한다. socket startup 청소는 한 helper이고 종료 시 이름은 Node server.close가 반납한다. 임의 같은 UID writer와의 원자적 unlink를 보장하는 것은 아니다 |
| 요청과 관측 | P0-5/6: JSON container nesting은 root 포함 64라는 한 상한. pidfd가 아닌 fd는 사망 증거가 아니다. foreign unit은 diagnostics에서 no-unit이나 사망·빈 process list의 증거는 unknown이다. foreign unit을 stop/disable하지 않으면서 종료 미확정을 반환한다 |
| provider 주소 | P0-5: extension 초기화는 비동기로 listen을 기다린다. 그 전에는 unreachable 주소이며, 확보한 loopback 포트만 등록한다. 계획한 포트 충돌 시 kernel 할당 포트로 재시도하고, 실패해도 override를 없애 relay 밖 provider를 복구하지 않는다 |
| 응답 크기 | P0-5: dispatch 후 FRAME_TOO_LARGE는 요청 미실행의 증거가 아니므로 same-key로 분류한다. actor/key에 묶인 operation.read로 원본 receipt JSON을 SHA-256/offset 조각으로 조회한다. CLI는 원 요청과 같은 deadline 안에서 최대 64 MiB를 조립하며 단절·버전 변경·초과를 미접수로 읽지 않는다. DB receipt를 줄이거나 terminal outcome을 다시 쓰지 않는다 |
| incarnation 준비 | P0-4: openRun은 endpoint의 실제 listening을 await한 뒤 admission·drain·run identity·invocation/cgroup·opening 상태를 재검증하고 incarnation을 commit한다. 실패 시 endpoint를 반납하고 같은 invocation fence는 유지한다 |
| 검색 격리 | PR-004/P0-4: fd-relative O_NOFOLLOW로 승인한 single-link regular file만 private snapshot에 복사한다. grep/find 엔진은 이 복사본만 검색한다(context=0 포함). 별도 자식이 복사·walker·cleanup을 소유하고 부모 pipe EOF와 취소를 처리하며 자기가 만든 process group을 종료한다 |
| 운영 목록 | P0-4/6: 전체 의미가 필요한 목록은 SQLite iterate로 row/byte 예산 안에서 수집하고 초과는 LIMIT_EXCEEDED이지 손상·부분 성공이 아니다. 조상 체인도 같은 예산이다. batch 후보는 upper rowid를 고정한 keyset page로 순회하고 direct/public 각 최대 개수만 보관한다. status 응답은 next cursor를 명시하며 페이지 사이 snapshot 일관성을 주장하지 않는다 |
| API 단절 | INF-001/P0-2: 동봉 엔진만 transient 오류 재시도를 소유한다. 최초 요청 뒤 최대 5회 재시도하며 provider SDK의 중첩 재시도는 0이다. 5회 소진은 엔진 실패로 표시하고 이미 완료한 tool 효과는 재실행하지 않는다. fatal 인증 오류와 세션 취소는 재시도하지 않는다 |
| 표시·시계 | TUI 표시와 paste는 같은 Cc/Cf 규칙(ZWNJ·ZWJ 예외)을 쓴다. terminal attach가 켠 DEC mode는 종료 시 복구한다. Store의 모든 writer는 같은 주입 clock을 쓰되 기존 row별 clamp와 monotonic deadline을 유지한다 |

**바꾸는 규범.** SB-001/MAC-205의 syscall 효과 목록, BATCH-006의 게시 전 확인과 게시 후 정산 구분,
TUI-002의 문자 처리 범주. architecture.md(N-001)는 변경하지 않는다. architecture가 session file 확인을
정산 시점의 현재 파일 검사로 읽히는 부분은 위 BATCH-006의 시점 구분으로 해석한다.

**허용 확장.** public read method `operation.read`와 status의 `after`/`next`를 추가한다. 이전 golden 전체를 갱신하지 않고 이 정확한 delta만 제외해 기존 surface를 검사한다. AUTH-002의 자기 actor/key 규칙과 기존 CLI 복구 흐름을 사용하며 새 model-facing 명령·권한·durable entity를 만들지 않는다.

**바꾸지 않는 것.** DB schema·저장 receipt 형식, 권한 표, same-key의 request identity, RunRegistry invocation fence.
전체 의미를 요구하는 operational full-set 조회는 keyset으로 일부를 성공 처리하는 대신 유한 예산 초과 시 거절한다. 이는 무한 backlog를 모두 처리한다는 보장이 아니다. 검색 owner 자체의 SIGKILL/OS crash, macOS native·systemd·전원 장애 재검증과 수용 상한은 validation에 따로 적는다.

## DR20 — LOC 크기 제한을 폐지하고 측정의 진실성은 유지한다

**날짜·결정 주체.** 2026-09-28, 사용자 지시: “loc는 그냥 spec상 없애버리고”.

**결정.** A-008 및 LOC-001의 크기 목표·상한, 초과 시 필수 architecture review와 release 차단을 철회한다. 번호를 다른 요구로 재사용하지 않는다. A-009·LOC-002–008·POL-005·TUI-015/018의 관련 문구를 맞춘다. production manifest와 source hash, pinned cloc의 정확성·누락 검사 및 구조/권한/내구성에 대한 독립 검토는 유지한다. LOC는 정보이며 합격 기준이 아니다. 수치를 줄이려고 minify하거나 파일을 manifest 밖으로 숨기지 않는다.

**우선순위.** architecture.md와 consistency plan의 원본 bytes는 N-001에 따라 보존한다. 그 안의 과거 LOC 제한·budget 언급은 이번 사용자 결정으로 대체하며 다른 구조적 제한까지 폐지하지 않는다. 과거 검증 기록의 OPEN은 당시 사실이지 현재 gate가 아니다.

**환경별 검증.** 사용자는 현재 저장소 GitHub CI 장애와 Mac 장비 부재를 알렸고, 더미 중단·복구를 정식 시험에 추가하도록 지시했다. 더미 시험은 실제 임시 ledger·파일과 생산 복구 경로를 사용하되 host 전원을 조작하지 않는다. simulation, process SIGKILL, guest 강제 재부팅, 외부 VM 전원 상실과 물리 저장장치 전원 상실은 각각 구별한다. 미실행 환경을 PASS로 바꾸거나 실제 provider 호출 권한을 확대하지 않는다.

## DR21 — Withdrawn custom conversation design

The uncommitted custom conversation renderer was rejected by the user on 2026-09-29 and selectively reverted. Its earlier tests describe that discarded implementation, not the replacement. The identifier is retained only to distinguish historical evidence; it is not reused.

## DR22 — Original Open TUI presentation, OMA-owned execution

**Decision and authority.** 2026-09-29, the user requested replacing the custom UI with the actual pi-open-tui extension, and making product-owned wording English. This supersedes the RPC-only and product-owned conversation layout requirements in TUI-004/014/020. N-001 preserves architecture.md unchanged; this explicit revision has precedence for those presentation choices only.

**Presentation.** The bundled Pi InteractiveMode loads the original MIT pi-open-tui 0.3.9 extension with Pi's own terminal input, commands, shortcuts, autocomplete and settings. OMA does not copy its renderer or patch node_modules. The only rewrites are of upstream's finished header and footer lines, width preserved: the title names oma and the product version (package.json), the path is the Human's project rather than the Principal's private workspace, and the last command tip names Ctrl+X. The default look is the palette of Open TUI's own preview, shipped as the `oma` Pi theme in the private engine directory; thinking bodies are collapsed and the thinking preview and per-response telemetry are off by default. Every one of these is a default the Human can change in /settings or /open-tui; OMA does not overwrite a later choice. Ctrl+X and `/oma` present the existing OMA Control Panel in Pi's theme through Pi's custom UI. The headless Principal adapter and Residents retain RPC. Unsupported host-pinned interactive engines fail explicitly instead of silently selecting another runtime.

**Authority unchanged.** PR-001–004, REC-007, D06 and TUI-005–012 still apply. One PrincipalSession admits Human prompts, queues at most 16, and separates them from mail runs. A private control socket is not broker authority. Credentials still use FD3; the inherited lease uses FD4; run control and UI use FD5/6. Parent acceptance does not assert durable success. Boundary notifications cross the run channel, not the displayed transcript. Engine commands, shell input, model and session changes and `/open-tui` are Pi's own and reach no run of OMA's; a plain prompt and the follow-up key become a run of their own in OMA's order, never steering into a mail run. A Human-typed `/oma-deliver` is refused. Because Pi loads extensions again for each new, resumed or forked session, the trusted extension shares the process's one credential channel across loads and closes what a load opened when that session shuts down. No new public method, durable queue or daemon is added.

**Isolation and lifetime.** Only OMA's private engine settings are changed. Project-local settings/discovery cannot override presentation policy, and Pi's project-trust warning, which only the private HOME made appear, is not shown because no project resources are loaded. Telemetry to Pi stays off. The host relinquishes terminal listeners before spawn and reclaims only after child exit. Graceful child termination has a bounded escalation; the parent restores terminal modes even after forced termination. Original engine session history remains private. The fallback transcript keeps TUI-023's declared limits; the upstream conversation history is engine-owned rather than a second bounded OMA transcript. Prompt byte/frame limits and the bounded host queue remain enforced.

**Language.** Product-owned labels, status/error/help strings and model-facing notices are English. User/model text, mail bodies and multilingual test data are never translated by the runtime.

**Evidence.** See validation.md for executed tests and remaining gaps. Earlier DR21 full-suite and mutation results do not certify DR22.

## DR23 — A second `oma` in one project opens the project's next society; an owner re-pins its own rebuilt installation

**Superseded by [DR24](#dr24--every-start-is-a-new-session-what-the-human-chose-is-kept-once).** The split into `<default>-2` and on is gone; its installation pin is kept, now made by the session's owner from the project's settings.

**Decision and authority.** 2026-09-29, the user asked to run several conversations in one project, chose not to change architecture.md, and chose separate societies over a shared one.

**Rule.** §23.4 stays: one engine per society, and a process that cannot take a society's lease writes nothing of it. When `oma` is started without `--society` or `--config` and the project's default society is held by another `oma` (its lease, or its broker already listening), the process moves to the project's next society, `<default>-2` and on up to 16, each with its own conversation, Residents and mail, bound to the same project. A named society never moves: without its lease the process remains a read-only Control Panel over it. The split is said once on the engine's screen.

**Installation pin (CFG-001).** The first start pins the installation this `oma` runs from. When the owner of a society finds that the same installation (the configured `libdir` is its own) has since been rebuilt or upgraded, it re-pins it through the configuration writer and says so; the broker still verifies the bytes at its own start. A configuration naming another installation is left for its installer.

**Evidence.** oma-composition-policy (§23.4 split, named societies unchanged, one project observation), the real-PTY Open TUI scenarios and the two-window run recorded in validation.md.

## DR24 — Every start is a new session; what the Human chose is kept once

**Decision and authority.** 2026-09-29, the user asked that starting `oma` open a new session, that `/resume` reopen an earlier one of the project without mixing with the user's own Pi history, and that only what belongs to one session be kept apart: its conversation, mail, Workers and their contexts, and its git repositories. OMA's settings (extensions, models, workers), the login and the engine's own preferences are the Human's and hold in every session. The login is kept for the user, not per project. The user rejected an explicit society flag as the way to reach an earlier session, and asked that the Principal's and a Worker's model each be one row, model and effort chosen in one go from the engine's own lists. N-001 keeps architecture.md unchanged; §23.4 (one engine per society) stands because a session is a society.

**Sessions.** A start without `--society` or `--config` is a new society named for the project (`sessionSocietyName`: the project's slug, a digest and the start time), bound to the project before anything of it is written. `/new` and the engine's new-session key start another the same way; `/resume` and its key list this project's sessions, from every society bound to the project, in the engine's own session list. A session of this society is opened in place, as the engine would; another is its own society's, and the process re-executes itself into it once its lease is released (`OMA_RESUME_SESSION`), so one process never holds two societies' authority. A session that ends with no conversation and no Workers is removed whole; nothing outside its tree is followed or removed.

**Kept once.** The engine home is `<data>/oma/.engine`, one for the Human beside every session and never `~/.pi`: login, default model and effort, theme, keybindings, Open TUI settings and tools. The first start after DR24 adopts what earlier societies' private engine directories held (every login, the newest where two hold one provider; the newest of each other file) without changing them, under one lock, each file replaced atomically; a start that died part way adopts on restart only what is still missing. The project's OMA settings are `<data>/oma/.projects/<project>/config.json`; each session's configuration is made from them with its own name, rootfs and installation (`sessionConfigOf`). A Config edit is committed against the project settings the screen was made from (WP15.03) and derived into this session's configuration at once; other open sessions of the project take it on at their next observation.

**Models.** Config shows one row per model. When the Principal's profile leaves the model to the engine (`pi/current`), the Principal model row is the engine's report, `provider/model · effort`, and Enter opens the engine's model list and then that model's effort list; both are saved as the engine's defaults, so they hold in this session and the next. A profile that names its own model keeps its choice of profiles. The Worker model row opens a choice of "Same as the Principal" (the Principal's model profile) or a model and effort from the same engine lists; the latter is saved through the Worker model field's one transform and writer into the project's `worker` model profile, with the limits the Worker ran with, never taking over a profile another agent runs. A model profile may name `thinking`, one of the engine's effort levels, validated with the closed schema; a Resident's engine runs it (`--thinking`), and one whose model is the engine's choice runs the engine's default effort, resolved on the host with the model. The effort levels offered for a Worker's model are the engine's own rule for that model, held to it by a test. Both rows need the conversation's screen; without it they say so.

**Not the engine's product.** 2026-09-29, the user asked that nothing in `oma` tangle with a separately installed Pi: where the engine would name itself or its own CLI, oma says oma, and an engine command that has no place in oma is refused. The terminal title is `oma[ - <session name>] - <project>` (the engine's is `π - <its working directory>`, the Principal's private workspace). `/export` without a path writes `oma-session-<id>.html` in the Human's project, and a relative path is the project's; the engine would write `pi-session-<id>.html` into the private workspace. A crash's extension advice points at Ctrl+X > Config > Extensions instead of `pi config`/`pi -ne`, which would change another Pi. `/bug` is refused: it uploads the session, the Principal's conversation and its mail, to the engine's developers, who do not make oma. `/import` is refused: a session file from elsewhere, the engine's own history among them, would become this session's conversation without its mail or Workers; `/resume` reopens oma's own. The engine's update and crash notices come only from its CLI start, which oma does not run. `/resume` lists, in both of its scopes, only this project's oma session directories; neither the user's `~/.pi` nor the engine home's default session folder is read. Everything else of the engine's stays as it ships.

**Unchanged.** One PrincipalSession, its run order and mail separation; FD3–6; the broker's own start checks; a named society still never moves, and without its lease the process is a read-only Control Panel.

**Evidence.** sessions, config-screen, model-effort, interactive-input, pi-runtime (engine home and adoption restart), engine-inference-chain (the engine's default effort), oma-composition-policy (a start is a new session), durable boundary `adoptEngineHome`, and the real-PTY runs recorded in validation.md.

## DR25 — Pi packages installed for oma, chosen per role and kept in the project's settings

**Decision and authority.** 2026-09-29, the user asked that `oma pi install npm:…` install a Pi extension into oma, that it apply to every role through the Config Extensions screen's Principal and Workers columns ("당연히 전체에다 적용해야지"), that the choice persist ("extention설정은 영구저장"), and that an installed extension's tools be DIRECT on the tool surface. TUI-010's "no network install" is revised for this one explicit command; its per-role selection, SHA-256 pinning at configuration load and re-check before spawn stay. N-001 keeps architecture.md unchanged.

**The store.** `<data>/oma/.packages` is one package store for the Human, beside the engine home and every session. `oma pi install|remove|update|list` runs the bundled engine's own package manager with the store as its agent directory, so packages land in its `npm/` and `git/` and its own settings list them; the user's `~/.pi` and `PI_CODING_AGENT_*` settings are never read or written. A local path is not refused and not used where it lies (a Resident's sandbox could not see it there): a package directory, a `.tar`/`.tgz` of one, or a lone JS/TS extension file is copied into the store (`local/<name>`, the manifest's name else the source's own, links resolved to their targets, `.git` left behind) and the engine installs that copy as its own store-relative `local` source — same index, pinning, mount and archive as a remote package (C20). A directory without a package.json is not a package and is refused by name, as is anything else that is none of those. Refused, with a reason: `-l`/`--local` and `--approve` (a project's `.pi/` is the user's Pi's), updating the engine itself (`update` without a package, `pi`/`self`, `--self`, `--all`, `--force`, `--models`: oma's installation pins the engine), `config` (turning extensions on and off is Config > Extensions) and anything that is not a package command (oma is the session). One `oma pi` runs at a time, on the store's lease. `oma pi list` also says what each installed package carries — counts of its extensions, skills, prompt templates and themes — so a package that is not only extensions is visible as such (UX-15).

**Which files.** A package's extensions are the engine's rule (its `pi` manifest or conventional directories), asked through the engine's public package manager after every change and kept as the store's index (`oma-extensions.json`); an entry outside the store or reached through a link is none. The index also records each package's skills, prompt templates and themes, and every engine session loads them — the Society engines through the engine's own resource flags (`--skill`, `--prompt-template`, `--theme`), the Personal engine through the resource loader's additional-path fields (C18) — so a package's non-extension resources are loaded too.

**Selection.** A role's extension entry may be `packages:<path>`, relative to `installation.packages` (a new optional installation field; a reviewed contract change), judged by the same loader rule as a libdir entry: normalized, inside its root, no link, pinned by SHA-256 at load and re-checked before spawn. Config > Extensions lists the installation's files and each installed package's extensions, named by their package; each row has the Principal and Workers columns. What `oma pi install` installs is turned on for the Principal and the Workers of the project it runs in; other projects list it, off. After any change every project's roles are brought to the store: a package a role used keeps being used by the files it has now, one removed is dropped, and entries of no package stay the role's own.

**Kept.** A project's settings are a managed bundle (D02/WP13); an inline one becomes one through the one writer, its roles the core extension and no prompt, which is how an inline configuration ran, and a first society's own bundle keeps its roles. Every session's configuration is made from the project's, roles included (DR24), and an extension toggle is committed to the project's settings, so it holds in every session and the next start; the saved notice says when it takes effect, as every field's does — the Principal's engine reads extensions at session start, a Resident's at its next activation. An extension the project names whose file is gone is left out of the session and said, never loaded in its place; the project keeps it until the Human turns it off (WP14.03's repair). A session that cannot take on the project's settings now says so and takes them on at its next start.

**Engines.** The Principal's engine loads a selected package extension from its host path. A Resident's sandbox mounts the store read-only at `/opt/oma-packages` — the store only, never the engine home, which holds the Human's login — and its engine loads the extension from there; a rootfs has that mount target. The tool surface is unchanged: roles oma creates declare no projection, so a loaded extension's tools are DIRECT; a hand-written projection decides for itself (TSP).

**Trust and limits.** An installed extension is trusted code chosen by the Human, as a libdir extension is: in the Principal's engine it runs with the Human's authority, outside the workspace confinement oma gives its own tools; in a Resident it runs inside the sandbox. Only its entry file is pinned, not the modules it imports.

**macOS.** 2026-09-30, the user asked that the same work on the Mac. The engine has no network (MAC-203) and the Mac's files are not shared with it (MAC-005), so the install and the loading are in two places. `oma pi install|remove|update|list [--project <id>]` on the Mac runs the bundled engine's package manager in the Human's terminal over `~/Library/Application Support/OMA/packages` (the same refusals, and the same local-path staging; one at a time on its lock), then asks `omahostd` over the Host API (`packages.sync`, keyed, MAC-240) to carry the whole store to the engine: directories and regular files of the package manager's list, `npm/`, `git/` and `local/`, in a closed, bounded form of this product's own — no link, no `.git`, nothing else — sent as one declared stream (§4.8) and taken on by `packages.replace` only when it is what was declared. When the app is not running the refusal names `--host-only`, which runs the same store for Personal without the VM (DR28). The engine then runs the same `oma pi` code as Linux (`guest-packages` entry): the store becomes a link to a generation published whole under the digest of what arrived, the engine's resolver names the extensions there, the current and the previous generation are kept for engines still reading them, and every project's roles are brought to it; `--project` names the project whose Principal and Workers get what was installed, as the project directory does on Linux. Everything else is Linux's: the selection in the guest's Ctrl+X Extensions, the project settings, the Principal's and Residents' loading, and a Resident's read-only mount, of the generation the loader pinned.

**Evidence.** pi-packages (commands, loader, index, reconciliation, conversion, derivation, persistence, missing files), pi-packages-cli (`oma pi install/list/remove` over a registry on 127.0.0.1), resident-confinement (the read-only mount and the engine's path), scenario SCN-X03 (a Worker's engine loads the extension and its tool reaches the model directly), SCN-C10 for a store that is a directory and one that is a link to its generation, platform-packages (the archive and its refusals, `packages.sync` through the real host service and guest services, generations kept and collected, a staged stream that is not what was declared, and the Mac's `oma pi install --project` against a registry on 127.0.0.1), and the real-PTY run recorded in validation.md. The Mac itself (Virtualization.framework, the app bundle's Node and npm) is not run here.

## DR26 — Executable assets are not configuration documents

**Authority.** 2026-09-30: the Human reported that a real Pi extension could not be installed and asked to fix the bug, unnecessary duplication, unnecessary limits, and other defects. A 5,869,626-byte bundled entry was installed successfully but refused by the configuration document reader; the command nevertheless claimed activation.

**Existing principles.** TUI-010 retains containment, SHA-256 pinning and verification immediately before execution. D02/CFG-005 retains whole-candidate validation and expected-version checks. INV02 forbids claiming activation or an empty list after an unobserved/failed operation. WP14 keeps one asset judgment for editor and loader. N-001 leaves architecture.md and the frozen workpackages unchanged.

**Changed bound.** The historical WP12/WP14 1 MiB per-file and 8 MiB aggregate rules now apply to configuration documents (JSON and prompts), not trusted executable extension assets. Executable assets have no configuration-document byte cap. The source closure still records their full identity and digest and retains its file-count bound. A shared held-descriptor reader hashes the observed file size in 64 KiB chunks, probes one tail byte, and checks identity, size and timestamps after reading. Loader, editor, expected-version checks and spawn verification use that reader. A growing file cannot extend the read indefinitely. No extension code is executed to observe it.

**Outcome.** Linux and macOS propagate an explicit application result and exit unsuccessfully when any project's settings cannot be applied. Activation is claimed only after the target project's commit succeeds. Explicit install selects that source again in the target project, allowing retry after an earlier failure; update retains intentionally disabled roles. The Mac carries this intent as optional `activate` through packages.sync/replace; application returns `{ added, said, ok }`.

**Observation and transport.** A malformed package index is an error, not an empty store. Unobserved assets make the extension list partial. Package archives stream file content with bounded memory and complete short writes; malformed UTF-8 paths and executable flags are refused. Unreadable roots and unrepresentable paths are not silently omitted.

**Evidence.** config-snapshot, extension-editing, pi-packages (12 MiB digest and stale commit/spawn rejection), pi-packages-cli (6 MiB npm install, failed apply, explicit retry and update preserving a disabled role), platform-packages (same application semantics and malformed archive cases). Installed-oma PTY with a 6 MiB synthetic extension verifies both columns, persistence, command execution and DIRECT tool exposure. These are synthetic/local checks, not a real provider invocation or native macOS VM proof.


## DR27 — Worker autonomy, tiered authority, Principal review, and progress deadlines

Status: **IN PROGRESS — tiered remains release-blocked until S-08/S-10 integration and scenario gates pass.**

2026-10-01 Human clarification: no separate active-Worker cap is introduced.
`quota.societyAgents` remains the total registered/created Resident cap (all desired
states, Principal excluded), distinct from inference slots and initial seed count.
Config labels it "Max created workers"; Dashboard counts the same population,
including retired Residents whose registry slots still consume creation quota.

The requested next tiered rule is MEDIUM one peer / HIGH two peers normally. When
more eligible reviewers cannot be obtained, review with the maximum available peers
and seek an explicit Principal decision, including MEDIUM exceptions. This does not
make waiting/idle Workers unavailable, create a scheduler, or waive exact identity,
OBJECT, self-review, trusted checks or CAS. Implementation of this exception is
**pending a tool-permission confirmation**; the running evaluator has not been
changed to claim support. Historical accepted evidence must retain its old meaning.

The Human selects an initial Worker count in Config. Workers choose their requested
integration tier and may create/delegate to other Workers under existing host quotas;
there is no reviewer scheduler or task state machine. The Principal keeps code
read/review, Human dialogue, own mail, HIGH decisions/challenge findings and necessary
force-stop authority, not routine orchestration or file writes. GOAL publication must
be an explicit authenticated mail intent with a revision CAS, not authority inferred
from a body or generic `kind=context`.

- TIER-001's max rule, active exact OBJECT and HIGH delegated latest ACCEPT apply.
  Distinct logical Residents are the default peer identities; lineage alone is not
  a reviewer ban. Git Author is not authenticated submit provenance.
- Schema 2 adds only `attestations(sequence INTEGER PRIMARY KEY, operation_id UNIQUE)`.
  It is the acceptance-order index, not another copy of verdicts: facts are immutable
  `attest.record` plans. The v1 migration preserves operation rowids and all accepted
  payload/plan/result bytes, checks foreign keys before COMMIT, and does not reauthorize
  historical facts. Diagnostics read both versions without migrating them.
- Closed facts are peer review, Principal decision, own-author revoke, exact successful
  integration challenge, Principal finding, and exact Principal scope assessment.
  Each accepted fact owns fixed commons result mail and the ordinary mail recovery
  owner. Publication failure does not erase/revoke a fact; retries keep its key/ID.
- A valid finding names a persistent MEDIUM/HIGH floor and an explicit semantic scope.
  No ancestry, patch hash, path rename heuristic or Worker self-declaration decides
  membership. Each exact candidate needs an authorized scope assessment for each
  active finding; missing assessment refuses integration, not collaboration. An
  explicit outside-scope assessment prevents blanket floor propagation. Latest
  assessment/decision order is durable acceptance order; revoking it cannot resurrect
  an older approval/exemption. Only the finding author may revoke/lower it explicitly.
  This mapping and altered-patch/rebase/restart cases are not yet release-verified.
- Accepted tiered integration plans retain the exact evaluation snapshot and host
  policy, not only a digest. Historical decoding evaluates that retained evidence
  without consulting today's grants/configuration. Relevant active approvers affect
  eligibility; an unrelated Worker creation does not invalidate exact approval.
- Fixed integration mail is reserved at acceptance and published only after fresh
  canonical-effect observation. A no-op (base equals candidate) creates the immutable
  `refs/oma/integrations/<operationId>` witness in a ref transaction verifying main:
  equality of main alone never proves a no-op was authorized. Recovery settles a
  proven effect's original mail before considering current stop/policy changes.
  Retention/crash/mutation closure for these witnesses remains open.
- First project seed captures raw working-tree bytes in an owned temporary repository,
  preserving user index/refs and avoiding user clean filters/hooks. It is a checked
  best-effort capture, not an atomic OS snapshot. Native macOS and source edge-case
  closure remain open; no unsupported case is silently omitted. Linux preparation
  uses held-parent storage and inherited tree leases; host transfer preparation has
  its own owner outside the society tree. Both survive async consumption, attempt
  all cleanup, and retain the primary failure. Descriptor handoffs move the owned
  slot before close; a failed close is never retried on a recycled descriptor.
  Focused tests cover dirty bytes, file/directory/link replacement, repository
  subdirectory invocation, async success/failure, close faults and unchanged source
  index/refs. Host tests here run on Linux, not native macOS.
- UNIT-006 diagnosis requires current explicit `failed/Result=start-limit-hit`.
  Cumulative NRestarts does not measure the current rate-limit window; command
  prose and unit names are not structured evidence. Generic failure remains
  generic, and a timed-out start remains unobserved even if a later read sees a
  limit. No automatic reset, extra retry or new model workflow is introduced.
  This replaces WP25's counter heuristic; managers retaining only exit-code expose
  the failed state with an unconfirmed cause, not a guessed start-limit. The
  current real-manager regression remains NOT_RUN under the runtime-probe denial.
- Delivery lifetime is not a model silence budget. Inference/compaction and active
  tools must not be killed by the idle RPC timer or a whole-task 600-second ceiling.
  Transport framing/acceptance/stop/check limits retain their distinct owners.
  Host startup registers its tenure cleanup at acquisition, before any endpoint,
  binding, settings or provisioning observation can fail. Immediate failure exits
  and asynchronous startup rejection return through the same current resource
  owner; a failed observation never authorizes another broker spawn.

- RUN-003 wait is current-live-incarnation memory, not durable work or desired intent.
  A keyless `agent.wait {observe:true}` reads it without changing it; only an
  authenticated Resident actor may use either form. After Pi persists the tool
  results, the awaited `turn_end` hook observes it and aborts continuation, not the
  completed tools. A separate exact batch/incarnation wait notice ends the runner
  successfully without a receipt or batch completion. Explicit ACK remains separate.
  A new run or broker starts with no inherited wait.
- Wait observation is an announced control phase, not model/tool silence or delivery
  proof. Exact begin/end/failed notices preserve the CLI observation budget; duplicate
  begin/progress cannot extend its absolute deadline. The adapter adds only its
  existing receipt-wait budget for engine/child scheduling and drain. Failed
  observation ends unconfirmed, never as delivered or as a successful wait. On
  successful delivery/wait, transport EOF alone does not release the direct child:
  its actual close is awaited. Failure cleanup also observes close within its own
  stop budget; expiry reports unconfirmed termination with the original failure
  first in the aggregate. All outcome paths return the timers and close listener.
  Construction is part of ownership too: partial RPC/UI registration returns its
  reader/listeners; delivery setup retains its child-close observation; failed
  Principal construction cancels startup, closes private channels and requests
  child termination without publishing a normal session end. Sandbox argument/filter
  transmission returns the child if setup throws before handoff. Cleanup attempts
  every owned stream and retains primary failure before cleanup failures. These
  are direct-child/stream owners, not a whole-cgroup death proof; a synchronous
  Principal construction refusal does not itself observe OS termination.
- P0-4 covers the interval before a Principal constructor returns. The session
  transfers its child exit observation and close capability to HostTenure before
  fallible RPC/UI setup. A setup exception or stop request does not return its
  engine slot or terminal; the entry reclaims after actual child exit. Acquisition
  callback refusal still returns the child. Promise-race observation/grace timers
  are held by that wait and cancelled when its other branch wins. These waits do
  not impose a model-task lifetime or prove descendant/cgroup termination.
- P18 composition projects the attestation owner's record capability, not the
  concrete object holding Store/Mail/Authority references. Tests cover nested
  runtime identities as well as TypeScript port shapes; the authority owner is
  unchanged, with no new registry or duplicate writer.
- The single CLI observation budget is shared by initial reply and chunk recovery;
  a mutation whose answer is unobserved gets one same-key lookup, not an automatic
  resend. The unused synchronous host-editor policy and its arbitrary elapsed-time
  limit were removed rather than reintroducing a second interactive process owner.
  Human terminal commands still use the existing fenced interactive owner.

- MAC-210/241 communication phases retain distinct budgets: JSON and byte-channel
  hello use the configured handshake budget, later requests their own observation
  budget. One connection-attempt owner releases failed attempts. The leading-frame
  reader observes FIN/error/already-consumed EOF as well as close and gives back a
  paused socket with trailing bytes on success. Infinity is explicit idle-pool
  lifetime, not a fallback for invalid timer values; no total model-task cap returns.
- One response-envelope decoder preserves explicit refusals and treats unread,
  malformed or wrong-ID answers as unknown/same-key. Mac CLI and attach use it as
  do stream put/get and guest hello. Failed observation never authorizes resending
  an effect. Upload ownership covers local hashing errors, remote disconnect and
  backpressure, and one pinned source FD supplies size/hash/bytes. Path replacement
  cannot change which file is sent; concurrent writes to that inode are still
  detected by the receiver's declared hash, not claimed to be an atomic snapshot.

- P0-4 stream descriptors have one return owner. A borrowed reader drains its
  in-flight read on destruction without closing the descriptor; `withStreamSource`
  closes it once, retaining primary and cleanup failures together. After a get has
  declared raw bytes, every failure (including cleanup) ends the socket, never
  appends a second JSON response. The receiver judges its own size/hash receipt.
- P0-5 endpoint probes distinguish ENOENT/ECONNREFUSED from an unobserved connection.
  Permission/resource/I/O failures and silence reject; they cannot authorize open,
  replacement spawn or archive progress. Even an answered absence is not process
  death: keep-running reports unknown and explicit stop asks the launcher. Connection
  cancellation owns late errors through close. Launcher readiness counts actual
  monotonic elapsed time, including each probe, not a count of sleep intervals.
- MAC-231/240/241 request errors share one primary/retry classifier across JSON,
  stream, egress and the guest request ledger. Transient/ambiguous/internal failures
  remain same-key observations; storage exhaustion requires repair. Neither is a
  durable refusal. Existing terminal outcomes, including historical deadline
  refusals, replay byte-for-byte without a new effect. A remote refusal remains
  upstream evidence even inside cleanup aggregates. A record's failed read is not
  damaged JSON or an absent intent/outcome; only successfully read malformed JSON
  is classified as record damage.
- A guest request ledger instance owns each active key before calling its effect.
  Concurrent/synchronous same-key reentry gets an explicit retryable refusal, never
  another effect or an added waiting queue. Terminal replay and inactive unknown
  retry retain their original meanings; other keys remain independent. This is not
  a cross-process lock or a new durable request state.
- GuestHost opening, archive and maintenance own their asynchronous operation slots
  from acquisition through finally. A duplicate archive cannot return the active
  owner's fence; maintenance/archive also refuse an already-opening society. This
  closes process-local races, not the separate physical quiescence boundary.
- P0-4 terminal ownership includes startup timers, input/resize listeners and
  partial setup. Handoff/reclaim/final restore return the losing startup timer;
  an old callback cannot claim a successor and final restore cannot reacquire modes
  or listeners. The screen owner exists before raw mode is taken. Failed setup
  returns partial resources; failed cleanup attempts the remaining returns and
  preserves both primary and cleanup errors. Local and reaped-child paths share
  the terminal-mode return, not a new timeout or collaboration restriction.
- P0-4 project-session directory observations have per-query IDs, timers and abort
  listeners. A reply settles only its exact live query; one selector's timeout or
  cancellation cannot consume a successor's answer. Parent and child echo the same
  ID. Shutdown returns all pending queries using the existing own-directory fallback,
  without claiming a complete project listing from an unavailable host.
- P0-4/P0-5 broker supervision returns its pending restart timer on stop and fences
  consumed callbacks by identity. Concurrent stops share the same actual-child-exit
  Promise; the signal request and a cleared current pointer are not death. Stopping
  also returns the registration timer, and late credentials/readiness cannot restore
  the authority of a stopped or replaced generation. Existing restart and registration
  bounds are unchanged; no reviewer scheduler or collaboration restriction is added.
- Guest terminal session exit is observed independently from PTY drainage. A live
  child's generic error (including a failed signal) is not death. A failed spawn
  settles only at close with no pid; an exited child is not signalled while its
  output drains. The existing one-second output grace starts only after exit and
  is returned on end/error/close. It bounds display drainage, not model work or
  descendant termination, and preserves the observed exit code/signal.
- The TUI app owns the partial-input decoder and its timer through final close.
  Quit closes input before any later key in the same read; shutdown/relaunch/crash
  close it before releasing the terminal. A replaced callback cannot consume the
  successor's token, and a closed app cannot register another key timeout or draw.
  Existing escape/text/paste bounds stay unchanged.
- These changes do not prove archive quiescence from endpoint absence, whole-cgroup
  death from launcher stop, or completion of the VM lifecycle/time audit. Those
  ownership boundaries remain open; no denied runtime-service probe is retried.

Implementation and tests are incremental. Fixed post-CAS publication and recovery
have focused real-Git scenario coverage; that is not full S-08/S-10 closure. Trusted
checks, Principal surface, complete time audit, native macOS proof and full-suite/
mutation/UI closure remain incomplete. architecture.md is unchanged.

**UI generation ownership (2026-10-01, P0-4).** The display poll belongs to the
parent app and is returned on shutdown, crash or relaunch; late callbacks/status
replies cannot repaint it. Loss of Society authority is not app death: the
observation-only Control Panel remains. Interactive deferred selectors, model and
thinking reports, panel input and resume callbacks belong to the UI session that
created them. Session shutdown/replacement invalidates that generation and returns
its timers before another session starts. Results observed after departure cannot
start new settings writes or reopen the old panel. A model write already handed to
Pi is not rolled back or declared unexecuted because its UI departed.

## DR28 — Session mode is chosen at birth, not a Principal permission toggle

Initial foundation checkpoint (2026-10-01): Personal execution was not available.
The subsequent implementation and its remaining verification boundaries are recorded
below; current test results are owned by validation.md.
The Human requested Society by default and a separate Personal Pi session for short
work and user files outside the project. This changes the scope of the Society-only
host model in architecture §23, not the Principal's powers. architecture.md remains
unchanged (N-001); implementation-spec §18 owns MODE-001..006.

- Society retains its project binding, Principal restrictions and Worker collaboration.
  Personal is a separate execution path, not Principal with write permissions restored.
  It uses the bundled Pi/Open TUI, ordinary OS user permissions, builtin tools and
  explicitly selected extensions; it loads no Society core, mail, GOAL or orchestration.
- Selection belongs before broker, Worker, model or VM startup. Enter defaults to
  Society; CLI can state the birth choice. Existing Society selection is not a new
  choice. Cancel returns terminal, decoder, timers and listeners as one lifetime.
- Mode, identity, initial cwd and history location are immutable published birth facts
  under the session root. No global mode registry or live toggle is introduced.
  Resume reads the saved mode, fork preserves it, and only a new session chooses again.
  Directory layout locates a descriptor but proves neither a legacy binding nor authority.
- Personal extension choices have their own locked read/validate/transform/atomic
  replacement owner. Package code/index and extension digest validation are shared,
  but Principal/Worker preferences are not changed. Platform metadata composition
  belongs to runtime; Linux containment and the dependency lattice are not relaxed.
- macOS Personal runs on the host before Host API token lookup or VM startup. This is
  not permission to treat the VM's shared project as the host filesystem, stop another
  Society, reinterpret a stopped Worker, or raise OS privileges.
- Mac `oma pi ... --host-only` explicitly changes only the existing host package
  store/index and reconciles existing Personal choices. It needs no app/token/VM and
  never claims guest synchronization or changes Principal/Worker choices. The flag
  is not a session mode, is not forwarded to Pi and cannot be combined with
  `--project`; Linux refuses it. Without it, DR25's keyed guest synchronization
  remains mandatory, including failure reporting. Installation alone does not
  select a Personal extension or consume the first project's seed. Directory
  preparation uses the runtime's platform metadata owner, not Linux openat2 on Mac.
  No Host API or guest protocol message changes in the host-only package checkpoint.
- Mac Society `/new` returns the birth choice to the host, not a guest Personal
  engine. After its actual history writer and owned broker have ended, guest `oma`
  sends one strict `{ next: "new" }` frame on a private inherited holder descriptor
  and exits. The holder combines a complete single request with actual normal child
  exit; neither IPC EOF nor terminal drain timeout authorizes replacement. The host
  returns its attach lifetime before execve to the host birth chooser, retaining its
  own cwd and removing stale resume selection. No guest path, arbitrary argv/env,
  durable handoff entity or model capability crosses this boundary. The changed
  terminal exit meaning is declared in macos-platform §4.6: guest protocol 3 and
  Host API 2 (MAC-250/251). Old exits without `next` remain exits. This does not
  implement guest-history resume or native Mac first-project extension observation.

The initial foundation checkpoint had no integrated Personal execution and source
creation was denied pending explicit authorization for the builtin shell/file tools
without a separate sandbox or per-action approval gate. The Human subsequently
approved that Personal implementation. Linux now routes the birth choice to a separate
host and the bundled Pi/Open TUI, with independent Config and history admission;
Mac entry branches to the native Personal host before Host API token lookup.
This is implementation status, not a native Mac or complete lifetime proof. Partial
acquisition, shutdown and concurrent history-writer evidence, Mac packages and guest
history integration remain open. DR27 and its independent permission/release boundaries
are not cleared by this decision. Current evidence belongs to validation.md.

2026-10-05 addendum — `/society`: the Human confirmed a record-free Personal session
turns Society on with one command. The gate is the project's own Society slot
(`<data>/<project>`): only an observed-free slot proceeds — bound, unreadable,
unverifiable, binding-free or legacy-slug records each refuse by name, and an
unobservable slot is never promoted to absent. A free slot ends the Personal writer,
its actual exit is observed, and the host re-enters `oma --society <project>` through
execve — standard binding publication, birth record and provisioning. It is not a
resume (no `RESUME_SESSION_ENV`, no history import) and never an in-process mode
change. The gate and the handoff write nothing: a kill or power loss between them
ends in the next `/society` re-observing the same slot, and once the binding is
published a restart recognizes the Society as born. macOS Personal refuses the
transition without exiting — a Society there is the app's hidden VM. MODE-005
carries the contract; validation.md owns the evidence.

## DR29 — Complete candidate checks and apply Principal roles at execution boundaries

The Human requested the unfinished handoff in full and authorized proceeding when
document rules other than Priority 0 conflict with that work. This changes the live
implementation decisions below; it does not clear a separately denied runtime probe.

- New project settings select tiered integration with a HIGH peer floor of two.
  Worker selection is combined with the retained repository, path and reentry floors.
  Existing settings and accepted policy snapshots are not rewritten: a historical
  floor of one remains readable and evaluable, but cannot authorize a new live HIGH
  integration. MEDIUM still needs one eligible peer; HIGH also needs the exact
  authorized Principal decision. The requested reviewer shortage exception remains
  subject to its separately recorded denial, not to an idle/paused heuristic.
- The broker composes one candidate check executor through Git's existing check
  callback. A check uses its own complete resource profile, pinned Node and trusted
  assets, a read-only canonical repository, and disposable bounded tmpfs mounts.
  Checkout preserves tracked blob bytes despite export, text, encoding, filter and
  ident attributes; unpinned gitlinks are refused. No host-writable checkout,
  persistent checker, task queue or actor endpoint is added.
- A transient user unit, named deterministically from the state root, owns the check
  process tree. The trusted wrapper verifies actual memory, swap, PID and CPU kernel
  bounds before executing bubblewrap with the existing namespace/seccomp boundary.
  Manager wait success is required. Timeout, signal, output loss and spawn failure
  remain unknown and cannot permit CAS; the existing coordinator revalidates main,
  policy and actor authority after the wait. An uncertain prior unit cannot be
  bypassed by choosing another name. This supersedes the fixed-unit-only implementation
  restriction in S-01-CANDIDATE and architecture §12, within the Human's document
  override. Native cgroup/descendant enforcement remains a separate verification
  obligation; generating argv or exercising the callback cannot prove it.
- The obsolete candidate argv recipe and refusing SandboxPort method are removed.
  Resident sandbox composition no longer carries unused candidate check resources.
  The integration profile is the one owner of those bounds. Existing Resident
  workspace/tmp and unit resource enforcement keep their own accepted resource facts.
- A live Principal actor cannot regain routine orchestration through broad historical
  grants or raw RPC. It retains own receipt observation, exact review, main code read,
  mail, explicit GOAL mail and Society/safety control. An actor start may release its
  own force-stop; Workers manage ordinary starts. Terminal receipts and accepted
  recovery plans preserve their meaning. Tool projection and its execution guard use
  the same role predicate, including tools revealed by dynamic groups. Human-selected
  extensions still load; unclassified model tools cannot become a write/orchestration
  path merely by changing their names. Personal and Worker tools retain their separate
  roles. Trusted extension code is not claimed to be an OS sandbox.

S-08/S-10 and whole MODE completion still require their full acceptance evidence.
This decision is not permission to turn a denied service/VM/reviewer probe into a
different command, nor to relabel Linux fixtures as native Mac evidence.

DR29 follow-up (2026-10-02):

- MAC-401/403 project bindings live in the existing host record and its existing
  locked writer. `oma bind <society>` records a Human-selected repository, creates
  its UUID on the host and returns the same identity on repeat binding. An explicit
  relocation must still reach an original root with the same object format. Each
  import/export resolves the saved bookmark and validates repository identity;
  export validates again immediately before the write. Guest paths never enter
  this record. Foundation bookmark operations use the signed helper's one-shot
  `--project-bookmark` path, before its VM channel is constructed.
- First Mac Personal extension selection uses the same settings writer as later
  edits. It retains that lock across an asynchronous observation, reads a matching
  host-bound project's committed Principal choice from an already running guest
  and excludes the Society extension. Saved Personal choices skip this observation
  entirely; package commands still do not create a first choice. Absent binding
  is an empty seed, but unreadable identity/settings is a refusal, not empty
  preferences. This first observation never starts a VM or opens a Society. A
  bound project's first choice currently requires an already running app/engine;
  this limitation is not an offline settings-authority implementation.
- These read/bind methods raise Host API to 3 and guest protocol to 4. The
  path-free `/new` handoff retains its DR28 meaning. Cross-mode history now uses canonical guest Society and host Personal references.
  Selection reads bounded paginated previews through the existing terminal/private
  descriptor; it carries no host/guest path, cwd, arbitrary argv or environment.
  The outgoing engine must actually exit, including beyond the bounded tenure
  grace, before a normal child exit plus private EOF and terminal drain can hand
  a selected reference to the host. Host Personal admission rechecks saved birth,
  header identity and cwd after attachment cleanup. A guest Society transition
  returns to the host too, because execve does not retain the private descriptor.
  Unknown/cancelled/late observations never become an empty authoritative list.
  No durable registry, replay queue or implicit guest start was added; remote
  text search covers the bounded title/first-message preview, not full history.
  Native Mac execution remains NOT_RUN.
- The session selector now uses the existing monotonic deadline primitive, with
  optional unref, instead of passing arbitrarily large receipt waits directly to
  Node's native timer. A native-limit-crossing oracle verifies that it cannot
  return an early empty list. Model/tool autonomy receives no new deadline.

DR29 timer follow-up: all native timer and phase-budget call sites were inventoried. The selector and guest egress placeholder reader now reuse the existing monotonic chunked alarm for configured long waits; fixed UI/poll/retry/process/resource/freezing budgets retain their owners. A model/tool delivery has progress/silence and phase budgets, never a total-turn deadline. Session replacement waits for actual writer exit even when ordinary quitting returns its bounded fenced tenure. Execution scope and remaining gaps are in validation.md.

## DR30 — Consolidate documentation owners without changing recorded requirements

The Human requested one documentation directory and removal of fragmented,
duplicated and stale guidance, then explicitly required the new merge/review spec
to remain unchanged. Authored documentation now lives under `docs/`; the root
README links to its single document map. Executable contracts, schemas, unit
templates and machine-readable maps retain their code locations.

Physical ordering, Store opening, contract ownership and unit-renderer clauses
are owned by implementation-spec. Test matrices, evidence, LOC, qualification
and fixture requirements are owned by verification-spec. Original requirement
IDs, acceptance numbers and their meanings are retained. The existing
UNIT-TPL-001..004 clauses now enter the normative inventory through their owner;
their previous omission from that inventory was not an exemption from proof.

Current status belongs to validation, and current requests belong to HANDOFF.
Their long earlier records, qualification experiment notes, the original plan
and external reviews are preserved under `docs/archive/` as historical inputs.
The frozen architecture, original plan and external review bytes are unchanged.
The new merge-review spec retains its original prose and design; only relative
links were rebased. Its workflow remains a next implementation target.

Document checks discover new working-tree Markdown as well as committed files,
enforce placement under `docs/` and check current links, IDs and acceptance owners.
Historical archive copies do not define current clauses or certify current input
bytes. Owner links and generated trace fingerprints use the new locations;
changed identities remain unverified and old evidence is not promoted.
This changes document ownership and verification paths, not runtime behavior
or the independent permission and release boundaries recorded in validation.

## DR31 — Confined-only Society and minimal sandbox environment (F34–F36, U1)

The Human confirmed U1 option A: Society has one confined Resident security/runtime
contract. This supersedes the historical rootfs='/' opt-out in SB-002-E and the
frozen architecture §16 description; architecture.md remains byte-for-byte frozen.
A rootfs of '/' is UNSUPPORTED_PROFILE before RunnerModule construction. Missing
bubblewrap/user namespaces or a failed sandbox spawn never authorize host execution.
Configuration load and generation validation reject unsupported rootfs values too;
no previously accepted operation, spec, receipt or session is rewritten. Receipt-only
recovery still settles durable evidence without constructing an engine.

The Resident environment retains clearenv, sets deterministic C.UTF-8 locale, UTC,
terminal, temp, shell and agent identity, and places private XDG directories under
its confined home. The confined home's .local/bin is available after pinned OMA/Node
on PATH. Present DNS/NSS/hosts/timezone files and CA directories enter the closed
read-only system bind list, including existing symlink targets, but no network or
host desktop environment is inherited. The guest package/session environment names
UTC, /bin/sh, oma identity and /tmp explicitly.

Unconfined-only Resident spawn/environment/relay/Git branches are removed. Principal
contained tools, OMA_TOOL_SURFACE and workspaceGuard remain, as do the separate
interactive oma login / oma pi paths. Scenario fixtures use the generated rootfs and
TLS relay by default. Resident activation, retry/deadline and resume tests run through
bubblewrap; missing bubblewrap is explicit NOT_RUN and the local runner already
rejects skipped coverage as a pass. These are Linux fixture and guest-composition
proofs, not native macOS, real-provider or systemd/cgroup qualification.

## DR32 — Access to OMA-owned state assumes the state is damaged (P0-8)

Four consecutive blind-verification rounds (2026-10-04) pierced the same class in the
local-package/store layer: `readdir` listing, `removeOwnedTree` removal, the
publish/open path (`ensureDirectory`/`descendBeneath`), and `writePackageIndex` each
trusted metadata (permission bits, entry kinds, presence) of OMA-owned trees, and each
fix only revealed the next call site. A same-UID stray writer or an interrupted write
can leave owner bits cleared, non-regular entries, or strays anywhere inside owned
state; per-callsite hardening can never converge.

The root cause is a missing principle, not four bugs: **access to OMA-owned state must
assume the state is damaged.** PRIORITY-0 gains sub-rule P0-8: every open/list/remove/
publish of an owned path goes through the single repairing primitive set
(`openOwnedDirectory`/`listOwnedDirectory`/`removeOwnedTree`/`ensureOwnedDirectory` and
their host counterparts); repair adds owner bits only inside the owned boundary
(containment is never bypassed by repair); failure after repair is *unknown* (refuse),
never *absent* — in particular no empty index or empty listing may be committed on top
of damage; and one bad entry must never abort a whole sweep (retention beats wedge).

Enforcement: (1) the primitive set in `packages/storage/src/directory.ts` +
`src/platform/host/files.ts` is the only sanctioned path for owned trees;
(2) an architecture/static check pins that owned-path accesses do not call raw
`readdir`/`openat`/`rm`/`lstat` outside the owned-directory module — new bypasses fail
the gate rather than waiting for the next verification round. Callers that were found
in violation across the rounds (stage publish, prune sweep, index write) are the tests'
subjects; the pin covers the rest of the codebase.

## DR33 — A candidate carrying submodule gitlinks is refused at the integration gate, naming every path (UX-09)

A project containing Git submodules failed integration with an opaque runner
exit 125: the checkout sandbox rejected the gitlink with a bare exit and the
host decoded every nonzero exit as CHECK_FAILED — no path, no word "submodule".
Worse, a policy without configured checks let the same candidate merge into
canonical main silently: the checkout gate was the only gate, and it ran after
the CAS conditions were already judged.

The integration CAS cannot validate gitlink objects, so the refusal is the
candidate's answer everywhere the CAS is contemplated, not a sandbox side
effect. `GitObserver.gitlinks` observes `ls-tree -r -z --full-tree` over the
candidate's *whole* tree — a gitlink inherited unchanged from base is as much
a refusal as one the diff adds, so changed-path diffs can never stand in for
it — and the shared `requireNoGitlinks` refusal throws UNSUPPORTED_PROFILE
with `details.paths` naming every repository-relative path. `observe` keeps
the P0-5 mapping: an uncertain answer is REF_STATE_UNKNOWN, malformed output
is STORE_CORRUPT, a candidate name outside the grammar is a candidate refusal —
never "no gitlinks". The observation runs in `requireEligible` (execute,
applyMerge, reconcile, tier evaluation) and again at execute admission before
a row exists, and in `ReviewModule.prepareOpen`/`prepareChallenge` so
`oma merge open` answers synchronously. `details.paths` joins the
ERROR_DETAILS allowlist because authored message text does not survive the
wire.

Transport stays permissive: `git submit`/quarantine is not integration, so a
gitlink-bearing candidate can still be published and debated. Provisioning
stays permissive too — a seeded or mirrored canonical `main` may carry
gitlinks and the society still works for sessions — but `provisionSociety`
reports `gitlinkNote` naming the paths and the refusal they will meet, shown
on every start until they go. The checkout sandbox keeps its gate as defense
in depth and now announces `OMA_ERROR=UNSUPPORTED_PROFILE` plus one
`OMA_GITLINK=` line per path before its exit; the host treats the marker as
the refusal's class (a bare 125, shared with the resource gate, stays a plain
CHECK_FAILED) and re-observes the paths on the immutable candidate rather
than trusting sandbox output.

The whole-tree enumeration carries no byte bound at all. `ls-tree -z` output
is spooled whole to a caller-owned file and parsed one record at a time
(`parseGitlinksFd`/`parseGitlinksPath`), so a tree of any size still answers
present/refused/corrupt — output size alone can never become unknown, and an
unterminated record can never read as "no gitlinks". The only working bound
is per-record: a wire path (4096) plus the ~110-byte record grammar
(`LS_TREE_RECORD_BYTES`), and it is a grammar bound, not a capacity one. An
earlier revision of this gate tried named capture bounds — the shared 4 MiB
wedge, then 256 MiB — and each only moved where output size alone turned
into REF_STATE_UNKNOWN at every gate. Filtering inside the spawned pipeline
was rejected: the canonical runner is a single pinned executable plus argv —
there is no shell to pipe `ls-tree` through — and `ls-tree` has no mode
filter of its own. Shrinking each record via `--format` was rejected because
it would strip the mode/type/oid grammar the parser validates. The marker
protocol also tightened: `OMA_ERROR=UNSUPPORTED_PROFILE`
classifies the refusal only as a whole stderr line, so a check argv that
prints the same bytes inside a longer line stays a plain CHECK_FAILED. And
the marker is still only a claim — it asks the host to look, and the
re-observation's own kind settles the failure through the same `observed`
mapping the admission gates use: only `present` carrying at least one path
earns the refusal, an unanswered or corrupt look stays
REF_STATE_UNKNOWN / STORE_CORRUPT rather than terminal-failed with content
the host never observed, and a `present` answer with no gitlinks means the
marker disproved itself, so the nonzero exit stays a plain CHECK_FAILED. The
quarantine importer's `OMA_ERROR=` failure words follow the same whole-line
rule (a quarantine stderr line is unreachable by user argv, but the bytes are
still the spawned command's output, not the class).

## DR34 — Project egress is an HTTP CONNECT proxy per delivery, allowlisted per role (UX-08)

UX-08 was the standing complaint: a confined Resident could not `npm install`,
`git clone https`, or pip anything, because `--unshare-all` leaves no outbound
at all. SB-004's "private network, always" was never meant to keep that — it
said a dependency-fetch path, when added, is OPTIONAL and passes its own S-01
escape tests rather than sharing the host's network.

The design keeps every existing invariant and adds one narrow channel. A
confined Resident still runs `--unshare-all`; the only thing that changed is
that the runner now owns a small HTTP CONNECT proxy on one unix socket beside
the run's lease socket, bound into the sandbox at `/run/oma/egress.sock`, and
only when the Human configured egress for that role. The trusted extension
forwards a loopback port to it inside the sandbox, and the spawn plan exports
`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` (and lowercase) at
`http://127.0.0.1:8318` — the spellings npm, Git, pip, curl and Node all read.
`NO_PROXY` names loopback only, so the engine's own inference bridge is never
proxied. Unsetting the variables inside buys nothing: there is still no route
around the socket.

Policy is `HostConfigV1.egress`: `allow` is the baseline endpoint list and
`roles.<role>` adds per role; a clause present with no endpoints is refused at
commit, and an absent clause means no socket and no variables. Entries are DNS
names or `*.suffix` wildcards — two labels minimum, and never ports, schemes,
paths or address literals — so the whole clause can be checked in one place.
The proxy accepts CONNECT only, only authority-form, only port 443: HTTPS end
to end in v0.1, and SSH/22, raw TCP/UDP and SOCKS5 stay out. The request's
headers die at the proxy — `Proxy-Authorization`, `Authorization`, `Cookie`,
whatever a tool or Resident invented — so nothing credential-shaped crosses
into the tunnel; after the 200 the socket is raw bytes and nothing re-parses.

The SSRF boundary sits where the name becomes a connection. The dial resolves
once on the host side, screens every answer against private, loopback,
link-local, CGNAT, documentation, reserved, multicast and encoded space
(v4-mapped, NAT64, Teredo, 6to4 are unwrapped before judging), and pins the
chosen literal — a DNS answer flipped after the check connects nowhere. A
name resolving only to private space refuses as INVALID_REQUEST, which the
tool sees as a clean 403, not a hang.

On macOS the guest has no NIC (MAC-203), so the same proxy's `dial` is the
host's `egress.connect` — protocol v6 — on the run's pooled lease: the request
carries the role's resolved allowlist because the host cannot read the
society's config on the guest's disk; the host grammar-checks the declared
list, enforces it verbatim, and applies its own resolve-and-screen on top.
The run↔lease check is the same one `egress.open` uses, a run's tunnels die
with it, and `forgetBoot` ends every run of the last boot. On Linux the dial
is direct with the identical screen, so the policy point and the tests are
shared. Audit is one line per CONNECT — actor, role, target, verdict, reason
— on the deciding side's journal; never request bytes or headers.

Deliberately unchanged: the inference relay's own channel and credential
substitution are untouched, the egress pool/lease/boot semantics are the same
ones the relay already used, and a Resident's failure mode stays a refusal,
not host networking (SB-004, S-01). The clause ships unset by default; a
deployment that configures nothing sees no proxy socket and no variables, and
`egressRequired`/`openPrincipalEgress` semantics for the *required* inference
path are not renegotiated by making egress optional.

**Addendum (blind-verification round, 2026-10-06).** Nine findings against the
first cut are settled in the implementation; three decisions are recorded
here because they are the kind that would otherwise be re-litigated.

*The IPv6 screen is an allowlist, not a denylist.* The first cut denied the
special-purpose ranges it remembered (documentation, ULA, link-local,
multicast, the NAT64 well-known prefix) and admitted the rest — which let
`64:ff9b:1::/48` (RFC 8215 local-use NAT64, a prefix that exists to carry
*non-global* answers), `::/8`, `2001::/23` (benchmark, AMT, AS112, ORCHID,
ORCHIDv2 and every sibling protocol assignment), `5f00::/16`, `2620:4f:8000::/48`
and `3fff::/20` through. The rule is now: embedded-IPv4 carriers are unwrapped
first and judged by the embedded address under the IPv4 rules — v4-mapped,
NAT64 `64:ff9b::/96`, Teredo (whose client address is the last 32 bits,
inverted) and 6to4 (whose site address sits in bytes 2–5) — then only
`2000::/3`, global unicast, is admitted, minus its special-purpose members.
Anything else, recognized or not, is refused. Local-use NAT64 dies at that
gate: a prefix that translates non-global space can never name a public
destination, so unwrapping it would unwrap a lie. Teredo and 6to4 carrier
space stays reachable only where the embedded IPv4 is itself public — the
carrier is the *transport*, the embedded address is the destination.

*The audit target is a normalized field, not a request excerpt.* The journal
carries `host:port` as `parseConnectTarget` normalized it, or a fixed
`(request-target redacted)` marker when no authority ever parsed. The
request's own bytes — a URL's query, an authority's userinfo, any
credential-shaped payload — can never appear, so no redaction rule has to be
trusted to find them.

*Bounds counted on the same unit at both ends.* A run's tunnel budget is four
*tunnels*: the pooled connection is the unit on the host (counting both
socket halves would silently halve it), and the reservation is taken
synchronously before the dial so a burst cannot all pass the check and only
then compete for slots. The wire's 256-entry bound on `egress.connect`'s
`allow` is mirrored at config commit, and on the *resolved* list — baseline
plus the role's own — because that is what the request carries; a baseline
alone over the bound, or baseline-plus-role over it, is refused where it is
written rather than where macOS would discover it. A refused HTTP request
gets `Connection: close` and its socket's destruction with the response —
an idle keep-alive or an `Upgrade` header cannot hold a listener slot, and
bytes pipelined behind a refused request die unread.

**Addendum (second blind-verification round, 2026-10-07).** Seven
socket-lifecycle findings against the paused-socket seam are settled in the
implementation; two decisions are recorded here because they generalize.

*A paused socket is deaf, not dead — every `readLeadingFrame`/`oneFrame`
consumer must resume what it still needs to hear.* The frame readers return
their socket paused so nothing that arrives before the next reader attaches
is lost; that is correct at handoff and wrong to leave standing. A `"data"`
listener does not resume it, and while a bare FIN still surfaces as `"end"`
even paused, bytes buffered ahead of a FIN are never read — so a peer that
spoke and then closed cleanly went unheard. The rule now: whoever keeps the
socket installs its listeners *and* resumes it. The forwarder's placeholder
lease resumes so late post-answer speech ends the run; the host's held lease
resumes and also judges `rest` that rode the request frame; the guest's held
pair listens for `data` on both ends and resumes both. `receiveDeclared`,
`egress.open` piping and `requestEgressConnect` already honored the contract
— the audit found no other consumer that did not.

*Teredo is refused, not screened.* A Teredo address embeds *two* IPv4 fields
— the server in bytes 4–7 and the bits-inverted client in the tail — and
which host a Teredo name actually reaches depends on the host's tunnel state
at dial time, so screening even both fields would be fragile against a
deprecated carrier that no public HTTPS endpoint is reached through.
`2001:0000::/32` is refused outright at its own arm, ahead of the
`2001::/23` arm that would catch it anyway; 6to4 keeps its single-field
unwrap because the site IPv4 *is* the destination there.

*Rest is payload for tunnels, silence for leases — decided per arm, never
dropped.* `readLeadingFrame` returns `{frame, rest}` and `rest` semantics
follow the request's contract: for `egress.connect` it is already tunnel
bytes — a banner-first upstream is legal — so the guest relays `answer.rest`
to the client and `asked.rest` to the host rather than demanding a bare
answer; for `egress.placeholder` and the held lease anything past the frame
is protocol speech and ends the connection unanswered, at the guest's own
reader and at the host's alike. Two structural fixes stand behind the
semantics: the CONNECT proxy propagates an upstream-initiated close to the
client half (a dead target frees the tunnel slot at once instead of at the
idle budget), and the host's `egress.open` dispatch wraps the synchronous
`connect()` in the same fail-closed shape the async arms' `.catch` had — a
throw inside it ends the connection, never escapes a void-dispatched reader
as an unhandled rejection.

**Addendum (UX-38 batch 4 — capacity bounds are working sets, not
refusals).** Every bound that once refused a legitimate request on size
alone — four CONNECT tunnels per proxy or per run, four concurrent
provider calls per placeholder, a pooled host connection when the guest
pool is empty, the forwarder's engine slots — is now a *working set*:
requests beyond it wait in FIFO, hold no tunnel, provider call or pool
connection while they wait, and are granted in order as slots free. A
waiting client that closes withdraws its claim — the slot was never
theirs — and run release, service shutdown and proxy shutdown drain the
queues honestly (`BROKER_UNAVAILABLE`, not silence and not a dangling
socket). The reservation ordering the first addendum required is
unchanged: a *granted* claim still takes its slot synchronously before
the dial. What changed is only that "no slot" is a wait, never a
verdict — capacity is not a policy and is never audited as a refusal.
The decisions that stay: protocol violations, malformed targets, wrong
ports, denied allowlist entries and unsafe resolutions are still refused;
idle windows on *established* tunnels are still progress-reset silence
budgets, not total elapsed deadlines; and the byte/frame bounds of the
wire itself are untouched.

## DR35 — The private conversation starts alongside Society preparation

사용자 결정(2026-10-08): OMA 대화 시작은 1초를 목표로 하며 최대 5초 안에 입력 가능한 화면을 제공한다.
실제 PTY와 CPU 프로파일에서 기존 시작은 첫 출력까지 146.7초를 쓰고, 136.5초를 `spawnSync`에서 보냈다.
프로젝트 15,519개 파일에 각각 `git hash-object`를 실행하고 디렉터리마다 `mktree`를 실행한 것이 직접 원인이다.
blob은 원본 파일명을 받지 않는 private spool에서 일괄 가져오고, 임시 저장소의 index로 트리를 한 번에 만든다.
원본 checkout·index·filters·hooks를 실행하거나 변경하지 않으며 변경 관측과 lease 수명은 유지한다.

대화 화면은 host가 society lease·프로젝트 binding·설정·private 경로를 확보한 뒤 시작한다.
저장소 snapshot·mirror·복구·Worker 준비는 같은 fence를 상속한 broker에서 진행한다.
이 private engine의 존재는 Principal 권한이 아니다. broker가 복구·rootfs 수리를 끝내 준비를 알리고,
같은 engine의 등록에 credential을 발급한 뒤에만 Society 도구와 mail delivery에 권한이 생긴다.
준비 중에도 Human과 모델의 대화·설정 화면은 사용할 수 있고, Society 요청은 credential 없이 실행되지 않는다.
소유하지 못한 host는 대화를 시작하지 않는다. broker 소유 실패는 기존 teardown으로 engine을 닫고
실제 종료 뒤 lease를 놓는다. 이전 "engine 생성 자체도 broker ready 뒤" 순서(TUI-004/T119)를
"private 대화 준비와 Principal 권한 부여 분리"로 바꾼다. 빠른 로딩 화면을 준비 완료로 보고하지 않는다.

동기 Git 준비는 broker가 상속한 lease를 다시 상속하는 별도 preparation child가 맡는다.
그 child와 Git 후손은 하나의 process group 안에 있고, host loss는 broker의 event loop에서
즉시 취소된다. broker는 child의 실제 close 뒤에만 lock·supervision channel을 반환한다.
Store를 열기 전 실패해도 supervision channel이 남아 종료를 막지 않는다.

한 번의 설정 파생에서는 설치 digest를 한 번만 계산해 프로젝트와 session에 같이 쓴다.
설치 manifest는 모든 바이트를 계속 해시하지만 순회 중 directory descriptor와 읽기 버퍼를
재사용한다. extension bundle의 missing-file 검사는 Set으로 선형화한다.
Pi InteractiveMode의 optional fd/rg 다운로드는 입력 시작의 선행 조건에서 뺀다:
정확히 그 UI module의 tools-manager import만 기존 binary를 관측하는 adapter로 연결한다.
Pi 파일은 수정하지 않으며 grep/find 실행은 원래 installer를 사용한다. 설치된 fd는 그대로
자동완성에 쓰고, fd가 없는 환경의 재귀 파일 자동완성은 Pi가 해당 도구를 설치한 다음 세션부터
쓸 수 있다. 모델 연결·catalog·package manager의 online 설정은 바꾸지 않는다.

새로 추가한 `scripts/benchmark-startup.py`는 독립 HOME/data와 로컬 시험 모델을 써 실제
PTY 입력에서 모델 요청·응답·종료를 측정한다. 수치와 실행 한계의 owner는 validation이며
Worker 준비를 대화 입력 가능 시간에 합쳐 준비 완료로 주장하지 않는다.

호스트의 경로·retry 해석이 interactive settings setter를 통해 Pi SDK 전체를 미리 로드하던
추가 비용도 실행 관측했다(공통 runtime import 0.718초). byte validation과 engine presentation
설정을 분리해 setter는 원래 엔진 안에서만 로드한다. Pi manager의 parse/migrate/setter와
locked writer 의미는 그대로이고, 호스트 runtime이 SDK를 import하면 실패하는 회귀를 둔다.


## DR36 — Adversarial repair: ownership, admission and native preparation

사용자의 전체 수정·푸시 지시(2026-10-09)에 따른 변경이다. 감사 당시 source와 결함 재현은
AV-20261008 기록에 그대로 둔다. 새로운 성공 oracle와 실제 native 검증은 validation이 소유한다.

Pi SettingsManager의 공개 fromStorage로 모든 interactive writer를 같은 OMA settings lock에
연결한다. bundled CLI도 installation-owned preload를 통해 공개 create factory를 같은 storage로
연결한다. Pi의 수정 필드 merge, 프로젝트 trust, user-file atomic replace를 보존한다.
Human 프로젝트 파일은 Pi가 쓰는 공개 proper-lockfile도 함께 획득하고, 잠금 전후 관측이
달라졌으면 덮어쓰지 않는다. OMA-owned 전역 파일과 user-owned 프로젝트 파일의 경계는 유지한다.
명시적인 skill-command 선택은 startup에서 삭제하지 않는다. 충돌한 writer는 조용히 값을 잃지 않고
Pi의 오류 채널로 거절된다.

패키지 before-image는 공유 index decoder로 효과 전에 전부 검증한다. 선택 세대의 이름과 이전
세대 ID도 같은 경계에서 검증한다. 교체 횟수는 독자의 종료 증거가 아니므로 게시된 세대는
자동 count-based GC에서 제거한다. 이전 세대 디스크 회수는 owner가 실제 독자의 종료를 증명하거나
전체 installation 수명을 끝낼 때의 일이다. 무제한 디스크가 생겼다는 뜻은 아니다.

StorageAdmission은 owned traversal로 손상된 directory owner bits를 contained repair한다.
관측에 필요한 owner read/search만 추가하며 write 권한은 추가하지 않는다. context revision의
0555 봉인은 유지한다. native 재시작 검사에서 관측이 0755로 바꾸는 수정 중 결함을 발견했고,
봉인 보존 회귀와 실제 broker 재시작으로 검증한다. 일반 owned 쓰기·수거의 권한 수리와 구별한다.
진행 중 관측만 공유하고 매 entry마다 event loop에 양보한다. 완료된 사용량은 캐시하지 않는다.
예약 합계 검사는 await 뒤 한 continuation에서 갱신한다. RPC raw spool과 새 acceptance는 관측 뒤
현재 authority·fence·연결을 다시 확인한다. 종료·안전 제어는 quota scan을 기다리지 않는다.

검사의 메모리 캡은 실제 kernel page size로 내림 정렬된 memory.max를 확인한다. 캡을 높이지 않는다.
출력의 보관 head와 실행 중단 한도를 분리해 verbose 성공을 unknown으로 만들지 않는다.
async subprocess와 RPC는 하나의 monotonic deadline primitive로 긴 native timer를 나누어 재설정한다.
설정에 저장되는 check timeout은 파생 observer milliseconds까지 안전한 정수여야 한다.
preparation child는 별도 120초 총량으로 자르지 않으며 상위 owner의 취소·실제 close가 수명을 정한다.

Human Git history는 protocol clone으로 committed branch 도달 객체만 가져온다. Human의 local
object store를 통째 복사하면 index/stash/unreachable 비공개 바이트까지 가져올 수 있어 사용하지
않는다. Human에서 들어오는 object와 Worker의 쓰기 가능한 object는 hardlink하지 않는다.
OMA만 관리하는 immutable object 사이에는 Git의 local hardlink를
사용한다. refs/config는 독립이며 canonical main은 clone된 HEAD가 아니라 원래의 CAS로 게시한다.
strict history 검증을 snapshot capture와 겹쳐 실행하되 성공 전 canonical 게시를 하지 않는다.
Git이 만든 새 snapshot과 검증한 owned history의 OID를 같은 society lease 안에서만 broker에 전달한다.
recovery는 현재 main과 일치할 때 한 번만 이 관측을 사용한다. restart·기존 canonical·불일치는
기존 full health observation을 실행한다. 영속 health cache나 무검증 ready 표시는 만들지 않는다.

private Principal의 첫 요청은 등록될 때까지 기다린 다음 request를 freeze/send한다. 채널 종료와
AbortSignal은 대기 listener를 회수한다. 전송하지 않은 새 요청에 recovery/acceptance unknown을
생성하지 않는다. 준비 완료 시간을 대화 화면의 시작 시간으로 대체하지 않는다.

unit 설치는 각 파일의 소유 확인·영속 게시를 유지하면서 service/path 쌍을 함께 link/reload한다.
각 unit의 실제 source·drop-in·실행 argv·설정 자원 관측은 하나의 show에서 같은 필드를 검증한다.
C relay는 읽기가 끝난 방향의 fd를 poll에서 제거하고 반대 방향의 종료까지 기다린다.
owned-state 정적 규칙은 symbol alias와 resolved local callee의 문자열 경로 provenance를 추적한다.
동적 호출 등 정적으로 보장하지 못하는 경계와 개별 raw-call 예외의 이유는 규칙에 명시한다.

추가 의존성 감사에서 nodemailer 10.0.1의 addressparser에 알려진 quadratic DoS가 확인되어
10.0.16으로 정확히 고정했다. OMA는 SMTP가 아닌 stream transport를 사용하며, 외부 메일을
mailparser로 받아들이는 경로는 없다. 공개 advisory의 일반적인 원격 공격 가능성을 OMA의
확인된 도달 경로로 주장하지 않는다. 기존 MIME/frozen-fact 회귀와 새 npm audit 결과로 검증한다.


## DR37 — 사용자가 지정한 네트워크·자원 제한 제거와 기능 복구

2026-10-09 Human은 SC-01/02/03/04/05/20의 자원 제한, SC-31의 quota를 제거하고
SC-23/26/30/32를 해결하도록 명시했다. 이 결정은 SB-004/DR34의 인터넷 차단·443·allowlist·
사설 주소 차단·터널/시간 제한, MAC-203의 NIC 없음, S-01의 Worker/검사 자원 cap과
저장량/agent-count admission을 대체한다. P0의 현재 권한 확인, 수명 소유, 효과 전 검증,
영속 사실 보존, 파일 containment와 불확실성의 보존은 계속 적용한다.

Worker와 integration checker는 filesystem/pid/user 격리를 유지하고 `--share-net`으로
TCP·UDP를 이용한다. HTTP proxy는 absolute HTTP와 임의 포트 CONNECT를 전달하며 DNS의
사설/loopback/literal IP도 접속한다. 프록시의 기본 tunnel/handshake/dial/idle cap은 없다.
Worker의 loopback bridge는 커널이 선택한 포트를 adapter 등록 전에 게시한다.
macOS VM은 Virtio NAT NIC를 갖는다. guest image에는 `platform/guest/network/80-oma.network`를
`/etc/systemd/network/80-oma.network`에 설치하고 virtio_net, systemd-networkd/resolved 및
`/etc/resolv.conf -> /run/systemd/resolve/resolv.conf`를 포함한다. guesthost는 networkd/resolved를
시작하되 화면 readiness가 DHCP 완료를 기다리지는 않는다.

memory/tasks/CPU/tmp/workspace/staging/check-timeout과 storage/agent count를 OMA admission이나
systemd property로 부과하지 않는다. systemd의 finite DefaultTasksMax도 Worker와 checker의
`TasksMax=infinity`로 해제한다. 새 기본 선언은 0이고 과거 양수 선언·accepted spec은
재작성하지 않고 읽는다. quota용 generated-name 배제는 없다. kernel/디스크의 실제 용량과
명령 자체의 오류는 실행 결과로 관측한다. Git quarantine의 prlimit/size/timeout/silence cap도
제거하며 broker lifetime signal·namespace lease로 종료를 소유한다. 중단 시 process-tree 종료 소유는 유지한다.

MCP는 npx/npm server, credential command, requestHeadersCommand, custom CA, OAuth와 autoAuth를
사용하고 proxy의 install이 engine의 OMA config 파일에 실제 저장한다. config destination을
programmatic config와 함께 명시하여 upstream의 무조건 install 거절을 해제한다. 웹은 기존
4개 tool surface를 유지하고 commands/shortcuts/browser exec, git/gh clone, native media,
curator/summary 및 answer fetch를 복구한다. Human의 workflow/fetch/domain 설정을 보존한다.
호스트 keyring/cookies/ADC와 다른 에이전트의 전역 설정 자동 discovery는 이 결정 범위 밖이다.

새 package generation은 reader-lease marker를 게시한다. engine이 처음 읽기 전에 directory
inode의 shared flock을 잡으며 reload로 남은 callback/late import 때문에 exit까지 유지한다.
metadata index의 단기 읽기는 별도 shared lease를 읽기 직후 닫아서 상주 publisher가 모든 세대를
영구 보유하지 않는다. publication owner는 current를 제외하고 exclusive flock을 획득한 세대를 잠금 유지 중 수거한다.
SIGKILL도 kernel이 마지막 reader descriptor를 닫은 뒤에만 수거를 허용한다.
수거 시작은 `.collecting-p-<digest>` rename과 parent fsync로 먼저 기록하고, 수거 도중 죽으면
marker가 지워진 부분 트리도 다음 수거가 이어서 정리한다. 이 계약 전의
marker 없는 legacy 세대는 이전 버전 독자가 없다는 증거가 없어 자동 삭제하지 않는다.
고정 횟수·세대 나이·PID 관측은 회수의 근거로 사용하지 않는다.

fd가 없으면 Pi의 installer를 background로 시작한다. 기존 Pi autocomplete provider가 다음
요청에서 설치된 경로를 받아 recursive/fuzzy completion을 복구한다. UI init은 다운로드를
기다리지 않는다. 별도 파일 검색 구현이나 Pi tool installer의 전역 교체를 만들지 않는다.

## DR38 — host·guest 수명 소유와 필수 ready 기록

2026-10-09 Human이 제시한 여섯 가지 문제를 수정한다. maintenance key는 connection 소유의
lease다. 같은 key의 재획득은 `REQUEST_KEY_REUSED`, 다른 connection의 해제는 `AUTH_FAILED`다.
연결 종료는 그 연결의 lease만 해제한다. snapshot의 표시 ID와 lease ID를 분리하여 매 작업에
고유 key를 만들고, HostService의 snapshot·pre-update snapshot·engine start/stop을 한 queue에서
직렬화한다. thaw와 lease 해제가 끝난 뒤 다음 작업으로 넘어간다. shutdown은 새 작업 admission을
동기적으로 닫는다. 실패한 작업은 다음 작업의 queue를 망가뜨리지 않는다.

guest의 같은 society에 대한 open/resume/close는 동일한 operation owner를 사용한다.
maintenance와 archive도 이 owner를 확인한다. 이미 실행 중인 society를 열 때에도 imported
project mirror와 기존 project binding을 검증한다. binding이 다른 프로젝트를 가리키거나
관측되지 않으면 running 성공을 반환하지 않는다.

VM ready에 필요한 host record 게시를 optional state observer에서 분리한다. provisioning,
image identity, 검증된 image의 highest schema를 ready 전 하나의 record publication으로
기록한다. 실패하면 startup을 reject하고 VM의 강제 종료를 관측한다. state는 failed로 남는다.
UI·egress pool 등의 optional observer 실패는 기록하며 이미 확정된 VM state를 바꾸지 않는다.

HostService shutdown은 VM stop과 egress stop의 실패를 모두 보존한다. 어느 쪽 실패에도 Host API
연결·listener와 process lock을 정리한다. 데몬은 shutdown/helper 종료 실패를 stderr에 기록하고
non-zero로 종료한다. watchdog 종료도 non-zero다. 관측하지 못한 VM 종료를 성공으로 바꾸지 않는다.

네트워크는 Human이 승인한 DR37의 host-owned unrestricted 정책을 유지한다. protocol 6의
guest role/allow는 호환용 선언이며 host 권한 정책의 증거가 아니다. 선언으로 host-issued run,
boot, actor, incarnation 검사를 우회하거나 provider credential의 목적지를 바꿀 수 없다.
과거 allowlist·443·사설 주소 제한을 현재 동작으로 설명하던 주석과 문서를 정정한다.

HostService는 조립·record publication·수명 관리를 소유한다. 프로젝트 bind/import/export는
ProjectSyncCoordinator, guest history/settings는 SessionGateway, state-disk operation은
SnapshotCoordinator, package/archive transfer는 HostTransfers로 옮긴다. 기존 Git identity
재검사·stream 검증·staging cleanup·archive 암호화·pre-update rollback point는 보존한다.
oma-society·ReviewModule·계약 metadata의 추가 정리는 이 수정 뒤 작성할 계획 범위다.

named `DR38` 회귀는 중복 lease, 외부 connection의 해제, running binding, open/close 순서,
실패 후 queue 재사용, API/lock 정리, 필수 ready 실패와 optional observer 실패, 같은 이름의
Host API snapshot 직렬화, role/allow의 권한 부재, 데몬 종료 코드를 검증한다. Linux의 LocalDriver와
controlled native boundary를 사용한다. macOS Virtualization.framework/APFS native 실행 증거는 아니다.


## DR39 — 변경 책임 분리와 중복 선언 제거

2026-10-09 Human은 DR38 완료 뒤 아키텍처 개선을 진행하도록 승인하고, 변경 증폭·응집도·
인지 비용 평가를 추가했다. 계층이나 모든 구현체의 port를 늘리는 방식은 도입하지 않는다.
Broker·authoritative Store·프로세스 경계·durable operation의 소유권을 유지한다.

Society의 프로젝트 설정은 ProjectSessionSettings가 파생·저장·read-back·extension view를
함께 조정한다. 실제 쓰기는 기존 managed bundle primitive와 effect 전 tenure 검사를 거친다.
관리 포인터 변경은 실제 읽힌 바이트로 확인한다. 읽기 실패는 변경 없음으로 확정하지 않는다.
societyPanelPorts는 설정·dashboard·mail view와 action을 구성하고 runtime은 현재 관측을 공급한다.
entry의 engine/broker/tenure·resume·실제 OS exit 순서는 기존 owner에 남긴다.
1020줄의 entry가 879줄로 줄었지만 이 수치만으로 진입점 경량화가 끝났다고 판단하지 않는다.

ReviewModule은 acceptance·freeze·Git preparation·effect ordering·recovery를 유지한다.
review-documents와 review-status는 공급된 사실을 문서·상태로 계산한다. thread history의
prefix/suffix byte accounting은 반복 문서 재생성의 제곱 비용을 제거하며 newest suffix와
omission anchor를 유지한다. notice의 newline도 part budget 안에 포함한다.
ReviewModule은 1281줄에서 1126줄로 줄었고 순수 계산의 수정과 effect owner의 변경을 구분한다.

OPERATION_CODECS의 key는 PUBLIC_METHODS의 실제 mutation key에서 생성한다. 등록 key의
mapped type와 별도의 durable plan/result/relation exhaustive 검사는 유지한다.
mutation owner inventory의 paramsCheck symbol은 메서드 AST의 실제 import에서 도출한다.
모호하거나 관측되지 않은 symbol은 거절한다. 독립적인 workflow/recovery 소유 선언은 유지한다.
이 변경은 중복 목록 두 개를 제거하며 실제 feature 변경 파일 수를 측정한 결과는 아니다.

VzDriver는 VmDriver만 구현한다. 별도 KeychainStore adapter는 keychain operation만 내며
VM-backed/Keychain-only client의 응답 의미를 공유한다. helper binary와 IPC는 하나로 유지한다.
Swift forceStop callback의 오류는 request 실패로 보존하고 VM 종료를 알리지 않는다.
Linux controlled adapter 증거와 native Swift 실행 증거는 분리한다.

DR37 정책 이후 사용되지 않는 SSRF classifier·443 상수·그 전용 테스트를 제거한다.
실제 dial regression은 private/loopback/literal IP와 임의 포트를 검사한다.
limit-bounds의 해당 resource/quota/tunnel 문구를 정정하며 전체 숫자의 새 전수 검증으로
표시하지 않는다. 시작 시간은 측정상 여전히 5초 목표 미달이다. pack 옵션 실험을 성공으로
바꾸거나 Human private Git objects를 복제하는 빠른 경로를 채택하지 않는다.

기존 verification input digest에 빠졌던 platform 원본과 .gitignore도 같은 closure에 포함한다.
source identity 증거이며 Linux suite가 Swift를 실행했다는 뜻은 아니다. 별도 gate를 추가하지 않는다.


전체 local suite를 disk filesystem에서 실행해 기존 결함 두 가지와 fixture 오류 하나를 추가로
발견했다. preaccept artifact는 최초 publisher descriptor가 살아 있을 때 별도 kernel pin을
획득하고 acceptance/discard/refusal에서 닫는다. dev/ino 숫자만 보존해서 unlink 뒤 재사용된
inode를 삭제하는 경로를 막는다. pin을 잃은 cleanup은 새 삭제 권한을 재구성하지 않는다.
Mail과 submit spool은 original descriptor가 held인 구간에서 pin을 인계한다.

locked temporary는 plain `.tmp`로 만들고 flock을 획득한 뒤 `.held.tmp`를 no-replace link한다.
생성과 flock 사이의 수거자가 살아 있는 writer를 죽었다고 판단하는 창을 닫는다.
이 짧은 준비 구간에서 죽으면 lock 소유가 입증되지 않은 plain temporary를 보존한다.
기존 startup broker fence 아래 mail temporary recovery와 진단 원칙을 따른다.
quota 제거 시험은 filesystem directory allocation보다 작은 고정 총량을 요구하지 않고
실제 4096-byte 파일을 legacy 1-byte 선언과 함께 실행한다.


## DR40 — 추가 아키텍처 감사 A-01~A-11 대응

2026-10-10 Human은 `3b9bcea`의 추가 감사를 구현하도록 지시했다. 시작 성능 작업으로
잘못 이어받은 측정용 변경은 원복했다. 이 배치는 설계·계약·변경 비용 개선이며,
새 계층·service framework·quota를 도입하지 않는다. 서브에이전트를 사용하지 않는다.

| 감사 | 구현과 소유권 | 남는 경계 |
|---|---|---|
| A-01 | `protocol/host-api.ts`가 프로젝트·패키지·snapshot·history의 request/result를 선언한다. HostApiBackend와 coordinator는 각각 이 계약을 참조하며 `Parameters<HostApiBackend>` 역방향 참조를 제거한다. | framing의 JSON과 durable request.status의 불특정 operation 결과는 계속 opaque다. |
| A-02 | Pi editor Proxy·action handler·autocomplete 적응은 `pi-compat/interactive-editor.ts`에, UI 재할당·반환은 `interactive-ui.ts`에 둔다. TUI는 prompt 크기·라우팅 정책을 공급한다. 세션 종료는 자신이 설치한 UI wrapper만 반환한다. | pinned Pi private hooks 자체를 모두 제거한 것은 아니다. 기존 private-member catalog와 실제 upstream oracle을 유지한다. |
| A-03 | read facet은 명시적인 Store 호출, write facet은 현재 transaction의 실제 closure로 연결한다. transaction도 허용 method를 typed object로 구성한다. Reflect.get/apply와 문자열 dispatch를 제거한다. | capability 이름 표와 Store 기반 type-only 참조는 유지한다. 별도 repository나 복제된 Store port를 만들지 않는다. |
| A-04 | package 정책·설치 조정은 local-package, filesystem staging은 local-package-stage, tar byte 해석은 package-tar가 소유한다. | gzip spool과 설치·cleanup의 트랜잭션 순서는 기존 coordinator가 소유한다. Linux held-parent와 Mac host-file 경계는 같다. |
| A-05 | domain-neutral FramedPeer 위의 requestSociety가 메서드별 params/result를 연결하고 protocol validator로 전체 shape와 history binding을 확인한다. project·transfer·history·society 호출자가 이를 사용한다. | 승인·거절·unknown·durable replay와 연결 종료의 소유권은 기존 transport/caller에 남는다. |
| A-06 | 설정·project 설정·extension·누락 항목·pointer version을 snapshot으로 묶고 종속 읽기가 모두 끝난 뒤 게시한다. 실패 시 이전 완전한 view와 unread 진단을 구분한다. | 저장이 성공했으나 재파생/읽기가 실패한 기존 saved-next-start·saved-unread 의미를 유지한다. |
| A-07 | lsp-call-scope가 call-owned progress/stall·merged abort·scratch 반환을 소유한다. 두 실행 tool은 같은 helper를 사용한다. | upstream LspSessionScope와 child shutdown을 재구현하지 않는다. 관계없는 call의 frame은 stall을 갱신하지 않는다. |
| A-08 | SDK의 stdio inherited-env 두 platform 목록을 벤더 ESM/CJS AST에서 생성하며 두 build가 다르면 거절한다. vendor maintenance tool에 생성·검사 경로를 둔다. | server/settings/OAuth 허용 목록은 OMA의 독립 권한 정책이므로 유지한다. bundle 검증 전 vendor 실행은 없다. |
| A-09 | main checker의 중복 AST helpers와 순환 adjacency 구성을 기존 공유 구현으로 통일한다. rule check는 호출당 syntax snapshot 하나를 사용하고 끝나면 폐기한다. | 명시적 kernel owner·filesystem provenance·transaction effect 추적·negative control을 줄이지 않는다. 복잡한 보안 검사는 남는다. |
| A-10 | evolution mutation은 이름이 있는 interface/member/type/registry/switch의 AST 위치를 선택한다. 정확한 문구 replaceOnce를 제거한다. | 의도적으로 바꾸는 계약 의미와 frozen v1 golden은 유지하며 서식·주석 변경으로 anchor가 사라지지 않는다. |
| A-11 | mutation-locality의 owner inventory를 명시하고 `--since`/`--until`로 실제 Git 변경 파일을 별도 측정한다. NUL 경로와 untracked pending work를 처리한다. | owner 교집합을 feature 변경 수로 추정하지 않는다. audit 전체의 변경 파일 수를 단일 feature locality로 주장하지 않는다. |

기존 런타임 의미를 보존하는 직접 검증과 최종 기록은
[DR40 evidence](../test/audit/architecture-2026-10-10.evidence.json)와
[현재 검증 상태](implementation/validation.md)를 따른다. 소스 기반 평점 상승을 보증하지 않는다.
실제 macOS helper·VM·전원 손실·paid provider는 이 Linux 배치의 실행 증거에 포함되지 않는다.

MCP SDK 목록을 갱신하려면 `node scripts/vendor-pi-mcp-adapter.mjs --write-sdk-metadata`,
검사하려면 `--check-sdk-metadata`를 사용한다. 이 경로는 manifest byte identity와
생성 목록만 검사한다. 기존 전체 vendor re-emit 검사와 같은 증거로 표시하지 않는다.

한 feature를 변경한 Git 구간의 실제 비용은
`node scripts/mutation-locality.mjs --since <base> --until <head> --json`으로 기록한다.
`--until` 생략은 working tree와 미커밋 파일까지 포함한다. 기존 옵션 없는 JSON array는 유지한다.
경로 수를 측정하므로 rename은 기존 경로와 새 경로 두 개로 센다. 한 feature로 지정한
changeset끼리 비교해야 하며, 여러 감사 항목을 묶은 이번 배치의 수치를 feature 개선으로 추정하지 않는다.

## DR41 — TUI/Application/Runtime/Extension 모듈 경계

2026-10-10 Human은 디렉터리·패키지 수보다 내부 구현을 몰라도 작동하는 모듈 독립성을
구현하도록 지시했다. 기준은 DR40 완료 `babe732`다. 문서부터 확인했고 서브에이전트는 사용하지 않는다.

TUI의 설정·extension·메일·status 읽기와 저장 조정을 Application으로 옮겼다. Society 패널은
`SocietyPanelEffects`의 데이터·행동만 사용한다. 설정 파생 snapshot과 실제 저장, effect-time tenure
확인은 Application에 남는다. Core의 settings policy/DTO/Observation을 공유하여 TUI가 설정
loader와 package/user-file 구현을 가져오지 않게 했다. effort 값은 순수 계약에 선언해 config loader가
화면 정책까지 로드하지 않는다. Application에서 실제 메일 경계·설정 owner·Runtime을 조립한다.

Principal 세션·login/package child·resume directory 관측을 `runtime/engine`으로 옮겼다.
Runtime의 세션은 prompt outcome 계약과 오류 표현 port를 받고 TUI를 import하지 않는다.
제품 진입점은 기존 Mac 오류 표현 owner를 공급한다. package store의 공개 `index`, tar parser,
StageArea port와 Platform staging/directory owner를 분리했다. Runtime package store에 host-file
구현과 OS 선택을 넣지 않고 실제 host 조립에서 directory port를 공급한다. list 실패·repair 실패는
빈 index 성공으로 바꾸지 않는다. generation lease·descriptor containment·unknown은 보존한다.

기존 surface checker에 좁은 모듈 import 규칙을 추가했다. TUI의 효과 구현과 Runtime의 TUI/Application
참조, TUI private subpath와 package private store 참조를 type-only·literal import()/require()·재수출에도
적용한다. TUI computed load는 거절한다. 별도 checker·service framework·중복 정책 registry를 추가하지
않았다. 공개 TUI 목록은 산출물 exports에도 사용하며 모든 TUI adapter를 즉시 로드하는 barrel은 없다.

`tsconfig.tui.json`, `tsconfig.extension.json`, `build-module.mjs`는 Runtime/Application/Broker/Store를
포함하지 않는 독립 소스 closure를 컴파일한다. 두 config는 verification 입력에 포함한다.
Extension의 Pi manifest와 검증된 vendor copy를 포함한다. 독립 산출물을 실제 외부 의존성으로
로드하고, copied vendor의 unlisted file 및 기존 output 교체 거절을 검사한다. Extension의 실행 환경·
권한·delivery bridge 요구를 축소하지 않는다. 물리적 npm workspaces 이동과 새 OS service는 추가하지 않는다.

Resident 배포 mask도 이동한 host 제품 경로로 옮긴다. 실제 bwrap probe가 Application·Principal owner·
화면 정책 내용을 가리면서 trusted Extension을 보존하는지 검증한다. Broker·Store·durable operation과
host/guest 프로세스 경계, model tool surface·권한·자원 선언의 의미는 유지한다.

수치 기반 아키텍처 평점이나 단일 feature 변경 비용 감소는 추정하지 않는다. 직접 변경 비용은 기존
Git changeset 도구로 기록한다. 검증·실패 기록과 native 한계는
[현재 검증 상태](implementation/validation.md), bytes는
[DR41 evidence](../test/audit/modules-2026-10-10.evidence.json)에 기록한다.

## DR42 — Native transport·project writer·egress 복구·archive 종료 증명

2026-10-10. Human이 기준 `ae15804000ce6`에서 제시한 여섯 항목을 직접 확인하고 수정한다.
서브에이전트는 사용하지 않는다. 해당 HEAD의 VzDriver에는 처리한 줄을 제거하는 코드가
이미 있다. 무한 루프 주장 자체는 현재 소스·기존 37개 실행에서 재현되지 않았다.
다만 중복 파서·느슨한 응답 shape·read 전체의 문자 길이 제한은 실제로 개선할 대상이다.

- [NativeChannel](../packages/platform-mac/src/native-channel.ts)이 두 helper client의 줄 소비·UTF-8
  바이트 제한·응답 shape·ID·pending timer를 소유한다. 기존 1 MiB helper wire 경계를 줄별로
  검사하고 여러 유효한 줄의 합으로 연결을 거절하지 않는다. Keychain의 strict correlation과
  VM의 늦은 응답 처리 차이, credential refusal의 비밀 보호를 유지한다. EOF는 요청을 끝내며
  실제 helper exit만 VM 종료의 증거다. Swift/native 실행은 별도 Mac 검증 대상이다.
- [ProjectMutations](https://github.com/minjung2035/oma-v2/blob/adf20331c69406c124259367d9b644714697cd47/apps/oma/src/platform/guest/project-mutations.ts)는 mirror별 import·세션
  startup·bound society archive를 outcome 게시까지 직렬화한다. 서로 다른 mirror는 동시에
  진행할 수 있다. 모든 project role 설정을 쓰는 packages.replace는 같은 owner의 global exclusive
  구간을 사용한다. unbound archive도 owner에 등록해 package 설정 변경과 겹치지 않는다.
  maintenance admission은 대기 중인 project·society 작업도 확인하고, 소유
  연결의 end/reap까지 import와 startup을 막는다. RequestLedger는 현재 fence를 적용하기 전에 intent binding과 과거 outcome을 먼저 읽는다.
  완료된 same-key 결과·key 재사용 판정은 maintenance와 독립적이고, pending 효과와 outcome 게시만
  project owner를 통과한다. Host import도 transfer부터 lastImport 기록까지 project별 순서를
  유지한다. 실행 중인 broker의 canonical repository writer는 기존 owner가 계속 소유한다.
- EgressHost는 세대별 fill 하나와 retry timer를 소유한다. 최초 실패 뒤에도 외부 요청 없이
  목표 spare 연결 수를 회복한다. 기존 handshake cadence인 250 ms에서 두 배씩 늘려 최대
  5 s 간격으로 재시도하며, 재시도 횟수·run lifetime 제한을 두지 않는다. VM ready에서 재개하고
  ready를 벗어나면 중단한다. reboot/shutdown은 timer·abort·idle sockets·run leases를 반환하며
  이전 세대의 늦은 open/credential resolution은 새 연결이나 run을 만들지 않는다.
- Archive는 endpoint가 실제로 열려 있으면 기존 BATCH_CONFLICT로 거절한다. endpoint 부재는
  명시적 launcher stop 확인을 요구한다. systemd stop이 실패했을 때는 manager가 collected
  unit의 not-found/inactive/dead, 두 PID 0, 빈 ControlGroup을 모두 관측해야 stopped다.
  불완전 관측은 unknown이며 archive intent를 pending으로 남긴다. GuestHost의 society/project
  fence는 stop 확인·manifest·tar·결과 게시가 끝날 때까지 새 startup/import/maintenance를 막는다.
- [withProcessWriterLock](../packages/process/src/writer.ts)이 Keychain credential와 archive key의
  monotonic contention wait·AbortSignal·inode fence·cleanup을 소유한다. credential은 기존 helper
  availability budget인 60 s, archive key는 기존 30 s를 기본으로 사용한다. lock을 취득한 write의
  수명이나 상속한 helper의 실제 close를 대기 deadline으로 잘라 성공/실패로 바꾸지 않는다.
  OS writer 앞의 중복 promise queue는 제거해 같은 프로세스의 대기도 이 contention budget에 포함한다.
- 공통 [RPC dispatcher](https://github.com/minjung2035/oma-v2/blob/adf20331c69406c124259367d9b644714697cd47/apps/oma/src/platform/rpc-server.ts)는 HANDOFF와 Answer를 함께 소유한다.
  Host API와 Guest control/society가 이 module을 참조한다. Guest server의 peer authentication,
  hello·service startup 책임과 wire 버전·method·오류 의미는 유지한다.

실제 Git/ledger/socket/archive 회귀와 Linux user systemd의 살아 있는 parent/child 종료 관측을
검증한다. 최신 실행 수치·실패 기록은 [validation](implementation/validation.md), bytes·로그는
[DR42 evidence](../test/audit/host-repairs-2026-10-10.evidence.json)가 소유한다. 이전 startup 목표,
native macOS VM·Keychain·VM power loss·paid provider·release 검증의 미완료 상태는 유지한다.

## DR43 — Society 조립 수명 단위와 플랫폼 책임 경계

Human은 단일 lifetime owner와 Core ownership을 유지하면서 Society composition root,
platform의 application coordination/native adapter 구분과 계약 체계의 이해 비용을 줄이도록 요청했다.

Society 진입점은 command·project identity와 조립·process signal 배선을 맡는다. identity/binding/
settings 준비는 bootstrap, broker/Principal registration·delivery는 runtime, TUI/history/settings
interaction은 interaction, 종료·재진입은 transition의 Application 단위로 분리한다. HostTenure만
lease/fence와 권한을 판단하며 engine 교체는 actual exit를 기다린다. 화면은 좁은 view command,
interaction은 현재 conversation 관측과 실행 command를 통해 연결한다. runtime의 가변 상태는
외부에서 직접 쓸 수 없다. Broker·Store·Git·Maildir·durable operation·Reconcile은 기존 owner를 유지한다.

HostService/GuestHost 및 project/session use case는 process application coordinator로 명시한다.
VM/native/Keychain/systemd/files/bridge/RPC는 effect 또는 transport adapter 역할을 갖는다.
디렉터리를 대대적으로 옮기거나 별도 Supervisor를 추가하지 않는다. 세 lifetime은 command와
observation으로 연결하며 상위 계층은 아래 계층의 state machine을 재현하지 않는다.
계약 위치·의존 방향과 실행을 읽는 순서는 [Application 경계 안내](application-boundaries.md)가 설명한다.
기존 규범과 검사 강도를 유지하며 파생 메타데이터를 위한 새 수동 registry를 만들지 않는다.

## DR44 — Review 권한과 실행 조정의 변경 경계

2026-10-11. Human은 기준 `067bb7c`의 8.4점 정적 평가와 17개 추가 후보를 제공하고,
필수 문서·실제 코드를 먼저 읽은 뒤 핵심 소유권을 보존하면서 변경 복잡성을 줄이도록 요청했다.
서브에이전트는 사용하지 않는다. 외부 30개 프로젝트의 전수 감사나 개선 후 평점 자체를
실행 증거로 사용하지 않는다.

ReviewModule은 caller admission과 공개 API의 facade다. authority read·candidate preparation·
message construction·acceptance·advancement·status를 각각 다른 변경 이유로 분리한다.
ReviewAcceptance 하나만 review fact와 merge integration intent의 T를 소유한다. 준비 객체의
readonly recipient 배열을 cast로 쓰던 부분은 제거한다. T에서 새 recipient snapshot을 만들고
결과도 실제 accepted plan으로 계산한다. MessagePlan을 동결하는 실제 merge 회귀가 이를 검증한다.
검증된 attestation read를 사용하며 합성 operation을 provenance type으로 cast하지 않는다.

GitModule이 read-only ReviewAuthorityReader를 먼저 구성한다. Integration은 synchronous
ReviewAuthority port를 통해 순수 ReviewState의 현재 readiness를 확인하며 Review workflow로
되돌아가지 않는다. 정책 floor는 broker가 묶은 값이다. ReviewAdvancement만 Integration에
적용을 요청한다. live checks→최종 authority→writer slot→CAS와 accepted-effect recovery의
기존 순서를 유지한다. public Review gate를 실패시키는 회귀로 workflow callback 제거를 확인한다.

Principal의 launch/profile/environment와 event projection을 분리하고 Human/Delivery arbitration은
I/O 없는 TurnAdmission에 둔다. claim과 대기 입력 handoff는 동기적으로 끝난다. unanswered
acceptance는 unknown이며 receipt timeout만으로 claim을 반환하지 않는다. PrincipalSession은
실제 RPC·UI·credential socket·child exit의 lifetime을 계속 소유한다. BrokerListeners는 listen
readiness와 진행 중인 close만 소유한다. Broker의 health/admission, task drain, RunRegistry,
Resident quiescence와 Store·lease 반환 순서는 유지한다.

Pi의 global autocomplete prototype/private fdPath 교체를 제거한다. public autocomplete wrapper와
public CombinedAutocompleteProvider 생성자로 늦은 fd 설치를 반영한다. 기존 provider 우선권,
completion 적용과 cancellation을 유지한다. input readiness를 막는 optional download에 대한
private import 우회는 고정된 Pi/Pi TUI 1.0.1 preload와 export 계약 검사로 제한한다. 다른 기존
private UI hook과 native qualification이 해결됐다고 주장하지 않는다.
실제 재로드에서 새 public factory가 stale ctx.cwd를 붙잡던 오류를 발견했다. 등록 때 cwd 문자열을
읽고 반복 wrapper는 겹치지 않게 한다. Personal 저장 확인은 reload 뒤 현재 UI에 보낸다.

StoreQueries/StoreWrites는 concrete Store를 참조하지 않고 기존 LedgerReader의 decoded/provenance
타입과 write 입력을 재사용한다. transaction의 runtime owner identity·captured closure·동기 gate는
그대로다. runtime뿐 아니라 같은 계층의 type union cycle도 기존 lattice 검사로 거절한다.
diagnostics는 좁은 GitReadPort, native lifecycle adapter는 platform-lifecycle port를 사용한다.
SystemdSessionLauncher가 listening helper 하나 때문에 GuestHost 전체를 로드하던 역참조도 제거한다.
Society Interaction은 sendUi adapter, Runtime은 view wording port를 사용한다. concrete session은
Runtime 안에 남고 stale callback의 identity 확인은 보존한다.

파생 메타데이터 갱신은 기존 도구를 순서대로 실행하는 evidence:refresh 명령 하나로 묶는다.
authored review·durable owner·규범·historical PASS는 자동 갱신하지 않는다. input binding 생성은
runtimeProof:false다. stale/중복 binding 거절과 idempotence를 음성 대조군으로 검증한다.
추가 검토에서 build child의 실행 오류에 status 0이 동반되면 이전 dist를 성공으로 오인하는
결함을 발견했다. discovery·compile·package 단계 모두 error/signal을 우선 실패로 처리하고
실제 build runner의 실패 주입으로 검사한다. 이전 dist의 숫자는 변경 코드의 증거로 철회한다.
실제 changeset 비용은 기존 mutation-locality 도구로 기록한다. 이번 구조 변경의 파일 수를
승인 규칙 추가나 engine upgrade 같은 별도 feature의 전후 비용 감소로 해석하지 않는다.

두 플랫폼 ledger·세 process lifetime·identity trust boundary는 실제 서로 다른 책임이므로 합치지
않는다. Host/Guest wire의 공통 SocietyMethods와 shape 검사는 기존 protocol owner를 재사용한다.
Society root의 deferred UI/transition 연결과 나머지 Pi UI hook은 잔여 변경 비용으로 명시한다.
정적 지표·fresh 실행·환경 한계는 [validation](implementation/validation.md), 읽는 순서와
변경 책임은 [Application 경계 안내](application-boundaries.md)에 기록한다.

## DR45 — 감사에서 확인한 실행·재시도 결함과 운영 안내 수정

2026-10-15. Human은 Worker별 독립 clone 구조는 유지하고 나머지 기존 코드 결함과 설치
안내를 수정하도록 요청했다. LOW의 사전 승인 없는 적용과 DR37의 네트워크·자원 정책을
유지한다. macOS 앱·VM 이미지 제작은 이번 범위가 아니다.

Guest import mirror는 bare commit source다. 이전의 checkout 없는 non-bare mirror도
Society launch 전에 같은 seed 의미로 전환한다. 이미 있는 canonical main은 덮어쓰지 않는다.
최초 dirty/untracked snapshot의 host import intent와 bundle은 지원 디렉터리에 함께
durable publication한 뒤 전송한다. 같은 key는 재시작 뒤에도 원래 바이트를 사용하고,
다른 payload는 거절한다. 완료 결과를 보존한 뒤 bundle을 제거하며 오래된 재시도가
더 최신 lastImport checkpoint를 되돌리지 않는다. Guest stream.put은 attempt별 temp를
쓰고 검증 후 no-replace publication한다. 동일 key의 동일 바이트는 재사용하되 다른
바이트와 뒤늦은 연결 종료는 완성된 파일을 교체·삭제할 수 없다. incremental range가
비었을 때는 같은 ref를 담은 유효한 full bundle로 import/export를 완료한다.
재시작 때 미게시 import 준비 디렉터리와 stream 임시 파일만 정리하고 수락된 request·완성
bundle은 보존한다. 명시적으로 재시도 불가인 실패도 원래 결과를 저장한 뒤 host bundle을
해제하며, 결과 불명의 bundle은 같은 key 재시도를 위해 유지한다.

Review list와 sweep 발견 단계는 한 동기 projection 안에서 attestation을 한 번 decode하고
요청별로 묶는다. 완료된 이력은 요청마다 전체 이력을 다시 읽지 않으며 accepted challenge
ref의 복구는 유지한다. 이 projection은 acceptance나 CAS 권한이 아니고, 해당 경계는
항상 현재 원장을 다시 읽는다.

Project writer는 integration/check를 계속 직렬화한다. 별도 context repository는 자기
writer를 사용한다. Cancel fact는 긴 검사 잠금과 독립적으로 수락할 수 있으며, pending
integration에 대한 취소 직전 main 관측과 T 사이에는 await가 없다. 이미 CAS된 main이나
관측 불능은 취소 성공으로 표시하지 않는다. 수락된 cancel은 진행 중 check의 cgroup 종료를
요청하고, 실제 check owner가 반환되기 전까지 project writer는 유지한다. 최종 동기
review gate→writer slot→CAS는 유지하며, 재시작 후 취소된 요청은 검사 전에도 거절한다.

Inference relay는 credential일 수 있는 suffix를 아직 내보내지 않고 보류한다. 완전한
credential을 발견하면 앞 chunk의 prefix까지 전달하지 않은 채 연결을 끊고, credential과
무관한 바이트는 즉시 전달한다. 정상 EOF의 불완전 일치는 원래 응답 그대로 끝낸다.

최초 Personal의 프로젝트 확장 상속은 `--mode personal --no-project-extensions`로
명시적으로 생략할 수 있다. 기존 Personal 선택과 saved history는 바꾸지 않으며, 기본
경로의 관측 실패는 계속 오류다. Worker prompt와 운영 안내는 DR37 및 최초 snapshot의
실제 파일 포함 범위를 따른다. Linux checkout 설치와 미제공 macOS 앱 배포를 구분한다.

전체 회귀에서 broker spawn 실패 뒤 종료 오류와 비동기 spawn 오류가 연달아 발생할 때
일회성 error listener가 소진되는 경로를 확인했다. PID 없는 child에 종료를 요청하지
않고 child 수명 동안 오류를 계속 관측한다. context 복구는 기존 Promise 오류 계약을
보존한다. 이전 모드 선택창을 가정하던 Mac PTY 시험은 현재 명시적 Personal 전환과
일반 종료를 실제 CLI/holder로 검증한다. §23.11의 기존 Mail 변경을 대조한 N-001 hash도
현재 architecture 바이트에 결박하며 architecture 원문은 수정하지 않는다.

## DR46 — 출시 전 레거시 제거와 workspace 분리

사용자가 출시 전 호환성을 유지하지 않는 [모듈 전환 명세](archive/documentation-cleanup-2026-10-25/modularization-spec.md)의 구현을 승인했다
(2026-10-23). Priority 0가 최상위다. 이전 개발 형식을 지원하지 않는 것은 허용하지만, 이미 읽을 수
있는 확정 사실을 현재 권한이나 설정으로 재해석하는 것은 허용하지 않는다. 형식을 제거하는 단계는
식별값을 바꾸고 이전 상태를 명시적으로 거부하며, 기존 상태를 자동 삭제하거나 다시 쓰지 않는다.

DR41의 디렉터리 단위 독립 빌드에서 npm workspace의 공개 API·직접 의존·자체 빌드·테스트로
전환한다. 고정 architecture에 적힌 workspace 미사용과 TUI 전용 tsconfig 경로는 이 결정으로
대체한다. 제품의 프로세스·서비스·DB 수, 단일 writer, acceptance transaction과 durable 경계는
늘리거나 나누지 않는다. 패키지별 버전도 하나의 제품 버전으로 맞춘다.

첫 전환 범위는 contracts, domain, protocol, client, TUI다. 공통 계약은 구현 port를 재수출하지
않으며 concrete 구현을 참조하던 두 facade를 제거한다. 순수 설정·질문 모델과 lexical path 판정은
domain, 행/영수증 codec은 protocol, 소켓 수명은 client, Pi 내부 editor 연결은 engine adapter가
소유한다. 효과가 없던 lifecycle quota 함수·타입·호출과 그 함수만 유지하던 테스트도 제거한다.
현재 설정·operation·receipt의 형식은 이 첫 전환에서 변경하지 않는다.

확장과 TUI는 공개 contracts/domain/protocol/client 계약을 사용할 수 있다. 확장이 host 조립,
SQLite writer, broker·플랫폼 관리 기능을 가져오는 경로는 계속 거부한다. TUI는 client 소켓을
직접 열지 않으며 terminal primitive와 주입받은 UI port를 사용한다. 타입 의존도 순환 검사에
포함하고 공개 API는 각 package.json의 명시적 exports가 소유한다.

배포는 workspace의 compiled tree와 package.json도 해시에 결박한다. 설치된 workspace의 해석이
manifest에 적힌 설치 내부 경로와 다르면 거부한다. 검증은 모든 workspace source·manifest·설정·
테스트를 입력으로 포함한다. 출력과 개발 cache는 입력으로 오인하지 않는다. 기존 kill/retry/restart
경계와 single-owner 판정은 같은 함수를 이전하며, 분리된 패키지마다 재구현하지 않는다.

이 결정은 전체 개편이나 실제 플랫폼 검증의 완료 기록이 아니다. 남은 storage/native/process,
기능 모듈, engine/tool, 플랫폼·app 조립과 추가 레거시 제거는 명세의 후속 단계다. 각 실행의 판정과
미실행 범위는 [validation](implementation/validation.md)이 소유한다. 과거 검토·runtime evidence의
바이트와 PASS는 새 소스로 재결박하지 않는다.

DR46 구현 보충: native/process를 같은 workspace 경계로 분리한다. FD·PTY·containment와 cleanup의
owner는 native이며, subprocess·취소·실제 close·상속 fence의 owner는 process다. 함수 본문과 자원
반납 순서를 유지한다. root typecheck는 `implementation/tests`도 포함하며, 삭제된 구현 별칭을
검사하던 compile-only fixture는 실제 consumer port의 conformance와 현재 wire 집합을 검사한다.
TUI 숨김 목록은 이동한 package source/dist와 private prompt adapter를 가리킨다.

DR46 저장 기반 보충: SQLite와 durable 파일 primitive는 `@oma/storage`가 소유하고, snapshot FD reader와
암호학적 ID 생성은 `@oma/native`로 옮긴다. 기존 `src/ids.ts`의 문법 재수출 facade는 제거한다.
설치 schema는 저장 패키지의 명시된 자산이며 소스 checkout 없이 사용한다. transaction·commit·
파일 게시의 함수 본문과 owner는 분할하지 않는다. 이 단계는 저장 형식을 바꾸지 않는다.

효과가 없던 StorageAdmission/ResourceGate의 인자·상태·reserve/release와 별도 stream 대기 단계를
제거한다. 손상·drain의 실제 AdmissionGate와 preflight/dispatch의 현재 권한 검사, 실행이 끝날 때까지의
spool·peer 소유는 유지한다. 관찰용 tree 크기 helper는 시험 fixture만 소유한다. D04의 자원 category
분류는 실행 admission 계약에서 제거하며, 실제 파일 공간 부족과 accepted/unknown 판정은 그대로다.

배포 검증은 각 compiled tree에서 Node가 검색하는 모든 조상과 내부 node_modules 위치의 workspace
해석을 같은 설치의 정확한 owner 경로와 대조한다. 루트 링크만 확인하면 nested 사본이 같은 배포 해시
아래서 다른 domain 규칙을 실행할 수 있었다. resolver cache에 기대지 않고 해석 위치를 직접 관찰한다.

DR46 설정 기반 보충: `@oma/config`는 로드·검증·generation 게시·child policy snapshot과 역할 prompt를
소유한다. 기존 generation의 commit 순서와 frozen configuration bytes는 바꾸지 않는다. 정확한
containment를 위한 native 파일 primitive는 직접 의존으로 선언하고, 저장 패키지는 공개 파일 API만
사용한다. 순수 Resident 경로와 review 문서 크기 판정은 domain, sandbox path DTO는 contracts가
소유한다. sandbox와 config의 옛 문법/상수 재수출은 소비자가 실제 owner를 부르도록 제거한다.

DR46 검증 보충: owned-state provenance와 transaction 분석도 public workspace API를 실제 source
정의로 해석한다. 설치된 declaration만 보면 callee 본문의 소유 경로 전달이 끊기며, root src만
검사하면 이동한 transaction 효과가 검사 밖으로 빠진다. 같은 해석 owner를 사용하고 모든 authored
workspace source를 검사한다. 선언이 설치된 상태에서 workspace를 가로지르는 owned-path 전달과
workspace 안 async/파일 transaction을 거부하는 negative control을 추가한다. 이것은 기존 P0-8과
M-004의 적용 범위를 복원한 것으로, 예외 목록을 줄여 결함을 감추지 않는다.
폐기된 quota 함수를 실행하던 qualification probe·lane 인자·그 전용 fixture와 존재하지 않는
quota-observer 시험 이름도 제거한다. 실제 systemd·cgroup·rootfs 자격 검사는 그대로 필요하다.

DR46 세션 정리: 이력의 birth 기록이 없으면 재개를 거부하고 새 개발 session 디렉터리를 사용하도록
알린다. project binding과 디렉터리 배치로 birth를 만들어 내지 않으며 이력 목록에도 추정 항목을
넣지 않는다. 실제 birth 기록의 형식과 의미는 그대로다. 같은 빌드에서 시작이 끊긴 뒤 birth를
게시하는 정상 경로는 유지한다. D05/I49의 옛 basename Society 이름 검색과 전용 helper·fixture를
제거한다. 기존 디렉터리는 삭제·이름 변경·묵시적 bind하지 않는다. explicit project binding과
현재 해시 기반 Society 이름의 충돌 검사는 유지한다.

DR46 형식 전환 보충: host 설정은 schema 2의 단일 `HostConfig`로 바꾼다. 효과가 없는 top-level
quota와 egress 선언을 제거하며, 이전 schema나 제거된 필드는 명시적으로 거절한다. 저장된 파일을
자동 변환·덮어쓰기·삭제하지 않는다. resource spec의 실제 정리는 별도 durable 형식 전환에서 한다.
host/guest protocol은 7만 사용한다. CONNECT의 guest role/allow metadata와 placeholder의 옛
무보유/기본 timeout fallback을 제거한다. 매 placeholder는 명시한 model silence와 열린 socket의
run lease를 가진다. 연결 종료·boot 변경·stop까지 relay/tunnel ownership을 유지한다. destination
허용 범위와 credential 경계는 유지하며, 이전 protocol과 상호 통신하는 호환 범위는 제공하지 않는다.

DR46 journal 정리: 관리형 journal은 이름이 형식을 식별하는 `committed-v2` 하나만 사용한다.
이전 `committed`가 존재하면 load·edit·collection 전에 형식 불일치로 거부하고 bytes를 보존한다.
새 파일에서는 previous/current 쌍만 읽으며 lone-generation decoder를 제거한다. 새 append가 중간에
끊긴 경우의 newline 분리와 불완전한 관측의 keep-all은 유지한다. 파일명으로 형식을 구분하므로
같은 빌드에서 끊긴 쌍의 첫 generation을 옛 형식으로 오해해 복구를 막지 않는다. schema 2의
agent profile도 닫힌 필드 집합으로 검증하며, 미지 필드를 보존하던 D23의 이전 빌드 호환은 제거한다.

DR46 도구 기반 보충: `@oma/tool-runtime`이 contained file/search/writer와 도구 출처·surface·child 환경,
요청 key와 vendor 검증의 공통 실행 계약을 소유한다. 각 tool이 자기 vendor asset root를 명시하고
공통 verifier가 다른 workspace의 자산 위치를 추측하지 않는다. 파일/child/queue의 종료 owner와
원래 request-key 계산은 유지한다. extension의 UTF-8·식별자·batch codec 사본은 제거하고 실제
domain/protocol 공개 owner를 사용한다. 따라서 PI-001의 옛 문법 사본 예외도 제거한다. RFC 표시
역변환은 domain의 순수 helper 하나를 부르며 실제 actor membership 권한은 각 accepting owner가
별도로 검사한다. 이 공통 runtime은 L2 library로 두고 기능·host·SQLite 구현을 import하지 않는다.

DR46 quarantine 정리: 실제 namespace import는 resource cap·timeout을 적용하지 않으므로
QUARANTINE_RESOURCES와 GitPaths의 quarantine resource/tmp 선언·composition 인자와 그 API만
유지하던 시험을 제거한다. unshare·격리 mount·canonical object 관측·실제 child 종료와 staging
lease는 유지한다. VM의 실제 메모리 할당이나 일반 command 관측 deadline과 혼동하지 않는다.

DR46 격리 설치 보충: 독립 tarball 검증은 제품의 단일 lockfile에서 각 package가 선언한 내부·외부
의존 폐쇄만 선택해 `npm ci`한다. nested 배치·resolved 버전·integrity를 유지하며 루트의 다른
의존 선언을 주입하지 않는다. 새 registry 해석은 Pi의 다른 전이 버전을 선택해 실제 API 로드를
깨뜨렸으므로 제품의 고정 바이트 검증으로 사용하지 않는다. OMA의 공개 declaration과 consumer는
엄격히 검사한다. 프로젝트의 외부 library 진단 제외 정책과 구분해 upstream declaration 진단은
별도 수치로 남긴다. 자체 declaration의 잘못된 타입·누락 import와 root cwd의 Node type 누출을
거부하는 음성 대조를 두며, 모든 public declaration이 실제 검사된 경로인지 대조한다.

DR46 journal 검증 보충: 기존 설정 commit의 kill observer가 journal append·file flush·parent flush도
지나도록 연결한다. 실제 짧은 쓰기 뒤 1/66/133/134번째 byte에서 SIGKILL하고 같은 frozen
candidate를 재시도해 manifest와 rollback predecessor를 대조한다. journal write가 0을 반환하면
무한 반복하거나 commit 성공으로 처리하지 않고 BROKER_UNAVAILABLE로 거부한다. 설정 commit
point와 journal 선행 순서·불완전 기록의 보존 의미는 바꾸지 않는다.

DR46-F01 수정 결정: 다음 형식의 Resident unit은 수락한 profile/modelProfile 참조를 명시적으로
전달하고 현재 역할 설정에서 참조를 다시 만들지 않는다. 없는 frozen 참조는 거절하며 대체하지
않는다. 참조의 모델 내용은 기존 next-activation 시점에 읽는다. Worker 모델 편집도 기존 참조의
내용을 고치며 수락된 참조를 바꾸지 않는다. 새 기본 설정은 Principal과 Worker의 모델 참조를
처음부터 나눈다. Principal과 공유된 Worker 참조를 한 역할만 바꾸는 편집은 묵시적 분리/재지정
대신 거절하며, 직접 작성한 shared profile 자체는 허용한다. 현재 실행 중인 엔진의 snapshot은
설정 편집으로 바뀌지 않는다. 구현과 종료/재시작 증거는 후속 검증으로 남긴다.

DR46 자원/상태 형식 전환: HostConfig schema 3·DB user_version 4·명시적인 plan v2 envelope만
읽고 쓴다. 효과 없는 7필드 ResourceLimits·check 자원 snapshot·runner/systemd의 자원 전달과
표시·contained tool의 무시되는 크기 인자를 제거한다. 실제 VM RAM 할당, 프로세스 취소와 종료
관측, model silence, protocol bounds, FD·snapshot·writer ownership은 유지한다. plan은
{version:2,intent:...}로 새 수락 직전에 직렬화하며 기존 저장 bytes를 보충/변환하지 않는다.
이전 DB/설정/plan 형식은 명시적으로 거절하고 보존한다. 형식 전환과 별개인 같은 빌드의
불완전 게시·journal·unknown 보존은 계속 필요하다. 이전 자원 한도만을 증명하던 시험은
퇴역시키며 다른 사실을 증명하는 시험의 식별자를 반대 의미로 재사용하지 않는다.

DR46 시험 퇴역 기록(실행 PASS가 아님):
- `test/adversarial-repairs.test.ts` — AV-06: saved deadlines remain executable and reject derived unsafe integers at validation
- `test/worker-autonomy.test.ts` — FI-6/UNIT-003: the reference profile gives a Worker a dev-workload budget -- 4 GiB and 256 tasks
- `test/phase4.test.ts` — WP25.03 / D05: a Resident's unit carries its accepted resources, not the current profile's
- `test/operations-config.test.ts` — WP25.03 / D05: a Resident runs with its accepted resources; the current profile only names its model
- `test/contained-tools.test.ts` — P0V-74 / R6-18: the quota is decided at the write, so two writes that each fit cannot together exceed it
- `test/contained-tools.test.ts` — G10-02 / P0: a spool the quota cannot hold is not a silent truncation -- the complete result rides inline with the reason
- `test/contained-tools.test.ts` — DR27/INV10: concurrent empty-file writes and their parent directories share the same quota owner
- `test/contained-tools.test.ts` — DR27/P0V-122: at the exact quota an equal-size edit and a shrinking write remain allowed
- `test/scenario-boundaries.test.ts` — SCN-B04: concurrent Worker writes cannot exceed the workspace quota; the one that fits lands (P0V-74, R6-18)
- `test/scenario-boundaries.test.ts` — DR27/INV10: a Worker cannot exhaust its workspace with empty files or parents, and can still rewrite an existing empty file
- `test/sandbox-environment.test.ts` — FI-5: legacy resource declarations do not become Worker environment limits; nproc reports the host
- `test/sandbox-environment.test.ts` — FI-5: the runner hands the accepted resources to the engine it starts
- `test/r19-integration-policy.test.ts` — R19: resource/runtime disagreement fails instead of silently rewriting a host profile
- `test/r19-integration-policy.test.ts` — R19 / INT-004: complete check profiles are retained; missing limits are refused

DR46 plan v2 보충: 옛 단일-message attestation과 tiered publication snapshot·짧은 request name·
plan 내부 result를 제거한다. mail review fact와 완전 UUID request name이 현재 유일한 형식이다.
실제 direct code.integrate는 유지하며 수락 당시 policyIdentity와 공통 noopRef를 반드시 기록한다.
같은 빌드의 CAS·no-op witness가 확인되면 현재 정책/권한을 보기 전에 원래 결과를 정산한다.
아직 효과가 없을 때만 현재 revision·policy identity·writer·권한을 검사한다. 이전 revision 문자열만
반환하는 policy reader와 의미 없는 review=mail-v1 selector도 제거한다. 구형 형식용 시험은
퇴역 기록으로 남기고 새 형식의 거절·재시작·동일 요청·효과 이후 정책 변경을 검증한다.

DR46 이전 plan 전용 시험 퇴역(현재 PASS로 이관하지 않음):
- `test/attestation-ledger.test.ts` — every removed legacy attestation kind refuses at fresh acceptance and claims no key
- `test/attestation-ledger.test.ts` — a malformed attestation is invalid input, not a profile refusal
- `test/attestation-ledger.test.ts` — an accepted legacy row keeps its receipt: same-key replay answers before the removed grammar
- `test/attestation-ledger.test.ts` — durable decode and the tier evidence snapshot still read a legacy attestation row
- `test/attestation-ledger.test.ts` — DR27: a pre-v3 database fails closed at open and at diagnostics; no migration is attempted
- `test/tier-evaluator.test.ts` — DR27/TIER-001: every floor and the Worker's requested tier can only raise the result
- `test/tier-evaluator.test.ts` — DR27/TIER-005: LOW needs no assigned reviewer, but does not ignore an active objection
- `test/tier-evaluator.test.ts` — DR27/POL-004: a distinct child can approve; authenticated submitters and duplicate votes cannot
- `test/tier-evaluator.test.ts` — DR27/TIER-006: HIGH requires delegated latest exact ACCEPT, not a prior decision resurrected by revoke
- `test/tier-evaluator.test.ts` — DR27/CHAL-005: a floor requires an exact scope assessment for each new candidate identity
- `test/tiered-integration.test.ts` — an accepted tiered publication plan still decodes exactly and rejects drift
- `test/tiered-integration.test.ts` — a pending tiered publication row reconciles under its retained policy, once
- `test/tiered-integration.test.ts` — publication proof is observed, exact and single-use for a pending publication row
- `test/review-grammar.test.ts` — decode: legacy attest.record plan is unchanged

DR46 사용량 산술 전용 시험도 퇴역한다:
- `test/contained-tools.test.ts` — DR27/INV10: empty files and parents have finite cost; a refused write creates neither
- `test/contained-tools.test.ts` — DR27/INV10: aliases cost metadata once per name and data once per inode; links are not followed
- `test/contained-tools.test.ts` — FI-4: the excluded trees are skipped by directory name only, never as files or at the root

DR46 검증 보충: 현재 tier policy는 HIGH peer 최소 2를 canonical grammar에서 검증하며,
이전 floor 1 snapshot을 읽던 TIER-004의 전용 호환 경로/시험은 퇴역한다. 새 snapshot의 floor 2는
원본 설정을 3으로 편집해도 바뀌지 않는 별도 회귀로 확인한다. direct integration의 CAS/no-op
증거에는 실제 SHA-1/SHA-256 저장소와 SIGKILL/restart 시험을 추가하고 durable boundary 목록에
no-op adapter owner를 등록한다. 이는 시험 등록이며 실행 PASS는 validation에만 기록한다.

DR46 schema 검증 전환: V01B의 이전 schema-v3 DDL golden은 이전 형식만 동결하던 시험이므로
퇴역한다. 사용자 승인된 본 전환은 schema 4/plan 2이며 이전 hash를 새 DDL로 단순 refresh하지
않는다. 새 시험은 schema 4의 정확한 6 entity와 이전 형식의 무변환 거절·보존을 독립적으로
검증한다. 배포 artifact의 SQL byte 결박은 기존 package/deployment digest owner가 수행한다.

DR46 boundary 검사 보충: canonical no-op primitive를 목록에 넣자 context authorization owner의
시험 등록 누락도 드러났다. 예외로 빼지 않고 별도의 실제 context witness SIGKILL/restart 시험을
추가한다. 과거 direct tiered publication이 쓰던 빈 PreacceptScope와 호출자 없는 CheckProfile/
revision-reader 별칭도 제거한다. 실제 artifact scope가 있는 review/context 경로는 유지한다.

DR46 check 검증: V01B의 자원 timeout/미자격 check 전용 fixture는 퇴역한다. 현재 명령 grammar의
완전한 argv/env를 유지하고 빈 실행 인자를 거절하는 새 DR46 oracle로 검사한다. 새 snapshot을
실제 systemd/cgroup 지원 PASS로 표현하지 않는다.

DR46 후속 LSP 전환: `@oma/tool-lsp`가 등록 코드·호출 scratch/stall owner와
`pi-lsp` payload 전체를 소유한다. 이전 source/vendor 경로는 삭제하며 재수출하지 않는다.
vendor byte pin은 이동으로 재생성하지 않는다. 빌드는 선언한 directory asset을 link 없이
정확히 복사하고 compiler output과 충돌하면 거절한다. 다른 tool과의 조립은 extension에 남는다.

DR46 추가 퇴역 기록: `test/goal-publication.test.ts`의
`CTX-003/P0: legacy pending no-op has no invented witness or retroactive failed result`는
필수 noopRef가 없고 envelope도 없는 과거 plan을 unknown으로 읽는 옛 decoder 전용 시험이었다.
단일 현재 형식 전환에 따라 퇴역한다. 이 ID의 뜻을 현재 형식 거절로 바꾸지 않는다.
같은 빌드의 witness 이전 unknown과 확인된 witness 정산은 기존 현재 plan 복구 시험과
`test/integration-witness-kill.test.ts`의 실제 SIGKILL/restart/retry가 계속 검증한다.
CLI 복구 양성 fixture의 request name은 현행 full UUID로 고쳤다.

DR46 vendor 설치 결정: 실제 npm pack 실험에서 중첩 node_modules는 포함되지만
web/MCP의 `node_modules/isexe/.npmignore`(각 23 bytes)는 npm이 항상 제외했다.
원시 근거 `nested-vendor-pi-{web-access,mcp-adapter}-experiment.json`은 이 누락을 기록한다.
런타임 코드·의존 버전·원본 바이트를 바꾸거나 verifier의 exact-set를 약화하지 않는다.
두 파일만 `node_modules/isexe/npmignore.oma-vendor`라는 보관 이름으로 옮긴다.
manifest의 generated.packaging에 원래 경로·보관 경로·원래 SHA를 기록하고 유지 스크립트는
그 이름과 SHA를 검사한다. 원래 upstream/ snapshot과 JS/runtime payload는 그대로다.
manifest 형식은 같은 파일 목록·해시 문법이며 새 이름을 가진 새 pin을 쓴다. 과거 manifest의
파일 경로를 런타임에서 재해석하거나 자동 복구하지 않는다. tarball 설치 후 현재 source와
파일·빈 디렉터리·해시 전체를 대조한다. 누락·변경·추가 파일은 계속 실패다.

DR46 추가 퇴역: `mail-v1 / INV04: the tools' request-name mirror is the wire grammar`는
현재 production이 이미 domain 단일 owner를 호출하는데 옛 8-hex 정규식 사본과 비교하던
과거 mirror 전용 시험이다. 그 ID의 뜻을 재사용하지 않고 퇴역한다. 현재 full UUID grammar와
짧은 이름 거절은 review-grammar/current-format-refusal이, 실제 tool의 입력 전달은
principal-tools의 실행 오라클이 검증한다. R30의 derived world/receipt/비공개 본문 불변 시험은
유지하며 삭제된 CPU/memory/tasks 환경 안내 assertion만 제거한다.

DR46 전환 시험 후속: authority/candidate-check의 resource-only 음성 입력이 삭제 후 유효한
base 사본으로 남아 있던 assertion 4개는 퇴역한다. 닫힌 spec·argv·모델 참조의 현행 거절은 유지한다.
DR27의 schema3 생성·미래 schema4 거절 오라클은 해당 과거 형식의 기록으로 퇴역하며 DR46에서
schema4 생성/무변경 재열기와 1/2/3/5/99 거절을 별도 시험한다. V04A의 physical identity·WAL·
committed intent 불변 의미는 유지하고 fixture 버전/plan envelope만 현재 형식으로 바꾼다.
P2의 peer attestation/short-name 양성 vector는 퇴역하고 DR46 current wire vector를 새로 둔다.
T93의 Principal 참조 편집 오라클은 유지한다. 과거 Worker 참조 재지정 assertion은 퇴역하고
DR46에서 기존 Worker 참조의 내용만 바뀌며 Principal은 보존되는 실행 오라클로 교체한다.
삭제된 resource 시험의 lane requiredNames도 제거한다. 경계 수명/종료/containment 시험은 유지하며
실제 integration/context witness kill 6건은 durable lane에 추가한다.
네 tool의 기능 시험은 각 package/test로 옮기고 원래 ID/입력/오라클을 유지했다. 조립과 유지 script
검증은 root에 남겼으며 duplicate 실행은 만들지 않았다. type annotation만 제거한 MJS는 제품과
같은 Node로 실행한다. source와 deployed bundle을 서로 다른 경로에서 검증하도록 시험 관측도 고쳤다.

DR46-F02 결정: 실제 LSP entry에서 정상 별도 bundleDir의 검증이 변조된 owner-local
runtime을 허용하는 것을 재현했다. 관측 대상과 load 대상은 하나여야 한다. 출시 전
미사용 bundleDir override와 빈 WebToolsOptions를 제거한다. 네 tool은 자기 module URL의
bundle만 검증한다. 이전 copied-probe 전용 단위 시험 네 건은 같은 거절 의미를 보존하면서
실제 copied owner·변조 payload·정상 별도 probe를 사용하는 통합 오라클로 옮긴다.
이 변경은 runtime vendor JS/pin이나 사용자 durable state의 형식을 바꾸지 않는다.

DR46 현재 실행 안내 정합성: 실제 sandboxArgs의 `--share-net`과 닫힌 HostConfig에 맞춰
START.md에서 과거 allowlist/선택적 Human proxy 설정/다른 통신 전부 실패라는 안내를 제거한다.
주입된 proxy와 실제 연결·host 권한을 설명한다. 현재 role prompt와 같은 의미이며 새 네트워크
권한을 추가하는 변경은 아니다. R30의 derived view·receipt 불변 시험에 이 안내를 확인한다.

DR46 독립 extension artifact는 더 이상 자기 vendor 사본을 만들지 않는다. 실제 선언한 네 tool
의존이 자산을 소유하며 artifact 시험도 그 각 owner를 읽어 검증한다. mutable UX ledger의
옛 source 링크는 현재 owner로 고쳤고 이전 발견·요구 ID와 역사적 실행 판정은 유지한다.

DR46 핵심 extension 전환: 실제 조립과 Society 도구·delivery·Principal channel·bridge·prompt
경계를 `@oma/extension`으로 옮기고 root의 pi-extension/extension 경로와 별도 tsconfig를 삭제한다.
실행 경로는 단일 DEPLOYMENT_LAYOUT를 따르며 독립 artifact도 같은 workspace의 manifest/API를
사용한다. 조립 entry의 과거 tool-runtime/domain 재수출은 제거하고 소비자는 실제 owner를 부른다.
Pi 전달 revision/boundary/wait 접두사의 같은 bytes는 protocol/delivery-boundary 한곳이 소유하고
보고 DTO는 contracts가 소유한다. storage는 여전히 실제 receipt 검증·mint·durable publication을
소유하며 단순 DTO나 notify를 증거로 승격하지 않는다. receipt/schema/wire version은 바뀌지 않는다.
Principal channel도 기존 protocol의 FD/env/line bound를 직접 사용한다. 과거 사본의 equality
assertion 두 개만 퇴역하며 T114의 credential corpus·실제 읽기·spawn FD·서로 다른 권한 slot
오라클은 유지한다. 원래 이름/뜻은 이 기록에 남기고 반대 뜻으로 재사용하지 않는다.
bridge/prompt 단위 시험과 세 wait hook 시험은 ID·입력·assertion을 유지해 package/test로
이동하고 UI/engine/실제 mail과의 조합 시험은 root에 둔다. durable lane은 새 시험 경로도 실행한다.

DR46-F03 결정 — extension 이동 중 드러난 preload 배치 결합: 실제 Resident spawn plan은
`dirname(coreExtension)/runtime/client-preload.js`를 계산했다. 15번째 workspace 전환 후
실제 owner가 아닌 packages/extension/dist/runtime 파일을 가리키는 것을 실제 plan API의
음성 오라클로 확인했다(`preload-owner-before.log`: 0 PASS/1 FAIL, 입력 `849f6731…`, 변화0).
이것은 root 14 workspace의 기존 동작을 위반했다고 주장하는 발견이 아니라 분리 중인
checkout의 회귀다. preload의 package-generation pin과 client runtime 초기화 owner는
현재 app/runtime 조립이다. DEPLOYMENT_LAYOUT.clientPreload를 추가하고 Resident와 Principal은
설치 libdir에서 그 경로를 읽는다. extension dirname 추정과 잘못된 위치의 가짜 preload
fixture는 없앤다. 실제 설치물 존재·spawn plan과 confined 실행을 다시 검사한다.

DR46-F04 결정 — 네트워크 검증의 범위: T117의 기존 rootfs probe는 제품의 --share-net 없이
직접 --unshare-all을 실행하고 연결 실패를 제품의 egress 차단 증거로 읽었다. 현재 sandbox
recipe는 host/guest 네트워크를 공유하므로 이 테스트의 network-only oracle과 옛 제목은
퇴역한다. 이 과거 T117 문장의 뜻은 이 기록에 보존하며 현재 허용 의미로 재사용하지 않는다.
새 DR46 시험은 실제 planPiSpawn→spawnSandboxed recipe에서 host state/credential/home의
비가시성·read-only rootfs·agent identity를 검사하고, host의 임시 loopback server와 marker를
주고받아 공유 네트워크를 확인한다. 같은 recipe에서 --share-net을 제거한 별도 음성 제어로
probe가 실제 namespace 차이를 구별하는지도 확인한다. 외부 인터넷/VM/provider 권한을 증명하지
않으며 제품 네트워크 권한이나 durable 형식은 바꾸지 않는다.

DR46 검토 oracle 발견 경로: review-ledger 갱신은 소스가 그대로인 pi-compat/env.ts의
post-listen oracle을 찾지 못해 중단됐다. 같은 ID/입력/assertion의 시험이 extension/test로
이동했는데 testNames가 root test만 읽은 것이 원인이다. immutable review-notes를 다시 쓰거나
옛 test facade를 복원하지 않는다. 실제 workspace/test를 포함해 선언을 발견하고, 문자열/주석의
가짜 test 호출은 AST로 배제한다. production 소스의 경로/byte가 바뀐 review는 계속 무효화하며
새 소스는 NOT_REVIEWED다. 발견 경로 확장은 기존 ID를 재해석하거나 현재 byte를 자동 승인하는
근거가 아니다. root build:extension도 이전 독립 export utility 대신 실제 workspace build를
호출한다. 외부 --out artifact exporter는 명시적 별도 도구로 유지한다.

DR46 업무 port 전환의 공통 기초: 저장 구현에 있던 Agent/Delivery/Batch/Subscription 행 DTO와
NewOperation/NewAgent 입력 DTO는 contracts가 소유한다. 실제 행 decoder와 SQL 관계 검증은
storage에 남긴다. frozen agent spec의 닫힌 JSON 해석은 domain/agent-spec으로, 같은 spec의
name/profile/hash 관계는 domain/spec-identity의 단일 판정으로 모은다. authority는 구체
StoreReads의 Pick 대신 getAgent/societyOpen의 명시적 reader만 요구하고 효과 시점 재검증과
capability getter 재관측을 유지한다. receipt projection의 실제 구현은 protocol로 옮기며
storage의 옛 경로/재수출 facade는 제거한다. DB schema·plan envelope·receipt bytes·hash domain·
단일 writer/root synchronous transaction과 같은 빌드 복구의 의미는 바꾸지 않는다.
이 단계 자체가 Mail/Git/Review/Lifecycle/Broker의 최소 effect/ledger port 완성을 뜻하지 않는다.

DR46 기초 전환의 alias 시험: error-receipt-policy의 StoreError convenience export와 Mail의
receiptOf re-export를 서로 같은 함수라고 비교하던 assertion만 퇴역한다. 오류의 phase/observation/
effect 분류, 원래 row JSON·terminal/result 불변과 receipt codec 거절 오라클은 유지한다.
같은 시험 제목의 넓은 원래 의미를 반대 뜻으로 재사용하지 않는다. 순수 authority의 닫힌 spec
시험은 ID/입력/assertion을 유지해 domain/test로 옮기며 데이터 fixture도 domain validator를 쓴다.

DR46 Mail ledger port: Mail은 실제 사용하는 조회와 7개 transaction method의 명시적 port를
소유한다. app으로 이동할 broker 조립이 Store를 연결하며 transaction projection은 원래 tx의
captured closure만 복사한다. ambient Store mutation을 wrapper로 호출하지 않는다. projection은
동결하며 transaction 종료 뒤나 다음 transaction 안에서 재사용해도 거절돼야 한다. 같은
Store/root synchronous T·runtime thenable 거절·accept 직전 현재 권한 검사는 유지한다.

DR46-F05 결정 — arrival append의 부분 기록: 실제 MailMaterializer는 writeSync의 반환 크기를
무시해 잘린 journal 뒤에도 delivery.materialized와 operation.succeeded를 기록했다. 실제
API의 부분/0-byte 쓰기와 SIGKILL 후 재시작으로 재현했다. arrival의 physical append owner는
모든 바이트를 쓰고 파일과 parent를 flush한 뒤 반환한다. 0-byte 쓰기는 unknown으로 거절하고,
이전 실행의 미완성 tail은 별도 줄로 닫아 새 완전한 record와 붙이지 않는다. 기존 완성 record를
삭제하거나 원문/수락 plan/terminal을 재해석하지 않는다. owned append 파일은 pinned inode의
regular type을 확인하고 owner bit만 더하며, link·FIFO·관측 실패를 absent로 읽지 않는다.
부분/정지 쓰기·실제 SIGKILL·같은 key retry·재시작·반복 복구가 회귀를 소유한다.

DR46 Mail effect port와 workspace: 실제 Mail/MIME·routing·batch·materialization·recovery와
원래 순수 batch 시험은 `@oma/mail`이 소유한다. Mail은 contracts/domain/protocol과 자신이
직접 선언한 nodemailer에만 의존한다. app 조립은 실제 Store projection·PreacceptScope와
4개 parent-effect 소비자를 필수 port에 연결한다. proof와 checked receipt의 선언만 contracts로
옮기며 실제 mint/WeakMap·WeakSet/consume/decoder는 기존 효과 owner에 남긴다.
메일함 capability는 수리한 inbox/new/cur descriptor를 게시·관측·이동·arrival·flush가 끝날
때까지 보유한다. immutable publication은 pathname/held-directory 두 entry가 같은 구현을
쓰고 caller-owned descriptor를 닫지 않는다. 파일 권한 손상을 unavailable의 근거로 쓰던
V20B fixture는 실제 I/O 오류로 음성 제어하며 owned mode 수리의 성공을 별도 확인한다.
원래 batch index folding/rendering은 Mail의 순수 함수 하나로 옮기고 storage는 이미 결정된
JSON/index 두 문서만 쓴다. 기존 wire/DB/plan/receipt bytes의 형식과 의미는 바꾸지 않는다.
Mail의 storage API convenience 재수출과 MIN_MIXED_BATCH_MESSAGES 별칭은 제거하고 실제
소비자를 storage/domain owner로 바꾼다. 두 함수 identity 비교 assertion만 퇴역하며 기존
immutable/no-replace·fault/flush·recovery 시험의 제목·입력·판정을 반대 의미로 재사용하지 않는다.

DR46 설치 의존 owner: `check-package`의 고정 runtime pin 목록은 필수 라이브러리의 존재를
요구하며 루트가 직접 소유한다는 뜻이 아니다. 실제 선언한 root/workspace 각각에서 설치물을
해석하고 owner identity·선언/lock·설치 경계·버전을 확인한다. 같은 필수 pin의 owner들은 같은
버전이어야 한다. Mail의 nodemailer를 루트 runtime dependency로 중복 선언해 우회하지 않는다.
배포 layout의 workspace 목록도 Mail을 포함하며 manifest와 compiled bytes를 함께 결박한다.


DR46 Git/Review 경계: actual command/repository와 workflow entry를 분리한다. Git은 구체
Store/Mail/Review를 받지 않으며 독립 review gate·messaging·ledger·repository port를 소비한다.
ReviewAuthorityReader는 app에서 먼저 조립하며 Git의 최종 동기 gate와 Review가 같은 실제
reader를 사용한다. Review workflow는 Git 밖에서 만들고 public dispatch와 reconcile에도
별도 port로 전달한다. main/context writer·witness-first settlement·현재 authority와 policy의
최종 동기 CAS 검사·모든 accepted byte 의미를 유지한다. SQL/명령 callback bag이나 getReview
registry·old Git.reviews facade는 남기지 않는다.

공통 observation·ChangedPath, notification draft와 preaccept owner는 contracts의 선언 한
owner를 사용한다. 순수 integration policy/tier/diff 표시는 domain의 원래 구현으로 옮긴다.
실제 Git process/FD/TreeLease와 publication 증거 발급·소비는 물리적 owner에 남긴다. Git과
config의 storage 의존은 명시한 file API만 허용하며 erased Store type도 거절한다. Git5개와
Review3개 transaction method는 원래 captured tx closure만 app에서 투영한다. corruption
observer는 원래 Store의 admission gate에 연결하며 복구 쓰기 자체를 새 acceptance와 혼동하지 않는다.

해시 정체성 정리: 현재 production 호출에는 별도 stream domain이 없고 descriptor는 params에
있다. request-hash facade·세 번째 인자·옛 branch·Storage reused 재수출을 제거한다. 실제
requestHash/reused는 request-identity, canonical JSON/hash primitive는 canonical-json에 둔다.
method+params literal recipe·accepted stored hash는 바꾸지 않는다. 옛 stream-positive와
facade alias identity assertion만 퇴역하며 새 removed-argument refusal/실제 Store key-reuse
검사로 대체한다. hash-valid GOAL 모순 시험은 새 notification port에 올바르게 주입하고
원래 corruption 판정과 accepted pending/CAS 보존 조건을 유지한다.


DR46 Lifecycle 경계: 생성/실시간 권한·lineage·정지/재개·society fence·ack/follow·복구와
creation evidence는 실제 Lifecycle use case가 소유한다. app이 최소 live query·10개 captured
root T closure·필요한 unit/mail/workspace/identity/scope/directory port를 연결한다. 구체 Store,
implementation Pick/ReturnType, ambient write나 old constructor facade를 두지 않는다.
workspace clone/staging/FD/TreeLease/PreparationExecutor와 provisioning HEAD 관측은 Git의
실제 physical adapter 한 곳이 소유한다. accepted base/spec/incarnation·unit installation과
provisioning readiness commit/opaque evidence의 의미는 Lifecycle에서 판정하며 입증 뒤에는
Resident의 현재 workspace로 과거 readiness를 재해석하지 않는다. 모든 Resident 정지 시도와
unknown death, live incarnation·현재 권한과 activation, accepted hash/plan/terminal bytes와
현재 confined origin을 그대로 유지한다. feature가 쓰지 않는 physical path 필드는 app의
composition 입력으로 옮긴다. 실제 bootstrap의 trusted peer/ID/scope owner도 app에서 연결한다.


DR46 Reconcile 경계: 시작/주기 복구의 순서, 동일 sweep Promise, self-await 거절, operation별
failure containment와 현재 identity/activation/GOAL/unit 재검사는 Reconcile이 유지한다.
구체 Store/Mail/Git/Review/Lifecycle/Units나 implementation-derived type은 가져오지 않는다.
app은 read-only ledger와 정확한 기능/unit port를 만들고 corruption observer를 원래 Store의
admission fence에 결박한다. 새 acceptance나 T 권한은 복구 순서 owner에게 주지 않는다.
quiesce의 every-resident 판정은 Lifecycle의 실제 함수를 app에서 연결한다. pending-work도
기존 full-row 검증/동기 projection 한 곳을 사용하며 단순 boolean 정책을 다시 구현하지 않는다.

실제 preaccept scan/delete/owned repair/lease 관찰은 Storage의 collectUnacceptedArtifacts로
옮긴다. accepted plan이 실제로 이름 붙인 message를 Domain.ownedMessages로 검사하며
Mail.namedMessages 편의 facade는 제거한다. 미확인 소유권이나 child lifetime은 계속 보존하고
reported kept로 남긴다. bounded event 표시는 Reconcile에 두며 collection/count DTO만
contracts가 소유한다. 실제 fsck executor·spool·TreeLease와 stale-child quiescence는 Git의
CanonicalHealthObserver로 옮기고 Reconcile은 consume-once fresh main 비교와 await 뒤
재quiesce 순서를 유지한다. 5초 sweep 정책은 순수 Domain owner 하나에서 Broker와 공유한다.

Reconcile의 옛 health proxy 메서드도 제거하며 실제 health 호출·fault 검증은 Git의 공개
CanonicalHealthObserver API를 사용한다. 기존 T68c/T68d의 healthy/spool/assertion 의미와
등록 제목은 유지하고 durable collection boundary만 실제 새 physical owner로 옮긴다.


DR46 Broker 경계: authenticated transport·dispatch·peer/run authority·readiness·drain은 Broker,
실제 Store/기능 projection과 물리 I/O 연결은 app이 소유한다. Broker는 구체 Store/Mail/
Git/Lifecycle/Reconcile/Units/Views를 import하거나 생성하지 않는다. app의 admission callback은
원래 Store에 같은 실제 Gate를 연결한다. incarnation 전용 captured T는 원래 tx.updateAgent의
폐쇄된 scope만 사용하며 accept/spec/desired write를 노출하지 않는다. root T의 thenable/
stale/cross-T refusal과 모든 accepted receipt의 의미를 유지한다.

옛 direct-construction standaloneLock 호환 경로를 제거한다. 실제 product는 설정/Store보다
먼저 획득한 Native.ProcessLock을 필수로 전달하고, Broker drain이 끝난 뒤 outer Lifetime이
이 토큰을 해제한다. 테스트만의 fixture는 그 테스트가 연 토큰을 정상 drain 뒤 해제하며,
이것을 production의 pre-configuration ordering 또는 실제 Resident death qualification으로
부르지 않는다. ProcessLock의 FD/inode/flock/child-inherited lifetime은 Native에서 유지한다.

실제 cgroup pin은 Native, peer 인증·현재 cgroup 비교는 Broker, 순수 cgroup.events grammar는 Domain 한 곳으로
옮긴다. run state와 live settlement confirm closure는 Broker에 남긴다. StatusSnapshot/
RunnerObservation/UnitObserve/SettlementQuiescence와 RecoveryCounts는 공통 선언 owner를
사용하고 실제 확인·proof 발급은 원래 런타임 owner에 둔다. consumer port 선언을 한 acyclic
파일로 옮기며 public/내부 data 권한과 Broker 소유 peer projection을 분리한다. 실제 같은
PeerAuthenticator를 부르는 Broker의4개 중복 pass-through도 제거한다. event/status/sweep의
unknown·current identity·synchronous final check 순서를 바꾸지 않는다.

FS-005의 옛 Broker 전체 파일 예외도 제거한다. socket 이름은 실제 Storage owner만 지우며
Broker의 가상 raw unlink는 negative control에서 거절한다. transport spool도 Storage가
held-parent/file/reader FD와 same-inode handoff를 소유하고 Broker는 필수 makeSpool port만
호출한다. 임의 shell/SQL callback registry나 old spool/constructor facade를 남기지 않는다.
Config와 test composition이 실제 공유하던 protocol reference literal도 Domain 한 owner로
옮기며 값과 host 설정 출력 bytes를 바꾸지 않는다.

DR46-F06: 실제 TransportSpool.append가 writeSync=0에서 CPU 무한 루프에 빠짐을 root19의
isolated child에서 재현했다(`transport-zero-write-before-fix.json`: actual branch entered,
1.5초 ETIMEDOUT/SIGKILL, changed[]). 실제 write loop에 zero-progress 오류를 추가했으며
Storage 짧은 write의 전체 bytes/handoff, zero 오류1회와 실제 file/directory FD close를
검사한다. stage build/초기 owner smoke3개는 PASS이나 root20에는 아직 미반영이다.
이 SIGKILL 재현과 unit fault 검사를 실제 power loss나 native systemd qualification으로
세지 않는다. 당시 실패 원본은 그대로 보존한다.


DR46 Broker owned listing: 첫 정적 gate는 옛 InternalDispatcher owned-state 예외가 이제
불필요함과 app으로 옮긴 raw readdir를 함께 검출했다. 예외를 새 위치로 복제하지 않고 실제
Storage.listOwnedDirectory의 held inode/owner repair를 사용한다. 이 primitive의 기존
optional diagnostic null=unknown 의미는 유지하며, 새 required:true 관측은 실제 실패를
그대로 전파한다. callback은 모든 entry 이름/순서를 유지하고 missing mailbox를 생성하거나
unavailable을 empty success로 답하지 않는다. stage의 이전 실제 compiled callback은 mode000
leaf에서 EACCES/미수리였음을 재현했다(`principal-listing-before-fix.json`, UID1000).
그 read-capability의 실제 mode repair·전체 이름·missing/EIO 거절·held FD close 시험을
추가했다. 이 수정의 범위와 runtime 결과를 기존 authored review 승인으로 해석하지 않는다.


DR46 Engine 시작: 실제 source scan에서 pi-runtime.engineFile은 production 호출0개이며
export 정의와 전용 fault-test2개만 있었다. 미출시 internal dead API와 그 전용 read/close
시험만 제거한다(`engine-dead-reader-retirement.json`). 해당 이름/이력을 새 반대 의미의
시험에 재사용하지 않고 다른 실제 FD/cleanup 시험은 유지한다. 이로써 죽은 reader 때문에
Engine이 Native 파일 capability를 갖던 불필요한 의존도 제거한다. 런타임 pin 검사·실제
current model/auth/settings·child/process/receipt/retry 수명은 별개이며 보존한다.
Recorded extension identity는 원래 plain path/sha256 DTO였음을 실제 코드로 확인했다.
이를 runtime proof나 WeakMap-issued authority로 설명하지 않는다. DTO/패키지 resource paths/
FencedEngine 선언은 contracts, 순수 extension path order와 원래 role prompt literal은 Domain의
한 owner로 옮긴다. 실제 integrity 관찰과 SDK/settings/process behavior는 다음 분리에서
같은 호출 순서와 오류 의미를 유지한다. 현재 Engine은 구현 중이며 module22 완료가 아니다.

DR46 Engine 경계 후속: SDK host 35개 소스를 실제 Engine workspace로 옮기고, 설정은 SDK 변환과 app의 실제 파일·잠금 owner를 연결한다. 한 lock hold의 read/transform/replace, project writer 충돌 검사와 cleanup 실패 전달을 유지한다. Personal의 birth·extension selection·history·Keychain helper와 TUI renderer는 app에서 구체 owner를 연결한다. Resident sandbox capability는 별도 app 조립으로 Personal closure에서 제외한다. Pi session header는 현재 pinned SDK version 하나만 승인하며 missing/이전 version 수용은 제거한다. current-version 기록의 identity/bytes나 복구 절차는 변경하지 않는다. 독립 빌드·집중 검사·설치 검사 결과가 나오기 전 전환 완료로 세지 않는다.

DR46 Engine 검증 경계: compiled-module URL는 같은 workspace의 실제 authored executable TS 파일로 확인될 때만 허용한다. missing/ambient-only/다른 workspace/raw 미선언 자산은 negative control로 계속 거부한다. 계산된 private SDK URL import를 수행하는 기존 세 경우는 root의 명시적 SDK integration probe에 남기며, package module-loading 검사를 완화하지 않는다. 실제 decoder의 current header만 지원하는 변경은 새 birth/기존 기록 재작성·삭제를 수행하지 않는다.

DR46 Engine SDK 접점: Open TUI finished-line matching과 version/string 의존은 기존 TUI 파일을 삭제하고 실제 Engine owner로 이동한다. ASCII logo·문구와 visibleWidth 함수 자체는 그대로 유지한다. 실제 panel styling은 TUI에 남기고 SDK host가 app의 presentation port로 연결한다. Engine이 배포하는 pi-compat/contacts.json이 남은 private 접점·정확한 의존 버전·제한의 단일 목록이며, 원본 review는 갱신하지 않는다.

DR46 Linux 경계: units/sandbox/rootfs·seccomp·guest clock/filesystem/systemd launcher의 실제 OS 동작과 systemd/guest image C·service 자산을 Linux workspace로 이동한다. GuestControl의 결정과 현재 Config를 읽는 receiptWaitFloor는 App에 남기고 common GuestSystem/HealthFacts/ReceiptWaitFloor 및 lifecycle effect 선언은 contracts가 단독 소유한다. Linux는 Config/Client/Engine/App 구현을 import하지 않는다. endpoint 관찰은 App의 원래 Client 함수를 연결하고 stop의 manager proof와 endpoint 관찰을 보존한다. 현재 horizon은 요청 때마다 읽고 unknown에서는 freeze하지 않는다. 실제 root는 아직22이며 이 stage는 빌드·검증 중이다.


DR46 Mac/App 경계: 실제 Mac 파일·암호화 archive·Keychain/native channel·image 및 Swift 입력은
Mac workspace로 옮긴다. 공통 PlatformError는 Protocol, StreamSink/KeychainStore 선언은
Contracts, SDK credential blob 처리는 Engine, 실제 writer lock과 helper 조립은 App이 소유한다.
Linux project preparation과 host Git API는 Git이 소유하며 Mac은 명명된 두 host API만 소비한다.
Keychain mutation에는 실제 cross-process lockPath가 필수이며 test-only 무잠금 fallback을
제거한다. child EOF는 실제 종료가 아니며 상속 fence는 실제 child 종료까지 유지한다.

DR46-F07: Mac 파일 쓰기는 writeSync=0에서 진행 없이 반복할 수 있었다. 실제 기존 구현을
isolated child에서 재현하고 SIGKILL한 원본은 mac-zero-progress-before.json에 보존했다.
Mac/files의 단일 writeHostBytes가 짧은 write를 끝까지 쓰고 zero/invalid progress를 EIO로 거부한다.
replacement/archive/App transfer가 이 owner를 사용하며 기존 bytes·temp 제거·FD/caller 소유권을
검사한다. native Mac qualification이나 power loss의 증거로 세지 않는다.

DR46 현재 package 형식: index는 oma-installed-packages-v1 envelope와 source/entries/skills/
prompts/themes 전체 필드를 사용한다. bare array와 과거 생략 규칙을 제거한다. Personal 설정은
oma-personal-settings-v2, before-image는 oma-package-before-image-v1만 지원한다. 옛 형식은
UNSUPPORTED_PROFILE로 거부하고 저장 bytes를 남긴다. 같은 빌드의 immutable before-image,
같은 요청 retry/restart와 exact terminal 의미는 유지한다. parse 실패와 명시적 지원 불가를
서로 삼키지 않는다. uninstall 별칭과 수기 proper-lockfile ambient 선언은 제거하고 실제 배포
타입 패키지를 직접 개발 의존으로 선언한다.

DR46 App 배치: root 실행 src는 제거하고 실제 소스를 apps/oma/src로 옮긴다. CLI/preload/
model command/guest session과 systemd 실행 경로는 명명된 DEPLOYMENT_LAYOUT를 사용한다.
aggregate 설치 루트를 고정 깊이로 아는 세 제품 entry만 그 capability를 가지며 다른 패키지의
ancestor 탐색·상대 경로 escape를 허용하지 않는다. Root compiler는 통합 tests만 빌드한다.


DR46-F08 — status page 크기 계산: 원본25의 응답성 재실행은 serial V23A의 read lag59ms로
기존50ms 기준을 넘었다. 같은 제품 bytes의 앞선 실행은45ms였다. 원인을 검사하며 순수
Protocol/status-page가 행을 추가할 때마다 전체 누적 응답을 JSON 직렬화하는 제곱 비용을
확인했다.64행 한 페이지에서 row 직렬화2080회가 발생했다. 기존 wire envelope·UTF8 크기·
continuation 예약·cursor·FRAME_TOO_LARGE의 의미를 유지하면서 각 행의 bytes를 한 번 더하는
선형 계산으로 바꾼다. 권한/Store/accepted 사실과 타이머·50/100/1000ms 기준은 변경하지 않는다.
이 비용이 관측한 지연의 유일한 원인이라고 단정하지 않으며 기존 실제 응답성 검사로 재검증한다.


## DR47 — 코드 품질 보완과 App 통합 시험 경계

사용자는 실제 코드 검사에서 확인한 두 cleanup 결함과 interactive/App API/SDK coupling의
보완, 새 spec과 구현을 승인했다(2026-10-25). [품질 보완 명세](archive/documentation-cleanup-2026-10-25/code-quality-improvement-spec.md)가
범위와 수용 기준을 소유한다. durable/wire/권한/복구의 의미는 변경하지 않는다.

App은 제품 조립 root이며 다른 기능 package가 그 내부 module에 의존하지 않는다. Root의
integration test를 위해140개 내부 module을 public export하던 범위를 installer assets와 실제 admin diagnostic API4개로
줄인다. Root private Node imports의 #oma-test/app/*는 root integration test만 사용할 수 있다.
동일 authored App source의 compiled output만 대상으로 하며 다른 package·production·script의
접근과 target 변조는 거부한다. DR46의 feature package 간 export 강제는 유지한다. 이는 App
내부 시험의 접근 규칙을 바꾸는 결정이며 옛 public 경로의 alias/facade를 남기는 결정이 아니다.

SDK 공개 hook이 없는 기존 기능은 단일 검증 adapter로 유지하고 host의 raw private cast를
제거한다. 잔여 접점 수와 이유를 그대로 기록하며 private 의존 제거로 과장하지 않는다.

## DR48 — 닫힌 Society 작업공간의 중복 제거 보관

사용자는 세션마다 Worker clone이 계속 누적되는 문제의 해결과 공식 문서 조사 후 제안한
프로젝트별 Restic 저장소 방식을 승인했다(2026-10-25). 이 결정은 §10의 clone 상시 보관을
닫힌 세션의 복원 가능한 cache로 바꾼다. Worker마다 독립된 Git refs/index/worktree와 기존
협업·push 권한은 유지한다. Git branch만으로 작업 중인 상태를 대체하지 않는다.

Broker drain과 Store.close가 끝나고 모든 Resident의 현재 native 종료가 확인되어야 저장한다.
repos, staging, 각 Resident의 workspace/home 전체를 --force로 읽는다. 숨김·ignored 파일,
Git index/refs/reflog, 파일 bytes·mode/uid/gid/nanosecond mtime, symlink target과 내부 hardlink
관계를 보존한다. 소유권을 현재 user/group 권한으로 복원할 수 있어야 한다. DB/WAL, mail,
runner receipts/history, Principal 대화·private workspace는
보관 대상에서 제외하고 원래 세션에 남긴다. 특수 파일·nested mount·extended attributes가
있는 작업공간은 현 검증 형식의 범위를 넘으므로 원본을 남기고 회수하지 않는다.

정확한 snapshot ID·전체 inventory metadata·authenticated dump와 GNU tar 원본 비교,
원본 재해시·닫힌 DB identity·repository fsync를 모두 통과한 뒤 immutable checkpoint를
발행한다. 영구 storage identity와 hot/cold selection을 내구성 있게 기록한 후에만 cache를
지운다. exit3/incomplete·unknown·권한/검증 실패는 삭제 근거가 아니다. credential이나 기존
repository가 사라져도 새 저장소나 키로 대체하지 않는다. quota·자동 forget/prune는 없다.
DB 본문과 비어 있지 않은 WAL/journal은 정확한 bytes로 결박한다. 읽기 전용 SQLite 조회가
만들 수 있는 0바이트 sidecar는 frame/rollback 데이터가 없으므로 부재와 같은 상태로 본다.

재개는 SQLite open/provision 전에 현재 DB bytes와 checkpoint/project binding을 비교하고
native 종료를 새로 확인한다. leased 임시 tree에서 restore --verify 후 전체 digest를 대조하고
fsync한 뒤 게시한다. 게시 중 종료되면 cold selection을 유지해 다시 복원하며, 기존 DB에
canonical repo와 checkpoint가 모두 없으면 새 history를 seed하지 않는다. 실패한 restore의
임시 사본은 남기고 같은 checkpoint의 새 복원이 성공한 후 lease가 해제된 사본만 회수한다.

저장소·password·캐시는 model mount 밖 Host 전용 경로에 둔다. 모든 Restic/검증 자식은 pinned
실행 FD, society fence, 프로젝트 mutex와 stage lease를 상속하며 실제 close까지 기다린다.
Restic Linux x64/arm64 0.19.1은 공식 release archive와 executable SHA-256을 고정하고 별도
setup 단계에서 설치한다. shutdown에서 다운로드하지 않는다. 도구 없는 hot 세션은 원본을
유지하고, cold 세션은 도구가 복구되기 전 시작하지 않는다. 실제 service/cgroup·Mac/VM 및
power-loss qualification은 local filesystem/fault 검증과 구별한다. 새/변경 코드는 NOT_REVIEWED다.

## DR49 — VM 폐기와 공통 native 실행부

2026-10-25 사용자 지시로 [native 전환 명세](macos-native-spec.md)의 구현을 채택한다.
문서 정리만 하던 이전 범위는 종료했다. VM 전용 구현·자산·진입점은 제거하고 Linux와
Darwin의 정책·실행 조정·인증 판정·저장 검증·복구는 공통 TypeScript owner를 사용한다.
OS 의존은 작은 syscall/sandbox/credential primitive에 한정한다. DR18/19의 VM 제품과
background/attach 제품 범위는 폐기한다. 과거 요구 ID와 실행 기록은 당시의 뜻을 유지한다.

이 결정은 G-PROCESS/G-FILES/G-AUTH의 통과 선언이 아니다. 실제 종료·파일 capability·
peer identity가 증명되지 않은 실행은 차단하며 VM이나 약한 대체 경로로 우회하지 않는다.
Mac Society가 차단돼도 공통 코드와 독립적인 구현·시험은 계속한다. 새 state root를 사용하고
기존 VM disk/state/archive·native history를 변환·삭제하지 않는다. 권한·accepted bytes·receipt·
Store gate·incarnation 의미를 보존한다. 구현과 실제 증거는
[전환 기록](implementation/native-transition.md)과 validation에 따로 기록한다.

DR49에서 제거한 소스를 가리키는 이전 결정의 두 링크는 제거 전 immutable commit
`adf20331`로 결박했다. 결정의 문장·ID·당시 의미와 과거 검토 원문은 유지한다.

## DR50 — 모듈 독립성의 보존과 필요한 workspace 추가

2026-10-26 사용자는 native 전환의 모듈 경계를 명확히 했다. 기존 25개는 고정 개수가
아니며, 기존 책임은 해당 모듈에서 수정하고 새 책임은 독립 workspace로 분리해 25 + α개로
유지한다. 공개 API·직접 의존성·runtime/type DAG·독립 build/test/설치를 지킨다. App은
조립을 맡고 하위 모듈의 App 역참조·private 접근·정책 중복으로 경계를 우회하지 않는다.

NATIVE-001/007의 25개·허용 목록 불변으로 읽히는 부분은 새 NATIVE-008로 대체한다.
검사 허용 목록만 넓혀 책임 침범을 감추는 것은 계속 금지한다. 새 모듈이나 정당한 공개
의존성을 설계할 수 없다는 제한은 두지 않는다. 기존 요구 ID·결정 원문·검토 기록은 보존하며
wire·DB·accepted plan·receipt·현재 권한·unknown의 의미는 바꾸지 않는다.

## DR51 — 직접 실행의 namespace witness와 복구 fence

DR49의 Linux 직접 실행은 명령을 재생하지 않는 실행 관측 journal을 사용한다. 단일
storage owner가 `S/execution/scopes.jsonl`에 version1 hash-chain frame을 append/fsync한다.
frame은 owner root, 순서, 이전 hash와 opening/witness/closed만 담는다. slot과 실행 UUID,
boot identity·namespace init의 host PID/start time·namespace inode만 기록하며 argv/env,
credential, accepted 작업·plan·receipt·desired 상태는 넣지 않는다. DB4와 plan2는 유지한다.

opening을 기록한 뒤 blocked namespace를 만들고, 실제 init을 pin한 witness를 flush한 뒤에만
gate를 연다. 부모 EOF는 허가가 아니므로 init이 gate writer를 보유한다. 종료 요청은 현재
owner가 가진 pidfd에만 보내고, init의 독립적인 kernel 종료 관측 후 closed를 기록한다.
재시작은 journal의 명령을 실행하거나 PID로 신호를 보내지 않는다. 기존 witness가 끝났는지
새로 관측하고, opening·부분 frame·관측 실패는 unknown fence로 남긴다. 최초 초기화는
호출자가 확인한 fresh/명시적 전환 경계에서만 허용하며 missing journal을 empty로 만들지 않는다.

이는 A-007/FS-002/FS-006의 실행 관측 저장 위치만 확장한다. 업무 entity·daemon·durable
task queue를 추가하지 않으며 과거 사실이나 현재 권한의 의미를 바꾸지 않는다. Darwin의
세 gate를 닫지 않는다. 공통 process owner·storage journal과 Linux native primitive를 분리한다.

## DR52 — native 실행 intent와 과거 unit 설치 intent를 구분한다

**관측.** native Resident가 기존 `agent.create.unitNames`를 새 실행 슬롯으로 해석하면,
동일한 accepted bytes가 systemd 설치 대신 다른 효과를 뜻하게 된다. 비동기 종료·시작은
대기 중 더 최신 lifecycle intent가 접수될 수도 있다.

**결정.** 새 plan envelope는 v3이며 새 create intent는 `execution: "native"`를 명시한다.
v2는 과거 사실의 읽기 형식으로만 유지한다. v2 create의 unitNames·terminal receipt는
수정하지 않고, 끝나지 않은 unit 설치 intent는 native 효과로 완료 처리하지 않는다.
새 v3 writer는 unitNames를 쓰지 않는다. DB 4·wire 1의 row·receipt 의미는 유지한다.
공통 실행 관측은 OS 이름 없는 scope identity를 사용하고, 직접 상속한 runner 채널의
권한과 수동 CLI의 process 관측을 구분한다. 비동기 준비 뒤 실행을 풀기 직전에 기존
feature owner의 현재 권한·desired·GOAL·incarnation을 다시 검사한다. 이전 incarnation의
stop과 더 최신 society intent에 의해 대체된 요청은 새 실행을 정지하거나 다시 열지 못한다.

**바꾸는 규범.** DB-009·CREATE·UNIT·AUTH·REC의 native profile, plan format registry.
기존 architecture 원문과 과거 검토·v2 bytes는 변경하지 않는다. 이 결정은 Darwin gate나
현재 source의 실행 qualification을 통과시킨다는 뜻이 아니다.

## DR53 — Resident 운영 로그의 공통 spool owner

**관측.** journald를 제거한 뒤 bounded stdout/stderr head만 남기면 전체 출력이 사라지고,
truncated preview를 전체 출력인 것처럼 읽게 된다.

**결정.** trusted runner의 두 스트림은 공통 process owner가 64 KiB 이하 chunk로 drain하고,
storage owner가 `S/logs/resident/<actor>/<시작-ms>-<invocation>.jsonl`에 version1 JSONL로
보관한다. 각 frame은 actor·invocation·현재 live lease의 incarnation(lease 전에는 null)·시각·
stream·원래 bytes의 base64를 가진다. 이는 운영 진단이며 transcript·provider credential·
실행/receipt 증거가 아니다. 모든 bytes를 spool하고, 읽기 응답은 기존 logBytes/frameBytes의
preview와 truncated를 유지한다. 정상 종료는 flush·close까지 owner가 맡으며 crash 뒤의
불완전한 마지막 frame은 불완전한 진단으로 표시한다. 손상/읽기 실패를 빈 로그로 답하지 않는다.
자동 만료나 용량 quota를 새로 만들지 않는다. 파일은 Human이 해당 Society의 진단을 명시적으로
정리할 때까지 보존하며 ledger·history·receipt와 독립이다. 실행 중 inode 교체·hardlink를 따라
기록하지 않는다. journald 명령은 native 기본 실행 의존에서 제거한다.

**바꾸는 규범.** FS-002 allowlist·VIEW 운영 로그·UNIT native profile. 저장 bytes의 존재가
실행 성공이나 임의 후손 종료를 증명하지 않으며 Darwin 파일 gate를 대신하지 않는다.

## DR54 — 재시작은 저장 PID가 아니라 새로 결박한 kernel scope capability를 종료한다

**관측.** 실제 Linux SIGKILL 시험에서 witness fsync 직후 gate가 닫힌 namespace init은
broker와 bubblewrap monitor가 죽어도 남았다. bubblewrap의 `--die-with-parent`만으로
pre-exec init까지 종료된다고 가정하면 안 된다. 읽기 전용 복구만으로는 이 실행을 정리할
수 없었다. `test/native-process-scope.test.mjs`의 after-witness 경계와 원시 재현을 보존한다.

**결정.** DR51의 관측 전용 복구를 다음으로 대체한다. 현재 Society tenure·single-writer·
execution journal의 배타 소유자는, 저장 witness와 fresh 관측이 일치할 때 OS primitive에서
새 namespace-init pin을 얻는다. 공통 TS owner가 그 pin의 boot·start·namespace 전체 identity를
저장 witness와 다시 비교한다. 모두 일치할 때만 새 pidfd capability로 종료를 요청한다.
저장된 숫자 PID로 signal하지 않는다. 불일치/관측 실패는 signal 권한이 아니며 재관측이
필요하다. 종료 요청 뒤 실제 namespace 전체 종료 관측을 기다리고, 그 전에는 closed 기록·
READY·workspace 재사용·archive/reclaim을 허용하지 않는다. 한 이전 실행의 실패가 다른
실행의 종료 시도까지 생략하게 만들지 않는다. 복구에는 argv·명령 재생·actor 권한 복원이 없다.

witness 없는 opening은 계속 unknown이다. 죽었다고 추정하거나 빈 초기 상태로 치환하지
않는다. 새로 얻은 pin과 복구 task도 resource owner/drain/grace의 대상이며, Store open 이전의
복구 중 중단도 같은 lifetime을 따른다. 성공적으로 완전히 drain된 owner는 새 실행을 영구히
막은 상태에서만 이미 확인한 종료를 유지해 archive의 후속 확인에 사용한다.

**바꾸는 규범.** NATIVE-011의 복구 집행, NATIVE-012. accepted plan·receipt·DB 형식은 바꾸지
않는다. Darwin에는 검증된 scope pin이 없으므로 이 결정으로 G-PROCESS를 통과시키지 않는다.

## DR55 — candidate의 최종 exec에 fresh authority와 private 상태 채널을 사용한다

**문제.** checkout 준비와 실제 check argv exec 사이에는 비동기 Git 작업이 있다. sandbox
진입 때 확인한 권한만으로 이후 exec를 허가하면 그 사이 stop·policy 변경을 놓친다. 또한
check가 제어하는 stderr marker는 trusted setup 거절의 증거가 될 수 없다.

**결정.** shared Git owner가 exact checkout·closed private setup protocol을 소유하고 Linux
adapter는 sandbox argv/FD grammar만 소유한다. trusted helper는 checkout 뒤 private 준비
frame을 보내고 별도 FD의 release byte를 기다린다. host는 현재 권한·취소 상태를 다시 보고
release한다. EOF·부분 frame·반복/순서 오류·거절은 실행 허가가 아니며 protocol은 poison된다.
상태 FD는 CLOEXEC, release FD는 exec 전에 닫는다. setup의 실패는 private 상태로만 분류하고
check stdout/stderr는 진단으로만 취급한다. 전체 scope 사망은 기존 execution owner가 확인한다.

**검증.** 실제 Linux candidate sandbox에서 두 번째 authority callback을 거절하여 check stdout이
발생하지 않고 scope가 완전히 끝나는 것을 확인했다. 별도 시험으로 exec 뒤 상태 FD EBADF와
stderr marker 위조의 CHECK_FAILED를 확인했다. G-PROCESS/G-FILES/G-AUTH 전체 통과는 아니다.

**바꾸는 규범.** INT-007의 setup 증거, NATIVE-017. accepted candidate/argv/env/receipt의 뜻을
바꾸지 않으며 과거 receipt를 현재 권한으로 다시 실행하지 않는다.

## DR56 — 폐기한 물리 reference와 현재 native 순서를 구분한다

DR49 전환 뒤 구현 계약의 unit/cgroup/renderer 문장과 generic helper의 VM 옵션이 남아 있었다.
역사 ID를 native 의미로 재사용하지 않고 NATIVE-018에 현재 물리 순서를 명시한다. 공통 logical
owner·accepted fact·현재 권한·unknown의 구분은 유지한다. AuthContext의 사용되지 않는 cgroup
필드는 제거하며, 인증은 native scope pin과 매 요청 재검사로만 판정한다. 기존 status wire의
unit 필드·no-unit 표기와 과거 version2 plan reader는 의미 보존용이며 실행 fallback이 아니다.

실제 socketpair에서 잘못된 UTF-8 byte가 대체 문자로 credential 응답에 수락되는 반례를 얻었다.
NATIVE-019는 standalone Keychain 채널을 get/put으로 닫고 공통 strict JSON/UTF-8 판정을 사용한다.
VM operation/event·선택적 strict/timeout 모드는 제거한다. native 통신 실패는 credential 부재나
평문 fallback 권한이 아니고, 채널 EOF는 helper 사망이 아니다. 실제 OS socket 시험은 별도이며
서명·access group·TCC 및 Darwin 세 gate를 통과시켰다는 뜻이 아니다.

## DR57 — status 관측 공유와 파생 게시의 소유권을 함께 결박한다

실제 CI에서 상태 조회 중 event-loop 지연이 기존 예산을 넘었다. 관측은 공유됐지만 각 mutation의
callback이 같은 status를 다시 fsync하고 있었다. 네 hint에 네 번 게시되는 반례를 보존했다.
기존 process CoalescedWake로 게시도 활성 하나·pending 하나로 모으고, 해당 Promise를 broker의
executingTasks에 등록해 Store close 전에 drain한다. admission 종료는 pending 게시를 취소한다.
NATIVE-020이 이 수명을 소유하며 지연 예산을 늘리거나 status 관측을 권한으로 바꾸지 않는다.

Native 시나리오의 새 peer는 실제로 기동하므로 pending 목록은 원본 불변식이 아니다. 시험은
peer의 실제 scope 종료와 초기 메일 정산을 기다리고, same-key 재시도의 accepted plan·메일 원본·
이미 완료된 delivery를 비교한다. provider 대본은 frozen initial message ID로 concurrent peer와
부모를 구분한다. 엔진 재시작도 running/EOF 대신 실제 child close를 기다린다. 이는 시험 수명의
수정이며, 임의 scope 사망·권한·기존 receipt 의미를 낮추거나 Darwin gate를 닫지 않는다.

## DR58 — 완료된 mutation 사이에 event loop turn을 반환한다

실제 CI stress에서 네 순차 mutation과 status 조회의 mixed lag가 기존100ms 예산을 넘었다.
로컬 실제 Store/view 계측에서는 다수의 동기 transaction과 view 게시가 확인됐고, 완료 Promise의
연속 continuation은 별도 I/O 대기가 없는 다음 요청을 바로 시작할 수 있다. public dispatcher는
효과와 view 갱신이 끝난 뒤 reply 전에 공통 Node event-loop turn을 반환한다(NATIVE-021).
업무 queue·별도 scheduler·OS별 정책을 추가하지 않으며 latency 예산을 늘리지 않는다.

turn 반환은 transaction 바깥이고 추가 효과도 아니다. 대기 사이의 admission 종료로 과거
accepted plan/result/receipt를 바꾸지 않는다. 기존 owner가 긴 준비 후/효과 직전에 하는 권한
검사를 제거하지 않는다. 단일 host I/O 지연까지 없어졌다고 주장하지 않으며 실제 stress와
전체 suite 결과를 별도로 확인한다.

## DR59 — VM의 표시·handoff 정책을 제거하고 native 실행 identity를 명시한다

DR18 D-1의 guest 표시 정책은 native 실행에 적용하지 않는다. 현재 예외 문구는
`packages/domain/src/errors.ts#exceptionText`가 읽고 CLI 실패는 stderr로 보낸다. Linux 경로와
errno를 숨기는 codec·환경변수·로그 중복 방지 bound와 관련 export를 삭제한다. 터미널의
제어문자 제거·폭 처리는 그대로 사용한다. Society history는 birth·binding·engine cwd로만
판정하며 미해결 Darwin product gate는 별도로 유지한다(NATIVE-022).

미사용 InferenceRelay.detached/accept, VM Society 선택과 패키지 세대 수집·reader lease,
옛 egress.connect 전용 grammar를 제거한다. 일반 로컬 패키지 resource 경계와 index schema,
`OMA_PACKAGE_STORE`의 현재 tool-file 경계 용도는 유지한다. 기존 VM 데이터는 수집·변환하지 않는다.

native execution owner의 UUID는 runner의 `--execution`으로 전달하고 entry가 검증한32자리
hex를 RunnerModule에 주입한다(NATIVE-023). broker는 기존 wire invocationId와 현재 pinned
scope를 계속 대조한다. 과거 accepted identity·plan·receipt는 새 값으로 다시 만들지 않는다.

검증 상태: 전체 production source를 읽은 뒤 구현했으며 runtime 회귀는 아직 실행하지 않았다.
최신 사용자 지시에 따라 실제 macOS 테스트/CI는 우선 제외하고 구현·source 대조·타입/정적
검사를 진행한다. 이것으로 Darwin 세 gate나 최종 지원이 검증됐다고 표시하지 않는다.


## DR60 — HostConfig 4에서 Linux 실행 배치를 공통 설정과 분리한다

macOS native 명세 §11을 구현한다. 현재 설정 형식은 HostConfig 4이며 `installation`은 Node·
설치 code·deployment digest와 선택적인 package store만 담는다. Linux rootfs·system mounts·
OS backend를 설정하거나 이전 형식을 optional 필드로 수용하지 않는다. 이전 설정은 새 개발
state를 요구하며 파일·managed history·accepted plan/receipt/DB bytes를 자동 변환하지 않는다.
DB 4·plan v3와 역사적 v2 읽기·managed journal committed-v2는 이 변경에서 바꾸지 않는다.

공통 SandboxHost/RunnerConfinement/GitPaths에서도 Linux rootfs와 system mount 필드를 제거한다.
Linux 어댑터가 trusted state root 아래 rootfs를 선택하고 별도 OS mount 입력을 검증한다. public
system mount가 private state를 노출하면 거절한다. Linux executable/filter와 mount 상수는 Linux
모듈이 소유한다. 공통 설치 surface의 read-only 관측은 shared storage에 둔다. Darwin은 Linux
skeleton을 생성하지 않고 native product/scope/file/auth guard는 유지한다.

Dashboard는 confinement이 필수인 정책을 표시하며 설치 경로나 실제 실행 성공을 만들어내지
않는다. 원래 confinement·credential·authority·전체 scope 종료 계약과 불명 상태의 거절은 유지한다.
실제 Mac 시험/지원은 이 설정 전환이나 Linux 시험만으로 완료 처리하지 않는다.

## DR61 — native 전환은 제품 보장과 구현 후보를 분리한다

2026-10-28 사용자는 명세 전면 개정과 구현 재개를 요청했다. 긴 지시 반복 대신 다음 구현자가
목표·결정·미결정 후보·근거·다음 검증을 찾을 수 있도록 native 명세를 다시 구성한다. 미검증
launchd/audit-session을 확정 backend로 전제하지 않는다. 유사 제품의 실제 구현을 우선 비교하고,
결정적인 반례를 실환경에서 확인한 뒤 caller와 durable 형식을 연결한다. 동일 실패의 반복 조사나
Linux API의 기계적 복제가 구현의 목표가 아니다.

파일 정책은 기존 TS owner에 유지하되, 각 caller에 필요한 capability를 구분한다. permission-
independent pin이 없는 OS에서 pathname repair로 흉내 내지 않고 unknown을 보존한다. tool-files는
Node-only라는 구현 제한 대신 좁은 native file leaf 또는 주입 port를 허용한다. NATIVE-024/025가
관련 선행 가정·모듈 제한을 대체하며, 전체 후손 종료·현재 권한·accepted bytes·archive quiescence
보장은 완화하지 않는다. privileged 서비스·entitlement·OS 하한 변경·기능 축소는 별도 결정이다.

명세와 인계의 개정 전 bytes는 docs/archive에 보존한다. 채택 결정·소스 조사·실제 실행 proof는
서로 다르며, 이 문서 개정은 Darwin 지원 완료나 과거 검증의 재승인이 아니다.

## DR62 — 파일 도구의 native 의존성은 독립 descriptor leaf로 제한한다

DR61의 후보였던 `@oma/native/files`·`posix-files`는 domain·metadata/helper까지 평가한다.
두 import만 허용해도 실제 runtime closure가 작아지는 것은 아니다. bootstrap port 주입과
독립 leaf 분리를 비교해, 모든 engine/search process의 조립 상태에 의존하지 않는
`@oma/file-descriptors`를 채택한다. Node built-in과 Koffi만 사용하며 OMA 업무 모듈에는 의존하지 않는다.

기존 mkdirat/unlinkat/directory cursor 구현을 옮기고 모든 caller를 이관한다. 원래 native export나
복제 구현은 남기지 않는다. tool-files의 private adapter만 이 leaf를 참조하며, extension 검사는
그 아래의 relative import/re-export closure까지 추적한다. 우회 import·다른 native API·숨은 의존성을
negative control과 독립 설치로 확인한다. NATIVE-026이 NATIVE-025의 구체 leaf 선택을 대체한다.

OS filename decoder도 domain을 import할 수 없으므로 같은 strict/BOM-preserving 계약을 직접
집행한다. 선두 U+FEFF filename 손실을 실제 directory cursor 회귀로 재현했고, fatal·ignoreBOM
두 옵션을 정적 경계와 실제 filename 관측으로 결박한다. 파일 정책·snapshot 정리는 TS owner에
유지하며, 이 분리는 permission-independent pin·exact exec·Darwin 전체 qualification의 증거가 아니다.

## DR63 — status는 일관된 raw snapshot을 비동기로 검증하고 게시만 동기화한다

WP23.03의 전체 결과·full-row/lineage 검증과 DR57의 단일 게시 owner는 유지한다.
동기 조회/디코딩이 한 event-loop turn에 누적되므로, display read의 모든 SELECT 결과를
첫 await 전에 취득한 뒤32행 단위로 검증하며 turn을 반환한다. yield 사이의 mutation을
다시 조회해 이전 delivery와 새 batch를 섞지 않는다. mutation/recovery의 동기 read·transaction은
바꾸지 않고 행 수 제한이나 부분 count도 도입하지 않는다.

`ViewsModule.status/statusOf`와 `PublicViewsPort.status`는 Promise를 반환하고 같은 unit
snapshot의 projection은 공유한다. Broker가 projection을 await한 다음 draining을 재검사하고
완성된 행을 동기 `publishStatus`에 전달한다. 이 owner를 drain한 뒤 Store를 닫으므로 중단 후
상태 파일을 되살리지 않는다. public status 응답도 await 뒤 기존 검증 owner로 현재 권한을
재검사한다. wire/DTO·durable 형식·latency budget은 그대로이며 native golden은 관련 두 port만 갱신한다.

