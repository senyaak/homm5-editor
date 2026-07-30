// What the game is handed when the editor starts it.
//
// Starting it from the editor broke the game; starting the same executable by
// hand did not. The difference is what a child process inherits, so what is
// checked here is exactly that: our own variables gone, the machine's own left
// untouched, and PATH kept but without the entries `npm run` prepended.
//
// A pure function on purpose. The spawn itself is one line in electron/main.ts
// and cannot be tested without leaving a game running on the machine that ran
// the suite; the decision it makes can be tested here, in milliseconds.

import { GAME_EXE, cleanEnv } from '../src/launch-game.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

check('ours is the copy that gets launched', GAME_EXE.endsWith('H5_Game_H5E.exe'), GAME_EXE);
check('...never the shipped one beside it', !/[\\/]H5_Game\.exe$/.test(GAME_EXE));

// A process as the editor really has it: the user's environment, plus the three
// layers this one carries.
const env: NodeJS.ProcessEnv = {
  // the machine's own — every one of these has to survive
  SystemRoot: 'C:\\Windows',
  windir: 'C:\\Windows',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
  TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
  USERPROFILE: 'C:\\Users\\x',
  NUMBER_OF_PROCESSORS: '16',
  PATH: 'C:\\repo\\node_modules\\.bin;C:\\repo\\..\\node_modules/.bin;C:\\Windows\\system32;C:\\Program Files\\nodejs',
  // ours: the editor's own paths
  HOMM5_ROOT: 'C:\\Games\\HoMM5',
  HOMM5_DATA: 'C:\\Games\\HoMM5\\homm5-editor\\data-unpacked',
  HOMM5_UNPACK_TO: 'C:\\somewhere',
  // ours: npm run
  npm_lifecycle_event: 'start',
  npm_package_name: 'homm5-editor',
  NODE_OPTIONS: '--max-old-space-size=8192',
  INIT_CWD: 'C:\\repo',
  // ours: Electron and Chromium
  ELECTRON_RUN_AS_NODE: '1',
  CHROME_DESKTOP: 'homm5-editor.desktop',
  // and a variable that is empty rather than unset — it must not become "undefined"
  EMPTY_ONE: '',
};

const out = cleanEnv(env);

check('the editor\'s own paths are gone',
  !Object.keys(out).some((k) => k.startsWith('HOMM5_')),
  Object.keys(out).filter((k) => k.startsWith('HOMM5_')).join(',') || 'none left');
check('what npm run exported is gone',
  !out.npm_lifecycle_event && !out.npm_package_name && !out.NODE_OPTIONS && !out.INIT_CWD);
check('what Electron set for itself is gone',
  !out.ELECTRON_RUN_AS_NODE && !out.CHROME_DESKTOP);

check('the machine\'s own are untouched',
  out.SystemRoot === env.SystemRoot && out.LOCALAPPDATA === env.LOCALAPPDATA
  && out.APPDATA === env.APPDATA && out.TEMP === env.TEMP
  && out.USERPROFILE === env.USERPROFILE && out.NUMBER_OF_PROCESSORS === '16');
check('an empty variable stays empty rather than turning into a word',
  out.EMPTY_ONE === '', JSON.stringify(out.EMPTY_ONE));

// PATH is the one that is edited rather than kept or dropped: the game needs it,
// and the front of it is ours.
check('PATH survives', typeof out.PATH === 'string' && out.PATH.length > 0);
check('...without the node_modules/.bin npm put in front',
  !/node_modules[\\/]\.bin/i.test(out.PATH!), out.PATH);
check('...and with the system entries still in it, in order',
  out.PATH === 'C:\\Windows\\system32;C:\\Program Files\\nodejs', out.PATH);

// The whole point: nothing of ours is left anywhere in it.
const OURS = ['HOMM5_ROOT', 'HOMM5_DATA', 'HOMM5_UNPACK_TO', 'npm_lifecycle_event',
  'npm_package_name', 'NODE_OPTIONS', 'INIT_CWD', 'ELECTRON_RUN_AS_NODE', 'CHROME_DESKTOP'];
check(`all ${OURS.length} of ours removed, and nothing else`,
  Object.keys(out).length === Object.keys(env).length - OURS.length,
  `${Object.keys(env).length} in, ${Object.keys(out).length} out`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
