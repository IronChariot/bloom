import { deformPoint } from './deformation.js';

export function blobOutline(rx, ry, t, wobble, seed, extra = 0, shape = null, grab = null) {
  const points = Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * Math.PI * 2;
    const wave = 1 + Math.sin(a * 3 + seed) * .014 + Math.sin(a * 4 + t * 13) * wobble * .035;
    const x = Math.cos(a) * (rx + extra) * wave, y = Math.sin(a) * (ry + extra) * wave;
    return shape ? deformPoint(x, y, rx + extra, ry + extra, shape, grab) : { x, y };
  });
  const segments = points.map((p,i) => {
    const prev = points[(i+23)%24], next = points[(i+1)%24];
    return { a: { x:(prev.x+p.x)/2, y:(prev.y+p.y)/2 }, b:p, c:{ x:(p.x+next.x)/2, y:(p.y+next.y)/2 } };
  });
  return { segments, path: `M${segments[0].a.x},${segments[0].a.y}` + segments.map(s=>` Q${s.b.x},${s.b.y} ${s.c.x},${s.c.y}`).join('') + ' Z' };
}

// Intersect a ray with the same quadratic curves used to paint the jello outline.
export function outlineDistance(segments, dx, dy) {
  const length = Math.hypot(dx,dy); if (!length) return 0;
  dx /= length; dy /= length;
  const cross = p => p.x*dy-p.y*dx;
  let distance = 0;
  for (const {a,b,c} of segments) {
    const A=cross(a)-2*cross(b)+cross(c), B=2*(cross(b)-cross(a)), C=cross(a);
    let roots=[];
    if (Math.abs(A)<1e-9) { if(Math.abs(B)>1e-9) roots=[-C/B]; }
    else { const d=B*B-4*A*C; if(d>=0) { const q=Math.sqrt(d); roots=[(-B+q)/(2*A),(-B-q)/(2*A)]; } }
    for(const t of roots) if(t>=-1e-8&&t<=1+1e-8) {
      const u=Math.max(0,Math.min(1,t)), v=1-u;
      const x=v*v*a.x+2*v*u*b.x+u*u*c.x, y=v*v*a.y+2*v*u*b.y+u*u*c.y;
      distance=Math.max(distance,x*dx+y*dy);
    }
  }
  return distance;
}
