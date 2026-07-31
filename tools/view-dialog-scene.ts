// A self-contained page that shows a dialog scene THROUGH ITS OWN CAMERAS.
//
//   node tools/view-dialog-scene.ts [DialogScenes/C1/M1/D1] [out.html]
//
// The stage build (tools/scene-stage.ts) proves a scene resolves; this is for
// looking at it. Every shot's camera pair is computed here with the real
// src/dialog/camera.ts, so what the page shows is what the editor's viewport
// will show — which makes it the instrument for the one thing the corpus could
// not settle, where yaw has its zero. A wrong yaw frames the empty field
// instead of the two people talking, and that is visible in one glance.
//
// three.min.js is inlined: no dev server, no bundle, no IPC. Arrow keys step
// through the shots, space plays them at their own durations.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assets } from '../src/game/assets.ts';
import { buildScene } from '../src/scene/scene.ts';
import { extractMapFolder, gameArchives } from '../src/map/map-source.ts';
import { dirOf, resolveHref } from '../src/scene/xdb.ts';
import { loadDialogScene } from '../src/dialog/dialog-scene.ts';
import { stageObjects } from '../src/dialog/stage.ts';
import { cameraShot, eyeOf, loadCamera, loadCameraSet, poseAt } from '../src/dialog/camera.ts';
import type { OrbitPose } from '../src/dialog/camera.ts';

const DATA = process.env.HOMM5_DATA ?? join(import.meta.dirname, '..', 'data-unpacked');
const GAME = process.env.HOMM5_ROOT ?? resolve(DATA, '..', '..');
const REPO = join(import.meta.dirname, '..');

const inner = (process.argv[2] ?? 'DialogScenes/C1/M1/D1').replace(/\\/g, '/').replace(/\/+$/, '');
const out = resolve(process.argv[3] ?? join(REPO, '_tmp', 'dialog-scene.html'));
const scenePath = `${inner}/DialogScene.xdb`;

