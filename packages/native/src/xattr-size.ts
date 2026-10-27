/** Private helper wire grammar, not evidence that an OS observation ran. */
export function decodeXattrSize(output: Buffer): bigint {
  const text = output.toString("utf8");
  if (output.length > 20 || /^(0|[1-9][0-9]{0,18})\n$/u.exec(text)?.[0] !== text)
    throw new Error("extended attribute helper returned an invalid observation");
  const size = BigInt(text.slice(0, -1));
  if (size > 0x7fff_ffff_ffff_ffffn)
    throw new Error("extended attribute helper returned an invalid size");
  return size;
}
