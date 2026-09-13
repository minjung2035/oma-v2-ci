# P0 — verification baseline execution log

This is execution evidence bookkeeping, not release certification. See [progress.md](progress.md) for scope and decisions.

## Bootstrap attempts

| Source commit | Actions run | Result | Interpretation |
| --- | --- | --- | --- |
| `2217221611e53cf2ec11439ff5ab2c7af032bd01` | `34736389041` | workflow rejected before jobs; jobs list empty | No source verification executed. A job-level env used runner.temp, which is unavailable in that context. |
| `15956ae19720639f3c92d9b8f52815855a996603` | `34736432730` | baseline job failed before execution; runner_id=0; steps=[] | No runner allocated and no source checks ran. Job logs returned BlobNotFound. The underlying account/runner cause is not established. |

The workflow correction uses a run-ID/attempt-scoped /tmp directory with the allowed github context. No baseline PASS is claimed. Inventory generation, pinned full typecheck/build/package/architecture/transaction/test and native lanes remain NOT_RUN/BLOCKED.

## Independent local verification — P1-1 only

A partial local workspace contains byte-identical copies of the base checker and its owner policy, retrieved from GitHub. It is not a complete repository checkout. The focused test invokes the real checker with isolated temporary TypeScript programs.

Command:

```sh
node --test --test-concurrency=1 --test-reporter=tap test/operation-registry-policy.test.mjs
```

Environment: Node v22.16.0, TypeScript 5.8.3. The repository pins TypeScript 5.9.3; this local execution is NOT pinned-toolchain or full-source verification.

| Input | Executed | Pass | Fail | Skip | Result scope |
| --- | ---: | ---: | ---: | ---: | --- |
| Original checker + new regression tests | 8 | 5 | 3 | 0 | Reproduces count-dependent rejection at counts 1, 2 and 12 |
| Modified checker + same regression tests | 8 | 8 | 0 | 0 | Closed-set/validator/compiler fixtures only |

Source and raw-log digests are recorded in [p1-operation-registry.json](evidence/p1-operation-registry.json). The successful raw TAP is [p1-operation-registry.tap](evidence/p1-operation-registry.tap). The base checker is recoverable from the starting master SHA; the same regression test reproduces the red run. No test count here is a claim about the complete repository suite.

## Required full evidence

Record the actual source SHA, resolved Node/npm/kernel versions, dependency installation outcome, pre-generator inventory failure, generator outputs, typecheck/build/package/architecture/transaction/test results, and the raw status of every verification lane. Keep SETUP_FAILED/BLOCKED and NOT_RUN distinct from PASS. Preserve all failed bootstrap runs rather than rewriting their history.
