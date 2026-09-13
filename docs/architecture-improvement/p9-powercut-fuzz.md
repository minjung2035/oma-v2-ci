# P9 — power-cut lane과 persisted-state fuzz

제안서 §14의 P9 결과다. 실패 모델을 두 개로 분리해 유지한다.

```text
SIGKILL crash lane (기존)     process 대상, primitive kill + restart
in-process fault seam (P7)    syscall 단위 deterministic fault
power-cut lane (P9, 신규)     전원 단절 + reboot 후 integrity/reconcile/model 비교
```

power-cut lane은 **기존 SIGKILL lane을 대체하지 않는다**(`sigkillLaneReplaced: false`). 서로 다른 failure model이며 evidence도 분리한다.

## 1. power-cut lane — `scripts/powercut-lane.mjs`

```sh
node scripts/powercut-lane.mjs --phase prepare --state <abs> --society <name> --out <abs evidence dir>
node scripts/powercut-lane.mjs --phase verify  --state <abs> --society <name> --out <abs evidence dir>
```

prepare: read-only integrity 관측 → expectation fsync → **정확한 checkpoint**에서 `sysrq-b`로 즉시 전원 차단.
verify: reboot 뒤 integrity 관측 → production startup recovery(broker entry) → integrity 재관측 → 기록과 비교.

기록하는 evidence: `expectation.json`(cut 이전 상태), `poweroff.json`(차단 시각/method), `comparison.json`(before/after 상태, recovery 결과, `powerLossProven`, `falseSuccess`, `sigkillLaneReplaced`).

**Guard(fail-closed)**: 전원을 실제로 끊을 수 있는 lane이므로 다음을 모두 만족해야 실행된다.

```text
--state/--out 절대 경로, 유효한 --society
OMA_POWERCUT_ACK=disposable-vm
/etc/oma-powercut-vm marker 존재
VM 내부 root
/proc/sysrq-trigger 존재
```

하나라도 빠지면 `UNSUPPORTED_PROFILE`로 종료(exit 4)하며 `powerLossProven: false`다. guard 자체는 `test/powercut-lane.test.mjs`가 로컬에서 검증한다(4 tests / 4 PASS).

**이 환경에서는 실행하지 않았다.** disposable VM도 root도 없으므로 power-cut lane은 **NOT_RUN/BLOCKED**다. SIGKILL lane 결과로 대체하지 않는다.

## 2. persisted-state fuzz — `test/persisted-state-fuzz.test.ts`

대상과 oracle:

| target | oracle |
|---|---|
| `plan_json` | shape/closed-kind/relation 검사가 **closed failure**를 반환. fuzz corpus 전체에 대해 root의 비-DB 파일과 durable row digest가 **변하지 않는다**(no repair, no physical effect) |
| `result_json` | shape-valid라도 accepted intent와 어긋나면 relation 검사가 거절 |
| agent spec(`spec_json`) | corrupt spec은 `STORE_CORRUPT`로 fail closed. 빈 권한 집합으로 **축소되지 않는다** |
| context manifest | unsafe path/byte·digest coercion/sha256 형식 위반을 거절 |
| persisted version classifier | v1이 아닌 것은 `unknown`으로 남고 승격되지 않는다 |
| raw persisted row | fuzzed `plan_json`을 raw SQL로 주입: ① 비-JSON은 storage layer의 `json_valid` CHECK가 거부 ② JSON이면 read가 closed failure ③ 어떤 경우에도 **persisted bytes가 수정되지 않는다** |

재현성: seed는 `test/model/reproducible.ts`의 LCG(`lcg32-1664525-1013904223-v1`)를 그대로 쓴다. corpus는 `test/fuzz/persisted-corpus.ts`에 체크인되어 있고, 실패 시 `recordExplorationFailure`가 `replay.json`을 남긴다. `OMA_TEST_FUZZ_CASES`로 case 수를 늘릴 수 있다.

실행: `node --test dist/test/persisted-state-fuzz.test.js` → **7 tests / 7 PASS**.

## 3. 남은 경계

- power-cut lane은 실행되지 않았다(환경 없음). VM에서 실행하면 `comparison.json`이 `powerLossProven` 판정과 함께 evidence가 된다.
- `fsyncTree`/immutable publication의 내구성은 지원 filesystem·장치 계약에 의존한다(S-06). 이 lane은 OMA 쪽 ordering만 검증한다.
- ENOSPC/read-only remount는 여전히 미실행이다(S-06 OPEN).
- fuzz corpus는 authored source이며, 측정된 discovery로 주장하지 않는다.
