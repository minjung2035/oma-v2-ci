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
VM/storage power loss. WP02.02–05 must finish the independent effect observations,
bounded reusable checkpoint driver, negative controls, failure matrix and lane
registration before WP02 is complete. Existing systemd exclusions are unchanged.
