# Retired systemd reference

The original sources and Linux adapter tests at `6c53a0ac3b83bfeff268f197cd52b238794b140c` are retained byte-for-byte for historical evidence. They are outside production and do not qualify native execution. Native runtime uses the common TypeScript execution owner and independently observed namespace init.

Additional raw references copied from `65233ca4330143638b9845d5307f87509894ad04` during regression migration preserve their original bytes and IDs; they are not new native PASS claims. The initial snapshot above is unchanged. The initial dirty work remains separately backed up.

- The removed unused domain cgroup parser and its parser test/corpus are historical only. Candidate setup now has fatal EOF/protocol poisoning and fragmentation/fuzz oracles under its current public owner.
- Unit ownership/rendering, manager parsers and journald tests retain their original meanings here. Current actual replacements include `NATIVE-RESIDENT-ISOLATION-01`, `NATIVE-RESIDENT-STATUS-01`, native log storage, and native broker entry topology. P0V IDs are not reassigned to those mechanisms.
- CLI and audit2 retain their request-key, stream, capability, receipt and data assertions, now using a real namespace/PID2/private control socket; they do not use fabricated authentication or death. The scripted trusted driver is not the production Worker/Pi. Separate native scenarios exercise that product entry.
- The former Principal relay and candidate systemd timeout cases remain historical. `NATIVE-CANDIDATE-DR37` exercises actual networking, checks beyond the old cap, owner/request cancellation and whole namespace death. No timeout policy is restored.
- Policy-only Store/transaction/endpoint tests grant no kernel evidence. The outer native lifetime refusal still retains the Store and ownership lock.
