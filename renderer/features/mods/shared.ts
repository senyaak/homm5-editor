// Pieces every mod form shares: the installed-list row, and a newline that
// survives being written into a template.

/** A row in an installed list: what it is, and the two things you can do. */
export function modRow(
  { number, label, note, onEdit, onRemove }:
  { number: number; label: string; note?: string; onEdit: () => void; onRemove: () => void },
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'um-item';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(number);
  const text = document.createElement('span');
  text.className = 'grow';
  text.textContent = label;
  if (note) {
    const i = document.createElement('i');
    i.textContent = ` · ${note}`;
    text.appendChild(i);
  }
  const edit = document.createElement('button');
  edit.className = 'um-recolor';
  edit.textContent = '✎';
  edit.title = 'load it into the form below and change it';
  edit.onclick = onEdit;
  const drop = document.createElement('button');
  drop.className = 'um-recolor';
  drop.textContent = '×';
  drop.title = 'remove it from the mod';
  drop.onclick = onRemove;
  row.append(num, text, edit, drop);
  return row;
}

/** A literal newline. Written as an escape it would be eaten by the template
 *  the warning text is built with, which is how a multi-line question once
 *  reached the dialog as one long run-on line. */
export const NL = String.fromCharCode(10);
