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
 */
export const QOL_FLAGS = [
  {
    name: 'borderless',
    title: 'Borderless window',
    detail: 'The game window without its frame, filling the screen. Needs windowed mode:'
      + ' exclusive fullscreen belongs to Direct3D and has no frame to take off, so applying'
      + ' this also sets gfx_fullscreen = 0 in your game profile.',
  },
  {
    name: 'own-profile',
    title: 'Keep settings and saves with the mod',
    detail: 'Profiles, key bindings, settings and saves go to H5E/user inside the install, instead of'
      + ' Documents, where every copy of the game on this machine shares one set of them. Starts empty:'
      + ' nothing is copied over, so the base game keeps its saves and this build begins fresh.',
  },
  {
    name: 'quick-split',
    title: 'Split a stack with a held key',
    detail: 'Click an army slot with Ctrl held to put one creature in the first free slot — or, on a'
      + ' stack of one, to put it back with its own kind. Shift evens the stacks of that creature out'
      + ' and adds one more each click, 12 becoming 6 and 6, then 4, 4 and 4; stacks of a single'
      + ' creature are left where they are. Alt gathers them all back into the one clicked, and'
      + ' Ctrl+Shift puts one creature into every free slot. No slider window appears. A click with no'
      + ' key held picks the stack up as before, and dragging is left alone entirely.',
  },
] as const;

export type QolName = (typeof QOL_FLAGS)[number]['name'];
export type QolSettings = Partial<Record<QolName, boolean>>;

const NAMES = QOL_FLAGS.map((f) => f.name) as readonly QolName[];

/** Is this one of ours? Guards a value coming back from the renderer. */
export const isQolName = (s: string): s is QolName => (NAMES as readonly string[]).includes(s);
