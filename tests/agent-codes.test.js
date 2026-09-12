import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { boardCode, codeToken } from '../web/public/canvas/agent-code.js';
import { sealToken, openToken } from '../web/lib/agent-secrets.js';

test('short board codes preserve all 256 bits and reject malformed input', () => {
  const token = randomBytes(32).toString('hex'), code = boardCode(token);
  assert.equal(code.length, 49); assert.equal(codeToken(code), token);
  for (const value of ['', 'bloom_1234', code + '=', code.toUpperCase()]) assert.throws(() => codeToken(value));
});

test('recoverable code is encrypted and bound to its board and Worker secret', async () => {
  const token = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex');
  const sealed = await sealToken(token, secret, 'board-a');
  assert.equal(await openToken(sealed, secret, 'board-a'), token);
  assert.notEqual(await sealToken(token, secret, 'board-a'), sealed);
  assert.ok(!sealed.includes(token));
  await assert.rejects(openToken(sealed, secret, 'board-b'));
  await assert.rejects(openToken(sealed, randomBytes(32).toString('hex'), 'board-a'));
  const bytes = Buffer.from(sealed, 'base64'); bytes[15] ^= 1;
  await assert.rejects(openToken(bytes.toString('base64'), secret, 'board-a'));
});
