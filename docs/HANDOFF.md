# OMA v2 — 현재 재개점

최신 요청·다음 작업·제약만 소유한다. 실행 판정과 수치·로그는 [validation](implementation/validation.md), 문서 역할은 [문서 지도](README.md)가 소유한다.

## 최신 사용자 요청

사용자는 기존 구현을 멈추고 merge/review/challenge의 도구·메일·승인 흐름을 먼저 정리했다. 이후 그 흐름의 spec 작성과 전체 문서 통합을 요청했다. **기존 A~G 구현을 자동 재개하는 단계가 아니다.** 새 구현 요청이 오면 [merge-review-spec](merge-review-spec.md)의 확정 요구·권장 기본값에서 시작한다.

이번 정리에서 새 merge-review spec의 설계와 본문은 보존했다. `docs/`로 이동한 상대 링크만 수정했다. spec 작성이 새 도구와 workflow의 구현 완료를 뜻하지 않는다.

## 작업 위치

- 저장소: `/home/dev/oma-v2`, 브랜치: `feat/macos-hidden-vm`.
- 상속된 대규모 dirty tree를 보존한다. 다른 작업자의 변경을 버리거나 전체 변경을 자기 작업으로 stage하지 않는다.
- 문서는 `docs/`, wire·DB·deployment 선언과 기계 판독 map은 `implementation/`에서 찾는다.
- 원래 긴 구현 요청·검증 메모는 [정리 전 인계 기록](archive/handoff-before-consolidation.md)에 보존했다. 그 파일의 active/현재/재개 지시는 작성 당시의 기록이다.
- 외부 리뷰와 계획 원본은 `docs/archive/`로 위치만 옮겼다. 원문 bytes와 기존 checksum을 보존한다.

## 다음 구현 작업의 기준

1. PRIORITY-0와 문서 지도를 읽고 실제 code owner·현재 contract를 확인한다.
2. merge-review spec을 읽고 재사용할 Git·mail·attestation owner와 제거할 모델 도구를 확인한다.
3. spec의 전환 순서에 따라 contract·durable owner·자동 메일·role 제한을 구현한다. 구형 제어 경로를 병렬로 남기지 않는다.
4. 수용 조건과 durable 경계를 검증하고 validation에 실행 범위·한계를 기록한다.

기존 tiered 검사 executor와 구형 review/finding/scope의 일부 코드·집중 회귀는 존재한다. 실제 manager/cgroup probe, native macOS와 전체 release 검증은 완료로 간주하지 않는다. 상세 잔여와 증명 범위는 validation에서 확인한다.

## 유지할 실행 제약

- 실제 사용자 OMA/VM·저장된 인증 정보·유료 provider를 문서 정리나 fixture 확인을 위해 실행·읽지 않는다.
- 이전 automatic approval rejection은 문서 이동으로 해제되지 않는다. 실제 systemd service probe, 중단 VM ownership probe, reviewer shortage 예외 probe, 실제 isolated-HOME/unshare Kiro를 대체 경로로 재시도하지 않는다.
- `test/platform-lifecycle-ownership.test.mjs`, `test/platform-vz-ownership.test.mjs`, `dist/test/platform-lifecycle.test.js`와 이를 포함한 aggregate suite를 실행하지 않는다.
- native Mac 증거는 Linux fixture 성공으로 대체하지 않는다. 환경이 없으면 NOT_RUN이다.
- architecture·계획 원본·과거 receipt와 review fact의 뜻을 바꾸지 않는다. 문서 ID와 시험 번호도 재사용하지 않는다.
- 현재 요청에는 commit/push/PR/배포 승인이 포함되어 있지 않다.

## 재개 명령

명령은 `package.json`, 검증 요구는 [verification-spec](verification-spec.md), 실행할 수 있는 lane과 현재 한계는 validation이 기준이다. 전체 `npm test`를 자동 기본값으로 선택하지 않는다.
