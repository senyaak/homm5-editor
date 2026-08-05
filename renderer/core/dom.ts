// Element lookups every panel and dialog in the renderer shares.
//
// Every id these take is hard-coded in the page (renderer/parts/), so a miss is a typo caught on
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

/**
 * Wire a button to work that TAKES TIME, so a second click cannot start a
 * second run of it.
 *
 * `onclick = () => { void doTheWork(); }` starts the work and forgets it. That
 * is fine for a millisecond of it and wrong for a minute: Apply in the settings
 * panel installs the extension and rewrites game profiles, and while it runs
 * the button sits there looking exactly as it did before it was pressed. Press
 * it again and a second Apply is writing the same files as the first — nothing
 * says otherwise, so the natural thing to do while waiting is press it again.
 *
 * So the button goes disabled for as long as the promise is unsettled and comes
 * back in a `finally` — including when the work throws, because a button that
 * stays dead after a failure is a panel somebody has to reopen.
 *
 * `busyText` is what it says meanwhile; without it the label is left alone.
 */
export function onClickAsync(id: string, work: () => Promise<void>, busyText?: string): void {
  const button = $button(id);
  button.onclick = () => {
    // Disabled buttons do not fire clicks, so this only catches a click that
    // was already queued — cheap, and the difference between a guard and a
    // guard that is actually airtight.
    if (button.disabled) return;
    const label = button.textContent;
    button.disabled = true;
    if (busyText) button.textContent = busyText;
    void work().finally(() => {
      button.disabled = false;
      if (busyText) button.textContent = label;
    });
  };
}

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
