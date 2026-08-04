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
//
// From a console — or from a headless browser with a server that takes the
// POST — `snap(shot, t)` hands back one frame and `sheet(from, to)` hands back
// all of them tiled and labelled. The sheet is the instrument that matters —
// see the comment on `sheet` itself.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assets } from '../src/game/assets.ts';
import { extractMapFolder, gameArchives } from '../src/map/map-source.ts';
import { dirOf } from '../src/scene/xdb.ts';
import { buildScenePlay } from '../src/dialog/play.ts';

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

// Everything the page needs comes from the same assembly the editor's own
// window uses (src/dialog/play.ts) — the point of this page is to be evidence
// about what the editor does, which it stops being the moment it works the
// scene out for itself.

const play = buildScenePlay(data, scenePath);
const payload = play.stage;
const framed = play.shots.filter((s) => s.camera.length).length;
const clipCount = play.actors.reduce((a, x) => a + Object.keys(x.clips).length, 0);
console.log(`${inner}: ${play.shots.length} shots, ${framed} with a camera, ${payload.geoms.length} meshes, `
  + `${play.actors.length} actors rigged with ${clipCount} clips`);

const meshList = [...new Set(play.actors.map((a) => a.geom))];
const clipList = [...new Set(play.actors.map((a) => a.clips))];
const actorList = play.actors.map((a) => ({
  ...a, geom: meshList.indexOf(a.geom), clips: clipList.indexOf(a.clips),
}));
// A shot's light is shared too (34 of C1M1's 73 shots name the same inferno
// preset), and it now carries the preset's decoded sky dome — written straight
// out that dome would repeat per shot.
const lightList = [...new Set(play.shots.map((s) => s.ambient).filter(Boolean))];
const shotList = play.shots.map((s) => ({ ...s, ambient: s.ambient ? lightList.indexOf(s.ambient) : -1 }));

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
const LIGHTS=${JSON.stringify(lightList)};
const SHOTS=${JSON.stringify(shotList)}.map(s=>({...s,ambient:s.ambient>=0?LIGHTS[s.ambient]:null}));
// Meshes and clip sets are SHARED between figures of one character (six
// swordsmen of a kind are one of each), and JSON does not know that — written
// straight out, C1M1's opening is a 140 MB page instead of a 60 MB one. So they
// are listed once and the actors carry indices into the lists.
const MESHES=${JSON.stringify(meshList)};
const CLIPSETS=${JSON.stringify(clipList)};
const ACTORS=${JSON.stringify(actorList)}.map(a=>({...a,geom:MESHES[a.geom],clips:CLIPSETS[a.clips]}));
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

// The sky dome the shot's preset (or the scene's) names: painted first with
// depth ignored and glued to the camera, the way the editor draws it
// (renderer/viewport/sky.ts). The page's materialFor makes a fresh material
// per textured part, so flipping its depth flags touches nobody else.
const domes=new Map();
function domeOf(g){
  let mesh=domes.get(g);
  if(mesh)return mesh;
  const b=new THREE.BufferGeometry();
  b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(g.pos),3));
  if(g.uv)b.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.uv),2));
  b.setIndex(g.idx);
  (g.parts||[]).forEach((p,i)=>b.addGroup(p.start,p.count,i));
  const ms=(g.parts||[]).map(p=>{
    const m=materialFor(p);
    if(m===grey)return new THREE.MeshBasicMaterial({visible:false}); // no texture = a hole, not a wall
    m.depthTest=false;m.depthWrite=false;return m;
  });
  mesh=new THREE.Mesh(b,ms);
  mesh.renderOrder=-1;mesh.frustumCulled=false;
  domes.set(g,mesh);
  return mesh;
}
let domeShown=null;
function showDome(a){
  const want=a&&a.dome?domeOf(a.dome):null;
  if(want===domeShown)return;
  if(domeShown)world.remove(domeShown);
  if(want)world.add(want);
  domeShown=want;
}
function draw(){
  if(domeShown)domeShown.position.copy(cam.position);
  R.render(world,cam);
}

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
// Nothing is filtered here: an actor is on the stage twice over — their still
// ADVENTURE copy among the props and the rig that can act — and buildScenePlay
// has already taken the first out of the payload, along with the GROUND height
// it was carrying (the scene file stores 0 for an actor's z, which would bury
// them to the waist). Dropping them again by tile HERE cost the props standing
// on the same square, which for a hero in a thicket is several bushes.
// One skinned body from a geom that carries bones. Actors and creature stacks
// are built the same way and differ only in what they can play: an actor has
// the clips their scene names, a stack has the one idle its model ships with.
function rigOf(g,clips){
  const b=new THREE.BufferGeometry();
  b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(g.pos),3));
  if(g.uv)b.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.uv),2));
  if(g.nrm)b.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(g.nrm),3));
  b.setIndex(g.idx);
  if(!g.nrm)b.computeVertexNormals();
  (g.parts||[]).forEach((p,i)=>b.addGroup(p.start,p.count,i));
  b.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(g.skin.index,4));
  b.setAttribute('skinWeight',new THREE.Float32BufferAttribute(g.skin.weight,4));
  const bones=g.skin.bones.map(x=>{const bone=new THREE.Bone();bone.name=x.name;
    bone.position.set(x.pos[0],x.pos[1],x.pos[2]);
    bone.quaternion.set(x.quat[0],x.quat[1],x.quat[2],x.quat[3]);return bone;});
  const mesh=new THREE.SkinnedMesh(b,(g.parts||[]).map(materialFor));
  g.skin.bones.forEach((x,i)=>{(x.parent>=0?bones[x.parent]:mesh).add(bones[i]);});
  mesh.bind(new THREE.Skeleton(bones,g.skin.bind.map(m=>new THREE.Matrix4().fromArray(m))),new THREE.Matrix4());
  mesh.frustumCulled=false;
  world.add(mesh);
  return {mesh,bones,clips,kind:'idle00',time:0,startsAt:0};
}

