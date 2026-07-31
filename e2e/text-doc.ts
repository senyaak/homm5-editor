// The plain-text document editor — what a reference's "New" and "✎" open.
//
// Creating a text file and PUTTING WORDS IN IT are two different acts, and only
// the first was ever automated: the helpers that point a sign or a quest at a
// file created it and closed the editor, which is a reference to an empty file.
// In the game that is the same nothing as no reference at all — the sign shows
// an empty box. So the text is typed here, through the editor a person types
// into, and saved.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Replace the open document's whole contents with `text` and save it. */
export async function writeDoc(page: Page, text: string): Promise<void> {
  await expect(page.locator('#docedit'), 'the text editor is open').toBeVisible();
  const content = page.locator('#de-text .cm-content');
  await content.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.locator('#de-save').click();
  await closeDoc(page);
}

/** Close the editor if it is open — saving leaves some documents on screen. */
export async function closeDoc(page: Page): Promise<void> {
  const doc = page.locator('#docedit');
  if (await doc.isVisible()) await page.locator('#de-close').click();
  await expect(doc).toBeHidden();
}
