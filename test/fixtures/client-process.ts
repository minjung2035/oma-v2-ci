import type { Client } from "@oma/client";
import { fileURLToPath } from "node:url";

/** Execute the actual client and production input effects in a fresh process.
 * Calls take serializable API arguments, never command words or builder callbacks. */
export function clientCall<M extends Exclude<keyof Client, "effect" | "requestReceipt">>(method: M, ...args: Parameters<Client[M]>): string {
  return `client[${JSON.stringify(method)}](...${JSON.stringify(args)})`;
}

export function clientProcessArgs(expression: string): string[] {
  return ["--input-type=module", "-e", clientProcessSource(expression)];
}

export function clientProcessSource(expression: string): string {
  return `import { Client, ClientError } from ${JSON.stringify(fileURLToPath(new URL(import.meta.resolve("@oma/client"))))};
import ${JSON.stringify(fileURLToPath(new URL(import.meta.resolve("#oma-test/app/runtime/client-preload"))))};
const client = new Client({ cwd: process.cwd(), env: process.env });
try {
  const value = await (${expression});
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
} catch (error) {
  if (!(error instanceof ClientError)) throw error;
  if (error.receipt !== undefined) process.stdout.write(JSON.stringify({request:error.request, receipt:error.receipt}));
  process.stderr.write(error.message);
  process.exitCode = error.exitCode;
}`;
}
