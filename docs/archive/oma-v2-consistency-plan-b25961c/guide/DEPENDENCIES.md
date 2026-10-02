# 작업 의존성·권장 진행 순서

**WP 번호순 실행이 아니다.** 아래 topological order를 따른다. 특히 WP23은 lifecycle/authority 관측 계약을 보존하기 위해 WP25 뒤에 온다. [plan.json](../plan.json)이 같은 dependency graph를 가진다.

## 단일 AI 권장 순서

```text
WP00 → WP01 → WP02 → WP03 → WP04 → WP11 → WP17 → WP05 → WP12 → WP18 → WP06 → WP13 → WP19 → WP07 → WP14 → WP16 → WP20 → WP08 → WP15 → WP21 → WP09 → WP22 → WP24 → WP10 → WP25 → WP23 → WP26 → WP27 → WP29 → WP28 → WP31 → WP30 → WP32
```

한 WP의 required 선행 handoff와 ADR을 먼저 읽는다. WP01의 runtime gate를 WP03 실행 전에 PASS로 간주하지 않는다. runtime 결과가 기본 결정을 반증하면 ADR revision을 갱신하고 영향 task를 재개한다.

## 전체 작업 표

| WP | 작업 | 선행 작업 | 주요 검증 |
|---|---|---|---|
| [WP00](../workpackages/WP00.md) | 기준 HEAD·전수 파일 배정·실행 가능한 baseline 고정 | 없음 | V00A, V00B |
| [WP01](../workpackages/WP01.md) | 핵심 불변식·판정표·호환성 ADR 확정 | WP00 | V01A, V01B |
| [WP02](../workpackages/WP02.md) | Production-valid fixture와 독립적인 경계 검증 도구 | WP00 | V02A, V02B, V02C |
| [WP03](../workpackages/WP03.md) | 배포 topology와 config locator의 실제 연결 검증·수정 | WP01, WP02 | V03A, V03B |
| [WP04](../workpackages/WP04.md) | Store 열기와 schema 거절을 부작용 없는 호환성 경계로 정리 | WP01, WP02 | V04A, V04B |
| [WP05](../workpackages/WP05.md) | 전달 영수증 publication을 원자성·영속성·권한까지 완성 | WP01, WP02, WP04 | V05A, V05B, V05C |
| [WP06](../workpackages/WP06.md) | 공통 receipt 관측과 좁은 recovery settlement 권한 | WP01, WP02, WP05 | V06A, V06B |
| [WP07](../workpackages/WP07.md) | Resident의 증거 정산을 incarnation rollover보다 앞에 배치 | WP03, WP06 | V07A, V07B |
| [WP08](../workpackages/WP08.md) | Principal의 재전달과 완료 재시도를 분리 | WP06, WP07 | V08A, V08B |
| [WP09](../workpackages/WP09.md) | Principal run 소유권과 Human 입력 전달 상태를 명시화 | WP02, WP08 | V09A, V09B, V09C |
| [WP10](../workpackages/WP10.md) | deadline·프로세스 종료·broker generation의 의미 정리 | WP03, WP09 | V10A, V10B, V10C |
| [WP11](../workpackages/WP11.md) | 순수 전체 설정 검증과 닫힌 편집 command를 한 owner로 통합 | WP01, WP02 | V11A, V11B, V11C |
| [WP12](../workpackages/WP12.md) | Configuration loader와 편집기의 단일 snapshot 경계 | WP11 | V12A, V12B |
| [WP13](../workpackages/WP13.md) | 관리형 설정 generation의 durable commit과 migration | WP12, WP03 | V13A, V13B, V13C |
| [WP14](../workpackages/WP14.md) | Extension의 선택·제거·로드 규칙을 같은 편집 owner로 통합 | WP12, WP13 | V14A, V14B |
| [WP15](../workpackages/WP15.md) | 설정 적용 시점·bootstrap 선택·표시의 의미를 일치시킨다 | WP11, WP13, WP14 | V15A, V15B |
| [WP16](../workpackages/WP16.md) | 프로젝트 identity·first-run binding·프로비저닝의 원자성 | WP03, WP04, WP13 | V16A, V16B |
| [WP17](../workpackages/WP17.md) | PreacceptScope로 준비 자원의 책임 등록과 정산을 강제 | WP01, WP02 | V17A, V17B |
| [WP18](../workpackages/WP18.md) | Context publication 준비·수락·정리 경계를 하나로 연결 | WP17 | V18A, V18B |
| [WP19](../workpackages/WP19.md) | Create·bootstrap의 partial preparation와 linked ownership 정리 | WP17, WP18 | V19A, V19B |
| [WP20](../workpackages/WP20.md) | Mail·Git submit의 ownership·재시도 계약에 scope를 일관 적용 | WP17, WP18, WP19 | V20A, V20B |
| [WP21](../workpackages/WP21.md) | 새 수락·조회·정산·안전 제어의 분류와 오류 phase를 연결 | WP01, WP06, WP20 | V21A, V21B |
| [WP22](../workpackages/WP22.md) | Storage accounting·reservation·정산 예산의 수명과 한계 | WP21 | V22A, V22B |
| [WP23](../workpackages/WP23.md) | 관측 snapshot·비동기 진단·bounded read model | WP21, WP22, WP25 | V23A, V23B |
| [WP24](../workpackages/WP24.md) | Git의 증거 관측·새 효과·no-op 의미를 분리 | WP01, WP02, WP18, WP20, WP21 | V24A, V24B |
| [WP25](../workpackages/WP25.md) | Lifecycle·unit·run pin의 현재 권한과 수명 경계 통일 | WP03, WP07, WP10, WP19 | V25A, V25B |
| [WP26](../workpackages/WP26.md) | Protocol·CLI·cache의 닫힌 계약과 재전송 의미 검증 | WP02, WP06, WP21, WP25 | V26A, V26B, V26C |
| [WP27](../workpackages/WP27.md) | 엔진·extension·relay의 신뢰·호환성·한도 검증 | WP03, WP08, WP10, WP14, WP25, WP26 | V27A, V27B |
| [WP28](../workpackages/WP28.md) | TUI의 사실 표현·입력 수명·적용 시점 정리 | WP09, WP15, WP23, WP26, WP27 | V28A, V28B |
| [WP29](../workpackages/WP29.md) | Architecture gate·닫힌 타입·시험 증거의 보장 수준 교정 | WP11, WP12, WP20, WP26 | V29A, V29B |
| [WP30](../workpackages/WP30.md) | 횡단 불변식·상태 모형·실제 crash matrix 검증 | WP07, WP08, WP10, WP13, WP16, WP20, WP22, WP23, WP24, WP25, WP26, WP27, WP28, WP29 | V30A, V30B |
| [WP31](../workpackages/WP31.md) | 패키징·런타임 지원표·배포 identity 검증 | WP03, WP13, WP27, WP29 | V31A, V31B |
| [WP32](../workpackages/WP32.md) | 전체 파일 closure·문서 정합성·최종 승인 | WP30, WP31 | V32A, V32B |

