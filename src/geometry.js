// -----------------------------------------------------------------------------
// HoMM5 geometry container reader (bin/Geometries/<uid>)
// -----------------------------------------------------------------------------
//
// Heroes V stores meshes as a binary serialization of the same tree its .xdb
// files express in XML. This module decodes the parts of that format we have
// reverse-engineered with confidence. See docs/GEOMETRY_FORMAT.md for the full
// write-up, including what is CONFIRMED and what is still OPEN.
//
// Confidence legend used below:  [OK] verified byte-exact   [~] heuristic
//
// ── Container grammar ────────────────────────────────────────────────────────
// The file is a tree of records. Every record starts with a 1-byte tag in
// 0x01..0x0f. What follows the tag depends on the next byte:
//
//   [OK] scalar int32     tag 0x08 <u32>                     (6 bytes)
//   [OK] length-prefixed  tag <u32 sizeB> <body>             (5 + byteLen bytes)
//        block            where  byteLen = (sizeB - 1) / 2   (sizeB is odd)
//
// A block body is EITHER a NODE (more records) or a LEAF (a raw typed array:
// vertex positions, normals, uvs or indices). The stored schema — which we do
// not have — tells the engine which; we disambiguate by context (a leaf's
// byteLength equals a just-declared element count times a known stride).
//
// ── What each number means (mountain sample, uid AA93C8D1-…) ─────────────────
//   [OK] tag 0x08 int right before a positions block = that block's VERTEX COUNT
//   [OK] a positions leaf = count × 12 bytes = count × vec3<f32> (X, Y, Z)
//        Decoded XYZ match the Size/Center bounding box from the .(Geometry).xdb
//        exactly, across every mesh tested — this is our ground truth anchor.
//   [~]  index data is uint16; normals/uvs are further f32 leaves (vec3 / vec2)
//   [~]  the file often stores the whole payload twice (two ~equal halves)
//
// ── OPEN (not yet byte-exact) ────────────────────────────────────────────────
//   * Pairing each submesh's positions with ITS OWN index buffer. Meshes carry
//     several vertex streams and reordered indices; a naive "positions + nearest
//     uint16 run" pairing produces wrong topology (long spurious triangles).
//   * Exact normal / uv / tangent stream layout and per-submesh material split.
//
// The reliable, presentable capability today: enumerate the container tree and
// extract vertex POSITION arrays (validated against the mesh bounding box).
// -----------------------------------------------------------------------------

/** @typedef {{cx:number,cy:number,cz:number,sx:number,sy:number,sz:number}} BBox */

/**
 * Read a single record at offset `p`.
 * @returns {{next:number, rec:object}|null} the record and the offset just past
 *   it, or null if `p` is not a well-formed record start.
 */
function readRecord(b, p, end) {
  if (p >= end) return null;
  const tag = b[p];
  if (tag < 0x01 || tag > 0x0f) return null;
  if (p + 6 <= end && b[p + 1] === 0x08) {
    return { next: p + 6, rec: { off: p, tag, int: b.readUInt32LE(p + 2) } };
  }
  if (p + 5 > end) return null;
  const sizeB = b.readUInt32LE(p + 1);
  if ((sizeB & 1) === 0) return null; // block sizes are always odd (2n+1)
  const byteLen = (sizeB - 1) / 2;
  const body = p + 5, bodyEnd = body + byteLen;
  if (byteLen < 1 || bodyEnd > end) return null;
  return { next: bodyEnd, rec: { off: p, tag, byteLen, body, bodyEnd } };
}

/**
 * Walk the container as a flat, in-order list of records at a single level,
 * starting at `start`. This does not recurse; it is the robust primitive the
 * higher-level extractors build on. Stops at the first byte that is not a valid
 * record (returns whatever it parsed plus the stop offset).
 * @param {Buffer} b
 * @returns {{records:object[], stoppedAt:number}}
 */
export function scanRecords(b, start = 0, end = b.length) {
  const records = [];
  let p = start;
  for (;;) {
    const r = readRecord(b, p, end);
    if (!r) break;
    records.push(r.rec);
    p = r.next;
  }
  return { records, stoppedAt: p };
}

