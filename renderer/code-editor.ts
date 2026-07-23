// The text/Lua editor: CodeMirror 6, wired to what this map knows.
//
// A map script is not free text. It calls a fixed engine API (199 functions,
// taken from the manuals the game ships — see tools/script-api.ts), and almost
// every argument is a NAME defined somewhere else in the map: an object's
// `<Name>`, a region, an objective, a creature ID. Getting one wrong fails at
// run time, inside the game, with no message — which is exactly the class of
// mistake completion exists to prevent. So the editor completes from the map
// itself rather than from the words already in the buffer.
//
// Lua here is the game's Lua, which is 4.0-shaped: `%upvalue` in a nested
// function, `f{...}` calls, no `#` operator. Highlighting is therefore the
// legacy STREAM mode rather than a strict grammar — a modern Lua parser marks
// half of the shipped missions as syntax errors, and an editor that paints
// working code red is worse than one that paints nothing.

import { EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine, lineNumbers, highlightActiveLineGutter, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { acceptCompletion, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { lintKeymap, linter, lintGutter } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { oneDark } from '@codemirror/theme-one-dark';
import { luaDiagnostics, luaNameWarnings } from '../src/lua-lint.ts';
import type { LuaDiagnostic } from '../src/lua-lint.ts';

/** One engine function, as tools/script-api.ts extracts it from the manuals. */
export interface ApiFn { name: string; params: string; group: string }

/**
 * Everything the editor completes from, gathered once per map.
 *
 * Split by where it comes from, because that is what the completion popup shows
 * beside each entry: guessing whether `d2` is a region or an object is the whole
 * question when reading somebody else's mission.
 */
export interface ScriptContext {
  /** The engine's own API — name, parameters, manual section. */
  api: ApiFn[];
  /** Functions the game's shipped scripts define (startThreadOnce, …). */
  helpers: string[];
  /** ALL_CAPS constants: the game's scripts' own, plus the ID rosters. */
  constants: string[];
  /** Names defined in THIS map, by kind. */
  names: { object: string[]; region: string[]; objective: string[] };
}

const EMPTY: ScriptContext = { api: [], helpers: [], constants: [], names: { object: [], region: [], objective: [] } };
let ctx: ScriptContext = EMPTY;

/** Hand the editor what this map knows. Safe to call while an editor is open. */
export function setScriptContext(c: ScriptContext): void { ctx = c; }

/** A name completion, tagged with where the name is defined. */
const nameOption = (label: string, kind: string): Completion =>
  ({ label, type: 'constant', detail: kind, boost: 1 });

/**
 * Names, offered INSIDE a string literal.
 *
 * Every API call that takes a map name takes it as a string — `GetObjectPosition(
 * "Isabell" )` — so the moment the cursor is between quotes, the useful list is
 * not the language's but the map's. Outside a string the same names would be
 * noise, since a bare `Isabell` is not valid Lua.
 */
function nameCompletions(context: CompletionContext): CompletionResult | null {
  const quoted = context.matchBefore(/["'][\w .\-]*/);
  if (!quoted) return null;
  const options = [
    ...ctx.names.object.map((n) => nameOption(n, 'object')),
    ...ctx.names.region.map((n) => nameOption(n, 'region')),
    ...ctx.names.objective.map((n) => nameOption(n, 'objective')),
  ];
  if (!options.length) return null;
  // from + 1: the opening quote stays, only what follows it is replaced.
  return { from: quoted.from + 1, options, validFor: /^[\w .\-]*$/ };
}

/** True when the cursor sits inside a string literal on its own line. */
function inString(context: CompletionContext): boolean {
  const line = context.state.doc.lineAt(context.pos);
  return /["'][^"']*$/.test(line.text.slice(0, context.pos - line.from));
}

/** The engine API, the shipped helpers and the ID constants — plain word completion. */
function codeCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  // Inside a string this would offer `GetHeroLevel` as a hero's name.
  if (inString(context)) return null;
  const options: Completion[] = [
    ...ctx.api.map((f): Completion => ({
      label: f.name,
      type: 'function',
      detail: `(${f.params})`,
      info: f.group,
      // The call is completed with its brackets and the cursor between them —
      // the parameters are in `detail`, right there to be read while typing.
      apply: (view, _c, from, to) => {
        // With parameters the cursor lands between the brackets, ready for the
        // first one; without, past the closing bracket, since there is nothing
        // to type in there.
        const text = f.params ? `${f.name}(  )` : `${f.name}()`;
        const cursor = from + f.name.length + 2;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: cursor } });
      },
      boost: 2,
    })),
    ...ctx.helpers.map((n): Completion => ({ label: n, type: 'function', detail: 'game script' })),
    ...ctx.constants.map((n): Completion => ({ label: n, type: 'constant' })),
  ];
  if (!options.length) return null;
  return { from: word.from, options, validFor: /^[\w.]*$/ };
}

/**
 * What the buffer itself defines — this script's own functions and variables.
 *
 * Read straight off the text rather than from a parse tree: the stream mode has
 * no tree, and a regex over `function f(` and `x =` is exactly as good at the
 * one question being asked ("what names has this file introduced?").
 */
function localCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = context.state.doc.toString();
  const found = new Map<string, string>();
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_]\w*)/g)) found.set(m[1]!, 'this file');
  for (const m of text.matchAll(/^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=/gm)) {
    if (!found.has(m[1]!)) found.set(m[1]!, 'this file');
  }
  const options = [...found].map(([label, detail]): Completion => ({ label, type: 'variable', detail }));
  if (!options.length) return null;
  return { from: word.from, options, validFor: /^\w*$/ };
}

