# Contract owners — P2

`../contracts.ts` remains the compatibility/spec facade. Its 67 public type names,
68 original declarations (including the private request envelope), wire method
sets, field optionality, v1 persisted plans and closed error/config vocabularies
are unchanged. These files are normative declarations, not new services.

Dependency direction (arrows mean imports):

```text
public-wire    -> durable, runtime, values, identity, errors
internal-wire  -> runtime, values, identity, errors
durable        -> host, values, identity, errors
host           -> values, identity
runtime        -> identity
errors, values -> identity
identity       -> canonical capability owner (type only)
host           -> canonical resource/limit owners (type only)
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
