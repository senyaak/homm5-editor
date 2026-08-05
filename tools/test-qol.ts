// The quality of life config, both halves of it.
//
// Two programs share this file: the editor writes it and the extension reads it
// in C, by hand, with no parser worth the name. So the checks here are less
// about the writer being self-consistent — it trivially is — than about the
// two halves still agreeing:
//
//   the FILE — what is written is what the C reader's grammar accepts, and what
//     it accepts comes back as what was written.
//   the NAMES — every flag the panel offers is a flag native/qol/config.c
//     knows, and the file name is the one it opens. A flag added on one side
//     only is a switch that silently does nothing, which is exactly the failure
//     this feature must not have.
//   the WINDOWED HALF — borderless needs the game out of exclusive fullscreen
//     and rendering at the size of the screen, and both settings live in a
//     profile of the game's own (under Documents, or under the install once the
//     user folder has moved). What is checked is that only an existing line is
//     changed and a profile without one is reported rather than repaired.
//
//   node tools/test-qol.ts

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { QOL_FILE, QOL_FLAGS, isQolName } from '../src/mods/qol.ts';
import { readQol, writeQolFile } from '../src/mods/qol-file.ts';
import { QOL_ARCHIVE, buildQolArchive, removeQolArchive, writeQolArchive } from '../src/mods/qol-ui.ts';
import { readEntries } from '../src/format/pak.ts';
import type { ZipEntry } from '../src/format/pak.ts';
import { profilesRoot, setResolution, setWindowed, userConfigs } from '../src/game/video-config.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const REPO = join(import.meta.dirname, '..');
const SCRATCH = join(REPO, '_tmp', 'qol-test');
rmSync(SCRATCH, { recursive: true, force: true });

// --- the file ---------------------------------------------------------------

const game = join(SCRATCH, 'game');
mkdirSync(join(game, 'bin'), { recursive: true });

check('no file at all reads as every flag off',
  QOL_FLAGS.every((f) => readQol(game)[f.name] === false));

const all: Record<string, boolean> = {};
for (const f of QOL_FLAGS) all[f.name] = true;
writeQolFile(game, all);
check('written file lands where the extension looks', existsSync(join(game, QOL_FILE)));
check('everything on comes back on', QOL_FLAGS.every((f) => readQol(game)[f.name] === true));

writeQolFile(game, {});
check('everything off comes back off', QOL_FLAGS.every((f) => readQol(game)[f.name] === false));
check('a flag that is off is still written down',
  readFileSync(join(game, QOL_FILE), 'utf8').includes(`${QOL_FLAGS[0].name} 0`));

// The grammar the C reader implements: a comment, a blank line, or a name and
// one decimal. Anything else in the file would be skipped there in silence.
// A name may hold hyphens — `take_word` there reads to the next space, so
// `own-profile` is one word to it exactly as it is here.
const written = readFileSync(join(game, QOL_FILE), 'utf8').split('\n');
const bad = written.filter((l) => l.trim() && !l.startsWith('#') && !/^[a-z][a-z-]* [01]$/.test(l));
check('every line is a comment or "<name> <0|1>"', bad.length === 0, bad.join(' | '));

// Hand-written files: the name alone means on, an unknown name is not a flag.
writeFileSync(join(game, QOL_FILE), `# by hand\n${QOL_FLAGS[0].name}\nnosuchflag 1\n`, 'utf8');
const byHand = readQol(game);
check('a name on its own means on', byHand[QOL_FLAGS[0].name] === true);
check('an unknown name is not taken as a flag', !('nosuchflag' in byHand));
check('isQolName refuses what is not ours', !isQolName('nosuchflag') && isQolName(QOL_FLAGS[0].name));

// --- the two halves agreeing ------------------------------------------------

const c = readFileSync(join(REPO, 'native', 'qol', 'config.c'), 'utf8');

check('the extension opens the file this writes', c.includes('homm5-editor-qol.txt'));
check('the path here names the same file', QOL_FILE.endsWith('homm5-editor-qol.txt'));

