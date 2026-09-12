export function displayName(state, identity, fallback = identity || 'Unknown author') {
  if (!identity) return fallback;
  const key = identity.includes('@') && !identity.startsWith('email:') ? `email:${identity}` : identity;
  const member = state?.members?.find(m => m.id === key);
  if (member) return member.name;
  if (Object.hasOwn(state?.attribution || {}, key)) return state.attribution[key];
  return fallback.startsWith('email:') ? fallback.slice(6) : fallback;
}
