// The archive behind `stack-health-bar` — a health bar on a battle stack's plate.
//
// WHY AN ARCHIVE AT ALL. The plate over a creature is data — `ID_STACKINFO_WINDOW`
// in UI/UIGameRoot.(UIGameRoot).xdb, a button whose shared description lists its
// children. So a bar is a CHILD WINDOW, declared here, and the extension does
// nothing but set its width every frame. Nothing is drawn over the frame and no
// code of the game's is touched to make it appear.
//
// WHY ITS OWN ARCHIVE, beside `homm5-editor.h5u`. That one is global because
// creatures and artifacts extend reference tables declared in types.xml and the
// executable counts what one copy holds. This overrides two interface files and
// touches neither, so it has no reason to ride along with a rebuild of twenty-six
// megabytes of content — and a player who wants the bar and none of the rest
// should be able to have exactly that.
//
// AND WHY IT FOLLOWS THE FLAG. The strips are visible the moment the archive is
// mounted — the engine draws them at their declared size with no extension in
// sight, which is how they showed up on the deployment screen before any width
// was ever set. So applying the settings WRITES the archive when the flag is on
// and REMOVES it when it is off; a config line alone must not leave a bar on
// the screen of somebody who turned it off.
//
// THE THREE LAYERS the bar is made of are two windows, not three: the plate's own
// backgrounds are NINE-SLICE tiled textures, so each strip draws its own border.
// The track is the dark one at full width, the fill is the green one clipped to
// what the creature at the front has left, and the frame comes free with both.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readEntries, writeArchive } from '#src/format/pak.ts';
import type { ZipEntry } from '#src/format/pak.ts';

/** The archive in an install, relative to the game root. Its own file for the
 *  same reason it is its own archive: turning the bar off deletes exactly this. */
export const QOL_ARCHIVE = 'H5E/homm5-editor-qol.h5u';

/** Where the plate's own description lives, and so where ours must. */
const PLATE = 'UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb';
const BAR_DIR = 'UI/CombatArena-FPP-2';
const TEXTURE_DIR = 'Textures/Interface/H5E';

/** What the build copies out of `data.pak` — the shipped files every field we
 *  do not care about is taken from, so the engine reads what it already reads. */
const WANTED = [
  PLATE,
  'Textures/Interface/CombatArena/StackInfo/Positive.dds',
  'Textures/Interface/CombatArena/StackInfo/Positive.xdb',
  'UI/AdventureScreen/StackInfo/Positive.(BackgroundTiledTexture).xdb',
] as const;

/** Ours, as a background is named from a window. */
const OUR_FILL = '/UI/CombatArena-FPP-2/HealthFill.(BackgroundTiledTexture).xdb#xpointer(/BackgroundTiledTexture)';
const OUR_TRACK = '/UI/CombatArena-FPP-2/HealthTrack.(BackgroundTiledTexture).xdb#xpointer(/BackgroundTiledTexture)';

/**
 * A strip of the bar.
 *
 * The size and position here barely matter — the extension sets both every
 * frame — but they have to be SOMETHING, because a window the engine never
 * heard the size of is a window it will not draw at all.
 */
const strip = (name: string, priority: number, ownSize = true): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<WindowSimple>
	<ClassTypeID>285700801</ClassTypeID>
	<Shared href="${name}.(WindowSimpleShared).xdb#xpointer(/WindowSimpleShared)"/>
	<Name>${name}</Name>
	<TooltipFileRef href=""/>
	<Visible>true</Visible>
	<Priority>${priority}</Priority>
	<GameMessageReactions/>
	<Placement>
		<Position>
			<First>
				<x>1</x>
				<y>20</y>
			</First>
			<Second>true</Second>
		</Position>
		<VerAllign>
			<First>EPA_LOW_END</First>
			<Second>false</Second>
		</VerAllign>
		<HorAllign>
			<First>EPA_LOW_END</First>
			<Second>false</Second>
		</HorAllign>
		<Size>
			<First>
				<x>22</x>
				<y>2</y>
			</First>
			<Second>${ownSize}</Second>
		</Size>
		<LowerMargin>
			<First>
				<x>0</x>
				<y>0</y>
			</First>
			<Second>false</Second>
		</LowerMargin>
		<UpperMargin>
			<First>
				<x>0</x>
				<y>0</y>
			</First>
			<Second>false</Second>
		</UpperMargin>
	</Placement>
	<Enabled>true</Enabled>
	<TextString/>
	<relatedTexts/>
	<relatedTextures/>
	<Flags>
		<SuperActive>false</SuperActive>
	</Flags>
