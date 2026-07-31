// The shipped buildings, as things to start from.
//
// A creature's form is filled by picking a DONOR and editing the difference
// (src/schema/registry.ts, creaturePreset); a building works the same way, and
// for the same reason: nobody wants to type six art paths and four sentences to
// get a windmill that looks like a windmill.
//
// What a preset gives back is already OURS in shape — the texts come out as
// text, not as references to the game's files — so filling a form from a donor
// and saving it produces a self-contained building with nothing borrowed but
// the idea.

import { readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { children, find, parse, text as textOf } from '../format/xml.ts';
import type { Assets } from '../game/assets.ts';
import { BUILDING_CLASSES, buildingClass, extraFields, messageSlots, refPath } from './buildings.ts';
import type { SpecType } from '../schema/typespec.ts';

const CLASS_NAMES = new Set(BUILDING_CLASSES.map((c) => c.shared));

/** Where the game keeps its object definitions. */
const OBJECT_DIRS = ['MapObjects'];

/** One shipped definition, as a list offers it. */
export interface BuildingDonor {
  /** Its data path, which is what a preset is asked for. */
  path: string;
  /** Which of the sixteen it is. */
  className: string;
  /** The behaviour it declares, for the classes that declare one. */
  type?: string;
  /** What the game calls it — its first message, when it has one. */
  name?: string;
}

/** Everything a form needs to become a building of ours. */
export interface BuildingPreset {
  className: string;
  type?: string;
  model: string;
  animSet?: string;
  effect?: string;
  effectWhenOwned?: string;
  sound?: string;
  icon?: string;
  /** Its lines, by slot — as TEXT, ready to be edited and shipped as ours. */
  messages: Record<string, string>;
  /** The class's own fields, as the donor filled them. */
  fields: Record<string, string | string[]>;
}

/** A HoMM5 text file's contents — UTF-16 LE with a byte-order mark. */
export function gameText(data: Assets, href: string): string {
  const b = data.bytes(refPath(href));
  if (!b || !b.length) return '';
  const s = b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le', 2) : b.toString('utf8');
  return s.replace(/\0+$/, '').trim();
}

/** The document's root element, whatever the file is called. */
function rootOf(xml: string): { name: string; el: ReturnType<typeof parse> } | null {
  let doc;
  try { doc = parse(xml); } catch { return null; }
  const el = children(doc)[0];
  return el ? { name: el.name, el } : null;
}

/**
 * Every shipped definition of one of the sixteen classes.
 *
 * Scanned by ROOT ELEMENT and not by file name: the addon ships
 * `MapObjects/H5A2/SpellShop.xdb` whose root is `<AdvMapBuildingShared>`, and
 * eight of its objects are invisible to anything matching on the name.
 */
export function listBuildingDonors(data: Assets): BuildingDonor[] {
  const out: BuildingDonor[] = [];
  const seen = new Set<string>();
  for (const dir of OBJECT_DIRS) {
    for (const root of data.dirs(dir)) {
      for (const file of walk(root)) {
        if (!file.toLowerCase().endsWith('.xdb')) continue;
        const rel = posix.join(dir, relative(root, file).split(sep).join('/'));
        if (seen.has(rel.toLowerCase())) continue;
        seen.add(rel.toLowerCase());
        const xml = data.text(rel);
        if (!xml) continue;
        const found = rootOf(xml);
        if (!found || !CLASS_NAMES.has(found.name)) continue;
        const type = textOf(find(found.el, 'Type')) || undefined;
        const first = find(found.el, 'messagesFileRef');
        const nameRef = first ? children(first)[0]?.attrs.href : undefined;
        out.push({
          path: rel, className: found.name,
          ...(type ? { type } : {}),
          ...(nameRef ? { name: gameText(data, nameRef) || undefined } : {}),
        });
      }
    }
  }
  return out.sort((a, b) => (a.name ?? a.path).localeCompare(b.name ?? b.path));
}

/** Files under `dir`, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Read one shipped definition into the shape a form edits.
 *
 * Art comes back as the game's own paths, which is what the build copies FROM;
 * the messages come back as text, because a building of ours ships its own
 * strings rather than pointing at the install's.
 */
export function buildingPreset(data: Assets, path: string, types: Map<string, SpecType>): BuildingPreset | null {
  const xml = data.text(refPath(path));
  if (!xml) return null;
  const found = rootOf(xml);
  if (!found || !buildingClass(found.name)) return null;
  const el = found.el;

  const href = (field: string): string | undefined => find(el, field)?.attrs.href || undefined;
  const model = href('Model');
  if (!model) return null;

  const messages: Record<string, string> = {};
  const slots = messageSlots(found.name);
  const refs = find(el, 'messagesFileRef');
  children(refs ?? el).forEach((item, i) => {
    const slot = slots[i];
    if (!slot || !item.attrs.href) return;
    messages[slot] = gameText(data, item.attrs.href);
  });

  // The class's own fields, as the donor has them. A list comes back as a list,
  // everything else as text — the same two shapes buildingDoc writes.
  const fields: Record<string, string | string[]> = {};
  for (const name of extraFields(types, found.name)) {
    if (name === 'Type') continue;
    const field = find(el, name);
    if (!field) continue;
    const items = children(field);
    if (items.length) fields[name] = items.map((it) => textOf(it) || it.attrs.href || '').filter(Boolean);
    else if (textOf(field)) fields[name] = textOf(field);
  }

  const type = textOf(find(el, 'Type')) || undefined;
  return {
    className: found.name,
    ...(type ? { type } : {}),
    model,
    ...(href('AnimSet') ? { animSet: href('AnimSet') } : {}),
    ...(href('Effect') ? { effect: href('Effect') } : {}),
    ...(href('EffectWhenOwned') ? { effectWhenOwned: href('EffectWhenOwned') } : {}),
    ...(href('SoundEffect') ? { sound: href('SoundEffect') } : {}),
    ...(href('Icon128') ? { icon: href('Icon128') } : {}),
    messages,
    fields,
  };
}
