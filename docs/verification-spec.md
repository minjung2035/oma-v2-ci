# 검증 계약 — 수용 시험·증거·측정·qualification

이 문서는 검증 요구의 단일 owner다. 수용 시험 번호와 기존 TEST/COMP/LOC/SP/VAL ID의 의미를 보존한다. 실행 결과는 [현재 검증 상태](implementation/validation.md), 과거 실행은 [archive](archive.md)가 소유한다.

## OMA Core v1 — 검증 계약

**MUST [TEST-001]** 각 행은 구현해야 할 test case다. `Given → When → Then`의 Then은 oracle이며 구현 내부 함수 호출 횟수만으로 대체하지 않는다. 모든 test는 production과 같은 schema/codec/CLI boundary를 사용한다. isolated fixture 외 사용자 checkout/systemd unit을 수정하지 않는다.

**MUST [TEST-002]** fault injection은 test-only boundary hook 또는 외부 kill harness로 구현한다. production에 관리자용 arbitrary failpoint IPC를 추가하지 않는다. 실서비스/process tests와 mocked primitive tests를 결과에서 분리한다. test source는 LOC budget에서 제외하지만 production이 test helper에 의존해서는 안 된다.

## Runtime suite alignment

**MUST [TEST-006]** T01–T77은 normative acceptance contract다. 현재 `npm test`의 총 test 수가 77과 다르더라도 이 표의 행을 삭제하거나 다른 의미로 재분류하지 않는다.

**MUST [TEST-007]** runtime suite의 test 개수와 PASS/FAIL 수치는 [validation.md](implementation/validation.md)에만 기록한다. suite 총 개수는 T01–T77 acceptance coverage와 동일하지 않으며, 보조 회귀 test의 통과는 대응하는 acceptance 행의 미실행 oracle을 자동으로 충족하지 않는다. 과거 test count를 현재 source의 결과로 재사용하지 않는다.

| ID / 요구 | Given → When → Then |
|---|---|
| T01 / N,A | pinned source와 신규 구현 → baseline hash/import/schema/method inventory 검사 → architecture unchanged, native-v2 domain import 0, 허용 여섯 tables만 존재 |
| T02 / DB | 새 DB → schema 적용, FK 확인, 재적용/잘못된 version → 최초 정상; 무단 재초기화/중복 migration 거절 |
| T03 / DB | prepared/completed/delivery fixture → invalid enum/negative units/FK/잘못된 flag insert → constraint 또는 store invariant 거절 |
| T04 / IPC | 유효 frame → byte별 쪼개기/여러 TCP-like chunk/UTF-8 split → 정확히 한 request 복원 |
| T05 / IPC | malicious input → unknown fields/method/version/duplicate key/oversize length/invalid UTF-8/integer overflow, mutation request 누락, read/wait의 top-level request → preaccept 오류, bounded memory, effect 0 |
| T06 / IPC | bundle/context stream → short/long/hash mismatch/timeout → 접수 없음; 같은 key 정확한 재전송 성공 |
| T07 / IPC | 동일 actor/key/payload 동시 20개 → send → operation/message 하나, recipient당 한 delivery, 모든 receipt 동일 |
| T08 / IPC | 같은 key 다른 body/C/to → 재호출 → REQUEST_KEY_REUSED, 최초 결과 불변; create accepted 뒤 host default 변경·same-key 재시도는 저장된 resolved spec 유지 |
| T09 / IPC | accepted 뒤 response socket kill → CLI recovery → 동일 key 조회, duplicate effect 없음 |
| T10 / IPC | 동일 자연어/commit이나 다른 key/to → submit/send → 별도 정당한 operation/mail; semantic dedup 없음 |
| T11 / AUTH | 동일 host UID의 a/b/host process → a socket 경로 접근/연결 → 올바른 cgroup a만 허용 |
| T12 / AUTH | old incarnation 연결 유지 → stop/restart/new run → old request/complete 거절, 기존 accepted fanout은 완료 |
| T13 / AUTH | create 가능한 a → wire profile/capabilities 삽입(동일 default 포함)/sibling stop/principal impersonation → 거절; 정상 name/from/brief는 host childProfile과 위임 교집합으로만 확정, null childProfile 거절 |
| T14 / MAIL | a,b stopped,c retired,d provisioning,Principal → commons → a,b만 저장; b inference 0; Principal/C/D 제외 |
| T15 / MAIL | follow 없는 topic → 첫 post → archive 성공, recipientCount=0, topics view 존재 |
| T16 / MAIL | topic follow/unfollow 및 다중 주소 → acceptance 도중 membership 변경 → transaction snapshot 고정, union dedupe, 과거 delivery 보존 |
| T17 / MAIL | direct/list/multi-list 원문 → reply와 explicit to → 정확한 Reply-To/In-Reply-To/References; forged headers/CRLF 거절 |
| T18 / MAIL | eml stage 중 kill → restart → accepted 없음; orphan 비공개, 동일 key 재전송 가능 |
| T19 / MAIL | object fsync 후 T-send 전 kill → restart → unreferenced object 비공개, recipient 없음 |
| T20 / MAIL | DB accepted 후 archive 전 kill → restart → 동일 object/ID archive+snapshot recipients 전부 보충 |
| T21 / MAIL | A/B만 publish, B는 cur → C 전 kill/restart → C만 보충; B new 재생성 없음 |
| T22 / MAIL | link publish 후 materialized DB 전 kill → restart → 기존 hash 확인, 중복 파일 없이 flag 완료 |
| T23 / MAIL | same-FS/cross-FS fixtures → deliver → hardlink 또는 fsynced atomic copy; bytes 동일, 모델 RO |
| T24 / MAIL | forged approval text 및 ack → integrate 권한 조회 → 승인 변화 없음, ack는 자기 delivery만 변경 |
| T25 / BATCH | pending 40개 두 class → prepare → 최대 설정 개수, 두 class fairness, max6 notice, full index, 원문 미절단 |
| T26 / BATCH | prepared snapshot → 새 mail 도착 → 기존 IDs 불변, 다음 eligible batch에 남음 |
| T27 / BATCH | T-prepare 직후/cur 이동 직후 kill → new run → 동일 ID batch 회수, pending 영구 누락 없음 |
| T28 / BATCH | tool group 실행 중 direct 도착 → Pi steer → 모든 tool result 보존, 다음 LLM 전 notice, S-03 귀속 일치 |
| T29 / BATCH | successful agent_end 전 error/abort → complete 시도 → presented=0; 안전한 재안내 |
| T30 / BATCH | Pi receipt fsync 후 DB complete 전 kill → restart → 증명 가능하면 완료, 불충분하면 동일 ID 재안내; tool 자동 replay 0 |
| T31 / BATCH | 모델이 own session JSON/CLI cache 변조 → completion/새 effect 요청 → trusted receipt 위조 불가, key/hash/authority 재검증 |
| T32 / VIEW | sandbox에서 inbox 읽기 → host atomic rename → 같은 mount에서 새 내용 보임; file bind stale inode 없음 |
| T33 / UNIT | new 기존 존재/runner idle → path enable → 한 runner 시작, 정상 drain 후 exit 0 |
| T34 / UNIT | runner busy 및 마지막 idle 검사 직후 mail → hint 유실 → boundary/path/timer 중 하나로 재발견, model polling 0 |
| T35 / UNIT | slot 모두 점유 → 새 runner → wait 유지, new 때문에 tight restart 없음, 취소 가능 |
| T36 / UNIT | repeated failure → start-limit → reconcile 10회 → reset-failed 0; 명시 start 때만 reset |
| T37 / LIFE | stop 처리 각 단계에 mail 도착 → stop 완료 → new 저장, cgroup 후손 0, 자동 inference 0 |
| T38 / LIFE | cgroup 종료 확인 실패 → start → RUN_TERMINATION_UNKNOWN, incarnation 증가 없음 |
| T39 / LIFE | create 각 durable 경계에서 kill → 동일 name/spec 재호출 → 한 clone/identity/unit/initial mail; 준비 전 broadcast 제외 |
| T40 / LIFE | existing name/spec → 다른 key로 다른 resolved spec create(변경된 host default 포함) → AGENT_CONFLICT, 기존 workspace 보존 |
| T41 / LIFE | GOAL 없음 → bootstrap/create/reboot → resource 준비만, provider 호출 0; 최초 publish 뒤 활성화 |
| T42 / PR | Principal offline + pending question → 새 mail 연속 도착 → relay new 전부 cur, 재시작 폭주 없음, Astra 호출 0 |
| T43 / PR | commons 100 + principal question1 → 기존 UI attach → commons 자동 주입0, 질문 동일 session 전달 |
| T44 / PR | attached session → second attach/reconnect → 중복 거절, authenticated reconnect 정상, Human history 보존 |
| T45 / SB | actor sandbox → host home/DB/bus/other workspace/endpoint/credential/symlink 접근 → 모두 거절; own workspace만 RW |
| T46 / SB | shell grandchild 생성/FD 탐색/network 접속 → stop/각 escape → 후손 종료, 불허 FD/network 없음 |
| T47 / SB | Principal 모든 tool entry/동적 extension → private session/host file 읽기 → model 경로에서 불가; 우회 발견 시 profile fail |
| T48 / INF | society/ancestor quota 경계 동시 requests → reserve → 상한 초과 예약 없음, 자식 quota 우회 없음 |
| T49 / INF | Resident slots/budget 포화 → Principal request → reserved capacity 사용, starvation 없음 |
| T50 / INF | provider stream 성공/429/전송전실패/전송후timeout/cancel → settle → 확정 비용만 정산, 불명확 unknown, auto replay0 |
| T51 / INF | provider 요청 직후 broker kill → restart/동일 ID → unknown 비용 보존, provider 재호출0 |
| T52 / INF,VIEW | private Human prompt에 sentinel secret → 정상/실패/로그 조회 → mail/journal/DB 공개 필드에 sentinel 없음 |
| T53 / GIT | independent clones A/B → A refs/index/config 변경 → B·canonical 불변; process restart 뒤 A clone 유지 |
| T54 / GIT | 큰 shared base+작은 C → submit → prerequisite bundle, 정확한 peer C/path fetch; 결과 크기 기록 |
| T55 / GIT | C freeze 뒤 HEAD 이동/dirty tree → retry submit → 최초 C만 게시, dirty 자동 commit 없음 |
| T56 / GIT | malformed bundle/additional main ref/missing prerequisite/host config injection → submit → canonical refs 불변, 제한 sandbox 실패 |
| T57 / GIT | durable bundle 접수 뒤 kill → restart → 동일 published ref/C/result message로 완료 |
| T58 / GIT | published ref 후 mail 전/response 전 kill → restart → result mail 하나, 같은 receipt |
| T59 / GIT | published ref에 다른 OID → reconcile → conflict, 자동 overwrite 없음 |
| T60 / INT | B에서 분기한 두 published C → 동시 integrate → CAS 하나만 성공, 다른 요청 STALE_BASE+actual |
| T61 / INT | published 아닌 C/not descendant/protected path/check fail → integrate → main 불변, 정확한 error |
| T62 / INT | check 동안 policy/main 변경 → CAS 시도 → 재검사로 거절, 이전 검사로 승인하지 않음 |
| T63 / INT | CAS 직전/직후/DB done 전 kill → restart → base면 재검사, C면 완료, 제3 OID면 unknown+main write block |
| T64 / INT,LIFE | accepted integrate 후 stop, CAS 전/후 각각 → reconcile → 전이면 취소, 후이면 성공 대조; rollback 없음 |
| T65 / CTX | context stream에 ../·symlink·missing GOAL·hash mismatch → publish → 접수/파일 escape 없음 |
| T66 / CTX | context CAS 후 snapshot/link/mail 전 각 kill → restart → 같은 revision/view/notification 복구, source raw Human 미복사 |
| T67 / CTX | 동시 publish 같은 expected → 결과 → 하나 성공, 다른 CONTEXT_CONFLICT; docs는 fixed revision으로 일관 |
| T68 / REC | accepted states 전체 fixture → broker 재시작 → READY 전 old cgroup 정리/효과 대조, duplicate dispatch 없음 |
| T69 / REC | 원문 삭제/hash 손상/SQLite 손상 → startup → STORE_CORRUPT, 빈 DB 초기화/false success 없음 |
| T70 / REC | ENOSPC를 각 write/fsync 전후 주입 → receipt → preaccept false success 없음; accepted는 pending 복구 |
| T71 / REC | quiescent backup → clean restore → accepted mail/Git/DB/session 연결 일치, view/index 재생성 |
| T72 / REC | 별도 VM의 accepted 직후 power cut → restart → S-06 지원 profile의 내구성 oracle 충족; SIGKILL과 분리 보고 |
| T73 / CLI | 일상 send/reply/submit/조회 → 모델 실행 → 본문 Linux commands로 접근, UUID 수동 조합/DB 관리 불필요 |
| T74 / NEG | command/schema/source inventory → architecture audit → 금지 entity/service/workflow/command0, 생산 LOC 계산 일치 |
| T75 / OPT-INDEX | optional index 없거나 손상 → search/delivery → rg 동작, mail delivery 지속, index 재생성 |
| T76 / OPT-APPROVAL | profile 활성 fixture → tuple 변경/중복 actor/자식/위조/revoke → S-08 policy 정확 평가; 기본 build엔 commands/table 없음 |
| T77 / INF,S-09 | 사전 고정 evaluation corpus → 3조건 반복 → 품질/비용/Principal tokens/전체 tokens/latency 각각 결과, 미달 숨김 없음 |

