// The install's own templates — where the template editor saves.
//
//   node tools/test-rmg-user-templates.ts
//
// A throwaway game folder under the OS temp: save a template into it, see
// it land as `<game>/H5E/RMG/Templates/<file>.h5et`, see the chain read it
// IN FRONT of the application's and the game's (a copy under a shipped name
// shadows the shipped one), delete it, see the shipped one come back.

// needs: data
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inFront, singleRoot } from '../src/game/assets.ts';
import { readTemplate, readTemplateNamed, templateFile } from '../src/rmg/template-files.ts';
import { deleteUserTemplate, saveUserTemplate, userTemplateFile, userTemplateRoot } from '../src/rmg/user-templates.ts';
import { dataDir } from './game-dir.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const shipped = join(dataDir(), 'RMG', 'Templates');
if (!existsSync(shipped)) {
  console.log('no unpacked RMG templates — run `npm run unpack-data`; skipping');
  process.exit(0);
}

const GAME = join(tmpdir(), 'homm5-editor', 'user-templates-game');
rmSync(GAME, { recursive: true, force: true });
mkdirSync(GAME, { recursive: true });
const OWN = join(import.meta.dirname, '..', 'assets', 'rmg');
/** The chain the generator reads: the user's, the app's, the game's. */
const chain = () => inFront(userTemplateRoot(GAME), inFront(OWN, singleRoot(dataDir())));

console.log('saving');
const s1 = readTemplate(join(shipped, 'S1P2Z2M1.xdb'));
check('the user root is <game>/H5E', userTemplateRoot(GAME) === join(GAME, 'H5E'));
const path = saveUserTemplate(GAME, 'My Two', { ...s1, name: 'My Two', uniqueRaces: true });
check('it lands as <game>/H5E/RMG/Templates/<file>.h5et', path === userTemplateFile(GAME, 'My Two') && path === join(GAME, 'H5E', 'RMG', 'Templates', 'My Two.h5et'));
check('and the file is there, ours', existsSync(path) && readFileSync(path, 'utf8').includes('<UniqueRaces>true</UniqueRaces>'));
check('the chain lists it by name', templateFile(chain(), 'My Two') === 'RMG/Templates/My Two.h5et');
check('and reads it back', readTemplateNamed(chain(), 'My Two').name === 'My Two');

console.log('\nshadowing');
check('before: S1P2Z2M1 is the game\'s .xdb', templateFile(chain(), 'S1P2Z2M1') === 'RMG/Templates/S1P2Z2M1.xdb');
saveUserTemplate(GAME, 'S1P2Z2M1', { ...s1, minPlayers: 2, maxPlayers: 8 });
check('a copy under the shipped name is read instead', readTemplateNamed(chain(), 'S1P2Z2M1').maxPlayers === 8);
check('and Jebus Cross, the app\'s, likewise', readTemplateNamed(chain(), 'Jebus Cross').zoneLayout === 'Voronoi');
saveUserTemplate(GAME, 'Jebus Cross', { ...readTemplateNamed(chain(), 'Jebus Cross'), zoneLayout: 'Engine' });
check('a copy under the app\'s name shadows the app\'s', readTemplateNamed(chain(), 'Jebus Cross').zoneLayout === 'Engine');

console.log('\ndeleting');
check('a user template is removed', deleteUserTemplate(GAME, 'S1P2Z2M1') && !existsSync(userTemplateFile(GAME, 'S1P2Z2M1')));
check('and the shipped one is back', readTemplateNamed(chain(), 'S1P2Z2M1').maxPlayers === 2);
check('a name with no user file removes nothing — the game\'s are not ours', deleteUserTemplate(GAME, 'S1-2P2-4Z4K1S') === false);
check('a bad file name is refused', (() => { try { saveUserTemplate(GAME, 'a/b', s1); return false; } catch { return true; } })());

rmSync(GAME, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
