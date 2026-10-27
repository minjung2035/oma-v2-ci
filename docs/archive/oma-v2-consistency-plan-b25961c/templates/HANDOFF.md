# 작업 handoff — 작성 양식

> 아래 항목은 실제 실행 기록으로 채운다. 예시/빈 항목을 성공 값으로 간주하지 않는다.

## 식별

- WP / substep:
- 시작 commit / input digest:
- 종료 commit / input digest:
- working tree와 보존한 사용자 변경:
- 완료한 선행 WP와 승인된 ADR:
- 구현 상태: NOT_STARTED / IN_PROGRESS / CODE_COMPLETE / BLOCKED
- 검증 상태: NOT_RUN / FAILED / LOCAL_VERIFIED / RELEASE_QUALIFIED / BLOCKED

## 바뀐 의미

Fact:

Relation:

Phase / commit point:

현재 authority / owner:

지원 profile와 호환성 C0/C1/C2/C3:

## 정확한 변경 범위

| 파일·symbol | 변경 전 | 변경 후 | 왜 필요한가 | 대체·삭제한 중복 판단 |
|---|---|---|---|---|
| 실제 값 기입 | | | | |

읽었지만 바꾸지 않은 파일과 보존 이유도 기록한다. 작업 밖 수정이 발생했으면 사전 scope 변경과 그 영향 WP를 링크한다.

## 실제 시험

| 시험 ID | 실제 명령·case | source | exit | skip/todo/cancel | raw evidence | 판정 |
|---|---|---|---|---|---|---|
| 실제 값 기입 | | | | | | NOT_RUN |

production를 호출했는지, stub/model/actual engine/kernel/VM 중 어느 범위인지 명시한다.

## 회귀 감지력

수정 전 또는 최소 semantic mutant:

그때 실패한 시험과 actual assertion:

정상 positive control 결과:

## 실패·재시작·이전 데이터

commit 전후 실패 시 남는 row/file/ref:

unknown 또는 corruption에서 자동으로 하지 않는 일:

legacy 읽기/쓰기/export/rollback 결과:

## 다음 AI에게

다음 허용 WP:

반드시 유지할 API/형식/권한 조건:

shared file 변경과 merge 주의:

남은 BLOCKED/NOT_RUN, 재개 조건:

추정/미검증 내용을 검증된 결론과 분리:
