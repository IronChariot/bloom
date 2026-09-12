export function boardCode(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid board token.');
  const bytes = token.match(/../g).map(value => String.fromCharCode(parseInt(value, 16))).join('');
  return 'bloom_' + btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function codeToken(code) {
  if (!/^bloom_[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Invalid Bloom board code.');
  const token = [...atob(code.slice(6).replaceAll('-', '+').replaceAll('_', '/') + '=')]
    .map(value => value.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  if (boardCode(token) !== code) throw new Error('Invalid Bloom board code.');
  return token;
}
