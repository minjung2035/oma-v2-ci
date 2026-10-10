# OMA v2 — 현재 인계 (2026-10-10, DR42)

Human이 기준 `ae15804000ce6`의 여섯 Host/Guest 결함 수정을 지시했다.
문서부터 확인했고 **서브에이전트 사용 금지**, 승인된 수정·검증·커밋·푸시를 유지한다.

현재 VzDriver에는 이미 처리한 줄을 제거하는 코드가 있으며 baseline 37/37이 통과했다.
두 Native helper client의 JSONL·correlation·deadline을 공통 owner로 묶었다.
project별 import/start/archive queue와 maintenance barrier, 세대별 egress 재시도·취소,
archive의 실제 launcher stop/manager proof, Keychain과 archive key의 유한 writer 대기,
Host/Guest 공통 RPC dispatcher를 구현했다. same-key 과거 결과와 unknown 의미는 유지한다.

집중 재실행 274/274, build/typecheck, architecture rules가 통과했다.
실제 Linux user systemd에서 endpoint가 없는 live holder/child의 짧은 stop은 unknown,
완전한 stop과 collected-unit 관측은 stopped임을 확인했다.
첫 전체 suite 4,008/4,008이 통과했다. 추가 P0 검토로 ledger의 historical replay/key binding을
현재 project fence보다 먼저 판정하며 pending 효과·outcome 게시만 owner에 맡기도록 보완했다.
Keychain/Archive key는 중복 promise queue를 제거해 같은 프로세스의 대기도 유한 budget에 포함한다.
보완 후 ledger 집중 59/59, lock/credential/cleanup 집중 87/87이 통과했다.
전역 package 게시도 같은 maintenance/archive barrier에 참여한다. package/project/archive 통합 집중 65/65이 통과했다.
최종 전체 suite 4,010/4,010과 actual primitive crash 63/63이 통과했다.
두 실행의 입력 15,439개는 동일하며 전후 변경은 0건이다. 코드 delta 21개를 검토했고 상속된 미검토 50개는 유지한다.
Human이 추가 요청한 Society composition 및 플랫폼 책임·계약 구조 개선을 다음 DR43에서 진행한다.

설계는 [DR42](design-revisions.md#dr42--native-transportproject-writeregress-복구archive-종료-증명),
현재 실행은 [validation](implementation/validation.md), bytes·실패 로그는
[DR42 evidence](../test/audit/host-repairs-2026-10-10.evidence.json)를 따른다.
이전 인계는 [DR41 보관본](archive/handoff-before-dr42.md)에 있다.

native Mac·VM power loss·paid provider·release는 NOT_RUN이다.
기존 전체 startup 5초 목표 미달과 Pi private hooks·Store type-only SCC는 남는다.
