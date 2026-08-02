// The dialog-scene document — a cutscene as the game stores it.
//
// A scene is a STAGE plus a list of SHOTS. The stage is an ordinary map
// (`/Maps/SmallSpecialArenas/…`) used as scenery, so the renderer already draws
// it; the shots are `<sentences>`, one per line of dialogue, each naming who
// speaks, which camera pair frames it, how long it lasts and what else happens
// while it runs (other actors' animations, effects, sounds, a music override).
//
// Two layers on purpose, the same split the campaign document uses:
//
//   * the XML tree is the document — edits go through it, and saving is
//     byte-identical for everything nobody touched (src/format/xml.ts);
//   * the typed view below is READ-ONLY, derived for the player and the
//     inspector. It holds hrefs as written, not resolved documents, because
//     resolving needs the mounted asset chain and this file must stay usable
//     without one (tests, tools, the packer).
//
// Field names and their order come from the game's own type declaration
// (`DialogScene`, `DialogSentence` in types.xml — see docs/TYPE_SPEC.md), not
// from reading a few files and guessing.

import { childText, children, find, parse, serialize } from '../format/xml.ts';
import type { XmlElement } from '../format/xml.ts';

/** A point in a scene — tiles for actors, world units for cameras and effects. */
export interface Point3 { x: number; y: number; z: number }

/** One entry of an actor's walk: a tile the game routes them through. */
export interface Point2 { x: number; y: number }

/** A sound played inside a shot, offset from the shot's start. */
export interface ShotSound {
  delay: number;
  sound: string;
  duration: number;
}

/** An effect fired inside a shot — at a place, not on an actor. */
export interface ShotEffect {
  delay: number;
  effect: string;
  pos: Point3;
  rot: number;
  movementSpeed: number;
  movePoints: Point3[];
  constantPitch: boolean;
}

/**
 * An animation played inside a shot by anyone on stage.
 *
 * This is what makes a scene move: the shot's own `animName` belongs to the
 * speaker, and every OTHER actor doing something — walking in, turning, dying —
 * is one of these, addressed by the same link the sentence uses. A walk is
 * `move` plus `movePoints`; `finalAngle` is where they end up facing.
 */
export interface ShotAnimation {
  /** Who — an href at the actor, inline (`#xpointer(id(item_…)…)`) or a file. */
  heroLink: string;
  monsterLink: string;
  /** Who, as the one key everything joins on. See `actorRef`. */
  actor: string;
  /** Position in the actor's AnimSet, or -1 for none. `animName` wins. */
  animationIndex: number;
  animationDelay: number;
  animName: string;
  movePoints: Point2[];
  finalAngle: number;
  movementSpeed: number;
}

/** Music swapped in for the duration of a shot. */
export interface ShotMusic {
  music: string;
  startTime: number;
  timeShift: number;
}

/** A camera set that starts partway into the shot, on top of the main one. */
export interface ShotCamera {
  cameraSet: string;
  startDelay: number;
}

/** One line of dialogue and everything that happens while it is spoken. */
export interface Shot {
  /** Position in the scene, 0-based — how the player and the UI address it. */
  index: number;
  /** The spoken line, in a sibling .txt (UTF-16LE, tagged per language). */
  text: string;
  sound: string;
  /** The speaker. Inline in the scene, or in a file beside it — both are used. */
  heroLink: string;
  monsterLink: string;
  /** The speaker, as the one key everything joins on. See `actorRef`. */
  actor: string;
  monsterCustomName: string;
  /** The pre-ToE camera field. Still filled in 171 shots; NewCameraSet wins. */
  cameraSet: string;
  newCameraSet: string;
  stopAmbient: boolean;
  stopMusic: boolean;
  dynamicCamera: boolean;
  /** Seconds. What the shot lasts when the sound does not decide it. */
  duration: number;
  soundDuration: number;
  customAmbientLight: string;
  /** The speaker's own clip, by index into the actor's set, or -1 for none. */
  actorAnimationIndex: number;
  animName: string;
  animationDelay: number;
  sounds: ShotSound[];
  effects: ShotEffect[];
  animations: ShotAnimation[];
  musicVolumePercent: number;
  musicFadeOutDuration: number;
  music: ShotMusic | null;
  additionalCameras: ShotCamera[];
  anim3DSoundVolume: number;
}

