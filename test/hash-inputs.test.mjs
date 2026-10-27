import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from "@oma/domain/canonical-json";

const vectors = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
];
for (const [input, digest] of vectors) {
  test(`P0 hash overload: known SHA-256 vector ${JSON.stringify(input)}`, () => {
    assert.equal(sha256Hex(input), digest);
    assert.equal(sha256Hex(Buffer.from(input, 'utf8')), digest);
    assert.equal(sha256Hex(new Uint8Array(Buffer.from(input, 'utf8'))), digest);
  });
}
test('P0 hash overload: UTF-8 and byte view offsets retain the original hash domain', () => {
  for (const text of ['한글\n', 'a\u0000b', '\ud800', '😀']) {
    const bytes = Buffer.from(text, 'utf8');
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256Hex(text), expected);
    const backing = new Uint8Array(bytes.length + 4); backing.fill(255); backing.set(bytes, 2);
    assert.equal(sha256Hex(backing.subarray(2, bytes.length + 2)), expected);
  }
});
test('P0 hash overload: binary bytes are not decoded, normalized or mutated', () => {
  const bytes = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
  const before = bytes.slice();
  assert.equal(sha256Hex(bytes), createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
  assert.deepEqual(bytes, before);
});
