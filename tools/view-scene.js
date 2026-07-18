// Build a SELF-CONTAINED HTML viewer of a map scene (terrain + placed objects,
// per floor) with three.min.js inlined — no dev server, no IPC, no CDN. Used to
// eyeball rendering issues (e.g. objects floating) in a plain browser.
//
// Usage: node tools/view-scene.js <map.xdb> <out.html>

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildScene, findAssetRoot } from '../src/scene.js';

const [mapArg, outArg] = process.argv.slice(2);
const mapPath = resolve(mapArg);
const out = resolve(outArg || 'scene-view.html');
const here = dirname(fileURLToPath(import.meta.url));
const threeSrc = readFileSync(join(here, '..', 'node_modules', 'three', 'build', 'three.min.js'), 'utf8');

const { scene } = buildScene(findAssetRoot(mapPath), mapPath);
console.log('floors:', scene.floors.map((f) => `${f.name}:${f.instances.length}`).join(' '), 'geoms:', scene.geoms.length);

const html = `<!doctype html><html><head><meta charset="utf8"><title>scene view</title>
<style>html,body{margin:0;height:100%;background:#0d1014;overflow:hidden;font:12px system-ui;color:#9aa4b2}
#hud{position:fixed;left:10px;top:8px;line-height:1.5}#hud b{color:#e6edf3}</style></head><body>
<div id="hud"><b>scene view</b> — drag: orbit · wheel: zoom · F: floor · G: toggle grid-height colour</div>
<script>${threeSrc}</script>
<script>
const S=${JSON.stringify(scene)};
const R=new THREE.WebGLRenderer({antialias:true});R.setSize(innerWidth,innerHeight);R.setPixelRatio(devicePixelRatio);document.body.appendChild(R.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x0d1014);
const cam=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.5,6000);cam.up.set(0,0,1);
scene.add(new THREE.HemisphereLight(0xdfeaff,0x555044,1.15));scene.add(new THREE.AmbientLight(0xffffff,0.35));
const sun=new THREE.DirectionalLight(0xfff0d8,0.9);sun.position.set(0.6,0.4,1);scene.add(sun);
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();R.setSize(innerWidth,innerHeight);});

const loader=new THREE.TextureLoader();
const grey=new THREE.MeshLambertMaterial({color:0x8a8f98,side:THREE.DoubleSide});
const geos=S.geoms.map(g=>{const b=new THREE.BufferGeometry();b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(g.pos),3));if(g.uv)b.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.uv),2));b.setIndex(g.idx);b.computeVertexNormals();return b;});
const mats=S.geoms.map(g=>{if(!g.tex)return grey;const tx=loader.load(g.tex);tx.wrapS=tx.wrapT=THREE.RepeatWrapping;tx.flipY=false;const m=new THREE.MeshLambertMaterial({map:tx,side:THREE.DoubleSide});if(g.alpha){m.alphaTest=0.5;}return m;});

function buildFloor(fl){
  const grp=new THREE.Group();const V=fl.V,H=fl.heights;
  const tg=new THREE.BufferGeometry();const tp=new Float32Array(V*V*3),tc=new Float32Array(V*V*3);
  for(let y=0;y<V;y++)for(let x=0;x<V;x++){const i=y*V+x,o=i*3,h=H[i];tp[o]=x;tp[o+1]=y;tp[o+2]=h;if(fl.colors){tc[o]=fl.colors[o];tc[o+1]=fl.colors[o+1];tc[o+2]=fl.colors[o+2];}else{tc[o]=0.35;tc[o+1]=0.4;tc[o+2]=0.3;}}
  const ti=[];for(let y=0;y<V-1;y++)for(let x=0;x<V-1;x++){const a=y*V+x,b=a+1,c=a+V,d=c+1;ti.push(a,b,c,b,d,c);}
  tg.setAttribute('position',new THREE.BufferAttribute(tp,3));tg.setAttribute('color',new THREE.BufferAttribute(tc,3));tg.setIndex(ti);tg.computeVertexNormals();
  grp.add(new THREE.Mesh(tg,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide})));
  for(const it of fl.instances){const m=new THREE.Mesh(geos[it.g],mats[it.g]);m.position.set(it.x,it.y,it.z);m.rotation.z=it.r;grp.add(m);}
  return {grp,V,H,name:fl.name};
}
const floors=S.floors.map(buildFloor);for(const f of floors)scene.add(f.grp);
let active=0;
function setFloor(i){active=(i+floors.length)%floors.length;floors.forEach((f,idx)=>f.grp.visible=idx===active);frame();document.getElementById('hud').firstChild.textContent='floor: '+floors[active].name+' ';}
// orbit
let az=0.6,el=0.9,rad,tgt=new THREE.Vector3();
function frame(){const f=floors[active];const V=f.V;let s=0;for(const h of f.H)s+=h;const mz=s/f.H.length;tgt.set(V/2,V/2,mz);rad=V*0.8;update();}
function update(){cam.position.set(tgt.x+rad*Math.cos(el)*Math.cos(az),tgt.y+rad*Math.cos(el)*Math.sin(az),tgt.z+rad*Math.sin(el));cam.lookAt(tgt);}
let drag=false,px2=0,py2=0;
R.domElement.addEventListener('pointerdown',e=>{drag=true;px2=e.clientX;py2=e.clientY;});
addEventListener('pointerup',()=>drag=false);
addEventListener('pointermove',e=>{if(!drag)return;az-=(e.clientX-px2)*0.005;el=Math.max(0.05,Math.min(1.5,el+(e.clientY-py2)*0.005));px2=e.clientX;py2=e.clientY;update();});
addEventListener('wheel',e=>{rad*=(1+Math.sign(e.deltaY)*0.1);update();});
addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')setFloor(active+1);});
setFloor(0);
(function loop(){requestAnimationFrame(loop);R.render(scene,cam);})();
</script></body></html>`;
writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024 | 0) + ' KB');