function modArchives(): string[] {
  const dir = join(GAME, 'UserMODs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.h5u$/i.test(f)).sort().map((f) => join(dir, f));
}

const workspace = join(REPO, '_tmp', 'scene-stage');
const roots = [DATA];
if (!existsSync(join(DATA, scenePath))) {
  mkdirSync(workspace, { recursive: true });
  const archives = [...gameArchives(GAME), ...modArchives()];
  extractMapFolder(archives, inner, workspace);
  // …and the shared camera library with it. Half the shots of a campaign scene
  // point into `Dialogs/` rather than at a pose of their own, and without it a
  // scene unpacks complete and frames nothing.
  if (!existsSync(join(DATA, 'Dialogs')) && !existsSync(join(workspace, 'Dialogs'))) {
    extractMapFolder(archives, 'Dialogs', workspace);
  }
  roots.unshift(workspace);
}

const data = assets(roots);
const text = data.text(scenePath);
if (!text) throw new Error(`no scene at ${scenePath}`);
const scene = loadDialogScene(text);
const stagePath = data.path(resolveHref(dirOf(scenePath), scene.stage));
const objects = stageObjects(data, scenePath, scene);
const { scene: payload } = buildScene(data, stagePath, { extraObjects: objects.map((o) => o.object) });

// --- the shots, as the page needs them: two eyes and what they look at -------

/** Follow a shot's camera set to the two poses at its ends. */
function posesOf(setHref: string): { start: OrbitPose; finish: OrbitPose; set: ReturnType<typeof loadCameraSet> } | null {
  const setPath = resolveHref(dirOf(scenePath), setHref);
  const setText = data.text(setPath);
  if (!setText) return null;
  const set = loadCameraSet(setText);
  const end = (href: string): OrbitPose | null => {
    const t = href && data.text(resolveHref(dirOf(setPath), href));
    return t ? loadCamera(t) : null;
  };
  const start = end(set.startCamera), finish = end(set.finishCamera);
  return start && finish ? { start, finish, set } : null;
}

const shots = scene.shots.map((shot) => {
  const pair = shot.newCameraSet ? posesOf(shot.newCameraSet) : null;
  const path: Array<{ eye: number[]; at: number[]; fov: number }> = [];
  if (pair) {
    const move = cameraShot(pair.set, pair.start, pair.finish);
    // Sampled here rather than in the page: the easing, the corrections and the
    // extra turns are the player's arithmetic, and the page must not grow a
    // second opinion about them.
    for (let i = 0; i <= 24; i++) {
      const pose = poseAt(move, i / 24);
      const eye = eyeOf(pose);
      path.push({ eye: [eye.x, eye.y, eye.z], at: [pose.anchor.x, pose.anchor.y, pose.anchor.z], fov: pose.fov || 35 });
    }
  }
  return {
    index: shot.index,
    duration: shot.duration || 3,
    speaker: (shot.heroLink || shot.monsterLink || '').split('#')[0] || '(nobody)',
    line: shot.text,
    path,
  };
});

const framed = shots.filter((s) => s.path.length).length;
console.log(`${inner}: ${shots.length} shots, ${framed} with a camera, ${payload.geoms.length} meshes`);

// --- the page ----------------------------------------------------------------

const three = readFileSync(join(REPO, 'node_modules', 'three', 'build', 'three.min.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf8"><title>${inner}</title>
<style>html,body{margin:0;height:100%;background:#0d1014;overflow:hidden;font:13px system-ui;color:#9aa4b2}
#hud{position:fixed;left:12px;top:10px;line-height:1.6;text-shadow:0 1px 2px #000}
#hud b{color:#e6edf3}#line{position:fixed;left:12px;right:12px;bottom:14px;text-align:center;color:#e6edf3;font-size:15px}</style>
</head><body>
<div id="hud"></div><div id="line"></div>
<script>${three}</script>
<script>
const S=${JSON.stringify(payload)};
const SHOTS=${JSON.stringify(shots)};
const R=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});R.setSize(innerWidth,innerHeight);R.setPixelRatio(1);document.body.appendChild(R.domElement);
const world=new THREE.Scene();world.background=new THREE.Color(0x0d1014);
const cam=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,0.5,4000);cam.up.set(0,0,1);
world.add(new THREE.HemisphereLight(0xdfeaff,0x555044,1.1));world.add(new THREE.AmbientLight(0xffffff,0.4));
const sun=new THREE.DirectionalLight(0xfff0d8,0.9);sun.position.set(0.6,0.4,1);world.add(sun);
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();R.setSize(innerWidth,innerHeight);});

const loader=new THREE.TextureLoader();
const grey=new THREE.MeshLambertMaterial({color:0x8a8f98,side:THREE.DoubleSide});
function materialFor(p){
  if(!p.tex)return grey;
  const tx=loader.load(p.tex);tx.wrapS=tx.wrapT=THREE.RepeatWrapping;tx.flipY=false;
  const m=p.selfIllum?new THREE.MeshBasicMaterial({map:tx}):new THREE.MeshLambertMaterial({map:tx});
  m.side=THREE.DoubleSide;
  if(p.alphaMode==='AM_ALPHA_TEST'){m.alphaTest=0.5;}
  else if(p.alphaMode!=='AM_OPAQUE'){m.transparent=true;m.depthWrite=!!p.opaque;}
  if(p.additive){m.blending=THREE.AdditiveBlending;m.transparent=true;m.depthWrite=false;}
  return m;
}
const geos=S.geoms.map(g=>{
  const b=new THREE.BufferGeometry();
  b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(g.pos),3));
  if(g.uv)b.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.uv),2));
  if(g.nrm)b.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(g.nrm),3));
  b.setIndex(g.idx);
  if(!g.nrm)b.computeVertexNormals();
  (g.parts||[]).forEach((p,i)=>b.addGroup(p.start,p.count,i));
  return b;
});
const mats=S.geoms.map(g=>(g.parts||[]).map(materialFor));

