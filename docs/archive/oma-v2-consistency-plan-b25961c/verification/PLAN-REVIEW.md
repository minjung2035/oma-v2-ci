# 계획 작성 후 교차 검토 기록

이 문서는 제품의 테스트 결과가 아니다. 계획 내부의 지시 충돌을 검토하면서 반영한 내용을 적는다.

| 교차 검토 사항 | 계획에 반영한 구체적 결론 |
|---|---|
| Batch identity와 메시지 순서 | messageIds는 원래 순서를 포함한 exact manifest이며 편의상 sort하지 않는다. |
| Receipt/unknown과 exactly-once | evidence 부재는 효과 부재가 아니다. notification 중복 허용과 durable operation 재실행은 구별한다. |
| 소유권 재할당과 유효 증거 | v1의 우선안은 old exact receipt 정산 후 rollover다. stale live caller 권한은 되살리지 않는다. |
| Old-run death와 새 runner | 새 unit이 active인 상황에서 같은 unit 이름의 confirmDead로 과거 사망을 추정하지 않는다. 기존 pinned old cgroup/startup quiescence가 근거다. |
| 파일 fsync와 receipt publication | final no-replace와 parent flush를 추가한다. 0444 mail publication API를 0600 receipt에 무조건 재사용하지 않는다. |
| Manual와 managed config | 수동 형식의 기존 비원자성을 계약 위반으로 단정하지 않는다. generation은 명시적 C2 개선이다. |
| Config conflict 검사 | version read/compare와 publication은 같은 managed owner의 직렬화 범위다. check-then-await는 CAS가 아니다. |
| Read vs write compatibility | 구버전 reader가 읽어도 writer는 generation을 제자리 수정할 수 있어 downgrade 쓰기를 금지한다. |
| Config closure | promptFile은 index-root 기준이다. generation ID hash가 자기참조하지 않도록 logical contents를 구별한다. |
| Native task와 cleanup | 확실한 미수락이어도 child quiescence가 불명인 자료를 삭제하지 않는다. |
| Historical lookup과 lifecycle replay | 기존 D06의 현재 관리 권한 요구를 일반적인 terminal replay 원칙으로 삭제하지 않는다. |
| Quota와 recovery | 모든 recovery를 무조건 exempt하지 않는다. 실제 새로운 effect는 다시 자원·권한 검토를 한다. |
| 진단과 권한 | async cached inactive는 current cgroup death나 admission proof가 아니다. |
| Static rule와 behavior | closed mapped type 검사와 raw file 문자열 검사와 actual runtime oracle의 증명 범위를 구별한다. |
| 의존성 그래프 | WP23은 WP25 이후다. WP01은 D03 runtime 결과를 미리 PASS로 만들지 않고 WP03 증거를 받는다. |
| 전수 검토의 주장 | 220개 경로 배정은 모두 읽음이 아니다. SCOPE_ONLY는 구현 단계에서 실제 읽기·판정해야 한다. |

기계적 검사 결과는 PLAN-QA.json에서 확인한다. 그 결과의 scope는 PLAN_STRUCTURE_ONLY_NOT_PRODUCT_VERIFICATION이고 제품 구현/시험은 NOT_STARTED/NOT_RUN이다.
