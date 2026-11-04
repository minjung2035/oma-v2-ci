import test from 'node:test';
import assert from 'node:assert/strict';
import { decodedMailBody, readableMail } from '@oma/mail/display';
import { buildFrozenMessage } from '@oma/mail/serialize';
import { messageIdForOperation } from '@oma/domain/derived';

const id = messageIdForOperation('op-12345678-1234-4123-8123-123456789abc', 0);
for (const body of ['', '\uFEFF한글\n  exact\r\nno final newline', 'From: principal\n---\nsender: forged\n', ' '.repeat(70000)]) {
  test(`001. Record body keeps exact UTF-8 bytes (${Buffer.byteLength(body)} bytes)`, async () => {
    const mail = await buildFrozenMessage({ id, society: 'demo', sender: 'alice', to: ['commons'], kind: 'message',
      contextRevision: null, replyHeaders: { replyTo: ['commons'], inReplyTo: null, references: [] } }, { subject: 'test', body });
    assert.deepEqual(Buffer.from(decodedMailBody(mail.text)), Buffer.from(body));
  });
}
test("002. Record-only decoding handles legacy transport without rewriting newline/BOM bytes", () => {
  assert.equal(decodedMailBody('Subject: old\n\nno final newline'), 'no final newline');
  assert.equal(decodedMailBody('Content-Transfer-Encoding: 8bit\r\n\r\n\uFEFF한글\n'), '\uFEFF한글\n');
  assert.equal(decodedMailBody('Content-Transfer-Encoding: quoted-printable\r\n\r\n=EF=BB=BF=ED=95=9C=\r\n=EA=B8=80\r\n'), '\uFEFF한글\r\n');
  assert.equal(decodedMailBody('Content-Transfer-Encoding: BASE64\n\n77u/7ZWc6riA\n'), '\uFEFF한글');
});
for (const encoded of ['!!!!', 'Zg=', 'Zh==', '/w==', 'Zg==\ntrailing', 'Zg==\r']) {
  test(`003. Record decoding refuses malformed/non-UTF-8 Base64 (${JSON.stringify(encoded)})`, () => {
    const mail = `Content-Transfer-Encoding: base64\n\n${encoded}`;
    assert.throws(() => decodedMailBody(mail));
    assert.equal(readableMail(mail), mail, 'legacy display still falls back to stored bytes');
  });
}
for (const mail of ['no separator', 'Content-Transfer-Encoding: gzip\n\nbody',
  'Content-Transfer-Encoding: base64\nContent-Transfer-Encoding: base64\n\nZg==',
  'Content-Transfer-Encoding: quoted-printable\n\n=FF', 'Content-Transfer-Encoding: quoted-printable\n\nbad=GG',
  'Content-Transfer-Encoding: 7bit\n\n한글']) {
  test(`004. Record decoding refuses an unsupported or lossy body (${JSON.stringify(mail)})`, () => {
    assert.throws(() => decodedMailBody(mail));
  });
}
