// Build a SELF-CONTAINED HTML viewer of a map's TERRAIN ONLY — same splat
// shader and same cliff-aware meshing as the editor, so what it shows is what
// the editor shows. No objects, no dev server, no CDN.
//
// The shader sources are LIFTED OUT OF renderer/app.js at build time rather
// than copied, so the viewer can't silently drift from the real thing. That
// matters: this exists to measure what actually reaches the framebuffer when
// the editor's own output looks wrong, instead of reasoning about it.
//
// The page exposes measure() — it renders top-down and reports the mean colour
// of terrain, cut faces and water, which is how "why is the cliff black" gets
// answered with numbers rather than guesses.
//
// Usage: node tools/view-terrain.js <map.xdb> [out.html]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildScene, findAssetRoot } from '../src/scene.ts';

const [mapArg, outArg] = process.argv.slice(2);
const mapPath = resolve(mapArg);
const out = resolve(outArg || 'terrain-view.html');
const here = dirname(fileURLToPath(import.meta.url));
const threeSrc = readFileSync(join(here, '..', 'node_modules', 'three', 'build', 'three.min.js'), 'utf8');

// --- lift the shaders straight from the renderer ---
const appSrc = readFileSync(join(here, '..', 'renderer', 'app.js'), 'utf8');
const grab = (re, what) => {
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not lift ${what} out of renderer/app.js`);
  return m[1];
};
const VERT = grab(/const SPLAT_VERT = `([\s\S]*?)`;/, 'SPLAT_VERT');
const FRAG = grab(/const splatFrag = \(groups, layers\) => `([\s\S]*?)`;/, 'splatFrag');

const { scene } = buildScene(findAssetRoot(mapPath), mapPath);
const floors = scene.floors.map((f) => ({
  name: f.name, V: f.V, heights: f.heights, colors: f.colors,
  flags: f.flags, splat: f.splat, water: f.water,
}));
for (const f of floors) {
  console.log(`${f.name}: V=${f.V} layers=${f.splat ? f.splat.layerCount : 0} water=${f.water ? f.water.cells.length : 0} cells`);
}

const html = `<!doctype html><html><head><meta charset="utf8"><title>terrain view</title>
<style>html,body{margin:0;height:100%;background:#0d1014;overflow:hidden;font:12px system-ui;color:#9aa4b2}
#hud{position:fixed;left:10px;top:8px;line-height:1.6;z-index:5}#hud b{color:#e6edf3}
#err{position:fixed;left:10px;bottom:10px;color:#ff7b72;white-space:pre;font:11px monospace;z-index:5}</style>
</head><body>
<div id="hud"><b>terrain</b> — drag: orbit · wheel: zoom · F: floor · T: splat/flat · C: cliffs</div>
<div id="err"></div>
<script>${threeSrc}</script>
<script>
const F=${JSON.stringify(floors)};
const VERT=${JSON.stringify(VERT)};
const FRAG=(g,l)=>${JSON.stringify(FRAG)}.split('\${groups}').join(g).split('\${layers}').join(l);
const R=new THREE.WebGLRenderer({antialias:true});R.setPixelRatio(1);R.setSize(innerWidth||1280,innerHeight||720);
document.body.appendChild(R.domElement);
const sc=new THREE.Scene();sc.background=new THREE.Color(0x0d1014);
const cam=new THREE.PerspectiveCamera(55,(innerWidth||1280)/(innerHeight||720),0.5,6000);cam.up.set(0,0,1);
sc.add(new THREE.HemisphereLight(0xdfeaff,0x555044,1.15));sc.add(new THREE.AmbientLight(0xffffff,0.35));
const show=m=>{document.getElementById('err').textContent+=m+'\\n';};
R.debug.onShaderError=(gl,p,vs,fs)=>show('SHADER ERROR\\n'+gl.getShaderInfoLog(fs));

const loadImg=s=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('img'));i.src=s;});
async function arrayTex(uris,size){
  const data=new Uint8Array(uris.length*size*size*4);
  const cv=document.createElement('canvas');cv.width=cv.height=size;
  const cx=cv.getContext('2d',{willReadFrequently:true});
  for(let i=0;i<uris.length;i++){const im=await loadImg(uris[i]);cx.clearRect(0,0,size,size);
    cx.drawImage(im,0,0,size,size);data.set(cx.getImageData(0,0,size,size).data,i*size*size*4);}
  const t=new THREE.DataArrayTexture(data,size,size,uris.length);
  t.format=THREE.RGBAFormat;t.type=THREE.UnsignedByteType;t.needsUpdate=true;return t;
}

