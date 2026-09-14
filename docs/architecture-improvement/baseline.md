# P0 — verification baseline execution log

This is execution evidence bookkeeping, not release certification. See [progress.md](progress.md) for scope and decisions.

## Bootstrap attempts

| Source commit | Actions run | Result | Interpretation |
| --- | --- | --- | --- |
| `2217221611e53cf2ec11439ff5ab2c7af032bd01` | `34736389041` | workflow rejected before jobs; jobs list empty | No source verification executed. A job-level env used runner.temp, which is unavailable in that context. |
| `15956ae19720639f3c92d9b8f52815855a996603` | `34736432730` | baseline job failed before execution; runner_id=0; steps=[] | No runner allocated and no source checks ran. Job logs returned BlobNotFound. The underlying account/runner cause is not established. |

The workflow correction uses a run-ID/attempt-scoped /tmp directory with the allowed github context. No baseline PASS is claimed. Inventory generation, pinned full typecheck/build/package/architecture/transaction/test and native lanes remain NOT_RUN/BLOCKED. Later branch pushes are not assumed to be successful verification merely because they trigger a workflow.

## Independent local verification — P1 only

A partial local workspace contains byte-identical copies of the relevant base sources retrieved from GitHub. It is not a complete repository checkout. The checker test invokes the real analyzer with isolated temporary TypeScript programs. Composition and dispatch tests execute actual source through controlled module boundaries; they do not execute real host effects or the complete production schema/decoder closure.

Environment: Node v22.16.0, TypeScript 5.8.3. The repository pins TypeScript 5.9.3; this local execution is NOT pinned-toolchain or full-source verification. Transpile success in composition/dispatch tests is NOT semantic typecheck.

| Focused test file | Original source: pass/fail | Modified source: pass/fail | Scope |
| --- | --- | --- | --- |
| operation-registry-policy.test.mjs | 5 / 3 | 8 / 0 | Real architecture checker, closed-kind/callable/compiler fixtures |
| broker-composition-policy.test.mjs | 2 / 1 | 3 / 0 | Controlled actual entrypoint composition and callback wiring |
| public-validation-policy.test.mjs | 12 / 2 | 14 / 0 | Controlled actual dispatcher, shared rule mutation and live authority recheck |

Final combined execution command:

```sh
node --test --test-concurrency=1 --test-reporter=tap \
  test/operation-registry-policy.test.mjs \
  test/broker-composition-policy.test.mjs \
  test/public-validation-policy.test.mjs
```

Observed final result: **25 executed, 25 PASS, 0 FAIL, 0 CANCELLED, 0 SKIPPED, 0 TODO**. This is the focused P1 total, not the repository suite total and not a fast/all lane result. Existing `evaluateExecution` accepted the raw TAP with the three P1 oracle prefixes and no errors; full-lane baseline comparison remains NOT_AVAILABLE.

`node --check scripts/verification-lanes.mjs` passed. A separate assertion confirmed that all three focused test files and oracle prefixes are in fast/all without duplicate sourceFiles. Existing test files and required oracle names were not removed.

Source/digest records: [P1-1](evidence/p1-operation-registry.json), [P1-2](p1-composition.md), [P1-3](p1-validation.md), [combined summary](evidence/p1-focused-summary.json). Raw logs retained in the repo include [P1-1](evidence/p1-operation-registry.tap), [P1-2](evidence/p1-composition.tap), and [final combined run](evidence/p1-combined.tap). Original source is recoverable from the starting master SHA for reproducing the red fixtures.

## Required full evidence before merging or P2+

Obtain an actual execution environment; install locked dependencies; record source SHA, resolved Node/npm/kernel versions and dependency outcome; preserve pre-generator inventory failure; run the repository inventory/LOC/hash generators; run typecheck/build/package/architecture/transaction/test and every relevant lane; retain raw logs and distinguish product failures from environment blocks.

Keep SETUP_FAILED/BLOCKED and NOT_RUN distinct from PASS. Preserve failed bootstrap runs rather than rewriting their history. Generated production-files/LOC/hash files have not been manually edited. P2 and later implementation remains unstarted; P6–P9 is a separate maturity/format phase under the original proposal.
