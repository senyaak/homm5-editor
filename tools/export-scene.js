// Build an interactive 3D scene from a HoMM5 map: the terrain heightmap plus the
// real decoded object meshes, each placed at its map position and rotation.
// Emits a self-contained HTML you open in a browser and orbit with the mouse.
//
// Coordinate convention: the game is Z-up. Object Pos (x,y) are tile coordinates
// (same units as the terrain grid), Rot is a rotation about Z in radians. An
// object's mesh is in local space with its base near Z=0, so it sits on the
// terrain at height(x,y).
//
// Usage: node tools/export-scene.js <map.xdb> <out.html>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { parseTerrain, readHeights } from '../src/terrain.ts';
import { extractMeshes, readGeometryRefFromModelXdb } from '../src/geometry.ts';
import { decodeDDS } from '../src/dds.ts';

const [mapXdb, out] = process.argv.slice(2);
const DATA = 'samples/paks/data';
const readXdb = (href) => { const p = DATA + href.split('#')[0]; return existsSync(p) ? readFileSync(p, 'utf8') : null; };

// --- terrain ---
const mapDir = mapXdb.replace(/[^/]+$/, '');
const terr = parseTerrain(readFileSync(mapDir + 'GroundTerrain.bin'));
const H = readHeights(terr), V = terr.V;
const heightAt = (x, y) => {
  const ix = Math.max(0, Math.min(V - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(V - 1, Math.round(y)));
  return H[iy * V + ix];
};
console.log(`terrain ${V}×${V}`);

// --- objects ---
const map = readFileSync(mapXdb, 'utf8');
const items = [...map.matchAll(/<AdvMap(Static|Building|Treasure)>([\s\S]*?)<\/AdvMap\1>/g)];

// --- tiny PNG encoder + box downsample, for embedding textures as data URIs ---
const crcTab = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTab[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngDataUri(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(body)); return Buffer.concat([l, body, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
function textureDataUri(model, size = 128) {
  try {
    const t = model.match(/<Texture href="([^"]+?)(?:#[^"]*)?"/); if (!t) return null;
    const tx = readXdb(t[1]); const dest = tx && tx.match(/<DestName href="([^"]+)"/); if (!dest) return null;
    const dds = DATA + t[1].split('#')[0].replace(/[^/]+$/, '') + dest[1]; if (!existsSync(dds)) return null;
    const img = decodeDDS(dds);
    const out = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = x * img.width / size | 0, sy = y * img.height / size | 0, si = (sy * img.width + sx) * 4, o = (y * size + x) * 3;
      out[o] = img.rgba[si]; out[o + 1] = img.rgba[si + 1]; out[o + 2] = img.rgba[si + 2];
    }
    return pngDataUri(size, size, out);
  } catch { return null; }
}

const geoms = [];             // unique decoded meshes
const geomIndex = new Map();  // shared-href -> geoms index (or -1 if unusable)
const instances = [];

function resolveGeom(sharedHref) {
  if (geomIndex.has(sharedHref)) return geomIndex.get(sharedHref);
  let idx = -1;
  try {
    const shared = readXdb(sharedHref);
    const modelHref = shared && shared.match(/<Model href="([^"]+)"/);
    const model = modelHref && readXdb(modelHref[1]);
    const ref = model && readGeometryRefFromModelXdb(model);
    if (ref) {
      const binPath = `${DATA}/bin/Geometries/${ref.uid}`;
      if (existsSync(binPath)) {
        const meshes = extractMeshes(readFileSync(binPath), ref.bbox);
        if (meshes.length) {
          // merge submeshes into one buffer for simplicity
          let vc = 0, tc = 0;
          for (const m of meshes) { vc += m.vertexCount; tc += m.indices.length; }
          const pos = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idxs = new Uint32Array(tc);
          let vo = 0, io = 0, hasUV = true;
          for (const m of meshes) {
            pos.set(m.positions, vo * 3);
            if (m.uvs) uv.set(m.uvs, vo * 2); else hasUV = false;
            for (let i = 0; i < m.indices.length; i++) idxs[io + i] = m.indices[i] + vo;
            vo += m.vertexCount; io += m.indices.length;
          }
          idx = geoms.length;
          geoms.push({
            pos: Array.from(pos, (v) => +v.toFixed(3)),
            uv: hasUV ? Array.from(uv, (v) => +v.toFixed(4)) : null,
            idx: Array.from(idxs),
            tex: hasUV ? textureDataUri(model) : null,
          });
        }
      }
    }
  } catch { idx = -1; }
  geomIndex.set(sharedHref, idx);
  return idx;
}

for (const [, , body] of items) {
  const p = body.match(/<Pos>\s*<x>([-\d.]+)<\/x>\s*<y>([-\d.]+)<\/y>\s*<z>([-\d.]+)<\/z>/);
  const rot = body.match(/<Rot>([-\d.eE]+)<\/Rot>/);
  const shared = body.match(/<Shared href="([^"]+?)(?:#[^"]*)?"/);
  if (!p || !shared) continue;
  const gi = resolveGeom(shared[1]);
  if (gi < 0) continue;
  const x = +p[1], y = +p[2];
  instances.push({ g: gi, x, y, z: heightAt(x, y), r: rot ? +rot[1] : 0 });
}
console.log(`objects placed: ${instances.length}  (unique geoms: ${geoms.length})`);

// --- terrain grid as flat arrays ---
const tHeights = Array.from(H, (v) => +v.toFixed(3));

const scene = { V, heights: tHeights, geoms, instances };

// --- HTML ---
const html = `<!doctype html><html><head><meta charset="utf8"><title>HoMM5 map 3D — ${mapXdb.split('/').slice(-2, -1)}</title>
<style>html,body{margin:0;height:100%;background:#0d1014;overflow:hidden;font:12px system-ui;color:#9aa4b2}
#hud{position:fixed;left:12px;top:10px;line-height:1.5;pointer-events:none}#hud b{color:#e6edf3}</style></head><body>
<div id="hud"><b>HoMM5 map — 3D</b><br>${instances.length} objects · ${geoms.length} models · terrain ${V}×${V}<br>drag: orbit · wheel: zoom · right-drag: pan</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script>
const S=${JSON.stringify(scene)};
const scene=new THREE.Scene();scene.background=new THREE.Color(0x0d1014);
const cam=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.5,4000);cam.up.set(0,0,1);
const R=new THREE.WebGLRenderer({antialias:true});R.setSize(innerWidth,innerHeight);R.setPixelRatio(devicePixelRatio);document.body.appendChild(R.domElement);
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();R.setSize(innerWidth,innerHeight);});
scene.add(new THREE.HemisphereLight(0xbcd0ff,0x3a3320,0.9));
const sun=new THREE.DirectionalLight(0xfff0d8,1.0);sun.position.set(0.6,0.4,1);scene.add(sun);

// terrain
const V=S.V;const tg=new THREE.BufferGeometry();
const tp=new Float32Array(V*V*3);
for(let y=0;y<V;y++)for(let x=0;x<V;x++){const o=(y*V+x)*3;tp[o]=x;tp[o+1]=y;tp[o+2]=S.heights[y*V+x];}
const ti=[];for(let y=0;y<V-1;y++)for(let x=0;x<V-1;x++){const a=y*V+x,b=a+1,c=a+V,d=c+1;ti.push(a,c,b,b,c,d);}
tg.setAttribute('position',new THREE.BufferAttribute(tp,3));tg.setIndex(ti);tg.computeVertexNormals();
scene.add(new THREE.Mesh(tg,new THREE.MeshLambertMaterial({color:0x5a6b45})));

// object geometries (shared) + per-model material (textured where available)
const loader=new THREE.TextureLoader();
const grey=new THREE.MeshLambertMaterial({color:0x8a8f98,flatShading:true});
const geos=S.geoms.map(g=>{const b=new THREE.BufferGeometry();b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(g.pos),3));if(g.uv)b.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.uv),2));b.setIndex(g.idx);b.computeVertexNormals();return b;});
const mats=S.geoms.map(g=>g.parts.map(p=>{if(!p.tex)return grey;const tx=loader.load(p.tex);tx.wrapS=tx.wrapT=THREE.RepeatWrapping;tx.flipY=false;return new THREE.MeshLambertMaterial({map:tx});}));
for(const it of S.instances){const m=new THREE.Mesh(geos[it.g],mats[it.g]);m.position.set(it.x,it.y,it.z);m.rotation.z=it.r;scene.add(m);}

// centre camera on map
const c=V/2;const controls=new THREE.OrbitControls(cam,R.domElement);controls.target.set(c,c,3);
cam.position.set(c,-V*0.5,V*0.7);controls.update();
(function loop(){requestAnimationFrame(loop);controls.update();R.render(scene,cam);})();
</script></body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out}  (${(html.length/1024|0)} KB)`);