// --- cliff-aware meshing: mirrors renderer/app.js buildFloor ---
let texScale=0.5, cliffAmount=1;
const mats=[];
function buildFloor(fl){
  const V=fl.V,H=fl.heights,grp=new THREE.Group();
  const tp=new Float32Array(V*V*3),tc=new Float32Array(V*V*3),tuv=new Float32Array(V*V*2);
  const gc=fl.colors;
  for(let y=0;y<V;y++)for(let x=0;x<V;x++){const i=y*V+x,o=i*3;
    tp[o]=x;tp[o+1]=y;tp[o+2]=H[i];
    tuv[i*2]=(x+0.5)/V;tuv[i*2+1]=(y+0.5)/V;
    if(gc){tc[o]=gc[o];tc[o+1]=gc[o+1];tc[o+2]=gc[o+2];}else{tc[o]=.35;tc[o+1]=.4;tc[o+2]=.3;}}

  const WATER=0,GROUND=1,PLATEAU=2, f=fl.flags;
  const kindOf=i=>{const v=f[i];return v===0?WATER:(v&32)?PLATEAU:GROUND;};
  const isRamp=i=>(f[i]&8)!==0;
  const ti=[],extra=[];
  const addV=(x,y,z)=>{extra.push(x,y,z);return V*V+extra.length/3-1;};
  let cuts=0;
  for(let y=0;y<V-1;y++)for(let x=0;x<V-1;x++){
    const ci=[y*V+x,y*V+x+1,(y+1)*V+x+1,(y+1)*V+x];
    const h=ci.map(i=>H[i]);
    const smooth=()=>{const[a,b,c,d]=[ci[0],ci[1],ci[3],ci[2]];ti.push(a,b,c,b,d,c);};
    if(!f){smooth();continue;}
    if(ci.some(isRamp)){smooth();continue;}
    const k0=kindOf(ci[0]); if(ci.every(i=>kindOf(i)===k0)){smooth();continue;}
    if(Math.max(...h)-Math.min(...h)<0.1){smooth();continue;}
    const level=(Math.max(...h)+Math.min(...h))/2;
    const up=h.map(v=>v>level),nUp=up.filter(Boolean).length;
    if(nUp===0||nUp===4){smooth();continue;}
    if(up[0]===up[2]&&up[1]===up[3]){smooth();continue;}
    const cxy=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],ring=[];
    for(let k=0;k<4;k++){const n=(k+1)%4;ring.push({cut:false,up:up[k],gi:ci[k]});
      if(up[k]!==up[n])ring.push({cut:true,xy:[(cxy[k][0]+cxy[n][0])/2,(cxy[k][1]+cxy[n][1])/2],
        hz:up[k]?h[k]:h[n], lz:up[k]?h[n]:h[k]});}
    const cl=ring.filter(p=>p.cut); if(cl.length!==2){smooth();continue;}
    const start=ring.findIndex(p=>p.cut),arcs=[[],[]];let side=0;
    for(let k=0;k<=ring.length;k++){const p=ring[(start+k)%ring.length];arcs[side].push(p);
      if(p.cut&&k>0&&k<ring.length){side=1;arcs[1].push(p);}}
    const cutHi=cl.map(p=>addV(p.xy[0],p.xy[1],p.hz)),cutLo=cl.map(p=>addV(p.xy[0],p.xy[1],p.lz));
    for(const arc of arcs){const cs=arc.filter(p=>!p.cut); if(!cs.length)continue;
      const top=cs[0].up,ends=[arc[0],arc[arc.length-1]];
      const edge=p=>(top?cutHi:cutLo)[cl.indexOf(p)];
      const poly=[edge(ends[0]),...cs.map(p=>p.gi),edge(ends[1])];
      for(let k=1;k<poly.length-1;k++)ti.push(poly[0],poly[k],poly[k+1]);}
    ti.push(cutHi[0],cutHi[1],cutLo[0],cutHi[1],cutLo[1],cutLo[0]);
    cuts++;
  }
  show('cuts: '+cuts+' ('+fl.name+')');

  const nEx=extra.length/3;
  const pos=new Float32Array((V*V+nEx)*3),col=new Float32Array((V*V+nEx)*3),uvs=new Float32Array((V*V+nEx)*2);
  pos.set(tp);col.set(tc);uvs.set(tuv);
  for(let k=0;k<nEx;k++){const x=extra[k*3],y=extra[k*3+1],z=extra[k*3+2];
    const o=(V*V+k)*3,u=(V*V+k)*2;
    pos[o]=x;pos[o+1]=y;pos[o+2]=z;uvs[u]=(x+0.5)/V;uvs[u+1]=(y+0.5)/V;
    const gi=(Math.min(V-1,Math.round(y))*V+Math.min(V-1,Math.round(x)))*3;
    col[o]=tc[gi];col[o+1]=tc[gi+1];col[o+2]=tc[gi+2];}

  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  g.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  g.setIndex(ti);g.computeVertexNormals();
  const flat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(g,flat);grp.add(mesh);

  let water=null;
  const w=fl.water;
  if(w&&w.cells.length){
    const wp=[],wi=[],vm=new Map();
    const vert=i=>{let v=vm.get(i);if(v===undefined){v=wp.length/3;wp.push(i%V,(i/V)|0,w.level);vm.set(i,v);}return v;};
    for(const a of w.cells){const A=vert(a),B=vert(a+1),C=vert(a+V),D=vert(a+V+1);wi.push(A,B,C,B,D,C);}
    const wg=new THREE.BufferGeometry();
    wg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(wp),3));
    wg.setIndex(wi);wg.computeVertexNormals();
    water=new THREE.Mesh(wg,new THREE.MeshPhongMaterial({color:0x2a5568,transparent:true,opacity:0.8,
      shininess:90,specular:0x6688aa,side:THREE.DoubleSide,depthWrite:false}));
    grp.add(water);
  }
  return {grp,V,H,name:fl.name,mesh,flat,splat:fl.splat,water};
}
const floors=F.map(buildFloor);for(const f of floors)sc.add(f.grp);

