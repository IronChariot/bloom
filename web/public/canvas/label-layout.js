const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const characters = text => Array.from(segmenter.segment(text), part => part.segment);
function splitWord(word, width, measure) {
  const parts = []; let part = '';
  for (const char of characters(word)) {
    if (part && measure(part + char) > width) { parts.push(part); part = ''; }
    part += char;
  }
  parts.push(part);
  // Avoid a tiny trailing fragment when an unbroken word cannot fit even at minimum size.
  if (parts.length > 1) {
    const i = parts.length - 2, before = characters(parts[i]); let last = parts[i + 1];
    while (before.length > 1) {
      const moved = before.at(-1) + last, remaining = before.slice(0, -1).join('');
      if (measure(moved) > width || Math.abs(measure(remaining) - measure(moved)) >= Math.abs(measure(before.join('')) - measure(last))) break;
      before.pop(); last = moved;
    }
    parts[i] = before.join(''); parts[i + 1] = last;
  }
  return parts;
}
export function wrapLabel(text, width, measure, splitWords = true) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && measure(line + ' ' + word) > width) { lines.push(line); line = ''; }
      if (measure(word) <= width) { line += (line ? ' ' : '') + word; continue; }
      if (!splitWords) { line = word; continue; }
      const parts = splitWord(word, width, measure);
      lines.push(...parts.slice(0, -1)); line = parts.at(-1);
    }
    lines.push(line || ' ');
  }
  return lines;
}

export const MIN_LABEL_FONT = 8;
export function labelLayout(node, measureText) {
  const depth = node.root ? 0 : node.depth ?? 1;
  const nominalFont = Math.max(12, 22 * .91 ** depth), scale = Math.max(.38, .8 ** depth);
  const text = node.text || ' ';
  const longest = Math.max(...text.split('\n').map(s => s.length));
  const rx = Math.min(155, Math.max(116, longest * 3.4 + 37)) * scale, ry = 90 * scale;
  let font = nominalFont, lines;
  const measure = value => measureText(value, font, !!node.root);
  // Central rows can use more of the ellipse; outer rows must respect its curved sides.
  const fits = () => lines.length * font * 1.28 <= ry * 1.35 && lines.every((line, i) => {
    const y = Math.abs(i - (lines.length - 1) / 2) * font * 1.28 + font * .7;
    const halfWidth = rx * Math.sqrt(Math.max(0, .9 ** 2 - (y / ry) ** 2));
    return measure(line) <= Math.min(rx * 1.7, halfWidth * 2);
  });
  while (true) {
    lines = wrapLabel(text, rx * 1.7, measure, false);
    if (fits() || font === MIN_LABEL_FONT) break;
    font = Math.max(MIN_LABEL_FONT, font - .5);
  }
  // Prefer shrinking intact words; break them only as a last resort at the font floor.
  if (!fits()) lines = wrapLabel(text, rx * 1.35, measure);
  const truncated = !fits();
  if (truncated) {
    lines = lines.slice(0, Math.max(1, Math.floor(ry * 1.35 / (font * 1.28))));
    let last = lines.at(-1);
    while (last && measure(last + '…') > rx * 1.35) last = characters(last).slice(0, -1).join('');
    lines[lines.length - 1] = last + '…';
  }
  return { rx, ry, font, lines, truncated };
}
