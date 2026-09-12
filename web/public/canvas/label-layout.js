export function wrapLabel(text, width, measure) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && measure(line + ' ' + word) > width) { lines.push(line); line = ''; }
      if (measure(word) <= width) { line += (line ? ' ' : '') + word; continue; }
      // Split long words instead of losing their ends to an ellipsis.
      for (const char of Array.from(word)) {
        if (line && measure(line + char) > width) { lines.push(line); line = ''; }
        line += char;
      }
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
  const fits = () => lines.length * font * 1.28 <= ry * 1.35 && lines.every(line => measure(line) <= rx * 1.35);
  while (true) {
    lines = wrapLabel(text, rx * 1.35, measure);
    if (fits() || font === MIN_LABEL_FONT) break;
    font = Math.max(MIN_LABEL_FONT, font - .5);
  }
  const truncated = !fits();
  if (truncated) {
    lines = lines.slice(0, Math.max(1, Math.floor(ry * 1.35 / (font * 1.28))));
    let last = lines.at(-1);
    while (last && measure(last + '…') > rx * 1.35) last = Array.from(last).slice(0, -1).join('');
    lines[lines.length - 1] = last + '…';
  }
  return { rx, ry, font, lines, truncated };
}
