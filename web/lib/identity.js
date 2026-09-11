import { AsyncLocalStorage } from 'node:async_hooks';

// Identity enters only through a verified hosting adapter, never client headers.
const identities = new AsyncLocalStorage();
export const withIdentity = (user, run) => identities.run(user, run);
export const getAuthenticatedUser = async () => identities.getStore() || null;
