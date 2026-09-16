// The generator's tables, read out of the executable — nothing copied.
//
// The random map generator carries a dozen small tables in its code: the
// shrine hrefs and their costs, the nine treasure documents, the seven mines
// and their piles, the size ladder, the sea depth by size, the race lists a
// SPECIAL zone draws from, the lake gate, the substrings that earn a static a
// point light, the three dwellings a minimap never flags. The port used to
// hold each one as a literal transcribed at reverse-engineering time. It now
// holds none: this module finds every table in the image the way
// `tools/reverse/rmg-map.ts` finds the phases — by the generator's own log
// strings, by RTTI, by a byte pattern — and decodes the values from the
// instructions that use them. An executable the extension has patched (a
// ninth race in the draw lists, a fourth shrine) is read as patched, which is
// the whole point.
//
// LANDMARKS, NEVER ADDRESSES. Every locator here starts from something that
// survives a recompilation: a literal the code references, a class name in
// the RTTI, the shape of a function. `tools/test-rmg-tables.ts` holds the
// decoding to the vanilla game's values.
//
// The game's image is the one read. The editor's build of the generator is
// the same source compiled differently — `push_back` inlined, constants kept
// in registers — and its tables are the same, but the decoders below follow
// the game's instruction shapes and are not asked to follow the editor's.

import { disassemble } from './disasm.ts';
import type { Instruction } from './disasm.ts';
import { PEFile } from './pe.ts';
import type { Section } from './pe.ts';

export interface RmgExeTables {
  /** Shrines, in the table's order, with the cost the step budgets each at. */
  shrines: ReadonlyArray<{ href: string; cost: number }>;
  /** The nine treasure documents `below(9)` indexes. */
  treasures: readonly string[];
  /** The seven mines in placement order, each with the pile it drops beside. */
  mines: ReadonlyArray<{ href: string; pile: string }>;
  /** The type index the step guards at the gold level — the literal it compares against. */
  goldMineType: number;
  /** The random-towns town prototype and the seven tier stand-ins. */
  randomTown: string;
  randomDwellings: readonly string[];
  prison: string;
  cartographer: string;
  shipyard: string;
  monolith: string;
  gateIn: string;
  gateOut: string;
  observatory: string;
  denOfThieves: string;
  armyTemplateGroup: string;
  /** The seven resource piles a treasure block draws from, and the chest it stacks. */
  blockResources: readonly string[];
  blockChest: string;
  /** The minimap's icon list document. */
  minimapIcons: string;
  /** The birds document the map-setup step hangs on a map when its draw says so. */
  birds: string;
  /** Tile counts by size index. */
  mapSizes: readonly number[];
  /** A size index in the template's units. */
  sizeUnits: readonly number[];
  /** The other way: units below each threshold map to that index. */
  unitsToSize: readonly number[];
  /** Sea depth by size index, and the depth an index past the table gets. */
  waterDepth: { table: readonly number[]; fallback: number };
  /** The upgrade-buildings density multipliers, indexed by generator+0xB0. */
  densityMultipliers: readonly number[];
  /** The race enum as the executable numbers it, by name. */
  raceEnum: Readonly<Record<string, number>>;
  /** LoadTemplate's draw lists. */
  surfaceRaces: readonly number[];
  /** The race a one-floor map adds to the surface list. */
  surfaceRaceWhenOneFloor: number | null;
  undergroundRaces: readonly number[];
  /** The list a RANDOM player slot draws from, and its length. */
  slotRaceList: readonly number[];
  /** Races whose surface zones grow lakes. */
  lakeRaces: readonly number[];
  /** Per subterranean zone class, the resource-name substrings that earn a point light. */
  lightNames: Readonly<Record<string, readonly string[]>>;
  /** Dwelling `Type` values the minimap never flags. */
  unflaggableDwellingTypes: readonly number[];
  /** Creature ids the one-stack guard branch skips. */
  unplaceableCreatures: readonly number[];
}

/** Read every table from the game executable. */
export function readRmgExeTables(exePath: string): RmgExeTables {
  return new Reader(PEFile.read(exePath)).read();
}

const PADDING = 2;

class Reader {
  private readonly text: Section;
  private readonly code: Buffer;
  private readonly codeLo: number;
  private readonly bodies = new Map<number, Instruction[]>();

  private readonly pe: PEFile;

  constructor(pe: PEFile) {
    this.pe = pe;
    this.text = pe.section('.text');
    this.code = pe.bytesOf(this.text);
    this.codeLo = pe.imageBase + this.text.va;
  }

