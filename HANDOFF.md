# OMA v2 — 현재 인계

이 문서는 다음 작업자가 **현재 어디서 재개해야 하는지**만 기록한다. 장기 유지보수 원칙은 [`MAINTENANCE.md`](MAINTENANCE.md), 문서 권위와 historical/generated 구분은 [`implementation/README.md`](implementation/README.md)를 따른다.

과거 R00–R40 카드, R37/R39 종료 기록, C01–C07 후속 상세와 commit 목록을 이 파일에 다시 복사하지 않는다. 필요한 경우 아래 historical record를 따라간다.

## 1. 현재 판정

**현재 source에는 C01–C07 감사에서 확인된 replay/fixture/owner/inventory-tooling 보완이 반영되어 있지만, 전체 실행 적합성과 release compliance는 아직 인증되지 않았다.**

현재 상세 검증 상태는 [`implementation/validation.md`](implementation/validation.md)가 기준이다. 특히 다음을 과장하지 않는다.

- source/test/tooling이 존재한다고 실행 PASS가 되는 것은 아니다.
- 과거 `DONE` marker는 재개 지점이지 correctness/release 증거가 아니다.
- 과거 test count, LOC, source pin, raw log를 현재 source 결과로 재사용하지 않는다.
- OPEN SPIKE는 helper/test가 있다는 이유로 닫지 않는다.

이 문서를 읽는 즉시 현재 `master` HEAD를 다시 조회한다. 문서 자신의 commit SHA를 current HEAD로 적지 않는다.

## 2. 작업 시작 전 읽기 순서

1. [`architecture.md`](architecture.md)
2. [`implementation-spec.md`](implementation-spec.md)
3. [`implementation/physical-ordering.md`](implementation/physical-ordering.md)
4. [`implementation/contracts.ts`](implementation/contracts.ts), [`implementation/schema-v1.sql`](implementation/schema-v1.sql)
5. [`implementation/compliance.md`](implementation/compliance.md), [`implementation/spikes.md`](implementation/spikes.md), [`implementation/integration-policy.md`](implementation/integration-policy.md), [`implementation/test-matrix.md`](implementation/test-matrix.md)
6. [`MAINTENANCE.md`](MAINTENANCE.md)
7. 이 파일과 [`validation.md`](validation.md), [`implementation/validation.md`](implementation/validation.md)
8. 관련 production source/test

Historical 문서는 current source를 이해하기 위한 보조 자료이지 상위 계약이 아니다.

## 3. 현재 남은 우선 작업

### A. C05 — production inventory/LOC/hash freshness

현재 validation 기록상 `production-files.txt`, `production-loc.json`, `production-loc-hashes.json`은 **STALE**이다. 소스 목록이나 LOC/hash를 사람이 최신 값처럼 직접 고치지 않는다.

재검증 시작 순서:

```sh
npm run inventory
npm run check:inventory
```

그 뒤 full LOC/hash가 필요하면 pinned cloc 계약에 따라:

```sh
node scripts/loc.mjs
```

을 실제 실행하고 결과를 current source에 결합한다.

### B. C06 — full execution evidence

다음은 current validation 기준 **NOT_RUN**이다.

- typecheck/build/package
- architecture/transaction gate
- fast/durable/property/kernel/crash/stress/all verification lane
- installed entrypoint/package closure
- current-source trace/report/compliance generation
- performance/latency/RSS/FD 측정

작성된 test나 lane 연결을 PASS로 부르지 않는다.

### C. fixture/coverage 전역 상태

C03에서 확인된 phase2/phase4 fixture는 보완되었지만 다른 legacy phase/audit fixture 전체가 strict decoder와 current invariant를 만족하는지는 전수 검증되지 않았다.

C07의 actual lifecycle sequence source가 존재해도 실행/축소 결과와 kernel/crash 증거는 별도다.

### D. OPEN gate

`implementation/spikes.md`의 상태를 source helper만으로 갱신하지 않는다. 특히 다음 실제 evidence가 없으면 OPEN/BLOCKED를 유지한다.

