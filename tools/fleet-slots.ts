// The fleet's working slots (docs/fleet/project.md § Slots): per slot a worktree
// and a game copy of its own, side by side.
//
//   node tools/fleet-slots.ts <count> --root <dir> [--game-from <install>]
//
//   <root>/slot-<n>/editor   worktree, detached at origin/main, own node_modules,
//                            data-unpacked a junction to the main checkout's
//   <root>/slot-<n>/game     the slot's game, copied from --game-from if missing
//
// What exists is left alone; only each slot's .claude/settings.local.json is
// rewritten, so the script is run again to add slots or to change what every
// slot may do. A fleet session has nobody to answer a permission prompt, so the
// file pre-allows everything a role does, sets HOMM5_GAME to the slot's own
// game for every command, and FLEET_SLOT, by which the fleet's guard
// (.claude/fleet/guard.md) knows a fleet session. Kept out of git: its paths
// are this machine's.

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const BASH_ALLOWED = [
  'gh', 'git', 'npm', 'npx', 'node', 'python', 'zig',
  'MSYS_NO_PATHCONV=1 git', 'GIT_COMMITTER_NAME=',
  'cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'grep', 'find', 'sed', 'awk', 'wc',
  'sort', 'uniq', 'diff', 'cut', 'tr', 'echo', 'printf', 'date', 'test', 'mkdir',
  'cp', 'mv', 'file', 'du', 'xargs', 'true', 'until',
];

function usage(): never {
  console.error('usage: node tools/fleet-slots.ts <count> --root <dir> [--game-from <install>]');
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** A path as Windows tools and the settings file want it: forward slashes. */
const fwd = (p: string): string => p.replace(/\\/g, '/');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** The main checkout, wherever this is run from: the parent of the common .git. */
function mainCheckout(): string {
  const common = git(process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return dirname(resolve(common));
}

/** robocopy exits below 8 on success, with the number saying what it copied. */
function copyGame(from: string, to: string): void {
  console.log(`  copying the game from ${from} (a few GB) ...`);
  const r = spawnSync('robocopy', [from, to, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
    { stdio: 'inherit' });
  if (r.status === null || r.status >= 8) throw new Error(`robocopy failed (exit ${r.status})`);
}

function settings(n: number, slot: string, game: string, data: string): string {
  return JSON.stringify({
    permissions: {
      additionalDirectories: [fwd(slot), fwd(data)],
      allow: [
        'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Monitor',
        ...BASH_ALLOWED.map((c) => `Bash(${c}:*)`),
      ],
    },
    env: { HOMM5_GAME: fwd(game), FLEET_SLOT: String(n) },
  }, null, 2) + '\n';
}

function makeSlot(root: string, n: number, main: string, gameFrom: string | undefined): void {
  const slot = join(root, `slot-${n}`);
  const editor = join(slot, 'editor');
  const game = join(slot, 'game');
  const data = join(main, 'data-unpacked');
  console.log(`slot-${n}`);

  if (existsSync(editor)) {
    console.log('  editor exists, left alone');
  } else {
    mkdirSync(slot, { recursive: true });
    git(main, 'worktree', 'add', '--detach', editor, 'origin/main');
    console.log('  npm ci ...');
    execSync('npm ci --no-audit --no-fund --loglevel=error', { cwd: editor, stdio: 'inherit' });
    console.log('  editor made');
  }

  const link = join(editor, 'data-unpacked');
  if (!existsSync(link)) {
    if (!existsSync(data)) throw new Error(`no ${data} to link to`);
    symlinkSync(data, link, 'junction');
    console.log('  data-unpacked linked');
  }

  if (existsSync(join(game, 'bin'))) {
    console.log('  game exists, left alone');
  } else if (gameFrom) {
    copyGame(gameFrom, game);
    console.log('  game copied');
  } else {
    throw new Error(`slot-${n} has no game: pass --game-from <install>`);
  }

  mkdirSync(join(editor, '.claude'), { recursive: true });
  writeFileSync(join(editor, '.claude', 'settings.local.json'), settings(n, slot, game, data));
  console.log('  settings written');
}

function main(): void {
  const args = process.argv.slice(2);
  const count = Number(args[0]);
  const root = option(args, '--root');
  if (!Number.isInteger(count) || count < 1 || !root) usage();
  const gameFrom = option(args, '--game-from');

  const checkout = mainCheckout();
  git(checkout, 'fetch', '-q', 'origin');
  for (let n = 1; n <= count; n++) makeSlot(resolve(root), n, checkout, gameFrom);
}

main();
