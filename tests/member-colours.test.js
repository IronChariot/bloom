import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph } from '../web/lib/graph.js';

test('each member keeps a distinct board colour, reused only after someone leaves', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
  const db = {
    prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return {
      first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: stmt.run(...args) })
    }; } }; },
    async batch(statements) { const results = []; for (const s of statements) results.push(await s.run()); return results; }
  };
  globalThis.__bloomColourEnv = { DB: db };
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env = globalThis.__bloomColourEnv;', shortCircuit: true } : next(specifier, context); } });
  try {
    const { handleApi } = await import('../web/lib/boards.js');
    const person = name => ({ userId: name, displayName: name });
    const api = (who, segments, body) => withIdentity(who, () => handleApi(new Request(`https://bloom.test/api/${segments.join('/')}`, body === undefined ? {} : { method: 'POST', headers: { Origin: 'https://bloom.test' }, body: JSON.stringify(body) }), segments));
    const owner = person('owner'), { id } = await api(owner, ['boards'], { graph: newGraph(true) });
    const { token } = await api(owner, ['boards', id, 'invite'], {});
    for (const name of ['ada', 'bo', 'cy']) await api(person(name), ['boards', id, 'join'], { token });
    await api(person('ada'), ['boards', id, 'join'], { token });
    const colours = async () => Object.fromEntries((await api(owner, ['boards', id])).members.map(m => [m.id, m.color]));
    assert.deepEqual(await colours(), { owner: 0, ada: 1, bo: 2, cy: 3 }, 'joining again keeps your colour');
    await api(owner, ['boards', id, 'member'], { userId: 'bo' });
    await api(person('dee'), ['boards', id, 'join'], { token });
    assert.equal((await colours()).dee, 2, 'the freed colour goes to the next person');
    const sync = await api(owner, ['boards', id, 'sync'], { revision: 0 });
    assert.equal(sync.members.find(m => m.id === 'cy').color, 3);
  } finally { hooks.deregister(); delete globalThis.__bloomColourEnv; }
});
