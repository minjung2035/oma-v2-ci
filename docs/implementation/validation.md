# OMA v2 — 현재 검증 상태

현재 활성 작업은 DR49 native 구현이다. 이전 문서 정리 범위는 사용자 구현 지시로 대체됐다.
아래 DR48·문서 정리 결과는 각 당시 입력의 기록이며 현재 source의 전체 PASS가 아니다.

## DR49 native 전환 — 진행 중 (2026-10-25)

작업 브랜치는 `work/macos-native-20261025`이며 master 병합·배포는 하지 않았다.
현재 G-PROCESS/G-FILES/G-AUTH는 OPEN이고 Mac 제품 진입은 효과 전에 거절한다.
이 거절 시험이나 부분 primitive 성공을 native Society 지원으로 표시하지 않는다.

2026-10-27 재개: 필수 문서·machine map과 자체 작성 production523개를 전체 읽은 뒤 DR59의
잔존 VM 정책/API를 제거했다. 수정 후 workspace26개와 root strict typecheck가 통과했다.
Mac 인증의 새 Mach audit 수신·단일 process event·public Security audit-token 대조 leaf 및
OS identity adapter도26개 workspace/root typecheck를 통과했다. 실제 Darwin 실행은 **NOT_RUN**이다.
첫 정적 검사에서 제거한 package collector를 가리키던 durable map 한 건을 찾아 제거했고,
durable map·문서·규범 fingerprint 검사는 통과했다. 마지막 source의 전체 정적 재검사는 별도다.
과거 authored review는 보존하고 변경 bytes의 review ledger는 NOT_REVIEWED로 무효화했다.
당시에는 테스트를 제외한 구현 견적 질문을 구현 우선 순서로 해석해 runtime·packed install·CI를
보류했다. 이는 최종 목표의 실제 검증 요구를 없애지 않으며, 이후 실행은 입력별 증거로 구분한다.
이 checkpoint 당시 primitive·identity adapter는 production broker transport에 미연결이었다.
후속 source 조립 상태는 아래 기록을 따르며 세 gate는 계속 OPEN이다.

후속으로 Broker의 Linux native credential 타입·listener 생성·endpoint 길이 검사를 OS port로
분리했다. common reference/authority owner를 유지하고 BSM by-value accessor로 opaque token을
해석한다. bind 뒤 preparation 실패·불명 close 수명과 Mach body 정렬/oversized queue도 source에서
수정했다. 26개 workspace와 root strict 검사는 통과했으며, 이 후속 입력의 전체 구조 검사는
`/tmp/oma-native-resume-20261026/transport-static-*`의 입력 전후 identity와 단계별 원시 로그로
구분한다. 새 listener 회귀와 변경 Linux sender/새 Mac FFI 실행은 **NOT_RUN**이다.

후속 Mach connector는 App Client/Broker의 OS 선택에 source로 연결했다. common PacketStream,
인증 EOF, byte length/padding, dial readiness generation과 native port return 상태를 구현했다.
현재 native consumer interface golden만 의도한 세 interface 추가/두 port 변경으로 갱신했으며
public/durable DTO·과거 golden은 그대로다. 타입 검사 중 새 unit fixture의 literal 타입 오류를
수정했고 후속 전체 workspace/root 검사는 통과했다. 새 shared-flow와 실제 Darwin 실행 결과는
아직 이 기록에서 PASS로 주장하지 않는다. 세 gate와 product profile 차단은 유지한다.

