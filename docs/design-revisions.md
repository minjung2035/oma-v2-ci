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

Enforcement: (1) the primitive set in `src/storage/directory.ts` +
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

The whole-tree enumeration carries its own named bound:
`GITLINKS_OBSERVATION_BYTES` (256 MiB) in the canonical command adapter. A
sha256 `ls-tree -z` record costs ~80 bytes plus its path, so the bound admits
roughly a million leaf entries even at ~180 bytes of average path. Under the
shared 4 MiB process bound a ~70k-entry tree overran the capture, which the
observation honestly reports as unknown — but unknown at every gate is a
permanent integration wedge even when the tree holds zero gitlinks, a scaling
limit this gate itself introduced. Over the bound the answer is still
output-limited → unknown, never a truncated "no gitlinks". Filtering inside
the spawned pipeline was rejected: the canonical runner is a single pinned
executable plus argv — there is no shell to pipe `ls-tree` through — and
`ls-tree` has no mode filter of its own. Shrinking each record via `--format`
was rejected because it would strip the mode/type/oid grammar the parser
validates. The marker protocol also tightened: `OMA_ERROR=UNSUPPORTED_PROFILE`
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