  read(): RmgExeTables {
    const generateMap = this.functionWithString('Rnd Counter (GenerateMap)');
    const fillLoop = this.functionWithString('upgrade buildings in zone %d set');

    const shrineStep = this.functionWithString('Cant set shrine %s in zone %d');
    const shrineHrefs = this.stringRun(this.slotsOf(shrineStep)[0]!);
    const shrines = this.shrineCosts(shrineStep, shrineHrefs);

    const treasureStep = this.functionWithString("Can't place treasure %s at zone");
    const treasures = this.treasureRun(treasureStep);

    const mineStep = this.functionWithString('cant place mine %s at zone %d');
    const mineRuns = this.slotsOf(mineStep).map((s) => this.stringRun(s));
    const mineHrefs = mineRuns.find((r) => r[0]!.includes('(AdvMapMineShared)'));
    const pileHrefs = mineRuns.find((r) => r[0]!.includes('(AdvMapTreasureShared)'));
    if (!mineHrefs || !pileHrefs || mineHrefs.length !== pileHrefs.length) {
      throw new Error('mines step: expected a mine run and a pile run of the same length');
    }
    const mines = mineHrefs.map((href, i) => ({ href, pile: pileHrefs[i]! }));
    // The gold gate: the one compare of a stack slot against a small literal
    // that a `jne` follows and that is not the near-ring's `cmp ecx,1`.
    const goldMineType = this.stackCompareBefore(mineStep, 'jne', mines.length);

    const dwellingStep = this.functionWithString("Can't place dwelling %s at zone");
    const randomDwellings = this.stringRun(this.slotsOf(dwellingStep)[0]!);

    const [prisonWorker] = this.callsBeforeString(fillLoop, 'prisons in zone %d set');
    const [cartographerWorker] = this.callsBeforeString(fillLoop, 'cartographer in zone %d set');
    const prison = this.stringGlobal(this.slotsOf(prisonWorker!)[0]!);
    const cartographer = this.stringGlobal(this.slotsOf(cartographerWorker!)[0]!);

    const teleportPass = this.functionWithString('cant find empty tiles to set teleport');
    const teleportSlots = this.slotsOf(teleportPass, true);
    if (teleportSlots.length !== 3) throw new Error(`teleport pass: expected 3 documents, found ${teleportSlots.length}`);
    const [gateIn, gateOut, monolith] = teleportSlots.map((s) => this.stringGlobal(s)) as [string, string, string];

    // Two placers log "Can't place building"; the observatories' one is the one that names documents of its own.
    const treasureBuildingsCandidates = this.functionsWithString("Can't place building %s at zone").filter((f) => this.slotsDeep(f).length >= 2);
    if (treasureBuildingsCandidates.length !== 1) throw new Error(`observatories: ${treasureBuildingsCandidates.length} placers name documents, expected one`);
    const treasureBuildings = treasureBuildingsCandidates[0]!;
    const [observatory, denOfThieves] = this.slotsDeep(treasureBuildings).map((s) => this.stringGlobal(s));
    if (!observatory || !denOfThieves) throw new Error(`treasure buildings 0x${treasureBuildings.toString(16)}: expected two documents, slots ${this.slotsDeep(treasureBuildings).map((s) => s.toString(16)).join(' ')}, callees ${this.calleesOf(treasureBuildings).map((s) => s.toString(16)).join(' ')}`);

    // The water zone's connections override runs the base pass, then tail-jumps
    // into the shipyard placer — the one document of its own kind it names.
    const waterZone = this.vtable('.?AVCGameWaterBorderedZone@NRMG@@');
    const shipyard = this.stringWithTag([this.slot(waterZone, 0x2c)], 'AdvMapShipyardShared', true);

    // The subterranean zones' vt+0x20 hands the town step the document to
    // build from: the preset's town, or the random town when the order says so.
    const subterra = this.vtable('.?AVCGameSubterraZone@NRMG@@');
    const townChooser = this.calleesOf(this.slot(subterra, 0x20))[0];
    if (townChooser === undefined) throw new Error('subterranean zone: vt+0x20 calls nothing');
    const randomTown = this.stringWithTag([townChooser], 'AdvMapTownShared', false);

    // Shrines take no guard; the mines and the teleports both call the guard setter.
    const setMonster = this.commonCallee(mineStep, teleportPass, (fn) => this.calleesOf(fn).some((c) => this.slotsOf(c).length > 0));
    const templateBranch = this.calleesOf(setMonster).find((c) => this.slotsOf(c).length > 0)!;
    const armyTemplateGroup = this.stringGlobal(this.slotsOf(templateBranch)[0]!);
    const unplaceableCreatures = this.creatureSkips(setMonster);

    // The treasure-block distributor names the seven resource piles as a run
    // and the chest on its own; the string it logs is shared by its two halves.
    const blockSlots = new Set<number>();
    for (const fn of this.functionsWithString('in zone with town at %d:%d we got %d treasure blocks')) {
      for (const s of this.slotsDeep(fn)) blockSlots.add(s);
    }
    // The chest is one member of the nine-treasure table (the step indexes it
    // straight); the resources are a run of their own.
    let blockResources: string[] | undefined;
    let blockChest: string | undefined;
    for (const s of blockSlots) {
      const run = this.stringRun(s);
      if (run.length === treasures.length && run[0] === treasures[0]) blockChest = this.stringGlobal(s);
      else blockResources = run;
    }
    if (!blockResources || !blockChest) throw new Error(`treasure blocks: expected a resource run and a treasure-table member, found  slots`);

    // The map-setup step names the birds document beside the ambient lights it sets.
    const birds = this.stringWithTag([this.functionWithString('UndergroundAmbientLights.[0]')], 'AdvMapBirds', false);

    const minimapDrawer = this.functionWithString('thumbnailImages.[%d]');
    const minimapIcons = this.stringWithTag([minimapDrawer], 'WindowRelatedTextures', false);

    const { mapSizes, sizeUnits, unitsToSize } = this.sizeLadders(generateMap);
    const waterDepth = this.waterDepth(generateMap);
    const densityMultipliers = this.densityMultipliers(fillLoop);

    const loadTemplate = this.callsBeforeString(generateMap, 'Rnd Counter(LoadTemplate)', 'after')[0];
    if (loadTemplate === undefined) throw new Error('GenerateMap: no call after the LoadTemplate counter');
    const races = this.raceLists(loadTemplate);
    const raceEnum = this.raceEnum();
    const slotRaceList = this.slotRaceList();
    const lakeRaces = this.lakeRaces(this.vtable('.?AVCGameZone@NRMG@@'));
    const lightNames = {
      subterra: this.lightNames(subterra),
      subInferno: this.lightNames(this.vtable('.?AVCGameSubInfernoZone@NRMG@@')),
      dwarven: this.lightNames(this.vtable('.?AVCGameDwarvenZone@NRMG@@')),
    };
    const unflaggableDwellingTypes = this.unflaggableDwellings();

    return {
      shrines, treasures, mines, goldMineType, randomTown, randomDwellings, prison, cartographer, shipyard,
      monolith, gateIn, gateOut, observatory, denOfThieves, armyTemplateGroup, blockResources, blockChest, minimapIcons, birds,
      mapSizes, sizeUnits, unitsToSize, waterDepth, densityMultipliers,
      raceEnum, ...races, slotRaceList, lakeRaces, lightNames, unflaggableDwellingTypes, unplaceableCreatures,
    };
  }

