/** Pinned SDK credential interpretation; the app owns the physical writer scope. */
import { StoreError } from "@oma/domain/errors";
import type { KeychainStore } from "@oma/contracts/credentials";
import type { EngineCredentials } from "./engine-auth.js";

type Blob = Record<string, Record<string, unknown>>;
type Credential = Parameters<Parameters<EngineCredentials["modify"]>[1]>[0];

function parse(text: string | undefined): Blob {
  if (text === undefined || text.length === 0) return {};
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new StoreError("STORE_CORRUPT", "the stored credential is not readable"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StoreError("STORE_CORRUPT", "the stored credential is not readable");
  return value as Blob;
}

export interface CredentialWriter {
  write<T>(run: (writer: KeychainStore) => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export function credentialStoreCredentials(store: KeychainStore, account: string, writer: CredentialWriter): EngineCredentials {
  const write = <T>(run: (store: KeychainStore) => Promise<T>, signal?: AbortSignal): Promise<T> => writer.write(run, signal);
  return {
    async read(providerId) {
      return parse(await store.get(account))[providerId] as Credential | undefined;
    },
    async list() {
      return Object.entries(parse(await store.get(account)))
        .map(([providerId, credential]) => ({ providerId, type: credential.type as "api_key" | "oauth" }));
    },
    modify(providerId, fn, options) {
      return write(async writer => {
        const blob = parse(await writer.get(account));
        const next = await fn(blob[providerId] as Credential | undefined);
        if (next === undefined) return blob[providerId] as Credential | undefined;
        await writer.put(account, JSON.stringify({ ...blob, [providerId]: next }));
        return next;
      }, options?.signal);
    },
    delete(providerId, options) {
      return write(async writer => {
        const blob = parse(await writer.get(account));
        if (!(providerId in blob)) return;
        const { [providerId]: _gone, ...rest } = blob;
        await writer.put(account, JSON.stringify(rest));
      }, options?.signal);
    },
  } as EngineCredentials;
}
