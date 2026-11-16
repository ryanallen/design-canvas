// Finds a Chromium this machine already has. The canvas installs by copying a folder, so it
// brings no Playwright of its own: it looks where a machine that makes prototypes usually has
// one, and launches each candidate rather than trusting that it resolves, because a Playwright
// whose browser build was never downloaded is not a working one.
//
//   $CANVAS_PLAYWRIGHT          a node_modules holding playwright, checked first
//   the folder and its parents  and each of their sub-projects' node_modules
//   the npm global root
//   the npx cache               newest version first
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

function candidateRoots(from) {
  const roots = []
  const add = (dir) => {
    if (dir && exists(dir) && !roots.includes(dir)) roots.push(dir)
  }
  for (const v of [process.env.CANVAS_PLAYWRIGHT, process.env.DESIGN_EXPLORE_PLAYWRIGHT]) add(v)
  const subdirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => path.join(dir, e.name))
    } catch {
      return []
    }
  }
  for (const start of [from, process.cwd(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')].filter(Boolean)) {
    let dir = path.resolve(start)
    // Near the start, sub-projects two folders down too (a workspace of projects, each with its own).
    for (let depth = 0; ; depth++) {
      add(path.join(dir, 'node_modules'))
      for (const sub of subdirs(dir)) {
        add(path.join(sub, 'node_modules'))
        if (depth < 3) for (const subsub of subdirs(sub)) add(path.join(subsub, 'node_modules'))
      }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  // npm's global root, worked out rather than asked of npm: on Windows asking starts a console.
  if (process.env.npm_config_prefix) add(path.join(process.env.npm_config_prefix, process.platform === 'win32' ? '' : 'lib', 'node_modules'))
  if (process.platform === 'win32') add(path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules'))
  else add(path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules'))
  const npx = path.join(os.homedir(), '.npm', '_npx')
  try {
    const found = []
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
    const rank = (v) => v.split('.').map((n) => String(Number(n) || 0).padStart(5, '0')).join('')
    found.sort((a, b) => rank(b.v).localeCompare(rank(a.v)))
    for (const { mods } of found) add(mods)
  } catch {}
  return roots
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