## 제품 표면 acceptance

**MUST [TEST-008]** 아래 행은 [spec §18](implementation-spec.md)의 제품 표면 요구와 [§19](implementation-spec.md)의 tool 표면 투영 요구에 대한 수용 계약이다. T01–T77은 Core, T78–T90은 tiered 확장이 예약한 대역이므로 제품 표면은 **T91부터** 사용한다. 화면 렌더링 스냅샷 비교로 oracle을 대체하지 않는다.

| 대역 | 범위 |
|---|---|
| T91–T98 | TUI 경계·화면·설정 쓰기 |
| T99–T103 | Extension tool 표면 투영 |
| T104–T106 | extension digest 재검증, 엔진 동봉, 설정 없는 기동 |
| T107–T108 | 엔진 프리미티브 소유 경계, spawn 경로 대칭 |
| T109–T110 | 제품 표면의 적대적 입력, core 결합 |
| T111–T113 | 실제 프로세스 경계: SIGKILL, TTY, 엔진 투영 |
| T114–T119 | Principal 권한·credential 경계와 실제 tool·delivery 경로, 감독·재시작·orphan(T115), 봉인된 Resident의 provider 경로(T116)와 봉인(T117), status view(T118), 진입점 배선과 society lease(T119, 한 뜻의 oracle 행 여럿) |
| T120–T123 | 입력 경계와 붙여넣기(T120), accept 전 artifact의 경합(T121), state tree 경합과 storage primitive(T122), 요청 상태 기록의 경합(T123) |
| T124–T127 | 같은 번호에 뒤에 붙었던 뜻을 옮긴 것: Mail 화면 읽기(T124), CI lane의 정직성(T125), 측정 증거의 정직성(T126), 다른 society의 lease(T127) |

한번 부여한 번호의 뜻은 바꾸지 않는다([PRIORITY-0](PRIORITY-0.md)). T115–T117은 시험이 먼저 쓴 뜻(broker 감독, 봉인된 Resident의 provider 경로, 봉인)을 지키고, 뒤에 같은 번호에 붙었던 뜻은 T124–T126으로, T122에 함께 붙었던 다른 뜻은 T127로 옮겼다.

