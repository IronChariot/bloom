const step=Math.PI/4;
export const roundedPetalPath='M-1 0C-1-.58-.6-1 .04-1C.65-1 1-.53 1 0C1 .58 .62 1-.04 1C-.7 1-1 .55-1 0Z';
export function petalGeometry(rx,ry,angle) {
  const point=a=>{const r=1/Math.sqrt((Math.cos(a)/rx)**2+(Math.sin(a)/ry)**2);return{x:Math.cos(a)*r,y:Math.sin(a)*r};};
  const center=point(angle), before=point(angle-step), after=point(angle+step);
  const spacing=(Math.hypot(center.x-before.x,center.y-before.y)+Math.hypot(center.x-after.x,center.y-after.y))/2;
  const radial=Math.max(22,Math.min(rx,ry)*.4), tangent=Math.max(19,spacing*.56);
  const inset=radial*.08;
  return { x:center.x-Math.cos(angle)*inset, y:center.y-Math.sin(angle)*inset, radial, tangent,
    iconOffset:radial*.52, iconSize:Math.max(19,Math.min(30,radial*.72)) };
}