(async()=>{
  for(const f of floors){
    if(!f.splat||!f.splat.layerCount){show('no splat: '+f.name);continue;}
    try{
      const [gr,mk]=await Promise.all([arrayTex(f.splat.layerTex,f.splat.size),arrayTex(f.splat.maskGroups,f.splat.V)]);
      gr.wrapS=gr.wrapT=THREE.RepeatWrapping;gr.magFilter=THREE.LinearFilter;
      gr.minFilter=THREE.LinearMipmapLinearFilter;gr.generateMipmaps=true;
      gr.anisotropy=R.capabilities.getMaxAnisotropy();
      mk.wrapS=mk.wrapT=THREE.ClampToEdgeWrapping;mk.magFilter=mk.minFilter=THREE.LinearFilter;
      gr.needsUpdate=mk.needsUpdate=true;
      let rock=null;
      if(f.splat.rockTex){rock=await new THREE.TextureLoader().loadAsync(f.splat.rockTex);
        rock.wrapS=rock.wrapT=THREE.RepeatWrapping;rock.anisotropy=R.capabilities.getMaxAnisotropy();}
      show('rock texture: '+(rock?'loaded':'MISSING'));
      const m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:VERT,
        fragmentShader:FRAG(f.splat.maskGroups.length,f.splat.layerCount),
        uniforms:{uGround:{value:gr},uMask:{value:mk},uRock:{value:rock},
          uCliff:{value:rock?cliffAmount:0},uScale:{value:texScale}},side:THREE.DoubleSide});
      f.splatMat=m;f.mesh.material=m;mats.push(m);
      show('splat ok: '+f.name+' ('+f.splat.layerCount+' layers)');
    }catch(e){show('splat FAIL '+f.name+': '+e.message);}
  }
})();

