// The hero form — the mod's third side, and the one that costs the game nothing.
//
// A creature moves a ceiling in the executable and an artifact extends a
// reference table; a hero does neither. He is three files at a path nobody
// owns, so this form installs without patching anything — which is why it has
// no ceiling line and no extension warning, unlike its two siblings.

import { $, $input, $select, $button, fillSelect } from '#core/dom.ts';
import { ask, modDialog, openOnTop } from '#core/dialog.ts';
import { api } from '#core/ipc.ts';
import { artLabels } from '#src/mods/heroes.ts';
import { pickPreset } from '#features/mods/preset.ts';
import { drawHeroTabs, registerHeroTab } from '#features/mods/hero-tabs.ts';
import { modRow, NL } from '#features/mods/shared.ts';
import { requireFilled } from '#core/form-gate.ts';
import type { ModListEntry, RosterEntryDTO } from '#electron/ipc.ts';

/**
 * What a hero cannot be built without.
 *
 * The channel says both in as many words — "the hero needs an identifier" and
 * "a preset is required — a new hero starts from the shape of a shipped one" —
 * which is exactly the pair worth saying BEFORE the press. The name is what
 * every screen he appears on shows.
 */
let heroGate: { check: () => void; rewatch: () => void } | null = null;
const gateHero = (): { check: () => void; rewatch: () => void } => (heroGate ??= requireFilled({
  ok: 'he-ok',
  missing: 'he-missing',
  fields: { identifier: 'he-id', name: 'he-name' },
  // A new hero is made from the shape of a shipped one; one already in the mod
  // has his own document and needs no preset to be saved again.
  extra: () => (!editingHero && !$input('he-preset').value.trim() ? ['preset'] : []),
}));

/** Which faction each class belongs to — the game pairs them one to one. */
const HERO_CLASS_OF_TOWN: Record<string, string> = {
  TOWN_HEAVEN: 'HERO_CLASS_KNIGHT',
  TOWN_PRESERVE: 'HERO_CLASS_RANGER',
  TOWN_ACADEMY: 'HERO_CLASS_WIZARD',
  TOWN_INFERNO: 'HERO_CLASS_DEMON_LORD',
  TOWN_NECROMANCY: 'HERO_CLASS_NECROMANCER',
  TOWN_DUNGEON: 'HERO_CLASS_WARLOCK',
  TOWN_FORTRESS: 'HERO_CLASS_RUNEMAGE',
  TOWN_STRONGHOLD: 'HERO_CLASS_BARBARIAN',
};

/** The same, for the hero form: a blank first entry is what "leave it to the
 *  donor" looks like in a dropdown over a closed set. */
function fillHeroSelect(id: string, opts: { id: string; label: string }[], optional = false): void {
  const el = $select(id);
  fillSelect(el, optional ? [{ id: '', label: '—' }, ...opts] : opts, el.value);
}

let heDonors: RosterEntryDTO[] = [];
/**
 * The form's own lists, while they are being filled.
 *
 * Anything that WRITES into those selects has to wait for it: the preset button
 * sets a faction and a class, and setting a select that has no options yet
 * silently does nothing — which showed up as a form that opened blank and a
 * preset that had visibly been chosen.
 */
let heFormReady: Promise<void> = Promise.resolve();