/** A scene, read. `root` is the tree edits go through; the rest is derived. */
export interface DialogScene {
  /**
   * The whole parsed file, prolog and all. Saving serializes THIS rather than
   * rebuilding a header around the root element: the scenes are CRLF files and
   * re-emitting what was read is the only way that stays byte-exact without the
   * writer having to know it.
   */
  document: XmlElement;
  root: XmlElement;
  /** The map used as scenery — an ordinary AdvMapDesc reference. */
  stage: string;
  soundSet: string;
  music: string;
  musicVolume: number;
  ambientLight: string;
  shots: Shot[];
  /** The set dressing the scene brings of its own, as hrefs into its folder. */
  props: string[];
  cameraShiftZ: number;
  anim3DSoundVolume: number;
  name: string;
}

const href = (el: XmlElement | null, name: string): string => find(el ?? ({} as XmlElement), name)?.attrs.href ?? '';

/**
 * Who a link points at, as ONE string everything downstream can join on.
 *
 * A scene names an actor three ways and all three are in heavy use: an href at a
 * file beside it (1443 links), an element id (`#xpointer(id(item_…)/AdvMapHero)`,
 * 4621), and the whole actor written INSIDE the link element (`#n:inline(…)`
 * plus an `id`, 1814 — of which 1517 are inside a `CustomAnimation`).
 *
 * The href alone cannot be the key: `#n:inline(AdvMapMonster)` is the same four
 * words for every inline actor in the file, so joining on it puts a whole
 * scene's cast onto whichever one was read first. The element id is what tells
 * them apart, and an `#xpointer` reference is a mention of exactly that id — so
 * both fold onto the id, and only a path stands for itself.
 */
export function actorRef(el: XmlElement | null): string {
  const link = el?.attrs.href ?? '';
  if (el?.attrs.id) return `#${el.attrs.id}`;
  const id = /#xpointer\(id\(([^)]+)\)/.exec(link)?.[1];
  return id ? `#${id}` : link;
}

/** `actorRef` for whichever of a pair of links is filled in. */
function refOf(el: XmlElement, ...names: string[]): string {
  for (const name of names) {
    const at = find(el, name);
    if (at?.attrs.href) return actorRef(at);
  }
  return '';
}
const num = (el: XmlElement, name: string): number => Number(childText(el, name)) || 0;
const bool = (el: XmlElement, name: string): boolean => childText(el, name).trim() === 'true';

/** Items of a list field, or none when the field is empty or absent. */
function items(el: XmlElement, name: string): XmlElement[] {
  const list = find(el, name);
  return list ? children(list) : [];
}

function point3(el: XmlElement | null): Point3 {
  return el ? { x: num(el, 'x'), y: num(el, 'y'), z: num(el, 'z') } : { x: 0, y: 0, z: 0 };
}

function point2(el: XmlElement): Point2 {
  return { x: num(el, 'x'), y: num(el, 'y') };
}

