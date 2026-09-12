// Moving into an occupied slot pushes neighbours clockwise into the next gap.
export function arrangePetals(petals, id, slot) {
  const result = petals.map(p => ({ ...p })), moving = result.find(p => p.id === id);
  if (!moving) throw new Error('Petal not found.');
  let displaced = result.find(p => p.id !== id && p.slot === slot);
  moving.slot = slot;
  for (let i = 0; displaced && i < 7; i++) {
    slot = (slot + 1) % 8;
    const next = result.find(p => p.id !== displaced.id && p.id !== id && p.slot === slot);
    displaced.slot = slot; displaced = next;
  }
  return result;
}
