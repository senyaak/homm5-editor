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
import { actorRef } from './dialog-scene.ts';
import type { DialogScene } from './dialog-scene.ts';

/** What an object on the stage is there for. */
export type StageRole = 'prop' | 'actor';

export interface StageObject {
  object: MapObject;
  role: StageRole;
  /** Where it came from, for the inspector and for error messages. */
  href: string;
  /**
   * The `id` on the element that declares it, when it has one.
   *
   * An inline actor's href is the same four words for everybody —
   * `#n:inline(AdvMapHero)` — so it cannot be the key. The animations in a shot
   * address such an actor as `#xpointer(id(item_48F7…)/AdvMapHero)`, and this
   * is that id: without it every cue aimed at an inline actor lands on nobody
   * and the scene plays with everyone standing still.
   */
  id: string | null;
  /** The one name everything joins on — see `actorRef`. */
  key: string;
}

const KNOWN = new Set(OBJECT_TYPES);

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
 * actors it moves.
 *
 * An actor named by several lines is placed ONCE — the same hero speaks
 * fourteen times in a row and is one figure on the field, not fourteen.
 *
 * A link element does not only POINT at an actor, it can BE the declaration:
 * `href="#n:inline(AdvMapMonster)"` with an `id` and the whole body inside it.
 * That is how 1814 of the shipped scenes' actors are written — and not only in
 * a sentence: 1517 of those are inside a `CustomAnimation`, which declares its
 * the same way, which is most of the cast in a scene like A2C3/M4/S1 (79 of its
 * walks are people nothing else in the file mentions). Read only from
 * `<objects>` and the sentences, as this did, and those figures are not on the
 * field at all: nobody to walk, nobody to fall.
 */
export function stageObjects(data: Assets, scenePath: string, scene: DialogScene): StageObject[] {
  const dir = dirOf(scenePath);
  const out: StageObject[] = [];
  // Only a PATH identifies a figure. `#n:inline(AdvMapStatic)` is what 130 of
  // C1M1's props are written as, and it says nothing about which one this is —
  // so an inline object is never looked up here, only ever added.
  const byPath = new Map<string, StageObject>();
  const placed = new Set<string>();

  const objects = find(scene.root, 'objects');
  for (const item of objects ? children(objects) : []) {
    const href = item.attrs.href ?? '';
    const body = bodyOf(data, item, href, dir);
    if (!body) continue;
    const at: StageObject = {
      object: new MapObject(item, body), role: 'prop', href,
      id: item.attrs.id ?? null, key: actorRef(item),
    };
    out.push(at);
    if (href && !href.startsWith('#')) byPath.set(href, at);
  }

  for (const el of linkElements(scene)) {
    const href = el.attrs.href ?? '';
    const key = actorRef(el);
    if (!href || placed.has(key)) continue;
    placed.add(key);
    // A speaker is USUALLY also in `<objects>` — all seven of C1M1's are. That
    // is one figure listed twice, not two, so the entry already made is
    // promoted rather than a second one added: placed twice, an actor stands
    // inside their own still adventure copy, and the scene plays with two
    // heroes in every close-up (the second one never blinking).
    const known = byPath.get(href);
    if (known) { known.role = 'actor'; known.key = key; continue; }
    // `#xpointer(id(…))` is a MENTION of a declaration made somewhere else in
    // the file; the declaration itself carries the body and is reached in its
    // own turn, so a mention places nothing.
    const body = bodyOf(data, el, href, dir);
    if (!body) continue;
    out.push({
      object: new MapObject(el, body), role: 'actor', href, id: el.attrs.id ?? null, key,
    });
  }
  return out;
}

/** Every `<heroLink>`/`<monsterLink>` in the scene, in document order. */
function linkElements(scene: DialogScene): XmlElement[] {
  const out: XmlElement[] = [];
  const both = (el: XmlElement): void => {
    for (const name of ['heroLink', 'monsterLink']) {
      const at = find(el, name);
      if (at) out.push(at);
    }
  };
  const sentences = find(scene.root, 'sentences');
  for (const item of sentences ? children(sentences) : []) {
    both(item);
    const anims = find(item, 'CustomAnimations');
    for (const a of anims ? children(anims) : []) both(a);
  }
  return out;
}
