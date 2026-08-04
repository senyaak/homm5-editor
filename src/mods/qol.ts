// Quality of life — what the extension does for the PLAYER.
//
// THE DECLARATIONS ONLY. Reading and writing the file live in qol-file.ts, the
// same split as mod-model beside mod-files: the panel in the renderer needs the
// list of flags and their words, and a module that imports `node:fs` cannot be
// bundled into a browser page at all. So this one imports nothing.
//
// A SECOND config beside the effects one, deliberately. The effects file is
// content: it belongs to what the editor built and travels with it, and a mod
// of somebody else's is meant to carry it. These are how one person wants their
// own install to behave, and no map of theirs should carry them anywhere.
//
// The same flat text as the other file, and for the same reason: it is written
// by one program and read by another in C, and when a flag does not take effect
// the first question is what the file actually says. See native/homm5-editor.c,
// which reads it at load time from its own folder.
//
// EVERY FLAG IS OFF unless a line turns it on, and no file at all is every flag
// off. An install that never opened the panel plays exactly as it did before —
// which is the whole promise of a quality of life mod, and the reason the file
// is written in full rather than only where something is enabled.

/**
 * Beside `H5_Game_H5E.exe` and the extension, relative to the game root.
 *
 * Spelled with a separator rather than joined, because `node:path` is exactly
 * what this module may not import — and one constant is not worth the split
 * being for nothing.
 */
export const QOL_FILE = 'bin/homm5-editor-qol.txt';

/**
 * What the extension knows how to do.
 *
 * The list grows by writing C, not by adding a string here: each entry is a
 * hook that exists. `detail` is what the panel shows under the name, and it is
 * where a flag's PRICE goes — borderless is not free, it needs the game out of
 * exclusive fullscreen, and somebody deciding whether to tick it should read
 * that before rather than discover it after.
 *
 * `credit` is for a flag that is somebody ELSE'S work found again here — whose
 * it is and where they published it. It is shown as an (i) beside the name and
 * written into the config file's comments, so the acknowledgement travels with
 * the install rather than living only in this repository.
 *
 * `tab` splits the panel: `qol` is how somebody wants to PLAY — taste, every
 * entry a matter of preference — while `fixes` are bugs of the shipped game
 * taken out, which is why that tab has an "all of them" switch and this one
 * does not: turning every fix on is a reasonable default, turning every
 * preference on is not a thing. Fixes carry a `group` (see FIX_GROUPS).
 */

export const FIX_GROUPS = [
  { id: 'crashes', title: 'Crashes' },
  { id: 'mechanics', title: 'Mechanics' },
  { id: 'ai', title: 'Battle AI' },
] as const;

