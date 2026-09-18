// Membership in the game's random groups — `src/mods/shared-groups.ts`:
//
//   a member is appended before `</links>`, indented like the others, CRLF;
//   the same member twice is once;
//   a member is removed by its line, and removing a stranger changes nothing;
//   a relative or pointer-less href is refused, so is a document with no list.
//
//   node tools/test-shared-groups.ts

import { HERO_GROUP, TOWN_GROUP, addGroupMember, groupMembers, removeGroupMember } from '../src/mods/shared-groups.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function throws(name: string, f: () => unknown, mentions: string): void {
  try { f(); check(name, false, 'did not throw'); } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(mentions), msg);
  }
}

// The shipped shape: a header, one list, tabs and CRLF.
const ASTRAL = '/MapObjects/Academy/Astral.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';
const FAIZ = '/MapObjects/Academy/Faiz.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';
const OURS = '/MapObjects/Test/Brem.(AdvMapHeroShared).xdb#xpointer(/AdvMapHeroShared)';
const shipped = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<AdvMapSharedGroup ObjectRecordID="1000000">',
  '\t<links>',
  `\t\t<Item href="${ASTRAL}"/>`,
  `\t\t<Item href="${FAIZ}"/>`,
  '\t</links>',
  '</AdvMapSharedGroup>',
  '',
].join('\r\n');

console.log('paths');
check('the towns group is the one RPGRoot names', TOWN_GROUP === 'MapObjects/_(AdvMapSharedGroup)/Towns/any.xdb');
check('the heroes group is the one RPGRoot names', HERO_GROUP === 'MapObjects/_(AdvMapSharedGroup)/Heroes/Any.xdb');

console.log('reading');
check('members in the document order', JSON.stringify(groupMembers(shipped)) === JSON.stringify([ASTRAL, FAIZ]));

console.log('adding');
const added = addGroupMember(shipped, OURS, 'heroes');
check('ours is the last member', JSON.stringify(groupMembers(added)) === JSON.stringify([ASTRAL, FAIZ, OURS]));
check('the line sits before </links>, indented like its neighbours',
  added.includes(`\t\t<Item href="${FAIZ}"/>\r\n\t\t<Item href="${OURS}"/>\r\n\t</links>`));
check('nothing else moved', added.replace(`\t\t<Item href="${OURS}"/>\r\n`, '') === shipped);
check('adding twice is once', addGroupMember(added, OURS, 'heroes') === added);
check('a byte-identical document when the member is already there', addGroupMember(shipped, FAIZ, 'heroes') === shipped);

console.log('removing');
check('removing ours gives the shipped document back', removeGroupMember(added, OURS) === shipped);
check('removing a stranger changes nothing', removeGroupMember(shipped, OURS) === shipped);
check('a member with regex characters in its path is found by its text',
  groupMembers(removeGroupMember(added, FAIZ)).join() === [ASTRAL, OURS].join());

console.log('refusals');
throws('a relative href', () => addGroupMember(shipped, 'MapObjects/Test/Brem.xdb#xpointer(/AdvMapHeroShared)', 'heroes'), 'absolute href');
throws('an href without an xpointer', () => addGroupMember(shipped, '/MapObjects/Test/Brem.xdb', 'heroes'), 'xpointer');
throws('a document with no list', () => addGroupMember('<AdvMapSharedGroup/>', OURS, 'heroes'), 'heroes: anchor missing');

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
