// The Heroes window is a window over several things, and the tabs say which.
//
// It began as one list and grew a second beside it — heroes on the left,
// specializations on the right — which fit while there were two. There are four
// coming: a class of our own and a skill of our own are both authored here, and
// both belong to a hero for the same reason a specialization does. Four lists
// side by side is not a layout, so the window follows the Buildings one, whose
// tabs have carried five classes for a while (features/mods/buildings.ts).
//
// EACH SIDE REGISTERS ITSELF. A tab is not a list of names kept here that every
// new form has to be added to; it is a call the form makes from its own init,
// the same way everything else in the renderer is wired (a feature is connected
// by calling it, never by being named in a table someone else owns). So adding
// the classes tab is one line in the file that owns classes, and this file never
// learns what a class is.
//
// The order tabs appear in is the order they register, which is the order
// app.ts inits them.

import { $ } from '#core/dom.ts';

/** One side of the window. */
export interface HeroTab {
  /** Its own name, used as the tab's identity — not shown. */
  id: string;
  /** What the tab says. */
  label: string;
  /** One line under the tabs: what this side is, and what it costs the game. */
  about: string;
  /** The element id of the pane it shows. */
  pane: string;
  /** Called when this tab is opened — the moment to refresh its list. */
  onShow?: () => void;
}

const tabs: HeroTab[] = [];
/** Which tab is open. Kept between openings, as the Buildings window keeps its class. */
let active = '';

/** Add a side to the window. Called from the init of whatever owns it. */
export function registerHeroTab(tab: HeroTab): void {
  if (tabs.some((t) => t.id === tab.id)) return;
  tabs.push(tab);
  if (!active) active = tab.id;
}

/** Draw the bar and show the open tab's pane. Called when the window opens. */
export function drawHeroTabs(): void {
  const box = $('hm-tabs');
  box.innerHTML = '';
  if (!tabs.some((t) => t.id === active)) active = tabs[0]?.id ?? '';
  for (const t of tabs) {
    const button = document.createElement('button');
    button.className = 'mp-tab' + (t.id === active ? ' on' : '');
    button.textContent = t.label;
    button.title = t.about;
    button.onclick = () => { showHeroTab(t.id); };
    box.appendChild(button);
  }
  const open = tabs.find((t) => t.id === active);
  for (const t of tabs) $(t.pane).classList.toggle('on', t.id === active);
  $('hm-legend').textContent = `Installed — ${open?.label ?? ''}`;
  $('hm-about').textContent = open?.about ?? '';
  // The list is refreshed by the tab that owns it, and only the open one: a
  // window that reloaded all four every time it was shown would read the mod
  // list four times to draw one list.
  open?.onShow?.();
}

/** Open a tab by name. */
export function showHeroTab(id: string): void {
  active = id;
  drawHeroTabs();
}
