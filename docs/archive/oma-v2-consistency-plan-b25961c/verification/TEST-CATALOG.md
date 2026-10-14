# 회귀 시험 원장

총 **73개 시험 명세**. 현재 제품 실행 상태는 모두 **NOT_RUN**이다. 새 test ID이며 실제 test 파일/함수를 이미 작성했다는 뜻이 아니다. fixture·실행·관측 oracle·음성 대조군의 상세는 해당 WP에 들어 있다. 구현한 뒤 actual file/case/command/evidence를 [결과 양식](../templates/TASK-RESULT.json)에 연결한다.

**Catalog lane `engine`/`pty`는 검증 분류이지 현재 package에 `verify:engine`/`verify:pty`가 있다는 뜻이 아니다.** 실제 명령 연결은 [RUNBOOK](RUNBOOK.md)을 따른다.

| ID | 검증할 계약 | WP | lane | 현재 |
|---|---|---|---|---|
| V00A | source와 evidence 결박 | [WP00](../workpackages/WP00.md) | fast | NOT_RUN |
| V00B | 미지원 환경은 PASS가 아니다 | [WP00](../workpackages/WP00.md) | fast | NOT_RUN |
| V01A | 결정표의 완전성 | [WP01](../workpackages/WP01.md) | fast | NOT_RUN |
| V01B | 범위 밖 계약 보존 | [WP01](../workpackages/WP01.md) | fast | NOT_RUN |
| V02A | 정상 fixture가 실제 loader를 통과함 | [WP02](../workpackages/WP02.md) | fast | NOT_RUN |
| V02B | 실패 위치가 관측되는 crash driver | [WP02](../workpackages/WP02.md) | durable | NOT_RUN |
| V02C | 반례를 없앤 원본 복원이 시험을 깨뜨림 | [WP02](../workpackages/WP02.md) | property | NOT_RUN |
| V03A | custom config와 XDG roots가 runner까지 일치 | [WP03](../workpackages/WP03.md) | kernel | NOT_RUN |
| V03B | 깨끗한 계정에서 product-owned broker topology | [WP03](../workpackages/WP03.md) | kernel | NOT_RUN |
| V04A | unsupported DB refusal가 파일 상태를 바꾸지 않음 | [WP04](../workpackages/WP04.md) | durable | NOT_RUN |
| V04B | 생성자 중간 실패에서 DB/lock 수명 보존 | [WP04](../workpackages/WP04.md) | durable | NOT_RUN |
| V05A | receipt 최종 이름의 durable publication | [WP05](../workpackages/WP05.md) | durable | NOT_RUN |
| V05B | receipt EEXIST와 private mode | [WP05](../workpackages/WP05.md) | durable | NOT_RUN |
| V05C | power-loss claim 분리 | [WP05](../workpackages/WP05.md) | powercut | NOT_RUN |
| V06A | receipt 관측 네 상태 분리 | [WP06](../workpackages/WP06.md) | durable | NOT_RUN |
| V06B | historical settlement가 stale caller 권한을 되살리지 않음 | [WP06](../workpackages/WP06.md) | kernel | NOT_RUN |
| V07A | receipt 저장 직후 재시작 | [WP07](../workpackages/WP07.md) | durable | NOT_RUN |
| V07B | rollover의 모든 경계와 legacy conflict | [WP07](../workpackages/WP07.md) | kernel | NOT_RUN |
| V08A | Principal complete만 재시도 | [WP08](../workpackages/WP08.md) | durable | NOT_RUN |
| V08B | session이 바뀌거나 busy여도 역사적 정산 의미 유지 | [WP08](../workpackages/WP08.md) | durable | NOT_RUN |
| V09A | 수락 응답 불명에서 소유권 유지 | [WP09](../workpackages/WP09.md) | durable | NOT_RUN |
| V09B | 엔진 종료 시 미전송 Human 입력 복원 | [WP09](../workpackages/WP09.md) | durable | NOT_RUN |
| V09C | 중복·늦은 event가 새 owner를 해제하지 않음 | [WP09](../workpackages/WP09.md) | property | NOT_RUN |
| V10A | idle/accept/turn/drain deadline 분리 | [WP10](../workpackages/WP10.md) | durable | NOT_RUN |
| V10B | writer shutdown은 native 불명에서 lock을 보존 | [WP10](../workpackages/WP10.md) | kernel | NOT_RUN |
| V10C | registration generation과 timer 정리 | [WP10](../workpackages/WP10.md) | property | NOT_RUN |
| V11A | 유효하지 않은 편집은 저장 전 거절 | [WP11](../workpackages/WP11.md) | durable | NOT_RUN |
| V11B | field placement 완전성은 실제 compiler가 보장 | [WP11](../workpackages/WP11.md) | fast | NOT_RUN |
| V11C | snapshot의 타입·실제 validator·immutable copy 연결 | [WP11](../workpackages/WP11.md) | property | NOT_RUN |
| V12A | 한 read는 하나의 manifest snapshot | [WP12](../workpackages/WP12.md) | durable | NOT_RUN |
| V12B | 정확한 prompt root와 bounded source closure | [WP12](../workpackages/WP12.md) | durable | NOT_RUN |
| V13A | bundle commit의 원자적 visible generation | [WP13](../workpackages/WP13.md) | durable | NOT_RUN |
| V13B | legacy migration과 오래된 writer conflict | [WP13](../workpackages/WP13.md) | durable | NOT_RUN |
| V13C | retention이 live reader와 자원 한도를 함께 지킴 | [WP13](../workpackages/WP13.md) | stress | NOT_RUN |
| V14A | UI가 켠 extension은 loader가 읽음 | [WP14](../workpackages/WP14.md) | durable | NOT_RUN |
| V14B | 사라진 optional extension을 안전하게 제거 | [WP14](../workpackages/WP14.md) | durable | NOT_RUN |
| V15A | bootstrap profile의 실제 적용 시점 | [WP15](../workpackages/WP15.md) | durable | NOT_RUN |
| V15B | configured 모델과 실제 running 모델 구분 | [WP15](../workpackages/WP15.md) | fast | NOT_RUN |
| V16A | 서로 다른 프로젝트의 기본 identity 분리 | [WP16](../workpackages/WP16.md) | durable | NOT_RUN |
| V16B | 기존 society와 초기화 실패 보존 | [WP16](../workpackages/WP16.md) | durable | NOT_RUN |
| V17A | preaccept scope의 전체 자원 정리 | [WP17](../workpackages/WP17.md) | durable | NOT_RUN |
| V17B | linked acceptance가 orphan artifact 소유권은 아님 | [WP17](../workpackages/WP17.md) | durable | NOT_RUN |
| V18A | context 모든 preaccept 실패 지점의 책임 | [WP18](../workpackages/WP18.md) | durable | NOT_RUN |
| V18B | context 수락 후 연결 종료는 evidence를 지우지 않음 | [WP18](../workpackages/WP18.md) | durable | NOT_RUN |
| V19A | bootstrap 일부 준비 실패 | [WP19](../workpackages/WP19.md) | durable | NOT_RUN |
| V19B | create 정책 갱신 실패와 same-name race | [WP19](../workpackages/WP19.md) | durable | NOT_RUN |
| V20A | mail/submit same-key와 scope transfer | [WP20](../workpackages/WP20.md) | durable | NOT_RUN |
| V20B | immutable publication과 derived view 복구 분리 | [WP20](../workpackages/WP20.md) | durable | NOT_RUN |
| V21A | method category의 complete map | [WP21](../workpackages/WP21.md) | fast | NOT_RUN |
| V21B | quota가 기존 책임을 무조건 막지 않음 | [WP21](../workpackages/WP21.md) | durable | NOT_RUN |
| V22A | 예약·실제 bytes·소유권 이관 | [WP22](../workpackages/WP22.md) | stress | NOT_RUN |
| V22B | settlement reserve와 실제 ENOSPC | [WP22](../workpackages/WP22.md) | durable | NOT_RUN |
| V23A | 느린 관측 중 broker responsiveness | [WP23](../workpackages/WP23.md) | stress | NOT_RUN |
| V23B | cached observation은 authorization이 아님 | [WP23](../workpackages/WP23.md) | kernel | NOT_RUN |
| V24A | Git CAS 실패와 recovery의 역사적 사실 | [WP24](../workpackages/WP24.md) | durable | NOT_RUN |
| V24B | no-op integration의 계약 분리 | [WP24](../workpackages/WP24.md) | durable | NOT_RUN |
| V25A | 오래된 start/stop이 새 run을 제어하지 못함 | [WP25](../workpackages/WP25.md) | kernel | NOT_RUN |
| V25B | 일부 실패 후 safety cleanup과 pin 수명 | [WP25](../workpackages/WP25.md) | kernel | NOT_RUN |
| V26A | framing 분할과 accepted task 수명 | [WP26](../workpackages/WP26.md) | durable | NOT_RUN |
| V26B | CLI frozen request와 명시적 미수락 증거 | [WP26](../workpackages/WP26.md) | durable | NOT_RUN |
| V26C | 닫힌 wire와 encoded byte 한도 | [WP26](../workpackages/WP26.md) | fast | NOT_RUN |
| V27A | 동봉 엔진과 trusted extension의 실제 계약 | [WP27](../workpackages/WP27.md) | engine | NOT_RUN |
| V27B | Relay·placeholder·extension closure의 boundedness | [WP27](../workpackages/WP27.md) | durable | NOT_RUN |
| V28A | TUI의 설정·실제 상태·메일 의미 | [WP28](../workpackages/WP28.md) | durable | NOT_RUN |
| V28B | 터미널 입력·출력·복원 한도 | [WP28](../workpackages/WP28.md) | pty | NOT_RUN |
| V29A | static rule의 실제 보장 | [WP29](../workpackages/WP29.md) | fast | NOT_RUN |
| V29B | fixture 계층과 proof 범위 | [WP29](../workpackages/WP29.md) | fast | NOT_RUN |
| V30A | 독립 상태 모형과 composed runtime | [WP30](../workpackages/WP30.md) | property | NOT_RUN |
| V30B | 실제 crash와 release 환경 | [WP30](../workpackages/WP30.md) | kernel | NOT_RUN |
| V31A | 실제 배포 산출물의 closure | [WP31](../workpackages/WP31.md) | durable | NOT_RUN |
| V31B | runtime 지원 범위와 manifest 동기화 | [WP31](../workpackages/WP31.md) | fast | NOT_RUN |
| V32A | 전수 검토와 요구-구현-시험 closure | [WP32](../workpackages/WP32.md) | fast | NOT_RUN |
| V32B | 최종 source와 CI 결과의 결박 | [WP32](../workpackages/WP32.md) | fast | NOT_RUN |

## 결과 추가 규율

같은 ID에 실패와 수정 후 성공을 각각 보존한다. 기존 시험이 동일 조건을 검증하면 이름만 다른 새 파일을 만들지 말고 해당 actual case를 연결한다. README에 test count만 올리는 것은 결과 연결이 아니다. 한 Vxx에 환경/encoding/role별 여러 case가 필요한 경우 자식 case ID를 정의한다. count 자체가 coverage를 뜻하지 않는다.

명세가 잘못됐거나 source에서 반증되면 ID를 조용히 삭제하지 말고 REJECTED_WITH_EVIDENCE 또는 SUPERSEDED로 연결한다. old behavior가 의도된 계약이면 actual reference와 후속 ADR을 남긴다.
