# P0 prerequisite bug — synchronous stdin encoding

Base: 77ac4c7376c230bc455c71df0e9b181cdef277f4.
While exercising the real Git diagnostic adapter, `runProcessSync` returned
spawn-failed / ERR_UNKNOWN_ENCODING for every string stdin. Its output option
`encoding: "buffer"` was also interpreted by native spawnSync when converting a
string input. This prevented the actual cat-file observation from running.

D10: fix this concrete baseline defect instead of adding a second subprocess
owner, suppressing the error or pretending unavailable Git meant absent data.
Convert stdin to a private Buffer before calling spawnSync. String bytes remain
UTF-8, binary input stays exact and copied, output remains Buffer. Command argv,
environment, timeout, output budgets, shell:false and unknown handling are unchanged.

Reproduced with actual Node 22.16.0 child processes and a native-call observation
fixture. Original source: 1 pass / 2 fail. Fixed source: 3 pass / 0 fail, with no
skips/cancellations/todos. Both source closures compile under strict TS 5.8.3 with
noUncheckedIndexedAccess/exactOptionalPropertyTypes (@types/node 25.1.0).

```sh
./node_modules/typescript/bin/tsc --module NodeNext --moduleResolution NodeNext --target ES2023 --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck --rootDir . --outDir dist src/process/run.ts
node --test test/process-input-encoding.test.mjs
```

Source SHA-256:
- src/process/run.ts: f58a8785ee743139940b7f10802b3a167c819cf3d70875f7b08bc723a6c72471
- test/process-input-encoding.test.mjs: 5d74aa16d910d661550c0d594375dc3048ca5d93e592cc67fa5d22c92f03e479

The actual after-run TAP is in evidence/p0-stdin-after.tap. This closes only the
identified native stdin bug, not the complete P0 locked-dependency/native/release
baseline. No wire, durable format, operation transition or OPEN gate changed.
