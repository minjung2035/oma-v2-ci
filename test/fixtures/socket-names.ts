/** Unix transport names only: metadata keeps its canonical scratchpad paths.
 * The parent holds this directory until services and CLI children have ended. */
import { closeSync, constants, openSync } from "node:fs";
import { Server, Socket } from "node:net";
import { isAbsolute, relative, join } from "node:path";

const redirects = new Map<symbol, { root: string; alias: string }>();
let restoreHooks: (() => void) | undefined;

function redirect(root: string, alias: string): () => void {
  const owner = Symbol();
  redirects.set(owner, { root, alias });
  if (restoreHooks === undefined) restoreHooks = installHooks();
  return () => {
    redirects.delete(owner);
    if (redirects.size === 0) { restoreHooks?.(); restoreHooks = undefined; }
  };
}

function installHooks(): () => void {
  const path = (value: unknown): unknown => {
    if (typeof value !== "string" || Buffer.byteLength(value) < 100) return value;
    for (const { root, alias } of Array.from(redirects.values()).reverse()) {
      const inside = relative(root, value);
      if (inside && inside !== ".." && !inside.startsWith("../") && !isAbsolute(inside)) return join(alias, inside);
    }
    return value;
  };
  const argumentsFor = (args: any[]): any[] => {
    const first = args[0];
    if (Array.isArray(first)) return [Object.assign([...first], first, { 0: argumentsFor(first)[0] }), ...args.slice(1)];
    if (typeof first === "string") return [path(first), ...args.slice(1)];
    if (first && typeof first === "object" && typeof first.path === "string") return [{ ...first, path: path(first.path) }, ...args.slice(1)];
    return args;
  };
  const listen = Server.prototype.listen, connect = Socket.prototype.connect;
  Server.prototype.listen = function (this: Server, ...args: any[]) { return Reflect.apply(listen, this, argumentsFor(args)); } as typeof listen;
  Socket.prototype.connect = function (this: Socket, ...args: any[]) { return Reflect.apply(connect, this, argumentsFor(args)); } as typeof connect;
  return () => { Server.prototype.listen = listen; Socket.prototype.connect = connect; };
}

/** The CLI preloader uses only its fixture parent's already-held descriptor. */
if (process.platform === "linux" && process.env.OMA_TEST_SOCKET_ROOT && process.env.OMA_TEST_SOCKET_ALIAS)
  redirect(process.env.OMA_TEST_SOCKET_ROOT, process.env.OMA_TEST_SOCKET_ALIAS);

export function holdSocketNames(root: string): { readonly env: Record<string, string>; close(): void } {
  if (process.platform !== "linux") return { env: {}, close() {} };
  const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const alias = `/proc/${process.pid}/fd/${fd}`;
  const restore = redirect(root, alias);
  let closed = false;
  return { env: { OMA_TEST_SOCKET_ROOT: root, OMA_TEST_SOCKET_ALIAS: alias }, close() {
    if (closed) return;
    closed = true;
    restore();
    closeSync(fd);
  } };
}
