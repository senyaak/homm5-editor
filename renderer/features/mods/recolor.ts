// Recolouring a creature's textures.
//
// Preview and rewrite share src/recolor.ts, so the canvases show exactly what
// mods:recolor will write into the archive.

import { $, $input, $button } from '#core/dom.ts';
import { modDialog } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { recolorPixels } from '#src/recolor.ts';
import type { PaletteEntry, RecolorOps } from '#electron/ipc.ts';

let rcCreature = '';
let rcTextures: { path: string; width: number; height: number; img: HTMLImageElement }[] = [];
/** The textures' dominant colours, each with its swatch's colour input. */
let rcPalette: { entry: PaletteEntry; input: HTMLInputElement; original: string }[] = [];

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('could not decode a texture preview'));
  img.src = src;
});

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;

function currentRecolorOps(): RecolorOps {
  // Only the swatches moved away from their own colour take part.
  const to: Record<number, { r: number; g: number; b: number }> = {};
  rcPalette.forEach((s, i) => {
    if (s.input.value.toLowerCase() !== s.original) to[i] = hexToRgb(s.input.value);
  });
  return {
    ...(Object.keys(to).length ? { palette: { centres: rcPalette.map((s) => s.entry.hue), to } } : {}),
    hue: Number($input('rc-hue').value) || 0,
    saturation: (Number($input('rc-sat').value) || 0) / 100,
    lightness: (Number($input('rc-light').value) || 0) / 100,
    tint: { ...hexToRgb($input('rc-tint').value), strength: (Number($input('rc-tintk').value) || 0) / 100 },
  };
}

/** Build the swatch row: the colour as it is, and a picker for what it becomes. */
function renderRecolorPalette(palette: PaletteEntry[]): void {
  const box = $('rc-palette');
  box.innerHTML = '';
  rcPalette = [];
  for (const entry of palette) {
    const wrap = document.createElement('div');
    wrap.className = 'rc-swatch';
    const from = document.createElement('span');
    from.className = 'from';
    from.style.background = rgbToHex(entry.r, entry.g, entry.b);
    from.title = entry.hue < 0
      ? `neutral / grey — ${(entry.weight * 100).toFixed(0)}% of the pixels`
      : `hue ${Math.round(entry.hue)}° — ${(entry.weight * 100).toFixed(0)}% of the pixels`;
    const arrow = document.createElement('span');
    arrow.textContent = '→';
    const input = document.createElement('input');
    input.type = 'color';
    const original = rgbToHex(entry.r, entry.g, entry.b).toLowerCase();
    input.value = original;
    input.title = 'what this colour becomes — leave it to leave the cluster alone';
    input.addEventListener('input', renderRecolorPreviews);
    wrap.append(from, arrow, input);
    box.appendChild(wrap);
    rcPalette.push({ entry, input, original });
  }
  if (!palette.length) box.innerHTML = '<span class="um-empty">no visible colours found</span>';
}

function renderRecolorPreviews(): void {
  const box = $('rc-previews');
  box.innerHTML = '';
  const ops = currentRecolorOps();
  for (const t of rcTextures) {
    const canvas = document.createElement('canvas');
    canvas.width = t.width;
    canvas.height = t.height;
    canvas.title = t.path;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(t.img, 0, 0);
    const data = ctx.getImageData(0, 0, t.width, t.height);
    recolorPixels(data.data, ops);
    ctx.putImageData(data, 0, 0);
    box.appendChild(canvas);
  }
}

export async function openRecolor(creature: string, label: string): Promise<void> {
  rcCreature = creature;
  $('rc-title').textContent = `Recolor — ${label}`;
  $('rc-err').textContent = '';
  $('rc-note').textContent = '';
  $('rc-previews').textContent = 'reading the mod\'s textures…';
  modDialog('recolor').showModal();
  const { textures, palette } = await api.modTextures(creature);
  rcTextures = await Promise.all(textures.map(async (t) => ({
    path: t.path, width: t.width, height: t.height, img: await loadImage(t.png),
  })));
  renderRecolorPalette(palette);
  renderRecolorPreviews();
}

async function submitRecolor(): Promise<void> {
  const ok = $button('rc-ok');
  ok.disabled = true;
  $('rc-err').textContent = '';
  $('rc-note').textContent = '';
  try {
    const res = await api.recolorMod({ creature: rcCreature, ops: currentRecolorOps() });
    $('rc-note').textContent = `repainted ${res.textures} texture(s) → ${res.archive}`;
    // The previews now show the archive's new bytes, and the controls return
    // to neutral — a second pass starts from what is really there.
    const { textures, palette } = await api.modTextures(rcCreature);
    rcTextures = await Promise.all(textures.map(async (t) => ({
      path: t.path, width: t.width, height: t.height, img: await loadImage(t.png),
    })));
    $input('rc-hue').value = '0';
    $input('rc-sat').value = '100';
    $input('rc-light').value = '0';
    $input('rc-tintk').value = '0';
    renderRecolorPalette(palette);
    renderRecolorPreviews();
  } catch (e) {
    $('rc-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

for (const id of ['rc-hue', 'rc-sat', 'rc-light', 'rc-tint', 'rc-tintk']) {
  $input(id).addEventListener('input', renderRecolorPreviews);
}
$('rc-grey').onclick = () => {
  $input('rc-sat').value = '0';
  $input('rc-hue').value = '0';
  $input('rc-light').value = '0';
  $input('rc-tintk').value = '0';
  renderRecolorPreviews();
};
$('rc-close').onclick = () => modDialog('recolor').close();
$('rc-cancel').onclick = () => modDialog('recolor').close();
$('rc-ok').onclick = () => { void submitRecolor(); };