// The crowd: a creature stack with bones gets a body of its own and loops its
// idle, phase-shifted so a row of identical demons is not breathing in unison.
// Unanimated they stand in the bind pose with their arms straight out, which is
// half the frame in a scene where two heroes argue in front of their armies.
const crowd=[];
for(const it of fl.instances){
  const g=S.geoms[it.g];
  if(g.skin&&g.skin.clip){
    const rig=rigOf(g,{idle00:g.skin.clip});
    rig.mesh.position.set((it.x+0.5)*2,(it.y+0.5)*2,it.z);
    rig.mesh.rotation.z=it.r;
    rig.mesh.scale.setScalar(g.scale||1);
    rig.time=crowd.length*0.37;
    crowd.push(rig);
    continue;
  }
  const m=new THREE.Mesh(geos[it.g],mats[it.g].length?mats[it.g]:grey);
  m.position.set((it.x+0.5)*2,(it.y+0.5)*2,it.z);
  m.rotation.z=it.r;
  m.scale.setScalar(g.scale||1);
  world.add(m);
}

// The rigged actors: one skeleton each, because two actors are at different
// points of their own clips even when it is the same clip.
const rigged=ACTORS.map(a=>{
  const rig=rigOf(a.geom,a.clips);
  rig.href=a.href;
  rig.mesh.position.set((a.x+0.5)*2,(a.y+0.5)*2,a.z);
  rig.mesh.rotation.z=a.rot;
  rig.mesh.scale.setScalar(a.geom.scale||1);
  return rig;
});
const byHref=new Map(rigged.map(r=>[r.href,r]));

const _qa=new THREE.Quaternion(),_qb=new THREE.Quaternion();
function pose(rig,time){
  const clip=rig.clips[rig.kind]||rig.clips['idle00'];
  if(!clip)return;
  const n=clip.times.length;if(!n)return;
  const span=clip.duration||1;
  // A named clip plays ONCE and holds its last frame; the idle loops. A scene
  // that let \`death\` loop would have its corpses stand back up.
  const at=rig.kind==='idle00'?((time%span)+span)%span:Math.max(0,Math.min(span,time));
  const f=Math.min(n-1,Math.max(0,at/span*(n-1)));
  const i0=Math.min(n-1,Math.floor(f)),i1=Math.min(n-1,i0+1),t=f-i0;
  rig.bones.forEach((bone,bi)=>{
    const rot=clip.rotations[bi],pos=clip.positions[bi],scl=clip.scales&&clip.scales[bi];
    if(rot){_qa.set(rot[i0*4],rot[i0*4+1],rot[i0*4+2],rot[i0*4+3]);
      _qb.set(rot[i1*4],rot[i1*4+1],rot[i1*4+2],rot[i1*4+3]);
      bone.quaternion.slerpQuaternions(_qa,_qb,t);}
    if(pos){bone.position.set(
      pos[i0*3]+(pos[i1*3]-pos[i0*3])*t,
      pos[i0*3+1]+(pos[i1*3+1]-pos[i0*3+1])*t,
      pos[i0*3+2]+(pos[i1*3+2]-pos[i0*3+2])*t);}
    // Present only on clips that leave unit scale, and for effects it is often
    // the whole animation (an impact ring swelling, a vortex opening).
    if(scl){bone.scale.set(
      scl[i0*3]+(scl[i1*3]-scl[i0*3])*t,
      scl[i0*3+1]+(scl[i1*3+1]-scl[i0*3+1])*t,
      scl[i0*3+2]+(scl[i1*3+2]-scl[i0*3+2])*t);}
  });
}
function cueShot(n,at){
  for(const rig of rigged){rig.kind='idle00';rig.startsAt=0;}
  for(const cue of ((SHOTS[n]||{}).cues||[])){
    const rig=byHref.get(cue.actor);
    if(rig&&rig.clips[cue.kind]){rig.kind=cue.kind;rig.startsAt=cue.delay||0;}
  }
  for(const rig of rigged){rig.time=Math.max(0,(at||0)-rig.startsAt);pose(rig,rig.time);}
}

