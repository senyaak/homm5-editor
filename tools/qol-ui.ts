// Build the archive that puts a health bar on a battle stack's plate.
//
//   node tools/qol-ui.ts [--game <dir>]
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
// THE THREE LAYERS the bar is made of are two windows, not three: the plate's own
// backgrounds are NINE-SLICE tiled textures, so each strip draws its own border.
// The track is the dark one at full width, the fill is the green one clipped to
// what the creature at the front has left, and the frame comes free with both.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { writeArchive } from '#src/format/pak.ts';
import type { ZipEntry } from '#src/format/pak.ts';

const here = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Where the plate's own description lives, and so where ours must. */
const PLATE = 'UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb';
const BAR_DIR = 'UI/CombatArena-FPP-2';

/**
 * A strip of one of the plate's own backgrounds.
 *
 * The size and position here barely matter — the extension sets both every
 * frame — but they have to be SOMETHING, because a window the engine never
 * heard the size of is a window it will not draw at all.
 */
const strip = (name: string, background: string, priority: number): string =>
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
			<Second>true</Second>
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

/** Ours, and the shipped one, as a background may be named. */
const OUR_FILL = '/UI/CombatArena-FPP-2/HealthFill.(BackgroundTiledTexture).xdb#xpointer(/BackgroundTiledTexture)';
const SHIPPED_TRACK = '/UI/AdventureScreen/StackInfo/Normal.(BackgroundTiledTexture).xdb#xpointer(/BackgroundTiledTexture)';

const stripShared = (background: string): string =>
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
			<Second>true</Second>
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
 * A brighter green than the game has.
 *
 * The shipped `Positive` plate is 0x003200 at just over a third alpha — right
 * for tinting a whole badge, far too dim for a two-pixel bar. Ours is the green
 * Heroes III used, opaque, with only the corners left clear so the rounded look
 * survives. The pixels are ours and the HEADER is the game's, copied byte for
 * byte off `Positive.dds`: fifteen by fifteen, uncompressed, no mipmaps, which
 * is what its own .xdb says it must be.
 *
 * Nine-slice, so the outer ring is the border and the middle is the fill.
 */
function brightGreen(shipped: Buffer): Buffer {
  const out = Buffer.from(shipped);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const at = 128 + (y * 15 + x) * 4;
      const edge = x === 0 || y === 0 || x === 14 || y === 14;
      // BGRA, and the corners stay clear so the rounded look survives.
      const corner = (x === 0 || x === 14) && (y === 0 || y === 14);
      out[at] = edge ? 0x10 : 0x20;
      out[at + 1] = edge ? 0x70 : 0xFF;
      out[at + 2] = edge ? 0x08 : 0x20;
      out[at + 3] = corner ? 0x00 : 0xFF;
    }
  }
  return out;
}

// --- what to write ------------------------------------------------------------

import { readEntries } from '#src/format/pak.ts';
import { readFileSync } from 'node:fs';

const game = resolve(flag('game') ?? process.env.HOMM5_GAME ?? join(here, '..'));
const source = join(game, 'data', 'data.pak');

const need = new Map<string, Buffer>();
const WANTED = [
  PLATE,
  'Textures/Interface/CombatArena/StackInfo/Positive.dds',
  'Textures/Interface/CombatArena/StackInfo/Positive.xdb',
  'UI/AdventureScreen/StackInfo/Positive.(BackgroundTiledTexture).xdb',
];
for (const e of readEntries(readFileSync(source))) {
  if (WANTED.includes(e.name)) need.set(e.name, e.data);
}
for (const w of WANTED) {
  if (need.has(w)) continue;
  console.error(`${w} is not in ${source} — nothing to build on`);
  process.exit(1);
}
const shipped = need.get(PLATE)!.toString('utf8');
const OUR_TEXTURE = 'Textures/Interface/H5E/HealthFill';

const entries: ZipEntry[] = [
  { name: PLATE, data: Buffer.from(plate(shipped), 'utf8') },
  { name: `${BAR_DIR}/HealthTrack.(WindowSimple).xdb`, data: Buffer.from(strip('HealthTrack', 'Normal', 2), 'utf8') },
  { name: `${BAR_DIR}/HealthTrack.(WindowSimpleShared).xdb`, data: Buffer.from(stripShared(SHIPPED_TRACK), 'utf8') },
  { name: `${BAR_DIR}/HealthFill.(WindowSimple).xdb`, data: Buffer.from(strip('HealthFill', 'Positive', 1), 'utf8') },
  { name: `${BAR_DIR}/HealthFill.(WindowSimpleShared).xdb`, data: Buffer.from(stripShared(OUR_FILL), 'utf8') },
  // The bar's own green: the game's header, our pixels, and the two records
  // that name it — each copied off the shipped Positive so that every field we
  // do not care about is exactly what the engine already reads elsewhere.
  { name: `${OUR_TEXTURE}.dds`, data: brightGreen(need.get('Textures/Interface/CombatArena/StackInfo/Positive.dds')!) },
  {
    name: `${OUR_TEXTURE}.xdb`,
    data: Buffer.from(need.get('Textures/Interface/CombatArena/StackInfo/Positive.xdb')!.toString('utf8')
      .replace(/<SrcName href="[^"]*"\/>/, '<SrcName href="/UI/Combat/H5E_HealthFill.tga"/>')
      .replace(/<DestName href="[^"]*"\/>/, '<DestName href="HealthFill.dds"/>'), 'utf8'),
  },
  {
    name: `${BAR_DIR}/HealthFill.(BackgroundTiledTexture).xdb`,
    data: Buffer.from(need.get('UI/AdventureScreen/StackInfo/Positive.(BackgroundTiledTexture).xdb')!.toString('utf8')
      .replace(/<Texture href="[^"]*"\/>/, `<Texture href="/${OUR_TEXTURE}.xdb#xpointer(/Texture)"/>`), 'utf8'),
  },
];

const out = join(game, 'H5E', 'homm5-editor-qol.h5u');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, writeArchive(entries));
console.log(`wrote ${out} — ${entries.length} files`);
for (const e of entries) console.log(`  ${e.name}`);
