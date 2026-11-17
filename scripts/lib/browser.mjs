// Finds a Chromium this machine already has. The canvas installs by copying a folder, so it
// brings no Playwright of its own: it looks where a machine that makes prototypes usually has
// one, and launches each candidate rather than trusting that it resolves, because a Playwright
// whose browser build was never downloaded is not a working one.
//
//   $CANVAS_PLAYWRIGHT          a node_modules holding playwright, checked first
//   the one that worked last    remembered in the system's temp folder
//   the skill's folder, the working folder, then the prototypes' folder, each with its parents
//                               and their sub-projects' node_modules
//   the npm global root
//   the npx cache               newest version first
//
// Candidates are looked for one at a time and the first that launches ends the search: walking
// every parent of a folder deep in the user's profile, and their sub-folders, can take minutes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const exists = (p) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

const REMEMBERED = path.join(os.tmpdir(), 'design-canvas-chromium.json')
const remembered = () => {
  try {
    const root = JSON.parse(fs.readFileSync(REMEMBERED, 'utf8')).root
    return typeof root === 'string' ? root : null
  } catch {
    return null
  }
}
const remember = (root) => {
  try {
    fs.writeFileSync(REMEMBERED, JSON.stringify({ root }))
  } catch {}
}

/** Every node_modules worth trying, in order, each once, found as it is asked for. */
export function* candidateRoots(from) {
  const seen = new Set()
  function* add(dir) {
    if (!dir || seen.has(dir)) return
    seen.add(dir)
    if (exists(dir)) yield dir
  }
  for (const v of [process.env.CANVAS_PLAYWRIGHT, process.env.DESIGN_EXPLORE_PLAYWRIGHT, remembered()]) yield* add(v)
  const subdirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => path.join(dir, e.name))
    } catch {
      return []
    }
  }
  const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const starts = [skill, process.cwd(), from].filter(Boolean).map((s) => path.resolve(s))
  // First each start's own parents' node_modules, which costs nothing to look at.
  for (const start of starts) {
    for (let dir = start; ; ) {
      yield* add(path.join(dir, 'node_modules'))
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  // Then their sub-projects: near the start, two folders down too (a workspace of projects, each with its own).
  for (const start of starts) {
    let dir = start
    for (let depth = 0; ; depth++) {
      for (const sub of subdirs(dir)) {
        yield* add(path.join(sub, 'node_modules'))
        if (depth < 3) for (const subsub of subdirs(sub)) yield* add(path.join(subsub, 'node_modules'))
      }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  // npm's global root, worked out rather than asked of npm: on Windows asking starts a console.
  if (process.env.npm_config_prefix) yield* add(path.join(process.env.npm_config_prefix, process.platform === 'win32' ? '' : 'lib', 'node_modules'))
  if (process.platform === 'win32') yield* add(path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules'))
  else yield* add(path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules'))
  const npx = path.join(os.homedir(), '.npm', '_npx')
  const found = []
  try {
    for (const e of fs.readdirSync(npx, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const mods = path.join(npx, e.name, 'node_modules')
      for (const name of ['playwright', 'playwright-core']) {
        const pkg = path.join(mods, name, 'package.json')
        if (!exists(pkg)) continue
        let v = '0.0.0'
        try {
          v = JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? v
        } catch {}
        found.push({ mods, v })
        break
      }
    }
  } catch {}
  const rank = (v) => v.split('.').map((n) => String(Number(n) || 0).padStart(5, '0')).join('')
  found.sort((a, b) => rank(b.v).localeCompare(rank(a.v)))
  for (const { mods } of found) yield* add(mods)
}

/** `{ browser, via }`, or a thrown error listing everything it tried. */
export async function launchChromium(from, options = {}) {
  const tried = []
  for (const root of candidateRoots(from)) {
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
      const entry = path.join(root, name, 'package.json')
      if (!exists(entry)) continue
      let chromium
      try {
        chromium = createRequire(entry)(name).chromium
      } catch (e) {
        tried.push(`${root}/${name}: did not load (${e.message.split('\n')[0]})`)
        continue
      }
      for (const channel of [undefined, 'chrome', 'msedge']) {
        try {
          const browser = await chromium.launch({ headless: true, ...options, ...(channel ? { channel } : {}) })
          remember(root)
          return { browser, via: `${name} in ${root}${channel ? ` (${channel})` : ''}` }
        } catch (e) {
          tried.push(`${root}/${name}${channel ? ` ${channel}` : ''}: did not launch (${e.message.split('\n')[0]})`)
        }
      }
    }
  }
  throw new Error(
    'No Chromium could be launched. Set CANVAS_PLAYWRIGHT to a node_modules that holds playwright, or run `npx playwright install chromium` once.' +
      (tried.length ? `\nTried:\n  ${tried.join('\n  ')}` : '\nFound no Playwright on this machine.'),
  )
}
