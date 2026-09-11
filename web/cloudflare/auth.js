import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();
export async function verifyAccessIdentity(token, issuer, audience, keys) {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'] });
    if (payload.type !== 'app' || typeof payload.email !== 'string' || !payload.email || typeof payload.sub !== 'string') return null;
    const email = payload.email.toLowerCase();
    return { userId: `email:${email}`, email, displayName: email, fullName: null };
  } catch { return null; }
}
export async function cloudflareIdentity(request, env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) throw Object.assign(new Error('Cloudflare Access setup is incomplete.'), { status: 503 });
  const issuer = new URL(env.ACCESS_ISSUER);
  if (issuer.protocol !== 'https:' || !issuer.hostname.endsWith('.cloudflareaccess.com') || issuer.pathname !== '/') throw new Error('Invalid Access issuer configuration.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const origin = issuer.origin;
  if (!keySets.has(origin)) keySets.set(origin, createRemoteJWKSet(new URL('/cdn-cgi/access/certs', origin)));
  return verifyAccessIdentity(token, origin, env.ACCESS_AUD, keySets.get(origin));
}