  // ------------------------------------------------------------- the image

  /** The instructions of the function starting at `va`, decoded once. */
  private body(va: number): Instruction[] {
    let out = this.bodies.get(va);
    if (!out) {
      const off = this.pe.offsetOf(va);
      if (off === null) throw new Error(`0x${va.toString(16)} is not in the image`);
      out = [];
      let sawReturn = false;
      for (const ins of disassemble(this.pe.buf.subarray(off, off + 0x4000), va)) {
        if (sawReturn && ins.mnemonic === 'int3') break;
        sawReturn = ins.mnemonic === 'ret';
        out.push(ins);
      }
      this.bodies.set(va, out);
    }
    return out;
  }

  /** The start of the function containing `va` — MSVC's `int3` padding rule. */
  private functionStart(va: number): number {
    const off = this.pe.offsetOf(va);
    if (off === null) throw new Error(`0x${va.toString(16)} is not in the image`);
    let o = off;
    for (;;) {
      while (o > 0 && this.pe.buf[o - 1] !== 0xcc) o--;
      let run = 0;
      while (o - run > 0 && this.pe.buf[o - run - 1] === 0xcc) run++;
      // A run of two is padding wherever it sits; a lone 0xCC is padding only
      // when the function it precedes starts on a 16-byte boundary (map
      // setup sits one byte after its neighbour's `ret`, and that byte is it).
      if (run >= PADDING || o === 0 || (run === 1 && this.pe.addressOf(o)! % 16 === 0)) return this.pe.addressOf(o)!;
      o -= run;
    }
  }

  /** Every place in `.text` holding this dword — an immediate or a displacement. */
  private codeRefs(va: number): number[] {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(va >>> 0);
    const out: number[] = [];
    for (let i = this.code.indexOf(needle); i >= 0; i = this.code.indexOf(needle, i + 1)) out.push(this.codeLo + i);
    return out;
  }

  /** The address of the one literal containing `fragment`. */
  private literal(fragment: string): number {
    const starts = new Set<number>();
    for (const hit of this.pe.findBytes(fragment)) {
      let s = hit;
      while (s > 0 && this.pe.buf[s - 1]! >= 9 && this.pe.buf[s - 1]! <= 126) s--;
      const va = this.pe.addressOf(s);
      if (va !== null) starts.add(va);
    }
    if (starts.size !== 1) throw new Error(`${JSON.stringify(fragment)}: ${starts.size} literals carry it, expected one`);
    return [...starts][0]!;
  }

  /** The function that references the literal, which must be one function. */
  private functionWithString(fragment: string): number {
    const starts = this.functionsWithString(fragment);
    if (starts.length !== 1) throw new Error(`${JSON.stringify(fragment)}: referenced from ${starts.length} functions, expected one`);
    return starts[0]!;
  }

  /** Every function that references the literal. */
  private functionsWithString(fragment: string): number[] {
    return [...new Set(this.codeRefs(this.literal(fragment)).map((r) => this.functionStart(r)))];
  }

  /** Direct `call` targets of a function, in code order, deduplicated. */
  private calleesOf(fn: number): number[] {
    const body = this.body(fn);
    const end = body[body.length - 1]!.address;
    const out: number[] = [];
    for (const ins of body) {
      if (ins.branchTarget === undefined || out.includes(ins.branchTarget)) continue;
      // a `jmp` out of the body is a tail call, and counts as one
      if (ins.mnemonic === 'call' || (ins.mnemonic === 'jmp' && (ins.branchTarget < fn || ins.branchTarget > end))) out.push(ins.branchTarget);
    }
    return out;
  }

  /**
   * The direct calls right before (or after) the instruction referencing a
   * literal inside `fn` — "the step that runs before this log line".
   */
  private callsBeforeString(fn: number, prefix: string, side: 'before' | 'after' = 'before'): number[] {
    const lit = this.literal(prefix);
    const body = this.body(fn);
    const at = body.findIndex((ins) => ins.immediates.includes(lit));
    if (at < 0) throw new Error(`${JSON.stringify(prefix)} is not referenced in 0x${fn.toString(16)}`);
    const out: number[] = [];
    if (side === 'before') {
      // The log call itself is the first call after the push; skip the
      // runtime helpers (float conversion, the logger) and take the last
      // generator call before the literal is pushed.
      for (let i = at - 1; i >= 0 && out.length < 1; i--) {
        const ins = body[i]!;
        if (ins.mnemonic === 'call' && ins.branchTarget !== undefined && this.isGeneratorCode(ins.branchTarget)) out.push(ins.branchTarget);
      }
    } else {
      let skipped = 0;
      for (let i = at + 1; i < body.length && out.length < 1; i++) {
        const ins = body[i]!;
        if (ins.mnemonic !== 'call' || ins.branchTarget === undefined) continue;
        // the first call after the push is the logger; the generator's own call follows
        if (skipped === 0) { skipped++; continue; }
        out.push(ins.branchTarget);
      }
    }
    return out;
  }

