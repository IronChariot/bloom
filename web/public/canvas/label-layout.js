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

export function labelLayout(node, measureText) {
  const depth = node.root ? 0 : node.depth ?? 1;
  const font = Math.max(12, 22 * .91 ** depth), scale = Math.max(.38, .8 ** depth);
  const measure = text => measureText(text, font, !!node.root);
  const text = node.text || ' ';
  const longest = Math.max(...text.split('\n').map(s => s.length));
  let rx = Math.min(155, Math.max(116, longest * 3.4 + 37)) * scale;
  const longestWord = Math.max(...text.split(/\s+/).map(measure));
  rx = Math.max(rx, Math.min(180, longestWord / 1.35 + 1));
  // Depth still shrinks short labels; longer labels can earn extra room.
  let lines = wrapLabel(text, rx * 1.35, measure);
  while (lines.length > 4 && rx < 180) {
    rx = Math.min(180, rx + 12);
    lines = wrapLabel(text, rx * 1.35, measure);
  }
  const truncated = lines.length > 8;
  if (truncated) {
    lines = lines.slice(0, 8);
    let last = lines[7];
    while (last && measure(last + '…') > rx * 1.35) last = Array.from(last).slice(0, -1).join('');
    lines[7] = last + '…';
  }
  return { rx, ry: Math.max(90 * scale, lines.length * font * 1.28 / 1.35), font, lines, truncated };
}
