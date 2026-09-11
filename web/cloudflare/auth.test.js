import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { cloudflareIdentity, verifyAccessIdentity } from './auth.js';
import { withIdentity, getAuthenticatedUser } from '../lib/identity.js';

test('Access identity requires a valid signature, issuer, audience, expiry and user identity', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test'; jwk.alg = 'RS256';
  const keys = createLocalJWKSet({ keys: [jwk] });
  const issuer = 'https://bloom-test.cloudflareaccess.com', aud = 'bloom-test';
  const sign = (claims = {}, ttl = '1h') => new SignJWT({ type: 'app', email: 'Owner@Example.com', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('owner').setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(ttl).sign(privateKey);
  const token = await sign();
  assert.equal((await verifyAccessIdentity(token, issuer, aud, keys)).userId, 'email:owner@example.com');
  assert.equal(await verifyAccessIdentity(token, issuer, 'different-app', keys), null);
  assert.equal(await verifyAccessIdentity(token, 'https://other.cloudflareaccess.com', aud, keys), null);
  assert.equal(await verifyAccessIdentity(await sign({}, '-1h'), issuer, aud, keys), null);
  assert.equal(await verifyAccessIdentity(await sign({ email: null }), issuer, aud, keys), null);
  assert.equal(await verifyAccessIdentity(await sign({ type: 'service' }), issuer, aud, keys), null);
  assert.equal(await verifyAccessIdentity(token.slice(0, -8) + 'tampered', issuer, aud, keys), null);
  const forged = new Request('https://bloom.example/api/me', { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com' } });
  assert.equal(await cloudflareIdentity(forged, { ACCESS_ISSUER: issuer, ACCESS_AUD: aud }), null);
  await assert.rejects(() => cloudflareIdentity(forged, {}), /setup is incomplete/);
});

test('concurrent requests cannot borrow another user identity', async () => {
  const users = ['owner', 'guest', null];
  const result = await Promise.all(users.map(user => withIdentity(user, async () => { await new Promise(resolve => setTimeout(resolve, 5)); return getAuthenticatedUser(); })));
  assert.deepEqual(result, users); assert.equal(await getAuthenticatedUser(), null);
});