// QOL_NAMES in the C source is the reader's whole vocabulary.
const names = /QOL_NAMES\[QOL_COUNT\]\s*=\s*\{([^}]*)\}/.exec(c);
const known = names ? [...names[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
check('the extension declares its flag names', known.length > 0);
for (const f of QOL_FLAGS) {
  check(`the extension knows "${f.name}"`, known.includes(f.name));
}
for (const name of known) {
  check(`the panel offers "${name}"`, QOL_FLAGS.some((f) => f.name === name));
}

// --- the windowed half ------------------------------------------------------

// A profiles tree shaped like the real one under Documents: one profile with
// video settings, one without, and a folder that is not a profile at all.
const docs = join(SCRATCH, 'Documents');
const profiles = join(docs, 'My Games', 'Heroes of Might and Magic V — Tribes of the East', 'Profiles');
mkdirSync(join(profiles, 'Player'), { recursive: true });
mkdirSync(join(profiles, 'Empty'), { recursive: true });
const withVideo = join(profiles, 'Player', 'user_a2.cfg');
const withoutVideo = join(profiles, 'Empty', 'user_a2.cfg');
writeFileSync(withVideo, 'setvar gfx_gamma = 1\nsetvar gfx_fullscreen = 1\nsetvar gfx_fsaa = 0\n', 'utf8');
writeFileSync(withoutVideo, 'setvar snd_volume = 10\n', 'utf8');
writeFileSync(join(profiles, 'global_a2.cfg'), 'setvar nothing = 0\n', 'utf8');

check('the profiles root is found by the game\'s name', profilesRoot(docs) === profiles);
check('a machine with no such folder says so', profilesRoot(join(SCRATCH, 'nowhere')) === null);
check('every profile with settings is found', userConfigs(profiles).length === 2);

const result = setWindowed(profiles, true);
check('the profile that had the setting was changed', result.changed.length === 1
  && result.changed[0] === withVideo);
check('the profile without it was skipped, not repaired', result.skipped.length === 1
  && readFileSync(withoutVideo, 'utf8') === 'setvar snd_volume = 10\n');

const after = readFileSync(withVideo, 'utf8');
check('windowed mode is set', /^setvar gfx_fullscreen = 0$/m.test(after));
check('nothing else in the profile moved',
  after === 'setvar gfx_gamma = 1\nsetvar gfx_fullscreen = 0\nsetvar gfx_fsaa = 0\n');

setWindowed(profiles, false);
check('and it can be set back', /^setvar gfx_fullscreen = 1$/m.test(readFileSync(withVideo, 'utf8')));

// The render size, which borderless makes a real question: a window the size of
// the screen with a 1024x768 backbuffer behind it is a stretched picture.
writeFileSync(withVideo, 'setvar gfx_resolution = 1024x768\n', 'utf8');
const res = setResolution(profiles, 2560, 1440);
check('the render size is written in the game\'s own form',
  readFileSync(withVideo, 'utf8') === 'setvar gfx_resolution = 2560x1440\n');
check('a profile without the line is skipped there too', res.skipped.length === 1);

// --- the health bar's archive ------------------------------------------------
//
// Built out of the install's own data.pak, so the check hands it a stand-in of
// the right shapes — the same four files the e2e fixture fakes — and reads the
// archive back. What matters is what the engine will read: the plate must list
// the strips as children, the fill must OUTRANK the track (higher priority
// draws on top — the lesson that cost a battle of "the bar never shrinks"),
// and the fill's pixels must be the one flat colour with clear corners,
// because at two pixels tall a nine-slice border would BE the whole bar.

{
  const fakeDds = Buffer.alloc(128 + 15 * 15 * 4);
  // The four files the build takes out of the install's own data.
  const shipped: ZipEntry[] = [
    {
      name: 'UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb',
      data: Buffer.from('<WindowMSButtonShared><Children>\n\t<Item href="/UI/CombatArena/StackInfo/'
        + 'StackText.(WindowTextView).xdb#xpointer(/WindowTextView)"/>\n</Children></WindowMSButtonShared>', 'utf8'),
    },
    { name: 'Textures/Interface/CombatArena/StackInfo/Positive.dds', data: fakeDds },
    {
      name: 'Textures/Interface/CombatArena/StackInfo/Positive.xdb',
      data: Buffer.from('<Texture><SrcName href="x.tga"/><DestName href="x.dds"/></Texture>', 'utf8'),
    },
    {
      name: 'UI/AdventureScreen/StackInfo/Positive.(BackgroundTiledTexture).xdb',
      data: Buffer.from('<BackgroundTiledTexture><Texture href="x.xdb"/></BackgroundTiledTexture>', 'utf8'),
    },
  ];

  // A LOOKUP, not an archive, and that is the seam's whole point: the shipping
  // caller opens `data.pak` and pulls four members through its central
  // directory, because reading all 1.4 GB of it and inflating every member
  // froze the application. A stand-in that had to be a Buffer would have kept
  // the old shape alive here while the real path used a different one.
  const find = (name: string): Buffer | undefined => shipped.find((e) => e.name === name)?.data;
  const entries = new Map(readEntries(buildQolArchive(find)).map((e) => [e.name, e.data]));
  check('the archive holds all eleven records', entries.size === 11);

  const plate = entries.get('UI/CombatArena-FPP-2/StackInfo.(WindowMSButtonShared).xdb')?.toString('utf8') ?? '';
  check('the plate lists the text and both strips as children',
    plate.includes('StackText.(WindowTextView)') && plate.includes('HealthTrack.(WindowSimple)')
    && plate.includes('HealthFill.(WindowSimple)'));

  const priorityOf = (name: string): number =>
    Number(entries.get(`UI/CombatArena-FPP-2/${name}.(WindowSimple).xdb`)?.toString('utf8')
      .match(/<Priority>(-?\d+)<\/Priority>/)?.[1] ?? NaN);
  check('the fill outranks the track, so green draws over dark',
    priorityOf('HealthFill') > priorityOf('HealthTrack'));

  const fill = entries.get('Textures/Interface/H5E/HealthFill.dds');
  const px = (x: number, y: number): number[] =>
    fill ? [...fill.subarray(128 + (y * 15 + x) * 4, 128 + (y * 15 + x) * 4 + 4)] : [];
  check('the fill is one flat bright colour, edge and middle alike',
    !!fill && px(7, 7).join() === px(7, 0).join() && (px(7, 7)[1] ?? 0) > 0xC0);
  check('with only the corners left clear', px(0, 0)[3] === 0 && px(14, 14)[3] === 0
    && px(7, 7)[3] === 0xff);
  check('and the header is the shipped one, byte for byte',
    !!fill && fill.subarray(0, 128).equals(fakeDds.subarray(0, 128)));

  // The install half, through the REAL route: the four files laid out as the
  // unpacked data root holds them, and the archive written into the install.
  // TWO ROOTS, and the test keeps them apart on purpose — the data does not
  // live under the install, and a stand-in that put it there would let a
  // version that reached from one to the other pass.
  const data = join(SCRATCH, 'data-unpacked');
  for (const e of shipped) {
    mkdirSync(dirname(join(data, e.name)), { recursive: true });
    writeFileSync(join(data, e.name), e.data);
  }
  const wrote = writeQolArchive(game, data);
  check('the archive lands in H5E, where archives are mounted from',
    wrote === join(game, QOL_ARCHIVE) && existsSync(wrote));
  check('and no archive of the game\'s was opened to build it',
    !existsSync(join(game, 'data', 'data.pak')));
  check('and taking it back out reports there was one to take',
    removeQolArchive(game) && !existsSync(wrote) && !removeQolArchive(game));
}

rmSync(SCRATCH, { recursive: true, force: true });

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
