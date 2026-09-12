export function colorShades(color) {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const amounts = color.toLowerCase() === '#ffffff' ? [-.08, -.18, -.32, -.48, -.65, -.82] : [.65, .4, .2, -.15, -.3, -.5];
  return amounts.map(amount => '#' + rgb.map(c => Math.round(c + ((amount > 0 ? 255 : 0) - c) * Math.abs(amount)).toString(16).padStart(2, '0')).join(''));
}
