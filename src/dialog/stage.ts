// A scene's stage, as something the renderer can draw.
//
// The stage map is an ordinary map and needs no help — but it is usually BARE.
// C1M1's opening stands on an empty field of grass; all 659 things in shot are
// listed by the scene itself, one sibling file each, and the actors are two
// more. So drawing a scene is drawing its stage map with the scene's own
// objects placed on top, which is one option on the scene builder rather than a
// second scene builder.
//
// Objects are addressed the same two ways a sentence addresses an actor: inline
// in the scene, or by an href at a file beside it. Both appear in the shipped
// scenes, so both resolve here.

import { children, find, parse } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';
import { MapObject, OBJECT_TYPES } from '../map/map.ts';
import type { Assets } from '../game/assets.ts';
import { dirOf, resolveHref } from '../scene/xdb.ts';
import type { DialogScene } from './dialog-scene.ts';

/** What an object on the stage is there for. */
export type StageRole = 'prop' | 'actor';

export interface StageObject {
  object: MapObject;
  role: StageRole;
  /** Where it came from, for the inspector and for error messages. */
  href: string;
}

const KNOWN = new Set(OBJECT_TYPES);

/** A stand-in `<Item>` wrapper for an object that lives in its own file. */
function itemFor(href: string): XmlElement {
  return { type: 'element', name: 'Item', rawAttrs: ` href="${href}"`, attrs: { href }, children: [], selfClose: true };
}

/**
 * Resolve one href to the object body it names.
 *
 * `#n:inline(Type)` means the body is written inside the element that points at
 * it; anything else is a path, relative to the file that wrote it unless it
 * starts from the data root.
 */
function bodyOf(data: Assets, from: XmlElement, href: string, baseDir: string): XmlElement | null {
  if (href.startsWith('#n:inline')) return children(from)[0] ?? null;
  if (!href || href.startsWith('#')) return null;
  const text = data.text(resolveHref(baseDir, href));
  if (!text) return null;
  const doc = parse(text);
  const body = children(doc).find((el) => KNOWN.has(el.name));
  return body ?? null;
}

/**
 * Every object a scene puts on its stage: the set dressing it lists, then the
 * actors its lines speak through.
 *
 * An actor named by several lines is placed ONCE — the same hero speaks
 * fourteen times in a row and is one figure on the field, not fourteen.
 */
export function stageObjects(data: Assets, scenePath: string, scene: DialogScene): StageObject[] {
  const dir = dirOf(scenePath);
  const out: StageObject[] = [];
  const seen = new Set<string>();

  const objects = find(scene.root, 'objects');
  for (const item of objects ? children(objects) : []) {
    const href = item.attrs.href ?? '';
    const body = bodyOf(data, item, href, dir);
    if (body) out.push({ object: new MapObject(item, body), role: 'prop', href });
  }

  for (const shot of scene.shots) {
    for (const link of [shot.heroLink, shot.monsterLink]) {
      if (!link || seen.has(link)) continue;
      seen.add(link);
      // An inline actor is written inside the sentence's link element, so find
      // that element in the tree rather than re-parsing the text.
      const el = linkElement(scene, link);
      const body = el && bodyOf(data, el, link, dir);
      if (body) out.push({ object: new MapObject(el ?? itemFor(link), body), role: 'actor', href: link });
    }
  }
  return out;
}

/** The `<heroLink>`/`<monsterLink>` element carrying a given href. */
function linkElement(scene: DialogScene, href: string): XmlElement | null {
  const sentences = find(scene.root, 'sentences');
  for (const item of sentences ? children(sentences) : []) {
    for (const name of ['heroLink', 'monsterLink']) {
      const el = find(item, name);
      if (el && el.attrs.href === href) return el;
    }
  }
  return null;
}
