import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** One session's complete tool invocations, including all diagnostics routes. */
export declare class LspSessionScope {
    #private;
    assertOpen(): void;
    context<T extends ExtensionContext>(ctx: T): T;
    run<T>(caller: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