let active=0;
function setFloor(i){active=(i+floors.length)%floors.length;floors.forEach((f,k)=>f.grp.visible=k===active);frame();}
let az=0.6,el=0.9,rad,tgt=new THREE.Vector3();
function frame(){const f=floors[active];let s=0;for(const h of f.H)s+=h;tgt.set(f.V/2,f.V/2,s/f.H.length);rad=f.V*0.8;upd();}
function upd(){cam.position.set(tgt.x+rad*Math.cos(el)*Math.cos(az),tgt.y+rad*Math.cos(el)*Math.sin(az),tgt.z+rad*Math.sin(el));cam.lookAt(tgt);}
let drag=false,px=0,py=0;
R.domElement.addEventListener('pointerdown',e=>{drag=true;px=e.clientX;py=e.clientY;});
addEventListener('pointerup',()=>drag=false);
addEventListener('pointermove',e=>{if(!drag)return;az-=(e.clientX-px)*0.005;el=Math.max(0.05,Math.min(1.5,el+(e.clientY-py)*0.005));px=e.clientX;py=e.clientY;upd();});
addEventListener('wheel',e=>{rad*=(1+Math.sign(e.deltaY)*0.1);upd();});
addEventListener('keydown',e=>{
  if(e.key==='f'||e.key==='F')setFloor(active+1);
  if(e.key==='t'||e.key==='T')for(const f of floors)if(f.splatMat)f.mesh.material=(f.mesh.material===f.flat)?f.splatMat:f.flat;
  if(e.key==='c'||e.key==='C'){cliffAmount=cliffAmount?0:1;for(const m of mats)if(m.uniforms.uRock.value)m.uniforms.uCliff.value=cliffAmount;}
});
setFloor(0);
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();R.setSize(innerWidth,innerHeight);upd();});
(function loop(){requestAnimationFrame(loop);R.render(sc,cam);})();

// Read back what actually reached the framebuffer, bucketed by brightness, so
// "the cliffs look black" can be checked against numbers.
window.measure=function(){
  cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();
  R.setSize(innerWidth,innerHeight);R.setPixelRatio(1);
  az=0.6;el=0.75;frame();
  R.render(sc,cam);
  const gl=R.getContext(),w=R.domElement.width,h=R.domElement.height;
  const px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
  let bg=0,dark=0,mid=0,bright=0,n=0,sr=0,sg=0,sb=0;
  const darkPx=[];
  for(let i=0;i<w*h;i++){
    const r=px[i*4],g=px[i*4+1],b=px[i*4+2];
    if(r<20&&g<24&&b<28){bg++;continue;}
    n++;sr+=r;sg+=g;sb+=b;
    const lum=(r+g+b)/3;
    if(lum<30){dark++;if(darkPx.length<6)darkPx.push([r,g,b]);}
    else if(lum<70)mid++;else bright++;
  }
  return JSON.stringify({size:[w,h],mean:[sr/n|0,sg/n|0,sb/n|0],
    darkPct:+(100*dark/n).toFixed(1),midPct:+(100*mid/n).toFixed(1),brightPct:+(100*bright/n).toFixed(1),
    darkSamples:darkPx, log:document.getElementById('err').textContent.trim().split('\\n')});
};
</script></body></html>`;
writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024 / 1024).toFixed(1) + ' MB');