const fl=S.floors[0];
const V=fl.V,H=fl.heights;
const tg=new THREE.BufferGeometry();
const tp=new Float32Array(V*V*3),tc=new Float32Array(V*V*3);
for(let y=0;y<V;y++)for(let x=0;x<V;x++){const i=y*V+x,o=i*3;tp[o]=x*2;tp[o+1]=y*2;tp[o+2]=H[i];
  if(fl.colors){tc[o]=fl.colors[o];tc[o+1]=fl.colors[o+1];tc[o+2]=fl.colors[o+2];}else{tc[o]=0.34;tc[o+1]=0.40;tc[o+2]=0.28;}}
const ti=[];for(let y=0;y<V-1;y++)for(let x=0;x<V-1;x++){const a=y*V+x,b=a+1,c=a+V,d=c+1;ti.push(a,b,c,b,d,c);}
tg.setAttribute('position',new THREE.BufferAttribute(tp,3));tg.setAttribute('color',new THREE.BufferAttribute(tc,3));
tg.setIndex(ti);tg.computeVertexNormals();
world.add(new THREE.Mesh(tg,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide})));

// The same space the editor's viewport uses: object positions are TILE indices
// and a tile is 2 units, so a model goes at the CENTRE of its cell — (t+0.5)·2
// — while its mesh and the terrain heights are already in world units. The only
// scale is the creature one a clip's root bone carries.
for(const it of fl.instances){
  const m=new THREE.Mesh(geos[it.g],mats[it.g].length?mats[it.g]:grey);
  m.position.set((it.x+0.5)*2,(it.y+0.5)*2,it.z);
  m.rotation.z=it.r;
  m.scale.setScalar(S.geoms[it.g].scale||1);
  world.add(m);
}

let shot=0,t=0,playing=false,last=performance.now();
function place(){
  const s=SHOTS[shot];
  if(!s||!s.path.length)return;
  const k=Math.min(0.999,Math.max(0,t))*(s.path.length-1);
  const i=Math.floor(k),f=k-i;
  const a=s.path[i],b=s.path[Math.min(s.path.length-1,i+1)];
  const mix=(u,v)=>u+(v-u)*f;
  cam.position.set(mix(a.eye[0],b.eye[0]),mix(a.eye[1],b.eye[1]),mix(a.eye[2],b.eye[2]));
  cam.lookAt(mix(a.at[0],b.at[0]),mix(a.at[1],b.at[1]),mix(a.at[2],b.at[2]));
  cam.fov=mix(a.fov,b.fov);cam.updateProjectionMatrix();
  document.getElementById('hud').innerHTML='<b>shot '+(shot+1)+'/'+SHOTS.length+'</b> · '+s.duration.toFixed(1)+'s · '+
    s.speaker.split('/').pop()+' · t='+t.toFixed(2)+'<br>← → step · space '+(playing?'pause':'play');
  document.getElementById('line').textContent=s.line.split('/').pop();
}
addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'){shot=(shot+1)%SHOTS.length;t=0;}
  else if(e.key==='ArrowLeft'){shot=(shot-1+SHOTS.length)%SHOTS.length;t=0;}
  else if(e.key===' '){playing=!playing;e.preventDefault();}
  place();
});
place();
// Rendering a chosen shot and handing back the pixels, for looking at this
// page from outside a display — the same sink trick the geometry viewer uses.
window.snap=function(n,at){shot=Math.max(0,Math.min(SHOTS.length-1,n|0));t=at===undefined?0.5:at;place();R.render(world,cam);
  return fetch('/sink?n='+shot,{method:'POST',body:R.domElement.toDataURL('image/png')}).then(r=>r.text());};
(function loop(now){requestAnimationFrame(loop);
  const dt=(now-last)/1000;last=now;
  if(playing){const s=SHOTS[shot];t+=dt/(s?s.duration||3:3);if(t>=1){t=0;shot=(shot+1)%SHOTS.length;}place();}
  R.render(world,cam);
})(performance.now());
</script></body></html>`;

mkdirSync(dirOf(out.replaceAll('\\', '/')), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024) | 0} KB)`);
