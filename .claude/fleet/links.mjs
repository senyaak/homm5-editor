// Every relative link in a markdown file must land on a file that exists
// (.claude/rules/docs.md). Moving or splitting a doc is how links rot, and
// nothing else in the repo would notice: a compiler does not read prose and a
// broken link renders as an ordinary one.
//
//   node .claude/fleet/links.mjs [root]
//
// Checks the markdown git tracks or would track under `root` (default: the
// current directory), so it also checks a sibling repo when pointed at it.
// Prints each broken link as `file:line: target` and exits 1 if there is one.
// Links inside code fences and inline code are not links; http(s) and
// anchor-only links are not checked.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const root = process.argv[2] ?? '.'
const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '-co', '--exclude-standard', '*.md'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)

const link = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const broken = []

for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8')
  let fenced = false
  text.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      fenced = !fenced
      return
    }
    if (fenced) return
    const prose = line.replace(/`[^`]*`/g, '')
    for (const m of prose.matchAll(link)) {
      const target = m[1]
      if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue
      const path = decodeURIComponent(target.split('#')[0])
      if (!path) continue
      const resolved = normalize(join(dirname(file), path))
      if (!existsSync(join(root, resolved))) broken.push(`${file}:${i + 1}: ${target}`)
    }
  })
}

for (const b of broken) console.log(b)
console.log(`${broken.length} broken link(s) in ${files.length} markdown files`)
process.exit(broken.length ? 1 : 0)
