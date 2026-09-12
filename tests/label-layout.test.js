import test from 'node:test';
import assert from 'node:assert/strict';
import { labelLayout, wrapLabel } from '../web/public/canvas/label-layout.js';
const measure = (text, font) => Array.from(text).length * font * .6;
test('deep leaf labels remain complete without shrinking below 12px', () => {
  for (const depth of [2, 4, 8, 1000]) for (const text of ['Automatic placement', 'Explore new possibilities together', 'ArchitectureAndCollaboration', 'One line\nAnother line']) {
    const label = labelLayout({ text, depth }, measure);
    assert.equal(label.truncated, false);
    assert.equal(label.lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(label.font >= 12);
    assert.ok(label.lines.every(line => measure(line, label.font) <= label.rx * 1.35));
    assert.ok(label.lines.length * label.font * 1.28 <= label.ry * 1.35 + .001);
  }
  assert.ok(labelLayout({ text: 'Idea', depth: 3 }, measure).rx < labelLayout({ text: 'Idea', depth: 2 }, measure).rx);
});
test('long-word wrapping preserves Unicode and lengthy notes have a bounded preview', () => {
  assert.equal(wrapLabel('😀'.repeat(12), 5, text => Array.from(text).length).join(''), '😀'.repeat(12));
  const label = labelLayout({ text: 'A lengthy note '.repeat(140), depth: 5 }, measure);
  assert.equal(label.truncated, true); assert.equal(label.lines.length, 8);
  assert.ok(label.lines.at(-1).endsWith('…')); assert.ok(label.rx <= 180);
});
