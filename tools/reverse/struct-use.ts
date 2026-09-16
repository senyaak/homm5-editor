// WHICH FIELDS OF A STRUCTURE THE IMAGE ACTUALLY READS.
//
// `trace.ts field 0x44` answers "who touches offset 0x44" for EVERY structure
// at once, because an offset is just a number: the answer to a question about
// `SRMGParameters+0x44` arrives buried in every other class that happens to
// have something at +0x44. That is fine for finding a lead and useless for the
// opposite claim — "nothing reads this field" — which is what a sweep of a
// data format needs, and which is only worth saying when it is said about ONE
// structure over the WHOLE image.
//
// So this starts from the DOOR instead of from the offset: from wherever the
// pointer is handed out. It taints the returned register, walks each caller
// forward, and writes down every `[tainted + N]` it sees.
//
//   node tools/reverse/struct-use.ts --getter 0xeaff80
//   node tools/reverse/struct-use.ts --cast 0x10b70d4
//   node tools/reverse/struct-use.ts --cast 0x10b70d4 --getter 0xeaff80 --offset 0x168
//   node tools/reverse/struct-use.ts --cast 0x10b70d4 --exe game/bin/H5_MapEditor_H5E.exe
//
// TWO KINDS OF DOOR, and the second is why the first is not enough. `--getter`
// takes a function that returns the pointer and roots the walk at every call to
// it. `--cast` takes the address of a class's RTTI TYPE DESCRIPTOR and roots the
// walk at every `dynamic_cast` to that type — which is the same door after the
// compiler has INLINED the getter, and inlining is exactly what it does in the
// hot paths. Rooted at the calls alone, `SRMGParameters` came out with eleven
// fields nothing reads; four of them are read by an inlined copy of its own
// getter, and the mine guard levels are among them.
//
// WHAT IT CANNOT SEE, and therefore what an absence here is worth. A pointer
// that leaves the caller — pushed as an argument, or moved to `ecx` for a
// method call — is followed no further, so the callee's reads are not in the
// list. Every such departure is printed under ESCAPES, and an "unread" verdict
// is only earned once the escapes are accounted for. The walk is linear over
// the function body, not a traversal of its branches: nothing here proves a
// read is REACHABLE, only that it exists.

import { resolve } from 'node:path';

import {
  Decoder, DecoderOptions, Formatter, FormatterSyntax, InstructionInfoFactory, OpAccess, OpKind, Register,
} from 'iced-x86';

import { PEFile } from '../../src/exe/pe.ts';
import { gameDir } from '../game-dir.ts';
import { disassemble } from '../../src/exe/disasm.ts';
import { fieldAt, xdbFields } from './xdb-fields.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const exeSaid = flag('exe');
const pe = PEFile.read(exeSaid ? resolve(exeSaid) : resolve(gameDir(), 'bin', 'H5_Game_H5E.exe'));

const getter = flag('getter') ? Number.parseInt(flag('getter')!, 16) : null;
const cast = flag('cast') ? Number.parseInt(flag('cast')!, 16) : null;
// THE THIRD DOOR is a place said out loud: "after this instruction, that
// register holds one". It is how a pointer that no getter and no cast produces
// — an element of an array, walked by stride — is swept at all.
const said = flag('at') ? Number.parseInt(flag('at')!, 16) : null;
const saidReg = (flag('reg') ?? 'eax').toUpperCase();
if (getter === null && cast === null && said === null) {
  console.error('say where the pointer comes from: --getter 0xeaff80, --cast 0x10b70d4, or --at 0xea2073 --reg edx');
  process.exit(2);
}
const onlyOffset = flag('offset') !== undefined ? Number.parseInt(flag('offset')!, 16) : null;
// A DERIVED CLASS'S OWN FIELDS START WHERE ITS BASE ENDS, and the base of an
// engine resource is a refcount and two links that every walk trips over.
// `--min` says where the structure being asked about begins.
const minOffset = flag('min') !== undefined ? Number.parseInt(flag('min')!, 16) : 0;
// ONE STEP FURTHER IN: sweep not the structure the door hands out, but what
// the field at this offset points AT. A vector's `begin` is such a field, and
// the elements behind it — a template's zones, say — have no door of their own:
// they are reached by walking a stride from that pointer and by nothing else.
const deref = flag('deref') !== undefined ? Number.parseInt(flag('deref')!, 16) : null;
// THE ANSWER IN THE FILE'S OWN WORDS. Given the structure's serialiser, the
// sweep is joined against its field map, and the listing names the fields
// rather than their offsets — and, more to the point, names the ones NOTHING
// reads, which is the question a sweep is run to answer.
const fieldsAt = flag('fields') !== undefined ? Number.parseInt(flag('fields')!, 16) : null;

