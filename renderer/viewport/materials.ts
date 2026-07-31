// Materials and geometry for one decoded model.
//
// What a submesh looks like is decided here and nowhere else: the blend mode
// comes from the file's <AlphaMode>, never from inspecting the texels.

import * as THREE from 'three';

import type { GeomData, GeomPart } from '#src/scene/payload.ts';

const texLoader = new THREE.TextureLoader();
const greyMat = new THREE.MeshLambertMaterial({ color: 0x8a8f98, side: THREE.DoubleSide });

/**
 * Materials shared across every part that uses the same texture, so a model
 * naming one material for several meshes uploads it once.
 */
const texCache = new Map<string, THREE.Material>();

/** Load a part's own texture the way the renderer expects it (unflipped, tiling). */
export function partTexture(src: string): THREE.Texture {
  const tx = texLoader.load(src);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.flipY = false;
  return tx;
}

/**
 * Material for one submesh: its own texture, blended as its material says.
 *
 * The mode comes from the file's <AlphaMode>, not from inspecting the texels.
 * Guessing from the image said "this has soft edges, so alpha-test it", which
 * is exactly wrong for a decal meant to be blended: the Abandoned Mine's base
 * plate is a nearly black texture at alpha 33/255, and drawn opaque it is the
 * grey slab under the building instead of a soft shadow on the grass.
 */
export function materialFor(part: GeomPart): THREE.Material {
  if (!part.tex) return greyMat;
  // Cached per texture AND mode: the same image is used both ways in places.
  // Flatness is in the key because it changes the material: the same texture in
  // the same blend mode is a depth-writing body on one mesh and a decal on
  // another.
  const key = `${part.alphaMode}|${part.projectOnTerrain ? 'proj' : 'own'}|${part.opaque ? 'body' : 'sheer'}|${part.additive ? 'add' : ''}${part.selfIllum ? 'lit' : ''}|${part.tex}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const tx = partTexture(part.tex);
  // A diffuse texture holds sRGB-encoded colour. Left unmarked, three samples it
  // as linear, so the shader over-brightens every texel and the deep browns wash
  // out to a flat pale grey -- the Garrison wall looked untextured for exactly
  // this reason. Tagging it sRGB makes the sampler decode to linear before
  // lighting, and the render finally shows the wood.
  tx.colorSpace = THREE.SRGBColorSpace;
  // A self-illuminated part (L_SELFILLUM: portal runes, spell auras) emits its
  // own colour, so it uses an unlit material — a Lambert would drop it into
  // shadow the game never shows.
  const m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial = part.selfIllum
    ? new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide });
  switch (part.alphaMode) {
    case 'AM_ALPHA_TEST':
      // Cutout (foliage): discard transparent texels so leaves aren't opaque
      // black cards, without paying for sorted transparency.
      m.alphaTest = 0.5;
      break;
    case 'AM_TRANSPARENT':
    case 'AM_OVERLAY':
    case 'AM_DECAL':
      // Blended. Whether it writes depth turns on whether the texture is a solid
      // skin, not on the blend mode or the mesh shape. A body with an opaque
      // texture (Mountain10x10's rock, 96% opaque) must occlude or it goes
      // see-through and draws its far side over its near one. A sheer overlay
      // (the Abandoned Mine's hill, 11% opaque, projected onto and blended into
      // the terrain) must NOT write depth: its near-invisible pixels would
      // occlude the ground behind it, punching the hole Senya saw where the
      // earth should be. Flatness cannot tell these two apart — both are
      // non-flat AM_OVERLAY.
      m.transparent = true;
      m.depthWrite = part.opaque;
      break;
    case 'AM_OVERLAY_ZWRITE':
      m.transparent = true;
      break;
    default: // AM_OPAQUE
      break;
  }
  // A part that declares ProjectOnTerrain lies ON the ground rather than above
  // it, so it is coplanar with the terrain and z-fights with it. Push it toward
  // the camera in depth only — the geometry does not move.
  if (part.projectOnTerrain) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
    m.depthWrite = false;
  }
  // Additive (AddPlaced): the texels are ADDED to the background, so the part
  // reads as light — a portal's glow, a spell aura. Black adds nothing and
  // bright core adds a lot. It must not write depth, or its own far side would
  // occlude its near one and the glow would tear.
  if (part.additive) {
    m.blending = THREE.AdditiveBlending;
    m.transparent = true;
    m.depthWrite = false;
  }
  texCache.set(key, m);
  return m;
}

/** Geometry for one decoded model, with a group per submesh. */
export function geometryFor(g: GeomData): THREE.BufferGeometry {
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  if (g.uv) b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uv), 2));
  b.setIndex(g.idx);
  // A group per submesh, indexed into the material array. Drawn as one group
  // instead, every mesh of a building took whichever texture came first.
  g.parts.forEach((p, i) => b.addGroup(p.start, p.count, i));
  // Prefer the authored normals; computing them averages across every face at a
  // vertex and softens the hard edges that give a model its shape.
  if (g.nrm) b.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nrm), 3));
  else b.computeVertexNormals();
  // The binding rides along on the shared geometry: it is the same for every
  // copy of a model, only the skeleton differs per object. Harmless on the
  // instanced draws, which never look at it.
  if (g.skin?.clip) {
    b.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(g.skin.index), 4));
    b.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(g.skin.weight), 4));
  }
  return b;
}
