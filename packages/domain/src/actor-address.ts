import type { Actor } from "@oma/contracts/identity";
export function actorAddress(actor: Actor, society: string): string { return `${actor}@${society}.oma.invalid`; }