/** The immediate operand kinds an `add reg,N` can carry. */
const IMMEDIATE = new Set([OpKind.Immediate8, OpKind.Immediate8to32, OpKind.Immediate32]);

/** The caller-saved registers a call destroys. */
const CLOBBERED = ['EAX', 'ECX', 'EDX'];

/** 32-bit name of any sub-register, so `al` and `ax` kill `eax`. */
function wide(name: string): string {
  const map: Record<string, string> = {
    AL: 'EAX', AH: 'EAX', AX: 'EAX', EAX: 'EAX',
    BL: 'EBX', BH: 'EBX', BX: 'EBX', EBX: 'EBX',
    CL: 'ECX', CH: 'ECX', CX: 'ECX', ECX: 'ECX',
    DL: 'EDX', DH: 'EDX', DX: 'EDX', EDX: 'EDX',
    SI: 'ESI', ESI: 'ESI', DI: 'EDI', EDI: 'EDI',
    BP: 'EBP', EBP: 'EBP', SP: 'ESP', ESP: 'ESP',
  };
  return map[name] ?? name;
}

interface Read { offset: number; at: number; text: string; from: number }
interface Escape { at: number; text: string; from: number; how: string }

const reads: Read[] = [];
const escapes: Escape[] = [];

const formatter = new Formatter(FormatterSyntax.Intel);
const info = new InstructionInfoFactory();

/**
 * Walk forward from a root, recording what the pointer in `eax` is used for.
 *
 * The taint is a set of registers and memory slots holding the pointer. Slots
 * are keyed by base register and displacement rather than by frame offset
 * because the inlined getter parks the result in its CACHE — `mov [esi],eax`
 * — and reads it back from there two instructions later; a walk that only knew
 * about `esp` and `ebp` lost the pointer exactly where the interesting code
 * begins. It is run until it stops growing, so a value stored before a loop is
 * seen as tainted inside it.
 */
