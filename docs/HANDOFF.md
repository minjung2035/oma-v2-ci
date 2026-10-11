# OMA v2 — 현재 인계 (2026-10-11, DR44)

기준은 `067bb7c`다. Human이 8.4점 정적 평가와 추가 17개 개선 후보를 제공하고 코드 품질과
구조적 변경 비용을 개선하도록 요청했다. 필수 문서·영향 owner를 직접 읽고 서브에이전트 없이
수정·검증·승인된 커밋·푸시를 진행한다. 이전 인계는 [DR43 인계](archive/handoff-before-dr44.md)에 보존했다.

Review facade에서 authority read·preparation·messages·acceptance·advancement·status를 나눴다.
ReviewAcceptance만 T를 소유한다. Integration은 미리 구성된 ReviewAuthorityReader의 작은
port를 사용하며 Review workflow를 다시 호출하지 않는다. frozen 준비 계획을 cast로 변경하던
recipient 처리와 합성 operation provenance cast를 제거했다. Principal의 turn arbitration은
순수 TurnAdmission, spawn 입력은 principal-launch, 표시 projection은 principal-events다.
PrincipalSession·HostTenure의 실제 child lifetime은 유지한다. BrokerListeners는 listener 준비와
실제 close만 소유하고 Broker가 최종 drain·Store·lease를 반환한다.

Pi autocomplete는 공개 wrapper/constructor를 사용하며 prototype/private fdPath를 바꾸지 않는다.
남은 tool-init private import 우회는 Pi/Pi TUI 1.0.1 preload·export 계약 검사로 제한한다.
Store type SCC와 diagnostics 상향 타입 edge를 제거했고 native adapter와 Society UI에도 좁은
port를 적용했다. 직접 생성한 graph는 454 files, runtime/type union cycles와 type-only 상향 edge 0이다.
evidence:refresh는 파생 구조만 생성하고 stale authored review를 거절하며 runtimeProof:false다.
검증 실패·fresh 실행은 [validation](implementation/validation.md)에 기록한다. 초기 기준 dist의
통과 숫자는 수정 코드의 증거로 재사용하지 않는다. 남은 미검토 49개도 자동 승인하지 않는다
(기준 50개 중 review.ts의 실제 변경을 이번에 직접 검토했다).

Pi의 stale ctx.cwd capture를 제거하고 Personal 저장 확인을 reload 뒤 현재 UI에 보낸다.
최종 Pi·Personal PTY 집중 검증은 20/20 PASS다. 자식 실행 오류가 status 0을 동반하면 build가
성공으로 끝나던 추가 결함도 수정했고 discovery/compile/package 세 단계의 실패 회귀를 유지한다.
최종 전체 local suite 4,021/4,021과 실제 primitive crash 63/63이 통과했다. 공통 입력
15,463개의 실행 전후 변경과 lane 입력 차이는 0건이다. build·typecheck·architecture도 PASS다.
결과와 실패 기록은 [DR44 evidence](../test/audit/architecture-quality-2026-10-11.evidence.json)에
보존한다. 결과 기록 bytes의 후속 metadata/structure 검사는 외부 `clean-post-record-result.json`에 고정한다. production code는
runtime 실행 뒤 변경하지 않는다.

native Mac·VM power loss·paid provider·release·별도 kernel qualification은 NOT_RUN이다.
기존 startup 목표 미달, 나머지 Pi private UI hook과 Society root의 deferred UI/transition
연결은 남는다. 두 ledger와 세 process lifetime은 각자의 의미 owner를 유지한다.
