/**
 * Pressing things in the top bar, now that most of them live under a menu.
 *
 * The bar shows one of two faces — the launcher's editors with no map open, the
 * map tools with one — and its commands are grouped under Map, View and
 * Properties. A menu is a popover, so what is under a closed one has no box on
 * screen and Playwright will not click it. Every spec that used to say
 * `page.locator('#save').click()` says `bar(page, '#save')` instead, and this is
 * the one place that knows which menu holds what: the answer is read off the
 * document, so moving a button between menus needs no change here or anywhere
 * else.
 */
import type { Page } from '@playwright/test';

/** The id of the menu holding `sel`, or null when it sits in the bar itself. */
async function menuOf(page: Page, sel: string): Promise<string | null> {
  const id = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { missing: true, id: null };
    return { missing: false, id: el.closest('[popover]')?.id ?? null };
  }, sel);
  if (id.missing) throw new Error(`${sel} is not in the document at all`);
  return id.id;
}

/**
 * Bring the menu holding `sel` down, so what it says can be read on screen.
 *
 * A no-op for a control that stands in the bar, which is what the panel toggles
 * and undo/redo do — a spec can call this without caring which it is.
 */
export async function openBarMenu(page: Page, sel: string): Promise<void> {
  const menu = await menuOf(page, sel);
  if (!menu) return;
  if (await page.locator(`#${menu}`).isVisible()) return;
  // Any OTHER menu goes down first, and not by clicking: with one already open
  // the bar behaves like a menu bar and follows the pointer, so Playwright's
  // click — which moves the mouse to the button before pressing it — would open
  // the wanted menu on the way in and then close it again on the press. Hiding
  // through the API touches no pointer and leaves nothing to race with.
  await page.evaluate(() => {
    for (const p of document.querySelectorAll<HTMLElement>('#bar .menupop:popover-open')) p.hidePopover();
  });
  await page.locator(`#bar [popovertarget="${menu}"]`).click();
}

/** Press a bar control, opening its menu first if it is under one. */
export async function bar(page: Page, sel: string): Promise<void> {
  await openBarMenu(page, sel);
  await page.locator(sel).click();
}