function walk(root: number, holds = 'EAX'): void {
  const at = pe.offsetOf(root);
  if (at === null) return;
  const window = pe.buf.subarray(at, at + 0x1200);

  const tainted = new Set<string>();
  const slots = new Set<string>();
  // What the reads are recorded against: the structure itself, or — with
  // `--deref` — whatever its pointer field leads to.
  const subject = new Set<string>();
  const subjectSlots = new Set<string>();
  let settled = false;

  for (let pass = 0; pass < 3 && !settled; pass++) {
    const before = tainted.size + slots.size + subject.size + subjectSlots.size;
    tainted.clear();
    subject.clear();

    const decoder = new Decoder(32, window, DecoderOptions.None);
    decoder.ip = BigInt(root >>> 0);
    let first = true;
    let sawReturn = false;

    while (decoder.position < decoder.maxPosition) {
      const ins = decoder.decode();
      const text = formatter.format(ins);
      const address = Number(ins.ip);
      const mnemonic = text.split(' ')[0] ?? '';

      if (sawReturn && mnemonic === 'int3') break;
      sawReturn = mnemonic === 'ret';

      if (first) {
        // The root instruction itself — the call whose result is the pointer,
        // or whatever the caller said leaves it in that register.
        first = false;
        tainted.add(holds);
        continue;
      }

      const detail = info.info(ins);
      const memory = detail.usedMemory();
      /** Set when THIS instruction loads the pointer `--deref` asked about. */
      let becameSubject: string | null = null;
      const keep = (offset: number, how: string): void => {
        if (onlyOffset !== null && offset !== onlyOffset) return;
        if (offset < minOffset) return;
        reads.push({ offset, at: address, text: how ? `${text}   (${how})` : text, from: root });
      };

      // `lea ecx,[eax+148h]` IS A USE OF THE FIELD, and the commonest one in
      // this structure: every href, string and vector is reached by taking its
      // address and calling a method on it, so an instrument that only counted
      // loads would report most of the file as unread. iced calls the operand
      // of a `lea` "no access" — it computes an address rather than touching
      // memory — so it is taken off the instruction, not off `usedMemory()`.
      if (mnemonic === 'lea' && deref === null) {
        const base = wide(Register[ins.memoryBase] ?? '');
        const offset = Number(ins.memoryDisplacement) | 0;
        if (tainted.has(base) && offset !== 0) keep(offset, 'address of');
      }

      // `add eax,19Ch` is the same sentence said differently — the compiler
      // picks it over `lea` when the pointer is not needed afterwards — and
      // leaving it out is what made seven call sites look as though they read
      // nothing at all.
      if (mnemonic === 'add' && deref === null && memory.length === 0 && ins.opCount === 2
        && ins.op0Kind === OpKind.Register && IMMEDIATE.has(ins.op1Kind)) {
        const target = wide(Register[ins.op0Register] ?? '');
        const offset = Number(ins.immediate(1)) | 0;
        if (tainted.has(target) && offset !== 0) keep(offset, 'address of');
      }

      // THE SUBJECT'S OWN READS, when `--deref` moved the question one step in.
      // An element of an array is addressed from the array's start plus a byte
      // offset held in a register — `mov eax,[eax+edx+10h]` — so a tainted
      // INDEX at scale 1 names the field just as a tainted base does.
      if (deref !== null) {
        for (const m of memory) {
          const base = wide(Register[m.base] ?? '');
          const index = wide(Register[m.index] ?? '');
          const displacement = Number(m.displacement) | 0;
          const onSubject = subject.has(base) || (subject.has(index) && m.scale === 1)
            || (subject.has(base) && subject.has(index));
          if (!onSubject) continue;
          if (m.access === OpAccess.Read || m.access === OpAccess.ReadWrite || m.access === OpAccess.CondRead) {
            keep(displacement, subject.has(index) && !subject.has(base) ? 'indexed' : '');
          }
          if (m.access === OpAccess.Write || m.access === OpAccess.ReadWrite) keep(displacement, 'WRITE');
        }
        // `lea ecx,[eax+edx+20h]` — the address of a vector inside the element,
        // with the array's start in one register and the element's byte offset
        // in the other. Either of them being the subject names the field.
        if (mnemonic === 'lea') {
          const base = wide(Register[ins.memoryBase] ?? '');
          const index = wide(Register[ins.memoryIndex] ?? '');
          const offset = Number(ins.memoryDisplacement) | 0;
          if (offset !== 0 && (subject.has(base) || (subject.has(index) && ins.memoryIndexScale === 1))) {
            keep(offset, 'address of');
          }
        }
      }

      // READS AND ESCAPES, before the writes below can retire the taint.
      for (const m of memory) {
        const base = wide(Register[m.base] ?? '');
        const index = wide(Register[m.index] ?? '');
        const displacement = Number(m.displacement) | 0;
        if (deref !== null && tainted.has(base) && displacement === deref
          && (m.access === OpAccess.Read || m.access === OpAccess.CondRead)) {
          // `mov eax,[edi+5Ch]` — the pointer field itself. What it loads is
          // the new subject; a register that held the outer structure stops
          // being interesting the moment it is overwritten by this.
          for (const r of detail.usedRegisters()) {
            if (r.access === OpAccess.Write) becameSubject = wide(Register[r.register] ?? '');
          }
        }
        // With `--deref` the outer structure's own reads are not the question,
        // but everything below it — the slots the pointer is parked in, above
        // all — still has to be followed, or the walk loses it at the cache.
        if (deref === null && tainted.has(base)) {
          if (m.access === OpAccess.Read || m.access === OpAccess.ReadWrite || m.access === OpAccess.CondRead) {
            keep(displacement, '');
          }
          if (m.access === OpAccess.Write || m.access === OpAccess.ReadWrite) keep(displacement, 'WRITE');
        } else if (deref === null && tainted.has(index)) {
          escapes.push({ at: address, text, from: root, how: 'index' });
        }
        // The pointer being stored: remembered as a slot, and reported anyway,
        // because a store into a field of another object is a departure this
        // walk cannot follow even when the slot is read back here.
        if (m.access === OpAccess.Write && !tainted.has(base)) {
          for (const r of detail.usedRegisters()) {
            const name = wide(Register[r.register] ?? '');
            if (!tainted.has(name)) continue;
            if (r.access !== OpAccess.Read && r.access !== OpAccess.CondRead) continue;
            slots.add(`${base}+${displacement}`);
            if (base !== 'ESP' && base !== 'EBP') {
              escapes.push({ at: address, text, from: root, how: 'store' });
            }
          }
        }
      }

      if (mnemonic === 'push') {
        for (const r of detail.usedRegisters()) {
          if (tainted.has(wide(Register[r.register] ?? '')) && r.access === OpAccess.Read) {
            escapes.push({ at: address, text, from: root, how: 'push' });
          }
        }
      }

      if (mnemonic === 'call') {
        if (tainted.has('ECX')) escapes.push({ at: address, text, from: root, how: 'ecx' });
        for (const r of CLOBBERED) tainted.delete(r);
        continue;
      }

      // A LOAD FROM A TAINTED SLOT puts the pointer back into a register. The
      // subject keeps its own slots: a stride walk parks its byte offset in the
      // frame on every turn of the loop and reads it back on the next.
      let reloaded: string | null = null;
      let subjectReloaded: string | null = null;
      if (mnemonic === 'mov' && memory.length === 1) {
        const m = memory[0]!;
        const key = `${wide(Register[m.base] ?? '')}+${Number(m.displacement) | 0}`;
        if (m.access === OpAccess.Read || m.access === OpAccess.CondRead) {
          for (const r of detail.usedRegisters()) {
            if (r.access !== OpAccess.Write) continue;
            if (slots.has(key)) reloaded = wide(Register[r.register] ?? '');
            if (subjectSlots.has(key)) subjectReloaded = wide(Register[r.register] ?? '');
          }
        }
        // And a store of the subject remembers where it went.
        if (m.access === OpAccess.Write) {
          for (const r of detail.usedRegisters()) {
            if ((r.access === OpAccess.Read || r.access === OpAccess.CondRead)
              && subject.has(wide(Register[r.register] ?? ''))) subjectSlots.add(key);
          }
        }
      }

      // A COPY of a tainted register spreads the taint; anything else written
      // retires it, because the register now holds something that is not the
      // pointer — a field's VALUE included.
      const plainCopy = mnemonic === 'mov' && memory.length === 0
        && detail.usedRegisters().some((r) =>
          (r.access === OpAccess.Read || r.access === OpAccess.CondRead) && tainted.has(wide(Register[r.register] ?? '')));

      // A COPY OF THE SUBJECT spreads it the same way, and the byte offset a
      // stride walk carries is a copy too: `add edx,74h` keeps naming the same
      // array, one element further on.
      const subjectCopy = (mnemonic === 'mov' || mnemonic === 'add') && memory.length === 0
        && detail.usedRegisters().some((r) =>
          (r.access === OpAccess.Read || r.access === OpAccess.CondRead) && subject.has(wide(Register[r.register] ?? '')));
      for (const r of detail.usedRegisters()) {
        const name = wide(Register[r.register] ?? '');
        if (r.access !== OpAccess.Write && r.access !== OpAccess.ReadWrite && r.access !== OpAccess.CondWrite) continue;
        if (name === reloaded || (plainCopy && !tainted.has(name))) tainted.add(name);
        else tainted.delete(name);
        if (name === subjectReloaded || name === becameSubject || subjectCopy) subject.add(name);
        else subject.delete(name);
      }
    }

    settled = tainted.size + slots.size + subject.size + subjectSlots.size === before;
  }
}

