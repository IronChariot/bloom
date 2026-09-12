const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function placeLabel(anchor, width, obstacles, viewport) {
  const height = 26, candidates = [];
  for (let ring = 0; ring < 16; ring++) {
    const distance = 18 + ring * 22;
    for (const angle of [-Math.PI / 2, -Math.PI / 4, Math.PI / 4, Math.PI / 2, -3 * Math.PI / 4, 3 * Math.PI / 4, 0, Math.PI]) {
      const box = { x: Math.max(8, Math.min(viewport.w - width - 8, anchor.x + Math.cos(angle) * (anchor.rx + distance + width / 2) - width / 2)), y: Math.max(84, Math.min(viewport.h - 60, anchor.y + Math.sin(angle) * (anchor.ry + distance + height / 2) - height / 2)), w: width, h: height };
      const hits = obstacles.filter(o => overlaps(box, o)).length;
      if (!hits) return box;
      candidates.push({ ...box, hits });
    }
  }
  return candidates.sort((a, b) => a.hits - b.hits)[0];
}

export function createPresenceView({ getState, getPhysical, radius, worldToClient }) {
  const layer = document.createElement('div'); layer.id = 'collaboration-labels'; layer.setAttribute('aria-live', 'polite'); document.body.append(layer);
  let last = 0, hadTargets = false;
  return function render(now = performance.now(), force = false) {
    if (!force && now - last < 100) return; last = now;
    const state = getState(), graph = state?.graph, physical = getPhysical();
    const people = (state?.presence || []).filter(p => p.sessionId !== state.sessionId && p.expires > Date.now());
    const targets = new Map();
    for (const person of people) {
      const entries = person.ids.map(id => ({ id, kind: person.kind, editing: false }));
      if (person.editing && person.editExpires > Date.now()) entries.push({ id: person.editing, kind: 'nodes', editing: true });
      for (const target of entries) {
        const key = `${target.kind}:${target.id}`;
        if (!targets.has(key)) targets.set(key, { ...target, people: new Map() });
        const names = targets.get(key).people;
        names.set(person.userId, { name: person.name, editing: target.editing || names.get(person.userId)?.editing });
      }
    }
    if (!targets.size && !hadTargets) { layer.replaceChildren(); return; }
    hadTargets = targets.size > 0;
    document.querySelectorAll('[data-node]').forEach(el => el.classList.toggle('remote-selected', targets.has(`nodes:${el.dataset.node}`)));
    document.querySelectorAll('[data-edge]').forEach(el => el.classList.toggle('remote-selected', targets.has(`edges:${el.dataset.edge}`)));
    if (!graph) { layer.replaceChildren(); return; }
    const obstacles = graph.nodes.flatMap(n => {
      const p = physical.get(n.id); if (!p) return [];
      const pos = worldToClient(p.x, p.y), r = radius(n), scale = Math.abs(worldToClient(1, 0).x - worldToClient(0, 0).x), extra = n.petals?.length ? 38 : 8;
      return [{ x: pos.x - (r.rx + extra) * scale, y: pos.y - (r.ry + extra) * scale, w: (r.rx + extra) * scale * 2, h: (r.ry + extra) * scale * 2, id: n.id }];
    });
    for (const el of document.querySelectorAll('.toolbar,.selection-actions:not(.hidden),.zoom-bar,.toast:not(.hidden),.draft-recovery')) {
      const box = el.getBoundingClientRect(); obstacles.push({ x: box.x - 4, y: box.y - 4, w: box.width + 8, h: box.height + 8 });
    }
    const used = new Set();
    for (const [key, target] of targets) {
      let anchor;
      if (target.kind === 'nodes') {
        const box = obstacles.find(o => o.id === target.id); if (!box) continue;
        anchor = { x: box.x + box.w / 2, y: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 };
      } else {
        const edge = graph.edges.find(e => e.id === target.id), a = edge && physical.get(edge.source), b = edge && physical.get(edge.target); if (!a || !b) continue;
        anchor = { ...worldToClient((a.x + b.x) / 2, (a.y + b.y) / 2), rx: 0, ry: 0 };
      }
      if (anchor.x < -100 || anchor.x > innerWidth + 100 || anchor.y < -100 || anchor.y > innerHeight + 100) continue;
      used.add(key);
      let el = [...layer.children].find(el => el.dataset.target === key);
      if (!el) { el = document.createElement('div'); el.className = 'remote-selection-label'; el.dataset.target = key; layer.append(el); }
      const label = [...target.people.values()].map(p => `${p.name}${p.editing ? ' · editing' : ''}`).join(', ');
      if (el.textContent !== label) el.textContent = label;
      el.title = label;
      const box = placeLabel(anchor, Math.min(240, el.scrollWidth || 130), obstacles, { w: innerWidth, h: innerHeight });
      el.style.left = `${box.x}px`; el.style.top = `${box.y}px`;
      obstacles.push(box);
    }
    [...layer.children].forEach(el => { if (!used.has(el.dataset.target)) el.remove(); });
  };
}