| 실제 입력·실행 | 결과와 범위 |
|---|---|
| 공통 PathView·논리 inbox 후속 | 같은 root/endpoint 표의 mounted/host layout으로 Pi argv/env·relay·entry·session 역변환을 연결. caller dirs 변경 반례를 snapshot으로 거절하고 exact /inbox.md를 검증된 hashline read의 public prepareArguments에 전달해 anchors·offset/limit을 유지. public/durable/receipt와 vendor bytes는 바꾸지 않고 native golden에 transient interface2개만 추가(기존 fingerprint 전부 동일). 정책/실제 일반 read **29/29 PASS**·skip/cancel/todo0·strict types PASS이며 실제 Mac kernel proof가 아님. raw native-2026-10-27-path-view와 source별 후속 실행 기록을 따름. 입력 `e55935e4e63868bba3922a30ad68ea3f16eb59019327a7b9ab20049d8026557c`(15619개) 전후 및 보호4개 SHA 동일에서 실제 UID1000/CapEff0·pinned bwrap0.12/private /dev의 관련 Linux **70/70**, 별도 contract mutation **7/7 PASS**·모두 fail/cancel/skip/todo0. full build와 전체 구조 검사도 통과. 실제 kernel scope8개를 포함하며 전체 Linux 회귀/Mac 지원 결과는 아님. 초기 assertion 문구와 TS fixture 직접 실행 오류, extension 직접 execute 위임을 거절한 구조 finding을 raw에 보존하고 최종은 Pi public prepareArguments를 사용. PathView 내부와 spawn→session return의 변동2개 반례도 실패시킨 뒤 고정 문자열 view로 수리했으며 grant/peer/scope는 cache하지 않음. 최종 결과 문서 입력과 purpose별 조립·actual Mac 검증은 별도 |
| 후속 Mac flag·공통 ancestry 수리 | XNU가 거절하는 NOFOLLOW_ANY+NOFOLLOW 조합을 native leaf에서 제거하되 ANY/BENEATH/CLOEXEC를 유지. 정상 open·중간/최종 symlink 거절의 실제 kernel 회귀를 추가하고 platform lane의 필수 이름으로 결박함. 공통 ancestry의 변동 관측4개 반례는 수정 전5/9 PASS·4 FAIL, 같은 시험 파일 SHA `6d7b7d45...`로 수정 뒤 관련 **51/51 PASS**·fail/cancel/skip/todo0. 실제 Linux file/process 관측과 supplied-reader TS 정책 증거이며 Darwin raw-EINVAL branch/세 gate는 NOT_RUN·OPEN. 첫 full build는 분리 작업트리의 외부 third-party symlink를 설치 경계 검사에서 거절했으며 raw를 보존했다. 기존 의존성 view를 보존하고 locked npm ci를 실제 독립 설치한 뒤 full build PASS. `/home/dev/oma-audit-artifacts/native-2026-10-27-nofollow/`가 원문·실패·수정 source/test SHA·build/선택 결과를 소유하며 전체 후속 회귀는 별도 |
| 후속 SnapshotReader·Darwin metadata·Seatbelt 구현 | SnapshotReader의 O_SYMLINK+O_NOFOLLOW 충돌을 제거하고 전체 parent를 openBeneath로 해석. statAt은 Darwin64 fstatat/AT_SYMLINK_NOFOLLOW·numeric/BigInt/ns와 최초 실제 Node layout 대조, 실제 SDK scalar/offset assert를 구현. Seatbelt는 TS deny-default renderer·환경 검사·정확한 IPC 허용·private pipe와 최소 public sandbox_init/execve C launcher를 구현하고 Darwin workspace build와 실제 driver의6개 추가 case에 연결했다. 실제 Mac 총42개 시도는 NOT_RUN이며 목적별 PathView·scope·pin/exact reopen/실행 결박·인증 qualification과 제품 guard는 별도다. input `1b53992cf75eaa4cd40394f032babb8c729dd816f23a41bc6989b59a8b7c0669`(15617개) 전후 동일에서 full build·전체 architecture/transaction/durable/document/spec PASS와 관련 **95/95 PASS**·fail/cancel/skip/todo0. root types도 후속 구조 입력에서 확인한다. 새 generated helper의 엄격한 asset owner와 source 존재를 검사하며 처음 asset/path/무fence spawn 거절도 보존. platform은 직접 spawn하지 않고 framed recipe를 반환해 기존 process owner를 사용하며 fence exemption을 추가하지 않았다. nofollow audit root의 `recipe-final-{build,architecture,smoke}.log`·`recipe-final-summary.json`이 원본을 소유. 이후 결과 문서 입력과 actual Darwin qualification은 별도이며 이전51/51을 새 source 증거로 재사용하지 않는다 |
| `29938a42` 최신 source 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정 installed-runtime smoke **16/16 PASS**·자체 declaration 오류0. 외부 SDK declaration 진단44개는 별도 분류하며 workspace별 반복을 합산한 새 오류 수로 표시하지 않음. exit0·263.254초·input `ae96e9f67c48f58c95020eaa7beb989ef467baaed258f4e43b24bb8770f84ba9`(15613개) 및 보호 README/architecture/과거 review/golden SHA 전후 동일. 현재 사용자 README가 포함된 입력이며 clean commit의 구조 binding과 구분. `/home/dev/oma-audit-artifacts/native-2026-10-27-qualification/packed-20261026T210501Z/`가 실제 명령·source HEAD·원시 출력·종료·workspace별 합계를 소유. 이후 결과 문서 입력과 실제 Darwin qualification은 별도 |
| `29938a42` 실제 CI와 완료 대조 | Native40400373660·Architecture40400373613의7개 job 모두 terminal failure·steps/logs null·artifact 없음. check-run output의 title/summary/text도 null이고 annotation 본문은 연결 도구가 제공하지 않아 원인은 미확정. 실제 Darwin36개 case는 NOT_RUN. P0–P7와 §13.2의7개 최종 조건을 다시 대조했으며 Darwin scope·pin/exact reopen·실행 대상 결박과 실제 인증/격리/수명 qualification이 미완료다. Linux/설치 통과를 전체 완료로 승격하지 않는다. native spec §14.14와 qualification root의 `p0-p7-audit-29938a42.json`, async audit root의 `ci-29938a42.json`·`ci-29938a42-check-runs-20261027.json`이 범위를 소유 |
| `bd2049c8` 수리 후 전체 Linux 회귀 | **3787/3787 PASS**(serial13/13, parallel3774/3774), fail/cancel/skip/todo0·exit0·973.149초. 실제 UID1000·CapEff0·Node26·pinned bwrap0.12의 private /dev와 /usr/bin overlay에서457개 file·parallel concurrency4·native execution 필수6개를 포함했다. input `9241f47e6aae491e07541aafba2995bf016a8a5b6a5256f1addfef83b2cdd8b9`(15612개)와 보호 README/architecture/과거 review/golden SHA가 전후 동일하며 관측 중 수동 개입은 없었다. 이는 이후 P7 문서-closure 변경 전의 실제 Linux 결과이며 actual Mac/CI 지원 증거가 아님. async audit root의 `full-linux-dev-20261026T203916Z/`가 명령·profile·상태·원시 로그·phase별 실제 합계를 소유 |
| `bd2049c8` 실제 CI | Native40397569660·Architecture40397569605의7개 job 모두 terminal failure·steps/logs null·artifact 없음. 실제36개 Darwin case는 NOT_RUN이고 원인은 미확정이다. async audit root의 `ci-bd2049c8.json`·`ci-bd2049c8-artifacts.json`이 원본을 소유하며 같은 입력의 무의미한 재실행으로 덮지 않음 |
| P7 후속 정적/문서 검사 | 분리 작업트리의 input `950cf5e29804acfc02dc7ef66f7bdd4fcf3fb425f520f2bbc01ed27597de9f06`(15613개) 전후 동일에서 전체 architecture/transaction/durable/document/spec PASS·문서/입력/workflow **32/32 PASS**·fail/cancel/skip/todo0. 첫 architecture 실행은 공유 node_modules 링크가 @oma를 원래 작업트리 밖으로 해석해51개 finding으로 실패했으며 raw를 보존했다.26개 workspace를 실제 분리 작업트리로 연결하고 같은 compiled output을 복사한 뒤 같은 입력의 architecture를 다시 통과했다. gate 규칙은 바꾸지 않았고 production source 변경도 없다. raw `document-closure-static-*`, `document-closure-architecture-*`, `closure-worktree-dependencies.json` |
| P7 문서 입력 누락 수리 | 문서 gate가 실제 읽는 루트 README와 목록 밖 신규 Markdown이 기존 digest에 없었다. 별도 fixture에서 README의 깨진 링크/새 문서의 배치 오류가 결과를 바꿔도 identity가 같았고, 새 반례2개가 수정 전 모두 FAIL했다. README를 필수 입력으로 추가하고 문서 gate의 discovery owner가 발견하는 현재 Markdown도 같은 source/symlink 검사로 결박한다. 반례 본문은 전후 동일하며, 분리 작업트리의 input `9774a54ce1ebd3feab7fed66656dcdb70865b3a1d294966b83999ca107b361c4`(15613개) 전후 동일·문서/입력 목록 **17/17 PASS**·fail/cancel/skip/todo0. 이전15612개 결과의 누락은 보호 README의 별도 SHA 증거로만 한정하며 완전한 입력 closure였다고 승격하지 않음. raw `document-closure-{red,green}-*`와 `readme-closure-red.json`은 async audit root가 소유. commit의 README와 최초 사용자 변경 README는 서로 다른 실제 입력이며, 전자를 쓰는 CI binding과 후자의 로컬 재생성 binding을 섞지 않음 |
| `c2745daa` 전체 Linux 회귀의 실패 보존 | 전체 **3772/3784 PASS·12 FAIL**(serial13/13, parallel3759/3771), fail12·cancel/skip/todo0·exit1. input `ee6bdd0688e7a7a33d81bb9d8e270adcb657a181927eebe93316e806c46459ac`(15612개)와 보호 파일 SHA는 전후 동일. 마지막 peer-pid 시험의 uncaught `this.pinPeer is not a function` 뒤 정리가 열린 socket을 기다려, 나머지 file 완료를 확인하고 해당 소유 test PID만 SIGTERM했다. 원래 오류와 개입을 `peer-pid-cleanup-intervention.json`에 보존하며 정상 완료/PASS로 계산하지 않음. 첫 outer bwrap의 /dev/null EACCES는 시험 시작 전 SETUP_FAILED/NOT_RUN으로 별도 보존. private /dev와 /usr/bin overlay 수정 후 실제 UID1000·CapEff0·bwrap0.12/Node26에서 실행. raw 소유자는 async audit root의 `full-linux-dev-20261026T193211Z/` |
| 위12건의 수정 후 선택 회귀 | UUID/실제 pin·endpoint 주입 fixture를 연결하고 find 완료 경로가 실제 `fdfind`도 사용하도록 수정. 원래 기대값을 유지하고 **26/26 +55/55 PASS**, input `970ceccf70ba1d2eeaa79d0574d0b69db8be7f260032b26f4db9b0b83e3576a7` 전후 동일·skip/cancel/todo0. source HEAD 전의 실제 private fdfind-only probe는 ENOENT, 수정 후1100/1100 경로 반환. 이후 find0/grep fractional-limit 반례2개를 추가해 수정 전29/31 PASS·2 FAIL, 수정 뒤 **31/31 PASS**·input `652fc93dd8586a1a9d67fa0db33164394c70cb6efe0c33e12f27fcc64559644c` 전후 동일·skip/cancel/todo0. 이는 서로 다른 선택 입력이며 전체 후속 PASS가 아님. 원시 로그/실패/SDK source SHA/probe는 async audit root의 `full-repair-focused-*`, `fd-alias-probe-*`, `search-limits-{red,green}-*` |
| `c2745daa` 비동기 audit 후속 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정된 installed-runtime smoke PASS. exit0·279.368초·input `f353d0157c995f17ace4ff1108308989df94fc3709c76efa73dae52ccededef0`(15612개) 전후 동일. 외부 SDK declaration 진단44개는 별도 분류. async audit root의 `packed-20261026T191736Z/`가 source HEAD·실제 명령·로그·종료·identity 소유. native callback/CF 실제 Darwin 실행 증거는 아님 |
| `c2745daa` 새 CI | 작업 브랜치 push 성공. Native40385385778·Architecture40385385695의7개 job 모두 스텝 없이 failure. 마지막 queued Mac15 job도 같은 handle로 재조회해 terminal을 확인했으며 steps/artifact 없음. 실제 Darwin36개 C/Node case는 **NOT_RUN**. annotation 본문은 connector 지원 범위 밖이며 근본 원인은 미확정이다. async audit root의 `ci-c2745daa.json`에 초기/최종 원본 응답을 보존함 |
| 비동기 audit/stream 반환 source 연결 후 | 고정 input `f6eaeca119f2e2df41c40fcc91122b1b14862cb1e8bd94e7e8d7d0269851b148`(15612개) 전후 동일. build·26 workspace/root strict·전체 architecture/transaction/durable/document/spec 검사 PASS. 관련 shared-flow/lifetime **52/52**, generation **9/9**, native consumer-port mutation **7/7 PASS**·fail/cancel/skip/todo0. 새 비동기 PacketStream4개 회귀는 수정 전 모두 FAIL·기존4개 PASS, 수정 뒤8/8. 원시 실패·수리 로그/상태는 `/home/dev/oma-audit-artifacts/native-2026-10-27-async-audit/` 소유. actual Darwin Security/Mach 실행과 WP23·expected Broker identity·세 gate proof가 아님. 이후 결과 문서는 별도 입력 |
| `7ebb7268` 현재 독립 설치 | **26/26 packed install·공개 API import·자체 declaration PASS**, 지정된 installed-runtime smoke PASS. exit0·271.606초·input `2e277fbabcb6bf967ce59d99ba0a42184783ec4c337f24625e67589a1625454b`(15612개) 전후 동일. 외부 SDK declaration 진단44개는 원시 로그에 별도 분류하며 자체 오류로 숨기지 않음. 새 audit root의 `packed-install-20261026T184226Z/`가 실제 명령·로그·종료·identity 소유자이며 실제 Darwin qualification이 아님 |
| `7ebb7268` 새 CI 시작 실패 | 작업 브랜치 push 성공. Native40380089004·Architecture40380089190의7개 job 모두4–5초 뒤 스텝 없이 failure. job steps/실행 로그/artifact 없음. check annotation1/2건은 있으나 본문 URL이 connector allowlist400으로 거절됨. 근본 원인 미확정이며 SDK·코드 실패로 추정하지 않음. 새 Node adapter3개 case와 C probe의 이 입력 실행은 **NOT_RUN**. 새 audit root의 `ci-7ebb7268.json`이 원본 응답을 보존함 |
| Mach connector·실제 Darwin Node probe 연결 후 정적/공통 검사 | build·26 workspace/root strict typecheck·전체 architecture/transaction/durable/document/spec 검사 PASS. CI 공통 목록15개 파일 **81/81**, channel generation **9/9 PASS**·fail/skip/cancel/todo0. 각 input `7736cda4f8f874ac9b48ca6b0c8cc1e54c82b0feb359f895e035d758961eb441`(15612개) 전후 동일. 원시 명령/로그/종료 상태는 새 audit root의 `mach-ci-checks-20261026T183534Z/`. 이후 Node fixture의 관측/cleanup deadline과 job ceiling 및 결과 문서는 별도 입력이며 재결박으로 이 PASS를 갱신하지 않음. 실제 Mac Node 세 경우는 CI 실행 전 NOT_RUN이며 세 gate는 OPEN |
| Mach source 연결 뒤 shared/Linux 선택 회귀 | 공통 packet/listener/generation·실제 Linux recvmsg/descriptor 인계 **21/21**, 변경 error/history/package/runner API **41/41**, native consumer-port positive/negative mutation **7/7 PASS**. 각 실행 input `f86efa4eb30d1ebd8af2bd11a59982b73833b0efa87725b25329531d721ddb8f`(15611개) 전후 동일, fail/cancel/skip/todo0. 서로 다른 세 선택 실행이며 전체 suite나 Mac qualification이 아님. 격리 시험은 pinned bwrap0.12.0을 임시 /usr/bin overlay에서 실행했고 UID1000·CapEff0·binary SHA를 보존했다. host /usr/bin은 변경하지 않았다. 원시 로그/상태/단계 명령/전후 identity와 SHA는 `/home/dev/oma-audit-artifacts/native-2026-10-27-mach-connector/`가 소유함 |
| 위 후속의 최초 실패 보존 | 첫 선택 실행 **20/21 PASS·1 FAIL**: missing-directory bind의 ENOENT 기대에 실제 EACCES가 반환됨. 실제 점유된 주소의 EADDRINUSE 및 기존 listener 보존으로 강화 후21/21 확인. 별도 첫 확대 실행 **37/38 PASS·1 FAIL**은 원본 TS를 잘못 실행해 compiled fixture를 찾지 못한 명령 오류. 올바른 compiled JS와 실제 bwrap view에서41/41 확인. 최초 로그도 같은 새 audit root에 보존하며 지우거나 전체 PASS로 덮지 않음 |
| START/public-validation fixture 수정 후 관련 회귀 | **33/33 PASS**, skip/cancel/todo0·18.495초·input `ce9b96e02382976921f01f69b0ae67fe4c1471efd9c3dbba6d37fd4b65fdfd56` 전후 동일. `native-reference-fixtures-focused*`. 실제 Node timer를 사용하며 기존 latency budget과 accepted fact 판정 유지. 첫 전체17 FAIL을 전체 PASS로 대체하지 않음 |
| 외부 구현 대조·reply turn 후속 첫 전체 local | **3762/3779 PASS·17 FAIL**, skip/cancel/todo0·940.027초·input `bc7e189f79ebed11044bd9697a3ed987bbb9904781b93b083585e00a78b02a18` 전후 동일. `native-reference-yield-whole*`. 실패는 START의 옛 host/guest 기대값1건과 public-validation fixture의 새 Node timer import 미연결16건. 문구를 정확히 갱신하고 실제 timer module을 fixture에 연결한 후 정책16/16 PASS·skip0. 전체 재실행 결과와 구분 |
| `5e369b30` 전체 Architecture CI40316751983 | baseline/native-all 모두 **3777/3777 PASS**, skip/cancel/todo0. baseline fast795/795·durable871/871·property34/34·stress13/13·platform29/29 PASS. standalone kernel/crash wrapper는 NOT_RUN이며 native-all의 실제 파일/필수 이름으로 실행. ZIP `12649820624` SHA256 `2a225f1a198ad8e1eb9d389bf93abb0d517c859885f75cd0edbe27cfaa4a9113`, native-all `12648632520` SHA256 `bced406a8587ffe6f8cca335edde624d0ab216128bfdb0d425adbbe85476116c`; source/input 별도 검증. 이후 변경의 결과가 아님 |
| 앞선 전체 CI의 실패 보존 | `e997fe37` baseline3777/3777 PASS, native-all3776/3777·mkdirAt EAGAIN1. `e37ad5e0` 전체3777/3777 및 native-all3777/3777 PASS, stress12/13·mixed lag100ms 실패. raw SHA 확인 후 각 ci 폴더에 보존. 후속 성공으로 실패를 덮지 않음. 실제 mkdirat/owned mkdirAt 각각20만 회·자식25개는 EEXIST만 관측했고 EAGAIN 원인은 미확정 |
| mutation reply turn 회귀 | 새2개는 수정 전2 FAIL, 기존6개 PASS. 공통 PublicDispatcher에서 효과/view 갱신 뒤 turn을 반환한 뒤 **8/8 PASS**, skip/cancel/todo0·16.814초·input `4596344b5a0f10da87f296a04dd9911db91841705c9eddf82ddcb6821e41656d` 전후 동일. admission 철회 뒤 accepted plan/result 보존 포함, 기존50/100ms 지연 기준 유지. `native-dispatch-yield-{before,after}-fix*`; 전체 후속 검증과 별도 |
| `9116bb6b` 새 CI 시작 실패 | Native40318575316/Architecture40318575321의 모든 job은 스텝·실행 로그 없이 시작 전에 failure. 새 Mac self/등록 포트 후보는 **NOT_RUN**이며 compiler/runtime 결과가 아니다. annotation 상세는 현재 조회 도구에서 미확인. 이후 외부 구현 대조와 Chromium rendezvous 후보 반영도 실제 Mac 재실행 전 |
| `e997fe37` 실제 Mac26/15 Mach 후보 SDK 실패 | 기존15개 관측은 각각 OBSERVED. 새 후보는 deprecated mach_port_destroy에 -Werror compile 실패,6개 case 미실행/SETUP_FAILED. 원시 ZIP2개 SHA256/source 확인·`ci-e997fe37/` 보존. 경고 억제 없이 send/receive 권리별 반환으로 수정 후 실제 CI 재실행 필요. 세 gate OPEN이며 전체 workflow PASS가 아님 |
| status owner·Darwin 후보 추가 뒤 독립 설치/정적 | **26/26 packed install/public API/authored declaration/해당 installed runtime PASS**,269.430초. input `a3b7fb252b39a2ca6a6fafb1d587c4bfb58785c9e9b7b601950ee0ce20ed8c0b` 전후 동일. 전체 정적 gate41.075초·정책7/7·inventory18/18 PASS. 외부 SDK declaration44개는 별도이며 authored 오류0. `native-status-mach-*`. 이후 유지보수/결과 문서는 별도 입력이고 실제 Darwin C 실행은 아직 NOT_RUN |
| status owner 후속 Linux 선택46개 파일 | **430/430 PASS**, fail/skip/cancel/todo0·466.084초·input `66ab51c0afa08c39760f8c1e27837113c230e0625564eca6635084724b2d3896` 전후 동일. `native-status-owner-integration*`. read20/mixed39/pending620 lag19ms, 기존 budget50/100/50ms 유지. 같은 입력 전체 정적 gate·정책7/7 PASS. 이후 운영 문서·Darwin 후보 추가는 이 실행의 입력이 아니며 전체/CI 결과로 승격하지 않음 |
| `db68c111` 최신 전체 local | **3773/3775 PASS·2 FAIL**, skip/cancel/todo0·894.612초·input `ec7ee8fc1481ed838594ebe5d4cdf40639d421681b166c671d39b78baf4292bf` 전후 동일. `native-whole-db68c111*`. prompt의 host/guest 기대값과 cgroup 제거의 새 native golden hash가 실패했고 정확한 기대값으로 수정 후 부분 재검증 PASS. production이나 과거 golden을 되돌리지 않음 |
| `db68c111` 실제 Native CI40284241937 | Linux/Mac15/Mac26 공통각 **74/74**, Linux peer3/3·native37/37·선택386/386 PASS·skip/cancel/todo0. input ec7ee8fc… 전후 동일. raw zip5개 SHA/source/input 검증, `ci-db68c111/verified-summary.json`. 양 Darwin SDK compile0·각15개 실제 관측·세 gate OPEN/BLOCKED. peer token도 읽기 전후 동일32bytes이며 per-message origin 미증명 |
| `db68c111` 독립 packed install | **26/26 PASS**, authored declaration 오류0(외부 SDK 진단44는 별도), input ec7ee8fc… 전후 동일·276.137초. `native-post-regression-packed-install*`. 이후 broker 상태 게시 수명 변경은 재검증 대상 |
| `db68c111` Architecture CI40284241877 | **FAIL**. native-all **3772/3775 FAIL3**(prompt/golden/Principal restart delivery), fast794/795 FAIL1. durable871/871·property34/34·stress11/11·platform29/29 PASS·skip0. baseline local serial7/9 FAIL2(지연 예산), parallel3762/3766 FAIL4(prompt/golden/Worker autonomy2). 원시 architecture artifact2개 SHA 검증. 부분 lane PASS를 전체 PASS로 합산하지 않음 |
| CI 후속 상태 게시·동시 실행 수리 | 실제 네 hint가 동일 status를4회 영속 게시한 반례를 보존. 기존 coalescer 재사용·publication task drain, 실제 peer 완료/accepted bytes 대조, Principal actual close 대기로 수정. 관련 **9/9 PASS**·skip/cancel/todo0·47.051초·input `c88fe60f81dbafa4bc638db5999a75916306c5a9e7469fa1308f9e6ac049b361` 전후 동일. `native-status-and-scenario-ownership*`. read19/mixed43/pending12ms; 원래 budget50/100/50ms 유지. 후속 전체/실제 CI는 별도 필요 |
| 전체 Linux 후속 회귀 | **3759/3760 PASS·1 FAIL**, skip/cancel/todo0, 934.673초. input `91909d2aef50ba0583eba51b63f9a1a8b99c0692c707ed9200952d0b1c3d6844` 전후 동일. 유일한 실패는 동적 Runner 제목과 durable registry의 참조2건이며 명시적 시험명으로 수정. `native-whole-current-repaired*`. 이 입력의 Personal PTY는 ambient oma를 사용했으므로 현재 설치 proof로 제외. 이후 실제 설치·통신 변경은 다음 별도 결과 |
| 현재 checkout의 실제 설치·Keychain·Runner·경계 | **70/70 PASS**, skip/cancel/todo0·input `d3892c6bbb1a34dcf9eacb7a676584ce54dcf44127c1831633cd2408ac6c7dae` 전후 동일·64.659초. `native-keychain-install-source-fenced*`. Personal PTY16건은 runtime-only prefix의 exact bin과 checkout module/data 거절 guard를 사용. 실제 socket15건은 fatal UTF-8/BOM/중복 key/unknown correlation·field·type/oversize/EOF/timeout과 poison을 검증. Keychain ownership 정책·Runner 통신·durable registry 포함. signed Keychain/TCC/G-AUTH나 독립 packed install의 대체가 아님. 첫69/70 fixture 실패와54/70 guard setup 실패도 보존 |
| `3f0f6151` 실제 Native CI `40259190478` | Mac15/26·Ubuntu 공통 각 **59/59**, Ubuntu peer **3/3**·native **37/37**·선택 integration **386/386 PASS**, skip/cancel/todo0. 세 OS input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d` 전후 동일. 원시 zip5개 SHA256·source 확인, `ci-3f0f6151/verified-summary.json`. Darwin 각15개 관측/세 gate는 OPEN/BLOCKED이며 workflow 전체 PASS가 아님 |
| 같은 commit의 Architecture CI `40259190470` | **FAIL**. native-all/fast는 installer의 외부 bubblewrap 문서7건이 저장소 `.scratch`에 남아 document-integrity에서 **PRECHECK_FAILED/NOT_RUN**. durable **843/871 FAIL28**, property **28/34 FAIL6**, stress **8/11 FAIL3**, platform **29/29 PASS**·각 skip/cancel/todo0. SHA256 확인한 baseline/all zip과 `architecture-results-summary.json` 보존. 준비 도구의 source/build/bin을 RUNNER_TEMP로 옮겼으며 문서 검사 예외를 추가하지 않음. 후속 실제 CI 검증 필요 |
| `3f0f6151` 전체 Linux local | **3607/3759 FAIL152**, skip/cancel/todo0, 454개 파일·881.448초. input `3888603ca91136c2c78bbace99191ba38f7a22115604994e6809c0f3f59e177d` 전후 동일. `native-whole-local-3f0f6151{.log,-status.json}`, 실패 상세 `*-failure-progress.json`. 실패33개 파일의 당시 원문은 `docs/archive/native-full-regressions-2026-10-26/` 보존 |
| 전체 실패 후속 부분 수리 | 실제 candidate SIGKILL cleanup의 의도한 ABORT_ERR 중복 경합은 실제 close join을 유지해 수정 후 **7/7 PASS**. 공통 workspace asset 검증은 Swift source와 원래 entitlements를 모두 요구. 후속 부분 **173/187 FAIL14**의14건은 broker harness의 retainNative 소유·drain 순서 수정 후 **17/17 PASS**. 서로 다른 입력의 부분 결과를 전체 PASS로 합산하지 않음 |
| native receipt·transport 후속 | 실제 namespace의 receipt/lifecycle **16/16**, 실제 connection flood+receipt policy **18/18**, 실제 private socket idle/EOF **4/4**, 설치된 MCP credential adapter의 실제 owned namespace 실행 **1/1 PASS**·각 skip/cancel/todo0·각 input 전후 동일. `native-receipt-real-scopes`, `native-flood-and-receipt-policy`, `native-runner-private-channel-fixed`, `native-mcp-owned-credential-fixed` 원시 log/status. policy stubs는 OS/auth proof가 아니며 MCP host shell guard는 유지. 최신 전체 회귀/CI/packed 설치는 별도 필요 |
| native publication/cursor 수리의 실제 재검증 | **72/72 PASS**, fail/cancel/skip/todo0·input `8e4e28b76f65cee4fb01fdcc9ea181cbba9ecc84b61410e18f20e0a4936f083a` 전후 동일. 초기 journal 게시 뒤 실제 SIGKILL/재초기화·candidate checkout 뒤 SIGKILL/재시도·같은 bundle FD의 진행한 cursor와 교체 pathname·accepted 원본 bytes·canonical refs를 검증했다. UTF-8/owner rule negative controls도 포함. `native-canonical-scope-fixed{.log,-status.json}`. 전체 root runtime과 후속 CI는 별도 |
| native publication 경계 후속 | durable 등록 불일치5건을 실제 owner/checkpoint로 갱신. 관련 최초 실행 **70/72 FAIL2**, skip/cancel/todo0·input `205d2f05143971f0426f0e991d15c4c3019acaa7534a4c6fb5d0661c1649fafc` 전후 동일. 초기 publication 시점에는 아직 journal writer lock을 획득하지 않았으며, quarantine의 bwrap data 소비가 borrowed FD cursor를 EOF로 만들어 동일 FD 재시도를 거절했다. 시험의 시점 구분·공통 Git의 exact-inode 독립 cursor 소유를 수정 중. 원시 `native-canonical-scope-regressions{.log,-status.json}` 보존. 후속 결과는 별도 기록 |
| 후속 전체 build·정적 발견 | 전체 build PASS. 첫 전체 정적 검사는 남은 빈 legacy 디렉터리2개, private UTF-8 decoder3곳, 옮겨진 Worker spawn owner와 옛 exemption을 발견했다. 빈 디렉터리 제거·공개 domain decoder 연결·정확한 owner relocation과 private-input helper 검사 후 rule0건 PASS. candidate의 BOM이 실제로 ready/허가1을 만들던 반례(`native-candidate-bom-before-fix.log`)를 보존하고 거절/poison/허가0 회귀와 parser corpus를 추가. 전체 architecture/runtime/CI 결과는 이후 고정 입력에서 별도 확인 |
| `dd8d7a96` 실제 CI `40254390815` | Mac26/15·Ubuntu 공통 각각 **58/58**, Ubuntu peer3/3·native35/35·확대44개 파일 **386/386 PASS**, skip/cancel/todo0. 세 OS input `4927bdabbfd9b9aba3e478158a2a473174d33c7cfb22d1f6b4a1e89601904ace`·전후 동일. 실제 prerequisites-before에는 rg/fd/fdfind가 없고 Corepack0.36.0은 ambient PATH에만 있었다. Node prefix에0.34.0 설치 후 Worker 실제 명령도 통과. 양 Darwin 각15개 관측/세 gate는 OPEN/BLOCKED이며 전체 workflow PASS가 아님. zip5개 SHA256·source 확인, `ci-dd8d7a96/verified-summary.json` 보존 |
| 전체 검증 도구의 native 전환 작업 트리 | local에서 native execution 시험 제외를 없애고 kernel/all/durable은 pinned0.12.0 preflight를 요구한다. manager opt-in/fixture/cleanup 경로를 제거하되 direct argv/manager 거절 guard는 유지한다. 현재 selection/clock/source-binding 정책 **42/42 PASS**·skip0(`native-verification-all-policy.log`); 이 정책 단위 시험은 새 shared CI installer나 전체 Linux runtime의 PASS가 아니다. installer/전체 native-all job·root 전체 회귀의 실제 실행은 다음 검증 대상 |
| `159c66c8` 실제 CI `40252199462` | Mac26/15·Ubuntu 공통 각각 **58/58**, Ubuntu peer3/3·native35/35 PASS. 확대 integration은 **355/359 FAIL**, skip0: Python message-id header의 선행 folding 공백, 검색 도구, Node26에 없는 Corepack 및 그 실제 실행4건. 세 OS input `b9cada156294180f8e44963308ae06f8a7bd2bbf1c93f290f98b4f8d0e4781a0`·전후 동일. Darwin 양쪽 실제15개 관측의 세 gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 `ci-159c66c8/verified-summary.json`에 보존. 전체 workflow FAIL을 PASS로 표시하지 않음 |
| 남은 audit/phase4 native 전환 작업 트리 | 실제 scope와 원래 accepted/data 단언을 함께 검증한 **30/30 PASS**, strict/noEmitOnError 컴파일 PASS. root 전체 strict 진단0·모듈 경계0건 PASS(`native-root-final-reference-removal.log`, `native-modules-final-reference-removal.log`). 기존 C1은 실제 동시 quarantine의 RUN_TERMINATION_UNKNOWN도 unknown으로 보존하고 exact plan/ref/receipt의 수렴을 요구한다. 최초 실패 로그는 `native-audit-{first-failure,concurrent-scope-failure}.log`에 보존. 이후 작은 manifest child의 shell 제거·CI44개 목록과 prerequisite 수정은 후속 검증 필요 |
| 검색 도구 설치 차이 재현 | isolated PATH에서 실제 rg 부재는 같은 contained-search 거절을 재현하고 실제 rg를 추가하면 같은 파일/질의가 성공했다. 원본 bytes 보존. `native-ripgrep-prerequisite-repro.log`. fd 부재를 원인으로 가정한 첫 대조는 재현되지 않았으며 `native-fd-prerequisite-repro.log`를 그대로 보존. CI는 rg/fd-find/Corepack0.34.0의 실제 설치·버전/SHA를 남기도록 수정 중이며 실패를 skip하지 않음 |
| 확장 native 회귀 및 모듈 독립 설치 — 현재 production 변경 포함 | strict42개 시험 파일에서 **359/359 PASS**, 별도 실제 Linux kernel/sender/namespace **35/35**, 공통 **58/58**, 독립 packed install **26/26 PASS**. 모든 실행 input `e05e5a9542bdda8c50baa8c7d3591251f747418a0bee2872fe63291a699f238e`(15595개)·전후 동일, skip/cancel/todo0. authored declaration 오류0이며 외부 SDK 진단44개는 별도. `native-expanded-{integration,kernel,common}.log`, `native-expanded-independent-install.log`, 각 전후 identity 보존. build26개(7개 재컴파일)·document integrity·production inventory도 PASS. root 전체 strict는 audit/phase4의 제거 API/옛 Promise 처리8개 진단 FAIL, 모듈 검사는 같은2개 시험 파일의 삭제 import3건 FAIL. 전체 root/최종 qualification으로 승격하지 않음 |
| 전체 회귀 전환 후속 — P0·격리·CLI·candidate | 고정된 각 입력에서 strict 컴파일 후 **56/56**, 별도 **66/66**, 실제 CLI/동시 stream **3/3**, candidate·capability·batch **11/11 PASS**·각 skip0. 입력별 `native-p0-ownership-*`, `native-p0-six-seven-*`, `native-cli-stream-*`, `native-phase5-*`가 원시 로그/전후 identity를 소유한다. 서로 다른 입력의 합계를 전체 PASS로 표시하지 않음 |
| parser/view/entry/quarantine 후속 전환 | 각 입력에서 parser/view/native **56/56**, 실제 broker entry **2/2**, 상태 projection **10/10**, 실제 quarantine **4/4**, phase8+durable crash **50/50 PASS**·각 skip0. 원시 `native-parser-views-*`, `native-topology-entry-*`, `native-status-projection-*`, `native-quarantine-*`, `native-phase8-*` 보존. 이후 production 상태 표시 변경은 이 과거 실행의 입력이 아니며 확장 integration/후속 CI로 다시 검증 |
| 확대 integration 최초 로컬 실행 설정 실패 | strict42개 컴파일은 통과했지만 로컬 `/usr/bin/bwrap` mount wrapper를 빼고 실행하여 실제 OS 시험 FAIL/NOT_RUN. `native-expanded-integration-without-local-bwrap.log`를 보존하며 통과로 세지 않음. 실제 pinned bwrap이 보이는 로컬 mount에서 같은42개 전체를 재실행하고 CI에서도 다시 확인해야 함 |
| `65233ca4` 실제 CI `40244936163` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33·선택 integration **197/197 PASS**·skip0. 실제4MiB tmpfs의 ENOSPC, STORAGE_FULL 및 accepted 원본 보존을 확인. 세 OS input `705cae1ca48ba59b776dc6f4b9acac9c7c26314b43e8c4f63235b2bb2cfeab5c`·전후 동일. 양 Darwin gate는 각15개 실제 관측 후 계속 OPEN/BLOCKED이며 workflow 전체 성공으로 표시하지 않음. zip5개 SHA256 확인·`ci-65233ca4/verified-summary.json`과 원시 artifact 보존 |
| 후속 RPC·역사 plan 시험 전환 | 삭제된 host relay를 registry에서 거절하고 현재 internal response를 closed schema로 검증. 역사 v2가 v3 의미를 얻지 못하는 guard·runner 관측·큰 ledger 조회를 유지. strict 부분 컴파일 뒤 **25/25 PASS**·입력 변경0. `native-root-ports-fixed-{before,after}.json`, `native-root-ports-fixed-real.log`. 최초24/25 실패는 옛 internal method 수9 기대값이며, 현재8개 이름의 정확한 닫힌 목록으로 갱신. 이 후속 변경은 아직 작업 트리에 있음 |
| `d5d65ed4` 실제 CI `40243911993` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33 PASS. Linux 선택 integration은 **179/180 FAIL**: 실제 full-filesystem child의 옛 unshare가 uid_map 권한 거절로 미실행. 세 OS input `218696cec4ea5d1dee5cac3969d2a85e526d4114828aa6952004a9e9b5ceaded`·전후 동일. 양 Darwin gate는 계속 OPEN/BLOCKED·각15개 실제 관측. zip5개 SHA256 확인·원시 `ci-d5d65ed4/` 보존. 전체 workflow 성공으로 표시하지 않음 |
| full-filesystem의 native primitive 전환 | 옛 unshare+shell mount를 pinned bwrap의 실제4MiB tmpfs로 대체. 실제 ENOSPC·STORAGE_FULL·accepted mail 원본/게시 검증을 모두 유지했고 global userns 설정을 바꾸지 않음. 추가 native asset/준비 시험과 함께 **21/21 PASS**·skip0, input `5e5793b5df95997edbcf014f55ed8cd7fec98b41908b10921ae40c42d419c39a`(15597개)·전후 동일. `native-full-fs-replacement-*` 보존. 후속 CI 재실행 필요 |
| `d5d65ed4` 이후 독립 모듈 설치 재검증 | **26/26 PASS**. 각 tarball을 선언한 dependency closure만으로 설치하고 public entries·authored declarations·해당 installed runtime을 검증. 외부 SDK declaration44개는 별도 진단이며 authored 오류0개. input `d05e9255f5df7f17f61bc83469997e6bd296362d475ab6c630ee50c805b222c5`·전후 동일. `native-d5-independent-install.log` 보존 |
| 선택 native integration의 단일 고정 입력 실행 | strict/noEmitOnError로19개 시험 파일을 컴파일하고 **180/180 PASS**·skip/cancel/todo0. input `8dcd2c2ec5c10709a5f73d5502db7061097281864c39c677293d9b88405663fe`(15597개)·전후 동일. `native-selected-integration-{before,after}.json`, `native-selected-integration-real.log`. 실제 Native/Pi·권한·receipt·Worker·durable SIGKILL을 같은 실행에서 검증. 전체 root type/module 검사는 여전히 별도 FAIL이며 Mac 제품 qualification이 아님 |
| `6d8263eb` 실제 CI `40239657753` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native **31/31 PASS**·skip0. 세 OS input `2c2cdee2d33c5cf83392cf626a988748c0aff5f492ef84735e9dd34d7de723fb`·전후 동일. Darwin 양쪽 각15개 실제 관측 후 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 결과와 요약을 `ci-6d8263eb/`에 보존 |
| 실제 Native Resident/Broker/Pi 통합과 종료 수리 | **25/25 시나리오**, 실제 Resident6개를 포함한 공통 수명·shutdown **34/34 PASS**·skip0. input `b6a41d6ce65c8964788337a8b91fc19067fffe9343fc537aa72858b123a5a577`(15594개)·전후 동일. 자동 생성 첫 실행·현재 grant·provider 실패·SIGKILL·broker 교체·receipt·tool plan 거절을 실제 Pi/sandbox로 확인. `native-resident-drain-{scenarios,policies}.log` 보존. root 전체 PASS가 아님 |
| systemd 시험의 실제 native 전환 | strict 부분 컴파일 후 정책·권한·accepted fact **71/71 PASS**, input `db9e3ef267d7076bdc3ff1fb0f44a798e5e449f98711a686e8493a65ca370dfe`. 별도 입력 `62abb6d454cbe99a3dfec064faa4ddab4b73c81f5e92e1d5188b1b626286f392`에서 Worker/sandbox **38/38**, 실제 durable SIGKILL **46/46 PASS**·각 전후 동일·skip0. `native-policy-71-real.log`, `native-connected-{worker,crash}-regressions-real.log` 보존. 당시 시나리오25개 중1개 실패도 보존했으며 위 수리 후25/25와 합산하지 않음 |
| 전환 중 재현한 통합 실패 | 첫18개 시나리오 중2개 실패: 자동 시작으로 초기 mail이 cur로 이동하는 fixture 차이, 종료된 Store 재접근. 이후25개 중1개 실패: runner.open 뒤 옛 incarnation으로 stop하고 diagnostic close가 teardown 뒤 도착함. 실패·전후 input과 원시 로그를 보존했으며 skip·죽음 보장 완화로 해결하지 않음 |
| 최신 root 전체 strict typecheck | 후속 audit/phase4 전환 뒤 **PASS, 진단0**·모듈 경계0건 PASS. `native-root-final-reference-removal.log`, `native-modules-final-reference-removal.log`. 이전8개는 `native-root-after-expanded.log`와 옛 시험2개 파일의 삭제 import3건이다(`native-modules-after-expanded.log`). 이전17개는 `native-root-after-cli-stream.log`. 이전54개는 `native-root-after-rpc.log`. 이전61개는 `native-root-after-layout.log`, 이전79개 진단은 `native-root-after-connected.log`에 보존했다. 제거된 unit/host relay API와 기존 물리 시험의 전환이 남았다. 선택 native integration의 PASS를 root 전체 PASS로 표시하지 않음 |
| `64cb2cad` 실제 CI `40237516208` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native 실행·SIGKILL·sender·Git·Resident **24/24 PASS**. build26/26·세 OS 동일 input `d568e62424b4c30f0d9729fb94436c0ffedcbaf93ff3bca5b3a08aadfb5caf10`(15591개), 각 전후 동일. Ubuntu bwrap 한정 AppArmor profile을 명시했고 전역 제한1은 그대로다. Darwin gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 artifact는 `ci-64cb2cad/` |
| 위 CI 이전의 Ubuntu 실제 실패 | `e62881f3`·`ffcb1140`에서 init pin 이전 종료를 재현. 추가 launcher 관측에서 실제 exit1·`bwrap: setting up uid map: Permission denied` 확인. unknown journal을 빈 목록으로 치환하지 않았고 실패 archive도 보존. OS의 application별 userns 권한을 설정한 뒤 동일 scope/격리/권한 시험을 실행해 위 결과를 얻음 |
| 후속 FD·로그·runtime 수정의 Linux 실행 | 옵션처럼 생긴 env 값 오분류, log open 뒤 hard link 도입 시 쓰기, diagnostic 실패 후 stop의 stale active 상태를 재현·수정. 실제 OS 및 공통 정책 **57/57**, 별도 strict 부분 컴파일 후 기존 권한·accepted fact·mail/storage/reconcile **37/37 PASS**·skip0. input `6a69b12e11d829ef9fda6268dca2ca2ba3a8f88af58b6d639096bb6df531ba20`(15594개), 두 실행 전후 동일. 원시 `native-log-and-runtime-fixed-*`, `native-policy-after-runtime-fixes.log` 보존. root 전체 strict typecheck는 여전히 FAIL |
| `7707de9d` 실제 CI `40235030613` | Mac26/15·Ubuntu 공통 시험 각각 **54/54 PASS**·build26/26·세 OS 동일 input `df788571bb8a51a39e945d8262c5484a630ade3c22f4f5841432d4a5adf6cbd6`(15590개), 각 전후 동일. Darwin 두 gate job은 BLOCKED·각 15개 실제 관측·Keychain SDK typecheck PASS. Ubuntu 후속 native-leaf는 제거된 sd_notify import로 2 PASS/1 FAIL이며 새 Linux execution step은 미실행. 전체 workflow 성공이 아님. artifact 5개 zip SHA256 확인·원시 로그를 `ci-7707de9d/`에 보존 |
| 직접 경로의 workspace·독립 설치 | workspace 시험 **421/421 PASS**·skip0. 첫 독립 설치 실행은 lifecycle smoke의 동기 assertion 때문에 실패했으며 async assertion 전환 뒤 **26/26 packed install/public declaration/import/해당 runtime smoke PASS**. 외부 SDK 선언 진단과 authored declaration 결과는 원시 로그에서 구분한다. `native-connected-workspace-tests.log`, `native-connected-isolation{,-fixed}.log` 보존. 전체 root 회귀는 별도 미완료 |
| 후속 native 회귀 | 제거된 notify 시험을 보관한 실제 peer/leaf **3/3 PASS**. 공통 ResidentRuntime과 실제 Linux scope/journal의 동시 시작·옛 incarnation 중지 거절·geometric backoff·5/60s start-limit·권한 거절 **3/3 PASS**. `native-legacy-leaf-fixed.log`, `native-resident-first-real.log` 보존. 후속 source의 Ubuntu CI는 재실행 필요 |
| 직접 native 경로와 공통 OS/정책의 확대 실행 | **80/80 PASS**, fail/skip/cancel/todo0. Linux 실제 namespace·sender·Git sandbox와 공통 FD/파일/로그/종료 정책·protocol·Restic dump oracle을 함께 실행. input `84b40cf23b96c72a8f0f5da5d570bf6c9cd4393862adf64a5778d53d75a0d19f`(15590개), 전후 동일. `native-connected-current-linux.log`와 before/after JSON 보존. 전체 local 및 Darwin qualification 아님 |
| 2026-10-26 직접 native 경로의 실제 관련 시험 | **33/33 PASS**, fail/skip/cancel/todo0. Linux 실제 bwrap0.12·kernel namespace/pidfd·SIGKILL 5개 경계·setsid double fork/FD 폐기·SCM_RIGHTS transfer와 64 FD 반환 반복·credential 위조 거절·candidate checkout/exec·quarantine 검증/import·POSIX FD·로그 정책·shutdown fence. 일부 policy 단위 시험도 포함하며 G-*나 전체 Linux/Mac 제품 qualification으로 승격하지 않음. input `f6ee85ab6055581bf7f400bbf47b452652bb7f15feab63cc7a91852e6c9b44db`(15590개), 전후 동일. 원시 `native-connected-fixed-real.log`와 before/after JSON 보존 |
| 위 실제 경로의 발견·수정 | 취소 후 gate release, pre-gate 부모 SIGKILL 후 init 생존, quarantine mount target 누락, private argv NUL 검증 누락을 실제 재현 후 수정. 첫 실패 로그를 삭제하지 않음. witness 없는 opening은 unknown으로 보존하며 이 사례의 기대된 거절을 복구 완료로 세지 않음 |
| 직접 경로 연결 뒤 전체 root 회귀 | strict typecheck 첫 실행 FAIL(제거된 units/cgroup API, async lifecycle 및 create v3 시험 전환 필요). 전체 local 미완료, 새 source의 전체 PASS 없음. workspace production build는 26개 성공. 최종 architecture/owner/독립 설치와 Darwin CI는 별도 재검증 필요 |
| `adf20331`: Linux 실제 Restic round trip·손상·죽음 불명·복구 | 19/19 PASS. 이전 source의 독립 결과이며 이후 모듈 이동에 대한 전체 재검증 아님 |
| VM 제거·Restic 모듈 이동 후 Linux 회귀 | durable fault·Restic round trip 27/27, 공통 파일/metadata/소유권 73/73 PASS. artifact 로그에 각 실행 범위를 보존 |
| `762c1604` 변경을 위한 Linux 실행 | 정식 build·typecheck PASS. config/generation/native/tar 30/30, package/세션 소유권 108/108 PASS. 전체 local은 미실행 |
| `aea22ec0`: 실제 macOS 26/15 common-runtime | 25개 workspace build 성공. 양 OS 9/10 PASS·1 FAIL. 파일 생성 뒤 EACCES: Darwin arm64 openat 가변 인자 ABI 결함을 발견. 실패를 보존하고 수정 |
| `762c1604`: 실제 macOS 26/15 common-runtime | build 성공, directory FFI 초기화가 없는 `readdir$INODE64` symbol을 요구해 실패. 수정 후 실제 OS 재실행 대기. Linux 성공으로 덮지 않음 |
| `13d60492`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. build 25/25. 별도 Darwin gate는 계속 OPEN/BLOCKED |
| `0d471551`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. 실제 SCM_RIGHTS 인계 뒤 peer PID는 connector 생존·종료 모두 holder를 가리켰다. PID 재사용·동시 메시지 인증 증명은 아니며 G-AUTH는 OPEN |
| VM 제거 후 첫 고정 입력 전체 local | FAIL. serial 9개 중 PASS4·SKIP5, parallel 3644개 중 PASS3527·FAIL52·SKIP65. exit1, signal null, 입력 변경0. 전체 통과로 합산하지 않음 |
| 위 실패 수리 후 부분 회귀 | strict typecheck·build·정적 gate PASS. 실제 bwrap 실행 16/16, Restic 복구/fault 12/12, 모듈/소유권 62/62, mjs 회귀 42/42, 구조/결박 8/8 PASS. 당시 부분 범위이며 아래 전체 재실행과 구분 |
| `982658de`: 수리 후 고정 입력 전체 local | **3640/3640 PASS**. serial9·parallel3631, fail/cancel/skip/todo0. exit0·signal null, 실행 전후 입력 변경0 |
| `982658de`: 실제 macOS 26/15·Ubuntu CI | Mac 각각 20/20, Ubuntu 19/19 PASS. 별도 Darwin gate는 BLOCKED. artifact zip SHA-256 확인 후 원본 보존 |
| P2 handle 연결 후 Linux 부분 회귀 | strict typecheck·build·정적 gate PASS. 관련 192개 중 191 PASS·1 FAIL은 옛 renameSync fault가 호출되지 않은 시험이었다. 실제 renameat 게시 후 flush에 fault를 옮긴 저장 회귀 12/12, 모듈/문서/trace 28/28 PASS. 전체 재실행 결과로 합성하지 않음 |
| `8c9ef61d`: P2 관련 고정 입력 회귀 | **192/192 PASS**, fail/cancel/skip/todo0·exit0·signal null·입력 변경0. 원본 `p2-handles-fixed{.log,-before.json,-after.json,-status.json}` |
| `8c9ef61d`: workspace 독립 설치 | **25/25 PASS**. tarball을 선언한 의존 closure만으로 설치하고 공개 entry·자체 declaration·해당 installed-runtime smoke 확인. 외부 SDK declaration 진단44개는 원시 로그에 별도 남음 |
| `8c9ef61d`: 실제 Mac 26/15·Ubuntu CI | Mac 각각 21/21, Ubuntu 20/20 PASS. 세 OS의 input digest가 `ab24d1368aea45d3e95aee4c0417bd6e65c7404dbeed44685213dd59447111f8`(15556개)로 동일. gate job은 계속 BLOCKED |
| P3 wake·CLI handle 연결 후 Linux 회귀 | build·strict typecheck·transaction 검사 PASS. captured T·wake·drain·현재 authority·CLI 입력 관련127/127, 실제 Mail→살아 있는 Broker hint 연결·same-key·rollback 관련30/30 PASS. 서로 다른 부분 실행이며 전체 PASS로 합성하지 않음 |
| `663adda3`: 실제 Mac 26/15·Ubuntu CI와 독립 설치 | Mac 각각28/28·Ubuntu27/27, workspace 독립 설치25/25 PASS. 공통 CI 세 OS의 input digest `f7750bfd598ef32554bc06176af265645a69c2a2735a66393abcf847aaaa3292`(15558개) 동일. 별도 Darwin gate는 BLOCKED |
| `663adda3`: 고정 입력 전체 local | FAIL. serial9 PASS, parallel3646 중 PASS3642·FAIL4. skip/cancel/todo0·exit1·signal null·입력 변경0. `local-p3{.log,-before.json,-after.json,-status.json}` 보존 |
| 위 4개 fault/checkpoint 연결 수리 | 관련35/35 PASS·skip0·입력 변경0. input `046211bd0c8ecb72fb29129d4200559d680d5460495893dde6bb921f0575cc95`(15558개). `p3-fault-repairs{.log,-before.json,-after.json,-status.json}` 보존. 전체 PASS로 합성하지 않음 |
| 26번째 tool-files workspace 분리 후 Linux 검증 | 정식 build·strict typecheck·정적 architecture PASS. 관련189/189, 별도 실제 SIGKILL·복구17/17, 독립 설치26/26 PASS. input `df4f5b65796e6429afcf52ccbb88c61b050132bb406ecd0964b01ae28e199135`(15564개), 세 실행 모두 입력 변경0. 전체 local PASS로 합산하지 않음 |
| 위 변경의 시험·빌드 실행 오류 | 최초 빌드는 도중 package.json 표기 편집을 입력 고정 검사가 거절했다. 최초 부분 시험160/163은 TS 원본 직접 실행으로 세 상대 경로가 어긋났다. 입력을 고정한 정식 빌드와 컴파일된 시험으로 위 결과를 얻었으며 최초 실패 로그도 보존 |
| `f042b159`: 고정 입력 전체 local·실제 CI | 전체3660/3660 PASS(serial9·parallel3651), skip/cancel/todo0·exit0·입력 변경0. 실제 Mac26/15·Ubuntu 공통 CI 각각30/30·build26/26. 세 OS와 local input `57327bddba87ce9a33f9e266e03d856c355d7a050c55d456b966753c6f26be65`(15564개) 동일. 별도 Darwin gate는 OPEN/BLOCKED |
| OS 경계 확대의 Linux 실행 | 새 실제 OS11개·기존 primitive4개·Linux pidfd/Unix credential5개, 합계20/20 PASS. input `a0143e84c5482b632f25e55cd83450d18b6cbe43c56b2b6d41f3fa7835927be2`(15566개), 입력 변경0. `os-boundaries-linux{.log,-before.json,-after.json,-status.json}` 보존. 새 Darwin 독립 사례는 실제 CI로 별도 판정 |
| 실제 macOS 26/15 Keychain | 독립 Swift primitive SDK typecheck PASS. signed Keychain·release 실행·TCC는 미실행 |
| 현재 source의 전체 local·최종 architecture/trace qualification | 미완료. 일부 이전 실행 PASS를 합산하지 않음 |

실제 workflow: [40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898),
[40197183201](https://github.com/minjung2035/oma-v2/actions/runs/40197183201),
[40200893255](https://github.com/minjung2035/oma-v2/actions/runs/40200893255),
[40201140402](https://github.com/minjung2035/oma-v2/actions/runs/40201140402),
[40201962210](https://github.com/minjung2035/oma-v2/actions/runs/40201962210),
[40202613809](https://github.com/minjung2035/oma-v2/actions/runs/40202613809),
[40202936879](https://github.com/minjung2035/oma-v2/actions/runs/40202936879),
[40205394437](https://github.com/minjung2035/oma-v2/actions/runs/40205394437),
[40207646347](https://github.com/minjung2035/oma-v2/actions/runs/40207646347),
[40210726412](https://github.com/minjung2035/oma-v2/actions/runs/40210726412),
[40216022510](https://github.com/minjung2035/oma-v2/actions/runs/40216022510).
모든 실패 artifact를 보존한다. 원시 local 로그는
`/home/dev/oma-audit-artifacts/native-2026-10-25/`에 있다. 새/변경 source는 NOT_REVIEWED이며
고정 architecture·authored review·과거 검토 기록은 변경하지 않는다.

첫 전체 실행의 입력은 `bcb1b03b01d3605ef0155d0d14d201d35eea9747797109ccd42b8932f67359f2`
(15564개)이며 실행 전후 동일하다. 원시 결과는 위 artifact 디렉터리의
`local-frozen.log`, `local-frozen-before.json`, `local-frozen-after.json`,
`local-frozen-status.json`이 소유한다. 실제 bwrap을 private mount로 배치한 부분 시험은
실제 service/cgroup 또는 manager 없는 제품 실행의 증거가 아니다.

수리 후 전체 실행은 2026-10-25 15:06:43.852–15:21:40.916 UTC에 실행했다.
입력 `7c71573c808ff941dd9849690bf895ccb8e8fe0907ad9616a9c73250dc559d4c`(15556개)는
전후 동일하다. 원본은 `local-repaired.log`, `local-repaired-before.json`,
`local-repaired-after.json`, `local-repaired-status.json`이다. 실행 뒤의 파일 handle 변경은
이 전체 PASS의 입력이 아니다. 이 입력에서도 local runner가 별도로 제외한 service/cgroup
suite 9개는 NOT_RUN이며 Darwin 세 gate의 proof로 합산하지 않는다.

`8c9ef61d`의 실제 Mac 26/15에서 connector가 인계 전에 queue한 첫 바이트를 읽기 전·후
모두 LOCAL_PEERPID는 holder를 가리켰다. 두 process는 살아 있었다. 현재 endpoint의 마지막
PID를 각 요청의 발신자로 간주할 수 없다는 반례이며 G-AUTH를 OPEN으로 유지한다.
SHA-256을 확인한 원본 zip·probe·SDK·시험·input artifact는 `ci-8c9ef61d/`에 보존했다.
그 뒤 CLI context의 held descriptor 연결은 위 runtime/설치 결과의 입력에 포함되지 않는다.

남은 구현은 [전환 기록](native-transition.md)을 따른다. 직접 실행 scope·auth·owned 파일
pin/reopen·quarantine/checker·설치와 P7 최종 대조가 남아 있으며 full support 완료가 아니다.

## 이전 입력의 코드 검증: DR48 (2026-10-25)

| 검사 | 실제 결과와 범위 |
|---|---|
| 전체 local suite | **4184/4184 PASS**. serial9 + parallel4175, fail/cancel/skip/todo0, status0/signal null, 951.28초 |
| 실행 입력 | 15681개, `06811f22e03c6e8eca2e088c1780579a2c3f3525124ec1b3f4b48b4ee77a1c13`. 실행 전후 변경0 |
| build·strict typecheck·전체 정적 gate | PASS. architecture·transaction·durable-boundary·document·spec 검사를 포함 |
| 최신 App 독립 설치 | PASS. 실제 Restic/SQLite close→read-only→reopen, 공개 entry·자체 declaration·설치 runtime |
| Domain·Native·Storage 독립 설치 | PASS. 이후 해당 package 소스 변경 없음 |
| 설치 확인 | 설치된 `oma --help`, managed Restic 0.19.1 확인 |
| review | 새/변경 코드 NOT_REVIEWED. 과거 authored review를 갱신하지 않음 |

원시 결과의 소유자:
`/home/dev/oma-audit-artifacts/session-storage-2026-10-25/verification-result.json`.
같은 디렉터리의 `local-full-accepted.log`, `*-before.json`, `*-after.json`, `*-status.json`이 실제 입력과 종료 상태를 보존한다. 실행 뒤 결과·운영 안내·인계를 기록한 차이는 `post-runtime-input-relation.json`에 있다.

DR48은 Git index·local refs·staged/unstaged·untracked/ignored 파일, mode·소유권·nanomtime·symlink·내부 hardlink의 보관/복원과 삭제·게시 후 실패 재시도를 검사했다. 두 세션의 동일한 random 4MiB 파일은 source 합계 8,388,608 bytes에 대해 unique stored data 4,235,172 bytes였다. 이 fixture 결과를 제품 전체 절감률로 사용하지 않는다.

초기 손상 시험에서 Restic tree cache가 repository 손상을 가린 실패를 보존했다. `--no-cache` 수정 후 실제 손상 pack과 원본 보존을 검증했다. SQLite read-only 조회가 만든 빈 WAL 때문에 복원이 막히던 결함도 회귀로 확인했다. 첫 전체 실행은 수정 전에 SIGTERM으로 중단했으며 PASS로 계산하지 않는다. 자세한 실패·수리 과정은 [정리 전 검증 전문](../archive/documentation-cleanup-2026-10-25/validation.md)에 있다.

## 기동 시간의 마지막 측정 (2026-10-25)

같은 설치·프로젝트에서 통제한 전후 각 3회 중앙값이다.

| 측정 지점 | 이전 → 개선 후 | 측정 경계 |
|---|---|---|
| 대화 화면 | 4.50 → 4.27초 | 실제 entry·PTY·SDK·Open TUI, local scripted provider, systemd 조작 차단 |
| 첫 provider 요청 | 4.77 → 4.54초 | 위와 같은 통제 환경. 실제 외부 provider 응답 시간 아님 |
| 저장소 준비 | 12.69 → 9.67초 | 별도의 실제 Git 준비 측정. Workers 최종 준비 시간 아님 |

VM을 포함한 전체 Society 시작 시간은 측정하지 못했다. 서로 다른 측정값을 더해 전체 시간으로 표시하지 않는다. 원시 입력·로그·실패·검증 판정은
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/verification-result.json`에 있다.

