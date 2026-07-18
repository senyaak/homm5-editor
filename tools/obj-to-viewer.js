// Turn an extracted OBJ into a standalone, dependency-free HTML viewer that
// renders it as a rotating flat-shaded mesh on a 2D canvas (no WebGL / no libs,
// so it opens from file:// anywhere). Proof that the decoded geometry is real.
//
// Usage: node tools/obj-to-viewer.js <in.obj> <out.html> [title]

import { readFileSync, writeFileSync } from 'node:fs';

const [inObj, outHtml, title = 'HoMM5 mesh'] = process.argv.slice(2);
const txt = readFileSync(inObj, 'utf8');
const V = [], F = [];
for (const line of txt.split('\n')) {
  if (line.startsWith('v ')) { const p = line.split(/\s+/); V.push([+p[1], +p[2], +p[3]]); }
  else if (line.startsWith('f ')) { const p = line.split(/\s+/); F.push([+p[1] - 1, +p[2] - 1, +p[3] - 1]); }
}

const html = `<!doctype html><html><head><meta charset="utf8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0e1116;color:#9aa4b2;font:13px system-ui;overflow:hidden}
#i{position:fixed;left:12px;top:10px;line-height:1.5}#i b{color:#e6edf3}canvas{display:block}</style></head>
<body><div id="i"><b>${title}</b><br>${V.length} vertices &middot; ${F.length} triangles<br>
decoded from bin/Geometries &middot; drag to rotate</div><canvas id="c"></canvas>
<script>
const V=${JSON.stringify(V.map((p) => p.map((n) => +n.toFixed(3))))};
const F=${JSON.stringify(F)};
const cv=document.getElementById('c'),g=cv.getContext('2d');
let W,H;function rs(){W=cv.width=innerWidth;H=cv.height=innerHeight;}addEventListener('resize',rs);rs();
// center + scale
let cx=0,cy=0,cz=0;for(const p of V){cx+=p[0];cy+=p[1];cz+=p[2];}cx/=V.length;cy/=V.length;cz/=V.length;
let r=0;for(const p of V){const dx=p[0]-cx,dy=p[1]-cy,dz=p[2]-cz;r=Math.max(r,Math.hypot(dx,dy,dz));}
let ax=-1.2,az=0.6,drag=false,lx,ly;
cv.onmousedown=e=>{drag=true;lx=e.clientX;ly=e.clientY;};
onmouseup=()=>drag=false;
onmousemove=e=>{if(!drag)return;az+=(e.clientX-lx)*0.01;ax+=(e.clientY-ly)*0.01;lx=e.clientX;ly=e.clientY;};
function rot(p){let x=p[0]-cx,y=p[1]-cy,z=p[2]-cz;
 // Z axis in-game is up; spin around it (az), tilt around X (ax)
 let cs=Math.cos(az),sn=Math.sin(az);let x2=x*cs-y*sn,y2=x*sn+y*cs;
 cs=Math.cos(ax);sn=Math.sin(ax);let y3=y2*cs-z*sn,z3=y2*sn+z*cs;
 return [x2,y3,z3];}
function frame(){az+=drag?0:0.006;g.clearRect(0,0,W,H);
 const s=Math.min(W,H)*0.42/r,ox=W/2,oy=H/2;
 const P=V.map(rot);
 const L=[0.4,0.5,0.75];const tr=[];
 for(const f of F){const a=P[f[0]],b=P[f[1]],c=P[f[2]];
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const nl=Math.hypot(nx,ny,nz)||1;nx/=nl;ny/=nl;nz/=nl;
  const depth=(a[2]+b[2]+c[2])/3;const lit=Math.max(0.15,Math.abs(nx*L[0]+ny*L[1]+nz*L[2]));
  tr.push({f,depth,lit});}
 tr.sort((A,B)=>A.depth-B.depth);
 for(const t of tr){const a=P[t.f[0]],b=P[t.f[1]],c=P[t.f[2]];
  g.beginPath();g.moveTo(ox+a[0]*s,oy-a[1]*s);g.lineTo(ox+b[0]*s,oy-b[1]*s);g.lineTo(ox+c[0]*s,oy-c[1]*s);g.closePath();
  const v=Math.round(60+t.lit*150);g.fillStyle='rgb('+(v*0.7|0)+','+(v*0.85|0)+','+v+')';g.strokeStyle='rgba(20,28,40,.5)';g.fill();g.stroke();}
 requestAnimationFrame(frame);}
frame();
</script></body></html>`;
writeFileSync(outHtml, html);
console.log(`wrote ${outHtml}  (${V.length} verts, ${F.length} tris)`);