/**
 * Extract every vertex POSITION array in the file: a length-prefixed block whose
 * byteLength is a multiple of 12 (vec3<f32>) and whose decoded points all fall
 * inside the mesh bounding box. This is our most reliable read — positions are
 * self-validating against the box declared in the .(Geometry).xdb.
 *
 * @param {Buffer} b   raw bin/Geometries/<uid> bytes
 * @param {BBox} bbox  Size (sx,sy,sz) + Center (cx,cy,cz) from the .(Geometry).xdb
 * @param {number} [margin=0.25]  bbox slack (positions can sit slightly outside)
 * @returns {{offset:number, count:number, positions:Float32Array}[]}
 *   one entry per position array found, each `positions` laid out [x,y,z, x,y,z…]
 */
export function extractPositionArrays(b, bbox, margin = 0.25) {
  const C = [bbox.cx, bbox.cy, bbox.cz];
  const S = [bbox.sx, bbox.sy, bbox.sz];
  const lo = C.map((c, i) => c - S[i] / 2 - S[i] * margin);
  const hi = C.map((c, i) => c + S[i] / 2 + S[i] * margin);
  const inBox = (x, y, z) =>
    x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];

  const out = [];
  let p = 0;
  while (p + 5 < b.length) {
    // Only length-prefixed blocks can be position arrays.
    if (b[p] < 0x01 || b[p] > 0x0f || b[p + 1] === 0x08) { p++; continue; }
    const sizeB = b.readUInt32LE(p + 1);
    if ((sizeB & 1) === 0) { p++; continue; }
    const byteLen = (sizeB - 1) / 2;
    const body = p + 5;
    if (byteLen < 36 || byteLen % 12 !== 0 || body + byteLen > b.length) { p++; continue; }

    const count = byteLen / 12;
    let inside = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const o = body + i * 12;
      const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8);
      if (inBox(x, y, z)) {
        inside++;
        for (let k = 0; k < 3; k++) { const v = [x, y, z][k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      }
    }
    // Require nearly all points in-box AND the cloud to actually span the box on
    // at least two axes — this rejects near-zero float arrays (e.g. normals).
    const spans = [0, 1, 2].filter((k) => (mx[k] - mn[k]) / S[k] > 0.3).length;
    if (inside / count > 0.95 && spans >= 2) {
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i++) positions[i] = b.readFloatLE(body + i * 4);
      out.push({ offset: body, count, positions });
      p = body + byteLen;
    } else {
      p++;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Full mesh decode
// -----------------------------------------------------------------------------
//
// A geometry file is a tree of nodes (see the grammar above). Each renderable
// mesh is a node holding three leaves we care about:
//
//   positions   count₁ × vec3<f32>          unique XYZ, fit the .xdb bbox   [OK]
//   remap       count₂ × u16  (all < count₁) render-vertex → position index [OK]
//   indices     tris   × 3×u16 (all < count₂) triangle list                 [OK]
//
// The engine splits a shared position into several render vertices so each can
// carry its own normal/uv (a "vertex split"). To rebuild drawable geometry:
//
//   renderVertex[i].position = positions[ remap[i] ]        i ∈ [0, count₂)
//   triangles reference renderVertex indices directly
//
// This is verified: reconstructing the mountain this way yields 0 stray edges
// (max edge ≈ 4.8 on a 24-wide mesh); pairing indices with raw positions does
// not. The file usually stores the whole mesh twice (LOD/copy) — we return the
// first of each.

/**
 * Recursively parse the container into a record tree.
 * @returns {{records:Array, tail:number}} records at this level (each is either
 *   `{tag,int}`, `{tag,body,byteLen,leaf:true}` or `{tag,body,byteLen,node}`)
 */
export function parseTree(b, start = 0, end = b.length, depth = 0) {
  const records = [];
  let p = start;
  while (p < end) {
    const r = readRecord(b, p, end);
    if (!r) break; // trailing padding / sentinel bytes
    const rec = r.rec;
    if (!('int' in rec) && depth < 24) {
      // A body is a node iff it starts with a well-formed record; raw arrays don't.
      const first = readRecord(b, rec.body, rec.bodyEnd);
      if (first && first.next <= rec.bodyEnd) rec.node = parseTree(b, rec.body, rec.bodyEnd, depth + 1);
      else rec.leaf = true;
    } else if (!('int' in rec)) rec.leaf = true;
    records.push(rec);
    p = r.next;
  }
  return { records, tail: end - p };
}

/** Collect every leaf in the tree (depth-first) with its byte range. */
function collectLeaves(tree, out = []) {
  for (const r of tree.records) {
    if (r.leaf) out.push(r);
    else if (r.node) collectLeaves(r.node, out);
  }
  return out;
}

/**
 * Decode drawable meshes from a geometry binary.
 * @param {Buffer} b
 * @param {BBox} bbox  from the mesh's .(Geometry).xdb (positions are matched to it)
 * @returns {{positions:Float32Array, indices:Uint32Array, vertexCount:number, triCount:number}[]}
 *   one entry per mesh; `positions` is the render vertices [x,y,z,…] and
 *   `indices` are triangle indices into them.
 */
// Above this fraction of full-span triangle edges, a decoded mesh is considered
// mis-decoded (wrong encoding) and is dropped rather than rendered as garbage.
// Real models rarely have edges spanning half their bounding box; a few percent
// is normal, but 6%+ means the topology is wrong (usually an interleaved vertex
// buffer we don't parse). Tunable — lower drops more suspect models.
const SHATTER_THRESHOLD = 0.06;

export function extractMeshes(b, bbox) {
  const posArrays = extractPositionArrays(b, bbox); // count × vec3, bbox-validated
  const leaves = collectLeaves(parseTree(b));
  const readU16Leaf = (r) => {
    const n = r.byteLen / 2, a = new Uint16Array(n);
    for (let i = 0; i < n; i++) a[i] = b.readUInt16LE(r.body + i * 2);
    return a;
  };
  const u16Max = (a) => { let mx = 0; for (const v of a) if (v > mx) mx = v; return mx; };

  // Score a (positions, indices) pair by how "shattered" it is: the fraction of
  // triangle edges longer than half the model's bounding-box diagonal. Correct
  // topology sits near 0; a wrong index/positions pairing explodes to a large
  // fraction. This lets us *verify by geometry* which interpretation is right
  // rather than guessing from byte layout alone.
  const diag = Math.hypot(bbox.sx, bbox.sy, bbox.sz) || 1;
  const longFrac = (positions, indices) => {
    let edges = 0, long = 0;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = indices[i + e] * 3, c = indices[i + (e + 1) % 3] * 3;
        if (a + 2 >= positions.length || c + 2 >= positions.length) return 1;
        const d = Math.hypot(positions[a] - positions[c], positions[a + 1] - positions[c + 1], positions[a + 2] - positions[c + 2]);
        // A single edge spanning several times the model, or a non-finite one
        // (garbage/NaN vertex), means this interpretation is broken outright.
        if (!(d < 3 * diag)) return 1;
        edges++; if (d > 0.5 * diag) long++;
      }
    }
    return edges ? long / edges : 1;
  };

  const meshes = [];
  const usedPos = new Set();
  for (const pos of posArrays) {
    if (usedPos.has(pos.offset)) continue;
    const N1 = pos.count;
    const posArr = pos.positions;

    // Two mesh encodings appear in the data; we build candidates for both and
    // keep whichever yields the cleanest topology:
    //
    //   DIRECT  positions + triangle-list indices (values < N1) — no remap.
    //   SPLIT   positions + remap (u16 < N1) + indices (u16 < remap.length).
    //           The engine's "vertex split": renderVertex[i] = positions[remap[i]].
    //
    // A candidate is {positions, indices, N2, score}. Lower score = cleaner.
    let best = null;
    const consider = (positions, indices, N2) => {
      if (!indices.length) return;
      const score = longFrac(positions, indices);
      if (!best || score < best.score) best = { positions, indices, N2, score };
    };

    for (const r of leaves) {
      if (!r.leaf || r.body <= pos.offset) continue;
      if (r.byteLen % 6 !== 0 || r.byteLen < 6) continue; // triangle list = 3 u16 per tri
      const arr = readU16Leaf(r);

      // DIRECT: this index list references the positions directly.
      if (u16Max(arr) < N1) consider(posArr, Uint32Array.from(arr), N1);
    }

    // SPLIT: for each plausible remap (u16 leaf, all < N1, at least N1 long),
    // expand positions and test each following triangle list (values < N2).
    for (const remapLeaf of leaves) {
      if (!remapLeaf.leaf || remapLeaf.body <= pos.offset) continue;
      if (remapLeaf.byteLen % 2 !== 0 || remapLeaf.byteLen < 2 * N1) continue;
      const remap = readU16Leaf(remapLeaf);
      if (u16Max(remap) >= N1) continue;
      const N2 = remap.length;
      const sp = new Float32Array(N2 * 3);
      for (let i = 0; i < N2; i++) {
        const s = remap[i] * 3; sp[i * 3] = posArr[s]; sp[i * 3 + 1] = posArr[s + 1]; sp[i * 3 + 2] = posArr[s + 2];
      }
      for (const r of leaves) {
        if (!r.leaf || r.body <= remapLeaf.body) continue;
        if (r.byteLen % 6 !== 0 || r.byteLen < 6) continue;
        const arr = readU16Leaf(r);
        if (u16Max(arr) < N2) consider(sp, Uint32Array.from(arr), N2);
      }
    }

    if (!best) continue;
    // Quality gate: if even the best interpretation is still shattered (a large
    // fraction of edges span the whole model), we haven't decoded this encoding
    // correctly — some models use interleaved vertex buffers we don't parse yet.
    // Skip it rather than draw an explosion of triangles; the object simply
    // renders as "no model", like other unresolved assets.
    if (best.score > SHATTER_THRESHOLD) continue;
    const { positions, indices, N2 } = best;

    // UVs: a per-render-vertex attribute stream of N2 × stride bytes (stride
    // 16..32). Its first int16 pair per vertex is the texcoord in fixed point
    // ÷2048 (V spans [0,1]; U tiles). Verified by UV edge-continuity.
    let uvs = null;
    const attrLeaf = leaves.find((r) => r.leaf && N2 > 0 && r.byteLen % N2 === 0 &&
      r.byteLen / N2 >= 16 && r.byteLen / N2 <= 32 && r.body > pos.offset);
    if (attrLeaf) {
      const stride = attrLeaf.byteLen / N2;
      uvs = new Float32Array(N2 * 2);
      for (let i = 0; i < N2; i++) {
        uvs[i * 2] = b.readInt16LE(attrLeaf.body + i * stride) / 2048;
        uvs[i * 2 + 1] = b.readInt16LE(attrLeaf.body + i * stride + 2) / 2048;
      }
    }

    // Normals computed from geometry (packed stored normals are imprecise).
    const normals = computeNormals(positions, indices);
    meshes.push({ positions, normals, uvs, indices, vertexCount: N2, triCount: indices.length / 3 });
    usedPos.add(pos.offset);
  }

  // The file usually stores the payload twice (LOD/copy) — drop exact duplicates.
  const seen = new Set();
  return meshes.filter((m) => {
    const sig = `${m.vertexCount}:${m.triCount}:${m.positions[0]},${m.positions[1]},${m.positions[2]}`;
    if (seen.has(sig)) return false;
    seen.add(sig); return true;
  });
}

/** Compute smooth per-vertex normals by accumulating face normals. */
function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b2 = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b2] - positions[a], uy = positions[b2 + 1] - positions[a + 1], uz = positions[b2 + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b2, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/**
 * Parse a `Model.(Model).xdb` string enough to resolve the geometry binary and
 * its bounding box. Returns null if the fields aren't present.
 * @param {string} xml
 * @returns {{uid:string, bbox:BBox}|null}
 */
export function readGeometryRefFromModelXdb(xml) {
  const geom = xml.match(/<Geometry\b[\s\S]*?<uid>([0-9A-Fa-f-]{36})<\/uid>[\s\S]*?<\/Geometry>/);
  if (!geom) return null;
  const uid = geom[1].toUpperCase();
  const num = (tag, src) => {
    const m = src.match(new RegExp(`<${tag}>\\s*<x>([-\\d.]+)</x>\\s*<y>([-\\d.]+)</y>\\s*<z>([-\\d.]+)</z>`));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const size = num('Size', geom[0]);
  const center = num('Center', geom[0]);
  if (!size || !center) return null;
  return { uid, bbox: { cx: center[0], cy: center[1], cz: center[2], sx: size[0], sy: size[1], sz: size[2] } };
}
