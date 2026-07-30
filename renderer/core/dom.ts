// Element lookups every panel and dialog in the renderer shares.
//
// Every id these take is hard-coded in index.html, so a miss is a typo caught on
// first load rather than a runtime condition worth handling at each call site —
// hence throwing accessors instead of `as HTMLInputElement` casts.

/** Look up an element the page is known to contain. */
export const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element #${id}`);
  return el;
};

/** Same, for the one <select> we drive. */
export const $select = (id: string): HTMLSelectElement => {
  const el = $(id);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`#${id} is not a select`);
  return el;
};

/** Same, for the buttons whose .disabled we set. */
export const $button = (id: string): HTMLButtonElement => {
  const el = $(id);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return el;
};

/** Same, for the inputs whose .value we read — checked, not cast. */
export const $input = (id: string): HTMLInputElement => {
  const el = $(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return el;
};

/** Set the text of a child the markup is known to contain. */
export const setChild = (root: HTMLElement, sel: string, text: string): void => {
  const el = root.querySelector(sel);
  if (el) el.textContent = text;
};

/** Fill a <select> with options, keeping `value` selected even if unknown. */
export function fillSelect(sel: HTMLSelectElement, opts: { id: string; label: string }[], value: string): void {
  sel.replaceChildren();
  if (value && !opts.some((o) => o.id === value)) opts = [{ id: value, label: value }, ...opts];
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.id;
    el.textContent = o.label;
    sel.appendChild(el);
  }
  sel.value = value;
}
