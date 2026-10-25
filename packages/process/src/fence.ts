import { fstatSync } from "node:fs";

export const SOCIETY_FENCE_ENV = "OMA_SOCIETY_FENCE_FD";
export const SOCIETY_FENCE_FD = 4;
export function inheritedFence(env: Readonly<NodeJS.ProcessEnv> = process.env): number | undefined {
  const declared = env[SOCIETY_FENCE_ENV];
  if (declared === undefined) return undefined;
  if (!/^[0-9]{1,4}$/.test(declared)) throw new Error(`${SOCIETY_FENCE_ENV} is not a descriptor number`);
  const fd = Number(declared);
  let kind;
  try { kind = fstatSync(fd); }
  catch { throw new Error(`${SOCIETY_FENCE_ENV} names descriptor ${fd}, which is not open`); }
  if (!kind.isSocket()) throw new Error(`${SOCIETY_FENCE_ENV} names descriptor ${fd}, which is not the society lease`);
  return fd;
}
export function fencedStdio<T>(base: readonly T[], channel: "ignore" | "pipe", fence: number | undefined): (T | "ignore" | "pipe" | number)[] {
  if (fence === undefined) return channel === "pipe" ? [...base, channel] : [...base];
  const stdio: (T | "ignore" | "pipe" | number)[] = [...base];
  while (stdio.length < SOCIETY_FENCE_FD - 1) stdio.push("ignore");
  stdio.push(channel, fence);
  return stdio;
}