export type FixGroup = (typeof FIX_GROUPS)[number]['id'];
export const QOL_FLAGS = [
  {
    name: 'borderless',
    tab: 'qol',
    title: 'Borderless window',
    detail: 'The game window without its frame, filling the screen. Needs windowed mode:'
      + ' exclusive fullscreen belongs to Direct3D and has no frame to take off, so applying'
      + ' this also sets gfx_fullscreen = 0 in your game profile.',
  },
  {
    name: 'own-profile',
    tab: 'qol',
    title: 'Keep settings and saves with the mod',
    detail: 'Profiles, key bindings, settings and saves go to H5E/user inside the install, instead of'
      + ' Documents, where every copy of the game on this machine shares one set of them. Starts empty:'
      + ' nothing is copied over, so the base game keeps its saves and this build begins fresh.',
  },
  {
    name: 'quick-split',
    tab: 'qol',
    title: 'Split a stack with a held key',
    detail: 'Click an army slot with Ctrl held to put one creature in the first free slot — or, on a'
      + ' stack of one, to put it back with its own kind. Shift evens the stacks of that creature out'
      + ' and adds one more each click, 12 becoming 6 and 6, then 4, 4 and 4; stacks of a single'
      + ' creature are left where they are. Alt gathers them all back into the one clicked, and'
      + ' Ctrl+Shift puts one creature into every free slot. No slider window appears. A click with no'
      + ' key held picks the stack up as before, and dragging is left alone entirely.',
  },
  {
    name: 'stack-health-bar',
    tab: 'qol',
    title: 'A health bar on the stack plate',
    detail: 'In a battle, the plate over a stack carries a bar showing how much health the creature'
      + ' at the front of it has left — the one currently being hit, not the stack as a whole,'
      + ' like the HotA bar in Heroes III. Shown on every stack, yours and the enemy\'s. Applying'
      + ' this also writes H5E/homm5-editor-qol.h5u, the archive the bar\'s strips live in, and'
      + ' turning it off deletes that archive again — the strips are drawn by the game itself,'
      + ' so a config line alone would not take them off the screen.',
  },
  {
    name: 'stack-losses',
    tab: 'qol',
    title: 'Losses on the plate while Shift is held',
    detail: 'Hold Shift in a battle and every plate reads "now / at the start of the battle", so 53'
      + ' of the 59 that walked in reads 53/59. Counted per battle and from the moment it began, so'
      + ' a stack raised past what it started with reads above it rather than being trimmed to fit.'
      + ' Costs nothing while the key is up — the number is the game\'s own until it is held.',
  },
  {
    name: 'combat-ai-fix',
    tab: 'fixes',
    group: 'ai',
    title: 'Fix the battle AI\'s spellcasting',
    detail: 'Three bugs in the AI that decides what to do in a battle, taken out of the executable in'
      + ' memory: spells with no creature target — mass spells, summons — ranked below every targeted'
      + ' plan and so never cast; a counterspell "deleting" the enemy hero\'s whole magic value from'
      + ' the army comparison, which is why the AI kept recasting it instead of fighting; and a'
      + ' stack\'s worth counted as its size SQUARED under Deflect Arrows, drowning out every other'
      + ' reason to pick a target. Found again in this build from RedHeavenHero\'s CombatAIFix v1.1,'
      + ' which makes the same three changes in a different one. Nothing is written to the image while'
      + ' this is off.',
    credit: 'Uses the work of CombatAIFix v1.1 by RedHavenHero'
      + ' — https://forum.heroesworld.ru/showthread.php?t=15624',
  },
  {
    name: 'encourage-fix',
    tab: 'fixes',
    group: 'mechanics',
    title: 'Encourage works on a stack immune to magic',
    detail: 'A Knight\'s Encourage only moves a friendly stack\'s turn up — but the game runs it through'
      + ' the check that refuses a spell against an immune target, so it is refused by your OWN'
      + ' creature being immune to magic. The ability\'s own description says nothing about magic. This'
      + ' takes it out of that check; the other five abilities the check covers are left alone.',
    credit: 'Uses the work of H5_DLL by dredknight, with permission'
      + ' — https://github.com/dredknight/H5_DLL',
  },
  {
    name: 'barbarian-learning-fix',
    tab: 'fixes',
    group: 'mechanics',
    title: 'Forgetting Barbarian Learning takes its bonuses back',
    detail: 'The switch that undoes what a skill granted has a case for Learning and none for'
      + ' Barbarian Learning, which falls through to "do nothing" — so a barbarian who loses the skill'
      + ' keeps the primary stats it gave him. This points it at the case Learning already uses.',
    credit: 'Uses the work of H5_DLL by dredknight, with permission'
      + ' — https://github.com/dredknight/H5_DLL',
  },
] as const;

export type QolName = (typeof QOL_FLAGS)[number]['name'];
export type QolSettings = Partial<Record<QolName, boolean>>;

const NAMES = QOL_FLAGS.map((f) => f.name) as readonly QolName[];

/** Is this one of ours? Guards a value coming back from the renderer. */
export const isQolName = (s: string): s is QolName => (NAMES as readonly string[]).includes(s);
