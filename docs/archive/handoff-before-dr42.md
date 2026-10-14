# OMA v2 — 현재 인계 (2026-10-10, DR41)

Human이 지정한 TUI/Application/Runtime/Extension 모듈 독립성을 구현하고 검증했다.
브랜치 `feat/macos-hidden-vm`, 기준 DR40 완료 `babe732`다. 문서부터 확인하고
**서브에이전트 사용 금지**, 승인된 수정·검증·푸시를 유지한다.

TUI의 설정·메일·관측 저장 효과는 Application이, Principal 실행·입력·수명은
Runtime의 engine owner가 맡는다. Society 패널은 데이터·행동 port만 받는다.
Core 설정 의미·DTO·Observation, Runtime packages 공개 API와 Platform staging/directory
port를 연결했다. Extension의 기존 contracts/client/Pi/verified vendor 경계를 유지한다.
공개 TUI subpath와 모듈 import 경계는 기존 checker가 지연·type-only 참조까지 검사한다.

두 독립 빌드는 `node scripts/build-module.mjs <tui|extension> --out <새-경로>`다.
각 manifest와 declarations, Extension의 vendor·Pi manifest를 포함한다. 실제 npm
의존성으로 산출물 전체 공개 API가 로드되고 copied vendor 변조가 거절됐다.
전체 local suite 3,990/3,990, actual primitive crash 63/63이 통과했다.
동일한 15,433개 입력의 실행 전후 변경은 0건이다. 코드 변경 후 결과 기록을 별도 검증한다.
변경 생산 delta 49개를 직접 검토했고 상속된 미검토 50개는 유지했다.
첫 전체 suite의 29개 실패와 fixture·규범 기록 정정도 evidence에 보존했다.
Broker·Store·durable·effect-time 권한·OS 종료·host/guest 경계와 상속된 미검토 상태는 유지한다.

상세는 [DR41](design-revisions.md#dr41--tuiapplicationruntimeextension-모듈-경계)과
[검증 상태](implementation/validation.md),
[DR41 evidence](../test/audit/modules-2026-10-10.evidence.json)를 따른다.
이전 인계는 [DR40 보관본](archive/handoff-before-dr41.md)에 있다.

Pi private hook·Store type-only 순환은 남는다. native Mac·VM power loss·paid provider·
release는 NOT_RUN이다. 기존 시작 1초/5초 목표는 미달이며 이 배치가 해결하지 않았다.