  /**
   * Whether a function belongs to the generator rather than the runtime — it
   * references one of the generator's own literals, or calls something that does.
   * Cheap proxy: the generator's code is one contiguous region; a callee that
   * sits within 0x40000 bytes of GenerateMap's own literal references is ours.
   */
  private isGeneratorCode(fn: number): boolean {
    if (this.generatorLo === null) {
      const refs = this.codeRefs(this.literal('Rnd Counter (GenerateMap)'));
      this.generatorLo = refs[0]! - 0x40000;
      this.generatorHi = refs[0]! + 0x40000;
    }
    return fn >= this.generatorLo && fn <= this.generatorHi!;
  }
  private generatorLo: number | null = null;
  private generatorHi: number | null = null;

  /** A function both call — the one the `pick` accepts. */
  private commonCallee(a: number, b: number, pick: (fn: number) => boolean): number {
    const inB = new Set(this.calleesOf(b));
    const common = this.calleesOf(a).filter((c) => inB.has(c) && pick(c));
    if (common.length !== 1) throw new Error(`0x${a.toString(16)} and 0x${b.toString(16)}: ${common.length} common callees fit, expected one (a: ${this.calleesOf(a).map((x) => x.toString(16)).join(" ")}; b: ${this.calleesOf(b).map((x) => x.toString(16)).join(" ")}; a body ${this.body(a).length} ins ending 0x${this.body(a).at(-1)!.address.toString(16)})`);
    return common[0]!;
  }

  // -------------------------------------------------- string globals

  /**
   * The `push <string>; mov ecx,<slot>; call <ctor>` triple that builds a
   * string global at start-up — the static initializer's own line for it.
   */
  private triple(slot: number): { at: number; str: string } | null {
    const needle = Buffer.from([0xb9, slot & 255, (slot >> 8) & 255, (slot >> 16) & 255, (slot >>> 24) & 255]);
    let found: { at: number; str: string } | null = null;
    for (let i = this.code.indexOf(needle); i >= 0; i = this.code.indexOf(needle, i + 1)) {
      if (i < 5 || this.code[i - 5] !== 0x68 || this.code[i + 5] !== 0xe8) continue;
      const str = this.pe.stringAt(this.code.readUInt32LE(i - 4), 200);
      if (str === null) continue;
      if (found) throw new Error(`slot 0x${slot.toString(16)} is built twice`);
      found = { at: this.codeLo + i - 5, str };
    }
    return found;
  }

  /** The string a global holds. */
  private stringGlobal(slot: number): string {
    const t = this.triple(slot);
    if (!t) throw new Error(`slot 0x${slot.toString(16)} is not a string global`);
    return t.str;
  }

  /**
   * A run of string globals built in one initializer, 0x20 apart, the
   * engine's array-of-strings idiom — `slot` is any member of it.
   */
  private stringRun(slot: number): string[] {
    const here = this.triple(slot);
    if (!here) throw new Error(`slot 0x${slot.toString(16)} is not a string global`);
    const ctor = this.code.readInt32LE(here.at - this.codeLo + 11) + here.at + 15;
    const unit = (at: number): { str: string; slot: number } | null => {
      const o = at - this.codeLo;
      if (o < 0 || o + 15 > this.code.length) return null;
      if (this.code[o] !== 0x68 || this.code[o + 5] !== 0xb9 || this.code[o + 10] !== 0xe8) return null;
      if (this.code.readInt32LE(o + 11) + at + 15 !== ctor) return null;
      const str = this.pe.stringAt(this.code.readUInt32LE(o + 1), 200);
      return str === null ? null : { str, slot: this.code.readUInt32LE(o + 6) };
    };
    const out = [here.str];
    let first = slot;
    for (let at = here.at - 15, want = slot - 0x20; ; at -= 15, want -= 0x20) {
      const u = unit(at);
      if (!u || u.slot !== want) break;
      out.unshift(u.str);
      first = want;
    }
    for (let at = here.at + 15, want = slot + 0x20; ; at += 15, want += 0x20) {
      const u = unit(at);
      if (!u || u.slot !== want) break;
      out.push(u.str);
    }
    void first;
    return out;
  }