## 의존성상 가능한 작업 파동

같은 파동이라고 동시에 같은 checkout을 수정해도 된다는 뜻은 아니다. shared file lock 규율이 우선한다.

1. [WP00](../workpackages/WP00.md)
2. [WP01](../workpackages/WP01.md), [WP02](../workpackages/WP02.md)
3. [WP03](../workpackages/WP03.md), [WP04](../workpackages/WP04.md), [WP11](../workpackages/WP11.md), [WP17](../workpackages/WP17.md)
4. [WP05](../workpackages/WP05.md), [WP12](../workpackages/WP12.md), [WP18](../workpackages/WP18.md)
5. [WP06](../workpackages/WP06.md), [WP13](../workpackages/WP13.md), [WP19](../workpackages/WP19.md)
6. [WP07](../workpackages/WP07.md), [WP14](../workpackages/WP14.md), [WP16](../workpackages/WP16.md), [WP20](../workpackages/WP20.md)
7. [WP08](../workpackages/WP08.md), [WP15](../workpackages/WP15.md), [WP21](../workpackages/WP21.md)
8. [WP09](../workpackages/WP09.md), [WP22](../workpackages/WP22.md), [WP24](../workpackages/WP24.md)
9. [WP10](../workpackages/WP10.md)
10. [WP25](../workpackages/WP25.md)
11. [WP23](../workpackages/WP23.md), [WP26](../workpackages/WP26.md)
12. [WP27](../workpackages/WP27.md), [WP29](../workpackages/WP29.md)
13. [WP28](../workpackages/WP28.md), [WP31](../workpackages/WP31.md)
14. [WP30](../workpackages/WP30.md)
15. [WP32](../workpackages/WP32.md)

## Parallel 작업의 실제 제한

같은 repository worktree를 여러 구현 AI가 동시에 수정하지 않는다. 독립 worktree를 사용하더라도 공유 파일은 coordinator가 순서대로 merge한다. `src/broker.ts`(03/07/21/23/25), `src/storage/transitions.ts`(06/07/25), `src/tui/session.ts`(09/10/28), `src/config/operations.ts`와 settings(11–15), `src/storage/durable-fs.ts`(05/13/17), `src/entry/oma.ts`(03/09/13/15/16/28)는 특히 동시 수정 충돌 위험이 크다.

merge는 각 branch의 기존 PASS를 합치는 작업이 아니다. 합쳐진 source에 대해 impacted regression과 architecture/inventory/digest를 다시 실행한다. 상대 WP에서 삭제한 helper를 stale branch가 복원하지 않도록 한다.

## Scope gate

동작을 바꾸는 C2는 결정 문서가 채택돼야 진행한다. v1로 해결 불가능하다는 증거가 나오면 C3 변경을 이 순서에 몰래 끼우지 않는다. 별도 승인된 migration plan과 dependency revision을 먼저 만든다. 일부 kernel gate가 blocked여도 의존하지 않는 local 조사/구현은 진행할 수 있지만 의존한 강한 보장은 완료로 표시하지 않는다.
