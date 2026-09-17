# 문서 구조

현재 문서는 **규범**, **현재 작업 상태**, **machine-readable implementation metadata**만 active tree에 둔다. 특정 phase의 완료 보고서, 과거 PASS/LOC, 일회성 audit/closure, 원 제안서는 current guidance와 섞지 않고 Git history에서 조회한다.

## 현재 문서

| 문서 | 역할 |
|---|---|
| [README](../README.md) | 저장소 진입점 |
| [MAINTENANCE](../MAINTENANCE.md) | AI/사람 공통 수정·리뷰 규율 |
| [architecture](../architecture.md) | 최상위 architecture source of truth |
| [implementation spec](../implementation-spec.md) | 구현 MUST/MUST NOT 계약 |
| [implementation map](../implementation/README.md) | active implementation 계약과 machine-readable owner/evidence 지도 |
| [HANDOFF](../HANDOFF.md) | 현재 브랜치에서 다음 작업자가 알아야 할 최소 상태 |
| [validation](../implementation/validation.md) | current verification status와 실행 명령 |
| [operations](../operations/README.md) | 역할별 model/prompt/extension 설정 |

충돌 시 README나 HANDOFF가 architecture/spec 의미를 덮어쓰지 않는다. Point-in-time 실행 결과는 validation 한 곳에만 기록한다.

## implementation/의 원칙

`implementation/`에는 다음만 둔다.

- architecture/spec을 구체화하는 현재 계약 문서
- schema/contracts/systemd deployment surface
- `source-owners.json`, `mutation-owners.json` 같은 machine-readable locator
- contract migration/review decision처럼 현재 작업에 직접 쓰이는 machine-readable plan
- 현재 source에 결합된 generated inventory/evidence

완료된 audit narrative나 phase별 closure를 새 파일로 누적하지 않는다. 작업 결과가 장기 규율이면 MAINTENANCE에, 현재 재개점이면 HANDOFF에, 실제 실행이면 validation에 반영한다.

## 과거 기록

정리 전 phase별 문서, 제안서, audit/closure, 장문의 검증 이력은 [archive.md](archive.md)에서 정리 직전 Git snapshot으로 조회한다. Historical 문서의 `current`, `DONE`, PASS 수, LOC, TODO를 현재 HEAD의 사실로 재사용하지 않는다.

## 새 문서를 추가할 때

새 문서가 필요한지는 다음 순서로 판단한다.

1. 기존 architecture/spec의 의미인가 → 기존 owner 문서를 수정한다.
2. 반복 적용되는 작업 규율인가 → `MAINTENANCE.md`.
3. 다음 작업자가 바로 알아야 할 현재 상태인가 → `HANDOFF.md`.
4. 실제 실행 결과인가 → `implementation/validation.md`.
5. mutation/source ownership인가 → JSON map을 갱신한다.
6. 특정 작업의 일회성 상세인가 → commit/PR 설명과 Git history에 남기고 current tree에 closure 문서를 추가하지 않는다.

이 규칙의 목적은 문서 수 자체를 줄이는 것이 아니라, AI가 “현재 사실”을 찾을 때 과거 snapshot을 읽지 않게 하는 것이다.
