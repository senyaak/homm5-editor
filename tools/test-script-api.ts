// What the script editor completes from, and what it shows beside a completion.
//
//   node tools/test-script-api.ts
//
// The list is generated (`npm run build-api`) out of our written reference and
// the manuals' extraction, and it is the ONLY thing an author sees while
// typing: the reference doc is a different file, in another window, that nobody
// has open at the moment they are writing a call. So the checks here are about
// what survives the trip — a signature is not enough, and a summary written and
// then dropped by the generator is a write-up nobody reads.

import { CURATED } from '../src/script/script-api-curated.ts';
import api from '../src/script/script-api.json' with { type: 'json' };

interface Entry {
  name: string;
  params: string;
  group: string;
  summary?: string;
  args?: { name: string; type: string; desc: string }[];
  returns?: string;
  example?: string;
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const entries = api as Entry[];
const byName = new Map(entries.map((e) => [e.name, e]));

check('the generated list is not empty', entries.length > 50, `${entries.length} functions`);

// --- everything we wrote up arrives whole ------------------------------------
const missing: string[] = [];
const thin: string[] = [];
for (const fn of CURATED) {
  const got = byName.get(fn.name);
  if (!got) { missing.push(fn.name); continue; }
  const argsMatch = (got.args?.length ?? 0) === fn.params.length;
  if (!got.summary || !argsMatch) thin.push(fn.name);
}
check('every function we documented is in the list', missing.length === 0, missing.join(', '));
check('and each brings its summary and its parameters', thin.length === 0, thin.join(', '));

// --- and the parameters say what they MEAN -----------------------------------
//
// The name and the type are in the signature already. `desc` is the only part
// that answers "what do I pass here", which is the question being asked.
const undescribed = CURATED
  .flatMap((fn) => fn.params.map((p) => ({ fn: fn.name, p })))
  .filter((x) => !x.p.desc.trim())
  .map((x) => `${x.fn}(${x.p.name})`);
check('every parameter we documented has a description', undescribed.length === 0,
  undescribed.join(', '));

// --- the one this was written for --------------------------------------------
const slider = byName.get('ShowSliderDialog');
check('the count window is offered by the name a script calls it', !!slider);
check('it completes with its three arguments', slider?.params === 'creature, becomes, most',
  slider?.params);
check('it says what comes back, including the -1', /-1/.test(slider?.returns ?? ''),
  slider?.returns);
check('and it carries a line of it in use', /ShowSliderDialog\(/.test(slider?.example ?? ''),
  slider?.example);

// A function only the manuals know still completes, as a bare signature — that
// is the fallback the whole merge exists for, and it has to keep working.
const extractedOnly = entries.filter((e) => !CURATED.some((c) => c.name === e.name));
check('functions we have not written up still complete', extractedOnly.length > 0,
  `${extractedOnly.length} of them`);
check('...with a signature, even without a write-up',
  extractedOnly.every((e) => typeof e.params === 'string'));

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
