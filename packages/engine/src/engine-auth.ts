/** INF-005/008: what a confined Resident's relay needs, resolved by the engine.
 *
 * The credential lives in the engine's own agent directory, written by the
 * engine's own login flow. OMA does not read that file's format: it asks the
 * engine's public SDK to resolve a provider the same way a session would, and
 * takes the answer — origin, key, extra headers — for the relay to use. Nothing
 * resolved here is stored; it lives as long as one delivery.
 *
 * The sandbox gets a placeholder instead of the key. Provider code inspects
 * keys (the Codex provider decodes an OAuth token's claims to find the
 * account, and Anthropic chooses a header scheme from the key's prefix), so the
 * placeholder keeps the real key's shape: a token's header and claims stay, its
 * signature does not; a prefixed key keeps its prefix, its secret part does not.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";

const ALPHABET = Object.freeze({
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digit: "0123456789",
});

function randomLike(source: string): string {
  const bytes = randomBytes(source.length);
  let out = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const pick = (set: string): string => set[bytes[index]! % set.length]!;
    if (character >= "a" && character <= "z") out += pick(ALPHABET.lower);
    else if (character >= "A" && character <= "Z") out += pick(ALPHABET.upper);
    else if (character >= "0" && character <= "9") out += pick(ALPHABET.digit);
    else out += character;
  }
  return out;
}

/** WP27.04: how many candidates a key gets. A candidate differs from the key
 * unless its replaceable characters happen to come out the same; a key with
 * nothing replaceable never gets one, and is refused rather than retried. */
const PLACEHOLDER_ATTEMPTS = 8;

function candidateFor(secret: string): string {
  const parts = secret.split(".");
  if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
    // A signed token: its header and claims are what provider code reads, and
    // without a valid signature the provider rejects it, so keeping them does
    // not let anything inside authenticate.
    return `${parts[0]!}.${parts[1]!}.${randomLike(parts[2]!)}`;
  }
  // A prefixed key: keep the short leading segments that name its kind and
  // replace everything from the first long segment on, class for class.
  const segments = secret.split(/([-_])/);
  let secretStarted = false;
  const placeholder = segments.map(segment => {
    if (segment === "-" || segment === "_") return segment;
    if (!secretStarted && segment.length <= 8) return segment;
    secretStarted = true;
    return randomLike(segment);
  }).join("");
  // A key made only of short segments keeps nothing recognisable.
  return secretStarted ? placeholder : randomLike(secret);
}

/** A value the sandbox can hold in place of `secret`. It is never equal to the
 * secret and never contains it, so swapping it back is unambiguous. Total: it
 * returns within PLACEHOLDER_ATTEMPTS candidates or refuses the key. */
export function placeholderFor(secret: string): string {
  if (secret.length < 16)
    throw new StoreError("UNSUPPORTED_PROFILE", "provider key is too short to stand in for safely");
  for (let attempt = 0; attempt < PLACEHOLDER_ATTEMPTS; attempt += 1) {
    const placeholder = candidateFor(secret);
    // The engine reads a leading `$` or `!` in a configured key as an environment
    // reference or a command; a placeholder must never be either.
    if (/^[$!]/.test(placeholder) || placeholder.includes("${"))
      throw new StoreError("UNSUPPORTED_PROFILE", "provider key has a shape the engine would interpret");
    if (placeholder !== secret && !placeholder.includes(secret) && !secret.includes(placeholder)) return placeholder;
  }
  throw new StoreError("UNSUPPORTED_PROFILE", "provider key has too little that can be replaced to stand in for it safely");
}

export interface EngineAuth {
  readonly provider: string;
  readonly model: string;
  /** The provider's own base URL, before any redirection. */
  readonly origin: string;
  readonly apiKey: string;
  readonly headers: Readonly<Record<string, string>>;
  /** DR24: the engine's default effort, when the model is the engine's choice. */
  readonly thinking?: string;
}

/** The engine's own credential store, when it is not the agent directory's
 * file: on macOS the host keeps it in the Keychain (macos-platform MAC-701). */
export type EngineCredentials = NonNullable<import("@earendil-works/pi-coding-agent").CreateModelRuntimeOptions["credentials"]>;

/** Resolves a provider through the engine, reading only the OMA-owned agent
 * directory. `provider`/`model` of `pi`/`current` mean "whatever the engine
 * would pick", which is the default its own settings name. `credentials`
 * replaces the directory's credential file and nothing else: the models and
 * the default still come from the directory (macos-platform MAC-704). */
export async function resolveEngineAuth(
  agentDir: string, provider: string, model: string, credentials?: EngineCredentials,
): Promise<EngineAuth> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const runtime = await createEngineModelRuntime(agentDir, credentials);
  const registry = new sdk.ModelRegistry(runtime);
  let wantedProvider = provider;
  let wantedModel = model;
  let thinking: string | undefined;
  if (provider === "pi" && model === "current") {
    const settings = sdk.SettingsManager.create(agentDir, agentDir);
    wantedProvider = settings.getDefaultProvider() ?? "";
    wantedModel = settings.getDefaultModel() ?? "";
    thinking = settings.getDefaultThinkingLevel();
    if (wantedProvider.length === 0 || wantedModel.length === 0)
      throw new StoreError("UNSUPPORTED_PROFILE",
        "the engine has no default model yet; log in and choose one in `oma` first");
  }
  const found = registry.find(wantedProvider, wantedModel);
  if (found === undefined)
    throw new StoreError("UNSUPPORTED_PROFILE", `the engine does not know ${wantedProvider}/${wantedModel}`);
  const auth = await registry.getApiKeyAndHeaders(found);
  if (!auth.ok)
    throw new StoreError("UNSUPPORTED_PROFILE", `the engine could not authenticate ${wantedProvider}: ${auth.error}`);
  if (auth.apiKey === undefined || auth.apiKey.length === 0)
    throw new StoreError("UNSUPPORTED_PROFILE", `the engine has no credential for ${wantedProvider}; log in through \`oma\``);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(auth.headers ?? {}))
    if (typeof value === "string") headers[name] = value;
  return Object.freeze({
    provider: wantedProvider, model: wantedModel, ...(thinking === undefined ? {} : { thinking }),
    origin: auth.baseUrl ?? found.baseUrl,
    apiKey: auth.apiKey, headers: Object.freeze(headers),
  });
}

/** The SDK owns model/auth file interpretation; the caller owns any external credential helper. */
export async function createEngineModelRuntime(agentDir: string, credentials?: EngineCredentials) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  return ModelRuntime.create({
    ...(credentials === undefined ? { authPath: join(agentDir, "auth.json") } : { credentials }),
    modelsPath: join(agentDir, "models.json"), allowModelNetwork: false,
  });
}
export interface PersonalModels {
  readonly modelRuntime: Awaited<ReturnType<typeof createEngineModelRuntime>>;
  close(): Promise<void>;
}
