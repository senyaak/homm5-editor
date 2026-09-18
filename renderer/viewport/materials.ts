// Materials and geometry for one decoded model.
//
// What a submesh looks like is decided here and nowhere else: the blend mode
// comes from the file's <AlphaMode>, never from inspecting the texels.
//
// And how it is LIT is decided here too, by the game's formula rather than
// three.js's. See `gameLit` below for what that means and how it was measured.

import * as THREE from 'three';

import { drapeThreeShader } from '#viewport/drape.ts';
import { uSunDir, uSunCol, uAmbCol, uShadeCol, uIncidentCol, uWhiten } from '#viewport/lighting.ts';
import { renderer } from '#viewport/stage.ts';
import type { CompressedPicture, GeomData, GeomPart, Picture } from '#src/scene/payload.ts';

/**
 * The space a diffuse texture is sampled in — RAW, and the same one the probe
 * below measures through, deliberately.
 *
 * A texture does hold gamma-encoded colour, and while three.js did the lighting
 * it had to be tagged sRGB so the sampler decoded it first; untagged, every
 * texel was over-brightened and the Garrison's wall washed out to pale grey.
 * The shading here is the game's now, and the game multiplied the texel as it
 * lay in the file, so decoding it would be the mistake: texture in gamma, sum
 * in gamma, result written in gamma. Same reason the terrain splat samples raw.
 *
 * It is one constant rather than two identical lines so that changing it moves
 * `shadeProbe` too, and the arithmetic test notices.
 */
const DIFFUSE_SPACE = THREE.NoColorSpace;

/**
 * Shade a material the way the game does, instead of the way three.js does.
 *
 * WHAT THE GAME DOES, and how that is known. Its object shader is in the
 * executable as assembler text (docs/LIGHTING.md §2): it samples the texture
 * and multiplies by an interpolated vertex COLOUR — `mul_x4_sat r0.rgb, v0, t0`.
 * A probe inside the running game adds that `D3DRS_LIGHTING` is 0, that
 * `SetLight` and `SetMaterial` are never called at all, and that no preset
 * colour ever reaches a shader constant: the colour is baked per vertex by the
 * CPU at load. The same probe then read 390,000 of those baked vertices back
 * out of the vertex buffer, which is where the mix below comes from — a
 * surface is `albedo · mix · 2`, clamped, every multiply in GAMMA space on the
 * raw texel.
 *
 * WHY NOT LEAVE IT TO THREE.JS. Because three.js lights in LINEAR space, and
 * that is not a brightness difference, it is a colour one. A preset's sun is
 * authored as a gamma value: the Inferno arena's 0.635/0.267/0.141 becomes
 * 0.361/0.058/0.018 once decoded as sRGB — the green channel loses a factor of
 * four and a warm sun turns into a red one. The knights in C1M1's opening came
 * out salmon-pink against ground that was fine, because the ground already ran
 * this sum and they did not.
 *
 * HOW, mechanically. `onBeforeCompile` rather than a ShaderMaterial of our own:
 * the vertex side has to keep three's skinning, instancing and morph handling,
 * which an actor and a forest of trees both depend on. Only the end of the
 * fragment shader is replaced — the lighting three computed is dropped on the
 * floor, and `<colorspace_fragment>` (the linear→sRGB encode) goes with it,
 * because the value we write is already the gamma value the game would write.
 */
