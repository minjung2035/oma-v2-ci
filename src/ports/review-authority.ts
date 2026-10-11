/** Synchronous pre-CAS authority, independent of review preparation or advancement. */
import type { OperationId } from "../../implementation/contracts/identity.js";
export interface ReviewAuthority { assertApplicable(request: OperationId): void }
