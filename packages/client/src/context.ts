import { AsyncLocalStorage } from "node:async_hooks";

export interface ClientContext {
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly signal?: AbortSignal | undefined;
}
const CONTEXT = Symbol.for("oma.client.context");
const shared = globalThis as { [CONTEXT]?: AsyncLocalStorage<ClientContext> };
const storage = shared[CONTEXT] ??= new AsyncLocalStorage<ClientContext>();
export function currentContext(): ClientContext { return storage.getStore() ?? { cwd: process.cwd(), env: process.env }; }
export function inContext<T>(context: ClientContext, action: () => T): T { return storage.run(context, action); }
