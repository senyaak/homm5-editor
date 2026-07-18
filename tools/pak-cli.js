// Command-line front-end for the archive/project layer — the "open" and "pack"
// commands the editor UI will call, usable standalone.
//
//   node tools/pak-cli.js open   <archive> <projectDir>   unpack archive into a project
//   node tools/pak-cli.js pack   <projectDir> <out>       build the project into an archive
//   node tools/pak-cli.js status <projectDir>             show drift vs the last pack
//   node tools/pak-cli.js list   <archive>                list archive contents
//
// Archives: .pak / .h5m / .h5c / .h5u (all ZIP).

import { readEntries } from '../src/pak.ts';
import { openProject, packProject, status } from '../src/project.ts';
import { readFileSync } from 'node:fs';

const [cmd, a, b] = process.argv.slice(2);

function die(msg) { console.error(msg); process.exit(1); }

switch (cmd) {
  case 'open': {
    if (!a || !b) die('usage: open <archive> <projectDir>');
    const { files } = openProject(a, b);
    console.log(`opened ${a} -> ${b}: ${files.length} files unpacked`);
    console.log('(never packed yet — run "pack" to build an archive)');
    break;
  }
  case 'pack': {
    if (!a || !b) die('usage: pack <projectDir> <out.h5m>');
    const r = packProject(a, b);
    console.log(`packed ${a} -> ${b}: ${r.entries} entries, ${(r.bytes / 1024 | 0)} KB`);
    console.log(`built by editor ${r.manifest.lastPack.editorVersion} at ${r.manifest.lastPack.time}`);
    break;
  }
  case 'status': {
    if (!a) die('usage: status <projectDir>');
    const s = status(a);
    if (s.neverPacked) { console.log('never packed — no build to compare against'); break; }
    if (!s.dirty) console.log('clean: working tree matches the last pack');
    else {
      console.log(`dirty: ${s.added.length} added, ${s.modified.length} modified, ${s.removed.length} removed`);
      for (const f of s.added) console.log(`  + ${f}`);
      for (const f of s.modified) console.log(`  ~ ${f}`);
      for (const f of s.removed) console.log(`  - ${f}`);
    }
    if (s.versionMismatch)
      console.log(`! last pack built by editor ${s.packedBy}, current is ${s.editorVersion}`);
    break;
  }
  case 'list': {
    if (!a) die('usage: list <archive>');
    for (const e of readEntries(readFileSync(a))) console.log(`${String(e.data.length).padStart(9)}  ${e.name}`);
    break;
  }
  default:
    die('commands: open <archive> <dir> | pack <dir> <out> | status <dir> | list <archive>');
}
