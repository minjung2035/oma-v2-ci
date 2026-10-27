import type { CheckedReceipt } from "@oma/contracts/runtime";
import type { StoreError } from "./errors.js";

/** What a broker-owned settlement found. `present` and `hold` are the receipt
 * decision's own answers (D01, P0-2): the batch may be presented in the next
 * attempt, or nothing may happen until the evidence is observed or repaired. */
export type SettlementOutcome =
  | { readonly kind: "settled"; readonly receipt: CheckedReceipt }
  | { readonly kind: "completed" }
  | { readonly kind: "present" }
  | { readonly kind: "hold"; readonly error: StoreError };