function readShot(item: XmlElement, index: number): Shot {
  const music = find(item, 'MusicOverride');
  return {
    index,
    text: href(item, 'text'),
    sound: href(item, 'sound'),
    heroLink: href(item, 'heroLink'),
    monsterLink: href(item, 'monsterLink'),
    actor: refOf(item, 'heroLink', 'monsterLink'),
    monsterCustomName: href(item, 'MonsterCustomName'),
    cameraSet: href(item, 'cameraSet'),
    newCameraSet: href(item, 'NewCameraSet'),
    stopAmbient: bool(item, 'StopAmbient'),
    stopMusic: bool(item, 'StopMusic'),
    dynamicCamera: bool(item, 'DynamicCamera'),
    duration: num(item, 'duration'),
    soundDuration: num(item, 'soundDuration'),
    customAmbientLight: href(item, 'CustomAmbientLight'),
    actorAnimationIndex: Number(childText(item, 'ActorAnimationIndex') || -1),
    animName: childText(item, 'AnimName'),
    animationDelay: num(item, 'AnimationDelay'),
    sounds: items(item, 'CustomSounds').map((s) => ({
      delay: num(s, 'Delay'),
      sound: href(s, 'sound'),
      duration: num(s, 'Duration'),
    })),
    effects: items(item, 'CustomEffects').map((e) => ({
      delay: num(e, 'Delay'),
      effect: href(e, 'Effect'),
      pos: point3(find(e, 'Pos')),
      rot: num(e, 'Rot'),
      movementSpeed: num(e, 'MovementSpeed'),
      movePoints: items(e, 'MovePoints').map((p) => point3(p)),
      constantPitch: bool(e, 'ConstantPitch'),
    })),
    animations: items(item, 'CustomAnimations').map((a) => ({
      heroLink: href(a, 'heroLink'),
      monsterLink: href(a, 'monsterLink'),
      actor: refOf(a, 'heroLink', 'monsterLink'),
      // -1 when unwritten, as the shot's own index is: 0 is a real position in
      // the actor's set, so a missing field must not read as "play the first".
      animationIndex: Number(childText(a, 'AnimationIndex') || -1),
      animationDelay: num(a, 'AnimationDelay'),
      animName: childText(a, 'AnimName'),
      movePoints: items(a, 'MovePoints').map(point2),
      finalAngle: num(a, 'FinalAngle'),
      movementSpeed: num(a, 'MovementSpeed'),
    })),
    musicVolumePercent: num(item, 'MusicVolumePercent'),
    musicFadeOutDuration: num(item, 'MusicFadeOutDuration'),
    music: music && href(music, 'Music')
      ? { music: href(music, 'Music'), startTime: num(music, 'StartTime'), timeShift: num(music, 'TimeShift') }
      : null,
    additionalCameras: items(item, 'AdditionalCameras').map((c) => ({
      cameraSet: href(c, 'NewCameraSet'),
      startDelay: num(c, 'StartDelay'),
    })),
    anim3DSoundVolume: num(item, 'Anim3DSoundVolumeCustom'),
  };
}

/** Parse a DialogScene document. Throws when the text is not one. */
export function loadDialogScene(xmlText: string): DialogScene {
  const doc = parse(xmlText);
  const root = doc.name === 'DialogScene' ? doc : find(doc, 'DialogScene');
  if (!root) throw new Error('not a DialogScene document (no <DialogScene> root)');
  return {
    document: doc,
    root,
    stage: href(root, 'Map'),
    soundSet: href(root, 'SoundSet'),
    music: href(root, 'Music'),
    musicVolume: num(root, 'MusicVolume'),
    ambientLight: href(root, 'CustomSceneAmbientLight'),
    shots: items(root, 'sentences').map(readShot),
    props: items(root, 'objects').map((o) => o.attrs.href ?? ''),
    cameraShiftZ: num(root, 'CameraShiftZ'),
    anim3DSoundVolume: num(root, 'Anim3DSoundVolume'),
    name: childText(root, 'Name'),
  };
}

/**
 * Serialize a scene back to an .xdb document.
 *
 * Whatever the tree still holds verbatim comes out verbatim — including the
 * `href=""` a scene writes for an unset reference. That is the opposite of the
 * campaign rule (where an empty href stopped a hero being handed on), and it is
 * what the shipped scenes do: 164 of their monster links are written that way.
 */
export function saveDialogScene(scene: DialogScene): string {
  return serialize(scene.document);
}