/** Everything the hero form is built from: the rosters and the type's own enums. */
async function fillHeroForm(): Promise<void> {
  // One call, and not `roster`/`specValues`: those read the open map's registry,
  // and a hero is authored with no map in sight — exactly like a creature or an
  // artifact, which is why this payload exists at all.
  const form = await api.modFormData();
  const heroes = form.heroDonors;
  const skills = form.skills.map((e) => ({ id: e.id, label: e.name || e.id }));
  const spells = form.spells.map((e) => ({ id: e.id, label: e.name || e.id }));
  const values = form.heroEnums;

  // The presets themselves are not a control any more — the button opens a
  // searchable list — but the roster is kept here, because the picker labels
  // its rows from it and heroPresetChanged reads a faction off it.
  heDonors = heroes;

  const asOptions = (v: string[] = []): { id: string; label: string }[] => v.map((id) => ({ id, label: id }));
  fillHeroSelect('he-town', asOptions(values.TownType));
  // The game's nine classes and its 221 skills come out of types.xml as the
  // EDITOR reads it — the game's own copy, where a class of the mod does not
  // exist. Ours live only in the archive's copy, so without this a hero could
  // not be given the class or the racial he was made for.
  const ours = (await api.listMods()).mods;
  fillHeroSelect('he-class', [
    ...asOptions(values.Class),
    ...ours.flatMap((m) => m.classes ?? []).map((c) => ({ id: c.id, label: `${c.name || c.id} (ours)` })),
  ]);
  // The game's 84 specializations, and ours after them — same reason.
  const own = ours.flatMap((m) => m.specializations ?? []);
  fillHeroSelect('he-spec', [
    ...asOptions(values.Specialization),
    ...own.map((s) => ({ id: s.id, label: `${s.name || s.id} (ours)` })),
  ], true);

  // Skills and perks come out of one table (Skills.xdb holds both), so both
  // pickers are offered the whole of it rather than a guess at which is which —
  // and ours are appended for the third time, for the third copy of the reason.
  const allSkills = [
    ...skills,
    ...ours.flatMap((m) => m.skills ?? []).map((k) => ({ id: k.id, label: `${k.name || k.id} (ours)` })),
  ];
  fillHeroSelect('he-primary', allSkills, true);
  fillHeroSelect('he-skill', allSkills, true);
  fillHeroSelect('he-perk', allSkills, true);
  fillHeroSelect('he-spell', spells, true);

  // Appearance: what the shipped heroes actually wear in each slot. The label
  // is the file's own name — a full href in a dropdown is unreadable, and the
  // value carries the href anyway.
  for (const [slot, id] of Object.entries(HE_ART_FIELDS)) {
    const hrefs = form.heroArt[slot] ?? [];
    // Labelled against the OTHERS in the same slot: every Selection model is
    // called Symbol, and eight rows saying "Symbol" are eight rows nobody can
    // choose between. artLabels() grows each label leftwards until they differ.
    const labels = artLabels(hrefs);
    heArtLabels.set(slot, labels);
    fillHeroSelect(id, hrefs.map((href) => ({ id: href, label: labels.get(href) ?? href })), true);
    // The full path on hover: the label says which one, this says what it is.
    for (const option of $select(id).options) if (option.value) option.title = option.value;
  }
}

/** Which control holds which art slot — the same slots src/heroes.ts names. */
const HE_ART_FIELDS: Record<string, string> = {
  model: 'he-model', animSet: 'he-animset', arena: 'he-arena', arenaMelee: 'he-arena-melee',
  adventure: 'he-adventure', combatVisual: 'he-combat', selection: 'he-selection',
  trace: 'he-trace', camera: 'he-camera', icon128: 'he-icon128', music: 'he-music',
  face: 'he-face', faceSmall: 'he-face-small', specializationIcon: 'he-spec-icon',
};

/** The labels each slot's options carry, so a file added later matches them. */
const heArtLabels = new Map<string, Map<string, string>>();

/** An href as a person reads it: the file's name, without the pointer. */
function artLabel(href: string): string {
  return href.split('#')[0]!.split('/').pop()!.replace(/\.\([^)]*\)\.xdb$/i, '').replace(/\.xdb$/i, '');
}

/**
 * The preset seeds the form: faction, class, and every appearance field.
 *
 * Seeds, and nothing more — each control stays editable afterwards, and what
 * the hero is built from is what the controls hold, not what was picked here.
 */
async function heroPresetChanged(): Promise<void> {
  await heFormReady;
  const preset = $input('he-preset').value;
  const entry = heDonors.find((h) => h.id === preset);
  const town = [...$select('he-town').options].map((o) => o.value)
    .find((t) => entry?.group && t.toLowerCase().includes(entry.group.toLowerCase()));
  if (town) $select('he-town').value = town;
  heroTownChanged();

  // And his looks, slot by slot. A preset the data cannot be read for leaves
  // the fields as they were rather than blanking them.
  const art = await api.heroArtOf(preset).catch(() => ({} as Record<string, string>));
  for (const [slot, id] of Object.entries(HE_ART_FIELDS)) {
    const href = art[slot];
    if (!href) continue;
    const el = $select(id);
    if (![...el.options].some((o) => o.value === href)) el.append(new Option(artLabel(href), href));
    el.value = href;
  }
}

/** One class per faction, so picking a faction picks the class with it. */
function heroTownChanged(): void {
  const cls = HERO_CLASS_OF_TOWN[$select('he-town').value];
  if (cls && [...$select('he-class').options].some((o) => o.value === cls)) $select('he-class').value = cls;
}

