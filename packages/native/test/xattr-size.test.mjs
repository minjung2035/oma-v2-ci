import test from "node:test";
import assert from "node:assert/strict";
import { decodeXattrSize } from "../dist/xattr-size.js";

test("directory xattr helper protocol rejects absent, truncated, extra and noncanonical observations", () => {
  for (const n of [0n, 1n, 9007199254740993n, 9223372036854775807n])
    assert.equal(decodeXattrSize(Buffer.from(`${n}\n`)), n);
  for (const text of ["", "0", "0\n\n", "0\n1\n", "00\n", "+0\n", "-1\n", " 0\n", "0 \n", "0\r\n",
    "1.0\n", "1e3\n", "NaN\n", "9223372036854775808\n", "18446744073709551615\n", "0\0\n", "０\n"])
    assert.throws(() => decodeXattrSize(Buffer.from(text)), /invalid/);
  assert.throws(() => decodeXattrSize(Buffer.from([0xb0, 0x0a])), /invalid/);
});
