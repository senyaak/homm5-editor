// The <dialog> primitives every form and question in the editor is built on.
//
// Native <dialog> throughout: the UA centres it, handles the backdrop, Esc and
// focus, and a test can read it. Never `confirm()`/`alert()`/`prompt()` — in
// Electron those are native windows that block the renderer, so a spec that
// reaches one waits for a click nobody will make and dies by timeout.

import { $, $button } from '#core/dom.ts';

/** The error line belonging to each form, as opposed to its list's. */
const FORM_ERR: Record<string, string> = {
  unitedit: 'ue-err', artedit: 'ae-err', setedit: 'as-err', classedit: 'hc-err', skilledit: 'hk-err',
};

/** The dialog with this id — checked, so a wrong id fails where it is written. */
export function modDialog(id: string): HTMLDialogElement {
  const el = $(id);
  if (!(el instanceof HTMLDialogElement)) throw new Error(`#${id} is not a <dialog>`);
  return el;
}

/**
 * Open a form over its list, with its own error slot wiped.
 *
 * Shows the dialog whether or not it is already up: `showModal()` on an open
 * dialog throws, and the throw lands in a click handler where nothing catches
 * it — the form then stays as it was and looks like a button that does nothing.
 *
 * Each form dialog has an error line of its own (`ue-err`, `ae-err`, `as-err`)
 * — the list behind it has another, and they must not share an id: with two
 * `um-err` in the document, `$('um-err')` answered with the list's, so every
 * message the form ever wrote landed on a dialog the user could not see.
 */
export function openOnTop(id: string): void {
  const dialog = modDialog(id);
  const err = FORM_ERR[id];
  if (err) $(err).textContent = '';
  if (!dialog.open) dialog.showModal();
}

/**
 * Ask before something irreversible — in a dialog of ours, never `confirm()`.
 *
 * One dialog for all of them, because a question is a question; the caller
 * supplies the words and, when the button should say something sharper than
 * "Yes", its label. It stacks over whatever is open, and Esc answers no.
 */
export function ask(question: string, yes = 'Yes'): Promise<boolean> {
  const dialog = modDialog('ask');
  $('ask-text').textContent = question;
  $button('ask-yes').textContent = yes;
  if (!dialog.open) dialog.showModal();
  return new Promise<boolean>((resolve) => {
    const done = (answer: boolean): void => {
      dialog.removeEventListener('cancel', onCancel);
      $('ask-yes').onclick = null;
      $('ask-no').onclick = null;
      $('ask-x').onclick = null;
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    // Esc closes a <dialog> without touching our buttons, and it means no.
    const onCancel = (): void => done(false);
    dialog.addEventListener('cancel', onCancel, { once: true });
    $('ask-yes').onclick = () => done(true);
    $('ask-no').onclick = () => done(false);
    $('ask-x').onclick = () => done(false);
  });
}