</WindowSimple>
`;

const stripShared = (background: string, ownSize = true): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<WindowSimpleShared>
	<Crap>false</Crap>
	<Children/>
	<Background href="${background}"/>
	<Foreground/>
	<Flags>
		<Transparent>false</Transparent>
	</Flags>
	<Placement>
		<Position>
			<First>
				<x>1</x>
				<y>20</y>
			</First>
			<Second>true</Second>
		</Position>
		<VerAllign>
			<First>EPA_LOW_END</First>
			<Second>false</Second>
		</VerAllign>
		<HorAllign>
			<First>EPA_LOW_END</First>
			<Second>false</Second>
		</HorAllign>
		<Size>
			<First>
				<x>22</x>
				<y>2</y>
			</First>
			<Second>${ownSize}</Second>
		</Size>
		<LowerMargin>
			<First>
				<x>0</x>
				<y>0</y>
			</First>
			<Second>false</Second>
		</LowerMargin>
		<UpperMargin>
			<First>
				<x>0</x>
				<y>0</y>
			</First>
			<Second>false</Second>
		</UpperMargin>
	</Placement>
	<ActiveArea/>
	<IgnoreDblClick>false</IgnoreDblClick>
	<ActiveMask/>
</WindowSimpleShared>
`;

/**
 * The plate itself, with the two strips added to the one child it shipped with.
 *
 * Copied whole rather than patched in place: the file is the game's, we are
 * replacing it, and a reader should be able to see what it now says without
 * fetching the original to diff against. The four visual states are exactly as
 * shipped — that is the buff and debuff colouring, and it is not ours to move.
 */
function plate(original: string): string {
  const children = `<Children>
		<Item href="/UI/CombatArena/StackInfo/StackText.(WindowTextView).xdb#xpointer(/WindowTextView)"/>
		<Item href="/UI/CombatArena-FPP-2/HealthTrack.(WindowSimple).xdb#xpointer(/WindowSimple)"/>
		<Item href="/UI/CombatArena-FPP-2/HealthFill.(WindowSimple).xdb#xpointer(/WindowSimple)"/>
	</Children>`;
  const was = /<Children>[\s\S]*?<\/Children>/;
  if (!was.test(original)) throw new Error(`no <Children> in ${PLATE} — the shipped file has changed`);
  return original.replace(was, children);
}

/**
 * A strip texture of ours: the game's HEADER copied byte for byte off
 * `Positive.dds` — fifteen by fifteen, uncompressed, no mipmaps, which is what
 * its own .xdb says it must be — and one flat colour for every pixel.
 *
 * FLAT, not bordered: the strips are two pixels tall, and at that height a
 * nine-slice draws its border rows and nothing else — so a darker border IS
 * the whole bar. The first green looked dim for exactly that reason. Only the
 * corners stay clear, so the rounded look survives.
 */
function stripPixels(shipped: Buffer, b: number, g: number, r: number, a: number): Buffer {
  const out = Buffer.from(shipped);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const at = 128 + (y * 15 + x) * 4;
      const corner = (x === 0 || x === 14) && (y === 0 || y === 14);
      out[at] = b;
      out[at + 1] = g;
      out[at + 2] = r;
      out[at + 3] = corner ? 0x00 : a;
    }
  }
  return out;
}

