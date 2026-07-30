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
    for (const e of entries.filter((x) => !q || x.label.toLowerCase().includes(q))) {
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
