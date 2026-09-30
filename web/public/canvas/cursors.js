import { collaboratorColor } from './collaborators.js';

// Remote cursors arrive about 14 times a second, unevenly. Drawing each one slightly in the past
// and blending between the two surrounding samples makes the movement continuous.
export const CURSOR_DELAY = 110;
const MAX_SAMPLES = 12;

export function samplePosition(samples, at) {
  if (!samples.length) return null;
  if (at <= samples[0].t) return samples[0];
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1], b = samples[i];
    if (at >= a.t && at <= b.t) { const k = b.t === a.t ? 1 : (at - a.t) / (b.t - a.t); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }
  }
  return samples.at(-1);
}

export function createCursorLayer({ worldToClient }) {
  const layer = document.createElement('div'); layer.id = 'remote-cursors'; layer.setAttribute('aria-hidden', 'true'); document.body.append(layer);
  const peers = new Map();
  function element(peer) {
    const el = document.createElement('div'); el.className = 'remote-cursor';
    el.innerHTML = '<svg viewBox="0 0 16 20" width="16" height="20"><path d="M1.5 1.5v15.2l4.1-3.9 2.7 5.9 2.6-1.2-2.7-5.8 5.6-.4z"/></svg><span class="remote-cursor-name"></span>';
    layer.append(el); return el;
  }
  return {
    update({ id, x, y, name, color, userId }, now = performance.now()) {
      let peer = peers.get(id);
      if (!peer) { peer = { samples: [], el: null }; peers.set(id, peer); }
      Object.assign(peer, { name, userId, color: collaboratorColor(color) });
      if (x === null || y === null || x === undefined) { peer.samples = []; return; }
      // Coming back after being hidden should not glide in from the old spot.
      if (!peer.samples.length) peer.samples.push({ t: now - CURSOR_DELAY - 1, x, y });
      peer.samples.push({ t: now, x, y });
      if (peer.samples.length > MAX_SAMPLES) peer.samples.splice(0, peer.samples.length - MAX_SAMPLES);
    },
    remove(id) { const peer = peers.get(id); peer?.el?.remove(); peers.delete(id); },
    clear() { for (const id of [...peers.keys()]) this.remove(id); },
    // The latest known board position for anyone with this account, for "go to this person".
    locate(userId) { for (const peer of peers.values()) if (peer.userId === userId && peer.samples.length) return peer.samples.at(-1); return null; },
    render(now = performance.now()) {
      for (const peer of peers.values()) {
        const point = samplePosition(peer.samples, now - CURSOR_DELAY);
        const screen = point && worldToClient(point.x, point.y);
        const visible = !!screen && screen.x > -20 && screen.y > 60 && screen.x < innerWidth + 20 && screen.y < innerHeight + 20;
        if (!visible) { if (peer.el) peer.el.hidden = true; continue; }
        peer.el ||= element(peer); peer.el.hidden = false;
        const label = peer.el.lastChild; if (label.textContent !== peer.name) label.textContent = peer.name;
        peer.el.style.setProperty('--person', peer.color);
        peer.el.style.transform = `translate(${screen.x}px,${screen.y}px)`;
        // Drop samples nobody will read again, keeping one before the drawing time to blend from.
        while (peer.samples.length > 2 && peer.samples[1].t < now - CURSOR_DELAY) peer.samples.shift();
      }
    }
  };
}