/** The installed heroes, as the list inside the dialog shows them. */
function renderHeroList(mods: ModListEntry[]): void {
  const box = $('hm-list');
  box.innerHTML = '';
  const heroes = mods.flatMap((m) => (m.heroes ?? []).map((h) => ({ ...h, stem: m.stem })));
  if (!heroes.length) {
    box.textContent = 'No heroes installed. A hero costs the game nothing: no id, no ceiling, no patched executable.';
    return;
  }
  heroes.forEach((h, i) => {
    const where = h.scenarioHero ? 'placed by hand only' : 'offered by taverns';
    const row = modRow({
      number: i + 1,
      label: `${h.name || h.id} (${h.town.replace('TOWN_', '').toLowerCase()})`,
      note: where,
      onEdit: () => { void editHero(h.id); },
      onRemove: () => { void removeHeroWithWarning(h.id, h.name || h.id); },
    });
    row.title = `${h.id}${h.specialization ? ` · ${h.specialization}` : ''}`;
    box.append(row);
  });
}

/** The hero being changed, or '' when the form is making a new one. */
let editingHero = '';

/** Load an installed hero back into the form, every field of him. */
async function editHero(id: string): Promise<void> {
  const { mods } = await api.listMods();
  const h = mods.flatMap((m) => m.heroes ?? []).find((x) => x.id === id);
  if (!h) return;
  editingHero = id;
  $('he-err').textContent = '';
  heOwnFiles = {};
  $('heroedit-title').textContent = `Edit ${h.name || h.id}`;
  modDialog('heroedit').showModal();
  heFormReady = fillHeroForm();
  await heFormReady;

  // The identifier is what he IS — a campaign carries him by it and a map's
  // roster names his path — so changing one is making a different hero.
  $input('he-id').value = h.id;
  $input('he-id').disabled = true;
  $input('he-name').value = h.name;
  $input('he-bio').value = h.biography ?? '';
  $select('he-town').value = h.town;
  $select('he-class').value = h.heroClass;
  $select('he-spec').value = h.specialization ?? '';
  $input('he-spec-name').value = h.specializationName ?? '';
  $input('he-spec-desc').value = h.specializationDescription ?? '';
  const preset = h.basedOn ? `/${h.basedOn}#xpointer(/AdvMapHeroShared)` : '';
  $input('he-preset').value = preset;
  $('he-preset-name').textContent = h.basedOn ? h.basedOn.split('/').pop()!.replace(/\.\([^)]*\)\.xdb$/, '') : 'none';
  $select('he-primary').value = h.primarySkill?.skill ?? '';
  $select('he-primary-mastery').value = h.primarySkill?.mastery ?? 'MASTERY_BASIC';
  $input('he-off').value = String(h.stats?.offence ?? 0);
  $input('he-def').value = String(h.stats?.defence ?? 0);
  $input('he-sp').value = String(h.stats?.spellpower ?? 0);
  $input('he-kn').value = String(h.stats?.knowledge ?? 0);
  $select('he-skill').value = h.skills?.[0]?.skill ?? '';
  $select('he-skill-mastery').value = h.skills?.[0]?.mastery ?? 'MASTERY_BASIC';
  $select('he-perk').value = h.perks?.[0] ?? '';
  $select('he-spell').value = h.spells?.[0] ?? '';
  $input('he-ballista').checked = !!h.machines?.ballista;
  $input('he-tent').checked = !!h.machines?.firstAidTent;
  $input('he-ammo').checked = !!h.machines?.ammoCart;
  $input('he-scenario').checked = !!h.scenarioHero;
  // The pictures he was built from, carried back like everything else: a form
  // that shows a record has to show ALL of it, or saving writes back whatever
  // the box happened to hold (docs/CONTENT_FORMS.md §2).
  $input('he-portrait-pic').value = h.portrait ?? '';
  $input('he-spec-pic').value = h.specializationPicture ?? '';
  // His looks as he was BUILT, not as the preset would seed them: an edit that
  // silently put the preset's model back would undo a choice without a word.
  for (const [slot, id2] of Object.entries(HE_ART_FIELDS)) {
    const href = (h.art ?? {})[slot] ?? (slot === 'face' ? h.face : slot === 'faceSmall' ? h.faceSmall
      : slot === 'specializationIcon' ? h.specializationIcon : '') ?? '';
    const el = $select(id2);
    if (href && ![...el.options].some((o) => o.value === href)) el.append(new Option(artLabel(href), href));
    el.value = href;
  }
  gateHero().rewatch();
}

