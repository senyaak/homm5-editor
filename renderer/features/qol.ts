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

import { $, $button, onClickAsync } from '#core/dom.ts';
import { modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { FIX_GROUPS, NET_SWITCH, QOL_FLAGS } from '#src/mods/qol.ts';

/** The checkbox belonging to each flag, built once when the panel first opens. */
const boxes = new Map<string, HTMLInputElement>();

/** The fixes' own switches, for the "every fix" master to read and write. */
const fixBoxes: HTMLInputElement[] = [];
/** The master itself — NOT in `boxes`: it is a hand on the other switches, not
 *  a line in the config file, and apply() writes everything `boxes` holds. */
let allFixes: HTMLInputElement | null = null;

/**
 * The network tab's one switch — NOT in `boxes` either: it stands for the two
 * flags `net-agent` and `net-u-lobby` at once (src/mods/qol.ts, NET_SWITCH),
 * and apply() writes them both from it.
 */
let netOn: HTMLInputElement | null = null;
/** What the file said about the two halves, kept so a mixed file written by
 *  hand survives an Apply that did not touch the switch. */
let netFlags = { agent: false, uLobby: false };

/**
 * Lobbies this build knows by name — what the Lobby select offers beside
 * Custom. A preset fills the two ADDRESSES and only them: the local port is
 * this machine's own affair (two copies here need two ports), not the lobby's.
 */
const LOBBY_PRESETS = [
  {
    id: 'senyaak.work',
    relay: 'wss://relay-h5e.senyaak.work/agent',
    uLobby: 'wss://u-lobby-h5e.senyaak.work/u-lobby',
  },
] as const;

/** What a row is built from — every QOL_FLAGS entry fits, and so does NET_SWITCH. */
interface RowText {
  name: string;
  title: string;
  detail: string;
  credit?: string;
}

/** One flag as a row: the switch, the name, the credit, the folded detail. */
function buildRow(flag: RowText, into: HTMLElement, register = true): HTMLInputElement {
  // A div holding a label, rather than one big label. The detail folds away
  // into a <details>, and inside a label its summary would toggle the switch
  // every time somebody opened it — so only the tickable part is the label.
  const row = document.createElement('div');
  row.className = 'qol-row';
  const head = document.createElement('label');
  head.className = 'qol-head';

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
  //
  // FOLDED AWAY. Every one of these is a paragraph, and six paragraphs is a
  // panel somebody scrolls past to reach the switches. Shut, the list is six
  // lines and reads as a list; the words are one click away for the flag being
  // decided about, which is the only one they are wanted for.
  const detail = document.createElement('details');
  detail.className = 'qol-detail';
  const summary = document.createElement('summary');
  summary.textContent = 'What this does';
  const body = document.createElement('span');
  body.textContent = flag.detail;
  detail.append(summary, body);

  head.append(box, name);
  row.append(head, detail);
  into.append(row);
  if (register) boxes.set(flag.name, box);
  return box;
}

/** All fixes on, all off, or the mix in between — said on the master switch. */
function syncAllFixes(): void {
  if (!allFixes) return;
  const on = fixBoxes.filter((b) => b.checked).length;
  allFixes.checked = on === fixBoxes.length && on > 0;
  allFixes.indeterminate = on > 0 && on < fixBoxes.length;
}

function buildRows(): void {
  if (boxes.size) return;
  const list = $('qol-list');
  list.innerHTML = '';
  for (const flag of QOL_FLAGS) {
    if (flag.tab === 'qol') buildRow(flag, list);
  }

  // The fixes, under their group headings — a heading only when the group has
  // a row, so the panel never shows an empty promise of crashes fixed.
  const groups = $('qol-fixes-groups');
  groups.innerHTML = '';
  for (const group of FIX_GROUPS) {
    const flags = QOL_FLAGS.filter((f) => f.tab === 'fixes' && f.group === group.id);
    if (!flags.length) continue;
    const heading = document.createElement('div');
    heading.className = 'qol-group';
    heading.textContent = group.title;
    groups.append(heading);
    for (const flag of flags) buildRow(flag, groups);
  }
  for (const flag of QOL_FLAGS) {
    if (flag.tab === 'fixes') {
      const box = boxes.get(flag.name);
      if (box) {
        fixBoxes.push(box);
        box.addEventListener('change', syncAllFixes);
      }
    }
  }

  // Gameplay: additions, each an archive following its flag. No master switch —
  // like the preferences, each one is its own decision.
  const gameplay = $('qol-gameplay');
  gameplay.innerHTML = '';
  for (const flag of QOL_FLAGS) {
    if (flag.tab === 'gameplay') buildRow(flag, gameplay);
  }

  // Network: playing with somebody else, which is the one part of this panel
  // that needs a server and an account as well as a tick. Into its own div and
  // not the tab itself, because the fields under it are static markup and
  // clearing the tab would take them with it.
  //
  // ONE row where the file has two flags: to somebody deciding, playing through
  // a lobby is one thing — see NET_SWITCH. Not registered in `boxes`, because
  // it is not a line in the file; apply() writes both flags from it, and
  // refresh() shows a hand-mixed file as the indeterminate state it is.
  const network = $('qol-net-rows');
  network.innerHTML = '';
  netOn = buildRow({ name: 'net-on', ...NET_SWITCH }, network, false);

  // The master switch: every fix at once.
  allFixes = $('qol-all-fixes') as HTMLInputElement;
  allFixes.addEventListener('change', () => {
    for (const b of fixBoxes) b.checked = allFixes!.checked;
    allFixes!.indeterminate = false;
  });
}

/** Read the install and show what it says. */
async function refresh(): Promise<void> {
  const state = await api.qolGet();
  for (const [name, box] of boxes) box.checked = !!state.settings[name];
  // The master mirrors the install like everything else on the panel.
  syncAllFixes();

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

  // The network switch stands for two flags. Both on is on, both off is off,
  // and a file written by hand to one of them shows as the third state a
  // checkbox has — not as a guess either way.
  netFlags = { agent: !!state.settings['net-agent'], uLobby: !!state.settings['net-u-lobby'] };
  if (netOn) {
    netOn.checked = netFlags.agent && netFlags.uLobby;
    netOn.indeterminate = netFlags.agent !== netFlags.uLobby;
  }

  // The addresses, from the install as well — the same rule as the switches:
  // what is shown is what the game will read, not what was typed here last time.
  ($('qol-net-relay') as HTMLInputElement).value = state.net?.relay ?? '';
  ($('qol-net-u-lobby-url') as HTMLInputElement).value = state.net?.uLobby ?? '';
  // Zero is "the extension picks a free one at bind" and shows as the empty
  // field it was left as — not as a number nobody typed.
  ($('qol-net-u-lobby-port') as HTMLInputElement).value = state.net?.uLobbyPort ? String(state.net.uLobbyPort) : '';
  $('qol-net-file').textContent = state.netFile ?? '';
  syncPreset();

  $('qol-file').textContent = state.file;
  $('qol-msg').textContent = '';
}

/**
 * The Lobby select is a VIEW of the two address fields, never a third value:
 * it shows the name the addresses match, or Custom when they match nobody.
 * Editing a field flips it by itself, so it can never claim a lobby the file
 * does not name.
 */
function syncPreset(): void {
  const relay = ($('qol-net-relay') as HTMLInputElement).value.trim();
  const uLobby = ($('qol-net-u-lobby-url') as HTMLInputElement).value.trim();
  const match = LOBBY_PRESETS.find((p) => p.relay === relay && p.uLobby === uLobby);
  ($('qol-net-preset') as HTMLSelectElement).value = match ? match.id : 'custom';
}

async function apply(): Promise<void> {
  const settings: Record<string, boolean> = {};
  for (const [name, box] of boxes) settings[name] = box.checked;

  // The one switch answers for both net flags. Indeterminate — a file somebody
  // mixed by hand, not touched since — keeps saying what the file said.
  if (netOn) {
    if (netOn.indeterminate) {
      settings['net-agent'] = netFlags.agent;
      settings['net-u-lobby'] = netFlags.uLobby;
    } else {
      settings['net-agent'] = netOn.checked;
      settings['net-u-lobby'] = netOn.checked;
    }
  }

  const net = {
    relay: ($('qol-net-relay') as HTMLInputElement).value.trim(),
    uLobby: ($('qol-net-u-lobby-url') as HTMLInputElement).value.trim(),
    uLobbyPort: Number(($('qol-net-u-lobby-port') as HTMLInputElement).value.trim()),
  };

  const msg = $('qol-msg');
  msg.textContent = 'applying…';
  try {
    const result = await api.qolApply(settings, net);
    const said: string[] = ['settings written'];
    // Written but inert: the answers are kept, and the reason they cannot take
    // effect yet is the thing to say rather than a silent success.
    //
    // A NOTE IS SHOWN WHENEVER THERE IS ONE, not only when the extension is
    // missing. The two came apart with the running-game check: a game that is
    // open leaves an already-installed extension installed — `extension` is
    // perfectly true — and the one thing worth saying is that nothing in the
    // install was touched. Tied to the flag, that sentence was dropped.
    if (result.note) said.push(result.note);
    else if (!result.extension) said.push('the extension is not installed — nothing will read this yet');
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
  // Not `void apply()`: it installs the extension and rewrites game profiles,
  // which is up to a minute of a button that looks unpressed. Two Applies
  // writing the same files is what happens next.
  onClickAsync('qol-apply', apply, 'applying…');
  const close = (): void => { modDialog('qolcfg').close(); };
  $button('qol-close').onclick = close;
  $button('qol-x').onclick = close;

  // Picking a lobby by name fills the two addresses; the local port is not
  // touched — it is this machine's, not the lobby's. Picking Custom changes
  // nothing: the fields already say what they say, and they stay editable
  // either way. Editing a field re-derives the select, so the two never argue.
  const preset = $('qol-net-preset') as HTMLSelectElement;
  preset.addEventListener('change', () => {
    const chosen = LOBBY_PRESETS.find((p) => p.id === preset.value);
    if (!chosen) return;
    ($('qol-net-relay') as HTMLInputElement).value = chosen.relay;
    ($('qol-net-u-lobby-url') as HTMLInputElement).value = chosen.uLobby;
  });
  for (const id of ['qol-net-relay', 'qol-net-u-lobby-url']) {
    $(id).addEventListener('input', syncPreset);
  }

  // Four tabs over one config: the lists swap, the warn, file and Apply stay —
  // they are about the whole file, whichever part is being looked at.
  const TABS = ['qol', 'fixes', 'gameplay', 'network'] as const;
  const show = (tab: (typeof TABS)[number]): void => {
    for (const one of TABS) {
      $(one === 'qol' ? 'qol-list' : `qol-${one}`).hidden = one !== tab;
      $button(`qol-tab-${one}`).classList.toggle('on', one === tab);
    }
  };
  for (const tab of TABS) $button(`qol-tab-${tab}`).onclick = () => { show(tab); };
}