| ID / 요구 | Given → When → Then |
|---|---|
| T91 / TUI-002,003 | host TUI와 Resident CLI가 모두 설치된 배포 → sandbox 안에서 TUI 실행 파일·소켓·설정 접근, `oma --help` 출력 검사 → 접근 0건, 도움말에 TUI/Control Panel 문자열 0건, 두 진입점의 argv 파서가 서로 import되지 않음 |
| T92 / TUI-004 | TUI 기동 → Pi 실행 인자 관찰, Pi built-in 대화 표면 탐색 → `--mode rpc`로만 실행, 사용자 입력이 Pi built-in command로 해석되는 경로 0건, TUI 종료 후 Principal identity 보존 |
| T93 / TUI-005,009 | model profile 2개와 Resident 1명이 있는 host 설정 → Principal/Worker model 전환 → 해당 agentProfile의 modelProfile 참조만 바뀌고 다른 profile·quota·initialResidents 불변; 선언되지 않은 model 이름은 `UNSUPPORTED_PROFILE` |
| T94 / TUI-005,007 | 설정 변경 저장 → 기록된 config 관찰 → policy revision이 새 값으로 갱신되고 같은 내용에는 같은 revision이 나오며, 변경 전 파일은 그대로 남지 않음 |
| T95 / TUI-006 | 모델 선택·읽음 상태·UI 위치 변경 후 broker 재시작 → schema/파일 inventory 검사 → 여섯 entity 외 durable 상태 0건, config에 기록한 선택만 복원, 나머지는 원본에서 재구성 |
| T96 / TUI-007,008,009 | 각 Config 항목 변경 → 변경 직후 관찰 → 표시한 적용 시점과 실제 반영 시점 일치; `Initial workers` 변경 후 재시작에 agent 자동 생성·삭제 0건; 기존 Resident의 modelProfile 참조 불변; config 본문 변경 시 policy revision 갱신 |
| T97 / TUI-010 | libdir 밖 경로·심볼릭 링크·변조된 extension 파일, core extension 해제 시도 → Extensions 화면 조작 → 모두 거절, 기록한 SHA-256과 실행 직전 값 불일치 시 기동 차단, 모델이 목록·선택에 영향 0건 |
| T98 / TUI-011,012 | delivery flag fixture와 broker 미연결 상태 → Mail/Dashboard 표시 → unread는 기존 flag에서 파생하고 새 저장 0건, ACK가 승인·완료 의미로 표시되지 않음, unknown/disconnected가 running·0으로 표시되지 않고 관측 시각 표시 |
| T99 / TSP-001,003 | 중첩 group·cycle·자기참조·중복 group·중복 소속·disabled member·direct와 grouped 동시 지정·이름 충돌·한도 초과 선언 → 투영 계산 → 정상 선언만 평탄화되고 나머지는 전부 거절; root는 명시값 또는 아무도 중첩하지 않은 group |
| T100 / TSP-002,004 | role 파일의 투영 선언과 잘못된 선언 → config 로드 → 정상은 검증된 plan으로 보존, cycle·미지 필드는 로드 시점에 `INVALID_REQUEST`; plan은 전송 인코딩을 왕복해도 동일 |
| T101 / TSP-005,008 | defaultMode DIRECT/DISABLED와 등록된 tool 집합 → 초기 활성 계산 → disabled/grouped 비활성, root group 활성, 미지정 tool은 defaultMode를 따름, OMA 소유 tool은 disabled 지정에도 유지 |
| T102 / TSP-006 | 활성 집합과 group 직계 자식 → group 열기 반복 → 합집합만 증가하고 재실행이 무변화; 다른 extension이 활성화한 tool 제거 0건 |
| T103 / TSP-006,007,010 | 손상·형식 불일치 plan과 core extension source → 적용 및 정적 검사 → OMA 소유 tool만 남기고 fail closed; 투영 경로에 자식 handler 실행·동적 import·require 0건 |
| T104 / TUI-010 | 기록된 `{path, sha256}`를 가진 role → spawn 직전 재검증 → 내용이 바뀐 파일·사라진 파일·정규 파일 아닌 경로·형식이 틀린 digest는 모두 기동 거절; 일치하면 기록된 순서 그대로 `-e` 전달하고 core는 두 번 전달하지 않음 |
| T105 / TUI-016,017,018 | Pi가 설치된 host와 엔진 없는 설치본 → OMA 기동 → 항상 동봉 엔진만 실행하고 `PATH`/`/usr/bin/pi`로 물러서지 않음; 엔진 없으면 `UNSUPPORTED_PROFILE`; 상대 경로·부재 pin 거절; 엔진에 OMA 소유 agent 디렉터리 지정, 사용자 `~/.pi` 접근 0건 |
| T111 / TUI-007 | 설정 쓰기 전후 각 경계에서 실제 SIGKILL → 재시작 → `config.json`은 항상 이전 값 또는 새 값으로 loader를 통과하고, 부분 기록·잔존 임시 파일 0건 |
| T112 / TUI-002 | 실제 pseudo-terminal → 기동·종료 → raw mode를 취하고 반드시 되돌리며, bracketed paste mode를 기동 시 켜고 종료 시 반드시 끄고, 실제 터미널 크기를 보고하고, pty로 들어온 바이트가 panel 어휘로 도착하며 pty가 보낸 두 줄 paste는 한 입력 값으로 조립됨; 파이프에서는 raw mode를 시도하지 않음 |
| T113 / TSP-005,006 | 동봉 엔진을 RPC로 기동하고 투영을 넘김 → 엔진 자신에게 활성 tool을 질의 → DISABLED 비활성, GROUPED는 group 열기 전 비활성, root facade 활성, OMA 소유 tool 유지. 이 검사는 `npm run test:functional-surface`이며 release qualification이 아니다 |
| T109 / TUI-010,019, TSP-003 | bundle 밖 참조·손상된 host/role 파일·퇴화한 터미널 크기·이름 문법 위반·비정상 mail 항목·libdir 밖 extension id → 각 경로 → 전부 명시적으로 거절되거나 안전하게 표시되고, 손상된 파일을 추측으로 덮어쓰지 않으며, 어떤 화면도 주어진 폭을 넘지 않음 |
| T110 / TUI-019, TSP-002 | 생성된 설정과 role 투영 → core의 닫힌 validator와 loader → 그대로 통과하고, capability·resource·limit이 core 어휘 안에 있으며, 자식 capability가 부모 delegable을 넘지 않고, 제품 표면이 method 집합을 넓히지 않음 |
| T107 / TUI-020 | 제품 표면 source 전체 → 정적 검사 → 엔진 프리미티브 import는 선언된 소유자에서만 일어나고, 엔진의 절단·줄바꿈·화면 제어는 들여오지 않음; 선언되지 않은 bound·bare Error·비exhaustive closed union 0건 |
| T108 / TUI-004,017 | Resident와 Principal의 spawn 경로 → 각각이 엔진에 넘기는 값 비교 → extensions(digest 포함)·projection·role prompt·agent 디렉터리가 양쪽 동일; prompt 없는 role은 빈 flag를 넣지 않음 |
| T114 / TUI-004, AUTH-003, IPC-011, PR-001, PR-002 | 실제 broker와, 실제 trusted extension을 로드하고 host의 socketpair를 받은 stand-in engine, 그 engine이 띄우는 실제 CLI → host의 자식이 아닌 engine 등록은 거절, credential은 어떤 파일·engine 환경·CLI 환경에도 없고 socket으로만 도착하며 `/proc`으로 다시 열 수 없다. 올바른 credential·handle을 가진 비자손 프로세스의 attach는 `AUTH_FAILED`, 다른 handle은 `ATTACH_CONFLICT`, 재등록과 broker 교체 뒤의 이전 credential은 무효이며, 무효화는 새 attach를 막는 데 그치지 않는다: 실제 자식 프로세스를 engine으로 세우고 그 연결을 열어 둔 채 재등록하면 이미 attach된 연결의 다음 요청과 preflight가 그 자리에서 `AUTH_FAILED`가 되고(세대 binding을 지우고 attach 때 받은 권한으로 판정하면 요청이 통과해 실패), endpoint 종료도 같으며, 거절된 등록은 attach된 Principal을 남기지 않고, detach는 권한을 반납하되 나중을 위해 세워 두지 않으며, 무효화는 attach된 연결 전부에 닿고 attach되지 않은 연결에는 닿지 않는다. 실제 자식을 낳는 stand-in engine을 세워 그 자식으로 attach한 뒤 engine을 죽이면 — 재등록도 endpoint 종료도 없이 — 이미 attach된 그 연결의 다음 요청과 preflight가 `AUTH_FAILED`가 되고 session 전체가 은퇴해 연결이 끊기며(자손 여부를 attach 때 한 번만 보면 reparent된 orphan이 그대로 통과해 실패), 죽은 session 아래의 새 attach도 `AUTH_FAILED`다. OMA tool 네 개가 engine에서 동작하고, Principal에게 온 mail은 idle session에 전달돼 receipt와 함께 완료되며, boundary 없이 끝난 turn은 back-off 뒤 재전달된다. engine의 자식이나 model 쪽 연결은 batch를 준비·완료할 수 없다 . session 소유권은 무엇을 쓰기 전에 예약되며 그 단위는 engine의 agent run이다 — delivery 중 입력한 Human prompt는 engine의 follow-up queue가 아니라 host에서 순서대로 대기하다 run이 끝나는 그 단계에서 쓰이고, run 하나에 `agent_settled`가 하나뿐이어도 대기 중이던 prompt가 각각 한 번씩 순서대로 실행되며, engine이 수락 전에 거절한 prompt는 예약을 돌려주고 화면에 이유가 남는다. 수락된 뒤 전송이 실패한 prompt는 대기열 가운데 어느 것이었는지 원문과 함께 보고되고(이름 없는 실패 보고는 대기 중 두 번째 prompt를 특정하지 못해 실패), 그 뒤에 대기하던 prompt는 순서대로 계속 전송된다. 실패 사유는 문장이 아니라 원인만 실려 오고, 화면은 원문이 어디에 남았는지를 사유보다 앞에 두어 4,000자짜리 사유로도 그 답이 화면 폭 밖으로 밀리지 않는다(순서를 되돌리면 실패). settle되지 않은 delivery와 보고되지 못한 boundary는 각각 예약과 claim을 돌려주고, 실패한 assistant message 하나는 delivery를 끝내지 않으며 run이 settle될 때 판정한다. host가 들고 있는 prompt 수에는 상한이 있어 넘으면 거절하고 알리며, session이 일하는 중인지에 대한 보고는 소유권 이동에서만 나오므로 frame을 넘겨 전송조차 못 한 prompt도 화면을 busy로 남기지 않는다. host endpoint가 서빙하지 않는 method는 `UNKNOWN_METHOD`이지 거절된 host가 아니다(IPC-012). host는 pid가 아니라 시작 시각까지 고정한 identity로만 delivery를 받고, host임이 확인되어도 이 broker가 든 Principal 등록이 없으면 `batch.prepare`와 `batch.complete`는 `AUTH_FAILED`이며(등록을 세우면 같은 호출이 바로 서빙되는 대조로 확인), 등록된 engine이 죽으면 아무도 알려 주지 않아도 다음 요청에서 다시 닫힌다. broker가 멈추면 supervision channel도 놓는다. Principal session은 `principal/private` 아래에 남는다(PR-003) |
| T115 / TUI-002, PR-001, LIFE-006 | supervisor와 channel을 말하는 stand-in broker → 준비 신호 전에는 등록 불가, 등록은 broker가 만든 credential을 돌려주고 거절은 즉시 응답, 응답 없는 broker는 한도 안에서 부재, 다른 host의 broker는 준비·credential 없음, 예기치 않게 끝난 broker는 재시작돼 새 credential로 재등록되고 재시작은 한도가 있다. broker의 응답은 기다리는 session handle과 대조되어, 다른 handle을 실은 credential이나 거절은 기다리던 등록을 해결하지도 거절하지도 못하고 이유와 함께 버려진다(대조를 지우면 이전 session의 늦은 응답이 현재 등록을 해결해 실패). society에 이미 주인이 있다는 status로 끝난 자식은 재시작 대상이 아니라 소유 포기이며 그 이유는 나중에 붙은 listener에게도 같은 값으로 전달되고, 그냥 시작에 실패한 자식은 반대로 재시작된다(둘을 같은 status로 만들면 실패). 실제 `apps/oma/dist/entry/broker.js`는 lock을 이미 쥔 프로세스 옆에서 소유 status로 끝나며 어느 쪽인지 stderr로 말하고, config·SQLite·복구를 건드리지 않아 `runtime.sqlite`를 만들지 않는다 — lock을 놓아 주면 같은 실행이 다른 status로 끝난다. 실제 supervisor를 돌리는 host 프로세스를 SIGKILL하면 실제 supervision channel을 쓰는 broker가 host 부재를 이유로 스스로 끝난다. provisioning을 두 번 돌려도 이미 있는 rootfs 파일은 inode·mtime·ctime까지 그대로이며(같은 바이트를 다시 써도 실패), 변조된 identity 파일도 준비 단계에서는 바이트·inode·mtime·ctime이 그대로인 채 '고쳐야 할 것'으로만 보고되고(준비가 고치면 실패), 되돌리는 것은 lease 보유자만 도는 별도의 수리 단계다 — 수리는 틀린 파일과 어긋난 symlink를 모두 제자리로 돌리고 무엇을 돌렸는지 이름으로 말하며, 고칠 것이 없으면 아무것도 쓰지 않고, 읽을 수 없는 identity 파일은 준비에서도 수리에서도 덮어쓰지 않고 거절된다. 같은 state root에 대해 실제 두 프로세스가 동시에 첫 시작을 해도 둘 다 성공으로 끝나고, canonical main을 심은 쪽은 정확히 하나이며, 남은 repository는 `git fsck --strict`를 통과하고 반쯤 만들어진 staging 디렉터리를 남기지 않는다(최종 경로에 직접 `git init --bare` 하면 진 쪽이 exit 128로 실패) |
| T116 / INF-005,INF-006,INF-007,INF-008 | 봉인된 Resident의 provider 경로: 실제 동봉 엔진, OMA 소유 agent 디렉터리의 credential, host relay와 TLS 대역 → 엔진이 credential을 해석하고, sandbox 쪽 provider 설정에는 같은 모양의 자리표시자만 있으며, relay가 정해진 자리에서만 진짜 key로 바꿔 provider에 닿는다. 자리표시자는 비밀을 담지 않고, 바꿀 곳이 없는 key는 곧바로 거절된다 |
| T117 / SB-001–SB-006, INF-005, TUI-003 | 실제 bubblewrap과 생성된 rootfs의 Resident → trusted extension을 로드해 메일을 custom message로 받고, provider에는 relay로만 진짜 key와 함께 닿으며, host 파일과 network에 닿지 못하고, host 제품 코드를 읽지 못한다 |
| T118 / TUI-021 | broker가 실제로 기록한 status view와 제품의 reader → 같은 파일을 양쪽에 통과 → writer의 출력이 reader에 그대로 받아들여지고, 선언한 한도를 넘는 view나 링크는 메모리에 올리지 않고 거절하며, 소유자만 읽을 수 있다 |
| T119 / TUI-002, PR-001, PR-002, LIFE-006 | 실제 `apps/oma/src/entry/oma-society.ts`를 통제된 모듈 경계에서 실행 → DR35: host lease·binding·설정·private 경로를 확보하고 자기 broker를 시작한 뒤 private 대화 engine 하나를 준비한다. broker ready 전에는 등록·credential·delivery owner가 없고 turn 종료에도 delivery가 실행되지 않는다. 복구·rootfs 수리 후 ready와 등록 승인을 받은 같은 engine에만 credential을 넘긴다. ready가 몇 번 오든 engine은 하나이며 broker generation마다 새 credential을 받는다. 거절·broker loss는 delivery를 닫고 이전 generation이나 종료된 engine의 늦은 답은 successor를 승인하거나 취소하지 않는다. lease를 잡지 못하거나 남의 broker가 이미 듣거나 supervisor spawn이 실패하면 설정·provision·broker·engine·delivery 쓰기를 하지 않고 Control Panel로 남는다. rootfs 수리는 host가 하지 않고 broker의 이전 Resident quiescence 뒤·Resident activation 전에 하며, 실패하면 broker가 ready나 authority를 주지 않는다. 소유를 잃으면 기존 engine을 닫고 실제 OS 종료 뒤 lease를 놓으며 이후 ready도 새 engine을 만들지 않는다. broker·engine·preparation child는 fence를 상속한다. 정상 종료·크래시는 해당 resource owner를 통해 engine·broker·delivery를 거두고, SIGTERM이 동기 Git 준비 중 와도 native child close를 확인한 뒤 broker의 lock/channel을 반환한다. session workspace·history 경로는 entry가 다시 정하지 않고 owner의 값을 쓴다. |
| T119 / REC-007, TUI-004 | 실제 프로세스들 → host가 lease를 잡고 자식을 하나 띄운 뒤 SIGKILL로 죽는다 → 자식이 살아 있는 동안 세 번째 프로세스의 `tryHoldSociety`는 1초 동안 계속 null이고, 자식을 죽인 뒤에야 성공한다. 같은 host가 자식에게 descriptor를 물려주지 **않으면** society는 host가 죽는 즉시 넘어간다(대조가 재현되지 않으면 앞의 시험은 증거가 아니다). engine이 시작한 손자 프로세스만 남아도 society는 넘어가지 않는다 |
| T119 / REC-007, PR-002, TUI-004 | tenure 객체 → society는 한 번에 하나의 tenure만 가지며 끝나야 다시 잡힌다. fence는 tenure가 유효한 동안 실제로 열린 descriptor이고 끝난 뒤에는 읽을 수 없다. delivery는 tenure·살아 있는 broker·등록·engine 넷이 모두 현재일 때만 열리고 넷 중 하나만 거두어도 닫히며, broker 재시작은 이전 등록을 상속하지 않고, 거절된 등록은 열지 않는다. 끝난 tenure에 대한 쓰기와 engine 채택은 거절된다. 종료는 engine의 실제 종료 뒤에 lease를 놓고(대조: 죽음을 기다리지 않고 놓으면 society가 즉시 넘어간다), 죽지 않는 engine에서도 선언된 상한 안에서 끝나며, 크래시 경로는 기다리지 않고 동기적으로 놓되 engine에게 멈추라고 먼저 말한다 |
| T119 / REC-007, R37 | 제품이 실제로 쓰는 spawn helper들 → `spawnOwnedRpc`와 `spawnSupervisedService`로 띄운 진짜 자식이 lease 파일과 같은 inode를 가진 descriptor를 실제로 들고 시작하며(자식이 스스로 `fstat`으로 답한다), 부모가 자기 몫을 완전히 놓은 뒤에도 그 자식이 살아 있는 동안 society는 넘어가지 않고 자식이 죽은 뒤에야 넘어간다. fence 인자를 빼고 같은 helper로 띄우면 같은 자리에 lease가 아닌 descriptor가 오고 society는 즉시 넘어간다(대조). channel/supervision 채널을 함께 요구하면 fence는 그 **뒤** descriptor로 가고 채널을 덮어쓰지 않는다 |
| T119 / REC-007, FS-005 | 실제 lease 취득 → society를 잡아도 state root 디렉터리가 생기지 않고 상위 디렉터리에 아무 항목도 쓰이지 않으며(하나라도 쓰면 실패), 이름은 `\0oma.society.<sha256 64자리>` 형태다. 잡은 뒤 state tree 전체를 지워도 두 번째 `tryHoldSociety`는 여전히 null이다(지운 뒤 잡히면 pathname 하나로 두 소유자가 생기는 옛 설계다). 이름은 run root가 아니라 state tree에서 나오므로 같은 state root는 어떤 경로로 도달하든 한 society이고 다른 state root는 나란히 잡힌다 |
| T119 / REC-007, PI-001 | 실제 세 프로세스(host → engine → 모델 대면 CLI) → engine이 `runCliProcess`로 띄운 CLI가 자기 fd 4를 `fstat`해 lease와 같은 dev:ino로 답하고, 자기 환경에서 그 descriptor 번호를 그대로 다시 선언받는다(번호를 물려받지 못하면 그 CLI는 자기 자식에게 넘길 자리를 스스로 추론해야 하므로 실패). host와 engine을 SIGKILL하고 lease를 놓아도 CLI가 살아 있는 동안 society는 500ms 내내 넘어가지 않고, CLI를 죽인 뒤에야 넘어간다. 대조: engine이 fence를 선언하지 않으면 같은 CLI가 살아 있는데도 society는 즉시 넘어간다 — 감사가 발견한 상태 그대로다. 선언은 있는데 그 descriptor가 열려 있지 않거나 lease의 종류가 아니거나 숫자가 아니면 CLI를 unfenced로 시작하지 않고 실패하며(시작하면 실패), 진짜 lease descriptor를 선언하면 같은 경로가 정상 종료한다 |
| T119 / REC-007, VAL-002 | 통제된 모듈 경계의 실제 `apps/oma/src/entry/oma.ts` → 이미 듣고 있는 broker가 있으면 설정 쓰기·provision·repair·broker 기동 어느 것도 하지 않고 lease까지 돌려준 뒤 Control Panel로 남는다(쓰기가 하나라도 일어나거나 lease를 쥐고 있으면 실패). 대조: broker가 없으면 같은 실행이 probe를 거쳐 private provision·superviseBroker로 이어지고 lease를 놓지 않는다; rootfs repair는 broker가 소유한다. 신뢰할 수 없는 run root는 `tryHoldSociety`·설정 읽기·provision·broker 어느 것에도 닿기 전에 거절되고(lease를 먼저 잡으면 실패), 대조는 `assertHostDirectoryLayout`이 `tryHoldSociety`보다 **앞**에 오는 것을 순서로 고정한다 |
| T119 / REC-007, TUI-004 | 실제 broker 진입점과 실제 lease → 제품이 시작하지 않은 broker는 society lease를 자기가 잡는다: `oma`가 이미 쥔 society에서는 소유 status로 끝나고 `runtime.sqlite`도 만들지 않으며 그 lease를 흔들지도 않는다(그 뒤에도 같은 lease는 여전히 잡히지 않는다). 같은 진입점이 host의 lease descriptor를 fd 4로 들고 그 번호를 환경에서 선언받으면 소유 단계를 지나 자기 이유로 실패한다. 대조: 아무도 쥐지 않은 society에서는 선언 없는 같은 진입점도 소유 단계를 지난다. 제품의 `superviseBroker`가 시작한 broker는 fd 4에서 host의 lease와 같은 dev:ino를 보고 환경에서 그 번호를 그대로 받는다(supervisor가 번호를 선언하지 않으면 실패) |
| T119 / REC-007, R37 | architecture rule module `fence-rules` → `apps/oma/src/`와 `packages/*/src/`의 모든 검사 대상 spawn 지점에 대해 fence를 넘기는 호출은 통과하고, 넘기지 않는 호출은 `fence-propagation`으로 자리 이름(`파일#함수`)과 함께 거절된다. 자리 이름은 둘러싼 변수 선언이 아니라 둘러싼 **함수**다. `fenceExemptSpawnOwners`의 면제는 두 방향 모두 낡으면 실패한다 — 그런 spawn이 더는 없을 때와, 그 spawn이 이제 fence를 넘길 때 |
| T119 / IPC-011, REC-007 | 제품의 process 계층과 trusted extension의 공개 표면 → fence의 환경 이름과 descriptor 번호가 양쪽에서 같은 값이고, channel의 descriptor 번호와 겹치지 않는다(어느 한쪽만 바꾸면 실패). Principal session 환경은 fence를 받은 경우에만 그 이름을 담고, 담는 값은 부모가 쓰던 번호가 아니라 자식이 받을 번호다 |
| T120 / TUI-002,023 | 모든 byte 경계에서 나눈 한국어 UTF-8과 CSI, supplementary·결합·ZWJ grapheme의 Backspace, ASCII·한국어·JSON escape 문자를 포함한 큰 붙여넣기와 최소 허용 `frameBytes`, 긴 transcript와 실행 중 session → terminal stream과 대화 표면 입력 → 분할 여부와 무관하게 같은 key가 되고 escape tail은 prompt로 새지 않으며 Backspace는 grapheme 하나를 지운다. 작성 중 prompt의 UTF-8 source가 16 KiB를 넘지 않고 완전한 Pi prompt JSON command도 현재 frame을 넘지 않으며, 한도를 한 번이라도 넘은 전체 prompt는 명시적 notice와 함께 0회 제출된다. Backspace로 초과 상태를 해제해야만 제출 가능하고, transcript는 모든 생산자에 대해 최근 500 논리 줄·전체 256 KiB·줄당 1 KiB이며 한 번의 append가 2000줄이어도 같은 한도를 지키고(append 수를 세면 실패), host 대기열은 16개이며 각 초과 입력은 접수 전에 명시적으로 거절된다. bracketed paste로 들어온 여러 줄은 줄마다의 제출이 아니라 하나의 draft 경계가 되고(브래킷을 벗기면 첫 줄이 먼저 제출되어 실패), 끝나지 않았거나 한도를 넘은 paste는 조각으로 전달되지 않으며, 미완 CSI는 선언된 deadline 뒤 포기되어 다음 key를 삼키지 않고, 거절된 prompt는 transcript에 0회 표시되고 원문 그대로 draft로 돌아온다. 초과 상태는 원인을 들고 있어 거절된 paste 뒤의 첫 Backspace가 Human이 입력해 둔 마지막 glyph를 지우지 않고 상태만 해제하며(원인을 지우면 `hello`가 `hell`이 되어 실패), 화면 문구도 원인별로 갈린다. clipboard가 스스로 담은 `ESC[201~`는 그 뒤의 개행으로 앞의 텍스트를 제출하지 못한다 — 같은 read에 남은 byte는 그 paste의 내용이 되고(그 read가 또 다른 끝 표시를 반쯤 맞춘 채 끝나면 그 byte들도 내용으로 돌아오며, 되돌리지 않으면 clipboard 텍스트가 사라져 실패), 주입된 clock으로 관측한 paste 종료 후 burst 안의 Enter는 개행이며 burst가 지난 뒤에는 다시 Enter다(negative control). read 경계에서 잘린 code point는 선언된 deadline을 보고하고, 포기될 때 U+FFFD가 아니라 아무 문자도 남기지 않으며 그 다음 byte는 자기가 시작한 key가 된다 |
| T126 / R35, A-008 | skip·todo·cancelled가 섞인 실행 요약, 그리고 행·SUM·cloc 버전이 서로 맞지만 숫자는 위조된 측정 산출물 → 대조와 고정 버전 cloc 재측정 → 실행하지 않은 test가 하나라도 있으면 suite는 통과가 아니고, 재측정 값과 다른 LOC는 거절되며, 재측정하지 못한 결과는 `SOURCE_BOUND`로 부르지 않고, validation 기록이 인용하는 수치는 산출물과 같다 |
| T121 / MAIL-004, CTX-004, LIFE-006 | 접수 transaction보다 먼저 게시되는 immutable artifact → 같은 key 동시 `mail.send`, 같은 actor/key를 두고 다투는 서로 다른 method, freeze 직후 주입한 transaction 실패, linked로 흡수되어 initial message를 이름으로 갖지 않게 된 `agent.create`, 진 `git.submit`, 충돌한 `context.publish` → `mail/objects`는 접수된 ledger가 이름으로 가진 object 집합과 정확히 같고, 실패들 뒤의 integrity inspection에 `OBJECT_DIRECTORY_UNOWNED`가 없으며 판정은 `UNKNOWN`이 아니다. 정산은 자기가 게시한 dev/ino일 때만 unlink하므로 교체된 이름은 남고 두 번 불러도 같으며, 게시된 적 없는 이름은 아무것도 소유하지 않는다. 접수 증거가 된 artifact는 이후 삭제될 수 없고 놓아 준 artifact를 증거로 승격하면 `INTERNAL_ERROR`다. DB를 읽지 못해 접수 여부를 모르면 보존한다 |
| T122 / FS-005, S-06 | 같은 UID의 다른 프로세스가 state tree의 한 component를 공격자 디렉터리로 바꿔치기하는 실제 경합(P7 durability seam을 시계로 써서 결정적으로 주입) → derived file 쓰기의 `file-create`/`before`와 published rename의 `derived-rename`/`before`, staged tree 검증 직후 → 세 경우 모두 bytes는 공격자 디렉터리가 아니라 처음 해석한 디렉터리 안에 남거나(디렉터리를 한 번만 여는 설계) 거절되고, 임시 파일은 어디에도 남지 않는다. staged tree는 바꿔치기된 destination parent로 **게시되지 않고** containment 오류로 거절된다. 대조: `replaceDerivedFile`과 `publishStagedDirectory`를 pathname 재해석 형태로 되돌리면 이 표의 6개 중 4개가 실패하고, 실패 증거에 공격자 디렉터리 경로(`.../moved/receipt.json`)가 그대로 찍힌다 |
| T122 / FS-005, S-06 | storage primitive의 source 자체 → `durable-fs`·`staged-tree`·`directory`·`request-cache` 안의 모든 변경 syscall(`rename`/`symlink`/`unlink`/`link`/`mkdir`/`rmdir`/`rm`/`fchmod`)은 들고 있는 descriptor로 지은 이름(`entryAt(...)` 또는 `/proc/self/fd/<fd>/...`)만 대상으로 한다 → pathname을 다시 말하는 호출이 하나라도 생기면 이름과 함께 실패한다. 대조: `replaceDerivedSymlink`의 임시 링크 생성을 `join(dirname(path), ...)`으로 되돌리면 이 gate가 그 줄을 지목하며 실패한다 |
| T127 / AUTH-003, REC-007 | 실제 두 프로세스와 실제 lease descriptor → society A의 유효한 lease를 fd 4로 물려받고 `OMA_SOCIETY_FENCE_FD=4`를 선언받은 자식이 society **B**를 서빙하려 하면 "lease of another society"로 시작 자체가 실패한다(양성 대조: 같은 descriptor로 A를 서빙하면 `inherited`로 통과). 이름 없는 socketpair·pathname에 bound된 listening socket·일반 파일·열려 있지 않은 descriptor는 모두 lease가 아니며, 그 중 "lease가 아님"과 "확인할 수 없음"은 서로 다른 답이다(regular file은 ENOTSOCK이므로 확정적 거절, 닫힌 fd는 EBADF이므로 미확인). 선언된 번호가 제품이 정한 자리가 아니면 fallback으로 lease를 새로 잡지 않고 실패한다. 대조: 선언된 descriptor를 `fstat`으로 socket인지만 보던 옛 술어를 되돌리면 이 행의 시험들이 실패한다 |
| T123 / REC-007 | 실제 두 프로세스가 같은 request 300개를 동시에 관측 → 한쪽은 `failed`, 다른 쪽은 `pending`을 같은 순서로 기록 → 300개 전부 최종 상태가 `failed`다. 상태 순서만으로는 막히지 않는다(각 프로세스는 자기가 읽은 값에 대해 순서를 올바르게 적용한다) — 읽기와 쓰기가 하나의 배타적 hold 안에 있어야만 막히므로, 순서표(14쌍: 진행은 supersede, 회귀는 stale, 두 종결 상태의 충돌은 contradiction)와 이 프로세스 시험은 각각 성질의 절반이다. 거절된 관측은 파일을 다시 쓰지 않고(byte 동일), 모순은 `CACHE_CORRUPT`이며 증거를 덮어쓰지 않고, 다른 operation의 receipt는 순서를 매기지 않고 거절한다. 다른 프로세스가 든 receipt lock은 상한 뒤 `CACHE_UNAVAILABLE`이지 획득이 아니며(양성 대조: holder를 죽이면 같은 호출이 곧바로 성공한다) 임계 구역이 끝난 lock은 남지 않는다. 대조: 순서를 `supersedes` 고정으로 되돌리거나 hold를 제거하면 각각 해당 시험이 실패한다 |
| T106 / TUI-017,019 | 설정 없는 빈 프로젝트 디렉터리 → `oma` 실행 → 초기화 명령 없이 society를 디렉터리에서 유도하고 실제 설정 파일 생성; 생성값은 bounded하고 Control Panel에서 수정 가능; Resident에 `code.integrate` 없음; 사용자 `~/.pi` 참조 0건 |


