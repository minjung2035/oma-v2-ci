# Fixture layers — WP02

A fixture's name does not enlarge its verified boundary. Independent expected
values must not be computed by the production planner under test.

| Layer | Existing entry / example | What is actually established | Not established |
|---|---|---|---|
| Shape | `makeValidResolvedSpec`, `makeValidAgent` in `spec.ts`; primitive constructors in `valid.ts` | Complete resolved-spec shape is checked by `resolvedSpecCheck`; owned hashes are paired with their bytes. `r32-fixture-contracts.test.ts` round-trips selected records. | Host configuration, accepted ledger relation, current peer authority, installed runtime |
| Complete HostConfig | `createCompleteConfigurationFixture()` in `configuration.ts` | Writes a complete inline config, runs the actual split script, calls `loadConfiguration` on BOTH inputs, compares assembled host values before returning | Deployment attestation, credentials, running broker/runner, working rootfs/provider |
| Live Store/Mail | `mail-harness.ts` seed/send subprocess; `lifecycleReplayFixture()` in `lifecycle-replay.ts` | Real SQLite Store/decoders and actual Mail/Lifecycle paths where called; normal agents decode before fault injection. `ObservedUnits.effects` records controlled unit requests. | Socket/peer authentication and real systemd/death; lifecycle replay explicitly substitutes admission/goal/unit observations |
| Installed runtime | `P02: installed broker refuses deployment mismatch BEFORE SQLite or unit effects` in `p24-deployment-gates.test.ts` | Copies built runtime/raw assets, borrows this checkout's node_modules, invokes real broker entry and checks refusal before SQLite/socket effects | Standalone production-only install, positive society startup, clean disposable manager, engine/provider, power-loss qualification. Those require WP03/27/30/31 evidence |

`r38-package-layout.test.ts`'s **layout-only** empty-file fixture is NOT the
installed-runtime layer. A fake deployment digest or empty extension export in
a complete configuration is deliberate host-contract data, not a deployment pin.
Do not start a society using `createCompleteConfigurationFixture()` as-is.

## Complete configuration example

```ts
const fixture = createCompleteConfigurationFixture();
try {
  // Constructor has already exercised both complete production loaders.
  const before = loadConfiguration(fixture.path);
  fixture.edit("roles/resident.json", role => {
    role.toolSurface = { defaultMode: "DIRECT" };
  });
  // `edit` is an unchecked authoring/corruption seam, never a valid-candidate claim.
  const after = loadConfiguration(fixture.path);
  // Assert expected semantics/bytes independently of the loader's own helpers.
} finally {
  fixture.close();
}
```

The helper is the extracted `operations-config.test.ts` fixture, not a second
production configuration builder. All existing migration/startup-selection cases
remain in that test. `config-bundle-owner.test.mjs` now consumes it and checks the
complete loader before and after the actual Extensions write; containment-only
assembly is no longer presented as a product-valid positive control.

V02A corrupts a validated baseline explicitly: missing quota, missing resource,
and an unresolved model relation must be rejected in both inline and operations
formats. A fixture returning invalid data must fail before its intended test.

## Receipt and failure terminology

`receipt-supersession.test.mjs` concerns **CLI cached operation receipt
observations**, not Runner/Principal delivery receipts, engine session flush or
batch SQL settlement. Its physical-cache tests complement the pure ordering table;
do not use the production `receiptSupersession` return value as a concurrency oracle.

A `DurabilityFaultError` can preserve leaf artifacts by bypassing cleanup, but an
exception is not process death. `mail-faults.ts` throws through workflow cleanup
before its harness stops: that is not interchangeable with the immediate-stop
`crash-worker.ts` instrumentation. SIGKILL plus an observed checkpoint still is not
VM/storage power loss. Existing mixed-suite systemd exclusions are unchanged.

## Effect and checkpoint APIs

- `observeFile(path)` returns physical SHA-256/inode/device/link count/mode.
  Read errors propagate; unavailable is not absent.
- `observeLedger(path)` uses a separate read-only SQLite connection and explicit
  SQL to observe committed agent/operation/batch/delivery relations, not Store
  projections or production planner output. Use only finite, owned fixture DBs.
- `ObservedUnits.effects` records controlled requests, not real systemd effects.
- `Engine.events` in the Principal endpoint fixture records actual stand-in
  engine IPC responses; the delivery test counts prompt responses across a later
  tool-reply barrier. It is not real-model persistence proof.
- `killAtCheckpoint(workerURL, args, point, timeoutMs)` requires the named IPC
  message and confirmed SIGKILL. Default checkpoint deadline 10s (max 30s),
  additional reap deadline 2s, stderr cap 32KiB. Only its direct child is killed.
  If `CheckpointFailure.terminationConfirmed` is false, preserve the fixture root.
  A message alone does not prove an effect: pair it with a fresh process observer.
- `failure-matrix.ts` contains independent literal phase/preservation expectations.
  `checkpoint-worker.ts` uses the production durable leaf seam; existing
  `crash-worker.ts` supplies local Mail acceptance and Git published-ref cases.
  `checkpoint-observer.ts` starts separately and reads physical/SQL/Git facts.
  Diagnostics retain checkpoint pid, observer pid, checksums/inodes, operation
  identities, message manifests and incarnations in raw test output.

## Stable plan IDs / actual cases

| Plan ID | Actual source / case | Lane / scope |
|---|---|---|
| V01A / V01B | `consistency-decisions.test.mjs` named V01A/V01B cases | fast, all; document/contract decisions only |
| V02A | `operations-config.test.ts` six V02A corruption controls; existing migration case; `config-bundle-owner.test.mjs` loader-before/after editing | fast, all; complete production loader and editor composition |
| V02B | `checkpoint-driver.test.ts` V02B cases | durable, all; real local direct-child SIGKILL and fresh FS/SQLite/Git observer, not systemd/VM |
| V02C | `effect-observation.test.ts` raw SQL/Mail replay and controlled unit cases; `verification-policy.test.mjs` lane-ID rejection | property (effects), fast (policy), all; independent literal/physical oracles |
| V02C negative restoration | original incomplete bundle fixture plus exact full-loader assertion in disposable worktree; corrected main-tree positive control | external source-bound WP02 raw logs, not a new CI pass |

`npm test` includes all these local cases; it still excludes the original mixed
systemd files. Actual lane execution is separate and must be recorded as such.
Throw-only, missing/wrong checkpoint, silent timeout and lying-message controls
do not qualify as successful death/effect observations. Setup/import errors and
skipped/cancelled/todo results are never treated as product regressions or PASS.
