# OMA Core v1 — 검증 계약

**MUST [TEST-001]** 각 행은 구현해야 할 test case다. `Given → When → Then`의 Then은 oracle이며 구현 내부 함수 호출 횟수만으로 대체하지 않는다. 모든 test는 production과 같은 schema/codec/CLI boundary를 사용한다. isolated fixture 외 사용자 checkout/systemd unit을 수정하지 않는다.

**MUST [TEST-002]** fault injection은 test-only boundary hook 또는 외부 kill harness로 구현한다. production에 관리자용 arbitrary failpoint IPC를 추가하지 않는다. 실서비스/process tests와 mocked primitive tests를 결과에서 분리한다. test source는 LOC budget에서 제외하지만 production이 test helper에 의존해서는 안 된다.

## Runtime suite alignment

**MUST [TEST-006]** T01–T77은 normative acceptance contract다. 현재 `npm test`의 총 test 수가 77과 다르더라도 이 표의 행을 삭제하거나 다른 의미로 재분류하지 않는다.

**MUST [TEST-007]** runtime suite의 test 개수와 PASS/FAIL 수치는 [validation.md](validation.md)에만 기록한다. suite 총 개수는 T01–T77 acceptance coverage와 동일하지 않으며, 보조 회귀 test의 통과는 대응하는 acceptance 행의 미실행 oracle을 자동으로 충족하지 않는다. 과거 test count를 현재 source의 결과로 재사용하지 않는다.

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

**MUST [TEST-008]** 아래 행은 [spec §18](../implementation-spec.md)의 제품 표면 요구와 [§19](../implementation-spec.md)의 tool 표면 투영 요구에 대한 수용 계약이다. T01–T77은 Core, T78–T90은 tiered 확장이 예약한 대역이므로 제품 표면은 **T91부터** 사용한다. 화면 렌더링 스냅샷 비교로 oracle을 대체하지 않는다.

