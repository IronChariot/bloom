import test from 'node:test';
import assert from 'node:assert/strict';
import { labelLayout, wrapLabel, MIN_LABEL_FONT } from '../web/public/canvas/label-layout.js';
const measure = (text, font) => Array.from(text).length * font * .6;
test('deep leaf labels remain complete shrink only as needed and remain above the minimum', () => {
  for (const depth of [2, 4, 8, 1000]) for (const text of ['Automatic placement', 'Explore new possibilities together', 'ArchitectureAndCollaboration', 'One line\nAnother line']) {
    const label = labelLayout({ text, depth }, measure);
    assert.equal(label.truncated, false);
    assert.equal(label.lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(label.font >= MIN_LABEL_FONT);
    assert.ok(label.lines.every(line => measure(line, label.font) <= label.rx * 1.7));
    assert.ok(label.lines.length * label.font * 1.28 <= label.ry * 1.35 + .001);
  }
  assert.ok(labelLayout({ text: 'Idea', depth: 3 }, measure).rx < labelLayout({ text: 'Idea', depth: 2 }, measure).rx);
});
test('long-word wrapping preserves Unicode and lengthy notes have a bounded preview', () => {
  assert.equal(wrapLabel('😀'.repeat(12), 5, text => Array.from(text).length).join(''), '😀'.repeat(12));
  const label = labelLayout({ text: 'A lengthy note '.repeat(140), depth: 5 }, measure);
  assert.equal(label.truncated, true); assert.equal(label.font, MIN_LABEL_FONT);
  assert.ok(label.lines.at(-1).endsWith('…')); assert.ok(label.rx <= 180);
});

test('overflow shrinks text inside fixed bubble dimensions before ellipsizing', () => {
  const short = labelLayout({ text: 'An ordinary moderately long useful label', depth: 2 }, measure);
  const long = labelLayout({ text: 'An ordinary moderately long label with some extra helpful detail', depth: 2 }, measure);
  assert.equal(short.rx, long.rx); assert.equal(short.ry, long.ry);
  assert.ok(long.font < short.font);
  assert.equal(long.truncated, false);
});


test('central words stay intact and oversized words shrink before splitting', () => {
  for (const depth of [0, 1, 2, 3, 4]) {
    const label = labelLayout({text:'Hallucinations?',depth}, measure);
    assert.deepEqual(label.lines, ['Hallucinations?']);
    assert.equal(label.truncated, false);
  }
  const pieces = wrapLabel('Hallucinations?', 13, text => text.length);
  assert.equal(pieces.join(''), 'Hallucinations?');
  assert.ok(pieces.every(piece => piece.length >= 6));
  const family = '👨‍👩‍👧‍👦';
  assert.deepEqual(wrapLabel(family.repeat(3), 1, text => [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length), [family, family, family]);
});