/** Ask what would break, show it, and only then remove. */
async function removeHeroWithWarning(id: string, label: string): Promise<void> {
  const { uses } = await api.heroUses({ id });
  const shown = uses.slice(0, 12).join(NL);
  const more = uses.length > 12 ? `${NL}… and ${uses.length - 12} more` : '';
  const warning = uses.length
    ? `${label} is reached by ${uses.length} map(s):${NL}${NL}${shown}${more}${NL}${NL}`
      + 'They will stop resolving him. Remove anyway?'
    : `Remove ${label}? No map reaches him.`;
  if (!await ask(warning, 'Remove')) return;
  try {
    await api.removeHero({ id });
    await refreshHeroList();
    $('hm-note').textContent = `${label} removed.`;
  } catch (e) {
    $('hm-err').textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Build the hero and install him, then go back to the list that now holds him. */
async function submitHeroMod(): Promise<void> {
  const ok = $button('he-ok');
  ok.disabled = true;
  $('he-err').textContent = '';
  $('hm-note').textContent = '';
  try {
    const skill = $select('he-skill').value;
    const perk = $select('he-perk').value;
    const spell = $select('he-spell').value;
    const primary = $select('he-primary').value;
    const send = editingHero ? api.updateHero : api.installHero;
    const res = await send({
      id: $input('he-id').value,
      name: $input('he-name').value,
      biography: $input('he-bio').value,
      basedOn: $input('he-preset').value,
      town: $select('he-town').value,
      heroClass: $select('he-class').value,
      ...($select('he-spec').value ? { specialization: $select('he-spec').value } : {}),
      ...($input('he-spec-name').value ? { specializationName: $input('he-spec-name').value } : {}),
      ...($input('he-spec-desc').value ? { specializationDescription: $input('he-spec-desc').value } : {}),
      ...(primary ? { primarySkill: { skill: primary, mastery: $select('he-primary-mastery').value } } : {}),
      stats: {
        Offence: Number($input('he-off').value) || 0,
        Defence: Number($input('he-def').value) || 0,
        Spellpower: Number($input('he-sp').value) || 0,
        Knowledge: Number($input('he-kn').value) || 0,
      },
      ...(skill ? { skills: [{ skill, mastery: $select('he-skill-mastery').value }] } : {}),
      ...(perk ? { perks: [perk] } : {}),
      ...(spell ? { spells: [spell] } : {}),
      machines: {
        ballista: $input('he-ballista').checked,
        firstAidTent: $input('he-tent').checked,
        ammoCart: $input('he-ammo').checked,
      },
      scenarioHero: $input('he-scenario').checked,
      ...($select('he-face').value ? { face: $select('he-face').value } : {}),
      ...($select('he-face-small').value ? { faceSmall: $select('he-face-small').value } : {}),
      ...($select('he-spec-icon').value ? { specializationIcon: $select('he-spec-icon').value } : {}),
      // A picture wins over the href beside it: it is the more specific answer
      // to the same question, and the builder points him at what it makes.
      ...($input('he-portrait-pic').value.trim() ? { portrait: $input('he-portrait-pic').value.trim() } : {}),
      ...($input('he-spec-pic').value.trim() ? { specializationPicture: $input('he-spec-pic').value.trim() } : {}),
      // Appearance rides as one object: the fields are all the same shape, and
      // the builder leaves any slot the form did not fill as the preset has it.
      ...(Object.keys(heOwnFiles).length ? { ownFiles: heOwnFiles } : {}),
      art: Object.fromEntries(Object.entries(HE_ART_FIELDS)
        .filter(([slot]) => !['face', 'faceSmall', 'specializationIcon'].includes(slot))
        .map(([slot, id]) => [slot, $select(id).value])
        .filter(([, href]) => href)),
    });
    modDialog('heroedit').close();
    await refreshHeroList();
    // The href is the useful part of the result: it is what a map's roster, a
    // pool or a placed hero has to point at, and nothing else reveals it.
    $('hm-note').textContent = `${editingHero ? 'Updated' : 'Installed'} in `
      + `${res.archive.split(/[\\/]/).pop()} — ${res.href}`;
  } catch (e) {
    $('he-err').textContent = e instanceof Error ? e.message : String(e);
  } finally {
    ok.disabled = false;
  }
}

async function refreshHeroList(): Promise<void> {
  const { mods } = await api.listMods();
  renderHeroList(mods);
}

/**
 * Files the author brought, by the href they will answer to in the mod.
 *
 * Kept beside the form rather than copied on the spot: a form that is cancelled
 * must leave nothing behind, so the copying happens when the hero is built.
 */
let heOwnFiles: Record<string, string> = {};

/** Bind the hero list and form to their markup. */
export function initHeroesMod(): void {
  // The window's first tab. Registered here rather than listed in hero-tabs.ts,
  // so the file that owns heroes is the only one that has to know they exist.
  registerHeroTab({
    id: 'heroes',
    label: 'Heroes',
    about: 'A hero costs the game nothing global: no id, no ceiling, no patched executable.',
    pane: 'hm-pane-heroes',
    onShow: () => {
      void refreshHeroList().catch((e: unknown) => {
        $('hm-err').textContent = e instanceof Error ? e.message : String(e);
      });
    },
  });

  $('heroesbtn').onclick = () => {
    $('hm-err').textContent = '';
    $('hm-note').textContent = '';
    modDialog('heroesmod').showModal();
    const report = (e: unknown): void => {
      $('hm-err').textContent = e instanceof Error ? e.message : String(e);
    };
    // The bar refreshes the OPEN tab's list; the form's own selects are filled
    // whichever tab that is, because the hero form is opened from the list and
    // from an edit alike.
    drawHeroTabs();
    heFormReady = fillHeroForm();
    void heFormReady.catch(report);
  };
  $('hm-close').onclick = () => modDialog('heroesmod').close();
  $('hm-cancel').onclick = () => modDialog('heroesmod').close();
  $('hm-new').onclick = () => {
    $('he-err').textContent = '';
    heOwnFiles = {};
    editingHero = '';
    $('heroedit-title').textContent = 'New hero';
    $input('he-id').disabled = false;
    $input('he-id').value = '';
    $input('he-preset').value = '';
    $input('he-name').value = '';
    // New clears the pictures too, or the next hero is built with this one's
    // face — the same trap the creature's preset fell into.
    $input('he-portrait-pic').value = '';
    $input('he-spec-pic').value = '';
    $('he-preset-name').textContent = 'nothing yet — the form is blank';
    gateHero().rewatch();
    modDialog('heroedit').showModal();
    // Fill the form's own lists HERE rather than relying on the list dialog
    // having done it: opening the form is what needs them, and the preset button
    // writes into selects that must already have their options.
    heFormReady = fillHeroForm();
    void heFormReady.catch((e: unknown) => {
      $('he-err').textContent = e instanceof Error ? e.message : String(e);
    });
  };
  $('heroedit-x').onclick = () => modDialog('heroedit').close();
  $('heroedit-cancel').onclick = () => modDialog('heroedit').close();
  $('he-ok').onclick = () => { void submitHeroMod(); };


  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.he-file')) {
    btn.onclick = () => {
      const target = btn.dataset.for!;
      const slot = Object.entries(HE_ART_FIELDS).find(([, id]) => id === target)?.[0] ?? target;
      void (async () => {
        const picked = await api.pickHeroFile({ id: $input('he-id').value.trim(), slot });
        if (!picked.href) return; // cancelled
        heOwnFiles[picked.href] = picked.from;
        const el = $select(target);
        // Offered under the name it came with, and chosen: a file picked and then
        // silently not used would be the worst of both.
        if (![...el.options].some((o) => o.value === picked.href)) {
          el.append(new Option(`${artLabel(picked.href)} (yours)`, picked.href));
        }
        el.value = picked.href;
      })().catch((e) => { $('he-err').textContent = e instanceof Error ? e.message : String(e); });
    };
  }
  // A picture is chosen by PATH and kept as one: the texture is built when the
  // hero is, so the same drawing can be re-read after it is edited, and a
  // checkout that carries `assets/` builds the same face on any machine.
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.he-picture')) {
    btn.onclick = () => {
      void (async () => {
        const picked = await api.pickPicture();
        if (picked) $input(btn.dataset.for!).value = picked;
      })().catch((e) => { $('he-err').textContent = e instanceof Error ? e.message : String(e); });
    };
  }
  $select('he-town').addEventListener('change', heroTownChanged);


  $('he-preset-pick').onclick = () => {
    void (async () => {
      const heroes = (await api.modFormData()).heroDonors;
      pickPreset('Start this hero from', heroes.map((h) => ({
        id: h.id,
        label: h.group ? `${h.group} — ${h.name ?? h.id}` : (h.name ?? h.id),
      })), (id, label) => {
        $input('he-preset').value = id;
        $('he-preset-name').textContent = label;
        void heroPresetChanged().then(() => gateHero().check()).catch(() => {});
        gateHero().check();
      });
    })().catch((e) => { $('he-err').textContent = e instanceof Error ? e.message : String(e); });
  };
}