## DR48 입력의 실제 환경 검증과 당시 한계

| 항목 | 현재 판정 |
|---|---|
| 현재 코드의 실제 Linux 서비스/cgroup qualification | NOT_RUN. local runner에서 별도 제외한 suite이며 private bwrap overlay로 대체하지 않음 |
| native macOS·Swift helper·VM·Keychain·APFS | NOT_RUN. 이 저장소에 설치 가능한 OMA.app/guest image 배포물 없음 |
| 현재 코드의 실제 provider turn·release qualification | NOT_RUN. scripted/loopback 검사는 외부 서비스 증거가 아님 |
| 실제 power-loss 내구성 | NOT_RUN. SIGKILL·in-process fault 결과와 구분 |
| 실제 manager/cgroup candidate 검사·reviewer shortage 예외 | 기존 독립 거절의 영향이 남음. fixture 성공으로 실행 지원을 주장하지 않음 |
| 선택적 notmuch·reflink·fresh verifier 및 모델 품질/비용 우위 | 활성 구현이나 비교 실험이 확인된 기능으로 표시하지 않음 |

DR48은 ACL/xattr·special file·nested mount·읽을 수 없는 파일·복원할 수 없는 소유권이 있으면 회수를 거부하고 원본을 남긴다. 도구·키·checkpoint·closed DB identity가 확인되지 않는 cold 세션은 시작하지 않는다. Restic의 과거 snapshot을 자동 prune하지 않으므로 고유 데이터의 누적은 남는다. 상세 사용법은 [operations](../operations.md)가 소유한다.

