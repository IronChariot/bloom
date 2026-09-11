// Motion-driven shape springs. Positions are canvas pixels; time is seconds.
const limit = (value, max) => Math.max(-max, Math.min(max, value));
export function createDeformation(x, y) {
  return { x, y, vx: 0, vy: 0, xx: 0, xy: 0, lagX: 0, lagY: 0, dxx: 0, dxy: 0, dlagX: 0, dlagY: 0 };
}
function spring(body, key, target, dt, stiffness = 180, damping = 17) {
  const velocity = `d${key}`;
  body[velocity] += ((target - body[key]) * stiffness - body[velocity] * damping) * dt;
  body[key] += body[velocity] * dt;
}
export function stepDeformation(body, x, y, seconds, contact = null) {
  const dt = Math.max(1 / 240, Math.min(1 / 30, seconds));
  const alpha = 1 - Math.exp(-24 * dt);
  const vx = body.vx + (limit((x - body.x) / dt, 2400) - body.vx) * alpha;
  const vy = body.vy + (limit((y - body.y) / dt, 2400) - body.vy) * alpha;
  const ax = (vx - body.vx) / dt, ay = (vy - body.vy) / dt;
  body.x = x; body.y = y; body.vx = vx; body.vy = vy;
  const speed = Math.hypot(vx, vy), nx = speed > .01 ? vx / speed : 0, ny = speed > .01 ? vy / speed : 0;
  const stretch = .25 * (1 - Math.exp(-speed / 850));
  let xx = stretch * (nx * nx - ny * ny), xy = stretch * 2 * nx * ny;
  if (contact) { xx -= contact.amount * (contact.x ** 2 - contact.y ** 2); xy -= contact.amount * 2 * contact.x * contact.y; }
  spring(body, 'xx', limit(xx, .32), dt);
  spring(body, 'xy', limit(xy, .32), dt);
  // The material lags acceleration; on release that stored energy rebounds.
  spring(body, 'lagX', limit(-ax * .0025 - vx * .009, 22), dt, 150, 14);
  spring(body, 'lagY', limit(-ay * .0025 - vy * .009, 22), dt, 150, 14);
  return body;
}
export function deformPoint(x, y, rx, ry, body, grab = null) {
  const xx = limit(body.xx, .38), xy = limit(body.xy, .38);
  const area = Math.sqrt(Math.max(.5, 1 - xx * xx - xy * xy));
  const alongGrab = grab ? (x / rx * grab.x + y / ry * grab.y) : 0;
  const lagWeight = grab ? .5 * (1 - limit(alongGrab, 1)) : .65;
  return {
    x: ((1 + xx) * x + xy * y) / area + limit(body.lagX, rx * .24) * lagWeight,
    y: (xy * x + (1 - xx) * y) / area + limit(body.lagY, ry * .24) * lagWeight
  };
}