function gameLit(m: THREE.Material, lit: boolean, drape = false): void {
  m.onBeforeCompile = (shader) => {
    // A draped part takes the ground under each vertex (drape.ts); the
    // fragment side below is the same either way.
    if (drape) drapeThreeShader(shader);
    shader.uniforms.uSunDir = uSunDir;
    shader.uniforms.uSunCol = uSunCol;
    shader.uniforms.uAmbCol = uAmbCol;
    shader.uniforms.uWhiten = uWhiten;
    shader.uniforms.uShadeCol = uShadeCol;
    shader.uniforms.uIncidentCol = uIncidentCol;
    // Lit: the sun arrives in WORLD space (it is the map's, not the camera's)
    // while a fragment normal is in view space, so it is turned on the way in.
    //
    // Unlit: a self-illuminated part emits its own colour and is written as it
    // lies in the file — no sun. Doubling it is not "unlit with a bright
    // light": it blew the arena's grass tufts out to a solid acid-green hedge,
    // because a texel authored to be shown at face value went out at twice that.
    //
    // THE MIX, and it is measured rather than modelled. The engine bakes this
    // colour per vertex on the CPU; the probe read 390,000 of them out of the
    // vertex buffer and fitted them (docs/LIGHTING.md §2). `LightColor` is not
    // a term ADDED to ambient — it is the colour a surface facing the sun is
    // turned INTO, and `ShadeColor` is the colour of one facing away:
    //
    //   colour = Ambient + max(N·L,0)·(Light − Ambient) + max(−N·L,0)·(Shade − Ambient)
    //
    // Every coefficient of that fit landed on a preset field to the byte, R²
    // 0.999–1.000, and the flat ground it predicts (42/50/73 and 55/65/84)
    // is what the buffer holds for flat ground. The old
    // `min(4·(Ambient + Light·N·L), 2)` was wrong in structure, not in tuning:
    // it had no `ShadeColor` at all, and its cap doubled every texel of every
    // day preset.
    //
    // `vNormal`, not three's `normal`: a double-sided material flips the normal
    // on back faces (`normal * faceDirection`), and the shipped meshes do not
    // keep one winding — a quarter of the peasant's 2252 triangles are wound
    // against their own authored normal. The game never flips anything: it
    // computes the vertex colour from the authored normal on the CPU.
    // IN SHADOW, the same sum is evaluated a second time with
    // `IncidentShadowColor` where `LightColor` was, and the shadow map picks
    // between the two — the engine bakes both into the vertex and its pixel
    // shader's `cnd` chooses (docs/LIGHTING.md §3b). A shadow here is therefore
    // a different COLOUR, not a darker one, and the ambient and shade ends of
    // the mix are untouched: a face already turned away from the sun looks the
    // same in shadow as out of it, which is also why back faces need no special
    // case the way the engine's own `oT2 + 1` gives them.
    //
    // `getShadow` is three's, and the mask it returns is the same question the
    // engine's height test asks — see renderer/viewport/shadows.ts for why the
    // two maps are the same map. Guarded on NUM_DIR_LIGHT_SHADOWS because the
    // program is compiled without it whenever the sun does not cast (no preset)
    // or the mesh does not receive.
    const sum = lit
      ? `vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
         float ndl = dot(normalize(vNormal), sunV);
         float sunlit = 1.0;
         #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
           if (receiveShadow) {
             DirectionalLightShadow dls = directionalLightShadows[0];
             sunlit = getShadow(directionalShadowMap[0], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias,
                                dls.shadowRadius, vDirectionalShadowCoord[0]);
           }
         #endif
         vec3 sunEnd = mix(uIncidentCol, uSunCol, sunlit);
         vec3 light = (uAmbCol + max(ndl, 0.0) * (sunEnd - uAmbCol)
                                + max(-ndl, 0.0) * (uShadeCol - uAmbCol)) * uWhiten;`
      : `vec3 light = vec3(1.0);`;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec3 uSunDir; uniform vec3 uSunCol;
uniform vec3 uAmbCol; uniform vec3 uShadeCol; uniform vec3 uIncidentCol;
uniform float uWhiten;
void main() {`)
      .replace('#include <colorspace_fragment>', `${sum}
  gl_FragColor = vec4(min(diffuseColor.rgb * light, vec3(1.0)), diffuseColor.a);`);
  };
  // Two materials that compile to different programs must not share a cache
  // entry, and three keys that cache on the program's own source plus this.
  m.customProgramCacheKey = () => `${lit ? 'game-lit' : 'game-unlit'}${drape ? '-draped' : ''}`;
}

// The stand-in for a sky-dome part whose texture did not resolve: draw nothing
// there. `visible` on a material skips just that geometry group.
const skyHole = new THREE.MeshBasicMaterial({ visible: false });

// Two-sided on purpose, unlike the textured parts below: this is the stand-in
// for a part whose texture did not resolve, and a stand-in that can also be
// invisible from one side is a worse witness than a grey face.
const greyMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
// Written into the working space raw, not through the hex constructor: these
// are the gamma numbers the shader below multiplies, and three would decode a
// hex colour to linear on the way in and halve them.
greyMat.color.setRGB(0.54, 0.56, 0.6, THREE.LinearSRGBColorSpace);
gameLit(greyMat, true);

/**
 * Materials shared across every part that uses the same texture, so a model
 * naming one material for several meshes uploads it once.
 */
const texCache = new Map<string, THREE.Material>();

/** The pictures with no key of their own, numbered as they come, so the material cache can name them. */
const pictureIds = new WeakMap<Picture | CompressedPicture, number>();
let pictures = 0;
/** What tells one picture from another in a cache key: its file and cap, or its number. */
export function pictureKey(p: Picture | CompressedPicture): string {
  if (p.key) return p.key;
  let id = pictureIds.get(p);
  if (id === undefined) { id = pictures++; pictureIds.set(p, id); }
  return `#${id}`;
}

/** Whether this GPU takes S3TC blocks — asked once, told to the main process, which then ships textures as the game does. */
export const S3TC = renderer.extensions.has('WEBGL_compressed_texture_s3tc');
const DXT_FORMAT = {
  // RGBA rather than RGB for DXT1: the c0 <= c1 mode's index 3 is a
  // transparent texel, which is how the foliage cutouts are authored.
  DXT1: THREE.RGBA_S3TC_DXT1_Format, DXT3: THREE.RGBA_S3TC_DXT3_Format, DXT5: THREE.RGBA_S3TC_DXT5_Format,
} as const;

/**
 * A part's own texture the way the renderer expects it (unflipped, tiling,
 * mipmapped) — from its texels, or from the file's own blocks and mip
 * chain, which go to the GPU as they are.
 */
export function partTexture(pic: Picture | CompressedPicture): THREE.Texture {
  let tx: THREE.Texture;
  if ('levels' in pic) {
    tx = new THREE.CompressedTexture(pic.levels, pic.width, pic.height, DXT_FORMAT[pic.format], THREE.UnsignedByteType);
    // The chain is the file's, complete to 1×1 (dds.ts ddsChain); nothing to generate.
    tx.generateMipmaps = false;
  } else {
    tx = new THREE.DataTexture(pic.rgba, pic.width, pic.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    // A DataTexture is born unfiltered and without mipmaps; a model's skin
    // wants what an image-loaded texture gets by default.
    tx.generateMipmaps = true;
  }
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  // Row 0 is the top, as it lies in the file; the UVs were authored for that.
  tx.flipY = false;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.magFilter = THREE.LinearFilter;
  tx.needsUpdate = true;
  // Anisotropic filtering, at whatever the card allows. Every surface a scene
  // shows at a slant — the ground under a shot, a wall running away from the
  // camera, the flat of a blade — is sampled along its short axis by a plain
  // mip chain, so it blurs in the one direction the picture is longest. It
  // costs a sampler flag and nothing in the payload.
  tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tx;
}

/**
 * What decides a part's material, as a string: two parts with the same key
 * draw with the same material object (`materialFor` caches by it), and so
 * can be one draw (`geometryFor` merges them).
 */
export function materialKey(part: GeomPart): string {
  if (!part.tex) return `none|${part.terrainProjected ? 'hole' : 'grey'}`;
  const decal = part.projectOnTerrain && part.flat;
  return `${part.alphaMode}|${part.projectOnTerrain ? 'draped' : 'rigid'}|${decal ? 'decal' : 'body'}|${part.opaque ? 'body' : 'sheer'}|${part.additive ? 'add' : ''}${part.selfIllum ? 'lit' : ''}${part.twoSided ? '2s' : ''}${part.card ? 'card' : ''}|${pictureKey(part.tex)}`;
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
export function materialFor(part: GeomPart, sky = false): THREE.Material {
  // A sky-dome part with no texture must vanish, not grey out: the dome rides
  // the camera with depth ignored, so a grey stand-in here is not a grey prop
  // in the distance but a wall across the whole frame.
  // A ground-projected part with no texture of its own (the crag skin under a
  // stone, a pit's bowl) is drawn as the ground once the floor's textures are
  // up (splat.ts); until then it is nothing rather than a grey plate over
  // the ground it is about to become.
  if (!part.tex) return sky || part.terrainProjected ? skyHole : greyMat;
  // Cached per texture AND mode: the same image is used both ways in places.
  // Draping and flatness are in the key because they change the material: the
  // same texture in the same blend mode is a depth-writing body on one mesh
  // and a decal on another.
  const decal = part.projectOnTerrain && part.flat;
  const key = `${sky ? 'sky|' : ''}${materialKey(part)}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const tx = partTexture(part.tex);
  tx.colorSpace = DIFFUSE_SPACE;
  // Back faces are CULLED unless the material asks for both, because that is
  // what the engine does — and what a camera standing inside a mountain needs:
  // culled, the ridge C1M1 pulls back into is not there to be seen from within;
  // drawn, its inside fills the frame (payload.ts, GeomPart.twoSided). The
  // shipped winding is counter-clockwise-out, which is the side three keeps:
  // every closed body on that stage has a positive signed volume (the mountains
  // 1089 and 391, the sanctuary 54), and only the sheets of grass — which are
  // the two-sided ones anyway — come out negative.
  const side = part.twoSided ? THREE.DoubleSide : THREE.FrontSide;
  // A self-illuminated part (L_SELFILLUM: portal runes, spell auras) emits its
  // own colour, so it uses an unlit material — a Lambert would drop it into
  // shadow the game never shows.
  const m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial = part.selfIllum
    ? new THREE.MeshBasicMaterial({ map: tx, side })
    : new THREE.MeshLambertMaterial({ map: tx, side });
  // One pass, as the game draws it. Left to itself three draws a blended
  // two-sided material TWICE — back faces, then front — and sets the
  // material's `needsUpdate` before each, so every such part was two draw
  // calls and two program re-resolves a frame (`getParameters` was 3% of a
  // stress map's profile, all of it this). The game's renderer submits a
  // part once with its cull mode; so do we.
  m.forceSinglePass = true;
  // Lambert for the lit parts only because its fragment shader is the one that
  // brings a normal along; the lighting it computes with it is thrown away.
  // A <ProjectOnTerrain> part is draped over the ground under it (drape.ts),
  // whatever it blends like: the opaque rocks, the alpha-tested bushes and the
  // marker overlays all hug the slope. (The ground-composited overlays never
  // reach here — splat.ts builds theirs, draped the same way.)
  gameLit(m, !part.selfIllum, part.projectOnTerrain);
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
  // A flat draped part lies ON the ground, coplanar with the terrain, and
  // z-fights with it. Push it toward the camera in depth only.
  if (decal) {
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
  // A sky-dome part is a backdrop, not scenery: its materials declare
  // IgnoreZBuffer, so it neither tests nor writes depth — the mesh is painted
  // first (negative renderOrder) and the whole world lays over it.
  if (sky) {
    m.depthTest = false;
    m.depthWrite = false;
  }
  // An effect's stand-in card is a marker, drawn on request (the explorer's
  // "effect markers"), and a marker casts no shadow — a ten-unit square under
  // every gold pile was the card's. Three has no per-group castShadow; what it
  // has is a depth variant per source material whenever that material carries
  // a map and an alphaTest, and the variant copies the alphaTest. So the card
  // asks for an alpha test no texel can pass, which empties its shadow, and
  // its own colour pass has the test taken back out.
  if (part.card) {
    m.alphaTest = 2;
    const shade = m.onBeforeCompile, cacheKey = m.customProgramCacheKey;
    m.onBeforeCompile = (shader, r) => {
      shade.call(m, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '');
    };
    m.customProgramCacheKey = () => cacheKey.call(m) + '-card';
  }
  texCache.set(key, m);
  return m;
}

/**
 * What one lit surface actually comes out as — the measuring surface for the
 * shading above.
 *
 * A known albedo and a known world normal go in, the pixel the GPU produced
 * comes out, 0..255. That makes the light model checkable by arithmetic rather
 * than by eye: the answer must be `albedo · (ambient + sun·N·L) · Whitening`
 * clamped, in the preset's own numbers, which a test can compute for itself
 * from `ambientState()`. Break the space, the clamp or the factor and the
 * number moves — which is the whole point of having it.
 */
export function shadeProbe(albedo: [number, number, number],
                           normal: [number, number, number]): [number, number, number] {
  const tex = new THREE.DataTexture(
    new Uint8Array([Math.round(albedo[0] * 255), Math.round(albedo[1] * 255),
      Math.round(albedo[2] * 255), 255]), 1, 1);
  tex.colorSpace = DIFFUSE_SPACE;
  tex.needsUpdate = true;
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  gameLit(mat, true);

  // A quad facing the camera, whose NORMALS are the ones asked about — the
  // shape is only there to fill the pixel; the normal is the question.
  const geo = new THREE.PlaneGeometry(4, 4);
  const n = new Float32Array(4 * 3);
  for (let i = 0; i < 4; i++) { n[i * 3] = normal[0]; n[i * 3 + 1] = normal[1]; n[i * 3 + 2] = normal[2]; }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  const mesh = new THREE.Mesh(geo, mat);
  const probeScene = new THREE.Scene();
  probeScene.add(mesh);
  // Straight down the -z of an identity view, so `viewMatrix` is the identity
  // and a world normal reaches the shader unturned.
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.set(0, 0, 5);

  const target = new THREE.WebGLRenderTarget(1, 1);
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(probeScene, cam);
  const out = new Uint8Array(4);
  renderer.readRenderTargetPixels(target, 0, 0, 1, 1, out);
  renderer.setRenderTarget(was);
  target.dispose();
  geo.dispose();
  mat.dispose();
  tex.dispose();
  return [out[0]!, out[1]!, out[2]!];
}

/** Geometry for one decoded model, with a group per submesh. */
export function geometryFor(g: GeomData): THREE.BufferGeometry {
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  if (g.uv) b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uv), 2));
  // A group per MATERIAL, indexed into the per-part material array by the
  // first part that uses it. A group is a draw call, and a model's meshes
  // often wear one texture several times over — a building's walls, a
  // tree's branches — which drawn as a group each was 330 calls for the 235
  // materials of A2C1M1's static batches, and 203 for 122 among the
  // creatures. Parts sharing a material are laid out contiguously in the
  // index buffer so one group can cover them; the material array itself
  // stays per part, which is how the rest of the renderer addresses it
  // (an effect's card switched off by its part index, a draped part's
  // material replaced by its index), and a merged group's parts share the
  // material object those writes go to. Drawn as ONE group instead, every
  // mesh of a building took whichever texture came first.
  const keys = g.parts.map((p) => materialKey(p));
  const groups: number[][] = [];
  const byKey = new Map<string, number>();
  keys.forEach((k, i) => {
    let at = byKey.get(k);
    if (at === undefined) { at = groups.length; byKey.set(k, at); groups.push([]); }
    groups[at]!.push(i);
  });
  if (groups.length === g.parts.length) {
    b.setIndex(new THREE.BufferAttribute(g.idx, 1));
    g.parts.forEach((p, i) => b.addGroup(p.start, p.count, i));
  } else {
    const idx = new Array<number>(g.idx.length);
    let at = 0;
    for (const members of groups) {
      const start = at;
      for (const i of members) {
        const p = g.parts[i]!;
        for (let k = p.start; k < p.start + p.count; k++) idx[at++] = g.idx[k]!;
      }
      b.addGroup(start, at - start, members[0]!);
    }
    b.setIndex(idx);
  }
  // Which vertices drape over the ground, as a per-vertex flag (drape.ts). The
  // colour pass knows it per part, from the part's own material; the SHADOW
  // pass draws the whole model with one depth material and has no part to ask,
  // so it reads the flag off the vertex. Without it, Bigtree's trunk — four of
  // its six parts draped — was drawn draped and shadow-tested against its own
  // undraped self, and on a slope, wherever the drape had moved it down, it
  // stood in its own shadow: the trunk going dark at some turns of the tree
  // and not others, as the vertices that moved down changed with the rotation.
  if (g.parts.some((p) => p.projectOnTerrain)) {
    const flag = new Float32Array(g.pos.length / 3);
    for (const p of g.parts) {
      if (!p.projectOnTerrain) continue;
      for (let k = p.start; k < p.start + p.count; k++) flag[g.idx[k]!] = 1;
    }
    b.setAttribute('aDrape', new THREE.BufferAttribute(flag, 1));
  }
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