let shot=0,t=0,playing=false,last=performance.now();
function place(){
  const s=SHOTS[shot];
  // The shot's own sky, or the scene's — same fallback the light itself takes.
  showDome((s&&s.ambient)||fl.ambient);
  if(!s||!s.camera.length)return;
  const k=Math.min(0.999,Math.max(0,t))*(s.camera.length-1);
  const i=Math.floor(k),f=k-i;
  const a=s.camera[i],b=s.camera[Math.min(s.camera.length-1,i+1)];
  const mix=(u,v)=>u+(v-u)*f;
  cam.position.set(mix(a.eye[0],b.eye[0]),mix(a.eye[1],b.eye[1]),mix(a.eye[2],b.eye[2]));
  cam.lookAt(mix(a.at[0],b.at[0]),mix(a.at[1],b.at[1]),mix(a.at[2],b.at[2]));
  cam.fov=mix(a.fov,b.fov);cam.updateProjectionMatrix();
  document.getElementById('hud').innerHTML='<b>shot '+(shot+1)+'/'+SHOTS.length+'</b> · '+s.duration.toFixed(1)+'s · '+
    (s.speaker||'(nobody)').split('/').pop()+' · t='+t.toFixed(2)+'<br>← → step · space '+(playing?'pause':'play');
  document.getElementById('line').textContent=(s.text||'').split('/').pop();
}
let cuedShot=-1;
function sync(seconds){
  if(cuedShot!==shot){cuedShot=shot;cueShot(shot,seconds);}
  else for(const rig of rigged){rig.time=Math.max(0,seconds-rig.startsAt);pose(rig,rig.time);}
  // The crowd keeps its own clock: their idles loop through the whole scene and
  // owe nothing to which shot is up, and the offsets they started at are what
  // keeps them out of unison.
  for(const rig of crowd)pose(rig,rig.time+seconds);
}
addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'){shot=(shot+1)%SHOTS.length;t=0;}
  else if(e.key==='ArrowLeft'){shot=(shot-1+SHOTS.length)%SHOTS.length;t=0;}
  else if(e.key===' '){playing=!playing;e.preventDefault();}
  place();sync(t*((SHOTS[shot]||{duration:3}).duration||3));
});
place();sync(0);
// Rendering a chosen shot and handing back the pixels, for looking at this
// page from outside a display — the same sink trick the geometry viewer uses.
// Every shot at once, tiled and labelled, posted as one image.
//
//   sheet(0, 36, 6, 320, 180)
//
// One frame at a time hides what a whole scene shows immediately. The camera
// convention was out by half a turn for a week — two rounds of scoring against
// the corpus could not see it, because most shots orbit their speaker and keep
// them in frame from either side — and one sheet of 36 thumbnails settled it:
// every shot was the back of somebody's head.
window.sheet=async function(from,to,cols,w,h){
  cols=cols||6; w=w||320; h=h||180;
  const n=to-from, rows=Math.ceil(n/cols);
  const c=document.createElement('canvas'); c.width=cols*w; c.height=rows*h;
  const g=c.getContext('2d'); g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
  R.setSize(w,h,false); cam.aspect=w/h; cam.updateProjectionMatrix();
  for(let i=0;i<n;i++){
    shot=from+i; t=0.5; place(); cuedShot=-1; sync(t*((SHOTS[shot]||{duration:3}).duration||3));
    draw();
    g.drawImage(R.domElement,(i%cols)*w,Math.floor(i/cols)*h,w,h);
    g.fillStyle='#fff'; g.font='16px monospace';
    g.fillText(String(shot),(i%cols)*w+6,Math.floor(i/cols)*h+20);
  }
  return fetch('/sink?n=sheet'+from,{method:'POST',body:c.toDataURL('image/png')}).then(r=>r.text());
};
window.snap=function(n,at){
  // A pane that is not on screen has no size, and a zero-sized canvas hands
  // back a six-character data URL. The frame asked for is rendered at a fixed
  // size instead of at the window's.
  if(!R.domElement.width||!R.domElement.height){R.setSize(1280,720,false);cam.aspect=1280/720;cam.updateProjectionMatrix();}
  shot=Math.max(0,Math.min(SHOTS.length-1,n|0));t=at===undefined?0.5:at;place();
  cuedShot=-1;sync(t*((SHOTS[shot]||{duration:3}).duration||3));draw();
  return fetch('/sink?n='+shot,{method:'POST',body:R.domElement.toDataURL('image/png')}).then(r=>r.text());};
(function loop(now){requestAnimationFrame(loop);
  const dt=(now-last)/1000;last=now;
  if(playing){const s=SHOTS[shot];const span=(s?s.duration||3:3);t+=dt/span;if(t>=1){t=0;shot=(shot+1)%SHOTS.length;}place();sync(t*span);}
  draw();
})(performance.now());
</script></body></html>`;

mkdirSync(dirOf(out.replaceAll('\\', '/')), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024) | 0} KB)`);
