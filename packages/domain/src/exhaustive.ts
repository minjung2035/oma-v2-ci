/** Compile-time closed-union coverage; no decoding or recovery policy. */
export function assertNever(value: never): never {
  throw new TypeError(`unhandled closed variant: ${String(value)}`);
}
