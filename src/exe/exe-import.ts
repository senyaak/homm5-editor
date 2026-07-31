// Making the game load our extension, by naming it in the executable's import
// table.
//
// WHY THIS AND NOT A PROXY DLL. The usual trick is to take some small library's
// name — here `zlib1.dll` — rename the original, and forward its exports. It
// works, and it means a file of the GAME's is replaced, so turning the mod off
// becomes a repair rather than a choice. We already have a better place: the
// editor never writes to `H5_Game.exe`, it patches a copy called
// `H5_Game_H5E.exe`, and a mod is turned off by launching the original. Adding
// an import to that copy keeps that rule exactly: nothing of the game's is
// touched, and the extension exists only for the executable we made.
//
// WHAT IT COSTS. One section appended to the file, holding a copy of the import
// descriptors with one more entry on the end, and the four small arrays that
// entry needs. The directory is repointed at the copy. The original descriptors
// stay where they are, unread — simpler than making room in the middle of
// `.rdata` and impossible to get half-done.
//
// The section is READ/WRITE because the loader writes resolved addresses into
// the import address table as it binds them; a read-only one faults at startup.

/** A parsed-enough view of the headers we edit. */
interface Headers {
  pe: number;
  optional: number;
  sectionTable: number;
  sections: number;
  fileAlignment: number;
  sectionAlignment: number;
  sizeOfImage: number;
  sizeOfHeaders: number;
}

const IMPORT_DIR = 1;
/** An `IMAGE_IMPORT_DESCRIPTOR`. */
const DESCRIPTOR = 20;
const SECTION_HEADER = 40;
/** Initialised data, readable, writable. */
const SECTION_FLAGS = 0xc0000040;

function headers(buf: Buffer): Headers {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file');
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error('not a PE file');
  const optional = pe + 24;
  if (buf.readUInt16LE(optional) !== 0x10b) throw new Error('not a 32-bit PE — the game is one');
  return {
    pe,
    optional,
    sectionTable: optional + buf.readUInt16LE(pe + 20),
    sections: buf.readUInt16LE(pe + 6),
    sectionAlignment: buf.readUInt32LE(optional + 32),
    fileAlignment: buf.readUInt32LE(optional + 36),
    sizeOfImage: buf.readUInt32LE(optional + 56),
    sizeOfHeaders: buf.readUInt32LE(optional + 60),
  };
}

const align = (value: number, to: number): number => Math.ceil(value / to) * to;

/** Where an RVA lands in the file, or null when it is not inside a section. */
function fileOffsetOf(buf: Buffer, h: Headers, rva: number): number | null {
  for (let i = 0; i < h.sections; i++) {
    const at = h.sectionTable + i * SECTION_HEADER;
    const va = buf.readUInt32LE(at + 12);
    const rawSize = buf.readUInt32LE(at + 16);
    const raw = buf.readUInt32LE(at + 20);
    if (rva >= va && rva < va + rawSize) return rva - va + raw;
  }
  return null;
}

/** Every DLL the file imports, lower-cased. */
export function imports(buf: Buffer): string[] {
  const h = headers(buf);
  const dir = h.optional + 96 + IMPORT_DIR * 8;
  const rva = buf.readUInt32LE(dir);
  if (!rva) return [];
  const at = fileOffsetOf(buf, h, rva);
  if (at === null) return [];
  const names: string[] = [];
  for (let p = at; p + DESCRIPTOR <= buf.length; p += DESCRIPTOR) {
    const nameRva = buf.readUInt32LE(p + 12);
    if (!buf.readUInt32LE(p) && !nameRva && !buf.readUInt32LE(p + 16)) break;
    const nameAt = fileOffsetOf(buf, h, nameRva);
    if (nameAt === null) break;
    const end = buf.indexOf(0, nameAt);
    names.push(buf.toString('latin1', nameAt, end < 0 ? nameAt : end).toLowerCase());
  }
  return names;
}

export interface AddImportResult {
  buf: Buffer;
  /** False when the file already named this library — nothing was written. */
  added: boolean;
  /** RVA the new section got, for the record. */
  rva?: number;
}

