# OMA v2 — 현재 인계 (2026-10-10, DR40)

DR40은 Human이 지정한 추가 아키텍처 감사 A-01~A-11을 구현하고 검증했다.
브랜치는 `feat/macos-hidden-vm`, 기준 커밋은 `3b9bcea`다. 문서 먼저,
**서브에이전트 사용 금지**, 이미 승인된 수정·검증·푸시를 유지한다.
시작 성능 작업으로 잘못 이어받은 측정용 변경은 원복했다.

## 변경과 검증

메서드별 host/guest 계약과 응답 검증, Pi 내부 editor/UI 적응 owner,
명시적인 Store facet/transaction 연결, package staging/tar 해석 owner,
원자적으로 게시하는 설정 view, LSP call lifetime, 생성된 MCP SDK 목록을 구현했다.
검사 코드의 AST/그래프 중복을 제거하고 syntax snapshot은 한 검사에만 유지한다.
evolution test는 정확한 문구 대신 AST owner를 선택한다.
실제 Git changeset 측정과 owner 관련 파일 inventory를 분리했다.

최종 전체 local suite 3,983/3,983, actual primitive crash lane 63/63,
build/typecheck/architecture 및 전체 MCP vendor re-emit이 통과했다.
15,419개 runtime 입력은 suite/crash 양쪽 동일하며 실행 전후 bytes 변경은 0건이다.
변경 생산 파일 21개의 delta를 직접 검토했다. 상속된 NOT_REVIEWED 50개는 유지한다.
중간 실패와 environment/fixture 정정, 이후 결과 기록의 bytes 구분도 evidence에 보존했다.

상세 동작·보존한 소유권·남는 경계는 [DR40](design-revisions.md#dr40--추가-아키텍처-감사-a-01a-11-대응),
실행 결과는 [검증 상태](implementation/validation.md), 바이트 증거는
[DR40 evidence](../test/audit/architecture-2026-10-10.evidence.json)를 따른다.
이전 인계는 [DR39 보관본](archive/handoff-before-dr40.md)에 있다.

## 남는 한계

Pi private hook의 제거·upstream 공식 hook 추가, Store type-only 순환의 제거,
아키텍처 데이터 흐름 검사의 완전한 외부 도구 대체는 완료했다고 주장하지 않는다.
독립적인 권한 목록·kernel owner·durable 의미·OS lifecycle 증거를 유지한다.
이 배치는 시작 시간 개선을 구현하지 않았다. 기존 1초/5초 시작 목표는 미달이다.
macOS native·VM power loss·paid provider·release qualification은 이 Linux 배치에서 NOT_RUN이다.