const language = new Compartment();

/**
 * Which language the open document is, for the linter to gate on.
 *
 * A name.txt is free text — there is nothing to lint — so the linter has to know
 * it is looking at Lua before it says a word. Set by `setDoc`, read by the lint
 * source below; module-level because the linter extension is built once, before
 * any document is loaded.
 */
let lintLang: 'lua' | 'text' = 'text';

/** Every name the editor considers "defined" — the API, the helpers, the constants. */
function knownNames(): string[] {
  return [...ctx.api.map((f) => f.name), ...ctx.helpers, ...ctx.constants];
}

/**
 * The linter: the errors the engine's Lua parser would reject, plus a "did you
 * mean" on a mistyped call. See src/lua-lint.ts for why it is structural only.
 * A short delay so it settles a beat after typing rather than on every keystroke.
 */
const luaLinter = linter((view): Diagnostic[] => computeLint(view.state.doc.toString()), { delay: 250 });

/** A mounted editor, and the handful of things the dialog around it needs. */
export interface CodeEditor {
  view: EditorView;
  /** Replace the whole document, and say which language it is. */
  setDoc(text: string, lang: 'lua' | 'text'): void;
  getDoc(): string;
  /** The diagnostics for the current document, computed on demand (no debounce). */
  lint(): LuaDiagnostic[];
  focus(): void;
}

/** The diagnostics for a document, or none when it is not Lua. */
function computeLint(src: string): LuaDiagnostic[] {
  if (lintLang !== 'lua') return [];
  return [...luaDiagnostics(src), ...luaNameWarnings(src, knownNames())];
}

/**
 * Mount an editor into `host`. `onSave` is bound to Ctrl/Cmd-S, because a
 * modal with a Save button still wants the shortcut every editor has. `onStatus`
 * is called with the current diagnostics whenever the document changes, so the
 * dialog can show "2 errors" beside the file's name as they are typed.
 */
export function mountCodeEditor(host: HTMLElement, onSave: () => void, onStatus?: (d: LuaDiagnostic[]) => void): CodeEditor {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(),
        foldGutter(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
        indentOnInput(), bracketMatching(), closeBrackets(),
        autocompletion({ override: [codeCompletions, nameCompletions, localCompletions], activateOnTyping: true }),
        rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          { key: 'Mod-s', run: () => { onSave(); return true; }, preventDefault: true },
          ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap,
          ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab,
        ]),
        // Enter takes the highlighted completion, above everything else that
        // wants the key: the default keymap's newline is registered first and
        // would otherwise win, leaving the popup open over a blank new line.
        // It falls through to that newline whenever no completion is open.
        Prec.highest(keymap.of([{ key: 'Enter', run: acceptCompletion }])),
        language.of([]),
        luaLinter, lintGutter(),
        EditorView.updateListener.of((u) => { if (onStatus && u.docChanged) onStatus(computeLint(u.state.doc.toString())); }),
        oneDark,
        EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace' } }),
      ],
    }),
  });
  return {
    view,
    setDoc(text, lang) {
      lintLang = lang;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: language.reconfigure(lang === 'lua' ? StreamLanguage.define(lua) : []),
      });
      onStatus?.(computeLint(text));
    },
    getDoc: () => view.state.doc.toString(),
    lint: () => computeLint(view.state.doc.toString()),
    focus: () => view.focus(),
  };
}
