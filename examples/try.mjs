#!/usr/bin/env node
// A canvas to try everything on: copies examples/plain and the checklist into try/ (ignored by
// git), fresh each time, and builds try/canvas.html. Edit it freely; run this again to start over.
//
//   node examples/try.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCanvas } from '../scripts/canvas.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const to = path.join(here, '..', 'try')
fs.rmSync(to, { recursive: true, force: true })
fs.mkdirSync(to)
for (const f of fs.readdirSync(path.join(here, 'plain')).filter((f) => f.endsWith('.html') && f !== 'canvas.html')) fs.copyFileSync(path.join(here, 'plain', f), path.join(to, f))
fs.copyFileSync(path.join(here, 'start-here.html'), path.join(to, 'start-here.html'))
const layout = {
  title: 'Try the design canvas',
  pages: [{ title: 'Page 1', sections: [
    { title: 'Start here', sub: 'the checklist', groups: [{ kind: 'flat', frames: [{ file: 'start-here.html', hash: '', label: 'start-here' }] }] },
    { title: 'Prototypes to edit', sub: 'levers, script and links, fluid', groups: [{ kind: 'flat', frames: ['home', 'detail', 'pricing'].map((n) => ({ file: `${n}.html`, hash: '', label: n })) }] },
  ] }],
}
// Kept beside the prototypes, so `canvas.mjs build try` rebuilds with this layout and keeps what was done on it.
fs.writeFileSync(path.join(to, 'canvas.json'), `${JSON.stringify(layout, null, 2)}\n`)
await buildCanvas({ folder: to })
console.log(`Open ${path.join(to, 'canvas.html')} in Chrome or Edge, click "Viewing · Edit" and pick the try folder.`)