/**
 * Build the archive out of the game's own `data.pak`.
 *
 * Takes the pak rather than a path so that the e2e suite can hand it a made-up
 * one — the build only ever patches strings and repaints pixels, so a stand-in
 * with the right shapes proves the plumbing without a real install.
 */
export function buildQolArchive(dataPak: Buffer): Buffer {
  const need = new Map<string, Buffer>();
  for (const e of readEntries(dataPak)) {
    if ((WANTED as readonly string[]).includes(e.name)) need.set(e.name, e.data);
  }
  for (const w of WANTED) {
    if (!need.has(w)) throw new Error(`${w} is not in data.pak — nothing to build the health bar on`);
  }

  /** The three records one strip texture takes: the pixels, the Texture that
   *  names them, and the BackgroundTiledTexture a window can wear. */
  const stripTexture = (name: string, b: number, g: number, r: number, a: number): ZipEntry[] => [
    {
      name: `${TEXTURE_DIR}/${name}.dds`,
      data: stripPixels(need.get('Textures/Interface/CombatArena/StackInfo/Positive.dds')!, b, g, r, a),
    },
    {
      name: `${TEXTURE_DIR}/${name}.xdb`,
      data: Buffer.from(need.get('Textures/Interface/CombatArena/StackInfo/Positive.xdb')!.toString('utf8')
        .replace(/<SrcName href="[^"]*"\/>/, `<SrcName href="/UI/Combat/H5E_${name}.tga"/>`)
        .replace(/<DestName href="[^"]*"\/>/, `<DestName href="${name}.dds"/>`), 'utf8'),
    },
    {
      name: `${BAR_DIR}/${name}.(BackgroundTiledTexture).xdb`,
      data: Buffer.from(need.get('UI/AdventureScreen/StackInfo/Positive.(BackgroundTiledTexture).xdb')!.toString('utf8')
        .replace(/<Texture href="[^"]*"\/>/, `<Texture href="/${TEXTURE_DIR}/${name}.xdb#xpointer(/Texture)"/>`), 'utf8'),
    },
  ];

  const entries: ZipEntry[] = [
    { name: PLATE, data: Buffer.from(plate(need.get(PLATE)!.toString('utf8')), 'utf8') },
    // HIGHER PRIORITY DRAWS ON TOP — the shipped tooltip sits at a million and the
    // tutorial hint above it at two. So the fill must OUTRANK the track, or the
    // dark track covers the green and a wound only dims the bar instead of
    // shortening it — which is exactly how it looked until this was flipped.
    { name: `${BAR_DIR}/HealthTrack.(WindowSimple).xdb`, data: Buffer.from(strip('HealthTrack', 1, false), 'utf8') },
    { name: `${BAR_DIR}/HealthTrack.(WindowSimpleShared).xdb`, data: Buffer.from(stripShared(OUR_TRACK, false), 'utf8') },
    { name: `${BAR_DIR}/HealthFill.(WindowSimple).xdb`, data: Buffer.from(strip('HealthFill', 2), 'utf8') },
    { name: `${BAR_DIR}/HealthFill.(WindowSimpleShared).xdb`, data: Buffer.from(stripShared(OUR_FILL), 'utf8') },
    // The green Heroes III used for what is left, on a night-black track for what
    // is gone — the contrast is the whole point of the pair.
    ...stripTexture('HealthFill', 0x18, 0xf0, 0x18, 0xff),
    ...stripTexture('HealthTrack', 0x0a, 0x0a, 0x0a, 0xf0),
  ];
  return writeArchive(entries);
}

/** The archive written into an install, from that install's own data. */
export function writeQolArchive(gameRoot: string): string {
  const pak = readFileSync(join(gameRoot, 'data', 'data.pak'));
  const out = join(gameRoot, QOL_ARCHIVE);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildQolArchive(pak));
  return out;
}

/** And taken back out. True when there was one to take. */
export function removeQolArchive(gameRoot: string): boolean {
  const at = join(gameRoot, QOL_ARCHIVE);
  if (!existsSync(at)) return false;
  rmSync(at);
  return true;
}
