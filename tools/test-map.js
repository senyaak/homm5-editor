// Tests for the XML DOM and the map model. Run: npm run test-map
//
// Covers:
//   1. XML byte-identical round-trip over every sample map.
//   2. Map model round-trip (loadMap -> save) over every sample map.
//   3. Object enumeration: types, positions, count.
//   4. Edit locality: moving one object changes only that object's bytes.
//   5. Remove: dropping an object removes exactly its <Item>.

import { parse, serialize, childText } from '../src/xml.ts';
import { loadMap } from '../src/map.ts';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const mapFiles = execSync('find data-unpacked/Maps -name map.xdb', { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
ok(mapFiles.length > 0, `found ${mapFiles.length} sample maps`);

// --- 1 & 2. Round-trip (XML and model) over all maps ---
let xmlRT = 0, modelRT = 0, parsedMaps = 0, totalObjects = 0;
for (const f of mapFiles) {
  const orig = readFileSync(f, 'latin1');
  if (serialize(parse(orig)) === orig) xmlRT++;
  try {
    const m = loadMap(orig);
    parsedMaps++;
    totalObjects += m.objects.length;
    if (m.save() === orig) modelRT++;
  } catch { /* not a map */ }
}
ok(xmlRT === mapFiles.length, `XML round-trip byte-identical: ${xmlRT}/${mapFiles.length}`);
ok(modelRT === parsedMaps, `map model round-trip byte-identical: ${modelRT}/${parsedMaps}`);
console.log(`     (${totalObjects} objects parsed across ${parsedMaps} maps)`);

// --- 3, 4, 5. Detailed checks on one rich map ---
const rich = mapFiles.find((f) => readFileSync(f, 'latin1').includes('AdvMapTown'));
if (rich) {
  const m = loadMap(readFileSync(rich, 'latin1'));
  ok(m.tileX > 0 && m.tileY > 0, `header dims parsed (${m.tileX}x${m.tileY})`);
  ok(m.objects.length > 0, `objects enumerated (${m.objects.length})`);

  const town = m.objectsOfType('AdvMapTown')[0];
  ok(town && town.pos && Number.isFinite(town.pos.x), 'town position parsed');
  ok(town.shared && town.shared.includes('Shared'), 'town shared href parsed');

  // Edit locality: move the town by +1 x, expect exactly one <x> value to differ.
  const before = m.save();
  town.setPos(town.pos.x + 1, town.pos.y);
  const after = m.save();
  ok(before !== after, 'edit changes output');
  const diffs = countLineDiffs(before, after);
  ok(diffs === 1, `edit is local: exactly 1 line changed (got ${diffs})`);

  // Remove locality: removing an object drops exactly its subtree.
  const m2 = loadMap(readFileSync(rich, 'latin1'));
  const n0 = m2.objects.length;
  const victim = m2.objects[10];
  const removedBody = serialize(victim.item);
  m2.remove(victim);
  ok(m2.objects.length === n0 - 1, `remove drops one object (${n0} -> ${m2.objects.length})`);
  ok(!m2.save().includes(removedBody), 'removed object no longer present in output');

  // --- properties (the panel's data source) ---
  const m3 = loadMap(readFileSync(rich, 'latin1'));
  const mon = m3.objects.find((o) => o.type === 'AdvMapMonster');
  if (mon) {
    const props = mon.props();
    const byName = new Map(props.map((p) => [p.name, p]));
    ok(props.length > 0, `monster exposes properties (${props.length})`);
    ok(!byName.has('Pos') && !byName.has('Rot') && !byName.has('Floor'),
      'position and rotation stay out of the generic list');
    // Structures must never be offered as text: writing into <pointLights/>
    // would turn a list into a string.
    for (const c of ['pointLights', 'Resources', 'AdditionalStacks']) {
      ok(!byName.has(c), `${c} is not offered as a value`);
    }
    ok(byName.get('Amount')?.kind === 'number', 'Amount reads as a number');
    ok(byName.get('Mood')?.kind === 'enum', 'Mood reads as an enum');
    ok(byName.get('Shared')?.kind === 'href', 'Shared reads as a reference');
    ok(byName.get('DoesNotGrow')?.kind === 'bool', 'DoesNotGrow reads as a bool');

    ok(mon.setProp('Amount', '7') === true, 'a simple field can be set');
    ok(mon.setProp('Pos', '1') === false, 'position is refused');
    ok(mon.setProp('Shared', 'x') === false, 'a reference is refused');
    ok(mon.setProp('pointLights', 'x') === false, 'a structure is refused');
    ok(mon.setProp('NoSuchField', 'x') === false, 'an unknown field is refused');
    const d = countLineDiffs(readFileSync(rich, 'latin1'), m3.save());
    ok(d === 1, `setting one property changes exactly 1 line (got ${d})`);
  }

  // --- placing new objects ---
  const m4 = loadMap(readFileSync(rich, 'latin1'));
  const n4 = m4.objects.length;
  const SH = '/MapObjects/Grass/Tree/Spruce_01.(AdvMapStaticShared).xdb#xpointer(/AdvMapStaticShared)';
  const added = m4.addObject({ type: 'AdvMapStatic', shared: SH, x: 11, y: 22, floor: 0 });
  ok(m4.objects.length === n4 + 1, `placing adds one object (${n4} -> ${m4.objects.length})`);
  ok(added.complete, 'a type the map already has is cloned, so it is complete');
  ok(/^item_[0-9A-F-]{36}$/.test(added.object.id), `id looks like the map's own (${added.object.id})`);
  ok(added.object.shared === SH, 'the shared reference is the one asked for');
  const p4 = added.object.pos;
  ok(p4.x === 11 && p4.y === 22, 'it lands where it was put');
  // Cloning must not copy the donor's identity or script name. The name is not
  // merely cleared, though: an object with no handle cannot be addressed from
  // Lua at all, so it gets a generated one — see HommMap.nextName.
  const donor = m4.objects.find((o) => o.type === 'AdvMapStatic' && o.id !== added.object.id);
  ok(donor && donor.id !== added.object.id, 'the clone gets its own id');
  const cloneName = childText(added.object.el, 'Name');
  ok(cloneName !== '' && cloneName !== childText(donor.el, 'Name'),
     `the clone gets a handle of its own, not the donor's (${cloneName})`);
  ok(/^STATIC_\d{3}$/.test(cloneName), `and it is numbered per type (${cloneName})`);

  // A type this map has none of falls back to the skeleton, and says so.
  const sk = m4.addObject({ type: 'AdvMapSphinx', shared: '/x.xdb#xpointer(/AdvMapSphinxShared)', x: 1, y: 2 });
  ok(!sk.complete, 'with no donor the caller is told the object is skeleton-only');

  // The point of all of it: what we wrote has to be readable again.
  const saved = m4.save();
  const m5 = loadMap(saved);
  ok(m5.objects.length === m4.objects.length, 'every placed object survives a save');
  ok(m5.objects.some((o) => o.id === added.object.id), 'the placed object is found after reload');
  ok(m5.save() === saved, 'a map with new objects round-trips');
  ok(new Set(m5.objects.map((o) => o.id)).size === m5.objects.length, 'ids stay unique');
  // Empty fields are written self-closed, the way the maps do it.
  ok(saved.includes('<Name/>'), 'empty fields are written as <Name/>, not <Name></Name>');
}

function countLineDiffs(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  let d = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) d++;
  return d;
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall map/xml tests passed');
process.exit(failures ? 1 : 0);