/**
 * Name `dll` in `buf`'s import table, importing the single function `fn` from
 * it.
 *
 * One function is enough and one is what we want: the point is to make the
 * loader map the library and run its `DllMain`, which is where the extension
 * installs itself. The imported symbol is never called.
 *
 * Idempotent — a file that already imports the library comes back untouched, so
 * running the installer twice is not a way to grow the executable.
 */
export function addImport(buf: Buffer, dll: string, fn: string): AddImportResult {
  const h = headers(buf);
  if (imports(buf).includes(dll.toLowerCase())) return { buf, added: false };

  // Room for one more section header has to exist BEFORE the first section's
  // bytes; there is no moving them without rewriting every offset in the file.
  const headerEnd = h.sectionTable + h.sections * SECTION_HEADER;
  let firstRaw = Infinity;
  for (let i = 0; i < h.sections; i++) {
    const raw = buf.readUInt32LE(h.sectionTable + i * SECTION_HEADER + 20);
    if (raw && raw < firstRaw) firstRaw = raw;
  }
  if (headerEnd + SECTION_HEADER > Math.min(firstRaw, h.sizeOfHeaders)) {
    throw new Error('no room in the header for another section');
  }

  const dirAt = h.optional + 96 + IMPORT_DIR * 8;
  const oldRva = buf.readUInt32LE(dirAt);
  const oldAt = fileOffsetOf(buf, h, oldRva);
  if (oldAt === null) throw new Error('the import directory is not inside any section');
  let count = 0;
  while (oldAt + (count + 1) * DESCRIPTOR <= buf.length) {
    const p = oldAt + count * DESCRIPTOR;
    if (!buf.readUInt32LE(p) && !buf.readUInt32LE(p + 12) && !buf.readUInt32LE(p + 16)) break;
    count++;
  }

  // The new section: descriptors (the old ones, ours, a terminator), then the
  // three little arrays ours points at. Laid out first with placeholder RVAs,
  // because each one's address depends on where the section lands.
  const descriptors = (count + 2) * DESCRIPTOR;
  const intAt = descriptors;          // import name table: one entry + null
  const iatAt = intAt + 8;            // import address table: the same shape
  const hintAt = iatAt + 8;           // hint (2 bytes) + the function's name
  const hintLen = 2 + fn.length + 1;
  const nameAt = hintAt + hintLen + (hintLen % 2); // the library's own name, even-aligned
  const nameLen = dll.length + 1;
  const blobSize = nameAt + nameLen;

  const va = align(h.sizeOfImage, h.sectionAlignment);
  const blob = Buffer.alloc(align(blobSize, h.fileAlignment));
  buf.copy(blob, 0, oldAt, oldAt + count * DESCRIPTOR);
  const ours = count * DESCRIPTOR;
  blob.writeUInt32LE(va + intAt, ours);       // OriginalFirstThunk
  blob.writeUInt32LE(0, ours + 4);            // TimeDateStamp
  blob.writeUInt32LE(0, ours + 8);            // ForwarderChain
  blob.writeUInt32LE(va + nameAt, ours + 12); // Name
  blob.writeUInt32LE(va + iatAt, ours + 16);  // FirstThunk
  blob.writeUInt32LE(va + hintAt, intAt);
  blob.writeUInt32LE(va + hintAt, iatAt);
  blob.write(fn, hintAt + 2, 'latin1');
  blob.write(dll, nameAt, 'latin1');

  const out = Buffer.concat([buf, Buffer.alloc(align(buf.length, h.fileAlignment) - buf.length), blob]);
  const raw = align(buf.length, h.fileAlignment);

  const at = headerEnd;
  out.fill(0, at, at + SECTION_HEADER);
  out.write('.h5edit', at, 'latin1');
  out.writeUInt32LE(blobSize, at + 8);   // VirtualSize
  out.writeUInt32LE(va, at + 12);
  out.writeUInt32LE(blob.length, at + 16); // SizeOfRawData
  out.writeUInt32LE(raw, at + 20);
  out.writeUInt32LE(SECTION_FLAGS, at + 36);

  out.writeUInt16LE(h.sections + 1, h.pe + 6);
  out.writeUInt32LE(va + align(blobSize, h.sectionAlignment), h.optional + 56); // SizeOfImage
  out.writeUInt32LE(va, dirAt);
  out.writeUInt32LE(descriptors, dirAt + 4);

  return { buf: out, added: true, rva: va };
}
