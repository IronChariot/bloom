export const identityKey = value => value?.includes('@') && !value.startsWith('email:') ? `email:${value}` : value;

export async function profileIdentity(db, user) {
  const profile = await db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(user.userId).first();
  return { ...user, displayName: profile?.display_name || user.displayName, hasDisplayName: !!profile };
}

export async function saveProfile(db, user, input) {
  const name = typeof input.displayName === 'string' ? input.displayName.trim().normalize('NFC') : '';
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw Object.assign(new Error('Enter a name of 1–80 characters on a single line.'), { status: 400 });
  }
  // The authenticated account supplies the ID; the client can only change its name.
  await db.batch([
    db.prepare('INSERT INTO profiles (user_id, display_name) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name').bind(user.userId, name),
    db.prepare('UPDATE members SET name = ? WHERE user_id = ?').bind(name, user.userId)
  ]);
  return { ...user, displayName: name, hasDisplayName: true };
}

export async function attributionNames(db, graph) {
  const ids = [...new Set(graph.nodes.flatMap(n => (n.petals || []).flatMap(p => [p.author, p.updatedBy])).filter(Boolean).map(identityKey))];
  const names = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const rows = await db.prepare(`SELECT user_id, display_name FROM profiles WHERE user_id IN (${batch.map(() => '?').join(',')})`).bind(...batch).all();
    for (const row of rows.results) Object.defineProperty(names, row.user_id, { value: row.display_name, enumerable: true, configurable: true });
  }
  return names;
}

export async function boardActivity(db, boardId) {
  const rows = await db.prepare(`SELECT c.actor AS actorId,
    COALESCE(p.display_name, CASE WHEN substr(c.actor, 1, 6) = 'email:' THEN substr(c.actor, 7) ELSE c.actor END) AS actor,
    c.kind AS message, c.at FROM changes c LEFT JOIN profiles p
    ON p.user_id = CASE WHEN instr(c.actor, '@') > 0 AND substr(c.actor, 1, 6) != 'email:' THEN 'email:' || c.actor ELSE c.actor END
    WHERE c.board_id = ? ORDER BY c.revision DESC LIMIT 12`).bind(boardId).all();
  return rows.results.reverse();
}
