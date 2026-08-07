// The preset picker shared by the creature, artifact and hero forms.
//
// A preset is an action, not a property: press it once and every field below is
// filled in, then edit whatever you like. As a select sitting in the form it
// read as "this thing's donor" — the very idea the hero form stopped having,
// where the donor was a hidden source nobody could see the effects of.
//
// One picker for all of them, because it is the same question: which shipped
// thing should this start from. A searchable list rather than a dropdown, since
// the hero list alone is 118 long.

import { $, $input } from '#core/dom.ts';
import { modDialog } from '#core/dialog.ts';

/** Where the picker puts its answer, and what it does with it. */
let ppChoose: ((id: string, label: string) => void) | null = null;

/** How many rows are built at once — see the note in `draw` below. */
const SHOWN = 250;

/** Open the picker over a list of things to start from. */
export function pickPreset(
  title: string,
  entries: { id: string; label: string }[],
  chosen: (id: string, label: string) => void,
): void {
  $('pp-title').textContent = title;
  ppChoose = chosen;
  const search = $input('pp-search');
  search.value = '';
  const draw = (): void => {
    const q = search.value.trim().toLowerCase();
    const box = $('pp-list');
    box.innerHTML = '';
    const hits = entries.filter((x) => !q || x.label.toLowerCase().includes(q));
    // The lists this picker was written for are a hundred long; the object
    // catalogue is two thousand, and building all of them as buttons is a
    // visible pause on every keystroke. Showing a page and saying how much is
    // left keeps the search the way to reach the rest, which it already was.
    for (const e of hits.slice(0, SHOWN)) {
      const row = document.createElement('button');
      row.className = 'um-mod';
      row.style.cssText = 'display:block;width:100%;text-align:left';
      row.textContent = e.label;
      row.onclick = () => {
        modDialog('presetpick').close();
        ppChoose?.(e.id, e.label);
      };
      box.append(row);
    }
    if (hits.length > SHOWN) {
      const more = document.createElement('div');
      more.style.cssText = 'color:#6e7681;font-size:11px;padding:6px 2px';
      more.textContent = `+${hits.length - SHOWN} more — narrow the search`;
      box.append(more);
    }
    if (!hits.length) {
      const none = document.createElement('div');
      none.style.cssText = 'color:#6e7681;font-size:11px;padding:6px 2px';
      none.textContent = 'nothing matches';
      box.append(none);
    }
  };
  search.oninput = draw;
  draw();
  modDialog('presetpick').showModal();
  search.focus();
}

/** Bind the picker dialog to its markup. */
export function initPresetPicker(): void {
  $('pp-x').onclick = () => modDialog('presetpick').close();
  $('pp-cancel').onclick = () => modDialog('presetpick').close();
}