  /**
   * The string globals a function refers to — every immediate or displacement
   * that names a slot some initializer fills with a string — in code order,
   * or sorted by address when `byCode` is false.
   */
  private slotsOf(fn: number, byCode = false): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const ins of this.body(fn)) {
      const candidates = [...ins.immediates];
      if (ins.memory) candidates.push(ins.memory.displacement);
      for (const c of candidates) {
        if (c < this.codeLo + this.text.virtualSize || seen.has(c) || this.pe.offsetOf(c) === null && !this.inBss(c)) continue;
        seen.add(c);
        if (this.triple(c)) out.push(c);
      }
    }
    return byCode ? out : out.sort((a, b) => a - b);
  }

  /** Whether an address lies in a data section's virtual range (`.bss` has no bytes on disk). */
  private inBss(va: number): boolean {
    const rva = va - this.pe.imageBase;
    return this.pe.sections.some((s) => s.name !== '.text' && rva >= s.va && rva < s.va + s.virtualSize);
  }

  /** The string globals a function and its direct callees name, in code order. */
  private slotsDeep(fn: number): number[] {
    const out: number[] = [];
    for (const c of [fn, ...this.calleesOf(fn)]) for (const s of this.slotsOf(c, true)) if (!out.includes(s)) out.push(s);
    return out;
  }

  /**
   * The one string global, among those the functions (and, when `deep`,
   * their callees) name, whose href points at a document of `tag`'s kind —
   * the kind the step builds from, which is what tells the document apart
   * from the others the same code opens.
   */
  private stringWithTag(fns: number[], tag: string, deep: boolean): string {
    const found = new Set<string>();
    for (const fn of fns) {
      for (const slot of deep ? this.slotsDeep(fn) : this.slotsOf(fn, true)) {
        const s = this.stringGlobal(slot);
        if (s.includes(`(${tag})`) || s.endsWith(`#xpointer(/${tag})`)) found.add(s);
      }
    }
    if (found.size !== 1) throw new Error(`${fns.map((f) => '0x' + f.toString(16)).join(', ')}: ${found.size} ${tag} documents named, expected one`);
    return [...found][0]!;
  }

  // ---------------------------------------------------------- vtables

  private vtable(rttiName: string): number {
    const hits = this.pe.findBytes(rttiName).filter((o) => this.pe.buf[o + rttiName.length] === 0);
    if (hits.length !== 1) throw new Error(`${rttiName}: ${hits.length} descriptors, expected one`);
    const descriptor = this.pe.addressOf(hits[0]! - 8)!;
    const vtables: number[] = [];
    for (const ref of this.pe.pointersTo(descriptor)) {
      const locator = this.pe.addressOf(ref - 12);
      if (locator === null) continue;
      for (const back of this.pe.pointersTo(locator)) {
        const vt = this.pe.addressOf(back + 4);
        if (vt !== null) vtables.push(vt);
      }
    }
    // A class with a second locator (another complete-object view) has two; the one with the methods is the one wanted.
    if (!vtables.length) throw new Error(`${rttiName}: no vtable`);
    const methods = (vt: number): number => { let n = 0; while (this.isCode(this.pe.dwordAt(vt + n * 4) ?? -1)) n++; return n; };
    return vtables.sort((a, b) => methods(b) - methods(a))[0]!;
  }

  /** Every method of the vtable that holds `fn` — the slots around it that point into code. */
  private vtableMethods(fn: number): number[] {
    const refs = this.pe.pointersTo(fn).map((o) => this.pe.addressOf(o)).filter((va): va is number => va !== null && !this.isCode(va));
    if (refs.length !== 1) throw new Error(`0x${fn.toString(16)}: ${refs.length} vtable slots point at it, expected one`);
    const out: number[] = [];
    for (const dir of [-4, 4]) {
      for (let at = refs[0]! + dir; ; at += dir) {
        const v = this.pe.dwordAt(at);
        if (v === null || !this.isCode(v)) break;
        out.push(v);
      }
    }
    return out;
  }

  private slot(vt: number, offset: number): number {
    const fn = this.pe.dwordAt(vt + offset);
    if (fn === null) throw new Error(`vtable 0x${vt.toString(16)} has no slot +0x${offset.toString(16)}`);
    return fn;
  }

  // --------------------------------------------------------- decoders

  private shrineCosts(step: number, hrefs: string[]): Array<{ href: string; cost: number }> {
    // `mov eax,[ecx*4+T]` — a dword table indexed with no base register.
    const reads = this.body(step).filter((i) => i.mnemonic === 'mov' && i.memory && i.memory.base === 'None' && i.memory.scale === 4 && i.memory.index !== 'None' && this.isData(i.memory.displacement));
    const tables = [...new Set(reads.map((i) => i.memory!.displacement))];
    if (tables.length !== 1) throw new Error(`shrine step: ${tables.length} indexed tables, expected one: ${reads.map((i) => `0x${i.address.toString(16)} ${i.text}`).join("; ")}`);
    const costs = hrefs.map((_, i) => this.pe.dwordAt(tables[0]! + i * 4)!);
    const bound = this.body(step).find((i) => i.mnemonic === 'cmp' && i.text.startsWith('cmp ecx,') && i.immediates[0] === hrefs.length);
    if (!bound) throw new Error(`shrine step: no compare against ${hrefs.length}`);
    return hrefs.map((href, i) => ({ href, cost: costs[i]! }));
  }

  private treasureRun(step: number): string[] {
    const body = this.body(step);
    const slots = this.slotsOf(step);
    if (slots.length !== 1) throw new Error(`treasure step: ${slots.length} string globals, expected one`);
    const run = this.stringRun(slots[0]!);
    // `mov ecx,N; call below; shl eax,5; add eax,<table>` — N is the draw's bound.
    const at = body.findIndex((i) => i.immediates.includes(slots[0]!));
    const bound = body.slice(Math.max(0, at - 6), at).find((i) => i.text.startsWith('mov ecx,') && i.immediates.length === 1);
    if (!bound || bound.immediates[0] !== run.length) throw new Error(`treasure step: the draw's bound is not the table's ${run.length}`);
    return run;
  }

  /** `cmp reg,N; ja; jmp [reg*4+T]` → the N+1 case targets. */
  private jumpTables(fn: number): Array<{ at: number; bound: number; targets: number[] }> {
    const body = this.body(fn);
    const out: Array<{ at: number; bound: number; targets: number[] }> = [];
    for (let i = 0; i < body.length; i++) {
      const ins = body[i]!;
      if (ins.mnemonic !== 'jmp' || !ins.memory || ins.memory.scale !== 4 || ins.memory.base !== 'None') continue;
      const cmp = body.slice(Math.max(0, i - 3), i).find((c) => c.mnemonic === 'cmp' && c.immediates.length === 1);
      if (!cmp) continue;
      const bound = cmp.immediates[0]!;
      const targets: number[] = [];
      if (bound > 64 || !this.isData(ins.memory.displacement) && !this.isCode(ins.memory.displacement)) continue;
      for (let k = 0; k <= bound; k++) targets.push(this.pe.dwordAt(ins.memory.displacement + k * 4) ?? -1);
      if (!targets.every((t) => this.isCode(t))) continue;
      out.push({ at: i, bound, targets });
    }
    return out;
  }

  /**
   * The immediate of the one `cmp dword ptr [esp+N],imm` under `bound` that a
   * `jump` follows within four instructions — a step routing one table index
   * to its own branch.
   */
  private stackCompareBefore(fn: number, jump: string, bound: number): number {
    const body = this.body(fn);
    const found = new Set<number>();
    for (let i = 0; i + 2 < body.length; i++) {
      const ins = body[i]!;
      if (ins.mnemonic !== 'cmp' || !ins.memory || ins.memory.base.toUpperCase() !== 'ESP' || ins.immediates.length !== 1) continue;
      const imm = ins.immediates[0]!;
      if (imm < 0 || imm >= bound) continue;
      if (body.slice(i + 1, i + 5).some((j) => j.mnemonic === jump)) found.add(imm);
    }
    if (found.size !== 1) throw new Error(`0x${fn.toString(16)}: ${found.size} stack compares under ${bound} before a ${jump}, expected one (${[...found].join(' ')})`);
    return [...found][0]!;
  }

  /** The first instruction at `va` — for reading a jump-table case. */
  private first(va: number): Instruction {
    const off = this.pe.offsetOf(va)!;
    for (const ins of disassemble(this.pe.buf.subarray(off, off + 16), va, 1)) return ins;
    throw new Error(`nothing decodes at 0x${va.toString(16)}`);
  }

  private sizeLadders(generateMap: number): { mapSizes: number[]; sizeUnits: number[]; unitsToSize: number[] } {
    // The CreateMap window: CreateMap runs between the GenerateMap counter and "map created" (its own counter is logged after it).
    const body = this.body(generateMap);
    const from = body.findIndex((i) => i.immediates.includes(this.literal('Rnd Counter (GenerateMap)')));
    const to = body.findIndex((i) => i.immediates.includes(this.literal('at %g map created')));
    if (from < 0 || to < 0 || to < from) throw new Error('GenerateMap: the CreateMap window is not where the log says');
    // CreateMap reaches the two size conversions through the generator's own vtable — the one that holds GenerateMap — so those are read off its slots; the map-setup call in the window reads the tile counts.
    const callees = [...new Set(body.slice(from, to).filter((i) => i.mnemonic === 'call' && i.branchTarget !== undefined).map((i) => i.branchTarget!)), ...this.vtableMethods(generateMap)];
    let sizeUnits: number[] | null = null;
    let unitsToSize: number[] | null = null;
    let mapSizes: number[] | null = null;
    for (const fn of callees) {
      const b = this.body(fn);
      const jt = this.jumpTables(fn);
      if (jt.length === 1 && jt[0]!.targets.every((t) => this.first(t).text.startsWith('mov eax,'))) {
        // seven cases of `mov eax,imm; ret 4`
        sizeUnits = jt[0]!.targets.map((t) => {
          const ins = this.first(t);
          if (!ins.text.startsWith('mov eax,')) throw new Error(`size units: case at 0x${t.toString(16)} is ${ins.text}`);
          return ins.immediates[0]!;
        });
        continue;
      }
      const ladder = b.filter((i) => i.mnemonic === 'cmp' && i.text.startsWith('cmp ecx,') && i.immediates.length === 1);
      if (ladder.length >= 5 && b.length < 40 && b.every((i) => i.mnemonic !== 'call')) {
        unitsToSize = ladder.map((i) => i.immediates[0]!);
        continue;
      }
      const table = b.find((i) => i.mnemonic === 'mov' && i.memory && i.memory.base === 'None' && i.memory.scale === 4 && i.memory.index !== 'None');
      if (table && mapSizes === null) {
        mapSizes = [];
        for (let k = 0; ; k++) {
          const v = this.pe.dwordAt(table.memory!.displacement + k * 4)!;
          if (k && v <= mapSizes[k - 1]!) break; // the ladder is ascending; the next word is something else
          mapSizes.push(v);
        }
      }
    }
    if (!sizeUnits || !unitsToSize || !mapSizes) throw new Error(`GenerateMap: the CreateMap window does not hold the three size tables (units ${sizeUnits?.join(' ')}; ladder ${unitsToSize?.join(' ')}; sizes ${mapSizes?.join(' ')}; window ${from}..${to}; callees ${callees.map((c) => c.toString(16)).join(' ')})`);
    if (mapSizes.length < sizeUnits.length) throw new Error('map sizes: fewer entries than size indices');
    return { mapSizes: mapSizes.slice(0, sizeUnits.length), sizeUnits, unitsToSize };
  }

  private waterDepth(generateMap: number): { table: number[]; fallback: number } {
    const body = this.body(generateMap);
    for (const jt of this.jumpTables(generateMap)) {
      const cases = jt.targets.map((t) => this.first(t));
      if (!cases.every((c) => c.text.startsWith('mov ebx,'))) continue;
      // the `ja` before the jump names the default case
      const ja = body.slice(jt.at - 2, jt.at).find((i) => i.mnemonic === 'ja');
      if (!ja || ja.branchTarget === undefined) continue;
      const fallback = this.first(ja.branchTarget);
      if (!fallback.text.startsWith('mov ebx,')) continue;
      return { table: cases.map((c) => c.immediates[0]!), fallback: fallback.immediates[0]! };
    }
    throw new Error('GenerateMap: no sea-depth jump table');
  }

  private densityMultipliers(fillLoop: number): number[] {
    const body = this.body(fillLoop);
    const load = (c: Instruction): boolean => c.mnemonic === 'movss' && c.text.startsWith('movss xmm0,[') && !!c.memory && c.memory.base === 'None' && this.isData(c.memory.displacement);
    const float = (c: Instruction): number => this.pe.buf.readFloatLE(this.pe.offsetOf(c.memory!.displacement)!);
    for (const jt of this.jumpTables(fillLoop)) {
      const cases = jt.targets.map((t) => this.first(t));
      // Four cases load their multiplier; the middle one jumps straight to
      // the store, keeping the 1.0 loaded into xmm0 before the switch.
      if (cases.filter(load).length < 2) continue;
      const before = body.slice(Math.max(0, jt.at - 8), jt.at).reverse().find(load);
      if (!before) continue;
      return cases.map((c) => (load(c) ? float(c) : float(before)));
    }
    throw new Error('the zone fill loop has no multiplier jump table');
  }

  private raceLists(loadTemplate: number): { surfaceRaces: number[]; surfaceRaceWhenOneFloor: number | null; undergroundRaces: number[] } {
    // `mov dword ptr [esp+N],imm` … `lea ecx,[esp+X]` … `call push_back`: the
    // value pushed and the vector it goes to. A push under
    // `cmp byte ptr [reg+1Dh],0` is the one-floor addition.
    const body = this.body(loadTemplate);
    const lists = new Map<number, number[]>();
    let pending: number | null = null;
    let vector: number | null = null;
    let conditional = false;
    let oneFloor: { vector: number; value: number } | null = null;
    let pushBack: number | null = null;
    for (const ins of body) {
      if (ins.mnemonic === 'cmp' && ins.memory?.displacement === 0x1d && ins.immediates[0] === 0) conditional = true;
      if (ins.mnemonic === 'mov' && ins.memory?.base.toUpperCase() === 'ESP' && ins.immediates.length === 1 && ins.immediates[0]! >= 3 && ins.immediates[0]! <= 0x40) pending = ins.immediates[0]!;
      if (ins.mnemonic === 'lea' && ins.text.startsWith('lea ecx,[esp+')) vector = ins.memory!.displacement;
      if (ins.mnemonic === 'call' && pending !== null && vector !== null && ins.branchTarget !== undefined) {
        if (pushBack === null) pushBack = ins.branchTarget;
        if (ins.branchTarget === pushBack) {
          if (conditional) {
            oneFloor = { vector, value: pending };
            conditional = false;
          } else {
            if (!lists.has(vector)) lists.set(vector, []);
            lists.get(vector)!.push(pending);
          }
        }
        pending = null;
      }
    }
    const vectors = [...lists.keys()];
    if (vectors.length !== 2) throw new Error(`LoadTemplate 0x${loadTemplate.toString(16)}: ${vectors.length} race vectors, expected two; leas ${body.filter((i) => i.text.startsWith("lea ecx,[esp+")).length}, movs ${body.filter((i) => i.mnemonic === "mov" && i.memory?.base === "esp" && i.immediates.length === 1).map((i) => i.text).slice(0, 6).join("; ")}`);
    // the surface list is the longer one, and the one-floor addition belongs to it
    const [a, b] = vectors.map((v) => lists.get(v)!) as [number[], number[]];
    const surfaceFirst = a.length >= b.length;
    const surfaceRaces = surfaceFirst ? a : b;
    const undergroundRaces = surfaceFirst ? b : a;
    return { surfaceRaces, surfaceRaceWhenOneFloor: oneFloor ? oneFloor.value : null, undergroundRaces };
  }

  private raceEnum(): Record<string, number> {
    const lit = this.literal('RACE_SPECIAL');
    for (const ref of this.codeRefs(lit)) {
      const fn = this.functionStart(ref);
      const jt = this.jumpTables(fn);
      if (jt.length !== 1) continue;
      const out: Record<string, number> = {};
      jt[0]!.targets.forEach((t, value) => {
        const ins = this.first(t);
        const name = ins.immediates.length ? this.pe.stringAt(ins.immediates[0]!, 40) : null;
        if (!name || !/^_*RACE_/.test(name)) throw new Error(`race enum: case ${value} is ${ins.text}`);
        out[name.startsWith('RACE_') ? name.slice('RACE_'.length) : name] = value;
      });
      return out;
    }
    throw new Error('no value-to-name switch references RACE_SPECIAL');
  }

  private slotRaceList(): number[] {
    // `cmp ecx,8; jae; mov eax,[ecx*4+T]` — the accessor a RANDOM slot's list is read through.
    const pattern = Buffer.from([0x83, 0xf9]);
    const hits: Array<{ count: number; table: number }> = [];
    for (let i = this.code.indexOf(pattern); i >= 0; i = this.code.indexOf(pattern, i + 1)) {
      // 83 F9 nn 73 xx 8B 04 8D <T>
      if (this.code[i + 3] !== 0x73 || this.code[i + 5] !== 0x8b || this.code[i + 6] !== 0x04 || this.code[i + 7] !== 0x8d) continue;
      const count = this.code[i + 2]!;
      const table = this.code.readUInt32LE(i + 8);
      if (count < 4 || count > 16 || this.pe.offsetOf(table) === null) continue;
      hits.push({ count, table });
    }
    if (hits.length !== 1) throw new Error(`race list accessor: ${hits.length} matches, expected one`);
    const { count, table } = hits[0]!;
    return Array.from({ length: count }, (_, i) => this.pe.dwordAt(table + i * 4)!);
  }

  private lakeRaces(gameZone: number): number[] {
    const bigStatics = this.slot(gameZone, 0x34);
    const gate = this.calleesOf(bigStatics)[0];
    if (gate === undefined) throw new Error('CGameZone vt+0x34 calls nothing');
    const out: number[] = [];
    for (const ins of this.body(gate)) {
      if (ins.mnemonic === 'cmp' && ins.text.startsWith('cmp eax,') && ins.immediates.length === 1) out.push(ins.immediates[0]!);
      if (out.length && ins.mnemonic === 'jne') break;
    }
    if (out.length < 2) throw new Error('lake gate: no compare chain');
    return out.sort((a, b) => a - b);
  }

  private lightNames(zoneVtable: number): string[] {
    const fn = this.slot(zoneVtable, 0x3c);
    const out: string[] = [];
    for (const callee of this.calleesOf(fn)) {
      const body = this.body(callee);
      for (let i = 1; i < body.length; i++) {
        if (body[i]!.mnemonic !== 'call') continue;
        // `push "Crater"` sits one or two instructions before the `find` call
        const prev = body.slice(Math.max(0, i - 3), i).reverse().find((p) => p.mnemonic === 'push' && p.immediates.length === 1);
        if (!prev) continue;
        const s = this.pe.stringAt(prev.immediates[0]!, 40);
        if (s && /^[A-Za-z]+$/.test(s) && !out.includes(s)) out.push(s);
      }
    }
    if (!out.length) throw new Error(`zone vtable 0x${zoneVtable.toString(16)}: vt+0x3C names no substrings`);
    return out;
  }

  private unflaggableDwellings(): number[] {
    const name = '.?AVCAdvMapDwelling@NWorld@@';
    const hits = this.pe.findBytes(name).filter((o) => this.pe.buf[o + name.length] === 0);
    if (hits.length !== 1) throw new Error(`${name}: ${hits.length} descriptors`);
    const descriptor = this.pe.addressOf(hits[0]! - 8)!;
    for (const ref of this.pe.pointersTo(descriptor)) {
      const locator = this.pe.addressOf(ref - 12);
      if (locator === null) continue;
      for (const back of this.pe.pointersTo(locator)) {
        const vt = this.pe.addressOf(back + 4);
        if (vt === null) continue;
        const fn = this.pe.dwordAt(vt + 8);
        if (fn === null || this.pe.offsetOf(fn) === null || !this.isCode(fn)) continue;
        const body = this.body(fn);
        const at = body.findIndex((i) => i.mnemonic === 'mov' && i.memory?.displacement === 0xec);
        if (at < 0) continue;
        const values: number[] = [];
        let sum = 0;
        for (let i = at + 1; i < body.length; i++) {
          const ins = body[i]!;
          if (ins.mnemonic === 'sub' && ins.immediates.length === 1) { sum += ins.immediates[0]!; values.push(sum); continue; }
          if (ins.mnemonic === 'je') continue;
          break;
        }
        if (values.length) return values;
      }
    }
    throw new Error('CAdvMapDwelling: no vtable slot subtracts its way through the Type');
  }

  private creatureSkips(setMonster: number): number[] {
    for (const callee of this.calleesOf(setMonster)) {
      const body = this.body(callee);
      for (let i = 0; i + 1 < body.length; i++) {
        if (!(body[i]!.mnemonic === 'test' && body[i + 1]!.mnemonic === 'je')) continue;
        const reg = body[i]!.text.slice(5).split(',')[0]!;
        const out = [0];
        for (let k = i + 2; k + 1 < body.length; k += 2) {
          const c = body[k]!;
          if (c.mnemonic === 'cmp' && c.text.startsWith(`cmp ${reg},`) && c.immediates.length === 1 && body[k + 1]!.mnemonic === 'je') out.push(c.immediates[0]!);
          else break;
        }
        if (out.length > 1) return out;
      }
    }
    throw new Error('the guard setter has no single-stack branch with skipped ids');
  }

  /** Whether an address lies in a data section with bytes on disk. */
  private isData(va: number): boolean {
    return !this.isCode(va) && this.pe.offsetOf(va) !== null;
  }

  private isCode(va: number): boolean {
    return va >= this.codeLo && va < this.codeLo + this.text.virtualSize;
  }
}