/** Every place the pointer is produced: a call to the getter, or a cast to it. */
const roots = new Set<number>();
if (getter !== null) {
  for (const { from, kind } of pe.callsTo(getter)) if (kind === 'call') roots.add(from);
}
if (cast !== null) {
  const text = pe.section('.text');
  const pending: number[] = [];
  for (const ins of disassemble(pe.bytesOf(text), pe.imageBase + text.va)) {
    if (ins.immediates.includes(cast)) pending.push(ins.address);
    // The cast's RESULT is what matters, so the root is the call that follows
    // the type descriptor being pushed — within a handful of instructions,
    // which is as far as the remaining arguments ever take.
    if (ins.mnemonic === 'call' && pending.length && ins.address - pending[pending.length - 1]! < 0x20) {
      roots.add(ins.address);
      pending.length = 0;
    }
  }
}

for (const root of [...roots].sort((a, b) => a - b)) walk(root);
if (said !== null) {
  roots.add(said);
  walk(said, saidReg);
}

const sites = new Set(reads.map((r) => r.from));
console.log(`${roots.size} door(s), ${sites.size} of them lead to a read`);

// THE SAME INSTRUCTION IS REACHED FROM SEVERAL DOORS — an inlined getter has
// one on each branch — and printing it once per door says nothing extra.
const byOffset = new Map<number, Read[]>();
const seen = new Set<string>();
for (const r of reads) {
  const key = `${r.at}:${r.text}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const list = byOffset.get(r.offset) ?? [];
  list.push(r);
  byOffset.set(r.offset, list);
}

const fields = fieldsAt === null ? [] : xdbFields(pe, fieldsAt);

console.log('');
for (const offset of [...byOffset.keys()].sort((a, b) => a - b)) {
  const list = byOffset.get(offset)!;
  const owner = fields.length ? fieldAt(fields, offset) : null;
  const named = owner ? `  ${owner.field.name}${owner.within ? ` +${owner.within}` : ''}` : '';
  console.log(`+0x${offset.toString(16).toUpperCase()}${named}  ${list.length} read(s)`);
  for (const r of list) console.log(`    0x${r.at.toString(16)}  ${r.text}`);
}

// WHAT NOTHING READ. A field owns the bytes up to the next one, so a field is
// unread only when no read landed anywhere inside it.
if (fields.length) {
  const touched = new Set<string>();
  for (const offset of byOffset.keys()) {
    const owner = fieldAt(fields, offset);
    if (owner) touched.add(owner.field.name);
  }
  const unread = fields.filter((f) => f.offset !== null && f.offset >= minOffset && !touched.has(f.name));
  console.log(`
NOTHING READ THESE — ${unread.length} of ${fields.filter((f) => f.offset !== null && f.offset >= minOffset).length} field(s):`);
  for (const f of unread) console.log(`    +0x${f.offset!.toString(16).toUpperCase().padStart(3, '0')}  ${f.name}`);
}

// A DOOR THAT LEADS TO NOTHING is the one thing this cannot leave silent:
// either the pointer went somewhere the walk does not follow, or the walk lost
// it, and both are reasons to distrust an absence above.
const silent = [...roots].filter((r) => !sites.has(r)).sort((a, b) => a - b);
if (silent.length) {
  console.log(`\nLED TO NOTHING — ${silent.length} door(s) whose pointer this walk lost or never saw used:`);
  for (const s of silent) console.log(`    0x${s.toString(16)}`);
}

// THE SAME DEPARTURE IS SEEN FROM EVERY DOOR THAT REACHES IT, and a hundred
// copies of the getter's own refcounting drown the two lines that matter.
if (escapes.length) {
  const once = new Map<string, Escape>();
  for (const e of escapes) once.set(`${e.at}:${e.how}`, e);
  console.log(`\nESCAPES — ${once.size} place(s) where the pointer leaves the walk, so what happens to it`
    + ' after is NOT in the list above. A `store` into the door\'s own cache and an `ecx` call to the'
    + ' resource release are that door\'s own bookkeeping; a `push` is an argument to somebody else.');
  for (const e of [...once.values()].sort((a, b) => a.at - b.at)) {
    console.log(`    0x${e.at.toString(16)}  ${e.how.padEnd(6)} ${e.text}`);
  }
}
