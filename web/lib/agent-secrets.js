// The owner may copy the same board code again without revoking existing grants.
// Its recoverable copy is encrypted with a Worker secret, separate from D1.
async function key(secret) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('Agent code storage is not configured.');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), v => parseInt(v, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealToken(token, secret, boardId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(boardId) }, await key(secret), new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(ciphertext)));
}
export async function openToken(sealed, secret, boardId) {
  const bytes = Uint8Array.from(atob(sealed), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(boardId) }, await key(secret), bytes.slice(12));
  return new TextDecoder().decode(plaintext);
}
