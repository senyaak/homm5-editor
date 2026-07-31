// One rule for every form that MAKES something: say what is missing before the
// press, not after the build.
//
// It lives in core rather than beside the mod forms because the campaign list
// and the New Map dialog want the same thing, and neither is a mod.

import { $, $button } from '#core/dom.ts';

/** What a control holds, whichever kind of control it is. */
const valueOf = (el: HTMLElement): string =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
    ? el.value.trim() : '';

/**
 * Hold a form's Save down until it has what the build will not go without.
 *
 * Every one of these forms ends in a channel that throws — no file stem, no
 * icon, no preset — and throwing happens AFTER the press, after a rebuild, as a
 * line of red under a form still holding everything that was typed. The form
 * knows the same rules, so it says so first: a star on the label, the names of
 * what is still missing under the buttons, and Save down until they are in.
 *
 * Marked is what makes the thing POINTLESS or impossible when it is empty — the
 * identifier that names its files, the preset a copy is made from, the name it
 * is listed under — never every field the record happens to have. A creature
 * with no description is a creature; a creature with no name is a blank row.
 *
 * `fields` maps what to call a thing to the control holding it. `extra` says
 * what a control cannot: a set of one member, a class's own required field.
 * `watch` is for controls a form draws and redraws — bind them again with the
 * returned `rewatch`.
 */
export function requireFilled(opt: {
  ok: string;
  missing: string;
  fields: Record<string, string>;
  extra?: () => string[];
  watch?: string;
}): { check: () => void; rewatch: () => void } {
  const check = (): void => {
    const missing = Object.entries(opt.fields)
      .filter(([, id]) => !valueOf($(id)))
      .map(([label]) => label);
    missing.push(...(opt.extra?.() ?? []));
    $(opt.missing).textContent = missing.length ? `still needed: ${missing.join(', ')}` : '';
    $button(opt.ok).disabled = missing.length > 0;
  };
  const bind = (el: HTMLElement): void => { el.oninput = check; el.onchange = check; };
  const rewatch = (): void => {
    for (const id of Object.values(opt.fields)) bind($(id));
    if (opt.watch) for (const el of document.querySelectorAll<HTMLElement>(opt.watch)) bind(el);
    check();
  };
  rewatch();
  return { check, rewatch };
}