DR46 전환 기록: 위 T117의 network 차단 절과 그 --unshare-all 전용 fixture는 퇴역했다.
원래 번호와 문장의 의미를 현재 허용 의미로 재사용하지 않는다. 현재 네트워크/오라클의
결정은 [DR46-F04](design-revisions.md#dr46--출시-전-레거시-제거와-workspace-분리)를 따르며,
실제 recipe의 공유 네트워크와 파일/credential 봉인은 별도 `test/network-sandbox-layout.test.mjs`가
확인한다. T117의 실제 extension·relay credential·custom delivery·제품 코드 봉인 검사는 유지한다.
| T124 / TUI-011 | 심볼릭 링크·디렉터리·헤더 한도를 넘는 메시지가 섞인 Maildir → Mail 화면 읽기 → 링크는 따라가지 않고 파일 전체를 버퍼링하지 않으며, unread 수와 목록의 unread 행 수가 같고, 정렬은 파일 이름이 아니라 도착 시각을 따른다 |
| T125 / VAL-002 | CI workflow 원문과 lane 정의 → 정적 대조 → 어떤 lane도 자기 예산보다 먼저 죽지 않고, job 시계도 포함한 check들의 합보다 먼저 울리지 않으며, 기본 전체 시험은 native execution 시험을 제외하지 않으며, 별도로 실행하지 않은 wrapper는 NOT_RUN으로 기록하되 그 파일·필수 oracle이 실제 전체 native lane에서 실행되어야 하고, 봉인 시험이 필요로 하는 도구는 설치되며, 생성기 이전에 관측한 stale inventory가 실패로 남는다. master가 될 수 있는 모든 경로 — 통합 branch push, master push, master를 향한 pull request — 가 검증에 연결되고, 검증 대상은 CI가 만들어 낸 merge commit이 아니라 제안된 head commit이며(`github.sha` 하나만 쓰면 pull request에서 어느 tree와도 다시 대조할 수 없는 SHA에 증거가 묶여 실패), 무엇도 측정되기 전에 checkout된 tree가 그 commit임이 확인되고, 어떤 bytes가 돌았는지가 local gate와 같은 closure로 생성기 이전에 기록되며, 모든 evidence artifact는 그 commit 이름으로 보관되고, binding을 잃은 run은 성공을 보고할 수 없다 |

**MUST [TEST-003]** default core에서 T01–T74 및 T77을 적용하고, T75/T76은 해당 optional 활성 시 필수다. S-03 등 미결정 gate 때문에 test oracle의 version-specific 부분을 완성할 수 없으면 test를 skip해서 release 통과로 계산하지 않는다.

**MUST [TEST-004]** T18–T22/T27/T30/T39/T57/T58/T63/T66은 최소 각 지정 경계에서 process kill을 실행한다. assertion은 externally visible accepted receipt, DB rows, file hashes, Git OIDs, actual cgroup, Pi captured event sequence를 사용한다. '함수를 호출했다'는 mock assertion만으로 crash test 통과를 선언하지 않는다.

**MUST [TEST-005]** [contracts.type-test.ts](../implementation/tests/contracts.type-test.ts)를 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes와 noEmit으로 검사한다. 모든 mutation의 request 필수, public method 분류의 완전성·배타성, read/wait의 top-level request 금지, agent.create의 profile/capabilities 입력 금지 및 ResolvedAgentSpec 변수의 wire 입력 거절을 유지한다. 이 compile-only 회귀 검사는 T05/T13의 runtime validator 검사를 대체하지 않는다.

## native 플랫폼 oracle (DR49)

OS 경계의 회귀는 `test/native-os-contracts.test.mjs`가 실제 Linux/macOS kernel에서 수행한다.
cross-process no-replace 게시 경쟁, SIGKILL과 상속 FD에 따른 flock 수명, exec의 CLOEXEC,
다중 buffer directory 열거·FD 누수, raw/긴 symlink, 동시 directory/symlink 교체, 실제
EACCES·EBADF와 primary/cleanup 오류 보존, 형제 process ancestry, kernel peer UID를 검사한다.
각 fixture는 child의 실제 close 뒤 임시 트리를 정리한다. timeout은 성공이 아니다.

Darwin gate 관측은 process/files/auth/socket-transfer/queued-transfer를 각각 독립 cwd와
process에서3회씩 실행한다. 각 결과는 exit/signal/stdio·SDK/OS/image·source/driver/fixture
digest와 정리 결과를 보존한다. 한 사례가 실패해도 다른 관측을 계속 수집하며, 그 실행의
최종 상태는 SETUP_FAILED다. OBSERVED는 syscall 관측 완료를 뜻하며 gate PASS가 아니다.
부분 primitive 성공과 반복 횟수는 임의 후손 종료·permission-independent pin/reopen·
요청별 발신자 증명이나 실제 PID 재사용 시험을 대신하지 않는다.

과거 VM의 MAC/MV/T 수용 번호·원문은 [폐기한 VM 시험 기록](archive/macos-vm-tests-2026-10-25/README.md)에
보존한다. 그 결과는 native PASS에 합산하지 않는다. 현재 요구는 [NATIVE-001–010](macos-platform.md)과
[native 명세의 CI 계약](macos-native-spec.md#12-mac-없이-개발하는-ci-계약)이다. G-PROCESS·G-FILES·G-AUTH는
각각 실제 Darwin kernel probe·공격 fixture·원시 artifact로 검증하며 OPEN/BLOCKED/SETUP_FAILED는 실패다.
Linux의 공통 TS 시험과 Mac의 실제 OS 시험을 구분하고 전체 후손 종료·source quiescence·파일 원본·권한·
receipt 보장을 mock이나 조건부 skip으로 닫지 않는다.

## Requirement → production path → executable evidence

**MUST [COMP-001]** release trace는 구현 검증 산출물이며 OMA runtime의 DB/queue/state가 아니다. [traceability.json](../implementation/traceability.json)은 현재 문서 requirement를 추출한 미검증 목록이다. 현재 저장소의 production 코드를 검사한 결과가 아니며 owner/call path/test는 임의로 채우지 않았다. release 전 적용 규범을 모두 분류하고 실제 source에서 근거를 채운다.

**MUST [COMP-002]** 각 항목은 source file+requirement ID+규범 본문 digest로 식별한다. 중복 문서 참조는 같은 ID라고 무조건 합치지 않는다. scope는 runtime/build/document/optional 중 하나로 분류하고 분류 이유를 기록한다. runtime MUST NOT도 적용 대상이며 금지 경로를 직접 시도하는 negative test가 필요하다. 현재 unclassified는 release 통과 상태가 아니다.

**MUST [COMP-003]** 적용 runtime 요구의 증거는 다음 field를 모두 갖는다. owner는 규범을 최종 집행하는 단일 module+symbol이고 호출 사슬의 보조 모듈은 callPath에 기록한다. 제안된 LifecycleModule 같은 새 계층을 만들 필요는 없으며 기존 broker handler/units/store/mail/git 경계에 소유자를 배정한다.

| 필드 | MUST 내용 |
|---|---|
| requirement / source / digest | 실제 현재 규범 위치와 내용 fingerprint |
| applicability / rationale | 적용 profile, 비적용이면 코드·config상 비활성 근거 |
| owner | 실제 production source path+symbol; 선언/interface 이름만 금지 |
| entrypoint / callPath | 설치된 compiled entry 또는 실제 socket method → 인증/dispatch → owner → 효과 경계 |
| negativeTests | 실행 가능한 test file+case; 위반 입력/강제 장애/누락 guard를 검출하는 oracle |
| evidence | 현재 production source revision/content digest, spec digest, build command, test command, exit status, 로그 경로, adapter/환경 pin |
| status | unverified / blocked / proven / not_applicable; blanket passed 금지 |

**MUST [COMP-004]** proven은 실제 production entrypoint를 실행한 결과여야 한다. unit test의 mock adapter만 통과했거나 import 가능한 helper가 있지만 entrypoint에서 호출하지 않으면 unverified다. UI/tool wrapper가 다른 실행 파일을 호출하는 wiring도 검증한다. resource/execution/Pi 관련 요구는 필요한 실제 kernel/namespace/Pi 경계를 쓰고, 네트워크 고장 등 fault만 test adapter로 주입할 수 있다. test double의 범위와 미검증 real boundary를 증거에 표시한다.

**MUST [COMP-005]** release checker는 source inventory의 적용 runtime 요구 수와 trace 수를 대조한다. 누락/분류 없음/실제 owner 없음/현재 revision 불일치/negative test 없음/OPEN SPIKE를 proven 처리한 행이 하나라도 있으면 release gate 실패다. not_applicable은 해당 feature를 실제로 enable할 수 없다는 config/API 거절 시험이 있어야 한다. CI 로그 이름이 requirement 이름과 같다는 것만으로 coverage를 인정하지 않는다.

**MUST [COMP-006]** spec/production owner/entrypoint/dependency/adapter가 바뀌면 영향받은 evidence는 stale이며 다시 실행한다. README에 '완료'라고 적거나 DTO field를 추가해 증거 상태를 올리지 않는다. test-only backdoor·success fallback·mock receipt가 production dependency closure에 있으면 gate 실패다. source line 수 또는 test 개수 자체는 준수 증거가 아니다.

**MUST [COMP-007]** 기존 명확한 요구를 반복 설명하는 대신 다음 priority trace를 먼저 채운다: LIFE-001/007 stable-name dedup, LIFE-008 dynamic identity, REC-007/SEQ-003 singleton-before-DB, UNIT-007 actual effect result, IPC-012 exhaustive internal surface, BATCH-001/006 handoff/gate, INT-007/S-01-CANDIDATE actual candidate resource binding, IPC-004/006 key, AUTH-001/003 capability/fencing.

**MUST [COMP-008]** schema migration과 RuntimeAgentRecord decoder가 stale resolved spec을 받으면 missing resources/modelProfile을 initialResidents/default로 채우지 않는다. 기존 spec draft를 바탕으로 만들어진 DB가 있다면 host가 검토한 migration을 먼저 설계한다. 이 문서 작성은 사용자 DB를 검사·변경하거나 migration을 실행한 것이 아니다. unsupported stored format은 명시적으로 차단한다.

## Current implementation artifacts — 비규범적 안내

- [source-owners.json](../implementation/source-owners.json): declared production owner/entrypoint/callPath locator. 실제 review 상태는 byte에 결박된 review 기록을 따른다.
- [traceability.json](../implementation/traceability.json): normative clause fingerprint inventory. 실행 proof 자체가 아니다.
- `scripts/compliance.mjs --inventory`: changed clause/owner linkage를 unverified로 무효화하며 기존 proof를 추측으로 승격하지 않는다.
- `scripts/adversarial-report.mjs`: 필요할 때 point-in-time static report를 생성한다. 생성된 report는 current guidance가 아니다.
- 실제 실행 상태와 release 미검증 범위는 [validation.md](implementation/validation.md) 한 곳에서 관리한다.

Source/test/tool 경로가 이동하면 관련 evidence는 stale이다. 완료된 audit/closure narrative는 current implementation 문서에 다시 누적하지 않고 [historical archive](archive.md)에서 과거 snapshot을 조회한다.

## Production 원본 목록과 LOC 측정

LOC 크기 목표·상한과 그에 따른 review/release 차단은 사용자 결정으로 폐지했다([DR20](design-revisions.md#dr20--loc-크기-제한을-폐지하고-측정의-진실성은-유지한다)). 통합 후에도 같은 LOC ID로 추적한다.

LOC-001은 2026-09-28 철회했다. 이 ID를 다른 요구로 재사용하지 않는다.

**MUST [LOC-002]** 계산 도구는 cloc 2.08과 [cloc-systemd.lang](../implementation/cloc-systemd.lang)의 language-aware 집계로 pin한다. 기본 INI filter가 systemd의 # comment를 code로 세므로 unit만 전용 filter로 보정한다. 도구 변경은 같은 fixture suite의 분류 차이와 전체 측정 영향을 review한 뒤 명시적으로 pin을 바꾼다. version을 기록하지 않은 임의 cloc/scc/grep/wc 값을 최종 수치로 사용하지 않는다. cloc의 heuristic 한계가 발견되면 fixture와 차이를 보고하고 숫자를 줄이는 쪽으로 조용히 분류하지 않는다.

**MUST [LOC-003]** production manifest는 repository-relative 원본 파일을 한 줄 하나로 열거한다. source closure에 TS, SQL/migration, systemd template, shell/native glue, 직접 작성한 runtime config/template를 포함한다. emitted JS/동일 source에서 생성한 산출물은 중복 제외하고 code generator 자체와 직접 작성한 생성 입력은 포함한다. 수정하지 않은 upstream dependency·lockfile·문서·tests는 제외한다. test helper가 production에서 import되면 production으로 포함한다. 직접 수정한 vendor/fork code를 dependency로 숨기지 않는다.

**MUST [LOC-004]** manifest의 동일 path 중복은 거절하지만 내용이 같은 서로 다른 production source 파일은 각각 센다. cloc --skip-uniqueness로 content-dedup을 끈다. symlink로 다른 source를 중복 계산하거나 제외하지 않게 canonical source identity를 검사한다. inventory의 모든 파일은 cloc code row이거나 도구가 내린 인정된 non-code verdict로 명시 계정되어야 한다 — 어느 쪽으로도 계정되지 않은 파일, 인벤토리 밖 이름의 분류, row와 분류의 이중 계정, 인정되지 않은 verdict는 0으로 누락하지 말고 gate 실패다. 인정되는 verdict는 cloc이 내리는 non-code 판정(빈 파일·바이너리·미인식 언어·도구 자체의 non-code table·temporary editor file)뿐이고, 크기 초과·not-file·unreadable 같은 관측 이상 verdict는 분류가 아니라 실패로 남는다. production package/entrypoint dependency inventory와 manifest를 대조한다.

**MUST [LOC-005]** 아래 명령을 실제 source root에서 실행하고 `SUM.code`를 최종 LOC로 사용한다. file별 language/code/comment/blank와 manifest/content hash도 기록한다. 아래 path는 build 검증 산출물이며 runtime S/R allowlist를 확장하지 않는다.

```sh
cloc --version
cloc --list-file=production-files.txt --by-file --skip-uniqueness \
  --read-lang-def=implementation/cloc-systemd.lang \
  --json --out=production-loc.json
```

**MUST [LOC-006]** 위 전용 언어의 `in` mapping은 manifest에 포함한 systemd .in template에만 적용한다. 다른 종류의 .in 입력은 올바른 언어로 별도 분류·집계하고 합계를 대조한다. systemd의 section/directive는 code이고 독립 #/; comment는 comment다. 코드와 주석의 혼합 줄, block comment, 문자열 내 comment-like text, SQL/unit template, 동일 내용 두 source의 fixture를 유지한다. unknown language를 전체 text로 세거나 파일을 누락하는 fallback은 금지한다.

**MUST [LOC-007]** minify·세미콜론으로 한 줄에 몰기·큰 source를 문자열 데이터로 숨기기·manifest 누락으로 측정을 왜곡하지 않는다. formatter/style을 유지한다. 실제 production repository를 측정하지 않았는데 spec 선언/예제의 LOC를 Core 구현 LOC로 보고하지 않는다. LOC 값 자체는 release 조건이 아니다.

**MUST [LOC-008]** 재현 fixture는 [tests/loc-fixtures](../implementation/tests/loc-fixtures)에 있다. 해당 디렉터리에서 `cloc --list-file=files.txt --by-file --skip-uniqueness --read-lang-def=../../cloc-systemd.lang --json`을 실행하면 4개 파일의 SUM.code=7이어야 한다. 이 수치는 production LOC가 아니다.

## 현재 측정 상태 — 비규범적 기록

현재 수치는 [validation.md](implementation/validation.md)가 소유한다. 수치는 informational이며 크기 gate는 없다. 원본·도구·측정 결과의 불일치는 크기와 무관하게 검사 실패다.

`scripts/loc.mjs`는 선언된 `production-manifest.json` 범위를 실제로 순회하고 pinned cloc로 산출물을 생성하는 경로로 유지한다. 파일 목록·합계·내용 hash를 사람이 새 측정처럼 손으로 재작성하지 않는다. TUI 및 제품 표면 source도 같은 manifest로 측정한다. proof source closure와 LOC 집계 대상은 서로 다른 집합이다.

## Qualification 계약

아래는 보존하는 SP 요구 조건이다. 제목의 OPEN·미확정을 현재 판정으로 읽지 않는다. profile별 채택·비활성 선택의 이유는 DR, 실제 실행 판정은 validation이 소유한다. 과거 probe와 실험 출력은 [qualification 원문](archive/qualification-before-consolidation.md)에 분리했다.

**MUST [SP-001]** 이 파일은 [구현 계약](implementation-spec.md)의 일부다. 각 항목은 [DR18](design-revisions.md)이 판정했다(항목마다 "DR18 판정" 줄). 판정은 v1이 하는 것(증거와 함께)과 하지 않는 것(알려진 미지원 설정으로 거절한다)을 정한다. 하지 않는 것의 MUST 항목은 그 기능을 더할 때의 진입 조건으로 남는다. 이전 primitive 실험이나 문서 열람은 아래 실행 검증을 대신하지 않는다. 이 파일은 runtime state가 아닌 구현 검증 기록이다.

**MUST [SP-002]** 각 spike의 산출물은 `검증한 versions/config`, `실행 가능한 최소 harness`, `명령과 raw 결과`, `fault/negative 결과`, `선택한 좁은 adapter 계약`, `상위 architecture와의 차이 유무`다. 산출물은 tests/검증 문서에 보관한다. 성공한 것처럼 채운 signature·mock·boolean은 통과 증거가 아니다.

**MUST [SP-003]** 실패 시 해당 profile/경로를 차단하고 이유를 반환한다. 아키텍처 변경이 필요한 결과는 제안만 하며 이 spec의 근거 없는 확정으로 바꾸지 않는다. 아래 기재한 후보는 선택이 확정된 설계가 아니다.

## S-01 — Linux / Node / native execution / sandbox substrate

**MUST [SP-01-T]** DR49의 foreground native 경로로 broker+runner+bwrap를 시작해 다음을 실행한다: Pi echo/tool, 동일 UID 타 actor 연결 시도, 직접 admin socket 접근, namespace PID와 host PID 매핑, actor exit 직후 PID 재사용 stress, grandchild process 생성 후 stop, FD enumeration, host home/bus/network 접근, tmp cap 및 persistent workspace/storage cap 초과. race 때문에 identity를 확정할 수 없으면 fail closed 결과가 나와야 한다.

**MUST [SP-01-A]** 해당 incarnation의 실제로 pin된 execution scope 후손만 actor listener를 사용할 수 있고 타 actor·host arbitrary process·stale run은 거절해야 한다. READY 전 요청은 접수하지 않는다. 필요한 native containment primitive/bwrap 미지원 환경은 UNSUPPORTED_PROFILE이어야 한다. Darwin은 G-PROCESS/G-FILES/G-AUTH 미해결 상태에서 지원 완료로 판정하지 않는다. 최소 native leaf를 쓰면 TS application 경계/LOC에 반영한다. userns-try·UID-only 인증·host network fallback은 금지한다.

## S-02 — 기존 Principal Pi의 host/private 경계

**MUST [SP-02-T]** 기본 shell/read/write/edit, alias, 추가 extension tool, subtool, custom provider hook, 경로 traversal/symlink를 각각 실행한다. model에게 attach credential·session 파일 읽기를 요청해 거절을 확인한다. duplicate attach와 UI 종료/재연결을 반복하고 commons 100개와 principal 질문 1개를 보낸다.

**MUST [SP-02-A]** Human history는 기존 session에 유지되고 commons 자동 주입은 0건, principal 질문은 동일 session에만 전달되어야 한다. UI 부재 동안 Astra 호출은 0건이다. tool 하나라도 host로 우회하면 profile 출시를 막는다. 별도 SOTA worker 생성으로 우회하지 않는다.

## S-03 — Pi 실시간 알림과 durable batch 경계

**MUST [SP-03-T]** tool 두 개가 실행 중인 Pi에 direct 질문을 넣고, 두 tool 결과가 모두 보존된 다음 inference에 custom notice가 포함되는지 확인한다. 별도 public followUp도 넣는다. 첫 batch가 끝나기 전에 두 번째 질문, context update, stop/abort, UI reconnect를 주입한다. batch prepare 전/후, cur 이동 후, custom notice 전/후, tool effect 후, agent_end 직전/직후, session 저장 전/후, DB complete 전/후에 kill한다.

**MUST [SP-03-A]** 각 notice의 immutable message ID snapshot과 정상 boundary 귀속을 증명하고, 미확정은 동일 ID로 재안내한다. tool result 유실·자동 tool replay·미완료 mail 영구 누락은 0건이어야 한다. 모델이 writable session JSON을 바꿔 trusted completion을 위조하지 못해야 한다. 오래된 incarnation의 complete는 거절해야 한다.

**MUST [SP-03-D]** 통과 결과로 PiAdapter의 실제 import/signature, prepared batch 동시성, 클래스 분리, completion receipt 필드/flush 순서, FIFO와 fairness의 적용 시점을 확정한다. 여섯 entity와 prepared/completed 의미 안에서 증명이 안 되면 상위 architecture 검토로 올린다. 임의로 `active/queued/thinking/reviewing` state, notice event log, cognitive checkpoint를 추가하지 않는다. 모든 busy mail을 agent_end까지 미루는 타협도 조용히 확정하지 않는다.

## S-05 — hostile bundle / canonical object import

**MUST [SP-05-T]** prerequisite 있는 작은 incremental bundle과 full bundle을 만들고 exact C peer fetch를 확인한다. 누락 prerequisite, 추가 main ref, exported C 불일치, malformed pack, object hash 손상, excessive expansion/depth, symlink staging, hook/config injection, interrupted import, published ref 충돌을 주입한다. quarantine은 network 없는 제한 sandbox로 실행한다.

**MUST [SP-05-A]** invalid input은 canonical ref를 바꾸지 않으며 검증된 reachable C만 게시할 수 있어야 한다. canonical objects를 읽는 quarantine은 RO이고 Resident는 canonical objects에 쓰지 못한다. publish 후 crash에도 object/ref 연결성이 유지되어야 한다. 사용한 Git versions/object formats별 정확한 argv/env·fsync 설정을 기록한다.

## S-06 — durability / native execution races / storage qualification

**MUST [SP-06-T]** test matrix의 process kill 지점을 실제 subprocess kill로 실행하고, 별도 VM/지원 fault 환경에서 write ordering·abrupt power loss·ENOSPC·read-only remount를 시험한다. accepted receipt를 외부 harness에 기록한 뒤 reboot 결과와 대조한다. stop 중 mail 도착, 마지막 idle check 뒤 mail 도착, start-limit, broker crash, principal offline backlog를 실서비스로 반복한다.

**MUST [SP-06-A]** 지원 profile의 accepted message/operation은 복구 가능하고 false-success가 없어야 한다. cur에 있는 미완료 mail이 유실되지 않고 stopped agent가 inference하지 않아야 한다. resource cap·fsync의 보장 범위와 미지원 filesystem을 명시한다. SIGKILL test만으로 power-loss passed라고 표시하지 않는다.

## S-07 — OPTIONAL notmuch / reflink / egress

**MUST [SP-07-A]** notmuch rebuild/손상/old index 후에도 archive path가 직접 열리고 routing에는 영향이 없어야 한다. reflink 불가면 독립 clone으로 fallback하며 hardlink하지 않는다. egress는 Human 설정 endpoint 외 연결을 거절한다. 기능별 결과가 없으면 각각 꺼 둔다. 새 index daemon은 기본으로 추가하지 않고 기존 reconcile이 제한된 index subprocess를 요청한다.

## S-08 — base optional / tiered required attestation gate

**MUST [SP-08-A]** 동일 actor 중복/자식 생성/다른 base/candidate/policy 재사용/자연어 위조/Human channel 위조를 거절해야 한다. 필요한 추가 entity는 architecture에 이미 허용된 attestation 범위만 사용한다. 결과가 없으면 기본 profile의 protected path 거절을 유지하고 approve/object/revoke를 노출하지 않는다.

## S-09 — 성능 목표와 모델 사용성 수용 기준

**MUST [SP-09-T]** strong 단독/cheap 단독/hybrid에 같은 repository snapshot과 tools를 제공하고 반복한다. quality/defect/omission, Principal 및 전체 tokens/cost, latency, commons의 Principal 유입 건수, 경로/ID lookup 실패, 첫 유용한 행동까지 tool 수, Principal 재검증 비용을 기록한다.

**MUST [SP-09-A]** 값은 task별·반복별로 남기고 목표 미달도 공개한다. production runtime correctness gate와 '성능 목표 달성' 주장을 구분한다. S-09 gate는 평가 protocol과 결과 제출을 필수로 요구하며, 미달 결과를 성공으로 바꿀 권한은 없다. 성능 목표를 release acceptance로 삼을 정확한 threshold는 사용자 합의 전까지 미정이다.

## S-10 — tiered challenge + persistent floor

**MUST [SP-10-A]** S-10이 닫히기 전 tiered integration을 활성화하지 않는다. challenge 또는 floor를 process-local cache, caller boolean, 자연어 mail, 임의 DB column으로 대체하지 않는다.

## S-11 — OPTIONAL fresh clean-room verifier

**MUST [SP-11-A]** S-11을 선택하지 않은 base/tiered profile에 verifier state/API를 추가하지 않는다. 선택하는 profile은 fresh verifier가 기존 writable session이나 caller-supplied verdict를 authority로 받아들이지 못함을 증명해야 한다.

## Fixture layers and verification scopes

A fixture's name does not enlarge its verified boundary. Independent expected
values must not be computed by the production planner under test.

| Layer | Existing entry / example | What is actually established | Not established |
|---|---|---|---|
| Shape | `makeValidResolvedSpec`, `makeValidAgent` in `spec.ts`; primitive constructors in `valid.ts` | Complete resolved-spec shape is checked by `resolvedSpecCheck`; owned hashes are paired with their bytes. `r32-fixture-contracts.test.ts` round-trips selected records. | Host configuration, accepted ledger relation, current peer authority, installed runtime |
| Complete HostConfig | `createCompleteConfigurationFixture()` in `configuration.ts` | Writes a complete inline config, runs the actual split script, calls `loadConfiguration` on BOTH inputs, compares assembled host values before returning | Deployment attestation, credentials, running broker/runner, working rootfs/provider |
| Live Store/Mail | `mail-harness.ts` seed/send subprocess; `lifecycleReplayFixture()` in `lifecycle-replay.ts` | Real SQLite Store/decoders and actual Mail/Lifecycle paths where called; normal agents decode before fault injection. `ObservedUnits.effects` records controlled unit requests. | Socket/peer authentication and actual scope death; lifecycle replay explicitly substitutes admission/goal/execution observations |
| Scenario (scripted model) | `scriptedProvider()` in `scripted-provider.ts`; `startScenario()` / `withScenario()` in `scenario.ts`; suites `scenario-principal`, `scenario-society`, `scenario-confined` | The whole loop with only the model scripted: provisioning, Store, mail, the broker composed as `entry/broker.ts` composes it (Git, lifecycle with the product's child-spec resolver), the product's PrincipalSession with the bundled engine and trusted extension, the CLI it starts, PrincipalDelivery, and createNativeResidents/ExecutionRuntime launching the product's runner through a real PID namespace, pinned PID2/private socketpair and durable scope journal. The Worker remains confined under bubblewrap with the relay and a TLS scripted provider; missing bubblewrap is explicit NOT_RUN, never host execution. Assertions are on ledger rows, mailbox files, receipts and session history | Real external provider behaviour, streaming or retries (the engine's, INF-001); Darwin's unresolved gates and power loss. The host's Principal registration channel and model replies remain scripted; scope/auth/death are not mocked. Not provider evidence (P0-5) |
| Installed runtime | `P02: installed broker refuses deployment mismatch BEFORE SQLite or unit effects` in `p24-deployment-gates.test.ts` | Copies built runtime/raw assets, borrows this checkout's node_modules, invokes real broker entry and checks refusal before SQLite/socket effects | Standalone production-only install, positive society startup, positive native scope/engine/provider and power-loss qualification. Those require WP03/27/30/31 evidence |

`r38-package-layout.test.ts`'s **layout-only** empty-file fixture is NOT the
installed-runtime layer. A fake deployment digest or empty extension export in
a complete configuration is deliberate host-contract data, not a deployment pin.
Do not start a society using `createCompleteConfigurationFixture()` as-is.

## Complete configuration example

```ts
const fixture = createCompleteConfigurationFixture();
try {
  // Constructor has already exercised both complete production loaders.
  const before = loadConfiguration(fixture.path);
  fixture.edit("roles/resident.json", role => {
    role.agentProfile.upstreamNote = { defaultMode: "DIRECT" };
  });
  // `edit` is an unchecked authoring/corruption seam, never a valid-candidate claim.
  const after = loadConfiguration(fixture.path);
  // Assert expected semantics/bytes independently of the loader's own helpers.
} finally {
  fixture.close();
}
```

The helper is the extracted `operations-config.test.ts` fixture, not a second
production configuration builder. All existing migration/startup-selection cases
remain in that test. `config-bundle-owner.test.mjs` now consumes it and checks the
complete loader before and after the actual Extensions write; containment-only
assembly is no longer presented as a product-valid positive control.

V02A corrupts a validated baseline explicitly: missing quota, missing resource,
and an unresolved model relation must be rejected in both inline and operations
formats. A fixture returning invalid data must fail before its intended test.

## Receipt and failure terminology

`receipt-supersession.test.mjs` concerns **CLI cached operation receipt
observations**, not Runner/Principal delivery receipts, engine session flush or
batch SQL settlement. Its physical-cache tests complement the pure ordering table;
do not use the production `receiptSupersession` return value as a concurrency oracle.

A `DurabilityFaultError` can preserve leaf artifacts by bypassing cleanup, but an
exception is not process death. In-process `mail-faults.ts` callers get a thrown
`StopSignal` that runs through workflow cleanup; only the child `mail-harness.ts`
passes `halt` and stops at the checkpoint itself, like `crash-worker.ts`. SIGKILL plus an observed checkpoint still is not
VM/storage power loss. Retired systemd/VM suites remain archived; the current native
suite includes its declared Linux execution regressions without those exclusions.

## Effect and checkpoint APIs

- `observeFile(path)` returns physical SHA-256/inode/device/link count/mode.
  Read errors propagate; unavailable is not absent.
- `observeLedger(path)` uses a separate read-only SQLite connection and explicit
  SQL to observe committed agent/operation/batch/delivery relations, not Store
  projections or production planner output. Use only finite, owned fixture DBs.
  A read-only SQL connection can still create/update WAL/SHM; it is not a
  side-effect-free filesystem observer for compatibility-refusal tests. V04A uses
  `observeFile` without opening SQLite to compare the rejected artifact inventory.
- `ObservedUnits.effects` records controlled requests, not real systemd effects.
- `Engine.events` in the Principal endpoint fixture records actual stand-in
  engine IPC responses; the delivery test counts prompt responses across a later
  tool-reply barrier. It is not real-model persistence proof.
- `killAtCheckpoint(workerURL, args, point, timeoutMs)` requires the named IPC
  message and confirmed SIGKILL. Default checkpoint deadline 10s (max 30s),
  additional reap deadline 2s, stderr cap 32KiB. Only its direct child is killed.
  If `CheckpointFailure.terminationConfirmed` is false, preserve the fixture root.
  A message alone does not prove an effect: pair it with a fresh process observer.
- `failure-matrix.ts` contains independent literal phase/preservation expectations.
  `checkpoint-worker.ts` uses the production durable leaf seam; existing
  `crash-worker.ts` supplies local Mail acceptance and Git published-ref cases.
  `checkpoint-observer.ts` starts separately and reads physical/SQL/Git facts.
  Diagnostics retain checkpoint pid, observer pid, checksums/inodes, operation
  identities, message manifests and incarnations in raw test output.

## Stable plan IDs / actual cases

| Plan ID | Actual source / case | Lane / scope |
|---|---|---|
| V01A / V01B | `consistency-decisions.test.mjs` named V01A/V01B cases | fast, all; document/contract decisions only |
| V02A | `operations-config.test.ts` six V02A corruption controls; existing migration case; `config-bundle-owner.test.mjs` loader-before/after editing | fast, all; complete production loader and editor composition |
| V02B | `checkpoint-driver.test.ts` V02B cases | durable, all; real local direct-child SIGKILL and fresh FS/SQLite/Git observer, not systemd/VM |
| V02C | `effect-observation.test.ts` raw SQL/Mail replay and controlled unit cases; `verification-policy.test.mjs` lane-ID rejection | property (effects), fast (policy), all; independent literal/physical oracles |
| V02C negative restoration | original incomplete bundle fixture plus exact full-loader assertion in disposable worktree; corrected main-tree positive control | external source-bound WP02 raw logs, not a new CI pass |
| V04A | `store-open.test.ts` named V04A unsupported-version, sidecar, alias, corrupt-header and supported-v1 cases | durable, all; actual Store/native SQLite plus independent artifact identities/bytes; closed/quiescent startup scope |
| V04B | `store-open.test.ts` named V04B new/v1 PRAGMA, migration, reader-composition, cleanup-cause, permission and lock cases | durable, all; native handle closure and independent writer-lock observation, not manager or read-only-mount qualification |
| V11A | `config-editing.test.ts` named V11A inline/split and compatibility-writer cases | durable, all; actual production validator/editor and independent authored-file hashes |
| V11B | `config-edit-descriptors.test.ts` plus `config-edit-descriptors.types.ts` | fast, all; runtime own-key registry plus actual TypeScript exhaustiveness fixture |
| V11C | `config-validation.test.ts` named V11C deep snapshot, zero-seed and frozen Store identity cases | property, all; actual validator/Store/config edit paths, not managed-generation persistence |
| V17A / V17B | `preaccept-scope.test.ts` named V17A/V17B cases; existing `preaccept-ownership.test.ts` compatibility cases | durable, all; actual ownership scope, inode identity, Store relation and native preparation observation; not crash-recovery memory proof |
| V05A / V05B | `delivery-receipt-publication.test.ts` named cases plus Principal first-fact case in `principal-endpoint.test.ts` | durable, all; actual held-directory publication, fault seam, private mode and caller return contract; not VM/storage power-loss V05C |
| V12A / V12B | `config-snapshot.test.ts` named cases | durable, all; actual one-manifest snapshot, authored identities, index-root prompts and aggregate closure budgets; manual-source drift detection is not external-writer exclusion |
| V18A | `preaccept-ownership.test.ts` named V18A order, nine unaccepted failure points, lost acknowledgement, unavailable observation and native-uncertainty cases; `r21-context-stream.test.ts` V18A replacement case plus strengthened R21 root cleanup | durable, all; actual GitModule/ContextCoordinator, Store, MailModule, Git preparation executor and staged filesystem; injected member faults, not process crash |
| V18B | `r21-context-workflow.test.ts` named V18B case | durable, all; actual RpcConnection with the broker staging root, same-key retry through a second connection and reconcile from the staged candidate; not broker restart or VM power loss |
| V06A | `receipt-observation.test.ts` named V06A runner/live-endpoint decisions and observer cases; `receipt-settlement.test.ts` V06A recovery decisions | durable, all; actual observer, RunnerModule consume (engine and channel replaced by counters), MailModule live completion and recovery settlement over a complete Pi v3 session fixture |
| V06B local | `receipt-settlement.test.ts` named `V06B local` cases | durable, all; actual InternalDispatcher, PeerAuthenticator, RunRegistry fencing and recovery settlement with controlled cgroup pins and unit observation; the kernel-lane V06B (real systemd/cgroup stale runner) is not claimed |
| V19A / V19B | `preaccept-ownership.test.ts` named V19A bootstrap and V19B create cases | durable, all; actual LifecycleModule/CreateCoordinator, Store, MailModule and Git workspace with injected freeze/refresh faults and a no-op unit install for the race winner; not systemd activation |
| V20A / V20B | `mail-submit-scope.test.ts` named V20A mail/submit freeze and retry cases and V20B recovery cases | durable, all; actual MailModule, materializer, reconcile, GitModule submit with a real repository, Store and filesystem; fsync EIO, cleanup EIO and gated ref publication are injected, inbox unavailability is chmod-based; not a process crash or VM power loss |
| V21A | `method-resource-categories.test.ts` named V21A cases | fast, all; actual descriptors, category lookup and Broker/public dispatcher over a one-byte storage quota; not a wire-schema change |
| V21B | `action-admission.test.ts` named V21B cases | durable, all; actual Broker, both dispatchers, MailModule, LifecycleModule, ReconcileModule with the production storage gate and GitModule submit; unit control is scripted, faults are an injected SQLITE_FULL and a ref conflict; not systemd, real disk exhaustion or the WP22 settlement reserve |
| V22A | `storage-reservation.test.ts` named V22A cases | stress, all; actual Broker transport (serveFrames/RpcConnection over a scripted socket), TransportSpool, GitModule submit and the production tree observer with a fixed quota placed by a sparse pad; `StorageAdmission` lease units; not kernel quota or provider load |
| V22B | `settlement-headroom.test.ts` named V22B cases | durable, all; actual Broker, dispatchers, MailModule, LifecycleModule, ReconcileModule sharing the broker storage owner; a measured maximal mail settlement; a real size-limited tmpfs filled to ENOSPC inside an unprivileged user+mount namespace (`unshare -rm`); not VM/storage power loss or a hard filesystem quota |
| V24A / V24B | `git-effect-evidence.test.ts` named V24A (SHA-1 and SHA-256) and V24B cases | durable, all; actual GitModule integrate/reconcile over real bare repositories, a real submit publication and a real third main writer; faults are a one-shot unavailable main observation and a lost success record; not kernel check execution (checks stay gated) |

`npm test` includes all these local cases; it still excludes the original mixed
systemd files. Actual lane execution is separate and must be recorded as such.
Throw-only, missing/wrong checkpoint, silent timeout and lying-message controls
do not qualify as successful death/effect observations. Setup/import errors and
skipped/cancelled/todo results are never treated as product regressions or PASS.

## 검증 기록 규칙


**MUST [VAL-001]** 다음 결과의 범위를 구분한다. 초기 설계 검증 결과를 실제 runtime 구현 또는 S-01~09(+S-01-CANDIDATE) 통과로 인용하지 않는다.

**MUST [VAL-002]** 구현 시작 시 [spikes.md](verification-spec.md#qualification-계약)의 OPEN 상태를 유지하고 실제 harness 결과로만 갱신한다. [test-matrix.md](verification-spec.md#oma-core-v1--검증-계약)의 77개 항목은 구현해야 할 수용 계약이며 현재 통과한 runtime suite가 아니다.

**MUST [VAL-003]** Phase 0-9의 초기 설계 검증은 기존 저장소 코드를 읽거나 재사용하지 않고 설계 디렉터리와 별도 임시 fixtures에서 수행했다. Phase 10 이후 runtime audit은 명시한 HEAD와 현재 저장소에서 별도로 실행하며, 두 결과를 하나의 검증 결과로 합치지 않는다.

**MUST [VAL-004]** 현재 저장소의 runtime 결과를 갱신할 때는 반드시 `git rev-parse --short HEAD`, `npm test`, `node scripts/loc.mjs`의 출력과 실행 날짜를 함께 기록한다. 이전 commit의 test 수나 LOC를 현재 결과로 재사용하지 않는다.

**MUST [VAL-005]** 과거 `loc.mjs`의 non-empty physical line 결과는 legacy 기록이다. 현재 `node scripts/loc.mjs`는 cloc 2.08 및 OMA systemd filter로 code lines를 계산하며 이 값만 현재 A-009 수치로 사용한다.