과거 kernel/crash·provider 실행 기록은 해당 당시의 입력에 대한 기록이다. 현재 입력의 미실행 범위를 그 기록으로 닫지 않는다. 측정용 임시 VM은 제거됐고 전체 VM+Society 시간 결과는 없다.

## 문서 정리의 검증 (2026-10-25)

| 검사 | 결과 |
|---|---|
| 전체 정적 gate `npm run check:architecture` | PASS. workspace·legacy·source inventory·architecture rule·transaction·durable boundary·문서·spec 검사 위반0 |
| 문서·trace·inventory·decision·review closure·verification policy 회귀 | **77/77 PASS**. fail/cancel/skip/todo0 |
| 위 두 실행의 입력 | 15674개, `2f870978ea6dbbb62e8b666d0d8bb29b9ce9a496ef4efda8ac66bb6ac3a1e8b6`. 각각 실행 전후 변경0 |
| 보존 확인 | 원문 사본13개·기존 archive·architecture·PRIORITY-0·review-notes bytes 일치. 규범 조항375개 fingerprint 동일 |
| 변경 범위 | 문서만 변경. production code·schema·설정·권한·기계 판독 map 변경 없음. 전체 runtime suite 재실행은 NOT_RUN |

결과를 기록하기 전 입력의 원시 로그와 상태는
`/home/dev/oma-audit-artifacts/documentation-cleanup-2026-10-25/`의 `architecture.log`, `documentation-tests.log`, 각 `*-before.json`/`*-after.json`/`*-status.json`이 소유한다. `preservation.json`은 문서 원문·규범·보호 파일·코드 입력의 보존을 확인한다. 이 결과를 인계·validation에 기록한 뒤의 입력 차이와 재검사는 같은 디렉터리의 `post-check-input-relation.json`, `final-documentation-checks.log`, `verification-result.json`에 구분한다. 정적 검사는 실제 플랫폼 qualification이 아니다.