| 대역 | 범위 |
|---|---|
| T91–T98 | TUI 경계·화면·설정 쓰기 |
| T99–T103 | Extension tool 표면 투영 |
| T104–T106 | extension digest 재검증, 엔진 동봉, 설정 없는 기동 |
| T107–T108 | 엔진 프리미티브 소유 경계, spawn 경로 대칭 |
| T109–T110 | 제품 표면의 적대적 입력, core 결합 |
| T111–T113 | 실제 프로세스 경계: SIGKILL, TTY, 엔진 투영 |
| T114–T119 | Principal 권한·credential 경계와 실제 tool·delivery 경로, 감독·재시작·orphan, 제품 표면의 bounded 읽기, CI lane·측정 증거의 정직성, 진입점 배선 |

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
| T114 / TUI-004, AUTH-003, IPC-011, PR-001, PR-002 | 실제 broker와, 실제 trusted extension을 로드하고 host의 socketpair를 받은 stand-in engine, 그 engine이 띄우는 실제 CLI → host의 자식이 아닌 engine 등록은 거절, credential은 어떤 파일·engine 환경·CLI 환경에도 없고 socket으로만 도착하며 `/proc`으로 다시 열 수 없다. 올바른 credential·handle을 가진 비자손 프로세스의 attach는 `AUTH_FAILED`, 다른 handle은 `ATTACH_CONFLICT`, 재등록과 broker 교체 뒤의 이전 credential은 무효. OMA tool 네 개가 engine에서 동작하고, Principal에게 온 mail은 idle session에 전달돼 receipt와 함께 완료되며, boundary 없이 끝난 turn은 back-off 뒤 재전달된다. engine의 자식이나 model 쪽 연결은 batch를 준비·완료할 수 없다 . session 소유권은 무엇을 쓰기 전에 예약되며 그 단위는 engine의 agent run이다 — delivery 중 입력한 Human prompt는 engine의 follow-up queue가 아니라 host에서 순서대로 대기하다 run이 끝나는 그 단계에서 쓰이고, run 하나에 `agent_settled`가 하나뿐이어도 대기 중이던 prompt가 각각 한 번씩 순서대로 실행되며, engine이 수락 전에 거절한 prompt는 예약을 돌려주고 화면에 이유가 남는다. 수락된 뒤 전송이 실패한 prompt는 대기열 가운데 어느 것이었는지 원문과 함께 보고되고(이름 없는 실패 보고는 대기 중 두 번째 prompt를 특정하지 못해 실패), 그 뒤에 대기하던 prompt는 순서대로 계속 전송된다. 실패 사유는 문장이 아니라 원인만 실려 오고, 화면은 원문이 어디에 남았는지를 사유보다 앞에 두어 4,000자짜리 사유로도 그 답이 화면 폭 밖으로 밀리지 않는다(순서를 되돌리면 실패). settle되지 않은 delivery와 보고되지 못한 boundary는 각각 예약과 claim을 돌려주고, 실패한 assistant message 하나는 delivery를 끝내지 않으며 run이 settle될 때 판정한다. host가 들고 있는 prompt 수에는 상한이 있어 넘으면 거절하고 알리며, session이 일하는 중인지에 대한 보고는 소유권 이동에서만 나오므로 frame을 넘겨 전송조차 못 한 prompt도 화면을 busy로 남기지 않는다. host endpoint가 서빙하지 않는 method는 `UNKNOWN_METHOD`이지 거절된 host가 아니다(IPC-012). host는 pid가 아니라 시작 시각까지 고정한 identity로만 delivery를 받고, broker가 멈추면 supervision channel도 놓는다. Principal session은 `principal/private` 아래에 남는다(PR-003) |
| T115 / TUI-002, PR-001, LIFE-006 | supervisor와 channel을 말하는 stand-in broker → 준비 신호 전에는 등록 불가, 등록은 broker가 만든 credential을 돌려주고 거절은 즉시 응답, 응답 없는 broker는 한도 안에서 부재, 다른 host의 broker는 준비·credential 없음, 예기치 않게 끝난 broker는 재시작돼 새 credential로 재등록되고 재시작은 한도가 있다. 실제 supervisor를 돌리는 host 프로세스를 SIGKILL하면 실제 supervision channel을 쓰는 broker가 host 부재를 이유로 스스로 끝난다 |
| T115 / TUI-011 | 심볼릭 링크·디렉터리·헤더 한도를 넘는 메시지가 섞인 Maildir → Mail 화면 읽기 → 링크는 따라가지 않고 파일 전체를 버퍼링하지 않으며, unread 수와 목록의 unread 행 수가 같고, 정렬은 파일 이름이 아니라 도착 시각을 따른다 |
| T116 / VAL-002 | CI workflow 원문과 lane 정의 → 정적 대조 → 어떤 lane도 자기 예산보다 먼저 죽지 않고, job 시계도 포함한 check들의 합보다 먼저 울리지 않으며, runner가 제공하지 않는 systemd lane은 NOT_RUN으로 기록되고, 봉인 시험이 필요로 하는 도구는 설치되며, 생성기 이전에 관측한 stale inventory가 실패로 남는다 |
| T118 / TUI-021 | broker가 실제로 기록한 status view와 제품의 reader → 같은 파일을 양쪽에 통과 → writer의 출력이 reader에 그대로 받아들여지고, 선언한 한도를 넘는 view나 링크는 메모리에 올리지 않고 거절하며, 소유자만 읽을 수 있다 |
| T119 / TUI-002, PR-001, PR-002, LIFE-006 | 실제 `src/entry/oma.ts`를 통제된 모듈 경계에서 실행 → engine은 broker를 기다리지 않고 owner가 만든 환경(secret 없음)으로 시작하고, broker가 준비될 때마다 같은 handle로 등록돼 새 credential을 받으며, 거절·남의 broker·시작 실패는 화면에 이유가 남고, 크래시는 broker를 멈추고, delivery는 broker 준비 뒤와 turn이 끝날 때마다 돌고, session 디렉터리는 entry가 스스로 정하지 않고 owner가 답한 값을 그대로 넘기며, broker를 다른 프로세스가 소유한 society에서는 engine을 아예 시작하지 않고 Control Panel로 남는다 |
| T120 / TUI-002,023 | 모든 byte 경계에서 나눈 한국어 UTF-8과 CSI, supplementary·결합·ZWJ grapheme의 Backspace, ASCII·한국어·JSON escape 문자를 포함한 큰 붙여넣기와 최소 허용 `frameBytes`, 긴 transcript와 실행 중 session → terminal stream과 대화 표면 입력 → 분할 여부와 무관하게 같은 key가 되고 escape tail은 prompt로 새지 않으며 Backspace는 grapheme 하나를 지운다. 작성 중 prompt의 UTF-8 source가 16 KiB를 넘지 않고 완전한 Pi prompt JSON command도 현재 frame을 넘지 않으며, 한도를 한 번이라도 넘은 전체 prompt는 명시적 notice와 함께 0회 제출된다. Backspace로 초과 상태를 해제해야만 제출 가능하고, transcript는 모든 생산자에 대해 최근 500 논리 줄·전체 256 KiB·줄당 1 KiB이며 한 번의 append가 2000줄이어도 같은 한도를 지키고(append 수를 세면 실패), host 대기열은 16개이며 각 초과 입력은 접수 전에 명시적으로 거절된다. bracketed paste로 들어온 여러 줄은 줄마다의 제출이 아니라 하나의 draft 경계가 되고(브래킷을 벗기면 첫 줄이 먼저 제출되어 실패), 끝나지 않았거나 한도를 넘은 paste는 조각으로 전달되지 않으며, 미완 CSI는 선언된 deadline 뒤 포기되어 다음 key를 삼키지 않고, 거절된 prompt는 transcript에 0회 표시되고 원문 그대로 draft로 돌아온다. 초과 상태는 원인을 들고 있어 거절된 paste 뒤의 첫 Backspace가 Human이 입력해 둔 마지막 glyph를 지우지 않고 상태만 해제하며(원인을 지우면 `hello`가 `hell`이 되어 실패), 화면 문구도 원인별로 갈린다. clipboard가 스스로 담은 `ESC[201~`는 그 뒤의 개행으로 앞의 텍스트를 제출하지 못한다 — 같은 read에 남은 byte는 그 paste의 내용이 되고(그 read가 또 다른 끝 표시를 반쯤 맞춘 채 끝나면 그 byte들도 내용으로 돌아오며, 되돌리지 않으면 clipboard 텍스트가 사라져 실패), 주입된 clock으로 관측한 paste 종료 후 burst 안의 Enter는 개행이며 burst가 지난 뒤에는 다시 Enter다(negative control). read 경계에서 잘린 code point는 선언된 deadline을 보고하고, 포기될 때 U+FFFD가 아니라 아무 문자도 남기지 않으며 그 다음 byte는 자기가 시작한 key가 된다 |
| T117 / R35, A-008 | skip·todo·cancelled가 섞인 실행 요약, 그리고 행·SUM·cloc 버전이 서로 맞지만 숫자는 위조된 측정 산출물 → 대조와 고정 버전 cloc 재측정 → 실행하지 않은 test가 하나라도 있으면 suite는 통과가 아니고, 재측정 값과 다른 LOC는 거절되며, 재측정하지 못한 결과는 `SOURCE_BOUND`로 부르지 않고, validation 기록이 인용하는 수치는 산출물과 같다 |
| T106 / TUI-017,019 | 설정 없는 빈 프로젝트 디렉터리 → `oma` 실행 → 초기화 명령 없이 society를 디렉터리에서 유도하고 실제 설정 파일 생성; 생성값은 bounded하고 Control Panel에서 수정 가능; Resident에 `code.integrate` 없음; 사용자 `~/.pi` 참조 0건 |

**MUST [TEST-003]** default core에서 T01–T74 및 T77을 적용하고, T75/T76은 해당 optional 활성 시 필수다. S-03 등 미결정 gate 때문에 test oracle의 version-specific 부분을 완성할 수 없으면 test를 skip해서 release 통과로 계산하지 않는다.

**MUST [TEST-004]** T18–T22/T27/T30/T39/T57/T58/T63/T66은 최소 각 지정 경계에서 process kill을 실행한다. assertion은 externally visible accepted receipt, DB rows, file hashes, Git OIDs, actual cgroup, Pi captured event sequence를 사용한다. '함수를 호출했다'는 mock assertion만으로 crash test 통과를 선언하지 않는다.

**MUST [TEST-005]** [contracts.type-test.ts](tests/contracts.type-test.ts)를 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes와 noEmit으로 검사한다. 모든 mutation의 request 필수, public method 분류의 완전성·배타성, read/wait의 top-level request 금지, agent.create의 profile/capabilities 입력 금지 및 ResolvedAgentSpec 변수의 wire 입력 거절을 유지한다. 이 compile-only 회귀 검사는 T05/T13의 runtime validator 검사를 대체하지 않는다.
