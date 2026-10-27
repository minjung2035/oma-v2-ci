/** Private native observations, not proof that the helper or kernel ran. Linux
 * observes its ACLs through xattrs and does not invent Darwin-only facts. */
export interface EntryMetadataObservation {
  readonly extendedAttributeBytes: bigint;
  readonly darwin: { readonly bsdFlags: number; readonly aclPresent: boolean } | null;
}
export function decodeMetadataObservation(output: Buffer): EntryMetadataObservation {
  const text = output.toString("utf8");
  const match = /^(0|[1-9][0-9]{0,18}) (0|[1-9][0-9]{0,9}) ([01])\n$/u.exec(text);
  if (output.length > 34 || match?.[0] !== text)
    throw new Error("metadata helper returned an invalid observation");
  const size = BigInt(match[1]!), flags = Number(match[2]);
  if (size > 0x7fff_ffff_ffff_ffffn || flags > 0xffff_ffff)
    throw new Error("metadata helper returned an invalid size or flags");
  return { extendedAttributeBytes: size, darwin: { bsdFlags: flags, aclPresent: match[3] === "1" } };
}