정리 전 인계·검증·감사·계획 원문은 [보관 색인](../archive/documentation-cleanup-2026-10-25/README.md)에 있다. 문서를 옮겨도 요구 ID·수용 번호·과거 실패·검토 판정은 유지한다.

## 검증 입력과 LOC

아래 값은 **구조 검사의 현재 입력 identity**다. digest 생성은 runtime PASS를 만들지 않는다.

verification input digest `b64fa5c3e8cec19e3572cd84271f3c9ea6458757648e4c7adefe0430150d6866` (15619 files).

현재 source 목록은 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. `npm run check:inventory`는 cloc 없이 source bytes를 확인한다. `npm run evidence:refresh`의 구조 재생성과 실제 runtime 실행은 별도다.

이전 기록의 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 문서 정리로 새 측정치를 만들지 않는다. DR46 마지막 LOC 시도는 같은-source 반복 결과 불일치로 UNRELIABLE이다. 유효한 최종 LOC·감소율은 주장하지 않는다.

현재 LOC 측정의 경로는 `node scripts/loc.mjs --out <evidence-directory>`가 생성·검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`이다. 생성기는 committed source digest를 먼저 확인하며, source/tool/report의 불일치를 손으로 고치지 않는다. 크기 상한은 없다.

## 재검증 명령

명령의 실제 정의는 [package.json](../../package.json), 요구 범위는 [verification-spec](../verification-spec.md)이 소유한다.

```sh
npm run check:documents
npm run check:spec-inventory
npm run check:inventory
npm run check:architecture
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs test/production-inventory.test.mjs
```

코드 변경이 있으면 해당 lane을 추가한다. 실제 환경이 필요한 suite는 지원·허용 환경에서 실행하고, 미실행은 NOT_RUN으로 기록한다.
