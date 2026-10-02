# 실패·중단 경계 매트릭스

기존 leaf fault seam과 child-process checkpoint를 재사용한다. 모든 테스트는 임시 상태·승인된 격리 환경에 한정한다. 아래는 product에서 구현해야 할 시험 명세이며 **현재 전부 NOT_RUN**이다. return/throw와 SIGKILL과 VM powercut은 다른 방식이다.

| 경계 | 중단 시 남을 수 있는 사실 | 재개 시 해야 할 일 | 금지 행동 | owner WP |
|---|---|---|---|---|
| receipt temp 생성 전 | final 부재, old receipt 가능 | old exact receipt 우선 관측 | 새 전달을 무조건 시작 | 05/06 |
| receipt temp 일부 write 후 | owned private partial temp | 확실한 미게시 temp만 정리 | final로 승격·valid receipt로 읽기 | 05 |
| receipt file fsync 후 final publish 전 | 내용 durable, final 부재 | temp/final 수명과 engine evidence를 별도 해석 | temp 존재=배치 complete | 05/27 |
| final no-replace publish 후 parent fsync 전 | final 보임, power durability 불명 | final identity 검증·flush/재관측 | final 삭제·unconditionally success | 05 |
| receipt parent fsync 후 ledger complete 전 | 유효 receipt, prepared DB | receipt-only settlement | engine 재전달 | 06/08 |
| batch.complete commit 후 응답 전 | completed DB, caller는 불명 | exact idempotent replay | timestamp/result 재작성·두 번째 실행 | 06/08 |
| old receipt 정산 후 rollover 전 | old completed batch, old agent inc | 완료 보존 후 남은 작업 rollover | completed batch incarnation 변경 | 07 |
| rollover commit 후 endpoint bind 전 | new inc, endpoint 없음 | 실패 run state·권한 발행을 분리해 재개 | old peer에게 새 lease 반환 | 07/25 |
| Principal prompt write 전 | local queue만 존재 | 미전송 입력을 반환/다음 소유자 전달 | 이미 엔진이 수락했다고 표시 | 09 |
| prompt write 후 수락 응답 전 | 실행됐을 가능성 | unresolved 상태 유지·재관측/명시적 종료 | timeout만으로 free·자동 resend | 09/10 |
| accepted 후 boundary 전 | 실행 진행 또는 효과 불명 | 실제 settle/death/지원 timeout 정책 | 응답 한 번 없음=실행 안 됨 | 09/10 |
| boundary notify 후 session durability 불명 | 이벤트 관측, 저장 강도 불명 | pinned engine 저장 계약의 범위로 판정 | notification=power-loss evidence | 27 |
| config 후보 validation 전/실패 | old config만 authoritative | 거절, old 파일 유지 | 잘못된 후보 먼저 저장 | 11 |
| generation 구성 중 | old manifest, incomplete new directory | old reader 정상; owned temp만 정리 | newest-dir로 자동 선택 | 13 |
| generation flush 후 pointer 전 | complete unreferenced generation | old 또는 명시적 retry | incomplete로 오인해 live 참조 삭제 | 13 |
| pointer rename 후 parent flush 전 | visible new, durability 불명 | outcome-unconfirmed; target 관측 | 이전 pointer 무조건 overwrite | 13 |
| pointer flush 후 UI reload 실패 | committed new config | committed fact 보존·오류 표시 | 저장 실패라고 old 값으로 자동 rollback | 13/28 |
| stale edit 비교와 publication 사이 | 다른 edit가 개입할 가능성 | managed owner가 전체 critical section 직렬화 | check-then-await로 CAS라고 주장 | 13 |
| context/tree 준비 중 오류 | unaccepted owned files, child 가능 | quiescence와 정확한 ownership으로 정리 | 실행 중 child 자료를 glob 삭제 | 17/18 |
| context 후보 후 마지막 관측 실패 | staging+mail artifact, acceptance 전 | 모든 등록 자원 disposition 확인 | helper 밖 throw를 방치 | 18 |
| bootstrap 일부 freeze 후 다른 branch 실패 | partial artifact set, branch 진행 가능 | 시작한 branch를 끝내고 전체 scope 정산 | first rejection 즉시 abandonment | 19 |
| linked create transaction 후 | accepted linked row, 새 artifact는 미소유 | plan reference 기준 삭제/보존 | row 존재만 보고 무조건 retain | 19 |
| DB COMMIT 응답이 불명 | accepted일 수도 있음 | acceptance 재관측, 불명 시 자료 유지 | rollback 추정 후 evidence 삭제 | 17/20 |
| Git CAS 전 권한 변경 | intent만 있고 새 effect 미적용 | current authority 거절 및 phase 분류 | stale authorization 계속 사용 | 24 |
| Git CAS 후 terminal commit 전 | canonical effect, DB pending/unknown | physical evidence로 정산 | ref를 old base로 되돌림 | 24 |
| third canonical ref 관측 | expected/candidate 아닌 현재 값 | 보존·unknown/repair | desired candidate로 강제 overwrite | 24 |
| logical quota 초과 | existing intent와 사용량 상한 | new admission 거절, 제한된 settle/read | 모든 recovery blanket deny/allow | 21/22 |
| transport disconnect after acceptance | task와 artifact 책임 존재 | task/native 수명 끝까지 보존 | socket cleanup으로 accepted 취소 | 26 |
| unit path stop 실패 | logical stopped, 실행 여전 가능 | 나머지 revoke/service/death 조치 계속 | 첫 예외에서 cleanup 전체 중단 | 25 |
| broker/host 종료 중 child 남음 | inherited fence/pin 보유 | 실제 종료/한정된 unknown handoff | 신호 성공만으로 lease 해제 보장 주장 | 03/10/25 |
| status refresh 실패 | last observation 오래됨 | stale/unknown와 시각 표시 | idle/0으로 바꿈·권한 증거로 사용 | 23/28 |
| unsupported DB version 검사 | 기존 bytes와 schema | 규범의 비변경 검사 범위 내 거절 | 호환성 확인 전 write PRAGMA/migration | 04 |

## 관측 항목

각 행에서 checkpoint hit count, PID/exit/close/cgroup 관측의 의미, 열린 FD와 named files, old/new checksums, batch/incarnation/manifest, operation state, canonical ref, config generation, application response를 필요 범위에서 기록한다. 모든 경우 전체 state dump를 로그에 노출하지 않는다.

## Liveness 조건

유한한 실패 뒤 다시 읽고 쓸 수 있고 필요한 실제 process quiescence가 확인된 경우, 정책상 recoverable 상태가 다시 진전하는지 검사한다. 영구 손상/증거 충돌/미지원 kernel profile은 복구 가능 상태가 아니므로 자동 success를 기대하지 않는다. 이 구분을 모형에 포함해야 단지 모든 요청을 거절하는 구현이 통과하지 않는다.
