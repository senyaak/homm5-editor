// The game settings panel — quality of life, off by default.
//
// What it edits is not the editor's memory but a file in the install: the
// extension reads `bin/homm5-editor-qol.txt` at startup, and this panel is a
// front door onto it. So the switches are read back from the game every time it
// opens, and an install somebody edited by hand shows what they wrote.
//
// A panel of its own rather than a tab of the mod dialogs: nothing here builds
// an archive, patches a ceiling or touches an open map, which is why it is
// offered with a map open and without, like Play.

import { $, $button } from '#core/dom.ts';
import { modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { QOL_FLAGS } from '#src/mods/qol.ts';

/** The checkbox belonging to each flag, built once when the panel first opens. */
const boxes = new Map<string, HTMLInputElement>();

function buildRows(): void {
  if (boxes.size) return;
  const list = $('qol-list');
  list.innerHTML = '';
  for (const flag of QOL_FLAGS) {
    const row = document.createElement('label');
    row.className = 'qol-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `qol-${flag.name}`;

    const name = document.createElement('span');
    name.className = 'qol-name';
    name.textContent = flag.title;

    // Somebody else's work, said beside the name rather than buried in the
    // detail: a mark that is there only when there is a credit to give, and the
    // whole acknowledgement — who, and where they published it — in its tooltip.
    // A span rather than a link because nothing in this app opens a browser, and
    // one switch is not the place to start; the address is there to be read.
    if ('credit' in flag && flag.credit) {
      const mark = document.createElement('span');
      mark.className = 'qol-credit';
      mark.textContent = 'ⓘ';
      mark.title = flag.credit;
      name.append(' ', mark);
    }

    // The price of ticking it, in the same words the config file carries — so
    // the two never drift and neither has to be trusted over the other.
    const detail = document.createElement('span');
    detail.className = 'qol-detail';
    detail.textContent = flag.detail;

    row.append(box, name, detail);
    list.append(row);
    boxes.set(flag.name, box);
  }
}

/** Read the install and show what it says. */
async function refresh(): Promise<void> {
  const state = await api.qolGet();
  for (const [name, box] of boxes) box.checked = !!state.settings[name];

  const warn = $('qol-warn');
  // Nothing in this panel works without the extension, and saying so after
  // Apply would be saying it too late.
  //
  // THE PATH IS IN THE MESSAGE. The likeliest reason for "no copy of the
  // executable" is not an unprepared install but a window looking at the wrong
  // folder — a worktree whose launcher guessed the directory above it, say —
  // and without the path that reads as a broken panel rather than as a
  // misconfigured one.
  const missing = !state.patchedExe
    ? `No copy of the executable in ${state.install} — nothing here can take effect until`
      + ' there is one. If that is not the install you meant, point HOMM5_ROOT at the right'
      + ' one; if it is, prepare it (start the editor with --setup).'
    : !state.extension
      ? 'The extension is not installed in this game yet. Apply will put it there.'
      : '';
  warn.textContent = missing;
  warn.hidden = !missing;

  $('qol-file').textContent = state.file;
  $('qol-msg').textContent = '';
}

async function apply(): Promise<void> {
  const settings: Record<string, boolean> = {};
  for (const [name, box] of boxes) settings[name] = box.checked;

  const msg = $('qol-msg');
  msg.textContent = 'applying…';
  try {
    const result = await api.qolApply(settings);
    const said: string[] = ['settings written'];
    // Written but inert: the answers are kept, and the reason they cannot take
    // effect yet is the thing to say rather than a silent success.
    if (!result.extension) said.push(result.note || 'the extension is not installed — nothing will read this yet');
    if (result.windowed.length) {
      said.push(`windowed mode set in ${result.windowed.length} game profile(s)`);
    }
    // Asked for borderless and no profile to put it in: the game makes one on
    // its first run, so this is a real state and not a failure.
    if (!result.profilesFound) {
      said.push('no game profile found yet — play once, then apply again for windowed mode');
    }
    if (result.windowedSkipped.length) {
      said.push(`${result.windowedSkipped.length} profile(s) had no video settings to change`);
    }
    said.push('restart the game for it to take effect');
    msg.textContent = `${said.join(' · ')}.`;
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Open it, showing what the install currently says. */
export function openQol(): void {
  buildRows();
  const dialog = modDialog('qolcfg');
  if (!dialog.open) dialog.showModal();
  void refresh();
}

/** Wire the panel. Called once, from app.ts. */
export function initQol(): void {
  $button('qolbtn').onclick = openQol;
  $button('qol-apply').onclick = () => { void apply(); };
  const close = (): void => { modDialog('qolcfg').close(); };
  $button('qol-close').onclick = close;
  $button('qol-x').onclick = close;
}