- S-01 / S-01-CANDIDATE kernel/resource/isolation 경계
- S-02 Principal attach/private boundary
- S-03 trusted Pi session/batch completion evidence
- S-04 real provider codec/accounting
- S-05/S-06 hostile import/crash/power-loss/backup 경계
- S-08/S-10 tiered authority/floor/challenge
- S-11 strict clean-room
- S-09 quality/cost/latency evaluation

## 4. C01/C02 lifecycle replay에서 유지해야 하는 의미

과거 nonterminal start/stop replay는 accepted plan과 현재 target의 관계가 맞지 않으면 새로운 unit effect를 발행해서는 안 된다.

특히:

```text
accepted plan.desired
accepted plan.previousIncarnation
```

을 현재 target에 맞춰 rewrite하지 않는다. Old stop operation이 더 새로운 incarnation을 stop 대상으로 선택하지 않게 한다. Old start operation이 그 이후의 stopped intent를 덮고 새 start effect를 발행하지 않게 한다.

Normal path와 recovery를 하나의 generic 재실행 함수로 합치지 않는다. 공유할 것은 frozen intent/current-state relation과 observation primitive이며 decision policy는 별개로 유지한다.

관련 상세 역사: [`implementation/conformance-followup.md`](implementation/conformance-followup.md).

## 5. 검증을 다시 시작할 때의 권장 순서

`package.json`의 scripts를 현재 entry로 사용한다.

```sh
npm run inventory
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
npm run verify:fast -- --out <new-dir>
npm run verify:durable -- --out <new-dir>
npm run verify:property -- --out <new-dir>
npm run verify:kernel -- --out <new-dir>
npm run verify:crash -- --out <new-dir>
npm run verify:stress -- --out <new-dir>
npm run verify:all -- --out <new-dir>
node scripts/loc.mjs
```

각 verification run은 기존 artifact directory를 덮지 않고 새 output directory를 사용한다. 환경 미지원/skip/oracle 미도달을 전체 PASS로 바꾸지 않는다.

## 6. 이번 이후의 bug-fix 원칙

새 bug를 만나면 [`MAINTENANCE.md`](MAINTENANCE.md)의 절차를 따른다.

요약하면:

```text
current HEAD에서 재현
→ Fact / Relation / Phase 정리
→ 직접 원인과 bug class 식별
→ authoritative owner 확인
→ regression/invariant oracle
→ 최소 안전 수정
→ 같은 class의 다른 구현 static audit
→ relevant lane 실행
→ fresh evidence와 HANDOFF 갱신
```

같은 key의 historical operation을 현재 state에 맞춰 고치는 방식, unknown을 absence/success로 바꾸는 방식, accepted plan/hash/frozen bytes를 rewrite하는 방식은 사용하지 않는다.

## 7. 문서 역할

### 현재 작업에 사용

- [`MAINTENANCE.md`](MAINTENANCE.md) — 장기 유지보수 원칙
- [`implementation/README.md`](implementation/README.md) — 문서 지도
- 이 `HANDOFF.md` — 현재 재개점
- [`validation.md`](validation.md) — 검증 색인
- [`implementation/validation.md`](implementation/validation.md) — 상세 current verification status

### Historical detail

- [`implementation/conformance-followup.md`](implementation/conformance-followup.md) — C01–C07 후속 상세
- [`implementation/refactoring-closure.md`](implementation/refactoring-closure.md) — R37–R39 구조개편 종료 기록
- [`implementation/adversarial-review.md`](implementation/adversarial-review.md) — 특정 source/evidence 기준 generated audit ledger
- `implementation/evidence/*` — 당시 source/environment에 결합된 raw evidence

Historical 문서의 결론을 현재 HEAD에 적용하려면 owner/call path를 다시 찾고 재현 또는 fresh evidence로 확인한다.

## 8. 변경하지 않은 상위 surface

이 문서 정리는 다음을 변경하지 않는다.

- architecture 철학
- implementation-spec MUST/MUST NOT
- wire v1 method/error/receipt surface
- DB entity/schema 의미
- physical ordering
- OPEN SPIKE 상태
- systemd unit set
- integration/tier policy

현재 상태는 **source hardening은 진행됐지만 full execution verification과 release proof가 남아 있는 상태**다.
