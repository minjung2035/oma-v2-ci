# Contract owners — P2

`../contracts.ts` remains the compatibility/spec facade. It now exports 63 public
type names over 64 declarations (including the private request envelope). Wire
method sets, field optionality, v1 persisted plans and closed error/config
vocabularies are unchanged. These files are normative declarations, not new
services.

**Reviewed contract change, 2026-09-19 (inference).** `InferenceModule`,
`InferenceStart` and `InferenceEvent` were removed. INF-001 now places inference
with the bundled engine, so OMA declares no relay port and no provider stream
DTOs. The `usage` table and the six durable entities are unchanged; only the
relay's own surface went away.

**Reviewed contract change, 2026-09-19 (direction).** The four frozen reverse dependencies
recorded in `../contract-direction-plan.json` were removed. `Capability`,
`ResourceLimits` and `ProtocolLimits` are now declared here, and the runtime
descriptors in `src/domain/` are bound to them by compile-time exhaustiveness
checks in both directions. The `Transaction` alias was deleted rather than
replaced by a port: `StorePort.transaction` takes a zero-argument callback and
nothing consumed the contract's `Transaction`, so a port would have been an
abstraction with no caller. The golden surface below was regenerated for exactly
these four declarations and nothing else.

Dependency direction (arrows mean imports):

```text
public-wire    -> durable, runtime, values, identity, errors
internal-wire  -> runtime, values, identity, errors
durable        -> host, values, identity, errors
host           -> values, identity
runtime        -> identity
errors, values -> identity
identity       -> owns the closed capability vocabulary
host           -> owns the resource/protocol limit field names
module-contracts -> leaf contracts + existing module ports
compatibility facade -> the nine owners (type-only re-exports)
```

`values.ts` is a deliberate refinement of the proposal: common request/message
value declarations must not force durable -> public-wire -> durable. It owns the
unchanged MailInput/AgentCreateInput/context/blob/candidate values, not policy.
`module-contracts.ts` keeps compatibility module declarations out of wire and
persisted definitions. No new capability vocabulary or runtime schema is copied.

`test/fixtures/contracts-v1-surface.json` pins the original source blob and the
normalized token digest of every original declaration. Import-type paths are
compared by repository-relative identity; all other tokens participate. Token
kinds use symbolic names, not compiler-version-dependent enum numbers. It must
not be regenerated as part of normal builds. An intentional future contract
change needs a separate reviewed golden update. `contracts-ownership.test.mjs`
also checks facade names, private helper drift, leaf cycles and the architecture
checker's resolution through re-exported symbols. This syntax/equivalence test
is not a substitute for the full pinned typecheck or runtime wire fixtures.
