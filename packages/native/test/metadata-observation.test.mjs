import test from "node:test";
import assert from "node:assert/strict";
import { decodeMetadataObservation } from "../dist/metadata-observation.js";

test("directory metadata helper protocol rejects absent, truncated, extra and noncanonical observations", () => {
  for (const [size, flags, acl] of [[0n, 0, false], [1n, 1, true], [9007199254740993n, 2147483648, false], [9223372036854775807n, 4294967295, true]])
    assert.deepEqual(decodeMetadataObservation(Buffer.from(`${size} ${flags} ${Number(acl)}\n`)),
      { extendedAttributeBytes: size, darwin: { bsdFlags: flags, aclPresent: acl } });
  for (const text of ["", "0", "0\n", "0 0 0", "0 0 0\n\n", "0 0 0\n1 1 1\n", "00 0 0\n", "+0 0 0\n", "-1 0 0\n",
    " 0 0 0\n", "0 0 0 \n", "0 0 0\r\n", "0\t0 0\n", "1.0 0 0\n", "1e3 0 0\n", "NaN 0 0\n",
    "9223372036854775808 0 0\n", "18446744073709551615 0 0\n", "0 4294967296 0\n", "0 -1 0\n", "0 00 0\n",
    "0 0 true\n", "0 0 2\n", "0 0 -1\n", "0 0 00\n", "0 0 0\0\n", "０ 0 0\n"])
    assert.throws(() => decodeMetadataObservation(Buffer.from(text)), /invalid/);
  assert.throws(() => decodeMetadataObservation(Buffer.from([0xb0, 0x20, 0x30, 0x20, 0x30, 0x0a])), /invalid/);
});
