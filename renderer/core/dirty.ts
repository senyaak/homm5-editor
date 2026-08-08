// The unsaved-changes flag, and what the bar shows for it.
//
// Every edit path ends in markDirty(true), so it lives where all of them can
// reach it rather than in whichever panel happened to declare it first.

import { $, $button } from '#core/dom.ts';

export let isDirty = false;

/**
 * Told whenever an edit lands, for the views that answer questions ABOUT the
 * map rather than showing it.
 *
 * The reachability wash is one: it is a statement about the map as it was when
 * the check ran, and after any edit it is a statement about a map that no
 * longer exists. Registered from the feature rather than called from here —
 * core does not know what features there are, and should not.
 */
type EditListener = () => void;
const listeners: EditListener[] = [];
export function whenEdited(fn: EditListener): void { listeners.push(fn); }

export function markDirty(v: boolean): void {
  isDirty = v;
  $('dirty').textContent = v ? '● unsaved changes' : '';
  $('dirty').className = v ? 'on' : '';
  $button('save').disabled = !v;
  // An edit just landed, so there is certainly something to undo and nothing
  // left to redo — the stack discards its redo tail on any new edit. Cheaper
  // and more immediate than asking the main process what it now holds; undo and
  // redo report the authoritative state themselves.
  if (v) {
    $button('undobtn').disabled = false;
    $button('undobtn').title = 'Undo (Ctrl+Z)';
    $button('redobtn').disabled = true;
    $button('redobtn').title = 'Nothing to redo';
    for (const fn of listeners) fn();
  }
}

/** Whether anything is unsaved — Close and Save both ask. */
export const dirty = (): boolean => isDirty;
