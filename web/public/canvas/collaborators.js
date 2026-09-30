// Each board member has a colour slot (0–7) from the server. These are dark enough for white
// initials and read as people rather than as blob fills, which use the lighter palette.
export const COLLABORATOR_COLORS = ['#dc2626', '#2563eb', '#15803d', '#9333ea', '#c2410c', '#be185d', '#0f766e', '#a16207'];
export const collaboratorColor = slot => COLLABORATOR_COLORS[(((Number(slot) || 0) % 8) + 8) % 8];
export const ACTIVE_MS = 45000;

export function initials(name) {
  // Many display names are email addresses: the domain says nothing about the person.
  const words = String(name || '?').trim().split('@')[0].split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words.length > 1 ? words.at(-1)[0] : words[0]?.[1] || '')).toUpperCase();
}

// Who is here, you first, then whoever was seen most recently.
export function activePeople(members = [], me, now = Date.now()) {
  return members.filter(m => m.id === me || now - m.seen < ACTIVE_MS)
    .sort((a, b) => (b.id === me) - (a.id === me) || b.seen - a.seen);
}

// A compact column of initials in the bottom-right corner, growing upwards.
// Choosing someone else goes to where they are on the board.
export function renderRoster(members, me, onLocate, limit = 7) {
  let roster = document.querySelector('#roster');
  if (!roster) { roster = document.createElement('div'); roster.id = 'roster'; roster.setAttribute('role', 'group'); roster.setAttribute('aria-label', 'People on this board now'); document.body.append(roster); }
  const people = activePeople(members, me);
  const shown = people.length > limit ? people.slice(0, limit - 1) : people;
  // Rebuilding on every sync would drop keyboard focus, so only redraw when something shows differently.
  const key = JSON.stringify([me, !!onLocate, people.length, shown.map(p => [p.id, p.name, p.color])]);
  if (roster.dataset.key === key) return;
  roster.dataset.key = key;
  const items = shown.map(person => {
    const mine = person.id === me, el = document.createElement(mine || !onLocate ? 'span' : 'button');
    const label = mine ? `${person.name} (you)` : onLocate ? `Go to ${person.name}` : person.name;
    el.className = 'roster-person' + (mine ? ' me' : ''); if (el.tagName === 'SPAN') el.setAttribute('role', 'img');
    el.style.setProperty('--person', collaboratorColor(person.color)); el.textContent = initials(person.name); el.title = label; el.setAttribute('aria-label', label);
    if (el.tagName === 'BUTTON') { el.type = 'button'; el.onclick = () => onLocate(person); }
    return el;
  });
  if (shown.length < people.length) {
    const more = document.createElement('span'), hidden = people.slice(shown.length);
    more.className = 'roster-person more'; more.setAttribute('role', 'img'); more.textContent = `+${hidden.length}`;
    more.title = hidden.map(p => p.name).join(', '); more.setAttribute('aria-label', `${hidden.length} more: ${more.title}`);
    items.push(more);
  }
  // Only one person (you) is not worth a corner.
  roster.hidden = people.length < 2;
  roster.replaceChildren(...items);
}
