import { basename, isAbsolute, join } from "node:path";
import type { Receipt } from "@oma/contracts";
import { currentContext } from "./context.js";

/** DR1, SB-002-C: a path this CLI's caller is shown is in the caller's view.
 * The broker records and answers with the host's archive path; the archive
 * root this CLI's environment names -- /mail/archive/cur inside a sandbox, the
 * host's for the Principal -- is where the caller finds the message. */
export function inCallerView(receipt: Receipt, root = currentContext().env.OMA_MAIL_ARCHIVE): Receipt {
  const result = receipt.result as { archivePath?: unknown } | undefined;
  if (receipt.state !== "succeeded" || typeof result?.archivePath !== "string") return receipt;
  // mail-v1: worker-only review mail lives in the workers archive, which a
  // Resident's view binds elsewhere; it is mapped to that root the same way.
  const base = /(^|\/)mail\/workers\/cur\//.test(result.archivePath) ? currentContext().env.OMA_WORKER_ARCHIVE : root;
  if (base === undefined || !isAbsolute(base)) return receipt;
  const shown = { ...result, archivePath: join(base, basename(result.archivePath)) } as NonNullable<Receipt["result"]>;
  return { ...receipt, result: shown };
}
