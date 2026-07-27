// Playing an object's baked particle effect (docs/EFFECTS_FORMAT.md).
//
// The data is a recording — per particle a birth/death frame and keys for
// centre, rotation, size, colour and texture frame — so "simulation" here is
// only interpolation. Each ParticleInstance of each placed object becomes one
// instanced draw of camera-facing quads; a frame update walks the alive
// particles, lerps their channels at the current loop time and rewrites the
// instance attributes.
//
// Textures: the instance's frame table is packed into one atlas (the baked
// texture index picks the tile), because switching textures per particle would
// break the single draw call.

import * as THREE from 'three';
import type { FxInstancePayload } from '../src/scene.ts';
import type { FxTransfer } from '../src/effects.ts';

/** One playing effect instance, attached to one placed object. */
export interface FxSystem {
  mesh: THREE.Mesh;
  /** Advance to `seconds` on the shared clock (phase is baked into the system). */
  update(seconds: number): void;
  /** Re-place after the owning object moved or turned. */
  setObjectMatrix(m: THREE.Matrix4): void;
  dispose(): void;
}

const loadImg = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/** The instance's frame table as one square-ish atlas + its grid shape. */
async function buildAtlas(textures: (string | null)[], cell = 128): Promise<{ tex: THREE.Texture; cols: number; rows: number }> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(textures.length)));
  const rows = Math.max(1, Math.ceil(textures.length / cols));
  const cv = document.createElement('canvas');
  cv.width = cols * cell; cv.height = rows * cell;
  const cx = cv.getContext('2d');
  if (cx) {
    for (let i = 0; i < textures.length; i++) {
      const uri = textures[i];
      if (!uri) continue; // empty slot stays transparent
      const img = await loadImg(uri);
      if (img) cx.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // The atlas is sampled per tile; letting mips blend neighbouring tiles in
  // smears every frame with its neighbours at distance.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return { tex, cols, rows };
}

const VERT = `
in vec3 aCenter;
in vec3 aSizeRot;
in vec4 aColor;
in float aTex;
out vec2 vUv;
out vec4 vColor;
out float vTex;
void main() {
  vec4 c = modelViewMatrix * vec4(aCenter, 1.0);
  float cr = cos(aSizeRot.z), sr = sin(aSizeRot.z);
  vec2 corner = position.xy * aSizeRot.xy;
  c.xy += vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vColor = aColor;
  vTex = aTex;
}`;

const FRAG = `
precision highp float;
uniform sampler2D uAtlas;
uniform vec2 uGrid; // cols, rows
in vec2 vUv;
in vec4 vColor;
in float vTex;
out vec4 outColor;
void main() {
  if (vTex < -0.5) discard; // hidden frame
  float t = floor(vTex + 0.5);
  float col = mod(t, uGrid.x), row = floor(t / uGrid.x);
  // Canvas row 0 is the TOP; the texture is flipY'd, so v counts from the
  // bottom — a tile on canvas row r spans v rows [rows-1-r, rows-r].
  vec2 uv = vec2(col + vUv.x, (uGrid.y - 1.0 - row) + vUv.y) / uGrid;
  vec4 s = texture(uAtlas, uv);
  // The era's modulate-x2 colour stage, same as the terrain's Whitening: the
  // baked colours are authored around 128 = full brightness. Without it the
  // ghost dragon's mist (colour bytes <=57) renders near-black instead of the
  // pale smoke the game shows. Alpha stays a plain modulate.
  outColor = vec4(s.rgb * vColor.rgb * 2.0, s.a * vColor.a);
  if (outColor.a < 0.003) discard;
}`;

/** Strides of the flat [frame, ...values] channel arrays. */
const STRIDE = { pos: 4, rot: 2, size: 3, color: 5, tex: 2 } as const;
type Chan = keyof typeof STRIDE;

/**
 * Sample a flat channel at frame `f`, linearly interpolated, into `out`
 * starting at `at`. `cur` is this channel's cursor (last key at or before f),
 * advanced in place — frames only move forward between calls until the loop
 * wraps and the caller resets it.
 */
function sample(a: Float32Array, stride: number, cur: number, f: number, out: number[], lerp: boolean): number {
  const keys = a.length / stride;
  while (cur + 1 < keys && a[(cur + 1) * stride]! <= f) cur++;
  const k0 = cur * stride, k1 = Math.min(cur + 1, keys - 1) * stride;
  const f0 = a[k0]!, f1 = a[k1]!;
  const t = lerp && f1 > f0 ? Math.min(1, Math.max(0, (f - f0) / (f1 - f0))) : 0;
  for (let i = 1; i < stride; i++) out[i - 1] = a[k0 + i]! + (a[k1 + i]! - a[k0 + i]!) * t;
  return cur;
}

export function createFxSystem(
  fx: FxInstancePayload, baked: FxTransfer, objectMatrix: THREE.Matrix4, phase: number,
): { system: FxSystem; ready: Promise<void> } {
  const n = Math.min(baked.maxAlive, 4096);
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const aCenter = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const aTex = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  for (const a of [aCenter, aSizeRot, aColor, aTex]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aCenter', aCenter);
  geo.setAttribute('aSizeRot', aSizeRot);
  geo.setAttribute('aColor', aColor);
  geo.setAttribute('aTex', aTex);
  geo.instanceCount = 0;

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uAtlas: { value: null }, uGrid: { value: new THREE.Vector2(1, 1) } },
    transparent: true,
    depthWrite: false,
    blending: fx.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(geo, mat);
  // Positions live in the attributes, not the geometry: three.js cannot know
  // the bounds, and a culled fire that pops in at the screen edge is worse
  // than the cost of always issuing the draw.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...(fx.pos as [number, number, number])),
    new THREE.Quaternion(fx.quat[0], fx.quat[1], fx.quat[2], fx.quat[3]),
    new THREE.Vector3(fx.scale, fx.scale, fx.scale),
  );
  mesh.matrix.multiplyMatrices(objectMatrix, local);
  mesh.renderOrder = 3; // over the water sheet and the ground overlay

  const ready = buildAtlas(fx.textures).then(({ tex, cols, rows }) => {
    mat.uniforms.uAtlas!.value = tex;
    (mat.uniforms.uGrid!.value as THREE.Vector2).set(cols, rows);
  });

  const totalFrames = Math.max(1, baked.duration * baked.rate);
  const parts = baked.particles;
  // One cursor per channel per particle; reset when the loop wraps.
  const cursors = { pos: new Int32Array(parts.length), rot: new Int32Array(parts.length), size: new Int32Array(parts.length), color: new Int32Array(parts.length), tex: new Int32Array(parts.length) };
  let lastF = -1;
  const v: number[] = [0, 0, 0, 0];

  const system: FxSystem = {
    mesh,
    update(seconds: number) {
      const f = ((seconds * fx.speed + phase) * baked.rate) % totalFrames;
      if (f < lastF) for (const c of Object.values(cursors)) c.fill(0);
      lastF = f;
      let w = 0;
      for (let i = 0; i < parts.length && w < n; i++) {
        const p = parts[i]!;
        if (f < p.birth || f > p.death) continue;
        const ch = (name: Chan, arr: Float32Array, lerp: boolean): void => {
          cursors[name][i] = sample(arr, STRIDE[name], cursors[name][i]!, f, v, lerp);
        };
        ch('tex', p.tex, false);
        if (v[0]! < 0) continue; // hidden this frame
        aTex.array[w] = v[0]!;
        ch('pos', p.pos, true);
        aCenter.array[w * 3] = v[0]!; aCenter.array[w * 3 + 1] = v[1]!; aCenter.array[w * 3 + 2] = v[2]!;
        ch('size', p.size, true);
        aSizeRot.array[w * 3] = Math.abs(v[0]!); aSizeRot.array[w * 3 + 1] = Math.abs(v[1]!);
        ch('rot', p.rot, true);
        aSizeRot.array[w * 3 + 2] = v[0]!;
        ch('color', p.color, true);
        aColor.array[w * 4] = v[0]! / 255; aColor.array[w * 4 + 1] = v[1]! / 255;
        aColor.array[w * 4 + 2] = v[2]! / 255; aColor.array[w * 4 + 3] = v[3]! / 255;
        w++;
      }
      geo.instanceCount = w;
      for (const a of [aCenter, aSizeRot, aColor, aTex]) a.needsUpdate = true;
    },
    setObjectMatrix(m: THREE.Matrix4) {
      mesh.matrix.multiplyMatrices(m, local);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      (mat.uniforms.uAtlas!.value as THREE.Texture | null)?.dispose();
    },
  };
  return { system, ready };
}
