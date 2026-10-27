/** P0-2/P0-4: one native-module generation for an explicitly loaded extension
 * set. Pi clears its factory cache; Node's native ESM cache needs a new identity.
 * Relative ESM dependencies follow their parent's generation, including late
 * imports. Engine packages and unrelated modules retain their normal identity. */
import { randomUUID } from "node:crypto";
import { registerHooks, type ModuleHooks } from "node:module";
import { pathToFileURL } from "node:url";

const GENERATION = "oma-extension";
export class ExtensionModules {
  private readonly id = randomUUID();
  private generation = 0;
  private paths = new Set<string>();
  private readonly hooks: ModuleHooks;
  private closed = false;
  constructor(paths: readonly string[]) {
    this.refresh(paths);
    this.hooks = registerHooks({ resolve: (specifier, context, next) => {
      const result = next(specifier, context);
      if (result.format !== "module" || !result.url.startsWith("file:")) return result;
      const url = new URL(result.url), parent = context.parentURL === undefined ? undefined : new URL(context.parentURL);
      const inherited = parent?.searchParams.get(GENERATION);
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const generation = relative && inherited?.startsWith(`${this.id}:`) ? inherited
        : this.paths.has(result.url) ? `${this.id}:${this.generation}` : undefined;
      if (generation === undefined) return result;
      url.searchParams.set(GENERATION, generation);
      return { ...result, url: url.href };
    } });
  }
  refresh(paths: readonly string[]): void {
    if (this.closed) throw new Error("Extension module owner is closed");
    const next = new Set(paths.map(path => pathToFileURL(path).href));
    this.paths = next;
    this.generation++;
  }
  close(): void {
    if (this.closed) return;
    this.hooks.deregister();
    this.closed = true;
  }
}
