import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeformation, stepDeformation, deformPoint } from '../src/deformation.js';

function travel(vx, vy, frames = 60) {
  const body = createDeformation(0, 0);
  for (let i = 1; i <= frames; i++) stepDeformation(body, vx * i / 60, vy * i / 60, 1 / 60);
  return body;
}
test('shape follows velocity direction and grows with speed, not travel distance', () => {
  const slow = travel(80, 0), fast = travel(900, 0), vertical = travel(0, 900), diagonal = travel(600, 600);
  assert.ok(fast.xx > slow.xx * 3); assert.ok(fast.xx > 0); assert.ok(vertical.xx < 0); assert.ok(diagonal.xy > .1);
  const a = deformPoint(90, 0, 90, 60, fast), b = deformPoint(0, 60, 90, 60, fast);
  assert.ok(a.x > 90); assert.ok(b.y < 60);
});
test('turns retain material inertia and stopping lets all deformation settle', () => {
  const body = travel(800, 0); const x = body.x, y = body.y;
  stepDeformation(body, x, y + 14, 1 / 60); assert.ok(body.xx > 0, 'a sudden turn must not instantly rotate the material');
  for (let i = 2; i <= 35; i++) stepDeformation(body, x, y + i * 14, 1 / 60);
  assert.ok(body.xx < 0, 'the shape catches up to vertical movement');
  const endX = body.x, endY = body.y;
  for (let i = 0; i < 180; i++) stepDeformation(body, endX, endY, 1 / 60);
  assert.ok(Math.abs(body.xx) < .001 && Math.abs(body.xy) < .001);
  assert.ok(Math.hypot(body.lagX, body.lagY) < .01);
});
test('contact compression follows the collision normal', () => {
  const horizontal = createDeformation(0, 0), vertical = createDeformation(0, 0);
  for (let i = 0; i < 60; i++) { stepDeformation(horizontal, 0, 0, 1 / 60, { x: 1, y: 0, amount: .2 }); stepDeformation(vertical, 0, 0, 1 / 60, { x: 0, y: 1, amount: .2 }); }
  assert.ok(horizontal.xx < -.15); assert.ok(vertical.xx > .15);
});
